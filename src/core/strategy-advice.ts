/**
 * Read-only execution-strategy and exceptional-policy projection.
 *
 * Explains what naturally accumulated history supports for one requested
 * taskClass (and optional explicit taskFamily). It never starts a Task,
 * Competition, Judge, retry, or Integration, and it never votes or changes
 * Main authority.
 */
import { isReviewGraphReviewerTaskFile } from "./task.js";
import { isTerminalTaskStatus } from "./task-progress.js";
import type {
  CompetitionIntent,
  CompetitionTrigger,
  EvidenceScope,
  RoutingPolicySettings,
} from "./model-routing.js";
import {
  strategyIdentityKey,
  type RoutingEvidence,
  type StrategyExecutionMode,
} from "./statistics.js";
import type {
  CompetitionMainDecisionKind,
  CompetitionRecord,
  CompetitionStatus,
  MainDirectDecisionReason,
  MainDirectDecisionRecord,
  MainDirectDecisionStatus,
  ReviewAssignmentRecord,
  ReviewGraphRecord,
  TaskRecord,
} from "./types.js";

type StrategyDetermination = "recommendation" | "cannot-determine";

export type StrategyCannotDetermineReason =
  | "insufficient-relevant-samples"
  | "single-comparable-strategy"
  | "incomplete-family-coverage"
  | "score-gap-too-small"
  | "no-active-factors"
  | "positive-factor-unavailable";

export interface StrategyEvidenceRow {
  provider: string;
  model: string;
  runtime: string;
  effort: string;
  executionMode: StrategyExecutionMode;
  terminalTaskCount: number;
  relevantSampleCount: number;
  acceptedDeliveryCount: number;
  modelQualityFailureCount: number;
  ignoredNonModelTaskCount: number;
  ambiguousFailureCount: number;
  score: number;
  compared: boolean;
}

interface StrategyRecommendation {
  provider: string;
  model: string;
  runtime: string;
  effort: string;
  executionMode: StrategyExecutionMode;
  confidence: number;
  reasoning: string;
}

export interface ExecutionStrategyAdvice {
  determination: StrategyDetermination;
  reasons: StrategyCannotDetermineReason[];
  evidenceScope: EvidenceScope;
  rows: StrategyEvidenceRow[];
  recommendation?: StrategyRecommendation;
  createsWork: false;
}

type CompetitionPolicyDetermination =
  | "not-advised"
  | "explained"
  | "cannot-determine";

type CompetitionPolicyReason =
  | "intent-none"
  | "missing-valid-triggers"
  | "no-matching-competition-history"
  | "historical-explanation-only";

export interface CompetitionPolicyExplanation {
  determination: CompetitionPolicyDetermination;
  reasons: CompetitionPolicyReason[];
  intent: CompetitionIntent;
  shouldRunCompetition: boolean;
  validTriggers: CompetitionTrigger[];
  matchingCompetitionCount: number;
  admission: {
    completed: number;
    running: number;
    pending: number;
    legacyUnknownReason: number;
  };
  outcomes: {
    accept: number;
    reject: number;
    revise: number;
    noDecision: number;
  };
  createsWork: false;
  historyCanOverrideIntentNone: false;
}

type JudgePolicyDetermination = "explained" | "cannot-determine";

export type JudgePolicyReason =
  | "requirement-absent"
  | "no-usable-history"
  | "historical-explanation-only";

export interface JudgePolicyExplanation {
  determination: JudgePolicyDetermination;
  reasons: JudgePolicyReason[];
  declaredRequiredJudges: {
    present: boolean;
    depths: Array<0 | 1 | 2>;
    mixed: boolean;
  };
  usableOutcomeCount: number;
  unusableOutcomeCount: number;
  distinctUnderlyingIdentityCount: number;
  votes: false;
  infersRequirement: false;
  assignsOrReplacesJudge: false;
  changesIntegrationAuthority: false;
}

export interface MainDirectHistorySection {
  present: boolean;
  recordCount: number;
  openCount: number;
  completedCount: number;
  abandonedCount: number;
  reasonDistribution: Partial<Record<MainDirectDecisionReason, number>>;
  comparedAsWorkerEvidence: false;
}

export interface StrategyPolicyProjection {
  strategy: ExecutionStrategyAdvice;
  competitionPolicy: CompetitionPolicyExplanation;
  judgePolicy: JudgePolicyExplanation;
  mainDirectHistory: MainDirectHistorySection;
}

export interface CompetitionHistoryFact {
  status: CompetitionStatus;
  hasReason: boolean;
  intent?: CompetitionIntent;
  triggers: CompetitionTrigger[];
  mainDecision?: CompetitionMainDecisionKind;
  taskClass?: string;
  taskFamily?: string;
}

export interface ReviewAssignmentHistoryFact {
  provider: string;
  model: string;
  runtime: string;
  effort: string;
  terminal: boolean;
  usable: boolean;
}

export interface ReviewGraphHistoryFact {
  taskClass?: string;
  taskFamily?: string;
  assignments: ReviewAssignmentHistoryFact[];
}

export interface OrdinaryTaskPolicyFact {
  taskClass?: string;
  taskFamily?: string;
  requiredJudges?: 0 | 1 | 2;
}

export interface MainDirectHistoryFact {
  taskClass: string;
  taskFamily?: string;
  status: MainDirectDecisionStatus;
  reason: MainDirectDecisionReason;
}

export interface ProjectStrategyPolicyInput {
  taskClass: string;
  taskFamily?: string;
  policy: RoutingPolicySettings;
  competitionIntent: CompetitionIntent;
  competitionTriggers: readonly string[];
  shouldRunCompetition: boolean;
  exactEvidence: ReadonlyMap<string, RoutingEvidence>;
  familyEvidence?: ReadonlyMap<string, RoutingEvidence>;
  competitions?: readonly CompetitionHistoryFact[];
  ordinaryTasks?: readonly OrdinaryTaskPolicyFact[];
  reviewGraphs?: readonly ReviewGraphHistoryFact[];
  mainDirect?: readonly MainDirectHistoryFact[];
}

export interface StrategyPolicyStore {
  listTasks(): TaskRecord[];
  listCompetitions(): CompetitionRecord[];
  listReviewGraphs(): ReviewGraphRecord[];
  listReviewAssignments(graphId: string): ReviewAssignmentRecord[];
  listMainDirectDecisions(): MainDirectDecisionRecord[];
}

const VALID_TRIGGERS = new Set<CompetitionTrigger>([
  "critical",
  "multiple-plausible-solutions",
  "new-family",
  "user-requested",
]);

const STRATEGY_REASON_ORDER: readonly StrategyCannotDetermineReason[] = [
  "insufficient-relevant-samples",
  "single-comparable-strategy",
  "incomplete-family-coverage",
  "no-active-factors",
  "score-gap-too-small",
  "positive-factor-unavailable",
];

function isExecutableStrategyMode(
  mode: StrategyExecutionMode | undefined,
): mode is "single-run" | "persistent-session" | "native-goal" {
  return mode === "single-run" || mode === "persistent-session" || mode === "native-goal";
}

function uniqueOrderedStrategyReasons(
  reasons: Iterable<StrategyCannotDetermineReason>,
): StrategyCannotDetermineReason[] {
  const present = new Set(reasons);
  return STRATEGY_REASON_ORDER.filter((reason) => present.has(reason));
}

function inRequestedScope(
  record: { taskClass?: string; taskFamily?: string },
  taskClass: string,
  taskFamily: string | undefined,
): boolean {
  if (record.taskClass === taskClass) return true;
  return taskFamily !== undefined && record.taskFamily === taskFamily;
}

function rowFromEvidence(evidence: RoutingEvidence, score: number, compared: boolean): StrategyEvidenceRow {
  return {
    provider: evidence.provider,
    model: evidence.model,
    runtime: evidence.runtime ?? "",
    effort: evidence.effort ?? "",
    executionMode: evidence.executionMode ?? "legacy-unknown",
    terminalTaskCount: evidence.terminalTaskCount,
    relevantSampleCount: evidence.relevantSampleCount,
    acceptedDeliveryCount: evidence.acceptedDeliveryCount,
    modelQualityFailureCount: evidence.modelQualityFailureCount,
    ignoredNonModelTaskCount: evidence.ignoredNonModelTaskCount,
    ambiguousFailureCount: evidence.ambiguousFailureCount,
    score,
    compared,
  };
}

function sortRows(rows: StrategyEvidenceRow[]): StrategyEvidenceRow[] {
  return [...rows].sort((left, right) =>
    left.provider.localeCompare(right.provider)
    || left.model.localeCompare(right.model)
    || left.runtime.localeCompare(right.runtime)
    || left.effort.localeCompare(right.effort)
    || left.executionMode.localeCompare(right.executionMode));
}

function normalized(value: number, values: number[], lowerIsBetter: boolean): number {
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (high === low) return 1;
  return lowerIsBetter ? (high - value) / (high - low) : (value - low) / (high - low);
}

function officialCostAverage(evidence: RoutingEvidence): number | undefined {
  if (
    evidence.officialCostAttemptCount === 0
    || evidence.officialCostByCurrency.length !== 1
    || evidence.officialCostUnavailableCount > 0
    || evidence.officialCostQuotedAttemptCount !== evidence.officialCostAttemptCount
    || evidence.relevantSampleCount <= 0
  ) {
    return undefined;
  }
  const group = evidence.officialCostByCurrency[0]!;
  if (group.quotedAttemptCount !== evidence.officialCostAttemptCount) return undefined;
  return group.totalQuotedCost / evidence.relevantSampleCount;
}

interface FactorPlan {
  weight: number;
  available: boolean;
  values: number[];
  lowerIsBetter: boolean;
}

function scoreStrategies(
  rows: RoutingEvidence[],
  policy: RoutingPolicySettings,
  minSamples: number,
): { scores: number[]; activeWeight: number; positiveUnavailable: boolean } {
  const weights = policy.weights;
  const all = <T>(select: (item: RoutingEvidence) => T | undefined): T[] | undefined => {
    const values: T[] = [];
    for (const item of rows) {
      const value = select(item);
      if (value === undefined) return undefined;
      values.push(value);
    }
    return values;
  };

  const acceptedValues = rows.every((item) => item.acceptedDeliverySampleCount >= minSamples)
    ? rows.map((item) => item.acceptedDeliveryRate)
    : undefined;
  const behaviorValues = rows.every((item) => item.verifiedBehaviorSampleCount === item.relevantSampleCount)
    ? rows.map((item) => item.verifiedBehaviorRate)
    : undefined;
  const firstPassValues = rows.every((item) => item.firstPassVerifiedSampleCount >= minSamples)
    ? rows.map((item) => item.firstPassVerifiedSuccessRate)
    : undefined;
  const costValues = all(officialCostAverage);
  const sameCostCurrency = costValues !== undefined && new Set(
    rows.map((item) => item.officialCostByCurrency[0]?.currency),
  ).size === 1;
  const durationValues = rows.every((item) =>
    item.durationSampleCount === item.relevantSampleCount && item.avgDurationMs !== undefined)
    ? rows.map((item) => item.avgDurationMs!)
    : undefined;
  const budgetValues = rows.every((item) =>
    item.budgetReliability.boundedSampleCount >= minSamples
    && item.budgetReliability.envelope !== null
    && item.budgetReliability.completedWithoutExhaustionRate !== null)
    ? rows.map((item) => item.budgetReliability.completedWithoutExhaustionRate as number)
    : undefined;
  const budgetEnvelopeKey = (item: RoutingEvidence): string => {
    const env = item.budgetReliability.envelope;
    return `${env?.runtimeBudgetUsd ?? "_"}\0${env?.observedTokenCeiling ?? "_"}`;
  };
  const sameBudgetEnvelope = budgetValues !== undefined
    && new Set(rows.map(budgetEnvelopeKey)).size === 1;

  const plans: FactorPlan[] = [
    {
      weight: weights.acceptedDelivery,
      available: weights.acceptedDelivery > 0 && acceptedValues !== undefined,
      values: acceptedValues ?? [],
      lowerIsBetter: false,
    },
    {
      weight: weights.verifiedBehavior,
      available: weights.verifiedBehavior > 0 && behaviorValues !== undefined,
      values: behaviorValues ?? [],
      lowerIsBetter: false,
    },
    {
      weight: weights.modelQualityFailure,
      available: weights.modelQualityFailure > 0,
      values: rows.map((item) => item.modelQualityFailureRate),
      lowerIsBetter: true,
    },
    {
      weight: weights.correctionChurn,
      available: weights.correctionChurn > 0,
      values: rows.map((item) => item.correctionChurnRate),
      lowerIsBetter: true,
    },
    {
      weight: weights.firstPassSuccess,
      available: weights.firstPassSuccess > 0 && firstPassValues !== undefined,
      values: firstPassValues ?? [],
      lowerIsBetter: false,
    },
    {
      weight: weights.officialCost,
      available: weights.officialCost > 0 && costValues !== undefined && sameCostCurrency,
      values: costValues ?? [],
      lowerIsBetter: true,
    },
    {
      weight: weights.duration,
      available: weights.duration > 0 && durationValues !== undefined,
      values: durationValues ?? [],
      lowerIsBetter: true,
    },
    {
      weight: weights.budgetReliability,
      available: weights.budgetReliability > 0 && budgetValues !== undefined && sameBudgetEnvelope,
      values: budgetValues ?? [],
      lowerIsBetter: false,
    },
  ];

  const activeWeight = plans.reduce((sum, plan) => sum + (plan.available ? plan.weight : 0), 0);
  const positiveUnavailable = plans.some((plan) => plan.weight > 0 && !plan.available);
  const scores = rows.map((_, index) => plans.reduce((sum, plan) => {
    if (!plan.available) return sum;
    return sum + normalized(plan.values[index]!, plan.values, plan.lowerIsBetter) * plan.weight;
  }, 0));
  return { scores, activeWeight, positiveUnavailable };
}

function readyExecutableEntries(
  evidence: ReadonlyMap<string, RoutingEvidence>,
  minSamples: number,
): RoutingEvidence[] {
  return [...evidence.values()].filter((item) =>
    item.relevantSampleCount >= minSamples && isExecutableStrategyMode(item.executionMode));
}

function executableEntries(evidence: ReadonlyMap<string, RoutingEvidence>): RoutingEvidence[] {
  return [...evidence.values()].filter((item) => isExecutableStrategyMode(item.executionMode));
}

function determineStrategy(
  input: ProjectStrategyPolicyInput,
): ExecutionStrategyAdvice {
  const exactReady = readyExecutableEntries(input.exactEvidence, input.policy.minRelevantSamples);
  const familyMap = input.familyEvidence;
  const familyReady = familyMap === undefined
    ? []
    : readyExecutableEntries(familyMap, input.policy.familyMinRelevantSamples);
  const familyComparable = familyMap === undefined ? [] : executableEntries(familyMap);
  const familyIncomplete = familyMap !== undefined
    && familyComparable.length > 0
    && familyReady.length < familyComparable.length;

  let evidenceScope: EvidenceScope = "none";
  let compared: RoutingEvidence[] = [];
  let minSamples = input.policy.minRelevantSamples;
  const reasons: StrategyCannotDetermineReason[] = [];

  if (exactReady.length >= 2) {
    evidenceScope = "exact-class";
    compared = exactReady;
  } else if (familyMap !== undefined) {
    if (familyReady.length >= 2 && !familyIncomplete) {
      evidenceScope = "task-family";
      compared = familyReady;
      minSamples = input.policy.familyMinRelevantSamples;
    } else if (familyComparable.length > 0 && (familyIncomplete || familyReady.length < 2)) {
      reasons.push("incomplete-family-coverage");
    }
  }

  if (evidenceScope === "none") {
    if (exactReady.length === 1 || (exactReady.length < 2 && familyReady.length === 1)) {
      reasons.push("single-comparable-strategy");
    } else if (!reasons.includes("incomplete-family-coverage")) {
      reasons.push("insufficient-relevant-samples");
    }
  }

  const displayMap = evidenceScope === "task-family" && familyMap !== undefined
    ? familyMap
    : input.exactEvidence.size > 0 || familyMap === undefined
      ? input.exactEvidence
      : familyMap;

  if (evidenceScope === "none") {
    return {
      determination: "cannot-determine",
      reasons: uniqueOrderedStrategyReasons(reasons),
      evidenceScope,
      rows: sortRows([...displayMap.values()].map((item) => rowFromEvidence(item, 0, false))),
      createsWork: false,
    };
  }

  const { scores, activeWeight, positiveUnavailable } = scoreStrategies(
    compared, input.policy, minSamples,
  );
  const ranked = compared
    .map((item, index) => ({ item, score: scores[index]! }))
    .sort((left, right) => right.score - left.score
      || left.item.provider.localeCompare(right.item.provider)
      || left.item.model.localeCompare(right.item.model)
      || (left.item.executionMode ?? "").localeCompare(right.item.executionMode ?? ""));
  const gap = ranked[0]!.score - ranked[1]!.score;
  const gapRatio = activeWeight > 0 ? gap / activeWeight : 0;
  const insufficientGap = gapRatio <= input.policy.uncertaintyThreshold;
  const strictMissingEvidence = input.policy.missingEvidenceMode === "strict" && positiveUnavailable;
  if (activeWeight === 0) reasons.push("no-active-factors");
  if (insufficientGap) reasons.push("score-gap-too-small");
  if (strictMissingEvidence) reasons.push("positive-factor-unavailable");

  const scoreByKey = new Map<string, number>();
  for (const entry of ranked) {
    scoreByKey.set(strategyIdentityKey(
      entry.item.provider,
      entry.item.model,
      entry.item.runtime ?? "",
      entry.item.effort ?? "",
      entry.item.executionMode ?? "legacy-unknown",
    ), entry.score);
  }

  const rows = sortRows([...displayMap.values()].map((item) => {
    const key = strategyIdentityKey(
      item.provider,
      item.model,
      item.runtime ?? "",
      item.effort ?? "",
      item.executionMode ?? "legacy-unknown",
    );
    const comparedRow = scoreByKey.has(key) && isExecutableStrategyMode(item.executionMode);
    return rowFromEvidence(item, scoreByKey.get(key) ?? 0, comparedRow);
  }));

  if (activeWeight === 0 || insufficientGap || strictMissingEvidence) {
    return {
      determination: "cannot-determine",
      reasons: uniqueOrderedStrategyReasons(reasons),
      evidenceScope,
      rows,
      createsWork: false,
    };
  }

  const top = ranked[0]!;
  const topMode = top.item.executionMode;
  if (!isExecutableStrategyMode(topMode)) {
    return {
      determination: "cannot-determine",
      reasons: uniqueOrderedStrategyReasons(reasons),
      evidenceScope,
      rows,
      createsWork: false,
    };
  }

  return {
    determination: "recommendation",
    reasons: [],
    evidenceScope,
    rows,
    recommendation: {
      provider: top.item.provider,
      model: top.item.model,
      runtime: top.item.runtime ?? "",
      effort: top.item.effort ?? "",
      executionMode: topMode,
      confidence: Math.max(0, Math.min(1, gapRatio)),
      reasoning:
        `clear-score-gap:${gapRatio.toFixed(4)};relevant-samples:${top.item.relevantSampleCount};execution-mode:${topMode}`,
    },
    createsWork: false,
  };
}

function emptyAdmission(): CompetitionPolicyExplanation["admission"] {
  return { completed: 0, running: 0, pending: 0, legacyUnknownReason: 0 };
}

function emptyOutcomes(): CompetitionPolicyExplanation["outcomes"] {
  return { accept: 0, reject: 0, revise: 0, noDecision: 0 };
}

function summarizeCompetitions(
  matching: readonly CompetitionHistoryFact[],
): Pick<CompetitionPolicyExplanation, "admission" | "outcomes"> {
  const admission = emptyAdmission();
  const outcomes = emptyOutcomes();
  for (const item of matching) {
    if (item.status === "completed") admission.completed += 1;
    else if (item.status === "running") admission.running += 1;
    else admission.pending += 1;
    if (!item.hasReason) admission.legacyUnknownReason += 1;
    if (item.mainDecision === "accept") outcomes.accept += 1;
    else if (item.mainDecision === "reject") outcomes.reject += 1;
    else if (item.mainDecision === "revise") outcomes.revise += 1;
    else outcomes.noDecision += 1;
  }
  return { admission, outcomes };
}

function competitionTriggerCompatible(
  item: CompetitionHistoryFact,
  validTriggers: readonly CompetitionTrigger[],
): boolean {
  return item.triggers.some((trigger) => validTriggers.includes(trigger));
}

function unevaluatedCompetitionHistory(): Pick<
  CompetitionPolicyExplanation,
  "matchingCompetitionCount" | "admission" | "outcomes"
> {
  return {
    matchingCompetitionCount: 0,
    admission: emptyAdmission(),
    outcomes: emptyOutcomes(),
  };
}

function determineCompetition(
  input: ProjectStrategyPolicyInput,
): CompetitionPolicyExplanation {
  const validTriggers = input.competitionTriggers.filter(
    (trigger): trigger is CompetitionTrigger => VALID_TRIGGERS.has(trigger as CompetitionTrigger),
  );
  const base = {
    intent: input.competitionIntent,
    shouldRunCompetition: input.shouldRunCompetition,
    validTriggers,
    createsWork: false as const,
    historyCanOverrideIntentNone: false as const,
  };

  if (input.competitionIntent === "none") {
    return {
      ...base,
      ...unevaluatedCompetitionHistory(),
      shouldRunCompetition: false,
      determination: "not-advised",
      reasons: ["intent-none"],
    };
  }

  if (validTriggers.length === 0) {
    return {
      ...base,
      ...unevaluatedCompetitionHistory(),
      determination: "cannot-determine",
      reasons: ["missing-valid-triggers"],
    };
  }

  const matching = (input.competitions ?? []).filter((item) =>
    inRequestedScope(item, input.taskClass, input.taskFamily)
    && competitionTriggerCompatible(item, validTriggers));
  const summary = summarizeCompetitions(matching);

  if (matching.length === 0) {
    return {
      ...base,
      matchingCompetitionCount: 0,
      ...summary,
      determination: "cannot-determine",
      reasons: ["no-matching-competition-history"],
    };
  }

  return {
    ...base,
    matchingCompetitionCount: matching.length,
    ...summary,
    determination: "explained",
    reasons: ["historical-explanation-only"],
  };
}

function determineJudge(input: ProjectStrategyPolicyInput): JudgePolicyExplanation {
  const ordinary = (input.ordinaryTasks ?? []).filter((item) =>
    inRequestedScope(item, input.taskClass, input.taskFamily));
  const depths = [...new Set(
    ordinary
      .map((item) => item.requiredJudges)
      .filter((depth): depth is 0 | 1 | 2 => depth === 0 || depth === 1 || depth === 2),
  )].sort((left, right) => left - right);
  const declared = {
    present: depths.length > 0,
    depths,
    mixed: depths.length > 1,
  };

  const identities = new Set<string>();
  let usableOutcomeCount = 0;
  let unusableOutcomeCount = 0;
  for (const graph of input.reviewGraphs ?? []) {
    if (!inRequestedScope(graph, input.taskClass, input.taskFamily)) continue;
    for (const assignment of graph.assignments) {
      identities.add(
        `${assignment.provider}\0${assignment.model}\0${assignment.runtime}\0${assignment.effort}`,
      );
      if (assignment.usable) usableOutcomeCount += 1;
      else if (assignment.terminal) unusableOutcomeCount += 1;
    }
  }

  const reasons: JudgePolicyReason[] = [];
  if (!declared.present) reasons.push("requirement-absent");
  if (usableOutcomeCount === 0) reasons.push("no-usable-history");

  return {
    determination: reasons.length === 0 ? "explained" : "cannot-determine",
    reasons: reasons.length === 0 ? ["historical-explanation-only"] : reasons,
    declaredRequiredJudges: declared,
    usableOutcomeCount,
    unusableOutcomeCount,
    distinctUnderlyingIdentityCount: identities.size,
    votes: false,
    infersRequirement: false,
    assignsOrReplacesJudge: false,
    changesIntegrationAuthority: false,
  };
}

function determineMainDirect(input: ProjectStrategyPolicyInput): MainDirectHistorySection {
  const matching = (input.mainDirect ?? []).filter((item) =>
    inRequestedScope(item, input.taskClass, input.taskFamily));
  const reasonDistribution: Partial<Record<MainDirectDecisionReason, number>> = {};
  let openCount = 0;
  let completedCount = 0;
  let abandonedCount = 0;
  for (const item of matching) {
    reasonDistribution[item.reason] = (reasonDistribution[item.reason] ?? 0) + 1;
    if (item.status === "open") openCount += 1;
    else if (item.status === "completed") completedCount += 1;
    else abandonedCount += 1;
  }
  return {
    present: matching.length > 0,
    recordCount: matching.length,
    openCount,
    completedCount,
    abandonedCount,
    reasonDistribution,
    comparedAsWorkerEvidence: false,
  };
}

/** Pure strategy/policy projection. Callers supply already-read fixtures. */
export function projectStrategyPolicyAdvice(
  input: ProjectStrategyPolicyInput,
): StrategyPolicyProjection {
  return {
    strategy: determineStrategy(input),
    competitionPolicy: determineCompetition(input),
    judgePolicy: determineJudge(input),
    mainDirectHistory: determineMainDirect(input),
  };
}

function assignmentFact(assignment: ReviewAssignmentRecord): ReviewAssignmentHistoryFact {
  const repair = assignment.resultRepair;
  const usable = (
    repair !== undefined
    && repair.status === "succeeded"
    && repair.result !== undefined
    && repair.failureCode === undefined
  ) || (assignment.result !== undefined && assignment.failureCode === undefined);
  return {
    provider: assignment.frozenIdentity.provider,
    model: assignment.frozenIdentity.model,
    runtime: assignment.frozenIdentity.runtime,
    effort: assignment.frozenIdentity.effort,
    terminal: assignment.status === "completed" || assignment.status === "failed",
    usable,
  };
}

function collectStrategyPolicyFacts(store: StrategyPolicyStore): {
  competitions: CompetitionHistoryFact[];
  ordinaryTasks: OrdinaryTaskPolicyFact[];
  reviewGraphs: ReviewGraphHistoryFact[];
  mainDirect: MainDirectHistoryFact[];
} {
  const tasks = store.listTasks();
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const ordinaryTasks: OrdinaryTaskPolicyFact[] = [];
  for (const task of tasks) {
    if (!isTerminalTaskStatus(task.status)) continue;
    if (isReviewGraphReviewerTaskFile(task.taskFile)) continue;
    const required = task.spec.reviewRequirement?.requiredJudges;
    ordinaryTasks.push({
      ...(task.spec.taskClass === undefined ? {} : { taskClass: task.spec.taskClass }),
      ...(task.spec.taskFamily === undefined ? {} : { taskFamily: task.spec.taskFamily }),
      ...(required === 0 || required === 1 || required === 2 ? { requiredJudges: required } : {}),
    });
  }

  const competitions: CompetitionHistoryFact[] = store.listCompetitions().map((record) => {
    const contract = tasksById.get(record.contractTaskId);
    return {
      status: record.status,
      hasReason: record.reason !== undefined,
      ...(record.reason === undefined ? {} : { intent: record.reason.intent }),
      triggers: record.reason?.triggers ?? [],
      ...(record.mainDecision === undefined ? {} : { mainDecision: record.mainDecision.decision }),
      ...(contract?.spec.taskClass === undefined ? {} : { taskClass: contract.spec.taskClass }),
      ...(contract?.spec.taskFamily === undefined ? {} : { taskFamily: contract.spec.taskFamily }),
    };
  });

  const reviewGraphs: ReviewGraphHistoryFact[] = store.listReviewGraphs().map((graph) => {
    const candidate = tasksById.get(graph.candidateTaskId);
    return {
      ...(candidate?.spec.taskClass === undefined ? {} : { taskClass: candidate.spec.taskClass }),
      ...(candidate?.spec.taskFamily === undefined ? {} : { taskFamily: candidate.spec.taskFamily }),
      assignments: store.listReviewAssignments(graph.id).map(assignmentFact),
    };
  });

  const mainDirect: MainDirectHistoryFact[] = store.listMainDirectDecisions().map((record) => ({
    taskClass: record.taskClass,
    ...(record.taskFamily === undefined ? {} : { taskFamily: record.taskFamily }),
    status: record.status,
    reason: record.reason,
  }));

  return { competitions, ordinaryTasks, reviewGraphs, mainDirect };
}

/** Store-backed projection. Reads only; never writes. */
export function projectStrategyPolicyFromStore(
  store: StrategyPolicyStore,
  input: Omit<
    ProjectStrategyPolicyInput,
    "competitions" | "ordinaryTasks" | "reviewGraphs" | "mainDirect"
  >,
): StrategyPolicyProjection {
  const facts = collectStrategyPolicyFacts(store);
  return projectStrategyPolicyAdvice({
    ...input,
    competitions: facts.competitions,
    ordinaryTasks: facts.ordinaryTasks,
    reviewGraphs: facts.reviewGraphs,
    mainDirect: facts.mainDirect,
  });
}
