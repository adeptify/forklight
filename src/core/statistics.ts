import type { StateStore } from "../state/store.js";
import type {
  AttemptRecord,
  AttemptStatus,
  EventRecord,
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
  | "unclassified";

export interface ClassifyFailureInput {
  taskStatus: TaskStatus;
  attemptStatus?: AttemptStatus;
  attemptExitCode?: number;
  verification?: VerificationResult;
  error?: string;
}

export interface FailureClassification {
  category: FailureCategory;
  reason: string;
  diagnostic: string;
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
  turnsSampleSize: number;
  totalTurns?: number;
  avgTurns?: number;
  failureDistribution: Partial<Record<FailureCategory, number>>;
  failures: FailureEvidence[];
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
      return result(
        "verification",
        `Change budget exceeded: ${budget.filesChanged}/${budget.maxFiles} files, ${budget.changedLines}/${budget.maxDiffLines} lines`,
      );
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

const TERMINAL_STATUSES = new Set<TaskStatus>(["succeeded", "failed", "interrupted"]);

function millisecondsBetween(start?: string, finish?: string): number | undefined {
  if (!start || !finish) return undefined;
  const duration = Date.parse(finish) - Date.parse(start);
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

function completeAttemptTotal(
  attempts: AttemptRecord[],
  metric: "costUsd" | "turns",
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

function summaryFor(provider: string, model: string, evidence: TaskEvidence[]): ProviderModelSummary {
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
    const classification = classifyFailure({
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
    turnsSampleSize: turns.length,
    ...(turns.length === 0 ? {} : { totalTurns, avgTurns: totalTurns / turns.length }),
    failureDistribution,
    failures,
  };
}

export function computeStatistics(
  history: TaskEvidence[],
  filter: StatisticsFilter = {},
): ProviderModelSummary[] {
  const since = filter.since === undefined ? undefined : Date.parse(filter.since);
  const until = filter.until === undefined ? undefined : Date.parse(filter.until);
  const filtered = history.filter(({ task }) =>
    TERMINAL_STATUSES.has(task.status)
    && (filter.providerName === undefined || task.spec.provider.name === filter.providerName)
    && (filter.modelName === undefined || task.spec.provider.model === filter.modelName)
    && (since === undefined || Date.parse(task.createdAt) >= since)
    && (until === undefined || Date.parse(task.createdAt) <= until));
  const groups = new Map<string, TaskEvidence[]>();

  for (const item of filtered) {
    const key = `${item.task.spec.provider.name}\0${item.task.spec.provider.model}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return [...groups.entries()]
    .map(([key, items]) => {
      const [provider = "", model = ""] = key.split("\0");
      return summaryFor(provider, model, items);
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
    : (payload.changeBudget?.withinBudget ?? true)
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

export class StatisticsService {
  constructor(private readonly store: StateStore) {}

  summarize(filter: StatisticsFilter = {}): ProviderModelSummary[] {
    const history = this.store.listTasks()
      .filter((task) => TERMINAL_STATUSES.has(task.status))
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
    return computeStatistics(history, filter);
  }
}
