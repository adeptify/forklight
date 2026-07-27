import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CATALOG, type PricingCatalogEntry } from "../src/core/pricing.js";
import {
  calculateOfficialCost,
  type ComponentQuote,
  type QuotedCost,
  type PricingQuote,
  type RequestTokenUsage,
  type UnavailableCost,
} from "../src/core/pricing-calculator.js";
import type { AttemptTokenUsage } from "../src/core/types.js";

// Helpers ---------------------------------------------------------------------

const usage = (i: number, o: number, cr: number, cc: number): AttemptTokenUsage =>
  ({ inputTokens: i, outputTokens: o, cacheReadInputTokens: cr, cacheCreationInputTokens: cc,
    source: "terminal-result", complete: true });

const row = (i: number, o: number, cr: number, cc: number): RequestTokenUsage =>
  ({ inputTokens: i, outputTokens: o, cacheReadInputTokens: cr, cacheCreationInputTokens: cc });

function assertDeepFrozen(v: unknown, path = "root"): void {
  if (v === null || typeof v !== "object") return;
  assert.ok(Object.isFrozen(v), `Expected ${path} frozen`);
  if (Array.isArray(v)) for (let i = 0; i < v.length; i++) assertDeepFrozen(v[i], `${path}[${i}]`);
  else for (const k of Object.keys(v as Record<string, unknown>))
    assertDeepFrozen((v as Record<string, unknown>)[k], `${path}.${k}`);
}

const asQuoted = (r: PricingQuote): QuotedCost => { assert.equal(r.quoted, true); return r as QuotedCost; };
const asUnavail = (r: PricingQuote, reason: UnavailableCost["reason"]): UnavailableCost => {
  assert.equal(r.quoted, false); assert.equal((r as UnavailableCost).reason, reason); return r as UnavailableCost;
};
const findC = (cs: readonly ComponentQuote[], c: ComponentQuote["component"]): ComponentQuote => {
  for (const x of cs) if (x.component === c) return x; throw new Error(`missing ${c}`);
};
function assertClose(actual: number, expected: number, eps = 1e-12, msg = ""): void {
  assert.ok(Math.abs(actual - expected) < eps, `${msg}: |${actual} - ${expected}| >= ${eps}`);
}

const C = DEFAULT_CATALOG;
const DS_PRO = C[1]!, DS_FLASH = C[0]!, MM_USD = C[2]!, MM_USD_PRIO = C[3]!, MM_CNY = C[4]!, MM_CNY_PRIO = C[5]!;

// Live DeepSeek Pro sample ---------------------------------------------------

test("DeepSeek Pro live sample returns exact USD 0.069825939", () => {
  const r = asQuoted(calculateOfficialCost(DS_PRO, usage(51_105, 51_728, 715_008, 0)));
  assert.equal(r.currency, "USD");
  assert.equal(r.total, 0.069825939);
  assert.equal(r.providerBillClaim, false);
  assert.equal(r.usageSource, "terminal-result");
  assert.equal(findC(r.components, "input").amount, 0.022230675);
  assert.equal(findC(r.components, "output").amount, 0.04500336);
  assert.equal(findC(r.components, "cacheRead").amount, 0.002591904);
  assert.equal(findC(r.components, "cacheCreation").amount, 0);
  assert.equal(r.components.reduce((s, c) => s + c.amount, 0), r.total);
  assert.equal(r.appliedTier.applied[0]!.minimumInputTokensExclusive, null);
  assert.equal(r.appliedTier.totalPromptInput, 51_105 + 715_008);
  assert.equal(findC(r.components, "input").ratePerMillion, 0.435);
  assert.equal(findC(r.components, "output").ratePerMillion, 0.87);
  assert.equal(findC(r.components, "cacheRead").ratePerMillion, 0.003625);
  assert.equal(findC(r.components, "cacheCreation").ratePerMillion, 0.435);
  assert.equal(r.pricing.source.url, "https://api-docs.deepseek.com/quick_start/pricing/");
  assert.equal(r.pricing.source.checkedAt, "2026-07-26");
  assert.deepEqual(r.pricing.modelAliases, ["deepseek-v4-pro", "deepseek-v4-pro[1M]"]);
});

// DeepSeek positive cache creation -------------------------------------------

test("DeepSeek positive cache-creation uses the published rate", () => {
  const r = asQuoted(calculateOfficialCost(DS_PRO, usage(51_105, 51_728, 715_008, 10)));
  assert.equal(findC(r.components, "cacheCreation").amount, 0.00000435);
  assert.equal(r.total, 0.069825939 + 0.00000435);
});

test("DeepSeek Flash uses its own published rates", () => {
  const r = asQuoted(calculateOfficialCost(DS_FLASH, usage(1_000_000, 500_000, 0, 0)));
  assert.equal(r.total, 0.28);
  assert.equal(findC(r.components, "input").ratePerMillion, 0.14);
  assert.equal(findC(r.components, "output").ratePerMillion, 0.28);
});

// MiniMax 512K boundary — USD ------------------------------------------------

test("MiniMax USD: 512,000 stays in base tier, 512,001 uses higher tier", () => {
  const rows: RequestTokenUsage[] = [row(512_000, 0, 0, 0), row(512_001, 0, 0, 0)];
  const r = asQuoted(calculateOfficialCost(MM_USD, usage(512_000 + 512_001, 0, 0, 0), rows));
  assert.equal(r.currency, "USD");
  assert.equal(r.appliedTier.applied[0]!.minimumInputTokensExclusive, null);
  assert.equal(r.appliedTier.applied[0]!.totalPromptInput, 512_000);
  assert.equal(r.appliedTier.applied[1]!.minimumInputTokensExclusive, 512_000);
  assert.equal(r.appliedTier.applied[1]!.totalPromptInput, 512_001);
  assert.equal(findC(r.components, "input").amount, 0.4608006);
  assert.equal(r.total, 0.4608006);
  assert.equal(findC(r.components, "input").ratePerMillion, null);
});

test("MiniMax USD priority boundaries select base and higher correctly", () => {
  const rows: RequestTokenUsage[] = [row(400_000, 100_000, 0, 0), row(600_000, 200_000, 0, 0)];
  const r = asQuoted(calculateOfficialCost(MM_USD_PRIO, usage(1_000_000, 300_000, 0, 0), rows));
  assert.equal(r.currency, "USD");
  assertClose(findC(r.components, "input").amount, 0.72);
  assertClose(findC(r.components, "output").amount, 0.9);
  assertClose(r.total, 1.62);
  assert.equal(r.appliedTier.applied[0]!.minimumInputTokensExclusive, null);
  assert.equal(r.appliedTier.applied[1]!.minimumInputTokensExclusive, 512_000);
});

// MiniMax 512K boundary — CNY ------------------------------------------------

test("MiniMax CNY: 512,000 stays in base tier, 512,001 uses higher tier", () => {
  const rows: RequestTokenUsage[] = [row(512_000, 0, 0, 0), row(512_001, 0, 0, 0)];
  const r = asQuoted(calculateOfficialCost(MM_CNY, usage(512_000 + 512_001, 0, 0, 0), rows));
  assert.equal(r.currency, "CNY");
  assert.equal(r.appliedTier.applied[0]!.minimumInputTokensExclusive, null);
  assert.equal(r.appliedTier.applied[1]!.minimumInputTokensExclusive, 512_000);
  assertClose(findC(r.components, "input").amount, 3.2256042);
  assertClose(r.total, 3.2256042);
});

test("MiniMax CNY priority boundaries select base and higher correctly", () => {
  const rows: RequestTokenUsage[] = [row(300_000, 100_000, 0, 0), row(700_000, 100_000, 0, 0)];
  const r = asQuoted(calculateOfficialCost(MM_CNY_PRIO, usage(1_000_000, 200_000, 0, 0), rows));
  assert.equal(r.currency, "CNY");
  assertClose(findC(r.components, "input").amount, 5.355);
  assertClose(findC(r.components, "output").amount, 3.78);
  assertClose(r.total, 9.135);
});

// Missing request evidence ----------------------------------------------------

test("MiniMax non-zero aggregate without rows returns per-request-usage-required", () => {
  const r = asUnavail(calculateOfficialCost(MM_USD, usage(100, 50, 20, 10)), "per-request-usage-required");
  assert.deepEqual(r.evidence.expectedAggregate, { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 20, cacheCreationInputTokens: 10 });
  assert.equal(r.evidence.observedAggregate, null);
  assert.equal(r.evidence.tiersAvailable, 2);
  assert.equal(r.evidence.components.length, 4);
  for (const c of r.evidence.components) assert.equal(c.ratePerMillion, null);
});

test("MiniMax non-zero aggregate with null rows also returns per-request-usage-required", () => {
  const r = asUnavail(calculateOfficialCost(MM_USD, usage(100, 50, 20, 10),
    null as unknown as readonly RequestTokenUsage[]), "per-request-usage-required");
  assert.equal(r.evidence.observedAggregate, null);
});

// Reconciliation failure ------------------------------------------------------

type CounterKey = "inputTokens" | "outputTokens" | "cacheReadInputTokens" | "cacheCreationInputTokens";

test("reconciliation fails when any Token component drifts by one", () => {
  const base: Record<CounterKey, number> = { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 20, cacheCreationInputTokens: 10 };
  const drifts: Array<{ field: CounterKey; off: number }> = [
    { field: "inputTokens", off: 1 },
    { field: "outputTokens", off: 1 },
    { field: "cacheReadInputTokens", off: 1 },
    { field: "cacheCreationInputTokens", off: 1 },
  ];
  for (const { field, off } of drifts) {
    const u: AttemptTokenUsage = {
      inputTokens: field === "inputTokens" ? base[field] + off : base.inputTokens,
      outputTokens: field === "outputTokens" ? base[field] + off : base.outputTokens,
      cacheReadInputTokens: field === "cacheReadInputTokens" ? base[field] + off : base.cacheReadInputTokens,
      cacheCreationInputTokens: field === "cacheCreationInputTokens" ? base[field] + off : base.cacheCreationInputTokens,
      source: "terminal-result",
      complete: true,
    };
    const r = asUnavail(calculateOfficialCost(MM_USD, u, [row(100, 50, 20, 10)]), "usage-reconciliation-failed");
    assert.equal(r.evidence.expectedAggregate?.[field], base[field] + off);
    assert.equal(r.evidence.observedAggregate?.[field], base[field]);
  }
});

// Unpublished positive component ---------------------------------------------

test("MiniMax positive cache-creation in base tier returns rate-unpublished", () => {
  const r = asUnavail(calculateOfficialCost(MM_USD, usage(100, 50, 20, 30), [row(100, 50, 20, 30)]), "rate-unpublished");
  assert.deepEqual(r.evidence.positiveNullRateComponents, ["cacheCreation"]);
  const cc = r.evidence.components.find(c => c.component === "cacheCreation")!;
  assert.equal(cc.tokens, 30); assert.equal(cc.ratePerMillion, null);
});

test("MiniMax positive cache-creation in higher tier also returns rate-unpublished", () => {
  const r = asUnavail(calculateOfficialCost(MM_USD, usage(600_000, 0, 0, 5), [row(600_000, 0, 0, 5)]), "rate-unpublished");
  assert.ok(r.evidence.positiveNullRateComponents.includes("cacheCreation"));
});

test("MiniMax zero cache-creation in null-rate tier quotes normally", () => {
  const r = asQuoted(calculateOfficialCost(MM_USD, usage(100, 50, 20, 0), [row(100, 50, 20, 0)]));
  assert.equal(r.total, (100 * 0.30 + 50 * 1.20 + 20 * 0.06) / 1_000_000);
});

// Invalid counters -----------------------------------------------------------

test("negative Token counters return invalid-usage", () => {
  for (const bad of [usage(-1, 0, 0, 0), usage(0, -1, 0, 0), usage(0, 0, -1, 0), usage(0, 0, 0, -1)])
    asUnavail(calculateOfficialCost(MM_USD, bad), "invalid-usage");
});

test("non-integer / NaN Token counters return invalid-usage", () => {
  const bad1 = { ...usage(1.5, 0, 0, 0) } as unknown as AttemptTokenUsage;
  const bad2 = { ...usage(NaN, 0, 0, 0) } as unknown as AttemptTokenUsage;
  asUnavail(calculateOfficialCost(MM_USD, bad1), "invalid-usage");
  asUnavail(calculateOfficialCost(MM_USD, bad2), "invalid-usage");
});

test("usage missing source / complete / null returns invalid-usage", () => {
  const noSrc = { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, complete: true } as unknown as AttemptTokenUsage;
  const notComplete = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, source: "terminal-result", complete: false } as unknown as AttemptTokenUsage;
  asUnavail(calculateOfficialCost(MM_USD, noSrc), "invalid-usage");
  asUnavail(calculateOfficialCost(MM_USD, notComplete), "invalid-usage");
  asUnavail(calculateOfficialCost(MM_USD, null as unknown as AttemptTokenUsage), "invalid-usage");
});

test("row with invalid counter returns invalid-usage", () => {
  asUnavail(calculateOfficialCost(MM_USD, usage(100, 50, -1, 0), [row(100, 50, -1, 0)]), "invalid-usage");
  const badRows = [row(100, 50, 0.5, 0)] as unknown as readonly RequestTokenUsage[];
  asUnavail(calculateOfficialCost(MM_USD, usage(100, 50, 0.5, 0), badRows), "invalid-usage");
});

// Zero usage ------------------------------------------------------------------

test("zero usage on single-tier quotes with total 0", () => {
  const r = asQuoted(calculateOfficialCost(DS_PRO, usage(0, 0, 0, 0)));
  assert.equal(r.total, 0);
  for (const c of r.components) { assert.equal(c.tokens, 0); assert.equal(c.amount, 0); }
  assert.equal(r.appliedTier.totalPromptInput, 0);
});

test("zero usage on multi-tier quotes without rows", () => {
  const r = asQuoted(calculateOfficialCost(MM_USD, usage(0, 0, 0, 0)));
  assert.equal(r.total, 0);
  assert.equal(r.appliedTier.applied.length, 1);
  assert.equal(r.appliedTier.applied[0]!.minimumInputTokensExclusive, null);
});

// Immutability ----------------------------------------------------------------

test("quoted result is deeply frozen and detached from entry", () => {
  const r = calculateOfficialCost(DS_PRO, usage(51_105, 51_728, 715_008, 0)) as QuotedCost;
  assertDeepFrozen(r);
  assert.notStrictEqual(r.pricing.modelAliases, DS_PRO.modelAliases);
  assert.notStrictEqual(r.pricing.source, DS_PRO.source);
  assert.throws(() => { (r as { currency: string }).currency = "CNY"; }, TypeError);
});

test("unavailable result is deeply frozen", () => {
  assertDeepFrozen(calculateOfficialCost(MM_USD, usage(100, 50, 20, 10)));
});

test("inputs remain unfrozen and unchanged after calculation", () => {
  const entry: PricingCatalogEntry = { ...DS_PRO };
  const u = usage(51_105, 51_728, 715_008, 0);
  const rows: RequestTokenUsage[] = [row(51_105, 51_728, 715_008, 0)];
  const entryBefore = structuredClone(entry);
  const usageBefore = structuredClone(u);
  const rowsBefore = structuredClone(rows);
  calculateOfficialCost(entry, u, rows);
  assert.equal(Object.isFrozen(entry), false);
  assert.equal(Object.isFrozen(u), false);
  assert.equal(Object.isFrozen(rows), false);
  assert.equal(Object.isFrozen(rows[0]!), false);
  assert.deepEqual(entry, entryBefore);
  assert.deepEqual(u, usageBefore);
  assert.deepEqual(rows, rowsBefore);
});

// No FX or provider-bill claim ------------------------------------------------

test("CNY result preserves native currency and never claims a USD value", () => {
  // 500_000 prompt Tokens fits in the <=512K base tier so the published
  // 2.10 CNY/M rate applies and the quoted amount must be a native CNY value.
  const r = asQuoted(calculateOfficialCost(MM_CNY, usage(500_000, 0, 0, 0), [row(500_000, 0, 0, 0)]));
  assert.equal(r.currency, "CNY");
  assert.equal(r.pricing.currency, "CNY");
  assert.equal(r.providerBillClaim, false);
  assertClose(findC(r.components, "input").amount, 1.05);
});

test("every quoted result explicitly sets providerBillClaim to false", () => {
  for (const entry of [DS_FLASH, DS_PRO, MM_USD, MM_USD_PRIO, MM_CNY, MM_CNY_PRIO])
    assert.equal((calculateOfficialCost(entry, usage(0, 0, 0, 0)) as QuotedCost).providerBillClaim, false);
});

// Invalid pricing entry -------------------------------------------------------

test("entry with empty / invalid rates or unknown currency returns invalid-pricing-entry", () => {
  asUnavail(calculateOfficialCost({ ...DS_PRO, rates: [] }, usage(1, 0, 0, 0)), "invalid-pricing-entry");
  const negRate: PricingCatalogEntry = { ...DS_PRO,
    rates: [{ minimumInputTokensExclusive: null, input: -0.1, output: 0.87, cacheRead: 0.003625, cacheCreation: 0.435 }] };
  asUnavail(calculateOfficialCost(negRate, usage(1, 0, 0, 0)), "invalid-pricing-entry");
  asUnavail(calculateOfficialCost({ ...DS_PRO, currency: "EUR" } as unknown as PricingCatalogEntry, usage(1, 0, 0, 0)), "invalid-pricing-entry");
  asUnavail(calculateOfficialCost({ ...DS_PRO, source: undefined } as unknown as PricingCatalogEntry, usage(1, 0, 0, 0)), "invalid-pricing-entry");
  asUnavail(calculateOfficialCost(null as unknown as PricingCatalogEntry, usage(1, 0, 0, 0)), "invalid-pricing-entry");
});

// Source evidence preservation ------------------------------------------------

test("MiniMax USD/CNY quotes carry the official source evidence unchanged", () => {
  const usd = asQuoted(calculateOfficialCost(MM_USD, usage(0, 0, 0, 0)));
  assert.equal(usd.pricing.source.url, "https://platform.minimax.io/docs/guides/pricing-paygo");
  assert.equal(usd.pricing.source.checkedAt, "2026-07-26");
  assert.equal(usd.pricing.promotion, "Permanent 50% off (effective rate shown)");
  assert.equal(usd.pricing.provider, "minimax");
  assert.equal(usd.pricing.origin, "https://api.minimax.io");
  assert.equal(usd.pricing.route, "minimax-international-direct-payg");
  const cny = asQuoted(calculateOfficialCost(MM_CNY, usage(0, 0, 0, 0)));
  assert.equal(cny.pricing.source.url, "https://platform.minimaxi.com/docs/guides/pricing-paygo");
  assert.equal(cny.pricing.origin, "https://api.minimaxi.com");
  assert.equal(cny.pricing.route, "minimax-china-direct-payg");
});

// Tier boundary edge ---------------------------------------------------------

test("MiniMax prompt input 511,999 stays in base tier", () => {
  const r = asQuoted(calculateOfficialCost(MM_USD, usage(511_999, 0, 0, 0), [row(511_999, 0, 0, 0)]));
  assert.equal(r.appliedTier.applied[0]!.minimumInputTokensExclusive, null);
  assert.equal(findC(r.components, "input").amount, (511_999 * 0.30) / 1_000_000);
});

// Defensive rate-tier-unavailable --------------------------------------------

test("custom single-tier entry with no base tier returns rate-tier-unavailable", () => {
  // Single-tier entry whose sole tier has a numeric (non-null) threshold and
  // the aggregate prompt input is below it — the calculator must NOT silently
  // apply the rate.  Built-in DeepSeek entries (null threshold) stay quotable.
  const noBase: PricingCatalogEntry = {
    provider: "minimax", origin: "https://api.minimax.io", route: "minimax-international-direct-payg",
    modelAliases: ["MiniMax-M3"], serviceTier: "standard", currency: "USD", unitTokens: 1_000_000,
    rates: [{ minimumInputTokensExclusive: 100, input: 0.60, output: 2.40, cacheRead: 0.12, cacheCreation: null }],
    source: { url: "https://example.com/pricing", checkedAt: "2026-07-23" }, promotion: null,
  };
  const r = asUnavail(calculateOfficialCost(noBase, usage(50, 0, 0, 0), [row(50, 0, 0, 0)]), "rate-tier-unavailable");
  assert.equal(r.evidence.tiersAvailable, 1);
});

// --- Bounded estimates (aggregate-tier-bounds) --------------------------------

test("MiniMax USD multi-tier non-zero aggregate without rows yields bounded estimate", () => {
  const r = asUnavail(calculateOfficialCost(MM_USD, usage(100_000, 50_000, 20_000, 0)), "per-request-usage-required");
  const be = r.boundedEstimate;
  assert.ok(be !== undefined, "bounded estimate should be present");
  assert.equal(be!.currency, "USD");
  assert.equal(be!.method, "aggregate-tier-bounds");
  assert.equal(be!.usageSource, "terminal-result");
  assert.equal(be!.providerBillClaim, false);
  assert.ok(be!.min > 0, "min should be positive");
  assert.ok(be!.max > 0, "max should be positive");
  assert.ok(be!.min <= be!.max, "min <= max");
  // Verify components
  const inputC = be!.components.find(c => c.component === "input")!;
  assert.equal(inputC.tokens, 100_000);
  assert.ok(inputC.minAmount > 0);
  assert.ok(inputC.maxAmount > 0);
  assert.ok(inputC.minAmount <= inputC.maxAmount);
});

test("MiniMax CNY multi-tier non-zero aggregate without rows yields CNY bounded estimate", () => {
  const r = asUnavail(calculateOfficialCost(MM_CNY, usage(500_000, 100_000, 0, 0)), "per-request-usage-required");
  const be = r.boundedEstimate;
  assert.ok(be !== undefined, "bounded estimate should be present");
  assert.equal(be!.currency, "CNY");
  assert.ok(be!.min > 0);
  assert.ok(be!.max > 0);
  assert.ok(be!.min <= be!.max);
  // Verify pricing identity
  assert.equal(be!.pricing.route, "minimax-china-direct-payg");
  assert.equal(be!.pricing.origin, "https://api.minimaxi.com");
});

test("bounded estimate min/max use correct rate bounds across tiers", () => {
  // MM_USD: tier0 input=0.30, tier1 input=0.60
  // For 1M input tokens: min = 1M * 0.30 / 1M = 0.30, max = 1M * 0.60 / 1M = 0.60
  const r = asUnavail(calculateOfficialCost(MM_USD, usage(1_000_000, 0, 0, 0)), "per-request-usage-required");
  const be = r.boundedEstimate!;
  const inputC = be.components.find(c => c.component === "input")!;
  assertClose(inputC.minRatePerMillion!, 0.30);
  assertClose(inputC.maxRatePerMillion!, 0.60);
  assertClose(inputC.minAmount, 0.30);
  assertClose(inputC.maxAmount, 0.60);
  // For output: tier0 output=1.20, tier1 output=2.40
  const r2 = asUnavail(calculateOfficialCost(MM_USD, usage(600_000, 1_000_000, 0, 0)), "per-request-usage-required");
  const be2 = r2.boundedEstimate!;
  const outputC = be2.components.find(c => c.component === "output")!;
  assertClose(outputC.minRatePerMillion!, 1.20);
  assertClose(outputC.maxRatePerMillion!, 2.40);
  assertClose(outputC.minAmount, 1.20);
  assertClose(outputC.maxAmount, 2.40);
});

test("bounded estimate for positive cache-read component with published rates", () => {
  // MM_USD: cacheRead tier0=0.06, tier1=0.12
  const r = asUnavail(calculateOfficialCost(MM_USD, usage(0, 0, 1_000_000, 0)), "per-request-usage-required");
  const be = r.boundedEstimate!;
  const crC = be.components.find(c => c.component === "cacheRead")!;
  assertClose(crC.minRatePerMillion!, 0.06);
  assertClose(crC.maxRatePerMillion!, 0.12);
  assertClose(crC.minAmount, 0.06);
  assertClose(crC.maxAmount, 0.12);
});

test("no bounded estimate for positive cache-creation component (unpublished)", () => {
  // MM_USD: cacheCreation is null in all tiers
  // So any non-zero cache-creation must block the range
  const r = asUnavail(calculateOfficialCost(MM_USD, usage(100_000, 50_000, 20_000, 1)), "per-request-usage-required");
  assert.equal(r.boundedEstimate, undefined, "bounded estimate must be absent when cache-creation>0 & unpublished");
});

test("no bounded estimate when cache-creation is zero but all tiers have null cache-creation", () => {
  // MM_USD: cacheCreation is null, but cacheCreation tokens are 0 → should produce range
  const r = asUnavail(calculateOfficialCost(MM_USD, usage(100, 50, 20, 0)), "per-request-usage-required");
  assert.ok(r.boundedEstimate !== undefined, "with zero cache-creation, range should be produced");
});

test("single-tier entry does not produce bounded estimate", () => {
  const r = asQuoted(calculateOfficialCost(DS_PRO, usage(100, 50, 20, 0)));
  assert.equal("boundedEstimate" in r, false);
});

test("aggregate prompt below the first threshold cannot use the higher tier", () => {
  const r = asUnavail(
    calculateOfficialCost(MM_USD, usage(100_000, 50_000, 20_000, 0)),
    "per-request-usage-required",
  );
  const be = r.boundedEstimate!;
  assert.equal(be.min, be.max);
  const input = be.components.find(c => c.component === "input")!;
  assertClose(input.minRatePerMillion!, 0.30);
  assertClose(input.maxRatePerMillion!, 0.30);
  const cacheCreation = be.components.find(c => c.component === "cacheCreation")!;
  assert.equal(cacheCreation.minRatePerMillion, null);
  assert.equal(cacheCreation.maxRatePerMillion, null);
  assert.equal(cacheCreation.minAmount, 0);
  assert.equal(cacheCreation.maxAmount, 0);
});

test("zero aggregate on multi-tier quotes without bounded estimate (quoted with total 0)", () => {
  const r = calculateOfficialCost(MM_USD, usage(0, 0, 0, 0));
  assert.equal(r.quoted, true);
  const q = r as QuotedCost;
  assert.equal(q.total, 0);
});

test("multi-tier with reconciled rows does not produce bounded estimate", () => {
  const r = asQuoted(calculateOfficialCost(MM_USD, usage(512_000 + 512_001, 0, 0, 0),
    [row(512_000, 0, 0, 0), row(512_001, 0, 0, 0)]));
  assert.equal(r.quoted, true);
});

test("bounded estimate is deeply frozen", () => {
  const r = asUnavail(calculateOfficialCost(MM_USD, usage(100_000, 50_000, 0, 0)), "per-request-usage-required");
  const be = r.boundedEstimate!;
  assertDeepFrozen(be);
  assertDeepFrozen(be.components);
  assertDeepFrozen(be.pricing);
  assert.throws(() => { (be as { min: number }).min = 0; }, TypeError);
  assert.throws(() => { (be as { method: string }).method = "x"; }, TypeError);
});

test("bounded estimate preserves providerBillClaim false", () => {
  const r = asUnavail(calculateOfficialCost(MM_CNY, usage(500_000, 100_000, 0, 0)), "per-request-usage-required");
  assert.equal(r.boundedEstimate!.providerBillClaim, false);
});

test("bounded estimate totals are sum of component bounds", () => {
  const r = asUnavail(calculateOfficialCost(MM_USD, usage(100_000, 50_000, 20_000, 0)), "per-request-usage-required");
  const be = r.boundedEstimate!;
  const compMinSum = be.components.reduce((s, c) => s + c.minAmount, 0);
  const compMaxSum = be.components.reduce((s, c) => s + c.maxAmount, 0);
  assertClose(be.min, compMinSum);
  assertClose(be.max, compMaxSum);
});

// --- Unpublished components across tiers block range --------------------------

test("bounded estimate absent when any tier lacks a rate for a positive component", () => {
  // Create an entry with unpublished cache-creation in one tier but published in another
  // This simulates a theoretical bug scenario — blocks the range
  const entry: PricingCatalogEntry = {
    provider: "minimax", origin: "https://api.minimax.io", route: "test-route",
    modelAliases: ["TestModel"], serviceTier: "standard", currency: "USD", unitTokens: 1_000_000,
    rates: [
      { minimumInputTokensExclusive: null, input: 0.30, output: 1.20, cacheRead: 0.06, cacheCreation: null },
      { minimumInputTokensExclusive: 512_000, input: 0.60, output: 2.40, cacheRead: 0.12, cacheCreation: 0.15 },
    ],
    source: { url: "https://example.com", checkedAt: "2026-07-23" }, promotion: null,
  };
  // cacheCreation > 0 but one tier has null → should produce no range
  const r = asUnavail(calculateOfficialCost(entry, usage(100_000, 50_000, 20_000, 1)), "per-request-usage-required");
  assert.equal(r.boundedEstimate, undefined);
});

test("no bounded estimate when input tokens are zero in all components", () => {
  // Even with multi-tier, zero aggregate should quote directly, not produce bounded
  const r = calculateOfficialCost(MM_USD, usage(0, 0, 0, 0));
  assert.equal(r.quoted, true);
});
