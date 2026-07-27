// Portfolio economics summary acceptance tests — lock truthful aggregation,
// currency separation, unavailable-reason semantics, visibility of denominators,
// filtering, deterministic ordering, privacy, immutability, and the hard
// guarantee that legacy costUsd never leaks into the summary.
// No live Provider, no network, no private project content.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { HubServer } from "../src/hub/server.js";
import { SetupService } from "../src/setup/service.js";
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
import type { BoundedEstimate, PricingIdentitySnapshot, QuotedCost } from "../src/core/pricing-calculator.js";
import type { ProviderName } from "../src/core/providers.js";
import type { SetupKeychainStore, SetupSystemInspector } from "../src/setup/types.js";
import { getPortfolioEconomicsSummary } from "../src/core/portfolio-economics.js";
import { getTaskEconomicsReport } from "../src/core/task-economics-report.js";
import { SettingsService } from "../src/core/settings.js";
import { StateStore } from "../src/state/store.js";

const TS = "2026-07-23T12:00:00.000Z";

// --- Helpers ---

function makeTask(
  id: string,
  status = "succeeded",
  maxBudgetUsd: number | null = null,
  provider: ProviderName = "deepseek",
  model = "deepseek-v4-pro",
  createdAt = TS,
  taskClass?: string,
  directCodexProfileId?: string,
): TaskRecord {
  return {
    id, name: `task-${id}`, status, sourcePath: "/tmp/src", taskFile: `/tmp/${id}.yaml`,
    spec: {
      version: 2, name: `task-${id}`, project: "/tmp/proj",
      provider: { name: provider, model, endpoint: "https://api.deepseek.com", keychainService: "fk" },
      runtime: { name: "claude-code", executable: "claude", effort: "medium", maxBudgetUsd },
      workspace: { exclude: [] },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
      contract: { outcome: "", context: [], inScope: [], outOfScope: [], executionSteps: [], deliverables: [], modules: [], callChain: [], scenarios: [], risks: [], changeBudget: { maxFiles: 1, maxDiffLines: 100 } },
      acceptance: { criteria: [], commands: ["true"] },
      ...(taskClass === undefined ? {} : { taskClass }),
      ...(directCodexProfileId === undefined ? {} : { directCodexProfileId }),
    },
    paths: { root: "/x", baseline: "/x", workspace: "/x", logs: "/x", claudeConfig: "/x", diff: "/x" },
    sessionId: `s-${id}`, createdAt, updatedAt: TS,
  } as TaskRecord;
}

function makeUsage(i: number, o: number, cr: number, cc: number): AttemptTokenUsage {
  return { inputTokens: i, outputTokens: o, cacheReadInputTokens: cr, cacheCreationInputTokens: cc,
    source: "terminal-result", complete: true };
}

function makeAttempt(
  id: string, taskId: string, ordinal: number,
  overrides?: Partial<AttemptRecord>,
): AttemptRecord {
  return { id, taskId, ordinal, status: "succeeded", sessionId: `s-${id}`,
    rawLogPath: `/tmp/${id}.log`, startedAt: TS, finishedAt: TS, exitCode: 0, ...overrides } as AttemptRecord;
}

function psnap(
  currency: PricingCurrency = "USD",
  src?: PricingSourceEvidence,
): PricingIdentitySnapshot {
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
    ] as any,
    pricing: psnap(currency),
    appliedTier: { applied: [{ minimumInputTokensExclusive: null, totalPromptInput: 1000 }], totalPromptInput: 1000 } as any,
    usageSource: "terminal-result", providerBillClaim: false,
  };
}

function quotedOC(qc: QuotedCost): AttemptOfficialCostQuoted {
  return { stage: "calculation", quoted: true, result: qc } as AttemptOfficialCostQuoted;
}

function calcUA(reason = "invalid-usage"): AttemptOfficialCostCalculationUnavailable {
  return { stage: "calculation", quoted: false,
    result: { quoted: false, reason, evidence: { provider: "ds", currency: null, tiersAvailable: 1, components: [], expectedAggregate: null, observedAggregate: null, positiveNullRateComponents: [] } } } as AttemptOfficialCostCalculationUnavailable;
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

// --- 1. Scope: running Tasks excluded, denominators visible ---

test("scope excludes running/waiting/queued tasks, counts terminal only", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("t1", "succeeded"));
    store.createTask(makeTask("t2", "failed"));
    store.createTask(makeTask("t3", "running"));
    store.createTask(makeTask("t4", "queued"));
    store.createTask(makeTask("t5", "interrupted"));

    store.createAttempt(makeAttempt("a1", "t1", 1, { runtimeBudgetUsd: 5 }));
    store.createAttempt(makeAttempt("a2", "t2", 1));
    store.createAttempt(makeAttempt("a4", "t5", 1, { runtimeBudgetUsd: null }));

    const s = getPortfolioEconomicsSummary(store);
    // Running + queued excluded
    assert.equal(s.scope.terminalTaskCount, 3);
    assert.equal(s.scope.nonEmpty, true);
    assert.equal(s.scope.totalAttemptCount, 3);
  } finally { store.close(); }
});

// --- 2. Budget: capped/uncapped/unknown counts, sum only finite caps ---

test("budget sums finite caps, counts uncapped and unknown, labels correctly", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("b1", "succeeded", 10));
    store.createTask(makeTask("b2", "succeeded", null));
    store.createTask(makeTask("b3", "succeeded", 5));

    store.createAttempt(makeAttempt("a1", "b1", 1, { runtimeBudgetUsd: 10 }));
    store.createAttempt(makeAttempt("a2", "b2", 1, { runtimeBudgetUsd: null }));
    store.createAttempt(makeAttempt("a3", "b3", 1, { runtimeBudgetUsd: 5 }));
    store.createAttempt(makeAttempt("a4", "b3", 2)); // legacy unknown

    const s = getPortfolioEconomicsSummary(store);
    assert.equal(s.runtimeBudget.configuredFiniteCapSumUsd, 15);
    assert.equal(s.runtimeBudget.cappedAttemptCount, 2);
    assert.equal(s.runtimeBudget.uncappedAttemptCount, 1);
    assert.equal(s.runtimeBudget.unknownAttemptCount, 1);
    assert.equal(s.runtimeBudget.totalAttemptCount, 4);
    assert.equal(s.runtimeBudget.complete, false);
  } finally { store.close(); }
});

test("budget aggregate is labelled configured-sum, never observed-spend", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("bs", "succeeded", 50));
    store.createAttempt(makeAttempt("aa", "bs", 1, { runtimeBudgetUsd: 50, costUsd: 3.7, runtimeCostEstimateUsd: 3.7 }));

    const s = getPortfolioEconomicsSummary(store);
    assert.equal(s.runtimeBudget.configuredFiniteCapSumUsd, 50);
    // Should NOT equal observed costUsd or runtime estimate
    assert.notEqual(s.runtimeBudget.configuredFiniteCapSumUsd, 3.7);
    assert.equal(s.runtimeEstimate.observedTotalUsd, 3.7);
    const json = JSON.stringify(s.runtimeBudget);
    assert.ok(!json.includes("spend"));
    assert.ok(!json.includes("observed"));
    assert.ok(!json.includes("authority"));
  } finally { store.close(); }
});

// --- 3. Runtime estimate: only runtimeCostEstimateUsd, legacy costUsd never leaks ---

test("runtime estimate uses only runtimeCostEstimateUsd; legacy costUsd never contributes", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("re"));
    store.createAttempt(makeAttempt("a1", "re", 1, { costUsd: 100, runtimeCostEstimateUsd: 3.5 }));
    store.createAttempt(makeAttempt("a2", "re", 2, { costUsd: 200 }));

    const s = getPortfolioEconomicsSummary(store);
    assert.equal(s.runtimeEstimate.observedTotalUsd, 3.5);
    assert.equal(s.runtimeEstimate.sampleCount, 1);
    assert.equal(s.runtimeEstimate.missingCount, 1);
    assert.equal(s.runtimeEstimate.complete, false);
    // Legacy costUsd 100 + 200 = 300 should never appear
    const json = JSON.stringify(s);
    assert.ok(!json.includes("100"), "costUsd 100 leaked");
    assert.ok(!json.includes("200"), "costUsd 200 leaked");
    assert.ok(!json.includes("300"), "summed costUsd 300 leaked");
  } finally { store.close(); }
});

test("empty store produces empty scope, zero denominators, complete false", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    const s = getPortfolioEconomicsSummary(store);
    assert.equal(s.scope.terminalTaskCount, 0);
    assert.equal(s.scope.nonEmpty, false);
    assert.equal(s.scope.totalAttemptCount, 0);
    assert.equal(s.runtimeBudget.complete, false);
    assert.equal(s.runtimeEstimate.complete, false);
  } finally { store.close(); }
});

// --- 4. Native currencies stay separate, no grand total ---

test("mixed USD and CNY: deterministic currency-total order, no grand total", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("c1"));
    store.createTask(makeTask("c2"));
    store.createAttempt(makeAttempt("a1", "c1", 1, { officialCost: quotedOC(makeQuotedCost("USD", 0.10)) }));
    store.createAttempt(makeAttempt("a2", "c2", 1, { officialCost: quotedOC(makeQuotedCost("CNY", 3.50)) }));
    store.createAttempt(makeAttempt("a3", "c2", 2, { officialCost: quotedOC(makeQuotedCost("USD", 0.05)) }));

    const s = getPortfolioEconomicsSummary(store);
    assert.equal(s.officialCost.currencyTotals.length, 2);
    assert.equal(s.officialCost.currencyTotals[0]!.currency, "CNY");
    assert.equal(s.officialCost.currencyTotals[0]!.total, 3.50);
    assert.equal(s.officialCost.currencyTotals[1]!.currency, "USD");
    assert.ok(Math.abs(s.officialCost.currencyTotals[1]!.total - 0.15) < 1e-12);
    assert.equal(s.officialCost.currencyTotals[1]!.quotedAttemptCount, 2);
    // No grand total
    const json = JSON.stringify(s.officialCost);
    assert.ok(!json.includes("grandTotal"));
    assert.ok(!json.includes("grand"));
  } finally { store.close(); }
});

test("official aggregate never fabricates a Provider bill claim", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("bc"));
    const qc = makeQuotedCost("USD", 0.01);
    store.createAttempt(makeAttempt("a1", "bc", 1, { officialCost: quotedOC(qc) }));

    const s = getPortfolioEconomicsSummary(store);
    assert.equal(s.officialCost.currencyTotals[0]!.providerBillClaim, false);
  } finally { store.close(); }
});

// --- 5. Unavailable official cost counted by stage:reason ---

test("unavailable official evidence counted by stable typed stage:reason breakdown", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("uo"));
    store.createAttempt(makeAttempt("a1", "uo", 1, { officialCost: quotedOC(makeQuotedCost("USD", 0.01)) }));
    store.createAttempt(makeAttempt("a2", "uo", 2, { officialCost: calcUA("per-request-usage-required") }));
    store.createAttempt(makeAttempt("a3", "uo", 3, { officialCost: usageUA("usage-missing") }));
    store.createAttempt(makeAttempt("a4", "uo", 4, { officialCost: idUA("unsupported-model") }));
    store.createAttempt(makeAttempt("a5", "uo", 5)); // missing officialCost

    const s = getPortfolioEconomicsSummary(store);
    assert.equal(s.officialCost.currencyTotals[0]!.quotedAttemptCount, 1);
    assert.equal(s.officialCost.unavailable.unavailableAttemptCount, 4);
    const bd = s.officialCost.unavailable.breakdown;
    assert.equal(bd["calculation:per-request-usage-required"], 1);
    assert.equal(bd["usage:usage-missing"], 1);
    assert.equal(bd["pricing-identity:unsupported-model"], 1);
    assert.equal(bd["missing:missing-officialCost-record"], 1);
  } finally { store.close(); }
});

// --- 6. Worker volume without calibration: volume reported, savings unavailable ---

test("Worker Token volume is execution volume only; direct-Codex savings remain unavailable", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("wv"));
    store.createAttempt(makeAttempt("a1", "wv", 1, { usage: makeUsage(1000, 500, 200, 50) }));

    const s = getPortfolioEconomicsSummary(store);
    assert.equal(s.workerVolume.grossWorkerTokens, 1750);
    assert.equal(s.workerVolume.completeTaskCount, 1);
    assert.equal(s.workerVolume.incompleteTaskCount, 0);
    // Direct-Codex savings: unavailable without calibration
    assert.equal(s.directCodexSavings.availableTaskCount, 0);
    assert.equal(s.directCodexSavings.unavailableTaskCount, 1);
    assert.ok(Object.keys(s.directCodexSavings.unavailableReasons).length > 0);
    // Worker volume section must not be labelled "savings"
    const json = JSON.stringify(s.workerVolume);
    assert.ok(!json.includes("savings"), "Worker volume must not leak savings label");
  } finally { store.close(); }
});

// --- 7. Compatible direct-Codex savings with negative bounds ---

test("compatible savings preserve negative bound arithmetic and confidence counts", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    // Task 1 with calibration where orchestration exchange > baseline → negative savings
    store.createTask(makeTask("n1", "succeeded", null, "deepseek", "deepseek-v4-pro", TS, "edit", "codex-main-v1"));
    store.createAttempt(makeAttempt("a1", "n1", 1, {
      usage: makeUsage(5000, 5000, 0, 0),
      runtimeCostEstimateUsd: 0.5,
    }));
    store.saveExchangeReceipt({
      id: "er1", taskId: "n1", operation: "build", transport: "mcp" as const,
      capturedAt: TS, outcome: "success" as const,
      requestArguments: { direction: "request", operation: "build", taskId: "n1",
        timestamp: TS, utf8Bytes: 10_000, asciiCount: 10_000, nonAsciiCount: 0 },
      responseRelationship: "may-overlap" as const,
    });
    store.saveDirectCodexProfilePublication({
      directCodexProfileId: "codex-main-v1",
      calibration: {
        minTokens: 800, maxTokens: 1200, method: "bench", taskClass: "edit",
        confidence: "medium", version: 1, sampleSize: 4,
        evidenceReferences: ["sample:edit-v1"], createdAt: TS, schemaVersion: 1,
      },
      envelopeSchemaVersion: 1,
    });

    // Task 2 with larger calibration → positive savings
    store.createTask(makeTask("n2", "succeeded", null, "deepseek", "deepseek-v4-pro", TS, "edit", "codex-main-v1"));
    store.createAttempt(makeAttempt("a2", "n2", 1, {
      usage: makeUsage(100, 50, 0, 0),
      runtimeCostEstimateUsd: 0.1,
    }));
    store.saveExchangeReceipt({
      id: "er2", taskId: "n2", operation: "build", transport: "mcp" as const,
      capturedAt: TS, outcome: "success" as const,
      requestArguments: { direction: "request", operation: "build", taskId: "n2",
        timestamp: TS, utf8Bytes: 50, asciiCount: 40, nonAsciiCount: 10 },
      responseRelationship: "may-overlap" as const,
    });

    const s = getPortfolioEconomicsSummary(store);
    const n1 = getTaskEconomicsReport(store, "n1").tokenReport.report.directCodexSavings;
    const n2 = getTaskEconomicsReport(store, "n2").tokenReport.report.directCodexSavings;
    assert.equal(n1.available, true);
    assert.equal(n2.available, true);
    if (!n1.available || !n2.available) throw new Error("fixture calibration unavailable");
    assert.equal(s.directCodexSavings.availableTaskCount, 2);
    assert.equal(s.directCodexSavings.unavailableTaskCount, 0);
    assert.equal(
      s.directCodexSavings.min,
      n1.absoluteSavings.min + n2.absoluteSavings.min,
    );
    assert.equal(
      s.directCodexSavings.max,
      n1.absoluteSavings.max + n2.absoluteSavings.max,
    );
    // One Task has orchestration exchange above the compatible baseline range.
    assert.ok(s.directCodexSavings.negativeBoundCount >= 1);
    // Confidence counts visible
    const cc = s.directCodexSavings.confidenceCounts;
    assert.ok(Object.keys(cc).length > 0);
    assert.ok(Object.keys(cc).every((k) => ["low", "medium", "high"].includes(k)));
  } finally { store.close(); }
});

// --- 8. Mixed complete and legacy Attempts ---

test("mixed complete and legacy attempts: complete exposed, missing counted, no zero-fabrication", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("ml"));
    // Full evidence Attempt
    store.createAttempt(makeAttempt("a1", "ml", 1, {
      usage: makeUsage(500, 250, 0, 0),
      runtimeCostEstimateUsd: 1.5,
      runtimeBudgetUsd: 5,
      officialCost: quotedOC(makeQuotedCost("USD", 0.07)),
    }));
    // Legacy Attempt: no budget snapshot, no runtime estimate, no usage, no official cost
    store.createAttempt(makeAttempt("a2", "ml", 2, { status: "interrupted" }));

    const s = getPortfolioEconomicsSummary(store);

    // Budget: one capped, one unknown
    assert.equal(s.runtimeBudget.configuredFiniteCapSumUsd, 5);
    assert.equal(s.runtimeBudget.cappedAttemptCount, 1);
    assert.equal(s.runtimeBudget.unknownAttemptCount, 1);
    assert.equal(s.runtimeBudget.complete, false);

    // Runtime estimate: one present, one missing
    assert.equal(s.runtimeEstimate.observedTotalUsd, 1.5);
    assert.equal(s.runtimeEstimate.sampleCount, 1);
    assert.equal(s.runtimeEstimate.missingCount, 1);
    assert.equal(s.runtimeEstimate.complete, false);

    // Official: one quoted, one missing
    assert.equal(s.officialCost.currencyTotals[0]!.quotedAttemptCount, 1);
    assert.equal(s.officialCost.unavailable.unavailableAttemptCount, 1);

    // Worker: one usage, one missing → incomplete
    assert.equal(s.workerVolume.grossWorkerTokens, 750);
    assert.equal(s.workerVolume.completeTaskCount, 0);
    assert.equal(s.workerVolume.incompleteTaskCount, 1);
    assert.equal(s.workerVolume.totalCompleteSampleCount, 1);
    assert.equal(s.workerVolume.totalMissingSampleCount, 1);

    // No value is zero because we assumed — missing is counted, not fabricated
    assert.equal(s.officialCost.unavailable.unavailableAttemptCount, 1);
  } finally { store.close(); }
});

// --- 9. Orchestration exchange and boundary reduction stay distinct ---

test("orchestration exchange ranges aggregate min/max, unavailable counted by reason", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    // Task with receipt → exchange available
    store.createTask(makeTask("ex"));
    store.createAttempt(makeAttempt("a1", "ex", 1, { usage: makeUsage(100, 50, 0, 0) }));
    store.saveExchangeReceipt({
      id: "erx", taskId: "ex", operation: "build", transport: "mcp" as const,
      capturedAt: TS, outcome: "success" as const,
      requestArguments: { direction: "request", operation: "build", taskId: "ex",
        timestamp: TS, utf8Bytes: 100, asciiCount: 80, nonAsciiCount: 20 },
      responseRelationship: "may-overlap" as const,
    });
    // Task without receipt → exchange unavailable
    store.createTask(makeTask("noex"));
    store.createAttempt(makeAttempt("a2", "noex", 1, { usage: makeUsage(200, 100, 0, 0) }));

    const s = getPortfolioEconomicsSummary(store);
    assert.equal(s.exchange.availableTaskCount, 1);
    assert.equal(s.exchange.unavailableTaskCount, 1);
    assert.ok(typeof s.exchange.min === "number");
    assert.ok(typeof s.exchange.max === "number");
    // Boundary reduction from exchange tasks is computed independently
    assert.ok(s.boundaryReduction.availableTaskCount <= 1);
    // Exchange unavailable reason is typed
    const reasons = s.exchange.unavailableReasons;
    assert.ok(Object.keys(reasons).length > 0);
    assert.ok(Object.keys(reasons).every((r) => r.length > 0));
  } finally { store.close(); }
});

test("boundary reduction is not claimed as direct-Codex savings", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("br"));
    store.createAttempt(makeAttempt("a1", "br", 1, { usage: makeUsage(200, 100, 0, 0) }));
    store.saveExchangeReceipt({
      id: "erb", taskId: "br", operation: "build", transport: "mcp" as const,
      capturedAt: TS, outcome: "success" as const,
      requestArguments: { direction: "request", operation: "build", taskId: "br",
        timestamp: TS, utf8Bytes: 100, asciiCount: 80, nonAsciiCount: 20 },
      responseRelationship: "may-overlap" as const,
    });
    const s = getPortfolioEconomicsSummary(store);
    // Boundary reduction uses different arithmetic than direct-Codex
    assert.equal(s.directCodexSavings.availableTaskCount, 0);
    assert.equal(s.directCodexSavings.unavailableTaskCount, 1);
    // The two concepts are separate sections
    assert.notEqual(s.boundaryReduction.min, s.directCodexSavings.min);
  } finally { store.close(); }
});

// --- 10. Filtering: provider/model/time filter selects correct terminal Tasks ---

test("provider filter selects matching terminal Tasks only", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("ds1", "succeeded", 5, "deepseek", "deepseek-v4-pro"));
    store.createTask(makeTask("mm1", "succeeded", 10, "minimax", "m3"));
    store.createTask(makeTask("ds2", "interrupted", null, "deepseek", "deepseek-v4-flash"));

    store.createAttempt(makeAttempt("a1", "ds1", 1, { runtimeBudgetUsd: 5 }));
    store.createAttempt(makeAttempt("a2", "mm1", 1, { runtimeBudgetUsd: 10 }));
    store.createAttempt(makeAttempt("a3", "ds2", 1));

    const s = getPortfolioEconomicsSummary(store, { providerName: "deepseek" });
    assert.equal(s.scope.terminalTaskCount, 2);
    assert.equal(s.runtimeBudget.configuredFiniteCapSumUsd, 5); // only ds1 capped
  } finally { store.close(); }
});

test("model filter narrows to specific model", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("m1", "succeeded", 5, "deepseek", "deepseek-v4-pro"));
    store.createTask(makeTask("m2", "succeeded", 10, "deepseek", "deepseek-v4-flash"));

    store.createAttempt(makeAttempt("a1", "m1", 1, { runtimeBudgetUsd: 5 }));
    store.createAttempt(makeAttempt("a2", "m2", 1, { runtimeBudgetUsd: 10 }));

    const s = getPortfolioEconomicsSummary(store, { modelName: "deepseek-v4-pro" });
    assert.equal(s.scope.terminalTaskCount, 1);
    assert.equal(s.runtimeBudget.configuredFiniteCapSumUsd, 5);
  } finally { store.close(); }
});

test("time filter excludes tasks outside since/until range", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    const early = "2026-01-01T00:00:00.000Z";
    const mid = "2026-07-23T12:00:00.000Z";
    const late = "2026-12-31T23:59:59.999Z";

    store.createTask(makeTask("e1", "succeeded", 1, "deepseek", "deepseek-v4-pro", early));
    store.createTask(makeTask("m1", "succeeded", 2, "deepseek", "deepseek-v4-pro", mid));
    store.createTask(makeTask("l1", "succeeded", 3, "deepseek", "deepseek-v4-pro", late));

    store.createAttempt(makeAttempt("a1", "e1", 1, { runtimeBudgetUsd: 1 }));
    store.createAttempt(makeAttempt("a2", "m1", 1, { runtimeBudgetUsd: 2 }));
    store.createAttempt(makeAttempt("a3", "l1", 1, { runtimeBudgetUsd: 3 }));

    const s = getPortfolioEconomicsSummary(store, {
      since: "2026-06-01T00:00:00.000Z",
      until: "2026-08-01T00:00:00.000Z",
    });
    assert.equal(s.scope.terminalTaskCount, 1);
    assert.equal(s.runtimeBudget.configuredFiniteCapSumUsd, 2);
  } finally { store.close(); }
});

// --- 11. Deterministic ordering and deep freeze ---

test("identical state produces identical detached non-reference-equal summaries", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("d1", "succeeded", 5));
    store.createAttempt(makeAttempt("a1", "d1", 1, {
      usage: makeUsage(100, 50, 0, 0), runtimeCostEstimateUsd: 0.5,
      runtimeBudgetUsd: 5, officialCost: quotedOC(makeQuotedCost("USD", 0.03)),
    }));

    const s1 = getPortfolioEconomicsSummary(store);
    const s2 = getPortfolioEconomicsSummary(store);
    assert.deepEqual(s1, s2);
    assert.notEqual(s1, s2);
    assert.notEqual(s1.scope, s2.scope);
    assert.notEqual(s1.runtimeBudget, s2.runtimeBudget);
    assert.notEqual(s1.runtimeEstimate, s2.runtimeEstimate);
  } finally { store.close(); }
});

test("report is deeply frozen; mutation throws TypeError", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("f1"));
    store.createAttempt(makeAttempt("a1", "f1", 1, {
      runtimeCostEstimateUsd: 0.5, officialCost: quotedOC(makeQuotedCost("USD", 0.01)),
    }));

    const s = getPortfolioEconomicsSummary(store);
    assertDeepFrozen(s);

    // Top-level mutation
    assert.throws(() => { (s as any).scope = {}; }, TypeError);
    // Nested mutation
    assert.throws(() => { (s.scope as any).terminalTaskCount = 99; }, TypeError);
    assert.throws(() => { (s.runtimeBudget as any).configuredFiniteCapSumUsd = 999; }, TypeError);
    assert.throws(() => { (s.runtimeEstimate as any).observedTotalUsd = 999; }, TypeError);
    assert.throws(() => { (s.officialCost.currencyTotals as any[])[0] = {}; }, TypeError);
    assert.throws(() => {
      (s.officialCost.unavailable.breakdown as Record<string, number>).x = 1;
    }, TypeError);
  } finally { store.close(); }
});

// --- 12. Privacy: no private fields leaked ---

test("summary never exposes resultText, error, rawLogPath, keychainService, or contract content", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("p1"));
    store.createAttempt(makeAttempt("a1", "p1", 1, {
      runtimeCostEstimateUsd: 0.5,
      officialCost: quotedOC(makeQuotedCost("USD", 0.01)),
      resultText: "secret result text", error: "secret-error", rawLogPath: "/secret/log",
    }));

    const s = getPortfolioEconomicsSummary(store);
    const json = JSON.stringify(s);
    for (const w of ["secret result", "secret-error", "/secret/log",
      "resultText", "error", "rawLogPath", "keychainService", "sessionId",
      "outcome", "executionSteps", "prompt"])
      assert.ok(!json.includes(w), `Summary leaked: ${w}`);
  } finally { store.close(); }
});

// --- 13. Read-only guarantee ---

test("service is read-only: Store state unchanged after summary", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("ro"));
    store.createAttempt(makeAttempt("a1", "ro", 1, { runtimeCostEstimateUsd: 0.5 }));

    const beforeTasks = store.listTasks().length;
    const beforeAttempts = store.listAttempts("ro").length;

    getPortfolioEconomicsSummary(store);
    getPortfolioEconomicsSummary(store);

    const afterTasks = store.listTasks().length;
    const afterAttempts = store.listAttempts("ro").length;
    assert.equal(afterTasks, beforeTasks);
    assert.equal(afterAttempts, beforeAttempts);
    assert.equal(store.getTask("ro").status, "succeeded");
  } finally { store.close(); }
});

// --- 14. Currency-total source dedup ---

test("official cost sources dedup across tasks and stay sorted", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("d1"));
    store.createTask(makeTask("d2"));
    store.createAttempt(makeAttempt("a1", "d1", 1, { officialCost: quotedOC(makeQuotedCost("USD", 0.10)) }));
    const mmCost: QuotedCost = {
      ...makeQuotedCost("USD", 0.30),
      pricing: psnap("USD", { url: "https://platform.minimax.io/docs/guides/pricing-paygo", checkedAt: TS }),
    };
    store.createAttempt(makeAttempt("a2", "d2", 1, { officialCost: quotedOC(mmCost) }));

    const s = getPortfolioEconomicsSummary(store);
    assert.equal(s.officialCost.currencyTotals.length, 1);
    assert.equal(s.officialCost.currencyTotals[0]!.sources.length, 2);
    assert.equal(s.officialCost.currencyTotals[0]!.sources[0], "https://api-docs.deepseek.com/quick_start/pricing/");
    assert.equal(s.officialCost.currencyTotals[0]!.sources[1], "https://platform.minimax.io/docs/guides/pricing-paygo");
  } finally { store.close(); }
});

// --- 15. Worker volume completeness tracking ---

test("worker volume tracks complete vs incomplete task count and sample counts", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-"));
  const store = new StateStore(home);
  try {
    // Complete worker task
    store.createTask(makeTask("wc"));
    store.createAttempt(makeAttempt("a1", "wc", 1, { usage: makeUsage(100, 50, 0, 0) }));

    // Incomplete worker task
    store.createTask(makeTask("wi"));
    store.createAttempt(makeAttempt("a2", "wi", 1, { usage: makeUsage(200, 100, 0, 0) }));
    store.createAttempt(makeAttempt("a3", "wi", 2)); // no usage

    const s = getPortfolioEconomicsSummary(store);
    assert.equal(s.workerVolume.completeTaskCount, 1);
    assert.equal(s.workerVolume.incompleteTaskCount, 1);
    assert.equal(s.workerVolume.totalTaskCount, 2);
    assert.equal(s.workerVolume.totalCompleteSampleCount, 2); // 1 from complete + 1 from incomplete's complete sample
    assert.equal(s.workerVolume.totalMissingSampleCount, 1);
    assert.equal(s.workerVolume.grossWorkerTokens, 450);
  } finally { store.close(); }
});

test("portfolio reconciliation reports real GLM mismatch without changing Worker volume", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-rec-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("glm-rec"));
    store.createTask(makeTask("no-breakdown"));
    store.createAttempt(makeAttempt("a-glm", "glm-rec", 1, {
      usage: {
        inputTokens: 378_237,
        outputTokens: 126_836,
        cacheReadInputTokens: 40_756_800,
        cacheCreationInputTokens: 0,
        source: "terminal-result",
        complete: true,
        perModel: [
          {
            model: "glm-5.2[1m]",
            inputTokens: 378_658,
            outputTokens: 132_190,
            cacheReadInputTokens: 42_633_920,
            cacheCreationInputTokens: 0,
          },
        ],
      },
    }));
    store.createAttempt(makeAttempt("a-gap", "no-breakdown", 1, {
      usage: makeUsage(100, 50, 0, 0),
    }));

    const s = getPortfolioEconomicsSummary(store);
    const rec = s.tokenReconciliation;
    assert.equal(rec.workerVolumeSource, "terminal-top-level");
    assert.equal(rec.perModelRole, "diagnostic-only");
    assert.deepEqual(rec.stateCounts, {
      matched: 0, mismatch: 1, partial: 0, unavailable: 1,
    });
    assert.equal(rec.comparedAttemptCount, 1);
    assert.equal(rec.mismatchedAttemptCount, 1);
    assert.equal(rec.missingBreakdownCount, 1);
    assert.equal(rec.comparison.available, true);
    if (!rec.comparison.available) assert.fail("comparison unavailable");
    assert.equal(rec.comparison.availableTaskCount, 1);
    assert.equal(rec.comparison.unavailableTaskCount, 1);
    assert.equal(rec.comparison.topLevelGross, 41_261_873);
    assert.equal(rec.comparison.perModelGross, 43_144_768);
    assert.equal(rec.comparison.delta, 1_882_895);
    assert.equal(s.workerVolume.grossWorkerTokens, 41_262_023);
    assert.notEqual(s.workerVolume.grossWorkerTokens, rec.comparison.perModelGross + 150);
    assertDeepFrozen(rec);
  } finally { store.close(); }
});

// --- 16. Hub economics-summary bridge ---
//
// These tests exercise the read-only Hub bridge to daemon economics_summary
// (HTTP layer), the isolated polling behavior on the JS side, and the
// static-asset invariants that lock the new Insights hierarchy.

class MemoryKeychain implements SetupKeychainStore {
  readonly values = new Map<string, string>();
  private id(s: string, a: string): string { return `${a}:${s}`; }
  has(s: string, a: string): boolean { return this.values.has(this.id(s, a)); }
  read(s: string, a: string): string | undefined { return this.values.get(this.id(s, a)); }
  write(s: string, a: string, v: string): void { this.values.set(this.id(s, a), v); }
  delete(s: string, a: string): void { this.values.delete(this.id(s, a)); }
}

function makeInspector(): SetupSystemInspector {
  return {
    platform: () => "darwin",
    nodeVersion: () => "v24.5.0",
    account: () => "hub-econ-user",
    commandExists: () => true,
  };
}

function httpDoGet(
  url: string,
  token?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers["x-forklight-hub-token"] = token;
    const req = httpGet(url, { headers }, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", reject);
    req.end();
  });
}

interface EconHub {
  base: string;
  token: string;
  calls: Array<{ method: string; params: Record<string, unknown> }>;
  cleanup: () => Promise<void>;
}

async function makeEconomicsHub(
  handler: (params: Record<string, unknown>) => Record<string, unknown>,
): Promise<EconHub> {
  const home = await mkdtemp(path.join(tmpdir(), "fl-hub-econ-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const keychain = new MemoryKeychain();
  const setup = new SetupService(settings, keychain, makeInspector());
  const staticDir = path.join(home, "static");
  await mkdir(staticDir, { recursive: true });
  await writeFile(path.join(staticDir, "index.html"), "<!DOCTYPE html><title>Hub</title>\n", "utf8");
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const server = new HubServer({
    settings,
    setup,
    keychain,
    staticRoot: staticDir,
    account: () => "hub-econ-user",
    port: 0,
    ensureDaemon: async () => ({ ok: true, pid: 88 }),
    probeDaemon: async () => ({ running: true, health: { ok: true, pid: 88 } }),
    daemonRequest: async <T>(method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params });
      if (method === "economics_summary") return handler(params) as T;
      throw new Error(`unexpected method ${method}`);
    },
  });
  const port = await server.start();
  return {
    base: `http://127.0.0.1:${port}`,
    token: server.getToken(),
    calls,
    cleanup: async () => {
      await server.stop();
      store.close();
    },
  };
}

test("GET /api/ops/economics-summary forwards to daemon economics_summary", async () => {
  const expected = {
    scope: { terminalTaskCount: 2, totalAttemptCount: 3, nonEmpty: true },
    runtimeBudget: {
      configuredFiniteCapSumUsd: 25, cappedAttemptCount: 2, uncappedAttemptCount: 1,
      unknownAttemptCount: 0, totalAttemptCount: 3, complete: true,
    },
    runtimeEstimate: { observedTotalUsd: 4.5, sampleCount: 3, missingCount: 0, complete: true },
    officialCost: { currencyTotals: [], ranges: [], unavailable: { unavailableAttemptCount: 0, breakdown: {} } },
    workerVolume: {
      grossWorkerTokens: 9000, completeTaskCount: 2, incompleteTaskCount: 0,
      totalTaskCount: 2, totalCompleteSampleCount: 2, totalMissingSampleCount: 0,
    },
    exchange: { min: 100, max: 200, availableTaskCount: 2, unavailableTaskCount: 0, unavailableReasons: {} },
    boundaryReduction: {
      min: 50, max: 80, availableTaskCount: 1, unavailableTaskCount: 1, unavailableReasons: {},
    },
    directCodexSavings: {
      min: 5, max: 9, availableTaskCount: 1, unavailableTaskCount: 1,
      unavailableReasons: {}, negativeBoundCount: 0, confidenceCounts: { high: 1 },
    },
  };
  const ctx = await makeEconomicsHub(() => expected);
  try {
    const res = await httpDoGet(`${ctx.base}/api/ops/economics-summary`, ctx.token);
    assert.equal(res.status, 200);
    assert.ok(ctx.calls.some((c) => c.method === "economics_summary"));
    const parsed = JSON.parse(res.body) as Record<string, unknown>;
    assert.equal(
      (parsed.scope as Record<string, unknown> | undefined)?.terminalTaskCount, 2,
    );
    assert.equal(
      (parsed.runtimeEstimate as Record<string, unknown> | undefined)?.observedTotalUsd, 4.5,
    );
    const totals = (parsed.officialCost as { currencyTotals: unknown[] }).currencyTotals;
    assert.deepEqual(totals, []);
    const raw = JSON.stringify(parsed);
    assert.ok(!raw.includes("costUsd"), "no legacy costUsd leak in bridged summary");
  } finally {
    await ctx.cleanup();
  }
});

test("GET /api/ops/economics-summary rejects without token", async () => {
  const ctx = await makeEconomicsHub(() => ({}));
  try {
    const res = await httpDoGet(`${ctx.base}/api/ops/economics-summary`);
    assert.equal(res.status, 401);
    assert.equal(ctx.calls.length, 0, "no daemon call without token");
  } finally {
    await ctx.cleanup();
  }
});

test("GET /api/ops/economics-summary daemon error becomes bounded error response", async () => {
  const ctx = await makeEconomicsHub(() => {
    throw new Error("economics_summary is not yet implemented in this daemon build");
  });
  try {
    const res = await httpDoGet(`${ctx.base}/api/ops/economics-summary`, ctx.token);
    // The Hub server maps any non-NotFound daemon error to 503; the important
    // guarantee is that the response body is the bounded Hub JSON shape, not
    // the raw stack trace.
    assert.equal(res.status, 503);
    const parsed = JSON.parse(res.body) as { error?: string };
    assert.ok(parsed.error && parsed.error.includes("economics_summary"));
    assert.ok(
      !JSON.stringify(parsed).includes("\n    at "),
      "raw stack trace must not leak",
    );
  } finally {
    await ctx.cleanup();
  }
});

test("app.js declares isolated economics polling separated from the all-ops promise", async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const appPath = path.join(root, "src", "hub", "public", "app.js");
  const src = await readFile(appPath, "utf8");
  assert.ok(src.includes("S.economics"), "S.economics state slot");
  assert.ok(src.includes("S.economicsError"), "S.economicsError state slot");
  assert.ok(src.includes("function pollEconomics"), "isolated poll helper");
  assert.ok(src.includes("/api/ops/economics-summary"), "endpoint URL on the wire");
  // The isolated fetcher must be passed to Promise.all alongside other ops so
  // its failure does not make Tasks / Boards / Settings look disconnected.
  assert.match(src, /Promise\.all\(\[hubP\.catch\([\s\S]*?opsP,\s*econP\]/);
});

test("Insights renderer uses truthful runtime-estimate fields and never avgCostUsd", async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const appPath = path.join(root, "src", "hub", "public", "app.js");
  const src = await readFile(appPath, "utf8");
  // Per-provider outcome cards use the new per-Task complete runtime fields.
  assert.ok(src.includes("runtimeEstimateTaskSampleSize"), "reads runtimeEstimateTaskSampleSize");
  assert.ok(src.includes("avgRuntimeEstimatePerTaskUsd"), "reads avgRuntimeEstimatePerTaskUsd");
  // Insights hierarchy must not call avgCostUsd.
  const rStatsIdx = src.indexOf("function rStats()");
  assert.ok(rStatsIdx > 0, "rStats present");
  const nextFn = src.indexOf("function ", rStatsIdx + 1);
  const rStatsBlock = src.slice(rStatsIdx, nextFn > 0 ? nextFn : src.length);
  assert.ok(!/avgCostUsd/.test(rStatsBlock), "rStats must not reference avgCostUsd");
  assert.ok(!/costSampleSize/.test(rStatsBlock), "rStats must not reference costSampleSize");
  assert.ok(
    rStatsBlock.includes("runtimeEstimateTaskSampleSize"),
    "rStats reads runtimeEstimateTaskSampleSize (truthful new field)",
  );
  assert.ok(
    rStatsBlock.includes("avgRuntimeEstimatePerTaskUsd"),
    "rStats reads avgRuntimeEstimatePerTaskUsd (truthful new field)",
  );
  // Portfolio renderer hardens the language.
  assert.ok(src.includes("econDirectCaveat"), "direct-Codex savings caveat key");
  assert.ok(src.includes("econWorkerVolumeCaveat"), "worker volume caveat key");
  assert.ok(src.includes("renderTokenReconciliationSection"), "portfolio reconciliation renderer");
  assert.ok(src.includes("s && s.tokenReconciliation"), "portfolio reconciliation payload binding");
  assert.ok(src.includes("econReconciliationCaveat"), "reconciliation soft-warning caveat key");
  assert.ok(src.includes("econOfficialCaveat"), "official caveat key");
  assert.ok(src.includes("renderPortfolioEconomics"), "portfolio renderer");
  assert.ok(src.includes("renderScopeStrip"), "scope strip renderer");
});

test("i18n.js exposes the new economy strings in both languages", async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const i18nPath = path.join(root, "src", "hub", "public", "i18n.js");
  const i18n = await readFile(i18nPath, "utf8");
  const enKeys = [
    "econEvidenceSectionTitle", "econScopeTasks", "econScopeAttempts",
    "econExchangeTitle", "econDirectTitle", "econWorkerVolumeTitle",
    "econReconciliationTitle", "econReconciliationOutcome",
    "econReconciliationComparedScope", "econReconciliationCaveat",
    "econBudgetTitle", "econRuntimeTitle", "econOfficialSectionCaveat",
    "econBoundaryCaveat", "econReasonDirectBaselineMissing",
    "econReasonMissingExchangeEvidence",
    "statsRuntimeEstimateNote", "statsRuntimeEstimateMissing",
  ];
  for (const k of enKeys) {
    assert.ok(i18n.includes(k), `en key ${k}`);
  }
  // Spot-check Chinese translations are real, not the English fallback.
  assert.ok(i18n.includes("经济性证据"), "zh hero title");
  assert.ok(i18n.includes("执行足迹"), "zh worker volume title");
  assert.ok(i18n.includes("Worker 用量交叉核对"), "zh reconciliation title");
  assert.ok(i18n.includes("不会触发重试或阻止合入"), "zh soft warning semantics");
  assert.ok(i18n.includes("官方本币估算"), "zh official section");
  assert.ok(i18n.includes("未捕获兑换"), "zh missing exchange reason");
});

test("app.css defines asymmetric evidence layout for the Insights hierarchy", async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const cssPath = path.join(root, "src", "hub", "public", "app.css");
  const css = await readFile(cssPath, "utf8");
  assert.ok(
    /\.econ-evidence-grid\s*\{[^}]*grid-template-columns\s*:\s*1fr\s+1fr/i.test(css),
    "two-column desktop grid for evidence cards",
  );
  assert.ok(
    /@media\s*\(\s*max-width\s*:\s*768px\s*\)\s*\{\s*\.econ-evidence-grid\s*\{\s*grid-template-columns\s*:\s*1fr\s*;?\s*\}/i.test(css),
    "single-column mobile collapse",
  );
  assert.ok(css.includes(".scope-strip"), "scope-strip present");
  assert.ok(css.includes(".insights-title"), "insights title treatment present");
});

// --- 17. Portfolio official cost range aggregation ----------------------------

function emptyEv(provider: string, currency: PricingCurrency | null) {
  return { provider, currency, tiersAvailable: 1, components: [],
    expectedAggregate: null, observedAggregate: null, positiveNullRateComponents: [] };
}

function makeBoundedEstimate(currency: PricingCurrency = "USD", min = 0.10, max = 0.30): BoundedEstimate {
  return {
    currency,
    min,
    max,
    components: [
      { component: "input", tokens: 100_000, minRatePerMillion: 0.30, maxRatePerMillion: 0.60, minAmount: 0.03, maxAmount: 0.06 },
      { component: "output", tokens: 50_000, minRatePerMillion: 1.20, maxRatePerMillion: 2.40, minAmount: 0.06, maxAmount: 0.12 },
      { component: "cacheRead", tokens: 20_000, minRatePerMillion: 0.06, maxRatePerMillion: 0.12, minAmount: 0.0012, maxAmount: 0.0024 },
      { component: "cacheCreation", tokens: 0, minRatePerMillion: 0, maxRatePerMillion: 0, minAmount: 0, maxAmount: 0 },
    ],
    pricing: psnap(currency),
    method: "aggregate-tier-bounds",
    usageSource: "terminal-result",
    providerBillClaim: false,
  };
}

function calcUAWithRange(reason = "per-request-usage-required", be?: BoundedEstimate): AttemptOfficialCostCalculationUnavailable {
  return {
    stage: "calculation", quoted: false,
    result: { quoted: false, reason, evidence: emptyEv("mm", "USD"), ...(be === undefined ? {} : { boundedEstimate: be }) },
  } as AttemptOfficialCostCalculationUnavailable;
}

test("portfolio ranges aggregate additively across Tasks per currency", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-pf-range-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("t1"));
    store.createTask(makeTask("t2"));
    store.createAttempt(makeAttempt("a1", "t1", 1, {
      officialCost: calcUAWithRange("per-request-usage-required", makeBoundedEstimate("USD", 0.10, 0.30)),
    }));
    store.createAttempt(makeAttempt("a2", "t2", 1, {
      officialCost: calcUAWithRange("per-request-usage-required", makeBoundedEstimate("USD", 0.20, 0.50)),
    }));

    const s = getPortfolioEconomicsSummary(store);
    assert.equal(s.officialCost.ranges.length, 1);
    assert.equal(s.officialCost.ranges[0]!.currency, "USD");
    assert.ok(Math.abs(s.officialCost.ranges[0]!.min - 0.30) < 1e-12);
    assert.ok(Math.abs(s.officialCost.ranges[0]!.max - 0.80) < 1e-12);
    assert.equal(s.officialCost.ranges[0]!.rangedAttemptCount, 2);
  } finally { store.close(); }
});

test("portfolio mixed USD and CNY ranges stay separate", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-pf-range2-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("t1"));
    store.createTask(makeTask("t2"));
    store.createAttempt(makeAttempt("a1", "t1", 1, {
      officialCost: calcUAWithRange("per-request-usage-required", makeBoundedEstimate("USD", 0.10, 0.30)),
    }));
    store.createAttempt(makeAttempt("a2", "t2", 1, {
      officialCost: calcUAWithRange("per-request-usage-required", makeBoundedEstimate("CNY", 5.00, 12.00)),
    }));

    const s = getPortfolioEconomicsSummary(store);
    assert.equal(s.officialCost.ranges.length, 2);
    assert.equal(s.officialCost.ranges[0]!.currency, "CNY");
    assert.ok(Math.abs(s.officialCost.ranges[0]!.min - 5.00) < 1e-12);
    assert.ok(Math.abs(s.officialCost.ranges[0]!.max - 12.00) < 1e-12);
    assert.equal(s.officialCost.ranges[0]!.rangedAttemptCount, 1);
    assert.equal(s.officialCost.ranges[1]!.currency, "USD");
    assert.ok(Math.abs(s.officialCost.ranges[1]!.min - 0.10) < 1e-12);
    assert.ok(Math.abs(s.officialCost.ranges[1]!.max - 0.30) < 1e-12);
    assert.equal(s.officialCost.ranges[1]!.rangedAttemptCount, 1);
  } finally { store.close(); }
});

test("portfolio range sources dedup across tasks", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ec-pf-range3-"));
  const store = new StateStore(home);
  try {
    store.createTask(makeTask("t1"));
    store.createTask(makeTask("t2"));
    store.createAttempt(makeAttempt("a1", "t1", 1, {
      officialCost: calcUAWithRange("per-request-usage-required", makeBoundedEstimate("USD", 0.10, 0.30)),
    }));
    store.createAttempt(makeAttempt("a2", "t2", 1, {
      officialCost: calcUAWithRange("per-request-usage-required", makeBoundedEstimate("USD", 0.20, 0.50)),
    }));

    const s = getPortfolioEconomicsSummary(store);
    assert.equal(s.officialCost.ranges[0]!.sources.length, 1);
    assert.equal(s.officialCost.ranges[0]!.sources[0], "https://api-docs.deepseek.com/quick_start/pricing/");
  } finally { store.close(); }
});

// --- 18. Range renderer is wired in the UI to the official range family ---

test("Hub UI renderer exposes official ranges separately from exact totals and unavailable", async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const appPath = path.join(root, "src", "hub", "public", "app.js");
  const i18nPath = path.join(root, "src", "hub", "public", "i18n.js");
  const src = await readFile(appPath, "utf8");
  const i18n = await readFile(i18nPath, "utf8");

  // Renderer is defined and decoupled from exact totals.
  assert.ok(src.includes("function renderOfficialRangeCards"), "range renderer is defined");
  const rendererIdx = src.indexOf("function renderOfficialRangeCards");
  const nextFn = src.indexOf("function ", rendererIdx + 1);
  const rendererBlock = src.slice(rendererIdx, nextFn > 0 ? nextFn : src.length);
  assert.ok(rendererBlock.includes("rangedAttemptCount"),
    "range renderer reads rangedAttemptCount");
  assert.ok(rendererBlock.includes("sources"),
    "range renderer iterates over priced sources");
  assert.ok(!rendererBlock.includes("currencyTotals"),
    "range renderer does not read exact currencyTotals");
  assert.ok(rendererBlock.includes("evSources"),
    "range renderer wires official source links");
  assert.ok(rendererBlock.includes("evCaveat"),
    "range renderer carries a conservative caveat");
  // Compatibility default: missing ranges field is treated as empty list.
  assert.match(src, /\(section\s*&&\s*section\.ranges\)\s*\|\|\s*\[\]/);

  // Portfolio renderer wires the new renderer and conditionally renders the
  // range subsection. Unavailable evidence continues to render separately.
  assert.ok(src.includes("renderOfficialRangeCards(s && s.officialCost)"),
    "portfolio renderer calls range renderer");
  assert.ok(src.includes("renderOfficialUnavailableSection(s && s.officialCost && s.officialCost.unavailable)"),
    "portfolio renderer still calls unavailable renderer");

  // Bilingual truthfulness copy.
  assert.match(i18n, /econOfficialRangeCaveat['"]?\s*:\s*"[^"]*Conservative[^"]*[Nn]ot exact[^"]*not a Provider bill/);
  assert.match(i18n, /econOfficialRangeSubsectionCaveat['"]?\s*:\s*"[^"]*Lower-upper[^"]*not a Provider bill/);
  assert.ok(i18n.includes("保守的累加下界-上界，非精确，非 Provider 账单"), "zh range caveat");
});

test("Hub bridge passes ranges through from the daemon economics summary", async () => {
  const expected = {
    scope: { terminalTaskCount: 1, totalAttemptCount: 1, nonEmpty: true },
    runtimeBudget: {
      configuredFiniteCapSumUsd: 0, cappedAttemptCount: 0, uncappedAttemptCount: 1,
      unknownAttemptCount: 0, totalAttemptCount: 1, complete: true,
    },
    runtimeEstimate: { observedTotalUsd: 0, sampleCount: 0, missingCount: 1, complete: false },
    officialCost: {
      currencyTotals: [],
      ranges: [{
        currency: "USD", min: 0.10, max: 0.30, rangedAttemptCount: 1,
        sources: ["https://api-docs.deepseek.com/quick_start/pricing/"],
      }],
      unavailable: { unavailableAttemptCount: 1, breakdown: { "calculation:per-request-usage-required": 1 } },
    },
    workerVolume: {
      grossWorkerTokens: 0, completeTaskCount: 0, incompleteTaskCount: 1,
      totalTaskCount: 1, totalCompleteSampleCount: 0, totalMissingSampleCount: 1,
    },
    exchange: { min: 0, max: 0, availableTaskCount: 0, unavailableTaskCount: 1, unavailableReasons: {} },
    boundaryReduction: {
      min: 0, max: 0, availableTaskCount: 0, unavailableTaskCount: 1, unavailableReasons: {},
    },
    directCodexSavings: {
      min: 0, max: 0, availableTaskCount: 0, unavailableTaskCount: 1,
      unavailableReasons: {}, negativeBoundCount: 0, confidenceCounts: {},
    },
  };
  const ctx = await makeEconomicsHub(() => expected);
  try {
    const res = await httpDoGet(`${ctx.base}/api/ops/economics-summary`, ctx.token);
    assert.equal(res.status, 200);
    const parsed = JSON.parse(res.body) as Record<string, unknown>;
    const oc = parsed.officialCost as {
      currencyTotals: unknown[];
      ranges: Array<{ currency: string; min: number; max: number; rangedAttemptCount: number; sources: string[] }>;
      unavailable: { unavailableAttemptCount: number };
    };
    assert.equal(oc.currencyTotals.length, 0, "exact totals absent");
    assert.equal(oc.ranges.length, 1, "range reaches the Hub bridge");
    assert.equal(oc.ranges[0]!.currency, "USD");
    assert.equal(oc.ranges[0]!.rangedAttemptCount, 1);
    assert.equal(oc.ranges[0]!.sources.length, 1);
    assert.equal(oc.unavailable.unavailableAttemptCount, 1,
      "ranged Attempts still count as unavailable exact evidence");
  } finally {
    await ctx.cleanup();
  }
});
