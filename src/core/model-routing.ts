// Read-only, evidence-aware model routing. This module scores only comparable
// historical evidence; it never starts work, changes settings, or excludes a
// model permanently.

import {
  failureImpactForCategory,
  type FailureCategory,
  type RoutingEvidence,
} from "./statistics.js";
import type { FrozenWorkerIdentity } from "./types.js";

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
  /** Default 0.5 — prefers Workers that pass independent checks on Attempt one.
   *  Omitted when comparable first-pass coverage is incomplete. */
  firstPassSuccess: number;
  officialCost: number;
  duration: number;
  /** 0 by default — affects advice only after explicit opt-in and only when
   *  every candidate has bounded, same-envelope samples under the same
   *  frozen budget cap. */
  budgetReliability: number;
}

export type MissingEvidenceMode = "strict" | "flexible";
export type EvidenceScope = "exact-class" | "task-family" | "none";
export type CompetitionTrigger = "critical" | "multiple-plausible-solutions" | "new-family" | "user-requested";
export type CompetitionIntent = "none" | "consider" | "required";

/** Reason code for Main's worker selection. */
export type SelectionReasonCode =
  | "relevant-delivery"
  | "runtime-capability"
  | "user-specified"
  | "only-available"
  | "main-judgment";

export interface RoutingPolicySettings {
  minRelevantSamples: number;
  /** Minimum relevant samples per candidate for family-scope evidence. */
  familyMinRelevantSamples: number;
  /** Minimum normalized score gap required for a recommendation, in [0, 1]. */
  uncertaintyThreshold: number;
  /** Compatibility master switch — alone never sufficient for Competition. */
  competitionOnUncertainty: boolean;
  /** Which triggers are enabled for consider intent. */
  competitionTriggersEnabled: CompetitionTrigger[];
  /** Default candidate count when Competition is advised. */
  defaultCompetitionCandidates: number;
  /** Strict blocks on any enabled-but-unavailable factor. Flexible ranks only
   * comparable evidence and reports the omitted factors as warnings. */
  missingEvidenceMode: MissingEvidenceMode;
  weights: RoutingWeightSettings;
}

export const DEFAULT_TRIGGERS_ENABLED: CompetitionTrigger[] = [];
export const DEFAULT_COMPETITION_CANDIDATES = 2;

export const DEFAULT_ROUTING_POLICY: RoutingPolicySettings = {
  minRelevantSamples: 5,
  familyMinRelevantSamples: 5,
  uncertaintyThreshold: 0.15,
  competitionOnUncertainty: true,
  competitionTriggersEnabled: [...DEFAULT_TRIGGERS_ENABLED],
  defaultCompetitionCandidates: DEFAULT_COMPETITION_CANDIDATES,
  missingEvidenceMode: "flexible",
  weights: {
    acceptedDelivery: 1,
    verifiedBehavior: 1,
    modelQualityFailure: 0.5,
    correctionChurn: 0.2,
    firstPassSuccess: 0.5,
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
  | "firstPassSuccess"
  | "officialCost"
  | "duration"
  | "budgetReliability";

export type RoutingFactorUnavailableReason =
  | "weight-zero"
  | "insufficient-relevant-samples"
  | "comparison-samples-incomplete"
  | "verified-behavior-coverage-incomplete"
  | "first-pass-success-coverage-incomplete"
  | "accepted-delivery-coverage-incomplete"
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

// Re-export the canonical FrozenWorkerIdentity from types.ts so consumers
// get the same type without importing from two places.
export type { FrozenWorkerIdentity } from "./types.js";

/** Compact per-candidate sample counts for explainability only.
 *  Bound by candidate identity before sorting; never used for scoring. */
export interface RoutingSampleCoverage {
  /** Exact task-type finished Tasks for this candidate. */
  exactTerminalCount: number;
  /** Exact task-type usable (relevant) records for this candidate. */
  exactRelevantCount: number;
  /** Policy minimum before exact-type comparison is ready. */
  exactMinRelevantSamples: number;
  /** Broader-category finished Tasks when a task family was supplied. */
  familyTerminalCount?: number;
  /** Broader-category usable records when a task family was supplied. */
  familyRelevantCount?: number;
  /** Policy minimum before broader-category comparison is ready. */
  familyMinRelevantSamples?: number;
}

export interface RoutingCandidateResult {
  provider: string;
  model: string;
  /** Runtime and effort from the Worker identity, when available.
   *  Legacy provider/model-only input omits these. */
  runtime?: string;
  effort?: string;
  /** Historical failure never permanently removes a candidate. */
  eligible: true;
  evidence: RoutingEvidence;
  /** Identity-bound exact/family sample counts for truthful missing-evidence UI. */
  sampleCoverage: RoutingSampleCoverage;
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

/** Knowledge state: recommendation when evidence supports a clear best;
 *  unknown when evidence cannot separate candidates. */
export type RoutingKnowledge = "recommendation" | "unknown";

/** Competition advice derived from intent + triggers + settings, not uncertainty. */
export interface CompetitionAdvisory {
  /** Whether Competition is advised under the current policy. */
  shouldRunCompetition: boolean;
  /** Intent from Main's decision snapshot. */
  intent: CompetitionIntent;
  /** Triggers that were evaluated. */
  evaluatedTriggers: CompetitionTrigger[];
  /** Triggers that were enabled by settings and matched Main's intent. */
  matchingTriggers: CompetitionTrigger[];
  /** Suggested candidate count when Competition is advised. */
  suggestedCandidates: number;
}

export interface RoutingAdvisoryResponse {
  taskClass: string;
  /** Optional taskFamily used for evidence when exact-class was insufficient. */
  taskFamily?: string;
  /** Which evidence scope was used for comparison. */
  evidenceScope: EvidenceScope;
  /** Knowledge state: recommendation or unknown. */
  knowledge: RoutingKnowledge;
  candidates: RoutingCandidateResult[];
  recommendation?: RoutingRecommendation;
  /** Competition advice separated from evidence uncertainty. */
  competition: CompetitionAdvisory;
  /** Legacy: kept for backward compatibility with existing consumers. */
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

/**
 * Main/delivery-backed accepted final delivery. Higher accepted rate is better.
 * Participates only when every candidate has enough comparable final-delivery
 * samples (accepted + not-accepted). Machine success without Main/delivery
 * evidence stays unavailable and never becomes a model score.
 */
function acceptedDeliveryPlan(
  weight: number,
  evidence: RoutingEvidence[],
  allSufficient: boolean,
  minRelevantSamples: number,
): FactorPlan {
  if (weight === 0) return disabledPlan("acceptedDelivery");
  const complete = allSufficient && evidence.every(
    (item) => item.acceptedDeliverySampleCount >= minRelevantSamples,
  );
  if (!complete) {
    return {
      name: "acceptedDelivery", weight, available: false,
      reason: allSufficient
        ? "accepted-delivery-coverage-incomplete"
        : "comparison-samples-incomplete",
      values: [], lowerIsBetter: false,
    };
  }
  return {
    name: "acceptedDelivery", weight, available: true,
    values: evidence.map((item) => item.acceptedDeliveryRate),
    lowerIsBetter: false,
  };
}

/** First-pass verified success: higher Attempt-one pass rate is better.
 *  Participates only when every candidate has enough comparable first-pass
 *  samples. Missing or external outcomes never become synthetic zeros. */
function firstPassSuccessPlan(
  weight: number,
  evidence: RoutingEvidence[],
  allSufficient: boolean,
  minRelevantSamples: number,
): FactorPlan {
  if (weight === 0) return disabledPlan("firstPassSuccess");
  const complete = allSufficient && evidence.every(
    (item) => item.firstPassVerifiedSampleCount >= minRelevantSamples,
  );
  if (!complete) {
    return {
      name: "firstPassSuccess", weight, available: false,
      reason: allSufficient
        ? "first-pass-success-coverage-incomplete"
        : "comparison-samples-incomplete",
      values: [], lowerIsBetter: false,
    };
  }
  return {
    name: "firstPassSuccess", weight, available: true,
    values: evidence.map((item) => item.firstPassVerifiedSuccessRate),
    lowerIsBetter: false,
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
    acceptedDeliverySampleCount: 0,
    acceptedDeliveryNotAcceptedCount: 0,
    acceptedDeliveryUnavailableCount: 0,
    acceptedDeliveryRate: 0,
    verifiedBehaviorSampleCount: 0,
    verifiedBehaviorCount: 0,
    verifiedBehaviorRate: 0,
    firstPassVerifiedSampleCount: 0,
    firstPassVerifiedSuccessCount: 0,
    firstPassVerifiedSuccessRate: 0,
    firstPassUnavailableCount: 0,
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

/** Stable comparison key. New routing decisions use the complete frozen Worker
 * identity; provider/model-only keys remain an explicit legacy mode. */
export function routingIdentityKey(
  candidate: Pick<FrozenWorkerIdentity, "provider" | "model"> &
    Partial<Pick<FrozenWorkerIdentity, "runtime" | "effort">>,
): string {
  const base = `${candidate.provider}\0${candidate.model}`;
  return candidate.runtime !== undefined && candidate.effort !== undefined
    ? `${base}\0${candidate.runtime}\0${candidate.effort}`
    : base;
}

function candidateKeys(
  candidates: Array<{ provider: string; model: string; runtime?: string; effort?: string }>,
): string[] {
  return candidates.map(routingIdentityKey);
}

export interface ProvideRoutingAdviceInput {
  taskClass: string;
  /** Optional taskFamily for evidence fallback. */
  taskFamily?: string;
  /** Candidates to compare. Runtime and effort are optional — legacy
   *  provider/model input omits them and evidence is keyed by provider/model. */
  candidates: Array<{ provider: string; model: string; runtime?: string; effort?: string }>;
  /** Exact-class evidence map keyed by provider\0model. */
  evidenceMap: Map<string, RoutingEvidence>;
  /** Optional family-scope evidence map keyed by provider\0model. */
  familyEvidenceMap?: Map<string, RoutingEvidence>;
  policy: RoutingPolicySettings;
  /** Main's Competition intent from the routing decision. */
  competitionIntent?: CompetitionIntent;
  /** Main's Competition triggers from the routing decision. */
  competitionTriggers?: CompetitionTrigger[];
}

/** Resolve the comparable evidence scope: exact-class, task-family, or none.
 *  Every candidate must meet the threshold for a scope to be used. */
function resolveEvidenceScope(
  evidence: RoutingEvidence[],
  familyEvidence: RoutingEvidence[] | undefined,
  policy: RoutingPolicySettings,
): EvidenceScope {
  const exactSufficient = evidence.every(
    (item) => item.relevantSampleCount >= policy.minRelevantSamples,
  );
  if (exactSufficient) return "exact-class";

  if (familyEvidence !== undefined && familyEvidence.length === evidence.length) {
    const familySufficient = familyEvidence.every(
      (item) => item.relevantSampleCount >= policy.familyMinRelevantSamples,
    );
    if (familySufficient) return "task-family";
  }

  return "none";
}

/** Determine whether Competition should be advised based on Main's intent,
 *  enabled triggers, the compatibility switch, and evidence context.
 *  Evidence uncertainty alone never authorizes Competition. */
function evaluateCompetitionAdvice(
  intent: CompetitionIntent | undefined,
  triggers: CompetitionTrigger[] | undefined,
  policy: RoutingPolicySettings,
  familyEvidenceAvailable: boolean,
): CompetitionAdvisory {
  const evaluatedTriggers = triggers ?? [];
  const enabledTriggers = policy.competitionTriggersEnabled;

  if (intent === "required") {
    // Required always suggests competition regardless of triggers/settings.
    return {
      shouldRunCompetition: true,
      intent: "required",
      evaluatedTriggers,
      matchingTriggers: evaluatedTriggers.filter((t) => enabledTriggers.includes(t)),
      suggestedCandidates: policy.defaultCompetitionCandidates,
    };
  }

  if (intent === "consider") {
    // Compatibility switch must be enabled for consider to produce advice.
    if (!policy.competitionOnUncertainty) {
      return {
        shouldRunCompetition: false,
        intent: "consider",
        evaluatedTriggers,
        matchingTriggers: [],
        suggestedCandidates: 0,
      };
    }
    // new-family trigger requires genuinely missing family evidence.
    const effectiveTriggers = evaluatedTriggers.filter((t) => {
      if (!enabledTriggers.includes(t)) return false;
      if (t === "new-family" && familyEvidenceAvailable) return false;
      return true;
    });
    const matchingTriggers = effectiveTriggers;
    if (matchingTriggers.length > 0) {
      return {
        shouldRunCompetition: true,
        intent: "consider",
        evaluatedTriggers,
        matchingTriggers,
        suggestedCandidates: policy.defaultCompetitionCandidates,
      };
    }
  }

  // None or consider with no matching triggers — no competition advice.
  return {
    shouldRunCompetition: false,
    intent: intent ?? "none",
    evaluatedTriggers,
    matchingTriggers: [],
    suggestedCandidates: 0,
  };
}

export function provideRoutingAdvice(input: ProvideRoutingAdviceInput): RoutingAdvisoryResponse {
  if (input.candidates.length < 2) {
    throw new Error("Routing advice requires at least two provider/model candidates");
  }
  const keys = candidateKeys(input.candidates);
  // Preserve the candidate's real provider/model on zero-history rows. Full
  // Worker identity keys are four-part; never compare them to provider\0model.
  const evidence = keys.map((key, index) => {
    const candidate = input.candidates[index]!;
    return input.evidenceMap.get(key)
      ?? zeroEvidence(candidate.provider, candidate.model);
  });

  const familyEvidence = input.familyEvidenceMap
    ? keys.map((key, index) => {
        const candidate = input.candidates[index]!;
        return input.familyEvidenceMap!.get(key)
          ?? zeroEvidence(candidate.provider, candidate.model);
      })
    : undefined;

  const evidenceScope = resolveEvidenceScope(evidence, familyEvidence, input.policy);

  // Use the evidence from the resolved scope for scoring.
  const scoringEvidence = evidenceScope === "task-family" && familyEvidence
    ? familyEvidence
    : evidence;

  const allSufficient = evidenceScope !== "none";
  const plans: FactorPlan[] = [
    acceptedDeliveryPlan(
      input.policy.weights.acceptedDelivery, scoringEvidence, allSufficient,
      input.policy.minRelevantSamples,
    ),
    behaviorPlan(input.policy.weights.verifiedBehavior, scoringEvidence, allSufficient),
    basePlan(
      "modelQualityFailure", input.policy.weights.modelQualityFailure,
      scoringEvidence.map((item) => item.modelQualityFailureRate), allSufficient, true,
    ),
    basePlan(
      "correctionChurn", input.policy.weights.correctionChurn,
      scoringEvidence.map((item) => item.correctionChurnRate), allSufficient, true,
    ),
    firstPassSuccessPlan(
      input.policy.weights.firstPassSuccess, scoringEvidence, allSufficient,
      input.policy.minRelevantSamples,
    ),
    costPlan(input.policy.weights.officialCost, scoringEvidence, allSufficient),
    durationPlan(input.policy.weights.duration, scoringEvidence, allSufficient),
    budgetReliabilityPlan(
      input.policy.weights.budgetReliability, scoringEvidence, allSufficient,
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
  // Snapshot coverage by the same identity index used for evidence lookup so
  // later score/alphabetical sorting cannot reattach one model's counts to another.
  const results: RoutingCandidateResult[] = evidence.map((item, index) => {
    const factors = plans.map((plan) => factorResult(plan, index));
    const reasons: RoutingUncertaintyReason[] = [];
    if (evidenceScope === "none") {
      reasons.push("insufficient-relevant-samples");
    }
    if (input.policy.missingEvidenceMode === "strict" && positiveUnavailable) {
      reasons.push("positive-factor-unavailable");
    }
    if (activeWeight === 0) reasons.push("no-active-factors");
    const cost = factors.find((factor) => factor.factor === "officialCost")!;
    const candidate = input.candidates[index];
    const familyItem = familyEvidence?.[index];
    const sampleCoverage: RoutingSampleCoverage = {
      exactTerminalCount: item.terminalTaskCount,
      exactRelevantCount: item.relevantSampleCount,
      exactMinRelevantSamples: input.policy.minRelevantSamples,
      ...(familyItem === undefined
        ? {}
        : {
            familyTerminalCount: familyItem.terminalTaskCount,
            familyRelevantCount: familyItem.relevantSampleCount,
            familyMinRelevantSamples: input.policy.familyMinRelevantSamples,
          }),
    };
    return {
      provider: item.provider,
      model: item.model,
      ...(candidate?.runtime !== undefined ? { runtime: candidate.runtime } : {}),
      ...(candidate?.effort !== undefined ? { effort: candidate.effort } : {}),
      eligible: true,
      evidence: item,
      sampleCoverage,
      factors,
      totalScore: factors.reduce((sum, factor) => sum + factor.weightedScore, 0),
      uncertainty: {
        insufficientSamples: evidenceScope === "none",
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
  if (insufficientGap && evidenceScope !== "none") {
    for (const result of results) {
      result.uncertainty.insufficientGap = true;
      if (!result.uncertainty.reasons.includes("score-gap-too-small")) {
        result.uncertainty.reasons.push("score-gap-too-small");
      }
    }
  }

  const knowledge: RoutingKnowledge = (evidenceScope !== "none" && !insufficientGap
    && !(input.policy.missingEvidenceMode === "strict" && positiveUnavailable)
    && activeWeight > 0)
    ? "recommendation"
    : "unknown";

  const top = results[0]!;
  const recommendation = knowledge === "recommendation"
    ? {
        provider: top.provider,
        model: top.model,
        confidence: Math.max(0, Math.min(1, gapRatio)),
        reasoning: `clear-score-gap:${gapRatio.toFixed(4)};relevant-samples:${top.evidence.relevantSampleCount}`,
      }
    : undefined;

  // Competition advice: derived from intent + triggers, not uncertainty.
  // familyAvailable is used to gate new-family trigger:
  // new-family only produces advice when family evidence is truly missing.
  const familyAvailable = familyEvidence?.some((item) => item.terminalTaskCount > 0) ?? false;

  const competition = evaluateCompetitionAdvice(
    input.competitionIntent,
    input.competitionTriggers,
    input.policy,
    familyAvailable,
  );

  const resolvedPolicy: RoutingPolicySettings = {
    ...input.policy,
    weights: { ...input.policy.weights },
    competitionTriggersEnabled: [...input.policy.competitionTriggersEnabled],
  };

  return {
    taskClass: input.taskClass,
    ...(input.taskFamily !== undefined ? { taskFamily: input.taskFamily } : {}),
    evidenceScope,
    knowledge,
    candidates: results,
    ...(recommendation === undefined ? {} : { recommendation }),
    competition,
    shouldRunCompetition: competition.shouldRunCompetition,
    resolvedPolicy,
    omittedFactors,
  };
}
