/**
 * FL-109C1: canonical Task action policy (Core).
 * Proves the closed seven-destination policy for the required scenarios:
 * queued dependency-held, active, awaiting Main review, ready-for-integration,
 * failed/interrupted, explicitly resolved, delivered, and unknown evidence.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildTaskRecord } from "../src/core/runner.js";
import { parseTaskSpec } from "../src/core/task.js";
import {
  projectTaskActionPolicy,
  TASK_ACTION_POLICY_SCHEMA_VERSION,
  type TaskActionPolicy,
  type TaskActionPathStep,
} from "../src/core/task-action-policy.js";
import type { TaskResolutionState } from "../src/core/task-resolution.js";
import type {
  AttemptRecord,
  DecisionStage,
  EffectivePolicySnapshot,
  PlanRecord,
  TaskRecord,
  TaskStatus,
} from "../src/core/types.js";
import type { WorkHierarchyColumnCode } from "../src/core/work-hierarchy.js";
import { StateStore } from "../src/state/store.js";

const TS = "2026-08-03T12:00:00.000Z";

/** Frozen advanced-policy snapshot with a bounded base attempt allowance. */
function makePolicy(baseMaxAttempts: number, maxMainCorrections = 1): EffectivePolicySnapshot {
  const provenance = {
    maxDurationMs: "global" as const,
    observedTokenCeiling: "global" as const,
    noProgressTimeoutMs: "global" as const,
    workerStopGraceMs: "global" as const,
    fileLimit: "global" as const,
    fileLimitMode: "global" as const,
    changedLineLimit: "global" as const,
    changedLineLimitMode: "global" as const,
    baseMaxAttempts: "global" as const,
    maxExtraAttempts: "global" as const,
    maxConcurrency: "global" as const,
    completionMode: "global" as const,
    changeBudgetMode: "global" as const,
    maxAdaptationRounds: "global" as const,
    maxMainCorrections: "global" as const,
    maxMainReverifications: "global" as const,
  };
  return {
    profileId: "global",
    values: {
      maxDurationMs: null,
      observedTokenCeiling: null,
      noProgressTimeoutMs: null,
      workerStopGraceMs: 10_000,
      fileLimit: null,
      fileLimitMode: "warn",
      changedLineLimit: null,
      changedLineLimitMode: "warn",
      baseMaxAttempts,
      maxExtraAttempts: 0,
      maxConcurrency: 1,
      completionMode: "warn",
      changeBudgetMode: "warn",
      maxAdaptationRounds: 0,
      maxMainCorrections,
      maxMainReverifications: 0,
    },
    provenance,
    enforcementCapability: {
      durationEnforcement: "preemptive",
      tokenEnforcement: "post-observation",
      progressWatchdog: "live",
    },
  };
}

function taskRecord(
  id: string,
  opts: {
    status?: TaskStatus;
    name?: string;
    baseMaxAttempts?: number;
    effectivePolicy?: EffectivePolicySnapshot;
  } = {},
): TaskRecord {
  const spec = parseTaskSpec(
    {
      version: 1,
      name: opts.name ?? id,
      project: "/tmp/source-project",
      goal: "Exercise action policy",
      acceptance: { commands: ["npm test"] },
    },
    "/tmp",
  );
  const policy = opts.effectivePolicy
    ?? (opts.baseMaxAttempts === undefined ? undefined : makePolicy(opts.baseMaxAttempts));
  return {
    ...buildTaskRecord({
      spec,
      taskFile: `/tmp/${id}.yaml`,
      home: "/tmp/forklight-home",
      id,
      sessionId: `session-${id}`,
      createdAt: TS,
      ...(policy === undefined ? {} : { effectivePolicy: policy }),
    }),
    status: opts.status ?? "queued",
    updatedAt: TS,
  };
}

function attemptRecord(taskId: string, ordinal: number, status: AttemptRecord["status"] = "succeeded"): AttemptRecord {
  return {
    id: `${taskId}-attempt-${ordinal}`,
    taskId,
    ordinal,
    status,
    sessionId: `session-${taskId}`,
    rawLogPath: `/tmp/${taskId}/attempt-${ordinal}.log`,
    startedAt: TS,
  };
}

function addVerification(store: StateStore, taskId: string, passed = true): number {
  const event = store.addEvent(
    taskId,
    "attempt-1",
    "verification.completed",
    "Independent verification completed",
    { passed },
  );
  return event.sequence;
}

function addMainReview(
  store: StateStore,
  taskId: string,
  decision: "accept" | "revise" | "reject",
  verificationSequence: number,
): void {
  store.addEvent(
    taskId,
    "attempt-1",
    "main-review.completed",
    `Main agent review: ${decision}`,
    {
      decision,
      reason: "test reason",
      attemptId: "attempt-1",
      verificationEventSequence: verificationSequence,
    },
  );
}

/** Freeze durable retained-Candidate evidence so resolveCorrectionEligibility
 *  proves a structured correction is eligible (current Diff matches the exact
 *  CandidateRevision digest, one terminal Attempt, no correction grant used). */
async function makeCorrectionEligible(store: StateStore, task: TaskRecord): Promise<void> {
  const diff = `retained-change-for-${task.id}\n`;
  const patchDigest = createHash("sha256").update(diff).digest("hex");
  await mkdir(path.dirname(task.paths.diff), { recursive: true });
  await writeFile(task.paths.diff, diff, "utf8");
  const attempt = attemptRecord(task.id, 1, "succeeded");
  store.createAttempt(attempt);
  const verification = store.addEvent(
    task.id,
    attempt.id,
    "verification.completed",
    "Independent verification completed",
    { passed: true },
  );
  store.addEvent(
    task.id,
    attempt.id,
    "candidate.revision.captured",
    "Candidate revision captured",
    {
      id: `rev-${task.id}`,
      taskId: task.id,
      attemptId: attempt.id,
      attemptOrdinal: attempt.ordinal,
      verificationEventSequence: verification.sequence,
      patchDigest,
      affectedPaths: ["src/a.ts"],
      filesChanged: 1,
      changedLines: 2,
      verificationPassed: true,
      createdAt: TS,
    },
  );
}

function project(
  store: StateStore,
  task: TaskRecord,
  opts: {
    status?: TaskStatus;
    decisionStage?: DecisionStage;
    deps?: boolean;
    delivered?: boolean;
    resolutionState?: TaskResolutionState;
    currentColumn?: WorkHierarchyColumnCode;
  } = {},
): TaskActionPolicy {
  return projectTaskActionPolicy(store, {
    taskId: task.id,
    status: opts.status ?? task.status,
    ...(opts.decisionStage === undefined ? {} : { decisionStage: opts.decisionStage }),
    dependenciesSatisfied: opts.deps ?? true,
    delivered: opts.delivered ?? false,
    resolutionState: opts.resolutionState ?? { status: "none" },
    currentColumn: opts.currentColumn ?? "ready",
  });
}

const ALL_COLUMNS: readonly WorkHierarchyColumnCode[] = [
  "not-started",
  "ready",
  "running",
  "waiting-verification",
  "waiting-user-decision",
  "completed",
  "stopped-failed",
];

function requestableDestinations(policy: TaskActionPolicy): WorkHierarchyColumnCode[] {
  return ALL_COLUMNS.filter(
    (column) => policy.destinations[column].disposition === "requestable"
      || policy.destinations[column].disposition === "needs-input",
  );
}

// ---------------------------------------------------------------------------

test("queued dependency-held Task cannot be made Ready by a manual request", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ap-dep-held-"));
  const store = new StateStore(home);
  try {
    const task = taskRecord("dep-held", { status: "queued" });
    store.createTask(task);
    const policy = project(store, task, {
      status: "queued",
      decisionStage: "queued",
      deps: false,
      currentColumn: "not-started",
    });

    assert.equal(policy.schemaVersion, TASK_ACTION_POLICY_SCHEMA_VERSION);
    const ready = policy.destinations.ready;
    assert.equal(ready.column, "ready");
    assert.equal(ready.disposition, "automatic-only");
    assert.equal(ready.reason, "dependency-held");
    assert.equal(ready.operation, undefined);
    assert.equal(ready.requires, undefined);
    assert.equal(policy.destinations["not-started"].disposition, "no-op");

    // No destination anywhere offers a mutation.
    assert.deepEqual(requestableDestinations(policy), []);
    assert.equal(JSON.stringify(policy).includes('"operation"'), false);
  } finally {
    store.close();
  }
});

test("active running Task offers no manual mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ap-running-"));
  const store = new StateStore(home);
  try {
    const task = taskRecord("active", { status: "running" });
    store.createTask(task);
    const policy = project(store, task, {
      status: "running",
      decisionStage: "worker-running",
      currentColumn: "running",
    });

    assert.equal(policy.destinations.running.disposition, "no-op");
    assert.equal(policy.destinations.running.reason, "already-there");
    assert.equal(policy.destinations["waiting-verification"].disposition, "automatic-only");
    assert.deepEqual(requestableDestinations(policy), []);
  } finally {
    store.close();
  }
});

test("awaiting Main review encodes fixed review intent with reason and confirmation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ap-main-"));
  const store = new StateStore(home);
  try {
    const task = taskRecord("awaiting", { status: "succeeded", baseMaxAttempts: 2 });
    store.createTask(task);
    addVerification(store, task.id, true);
    const policy = project(store, task, {
      status: "succeeded",
      decisionStage: "awaiting-main-review",
      currentColumn: "waiting-user-decision",
    });

    // The Main decision column is its own column: already reached.
    assert.equal(policy.destinations["waiting-user-decision"].disposition, "no-op");
    assert.equal(policy.destinations["waiting-user-decision"].reason, "already-there");

    // Completed encodes the fixed accept intent: main_review with reason+confirm,
    // and no completed state is promised.
    const completed = policy.destinations.completed;
    assert.equal(completed.disposition, "needs-input");
    assert.equal(completed.operation, "main_review");
    assert.equal(completed.intent, "accept");
    assert.deepEqual([...completed.requires!], ["reason", "confirm"]);
    assert.match(completed.explanation, /Main acceptance is required first/i);
    assert.match(completed.explanation, /preflight/i);

    // Exact review operation toward Ready: revise needs feedback and fixed intent.
    const ready = policy.destinations.ready;
    assert.equal(ready.disposition, "needs-input");
    assert.equal(ready.operation, "revise");
    assert.equal(ready.intent, "revise");
    assert.deepEqual([...ready.requires!], ["feedback"]);

    // Stopped/failed encodes the fixed reject intent.
    const stopped = policy.destinations["stopped-failed"];
    assert.equal(stopped.operation, "main_review");
    assert.equal(stopped.intent, "reject");
    assert.deepEqual([...stopped.requires!], ["reason", "confirm"]);

    // Only existing durable operations appear anywhere.
    const operations = new Set<string>();
    for (const column of ALL_COLUMNS) {
      const entry = policy.destinations[column];
      if (entry.operation !== undefined) operations.add(entry.operation);
    }
    for (const operation of operations) {
      assert.ok(
        ["resume", "correct", "revise", "main_review", "integration_preflight", "integration_apply",
          "task_resolve", "task_reopen"].includes(operation),
        operation,
      );
    }
  } finally {
    store.close();
  }
});

test("ready-for-integration exposes the exact two-step integration path for Completed", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ap-integration-"));
  const store = new StateStore(home);
  try {
    const task = taskRecord("integratable", { status: "succeeded", baseMaxAttempts: 2 });
    store.createTask(task);
    const verificationSequence = addVerification(store, task.id, true);
    addMainReview(store, task.id, "accept", verificationSequence);
    const policy = project(store, task, {
      status: "succeeded",
      decisionStage: "ready-for-integration",
      currentColumn: "waiting-user-decision",
    });

    const completed = policy.destinations.completed;
    assert.equal(completed.disposition, "requestable");
    assert.equal(completed.operation, "integration_preflight");
    assert.deepEqual([...completed.requires!], []);
    const expectedPath: readonly TaskActionPathStep[] = [
      { operation: "integration_preflight", requires: [] },
      { operation: "integration_apply", requires: ["receiptId", "confirm"] },
    ];
    assert.deepEqual(completed.path, expectedPath);
    assert.match(completed.explanation, /two-step/i);
    assert.match(completed.explanation, /preflight/i);
    assert.match(completed.explanation, /confirmed receipt/i);
    assert.match(completed.explanation, /does not directly change the column/i);

    // Never exposes a generic status patch.
    for (const column of ALL_COLUMNS) {
      assert.notEqual(policy.destinations[column].operation, "set_status");
    }
    assert.equal(policy.nextCheckpoint, "Run integration preflight, then apply with an explicit confirmed receipt.");
  } finally {
    store.close();
  }
});

test("failed/interrupted Task can be resumed toward Ready or resolved as handled", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ap-failed-"));
  const store = new StateStore(home);
  try {
    const task = taskRecord("failed", { status: "failed", baseMaxAttempts: 2 });
    store.createTask(task);
    const policy = project(store, task, {
      status: "failed",
      decisionStage: "machine-failed",
      currentColumn: "stopped-failed",
    });

    const ready = policy.destinations.ready;
    assert.equal(ready.disposition, "requestable");
    assert.equal(ready.operation, "resume");
    assert.deepEqual([...ready.requires!], []);

    const stopped = policy.destinations["stopped-failed"];
    assert.equal(stopped.disposition, "needs-input");
    assert.equal(stopped.operation, "task_resolve");
    assert.deepEqual([...stopped.requires!], ["reason", "confirm"]);

    const completed = policy.destinations.completed;
    assert.equal(completed.disposition, "no-op");
    assert.equal(completed.operation, undefined);
  } finally {
    store.close();
  }
});

test("explicitly resolved Task can only be reopened, never moved backward", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ap-resolved-"));
  const store = new StateStore(home);
  try {
    const task = taskRecord("resolved", { status: "failed" });
    store.createTask(task);
    const resolutionState: TaskResolutionState = {
      status: "resolved",
      reason: "handled-elsewhere",
      resolvedAt: "2026-08-03T13:00:00.000Z",
      eventSequence: 5,
    };
    const policy = project(store, task, {
      status: "failed",
      decisionStage: "machine-failed",
      currentColumn: "stopped-failed",
      resolutionState,
    });

    const stopped = policy.destinations["stopped-failed"];
    assert.equal(stopped.disposition, "requestable");
    assert.equal(stopped.operation, "task_reopen");
    assert.deepEqual([...stopped.requires!], ["confirm"]);

    // Ready is blocked until reopen.
    const ready = policy.destinations.ready;
    assert.equal(ready.disposition, "no-op");
    assert.equal(ready.reason, "requires-reopen-first");
    assert.equal(ready.operation, undefined);

    assert.deepEqual(requestableDestinations(policy), ["stopped-failed"]);
  } finally {
    store.close();
  }
});

test("delivered Task cannot move backward and claims no further operation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ap-delivered-"));
  const store = new StateStore(home);
  try {
    const task = taskRecord("delivered", { status: "succeeded" });
    store.createTask(task);
    const policy = project(store, task, {
      status: "succeeded",
      decisionStage: "delivered",
      delivered: true,
      currentColumn: "completed",
    });

    assert.equal(policy.destinations.completed.disposition, "no-op");
    assert.equal(policy.destinations.completed.reason, "already-delivered");

    for (const column of ALL_COLUMNS) {
      if (column === "completed") continue;
      const entry = policy.destinations[column];
      assert.equal(entry.disposition, "no-op", column);
      assert.equal(entry.reason, "delivered-backward-blocked", column);
      assert.equal(entry.operation, undefined, column);
    }
    assert.equal(policy.nextCheckpoint, "This Task is delivered; no further action is required.");
  } finally {
    store.close();
  }
});

test("unknown or contradictory evidence offers no requestable mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ap-unknown-"));
  const store = new StateStore(home);
  try {
    const task = taskRecord("unknown", { status: "succeeded" });
    store.createTask(task);
    // Plan membership blocks the revise path so succeeded-but-unverified evidence
    // cannot be turned into a request.
    const plan: PlanRecord = {
      id: "unknown-plan",
      name: "Unknown",
      objective: "No verification",
      planFile: "/tmp/u.yaml",
      createdAt: TS,
      updatedAt: TS,
    };
    store.createPlanGraph(
      plan,
      [{ id: "i", planId: plan.id, taskId: task.id, itemIndex: 0, taskFile: task.taskFile }],
      [],
    );
    const policy = project(store, task, {
      status: "succeeded",
      decisionStage: "unknown",
      currentColumn: "waiting-user-decision",
    });

    assert.deepEqual(requestableDestinations(policy), []);
    assert.equal(policy.destinations.ready.reason, "not-eligible");
    for (const column of ALL_COLUMNS) {
      assert.notEqual(policy.destinations[column].disposition, "requestable");
      assert.notEqual(policy.destinations[column].disposition, "needs-input");
    }
  } finally {
    store.close();
  }
});

test("exhausted frozen resume/revise allowance disables both requests", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ap-exhausted-"));
  const store = new StateStore(home);
  try {
    // Failed Task with baseMaxAttempts 1 and one consumed Attempt: resume disabled.
    const failed = taskRecord("exhaust-failed", { status: "failed", baseMaxAttempts: 1 });
    store.createTask(failed);
    store.createAttempt(attemptRecord(failed.id, 1, "succeeded"));
    const failedPolicy = project(store, failed, {
      status: "failed",
      decisionStage: "machine-failed",
      currentColumn: "stopped-failed",
    });
    const failedReady = failedPolicy.destinations.ready;
    assert.equal(failedReady.disposition, "no-op");
    assert.equal(failedReady.reason, "allowance-exhausted");
    assert.equal(failedReady.operation, undefined);
    assert.doesNotMatch(failedPolicy.nextCheckpoint, /Resume/);

    // Succeeded standalone Task with baseMaxAttempts 1 and one consumed Attempt:
    // revise disabled.
    const succeeded = taskRecord("exhaust-succeeded", { status: "succeeded", baseMaxAttempts: 1 });
    store.createTask(succeeded);
    store.createAttempt(attemptRecord(succeeded.id, 1, "succeeded"));
    const succeededPolicy = project(store, succeeded, {
      status: "succeeded",
      decisionStage: "machine-verified",
      currentColumn: "waiting-user-decision",
    });
    const succeededReady = succeededPolicy.destinations.ready;
    assert.equal(succeededReady.disposition, "no-op");
    assert.equal(succeededReady.reason, "allowance-exhausted");
    assert.equal(succeededReady.operation, undefined);
  } finally {
    store.close();
  }
});

test("running Attempt disables resume even when allowance remains", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ap-running-attempt-"));
  const store = new StateStore(home);
  try {
    const task = taskRecord("running-attempt", { status: "failed", baseMaxAttempts: 3 });
    store.createTask(task);
    store.createAttempt(attemptRecord(task.id, 1, "running"));
    const policy = project(store, task, {
      status: "failed",
      decisionStage: "machine-failed",
      currentColumn: "stopped-failed",
    });
    const ready = policy.destinations.ready;
    assert.equal(ready.disposition, "no-op");
    assert.equal(ready.reason, "not-eligible");
    assert.equal(ready.operation, undefined);
    assert.match(policy.nextCheckpoint, /active Attempt/);
  } finally {
    store.close();
  }
});

test("retained-Candidate correction is preferred over resume toward Ready", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ap-correct-"));
  const store = new StateStore(home);
  try {
    const task = taskRecord("correctable", { status: "failed", baseMaxAttempts: 2 });
    store.createTask(task);
    await makeCorrectionEligible(store, task);
    const policy = project(store, task, {
      status: "failed",
      decisionStage: "machine-failed",
      currentColumn: "stopped-failed",
    });

    const ready = policy.destinations.ready;
    assert.equal(ready.disposition, "needs-input");
    assert.equal(ready.operation, "correct");
    assert.deepEqual([...ready.requires!], ["feedback", "confirm"]);
    assert.equal(ready.reason, "correct-reuses-candidate");
    // resume is no longer the advertised path when correction is eligible.
    assert.notEqual(ready.operation, "resume");
  } finally {
    store.close();
  }
});
