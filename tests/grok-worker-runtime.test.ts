/**
 * Focused Grok normalizer + live-stage equivalence tests.
 * Claude-compatible coverage lives in normalize.test.ts / worker-runtime.test.ts;
 * this file proves Grok structured streams project the same live-stage meanings.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildStatusProgress } from "../src/core/task-progress.js";
import type { TaskRecord, TaskStatus } from "../src/core/types.js";
import { GrokEventNormalizer } from "../src/events/grok-normalize.js";
import { ClaudeEventNormalizer } from "../src/events/normalize.js";

const TS = "2026-07-25T12:00:00.000Z";

function makeTask(status: TaskStatus = "running"): TaskRecord {
  return {
    id: "grok-live-stage",
    name: "grok-live",
    status,
    sourcePath: "/source",
    taskFile: "/task.yaml",
    spec: {
      version: 1,
      name: "grok-live",
      project: "/source",
      provider: { name: "xai", model: "grok-4.5", keychainService: "forklight.test" },
      runtime: { name: "grok-build", executable: "grok", effort: "high", maxBudgetUsd: null },
      workspace: { exclude: [] },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
      goal: "live stage",
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
    createdAt: TS,
    updatedAt: TS,
  };
}

test("Grok thought/text normalize to distinct activityKind without requiring prose", () => {
  let clock = 0;
  const n = new GrokEventNormalizer({ clock: () => clock, processingThrottleMs: 15_000 });
  // Grok thought is closed model-processing evidence — no visible output.
  const thought = n.parseLine(JSON.stringify({ type: "thought", data: "SECRET_PATH=/tmp/private" }));
  assert.equal(thought[0]?.type, "worker.message");
  const thoughtPayload = thought[0]?.payload as Record<string, unknown>;
  assert.equal(thoughtPayload.activityKind, "model-processing");
  assert.equal(thoughtPayload.streamType, "thought");
  // Genuine Grok stream deltas are effective progress (unlike Claude thinking_tokens).
  assert.equal(thoughtPayload.activityEvidence, "effective-progress");
  assert.ok(!thought[0]?.summary.includes("SECRET_PATH"));

  // Grok thinking is also model-processing, not model-response.
  clock = 15_000;
  const thinking = n.parseLine(JSON.stringify({ type: "thinking", data: "plan..." }));
  assert.equal((thinking[0]?.payload as Record<string, unknown>).activityKind, "model-processing");
  assert.equal(
    (thinking[0]?.payload as Record<string, unknown>).activityEvidence,
    "effective-progress",
  );

  // Grok text is visible model response — distinct from thought/thinking.
  const text = n.parseLine(JSON.stringify({ type: "text", data: "visible" }));
  assert.equal((text[0]?.payload as Record<string, unknown>).activityKind, "model-response");
  assert.equal(
    (text[0]?.payload as Record<string, unknown>).activityEvidence,
    "effective-progress",
  );

  // Launch/session/keepalive-style records are liveness only.
  const keep = n.parseLine(JSON.stringify({ type: "session", message: "ready" }));
  assert.equal((keep[0]?.payload as Record<string, unknown>).activityEvidence, "liveness");
});

test("Grok processing markers are throttled before durable persistence", () => {
  let clock = 0;
  const n = new GrokEventNormalizer({ clock: () => clock, processingThrottleMs: 15_000 });
  assert.equal(n.parseLine(JSON.stringify({ type: "thought", data: "private one" })).length, 1);
  clock = 14_999;
  assert.deepEqual(n.parseLine(JSON.stringify({ type: "thinking", data: "private two" })), []);
  clock = 15_000;
  const next = n.parseLine(JSON.stringify({ type: "thought", data: "private three" }));
  assert.equal(next.length, 1);
  assert.equal(next[0]?.summary, "Model is actively processing");
  assert.ok(!JSON.stringify(next).includes("private three"));
});

test("Grok and Claude stages distinguish processing from visible output in live-stage replay", () => {
  const grok = new GrokEventNormalizer();
  const claude = new ClaudeEventNormalizer();
  const nowMs = Date.parse(TS) + 5_000;

  // Grok thought is model-processing; Claude text is model-response.
  const grokProcessing = grok.parseLine(JSON.stringify({ type: "thought", data: "plan" }));
  const claudeResponse = claude.parseLine(JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "plan" }] },
  }));
  // Activity kinds differ by design — Grok thought is processing, Claude text is visible response.
  assert.equal(
    (grokProcessing[0]?.payload as { activityKind?: string }).activityKind,
    "model-processing",
  );
  assert.equal(
    (claudeResponse[0]?.payload as { activityKind?: string }).activityKind,
    "model-response",
  );

  // Both project distinct live stages from the same initial Worker start.
  const grokEvents = [
    { sequence: 1, timestamp: TS, type: "worker.started" as const },
    {
      sequence: 2,
      timestamp: TS,
      type: grokProcessing[0]!.type,
      payload: grokProcessing[0]!.payload,
    },
  ];
  const claudeEvents = [
    { sequence: 1, timestamp: TS, type: "worker.started" as const },
    {
      sequence: 2,
      timestamp: TS,
      type: claudeResponse[0]!.type,
      payload: claudeResponse[0]!.payload,
    },
  ];
  const grokProgress = buildStatusProgress(
    makeTask("running"),
    { sequence: 2, timestamp: TS, type: "worker.message", summary: "thinking" },
    nowMs, 30_000, undefined, grokEvents,
  );
  const claudeProgress = buildStatusProgress(
    makeTask("running"),
    { sequence: 2, timestamp: TS, type: "worker.message", summary: "plan" },
    nowMs, 30_000, undefined, claudeEvents,
  );
  assert.equal(grokProgress.liveStage?.stage, "model-processing", "Grok thought is processing");
  assert.equal(claudeProgress.liveStage?.stage, "model-responding", "Claude text is visible response");
  assert.equal(grokProgress.liveStage?.meaning, "normal");
  assert.equal(claudeProgress.liveStage?.meaning, "normal");

  // Both are superseded by tool lifecycle identically.
  const grokToolEvents = [
    ...grokEvents,
    {
      sequence: 3,
      timestamp: TS,
      type: grok.parseLine(JSON.stringify({ type: "tool_start", tool: "read_file" }))[0]!.type,
      payload: grok.parseLine(JSON.stringify({ type: "tool_start", tool: "read_file" }))[0]!.payload,
    },
  ];
  const claudeTool = claude.parseLine(JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "a.ts" } }],
    },
  }));
  const claudeToolEvents = [
    ...claudeEvents,
    {
      sequence: 3,
      timestamp: TS,
      type: claudeTool[0]!.type,
      payload: claudeTool[0]!.payload,
    },
  ];

  const grokToolProgress = buildStatusProgress(
    makeTask("running"),
    { sequence: 3, timestamp: TS, type: "worker.tool.started", summary: "tool" },
    nowMs, 30_000, undefined, grokToolEvents,
  );
  const claudeToolProgress = buildStatusProgress(
    makeTask("running"),
    { sequence: 3, timestamp: TS, type: "worker.tool.started", summary: "tool" },
    nowMs, 30_000, undefined, claudeToolEvents,
  );
  assert.equal(grokToolProgress.liveStage?.stage, "using-tool");
  assert.equal(claudeToolProgress.liveStage?.stage, "using-tool");
  assert.equal(grokToolProgress.liveStage?.meaning, claudeToolProgress.liveStage?.meaning);
  assert.equal(grokToolProgress.liveStage?.next, claudeToolProgress.liveStage?.next);

  // Completing the Grok tool returns to waiting-for-model — same as Claude.
  const grokDone = buildStatusProgress(
    makeTask("running"),
    { sequence: 4, timestamp: TS, type: "worker.tool.completed", summary: "done" },
    nowMs, 30_000, undefined,
    [
      ...grokToolEvents,
      {
        sequence: 4,
        timestamp: TS,
        type: "worker.tool.completed" as const,
        payload: { tool: "read_file" },
      },
    ],
  );
  assert.equal(grokDone.liveStage?.stage, "waiting-for-model");
});

test("Grok liveStage projection never embeds stream prose or secrets", () => {
  const n = new GrokEventNormalizer();
  const secret = "sk-live-secret-value";
  const thought = n.parseLine(JSON.stringify({
    type: "thought",
    data: `using credential ${secret} at https://evil.example/hook`,
  }));
  const progress = buildStatusProgress(
    makeTask("running"),
    { sequence: 2, timestamp: TS, type: "worker.message", summary: thought[0]!.summary },
    Date.parse(TS) + 1_000,
    30_000,
    undefined,
    [
      { sequence: 1, timestamp: TS, type: "worker.started" },
      {
        sequence: 2,
        timestamp: TS,
        type: thought[0]!.type,
        payload: thought[0]!.payload,
      },
    ],
  );
  assert.equal(progress.liveStage?.stage, "model-processing");
  const json = JSON.stringify(progress.liveStage);
  assert.ok(!json.includes(secret));
  assert.ok(!json.includes("evil.example"));
  assert.ok(!json.includes("credential"));
});
