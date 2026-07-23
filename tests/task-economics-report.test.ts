// Task economics evidence report acceptance tests — lock truthful
// aggregation, unavailable semantics, native-currency separation,
// Store read behaviour, budget snapshots, calibration passthrough,
// and immutable identity.  No live Provider, no network, no private
// project content.

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type {
  AttemptOfficialCostCalculationUnavailable,
  AttemptOfficialCostIdentityUnavailable,
  AttemptOfficialCostQuoted,
  AttemptOfficialCostUsageUnavailable,
  AttemptRecord,
  AttemptTokenUsage,
  TaskRecord,
} from "../src/core/types.js";
import type { PricingCurrency, PricingSourceEvidence } from "../src/core/pricing.js";
import type {
  PricingIdentitySnapshot,
  QuotedCost,
  UnavailableEvidence,
} from "../src/core/pricing-calculator.js";
import { getTaskEconomicsReport } from "../src/core/task-economics-report.js";
import { getTaskTokenReport } from "../src/core/token-report.js";
import { StateStore } from "../src/state/store.js";

const TS = "2026-07-23T12:00:00.000Z";

// --- Helpers ---------------------------------------------------------------

function makeTask(id: string, status = "succeeded", maxBudgetUsd: number | null = null): TaskRecord {
  return {
    id, name: `task-${id}`, status, sourcePath: "/tmp/src", taskFile: `/tmp/${id}.yaml`,
    spec: {
      version: 2, name: `task-${id}`, project: "/tmp/proj",
      provider: { name: "deepseek", model: "deepseek-v4-pro", endpoint: "https://api.deepseek.com", keychainService: "fk" },
      runtime: { name: "claude-code", executable: "claude", effort: "medium", maxBudgetUsd },
      workspace: { exclude: [] },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
      contract: { outcome: "", context: [], inScope: [], outOfScope: [], executionSteps: [], deliverables: [], modules: [], callChain: [], scenarios: [], risks: [], changeBudget: { maxFiles: 1, maxDiffLines: 100 } },
      acceptance: { criteria: [], commands: ["true"] },
    },
    paths: { root: "/x", baseline: "/x", workspace: "/x", logs: "/x", claudeConfig: "/x", diff: "/x" },
    sessionId: `s-${id}`, createdAt: TS, updatedAt: TS,
  } as TaskRecord;
}

function makeUsage(i: number, o: number, cr: number, cc: number): AttemptTokenUsage {
  return { inputTokens: i, outputTokens: o, cacheReadInputTokens: cr, cacheCreationInputTokens: cc,
    source: "terminal-result", complete: true };
}

function makeAttempt(id: string, taskId: string, ordinal: number, overrides?: Partial<AttemptRecord>): AttemptRecord {
  return { id, taskId, ordinal, status: "succeeded", sessionId: `s-${id}`,
    rawLogPath: `/tmp/${id}.log`, startedAt: TS, finishedAt: TS, exitCode: 0, ...overrides } as AttemptRecord;
}

function psnap(currency: PricingCurrency = "USD", src?: PricingSourceEvidence): PricingIdentitySnapshot {
  return {
    provider: "deepseek", origin: "https://api.deepseek.com", route: "deepseek-direct-payg",
    modelAliases: ["deepseek-v4-pro"], serviceTier: "standard", currency, unitTokens: 1_000_000,
    source: src ?? { url: "https://api-docs.deepseek.com/quick_start/pricing/", checkedAt: TS },
    promotion: null,
  };
}

function makeQuotedCost(currency: PricingCurrency = "USD", total = 1.5): QuotedCost {
  return {
    quoted: true as const, currency, total,
    components: [
      { component: "input", tokens: 1000, ratePerMillion: 0.5, amount: 0.5 },
      { component: "output", tokens: 1000, ratePerMillion: 1.0, amount: 1.0 },
      { component: "cacheRead", tokens: 0, ratePerMillion: 0.005, amount: 0 },
      { component: "cacheCreation", tokens: 0, ratePerMillion: 0.5, amount: 0 },
    ] as any,
    pricing: psnap(currency),
    appliedTier: { applied: [{ minimumInputTokensExclusive: null, totalPromptInput: 1000 }], totalPromptInput: 1000 } as any,
    usageSource: "terminal-result", providerBillClaim: false,
  };
}

function emptyEv(provider: string, currency: PricingCurrency | null): UnavailableEvidence {
  return { provider, currency, tiersAvailable: 1, components: [],
    expectedAggregate: null, observedAggregate: null, positiveNullRateComponents: [] };
}

function quotedOC(qc: QuotedCost): AttemptOfficialCostQuoted {
  return { stage: "calculation", quoted: true, result: qc } as AttemptOfficialCostQuoted;
}

function calcUA(reason = "invalid-usage"): AttemptOfficialCostCalculationUnavailable {
  return { stage: "calculation", quoted: false,
    result: { quoted: false, reason, evidence: emptyEv("ds", "USD") } } as AttemptOfficialCostCalculationUnavailable;
}

function usageUA(reason: "usage-missing" | "service-tier-missing" = "usage-missing"): AttemptOfficialCostUsageUnavailable {
  return { stage: "usage", quoted: false, reason } as AttemptOfficialCostUsageUnavailable;
}

function idUA(reason = "unsupported-model"): AttemptOfficialCostIdentityUnavailable {
  return { stage: "pricing-identity", quoted: false, reason } as AttemptOfficialCostIdentityUnavailable;
}

function assertDeepFrozen(v: unknown, path = "root"): void {
  if (v === null || typeof v !== "object") return;
  assert.ok(Object.isFrozen(v), `Expected ${path} frozen`);
  if (Array.isArray(v)) for (let i = 0; i < v.length; i++) assertDeepFrozen(v[i], `${path}[${i}]`);
  else for (const k of Object.keys(v as Record<string, unknown>))
    assertDeepFrozen((v as Record<string, unknown>)[k], `${path}.${k}`);
}

// --- 1. Missing task -------------------------------------------------------

test("missing task id throws Store-owned error", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    assert.throws(() => getTaskEconomicsReport(store, "nope"),
      { name: "Error", message: "Unknown ForkLight task: nope" });
  } finally { store.close(); }
});

// --- 2. Complete evidence — successful task ---------------------------------

test("successful task: runtime estimate, USD quote, providerBillClaim, Worker not savings", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("ok", "succeeded", 10));
    store.createAttempt(makeAttempt("a1", "ok", 1, {
      usage: makeUsage(1000, 500, 200, 50),
      runtimeCostEstimateUsd: 3.25,
      officialCost: quotedOC(makeQuotedCost("USD", 0.07)),
    }));

    const r = getTaskEconomicsReport(store, "ok");
    assert.equal(r.taskId, "ok");
    // Budget
    assert.equal(r.runtimeBudget.maxBudgetUsd, 10);
    assert.equal(r.runtimeBudget.capped, true);
    assert.equal(r.runtimeBudget.label, "capped");
    // Runtime
    assert.equal(r.runtimeEstimate.observedTotalUsd, 3.25);
    assert.equal(r.runtimeEstimate.complete, true);
    // Official
    assert.equal(r.officialCost.totals.length, 1);
    const u = r.officialCost.totals[0]!;
    assert.equal(u.currency, "USD");
    assert.equal(u.total, 0.07);
    assert.equal(u.quotedCount, 1);
    assert.equal(u.providerBillClaim, false);
    assert.equal(u.sources[0], "https://api-docs.deepseek.com/quick_start/pricing/");
    assert.equal(r.officialCost.unavailable.unavailableCount, 0);
    // Token report present; Worker volume not savings; Codex unavailable
    assert.equal(r.tokenReport.taskId, "ok");
    assert.equal(r.tokenReport.report.directCodexSavings.available, false);
    assert.equal((r.tokenReport.report.directCodexSavings as any).reason, "direct-baseline-missing");
    assert.equal(r.tokenReport.report.workerVolume.kind, "complete");
  } finally { store.close(); }
});

// --- 3. Interrupted + missing evidence -------------------------------------

test("interrupted attempt: completeness false, missing counts nonzero, not zero", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("int", "interrupted", 5));
    store.createAttempt(makeAttempt("a1", "int", 1, {
      usage: makeUsage(500, 250, 0, 0), runtimeCostEstimateUsd: 1.5,
      officialCost: quotedOC(makeQuotedCost("USD", 0.03)),
    }));
    store.createAttempt(makeAttempt("a2", "int", 2, { status: "interrupted" }));

    const r = getTaskEconomicsReport(store, "int");
    assert.equal(r.runtimeEstimate.observedTotalUsd, 1.5);
    assert.equal(r.runtimeEstimate.sampleCount, 1);
    assert.equal(r.runtimeEstimate.missingCount, 1);
    assert.equal(r.runtimeEstimate.complete, false);
    assert.equal(r.officialCost.totals[0]!.quotedCount, 1);
    assert.equal(r.officialCost.unavailable.unavailableCount, 1);
    assert.equal(r.officialCost.unavailable.entries[0]!.stage, "missing");
    assert.equal(r.officialCost.unavailable.entries[0]!.reason, "missing-officialCost-record");
    assert.equal(r.tokenReport.attemptCount, 2);
    assert.equal(r.tokenReport.report.workerVolume.kind, "incomplete");
  } finally { store.close(); }
});

// --- 4. Mixed native currencies --------------------------------------------

test("mixed USD and CNY: separate sorted totals, no cross-currency grand total", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("mix"));
    store.createAttempt(makeAttempt("a1", "mix", 1, { officialCost: quotedOC(makeQuotedCost("USD", 0.10)) }));
    store.createAttempt(makeAttempt("a2", "mix", 2, { officialCost: quotedOC(makeQuotedCost("CNY", 3.50)) }));
    store.createAttempt(makeAttempt("a3", "mix", 3, { officialCost: quotedOC(makeQuotedCost("USD", 0.05)) }));

    const r = getTaskEconomicsReport(store, "mix");
    assert.equal(r.officialCost.totals.length, 2);
    // Sorted: CNY before USD
    assert.equal(r.officialCost.totals[0]!.currency, "CNY");
    assert.equal(r.officialCost.totals[0]!.total, 3.50);
    assert.equal(r.officialCost.totals[1]!.currency, "USD");
    assert.ok(Math.abs(r.officialCost.totals[1]!.total - 0.15) < 1e-12);
    assert.equal(r.officialCost.totals[1]!.quotedCount, 2);
    assert.ok(!("grandTotal" in r.officialCost));
  } finally { store.close(); }
});

// --- 5. Calibration passthrough --------------------------------------------

test("explicit publication pass through: token report and economics facade stay aligned", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("cal"));
    store.createAttempt(makeAttempt("a1", "cal", 1, { usage: makeUsage(1000, 500, 0, 0) }));
    const envelope = {
      directCodexProfileId: "codex-main-v1",
      calibration: { minTokens: 800, maxTokens: 1200, method: "bench", taskClass: "edit",
        confidence: "medium", version: 1, sampleSize: 4,
        evidenceReferences: ["sample:edit-v1"], createdAt: TS, schemaVersion: 1 as const },
      envelopeSchemaVersion: 1 as const,
    };

    // No publication and no current identities → task-class-missing
    const r1 = getTaskEconomicsReport(store, "cal");
    assert.equal(r1.tokenReport.report.directCodexSavings.available, false);
    assert.equal((r1.tokenReport.report.directCodexSavings as any).reason, "direct-baseline-missing");
    assert.equal(r1.tokenReport.calibrationSelection.kind, "task-class-missing");

    // A publication does not supply missing current identity.
    const r2 = getTaskEconomicsReport(store, "cal", {
      calibrationPublication: envelope,
      currentDirectCodexProfileId: "codex-main-v1",
    });
    assert.equal(r2.tokenReport.calibrationSelection.kind, "task-class-missing");
    assert.equal(r2.tokenReport.report.directCodexSavings.available, false);
    assert.equal((r2.tokenReport.report.directCodexSavings as any).reason, "direct-baseline-missing");

    // Matching current identities → explicit-override and direct savings
    // stays unavailable because no exchange receipts exist
    const r3 = getTaskEconomicsReport(store, "cal", {
      calibrationPublication: envelope,
      currentTaskClass: "edit",
      currentDirectCodexProfileId: "codex-main-v1",
    });
    assert.equal(r3.tokenReport.calibrationSelection.kind, "explicit-override");
    assert.equal(r3.tokenReport.report.directCodexSavings.available, false);
    assert.equal((r3.tokenReport.report.directCodexSavings as any).reason, "missing-exchange-evidence");
    assert.deepEqual(r3.tokenReport, getTaskTokenReport(store, "cal", {
      calibrationPublication: envelope,
      currentTaskClass: "edit",
      currentDirectCodexProfileId: "codex-main-v1",
    }));
  } finally { store.close(); }
});

// --- 6. Unavailable evidence — all stages/reasons in one comprehensive test -

test("unavailable official evidence counted by stable typed stage:reason", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("ua"));
    store.createAttempt(makeAttempt("a1", "ua", 1, { officialCost: quotedOC(makeQuotedCost("USD", 0.01)) }));
    store.createAttempt(makeAttempt("a2", "ua", 2, { officialCost: calcUA("per-request-usage-required") }));
    store.createAttempt(makeAttempt("a3", "ua", 3, { officialCost: usageUA("usage-missing") }));
    store.createAttempt(makeAttempt("a4", "ua", 4, { officialCost: idUA("unsupported-model") }));
    store.createAttempt(makeAttempt("a5", "ua", 5)); // missing officialCost
    store.createAttempt(makeAttempt("a6", "ua", 6, { officialCost: calcUA("invalid-usage") }));
    store.createAttempt(makeAttempt("a7", "ua", 7, { officialCost: usageUA("service-tier-missing") }));
    store.createAttempt(makeAttempt("a8", "ua", 8, { officialCost: idUA("route-required") }));
    store.createAttempt(makeAttempt("a9", "ua", 9, { officialCost: calcUA("rate-unpublished") }));

    const r = getTaskEconomicsReport(store, "ua");
    assert.equal(r.officialCost.totals[0]!.quotedCount, 1);
    assert.equal(r.officialCost.unavailable.unavailableCount, 8);
    assert.equal(r.officialCost.unavailable.entries.length, 8);

    const bd = r.officialCost.unavailable.breakdown;
    assert.equal(bd["calculation:per-request-usage-required"], 1);
    assert.equal(bd["usage:usage-missing"], 1);
    assert.equal(bd["pricing-identity:unsupported-model"], 1);
    assert.equal(bd["missing:missing-officialCost-record"], 1);
    assert.equal(bd["calculation:invalid-usage"], 1);
    assert.equal(bd["usage:service-tier-missing"], 1);
    assert.equal(bd["pricing-identity:route-required"], 1);
    assert.equal(bd["calculation:rate-unpublished"], 1);

    // Ordinal order preserved
    assert.deepEqual(r.officialCost.unavailable.entries.map(e => e.stage),
      ["calculation", "usage", "pricing-identity", "missing", "calculation", "usage", "pricing-identity", "calculation"]);
  } finally { store.close(); }
});

// --- 7. Missing runtime estimates — no legacy fallback ---------------------

test("runtimeCostEstimateUsd only; legacy costUsd never contributes", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("leg"));
    store.createAttempt(makeAttempt("a1", "leg", 1, { costUsd: 5.0 }));
    store.createAttempt(makeAttempt("a2", "leg", 2, { costUsd: 10.0, runtimeCostEstimateUsd: 3.5 }));

    const r = getTaskEconomicsReport(store, "leg");
    assert.equal(r.runtimeEstimate.observedTotalUsd, 3.5);
    assert.equal(r.runtimeEstimate.sampleCount, 1);
    assert.equal(r.runtimeEstimate.missingCount, 1);
    assert.equal(r.runtimeEstimate.complete, false);
  } finally { store.close(); }
});

// --- 8. Budget semantics: uncapped + capped in one test --------------------

test("null maxBudgetUsd = uncapped, positive = capped", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("u", "succeeded", null));
    store.createTask(makeTask("c", "succeeded", 25));
    const ru = getTaskEconomicsReport(store, "u");
    assert.equal(ru.runtimeBudget.maxBudgetUsd, null);
    assert.equal(ru.runtimeBudget.capped, false);
    assert.equal(ru.runtimeBudget.label, "uncapped");
    const rc = getTaskEconomicsReport(store, "c");
    assert.equal(rc.runtimeBudget.maxBudgetUsd, 25);
    assert.equal(rc.runtimeBudget.capped, true);
    assert.equal(rc.runtimeBudget.label, "capped");
  } finally { store.close(); }
});

// --- 9. Immutability -------------------------------------------------------

test("report is deeply frozen and detached; top-level and nested mutation throws", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("fz"));
    store.createAttempt(makeAttempt("a1", "fz", 1, {
      usage: makeUsage(100, 50, 0, 0), runtimeCostEstimateUsd: 0.5,
      officialCost: quotedOC(makeQuotedCost("USD", 0.01)),
    }));

    const r = getTaskEconomicsReport(store, "fz");
    assertDeepFrozen(r);
    assert.throws(() => { (r as any).taskId = "x"; }, TypeError);
    assert.throws(() => { (r.runtimeBudget as any).capped = false; }, TypeError);
    assert.throws(() => { (r.runtimeEstimate as any).observedTotalUsd = 999; }, TypeError);
    assert.throws(() => { (r.officialCost.totals as any[])[0] = {}; }, TypeError);
    assert.throws(() => { (r.officialCost.unavailable.entries as any[]).push({}); }, TypeError);
    assert.throws(() => {
      (r.officialCost.unavailable.breakdown as Record<string, number>).x = 1;
    }, TypeError);
  } finally { store.close(); }
});

// --- 10. Read-only + single listAttempts invocation -------------------------

// Wraps a real StateStore and asserts listAttempts is called exactly once.
function wrapForAssertOnce(realStore: StateStore) {
  let callCount = 0;
  const wrapped = {
    getTask: (taskId: string) => realStore.getTask(taskId),
    listAttempts: (taskId: string) => { callCount++; return realStore.listAttempts(taskId); },
    listExchangeReceipts: (taskId: string) => realStore.listExchangeReceipts(taskId),
    // All other StateStore methods are not reachable by the economics service
  };
  return { wrapped, getCallCount: () => callCount };
}

test("service is read-only: store state unchanged; real listAttempts called exactly once", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("ro"));
    store.createAttempt(makeAttempt("a1", "ro", 1, { runtimeCostEstimateUsd: 0.5 }));
    store.createAttempt(makeAttempt("a2", "ro", 2, { runtimeCostEstimateUsd: 1.0,
      officialCost: quotedOC(makeQuotedCost("USD", 0.02)) }));

    // Verify via wrapper: the real listAttempts should be called exactly once
    const { wrapped, getCallCount } = wrapForAssertOnce(store);
    const r = getTaskEconomicsReport(wrapped as unknown as StateStore, "ro");
    assert.equal(getCallCount(), 1, "real Store listAttempts called exactly once");

    // Store state unchanged
    const afterAttempts = store.listAttempts("ro");
    const afterReceipts = store.listExchangeReceipts("ro");
    assert.equal(afterAttempts.length, 2);
    assert.equal(afterReceipts.length, 0);
    // Task is still there
    assert.equal(r.taskId, "ro");
  } finally { store.close(); }
});

// --- 11. Determinism -------------------------------------------------------

test("identical state → identical detached non-reference-equal reports", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("det", "succeeded", 10));
    store.createAttempt(makeAttempt("a1", "det", 1, {
      usage: makeUsage(100, 50, 0, 0), runtimeCostEstimateUsd: 0.5,
      officialCost: quotedOC(makeQuotedCost("USD", 0.03)),
    }));
    const r1 = getTaskEconomicsReport(store, "det");
    const r2 = getTaskEconomicsReport(store, "det");
    assert.deepEqual(r1, r2);
    assert.notEqual(r1, r2);
    assert.notEqual(r1.runtimeBudget, r2.runtimeBudget);
    assert.notEqual(r1.tokenReport, r2.tokenReport);
  } finally { store.close(); }
});

// --- 12. Multiple quoted same currency + source dedup ----------------------

test("multiple quoted USD sums correctly with sources deduped and sorted", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("usd"));
    store.createAttempt(makeAttempt("a1", "usd", 1, { officialCost: quotedOC(makeQuotedCost("USD", 0.10)) }));
    // Same source → deduped
    store.createAttempt(makeAttempt("a2", "usd", 2, { officialCost: quotedOC(makeQuotedCost("USD", 0.20)) }));
    // Different source → tracked
    const mmCost: QuotedCost = {
      ...makeQuotedCost("USD", 0.30),
      pricing: psnap("USD", { url: "https://platform.minimax.io/docs/guides/pricing-paygo", checkedAt: TS }),
    };
    store.createAttempt(makeAttempt("a3", "usd", 3, { officialCost: quotedOC(mmCost) }));

    const r = getTaskEconomicsReport(store, "usd");
    assert.equal(r.officialCost.totals.length, 1);
    const u = r.officialCost.totals[0]!;
    assert.ok(Math.abs(u.total - 0.60) < 1e-12);
    assert.equal(u.quotedCount, 3);
    // Two distinct sources, sorted
    assert.equal(u.sources.length, 2);
    assert.equal(u.sources[0], "https://api-docs.deepseek.com/quick_start/pricing/");
    assert.equal(u.sources[1], "https://platform.minimax.io/docs/guides/pricing-paygo");
  } finally { store.close(); }
});

// --- 13. Privacy -----------------------------------------------------------

test("report never exposes resultText, error, rawLogPath, or private fields", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("priv"));
    store.createAttempt(makeAttempt("a1", "priv", 1, {
      runtimeCostEstimateUsd: 0.5,
      officialCost: quotedOC(makeQuotedCost("USD", 0.01)),
      resultText: "secret result", error: "secret-error", rawLogPath: "/secret/log",
    }));
    const json = JSON.stringify(getTaskEconomicsReport(store, "priv"));
    for (const w of ["secret result", "secret-error", "/secret/log",
      "resultText", "error", "rawLogPath", "sessionId", "prompt", "hash"])
      assert.ok(!json.includes(w), `Report leaked: ${w}`);
  } finally { store.close(); }
});

// --- 14. Calibration selection ---------------------------------------------

function saveCal(store: StateStore, cls: string, ver: number, ss = 4): void {
  store.saveDirectCodexCalibration({
    minTokens: 1000, maxTokens: 1500, method: "bench",
    taskClass: cls, confidence: "medium", version: ver, sampleSize: ss,
    evidenceReferences: [`experiment:${cls}-v${ver}`],
    createdAt: TS, schemaVersion: 1,
  });
}

function saveProfilePub(store: StateStore, cls: string, profileId: string,
  ver: number, ss = 4): void {
  store.saveDirectCodexProfilePublication({
    directCodexProfileId: profileId,
    calibration: {
      minTokens: 1000, maxTokens: 1500, method: "bench",
      taskClass: cls, confidence: "medium", version: ver, sampleSize: ss,
      evidenceReferences: [`sample:${cls}-${profileId}-v${ver}`],
      createdAt: TS, schemaVersion: 1,
    },
    envelopeSchemaVersion: 1,
  });
}

function withIdentity(base: TaskRecord, taskClass?: string,
  directCodexProfileId?: string): TaskRecord {
  if (taskClass === undefined && directCodexProfileId === undefined) return base;
  const spec: Record<string, unknown> = { ...base.spec };
  if (taskClass !== undefined) spec.taskClass = taskClass;
  if (directCodexProfileId !== undefined) spec.directCodexProfileId = directCodexProfileId;
  return { ...base, spec: spec as unknown as TaskRecord["spec"] };
}

function withTaskClass(base: TaskRecord, taskClass: string): TaskRecord {
  return withIdentity(base, taskClass);
}

test("calibration selection: precedence, exact-pair match, identity-missing via facade", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-sel-"));
  const store = new StateStore(home);
  try {
    store.createTask(withIdentity(makeTask("ov"), "stored", "codex-v1"));
    saveProfilePub(store, "stored", "codex-v1", 1, 3);
    saveProfilePub(store, "override-class", "codex-v1", 1, 7);

    const r1 = getTaskEconomicsReport(store, "ov");
    assert.equal(r1.tokenReport.calibrationSelection.kind, "exact-registry-hit");
    assert.equal((r1.tokenReport.calibrationSelection as { sampleSize: number }).sampleSize, 3);

    // Override identity independently: only the profile changes
    const r2 = getTaskEconomicsReport(store, "ov", { currentTaskClass: "override-class" });
    assert.equal(r2.tokenReport.calibrationSelection.kind, "exact-registry-hit");
    assert.equal((r2.tokenReport.calibrationSelection as { sampleSize: number }).sampleSize, 7);

    // Stored "edit-" must NOT match stored "edit" class
    store.createTask(withIdentity(makeTask("ex"), "edit", "codex-v1"));
    saveProfilePub(store, "edit-", "codex-v1", 1, 9);
    saveProfilePub(store, "edit", "codex-v1", 1, 4);
    const r3 = getTaskEconomicsReport(store, "ex");
    assert.equal((r3.tokenReport.calibrationSelection as { sampleSize: number }).sampleSize, 4);

    // Legacy task with no profile → direct-codex-profile-missing; legacy
    // class-only calibrations are never consulted
    store.createTask(withIdentity(makeTask("leg"), "edit"));
    saveCal(store, "edit", 2, 5);
    const r4 = getTaskEconomicsReport(store, "leg");
    assert.equal(r4.tokenReport.calibrationSelection.kind, "direct-codex-profile-missing");
    assert.equal(r4.tokenReport.report.directCodexSavings.available, false);
  } finally { store.close(); }
});

test("calibration selection: economics facade calls real Store exactly once for Attempts and profile lookup", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-sel-"));
  const store = new StateStore(home);
  try {
    store.createTask(withIdentity(makeTask("ss"), "edit", "codex-v1"));
    saveProfilePub(store, "edit", "codex-v1", 1);
    let attemptCalls = 0, pubLookupCalls = 0;
    const wrapped = {
      getTask: (tid: string) => store.getTask(tid),
      listAttempts: (tid: string) => { attemptCalls++; return store.listAttempts(tid); },
      listExchangeReceipts: (tid: string) => store.listExchangeReceipts(tid),
      latestDirectCodexProfilePublication: (cls: string, profileId: string) => {
        pubLookupCalls++;
        return store.latestDirectCodexProfilePublication(cls, profileId);
      },
    };
    const r = getTaskEconomicsReport(wrapped as unknown as StateStore, "ss");
    assert.equal(attemptCalls, 1);
    assert.equal(pubLookupCalls, 1);
    assert.equal(r.tokenReport.calibrationSelection.kind, "exact-registry-hit");
  } finally { store.close(); }
});
