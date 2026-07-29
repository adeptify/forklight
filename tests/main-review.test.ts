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

test("main review accept rejects when no CandidateRevision matches the exact latest verification sequence", async () => {
  const fixture = await reviewFixture(true);
  try {
    // Seed a candidate.revision.captured event bound to the first verification.
    fixture.store.addEvent(
      fixture.task.id,
      "attempt-1",
      "candidate.revision.captured",
      "Revision for first verification",
      {
        id: "rev-old",
        taskId: fixture.task.id,
        attemptId: "attempt-1",
        attemptOrdinal: 1,
        verificationEventSequence: fixture.verificationSequence,
        patchDigest: "a".repeat(64),
        affectedPaths: ["src/index.ts"],
        filesChanged: 1,
        changedLines: 5,
        verificationPassed: true,
        createdAt: new Date().toISOString(),
      },
    );
    // Add a NEWER verification event at a higher sequence — simulating a
    // reverification that passed verification but failed to capture a new
    // revision. The old revision is still bound to the first sequence.
    fixture.store.addEvent(
      fixture.task.id,
      "attempt-1",
      "verification.completed",
      "Newer verification passed",
      {
        passed: true,
        behaviorPassed: true,
        policyPassed: true,
        sourceCompatible: true,
        commands: [{ command: "true", exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false }],
        diffPath: fixture.task.paths.diff,
        sourceUnchanged: true,
      },
    );

    // recordMainReview must reject: the latest verification has no matching
    // CandidateRevision and a prior revision event exists (rejecting stale
    // same-digest substitution).
    assert.throws(
      () => recordMainReview(fixture.store, fixture.task.id, {
        decision: "accept",
        reason: "Should reject without exact-sequence revision",
        confirm: true,
      }),
      /current Diff to match/,
    );

    // Verify no main-review event was appended (the store is not mutated).
    assert.equal(
      fixture.store.listEvents(fixture.task.id).filter((event) => event.type === "main-review.completed").length,
      0,
      "no review event was appended on rejection",
    );
  } finally {
    fixture.store.close();
  }
});

test("main review accept works with legacy tasks that have no CandidateRevision events", async () => {
  // A task with a passing verification but zero candidate.revision.captured
  // events must fall through the legacy path and accept without digest binding.
  const fixture = await reviewFixture(true);
  try {
    const review = recordMainReview(fixture.store, fixture.task.id, {
      decision: "accept",
      reason: "Legacy task without revision evidence",
      confirm: true,
    });
    assert.equal(review.decision, "accept");
    assert.equal(review.attemptId, "attempt-1");
    assert.equal(review.verificationEventSequence, fixture.verificationSequence);
    assert.equal(review.candidateRevisionId, undefined, "no revision binding for legacy");
    assert.equal(review.acceptedPatchDigest, undefined, "no digest binding for legacy");
  } finally {
    fixture.store.close();
  }
});
