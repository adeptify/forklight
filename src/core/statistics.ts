import type { StateStore } from "../state/store.js";
import { isTerminalTaskStatus } from "./task-progress.js";
import { failureCategoryFromEvents } from "./worker-failure.js";
import type {
  AttemptRecord,
  AttemptStatus,
  EventRecord,
  RemediationDisposition,
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

export interface ProviderModelSummary {
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
  failures: FailureEvidence[];
  /** Main-remediated delivery counts — parallel to machine success, never replacing it. */
  acceptedDeliveryCount: number;
  acceptedDeliveryRate: number;
  mainRepairedDeliveryCount: number;
  remediationCheckCount: number;
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

function summaryFor(
  provider: string,
  model: string,
  evidence: TaskEvidence[],
  remediationChecksCount: (taskId: string) => number,
  hasPassingDisposition: (taskId: string) => boolean,
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
    const classification = failureCategoryFromEvents(item.events) === "connectivity"
      ? {
          category: "provider" as const,
          reason: "Provider connectivity or transport failure",
          diagnostic: item.task.error ?? "",
          impact: "non-model" as const,
        }
      : classifyFailure({
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

  // Remediation delivery counts: parallel to machine success, never mutating it.
  const mainRepairedCount = evidence.filter(
    ({ task }) => hasPassingDisposition(task.id),
  ).length;
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
    failures,
    acceptedDeliveryCount: successCount + mainRepairedCount,
    acceptedDeliveryRate: evidence.length > 0
      ? (successCount + mainRepairedCount) / evidence.length
      : 0,
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
  const noopPassingDisposition = (): boolean => false;
  const checksCount = remediationData?.checksCount ?? noopChecksCount;
  const hasPassing = remediationData?.hasPassingDisposition ?? noopPassingDisposition;

  return [...groups.entries()]
    .map(([key, items]) => {
      const [provider = "", model = ""] = key.split("\0");
      return summaryFor(provider, model, items, checksCount, hasPassing);
    })
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));
}

export function verificationFrom(events: EventRecord[]): VerificationResult | undefined {
  const event = [...events]
    .reverse()
    .find((candidate) => candidate.type === "verification.completed");
  if (!event || typeof event.payload !== "object" || event.payload === null) return undefined;
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

/** Privacy-safe, exact-task-class evidence for one provider/model. */
export interface RoutingEvidence {
  provider: string;
  model: string;
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
  /** Explicit Main-requested Worker revisions plus Main repair deliveries. */
  correctionChurn: number;
  correctionChurnRate: number;
  acceptedDeliveryCount: number;
  acceptedDeliveryRate: number;
  verifiedBehaviorSampleCount: number;
  verifiedBehaviorCount: number;
  verifiedBehaviorRate: number;
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
  /** New decisions compare the complete frozen Worker identity. Legacy callers
   * may explicitly aggregate by provider/model. */
  identityMode?: "provider-model" | "full-worker";
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
    if (useFamily) {
      if (item.task.spec.taskFamily !== input.taskFamily) continue;
    } else {
      if (item.task.spec.taskClass !== input.taskClass) continue;
    }
    const providerModel = item.task.spec.provider.name + "\0" + item.task.spec.provider.model;
    const runtime = item.task.spec.runtime;
    if (input.identityMode === "full-worker" && runtime === undefined) continue;
    const key = input.identityMode === "full-worker"
      ? providerModel + "\0" + runtime!.name + "\0" + runtime!.effort
      : providerModel;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  const result = new Map<string, RoutingEvidence>();
  for (const [key, items] of groups) {
    const [provider = "", model = ""] = key.split("\0");
    const evidence: RoutingEvidence = {
      provider,
      model,
      terminalTaskCount: items.length,
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
    const durations: number[] = [];
    const costs = new Map<string, { count: number; total: number }>();
    let candidateEnvelope: RoutingBudgetEnvelope | null = null;
    let candidateEnvelopeMixed = false;

    for (const item of items) {
      const disposition = input.getDisposition?.(item.task.id);
      const passingDisposition =
        disposition !== undefined
        || (input.hasPassingDisposition?.(item.task.id) ?? false);
      // Main-authored acceptance mistakes must not become model-quality evidence
      // after a verified amended-acceptance delivery. Machine failure stays
      // visible via terminal Task status and failure listings elsewhere.
      const amendedAcceptance = disposition?.acceptanceBasis === "amended-acceptance";
      let classification: FailureClassification | undefined;
      if (item.task.status !== "succeeded") {
        const attempt = latestAttempt(item.attempts);
        classification = failureCategoryFromEvents(item.events) === "connectivity"
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
        if (amendedAcceptance && classification.impact === "model-quality") {
          // Main-authored acceptance mistakes are contract-infeasible non-model
          // evidence after verified amended delivery — never model-quality.
          classification = {
            category: "contract-infeasible",
            reason: "Main amended acceptance after verified amended delivery",
            diagnostic: classification.diagnostic,
            impact: "non-model",
          };
        }
        if (classification.impact === "non-model") {
          evidence.ignoredNonModelTaskCount += 1;
          evidence.ignoredNonModelFailures[classification.category] =
            (evidence.ignoredNonModelFailures[classification.category] ?? 0) + 1;
        } else if (classification.impact === "ambiguous") {
          evidence.ambiguousFailureCount += 1;
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
      if (item.task.status === "succeeded" || passingDisposition) evidence.acceptedDeliveryCount += 1;
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
      evidence.acceptedDeliveryRate =
        evidence.acceptedDeliveryCount / evidence.relevantSampleCount;
      evidence.correctionChurnRate = evidence.correctionChurn / evidence.relevantSampleCount;
    }
    if (evidence.verifiedBehaviorSampleCount > 0) {
      evidence.verifiedBehaviorRate =
        evidence.verifiedBehaviorCount / evidence.verifiedBehaviorSampleCount;
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
    });
  }

  /** Derive routing evidence for the exact taskClass from all terminal
   *  Tasks.  Read-only — never mutates state. */
  routingEvidence(
    taskClass: string,
    identityMode: "provider-model" | "full-worker" = "provider-model",
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
    });
  }

  /** Derive routing evidence for an explicit taskFamily from all terminal
   *  Tasks with that family.  Read-only — never mutates state.
   *  Family evidence is only comparable when every candidate has enough
   *  family-scoped samples; it never replaces exact taskClass for audit or
   *  Direct Codex Token calibration. */
  routingEvidenceByFamily(
    taskFamily: string,
    identityMode: "provider-model" | "full-worker" = "provider-model",
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
    });
  }
}
