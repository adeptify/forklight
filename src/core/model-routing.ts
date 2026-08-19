// Read-only, evidence-aware model routing. This module scores only comparable
// historical evidence; it never starts work, changes settings, or excludes a
// model permanently.

import {
  failureImpactForCategory,
  type FailureCategory,
  type RoutingEvidence,
} from "./statistics.js";
import type {
  ExecutionPreference,
  FrozenWorkerIdentity,
  ResolvedExecutionMode,
} from "./types.js";
import type {
  WorkerReadinessNextAction,
  WorkerReadinessReason,
  WorkerReadinessState,
} from "./worker-readiness.js";
import type { StrategyPolicyProjection } from "./strategy-advice.js";

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
  | "budget-reliability-coverage-incomplete"
  | "candidate-excluded-from-comparison";

/** Whether a single candidate participated in the evidence-ready comparison
 *  cohort. Excluded candidates stay eligible and never receive synthetic
 *  quality scores. */
export type CohortParticipation = "compared" | "insufficient-evidence";

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
  /** Profile identity bound at daemon resolution. Legacy provider/model-only
   *  candidates omit these; never fabricated. */
  workerProfileId?: string;
  workerLabel?: string;
  /** Current Profile execution/readiness. Omitted for legacy candidates and
   *  before the coordinator attaches a saved-Profile projection. */
  executionPreference?: ExecutionPreference;
  resolvedExecutionMode?: ResolvedExecutionMode;
  readinessState?: WorkerReadinessState;
  readinessReason?: WorkerReadinessReason;
  canLaunch?: boolean;
  nextAction?: WorkerReadinessNextAction;
  /** Historical failure never permanently removes a candidate. */
  eligible: true;
  /** Legacy exact-class evidence. Always present; may be zero-history for
   *  new candidates. CLI/Hub should prefer comparisonEvidence for scoped facts. */
  evidence: RoutingEvidence;
  /** Evidence from the active comparison scope.  When evidenceScope is
   *  "task-family" this is the family evidence; otherwise it is the exact
   *  evidence.  Consumers use this to display truthful active-scope counts
   *  instead of always defaulting to the legacy exact column.  Excluded
   *  candidates retain their identity but carry zero-history here. */
  comparisonEvidence: RoutingEvidence;
  /** Identity-bound exact/family sample counts for truthful missing-evidence UI. */
  sampleCoverage: RoutingSampleCoverage;
  /** Whether this candidate was part of the evidence-ready comparison cohort.
   *  Excluded candidates stay eligible; their factors are marked unavailable
   *  and they never receive synthetic quality scores. */
  cohortParticipation: CohortParticipation;
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
  /** Whether the recommendation covers every requested candidate or only the
   *  evidence-ready subset.  This is carried on the recommendation itself so
   *  consumers never have to infer its claim boundary. */
  coverage: "all-candidates" | "evidence-ready-subset";
  /** Same Profile identity as the winning candidate — bound after sorting,
   *  never reattached by array index. Legacy recommendations omit these. */
  workerProfileId?: string;
  workerLabel?: string;
  /** Runtime/effort from the winning candidate identity when supplied.
   *  Legacy provider/model-only recommendations omit these. */
  runtime?: string;
  effort?: string;
  /** Current Profile execution/readiness. Present only after a saved Profile
   *  is bound and the coordinator attaches the bounded projection. */
  executionPreference?: ExecutionPreference;
  resolvedExecutionMode?: ResolvedExecutionMode;
  readinessState?: WorkerReadinessState;
  readinessReason?: WorkerReadinessReason;
  canLaunch?: boolean;
  nextAction?: WorkerReadinessNextAction;
}

/** Knowledge state: recommendation when evidence supports a clear best;
 *  unknown when evidence cannot separate candidates. */
export type RoutingKnowledge = "recommendation" | "unknown";

/** Executable-facing result. Historical `knowledge` stays independent. */
export type RoutingOverallResult =
  | "recommended"
  | "cannot-determine"
  | "historical-best-not-launchable";

/** Stable machine-readable reasons when the overall result is cannot-determine. */
export type RoutingCannotDetermineReason =
  | "insufficient-relevant-samples"
  | "single-comparable-identity"
  | "no-active-factors"
  | "score-gap-too-small"
  | "positive-factor-unavailable"
  | "profile-identity-unavailable";

/** Privacy-safe current execution/readiness for one saved Profile.
 *  Never includes endpoints, credentials, paths, prompts, or diagnostics. */
export interface RoutingReadinessProjection {
  workerProfileId: string;
  executionPreference: ExecutionPreference;
  resolvedExecutionMode: ResolvedExecutionMode;
  state: WorkerReadinessState;
  reason: WorkerReadinessReason;
  canLaunch: boolean;
  nextAction: WorkerReadinessNextAction;
}

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
  /** Executable-facing result derived from historical knowledge plus current
   *  Profile readiness. Never substitutes a runner-up. */
  overallResult: RoutingOverallResult;
  /** Present when overallResult is cannot-determine; otherwise empty. */
  cannotDetermineReasons: RoutingCannotDetermineReason[];
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
  /** Whether every requested candidate was included in the comparison cohort.
   *  False when some candidates lacked enough evidence and were excluded. */
  allCandidatesCompared: boolean;
  /** Number of candidates that participated in the comparison cohort. */
  cohortCandidateCount: number;
  /** Number of distinct routing identities within the cohort. */
  distinctIdentityCount: number;
  /** Total number of candidates originally requested. */
  totalCandidateCount: number;
  /** Number of requested candidates not included in this comparison because
   *  they lacked enough comparable evidence. They remain eligible. */
  excludedCandidateCount: number;
  /** Explicit coverage marker for any recommendation:
   *  `"all-candidates"` when every requested candidate was compared;
   *  `"evidence-ready-subset"` when the recommendation only covers the cohort. */
  recommendationCoverage: "all-candidates" | "evidence-ready-subset" | null;
  /** Additive mode-aware strategy and explicit-policy explanation.
   *  Present on the canonical Daemon/CLI/MCP surface; omitted by legacy
   *  provideRoutingAdvice callers that only score Worker identities. */
  strategyPolicy?: StrategyPolicyProjection;
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
    failureAttributionCounts: { modelQuality: 0, nonModel: 0, ambiguous: 0 },
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
   *  provider/model input omits them and evidence is keyed by provider/model.
   *  workerProfileId/workerLabel are carried through to candidates and the
   *  recommendation whenever the daemon resolver binds them. */
  candidates: Array<{
    provider: string;
    model: string;
    runtime?: string;
    effort?: string;
    workerProfileId?: string;
    workerLabel?: string;
  }>;
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

/** Evidence-ready comparison cohort resolution.
 *
 *  Chooses one evidence scope (exact-class, task-family, or none) and collects
 *  the candidate indices whose evidence meets the active threshold under that
 *  scope.  A cohort requires at least two **distinct routing identities** —
 *  duplicate executable identities cannot masquerade as independent comparison
 *  points even when two Profiles share the same provider+model+runtime+effort.
 *
 *  Returns the resolved scope, the set of in-cohort candidate indices, and the
 *  count of distinct routing identities in the cohort.  Excluded candidates
 *  retain their original identities and remain eligible; they are never scored
 *  with synthetic zero-quality evidence. */
function resolveEvidenceCohort(
  evidence: RoutingEvidence[],
  familyEvidence: RoutingEvidence[] | undefined,
  candidates: Array<{ provider: string; model: string; runtime?: string; effort?: string }>,
  policy: RoutingPolicySettings,
): { scope: EvidenceScope; cohortIndices: Set<number>; distinctIdentityCount: number } {
  const collectDistinctIndices = (
    scopeEvidence: RoutingEvidence[],
    minSamples: number,
  ): { indices: Set<number>; distinctIdentities: Set<string> } => {
    const indices = new Set<number>();
    const identities = new Set<string>();
    for (let i = 0; i < scopeEvidence.length; i++) {
      if (scopeEvidence[i]!.relevantSampleCount >= minSamples) {
        const key = routingIdentityKey(candidates[i]!);
        indices.add(i);
        identities.add(key);
      }
    }
    return { indices, distinctIdentities: identities };
  };

  // Prefer exact-class evidence first.
  const exact = collectDistinctIndices(evidence, policy.minRelevantSamples);
  if (exact.distinctIdentities.size >= 2) {
    return {
      scope: "exact-class",
      cohortIndices: exact.indices,
      distinctIdentityCount: exact.distinctIdentities.size,
    };
  }

  // Fallback to family evidence when a taskFamily is provided.
  if (familyEvidence !== undefined && familyEvidence.length === evidence.length) {
    const family = collectDistinctIndices(familyEvidence, policy.familyMinRelevantSamples);
    if (family.distinctIdentities.size >= 2) {
      return {
        scope: "task-family",
        cohortIndices: family.indices,
        distinctIdentityCount: family.distinctIdentities.size,
      };
    }
  }

  return { scope: "none", cohortIndices: new Set(), distinctIdentityCount: 0 };
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

const CANNOT_DETERMINE_REASON_ORDER: readonly RoutingCannotDetermineReason[] = [
  "insufficient-relevant-samples",
  "single-comparable-identity",
  "no-active-factors",
  "score-gap-too-small",
  "positive-factor-unavailable",
  "profile-identity-unavailable",
];

function uniqueOrderedReasons(
  reasons: Iterable<RoutingCannotDetermineReason>,
): RoutingCannotDetermineReason[] {
  const present = new Set(reasons);
  return CANNOT_DETERMINE_REASON_ORDER.filter((reason) => present.has(reason));
}

function readyIdentityCount(
  scopeEvidence: RoutingEvidence[],
  candidates: Array<{ provider: string; model: string; runtime?: string; effort?: string }>,
  minSamples: number,
): number {
  const identities = new Set<string>();
  for (let i = 0; i < scopeEvidence.length; i++) {
    if (scopeEvidence[i]!.relevantSampleCount >= minSamples) {
      identities.add(routingIdentityKey(candidates[i]!));
    }
  }
  return identities.size;
}

function stripAttachedReadiness<T extends RoutingCandidateResult | RoutingRecommendation>(
  value: T,
): T {
  const {
    executionPreference: _executionPreference,
    resolvedExecutionMode: _resolvedExecutionMode,
    readinessState: _readinessState,
    readinessReason: _readinessReason,
    canLaunch: _canLaunch,
    nextAction: _nextAction,
    ...rest
  } = value;
  return rest as T;
}

function withReadiness<T extends RoutingCandidateResult | RoutingRecommendation>(
  value: T,
  readiness: RoutingReadinessProjection,
): T {
  return {
    ...value,
    executionPreference: readiness.executionPreference,
    resolvedExecutionMode: readiness.resolvedExecutionMode,
    readinessState: readiness.state,
    readinessReason: readiness.reason,
    canLaunch: readiness.canLaunch,
    nextAction: readiness.nextAction,
  };
}

function finalizeOverallResult(
  knowledge: RoutingKnowledge,
  recommendation: RoutingRecommendation | undefined,
  evidenceReasons: readonly RoutingCannotDetermineReason[],
): {
  overallResult: RoutingOverallResult;
  cannotDetermineReasons: RoutingCannotDetermineReason[];
} {
  if (knowledge === "unknown" || recommendation === undefined) {
    return {
      overallResult: "cannot-determine",
      cannotDetermineReasons: uniqueOrderedReasons(evidenceReasons),
    };
  }
  if (recommendation.workerProfileId !== undefined && recommendation.canLaunch === true) {
    return { overallResult: "recommended", cannotDetermineReasons: [] };
  }
  if (recommendation.workerProfileId !== undefined && recommendation.canLaunch === false) {
    return {
      overallResult: "historical-best-not-launchable",
      cannotDetermineReasons: [],
    };
  }
  const reasons = [...evidenceReasons];
  if (recommendation.workerProfileId === undefined) {
    reasons.push("profile-identity-unavailable");
  }
  return {
    overallResult: "cannot-determine",
    cannotDetermineReasons: uniqueOrderedReasons(reasons),
  };
}

/** Attach current Profile execution/readiness without rescoring or substituting
 *  a runner-up. Legacy candidates stay free of invented execution facts. */
export function attachExecutableRoutingAdvice(
  advisory: RoutingAdvisoryResponse,
  readinessByProfileId: ReadonlyMap<string, RoutingReadinessProjection> = new Map(),
): RoutingAdvisoryResponse {
  const candidates = advisory.candidates.map((candidate) => {
    const historical = stripAttachedReadiness(candidate);
    const profileId = historical.workerProfileId;
    if (profileId === undefined) return historical;
    const readiness = readinessByProfileId.get(profileId);
    return readiness === undefined ? historical : withReadiness(historical, readiness);
  });

  let recommendation = advisory.recommendation === undefined
    ? undefined
    : stripAttachedReadiness(advisory.recommendation);
  if (recommendation !== undefined && recommendation.workerProfileId !== undefined) {
    const readiness = readinessByProfileId.get(recommendation.workerProfileId);
    if (readiness !== undefined) {
      recommendation = withReadiness(recommendation, readiness);
    }
  }

  const finalized = finalizeOverallResult(
    advisory.knowledge,
    recommendation,
    advisory.cannotDetermineReasons,
  );
  const { recommendation: _ignored, ...rest } = advisory;
  return {
    ...rest,
    ...finalized,
    candidates,
    ...(recommendation === undefined ? {} : { recommendation }),
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

  // Resolve the evidence-ready comparison cohort. Returns one scope plus the set
  // of candidate indices whose evidence meets the active threshold. Requires at
  // least two distinct routing identities in the cohort.
  const { scope: evidenceScope, cohortIndices, distinctIdentityCount } = resolveEvidenceCohort(
    evidence, familyEvidence, input.candidates, input.policy,
  );

  // Use the evidence from the resolved scope for scoring.
  const scoringEvidence = evidenceScope === "task-family" && familyEvidence
    ? familyEvidence
    : evidence;

  // Build an ordered index of cohort members for factor plan value access.
  const cohortOrdered = Array.from(cohortIndices).sort((a, b) => a - b);
  const cohortEvidenceArray = cohortOrdered.map((i) => scoringEvidence[i]!);

  const allSufficient = cohortEvidenceArray.length >= 2;

  // Factor-specific sample gates use the active scope's threshold.
  const activeMinRelevantSamples = evidenceScope === "task-family"
    ? input.policy.familyMinRelevantSamples
    : input.policy.minRelevantSamples;

  // Build factor plans from cohort evidence only.  Excluded candidates are
  // never mixed into the factor calculation.
  const plans: FactorPlan[] = [
    acceptedDeliveryPlan(
      input.policy.weights.acceptedDelivery, cohortEvidenceArray, allSufficient,
      activeMinRelevantSamples,
    ),
    behaviorPlan(input.policy.weights.verifiedBehavior, cohortEvidenceArray, allSufficient),
    basePlan(
      "modelQualityFailure", input.policy.weights.modelQualityFailure,
      cohortEvidenceArray.map((item) => item.modelQualityFailureRate), allSufficient, true,
    ),
    basePlan(
      "correctionChurn", input.policy.weights.correctionChurn,
      cohortEvidenceArray.map((item) => item.correctionChurnRate), allSufficient, true,
    ),
    firstPassSuccessPlan(
      input.policy.weights.firstPassSuccess, cohortEvidenceArray, allSufficient,
      activeMinRelevantSamples,
    ),
    costPlan(input.policy.weights.officialCost, cohortEvidenceArray, allSufficient),
    durationPlan(input.policy.weights.duration, cohortEvidenceArray, allSufficient),
    budgetReliabilityPlan(
      input.policy.weights.budgetReliability, cohortEvidenceArray, allSufficient,
      activeMinRelevantSamples,
    ),
  ];

  // Missing-evidence mode applies to cohort members only. Excluded candidates
  // are never the cause of positive-factor-unavailable.
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

  // Excluded candidate factor template — factors are unavailable with a stable
  // reason and zero score. Never synthesizes quality judgments.
  function excludedFactors(): RoutingFactorResult[] {
    return plans.map((plan) => ({
      factor: plan.name,
      weight: plan.weight,
      available: false,
      unavailableReason: "candidate-excluded-from-comparison" as RoutingFactorUnavailableReason,
      normalizedScore: 0,
      weightedScore: 0,
    }));
  }

  // Snapshot coverage by the same identity index used for evidence lookup so
  // later score/alphabetical sorting cannot reattach one model's counts to another.
  const results: RoutingCandidateResult[] = evidence.map((item, index) => {
    const inCohort = cohortIndices.has(index);
    const cohortIdx = inCohort ? cohortOrdered.indexOf(index) : -1;
    const factors = inCohort
      ? plans.map((plan) => factorResult(plan, cohortIdx))
      : excludedFactors();

    const reasons: RoutingUncertaintyReason[] = [];
    // Scope-none: no cohort could form at all.
    if (evidenceScope === "none" || !inCohort) {
      reasons.push("insufficient-relevant-samples");
    }
    // Strict mode only blocks the cohort; excluded candidates are not the cause.
    if (inCohort && input.policy.missingEvidenceMode === "strict" && positiveUnavailable) {
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
      ...(candidate?.workerProfileId !== undefined
        ? { workerProfileId: candidate.workerProfileId } : {}),
      ...(candidate?.workerLabel !== undefined
        ? { workerLabel: candidate.workerLabel } : {}),
      eligible: true,
      evidence: item,
      /** Active-scope evidence that drove this comparison.  Consumers
       *  use this to show truthful counts (e.g. family counts when
       *  scope is "task-family") instead of always defaulting to the
       *  legacy exact-column evidence. */
      comparisonEvidence: scoringEvidence[index]!,
      sampleCoverage,
      cohortParticipation: inCohort ? "compared" : "insufficient-evidence",
      factors,
      totalScore: factors.reduce((sum, factor) => sum + factor.weightedScore, 0),
      uncertainty: {
        insufficientSamples: evidenceScope === "none" || !inCohort,
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

  // Rank executable identities, not Profile rows. Multiple Profiles can point
  // at the same provider+model+runtime+effort; counting those duplicates as
  // first and second place would manufacture a zero gap and hide a real
  // separation from the next distinct Worker identity.
  const cohortByIdentity = new Map<string, RoutingCandidateResult[]>();
  for (const result of results) {
    if (result.cohortParticipation !== "compared") continue;
    const key = routingIdentityKey(result);
    const group = cohortByIdentity.get(key) ?? [];
    group.push(result);
    cohortByIdentity.set(key, group);
  }
  const rankedIdentities = Array.from(cohortByIdentity.values())
    .map((group) => group[0]!)
    .sort((left, right) => right.totalScore - left.totalScore
      || left.provider.localeCompare(right.provider)
      || left.model.localeCompare(right.model));
  const gap = evidenceScope === "none"
    ? 0
    : rankedIdentities[0]!.totalScore - rankedIdentities[1]!.totalScore;
  const gapRatio = activeWeight > 0 ? gap / activeWeight : 0;
  const insufficientGap = gapRatio <= input.policy.uncertaintyThreshold;

  // Score-gap markers apply only to cohort members who were actually scored.
  if (insufficientGap && evidenceScope !== "none") {
    for (const result of results) {
      if (result.cohortParticipation !== "compared") continue;
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

  const allCompared = cohortIndices.size === evidence.length;
  const recommendationCoverage = allCompared
    ? "all-candidates" as const
    : "evidence-ready-subset" as const;
  const top = rankedIdentities[0];
  const topIdentityProfiles = top === undefined
    ? []
    : cohortByIdentity.get(routingIdentityKey(top)) ?? [];
  const recommendation = knowledge === "recommendation" && top !== undefined
    ? {
        provider: top.provider,
        model: top.model,
        confidence: Math.max(0, Math.min(1, gapRatio)),
        reasoning: `clear-score-gap:${gapRatio.toFixed(4)};relevant-samples:${top.comparisonEvidence.relevantSampleCount};equivalent-profiles:${topIdentityProfiles.length}`,
        coverage: recommendationCoverage,
        ...(top.runtime !== undefined ? { runtime: top.runtime } : {}),
        ...(top.effort !== undefined ? { effort: top.effort } : {}),
        // Recommend a concrete Profile only when the evidence distinguishes a
        // single Profile for this executable identity. If multiple Profiles
        // share it, recommend the identity without arbitrarily naming one.
        ...(topIdentityProfiles.length === 1 && top.workerProfileId !== undefined
          ? { workerProfileId: top.workerProfileId } : {}),
        ...(topIdentityProfiles.length === 1 && top.workerLabel !== undefined
          ? { workerLabel: top.workerLabel } : {}),
      }
    : undefined;

  const canonicalRecommendationCoverage = recommendation?.coverage ?? null;

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

  const evidenceReasons: RoutingCannotDetermineReason[] = [];
  if (knowledge === "unknown") {
    const exactReady = readyIdentityCount(
      evidence, input.candidates, input.policy.minRelevantSamples,
    );
    const familyReady = familyEvidence === undefined
      ? 0
      : readyIdentityCount(
        familyEvidence, input.candidates, input.policy.familyMinRelevantSamples,
      );
    if (evidenceScope === "none") {
      if (exactReady === 1 || (exactReady < 2 && familyReady === 1)) {
        evidenceReasons.push("single-comparable-identity");
      } else {
        evidenceReasons.push("insufficient-relevant-samples");
      }
    }
    if (activeWeight === 0 && evidenceScope !== "none") {
      evidenceReasons.push("no-active-factors");
    }
    if (insufficientGap && evidenceScope !== "none") {
      evidenceReasons.push("score-gap-too-small");
    }
    if (input.policy.missingEvidenceMode === "strict" && positiveUnavailable
      && evidenceScope !== "none") {
      evidenceReasons.push("positive-factor-unavailable");
    }
  }

  return attachExecutableRoutingAdvice({
    taskClass: input.taskClass,
    ...(input.taskFamily !== undefined ? { taskFamily: input.taskFamily } : {}),
    evidenceScope,
    knowledge,
    overallResult: "cannot-determine",
    cannotDetermineReasons: uniqueOrderedReasons(evidenceReasons),
    candidates: results,
    ...(recommendation === undefined ? {} : { recommendation }),
    competition,
    shouldRunCompetition: competition.shouldRunCompetition,
    resolvedPolicy,
    omittedFactors,
    allCandidatesCompared: allCompared,
    cohortCandidateCount: cohortIndices.size,
    distinctIdentityCount,
    totalCandidateCount: evidence.length,
    excludedCandidateCount: evidence.length - cohortIndices.size,
    recommendationCoverage: canonicalRecommendationCoverage,
  });
}
