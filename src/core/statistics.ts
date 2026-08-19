import type { StateStore } from "../state/store.js";
import {
  latestMainReview,
  latestVerificationEvent,
  resolveLatestRevision,
} from "./candidate-revision.js";
import { isTerminalTaskStatus } from "./task-progress.js";
import { isReviewGraphReviewerTaskFile } from "./task.js";
import { failureCategoryFromEvents } from "./worker-failure.js";
import { resolveMainFailureAttribution } from "./main-failure-attribution.js";
import type {
  AttemptRecord,
  AttemptStatus,
  EventRecord,
  FrozenWorkerIdentity,
  MainReviewDecisionKind,
  RemediationDisposition,
  ResolvedExecutionMode,
  RoutingDecisionSnapshot,
  TaskRecord,
  TaskStatus,
  VerificationResult,
} from "./types.js";

export type FailureCategory =
  | "verification"
  | "credential"
  | "interruption"
  | "workspace"
  | "budget"
  | "provider"
  | "noProgress"
  | "unclassified"
  /** Main-authored acceptance contradiction after verified amended delivery. */
  | "contract-infeasible";

export interface ClassifyFailureInput {
  taskStatus: TaskStatus;
  attemptStatus?: AttemptStatus;
  attemptExitCode?: number;
  verification?: VerificationResult;
  error?: string;
}

/** Evidence impact for model-routing: whether a failure is model-quality,
 *  non-model (external), or ambiguous (cannot blame or clear the model). */
export type FailureImpact = "model-quality" | "non-model" | "ambiguous";

export interface FailureClassification {
  category: FailureCategory;
  reason: string;
  diagnostic: string;
  /** Routing impact is derived from the full failure evidence. The diagnostic
   * category stays unchanged, so a policy-only verification failure can remain
   * category=verification while impact=non-model. */
  impact: FailureImpact;
}

export interface TaskEvidence {
  task: TaskRecord;
  attempts: AttemptRecord[];
  events: EventRecord[];
  verification?: VerificationResult;
}

export interface StatisticsFilter {
  providerName?: string;
  modelName?: string;
  since?: string;
  until?: string;
  /** Exact taskClass filter — never pattern-matched, never inferred. */
  taskClass?: string;
  /** Stable taskFamily filter — never pattern-matched, never inferred. */
  taskFamily?: string;
}

export interface FailureEvidence extends FailureClassification {
  taskId: string;
  attemptId?: string;
}

/** Transport detail for Provider/model statistics. compact is the default for
 *  routine Main supervision; full is local deep audit only. */
export type StatisticsDetail = "compact" | "full";

/** Aggregate-only Provider/model summary for routine supervision.
 *  Omits per-Task failure ids, attempt ids, and diagnostics. */
export interface CompactProviderModelSummary {
  provider: string;
  model: string;
  sampleSize: number;
  successCount: number;
  verifiedSuccessCount: number;
  successRate: number;
  verifiedSuccessRate: number;
  retryCount: number;
  avgRetries: number;
  durationSampleSize: number;
  totalDurationMs?: number;
  avgDurationMs?: number;
  firstEffectiveActionSampleSize: number;
  avgTimeToFirstEffectiveActionMs?: number;
  costSampleSize: number;
  totalCostUsd?: number;
  avgCostUsd?: number;
  /** Separate runtime estimate fields — never the same as legacy costUsd. */
  runtimeEstimateTaskSampleSize: number;
  totalRuntimeEstimateUsd?: number;
  avgRuntimeEstimatePerTaskUsd?: number;
  turnsSampleSize: number;
  totalTurns?: number;
  avgTurns?: number;
  failureDistribution: Partial<Record<FailureCategory, number>>;
  /** Explicit Main responsibility decisions only; aggregate and content-free. */
  failureAttributionCounts: {
    modelQuality: number;
    nonModel: number;
    ambiguous: number;
  };
  /**
   * Main/delivery-backed final delivery — parallel to machine success.
   * acceptedDeliveryCount is accepted outcomes only; the rate uses comparable
   * samples (accepted + not-accepted), never machine success alone.
   */
  acceptedDeliveryCount: number;
  acceptedDeliverySampleCount: number;
  acceptedDeliveryNotAcceptedCount: number;
  acceptedDeliveryUnavailableCount: number;
  acceptedDeliveryRate: number;
  mainRepairedDeliveryCount: number;
  remediationCheckCount: number;
}

/** Full Provider/model summary including per-Task failure evidence. */
export interface ProviderModelSummary extends CompactProviderModelSummary {
  failures: FailureEvidence[];
}

/**
 * Detached allowlisted projection: every aggregate value is copied unchanged;
 * the per-Task `failures` array is omitted. Never recalculates rates or
 * categories. Safe for routine CLI/MCP/Hub supervision.
 */
export function projectCompactProviderModelSummary(
  summary: ProviderModelSummary,
): CompactProviderModelSummary {
  return {
    provider: summary.provider,
    model: summary.model,
    sampleSize: summary.sampleSize,
    successCount: summary.successCount,
    verifiedSuccessCount: summary.verifiedSuccessCount,
    successRate: summary.successRate,
    verifiedSuccessRate: summary.verifiedSuccessRate,
    retryCount: summary.retryCount,
    avgRetries: summary.avgRetries,
    durationSampleSize: summary.durationSampleSize,
    ...(summary.totalDurationMs === undefined ? {} : { totalDurationMs: summary.totalDurationMs }),
    ...(summary.avgDurationMs === undefined ? {} : { avgDurationMs: summary.avgDurationMs }),
    firstEffectiveActionSampleSize: summary.firstEffectiveActionSampleSize,
    ...(summary.avgTimeToFirstEffectiveActionMs === undefined
      ? {}
      : { avgTimeToFirstEffectiveActionMs: summary.avgTimeToFirstEffectiveActionMs }),
    costSampleSize: summary.costSampleSize,
    ...(summary.totalCostUsd === undefined ? {} : { totalCostUsd: summary.totalCostUsd }),
    ...(summary.avgCostUsd === undefined ? {} : { avgCostUsd: summary.avgCostUsd }),
    runtimeEstimateTaskSampleSize: summary.runtimeEstimateTaskSampleSize,
    ...(summary.totalRuntimeEstimateUsd === undefined
      ? {}
      : { totalRuntimeEstimateUsd: summary.totalRuntimeEstimateUsd }),
    ...(summary.avgRuntimeEstimatePerTaskUsd === undefined
      ? {}
      : { avgRuntimeEstimatePerTaskUsd: summary.avgRuntimeEstimatePerTaskUsd }),
    turnsSampleSize: summary.turnsSampleSize,
    ...(summary.totalTurns === undefined ? {} : { totalTurns: summary.totalTurns }),
    ...(summary.avgTurns === undefined ? {} : { avgTurns: summary.avgTurns }),
    failureDistribution: { ...summary.failureDistribution },
    failureAttributionCounts: { ...summary.failureAttributionCounts },
    acceptedDeliveryCount: summary.acceptedDeliveryCount,
    acceptedDeliverySampleCount: summary.acceptedDeliverySampleCount,
    acceptedDeliveryNotAcceptedCount: summary.acceptedDeliveryNotAcceptedCount,
    acceptedDeliveryUnavailableCount: summary.acceptedDeliveryUnavailableCount,
    acceptedDeliveryRate: summary.acceptedDeliveryRate,
    mainRepairedDeliveryCount: summary.mainRepairedDeliveryCount,
    remediationCheckCount: summary.remediationCheckCount,
  };
}

/** Project a list of full summaries to detached compact aggregates. */
export function projectCompactProviderModelSummaries(
  summaries: ProviderModelSummary[],
): CompactProviderModelSummary[] {
  return summaries.map(projectCompactProviderModelSummary);
}

/** Map a FailureCategory to its routing evidence impact.
 *  Hard invariant — never depends on settings. */
export function failureImpactForCategory(category: FailureCategory): FailureImpact {
  switch (category) {
    case "verification":
      return "model-quality";
    case "credential":
    case "interruption":
    case "workspace":
    case "budget":
    case "provider":
    case "contract-infeasible":
      return "non-model";
    case "noProgress":
    case "unclassified":
      return "ambiguous";
    default: {
      const _exhaustive: never = category;
      void _exhaustive;
      return "ambiguous";
    }
  }
}

function includesAny(text: string, patterns: string[]): boolean {
  const normalized = text.toLowerCase();
  return patterns.some((pattern) => normalized.includes(pattern));
}

export function classifyFailure(input: ClassifyFailureInput): FailureClassification {
  const diagnostic = input.error ?? "";
  const result = (category: FailureCategory, reason: string): FailureClassification => ({
    category,
    reason,
    diagnostic,
    impact: failureImpactForCategory(category),
  });

  if (
    input.taskStatus === "interrupted" ||
    input.attemptStatus === "interrupted" ||
    input.attemptExitCode === 130 ||
    input.attemptExitCode === 143
  ) {
    return result("interruption", "Worker halted by explicit interruption evidence");
  }

  if (input.verification?.passed === false) {
    const budget = input.verification.changeBudget;
    if (budget && !budget.withinBudget) {
      return {
        category: "verification",
        reason: `Change budget exceeded: ${budget.filesChanged}/${budget.maxFiles} files, ${budget.changedLines}/${budget.maxDiffLines} lines`,
        diagnostic,
        impact: input.verification.behaviorPassed ? "non-model" : "model-quality",
      };
    }
    if (
      input.verification.behaviorPassed
      && (!input.verification.policyPassed || !input.verification.sourceCompatible)
    ) {
      return {
        category: "verification",
        reason: !input.verification.sourceCompatible
          ? "Source compatibility gate failed after behavior checks passed"
          : "Flexible completion or size policy failed after behavior checks passed",
        diagnostic,
        impact: "non-model",
      };
    }
    const failedCommands = input.verification.commands
      .filter((command) => command.exitCode !== 0)
      .map((command) => `${command.command} (exit ${command.exitCode})`)
      .join(", ");
    return result(
      "verification",
      failedCommands
        ? `Verification command(s) failed: ${failedCommands}`
        : "Verification failed without passing all criteria",
    );
  }

  if (diagnostic.startsWith("Workspace preparation failed:")) {
    return result("workspace", "Workspace preparation failed");
  }
  if (
    includesAny(diagnostic, ["sigint", "sigterm", "ctrl+c", "worker execution interrupted"])
  ) {
    return result("interruption", "Interruption evidence detected in diagnostic");
  }
  if (diagnostic.toLowerCase().includes("independent verification failed")) {
    return result("verification", "Verification failure detected in diagnostic");
  }
  if (
    includesAny(diagnostic, [
      "authentication",
      "unauthorized",
      "401",
      "403",
      "invalid api key",
      "api key",
      "keychain",
      "credential",
      "not authenticated",
      "auth token",
    ])
  ) {
    return result("credential", "Authentication or credential error detected in diagnostic");
  }
  if (
    includesAny(diagnostic, [
      "budget",
      "max-budget-usd",
      "token budget",
      "context window",
      "token limit",
      "observed-token",
    ])
  ) {
    return result("budget", "Budget or token limit exhausted");
  }
  if (
    includesAny(diagnostic, [
      "no effective implementation progress",
      "no progress",
      "watchdog",
      "stalled",
    ])
  ) {
    return result("noProgress", "Worker stalled without effective implementation progress");
  }
  if (
    includesAny(diagnostic, [
      "connection refused",
      "econnrefused",
      "enotfound",
      "econnreset",
      "etimedout",
      "econnaborted",
      "network connectivity failure",
      "could not reach the provider service",
      "http 500",
      "http 502",
      "http 503",
      "http 504",
      "http 429",
      "rate limit",
      "too many requests",
      "service unavailable",
      "internal server error",
    ])
  ) {
    return result("provider", "Provider or infrastructure error detected in diagnostic");
  }
  return result(
    "unclassified",
    diagnostic ? "Unrecognized failure pattern" : "No diagnostic available",
  );
}

function millisecondsBetween(start?: string, finish?: string): number | undefined {
  if (!start || !finish) return undefined;
  const duration = Date.parse(finish) - Date.parse(start);
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

function completeAttemptTotal(
  attempts: AttemptRecord[],
  metric: "costUsd" | "turns" | "runtimeCostEstimateUsd",
): number | undefined {
  if (attempts.length === 0 || attempts.some((attempt) => attempt[metric] === undefined)) {
    return undefined;
  }
  return attempts.reduce((total, attempt) => total + (attempt[metric] ?? 0), 0);
}

function firstEffectiveActionMs(evidence: TaskEvidence): number | undefined {
  const start = evidence.task.startedAt
    ?? [...evidence.attempts].sort((a, b) => a.ordinal - b.ordinal)[0]?.startedAt;
  if (!start) return undefined;
  const first = evidence.events
    .filter((event) => event.type === "worker.tool.started")
    .map((event) => event.timestamp)
    .sort()[0];
  return millisecondsBetween(start, first);
}

function latestAttempt(attempts: AttemptRecord[]): AttemptRecord | undefined {
  return [...attempts].sort((a, b) => b.ordinal - a.ordinal)[0];
}

function average(values: number[]): number | undefined {
  return values.length === 0
    ? undefined
    : values.reduce((total, value) => total + value, 0) / values.length;
}

/** Privacy-safe final-delivery outcome for one terminal Task. */
export type FinalDeliveryOutcome = "accepted" | "not-accepted" | "unavailable";

export interface FinalDeliveryEvidenceInput {
  hasPassingDisposition?: (taskId: string) => boolean;
  getDisposition?: (taskId: string) => RemediationDisposition | undefined;
  hasAppliedIntegration?: (taskId: string) => boolean;
}

/**
 * True when the latest Main decision is bound to the current latest Attempt,
 * latest verification event, and — for acceptance authority — the current
 * Candidate Revision id and patch digest when revision history exists.
 *
 * Negative decisions (reject/revise) may remain current without revision id
 * or digest when both fields are absent: that is legacy non-acceptance
 * evidence only. Partial or mismatched revision bindings stay unavailable.
 * Accept never uses the legacy unbound path.
 */
export function resolveCurrentMainDecision(
  item: TaskEvidence,
): MainReviewDecisionKind | undefined {
  const review = latestMainReview(item.events);
  if (review === undefined) return undefined;

  const attempt = latestAttempt(item.attempts);
  if (attempt === undefined) return undefined;
  if (review.attemptId !== attempt.id) return undefined;
  if (
    item.task.currentAttemptId !== undefined
    && review.attemptId !== item.task.currentAttemptId
  ) {
    return undefined;
  }

  const verificationEvent = latestVerificationEvent(item.events);
  if (verificationEvent === undefined) return undefined;
  if (review.verificationEventSequence !== verificationEvent.sequence) return undefined;
  if (
    verificationEvent.attemptId !== undefined
    && review.attemptId !== verificationEvent.attemptId
  ) {
    return undefined;
  }

  // When revision history exists, binding is decision-sensitive:
  // - accept: exact current revision id + digest (fail-closed; never unbound)
  // - reject/revise: exact match when both fields are present; both absent is
  //   legacy non-acceptance only; partial or mismatched stays unavailable
  // Legacy Tasks without revision capture still use attempt+verification only.
  const latestRevision = resolveLatestRevision(item.events);
  if (latestRevision !== undefined) {
    const hasRevisionId = review.candidateRevisionId !== undefined;
    const hasDigest = review.acceptedPatchDigest !== undefined;
    if (review.decision === "accept") {
      if (review.candidateRevisionId !== latestRevision.id) return undefined;
      // Modern revision history is content-addressed. The revision id alone is
      // not enough evidence because a malformed/imported review could name the
      // right revision while omitting the exact patch bytes Main reviewed.
      if (review.acceptedPatchDigest !== latestRevision.patchDigest) return undefined;
    } else if (!hasRevisionId && !hasDigest) {
      // Legacy negative decision predating stored revision-binding fields.
      // Attempt + verification already matched above; never acceptance authority.
    } else if (hasRevisionId && hasDigest) {
      if (review.candidateRevisionId !== latestRevision.id) return undefined;
      if (review.acceptedPatchDigest !== latestRevision.patchDigest) return undefined;
    } else {
      // Only one of id/digest present — malformed partial binding.
      return undefined;
    }
  }

  return review.decision;
}

function classifyTerminalFailure(
  item: TaskEvidence,
  getDisposition?: (taskId: string) => RemediationDisposition | undefined,
  applyFailureAttribution = true,
): FailureClassification | undefined {
  if (item.task.status === "succeeded") return undefined;
  const attempt = latestAttempt(item.attempts);
  let classification: FailureClassification = failureCategoryFromEvents(item.events) === "connectivity"
    ? {
        category: "provider",
        reason: "Provider connectivity or transport failure",
        diagnostic: item.task.error ?? "",
        impact: "non-model",
      }
    : classifyFailure({
        taskStatus: item.task.status,
        ...(attempt === undefined ? {} : { attemptStatus: attempt.status }),
        ...(attempt?.exitCode === undefined ? {} : { attemptExitCode: attempt.exitCode }),
        ...(item.verification === undefined ? {} : { verification: item.verification }),
        ...(item.task.error === undefined ? {} : { error: item.task.error }),
      });
  // Main-authored acceptance mistakes after verified amended delivery are
  // contract-infeasible non-model evidence — never model-quality blame.
  if (
    getDisposition?.(item.task.id)?.acceptanceBasis === "amended-acceptance"
    && classification.impact === "model-quality"
  ) {
    classification = {
      category: "contract-infeasible",
      reason: "Main amended acceptance after verified amended delivery",
      diagnostic: classification.diagnostic,
      impact: "non-model",
    };
  }
  const verificationEvent = applyFailureAttribution ? latestVerificationEvent(item.events) : undefined;
  if (verificationEvent?.attemptId !== undefined) {
    const attribution = resolveMainFailureAttribution(
      item.events,
      verificationEvent.attemptId,
      verificationEvent.sequence,
    );
    if (attribution !== undefined) {
      classification = { ...classification, impact: attribution.impact };
    }
  }
  return classification;
}

/**
 * Canonical final-delivery outcome resolver.
 * Machine success alone is never accepted. Precedence is explicit and
 * task-unique: verified remediation, current Main decision, durable applied
 * Integration, model-quality non-acceptance, otherwise unavailable.
 */
export function classifyFinalDeliveryOutcome(
  item: TaskEvidence,
  input: FinalDeliveryEvidenceInput = {},
): FinalDeliveryOutcome {
  const taskId = item.task.id;
  const hasRemediation = input.getDisposition?.(taskId) !== undefined
    || (input.hasPassingDisposition?.(taskId) ?? false);
  // Verified Main remediation is durable accepted delivery regardless of the
  // original machine status. Overlapping accept/Integration do not double-count.
  if (hasRemediation) return "accepted";

  const currentMain = resolveCurrentMainDecision(item);
  if (currentMain === "accept") return "accepted";
  // A current reject or revise is comparable non-acceptance even when the
  // machine checks previously passed.
  if (currentMain === "reject" || currentMain === "revise") return "not-accepted";

  // Legacy applied Integration is durable delivery when no fresher contradictory
  // Main decision is bound to the current Candidate/verification.
  if (input.hasAppliedIntegration?.(taskId) === true) return "accepted";

  if (item.task.status !== "succeeded") {
    const classification = classifyTerminalFailure(item, input.getDisposition, false);
    // Relevant model-quality machine failure without later accepted delivery is
    // a comparable non-acceptance. External/policy/ambiguous stay unavailable.
    if (classification?.impact === "model-quality") return "not-accepted";
    return "unavailable";
  }

  // Machine-successful Task with no current Main or delivery evidence.
  return "unavailable";
}

function emptyFinalDeliveryCounts(): {
  acceptedDeliveryCount: number;
  acceptedDeliverySampleCount: number;
  acceptedDeliveryNotAcceptedCount: number;
  acceptedDeliveryUnavailableCount: number;
  acceptedDeliveryRate: number;
} {
  return {
    acceptedDeliveryCount: 0,
    acceptedDeliverySampleCount: 0,
    acceptedDeliveryNotAcceptedCount: 0,
    acceptedDeliveryUnavailableCount: 0,
    acceptedDeliveryRate: 0,
  };
}

function accumulateFinalDelivery(
  counts: {
    acceptedDeliveryCount: number;
    acceptedDeliverySampleCount: number;
    acceptedDeliveryNotAcceptedCount: number;
    acceptedDeliveryUnavailableCount: number;
  },
  outcome: FinalDeliveryOutcome,
): void {
  if (outcome === "accepted") {
    counts.acceptedDeliveryCount += 1;
    counts.acceptedDeliverySampleCount += 1;
  } else if (outcome === "not-accepted") {
    counts.acceptedDeliveryNotAcceptedCount += 1;
    counts.acceptedDeliverySampleCount += 1;
  } else {
    counts.acceptedDeliveryUnavailableCount += 1;
  }
}

function summaryFor(
  provider: string,
  model: string,
  evidence: TaskEvidence[],
  remediationChecksCount: (taskId: string) => number,
  deliveryInput: FinalDeliveryEvidenceInput,
): ProviderModelSummary {
  const successCount = evidence.filter(({ task }) => task.status === "succeeded").length;
  const verifiedSuccessCount = evidence.filter(({ verification }) => verification?.passed).length;
  const durations = evidence
    .map(({ task }) => millisecondsBetween(task.startedAt, task.finishedAt))
    .filter((value): value is number => value !== undefined);
  const firstActions = evidence
    .map(firstEffectiveActionMs)
    .filter((value): value is number => value !== undefined);
  const costs = evidence
    .map(({ attempts }) => completeAttemptTotal(attempts, "costUsd"))
    .filter((value): value is number => value !== undefined);
  const runtimeEstimates = evidence
    .map(({ attempts }) => completeAttemptTotal(attempts, "runtimeCostEstimateUsd"))
    .filter((value): value is number => value !== undefined);
  const turns = evidence
    .map(({ attempts }) => completeAttemptTotal(attempts, "turns"))
    .filter((value): value is number => value !== undefined);
  const retryCount = evidence.reduce(
    (total, item) => total + Math.max(0, item.attempts.length - 1),
    0,
  );
  const failures: FailureEvidence[] = [];

  for (const item of evidence) {
    if (item.task.status === "succeeded") continue;
    const attempt = latestAttempt(item.attempts);
    const classification = classifyTerminalFailure(item, deliveryInput.getDisposition)
      ?? classifyFailure({
          taskStatus: item.task.status,
          ...(attempt === undefined ? {} : { attemptStatus: attempt.status }),
          ...(attempt?.exitCode === undefined ? {} : { attemptExitCode: attempt.exitCode }),
          ...(item.verification === undefined ? {} : { verification: item.verification }),
          ...(item.task.error === undefined ? {} : { error: item.task.error }),
        });
    failures.push({
      taskId: item.task.id,
      ...(attempt === undefined ? {} : { attemptId: attempt.id }),
      ...classification,
    });
  }

  const totalDurationMs = durations.reduce((total, value) => total + value, 0);
  const totalCostUsd = costs.reduce((total, value) => total + value, 0);
  const totalTurns = turns.reduce((total, value) => total + value, 0);
  const firstActionAverage = average(firstActions);
  const failureDistribution: Partial<Record<FailureCategory, number>> = {};
  for (const failure of failures) {
    failureDistribution[failure.category] = (failureDistribution[failure.category] ?? 0) + 1;
  }
  const failureAttributionCounts = { modelQuality: 0, nonModel: 0, ambiguous: 0 };
  for (const item of evidence) {
    if (item.task.status === "succeeded") continue;
    const verificationEvent = latestVerificationEvent(item.events);
    if (verificationEvent?.attemptId === undefined) continue;
    const attribution = resolveMainFailureAttribution(
      item.events, verificationEvent.attemptId, verificationEvent.sequence,
    );
    if (attribution?.impact === "model-quality") failureAttributionCounts.modelQuality += 1;
    else if (attribution?.impact === "non-model") failureAttributionCounts.nonModel += 1;
    else if (attribution?.impact === "ambiguous") failureAttributionCounts.ambiguous += 1;
  }

  // Final delivery is Main/delivery-backed and task-unique. Machine success is
  // never a shortcut into the accepted set.
  const mainRepairedCount = evidence.filter(
    ({ task }) =>
      deliveryInput.getDisposition?.(task.id) !== undefined
      || (deliveryInput.hasPassingDisposition?.(task.id) ?? false),
  ).length;
  const deliveryCounts = emptyFinalDeliveryCounts();
  for (const item of evidence) {
    accumulateFinalDelivery(deliveryCounts, classifyFinalDeliveryOutcome(item, deliveryInput));
  }
  deliveryCounts.acceptedDeliveryRate = deliveryCounts.acceptedDeliverySampleCount > 0
    ? deliveryCounts.acceptedDeliveryCount / deliveryCounts.acceptedDeliverySampleCount
    : 0;
  const totalChecks = evidence.reduce(
    (sum, { task }) => sum + remediationChecksCount(task.id),
    0,
  );

  return {
    provider,
    model,
    sampleSize: evidence.length,
    successCount,
    verifiedSuccessCount,
    successRate: successCount / evidence.length,
    verifiedSuccessRate: verifiedSuccessCount / evidence.length,
    retryCount,
    avgRetries: retryCount / evidence.length,
    durationSampleSize: durations.length,
    ...(durations.length === 0
      ? {}
      : { totalDurationMs, avgDurationMs: totalDurationMs / durations.length }),
    firstEffectiveActionSampleSize: firstActions.length,
    ...(firstActionAverage === undefined
      ? {}
      : { avgTimeToFirstEffectiveActionMs: firstActionAverage }),
    costSampleSize: costs.length,
    ...(costs.length === 0 ? {} : { totalCostUsd, avgCostUsd: totalCostUsd / costs.length }),
    runtimeEstimateTaskSampleSize: runtimeEstimates.length,
    ...(runtimeEstimates.length === 0
      ? {}
      : {
          totalRuntimeEstimateUsd: runtimeEstimates.reduce((total, value) => total + value, 0),
          avgRuntimeEstimatePerTaskUsd:
            runtimeEstimates.reduce((total, value) => total + value, 0) / runtimeEstimates.length,
        }),
    turnsSampleSize: turns.length,
    ...(turns.length === 0 ? {} : { totalTurns, avgTurns: totalTurns / turns.length }),
    failureDistribution,
    failureAttributionCounts,
    failures,
    acceptedDeliveryCount: deliveryCounts.acceptedDeliveryCount,
    acceptedDeliverySampleCount: deliveryCounts.acceptedDeliverySampleCount,
    acceptedDeliveryNotAcceptedCount: deliveryCounts.acceptedDeliveryNotAcceptedCount,
    acceptedDeliveryUnavailableCount: deliveryCounts.acceptedDeliveryUnavailableCount,
    acceptedDeliveryRate: deliveryCounts.acceptedDeliveryRate,
    mainRepairedDeliveryCount: mainRepairedCount,
    remediationCheckCount: totalChecks,
  };
}

export function computeStatistics(
  history: TaskEvidence[],
  filter: StatisticsFilter = {},
  remediationData?: {
    checksCount: (taskId: string) => number;
    hasPassingDisposition: (taskId: string) => boolean;
    hasAppliedIntegration?: (taskId: string) => boolean;
    getDisposition?: (taskId: string) => RemediationDisposition | undefined;
  },
): ProviderModelSummary[] {
  const since = filter.since === undefined ? undefined : Date.parse(filter.since);
  const until = filter.until === undefined ? undefined : Date.parse(filter.until);
  const filtered = history.filter(({ task }) =>
    isTerminalTaskStatus(task.status)
    && (filter.providerName === undefined || task.spec.provider.name === filter.providerName)
    && (filter.modelName === undefined || task.spec.provider.model === filter.modelName)
    && (filter.taskClass === undefined || task.spec.taskClass === filter.taskClass)
    && (filter.taskFamily === undefined || task.spec.taskFamily === filter.taskFamily)
    && (since === undefined || Date.parse(task.createdAt) >= since)
    && (until === undefined || Date.parse(task.createdAt) <= until));
  const groups = new Map<string, TaskEvidence[]>();

  for (const item of filtered) {
    const key = `${item.task.spec.provider.name}\0${item.task.spec.provider.model}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  const noopChecksCount = (): number => 0;
  const deliveryInput: FinalDeliveryEvidenceInput = {
    hasPassingDisposition: remediationData?.hasPassingDisposition ?? ((): boolean => false),
    ...(remediationData?.getDisposition === undefined
      ? {}
      : { getDisposition: remediationData.getDisposition }),
    ...(remediationData?.hasAppliedIntegration === undefined
      ? {}
      : { hasAppliedIntegration: remediationData.hasAppliedIntegration }),
  };
  const checksCount = remediationData?.checksCount ?? noopChecksCount;

  return [...groups.entries()]
    .map(([key, items]) => {
      const [provider = "", model = ""] = key.split("\0");
      return summaryFor(provider, model, items, checksCount, deliveryInput);
    })
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));
}

/** Normalize one verification.completed payload; undefined when the shape is invalid. */
function verificationResultFromEvent(event: EventRecord): VerificationResult | undefined {
  if (event.type !== "verification.completed") return undefined;
  if (typeof event.payload !== "object" || event.payload === null) return undefined;
  const payload = event.payload as Partial<VerificationResult>;
  if (typeof payload.passed !== "boolean" || !Array.isArray(payload.commands)) return undefined;
  // Legacy payloads only had `passed` + `sourceUnchanged`; fill dimensional fields.
  const sourceCompatible = typeof payload.sourceCompatible === "boolean"
    ? payload.sourceCompatible
    : (typeof payload.sourceUnchanged === "boolean" ? payload.sourceUnchanged : true);
  const behaviorPassed = typeof payload.behaviorPassed === "boolean"
    ? payload.behaviorPassed
    : payload.commands.length > 0 && payload.commands.every((c) => c.exitCode === 0);
  const policyPassed = typeof payload.policyPassed === "boolean"
    ? payload.policyPassed
    : (payload.changeBudget?.effect === "hard-fail"
        ? false
        : (payload.changeBudget?.withinBudget ?? true)
          || payload.changeBudget?.effect === "warning"
          || payload.changeBudget?.effect === "score-evidence"
          || payload.changeBudget?.effect === "ignored")
      && payload.completionPolicy?.check !== "hard-fail";
  return {
    ...payload,
    passed: payload.passed,
    behaviorPassed,
    policyPassed,
    sourceCompatible,
    commands: payload.commands,
    diffPath: typeof payload.diffPath === "string" ? payload.diffPath : "",
    sourceUnchanged: typeof payload.sourceUnchanged === "boolean" ? payload.sourceUnchanged : true,
  } as VerificationResult;
}

/** Latest valid verification.completed — final machine/delivery projection. */
export function verificationFrom(events: EventRecord[]): VerificationResult | undefined {
  const event = [...events]
    .reverse()
    .find((candidate) => candidate.type === "verification.completed");
  return event === undefined ? undefined : verificationResultFromEvent(event);
}

/**
 * Earliest valid verification.completed by durable event sequence.
 * First-pass routing evidence only — never used for final delivery truth.
 * A later Main zero-Worker reverification on the same Attempt must not replace
 * the original Worker independent check.
 */
function earliestVerificationEventFrom(events: EventRecord[]): EventRecord | undefined {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence || a.id - b.id);
  for (const candidate of ordered) {
    const result = verificationResultFromEvent(candidate);
    if (result !== undefined) return candidate;
  }
  return undefined;
}

// --- Routing evidence -------------------------------------------------------

export interface RoutingOfficialCostGroup {
  currency: string;
  quotedAttemptCount: number;
  totalQuotedCost: number;
  avgQuotedCost: number;
}

/** Privacy-safe normalized budget envelope for one completed Attempt.
 *  null in either field means no finite frozen cap of that kind was set.
 *  Runtime USD is frozen per Attempt and the observed Token ceiling is frozen
 *  on the Task policy snapshot, so identical envelopes mean the runs actually
 *  had the same limits. */
export interface RoutingBudgetEnvelope {
  runtimeBudgetUsd: number | null;
  observedTokenCeiling: number | null;
}

/** Privacy-safe budget outcome evidence for one provider/model.
 *  Comparable bounded evidence means: every bounded Attempt used the same
 *  exact envelope and every bounded Attempt ended in a comparable outcome
 *  (succeeded / Main-remediated / behavior-passed / model-quality-failed
 *  counted as completed-without-exhaustion; canonical budget exhaustion
 *  counted as exhausted; credential / Provider / workspace / interruption
 *  / no-progress / unclassified outcomes are excluded from both counts
 *  but kept visible). Uncapped and legacy Attempts are kept visible as
 *  excluded uncapped count, never as zero-valued evidence. */
export interface RoutingBudgetEvidence {
  boundedSampleCount: number;
  completedWithoutExhaustionCount: number;
  /** null means there is no single comparable cohort; it is never a
   * synthetic zero for missing or mixed evidence. */
  completedWithoutExhaustionRate: number | null;
  budgetExhaustionCount: number;
  excludedUncappedCount: number;
  /** A USD cap was configured but this Attempt has no frozen proof that its
   * runtime enforced that cap. It is never treated as bounded evidence. */
  excludedUnknownEnforcementCount: number;
  excludedExternalFailureCount: number;
  /** Normalized envelope shared by every bounded sample, or null when no
   *  bounded samples exist or when bounded samples disagree. */
  envelope: RoutingBudgetEnvelope | null;
}

/** Closed token for a missing frozen Task execution mode. Never inferred. */
export const LEGACY_UNKNOWN_EXECUTION_MODE = "legacy-unknown" as const;

/** Frozen execution mode, or the closed unknown token when the Task omitted one. */
export type StrategyExecutionMode = ResolvedExecutionMode | typeof LEGACY_UNKNOWN_EXECUTION_MODE;

/** How routing evidence is grouped. `full-worker` is the existing Worker ranking
 *  identity and must stay mode-free. `full-worker-mode` is the parallel
 *  strategy identity and never borrows samples across modes. */
export type RoutingIdentityMode = "provider-model" | "full-worker" | "full-worker-mode";

/** Report a stored execution mode only when it is one of the three frozen
 *  values. Missing or unrecognized values stay `legacy-unknown`. */
export function frozenStrategyExecutionMode(
  spec: { executionMode?: unknown } | undefined,
): StrategyExecutionMode {
  const mode = spec?.executionMode;
  return mode === "single-run" || mode === "persistent-session" || mode === "native-goal"
    ? mode
    : LEGACY_UNKNOWN_EXECUTION_MODE;
}

/** Shared derivation/lookup key for one comparable execution strategy. */
export function strategyIdentityKey(
  provider: string,
  model: string,
  runtime: string,
  effort: string,
  executionMode: StrategyExecutionMode,
): string {
  return `${provider}\0${model}\0${runtime}\0${effort}\0${executionMode}`;
}

/** Privacy-safe, exact-task-class evidence for one provider/model. */
export interface RoutingEvidence {
  provider: string;
  model: string;
  /** Present for full-worker and full-worker-mode rows. */
  runtime?: string;
  /** Present for full-worker and full-worker-mode rows. */
  effort?: string;
  /** Present only on mode-aware rows. Missing frozen mode is `legacy-unknown`. */
  executionMode?: StrategyExecutionMode;
  /** All terminal Tasks observed for this exact class, including evidence that
   * is intentionally ignored for model-quality routing. */
  terminalTaskCount: number;
  /** Tasks with useful model evidence: accepted delivery, independently
   * passing behavior, or a model-quality behavior failure. */
  relevantSampleCount: number;
  modelQualityFailureCount: number;
  modelQualityFailureRate: number;
  ignoredNonModelFailures: Partial<Record<FailureCategory, number>>;
  ignoredNonModelTaskCount: number;
  ambiguousFailureCount: number;
  /** Explicit Main responsibility decisions only; aggregate and content-free. */
  failureAttributionCounts: {
    modelQuality: number;
    nonModel: number;
    ambiguous: number;
  };
  /** Explicit Main-requested Worker revisions plus Main repair deliveries. */
  correctionChurn: number;
  correctionChurnRate: number;
  /**
   * Main/delivery-backed final delivery only. Sample count is accepted +
   * not-accepted; unavailable stays visible and never becomes a synthetic zero.
   */
  acceptedDeliveryCount: number;
  acceptedDeliverySampleCount: number;
  acceptedDeliveryNotAcceptedCount: number;
  acceptedDeliveryUnavailableCount: number;
  acceptedDeliveryRate: number;
  verifiedBehaviorSampleCount: number;
  verifiedBehaviorCount: number;
  verifiedBehaviorRate: number;
  /**
   * First-Attempt independent verification only. Sample/success count Tasks
   * where Attempt one has comparable model behavior evidence; unavailable
   * covers missing verification and non-model external causes. Never rewritten
   * by later Attempts, final delivery, or Main repair.
   */
  firstPassVerifiedSampleCount: number;
  firstPassVerifiedSuccessCount: number;
  firstPassVerifiedSuccessRate: number;
  firstPassUnavailableCount: number;
  /** Every Attempt on every relevant Task contributes either one exact quote
   * or one typed unavailable reason. Missing records are never zero. */
  officialCostAttemptCount: number;
  officialCostQuotedAttemptCount: number;
  officialCostUnavailableCount: number;
  officialCostUnavailableReasons: Record<string, number>;
  officialCostByCurrency: RoutingOfficialCostGroup[];
  durationSampleCount: number;
  avgDurationMs?: number;
  /** Budget outcome evidence for the optional budgetReliability factor. */
  budgetReliability: RoutingBudgetEvidence;
}

/** Derive a normalized budget envelope from one terminal Attempt.
 *  Safe finite-number handling: null means "no finite frozen cap of this
 *  kind", which is not the same as 0 / Infinity. Legacy tasks without an
 *  effectivePolicy snapshot map to an uncapped envelope (null + null). */
export function normalizeBudgetEnvelope(
  runtimeBudgetUsd: number | null | undefined,
  observedTokenCeiling: number | null | undefined,
): RoutingBudgetEnvelope {
  return {
    runtimeBudgetUsd: typeof runtimeBudgetUsd === "number" && Number.isFinite(runtimeBudgetUsd) && runtimeBudgetUsd > 0
      ? runtimeBudgetUsd
      : null,
    observedTokenCeiling: typeof observedTokenCeiling === "number" && Number.isFinite(observedTokenCeiling) && observedTokenCeiling > 0
      ? observedTokenCeiling
      : null,
  };
}

function envelopesEqual(
  left: RoutingBudgetEnvelope,
  right: RoutingBudgetEnvelope,
): boolean {
  return left.runtimeBudgetUsd === right.runtimeBudgetUsd
    && left.observedTokenCeiling === right.observedTokenCeiling;
}

function attemptRuntimeBudget(
  attempt: AttemptRecord,
  task: TaskRecord,
): number | null | undefined {
  return Object.prototype.hasOwnProperty.call(attempt, "runtimeBudgetUsd")
    ? attempt.runtimeBudgetUsd
    : task.spec.runtime?.maxBudgetUsd;
}

function attemptEvents(item: TaskEvidence, attemptId: string): EventRecord[] {
  return item.events.filter((event) => event.attemptId === attemptId);
}

function earliestAttempt(attempts: AttemptRecord[]): AttemptRecord | undefined {
  return [...attempts].sort((a, b) => a.ordinal - b.ordinal)[0];
}

/** First-pass outcome for the earliest Attempt only.
 *  success / failure enter the comparable denominator; unavailable stays visible
 *  but never becomes a synthetic zero or model failure. */
export type FirstPassOutcome = "success" | "failure" | "unavailable";

/**
 * Classify only the earliest Attempt using its own attempt-bound verification
 * and failure evidence. Later Attempts, final Task status, Main-repaired
 * delivery, and final Integration never rewrite this outcome.
 */
export function classifyFirstPassOutcome(
  item: TaskEvidence,
  getDisposition?: (taskId: string) => RemediationDisposition | undefined,
): FirstPassOutcome {
  const first = earliestAttempt(item.attempts);
  if (first === undefined) return "unavailable";

  // Bind verification to this Attempt id only — never borrow a later run.
  // Use the earliest valid verification on Attempt one so a later Main
  // reverification of the same Candidate cannot rewrite Worker first-pass truth.
  const ownEvents = attemptEvents(item, first.id);
  const verificationEvent = earliestVerificationEventFrom(ownEvents);
  const verification = verificationEvent === undefined
    ? undefined
    : verificationResultFromEvent(verificationEvent);

  // Durable Provider/connectivity and budget evidence wins over a coincidental
  // passing behavior check. These runs are operationally inconclusive for
  // first-pass model quality and must not inflate the success rate.
  const durableFailureCategory = failureCategoryFromEvents(ownEvents);
  if (
    durableFailureCategory === "connectivity"
    || durableFailureCategory === "budget"
    || ownEvents.some((event) => event.type === "policy.token.exceeded")
  ) {
    return "unavailable";
  }

  if (first.status !== "succeeded") {
    const attemptFailure = classifyAttemptFailure(first, ownEvents);
    if (
      attemptFailure?.impact === "non-model"
      && attemptFailure.category !== "verification"
    ) {
      return "unavailable";
    }
  }

  // Behavior passed on Attempt one is first-pass success even when policy-only
  // gates fail overall. Final delivery and Integration are not consulted.
  if (verification?.behaviorPassed === true) {
    return "success";
  }

  // Main-authored acceptance contradiction after formally amended delivery is
  // not model first-pass evidence.
  if (getDisposition?.(item.task.id)?.acceptanceBasis === "amended-acceptance") {
    return "unavailable";
  }

  // First-pass failure requires own durable verification attributable to model
  // behavior. Missing verification and non-model external causes stay unavailable.
  if (verification !== undefined && verification.behaviorPassed === false) {
    let classification = classifyFailure({
      taskStatus: "failed",
      attemptStatus: first.status,
      ...(first.exitCode === undefined ? {} : { attemptExitCode: first.exitCode }),
      verification,
      ...(first.error === undefined ? {} : { error: first.error }),
    });
    if (verificationEvent !== undefined) {
      const attribution = resolveMainFailureAttribution(
        item.events, first.id, verificationEvent.sequence,
      );
      if (attribution !== undefined) {
        classification = { ...classification, impact: attribution.impact };
      }
    }
    if (classification.impact === "model-quality") {
      return "failure";
    }
  }

  return "unavailable";
}

/** Classify one Attempt from its own durable evidence. A later correction must
 * not hide an earlier budget exhaustion or lend its verification to that run. */
function classifyAttemptFailure(
  attempt: AttemptRecord,
  events: EventRecord[],
): FailureClassification | undefined {
  if (attempt.status === "succeeded") return undefined;
  if (
    events.some((event) => event.type === "policy.token.exceeded")
    || failureCategoryFromEvents(events) === "budget"
  ) {
    return {
      category: "budget",
      reason: "Runtime USD budget or observed Token ceiling exhausted",
      diagnostic: attempt.error ?? "",
      impact: "non-model",
    };
  }
  // Durable Worker connectivity is Provider/infrastructure, never model quality.
  if (failureCategoryFromEvents(events) === "connectivity") {
    return {
      category: "provider",
      reason: "Provider connectivity or transport failure",
      diagnostic: attempt.error ?? "",
      impact: "non-model",
    };
  }
  const attemptVerification = verificationFrom(events);
  return classifyFailure({
    taskStatus: attempt.status,
    attemptStatus: attempt.status,
    ...(attempt.exitCode === undefined ? {} : { attemptExitCode: attempt.exitCode }),
    ...(attemptVerification === undefined ? {} : { verification: attemptVerification }),
    ...(attempt.error === undefined ? {} : { error: attempt.error }),
  });
}

export interface DeriveRoutingEvidenceInput {
  taskClass: string;
  /** When set, match tasks by taskFamily instead of taskClass.
   *  Family evidence is for complete-set fallback only — never mixed with exact. */
  taskFamily?: string;
  history: TaskEvidence[];
  hasPassingDisposition?: (taskId: string) => boolean;
  /**
   * Optional disposition lookup. When a verified amended-acceptance delivery
   * exists, model-quality blame is suppressed while machine failure stays visible.
   */
  getDisposition?: (taskId: string) => RemediationDisposition | undefined;
  /** Durable applied Integration presence — legacy delivery evidence. */
  hasAppliedIntegration?: (taskId: string) => boolean;
  /** New decisions compare the complete frozen Worker identity. Legacy callers
   * may explicitly aggregate by provider/model. `full-worker-mode` is the
   * parallel strategy identity and is never used for existing Worker ranking. */
  identityMode?: RoutingIdentityMode;
}

function officialCostUnavailableReason(attempt: AttemptRecord): string {
  const cost = attempt.officialCost;
  if (cost === undefined) return "missing:missing-officialCost-record";
  if (cost.quoted) return "";
  if (cost.stage === "calculation") return "calculation:" + cost.result.reason;
  return cost.stage + ":" + cost.reason;
}

/** Derive routing evidence without changing stored history. Non-model and
 * ambiguous failures remain visible but do not increase sample sufficiency or
 * model-quality failure rate unless independent behavior itself passed. */
export function deriveRoutingEvidence(input: DeriveRoutingEvidenceInput): Map<string, RoutingEvidence> {
  const useFamily = input.taskFamily !== undefined;
  const groups = new Map<string, TaskEvidence[]>();
  for (const item of input.history) {
    if (!isTerminalTaskStatus(item.task.status)) continue;
    if (input.identityMode === "full-worker-mode"
      && isReviewGraphReviewerTaskFile(item.task.taskFile)) {
      continue;
    }
    if (useFamily) {
      if (item.task.spec.taskFamily !== input.taskFamily) continue;
    } else {
      if (item.task.spec.taskClass !== input.taskClass) continue;
    }
    const providerModel = item.task.spec.provider.name + "\0" + item.task.spec.provider.model;
    const runtime = item.task.spec.runtime;
    if (
      (input.identityMode === "full-worker" || input.identityMode === "full-worker-mode")
      && runtime === undefined
    ) {
      continue;
    }
    const key = input.identityMode === "full-worker-mode"
      ? strategyIdentityKey(
          item.task.spec.provider.name,
          item.task.spec.provider.model,
          runtime!.name,
          runtime!.effort,
          frozenStrategyExecutionMode(item.task.spec),
        )
      : input.identityMode === "full-worker"
        ? providerModel + "\0" + runtime!.name + "\0" + runtime!.effort
        : providerModel;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  const result = new Map<string, RoutingEvidence>();
  for (const [key, items] of groups) {
    const parts = key.split("\0");
    const provider = parts[0] ?? "";
    const model = parts[1] ?? "";
    const runtimeName = parts[2];
    const effortName = parts[3];
    const modeToken = parts[4];
    const evidence: RoutingEvidence = {
      provider,
      model,
      ...(input.identityMode === "full-worker" || input.identityMode === "full-worker-mode"
        ? {
            runtime: runtimeName ?? "",
            effort: effortName ?? "",
          }
        : {}),
      ...(input.identityMode === "full-worker-mode"
        ? {
            executionMode: modeToken === "single-run"
              || modeToken === "persistent-session"
              || modeToken === "native-goal"
              ? modeToken
              : LEGACY_UNKNOWN_EXECUTION_MODE,
          }
        : {}),
      terminalTaskCount: items.length,
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
    const durations: number[] = [];
    const costs = new Map<string, { count: number; total: number }>();
    let candidateEnvelope: RoutingBudgetEnvelope | null = null;
    let candidateEnvelopeMixed = false;

    const deliveryInput: FinalDeliveryEvidenceInput = {
      ...(input.hasPassingDisposition === undefined
        ? {}
        : { hasPassingDisposition: input.hasPassingDisposition }),
      ...(input.getDisposition === undefined ? {} : { getDisposition: input.getDisposition }),
      ...(input.hasAppliedIntegration === undefined
        ? {}
        : { hasAppliedIntegration: input.hasAppliedIntegration }),
    };

    for (const item of items) {
      const disposition = input.getDisposition?.(item.task.id);
      const passingDisposition =
        disposition !== undefined
        || (input.hasPassingDisposition?.(item.task.id) ?? false);
      // Main-authored acceptance mistakes must not become model-quality evidence
      // after a verified amended-acceptance delivery. Machine failure stays
      // visible via terminal Task status and failure listings elsewhere.
      const amendedAcceptance = disposition?.acceptanceBasis === "amended-acceptance";

      const terminalVerificationEvent = latestVerificationEvent(item.events);
      if (terminalVerificationEvent?.attemptId !== undefined) {
        const attribution = resolveMainFailureAttribution(
          item.events, terminalVerificationEvent.attemptId, terminalVerificationEvent.sequence,
        );
        if (attribution?.impact === "model-quality") evidence.failureAttributionCounts.modelQuality += 1;
        else if (attribution?.impact === "non-model") evidence.failureAttributionCounts.nonModel += 1;
        else if (attribution?.impact === "ambiguous") evidence.failureAttributionCounts.ambiguous += 1;
      }

      // First-pass verified success is independent of eventual delivery and of
      // the relevant-sample gate below. Every terminal Task contributes exactly
      // one first-pass classification for Attempt one.
      const firstPass = classifyFirstPassOutcome(item, input.getDisposition);
      if (firstPass === "success") {
        evidence.firstPassVerifiedSampleCount += 1;
        evidence.firstPassVerifiedSuccessCount += 1;
      } else if (firstPass === "failure") {
        evidence.firstPassVerifiedSampleCount += 1;
      } else {
        evidence.firstPassUnavailableCount += 1;
      }

      // Final delivery is independent of the relevant-sample gate and of
      // machine success. Every terminal Task contributes exactly one outcome.
      accumulateFinalDelivery(evidence, classifyFinalDeliveryOutcome(item, deliveryInput));

      let classification: FailureClassification | undefined;
      if (item.task.status !== "succeeded") {
        classification = classifyTerminalFailure(item, input.getDisposition);
        if (classification !== undefined) {
          if (classification.impact === "non-model") {
            evidence.ignoredNonModelTaskCount += 1;
            evidence.ignoredNonModelFailures[classification.category] =
              (evidence.ignoredNonModelFailures[classification.category] ?? 0) + 1;
          } else if (classification.impact === "ambiguous") {
            evidence.ambiguousFailureCount += 1;
          }
        }
      }

      const behaviorPassed = item.verification?.behaviorPassed === true;
      const relevant = item.task.status === "succeeded"
        || passingDisposition
        || behaviorPassed
        || classification?.impact === "model-quality";

      // --- Budget outcome evidence (opt-in budgetReliability factor) ---
      // Each Attempt keeps its own runtime budget. This matters for explicit
      // correction grants, which may use a different cap from the original
      // Task. A later success never erases an earlier exhausted Attempt.
      for (const attempt of item.attempts) {
        if (attempt.status === "running") continue;
        const configuredRuntimeBudget = attemptRuntimeBudget(attempt, item.task);
        const finiteRuntimeBudget = normalizeBudgetEnvelope(configuredRuntimeBudget, null)
          .runtimeBudgetUsd;
        const runtimeBudgetIsEnforced = finiteRuntimeBudget !== null
          && attempt.runtimeBudgetEnforcement === "supported";
        const observedTokenCeiling = item.task.effectivePolicy?.values.observedTokenCeiling ?? null;
        const envelope = normalizeBudgetEnvelope(
          runtimeBudgetIsEnforced ? finiteRuntimeBudget : null,
          observedTokenCeiling,
        );
        const hasFiniteCap = envelope.runtimeBudgetUsd !== null
          || envelope.observedTokenCeiling !== null;
        if (!hasFiniteCap) {
          if (finiteRuntimeBudget !== null) {
            evidence.budgetReliability.excludedUnknownEnforcementCount += 1;
          } else {
            evidence.budgetReliability.excludedUncappedCount += 1;
          }
          continue;
        }

        const ownEvents = attemptEvents(item, attempt.id);
        const attemptClassification = classifyAttemptFailure(attempt, ownEvents);
        const exhausted = attemptClassification?.category === "budget";
        const completedWithoutExhaustion = attempt.status === "succeeded"
          || attemptClassification?.impact === "model-quality"
          || verificationFrom(ownEvents)?.behaviorPassed === true
          || (passingDisposition && amendedAcceptance);
        if (!exhausted && !completedWithoutExhaustion) {
          evidence.budgetReliability.excludedExternalFailureCount += 1;
          continue;
        }

        evidence.budgetReliability.boundedSampleCount += 1;
        if (exhausted) {
          evidence.budgetReliability.budgetExhaustionCount += 1;
        } else {
          evidence.budgetReliability.completedWithoutExhaustionCount += 1;
        }
        if (!candidateEnvelopeMixed) {
          if (candidateEnvelope === null) {
            candidateEnvelope = envelope;
          } else if (!envelopesEqual(candidateEnvelope, envelope)) {
            candidateEnvelopeMixed = true;
            candidateEnvelope = null;
          }
        }
      }

      if (!relevant) continue;

      evidence.relevantSampleCount += 1;
      // Amended-acceptance deliveries are non-model contract evidence.
      if (classification?.impact === "model-quality" && !amendedAcceptance) {
        evidence.modelQualityFailureCount += 1;
      }
      if (item.verification !== undefined) {
        evidence.verifiedBehaviorSampleCount += 1;
        if (behaviorPassed) evidence.verifiedBehaviorCount += 1;
      }

      evidence.correctionChurn += item.events.filter(
        (event) => event.type === "task.revise.requested",
      ).length;
      if (passingDisposition) evidence.correctionChurn += 1;

      const duration = millisecondsBetween(item.task.startedAt, item.task.finishedAt);
      if (duration !== undefined) durations.push(duration);

      if (item.attempts.length === 0) {
        evidence.officialCostUnavailableCount += 1;
        evidence.officialCostUnavailableReasons["missing:no-attempt"] =
          (evidence.officialCostUnavailableReasons["missing:no-attempt"] ?? 0) + 1;
      }
      for (const attempt of item.attempts) {
        evidence.officialCostAttemptCount += 1;
        const officialCost = attempt.officialCost;
        if (officialCost?.quoted) {
          evidence.officialCostQuotedAttemptCount += 1;
          const currency = officialCost.result.currency;
          const aggregate = costs.get(currency) ?? { count: 0, total: 0 };
          aggregate.count += 1;
          aggregate.total += officialCost.result.total;
          costs.set(currency, aggregate);
        } else {
          evidence.officialCostUnavailableCount += 1;
          const reason = officialCostUnavailableReason(attempt);
          evidence.officialCostUnavailableReasons[reason] =
            (evidence.officialCostUnavailableReasons[reason] ?? 0) + 1;
        }
      }
    }

    if (evidence.relevantSampleCount > 0) {
      evidence.modelQualityFailureRate =
        evidence.modelQualityFailureCount / evidence.relevantSampleCount;
      evidence.correctionChurnRate = evidence.correctionChurn / evidence.relevantSampleCount;
    }
    if (evidence.acceptedDeliverySampleCount > 0) {
      evidence.acceptedDeliveryRate =
        evidence.acceptedDeliveryCount / evidence.acceptedDeliverySampleCount;
    }
    if (evidence.verifiedBehaviorSampleCount > 0) {
      evidence.verifiedBehaviorRate =
        evidence.verifiedBehaviorCount / evidence.verifiedBehaviorSampleCount;
    }
    if (evidence.firstPassVerifiedSampleCount > 0) {
      evidence.firstPassVerifiedSuccessRate =
        evidence.firstPassVerifiedSuccessCount / evidence.firstPassVerifiedSampleCount;
    }
    evidence.durationSampleCount = durations.length;
    if (durations.length > 0) {
      evidence.avgDurationMs = durations.reduce((sum, value) => sum + value, 0) / durations.length;
    }
    evidence.officialCostByCurrency = [...costs.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, aggregate]) => ({
        currency,
        quotedAttemptCount: aggregate.count,
        totalQuotedCost: aggregate.total,
        avgQuotedCost: aggregate.total / aggregate.count,
      }));
    // Finalize the budget envelope / rate only when bounded samples agree.
    if (candidateEnvelopeMixed || evidence.budgetReliability.boundedSampleCount === 0) {
      evidence.budgetReliability.envelope = null;
    } else {
      evidence.budgetReliability.envelope = candidateEnvelope;
      evidence.budgetReliability.completedWithoutExhaustionRate =
        evidence.budgetReliability.completedWithoutExhaustionCount
          / evidence.budgetReliability.boundedSampleCount;
    }
    result.set(key, evidence);
  }
  return result;
}

// --- Routing-evidence coverage (portfolio readiness, not model quality) ------

/**
 * Privacy-safe aggregate describing how many finished ordinary Tasks carry the
 * classification and Main-authored Worker-selection facts needed for later
 * learning. Counts are explicit presence only; never inferred, never scored.
 */
export interface RoutingEvidenceCoverage {
  /** Terminal ordinary (non-reviewer) Tasks in the eligible cohort. */
  eligibleTerminalTaskCount: number;
  /** Eligible Tasks with an explicit non-empty taskClass. Never inferred. */
  withTaskClassCount: number;
  /** Eligible Tasks with an explicit non-empty taskFamily. Never inferred. */
  withTaskFamilyCount: number;
  /**
   * Eligible Tasks that simultaneously carry non-empty taskClass, non-empty
   * taskFamily, and a stored routingDecision. Presence only: TaskSpec storage
   * already validates routingDecision shape; this projection does not re-parse
   * decision fields or read private reasons.
   */
  withCompleteRoutingDecisionCount: number;
  /** Distinct non-empty taskClass values among eligible Tasks (diversity only). */
  distinctTaskClassCount: number;
  /** Distinct non-empty taskFamily values among eligible Tasks (diversity only). */
  distinctTaskFamilyCount: number;
  /**
   * Complete tasks where the frozen shortlist contains exactly one Worker.
   * This is not evidence failure — it means Main intentionally avoided a
   * multi-Worker comparison (e.g. cost-saving, only-available, user-specified).
   */
  singleWorkerDecisionCount: number;
  /**
   * Complete tasks where the frozen shortlist contains at least two Workers
   * AND the frozen evidence scope is exact-class or task-family.
   * These Tasks had fair cross-Worker comparison evidence at decision time.
   */
  comparableMultiWorkerDecisionCount: number;
  /**
   * Sub-count of comparableMultiWorker: scope was exact-class.
   * Never exceeds comparableMultiWorkerDecisionCount.
   */
  comparableExactClassDecisionCount: number;
  /**
   * Sub-count of comparableMultiWorker: scope was task-family.
   * Never exceeds comparableMultiWorkerDecisionCount.
   */
  comparableTaskFamilyDecisionCount: number;
  /**
   * Complete tasks where the frozen shortlist contains at least two Workers
   * BUT the frozen evidence scope was "none". Main had no comparable evidence
   * at decision time; the choice reflects Main judgment, not a model ranking.
   * This is not a tie, not an automatic choice, and not Competition evidence.
   */
  unknownMultiWorkerDecisionCount: number;
  /**
   * Complete tasks whose stored routingDecision lacks a usable shortlist or
   * evidence scope, or whose scope value cannot be safely interpreted.
   * Never falls back to guessing; never counted as comparison evidence.
   */
  unusableDecisionCount: number;
}

function hasExplicitLabel(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** True when a Task stores a routingDecision object. Shape is not re-validated. */
function hasStoredRoutingDecision(raw: unknown): boolean {
  return raw !== null && raw !== undefined && typeof raw === "object" && !Array.isArray(raw);
}

/**
 * Mutually exclusive decision-time readiness classification for one complete
 * routing decision.  Reads only the frozen shortlist and evidenceSnapshot.scope
 * stored at Task creation time — never events, attempts, scores, or private reasons.
 * The four outcomes are exact and exhaustive for any valid RoutingDecisionSnapshot.
 */
export type DecisionReadinessBucket =
  | "single-worker"
  | "comparable-multi-worker"
  | "unknown-multi-worker"
  | "unusable";

export interface ClassifiedDecision {
  bucket: DecisionReadinessBucket;
  /** Present only when bucket is comparable-multi-worker. */
  scope?: "exact-class" | "task-family";
}

function isFrozenWorkerIdentity(value: unknown): value is FrozenWorkerIdentity {
  if (value === null || value === undefined || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.provider === "string"
    && typeof obj.model === "string"
    && typeof obj.runtime === "string"
    && typeof obj.effort === "string";
}

function isValidScope(value: unknown): value is "exact-class" | "task-family" | "none" {
  return value === "exact-class" || value === "task-family" || value === "none";
}

function frozenWorkerIdentityKey(worker: FrozenWorkerIdentity): string {
  return [worker.provider, worker.model, worker.runtime, worker.effort]
    .map((part) => part.trim())
    .join("\u0000");
}

/**
 * Fail-closed classifier: reads only the frozen shortlist.length and
 * evidenceSnapshot.scope from a durable routingDecision.  Returns
 * exactly one bucket for any valid stored shape; malformed shapes
 * return "unusable" without throwing.
 */
export function classifyDecisionReadiness(
  decision: RoutingDecisionSnapshot,
): ClassifiedDecision {
  if (!Array.isArray(decision.shortlist)) {
    return { bucket: "unusable" };
  }
  const validWorkers = decision.shortlist.filter((worker): worker is FrozenWorkerIdentity =>
    isFrozenWorkerIdentity(worker)
    && worker.provider.trim().length > 0
    && worker.model.trim().length > 0
    && worker.runtime.trim().length > 0
    && worker.effort.trim().length > 0);
  if (validWorkers.length !== decision.shortlist.length || validWorkers.length === 0) {
    return { bucket: "unusable" };
  }

  const scope = (decision.evidenceSnapshot as Record<string, unknown> | null)?.scope;
  if (!isValidScope(scope)) {
    return { bucket: "unusable" };
  }

  const distinctWorkerCount = new Set(validWorkers.map(frozenWorkerIdentityKey)).size;
  if (distinctWorkerCount !== validWorkers.length) {
    return { bucket: "unusable" };
  }

  if (validWorkers.length === 1) {
    return { bucket: "single-worker" };
  }

  // Multi-Worker shortlist: scope determines comparability.
  if (scope === "none") {
    return { bucket: "unknown-multi-worker" };
  }
  return {
    bucket: "comparable-multi-worker",
    scope,
  };
}

/**
 * Canonical read-only coverage projection over durable Task records.
 * Excludes Review Graph reviewer Tasks. Never infers missing metadata,
 * never scores models, and never returns Task content.
 */
export function computeRoutingEvidenceCoverage(
  tasks: readonly TaskRecord[],
): RoutingEvidenceCoverage {
  let eligibleTerminalTaskCount = 0;
  let withTaskClassCount = 0;
  let withTaskFamilyCount = 0;
  let withCompleteRoutingDecisionCount = 0;
  let singleWorkerDecisionCount = 0;
  let comparableMultiWorkerDecisionCount = 0;
  let comparableExactClassDecisionCount = 0;
  let comparableTaskFamilyDecisionCount = 0;
  let unknownMultiWorkerDecisionCount = 0;
  let unusableDecisionCount = 0;
  const distinctClasses = new Set<string>();
  const distinctFamilies = new Set<string>();

  for (const task of tasks) {
    if (!isTerminalTaskStatus(task.status)) continue;
    if (isReviewGraphReviewerTaskFile(task.taskFile)) continue;

    eligibleTerminalTaskCount += 1;
    const taskClass = task.spec?.taskClass;
    const hasClass = hasExplicitLabel(taskClass);
    if (hasClass) {
      withTaskClassCount += 1;
      distinctClasses.add((taskClass as string).trim());
    }
    const taskFamily = task.spec?.taskFamily;
    const hasFamily = hasExplicitLabel(taskFamily);
    if (hasFamily) {
      withTaskFamilyCount += 1;
      distinctFamilies.add((taskFamily as string).trim());
    }
    // Complete selection evidence requires all three facts on the same Task.
    // A stored routingDecision alone is incomplete without class and family.
    if (hasClass && hasFamily && hasStoredRoutingDecision(task.spec?.routingDecision)) {
      withCompleteRoutingDecisionCount += 1;
      // Classify decision-time readiness from the frozen routingDecision.
      const classification = classifyDecisionReadiness(
        task.spec!.routingDecision as RoutingDecisionSnapshot,
      );
      switch (classification.bucket) {
        case "single-worker":
          singleWorkerDecisionCount += 1;
          break;
        case "comparable-multi-worker":
          comparableMultiWorkerDecisionCount += 1;
          if (classification.scope === "exact-class") {
            comparableExactClassDecisionCount += 1;
          } else if (classification.scope === "task-family") {
            comparableTaskFamilyDecisionCount += 1;
          }
          break;
        case "unknown-multi-worker":
          unknownMultiWorkerDecisionCount += 1;
          break;
        case "unusable":
          unusableDecisionCount += 1;
          break;
        default: {
          const _exhaustive: never = classification.bucket;
          void _exhaustive;
          unusableDecisionCount += 1;
        }
      }
    }
  }

  return {
    eligibleTerminalTaskCount,
    withTaskClassCount,
    withTaskFamilyCount,
    withCompleteRoutingDecisionCount,
    distinctTaskClassCount: distinctClasses.size,
    distinctTaskFamilyCount: distinctFamilies.size,
    singleWorkerDecisionCount,
    comparableMultiWorkerDecisionCount,
    comparableExactClassDecisionCount,
    comparableTaskFamilyDecisionCount,
    unknownMultiWorkerDecisionCount,
    unusableDecisionCount,
  };
}

export class StatisticsService {
  constructor(private readonly store: StateStore) {}

  summarize(filter: StatisticsFilter = {}): ProviderModelSummary[] {
    const history = this.store.listTasks()
      .filter((task) => isTerminalTaskStatus(task.status))
      .map((task): TaskEvidence => {
        const events = this.store.listEvents(task.id);
        const verification = verificationFrom(events);
        return {
          task,
          attempts: this.store.listAttempts(task.id),
          events,
          ...(verification === undefined ? {} : { verification }),
        };
      });
    return computeStatistics(history, filter, {
      checksCount: (taskId) => this.store.getRemediationChecks(taskId).length,
      hasPassingDisposition: (taskId) => {
        const d = this.store.getRemediationDisposition(taskId);
        return d !== undefined;
      },
      getDisposition: (taskId) => this.store.getRemediationDisposition(taskId),
      hasAppliedIntegration: (taskId) =>
        this.store.listIntegrationResults(taskId).some((result) => result.status === "applied"),
    });
  }

  /** Derive routing evidence for the exact taskClass from all terminal
   *  Tasks.  Read-only — never mutates state. */
  routingEvidence(
    taskClass: string,
    identityMode: RoutingIdentityMode = "provider-model",
  ): Map<string, RoutingEvidence> {
    const history = this.store.listTasks()
      .filter((task) => isTerminalTaskStatus(task.status))
      .map((task): TaskEvidence => {
        const events = this.store.listEvents(task.id);
        const verification = verificationFrom(events);
        return {
          task,
          attempts: this.store.listAttempts(task.id),
          events,
          ...(verification === undefined ? {} : { verification }),
        };
      });
    return deriveRoutingEvidence({
      taskClass,
      identityMode,
      history,
      hasPassingDisposition: (taskId) =>
        this.store.getRemediationDisposition(taskId) !== undefined,
      getDisposition: (taskId) => this.store.getRemediationDisposition(taskId),
      hasAppliedIntegration: (taskId) =>
        this.store.listIntegrationResults(taskId).some((result) => result.status === "applied"),
    });
  }

  /** Derive routing evidence for an explicit taskFamily from all terminal
   *  Tasks with that family.  Read-only — never mutates state.
   *  Family evidence is only comparable when every candidate has enough
   *  family-scoped samples; it never replaces exact taskClass for audit or
   *  Direct Codex Token calibration. */
  routingEvidenceByFamily(
    taskFamily: string,
    identityMode: RoutingIdentityMode = "provider-model",
  ): Map<string, RoutingEvidence> {
    // Collect all terminal tasks (deriveRoutingEvidence filters by family inside).
    const history = this.store.listTasks()
      .filter((task) => isTerminalTaskStatus(task.status))
      .map((task): TaskEvidence => {
        const events = this.store.listEvents(task.id);
        const verification = verificationFrom(events);
        return {
          task,
          attempts: this.store.listAttempts(task.id),
          events,
          ...(verification === undefined ? {} : { verification }),
        };
      });
    return deriveRoutingEvidence({
      taskClass: taskFamily, // retained for output labeling; actual filter is taskFamily
      taskFamily,
      identityMode,
      history,
      hasPassingDisposition: (taskId) =>
        this.store.getRemediationDisposition(taskId) !== undefined,
      getDisposition: (taskId) => this.store.getRemediationDisposition(taskId),
      hasAppliedIntegration: (taskId) =>
        this.store.listIntegrationResults(taskId).some((result) => result.status === "applied"),
    });
  }

  /** Mode-aware exact-class evidence. Parallel to Worker ranking; never
   *  merges execution modes or infers a missing frozen mode. */
  modeAwareRoutingEvidence(taskClass: string): Map<string, RoutingEvidence> {
    return this.routingEvidence(taskClass, "full-worker-mode");
  }

  /** Mode-aware family evidence. Complete-set fallback only. */
  modeAwareRoutingEvidenceByFamily(taskFamily: string): Map<string, RoutingEvidence> {
    return this.routingEvidenceByFamily(taskFamily, "full-worker-mode");
  }

  /**
   * Portfolio coverage of classification + Main-authored Worker-selection
   * evidence. Read-only — never mutates state, never calls a Provider, never
   * scores a model. Review Graph reviewer Tasks are excluded.
   */
  routingEvidenceCoverage(): RoutingEvidenceCoverage {
    return computeRoutingEvidenceCoverage(this.store.listTasks());
  }
}
