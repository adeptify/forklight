import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  authorizeExtraAttempt,
  authorizeMainCorrection,
  resolvePendingCorrectionGrant,
  resolvePendingGrantExecutionOptions,
} from "../src/core/attempt-authorization.js";
import { registerTaskFromSpec } from "../src/core/runner.js";
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
