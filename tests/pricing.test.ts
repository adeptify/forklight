import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CATALOG, resolveOfficialPricing,
  type PricingCatalog, type PricingCatalogEntry, type PricingMatchRequest,
} from "../src/core/pricing.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matched(r: ReturnType<typeof resolveOfficialPricing>): PricingCatalogEntry {
  assert.ok(r.matched, `Expected match, got reason=${(r as { reason?: string }).reason}`);
  return (r as { entry: PricingCatalogEntry }).entry;
}

function unavailable(r: ReturnType<typeof resolveOfficialPricing>, reason: string): void {
  assert.equal(r.matched, false);
  assert.equal((r as { reason: string }).reason, reason);
}

function assertDeepFrozen(v: unknown, path = "root"): void {
  if (v === null || typeof v !== "object") return;
  assert.ok(Object.isFrozen(v), `Expected ${path} frozen`);
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) assertDeepFrozen(v[i], `${path}[${i}]`);
  } else {
    for (const k of Object.keys(v as Record<string, unknown>)) {
      assertDeepFrozen((v as Record<string, unknown>)[k], `${path}.${k}`);
    }
  }
}

/** Compact builder for replacement-catalog entries in tests. */
function mk(opts: {
  p?: string; o?: string; r?: string; m?: string[]; t?: string;
  c?: "USD" | "CNY"; ci?: number; ri?: PricingCatalogEntry["rates"];
  src?: string;
}): PricingCatalogEntry {
  const rates: PricingCatalogEntry["rates"] = opts.ri ?? [{
    minimumInputTokensExclusive: opts.ci ?? null,
    input: 0.14, output: 0.28, cacheRead: 0.0028, cacheCreation: 0.14,
  }];
  return {
    provider: opts.p ?? "deepseek",
    origin: opts.o ?? "https://api.deepseek.com",
    route: opts.r ?? "deepseek-direct-payg",
    modelAliases: opts.m ?? ["deepseek-v4-flash"],
    serviceTier: opts.t ?? "standard",
    currency: opts.c ?? "USD",
    unitTokens: 1_000_000,
    rates,
    source: { url: opts.src ?? "https://example.com/pricing", checkedAt: "2026-07-23" },
    promotion: null,
  };
}

const C = DEFAULT_CATALOG;

// ---------------------------------------------------------------------------
// 1. Catalog truth — six entries, exact official values
// ---------------------------------------------------------------------------

test("catalog truth: all six entries match official sources", () => {
  assert.equal(C.length, 6);

  // DeepSeek V4 Flash — index 0
  let e = C[0]!;
  assert.equal(e.provider, "deepseek");
  assert.equal(e.origin, "https://api.deepseek.com");
  assert.equal(e.route, "deepseek-direct-payg");
  assert.equal(e.currency, "USD");
  assert.equal(e.unitTokens, 1_000_000);
  assert.equal(e.serviceTier, "standard");
  assert.equal(e.promotion, null);
  assert.equal(e.source.url, "https://api-docs.deepseek.com/quick_start/pricing/");
  assert.equal(e.source.checkedAt, "2026-07-26");
  assert.equal(e.rates.length, 1);
  assert.equal(e.rates[0]!.input, 0.14);
  assert.equal(e.rates[0]!.output, 0.28);
  assert.equal(e.rates[0]!.cacheRead, 0.0028);
  assert.equal(e.rates[0]!.cacheCreation, 0.14);

  // DeepSeek V4 Pro — index 1
  e = C[1]!;
  assert.equal(e.provider, "deepseek");
  assert.equal(e.rates[0]!.input, 0.435);
  assert.equal(e.rates[0]!.output, 0.87);
  assert.equal(e.rates[0]!.cacheRead, 0.003625);
  assert.equal(e.rates[0]!.cacheCreation, 0.435);
  assert.equal(e.source.url, "https://api-docs.deepseek.com/quick_start/pricing/");

  // MiniMax M3 International Standard — index 2
  e = C[2]!;
  assert.equal(e.provider, "minimax");
  assert.equal(e.origin, "https://api.minimax.io");
  assert.equal(e.route, "minimax-international-direct-payg");
  assert.equal(e.currency, "USD");
  assert.equal(e.serviceTier, "standard");
  assert.equal(e.promotion, "Permanent 50% off (effective rate shown)");
  assert.equal(e.source.url, "https://platform.minimax.io/docs/guides/pricing-paygo");
  assert.equal(e.rates.length, 2);
  assert.equal(e.rates[0]!.input, 0.30); assert.equal(e.rates[0]!.output, 1.20);
  assert.equal(e.rates[0]!.cacheRead, 0.06); assert.equal(e.rates[0]!.cacheCreation, null);
  assert.equal(e.rates[0]!.minimumInputTokensExclusive, null);
  assert.equal(e.rates[1]!.minimumInputTokensExclusive, 512_000);
  assert.equal(e.rates[1]!.input, 0.60); assert.equal(e.rates[1]!.cacheCreation, null);

  // MiniMax M3 International Priority — index 3
  e = C[3]!;
  assert.equal(e.serviceTier, "priority");
  assert.equal(e.rates[0]!.input, 0.45); assert.equal(e.rates[0]!.output, 1.80);
  assert.equal(e.rates[0]!.cacheRead, 0.09);
  assert.equal(e.rates[1]!.input, 0.90); assert.equal(e.rates[1]!.output, 3.60);

  // MiniMax M3 China Standard — index 4
  e = C[4]!;
  assert.equal(e.origin, "https://api.minimaxi.com");
  assert.equal(e.route, "minimax-china-direct-payg");
  assert.equal(e.currency, "CNY");
  assert.equal(e.serviceTier, "standard");
  assert.equal(e.source.url, "https://platform.minimaxi.com/docs/guides/pricing-paygo");
  assert.equal(e.rates[0]!.input, 2.10); assert.equal(e.rates[0]!.output, 8.40);
  assert.equal(e.rates[0]!.cacheRead, 0.42); assert.equal(e.rates[0]!.cacheCreation, null);
  assert.equal(e.rates[1]!.input, 4.20); assert.equal(e.rates[1]!.output, 16.80);

  // MiniMax M3 China Priority — index 5
  e = C[5]!;
  assert.equal(e.serviceTier, "priority");
  assert.equal(e.rates[0]!.input, 3.15); assert.equal(e.rates[0]!.output, 12.60);
  assert.equal(e.rates[0]!.cacheRead, 0.63);
  assert.equal(e.rates[1]!.input, 6.30); assert.equal(e.rates[1]!.output, 25.20);
});

// ---------------------------------------------------------------------------
// 2. Exact aliases
// ---------------------------------------------------------------------------

test("exact model aliases match official model identifiers", () => {
  assert.deepEqual(C[0]!.modelAliases, ["deepseek-v4-flash", "deepseek-v4-flash[1M]"]);
  assert.deepEqual(C[1]!.modelAliases, ["deepseek-v4-pro", "deepseek-v4-pro[1M]"]);
  const mm = ["MiniMax-M3", "MiniMax-M3[1m]"];
  for (let i = 2; i <= 5; i++) assert.deepEqual(C[i]!.modelAliases, mm);
});

// ---------------------------------------------------------------------------
// 3. DeepSeek — route omitted, inference
// ---------------------------------------------------------------------------

test("DeepSeek resolves both models and [1M] aliases with route omitted", () => {
  let e = matched(resolveOfficialPricing({
    provider: "deepseek",
    endpoint: "https://api.deepseek.com/anthropic/v1/messages",
    modelAlias: "deepseek-v4-pro", serviceTier: "standard",
  }));
  assert.equal(e.route, "deepseek-direct-payg");
  assert.equal(e.rates[0]!.input, 0.435);
  assert.equal(e.rates[0]!.cacheCreation, 0.435);

  e = matched(resolveOfficialPricing({
    provider: "deepseek",
    endpoint: "https://api.deepseek.com/anthropic",
    modelAlias: "deepseek-v4-flash", serviceTier: "standard",
  }));
  assert.equal(e.rates[0]!.input, 0.14);
  assert.equal(e.rates[0]!.cacheRead, 0.0028);

  // [1M] aliases
  e = matched(resolveOfficialPricing({
    provider: "deepseek",
    endpoint: "https://api.deepseek.com/anthropic",
    modelAlias: "deepseek-v4-flash[1M]", serviceTier: "standard",
  }));
  assert.equal(e.rates[0]!.input, 0.14);

  e = matched(resolveOfficialPricing({
    provider: "deepseek",
    endpoint: "https://api.deepseek.com/anthropic",
    modelAlias: "deepseek-v4-pro[1M]", serviceTier: "standard",
  }));
  assert.equal(e.rates[0]!.input, 0.435);
});

// ---------------------------------------------------------------------------
// 4. MiniMax — explicit route, all four combos
// ---------------------------------------------------------------------------

test("MiniMax resolves all four region/tier combinations with explicit route", () => {
  const checks = [
    { ep: "https://api.minimax.io/anthropic", r: "minimax-international-direct-payg",
      t: "standard", cur: "USD", in0: 0.30, in1: 0.60 },
    { ep: "https://api.minimax.io/anthropic", r: "minimax-international-direct-payg",
      t: "priority", cur: "USD", in0: 0.45, in1: 0.90 },
    { ep: "https://api.minimaxi.com/anthropic", r: "minimax-china-direct-payg",
      t: "standard", cur: "CNY", in0: 2.10, in1: 4.20 },
    { ep: "https://api.minimaxi.com/anthropic", r: "minimax-china-direct-payg",
      t: "priority", cur: "CNY", in0: 3.15, in1: 6.30 },
  ];
  for (const ch of checks) {
    const e = matched(resolveOfficialPricing({
      provider: "minimax",
      endpoint: ch.ep, route: ch.r, modelAlias: "MiniMax-M3", serviceTier: ch.t,
    }));
    assert.equal(e.currency, ch.cur, `${ch.t}`);
    assert.equal(e.rates.length, 2);
    assert.equal(e.rates[0]!.input, ch.in0);
    assert.equal(e.rates[1]!.input, ch.in1);
    assert.equal(e.rates[0]!.cacheCreation, null);
    assert.equal(e.rates[1]!.cacheCreation, null);
  }
  // [1m] alias
  const e = matched(resolveOfficialPricing({
    provider: "minimax",
    endpoint: "https://api.minimaxi.com/anthropic",
    route: "minimax-china-direct-payg",
    modelAlias: "MiniMax-M3[1m]", serviceTier: "priority",
  }));
  assert.equal(e.rates[0]!.input, 3.15);
});

// ---------------------------------------------------------------------------
// 5. MiniMax route-required
// ---------------------------------------------------------------------------

test("MiniMax with omitted route returns route-required for both regions", () => {
  unavailable(resolveOfficialPricing({
    provider: "minimax",
    endpoint: "https://api.minimax.io/anthropic", modelAlias: "MiniMax-M3",
    serviceTier: "standard",
  }), "route-required");
  unavailable(resolveOfficialPricing({
    provider: "minimax",
    endpoint: "https://api.minimaxi.com/anthropic", modelAlias: "MiniMax-M3",
    serviceTier: "priority",
  }), "route-required");
});

test("Volcengine Coding Plan identity is strict and subscription cost is explicit", () => {
  unavailable(resolveOfficialPricing({
    provider: "volcengine",
    endpoint: "https://ark.cn-beijing.volces.com/api/coding",
    route: "volcengine-coding-plan-subscription",
    modelAlias: "glm-5.2[1M]",
    serviceTier: "standard",
  }), "subscription-plan-no-per-request-price");
  unavailable(resolveOfficialPricing({
    provider: "volcengine",
    endpoint: "https://ark.cn-beijing.volces.com/api/coding",
    route: "volcengine-coding-plan-subscription",
    modelAlias: "glm-5.2",
    serviceTier: "standard",
  }), "unsupported-model");
});

// ---------------------------------------------------------------------------
// 6. Unavailable reasons — one per code, including no-match and ambiguity
// ---------------------------------------------------------------------------

test("every unavailable reason is reachable deterministically", () => {
  // malformed-endpoint
  unavailable(resolveOfficialPricing({
    provider: "deepseek",
    endpoint: "not-a-url", modelAlias: "x", serviceTier: "x",
  }), "malformed-endpoint");
  unavailable(resolveOfficialPricing({
    provider: "deepseek",
    endpoint: "ftp://api.deepseek.com/x", modelAlias: "x", serviceTier: "x",
  }), "malformed-endpoint");

  // unsupported-endpoint
  unavailable(resolveOfficialPricing({
    provider: "deepseek",
    endpoint: "https://unknown.example.com/x", modelAlias: "x", serviceTier: "x",
  }), "unsupported-endpoint");
  unavailable(resolveOfficialPricing({
    provider: "deepseek",
    endpoint: "https://api.minimax.io/anthropic", route: "minimax-international-direct-payg",
    modelAlias: "MiniMax-M3", serviceTier: "standard",
  }), "unsupported-endpoint");

  // unsupported-model
  unavailable(resolveOfficialPricing({
    provider: "deepseek",
    endpoint: "https://api.deepseek.com/anthropic",
    modelAlias: "no-such-model", serviceTier: "standard",
  }), "unsupported-model");

  // unsupported-service-tier
  unavailable(resolveOfficialPricing({
    provider: "deepseek",
    endpoint: "https://api.deepseek.com/anthropic",
    modelAlias: "deepseek-v4-flash", serviceTier: "platinum",
  }), "unsupported-service-tier");

  // unsupported-route
  unavailable(resolveOfficialPricing({
    provider: "minimax",
    endpoint: "https://api.minimax.io/anthropic",
    route: "no-such-route", modelAlias: "MiniMax-M3", serviceTier: "standard",
  }), "unsupported-route");

  // no-match: each dimension known but no single entry combines them
  const catA = mk({ r: "route-alpha", m: ["model-a"], t: "standard" });
  const catB = mk({ r: "route-beta", m: ["model-b"], t: "priority" });
  unavailable(resolveOfficialPricing({
    provider: "deepseek",
    endpoint: "https://api.deepseek.com/anthropic",
    route: "route-alpha", modelAlias: "model-b", serviceTier: "standard",
  }, [catA, catB]), "no-match");

  // ambiguous-match: duplicate entries
  const dup = mk({});
  unavailable(resolveOfficialPricing({
    provider: "deepseek",
    endpoint: "https://api.deepseek.com/anthropic",
    modelAlias: "deepseek-v4-flash", serviceTier: "standard",
  }, [dup, dup]), "ambiguous-match");

  // ambiguous-match: multiple routes at inference time
  unavailable(resolveOfficialPricing({
    provider: "deepseek",
    endpoint: "https://api.deepseek.com/anthropic",
    modelAlias: "deepseek-v4-flash", serviceTier: "standard",
  }, [mk({ r: "r1" }), mk({ r: "r2" })]), "ambiguous-match");

  // case-sensitive model matching
  unavailable(resolveOfficialPricing({
    provider: "minimax",
    endpoint: "https://api.minimax.io/anthropic",
    route: "minimax-international-direct-payg",
    modelAlias: "minimax-m3", serviceTier: "standard",
  }), "unsupported-model");
});

// ---------------------------------------------------------------------------
// 7. Replacement catalog drives all matching decisions
// ---------------------------------------------------------------------------

test("replacement catalog controls origin recognition, route checks, and inference", () => {
  // Custom origin — would fail against default catalog
  const cat = [mk({ o: "https://custom.example.com" })];
  assert.equal(matched(resolveOfficialPricing({
    provider: "deepseek",
    endpoint: "https://custom.example.com/anthropic",
    modelAlias: "deepseek-v4-flash", serviceTier: "standard",
  }, cat)).origin, "https://custom.example.com");

  // Default route unsupported against replacement
  unavailable(resolveOfficialPricing({
    provider: "deepseek",
    endpoint: "https://api.deepseek.com/anthropic",
    route: "deepseek-direct-payg", modelAlias: "deepseek-v4-flash",
    serviceTier: "standard",
  }, [mk({ r: "custom-only" })]), "unsupported-route");

  // Route inference uses replacement catalog
  const e = matched(resolveOfficialPricing({
    provider: "deepseek",
    endpoint: "https://api.deepseek.com/anthropic",
    modelAlias: "deepseek-v4-pro", serviceTier: "standard",
  }, [mk({ r: "replacement-route", m: ["deepseek-v4-pro"] })]));
  assert.equal(e.route, "replacement-route");
});

// ---------------------------------------------------------------------------
// 8. Immutability — catalog, snapshots, caller inputs
// ---------------------------------------------------------------------------

test("default catalog is deeply frozen", () => {
  assert.ok(Object.isFrozen(DEFAULT_CATALOG));
  for (const e of DEFAULT_CATALOG) assertDeepFrozen(e);
});

test("matched result and snapshot are deeply frozen and detached from catalog", () => {
  const result = resolveOfficialPricing({
    provider: "deepseek",
    endpoint: "https://api.deepseek.com/anthropic",
    modelAlias: "deepseek-v4-flash", serviceTier: "standard",
  });
  assert.ok(result.matched);
  assertDeepFrozen(result);
  const e = matched(result);
  assertDeepFrozen(e);
  assert.notStrictEqual(e, C[0]);
  assert.notStrictEqual(e.rates, C[0]!.rates);
  assert.notStrictEqual(e.modelAliases, C[0]!.modelAliases);
  assert.notStrictEqual(e.source, C[0]!.source);
});

test("caller request and replacement catalog are never mutated or frozen", () => {
  const req: PricingMatchRequest = {
    provider: "deepseek",
    endpoint: "https://api.deepseek.com/anthropic",
    modelAlias: "deepseek-v4-pro", serviceTier: "standard",
  };
  const reqClone = { ...req };
  resolveOfficialPricing(req);
  assert.deepEqual(req, reqClone);
  assert.equal(Object.isFrozen(req), false);

  const cat: PricingCatalog = [mk({})];
  const catClone = structuredClone(cat);
  resolveOfficialPricing({
    provider: "deepseek",
    endpoint: "https://api.deepseek.com/anthropic",
    modelAlias: "deepseek-v4-flash", serviceTier: "standard",
  }, cat);
  assert.equal(Object.isFrozen(cat[0]!), false);
  assert.equal(Object.isFrozen(cat as object), false);
  assert.deepEqual(cat, catClone);

  // Inference path also does not freeze replacement
  const cat2: PricingCatalog = [mk({})];
  resolveOfficialPricing({
    provider: "deepseek",
    endpoint: "https://api.deepseek.com/anthropic",
    modelAlias: "deepseek-v4-flash", serviceTier: "standard",
  }, cat2);
  assert.equal(Object.isFrozen(cat2[0]!), false);
});

// ---------------------------------------------------------------------------
// 9. Provider identity isolates entries that share one origin
// ---------------------------------------------------------------------------

test("provider identity isolates shared origins and MiniMax route policy", () => {
  const cat = [
    mk({ o: "https://shared.example.com", r: "ds-route" }),
    mk({ p: "minimax", o: "https://shared.example.com", r: "mm-route",
      m: ["MiniMax-M3"], t: "standard",
      ri: [{ minimumInputTokensExclusive: null, input: 0.30, output: 1.20, cacheRead: 0.06, cacheCreation: null }] }),
  ];
  assert.equal(matched(resolveOfficialPricing({
    provider: "deepseek",
    endpoint: "https://shared.example.com/anthropic",
    modelAlias: "deepseek-v4-flash", serviceTier: "standard",
  }, cat)).route, "ds-route");

  unavailable(resolveOfficialPricing({
    provider: "minimax",
    endpoint: "https://shared.example.com/anthropic",
    modelAlias: "MiniMax-M3", serviceTier: "standard",
  }, cat), "route-required");
});

// ---------------------------------------------------------------------------
// 10. DeepSeek cache-creation equals input (cache-miss) for both models
// ---------------------------------------------------------------------------

test("DeepSeek cacheCreation equals input for Flash and Pro", () => {
  for (const i of [0, 1]) {
    assert.equal(C[i]!.rates[0]!.cacheCreation, C[i]!.rates[0]!.input,
      `${C[i]!.modelAliases[0]}: cacheCreation === input (cache-miss)`);
  }
});
