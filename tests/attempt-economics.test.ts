import assert from "node:assert/strict";
import test from "node:test";
import { resolveAttemptOfficialCost } from "../src/core/attempt-economics.js";
import type {
  AttemptOfficialCost,
  AttemptOfficialCostCalculationUnavailable,
  AttemptOfficialCostIdentityUnavailable,
  AttemptOfficialCostQuoted,
  AttemptOfficialCostUsageUnavailable,
  AttemptTokenUsage,
  ProviderSpec,
} from "../src/core/types.js";
import type { RequestTokenUsage } from "../src/core/pricing-calculator.js";

// --- Helpers ---------------------------------------------------------------

const usage = (i: number, o: number, cr: number, cc: number): AttemptTokenUsage =>
  ({ inputTokens: i, outputTokens: o, cacheReadInputTokens: cr, cacheCreationInputTokens: cc,
    source: "terminal-result", complete: true, serviceTier: "standard" });

const row = (i: number, o: number, cr: number, cc: number): RequestTokenUsage =>
  ({ inputTokens: i, outputTokens: o, cacheReadInputTokens: cr, cacheCreationInputTokens: cc });

function assertDeepFrozen(v: unknown, path = "root"): void {
  if (v === null || typeof v !== "object") return;
  assert.ok(Object.isFrozen(v), `Expected ${path} frozen`);
  if (Array.isArray(v)) for (let i = 0; i < v.length; i++) assertDeepFrozen(v[i], `${path}[${i}]`);
  else for (const k of Object.keys(v as Record<string, unknown>))
    assertDeepFrozen((v as Record<string, unknown>)[k], `${path}.${k}`);
}

const asQuoted = (r: AttemptOfficialCost): AttemptOfficialCostQuoted => {
  assert.equal(r.quoted, true); assert.equal(r.stage, "calculation");
  return r as AttemptOfficialCostQuoted;
};
const asUsageUnavail = (r: AttemptOfficialCost): AttemptOfficialCostUsageUnavailable => {
  assert.equal(r.stage, "usage"); assert.equal(r.quoted, false); return r as AttemptOfficialCostUsageUnavailable;
};
const asIdentityUnavail = (r: AttemptOfficialCost): AttemptOfficialCostIdentityUnavailable => {
  assert.equal(r.stage, "pricing-identity"); assert.equal(r.quoted, false); return r as AttemptOfficialCostIdentityUnavailable;
};
const asCalcUnavail = (r: AttemptOfficialCost, reason: string): AttemptOfficialCostCalculationUnavailable => {
  assert.equal(r.stage, "calculation"); assert.equal(r.quoted, false);
  const u = r as AttemptOfficialCostCalculationUnavailable;
  assert.equal(u.result.reason, reason);
  return u;
};

const DS_PRO_PROVIDER: ProviderSpec = {
  name: "deepseek",
  model: "deepseek-v4-pro",
  endpoint: "https://api.deepseek.com",
  keychainService: "forklight.deepseek.api-key",
};

const MM_INTL_PROVIDER: ProviderSpec = {
  name: "minimax",
  model: "MiniMax-M3",
  endpoint: "https://api.minimax.io/anthropic",
  keychainService: "forklight.minimax.api-key",
};

const MM_CN_PROVIDER: ProviderSpec = {
  name: "minimax",
  model: "MiniMax-M3",
  endpoint: "https://api.minimaxi.com/anthropic",
  keychainService: "forklight.minimax.api-key",
};

const VOLCENGINE_PROVIDER: ProviderSpec = {
  name: "volcengine",
  model: "glm-5.2[1M]",
  endpoint: "https://ark.cn-beijing.volces.com/api/coding",
  keychainService: "forklight.volcengine.api-key",
  pricingRoute: "volcengine-coding-plan-subscription",
};

// --- Exact DeepSeek dogfood cost -------------------------------------------

test("DeepSeek Pro live dogfood usage quotes exact USD 0.069825939", () => {
  const r = asQuoted(resolveAttemptOfficialCost(
    DS_PRO_PROVIDER,
    usage(51_105, 51_728, 715_008, 0),
  ));
  assert.equal(r.result.currency, "USD");
  assert.equal(r.result.total, 0.069825939);
  assert.equal(r.result.providerBillClaim, false);
  assert.equal(r.result.usageSource, "terminal-result");
  assert.equal(r.result.pricing.source.url, "https://api-docs.deepseek.com/quick_start/pricing/");
  assert.equal(r.result.pricing.source.checkedAt, "2026-07-26");
  assert.equal(r.result.appliedTier.applied[0]!.minimumInputTokensExclusive, null);
  assert.equal(r.result.appliedTier.totalPromptInput, 51_105 + 715_008);
  // Verify component totals sum to the quoted total
  const csTotal = r.result.components.reduce((s, c) => s + c.amount, 0);
  assert.equal(csTotal, r.result.total);
  // Verify individual component amounts
  const inputC = r.result.components.find(c => c.component === "input")!;
  assert.equal(inputC.tokens, 51_105);
  assert.equal(inputC.amount, 0.022230675);
  assert.equal(inputC.ratePerMillion, 0.435);
  const outputC = r.result.components.find(c => c.component === "output")!;
  assert.equal(outputC.tokens, 51_728);
  assert.equal(outputC.amount, 0.04500336);
  assert.equal(outputC.ratePerMillion, 0.87);
  const cacheReadC = r.result.components.find(c => c.component === "cacheRead")!;
  assert.equal(cacheReadC.tokens, 715_008);
  assert.equal(cacheReadC.amount, 0.002591904);
  assert.equal(cacheReadC.ratePerMillion, 0.003625);
  const cacheCreationC = r.result.components.find(c => c.component === "cacheCreation")!;
  assert.equal(cacheCreationC.tokens, 0);
  assert.equal(cacheCreationC.amount, 0);
  assert.equal(cacheCreationC.ratePerMillion, 0.435);
});

// --- Absent usage ----------------------------------------------------------

test("undefined usage returns usage-missing", () => {
  const r = asUsageUnavail(resolveAttemptOfficialCost(DS_PRO_PROVIDER));
  assert.equal(r.reason, "usage-missing");
});

test("null usage returns usage-missing", () => {
  const r = asUsageUnavail(resolveAttemptOfficialCost(
    DS_PRO_PROVIDER,
    null as unknown as AttemptTokenUsage,
  ));
  assert.equal(r.reason, "usage-missing");
});

test("Volcengine Coding Plan keeps tokens but never invents a per-request cost", () => {
  const result = asIdentityUnavail(resolveAttemptOfficialCost(
    VOLCENGINE_PROVIDER,
    usage(1234, 567, 890, 0),
  ));
  assert.equal(result.reason, "subscription-plan-no-per-request-price");
  assertDeepFrozen(result);
});

// --- Missing service tier --------------------------------------------------

test("usage without serviceTier returns service-tier-missing", () => {
  const u = { inputTokens: 1_000, outputTokens: 500, cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0, source: "terminal-result" as const, complete: true as const };
  // serviceTier is absent
  const r = asUsageUnavail(resolveAttemptOfficialCost(DS_PRO_PROVIDER, u));
  assert.equal(r.reason, "service-tier-missing");
});

test("usage with empty serviceTier returns service-tier-missing", () => {
  const u = { inputTokens: 1_000, outputTokens: 500, cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0, source: "terminal-result" as const, complete: true as const,
    serviceTier: "" };
  const r = asUsageUnavail(resolveAttemptOfficialCost(DS_PRO_PROVIDER, u));
  assert.equal(r.reason, "service-tier-missing");
});

// --- Identity failures -----------------------------------------------------

test("malformed endpoint returns pricing-identity malformed-endpoint", () => {
  const provider: ProviderSpec = {
    name: "deepseek",
    model: "deepseek-v4-pro",
    keychainService: "forklight.deepseek.api-key",
  };
  const r = asIdentityUnavail(resolveAttemptOfficialCost(provider, usage(1, 0, 0, 0)));
  assert.equal(r.reason, "malformed-endpoint");
});

test("unsupported endpoint returns pricing-identity unsupported-endpoint", () => {
  const provider: ProviderSpec = {
    name: "deepseek",
    model: "deepseek-v4-pro",
    endpoint: "https://unknown.example.com/v1",
    keychainService: "forklight.deepseek.api-key",
  };
  const r = asIdentityUnavail(resolveAttemptOfficialCost(provider, usage(1, 0, 0, 0)));
  assert.equal(r.reason, "unsupported-endpoint");
});

test("unsupported model returns pricing-identity unsupported-model", () => {
  const provider: ProviderSpec = {
    name: "deepseek",
    model: "nonexistent-model",
    endpoint: "https://api.deepseek.com",
    keychainService: "forklight.deepseek.api-key",
  };
  const r = asIdentityUnavail(resolveAttemptOfficialCost(provider, usage(1, 0, 0, 0)));
  assert.equal(r.reason, "unsupported-model");
});

test("unsupported service tier returns pricing-identity unsupported-service-tier", () => {
  const u = { ...usage(1, 0, 0, 0), serviceTier: "enterprise" } as AttemptTokenUsage;
  const r = asIdentityUnavail(resolveAttemptOfficialCost(DS_PRO_PROVIDER, u));
  assert.equal(r.reason, "unsupported-service-tier");
});

// --- MiniMax route-required -------------------------------------------------

test("MiniMax without pricingRoute returns pricing-identity route-required", () => {
  const r = asIdentityUnavail(resolveAttemptOfficialCost(MM_INTL_PROVIDER, usage(100, 50, 20, 10)));
  assert.equal(r.reason, "route-required");
});

test("MiniMax with unsupported route returns pricing-identity unsupported-route", () => {
  const provider: ProviderSpec = {
    ...MM_INTL_PROVIDER,
    pricingRoute: "nonexistent-route",
  };
  const r = asIdentityUnavail(resolveAttemptOfficialCost(provider, usage(100, 50, 20, 10)));
  assert.equal(r.reason, "unsupported-route");
});

// --- MiniMax request-row requirement ----------------------------------------

test("MiniMax with route but without rows returns calculation per-request-usage-required", () => {
  const provider: ProviderSpec = {
    ...MM_INTL_PROVIDER,
    pricingRoute: "minimax-international-direct-payg",
  };
  const r = asCalcUnavail(
    resolveAttemptOfficialCost(provider, usage(100, 50, 20, 10)),
    "per-request-usage-required",
  );
  // Evidence is preserved within the UnavailableCost result.
  assert.equal(r.result.evidence.tiersAvailable, 2);
  assert.equal(r.result.evidence.observedAggregate, null);
  assert.ok(r.result.evidence.expectedAggregate);
});

test("MiniMax zero usage with route quotes without rows", () => {
  const provider: ProviderSpec = {
    ...MM_INTL_PROVIDER,
    pricingRoute: "minimax-international-direct-payg",
  };
  const r = asQuoted(resolveAttemptOfficialCost(provider, usage(0, 0, 0, 0)));
  assert.equal(r.result.total, 0);
  assert.equal(r.result.appliedTier.applied.length, 1);
});

// --- Unpublished cache creation ---------------------------------------------

test("MiniMax positive cache-creation returns calculation rate-unpublished", () => {
  const provider: ProviderSpec = {
    ...MM_INTL_PROVIDER,
    pricingRoute: "minimax-international-direct-payg",
  };
  const r = asCalcUnavail(
    resolveAttemptOfficialCost(provider, usage(100, 50, 20, 30), [row(100, 50, 20, 30)]),
    "rate-unpublished",
  );
  // Evidence preserved: positiveNullRateComponents includes cacheCreation.
  assert.ok(r.result.evidence.positiveNullRateComponents.includes("cacheCreation"));
  const cc = r.result.evidence.components.find(c => c.component === "cacheCreation")!;
  assert.equal(cc.tokens, 30);
  assert.equal(cc.ratePerMillion, null);
});

// --- Immutability ------------------------------------------------------------

test("quoted result wrapper is deeply frozen", () => {
  const r = resolveAttemptOfficialCost(DS_PRO_PROVIDER, usage(51_105, 51_728, 715_008, 0));
  assertDeepFrozen(r);
  assert.throws(() => { (r as { stage: string }).stage = "usage"; }, TypeError);
});

test("quoted inner result is deeply frozen", () => {
  const r = asQuoted(resolveAttemptOfficialCost(DS_PRO_PROVIDER, usage(51_105, 51_728, 715_008, 0)));
  assertDeepFrozen(r.result);
  assert.throws(() => { (r.result as { total: number }).total = 0; }, TypeError);
});

test("unavailable wrapper is deeply frozen", () => {
  assertDeepFrozen(resolveAttemptOfficialCost(DS_PRO_PROVIDER));
  assertDeepFrozen(resolveAttemptOfficialCost(MM_INTL_PROVIDER, usage(100, 50, 20, 10)));
});

test("calc-unavailable inner result is deeply frozen", () => {
  const provider: ProviderSpec = {
    ...MM_INTL_PROVIDER,
    pricingRoute: "minimax-international-direct-payg",
  };
  const r = asCalcUnavail(
    resolveAttemptOfficialCost(provider, usage(100, 50, 20, 10)),
    "per-request-usage-required",
  );
  assertDeepFrozen(r.result);
});

test("provider input is not frozen after resolution", () => {
  const provider: ProviderSpec = { ...MM_INTL_PROVIDER, pricingRoute: "minimax-international-direct-payg" };
  const u = usage(100, 50, 20, 10);
  const rows: RequestTokenUsage[] = [row(100, 50, 20, 10)];
  const providerBefore = structuredClone(provider);
  const usageBefore = structuredClone(u);
  const rowsBefore = structuredClone(rows);

  resolveAttemptOfficialCost(provider, u, rows);

  assert.equal(Object.isFrozen(provider), false);
  assert.equal(Object.isFrozen(u), false);
  assert.equal(Object.isFrozen(rows), false);
  assert.deepEqual(provider, providerBefore);
  assert.deepEqual(u, usageBefore);
  assert.deepEqual(rows, rowsBefore);
});

// --- Detached evidence ------------------------------------------------------

test("returned evidence is detached — result is a frozen copy", () => {
  const r = asQuoted(resolveAttemptOfficialCost(DS_PRO_PROVIDER, usage(51_105, 51_728, 715_008, 0)));
  // The pricing identity within QuotedCost should be a frozen snapshot, distinct from catalog entry references.
  assertDeepFrozen(r.result.pricing);
  assert.ok(Object.isFrozen(r.result.pricing));
  assert.ok(Object.isFrozen(r.result.pricing.source));
});

// --- pricingRoute parsing and safety ----------------------------------------

test("pricingRoute from task file parses as a non-empty string", async () => {
  const { parseTaskSpec } = await import("../src/core/task.js");
  const spec = parseTaskSpec(
    {
      version: 2,
      name: "Pricing route test",
      project: process.cwd(),
      provider: {
        name: "minimax",
        model: "MiniMax-M3",
        endpoint: "https://api.minimax.io/anthropic",
        pricingRoute: "minimax-international-direct-payg",
        keychainService: "forklight.minimax.api-key",
      },
      worker: { focusPaths: ["src"] },
      contract: {
        outcome: "A reasonable outcome description for the pricing route test scenario",
        context: ["c"],
        inScope: ["i"],
        outOfScope: ["o"],
        executionSteps: ["s"],
        deliverables: ["d"],
        modules: [{
          name: "m",
          responsibility: "long enough responsibility here for pass",
          consumes: ["c"],
          produces: ["p"],
          boundaries: ["b"],
        }],
        callChain: ["a", "b"],
        scenarios: [
          { name: "normal", given: "g", when: "w", then: "t" },
          { name: "edge", given: "g", when: "w", then: "t" },
        ],
        risks: ["r"],
        changeBudget: { maxFiles: 4, maxDiffLines: 300 },
      },
      acceptance: { criteria: ["c"], commands: ["true"] },
    },
    process.cwd(),
  );
  assert.equal(spec.provider.pricingRoute, "minimax-international-direct-payg");
  assert.equal(typeof spec.provider.pricingRoute, "string");
  assert.ok((spec.provider.pricingRoute as string).length > 0);
});

test("omitted pricingRoute stays undefined after parsing", async () => {
  const { parseTaskSpec } = await import("../src/core/task.js");
  const spec = parseTaskSpec(
    {
      version: 2,
      name: "No route test",
      project: process.cwd(),
      provider: {
        name: "deepseek",
        model: "deepseek-v4-pro",
        endpoint: "https://api.deepseek.com",
        keychainService: "forklight.deepseek.api-key",
      },
      worker: { focusPaths: ["src"] },
      contract: {
        outcome: "A reasonable outcome description for the no-route test",
        context: ["c"],
        inScope: ["i"],
        outOfScope: ["o"],
        executionSteps: ["s"],
        deliverables: ["d"],
        modules: [{
          name: "m",
          responsibility: "long enough responsibility here for pass",
          consumes: ["c"],
          produces: ["p"],
          boundaries: ["b"],
        }],
        callChain: ["a", "b"],
        scenarios: [
          { name: "normal", given: "g", when: "w", then: "t" },
          { name: "edge", given: "g", when: "w", then: "t" },
        ],
        risks: ["r"],
        changeBudget: { maxFiles: 4, maxDiffLines: 300 },
      },
      acceptance: { criteria: ["c"], commands: ["true"] },
    },
    process.cwd(),
  );
  assert.equal(spec.provider.pricingRoute, undefined);
});

test("providerEnvironment never forwards pricingRoute as a runtime variable", async () => {
  const { resolveProvider, providerEnvironment } = await import("../src/core/providers.js");
  // resolveProvider only destructures endpoint / model / keychainService / keychainAccount.
  // ProviderSpec may carry pricingRoute but resolveProvider ignores it.
  const config = resolveProvider("minimax", {
    endpoint: "https://api.minimax.io/anthropic",
    model: "MiniMax-M3",
    keychainService: "forklight.minimax.api-key",
  });
  const env = providerEnvironment(config, "test-api-key");
  assert.equal("pricingRoute" in env, false);
  assert.equal("PRICING_ROUTE" in env, false);
  assert.equal(env.ANTHROPIC_BASE_URL, "https://api.minimax.io/anthropic");
  assert.equal(env.ANTHROPIC_MODEL, "MiniMax-M3");
});

// --- MiniMax China with route and rows quotes correctly ---------------------

test("MiniMax China direct-PAYG route with rows quotes in CNY", () => {
  const provider: ProviderSpec = {
    ...MM_CN_PROVIDER,
    pricingRoute: "minimax-china-direct-payg",
  };
  // 500_000 prompt Tokens fits in the <=512K base tier → 2.10 CNY/M input.
  const r = asQuoted(resolveAttemptOfficialCost(
    provider,
    usage(500_000, 0, 0, 0),
    [row(500_000, 0, 0, 0)],
  ));
  assert.equal(r.result.currency, "CNY");
  assert.equal(r.result.total, (500_000 * 2.10) / 1_000_000);
  assert.equal(r.result.providerBillClaim, false);
  assert.equal(r.result.pricing.currency, "CNY");
  assert.equal(r.result.pricing.origin, "https://api.minimaxi.com");
  assert.equal(r.result.pricing.route, "minimax-china-direct-payg");
});

// --- Bounded estimate evidence ------------------------------------------------

test("MiniMax without rows: unavailable result carries bounded estimate in per-request-usage-required", () => {
  const provider: ProviderSpec = {
    ...MM_INTL_PROVIDER,
    pricingRoute: "minimax-international-direct-payg",
  };
  const r = asCalcUnavail(
    resolveAttemptOfficialCost(provider, usage(500_000, 100_000, 50_000, 0)),
    "per-request-usage-required",
  );
  assert.ok(r.result.boundedEstimate !== undefined, "bounded estimate should be present");
  const be = r.result.boundedEstimate!;
  assert.equal(be.currency, "USD");
  assert.equal(be.method, "aggregate-tier-bounds");
  assert.equal(be.providerBillClaim, false);
  assert.ok(be.min <= be.max, "min <= max");
  assert.ok(be.min > 0, "min should be positive");
});

test("MiniMax with positive cache-creation: calc unavailable without bounded estimate", () => {
  const provider: ProviderSpec = {
    ...MM_INTL_PROVIDER,
    pricingRoute: "minimax-international-direct-payg",
  };
  const r = asCalcUnavail(
    resolveAttemptOfficialCost(provider, usage(100, 50, 20, 30)),
    "per-request-usage-required",
  );
  // cache-creation is positive but unpublished → no bounded estimate
  assert.equal(r.result.boundedEstimate, undefined);
});

test("DeepSeek single-tier: no bounded estimate on unavailable result", () => {
  const r = asQuoted(resolveAttemptOfficialCost(DS_PRO_PROVIDER, usage(1, 0, 0, 0)));
  assert.equal("boundedEstimate" in r.result, false);
});

test("MiniMax with rows: quoted result carries no bounded estimate", () => {
  const provider: ProviderSpec = {
    ...MM_INTL_PROVIDER,
    pricingRoute: "minimax-international-direct-payg",
  };
  const r = asQuoted(resolveAttemptOfficialCost(provider, usage(512_000 + 512_001, 0, 0, 0),
    [row(512_000, 0, 0, 0), row(512_001, 0, 0, 0)]));
  assert.equal(r.quoted, true);
});

test("bounded estimate is deeply frozen in calc-unavailable result", () => {
  const provider: ProviderSpec = {
    ...MM_INTL_PROVIDER,
    pricingRoute: "minimax-international-direct-payg",
  };
  const r = asCalcUnavail(
    resolveAttemptOfficialCost(provider, usage(100_000, 50_000, 0, 0)),
    "per-request-usage-required",
  );
  assert.ok(r.result.boundedEstimate !== undefined);
  assertDeepFrozen(r.result.boundedEstimate!);
  assert.throws(() => { (r.result.boundedEstimate as { min: number }).min = 0; }, TypeError);
});
