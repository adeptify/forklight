import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildTaskSummary, projectTaskSurface, projectBoardPlacement, isLegalBoardPlacement, BOARD_SCOPE_VALUES, BOARD_REASON_VALUES, BOARD_REASON_BY_SCOPE, type SafeTaskSummary, type BoardReason } from "../src/core/task-summary.js";
import {
  latestTaskResolutionState,
  resolveTaskResolution,
  reopenTaskResolution,
  isTaskResolutionReason,
  TASK_RESOLUTION_REASONS,
} from "../src/core/task-resolution.js";
import {
  paginateTaskHistory,
  normalizeHistoryQuery,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MIN_LIMIT,
  HISTORY_MAX_LIMIT,
  HISTORY_MAX_QUERY_LENGTH,
  HISTORY_INVALID_REQUEST_REASON,
} from "../src/core/task-history.js";
import {
  failureCategoryForTask,
  failureCategoryFromEvents,
} from "../src/core/worker-failure.js";
import { buildTaskDecisionView } from "../src/core/task-decision-view.js";
import {
  buildStatusProgress,
  detectOpenFollowUp,
  isOpenFollowUpStage,
  projectDualClocks,
} from "../src/core/task-progress.js";
import { isEffectiveProgressEvent } from "../src/core/runtime-activity.js";
import { reconcileTask } from "../src/core/runner.js";
import type { AttemptRecord, EventRecord, RemediationDisposition, TaskRecord, TaskStatus } from "../src/core/types.js";
import { StateStore } from "../src/state/store.js";
import { DaemonCoordinator } from "../src/daemon/coordinator.js";
import { SettingsService } from "../src/core/settings.js";

const TS = "2026-07-25T12:00:00.000Z";

function makeTask(id: string, status: TaskStatus = "running"): TaskRecord {
  return {
    id,
    name: "surface-task",
    status,
    sourcePath: "/source",
    taskFile: "/task.yaml",
    spec: {
      version: 1,
      name: "surface-task",
      project: "/source",
      provider: { name: "deepseek", model: "deepseek-v4-flash", keychainService: "forklight.test" },
      runtime: { name: "claude-code", executable: "claude", effort: "high", maxBudgetUsd: null },
      workspace: { exclude: [] },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
      goal: "surface",
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
    sessionId: "session",
    currentAttemptId: "attempt-1",
    createdAt: "2026-07-25T11:00:00.000Z",
    updatedAt: "2026-07-25T11:00:00.000Z",
  };
}

test("projectTaskSurface exposes active progress while updatedAt stays frozen", () => {
  const task = makeTask("t-active", "running");
  const frozen = task.updatedAt;
  const summary = projectTaskSurface(task, {
    latestEvent: {
      sequence: 4,
      timestamp: TS,
      type: "worker.tool.completed",
      summary: "edited file.ts",
    },
    nowMs: Date.parse(TS) + 5_000,
    quietAfterMs: 30_000,
  });
  assert.equal(summary.updatedAt, frozen);
  assert.equal(summary.progress?.activity, "active");
  assert.equal(summary.progress?.lastEventAt, TS);
  assert.equal(summary.progress?.latestAction, "edited file.ts");
  assert.equal(summary.progress?.latestEventSequence, 4);
});

test("failureCategoryFromEvents reads normalizer payload", () => {
  const events = [
    {
      type: "worker.failed",
      sequence: 2,
      payload: { failureCategory: "authentication", subtype: "success" },
    },
  ];
  assert.equal(failureCategoryFromEvents(events), "authentication");
  assert.equal(
    failureCategoryFromEvents([{ type: "worker.failed", sequence: 1, payload: { failureCategory: "budget" } }]),
    "budget",
  );
  assert.equal(failureCategoryFromEvents([{ type: "worker.completed", sequence: 1 }]), undefined);
});

test("launch authentication rejection is durable non-model failure evidence", () => {
  assert.equal(
    failureCategoryFromEvents([{
      type: "task.launch-preflight.failed",
      sequence: 1,
      payload: { failureCategory: "authentication", workerInvoked: false },
    }]),
    "authentication",
  );
});

test("failureCategory survives classified then bare dual worker.failed (runner double-write)", () => {
  // Real path: claude normalizer writes classified worker.failed, then runner
  // appends a second bare worker.failed with only a summary string (no payload).
  const dual = [
    {
      type: "worker.failed",
      sequence: 5,
      payload: { failureCategory: "authentication", subtype: "success" },
    },
    {
      type: "worker.failed",
      sequence: 6,
      // bare runner summary event — no payload
    },
  ];
  assert.equal(
    failureCategoryFromEvents(dual),
    "authentication",
    "newest bare worker.failed must not erase earlier classified category",
  );
  const budgetDual = [
    { type: "worker.failed", sequence: 1, payload: { failureCategory: "budget" } },
    { type: "worker.failed", sequence: 2 },
  ];
  assert.equal(failureCategoryFromEvents(budgetDual), "budget");
});

test("Decision View projects failureCategory after classified then bare dual events", () => {
  const events: EventRecord[] = [
    {
      id: 1,
      taskId: "task-1",
      attemptId: "attempt-1",
      sequence: 3,
      timestamp: TS,
      type: "worker.failed",
      summary: "Worker failed: authentication/provider credentials rejected",
      payload: { failureCategory: "authentication" },
    },
    {
      id: 2,
      taskId: "task-1",
      attemptId: "attempt-1",
      sequence: 4,
      timestamp: TS,
      type: "worker.failed",
      summary: "Worker execution failed",
      // bare runner double-write
    },
  ];
  const attempt: AttemptRecord = {
    id: "attempt-1",
    taskId: "task-1",
    ordinal: 1,
    status: "failed",
    sessionId: "session-1",
    rawLogPath: "/log",
    startedAt: TS,
    finishedAt: TS,
    exitCode: 1,
  };
  const view = buildTaskDecisionView({
    task: makeTask("task-1", "failed"),
    attempts: [attempt],
    events,
    integrationResults: [],
    nowMs: Date.parse(TS),
  });
  assert.equal(view.failureCategory, "authentication");
  assert.equal(view.progress.activity, "terminal");

  // Same dual sequence via listTaskSurfaces / projectTaskSurface projection.
  const category = failureCategoryFromEvents(events);
  assert.equal(category, "authentication");
  const surface = projectTaskSurface(makeTask("task-1", "failed"), {
    ...(category === undefined ? {} : { failureCategory: category }),
    nowMs: Date.parse(TS),
  });
  assert.equal(surface.failureCategory, "authentication");
});

test("listTaskSurfaces keeps failureCategory when store has dual worker.failed rows", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-dual-fail-"));
  const store = new StateStore(home);
  const task = makeTask("22222222-2222-4222-8222-222222222222", "failed");
  store.createTask(task);
  // seq 1: classified normalizer event
  store.addEvent(
    task.id,
    "attempt-1",
    "worker.failed",
    "Worker failed: authentication/provider credentials rejected",
    { failureCategory: "authentication" },
  );
  // seq 2: bare runner double-write (no payload)
  store.addEvent(task.id, "attempt-1", "worker.failed", "Worker execution failed");
  const coordinator = new DaemonCoordinator(store, new SettingsService(store));
  const surfaces = coordinator.listTaskSurfaces(["failed"], 10);
  assert.equal(surfaces.length, 1);
  assert.equal(surfaces[0]!.failureCategory, "authentication");
  store.close();
});
test("listTaskSurfaces returns progress for store-backed running tasks", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-surface-"));
  const store = new StateStore(home);
  const frozenAt = "2026-07-25T11:00:00.000Z";
  const task = { ...makeTask("11111111-1111-4111-8111-111111111111", "running"), updatedAt: frozenAt, createdAt: frozenAt };
  store.createTask(task);
  store.addEvent(task.id, undefined, "task.created", "queued");
  store.addEvent(task.id, "attempt-1", "worker.tool.completed", "edited board.ts");
  const coordinator = new DaemonCoordinator(store, new SettingsService(store));
  const surfaces = coordinator.listTaskSurfaces(undefined, 10);
  assert.equal(surfaces.length, 1);
  const row = surfaces[0]!;
  assert.equal(row.taskId, task.id);
  assert.equal(row.updatedAt, frozenAt);
  assert.ok(row.progress);
  assert.equal(row.progress!.latestEventSequence, 2);
  assert.equal(row.progress!.latestAction, "edited board.ts");
  assert.equal(row.progress!.lastEventType, "worker.tool.completed");
  assert.ok(row.progress!.activity === "active" || row.progress!.activity === "quiet");
  store.close();
});

test("listTaskSurfaces exposes the current workflow stage after Main review", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-surface-review-"));
  const store = new StateStore(home);
  const task = makeTask("33333333-3333-4333-8333-333333333333", "succeeded");
  store.createTask(task);
  store.addEvent(task.id, "attempt-1", "verification.completed", "passed", {
    passed: true,
    behaviorPassed: true,
    policyPassed: true,
    sourceCompatible: true,
    commands: [],
  });
  const verification = store.listEvents(task.id).at(-1)!;
  store.addEvent(task.id, "attempt-1", "main-review.completed", "accepted", {
    decision: "accept",
    reason: "The retained result passed the complete acceptance contract.",
    attemptId: "attempt-1",
    verificationEventSequence: verification.sequence,
  });
  const coordinator = new DaemonCoordinator(store, new SettingsService(store));
  const surface = coordinator.listTaskSurfaces(["succeeded"], 10)[0]!;
  assert.equal(surface.decisionStage, "ready-for-integration");
  store.close();
});

const dualAuthFailedEvents = (): EventRecord[] => [
  {
    id: 1,
    taskId: "task-hist",
    attemptId: "attempt-1",
    sequence: 3,
    timestamp: TS,
    type: "worker.failed",
    summary: "Worker failed: authentication/provider credentials rejected",
    payload: { failureCategory: "authentication" },
  },
  {
    id: 2,
    taskId: "task-hist",
    attemptId: "attempt-1",
    sequence: 4,
    timestamp: TS,
    type: "worker.failed",
    summary: "Worker execution failed",
  },
];

test("Decision View omits failureCategory on succeeded task with historical worker.failed", () => {
  const events = dualAuthFailedEvents();
  events.push({
    id: 3,
    taskId: "task-hist",
    attemptId: "attempt-2",
    sequence: 5,
    timestamp: TS,
    type: "worker.completed",
    summary: "Worker reported completion",
  });
  assert.equal(failureCategoryFromEvents(events), "authentication");
  assert.equal(failureCategoryForTask("succeeded", events), undefined);
  assert.equal(failureCategoryForTask("running", events), undefined);
  assert.equal(failureCategoryForTask("queued", events), undefined);
  const view = buildTaskDecisionView({
    task: makeTask("task-hist", "succeeded"),
    attempts: [],
    events,
    integrationResults: [],
    nowMs: Date.parse(TS),
  });
  assert.equal(view.failureCategory, undefined);
  assert.equal(view.progress.activity, "terminal");
  assert.equal(view.progress.lastEventType, "worker.completed");
});

test("Decision View omits failureCategory on running task with historical worker.failed", () => {
  const events = dualAuthFailedEvents();
  const view = buildTaskDecisionView({
    task: makeTask("task-hist", "running"),
    attempts: [],
    events,
    integrationResults: [],
    nowMs: Date.parse(TS),
  });
  assert.equal(view.failureCategory, undefined);
  assert.equal(failureCategoryForTask("failed", events), "authentication");
  assert.equal(failureCategoryForTask("interrupted", events), "authentication");
});

test("connectivity failureCategory is durable through Decision View and list surfaces", async () => {
  const safeSummary =
    "Worker could not reach the Provider service due to a network connectivity failure";
  const secretProxy = "http://user:leak-me-token@proxy.example:3128";
  const events: EventRecord[] = [
    {
      id: 1,
      taskId: "task-conn",
      attemptId: "attempt-1",
      sequence: 3,
      timestamp: TS,
      // Private normalizer-style noise that must not win over the runner category.
      type: "worker.failed",
      summary: `runtime noise containing ${secretProxy}`,
      payload: { failureCategory: "runtime" },
    },
    {
      id: 2,
      taskId: "task-conn",
      attemptId: "attempt-1",
      sequence: 4,
      timestamp: TS,
      type: "worker.failed",
      summary: safeSummary,
      payload: { failureCategory: "connectivity" },
    },
  ];
  assert.equal(failureCategoryFromEvents(events), "connectivity");
  assert.equal(failureCategoryForTask("failed", events), "connectivity");

  const attempt: AttemptRecord = {
    id: "attempt-1",
    taskId: "task-conn",
    ordinal: 1,
    status: "failed",
    sessionId: "session-1",
    rawLogPath: "/log",
    startedAt: TS,
    finishedAt: TS,
    exitCode: 1,
    error: safeSummary,
  };
  const view = buildTaskDecisionView({
    task: { ...makeTask("task-conn", "failed"), error: safeSummary },
    attempts: [attempt],
    events,
    integrationResults: [],
    nowMs: Date.parse(TS),
  });
  assert.equal(view.failureCategory, "connectivity");

  const surface = projectTaskSurface(makeTask("task-conn", "failed"), {
    failureCategory: "connectivity",
    nowMs: Date.parse(TS),
  });
  assert.equal(surface.failureCategory, "connectivity");

  const home = await mkdtemp(path.join(tmpdir(), "forklight-conn-fail-"));
  const store = new StateStore(home);
  const task = makeTask("33333333-3333-4333-8333-333333333333", "failed");
  store.createTask({ ...task, error: safeSummary });
  store.addEvent(task.id, "attempt-1", "worker.failed", safeSummary, {
    failureCategory: "connectivity",
  });
  const coordinator = new DaemonCoordinator(store, new SettingsService(store));
  const surfaces = coordinator.listTaskSurfaces(["failed"], 10);
  assert.equal(surfaces[0]!.failureCategory, "connectivity");
  const publicJson = JSON.stringify({ view, surfaces });
  assert.ok(!publicJson.includes(secretProxy), "secret-like proxy material must not appear on surfaces");
  assert.ok(!publicJson.includes("leak-me-token"), "proxy token must not appear on surfaces");
  store.close();
});

test("buildStatusProgress exposes real lastEventType for wait reconstruction", () => {
  const progress = buildStatusProgress(
    makeTask("t-type", "running"),
    {
      sequence: 7,
      timestamp: TS,
      type: "worker.tool.completed",
      summary: "edited file.ts",
    },
    Date.parse(TS) + 1_000,
  );
  assert.equal(progress.lastEventType, "worker.tool.completed");
  assert.equal(progress.lastEventAt, TS);
  assert.equal(progress.latestAction, "edited file.ts");
  assert.notEqual(progress.lastEventType, "progress");
});

// --- Canonical live-stage projection (privacy-safe Worker explanation) ---

test("liveStage: worker start waits for model without claiming network state", () => {
  const events = [
    {
      sequence: 1,
      timestamp: TS,
      type: "worker.started" as const,
    },
  ];
  const progress = buildStatusProgress(
    makeTask("t-wait", "running"),
    { sequence: 1, timestamp: TS, type: "worker.started", summary: "started" },
    Date.parse(TS) + 1_000,
    30_000,
    undefined,
    events,
  );
  assert.equal(progress.liveStage?.stage, "waiting-for-model");
  assert.equal(progress.liveStage?.evidence, "worker-start");
  assert.equal(progress.liveStage?.meaning, "normal");
  assert.equal(progress.liveStage?.observation, "active");
  assert.equal(progress.liveStage?.next, "wait-for-model");
  const publicJson = JSON.stringify(progress.liveStage);
  assert.ok(!publicJson.includes("http"), "must not claim network request state");
  assert.ok(!/prompt|credential|token|password/i.test(publicJson));
});

test("liveStage: model activity and tool lifecycle with matching completion", () => {
  const base = Date.parse(TS);
  const events = [
    { sequence: 1, timestamp: TS, type: "worker.started" as const },
    {
      sequence: 2,
      timestamp: new Date(base + 1_000).toISOString(),
      type: "worker.message" as const,
      payload: { activityKind: "model-response" },
    },
    {
      sequence: 3,
      timestamp: new Date(base + 2_000).toISOString(),
      type: "worker.tool.started" as const,
      payload: { toolUseId: "tool-1", tool: "Read" },
    },
  ];
  const duringTool = buildStatusProgress(
    makeTask("t-tool", "running"),
    { sequence: 3, timestamp: events[2]!.timestamp, type: "worker.tool.started", summary: "Read" },
    base + 2_500,
    30_000,
    undefined,
    events,
  );
  assert.equal(duringTool.liveStage?.stage, "using-tool");
  assert.equal(duringTool.liveStage?.evidence, "tool-lifecycle");
  assert.equal(duringTool.liveStage?.next, "wait-for-tool-result");

  const afterComplete = [
    ...events,
    {
      sequence: 4,
      timestamp: new Date(base + 3_000).toISOString(),
      type: "worker.tool.completed" as const,
      payload: { toolUseId: "tool-1", tool: "Read" },
    },
  ];
  const after = buildStatusProgress(
    makeTask("t-tool", "running"),
    {
      sequence: 4,
      timestamp: afterComplete[3]!.timestamp,
      type: "worker.tool.completed",
      summary: "Read completed",
    },
    base + 3_500,
    30_000,
    undefined,
    afterComplete,
  );
  assert.equal(after.liveStage?.stage, "waiting-for-model");
  assert.equal(after.liveStage?.evidence, "tool-lifecycle");
  assert.equal(after.liveStage?.next, "wait-for-model");
});

test("liveStage: unrelated narration cannot close an open tool", () => {
  const events = [
    { sequence: 1, timestamp: TS, type: "worker.started" as const },
    {
      sequence: 2,
      timestamp: TS,
      type: "worker.tool.started" as const,
      payload: { toolUseId: "t1" },
    },
    {
      sequence: 3,
      timestamp: TS,
      type: "worker.message" as const,
      // No activityKind and no tool completion — narration only.
      payload: { streamType: "noise" },
    },
  ];
  const progress = buildStatusProgress(
    makeTask("t-open-tool", "running"),
    { sequence: 3, timestamp: TS, type: "worker.message", summary: "still working" },
    Date.parse(TS) + 1_000,
    30_000,
    undefined,
    events,
  );
  assert.equal(progress.liveStage?.stage, "using-tool");
});

test("liveStage: verification wins over worker-running stages", () => {
  const events = [
    { sequence: 1, timestamp: TS, type: "worker.started" as const },
    {
      sequence: 2,
      timestamp: TS,
      type: "worker.message" as const,
      payload: { activityKind: "model-response" },
    },
    { sequence: 3, timestamp: TS, type: "worker.completed" as const },
    { sequence: 4, timestamp: TS, type: "verification.started" as const },
  ];
  const progress = buildStatusProgress(
    makeTask("t-verify", "verifying"),
    { sequence: 4, timestamp: TS, type: "verification.started", summary: "verifying" },
    Date.parse(TS) + 1_000,
    30_000,
    undefined,
    events,
  );
  assert.equal(progress.liveStage?.stage, "verifying");
  assert.equal(progress.liveStage?.evidence, "verification");
  assert.equal(progress.liveStage?.meaning, "normal");
});

test("liveStage: quiet keeps last stage and never means failed", () => {
  const events = [
    { sequence: 1, timestamp: TS, type: "worker.started" as const },
    {
      sequence: 2,
      timestamp: TS,
      type: "worker.message" as const,
      payload: { activityKind: "model-response" },
    },
  ];
  const progress = buildStatusProgress(
    makeTask("t-quiet", "running"),
    { sequence: 2, timestamp: TS, type: "worker.message", summary: "thinking" },
    Date.parse(TS) + 120_000,
    30_000,
    undefined,
    events,
  );
  assert.equal(progress.activity, "quiet");
  assert.equal(progress.liveStage?.observation, "quiet");
  assert.equal(progress.liveStage?.stage, "model-responding");
  assert.equal(progress.liveStage?.meaning, "normal");
  assert.equal(progress.liveStage?.next, "wait-for-new-evidence");
  assert.notEqual(progress.liveStage?.stage, "failed");
});

test("liveStage: explicit no-progress failure uses stopped wording", () => {
  const events = [
    { sequence: 1, timestamp: TS, type: "worker.started" as const },
    {
      sequence: 2,
      timestamp: TS,
      type: "policy.noprogress.exceeded" as const,
      payload: { category: "no-progress" },
    },
  ];
  const progress = buildStatusProgress(
    makeTask("t-npp", "failed"),
    {
      sequence: 2,
      timestamp: TS,
      type: "policy.noprogress.exceeded",
      summary: "no progress",
    },
    Date.parse(TS) + 1_000,
    30_000,
    undefined,
    events,
  );
  assert.equal(progress.activity, "terminal");
  assert.equal(progress.liveStage?.stage, "failed");
  assert.equal(progress.liveStage?.evidence, "policy");
  assert.equal(progress.liveStage?.meaning, "attention");
  assert.equal(progress.liveStage?.observation, "terminal");
  assert.equal(progress.liveStage?.next, "inspect-failure");
});

test("liveStage: legacy messages fall back without inventing precision", () => {
  const events = [
    {
      sequence: 1,
      timestamp: TS,
      type: "worker.message" as const,
      // Historical message without activityKind metadata.
      summary: "thinking hard about /secret/path and api_key=xyz",
    },
  ];
  const progress = buildStatusProgress(
    makeTask("t-legacy", "running"),
    {
      sequence: 1,
      timestamp: TS,
      type: "worker.message",
      summary: "thinking hard about /secret/path and api_key=xyz",
    },
    Date.parse(TS) + 1_000,
    30_000,
    undefined,
    events,
  );
  assert.equal(progress.liveStage?.stage, "legacy-running");
  assert.equal(progress.liveStage?.evidence, "legacy");
  const publicJson = JSON.stringify(progress.liveStage);
  assert.ok(!publicJson.includes("/secret/path"));
  assert.ok(!publicJson.includes("api_key"));
  assert.ok(!publicJson.includes("thinking hard"));
});

test("liveStage: replay of the same history is stable after restart", () => {
  const events = [
    { sequence: 1, timestamp: TS, type: "worker.started" as const },
    {
      sequence: 2,
      timestamp: TS,
      type: "worker.tool.started" as const,
      payload: { toolUseId: "a" },
    },
    {
      sequence: 3,
      timestamp: TS,
      type: "worker.message" as const,
      payload: { activityKind: "model-response" },
    },
  ];
  const first = buildStatusProgress(
    makeTask("t-replay", "running"),
    { sequence: 3, timestamp: TS, type: "worker.message", summary: "x" },
    Date.parse(TS) + 5_000,
    30_000,
    undefined,
    events,
  );
  const second = buildStatusProgress(
    makeTask("t-replay", "running"),
    { sequence: 3, timestamp: TS, type: "worker.message", summary: "x" },
    Date.parse(TS) + 5_000,
    30_000,
    undefined,
    events,
  );
  assert.deepEqual(first.liveStage, second.liveStage);
  assert.equal(first.liveStage?.stage, "using-tool");
});

// --- Canonical model-processing live-stage ---

test("liveStage: model-processing is distinct from waiting and model-responding", () => {
  const events = [
    { sequence: 1, timestamp: TS, type: "worker.started" as const },
    {
      sequence: 2,
      timestamp: TS,
      type: "worker.message" as const,
      payload: { activityKind: "model-processing" },
    },
  ];
  const progress = buildStatusProgress(
    makeTask("t-proc", "running"),
    { sequence: 2, timestamp: TS, type: "worker.message", summary: "processing" },
    Date.parse(TS) + 1_000,
    30_000,
    undefined,
    events,
  );
  assert.equal(progress.liveStage?.stage, "model-processing");
  assert.equal(progress.liveStage?.evidence, "model-activity");
  assert.equal(progress.liveStage?.meaning, "normal");
  assert.equal(progress.liveStage?.observation, "active");
  assert.equal(progress.liveStage?.next, "wait-for-next-model-step");
  assert.notEqual(progress.liveStage?.stage, "waiting-for-model");
  assert.notEqual(progress.liveStage?.stage, "model-responding");
});

test("liveStage: processing stays while model responds but tool remains stronger", () => {
  const base = Date.parse(TS);
  const events = [
    { sequence: 1, timestamp: TS, type: "worker.started" as const },
    {
      sequence: 2,
      timestamp: new Date(base + 1_000).toISOString(),
      type: "worker.message" as const,
      payload: { activityKind: "model-processing" },
    },
    {
      sequence: 3,
      timestamp: new Date(base + 5_000).toISOString(),
      type: "worker.tool.started" as const,
      payload: { toolUseId: "t1", tool: "Read" },
    },
    {
      sequence: 4,
      timestamp: new Date(base + 6_000).toISOString(),
      type: "worker.message" as const,
      payload: { activityKind: "model-processing" },
    },
  ];
  const duringTool = buildStatusProgress(
    makeTask("t-proc-tool", "running"),
    { sequence: 4, timestamp: events[3]!.timestamp, type: "worker.message", summary: "processing" },
    base + 6_500,
    30_000,
    undefined,
    events,
  );
  // Tool remains stronger evidence than processing.
  assert.equal(duringTool.liveStage?.stage, "using-tool");
  assert.equal(duringTool.liveStage?.evidence, "tool-lifecycle");
});

test("liveStage: processing to response transition and quiet observation", () => {
  const base = Date.parse(TS);
  const events = [
    { sequence: 1, timestamp: TS, type: "worker.started" as const },
    {
      sequence: 2,
      timestamp: new Date(base + 1_000).toISOString(),
      type: "worker.message" as const,
      payload: { activityKind: "model-processing" },
    },
    {
      sequence: 3,
      timestamp: new Date(base + 10_000).toISOString(),
      type: "worker.message" as const,
      payload: { activityKind: "model-response" },
    },
  ];
  // Active: latest evidence is model-response.
  const active = buildStatusProgress(
    makeTask("t-proc-resp", "running"),
    { sequence: 3, timestamp: events[2]!.timestamp, type: "worker.message", summary: "text" },
    base + 10_500,
    30_000,
    undefined,
    events,
  );
  assert.equal(active.liveStage?.stage, "model-responding");
  assert.equal(active.liveStage?.observation, "active");

  // Quiet: 120s after last event, stage stays model-responding but observation is quiet.
  const quiet = buildStatusProgress(
    makeTask("t-proc-resp", "running"),
    { sequence: 3, timestamp: events[2]!.timestamp, type: "worker.message", summary: "text" },
    base + 130_000,
    30_000,
    undefined,
    events,
  );
  assert.equal(quiet.liveStage?.observation, "quiet");
  assert.equal(quiet.liveStage?.stage, "model-responding");
  assert.equal(quiet.liveStage?.meaning, "normal");
  assert.equal(quiet.liveStage?.next, "wait-for-new-evidence");
  // Quiet processing is never failure.
  assert.notEqual(quiet.liveStage?.stage, "failed");
  assert.notEqual(quiet.liveStage?.meaning, "attention");
});

test("liveStage: processing does not weaken verification or terminal precedence", () => {
  const events = [
    { sequence: 1, timestamp: TS, type: "worker.started" as const },
    {
      sequence: 2,
      timestamp: TS,
      type: "worker.message" as const,
      payload: { activityKind: "model-processing" },
    },
    { sequence: 3, timestamp: TS, type: "worker.completed" as const },
    { sequence: 4, timestamp: TS, type: "verification.started" as const },
    {
      sequence: 5,
      timestamp: TS,
      type: "worker.message" as const,
      payload: { activityKind: "model-processing" },
    },
  ];
  // Verification already started; processing signal cannot override.
  const verifying = buildStatusProgress(
    makeTask("t-proc-verify", "verifying"),
    { sequence: 5, timestamp: TS, type: "worker.message", summary: "processing" },
    Date.parse(TS) + 1_000,
    30_000,
    undefined,
    events,
  );
  assert.equal(verifying.liveStage?.stage, "verifying");
  assert.notEqual(verifying.liveStage?.stage, "model-processing");

  // Replayed evidence also shows verification wins.
  const replayed = buildStatusProgress(
    makeTask("t-proc-verify", "running"),
    { sequence: 5, timestamp: TS, type: "worker.message", summary: "processing" },
    Date.parse(TS) + 1_000,
    30_000,
    undefined,
    events,
  );
  assert.equal(replayed.liveStage?.stage, "verifying");
});

test("listTaskSurfaces exposes the same liveStage as Decision View", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-live-stage-"));
  const store = new StateStore(home);
  const task = makeTask("44444444-4444-4444-8444-444444444444", "running");
  store.createTask(task);
  store.addEvent(task.id, "attempt-1", "worker.started", "started");
  store.addEvent(task.id, "attempt-1", "worker.message", "thinking", {
    activityKind: "model-response",
  });
  const coordinator = new DaemonCoordinator(store, new SettingsService(store));
  const surface = coordinator.listTaskSurfaces(["running"], 10)[0]!;
  assert.equal(surface.progress?.liveStage?.stage, "model-responding");
  assert.equal(surface.progress?.liveStage?.evidence, "model-activity");
  const view = buildTaskDecisionView({
    task: store.getTask(task.id)!,
    attempts: store.listAttempts(task.id),
    events: store.listEvents(task.id),
    integrationResults: [],
    nowMs: Date.now(),
  });
  assert.equal(view.progress.liveStage?.stage, surface.progress?.liveStage?.stage);
  assert.equal(view.progress.liveStage?.evidence, surface.progress?.liveStage?.evidence);
  // Dual clocks are shared across list and Decision View surfaces.
  assert.ok(surface.progress?.dualClock);
  assert.ok(view.progress.dualClock);
  assert.equal(
    view.progress.dualClock?.latestEffectiveProgressAt,
    surface.progress?.dualClock?.latestEffectiveProgressAt,
  );
  assert.equal(view.progress.dualClock?.effectiveProgressKnown, true);
  store.close();
});

// --- Dual-clock: Runtime liveness vs effective progress ---

test("dualClock: liveness-only heartbeats advance Runtime signal but not effective progress", () => {
  const base = Date.parse(TS);
  const startAt = new Date(base).toISOString();
  const heartbeatAt = new Date(base + 9 * 60_000).toISOString();
  const events = [
    { sequence: 1, timestamp: startAt, type: "worker.started" as const },
    {
      sequence: 2,
      timestamp: new Date(base + 15_000).toISOString(),
      type: "worker.message" as const,
      payload: { activityKind: "model-processing", activityEvidence: "liveness" },
    },
    {
      sequence: 3,
      timestamp: heartbeatAt,
      type: "worker.message" as const,
      payload: { activityKind: "model-processing", activityEvidence: "liveness" },
    },
  ];
  const nowMs = base + 9 * 60_000 + 1_000;
  const dual = projectDualClocks(makeTask("t-dual-live", "running"), events, nowMs, 30_000);
  assert.equal(dual.latestRuntimeSignalAt, heartbeatAt);
  assert.equal(dual.latestEffectiveProgressAt, startAt, "progress stays at Worker start baseline");
  assert.equal(dual.runtimeSignalObservation, "active");
  assert.equal(dual.effectiveProgressObservation, "baseline");
  assert.equal(dual.effectiveProgressKnown, false);
  assert.equal(dual.next, "wait-for-effective-progress");
  assert.equal(
    isEffectiveProgressEvent("worker.message", {
      activityKind: "model-processing",
      activityEvidence: "liveness",
    }),
    false,
  );

  const progress = buildStatusProgress(
    makeTask("t-dual-live", "running"),
    { sequence: 3, timestamp: heartbeatAt, type: "worker.message", summary: "Model is actively processing" },
    nowMs,
    30_000,
    undefined,
    events,
  );
  assert.equal(progress.activity, "active", "fresh Runtime signal is not a dead connection");
  assert.equal(progress.latestRuntimeSignalAt, heartbeatAt);
  assert.equal(progress.latestEffectiveProgressAt, startAt);
  assert.equal(progress.dualClock?.runtimeSignalObservation, "active");
  assert.equal(progress.lastEventAt, heartbeatAt, "legacy lastEventAt preserved");
  assert.ok(progress.liveStage, "legacy liveStage preserved");
  // Privacy: no private diagnostics in dual-clock projection.
  const json = JSON.stringify(progress.dualClock);
  assert.ok(!json.includes("Model is actively processing"));
  assert.ok(!json.includes("activityEvidence"));
});

test("dualClock: visible model response and tools advance both clocks", () => {
  const base = Date.parse(TS);
  const startAt = new Date(base).toISOString();
  const responseAt = new Date(base + 20_000).toISOString();
  const toolAt = new Date(base + 40_000).toISOString();
  const events = [
    { sequence: 1, timestamp: startAt, type: "worker.started" as const },
    {
      sequence: 2,
      timestamp: responseAt,
      type: "worker.message" as const,
      payload: { activityKind: "model-response", activityEvidence: "effective-progress" },
    },
    {
      sequence: 3,
      timestamp: toolAt,
      type: "worker.tool.started" as const,
      payload: { toolUseId: "t1", tool: "Read", activityEvidence: "effective-progress" },
    },
  ];
  const dual = projectDualClocks(
    makeTask("t-dual-eff", "running"),
    events,
    base + 41_000,
    30_000,
  );
  assert.equal(dual.latestRuntimeSignalAt, toolAt);
  assert.equal(dual.latestEffectiveProgressAt, toolAt);
  assert.equal(dual.effectiveProgressKnown, true);
  assert.equal(dual.effectiveProgressObservation, "active");
  assert.equal(dual.runtimeSignalObservation, "active");
});

test("dualClock: restart replay rebuilds the same two timestamps without Provider state", () => {
  const base = Date.parse(TS);
  const startAt = new Date(base).toISOString();
  const progressAt = new Date(base + 60_000).toISOString();
  const heartbeatAt = new Date(base + 5 * 60_000).toISOString();
  const events = [
    { sequence: 1, timestamp: startAt, type: "worker.started" as const },
    {
      sequence: 2,
      timestamp: progressAt,
      type: "worker.message" as const,
      payload: { activityKind: "model-response", activityEvidence: "effective-progress" },
    },
    {
      sequence: 3,
      timestamp: heartbeatAt,
      type: "worker.message" as const,
      payload: { activityKind: "model-processing", activityEvidence: "liveness" },
    },
  ];
  const nowMs = base + 5 * 60_000 + 2_000;
  const first = projectDualClocks(makeTask("t-dual-replay", "running"), events, nowMs, 30_000);
  const second = projectDualClocks(makeTask("t-dual-replay", "running"), events, nowMs, 30_000);
  assert.deepEqual(first, second);
  assert.equal(first.latestRuntimeSignalAt, heartbeatAt);
  assert.equal(first.latestEffectiveProgressAt, progressAt);
  assert.equal(first.effectiveProgressKnown, true);
  assert.equal(first.runtimeSignalObservation, "active");
  assert.equal(first.effectiveProgressObservation, "quiet");
});

test("dualClock: legacy worker.message without classification never invents effective progress", () => {
  const base = Date.parse(TS);
  const startAt = new Date(base).toISOString();
  const legacyAt = new Date(base + 30_000).toISOString();
  const events = [
    { sequence: 1, timestamp: startAt, type: "worker.started" as const },
    {
      sequence: 2,
      timestamp: legacyAt,
      type: "worker.message" as const,
      // No activityEvidence and no activityKind — historical narration only.
      payload: { note: "old prose must not be classified" },
    },
  ];
  const dual = projectDualClocks(
    makeTask("t-dual-legacy", "running"),
    events,
    base + 31_000,
    30_000,
  );
  assert.equal(dual.latestRuntimeSignalAt, legacyAt);
  assert.equal(dual.latestEffectiveProgressAt, startAt, "Worker-start baseline only");
  assert.equal(dual.effectiveProgressKnown, false);
  assert.equal(dual.effectiveProgressObservation, "baseline");
  // Must not parse prose for progress.
  assert.equal(
    isEffectiveProgressEvent("worker.message", { note: "tool completed successfully" }),
    false,
  );
});

test("dualClock: Grok thought deltas count as effective; Claude thinking_tokens do not", () => {
  const base = Date.parse(TS);
  const startAt = new Date(base).toISOString();
  const at = new Date(base + 10_000).toISOString();
  const claudeOnly = projectDualClocks(
    makeTask("t-dual-claude", "running"),
    [
      { sequence: 1, timestamp: startAt, type: "worker.started" },
      {
        sequence: 2,
        timestamp: at,
        type: "worker.message",
        payload: { activityKind: "model-processing", activityEvidence: "liveness" },
      },
    ],
    base + 11_000,
    30_000,
  );
  assert.equal(claudeOnly.latestEffectiveProgressAt, startAt);
  assert.equal(claudeOnly.effectiveProgressKnown, false);

  const grokThought = projectDualClocks(
    makeTask("t-dual-grok", "running"),
    [
      { sequence: 1, timestamp: startAt, type: "worker.started" },
      {
        sequence: 2,
        timestamp: at,
        type: "worker.message",
        payload: {
          activityKind: "model-processing",
          activityEvidence: "effective-progress",
          streamType: "thought",
        },
      },
    ],
    base + 11_000,
    30_000,
  );
  assert.equal(grokThought.latestEffectiveProgressAt, at);
  assert.equal(grokThought.effectiveProgressKnown, true);
});

test("dualClock: new Worker start resets effective-progress baseline for the new Attempt", () => {
  const base = Date.parse(TS);
  const firstStart = new Date(base).toISOString();
  const firstProgress = new Date(base + 30_000).toISOString();
  const secondStart = new Date(base + 120_000).toISOString();
  const heartbeat = new Date(base + 150_000).toISOString();
  const dual = projectDualClocks(
    makeTask("t-dual-attempt", "running"),
    [
      { sequence: 1, timestamp: firstStart, type: "worker.started" },
      {
        sequence: 2,
        timestamp: firstProgress,
        type: "worker.message",
        payload: { activityKind: "model-response", activityEvidence: "effective-progress" },
      },
      // New Attempt: prior effective progress must not survive.
      { sequence: 3, timestamp: secondStart, type: "worker.started" },
      {
        sequence: 4,
        timestamp: heartbeat,
        type: "worker.message",
        payload: { activityKind: "model-processing", activityEvidence: "liveness" },
      },
    ],
    base + 151_000,
    30_000,
  );
  assert.equal(dual.latestRuntimeSignalAt, heartbeat);
  assert.equal(dual.latestEffectiveProgressAt, secondStart, "baseline is the latest Worker start");
  assert.equal(dual.effectiveProgressKnown, false, "prior Attempt progress is cleared");
  assert.equal(dual.effectiveProgressObservation, "baseline");
  assert.notEqual(dual.latestEffectiveProgressAt, firstProgress);
});

test("dualClock: failed terminal next is inspect-failure", () => {
  const base = Date.parse(TS);
  const startAt = new Date(base).toISOString();
  const failed = projectDualClocks(
    makeTask("t-dual-fail", "failed"),
    [
      { sequence: 1, timestamp: startAt, type: "worker.started" },
      {
        sequence: 2,
        timestamp: new Date(base + 10_000).toISOString(),
        type: "worker.failed",
      },
    ],
    base + 11_000,
    30_000,
  );
  assert.equal(failed.runtimeSignalObservation, "terminal");
  assert.equal(failed.effectiveProgressObservation, "terminal");
  assert.equal(failed.next, "inspect-failure");

  const interrupted = projectDualClocks(
    makeTask("t-dual-int", "interrupted"),
    [{ sequence: 1, timestamp: startAt, type: "worker.started" }],
    base + 1_000,
    30_000,
  );
  assert.equal(interrupted.next, "inspect-failure");

  const succeeded = projectDualClocks(
    makeTask("t-dual-ok", "succeeded"),
    [{ sequence: 1, timestamp: startAt, type: "worker.started" }],
    base + 1_000,
    30_000,
  );
  assert.equal(succeeded.next, "none");
});

test("liveStage: worker.completed projects worker-finished before verification (full replay)", () => {
  const events = [
    { sequence: 1, timestamp: TS, type: "worker.started" as const },
    { sequence: 2, timestamp: TS, type: "worker.completed" as const },
  ];
  const progress = buildStatusProgress(
    makeTask("t-wf-full", "running"),
    { sequence: 2, timestamp: TS, type: "worker.completed", summary: "done" },
    Date.parse(TS) + 1_000,
    30_000,
    undefined,
    events,
  );
  assert.equal(progress.liveStage?.stage, "worker-finished");
  assert.equal(progress.liveStage?.evidence, "terminal");
  assert.equal(progress.liveStage?.meaning, "normal");
  assert.equal(progress.liveStage?.next, "wait-for-verification-start");
  assert.notEqual(progress.liveStage?.stage, "waiting-for-model");
});

test("liveStage: worker.completed projects worker-finished in latest-only fallback", () => {
  // No ordered events supplied: only the latest-event cursor is available.
  const progress = buildStatusProgress(
    makeTask("t-wf-latest", "running"),
    { sequence: 2, timestamp: TS, type: "worker.completed", summary: "done" },
    Date.parse(TS) + 1_000,
    30_000,
  );
  assert.equal(progress.liveStage?.stage, "worker-finished");
  assert.equal(progress.liveStage?.next, "wait-for-verification-start");
  assert.notEqual(progress.liveStage?.stage, "waiting-for-model");
});

test("liveStage: verification.started takes precedence over worker.completed", () => {
  const events = [
    { sequence: 1, timestamp: TS, type: "worker.started" as const },
    { sequence: 2, timestamp: TS, type: "worker.completed" as const },
    { sequence: 3, timestamp: TS, type: "verification.started" as const },
  ];
  // verifying status short-circuits to the verifying stage.
  const verifying = buildStatusProgress(
    makeTask("t-wf-verify", "verifying"),
    { sequence: 3, timestamp: TS, type: "verification.started", summary: "verifying" },
    Date.parse(TS) + 1_000,
    30_000,
    undefined,
    events,
  );
  assert.equal(verifying.liveStage?.stage, "verifying");
  assert.equal(verifying.liveStage?.evidence, "verification");
  // Even with running status, replayed verification evidence wins over the
  // earlier worker.completed transition.
  const replayed = buildStatusProgress(
    makeTask("t-wf-verify-run", "running"),
    { sequence: 3, timestamp: TS, type: "verification.started", summary: "verifying" },
    Date.parse(TS) + 1_000,
    30_000,
    undefined,
    events,
  );
  assert.equal(replayed.liveStage?.stage, "verifying");
  assert.notEqual(replayed.liveStage?.stage, "worker-finished");
});

test("liveStage: terminal Task status takes precedence over worker.completed", () => {
  const events = [
    { sequence: 1, timestamp: TS, type: "worker.started" as const },
    { sequence: 2, timestamp: TS, type: "worker.completed" as const },
  ];
  for (const status of ["succeeded", "failed", "interrupted"] as const) {
    const progress = buildStatusProgress(
      makeTask(`t-wf-term-${status}`, status),
      { sequence: 2, timestamp: TS, type: "worker.completed", summary: "done" },
      Date.parse(TS) + 1_000,
      30_000,
      undefined,
      events,
    );
    assert.equal(progress.activity, "terminal");
    assert.notEqual(progress.liveStage?.stage, "worker-finished");
    assert.notEqual(progress.liveStage?.stage, "waiting-for-model");
  }
  const succeeded = buildStatusProgress(
    makeTask("t-wf-term-succeeded", "succeeded"),
    { sequence: 2, timestamp: TS, type: "worker.completed", summary: "done" },
    Date.parse(TS) + 1_000,
    30_000,
    undefined,
    events,
  );
  assert.equal(succeeded.liveStage?.stage, "completed");
});

test("reconcileTask never interrupts verifying; entry clears Worker PID", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-reconcile-verify-"));
  const store = new StateStore(home);
  const taskId = "55555555-5555-4555-8555-555555555555";
  // Running with a live PID field is the pre-verification race window.
  store.createTask({
    ...makeTask(taskId, "running"),
    workerPid: 42,
  });
  store.addEvent(taskId, "attempt-1", "worker.completed", "Worker reported completion");

  // Same durable entry transition verifyTask performs before acceptance work.
  store.setTaskStatus(taskId, "verifying", { workerPid: null });
  store.addEvent(taskId, "attempt-1", "verification.started", "Independent verification started");

  const entered = store.getTask(taskId);
  assert.equal(entered.status, "verifying");
  assert.equal(entered.workerPid, undefined, "stale Worker PID is cleared at verification entry");

  // Status polling must be a pure read for verifying Tasks (no interrupt/retry).
  const after = reconcileTask(store, taskId);
  assert.equal(after.status, "verifying");
  assert.equal(after.workerPid, undefined);
  assert.equal(after.error, undefined);
  assert.equal(
    store.listEvents(taskId).some((event) => event.type === "worker.interrupted"),
    false,
    "status poll must not write interruption evidence during verification",
  );

  // Even a stale PID left on a verifying Task must not be supervised as a live Worker.
  store.setTaskStatus(taskId, "verifying", { workerPid: 999_999_999 });
  const stillVerifying = reconcileTask(store, taskId);
  assert.equal(stillVerifying.status, "verifying");
  assert.equal(stillVerifying.workerPid, 999_999_999);
  assert.equal(
    store.listEvents(taskId).filter((event) => event.type === "worker.interrupted").length,
    0,
  );

  // Contract: verifyTask and runner clear PID at verification entry (no race).
  const verifierSrc = await readFile(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/core/verifier.ts"),
    "utf8",
  );
  assert.ok(
    verifierSrc.includes('setTaskStatus(task.id, "verifying", { workerPid: null })'),
    "verifyTask must clear workerPid when entering verifying",
  );
  const runnerSrc = await readFile(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/core/runner.ts"),
    "utf8",
  );
  assert.ok(
    runnerSrc.includes("store.updateTask(task.id, { workerPid: null })"),
    "runner must drop live Worker PID after the child exits",
  );
  store.close();
});

// --- Canonical post-terminal follow-up operation projection ---

test("detectOpenFollowUp: no follow-up events returns undefined", () => {
  assert.equal(detectOpenFollowUp([]), undefined);
  assert.equal(detectOpenFollowUp([
    { sequence: 1, timestamp: TS, type: "worker.started" as const },
    { sequence: 2, timestamp: TS, type: "worker.completed" as const },
  ]), undefined);
});

test("detectOpenFollowUp: unmatched Candidate reverification start is open", () => {
  const events = [
    { sequence: 1, timestamp: TS, type: "candidate.reverification.started" as const },
  ];
  assert.equal(detectOpenFollowUp(events), "candidate-reverifying");
});

test("detectOpenFollowUp: matched Candidate reverification start + completion is closed", () => {
  const events = [
    { sequence: 1, timestamp: TS, type: "candidate.reverification.started" as const },
    { sequence: 2, timestamp: TS, type: "candidate.reverification.completed" as const },
  ];
  assert.equal(detectOpenFollowUp(events), undefined);
});

test("detectOpenFollowUp: latest start wins over earlier completion", () => {
  const events = [
    { sequence: 1, timestamp: TS, type: "candidate.reverification.completed" as const },
    { sequence: 2, timestamp: TS, type: "candidate.reverification.started" as const },
  ];
  assert.equal(detectOpenFollowUp(events), "candidate-reverifying");
});

test("detectOpenFollowUp: unmatched remediation check start is open", () => {
  const events = [
    { sequence: 1, timestamp: TS, type: "remediation.check.started" as const },
  ];
  assert.equal(detectOpenFollowUp(events), "remediation-checking");
});

test("detectOpenFollowUp: both open picks newer start sequence", () => {
  const events = [
    { sequence: 5, timestamp: TS, type: "candidate.reverification.started" as const },
    { sequence: 10, timestamp: TS, type: "remediation.check.started" as const },
  ];
  assert.equal(detectOpenFollowUp(events), "remediation-checking");
});

test("detectOpenFollowUp: both open, reverification start is newer", () => {
  const events = [
    { sequence: 10, timestamp: TS, type: "remediation.check.started" as const },
    { sequence: 11, timestamp: TS, type: "candidate.reverification.started" as const },
  ];
  assert.equal(detectOpenFollowUp(events), "candidate-reverifying");
});

test("isOpenFollowUpStage: recognizes both follow-up codes", () => {
  assert.equal(isOpenFollowUpStage("candidate-reverifying"), true);
  assert.equal(isOpenFollowUpStage("remediation-checking"), true);
  assert.equal(isOpenFollowUpStage("completed"), false);
  assert.equal(isOpenFollowUpStage("failed"), false);
  assert.equal(isOpenFollowUpStage(undefined), false);
});

test("liveStage: terminal Task with open Candidate reverification projects follow-up", () => {
  const base = Date.parse(TS);
  const events = [
    { sequence: 1, timestamp: TS, type: "worker.started" as const },
    { sequence: 2, timestamp: TS, type: "worker.completed" as const },
    { sequence: 3, timestamp: TS, type: "verification.completed" as const },
    {
      sequence: 4,
      timestamp: new Date(base + 1000).toISOString(),
      type: "candidate.reverification.started" as const,
    },
  ];
  const progress = buildStatusProgress(
    makeTask("t-followup", "failed"),
    {
      sequence: 4,
      timestamp: events[3]!.timestamp,
      type: "candidate.reverification.started",
      summary: "reverifying",
    },
    base + 2000,
    30_000,
    undefined,
    events,
  );
  assert.equal(progress.liveStage?.stage, "candidate-reverifying");
  assert.equal(progress.liveStage?.evidence, "candidate-reverification");
  assert.equal(progress.liveStage?.meaning, "normal");
  assert.equal(progress.liveStage?.observation, "active");
  assert.equal(progress.liveStage?.next, "wait-for-reverification-result");
  assert.equal(progress.activity, "active", "activity follows liveStage observation");
  // Task status remains failed.
  assert.equal(makeTask("t-followup", "failed").status, "failed");
});

test("liveStage: terminal Task with open remediation check projects follow-up", () => {
  const base = Date.parse(TS);
  const events = [
    { sequence: 1, timestamp: TS, type: "worker.started" as const },
    { sequence: 2, timestamp: TS, type: "worker.failed" as const },
    {
      sequence: 3,
      timestamp: new Date(base + 1000).toISOString(),
      type: "remediation.check.started" as const,
    },
  ];
  const progress = buildStatusProgress(
    makeTask("t-remed", "failed"),
    {
      sequence: 3,
      timestamp: events[2]!.timestamp,
      type: "remediation.check.started",
      summary: "checking repair",
    },
    base + 2000,
    30_000,
    undefined,
    events,
  );
  assert.equal(progress.liveStage?.stage, "remediation-checking");
  assert.equal(progress.liveStage?.evidence, "remediation-check");
  assert.equal(progress.liveStage?.meaning, "normal");
  assert.equal(progress.activity, "active");
});

test("liveStage: follow-up completion restores terminal projection", () => {
  const events = [
    { sequence: 1, timestamp: TS, type: "worker.failed" as const },
    { sequence: 2, timestamp: TS, type: "candidate.reverification.started" as const },
    { sequence: 3, timestamp: TS, type: "candidate.reverification.completed" as const },
  ];
  const progress = buildStatusProgress(
    makeTask("t-closed", "failed"),
    { sequence: 3, timestamp: TS, type: "candidate.reverification.completed", summary: "done" },
    Date.parse(TS) + 1000,
    30_000,
    undefined,
    events,
  );
  assert.equal(progress.liveStage?.stage, "failed");
  assert.equal(progress.liveStage?.observation, "terminal");
  assert.equal(progress.activity, "terminal");
});

test("liveStage: quiet follow-up is never failure", () => {
  const base = Date.parse(TS);
  const events = [
    { sequence: 1, timestamp: TS, type: "worker.failed" as const },
    {
      sequence: 2,
      timestamp: TS,
      type: "candidate.reverification.started" as const,
    },
  ];
  const progress = buildStatusProgress(
    makeTask("t-quiet-fup", "failed"),
    { sequence: 2, timestamp: TS, type: "candidate.reverification.started", summary: "started" },
    base + 120_000,
    30_000,
    undefined,
    events,
  );
  assert.equal(progress.liveStage?.stage, "candidate-reverifying");
  assert.equal(progress.liveStage?.observation, "quiet");
  assert.equal(progress.liveStage?.meaning, "normal");
  assert.notEqual(progress.liveStage?.stage, "failed");
  assert.notEqual(progress.liveStage?.meaning, "attention");
  assert.equal(progress.activity, "quiet");
});

test("liveStage: intermediate verification events do not close Candidate reverification", () => {
  const base = Date.parse(TS);
  const events = [
    { sequence: 1, timestamp: TS, type: "worker.completed" as const },
    { sequence: 2, timestamp: TS, type: "verification.completed" as const },
    {
      sequence: 3,
      timestamp: new Date(base + 1000).toISOString(),
      type: "candidate.reverification.started" as const,
    },
    {
      sequence: 4,
      timestamp: new Date(base + 2000).toISOString(),
      type: "verification.command.completed" as const,
    },
    {
      sequence: 5,
      timestamp: new Date(base + 3000).toISOString(),
      type: "candidate.revision.captured" as const,
    },
  ];
  const progress = buildStatusProgress(
    makeTask("t-intermediate", "failed"),
    {
      sequence: 5,
      timestamp: events[4]!.timestamp,
      type: "candidate.revision.captured",
      summary: "revised",
    },
    base + 3500,
    30_000,
    undefined,
    events,
  );
  // Intermediate verification/revision events after the start do not close the operation.
  assert.equal(progress.liveStage?.stage, "candidate-reverifying");
  assert.equal(progress.liveStage?.observation, "active");
  assert.equal(progress.liveStage?.evidenceSequence, 5,
    "latest relevant Candidate evidence, not only the start, drives activity");
  assert.equal(progress.liveStage?.observedAt, events[4]!.timestamp);
});

test("liveStage: ordinary terminal Task with no follow-up stays terminal", () => {
  const events = [
    { sequence: 1, timestamp: TS, type: "worker.started" as const },
    { sequence: 2, timestamp: TS, type: "worker.completed" as const },
    { sequence: 3, timestamp: TS, type: "verification.completed" as const },
  ];
  const progress = buildStatusProgress(
    makeTask("t-ordinary", "succeeded"),
    { sequence: 3, timestamp: TS, type: "verification.completed", summary: "passed" },
    Date.parse(TS) + 1000,
    30_000,
    undefined,
    events,
  );
  assert.equal(progress.liveStage?.stage, "completed");
  assert.equal(progress.liveStage?.observation, "terminal");
  assert.equal(progress.activity, "terminal");
});

test("liveStage: latest-only terminal Task without ordered events stays terminal (conservative)", () => {
  // Candidate reverification started: single event, no ordered history.
  const progress = buildStatusProgress(
    makeTask("t-latest-only", "failed"),
    {
      sequence: 4,
      timestamp: TS,
      type: "candidate.reverification.started",
      summary: "started",
    },
    Date.parse(TS) + 1000,
    30_000,
    // No ordered events supplied — latest-only caller.
  );
  assert.notEqual(progress.liveStage?.stage, "candidate-reverifying",
    "latest-only must not invent an open follow-up from a single ambiguous event");
  assert.equal(progress.activity, "terminal");

  // Same for remediation.check.started: cannot prove open without ordered history.
  const progress2 = buildStatusProgress(
    makeTask("t-latest-only-2", "failed"),
    {
      sequence: 4,
      timestamp: TS,
      type: "remediation.check.started",
      summary: "checking",
    },
    Date.parse(TS) + 1000,
    30_000,
  );
  assert.notEqual(progress2.liveStage?.stage, "remediation-checking",
    "latest-only must not invent an open remediation check from a single ambiguous event");
  assert.equal(progress2.activity, "terminal");
});

// --- Canonical Now / History board placement ---

const REPAIRED: RemediationDisposition = {
  status: "verified-repaired-delivered",
  checkId: "check-1",
  createdAt: "2026-07-26T00:00:00.000Z",
};

test("projectBoardPlacement: canonical Now/History truth table", () => {
  // History: durable closed outcomes only.
  assert.deepEqual(projectBoardPlacement({ status: "succeeded", decisionStage: "delivered" }),
    { boardScope: "history", boardReason: "delivered" });
  assert.deepEqual(projectBoardPlacement({ status: "succeeded", decisionStage: "activated" }),
    { boardScope: "history", boardReason: "activated" });
  assert.deepEqual(projectBoardPlacement({ status: "succeeded", decisionStage: "main-rejected" }),
    { boardScope: "history", boardReason: "main-rejected" });
  // Repaired failed delivery: machine status stays failed, but Main-verified
  // repaired delivery is a closed delivered outcome (even at machine-failed).
  assert.deepEqual(
    projectBoardPlacement({ status: "failed", decisionStage: "machine-failed", remediationDisposition: REPAIRED }),
    { boardScope: "history", boardReason: "repaired-delivered" },
  );
  // Repaired delivery wins even when the Decision Stage is unknown (legacy).
  assert.deepEqual(
    projectBoardPlacement({ status: "interrupted", remediationDisposition: REPAIRED }),
    { boardScope: "history", boardReason: "repaired-delivered" },
  );
  // Verified repaired delivery beats an older Main rejection: a later
  // Main-repaired delivery is grouped Delivered, not Stopped.
  assert.deepEqual(
    projectBoardPlacement({ status: "failed", decisionStage: "main-rejected", remediationDisposition: REPAIRED }),
    { boardScope: "history", boardReason: "repaired-delivered" },
  );
  // Delivered/activated Integration stays authoritative over a coexisting
  // repaired-delivery disposition.
  assert.deepEqual(
    projectBoardPlacement({ status: "succeeded", decisionStage: "activated", remediationDisposition: REPAIRED }),
    { boardScope: "history", boardReason: "activated" },
  );
  assert.deepEqual(
    projectBoardPlacement({ status: "succeeded", decisionStage: "delivered", remediationDisposition: REPAIRED }),
    { boardScope: "history", boardReason: "delivered" },
  );
  // Main rejection without a later repair stays Stopped.
  assert.deepEqual(projectBoardPlacement({ status: "succeeded", decisionStage: "main-rejected" }),
    { boardScope: "history", boardReason: "main-rejected" });

  // Now: open work and decisions still waiting.
  assert.deepEqual(projectBoardPlacement({ status: "queued", decisionStage: "queued" }),
    { boardScope: "now", boardReason: "active-work" });
  assert.deepEqual(projectBoardPlacement({ status: "running", decisionStage: "worker-running" }),
    { boardScope: "now", boardReason: "active-work" });
  // Worker passed, Main has not reviewed -> Now, never delivered.
  assert.deepEqual(projectBoardPlacement({ status: "succeeded", decisionStage: "awaiting-main-review" }),
    { boardScope: "now", boardReason: "awaiting-main" });
  // Accepted, waiting for Integration -> Now, never delivered.
  assert.deepEqual(projectBoardPlacement({ status: "succeeded", decisionStage: "ready-for-integration" }),
    { boardScope: "now", boardReason: "integration-pending" });
  assert.deepEqual(projectBoardPlacement({ status: "succeeded", decisionStage: "integrating" }),
    { boardScope: "now", boardReason: "integration-pending" });
  assert.deepEqual(projectBoardPlacement({ status: "succeeded", decisionStage: "applied-not-activated" }),
    { boardScope: "now", boardReason: "integration-pending" });
  assert.deepEqual(projectBoardPlacement({ status: "succeeded", decisionStage: "revision-requested" }),
    { boardScope: "now", boardReason: "revision-requested" });
  assert.deepEqual(projectBoardPlacement({ status: "succeeded", decisionStage: "integration-failed" }),
    { boardScope: "now", boardReason: "unresolved-failure" });
  // Machine failed without repair -> Now (not a final outcome).
  assert.deepEqual(projectBoardPlacement({ status: "failed", decisionStage: "machine-failed" }),
    { boardScope: "now", boardReason: "unresolved-failure" });

  // Legacy / unknown evidence fails open to Now, never History.
  assert.deepEqual(projectBoardPlacement({ status: "succeeded", decisionStage: "unknown" }),
    { boardScope: "now", boardReason: "needs-review" });
  assert.deepEqual(projectBoardPlacement({ status: "succeeded" }),
    { boardScope: "now", boardReason: "needs-review" });
  assert.deepEqual(projectBoardPlacement({ status: "failed" }),
    { boardScope: "now", boardReason: "needs-review" });
  // Machine success alone is never enough for History.
  assert.notEqual(projectBoardPlacement({ status: "succeeded" }).boardScope, "history");
});

test("projectBoardPlacement emits only closed scope/reason codes (no private text)", () => {
  const placement = projectBoardPlacement({
    status: "failed",
    decisionStage: "machine-failed",
    remediationDisposition: {
      status: "verified-repaired-delivered",
      checkId: "check-private",
      createdAt: "2026-07-26T00:00:00.000Z",
      acceptanceBasis: "amended-acceptance",
      amendedCommandCount: 1,
      reasonCode: "contradictory-acceptance",
    },
  });
  assert.ok(BOARD_SCOPE_VALUES.includes(placement.boardScope));
  assert.ok(BOARD_REASON_VALUES.includes(placement.boardReason));
  const json = JSON.stringify(placement);
  // The placement codes carry no private remediation fields or command text.
  assert.ok(!json.includes("check-private"));
  assert.ok(!json.includes("amended"));
  assert.ok(!json.includes("contradictory"));
  assert.ok(!json.includes("command"));
});

test("isLegalBoardPlacement accepts legal pairs and rejects contradictory tokens", () => {
  // Legal history pairs.
  for (const reason of BOARD_REASON_BY_SCOPE.history) {
    assert.equal(isLegalBoardPlacement("history", reason), true,
      `history + ${reason} is a legal pair`);
  }
  // Legal now pairs.
  for (const reason of BOARD_REASON_BY_SCOPE.now) {
    assert.equal(isLegalBoardPlacement("now", reason), true,
      `now + ${reason} is a legal pair`);
  }
  // Contradictory but individually valid tokens are rejected.
  assert.equal(isLegalBoardPlacement("history", "active-work"), false,
    "active-work is not a history reason");
  assert.equal(isLegalBoardPlacement("history", "awaiting-main"), false);
  assert.equal(isLegalBoardPlacement("history", "needs-review"), false);
  assert.equal(isLegalBoardPlacement("now", "delivered"), false,
    "delivered is not a now reason");
  assert.equal(isLegalBoardPlacement("now", "repaired-delivered"), false);
  assert.equal(isLegalBoardPlacement("now", "main-rejected"), false);
  // Unknown / malformed tokens fail closed.
  assert.equal(isLegalBoardPlacement("history", "INJECTED-PRIVATE-TEXT"), false);
  assert.equal(isLegalBoardPlacement("archive", "delivered"), false);
  assert.equal(isLegalBoardPlacement(undefined, "delivered"), false);
  assert.equal(isLegalBoardPlacement("history", undefined), false);
  assert.equal(isLegalBoardPlacement(null, null), false);
});

test("listTaskSurfaces carries canonical boardScope/boardReason codes", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-board-scope-"));
  const store = new StateStore(home);
  // Repaired failed delivery -> History / repaired-delivered (machine failed).
  const repaired = makeTask("66666666-6666-4666-8666-666666666666", "failed");
  store.createTask(repaired);
  store.addEvent(repaired.id, "attempt-1", "worker.failed", "failed", { failureCategory: "runtime" });
  store.saveRemediationDisposition(repaired.id, REPAIRED);
  // Worker passed, awaiting Main -> Now / awaiting-main (not delivered).
  const review = makeTask("77777777-7777-4777-8777-777777777777", "succeeded");
  store.createTask(review);
  store.addEvent(review.id, "attempt-1", "verification.completed", "passed", {
    passed: true,
    behaviorPassed: true,
    policyPassed: true,
    sourceCompatible: true,
    commands: [],
    diffPath: "/state/review/diff.patch",
    sourceUnchanged: false,
  });
  // Legacy succeeded task with no verification evidence -> Now / needs-review.
  const legacy = makeTask("88888888-8888-4888-8888-888888888888", "succeeded");
  store.createTask(legacy);
  store.addEvent(legacy.id, undefined, "task.created", "queued");

  const coordinator = new DaemonCoordinator(store, new SettingsService(store));
  const surfaces = coordinator.listTaskSurfaces(undefined, 10);

  const rep = surfaces.find((s) => s.taskId === repaired.id)!;
  assert.equal(rep.boardScope, "history");
  assert.equal(rep.boardReason, "repaired-delivered");
  assert.equal(rep.status, "failed", "machine failure preserved on the surface");
  assert.ok(BOARD_SCOPE_VALUES.includes(rep.boardScope!));
  assert.ok(BOARD_REASON_VALUES.includes(rep.boardReason!));

  const rev = surfaces.find((s) => s.taskId === review.id)!;
  assert.equal(rev.boardScope, "now");
  assert.equal(rev.boardReason, "awaiting-main");
  assert.equal(rev.status, "succeeded", "machine success preserved");
  assert.notEqual(rev.boardScope, "history", "machine success awaiting Main is not delivered history");

  const leg = surfaces.find((s) => s.taskId === legacy.id)!;
  assert.equal(leg.boardScope, "now");
  assert.equal(leg.boardReason, "needs-review");
  store.close();
});

test("buildTaskSummary always carries boardScope/boardReason and fails open to Now", () => {
  // Legacy caller that omits Decision evidence still gets a Now placement.
  const summary = projectTaskSurface(makeTask("t-legacy-board", "succeeded"), {});
  assert.equal(summary.boardScope, "now");
  assert.equal(summary.boardReason, "needs-review");
  assert.ok(BOARD_SCOPE_VALUES.includes(summary.boardScope!));
  assert.ok(BOARD_REASON_VALUES.includes(summary.boardReason!));
});

// --- Durable History paging (read-only, deterministic, privacy-safe) ---

function historySummary(
  id: string,
  updatedAt: string,
  boardScope: "now" | "history",
  boardReason: BoardReason,
  overrides: Partial<SafeTaskSummary> = {},
): SafeTaskSummary {
  return {
    taskId: id,
    name: "history-task",
    status: "succeeded",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    runtime: "claude-code",
    sourcePath: "/private/source",
    workspacePath: "/private/workspace",
    sessionId: "private-session",
    createdAt: "2026-07-25T11:00:00.000Z",
    updatedAt,
    boardScope,
    boardReason,
    ...overrides,
  } as SafeTaskSummary;
}

test("paginateTaskHistory keeps only canonical History and excludes machine-terminal Tasks still awaiting Main", () => {
  const delivered = historySummary("h-1", "2026-07-30T10:00:00.000Z", "history", "delivered");
  const repaired = historySummary("h-2", "2026-07-30T09:00:00.000Z", "history", "repaired-delivered",
    { status: "failed", name: "glm-repaired" });
  // Machine success awaiting Main: Now, never History.
  const awaitingMain = historySummary("n-1", "2026-07-30T11:00:00.000Z", "now", "awaiting-main",
    { name: "deepseek-review" });
  // Contradictory but individually valid tokens: rejected by the legal-pair check.
  const contradictory = historySummary("x-1", "2026-07-30T12:00:00.000Z", "history", "awaiting-main");
  const page = paginateTaskHistory([delivered, repaired, awaitingMain, contradictory]);
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0]!.taskId, "h-1");
  assert.equal(page.items[1]!.taskId, "h-2");
  assert.equal(page.totalCount, 2);
  assert.equal(page.hasMore, false);
  assert.equal(page.nextCursor, undefined);
  // Machine-terminal Tasks awaiting Main never appear in History.
  const ids = page.items.map((s) => s.taskId);
  assert.ok(!ids.includes("n-1"));
  assert.ok(!ids.includes("x-1"));
});

test("paginateTaskHistory orders newest updatedAt first with taskId as the tie-breaker", () => {
  const sameTs = "2026-07-30T10:00:00.000Z";
  const a = historySummary("aaa", sameTs, "history", "delivered");
  const b = historySummary("bbb", sameTs, "history", "delivered");
  const c = historySummary("ccc", sameTs, "history", "delivered");
  const older = historySummary("zzz", "2026-07-29T10:00:00.000Z", "history", "delivered");
  const page = paginateTaskHistory([older, c, a, b], { limit: 10 });
  // Equal timestamps: taskId DESC tie-breaker (ccc, bbb, aaa), then older.
  assert.deepEqual(page.items.map((s) => s.taskId), ["ccc", "bbb", "aaa", "zzz"]);
});

test("paginateTaskHistory pages equal timestamps without duplication or omission", () => {
  const sameTs = "2026-07-30T10:00:00.000Z";
  const summaries: SafeTaskSummary[] = [];
  // 12 tasks share the same timestamp; ids are ordered a..l so the DESC
  // tie-breaker is stable (t-l first ... t-a last).
  for (const letter of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"]) {
    summaries.push(historySummary(`t-${letter}`, sameTs, "history", "delivered"));
  }
  const first = paginateTaskHistory(summaries, { limit: 10 });
  assert.equal(first.items.length, 10);
  assert.equal(first.hasMore, true);
  assert.ok(first.nextCursor);
  const firstCursor = first.nextCursor;
  assert.equal(first.totalCount, 12);
  // Page 1 is the first 10 in DESC id order: t-l ... t-c. The cursor binds
  // t-c as the continuation point.
  assert.equal(first.items[first.items.length - 1]!.taskId, "t-c");
  // Second page continues strictly after t-c: t-b, t-a (DESC id order).
  const second = paginateTaskHistory(summaries, { limit: 10, cursor: firstCursor });
  assert.equal(second.items.length, 2);
  assert.deepEqual(second.items.map((s) => s.taskId), ["t-b", "t-a"]);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextCursor, undefined);
  const seen = new Set([...first.items, ...second.items].map((s) => s.taskId));
  assert.equal(seen.size, 12, "no duplication across pages and no omission");
});

test("paginateTaskHistory: a newer Task inserted between page requests does not duplicate", () => {
  const baseTs = "2026-07-30T10:00:00.000Z";
  const summaries: SafeTaskSummary[] = [];
  for (const letter of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"]) {
    summaries.push(historySummary(`t-${letter}`, baseTs, "history", "delivered"));
  }
  const first = paginateTaskHistory(summaries, { limit: 10 });
  assert.equal(first.items.length, 10);
  assert.ok(first.nextCursor);
  const insertionCursor = first.nextCursor;
  // A newer Task is inserted after page 1 was loaded. It has a newer updatedAt
  // so it precedes every page-1 item in DESC order; the cursor filters it out.
  const withInsertion = [
    historySummary("t-new", "2026-07-31T10:00:00.000Z", "history", "delivered"),
    ...summaries,
  ];
  const second = paginateTaskHistory(withInsertion, { limit: 10, cursor: insertionCursor });
  // The continuation still returns exactly the two older remaining tasks; the
  // newer Task is not duplicated into page 2.
  assert.deepEqual(second.items.map((s) => s.taskId), ["t-b", "t-a"]);
  assert.ok(!second.items.some((s) => s.taskId === "t-new"));
});

test("paginateTaskHistory: a cursor issued for one query is rejected with a different query", () => {
  const summaries = [
    historySummary("glm-1", "2026-07-30T10:00:00.000Z", "history", "delivered",
      { provider: "glm", model: "glm-4.6" }),
    historySummary("deepseek-1", "2026-07-29T10:00:00.000Z", "history", "delivered",
      { provider: "deepseek", model: "deepseek-v4-flash" }),
  ];
  const first = paginateTaskHistory(summaries, { limit: 10, query: "glm" });
  assert.equal(first.items.length, 1);
  assert.equal(first.nextCursor, undefined, "single match has no next cursor");
  // Build a cursor from a larger set so a continuation exists, then reuse it
  // with a different query.
  const many: SafeTaskSummary[] = [];
  for (let i = 0; i < 12; i += 1) {
    many.push(historySummary(`glm-${i}`, "2026-07-30T10:00:00.000Z", "history", "delivered",
      { provider: "glm" }));
  }
  const pageOne = paginateTaskHistory(many, { limit: 10, query: "glm" });
  assert.ok(pageOne.nextCursor);
  const glmCursor = pageOne.nextCursor;
  assert.throws(
    () => paginateTaskHistory(many, { limit: 10, query: "deepseek", cursor: glmCursor }),
    new RegExp(HISTORY_INVALID_REQUEST_REASON),
  );
  // Same query with different casing is allowed (case-insensitive binding).
  const continued = paginateTaskHistory(many, { limit: 10, query: "GLM", cursor: glmCursor });
  assert.equal(continued.items.length, 2);
});

test("paginateTaskHistory rejects malformed cursors and out-of-range requests with a fixed reason", () => {
  const summaries = [historySummary("h-1", "2026-07-30T10:00:00.000Z", "history", "delivered")];
  // Malformed cursor (not valid base64url JSON).
  assert.throws(
    () => paginateTaskHistory(summaries, { cursor: "!!!not-a-cursor!!!" }),
    new RegExp(HISTORY_INVALID_REQUEST_REASON),
  );
  // Tampered cursor: valid JSON but missing required fields.
  const tampered = Buffer.from(JSON.stringify({ v: 1, ts: "x" }), "utf8").toString("base64url");
  assert.throws(
    () => paginateTaskHistory(summaries, { cursor: tampered }),
    new RegExp(HISTORY_INVALID_REQUEST_REASON),
  );
  // A structurally valid cursor that was not issued from a matching record is
  // also rejected instead of restarting or skipping to an arbitrary point.
  const forged = Buffer.from(JSON.stringify({
    v: 1,
    ts: "2099-01-01T00:00:00.000Z",
    id: "not-an-anchor",
    q: "",
  }), "utf8").toString("base64url");
  assert.throws(
    () => paginateTaskHistory(summaries, { cursor: forged }),
    new RegExp(HISTORY_INVALID_REQUEST_REASON),
  );
  // Out-of-range limit.
  assert.throws(
    () => paginateTaskHistory(summaries, { limit: HISTORY_MIN_LIMIT - 1 }),
    new RegExp(HISTORY_INVALID_REQUEST_REASON),
  );
  assert.throws(
    () => paginateTaskHistory(summaries, { limit: HISTORY_MAX_LIMIT + 1 }),
    new RegExp(HISTORY_INVALID_REQUEST_REASON),
  );
  assert.throws(
    () => paginateTaskHistory(summaries, { limit: 25.5 }),
    new RegExp(HISTORY_INVALID_REQUEST_REASON),
  );
  // Over-length query.
  assert.throws(
    () => paginateTaskHistory(summaries, { query: "x".repeat(HISTORY_MAX_QUERY_LENGTH + 1) }),
    new RegExp(HISTORY_INVALID_REQUEST_REASON),
  );
  // Default limit is in range and accepted.
  const page = paginateTaskHistory(summaries);
  assert.equal(page.items.length, 1);
  assert.equal(HISTORY_DEFAULT_LIMIT, 25);
});

test("paginateTaskHistory search is case-insensitive and limited to safe summary facts", () => {
  const summaries = [
    historySummary("name-1", "2026-07-30T10:00:00.000Z", "history", "delivered",
      { name: "Checkout Refactor" }),
    historySummary("prov-1", "2026-07-30T09:00:00.000Z", "history", "delivered",
      { provider: "minimax", name: "other" }),
    historySummary("model-1", "2026-07-30T08:00:00.000Z", "history", "delivered",
      { model: "grok-4-fast", name: "other" }),
    historySummary("runtime-1", "2026-07-30T07:00:00.000Z", "history", "delivered",
      { runtime: "grok-build", name: "other" }),
    historySummary("status-1", "2026-07-30T06:00:00.000Z", "history", "main-rejected",
      { status: "failed", name: "other" }),
  ];
  // Case-insensitive match on name, provider, model, runtime, status.
  assert.equal(paginateTaskHistory(summaries, { query: "CHECKOUT" }).items.length, 1);
  assert.equal(paginateTaskHistory(summaries, { query: "MiniMax" }).items.length, 1);
  assert.equal(paginateTaskHistory(summaries, { query: "grok-4-fast" }).items.length, 1);
  assert.equal(paginateTaskHistory(summaries, { query: "grok-build" }).items.length, 1);
  assert.equal(paginateTaskHistory(summaries, { query: "failed" }).items.length, 1);
  // Safe fields only: searching a private sessionId or path finds nothing.
  assert.equal(paginateTaskHistory(summaries, { query: "private-session" }).items.length, 0);
  assert.equal(paginateTaskHistory(summaries, { query: "/private/source" }).items.length, 0);
  // normalizeHistoryQuery trims and lowercases.
  assert.equal(normalizeHistoryQuery("  GLM  "), "glm");
  assert.equal(normalizeHistoryQuery(undefined), "");
});

test("paginateTaskHistory: nextCursor is present only when more matching records exist", () => {
  const summaries: SafeTaskSummary[] = [];
  for (let i = 0; i < 30; i += 1) {
    summaries.push(historySummary(`t-${i}`, "2026-07-30T10:00:00.000Z", "history", "delivered"));
  }
  const first = paginateTaskHistory(summaries, { limit: 25 });
  assert.equal(first.items.length, 25);
  assert.equal(first.hasMore, true);
  assert.ok(first.nextCursor);
  const moreCursor = first.nextCursor;
  const second = paginateTaskHistory(summaries, { limit: 25, cursor: moreCursor });
  assert.equal(second.items.length, 5);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextCursor, undefined);
  // totalCount is the full match count, not the page size.
  assert.equal(first.totalCount, 30);
  assert.equal(second.totalCount, 30);
});

// --- Attention resolution (handled attention) ---

const RESOLVED_STATE = {
  status: "resolved" as const,
  reason: "environment-recovered" as const,
  note: "env fixed by recovery",
  resolvedAt: TS,
  eventSequence: 9,
};
const REOPENED_STATE = {
  status: "reopened" as const,
  note: "needs attention again",
  reopenedAt: TS,
  eventSequence: 10,
};

test("projectBoardPlacement: resolved failure closes to History attention-resolved", () => {
  assert.deepEqual(
    projectBoardPlacement({ status: "failed", decisionStage: "machine-failed", attentionResolution: RESOLVED_STATE }),
    { boardScope: "history", boardReason: "attention-resolved" },
  );
  assert.deepEqual(
    projectBoardPlacement({ status: "interrupted", decisionStage: "machine-failed", attentionResolution: RESOLVED_STATE }),
    { boardScope: "history", boardReason: "attention-resolved" },
  );
  // Reopened returns the unchanged failed Task to Now / unresolved-failure.
  assert.deepEqual(
    projectBoardPlacement({ status: "failed", decisionStage: "machine-failed", attentionResolution: REOPENED_STATE }),
    { boardScope: "now", boardReason: "unresolved-failure" },
  );
  // Unknown/malformed resolution evidence fails open to Now.
  assert.deepEqual(
    projectBoardPlacement({ status: "failed", decisionStage: "machine-failed", attentionResolution: { status: "none" } }),
    { boardScope: "now", boardReason: "unresolved-failure" },
  );
  // Delivered/activated Integration stays authoritative over a resolution.
  assert.deepEqual(
    projectBoardPlacement({ status: "succeeded", decisionStage: "delivered", attentionResolution: RESOLVED_STATE }),
    { boardScope: "history", boardReason: "delivered" },
  );
  // Repaired delivery stays authoritative over a resolution.
  assert.deepEqual(
    projectBoardPlacement({ status: "failed", decisionStage: "machine-failed", remediationDisposition: REPAIRED, attentionResolution: RESOLVED_STATE }),
    { boardScope: "history", boardReason: "repaired-delivered" },
  );
});

test("isLegalBoardPlacement accepts attention-resolved only as a history reason", () => {
  assert.equal(isLegalBoardPlacement("history", "attention-resolved"), true);
  assert.equal(isLegalBoardPlacement("now", "attention-resolved"), false);
  assert.ok(BOARD_REASON_VALUES.includes("attention-resolved"));
  assert.ok(BOARD_REASON_BY_SCOPE.history.includes("attention-resolved"));
});

test("latestTaskResolutionState reads the latest valid resolution over durable events", () => {
  const resolveEvent = {
    type: "task.resolution.completed",
    sequence: 5,
    payload: { kind: "resolve", reason: "superseded", note: "handled by successor", resolvedAt: TS },
  };
  assert.deepEqual(latestTaskResolutionState([resolveEvent]), {
    status: "resolved",
    reason: "superseded",
    note: "handled by successor",
    resolvedAt: TS,
    eventSequence: 5,
  });
  // Malformed resolve payload is skipped -> fails open to none.
  assert.deepEqual(
    latestTaskResolutionState([{ type: "task.resolution.completed", sequence: 5, payload: { kind: "resolve" } }]),
    { status: "none" },
  );
  // Unknown event type is ignored.
  assert.deepEqual(
    latestTaskResolutionState([{ type: "worker.failed", sequence: 1, payload: {} }]),
    { status: "none" },
  );
  // Reopen after resolve -> reopened.
  assert.deepEqual(latestTaskResolutionState([
    resolveEvent,
    { type: "task.resolution.reopened", sequence: 6, payload: { kind: "reopen", note: "needs work", reopenedAt: TS } },
  ]), { status: "reopened", note: "needs work", reopenedAt: TS, eventSequence: 6 });
  // Resolve after reopen -> resolved again.
  assert.deepEqual(latestTaskResolutionState([
    resolveEvent,
    { type: "task.resolution.reopened", sequence: 6, payload: { kind: "reopen", note: "x", reopenedAt: TS } },
    { type: "task.resolution.completed", sequence: 7, payload: { kind: "resolve", reason: "no-longer-needed", note: "obsolete", resolvedAt: TS } },
  ]), { status: "resolved", reason: "no-longer-needed", note: "obsolete", resolvedAt: TS, eventSequence: 7 });
});

test("latestTaskResolutionState carries an optional evidence Task id", () => {
  const state = latestTaskResolutionState([{
    type: "task.resolution.completed",
    sequence: 5,
    payload: { kind: "resolve", reason: "superseded", note: "handled", evidenceTaskId: "11111111-1111-4111-8111-111111111111", resolvedAt: TS },
  }]);
  assert.equal(state.status, "resolved");
  assert.equal((state as { evidenceTaskId?: string }).evidenceTaskId, "11111111-1111-4111-8111-111111111111");
});

test("resolveTaskResolution validates eligibility and appends one immutable event", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-resolve-core-"));
  const store = new StateStore(home);
  const taskId = "99999999-9999-4999-8999-999999999999";
  const failedTask = makeTask(taskId, "failed");
  delete failedTask.currentAttemptId;
  store.createTask(failedTask);
  store.addEvent(taskId, "attempt-1", "worker.failed", "failed", { failureCategory: "runtime" });

  // Missing confirm fails before writing.
  assert.throws(
    () => resolveTaskResolution(
      store,
      taskId,
      {
        reason: "environment-recovered",
        note: "x",
        confirm: false as unknown as true,
        delivered: false,
      },
    ),
    /confirm/,
  );

  // Non-terminal statuses are never eligible.
  store.setTaskStatus(taskId, "queued", {});
  assert.throws(
    () => resolveTaskResolution(store, taskId, {
      reason: "environment-recovered",
      note: "x",
      confirm: true,
      delivered: false,
    }),
    /cannot be resolved from status/,
  );
  store.setTaskStatus(taskId, "failed", {});

  // Invalid target: running Attempt fails before writing.
  const runningAttempt: AttemptRecord = {
    id: "attempt-running",
    taskId,
    ordinal: 1,
    status: "running",
    sessionId: "session",
    rawLogPath: "/log",
    startedAt: TS,
  };
  store.createAttempt(runningAttempt);
  store.updateTask(taskId, { currentAttemptId: "attempt-running" });
  assert.throws(
    () => resolveTaskResolution(store, taskId, {
      reason: "environment-recovered",
      note: "x",
      confirm: true,
      delivered: false,
    }),
    /running Attempt/,
  );
  store.updateTask(taskId, { currentAttemptId: null });

  // Fixture proves no delivered outcome: explicit delivered:false is required.
  const result = resolveTaskResolution(store, taskId, {
    reason: "environment-recovered",
    note: "env fixed",
    confirm: true,
    delivered: false,
  });
  assert.equal(result.existing, false);
  assert.equal(result.state.status, "resolved");
  assert.equal(store.getTask(taskId).status, "failed", "machine status preserved");
  assert.equal(
    store.listEvents(taskId).filter((e) => e.type === "task.resolution.completed").length,
    1,
  );

  // Exact replay is idempotent.
  const replay = resolveTaskResolution(store, taskId, {
    reason: "environment-recovered",
    note: "env fixed",
    confirm: true,
    delivered: false,
  });
  assert.equal(replay.existing, true);
  assert.equal(
    store.listEvents(taskId).filter((e) => e.type === "task.resolution.completed").length,
    1,
    "no duplicate event on exact replay",
  );

  // Conflicting resolve fails closed and preserves the first resolution.
  assert.throws(
    () => resolveTaskResolution(store, taskId, {
      reason: "superseded",
      note: "different",
      confirm: true,
      delivered: false,
    }),
    /already resolved/,
  );
  assert.equal(
    store.listEvents(taskId).filter((e) => e.type === "task.resolution.completed").length,
    1,
  );

  // Reopen restores Now without changing machine status.
  const reopened = reopenTaskResolution(store, taskId, {
    note: "needs attention again",
    confirm: true,
    delivered: false,
  });
  assert.equal(reopened.existing, false);
  assert.equal(reopened.state.status, "reopened");
  assert.equal(store.getTask(taskId).status, "failed");
  assert.equal(store.listEvents(taskId).filter((e) => e.type === "task.resolution.reopened").length, 1);

  // Reopen on a non-resolved Task fails closed.
  assert.throws(
    () => reopenTaskResolution(store, taskId, {
      note: "again",
      confirm: true,
      delivered: false,
    }),
    /already reopened/,
  );
  store.close();
});

test("reopenTaskResolution on a never-resolved Task fails before writing", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-reopen-none-"));
  const store = new StateStore(home);
  const taskId = "88888888-8888-4888-8888-888888888888";
  store.createTask(makeTask(taskId, "failed"));
  assert.throws(
    () => reopenTaskResolution(store, taskId, {
      note: "again",
      confirm: true,
      delivered: false,
    }),
    /not resolved/,
  );
  assert.equal(store.listEvents(taskId).filter((e) => e.type === "task.resolution.reopened").length, 0);
  store.close();
});

test("resolveTaskResolution validates the bounded reason vocabulary", () => {
  assert.deepEqual(TASK_RESOLUTION_REASONS, [
    "environment-recovered",
    "superseded",
    "handled-elsewhere",
    "no-longer-needed",
  ]);
  assert.equal(isTaskResolutionReason("environment-recovered"), true);
  assert.equal(isTaskResolutionReason("auto-fixed"), false);
});

test("coordinator.resolveTask closes a failed Task; reopen restores Now", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-resolve-coord-"));
  const store = new StateStore(home);
  const taskId = "77777777-7777-4777-8777-777777777777";
  const failedTask = makeTask(taskId, "failed");
  delete failedTask.currentAttemptId;
  store.createTask(failedTask);
  store.addEvent(taskId, "attempt-1", "worker.failed", "failed", { failureCategory: "runtime" });
  store.addEvent(taskId, "attempt-1", "verification.completed", "failed", {
    passed: false,
    behaviorPassed: false,
    policyPassed: true,
    sourceCompatible: true,
    commands: [],
    diffPath: "/state/task/diff.patch",
    sourceUnchanged: false,
  });
  const coordinator = new DaemonCoordinator(store, new SettingsService(store));

  const resolved = coordinator.resolveTask(taskId, "environment-recovered", "env fixed", undefined, true);
  assert.equal(resolved.existing, false);
  assert.equal(resolved.state.status, "resolved");
  assert.equal(resolved.boardScope, "history");
  assert.equal(resolved.boardReason, "attention-resolved");
  assert.equal(store.getTask(taskId).status, "failed", "machine status preserved");

  const replay = coordinator.resolveTask(taskId, "environment-recovered", "env fixed", undefined, true);
  assert.equal(replay.existing, true);
  assert.equal(
    store.listEvents(taskId).filter((e) => e.type === "task.resolution.completed").length,
    1,
  );

  assert.throws(
    () => coordinator.resolveTask(taskId, "superseded", "different", undefined, true),
    /already resolved/,
  );

  const reopened = coordinator.reopenTask(taskId, "needs attention again", true);
  assert.equal(reopened.existing, false);
  assert.equal(reopened.state.status, "reopened");
  assert.equal(reopened.boardScope, "now");
  assert.equal(reopened.boardReason, "unresolved-failure");
  assert.equal(store.getTask(taskId).status, "failed");

  // After reopen, resolve again is allowed.
  const resolvedAgain = coordinator.resolveTask(taskId, "no-longer-needed", "obsolete", undefined, true);
  assert.equal(resolvedAgain.existing, false);
  assert.equal(resolvedAgain.state.status, "resolved");
  assert.equal(resolvedAgain.boardScope, "history");
  assert.equal(resolvedAgain.boardReason, "attention-resolved");
  store.close();
});

test("resolveTaskResolution allows a succeeded non-delivered Task; reopen restores Now", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-resolve-succeeded-core-"));
  const store = new StateStore(home);
  const taskId = "11111111-1111-4111-8111-111111111111";
  const succeededTask = makeTask(taskId, "succeeded");
  delete succeededTask.currentAttemptId;
  store.createTask(succeededTask);
  store.addEvent(taskId, "attempt-1", "verification.completed", "passed", {
    passed: true,
    behaviorPassed: true,
    policyPassed: true,
    sourceCompatible: true,
    commands: [],
    diffPath: "/state/task/diff.patch",
    sourceUnchanged: false,
  });

  const result = resolveTaskResolution(store, taskId, {
    reason: "no-longer-needed",
    confirm: true,
    delivered: false,
  });
  assert.equal(result.existing, false);
  assert.equal(result.state.status, "resolved");
  assert.equal(store.getTask(taskId).status, "succeeded", "machine status preserved");
  assert.equal(
    store.listEvents(taskId).filter((e) => e.type === "task.resolution.completed").length,
    1,
  );

  // Exact replay is idempotent.
  const replay = resolveTaskResolution(store, taskId, {
    reason: "no-longer-needed",
    confirm: true,
    delivered: false,
  });
  assert.equal(replay.existing, true);
  assert.equal(
    store.listEvents(taskId).filter((e) => e.type === "task.resolution.completed").length,
    1,
  );

  // Reopen returns the same unresolved succeeded Task to Now.
  const reopened = reopenTaskResolution(store, taskId, {
    confirm: true,
    delivered: false,
  });
  assert.equal(reopened.existing, false);
  assert.equal(reopened.state.status, "reopened");
  assert.equal(store.getTask(taskId).status, "succeeded");
  assert.equal(
    store.listEvents(taskId).filter((e) => e.type === "task.resolution.reopened").length,
    1,
  );

  // Delivered truth still rejects resolve for a succeeded Task.
  assert.throws(
    () => resolveTaskResolution(store, taskId, {
      reason: "no-longer-needed",
      confirm: true,
      delivered: true,
    }),
    /delivered/,
  );
  assert.equal(
    store.listEvents(taskId).filter((e) => e.type === "task.resolution.completed").length,
    1,
    "delivered rejection writes no resolve event",
  );
  store.close();
});

test("projectBoardPlacement: resolved succeeded non-delivered closes to History attention-resolved", () => {
  assert.deepEqual(
    projectBoardPlacement({
      status: "succeeded",
      decisionStage: "awaiting-main-review",
      attentionResolution: RESOLVED_STATE,
    }),
    { boardScope: "history", boardReason: "attention-resolved" },
  );
  assert.deepEqual(
    projectBoardPlacement({
      status: "succeeded",
      decisionStage: "ready-for-integration",
      attentionResolution: RESOLVED_STATE,
    }),
    { boardScope: "history", boardReason: "attention-resolved" },
  );
  // Delivered/activated/verified-repaired stays stronger than resolution.
  assert.deepEqual(
    projectBoardPlacement({
      status: "succeeded",
      decisionStage: "delivered",
      attentionResolution: RESOLVED_STATE,
    }),
    { boardScope: "history", boardReason: "delivered" },
  );
  assert.deepEqual(
    projectBoardPlacement({
      status: "succeeded",
      decisionStage: "activated",
      attentionResolution: RESOLVED_STATE,
    }),
    { boardScope: "history", boardReason: "activated" },
  );
  assert.deepEqual(
    projectBoardPlacement({
      status: "succeeded",
      decisionStage: "machine-verified",
      remediationDisposition: REPAIRED,
      attentionResolution: RESOLVED_STATE,
    }),
    { boardScope: "history", boardReason: "repaired-delivered" },
  );
});

test("coordinator.resolveTask closes a succeeded non-delivered Task; reopen restores Now", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-resolve-coord-succeeded-"));
  const store = new StateStore(home);
  const taskId = "33333333-3333-4333-8333-333333333333";
  const succeededTask = makeTask(taskId, "succeeded");
  delete succeededTask.currentAttemptId;
  store.createTask(succeededTask);
  store.addEvent(taskId, "attempt-1", "verification.completed", "passed", {
    passed: true,
    behaviorPassed: true,
    policyPassed: true,
    sourceCompatible: true,
    commands: [],
    diffPath: "/state/task/diff.patch",
    sourceUnchanged: false,
  });
  const coordinator = new DaemonCoordinator(store, new SettingsService(store));

  const resolved = coordinator.resolveTask(
    taskId,
    "no-longer-needed",
    "historical evidence only",
    undefined,
    true,
  );
  assert.equal(resolved.existing, false);
  assert.equal(resolved.state.status, "resolved");
  assert.equal(resolved.boardScope, "history");
  assert.equal(resolved.boardReason, "attention-resolved");
  assert.equal(store.getTask(taskId).status, "succeeded", "machine status preserved");

  const reopened = coordinator.reopenTask(taskId, "needs review again", true);
  assert.equal(reopened.existing, false);
  assert.equal(reopened.state.status, "reopened");
  assert.equal(reopened.boardScope, "now");
  assert.equal(reopened.boardReason, "awaiting-main");
  assert.equal(store.getTask(taskId).status, "succeeded");
  store.close();
});

test("listTaskSurfaces carries attentionResolution for a resolved succeeded Task", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-resolve-surface-succeeded-"));
  const store = new StateStore(home);
  const taskId = "44444444-4444-4444-8444-444444444444";
  const succeededTask = makeTask(taskId, "succeeded");
  delete succeededTask.currentAttemptId;
  store.createTask(succeededTask);
  store.addEvent(taskId, "attempt-1", "verification.completed", "passed", {
    passed: true,
    behaviorPassed: true,
    policyPassed: true,
    sourceCompatible: true,
    commands: [],
    diffPath: "/state/task/diff.patch",
    sourceUnchanged: false,
  });
  const coordinator = new DaemonCoordinator(store, new SettingsService(store));
  coordinator.resolveTask(taskId, "handled-elsewhere", "no longer needed", undefined, true);

  const surface = coordinator.listTaskSurfaces(["succeeded"], 10)[0]!;
  assert.equal(surface.status, "succeeded");
  assert.equal(surface.attentionResolution?.status, "resolved");
  assert.equal(surface.boardScope, "history");
  assert.equal(surface.boardReason, "attention-resolved");
  store.close();
});

test("resolve/reopen on a succeeded Task leave machine, review, and decision facts unchanged", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-resolve-unchanged-succeeded-"));
  const store = new StateStore(home);
  const taskId = "55555555-5555-4555-8555-555555555555";
  const succeededTask = makeTask(taskId, "succeeded");
  delete succeededTask.currentAttemptId;
  store.createTask(succeededTask);
  store.addEvent(taskId, "attempt-1", "verification.completed", "passed", {
    passed: true,
    behaviorPassed: true,
    policyPassed: true,
    sourceCompatible: true,
    commands: [],
    diffPath: "/state/task/diff.patch",
    sourceUnchanged: false,
  });

  const beforeTask = store.getTask(taskId);
  const beforeEvents = store.listEvents(taskId);

  const coordinator = new DaemonCoordinator(store, new SettingsService(store));
  coordinator.resolveTask(taskId, "environment-recovered", "superseded", undefined, true);
  coordinator.reopenTask(taskId, "needs again", true);

  const afterTask = store.getTask(taskId);
  const afterEvents = store.listEvents(taskId)
    .filter((e) => e.type !== "task.resolution.completed" && e.type !== "task.resolution.reopened");

  assert.equal(afterTask.status, beforeTask.status, "machine status unchanged");
  assert.equal(afterTask.updatedAt, beforeTask.updatedAt, "task updatedAt unchanged");
  assert.deepEqual(afterTask.spec, beforeTask.spec, "spec and routing evidence unchanged");
  assert.equal(afterEvents.length, beforeEvents.length, "non-resolution events preserved");
  for (const event of beforeEvents) {
    const afterEvent = afterEvents.find((candidate) => candidate.id === event.id);
    assert.ok(afterEvent, "each original event retained");
    assert.equal(afterEvent!.type, event.type);
    assert.deepEqual(afterEvent!.payload, event.payload);
  }
  store.close();
});

test("listTaskSurfaces carries attentionResolution and the closed placement", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-resolve-surface-"));
  const store = new StateStore(home);
  const taskId = "66666666-6666-4666-8666-666666666666";
  const failedTask = makeTask(taskId, "failed");
  delete failedTask.currentAttemptId;
  store.createTask(failedTask);
  store.addEvent(taskId, "attempt-1", "worker.failed", "failed", { failureCategory: "runtime" });
  const coordinator = new DaemonCoordinator(store, new SettingsService(store));
  coordinator.resolveTask(taskId, "handled-elsewhere", "dealt with", undefined, true);

  const surface = coordinator.listTaskSurfaces(["failed"], 10)[0]!;
  assert.equal(surface.status, "failed");
  assert.equal(surface.attentionResolution?.status, "resolved");
  assert.equal(surface.boardScope, "history");
  assert.equal(surface.boardReason, "attention-resolved");
  store.close();
});

test("attention resolution never invents success, delivery, or cost facts", async () => {
  const resolved = buildTaskSummary(makeTask("t-res-json", "failed"), undefined, undefined, undefined, "machine-failed", RESOLVED_STATE);
  const json = JSON.stringify(resolved);
  assert.equal(resolved.status, "failed", "machine status preserved");
  assert.equal(resolved.boardScope, "history");
  assert.equal(resolved.boardReason, "attention-resolved");
  assert.ok(!json.includes('"delivered"'), "resolution is not presented as delivered");
  assert.ok(!json.includes('"succeeded"'), "resolution is not presented as succeeded");
  assert.ok(!json.includes("costUsd"), "no cost facts invented");
});

test("projectBoardPlacement: resolution cannot hide non-terminal Tasks in History", () => {
  const forged = RESOLVED_STATE;
  const invalidStatuses = ["queued", "running", "preparing", "verifying", "blocked", "waiting"];
  for (const status of invalidStatuses) {
    const placement = projectBoardPlacement({
      status: status as TaskRecord["status"],
      decisionStage: "machine-failed",
      attentionResolution: forged,
    });
    assert.notEqual(placement.boardScope, "history",
      `${status} must not be hidden in History by resolution evidence`);
  }
  // Succeeded with delivered truth still wins as delivered, not attention-resolved.
  assert.deepEqual(
    projectBoardPlacement({ status: "succeeded", decisionStage: "delivered", attentionResolution: forged }),
    { boardScope: "history", boardReason: "delivered" },
  );
});

test("malformed latest resolution evidence fails open; a later valid event restores", () => {
  const validResolve = {
    type: "task.resolution.completed",
    sequence: 5,
    payload: { kind: "resolve", reason: "superseded", note: "handled", resolvedAt: TS },
  };
  const malformedReopen = {
    type: "task.resolution.reopened",
    sequence: 6,
    payload: { kind: "reopen", reopenedAt: "not-a-date" },
  };
  // The malformed LATEST resolution event must not leave the older resolved
  // event active: the Task fails open to Now.
  assert.deepEqual(latestTaskResolutionState([validResolve, malformedReopen]), { status: "none" });
  // A later valid reopen restores a valid reopened state.
  const validReopen = {
    type: "task.resolution.reopened",
    sequence: 7,
    payload: { kind: "reopen", note: "again", reopenedAt: TS },
  };
  assert.deepEqual(latestTaskResolutionState([validResolve, malformedReopen, validReopen]), {
    status: "reopened",
    note: "again",
    reopenedAt: TS,
    eventSequence: 7,
  });
  // Malformed canonical timestamp on the latest resolve also fails open.
  assert.deepEqual(
    latestTaskResolutionState([{
      type: "task.resolution.completed",
      sequence: 5,
      payload: { kind: "resolve", reason: "superseded", resolvedAt: "garbage" },
    }]),
    { status: "none" },
  );
  // Parseable but non-canonical timestamps (date-only / missing ms) fail open.
  assert.deepEqual(
    latestTaskResolutionState([{
      type: "task.resolution.completed",
      sequence: 5,
      payload: { kind: "resolve", reason: "superseded", resolvedAt: "2026-07-25" },
    }]),
    { status: "none" },
  );
  assert.deepEqual(
    latestTaskResolutionState([{
      type: "task.resolution.reopened",
      sequence: 6,
      payload: { kind: "reopen", reopenedAt: "2026-07-25T12:00:00Z" },
    }]),
    { status: "none" },
  );
});

test("reopen rejects a Task that later gained delivered truth", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-reopen-delivered-"));
  const store = new StateStore(home);
  const taskId = "44444444-4444-4444-8444-444444444444";
  const failedTask = makeTask(taskId, "failed");
  delete failedTask.currentAttemptId;
  store.createTask(failedTask);
  store.addEvent(taskId, "attempt-1", "worker.failed", "failed", { failureCategory: "runtime" });
  // Fixture has no delivered outcome at resolve time.
  resolveTaskResolution(store, taskId, {
    reason: "handled-elsewhere",
    confirm: true,
    delivered: false,
  });
  // Later Main verifies repaired delivery.
  store.saveRemediationDisposition(taskId, REPAIRED);
  // Reopen must fail closed and write no reopen event when caller supplies delivered true.
  assert.throws(
    () => reopenTaskResolution(store, taskId, {
      note: "again",
      confirm: true,
      delivered: true,
    }),
    /delivered/,
  );
  assert.equal(
    store.listEvents(taskId).filter((e) => e.type === "task.resolution.reopened").length,
    0,
  );
  store.close();
});

test("resolve rejects a Task when caller supplies delivered true", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-resolve-delivered-"));
  const store = new StateStore(home);
  const taskId = "55555555-5555-4555-8555-555555555555";
  const failedTask = makeTask(taskId, "failed");
  delete failedTask.currentAttemptId;
  store.createTask(failedTask);
  store.addEvent(taskId, "attempt-1", "worker.failed", "failed", { failureCategory: "runtime" });
  // Delivered-outcome rejection fixture: caller-owned delivered truth is true.
  assert.throws(
    () => resolveTaskResolution(store, taskId, {
      reason: "handled-elsewhere",
      confirm: true,
      delivered: true,
    }),
    /delivered/,
  );
  assert.equal(
    store.listEvents(taskId).filter((e) => e.type === "task.resolution.completed").length,
    0,
    "no resolve event when delivered outcome is present",
  );
  store.close();
});

test("resolve and reopen notes are optional but bounded", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-resolve-note-"));
  const store = new StateStore(home);
  const taskId = "33333333-3333-4333-8333-333333333333";
  const failedTask = makeTask(taskId, "failed");
  delete failedTask.currentAttemptId;
  store.createTask(failedTask);
  store.addEvent(taskId, "attempt-1", "worker.failed", "failed", { failureCategory: "runtime" });

  // Omitted note succeeds and is omitted from the state projection.
  const noNote = resolveTaskResolution(store, taskId, {
    reason: "handled-elsewhere",
    confirm: true,
    delivered: false,
  });
  assert.equal(noNote.existing, false);
  assert.equal(noNote.state.status, "resolved");
  assert.ok(!("note" in noNote.state), "note is omitted when not provided");

  // Exact replay with omitted note is idempotent.
  const replay = resolveTaskResolution(store, taskId, {
    reason: "handled-elsewhere",
    confirm: true,
    delivered: false,
  });
  assert.equal(replay.existing, true);
  assert.equal(
    store.listEvents(taskId).filter((e) => e.type === "task.resolution.completed").length,
    1,
  );

  // Overlong note fails before mutation.
  assert.throws(
    () => resolveTaskResolution(store, taskId, {
      reason: "superseded",
      note: "x".repeat(501),
      confirm: true,
      delivered: false,
    }),
    /at most 500/,
  );

  // Reopen with omitted note succeeds.
  const reopened = reopenTaskResolution(store, taskId, {
    confirm: true,
    delivered: false,
  });
  assert.equal(reopened.existing, false);
  assert.equal(reopened.state.status, "reopened");
  assert.ok(!("note" in reopened.state), "reopen note omitted when not provided");
  store.close();
});

test("delivered truth outranks handled resolution in board placement", () => {
  const resolved = RESOLVED_STATE;
  assert.deepEqual(
    projectBoardPlacement({ status: "failed", decisionStage: "delivered", attentionResolution: resolved }),
    { boardScope: "history", boardReason: "delivered" },
  );
  assert.deepEqual(
    projectBoardPlacement({ status: "failed", decisionStage: "activated", attentionResolution: resolved }),
    { boardScope: "history", boardReason: "activated" },
  );
  assert.deepEqual(
    projectBoardPlacement({
      status: "failed",
      decisionStage: "machine-failed",
      remediationDisposition: REPAIRED,
      attentionResolution: resolved,
    }),
    { boardScope: "history", boardReason: "repaired-delivered" },
  );
});

test("resolve/reopen leave machine, verification, review, delivery, and decision facts unchanged", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-resolve-unchanged-"));
  const store = new StateStore(home);
  const taskId = "22222222-2222-4222-8222-222222222222";
  const failedTask = makeTask(taskId, "failed");
  delete failedTask.currentAttemptId;
  store.createTask(failedTask);
  store.addEvent(taskId, "attempt-1", "worker.failed", "failed", { failureCategory: "runtime" });
  store.addEvent(taskId, "attempt-1", "verification.completed", "failed", {
    passed: false,
    behaviorPassed: false,
    policyPassed: true,
    sourceCompatible: true,
    commands: [],
    diffPath: "/state/task/diff.patch",
    sourceUnchanged: false,
  });

  const before = {
    task: store.getTask(taskId),
    attempts: store.listAttempts(taskId),
    events: store.listEvents(taskId),
    decision: buildTaskDecisionView({
      task: store.getTask(taskId),
      attempts: store.listAttempts(taskId),
      events: store.listEvents(taskId),
      integrationResults: store.listIntegrationResults(taskId),
    }),
  };

  const coordinator = new DaemonCoordinator(store, new SettingsService(store));
  coordinator.resolveTask(taskId, "environment-recovered", "env fixed", undefined, true);
  coordinator.reopenTask(taskId, "needs again", true);

  const afterTask = store.getTask(taskId);
  const afterAttempts = store.listAttempts(taskId);
  const afterEvents = store.listEvents(taskId)
    .filter((e) => e.type !== "task.resolution.completed" && e.type !== "task.resolution.reopened");
  const afterDecision = buildTaskDecisionView({
    task: afterTask,
    attempts: afterAttempts,
    events: afterEvents,
    integrationResults: store.listIntegrationResults(taskId),
  });

  assert.equal(afterTask.status, before.task.status, "machine status unchanged");
  assert.equal(afterTask.error, before.task.error, "error unchanged");
  assert.equal(afterTask.updatedAt, before.task.updatedAt, "task updatedAt unchanged");
  assert.equal(afterTask.currentAttemptId, before.task.currentAttemptId, "currentAttemptId unchanged");
  assert.deepEqual(afterTask.spec, before.task.spec, "spec and routing evidence unchanged");
  assert.deepEqual(afterAttempts, before.attempts, "Attempt records unchanged");
  assert.equal(afterEvents.length, before.events.length, "non-resolution events preserved");
  for (const event of before.events) {
    const afterEvent = afterEvents.find((candidate) => candidate.id === event.id);
    assert.ok(afterEvent, "each original event retained");
    assert.equal(afterEvent!.type, event.type);
    assert.equal(afterEvent!.summary, event.summary);
    assert.deepEqual(afterEvent!.payload, event.payload);
  }
  assert.equal(afterDecision.stage, before.decision.stage, "decision stage unchanged");
  assert.equal(afterDecision.failureCategory, before.decision.failureCategory,
    "failure classification unchanged");
  assert.equal(afterDecision.progress.activity, before.decision.progress.activity,
    "activity unchanged");
  store.close();
});
