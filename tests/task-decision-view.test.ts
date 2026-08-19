import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { buildTaskDecisionView } from "../src/core/task-decision-view.js";
import { resolveHandoffViewForTask } from "../src/core/candidate-handoff.js";
import { buildMainDecisionPacket, buildMainDecisionPacketForTask } from "../src/core/main-decision-packet.js";
import { CANDIDATE_HANDOFF_CORRUPTION_ERROR, StateStore } from "../src/state/store.js";
import {
  PENDING_REVIEW_BLOCKS_INTEGRATION,
  REQUIRED_REVIEW_GRAPH_MISSING,
  STALE_MAIN_ACCEPT_AFTER_REVIEW,
} from "../src/core/review-graph.js";
import type {
  AttemptRecord,
  EventRecord,
  IntegrationResultRecord,
  TaskRecord,
  VerificationResult,
} from "../src/core/types.js";

const REPAIR_DIGEST = "a".repeat(64);

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
      name: "source delivery complete when activation is not applicable",
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
      stage: "delivered",
      nextAction: "Delivery is complete; runtime activation was not required",
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
  assert.equal(view.progress.liveStage?.observation, "quiet");
  assert.equal(view.progress.liveStage?.stage, "legacy-running");
  assert.equal(view.progress.liveStage?.meaning, "normal");
});

test("Decision View liveStage follows tool open/close and verification precedence", () => {
  const running = task("running");
  const openTool = buildTaskDecisionView({
    task: running,
    attempts: [attempt],
    events: [
      event(1, "worker.started"),
      event(2, "worker.message", { activityKind: "model-response" }),
      event(3, "worker.tool.started", { toolUseId: "tool-9", tool: "Edit" }),
    ],
    integrationResults: [],
    nowMs: Date.parse(now) + 1_000,
  });
  assert.equal(openTool.progress.liveStage?.stage, "using-tool");
  assert.equal(openTool.progress.liveStage?.next, "wait-for-tool-result");

  const closedTool = buildTaskDecisionView({
    task: running,
    attempts: [attempt],
    events: [
      event(1, "worker.started"),
      event(2, "worker.tool.started", { toolUseId: "tool-9", tool: "Edit" }),
      event(3, "worker.tool.completed", { toolUseId: "tool-9", tool: "Edit" }),
    ],
    integrationResults: [],
    nowMs: Date.parse(now) + 1_000,
  });
  assert.equal(closedTool.progress.liveStage?.stage, "waiting-for-model");

  const verifying = buildTaskDecisionView({
    task: task("verifying"),
    attempts: [attempt],
    events: [
      event(1, "worker.completed"),
      event(2, "verification.started"),
    ],
    integrationResults: [],
    nowMs: Date.parse(now) + 1_000,
  });
  assert.equal(verifying.progress.liveStage?.stage, "verifying");
  assert.equal(verifying.progress.liveStage?.evidence, "verification");
});

test("Decision View liveStage distinguishes model-processing from model-responding", () => {
  const running = task("running");
  // Processing marker projects model-processing, not model-responding or waiting.
  const processing = buildTaskDecisionView({
    task: running,
    attempts: [attempt],
    events: [
      event(1, "worker.started"),
      event(2, "worker.message", { activityKind: "model-processing" }),
    ],
    integrationResults: [],
    nowMs: Date.parse(now) + 1_000,
  });
  assert.equal(processing.progress.liveStage?.stage, "model-processing");
  assert.equal(processing.progress.liveStage?.evidence, "model-activity");
  assert.equal(processing.progress.liveStage?.meaning, "normal");
  assert.equal(processing.progress.liveStage?.next, "wait-for-next-model-step");

  // Subsequent model-response transitions from processing to responding.
  const responding = buildTaskDecisionView({
    task: running,
    attempts: [attempt],
    events: [
      event(1, "worker.started"),
      event(2, "worker.message", { activityKind: "model-processing" }),
      event(3, "worker.message", { activityKind: "model-response" }),
    ],
    integrationResults: [],
    nowMs: Date.parse(now) + 1_000,
  });
  assert.equal(responding.progress.liveStage?.stage, "model-responding");

  // Tool opened during processing stays using-tool.
  const toolDuringProcessing = buildTaskDecisionView({
    task: running,
    attempts: [attempt],
    events: [
      event(1, "worker.started"),
      event(2, "worker.message", { activityKind: "model-processing" }),
      event(3, "worker.tool.started", { toolUseId: "t1", tool: "Edit" }),
      event(4, "worker.message", { activityKind: "model-processing" }),
    ],
    integrationResults: [],
    nowMs: Date.parse(now) + 1_000,
  });
  assert.equal(toolDuringProcessing.progress.liveStage?.stage, "using-tool");
  assert.notEqual(toolDuringProcessing.progress.liveStage?.stage, "model-processing");
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

// --- Content-free validation-repair projection (FL-109) ---

function taskWithRepairPolicy(
  status: TaskRecord["status"],
  maxWorkerValidationRepairs: number,
  source: "global" | "worker" | "task",
): TaskRecord {
  return {
    ...task(status),
    effectivePolicy: {
      profileId: source === "global" ? "global" : "profile-a",
      values: {
        maxWorkerValidationRepairs,
      },
      provenance: {
        maxWorkerValidationRepairs: source,
      },
      enforcementCapability: {
        durationEnforcement: "preemptive",
        tokenEnforcement: "unsupported",
        progressWatchdog: "terminal",
      },
    } as unknown as NonNullable<TaskRecord["effectivePolicy"]>,
  };
}

function repairWorkerIdentity(taskRecord: TaskRecord): Record<string, string> {
  return {
    provider: taskRecord.spec.provider.name,
    model: taskRecord.spec.provider.model,
    runtime: taskRecord.spec.runtime.name,
    effort: taskRecord.spec.runtime.effort,
  };
}

function repairPayload(taskRecord: TaskRecord, round: number): Record<string, unknown> {
  return {
    kind: "worker-validation-repair",
    schemaVersion: 1,
    taskId: taskRecord.id,
    round,
    attemptId: `repair-attempt-${round}`,
    targetAttemptOrdinal: round + 1,
    priorAttemptId: "attempt-1",
    verificationEventSequence: 4,
    candidateRevisionId: `revision-${round}`,
    evidenceFingerprint: REPAIR_DIGEST,
    workerIdentity: repairWorkerIdentity(taskRecord),
    feedback: "repair the failing behavior",
  };
}

function repairEvent(
  sequence: number,
  type: EventRecord["type"],
  taskRecord: TaskRecord,
  payload: Record<string, unknown>,
): EventRecord {
  const phase = type === "worker.validation-repair.authorized" ? "authorized" : "started";
  const attemptId = phase === "authorized"
    ? String(payload.priorAttemptId)
    : String(payload.attemptId);
  return {
    id: sequence,
    taskId: taskRecord.id,
    attemptId,
    sequence,
    timestamp: now,
    type,
    summary: type,
    payload,
  };
}

test("Decision View projects an in-progress same-Worker repair round from durable events", () => {
  const running = taskWithRepairPolicy("running", 1, "worker");
  const events: EventRecord[] = [
    repairEvent(5, "worker.validation-repair.authorized", running, repairPayload(running, 1)),
    repairEvent(6, "worker.validation-repair.started", running, {
      ...repairPayload(running, 1),
      authorizationEventSequence: 5,
    }),
  ];
  const view = buildTaskDecisionView({
    task: running,
    attempts: [attempt],
    events,
    integrationResults: [],
  });
  assert.ok(view.validationRepair);
  assert.equal(view.validationRepair.enabled, true);
  assert.equal(view.validationRepair.inProgress, true);
  // The active round already occupies the allowance (consumed counts every
  // durable round, including the one in progress).
  assert.deepEqual(view.validationRepair.allowance, {
    max: 1,
    consumed: 1,
    remaining: 0,
    source: "worker",
  });
  assert.equal(view.validationRepair.rounds.length, 1);
  assert.equal(view.validationRepair.rounds[0]?.round, 1);
  assert.equal(view.validationRepair.rounds[0]?.state, "started");
});

test("Decision View projects an exhausted allowance and its stop reason", () => {
  const failed = taskWithRepairPolicy("failed", 1, "global");
  const payload = repairPayload(failed, 1);
  const events: EventRecord[] = [
    repairEvent(5, "worker.validation-repair.authorized", failed, payload),
    repairEvent(6, "worker.validation-repair.started", failed, {
      ...payload,
      authorizationEventSequence: 5,
    }),
    repairEvent(7, "worker.validation-repair.completed", failed, {
      ...payload,
      authorizationEventSequence: 5,
      outcome: "failed",
      reason: "allowance-exhausted",
    }),
  ];
  const view = buildTaskDecisionView({
    task: failed,
    attempts: [attempt],
    events,
    integrationResults: [],
  });
  assert.ok(view.validationRepair);
  assert.equal(view.validationRepair.inProgress, false);
  assert.equal(view.validationRepair.allowance.consumed, 1);
  assert.equal(view.validationRepair.allowance.remaining, 0);
  assert.equal(view.validationRepair.stopReason, "allowance-exhausted");
  assert.equal(view.validationRepair.rounds[0]?.terminalOutcome, "failed");
});

test("Decision View reports a durable non-repairable skip without consuming a round", () => {
  const failed = taskWithRepairPolicy("failed", 1, "worker");
  const events: EventRecord[] = [
    event(3, "worker.validation-repair.skipped", {
      reason: "verification-infrastructure",
      nextAction: "Main receives the bounded evidence and decides.",
    }),
  ];
  const view = buildTaskDecisionView({
    task: failed,
    attempts: [attempt],
    events,
    integrationResults: [],
  });
  assert.ok(view.validationRepair);
  assert.equal(view.validationRepair.inProgress, false);
  assert.equal(view.validationRepair.rounds.length, 0);
  assert.equal(view.validationRepair.allowance.consumed, 0);
  assert.equal(view.validationRepair.skipped.length, 1);
  assert.equal(view.validationRepair.skipped[0]?.reason, "verification-infrastructure");
  assert.ok(view.validationRepair.skipped[0]?.nextAction);
});

test("Decision View omits the validation-repair projection when lineage is corrupt", () => {
  const running = taskWithRepairPolicy("running", 1, "worker");
  const events: EventRecord[] = [
    repairEvent(5, "worker.validation-repair.authorized", running, repairPayload(running, 1)),
    // A second authorization for the same round breaks the one-per-round rule.
    repairEvent(6, "worker.validation-repair.authorized", running, repairPayload(running, 1)),
  ];
  const view = buildTaskDecisionView({
    task: running,
    attempts: [attempt],
    events,
    integrationResults: [],
  });
  assert.equal(view.validationRepair, undefined);
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

// --- M2-B Main decision packet ---

test("packet names missing review for requiredJudges 1 without creating a Judge", () => {
  const recorded = task("succeeded");
  recorded.spec.reviewRequirement = {
    requiredJudges: 1,
    reason: "Ordinary meaningful delivery",
  };
  const events = [
    event(1, "worker.completed", { claim: { label: "unverified-claim", text: "All tests pass" } }),
    event(2, "verification.completed", verification(true)),
  ];
  const decision = buildTaskDecisionView({
    task: recorded,
    attempts: [attempt],
    events,
    integrationResults: [],
  });
  const packet = buildMainDecisionPacket({
    task: recorded,
    decision,
    events,
    reviewGate: {
      declared: true,
      status: "missing",
      requiredJudges: 1,
      reason: "Ordinary meaningful delivery",
      assigned: 0,
      terminal: 0,
      usableTerminal: 0,
      missingOpinions: 1,
      blocksIntegration: true,
      rejectionReasons: [REQUIRED_REVIEW_GRAPH_MISSING],
    },
  });
  assert.equal(packet.kind, "main-decision-packet");
  assert.equal(packet.workerClaim.label, "unverified-claim");
  assert.equal(packet.review.status, "missing");
  assert.equal(packet.review.missingOpinions, 1);
  assert.equal(packet.nextActionCode, "await-required-review");
  assert.match(packet.nextAction, /1 missing independent opinion/);
  assert.ok(packet.blockers.includes(REQUIRED_REVIEW_GRAPH_MISSING));
  assert.doesNotMatch(JSON.stringify(packet), /All tests pass|\/diff|stdout/);
});

test("packet shows one missing independent opinion when requiredJudges is 2", () => {
  const recorded = task("succeeded");
  recorded.spec.reviewRequirement = {
    requiredJudges: 2,
    reason: "High-risk Integration authority",
  };
  const events = [event(2, "verification.completed", verification(true))];
  const decision = buildTaskDecisionView({
    task: recorded,
    attempts: [attempt],
    events,
    integrationResults: [],
  });
  const packet = buildMainDecisionPacket({
    task: recorded,
    decision,
    events,
    reviewGate: {
      declared: true,
      status: "undersized",
      requiredJudges: 2,
      reason: "High-risk Integration authority",
      assigned: 1,
      terminal: 1,
      usableTerminal: 1,
      missingOpinions: 1,
      blocksIntegration: true,
      rejectionReasons: ["Required Review Graph is undersized: fewer independent assignments than requiredJudges"],
    },
    reviewGraph: {
      schemaVersion: 1,
      id: "graph-1",
      candidateTaskId: recorded.id,
      candidateRevisionId: "rev-1",
      attemptOrdinal: 1,
      verificationEventSequence: 2,
      digestPrefix: "abc",
      status: "completed",
      round: 1,
      maxAssignments: 1,
      assignments: [],
      aggregation: {
        total: 1,
        pending: 0,
        usable: 1,
        unusable: 0,
        dispositionCounts: { accept: 1, revise: 0, reject: 0 },
        state: "single-opinion",
        explanation: "One usable judge suggested accept.",
      },
      createdAt: now,
      updatedAt: now,
      blocksIntegration: false,
      requiresFreshMainReview: false,
      nextAction: "unused",
      nextActionCode: "main-decision",
    },
  });
  assert.equal(packet.review.missingOpinions, 1);
  assert.equal(packet.review.aggregationState, "single-opinion");
  assert.equal(packet.nextActionCode, "await-required-review");
  assert.match(packet.nextAction, /1 missing independent opinion/);
});

test("explicit skip and legacy packets do not invent review policy", () => {
  const skipTask = task("succeeded");
  skipTask.spec.reviewRequirement = {
    requiredJudges: 0,
    reason: "Mechanical deterministic check",
  };
  const events = [event(2, "verification.completed", verification(true))];
  const skipDecision = buildTaskDecisionView({
    task: skipTask,
    attempts: [attempt],
    events,
    integrationResults: [],
  });
  const skipPacket = buildMainDecisionPacket({ task: skipTask, decision: skipDecision, events });
  assert.equal(skipPacket.review.status, "explicit-skip");
  assert.equal(skipPacket.review.requiredJudges, 0);
  assert.equal(skipPacket.nextActionCode, "record-main-review");
  assert.match(skipPacket.nextAction, /explicit Judge skip/);
  assert.match(skipPacket.nextAction, /no Judge was assigned/);
  assert.doesNotMatch(skipPacket.nextAction, /independent Judge/);

  const legacy = task("succeeded");
  const legacyDecision = buildTaskDecisionView({
    task: legacy,
    attempts: [attempt],
    events,
    integrationResults: [],
  });
  const legacyPacket = buildMainDecisionPacket({ task: legacy, decision: legacyDecision, events });
  assert.equal(legacyPacket.review.declared, false);
  assert.equal(legacyPacket.review.status, "not-declared");
  assert.equal(legacyPacket.review.requiredJudges, undefined);
  assert.equal(legacyPacket.nextActionCode, "record-main-review");
  assert.equal(legacyPacket.blockers.length, 0);
});

test("legacy and explicit-skip packets honor existing Review Graph blockers", () => {
  const events = [
    event(2, "verification.completed", verification(true)),
    event(3, "main-review.completed", {
      decision: "accept",
      reason: "before review finished",
      attemptId: "attempt-1",
      verificationEventSequence: 2,
    }),
  ];

  for (const kind of ["legacy", "explicit-skip"] as const) {
    const recorded = task("succeeded");
    if (kind === "explicit-skip") {
      recorded.spec.reviewRequirement = {
        requiredJudges: 0,
        reason: "Mechanical deterministic check",
      };
    }
    const decision = buildTaskDecisionView({
      task: recorded,
      attempts: [attempt],
      events,
      integrationResults: [],
    });
    assert.equal(decision.stage, "ready-for-integration");

    const pendingPacket = buildMainDecisionPacket({
      task: recorded,
      decision,
      events,
      reviewGate: {
        declared: kind === "explicit-skip",
        status: "pending",
        ...(kind === "explicit-skip"
          ? { requiredJudges: 0 as const, reason: "Mechanical deterministic check" }
          : {}),
        assigned: 1,
        terminal: 0,
        usableTerminal: 0,
        missingOpinions: 0,
        blocksIntegration: true,
        rejectionReasons: [PENDING_REVIEW_BLOCKS_INTEGRATION],
      },
    });
    assert.equal(pendingPacket.nextActionCode, "wait-for-judges");
    assert.ok(pendingPacket.blockers.includes(PENDING_REVIEW_BLOCKS_INTEGRATION));
    assert.notEqual(pendingPacket.nextActionCode, "ready-for-integration");

    const staleMainPacket = buildMainDecisionPacket({
      task: recorded,
      decision,
      events,
      reviewGate: {
        declared: kind === "explicit-skip",
        status: "stale-main-accept",
        ...(kind === "explicit-skip"
          ? { requiredJudges: 0 as const, reason: "Mechanical deterministic check" }
          : {}),
        assigned: 1,
        terminal: 1,
        usableTerminal: 1,
        missingOpinions: 0,
        blocksIntegration: true,
        rejectionReasons: [STALE_MAIN_ACCEPT_AFTER_REVIEW],
      },
    });
    assert.equal(staleMainPacket.nextActionCode, "record-fresh-main-review");
    assert.ok(staleMainPacket.blockers.includes(STALE_MAIN_ACCEPT_AFTER_REVIEW));
    assert.notEqual(staleMainPacket.nextActionCode, "ready-for-integration");

    // Defensive: even if status still looks like skip/legacy, rejection reasons win.
    const reasonOnlyPacket = buildMainDecisionPacket({
      task: recorded,
      decision,
      events,
      reviewGate: {
        declared: kind === "explicit-skip",
        status: kind === "explicit-skip" ? "explicit-skip" : "not-declared",
        ...(kind === "explicit-skip"
          ? { requiredJudges: 0 as const, reason: "Mechanical deterministic check" }
          : {}),
        assigned: 1,
        terminal: 0,
        usableTerminal: 0,
        missingOpinions: 0,
        blocksIntegration: true,
        rejectionReasons: [PENDING_REVIEW_BLOCKS_INTEGRATION],
      },
    });
    assert.equal(reasonOnlyPacket.nextActionCode, "wait-for-judges");
    assert.notEqual(reasonOnlyPacket.nextActionCode, "ready-for-integration");
  }
});

test("partial result packet preserves output and recommends one handoff or stop", () => {
  const failed = task("failed");
  const events = [event(2, "verification.completed", verification(false))];
  const decision = buildTaskDecisionView({
    task: failed,
    attempts: [attempt],
    events,
    integrationResults: [],
  });
  const packet = buildMainDecisionPacket({
    task: failed,
    decision,
    events,
    candidateRevision: {
      id: "rev-partial",
      attemptOrdinal: 1,
      digestPrefix: "deadbeef0001",
      affectedPathCount: 2,
      affectedPaths: ["src/a.ts", "src/b.ts"],
      filesChanged: 2,
      changedLines: 40,
      verificationPassed: false,
    },
    handoff: {
      id: "handoff-1",
      status: "authorized",
      originKind: "goal-task",
      sourceTaskId: failed.id,
      sourceCandidateRevisionId: "rev-partial",
      sourceDigestPrefix: "deadbeef0001",
      gapContractDigestPrefix: "cafebabe0001",
      reusablePathCount: 1,
      remainingGapCount: 1,
      reusablePaths: ["src/a.ts"],
      remainingGaps: [{
        description: "Finish the remaining acceptance gap",
        acceptanceExpectation: "Independent verification must pass",
      }],
      destinationWorkerProfileId: "other",
      destinationIdentity: {
        provider: "deepseek",
        model: "deepseek-v4-pro",
        runtime: "claude-code",
        effort: "high",
      },
      successorTaskId: "successor-1",
      reason: "Reuse verified paths",
      createdAt: now,
      updatedAt: now,
      nextAction: "wait-for-successor",
    },
  });
  assert.equal(packet.candidate?.filesChanged, 2);
  assert.equal(packet.reuse?.reusablePathCount, 1);
  assert.equal(packet.reuse?.remainingGapCount, 1);
  assert.equal(packet.nextActionCode, "handoff-or-stop");
  assert.equal(packet.workspaceDisposition, "protect-reusable-partial");
  assert.doesNotMatch(JSON.stringify(packet), /\/state\/task|PRIVATE|sk-[A-Za-z0-9_-]{8,}/);
});

test("repeated no-progress packet names the stop and one Main decision", () => {
  const failed = task("failed");
  const events = [
    event(2, "verification.completed", verification(false)),
    event(3, "policy.noprogress.exceeded"),
    event(4, "policy.noprogress.exceeded"),
  ];
  const decision = buildTaskDecisionView({
    task: failed,
    attempts: [attempt],
    events,
    integrationResults: [],
  });
  const packet = buildMainDecisionPacket({
    task: failed,
    decision,
    events,
    candidateRevision: {
      id: "rev-stop",
      attemptOrdinal: 1,
      digestPrefix: "aaaaaaaaaaaa",
      affectedPathCount: 1,
      affectedPaths: ["src/a.ts"],
      filesChanged: 1,
      changedLines: 8,
      verificationPassed: false,
    },
  });
  assert.equal(packet.stop.code, "no-progress");
  assert.equal(packet.nextActionCode, "handoff-or-stop");
  assert.equal(packet.attempts.count, 1);
});

test("decision packet reads authentic Competition handoff and keeps current origins exact", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-decision-legacy-handoff-"));
  const store = new StateStore(home);
  try {
    const stamp = "2026-08-14T00:00:00.000Z";
    const make = (id: string, status: TaskRecord["status"]): TaskRecord => ({
      ...task(status),
      id,
      name: id,
      taskFile: `/${id}.yaml`,
      sessionId: `session-${id}`,
    });
    const legacySource = make("legacy-src", "failed");
    const legacySuccessor = make("legacy-succ", "queued");
    const goalSource = make("goal-src", "failed");
    const goalSuccessor = make("goal-succ", "queued");
    const currentCompSource = make("comp-src", "failed");
    const currentCompSuccessor = make("comp-succ", "queued");
    for (const record of [legacySource, legacySuccessor, goalSource, currentCompSource]) {
      store.createTask(record);
    }

    const shared = {
      schemaVersion: 1 as const,
      status: "prepared" as const,
      sourcePatchDigest: "a".repeat(64),
      gapContractDigest: "b".repeat(64),
      reusablePathCount: 1,
      remainingGapCount: 1,
      reusablePaths: ["src/a.ts"],
      remainingGaps: [{
        description: "Finish the remaining acceptance gap",
        acceptanceExpectation: "Independent verification must pass",
      }],
      destinationWorkerProfileId: "other",
      destinationIdentity: {
        provider: "deepseek" as const,
        model: "deepseek-v4-pro",
        runtime: "claude-code" as const,
        effort: "high" as const,
      },
      reason: "Reuse verified paths",
      createdAt: stamp,
      updatedAt: stamp,
      preparedAt: stamp,
      nextAction: "wait-for-successor" as const,
    };
    store.createCandidateHandoff({
      record: {
        ...shared,
        id: "goal-handoff",
        origin: { kind: "goal-task", goalId: "goal-1", itemId: "item-1" },
        sourceTaskId: goalSource.id,
        sourceCandidateRevisionId: "rev-goal",
        successorTaskId: goalSuccessor.id,
      },
      task: goalSuccessor,
      authorizationEvent: { summary: "goal handoff" },
    });
    store.createCandidateHandoff({
      record: {
        ...shared,
        id: "comp-handoff",
        origin: { kind: "competition", competitionId: "comp-current", sourceCandidateId: "cand-current" },
        sourceTaskId: currentCompSource.id,
        sourceCandidateRevisionId: "rev-comp",
        successorTaskId: currentCompSuccessor.id,
      },
      task: currentCompSuccessor,
      authorizationEvent: { summary: "competition handoff" },
    });

    const legacyJson = JSON.stringify({
      ...shared,
      id: "legacy-handoff",
      competitionId: "comp-legacy",
      sourceCandidateId: "cand-legacy",
      sourceTaskId: legacySource.id,
      sourceCandidateRevisionId: "rev-legacy",
      successorTaskId: legacySuccessor.id,
    });
    const raw = new DatabaseSync(store.databasePath);
    try {
      raw.prepare(
        `INSERT INTO candidate_handoffs
         (id, source_revision_id, source_task_id, successor_task_id, competition_id,
          status, record_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "legacy-handoff",
        "rev-legacy",
        legacySource.id,
        legacySuccessor.id,
        "comp-legacy",
        "prepared",
        legacyJson,
        stamp,
        stamp,
      );
    } finally {
      raw.close();
    }

    const eventsBefore = [
      legacySource.id,
      legacySuccessor.id,
      goalSource.id,
      currentCompSource.id,
    ].reduce((sum, id) => sum + store.listEvents(id).length, 0);

    const legacyView = resolveHandoffViewForTask(store, legacySource.id);
    const successorView = resolveHandoffViewForTask(store, legacySuccessor.id);
    const goalView = resolveHandoffViewForTask(store, goalSource.id);
    const currentCompView = resolveHandoffViewForTask(store, currentCompSource.id);
    const legacyPacket = buildMainDecisionPacketForTask(store, legacySource.id);
    const successorPacket = buildMainDecisionPacketForTask(store, legacySuccessor.id);
    const goalPacket = buildMainDecisionPacketForTask(store, goalSource.id);
    const currentCompPacket = buildMainDecisionPacketForTask(store, currentCompSource.id);

    assert.equal(legacyView?.originKind, "competition");
    assert.equal(legacyView?.competitionId, "comp-legacy");
    assert.equal(legacyView?.sourceCandidateId, "cand-legacy");
    assert.equal(legacyView?.goalId, undefined);
    assert.equal(successorView?.originKind, "competition");
    assert.equal(successorView?.isSuccessor, true);
    assert.equal(goalView?.originKind, "goal-task");
    assert.equal(goalView?.goalId, "goal-1");
    assert.equal(goalView?.itemId, "item-1");
    assert.equal(goalView?.competitionId, undefined);
    assert.equal(currentCompView?.originKind, "competition");
    assert.equal(currentCompView?.competitionId, "comp-current");
    assert.equal(currentCompView?.goalId, undefined);
    assert.equal(legacyPacket.reuse?.handoffStatus, "prepared");
    assert.equal(legacyPacket.reuse?.reusablePathCount, 1);
    assert.equal(successorPacket.reuse?.handoffStatus, "prepared");
    assert.equal(goalPacket.reuse?.handoffStatus, "prepared");
    assert.equal(currentCompPacket.reuse?.handoffStatus, "prepared");
    assert.doesNotMatch(JSON.stringify(legacyPacket), /SECRET|sk-[A-Za-z0-9_-]{8,}/);

    assert.equal(
      [
        legacySource.id,
        legacySuccessor.id,
        goalSource.id,
        currentCompSource.id,
      ].reduce((sum, id) => sum + store.listEvents(id).length, 0),
      eventsBefore,
    );
    const after = new DatabaseSync(store.databasePath);
    try {
      const row = after.prepare(
        `SELECT record_json FROM candidate_handoffs WHERE id = ?`,
      ).get("legacy-handoff") as { record_json: string };
      assert.equal(row.record_json, legacyJson);
    } finally {
      after.close();
    }

    const broken = make("broken-src", "failed");
    const brokenSuccessor = make("broken-succ", "queued");
    store.createTask(broken);
    store.createTask(brokenSuccessor);
    const secret = "SECRET-DECISION-HANDOFF";
    const brokenRaw = new DatabaseSync(store.databasePath);
    try {
      brokenRaw.prepare(
        `INSERT INTO candidate_handoffs
         (id, source_revision_id, source_task_id, successor_task_id, competition_id,
          status, record_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "broken-handoff",
        "rev-broken",
        broken.id,
        brokenSuccessor.id,
        "",
        "prepared",
        JSON.stringify({
          ...shared,
          id: "broken-handoff",
          sourceTaskId: broken.id,
          sourceCandidateRevisionId: "rev-broken",
          successorTaskId: brokenSuccessor.id,
          reason: secret,
        }),
        stamp,
        stamp,
      );
    } finally {
      brokenRaw.close();
    }
    assert.equal(store.listCandidateHandoffs().find((row) => row.id === "broken-handoff")?.origin, undefined);
    assert.throws(
      () => buildMainDecisionPacketForTask(store, broken.id),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, CANDIDATE_HANDOFF_CORRUPTION_ERROR);
        assert.ok(!error.message.includes(secret));
        return true;
      },
    );
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});
