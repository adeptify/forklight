import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  authorizeWorkerValidationRepair,
  decideWorkerValidationRepair,
  recordWorkerValidationRepairCompleted,
  recordWorkerValidationRepairStarted,
  resolveWorkerValidationRepairHistory,
  workerValidationEvidenceFingerprint,
  workerValidationRepairFeedback,
  type WorkerValidationRepairHistoryEntry,
} from "../src/core/worker-validation-repair.js";
import { parseCodexGoalBinding } from "../src/workers/codex-goal.js";
import {
  defaultAdvancedPolicyFields,
  defaultEnforcementCapability,
  resolveEffectivePolicy,
} from "../src/core/advanced-policy.js";
import type {
  AttemptRecord,
  CandidateRevision,
  TaskRecord,
  VerificationResult,
} from "../src/core/types.js";
import { registerTaskFromSpec } from "../src/core/runner.js";
import { StateStore } from "../src/state/store.js";

const DIGEST = "a".repeat(64);

function makeTask(allowance = 1): TaskRecord {
  const global = defaultAdvancedPolicyFields();
  const effectivePolicy = resolveEffectivePolicy(
    undefined,
    { maxWorkerValidationRepairs: allowance },
    global,
    "global",
    defaultEnforcementCapability(),
  );
  return {
    id: "task-repair",
    name: "repair",
    status: "failed",
    sourcePath: "/source",
    taskFile: "forklight://test/repair",
    spec: {
      version: 1,
      name: "repair",
      project: "/source",
      goal: "repair",
      constraints: [],
      provider: { name: "deepseek", model: "model", keychainService: "test" },
      runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: null },
      workspace: { exclude: [] },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
      acceptance: { commands: ["npm test"] },
      executionMode: "single-run",
    } as TaskRecord["spec"],
    paths: {
      root: "/task",
      baseline: "/task/baseline",
      workspace: "/task/workspace",
      logs: "/task/logs",
      claudeConfig: "/task/claude",
      diff: "/task/diff",
    },
    sessionId: "session-repair",
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    effectivePolicy,
  };
}

function makeAttempt(task: TaskRecord, id = "attempt-1"): AttemptRecord {
  return {
    id,
    taskId: task.id,
    ordinal: 1,
    status: "succeeded",
    sessionId: task.sessionId,
    rawLogPath: "/task/logs/attempt-1.jsonl",
    startedAt: "2026-08-09T00:00:00.000Z",
  };
}

function makeVerification(): VerificationResult {
  return {
    passed: false,
    behaviorPassed: false,
    policyPassed: true,
    sourceCompatible: true,
    commands: [{
      command: "npm test",
      exitCode: 1,
      stdout: "",
      stderr: "",
      durationMs: 1,
      timedOut: false,
    }],
    diffPath: "/task/diff",
    sourceUnchanged: false,
  };
}

function makeCandidate(task: TaskRecord, attempt: AttemptRecord): CandidateRevision {
  return {
    id: "revision-1",
    taskId: task.id,
    attemptId: attempt.id,
    attemptOrdinal: attempt.ordinal,
    verificationEventSequence: 7,
    patchDigest: DIGEST,
    affectedPaths: ["src/fix.ts"],
    filesChanged: 1,
    changedLines: 2,
    verificationPassed: false,
    createdAt: "2026-08-09T00:00:00.000Z",
  };
}

function historyEntry(task: TaskRecord, fingerprint: string, round = 1): WorkerValidationRepairHistoryEntry {
  return {
    schemaVersion: 1,
    taskId: task.id,
    round,
    authorizationEventSequence: round,
    attemptId: `repair-attempt-${round}`,
    targetAttemptOrdinal: round + 1,
    priorAttemptId: "attempt-1",
    verificationEventSequence: 7,
    candidateRevisionId: `revision-${round}`,
    evidenceFingerprint: fingerprint,
    workerIdentity: {
      provider: task.spec.provider.name,
      model: task.spec.provider.model,
      runtime: task.spec.runtime.name,
      effort: task.spec.runtime.effort,
    },
    feedback: "feedback",
    state: "terminal",
    terminalOutcome: "failed",
  };
}

test("positive allowlist admits only changed behavior evidence and preserves finite rounds", () => {
  const task = makeTask(1);
  const attempt = makeAttempt(task);
  const verification = makeVerification();
  const candidate = makeCandidate(task, attempt);
  const base = {
    task,
    attempt,
    workerStatus: "succeeded" as const,
    verification,
    candidateRevision: candidate,
    verificationEventSequence: 7,
    runtimeCapabilities: {
      sessionResume: "supported" as const,
      nativeGoal: "unsupported" as const,
    },
  };
  const eligible = decideWorkerValidationRepair(base);
  assert.equal(eligible.eligible, true);
  assert.equal(eligible.round, 1);
  assert.equal(eligible.remainingAllowance, 1);
  assert.equal(eligible.failureClass, "behavior");

  assert.equal(decideWorkerValidationRepair({ ...base, workerFailureCategory: "runtime" }).reason, "non-behavior-failure");
  assert.equal(decideWorkerValidationRepair({ ...base, workerStatus: "failed" }).reason, "worker-did-not-return-normally");
  assert.equal(decideWorkerValidationRepair({ ...base, verification: { ...verification, policyPassed: false } }).reason, "policy-failed");
  assert.equal(decideWorkerValidationRepair({ ...base, verification: { ...verification, sourceCompatible: false } }).reason, "source-failed");
  assert.equal(
    decideWorkerValidationRepair({
      ...base,
      verification: { ...verification, behaviorPassed: true, policyPassed: false },
    }).reason,
    "policy-failed",
  );
  assert.equal(
    decideWorkerValidationRepair({
      ...base,
      verification: { ...verification, commands: [null] as unknown as VerificationResult["commands"] },
    }).reason,
    "verification-infrastructure",
  );
  assert.equal(
    decideWorkerValidationRepair({
      ...base,
      verification: {
        ...verification,
        commands: [{ ...verification.commands[0]!, command: "npm run unrelated" }],
      },
    }).reason,
    "verification-infrastructure",
    "repair authority is bound to the complete original acceptance suite",
  );
  assert.equal(
    decideWorkerValidationRepair({
      ...base,
      candidateRevision: { ...candidate, attemptOrdinal: 2 },
    }).reason,
    "candidate-not-bound",
    "candidate ordinal is bound to the exact Attempt",
  );
  assert.equal(decideWorkerValidationRepair((() => {
    const { candidateRevision: _candidate, ...withoutCandidate } = base;
    return withoutCandidate;
  })()).reason, "candidate-missing");
  assert.equal(decideWorkerValidationRepair((() => {
    const { runtimeCapabilities: _capabilities, ...withoutCapabilities } = base;
    return withoutCapabilities;
  })()).reason, "runtime-not-resumable");
  assert.equal(decideWorkerValidationRepair({ ...base, task: makeTask(0) }).reason, "allowance-disabled");

  const fingerprint = workerValidationEvidenceFingerprint({
    taskId: task.id,
    attemptId: attempt.id,
    verificationEventSequence: 7,
    verification,
    candidateRevision: candidate,
  });
  const repeated = decideWorkerValidationRepair({
    ...base,
    task: makeTask(2),
    repairHistory: [historyEntry(task, fingerprint)],
  });
  assert.equal(repeated.reason, "repeated-evidence");

  const secondRoundTask = makeTask(2);
  const secondRound = decideWorkerValidationRepair({
    ...base,
    task: secondRoundTask,
    repairHistory: [historyEntry(secondRoundTask, "b".repeat(64))],
  });
  assert.equal(secondRound.eligible, true);
  assert.equal(secondRound.round, 2);
  assert.equal(secondRound.remainingAllowance, 1);
  assert.equal(
    decideWorkerValidationRepair({
      ...base,
      repairHistory: [{ ...historyEntry(task, "b".repeat(64)), state: "corrupt" as never }],
    }).reason,
    "conflicting-history",
  );
});

test("durable coordinator lineage is one authorization/start/terminal chain and idempotent", () => {
  const home = mkdtempSync(path.join(tmpdir(), "forklight-repair-lineage-"));
  const store = new StateStore(home);
  try {
    const task = registerTaskFromSpec(store, makeTask().spec, "forklight://test/lineage");
    const attempt = makeAttempt(task);
    store.createAttempt(attempt);
    const verification = makeVerification();
    const candidate = makeCandidate(task, attempt);
    const decision = decideWorkerValidationRepair({
      task,
      attempt,
      workerStatus: "succeeded",
      verification,
      candidateRevision: candidate,
      verificationEventSequence: 7,
      runtimeCapabilities: {
        sessionResume: "supported",
        nativeGoal: "unsupported",
      },
      allowance: 1,
    });
    assert.throws(
      () => authorizeWorkerValidationRepair(store, task, {
        decision,
        priorAttemptId: "different-attempt",
        verificationEventSequence: 7,
        candidateRevisionId: candidate.id,
        feedback: "repair the failing behavior",
      }),
      /not bound to the decided evidence/,
    );
    const authorization = authorizeWorkerValidationRepair(store, task, {
      decision,
      priorAttemptId: attempt.id,
      verificationEventSequence: 7,
      candidateRevisionId: candidate.id,
      feedback: "repair the failing behavior",
    });
    assert.equal(resolveWorkerValidationRepairHistory(store.listEvents(task.id))[0]?.state, "authorized");
    recordWorkerValidationRepairStarted(store, authorization);
    recordWorkerValidationRepairStarted(store, authorization);
    recordWorkerValidationRepairCompleted(store, {
      authorization,
      attemptId: authorization.attemptId,
      outcome: "failed",
    });
    recordWorkerValidationRepairCompleted(store, {
      authorization,
      attemptId: authorization.attemptId,
      outcome: "failed",
    });
    assert.throws(
      () => recordWorkerValidationRepairCompleted(store, {
        authorization: { ...authorization, evidenceFingerprint: "b".repeat(64) },
        attemptId: authorization.attemptId,
        outcome: "failed",
      }),
      /conflicts with the existing round/,
    );
    const events = store.listEvents(task.id);
    assert.equal(events.filter((event) => event.type === "worker.validation-repair.authorized").length, 1);
    assert.equal(events.filter((event) => event.type === "worker.validation-repair.started").length, 1);
    assert.equal(events.filter((event) => event.type === "worker.validation-repair.completed").length, 1);
    assert.equal(resolveWorkerValidationRepairHistory(events)[0]?.terminalOutcome, "failed");
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("finite repair feedback carries only the sanitized failing diagnostic", () => {
  const verification: VerificationResult = {
    passed: false,
    behaviorPassed: false,
    policyPassed: true,
    sourceCompatible: true,
    commands: [
      {
        command: "npm run typecheck -- --token sk-secret-token-abc",
        exitCode: 1,
        stdout: "passed output must never leak",
        stderr: "src/fix.ts:7:3 - error TS2322: Type 'string' is not assignable to type 'number'.\n"
          + "Authorization: Bearer sk-other-secret-xyz\n"
          + "Found 1 error.",
        durationMs: 9,
        timedOut: false,
      },
      {
        command: "npm run passing",
        exitCode: 0,
        stdout: "all green",
        stderr: "",
        durationMs: 1,
        timedOut: false,
      },
    ],
    diffPath: "/tmp/diff",
    sourceUnchanged: false,
  };
  const feedback = workerValidationRepairFeedback(verification, 1, "/private/tmp/workspace");
  // Useful file/line and error code reach the Worker.
  assert.match(feedback, /src\/fix\.ts:7:3/);
  assert.match(feedback, /error TS2322/);
  assert.match(feedback, /validation-repair round 1/);
  // Secrets, passing output, and command labels with credentials are absent.
  assert.doesNotMatch(feedback, /sk-secret-token-abc/);
  assert.doesNotMatch(feedback, /sk-other-secret-xyz/);
  assert.doesNotMatch(feedback, /Authorization|Bearer/i);
  assert.doesNotMatch(feedback, /all green|npm run passing/);
});

test("malformed Codex repair binding fails closed before any continuation authority", () => {
  const base = { schemaVersion: 1, threadId: "thread-1", objective: "objective" };
  assert.deepEqual(parseCodexGoalBinding(base).threadId, "thread-1");
  assert.throws(
    () => parseCodexGoalBinding({ ...base, authorizationEventSequence: 7 }),
    /invalid; refusing to resume/,
  );
  assert.throws(
    () => parseCodexGoalBinding({ ...base, repairUnit: true, authorizationEventSequence: 7 }),
    /invalid; refusing to resume/,
  );
  assert.throws(
    () => parseCodexGoalBinding({
      ...base,
      correctionUnit: true,
      repairUnit: true,
      authorizationEventSequence: 7,
      validationRepairRound: 1,
    }),
    /invalid; refusing to resume/,
  );
  const repair = parseCodexGoalBinding({
    ...base,
    repairUnit: true,
    authorizationEventSequence: 8,
    validationRepairRound: 2,
  });
  assert.equal(repair.repairUnit, true);
  assert.equal(repair.validationRepairRound, 2);
});
