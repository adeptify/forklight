import assert from "node:assert/strict";
import test from "node:test";
import { buildDeliveryLineage } from "../src/core/delivery-lineage.js";
import type {
  AttemptRecord,
  EventRecord,
  PatchEvidence,
  VerificationResult,
} from "../src/core/types.js";

const TS = "2026-07-24T00:00:00.000Z";

function attempt(id: string, ordinal: number): AttemptRecord {
  return {
    id,
    taskId: "task-lineage",
    ordinal,
    status: ordinal === 3 ? "succeeded" : "failed",
    sessionId: "session-lineage",
    rawLogPath: `/tmp/${id}.jsonl`,
    startedAt: TS,
    finishedAt: TS,
    exitCode: ordinal === 3 ? 0 : 1,
  };
}

function patch(filesChanged: number, changedLines: number): PatchEvidence {
  return {
    path: "/tmp/redacted.patch",
    filesChanged,
    changedLines,
    affectedPaths: [],
  };
}

function verificationEvent(
  id: number,
  attemptId: string,
  filesChanged: number,
  changedLines: number,
): EventRecord {
  const payload: VerificationResult = {
    passed: attemptId === "attempt-3",
    behaviorPassed: attemptId === "attempt-3",
    policyPassed: true,
    sourceCompatible: true,
    commands: [],
    diffPath: "/tmp/redacted.patch",
    patches: {
      business: patch(filesChanged, changedLines),
      generated: patch(0, 0),
      integration: patch(filesChanged, changedLines),
    },
    sourceUnchanged: true,
  };
  return {
    id,
    taskId: "task-lineage",
    attemptId,
    sequence: id,
    timestamp: TS,
    type: "verification.completed",
    summary: payload.passed
      ? "Independent verification passed"
      : "Independent verification failed",
    payload,
  };
}

test("delivery lineage separates hop churn from final combined delivery", () => {
  const attempts = [
    attempt("attempt-1", 1),
    attempt("attempt-2", 2),
    attempt("attempt-3", 3),
  ];
  const events = [
    verificationEvent(1, "attempt-1", 4, 300),
    verificationEvent(2, "attempt-2", 2, 120),
    verificationEvent(3, "attempt-3", 3, 180),
  ];

  assert.deepEqual(buildDeliveryLineage(attempts, events), {
    complete: true,
    missingAttemptIds: [],
    attemptCount: 3,
    verifiedAttemptCount: 3,
    hopChurn: { filesChanged: 9, changedLines: 600 },
    combinedDeliveryDiff: { filesChanged: 3, changedLines: 180 },
    correctionAttemptIds: ["attempt-2", "attempt-3"],
  });
});

test("legacy verification without patch evidence is explicit, never silently zero", () => {
  const attempts = [attempt("attempt-1", 1), attempt("attempt-2", 2)];
  const events = [
    verificationEvent(1, "attempt-1", 4, 300),
    {
      ...verificationEvent(2, "attempt-2", 2, 120),
      payload: {
        passed: true,
        behaviorPassed: true,
        policyPassed: true,
        sourceCompatible: true,
        commands: [],
        diffPath: "/tmp/legacy.patch",
        sourceUnchanged: true,
      } satisfies VerificationResult,
    },
  ];

  const lineage = buildDeliveryLineage(attempts, events);
  assert.equal(lineage.complete, false);
  assert.deepEqual(lineage.missingAttemptIds, ["attempt-2"]);
  assert.equal(lineage.verifiedAttemptCount, 2);
  assert.deepEqual(lineage.hopChurn, { filesChanged: 4, changedLines: 300 });
  assert.deepEqual(
    lineage.combinedDeliveryDiff,
    { filesChanged: 0, changedLines: 0 },
    "unknown final evidence must not reuse an older attempt as current delivery",
  );
});
