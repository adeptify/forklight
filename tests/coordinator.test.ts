import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DaemonCoordinator } from "../src/daemon/coordinator.js";
import {
  defaultAdvancedPolicyFields,
  defaultEnforcementCapability,
  resolveEffectivePolicy,
} from "../src/core/advanced-policy.js";
import {
  authorizeWorkerValidationRepair,
  decideWorkerValidationRepair,
  recordWorkerValidationRepairCompleted,
  recordWorkerValidationRepairStarted,
} from "../src/core/worker-validation-repair.js";
import { registerTaskFromSpec } from "../src/core/runner.js";
import { SettingsService } from "../src/core/settings.js";
import { StateStore } from "../src/state/store.js";
import { prepareWorkspace } from "../src/workspace/copy.js";
import type { ProviderAuthInspector } from "../src/core/providers.js";
import type {
  AttemptRecord,
  CandidateRevision,
  TaskRecord,
  VerificationResult,
} from "../src/core/types.js";
import type { WorkerAdapter, WorkerRunContext } from "../src/workers/types.js";
import { getWorkerAdapter, registerWorkerAdapter, resetWorkerRegistryForTests } from "../src/workers/registry.js";

const AUTH_READY: ProviderAuthInspector = {
  hasReadableKeychainValue: () => true,
  hasLocalGrokSignIn: () => true,
};

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 15_000,
  diagnostic: string | (() => string) = "",
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  const detail = typeof diagnostic === "function" ? diagnostic() : diagnostic;
  assert.equal(predicate(), true, `Coordinator did not reach its terminal state in time ${detail}`);
}

function installRepairWorker(passAfter: number, onRun?: (context: WorkerRunContext) => void): void {
  const builtin = getWorkerAdapter("claude-code");
  const capabilities = builtin.capabilities();
  resetWorkerRegistryForTests();
  // Re-seed built-ins before replacing one entry; registry lookup lazily
  // registers built-ins when its initialized flag is false.
  getWorkerAdapter("claude-code");
  const calls = new Map<string, number>();
  const adapter: WorkerAdapter = {
    name: "claude-code",
    displayName: "FL-114 coordinator test Worker",
    defaultExecutable: process.execPath,
    capabilities: () => capabilities,
    doctor: () => ({
      runtime: "claude-code",
      ok: true,
      executable: process.execPath,
      issues: [],
      capabilities,
    }),
    validateSpec: () => {},
    effortArgs: () => [],
    toolProtocolAppendix: () => [],
    checkpointProtocolAppendix: () => [],
    run: async (ctx) => {
      onRun?.(ctx);
      const count = (calls.get(ctx.task.id) ?? 0) + 1;
      calls.set(ctx.task.id, count);
      await writeFile(
        path.join(ctx.task.paths.workspace, "src", "worker-change.txt"),
        `attempt-${count}\n`,
      );
      if (count >= passAfter) {
        await writeFile(path.join(ctx.task.paths.workspace, "fixed.txt"), "fixed\n");
      }
      ctx.store.addEvent(ctx.task.id, ctx.attempt.id, "worker.completed", "Test Worker completed", {
        provider: ctx.task.spec.provider.name,
        model: ctx.task.spec.provider.model,
        runtime: ctx.task.spec.runtime.name,
      });
      ctx.hooks?.onEvent?.({
        type: "worker.completed",
        summary: "Test Worker completed",
        terminal: { isError: false, resultText: "ok" },
      });
      return { status: "succeeded", exitCode: 0, resultText: "ok" };
    },
  };
  registerWorkerAdapter(adapter);
}

async function runCoordinatorTask(options: {
  home: string;
  project: string;
  maxRepairs?: number;
  passAfter: number;
}): Promise<{ store: StateStore; coordinator: DaemonCoordinator; taskId: string }> {
  const store = new StateStore(options.home);
  const settings = new SettingsService(store);
  if (options.maxRepairs !== undefined) {
    settings.update({ execution: { maxWorkerValidationRepairs: options.maxRepairs } });
  }
  const coordinator = new DaemonCoordinator(store, settings, 1, AUTH_READY);
  installRepairWorker(options.passAfter);
  const task = await coordinator.submit({
    version: 1,
    name: "FL-114 Coordinator call chain",
    project: options.project,
    goal: "Make the check pass",
    constraints: [],
    provider: { name: "deepseek", model: "test-model", keychainService: "test" },
    runtime: { name: "claude-code", executable: process.execPath, effort: "low", maxBudgetUsd: null },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
    acceptance: {
      commands: ["node -e \"process.exit(require('node:fs').existsSync('fixed.txt') ? 0 : 1)\""],
    },
    ...(options.maxRepairs === undefined ? {} : { advancedPolicy: { maxWorkerValidationRepairs: options.maxRepairs } }),
  }, options.home);
  return { store, coordinator, taskId: task.id };
}

interface RepairRecoveryFixture {
  home: string;
  store: StateStore;
  settings: SettingsService;
  task: TaskRecord;
  priorAttempt: AttemptRecord;
  authorization: ReturnType<typeof authorizeWorkerValidationRepair>;
  repairAttempt?: AttemptRecord;
}

async function createRepairRecoveryFixture(started: boolean): Promise<RepairRecoveryFixture> {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-coordinator-repair-window-"));
  const project = path.join(home, "project");
  await mkdir(path.join(project, "src"), { recursive: true });
  await writeFile(path.join(project, "src", "original.txt"), "original\n");
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const spec = {
    version: 1,
    name: started
      ? "FL-114 started repair recovery"
      : "FL-114 authorized repair recovery",
    project,
    goal: "recover the exact Worker validation-repair round",
    constraints: [],
    provider: { name: "deepseek", model: "test-model", keychainService: "test" },
    runtime: { name: "claude-code", executable: process.execPath, effort: "low", maxBudgetUsd: null },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
    workspace: { exclude: [] },
    acceptance: { commands: ["test -f fixed.txt"] },
    executionMode: "single-run",
  } as TaskRecord["spec"];
  const effectivePolicy = resolveEffectivePolicy(
    undefined,
    { maxWorkerValidationRepairs: 1 },
    defaultAdvancedPolicyFields(),
    "global",
    defaultEnforcementCapability(),
  );
  const task = registerTaskFromSpec(
    store,
    spec,
    "forklight://test/repair-recovery-window",
    effectivePolicy,
  );
  await prepareWorkspace(spec, task.paths);

  const priorAttempt: AttemptRecord = {
    id: started ? "window-prior-started" : "window-prior-authorized",
    taskId: task.id,
    ordinal: 1,
    status: "succeeded",
    sessionId: task.sessionId,
    rawLogPath: path.join(task.paths.logs, "attempt-1.jsonl"),
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };
  store.createAttempt(priorAttempt);
  store.setTaskStatus(task.id, "failed", {
    currentAttemptId: priorAttempt.id,
    finishedAt: new Date().toISOString(),
    error: "behavior failed",
  });
  store.addEvent(task.id, priorAttempt.id, "worker.completed", "test Worker completed");
  const verification: VerificationResult = {
    passed: false,
    behaviorPassed: false,
    policyPassed: true,
    sourceCompatible: true,
    commands: [{
      command: "test -f fixed.txt",
      exitCode: 1,
      stdout: "",
      stderr: "",
      durationMs: 1,
      timedOut: false,
    }],
    diffPath: path.join(task.paths.root, "diff.patch"),
    sourceUnchanged: false,
  };
  const verificationEvent = store.addEvent(
    task.id,
    priorAttempt.id,
    "verification.completed",
    "verification failed",
    verification,
  );
  const candidate: CandidateRevision = {
    id: started ? "window-prior-started-revision" : "window-prior-authorized-revision",
    taskId: task.id,
    attemptId: priorAttempt.id,
    attemptOrdinal: priorAttempt.ordinal,
    verificationEventSequence: verificationEvent.sequence,
    patchDigest: "a".repeat(64),
    affectedPaths: ["src/fix.ts"],
    filesChanged: 1,
    changedLines: 1,
    verificationPassed: false,
    createdAt: new Date().toISOString(),
  };
  store.addEvent(task.id, priorAttempt.id, "candidate.revision.captured", "candidate captured", candidate);
  const decision = decideWorkerValidationRepair({
    task: store.getTask(task.id),
    attempt: priorAttempt,
    workerStatus: "succeeded",
    verification,
    candidateRevision: candidate,
    verificationEventSequence: verificationEvent.sequence,
    runtimeCapabilities: { sessionResume: "supported", nativeGoal: "unsupported" },
  });
  const authorization = authorizeWorkerValidationRepair(store, store.getTask(task.id), {
    decision,
    priorAttemptId: priorAttempt.id,
    verificationEventSequence: verificationEvent.sequence,
    candidateRevisionId: candidate.id,
    feedback: "repair the failed behavior and rerun validation",
  });

  if (started) {
    const staleFinishedAt = new Date(Date.now() - 1_000).toISOString();
    const repairAttempt: AttemptRecord = {
      id: authorization.attemptId,
      taskId: task.id,
      ordinal: authorization.targetAttemptOrdinal,
      status: "interrupted",
      sessionId: task.sessionId,
      rawLogPath: path.join(task.paths.logs, "attempt-2.jsonl"),
      startedAt: new Date(Date.now() - 2_000).toISOString(),
      finishedAt: staleFinishedAt,
      pid: 424242,
      exitCode: 130,
      error: "stale terminal error",
      executionKind: "worker-validation-repair",
      workerValidationRepairRound: authorization.round,
    };
    store.createAttempt(repairAttempt);
    store.setTaskStatus(task.id, "interrupted", {
      currentAttemptId: repairAttempt.id,
      finishedAt: staleFinishedAt,
      error: "daemon interrupted during repair",
    });
    recordWorkerValidationRepairStarted(store, authorization);
    return {
      home,
      store,
      settings,
      task: store.getTask(task.id),
      priorAttempt,
      authorization,
      repairAttempt,
    };
  }

  return {
    home,
    store,
    settings,
    task: store.getTask(task.id),
    priorAttempt,
    authorization,
  };
}

test("real Daemon Coordinator runs one same-Worker repair and stops at Main review", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-coordinator-repair-"));
  const project = path.join(home, "project");
  await mkdir(path.join(project, "src"), { recursive: true });
  await writeFile(path.join(project, "src", "original.txt"), "original\n");
  const { store, coordinator, taskId } = await runCoordinatorTask({
    home,
    project,
    passAfter: 2,
  });
  try {
    await waitFor(
      () => store.getTask(taskId).status === "succeeded",
      15_000,
      () => JSON.stringify({
        status: store.getTask(taskId).status,
        error: store.getTask(taskId).error,
        attempts: store.listAttempts(taskId),
        events: store.listEvents(taskId).map((event) => ({ type: event.type, summary: event.summary, payload: event.payload })),
      }),
    );
    const events = store.listEvents(taskId);
    const attempts = store.listAttempts(taskId);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1]?.executionKind, "worker-validation-repair");
    assert.equal(events.filter((event) => event.type === "worker.validation-repair.authorized").length, 1);
    assert.equal(events.filter((event) => event.type === "worker.validation-repair.started").length, 1);
    assert.equal(events.filter((event) => event.type === "worker.validation-repair.completed").length, 1);
    assert.equal(events.some((event) => event.type === "worker.validation-repair.skipped"), false);
    assert.equal(store.getIntegrationResult("missing") === undefined, true);
    assert.equal(store.listIntegrationResults(taskId).length, 0);
  } finally {
    await coordinator.shutdown("stop");
    store.close();
    await rm(home, { recursive: true, force: true });
    resetWorkerRegistryForTests();
  }
});

test("configured allowance two authorizes exactly the next finite round", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-coordinator-two-rounds-"));
  const project = path.join(home, "project");
  await mkdir(path.join(project, "src"), { recursive: true });
  await writeFile(path.join(project, "src", "original.txt"), "original\n");
  const { store, coordinator, taskId } = await runCoordinatorTask({
    home,
    project,
    maxRepairs: 2,
    passAfter: 3,
  });
  try {
    await waitFor(
      () => store.getTask(taskId).status === "succeeded",
      15_000,
      () => JSON.stringify({
        status: store.getTask(taskId).status,
        error: store.getTask(taskId).error,
        attempts: store.listAttempts(taskId),
        events: store.listEvents(taskId).map((event) => ({ type: event.type, summary: event.summary, payload: event.payload })),
      }),
    );
    const events = store.listEvents(taskId);
    const attempts = store.listAttempts(taskId);
    assert.equal(attempts.length, 3);
    assert.deepEqual(
      attempts.slice(1).map((attempt) => [attempt.executionKind, attempt.workerValidationRepairRound]),
      [["worker-validation-repair", 1], ["worker-validation-repair", 2]],
    );
    assert.equal(events.filter((event) => event.type === "worker.validation-repair.authorized").length, 2);
    assert.equal(events.filter((event) => event.type === "worker.validation-repair.started").length, 2);
    assert.equal(events.filter((event) => event.type === "worker.validation-repair.completed").length, 2);
  } finally {
    await coordinator.shutdown("stop");
    store.close();
    await rm(home, { recursive: true, force: true });
    resetWorkerRegistryForTests();
  }
});

test("Coordinator recovery starts an authorized-before-start repair exactly once", async () => {
  const fixture = await createRepairRecoveryFixture(false);
  const { home, store, settings, task, authorization } = fixture;
  installRepairWorker(1);
  const coordinator = new DaemonCoordinator(store, settings, 1, AUTH_READY);
  try {
    const recovered = await coordinator.recover();
    assert.equal(recovered.includes(task.id), true);
    await waitFor(
      () => store.getTask(task.id).status === "succeeded",
      15_000,
      () => JSON.stringify({
        status: store.getTask(task.id).status,
        error: store.getTask(task.id).error,
        attempts: store.listAttempts(task.id),
        events: store.listEvents(task.id).map((event) => ({ type: event.type, payload: event.payload })),
      }),
    );
    const attempts = store.listAttempts(task.id);
    const events = store.listEvents(task.id);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1]?.id, authorization.attemptId);
    assert.equal(attempts[1]?.executionKind, "worker-validation-repair");
    assert.equal(attempts[1]?.workerValidationRepairRound, authorization.round);
    assert.equal(events.filter((event) => event.type === "worker.validation-repair.authorized").length, 1);
    assert.equal(events.filter((event) => event.type === "worker.validation-repair.started").length, 1);
    assert.equal(events.filter((event) => event.type === "worker.validation-repair.completed").length, 1);
    assert.equal(events.some((event) => event.type === "attempt.authorization.granted"), false);
    assert.equal(events.some((event) => event.type === "attempt.restart-continuation.skipped"), false);
  } finally {
    await coordinator.shutdown("stop");
    store.close();
    await rm(home, { recursive: true, force: true });
    resetWorkerRegistryForTests();
  }
});

test("Coordinator recovery resumes a started repair Attempt on the exact round and clears stale terminal metadata", async () => {
  const fixture = await createRepairRecoveryFixture(true);
  const { home, store, settings, task, authorization, repairAttempt } = fixture;
  assert.ok(repairAttempt);
  const observations: Array<{ context: WorkerRunContext; persisted: AttemptRecord }> = [];
  installRepairWorker(1, (context) => {
    observations.push({ context, persisted: context.store.getAttempt(context.attempt.id) });
  });
  const coordinator = new DaemonCoordinator(store, settings, 1, AUTH_READY);
  try {
    const recovered = await coordinator.recover();
    assert.equal(recovered.includes(task.id), true);
    await waitFor(
      () => store.getTask(task.id).status === "succeeded",
      15_000,
      () => JSON.stringify({
        status: store.getTask(task.id).status,
        error: store.getTask(task.id).error,
        attempts: store.listAttempts(task.id),
        events: store.listEvents(task.id).map((event) => ({ type: event.type, payload: event.payload })),
      }),
    );
    assert.equal(observations.length, 1);
    const observation = observations[0]!;
    assert.equal(observation.context.attempt.id, authorization.attemptId);
    assert.equal(observation.context.attempt.status, "running");
    assert.equal(observation.context.attempt.pid, undefined);
    assert.equal(observation.context.attempt.finishedAt, undefined);
    assert.equal(observation.context.attempt.exitCode, undefined);
    assert.equal(observation.context.attempt.error, undefined);
    assert.equal(observation.persisted.status, "running");
    assert.equal(observation.persisted.pid, undefined);
    assert.equal(observation.persisted.finishedAt, undefined);
    assert.equal(observation.persisted.exitCode, undefined);
    assert.equal(observation.persisted.error, undefined);

    const attempts = store.listAttempts(task.id);
    const events = store.listEvents(task.id);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1]?.id, repairAttempt.id);
    assert.equal(attempts[1]?.executionKind, "worker-validation-repair");
    assert.equal(attempts[1]?.workerValidationRepairRound, authorization.round);
    assert.equal(events.filter((event) => event.type === "worker.validation-repair.authorized").length, 1);
    assert.equal(events.filter((event) => event.type === "worker.validation-repair.started").length, 1);
    assert.equal(events.filter((event) => event.type === "worker.validation-repair.completed").length, 1);
    assert.equal(events.some((event) => event.type === "attempt.authorization.granted"), false);
    assert.equal(events.some((event) => event.type === "attempt.restart-continuation.skipped"), false);
  } finally {
    await coordinator.shutdown("stop");
    store.close();
    await rm(home, { recursive: true, force: true });
    resetWorkerRegistryForTests();
  }
});

test("restart after a terminal repair Attempt queues the exact next round", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-coordinator-repair-restart-"));
  const project = path.join(home, "project");
  await mkdir(path.join(project, "src"), { recursive: true });
  await writeFile(path.join(project, "src", "original.txt"), "original\n");
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const spec = {
    version: 1,
    name: "FL-114 terminal repair recovery",
    project,
    goal: "recover the next repair round",
    constraints: [],
    provider: { name: "deepseek", model: "test-model", keychainService: "test" },
    runtime: { name: "claude-code", executable: process.execPath, effort: "low", maxBudgetUsd: null },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
    workspace: { exclude: [] },
    acceptance: { commands: ["true"] },
    executionMode: "single-run",
  } as TaskRecord["spec"];
  const effectivePolicy = resolveEffectivePolicy(
    undefined,
    { maxWorkerValidationRepairs: 2 },
    defaultAdvancedPolicyFields(),
    "global",
    defaultEnforcementCapability(),
  );
  const task = registerTaskFromSpec(store, spec, "forklight://test/restart", effectivePolicy);
  const verification = (): VerificationResult => ({
    passed: false,
    behaviorPassed: false,
    policyPassed: true,
    sourceCompatible: true,
    commands: [{
      command: "true",
      exitCode: 1,
      stdout: "",
      stderr: "",
      durationMs: 1,
      timedOut: false,
    }],
    diffPath: path.join(task.paths.root, "diff.patch"),
    sourceUnchanged: false,
  });
  const candidate = (attempt: AttemptRecord, id: string, sequence: number, digest: string): CandidateRevision => ({
    id,
    taskId: task.id,
    attemptId: attempt.id,
    attemptOrdinal: attempt.ordinal,
    verificationEventSequence: sequence,
    patchDigest: digest.repeat(64).slice(0, 64),
    affectedPaths: ["src/fix.ts"],
    filesChanged: 1,
    changedLines: 1,
    verificationPassed: false,
    createdAt: new Date().toISOString(),
  });
  const prior: AttemptRecord = {
    id: "restart-prior-attempt",
    taskId: task.id,
    ordinal: 1,
    status: "succeeded",
    sessionId: task.sessionId,
    rawLogPath: path.join(task.paths.logs, "attempt-1.jsonl"),
    startedAt: new Date().toISOString(),
  };
  store.createAttempt(prior);
  store.setTaskStatus(task.id, "failed", { error: "behavior failed", finishedAt: new Date().toISOString() });
  store.addEvent(task.id, prior.id, "worker.completed", "test Worker completed");
  const priorVerification = store.addEvent(task.id, prior.id, "verification.completed", "verification failed", verification());
  const priorCandidate = candidate(prior, "restart-prior-revision", priorVerification.sequence, "a");
  store.addEvent(task.id, prior.id, "candidate.revision.captured", "candidate captured", priorCandidate);
  const firstDecision = decideWorkerValidationRepair({
    task: store.getTask(task.id),
    attempt: prior,
    workerStatus: "succeeded",
    verification: verification(),
    candidateRevision: priorCandidate,
    verificationEventSequence: priorVerification.sequence,
    runtimeCapabilities: { sessionResume: "supported", nativeGoal: "unsupported" },
  });
  const firstAuthorization = authorizeWorkerValidationRepair(store, store.getTask(task.id), {
    decision: firstDecision,
    priorAttemptId: prior.id,
    verificationEventSequence: priorVerification.sequence,
    candidateRevisionId: priorCandidate.id,
    feedback: "repair round one",
  });
  const repairAttempt: AttemptRecord = {
    id: firstAuthorization.attemptId,
    taskId: task.id,
    ordinal: firstAuthorization.targetAttemptOrdinal,
    status: "failed",
    sessionId: task.sessionId,
    rawLogPath: path.join(task.paths.logs, "attempt-2.jsonl"),
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    executionKind: "worker-validation-repair",
    workerValidationRepairRound: 1,
  };
  store.createAttempt(repairAttempt);
  store.addEvent(task.id, repairAttempt.id, "worker.completed", "test Worker completed");
  const repairVerification = store.addEvent(task.id, repairAttempt.id, "verification.completed", "verification failed", verification());
  const repairCandidate = candidate(repairAttempt, "restart-repair-revision", repairVerification.sequence, "b");
  store.addEvent(task.id, repairAttempt.id, "candidate.revision.captured", "candidate captured", repairCandidate);
  // A late finalization failure after a completion must not be mistaken for
  // a normal Worker return by the repair allowlist.
  store.addEvent(task.id, prior.id, "worker.failed", "late finalization failure");
  recordWorkerValidationRepairStarted(store, firstAuthorization);
  recordWorkerValidationRepairCompleted(store, {
    authorization: firstAuthorization,
    attemptId: repairAttempt.id,
    outcome: "failed",
  });

  const coordinator = new DaemonCoordinator(store, settings, 0, AUTH_READY);
  try {
    const evidence = (coordinator as unknown as {
      workerValidationRepairEvidence: (taskId: string, attemptId: string) => { workerStatus: string };
    }).workerValidationRepairEvidence(task.id, prior.id);
    assert.equal(evidence.workerStatus, "failed");
    await coordinator.recover();
    const queue = (coordinator as unknown as {
      queue: Array<{ workerValidationRepair?: { round: number; attemptId: string } }>;
    }).queue;
    assert.equal(store.getTask(task.id).status, "queued");
    assert.equal(queue.length, 1);
    assert.equal(queue[0]?.workerValidationRepair?.round, 2);
    assert.equal(queue[0]?.workerValidationRepair?.attemptId !== repairAttempt.id, true);
    assert.equal(store.listEvents(task.id).filter((event) => event.type === "worker.validation-repair.authorized").length, 2);
  } finally {
    await coordinator.shutdown("stop");
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("restart after a passed repair Attempt closes a pending round on a succeeded Task", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-coordinator-passed-repair-restart-"));
  const project = path.join(home, "project");
  await mkdir(path.join(project, "src"), { recursive: true });
  await writeFile(path.join(project, "src", "original.txt"), "original\n");
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const spec = {
    version: 1,
    name: "FL-114 passed repair recovery",
    project,
    goal: "close the passed round",
    constraints: [],
    provider: { name: "deepseek", model: "test-model", keychainService: "test" },
    runtime: { name: "claude-code", executable: process.execPath, effort: "low", maxBudgetUsd: null },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
    workspace: { exclude: [] },
    acceptance: { commands: ["true"] },
    executionMode: "single-run",
  } as TaskRecord["spec"];
  const effectivePolicy = resolveEffectivePolicy(
    undefined,
    { maxWorkerValidationRepairs: 1 },
    defaultAdvancedPolicyFields(),
    "global",
    defaultEnforcementCapability(),
  );
  const task = registerTaskFromSpec(store, spec, "forklight://test/passed-restart", effectivePolicy);
  const prior: AttemptRecord = {
    id: "passed-restart-prior",
    taskId: task.id,
    ordinal: 1,
    status: "succeeded",
    sessionId: task.sessionId,
    rawLogPath: path.join(task.paths.logs, "attempt-1.jsonl"),
    startedAt: new Date().toISOString(),
  };
  store.createAttempt(prior);
  store.addEvent(task.id, prior.id, "worker.completed", "test Worker completed");
  const priorVerification = store.addEvent(task.id, prior.id, "verification.completed", "verification failed", {
    passed: false,
    behaviorPassed: false,
    policyPassed: true,
    sourceCompatible: true,
    commands: [{ command: "true", exitCode: 1, stdout: "", stderr: "", durationMs: 1, timedOut: false }],
    diffPath: path.join(task.paths.root, "diff.patch"),
    sourceUnchanged: false,
  });
  const priorCandidate: CandidateRevision = {
    id: "passed-restart-prior-revision",
    taskId: task.id,
    attemptId: prior.id,
    attemptOrdinal: prior.ordinal,
    verificationEventSequence: priorVerification.sequence,
    patchDigest: "a".repeat(64),
    affectedPaths: ["src/fix.ts"],
    filesChanged: 1,
    changedLines: 1,
    verificationPassed: false,
    createdAt: new Date().toISOString(),
  };
  store.addEvent(task.id, prior.id, "candidate.revision.captured", "candidate captured", priorCandidate);
  const authorization = authorizeWorkerValidationRepair(store, store.getTask(task.id), {
    decision: decideWorkerValidationRepair({
      task: store.getTask(task.id),
      attempt: prior,
      workerStatus: "succeeded",
      verification: store.listEvents(task.id).find((event) => event.sequence === priorVerification.sequence)!.payload as VerificationResult,
      candidateRevision: priorCandidate,
      verificationEventSequence: priorVerification.sequence,
      runtimeCapabilities: { sessionResume: "supported", nativeGoal: "unsupported" },
    }),
    priorAttemptId: prior.id,
    verificationEventSequence: priorVerification.sequence,
    candidateRevisionId: priorCandidate.id,
    feedback: "close passed round",
  });
  const repairAttempt: AttemptRecord = {
    id: authorization.attemptId,
    taskId: task.id,
    ordinal: authorization.targetAttemptOrdinal,
    status: "succeeded",
    sessionId: task.sessionId,
    rawLogPath: path.join(task.paths.logs, "attempt-2.jsonl"),
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    executionKind: "worker-validation-repair",
    workerValidationRepairRound: 1,
  };
  store.createAttempt(repairAttempt);
  store.addEvent(task.id, repairAttempt.id, "worker.completed", "test Worker completed");
  store.setTaskStatus(task.id, "succeeded", { finishedAt: new Date().toISOString(), currentAttemptId: repairAttempt.id });

  const coordinator = new DaemonCoordinator(store, settings, 0, AUTH_READY);
  try {
    await coordinator.recover();
    const events = store.listEvents(task.id);
    assert.equal(events.filter((event) => event.type === "worker.validation-repair.authorized").length, 1);
    assert.equal(events.filter((event) => event.type === "worker.validation-repair.started").length, 1);
    assert.equal(events.filter((event) => event.type === "worker.validation-repair.completed").length, 1);
    assert.equal(
      (events.find((event) => event.type === "worker.validation-repair.completed")?.payload as { outcome?: string } | undefined)?.outcome,
      "passed",
    );
    assert.equal((coordinator as unknown as { queue: unknown[] }).queue.length, 0);
  } finally {
    await coordinator.shutdown("stop");
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});
