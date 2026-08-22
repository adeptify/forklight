/**
 * Canonical same-Attempt Worker aggregation.
 *
 * One AttemptRecord may be executed by more than one Runtime invocation
 * (interrupt → same-Session continuation, crash recovery of an exact repair
 * round, etc.). Every invocation reports its own per-invocation usage, cost,
 * estimate, and turns. This module combines those into one truthful Attempt
 * total and never assumes the Runtime's terminal metrics are cumulative.
 *
 * Privacy/truth rules:
 * - Aggregate usage is published only when EVERY invocation supplies a
 *   complete=true usage record. A single incomplete invocation omits usage.
 * - perModel is published only with full coverage: every invocation supplies a
 *   perModel array and the model sets are identical across invocations.
 * - serviceTier is published only when every invocation reports the SAME
 *   non-empty tier.
 * - costUsd / runtimeCostEstimateUsd / turns are published only when every
 *   invocation supplies a finite non-negative value; the published value is
 *   the exact sum.
 * - A continuation budget fails closed (zero remaining) when any prior
 *   invocation lacks at least one finite non-negative cost estimate or actual
 *   cost. The original maximum is never restored by a later invocation.
 */

import type {
  AttemptTokenUsage,
  EventRecord,
  ModelTokenUsage,
} from "./types.js";
import type { WorkerExecutionResult } from "../workers/types.js";

// --- Guards -----------------------------------------------------------------

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isCompleteUsage(value: unknown): value is AttemptTokenUsage {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const usage = value as Partial<AttemptTokenUsage>;
  return usage.source === "terminal-result"
    && usage.complete === true
    && isFiniteNonNegative(usage.inputTokens)
    && isFiniteNonNegative(usage.outputTokens)
    && isFiniteNonNegative(usage.cacheReadInputTokens)
    && isFiniteNonNegative(usage.cacheCreationInputTokens);
}

function isCompletePerModel(value: unknown): value is ModelTokenUsage[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return false;
    const model = entry as Partial<ModelTokenUsage>;
    return typeof model.model === "string" && model.model.length > 0
      && isFiniteNonNegative(model.inputTokens)
      && isFiniteNonNegative(model.outputTokens)
      && isFiniteNonNegative(model.cacheReadInputTokens)
      && isFiniteNonNegative(model.cacheCreationInputTokens);
  });
}

function safeSum(values: readonly number[]): number | undefined {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total)) return undefined;
  }
  return total;
}

function sumFinite(values: readonly number[]): number | undefined {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isFinite(total)) return undefined;
  }
  return total;
}

// --- Per-invocation extraction ----------------------------------------------

const TERMINAL_EVENT_TYPES = new Set(["worker.completed", "worker.failed", "worker.interrupted"]);
const START_EVENT_TYPES = new Set(["worker.started", "worker.resumed"]);

/** One Runtime invocation's terminal metrics, when the Runtime reported them. */
export interface InvocationTerminal {
  costUsd?: number;
  runtimeCostEstimateUsd?: number;
  turns?: number;
  usage?: AttemptTokenUsage;
}

/** The runner's already-persisted aggregate for this Attempt (prior invocations). */
export interface PriorAttemptStored {
  usage?: AttemptTokenUsage;
  costUsd?: number;
  runtimeCostEstimateUsd?: number;
  turns?: number;
}

function terminalFromPayload(payload: unknown): InvocationTerminal {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return {};
  const record = payload as Record<string, unknown>;
  const nested = record.terminal !== null
    && typeof record.terminal === "object"
    && !Array.isArray(record.terminal)
    ? record.terminal as Record<string, unknown>
    : undefined;
  const costUsd = isFiniteNonNegative(record.costUsd)
    ? record.costUsd
    : nested !== undefined && isFiniteNonNegative(nested.costUsd)
      ? nested.costUsd
      : undefined;
  // The Runtime's reported cost is also the best finite runtime estimate;
  // never invent official Provider cost here.
  const runtimeCostEstimateUsd = isFiniteNonNegative(record.runtimeCostEstimateUsd)
    ? record.runtimeCostEstimateUsd
    : nested !== undefined && isFiniteNonNegative(nested.runtimeCostEstimateUsd)
      ? nested.runtimeCostEstimateUsd
      : costUsd;
  const turns = isFiniteNonNegative(record.turns)
    ? record.turns
    : nested !== undefined && isFiniteNonNegative(nested.turns)
      ? nested.turns
      : undefined;
  const usageRaw = record.usage ?? nested?.usage;
  const usage = isCompleteUsage(usageRaw) ? usageRaw : undefined;
  return {
    ...(costUsd === undefined ? {} : { costUsd }),
    ...(runtimeCostEstimateUsd === undefined ? {} : { runtimeCostEstimateUsd }),
    ...(turns === undefined ? {} : { turns }),
    ...(usage === undefined ? {} : { usage }),
  };
}

function terminalFromWorkerResult(worker: WorkerExecutionResult): InvocationTerminal {
  const costUsd = isFiniteNonNegative(worker.costUsd) ? worker.costUsd : undefined;
  const runtimeCostEstimateUsd = isFiniteNonNegative(worker.runtimeCostEstimateUsd)
    ? worker.runtimeCostEstimateUsd
    : costUsd;
  return {
    ...(costUsd === undefined ? {} : { costUsd }),
    ...(runtimeCostEstimateUsd === undefined ? {} : { runtimeCostEstimateUsd }),
    ...(isFiniteNonNegative(worker.turns) ? { turns: worker.turns } : {}),
    ...(isCompleteUsage(worker.usage) ? { usage: worker.usage } : {}),
  };
}

function terminalFromStored(prior: PriorAttemptStored): InvocationTerminal {
  return {
    ...(isFiniteNonNegative(prior.costUsd) ? { costUsd: prior.costUsd } : {}),
    ...(isFiniteNonNegative(prior.runtimeCostEstimateUsd)
      ? { runtimeCostEstimateUsd: prior.runtimeCostEstimateUsd }
      : isFiniteNonNegative(prior.costUsd)
        ? { runtimeCostEstimateUsd: prior.costUsd }
        : {}),
    ...(isFiniteNonNegative(prior.turns) ? { turns: prior.turns } : {}),
    ...(isCompleteUsage(prior.usage) ? { usage: prior.usage } : {}),
  };
}

function storedHasMetrics(prior: PriorAttemptStored | undefined): boolean {
  return prior !== undefined
    && (
      prior.usage !== undefined
      || isFiniteNonNegative(prior.costUsd)
      || isFiniteNonNegative(prior.runtimeCostEstimateUsd)
      || isFiniteNonNegative(prior.turns)
    );
}

/**
 * Stored terminal events for prior invocations.
 *
 * When `excludeCurrent` is true (the current invocation already started), the
 * current invocation's own terminal event — stored after its start marker —
 * is excluded so it is replaced by the authoritative `current` result instead
 * of being double-counted. When false (pure aggregation or a continuation
 * budget computed before the next invocation starts), every stored terminal is
 * a completed prior invocation.
 */
function priorTerminalEvents(
  events: readonly EventRecord[],
  attemptId: string,
  excludeCurrent: boolean,
): InvocationTerminal[] {
  const attemptEvents = events.filter((event) => event.attemptId === attemptId);
  let terminals = attemptEvents.filter((event) => TERMINAL_EVENT_TYPES.has(event.type));
  if (excludeCurrent) {
    const startEvents = attemptEvents.filter((event) => START_EVENT_TYPES.has(event.type));
    const lastStartSequence = startEvents.at(-1)?.sequence ?? -1;
    terminals = terminals.filter((event) => event.sequence < lastStartSequence);
  }
  return terminals.map((event) => terminalFromPayload(event.payload));
}

/**
 * Order the Runtime invocations bound to one Attempt.
 *
 * The runner's persisted aggregate (`priorStored`) is authoritative for every
 * prior invocation when it carries metrics; the stored terminal events are a
 * lower-fidelity replay used only when the Attempt was never finalized (crash
 * recovery). The current Runtime result is appended exactly once.
 */
export function collectAttemptInvocations(
  events: readonly EventRecord[],
  attemptId: string,
  current?: WorkerExecutionResult,
  priorStored?: PriorAttemptStored,
): InvocationTerminal[] {
  const invocations: InvocationTerminal[] = [];
  if (storedHasMetrics(priorStored)) {
    invocations.push(terminalFromStored(priorStored!));
  } else {
    invocations.push(...priorTerminalEvents(events, attemptId, current !== undefined));
  }
  if (current !== undefined) invocations.push(terminalFromWorkerResult(current));
  return invocations;
}

// --- Aggregate --------------------------------------------------------------

export interface WorkerAttemptAggregate {
  /** Number of Runtime invocations combined into this total. */
  invocationCount: number;
  /** Combined usage. Present only when every invocation has complete usage. */
  usage?: AttemptTokenUsage;
  /** Combined per-model usage. Present only with full coverage. */
  perModel?: ModelTokenUsage[];
  /** Combined service tier. Present only when every tier is the same non-empty value. */
  serviceTier?: string;
  /** Sum of every invocation's finite non-negative costUsd. */
  costUsd?: number;
  /** Sum of every invocation's finite non-negative runtime estimate. */
  runtimeCostEstimateUsd?: number;
  /** Sum of every invocation's finite non-negative turns. */
  turns?: number;
  /**
   * True when every invocation supplied at least one finite non-negative cost
   * estimate or actual cost. False means a continuation must fail closed.
   */
  costComplete: boolean;
}

function modelKeySet(entries: readonly ModelTokenUsage[]): string {
  return [...entries].map((entry) => entry.model).sort().join("\0");
}

function sumPerModel(entries: readonly ModelTokenUsage[][]): ModelTokenUsage[] | undefined {
  const first = entries[0]!;
  const key = modelKeySet(first);
  if (!entries.every((entry) => modelKeySet(entry) === key)) return undefined;
  const byModel = new Map<string, ModelTokenUsage>();
  for (const list of entries) {
    for (const entry of list) {
      const existing = byModel.get(entry.model);
      const inputTokens = safeSum([existing?.inputTokens ?? 0, entry.inputTokens]);
      const outputTokens = safeSum([existing?.outputTokens ?? 0, entry.outputTokens]);
      const cacheReadInputTokens = safeSum([existing?.cacheReadInputTokens ?? 0, entry.cacheReadInputTokens]);
      const cacheCreationInputTokens = safeSum([existing?.cacheCreationInputTokens ?? 0, entry.cacheCreationInputTokens]);
      if (
        inputTokens === undefined
        || outputTokens === undefined
        || cacheReadInputTokens === undefined
        || cacheCreationInputTokens === undefined
      ) {
        return undefined;
      }
      byModel.set(entry.model, {
        model: entry.model,
        inputTokens,
        outputTokens,
        cacheReadInputTokens,
        cacheCreationInputTokens,
      });
    }
  }
  return [...byModel.values()];
}

function aggregateFromInvocations(invocations: readonly InvocationTerminal[]): WorkerAttemptAggregate {
  const count = invocations.length;
  if (count === 0) {
    return { invocationCount: 0, costComplete: false };
  }

  const allUsageComplete = invocations.every((invocation) => invocation.usage !== undefined);
  const perModels = invocations.map((invocation) => invocation.usage?.perModel);
  const allPerModelComplete = allUsageComplete && perModels.every(isCompletePerModel);
  const perModel = allPerModelComplete
    ? sumPerModel(perModels as ModelTokenUsage[][])
    : undefined;

  const tiers = invocations
    .map((invocation) => invocation.usage?.serviceTier)
    .filter((tier): tier is string => typeof tier === "string" && tier.length > 0);
  const serviceTier = tiers.length === count && tiers.every((tier) => tier === tiers[0])
    ? tiers[0]!
    : undefined;

  const inputTokens = allUsageComplete
    ? safeSum(invocations.map((invocation) => invocation.usage!.inputTokens))
    : undefined;
  const outputTokens = allUsageComplete
    ? safeSum(invocations.map((invocation) => invocation.usage!.outputTokens))
    : undefined;
  const cacheReadInputTokens = allUsageComplete
    ? safeSum(invocations.map((invocation) => invocation.usage!.cacheReadInputTokens))
    : undefined;
  const cacheCreationInputTokens = allUsageComplete
    ? safeSum(invocations.map((invocation) => invocation.usage!.cacheCreationInputTokens))
    : undefined;
  const usage: AttemptTokenUsage | undefined = allUsageComplete
    && inputTokens !== undefined
    && outputTokens !== undefined
    && cacheReadInputTokens !== undefined
    && cacheCreationInputTokens !== undefined
    ? {
        inputTokens,
        outputTokens,
        cacheReadInputTokens,
        cacheCreationInputTokens,
        source: "terminal-result",
        complete: true,
        ...(serviceTier === undefined ? {} : { serviceTier }),
        ...(perModel === undefined ? {} : { perModel }),
      }
    : undefined;

  const costValues = invocations.map((invocation) => invocation.costUsd);
  const estimateValues = invocations.map((invocation) => invocation.runtimeCostEstimateUsd);
  const turnsValues = invocations.map((invocation) => invocation.turns);
  const costUsd = costValues.every((value) => value !== undefined)
    ? sumFinite(costValues as number[])
    : undefined;
  const runtimeCostEstimateUsd = estimateValues.every((value) => value !== undefined)
    ? sumFinite(estimateValues as number[])
    : undefined;
  const turns = turnsValues.every((value) => value !== undefined)
    ? sumFinite(turnsValues as number[])
    : undefined;

  return {
    invocationCount: count,
    ...(usage === undefined ? {} : { usage }),
    ...(perModel === undefined ? {} : { perModel }),
    ...(serviceTier === undefined ? {} : { serviceTier }),
    ...(costUsd === undefined ? {} : { costUsd }),
    ...(runtimeCostEstimateUsd === undefined ? {} : { runtimeCostEstimateUsd }),
    ...(turns === undefined ? {} : { turns }),
    costComplete: invocations.every(
      (invocation) => invocation.costUsd !== undefined || invocation.runtimeCostEstimateUsd !== undefined,
    ),
  };
}

/** Combine every same-Attempt Runtime invocation into one truthful total. */
export function aggregateAttemptUsage(
  events: readonly EventRecord[],
  attemptId: string,
  current?: WorkerExecutionResult,
  priorStored?: PriorAttemptStored,
): WorkerAttemptAggregate {
  return aggregateFromInvocations(
    collectAttemptInvocations(events, attemptId, current, priorStored),
  );
}

// --- Continuation budget ----------------------------------------------------

/**
 * Bounded USD precision for continuation budget handoff (microdollars).
 * Stable enough for Runtime max-budget handoff; coarse enough to collapse
 * binary float artifacts such as `1.0 - 0.9 === 0.0999…`.
 */
const CONTINUATION_BUDGET_USD_SCALE = 1_000_000;

/**
 * Normalize a non-negative finite USD remainder for the next Runtime invocation.
 *
 * Binary float subtraction can undershoot a clean decimal (e.g. 1.0 − 0.4 − 0.5).
 * Floor to microdollars with a sub-unit nudge so pure FP undershoot lands on the
 * canonical remainder (0.1) without restoring material consumed budget: the
 * result never exceeds the raw non-negative remainder by more than the nudge.
 */
function normalizeContinuationBudgetRemainder(rawRemainderUsd: number): number {
  if (!Number.isFinite(rawRemainderUsd) || rawRemainderUsd <= 0) return 0;
  // Nudge is far below one microdollar; it only absorbs binary representation
  // error so Math.floor does not drop a boundary that is already "exact" in USD.
  const scaled = rawRemainderUsd * CONTINUATION_BUDGET_USD_SCALE;
  return Math.max(0, Math.floor(scaled + 1e-9) / CONTINUATION_BUDGET_USD_SCALE);
}

interface ConsumedAttemptCost {
  /** Sum of every prior invocation's best finite cost estimate/actual cost. */
  consumedUsd: number;
  /** True when every prior invocation supplied cost evidence. */
  costComplete: boolean;
}

/** Best finite per-invocation cost evidence (actual cost or runtime estimate). */
export function consumedAttemptCostUsd(
  events: readonly EventRecord[],
  attemptId: string,
  priorStored?: PriorAttemptStored,
): ConsumedAttemptCost {
  const invocations = collectAttemptInvocations(events, attemptId, undefined, priorStored);
  let consumedUsd = 0;
  // Complete finite evidence starts and remains true; only missing or invalid
  // evidence flips the continuation to fail-closed (zero remaining budget).
  let costComplete = true;
  for (const invocation of invocations) {
    const value = invocation.costUsd ?? invocation.runtimeCostEstimateUsd;
    if (value === undefined || !Number.isFinite(value) || value < 0) {
      costComplete = false;
      continue;
    }
    consumedUsd += value;
    if (!Number.isFinite(consumedUsd)) costComplete = false;
  }
  return { consumedUsd, costComplete };
}

/**
 * Remaining USD budget for the next same-Attempt continuation.
 *
 * The Runtime maxBudgetUsd ceiling applies across the aggregate Attempt. When
 * any prior invocation lacks a finite non-negative cost estimate or actual
 * cost the continuation receives zero remaining budget (fail closed) — the
 * original maximum is never restored by a later invocation. A null ceiling
 * stays uncapped. Finite remainders are normalized once to bounded USD
 * precision so binary float artifacts are not handed to the next Runtime.
 */
export function remainingContinuationBudget(
  totalBudgetUsd: number | null,
  events: readonly EventRecord[],
  attemptId: string,
  priorStored?: PriorAttemptStored,
): number | null {
  if (totalBudgetUsd === null) return null;
  if (!isFiniteNonNegative(totalBudgetUsd)) return 0;
  const { consumedUsd, costComplete } = consumedAttemptCostUsd(events, attemptId, priorStored);
  if (!costComplete) return 0;
  return normalizeContinuationBudgetRemainder(Math.max(0, totalBudgetUsd - consumedUsd));
}
