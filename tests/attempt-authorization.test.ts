import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { authorizeExtraAttempt } from "../src/core/attempt-authorization.js";
import { registerTaskFromSpec } from "../src/core/runner.js";
import type { AttemptRecord } from "../src/core/types.js";
import { StateStore } from "../src/state/store.js";

async function exhaustedTask(): Promise<{ store: StateStore; taskId: string }> {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-attempt-auth-"));
  const store = new StateStore(home);
  const task = registerTaskFromSpec(store, {
    version: 1,
    name: "bounded correction",
    project: "/tmp/source",
    goal: "Prove one explicit correction is bounded",
    constraints: [],
    provider: {
      name: "deepseek",
      model: "deepseek-v4-pro",
      keychainService: "forklight.test",
    },
    runtime: {
      name: "claude-code",
      executable: "claude",
      effort: "high",
      maxBudgetUsd: 1.5,
    },
    workspace: { exclude: [] },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
    acceptance: { commands: ["true"] },
  }, "forklight://test/attempt-authorization");
  const now = new Date().toISOString();
  for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
    const attempt: AttemptRecord = {
      id: `attempt-${ordinal}`,
      taskId: task.id,
      ordinal,
      status: "failed",
      sessionId: task.sessionId,
      rawLogPath: `/tmp/attempt-${ordinal}.jsonl`,
      startedAt: now,
      finishedAt: now,
      exitCode: 1,
    };
    store.createAttempt(attempt);
  }
  store.setTaskStatus(task.id, "failed", { error: "Independent verification failed" });
  return { store, taskId: task.id };
}

test("one explicit extra Attempt is authorized without changing Task settings", async () => {
  const { store, taskId } = await exhaustedTask();
  try {
    const options = authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1,
      maxBudgetUsd: null,
      reason: "One bounded correction after complete verifier evidence",
      confirm: true,
    }, 3, 20);

    assert.deepEqual(options, {
      maximumOrdinal: 4,
      maxBudgetUsdOverride: null,
      authorizationEventSequence: 2,
    });
    assert.equal(store.getTask(taskId).spec.runtime.maxBudgetUsd, 1.5);
    const events = store.listEvents(taskId)
      .filter((event) => event.type === "attempt.authorization.granted");
    assert.equal(events.length, 1);
    assert.deepEqual(events[0]?.payload, {
      additionalAttempts: 1,
      targetOrdinal: 4,
      maxBudgetUsd: null,
      budgetMode: "uncapped-for-authorized-attempt",
      reason: "One bounded correction after complete verifier evidence",
    });
  } finally {
    store.close();
  }
});
test("authorization rejects invalid state, budget, and a second grant", async () => {
  const { store, taskId } = await exhaustedTask();
  try {
    assert.throws(
      () => authorizeExtraAttempt(store, taskId, {
        additionalAttempts: 1,
        maxBudgetUsd: 21,
        reason: "Too much",
        confirm: true,
      }, 3, 20),
      /maximumBudgetUsd/,
    );

    authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1,
      maxBudgetUsd: 2,
      reason: "One bounded correction",
      confirm: true,
    }, 3, 20);

    assert.throws(
      () => authorizeExtraAttempt(store, taskId, {
        additionalAttempts: 1,
        maxBudgetUsd: 2,
        reason: "Try to authorize again",
        confirm: true,
      }, 3, 20),
      /already received/,
    );
  } finally {
    store.close();
  }
});
