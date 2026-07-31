/**
 * Main-direct execution decision — comprehensive test suite.
 *
 * Covers: start validation, close validation, immutability, idempotency,
 * privacy-safe projection, persistence across restarts, no Worker side effects,
 * aggregate correctness, and legacy-stat stability.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { StateStore } from "../src/state/store.js";
import {
  createMainDirectDecision,
  validateMainDirectStart,
  validateMainDirectClose,
  isIdenticalClose,
  projectMainDirectDecision,
  projectMainDirectDecisionList,
  computeMainDirectAggregate,
  selectMainDirectRecentEntries,
  MAIN_DIRECT_RECENT_LIMIT,
  type MainDirectStartInput,
  type MainDirectStartContext,
} from "../src/core/main-direct-execution-decision.js";
import type {
  MainDirectDecisionRecord,
  MainDirectClosedState,
} from "../src/core/types.js";
import { cloneDefaults } from "../src/core/settings.js";
import { defaultWorkerProfiles } from "../src/core/worker-profiles.js";
import { isoTimestamp } from "../src/core/time.js";

// --- Helpers ---

function makeContext(overrides: Partial<MainDirectStartContext> = {}): MainDirectStartContext {
  const defaults = cloneDefaults();
  const providerDef = defaults.providerDefaults;
  const wp = defaults.workerProfiles ?? defaultWorkerProfiles(defaults.execution, providerDef);
  return {
    workerProfiles: wp,
    modelCatalog: defaults.modelCatalog,
    providerDefaults: providerDef,
    providers: {
      deepseek: { ready: true, authMode: "api-key" as const, endpoint: providerDef.deepseek.defaultEndpoint, defaultModel: providerDef.deepseek.defaultModel, keychainService: providerDef.deepseek.defaultKeychainService },
      qwen: { ready: true, authMode: "api-key" as const, endpoint: providerDef.qwen.defaultEndpoint, defaultModel: providerDef.qwen.defaultModel, keychainService: providerDef.qwen.defaultKeychainService },
      glm: { ready: true, authMode: "api-key" as const, endpoint: providerDef.glm.defaultEndpoint, defaultModel: providerDef.glm.defaultModel, keychainService: providerDef.glm.defaultKeychainService },
      minimax: { ready: false, authMode: "none" as const, endpoint: providerDef.minimax.defaultEndpoint, defaultModel: providerDef.minimax.defaultModel, keychainService: providerDef.minimax.defaultKeychainService, error: "not configured" },
      volcengine: { ready: false, authMode: "none" as const, endpoint: providerDef.volcengine.defaultEndpoint, defaultModel: providerDef.volcengine.defaultModel, keychainService: providerDef.volcengine.defaultKeychainService, error: "not configured" },
      xai: { ready: false, authMode: "none" as const, endpoint: providerDef.xai.defaultEndpoint, defaultModel: providerDef.xai.defaultModel, keychainService: providerDef.xai.defaultKeychainService, error: "not configured" },
    },
    runtimes: {
      "claude-code": { ok: true },
      "grok-build": { ok: true },
    },
    ...overrides,
  };
}

function makeStartInput(overrides: Partial<MainDirectStartInput> = {}): MainDirectStartInput {
  return {
    taskClass: "test-class",
    reason: "small-clear-change",
    note: "This is a small clear change that Main handles directly.",
    consideredWorkerProfileIds: [],
    confirm: true,
    ...overrides,
  };
}

// --- Start validation tests ---

test("main-direct start validates input and creates immutable open decision", () => {
  const input = makeStartInput();
  const context = makeContext();
  const { consideredWorkers, evidenceSnapshot } = validateMainDirectStart(input, context, []);
  assert.ok(Array.isArray(consideredWorkers));
  const record = createMainDirectDecision(input, consideredWorkers, evidenceSnapshot);
  assert.ok(typeof record.id === "string" && record.id.length > 0);
  assert.equal(record.status, "open");
  assert.equal(record.taskClass, "test-class");
  assert.equal(record.reason, "small-clear-change");
  assert.ok(record.startedAt.length > 0);
  assert.equal(record.consideredWorkerProfileIds.length, 0);
  assert.equal(record.closedState, undefined);
});

test("main-direct start rejects without confirm", () => {
  const input = makeStartInput({ confirm: undefined as unknown as true });
  const context = makeContext();
  assert.throws(() => validateMainDirectStart(input, context, []), /confirm: true/);
});

test("main-direct start rejects invalid reason code", () => {
  const input = makeStartInput({ reason: "invalid-reason" as MainDirectStartInput["reason"] });
  const context = makeContext();
  assert.throws(() => validateMainDirectStart(input, context, []), /reason must be one of/);
});

test("main-direct start rejects duplicate considered profiles", () => {
  const input = makeStartInput({ consideredWorkerProfileIds: ["a", "a"] });
  const context = makeContext();
  assert.throws(() => validateMainDirectStart(input, context, []), /Duplicate/);
});

test("main-direct evidence scope requires every considered Worker to meet one configured threshold", () => {
  const base = makeContext();
  const first = base.workerProfiles.profiles[0]!;
  const second = base.workerProfiles.profiles[1]!;
  const key = (profile: typeof first) => [
    profile.provider ?? "",
    profile.model ?? "",
    profile.runtime,
    profile.effort ?? "medium",
  ].join("\0");
  const context = makeContext({
    routingEvidence: {
      exact: new Map([
        [key(first), { relevantSampleCount: 5 }],
        [key(second), { relevantSampleCount: 4 }],
      ]),
      family: new Map([
        [key(first), { relevantSampleCount: 7 }],
        [key(second), { relevantSampleCount: 5 }],
      ]),
      minRelevantSamples: 5,
      familyMinRelevantSamples: 5,
    },
  });
  const input = makeStartInput({
    taskFamily: "maintenance",
    consideredWorkerProfileIds: [first.id, second.id],
  });
  const { evidenceSnapshot } = validateMainDirectStart(input, context);
  assert.deepEqual(evidenceSnapshot.map((entry) => entry.scope), ["task-family", "task-family"]);
  assert.deepEqual(evidenceSnapshot.map((entry) => entry.exactClassSampleCount), [5, 4]);
  assert.deepEqual(evidenceSnapshot.map((entry) => entry.familySampleCount), [7, 5]);
});

test("main-direct start rejects too many considered profiles", () => {
  const input = makeStartInput({ consideredWorkerProfileIds: ["a", "b", "c", "d", "e"] });
  const context = makeContext();
  assert.throws(() => validateMainDirectStart(input, context, []), /at most 4/);
});

test("main-direct start rejects empty taskClass", () => {
  const input = makeStartInput({ taskClass: "" });
  const context = makeContext();
  assert.throws(() => validateMainDirectStart(input, context, []), /1-80/);
});

test("main-direct start rejects empty note", () => {
  const input = makeStartInput({ note: "" });
  const context = makeContext();
  assert.throws(() => validateMainDirectStart(input, context, []), /1-300/);
});

test("main-direct start rejects oversize note", () => {
  const input = makeStartInput({ note: "x".repeat(301) });
  const context = makeContext();
  assert.throws(() => validateMainDirectStart(input, context, []), /1-300/);
});

test("main-direct start freezes considered Worker identity without Provider probe", () => {
  const input = makeStartInput({ taskClass: "config-patch" });
  const context = makeContext();
  const { consideredWorkers, evidenceSnapshot } = validateMainDirectStart(input, context, []);
  assert.equal(consideredWorkers.length, 0);
  assert.equal(evidenceSnapshot.length, 0);
});

test("main-direct start persists and replays through Store", () => {
  const home = `/tmp/forklight-mdd-start-${randomUUID()}`;
  const store = new StateStore(home);
  const input = makeStartInput({ taskClass: "store-test" });
  const context = makeContext();
  const { consideredWorkers, evidenceSnapshot } = validateMainDirectStart(input, context, []);
  const record = createMainDirectDecision(input, consideredWorkers, evidenceSnapshot);
  store.saveMainDirectDecision(record);

  const reloaded = store.getMainDirectDecision(record.id);
  assert.equal(reloaded.id, record.id);
  assert.equal(reloaded.status, "open");
  assert.equal(reloaded.taskClass, "store-test");
  store.close();
});

// --- Close validation tests ---

test("main-direct close as completed with verification", () => {
  const input = makeStartInput({ taskClass: "close-test" });
  const context = makeContext();
  const { consideredWorkers, evidenceSnapshot } = validateMainDirectStart(input, context, []);
  const record = createMainDirectDecision(input, consideredWorkers, evidenceSnapshot);

  const closeInput = {
    id: record.id,
    outcome: "completed" as const,
    verification: "passed" as const,
    note: "All checks passed locally.",
    confirm: true as const,
  };
  const closedState = validateMainDirectClose(closeInput, record);
  assert.equal(closedState.outcome, "completed");
  assert.equal(closedState.verification, "passed");
});

test("main-direct close as abandoned without verification", () => {
  const input = makeStartInput({ taskClass: "abandon-test" });
  const context = makeContext();
  const { consideredWorkers, evidenceSnapshot } = validateMainDirectStart(input, context, []);
  const record = createMainDirectDecision(input, consideredWorkers, evidenceSnapshot);

  const closeInput = {
    id: record.id,
    outcome: "abandoned" as const,
    note: "Not worth completing.",
    confirm: true as const,
  };
  const closedState = validateMainDirectClose(closeInput, record);
  assert.equal(closedState.outcome, "abandoned");
  assert.equal(closedState.verification, undefined);
});

test("main-direct close rejects completed without verification", () => {
  const input = makeStartInput({ taskClass: "missing-verify" });
  const context = makeContext();
  const { consideredWorkers, evidenceSnapshot } = validateMainDirectStart(input, context, []);
  const record = createMainDirectDecision(input, consideredWorkers, evidenceSnapshot);

  assert.throws(
    () => validateMainDirectClose(
      { id: record.id, outcome: "completed", note: "Missing verification.", confirm: true },
      record,
    ),
    /verification must be/,
  );
});

test("main-direct close rejects abandoned with verification", () => {
  const input = makeStartInput({ taskClass: "extra-verify" });
  const context = makeContext();
  const { consideredWorkers, evidenceSnapshot } = validateMainDirectStart(input, context, []);
  const record = createMainDirectDecision(input, consideredWorkers, evidenceSnapshot);

  assert.throws(
    () => validateMainDirectClose(
      { id: record.id, outcome: "abandoned", verification: "passed", note: "Extra verification.", confirm: true },
      record,
    ),
    /verification must be absent/,
  );
});

test("main-direct close rejects without confirm", () => {
  const input = makeStartInput({ taskClass: "no-confirm" });
  const context = makeContext();
  const { consideredWorkers, evidenceSnapshot } = validateMainDirectStart(input, context, []);
  const record = createMainDirectDecision(input, consideredWorkers, evidenceSnapshot);

  assert.throws(
    () => validateMainDirectClose(
      { id: record.id, outcome: "completed", verification: "passed", note: "No confirm.", confirm: undefined as unknown as true },
      record,
    ),
    /confirm: true/,
  );
});

test("main-direct close rejects already-closed decision with different outcome", () => {
  const input = makeStartInput({ taskClass: "already-closed" });
  const context = makeContext();
  const { consideredWorkers, evidenceSnapshot } = validateMainDirectStart(input, context, []);
  const record = createMainDirectDecision(input, consideredWorkers, evidenceSnapshot);

  const firstClose = validateMainDirectClose(
    { id: record.id, outcome: "completed", verification: "passed", note: "First close.", confirm: true },
    record,
  );
  const closed = { ...record, status: "completed" as const, closedState: firstClose };

  assert.throws(
    () => validateMainDirectClose(
      { id: record.id, outcome: "abandoned", note: "Different close.", confirm: true },
      closed,
    ),
    /already completed/,
  );
});

test("main-direct close — idempotent identical close detection", () => {
  const state: MainDirectClosedState = {
    outcome: "completed",
    verification: "passed",
    note: "Identical test.",
    closedAt: isoTimestamp(),
  };
  assert.ok(isIdenticalClose(state, state));

  const different: MainDirectClosedState = { ...state, note: "Different note." };
  assert.equal(isIdenticalClose(state, different), false);
});

test("main-direct close — isIdenticalClose detects different outcomes", () => {
  const a: MainDirectClosedState = {
    outcome: "completed", verification: "passed", note: "Test.", closedAt: isoTimestamp(),
  };
  const b: MainDirectClosedState = {
    outcome: "abandoned", note: "Test.", closedAt: isoTimestamp(),
  };
  assert.equal(isIdenticalClose(a, b), false);
});

// --- Projection tests ---

test("main-direct projection — privacy-safe open decision", () => {
  const input = makeStartInput({ taskClass: "projection-test", taskFamily: "testing" });
  const context = makeContext();
  const { consideredWorkers, evidenceSnapshot } = validateMainDirectStart(input, context, []);
  const record = createMainDirectDecision(input, consideredWorkers, evidenceSnapshot);

  const projection = projectMainDirectDecision(record);
  assert.equal(projection.id, record.id);
  assert.equal(projection.taskClass, "projection-test");
  assert.equal(projection.taskFamily, "testing");
  assert.equal(projection.status, "open");
  assert.equal(projection.outcome, undefined);
  assert.equal(projection.verification, undefined);
  assert.equal(projection.consideredWorkerCount, 0);
  assert.ok(Array.isArray(projection.consideredWorkerIds));
  assert.ok(Array.isArray(projection.consideredWorkerLabels));
});

test("main-direct projection — closed decision with verification", () => {
  const input = makeStartInput({ taskClass: "projection-closed" });
  const context = makeContext();
  const { consideredWorkers, evidenceSnapshot } = validateMainDirectStart(input, context, []);
  const record = createMainDirectDecision(input, consideredWorkers, evidenceSnapshot);
  const closed: MainDirectDecisionRecord = {
    ...record,
    status: "completed",
    closedState: { outcome: "completed", verification: "passed", note: "Done.", closedAt: isoTimestamp() },
  };

  const projection = projectMainDirectDecision(closed);
  assert.equal(projection.status, "completed");
  assert.equal(projection.outcome, "completed");
  assert.equal(projection.verification, "passed");
});

test("main-direct projection — empty list", () => {
  const projections = projectMainDirectDecisionList([]);
  assert.ok(Array.isArray(projections));
  assert.equal(projections.length, 0);
});

// --- Aggregate tests ---

test("main-direct aggregate — empty records produce zero aggregate", () => {
  const agg = computeMainDirectAggregate([]);
  assert.equal(agg.totalCount, 0);
  assert.equal(agg.openCount, 0);
  assert.equal(agg.completedCount, 0);
  assert.equal(agg.abandonedCount, 0);
  assert.deepEqual(agg.reasonDistribution, {});
});

test("main-direct aggregate — correctly counts open, completed, and abandoned", () => {
  const records: MainDirectDecisionRecord[] = [
    { id: "1", taskClass: "a", reason: "small-clear-change", note: "", consideredWorkerProfileIds: [], consideredWorkers: [], evidenceSnapshot: [], status: "open", startedAt: new Date().toISOString() },
    { id: "2", taskClass: "b", reason: "urgent-fix", note: "", consideredWorkerProfileIds: [], consideredWorkers: [], evidenceSnapshot: [], status: "completed", startedAt: new Date().toISOString(), closedState: { outcome: "completed", verification: "passed", note: "", closedAt: new Date().toISOString() } },
    { id: "3", taskClass: "c", reason: "main-judgment", note: "", consideredWorkerProfileIds: [], consideredWorkers: [], evidenceSnapshot: [], status: "abandoned", startedAt: new Date().toISOString(), closedState: { outcome: "abandoned", note: "", closedAt: new Date().toISOString() } },
    { id: "4", taskClass: "d", reason: "small-clear-change", note: "", consideredWorkerProfileIds: [], consideredWorkers: [], evidenceSnapshot: [], status: "completed", startedAt: new Date().toISOString(), closedState: { outcome: "completed", verification: "failed", note: "", closedAt: new Date().toISOString() } },
    { id: "5", taskClass: "e", reason: "small-clear-change", note: "", consideredWorkerProfileIds: [], consideredWorkers: [], evidenceSnapshot: [], status: "completed", startedAt: new Date().toISOString(), closedState: { outcome: "completed", verification: "unavailable", note: "", closedAt: new Date().toISOString() } },
  ];

  const agg = computeMainDirectAggregate(records);
  assert.equal(agg.totalCount, 5);
  assert.equal(agg.openCount, 1);
  assert.equal(agg.completedCount, 3);
  assert.equal(agg.abandonedCount, 1);
  assert.equal(agg.completedPassedCount, 1);
  assert.equal(agg.completedFailedCount, 1);
  assert.equal(agg.completedUnavailableCount, 1);
  assert.equal(agg.reasonDistribution["small-clear-change"], 3);
  assert.equal(agg.reasonDistribution["urgent-fix"], 1);
  assert.equal(agg.reasonDistribution["main-judgment"], 1);
});

// --- Recent entries tests ---

test("main-direct recent — empty records produce empty recent entries", () => {
  const recent = selectMainDirectRecentEntries([]);
  assert.ok(Array.isArray(recent));
  assert.equal(recent.length, 0);
});

test("main-direct recent — caps at configured limit", () => {
  const records: MainDirectDecisionRecord[] = Array.from({ length: 30 }, (_, i) => ({
    id: String(i), taskClass: `class-${i}`, reason: "small-clear-change", note: "",
    consideredWorkerProfileIds: [], consideredWorkers: [], evidenceSnapshot: [],
    status: "open" as const, startedAt: new Date(Date.now() - i * 60000).toISOString(),
  }));

  const recent = selectMainDirectRecentEntries(records, 10);
  assert.equal(recent.length, 10);
});

test("main-direct recent — respects default limit", () => {
  const records: MainDirectDecisionRecord[] = Array.from({ length: 25 }, (_, i) => ({
    id: String(i), taskClass: `class-${i}`, reason: "small-clear-change", note: "",
    consideredWorkerProfileIds: [], consideredWorkers: [], evidenceSnapshot: [],
    status: "open" as const, startedAt: new Date(Date.now() - i * 60000).toISOString(),
  }));

  const recent = selectMainDirectRecentEntries(records);
  assert.equal(recent.length, MAIN_DIRECT_RECENT_LIMIT);
});

// --- No Worker side effects ---

test("main-direct — creating a decision does not create a Task", () => {
  const home = `/tmp/forklight-mdd-notask-${randomUUID()}`;
  const store = new StateStore(home);
  const beforeTasks = store.listTasks().length;
  const input = makeStartInput({ taskClass: "no-task-test" });
  const context = makeContext();
  const { consideredWorkers, evidenceSnapshot } = validateMainDirectStart(input, context, []);
  const record = createMainDirectDecision(input, consideredWorkers, evidenceSnapshot);
  store.saveMainDirectDecision(record);
  const afterTasks = store.listTasks().length;
  assert.equal(afterTasks, beforeTasks);
  store.close();
});

// --- Restart persistence ---

test("main-direct — survives Store close and reopen", () => {
  const home = `/tmp/forklight-mdd-persist-${randomUUID()}`;
  let store = new StateStore(home);

  const input = makeStartInput({ taskClass: "persist-test" });
  const context = makeContext();
  const { consideredWorkers, evidenceSnapshot } = validateMainDirectStart(input, context, []);
  const record = createMainDirectDecision(input, consideredWorkers, evidenceSnapshot);
  store.saveMainDirectDecision(record);
  store.close();

  store = new StateStore(home);
  const reloaded = store.getMainDirectDecision(record.id);
  assert.equal(reloaded.id, record.id);
  assert.equal(reloaded.status, "open");
  assert.equal(reloaded.taskClass, "persist-test");

  const closed: MainDirectDecisionRecord = {
    ...reloaded, status: "completed",
    closedState: { outcome: "completed", verification: "passed", note: "After restart.", closedAt: isoTimestamp() },
  };
  const closeResult = store.closeMainDirectDecision(closed);
  assert.equal(closeResult.applied, true);
  store.close();

  store = new StateStore(home);
  const again = store.getMainDirectDecision(record.id);
  assert.equal(again.status, "completed");
  assert.equal(again.closedState?.verification, "passed");
  store.close();
});

test("main-direct — Store close is compare-and-set and cannot rewrite the winner", () => {
  const home = `/tmp/forklight-mdd-cas-${randomUUID()}`;
  const store = new StateStore(home);
  const input = makeStartInput({ taskClass: "cas-close" });
  const context = makeContext();
  const { consideredWorkers, evidenceSnapshot } = validateMainDirectStart(input, context);
  const record = createMainDirectDecision(input, consideredWorkers, evidenceSnapshot);
  store.saveMainDirectDecision(record);
  const winner: MainDirectDecisionRecord = {
    ...record,
    status: "completed",
    closedState: { outcome: "completed", verification: "passed", note: "Winner.", closedAt: isoTimestamp() },
  };
  const loser: MainDirectDecisionRecord = {
    ...record,
    status: "abandoned",
    closedState: { outcome: "abandoned", note: "Loser.", closedAt: isoTimestamp() },
  };
  assert.equal(store.closeMainDirectDecision(winner).applied, true);
  const rejected = store.closeMainDirectDecision(loser);
  assert.equal(rejected.applied, false);
  assert.equal(rejected.record.status, "completed");
  assert.equal(store.getMainDirectDecision(record.id).closedState?.note, "Winner.");
  store.close();
});

// --- Legacy-stat stability ---

test("main-direct — aggregate is separate from Task-based statistics", () => {
  const agg = computeMainDirectAggregate([]);
  assert.ok("openCount" in agg);
  assert.ok("completedCount" in agg);
  assert.ok("abandonedCount" in agg);
  assert.ok(!("sampleSize" in agg));
  assert.ok(!("successRate" in agg));
  assert.ok(!("provider" in agg));
});

test("main-direct — projection fields do not leak Task content", () => {
  const input = makeStartInput({ taskClass: "no-leak-test" });
  const context = makeContext();
  const { consideredWorkers, evidenceSnapshot } = validateMainDirectStart(input, context, []);
  const record = createMainDirectDecision(input, consideredWorkers, evidenceSnapshot);
  const projection = projectMainDirectDecision(record);
  const keys = Object.keys(projection);
  assert.ok(!keys.includes("sourcePath"));
  assert.ok(!keys.includes("project"));
  assert.ok(!keys.includes("diff"));
  assert.ok(!keys.includes("command"));
  assert.ok(!keys.includes("output"));
  assert.ok(!keys.includes("endpoint"));
});

// --- All valid reasons ---

const validReasons = ["small-clear-change", "urgent-fix", "workers-unavailable", "user-requested", "main-judgment"] as const;
for (const reason of validReasons) {
  test(`main-direct — accepts reason: ${reason}`, () => {
    const input = makeStartInput({ reason });
    const context = makeContext();
    const { consideredWorkers, evidenceSnapshot } = validateMainDirectStart(input, context, []);
    const record = createMainDirectDecision(input, consideredWorkers, evidenceSnapshot);
    assert.equal(record.reason, reason);
  });
}

// --- All valid verifications ---

const verifications = ["passed", "failed", "unavailable"] as const;
for (const verification of verifications) {
  test(`main-direct — accepts verification: ${verification}`, () => {
    const input = makeStartInput({ taskClass: `verify-${verification}` });
    const context = makeContext();
    const { consideredWorkers, evidenceSnapshot } = validateMainDirectStart(input, context, []);
    const record = createMainDirectDecision(input, consideredWorkers, evidenceSnapshot);

    const closedState = validateMainDirectClose(
      { id: record.id, outcome: "completed", verification, note: `Verification ${verification}.`, confirm: true },
      record,
    );
    assert.equal(closedState.verification, verification);
  });
}

// --- Considered worker profile tests ---

test("main-direct — rejects unknown profile id before persistence", () => {
  const input = makeStartInput({
    taskClass: "unknown-profile-test",
    consideredWorkerProfileIds: ["nonexistent-profile"],
  });
  const context = makeContext();
  assert.throws(
    () => validateMainDirectStart(input, context, []),
    /Unknown consideredWorkerProfileId/,
  );
});

test("main-direct — accepts known default profile", () => {
  const input = makeStartInput({
    taskClass: "known-profile-test",
    consideredWorkerProfileIds: ["default"],
  });
  const context = makeContext();
  const { consideredWorkers } = validateMainDirectStart(input, context, []);
  assert.equal(consideredWorkers.length, 1);
  const worker = consideredWorkers[0]!;
  assert.equal(worker.workerProfileId, "default");
  assert.equal(worker.available, true);
});
