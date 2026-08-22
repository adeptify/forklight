// Explicit Main Token pair assessment and read-only signed change report.
// Composes M4-A role samples with current verification, exact Main accept
// and successful Integration. No delivery mutation, quality inference,
// family aggregation, or Worker/economics substitute.

import { randomUUID } from "node:crypto";
import {
  latestMainReview,
  latestVerificationEvent,
} from "./candidate-revision.js";
import {
  MAIN_USAGE_SOURCE,
  normalizeMainUsageComparisonId,
  type MainUsageSample,
} from "./main-token-usage.js";
import type {
  EventRecord,
  IntegrationReceiptRecord,
  IntegrationResultRecord,
} from "./types.js";
import { deepFreeze } from "./immutability.js";

export const MAIN_PAIR_SCHEMA_VERSION = 1 as const;
export const MAIN_PAIR_METHOD = MAIN_USAGE_SOURCE;
export const MAIN_PAIR_REVIEWER = "main-codex" as const;

export const MAIN_PAIR_REJECTION_REASONS = [
  "scope-mismatch",
  "acceptance-mismatch",
  "delegated-quality-lower",
  "incomplete-evidence",
  "incompatible-main-profile",
  "duplicate-evidence",
] as const;
export type MainPairRejectionReason = (typeof MAIN_PAIR_REJECTION_REASONS)[number];

const MAIN_PAIR_REPORT_REASONS = [
  ...MAIN_PAIR_REJECTION_REASONS,
  "cannot-determine",
  "legacy-pair-contract-missing",
] as const;
export type MainPairReason = (typeof MAIN_PAIR_REPORT_REASONS)[number];

export type MainPairDecision = "accepted" | "rejected";
export type MainPairOutcome = MainPairDecision | "cannot-determine";

export interface DirectVerificationRef {
  readonly referenceId: string;
}

export interface MainPairAssessment {
  readonly assessmentId: string;
  readonly forklightTaskId: string;
  readonly comparisonId: string;
  readonly taskClass?: string;
  readonly taskFamily?: string;
  readonly directCodexProfileId?: string;
  readonly decision: MainPairDecision;
  readonly rejectionReason?: MainPairRejectionReason;
  readonly sameScope?: true;
  readonly sameAcceptance?: true;
  readonly delegatedQualityNotLower?: true;
  readonly directVerificationRef?: DirectVerificationRef;
  readonly delegatedIntegrationOperationId?: string;
  readonly directSampleId?: string;
  readonly delegatedSampleId?: string;
  readonly reviewer: typeof MAIN_PAIR_REVIEWER;
  readonly assessedAt: string;
  readonly schemaVersion: typeof MAIN_PAIR_SCHEMA_VERSION;
}

export interface MainPairAssessResult {
  readonly outcome: MainPairOutcome;
  readonly reasons: readonly MainPairReason[];
  readonly assessment?: MainPairAssessment;
  readonly schemaVersion: typeof MAIN_PAIR_SCHEMA_VERSION;
}

export type MainPairPercentage =
  | { readonly available: true; readonly value: number }
  | { readonly available: false; readonly reason: "zero-direct-baseline" | "totals-unavailable" };

export type MainPairSaving =
  | { readonly status: "saving"; readonly tokens: number }
  | { readonly status: "not-lower" }
  | { readonly status: "higher" }
  | { readonly status: "unavailable" };

export interface MainPairReport {
  readonly forklightTaskId: string;
  readonly comparisonId: string;
  readonly validity: MainPairOutcome;
  readonly reasons: readonly MainPairReason[];
  readonly method: typeof MAIN_PAIR_METHOD;
  readonly taskClass?: string;
  readonly taskFamily?: string;
  readonly directCodexProfileId?: string;
  readonly directGrossTokens?: number;
  readonly delegatedGrossTokens?: number;
  readonly signedChange?: number;
  readonly percentageChange: MainPairPercentage;
  readonly saving: MainPairSaving;
  readonly evidence?: {
    readonly directVerificationRef: DirectVerificationRef;
    readonly delegatedIntegrationOperationId: string;
  };
  readonly schemaVersion: typeof MAIN_PAIR_SCHEMA_VERSION;
}

export interface MainPairStore {
  getTask(taskId: string): {
    spec: {
      taskClass?: string;
      taskFamily?: string;
      directCodexProfileId?: string;
    };
  };
  listMainUsageSamples(taskId: unknown, comparisonId: unknown): MainUsageSample[];
  listEvents(taskId: string): EventRecord[];
  listIntegrationResults(taskId: string): IntegrationResultRecord[];
  getIntegrationResult(resultId: string): IntegrationResultRecord | undefined;
  getIntegrationReceipt(
    receiptId: string,
  ): (IntegrationReceiptRecord & { consumed: boolean }) | undefined;
  saveMainPairAssessment(assessment: MainPairAssessment): void;
  getMainPairAssessmentByComparison(comparisonId: unknown): MainPairAssessment | undefined;
  hasLegacyMainPairEvidence(taskId: string): boolean;
}

export type AssessmentIdFactory = () => string;

export const INVALID_MAIN_PAIR_ASSESSMENT = "Invalid Main pair assessment";
export const INVALID_MAIN_PAIR_REPORT = "Invalid Main pair report query";
const TASK_NOT_FOUND_ASSESS = "ForkLight Task not found for Main pair assessment";
const TASK_NOT_FOUND_REPORT = "ForkLight Task not found for Main pair report";
export const ASSESS_REQUIRES_CONFIRM = "Main pair assessment requires confirm: true";
const DUPLICATE_MAIN_PAIR = "Duplicate Main pair assessment rejected";
export const UNKNOWN_MAIN_PAIR_ASSESSMENT = "Unknown Main pair assessment";
export const CORRUPT_MAIN_PAIR_ASSESSMENT = "Corrupt Main pair assessment record in state database";
export const ASSESSMENT_UNKNOWN_TASK = "Assessment references unknown Task";

const ASSESS_KEYS: ReadonlySet<string> = new Set([
  "taskId",
  "comparisonId",
  "confirm",
  "sameScope",
  "sameAcceptance",
  "delegatedQualityNotLower",
  "directVerificationRef",
  "delegatedIntegrationOperationId",
  "reviewer",
  "assessedAt",
  "schemaVersion",
]);
const ACCEPTED_ASSESSMENT_KEYS: ReadonlySet<string> = new Set([
  "assessmentId",
  "forklightTaskId",
  "comparisonId",
  "taskClass",
  "taskFamily",
  "directCodexProfileId",
  "decision",
  "sameScope",
  "sameAcceptance",
  "delegatedQualityNotLower",
  "directVerificationRef",
  "delegatedIntegrationOperationId",
  "directSampleId",
  "delegatedSampleId",
  "reviewer",
  "assessedAt",
  "schemaVersion",
]);
const REJECTED_ASSESSMENT_KEYS: ReadonlySet<string> = new Set([
  "assessmentId",
  "forklightTaskId",
  "comparisonId",
  "taskClass",
  "taskFamily",
  "directCodexProfileId",
  "decision",
  "rejectionReason",
  "reviewer",
  "assessedAt",
  "schemaVersion",
]);
const REPORT_FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  "change",
  "savings",
  "directCodexSavings",
  "quality",
  "familyValue",
  "calibration",
  "workerTokens",
  "cost",
  "budget",
]);
const RAW_FIELDS: ReadonlySet<string> = new Set([
  "text",
  "content",
  "prompt",
  "body",
  "payload",
  "raw",
  "secret",
  "credential",
  "log",
  "response",
  "request",
  "sourceText",
  "sourceHash",
  "diff",
  "path",
  "notes",
  "note",
  "reason",
  "detail",
]);
const REF_KEYS: ReadonlySet<string> = new Set(["referenceId"]);
const REJECTION_REASON_SET: ReadonlySet<string> = new Set(MAIN_PAIR_REJECTION_REASONS);
const STRICT_TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const TASK_LABEL = /^[^\s].{0,79}$/;

const defaultAssessmentId: AssessmentIdFactory = () => `mpa-${randomUUID()}`;

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

const isValidTimestamp = (s: unknown): s is string => {
  if (typeof s !== "string" || s.trim().length === 0) return false;
  const ts = Date.parse(s);
  if (!Number.isFinite(ts)) return false;
  return new Date(s).toISOString() === s;
};

function isBoundedTaskLabel(value: unknown): value is string {
  return typeof value === "string" && value === value.trim() && TASK_LABEL.test(value);
}

function isRejectionReason(value: unknown): value is MainPairRejectionReason {
  return typeof value === "string" && REJECTION_REASON_SET.has(value);
}

function rejectRawOrUnknown(o: Record<string, unknown>, allowed: ReadonlySet<string>, message: string): void {
  for (const key of Object.keys(o)) {
    if (!allowed.has(key) || RAW_FIELDS.has(key)) throw new TypeError(message);
  }
}

export function normalizeDirectVerificationRef(input: unknown): DirectVerificationRef {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
  }
  const o = input as Record<string, unknown>;
  rejectRawOrUnknown(o, REF_KEYS, INVALID_MAIN_PAIR_ASSESSMENT);
  if (!hasOwn(o, "referenceId") || typeof o.referenceId !== "string" || !STRICT_TOKEN.test(o.referenceId)) {
    throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
  }
  const ref: DirectVerificationRef = { referenceId: o.referenceId };
  deepFreeze(ref);
  return ref;
}

function isCompleteDirectVerificationRef(input: unknown): input is DirectVerificationRef {
  try {
    normalizeDirectVerificationRef(input);
    return true;
  } catch {
    return false;
  }
}

function optionalTaskLabel(value: unknown): string | undefined {
  return isBoundedTaskLabel(value) ? value : undefined;
}

function comparisonIdOr(id: unknown, message: string): string {
  try {
    return normalizeMainUsageComparisonId(id);
  } catch {
    throw new TypeError(message);
  }
}

function loadTaskOr(store: MainPairStore, taskId: string, notFound: string) {
  try {
    return store.getTask(taskId);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unknown ForkLight task:")) {
      throw new TypeError(notFound);
    }
    throw error;
  }
}

function mapUniqueFailure(error: unknown): never {
  const sqlite = error as { code?: unknown; errcode?: unknown };
  if (error instanceof Error && sqlite.code === "ERR_SQLITE_ERROR"
    && (sqlite.errcode === 1555 || sqlite.errcode === 2067)) {
    throw new TypeError(DUPLICATE_MAIN_PAIR);
  }
  throw error;
}

function persistAssessment(
  store: MainPairStore,
  assessment: MainPairAssessment,
): MainPairAssessment {
  try {
    store.saveMainPairAssessment(assessment);
  } catch (error) {
    mapUniqueFailure(error);
  }
  return assessment;
}

function assessResult(
  outcome: MainPairOutcome,
  reasons: readonly MainPairReason[],
  assessment?: MainPairAssessment,
): MainPairAssessResult {
  const result: MainPairAssessResult = {
    outcome,
    reasons,
    ...(assessment === undefined ? {} : { assessment }),
    schemaVersion: MAIN_PAIR_SCHEMA_VERSION,
  };
  deepFreeze(result);
  return result;
}

function rejectedAssessment(input: {
  assessmentId: string;
  forklightTaskId: string;
  comparisonId: string;
  rejectionReason: MainPairRejectionReason;
  assessedAt: string;
  taskClass?: string;
  taskFamily?: string;
  directCodexProfileId?: string;
}): MainPairAssessment {
  return normalizeMainPairAssessment({
    assessmentId: input.assessmentId,
    forklightTaskId: input.forklightTaskId,
    comparisonId: input.comparisonId,
    ...(input.taskClass === undefined ? {} : { taskClass: input.taskClass }),
    ...(input.taskFamily === undefined ? {} : { taskFamily: input.taskFamily }),
    ...(input.directCodexProfileId === undefined ? {} : { directCodexProfileId: input.directCodexProfileId }),
    decision: "rejected",
    rejectionReason: input.rejectionReason,
    reviewer: MAIN_PAIR_REVIEWER,
    assessedAt: input.assessedAt,
    schemaVersion: MAIN_PAIR_SCHEMA_VERSION,
  });
}

function persistRejected(
  store: MainPairStore,
  input: Parameters<typeof rejectedAssessment>[0],
): MainPairAssessResult {
  const assessment = persistAssessment(store, rejectedAssessment(input));
  return assessResult("rejected", [input.rejectionReason], assessment);
}

export function normalizeMainPairAssessment(input: unknown): MainPairAssessment {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
  }
  const o = input as Record<string, unknown>;
  if (o.decision !== "accepted" && o.decision !== "rejected") {
    throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
  }
  const allowed = o.decision === "accepted" ? ACCEPTED_ASSESSMENT_KEYS : REJECTED_ASSESSMENT_KEYS;
  rejectRawOrUnknown(o, allowed, INVALID_MAIN_PAIR_ASSESSMENT);
  if (typeof o.assessmentId !== "string" || !STRICT_TOKEN.test(o.assessmentId)) {
    throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
  }
  if (typeof o.forklightTaskId !== "string" || !STRICT_TOKEN.test(o.forklightTaskId)) {
    throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
  }
  const comparisonId = comparisonIdOr(o.comparisonId, INVALID_MAIN_PAIR_ASSESSMENT);
  if (o.reviewer !== MAIN_PAIR_REVIEWER) throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
  if (!isValidTimestamp(o.assessedAt)) throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
  if (o.schemaVersion !== MAIN_PAIR_SCHEMA_VERSION) throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);

  const taskClass = optionalTaskLabel(o.taskClass);
  const taskFamily = optionalTaskLabel(o.taskFamily);
  const directCodexProfileId = optionalTaskLabel(o.directCodexProfileId);
  if (hasOwn(o, "taskClass") && taskClass === undefined) throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
  if (hasOwn(o, "taskFamily") && taskFamily === undefined) throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
  if (hasOwn(o, "directCodexProfileId") && directCodexProfileId === undefined) {
    throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
  }

  if (o.decision === "accepted") {
    for (const key of ACCEPTED_ASSESSMENT_KEYS) {
      if (!hasOwn(o, key)) throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
    }
    if (o.sameScope !== true || o.sameAcceptance !== true || o.delegatedQualityNotLower !== true) {
      throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
    }
    if (hasOwn(o, "rejectionReason")) throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
    const directVerificationRef = normalizeDirectVerificationRef(o.directVerificationRef);
    if (
      typeof o.delegatedIntegrationOperationId !== "string"
      || !STRICT_TOKEN.test(o.delegatedIntegrationOperationId)
    ) {
      throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
    }
    if (typeof o.directSampleId !== "string" || !STRICT_TOKEN.test(o.directSampleId)) {
      throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
    }
    if (typeof o.delegatedSampleId !== "string" || !STRICT_TOKEN.test(o.delegatedSampleId)) {
      throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
    }
    const assessment: MainPairAssessment = {
      assessmentId: o.assessmentId,
      forklightTaskId: o.forklightTaskId,
      comparisonId,
      taskClass: taskClass as string,
      taskFamily: taskFamily as string,
      directCodexProfileId: directCodexProfileId as string,
      decision: "accepted",
      sameScope: true,
      sameAcceptance: true,
      delegatedQualityNotLower: true,
      directVerificationRef,
      delegatedIntegrationOperationId: o.delegatedIntegrationOperationId,
      directSampleId: o.directSampleId,
      delegatedSampleId: o.delegatedSampleId,
      reviewer: MAIN_PAIR_REVIEWER,
      assessedAt: o.assessedAt,
      schemaVersion: MAIN_PAIR_SCHEMA_VERSION,
    };
    deepFreeze(assessment);
    return assessment;
  }

  for (const key of ["assessmentId", "forklightTaskId", "comparisonId", "decision", "rejectionReason", "reviewer", "assessedAt", "schemaVersion"]) {
    if (!hasOwn(o, key)) throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
  }
  if (!isRejectionReason(o.rejectionReason)) throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
  const assessment: MainPairAssessment = {
    assessmentId: o.assessmentId,
    forklightTaskId: o.forklightTaskId,
    comparisonId,
    ...(taskClass === undefined ? {} : { taskClass }),
    ...(taskFamily === undefined ? {} : { taskFamily }),
    ...(directCodexProfileId === undefined ? {} : { directCodexProfileId }),
    decision: "rejected",
    rejectionReason: o.rejectionReason,
    reviewer: MAIN_PAIR_REVIEWER,
    assessedAt: o.assessedAt,
    schemaVersion: MAIN_PAIR_SCHEMA_VERSION,
  };
  deepFreeze(assessment);
  return assessment;
}

function verificationPassed(payload: unknown): boolean {
  return payload !== null
    && typeof payload === "object"
    && (payload as { passed?: unknown }).passed === true;
}

export function resolveCurrentDelegatedDelivery(
  store: MainPairStore,
  taskId: string,
  referencedOperationId: string,
): { ok: true } | { ok: false } {
  const events = store.listEvents(taskId);
  const verification = latestVerificationEvent(events);
  if (verification === undefined || !verificationPassed(verification.payload)) return { ok: false };
  const review = latestMainReview(events);
  if (
    review === undefined
    || review.decision !== "accept"
    || review.verificationEventSequence !== verification.sequence
    || typeof review.candidateRevisionId !== "string"
    || typeof review.acceptedPatchDigest !== "string"
  ) {
    return { ok: false };
  }
  const referenced = store.getIntegrationResult(referencedOperationId);
  if (
    referenced === undefined
    || referenced.taskId !== taskId
    || referenced.status !== "applied"
  ) {
    return { ok: false };
  }
  const referencedReceipt = store.getIntegrationReceipt(referenced.receiptId);
  if (
    referencedReceipt === undefined
    || referencedReceipt.taskId !== taskId
    || referencedReceipt.patchDigest !== review.acceptedPatchDigest
  ) {
    return { ok: false };
  }
  const current = store.listIntegrationResults(taskId)
    .filter((result) => result.status === "applied")
    .map((result) => {
      const receipt = store.getIntegrationReceipt(result.receiptId);
      return { result, receipt };
    })
    .filter((entry) => entry.receipt?.patchDigest === review.acceptedPatchDigest)
    .sort((left, right) => left.result.createdAt.localeCompare(right.result.createdAt))
    .at(-1);
  if (current === undefined || current.result.id !== referencedOperationId) return { ok: false };
  return { ok: true };
}

type SampleIdentity =
  | { status: "complete"; direct: MainUsageSample; delegated: MainUsageSample }
  | { status: "missing" }
  | { status: "mismatch" };

function readSampleIdentity(
  store: MainPairStore,
  taskId: string,
  comparisonId: string,
  task: { spec: { taskClass?: string; taskFamily?: string; directCodexProfileId?: string } },
): SampleIdentity {
  const samples = store.listMainUsageSamples(taskId, comparisonId);
  const direct = samples.find((sample) => sample.role === "direct-main");
  const delegated = samples.find((sample) => sample.role === "delegated-main");
  if (direct === undefined || delegated === undefined) return { status: "missing" };
  const taskClass = task.spec.taskClass;
  const taskFamily = task.spec.taskFamily;
  const profile = task.spec.directCodexProfileId;
  if (!taskClass || !taskFamily || !profile) return { status: "mismatch" };
  for (const sample of [direct, delegated]) {
    if (
      sample.forklightTaskId !== taskId
      || sample.comparisonId !== comparisonId
      || sample.taskClass !== taskClass
      || sample.taskFamily !== taskFamily
      || sample.directCodexProfileId !== profile
      || sample.source !== MAIN_USAGE_SOURCE
    ) {
      return { status: "mismatch" };
    }
  }
  if (
    direct.taskClass !== delegated.taskClass
    || direct.taskFamily !== delegated.taskFamily
    || direct.directCodexProfileId !== delegated.directCodexProfileId
  ) {
    return { status: "mismatch" };
  }
  return { status: "complete", direct, delegated };
}

export function computeMainPairArithmetic(
  directGross: number,
  delegatedGross: number,
  accepted: boolean,
): {
  signedChange: number;
  percentageChange: MainPairPercentage;
  saving: MainPairSaving;
} {
  const signedChange = directGross - delegatedGross;
  const percentageChange: MainPairPercentage = directGross === 0
    ? { available: false, reason: "zero-direct-baseline" }
    : { available: true, value: signedChange / directGross * 100 };
  let saving: MainPairSaving = { status: "unavailable" };
  if (accepted) {
    if (signedChange > 0) saving = { status: "saving", tokens: signedChange };
    else if (signedChange === 0) saving = { status: "not-lower" };
    else saving = { status: "higher" };
  }
  return { signedChange, percentageChange, saving };
}

function identityFields(task: {
  spec: { taskClass?: string; taskFamily?: string; directCodexProfileId?: string };
}, samples?: { direct?: MainUsageSample; delegated?: MainUsageSample }): {
  taskClass?: string;
  taskFamily?: string;
  directCodexProfileId?: string;
} {
  const sample = samples?.direct ?? samples?.delegated;
  return {
    ...(optionalTaskLabel(sample?.taskClass ?? task.spec.taskClass) === undefined
      ? {}
      : { taskClass: sample?.taskClass ?? task.spec.taskClass }),
    ...(optionalTaskLabel(sample?.taskFamily ?? task.spec.taskFamily) === undefined
      ? {}
      : { taskFamily: sample?.taskFamily ?? task.spec.taskFamily }),
    ...(optionalTaskLabel(sample?.directCodexProfileId ?? task.spec.directCodexProfileId) === undefined
      ? {}
      : { directCodexProfileId: sample?.directCodexProfileId ?? task.spec.directCodexProfileId }),
  };
}

function parseAssessInput(params: unknown): {
  taskId: string;
  comparisonId: string;
  sameScope: boolean;
  sameAcceptance: boolean;
  delegatedQualityNotLower: boolean;
  directVerificationRef: unknown;
  delegatedIntegrationOperationId: unknown;
  assessedAt: string;
} {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
  }
  const raw = params as Record<string, unknown>;
  rejectRawOrUnknown(raw, ASSESS_KEYS, INVALID_MAIN_PAIR_ASSESSMENT);
  for (const key of ASSESS_KEYS) {
    if (!hasOwn(raw, key)) throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
  }
  if (raw.confirm !== true) throw new TypeError(ASSESS_REQUIRES_CONFIRM);
  if (typeof raw.taskId !== "string" || !STRICT_TOKEN.test(raw.taskId)) {
    throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
  }
  const comparisonId = comparisonIdOr(raw.comparisonId, INVALID_MAIN_PAIR_ASSESSMENT);
  if (typeof raw.sameScope !== "boolean"
    || typeof raw.sameAcceptance !== "boolean"
    || typeof raw.delegatedQualityNotLower !== "boolean") {
    throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
  }
  if (raw.reviewer !== MAIN_PAIR_REVIEWER) throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
  if (!isValidTimestamp(raw.assessedAt)) throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
  if (raw.schemaVersion !== MAIN_PAIR_SCHEMA_VERSION) {
    throw new TypeError(INVALID_MAIN_PAIR_ASSESSMENT);
  }
  return {
    taskId: raw.taskId,
    comparisonId,
    sameScope: raw.sameScope,
    sameAcceptance: raw.sameAcceptance,
    delegatedQualityNotLower: raw.delegatedQualityNotLower,
    directVerificationRef: raw.directVerificationRef,
    delegatedIntegrationOperationId: raw.delegatedIntegrationOperationId,
    assessedAt: raw.assessedAt,
  };
}

/** Persist one immutable accepted or rejected pair assessment. Stale or
 *  missing current delivery truth returns cannot-determine and writes no
 *  accepted claim. */
export function assessMainPair(
  store: MainPairStore,
  params: unknown,
  generateAssessmentId?: AssessmentIdFactory,
): MainPairAssessResult {
  const input = parseAssessInput(params);
  const task = loadTaskOr(store, input.taskId, TASK_NOT_FOUND_ASSESS);
  const existing = store.getMainPairAssessmentByComparison(input.comparisonId);
  if (existing !== undefined) {
    return assessResult("rejected", ["duplicate-evidence"], existing);
  }

  const identity = readSampleIdentity(store, input.taskId, input.comparisonId, task);
  const common = identityFields(
    task,
    identity.status === "complete" ? { direct: identity.direct, delegated: identity.delegated } : undefined,
  );
  const assessmentId = (generateAssessmentId ?? defaultAssessmentId)();
  const base = {
    assessmentId,
    forklightTaskId: input.taskId,
    comparisonId: input.comparisonId,
    assessedAt: input.assessedAt,
    ...common,
  };

  if (identity.status === "missing") {
    return assessResult("cannot-determine", ["incomplete-evidence"]);
  }
  if (identity.status === "mismatch") {
    return persistRejected(store, { ...base, rejectionReason: "incompatible-main-profile" });
  }
  if (!isCompleteDirectVerificationRef(input.directVerificationRef)) {
    return persistRejected(store, { ...base, rejectionReason: "incomplete-evidence" });
  }
  if (typeof input.delegatedIntegrationOperationId !== "string"
    || !STRICT_TOKEN.test(input.delegatedIntegrationOperationId)) {
    return persistRejected(store, { ...base, rejectionReason: "incomplete-evidence" });
  }
  if (input.sameScope !== true) {
    return persistRejected(store, { ...base, rejectionReason: "scope-mismatch" });
  }
  if (input.sameAcceptance !== true) {
    return persistRejected(store, { ...base, rejectionReason: "acceptance-mismatch" });
  }
  if (input.delegatedQualityNotLower !== true) {
    return persistRejected(store, { ...base, rejectionReason: "delegated-quality-lower" });
  }

  const delivery = resolveCurrentDelegatedDelivery(
    store,
    input.taskId,
    input.delegatedIntegrationOperationId,
  );
  if (!delivery.ok) {
    return assessResult("cannot-determine", ["cannot-determine"]);
  }

  const assessment = persistAssessment(store, normalizeMainPairAssessment({
    assessmentId,
    forklightTaskId: input.taskId,
    comparisonId: input.comparisonId,
    taskClass: identity.direct.taskClass,
    taskFamily: identity.direct.taskFamily,
    directCodexProfileId: identity.direct.directCodexProfileId,
    decision: "accepted",
    sameScope: true,
    sameAcceptance: true,
    delegatedQualityNotLower: true,
    directVerificationRef: input.directVerificationRef,
    delegatedIntegrationOperationId: input.delegatedIntegrationOperationId,
    directSampleId: identity.direct.sampleId,
    delegatedSampleId: identity.delegated.sampleId,
    reviewer: MAIN_PAIR_REVIEWER,
    assessedAt: input.assessedAt,
    schemaVersion: MAIN_PAIR_SCHEMA_VERSION,
  }));
  return assessResult("accepted", [], assessment);
}

function emptyPercentage(): MainPairPercentage {
  return { available: false, reason: "totals-unavailable" };
}

function buildReport(input: {
  forklightTaskId: string;
  comparisonId: string;
  validity: MainPairOutcome;
  reasons: readonly MainPairReason[];
  taskClass?: string;
  taskFamily?: string;
  directCodexProfileId?: string;
  direct?: MainUsageSample;
  delegated?: MainUsageSample;
  acceptedForSaving: boolean;
  evidence?: MainPairReport["evidence"];
}): MainPairReport {
  const haveTotals = input.direct !== undefined && input.delegated !== undefined;
  const arithmetic = haveTotals
    ? computeMainPairArithmetic(
      input.direct!.grossTokens,
      input.delegated!.grossTokens,
      input.acceptedForSaving,
    )
    : undefined;
  const report: MainPairReport = {
    forklightTaskId: input.forklightTaskId,
    comparisonId: input.comparisonId,
    validity: input.validity,
    reasons: input.reasons,
    method: MAIN_PAIR_METHOD,
    ...(input.taskClass === undefined ? {} : { taskClass: input.taskClass }),
    ...(input.taskFamily === undefined ? {} : { taskFamily: input.taskFamily }),
    ...(input.directCodexProfileId === undefined ? {} : { directCodexProfileId: input.directCodexProfileId }),
    ...(input.direct === undefined ? {} : { directGrossTokens: input.direct.grossTokens }),
    ...(input.delegated === undefined ? {} : { delegatedGrossTokens: input.delegated.grossTokens }),
    ...(arithmetic === undefined ? {} : { signedChange: arithmetic.signedChange }),
    percentageChange: arithmetic?.percentageChange ?? emptyPercentage(),
    saving: arithmetic?.saving ?? { status: "unavailable" },
    ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
    schemaVersion: MAIN_PAIR_SCHEMA_VERSION,
  };
  for (const key of Object.keys(report)) {
    if (REPORT_FORBIDDEN_KEYS.has(key)) throw new TypeError(INVALID_MAIN_PAIR_REPORT);
  }
  deepFreeze(report);
  return report;
}

/** Read-only pair report. Re-reads stored samples, the stored assessment and
 *  current delegated delivery truth. Never mutates and never invents a saving. */
export function readMainPairReport(
  store: MainPairStore,
  taskId: unknown,
  comparisonId: unknown,
): MainPairReport {
  if (typeof taskId !== "string" || !STRICT_TOKEN.test(taskId)) {
    throw new TypeError(INVALID_MAIN_PAIR_REPORT);
  }
  const exactComparison = comparisonIdOr(comparisonId, INVALID_MAIN_PAIR_REPORT);
  const task = loadTaskOr(store, taskId, TASK_NOT_FOUND_REPORT);
  const identity = readSampleIdentity(store, taskId, exactComparison, task);
  const complete = identity.status === "complete" ? identity : undefined;
  const fields = identityFields(
    task,
    complete === undefined ? undefined : { direct: complete.direct, delegated: complete.delegated },
  );
  const assessment = store.getMainPairAssessmentByComparison(exactComparison);

  if (assessment === undefined) {
    if (complete === undefined && store.hasLegacyMainPairEvidence(taskId)) {
      return buildReport({
        forklightTaskId: taskId,
        comparisonId: exactComparison,
        validity: "cannot-determine",
        reasons: ["legacy-pair-contract-missing"],
        ...fields,
        acceptedForSaving: false,
      });
    }
    return buildReport({
      forklightTaskId: taskId,
      comparisonId: exactComparison,
      validity: "cannot-determine",
      reasons: ["incomplete-evidence"],
      ...fields,
      ...(complete === undefined ? {} : { direct: complete.direct, delegated: complete.delegated }),
      acceptedForSaving: false,
    });
  }

  if (assessment.forklightTaskId !== taskId) {
    return buildReport({
      forklightTaskId: taskId,
      comparisonId: exactComparison,
      validity: "cannot-determine",
      reasons: ["cannot-determine"],
      ...fields,
      acceptedForSaving: false,
    });
  }

  if (assessment.decision === "rejected") {
    return buildReport({
      forklightTaskId: taskId,
      comparisonId: exactComparison,
      validity: "rejected",
      reasons: [assessment.rejectionReason ?? "incomplete-evidence"],
      ...fields,
      ...(complete === undefined ? {} : { direct: complete.direct, delegated: complete.delegated }),
      acceptedForSaving: false,
    });
  }

  const evidence = assessment.directVerificationRef !== undefined
    && assessment.delegatedIntegrationOperationId !== undefined
    ? {
      directVerificationRef: assessment.directVerificationRef,
      delegatedIntegrationOperationId: assessment.delegatedIntegrationOperationId,
    }
    : undefined;
  if (
    complete === undefined
    || identity.status !== "complete"
    || assessment.directSampleId !== complete.direct.sampleId
    || assessment.delegatedSampleId !== complete.delegated.sampleId
    || assessment.delegatedIntegrationOperationId === undefined
    || !resolveCurrentDelegatedDelivery(
      store,
      taskId,
      assessment.delegatedIntegrationOperationId,
    ).ok
  ) {
    return buildReport({
      forklightTaskId: taskId,
      comparisonId: exactComparison,
      validity: "cannot-determine",
      reasons: ["cannot-determine"],
      ...fields,
      ...(complete === undefined ? {} : { direct: complete.direct, delegated: complete.delegated }),
      acceptedForSaving: false,
      ...(evidence === undefined ? {} : { evidence }),
    });
  }

  return buildReport({
    forklightTaskId: taskId,
    comparisonId: exactComparison,
    validity: "accepted",
    reasons: [],
    taskClass: complete.direct.taskClass,
    taskFamily: complete.direct.taskFamily,
    directCodexProfileId: complete.direct.directCodexProfileId,
    direct: complete.direct,
    delegated: complete.delegated,
    acceptedForSaving: true,
    evidence,
  });
}
