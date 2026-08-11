import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStatusProgress,
  classifyActivity,
  projectLiveStage,
  type LiveStageEventEvidence,
} from "../src/core/task-progress.js";
import type { TaskRecord } from "../src/core/types.js";

const now = "2026-08-09T00:00:00.000Z";

function task(status: TaskRecord["status"]): TaskRecord {
  return {
    id: "task-1",
    name: "Progress fixture",
    status,
    sourcePath: "/source",
    taskFile: "/task.yaml",
    spec: {
      version: 1,
      name: "Progress fixture",
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

function ev(sequence: number, type: string, payload?: unknown): LiveStageEventEvidence {
  return {
    sequence,
    timestamp: now,
    type,
    ...(payload === undefined ? {} : { payload }),
  };
}

test("projectLiveStage prefers verification evidence once verification started", () => {
  const events = [
    ev(1, "worker.started"),
    ev(2, "worker.tool.started", { toolUseId: "t1", tool: "Edit" }),
    ev(3, "verification.started"),
  ];
  const live = projectLiveStage(task("running"), events, Date.parse(now) + 1_000);
  assert.equal(live.stage, "verifying");
  assert.equal(live.evidence, "verification");
  assert.equal(live.next, "wait-for-verification-result");
});

test("projectLiveStage keeps worker lifecycle while running", () => {
  const events = [
    ev(1, "worker.started"),
    ev(2, "worker.message", { activityKind: "model-response" }),
    ev(3, "worker.tool.started", { toolUseId: "t1", tool: "Edit" }),
  ];
  const live = projectLiveStage(task("running"), events, Date.parse(now) + 1_000);
  assert.equal(live.stage, "using-tool");
  assert.equal(live.evidence, "tool-lifecycle");
});

test("projectLiveStage maps terminal status to failed with policy evidence", () => {
  const events = [ev(1, "policy.duration.exceeded")];
  const live = projectLiveStage(task("failed"), events, Date.parse(now) + 1_000);
  assert.equal(live.stage, "failed");
  assert.equal(live.evidence, "policy");
  assert.equal(live.meaning, "attention");
  assert.equal(live.next, "inspect-failure");
});

test("repair lineage events never invent a stage without other evidence", () => {
  // A validation-repair marker alone is not worker lifecycle evidence; the
  // projection must not claim an implementation or verification stage.
  const events = [ev(1, "worker.validation-repair.authorized")];
  const live = projectLiveStage(task("running"), events, Date.parse(now) + 1_000);
  assert.equal(live.stage, "legacy-running");
  assert.equal(live.evidence, "legacy");
});

test("classifyActivity uses latest-event age, not frozen updatedAt", () => {
  const stale = classifyActivity(
    task("running"),
    { sequence: 1, timestamp: "2026-08-09T00:00:00.000Z", type: "worker.message", summary: "" },
    Date.parse("2026-08-09T00:05:00.000Z"),
    30_000,
  );
  assert.equal(stale, "quiet");
  const fresh = classifyActivity(
    task("running"),
    { sequence: 1, timestamp: "2026-08-09T00:00:10.000Z", type: "worker.message", summary: "" },
    Date.parse("2026-08-09T00:00:20.000Z"),
    30_000,
  );
  assert.equal(fresh, "active");
});

test("buildStatusProgress returns liveStage and dual clocks for list surfaces", () => {
  const events = [
    ev(1, "worker.started"),
    ev(2, "worker.message", { activityKind: "model-response" }),
  ];
  const progress = buildStatusProgress(
    task("running"),
    { sequence: 2, timestamp: now, type: "worker.message", summary: "" },
    Date.parse(now) + 1_000,
    30_000,
    undefined,
    events,
  );
  assert.equal(progress.activity, "active");
  assert.ok(progress.liveStage);
  assert.equal(progress.liveStage?.stage, "model-responding");
  assert.ok(progress.dualClock);
  assert.equal(progress.latestEventSequence, 2);
});
