// Read-only, evidence-aware model routing. This module scores only comparable
// historical evidence; it never starts work, changes settings, or excludes a
// model permanently.

import {
  failureImpactForCategory,
  type FailureCategory,
  type RoutingEvidence,
} from "./statistics.js";

export type FailureImpact = "model-quality" | "non-model" | "ambiguous";

export function failureImpactFor(category: FailureCategory): FailureImpact {
  return failureImpactForCategory(category);
}

export const MODEL_QUALITY_CATEGORIES = new Set<FailureCategory>(["verification"]);
export const NON_MODEL_CATEGORIES = new Set<FailureCategory>([
  "credential", "interruption", "workspace", "budget", "provider",
]);
export const AMBIGUOUS_CATEGORIES = new Set<FailureCategory>(["noProgress", "unclassified"]);

export interface RoutingWeightSettings {
  acceptedDelivery: number;
  verifiedBehavior: number;
  modelQualityFailure: number;
  correctionChurn: number;
  officialCost: number;
  duration: number;
  /** 0 by default — affects advice only after explicit opt-in and only when
   *  every candidate has bounded, same-envelope samples under the same
   *  frozen budget cap. */
  budgetReliability: number;
}

export type MissingEvidenceMode = "strict" | "flexible";

export interface RoutingPolicySettings {
  minRelevantSamples: number;
  /** Minimum normalized score gap required for a recommendation, in [0, 1]. */
  uncertaintyThreshold: number;
  competitionOnUncertainty: boolean;
  /** Strict blocks on any enabled-but-unavailable factor. Flexible ranks only
   * comparable evidence and reports the omitted factors as warnings. */
  missingEvidenceMode: MissingEvidenceMode;
  weights: RoutingWeightSettings;
}

export const DEFAULT_ROUTING_POLICY: RoutingPolicySettings = {
  minRelevantSamples: 5,
  uncertaintyThreshold: 0.15,
  competitionOnUncertainty: true,
  missingEvidenceMode: "flexible",
  weights: {
    acceptedDelivery: 1,
    verifiedBehavior: 1,
    modelQualityFailure: 0.5,
    correctionChurn: 0.2,
    officialCost: 0,
    duration: 0,
    budgetReliability: 0,
  },
};

export type RoutingFactorName =
  | "acceptedDelivery"
  | "verifiedBehavior"
  | "modelQualityFailure"
  | "correctionChurn"
  | "officialCost"
  | "duration"
  | "budgetReliability";

export type RoutingFactorUnavailableReason =
  | "weight-zero"
  | "insufficient-relevant-samples"
  | "comparison-samples-incomplete"
  | "verified-behavior-coverage-incomplete"
  | "official-cost-missing"
  | "official-cost-incomplete"
  | "official-cost-mixed-currency"
  | "official-cost-currency-mismatch"
  | "duration-coverage-incomplete"
  | "budget-reliability-missing-bounded-evidence"
  | "budget-reliability-mixed-envelope-candidate"
  | "budget-reliability-mixed-envelope-cross-candidate"
  | "budget-reliability-coverage-incomplete";

export interface RoutingFactorResult {
  factor: RoutingFactorName;
  weight: number;
  available: boolean;
  unavailableReason?: RoutingFactorUnavailableReason;
  rawValue?: number;
  normalizedScore: number;
  weightedScore: number;
}

export type RoutingUncertaintyReason =
  | "insufficient-relevant-samples"
  | "positive-factor-unavailable"
  | "score-gap-too-small"
  | "no-active-factors";

export interface RoutingCandidateResult {
  provider: string;
  model: string;
  /** Historical failure never permanently removes a candidate. */
  eligible: true;
  evidence: RoutingEvidence;
  factors: RoutingFactorResult[];
  totalScore: number;
  uncertainty: {
    insufficientSamples: boolean;
    insufficientGap: boolean;
    incompatibleCost: boolean;
    incompatibleCurrency: boolean;
    reasons: RoutingUncertaintyReason[];
  };
}

export interface RoutingRecommendation {
  provider: string;
  model: string;
  confidence: number;
  reasoning: string;
}

export interface RoutingAdvisoryResponse {
  taskClass: string;
  candidates: RoutingCandidateResult[];
  recommendation?: RoutingRecommendation;
  shouldRunCompetition: boolean;
  resolvedPolicy: RoutingPolicySettings;
  /** Enabled factors excluded for every candidate because evidence was not comparable. */
  omittedFactors: Array<{
    factor: RoutingFactorName;
    reason: RoutingFactorUnavailableReason;
  }>;
}

interface FactorPlan {
  name: RoutingFactorName;
  weight: number;
  available: boolean;
  reason?: RoutingFactorUnavailableReason;
  values: number[];
  /** Lower values are better for failure, churn, cost, and duration. */
  lowerIsBetter: boolean;
}

function normalized(value: number, values: number[], lowerIsBetter: boolean): number {
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (high === low) return 1;
  return lowerIsBetter ? (high - value) / (high - low) : (value - low) / (high - low);
}

function disabledPlan(name: RoutingFactorName): FactorPlan {
  return { name, weight: 0, available: false, reason: "weight-zero", values: [], lowerIsBetter: false };
}

function basePlan(
  name: RoutingFactorName,
  weight: number,
  values: number[],
  allSufficient: boolean,
  lowerIsBetter: boolean,
): FactorPlan {
  if (weight === 0) return disabledPlan(name);
  if (!allSufficient) {
    return {
      name, weight, available: false, reason: "comparison-samples-incomplete",
      values, lowerIsBetter,
    };
  }
  return { name, weight, available: true, values, lowerIsBetter };
}

function exactCost(evidence: RoutingEvidence): { currency: string; averagePerTask: number } | RoutingFactorUnavailableReason {
  if (evidence.officialCostAttemptCount === 0 || evidence.officialCostByCurrency.length === 0) {
    return "official-cost-missing";
  }
  if (
    evidence.officialCostUnavailableCount > 0
    || evidence.officialCostQuotedAttemptCount !== evidence.officialCostAttemptCount
  ) {
    return "official-cost-incomplete";
  }
  if (evidence.officialCostByCurrency.length !== 1) return "official-cost-mixed-currency";
  const group = evidence.officialCostByCurrency[0]!;
  if (group.quotedAttemptCount !== evidence.officialCostAttemptCount) {
    return "official-cost-incomplete";
  }
  return {
    currency: group.currency,
    averagePerTask: group.totalQuotedCost / evidence.relevantSampleCount,
  };
}

function costPlan(weight: number, evidence: RoutingEvidence[], allSufficient: boolean): FactorPlan {
  if (weight === 0) return disabledPlan("officialCost");
  if (!allSufficient) {
    return {
      name: "officialCost", weight, available: false,
      reason: "comparison-samples-incomplete", values: [], lowerIsBetter: true,
    };
  }
  const exact = evidence.map(exactCost);
  const firstFailure = exact.find((item): item is RoutingFactorUnavailableReason => typeof item === "string");
  if (firstFailure !== undefined) {
    return {
      name: "officialCost", weight, available: false,
      reason: firstFailure, values: [], lowerIsBetter: true,
    };
  }
  const typed = exact as Array<{ currency: string; averagePerTask: number }>;
  if (new Set(typed.map((item) => item.currency)).size !== 1) {
    return {
      name: "officialCost", weight, available: false,
      reason: "official-cost-currency-mismatch", values: [], lowerIsBetter: true,
    };
  }
  return {
    name: "officialCost", weight, available: true,
    values: typed.map((item) => item.averagePerTask), lowerIsBetter: true,
  };
}

function durationPlan(weight: number, evidence: RoutingEvidence[], allSufficient: boolean): FactorPlan {
  if (weight === 0) return disabledPlan("duration");
  const complete = allSufficient && evidence.every(
    (item) => item.durationSampleCount === item.relevantSampleCount && item.avgDurationMs !== undefined,
  );
  if (!complete) {
    return {
      name: "duration", weight, available: false,
      reason: allSufficient ? "duration-coverage-incomplete" : "comparison-samples-incomplete",
      values: [], lowerIsBetter: true,
    };
  }
  return {
    name: "duration", weight, available: true,
    values: evidence.map((item) => item.avgDurationMs!), lowerIsBetter: true,
  };
}

function behaviorPlan(weight: number, evidence: RoutingEvidence[], allSufficient: boolean): FactorPlan {
  if (weight === 0) return disabledPlan("verifiedBehavior");
  const complete = allSufficient && evidence.every(
    (item) => item.verifiedBehaviorSampleCount === item.relevantSampleCount,
  );
  if (!complete) {
    return {
      name: "verifiedBehavior", weight, available: false,
      reason: allSufficient ? "verified-behavior-coverage-incomplete" : "comparison-samples-incomplete",
      values: [], lowerIsBetter: false,
    };
  }
  return {
    name: "verifiedBehavior", weight, available: true,
    values: evidence.map((item) => item.verifiedBehaviorRate), lowerIsBetter: false,
  };
}

/** Decide the budgetReliability factor for the candidate set.
 *  Higher completion-without-budget-exhaustion rate is better.
 *  Rejects the candidate set with stable reasons whenever evidence is not
 *  comparable (uncapped, mixed envelopes within one candidate, or mismatched
 *  envelopes across candidates). Never synthesizes zero. */
function budgetReliabilityPlan(
  weight: number,
  evidence: RoutingEvidence[],
  allSufficient: boolean,
  minRelevantSamples: number,
): FactorPlan {
  if (weight === 0) return disabledPlan("budgetReliability");
  // Stage 1: per-candidate, distinguish missing bounded evidence from mixed
  // envelopes. A bounded sample count of zero means the candidate has no
  // bounded Tasks (everything was uncapped or legacy). A null envelope while
  // boundedSampleCount > 0 means the bounded samples disagreed on their envelope.
  for (const item of evidence) {
    if (item.budgetReliability.boundedSampleCount === 0) {
      return {
        name: "budgetReliability", weight, available: false,
        reason: "budget-reliability-missing-bounded-evidence",
        values: [], lowerIsBetter: false,
      };
    }
    if (item.budgetReliability.envelope === null) {
      return {
        name: "budgetReliability", weight, available: false,
        reason: "budget-reliability-mixed-envelope-candidate",
        values: [], lowerIsBetter: false,
      };
    }
  }
  // Stage 2: every scored candidate must use one identical frozen envelope.
  const envelopes = new Set<string>();
  for (const item of evidence) {
    const env = item.budgetReliability.envelope!;
    envelopes.add(`${env.runtimeBudgetUsd ?? "_"}\0${env.observedTokenCeiling ?? "_"}`);
  }
  if (envelopes.size !== 1) {
    return {
      name: "budgetReliability", weight, available: false,
      reason: "budget-reliability-mixed-envelope-cross-candidate",
      values: [], lowerIsBetter: false,
    };
  }
  // Stage 3: bounded sample count must satisfy its own coverage gate per
  // candidate. This is additive to the general sample-sufficiency check.
  const boundedSufficient = evidence.every(
    (item) => item.budgetReliability.boundedSampleCount >= minRelevantSamples,
  );
  if (!allSufficient || !boundedSufficient) {
    return {
      name: "budgetReliability", weight, available: false,
      reason: allSufficient
        ? "budget-reliability-coverage-incomplete"
        : "comparison-samples-incomplete",
      values: [], lowerIsBetter: false,
    };
  }
  return {
    name: "budgetReliability", weight, available: true,
    values: evidence.map((item) => item.budgetReliability.completedWithoutExhaustionRate as number),
    lowerIsBetter: false,
  };
}

function factorResult(plan: FactorPlan, index: number): RoutingFactorResult {
  if (!plan.available) {
    return {
      factor: plan.name,
      weight: plan.weight,
      available: false,
      ...(plan.reason === undefined ? {} : { unavailableReason: plan.reason }),
      normalizedScore: 0,
      weightedScore: 0,
    };
  }
  const rawValue = plan.values[index]!;
  const normalizedScore = normalized(rawValue, plan.values, plan.lowerIsBetter);
  return {
    factor: plan.name,
    weight: plan.weight,
    available: true,
    rawValue,
    normalizedScore,
    weightedScore: normalizedScore * plan.weight,
  };
}

function zeroEvidence(provider: string, model: string): RoutingEvidence {
  return {
    provider,
    model,
    terminalTaskCount: 0,
    relevantSampleCount: 0,
    modelQualityFailureCount: 0,
    modelQualityFailureRate: 0,
    ignoredNonModelFailures: {},
    ignoredNonModelTaskCount: 0,
    ambiguousFailureCount: 0,
    correctionChurn: 0,
    correctionChurnRate: 0,
    acceptedDeliveryCount: 0,
    acceptedDeliveryRate: 0,
    verifiedBehaviorSampleCount: 0,
    verifiedBehaviorCount: 0,
    verifiedBehaviorRate: 0,
    officialCostAttemptCount: 0,
    officialCostQuotedAttemptCount: 0,
    officialCostUnavailableCount: 0,
    officialCostUnavailableReasons: {},
    officialCostByCurrency: [],
    durationSampleCount: 0,
    budgetReliability: {
      boundedSampleCount: 0,
      completedWithoutExhaustionCount: 0,
      completedWithoutExhaustionRate: null,
      budgetExhaustionCount: 0,
      excludedUncappedCount: 0,
      excludedUnknownEnforcementCount: 0,
      excludedExternalFailureCount: 0,
      envelope: null,
    },
  };
}

export interface ProvideRoutingAdviceInput {
  taskClass: string;
  candidates: Array<{ provider: string; model: string }>;
  evidenceMap: Map<string, RoutingEvidence>;
  policy: RoutingPolicySettings;
}

export function provideRoutingAdvice(input: ProvideRoutingAdviceInput): RoutingAdvisoryResponse {
  if (input.candidates.length < 2) {
    throw new Error("Routing advice requires at least two provider/model candidates");
  }
  const evidence = input.candidates.map((candidate) =>
    input.evidenceMap.get(`${candidate.provider}\0${candidate.model}`)
      ?? zeroEvidence(candidate.provider, candidate.model));
  const allSufficient = evidence.every(
    (item) => item.relevantSampleCount >= input.policy.minRelevantSamples,
  );
  const plans: FactorPlan[] = [
    basePlan(
      "acceptedDelivery", input.policy.weights.acceptedDelivery,
      evidence.map((item) => item.acceptedDeliveryRate), allSufficient, false,
    ),
    behaviorPlan(input.policy.weights.verifiedBehavior, evidence, allSufficient),
    basePlan(
      "modelQualityFailure", input.policy.weights.modelQualityFailure,
      evidence.map((item) => item.modelQualityFailureRate), allSufficient, true,
    ),
    basePlan(
      "correctionChurn", input.policy.weights.correctionChurn,
      evidence.map((item) => item.correctionChurnRate), allSufficient, true,
    ),
    costPlan(input.policy.weights.officialCost, evidence, allSufficient),
    durationPlan(input.policy.weights.duration, evidence, allSufficient),
    budgetReliabilityPlan(
      input.policy.weights.budgetReliability, evidence, allSufficient,
      input.policy.minRelevantSamples,
    ),
  ];

  const positiveUnavailable = plans.some((plan) => plan.weight > 0 && !plan.available);
  const omittedFactors = plans
    .filter((plan) => plan.weight > 0 && !plan.available)
    .map((plan) => ({
      factor: plan.name,
      reason: plan.reason!,
    }));
  const activeWeight = plans.reduce(
    (sum, plan) => sum + (plan.available ? plan.weight : 0),
    0,
  );
  const results: RoutingCandidateResult[] = evidence.map((item, index) => {
    const factors = plans.map((plan) => factorResult(plan, index));
    const reasons: RoutingUncertaintyReason[] = [];
    if (item.relevantSampleCount < input.policy.minRelevantSamples) {
      reasons.push("insufficient-relevant-samples");
    }
    if (input.policy.missingEvidenceMode === "strict" && positiveUnavailable) {
      reasons.push("positive-factor-unavailable");
    }
    if (activeWeight === 0) reasons.push("no-active-factors");
    const cost = factors.find((factor) => factor.factor === "officialCost")!;
    return {
      provider: item.provider,
      model: item.model,
      eligible: true,
      evidence: item,
      factors,
      totalScore: factors.reduce((sum, factor) => sum + factor.weightedScore, 0),
      uncertainty: {
        insufficientSamples: item.relevantSampleCount < input.policy.minRelevantSamples,
        insufficientGap: false,
        incompatibleCost: cost.weight > 0 && !cost.available,
        incompatibleCurrency: cost.unavailableReason === "official-cost-mixed-currency"
          || cost.unavailableReason === "official-cost-currency-mismatch",
        reasons,
      },
    };
  });
  results.sort((left, right) => right.totalScore - left.totalScore
    || left.provider.localeCompare(right.provider)
    || left.model.localeCompare(right.model));

  const gap = results[0]!.totalScore - results[1]!.totalScore;
  const gapRatio = activeWeight > 0 ? gap / activeWeight : 0;
  const insufficientGap = gapRatio <= input.policy.uncertaintyThreshold;
  if (insufficientGap) {
    for (const result of results) {
      result.uncertainty.insufficientGap = true;
      result.uncertainty.reasons.push("score-gap-too-small");
    }
  }

  const uncertain = !allSufficient
    || (input.policy.missingEvidenceMode === "strict" && positiveUnavailable)
    || activeWeight === 0
    || insufficientGap;
  const top = results[0]!;
  const recommendation = uncertain
    ? undefined
    : {
        provider: top.provider,
        model: top.model,
        confidence: Math.max(0, Math.min(1, gapRatio)),
        reasoning: `clear-score-gap:${gapRatio.toFixed(4)};relevant-samples:${top.evidence.relevantSampleCount}`,
      };
  const resolvedPolicy: RoutingPolicySettings = {
    ...input.policy,
    weights: { ...input.policy.weights },
  };
  return {
    taskClass: input.taskClass,
    candidates: results,
    ...(recommendation === undefined ? {} : { recommendation }),
    shouldRunCompetition: uncertain && input.policy.competitionOnUncertainty,
    resolvedPolicy,
    omittedFactors,
  };
}
