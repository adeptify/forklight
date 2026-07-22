import assert from "node:assert/strict";
import test from "node:test";
import { ClaudeEventNormalizer } from "../src/events/normalize.js";

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
