// Portfolio economics evidence summary — Store-backed read-only service.
// Composes canonical per-Task economics reports for all terminal Tasks
// matching the supplied filter into a detached deeply-frozen cross-Task
// evidence summary.  Never reads legacy costUsd, never combines currencies,
// never performs FX conversion, never infers missing evidence as zero,
// and never claims a Provider bill.
//
// Implementation note:
// - Worker Token volume, boundary reduction, and direct-Codex savings
//   remain three distinct concepts with separate availability semantics.
//   Worker volume alone must never be labelled "Token savings" without
//   an explicit compatible calibration; boundary reduction and direct-Codex
//   savings use different arithmetic and must never be conflated.
// - Official cost totals are per-native-currency only. No cross-currency
//   grand total exists. The report never claims Provider billing authority.
// - Runtime caps are summed as configured finite caps, not observed spend
//   or company spending authority. Uncapped Attempts are counted separately.
// - Every section exposes its own denominator and unavailable counts so
//   consumers render completeness honestly without inventing evidence.

import type { StateStore } from "../state/store.js";
import type { StatisticsFilter } from "./statistics.js";
import { isTerminalTaskStatus } from "./task-progress.js";
import {
  getTaskEconomicsReport,
  type TaskEconomicsReport,
} from "./task-economics-report.js";
import type { PricingCurrency } from "./pricing.js";
import { deepFreeze } from "./immutability.js";

// --- Immutability helpers ---

// --- Public schema types ---

/** Evidence coverage denominator — visible so consumers never divide
 *  by an unknown count. */
interface PortfolioScopeSection {
  /** Terminal Tasks matching the filter. Running/waiting/blocked/preparing/
   *  verifying Tasks are excluded. */
  readonly terminalTaskCount: number;
  /** Total Attempts across those terminal Tasks. */
  readonly totalAttemptCount: number;
  /** True when at least one matching terminal Task exists. */
  readonly nonEmpty: boolean;
}

/** Budget-cap aggregation across all terminal Tasks and their Attempts.
 *  Sums only finite configured caps; uncapped/legacy Attempts are counted
 *  but do not contribute to the sum. */
interface PortfolioBudgetSection {
  /** Sum of finite maxBudgetUsd caps across all per-Attempt snapshots
   *  where source is "attempt-snapshot" and label is "capped".
   *  Uncapped and inherited/unknown Attempts are excluded from this sum. */
  readonly configuredFiniteCapSumUsd: number;
  readonly cappedAttemptCount: number;
  readonly uncappedAttemptCount: number;
  readonly unknownAttemptCount: number;
  /** Total Attempts across all matching terminal Tasks. */
  readonly totalAttemptCount: number;
  /** True when no relevant Attempt is legacy unknown. */
  readonly complete: boolean;
}

/** Runtime-estimate aggregation — runtimeCostEstimateUsd only.
 *  Legacy costUsd is never read. */
interface PortfolioRuntimeEstimateSection {
  /** Sum of all runtimeCostEstimateUsd from all Attempts across all
   *  matching terminal Tasks. Missing Attempts contribute zero to this
   *  sum but increase the missing count. */
  readonly observedTotalUsd: number;
  /** Number of Attempts with a finite runtimeCostEstimateUsd. */
  readonly sampleCount: number;
  /** Number of Attempts without a finite runtimeCostEstimateUsd. */
  readonly missingCount: number;
  /** True when at least one Attempt exists and every Attempt across
   *  every matching terminal Task carries a finite runtimeCostEstimateUsd. */
  readonly complete: boolean;
}

/** One native-currency official-cost total — no cross-currency grand total. */
export interface PortfolioOfficialCostCurrencyTotal {
  readonly currency: PricingCurrency;
  readonly total: number;
  readonly quotedAttemptCount: number;
  /** Unique official pricing-source URLs that contributed quoted evidence,
   *  merged across all quoted Attempts, sorted deterministically. */
  readonly sources: readonly string[];
  readonly providerBillClaim: boolean;
}

/** Summary of unavailable official-cost evidence across all terminal Tasks. */
interface PortfolioOfficialCostUnavailable {
  readonly unavailableAttemptCount: number;
  /** Counts keyed by "stage:reason" for stable aggregation. */
  readonly breakdown: Readonly<Record<string, number>>;
}

/** One native-currency official-cost range total — no cross-currency grand total. */
export interface PortfolioOfficialCostRangeTotal {
  readonly currency: PricingCurrency;
  /** Additive lower bound across all ranged Attempts in this currency. */
  readonly min: number;
  /** Additive upper bound across all ranged Attempts in this currency. */
  readonly max: number;
  /** Number of Attempts contributing to this range. */
  readonly rangedAttemptCount: number;
  /** Unique pricing-source URLs that contributed range evidence, sorted. */
  readonly sources: readonly string[];
}

/** Official-cost aggregation — per-native-currency totals and typed
 *  unavailable evidence. */
export interface PortfolioOfficialCostSection {
  /** Per-currency totals, sorted by currency code, never containing
   *  a cross-currency grand total. */
  readonly currencyTotals: readonly PortfolioOfficialCostCurrencyTotal[];
  /** Conservative aggregate-tier range evidence, additive per currency. */
  readonly ranges: readonly PortfolioOfficialCostRangeTotal[];
  readonly unavailable: PortfolioOfficialCostUnavailable;
}

/** Worker Token volume aggregation — gross Worker Token count only.
 *  Never relabeled as Token savings. */
interface PortfolioWorkerVolumeSection {
  /** Sum of grossWorkerTokens across all complete/incomplete Task volumes. */
  readonly grossWorkerTokens: number;
  /** Count of Task Token reports where workerVolume.kind is "complete". */
  readonly completeTaskCount: number;
  /** Count of Task Token reports where workerVolume.kind is "incomplete". */
  readonly incompleteTaskCount: number;
  /** Total terminal Tasks contributing to this aggregate. */
  readonly totalTaskCount: number;
  /** Sum of completeSampleCount across all incomplete Task reports. */
  readonly totalCompleteSampleCount: number;
  /** Sum of missingSampleCount across all incomplete Task reports. */
  readonly totalMissingSampleCount: number;
}

/** Cross-Task comparison of terminal top-level usage against optional
 * per-model runtime breakdowns. This is telemetry-quality evidence only:
 * it never changes Task outcome, Integration eligibility, cost, Worker
 * volume, or savings arithmetic. */
interface PortfolioTokenReconciliationSection {
  readonly workerVolumeSource: "terminal-top-level";
  readonly perModelRole: "diagnostic-only";
  readonly totalTaskCount: number;
  readonly stateCounts: Readonly<Record<"matched" | "mismatch" | "partial" | "unavailable", number>>;
  readonly comparedAttemptCount: number;
  readonly matchedAttemptCount: number;
  readonly mismatchedAttemptCount: number;
  readonly missingBreakdownCount: number;
  readonly missingUsageCount: number;
  readonly invalidCounterEvidenceCount: number;
  /** Gross comparison across only Tasks whose compared-Attempt aggregate is
   * available. Unavailable Tasks are counted, never inserted as zero. */
  readonly comparison:
    | {
        readonly available: true;
        readonly scope: "compared-attempts-only";
        readonly availableTaskCount: number;
        readonly unavailableTaskCount: number;
        readonly topLevelGross: number;
        readonly perModelGross: number;
        readonly delta: number;
      }
    | {
        readonly available: false;
        readonly scope: "compared-attempts-only";
        readonly availableTaskCount: number;
        readonly unavailableTaskCount: number;
        readonly reason: "no-comparable-tasks" | "safe-integer-overflow";
      };
}

/** Orchestration-exchange Token range aggregation across all terminal
 *  Tasks with available exchange estimates. */
export interface PortfolioExchangeSection {
  /** Min sum (across all Task-level ranges). */
  readonly min: number;
  /** Max sum (across all Task-level ranges). */
  readonly max: number;
  /** Count of Tasks contributing to the range. */
  readonly availableTaskCount: number;
  /** Count of Tasks where exchange estimate is unavailable. */
  readonly unavailableTaskCount: number;
  /** Breakdown of ExchangeTokenUnavailableReason values across
   *  Tasks with unavailable exchange evidence. */
  readonly unavailableReasons: Readonly<Record<string, number>>;
}

/** Boundary-reduction range aggregation across all terminal Tasks. */
export interface PortfolioBoundaryReductionSection {
  /** Additive lower bound for the portfolio total across available Tasks. */
  readonly min: number;
  /** Additive upper bound for the portfolio total across available Tasks. */
  readonly max: number;
  /** Count of Tasks where boundary reduction is available. */
  readonly availableTaskCount: number;
  /** Count of Tasks where boundary reduction is unavailable. */
  readonly unavailableTaskCount: number;
  /** Breakdown of unavailable reasons. */
  readonly unavailableReasons: Readonly<Record<string, number>>;
}

/** Absolute direct-Codex Token savings range — preserves arithmetic signs. */
export interface PortfolioDirectCodexSavingsSection {
  /** Additive lower bound of absolute savings across compatible Tasks.
   *  Preserves sign — negative values mean the baseline is smaller. */
  readonly min: number;
  /** Additive upper bound of absolute savings across compatible Tasks. */
  readonly max: number;
  /** Count of Tasks with available compatible direct-Codex savings. */
  readonly availableTaskCount: number;
  /** Count of Tasks where direct-Codex savings are unavailable. */
  readonly unavailableTaskCount: number;
  /** Breakdown of DirectCodexUnavailableReason values. */
  readonly unavailableReasons: Readonly<Record<string, number>>;
  /** Count of Tasks where absolute savings min < 0 or max < 0. */
  readonly negativeBoundCount: number;
  /** Sum of confidence counts from available reports. */
  readonly confidenceCounts: Readonly<Record<string, number>>;
}

/** The complete portfolio economics summary. */
export interface PortfolioEconomicsSummary {
  readonly scope: PortfolioScopeSection;
  readonly runtimeBudget: PortfolioBudgetSection;
  readonly runtimeEstimate: PortfolioRuntimeEstimateSection;
  /** Native-currency totals sorted by currency code. No grand total. */
  readonly officialCost: PortfolioOfficialCostSection;
  /** Aggregated gross Worker Token volume — never relabeled as savings. */
  readonly workerVolume: PortfolioWorkerVolumeSection;
  /** Soft diagnostic comparison of the two runtime counter families. */
  readonly tokenReconciliation: PortfolioTokenReconciliationSection;
  /** Aggregated orchestration-exchange Token ranges. */
  readonly exchange: PortfolioExchangeSection;
  /** Boundary reduction is not direct-Codex savings. */
  readonly boundaryReduction: PortfolioBoundaryReductionSection;
  /** Compatible direct-Codex absolute savings ranges. Never averages
   *  percentage savings. */
  readonly directCodexSavings: PortfolioDirectCodexSavingsSection;
}

// --- Reducer internals ---

function selectTerminalTasks(
  store: StateStore,
  filter: StatisticsFilter,
): readonly string[] {
  const since = filter.since === undefined ? undefined : Date.parse(filter.since);
  const until = filter.until === undefined ? undefined : Date.parse(filter.until);
  return store.listTasks()
    .filter((task) =>
      isTerminalTaskStatus(task.status)
      && (filter.providerName === undefined || task.spec.provider.name === filter.providerName)
      && (filter.modelName === undefined || task.spec.provider.model === filter.modelName)
      && (since === undefined || Date.parse(task.createdAt) >= since)
      && (until === undefined || Date.parse(task.createdAt) <= until))
    .map((task) => task.id);
}

interface UnavailableExchangeEntry {
  taskId: string;
  reason: string;
}

interface UnavailableBoundaryEntry {
  taskId: string;
  reason: string;
}

interface UnavailableCodexEntry {
  taskId: string;
  reason: string;
  confidence?: string;
}

interface ReportReduceState {
  taskIds: string[];
  totalAttemptCount: number;
  // Budget
  cappedAttemptCount: number;
  uncappedAttemptCount: number;
  unknownAttemptCount: number;
  configuredFiniteCapSumUsd: number;
  // Runtime estimate
  runtimeEstimateSampleCount: number;
  runtimeEstimateMissingCount: number;
  runtimeEstimateSumUsd: number;
  // Official cost
  currencyAggregates: Map<PricingCurrency, {
    total: number;
    quotedAttemptCount: number;
    sources: Set<string>;
    providerBillClaim: boolean;
  }>;
  unavailableOfficialEntries: Array<{ stage: string; reason: string }>;
  // Official cost ranges
  officialRangeByCurrency: Map<PricingCurrency, {
    min: number;
    max: number;
    rangedAttemptCount: number;
    sources: Set<string>;
  }>;
  // Worker volume
  grossWorkerTokens: number;
  completeWorkerTaskCount: number;
  incompleteWorkerTaskCount: number;
  totalCompleteWorkerSampleCount: number;
  totalMissingWorkerSampleCount: number;
  // Token counter reconciliation (diagnostic only)
  reconciliationStateCounts: Record<"matched" | "mismatch" | "partial" | "unavailable", number>;
  reconciliationComparedAttemptCount: number;
  reconciliationMatchedAttemptCount: number;
  reconciliationMismatchedAttemptCount: number;
  reconciliationMissingBreakdownCount: number;
  reconciliationMissingUsageCount: number;
  reconciliationInvalidCounterEvidenceCount: number;
  reconciliationComparableTaskCount: number;
  reconciliationUnavailableTaskCount: number;
  reconciliationTopLevelGross: number;
  reconciliationPerModelGross: number;
  reconciliationAggregateOverflow: boolean;
  // Exchange
  exchangeAvailableTaskCount: number;
  exchangeMin: number;
  exchangeMax: number;
  unavailableExchangeEntries: UnavailableExchangeEntry[];
  // Boundary reduction
  boundaryAvailableTaskCount: number;
  boundaryMin: number | undefined;
  boundaryMax: number | undefined;
  unavailableBoundaryEntries: UnavailableBoundaryEntry[];
  // Direct-Codex savings
  codexAvailableTaskCount: number;
  codexMin: number | undefined;
  codexMax: number | undefined;
  codexNegativeBoundCount: number;
  codexConfidenceCounts: Map<string, number>;
  unavailableCodexEntries: UnavailableCodexEntry[];
}

function reduceReports(reports: readonly TaskEconomicsReport[]): ReportReduceState {
  const state: ReportReduceState = {
    taskIds: [],
    totalAttemptCount: 0,
    cappedAttemptCount: 0,
    uncappedAttemptCount: 0,
    unknownAttemptCount: 0,
    configuredFiniteCapSumUsd: 0,
    runtimeEstimateSampleCount: 0,
    runtimeEstimateMissingCount: 0,
    runtimeEstimateSumUsd: 0,
    currencyAggregates: new Map(),
    unavailableOfficialEntries: [],
    officialRangeByCurrency: new Map(),
    grossWorkerTokens: 0,
    completeWorkerTaskCount: 0,
    incompleteWorkerTaskCount: 0,
    totalCompleteWorkerSampleCount: 0,
    totalMissingWorkerSampleCount: 0,
    reconciliationStateCounts: { matched: 0, mismatch: 0, partial: 0, unavailable: 0 },
    reconciliationComparedAttemptCount: 0,
    reconciliationMatchedAttemptCount: 0,
    reconciliationMismatchedAttemptCount: 0,
    reconciliationMissingBreakdownCount: 0,
    reconciliationMissingUsageCount: 0,
    reconciliationInvalidCounterEvidenceCount: 0,
    reconciliationComparableTaskCount: 0,
    reconciliationUnavailableTaskCount: 0,
    reconciliationTopLevelGross: 0,
    reconciliationPerModelGross: 0,
    reconciliationAggregateOverflow: false,
    exchangeAvailableTaskCount: 0,
    exchangeMin: 0,
    exchangeMax: 0,
    unavailableExchangeEntries: [],
    boundaryAvailableTaskCount: 0,
    boundaryMin: undefined,
    boundaryMax: undefined,
    unavailableBoundaryEntries: [],
    codexAvailableTaskCount: 0,
    codexMin: undefined,
    codexMax: undefined,
    codexNegativeBoundCount: 0,
    codexConfidenceCounts: new Map(),
    unavailableCodexEntries: [],
  };

  for (const report of reports) {
    state.taskIds.push(report.taskId);
    const attemptCount = report.attemptRuntimeBudgets.length;
    state.totalAttemptCount += attemptCount;

    // Budget aggregation
    for (const arb of report.attemptRuntimeBudgets) {
      if (arb.source === "attempt-snapshot") {
        if (arb.label === "capped") {
          state.cappedAttemptCount++;
          state.configuredFiniteCapSumUsd += arb.maxBudgetUsd ?? 0;
        } else if (arb.label === "uncapped") {
          state.uncappedAttemptCount++;
        }
      } else {
        state.unknownAttemptCount++;
      }
    }

    // Runtime estimate
    state.runtimeEstimateSampleCount += report.runtimeEstimate.sampleCount;
    state.runtimeEstimateMissingCount += report.runtimeEstimate.missingCount;
    state.runtimeEstimateSumUsd += report.runtimeEstimate.observedTotalUsd;

    // Official cost
    for (const total of report.officialCost.totals) {
      let cur = state.currencyAggregates.get(total.currency);
      if (!cur) {
        cur = {
          total: 0,
          quotedAttemptCount: 0,
          sources: new Set(),
          providerBillClaim: false,
        };
        state.currencyAggregates.set(total.currency, cur);
      }
      cur.total += total.total;
      cur.quotedAttemptCount += total.quotedCount;
      for (const src of total.sources) cur.sources.add(src);
      cur.providerBillClaim = cur.providerBillClaim || total.providerBillClaim;
    }
    for (const entry of report.officialCost.unavailable.entries) {
      state.unavailableOfficialEntries.push({
        stage: entry.stage,
        reason: entry.reason,
      });
    }

    // Official cost ranges — aggregate additively per currency
    for (const rng of report.officialCost.ranges) {
      let cur = state.officialRangeByCurrency.get(rng.currency);
      if (!cur) {
        cur = { min: 0, max: 0, rangedAttemptCount: 0, sources: new Set() };
        state.officialRangeByCurrency.set(rng.currency, cur);
      }
      cur.min += rng.min;
      cur.max += rng.max;
      cur.rangedAttemptCount += rng.rangedAttemptCount;
      for (const src of rng.sources) cur.sources.add(src);
    }

    // Worker Token volume
    const wv = report.tokenReport.report.workerVolume;
    state.grossWorkerTokens += wv.grossWorkerTokens;
    if (wv.kind === "complete") {
      state.completeWorkerTaskCount++;
      state.totalCompleteWorkerSampleCount += wv.sampleCount;
    } else {
      state.incompleteWorkerTaskCount++;
      state.totalCompleteWorkerSampleCount += wv.completeSampleCount;
      state.totalMissingWorkerSampleCount += wv.missingSampleCount;
    }

    // Runtime counter-family reconciliation. Mismatch is deliberately a
    // soft telemetry warning: this reducer only reports it and never feeds
    // routing, retries, Task status, Integration, cost, or savings.
    const rec = report.tokenReport.usageReconciliation;
    state.reconciliationStateCounts[rec.state]++;
    state.reconciliationComparedAttemptCount += rec.comparedAttemptCount;
    state.reconciliationMatchedAttemptCount += rec.matchedAttemptCount;
    state.reconciliationMismatchedAttemptCount += rec.mismatchedAttemptCount;
    state.reconciliationMissingBreakdownCount += rec.missingBreakdownCount;
    state.reconciliationMissingUsageCount += rec.missingUsageCount;
    state.reconciliationInvalidCounterEvidenceCount += rec.invalidCounterEvidenceCount;
    if (rec.grossDeltas.available) {
      state.reconciliationComparableTaskCount++;
      const top = state.reconciliationTopLevelGross + rec.grossDeltas.topLevelGross;
      const perModel = state.reconciliationPerModelGross + rec.grossDeltas.perModelGross;
      if (!Number.isSafeInteger(top) || !Number.isSafeInteger(perModel)) {
        state.reconciliationAggregateOverflow = true;
      } else if (!state.reconciliationAggregateOverflow) {
        state.reconciliationTopLevelGross = top;
        state.reconciliationPerModelGross = perModel;
      }
    } else {
      state.reconciliationUnavailableTaskCount++;
    }

    // Orchestration exchange
    const ee = report.tokenReport.report.exchangeEstimate;
    if (ee.kind === "exact") {
      state.exchangeAvailableTaskCount++;
      state.exchangeMin += ee.tokens;
      state.exchangeMax += ee.tokens;
    } else if (ee.kind === "range") {
      state.exchangeAvailableTaskCount++;
      state.exchangeMin += ee.range.min;
      state.exchangeMax += ee.range.max;
    } else {
      state.unavailableExchangeEntries.push({
        taskId: report.taskId,
        reason: ee.reason,
      });
    }

    // Boundary reduction
    const br = report.tokenReport.report.boundaryReduction;
    if (br.available) {
      state.boundaryAvailableTaskCount++;
      state.boundaryMin = (state.boundaryMin ?? 0) + br.tokens.min;
      state.boundaryMax = (state.boundaryMax ?? 0) + br.tokens.max;
    } else {
      state.unavailableBoundaryEntries.push({
        taskId: report.taskId,
        reason: br.reason,
      });
    }

    // Direct-Codex savings
    const dcs = report.tokenReport.report.directCodexSavings;
    if (dcs.available) {
      state.codexAvailableTaskCount++;
      state.codexMin = (state.codexMin ?? 0) + dcs.absoluteSavings.min;
      state.codexMax = (state.codexMax ?? 0) + dcs.absoluteSavings.max;
      if (dcs.absoluteSavings.min < 0 || dcs.absoluteSavings.max < 0) {
        state.codexNegativeBoundCount++;
      }
      const conf = dcs.absoluteSavings.confidence;
      state.codexConfidenceCounts.set(
        conf,
        (state.codexConfidenceCounts.get(conf) ?? 0) + 1,
      );
    } else {
      state.unavailableCodexEntries.push({
        taskId: report.taskId,
        reason: dcs.reason,
      });
    }
  }

  return state;
}

function buildOfficialCostSection(
  state: ReportReduceState,
): PortfolioOfficialCostSection {
  const currencyTotals: PortfolioOfficialCostCurrencyTotal[] = [...state.currencyAggregates.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, data]) => ({
      currency,
      total: data.total,
      quotedAttemptCount: data.quotedAttemptCount,
      sources: [...data.sources].sort(),
      providerBillClaim: data.providerBillClaim,
    }));

  const breakdown: Record<string, number> = {};
  for (const entry of state.unavailableOfficialEntries) {
    const key = `${entry.stage}:${entry.reason}`;
    breakdown[key] = (breakdown[key] ?? 0) + 1;
  }

  const ranges: PortfolioOfficialCostRangeTotal[] = [...state.officialRangeByCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, data]) => ({
      currency,
      min: data.min,
      max: data.max,
      rangedAttemptCount: data.rangedAttemptCount,
      sources: [...data.sources].sort(),
    }));

  return {
    currencyTotals,
    ranges,
    unavailable: {
      unavailableAttemptCount: state.unavailableOfficialEntries.length,
      breakdown,
    },
  };
}

function buildExchangeSection(
  state: ReportReduceState,
): PortfolioExchangeSection {
  const breakdown: Record<string, number> = {};
  for (const entry of state.unavailableExchangeEntries) {
    breakdown[entry.reason] = (breakdown[entry.reason] ?? 0) + 1;
  }
  return {
    min: state.exchangeMin,
    max: state.exchangeMax,
    availableTaskCount: state.exchangeAvailableTaskCount,
    unavailableTaskCount: state.unavailableExchangeEntries.length,
    unavailableReasons: breakdown,
  };
}

function buildBoundarySection(
  state: ReportReduceState,
): PortfolioBoundaryReductionSection {
  const breakdown: Record<string, number> = {};
  for (const entry of state.unavailableBoundaryEntries) {
    breakdown[entry.reason] = (breakdown[entry.reason] ?? 0) + 1;
  }
  return {
    min: state.boundaryMin ?? 0,
    max: state.boundaryMax ?? 0,
    availableTaskCount: state.boundaryAvailableTaskCount,
    unavailableTaskCount: state.unavailableBoundaryEntries.length,
    unavailableReasons: breakdown,
  };
}

function codexConfidenceRecord(
  counts: Map<string, number>,
): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const [k, v] of counts) result[k] = v;
  return result;
}

function buildCodexSection(
  state: ReportReduceState,
): PortfolioDirectCodexSavingsSection {
  const breakdown: Record<string, number> = {};
  for (const entry of state.unavailableCodexEntries) {
    breakdown[entry.reason] = (breakdown[entry.reason] ?? 0) + 1;
  }
  return {
    min: state.codexMin ?? 0,
    max: state.codexMax ?? 0,
    availableTaskCount: state.codexAvailableTaskCount,
    unavailableTaskCount: state.unavailableCodexEntries.length,
    unavailableReasons: breakdown,
    negativeBoundCount: state.codexNegativeBoundCount,
    confidenceCounts: codexConfidenceRecord(state.codexConfidenceCounts),
  };
}

// --- Public API ---

/** Build a detached deeply-frozen portfolio economics summary from every
 *  terminal Task matching the optional filter.  Never reads legacy costUsd,
 *  never combines currencies, never converts currencies, and never calls
 *  a Provider. */
export function getPortfolioEconomicsSummary(
  store: StateStore,
  filter: StatisticsFilter = {},
): PortfolioEconomicsSummary {
  const taskIds = selectTerminalTasks(store, filter);
  const reports = taskIds.map((taskId) => getTaskEconomicsReport(store, taskId));

  const state = reduceReports(reports);

  const totalTasks = state.taskIds.length;
  const totalAttempts = state.totalAttemptCount;

  const summary: PortfolioEconomicsSummary = {
    scope: {
      terminalTaskCount: totalTasks,
      totalAttemptCount: totalAttempts,
      nonEmpty: totalTasks > 0,
    },
    runtimeBudget: {
      configuredFiniteCapSumUsd: state.configuredFiniteCapSumUsd,
      cappedAttemptCount: state.cappedAttemptCount,
      uncappedAttemptCount: state.uncappedAttemptCount,
      unknownAttemptCount: state.unknownAttemptCount,
      totalAttemptCount: totalAttempts,
      complete: state.unknownAttemptCount === 0 && totalAttempts > 0,
    },
    runtimeEstimate: {
      observedTotalUsd: state.runtimeEstimateSumUsd,
      sampleCount: state.runtimeEstimateSampleCount,
      missingCount: state.runtimeEstimateMissingCount,
      complete: state.runtimeEstimateMissingCount === 0 && totalAttempts > 0,
    },
    officialCost: buildOfficialCostSection(state),
    workerVolume: {
      grossWorkerTokens: state.grossWorkerTokens,
      completeTaskCount: state.completeWorkerTaskCount,
      incompleteTaskCount: state.incompleteWorkerTaskCount,
      totalTaskCount: totalTasks,
      totalCompleteSampleCount: state.totalCompleteWorkerSampleCount,
      totalMissingSampleCount: state.totalMissingWorkerSampleCount,
    },
    tokenReconciliation: {
      workerVolumeSource: "terminal-top-level",
      perModelRole: "diagnostic-only",
      totalTaskCount: totalTasks,
      stateCounts: { ...state.reconciliationStateCounts },
      comparedAttemptCount: state.reconciliationComparedAttemptCount,
      matchedAttemptCount: state.reconciliationMatchedAttemptCount,
      mismatchedAttemptCount: state.reconciliationMismatchedAttemptCount,
      missingBreakdownCount: state.reconciliationMissingBreakdownCount,
      missingUsageCount: state.reconciliationMissingUsageCount,
      invalidCounterEvidenceCount: state.reconciliationInvalidCounterEvidenceCount,
      comparison: state.reconciliationComparableTaskCount === 0
        ? {
            available: false,
            scope: "compared-attempts-only",
            availableTaskCount: 0,
            unavailableTaskCount: state.reconciliationUnavailableTaskCount,
            reason: "no-comparable-tasks",
          }
        : state.reconciliationAggregateOverflow
          ? {
              available: false,
              scope: "compared-attempts-only",
              availableTaskCount: state.reconciliationComparableTaskCount,
              unavailableTaskCount: state.reconciliationUnavailableTaskCount,
              reason: "safe-integer-overflow",
            }
          : {
              available: true,
              scope: "compared-attempts-only",
              availableTaskCount: state.reconciliationComparableTaskCount,
              unavailableTaskCount: state.reconciliationUnavailableTaskCount,
              topLevelGross: state.reconciliationTopLevelGross,
              perModelGross: state.reconciliationPerModelGross,
              delta: state.reconciliationPerModelGross - state.reconciliationTopLevelGross,
            },
    },
    exchange: buildExchangeSection(state),
    boundaryReduction: buildBoundarySection(state),
    directCodexSavings: buildCodexSection(state),
  };

  deepFreeze(summary);
  return summary;
}
