// Official pricing catalog and exact identity resolver — DeepSeek & MiniMax direct PAYG.
// No cost calculation, FX conversion, or network access lives here.

// ---------------------------------------------------------------------------
// Immutability helpers
// ---------------------------------------------------------------------------

import { deepFreeze } from "./immutability.js";
function cloneAndFreeze<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PricingCurrency = "USD" | "CNY";
type PricingRouteId = string;

export interface PricingRateTier {
  /** `null` is the base tier; a numeric tier applies only when request input exceeds it. */
  readonly minimumInputTokensExclusive: number | null;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreation: number | null;
}

export interface PricingSourceEvidence {
  readonly url: string;
  readonly checkedAt: string;
}

export interface PricingCatalogEntry {
  readonly provider: string;
  readonly origin: string;
  readonly route: PricingRouteId;
  readonly modelAliases: readonly string[];
  readonly serviceTier: string;
  readonly currency: PricingCurrency;
  readonly unitTokens: 1_000_000;
  readonly rates: readonly PricingRateTier[];
  readonly source: PricingSourceEvidence;
  readonly promotion: string | null;
}

export interface PricingMatchRequest {
  readonly provider: string;
  readonly endpoint: string;
  readonly route?: PricingRouteId;
  readonly modelAlias: string;
  readonly serviceTier: string;
}

export type PricingUnavailableReason =
  | "malformed-endpoint"
  | "route-required"
  | "unsupported-route"
  | "unsupported-endpoint"
  | "unsupported-model"
  | "unsupported-service-tier"
  | "subscription-plan-no-per-request-price"
  | "ambiguous-match"
  | "no-match";

interface MatchedPricing {
  readonly matched: true;
  readonly entry: PricingCatalogEntry;
}

interface UnavailablePricing {
  readonly matched: false;
  readonly reason: PricingUnavailableReason;
}

type PricingMatchResult = MatchedPricing | UnavailablePricing;
export type PricingCatalog = readonly PricingCatalogEntry[];

// ---------------------------------------------------------------------------
// Source evidence
// ---------------------------------------------------------------------------

const DS_SRC: PricingSourceEvidence = {
  url: "https://api-docs.deepseek.com/quick_start/pricing/", checkedAt: "2026-07-26",
};
const MM_INTL_SRC: PricingSourceEvidence = {
  url: "https://platform.minimax.io/docs/guides/pricing-paygo", checkedAt: "2026-07-26",
};
const MM_CN_SRC: PricingSourceEvidence = {
  url: "https://platform.minimaxi.com/docs/guides/pricing-paygo", checkedAt: "2026-07-26",
};

// ---------------------------------------------------------------------------
// Identity constants
// ---------------------------------------------------------------------------

const DS_ORIGIN = "https://api.deepseek.com";
const MM_INTL = "https://api.minimax.io";
const MM_CN = "https://api.minimaxi.com";
const DS_ROUTE = "deepseek-direct-payg";
const MM_INTL_ROUTE = "minimax-international-direct-payg";
const MM_CN_ROUTE = "minimax-china-direct-payg";
const VOLCENGINE_ORIGIN = "https://ark.cn-beijing.volces.com";
const VOLCENGINE_ROUTE = "volcengine-coding-plan-subscription";
const VOLCENGINE_MODEL = "glm-5.2[1M]";
const DS_FLASH_ALIASES: readonly string[] = ["deepseek-v4-flash", "deepseek-v4-flash[1M]"];
const DS_PRO_ALIASES: readonly string[] = ["deepseek-v4-pro", "deepseek-v4-pro[1M]"];
const MM_ALIASES: readonly string[] = ["MiniMax-M3", "MiniMax-M3[1m]"];
const MM_PROMO = "Permanent 50% off (effective rate shown)";

// ---------------------------------------------------------------------------
// Catalog entries — exactly six, with inlined rate tiers
// ---------------------------------------------------------------------------

const DEEPSEEK_V4_FLASH: PricingCatalogEntry = {
  provider: "deepseek", origin: DS_ORIGIN, route: DS_ROUTE,
  modelAliases: DS_FLASH_ALIASES, serviceTier: "standard", currency: "USD",
  unitTokens: 1_000_000,
  rates: [{ minimumInputTokensExclusive: null, input: 0.14, output: 0.28, cacheRead: 0.0028, cacheCreation: 0.14 }],
  source: DS_SRC, promotion: null,
};

const DEEPSEEK_V4_PRO: PricingCatalogEntry = {
  provider: "deepseek", origin: DS_ORIGIN, route: DS_ROUTE,
  modelAliases: DS_PRO_ALIASES, serviceTier: "standard", currency: "USD",
  unitTokens: 1_000_000,
  rates: [{ minimumInputTokensExclusive: null, input: 0.435, output: 0.87, cacheRead: 0.003625, cacheCreation: 0.435 }],
  source: DS_SRC, promotion: null,
};

const MINIMAX_M3_INTL_STANDARD: PricingCatalogEntry = {
  provider: "minimax", origin: MM_INTL, route: MM_INTL_ROUTE,
  modelAliases: MM_ALIASES, serviceTier: "standard", currency: "USD",
  unitTokens: 1_000_000,
  rates: [
    { minimumInputTokensExclusive: null, input: 0.30, output: 1.20, cacheRead: 0.06, cacheCreation: null },
    { minimumInputTokensExclusive: 512_000, input: 0.60, output: 2.40, cacheRead: 0.12, cacheCreation: null },
  ],
  source: MM_INTL_SRC, promotion: MM_PROMO,
};

const MINIMAX_M3_INTL_PRIORITY: PricingCatalogEntry = {
  provider: "minimax", origin: MM_INTL, route: MM_INTL_ROUTE,
  modelAliases: MM_ALIASES, serviceTier: "priority", currency: "USD",
  unitTokens: 1_000_000,
  rates: [
    { minimumInputTokensExclusive: null, input: 0.45, output: 1.80, cacheRead: 0.09, cacheCreation: null },
    { minimumInputTokensExclusive: 512_000, input: 0.90, output: 3.60, cacheRead: 0.18, cacheCreation: null },
  ],
  source: MM_INTL_SRC, promotion: MM_PROMO,
};

const MINIMAX_M3_CN_STANDARD: PricingCatalogEntry = {
  provider: "minimax", origin: MM_CN, route: MM_CN_ROUTE,
  modelAliases: MM_ALIASES, serviceTier: "standard", currency: "CNY",
  unitTokens: 1_000_000,
  rates: [
    { minimumInputTokensExclusive: null, input: 2.10, output: 8.40, cacheRead: 0.42, cacheCreation: null },
    { minimumInputTokensExclusive: 512_000, input: 4.20, output: 16.80, cacheRead: 0.84, cacheCreation: null },
  ],
  source: MM_CN_SRC, promotion: MM_PROMO,
};

const MINIMAX_M3_CN_PRIORITY: PricingCatalogEntry = {
  provider: "minimax", origin: MM_CN, route: MM_CN_ROUTE,
  modelAliases: MM_ALIASES, serviceTier: "priority", currency: "CNY",
  unitTokens: 1_000_000,
  rates: [
    { minimumInputTokensExclusive: null, input: 3.15, output: 12.60, cacheRead: 0.63, cacheCreation: null },
    { minimumInputTokensExclusive: 512_000, input: 6.30, output: 25.20, cacheRead: 1.26, cacheCreation: null },
  ],
  source: MM_CN_SRC, promotion: MM_PROMO,
};

// ---------------------------------------------------------------------------
// Default catalog — deeply frozen at module-load time
// ---------------------------------------------------------------------------

const _BUILTIN: PricingCatalog = [
  DEEPSEEK_V4_FLASH, DEEPSEEK_V4_PRO,
  MINIMAX_M3_INTL_STANDARD, MINIMAX_M3_INTL_PRIORITY,
  MINIMAX_M3_CN_STANDARD, MINIMAX_M3_CN_PRIORITY,
];

export const DEFAULT_CATALOG: PricingCatalog = deepFreeze(
  _BUILTIN.map((e) => deepFreeze({ ...e })),
);

// ---------------------------------------------------------------------------
// Resolver helpers
// ---------------------------------------------------------------------------

function normalizeOrigin(endpoint: string): string | null {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.protocol}//${url.host}`;
  } catch { return null; }
}

function isRouteRequired(provider: string): boolean {
  return provider === "minimax";
}

function distinctRoutes(provider: string, origin: string, cat: PricingCatalog): PricingRouteId[] {
  const seen = new Set<PricingRouteId>();
  const out: PricingRouteId[] = [];
  for (let i = 0; i < cat.length; i++) {
    const e = cat[i]!;
    if (e.provider === provider && e.origin === origin && !seen.has(e.route)) {
      seen.add(e.route);
      out.push(e.route);
    }
  }
  return out;
}

function hasRoute(provider: string, route: PricingRouteId, cat: PricingCatalog): boolean {
  for (let i = 0; i < cat.length; i++) {
    if (cat[i]!.provider === provider && cat[i]!.route === route) return true;
  }
  return false;
}

function hasModel(provider: string, alias: string, cat: PricingCatalog): boolean {
  for (let i = 0; i < cat.length; i++) {
    const entry = cat[i]!;
    if (entry.provider !== provider) continue;
    const a = entry.modelAliases;
    for (let j = 0; j < a.length; j++) { if (a[j] === alias) return true; }
  }
  return false;
}

function hasTier(provider: string, tier: string, cat: PricingCatalog): boolean {
  for (let i = 0; i < cat.length; i++) {
    if (cat[i]!.provider === provider && cat[i]!.serviceTier === tier) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolve one official pricing entry.  Resolution proceeds in stages so the
 * first unprovable identity dimension produces the most precise unavailable
 * reason.  Successful results are detached, deeply frozen snapshots; the
 * caller's request and replacement catalog are never mutated or frozen.
 */
export function resolveOfficialPricing(
  request: PricingMatchRequest,
  catalog?: PricingCatalog,
): PricingMatchResult {
  const cat = catalog !== undefined ? catalog : DEFAULT_CATALOG;

  // Stage 1 — normalise endpoint
  const origin = normalizeOrigin(request.endpoint);
  if (origin === null) return { matched: false, reason: "malformed-endpoint" };

  // Coding Plan is a subscription route, not a per-request PAYG table. Keep
  // its identity strict, then return an explicit unavailability reason rather
  // than fabricating a zero-dollar quote or borrowing another GLM route.
  if (request.provider === "volcengine") {
    if (origin !== VOLCENGINE_ORIGIN) {
      return { matched: false, reason: "unsupported-endpoint" };
    }
    if (request.route === undefined) {
      return { matched: false, reason: "route-required" };
    }
    if (request.route !== VOLCENGINE_ROUTE) {
      return { matched: false, reason: "unsupported-route" };
    }
    if (request.modelAlias !== VOLCENGINE_MODEL) {
      return { matched: false, reason: "unsupported-model" };
    }
    return { matched: false, reason: "subscription-plan-no-per-request-price" };
  }

  // Stage 2 — origin must be known for the requested provider
  let originOk = false;
  for (let i = 0; i < cat.length; i++) {
    if (cat[i]!.provider === request.provider && cat[i]!.origin === origin) {
      originOk = true;
      break;
    }
  }
  if (!originOk) return { matched: false, reason: "unsupported-endpoint" };

  // Stage 3 — route identity
  let resolvedRoute: PricingRouteId;
  if (request.route !== undefined) {
    if (!hasRoute(request.provider, request.route, cat)) {
      return { matched: false, reason: "unsupported-route" };
    }
    resolvedRoute = request.route;
  } else {
    if (isRouteRequired(request.provider)) return { matched: false, reason: "route-required" };
    const routes = distinctRoutes(request.provider, origin, cat);
    if (routes.length === 0) return { matched: false, reason: "unsupported-endpoint" };
    if (routes.length > 1) return { matched: false, reason: "ambiguous-match" };
    resolvedRoute = routes[0]!;
  }

  // Stage 4 — model alias must exist anywhere in the catalog
  if (!hasModel(request.provider, request.modelAlias, cat)) {
    return { matched: false, reason: "unsupported-model" };
  }

  // Stage 5 — service tier must exist anywhere in the catalog
  if (!hasTier(request.provider, request.serviceTier, cat)) {
    return { matched: false, reason: "unsupported-service-tier" };
  }

  // Stage 6 — exact combination
  const candidates: PricingCatalogEntry[] = [];
  for (let i = 0; i < cat.length; i++) {
    const entry = cat[i]!;
    if (entry.provider !== request.provider || entry.origin !== origin || entry.route !== resolvedRoute) continue;
    let am = false;
    for (let j = 0; j < entry.modelAliases.length; j++) {
      if (entry.modelAliases[j] === request.modelAlias) { am = true; break; }
    }
    if (!am || entry.serviceTier !== request.serviceTier) continue;
    candidates.push(entry);
  }

  if (candidates.length === 0) return { matched: false, reason: "no-match" };
  if (candidates.length > 1) return { matched: false, reason: "ambiguous-match" };
  return cloneAndFreeze({ matched: true as const, entry: candidates[0]! });
}
