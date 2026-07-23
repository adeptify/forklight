// Task economics evidence report — Store-backed read-only service.
// Composes persisted Attempt runtime estimates, official native-currency
// cost evidence, and the canonical Task Token report into a detached
// deeply-frozen single-source evidence model.  Never falls back to
// legacy costUsd, never converts or combines currencies, never infers
// Task class or calibration, and never claims a Provider bill.
//
// This model separates runtime estimates, official native-currency
// evidence, Worker Token usage, and the Task runtime budget cap so
// consumers render each distinction without re-deriving arithmetic.

import type { AttemptRecord, TaskRecord } from "./types.js";
import type { AttemptOfficialCostCalculationUnavailable, AttemptOfficialCostQuoted } from "./types.js";
import { getTaskTokenReport, type ReportCalibrationOptions, type TaskTokenReport } from "./token-report.js";
import type { StateStore } from "../state/store.js";
import type { PricingCurrency } from "./pricing.js";
import type { OrchestrationExchangeReceipt } from "./token-efficiency.js";
import type { DirectCodexProfilePublication } from "./direct-codex-calibration.js";

// --- Immutability helpers ---

function freezeDeep(v: unknown): void {
  if (v !== null && typeof v === "object" && !Object.isFrozen(v)) {
    if (Array.isArray(v)) { for (const e of v) freezeDeep(e); }
    else { for (const e of Object.values(v)) freezeDeep(e); }
    Object.freeze(v);
  }
}

// --- Public types ---

export interface RuntimeBudgetSection {
  /** The configured Claude runtime maxBudgetUsd, or null when no cap is set.
   *  null means uncapped Claude runtime, not zero cost and not unlimited
   *  company spending authority. */
  readonly maxBudgetUsd: number | null;
  readonly capped: boolean;
  readonly label: "capped" | "uncapped";
}

export interface RuntimeEstimateSection {
  /** Sum of all present runtimeCostEstimateUsd values across Attempts.
   *  Legacy costUsd is never added — missing and unavailable estimates
   *  are counted separately. */
  readonly observedTotalUsd: number;
  readonly sampleCount: number;
  readonly missingCount: number;
  /** True when at least one Attempt exists and every Attempt carries a
   *  finite runtimeCostEstimateUsd. */
  readonly complete: boolean;
}

export interface OfficialCostCurrencyTotals {
  readonly currency: PricingCurrency;
  /** Exact sum of quoted totals in this native currency.  Different
   *  currencies are never combined. */
  readonly total: number;
  /** Number of quoted Attempts aggregated into this total. */
  readonly quotedCount: number;
  /** Unique pricing-source URLs that contributed quoted evidence, sorted
   *  deterministically. */
  readonly sources: readonly string[];
  /** Mirrors quoted evidence — this report never claims a Provider bill,
   *  but preserves whatever the canonical calculator produced. */
  readonly providerBillClaim: boolean;
}

export interface UnavailableOfficialEntry {
  readonly attemptId: string;
  readonly ordinal: number;
  /** Stable stage: "missing", "usage", "pricing-identity", or "calculation". */
  readonly stage: string;
  /** Typed reason from the unavailable evidence or "missing-officialCost-record"
   *  when no officialCost record exists on the Attempt.  Calculation-stage
   *  reasons come from result.reason. */
  readonly reason: string;
}

export interface UnavailableOfficialSection {
  readonly unavailableCount: number;
  /** Every Attempt without a quoted official cost, in ordinal order. */
  readonly entries: readonly UnavailableOfficialEntry[];
  /** Counts keyed by "stage:reason" for stable aggregation. */
  readonly breakdown: Readonly<Record<string, number>>;
}

export interface OfficialCostSection {
  /** Native-currency totals — one entry per currency sorted by currency
   *  code.  Never contains a cross-currency grand total. */
  readonly totals: readonly OfficialCostCurrencyTotals[];
  readonly unavailable: UnavailableOfficialSection;
}

export interface TaskEconomicsReport {
  readonly taskId: string;
  readonly runtimeBudget: RuntimeBudgetSection;
  readonly runtimeEstimate: RuntimeEstimateSection;
  readonly officialCost: OfficialCostSection;
  /** Canonical Task Token evidence — embedded unchanged.  Worker volume is
   *  not relabeled as savings; direct-Codex savings stays unavailable
   *  without explicit compatible calibration. */
  readonly tokenReport: TaskTokenReport;
}

// --- Narrow Store facade for one-snapshot guarantee ---

/** Read-only subset of StateStore needed by getTaskTokenReport.  Used to
 *  supply the canonical token service with the already-captured Task and
 *  Attempts so the real Store listAttempts is invoked exactly once, and
 *  to forward the exact-pair profile publication lookup to the canonical
 *  Store without consulting it again. */
interface TokenReportStoreFacade {
  getTask(taskId: string): TaskRecord;
  listAttempts(taskId: string): AttemptRecord[];
  listExchangeReceipts(taskId: string): OrchestrationExchangeReceipt[];
  latestDirectCodexProfilePublication(
    taskClass: string,
    profileId: string,
  ): DirectCodexProfilePublication | undefined;
}

// --- Public API ---

/** Build a detached deeply-frozen Task economics evidence report from
 *  the persisted Task, its Attempts, and the canonical Task Token report.
 *  Verifies the Task exists through the Store, reads Attempts exactly once
 *  from the real Store, and reuses getTaskTokenReport for canonical Worker
 *  Token and orchestration exchange semantics via a narrow read-only facade
 *  so the real Store is never consulted for task/attempt data a second time.
 *  Options are passed through to the Token report unchanged — this service
 *  never infers calibration, Task class, or profile identity. */
export function getTaskEconomicsReport(
  store: StateStore,
  taskId: string,
  options?: ReportCalibrationOptions,
): TaskEconomicsReport {
  // Verify Task exists and snapshot its attempts once from the real Store
  const task = store.getTask(taskId);
  const attempts = store.listAttempts(taskId);

  // --- 1. Runtime budget snapshot ---
  const maxBudgetUsd: number | null = task.spec.runtime.maxBudgetUsd;
  const runtimeBudget: RuntimeBudgetSection = {
    maxBudgetUsd,
    capped: maxBudgetUsd !== null,
    label: maxBudgetUsd !== null ? "capped" : "uncapped",
  };

  // --- 2. Runtime estimate aggregation (runtimeCostEstimateUsd only) ---
  let observedTotalUsd = 0;
  let estimateSampleCount = 0;
  let estimateMissingCount = 0;
  for (const a of attempts) {
    if (typeof a.runtimeCostEstimateUsd === "number" && Number.isFinite(a.runtimeCostEstimateUsd)) {
      observedTotalUsd += a.runtimeCostEstimateUsd;
      estimateSampleCount++;
    } else {
      estimateMissingCount++;
    }
  }
  const runtimeEstimate: RuntimeEstimateSection = {
    observedTotalUsd,
    sampleCount: estimateSampleCount,
    missingCount: estimateMissingCount,
    complete: estimateMissingCount === 0 && attempts.length > 0,
  };

  // --- 3. Official cost aggregation ---
  type CurrencyAggregate = {
    total: number;
    quotedCount: number;
    sources: Set<string>;
    providerBillClaim: boolean;
  };
  const byCurrency = new Map<PricingCurrency, CurrencyAggregate>();
  const unavailableEntries: UnavailableOfficialEntry[] = [];

  for (const a of attempts) {
    const oc = a.officialCost;
    if (oc === undefined) {
      unavailableEntries.push({
        attemptId: a.id, ordinal: a.ordinal,
        stage: "missing", reason: "missing-officialCost-record",
      });
      continue;
    }

    if (oc.quoted) {
      const q = oc as AttemptOfficialCostQuoted;
      const currency = q.result.currency;
      let cur = byCurrency.get(currency);
      if (!cur) {
        cur = { total: 0, quotedCount: 0, sources: new Set(), providerBillClaim: q.result.providerBillClaim };
        byCurrency.set(currency, cur);
      }
      cur.total += q.result.total;
      cur.quotedCount++;
      cur.sources.add(q.result.pricing.source.url);
    } else {
      let reason: string;
      if ("result" in oc && oc.result !== undefined) {
        reason = (oc as AttemptOfficialCostCalculationUnavailable).result.reason;
      } else {
        reason = (oc as { reason: string }).reason;
      }
      unavailableEntries.push({
        attemptId: a.id, ordinal: a.ordinal,
        stage: oc.stage, reason,
      });
    }
  }

  // Build currency-pure totals — sorted deterministically, no cross-currency grand total
  const totals: OfficialCostCurrencyTotals[] = [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, data]) => ({
      currency,
      total: data.total,
      quotedCount: data.quotedCount,
      sources: [...data.sources].sort(),
      providerBillClaim: data.providerBillClaim,
    }));

  // Stable typed breakdown: "stage:reason"
  const breakdown: Record<string, number> = {};
  for (const entry of unavailableEntries) {
    const key = `${entry.stage}:${entry.reason}`;
    breakdown[key] = (breakdown[key] ?? 0) + 1;
  }

  // --- 4. Canonical Task Token report via narrow one-snapshot facade ---
  const facade: TokenReportStoreFacade = {
    getTask: () => task,
    listAttempts: () => attempts,
    listExchangeReceipts: (tid: string) => store.listExchangeReceipts(tid),
    latestDirectCodexProfilePublication: (cls: string, profileId: string) =>
      store.latestDirectCodexProfilePublication(cls, profileId),
  };
  const tokenReport = getTaskTokenReport(facade as unknown as StateStore, taskId, options);

  // --- Assemble and freeze ---
  const report: TaskEconomicsReport = {
    taskId,
    runtimeBudget,
    runtimeEstimate,
    officialCost: {
      totals,
      unavailable: {
        unavailableCount: unavailableEntries.length,
        entries: unavailableEntries,
        breakdown,
      },
    },
    tokenReport,
  };

  freezeDeep(report);
  return report;
}
