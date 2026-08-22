// Read-only family Main Token value report (M4-C).
// Reuses current M4-B pair reports and canonical Task economics/event reads.
// Lists every in-scope accepted/rejected comparison. Proven-lower only from
// a current accepted pair with strictly positive direct-minus-delegated.
// Missing evidence is typed, never a zero sample. No hidden winner, FX,
// percentage average, Worker/Main mix, or work creation.

import { getTaskEconomicsReport } from "./task-economics-report.js";
import {
  MAIN_PAIR_METHOD,
  readMainPairReport,
  type MainPairAssessment,
  type MainPairOutcome,
  type MainPairPercentage,
  type MainPairReason,
  type MainPairReport,
  type MainPairSaving,
} from "./main-token-pair.js";
import { normalizeMainUsageComparisonId } from "./main-token-usage.js";
import type { StateStore } from "../state/store.js";
import type { AttemptRecord, EventRecord, MainDirectDecisionRecord } from "./types.js";
import { deepFreeze } from "./immutability.js";

export const MAIN_VALUE_REPORT_SCHEMA_VERSION = 1 as const;
export const MAIN_VALUE_REPORT_METHOD = MAIN_PAIR_METHOD;
const MAX_VALUE_REPORT_FAMILIES = 10 as const;
const MAX_VALUE_REPORT_COMPARISONS = 64 as const;

export const MAIN_VALUE_REPORT_REASONS = [
  "invalid-request",
  "empty-store",
  "uncovered-family",
  "legacy-pair-contract-missing",
  "comparison-identities-unavailable",
  "comparison-not-found",
  "comparison-family-mismatch",
  "incomplete-evidence",
  "stale-pair",
  "rejected-pair",
  "cannot-determine",
  "not-strictly-positive",
] as const;
export type MainValueReportReason = (typeof MAIN_VALUE_REPORT_REASONS)[number];

export type FamilyValueClaim = "proven-lower" | "cannot-determine";
export type OverallValueClaim = "proven" | "cannot-determine";
export type ComparisonListingStatus =
  | "accepted"
  | "rejected"
  | "stale"
  | "incomplete"
  | "legacy"
  | "absent";
export type EvidenceCompleteness = "complete" | "incomplete" | "unavailable";

export interface CountedTokenEvidence {
  readonly status: EvidenceCompleteness;
  readonly reason?: string;
  readonly grossTokens?: number;
  readonly completeCount: number;
  readonly incompleteCount: number;
  readonly denominator: number;
}

export interface RuntimeEstimateEvidence {
  readonly status: EvidenceCompleteness;
  readonly reason?: string;
  readonly observedTotalUsd?: number;
  readonly sampleCount: number;
  readonly missingCount: number;
  readonly denominator: number;
}

export interface OfficialNativeCurrencyTotal {
  readonly currency: string;
  readonly total: number;
  readonly quotedCount: number;
  readonly sources: readonly string[];
  readonly providerBillClaim: boolean;
}

export interface OfficialNativeCurrencyRange {
  readonly currency: string;
  readonly min: number;
  readonly max: number;
  readonly rangedAttemptCount: number;
  readonly sources: readonly string[];
}

export interface OfficialCostEvidence {
  readonly status: "quoted" | "ranged" | "mixed" | "unavailable";
  readonly reason?: string;
  readonly totals: readonly OfficialNativeCurrencyTotal[];
  readonly ranges: readonly OfficialNativeCurrencyRange[];
  readonly unavailableCount: number;
  readonly unavailableBreakdown: Readonly<Record<string, number>>;
}

export interface ElapsedEvidence {
  readonly status: EvidenceCompleteness;
  readonly reason?: string;
  readonly totalMs?: number;
  readonly measuredCount: number;
  readonly unmeasuredCount: number;
  readonly denominator: number;
}

export interface MainDirectElapsedEvidence {
  readonly status: EvidenceCompleteness;
  readonly reason?: string;
  readonly binding: "task-family";
  readonly totalMs?: number;
  readonly closedCount: number;
  readonly openCount: number;
  readonly unmeasuredCount: number;
  readonly denominator: number;
}

export interface CorrectionHandoffEvidence {
  readonly status: EvidenceCompleteness;
  readonly reason?: string;
  readonly workerValidationRepairCount: number;
  readonly mainCorrectionCount: number;
  readonly mainReverificationCount: number;
  readonly handoffCount: number;
  readonly attemptCount: number;
  readonly eventCount: number;
}

export interface DelegatedDeliveryValue {
  readonly workerTokens: CountedTokenEvidence;
  readonly runtimeEstimate: RuntimeEstimateEvidence;
  readonly officialCost: OfficialCostEvidence;
  readonly attemptElapsed: ElapsedEvidence;
  readonly corrections: CorrectionHandoffEvidence;
}

export interface ValueComparisonEntry {
  readonly comparisonId: string;
  readonly forklightTaskId?: string;
  readonly taskFamily?: string;
  readonly taskClass?: string;
  readonly directCodexProfileId?: string;
  readonly method: typeof MAIN_VALUE_REPORT_METHOD;
  readonly pairValidity: MainPairOutcome | "absent";
  readonly pairReasons: readonly MainPairReason[];
  readonly listingStatus: ComparisonListingStatus;
  readonly contributesProvenLower: boolean;
  readonly directGrossTokens?: number;
  readonly delegatedGrossTokens?: number;
  readonly signedChange?: number;
  readonly percentageChange: MainPairPercentage;
  readonly saving: MainPairSaving;
  readonly qualityGates?: {
    readonly sameScope: true;
    readonly sameAcceptance: true;
    readonly delegatedQualityNotLower: true;
  };
  readonly evidence?: MainPairReport["evidence"];
  readonly deliveryValue: DelegatedDeliveryValue;
}

export interface FamilyValueSection {
  readonly taskFamily: string;
  readonly claim: FamilyValueClaim;
  readonly reasons: readonly MainValueReportReason[];
  readonly comparisons: readonly ValueComparisonEntry[];
  readonly acceptedPairCount: number;
  readonly rejectedPairCount: number;
  readonly provenLowerPairCount: number;
  readonly mainDirectElapsed: MainDirectElapsedEvidence;
}

export interface MainTokenValueReport {
  readonly schemaVersion: typeof MAIN_VALUE_REPORT_SCHEMA_VERSION;
  readonly method: typeof MAIN_VALUE_REPORT_METHOD;
  readonly requestedFamilies: readonly string[];
  readonly requestedComparisons: readonly string[];
  readonly overall: OverallValueClaim;
  readonly reasons: readonly MainValueReportReason[];
  readonly confidence: OverallValueClaim;
  readonly families: readonly FamilyValueSection[];
  readonly createdWork: false;
}

const REQUEST_KEYS: ReadonlySet<string> = new Set(["families", "comparisons"]);
const RAW_FIELDS: ReadonlySet<string> = new Set([
  "text", "content", "prompt", "body", "payload", "raw", "secret", "credential",
  "log", "response", "request", "sourceText", "sourceHash", "diff", "path",
  "notes", "note", "reason", "detail",
]);
const REPORT_FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  "change", "savings", "directCodexSavings", "familyValue", "calibration",
  "workerMainTotal", "fxTotal", "averagePercentage", "bestPair", "ranking",
  "prompt", "response", "source", "diff", "path", "log", "credential", "note",
]);
const TASK_LABEL = /^[^\s].{0,79}$/;
const REASON_RANK = new Map(MAIN_VALUE_REPORT_REASONS.map((reason, index) => [reason, index]));

const hasOwn = (object: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);

function uniqueSortedReasons(reasons: readonly MainValueReportReason[]): MainValueReportReason[] {
  return [...new Set(reasons)].sort((left, right) =>
    (REASON_RANK.get(left) ?? 99) - (REASON_RANK.get(right) ?? 99),
  );
}

function emptyPercentage(): MainPairPercentage {
  return { available: false, reason: "totals-unavailable" };
}

function unavailableTokens(reason: string): CountedTokenEvidence {
  return { status: "unavailable", reason, completeCount: 0, incompleteCount: 0, denominator: 0 };
}

function unavailableRuntime(reason: string): RuntimeEstimateEvidence {
  return { status: "unavailable", reason, sampleCount: 0, missingCount: 0, denominator: 0 };
}

function unavailableOfficial(reason: string): OfficialCostEvidence {
  return {
    status: "unavailable",
    reason,
    totals: [],
    ranges: [],
    unavailableCount: 0,
    unavailableBreakdown: {},
  };
}

function unavailableElapsed(reason: string): ElapsedEvidence {
  return { status: "unavailable", reason, measuredCount: 0, unmeasuredCount: 0, denominator: 0 };
}

function unavailableCorrections(reason: string): CorrectionHandoffEvidence {
  return {
    status: "unavailable",
    reason,
    workerValidationRepairCount: 0,
    mainCorrectionCount: 0,
    mainReverificationCount: 0,
    handoffCount: 0,
    attemptCount: 0,
    eventCount: 0,
  };
}

function unavailableDelivery(reason: string): DelegatedDeliveryValue {
  return {
    workerTokens: unavailableTokens(reason),
    runtimeEstimate: unavailableRuntime(reason),
    officialCost: unavailableOfficial(reason),
    attemptElapsed: unavailableElapsed(reason),
    corrections: unavailableCorrections(reason),
  };
}

function unavailableMainDirect(reason: string): MainDirectElapsedEvidence {
  return {
    status: "unavailable",
    reason,
    binding: "task-family",
    closedCount: 0,
    openCount: 0,
    unmeasuredCount: 0,
    denominator: 0,
  };
}

type ParsedRequest =
  | {
    ok: true;
    families: readonly string[];
    comparisons: readonly string[];
    filterActive: boolean;
  }
  | { ok: false; families: readonly string[]; comparisons: readonly string[] };

function parseStringList(value: unknown, max: number): string[] | undefined {
  if (!Array.isArray(value) || value.length > max) return undefined;
  const items: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || entry !== entry.trim() || !TASK_LABEL.test(entry)) {
      return undefined;
    }
    if (seen.has(entry)) return undefined;
    seen.add(entry);
    items.push(entry);
  }
  return items;
}

function parseRequest(params: unknown): ParsedRequest {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    return { ok: false, families: [], comparisons: [] };
  }
  const raw = params as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!REQUEST_KEYS.has(key) || RAW_FIELDS.has(key)) {
      return { ok: false, families: [], comparisons: [] };
    }
  }
  if (!hasOwn(raw, "families")) return { ok: false, families: [], comparisons: [] };
  const families = parseStringList(raw.families, MAX_VALUE_REPORT_FAMILIES);
  if (families === undefined || families.length < 1) {
    return { ok: false, families: [], comparisons: [] };
  }
  if (!hasOwn(raw, "comparisons") || raw.comparisons === undefined) {
    return { ok: true, families, comparisons: [], filterActive: false };
  }
  if (!Array.isArray(raw.comparisons)) return { ok: false, families, comparisons: [] };
  if (raw.comparisons.length === 0) {
    return { ok: true, families, comparisons: [], filterActive: false };
  }
  if (raw.comparisons.length > MAX_VALUE_REPORT_COMPARISONS) {
    return { ok: false, families, comparisons: [] };
  }
  const comparisons: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw.comparisons) {
    let comparisonId: string;
    try {
      comparisonId = normalizeMainUsageComparisonId(entry);
    } catch {
      return { ok: false, families, comparisons: [] };
    }
    if (seen.has(comparisonId)) return { ok: false, families, comparisons: [] };
    seen.add(comparisonId);
    comparisons.push(comparisonId);
  }
  return { ok: true, families, comparisons, filterActive: true };
}

interface ComparisonIdentity {
  readonly comparisonId: string;
  readonly forklightTaskId?: string;
  readonly taskFamily?: string;
}

interface SqliteLike {
  prepare(sql: string): { all: (...params: unknown[]) => unknown };
}

function peekLiveSqlite(store: object): SqliteLike | undefined {
  const db = (store as { db?: unknown }).db;
  if (db === null || typeof db !== "object") return undefined;
  if (typeof (db as { prepare?: unknown }).prepare !== "function") return undefined;
  return db as SqliteLike;
}

/** Read comparison ids from the live Store connection. This is not a second
 *  database client and adds no schema; store.ts has no family enumerator. */
function discoverStoredComparisonIds(store: StateStore): string[] | undefined {
  const db = peekLiveSqlite(store);
  if (db === undefined) return undefined;
  try {
    const sampleRows = db.prepare(
      "SELECT DISTINCT comparison_id AS id FROM main_usage_samples",
    ).all() as Array<{ id?: unknown }>;
    const assessmentRows = db.prepare(
      "SELECT comparison_id AS id FROM main_pair_assessments",
    ).all() as Array<{ id?: unknown }>;
    const ids = new Set<string>();
    for (const row of [...sampleRows, ...assessmentRows]) {
      if (typeof row?.id !== "string") continue;
      try {
        ids.add(normalizeMainUsageComparisonId(row.id));
      } catch {
        // Skip unreadable identities rather than inventing a sample.
      }
    }
    return [...ids];
  } catch {
    return undefined;
  }
}

function resolveIdentity(store: StateStore, comparisonId: string): ComparisonIdentity {
  const assessment = store.getMainPairAssessmentByComparison(comparisonId);
  const samples = store.listMainUsageSamplesByComparison(comparisonId);
  const sample = samples[0];
  const forklightTaskId = assessment?.forklightTaskId ?? sample?.forklightTaskId;
  let taskFamily = assessment?.taskFamily ?? sample?.taskFamily;
  if (taskFamily === undefined && forklightTaskId !== undefined) {
    try {
      taskFamily = store.getTask(forklightTaskId).spec.taskFamily;
    } catch {
      // Task identity remains optional; missing is not a zero family.
    }
  }
  return {
    comparisonId,
    ...(forklightTaskId === undefined ? {} : { forklightTaskId }),
    ...(taskFamily === undefined ? {} : { taskFamily }),
  };
}

function safePairReport(store: StateStore, taskId: string, comparisonId: string): MainPairReport | undefined {
  try {
    return readMainPairReport(store, taskId, comparisonId);
  } catch {
    return undefined;
  }
}

function listingStatus(
  assessment: MainPairAssessment | undefined,
  pair: MainPairReport | undefined,
): ComparisonListingStatus {
  if (pair === undefined && assessment === undefined) return "absent";
  if (assessment?.decision === "rejected") return "rejected";
  if (assessment?.decision === "accepted" && pair?.validity === "accepted") return "accepted";
  if (assessment?.decision === "accepted") return "stale";
  if (pair?.reasons.includes("legacy-pair-contract-missing")) return "legacy";
  return "incomplete";
}

function elapsedMs(startedAt: string, finishedAt: string): number | undefined {
  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return undefined;
  return finished - started;
}

function projectAttemptElapsed(attempts: readonly AttemptRecord[]): ElapsedEvidence {
  if (attempts.length === 0) return unavailableElapsed("no-attempts");
  let totalMs = 0;
  let measured = 0;
  let unmeasured = 0;
  for (const attempt of attempts) {
    if (attempt.finishedAt === undefined) {
      unmeasured += 1;
      continue;
    }
    const duration = elapsedMs(attempt.startedAt, attempt.finishedAt);
    if (duration === undefined) {
      unmeasured += 1;
      continue;
    }
    totalMs += duration;
    measured += 1;
  }
  if (measured === 0) {
    return {
      status: "unavailable",
      reason: "attempt-timestamps-unavailable",
      measuredCount: 0,
      unmeasuredCount: unmeasured,
      denominator: attempts.length,
    };
  }
  return {
    status: unmeasured === 0 ? "complete" : "incomplete",
    ...(unmeasured === 0 ? {} : { reason: "attempt-timestamps-incomplete" }),
    totalMs,
    measuredCount: measured,
    unmeasuredCount: unmeasured,
    denominator: attempts.length,
  };
}

function projectMainDirectElapsed(
  decisions: readonly MainDirectDecisionRecord[],
  taskFamily: string,
): MainDirectElapsedEvidence {
  const scoped = decisions.filter((decision) => decision.taskFamily === taskFamily);
  if (scoped.length === 0) return unavailableMainDirect("no-main-direct-episode");
  let totalMs = 0;
  let closed = 0;
  let open = 0;
  let unmeasured = 0;
  for (const decision of scoped) {
    const closedAt = decision.closedState?.closedAt;
    if (closedAt === undefined) {
      open += 1;
      continue;
    }
    const duration = elapsedMs(decision.startedAt, closedAt);
    if (duration === undefined) {
      unmeasured += 1;
      continue;
    }
    totalMs += duration;
    closed += 1;
  }
  if (closed === 0) {
    return {
      status: "unavailable",
      reason: "main-direct-episode-open-or-unmeasured",
      binding: "task-family",
      closedCount: 0,
      openCount: open,
      unmeasuredCount: unmeasured,
      denominator: scoped.length,
    };
  }
  return {
    status: open === 0 && unmeasured === 0 ? "complete" : "incomplete",
    ...(open === 0 && unmeasured === 0 ? {} : { reason: "main-direct-episode-incomplete" }),
    binding: "task-family",
    totalMs,
    closedCount: closed,
    openCount: open,
    unmeasuredCount: unmeasured,
    denominator: scoped.length,
  };
}

function projectCorrections(
  store: StateStore,
  taskId: string,
  attempts: readonly AttemptRecord[],
  events: readonly EventRecord[],
): CorrectionHandoffEvidence {
  let handoffCount = 0;
  try {
    handoffCount = store.listCandidateHandoffsBySourceTaskId(taskId).length;
  } catch {
    handoffCount = events.filter((event) => event.type === "candidate.handoff.authorized").length;
  }
  const kindCorrections = attempts.filter((attempt) => attempt.executionKind === "main-correction").length;
  const reviseCorrections = events.filter((event) => event.type === "task.revise.requested").length;
  return {
    status: "complete",
    workerValidationRepairCount: events.filter((event) => event.type === "worker.validation-repair.authorized").length,
    mainCorrectionCount: kindCorrections > 0 ? kindCorrections : reviseCorrections,
    mainReverificationCount: events.filter((event) => event.type === "candidate.reverification.authorized").length,
    handoffCount,
    attemptCount: attempts.length,
    eventCount: events.length,
  };
}

function projectDeliveryValue(store: StateStore, taskId: string | undefined): DelegatedDeliveryValue {
  if (taskId === undefined) return unavailableDelivery("delegated-task-unavailable");
  let attempts: AttemptRecord[];
  let events: EventRecord[];
  try {
    attempts = store.listAttempts(taskId);
    events = store.listEvents(taskId);
  } catch {
    return unavailableDelivery("delegated-task-unavailable");
  }

  let workerTokens = unavailableTokens("task-economics-unavailable");
  let runtimeEstimate = unavailableRuntime("task-economics-unavailable");
  let officialCost = unavailableOfficial("task-economics-unavailable");
  try {
    const economics = getTaskEconomicsReport(store, taskId);
    if (attempts.length === 0) {
      workerTokens = unavailableTokens("no-attempts");
      runtimeEstimate = unavailableRuntime("no-attempts");
      officialCost = unavailableOfficial("no-attempts");
    } else {
      const volume = economics.tokenReport.report.workerVolume;
      if (volume.kind === "complete") {
        workerTokens = {
          status: "complete",
          grossTokens: volume.grossWorkerTokens,
          completeCount: volume.sampleCount,
          incompleteCount: 0,
          denominator: attempts.length,
        };
      } else {
        workerTokens = {
          status: "incomplete",
          reason: "worker-usage-incomplete",
          ...(volume.completeSampleCount > 0 ? { grossTokens: volume.grossWorkerTokens } : {}),
          completeCount: volume.completeSampleCount,
          incompleteCount: volume.missingSampleCount,
          denominator: attempts.length,
        };
      }
      const runtime = economics.runtimeEstimate;
      runtimeEstimate = {
        status: runtime.complete ? "complete" : "incomplete",
        ...(runtime.complete ? {} : { reason: "runtime-estimate-incomplete" }),
        ...(runtime.sampleCount > 0 ? { observedTotalUsd: runtime.observedTotalUsd } : {}),
        sampleCount: runtime.sampleCount,
        missingCount: runtime.missingCount,
        denominator: attempts.length,
      };
      const totals: OfficialNativeCurrencyTotal[] = economics.officialCost.totals.map((total) => ({
        currency: total.currency,
        total: total.total,
        quotedCount: total.quotedCount,
        sources: total.sources,
        providerBillClaim: total.providerBillClaim,
      }));
      const ranges: OfficialNativeCurrencyRange[] = economics.officialCost.ranges.map((range) => ({
        currency: range.currency,
        min: range.min,
        max: range.max,
        rangedAttemptCount: range.rangedAttemptCount,
        sources: range.sources,
      }));
      const unavailableCount = economics.officialCost.unavailable.unavailableCount;
      let status: OfficialCostEvidence["status"] = "unavailable";
      let reason: string | undefined = "official-cost-unavailable";
      if (totals.length > 0 && unavailableCount === 0 && ranges.length === 0) {
        status = "quoted";
        reason = undefined;
      } else if (totals.length === 0 && ranges.length > 0) {
        status = "ranged";
        reason = "official-cost-range-only";
      } else if (totals.length > 0 || ranges.length > 0) {
        status = "mixed";
        reason = "official-cost-incomplete";
      }
      officialCost = {
        status,
        ...(reason === undefined ? {} : { reason }),
        totals,
        ranges,
        unavailableCount,
        unavailableBreakdown: economics.officialCost.unavailable.breakdown,
      };
    }
  } catch {
    if (attempts.length === 0) {
      workerTokens = unavailableTokens("no-attempts");
      runtimeEstimate = unavailableRuntime("no-attempts");
      officialCost = unavailableOfficial("no-attempts");
    }
  }

  return {
    workerTokens,
    runtimeEstimate,
    officialCost,
    attemptElapsed: projectAttemptElapsed(attempts),
    corrections: projectCorrections(store, taskId, attempts, events),
  };
}

function buildComparisonEntry(
  store: StateStore,
  identity: ComparisonIdentity,
): ValueComparisonEntry {
  const assessment = store.getMainPairAssessmentByComparison(identity.comparisonId);
  const pair = identity.forklightTaskId === undefined
    ? undefined
    : safePairReport(store, identity.forklightTaskId, identity.comparisonId);
  const status = listingStatus(assessment, pair);
  const acceptedCurrent = status === "accepted" && pair?.validity === "accepted";
  const signedChange = pair?.signedChange;
  const contributesProvenLower = acceptedCurrent
    && typeof signedChange === "number"
    && signedChange > 0;
  const qualityGates = acceptedCurrent
    && assessment?.sameScope === true
    && assessment.sameAcceptance === true
    && assessment.delegatedQualityNotLower === true
    ? {
      sameScope: true as const,
      sameAcceptance: true as const,
      delegatedQualityNotLower: true as const,
    }
    : undefined;
  const taskFamily = identity.taskFamily ?? pair?.taskFamily;
  const taskClass = pair?.taskClass ?? assessment?.taskClass;
  const directCodexProfileId = pair?.directCodexProfileId ?? assessment?.directCodexProfileId;
  const directGrossTokens = pair?.directGrossTokens;
  const delegatedGrossTokens = pair?.delegatedGrossTokens;
  const evidence = pair?.evidence;
  const entry: ValueComparisonEntry = {
    comparisonId: identity.comparisonId,
    ...(identity.forklightTaskId === undefined ? {} : { forklightTaskId: identity.forklightTaskId }),
    ...(taskFamily === undefined ? {} : { taskFamily }),
    ...(taskClass === undefined ? {} : { taskClass }),
    ...(directCodexProfileId === undefined ? {} : { directCodexProfileId }),
    method: MAIN_VALUE_REPORT_METHOD,
    pairValidity: pair?.validity ?? "absent",
    pairReasons: pair?.reasons ?? (status === "absent" ? [] : ["incomplete-evidence"]),
    listingStatus: status,
    contributesProvenLower,
    ...(directGrossTokens === undefined ? {} : { directGrossTokens }),
    ...(delegatedGrossTokens === undefined ? {} : { delegatedGrossTokens }),
    ...(signedChange === undefined ? {} : { signedChange }),
    percentageChange: pair?.percentageChange ?? emptyPercentage(),
    saving: pair?.saving ?? { status: "unavailable" },
    ...(qualityGates === undefined ? {} : { qualityGates }),
    ...(evidence === undefined ? {} : { evidence }),
    deliveryValue: projectDeliveryValue(store, identity.forklightTaskId),
  };
  return entry;
}

function familyReasons(
  comparisons: readonly ValueComparisonEntry[],
  provenLower: boolean,
  uncovered: boolean,
  legacyOnly: boolean,
  identitiesUnavailable: boolean,
): MainValueReportReason[] {
  if (identitiesUnavailable) return ["comparison-identities-unavailable"];
  if (uncovered) return ["uncovered-family"];
  if (legacyOnly) return ["legacy-pair-contract-missing"];
  if (provenLower) return [];
  const reasons: MainValueReportReason[] = [];
  if (comparisons.some((entry) => entry.listingStatus === "stale")) reasons.push("stale-pair");
  if (comparisons.some((entry) => entry.listingStatus === "rejected")) reasons.push("rejected-pair");
  if (comparisons.some((entry) => entry.listingStatus === "incomplete" || entry.listingStatus === "absent")) {
    reasons.push("incomplete-evidence");
  }
  if (comparisons.some((entry) => entry.listingStatus === "legacy")) {
    reasons.push("legacy-pair-contract-missing");
  }
  if (comparisons.some((entry) =>
    entry.listingStatus === "accepted" && typeof entry.signedChange === "number" && entry.signedChange <= 0
  )) {
    reasons.push("not-strictly-positive");
  }
  if (reasons.length === 0) reasons.push("cannot-determine");
  return uniqueSortedReasons(reasons);
}

function emptyReport(
  families: readonly string[],
  comparisons: readonly string[],
  reasons: readonly MainValueReportReason[],
): MainTokenValueReport {
  const report: MainTokenValueReport = {
    schemaVersion: MAIN_VALUE_REPORT_SCHEMA_VERSION,
    method: MAIN_VALUE_REPORT_METHOD,
    requestedFamilies: families,
    requestedComparisons: comparisons,
    overall: "cannot-determine",
    reasons: uniqueSortedReasons(reasons),
    confidence: "cannot-determine",
    families: families.map((taskFamily) => ({
      taskFamily,
      claim: "cannot-determine",
      reasons: uniqueSortedReasons(
        reasons.includes("invalid-request") ? ["invalid-request"] : ["cannot-determine"],
      ),
      comparisons: [],
      acceptedPairCount: 0,
      rejectedPairCount: 0,
      provenLowerPairCount: 0,
      mainDirectElapsed: unavailableMainDirect("not-evaluated"),
    })),
    createdWork: false,
  };
  deepFreeze(report);
  return report;
}

function storeIsEmpty(store: StateStore): boolean {
  return store.listTasks().length === 0
    && store.countMainUsageSamples() === 0
    && store.countMainPairAssessments() === 0;
}

function familyHasLegacyOnly(
  store: StateStore,
  taskFamily: string,
  comparisons: readonly ValueComparisonEntry[],
): boolean {
  if (comparisons.length > 0) return false;
  const tasks = store.listTasks().filter((task) => task.spec.taskFamily === taskFamily);
  if (tasks.length === 0) return false;
  return tasks.some((task) => store.hasLegacyMainPairEvidence(task.id));
}

/** One immutable family value report. Never mutates Store or Milestone truth. */
export function readMainTokenValueReport(store: StateStore, params: unknown): MainTokenValueReport {
  const request = parseRequest(params);
  if (!request.ok) return emptyReport(request.families, request.comparisons, ["invalid-request"]);

  const overallReasons: MainValueReportReason[] = [];
  if (storeIsEmpty(store)) overallReasons.push("empty-store");

  let discoveryComplete = true;
  let discoveredIds: string[];
  if (request.filterActive) {
    discoveredIds = [...request.comparisons];
  } else {
    const stored = discoverStoredComparisonIds(store);
    if (stored === undefined) {
      const knownCount = store.countMainUsageSamples() + store.countMainPairAssessments();
      if (knownCount > 0) {
        discoveryComplete = false;
        overallReasons.push("comparison-identities-unavailable");
      }
      discoveredIds = [];
    } else {
      discoveredIds = stored;
    }
  }

  const identities = discoveredIds.map((comparisonId) => resolveIdentity(store, comparisonId));
  const byFamily = new Map<string, ComparisonIdentity[]>();
  for (const family of request.families) byFamily.set(family, []);

  for (const identity of identities) {
    if (identity.forklightTaskId === undefined && identity.taskFamily === undefined) {
      if (request.filterActive) overallReasons.push("comparison-not-found");
      continue;
    }
    const family = identity.taskFamily;
    if (family === undefined || !byFamily.has(family)) {
      if (request.filterActive) overallReasons.push("comparison-family-mismatch");
      continue;
    }
    byFamily.get(family)!.push(identity);
  }

  let mainDirectDecisions: MainDirectDecisionRecord[] = [];
  try {
    mainDirectDecisions = store.listMainDirectDecisions();
  } catch {
    mainDirectDecisions = [];
  }

  const families: FamilyValueSection[] = request.families.map((taskFamily) => {
    const scoped = (byFamily.get(taskFamily) ?? [])
      .slice()
      .sort((left, right) => left.comparisonId.localeCompare(right.comparisonId));
    const comparisons = scoped.map((identity) => buildComparisonEntry(store, identity));
    const provenLowerPairCount = comparisons.filter((entry) => entry.contributesProvenLower).length;
    const acceptedPairCount = comparisons.filter((entry) => entry.listingStatus === "accepted").length;
    const rejectedPairCount = comparisons.filter((entry) => entry.listingStatus === "rejected").length;
    const identitiesUnavailable = !discoveryComplete && !request.filterActive;
    const legacyOnly = familyHasLegacyOnly(store, taskFamily, comparisons);
    const uncovered = !identitiesUnavailable && comparisons.length === 0 && !legacyOnly;
    const provenLower = provenLowerPairCount > 0 && !identitiesUnavailable;
    const reasons = familyReasons(comparisons, provenLower, uncovered && comparisons.length === 0, legacyOnly, identitiesUnavailable);
    const claim: FamilyValueClaim = provenLower ? "proven-lower" : "cannot-determine";
    return {
      taskFamily,
      claim,
      reasons,
      comparisons,
      acceptedPairCount,
      rejectedPairCount,
      provenLowerPairCount,
      mainDirectElapsed: projectMainDirectElapsed(mainDirectDecisions, taskFamily),
    };
  });

  for (const family of families) overallReasons.push(...family.reasons);
  const overall: OverallValueClaim = families.length > 0 && families.every((family) => family.claim === "proven-lower")
    ? "proven"
    : "cannot-determine";
  if (overall !== "proven" && overallReasons.length === 0) overallReasons.push("cannot-determine");

  const report: MainTokenValueReport = {
    schemaVersion: MAIN_VALUE_REPORT_SCHEMA_VERSION,
    method: MAIN_VALUE_REPORT_METHOD,
    requestedFamilies: request.families,
    requestedComparisons: request.comparisons,
    overall,
    reasons: uniqueSortedReasons(overallReasons),
    confidence: overall,
    families,
    createdWork: false,
  };
  for (const key of Object.keys(report)) {
    if (REPORT_FORBIDDEN_KEYS.has(key)) throw new TypeError("Invalid Main Token value report");
  }
  deepFreeze(report);
  return report;
}

function formatPercentage(change: MainPairPercentage): string {
  return change.available ? String(change.value) : `unavailable (${change.reason})`;
}

function formatTokenEvidence(evidence: CountedTokenEvidence): string {
  if (evidence.status === "unavailable") return `unavailable (${evidence.reason ?? "unavailable"})`;
  const tokens = evidence.grossTokens === undefined ? "present-incomplete" : String(evidence.grossTokens);
  return `${evidence.status} ${tokens} (${evidence.completeCount}/${evidence.denominator})`;
}

function formatRuntime(evidence: RuntimeEstimateEvidence): string {
  if (evidence.status === "unavailable") return `unavailable (${evidence.reason ?? "unavailable"})`;
  const amount = evidence.observedTotalUsd === undefined ? "present-incomplete" : String(evidence.observedTotalUsd);
  return `${evidence.status} ${amount} (${evidence.sampleCount}/${evidence.denominator})`;
}

function formatOfficial(evidence: OfficialCostEvidence): string {
  if (evidence.status === "unavailable") return `unavailable (${evidence.reason ?? "unavailable"})`;
  const totals = evidence.totals.map((total) => `${total.currency}:${total.total}`).join(",") || "(none)";
  const ranges = evidence.ranges.map((range) => `${range.currency}:${range.min}-${range.max}`).join(",") || "(none)";
  return `${evidence.status} totals=${totals} ranges=${ranges} unavailable=${evidence.unavailableCount}`;
}

function formatElapsed(evidence: ElapsedEvidence): string {
  if (evidence.status === "unavailable") return `unavailable (${evidence.reason ?? "unavailable"})`;
  return `${evidence.status} ${evidence.totalMs ?? "(none)"}ms (${evidence.measuredCount}/${evidence.denominator})`;
}

function formatMainDirect(evidence: MainDirectElapsedEvidence): string {
  if (evidence.status === "unavailable") return `unavailable (${evidence.reason ?? "unavailable"})`;
  return `${evidence.status} ${evidence.totalMs ?? "(none)"}ms closed=${evidence.closedCount}/${evidence.denominator} binding=${evidence.binding}`;
}

export function formatMainTokenValueReportHuman(report: MainTokenValueReport): string {
  const lines = [
    `overall: ${report.overall}`,
    `reasons: ${report.reasons.join(", ") || "(none)"}`,
    `confidence: ${report.confidence}`,
    `method: ${report.method}`,
    `createdWork: ${report.createdWork}`,
    `schemaVersion: ${report.schemaVersion}`,
  ];
  for (const family of report.families) {
    lines.push(`family: ${family.taskFamily}`);
    lines.push(`  claim: ${family.claim}`);
    lines.push(`  reasons: ${family.reasons.join(", ") || "(none)"}`);
    lines.push(`  acceptedPairCount: ${family.acceptedPairCount}`);
    lines.push(`  rejectedPairCount: ${family.rejectedPairCount}`);
    lines.push(`  provenLowerPairCount: ${family.provenLowerPairCount}`);
    lines.push(`  mainDirectElapsed: ${formatMainDirect(family.mainDirectElapsed)}`);
    if (family.comparisons.length === 0) {
      lines.push("  comparisons: (none)");
      continue;
    }
    for (const comparison of family.comparisons) {
      lines.push(`  comparison: ${comparison.comparisonId}`);
      lines.push(`    pairValidity: ${comparison.pairValidity}`);
      lines.push(`    listingStatus: ${comparison.listingStatus}`);
      lines.push(`    pairReasons: ${comparison.pairReasons.join(", ") || "(none)"}`);
      lines.push(`    directGrossTokens: ${comparison.directGrossTokens ?? "(none)"}`);
      lines.push(`    delegatedGrossTokens: ${comparison.delegatedGrossTokens ?? "(none)"}`);
      lines.push(`    signedChange: ${comparison.signedChange ?? "(none)"}`);
      lines.push(`    percentageChange: ${formatPercentage(comparison.percentageChange)}`);
      lines.push(`    contributesProvenLower: ${comparison.contributesProvenLower}`);
      lines.push(`    workerTokens: ${formatTokenEvidence(comparison.deliveryValue.workerTokens)}`);
      lines.push(`    runtimeEstimate: ${formatRuntime(comparison.deliveryValue.runtimeEstimate)}`);
      lines.push(`    officialCost: ${formatOfficial(comparison.deliveryValue.officialCost)}`);
      lines.push(`    attemptElapsed: ${formatElapsed(comparison.deliveryValue.attemptElapsed)}`);
      lines.push(
        `    corrections: repair=${comparison.deliveryValue.corrections.workerValidationRepairCount} `
        + `main=${comparison.deliveryValue.corrections.mainCorrectionCount} `
        + `reverify=${comparison.deliveryValue.corrections.mainReverificationCount} `
        + `handoff=${comparison.deliveryValue.corrections.handoffCount}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
