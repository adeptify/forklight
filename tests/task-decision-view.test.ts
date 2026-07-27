import assert from "node:assert/strict";
import test from "node:test";
import { buildTaskDecisionView } from "../src/core/task-decision-view.js";
import type {
  AttemptRecord,
  EventRecord,
  IntegrationResultRecord,
  TaskRecord,
  VerificationResult,
} from "../src/core/types.js";

const now = "2026-07-24T00:00:00.000Z";

function task(status: TaskRecord["status"]): TaskRecord {
  return {
    id: "task-1",
    name: "Decision fixture",
    status,
    sourcePath: "/source",
    taskFile: "/task.yaml",
    spec: {
      version: 1,
      name: "Decision fixture",
      project: "/source",
      provider: {
        name: "deepseek",
        model: "deepseek-v4-pro",
        keychainService: "forklight.test",
      },
      runtime: {
        name: "claude-code",
        executable: "claude",
        effort: "high",
        maxBudgetUsd: null,
      },
      workspace: { exclude: [] },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
      goal: "Test projection",
      constraints: [],
      acceptance: { commands: ["true"] },
    },
    paths: {
      root: "/state/task",
      baseline: "/state/task/baseline",
      workspace: "/state/task/workspace",
      logs: "/state/task/logs",
      claudeConfig: "/state/task/claude",
      diff: "/state/task/diff.patch",
    },
    sessionId: "session-1",
    currentAttemptId: "attempt-1",
    createdAt: now,
    updatedAt: now,
  };
}

const attempt: AttemptRecord = {
  id: "attempt-1",
  taskId: "task-1",
  ordinal: 1,
  status: "succeeded",
  sessionId: "session-1",
  rawLogPath: "/log",
  startedAt: now,
  finishedAt: now,
  exitCode: 0,
};

const verification = (passed: boolean): VerificationResult => ({
  passed,
  behaviorPassed: passed,
  policyPassed: true,
  sourceCompatible: true,
  commands: [{
    command: "true",
    exitCode: passed ? 0 : 1,
    stdout: "",
    stderr: "",
    durationMs: 1,
    timedOut: false,
  }],
  diffPath: "/diff",
  sourceUnchanged: true,
});

function event(
  sequence: number,
  type: EventRecord["type"],
  payload?: unknown,
): EventRecord {
  return {
    id: sequence,
    taskId: "task-1",
    attemptId: "attempt-1",
    sequence,
    timestamp: now,
    type,
    summary: type,
    ...(payload === undefined ? {} : { payload }),
  };
}

test("decision authority matrix keeps Worker success text unverified", () => {
  const claim = event(1, "worker.completed", {
    claim: { label: "unverified-claim", text: "All tests pass" },
  });
  const cases: Array<{
    name: string;
    task: TaskRecord;
    events: EventRecord[];
    results?: IntegrationResultRecord[];
    stage: string;
    nextAction: string;
  }> = [
    {
      name: "worker claim only",
      task: task("running"),
      events: [claim],
      stage: "worker-running",
      nextAction: "Wait for independent verification",
    },
    {
      name: "verification failed",
      task: task("failed"),
      events: [claim, event(2, "verification.completed", verification(false))],
      stage: "machine-failed",
      nextAction: "Review remediation and decide whether to resume",
    },
    {
      name: "verification passed no review",
      task: task("succeeded"),
      events: [claim, event(2, "verification.completed", verification(true))],
      stage: "awaiting-main-review",
      nextAction: "Main agent must review",
    },
    {
      name: "review accepted",
      task: task("succeeded"),
      events: [
        claim,
        event(2, "verification.completed", verification(true)),
        event(3, "main-review.completed", {
          decision: "accept",
          reason: "Verified",
          attemptId: "attempt-1",
          verificationEventSequence: 2,
        }),
      ],
      stage: "ready-for-integration",
      nextAction: "User may authorize Integration",
    },
    {
      name: "source applied no activation",
      task: task("succeeded"),
      events: [
        claim,
        event(4, "integration.operation.started", {
          operationId: "operation-1",
          taskId: "task-1",
          receiptId: "receipt-1",
        }),
      ],
      results: [{
        id: "operation-1",
        taskId: "task-1",
        receiptId: "receipt-1",
        status: "applied",
        stages: [
          { stage: "source-applied", status: "passed" },
          { stage: "runtime-activated", status: "not-applicable" },
        ],
        createdAt: now,
      }],
      stage: "applied-not-activated",
      nextAction: "Run or verify activation",
    },
    {
      name: "activation passed",
      task: task("succeeded"),
      events: [
        claim,
        event(4, "integration.operation.started", {
          operationId: "operation-2",
          taskId: "task-1",
          receiptId: "receipt-2",
        }),
      ],
      results: [{
        id: "operation-2",
        taskId: "task-1",
        receiptId: "receipt-2",
        status: "applied",
        stages: [{ stage: "runtime-activated", status: "passed" }],
        createdAt: now,
      }],
      stage: "activated",
      nextAction: "Delivery is active",
    },
  ];

  for (const fixture of cases) {
    const view = buildTaskDecisionView({
      task: fixture.task,
      attempts: [attempt],
      events: fixture.events,
      integrationResults: fixture.results ?? [],
    });
    assert.equal(view.stage, fixture.stage, fixture.name);
    assert.equal(view.nextAction, fixture.nextAction, fixture.name);
    assert.equal(view.workerClaim?.label, "unverified-claim", fixture.name);
    assert.equal(view.workerClaim?.text, "All tests pass", fixture.name);
  }
});

test("Worker claim is a bounded preview while deep audit retains the original event", () => {
  const original = `Delivered result\n${"evidence ".repeat(100)}TAIL-MARKER`;
  const claim = event(1, "worker.completed", {
    claim: { label: "unverified-claim", text: original },
  });
  const view = buildTaskDecisionView({
    task: task("running"),
    attempts: [attempt],
    events: [claim],
    integrationResults: [],
  });

  assert.ok(view.workerClaim);
  assert.ok(view.workerClaim.text.length <= 360);
  assert.match(view.workerClaim.text, /\[Truncated; use deep inspect/);
  assert.doesNotMatch(view.workerClaim.text, /TAIL-MARKER/);
  assert.equal((claim.payload as { claim: { text: string } }).claim.text, original);
});

test("a newer running Integration is never completed by an older result", () => {
  const events = [
    event(1, "integration.operation.started", {
      operationId: "operation-old",
      taskId: "task-1",
      receiptId: "receipt-old",
    }),
    event(2, "integration.stage.completed", {
      operationId: "operation-old",
      receiptId: "receipt-old",
      evidence: { stage: "runtime-activated", status: "passed" },
    }),
    event(3, "integration.operation.started", {
      operationId: "operation-new",
      taskId: "task-1",
      receiptId: "receipt-new",
    }),
  ];
  const view = buildTaskDecisionView({
    task: task("succeeded"),
    attempts: [attempt],
    events,
    integrationResults: [{
      id: "operation-old",
      taskId: "task-1",
      receiptId: "receipt-old",
      status: "applied",
      stages: [{ stage: "runtime-activated", status: "passed" }],
      createdAt: now,
    }],
  });
  assert.equal(view.integration?.operationId, "operation-new");
  assert.equal(view.integration?.result, undefined);
  assert.equal(view.stage, "integrating");
});

test("a started operation with no receipt and an older unrelated result returns no integration view", () => {
  const events = [
    event(1, "integration.operation.started", {
      operationId: "operation-no-receipt",
      taskId: "task-1",
      // intentionally no receiptId
    }),
  ];
  const view = buildTaskDecisionView({
    task: task("succeeded"),
    attempts: [attempt],
    events,
    integrationResults: [{
      id: "operation-old",
      taskId: "task-1",
      receiptId: "receipt-old",
      status: "applied",
      stages: [],
      createdAt: now,
    }],
  });
  assert.equal(view.integration, undefined);
});

test("a review of an older verification never governs a newer Attempt", () => {
  const events = [
    event(1, "verification.completed", verification(true)),
    event(2, "main-review.completed", {
      decision: "revise",
      reason: "Correct the first Attempt",
      attemptId: "attempt-1",
      verificationEventSequence: 1,
    }),
    {
      ...event(3, "verification.completed", verification(true)),
      attemptId: "attempt-2",
    },
  ];
  const view = buildTaskDecisionView({
    task: task("succeeded"),
    attempts: [
      attempt,
      { ...attempt, id: "attempt-2", ordinal: 2 },
    ],
    events,
    integrationResults: [],
  });
  assert.equal(view.mainReview, undefined);
  assert.equal(view.stage, "awaiting-main-review");
  assert.equal(view.nextAction, "Main agent must review");
});

// --- Decision View progress uses latest-event activity (FL-D83) ---

test("Decision View progress is active for a recent event even when updatedAt is frozen (FL-D83)", () => {
  const frozenUpdatedAt = "2026-07-24T00:00:00.000Z";
  const recentEventAt = "2026-07-24T00:05:00.000Z";
  const running = {
    ...task("running"),
    updatedAt: frozenUpdatedAt,
  };
  const events: EventRecord[] = [{
    id: 1,
    taskId: "task-1",
    attemptId: "attempt-1",
    sequence: 9,
    timestamp: recentEventAt,
    type: "worker.tool.completed",
    summary: "edited src/cli.ts",
  }];
  const view = buildTaskDecisionView({
    task: running,
    attempts: [attempt],
    events,
    integrationResults: [],
    nowMs: Date.parse("2026-07-24T00:05:10.000Z"),
    quietAfterMs: 30_000,
  });
  assert.equal(view.progress.activity, "active");
  assert.equal(view.progress.latestEventSequence, 9);
  assert.equal(view.progress.lastEventAt, recentEventAt);
  assert.equal(view.progress.latestAction, "edited src/cli.ts");
  assert.equal(running.updatedAt, frozenUpdatedAt);
});

test("Decision View progress becomes quiet when the last event is stale (FL-D83)", () => {
  const events: EventRecord[] = [{
    id: 1,
    taskId: "task-1",
    attemptId: "attempt-1",
    sequence: 2,
    timestamp: "2026-07-24T00:00:00.000Z",
    type: "worker.message",
    summary: "thinking",
  }];
  const view = buildTaskDecisionView({
    task: task("running"),
    attempts: [attempt],
    events,
    integrationResults: [],
    nowMs: Date.parse("2026-07-24T00:05:00.000Z"),
    quietAfterMs: 30_000,
  });
  assert.equal(view.progress.activity, "quiet");
  assert.equal(view.progress.lastEventAt, "2026-07-24T00:00:00.000Z");
  assert.equal(view.progress.latestEventSequence, 2);
});

test("Decision View progress is terminal for finished tasks (FL-D83)", () => {
  const events: EventRecord[] = [event(1, "verification.completed", verification(true))];
  const view = buildTaskDecisionView({
    task: task("succeeded"),
    attempts: [attempt],
    events,
    integrationResults: [],
    nowMs: Date.parse(now),
  });
  assert.equal(view.progress.activity, "terminal");
});

test("Decision View exposes a readable preparation cursor only while preparing", () => {
  const stage = event(1, "workspace.preparation.stage", {
    stage: "source-scan",
    phase: "complete",
    elapsedMs: 362_000,
    countKind: "files",
    count: 306,
  });
  const preparing = buildTaskDecisionView({
    task: task("preparing"),
    attempts: [],
    events: [stage],
    integrationResults: [],
    nowMs: Date.parse(now),
  });
  assert.deepEqual(preparing.progress.preparationStage, {
    stage: "source-scan",
    phase: "complete",
    elapsedMs: 362_000,
    countKind: "files",
    count: 306,
  });

  const running = buildTaskDecisionView({
    task: task("running"),
    attempts: [attempt],
    events: [stage],
    integrationResults: [],
    nowMs: Date.parse(now),
  });
  assert.equal(running.progress.preparationStage, undefined,
    "completed preparation must not become stale live status");
});
