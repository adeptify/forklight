/**
 * Candidate reverification (verification-only, no Worker, no Attempt).
 *
 * Covers: eligibility categories, frozen allowance, task/attempt immutability,
 * pass/fail, concurrency/single-flight, crash-safe status, Main Review and
 * Integration binding, daemon protocol/coordinator, Hub mutation + projection,
 * CLI/MCP receipt operation names, and bilingual Hub assets.
 */
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type {
  AdvancedPolicyFields,
  AttemptRecord,
  EffectivePolicySnapshot,
  ProvenanceSource,
  TaskRecord,
  VerificationResult,
} from "../src/core/types.js";
import { StateStore } from "../src/state/store.js";
import { taskPaths } from "../src/core/config.js";
import { prepareWorkspace } from "../src/workspace/copy.js";
import { createPathPolicy } from "../src/workspace/path-policy.js";
import { writeWorkspacePatchReport } from "../src/workspace/patch.js";
import {
  reverifyCandidate,
  resolveCandidateReverificationEligibility,
  projectCandidateReverificationResult,
  REVERIFICATION_REASON_MAX_LENGTH,
} from "../src/core/candidate-reverification.js";
import {
  defaultAdvancedPolicyFields,
  defaultEnforcementCapability,
  maxMainReverificationsFromSnapshot,
} from "../src/core/advanced-policy.js";
import { recordMainReview } from "../src/core/main-review.js";
import { preflightIntegration } from "../src/core/integration.js";
import { daemonRequestTimeoutMs } from "../src/daemon/client.js";
import { requiresMatchingBuildIdentity } from "../src/daemon/protocol.js";
import { DaemonCoordinator } from "../src/daemon/coordinator.js";
import { ForkLightDaemon } from "../src/daemon/server.js";
import { SettingsService } from "../src/core/settings.js";
import { buildSafeTaskJourney, HubServer } from "../src/hub/server.js";
import { SetupService } from "../src/setup/service.js";
import type { SetupKeychainStore, SetupSystemInspector } from "../src/setup/types.js";
import { get, request } from "node:http";

// SIGTERM no-op: ForkLightDaemon in-process tests use the same process pid.
process.on("SIGTERM", () => {});

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const hubPublic = path.join(root, "src", "hub", "public");

// --- Fixtures ---

function snapshot(maxRev: number, overrides: Partial<AdvancedPolicyFields> = {}): EffectivePolicySnapshot {
  const values: AdvancedPolicyFields = { ...defaultAdvancedPolicyFields(), maxMainReverifications: maxRev, ...overrides };
  const provenance = Object.fromEntries(
    Object.keys(values).map((key) => [key, "global" as ProvenanceSource]),
  ) as Record<keyof AdvancedPolicyFields, ProvenanceSource>;
  return {
    profileId: "test-profile",
    values,
    provenance,
    enforcementCapability: defaultEnforcementCapability(),
  };
}

function v1Spec(project: string, commands: string[]): TaskRecord["spec"] {
  return {
    version: 1,
    name: "reverify-fixture",
    project,
    goal: "Exercise candidate reverification",
    constraints: [],
    provider: { name: "deepseek", model: "v4", keychainService: "forklight.deepseek.api-key" },
    runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: 0.1 },
    workspace: { exclude: [".git", "node_modules"] },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
    acceptance: { commands },
  };
}

function failedVerification(command: string, opts: {
  behaviorPassed?: boolean;
  policyPassed?: boolean;
  sourceCompatible?: boolean;
  diffPath: string;
  businessFiles?: number;
  businessLines?: number;
}): VerificationResult {
  const behaviorPassed = opts.behaviorPassed ?? false;
  const policyPassed = opts.policyPassed ?? true;
  const sourceCompatible = opts.sourceCompatible ?? true;
  const passed = behaviorPassed && policyPassed && sourceCompatible;
  return {
    passed,
    behaviorPassed,
    policyPassed,
    sourceCompatible,
    commands: [{ command, exitCode: behaviorPassed ? 0 : 1, stdout: "", stderr: "", durationMs: 1, timedOut: false }],
    diffPath: opts.diffPath,
    patches: {
      business: {
        path: opts.diffPath,
        filesChanged: opts.businessFiles ?? 1,
        changedLines: opts.businessLines ?? 2,
        affectedPaths: ["readme.md"],
      },
      generated: { path: opts.diffPath, filesChanged: 0, changedLines: 0, affectedPaths: [] },
      integration: { path: opts.diffPath, filesChanged: opts.businessFiles ?? 1, changedLines: opts.businessLines ?? 2, affectedPaths: ["readme.md"] },
    },
    sourceUnchanged: true,
  };
}

interface BuiltTask {
  task: TaskRecord;
  attemptId: string;
  store: StateStore;
  home: string;
  markerPath: string;
  command: string;
}

/** Build a failed Task with a completed Attempt, a retained non-empty business
 *  Diff, and a latest verification that failed only behavior acceptance. */
async function buildFailedCandidateTask(
  id: string,
  maxRev = 1,
  verificationOverrides: Partial<Parameters<typeof failedVerification>[1]> = {},
): Promise<BuiltTask> {
  const home = await mkdtemp(path.join(tmpdir(), `fl-reverify-${id}-`));
  const sourceDir = path.join(home, "source");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(path.join(sourceDir, "readme.md"), "# hello\n\nOriginal text.\n");
  const markerPath = path.join(home, ".fl-reverify-marker");
  const command = `test -f ${markerPath}`;
  const spec = v1Spec(sourceDir, [command]);
  const paths = taskPaths(home, id);
  await prepareWorkspace(spec, paths);
  // Simulate a Worker edit in the workspace -> non-empty business Diff.
  await writeFile(path.join(paths.workspace, "readme.md"), "# hello\n\nChanged text.\n");
  await writeWorkspacePatchReport(paths, createPathPolicy(spec));

  const store = new StateStore(home);
  const task: TaskRecord = {
    id,
    name: spec.name,
    status: "failed",
    sourcePath: sourceDir,
    taskFile: `forklight://test/${id}`,
    spec,
    paths,
    sessionId: `session-${id}`,
    currentAttemptId: `${id}-att-1`,
    createdAt: "2026-07-27T00:00:00Z",
    updatedAt: "2026-07-27T01:00:00Z",
    startedAt: "2026-07-27T00:00:00Z",
    finishedAt: "2026-07-27T01:00:00Z",
    error: "Independent verification failed",
    effectivePolicy: snapshot(maxRev),
  };
  store.createTask(task);
  const attempt: AttemptRecord = {
    id: `${id}-att-1`,
    taskId: id,
    ordinal: 1,
    status: "succeeded",
    sessionId: task.sessionId,
    rawLogPath: path.join(paths.logs, "att-1.jsonl"),
    startedAt: "2026-07-27T00:00:00Z",
    finishedAt: "2026-07-27T00:30:00Z",
    exitCode: 0,
    runtimeBudgetUsd: 0.1,
  };
  store.createAttempt(attempt);
  store.addEvent(id, attempt.id, "verification.completed", "Independent verification failed", failedVerification(command, { diffPath: paths.diff, ...verificationOverrides }));
  return { task, attemptId: attempt.id, store, home, markerPath, command };
}

function coord(store: StateStore): DaemonCoordinator {
  return new DaemonCoordinator(store, new SettingsService(store), 2);
}

// --- Eligibility ---

test("eligibility: eligible failed candidate with behavior-only failure", async () => {
  const built = await buildFailedCandidateTask("eligible");
  try {
    const elig = resolveCandidateReverificationEligibility(built.store, built.task.id, 1);
    assert.equal(elig.eligible, true);
    assert.equal(elig.category, "eligible");
    assert.equal(elig.attemptId, built.attemptId);
    assert.equal(elig.allowance.max, 1);
    assert.equal(elig.allowance.remaining, 1);
    assert.equal(elig.allowance.source, "global");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("eligibility: non-failed Task rejected", async () => {
  const built = await buildFailedCandidateTask("notfailed");
  try {
    built.store.setTaskStatus(built.task.id, "succeeded", { error: null });
    const elig = resolveCandidateReverificationEligibility(built.store, built.task.id, 1);
    assert.equal(elig.eligible, false);
    assert.equal(elig.category, "task-not-failed");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("eligibility: competition candidate rejected", async () => {
  const built = await buildFailedCandidateTask("comp");
  try {
    const siblingId = "comp-sibling";
    const {
      currentAttemptId: _currentAttemptId,
      startedAt: _startedAt,
      finishedAt: _finishedAt,
      ...siblingBase
    } = built.task;
    built.store.createTask({
      ...siblingBase,
      id: siblingId,
      name: "competition-sibling",
      status: "queued",
      taskFile: `forklight://test/${siblingId}`,
      paths: taskPaths(built.home, siblingId),
      sessionId: `session-${siblingId}`,
      error: "Queued competition sibling",
    });
    built.store.createCompetition(
      { id: "c1", name: "comp", contractTaskId: built.task.id, status: "completed", rankingPolicy: { weights: { verification: 1, diffFocus: 0, retries: 0, cost: 0, duration: 0, delivery: 0 }, tieThreshold: 0 }, createdAt: "2026-07-27T00:00:00Z", updatedAt: "2026-07-27T00:00:00Z" },
      [
        { id: "cand-1", competitionId: "c1", taskId: built.task.id, ordinal: 1, providerName: "deepseek", modelName: "v4" },
        { id: "cand-2", competitionId: "c1", taskId: siblingId, ordinal: 2, providerName: "minimax", modelName: "m3" },
      ],
    );
    const elig = resolveCandidateReverificationEligibility(built.store, built.task.id, 1);
    assert.equal(elig.category, "competition-candidate");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("eligibility: running Attempt rejected", async () => {
  const built = await buildFailedCandidateTask("running");
  try {
    built.store.updateAttempt(built.attemptId, { status: "running" });
    const elig = resolveCandidateReverificationEligibility(built.store, built.task.id, 1);
    assert.equal(elig.category, "running-attempt");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("eligibility: no completed Attempt rejected", async () => {
  const built = await buildFailedCandidateTask("noatt");
  try {
    built.store.updateAttempt(built.attemptId, { status: "interrupted" });
    const elig = resolveCandidateReverificationEligibility(built.store, built.task.id, 1);
    assert.equal(elig.category, "no-completed-attempt");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("eligibility: policy failure rejected as wrong category", async () => {
  const built = await buildFailedCandidateTask("policyfail", 1, { policyPassed: false });
  try {
    const elig = resolveCandidateReverificationEligibility(built.store, built.task.id, 1);
    assert.equal(elig.category, "wrong-failure-category");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("eligibility: source compatibility failure rejected as wrong category", async () => {
  const built = await buildFailedCandidateTask("sourcefail", 1, { sourceCompatible: false });
  try {
    const elig = resolveCandidateReverificationEligibility(built.store, built.task.id, 1);
    assert.equal(elig.category, "wrong-failure-category");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("eligibility: missing business Diff rejected", async () => {
  const built = await buildFailedCandidateTask("nodiff", 1, { businessFiles: 0, businessLines: 0 });
  try {
    const elig = resolveCandidateReverificationEligibility(built.store, built.task.id, 1);
    assert.equal(elig.category, "missing-candidate-diff");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("eligibility: allowance zero rejected", async () => {
  const built = await buildFailedCandidateTask("allowzero", 0);
  try {
    const elig = resolveCandidateReverificationEligibility(built.store, built.task.id, 0);
    assert.equal(elig.category, "allowance-zero");
    assert.equal(elig.allowance.max, 0);
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("eligibility: allowance exhausted rejected", async () => {
  const built = await buildFailedCandidateTask("exhausted", 1);
  try {
    // Manually record one prior authorization to exhaust the default-1 allowance.
    built.store.addEvent(built.task.id, built.attemptId, "candidate.reverification.authorized", "prior", { attemptId: built.attemptId });
    const elig = resolveCandidateReverificationEligibility(built.store, built.task.id, 1);
    assert.equal(elig.category, "allowance-exhausted");
    assert.equal(elig.allowance.consumed, 1);
    assert.equal(elig.allowance.remaining, 0);
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

// --- Input validation ---

test("operation rejects missing confirm and invalid reason", async () => {
  const built = await buildFailedCandidateTask("input");
  try {
    await assert.rejects(
      reverifyCandidate(built.store, { taskId: built.task.id, reason: "x", confirm: undefined as unknown as true }, 1, 30_000),
      /confirm/,
    );
    await assert.rejects(
      reverifyCandidate(built.store, { taskId: built.task.id, reason: "x".repeat(REVERIFICATION_REASON_MAX_LENGTH + 1), confirm: true }, 1, 30_000),
      /reason.*must be/,
    );
    await assert.rejects(
      reverifyCandidate(built.store, { taskId: built.task.id, reason: "   ", confirm: true }, 1, 30_000),
      /reason.*must be/,
    );
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

// --- Pass / fail / immutability ---

test("pass: reruns commands without a Worker, Task succeeds, original Attempt preserved", async () => {
  const built = await buildFailedCandidateTask("pass");
  try {
    await writeFile(built.markerPath, "now-passes\n");
    const result = await reverifyCandidate(
      built.store,
      { taskId: built.task.id, reason: "transient acceptance flake", confirm: true },
      1,
      30_000,
    );
    assert.equal(result.status, "passed");
    const after = built.store.getTask(built.task.id);
    assert.equal(after.status, "succeeded", "Task moved to succeeded");
    // Failed Attempt is preserved (never rewritten).
    const attempt = built.store.getAttempt(built.attemptId);
    assert.equal(attempt.status, "succeeded", "retained Attempt status unchanged");
    // No new Attempt was created.
    assert.equal(built.store.listAttempts(built.task.id).length, 1);
    // Cost facts: exact zero-Worker.
    assert.equal(result.costFacts.workerInvoked, false);
    assert.equal(result.costFacts.incrementalWorkerTokens, 0);
    assert.equal(result.costFacts.incrementalModelRuntimeCostUsd, 0);
    assert.equal(result.costFacts.commandCount, 1);
    assert.equal(result.costFacts.passedCommandCount, 1);
    assert.ok(result.costFacts.wallDurationMs >= 0);
    assert.equal(result.costFacts.localVerificationTimeNotZero, true);
    assert.equal(result.costFacts.mainExchangeNotZero, true);
    assert.equal(result.costFacts.noFullRestartSavingsClaim, true);
    assert.equal(result.requiresFreshMainAccept, true);
    // Allowance consumed.
    assert.equal(result.allowance.consumed, 1);
    assert.equal(result.allowance.remaining, 0);
    // Authorization, started, canonical verification.completed, completed events.
    const types = built.store.listEvents(built.task.id).map((e) => e.type);
    assert.ok(types.includes("candidate.reverification.authorized"));
    assert.ok(types.includes("candidate.reverification.started"));
    assert.ok(types.includes("candidate.reverification.completed"));
    const verifications = built.store.listEvents(built.task.id).filter((e) => e.type === "verification.completed");
    assert.equal(verifications.length, 2, "a new canonical verification.completed was appended");
    const latest = verifications[verifications.length - 1]!;
    assert.equal(latest.sequence, result.verificationEventSequence);
    assert.equal((latest.payload as VerificationResult).passed, true);
    // Crash-safety: Task was never set to "verifying" (no verification.started event
    // for this pass - the reverify core emits its own start marker, not verification.started).
    assert.ok(!types.includes("verification.started"), "reverify never emits verification.started");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("fail: Task and Attempt remain failed, allowance consumed, no auto-retry", async () => {
  const built = await buildFailedCandidateTask("fail");
  try {
    // Marker absent -> command still fails.
    const result = await reverifyCandidate(
      built.store,
      { taskId: built.task.id, reason: "try again", confirm: true },
      1,
      30_000,
    );
    assert.equal(result.status, "failed");
    assert.equal(built.store.getTask(built.task.id).status, "failed");
    assert.equal(built.store.getAttempt(built.attemptId).status, "succeeded");
    assert.equal(result.costFacts.passedCommandCount, 0);
    assert.equal(result.allowance.consumed, 1);
    // Latest verification is the new failing one.
    const latest = built.store.listEvents(built.task.id).filter((e) => e.type === "verification.completed").at(-1)!;
    assert.equal((latest.payload as VerificationResult).passed, false);
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

// --- Concurrency / single-flight ---

test("concurrency: a second in-process reverification is rejected while one runs", async () => {
  const built = await buildFailedCandidateTask("conc", 2);
  try {
    // Do not create the marker yet so the first call stays in flight briefly.
    const first = reverifyCandidate(
      built.store,
      { taskId: built.task.id, reason: "first", confirm: true },
      2,
      30_000,
    );
    // The single-flight guard is synchronous within the same process; the second
    // call must reject before any command runs.
    await assert.rejects(
      reverifyCandidate(built.store, { taskId: built.task.id, reason: "second", confirm: true }, 2, 30_000),
      /in progress/,
    );
    await first;
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

// --- Crash-safe status ---

test("crash-safe: authorized-but-incomplete reverification leaves Task failed; recover does not queue a Worker", async () => {
  const built = await buildFailedCandidateTask("crash");
  try {
    // Simulate a crash after authorization but before completion.
    built.store.addEvent(built.task.id, built.attemptId, "candidate.reverification.authorized", "authorized then crashed", { attemptId: built.attemptId });
    assert.equal(built.store.getTask(built.task.id).status, "failed");
    const beforeAttempts = built.store.listAttempts(built.task.id).length;
    const coordinator = coord(built.store);
    await coordinator.recover();
    assert.equal(built.store.getTask(built.task.id).status, "failed", "recover must not change Task status");
    assert.equal(built.store.listAttempts(built.task.id).length, beforeAttempts, "recover must not create an Attempt");
    // The allowance is consumed by the durable authorization; a new explicit
    // request is rejected (default max=1).
    const elig = resolveCandidateReverificationEligibility(built.store, built.task.id, 1);
    assert.equal(elig.category, "allowance-exhausted");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

// --- Allowance ---

test("allowance: max=2 permits two reverifications and rejects a third", async () => {
  const built = await buildFailedCandidateTask("multicap", 2);
  try {
    // First: fail (marker absent). Task stays failed; allowance consumed.
    const r1 = await reverifyCandidate(built.store, { taskId: built.task.id, reason: "first", confirm: true }, 2, 30_000);
    assert.equal(r1.status, "failed");
    assert.equal(built.store.getTask(built.task.id).status, "failed");
    // Second: still fail. Allowance consumed again.
    const r2 = await reverifyCandidate(built.store, { taskId: built.task.id, reason: "second", confirm: true }, 2, 30_000);
    assert.equal(r2.status, "failed");
    // A third is rejected: allowance exhausted (default-2).
    await assert.rejects(
      reverifyCandidate(built.store, { taskId: built.task.id, reason: "third", confirm: true }, 2, 30_000),
      /allowance is exhausted/,
    );
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

// --- Main Review + Integration binding ---

test("binding: passing reverification still requires a fresh Main accept before Integration preflight", async () => {
  const built = await buildFailedCandidateTask("binding");
  try {
    await writeFile(built.markerPath, "pass\n");
    await reverifyCandidate(built.store, { taskId: built.task.id, reason: "pass", confirm: true }, 1, 30_000);
    assert.equal(built.store.getTask(built.task.id).status, "succeeded");
    // Integration preflight must reject: no fresh Main accept bound to the new verification.
    const before = await preflightIntegration(built.store, built.task.id, {
      reviewedPatchMaxFiles: 5,
      reviewedPatchMaxLines: 400,
      reviewReceiptTtlMs: 900_000,
      verificationTimeoutMs: 30_000,
      backupRetentionCount: 3,
      autoRollback: true,
    });
    assert.ok(before.rejectionReasons.some((r) => r.includes("Main agent review acceptance is required")));
    // Record a fresh accept bound to the new verification event.
    recordMainReview(built.store, built.task.id, { decision: "accept", reason: "fresh accept after reverify", confirm: true });
    const after = await preflightIntegration(built.store, built.task.id, {
      reviewedPatchMaxFiles: 5,
      reviewedPatchMaxLines: 400,
      reviewReceiptTtlMs: 900_000,
      verificationTimeoutMs: 30_000,
      backupRetentionCount: 3,
      autoRollback: true,
    });
    assert.equal(after.rejectionReasons.length, 0, "preflight passes after fresh accept");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("projection: privacy-safe view omits reason and command output", () => {
  const view = projectCandidateReverificationResult(
    {
      status: "passed",
      taskId: "t",
      attemptId: "a",
      attemptStatus: "succeeded",
      verificationEventSequence: 9,
      verification: {
        passed: true, behaviorPassed: true, policyPassed: true, sourceCompatible: true,
        commands: [{ command: "private command", exitCode: 0, stdout: "private stdout", stderr: "private stderr", durationMs: 5, timedOut: false }],
        diffPath: "/tmp/d", sourceUnchanged: true,
      },
      allowance: { max: 1, consumed: 1, remaining: 0, source: "global" },
      costFacts: {
        workerInvoked: false, incrementalWorkerTokens: 0, incrementalModelRuntimeCostUsd: 0,
        commandCount: 1, passedCommandCount: 1, commandDurationMs: 5, wallDurationMs: 7,
        localVerificationTimeNotZero: true, mainExchangeNotZero: true, noFullRestartSavingsClaim: true,
      },
      requiresFreshMainAccept: true,
    },
    "succeeded",
  );
  const serialized = JSON.stringify(view);
  assert.doesNotMatch(serialized, /private command|private stdout|private stderr/);
  assert.equal(view.status, "passed");
  assert.equal(view.costFacts.workerInvoked, false);
});

// --- Daemon protocol + coordinator ---

test("daemon protocol: candidate_reverify is mutating with a long transport timeout; eligibility is read-only", () => {
  assert.equal(requiresMatchingBuildIdentity("candidate_reverify"), true);
  assert.equal(requiresMatchingBuildIdentity("candidate_reverify_eligibility"), false);
  assert.equal(daemonRequestTimeoutMs("candidate_reverify", {}), 6 * 60 * 60 * 1000 + 5_000);
  assert.equal(daemonRequestTimeoutMs("candidate_reverify", { requestTimeoutMs: 30_000 }), 35_000);
});

test("coordinator: reverifyCandidate delegates to the core and returns the projection", async () => {
  const built = await buildFailedCandidateTask("coord");
  try {
    await writeFile(built.markerPath, "pass\n");
    const c = coord(built.store);
    const view = await c.reverifyCandidate(built.task.id, "transient flake", true);
    assert.equal(view.status, "passed");
    assert.equal(view.taskStatus, "succeeded");
    assert.equal(view.attemptStatus, "succeeded");
    assert.equal(view.costFacts.workerInvoked, false);
    // Eligibility after pass: Task is no longer failed.
    const elig = c.candidateReverificationEligibility(built.task.id);
    assert.equal(elig.category, "task-not-failed");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("coordinator: successful reverification immediately wakes plan dependents", async () => {
  const built = await buildFailedCandidateTask("coord-plan");
  try {
    const dependentId = "coord-plan-dependent";
    const {
      currentAttemptId: _currentAttemptId,
      startedAt: _startedAt,
      finishedAt: _finishedAt,
      ...dependentBase
    } = built.task;
    built.store.createTask({
      ...dependentBase,
      id: dependentId,
      name: "dependent",
      status: "blocked",
      taskFile: `forklight://test/${dependentId}`,
      paths: taskPaths(built.home, dependentId),
      sessionId: `session-${dependentId}`,
      error: "Waiting for failed prerequisite",
    });
    built.store.createPlanGraph(
      {
        id: "coord-plan-graph",
        name: "candidate reverification dependency",
        objective: "Wake a dependent after verification-only recovery",
        planFile: "forklight://test/coord-plan-graph",
        createdAt: "2026-07-27T00:00:00Z",
        updatedAt: "2026-07-27T00:00:00Z",
      },
      [
        { id: "foundation", planId: "coord-plan-graph", taskId: built.task.id, itemIndex: 0, taskFile: built.task.taskFile },
        { id: "dependent", planId: "coord-plan-graph", taskId: dependentId, itemIndex: 1, taskFile: `forklight://test/${dependentId}` },
      ],
      [{ planId: "coord-plan-graph", itemId: "dependent", dependsOnItemId: "foundation" }],
    );
    await writeFile(built.markerPath, "pass\n");
    const c = new DaemonCoordinator(built.store, new SettingsService(built.store), 0);
    const view = await c.reverifyCandidate(built.task.id, "transient acceptance failure", true);
    assert.equal(view.status, "passed");
    assert.equal(built.store.getTask(dependentId).status, "queued");
    assert.equal(
      built.store.listEvents(dependentId).filter((event) => event.type === "task.ready").length,
      1,
    );
    await c.shutdown();
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("coordinator: reverifyCandidate rejects when a Worker job is active", async () => {
  const built = await buildFailedCandidateTask("coordactive");
  try {
    const c = coord(built.store);
    // Simulate an active Worker job by marking the attempt running and relying
    // on the core's running-attempt guard (coordinator also guards queue admission).
    built.store.updateAttempt(built.attemptId, { status: "running" });
    await assert.rejects(
      c.reverifyCandidate(built.task.id, "x", true),
      /running Attempt|running/,
    );
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("ForkLightDaemon: candidate_reverify dispatches end-to-end over the socket", async () => {
  const built = await buildFailedCandidateTask("daemon");
  built.store.close();
  const daemon = new ForkLightDaemon(built.home, 1);
  try {
    await daemon.start();
    await writeFile(built.markerPath, "pass\n");
    // daemonExchange is imported lazily to avoid pulling the client default home.
    const { daemonExchange } = await import("../src/daemon/client.js");
    const res = await daemonExchange("candidate_reverify", {
      taskId: built.task.id,
      reason: "daemon end-to-end",
      confirm: true,
    }, built.home);
    assert.ok(res.ok, `candidate_reverify should succeed: ${res.error ?? ""}`);
    const result = res.result as Record<string, unknown>;
    assert.equal(result.status, "passed");
    assert.equal(result.taskStatus, "succeeded");
    assert.equal((result.costFacts as Record<string, unknown>).workerInvoked, false);
    // Eligibility over the socket.
    const eligRes = await daemonExchange("candidate_reverify_eligibility", { taskId: built.task.id }, built.home);
    assert.ok(eligRes.ok);
    const elig = eligRes.result as Record<string, unknown>;
    assert.equal(elig.category, "task-not-failed");
  } finally {
    await daemon.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

// --- Hub mutation + projection ---

class MemoryKeychain implements SetupKeychainStore {
  readonly values = new Map<string, string>();
  private id(s: string, a: string): string { return `${a}:${s}`; }
  has(s: string, a: string): boolean { return this.values.has(this.id(s, a)); }
  read(s: string, a: string): string | undefined { return this.values.get(this.id(s, a)); }
  write(s: string, a: string, v: string): void { this.values.set(this.id(s, a), v); }
  delete(s: string, a: string): void { this.values.delete(this.id(s, a)); }
}

function hubInspector(): SetupSystemInspector {
  return { platform: () => "darwin", nodeVersion: () => "v24.5.0", account: () => "hub-user", commandExists: () => true };
}

function doHttp(u: string, method: "GET" | "POST", token?: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers["x-forklight-hub-token"] = token;
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    if (payload) { headers["Content-Type"] = "application/json"; headers["Content-Length"] = String(Buffer.byteLength(payload)); }
    function onRes(res: import("node:http").IncomingMessage): void {
      let d = "";
      res.on("data", (c: Buffer) => { d += c.toString(); });
      res.on("end", () => { let parsed: unknown = d; try { if (d) parsed = JSON.parse(d); } catch { /* raw */ } resolve({ status: res.statusCode ?? 0, body: parsed }); });
    }
    if (method === "GET") { get(u, { headers }, onRes).on("error", reject); }
    else { const req = request(u, { method: "POST", headers }, onRes); req.on("error", reject); if (payload) req.write(payload); req.end(); }
  });
}

test("Hub: POST /api/ops/tasks/:id/reverify bridges to daemon candidate_reverify with confirm", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-hub-reverify-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const keychain = new MemoryKeychain();
  const setup = new SetupService(settings, keychain, hubInspector());
  const staticDir = path.join(home, "static");
  await mkdir(staticDir, { recursive: true });
  await writeFile(path.join(staticDir, "index.html"), "<!DOCTYPE html>\n", "utf8");
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const server = new HubServer({
    settings, setup, keychain, staticRoot: staticDir, account: () => "hub-user", port: 0,
    daemonRequest: async <T>(method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params });
      if (method === "candidate_reverify") {
        return { status: "passed", taskId: params.taskId, taskStatus: "succeeded", attemptId: "a1", attemptStatus: "succeeded", verificationEventSequence: 5, allowance: { max: 1, consumed: 1, remaining: 0, source: "global" }, costFacts: { workerInvoked: false, incrementalWorkerTokens: 0, incrementalModelRuntimeCostUsd: 0, commandCount: 1, passedCommandCount: 1, commandDurationMs: 3, wallDurationMs: 9, localVerificationTimeNotZero: true, mainExchangeNotZero: true, noFullRestartSavingsClaim: true }, requiresFreshMainAccept: true } as T;
      }
      if (method === "candidate_reverify_eligibility") {
        return { eligible: true, category: "eligible", attemptId: "a1", allowance: { max: 1, consumed: 0, remaining: 1, source: "global" } } as T;
      }
      throw new Error(`unexpected daemon method ${method}`);
    },
  });
  try {
    await server.start();
    const token = server.getToken();
    const url = `http://127.0.0.1:${server.getPort()}/api/ops/tasks/t-hub/reverify`;
    const res = await doHttp(url, "POST", token, { reason: "hub reverify", confirm: true });
    assert.equal(res.status, 200);
    const body = res.body as { ok: boolean; action: string; result: Record<string, unknown> };
    assert.equal(body.ok, true);
    assert.equal(body.action, "candidate_reverify");
    assert.equal(body.result.status, "passed");
    assert.equal(calls.some((c) => c.method === "candidate_reverify" && c.params.confirm === true), true);
    // Missing confirm is rejected by the Hub before reaching the daemon.
    calls.length = 0;
    const bad = await doHttp(url, "POST", token, { reason: "hub reverify" });
    assert.equal(bad.status, 422);
    assert.equal(calls.length, 0);
  } finally {
    await server.stop();
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("Hub: buildSafeTaskJourney projects candidateReverification with zero-Worker facts", () => {
  const task = { id: "t", status: "succeeded", spec: { version: 2, provider: { name: "deepseek" }, runtime: { name: "claude-code" } } } as unknown as Record<string, unknown>;
  const decision = { verification: { passed: true, behaviorPassed: true, policyPassed: true, sourceCompatible: true, commands: [], diffPath: "/d", sourceUnchanged: true } } as unknown;
  const inspect = {
    events: [{
      type: "candidate.reverification.completed",
      payload: {
        status: "passed",
        attemptId: "a1",
        attemptStatus: "succeeded",
        verificationEventSequence: 7,
        workerInvoked: false,
        incrementalWorkerTokens: 0,
        incrementalModelRuntimeCostUsd: 0,
        commandCount: 2,
        passedCommandCount: 2,
        commandDurationMs: 11,
        wallDurationMs: 20,
        allowance: { max: 1, consumed: 1, remaining: 0, source: "global" },
        requiresFreshMainAccept: true,
      },
    }],
    attempts: [],
  } as unknown;
  const journey = buildSafeTaskJourney(task, decision, inspect);
  assert.ok(journey.candidateReverification);
  const rv = journey.candidateReverification!;
  assert.equal(rv.status, "passed");
  assert.equal(rv.workerInvoked, false);
  assert.equal(rv.incrementalWorkerTokens, 0);
  assert.equal(rv.incrementalModelRuntimeCostUsd, 0);
  assert.equal(rv.localVerificationTimeNotZero, true);
  assert.equal(rv.noFullRestartSavingsClaim, true);
  assert.equal(rv.allowance.remaining, 0);
});

test("Hub: malformed candidate reverification evidence is omitted instead of fabricating zero-cost facts", () => {
  const task = { id: "t", status: "failed", spec: { version: 2, provider: { name: "deepseek" }, runtime: { name: "claude-code" } } } as unknown as Record<string, unknown>;
  const decision = { verification: { passed: false, behaviorPassed: false, policyPassed: true, sourceCompatible: true, commands: [], diffPath: "/d", sourceUnchanged: true } } as unknown;
  const inspect = {
    events: [{
      type: "candidate.reverification.completed",
      payload: {
        status: "passed",
        attemptId: "",
        workerInvoked: true,
        incrementalWorkerTokens: 99,
      },
    }],
    attempts: [],
  } as unknown;
  const journey = buildSafeTaskJourney(task, decision, inspect);
  assert.equal(journey.candidateReverification, undefined);
});

// --- Bilingual assets ---

test("Hub i18n carries candidate reverification keys in both languages", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  for (const key of [
    "taskReverify", "taskReverifyTitle", "taskReverifyHint", "taskReverifyReason",
    "taskReverifyConfirm", "taskReverifyZeroWorker", "taskReverifyNotFree",
    "taskReverifyLimitLabel", "taskReverifyLimitValue", "taskReverifyUnavailable",
    "taskReverifyThreeWay", "taskReverifyJourneyTitle", "taskReverifyJourneyIntro",
    "taskReverifyJourneyOutcome", "taskReverifyJourneyCommands",
    "taskReverifyJourneyZeroWorker", "taskReverifyJourneyNotFree",
    "taskReverifyJourneyFreshAccept", "taskReverifyStatusPassed", "taskReverifyStatusFailed",
    "taskReverifyRejectTaskNotFailed", "taskReverifyRejectCompetition",
    "taskReverifyRejectRunning", "taskReverifyRejectNoAttempt",
    "taskReverifyRejectNoVerification", "taskReverifyRejectWrongCategory",
    "taskReverifyRejectNoDiff", "taskReverifyRejectAllowanceZero",
    "taskReverifyRejectAllowanceExhausted",
    "workersAdvMaxMainReverifications", "workersAdvMaxMainReverificationsHint",
  ]) {
    assert.ok(i18n.indexOf(key) !== i18n.lastIndexOf(key), `${key} exists in both en and zh`);
  }
  // Chinese truthfulness: Worker not invoked, no full-restart saving claimed.
  assert.ok(i18n.includes("不调用 Worker"));
  assert.ok(i18n.includes("增量 Worker Token：0"));
  assert.ok(i18n.includes("没有配对基线时，不声称省下了从头重做的成本"));
  // English truthfulness: local verification time and Main exchange are not zero.
  assert.match(i18n, /taskReverifyNotFree['"]?\s*:\s*"[^"]*NOT zero[^"]*full-restart/);
});

test("Hub app.js wires the reverify control and journey card without private content", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  assert.ok(src.includes('data-fl-role", "candidate-reverification"'), "journey card marker");
  assert.ok(src.includes("function renderCandidateReverification"), "journey renderer");
  assert.ok(src.includes("/reverify"), "reverify bridge URL");
  assert.ok(src.includes("taskReverifyThreeWay"), "three-way choice i18n key");
  assert.ok(src.includes("taskReverifyZeroWorker"), "zero-Worker facts i18n key");
  assert.ok(src.includes("taskReverifyNotFree"), "not-free caveat i18n key");
  assert.ok(src.includes("candidateReverificationEligibility"), "eligibility drives the button");
  assert.ok(src.includes("reverifyRejectionLabel"), "rejection labels surfaced");
  // The reverify button is disabled when not eligible.
  assert.ok(src.includes("reverifyBtn.disabled = true"));
});

// --- CLI / MCP receipt operation names (compile-time bounded) ---

test("CLI and MCP exchange-receipt operation sets include the reverify operation", async () => {
  const cli = await readFile(path.join(root, "src", "cli", "exchange-receipts.ts"), "utf8");
  const mcp = await readFile(path.join(root, "src", "mcp", "exchange-receipts.ts"), "utf8");
  assert.ok(cli.includes("forklight_candidate_reverify"), "CLI receipt operation registered");
  assert.ok(mcp.includes("forklight_candidate_reverify"), "MCP receipt operation registered");
  // CLI command and usage are present.
  const cliSrc = await readFile(path.join(root, "src", "cli.ts"), "utf8");
  assert.ok(cliSrc.includes('command === "reverify"'), "CLI reverify command handler");
  assert.ok(cliSrc.includes("forklight reverify"), "CLI usage line");
  assert.ok(cliSrc.includes("humanCandidateReverifyLines"), "CLI human renderer");
  // MCP tool registered.
  const mcpSrc = await readFile(path.join(root, "src", "mcp", "server.ts"), "utf8");
  assert.ok(mcpSrc.includes('"forklight_candidate_reverify"'), "MCP tool name");
});

// --- maxMainReverifications resolution ---

test("maxMainReverificationsFromSnapshot reads the frozen allowance with global fallback", () => {
  assert.equal(maxMainReverificationsFromSnapshot(undefined), 1);
  assert.equal(maxMainReverificationsFromSnapshot(snapshot(0)), 0);
  assert.equal(maxMainReverificationsFromSnapshot(snapshot(3)), 3);
});

// --- Capture failure (storage blocking) ---

test("capture failure: blocked revisions directory keeps task failed with content-free evidence", async () => {
  const built = await buildFailedCandidateTask("capturefail", 1);
  try {
    // Seed old revision evidence directly from the original behavior-only
    // failed verification sequence — no prior passing reverification.
    const diffContent = await readFile(built.task.paths.diff, "utf8");
    const digest = createHash("sha256").update(diffContent).digest("hex");
    const revisionId = randomUUID();
    const revisionsDir = path.join(built.task.paths.root, "revisions");
    await mkdir(revisionsDir, { recursive: true, mode: 0o700 });
    await copyFile(built.task.paths.diff, path.join(revisionsDir, `${revisionId}.patch`));

    // Get the original verification event sequence from the failed-candidate fixture.
    const events = built.store.listEvents(built.task.id);
    const origVerification = events.find((event) => event.type === "verification.completed");
    assert.ok(origVerification !== undefined, "original verification must exist");
    const origVerSeq = origVerification!.sequence;

    built.store.addEvent(
      built.task.id,
      built.attemptId,
      "candidate.revision.captured",
      "Old revision evidence from prior reverification",
      {
        id: revisionId,
        taskId: built.task.id,
        attemptId: built.attemptId,
        attemptOrdinal: 1,
        verificationEventSequence: origVerSeq,
        patchDigest: digest,
        affectedPaths: ["readme.md"],
        filesChanged: 1,
        changedLines: 2,
        verificationPassed: false,
        createdAt: new Date().toISOString(),
        privateArtifactPath: path.join(revisionsDir, `${revisionId}.patch`),
      },
    );

    // Now remove the revisions directory, then create a blocker file at its path
    // so that the next capture's mkdir will fail. This is the canonical fixture
    // pattern: seed old evidence, then block the path before reverify.
    await rm(revisionsDir, { recursive: true, force: true });
    await writeFile(revisionsDir, "blocked");

    // Create the marker file so the acceptance command passes.
    await writeFile(built.markerPath, "pass\n");

    // Run exactly one reverification: verification passes, capture fails.
    const result = await reverifyCandidate(
      built.store,
      { taskId: built.task.id, reason: "storage failure on capture", confirm: true },
      1,
      30_000,
    );
    assert.equal(result.status, "failed", "reverify result is failed despite passing verification");
    assert.equal(built.store.getTask(built.task.id).status, "failed", "Task stays failed");
    assert.equal(result.costFacts.workerInvoked, false);
    assert.equal(result.costFacts.incrementalWorkerTokens, 0);
    assert.equal(result.costFacts.incrementalModelRuntimeCostUsd, 0);

    // Capture-failed event exists and is content-free — never exposes raw paths, errors, or private content.
    const afterEvents = built.store.listEvents(built.task.id);
    const captureFailedEvents = afterEvents.filter((event) => event.type === "candidate.revision.capture.failed");
    assert.equal(captureFailedEvents.length, 1, "exactly one capture-failed event");
    const cfPayload = captureFailedEvents[0]!.payload as Record<string, unknown>;
    assert.equal(cfPayload.attemptId, built.attemptId);
    assert.equal(cfPayload.workerInvoked, false);
    const cfJson = JSON.stringify(cfPayload);
    assert.ok(!cfJson.includes("ENOTDIR"), "no raw errno exposed");
    assert.ok(!cfJson.includes("EEXIST"), "no raw errno exposed");
    assert.ok(!cfJson.includes(built.task.paths.root), "no raw path exposed");

    // The old candidate.revision.captured event still exists. The exact-sequence
    // check in recordMainReview will reject because the latest verification has
    // no matching revision and revision events exist for this Task.
    const captureEvents = afterEvents.filter((event) => event.type === "candidate.revision.captured");
    assert.equal(captureEvents.length, 1, "old revision still on record");

    // Main accept must reject: no revision for the exact latest verification sequence,
    // but candidate.revision.captured events exist for this Task.
    assert.throws(
      () => recordMainReview(built.store, built.task.id, {
        decision: "accept", reason: "Should reject without exact-sequence revision", confirm: true,
      }),
      /current Diff to match/,
    );
    // No main-review event was appended.
    assert.equal(
      built.store.listEvents(built.task.id).filter((event) => event.type === "main-review.completed").length,
      0,
    );

    // Integration preflight rejects because the Task is not "succeeded".
    const preflight = await preflightIntegration(built.store, built.task.id, {
      reviewedPatchMaxFiles: 5,
      reviewedPatchMaxLines: 400,
      reviewReceiptTtlMs: 900_000,
      verificationTimeoutMs: 30_000,
      backupRetentionCount: 3,
      autoRollback: true,
    });
    assert.ok(preflight.rejectionReasons.length > 0, "preflight must reject a failed task");

    // No new Attempt was created (zero-Worker, no model cost).
    assert.equal(built.store.listAttempts(built.task.id).length, 1, "no new Attempt created");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});
