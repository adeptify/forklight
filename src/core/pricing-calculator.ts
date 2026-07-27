// Official-rate calculator — converts complete terminal Worker Token usage plus
// reconciled per-request rows into an immutable native-currency component
// quote, or a precise unavailable result when the supplied evidence cannot
// support a truthful estimate.  No route resolution, no FX, no Provider bill
// claim, no invented rate.

import type { AttemptTokenUsage } from "./types.js";
import type {
  PricingCatalogEntry,
  PricingCurrency,
  PricingRateTier,
  PricingSourceEvidence,
} from "./pricing.js";

// Public types ----------------------------------------------------------------

/** Per-request Token counters — non-negative integers; total prompt input is
 * `inputTokens + cacheReadInputTokens + cacheCreationInputTokens` for tier
 * selection. */
export interface RequestTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
}

export type CostComponent = "input" | "output" | "cacheRead" | "cacheCreation";

const COST_COMPONENTS: readonly CostComponent[] = ["input", "output", "cacheRead", "cacheCreation"];

export interface ComponentQuote {
  readonly component: CostComponent;
  readonly tokens: number;
  /** Published rate per `unitTokens`; null when the rate varies per row. */
  readonly ratePerMillion: number | null;
  readonly amount: number;
}

export interface AppliedTierEntry {
  readonly minimumInputTokensExclusive: number | null;
  readonly totalPromptInput: number;
}

export interface AppliedTierEvidence {
  readonly applied: readonly AppliedTierEntry[];
  readonly totalPromptInput: number;
}

export interface PricingIdentitySnapshot {
  readonly provider: string;
  readonly origin: string;
  readonly route: string;
  readonly modelAliases: readonly string[];
  readonly serviceTier: string;
  readonly currency: PricingCurrency;
  readonly unitTokens: number;
  readonly source: PricingSourceEvidence;
  readonly promotion: string | null;
}

export interface UnavailableComponentEvidence {
  readonly component: CostComponent;
  readonly tokens: number;
  readonly ratePerMillion: number | null;
}

export interface TokenAggregate {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
}

export interface UnavailableEvidence {
  readonly provider: string;
  readonly currency: PricingCurrency | null;
  readonly tiersAvailable: number;
  readonly components: readonly UnavailableComponentEvidence[];
  readonly expectedAggregate: TokenAggregate | null;
  readonly observedAggregate: TokenAggregate | null;
  readonly positiveNullRateComponents: readonly CostComponent[];
}

export type PricingQuoteUnavailableReason =
  | "invalid-usage"
  | "per-request-usage-required"
  | "usage-reconciliation-failed"
  | "invalid-pricing-entry"
  | "rate-tier-unavailable"
  | "rate-unpublished";

export interface QuotedCost {
  readonly quoted: true;
  readonly currency: PricingCurrency;
  readonly total: number;
  readonly components: readonly ComponentQuote[];
  readonly pricing: PricingIdentitySnapshot;
  readonly appliedTier: AppliedTierEvidence;
  readonly usageSource: "terminal-result";
  readonly providerBillClaim: false;
}

export interface BoundedComponentRange {
  readonly component: CostComponent;
  readonly tokens: number;
  /** `null` means the rate is unpublished but irrelevant because tokens are zero. */
  readonly minRatePerMillion: number | null;
  readonly maxRatePerMillion: number | null;
  readonly minAmount: number;
  readonly maxAmount: number;
}

export interface BoundedEstimate {
  readonly currency: PricingCurrency;
  readonly min: number;
  readonly max: number;
  readonly components: readonly BoundedComponentRange[];
  readonly pricing: PricingIdentitySnapshot;
  readonly method: "aggregate-tier-bounds";
  readonly usageSource: "terminal-result";
  readonly providerBillClaim: false;
}

export interface UnavailableCost {
  readonly quoted: false;
  readonly reason: PricingQuoteUnavailableReason;
  readonly evidence: UnavailableEvidence;
  /** Conservative native-currency range from aggregate-tier rate bounds.
   *  Present only when the reason is per-request-usage-required, the catalog
   *  entry is multi-tier, aggregate is non-zero, and every positive Token
   *  component has a published rate in every possible tier. */
  readonly boundedEstimate?: BoundedEstimate;
}

export type PricingQuote = QuotedCost | UnavailableCost;

// Immutability helpers --------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (item !== null && typeof item === "object") deepFreeze(item);
    }
  } else {
    for (const v of Object.values(value)) {
      if (v !== null && typeof v === "object") deepFreeze(v);
    }
  }
  Object.freeze(value);
  return value;
}

function cloneAndFreeze<T>(value: T): T { return deepFreeze(structuredClone(value)); }

// Validation ------------------------------------------------------------------

function isNNInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

function isNNNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

function validateUsage(u: unknown): u is AttemptTokenUsage {
  if (u === null || typeof u !== "object") return false;
  const o = u as AttemptTokenUsage;
  return o.source === "terminal-result" && o.complete === true
    && isNNInt(o.inputTokens) && isNNInt(o.outputTokens)
    && isNNInt(o.cacheReadInputTokens) && isNNInt(o.cacheCreationInputTokens);
}

function validateRows(rows: readonly unknown[]): rows is readonly RequestTokenUsage[] {
  for (const r of rows) {
    if (r === null || typeof r !== "object") return false;
    const o = r as RequestTokenUsage;
    if (!isNNInt(o.inputTokens) || !isNNInt(o.outputTokens)
      || !isNNInt(o.cacheReadInputTokens) || !isNNInt(o.cacheCreationInputTokens)) return false;
  }
  return true;
}

function validateEntry(e: unknown): e is PricingCatalogEntry {
  if (e === null || typeof e !== "object") return false;
  const o = e as PricingCatalogEntry;
  if (typeof o.provider !== "string" || o.provider.length === 0) return false;
  if (typeof o.origin !== "string" || typeof o.route !== "string") return false;
  if (typeof o.serviceTier !== "string") return false;
  if (o.currency !== "USD" && o.currency !== "CNY") return false;
  if (!isNNNum(o.unitTokens) || o.unitTokens <= 0) return false;
  if (!Array.isArray(o.modelAliases) || !Array.isArray(o.rates) || o.rates.length === 0) return false;
  for (const a of o.modelAliases) if (typeof a !== "string") return false;
  if (o.source === null || typeof o.source !== "object") return false;
  if (typeof o.source.url !== "string" || typeof o.source.checkedAt !== "string") return false;
  for (const t of o.rates) {
    if (t === null || typeof t !== "object") return false;
    if (t.minimumInputTokensExclusive !== null && !isNNInt(t.minimumInputTokensExclusive)) return false;
    if (!isNNNum(t.input) || !isNNNum(t.output) || !isNNNum(t.cacheRead)) return false;
    if (t.cacheCreation !== null && !isNNNum(t.cacheCreation)) return false;
  }
  return true;
}

// Aggregation -----------------------------------------------------------------

function aggregateFromUsage(u: AttemptTokenUsage): TokenAggregate {
  return { inputTokens: u.inputTokens, outputTokens: u.outputTokens,
    cacheReadInputTokens: u.cacheReadInputTokens, cacheCreationInputTokens: u.cacheCreationInputTokens };
}

function aggregateFromRows(rows: readonly RequestTokenUsage[]): TokenAggregate {
  let i = 0, o = 0, cr = 0, cc = 0;
  for (const r of rows) { i += r.inputTokens; o += r.outputTokens; cr += r.cacheReadInputTokens; cc += r.cacheCreationInputTokens; }
  return { inputTokens: i, outputTokens: o, cacheReadInputTokens: cr, cacheCreationInputTokens: cc };
}

const aggZero = (a: TokenAggregate): boolean =>
  a.inputTokens === 0 && a.outputTokens === 0 && a.cacheReadInputTokens === 0 && a.cacheCreationInputTokens === 0;

// Tier selection --------------------------------------------------------------

/** Selects the highest eligible tier for a request.  The base tier (threshold
 * null) is used only when no higher numeric tier matches. */
function selectTier(rates: readonly PricingRateTier[], promptInput: number): PricingRateTier | null {
  let best: PricingRateTier | null = null;
  let bestThreshold = -1;
  for (const t of rates) {
    if (t.minimumInputTokensExclusive === null) { if (best === null) best = t; continue; }
    if (t.minimumInputTokensExclusive < promptInput && t.minimumInputTokensExclusive > bestThreshold) {
      best = t; bestThreshold = t.minimumInputTokensExclusive;
    }
  }
  return best;
}


// Component calculation -------------------------------------------------------

interface ComponentAccumulation {
  readonly components: readonly ComponentQuote[];
  readonly positiveNull: readonly CostComponent[];
  readonly total: number;
}

function computeForTier(t: PricingRateTier, unit: number, inT: number, outT: number, crT: number, ccT: number): ComponentAccumulation {
  const items: { c: CostComponent; tokens: number; rate: number | null }[] = [
    { c: "input", tokens: inT, rate: t.input },
    { c: "output", tokens: outT, rate: t.output },
    { c: "cacheRead", tokens: crT, rate: t.cacheRead },
    { c: "cacheCreation", tokens: ccT, rate: t.cacheCreation },
  ];
  const comps: ComponentQuote[] = [];
  const pNull: CostComponent[] = [];
  let total = 0;
  for (const it of items) {
    const amount = it.rate === null ? 0 : (it.tokens * it.rate) / unit;
    if (it.rate !== null) total += amount;
    else if (it.tokens > 0) pNull.push(it.c);
    comps.push({ component: it.c, tokens: it.tokens, ratePerMillion: it.rate, amount });
  }
  return { components: comps, positiveNull: pNull, total };
}

// Result builders -------------------------------------------------------------

function emptyEv(provider: string, currency: PricingCurrency | null, tiers: number): UnavailableEvidence {
  return { provider, currency, tiersAvailable: tiers, components: [],
    expectedAggregate: null, observedAggregate: null, positiveNullRateComponents: [] };
}

function aggComponent(c: CostComponent, a: TokenAggregate): UnavailableComponentEvidence {
  switch (c) {
    case "input": return { component: c, tokens: a.inputTokens, ratePerMillion: null };
    case "output": return { component: c, tokens: a.outputTokens, ratePerMillion: null };
    case "cacheRead": return { component: c, tokens: a.cacheReadInputTokens, ratePerMillion: null };
    case "cacheCreation": return { component: c, tokens: a.cacheCreationInputTokens, ratePerMillion: null };
  }
}

function pricingIdentity(e: PricingCatalogEntry): PricingIdentitySnapshot {
  return { provider: e.provider, origin: e.origin, route: e.route,
    modelAliases: e.modelAliases.slice(), serviceTier: e.serviceTier, currency: e.currency,
    unitTokens: e.unitTokens, source: { url: e.source.url, checkedAt: e.source.checkedAt },
    promotion: e.promotion };
}

// Bounded estimate builder -----------------------------------------------------

/**
 * Build a conservative native-currency min/max range from the minimum and
 * maximum published rates across all catalog tiers.  Every positive Token
 * component must have a published rate in every tier; otherwise the range
 * is not produced.  The returned estimate is never a Provider bill claim.
 */
function buildBoundedEstimate(
  entry: PricingCatalogEntry,
  aggregate: TokenAggregate,
): BoundedEstimate | undefined {
  const tiers = entry.rates;
  // Must be multi-tier.
  if (tiers.length <= 1) return undefined;

  const aggregatePromptInput = aggregate.inputTokens
    + aggregate.cacheReadInputTokens
    + aggregate.cacheCreationInputTokens;
  const possibleTiers = tiers.filter((tier) =>
    tier.minimumInputTokensExclusive === null
      || tier.minimumInputTokensExclusive < aggregatePromptInput);
  if (possibleTiers.length === 0) return undefined;

  type CompKey = "input" | "output" | "cacheRead" | "cacheCreation";
  const agg: Record<CompKey, number> = {
    input: aggregate.inputTokens,
    output: aggregate.outputTokens,
    cacheRead: aggregate.cacheReadInputTokens,
    cacheCreation: aggregate.cacheCreationInputTokens,
  };

  // Collect rates per component across all tiers.
  const ratesPerComp: Record<CompKey, number[]> = {
    input: [],
    output: [],
    cacheRead: [],
    cacheCreation: [],
  };
  for (const t of possibleTiers) {
    ratesPerComp.input.push(t.input);
    ratesPerComp.output.push(t.output);
    ratesPerComp.cacheRead.push(t.cacheRead);
    if (t.cacheCreation !== null) {
      ratesPerComp.cacheCreation.push(t.cacheCreation);
    }
  }

  const components: BoundedComponentRange[] = [];
  let totalMin = 0, totalMax = 0;

  for (const compKey of ["input", "output", "cacheRead", "cacheCreation"] as CompKey[]) {
    const tokens = agg[compKey];
    if (tokens === 0) {
      const rates = ratesPerComp[compKey];
      const everyPossibleRatePublished = rates.length === possibleTiers.length;
      components.push({
        component: compKey,
        tokens: 0,
        minRatePerMillion: everyPossibleRatePublished ? Math.min(...rates) : null,
        maxRatePerMillion: everyPossibleRatePublished ? Math.max(...rates) : null,
        minAmount: 0,
        maxAmount: 0,
      });
      continue;
    }
    // Positive tokens — every tier must have a published rate for this component.
    const rates = ratesPerComp[compKey];
    if (rates.length < possibleTiers.length) return undefined;
    const minRate = Math.min(...rates);
    const maxRate = Math.max(...rates);
    if (minRate < 0 || maxRate < 0) return undefined;
    const minAmt = (tokens * minRate) / entry.unitTokens;
    const maxAmt = (tokens * maxRate) / entry.unitTokens;
    totalMin += minAmt;
    totalMax += maxAmt;
    components.push({
      component: compKey,
      tokens,
      minRatePerMillion: minRate,
      maxRatePerMillion: maxRate,
      minAmount: minAmt,
      maxAmount: maxAmt,
    });
  }

  return {
    currency: entry.currency,
    min: totalMin,
    max: totalMax,
    components,
    pricing: pricingIdentity(entry),
    method: "aggregate-tier-bounds",
    usageSource: "terminal-result",
    providerBillClaim: false,
  };
}

// Public API ------------------------------------------------------------------

export function calculateOfficialCost(
  entry: PricingCatalogEntry,
  usage: AttemptTokenUsage,
  requestRows?: readonly RequestTokenUsage[],
): PricingQuote {
  // 1. Validate the pricing entry.
  if (!validateEntry(entry)) {
    let provider = "", currency: PricingCurrency | null = null, tiersAvailable = 0;
    if (entry !== null && typeof entry === "object") {
      const e = entry as Partial<PricingCatalogEntry>;
      if (typeof e.provider === "string") provider = e.provider;
      if (e.currency === "USD" || e.currency === "CNY") currency = e.currency;
      if (Array.isArray(e.rates)) tiersAvailable = e.rates.length;
    }
    return cloneAndFreeze({ quoted: false, reason: "invalid-pricing-entry",
      evidence: emptyEv(provider, currency, tiersAvailable) });
  }

  // 2. Validate the terminal usage.
  if (!validateUsage(usage)) {
    return cloneAndFreeze({ quoted: false, reason: "invalid-usage",
      evidence: emptyEv(entry.provider, entry.currency, entry.rates.length) });
  }

  const aggregate = aggregateFromUsage(usage);
  const isMultiTier = entry.rates.length > 1;

  // 3. Single-tier — select the sole tier against the aggregate prompt input.
  const aggregatePromptInput = aggregate.inputTokens + aggregate.cacheReadInputTokens + aggregate.cacheCreationInputTokens;
  if (!isMultiTier) {
    const tier = selectTier(entry.rates, aggregatePromptInput);
    if (tier === null) {
      return cloneAndFreeze({ quoted: false, reason: "rate-tier-unavailable",
        evidence: { provider: entry.provider, currency: entry.currency, tiersAvailable: entry.rates.length,
          components: [], expectedAggregate: aggregate, observedAggregate: aggregate, positiveNullRateComponents: [] } });
    }
    const result = computeForTier(tier, entry.unitTokens,
      aggregate.inputTokens, aggregate.outputTokens, aggregate.cacheReadInputTokens, aggregate.cacheCreationInputTokens);
    if (result.positiveNull.length > 0) {
      return cloneAndFreeze({ quoted: false, reason: "rate-unpublished",
        evidence: { provider: entry.provider, currency: entry.currency, tiersAvailable: entry.rates.length,
          components: result.components.map(c => ({ component: c.component, tokens: c.tokens, ratePerMillion: c.ratePerMillion })),
          expectedAggregate: aggregate, observedAggregate: aggregate, positiveNullRateComponents: result.positiveNull } });
    }
    return cloneAndFreeze({ quoted: true, currency: entry.currency, total: result.total,
      components: result.components, pricing: pricingIdentity(entry),
      appliedTier: { applied: [{ minimumInputTokensExclusive: tier.minimumInputTokensExclusive, totalPromptInput: aggregatePromptInput }], totalPromptInput: aggregatePromptInput },
      usageSource: "terminal-result", providerBillClaim: false });
  }

  // 4. Multi-tier with zero aggregate — select an eligible tier; no rows required.
  if (aggZero(aggregate)) {
    const tier = selectTier(entry.rates, 0);
    if (tier === null) {
      return cloneAndFreeze({ quoted: false, reason: "rate-tier-unavailable",
        evidence: { provider: entry.provider, currency: entry.currency, tiersAvailable: entry.rates.length,
          components: [], expectedAggregate: aggregate, observedAggregate: aggregate, positiveNullRateComponents: [] } });
    }
    const result = computeForTier(tier, entry.unitTokens, 0, 0, 0, 0);
    return cloneAndFreeze({ quoted: true, currency: entry.currency, total: 0,
      components: result.components, pricing: pricingIdentity(entry),
      appliedTier: { applied: [{ minimumInputTokensExclusive: tier.minimumInputTokensExclusive, totalPromptInput: 0 }], totalPromptInput: 0 },
      usageSource: "terminal-result", providerBillClaim: false });
  }

  // 5. Multi-tier non-zero aggregate — per-request rows required.
  if (requestRows === undefined || requestRows === null) {
    const bounded = buildBoundedEstimate(entry, aggregate);
    return cloneAndFreeze({ quoted: false, reason: "per-request-usage-required",
      evidence: { provider: entry.provider, currency: entry.currency, tiersAvailable: entry.rates.length,
        components: COST_COMPONENTS.map(c => aggComponent(c, aggregate)),
        expectedAggregate: aggregate, observedAggregate: null, positiveNullRateComponents: [] },
      ...(bounded === undefined ? {} : { boundedEstimate: bounded }) });
  }

  // 6. Validate the supplied rows.
  if (!validateRows(requestRows)) {
    return cloneAndFreeze({ quoted: false, reason: "invalid-usage",
      evidence: emptyEv(entry.provider, entry.currency, entry.rates.length) });
  }

  // 7. Reconcile per-row sums vs terminal aggregate.
  const observed = aggregateFromRows(requestRows);
  if (observed.inputTokens !== aggregate.inputTokens || observed.outputTokens !== aggregate.outputTokens
    || observed.cacheReadInputTokens !== aggregate.cacheReadInputTokens
    || observed.cacheCreationInputTokens !== aggregate.cacheCreationInputTokens) {
    return cloneAndFreeze({ quoted: false, reason: "usage-reconciliation-failed",
      evidence: { provider: entry.provider, currency: entry.currency, tiersAvailable: entry.rates.length,
        components: [], expectedAggregate: aggregate, observedAggregate: observed, positiveNullRateComponents: [] } });
  }

  // 8. Per-row tier selection and accumulation.
  let tIn = 0, tOut = 0, tCr = 0, tCc = 0, aIn = 0, aOut = 0, aCr = 0, aCc = 0;
  const applied: AppliedTierEntry[] = [];
  const pNull: CostComponent[] = [];
  for (const r of requestRows) {
    const promptInput = r.inputTokens + r.cacheReadInputTokens + r.cacheCreationInputTokens;
    const tier = selectTier(entry.rates, promptInput);
    if (tier === null) {
      return cloneAndFreeze({ quoted: false, reason: "rate-tier-unavailable",
        evidence: { provider: entry.provider, currency: entry.currency, tiersAvailable: entry.rates.length,
          components: [], expectedAggregate: aggregate, observedAggregate: observed, positiveNullRateComponents: [] } });
    }
    const res = computeForTier(tier, entry.unitTokens, r.inputTokens, r.outputTokens, r.cacheReadInputTokens, r.cacheCreationInputTokens);
    tIn += r.inputTokens; tOut += r.outputTokens; tCr += r.cacheReadInputTokens; tCc += r.cacheCreationInputTokens;
    aIn += res.components[0]!.amount; aOut += res.components[1]!.amount; aCr += res.components[2]!.amount; aCc += res.components[3]!.amount;
    applied.push({ minimumInputTokensExclusive: tier.minimumInputTokensExclusive, totalPromptInput: promptInput });
    for (const nc of res.positiveNull) if (!pNull.includes(nc)) pNull.push(nc);
  }

  // 9. Any positive component with a null selected rate → rate-unpublished.
  if (pNull.length > 0) {
    return cloneAndFreeze({ quoted: false, reason: "rate-unpublished",
      evidence: { provider: entry.provider, currency: entry.currency, tiersAvailable: entry.rates.length,
        components: [
          { component: "input", tokens: tIn, ratePerMillion: null },
          { component: "output", tokens: tOut, ratePerMillion: null },
          { component: "cacheRead", tokens: tCr, ratePerMillion: null },
          { component: "cacheCreation", tokens: tCc, ratePerMillion: null },
        ],
        expectedAggregate: aggregate, observedAggregate: observed, positiveNullRateComponents: pNull } });
  }

  // 10. Build the quoted result; multi-tier rate varies per row so aggregated ratePerMillion is null.
  const total = aIn + aOut + aCr + aCc;
  return cloneAndFreeze({ quoted: true, currency: entry.currency, total,
    components: [
      { component: "input", tokens: tIn, ratePerMillion: null, amount: aIn },
      { component: "output", tokens: tOut, ratePerMillion: null, amount: aOut },
      { component: "cacheRead", tokens: tCr, ratePerMillion: null, amount: aCr },
      { component: "cacheCreation", tokens: tCc, ratePerMillion: null, amount: aCc },
    ],
    pricing: pricingIdentity(entry),
    appliedTier: { applied, totalPromptInput: tIn + tCr + tCc },
    usageSource: "terminal-result", providerBillClaim: false });
}
