import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { recordMainReview } from "../src/core/main-review.js";
import type {
  AttemptRecord,
  TaskRecord,
  VerificationResult,
} from "../src/core/types.js";
import { StateStore } from "../src/state/store.js";

async function reviewFixture(passed: boolean): Promise<{
  store: StateStore;
  task: TaskRecord;
  verificationSequence: number;
}> {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-main-review-"));
  const store = new StateStore(home);
  const now = new Date().toISOString();
  const task: TaskRecord = {
    id: "task-1",
    name: "Review fixture",
    status: passed ? "succeeded" : "failed",
    sourcePath: "/tmp/source",
    taskFile: "forklight://test/main-review",
    spec: {
      version: 1,
      name: "Review fixture",
      project: "/tmp/source",
      goal: "Test review evidence",
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
        maxBudgetUsd: 1,
      },
      workspace: { exclude: [] },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
      acceptance: { commands: ["true"] },
    },
    paths: {
      root: home,
      baseline: path.join(home, "baseline"),
      workspace: path.join(home, "workspace"),
      logs: path.join(home, "logs"),
      claudeConfig: path.join(home, "claude"),
      diff: path.join(home, "delivery.patch"),
    },
    sessionId: "session-1",
    currentAttemptId: "attempt-1",
    createdAt: now,
    updatedAt: now,
  };
  store.createTask(task);
  const attempt: AttemptRecord = {
    id: "attempt-1",
    taskId: task.id,
    ordinal: 1,
    status: passed ? "succeeded" : "failed",
    sessionId: task.sessionId,
    rawLogPath: path.join(home, "attempt.jsonl"),
    startedAt: now,
    finishedAt: now,
    exitCode: passed ? 0 : 1,
  };
  store.createAttempt(attempt);
  const verification: VerificationResult = {
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
    diffPath: task.paths.diff,
    sourceUnchanged: true,
  };
  const event = store.addEvent(
    task.id,
    attempt.id,
    "verification.completed",
    passed ? "Independent verification passed" : "Independent verification failed",
    verification,
  );
  return { store, task: store.getTask(task.id), verificationSequence: event.sequence };
}

test("accept requires passing independent verification and explicit confirmation", async () => {
  const failed = await reviewFixture(false);
  try {
    assert.throws(
      () => recordMainReview(failed.store, failed.task.id, {
        decision: "accept",
        reason: "Looks fine",
        confirm: true,
      }),
      /passing independent verification/,
    );
    assert.throws(
      () => recordMainReview(failed.store, failed.task.id, {
        decision: "revise",
        reason: "Fix the failing command",
        confirm: false,
      } as never),
      /confirm/,
    );
  } finally {
    failed.store.close();
  }
});
test("main review persists bounded structured evidence for the current Attempt", async () => {
  const fixture = await reviewFixture(true);
  try {
    const review = recordMainReview(fixture.store, fixture.task.id, {
      decision: "accept",
      reason: " Diff is scoped and the contract is satisfied ",
      confirm: true,
    });
    assert.deepEqual(review, {
      decision: "accept",
      reason: "Diff is scoped and the contract is satisfied",
      attemptId: "attempt-1",
      verificationEventSequence: fixture.verificationSequence,
    });
    const event = fixture.store.listEvents(fixture.task.id).at(-1);
    assert.equal(event?.type, "main-review.completed");
    assert.deepEqual(event?.payload, review);
  } finally {
    fixture.store.close();
  }
});
