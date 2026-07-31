import assert from "node:assert/strict";
import test from "node:test";
import { ClaudeEventNormalizer } from "../src/events/normalize.js";
import { resolveWorkerFailure } from "../src/workers/claude.js";

test("labels successful Worker terminal text as an unverified claim", () => {
  const normalizer = new ClaudeEventNormalizer();
  const events = normalizer.parseLine(JSON.stringify({
    type: "result",
    is_error: false,
    result: "All tests pass and 3 files changed",
  }));

  const payload = events[0]?.payload as Record<string, unknown> | undefined;
  assert.equal(events[0]?.type, "worker.completed");
  assert.deepEqual(payload?.claim, {
    label: "unverified-claim",
    text: "All tests pass and 3 files changed",
  });
  assert.equal("result" in (payload ?? {}), false);
  assert.equal(events[0]?.terminal?.resultText, "All tests pass and 3 files changed");
});

test("normalizes tool lifecycle and terminal result without token noise", () => {
  const normalizer = new ClaudeEventNormalizer();
  assert.deepEqual(normalizer.parseLine(JSON.stringify({ type: "stream_event" })), []);

  const started = normalizer.parseLine(
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Read",
            input: { file_path: "/tmp/project/app.ts" },
          },
        ],
      },
    }),
  );
  assert.equal(started[0]?.type, "worker.tool.started");
  assert.match(started[0]?.summary ?? "", /Read.*app\.ts/);

  const modelText = normalizer.parseLine(
    JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "I will inspect the file next." }],
      },
    }),
  );
  assert.equal(modelText[0]?.type, "worker.message");
  assert.equal(
    (modelText[0]?.payload as { activityKind?: string } | undefined)?.activityKind,
    "model-response",
    "Claude text blocks emit structured model-activity for live-stage",
  );
  // Stage classification must not need the prose content.
  assert.ok(modelText[0]?.summary);
  assert.equal(
    typeof (modelText[0]?.payload as { activityKind?: string }).activityKind,
    "string",
  );

  const completed = normalizer.parseLine(
    JSON.stringify({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "tool-1", content: "ok" }],
      },
    }),
  );
  assert.equal(completed[0]?.type, "worker.tool.completed");

  const terminal = normalizer.parseLine(
    JSON.stringify({
      type: "result",
      is_error: false,
      result: "done",
      total_cost_usd: 0.01,
      num_turns: 3,
    }),
  );
  assert.equal(terminal[0]?.terminal?.isError, false);
  assert.equal(terminal[0]?.terminal?.costUsd, 0.01);
});

test("persists complete terminal usage with model breakdown and cache counters", () => {
  const normalizer = new ClaudeEventNormalizer();
  const events = normalizer.parseLine(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "done",
      total_cost_usd: 0.05,
      num_turns: 3,
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 10,
        service_tier: "standard",
      },
      modelUsage: {
        "test-model": {
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadInputTokens: 200,
          cacheCreationInputTokens: 10,
          costUSD: 0.05,
        },
      },
    }),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "worker.completed");
  const t = events[0]?.terminal;
  assert.equal(t?.isError, false);
  assert.equal(t?.costUsd, 0.05);
  assert.equal(t?.runtimeCostEstimateUsd, 0.05);
  assert.equal(t?.turns, 3);
  assert.equal(t?.usage?.inputTokens, 1000);
  assert.equal(t?.usage?.outputTokens, 500);
  assert.equal(t?.usage?.cacheReadInputTokens, 200);
  assert.equal(t?.usage?.cacheCreationInputTokens, 10);
  assert.equal(t?.usage?.serviceTier, "standard");
  assert.equal(t?.usage?.source, "terminal-result");
  assert.equal(t?.usage?.complete, true);
  assert.equal(t?.usage?.perModel?.length, 1);
  assert.equal(t?.usage?.perModel?.[0]?.model, "test-model");
  // Verify usage appears in both payload and terminal
  const payload = events[0]?.payload as Record<string, unknown> | undefined;
  assert.equal(typeof payload?.usage, "object");
});

test("preserves authoritative usage on error_during_execution and budget errors", () => {
  const normalizer = new ClaudeEventNormalizer();
  const execError = normalizer.parseLine(
    JSON.stringify({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      total_cost_usd: 0.023,
      num_turns: 7,
      usage: {
        input_tokens: 1480,
        output_tokens: 577,
        cache_read_input_tokens: 2432,
        cache_creation_input_tokens: 0,
      },
    }),
  );
  assert.equal(execError[0]?.type, "worker.failed");
  assert.equal(execError[0]?.terminal?.usage?.inputTokens, 1480);
  assert.equal(execError[0]?.terminal?.usage?.cacheReadInputTokens, 2432);
  assert.equal(execError[0]?.terminal?.runtimeCostEstimateUsd, 0.023);

  const budgetError = normalizer.parseLine(
    JSON.stringify({
      type: "result",
      subtype: "error_max_budget_usd",
      is_error: true,
      total_cost_usd: 0.518137,
      num_turns: 1,
      usage: {
        input_tokens: 50,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    }),
  );
  assert.equal(budgetError[0]?.type, "worker.failed");
  assert.equal(budgetError[0]?.terminal?.usage?.inputTokens, 50);
  assert.equal(budgetError[0]?.terminal?.usage?.outputTokens, 0);
  assert.equal(budgetError[0]?.terminal?.costUsd, 0.518137);
  assert.match(budgetError[0]?.summary ?? "", /max budget exceeded/);
  assert.match(budgetError[0]?.terminal?.failureReason ?? "", /max budget exceeded/);
  assert.match(
    resolveWorkerFailure(budgetError[0]?.terminal, ""),
    /max budget exceeded \(runtime estimate \$0\.518137/,
  );
  assert.equal(
    (budgetError[0]?.payload as { failureCategory?: string } | undefined)?.failureCategory,
    "budget",
  );
});

test("resolveWorkerFailure prefers budget diagnostic over generic no-result wording", () => {
  assert.match(
    resolveWorkerFailure(
      {
        isError: true,
        failureReason: "Worker reported failure",
        resultText: "error_max_budget_usd",
        costUsd: 0.55,
        runtimeCostEstimateUsd: 0.55,
      },
      "",
    ),
    /max budget exceeded \(runtime estimate \$0\.550000/,
  );
});

test("authentication failures get a distinct summary and failureCategory (FL-D15/D16)", () => {
  const normalizer = new ClaudeEventNormalizer();
  // Misleading subtype "success" with auth error text (FL-D16 envelope quirk).
  const events = normalizer.parseLine(JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: true,
    result: "API Error: 401 authentication_failed after 10 retries",
    total_cost_usd: 0,
    num_turns: 0,
  }));
  assert.equal(events[0]?.type, "worker.failed");
  assert.match(events[0]?.summary ?? "", /authentication/i);
  assert.equal(
    (events[0]?.payload as { failureCategory?: string } | undefined)?.failureCategory,
    "authentication",
  );
  assert.match(events[0]?.terminal?.failureReason ?? "", /authentication/i);
});

test("rejects malformed usage counters and leaves usage absent", () => {
  const normalizer = new ClaudeEventNormalizer();
  const result = (usage: unknown) =>
    normalizer.parseLine(JSON.stringify({
      type: "result",
      is_error: false,
      usage,
    }))[0]?.terminal?.usage;

  // Missing counter
  assert.equal(result({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 }), undefined);
  // Negative counter
  assert.equal(result({ input_tokens: -1, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }), undefined);
  // Fractional counter
  assert.equal(result({ input_tokens: 100.5, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }), undefined);
  // String counter
  assert.equal(result({ input_tokens: "1000", output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }), undefined);
  // Infinite counter
  assert.equal(result({ input_tokens: Infinity, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }), undefined);
  // Null counter
  assert.equal(result({ input_tokens: null, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }), undefined);
  // No usage block at all
  assert.equal(normalizer.parseLine(JSON.stringify({ type: "result", is_error: false }))[0]?.terminal?.usage, undefined);
  // Malformed model entry skipped without spoiling breakdown
  const withModel = normalizer.parseLine(
    JSON.stringify({
      type: "result",
      is_error: false,
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      modelUsage: {
        ok: { inputTokens: 60, outputTokens: 30, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
        bad: { inputTokens: -5, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      },
    }),
  );
  assert.equal(withModel[0]?.terminal?.usage?.perModel?.length, 1);
  assert.equal(withModel[0]?.terminal?.usage?.perModel?.[0]?.model, "ok");
});

test("runtimeCostEstimateUsd mirrors costUsd and is absent without cost", () => {
  const normalizer = new ClaudeEventNormalizer();
  const withCost = normalizer.parseLine(
    JSON.stringify({ type: "result", is_error: false, total_cost_usd: 0.031 }),
  )[0]?.terminal;
  assert.equal(withCost?.costUsd, 0.031);
  assert.equal(withCost?.runtimeCostEstimateUsd, 0.031);

  const noCost = normalizer.parseLine(
    JSON.stringify({ type: "result", is_error: false }),
  )[0]?.terminal;
  assert.equal(noCost?.costUsd, undefined);
  assert.equal(noCost?.runtimeCostEstimateUsd, undefined);
});

test("assistant produces no billable terminal usage", () => {
  const normalizer = new ClaudeEventNormalizer();
  // Assistant stream rows may carry per-row usage but must not drive terminal totals.
  const assistant = normalizer.parseLine(
    JSON.stringify({
      type: "assistant",
      message: {
        id: "msg-1",
        content: [{ type: "text", text: "Analyzing." }],
        usage: { input_tokens: 200, output_tokens: 50 },
      },
    }),
  );
  for (const event of assistant) assert.equal(event.terminal, undefined);

  // Terminal result output_tokens is the complete billed total — no thinking appended.
  const result = normalizer.parseLine(
    JSON.stringify({
      type: "result",
      is_error: false,
      total_cost_usd: 0.05,
      usage: {
        input_tokens: 100,
        output_tokens: 60,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    }),
  );
  assert.equal(result[0]?.terminal?.usage?.outputTokens, 60);
  const usageObj = result[0]?.terminal?.usage as unknown as Record<string, unknown> | undefined;
  assert.equal(usageObj?.thinkingTokens, undefined);
  assert.equal(usageObj?.thinking_tokens, undefined);
});

test("explicit stop_reason error overrides is_error false while preserving usage and cost", () => {
  const normalizer = new ClaudeEventNormalizer();
  // Real MiniMax-M3 scenario: process exit zero, is_error false, stop_reason error,
  // empty result, complete usage with model breakdown.
  const events = normalizer.parseLine(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      stop_reason: "error",
      result: "",
      total_cost_usd: 0.023,
      num_turns: 7,
      usage: {
        input_tokens: 1480,
        output_tokens: 577,
        cache_read_input_tokens: 2432,
        cache_creation_input_tokens: 0,
      },
      modelUsage: {
        "MiniMax-M3": {
          inputTokens: 1480,
          outputTokens: 577,
          cacheReadInputTokens: 2432,
          cacheCreationInputTokens: 0,
          costUSD: 0.023,
        },
      },
    }),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "worker.failed");
  assert.match(events[0]?.summary ?? "", /error stop reason/);
  const t = events[0]?.terminal;
  assert.equal(t?.isError, true);
  // Cost and usage evidence preserved despite error classification
  assert.equal(t?.costUsd, 0.023);
  assert.equal(t?.runtimeCostEstimateUsd, 0.023);
  assert.equal(t?.turns, 7);
  assert.equal(t?.usage?.inputTokens, 1480);
  assert.equal(t?.usage?.outputTokens, 577);
  assert.equal(t?.usage?.perModel?.length, 1);
  assert.equal(t?.usage?.perModel?.[0]?.model, "MiniMax-M3");
  assert.equal(t?.failureReason, "Worker terminated with error stop reason");
  assert.equal(resolveWorkerFailure(t, ""), "Worker terminated with error stop reason");
  // stop_reason present in payload
  const payload = events[0]?.payload as Record<string, unknown> | undefined;
  assert.equal(payload?.stopReason, "error");
});

test("error subtype without is_error signals failure", () => {
  const normalizer = new ClaudeEventNormalizer();
  const events = normalizer.parseLine(
    JSON.stringify({
      type: "result",
      subtype: "error_during_execution",
      is_error: false,
      total_cost_usd: 0.015,
      num_turns: 3,
      usage: {
        input_tokens: 500,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    }),
  );
  assert.equal(events[0]?.type, "worker.failed");
  assert.equal(events[0]?.summary, "Worker reported an error terminal subtype");
  assert.equal(events[0]?.terminal?.isError, true);
  assert.equal(events[0]?.terminal?.failureReason, "Worker reported an error terminal subtype");
  assert.equal(events[0]?.terminal?.usage?.inputTokens, 500);
});

test("non-error stop_reason end_turn with is_error false stays completed", () => {
  const normalizer = new ClaudeEventNormalizer();
  const events = normalizer.parseLine(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      stop_reason: "end_turn",
      result: "Task completed successfully.",
      total_cost_usd: 0.01,
      num_turns: 2,
    }),
  );
  assert.equal(events[0]?.type, "worker.completed");
  assert.equal(events[0]?.terminal?.isError, false);
});

test("non-error subtype with is_error false stays completed", () => {
  const normalizer = new ClaudeEventNormalizer();
  const events = normalizer.parseLine(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "done",
      total_cost_usd: 0.05,
    }),
  );
  assert.equal(events[0]?.type, "worker.completed");
  assert.equal(events[0]?.terminal?.isError, false);
});

// --- Claude thinking_tokens → model-processing marker ---

test("thinking_tokens emits closed model-processing marker with no token estimate or raw payload", () => {
  const normalizer = new ClaudeEventNormalizer();
  const events = normalizer.parseLine(
    JSON.stringify({
      type: "system",
      subtype: "thinking_tokens",
      estimated_tokens: 74083,
    }),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "worker.message");
  const payload = events[0]?.payload as Record<string, unknown> | undefined;
  assert.equal(payload?.activityKind, "model-processing");
  // Token estimates and raw payload fields must never enter durable events.
  assert.equal(payload?.estimated_tokens, undefined);
  assert.equal(payload?.estimatedTokens, undefined);
  assert.equal(payload?.thinkingTokens, undefined);
  // No terminal / billing evidence.
  assert.equal(events[0]?.terminal, undefined);
  // Summary is a fixed human-readable string, not a runtime estimate.
  assert.ok(typeof events[0]?.summary === "string");
  assert.ok(!events[0]?.summary?.includes("74083"));
});

test("thinking_tokens throttle: emits first marker immediately, then at most one per interval", () => {
  let clock = 0;
  const normalizer = new ClaudeEventNormalizer({
    clock: () => clock,
    processingThrottleMs: 15_000,
  });
  // First call: emit immediately.
  const first = normalizer.parseLine(
    JSON.stringify({ type: "system", subtype: "thinking_tokens", estimated_tokens: 1 }),
  );
  assert.equal(first.length, 1);
  assert.equal((first[0]?.payload as Record<string, unknown>)?.activityKind, "model-processing");

  // Just inside the 15-second window: dropped.
  clock = 14_999;
  const inside = normalizer.parseLine(
    JSON.stringify({ type: "system", subtype: "thinking_tokens", estimated_tokens: 2 }),
  );
  assert.deepEqual(inside, []);

  // Exactly at the boundary: emitted.
  clock = 15_000;
  const boundary = normalizer.parseLine(
    JSON.stringify({ type: "system", subtype: "thinking_tokens", estimated_tokens: 3 }),
  );
  assert.equal(boundary.length, 1);

  // Just beyond the next boundary: emitted.
  clock = 30_001;
  const later = normalizer.parseLine(
    JSON.stringify({ type: "system", subtype: "thinking_tokens", estimated_tokens: 4 }),
  );
  assert.equal(later.length, 1);

  // Tens of thousands of lines inside one interval: at most one durable event.
  const throttled = new ClaudeEventNormalizer({
    clock: () => 0,
    processingThrottleMs: 15_000,
  });
  let emitted = 0;
  // Emulate 74083 thinking_tokens lines.
  for (let i = 0; i < 74083; i += 1) {
    const events = throttled.parseLine(
      JSON.stringify({ type: "system", subtype: "thinking_tokens", estimated_tokens: 42 }),
    );
    emitted += events.length;
  }
  assert.equal(emitted, 1, "74083 lines produce at most 1 durable event within one interval");
});

test("thinking_tokens processing marker does not override no-progress watchdog or retry policy", () => {
  const normalizer = new ClaudeEventNormalizer();
  const events = normalizer.parseLine(
    JSON.stringify({ type: "system", subtype: "thinking_tokens", estimated_tokens: 10 }),
  );
  // Processing marker is a worker.message with a closed activityKind — it is
  // never a tool lifecycle event that resets the watchdog.
  assert.equal(events[0]?.type, "worker.message");
  assert.notEqual(events[0]?.type, "worker.tool.started");
  assert.notEqual(events[0]?.type, "worker.tool.completed");
});
