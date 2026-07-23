// Attempt economics — compose pricing identity resolution and native-currency
// calculation into detached, deeply frozen official-cost evidence for every
// terminal Attempt.  No FX, no invoice claim, no route inference, no aggregate
// tier guessing.

import type { PricingMatchRequest } from "./pricing.js";
import { resolveOfficialPricing } from "./pricing.js";
import type { RequestTokenUsage } from "./pricing-calculator.js";
import { calculateOfficialCost } from "./pricing-calculator.js";
import type {
  AttemptOfficialCost,
  AttemptTokenUsage,
  ProviderSpec,
} from "./types.js";

// --- Immutability ----------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    if (!Object.isFrozen(value)) {
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
    }
  }
  return value;
}

// --- Public API ------------------------------------------------------------

/**
 * Resolve official-cost evidence for one terminal Attempt.
 *
 * Proceeds through three stages:
 *   1. usage       — terminal Token counters must be present
 *   2. pricing-identity — official catalog entry must be resolvable
 *   3. calculation — native-currency cost must be computable
 *
 * Returns detached, deeply frozen evidence.  The caller's inputs are never
 * mutated or frozen.
 */
export function resolveAttemptOfficialCost(
  provider: ProviderSpec,
  usage?: AttemptTokenUsage,
  requestRows?: readonly RequestTokenUsage[],
): AttemptOfficialCost {
  // Stage 1 — usage
  if (usage === undefined || usage === null) {
    return deepFreeze({ stage: "usage", quoted: false as const, reason: "usage-missing" });
  }

  // Stage 1b — service tier
  if (usage.serviceTier === undefined || usage.serviceTier === "") {
    return deepFreeze({ stage: "usage", quoted: false as const, reason: "service-tier-missing" });
  }

  // Stage 2 — pricing identity
  const matchRequest: PricingMatchRequest = {
    provider: provider.name,
    endpoint: provider.endpoint ?? "",
    modelAlias: provider.model,
    serviceTier: usage.serviceTier,
    ...(provider.pricingRoute === undefined ? {} : { route: provider.pricingRoute }),
  };

  const pricingResult = resolveOfficialPricing(matchRequest);
  if (!pricingResult.matched) {
    return deepFreeze({
      stage: "pricing-identity",
      quoted: false as const,
      reason: pricingResult.reason,
    });
  }

  // Stage 3 — calculation; the calculator returns detached frozen results.
  const quote = calculateOfficialCost(pricingResult.entry, usage, requestRows);
  if (!quote.quoted) {
    return deepFreeze({
      stage: "calculation",
      quoted: false as const,
      result: quote,
    });
  }

  return deepFreeze({
    stage: "calculation" as const,
    quoted: true as const,
    result: quote,
  });
}
