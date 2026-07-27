import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { projectTaskSurface } from "../src/core/task-summary.js";
import {
  failureCategoryForTask,
  failureCategoryFromEvents,
} from "../src/core/worker-failure.js";
import { buildTaskDecisionView } from "../src/core/task-decision-view.js";
import { buildStatusProgress } from "../src/core/task-progress.js";
import type { AttemptRecord, EventRecord, TaskRecord, TaskStatus } from "../src/core/types.js";
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
