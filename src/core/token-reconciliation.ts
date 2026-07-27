// Token-usage reconciliation — Compare two runtime-reported Token counter
// families without treating one as billing truth or adding them together.
//
// Consumes a one-shot snapshot of Attempt records already used by Worker-
// volume arithmetic.  Produces a detached immutable comparison of top-level
// terminal usage against optional per-model breakdowns with signed component
// and gross deltas defined as perModel minus top-level.
//
// This is diagnostic evidence only.  Mismatches are soft telemetry-quality
// warnings — they must never fail a Task, trigger retry, reduce model
// quality scores, or block Integration.

import type { AttemptRecord, AttemptTokenUsage, ModelTokenUsage } from "./types.js";

// --- Helpers ----------------------------------------------------------------

function freezeDeep(v: unknown): void {
  if (v !== null && typeof v === "object" && !Object.isFrozen(v)) {
    if (Array.isArray(v)) { for (const e of v) freezeDeep(e); }
    else { for (const e of Object.values(v)) freezeDeep(e); }
    Object.freeze(v);
  }
}

const isSafeNNInt = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

const isCompleteUsage = (u: unknown): u is AttemptTokenUsage => {
  if (u === null || typeof u !== "object") return false;
  const o = u as Record<string, unknown>;
  return o.source === "terminal-result" && o.complete === true
    && isSafeNNInt(o.inputTokens) && isSafeNNInt(o.outputTokens)
    && isSafeNNInt(o.cacheReadInputTokens) && isSafeNNInt(o.cacheCreationInputTokens);
};

// Safe addition that returns null on overflow — aggregation fails closed.
function safeAdd(a: number, b: number): number | null {
  const sum = a + b;
  return Number.isSafeInteger(sum) ? sum : null;
}

function safeGross(...values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    const next = safeAdd(total, value);
    if (next === null) return null;
    total = next;
  }
  return total;
}

// --- Public types -----------------------------------------------------------

export type ReconciliationState = "matched" | "mismatch" | "partial" | "unavailable";

/** Top-level terminal Token counters — the four components ForkLight
 *  currently counts as canonical Worker volume.  Per-model sums are
 *  compared against these values. */
export interface TopLevelCounters {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly gross: number;
}

/** Per-model summed Token counters across this Attempt's perModel entries.
 *  These are the comparison target; a mismatch means the runtime reported
 *  different numbers in the two counter families. */
export interface PerModelSums {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly gross: number;
}

/** Signed component and gross deltas: perModel minus top-level.
 *  Positive values mean perModel reported more; negative means less. */
export interface TokenDeltas {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly gross: number;
}

/** Bounded per-Attempt comparison evidence.  Ordinal, exact counters,
 *  signed deltas, and model count only.  Never exposes prompts, outputs,
 *  logs, paths, credentials, or arbitrary model strings. */
export interface AttemptReconciliationEvidence {
  readonly ordinal: number;
  readonly topLevel: TopLevelCounters;
  readonly perModel: PerModelSums;
  readonly deltas: TokenDeltas;
  readonly modelCount: number;
}

/** Per-Attempt status for missing evidence tracking. */
export type ComparedGrossReconciliation =
  | {
      readonly available: true;
      readonly scope: "compared-attempts-only";
      readonly topLevelGross: number;
      readonly perModelGross: number;
      readonly delta: number;
    }
  | {
      readonly available: false;
      readonly scope: "compared-attempts-only";
      readonly reason: "no-comparable-attempts" | "safe-integer-overflow";
    };

/** Detached immutable reconciliation state for one Task's Attempt snapshot.
 *  Counts and evidence are exact; the dominant state communicates the most
 *  significant condition without hiding coverage gaps. */
export interface TokenUsageReconciliation {
  readonly state: ReconciliationState;
  /** Current Worker-volume, cost, boundary and direct-savings arithmetic use
   *  the terminal top-level family. This is a named source, not a claim that
   *  it is the Provider invoice. */
  readonly workerVolumeSource: "terminal-top-level";
  readonly perModelRole: "diagnostic-only";
  /** Attempts where both counter families are present and were compared. */
  readonly comparedAttemptCount: number;
  /** Compared attempts where every delta is zero. */
  readonly matchedAttemptCount: number;
  /** Compared attempts where at least one delta is non-zero. */
  readonly mismatchedAttemptCount: number;
  /** Attempts with terminal usage but no perModel breakdown. */
  readonly missingBreakdownCount: number;
  /** Attempts with no terminal usage at all. */
  readonly missingUsageCount: number;
  /** Attempts carrying malformed or unsafe counter arithmetic. Never folded
   *  into a missing-breakdown count or guessed as zero. */
  readonly invalidCounterEvidenceCount: number;
  /** Total attempts in the snapshot. */
  readonly totalAttemptCount: number;
  /** Aggregate gross comparison across compared Attempts only. It is not the
   *  Task's total Worker volume when coverage is partial. */
  readonly grossDeltas: ComparedGrossReconciliation;
  /** Per-Attempt evidence for compared attempts, sorted by ordinal. */
  readonly evidence: readonly AttemptReconciliationEvidence[];
}

// --- Private aggregation ----------------------------------------------------

function sumPerModel(entries: readonly ModelTokenUsage[]): PerModelSums | null {
  let input = 0, output = 0, cr = 0, cc = 0;
  for (const m of entries) {
    if (!isSafeNNInt(m.inputTokens) || !isSafeNNInt(m.outputTokens)
      || !isSafeNNInt(m.cacheReadInputTokens) || !isSafeNNInt(m.cacheCreationInputTokens)) {
      return null; // malformed perModel entry — fail closed
    }
    const sInput = safeAdd(input, m.inputTokens);
    const sOutput = safeAdd(output, m.outputTokens);
    const sCr = safeAdd(cr, m.cacheReadInputTokens);
    const sCc = safeAdd(cc, m.cacheCreationInputTokens);
    if (sInput === null || sOutput === null || sCr === null || sCc === null) return null;
    input = sInput; output = sOutput; cr = sCr; cc = sCc;
  }
  const gross = safeGross(input, output, cr, cc);
  if (gross === null) return null;
  return { inputTokens: input, outputTokens: output,
    cacheReadInputTokens: cr, cacheCreationInputTokens: cc, gross };
}

function computeDeltas(top: TopLevelCounters, pm: PerModelSums): TokenDeltas {
  return {
    inputTokens: pm.inputTokens - top.inputTokens,
    outputTokens: pm.outputTokens - top.outputTokens,
    cacheReadInputTokens: pm.cacheReadInputTokens - top.cacheReadInputTokens,
    cacheCreationInputTokens: pm.cacheCreationInputTokens - top.cacheCreationInputTokens,
    gross: pm.gross - top.gross,
  };
}

function hasNonZeroDelta(d: TokenDeltas): boolean {
  return d.inputTokens !== 0 || d.outputTokens !== 0
    || d.cacheReadInputTokens !== 0 || d.cacheCreationInputTokens !== 0
    || d.gross !== 0;
}

// --- Public API -------------------------------------------------------------

/**
 * Compare each complete Attempt's four top-level counters with sums of its
 * perModel entries and compute component and gross deltas as perModel minus
 * top-level.
 *
 * Usage whose counter arithmetic overflows the safe-integer range produces
 * invalid-counter evidence for that Attempt rather than a guessed value or a
 * fabricated missing-breakdown claim.
 *
 * The returned reconciliation is detached, deeply frozen, and privacy-safe:
 * never exposes prompts, outputs, logs, paths, credentials, or arbitrary
 * model strings.
 */
export function reconcileTokenUsage(
  attempts: readonly AttemptRecord[],
): TokenUsageReconciliation {
  const evidenceList: AttemptReconciliationEvidence[] = [];
  let compared = 0, matched = 0, mismatched = 0;
  let missingBreakdown = 0, missingUsage = 0, invalidCounterEvidence = 0;
  let aggTopGross = 0, aggPmGross = 0;
  let aggregateOverflow = false;

  for (const a of attempts) {
    // No terminal usage → cannot compare at all
    if (a.usage === undefined || a.usage === null) {
      missingUsage++;
      continue;
    }
    if (!isCompleteUsage(a.usage)) {
      invalidCounterEvidence++;
      continue;
    }

    const usage = a.usage as AttemptTokenUsage;
    const topGross = safeGross(
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheReadInputTokens,
      usage.cacheCreationInputTokens,
    );
    if (topGross === null) {
      invalidCounterEvidence++;
      continue;
    }
    const topLevel: TopLevelCounters = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      gross: topGross,
    };

    // Has terminal usage but no perModel breakdown
    if (!Array.isArray(usage.perModel) || usage.perModel.length === 0) {
      missingBreakdown++;
      continue;
    }

    const pmSums = sumPerModel(usage.perModel);
    // Overflow or malformed perModel entries are invalid evidence, not an
    // absent breakdown. Keep those coverage gaps distinct.
    if (pmSums === null) {
      invalidCounterEvidence++;
      continue;
    }

    const deltas = computeDeltas(topLevel, pmSums);
    const isMismatch = hasNonZeroDelta(deltas);

    const evidence: AttemptReconciliationEvidence = {
      ordinal: a.ordinal,
      topLevel: {
        inputTokens: topLevel.inputTokens,
        outputTokens: topLevel.outputTokens,
        cacheReadInputTokens: topLevel.cacheReadInputTokens,
        cacheCreationInputTokens: topLevel.cacheCreationInputTokens,
        gross: topLevel.gross,
      },
      perModel: {
        inputTokens: pmSums.inputTokens,
        outputTokens: pmSums.outputTokens,
        cacheReadInputTokens: pmSums.cacheReadInputTokens,
        cacheCreationInputTokens: pmSums.cacheCreationInputTokens,
        gross: pmSums.gross,
      },
      deltas: {
        inputTokens: deltas.inputTokens,
        outputTokens: deltas.outputTokens,
        cacheReadInputTokens: deltas.cacheReadInputTokens,
        cacheCreationInputTokens: deltas.cacheCreationInputTokens,
        gross: deltas.gross,
      },
      modelCount: usage.perModel.length,
    };
    freezeDeep(evidence);
    evidenceList.push(evidence);

    compared++;
    const nextTop = safeAdd(aggTopGross, topLevel.gross);
    const nextPerModel = safeAdd(aggPmGross, pmSums.gross);
    if (nextTop === null || nextPerModel === null) {
      aggregateOverflow = true;
    } else if (!aggregateOverflow) {
      aggTopGross = nextTop;
      aggPmGross = nextPerModel;
    }
    if (isMismatch) mismatched++; else matched++;
  }

  // Deterministic: sort evidence by ordinal before freezing
  evidenceList.sort((a, b) => a.ordinal - b.ordinal);

  // Derive dominant state
  let state: ReconciliationState;
  if (compared === 0) {
    state = "unavailable";
  } else if (mismatched > 0) {
    state = "mismatch";
  } else if (missingBreakdown > 0 || missingUsage > 0 || invalidCounterEvidence > 0) {
    state = "partial";
  } else {
    state = "matched";
  }

  const result: TokenUsageReconciliation = {
    state,
    workerVolumeSource: "terminal-top-level",
    perModelRole: "diagnostic-only",
    comparedAttemptCount: compared,
    matchedAttemptCount: matched,
    mismatchedAttemptCount: mismatched,
    missingBreakdownCount: missingBreakdown,
    missingUsageCount: missingUsage,
    invalidCounterEvidenceCount: invalidCounterEvidence,
    totalAttemptCount: attempts.length,
    grossDeltas: compared === 0
      ? {
          available: false,
          scope: "compared-attempts-only",
          reason: "no-comparable-attempts",
        }
      : aggregateOverflow
        ? {
            available: false,
            scope: "compared-attempts-only",
            reason: "safe-integer-overflow",
          }
        : {
            available: true,
            scope: "compared-attempts-only",
            topLevelGross: aggTopGross,
            perModelGross: aggPmGross,
            delta: aggPmGross - aggTopGross,
          },
    evidence: evidenceList,
  };
  freezeDeep(result);
  return result;
}
