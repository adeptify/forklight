// Task Token-efficiency report service acceptance tests — lock
// Store-backed attribution, evidence counts, immutability, privacy,
// missing-Task rejection, and read-only behaviour.  No live Provider,
// daemon, or private project content.

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { AttemptRecord, AttemptTokenUsage, TaskRecord } from "../src/core/types.js";
import { createRedactedExchangeMeasurement } from "../src/core/token-efficiency.js";
import { getTaskTokenReport, type TaskTokenReport } from "../src/core/token-report.js";
import { StateStore } from "../src/state/store.js";

const TS = "2026-07-23T12:00:00.000Z";

// --- Helpers ---------------------------------------------------------------

function makeTask(id: string, overrides?: Partial<TaskRecord>): TaskRecord {
  return {
    id, name: `task-${id}`, status: "succeeded",
    sourcePath: "/tmp/src", taskFile: `/tmp/${id}.yaml`,
    spec: {}, paths: {},
    createdAt: TS, updatedAt: TS,
    ...overrides,
  } as TaskRecord;
}

function makeUsage(input: number, output: number, cr: number, cc: number): AttemptTokenUsage {
  return { inputTokens: input, outputTokens: output, cacheReadInputTokens: cr,
    cacheCreationInputTokens: cc, source: "terminal-result", complete: true,
    serviceTier: "standard" };
}

function makeAttempt(
  id: string, taskId: string, ordinal: number,
  usage?: AttemptTokenUsage,
): AttemptRecord {
  const base: Omit<AttemptRecord, "usage"> & { usage?: AttemptTokenUsage } = {
    id, taskId, ordinal, status: "succeeded",
    sessionId: `session-${id}`,
    rawLogPath: `/tmp/${id}.log`,
    startedAt: TS, finishedAt: TS, exitCode: 0,
  };
  if (usage !== undefined) { base.usage = usage; }
  return base as AttemptRecord;
}

function makeMeasurement(
  text: string, dir: "request" | "response", operation: string, taskId: string, capturedAt: string,
) {
  return createRedactedExchangeMeasurement(text, dir, operation, taskId, capturedAt);
}

function makeReceiptInput(
  id: string, taskId: string, operation: string, capturedAt: string,
  reqText: string, contentText?: string, structText?: string,
): Record<string, unknown> {
  const m = (text: string, dir: "request" | "response") =>
    makeMeasurement(text, dir, operation, taskId, capturedAt);
  const result: Record<string, unknown> = {
    id, taskId, operation, transport: "mcp",
    capturedAt, outcome: "success",
    requestArguments: m(reqText, "request"),
    responseRelationship: "may-overlap",
  };
  if (contentText !== undefined) result.responseContent = m(contentText, "response");
  if (structText !== undefined) result.responseStructured = m(structText, "response");
  return result;
}

function assertDeepFrozen(v: unknown, path = "root"): void {
  if (v === null || typeof v !== "object") return;
  assert.ok(Object.isFrozen(v), `Expected ${path} frozen`);
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) assertDeepFrozen(v[i], `${path}[${i}]`); }
  else { for (const k of Object.keys(v as Record<string, unknown>))
    assertDeepFrozen((v as Record<string, unknown>)[k], `${path}.${k}`); }
}

// --- Missing task ----------------------------------------------------------

test("missing task id → throws Store-owned error", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-tokrep-"));
  const store = new StateStore(home);
  try {
    assert.throws(
      () => getTaskTokenReport(store, "nonexistent-task"),
      { name: "Error", message: "Unknown ForkLight task: nonexistent-task" },
    );
  } finally {
    store.close();
  }
});

// --- Task with no attempts and no receipts ---------------------------------

test("task with no attempts and no receipts → zero evidence counts", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-tokrep-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("task-empty"));
    const result = getTaskTokenReport(store, "task-empty");
    assert.equal(result.taskId, "task-empty");
    assert.equal(result.attemptCount, 0);
    assert.equal(result.receiptCount, 0);
    // Worker volume incomplete (0 samples), exchange unavailable
    assert.equal(result.report.workerVolume.kind, "incomplete");
    assert.equal(result.report.exchangeEstimate.kind, "unavailable");
    assert.equal((result.report.exchangeEstimate as any).reason, "no-measurements");
  } finally {
    store.close();
  }
});

// --- Task with attempts but no receipts -------------------------------------

test("task with attempts but no receipts → Worker volume observable, exchange unavailable", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-tokrep-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("task-worker-only"));
    store.createAttempt(makeAttempt("att-1", "task-worker-only", 1,
      makeUsage(1000, 500, 200, 50)));
    store.createAttempt(makeAttempt("att-2", "task-worker-only", 2,
      makeUsage(200, 100, 0, 0)));

    const result = getTaskTokenReport(store, "task-worker-only");
    assert.equal(result.attemptCount, 2);
    assert.equal(result.receiptCount, 0);
    // Worker volume complete (both have terminal-result usage)
    assert.equal(result.report.workerVolume.kind, "complete");
    assert.equal((result.report.workerVolume as any).grossWorkerTokens, 2050);
    // Exchange unavailable (no measurements, no receipts)
    assert.equal(result.report.exchangeEstimate.kind, "unavailable");
    assert.equal((result.report.exchangeEstimate as any).reason, "no-measurements");
    // Boundary unavailable due to missing exchange
    assert.equal(result.report.boundaryReduction.available, false);
    assert.equal((result.report.boundaryReduction as any).reason, "missing-exchange-evidence");
  } finally {
    store.close();
  }
});

// --- Task with receipts only -----------------------------------------------

test("task with receipts → receiptCount accurate, receipt-aware exchange", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-tokrep-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("task-receipts-only"));

    // "Hi" → min=1, max=2
    store.saveExchangeReceipt(makeReceiptInput(
      "rec-a", "task-receipts-only", "tool-call", TS, "Hi", undefined, undefined));
    store.saveExchangeReceipt(makeReceiptInput(
      "rec-b", "task-receipts-only", "tool-call", TS, "OK", undefined, undefined));

    const result = getTaskTokenReport(store, "task-receipts-only");
    assert.equal(result.attemptCount, 0);
    assert.equal(result.receiptCount, 2);
    assert.equal(result.report.exchangeEstimate.kind, "range");
    const ee = result.report.exchangeEstimate as any;
    assert.equal(ee.range.method, "receipt-aware-broad-utf8-byte-envelope-v1");
    // "Hi" → min=1, max=2 + "OK" → min=1, max=2 = min=2, max=4
    assert.equal(ee.range.min, 2);
    assert.equal(ee.range.max, 4);
  } finally {
    store.close();
  }
});

// --- Task with attempts + receipts combined --------------------------------

test("attempts + receipts → complete evidence, boundary reduction available", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-tokrep-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("task-full"));
    store.createAttempt(makeAttempt("att-1", "task-full", 1,
      makeUsage(1000, 500, 200, 50)));
    // Receipt: "Hi" → min=1, max=2
    store.saveExchangeReceipt(makeReceiptInput(
      "rec-1", "task-full", "tool-call", TS, "Hi", undefined, undefined));

    const result = getTaskTokenReport(store, "task-full");
    assert.equal(result.attemptCount, 1);
    assert.equal(result.receiptCount, 1);
    assert.equal(result.report.workerVolume.kind, "complete");
    assert.equal((result.report.workerVolume as any).grossWorkerTokens, 1750);
    // Boundary reduction: 1750 - [2, 1] → min=1748, max=1749
    assert.equal(result.report.boundaryReduction.available, true);
    const br = result.report.boundaryReduction as any;
    assert.equal(br.tokens.min, 1748);
    assert.equal(br.tokens.max, 1749);
  } finally {
    store.close();
  }
});

// --- Receipts with dual response surfaces via Store -------------------------

test("dual response surface receipts through store → may-overlap interval", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-tokrep-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("task-dual"));
    store.createAttempt(makeAttempt("att-1", "task-dual", 1,
      makeUsage(100, 0, 0, 0)));
    // Request "Hi" (min=1, max=2), content "Hello" (min=1, max=5), structured "{}" (min=1, max=2)
    // Response lower = max(1,1) = 1, upper = 5+2 = 7
    // Total min = 1+1 = 2, max = 2+7 = 9
    store.saveExchangeReceipt(makeReceiptInput(
      "rec-dual", "task-dual", "tool-call", TS, "Hi", "Hello", "{}"));

    const result = getTaskTokenReport(store, "task-dual");
    assert.equal(result.receiptCount, 1);
    const ee = result.report.exchangeEstimate as any;
    assert.equal(ee.kind, "range");
    assert.equal(ee.range.method, "receipt-aware-broad-utf8-byte-envelope-v1");
    assert.equal(ee.range.min, 2);
    assert.equal(ee.range.max, 9);
  } finally {
    store.close();
  }
});

// --- Calibration passthrough ------------------------------------------------

test("calibration and taskClass pass through without inference", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-tokrep-"));
  const store = new StateStore(home);
  try {
    store.createTask(withIdentity("task-cal"));
    store.createAttempt(makeAttempt("att-1", "task-cal", 1,
      makeUsage(1000, 500, 0, 0)));
    // Persist a receipt so exchange evidence is available for the
    // matching-calibration path.
    store.saveExchangeReceipt(makeReceiptInput(
      "rec-cal", "task-cal", "tool-call", TS, "Hi", undefined, undefined));

    // Without any explicit publication and no declared identities →
    // task-class-missing selected before any Store call
    const r1 = getTaskTokenReport(store, "task-cal");
    assert.equal(r1.report.directCodexSavings.available, false);
    assert.equal((r1.report.directCodexSavings as any).reason, "direct-baseline-missing");
    assert.equal(r1.calibrationSelection.kind, "task-class-missing");

    // With matching publication envelope + matching task class + matching
    // profile + exchange evidence → explicit-override wins and savings is
    // available.
    const env = publicationEnvelope("edit", "codex-main-v1");
    const missingClass = getTaskTokenReport(store, "task-cal", {
      calibrationPublication: env,
      currentDirectCodexProfileId: "codex-main-v1",
    });
    assert.equal(missingClass.calibrationSelection.kind, "task-class-missing");
    const missingProfile = getTaskTokenReport(store, "task-cal", {
      calibrationPublication: env,
      currentTaskClass: "edit",
    });
    assert.equal(missingProfile.calibrationSelection.kind, "direct-codex-profile-missing");

    const r2 = getTaskTokenReport(store, "task-cal", {
      calibrationPublication: env,
      currentTaskClass: "edit",
      currentDirectCodexProfileId: "codex-main-v1",
    });
    assert.equal(r2.calibrationSelection.kind, "explicit-override");
    assert.equal(r2.report.directCodexSavings.available, true);
    const dcs = r2.report.directCodexSavings as any;
    assert.equal(dcs.baseline.taskClass, "edit");

    // With publication but mismatched task class → typed task-class-mismatch
    // and the publication is NOT passed through to arithmetic.
    const r3 = getTaskTokenReport(store, "task-cal", {
      calibrationPublication: env,
      currentTaskClass: "other-class",
      currentDirectCodexProfileId: "codex-main-v1",
    });
    assert.equal(r3.calibrationSelection.kind, "task-class-mismatch");
    assert.equal(r3.report.directCodexSavings.available, false);
    assert.equal((r3.report.directCodexSavings as any).reason, "direct-baseline-missing");

    // With publication but mismatched direct-Codex profile → typed
    // direct-codex-profile-mismatch and the publication is NOT passed
    // through to arithmetic.
    const r4 = getTaskTokenReport(store, "task-cal", {
      calibrationPublication: env,
      currentTaskClass: "edit",
      currentDirectCodexProfileId: "codex-other-v2",
    });
    assert.equal(r4.calibrationSelection.kind, "direct-codex-profile-mismatch");
    assert.equal(r4.report.directCodexSavings.available, false);
    assert.equal((r4.report.directCodexSavings as any).reason, "direct-baseline-missing");

    const invalid = getTaskTokenReport(store, "task-cal", {
      calibrationPublication: { ...env as object, unexpected: true },
      currentTaskClass: "edit",
      currentDirectCodexProfileId: "codex-main-v1",
    });
    assert.equal(invalid.calibrationSelection.kind, "explicit-publication-invalid");
    assert.deepEqual(Object.keys(invalid.calibrationSelection), ["kind"]);

    // Supplied mismatch values are never echoed in the JSON provenance.
    const json = JSON.stringify([r3, r4, invalid]);
    assert.ok(!json.includes("other-class"));
    assert.ok(!json.includes("codex-other-v2"));
  } finally {
    store.close();
  }
});

// --- Immutability -----------------------------------------------------------

test("task report is deeply frozen and detached from store state", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-tokrep-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("task-frozen"));
    store.createAttempt(makeAttempt("att-1", "task-frozen", 1,
      makeUsage(100, 50, 0, 0)));
    store.saveExchangeReceipt(makeReceiptInput(
      "rec-fz", "task-frozen", "tool-call", TS, "Hi", undefined, undefined));

    const result = getTaskTokenReport(store, "task-frozen");
    assertDeepFrozen(result);
    assert.throws(() => { (result as any).taskId = "hacked"; }, TypeError);
    assert.throws(() => { (result as any).attemptCount = 999; }, TypeError);
    assert.throws(() => { (result as any).receiptCount = 999; }, TypeError);
    assert.throws(() => { (result as any).report = null; }, TypeError);
  } finally {
    store.close();
  }
});

// --- Privacy: no raw content in store-backed report -------------------------

test("store-backed report never exposes raw content, cost, or private fields", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-tokrep-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("task-private"));
    store.createAttempt(makeAttempt("att-1", "task-private", 1,
      makeUsage(100, 50, 0, 0)));
    store.saveExchangeReceipt(makeReceiptInput(
      "rec-priv", "task-private", "tool-call", TS,
      "secret-prompt", "secret-response", '{"secret":"json"}'));

    const result = getTaskTokenReport(store, "task-private");
    const json = JSON.stringify(result);

    // No raw content, prompts, or response text
    for (const w of ["secret-prompt", "secret-response", "secret", "json"]) {
      assert.ok(!json.includes(w), `Report leaked: ${w}`);
    }
    // No cost, price, or currency fields
    for (const w of ["cost", "price", "currency", "USD", "CNY"]) {
      assert.ok(!json.includes(w), `Report leaked pricing: ${w}`);
    }
  } finally {
    store.close();
  }
});

// --- Attempts with incomplete usage still counted -------------------------

test("attempts with missing or incomplete usage → count preserved, worker incomplete", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-tokrep-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("task-partial"));
    // One complete, one with no usage
    store.createAttempt(makeAttempt("att-1", "task-partial", 1,
      makeUsage(100, 50, 0, 0)));
    store.createAttempt({
      id: "att-2", taskId: "task-partial", ordinal: 2,
      status: "failed", sessionId: "session-att-2",
      rawLogPath: "/tmp/att-2.log",
      startedAt: TS, finishedAt: TS, exitCode: 1,
      error: "crashed",
      // no usage field
    } as AttemptRecord);

    const result = getTaskTokenReport(store, "task-partial");
    assert.equal(result.attemptCount, 2);
    assert.equal(result.receiptCount, 0);
    assert.equal(result.report.workerVolume.kind, "incomplete");
    const wv = result.report.workerVolume as any;
    assert.equal(wv.completeSampleCount, 1);
    assert.equal(wv.missingSampleCount, 1);
    assert.equal(wv.sampleCount, 2);
    assert.equal(wv.grossWorkerTokens, 150);
  } finally {
    store.close();
  }
});

// --- Evidence counts are accurate with multiple receipts -------------------

test("evidence counts match persisted records exactly", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-tokrep-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("task-counts"));
    store.createAttempt(makeAttempt("att-a", "task-counts", 1,
      makeUsage(10, 20, 0, 0)));
    store.createAttempt(makeAttempt("att-b", "task-counts", 2,
      makeUsage(30, 40, 0, 0)));
    store.createAttempt(makeAttempt("att-c", "task-counts", 3,
      makeUsage(50, 60, 0, 0)));
    store.saveExchangeReceipt(makeReceiptInput(
      "rec-x", "task-counts", "tool-call", TS, "A", undefined, undefined));
    store.saveExchangeReceipt(makeReceiptInput(
      "rec-y", "task-counts", "tool-call", TS, "B", undefined, undefined));

    const result = getTaskTokenReport(store, "task-counts");
    assert.equal(result.attemptCount, 3);
    assert.equal(result.receiptCount, 2);
    assert.equal(result.report.workerVolume.kind, "complete");
    assert.equal((result.report.workerVolume as any).grossWorkerTokens, 210);
  } finally {
    store.close();
  }
});

// --- Read-only: service never mutates store ---------------------------------

test("service is read-only — store state unchanged after report", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-tokrep-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("task-ro"));
    store.createAttempt(makeAttempt("att-1", "task-ro", 1,
      makeUsage(100, 50, 0, 0)));

    const beforeAttempts = store.listAttempts("task-ro").length;
    const beforeReceipts = store.listExchangeReceipts("task-ro").length;

    getTaskTokenReport(store, "task-ro");

    const afterAttempts = store.listAttempts("task-ro").length;
    const afterReceipts = store.listExchangeReceipts("task-ro").length;
    assert.equal(afterAttempts, beforeAttempts);
    assert.equal(afterReceipts, beforeReceipts);
  } finally {
    store.close();
  }
});

// --- Per-model breakdown not double-counted ---------------------------------

test("perModel breakdown not added to aggregate worker volume", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-tokrep-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("task-permodel"));
    const usageWithPerModel: AttemptTokenUsage = {
      inputTokens: 100, outputTokens: 50,
      cacheReadInputTokens: 20, cacheCreationInputTokens: 10,
      source: "terminal-result" as const, complete: true as const,
      serviceTier: "standard",
      perModel: [
        { model: "m1", inputTokens: 60, outputTokens: 30,
          cacheReadInputTokens: 10, cacheCreationInputTokens: 5 },
        { model: "m2", inputTokens: 40, outputTokens: 20,
          cacheReadInputTokens: 10, cacheCreationInputTokens: 5 },
      ],
    };
    store.createAttempt(makeAttempt("att-1", "task-permodel", 1, usageWithPerModel));

    const result = getTaskTokenReport(store, "task-permodel");
    // Gross = 100+50+20+10 = 180, NOT 180 + perModel sum
    assert.equal(result.report.workerVolume.kind, "complete");
    assert.equal((result.report.workerVolume as any).grossWorkerTokens, 180);
  } finally {
    store.close();
  }
});

// --- Determinism: same inputs → same detached output -----------------------

test("identical task state → identical detached non-reference-equal reports", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-tokrep-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("task-det"));
    store.createAttempt(makeAttempt("att-1", "task-det", 1,
      makeUsage(100, 50, 0, 0)));
    store.saveExchangeReceipt(makeReceiptInput(
      "rec-det", "task-det", "tool-call", TS, "Hi", undefined, undefined));

    const r1 = getTaskTokenReport(store, "task-det");
    const r2 = getTaskTokenReport(store, "task-det");
    assert.deepEqual(r1, r2);
    assert.notEqual(r1, r2);
    assert.notEqual(r1.report, r2.report);
  } finally {
    store.close();
  }
});

// --- Receipt count zero when no receipts persisted --------------------------

test("receiptCount zero for task with only attempts", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-tokrep-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("task-no-rec"));
    store.createAttempt(makeAttempt("att-1", "task-no-rec", 1,
      makeUsage(100, 50, 0, 0)));
    store.createAttempt(makeAttempt("att-2", "task-no-rec", 2,
      makeUsage(200, 100, 0, 0)));

    const result = getTaskTokenReport(store, "task-no-rec");
    assert.equal(result.attemptCount, 2);
    assert.equal(result.receiptCount, 0);
    assert.equal(result.report.exchangeEstimate.kind, "unavailable");
    assert.equal((result.report.exchangeEstimate as any).reason, "no-measurements");
  } finally {
    store.close();
  }
});

// --- Calibration selection: helpers -----------------------------------------

function saveCal(store: StateStore, cls: string, ver: number,
  ss = 4, min = 1000, max = 1500): void {
  store.saveDirectCodexCalibration({
    minTokens: min, maxTokens: max, method: "bench",
    taskClass: cls, confidence: "medium", version: ver, sampleSize: ss,
    evidenceReferences: [`experiment:${cls}-v${ver}`], createdAt: TS, schemaVersion: 1,
  });
}

function saveProfilePub(store: StateStore, cls: string, profileId: string,
  ver: number, ss = 4, min = 1000, max = 1500): void {
  store.saveDirectCodexProfilePublication({
    directCodexProfileId: profileId,
    calibration: {
      minTokens: min, maxTokens: max, method: "bench",
      taskClass: cls, confidence: "medium", version: ver, sampleSize: ss,
      evidenceReferences: [`sample:${cls}-${profileId}-v${ver}`],
      createdAt: TS, schemaVersion: 1,
    },
    envelopeSchemaVersion: 1,
  });
}

function publicationEnvelope(cls: string, profileId: string, calOverrides:
  Partial<{ minTokens: number; maxTokens: number; method: string;
    confidence: "low" | "medium" | "high"; version: number; sampleSize: number; }> = {}
): unknown {
  return {
    directCodexProfileId: profileId,
    calibration: {
      minTokens: calOverrides.minTokens ?? 800,
      maxTokens: calOverrides.maxTokens ?? 1200,
      method: calOverrides.method ?? "manual",
      taskClass: cls,
      confidence: calOverrides.confidence ?? "low",
      version: calOverrides.version ?? 1,
      sampleSize: calOverrides.sampleSize ?? 4,
      evidenceReferences: [`sample:${cls}-${profileId}-v1`],
      createdAt: TS, schemaVersion: 1,
    },
    envelopeSchemaVersion: 1,
  };
}

function withClass(makeId: string, taskClass?: string): TaskRecord {
  return withIdentity(makeId, taskClass);
}

function withIdentity(makeId: string, taskClass?: string,
  directCodexProfileId?: string): TaskRecord {
  const base = makeTask(makeId);
  if (taskClass === undefined && directCodexProfileId === undefined) return base;
  const spec: Record<string, unknown> = { ...base.spec };
  if (taskClass !== undefined) spec.taskClass = taskClass;
  if (directCodexProfileId !== undefined) spec.directCodexProfileId = directCodexProfileId;
  return { ...base, spec: spec as unknown as TaskRecord["spec"] };
}

// --- Calibration selection: precedence + exact-pair hit + identity missing --

test("calibration selection: precedence + exact-pair hit + identity missing + legacy ignore", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-tokrep-sel-"));
  const store = new StateStore(home);
  try {
    store.createTask(withIdentity("prio", "stored-class", "codex-main-v1"));
    store.createAttempt(makeAttempt("att-prio", "prio", 1, makeUsage(100, 50, 0, 0)));
    store.saveExchangeReceipt(makeReceiptInput(
      "rec-prio", "prio", "tool-call", TS, "Hi", undefined, undefined));
    saveProfilePub(store, "stored-class", "codex-main-v1", 1, 4);
    saveProfilePub(store, "stored-class", "codex-other", 1, 9);
    saveProfilePub(store, "explicit-class", "codex-main-v1", 1, 11);

    // No options → exact-pair registry lookup returns the only stored pair
    const r0 = getTaskTokenReport(store, "prio");
    assert.equal(r0.calibrationSelection.kind, "exact-registry-hit");
    assert.equal((r0.calibrationSelection as { profileId: string }).profileId, "codex-main-v1");
    assert.equal((r0.calibrationSelection as { version: number }).version, 1);
    assert.equal((r0.calibrationSelection as { sampleSize: number }).sampleSize, 4);

    // Both explicit identities supplied and matching envelope → explicit-override
    const r1 = getTaskTokenReport(store, "prio", {
      calibrationPublication: publicationEnvelope("explicit-class", "codex-main-v1"),
      currentTaskClass: "explicit-class",
      currentDirectCodexProfileId: "codex-main-v1",
    });
    assert.equal(r1.calibrationSelection.kind, "explicit-override");
    // The explicit envelope wins independently of the stored publication
    // for the same pair; publicationEnvelope defaults to sampleSize 4.
    assert.equal((r1.calibrationSelection as { sampleSize: number }).sampleSize, 4);
    assert.equal((r1.report.directCodexSavings as any).baseline.taskClass, "explicit-class");

    // Override wins over Store lookup (independently resolved per identity)
    const r2 = getTaskTokenReport(store, "prio", {
      calibrationPublication: publicationEnvelope("stored-class", "codex-main-v1"),
      currentTaskClass: "stored-class",
      currentDirectCodexProfileId: "codex-main-v1",
    });
    assert.equal(r2.calibrationSelection.kind, "explicit-override");

    // Exact pair missing: Task declares a profile that has no stored publication
    store.createTask(withIdentity("miss", "rename", "codex-future-v9"));
    saveProfilePub(store, "rename", "codex-other", 1, 5);
    const rMis = getTaskTokenReport(store, "miss");
    assert.equal(rMis.calibrationSelection.kind, "exact-pair-missing");
    assert.equal((rMis.calibrationSelection as { profileId: string }).profileId, "codex-future-v9");
    assert.equal(rMis.report.directCodexSavings.available, false);

    // Legacy task without directCodexProfileId → direct-codex-profile-missing,
    // the exact-pair Store lookup is NEVER consulted for legacy rows
    store.createTask(withIdentity("leg", "edit"));
    // Persist a legacy class-only calibration that MUST NOT be selected
    saveCal(store, "edit", 5, 5);
    let pubLookupCalls = 0;
    const wrapped = {
      getTask: (id: string) => store.getTask(id),
      listAttempts: (id: string) => store.listAttempts(id),
      listExchangeReceipts: (id: string) => store.listExchangeReceipts(id),
      latestDirectCodexProfilePublication: (cls: string, profileId: string) => {
        pubLookupCalls++;
        return store.latestDirectCodexProfilePublication(cls, profileId);
      },
    };
    const rLeg = getTaskTokenReport(wrapped as unknown as StateStore, "leg");
    assert.equal(rLeg.calibrationSelection.kind, "direct-codex-profile-missing");
    assert.equal(pubLookupCalls, 0, "exact-pair Store lookup must never run when profile is missing");
    assert.equal(rLeg.report.directCodexSavings.available, false);

    // Task without taskClass → task-class-missing, Store never called
    store.createTask(withIdentity("nocl"));
    let noClassCalls = 0;
    const wrapped2 = {
      getTask: (id: string) => store.getTask(id),
      listAttempts: (id: string) => store.listAttempts(id),
      listExchangeReceipts: (id: string) => store.listExchangeReceipts(id),
      latestDirectCodexProfilePublication: (cls: string, profileId: string) => {
        noClassCalls++;
        return store.latestDirectCodexProfilePublication(cls, profileId);
      },
    };
    const rNocl = getTaskTokenReport(wrapped2 as unknown as StateStore, "nocl");
    assert.equal(rNocl.calibrationSelection.kind, "task-class-missing");
    assert.equal(noClassCalls, 0, "exact-pair Store lookup must never run when class is missing");
  } finally { store.close(); }
});

// --- Calibration selection: privacy-safe provenance --------------------------

test("calibration selection: provenance is privacy-safe; mismatched values not echoed", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-tokrep-sel-"));
  const store = new StateStore(home);
  try {
    store.createTask(withIdentity("priv", "edit", "codex-main-v1"));
    store.saveDirectCodexProfilePublication({
      directCodexProfileId: "codex-main-v1",
      calibration: {
        minTokens: 1000, maxTokens: 1500, method: "bench", taskClass: "edit",
        confidence: "medium", version: 3, sampleSize: 7,
        evidenceReferences: ["experiment:sensitive-secret-prompt-text-DELTA",
          "experiment:another-credential-ref-XYZ"],
        createdAt: TS, schemaVersion: 1,
      },
      envelopeSchemaVersion: 1,
    });

    // Successful exact-registry-hit carries only bounded non-content fields
    const r = getTaskTokenReport(store, "priv");
    const json = JSON.stringify(r);
    for (const w of ["evidenceReferences", "experiment:sensitive",
      "secret-prompt", "another-credential", "DELTA", "XYZ",
      "model:", "effort:", "policy:", "prompt", "secret", "credential",
      "log", "response", "request"])
      assert.ok(!json.includes(w), `Leaked: ${w}`);
    assert.deepEqual(
      Object.keys(r.calibrationSelection as Record<string, unknown>).sort(),
      ["kind", "profileId", "sampleSize", "version"]);
    assert.equal(r.calibrationSelection.kind, "exact-registry-hit");
    assert.equal((r.calibrationSelection as { profileId: string }).profileId, "codex-main-v1");
    assert.equal((r.calibrationSelection as { version: number }).version, 3);
    assert.equal((r.calibrationSelection as { sampleSize: number }).sampleSize, 7);

    // explicit-override with the normalized envelope also keeps only
    // bounded non-content fields
    store.createTask(withIdentity("ov", "edit", "codex-main-v1"));
    const r2 = getTaskTokenReport(store, "ov", {
      calibrationPublication: publicationEnvelope("edit", "codex-main-v1"),
      currentTaskClass: "edit",
      currentDirectCodexProfileId: "codex-main-v1",
    });
    assert.equal(r2.calibrationSelection.kind, "explicit-override");
    assert.deepEqual(
      Object.keys(r2.calibrationSelection as Record<string, unknown>).sort(),
      ["kind", "profileId", "sampleSize", "version"]);
    const json2 = JSON.stringify(r2);
    assert.ok(!json2.includes("experiment:"));
    assert.ok(!json2.includes("secret-prompt"));

    // Mismatched supplied class/profile values never appear in any
    // serialized state of the report (selection, JSON, or error)
    store.createTask(withIdentity("privm", "edit", "codex-main-v1"));
    const mismatchedClass = publicationEnvelope("other-class", "codex-main-v1");
    const rMisClass = getTaskTokenReport(store, "privm", {
      calibrationPublication: mismatchedClass,
      currentTaskClass: "edit",
      currentDirectCodexProfileId: "codex-main-v1",
    });
    assert.equal(rMisClass.calibrationSelection.kind, "task-class-mismatch");
    assert.deepEqual(
      Object.keys(rMisClass.calibrationSelection as Record<string, unknown>), ["kind"]);
    assert.ok(!JSON.stringify(rMisClass).includes("other-class"));

    const mismatchedProfile = publicationEnvelope("edit", "leaked-supplied-profile");
    const rMisProf = getTaskTokenReport(store, "privm", {
      calibrationPublication: mismatchedProfile,
      currentTaskClass: "edit",
      currentDirectCodexProfileId: "codex-main-v1",
    });
    assert.equal(rMisProf.calibrationSelection.kind, "direct-codex-profile-mismatch");
    assert.deepEqual(
      Object.keys(rMisProf.calibrationSelection as Record<string, unknown>), ["kind"]);
    assert.ok(!JSON.stringify(rMisProf).includes("leaked-supplied-profile"));
  } finally { store.close(); }
});

// --- Calibration selection: exchange gates + negative savings preserved -----

test("calibration selection: exchange + arithmetic gates preserved; negative savings not clamped", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-tokrep-sel-"));
  const store = new StateStore(home);
  try {
    // exact-registry-hit + no receipts → missing-exchange-evidence gate stays
    store.createTask(withIdentity("nx", "edit", "codex-default-v1"));
    store.createAttempt(makeAttempt("att-nx", "nx", 1, makeUsage(100, 50, 0, 0)));
    saveProfilePub(store, "edit", "codex-default-v1", 1);
    const rNx = getTaskTokenReport(store, "nx");
    assert.equal(rNx.calibrationSelection.kind, "exact-registry-hit");
    assert.equal(rNx.report.directCodexSavings.available, false);
    assert.equal((rNx.report.directCodexSavings as any).reason, "missing-exchange-evidence");
    assert.equal(rNx.report.boundaryReduction.available, false);
    assert.equal((rNx.report.boundaryReduction as any).reason, "missing-exchange-evidence");

    // Isolated class so baseline 1..1 doesn't collide with the nx calibration.
    // exact-registry-hit + receipt "ABCD" + baseline 1..1 → negative savings
    // is preserved; arithmetic is never clamped to zero.
    store.createTask(withIdentity("neg", "neg-class", "neg-profile"));
    store.createAttempt(makeAttempt("att-neg", "neg", 1, makeUsage(10, 0, 0, 0)));
    store.saveExchangeReceipt(makeReceiptInput(
      "rec-neg", "neg", "tool-call", TS, "ABCD", undefined, undefined));
    saveProfilePub(store, "neg-class", "neg-profile", 1, 5, 1, 1); // min=1, max=1
    const rNeg = getTaskTokenReport(store, "neg");
    assert.equal(rNeg.calibrationSelection.kind, "exact-registry-hit");
    const dcs = rNeg.report.directCodexSavings as any;
    assert.equal(dcs.available, true);
    assert.equal(dcs.absoluteSavings.min, -3);
    assert.equal(dcs.absoluteSavings.max, 0);
    assert.equal(dcs.baseline.taskClass, "neg-class");
  } finally { store.close(); }
});

// --- Calibration selection: identity-missing + frozen + deterministic -------

test("calibration selection: identity-missing + mismatch + frozen + deterministic", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-tokrep-sel-"));
  const store = new StateStore(home);
  try {
    store.createTask(withIdentity("fz", "edit", "codex-main-v1"));
    // Has taskClass but no directCodexProfileId → direct-codex-profile-missing
    store.createTask(withIdentity("fz-legacy", "edit"));
    saveProfilePub(store, "edit", "codex-main-v1", 1, 6);
    const r1 = getTaskTokenReport(store, "fz");
    const r2 = getTaskTokenReport(store, "fz", {
      calibrationPublication: publicationEnvelope("edit", "codex-main-v1"),
      currentTaskClass: "edit",
      currentDirectCodexProfileId: "codex-main-v1",
    });
    const r3 = getTaskTokenReport(store, "fz-legacy");
    assert.equal(r1.calibrationSelection.kind, "exact-registry-hit");
    assert.equal(r2.calibrationSelection.kind, "explicit-override");
    assert.equal(r3.calibrationSelection.kind, "direct-codex-profile-missing");
    assertDeepFrozen(r1); assertDeepFrozen(r2); assertDeepFrozen(r3);
    assert.ok(Object.isFrozen(r1.calibrationSelection));
    assert.throws(() => { (r1.calibrationSelection as any).kind = "x"; }, TypeError);
    assert.throws(() => { (r1.calibrationSelection as any).version = 99; }, TypeError);
    assert.throws(() => { (r1.calibrationSelection as any).sampleSize = 0; }, TypeError);
    assert.throws(() => { (r1.calibrationSelection as any).profileId = "p"; }, TypeError);
    // identity-missing provenance exposes only kind
    assert.deepEqual(
      Object.keys(r3.calibrationSelection as Record<string, unknown>),
      ["kind"]);

    // Determinism: same state → equal selection, different reference
    const a = getTaskTokenReport(store, "fz");
    const b = getTaskTokenReport(store, "fz");
    assert.deepEqual(a.calibrationSelection, b.calibrationSelection);
    assert.notEqual(a, b);
    assert.notEqual(a.calibrationSelection, b.calibrationSelection);
  } finally { store.close(); }
});
