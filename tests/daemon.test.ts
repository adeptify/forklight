import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type {
  DependencyRecord,
  PlanItemRecord,
  PlanRecord,
  TaskRecord,
  TaskStatus,
  VerificationResult,
} from "../src/core/types.js";
import type { PlanBoard, PlanBoardSummary } from "../src/core/board.js";
import {
  DAEMON_STARTUP_CHILD_EXITED_MESSAGE,
  DAEMON_STARTUP_TIMEOUT_MESSAGE,
  DEFAULT_DAEMON_STARTUP_TIMEOUT_MS,
  daemonExchange,
  daemonLaunchArguments,
  daemonRequest,
  daemonRequestTimeoutMs,
  ensureDaemon,
  resolveDaemonStartupTimeoutMs,
  routeMutation,
  stopDaemon,
  stopDaemonForHandoff,
  type DaemonChildHandle,
} from "../src/daemon/client.js";
import { requiresMatchingBuildIdentity } from "../src/daemon/protocol.js";
import { daemonSocketPath } from "../src/core/config.js";
import { DetachedDaemonFixture } from "./helpers/detached-daemon.js";
import { DaemonCoordinator, probeProvidersBounded } from "../src/daemon/coordinator.js";
import { assertWorkPlan } from "../src/core/plan.js";
import { buildTaskRecord, checkReviseEligibility, executeAttempt, prepareTaskWorkspace, registerTaskFromSpec } from "../src/core/runner.js";
import { parseTaskSpec } from "../src/core/task.js";
import { ForkLightDaemon } from "../src/daemon/server.js";
import { SettingsService, type ForkLightSettings } from "../src/core/settings.js";
import { StateStore } from "../src/state/store.js";
import {
  PROTOCOL_VERSION,
  currentBuildIdentity,
} from "../src/core/build-identity.js";
import {
  authorizeExtraAttempt,
  authorizeMainCorrection,
  resolvePendingGrantExecutionOptions,
} from "../src/core/attempt-authorization.js";
import { isWorkspaceReady } from "../src/workspace/copy.js";
import { captureCandidateRevision } from "../src/core/candidate-revision.js";
import { upsertModelConfig } from "../src/core/model-catalog.js";
import { upsertWorkerProfile } from "../src/core/worker-profiles.js";
import {
  buildTaskAdmissionPreview,
  type SafeTaskAdmissionPreview,
} from "../src/core/task-preview.js";
import type { ProviderAuthInspector } from "../src/core/providers.js";

// File-scope no-op SIGTERM handler: the coordinator's
// authorizeActivationHandoffShutdown sends SIGTERM to its own pid,
// which is the test process when using ForkLightDaemon in-process.
// This handler prevents the test runner from exiting.
process.on("SIGTERM", () => {});

// --- revise harness ---

const REVISE_PROBE = "forklight-revise-PROBE-MARKER-2026";

test("identity matching protects state changes but lets a new build stop an old daemon", () => {
  assert.equal(requiresMatchingBuildIdentity("settings_update"), true);
  assert.equal(requiresMatchingBuildIdentity("integration_apply"), true);
  assert.equal(requiresMatchingBuildIdentity("shutdown"), false);
  assert.equal(requiresMatchingBuildIdentity("health"), false);
  // Task-file admission preview is read-only; submit is mutating.
  assert.equal(requiresMatchingBuildIdentity("validate_file"), false);
  assert.equal(requiresMatchingBuildIdentity("submit_file"), true);
  // Adaptation preview is read-only; apply is mutating.
  assert.equal(requiresMatchingBuildIdentity("adaptation_preview"), false);
  assert.equal(requiresMatchingBuildIdentity("adaptation_apply"), true);
});

test("Integration wait socket deadline covers the requested wait interval", () => {
  assert.equal(daemonRequestTimeoutMs("health", {}), 15_000);
  assert.equal(daemonRequestTimeoutMs("integration_wait", { timeoutMs: 1 }), 15_000);
  assert.equal(
    daemonRequestTimeoutMs("integration_wait", { timeoutMs: 60_000 }),
    65_000,
  );
});

test("resolveDaemonStartupTimeoutMs accepts the bounded range and rejects garbage", () => {
  assert.equal(resolveDaemonStartupTimeoutMs(), DEFAULT_DAEMON_STARTUP_TIMEOUT_MS);
  assert.equal(resolveDaemonStartupTimeoutMs(1_000), 1_000);
  assert.equal(resolveDaemonStartupTimeoutMs(600_000), 600_000);
  assert.throws(() => resolveDaemonStartupTimeoutMs(999), /Daemon startup timeout must be an integer/);
  assert.throws(() => resolveDaemonStartupTimeoutMs(600_001), /Daemon startup timeout must be an integer/);
  assert.throws(() => resolveDaemonStartupTimeoutMs(1.5), /Daemon startup timeout must be an integer/);
  assert.throws(() => resolveDaemonStartupTimeoutMs("30000"), /Daemon startup timeout must be an integer/);
});

function fakeChild(overrides: Partial<DaemonChildHandle> = {}): DaemonChildHandle {
  return {
    pid: 42_001,
    exited: false,
    exitCode: null,
    signalCode: null,
    ...overrides,
  };
}

test("ensureDaemon returns an already-healthy daemon without launching", async () => {
  let launches = 0;
  const health = { ok: true, pid: 77, status: "ready" };
  const result = await ensureDaemon("/tmp/forklight-ensure-already-running", {
    launch: () => {
      launches += 1;
      return fakeChild();
    },
    probeHealth: async () => health,
  });
  assert.deepEqual(result, health);
  assert.equal(launches, 0, "already-healthy path must not spawn");
});

test("ensureDaemon waits past the old five-second boundary for slow recovery", async () => {
  let now = 0;
  let launches = 0;
  let postLaunchProbes = 0;
  const health = { ok: true, pid: 88, status: "ready-after-slow-recovery" };
  const result = await ensureDaemon("/tmp/forklight-ensure-slow-ready", {
    startupTimeoutMs: 10_000,
    pollIntervalMs: 100,
    nowMs: () => now,
    sleepMs: async (ms) => {
      now += ms;
    },
    launch: () => {
      launches += 1;
      return fakeChild({ pid: 88 });
    },
    probeHealth: async () => {
      // First call is the existing-daemon fast path; fail so we launch once.
      if (launches === 0) throw new Error("connect ENOENT");
      postLaunchProbes += 1;
      // Become ready only after the historical fixed 5s window.
      if (now < 5_500) throw new Error("connect ENOENT");
      return health;
    },
  });
  assert.deepEqual(result, health);
  assert.equal(launches, 1, "slow recovery must launch exactly once");
  assert.ok(now >= 5_500, `readiness must cross the old 5s boundary (now=${now})`);
  assert.ok(postLaunchProbes > 1, "must poll health after launch");
});

test("ensureDaemon fails immediately when the launched child exits", async () => {
  let now = 0;
  let launches = 0;
  const child = fakeChild({ pid: 99 });
  let childExited = false;
  await assert.rejects(
    () => ensureDaemon("/tmp/forklight-ensure-child-exit", {
      startupTimeoutMs: 10_000,
      pollIntervalMs: 100,
      nowMs: () => now,
      sleepMs: async (ms) => {
        now += ms;
        childExited = true;
      },
      launch: () => {
        launches += 1;
        return {
          get pid() {
            return child.pid;
          },
          get exited() {
            return childExited;
          },
          get exitCode() {
            return childExited ? 1 : null;
          },
          get signalCode() {
            return null;
          },
        };
      },
      probeHealth: async () => {
        if (launches === 0) throw new Error("connect ENOENT");
        throw new Error("connect ECONNREFUSED");
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, DAEMON_STARTUP_CHILD_EXITED_MESSAGE);
      assert.doesNotMatch(error.message, /ENOENT|ECONNREFUSED|\/tmp|sock/i);
      return true;
    },
  );
  assert.equal(launches, 1, "child-exit path must not relaunch");
  assert.ok(now < 5_000, "child exit must fail before the full readiness window");
});

test("ensureDaemon reports a truthful timeout without relaunching", async () => {
  let now = 0;
  let launches = 0;
  await assert.rejects(
    () => ensureDaemon("/tmp/forklight-ensure-timeout", {
      startupTimeoutMs: 1_000,
      pollIntervalMs: 100,
      nowMs: () => now,
      sleepMs: async (ms) => {
        now += ms;
      },
      launch: () => {
        launches += 1;
        return fakeChild({ pid: 101 });
      },
      probeHealth: async () => {
        throw new Error("connect ENOENT /private/tmp/secret-home/forklight.sock");
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, new RegExp(DAEMON_STARTUP_TIMEOUT_MESSAGE));
      assert.match(error.message, /1000ms/);
      assert.doesNotMatch(error.message, /secret-home|forklight\.sock|ENOENT/i);
      return true;
    },
  );
  assert.equal(launches, 1, "timeout path must launch exactly once");
  assert.ok(now >= 1_000, `deadline must be exhausted (now=${now})`);
});

test("Main remediation transport does not expire before configured verification", () => {
  assert.equal(daemonRequestTimeoutMs("remediation_verify", {}), 6 * 60 * 60 * 1000 + 5_000);
  assert.equal(
    daemonRequestTimeoutMs("remediation_verify", { requestTimeoutMs: 30_000 }),
    35_000,
  );
});

test("remediation amendment parser enforces privacy-safe structured shape", async () => {
  const { parseRemediationAmendmentInput } = await import("../src/core/main-remediation.js");

  const valid = parseRemediationAmendmentInput({
    verificationEventSequence: 3,
    reasonCode: "contradictory-acceptance",
    replacements: [{
      originalCommand: "npm run typecheck",
      replacementCommand: "npm run build",
    }],
  });
  assert.equal(valid?.verificationEventSequence, 3);
  assert.equal(valid?.replacements.length, 1);
  assert.equal(valid?.replacements[0]?.originalCommand, "npm run typecheck");

  // Unknown top-level fields: fixed error, never echoes attacker-controlled names.
  assert.throws(
    () => parseRemediationAmendmentInput({
      verificationEventSequence: 1,
      reasonCode: "contradictory-acceptance",
      replacements: [{ originalCommand: "a", replacementCommand: "b" }],
      evilField: "SECRET_LEAK",
    }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /amendment contains unknown fields/);
      assert.doesNotMatch(message, /evilField|SECRET_LEAK/);
      return true;
    },
  );

  // Unknown replacement fields: fixed error, never echoes field names.
  assert.throws(
    () => parseRemediationAmendmentInput({
      verificationEventSequence: 1,
      reasonCode: "contradictory-acceptance",
      replacements: [{
        originalCommand: "a",
        replacementCommand: "b",
        attackerKey: "path/to/secret",
      }],
    }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /amendment replacement contains unknown fields/);
      assert.doesNotMatch(message, /attackerKey|path\/to\/secret/);
      return true;
    },
  );

  // Whitespace-only and identical replacements reject before mutation.
  assert.throws(
    () => parseRemediationAmendmentInput({
      verificationEventSequence: 1,
      reasonCode: "contradictory-acceptance",
      replacements: [{ originalCommand: "   ", replacementCommand: "npm run build" }],
    }),
    /originalCommand must be 1-/,
  );
  assert.throws(
    () => parseRemediationAmendmentInput({
      verificationEventSequence: 1,
      reasonCode: "contradictory-acceptance",
      replacements: [{
        originalCommand: "npm run typecheck",
        replacementCommand: "npm run typecheck",
      }],
    }),
    /must differ from originalCommand/,
  );
  assert.throws(
    () => parseRemediationAmendmentInput({
      verificationEventSequence: 1,
      reasonCode: "contradictory-acceptance",
      replacements: [{
        originalCommand: "npm run typecheck",
        replacementCommand: "x".repeat(4001),
      }],
    }),
    /replacementCommand must be 1-/,
  );
});

function standaloneSucceededTask(
  store: StateStore, name: string, status: TaskRecord["status"] = "succeeded",
): TaskRecord {
  const task = registerTaskFromSpec(
    store,
    {
      version: 1,
      name,
      project: "/tmp/forklight-revise-source",
      goal: "Exercise revise eligibility",
      constraints: [],
      provider: {
        name: "deepseek",
        model: "deepseek-v4-flash",
        keychainService: "forklight.test.api-key",
      },
      runtime: {
        name: "claude-code",
        executable: "claude",
        effort: "low",
        maxBudgetUsd: 0.1,
      },
      workspace: { exclude: [] },
      worker: { allowEdits: false, allowedCommands: [], focusPaths: ["src"] },
      acceptance: { commands: ["true"] },
    },
    `forklight://test/${name}`,
  );
  if (status !== "queued") store.setTaskStatus(task.id, status, { error: null });
  return store.getTask(task.id);
}

function seedPassingVerification(
  store: StateStore,
  task: TaskRecord,
  preferredAttemptId?: string,
): string {
  const now = new Date().toISOString();
  let attempt = preferredAttemptId === undefined
    ? store.listAttempts(task.id).at(-1)
    : store.listAttempts(task.id).find((candidate) => candidate.id === preferredAttemptId);
  if (attempt === undefined) {
    const ordinal = store.nextAttemptOrdinal(task.id);
    attempt = {
      id: preferredAttemptId ?? `review-attempt-${task.id}`,
      taskId: task.id,
      ordinal,
      status: "succeeded",
      sessionId: task.sessionId,
      rawLogPath: "/dev/null",
      startedAt: now,
      finishedAt: now,
      exitCode: 0,
      runtimeBudgetUsd: task.spec.runtime.maxBudgetUsd,
    };
    store.createAttempt(attempt);
  }
  store.updateTask(task.id, { currentAttemptId: attempt.id });
  const verification: VerificationResult = {
    passed: true,
    behaviorPassed: true,
    policyPassed: true,
    sourceCompatible: true,
    commands: [{
      command: "true",
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
      timedOut: false,
    }],
    diffPath: task.paths.diff,
    sourceUnchanged: true,
  };
  store.addEvent(
    task.id,
    attempt.id,
    "verification.completed",
    "Independent verification passed",
    verification,
  );
  return attempt.id;
}

function testCoordinator(store: StateStore, maxConcurrency: number): DaemonCoordinator {
  const settings = new SettingsService(store);
  return new DaemonCoordinator(store, settings, maxConcurrency, TEST_PROVIDER_AUTH_READY);
}

const TEST_PROVIDER_AUTH_READY: ProviderAuthInspector = {
  hasReadableKeychainValue: () => true,
  hasLocalGrokSignIn: () => true,
};

test("Main-direct coordinator start, observe, and close use one non-Task record", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-main-direct-coordinator-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  try {
    const taskCountBefore = store.listTasks().length;
    const started = await coordinator.mainDirectStart({
      taskClass: "small-coordinator-fix",
      taskFamily: "maintenance",
      reason: "small-clear-change",
      note: "Main can repair this bounded issue directly.",
      consideredWorkerProfileIds: [],
      confirm: true,
    });
    assert.equal(started.status, "open");
    assert.equal(store.listTasks().length, taskCountBefore);
    assert.deepEqual(coordinator.mainDirectStatus(started.id), started);
    assert.equal(coordinator.mainDirectList().length, 1);
    assert.equal(coordinator.mainDirectAggregate().openCount, 1);

    const closeInput = {
      id: started.id,
      outcome: "completed",
      verification: "passed",
      note: "Independent checks passed.",
      confirm: true,
    };
    const closed = coordinator.mainDirectComplete(closeInput);
    assert.equal(closed.status, "completed");
    assert.equal(closed.verification, "passed");
    assert.deepEqual(coordinator.mainDirectComplete(closeInput), closed, "identical replay is idempotent");
    assert.throws(
      () => coordinator.mainDirectComplete({
        ...closeInput,
        outcome: "abandoned",
        verification: undefined,
        note: "Conflicting replay.",
      }),
      /already completed/,
    );
    assert.equal(coordinator.mainDirectAggregate().completedPassedCount, 1);
    assert.equal(store.listTasks().length, taskCountBefore);
  } finally {
    await coordinator.shutdown();
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("source-dev daemon launch uses tsx while dist launch uses compiled JavaScript", () => {
  assert.deepEqual(
    daemonLaunchArguments("file:///repo/src/daemon/client.ts"),
    {
      executable: process.execPath,
      args: [
        "--disable-warning=ExperimentalWarning",
        "--import",
        "tsx",
        "/repo/src/daemon/main.ts",
      ],
      mode: "source-dev",
    },
  );
  assert.deepEqual(
    daemonLaunchArguments("file:///repo/dist/src/daemon/client.js"),
    {
      executable: process.execPath,
      args: [
        "--disable-warning=ExperimentalWarning",
        "/repo/dist/src/daemon/main.js",
      ],
      mode: "dist",
    },
  );
});

function graphTask(store: StateStore, name: string): TaskRecord {
  return registerTaskFromSpec(
    store,
    {
      version: 1,
      name,
      project: "/tmp/forklight-graph-test-source",
      goal: "Exercise graph scheduling",
      constraints: [],
      provider: {
        name: "deepseek",
        model: "deepseek-v4-flash",
        keychainService: "forklight.test.api-key",
      },
      runtime: {
        name: "claude-code",
        executable: "claude",
        effort: "low",
        maxBudgetUsd: 0.1,
      },
      workspace: { exclude: [] },
      worker: { allowEdits: false, allowedCommands: [], focusPaths: ["src"] },
      acceptance: { commands: ["true"] },
    },
    `forklight://test/${name}`,
  );
}

function createGraph(
  store: StateStore,
  id: string,
  tasks: Array<{ itemId: string; task: TaskRecord }>,
  dependencies: Array<{ itemId: string; dependsOnItemId: string }>,
): void {
  const now = new Date().toISOString();
  const plan: PlanRecord = {
    id,
    name: id,
    objective: "Exercise dependency scheduling",
    planFile: `/tmp/${id}.yaml`,
    createdAt: now,
    updatedAt: now,
  };
  const items: PlanItemRecord[] = tasks.map(({ itemId, task }, itemIndex) => ({
    id: itemId,
    planId: id,
    taskId: task.id,
    itemIndex,
    taskFile: `/tmp/${itemId}.yaml`,
  }));
  const edges: DependencyRecord[] = dependencies.map((dependency) => ({
    planId: id,
    ...dependency,
  }));
  store.createPlanGraph(plan, items, edges);
}

async function writeTwoWavePlan(root: string): Promise<string> {
  const task = path.resolve("examples/deepseek-checkout.yaml");
  const planFile = path.join(root, "plan.json");
  await writeFile(
    planFile,
    JSON.stringify({
      version: 1,
      name: "Two-wave registration",
      objective: "Exercise coordinator plan registration waves",
      items: [
        { id: "foundation", task, dependsOn: [] },
        { id: "first", task, dependsOn: ["foundation"] },
        { id: "second", task, dependsOn: ["foundation"] },
      ],
    }),
  );
  return planFile;
}

test("daemon serves health and task-list requests over its local socket", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-daemon-"));
  const daemon = new ForkLightDaemon(home, 1);
  await daemon.start();
  try {
    const health = await daemonRequest<Record<string, unknown>>("health", {}, home);
    assert.equal(health.ok, true);
    assert.equal(health.maxConcurrency, 1);
    assert.deepEqual(health.buildIdentity, currentBuildIdentity());
    const tasks = await daemonRequest<unknown[]>("list", {}, home);
    assert.deepEqual(tasks, []);
  } finally {
    await daemon.close();
  }
});

test("daemon statistics default to compact detail and reject invalid detail", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-daemon-stats-"));
  const store = new StateStore(home);
  const timestamp = new Date().toISOString();
  const failed: TaskRecord = {
    id: "stats-failed",
    name: "stats failed",
    status: "failed",
    sourcePath: "/source",
    taskFile: "/task.yaml",
    spec: { provider: { name: "deepseek", model: "v4" } } as TaskRecord["spec"],
    paths: {} as TaskRecord["paths"],
    sessionId: "stats-session",
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
    error: "HTTP 401: bad key for deep audit",
  };
  store.createTask(failed);
  store.createAttempt({
    id: "stats-attempt-1",
    taskId: failed.id,
    ordinal: 1,
    status: "failed",
    sessionId: failed.sessionId,
    rawLogPath: "/log",
    startedAt: timestamp,
    finishedAt: timestamp,
    exitCode: 1,
    costUsd: 0.2,
    turns: 3,
  });
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const defaultCompact = await daemonRequest<Array<Record<string, unknown>>>(
      "statistics",
      {},
      home,
    );
    assert.equal(defaultCompact.length, 1);
    assert.equal(defaultCompact[0]!.provider, "deepseek");
    assert.equal(defaultCompact[0]!.model, "v4");
    assert.equal(defaultCompact[0]!.sampleSize, 1);
    assert.equal(defaultCompact[0]!.successCount, 0);
    assert.deepEqual(defaultCompact[0]!.failureDistribution, { credential: 1 });
    assert.equal("failures" in defaultCompact[0]!, false);
    const compactJson = JSON.stringify(defaultCompact);
    assert.doesNotMatch(compactJson, /"taskId"|"attemptId"|"diagnostic"|HTTP 401|stats-failed|stats-attempt/);

    const explicitCompact = await daemonRequest<Array<Record<string, unknown>>>(
      "statistics",
      { detail: "compact" },
      home,
    );
    assert.equal("failures" in explicitCompact[0]!, false);
    assert.equal(explicitCompact[0]!.sampleSize, defaultCompact[0]!.sampleSize);
    assert.deepEqual(
      explicitCompact[0]!.failureDistribution,
      defaultCompact[0]!.failureDistribution,
    );

    const full = await daemonRequest<Array<Record<string, unknown>>>(
      "statistics",
      { detail: "full" },
      home,
    );
    assert.equal(full[0]!.sampleSize, defaultCompact[0]!.sampleSize);
    assert.equal(full[0]!.successRate, defaultCompact[0]!.successRate);
    assert.deepEqual(full[0]!.failureDistribution, defaultCompact[0]!.failureDistribution);
    const failures = full[0]!.failures as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(failures));
    assert.equal(failures.length, 1);
    assert.equal(failures[0]!.taskId, "stats-failed");
    assert.equal(failures[0]!.attemptId, "stats-attempt-1");
    assert.equal(failures[0]!.diagnostic, "HTTP 401: bad key for deep audit");

    await assert.rejects(
      () => daemonRequest("statistics", { detail: "verbose" }, home),
      /statistics detail must be "compact" or "full"/,
    );
    await assert.rejects(
      () => daemonRequest("statistics", { detail: true }, home),
      /statistics detail must be "compact" or "full"/,
    );
  } finally {
    await daemon.close();
  }
});

test("daemon exposes identity, warns on read mismatch, and blocks stale mutations", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-daemon-identity-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const current = currentBuildIdentity();
  try {
    const staleRead = await daemonExchange(
      "health",
      {},
      home,
      { ...current, buildId: "stale-client-build" },
    );
    assert.equal(staleRead.ok, true);
    assert.match(staleRead.warning ?? "", /rebuild|restart/i);
    assert.deepEqual(staleRead.serverIdentity, current);

    const staleMutation = await daemonExchange(
      "settings_reset",
      {},
      home,
      { ...current, buildId: "stale-client-build" },
    );
    assert.equal(staleMutation.ok, false);
    assert.match(staleMutation.error ?? "", /build mismatch/i);

    const protocolMutation = await daemonExchange(
      "settings_reset",
      {},
      home,
      { ...current, protocolVersion: PROTOCOL_VERSION - 1 },
    );
    assert.equal(protocolMutation.ok, false);
    assert.match(protocolMutation.error ?? "", /protocol mismatch/i);
  } finally {
    await daemon.close();
  }
});

test("daemon exposes checkpoint_run with bounded command-id input", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-daemon-checkpoint-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    await assert.rejects(
      () => daemonRequest(
        "checkpoint_run",
        { taskId: "missing-task", attemptId: "attempt", commandIds: ["acceptance-1"] },
        home,
      ),
      /Unknown ForkLight task: missing-task/,
    );
    await assert.rejects(
      () => daemonRequest(
        "checkpoint_run",
        { taskId: "missing-task", attemptId: "attempt", commandIds: "acceptance-1" },
        home,
      ),
      /commandIds must be an array/,
    );
  } finally {
    await daemon.close();
  }
});

test("daemon Competition protocol preserves Profile-only candidates through parsing", async () => {
  // Keep the macOS Unix-domain socket path below its platform length limit.
  const home = await mkdtemp(path.join(tmpdir(), "fl-dcp-"));
  const taskFile = await writeAdmissionTaskFile("default", {
    name: "Profile Competition protocol",
  });
  const daemon = new ForkLightDaemon(home, 0, TEST_PROVIDER_AUTH_READY);
  await daemon.start();
  try {
    await assert.rejects(
      () => daemonRequest(
        "competition_submit_file",
        {
          taskFile,
          candidates: [
            { workerProfileId: "default" },
            { workerProfileId: "missing-profile" },
          ],
          reason: {
            intent: "required",
            triggers: ["user-requested"],
            note: "Exercise the real Profile-based daemon admission path.",
          },
        },
        home,
      ),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /Unknown worker profile|unknown Worker Profile/);
        assert.doesNotMatch(message, /not both|provider\/model/);
        return true;
      },
    );
    assert.deepEqual(await daemonRequest<unknown[]>("list", {}, home), []);
    assert.deepEqual(await daemonRequest<unknown[]>("competition_list", {}, home), []);
  } finally {
    await daemon.close();
    await rm(home, { recursive: true, force: true });
    await rm(path.dirname(taskFile), { recursive: true, force: true });
  }
});

test("daemon submission returns a task before workspace preparation finishes", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-daemon-submit-"));
  const daemon = new ForkLightDaemon(home, 1, TEST_PROVIDER_AUTH_READY);
  await daemon.start();
  try {
    const task = await daemonRequest<TaskRecord>(
      "submit",
      {
        baseDirectory: home,
        task: {
          version: 1,
          name: "asynchronous preparation",
          project: path.join(home, "missing-project"),
          goal: "prove submission does not wait for project copying",
          provider: { name: "deepseek", model: "deepseek-v4-flash" },
          runtime: { name: "claude-code" },
          worker: { allowedCommands: [] },
          acceptance: { commands: ["true"] },
        },
      },
      home,
    );
    assert.match(task.id, /^[0-9a-f-]{36}$/);

    let current = task;
    for (let attempt = 0; attempt < 50 && current.status !== "failed"; attempt += 1) {
      await sleep(10);
      current = await daemonRequest<TaskRecord>("status", { taskId: task.id }, home);
    }
    assert.equal(current.status, "failed");
    assert.match(current.error ?? "", /Workspace preparation failed/);
  } finally {
    await daemon.close();
  }
});

test("graph tasks persist waiting and blocked dependency evidence", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-scheduler-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  const foundation = graphTask(store, "foundation");
  const consumer = graphTask(store, "consumer");
  createGraph(
    store,
    "dependency-state",
    [{ itemId: "foundation", task: foundation }, { itemId: "consumer", task: consumer }],
    [{ itemId: "consumer", dependsOnItemId: "foundation" }],
  );

  coordinator.queueTask(consumer.id);
  assert.equal(store.getTask(consumer.id).status, "waiting");
  assert.match(store.getTask(consumer.id).error ?? "", /foundation/);
  assert.equal(store.listEvents(consumer.id).at(-1)?.type, "task.waiting");

  store.setTaskStatus(foundation.id, "failed", { error: "verification failed" });
  await coordinator.recover();
  assert.equal(store.getTask(consumer.id).status, "blocked");
  assert.match(store.getTask(consumer.id).error ?? "", /foundation/);
  assert.equal(store.listEvents(consumer.id).at(-1)?.type, "task.blocked");
  await coordinator.shutdown();
  store.close();
});

test("successful prerequisite queues each waiting dependent exactly once", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-scheduler-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  const foundation = graphTask(store, "foundation");
  const first = graphTask(store, "first-dependent");
  const second = graphTask(store, "second-dependent");
  createGraph(
    store,
    "dependency-unlock",
    [
      { itemId: "foundation", task: foundation },
      { itemId: "first", task: first },
      { itemId: "second", task: second },
    ],
    [
      { itemId: "first", dependsOnItemId: "foundation" },
      { itemId: "second", dependsOnItemId: "foundation" },
    ],
  );
  coordinator.queueTask(first.id);
  coordinator.queueTask(second.id);
  assert.equal(store.getTask(first.id).status, "waiting");
  assert.equal(store.getTask(second.id).status, "waiting");

  store.setTaskStatus(foundation.id, "succeeded", { error: null });
  await coordinator.recover();
  await coordinator.recover();
  assert.equal(store.getTask(first.id).status, "queued");
  assert.equal(store.getTask(second.id).status, "queued");
  const queued = (coordinator.health().queuedTaskIds as string[]).sort();
  assert.deepEqual(queued, [first.id, second.id].sort());
  assert.equal(store.listEvents(first.id).filter((event) => event.type === "task.ready").length, 1);
  await coordinator.shutdown();
  store.close();
});

test("restart preserves blocked work and standalone tasks bypass graph checks", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-scheduler-"));
  const initial = new StateStore(home);
  const foundation = graphTask(initial, "foundation");
  const consumer = graphTask(initial, "consumer");
  const standalone = graphTask(initial, "standalone");
  createGraph(
    initial,
    "dependency-restart",
    [{ itemId: "foundation", task: foundation }, { itemId: "consumer", task: consumer }],
    [{ itemId: "consumer", dependsOnItemId: "foundation" }],
  );
  initial.setTaskStatus(foundation.id, "failed", { error: "verification failed" });
  const firstCoordinator = testCoordinator(initial, 0);
  firstCoordinator.queueTask(consumer.id);
  assert.equal(initial.getTask(consumer.id).status, "blocked");
  await firstCoordinator.shutdown();
  initial.close();

  const reopened = new StateStore(home);
  const recovered = testCoordinator(reopened, 0);
  await recovered.recover();
  assert.equal(reopened.getTask(consumer.id).status, "blocked");
  assert.match(reopened.getTask(consumer.id).error ?? "", /foundation/);
  recovered.queueTask(standalone.id);
  assert.deepEqual(recovered.health().queuedTaskIds, [standalone.id]);
  await recovered.shutdown();
  reopened.close();
});

test("plan-file submission atomically registers tasks before applying dependency gates", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-plan-register-"));
  const planFile = await writeTwoWavePlan(home);
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  try {
    const result = await coordinator.submitPlanFile(planFile);
    const { foundation, first, second } = result.taskIdsByItemId;
    assert.ok(foundation && first && second);
    assert.equal(result.planId, planFile);
    assert.equal(store.getTask(foundation).status, "queued");
    assert.equal(store.getTask(first).status, "waiting");
    assert.equal(store.getTask(second).status, "waiting");
    assert.ok(store.getTask(foundation).effectivePolicy, "plan Tasks snapshot effective policy");
    assert.ok(store.getTask(first).effectivePolicy, "dependent plan Tasks snapshot effective policy");
    assert.match(store.getTask(first).error ?? "", /foundation/);
    assert.equal(store.listEvents(first).at(-1)?.type, "task.waiting");
    assert.equal(store.getPlanItems(result.planId).length, 3);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

// --- validate_file read-only admission preview ---

async function writeAdmissionTaskFile(
  workerProfileId: string,
  options: { acceptanceCommand?: string; name?: string } = {},
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-validate-file-"));
  await mkdir(path.join(root, "project"));
  const taskFile = path.join(root, "task.yaml");
  const command = options.acceptanceCommand ?? "true";
  const name = options.name ?? "Daemon Validate Preview";
  await writeFile(
    taskFile,
    `version: 2
name: ${name}
project: ./project
workerProfileId: ${workerProfileId}
provider:
  endpoint: https://secret-daemon-endpoint.example.invalid/v1
  keychainService: forklight.secret.daemon-preview
worker:
  focusPaths: [src]
contract:
  outcome: Daemon validate_file returns the exact saved Worker selection
  context: [current settings]
  inScope: [preview]
  outOfScope: [mutation]
  executionSteps: [validate]
  deliverables: [safe preview]
  modules:
    - name: daemon
      responsibility: expose read-only admission preview over the socket
      consumes: [file path]
      produces: [safe preview]
      boundaries: [no Task mutation]
  callChain: [client, daemon, preview]
  scenarios:
    - name: custom
      given: saved profile
      when: validate_file
      then: exact selection
    - name: missing
      given: absent profile
      when: validate_file
      then: reject closed
  risks: [policy drift]
  changeBudget:
    maxFiles: 4
    maxDiffLines: 100
acceptance:
  criteria: [safe]
  commands:
    - "${command}"
`,
  );
  return taskFile;
}

function seedGrokBuilderSettings(settings: SettingsService): void {
  const current = settings.get();
  const catalog = upsertModelConfig(current.modelCatalog, {
    id: "xai-grok-builder",
    label: "xAI Grok Builder",
    provider: "xai",
    model: "grok-4.5",
    endpoint: "https://secret-daemon-endpoint.example.invalid/v1",
  });
  const profiles = upsertWorkerProfile(current.workerProfiles, {
    id: "local-grok-builder",
    label: "Local Grok Builder",
    runtime: "grok-build",
    modelConfigId: "xai-grok-builder",
    effort: "high",
    maxBudgetUsd: 1.25,
    advancedPolicy: {
      baseMaxAttempts: 6,
      maxExtraAttempts: 1,
      maxConcurrency: 1,
      noProgressTimeoutMs: 600_000,
      completionMode: "warn",
    },
  }, catalog);
  settings.update({ modelCatalog: catalog, workerProfiles: profiles });
}

test("validate_file resolves custom Profile and agrees with shared preview builder", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-validate-agree-"));
  const seedStore = new StateStore(home);
  try {
    seedGrokBuilderSettings(new SettingsService(seedStore));
  } finally {
    seedStore.close();
  }
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const taskFile = await writeAdmissionTaskFile("local-grok-builder");
    const viaDaemon = await daemonRequest<SafeTaskAdmissionPreview>(
      "validate_file",
      { taskFile },
      home,
    );
    assert.equal(viaDaemon.workerProfileId, "local-grok-builder");
    assert.equal(viaDaemon.workerProfileLabel, "Local Grok Builder");
    assert.equal(viaDaemon.provider, "xai");
    assert.equal(viaDaemon.model, "grok-4.5");
    assert.equal(viaDaemon.runtime, "grok-build");
    assert.equal(viaDaemon.effort, "high");
    assert.equal(viaDaemon.budget.maxBudgetUsd, 1.25);
    assert.equal(viaDaemon.effectivePolicy.values.baseMaxAttempts, 6);
    assert.equal(viaDaemon.effectivePolicy.provenance.baseMaxAttempts, "worker");
    assert.equal(viaDaemon.effectivePolicy.values.noProgressTimeoutMs, 600_000);
    assert.equal(viaDaemon.effectivePolicy.provenance.noProgressTimeoutMs, "worker");

    const store2 = new StateStore(home);
    try {
      const viaShared = await buildTaskAdmissionPreview(taskFile, new SettingsService(store2).get());
      assert.deepEqual(viaDaemon, viaShared);
    } finally {
      store2.close();
    }

    const serialized = JSON.stringify(viaDaemon);
    assert.doesNotMatch(serialized, /secret-daemon-endpoint/);
    assert.doesNotMatch(serialized, /forklight\.secret\.daemon-preview/);
    assert.doesNotMatch(serialized, /keychain/i);
    assert.doesNotMatch(serialized, /"taskFile"/);
    assert.doesNotMatch(serialized, /endpoint/i);
  } finally {
    await daemon.close();
  }
});

test("validate_file is read-only on success and rejection", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-validate-readonly-"));
  const seedStore = new StateStore(home);
  try {
    seedGrokBuilderSettings(new SettingsService(seedStore));
  } finally {
    seedStore.close();
  }
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const okFile = await writeAdmissionTaskFile("local-grok-builder", {
      acceptanceCommand: "npm test -- --secret-cmd",
    });
    const preview = await daemonRequest<SafeTaskAdmissionPreview>(
      "validate_file",
      { taskFile: okFile },
      home,
    );
    assert.equal(preview.workerProfileId, "local-grok-builder");
    assert.doesNotMatch(JSON.stringify(preview), /npm test/);

    const missingFile = await writeAdmissionTaskFile("missing-profile-id");
    await assert.rejects(
      async () => daemonRequest("validate_file", { taskFile: missingFile }, home),
      /Unknown worker profile: missing-profile-id/,
    );
    await assert.rejects(
      async () => daemonRequest("validate_file", { taskFile: "relative-task.yaml" }, home),
      /requires an absolute Task Contract file path/,
    );

    const after = new StateStore(home);
    try {
      assert.deepEqual(after.listTasks(), []);
      const settings = new SettingsService(after).get();
      assert.ok(settings.workerProfiles.profiles.some((p) => p.id === "local-grok-builder"));
      // Queue stays empty: validate never creates work.
      const health = await daemonRequest<Record<string, unknown>>("health", {}, home);
      assert.deepEqual(health.queuedTaskIds, []);
      assert.deepEqual(health.activeTaskIds, []);
    } finally {
      after.close();
    }
  } finally {
    await daemon.close();
  }
});

test("validate_file reflects current settings without mutating prior Tasks", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-validate-settings-"));
  const seedStore = new StateStore(home);
  try {
    seedGrokBuilderSettings(new SettingsService(seedStore));
  } finally {
    seedStore.close();
  }
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const taskFile = await writeAdmissionTaskFile("local-grok-builder");
    const first = await daemonRequest<SafeTaskAdmissionPreview>(
      "validate_file",
      { taskFile },
      home,
    );
    assert.equal(first.model, "grok-4.5");
    assert.equal(first.budget.maxBudgetUsd, 1.25);

    // Update via the same pure helpers used by seed, then settings_update replace.
    const current = await daemonRequest<ForkLightSettings>("settings_get", {}, home);
    const nextProfiles = upsertWorkerProfile(
      current.workerProfiles,
      {
        id: "local-grok-builder",
        label: "Local Grok Builder Updated",
        runtime: "grok-build",
        modelConfigId: "xai-grok-builder",
        effort: "xhigh",
        maxBudgetUsd: 3.5,
        advancedPolicy: {
          baseMaxAttempts: 11,
          maxExtraAttempts: 1,
          maxConcurrency: 1,
          noProgressTimeoutMs: 600_000,
          completionMode: "warn",
        },
      },
      current.modelCatalog,
    );
    await daemonRequest("settings_update", {
      patch: { workerProfiles: nextProfiles },
    }, home);

    const second = await daemonRequest<SafeTaskAdmissionPreview>(
      "validate_file",
      { taskFile },
      home,
    );
    assert.equal(second.workerProfileLabel, "Local Grok Builder Updated");
    assert.equal(second.effort, "xhigh");
    assert.equal(second.budget.maxBudgetUsd, 3.5);
    assert.equal(second.effectivePolicy.values.baseMaxAttempts, 11);
    assert.equal(second.effectivePolicy.provenance.baseMaxAttempts, "worker");
    // The effective selection/policy changed with settings, so the bound
    // preview revision must change (it no longer tracks file bytes alone).
    assert.notEqual(second.previewRevisionDigest, first.previewRevisionDigest);

    const after = new StateStore(home);
    try {
      assert.deepEqual(after.listTasks(), []);
    } finally {
      after.close();
    }
  } finally {
    await daemon.close();
  }
});

// --- bound submit_file: optional expectedPreviewRevisionDigest ---

async function startSeededDaemon(home: string): Promise<ForkLightDaemon> {
  const seedStore = new StateStore(home);
  try {
    seedGrokBuilderSettings(new SettingsService(seedStore));
  } finally {
    seedStore.close();
  }
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  return daemon;
}

async function assertNoMutation(home: string): Promise<void> {
  const after = new StateStore(home);
  try {
    assert.deepEqual(after.listTasks(), [], "no Task row may be created on a bound-submit rejection");
    const health = await daemonRequest<Record<string, unknown>>("health", {}, home);
    assert.deepEqual(health.queuedTaskIds, [], "no queue entry may remain on a bound-submit rejection");
    assert.deepEqual(health.activeTaskIds, [], "no active job may remain on a bound-submit rejection");
  } finally {
    after.close();
  }
}

test("submit_file without expectedPreviewRevisionDigest stays backward compatible", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-submit-compat-"));
  const daemon = await startSeededDaemon(home);
  try {
    const taskFile = await writeAdmissionTaskFile("local-grok-builder");
    const task = await daemonRequest<TaskRecord>("submit_file", { taskFile }, home);
    assert.equal(task.spec.provider.name, "xai");
    assert.equal(task.spec.provider.model, "grok-4.5");
    assert.equal(task.spec.workerProfileId, "local-grok-builder");
    assert.equal(task.status, "queued");
  } finally {
    await daemon.close();
  }
});

test("submit_file with matching expectedPreviewRevisionDigest creates the exact effective Task", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-submit-bound-"));
  const daemon = await startSeededDaemon(home);
  try {
    const taskFile = await writeAdmissionTaskFile("local-grok-builder");
    const preview = await daemonRequest<SafeTaskAdmissionPreview>(
      "validate_file",
      { taskFile },
      home,
    );
    const task = await daemonRequest<TaskRecord>(
      "submit_file",
      { taskFile, expectedPreviewRevisionDigest: preview.previewRevisionDigest },
      home,
    );
    // The registered Task matches exactly what the preview displayed.
    assert.equal(task.spec.workerProfileId, "local-grok-builder");
    assert.equal(task.spec.provider.name, preview.provider);
    assert.equal(task.spec.provider.model, preview.model);
    assert.equal(task.spec.runtime.name, preview.runtime);
    assert.equal(task.effectivePolicy?.values.baseMaxAttempts, 6);
    assert.equal(task.effectivePolicy?.profileId, "local-grok-builder");
    assert.equal(task.status, "queued");
  } finally {
    await daemon.close();
  }
});

test("submit_file rejects a missing or malformed expectedPreviewRevisionDigest before any mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-submit-malformed-"));
  const daemon = await startSeededDaemon(home);
  try {
    const taskFile = await writeAdmissionTaskFile("local-grok-builder");
    // An empty string is "present but missing"; a non-hex string is malformed.
    // Both must fail closed before any Task/event/workspace/queue mutation.
    for (const bad of ["", "not-a-hex-digest", "abc", "0".repeat(63), null, 7, {}]) {
      await assert.rejects(
        () => daemonRequest("submit_file", {
          taskFile,
          expectedPreviewRevisionDigest: bad,
        }, home),
        /out of date/,
      );
      await assertNoMutation(home);
    }
  } finally {
    await daemon.close();
  }
});

test("submit_file rejects a mismatched expectedPreviewRevisionDigest before any mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-submit-mismatch-"));
  const daemon = await startSeededDaemon(home);
  try {
    const taskFile = await writeAdmissionTaskFile("local-grok-builder");
    await assert.rejects(
      () => daemonRequest("submit_file", {
        taskFile,
        expectedPreviewRevisionDigest: "0".repeat(64),
      }, home),
      /out of date/,
    );
    await assertNoMutation(home);
  } finally {
    await daemon.close();
  }
});

test("submit_file rejects when the Task file changed after preview before any mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-submit-filedrift-"));
  const daemon = await startSeededDaemon(home);
  try {
    const taskFile = await writeAdmissionTaskFile("local-grok-builder");
    const preview = await daemonRequest<SafeTaskAdmissionPreview>(
      "validate_file",
      { taskFile },
      home,
    );
    // Change file bytes (a YAML comment) without changing the parsed spec.
    const original = await readFile(taskFile, "utf8");
    await writeFile(taskFile, `${original}\n# file drift after preview\n`);
    await assert.rejects(
      () => daemonRequest("submit_file", {
        taskFile,
        expectedPreviewRevisionDigest: preview.previewRevisionDigest,
      }, home),
      /out of date/,
    );
    await assertNoMutation(home);
  } finally {
    await daemon.close();
  }
});

test("submit_file rejects when Worker settings changed after preview before any mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-submit-settingsdrift-"));
  const daemon = await startSeededDaemon(home);
  try {
    const taskFile = await writeAdmissionTaskFile("local-grok-builder");
    const preview = await daemonRequest<SafeTaskAdmissionPreview>(
      "validate_file",
      { taskFile },
      home,
    );
    // Change the saved Profile model/budget/effort/policy after the preview.
    const current = await daemonRequest<ForkLightSettings>("settings_get", {}, home);
    const nextProfiles = upsertWorkerProfile(
      current.workerProfiles,
      {
        id: "local-grok-builder",
        label: "Local Grok Builder Drifted",
        runtime: "grok-build",
        modelConfigId: "xai-grok-builder",
        effort: "xhigh",
        maxBudgetUsd: 3.5,
        advancedPolicy: {
          baseMaxAttempts: 11,
          maxExtraAttempts: 1,
          maxConcurrency: 1,
          noProgressTimeoutMs: 600_000,
          completionMode: "warn",
        },
      },
      current.modelCatalog,
    );
    await daemonRequest("settings_update", { patch: { workerProfiles: nextProfiles } }, home);
    await assert.rejects(
      () => daemonRequest("submit_file", {
        taskFile,
        expectedPreviewRevisionDigest: preview.previewRevisionDigest,
      }, home),
      /out of date/,
    );
    await assertNoMutation(home);
  } finally {
    await daemon.close();
  }
});


test("duplicate plan registration rolls back only the second staged execution", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-plan-duplicate-"));
  const planFile = await writeTwoWavePlan(home);
  const plan = (await assertWorkPlan(planFile)).plan;
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  try {
    const first = coordinator.submitPlan(plan);
    const originalTaskIds = Object.values(first.taskIdsByItemId).sort();

    assert.throws(() => coordinator.submitPlan(plan), /UNIQUE constraint failed/);
    assert.equal(store.listPlans().length, 1);
    assert.deepEqual(store.listTasks().map((task) => task.id).sort(), originalTaskIds);
    for (const taskId of originalTaskIds) {
      assert.equal(store.listEvents(taskId).filter((event) => event.type === "task.created").length, 1);
    }
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("daemon exposes plan submission and stable read-only board responses", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-board-daemon-"));
  const planFile = await writeTwoWavePlan(home);
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const submitted = await daemonRequest<{
      planId: string;
      taskIdsByItemId: Record<string, string>;
    }>("plan_submit_file", { planFile }, home);
    assert.equal(submitted.planId, planFile);
    assert.deepEqual(Object.keys(submitted.taskIdsByItemId).sort(), ["first", "foundation", "second"]);

    const first = await daemonRequest<PlanBoard>("plan_board", { planId: submitted.planId }, home);
    const second = await daemonRequest<PlanBoard>("plan_board", { planId: submitted.planId }, home);
    assert.deepEqual(second, first);
    assert.equal(first.plan.progress.total, 3);
    assert.equal(first.plan.progress.waiting, 2);

    const overview = await daemonRequest<PlanBoardSummary[]>(
      "plan_board_overview",
      { limit: 0 },
      home,
    );
    assert.deepEqual(overview, [first.plan]);
  } finally {
    await daemon.close();
  }
});

test("resume rejects when stored attempts equal configured maxAttempts", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-maxattempts-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  settings.update({ execution: { maxAttempts: 2 } });
  const coordinator = new DaemonCoordinator(store, settings, 0);
  const task = registerTaskFromSpec(
    store,
    {
      version: 1,
      name: "exhausted",
      project: "/tmp",
      goal: "test",
      constraints: [],
      provider: { name: "deepseek", model: "v4", keychainService: "t" },
      runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: 0.1 },
      workspace: { exclude: [] },
      worker: { allowEdits: false, allowedCommands: [], focusPaths: [] },
      acceptance: { commands: ["true"] },
    },
    "forklight://test/exhausted",
  );
  for (const status of ["interrupted", "failed"] as const) {
    store.setTaskStatus(task.id, status, { error: null });
  }
  // Seed 2 attempts so next attempt equals maxAttempts
  store.createAttempt({ id: "a1", taskId: task.id, ordinal: 1, status: "interrupted", sessionId: task.sessionId, rawLogPath: "/dev/null", startedAt: new Date().toISOString() });
  store.createAttempt({ id: "a2", taskId: task.id, ordinal: 2, status: "failed", sessionId: task.sessionId, rawLogPath: "/dev/null", startedAt: new Date().toISOString() });
  store.setTaskStatus(task.id, "failed", { error: "some error" });
  assert.throws(
    () => coordinator.resume(task.id),
    /reached maximum attempts/,
  );
  const queued = coordinator.resume(task.id, undefined, {
    additionalAttempts: 1,
    maxBudgetUsd: null,
    reason: "Explicit bounded correction",
    confirm: true,
  });
  assert.equal(queued.id, task.id);
  assert.deepEqual(coordinator.health().queuedTaskIds, [task.id]);
  const authorization = store.listEvents(task.id)
    .find((event) => event.type === "attempt.authorization.granted");
  assert.equal(
    (authorization?.payload as { targetOrdinal?: number } | undefined)?.targetOrdinal,
    3,
  );
  await coordinator.shutdown();
  store.close();
});

test("live concurrency change is visible without rebuilding the coordinator", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-liveconcurrency-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const coordinator = new DaemonCoordinator(store, settings);
  assert.equal(coordinator.health().maxConcurrency, 2);
  settings.update({ execution: { maxConcurrency: 5 } });
  assert.equal(coordinator.health().maxConcurrency, 5);
  await coordinator.shutdown();
  store.close();
});

test("settings-readiness flows providerDefaults from effective settings", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-provdef-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  // Update a specific provider default.
  settings.update({
    providerDefaults: { deepseek: { defaultModel: "deepseek-v4-pro" } },
  });
  const coordinator = new DaemonCoordinator(store, settings, 0);
  const health = coordinator.health();
  const providers = health.providers as Record<string, { defaultModel: string }>;
  assert.equal(providers.deepseek?.defaultModel, "deepseek-v4-pro");
  await coordinator.shutdown();
  store.close();
});

test("daemon settings get returns complete effective settings", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-settings-get-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const settings = await daemonRequest<Record<string, unknown>>("settings_get", {}, home);
    assert.equal(settings.version, 1);
    assert.equal((settings.execution as Record<string, unknown>).maxConcurrency, 2);
    assert.equal((settings.execution as Record<string, unknown>).defaultProvider, "deepseek");
    assert.equal(
      ((settings.competition as Record<string, unknown>).rankingWeights as Record<string, number>).duration,
      0,
    );
  } finally {
    await daemon.close();
  }
});

test("daemon settings update partial patch reads back unchanged fields", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-settings-patch-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const updated = await daemonRequest<Record<string, unknown>>(
      "settings_update",
      { patch: { competition: { rankingWeights: { duration: 0.5 } } } },
      home,
    );
    const rw = ((updated.competition as Record<string, unknown>).rankingWeights as Record<string, number>);
    assert.equal(rw.duration, 0.5);
    assert.equal(rw.verification, 1); // unchanged
    assert.equal((updated.execution as Record<string, unknown>).maxConcurrency, 2); // unchanged

    // Immediate read confirms persistence
    const reloaded = await daemonRequest<Record<string, unknown>>("settings_get", {}, home);
    assert.equal(
      ((reloaded.competition as Record<string, unknown>).rankingWeights as Record<string, number>).duration,
      0.5,
    );
  } finally {
    await daemon.close();
  }
});

test("daemon settings rejects invalid patch and preserves prior state", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-settings-reject-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    // First, set a valid value
    await daemonRequest("settings_update", {
      patch: { execution: { maxConcurrency: 5 } },
    }, home);
    const before = await daemonRequest<Record<string, unknown>>("settings_get", {}, home);
    assert.equal((before.execution as Record<string, unknown>).maxConcurrency, 5);

    // Attempt invalid update
    await assert.rejects(
      async () =>
        daemonRequest("settings_update", {
          patch: { execution: { maxConcurrency: -1 } },
        }, home),
      /positive integer/,
    );

    // State unchanged
    const after = await daemonRequest<Record<string, unknown>>("settings_get", {}, home);
    assert.equal((after.execution as Record<string, unknown>).maxConcurrency, 5);
  } finally {
    await daemon.close();
  }
});

test("daemon settings rejects credential-like fields in patch", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-settings-cred-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    await assert.rejects(
      async () =>
        daemonRequest("settings_update", {
          patch: { apiSecret: "abc" },
        }, home),
      /credential/,
    );
    await assert.rejects(
      async () =>
        daemonRequest("settings_update", {
          patch: { execution: { authToken: "xyz" } },
        }, home),
      /credential/,
    );
  } finally {
    await daemon.close();
  }
});

test("daemon settings reset restores built-in defaults", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-settings-reset-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    await daemonRequest("settings_update", {
      patch: { execution: { maxConcurrency: 8 }, competition: { rankingWeights: { duration: 0.9 } } },
    }, home);
    const before = await daemonRequest<Record<string, unknown>>("settings_get", {}, home);
    assert.equal((before.execution as Record<string, unknown>).maxConcurrency, 8);

    const reset = await daemonRequest<Record<string, unknown>>("settings_reset", {}, home);
    assert.equal((reset.execution as Record<string, unknown>).maxConcurrency, 2);
    assert.equal(
      ((reset.competition as Record<string, unknown>).rankingWeights as Record<string, number>).duration,
      0,
    );

    // Store confirms reset
    const after = await daemonRequest<Record<string, unknown>>("settings_get", {}, home);
    assert.equal((after.execution as Record<string, unknown>).maxConcurrency, 2);
  } finally {
    await daemon.close();
  }
});

test("daemon settings apply-file loads YAML and updates", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-settings-file-"));
  const settingsFile = path.join(home, "settings.yaml");
  await writeFile(
    settingsFile,
    "execution:\n  maxConcurrency: 7\n  defaultProvider: qwen\n",
  );
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const result = await daemonRequest<Record<string, unknown>>(
      "settings_apply_file",
      { file: settingsFile },
      home,
    );
    assert.equal((result.execution as Record<string, unknown>).maxConcurrency, 7);
    assert.equal((result.execution as Record<string, unknown>).defaultProvider, "qwen");
    assert.equal((result.execution as Record<string, unknown>).defaultMaxBudgetUsd, 0.5); // unchanged
  } finally {
    await daemon.close();
  }
});

test("daemon settings apply-file rejects non-object YAML", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-settings-nonobj-"));
  const settingsFile = path.join(home, "scalar.yaml");
  await writeFile(settingsFile, "just a string\n");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    await assert.rejects(
      async () =>
        daemonRequest("settings_apply_file", { file: settingsFile }, home),
      /must contain.*object/,
    );
  } finally {
    await daemon.close();
  }
});

test("daemon settings rejects non-object patch in update", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-settings-badpatch-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    await assert.rejects(
      async () => daemonRequest("settings_update", {}, home),
      /non-null object/,
    );
    await assert.rejects(
      async () => daemonRequest("settings_update", { patch: null }, home),
      /non-null object/,
    );
    await assert.rejects(
      async () => daemonRequest("settings_update", { patch: [1, 2] }, home),
      /non-null object/,
    );
  } finally {
    await daemon.close();
  }
});

test("health includes provider verification state without triggering a probe", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-provverify-"));
  const daemon = new ForkLightDaemon(home, 0);
  const observer = new StateStore(home);
  await daemon.start();
  try {
    const first = await daemonRequest<Record<string, unknown>>("health", {}, home);
    const pv1 = first.providerVerification as Record<string, Record<string, unknown>> | undefined;
    assert.ok(pv1 !== undefined, "health must include providerVerification");
    assert.ok("deepseek" in pv1);
    assert.ok("qwen" in pv1);

    // Never exposes keychainExists through health
    for (const [name, status] of Object.entries(pv1)) {
      assert.equal("keychainExists" in (status as object), false,
        `health must not leak keychainExists for ${name}`);
    }

    // Repeated health reads do not change verification state
    const second = await daemonRequest<Record<string, unknown>>("health", {}, home);
    assert.deepEqual(second.providerVerification, first.providerVerification);

    // A third health read confirms no probe cost occurred
    const third = await daemonRequest<Record<string, unknown>>("health", {}, home);
    assert.deepEqual(third.providerVerification, first.providerVerification);
    for (const name of ["deepseek", "qwen", "minimax", "glm"]) {
      assert.equal(observer.getProbeEvidence(name), undefined, `health must not probe ${name}`);
    }
  } finally {
    await daemon.close();
    observer.close();
  }
});

test("all-provider probing honors configured concurrency and preserves provider order", async () => {
  let active = 0;
  let peak = 0;
  const names = ["deepseek", "qwen", "minimax", "glm"] as const;
  const results = await probeProvidersBounded(
    names,
    { maxProbeConcurrency: 2 },
    async (provider) => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(provider === "deepseek" ? 15 : 5);
      active -= 1;
      return {
        provider,
        model: `${provider}-model`,
        endpointOrigin: "https://example.test",
        status: "verified",
        latencyMs: 1,
        timestamp: "2026-07-22T00:00:00.000Z",
      };
    },
  );
  assert.equal(peak, 2);
  assert.deepEqual(Object.keys(results), names);
});

test("daemon provider_status returns cached evidence without probing", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-provstat-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const all = await daemonRequest<Record<string, unknown>>("provider_status", {}, home);
    assert.ok("deepseek" in all);
    assert.ok("qwen" in all);
    assert.ok("minimax" in all);
    assert.ok("glm" in all);
    for (const [name, status] of Object.entries(all)) {
      const s = status as Record<string, unknown>;
      assert.ok(typeof s.status === "string", `${name} must have a status string`);
      assert.ok(typeof s.model === "string", `${name} must have a model string`);
    }

    // Single provider status
    const single = await daemonRequest<Record<string, unknown>>(
      "provider_status",
      { provider: "deepseek" },
      home,
    );
    assert.ok("deepseek" in single);
    assert.equal(Object.keys(single).length, 1);
    const ds = single.deepseek as Record<string, unknown>;
    assert.equal(typeof ds.status, "string");
    assert.equal(typeof ds.model, "string");
  } finally {
    await daemon.close();
  }
});

test("daemon settings defaultProvider change flows into omitted inline task fields", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-defprov-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    await daemonRequest("settings_update", {
      patch: { execution: { defaultProvider: "qwen", defaultEffort: "low" } },
    }, home);

    // Submit a task that omits provider; daemon should use effective settings
    const task = await daemonRequest<TaskRecord>(
      "submit",
      {
        baseDirectory: home,
        task: {
          version: 2,
          name: "default-provider-task",
          project: path.join(home, "missing-project"),
          contract: {
            outcome: "Verify provider default",
            context: ["Test"],
            inScope: ["Test"],
            outOfScope: ["Nothing"],
            executionSteps: ["Run test"],
            deliverables: ["Result"],
            modules: [{ name: "m", responsibility: "test module stuff", consumes: ["x"], produces: ["y"], boundaries: ["z"] }],
            callChain: ["A -> B", "B -> C"],
            scenarios: [{ name: "s1", given: "x", when: "y", then: "z" }, { name: "s2", given: "a", when: "b", then: "c" }],
            risks: ["None"],
            changeBudget: { maxFiles: 3, maxDiffLines: 100 },
          },
          runtime: { name: "claude-code" },
          worker: { allowedCommands: [], focusPaths: ["src"] },
          acceptance: { criteria: ["Works"], commands: ["true"] },
        },
      },
      home,
    );
    assert.equal(task.spec.provider.name, "qwen");
    assert.equal(task.spec.provider.model, "qwen3.7-plus"); // qwen default model from settings
    assert.equal(task.spec.runtime.effort, "low");
  } finally {
    await daemon.close();
  }
});

test("daemon health providers reflect persisted Provider defaults", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-provhealth-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    // Update provider defaults to a non-built-in model and endpoint.
    await daemonRequest("settings_update", {
      patch: {
        providerDefaults: {
          deepseek: {
            defaultModel: "deepseek-v4-pro",
            defaultEndpoint: "https://api.deepseek-custom.example.com/anthropic",
            defaultKeychainService: "forklight.deepseek.custom-key",
          },
        },
      },
    }, home);

    const health = await daemonRequest<Record<string, unknown>>("health", {}, home);
    const providers = health.providers as Record<string, Record<string, unknown>>;
    assert.ok(providers.deepseek, "health must include deepseek provider");
    assert.equal(providers.deepseek.defaultModel, "deepseek-v4-pro");
    assert.equal(providers.deepseek.endpoint, "https://api.deepseek-custom.example.com/anthropic");
    assert.equal(providers.deepseek.keychainService, "forklight.deepseek.custom-key");

    // Verify other providers retain their defaults.
    assert.ok(providers.qwen, "health must include qwen provider");
    assert.ok(providers.glm, "health must include glm provider");
    assert.equal(providers.qwen!.defaultModel, "qwen3.7-plus");
    assert.equal(providers.glm!.defaultModel, "glm-5.2");

    // Never exposes credential values.
    const serialized = JSON.stringify(health);
    assert.equal(serialized.includes("password"), false);
    assert.equal(serialized.includes("secret"), false);
    assert.equal(serialized.includes("apiKey"), false);
  } finally {
    await daemon.close();
  }
});

// --- task_economics daemon integration ---

test("task_economics returns separated economics evidence via the daemon", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-econ-daemon-"));
  // Pre-seed a Task, Attempt, and exchange receipt into the database before
  // starting the daemon so the daemon's StateStore picks them up.
  {
    const store = new StateStore(home);
    const TS = "2026-07-23T12:00:00.000Z";
    store.createTask({
      id: "econ-known", name: "econ-known", status: "succeeded",
      sourcePath: "/tmp/src", taskFile: "/tmp/econ-known.yaml",
      spec: {
        version: 2, name: "econ-known", project: "/tmp/proj",
        provider: { name: "deepseek", model: "deepseek-v4-pro", endpoint: "https://api.deepseek.com", keychainService: "fk" },
        runtime: { name: "claude-code", executable: "claude", effort: "medium", maxBudgetUsd: 10 },
        workspace: { exclude: [] },
        worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
        contract: { outcome: "", context: [], inScope: [], outOfScope: [], executionSteps: [], deliverables: [],
          modules: [{ name: "m", responsibility: "r", consumes: ["x"], produces: ["y"], boundaries: ["z"] }],
          callChain: ["A -> B"], scenarios: [{ name: "s1", given: "x", when: "y", then: "z" }],
          risks: ["None"], changeBudget: { maxFiles: 3, maxDiffLines: 100 } },
        acceptance: { criteria: [], commands: ["true"] },
      },
      paths: { root: "/x", baseline: "/x", workspace: "/x", logs: "/x", claudeConfig: "/x", diff: "/x" },
      sessionId: "s-econ-known", createdAt: TS, updatedAt: TS,
    } as TaskRecord);
    store.createAttempt({
      id: "ea1", taskId: "econ-known", ordinal: 1, status: "succeeded",
      sessionId: "s-econ-known", rawLogPath: "/tmp/ea1.log",
      startedAt: TS, finishedAt: TS, exitCode: 0,
      usage: { inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
        source: "terminal-result" as const, complete: true },
      runtimeCostEstimateUsd: 3.25,
      officialCost: {
        stage: "calculation" as const, quoted: true as const,
        result: {
          quoted: true as const, currency: "USD" as const, total: 0.07,
          components: [
            { component: "input", tokens: 1000, ratePerMillion: 0.5, amount: 0.5 },
            { component: "output", tokens: 1000, ratePerMillion: 1.0, amount: 1.0 },
          ],
          pricing: {
            provider: "deepseek", origin: "https://api.deepseek.com", route: "deepseek-direct-payg",
            modelAliases: ["deepseek-v4-pro"], serviceTier: "standard", currency: "USD" as const,
            unitTokens: 1_000_000,
            source: { url: "https://api-docs.deepseek.com/quick_start/pricing/", checkedAt: TS },
            promotion: null,
          },
          appliedTier: { applied: [{ minimumInputTokensExclusive: null, totalPromptInput: 1000 }], totalPromptInput: 1000 },
          usageSource: "terminal-result" as const, providerBillClaim: false,
        },
      },
    });
    store.saveExchangeReceipt({
      id: "er1", taskId: "econ-known", operation: "build", transport: "mcp" as const,
      capturedAt: TS, outcome: "success" as const,
      requestArguments: { direction: "request", operation: "build", taskId: "econ-known",
        timestamp: TS, utf8Bytes: 1000, asciiCount: 900, nonAsciiCount: 100 },
      responseRelationship: "may-overlap" as const,
    });
    store.close();
  }

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const report = await daemonRequest<Record<string, unknown>>(
      "task_economics", { taskId: "econ-known" }, home,
    );
    assert.equal(report.taskId, "econ-known");
    // Budget: capped
    const budget = report.runtimeBudget as Record<string, unknown>;
    assert.equal(budget.maxBudgetUsd, 10);
    assert.equal(budget.capped, true);
    assert.equal(budget.label, "capped");
    // Runtime estimate: complete
    const est = report.runtimeEstimate as Record<string, unknown>;
    assert.equal(est.observedTotalUsd, 3.25);
    assert.equal(est.complete, true);
    // Official cost: USD, not a provider bill
    const oc = report.officialCost as Record<string, unknown>;
    const totals = oc.totals as Array<Record<string, unknown>>;
    assert.equal(totals.length, 1);
    assert.equal(totals[0]!.currency, "USD");
    assert.equal(totals[0]!.total, 0.07);
    assert.equal(totals[0]!.providerBillClaim, false);
    // Token report: Worker volume present; Codex savings unavailable
    const tr = report.tokenReport as Record<string, unknown>;
    assert.equal(tr.taskId, "econ-known");
    const trr = tr.report as Record<string, unknown>;
    const dcs = trr.directCodexSavings as Record<string, unknown>;
    assert.equal(dcs.available, false);
    assert.ok(typeof dcs.reason === "string" && (dcs.reason as string).length > 0,
      "directCodexSavings must state an explicit unavailable reason");
    const wv = trr.workerVolume as Record<string, unknown>;
    assert.ok(wv.kind === "complete" || wv.kind === "incomplete",
      `workerVolume kind must be complete or incomplete, got ${String(wv.kind)}`);
    // No raw task contract, diff, or credentials leaked
    const json = JSON.stringify(report);
    assert.ok(!json.includes("outcome"), "report must not leak contract body");
    assert.ok(!json.includes("executionSteps"), "report must not leak contract body");
    assert.ok(!json.includes("resultText"), "report must not leak attempt result");
    assert.ok(!json.includes("error"), "report must not leak attempt error");
    assert.ok(!json.includes("rawLogPath"), "report must not leak log paths");
    assert.ok(!json.includes("keychainService"), "report must not leak keychain identifier");
  } finally {
    await daemon.close();
  }
});

test("task_economics reports unavailable evidence explicitly through daemon", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-econ-unavail-"));
  {
    const store = new StateStore(home);
    const TS = "2026-07-23T12:00:00.000Z";
    store.createTask({
      id: "econ-missing", name: "econ-missing", status: "interrupted",
      sourcePath: "/tmp/src", taskFile: "/tmp/econ-missing.yaml",
      spec: {
        version: 2, name: "econ-missing", project: "/tmp/proj",
        provider: { name: "deepseek", model: "deepseek-v4-pro", endpoint: "https://api.deepseek.com", keychainService: "fk" },
        runtime: { name: "claude-code", executable: "claude", effort: "medium", maxBudgetUsd: null },
        workspace: { exclude: [] },
        worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
        contract: { outcome: "", context: [], inScope: [], outOfScope: [], executionSteps: [], deliverables: [],
          modules: [], callChain: [], scenarios: [], risks: [], changeBudget: { maxFiles: 1, maxDiffLines: 100 } },
        acceptance: { criteria: [], commands: ["true"] },
      },
      paths: { root: "/x", baseline: "/x", workspace: "/x", logs: "/x", claudeConfig: "/x", diff: "/x" },
      sessionId: "s-econ-missing", createdAt: TS, updatedAt: TS,
    } as TaskRecord);
    // Attempt without official cost and without runtimeCostEstimateUsd
    store.createAttempt({
      id: "eb1", taskId: "econ-missing", ordinal: 1, status: "interrupted",
      sessionId: "s-econ-missing", rawLogPath: "/tmp/eb1.log",
      startedAt: TS, finishedAt: TS, exitCode: 0,
    });
    // Attempt with usage but without officialCost — usage only, no quote
    store.createAttempt({
      id: "eb2", taskId: "econ-missing", ordinal: 2, status: "interrupted",
      sessionId: "s-econ-missing", rawLogPath: "/tmp/eb2.log",
      startedAt: TS, finishedAt: TS, exitCode: 0,
      usage: { inputTokens: 500, outputTokens: 250, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
        source: "terminal-result" as const, complete: true },
      runtimeCostEstimateUsd: 1.5,
    });
    store.close();
  }

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const report = await daemonRequest<Record<string, unknown>>(
      "task_economics", { taskId: "econ-missing" }, home,
    );
    // Budget: uncapped
    const budget = report.runtimeBudget as Record<string, unknown>;
    assert.equal(budget.maxBudgetUsd, null);
    assert.equal(budget.capped, false);
    assert.equal(budget.label, "uncapped");
    // Runtime: incomplete — one estimate, one missing
    const est = report.runtimeEstimate as Record<string, unknown>;
    assert.equal(est.observedTotalUsd, 1.5);
    assert.equal(est.sampleCount, 1);
    assert.equal(est.missingCount, 1);
    assert.equal(est.complete, false);
    // Official cost: both unavailable, no zero-fabrication
    const oc = report.officialCost as Record<string, unknown>;
    const unavailable = oc.unavailable as Record<string, unknown>;
    assert.equal(unavailable.unavailableCount, 2);
    const entries = unavailable.entries as Array<Record<string, unknown>>;
    assert.equal(entries.length, 2);
    // No officialCost record → missing stage
    assert.equal(entries[0]!.stage, "missing");
    assert.equal(entries[0]!.reason, "missing-officialCost-record");
    assert.equal(entries[1]!.stage, "missing");
    assert.equal(entries[1]!.reason, "missing-officialCost-record");
    // Totals are empty — no currency totals fabricated
    const totals = oc.totals as Array<unknown>;
    assert.equal(totals.length, 0);
    // Token report: directCodexSavings unavailable
    const tr = report.tokenReport as Record<string, unknown>;
    const trr = tr.report as Record<string, unknown>;
    const dcs = trr.directCodexSavings as Record<string, unknown>;
    assert.equal(dcs.available, false);
    assert.ok(typeof dcs.reason === "string" && (dcs.reason as string).length > 0);
  } finally {
    await daemon.close();
  }
});

test("task_economics rejects nonexistent Task through the existing error path", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-econ-missing-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    await assert.rejects(
      async () => daemonRequest("task_economics", { taskId: "no-such-task" }, home),
      /Unknown ForkLight task/,
    );
  } finally {
    await daemon.close();
  }
});

// --- economics_summary daemon integration ---

test("economics_summary returns portfolio summary via the daemon", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-econ-summary-daemon-"));
  {
    const store = new StateStore(home);
    const TS = "2026-07-23T12:00:00.000Z";
    store.createTask({
      id: "es1", name: "es1", status: "succeeded",
      sourcePath: "/tmp/src", taskFile: "/tmp/es1.yaml",
      spec: {
        version: 2, name: "es1", project: "/tmp/proj",
        provider: { name: "deepseek", model: "deepseek-v4-pro", endpoint: "https://api.deepseek.com", keychainService: "fk" },
        runtime: { name: "claude-code", executable: "claude", effort: "medium", maxBudgetUsd: 10 },
        workspace: { exclude: [] },
        worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
        contract: { outcome: "", context: [], inScope: [], outOfScope: [], executionSteps: [], deliverables: [],
          modules: [], callChain: [], scenarios: [], risks: [], changeBudget: { maxFiles: 1, maxDiffLines: 100 } },
        acceptance: { criteria: [], commands: ["true"] },
      },
      paths: { root: "/x", baseline: "/x", workspace: "/x", logs: "/x", claudeConfig: "/x", diff: "/x" },
      sessionId: "s-es1", createdAt: TS, updatedAt: TS,
    } as TaskRecord);
    store.createAttempt({
      id: "ea-es1", taskId: "es1", ordinal: 1, status: "succeeded",
      sessionId: "s-es1", rawLogPath: "/tmp/ea-es1.log",
      startedAt: TS, finishedAt: TS, exitCode: 0,
      usage: { inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
        source: "terminal-result" as const, complete: true },
      runtimeCostEstimateUsd: 3.25,
      runtimeBudgetUsd: 10,
      officialCost: {
        stage: "calculation" as const, quoted: true as const,
        result: {
          quoted: true as const, currency: "USD" as const, total: 0.07,
          components: [],
          pricing: {
            provider: "deepseek", origin: "https://api.deepseek.com", route: "deepseek-direct-payg",
            modelAliases: ["deepseek-v4-pro"], serviceTier: "standard", currency: "USD" as const,
            unitTokens: 1_000_000,
            source: { url: "https://api-docs.deepseek.com/quick_start/pricing/", checkedAt: TS },
            promotion: null,
          },
          appliedTier: { applied: [{ minimumInputTokensExclusive: null, totalPromptInput: 1000 }], totalPromptInput: 1000 },
          usageSource: "terminal-result" as const, providerBillClaim: false,
        },
      },
    });
    // Also seed a stable queued Task which must be excluded. A running Task
    // is intentionally recovered as interrupted when the daemon starts.
    store.createTask({
      id: "es2-running", name: "es2-running", status: "queued",
      sourcePath: "/tmp/src", taskFile: "/tmp/es2.yaml",
      spec: {
        version: 2, name: "es2-running", project: "/tmp/proj",
        provider: { name: "deepseek", model: "deepseek-v4-pro", endpoint: "https://api.deepseek.com", keychainService: "fk" },
        runtime: { name: "claude-code", executable: "claude", effort: "medium", maxBudgetUsd: 5 },
        workspace: { exclude: [] },
        worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
        contract: { outcome: "", context: [], inScope: [], outOfScope: [], executionSteps: [], deliverables: [],
          modules: [], callChain: [], scenarios: [], risks: [], changeBudget: { maxFiles: 1, maxDiffLines: 100 } },
        acceptance: { criteria: [], commands: ["true"] },
      },
      paths: { root: "/x", baseline: "/x", workspace: "/x", logs: "/x", claudeConfig: "/x", diff: "/x" },
      sessionId: "s-es2", createdAt: TS, updatedAt: TS,
    } as TaskRecord);
    store.close();
  }

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const s = await daemonRequest<Record<string, unknown>>(
      "economics_summary", {}, home,
    );
    // Scope
    const scope = s.scope as Record<string, unknown>;
    assert.equal(scope.terminalTaskCount, 1, "running task excluded");
    assert.equal(scope.nonEmpty, true);

    // Budget
    const budget = s.runtimeBudget as Record<string, unknown>;
    assert.equal(budget.configuredFiniteCapSumUsd, 10);
    assert.equal(budget.cappedAttemptCount, 1);
    assert.equal(budget.uncappedAttemptCount, 0);
    assert.equal(budget.unknownAttemptCount, 0);
    assert.equal(budget.complete, true);

    // Runtime estimate
    const est = s.runtimeEstimate as Record<string, unknown>;
    assert.equal(est.observedTotalUsd, 3.25);
    assert.equal(est.sampleCount, 1);
    assert.equal(est.missingCount, 0);
    assert.equal(est.complete, true);

    // Official cost
    const oc = s.officialCost as Record<string, unknown>;
    const ct = oc.currencyTotals as Array<Record<string, unknown>>;
    assert.equal(ct.length, 1);
    assert.equal(ct[0]!.currency, "USD");
    assert.equal(ct[0]!.total, 0.07);
    assert.equal(ct[0]!.providerBillClaim, false);

    // Worker volume
    const wv = s.workerVolume as Record<string, unknown>;
    assert.ok(typeof wv.grossWorkerTokens === "number");
    assert.equal(wv.completeTaskCount, 1);

    // Direct-Codex savings: unavailable
    const dcs = s.directCodexSavings as Record<string, unknown>;
    assert.equal(dcs.availableTaskCount, 0);
    assert.equal(dcs.unavailableTaskCount, 1);

    // No legacy costUsd leak
    const json = JSON.stringify(s);
    assert.ok(!json.includes("costUsd"), "summary must not contain costUsd");
    assert.ok(!json.includes("keychainService"));
    assert.ok(!json.includes("resultText"));
    assert.ok(!json.includes("rawLogPath"));
  } finally {
    await daemon.close();
  }
});

test("economics_summary accepts optional filter parameters", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-econ-summary-filter-"));
  {
    const store = new StateStore(home);
    const TS = "2026-07-23T12:00:00.000Z";
    store.createTask({
      id: "ef-ds", name: "ef-ds", status: "succeeded",
      sourcePath: "/tmp/src", taskFile: "/tmp/ef-ds.yaml",
      spec: {
        version: 2, name: "ef-ds", project: "/tmp/proj",
        provider: { name: "deepseek", model: "deepseek-v4-pro", endpoint: "https://api.deepseek.com", keychainService: "fk" },
        runtime: { name: "claude-code", executable: "claude", effort: "medium", maxBudgetUsd: 5 },
        workspace: { exclude: [] },
        worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
        contract: { outcome: "", context: [], inScope: [], outOfScope: [], executionSteps: [], deliverables: [],
          modules: [], callChain: [], scenarios: [], risks: [], changeBudget: { maxFiles: 1, maxDiffLines: 100 } },
        acceptance: { criteria: [], commands: ["true"] },
      },
      paths: { root: "/x", baseline: "/x", workspace: "/x", logs: "/x", claudeConfig: "/x", diff: "/x" },
      sessionId: "s-ef-ds", createdAt: TS, updatedAt: TS,
    } as TaskRecord);
    store.createTask({
      id: "ef-mm", name: "ef-mm", status: "succeeded",
      sourcePath: "/tmp/src", taskFile: "/tmp/ef-mm.yaml",
      spec: {
        version: 2, name: "ef-mm", project: "/tmp/proj",
        provider: { name: "minimax", model: "m3", endpoint: "https://api.minimax.io", keychainService: "fk" },
        runtime: { name: "claude-code", executable: "claude", effort: "medium", maxBudgetUsd: 15 },
        workspace: { exclude: [] },
        worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
        contract: { outcome: "", context: [], inScope: [], outOfScope: [], executionSteps: [], deliverables: [],
          modules: [], callChain: [], scenarios: [], risks: [], changeBudget: { maxFiles: 1, maxDiffLines: 100 } },
        acceptance: { criteria: [], commands: ["true"] },
      },
      paths: { root: "/x", baseline: "/x", workspace: "/x", logs: "/x", claudeConfig: "/x", diff: "/x" },
      sessionId: "s-ef-mm", createdAt: TS, updatedAt: TS,
    } as TaskRecord);
    store.createAttempt({
      id: "ea-ef-ds", taskId: "ef-ds", ordinal: 1, status: "succeeded",
      sessionId: "s-ef-ds", rawLogPath: "/tmp/ea-ef-ds.log",
      startedAt: TS, finishedAt: TS, exitCode: 0,
      runtimeBudgetUsd: 5,
    });
    store.createAttempt({
      id: "ea-ef-mm", taskId: "ef-mm", ordinal: 1, status: "succeeded",
      sessionId: "s-ef-mm", rawLogPath: "/tmp/ea-ef-mm.log",
      startedAt: TS, finishedAt: TS, exitCode: 0,
      runtimeBudgetUsd: 15,
    });
    store.close();
  }

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    // Filter by provider
    const s = await daemonRequest<Record<string, unknown>>(
      "economics_summary", { providerName: "minimax" }, home,
    );
    const scope = s.scope as Record<string, unknown>;
    assert.equal(scope.terminalTaskCount, 1);
    const budget = s.runtimeBudget as Record<string, unknown>;
    assert.equal(budget.configuredFiniteCapSumUsd, 15);

    // Filter by model
    const s2 = await daemonRequest<Record<string, unknown>>(
      "economics_summary", { modelName: "deepseek-v4-pro" }, home,
    );
    const scope2 = s2.scope as Record<string, unknown>;
    assert.equal(scope2.terminalTaskCount, 1);

    // Unfiltered returns both
    const s3 = await daemonRequest<Record<string, unknown>>(
      "economics_summary", {}, home,
    );
    const scope3 = s3.scope as Record<string, unknown>;
    assert.equal(scope3.terminalTaskCount, 2);
  } finally {
    await daemon.close();
  }
});

test("economics_summary empty store returns nonEmpty false with zero denominators", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-econ-summary-empty-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const s = await daemonRequest<Record<string, unknown>>(
      "economics_summary", {}, home,
    );
    const scope = s.scope as Record<string, unknown>;
    assert.equal(scope.terminalTaskCount, 0);
    assert.equal(scope.nonEmpty, false);
    const budget = s.runtimeBudget as Record<string, unknown>;
    assert.equal(budget.complete, false);
  } finally {
    await daemon.close();
  }
});

// --- routing_evidence_coverage daemon integration ---

test("routing_evidence_coverage returns privacy-safe aggregate via the daemon", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-rec-coverage-daemon-"));
  {
    const store = new StateStore(home);
    const TS = "2026-07-30T12:00:00.000Z";
    const worker = {
      provider: "xai", model: "grok-4.5", runtime: "grok-build", effort: "high",
      workerProfileId: "local-grok-builder",
    };
    const routingDecision = {
      taskFamily: "hub-explainability",
      shortlist: [worker],
      selectedWorker: worker,
      selectedBecause: {
        code: "user-specified",
        note: "private Main reason must not leave the daemon aggregate",
      },
      competition: { intent: "none" as const, triggers: [] as [] },
      evidenceSnapshot: { scope: "none" as const, exactSampleCounts: {} },
    };
    const baseSpec = {
      version: 2 as const,
      name: "rec",
      project: "/tmp/proj",
      provider: {
        name: "xai", model: "grok-4.5",
        endpoint: "https://api.x.ai", keychainService: "fk-secret",
      },
      runtime: {
        name: "grok-build" as const, executable: "grok",
        effort: "high" as const, maxBudgetUsd: 2,
      },
      workspace: { exclude: [] as string[] },
      worker: {
        allowEdits: true, allowedCommands: [] as string[], focusPaths: [] as string[],
      },
      contract: {
        outcome: "o", context: [] as string[], inScope: [] as string[],
        outOfScope: [] as string[], executionSteps: [] as string[],
        deliverables: [] as string[], modules: [], callChain: [] as string[],
        scenarios: [], risks: [] as string[],
        changeBudget: { maxFiles: 1, maxDiffLines: 10 },
      },
      acceptance: { criteria: [] as string[], commands: ["true"] },
    };
    store.createTask({
      id: "rec-legacy", name: "rec-legacy", status: "succeeded",
      sourcePath: "/tmp/src/private", taskFile: "/tmp/rec-legacy.yaml",
      spec: { ...baseSpec, name: "rec-legacy" },
      paths: {
        root: "/x", baseline: "/x", workspace: "/x",
        logs: "/x", claudeConfig: "/x", diff: "/x",
      },
      sessionId: "s-rec-legacy", createdAt: TS, updatedAt: TS,
    } as TaskRecord);
    store.createTask({
      id: "rec-complete", name: "rec-complete", status: "succeeded",
      sourcePath: "/tmp/src/private", taskFile: "/tmp/rec-complete.yaml",
      spec: {
        ...baseSpec,
        name: "rec-complete",
        taskClass: "hub-routing-evidence-coverage",
        taskFamily: "hub-explainability",
        routingDecision,
      },
      paths: {
        root: "/x", baseline: "/x", workspace: "/x",
        logs: "/x", claudeConfig: "/x", diff: "/x",
      },
      sessionId: "s-rec-complete", createdAt: TS, updatedAt: TS,
    } as TaskRecord);
    store.createTask({
      id: "rec-reviewer", name: "rec-reviewer", status: "succeeded",
      sourcePath: "/tmp/src/private",
      taskFile: "forklight://review-graph/g1/a1",
      spec: {
        ...baseSpec,
        name: "rec-reviewer",
        taskClass: "review-graph-reviewer",
        taskFamily: "review-graph",
        routingDecision: {
          ...routingDecision,
          taskFamily: "review-graph",
        },
      },
      paths: {
        root: "/x", baseline: "/x", workspace: "/x",
        logs: "/x", claudeConfig: "/x", diff: "/x",
      },
      sessionId: "s-rec-reviewer", createdAt: TS, updatedAt: TS,
    } as TaskRecord);
    store.close();
  }

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const coverage = await daemonRequest<Record<string, unknown>>(
      "routing_evidence_coverage", {}, home,
    );
    assert.equal(coverage.eligibleTerminalTaskCount, 2);
    assert.equal(coverage.withTaskClassCount, 1);
    assert.equal(coverage.withTaskFamilyCount, 1);
    assert.equal(coverage.withCompleteRoutingDecisionCount, 1);
    assert.equal(coverage.distinctTaskClassCount, 1);
    assert.equal(coverage.distinctTaskFamilyCount, 1);
    assert.equal(coverage.singleWorkerDecisionCount, 1);
    assert.equal(coverage.comparableMultiWorkerDecisionCount, 0);
    assert.equal(coverage.comparableExactClassDecisionCount, 0);
    assert.equal(coverage.comparableTaskFamilyDecisionCount, 0);
    assert.equal(coverage.unknownMultiWorkerDecisionCount, 0);
    assert.equal(coverage.unusableDecisionCount, 0);

    const json = JSON.stringify(coverage);
    assert.ok(!json.includes("private Main reason"));
    assert.ok(!json.includes("/tmp/src/private"));
    assert.ok(!json.includes("fk-secret"));
    assert.ok(!json.includes("keychainService"));
    assert.ok(!json.includes("hub-routing-evidence-coverage"));
    assert.ok(!json.includes("local-grok-builder"));
  } finally {
    await daemon.close();
  }
});

test("routing_evidence_coverage empty store returns zero denominators", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-rec-coverage-empty-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const coverage = await daemonRequest<Record<string, unknown>>(
      "routing_evidence_coverage", {}, home,
    );
    assert.equal(coverage.eligibleTerminalTaskCount, 0);
    assert.equal(coverage.withTaskClassCount, 0);
    assert.equal(coverage.withTaskFamilyCount, 0);
    assert.equal(coverage.withCompleteRoutingDecisionCount, 0);
    assert.equal(coverage.distinctTaskClassCount, 0);
    assert.equal(coverage.distinctTaskFamilyCount, 0);
    assert.equal(coverage.singleWorkerDecisionCount, 0);
    assert.equal(coverage.comparableMultiWorkerDecisionCount, 0);
    assert.equal(coverage.comparableExactClassDecisionCount, 0);
    assert.equal(coverage.comparableTaskFamilyDecisionCount, 0);
    assert.equal(coverage.unknownMultiWorkerDecisionCount, 0);
    assert.equal(coverage.unusableDecisionCount, 0);
  } finally {
    await daemon.close();
  }
});

// --- self_upgrade_evidence daemon integration ---

test("self_upgrade_evidence returns 1/3 for success after retained-failure via daemon", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sue-daemon-"));
  {
    const store = new StateStore(home);
    const TS_OK = "2026-07-30T12:00:00.000Z";
    const TS_FAIL = "2026-07-30T11:00:00.000Z";
    const four = [
      { stage: "source-applied" as const, status: "passed" as const },
      { stage: "source-verified" as const, status: "passed" as const },
      { stage: "artifact-built" as const, status: "passed" as const },
      { stage: "runtime-activated" as const, status: "passed" as const },
    ];
    const baseTask = (id: string, createdAt: string): TaskRecord => ({
      id,
      name: id,
      status: "succeeded",
      sourcePath: "/tmp/src/private",
      taskFile: `/tmp/${id}.yaml`,
      spec: {
        version: 1,
        name: id,
        project: "/tmp/proj",
        goal: "g",
        constraints: [],
        provider: {
          name: "xai", model: "grok-4.5",
          endpoint: "https://api.x.ai", keychainService: "fk-secret",
        },
        runtime: {
          name: "grok-build", executable: "grok",
          effort: "high", maxBudgetUsd: 2,
        },
        workspace: { exclude: [] },
        worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
        acceptance: { commands: ["true"] },
      },
      paths: {
        root: "/x", baseline: "/x", workspace: "/x",
        logs: "/x", claudeConfig: "/x", diff: "/x",
      },
      sessionId: `s-${id}`,
      createdAt,
      updatedAt: createdAt,
    } as TaskRecord);

    store.createTask(baseTask("task-sue-ok", TS_OK));
    store.createTask(baseTask("task-sue-fail", TS_FAIL));
    const selfUpgradePlan = {
      resolutionSource: "explicit" as const,
      profileId: "forklight-self-upgrade",
      buildCommandCount: 1,
      activationCommandCount: 1,
      activationCheckCommandCount: 1,
      outcome: "activation" as const,
      stages: {
        sourceApply: "required" as const,
        sourceVerify: "required" as const,
        artifactBuild: "required" as const,
        runtimeActivation: "required" as const,
      },
    };
    store.saveIntegrationReceipt({
      id: "receipt-sue-ok",
      taskId: "task-sue-ok",
      patchDigest: "a".repeat(64),
      affectedFiles: ["src/a.ts"],
      rejectionReasons: [],
      sourceEvidence: {},
      createdAt: TS_OK,
      expiresAt: "2099-01-01T00:00:00.000Z",
      consumed: true,
      deliveryPlan: selfUpgradePlan,
    });
    store.saveIntegrationResult({
      id: "efa7d9ae-61c9-421a-a1b5-d427d9353a81",
      receiptId: "receipt-sue-ok",
      taskId: "task-sue-ok",
      status: "applied",
      appliedAt: TS_OK,
      createdAt: TS_OK,
      stages: four,
    });
    store.saveIntegrationReceipt({
      id: "receipt-sue-fail",
      taskId: "task-sue-fail",
      patchDigest: "b".repeat(64),
      affectedFiles: ["src/b.ts"],
      rejectionReasons: [],
      sourceEvidence: {},
      createdAt: TS_FAIL,
      expiresAt: "2099-01-01T00:00:00.000Z",
      consumed: true,
      deliveryPlan: selfUpgradePlan,
    });
    store.saveIntegrationResult({
      id: "66ba9a77-f518-4a37-836f-043e2b70c316",
      receiptId: "receipt-sue-fail",
      taskId: "task-sue-fail",
      status: "retained-failure",
      createdAt: TS_FAIL,
      error: "activation retained: /Users/private/path token=sk-live-abc",
      stages: [
        { stage: "source-applied", status: "passed" },
        { stage: "source-verified", status: "passed" },
        { stage: "artifact-built", status: "passed" },
        {
          stage: "runtime-activated",
          status: "failed",
          error: "secret /Users/private/path",
        },
      ],
    });
    store.close();
  }

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const evidence = await daemonRequest<Record<string, unknown>>(
      "self_upgrade_evidence",
      { required: 3 },
      home,
    );
    assert.equal(evidence.achieved, 1);
    assert.equal(evidence.required, 3);
    assert.equal(evidence.remaining, 2);
    assert.equal(evidence.state, "in-progress");
    assert.equal(evidence.breakCategory, "retained-failure");
    assert.equal(evidence.nextAction, "continue-consecutive-proofs");
    assert.equal(
      evidence.latestQualifyingOperationId,
      "efa7d9ae-61c9-421a-a1b5-d427d9353a81",
    );

    const again = await daemonRequest<Record<string, unknown>>(
      "self_upgrade_evidence",
      { required: 3 },
      home,
    );
    assert.deepEqual(again, evidence);

    const json = JSON.stringify(evidence);
    assert.ok(!json.includes("sk-live"));
    assert.ok(!json.includes("/Users/private"));
    assert.ok(!json.includes("activation retained"));
    assert.ok(!json.includes("fk-secret"));
    assert.ok(!json.includes("keychainService"));

    await assert.rejects(
      () => daemonRequest("self_upgrade_evidence", { required: 0 }, home),
      /1 to 20/,
    );
    await assert.rejects(
      () => daemonRequest("self_upgrade_evidence", { required: 21 }, home),
      /1 to 20/,
    );
  } finally {
    await daemon.close();
  }
});

test("self_upgrade_evidence empty store is 0/3 ready for first upgrade", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sue-empty-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const evidence = await daemonRequest<Record<string, unknown>>(
      "self_upgrade_evidence",
      {},
      home,
    );
    assert.equal(evidence.achieved, 0);
    assert.equal(evidence.required, 3);
    assert.equal(evidence.state, "empty");
    assert.equal(evidence.nextAction, "run-first-upgrade");
    assert.equal(evidence.breakCategory, "none");
  } finally {
    await daemon.close();
  }
});

test("daemon plan submission works with spaces in directory path", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight spaced path test-"));
  const planFile = path.join(home, "two wave plan.yaml");
  const taskRef = path.resolve("examples/deepseek-checkout.yaml");
  await writeFile(
    planFile,
    JSON.stringify({
      version: 1,
      name: "Plan with spaces in directory",
      objective: "Verify spaces in paths do not break plan registration",
      items: [
        { id: "foundation", task: taskRef, dependsOn: [] },
        { id: "second", task: taskRef, dependsOn: ["foundation"] },
      ],
    }),
  );

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const result = await daemonRequest<{
      planId: string;
      taskIdsByItemId: Record<string, string>;
    }>("plan_submit_file", { planFile }, home);
    assert.equal(result.planId, planFile);
    assert.equal(Object.keys(result.taskIdsByItemId).length, 2);
    assert.ok(result.taskIdsByItemId.foundation);
    assert.ok(result.taskIdsByItemId.second);

    // Verify tasks are registered.
    const board = await daemonRequest<PlanBoard>(
      "plan_board",
      { planId: result.planId },
      home,
    );
    assert.equal(board.plan.progress.total, 2);
  } finally {
    await daemon.close();
  }
});

// --- revise: succeeded-only pre-integration correction ---

test("daemon records explicit Main Codex review and rejects missing confirm", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-main-review-daemon-"));
  const store = new StateStore(home);
  const task = standaloneSucceededTask(store, "main-review-daemon");
  seedPassingVerification(store, task);
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    await assert.rejects(
      () => daemonRequest("main_review", {
        taskId: task.id,
        decision: "accept",
        reason: "Reviewed",
      }, home),
      /confirm/,
    );
    const review = await daemonRequest<Record<string, unknown>>("main_review", {
      taskId: task.id,
      decision: "accept",
      reason: "Diff is scoped and independently verified",
      confirm: true,
    }, home);
    assert.equal(review.decision, "accept");
    assert.equal(review.attemptId, store.getTask(task.id).currentAttemptId);
  } finally {
    await daemon.close();
    store.close();
  }
});

test("revise moves eligible succeeded task to queued with content-free event", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-revise-ok-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  const task = standaloneSucceededTask(store, "eligible-standalone");
  const verifiedAttemptId = seedPassingVerification(store, task);
  // Seed live-attempt pointers so prepareReviseTask must clear them.
  store.setTaskStatus(task.id, "running", {
    startedAt: new Date().toISOString(),
    currentAttemptId: verifiedAttemptId,
    workerPid: 99999,
  });
  store.setTaskStatus(task.id, "succeeded", { error: null });
  const feedback = `Please tighten the contract. ${REVISE_PROBE}`;
  try {
    const returned = coordinator.revise(task.id, feedback);
    assert.equal(returned.id, task.id);
    assert.equal(returned.status, "queued",
      "revise must return the canonical queued record");
    const after = store.getTask(task.id);
    assert.equal(after.status, "queued");
    // Every terminal and live-attempt field is cleared; sessionId is preserved.
    for (const cleared of ["finishedAt", "error", "workerPid", "currentAttemptId", "startedAt"] as const) {
      assert.equal(after[cleared], undefined, `${cleared} must be cleared`);
    }
    assert.equal(after.sessionId, task.sessionId);
    // Content-free revision event with the canonical fixed summary.
    const revisionEvent = store.listEvents(task.id)
      .find((event) => event.type === "task.revise.requested");
    assert.ok(revisionEvent, "task.revise.requested event must be recorded");
    assert.equal(revisionEvent!.summary, "Task revision requested for main-review correction");
    assert.ok(!JSON.stringify(revisionEvent).includes(REVISE_PROBE),
      "revision event payload must never contain feedback text");
    assert.deepEqual(coordinator.health().queuedTaskIds, [task.id]);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("revise rejection gates: each ineligibility is rejected with a fixed privacy-safe reason", async () => {
  const cases: Array<{
    label: string;
    homePrefix: string;
    seed: (store: StateStore, task: TaskRecord) => void;
    expectedStatus?: TaskRecord["status"];
    reason: RegExp;
  }> = [
    {
      label: "non-succeeded", homePrefix: "forklight-revise-status-",
      seed: () => { /* status set to "failed" by helper */ },
      expectedStatus: "failed", reason: /revision requires succeeded Task/,
    },
    {
      label: "plan-member", homePrefix: "forklight-revise-plan-",
      seed: (store, task) => {
        const ts = new Date().toISOString();
        store.createPlanGraph(
          { id: "p1", name: "p1", objective: "test", planFile: "/tmp/p1.yaml",
            createdAt: ts, updatedAt: ts },
          [{ id: "p1-item", planId: "p1", taskId: task.id, itemIndex: 0, taskFile: "/tmp/p1.yaml" }],
          [],
        );
      },
      reason: /revision rejected: Task belongs to a plan/,
    },
    {
      label: "competition-candidate", homePrefix: "forklight-revise-comp-",
      seed: (store, task) => {
        const sibling = standaloneSucceededTask(store, "comp-sibling");
        const ts = new Date().toISOString();
        store.createCompetition(
          { id: "c1", name: "c1", contractTaskId: task.id, status: "running",
            rankingPolicy: { weights: { verification: 1, diffFocus: 0, retries: 0, cost: 0, duration: 0, delivery: 0 },
              tieThreshold: 1e-9 },
            createdAt: ts, updatedAt: ts },
          [
            { id: "cc1", competitionId: "c1", taskId: task.id, ordinal: 0,
              providerName: "deepseek", modelName: "deepseek-v4-flash" },
            { id: "cc2", competitionId: "c1", taskId: sibling.id, ordinal: 1,
              providerName: "deepseek", modelName: "deepseek-v4-flash" },
          ],
        );
      },
      reason: /revision rejected: Task is a competition candidate/,
    },
    {
      label: "integration-history", homePrefix: "forklight-revise-int-",
      seed: (store, task) => {
        // Persist a canonical integration receipt first (FK requirement),
        // then its result; any IntegrationResult status keeps the Task ineligible.
        const ts = new Date().toISOString();
        store.saveIntegrationReceipt({
          id: "ir-r", taskId: task.id, patchDigest: "x", affectedFiles: [],
          rejectionReasons: [], sourceEvidence: {}, createdAt: ts,
          expiresAt: ts, consumed: false,
        });
        store.saveIntegrationResult({
          id: "ir1", receiptId: "ir-r", taskId: task.id, status: "rejected",
          createdAt: ts,
        });
      },
      reason: /revision rejected: Task has integration history/,
    },
    {
      label: "exhausted-attempts", homePrefix: "forklight-revise-exhausted-",
      seed: (store, task) => {
        for (const id of ["a1", "a2"]) {
          store.createAttempt({ id, taskId: task.id, ordinal: Number(id.slice(1)),
            status: "succeeded", sessionId: task.sessionId, rawLogPath: "/dev/null",
            startedAt: new Date().toISOString() });
        }
      },
      reason: /revision requires remaining configured attempts/,
    },
  ];
  for (const c of cases) {
    const home = await mkdtemp(path.join(tmpdir(), c.homePrefix));
    const store = new StateStore(home);
    let coordinator: DaemonCoordinator;
    if (c.label === "exhausted-attempts") {
      const settings = new SettingsService(store);
      settings.update({ execution: { maxAttempts: 2 } });
      coordinator = new DaemonCoordinator(store, settings, 0);
    } else {
      coordinator = testCoordinator(store, 0);
    }
    const task = standaloneSucceededTask(store, c.label,
      c.label === "non-succeeded" ? "failed" : "succeeded");
    c.seed(store, task);
    const initialEvents = store.listEvents(task.id).length;
    try {
      assert.throws(
        () => coordinator.revise(task.id, "fix the contract"),
        c.reason,
        `case ${c.label} must reject with ${c.reason}`,
      );
      assert.equal(store.getTask(task.id).status, c.expectedStatus ?? "succeeded",
        `case ${c.label} must not change Task status`);
      assert.equal(store.listEvents(task.id).length, initialEvents,
        `case ${c.label} must not append events`);
    } finally {
      await coordinator.shutdown();
      store.close();
    }
  }
});

test("revise rejects blank/padded/oversized feedback with the character limit on the trimmed value", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-revise-fb-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  const task = standaloneSucceededTask(store, "feedback");
  seedPassingVerification(store, task);
  const initialEvents = store.listEvents(task.id).length;
  try {
    for (const blank of ["", "   ", "\n\n", " \t \n"]) {
      assert.throws(
        () => coordinator.revise(task.id, blank),
        /revision requires explicit trimmed feedback/,
        `blank feedback ${JSON.stringify(blank)} must be rejected`,
      );
    }
    // 1000 trimmed chars wrapped in spaces is accepted (limit is on the
    // canonical structured main-review reason, not its padding).
    const accepted = coordinator.revise(task.id, `   ${"x".repeat(1000)}   `);
    assert.equal(accepted.status, "queued");
    // 1001 trimmed chars is rejected regardless of padding.
    assert.throws(
      () => coordinator.revise(task.id, `   ${"y".repeat(1001)}   `),
      /revision feedback exceeds configured upper bound/,
    );
    assert.equal(store.getTask(task.id).status, "queued",
      "successful revise must have moved status before the second reject");
    // First revise added exactly one event; the second (rejected) revise added none.
    const newEvents = store.listEvents(task.id).slice(initialEvents);
    assert.equal(newEvents.filter((e) => e.type === "task.revise.requested").length, 1);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("revise rejection messages never echo feedback marker, name, path, or prompt", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-revise-privacy-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  // Pre-create the task so its name and the pre-existing task.created event
  // intentionally carry the probe.  The privacy guarantee is about the
  // rejection delta, not the legacy creation event.
  const task = registerTaskFromSpec(
    store,
    {
      version: 1,
      name: `${REVISE_PROBE}-name`,
      project: `/tmp/${REVISE_PROBE}-source`,
      goal: `goal ${REVISE_PROBE}`,
      constraints: [],
      provider: { name: "deepseek", model: "deepseek-v4-flash",
        keychainService: "forklight.test.api-key" },
      runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: 0.1 },
      workspace: { exclude: [] },
      worker: { allowEdits: false, allowedCommands: [], focusPaths: ["src"] },
      acceptance: { commands: ["true"] },
    },
    `forklight://test/${REVISE_PROBE}`,
  );
  store.setTaskStatus(task.id, "failed", { error: null });
  const countBefore = store.listEvents(task.id).length;
  let caught: unknown;
  try {
    coordinator.revise(task.id, `some ${REVISE_PROBE} feedback text`);
    assert.fail("revise should have rejected");
  } catch (error) { caught = error; }
  const message = caught instanceof Error ? caught.message : String(caught);
  assert.ok(!message.includes(REVISE_PROBE),
    `rejection message must never echo feedback, got: ${message}`);
  assert.equal(store.getTask(task.id).status, "failed");
  // Inspect ONLY the post-request event delta; a rejection must create
  // zero new events.
  const delta = store.listEvents(task.id).slice(countBefore);
  assert.equal(delta.length, 0,
    `rejection must not append any new events, got: ${JSON.stringify(delta)}`);
  assert.ok(!JSON.stringify(delta).includes(REVISE_PROBE),
    "rejection event delta must never contain feedback marker text");
  await coordinator.shutdown();
  store.close();
});

test("revise preserves prior attempts and the same session, clearing stale live-attempt state", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-revise-history-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  const task = standaloneSucceededTask(store, "preserve-history");
  const previousSessionId = task.sessionId;
  const ts = new Date().toISOString();
  for (const a of [
    { id: "ha1", ordinal: 1, status: "succeeded" as const, exitCode: 0 },
    { id: "ha2", ordinal: 2, status: "succeeded" as const, exitCode: 0 },
  ]) {
    store.createAttempt({ ...a, taskId: task.id, sessionId: previousSessionId,
      rawLogPath: "/dev/null", startedAt: ts, finishedAt: ts });
  }
  seedPassingVerification(store, task, "ha2");
  const eventsBefore = store.listEvents(task.id).length;
  try {
    coordinator.revise(task.id, "fix the contract please");
    // Previous attempts remain immutable; sessionId preserved.
    const attempts = store.listAttempts(task.id);
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts.map((a) => a.id), ["ha1", "ha2"]);
    assert.equal(store.getTask(task.id).sessionId, previousSessionId);
    // Stale live-attempt fields are cleared.
    const cleared = store.getTask(task.id);
    for (const f of ["finishedAt", "error", "workerPid", "currentAttemptId", "startedAt"] as const) {
      assert.equal(cleared[f], undefined, `${f} must be cleared`);
    }
    // Only the revision event is appended; no integration or workspace mutation.
    const afterRevise = store.listEvents(task.id);
    assert.equal(afterRevise.length, eventsBefore + 2);
    assert.equal(afterRevise[afterRevise.length - 1]!.type, "task.revise.requested");
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("revise keeps ordinary resume rejecting succeeded tasks", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-revise-resume-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  const task = standaloneSucceededTask(store, "succeeded-no-resume");
  try {
    assert.throws(
      () => coordinator.resume(task.id, "any feedback"),
      /cannot resume from status succeeded/,
    );
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("revise admission rejection leaves status, attempts, and events unchanged", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-revise-admit-"));
  const store = new StateStore(home);
  // maxConcurrency=0 so pump() never processes queued jobs — the job
  // stays in the coordinator's internal queue after a successful revise.
  const coordinator = testCoordinator(store, 0);
  const task = standaloneSucceededTask(store, "admission-dupe");
  seedPassingVerification(store, task);
  const initialEvents = store.listEvents(task.id).length;
  try {
    // First revise succeeds and leaves a job in the queue.
    coordinator.revise(task.id, "first revise pass");
    assert.equal(store.getTask(task.id).status, "queued");
    // Reset task status to succeeded so eligibility passes on the
    // second call — but the coordinator's internal queue still holds
    // the first job.
    store.setTaskStatus(task.id, "succeeded", {
      finishedAt: new Date().toISOString(), error: null,
    });
    // Second revise must reject BEFORE mutating the task because the
    // coordinator already has this task in the queue.
    assert.throws(
      () => coordinator.revise(task.id, "second revise attempt"),
      /already queued or running/,
    );
    // Task status, attempts, and events are unchanged by the rejection.
    assert.equal(store.getTask(task.id).status, "succeeded");
    assert.equal(store.listEvents(task.id).length, initialEvents + 2,
      "only the first structured review and revise events must exist; rejection appends nothing");
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("revise rejects when daemon is closing before any task mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-revise-close-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  const task = standaloneSucceededTask(store, "close-reject");
  const initialEvents = store.listEvents(task.id).length;
  try {
    await coordinator.shutdown(); // sets coordinator.closing = true
    assert.throws(
      () => coordinator.revise(task.id, "valid feedback text"),
      /shutting down/,
    );
    // Status unchanged; no events added.
    assert.equal(store.getTask(task.id).status, "succeeded");
    assert.equal(store.listEvents(task.id).length, initialEvents);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("daemon revise routes non-string feedback through shared eligibility boundary", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-revise-nonstr-"));
  const store = new StateStore(home);
  const task = standaloneSucceededTask(store, "nonstr-feedback");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    // Every non-string feedback value must produce the same canonical
    // "missing-feedback" reason as the local fallback, never echoing
    // the raw value.
    for (const nonString of [null, 123, true, [], {}]) {
      await assert.rejects(
        async () => daemonRequest("revise", { taskId: task.id, feedback: nonString }, home),
        /revision requires explicit trimmed feedback/,
      );
    }
    // Status unchanged after all rejections.
    assert.equal(store.getTask(task.id).status, "succeeded",
      "non-string feedback rejection must not mutate task status");
  } finally {
    await daemon.close();
    store.close();
  }
});

// --- direct-codex workflow daemon integration ---

const DC_EVENT = {
  type: "turn.completed",
  usage: { input_tokens: 4000, cached_input_tokens: 1000, cache_write_input_tokens: 0, output_tokens: 500, reasoning_output_tokens: 100 },
};

function dcMeta(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    sampleId: overrides?.sampleId ?? "dc-smp",
    forklightTaskId: overrides?.forklightTaskId ?? "dc-task",
    exactTaskClass: overrides?.exactTaskClass ?? "dc-class",
    directCodexProfileId: overrides?.directCodexProfileId ?? "dc-prof",
    directRunRef: overrides?.directRunRef ?? "codex-run:dc-run-abcd",
    pairingRef: overrides?.pairingRef ?? "pair:dc-pair-xyz",
    capturedAt: overrides?.capturedAt ?? "2026-07-23T12:00:00.000Z",
  };
}

function seedTaskForDC(home: string, taskId: string, taskClass: string, profileId: string): void {
  const store = new StateStore(home);
  const spec = parseTaskSpec({ version: 1, name: taskId, project: "/tmp", goal: "T",
    taskClass, directCodexProfileId: profileId, acceptance: { commands: ["true"] } }, "/tmp");
  store.createTask(buildTaskRecord({ spec, taskFile: `/tmp/${taskId}.yaml`, home, id: taskId,
    sessionId: `s-${taskId}`, createdAt: "2026-07-23T12:00:00.000Z" }));
  store.close();
}

test("daemon direct_codex_capture persists and returns canonical sample", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-dc-cap-daemon-"));
  seedTaskForDC(home, "dc-task", "dc-class", "dc-prof");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const s = await daemonRequest<Record<string, unknown>>(
      "direct_codex_capture",
      { usage: DC_EVENT, metadata: dcMeta({ forklightTaskId: "dc-task" }) },
      home,
    );
    assert.equal(s.sampleId, "dc-smp");
    assert.equal(s.forklightTaskId, "dc-task");
    assert.equal(s.exactTaskClass, "dc-class");
    assert.equal(s.inputTokens, 3000); // uncached only
    assert.equal(s.outputTokens, 500);
    assert.equal(s.complete, true);

    // Inbox shows pending
    const inbox = await daemonRequest<Array<Record<string, unknown>>>(
      "direct_codex_inbox",
      { taskClass: "dc-class", directCodexProfileId: "dc-prof" },
      home,
    );
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0]!.reviewState, "pending");
  } finally {
    await daemon.close();
  }
});

test("daemon direct_codex_review and publication pipeline", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-dc-pub-daemon-"));
  seedTaskForDC(home, "dc-task", "dc-class", "dc-prof");
  seedTaskForDC(home, "dc-task2", "dc-class", "dc-prof");
  seedTaskForDC(home, "dc-task3", "dc-class", "dc-prof");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    await daemonRequest("direct_codex_capture", { usage: DC_EVENT, metadata: dcMeta({ sampleId: "s1", forklightTaskId: "dc-task", directRunRef: "codex-run:s1", pairingRef: "pair:s1" }) }, home);
    await daemonRequest("direct_codex_capture", { usage: DC_EVENT, metadata: dcMeta({ sampleId: "s2", forklightTaskId: "dc-task2", directRunRef: "codex-run:s2", pairingRef: "pair:s2" }) }, home);
    await daemonRequest("direct_codex_capture", { usage: DC_EVENT, metadata: dcMeta({ sampleId: "s3", forklightTaskId: "dc-task3", directRunRef: "codex-run:s3", pairingRef: "pair:s3" }) }, home);

    // Review s1 accepted, s2 rejected, s3 left pending
    await daemonRequest("direct_codex_review", { confirm: true, sampleId: "s1", decision: "accepted", reviewer: "main-codex", reviewedAt: "2026-07-23T12:00:00.000Z", schemaVersion: 1 }, home);
    await daemonRequest("direct_codex_review", { confirm: true, sampleId: "s2", decision: "rejected", rejectionReason: "incomplete-evidence", reviewer: "main-codex", reviewedAt: "2026-07-23T12:00:00.000Z", schemaVersion: 1 }, home);

    const inbox = await daemonRequest<Array<Record<string, unknown>>>("direct_codex_inbox", { taskClass: "dc-class", directCodexProfileId: "dc-prof" }, home);
    assert.equal(inbox.length, 3);
    const states = inbox.map(it => it.reviewState).sort();
    assert.deepEqual(states, ["accepted", "pending", "rejected"]);

    // Preview
    const p = await daemonRequest<Record<string, unknown>>("direct_codex_publication_preview", { taskClass: "dc-class", directCodexProfileId: "dc-prof" }, home);
    assert.equal(p.acceptedCount, 1); assert.equal(p.rejectedCount, 1); assert.equal(p.pendingCount, 1);
    assert.equal(p.readiness, "ready"); assert.deepEqual(p.acceptedSampleIds, ["s1"]);

    // Register
    const r = await daemonRequest<Record<string, unknown>>("direct_codex_publication_register", {
      confirm: true, method: "paired-sample-v1", confidence: "low",
      createdAt: "2026-07-23T12:00:00.000Z", taskClass: "dc-class", directCodexProfileId: "dc-prof",
    }, home);
    assert.equal((r.summary as Record<string, unknown>).version, 1);
    assert.deepEqual((r.summary as Record<string, unknown>).acceptedSampleIds, ["s1"]);
  } finally {
    await daemon.close();
  }
});

test("daemon direct_codex_review rejects missing confirm and duplicate decisions", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-dc-revguard-daemon-"));
  seedTaskForDC(home, "dc-task", "dc-class", "dc-prof");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    await daemonRequest("direct_codex_capture", { usage: DC_EVENT, metadata: dcMeta({ sampleId: "g1", forklightTaskId: "dc-task", directRunRef: "codex-run:g1", pairingRef: "pair:g1" }) }, home);

    // Missing confirm
    await assert.rejects(
      async () => daemonRequest("direct_codex_review", { sampleId: "g1", decision: "accepted", reviewer: "main-codex", reviewedAt: "2026-07-23T12:00:00.000Z", schemaVersion: 1 }, home),
      /Review requires explicit confirm true/,
    );

    // Valid review
    await daemonRequest("direct_codex_review", { confirm: true, sampleId: "g1", decision: "accepted", reviewer: "main-codex", reviewedAt: "2026-07-23T12:00:00.000Z", schemaVersion: 1 }, home);

    // Duplicate
    await assert.rejects(
      async () => daemonRequest("direct_codex_review", { confirm: true, sampleId: "g1", decision: "rejected", rejectionReason: "incomplete-evidence", reviewer: "main-codex", reviewedAt: "2026-07-23T12:00:00.000Z", schemaVersion: 1 }, home),
      /Review already exists for this sample/,
    );
  } finally {
    await daemon.close();
  }
});

test("daemon direct_codex errors never echo payload content", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-dc-priv-daemon-"));
  seedTaskForDC(home, "dc-task", "dc-class", "dc-prof");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const secret = "daemon-dc-leak-ABC";
  try {
    await assert.rejects(
      async () => daemonRequest("direct_codex_capture", { usage: null, metadata: dcMeta() }, home),
      /Invalid Codex/,
    );
    // Corrupt review payload should not echo
    await daemonRequest("direct_codex_capture", { usage: DC_EVENT, metadata: dcMeta({ sampleId: "p1", forklightTaskId: "dc-task", directRunRef: "codex-run:p1", pairingRef: "pair:p1" }) }, home);
    await assert.rejects(
      async () => daemonRequest("direct_codex_review", { confirm: true, sampleId: "p1", decision: "accepted", reviewer: "main-codex", reviewedAt: "2026-07-23T12:00:00.000Z", schemaVersion: 1, text: secret }, home),
      /Invalid direct-Codex/,
    );
  } finally {
    await daemon.close();
  }
});

test("daemon direct_codex_publication_register rejects missing confirm", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-dc-regnoconf-daemon-"));
  seedTaskForDC(home, "dc-task", "dc-class", "dc-prof");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    await daemonRequest("direct_codex_capture", { usage: DC_EVENT, metadata: dcMeta({ sampleId: "r1", forklightTaskId: "dc-task", directRunRef: "codex-run:r1", pairingRef: "pair:r1" }) }, home);
    await daemonRequest("direct_codex_review", { confirm: true, sampleId: "r1", decision: "accepted", reviewer: "main-codex", reviewedAt: "2026-07-23T12:00:00.000Z", schemaVersion: 1 }, home);
    await assert.rejects(
      async () => daemonRequest("direct_codex_publication_register", {
        method: "v1", confidence: "low", createdAt: "2026-07-23T12:00:00.000Z",
        taskClass: "dc-class", directCodexProfileId: "dc-prof",
      }, home),
      /Registration requires explicit confirm true/,
    );
  } finally {
    await daemon.close();
  }
});

test("revise via daemon protocol surfaces the same eligibility and privacy behavior", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-revise-daemon-"));
  const store = new StateStore(home);
  const task = standaloneSucceededTask(store, "daemon-eligible");
  seedPassingVerification(store, task);
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const queued = await daemonRequest<TaskRecord>(
      "revise", { taskId: task.id, feedback: `daemon ${REVISE_PROBE} feedback` }, home,
    );
    assert.equal(queued.id, task.id);
    assert.equal(queued.status, "queued",
      "daemon must return the canonical queued record");
    assert.equal(store.getTask(task.id).status, "queued");
    const events = store.listEvents(task.id);
    const review = events.find((event) => event.type === "main-review.completed");
    assert.equal(
      (review?.payload as { decision?: string } | undefined)?.decision,
      "revise",
    );
    const revision = events.find((event) => event.type === "task.revise.requested");
    assert.ok(!JSON.stringify(revision).includes(REVISE_PROBE),
      "content-free revision event must not contain review reason");
    // Whitespace-only feedback is rejected by the shared eligibility
    // boundary with the same fixed privacy-safe reason the local fallback uses.
    await assert.rejects(
      async () => daemonRequest("revise", { taskId: task.id, feedback: "   " }, home),
      /revision requires explicit trimmed feedback/,
    );
    // Plan membership must surface the same fixed rejection reason — use a
    // fresh task whose status remains succeeded so the eligibility branch
    // reaches the plan-membership check (not the status check).
    const planTask = standaloneSucceededTask(store, "daemon-plan-member");
    const planTs = new Date().toISOString();
    store.createPlanGraph(
      { id: "plan-d", name: "plan-d", objective: "test", planFile: "/tmp/plan-d.yaml",
        createdAt: planTs, updatedAt: planTs },
      [{ id: "item-d", planId: "plan-d", taskId: planTask.id, itemIndex: 0, taskFile: "/tmp/plan-d.yaml" }],
      [],
    );
    await assert.rejects(
      async () => daemonRequest("revise", { taskId: planTask.id, feedback: "eligible" }, home),
      /revision rejected: Task belongs to a plan/,
    );
  } finally {
    await daemon.close();
    store.close();
  }
});

// --- Task-derived guided direct-Codex capture ---

function seedCalibrationReadyTask(home: string, taskId: string, taskClass: string, profileId: string): void {
  const store = new StateStore(home);
  const spec = parseTaskSpec({ version: 1, name: taskId, project: "/tmp", goal: "T",
    taskClass, directCodexProfileId: profileId, acceptance: { commands: ["true"] } }, "/tmp");
  store.createTask(buildTaskRecord({ spec, taskFile: `/tmp/${taskId}.yaml`, home, id: taskId,
    sessionId: `s-${taskId}`, createdAt: "2026-07-23T12:00:00.000Z" }));
  store.close();
}

function seedNonCalibrationTask(home: string, taskId: string): void {
  const store = new StateStore(home);
  // Intentionally omit both taskClass and directCodexProfileId.
  const spec = parseTaskSpec({ version: 1, name: taskId, project: "/tmp", goal: "T",
    acceptance: { commands: ["true"] } }, "/tmp");
  store.createTask(buildTaskRecord({ spec, taskFile: `/tmp/${taskId}.yaml`, home, id: taskId,
    sessionId: `s-${taskId}`, createdAt: "2026-07-23T12:00:00.000Z" }));
  store.close();
}

const GC_USAGE = {
  type: "turn.completed",
  usage: { input_tokens: 4000, cached_input_tokens: 1000, cache_write_input_tokens: 0, output_tokens: 500, reasoning_output_tokens: 100 },
};

test("daemon direct_codex_guided_capture derives identity from stored Task and creates pending sample", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-dc-gc-ok-"));
  seedCalibrationReadyTask(home, "gc-task", "gc-class", "gc-prof");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const s = await daemonRequest<Record<string, unknown>>(
      "direct_codex_guided_capture",
      { forklightTaskId: "gc-task", codexRunRef: "codex-run:gc-run", usage: GC_USAGE },
      home,
    );
    // Identity derived from the stored Task, not from caller-provided metadata.
    assert.equal(s.forklightTaskId, "gc-task");
    assert.equal(s.exactTaskClass, "gc-class");
    assert.equal(s.directCodexProfileId, "gc-prof");
    assert.equal(s.directRunRef, "codex-run:gc-run");
    // Counts from canonical Codex terminal usage adapter — uncached input only.
    assert.equal(s.inputTokens, 3000); // 4000 - 1000 - 0
    assert.equal(s.outputTokens, 500);
    assert.equal(s.complete, true);
    // Generated opaque identifiers are content-free.
    assert.equal(typeof s.sampleId, "string");
    assert.match(s.sampleId as string, /^smp-/);
    assert.equal(typeof s.pairingRef, "string");
    assert.match(s.pairingRef as string, /^pair:/);
    assert.equal(typeof s.capturedAt, "string");

    // Sample appears in the exact pair inbox as pending.
    const inbox = await daemonRequest<Array<Record<string, unknown>>>(
      "direct_codex_inbox",
      { taskClass: "gc-class", directCodexProfileId: "gc-prof" },
      home,
    );
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0]!.reviewState, "pending");
    assert.deepEqual(inbox[0]!.sample, s);
  } finally {
    await daemon.close();
  }
});

test("daemon direct_codex_guided_capture rejects task missing calibration identity", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-dc-gc-noid-"));
  seedNonCalibrationTask(home, "gc-noid");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    await assert.rejects(
      async () => daemonRequest("direct_codex_guided_capture", {
        forklightTaskId: "gc-noid",
        codexRunRef: "codex-run:gc-run",
        usage: GC_USAGE,
      }, home),
      /Task is not calibration-ready: taskClass and directCodexProfileId are required/,
    );
  } finally {
    await daemon.close();
  }
});

test("daemon direct_codex_guided_capture rejects task missing only directCodexProfileId", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-dc-gc-mispro-"));
  const store = new StateStore(home);
  const spec = parseTaskSpec({ version: 1, name: "gc-mispro", project: "/tmp", goal: "T",
    taskClass: "gc-class", acceptance: { commands: ["true"] } }, "/tmp");
  store.createTask(buildTaskRecord({ spec, taskFile: "/tmp/gc-mispro.yaml", home, id: "gc-mispro",
    sessionId: "s-gc-mispro", createdAt: "2026-07-23T12:00:00.000Z" }));
  store.close();
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    await assert.rejects(
      async () => daemonRequest("direct_codex_guided_capture", {
        forklightTaskId: "gc-mispro",
        codexRunRef: "codex-run:gc-run",
        usage: GC_USAGE,
      }, home),
      /Task is not calibration-ready: taskClass and directCodexProfileId are required/,
    );
  } finally {
    await daemon.close();
  }
});

test("daemon direct_codex_guided_capture rejects task missing only taskClass", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-dc-gc-miscls-"));
  const store = new StateStore(home);
  const spec = parseTaskSpec({ version: 1, name: "gc-miscls", project: "/tmp", goal: "T",
    directCodexProfileId: "gc-prof", acceptance: { commands: ["true"] } }, "/tmp");
  store.createTask(buildTaskRecord({ spec, taskFile: "/tmp/gc-miscls.yaml", home, id: "gc-miscls",
    sessionId: "s-gc-miscls", createdAt: "2026-07-23T12:00:00.000Z" }));
  store.close();
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    await assert.rejects(
      async () => daemonRequest("direct_codex_guided_capture", {
        forklightTaskId: "gc-miscls",
        codexRunRef: "codex-run:gc-run",
        usage: GC_USAGE,
      }, home),
      /Task is not calibration-ready: taskClass and directCodexProfileId are required/,
    );
  } finally {
    await daemon.close();
  }
});

test("daemon direct_codex_guided_capture rejects malformed usage through canonical validation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-dc-gc-badusg-"));
  seedCalibrationReadyTask(home, "gc-task", "gc-class", "gc-prof");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const secret = "gc-leak-XYZ";
  try {
    for (const badUsage of [null, 42, "not-obj", { type: "turn.completed" }, { prompt: secret }]) {
      await assert.rejects(
        async () => daemonRequest("direct_codex_guided_capture", {
          forklightTaskId: "gc-task",
          codexRunRef: "codex-run:gc-run",
          usage: badUsage,
        }, home),
        /Invalid Codex/,
      );
    }
  } finally {
    await daemon.close();
  }
});

test("daemon direct_codex_guided_capture rejects duplicate capture via Store UNIQUE guard", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-dc-gc-dup-"));
  seedCalibrationReadyTask(home, "gc-task", "gc-class", "gc-prof");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    // First capture succeeds.
    const first = await daemonRequest<Record<string, unknown>>(
      "direct_codex_guided_capture",
      { forklightTaskId: "gc-task", codexRunRef: "codex-run:gc-run", usage: GC_USAGE },
      home,
    );
    assert.equal(typeof first.sampleId, "string");

    // Same task with same run ref → duplicate rejection.
    await assert.rejects(
      async () => daemonRequest("direct_codex_guided_capture", {
        forklightTaskId: "gc-task",
        codexRunRef: "codex-run:gc-run",
        usage: GC_USAGE,
      }, home),
      { name: "Error", message: "Duplicate sample identity rejected" },
    );

    // Inbox still has exactly one sample — no partial write occurred.
    const inbox = await daemonRequest<Array<Record<string, unknown>>>(
      "direct_codex_inbox",
      { taskClass: "gc-class", directCodexProfileId: "gc-prof" },
      home,
    );
    assert.equal(inbox.length, 1);
  } finally {
    await daemon.close();
  }
});

test("daemon direct_codex_guided_capture errors are privacy-safe and never echo content", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-dc-gc-priv-"));
  seedCalibrationReadyTask(home, "gc-task", "gc-class", "gc-prof");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const secret = "GC-PRIV-LEAK";
  try {
    // Malformed usage — fixed error from canonical Codex usage adapter.
    await assert.rejects(
      async () => daemonRequest("direct_codex_guided_capture", {
        forklightTaskId: "gc-task",
        codexRunRef: "codex-run:gc-run",
        usage: { prompt: secret },
      }, home),
      /Invalid Codex/,
    );

    // Bad runRef format — fixed error from canonical normalizer, never echoes.
    await assert.rejects(
      async () => daemonRequest("direct_codex_guided_capture", {
        forklightTaskId: "gc-task",
        codexRunRef: secret,
        usage: GC_USAGE,
      }, home),
      /Invalid direct-Codex/,
    );

    // Non-string forklightTaskId — fixed TypeError before any Store access.
    await assert.rejects(
      async () => daemonRequest("direct_codex_guided_capture", {
        forklightTaskId: null,
        codexRunRef: "codex-run:gc-run",
        usage: GC_USAGE,
      }, home),
      /Invalid forklightTaskId/,
    );

    // Unknown caller-supplied task id — fixed content-free error, never echoes.
    const secretTaskId = `unknown-gc-${secret}`;
    let unknownTaskError: unknown;
    try {
      await daemonRequest("direct_codex_guided_capture", {
        forklightTaskId: secretTaskId,
        codexRunRef: "codex-run:gc-run",
        usage: GC_USAGE,
      }, home);
      assert.fail("guided capture must reject unknown task id");
    } catch (e) {
      unknownTaskError = e;
    }
    assert.ok(unknownTaskError instanceof Error);
    const errorMessage = (unknownTaskError as Error).message;
    assert.equal(errorMessage, "ForkLight Task not found for guided capture");
    assert.ok(!errorMessage.includes(secretTaskId),
      "error message must not echo caller-supplied task id");
    assert.ok(!errorMessage.includes(secret),
      "error message must not echo embedded secret");

    // Verify no sample was created after all error paths.
    const inbox = await daemonRequest<Array<Record<string, unknown>>>(
      "direct_codex_inbox",
      { taskClass: "gc-class", directCodexProfileId: "gc-prof" },
      home,
    );
    assert.equal(inbox.length, 0);
  } finally {
    await daemon.close();
  }
});

async function createStaleSocket(socketPath: string): Promise<void> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  const moved = `${socketPath}.stale`;
  await rename(socketPath, moved);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rename(moved, socketPath);
}

test("daemon start rejects an active endpoint without stealing it", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-active-socket-"));
  const first = new ForkLightDaemon(home, 0);
  const second = new ForkLightDaemon(home, 0);
  await first.start();
  try {
    await assert.rejects(() => second.start(), /already running/);
    assert.equal((await daemonRequest<Record<string, unknown>>("health", {}, home)).ok, true);
  } finally {
    await second.close();
    await first.close();
  }
});

test("daemon start recovers a real stale Unix socket", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-stale-socket-"));
  await createStaleSocket(daemonSocketPath(home));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    assert.equal((await daemonRequest<Record<string, unknown>>("health", {}, home)).ok, true);
  } finally {
    await daemon.close();
  }
});

test("daemon start refuses a socket replaced after its stale probe", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-socket-race-"));
  const socketPath = daemonSocketPath(home);
  await createStaleSocket(socketPath);
  const daemon = new ForkLightDaemon(home, 0);
  let replacement: net.Server | undefined;
  const probe = daemon as unknown as { probeSocketEndpoint: () => Promise<boolean> };
  probe.probeSocketEndpoint = async () => {
    replacement = net.createServer();
    const replacementPath = `${socketPath}.replacement`;
    await new Promise<void>((resolve, reject) => {
      replacement?.once("error", reject);
      replacement?.listen(replacementPath, resolve);
    });
    await rename(replacementPath, socketPath);
    return false;
  };
  try {
    await assert.rejects(() => daemon.start(), /changed after probing/);
  } finally {
    await daemon.close();
    if (replacement) await new Promise<void>((resolve) => replacement?.close(() => resolve()));
    try { await unlink(socketPath); } catch { /* removed */ }
  }
});

test("late daemon close preserves a replacement endpoint", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-late-close-"));
  const socketPath = daemonSocketPath(home);
  const daemon = new ForkLightDaemon(home, 0);
  const replacement = net.createServer();
  let daemonClosed = false;
  await daemon.start();
  try {
    const replacementPath = `${socketPath}.replacement`;
    await new Promise<void>((resolve, reject) => {
      replacement.once("error", reject);
      replacement.listen(replacementPath, resolve);
    });
    await rename(replacementPath, socketPath);
    await daemon.close();
    daemonClosed = true;
    const reachable = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection(socketPath);
      socket.setTimeout(500);
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => resolve(false));
      socket.once("timeout", () => { socket.destroy(); resolve(false); });
    });
    assert.equal(reachable, true);
  } finally {
    if (!daemonClosed) try { await daemon.close(); } catch { /* best effort */ }
    await new Promise<void>((resolve) => replacement.close(() => resolve()));
    try { await unlink(socketPath); } catch { /* removed */ }
  }
});

test("stop and restart wait for the exact old daemon PID", async () => {
  const fixture = await DetachedDaemonFixture.create("forklight-exact-stop-");
  try {
    const first = await fixture.ensureReady();
    const firstPid = first.pid as number;
    assert.ok(Number.isSafeInteger(firstPid) && firstPid > 0);
    const replacement = await fixture.restart();
    assert.notEqual(replacement.pid, firstPid);
    assert.throws(() => process.kill(firstPid, 0), /ESRCH/);
  } finally {
    await fixture.cleanup();
  }
});

// --- single-dispatch routing seam ---

const ROUTE_PROBE = "forklight-route-PROBE-2026";

test("routeMutation falls back when bootstrap fails, dispatches on success, and fails closed on dispatch error", async () => {
  // Bootstrap failure → fallback runs, dispatch never called.
  let fallbackCalled = false;
  const result = await routeMutation(
    async () => { throw new Error("ECONNREFUSED"); },
    async () => "dispatch-should-not-reach",
    async () => { fallbackCalled = true; return "fallback-ok"; },
  );
  assert.equal(result, "fallback-ok");
  assert.equal(fallbackCalled, true);

  // Bootstrap success + dispatch success → dispatch result, fallback never called.
  fallbackCalled = false;
  const dispatchResult = await routeMutation(
    async () => {},
    async () => "daemon-result",
    async () => { fallbackCalled = true; return "local"; },
  );
  assert.equal(dispatchResult, "daemon-result");
  assert.equal(fallbackCalled, false);

  // Bootstrap success + dispatch error → error propagated, fallback never called.
  const dispatchError = new Error(`daemon ${ROUTE_PROBE} build mismatch`);
  fallbackCalled = false;
  await assert.rejects(
    () => routeMutation(
      async () => {},
      async () => { throw dispatchError; },
      async () => { fallbackCalled = true; return "local"; },
    ),
    (error: unknown) => error === dispatchError,
  );
  assert.equal(fallbackCalled, false,
    "fallback must never be called after daemon dispatch begins");
});

// --- local revise admission ordering ---

test("local revise admission validates non-attempt eligibility before any authorization state mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-revise-admit-route-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const exec = settings.get().execution;
  const task = standaloneSucceededTask(store, "admit-route");
  const initialEvents = store.listEvents(task.id).length;

  // Invalid feedback: precheck with base maxAttempts rejects before
  // any durable authorization grant could be recorded.  The "exhausted-attempts"
  // shortcut is only allowed when authorization is explicitly present.
  const blankCheck = checkReviseEligibility(store, task.id, "   ", exec.maxAttempts);
  assert.equal(blankCheck.eligible, false);
  assert.equal(blankCheck.reason, "missing-feedback");
  assert.equal(store.listEvents(task.id).length, initialEvents,
    "rejection on non-attempt criteria must not append any event");
  assert.equal(
    store.listEvents(task.id).filter((e) => e.type === "attempt.authorization.granted").length, 0,
    "no authorization grant must exist after non-attempt rejection",
  );

  // Valid feedback + non-attempt eligibility: canonical feedback is available,
  // no events were appended by the read-only precheck.
  const okCheck = checkReviseEligibility(store, task.id, "valid correction", exec.maxAttempts);
  assert.equal(okCheck.eligible, true);
  assert.equal(okCheck.canonicalFeedback, "valid correction");
  assert.equal(store.listEvents(task.id).length, initialEvents);

  store.close();
});

// --- coordinator pending-grant resilience and recovery ---

const COORD_PROBE = "forklight-coord-pending-DELTA-2026";

function exhaustedCoordinatorTask(store: StateStore, name: string): { taskId: string; sessionId: string } {
  const task = registerTaskFromSpec(store, {
    version: 1, name, project: "/tmp/src",
    goal: "Coordinator pending-grant test", constraints: [],
    provider: { name: "deepseek", model: "deepseek-v4-flash", keychainService: "forklight.test" },
    runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: 1 },
    workspace: { exclude: [] },
    worker: { allowEdits: false, allowedCommands: [], focusPaths: ["src"] },
    acceptance: { commands: ["true"] },
  }, "forklight://test/coord-pending");
  const now = new Date().toISOString();
  for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
    store.createAttempt({
      id: `ca${ordinal}`, taskId: task.id, ordinal, status: "failed",
      sessionId: task.sessionId, rawLogPath: "/dev/null",
      startedAt: now, finishedAt: now, exitCode: 1,
    });
  }
  store.setTaskStatus(task.id, "failed", { error: "Independent verification failed" });
  return { taskId: task.id, sessionId: task.sessionId };
}

test("coordinator resume succeeds with pending grant and no authorization", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-coord-resume-pending-"));
  const store = new StateStore(home);
  const { taskId } = exhaustedCoordinatorTask(store, "resume-pending");
  // Authorize a durable pending grant for ordinal 4.
  authorizeExtraAttempt(store, taskId, {
    additionalAttempts: 1, maxBudgetUsd: null,
    reason: `${COORD_PROBE}-resume`, confirm: true,
  }, 3, 20, 2);
  const settings = new SettingsService(store);
  settings.update({ execution: { maxAttempts: 3, maxExtraAttempts: 2 } });
  const coordinator = testCoordinator(store, 0);
  try {
    // Resume without authorization — must succeed because a pending grant exists.
    const queued = coordinator.resume(taskId);
    assert.equal(queued.id, taskId);
    assert.deepEqual(coordinator.health().queuedTaskIds, [taskId]);
    // No second grant event was minted.
    const grants = store.listEvents(taskId).filter(
      (e) => e.type === "attempt.authorization.granted",
    );
    assert.equal(grants.length, 1, "coordinator resume must not mint duplicate grant");
    const pending = resolvePendingGrantExecutionOptions(store, taskId, 3, 2);
    assert.ok(pending !== null, "pending grant must still be resolvable");
    assert.equal(pending!.maximumOrdinal, 4);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("coordinator revise uses pending grant ordinal for eligibility and passes it to execution", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-coord-revise-pending-"));
  const store = new StateStore(home);
  const task = standaloneSucceededTask(store, "revise-pending");
  seedPassingVerification(store, task);
  // Seed a second terminal base attempt so authorizeExtraAttempt sees the
  // two terminal base attempts that the configured maxAttempts=2 requires.
  const now = new Date().toISOString();
  store.createAttempt({
    id: "coord-revise-a2", taskId: task.id, ordinal: 2, status: "succeeded",
    sessionId: task.sessionId, rawLogPath: "/dev/null",
    startedAt: now, finishedAt: now, exitCode: 0,
  });
  // Only 2 base attempts so maxAttempts=2 would normally reject revise.
  const settings = new SettingsService(store);
  settings.update({ execution: { maxAttempts: 2, maxExtraAttempts: 2 } });
  // Pre-authorize ordinal 3 as a durable pending correction grant.
  authorizeExtraAttempt(store, task.id, {
    additionalAttempts: 1, maxBudgetUsd: null,
    reason: `${COORD_PROBE}-revise`, confirm: true,
  }, 2, 20, 2);
  const coordinator = testCoordinator(store, 0);
  try {
    // Revise without authorization — must succeed with the pending grant.
    const queued = coordinator.revise(task.id, "valid revise feedback text");
    assert.equal(queued.id, task.id);
    assert.equal(queued.status, "queued");
    assert.deepEqual(coordinator.health().queuedTaskIds, [task.id]);
    // No duplicate grant event was minted.
    const grants = store.listEvents(task.id).filter(
      (e) => e.type === "attempt.authorization.granted",
    );
    assert.equal(grants.length, 1,
      "coordinator revise must not mint a duplicate grant event");
    // The pending grant is still durable after the task transition.
    const pending = resolvePendingGrantExecutionOptions(store, task.id, 2, 2);
    assert.ok(pending !== null);
    assert.equal(pending!.maximumOrdinal, 3);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("coordinator recovery enqueues tasks with pending grants reconstructing from durable events", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-coord-recover-pending-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  settings.update({ execution: { maxAttempts: 3, maxExtraAttempts: 2 } });
  // Create two tasks: one with pending grant, one without.
  // Task A: exhausted base + pending grant
  const { taskId: taskA, sessionId: sessionA } = exhaustedCoordinatorTask(store, "recover-a");
  authorizeExtraAttempt(store, taskA, {
    additionalAttempts: 1, maxBudgetUsd: null,
    reason: `${COORD_PROBE}-recover`, confirm: true,
  }, 3, 20, 2);
  // Task B: exhausted base, no pending grant
  const taskB = registerTaskFromSpec(store, {
    version: 1, name: "recover-b", project: "/tmp/src",
    goal: "Recovery test B", constraints: [],
    provider: { name: "deepseek", model: "deepseek-v4-flash", keychainService: "forklight.test" },
    runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: 1 },
    workspace: { exclude: [] },
    worker: { allowEdits: false, allowedCommands: [], focusPaths: ["src"] },
    acceptance: { commands: ["true"] },
  }, "forklight://test/recover-b");
  const now = new Date().toISOString();
  for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
    store.createAttempt({
      id: `cb${ordinal}`, taskId: taskB.id, ordinal, status: "failed",
      sessionId: taskB.sessionId, rawLogPath: "/dev/null",
      startedAt: now, finishedAt: now, exitCode: 1,
    });
  }
  store.setTaskStatus(taskB.id, "failed", { error: "Independent verification failed" });
  // Set both tasks to "running" so recovery picks them up — simulates
  // daemon restart with lost in-memory execution options.
  store.setTaskStatus(taskA, "running", {
    startedAt: now, workerPid: 99999, error: null, finishedAt: null,
  });
  store.setTaskStatus(taskB.id, "running", {
    startedAt: now, workerPid: 99999, error: null, finishedAt: null,
  });

  // Fresh coordinator to simulate daemon restart.
  const coordinator = testCoordinator(store, 0);
  try {
    const recovered = await coordinator.recover();
    assert.equal(recovered.length, 2, "both running tasks must be recovered");
    assert.ok(recovered.includes(taskA));
    assert.ok(recovered.includes(taskB.id));
    // Both tasks are now queued via recover → enqueue.  With maxConcurrency=0
    // they stay in the queue (never executed).
    const queued = coordinator.health().queuedTaskIds as string[];
    assert.equal(queued.length, 2);
    assert.ok(queued.includes(taskA));
    assert.ok(queued.includes(taskB.id));
    // Task A's pending grant is still intact and the job would reconstruct
    // it in execute() because enqueue received no executionOptions.
    const pendingA = resolvePendingGrantExecutionOptions(store, taskA, 3, 2);
    assert.ok(pendingA !== null, "task A pending grant must survive recovery");
    assert.equal(pendingA!.maximumOrdinal, 4);
    // Task B has no pending grant — verify it gets rejected during execute.
    const pendingB = resolvePendingGrantExecutionOptions(store, taskB.id, 3, 2);
    assert.equal(pendingB, null, "task B must not have a phantom pending grant");
    // No new grant events were created by recovery.
    const grantsA = store.listEvents(taskA).filter(
      (e) => e.type === "attempt.authorization.granted",
    );
    assert.equal(grantsA.length, 1);
    void sessionA;
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

// --- Activation handoff stop lifecycle ---

const HOF_PROBE = "forklight-handoff-PROBE-2026";

/** Seed a task, receipt, and Integration operation through a DaemonCoordinator
 *  so authorizeActivationHandoffShutdown has something to validate. */
async function seededIntegrationOperation(
  store: StateStore,
  coordinator: DaemonCoordinator,
  label: string,
): Promise<{ operationId: string; taskId: string; receiptId: string }> {
  const ts = new Date().toISOString();
  const expiry = new Date(Date.now() + 86_400_000).toISOString();
  const task = registerTaskFromSpec(
    store,
    {
      version: 1,
      name: `${HOF_PROBE}-${label}`,
      project: "/tmp/forklight-handoff-source",
      goal: "Exercise handoff stop",
      constraints: [],
      provider: {
        name: "deepseek", model: "deepseek-v4-flash",
        keychainService: "forklight.test.api-key",
      },
      runtime: {
        name: "claude-code", executable: "claude",
        effort: "low", maxBudgetUsd: 0.1,
      },
      workspace: { exclude: [] },
      worker: { allowEdits: false, allowedCommands: [], focusPaths: ["src"] },
      acceptance: { commands: ["true"] },
    },
    `forklight://test/${HOF_PROBE}-${label}`,
  );
  store.setTaskStatus(task.id, "succeeded", { error: null });
  const receiptId = `rec-${task.id}`;
  store.saveIntegrationReceipt({
    id: receiptId, taskId: task.id, patchDigest: "abc123",
    affectedFiles: [], rejectionReasons: [], sourceEvidence: {},
    createdAt: ts, expiresAt: expiry, consumed: false,
  });
  const operationId = `op-${task.id}`;
  const context = { operationId, taskId: task.id, receiptId };
  store.addEvent(
    task.id, undefined, "integration.operation.started",
    "Integration operation started", context,
  );
  for (const evidence of [
    { stage: "source-applied", status: "passed" },
    { stage: "source-verified", status: "passed" },
    { stage: "artifact-built", status: "not-applicable" },
  ] as const) {
    store.addEvent(
      task.id, undefined, "integration.stage.completed",
      `${evidence.stage}: ${evidence.status}`,
      { operationId, receiptId, evidence },
    );
  }
  await coordinator.recover();
  return context;
}

test("abandoned async client disconnect does not crash the daemon or cancel dispatch", async () => {
  // Real-socket regression: a client disappears while integration_wait is still
  // pending. The server-side wait must finish once, the undeliverable response
  // must not escape as EPIPE/readline noise, and the same daemon must stay
  // healthy and closable afterward.
  const home = await mkdtemp(path.join(tmpdir(), "forklight-daemon-disconnect-"));
  const seedStore = new StateStore(home);
  const seedSettings = new SettingsService(seedStore);
  const seedCoord = new DaemonCoordinator(seedStore, seedSettings, 0);
  const ids = await seededIntegrationOperation(seedStore, seedCoord, "disconnect");

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();

  const transportErrors: unknown[] = [];
  const onUncaught = (error: unknown): void => {
    transportErrors.push(error);
  };
  const onUnhandled = (reason: unknown): void => {
    transportErrors.push(reason);
  };
  process.on("uncaughtException", onUncaught);
  process.on("unhandledRejection", onUnhandled);

  try {
    const health = await daemonRequest<Record<string, unknown>>("health", {}, home);
    const pid = health.pid as number;
    assert.equal(health.ok, true);
    assert.ok(Number.isSafeInteger(pid) && pid > 0);

    const waitTimeoutMs = 300;
    const abandoned = net.createConnection(daemonSocketPath(home));
    abandoned.on("error", () => {
      // Intentional peer teardown may surface ECONNRESET/EPIPE on this client.
    });
    await new Promise<void>((resolve, reject) => {
      abandoned.once("connect", () => resolve());
      abandoned.once("error", reject);
    });
    const request = {
      id: "abandoned-wait-1",
      method: "integration_wait",
      params: { operationId: ids.operationId, timeoutMs: waitTimeoutMs },
      clientIdentity: currentBuildIdentity(),
    };
    await new Promise<void>((resolve, reject) => {
      abandoned.write(`${JSON.stringify(request)}\n`, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    // Allow the daemon to accept the line and enter waitIntegration before the
    // peer disappears, so the later response write exercises delivery loss.
    await sleep(30);
    abandoned.destroy();

    // Daemon must remain reachable while the abandoned wait is still pending.
    const during = await daemonRequest<Record<string, unknown>>("health", {}, home);
    assert.equal(during.ok, true);
    assert.equal(during.pid, pid, "same daemon PID while abandoned wait is pending");

    // Wait past the server-side timeout so the undeliverable response write is
    // attempted (and discarded) before we assert post-resolution health.
    await sleep(waitTimeoutMs + 200);

    assert.deepEqual(
      transportErrors,
      [],
      "peer disconnect must not emit uncaught socket/readline errors",
    );

    const later = await daemonRequest<Record<string, unknown>>("health", {}, home);
    assert.equal(later.ok, true);
    assert.equal(later.pid, pid, "same daemon process remains reachable after abandoned response");

    // Later clients can still inspect the operation by id.
    const status = await daemonRequest<{ operationId: string; status: string }>(
      "integration_status",
      { operationId: ids.operationId },
      home,
    );
    assert.equal(status.operationId, ids.operationId);

    // Application rejections still deliver when the client stays connected.
    await assert.rejects(
      () => daemonRequest(
        "integration_wait",
        { operationId: "missing-op", timeoutMs: 50 },
        home,
      ),
      /Unknown Integration operation/,
    );

    // Ordinary success still returns exactly one protocol response.
    const ok = await daemonExchange("health", {}, home);
    assert.equal(ok.ok, true);
    assert.equal(typeof ok.id, "string");
  } finally {
    process.off("uncaughtException", onUncaught);
    process.off("unhandledRejection", onUnhandled);
    // Shutdown after disconnect must remain bounded (no hung readline/socket).
    await daemon.close();
    await seedCoord.shutdown();
    seedStore.close();
  }
});

test("authorizeActivationHandoffShutdown validates, authorizes once with durable event and targetPid, rejects replay/mismatch/unknown", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-handoff-authz-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const coordinator = new DaemonCoordinator(store, settings, 0);
  try {
    const ids = await seededIntegrationOperation(store, coordinator, "authz");

    // First authorization succeeds and returns targetPid.
    const result = coordinator.authorizeActivationHandoffShutdown(
      ids.operationId, ids.taskId, ids.receiptId,
    );
    assert.equal(result.stopping, true);
    assert.equal(result.handoffAuthorized, true);
    assert.equal(result.targetPid, process.pid);
    assert.ok(
      store.listEvents(ids.taskId).some(
        (event) =>
          event.type === "integration.handoff.authorized"
          && (event.payload as { operationId?: string } | null)?.operationId === ids.operationId,
      ),
      "durable authorization event must be persisted",
    );

    // Replay must fail (one-use in-memory Set).
    assert.throws(
      () => coordinator.authorizeActivationHandoffShutdown(
        ids.operationId, ids.taskId, ids.receiptId,
      ),
      /already authorized/,
    );

    // Mismatched taskId must fail.
    assert.throws(
      () => coordinator.authorizeActivationHandoffShutdown(
        ids.operationId, "wrong-task-id", ids.receiptId,
      ),
      /does not match/,
    );

    // Unknown operationId must fail.
    assert.throws(
      () => coordinator.authorizeActivationHandoffShutdown(
        "nonexistent-op", "any-task", "any-rec",
      ),
      /Unknown Integration operation/,
    );
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("durable replay is rejected after coordinator reconstruction", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-handoff-durable-"));
  // Seed operation and authorize in a first coordinator instance.
  const store1 = new StateStore(home);
  const settings1 = new SettingsService(store1);
  const coord1 = new DaemonCoordinator(store1, settings1, 0);
  const ids = await seededIntegrationOperation(store1, coord1, "durable");
  coord1.authorizeActivationHandoffShutdown(
    ids.operationId, ids.taskId, ids.receiptId,
  );
  await coord1.shutdown();
  store1.close();

  // Reconstruct a fresh coordinator — simulates daemon restart.
  // The durable authorization event must be recovered so replay fails.
  const store2 = new StateStore(home);
  const settings2 = new SettingsService(store2);
  const coord2 = new DaemonCoordinator(store2, settings2, 0);
  try {
    await coord2.recover();
    assert.throws(
      () => coord2.authorizeActivationHandoffShutdown(
        ids.operationId, ids.taskId, ids.receiptId,
      ),
      /already authorized/,
      "durable replay must be rejected after coordinator reconstruction",
    );
  } finally {
    await coord2.shutdown();
    store2.close();
  }
});

test("authorizeActivationHandoffShutdown rejects when activation result already stored", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-handoff-done-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const coordinator = new DaemonCoordinator(store, settings, 0);
  try {
    const ids = await seededIntegrationOperation(store, coordinator, "done");

    coordinator.completeIntegrationActivation(
      ids.operationId, ids.taskId, ids.receiptId,
      { stage: "runtime-activated", status: "failed", error: "test" },
    );

    // Now handoff shutdown must reject.
    assert.throws(
      () => coordinator.authorizeActivationHandoffShutdown(
        ids.operationId, ids.taskId, ids.receiptId,
      ),
      /already complete/,
    );
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("stopDaemonForHandoff fails hard when the daemon is not reachable", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-handoff-gone-"));
  try {
    await assert.rejects(
      () => stopDaemonForHandoff(home, "any-op", "any-task", "any-rec"),
      /activation handoff shutdown failed/,
    );
  } finally {
    try { await stopDaemon(home); } catch { /* no-op */ }
  }
});

test("handoff client waits for the target PID and rejects a replacement PID", async () => {
  const runFixture = async (
    healthPids: number[],
  ): Promise<{ home: string; server: net.Server; healthRequests: () => number }> => {
    const home = await mkdtemp(path.join(tmpdir(), "forklight-handoff-client-"));
    let healthCount = 0;
    const server = net.createServer((socket) => {
      let buffer = "";
      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const newline = buffer.indexOf("\n");
        if (newline === -1) return;
        const request = JSON.parse(buffer.slice(0, newline)) as {
          id: string;
          method: string;
        };
        const targetPid = healthPids[0] ?? 41001;
        const healthPid = healthPids[Math.min(healthCount, healthPids.length - 1)];
        const result = request.method === "activation_handoff_shutdown"
          ? { stopping: true, handoffAuthorized: true, targetPid }
          : { pid: healthPid };
        if (request.method === "health") healthCount += 1;
        socket.end(`${JSON.stringify({
          id: request.id,
          ok: true,
          result,
          serverIdentity: currentBuildIdentity(),
        })}\n`);
        if (request.method === "health" && healthCount >= healthPids.length) {
          setImmediate(() => server.close());
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(daemonSocketPath(home), resolve);
    });
    return { home, server, healthRequests: () => healthCount };
  };

  const draining = await runFixture([41001, 41001]);
  try {
    const result = await stopDaemonForHandoff(
      draining.home, "op", "task", "receipt",
    );
    assert.equal(result.stopped, true);
    assert.equal(draining.healthRequests(), 2);
  } finally {
    if (draining.server.listening) {
      await new Promise<void>((resolve) => draining.server.close(() => resolve()));
    }
  }

  const replacement = await runFixture([41001, 41002]);
  try {
    await assert.rejects(
      () => stopDaemonForHandoff(
        replacement.home, "op", "task", "receipt",
      ),
      /endpoint was replaced/,
    );
  } finally {
    if (replacement.server.listening) {
      await new Promise<void>((resolve) => replacement.server.close(() => resolve()));
    }
  }
});

test("unknown operation rejected and valid operation succeeds through daemon protocol", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-handoff-proto-"));
  // Seed data directly in the store.  Keep both the seeding store AND
  // the daemon's store open concurrently so WAL readers can see all data.
  const seedStore = new StateStore(home);
  const seedSettings = new SettingsService(seedStore);
  const seedCoord = new DaemonCoordinator(seedStore, seedSettings, 0);
  const ids = await seededIntegrationOperation(seedStore, seedCoord, "proto");

  // Start the daemon while the seed store is still open — both connections
  // share the same WAL and the daemon's recover() reads the seeded events.
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    // Unknown operation must fail.
    const unknownResp = await daemonExchange(
      "activation_handoff_shutdown",
      { operationId: "nonexistent", taskId: "any", receiptId: "any" },
      home,
    );
    assert.equal(unknownResp.ok, false);
    assert.match(unknownResp.error ?? "", /Unknown Integration operation/);

    // Valid operation must succeed with targetPid.
    const response = await daemonExchange(
      "activation_handoff_shutdown",
      { operationId: ids.operationId, taskId: ids.taskId, receiptId: ids.receiptId },
      home,
    );
    assert.equal(response.ok, true);
    const result = response.result as Record<string, unknown>;
    assert.equal(result.stopping, true);
    assert.equal(result.handoffAuthorized, true);
    assert.equal(result.targetPid, process.pid);

    // Replay must fail.
    const replay = await daemonExchange(
      "activation_handoff_shutdown",
      { operationId: ids.operationId, taskId: ids.taskId, receiptId: ids.receiptId },
      home,
    );
    assert.equal(replay.ok, false);
    assert.match(replay.error ?? "", /already authorized/);
  } finally {
    await daemon.close();
    await seedCoord.shutdown();
    seedStore.close();
  }
});

test("handoff authorization stays live while the target daemon is draining", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-handoff-drain-"));
  const seedStore = new StateStore(home);
  const seedSettings = new SettingsService(seedStore);
  const seedCoord = new DaemonCoordinator(seedStore, seedSettings, 0);
  const ids = await seededIntegrationOperation(seedStore, seedCoord, "drain");

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    // Authorize: stores durable event, returns targetPid.
    const authResp = await daemonExchange(
      "activation_handoff_shutdown",
      { operationId: ids.operationId, taskId: ids.taskId, receiptId: ids.receiptId },
      home,
    );
    assert.equal(authResp.ok, true);

    // Daemon server is still up (file-scope no-op SIGTERM handler).
    const health = await daemonRequest<Record<string, unknown>>("health", {}, home);
    assert.equal(health.pid, process.pid,
      "in-process daemon always reports the test process PID");

    // A replacement daemon on a different home must reject the handoff
    // because it has no matching Integration operation.
    const fixture2 = await DetachedDaemonFixture.create("forklight-drain-repl-");
    try {
      await fixture2.ensureReady();
      await assert.rejects(
        () => stopDaemonForHandoff(fixture2.home, ids.operationId, ids.taskId, ids.receiptId),
        /activation handoff shutdown failed/,
      );
    } finally {
      await fixture2.cleanup();
    }

    // Original daemon is still alive — same PID, draining.
    const healthAfter = await daemonRequest<Record<string, unknown>>("health", {}, home);
    assert.equal(healthAfter.pid, process.pid);
  } finally {
    await daemon.close();
    await seedCoord.shutdown();
    seedStore.close();
  }
});

test("ordinary stop still waits for the exact PID and does not accept endpoint-only relinquishment", async () => {
  const fixture = await DetachedDaemonFixture.create("forklight-ordinary-stop-pid-");
  try {
    const health = await fixture.ensureReady();
    const firstPid = health.pid as number;
    assert.ok(Number.isSafeInteger(firstPid) && firstPid > 0);

    const replacement = await fixture.restart();
    assert.notEqual(replacement.pid, firstPid);
    assert.throws(() => process.kill(firstPid, 0), /ESRCH/);
  } finally {
    await fixture.cleanup();
  }
});

// --- Per-profile concurrency ---

import {
  defaultAdvancedPolicyFields,
  resolveEffectivePolicy,
  enforcementCapabilityForRuntime,
} from "../src/core/advanced-policy.js";

test("per-profile concurrency is reflected in effective policy snapshot", () => {
  const caps = enforcementCapabilityForRuntime("claude-code");
  const glob = defaultAdvancedPolicyFields();
  glob.maxConcurrency = 4; // global cap

  // Worker A capped at 1
  const snap = resolveEffectivePolicy(
    { maxConcurrency: 1 },
    undefined,
    glob,
    "worker-a",
    caps,
  );
  assert.equal(snap.values.maxConcurrency, 1);
  assert.equal(snap.provenance.maxConcurrency, "worker");
  assert.equal(snap.profileId, "worker-a");
});

test("per-profile concurrency retains its local cap for scheduler intersection", () => {
  const caps = enforcementCapabilityForRuntime("claude-code");
  const glob = defaultAdvancedPolicyFields();
  glob.maxConcurrency = 2;

  const snap = resolveEffectivePolicy(
    { maxConcurrency: 5 },
    undefined,
    glob,
    "over-capped",
    caps,
  );
  assert.equal(snap.values.maxConcurrency, 5);
  assert.equal(snap.provenance.maxConcurrency, "worker");
});

test("per-profile concurrency: Task override takes precedence over worker profile", () => {
  const caps = enforcementCapabilityForRuntime("claude-code");
  const glob = defaultAdvancedPolicyFields();
  glob.maxConcurrency = 5; // global

  const snap = resolveEffectivePolicy(
    { maxConcurrency: 3 }, // worker
    { maxConcurrency: 4 }, // task override
    glob,
    "profile-x",
    caps,
  );
  assert.equal(snap.values.maxConcurrency, 4);
  assert.equal(snap.provenance.maxConcurrency, "task");
});

test("snapshot stores truthful enforcement capability", () => {
  const claudeCaps = enforcementCapabilityForRuntime("claude-code");
  const snap = resolveEffectivePolicy(
    undefined, undefined, defaultAdvancedPolicyFields(), "default", claudeCaps,
  );
  assert.equal(snap.enforcementCapability.durationEnforcement, "preemptive");
  assert.equal(snap.enforcementCapability.tokenEnforcement, "post-observation");
  assert.equal(snap.enforcementCapability.progressWatchdog, "live");

  const grokCaps = enforcementCapabilityForRuntime("grok-build");
  const grokSnap = resolveEffectivePolicy(
    undefined, undefined, defaultAdvancedPolicyFields(), "default", grokCaps,
  );
  assert.equal(grokSnap.enforcementCapability.tokenEnforcement, "unsupported");
});

// --- Bounded policy adaptation transition chain ---

import type { AdvancedPolicyFields, EffectivePolicySnapshot } from "../src/core/types.js";

interface AdaptationTaskSeed {
  effectivePolicy: EffectivePolicySnapshot;
  status?: TaskRecord["status"];
}

function seedAdaptationTask(
  store: StateStore,
  home: string,
  seed: AdaptationTaskSeed,
): TaskRecord {
  const task = registerTaskFromSpec(
    store,
    {
      version: 1,
      name: `adapt-${Math.random().toString(36).slice(2)}`,
      project: "/tmp/src",
      goal: "Adaptation transition test",
      constraints: [],
      provider: {
        name: "deepseek", model: "deepseek-v4-flash",
        keychainService: "forklight.test.api-key",
      },
      runtime: {
        name: "claude-code", executable: "claude",
        effort: "low", maxBudgetUsd: 0.1,
      },
      workspace: { exclude: [] },
      worker: { allowEdits: false, allowedCommands: [], focusPaths: ["src"] },
      acceptance: { commands: ["true"] },
    },
    `forklight://test/adapt-${Math.random().toString(36).slice(2)}`,
    seed.effectivePolicy,
  );
  // Default terminal status is succeeded so the gate accepts the seed.
  const terminalStatus = seed.status ?? "succeeded";
  if (terminalStatus !== "queued") {
    store.setTaskStatus(task.id, terminalStatus, { error: null });
  }
  void home;
  return store.getTask(task.id);
}

function rootSnapshot(overrides: Partial<AdvancedPolicyFields> = {}): EffectivePolicySnapshot {
  const caps = enforcementCapabilityForRuntime("claude-code");
  const base: EffectivePolicySnapshot = resolveEffectivePolicy(
    undefined, undefined, defaultAdvancedPolicyFields(), "default", caps,
  );
  return {
    ...base,
    values: { ...base.values, maxAdaptationRounds: 0, ...overrides },
    provenance: { ...base.provenance, maxAdaptationRounds: "global" },
  };
}

test("model_routing is registered as read-only and validates bounded inputs", () => {
  assert.equal(requiresMatchingBuildIdentity("model_routing"), false);
});

test("list_history_page is registered as read-only", () => {
  assert.equal(requiresMatchingBuildIdentity("list_history_page"), false);
});

test("daemon list_history_page rejects malformed optional fields instead of treating them as absent", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-history-page-boundary-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    for (const params of [
      { query: 123 },
      { cursor: 123 },
      { cursor: "" },
    ]) {
      await assert.rejects(
        daemonRequest("list_history_page", params, home),
        /History continuation is invalid/,
      );
    }
  } finally {
    await daemon.close();
  }
});

test("listHistoryPage returns canonical History only and pages deterministically", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-history-page-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const coordinator = new DaemonCoordinator(store, settings);
  try {
    const baseTask = (id: string, status: TaskStatus, updatedAt: string): TaskRecord => ({
      id,
      name: id,
      status,
      sourcePath: "/private/source",
      taskFile: `/tmp/${id}.yaml`,
      spec: {
        version: 1,
        name: id,
        project: "/tmp/proj",
        goal: "g",
        constraints: [],
        provider: { name: "deepseek", model: "deepseek-v4-flash", keychainService: "fk" },
        runtime: { name: "claude-code", executable: "claude", effort: "high", maxBudgetUsd: null },
        workspace: { exclude: [] },
        worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
        acceptance: { commands: ["true"] },
      },
      paths: {
        root: "/x", baseline: "/x", workspace: "/x",
        logs: "/x", claudeConfig: "/x", diff: "/x",
      },
      sessionId: `s-${id}`,
      createdAt: updatedAt,
      updatedAt,
    } as TaskRecord);

    // Repaired failed delivery -> History / repaired-delivered (machine failed).
    const repaired = baseTask("hist-repaired", "failed", "2026-07-30T09:00:00.000Z");
    store.createTask(repaired);
    store.saveRemediationDisposition(repaired.id, {
      status: "verified-repaired-delivered",
      checkId: "check-1",
      createdAt: "2026-07-30T09:30:00.000Z",
    });
    // Worker passed, awaiting Main -> Now, never History.
    const awaiting = baseTask("now-awaiting", "succeeded", "2026-07-30T11:00:00.000Z");
    store.createTask(awaiting);
    store.addEvent(awaiting.id, "attempt-1", "verification.completed", "passed", {
      passed: true, behaviorPassed: true, policyPassed: true, sourceCompatible: true,
      commands: [], diffPath: "/x/diff.patch", sourceUnchanged: false,
    });

    const first = coordinator.listHistoryPage({ limit: 10 });
    assert.equal(first.totalCount, 1);
    assert.equal(first.items.length, 1);
    assert.equal(first.items[0]!.taskId, "hist-repaired");
    assert.equal(first.items[0]!.boardScope, "history");
    assert.equal(first.items[0]!.boardReason, "repaired-delivered");
    assert.equal(first.hasMore, false);
    assert.equal(first.nextCursor, undefined);
    // Machine-terminal Task awaiting Main never appears in History.
    assert.ok(!first.items.some((s) => s.taskId === "now-awaiting"));

    // Safe search matches provider/model and returns the canonical surface.
    const byProvider = coordinator.listHistoryPage({ limit: 10, query: "deepseek" });
    assert.equal(byProvider.items.length, 1);
    assert.equal(byProvider.items[0]!.boardScope, "history");
    // A query that matches no safe summary field returns nothing.
    const none = coordinator.listHistoryPage({ limit: 10, query: "minimax" });
    assert.equal(none.items.length, 0);
    assert.equal(none.totalCount, 0);
  } finally {
    store.close();
  }
});

test("listHistoryPage fails closed on an out-of-range limit and cross-query cursor", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-history-page-validation-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const coordinator = new DaemonCoordinator(store, settings);
  const TS = "2026-07-30T10:00:00.000Z";
  const baseTask = (id: string, provider: string): TaskRecord => ({
    id,
    name: id,
    status: "failed",
    sourcePath: "/private/source",
    taskFile: `/tmp/${id}.yaml`,
    spec: {
      version: 1, name: id, project: "/tmp/proj", goal: "g", constraints: [],
      provider: { name: provider, model: `${provider}-m`, keychainService: "fk" },
      runtime: { name: "claude-code", executable: "claude", effort: "high", maxBudgetUsd: null },
      workspace: { exclude: [] }, worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
      acceptance: { commands: ["true"] },
    },
    paths: { root: "/x", baseline: "/x", workspace: "/x", logs: "/x", claudeConfig: "/x", diff: "/x" },
    sessionId: `s-${id}`,
    createdAt: TS, updatedAt: TS,
  } as TaskRecord);
  // Twelve canonical History Tasks (repaired-delivered) sharing one timestamp.
  for (let i = 0; i < 12; i += 1) {
    const id = `glm-${i.toString().padStart(2, "0")}`;
    store.createTask(baseTask(id, "glm"));
    store.saveRemediationDisposition(id, {
      status: "verified-repaired-delivered",
      checkId: `check-${i}`,
      createdAt: "2026-07-30T10:30:00.000Z",
    });
  }
  try {
    // Out-of-range limit fails closed with the fixed privacy-safe reason.
    assert.throws(() => coordinator.listHistoryPage({ limit: 9 }), /History continuation is invalid/);
    // First page of the "glm" search issues a continuation cursor.
    const pageOne = coordinator.listHistoryPage({ limit: 10, query: "glm" });
    assert.equal(pageOne.items.length, 10);
    assert.equal(pageOne.totalCount, 12);
    assert.ok(pageOne.nextCursor, "a continuation cursor is issued for a multi-page result");
    const glmCursor = pageOne.nextCursor;
    // The same cursor used with a different query is rejected.
    assert.throws(
      () => coordinator.listHistoryPage({ limit: 10, query: "deepseek", cursor: glmCursor }),
      /History continuation is invalid/,
    );
    // The same cursor used with the same query (different casing) continues.
    const pageTwo = coordinator.listHistoryPage({ limit: 10, query: "GLM", cursor: glmCursor });
    assert.equal(pageTwo.items.length, 2);
    assert.equal(pageTwo.hasMore, false);
    const seen = new Set([...pageOne.items, ...pageTwo.items].map((s) => s.taskId));
    assert.equal(seen.size, 12, "no duplication across the two pages");
  } finally {
    store.close();
  }
});


test("model_routing coordinator rejects empty taskClass and fewer than 2 candidates", () => {
  const store = new StateStore(path.join(tmpdir(), "fl-mr-"));
  const settings = new SettingsService(store);
  const coordinator = new DaemonCoordinator(store, settings);
  try {
    assert.throws(() => coordinator.modelRouting("", [{ provider: "a", model: "b" }, { provider: "c", model: "d" }]), /1 to 200 characters/);
    assert.throws(() => coordinator.modelRouting("  ", [{ provider: "a", model: "b" }, { provider: "c", model: "d" }]), /1 to 200 characters/);
    assert.throws(() => coordinator.modelRouting("test", [{ provider: "a", model: "b" }]), /2 to 10/);
    assert.throws(() => coordinator.modelRouting("test", []), /2 to 10/);
    assert.throws(() => coordinator.modelRouting("test", [{ provider: "", model: "b" }, { provider: "c", model: "d" }]), /provider must contain/);
    assert.throws(() => coordinator.modelRouting("test", [{ provider: "a", model: "" }, { provider: "c", model: "d" }]), /model must contain/);
    assert.throws(() => coordinator.modelRouting("test", [
      { provider: "a", model: "b" },
      { provider: "a", model: "b" },
    ]), /must be unique/);
    assert.throws(() => coordinator.modelRouting("test", Array.from(
      { length: 11 },
      (_, index) => ({ provider: "p", model: String(index) }),
    )), /2 to 10/);
  } finally {
    store.close();
  }
});

test("model_routing coordinator returns privacy-safe advisory for empty history", () => {
  const store = new StateStore(path.join(tmpdir(), "fl-mr-safe-"));
  const settings = new SettingsService(store);
  const coordinator = new DaemonCoordinator(store, settings);
  try {
    const result = coordinator.modelRouting("nonexistent-class", [
      { provider: "deepseek", model: "v4" },
      { provider: "qwen", model: "plus" },
    ]);
    assert.equal(result.taskClass, "nonexistent-class");
    assert.equal(result.candidates.length, 2);
    // No recommendation with zero samples
    assert.equal(result.knowledge, "unknown");
    assert.equal(result.evidenceScope, "none");
    assert.equal(result.shouldRunCompetition, false); // no intent → no competition
    assert.equal(result.competition.intent, "none");
    // Privacy-safe: no Task ids, no error text
    const json = JSON.stringify(result);
    assert.doesNotMatch(json, /error/i);
    assert.doesNotMatch(json, /api[_-]?key/i);
    assert.doesNotMatch(json, /\/tasks\//);
  } finally {
    store.close();
  }
});

test("adaptation disabled: zero rounds blocks apply and preview returns stopped", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-adaptation-disabled-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  const task = seedAdaptationTask(store, home, {
    effectivePolicy: rootSnapshot({ maxAdaptationRounds: 0, maxDurationMs: 60_000 }),
  });
  try {
    const preview = coordinator.adaptationPreview({
      taskId: task.id,
      patch: { maxDurationMs: 600_000 },
      reason: "duration-budget",
    });
    assert.equal(preview.status, "stopped");
    assert.equal(preview.stoppedReason, "adaptation-disabled");

    const result = coordinator.adaptationApply({
      taskId: task.id,
      patch: { maxDurationMs: 600_000 },
      reason: "duration-budget",
      confirm: true,
    });
    assert.equal(result.status, "stopped");
    assert.equal(result.preview.stoppedReason, "adaptation-disabled");
    assert.equal(store.listTasks().length, 1, "no successor Task was created");
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("adaptation one bounded successor: cap=1 yields one child and blocks duplicate", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-adaptation-once-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const coordinator = new DaemonCoordinator(store, settings, 0);
  const root = seedAdaptationTask(store, home, {
    effectivePolicy: rootSnapshot({ maxAdaptationRounds: 1, maxDurationMs: 60_000 }),
    status: "succeeded",
  });
  try {
    const first = coordinator.adaptationApply({
      taskId: root.id,
      patch: { maxDurationMs: 600_000 },
      reason: "duration-budget",
      confirm: true,
    });
    assert.equal(first.status, "eligible");
    assert.ok(first.childTaskId);
    assert.ok(first.lineageId);
    assert.deepEqual(
      coordinator.health().queuedTaskIds,
      [first.childTaskId],
      "the persisted successor enters the normal scheduler queue",
    );
    // Two tasks now: root + child.
    assert.equal(store.listTasks().length, 2);
    // Successful creation event exists.
    const childId = first.childTaskId!;
    const childEvents = store.listEvents(childId);
    assert.ok(childEvents.some((e) => e.type === "task.created"));
    assert.ok(childEvents.some((e) => e.type === "task.adaptation.transitioned"));

    // Duplicate apply is rejected with successor-already-created.
    const dup = coordinator.adaptationApply({
      taskId: root.id,
      patch: { maxDurationMs: 700_000 },
      reason: "duration-budget",
      confirm: true,
    });
    assert.equal(dup.status, "stopped");
    assert.equal(dup.preview.stoppedReason, "successor-already-created");
    assert.equal(store.listTasks().length, 2, "no extra Task was created on duplicate");
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("adaptation exhausted lineage: round-one child cannot produce a round-two grandchild when cap is 1", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-adaptation-exhaust-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const coordinator = new DaemonCoordinator(store, settings, 0);
  const root = seedAdaptationTask(store, home, {
    effectivePolicy: rootSnapshot({ maxAdaptationRounds: 1, maxDurationMs: 60_000 }),
  });
  try {
    // First transition: root -> child. The child inherits the root's cap=1.
    const first = coordinator.adaptationApply({
      taskId: root.id,
      patch: { maxDurationMs: 600_000 },
      reason: "duration-budget",
      confirm: true,
    });
    assert.equal(first.status, "eligible");
    const childId = first.childTaskId!;
    // Mark the child terminal so it can serve as a parent.
    store.setTaskStatus(childId, "succeeded", { error: null });
    const childStored = store.getTask(childId);
    assert.equal(childStored.effectivePolicy!.values.maxAdaptationRounds, 1);

    // Adjusting from child: would be round 2, exceeds cap=1.
    const exhausted = coordinator.adaptationPreview({
      taskId: childId,
      patch: { maxDurationMs: 700_000 },
      reason: "duration-budget",
    });
    assert.equal(exhausted.status, "stopped");
    assert.equal(exhausted.stoppedReason, "round-limit-reached");

    const exhaustedApply = coordinator.adaptationApply({
      taskId: childId,
      patch: { maxDurationMs: 700_000 },
      reason: "duration-budget",
      confirm: true,
    });
    assert.equal(exhaustedApply.status, "stopped");
    assert.equal(exhaustedApply.preview.stoppedReason, "round-limit-reached");
    assert.equal(store.listTasks().length, 2, "exhausted lineage did not create a successor");
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("adaptation restart idempotency: re-opening the daemon does not duplicate apply", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-adaptation-restart-"));
  const store1 = new StateStore(home);
  const settings1 = new SettingsService(store1);
  const coord1 = new DaemonCoordinator(store1, settings1, 0);
  const root = seedAdaptationTask(store1, home, {
    effectivePolicy: rootSnapshot({ maxAdaptationRounds: 1, maxDurationMs: 60_000 }),
  });
  try {
    const first = coord1.adaptationApply({
      taskId: root.id,
      patch: { maxDurationMs: 600_000 },
      reason: "duration-budget",
      confirm: true,
    });
    assert.equal(first.status, "eligible");
    await coord1.shutdown();
    store1.close();

    // Reopen and retry the same apply — must not create another successor.
    const store2 = new StateStore(home);
    const settings2 = new SettingsService(store2);
    const coord2 = new DaemonCoordinator(store2, settings2, 0);
    try {
      const retry = coord2.adaptationApply({
        taskId: root.id,
        patch: { maxDurationMs: 600_000 },
        reason: "duration-budget",
        confirm: true,
      });
      assert.equal(retry.status, "stopped");
      assert.equal(retry.preview.stoppedReason, "successor-already-created");
      assert.equal(store2.listTasks().length, 2, "no second successor after recovery");
    } finally {
      await coord2.shutdown();
      store2.close();
    }
  } finally {
    // ensure resources cleaned even if branch fell through without matching
  }
});

test("adaptation settings drift cannot expand the root cap", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-adaptation-drift-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const coordinator = new DaemonCoordinator(store, settings, 0);
  const root = seedAdaptationTask(store, home, {
    effectivePolicy: rootSnapshot({ maxAdaptationRounds: 1, maxDurationMs: 60_000 }),
  });
  try {
    // Drift settings — change a global ceiling that should not reach the root cap.
    settings.update({ execution: { maxAttempts: 7 } });
    // Preview still respects the immutable root cap of 1.
    const preview = coordinator.adaptationPreview({
      taskId: root.id,
      patch: { maxDurationMs: 600_000 },
      reason: "duration-budget",
    });
    assert.equal(preview.status, "eligible");
    assert.equal(preview.maxAdaptationRounds, 1, "cap is read from the root snapshot, not live settings");
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("adaptation safety: maxAdaptationRounds in patch is forbidden and not applied", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-adaptation-cap-patch-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  const root = seedAdaptationTask(store, home, {
    effectivePolicy: rootSnapshot({ maxAdaptationRounds: 1, maxDurationMs: 60_000 }),
  });
  try {
    const preview = coordinator.adaptationPreview({
      taskId: root.id,
      patch: { maxAdaptationRounds: 99 as unknown as never },
      reason: "other-flexible-policy",
    });
    assert.equal(preview.status, "stopped");
    assert.equal(preview.stoppedReason, "forbidden-field");
    assert.equal(store.listTasks().length, 1);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("adaptation apply requires explicit confirm: true", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-adaptation-confirm-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const store = new StateStore(home);
  const root = seedAdaptationTask(store, home, {
    effectivePolicy: rootSnapshot({ maxAdaptationRounds: 1, maxDurationMs: 60_000 }),
  });
  try {
    await assert.rejects(
      async () => daemonRequest("adaptation_apply", {
        taskId: root.id,
        patch: { maxDurationMs: 600_000 },
        reason: "duration-budget",
      }, home),
      /confirm/,
    );
    assert.equal(store.listTasks().length, 1, "no successor Task when confirm is missing");
  } finally {
    await daemon.close();
    store.close();
  }
});

test("adaptation daemon preview/apply round-trip over the local socket", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-adaptation-socket-"));
  const store = new StateStore(home);
  const root = seedAdaptationTask(store, home, {
    effectivePolicy: rootSnapshot({ maxAdaptationRounds: 1, maxDurationMs: 60_000 }),
  });
  store.close();
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    // Read preview over the socket.
    const preview = await daemonRequest<Record<string, unknown>>(
      "adaptation_preview",
      {
        taskId: root.id,
        patch: { maxDurationMs: 600_000 },
        reason: "duration-budget",
      },
      home,
    );
    assert.equal(preview.status, "eligible");
    assert.equal(preview.nextRound, 1);
    assert.equal(preview.maxAdaptationRounds, 1);
    const fields = preview.fields as Array<Record<string, unknown>>;
    const dur = fields.find((f) => f.field === "maxDurationMs");
    assert.ok(dur);
    assert.equal(dur!.before, 60_000);
    assert.equal(dur!.after, 600_000);
    assert.equal(dur!.changed, true);

    // Apply via daemon.
    const apply = await daemonRequest<Record<string, unknown>>(
      "adaptation_apply",
      {
        taskId: root.id,
        patch: { maxDurationMs: 600_000 },
        reason: "duration-budget",
        confirm: true,
      },
      home,
    );
    assert.equal(apply.status, "eligible");
    assert.ok(typeof apply.childTaskId === "string");
    assert.ok(typeof apply.lineageId === "string");

    // Duplicate apply is rejected.
    const dup = await daemonRequest<{
      status: string;
      preview: { stoppedReason?: string };
    }>(
      "adaptation_apply",
      {
        taskId: root.id,
        patch: { maxDurationMs: 700_000 },
        reason: "duration-budget",
        confirm: true,
      },
      home,
    );
    assert.equal(dup.status, "stopped");
    assert.equal(dup.preview.stoppedReason, "successor-already-created");

    // Reason is validated as a bounded category; unknown reason → daemon error.
    await assert.rejects(
      async () => daemonRequest("adaptation_preview", {
        taskId: root.id,
        patch: { maxDurationMs: 800_000 },
        reason: "not-a-bounded-reason",
      }, home),
      /bounded reason category/,
    );

    // Forbid field (maxAdaptationRounds) is checked first by the gate — it
    // never reaches the cap-or-successor checks. Cast bypasses the type system
    // since runtime rejection does not need the typed patch surface.
    const reject = await daemonRequest<{
      status: string;
      stoppedReason?: string;
    }>(
      "adaptation_preview",
      {
        taskId: root.id,
        patch: { maxAdaptationRounds: 99 as unknown as never },
        reason: "other-flexible-policy",
      },
      home,
    );
    assert.equal(reject.status, "stopped");
    assert.equal(reject.stoppedReason, "forbidden-field");
  } finally {
    await daemon.close();
  }
});

test("adaptation persistence: lineage edge is recoverable after daemon restart", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-adaptation-recover-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const coord1 = new DaemonCoordinator(store, settings, 0);
  const root = seedAdaptationTask(store, home, {
    effectivePolicy: rootSnapshot({ maxAdaptationRounds: 1, maxDurationMs: 60_000 }),
  });
  try {
    const first = coord1.adaptationApply({
      taskId: root.id,
      patch: { maxDurationMs: 600_000 },
      reason: "duration-budget",
      confirm: true,
    });
    assert.equal(first.status, "eligible");
    await coord1.shutdown();
    store.close();
    // Reopen
    const store2 = new StateStore(home);
    const coord2 = new DaemonCoordinator(store2, new SettingsService(store2), 0);
    try {
      const recovered = await coord2.recover();
      // Verify lineage is durable.
      const edges = store2.listAdaptationLineageForRoot(root.id);
      assert.equal(edges.length, 1);
      assert.equal(edges[0]!.parentTaskId, root.id);
      assert.equal(edges[0]!.round, 1);
      assert.equal(edges[0]!.proposedReason, "duration-budget");
      const childId = edges[0]!.childTaskId;
      assert.ok(recovered.includes(childId), "restart recovers a committed-but-not-running successor");
      assert.ok(
        (coord2.health().queuedTaskIds as string[]).includes(childId),
        "recovered successor returns to the normal scheduler queue",
      );
      // Verify the child Task was also persisted.
      const child = store2.getTask(childId);
      assert.equal(child.effectivePolicy!.values.maxDurationMs, 600_000);
      assert.equal(child.effectivePolicy!.values.maxAdaptationRounds, 1);
      // No duplicate apply possible after recovery.
      const retry = coord2.adaptationApply({
        taskId: root.id,
        patch: { maxDurationMs: 600_000 },
        reason: "duration-budget",
        confirm: true,
      });
      assert.equal(retry.status, "stopped");
      assert.equal(retry.preview.stoppedReason, "successor-already-created");
    } finally {
      await coord2.shutdown();
      store2.close();
    }
  } finally {
    // no-op
  }
});

// --- workspace preparation observability (FL-D preparation) ---

const PREP_PROBE = "forklight-prep-PROBE-MARKER-2026";

function makePrepTaskSpec(project: string, name: string): TaskRecord["spec"] {
  return {
    version: 1,
    name,
    project,
    goal: "exercise preparation progress",
    constraints: [],
    provider: {
      name: "deepseek",
      model: "deepseek-v4-flash",
      keychainService: "forklight.test.api-key",
    },
    runtime: {
      name: "claude-code",
      executable: "claude",
      effort: "low",
      maxBudgetUsd: 0.1,
    },
    workspace: { exclude: [] },
    worker: { allowEdits: false, allowedCommands: [], focusPaths: ["src"] },
    acceptance: { commands: ["true"] },
  };
}

test("launch authentication rejection fails before workspace, Attempt, or Worker", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-launch-auth-"));
  const project = path.join(home, "source");
  await mkdir(project);
  await writeFile(path.join(project, "value.txt"), "source\n");
  const store = new StateStore(home);
  const coordinator = new DaemonCoordinator(
    store,
    new SettingsService(store),
    1,
    {
      hasReadableKeychainValue: () => false,
      hasLocalGrokSignIn: () => false,
    },
  );
  const task = registerTaskFromSpec(
    store,
    makePrepTaskSpec(project, "unreadable launch authentication"),
    "forklight://test/unreadable-launch-authentication",
  );
  try {
    coordinator.queueTask(task.id);
    for (let i = 0; i < 100 && store.getTask(task.id).status !== "failed"; i += 1) {
      await sleep(10);
    }
    const failed = store.getTask(task.id);
    assert.equal(failed.status, "failed");
    assert.match(failed.error ?? "", /authentication is not readable/);
    assert.equal(store.listAttempts(task.id).length, 0);
    assert.equal(await isWorkspaceReady(task.paths), false);
    const events = store.listEvents(task.id);
    assert.deepEqual(events.map((event) => event.type), [
      "task.created",
      "task.launch-preflight.failed",
    ]);
    assert.deepEqual(events.at(-1)?.payload, {
      failureCategory: "authentication",
      reasonCode: "provider-auth-unreadable",
      provider: "deepseek",
      workerInvoked: false,
      workspacePrepared: false,
      attemptCreated: false,
    });
    assert.doesNotMatch(JSON.stringify(events), /forklight\.test\.api-key/);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("prepareTaskWorkspace persists ordered stage events and exposes the live stage", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-prep-events-"));
  const project = path.join(home, `${PREP_PROBE}-source`);
  const srcDir = path.join(project, "src");
  const privateDir = path.join(project, `${PREP_PROBE}-private`);
  await mkdir(srcDir, { recursive: true });
  await mkdir(privateDir, { recursive: true });
  await writeFile(path.join(srcDir, "value.ts"), "export const x = 1;\n");
  await writeFile(path.join(privateDir, "secret.txt"), "do-not-leak");

  const store = new StateStore(home);
  const task = registerTaskFromSpec(
    store,
    makePrepTaskSpec(project, `${PREP_PROBE}-name`),
    `forklight://test/${PREP_PROBE}`,
  );
  const prepared = await prepareTaskWorkspace(store, task);
  assert.equal(prepared.status, "preparing");
  const events = store.listEvents(task.id);
  const stageEvents = events.filter((event) => event.type === "workspace.preparation.stage");
  // The full ordered vocabulary must be present and in the documented
  // order; each observation becomes a durable Task event before the
  // Worker starts.
  const stages = stageEvents.map((event) => (event.payload as { stage: string; phase: string }).stage);
  const phases = stageEvents.map((event) => (event.payload as { stage: string; phase: string }).phase);
  assert.deepEqual(stages, [
    "init",
    "source-scan",
    "source-scan",
    "baseline-copy",
    "baseline-copy",
    "worker-copy",
    "worker-copy",
    "dependency-link",
    "dependency-link",
    "context-write",
    "context-write",
    "complete",
  ]);
  for (const phase of phases.slice(0, -1)) {
    assert.ok(phase === "start" || phase === "complete");
  }
  assert.equal(phases.at(-1), "complete");

  // Elapsed is strictly monotonic across consecutive stage events.
  const elapsed = stageEvents.map((event) => (event.payload as { elapsedMs: number }).elapsedMs);
  for (let index = 1; index < elapsed.length; index += 1) {
    assert.ok(
      elapsed[index]! >= elapsed[index - 1]!,
      `elapsed must be non-decreasing, got ${elapsed.join(", ")}`,
    );
  }

  // The terminal workspace.prepared event is unchanged and carries the
  // same manifest shape (copiedFiles, skippedSymlinks, linkedDependencies).
  const preparedEvent = events.find((event) => event.type === "workspace.prepared");
  assert.ok(preparedEvent, "workspace.prepared event must be emitted after stage events");
  const preparedPayload = preparedEvent!.payload as {
    workspace: string;
    baseline: string;
    copiedFiles: number;
    skippedSymlinks: string[];
    linkedDependencies: string[];
  };
  assert.equal(preparedPayload.copiedFiles, 2);
  assert.equal(preparedPayload.skippedSymlinks.length, 0);
  assert.equal(preparedPayload.linkedDependencies.length, 0);
  assert.equal(preparedPayload.workspace, task.paths.workspace);
  assert.equal(preparedPayload.baseline, task.paths.baseline);

  // Latest-preparation-stage projection returns the last stage event payload
  // as a structured cursor without loading full event payload history.
  const latest = store.latestPreparationStageMeta(task.id);
  assert.ok(latest, "latestPreparationStageMeta must return the most recent stage");
  assert.equal(latest!.stage, "complete");
  assert.equal(latest!.phase, "complete");

  // Privacy: stage event payloads must not contain project paths, file
  // names, excluded names, credentials, or the probe marker.
  const serialized = JSON.stringify(stageEvents);
  for (const privateNeedle of [
    PREP_PROBE,
    project,
    privateDir,
    "secret.txt",
    "value.ts",
    task.paths.workspace,
    task.paths.baseline,
    "api-key",
    "keychain",
  ]) {
    assert.ok(!serialized.includes(privateNeedle),
      `stage events must not leak ${privateNeedle}, got: ${serialized}`);
  }
  // Summary text is fixed and contains no private content.
  for (const event of stageEvents) {
    assert.match(event.summary, /^Preparation: (init|source-scan|baseline-copy|worker-copy|dependency-link|context-write|complete) \((start|complete)\)$/);
  }
  store.close();
});

test("list/summaries surfaces the latest preparation stage while Task is preparing", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-prep-list-"));
  const project = path.join(home, `${PREP_PROBE}-source`);
  const srcDir = path.join(project, "src");
  await mkdir(srcDir, { recursive: true });
  await writeFile(path.join(srcDir, "value.ts"), "export const x = 1;\n");
  await writeFile(path.join(srcDir, "nested.ts"), "export const y = 2;\n");

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const task = await daemonRequest<TaskRecord>(
      "submit",
      {
        baseDirectory: home,
        task: {
          version: 1,
          name: "preparing-list",
          project,
          goal: "exercise live preparation stage projection",
          provider: { name: "deepseek", model: "deepseek-v4-flash" },
          runtime: { name: "claude-code" },
          worker: { allowedCommands: [] },
          acceptance: { commands: ["true"] },
        },
      },
      home,
    );
    // list_summaries includes this task; the surface exposes the latest
    // structured preparation stage through the cursor embedded in progress.
    const list = await daemonRequest<Array<Record<string, unknown>>>(
      "list_summaries", { limit: 5 }, home,
    );
    const surface = list.find((entry) => entry.taskId === task.id);
    assert.ok(surface, "list_summaries must include the submitted task");

    // The progress payload itself (the new structured stage cursor) must
    // not contain project paths, file names, or credential markers.
    const progress = (surface as { progress?: Record<string, unknown> }).progress;
    const preparationStage = progress?.preparationStage as
      | { stage?: string; phase?: string; elapsedMs?: number; countKind?: string; count?: number }
      | undefined;
    if (preparationStage !== undefined) {
      const progressJson = JSON.stringify(preparationStage);
      for (const privateNeedle of [
        PREP_PROBE,
        project,
        "value.ts",
        "nested.ts",
      ]) {
        assert.ok(!progressJson.includes(privateNeedle),
          `progress payload must not leak ${privateNeedle}, got: ${progressJson}`);
      }
      assert.equal(typeof preparationStage.stage, "string");
      assert.ok(preparationStage.phase === "start" || preparationStage.phase === "complete");
      assert.equal(typeof preparationStage.elapsedMs, "number");
      assert.ok(preparationStage.countKind === undefined
        || preparationStage.countKind === "files"
        || preparationStage.countKind === "dependencies");
    }

    // The store-side cursor returns the structured stage directly
    // (or undefined once the terminal workspace.prepared event wins).
    // This is what the daemon list/status path uses.
    const store = new StateStore(home);
    const meta = store.latestPreparationStageMeta(task.id);
    if (meta !== undefined) {
      assert.equal(typeof meta.stage, "string");
      assert.ok(meta.phase === "start" || meta.phase === "complete");
      assert.equal(typeof meta.elapsedMs, "number");
    }
    store.close();
  } finally {
    await daemon.close();
  }
});

test("prepareTaskWorkspace never emits workspace.prepared on observer failure", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-prep-fail-"));
  const project = path.join(home, `${PREP_PROBE}-source`);
  const srcDir = path.join(project, "src");
  await mkdir(srcDir, { recursive: true });
  await writeFile(path.join(srcDir, "value.ts"), "export const x = 1;\n");

  const store = new StateStore(home);
  const task = registerTaskFromSpec(
    store,
    makePrepTaskSpec(project, `${PREP_PROBE}-fail`),
    `forklight://test/${PREP_PROBE}-fail`,
  );
  // Force a deterministic failure mid-preparation by registering a
  // pre-stage event then injecting a failing observer.  We use the
  // runner's prepareTaskWorkspace contract: it threads its own
  // internal observer, so we can't pass one through.  Instead we
  // simulate a copy-stage failure by writing a file that conflicts
  // with the symlink step, then verify the existing fail-closed
  // behavior (no workspace.prepared, status=failed, raw error in
  // the Task error field but never in the progress payload).
  // Place a non-directory at the node_modules target inside the
  // baseline root so cp will succeed but the copy filter or the
  // later context step will operate on a known-bad state.
  // Easiest deterministic failure: pre-create a regular file where
  // prepareWorkspace will try to mkdir the logs directory with
  // mode 0o700 — it will fail because a file already exists.
  await mkdir(task.paths.root, { recursive: true });
  await writeFile(task.paths.logs, "block-mkdir");

  await assert.rejects(() => prepareTaskWorkspace(store, task));
  const after = store.getTask(task.id);
  assert.equal(after.status, "failed");
  const events = store.listEvents(task.id);
  const prepared = events.find((event) => event.type === "workspace.prepared");
  assert.equal(prepared, undefined,
    "workspace.prepared must not be emitted when preparation fails");
  // At least one stage event was recorded before the failure.
  const stageEvents = events.filter((event) => event.type === "workspace.preparation.stage");
  assert.ok(stageEvents.length > 0,
    "stage events emitted before the failure must remain in the audit log");
  // The Task error captures the privacy-safe failure message; the stage
  // event payloads still contain no project paths, file names, or
  // credentials.
  const stageSerialized = JSON.stringify(stageEvents);
  for (const privateNeedle of [
    PREP_PROBE,
    project,
    "value.ts",
    "block-mkdir",
  ]) {
    assert.ok(!stageSerialized.includes(privateNeedle),
      `failed preparation stage events must not leak ${privateNeedle}, got: ${stageSerialized}`);
  }
  store.close();
});

test("preparing recovery clears partial snapshots without inventing a Worker interruption", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-prep-recovery-"));
  const project = path.join(home, "source");
  await mkdir(project);
  await writeFile(path.join(project, "value.txt"), "source\n");
  const store = new StateStore(home);
  const task = registerTaskFromSpec(
    store,
    makePrepTaskSpec(project, "preparing recovery"),
    "forklight://test/preparing-recovery",
  );
  await mkdir(task.paths.baseline, { recursive: true });
  await mkdir(task.paths.workspace, { recursive: true });
  await writeFile(path.join(task.paths.workspace, "stale.txt"), "stale\n");
  await mkdir(task.paths.logs, { recursive: true });
  await mkdir(task.paths.claudeConfig, { recursive: true });
  const log = path.join(task.paths.logs, "preparation.jsonl");
  const credential = path.join(task.paths.claudeConfig, "credential-marker");
  await writeFile(log, "log\n");
  await writeFile(credential, "credential\n");
  store.setTaskStatus(task.id, "preparing", { error: null, finishedAt: null });

  const coordinator = testCoordinator(store, 0);
  try {
    assert.deepEqual(await coordinator.recover(), [task.id]);
    assert.equal(store.getTask(task.id).status, "preparing");
    assert.equal(store.listAttempts(task.id).length, 0);
    assert.equal(await isWorkspaceReady(task.paths), false);
    assert.deepEqual(coordinator.health().queuedTaskIds, [task.id]);
    assert.equal(await readFile(log, "utf8"), "log\n");
    assert.equal(await readFile(credential, "utf8"), "credential\n");
    const events = store.listEvents(task.id);
    assert.ok(events.some((event) => event.type === "workspace.preparation.stage"));
    assert.equal(events.some((event) => event.type === "worker.interrupted"), false);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("preparing recovery cleanup failure stays a workspace failure with no Attempt", async () => {
  if (process.platform === "win32") return;
  const home = await mkdtemp(path.join(tmpdir(), "forklight-prep-recovery-error-"));
  const project = path.join(home, "source");
  await mkdir(project);
  await writeFile(path.join(project, "value.txt"), "source\n");
  const store = new StateStore(home);
  const task = registerTaskFromSpec(
    store,
    makePrepTaskSpec(project, "preparing recovery error"),
    "forklight://test/preparing-recovery-error",
  );
  await mkdir(task.paths.baseline, { recursive: true });
  await writeFile(path.join(task.paths.baseline, "stale.txt"), "stale\n");
  await chmod(task.paths.baseline, 0o000);
  store.setTaskStatus(task.id, "preparing", { error: null, finishedAt: null });
  const coordinator = testCoordinator(store, 0);
  try {
    assert.deepEqual(await coordinator.recover(), [task.id]);
    const recovered = store.getTask(task.id);
    assert.equal(recovered.status, "failed");
    assert.match(recovered.error ?? "", /^Workspace preparation failed:/);
    assert.equal(store.listAttempts(task.id).length, 0);
    assert.equal(store.listEvents(task.id).some((event) => event.type === "worker.failed"), false);
    assert.deepEqual(coordinator.health().queuedTaskIds, []);
  } finally {
    await chmod(task.paths.baseline, 0o755);
    await coordinator.shutdown();
    store.close();
  }
});

test("executeAttempt refuses an incomplete first snapshot before creating an Attempt", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-prep-attempt-gate-"));
  const project = path.join(home, "source");
  await mkdir(project);
  await writeFile(path.join(project, "value.txt"), "source\n");
  const store = new StateStore(home);
  const task = registerTaskFromSpec(
    store,
    makePrepTaskSpec(project, "first attempt readiness gate"),
    "forklight://test/first-attempt-readiness",
  );
  await mkdir(task.paths.workspace, { recursive: true });
  await assert.rejects(
    executeAttempt(store, task, false),
    /snapshot is incomplete/,
  );
  assert.equal(store.listAttempts(task.id).length, 0);
  store.close();
});

// --- Main correction daemon tests ---

test("correct authorizes a Main correction for a failed task", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-correct-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  const task = standaloneSucceededTask(store, "correction-target", "failed");
  const attemptId = seedPassingVerification(store, task);
  store.updateAttempt(attemptId, { status: "failed", exitCode: 1, error: "Needs correction" });
  store.setTaskStatus(task.id, "failed", { error: "Needs correction" });
  try {
    const result = coordinator.correct(task.id, "Fix the module boundary", null, true);
    assert.equal(result.status, "queued", "the durable correction is visible before execution");
    const grants = store.listEvents(task.id).filter(
      (e) => e.type === "attempt.authorization.granted",
    );
    assert.equal(grants.length, 1);
    const payload = grants[0]?.payload as Record<string, unknown>;
    assert.equal(payload?.kind, "correction");
    assert.equal(payload?.reason, "main-correction");
    assert.equal(payload?.feedback, "Fix the module boundary");
    assert.equal(payload?.priorAttemptId, attemptId);
    assert.equal(payload?.targetOrdinal, 2);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("structured correction binds the exact reusable candidate and rejects stale input before mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-correct-structured-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  const task = standaloneSucceededTask(store, "structured-correction", "failed");
  const attemptId = seedPassingVerification(store, task);
  store.updateAttempt(attemptId, { status: "failed", exitCode: 1, error: "Needs correction" });
  store.setTaskStatus(task.id, "failed", { error: "Needs correction" });
  await mkdir(task.paths.root, { recursive: true });
  await writeFile(task.paths.diff, "candidate patch bytes\n");
  const revision = await captureCandidateRevision(
    store, store.getTask(task.id), store.getAttempt(attemptId),
    1, false, ["src/module.ts"], 1, 4,
  );
  try {
    const result = coordinator.correct(
      task.id,
      "Keep the useful module and repair its remaining boundary",
      null,
      true,
      revision.id,
      ["src/module.ts"],
      [{
        description: "Repair the remaining module boundary",
        acceptanceExpectation: "The original acceptance command passes",
      }],
    );
    assert.equal(result.status, "queued");
    const payload = store.listEvents(task.id)
      .find((event) => event.type === "attempt.authorization.granted")?.payload as Record<string, unknown>;
    assert.equal(payload.candidateRevisionId, revision.id);
    assert.equal(typeof payload.gapContractDigest, "string");
    assert.deepEqual(
      (payload.gapContract as { reusablePaths: string[] }).reusablePaths,
      ["src/module.ts"],
    );

    const staleTask = standaloneSucceededTask(store, "stale-structured-correction", "failed");
    const staleAttemptId = seedPassingVerification(store, staleTask);
    store.updateAttempt(staleAttemptId, { status: "failed", exitCode: 1, error: "Needs correction" });
    store.setTaskStatus(staleTask.id, "failed", { error: "Needs correction" });
    await mkdir(staleTask.paths.root, { recursive: true });
    await writeFile(staleTask.paths.diff, "original candidate bytes\n");
    const staleRevision = await captureCandidateRevision(
      store, store.getTask(staleTask.id), store.getAttempt(staleAttemptId),
      1, false, ["src/stale.ts"], 1, 2,
    );
    await writeFile(staleTask.paths.diff, "changed candidate bytes\n");
    const beforeEvents = store.listEvents(staleTask.id).length;
    assert.throws(
      () => coordinator.correct(
        staleTask.id,
        "Try to repair a stale candidate revision",
        null,
        true,
        staleRevision.id,
        ["src/stale.ts"],
        [{
          description: "Repair the remaining stale issue",
          acceptanceExpectation: "The original acceptance command passes",
        }],
      ),
      /no longer matches the current workspace/,
    );
    assert.equal(store.getTask(staleTask.id).status, "failed");
    assert.equal(store.listEvents(staleTask.id).length, beforeEvents);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("correct rejects succeeded tasks without Main revise review", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-correct-status-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  const task = standaloneSucceededTask(store, "succeeded-no-correct");
  try {
    assert.throws(
      () => coordinator.correct(task.id, "Feedback", null, true),
      /has not recorded a valid revise/,
    );
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("correct requires explicit confirm flag", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-correct-confirm-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  const task = standaloneSucceededTask(store, "no-confirm", "failed");
  seedPassingVerification(store, task);
  store.setTaskStatus(task.id, "failed", { error: "Needs correction" });
  try {
    assert.throws(
      () => coordinator.correct(task.id, "Feedback", null, false),
      /requires confirm: true/,
    );
    assert.equal(store.getTask(task.id).status, "failed");
    assert.equal(
      store.listEvents(task.id).filter((event) => event.type === "attempt.authorization.granted").length,
      0,
    );
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("correct requires non-empty feedback", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-correct-fb-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  const task = standaloneSucceededTask(store, "blank-feedback", "failed");
  seedPassingVerification(store, task);
  store.setTaskStatus(task.id, "failed", { error: "Needs correction" });
  try {
    assert.throws(
      () => coordinator.correct(task.id, "   " as unknown as string, null, true),
      /correction feedback/,
    );
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("correction recovery reconstructs a post-grant crash without duplicate authorization", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-correct-recovery-"));
  const store = new StateStore(home);
  const task = standaloneSucceededTask(store, "correction-recovery", "failed");
  const attemptId = seedPassingVerification(store, task);
  store.updateAttempt(attemptId, { status: "failed", exitCode: 1, error: "Needs correction" });
  store.setTaskStatus(task.id, "failed", { error: "Needs correction" });
  authorizeMainCorrection(store, task.id, {
    feedback: "Keep the useful files and repair the failed boundary",
    maxBudgetUsd: null,
    confirm: true,
  }, 3, 1, 20);

  const recoveredCoordinator = testCoordinator(store, 0);
  try {
    const recovered = await recoveredCoordinator.recover();
    assert.ok(recovered.includes(task.id));
    assert.equal(store.getTask(task.id).status, "queued");
    assert.equal(
      store.listEvents(task.id).filter((event) => event.type === "attempt.authorization.granted").length,
      1,
    );
  } finally {
    await recoveredCoordinator.shutdown();
    store.close();
  }
});

test("pending correction cannot be replayed with different Main feedback", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-correct-conflict-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  const task = standaloneSucceededTask(store, "correction-conflict", "failed");
  const attemptId = seedPassingVerification(store, task);
  store.updateAttempt(attemptId, { status: "failed", exitCode: 1, error: "Needs correction" });
  store.setTaskStatus(task.id, "failed", { error: "Needs correction" });
  authorizeMainCorrection(store, task.id, {
    feedback: "Original bounded correction",
    maxBudgetUsd: null,
    confirm: true,
  }, 3, 1, 20);
  try {
    assert.throws(
      () => coordinator.correct(task.id, "Different direction", null, true),
      /conflicts with requested authorization/,
    );
    assert.equal(store.getTask(task.id).status, "failed");
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

// --- Succeeded + Main revise correction path ---

test("structured correction succeeds for succeeded task with valid Main revise review", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-correct-succeeded-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  const task = standaloneSucceededTask(store, "succeeded-correct-ok");
  const attemptId = seedPassingVerification(store, task);
  store.setTaskStatus(task.id, "succeeded", { error: null });
  await mkdir(task.paths.root, { recursive: true });
  await writeFile(task.paths.diff, "succeeded candidate bytes\n");
  const revision = await captureCandidateRevision(
    store, store.getTask(task.id), store.getAttempt(attemptId),
    1, true, ["src/module.ts", "src/utils.ts"], 2, 6,
  );
  // Seed a Main revise review bound to the latest verification
  const verSeq = store.listEvents(task.id)
    .filter((e) => e.type === "verification.completed" && e.attemptId === attemptId)
    .reduce((latest, e) => latest === undefined || e.sequence > latest.sequence ? e : latest, undefined as { sequence: number } | undefined);
  assert.ok(verSeq !== undefined, "verification event must exist");
  store.addEvent(task.id, attemptId, "main-review.completed",
    "Main review: revise", {
      decision: "revise",
      reason: "Keep the useful module work and repair two remaining gaps",
      attemptId,
      verificationEventSequence: verSeq.sequence,
    });
  try {
    const result = coordinator.correct(
      task.id,
      "Keep the useful module and repair its remaining boundary",
      null,
      true,
      revision.id,
      ["src/module.ts", "src/utils.ts"],
      [{
        description: "Repair the remaining module boundary",
        acceptanceExpectation: "The original acceptance command passes",
      }],
    );
    assert.equal(result.status, "queued");
    const grants = store.listEvents(task.id).filter((e) => e.type === "attempt.authorization.granted");
    assert.equal(grants.length, 1);
    assert.equal((grants[0]?.payload as Record<string, unknown>)?.kind, "correction");
    assert.equal((grants[0]?.payload as Record<string, unknown>)?.candidateRevisionId, revision.id);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("structured correction rejects succeeded task with stale diff before mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-correct-succ-stale-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  const task = standaloneSucceededTask(store, "succeeded-stale-correct");
  const attemptId = seedPassingVerification(store, task);
  store.setTaskStatus(task.id, "succeeded", { error: null });
  await mkdir(task.paths.root, { recursive: true });
  await writeFile(task.paths.diff, "original candidate bytes\n");
  const revision = await captureCandidateRevision(
    store, store.getTask(task.id), store.getAttempt(attemptId),
    1, true, ["src/module.ts"], 1, 4,
  );
  const verSeq = store.listEvents(task.id)
    .filter((e) => e.type === "verification.completed" && e.attemptId === attemptId)
    .reduce((latest, e) => latest === undefined || e.sequence > latest.sequence ? e : latest, undefined as { sequence: number } | undefined);
  store.addEvent(task.id, attemptId, "main-review.completed",
    "Main review: revise", {
      decision: "revise", reason: "Repair the remaining gaps",
      attemptId, verificationEventSequence: verSeq?.sequence ?? 1,
    });
  await writeFile(task.paths.diff, "changed after revision\n");
  const beforeEvents = store.listEvents(task.id).length;
  try {
    assert.throws(
      () => coordinator.correct(
        task.id, "Try to repair stale candidate", null, true,
        revision.id, ["src/module.ts"],
        [{
          description: "Repair the remaining stale issue",
          acceptanceExpectation: "The original acceptance command passes",
        }],
      ),
      /no longer matches the current workspace/,
    );
    assert.equal(store.getTask(task.id).status, "succeeded");
    assert.equal(store.listEvents(task.id).length, beforeEvents);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("structured correction rejects succeeded task with accept review before mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-correct-succ-accept-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  const task = standaloneSucceededTask(store, "succeeded-accept-correct");
  const attemptId = seedPassingVerification(store, task);
  store.setTaskStatus(task.id, "succeeded", { error: null });
  await mkdir(task.paths.root, { recursive: true });
  await writeFile(task.paths.diff, "candidate bytes\n");
  const revision = await captureCandidateRevision(
    store, store.getTask(task.id), store.getAttempt(attemptId),
    1, true, ["src/module.ts"], 1, 4,
  );
  const verSeq = store.listEvents(task.id)
    .filter((e) => e.type === "verification.completed" && e.attemptId === attemptId)
    .reduce((latest, e) => latest === undefined || e.sequence > latest.sequence ? e : latest, undefined as { sequence: number } | undefined);
  store.addEvent(task.id, attemptId, "main-review.completed",
    "Main review: accept", {
      decision: "accept", reason: "Looks good",
      attemptId, verificationEventSequence: verSeq?.sequence ?? 1,
    });
  const beforeEvents = store.listEvents(task.id).length;
  try {
    assert.throws(
      () => coordinator.correct(
        task.id, "Try to correct", null, true,
        revision.id, ["src/module.ts"],
        [{
          description: "Repair the remaining issue",
          acceptanceExpectation: "The original acceptance command passes",
        }],
      ),
      /no-main-revise|has not recorded a valid revise/,
    );
    assert.equal(store.getTask(task.id).status, "succeeded");
    assert.equal(store.listEvents(task.id).length, beforeEvents);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("maxExtraAttempts zero does not block structured correction with maxMainCorrections one", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-correct-relay-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  // Simulate the Relay scenario: base=1, extra=0, corrections=1
  settings.update({ execution: { maxAttempts: 1, maxExtraAttempts: 0 } });
  const coordinator = new DaemonCoordinator(store, settings, 0);
  const task = standaloneSucceededTask(store, "relay-correct");
  const attemptId = seedPassingVerification(store, task);
  store.setTaskStatus(task.id, "succeeded", { error: null });
  await mkdir(task.paths.root, { recursive: true });
  await writeFile(task.paths.diff, "candidate bytes\n");
  const revision = await captureCandidateRevision(
    store, store.getTask(task.id), store.getAttempt(attemptId),
    1, true, ["src/module.ts"], 1, 4,
  );
  const verSeq = store.listEvents(task.id)
    .filter((e) => e.type === "verification.completed" && e.attemptId === attemptId)
    .reduce((latest, e) => latest === undefined || e.sequence > latest.sequence ? e : latest, undefined as { sequence: number } | undefined);
  store.addEvent(task.id, attemptId, "main-review.completed",
    "Main review: revise", {
      decision: "revise", reason: "Minor gap remaining",
      attemptId, verificationEventSequence: verSeq?.sequence ?? 1,
    });
  try {
    const result = coordinator.correct(
      task.id, "Repair the minor gap", null, true,
      revision.id, ["src/module.ts"],
      [{
        description: "Repair the remaining module issue",
        acceptanceExpectation: "The original acceptance command passes",
      }],
    );
    assert.equal(result.status, "queued");
    assert.equal(store.listEvents(task.id).filter((e) => e.type === "attempt.authorization.granted").length, 1);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});
