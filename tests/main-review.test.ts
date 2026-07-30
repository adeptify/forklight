import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
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

async function seedMatchingRevision(
  store: StateStore,
  task: TaskRecord,
  verificationSequence: number,
): Promise<{ revisionId: string; digest: string }> {
  await mkdir(path.dirname(task.paths.diff), { recursive: true });
  const patch = "diff --git a/src/a.ts b/src/a.ts\n+export const a = 1;\n";
  await writeFile(task.paths.diff, patch, "utf8");
  const digest = createHash("sha256").update(patch).digest("hex");
  const revisionId = "rev-modern-1";
  const artifactDir = path.join(task.paths.root, "revisions");
  await mkdir(artifactDir, { recursive: true });
  await writeFile(path.join(artifactDir, `${revisionId}.patch`), patch, "utf8");
  store.addEvent(
    task.id,
    "attempt-1",
    "candidate.revision.captured",
    "Revision for current verification",
    {
      id: revisionId,
      taskId: task.id,
      attemptId: "attempt-1",
      attemptOrdinal: 1,
      verificationEventSequence: verificationSequence,
      patchDigest: digest,
      affectedPaths: ["src/a.ts"],
      filesChanged: 1,
      changedLines: 1,
      verificationPassed: true,
      createdAt: new Date().toISOString(),
      privateArtifactPath: path.join(artifactDir, `${revisionId}.patch`),
    },
  );
  return { revisionId, digest };
}

test("main review revise binds exact CandidateRevision when modern history exists", async () => {
  const fixture = await reviewFixture(true);
  try {
    const { revisionId, digest } = await seedMatchingRevision(
      fixture.store,
      fixture.task,
      fixture.verificationSequence,
    );
    const review = recordMainReview(fixture.store, fixture.task.id, {
      decision: "revise",
      reason: "Semantic gap remains",
      confirm: true,
    });
    assert.equal(review.decision, "revise");
    assert.equal(review.candidateRevisionId, revisionId);
    assert.equal(review.acceptedPatchDigest, digest);
    assert.equal(review.verificationEventSequence, fixture.verificationSequence);
  } finally {
    fixture.store.close();
  }
});

test("main review reject binds exact CandidateRevision when modern history exists", async () => {
  const fixture = await reviewFixture(true);
  try {
    const { revisionId, digest } = await seedMatchingRevision(
      fixture.store,
      fixture.task,
      fixture.verificationSequence,
    );
    const review = recordMainReview(fixture.store, fixture.task.id, {
      decision: "reject",
      reason: "Wrong approach overall",
      confirm: true,
    });
    assert.equal(review.decision, "reject");
    assert.equal(review.candidateRevisionId, revisionId);
    assert.equal(review.acceptedPatchDigest, digest);
  } finally {
    fixture.store.close();
  }
});

test("main review revise rejects mismatched current Diff when modern history exists", async () => {
  const fixture = await reviewFixture(true);
  try {
    await seedMatchingRevision(
      fixture.store,
      fixture.task,
      fixture.verificationSequence,
    );
    // Stale live Diff after revision capture.
    await writeFile(fixture.task.paths.diff, "diff --git a/src/a.ts b/src/a.ts\n+export const a = 2;\n", "utf8");
    assert.throws(
      () => recordMainReview(fixture.store, fixture.task.id, {
        decision: "revise",
        reason: "Should reject mismatched Diff",
        confirm: true,
      }),
      /exact CandidateRevision/,
    );
    assert.equal(
      fixture.store.listEvents(fixture.task.id).filter((event) => event.type === "main-review.completed").length,
      0,
    );
  } finally {
    fixture.store.close();
  }
});

test("main review revise stays legacy-compatible without CandidateRevision events", async () => {
  const fixture = await reviewFixture(true);
  try {
    const review = recordMainReview(fixture.store, fixture.task.id, {
      decision: "revise",
      reason: "Legacy revise without revision evidence",
      confirm: true,
    });
    assert.equal(review.decision, "revise");
    assert.equal(review.candidateRevisionId, undefined);
    assert.equal(review.acceptedPatchDigest, undefined);
  } finally {
    fixture.store.close();
  }
});
