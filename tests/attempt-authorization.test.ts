import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  authorizeExtraAttempt,
  authorizeHandoffRestartRecovery,
  authorizeMainCorrection,
  authorizeSystemRestartRecovery,
  noteRestartContinuationSkipped,
  recordRestartContinuationsForTasks,
  resolvePendingCorrectionGrant,
  resolvePendingGrantExecutionOptions,
  resolvePendingRestartRecoveryGrant,
} from "../src/core/attempt-authorization.js";
import type { CandidateHandoffRecord } from "../src/core/types.js";
import { buildTaskRecord, registerTaskFromSpec } from "../src/core/runner.js";
import { StateStore } from "../src/state/store.js";

async function exhaustedBaseTask(): Promise<{ store: StateStore; taskId: string; sessionId: string }> {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-attempt-auth-"));
  const store = new StateStore(home);
  const task = registerTaskFromSpec(store, {
    version: 1, name: "bounded correction", project: "/tmp/source",
    goal: "Prove sequential grants are bounded", constraints: [],
    provider: { name: "deepseek", model: "deepseek-v4-pro", keychainService: "forklight.test" },
    runtime: { name: "claude-code", executable: "claude", effort: "high", maxBudgetUsd: 1.5 },
    workspace: { exclude: [] },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
    acceptance: { commands: ["true"] },
  }, "forklight://test/attempt-authorization");
  const now = new Date().toISOString();
  for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
    store.createAttempt({ id: `attempt-${ordinal}`, taskId: task.id, ordinal, status: "failed",
      sessionId: task.sessionId, rawLogPath: `/tmp/attempt-${ordinal}.jsonl`,
      startedAt: now, finishedAt: now, exitCode: 1 });
  }
  store.setTaskStatus(task.id, "failed", { error: "Independent verification failed" });
  return { store, taskId: task.id, sessionId: task.sessionId };
}

function addExtraAttempt(store: StateStore, taskId: string, ordinal: number, sessionId: string): void {
  const now = new Date().toISOString();
  store.createAttempt({
    id: `attempt-${ordinal}`, taskId, ordinal, status: "failed",
    sessionId, rawLogPath: `/tmp/attempt-${ordinal}.jsonl`,
    startedAt: now, finishedAt: now, exitCode: 1,
  });
}

function addRunningAttempt(store: StateStore, taskId: string, ordinal: number, sessionId: string): void {
  store.createAttempt({
    id: `attempt-${ordinal}`, taskId, ordinal, status: "running",
    sessionId, rawLogPath: `/tmp/attempt-${ordinal}.jsonl`,
    startedAt: new Date().toISOString(),
  });
}

test("one explicit extra Attempt is authorized", async () => {
  const { store, taskId } = await exhaustedBaseTask();
  try {
    const opts = authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: null,
      reason: "One bounded correction after complete verifier evidence", confirm: true,
    }, 3, 20);
    assert.deepEqual(opts, { maximumOrdinal: 4, maxBudgetUsdOverride: null, authorizationEventSequence: 2 });
    const grants = store.listEvents(taskId).filter((e) => e.type === "attempt.authorization.granted");
    assert.equal(grants.length, 1);
    assert.equal((grants[0]?.payload as Record<string, unknown>)?.targetOrdinal, 4);
  } finally { store.close(); }
});

test("rejects budget over maximum, non-1 additionalAttempts, missing confirm", async () => {
  const { store, taskId } = await exhaustedBaseTask();
  try {
    assert.throws(() => authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: 21, reason: "Too much", confirm: true,
    }, 3, 20), /maximumBudgetUsd/);
    assert.throws(() => authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 2 as unknown as 1, maxBudgetUsd: 2, reason: "Two", confirm: true,
    }, 3, 20), /additionalAttempts must equal 1/);
    assert.throws(() => authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: 2, reason: "Not confirmed", confirm: false as unknown as true,
    }, 3, 20), /requires confirm: true/);
  } finally { store.close(); }
});

test("sequential confirmed corrections within maxExtraAttempts 2", async () => {
  const { store, taskId, sessionId } = await exhaustedBaseTask();
  try {
    const g1 = authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: 1, reason: "First correction", confirm: true,
    }, 3, 20, 2);
    assert.equal(g1.maximumOrdinal, 4);
    addExtraAttempt(store, taskId, 4, sessionId);
    const g2 = authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: 2, reason: "Second correction", confirm: true,
    }, 3, 20, 2);
    assert.equal(g2.maximumOrdinal, 5);
    addExtraAttempt(store, taskId, 5, sessionId);
    assert.throws(() => authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: 3, reason: "Third correction", confirm: true,
    }, 3, 20, 2), /already used/);
    const grants = store.listEvents(taskId).filter((e) => e.type === "attempt.authorization.granted");
    assert.equal(grants.length, 2);
  } finally { store.close(); }
});

test("idempotent recovery when pending grant matches both budget and reason", async () => {
  const { store, taskId } = await exhaustedBaseTask();
  try {
    const g1 = authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: 3.5, reason: "Exact match", confirm: true,
    }, 3, 20, 2);
    const g2 = authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: 3.5, reason: "Exact match", confirm: true,
    }, 3, 20, 2);
    assert.equal(g2.maximumOrdinal, 4);
    assert.equal(g2.authorizationEventSequence, g1.authorizationEventSequence);
    assert.equal(store.listEvents(taskId).filter((e) => e.type === "attempt.authorization.granted").length, 1);
  } finally { store.close(); }
});

test("reason mismatch on pending grant is a conflict", async () => {
  const { store, taskId } = await exhaustedBaseTask();
  try {
    authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: 5, reason: "Original reason", confirm: true,
    }, 3, 20, 2);
    assert.throws(() => authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: 5, reason: "Different reason", confirm: true,
    }, 3, 20, 2), /conflicts with requested authorization/);
    assert.equal(store.listEvents(taskId).filter((e) => e.type === "attempt.authorization.granted").length, 1);
  } finally { store.close(); }
});

test("budget mismatch on pending grant is a conflict", async () => {
  const { store, taskId } = await exhaustedBaseTask();
  try {
    authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: 5, reason: "Same reason", confirm: true,
    }, 3, 20, 2);
    assert.throws(() => authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: 10, reason: "Same reason", confirm: true,
    }, 3, 20, 2), /conflicts with requested authorization/);
    assert.equal(store.listEvents(taskId).filter((e) => e.type === "attempt.authorization.granted").length, 1);
  } finally { store.close(); }
});

test("maxExtraAttempts zero disables new extra grants", async () => {
  const { store, taskId } = await exhaustedBaseTask();
  try {
    assert.throws(() => authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: 2, reason: "Rejected", confirm: true,
    }, 3, 20, 0), /extra attempts are disabled/);
    assert.equal(store.listEvents(taskId).filter((e) => e.type === "attempt.authorization.granted").length, 0);
  } finally { store.close(); }
});

test("malformed or null grant payload makes history corrupt", async () => {
  const { store, taskId } = await exhaustedBaseTask();
  try {
    store.addEvent(taskId, store.getTask(taskId).currentAttemptId,
      "attempt.authorization.granted", "Null payload", null);
    assert.throws(() => authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: 2, reason: "Blocked", confirm: true,
    }, 3, 20, 2), /authorization history is corrupt/);
  } finally { store.close(); }
});

test("duplicate targetOrdinal in grant events is corrupt", async () => {
  const { store, taskId } = await exhaustedBaseTask();
  try {
    authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: 2, reason: "Ordinal 4", confirm: true,
    }, 3, 20, 2);
    const task = store.getTask(taskId);
    store.addEvent(taskId, task.currentAttemptId, "attempt.authorization.granted",
      "Duplicate ordinal", { additionalAttempts: 1, targetOrdinal: 4, maxBudgetUsd: 2,
        reason: "Duplicate", budgetMode: "capped-for-authorized-attempt" });
    assert.throws(() => authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: 3, reason: "Blocked", confirm: true,
    }, 3, 20, 2), /authorization history is corrupt/);
  } finally { store.close(); }
});

test("non-positive budget in persisted grant is corrupt", async () => {
  const { store, taskId } = await exhaustedBaseTask();
  try {
    const task = store.getTask(taskId);
    store.addEvent(taskId, task.currentAttemptId, "attempt.authorization.granted",
      "Zero budget", { additionalAttempts: 1, targetOrdinal: 4, maxBudgetUsd: 0,
        reason: "Zero budget", budgetMode: "capped-for-authorized-attempt" });
    assert.throws(() => authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: 2, reason: "Blocked", confirm: true,
    }, 3, 20, 2), /authorization history is corrupt/);
  } finally { store.close(); }
});

test("untrimmed reason in persisted grant is corrupt", async () => {
  const { store, taskId } = await exhaustedBaseTask();
  try {
    const task = store.getTask(taskId);
    store.addEvent(taskId, task.currentAttemptId, "attempt.authorization.granted",
      "Untrimmed reason", { additionalAttempts: 1, targetOrdinal: 4, maxBudgetUsd: 2,
        reason: "  spaced  ", budgetMode: "capped-for-authorized-attempt" });
    assert.throws(() => authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: 2, reason: "Blocked", confirm: true,
    }, 3, 20, 2), /authorization history is corrupt/);
  } finally { store.close(); }
});

test("oversized reason in persisted grant is corrupt", async () => {
  const { store, taskId } = await exhaustedBaseTask();
  try {
    const task = store.getTask(taskId);
    const longReason = "x".repeat(1001);
    store.addEvent(taskId, task.currentAttemptId, "attempt.authorization.granted",
      "Oversized reason", { additionalAttempts: 1, targetOrdinal: 4, maxBudgetUsd: 2,
        reason: longReason, budgetMode: "capped-for-authorized-attempt" });
    assert.throws(() => authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: 2, reason: "Blocked", confirm: true,
    }, 3, 20, 2), /authorization history is corrupt/);
  } finally { store.close(); }
});

test("extra attempt without matching grant is corrupt", async () => {
  const { store, taskId, sessionId } = await exhaustedBaseTask();
  try {
    addExtraAttempt(store, taskId, 4, sessionId);
    assert.throws(() => authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: 2, reason: "Blocked", confirm: true,
    }, 3, 20, 2), /authorization history is corrupt/);
  } finally { store.close(); }
});

test("running extra attempt blocks the next grant", async () => {
  const { store, taskId, sessionId } = await exhaustedBaseTask();
  try {
    authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: 2, reason: "Ordinal 4", confirm: true,
    }, 3, 20, 2);
    addRunningAttempt(store, taskId, 4, sessionId);
    assert.throws(() => authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: 3, reason: "Ordinal 5 while 4 running", confirm: true,
    }, 3, 20, 2), /non-terminal extra attempt/);
  } finally { store.close(); }
});

test("resolvePendingGrantExecutionOptions: pending returns options, consumed returns null", async () => {
  const { store, taskId, sessionId } = await exhaustedBaseTask();
  try {
    assert.equal(resolvePendingGrantExecutionOptions(store, taskId, 3, 2), null);
    authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: 4, reason: "Pending test", confirm: true,
    }, 3, 20, 2);
    const pending = resolvePendingGrantExecutionOptions(store, taskId, 3, 2);
    assert.ok(pending !== null);
    assert.equal(pending!.maximumOrdinal, 4);
    assert.equal(pending!.maxBudgetUsdOverride, 4);
    addExtraAttempt(store, taskId, 4, sessionId);
    assert.equal(resolvePendingGrantExecutionOptions(store, taskId, 3, 2), null);
  } finally { store.close(); }
});

// --- Main correction authorization tests ---

test("one Main correction is authorized independently from maxExtraAttempts", async () => {
  const { store, taskId } = await exhaustedBaseTask();
  try {
    // maxExtraAttempts=0, maxMainCorrections=1
    const opts = authorizeMainCorrection(store, taskId, {
      feedback: "Fix the import path and rerun checks", maxBudgetUsd: null, confirm: true,
    }, 3, 1, 20);
    assert.equal(opts.maximumOrdinal, 4);
    assert.equal(opts.maxBudgetUsdOverride, null);
    const grants = store.listEvents(taskId).filter((e) => e.type === "attempt.authorization.granted");
    assert.equal(grants.length, 1);
    assert.equal((grants[0]?.payload as Record<string, unknown>)?.kind, "correction");
    assert.equal((grants[0]?.payload as Record<string, unknown>)?.targetOrdinal, 4);
    assert.equal((grants[0]?.payload as Record<string, unknown>)?.reason, "main-correction");
    assert.equal(
      (grants[0]?.payload as Record<string, unknown>)?.feedback,
      "Fix the import path and rerun checks",
    );
  } finally { store.close(); }
});

test("extra retries disabled but one correction allowed", async () => {
  const { store, taskId } = await exhaustedBaseTask();
  try {
    // maxExtraAttempts=0 rejects extra grants
    assert.throws(() => authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: 2, reason: "Extra", confirm: true,
    }, 3, 20, 0), /extra attempts are disabled/);
    // But maxMainCorrections=1 allows a correction
    const opts = authorizeMainCorrection(store, taskId, {
      feedback: "Correct the module boundary", maxBudgetUsd: 1, confirm: true,
    }, 3, 1, 20);
    assert.equal(opts.maximumOrdinal, 4);
    assert.equal(opts.maxBudgetUsdOverride, 1);
  } finally { store.close(); }
});

test("correction cap exhausted rejects second correction", async () => {
  const { store, taskId, sessionId } = await exhaustedBaseTask();
  try {
    authorizeMainCorrection(store, taskId, {
      feedback: "First correction", maxBudgetUsd: null, confirm: true,
    }, 3, 1, 20);
    addExtraAttempt(store, taskId, 4, sessionId);
    assert.throws(() => authorizeMainCorrection(store, taskId, {
      feedback: "Second correction blocked", maxBudgetUsd: null, confirm: true,
    }, 3, 1, 20), /already used/);
  } finally { store.close(); }
});

test("maxMainCorrections zero disables corrections", async () => {
  const { store, taskId } = await exhaustedBaseTask();
  try {
    assert.throws(() => authorizeMainCorrection(store, taskId, {
      feedback: "Rejected", maxBudgetUsd: null, confirm: true,
    }, 3, 0, 20), /Main corrections are disabled/);
  } finally { store.close(); }
});

test("correction idempotent recovery with matching feedback", async () => {
  const { store, taskId } = await exhaustedBaseTask();
  try {
    const g1 = authorizeMainCorrection(store, taskId, {
      feedback: "Exact match correction", maxBudgetUsd: 5, confirm: true,
    }, 3, 2, 20);
    const g2 = authorizeMainCorrection(store, taskId, {
      feedback: "Exact match correction", maxBudgetUsd: 5, confirm: true,
    }, 3, 2, 20);
    assert.equal(g2.maximumOrdinal, 4);
    assert.equal(g2.authorizationEventSequence, g1.authorizationEventSequence);
    assert.equal(
      store.listEvents(taskId).filter((e) => e.type === "attempt.authorization.granted").length,
      1,
    );
  } finally { store.close(); }
});

test("correction feedback mismatch on pending grant is a conflict", async () => {
  const { store, taskId } = await exhaustedBaseTask();
  try {
    authorizeMainCorrection(store, taskId, {
      feedback: "Original feedback", maxBudgetUsd: null, confirm: true,
    }, 3, 1, 20);
    assert.throws(() => authorizeMainCorrection(store, taskId, {
      feedback: "Different feedback", maxBudgetUsd: null, confirm: true,
    }, 3, 1, 20), /conflicts with requested authorization/);
  } finally { store.close(); }
});

test("mixed grant kinds: correction then extra", async () => {
  const { store, taskId, sessionId } = await exhaustedBaseTask();
  try {
    // First a correction
    const c = authorizeMainCorrection(store, taskId, {
      feedback: "Correction first", maxBudgetUsd: null, confirm: true,
    }, 3, 1, 20);
    assert.equal(c.maximumOrdinal, 4);
    addExtraAttempt(store, taskId, 4, sessionId);
    // Then an extra attempt
    const e = authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: null, reason: "Extra second", confirm: true,
    }, 3, 20, 1);
    assert.equal(e.maximumOrdinal, 5);
    // Ordinals remain globally sequential
    const grants = store.listEvents(taskId).filter((ev) => ev.type === "attempt.authorization.granted");
    assert.equal(grants.length, 2);
    assert.equal((grants[0]?.payload as Record<string, unknown>)?.kind, "correction");
    assert.equal((grants[1]?.payload as Record<string, unknown>)?.kind, "extra");
    assert.deepEqual(
      [...store.listAttempts(taskId).map((a) => a.ordinal)].sort(),
      [1, 2, 3, 4],
    );
  } finally { store.close(); }
});

test("mixed grant kinds: extra then correction", async () => {
  const { store, taskId, sessionId } = await exhaustedBaseTask();
  try {
    // First an extra
    const e = authorizeExtraAttempt(store, taskId, {
      additionalAttempts: 1, maxBudgetUsd: null, reason: "Extra first", confirm: true,
    }, 3, 20, 1);
    assert.equal(e.maximumOrdinal, 4);
    addExtraAttempt(store, taskId, 4, sessionId);
    // Then a correction
    const c = authorizeMainCorrection(store, taskId, {
      feedback: "Correction second", maxBudgetUsd: null, confirm: true,
    }, 3, 1, 20);
    assert.equal(c.maximumOrdinal, 5);
  } finally { store.close(); }
});

test("legacy grant without kind remains valid generic-extra", async () => {
  const { store, taskId, sessionId } = await exhaustedBaseTask();
  try {
    // Simulate a legacy grant event without a kind field
    const task = store.getTask(taskId);
    store.addEvent(taskId, task.currentAttemptId, "attempt.authorization.granted",
      "Legacy grant", {
        additionalAttempts: 1, targetOrdinal: 4, maxBudgetUsd: 2,
        reason: "Legacy correction", budgetMode: "capped-for-authorized-attempt",
      });
    // Attempt 4 exists
    addExtraAttempt(store, taskId, 4, sessionId);
    // A new correction should work with ordinal 5
    const c = authorizeMainCorrection(store, taskId, {
      feedback: "New correction after legacy", maxBudgetUsd: null, confirm: true,
    }, 3, 1, 20);
    assert.equal(c.maximumOrdinal, 5);
  } finally { store.close(); }
});

test("pending correction preserves feedback and is never exposed as a generic extra grant", async () => {
  const { store, taskId, sessionId } = await exhaustedBaseTask();
  try {
    assert.equal(resolvePendingCorrectionGrant(store, taskId, 3), null);
    authorizeMainCorrection(store, taskId, {
      feedback: "Pending correction test", maxBudgetUsd: 3, confirm: true,
    }, 3, 1, 20);
    const pending = resolvePendingCorrectionGrant(store, taskId, 3);
    assert.ok(pending !== null);
    assert.equal(pending!.executionOptions.maximumOrdinal, 4);
    assert.equal(pending!.executionOptions.maxBudgetUsdOverride, 3);
    assert.equal(pending!.feedback, "Pending correction test");
    assert.equal(resolvePendingGrantExecutionOptions(store, taskId, 3, 10), null);
    addExtraAttempt(store, taskId, 4, sessionId);
    assert.equal(resolvePendingCorrectionGrant(store, taskId, 3), null);
  } finally { store.close(); }
});

test("correction requires failed or interrupted status", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-corr-status-"));
  const store2 = new StateStore(home);
  try {
    const task = registerTaskFromSpec(store2, {
      version: 1, name: "succeeded task", project: "/tmp/source",
      goal: "Test", constraints: [],
      provider: { name: "deepseek", model: "deepseek-v4-pro", keychainService: "forklight.test" },
      runtime: { name: "claude-code", executable: "claude", effort: "high", maxBudgetUsd: 1.5 },
      workspace: { exclude: [] },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
      acceptance: { commands: ["true"] },
    }, "forklight://test/correction-status");
    store2.setTaskStatus(task.id, "succeeded", { error: null });
    assert.throws(() => authorizeMainCorrection(store2, task.id, {
      feedback: "Can't correct succeeded", maxBudgetUsd: null, confirm: true,
    }, 3, 1, 20), /has not recorded a valid revise/);
  } finally { store2.close(); }
});

test("correction authorized for succeeded task with valid Main revise review", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-corr-succeeded-"));
  const store2 = new StateStore(home);
  try {
    const task = registerTaskFromSpec(store2, {
      version: 1, name: "succeeded revise task", project: "/tmp/source",
      goal: "Test", constraints: [],
      provider: { name: "deepseek", model: "deepseek-v4-pro", keychainService: "forklight.test" },
      runtime: { name: "claude-code", executable: "claude", effort: "high", maxBudgetUsd: 1.5 },
      workspace: { exclude: [] },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
      acceptance: { commands: ["true"] },
    }, "forklight://test/correction-succeeded");
    const now = new Date().toISOString();
    const attempt = {
      id: "s-att-1", taskId: task.id, ordinal: 1, status: "succeeded" as const,
      sessionId: task.sessionId, rawLogPath: "/tmp/s-att-1.jsonl",
      startedAt: now, finishedAt: now, exitCode: 0,
    };
    store2.createAttempt(attempt);
    store2.updateTask(task.id, { currentAttemptId: attempt.id });
    store2.setTaskStatus(task.id, "succeeded", { error: null });
    // Seed verification and Main revise review
    const verEvent = store2.addEvent(task.id, attempt.id, "verification.completed",
      "Independent verification passed", {
        passed: true, behaviorPassed: true, policyPassed: true, sourceCompatible: true,
        commands: [{ command: "true", exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false }],
        diffPath: "/tmp/diff.patch", sourceUnchanged: true,
      });
    store2.addEvent(task.id, attempt.id, "main-review.completed",
      "Main review: revise", {
        decision: "revise", reason: "Keep the useful parts and fix remaining issues",
        attemptId: attempt.id, verificationEventSequence: verEvent.sequence,
      });
    const opts = authorizeMainCorrection(store2, task.id, {
      feedback: "Fix the remaining module boundary", maxBudgetUsd: null, confirm: true,
    }, 3, 1, 20);
    assert.equal(opts.maximumOrdinal, 2);
    const grants = store2.listEvents(task.id).filter((e) => e.type === "attempt.authorization.granted");
    assert.equal(grants.length, 1);
    assert.equal((grants[0]?.payload as Record<string, unknown>)?.kind, "correction");
  } finally { store2.close(); }
});

test("maxExtraAttempts zero does not block correction when maxMainCorrections is one", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-corr-relay-"));
  const store2 = new StateStore(home);
  try {
    const task = registerTaskFromSpec(store2, {
      version: 1, name: "relay task", project: "/tmp/source",
      goal: "Test", constraints: [],
      provider: { name: "deepseek", model: "deepseek-v4-pro", keychainService: "forklight.test" },
      runtime: { name: "claude-code", executable: "claude", effort: "high", maxBudgetUsd: 1.5 },
      workspace: { exclude: [] },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
      acceptance: { commands: ["true"] },
    }, "forklight://test/correction-relay");
    const now = new Date().toISOString();
    const attempt = {
      id: "r-att-1", taskId: task.id, ordinal: 1, status: "succeeded" as const,
      sessionId: task.sessionId, rawLogPath: "/tmp/r-att-1.jsonl",
      startedAt: now, finishedAt: now, exitCode: 0,
    };
    store2.createAttempt(attempt);
    store2.updateTask(task.id, { currentAttemptId: attempt.id });
    store2.setTaskStatus(task.id, "succeeded", { error: null });
    const verEvent = store2.addEvent(task.id, attempt.id, "verification.completed",
      "Independent verification passed", {
        passed: true, behaviorPassed: true, policyPassed: true, sourceCompatible: true,
        commands: [{ command: "true", exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false }],
        diffPath: "/tmp/diff.patch", sourceUnchanged: true,
      });
    store2.addEvent(task.id, attempt.id, "main-review.completed",
      "Main review: revise", {
        decision: "revise", reason: "Minor remaining gaps", attemptId: attempt.id,
        verificationEventSequence: verEvent.sequence,
      });
    // maxExtraAttempts=0 is irrelevant — correction uses maxMainCorrections=1
    const opts = authorizeMainCorrection(store2, task.id, {
      feedback: "Fix the gaps", maxBudgetUsd: null, confirm: true,
    }, 1, 1, 20);
    assert.equal(opts.maximumOrdinal, 2);
  } finally { store2.close(); }
});

// --- System daemon-restart continuation (FL-004) ---

async function interruptedBaseOneTask(): Promise<{
  store: StateStore;
  taskId: string;
  sessionId: string;
  attemptId: string;
}> {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sys-restart-"));
  const store = new StateStore(home);
  const task = registerTaskFromSpec(store, {
    version: 1, name: "native-goal-restart", project: "/tmp/source",
    goal: "Continue the exact native Goal after graceful Daemon restart",
    constraints: [],
    provider: { name: "openai", model: "gpt-5.4", keychainService: "forklight.test" },
    runtime: { name: "codex-cli", executable: "codex", effort: "medium", maxBudgetUsd: 2 },
    workspace: { exclude: [] },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
    acceptance: { commands: ["true"] },
  }, "forklight://test/system-restart");
  const now = new Date().toISOString();
  const attemptId = "sys-restart-attempt-1";
  store.createAttempt({
    id: attemptId,
    taskId: task.id,
    ordinal: 1,
    status: "interrupted",
    sessionId: task.sessionId,
    rawLogPath: "/tmp/sys-restart-1.jsonl",
    startedAt: now,
    finishedAt: now,
    exitCode: 130,
    error: "Worker execution interrupted",
  });
  store.setTaskStatus(task.id, "interrupted", {
    currentAttemptId: attemptId,
    finishedAt: now,
    error: "Worker execution interrupted",
    workerPid: null,
  });
  return { store, taskId: task.id, sessionId: task.sessionId, attemptId };
}

test("system restart continuation is authorized outside baseMaxAttempts=1", async () => {
  const { store, taskId, attemptId } = await interruptedBaseOneTask();
  try {
    const opts = authorizeSystemRestartRecovery(store, taskId, 1);
    assert.ok(opts !== null);
    assert.equal(opts!.maximumOrdinal, 2);
    assert.equal(opts!.maxBudgetUsdOverride, 2);
    const grants = store.listEvents(taskId).filter((e) => e.type === "attempt.authorization.granted");
    assert.equal(grants.length, 1);
    const payload = grants[0]!.payload as Record<string, unknown>;
    assert.equal(payload.kind, "restart-recovery");
    assert.equal(payload.reason, "system-daemon-restart");
    assert.equal(payload.priorAttemptId, attemptId);
    assert.equal(payload.handoffId, undefined);
    assert.equal(payload.targetOrdinal, 2);
    // Not a quality retry or Main correction surface.
    assert.equal(resolvePendingCorrectionGrant(store, taskId, 1), null);
    const pending = resolvePendingRestartRecoveryGrant(store, taskId, 1);
    assert.ok(pending !== null);
    assert.equal(pending!.maximumOrdinal, 2);
    assert.equal(
      pending!.authorizationEventSequence,
      opts!.authorizationEventSequence,
    );
  } finally { store.close(); }
});

test("system restart continuation is idempotent for the exact prior Attempt", async () => {
  const { store, taskId } = await interruptedBaseOneTask();
  try {
    const first = authorizeSystemRestartRecovery(store, taskId, 1);
    const second = authorizeSystemRestartRecovery(store, taskId, 1);
    assert.ok(first !== null && second !== null);
    assert.equal(second!.authorizationEventSequence, first!.authorizationEventSequence);
    assert.equal(
      store.listEvents(taskId).filter((e) => e.type === "attempt.authorization.granted").length,
      1,
    );
  } finally { store.close(); }
});

test("system restart refuses a second recovery after the continuation is consumed", async () => {
  const { store, taskId, sessionId } = await interruptedBaseOneTask();
  try {
    const grant = authorizeSystemRestartRecovery(store, taskId, 1);
    assert.ok(grant !== null);
    const now = new Date().toISOString();
    store.createAttempt({
      id: "sys-restart-attempt-2",
      taskId,
      ordinal: 2,
      status: "interrupted",
      sessionId,
      rawLogPath: "/tmp/sys-restart-2.jsonl",
      startedAt: now,
      finishedAt: now,
      exitCode: 130,
      error: "Interrupted again",
    });
    store.setTaskStatus(taskId, "interrupted", {
      currentAttemptId: "sys-restart-attempt-2",
      finishedAt: now,
      error: "Interrupted again",
    });
    assert.equal(authorizeSystemRestartRecovery(store, taskId, 1), null);
    assert.equal(resolvePendingRestartRecoveryGrant(store, taskId, 1), null);
    assert.equal(
      store.listEvents(taskId).filter((e) => e.type === "attempt.authorization.granted").length,
      1,
    );
  } finally { store.close(); }
});

test("system restart fails closed after verification and for non-interrupted work", async () => {
  const { store, taskId, attemptId } = await interruptedBaseOneTask();
  try {
    store.addEvent(taskId, attemptId, "verification.completed", "Independent verification passed", {
      passed: true, behaviorPassed: true, policyPassed: true, sourceCompatible: true,
      commands: [], diffPath: "/tmp/diff.patch", sourceUnchanged: true,
    });
    assert.equal(authorizeSystemRestartRecovery(store, taskId, 1), null);

    // Reset evidence: failed (not interrupted) latest Attempt is ineligible.
    const home2 = await mkdtemp(path.join(tmpdir(), "forklight-sys-restart-fail-"));
    const store2 = new StateStore(home2);
    const task = registerTaskFromSpec(store2, {
      version: 1, name: "failed-not-interrupted", project: "/tmp/source",
      goal: "No restart", constraints: [],
      provider: { name: "deepseek", model: "deepseek-v4-flash", keychainService: "forklight.test" },
      runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: 1 },
      workspace: { exclude: [] },
      worker: { allowEdits: false, allowedCommands: [], focusPaths: ["src"] },
      acceptance: { commands: ["true"] },
    }, "forklight://test/system-restart-failed");
    const now = new Date().toISOString();
    store2.createAttempt({
      id: "fail-1", taskId: task.id, ordinal: 1, status: "failed",
      sessionId: task.sessionId, rawLogPath: "/tmp/fail-1.jsonl",
      startedAt: now, finishedAt: now, exitCode: 1, error: "model failed",
    });
    store2.setTaskStatus(task.id, "failed", { error: "model failed", currentAttemptId: "fail-1" });
    assert.equal(authorizeSystemRestartRecovery(store2, task.id, 1), null);
    store2.close();
  } finally { store.close(); }
});

test("system restart grant rejects mixed handoff identity as corrupt history", async () => {
  const { store, taskId, attemptId } = await interruptedBaseOneTask();
  try {
    // Mixed identity is corrupt for the system scope.
    store.addEvent(taskId, attemptId, "attempt.authorization.granted",
      "Corrupt mixed restart grant", {
        kind: "restart-recovery",
        additionalAttempts: 1,
        targetOrdinal: 2,
        maxBudgetUsd: 2,
        budgetMode: "capped-for-authorized-attempt",
        reason: "system-daemon-restart",
        priorAttemptId: attemptId,
        handoffId: "handoff-should-not-be-here",
      });
    assert.throws(
      () => resolvePendingRestartRecoveryGrant(store, taskId, 1),
      /authorization history is corrupt/,
    );
  } finally { store.close(); }
});

test("legacy handoff restart grant remains readable and idempotent", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-handoff-restart-legacy-"));
  const handoffStore = new StateStore(home);
  try {
    const task = registerTaskFromSpec(handoffStore, {
      version: 1, name: "handoff-successor", project: "/tmp/source",
      goal: "Handoff restart", constraints: [],
      provider: { name: "deepseek", model: "deepseek-v4-flash", keychainService: "forklight.test" },
      runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: null },
      workspace: { exclude: [] },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
      acceptance: { commands: ["true"] },
    }, "forklight://test/handoff-restart");
    const now = new Date().toISOString();
    const attemptId = "handoff-attempt-1";
    handoffStore.createAttempt({
      id: attemptId, taskId: task.id, ordinal: 1, status: "interrupted",
      sessionId: task.sessionId, rawLogPath: "/tmp/handoff-1.jsonl",
      startedAt: now, finishedAt: now, exitCode: 130,
      error: "ForkLight daemon restarted during execution",
    });
    handoffStore.setTaskStatus(task.id, "interrupted", {
      currentAttemptId: attemptId, finishedAt: now,
      error: "ForkLight daemon restarted during execution",
    });
    const first = authorizeHandoffRestartRecovery(handoffStore, task.id, "handoff-id-1", 1);
    const second = authorizeHandoffRestartRecovery(handoffStore, task.id, "handoff-id-1", 1);
    assert.ok(first !== null && second !== null);
    assert.equal(first!.authorizationEventSequence, second!.authorizationEventSequence);
    const payload = handoffStore.listEvents(task.id)
      .find((e) => e.type === "attempt.authorization.granted")!
      .payload as Record<string, unknown>;
    assert.equal(payload.reason, "handoff-daemon-restart");
    assert.equal(payload.handoffId, "handoff-id-1");
  } finally { handoffStore.close(); }
});

test("recordRestartContinuationsForTasks grants only eligible interrupted Tasks", async () => {
  const { store, taskId, attemptId } = await interruptedBaseOneTask();
  try {
    // Ineligible sibling: succeeded Task must not receive a grant.
    const other = registerTaskFromSpec(store, {
      version: 1, name: "already-done", project: "/tmp/source",
      goal: "Done", constraints: [],
      provider: { name: "deepseek", model: "deepseek-v4-flash", keychainService: "forklight.test" },
      runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: 1 },
      workspace: { exclude: [] },
      worker: { allowEdits: false, allowedCommands: [], focusPaths: ["src"] },
      acceptance: { commands: ["true"] },
    }, "forklight://test/system-restart-done");
    store.setTaskStatus(other.id, "succeeded", { error: null });

    recordRestartContinuationsForTasks(store, [taskId, other.id], () => 1);
    recordRestartContinuationsForTasks(store, [taskId, other.id], () => 1);

    const grants = store.listEvents(taskId).filter((e) => e.type === "attempt.authorization.granted");
    assert.equal(grants.length, 1);
    assert.equal((grants[0]!.payload as { priorAttemptId?: string }).priorAttemptId, attemptId);
    assert.equal(
      store.listEvents(other.id).filter((e) => e.type === "attempt.authorization.granted").length,
      0,
    );
    // Ineligible sibling is observable without raw error content.
    const skips = store.listEvents(other.id).filter(
      (e) => e.type === "attempt.restart-continuation.skipped",
    );
    assert.equal(skips.length, 1);
    assert.equal(
      (skips[0]!.payload as { reasonCode?: string }).reasonCode,
      "ineligible",
    );
  } finally { store.close(); }
});

test("pending restart grant fails closed on stale prior Attempt", async () => {
  const { store, taskId, attemptId } = await interruptedBaseOneTask();
  try {
    // Inject a pending grant bound to a non-latest prior Attempt id.
    store.addEvent(
      taskId,
      attemptId,
      "attempt.authorization.granted",
      "Stale prior restart grant",
      {
        kind: "restart-recovery",
        additionalAttempts: 1,
        targetOrdinal: 2,
        maxBudgetUsd: 2,
        budgetMode: "capped-for-authorized-attempt",
        reason: "system-daemon-restart",
        priorAttemptId: "not-the-latest-attempt",
      },
    );
    assert.notEqual(attemptId, "not-the-latest-attempt");
    assert.equal(resolvePendingRestartRecoveryGrant(store, taskId, 1), null);
    const skips = store.listEvents(taskId).filter(
      (e) => e.type === "attempt.restart-continuation.skipped",
    );
    assert.equal(skips.length, 1);
    assert.equal(
      (skips[0]!.payload as { reasonCode?: string }).reasonCode,
      "stale-attempt",
    );
    // Idempotent observability for repeated recover loops.
    noteRestartContinuationSkipped(store, taskId, "stale-attempt");
    assert.equal(
      store.listEvents(taskId).filter(
        (e) => e.type === "attempt.restart-continuation.skipped",
      ).length,
      1,
    );
  } finally { store.close(); }
});

test("malformed restart grant history fails closed without launching", async () => {
  const { store, taskId, attemptId } = await interruptedBaseOneTask();
  try {
    store.addEvent(taskId, attemptId, "attempt.authorization.granted",
      "Malformed restart grant", {
        kind: "restart-recovery",
        additionalAttempts: 1,
        targetOrdinal: 2,
        maxBudgetUsd: 2,
        budgetMode: "capped-for-authorized-attempt",
        reason: "not-a-valid-restart-reason",
        priorAttemptId: attemptId,
      });
    assert.throws(
      () => resolvePendingRestartRecoveryGrant(store, taskId, 1),
      /authorization history is corrupt/,
    );
    assert.throws(
      () => authorizeSystemRestartRecovery(store, taskId, 1),
      /authorization history is corrupt/,
    );
  } finally { store.close(); }
});

// --- FL-004 follow-up: one canonical exact restart validator for every
// pending-options consumer (manual resume, CLI fallback, Coordinator
// execution reconstruction, handoff recovery). ---

test("generic resolver exact-validates a valid system restart grant through the canonical validator", async () => {
  const { store, taskId, sessionId } = await interruptedBaseOneTask();
  try {
    const grant = authorizeSystemRestartRecovery(store, taskId, 1);
    assert.ok(grant !== null);
    const pending = resolvePendingGrantExecutionOptions(store, taskId, 1, 2);
    assert.ok(pending !== null);
    assert.deepEqual(pending, grant);
    // Valid continuations are refused nowhere: no skip event is observable.
    assert.equal(
      store.listEvents(taskId).filter(
        (e) => e.type === "attempt.restart-continuation.skipped",
      ).length,
      0,
    );
    // A consumed continuation never re-appears through the generic resolver.
    const now = new Date().toISOString();
    store.createAttempt({
      id: "generic-consume-2", taskId, ordinal: 2, status: "interrupted",
      sessionId, rawLogPath: "/tmp/generic-consume-2.jsonl",
      startedAt: now, finishedAt: now, exitCode: 130,
      error: "Interrupted again",
    });
    store.setTaskStatus(taskId, "interrupted", {
      currentAttemptId: "generic-consume-2", finishedAt: now, error: "Interrupted again",
    });
    assert.equal(resolvePendingGrantExecutionOptions(store, taskId, 1, 2), null);
  } finally { store.close(); }
});

test("generic resolver refuses a stale restart grant and binds skip to the authoritative Attempt", async () => {
  const { store, taskId, attemptId } = await interruptedBaseOneTask();
  try {
    store.addEvent(taskId, attemptId, "attempt.authorization.granted",
      "Stale prior restart grant", {
        kind: "restart-recovery",
        additionalAttempts: 1,
        targetOrdinal: 2,
        maxBudgetUsd: 2,
        budgetMode: "capped-for-authorized-attempt",
        reason: "system-daemon-restart",
        priorAttemptId: "not-the-latest-attempt",
      });
    assert.equal(resolvePendingGrantExecutionOptions(store, taskId, 1, 2), null);
    const skips = store.listEvents(taskId).filter(
      (e) => e.type === "attempt.restart-continuation.skipped",
    );
    assert.equal(skips.length, 1);
    assert.equal(
      (skips[0]!.payload as { reasonCode?: string }).reasonCode,
      "stale-attempt",
    );
    // The refusal is linked to the authoritative existing Attempt, never the
    // forged priorAttemptId carried by the stale grant.
    assert.equal(skips[0]!.attemptId, attemptId);
  } finally { store.close(); }
});

test("generic resolver refuses a handoff grant with no matching durable handoff record", async () => {
  const { store, taskId, attemptId } = await interruptedBaseOneTask();
  try {
    store.addEvent(taskId, attemptId, "attempt.authorization.granted",
      "Missing handoff grant", {
        kind: "restart-recovery",
        additionalAttempts: 1,
        targetOrdinal: 2,
        maxBudgetUsd: 2,
        budgetMode: "capped-for-authorized-attempt",
        reason: "handoff-daemon-restart",
        priorAttemptId: attemptId,
        handoffId: "missing-handoff-id",
      });
    assert.equal(resolvePendingGrantExecutionOptions(store, taskId, 1, 2), null);
    const skips = store.listEvents(taskId).filter(
      (e) => e.type === "attempt.restart-continuation.skipped",
    );
    assert.equal(skips.length, 1);
    assert.equal(
      (skips[0]!.payload as { reasonCode?: string }).reasonCode,
      "scope-mismatch",
    );
    assert.equal(skips[0]!.attemptId, attemptId);
  } finally { store.close(); }
});

test("generic resolver refuses a restart grant after verification completes", async () => {
  const { store, taskId, attemptId } = await interruptedBaseOneTask();
  try {
    authorizeSystemRestartRecovery(store, taskId, 1);
    store.addEvent(taskId, attemptId, "verification.completed",
      "Independent verification passed", {
        passed: true, behaviorPassed: true, policyPassed: true, sourceCompatible: true,
        commands: [], diffPath: "/tmp/diff.patch", sourceUnchanged: true,
      });
    assert.equal(resolvePendingGrantExecutionOptions(store, taskId, 1, 2), null);
    const skips = store.listEvents(taskId).filter(
      (e) => e.type === "attempt.restart-continuation.skipped",
    );
    assert.equal(skips.length, 1);
    assert.equal(
      (skips[0]!.payload as { reasonCode?: string }).reasonCode,
      "verification-complete",
    );
    assert.equal(skips[0]!.attemptId, attemptId);
  } finally { store.close(); }
});

test("generic resolver fails closed on corrupt restart grant history", async () => {
  const { store, taskId, attemptId } = await interruptedBaseOneTask();
  try {
    store.addEvent(taskId, attemptId, "attempt.authorization.granted",
      "Corrupt restart grant", {
        kind: "restart-recovery",
        additionalAttempts: 1,
        targetOrdinal: 2,
        maxBudgetUsd: 2,
        budgetMode: "capped-for-authorized-attempt",
        reason: "not-a-valid-restart-reason",
        priorAttemptId: attemptId,
      });
    assert.throws(
      () => resolvePendingGrantExecutionOptions(store, taskId, 1, 2),
      /authorization history is corrupt/,
    );
  } finally { store.close(); }
});

test("generic resolver resolves a valid handoff restart grant exactly once against a durable handoff", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-handoff-generic-"));
  const store = new StateStore(home);
  try {
    const now = new Date().toISOString();
    const source = registerTaskFromSpec(store, {
      version: 1, name: "handoff-source", project: "/tmp/source",
      goal: "Handoff origin", constraints: [],
      provider: { name: "deepseek", model: "deepseek-v4-flash", keychainService: "forklight.test" },
      runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: 1 },
      workspace: { exclude: [] },
      worker: { allowEdits: false, allowedCommands: [], focusPaths: ["src"] },
      acceptance: { commands: ["true"] },
    }, "forklight://test/handoff-generic");
    const successor = buildTaskRecord({
      spec: {
        version: 1, name: "handoff-successor", project: "/tmp/source",
        goal: "Handoff continuation", constraints: [],
        provider: { name: "openai", model: "gpt-5.4", keychainService: "forklight.test" },
        runtime: { name: "codex-cli", executable: "codex", effort: "medium", maxBudgetUsd: 2 },
        workspace: { exclude: [] },
        worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
        acceptance: { commands: ["true"] },
      },
      taskFile: "/tmp/handoff.yaml",
      home: path.dirname(store.databasePath),
      id: "handoff-successor-1",
      sessionId: "handoff-session-1",
      createdAt: now,
    });
    const record: CandidateHandoffRecord = {
      schemaVersion: 1,
      id: "handoff-id-1",
      status: "prepared",
      origin: { kind: "goal-task", goalId: "goal-1", itemId: "item-1" },
      sourceTaskId: source.id,
      sourceCandidateRevisionId: "rev-1",
      sourcePatchDigest: "a".repeat(64),
      gapContractDigest: "b".repeat(64),
      reusablePathCount: 1,
      remainingGapCount: 0,
      reusablePaths: ["src/a.ts"],
      remainingGaps: [],
      destinationWorkerProfileId: "grok-builder",
      destinationIdentity: {
        provider: "openai", model: "gpt-5.4", runtime: "codex-cli",
        effort: "medium", workerProfileId: "grok-builder",
      },
      successorTaskId: successor.id,
      reason: "Hand the module to another Worker",
      createdAt: now,
      updatedAt: now,
      nextAction: "wait-for-successor",
    };
    store.createCandidateHandoff({
      record,
      task: successor,
      authorizationEvent: {
        summary: "Test handoff authorized",
        payload: { handoffId: record.id },
      },
    });
    // Interrupt the successor before independent verification.
    const attemptId = "handoff-attempt-1";
    store.createAttempt({
      id: attemptId, taskId: successor.id, ordinal: 1, status: "interrupted",
      sessionId: successor.sessionId, rawLogPath: "/tmp/handoff-1.jsonl",
      startedAt: now, finishedAt: now, exitCode: 130,
      error: "ForkLight daemon restarted during execution",
    });
    store.setTaskStatus(successor.id, "interrupted", {
      currentAttemptId: attemptId, finishedAt: now,
      error: "ForkLight daemon restarted during execution", workerPid: null,
    });
    const grant = authorizeHandoffRestartRecovery(store, successor.id, record.id, 1);
    assert.ok(grant !== null);
    assert.equal(grant!.maximumOrdinal, 2);
    // The generic resolver delegates to the canonical exact validator, which
    // requires the durable handoff identity to match the grant.
    const pending = resolvePendingGrantExecutionOptions(store, successor.id, 1, 2);
    assert.ok(pending !== null);
    assert.deepEqual(pending, grant);
    assert.equal(
      store.listEvents(successor.id).filter(
        (e) => e.type === "attempt.authorization.granted",
      ).length,
      1,
      "generic resolver must reuse the durable grant, not mint another",
    );
    assert.equal(
      store.listEvents(successor.id).filter(
        (e) => e.type === "attempt.restart-continuation.skipped",
      ).length,
      0,
    );
  } finally { store.close(); }
});
