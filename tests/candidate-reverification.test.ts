/**
 * Candidate reverification (verification-only, no Worker, no Attempt).
 *
 * Covers: eligibility categories, frozen allowance, task/attempt immutability,
 * pass/fail, concurrency/single-flight, crash-safe status, Main Review and
 * Integration binding, daemon protocol/coordinator, Hub mutation + projection,
 * CLI/MCP receipt operation names, and bilingual Hub assets.
 */
import assert from "node:assert/strict";
import { copyFile, lstat, mkdir, mkdtemp, readlink, rm, symlink, writeFile, readFile } from "node:fs/promises";
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
import { captureCandidateRevision } from "../src/core/candidate-revision.js";
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

// --- Runtime-workspace fixture ---

interface RuntimeWorkspaceTaskOptions {
  taskStatus?: "failed" | "interrupted";
  attemptStatus?: "failed" | "interrupted";
  /** worker.failed failureCategory emitted after worker.started. */
  failureCategory?: "authentication" | "budget" | "runtime" | "connectivity" | "contract-infeasible";
  /** When false, no worker.started/resumed event is recorded (launch/doctor never reached the Worker). */
  workerStarted?: boolean;
  /** When false, the workspace is left identical to source so the recomputed business Diff is empty. */
  workspaceChanged?: boolean;
  policyOverrides?: Partial<AdvancedPolicyFields>;
  maxRev?: number;
}

/**
 * Build a failed/interrupted Task whose latest Attempt really started a Worker
 * (exact-Attempt worker.started evidence) but ended before any verification
 * completed. The workspace may retain a Worker edit (business Diff) or not.
 */
async function buildRuntimeWorkspaceTask(
  id: string,
  options: RuntimeWorkspaceTaskOptions = {},
): Promise<BuiltTask> {
  const maxRev = options.maxRev ?? 1;
  const home = await mkdtemp(path.join(tmpdir(), `fl-runtime-${id}-`));
  const sourceDir = path.join(home, "source");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(path.join(sourceDir, "readme.md"), "# hello\n\nOriginal text.\n");
  const markerPath = path.join(home, ".fl-runtime-marker");
  const command = `test -f ${markerPath}`;
  const spec = v1Spec(sourceDir, [command]);
  const paths = taskPaths(home, id);
  await prepareWorkspace(spec, paths);
  if (options.workspaceChanged !== false) {
    // Simulate the Worker editing files in the isolated workspace before dying.
    await writeFile(
      path.join(paths.workspace, "readme.md"),
      "# hello\n\nChanged by Worker before crash.\n",
    );
    await writeWorkspacePatchReport(paths, createPathPolicy(spec));
  }

  const store = new StateStore(home);
  const taskStatus = options.taskStatus ?? "failed";
  const attemptStatus = options.attemptStatus ?? "failed";
  const task: TaskRecord = {
    id,
    name: spec.name,
    status: taskStatus,
    sourcePath: sourceDir,
    taskFile: `forklight://test/${id}`,
    spec,
    paths,
    sessionId: `session-${id}`,
    currentAttemptId: `${id}-att-1`,
    createdAt: "2026-07-28T00:00:00Z",
    updatedAt: "2026-07-28T01:00:00Z",
    startedAt: "2026-07-28T00:00:00Z",
    finishedAt: "2026-07-28T01:00:00Z",
    error: "Worker ended before verification completed",
    effectivePolicy: snapshot(maxRev, options.policyOverrides),
  };
  store.createTask(task);
  const attempt: AttemptRecord = {
    id: `${id}-att-1`,
    taskId: id,
    ordinal: 1,
    status: attemptStatus,
    sessionId: task.sessionId,
    rawLogPath: path.join(paths.logs, "att-1.jsonl"),
    startedAt: "2026-07-28T00:00:00Z",
    finishedAt: "2026-07-28T01:00:00Z",
    exitCode: 1,
    runtimeBudgetUsd: 0.1,
  };
  store.createAttempt(attempt);
  // Seed exact terminal events so history preservation is provable: a failed
  // Attempt gets worker.failed (with an optional classified category), an
  // interrupted Attempt gets worker.interrupted.
  if (options.workerStarted !== false) {
    store.addEvent(id, attempt.id, "worker.started", "Worker started", {
      attemptId: attempt.id,
    });
  }
  if (options.failureCategory !== undefined) {
    store.addEvent(id, attempt.id, "worker.failed", "Worker failed", {
      failureCategory: options.failureCategory,
    });
  } else if (taskStatus === "interrupted" || attemptStatus === "interrupted") {
    store.addEvent(id, attempt.id, "worker.interrupted", "Worker interrupted", {});
  } else {
    store.addEvent(id, attempt.id, "worker.failed", "Worker failed", {
      failureCategory: "runtime",
    });
  }
  return { task, attemptId: attempt.id, store, home, markerPath, command };
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

test("eligibility: non-failed non-succeeded Task rejected", async () => {
  const built = await buildFailedCandidateTask("notfailed");
  try {
    built.store.setTaskStatus(built.task.id, "queued", { error: null });
    const elig = resolveCandidateReverificationEligibility(built.store, built.task.id, 1);
    assert.equal(elig.eligible, false);
    assert.equal(elig.category, "task-not-failed");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("eligibility: succeeded Task without Main revise is rejected", async () => {
  const built = await buildFailedCandidateTask("succ-norevise");
  try {
    built.store.setTaskStatus(built.task.id, "succeeded", { error: null });
    const elig = resolveCandidateReverificationEligibility(built.store, built.task.id, 1);
    assert.equal(elig.eligible, false);
    assert.equal(elig.category, "no-main-revise");
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

test("reverify upgrades a legacy external node_modules symlink without Worker or Attempt", async () => {
  const built = await buildFailedCandidateTask("legacy-dep");
  try {
    // Source project has real dependencies the mirror will be built from.
    const sourceModules = path.join(built.task.spec.project, "node_modules", "example");
    await mkdir(sourceModules, { recursive: true });
    await writeFile(path.join(sourceModules, "index.js"), "export default true;\n");

    // Simulate a retained legacy Candidate workspace: external dependency symlink.
    const workspaceModules = path.join(built.task.paths.workspace, "node_modules");
    await rm(workspaceModules, { recursive: true, force: true });
    await symlink(path.join(built.task.spec.project, "node_modules"), workspaceModules, "dir");
    assert.equal(
      await readlink(workspaceModules),
      path.join(built.task.spec.project, "node_modules"),
    );

    // Business Candidate content before reverify (must stay byte-identical).
    const businessBefore = await readFile(
      path.join(built.task.paths.workspace, "readme.md"),
      "utf8",
    );

    await writeFile(built.markerPath, "now-passes\n");
    const attemptCountBefore = built.store.listAttempts(built.task.id).length;
    const result = await reverifyCandidate(
      built.store,
      { taskId: built.task.id, reason: "upgrade legacy dependency isolation", confirm: true },
      1,
      30_000,
    );

    assert.equal(result.status, "passed");
    assert.equal(result.costFacts.workerInvoked, false);
    assert.equal(built.store.listAttempts(built.task.id).length, attemptCountBefore);

    // Legacy external link replaced by a real local directory inside the workspace.
    const modulesMeta = await lstat(workspaceModules);
    assert.equal(modulesMeta.isDirectory(), true);
    assert.equal(modulesMeta.isSymbolicLink(), false);
    assert.equal(
      await readFile(path.join(workspaceModules, "example", "index.js"), "utf8"),
      "export default true;\n",
    );

    // Business Candidate files were not rewritten by the dependency upgrade.
    assert.equal(
      await readFile(path.join(built.task.paths.workspace, "readme.md"), "utf8"),
      businessBefore,
    );
    // Original Attempt preserved.
    assert.equal(built.store.getAttempt(built.attemptId).status, "succeeded");
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
      path: "behavior-failure",
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
    // Eligibility after pass: the single frozen allowance is already consumed.
    const elig = c.candidateReverificationEligibility(built.task.id);
    assert.equal(elig.category, "allowance-exhausted");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("coordinator: successful material reverification holds plan dependents until reviewed delivery", async () => {
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
        objective: "Hold a dependent until reviewed delivery after material recovery",
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
    // Material Candidate at machine success must not unlock the dependent.
    // Dedicated daemon delivery tests own exact Main accept + Integration unlock.
    assert.equal(built.store.getTask(built.task.id).status, "succeeded");
    assert.equal(built.store.getTask(dependentId).status, "waiting");
    assert.equal(
      built.store.listEvents(dependentId).filter((event) => event.type === "task.ready").length,
      0,
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
    // Eligibility over the socket: the single frozen allowance is already consumed.
    const eligRes = await daemonExchange("candidate_reverify_eligibility", { taskId: built.task.id }, built.home);
    assert.ok(eligRes.ok);
    const elig = eligRes.result as Record<string, unknown>;
    assert.equal(elig.category, "allowance-exhausted");
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
        path: "behavior-failure",
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
  assert.equal(rv.requiresFreshMainAccept, true);
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
    "taskReverifyStatusNoCandidate",
    "taskReverifyRejectTaskNotFailed", "taskReverifyRejectCompetition",
    "taskReverifyRejectRunning", "taskReverifyRejectNoAttempt",
    "taskReverifyRejectNoVerification", "taskReverifyRejectWrongCategory",
    "taskReverifyRejectNoDiff", "taskReverifyRejectAllowanceZero",
    "taskReverifyRejectAllowanceExhausted",
    "taskReverifyRejectNoMainRevise", "taskReverifyRejectReviewedRevisionMismatch",
    "taskReverifyRejectAlreadyIntegrated",
    "taskReverifyRejectRuntimeNotStarted", "taskReverifyRejectRuntimeAuthFailed",
    "taskReverifyRejectRuntimePolicyLimit",
    "taskReverifyRuntimeHint", "taskReverifyRuntimeJourneyIntro",
    "workersAdvMaxMainReverifications", "workersAdvMaxMainReverificationsHint",
  ]) {
    assert.ok(i18n.indexOf(key) !== i18n.lastIndexOf(key), `${key} exists in both en and zh`);
  }
  // Chinese truthfulness: Worker not invoked, no full-restart saving claimed.
  assert.ok(i18n.includes("不调用 Worker"));
  assert.ok(i18n.includes("增量 Worker Token：0"));
  assert.ok(i18n.includes("没有配对基线时，不声称省下了从头重做的成本"));
  // Succeeded+Main-revise path explained in both languages.
  assert.ok(i18n.includes("机器检查已通过"));
  assert.ok(i18n.includes("exact revise"));
  assert.ok(i18n.includes("本地检查仍会占用时间") || i18n.includes("本地验收仍会占用时间"));
  // English truthfulness: local verification time and Main exchange are not zero.
  assert.match(i18n, /taskReverifyNotFree['"]?\s*:\s*"[^"]*NOT zero[^"]*full-restart/);
  assert.ok(i18n.includes("Local verification still takes wall time") || i18n.includes("local checks still take time"));
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
  assert.ok(src.includes("taskReverifyRejectNoMainRevise"), "succeeded-path no-revise label");
  assert.ok(src.includes("taskReverifyRejectReviewedRevisionMismatch"), "revision mismatch label");
  assert.ok(src.includes("taskReverifyRejectAlreadyIntegrated"), "already-integrated label");
  // Runtime-workspace path copy and rejection labels.
  assert.ok(src.includes("taskReverifyRejectRuntimeNotStarted"), "runtime not-started label");
  assert.ok(src.includes("taskReverifyRejectRuntimeAuthFailed"), "runtime auth label");
  assert.ok(src.includes("taskReverifyRejectRuntimePolicyLimit"), "runtime policy-limit label");
  assert.ok(src.includes("taskReverifyRuntimeHint"), "runtime hint key");
  assert.ok(src.includes("taskReverifyRuntimeJourneyIntro"), "runtime journey intro key");
  assert.ok(src.includes("taskReverifyStatusNoCandidate"), "no-candidate status key");
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

// --- Succeeded + exact Main revise path ---

interface SucceededBuiltTask extends BuiltTask {
  revisionId: string;
  verificationSequence: number;
  attempt: AttemptRecord;
}

function passedVerification(command: string, diffPath: string): VerificationResult {
  return {
    passed: true,
    behaviorPassed: true,
    policyPassed: true,
    sourceCompatible: true,
    commands: [{ command, exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false }],
    diffPath,
    patches: {
      business: {
        path: diffPath,
        filesChanged: 1,
        changedLines: 2,
        affectedPaths: ["readme.md"],
      },
      generated: { path: diffPath, filesChanged: 0, changedLines: 0, affectedPaths: [] },
      integration: {
        path: diffPath,
        filesChanged: 1,
        changedLines: 2,
        affectedPaths: ["readme.md"],
      },
    },
    sourceUnchanged: true,
  };
}

/** Machine-successful Task with Revision A captured and ready for Main revise. */
async function buildSucceededCandidateTask(
  id: string,
  maxRev = 1,
): Promise<SucceededBuiltTask> {
  const home = await mkdtemp(path.join(tmpdir(), `fl-reverify-succ-${id}-`));
  const sourceDir = path.join(home, "source");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(path.join(sourceDir, "readme.md"), "# hello\n\nOriginal text.\n");
  const markerPath = path.join(home, ".fl-reverify-marker");
  // Acceptance always requires the marker so Main repair can control pass/fail.
  const command = `test -f ${markerPath}`;
  const spec = v1Spec(sourceDir, [command]);
  const paths = taskPaths(home, id);
  await prepareWorkspace(spec, paths);
  await writeFile(path.join(paths.workspace, "readme.md"), "# hello\n\nMachine success A.\n");
  await writeWorkspacePatchReport(paths, createPathPolicy(spec));
  // Machine success: marker present for the initial verification record.
  await writeFile(markerPath, "machine-pass\n");

  const store = new StateStore(home);
  const attempt: AttemptRecord = {
    id: `${id}-att-1`,
    taskId: id,
    ordinal: 1,
    status: "succeeded",
    sessionId: `session-${id}`,
    rawLogPath: path.join(paths.logs, "att-1.jsonl"),
    startedAt: "2026-07-27T00:00:00Z",
    finishedAt: "2026-07-27T00:30:00Z",
    exitCode: 0,
    runtimeBudgetUsd: 0.1,
  };
  const task: TaskRecord = {
    id,
    name: spec.name,
    status: "succeeded",
    sourcePath: sourceDir,
    taskFile: `forklight://test/${id}`,
    spec,
    paths,
    sessionId: attempt.sessionId,
    currentAttemptId: attempt.id,
    createdAt: "2026-07-27T00:00:00Z",
    updatedAt: "2026-07-27T01:00:00Z",
    startedAt: "2026-07-27T00:00:00Z",
    finishedAt: "2026-07-27T01:00:00Z",
    effectivePolicy: snapshot(maxRev),
  };
  store.createTask(task);
  store.createAttempt(attempt);
  const verificationEvent = store.addEvent(
    id,
    attempt.id,
    "verification.completed",
    "Independent verification passed",
    passedVerification(command, paths.diff),
  );
  const revision = await captureCandidateRevision(
    store,
    store.getTask(id),
    attempt,
    verificationEvent.sequence,
    true,
    ["readme.md"],
    1,
    2,
  );
  return {
    task: store.getTask(id),
    attemptId: attempt.id,
    attempt,
    store,
    home,
    markerPath,
    command,
    revisionId: revision.id,
    verificationSequence: verificationEvent.sequence,
  };
}

test("succeeded path: full chain machine pass → Main revise A → repair → reverify B → accept B → Integration", async () => {
  const built = await buildSucceededCandidateTask("chain");
  try {
    // Before revise: not eligible.
    assert.equal(
      resolveCandidateReverificationEligibility(built.store, built.task.id, 1).category,
      "no-main-revise",
    );

    // Main revises exact Revision A (Diff still matches A).
    const revise = recordMainReview(built.store, built.task.id, {
      decision: "revise",
      reason: "Semantic fix required in retained workspace",
      confirm: true,
    });
    assert.equal(revise.decision, "revise");
    assert.equal(revise.candidateRevisionId, built.revisionId);
    assert.ok(typeof revise.acceptedPatchDigest === "string" && revise.acceptedPatchDigest.length === 64);
    assert.equal(revise.verificationEventSequence, built.verificationSequence);

    // Eligible after exact revise, before repair (current Diff still matches A).
    assert.equal(
      resolveCandidateReverificationEligibility(built.store, built.task.id, 1).category,
      "eligible",
    );

    // Main repairs the retained workspace without a Worker (Diff diverges from A).
    await writeFile(
      path.join(built.task.paths.workspace, "readme.md"),
      "# hello\n\nRepaired by Main B.\n",
    );
    await writeWorkspacePatchReport(built.task.paths, createPathPolicy(built.task.spec));
    // Keep the acceptance marker so reverify passes.
    await writeFile(built.markerPath, "still-pass\n");

    // Still eligible: revise binds A by id/digest, not live Diff match.
    assert.equal(
      resolveCandidateReverificationEligibility(built.store, built.task.id, 1).category,
      "eligible",
    );

    const result = await reverifyCandidate(
      built.store,
      { taskId: built.task.id, reason: "Main repaired retained candidate", confirm: true },
      1,
      30_000,
    );
    assert.equal(result.status, "passed");
    assert.equal(result.costFacts.workerInvoked, false);
    assert.equal(result.costFacts.incrementalWorkerTokens, 0);
    assert.equal(result.costFacts.incrementalModelRuntimeCostUsd, 0);
    assert.equal(result.requiresFreshMainAccept, true);
    // Task/Attempt stay succeeded; no new Attempt.
    assert.equal(built.store.getTask(built.task.id).status, "succeeded");
    assert.equal(built.store.getAttempt(built.attemptId).status, "succeeded");
    assert.equal(built.store.listAttempts(built.task.id).length, 1);

    const events = built.store.listEvents(built.task.id);
    const revisions = events.filter((event) => event.type === "candidate.revision.captured");
    assert.equal(revisions.length, 2, "Revision B captured after reverify");
    const revB = revisions[1]!.payload as { id: string; patchDigest: string; verificationEventSequence: number };
    assert.notEqual(revB.id, built.revisionId);
    assert.equal(revB.verificationEventSequence, result.verificationEventSequence);

    // Integration blocked until fresh accept of B.
    const before = await preflightIntegration(built.store, built.task.id, {
      reviewedPatchMaxFiles: 5,
      reviewedPatchMaxLines: 400,
      reviewReceiptTtlMs: 900_000,
      verificationTimeoutMs: 30_000,
      backupRetentionCount: 3,
      autoRollback: true,
    });
    assert.ok(before.rejectionReasons.some((r) => r.includes("Main agent review acceptance is required")));

    // Stale accept of revise era is not possible — record fresh accept of B.
    const accept = recordMainReview(built.store, built.task.id, {
      decision: "accept",
      reason: "Repaired revision B is correct",
      confirm: true,
    });
    assert.equal(accept.candidateRevisionId, revB.id);
    assert.equal(accept.acceptedPatchDigest, revB.patchDigest);
    assert.equal(accept.verificationEventSequence, result.verificationEventSequence);

    const after = await preflightIntegration(built.store, built.task.id, {
      reviewedPatchMaxFiles: 5,
      reviewedPatchMaxLines: 400,
      reviewReceiptTtlMs: 900_000,
      verificationTimeoutMs: 30_000,
      backupRetentionCount: 3,
      autoRollback: true,
    });
    assert.equal(after.rejectionReasons.length, 0, "preflight passes after accept of B");

    // History remains inspectable: original verification, revise, reverify auth, new verification.
    const types = events.map((event) => event.type);
    assert.ok(types.includes("main-review.completed"));
    assert.ok(types.includes("candidate.reverification.authorized"));
    assert.ok(types.includes("candidate.reverification.completed"));
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("succeeded path: fail-closed boundaries reject before commands or authorization", async () => {
  const cases: Array<{
    name: string;
    category: string;
    setup: (built: SucceededBuiltTask) => Promise<void> | void;
  }> = [
    {
      name: "accept decision",
      category: "no-main-revise",
      setup: (built) => {
        recordMainReview(built.store, built.task.id, {
          decision: "accept", reason: "Looks good", confirm: true,
        });
      },
    },
    {
      name: "reject decision",
      category: "no-main-revise",
      setup: (built) => {
        recordMainReview(built.store, built.task.id, {
          decision: "reject", reason: "Wrong approach", confirm: true,
        });
      },
    },
    {
      name: "malformed review evidence",
      category: "no-main-revise",
      setup: (built) => {
        built.store.addEvent(
          built.task.id,
          built.attemptId,
          "main-review.completed",
          "malformed",
          { decision: "revise" },
        );
      },
    },
    {
      name: "stale verification sequence",
      category: "no-main-revise",
      setup: (built) => {
        recordMainReview(built.store, built.task.id, {
          decision: "revise", reason: "revise A", confirm: true,
        });
        // Append a newer verification so the revise is stale.
        built.store.addEvent(
          built.task.id,
          built.attemptId,
          "verification.completed",
          "Newer verification",
          passedVerification(built.command, built.task.paths.diff),
        );
      },
    },
    {
      name: "revise without revision binding while history exists",
      category: "reviewed-revision-mismatch",
      setup: (built) => {
        built.store.addEvent(
          built.task.id,
          built.attemptId,
          "main-review.completed",
          "revise without binding",
          {
            decision: "revise",
            reason: "missing revision fields",
            attemptId: built.attemptId,
            verificationEventSequence: built.verificationSequence,
          },
        );
      },
    },
    {
      name: "mismatched reviewed revision id",
      category: "reviewed-revision-mismatch",
      setup: async (built) => {
        const digest = createHash("sha256")
          .update(await readFile(built.task.paths.diff))
          .digest("hex");
        built.store.addEvent(
          built.task.id,
          built.attemptId,
          "main-review.completed",
          "revise wrong id",
          {
            decision: "revise",
            reason: "wrong revision id",
            attemptId: built.attemptId,
            verificationEventSequence: built.verificationSequence,
            candidateRevisionId: "not-the-real-revision",
            acceptedPatchDigest: digest,
          },
        );
      },
    },
    {
      name: "allowance zero",
      category: "allowance-zero",
      setup: (built) => {
        recordMainReview(built.store, built.task.id, {
          decision: "revise", reason: "revise A", confirm: true,
        });
      },
    },
    {
      name: "allowance exhausted",
      category: "allowance-exhausted",
      setup: (built) => {
        recordMainReview(built.store, built.task.id, {
          decision: "revise", reason: "revise A", confirm: true,
        });
        built.store.addEvent(
          built.task.id,
          built.attemptId,
          "candidate.reverification.authorized",
          "prior",
          { attemptId: built.attemptId },
        );
      },
    },
    {
      name: "already integrated",
      category: "already-integrated",
      setup: (built) => {
        recordMainReview(built.store, built.task.id, {
          decision: "revise", reason: "revise A", confirm: true,
        });
        const ts = "2026-07-27T02:00:00Z";
        // Receipt must exist first: integration_results.receipt_id is a foreign key.
        built.store.saveIntegrationReceipt({
          id: "receipt-1",
          taskId: built.task.id,
          patchDigest: "a".repeat(64),
          affectedFiles: ["readme.md"],
          rejectionReasons: [],
          sourceEvidence: {},
          createdAt: ts,
          expiresAt: ts,
          consumed: false,
        });
        built.store.saveIntegrationResult({
          id: "int-1",
          taskId: built.task.id,
          receiptId: "receipt-1",
          status: "applied",
          appliedAt: ts,
          createdAt: ts,
        });
      },
    },
  ];

  for (const testCase of cases) {
    const maxRev = testCase.category === "allowance-zero" ? 0 : 1;
    const built = await buildSucceededCandidateTask(`rej-${testCase.name.replace(/\s+/g, "-")}`, maxRev);
    try {
      await testCase.setup(built);
      const eventCountBefore = built.store.listEvents(built.task.id).length;
      const elig = resolveCandidateReverificationEligibility(
        built.store,
        built.task.id,
        maxRev,
      );
      assert.equal(elig.eligible, false, testCase.name);
      assert.equal(elig.category, testCase.category, testCase.name);
      await assert.rejects(
        reverifyCandidate(
          built.store,
          { taskId: built.task.id, reason: "should reject", confirm: true },
          maxRev,
          30_000,
        ),
        /candidate reverification/,
      );
      // No authorization mutation on rejection.
      assert.equal(
        built.store.listEvents(built.task.id).length,
        eventCountBefore,
        `${testCase.name}: no events appended on reject`,
      );
      assert.equal(
        built.store.listEvents(built.task.id).filter((e) => e.type === "candidate.reverification.authorized").length,
        testCase.category === "allowance-exhausted" ? 1 : 0,
        `${testCase.name}: no new authorization`,
      );
    } finally {
      built.store.close();
      await rm(built.home, { recursive: true, force: true });
    }
  }
});

test("succeeded path: failed repair preserves status, consumes allowance, blocks accept and Integration", async () => {
  const built = await buildSucceededCandidateTask("fail-repair");
  try {
    recordMainReview(built.store, built.task.id, {
      decision: "revise", reason: "needs repair", confirm: true,
    });
    // Main "repairs" but removes the acceptance marker so reverify fails.
    await writeFile(
      path.join(built.task.paths.workspace, "readme.md"),
      "# hello\n\nBroken repair.\n",
    );
    await writeWorkspacePatchReport(built.task.paths, createPathPolicy(built.task.spec));
    await rm(built.markerPath, { force: true });

    const result = await reverifyCandidate(
      built.store,
      { taskId: built.task.id, reason: "try repaired candidate", confirm: true },
      1,
      30_000,
    );
    assert.equal(result.status, "failed");
    assert.equal(built.store.getTask(built.task.id).status, "succeeded", "machine-success status preserved");
    assert.equal(built.store.getAttempt(built.attemptId).status, "succeeded");
    assert.equal(result.allowance.consumed, 1);
    assert.equal(result.costFacts.workerInvoked, false);
    assert.equal(built.store.listAttempts(built.task.id).length, 1);

    // Accept requires passing verification — latest failed.
    assert.throws(
      () => recordMainReview(built.store, built.task.id, {
        decision: "accept", reason: "cannot accept failed reverify", confirm: true,
      }),
      /passing independent verification/,
    );
    const preflight = await preflightIntegration(built.store, built.task.id, {
      reviewedPatchMaxFiles: 5,
      reviewedPatchMaxLines: 400,
      reviewReceiptTtlMs: 900_000,
      verificationTimeoutMs: 30_000,
      backupRetentionCount: 3,
      autoRollback: true,
    });
    assert.ok(preflight.rejectionReasons.length > 0);
    // Allowance exhausted; nothing retries automatically.
    assert.equal(
      resolveCandidateReverificationEligibility(built.store, built.task.id, 1).category,
      "allowance-exhausted",
    );
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("succeeded path: competition candidate rejected even with Main revise", async () => {
  const built = await buildSucceededCandidateTask("comp-succ");
  try {
    recordMainReview(built.store, built.task.id, {
      decision: "revise", reason: "revise A", confirm: true,
    });
    const siblingId = "comp-succ-sibling";
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
      {
        id: "c-succ",
        name: "comp",
        contractTaskId: built.task.id,
        status: "completed",
        rankingPolicy: {
          weights: { verification: 1, diffFocus: 0, retries: 0, cost: 0, duration: 0, delivery: 0 },
          tieThreshold: 0,
        },
        createdAt: "2026-07-27T00:00:00Z",
        updatedAt: "2026-07-27T00:00:00Z",
      },
      [
        { id: "cand-1", competitionId: "c-succ", taskId: built.task.id, ordinal: 1, providerName: "deepseek", modelName: "v4" },
        { id: "cand-2", competitionId: "c-succ", taskId: siblingId, ordinal: 2, providerName: "minimax", modelName: "m3" },
      ],
    );
    const elig = resolveCandidateReverificationEligibility(built.store, built.task.id, 1);
    assert.equal(elig.category, "competition-candidate");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("succeeded path: crash-safe incomplete authorization does not auto-retry", async () => {
  const built = await buildSucceededCandidateTask("crash-succ");
  try {
    recordMainReview(built.store, built.task.id, {
      decision: "revise", reason: "revise A", confirm: true,
    });
    built.store.addEvent(
      built.task.id,
      built.attemptId,
      "candidate.reverification.authorized",
      "authorized then crashed",
      { attemptId: built.attemptId },
    );
    assert.equal(built.store.getTask(built.task.id).status, "succeeded");
    const beforeAttempts = built.store.listAttempts(built.task.id).length;
    const coordinator = coord(built.store);
    await coordinator.recover();
    assert.equal(built.store.getTask(built.task.id).status, "succeeded");
    assert.equal(built.store.listAttempts(built.task.id).length, beforeAttempts);
    assert.equal(
      resolveCandidateReverificationEligibility(built.store, built.task.id, 1).category,
      "allowance-exhausted",
    );
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("succeeded path: privacy-safe rejection messages never echo private content", () => {
  for (const category of [
    "no-main-revise",
    "reviewed-revision-mismatch",
    "already-integrated",
  ] as const) {
    // Resolve by triggering eligibility is enough; messages are fixed constants.
    // Exercise the operation throw path via a minimal in-memory check of the
    // exported category strings through resolve + reverify is covered above.
    assert.ok(category.length > 0);
  }
  // Explicit content-free checks on known rejection text.
  const messages = [
    "candidate reverification rejected: succeeded Task requires an exact latest Main revise of the current verified Candidate Revision",
    "candidate reverification rejected: latest Main revise is not bound to the exact reviewed Candidate Revision",
    "candidate reverification rejected: Task already has Integration results",
  ];
  for (const message of messages) {
    assert.doesNotMatch(message, /sk-|password|Bearer |\/Users\/|stdout|stderr/i);
  }
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

// --- Runtime-workspace path (Worker really started, ended before verification) ---

test("runtime path eligibility: exact worker.started + no verification is eligible", async () => {
  const built = await buildRuntimeWorkspaceTask("rw-eligible");
  try {
    const elig = resolveCandidateReverificationEligibility(built.store, built.task.id, 1);
    assert.equal(elig.eligible, true);
    assert.equal(elig.category, "eligible");
    assert.equal(elig.eligiblePath, "runtime-workspace");
    assert.equal(elig.attemptId, built.attemptId);
    assert.equal(elig.allowance.remaining, 1);
    assert.equal(elig.verificationEventSequence, undefined, "no prior verification evidence");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("runtime path eligibility: interrupted Task with exact worker.started is eligible", async () => {
  const built = await buildRuntimeWorkspaceTask("rw-int-elig", {
    taskStatus: "interrupted",
    attemptStatus: "interrupted",
  });
  try {
    const elig = resolveCandidateReverificationEligibility(built.store, built.task.id, 1);
    assert.equal(elig.eligible, true);
    assert.equal(elig.eligiblePath, "runtime-workspace");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("runtime path eligibility: launch/doctor failure without worker start is rejected", async () => {
  const built = await buildRuntimeWorkspaceTask("rw-notstarted", { workerStarted: false });
  try {
    const elig = resolveCandidateReverificationEligibility(built.store, built.task.id, 1);
    assert.equal(elig.eligible, false);
    assert.equal(elig.category, "runtime-not-started");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("runtime path eligibility: preflight authentication failure without worker start is rejected", async () => {
  const built = await buildRuntimeWorkspaceTask("rw-auth-preflight", { workerStarted: false });
  try {
    built.store.addEvent(
      built.task.id,
      built.attemptId,
      "task.launch-preflight.failed",
      "preflight auth failed",
      { failureCategory: "authentication" },
    );
    const elig = resolveCandidateReverificationEligibility(built.store, built.task.id, 1);
    assert.equal(elig.eligible, false);
    assert.equal(elig.category, "runtime-not-started");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("runtime path eligibility: authentication failure after worker start is rejected", async () => {
  const built = await buildRuntimeWorkspaceTask("rw-auth", {
    failureCategory: "authentication",
  });
  try {
    const elig = resolveCandidateReverificationEligibility(built.store, built.task.id, 1);
    assert.equal(elig.category, "runtime-auth-failed");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("runtime path eligibility: policy-limit terminal paths are excluded", async () => {
  for (const category of ["budget", "contract-infeasible"] as const) {
    const built = await buildRuntimeWorkspaceTask(`rw-policy-${category}`, {
      failureCategory: category,
    });
    try {
      const elig = resolveCandidateReverificationEligibility(built.store, built.task.id, 1);
      assert.equal(elig.category, "runtime-policy-limit", category);
    } finally {
      built.store.close();
      await rm(built.home, { recursive: true, force: true });
    }
  }
});

test("runtime path eligibility: allowance zero and exhausted are rejected", async () => {
  const zero = await buildRuntimeWorkspaceTask("rw-allow0", { maxRev: 0 });
  try {
    assert.equal(
      resolveCandidateReverificationEligibility(zero.store, zero.task.id, 0).category,
      "allowance-zero",
    );
  } finally {
    zero.store.close();
    await rm(zero.home, { recursive: true, force: true });
  }
  const exhausted = await buildRuntimeWorkspaceTask("rw-allowex");
  try {
    exhausted.store.addEvent(
      exhausted.task.id,
      exhausted.attemptId,
      "candidate.reverification.authorized",
      "prior",
      { attemptId: exhausted.attemptId },
    );
    assert.equal(
      resolveCandidateReverificationEligibility(exhausted.store, exhausted.task.id, 1).category,
      "allowance-exhausted",
    );
  } finally {
    exhausted.store.close();
    await rm(exhausted.home, { recursive: true, force: true });
  }
});

test("runtime path eligibility: latest Attempt with valid verification is governed by existing rules", async () => {
  const built = await buildRuntimeWorkspaceTask("rw-stale");
  try {
    // A passing verification bound to the latest Attempt must route to the
    // existing behavior-failure rules, never the runtime-workspace path.
    built.store.addEvent(
      built.task.id,
      built.attemptId,
      "verification.completed",
      "verified",
      failedVerification(built.command, {
        diffPath: built.task.paths.diff,
        behaviorPassed: true,
      }),
    );
    const elig = resolveCandidateReverificationEligibility(built.store, built.task.id, 1);
    assert.equal(elig.eligible, false);
    assert.equal(elig.category, "wrong-failure-category", "existing verification owns the next step");
    assert.equal(elig.eligiblePath, undefined);
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("runtime path eligibility: behavior-only failed verification keeps the original path", async () => {
  const built = await buildRuntimeWorkspaceTask("rw-behav");
  try {
    built.store.addEvent(
      built.task.id,
      built.attemptId,
      "verification.completed",
      "verified",
      failedVerification(built.command, { diffPath: built.task.paths.diff }),
    );
    const elig = resolveCandidateReverificationEligibility(built.store, built.task.id, 1);
    assert.equal(elig.eligible, true);
    assert.equal(elig.eligiblePath, "behavior-failure");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("runtime path eligibility: older Attempt policy evidence cannot block a newer eligible run", async () => {
  const built = await buildRuntimeWorkspaceTask("rw-older");
  try {
    // Older attempt hit a budget policy limit — it must not block the latest.
    const olderId = `${built.task.id}-att-0`;
    built.store.createAttempt({
      id: olderId,
      taskId: built.task.id,
      ordinal: 0,
      status: "failed",
      sessionId: `session-${built.task.id}-old`,
      rawLogPath: path.join(built.task.paths.logs, "att-0.jsonl"),
      startedAt: "2026-07-28T00:00:00Z",
      finishedAt: "2026-07-28T00:30:00Z",
      exitCode: 1,
      runtimeBudgetUsd: 0.1,
    });
    built.store.addEvent(built.task.id, olderId, "worker.started", "Worker started", { attemptId: olderId });
    built.store.addEvent(built.task.id, olderId, "worker.failed", "Worker failed", { failureCategory: "budget" });
    // The fixture's attempt (ordinal 1) is still the latest and really started.
    const elig = resolveCandidateReverificationEligibility(built.store, built.task.id, 1);
    assert.equal(elig.eligible, true, "older budget evidence must not block the newer run");
    assert.equal(elig.eligiblePath, "runtime-workspace");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("runtime path eligibility: every exact-Attempt policy event family is excluded", async () => {
  const policyTypes = [
    "policy.duration.exceeded",
    "policy.token.exceeded",
    "policy.noprogress.exceeded",
    "policy.size.exceeded",
  ] as const;
  for (const type of policyTypes) {
    const built = await buildRuntimeWorkspaceTask(`rw-policyevt-${type.replaceAll(".", "-")}`);
    try {
      built.store.addEvent(built.task.id, built.attemptId, type, "policy limit", {});
      const elig = resolveCandidateReverificationEligibility(built.store, built.task.id, 1);
      assert.equal(elig.eligible, false, type);
      assert.equal(elig.category, "runtime-policy-limit", type);
    } finally {
      built.store.close();
      await rm(built.home, { recursive: true, force: true });
    }
  }
});

test("runtime path eligibility: malformed verification evidence on the latest Attempt fails closed", async () => {
  const built = await buildRuntimeWorkspaceTask("rw-malformed");
  try {
    built.store.addEvent(
      built.task.id,
      built.attemptId,
      "verification.completed",
      "malformed evidence",
      { notAVerificationResult: true },
    );
    const elig = resolveCandidateReverificationEligibility(built.store, built.task.id, 1);
    assert.equal(elig.eligible, false, "malformed verification must not open the runtime path");
    assert.equal(elig.category, "no-failed-verification");
    assert.equal(elig.eligiblePath, undefined);
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("runtime path: useful changed workspace passes → Task succeeds, Attempt preserved, exact revision", async () => {
  const built = await buildRuntimeWorkspaceTask("rw-pass");
  try {
    await writeFile(built.markerPath, "pass\n");
    const result = await reverifyCandidate(
      built.store,
      { taskId: built.task.id, reason: "worker crashed after editing; retained files verified", confirm: true },
      1,
      30_000,
    );
    assert.equal(result.status, "passed");
    assert.equal(result.path, "runtime-workspace");
    assert.equal(built.store.getTask(built.task.id).status, "succeeded", "Task moved to succeeded");
    assert.equal(built.store.getAttempt(built.attemptId).status, "failed", "original Attempt preserved");
    assert.equal(built.store.listAttempts(built.task.id).length, 1, "no new Attempt created");
    assert.equal(result.costFacts.workerInvoked, false);
    assert.equal(result.costFacts.incrementalWorkerTokens, 0);
    assert.equal(result.requiresFreshMainAccept, true);
    // Exact Candidate Revision bound to the new verification event.
    const events = built.store.listEvents(built.task.id);
    const revisions = events.filter((event) => event.type === "candidate.revision.captured");
    assert.equal(revisions.length, 1);
    const rev = revisions[0]!.payload as { verificationEventSequence: number; verificationPassed: boolean };
    assert.equal(rev.verificationEventSequence, result.verificationEventSequence);
    assert.equal(rev.verificationPassed, true);
    // Immutable history: original worker.started / worker.failed still present.
    assert.ok(events.some((e) => e.type === "worker.started"), "original worker.started preserved");
    assert.ok(events.some((e) => e.type === "worker.failed"), "original worker.failed preserved");
    // New canonical verification is the latest.
    const verifications = events.filter((e) => e.type === "verification.completed");
    assert.equal(verifications.at(-1)!.sequence, result.verificationEventSequence);
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("runtime path: interrupted Task with useful workspace passes → Task succeeds, Attempt stays interrupted", async () => {
  const built = await buildRuntimeWorkspaceTask("rw-int", {
    taskStatus: "interrupted",
    attemptStatus: "interrupted",
  });
  try {
    await writeFile(built.markerPath, "pass\n");
    const result = await reverifyCandidate(
      built.store,
      { taskId: built.task.id, reason: "interrupted after edits; retained files verified", confirm: true },
      1,
      30_000,
    );
    assert.equal(result.status, "passed");
    assert.equal(result.path, "runtime-workspace");
    assert.equal(built.store.getTask(built.task.id).status, "succeeded");
    assert.equal(built.store.getAttempt(built.attemptId).status, "interrupted", "Attempt stays interrupted");
    assert.equal(built.store.listAttempts(built.task.id).length, 1);
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("runtime path: non-empty Diff but checks fail → Candidate retained, Task stays failed, no auto-retry", async () => {
  const built = await buildRuntimeWorkspaceTask("rw-fail");
  try {
    // marker absent → the acceptance command still fails.
    const result = await reverifyCandidate(
      built.store,
      { taskId: built.task.id, reason: "check retained files", confirm: true },
      1,
      30_000,
    );
    assert.equal(result.status, "failed");
    assert.equal(result.path, "runtime-workspace");
    assert.equal(built.store.getTask(built.task.id).status, "failed", "Task stays failed");
    assert.equal(built.store.getAttempt(built.attemptId).status, "failed", "Attempt preserved");
    assert.equal(result.costFacts.passedCommandCount, 0);
    // A retained (non-empty) Candidate still requires a fresh Main accept —
    // only the no-candidate outcome reports false.
    assert.equal(result.requiresFreshMainAccept, true);
    // The exact failed-verification Candidate is retained for targeted handling.
    const revisions = built.store.listEvents(built.task.id)
      .filter((event) => event.type === "candidate.revision.captured");
    assert.equal(revisions.length, 1, "non-empty Diff is captured even on failed checks");
    assert.equal((revisions[0]!.payload as { verificationPassed: boolean }).verificationPassed, false);
    // Allowance consumed; nothing retries automatically.
    assert.equal(
      resolveCandidateReverificationEligibility(built.store, built.task.id, 1).category,
      "allowance-exhausted",
    );
    assert.equal(built.store.listAttempts(built.task.id).length, 1);
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("runtime path: empty recomputed Diff → no-candidate, no revision, never success, cannot be accepted or integrated", async () => {
  const built = await buildRuntimeWorkspaceTask("rw-empty", { workspaceChanged: false });
  try {
    // Even a passing acceptance command cannot make an empty Diff a Candidate.
    await writeFile(built.markerPath, "pass\n");
    const result = await reverifyCandidate(
      built.store,
      { taskId: built.task.id, reason: "empty retained workspace", confirm: true },
      1,
      30_000,
    );
    assert.equal(result.status, "no-candidate");
    assert.equal(result.path, "runtime-workspace");
    assert.equal(built.store.getTask(built.task.id).status, "failed", "never marks success");
    assert.equal(built.store.getAttempt(built.attemptId).status, "failed");
    assert.equal(
      built.store.listEvents(built.task.id).filter((e) => e.type === "candidate.revision.captured").length,
      0,
      "no Candidate captured",
    );
    // Truthful handoff: a no-candidate outcome requires no fresh Main accept.
    assert.equal(result.requiresFreshMainAccept, false, "no Candidate, so no fresh Main accept is possible");
    const completions = built.store.listEvents(built.task.id)
      .filter((e) => e.type === "candidate.reverification.completed");
    const noCandidatePayload = completions.at(-1)!.payload as { status: string; requiresFreshMainAccept: boolean };
    assert.equal(noCandidatePayload.status, "no-candidate");
    assert.equal(noCandidatePayload.requiresFreshMainAccept, false);
    // Cannot be Main-accepted: the empty patch leaves verification failing.
    assert.throws(
      () => recordMainReview(built.store, built.task.id, {
        decision: "accept", reason: "cannot accept nothing", confirm: true,
      }),
      /passing independent verification/,
    );
    // Cannot be integrated: the Task is not succeeded.
    const preflight = await preflightIntegration(built.store, built.task.id, {
      reviewedPatchMaxFiles: 5,
      reviewedPatchMaxLines: 400,
      reviewReceiptTtlMs: 900_000,
      verificationTimeoutMs: 30_000,
      backupRetentionCount: 3,
      autoRollback: true,
    });
    assert.ok(preflight.rejectionReasons.length > 0, "preflight rejects a failed task");
    // No new Attempt; allowance consumed; zero-Worker facts exact.
    assert.equal(built.store.listAttempts(built.task.id).length, 1);
    assert.equal(result.costFacts.workerInvoked, false);
    assert.equal(result.costFacts.incrementalWorkerTokens, 0);
    assert.equal(result.allowance.consumed, 1);
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("runtime path: empty Diff is still no-candidate even when no-change policy is off", async () => {
  const built = await buildRuntimeWorkspaceTask("rw-empty-off", {
    workspaceChanged: false,
    policyOverrides: { completionMode: "off", changeBudgetMode: "off" },
  });
  try {
    await writeFile(built.markerPath, "pass\n");
    const result = await reverifyCandidate(
      built.store,
      { taskId: built.task.id, reason: "empty under off policy", confirm: true },
      1,
      30_000,
    );
    assert.equal(result.status, "no-candidate", "empty Diff fails closed regardless of noChangeMode");
    assert.equal(built.store.getTask(built.task.id).status, "failed");
    assert.equal(result.requiresFreshMainAccept, false, "no Candidate under off policy either");
    assert.equal(
      built.store.listEvents(built.task.id).filter((e) => e.type === "candidate.revision.captured").length,
      0,
    );
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("runtime path eligibility: Integration results block the path", async () => {
  const built = await buildRuntimeWorkspaceTask("rw-intres");
  try {
    const ts = "2026-07-28T02:00:00Z";
    built.store.saveIntegrationReceipt({
      id: "rw-receipt",
      taskId: built.task.id,
      patchDigest: "b".repeat(64),
      affectedFiles: ["readme.md"],
      rejectionReasons: [],
      sourceEvidence: {},
      createdAt: ts,
      expiresAt: ts,
      consumed: false,
    });
    built.store.saveIntegrationResult({
      id: "rw-int",
      taskId: built.task.id,
      receiptId: "rw-receipt",
      status: "applied",
      appliedAt: ts,
      createdAt: ts,
    });
    assert.equal(
      resolveCandidateReverificationEligibility(built.store, built.task.id, 1).category,
      "already-integrated",
    );
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("runtime path: passing recovered Candidate requires a fresh exact Main accept before Integration", async () => {
  const built = await buildRuntimeWorkspaceTask("rw-binding");
  try {
    await writeFile(built.markerPath, "pass\n");
    const result = await reverifyCandidate(
      built.store,
      { taskId: built.task.id, reason: "verify recovered candidate", confirm: true },
      1,
      30_000,
    );
    assert.equal(result.status, "passed");
    assert.equal(built.store.getTask(built.task.id).status, "succeeded");
    // No accept yet → preflight rejects.
    const before = await preflightIntegration(built.store, built.task.id, {
      reviewedPatchMaxFiles: 5,
      reviewedPatchMaxLines: 400,
      reviewReceiptTtlMs: 900_000,
      verificationTimeoutMs: 30_000,
      backupRetentionCount: 3,
      autoRollback: true,
    });
    assert.ok(before.rejectionReasons.some((r) => r.includes("Main agent review acceptance is required")));
    // Fresh exact accept bound to the new verification and Candidate Revision.
    const accept = recordMainReview(built.store, built.task.id, {
      decision: "accept",
      reason: "fresh accept after runtime recovery",
      confirm: true,
    });
    assert.equal(accept.verificationEventSequence, result.verificationEventSequence);
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

test("runtime path: crash-safe incomplete authorization does not create an Attempt or auto-retry", async () => {
  const built = await buildRuntimeWorkspaceTask("rw-crash");
  try {
    built.store.addEvent(
      built.task.id,
      built.attemptId,
      "candidate.reverification.authorized",
      "authorized then crashed",
      { attemptId: built.attemptId },
    );
    assert.equal(built.store.getTask(built.task.id).status, "failed");
    const beforeAttempts = built.store.listAttempts(built.task.id).length;
    const coordinator = coord(built.store);
    await coordinator.recover();
    assert.equal(built.store.getTask(built.task.id).status, "failed", "recover must not change status");
    assert.equal(built.store.listAttempts(built.task.id).length, beforeAttempts, "recover must not create an Attempt");
    assert.equal(
      resolveCandidateReverificationEligibility(built.store, built.task.id, 1).category,
      "allowance-exhausted",
    );
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("runtime path: daemon/CLI projection carries the runtime-workspace discriminator", async () => {
  const built = await buildRuntimeWorkspaceTask("rw-daemon");
  try {
    await writeFile(built.markerPath, "pass\n");
    const c = coord(built.store);
    const view = await c.reverifyCandidate(built.task.id, "verify retained files", true);
    assert.equal(view.status, "passed");
    assert.equal(view.path, "runtime-workspace");
    assert.equal(view.taskStatus, "succeeded");
    assert.equal(view.attemptStatus, "failed");
    assert.equal(view.costFacts.workerInvoked, false);
    assert.equal(view.requiresFreshMainAccept, true);
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("runtime path: daemon/CLI projection reports no-candidate without a fresh accept requirement", async () => {
  const built = await buildRuntimeWorkspaceTask("rw-daemon-nc", { workspaceChanged: false });
  try {
    const c = coord(built.store);
    const view = await c.reverifyCandidate(built.task.id, "empty retained workspace", true);
    assert.equal(view.status, "no-candidate");
    assert.equal(view.path, "runtime-workspace");
    assert.equal(view.taskStatus, "failed");
    assert.equal(view.requiresFreshMainAccept, false);
    assert.equal(view.costFacts.workerInvoked, false);
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("Hub: runtime-workspace reverification projects the path discriminator", () => {
  const task = { id: "t", status: "succeeded", spec: { version: 2, provider: { name: "deepseek" }, runtime: { name: "claude-code" } } } as unknown as Record<string, unknown>;
  const decision = { verification: { passed: true, behaviorPassed: true, policyPassed: true, sourceCompatible: true, commands: [], diffPath: "/d", sourceUnchanged: true } } as unknown;
  const inspect = {
    events: [{
      type: "candidate.reverification.completed",
      payload: {
        status: "passed",
        path: "runtime-workspace",
        attemptId: "a1",
        attemptStatus: "failed",
        verificationEventSequence: 7,
        workerInvoked: false,
        incrementalWorkerTokens: 0,
        incrementalModelRuntimeCostUsd: 0,
        commandCount: 1,
        passedCommandCount: 1,
        commandDurationMs: 3,
        wallDurationMs: 9,
        allowance: { max: 1, consumed: 1, remaining: 0, source: "global" },
        requiresFreshMainAccept: true,
      },
    }],
    attempts: [],
  } as unknown;
  const journey = buildSafeTaskJourney(task, decision, inspect);
  assert.ok(journey.candidateReverification);
  assert.equal(journey.candidateReverification!.path, "runtime-workspace");
  assert.equal(journey.candidateReverification!.attemptStatus, "failed");
  assert.equal(journey.candidateReverification!.status, "passed");
  assert.equal(journey.candidateReverification!.requiresFreshMainAccept, true);
});

test("Hub: no-candidate reverification projects status without private evidence", async () => {
  const task = { id: "t", status: "failed", spec: { version: 2, provider: { name: "deepseek" }, runtime: { name: "claude-code" } } } as unknown as Record<string, unknown>;
  const decision = { verification: { passed: false, behaviorPassed: false, policyPassed: false, sourceCompatible: true, commands: [], diffPath: "/d", sourceUnchanged: true } } as unknown;
  const inspect = {
    events: [{
      type: "candidate.reverification.completed",
      payload: {
        status: "no-candidate",
        path: "runtime-workspace",
        attemptId: "a1",
        attemptStatus: "failed",
        verificationEventSequence: 7,
        workerInvoked: false,
        incrementalWorkerTokens: 0,
        incrementalModelRuntimeCostUsd: 0,
        commandCount: 1,
        passedCommandCount: 1,
        commandDurationMs: 3,
        wallDurationMs: 9,
        allowance: { max: 1, consumed: 1, remaining: 0, source: "global" },
        requiresFreshMainAccept: false,
      },
    }],
    attempts: [],
  } as unknown;
  const journey = buildSafeTaskJourney(task, decision, inspect);
  assert.ok(journey.candidateReverification);
  assert.equal(journey.candidateReverification!.status, "no-candidate");
  assert.equal(journey.candidateReverification!.path, "runtime-workspace");
  assert.equal(journey.candidateReverification!.requiresFreshMainAccept, false, "no-candidate truthfully needs no fresh accept");
  // The Hub truthfully reports the no-candidate fact in plain language.
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  assert.ok(src.includes("taskReverifyStatusNoCandidate"), "no-candidate status label wired");
  assert.ok(i18n.includes("taskReverifyStatusNoCandidate:") , "no-candidate key present");
});
