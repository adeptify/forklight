// Token efficiency — Worker volume, exchange estimation, boundary
// reduction, and direct-Codex savings.  Pure functions; no tokenizer,
// no raw text retention, no invented baselines, no Provider pricing.
// Missing evidence stays typed unavailable (never silently zero).
// Every estimate carries an explicit method and confidence level.

import type { AttemptTokenUsage } from "./types.js";
import { deepFreeze } from "./immutability.js";

// --- Immutability helpers ---

const frozenCopy = <T>(value: T): T => { const c = structuredClone(value); deepFreeze(c); return c as T; };

// --- Private validation ---

const isNNInt = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

const isCompleteUsage = (u: unknown): u is AttemptTokenUsage => {
  if (u === null || typeof u !== "object") return false;
  const o = u as Record<string, unknown>;
  return o.source === "terminal-result" && o.complete === true
    && isNNInt(o.inputTokens) && isNNInt(o.outputTokens)
    && isNNInt(o.cacheReadInputTokens) && isNNInt(o.cacheCreationInputTokens);
};

const NON_EMPTY_TRIM = (s: unknown): s is string =>
  typeof s === "string" && s.trim().length > 0;
const VALID_DIR = new Set(["request", "response"]);
const VALID_CONF = new Set(["low", "medium", "high"]);
const isValidDirection = (s: unknown): s is "request" | "response" =>
  typeof s === "string" && VALID_DIR.has(s);

const isValidTimestamp = (s: unknown): s is string => {
  if (typeof s !== "string" || s.trim().length === 0) return false;
  const ts = Date.parse(s);
  return Number.isFinite(ts);
};

const isValidMeasurement = (m: unknown): m is RedactedExchangeMeasurement => {
  if (m === null || typeof m !== "object") return false;
  const o = m as Record<string, unknown>;
  if (!isValidDirection(o.direction)) return false;
  if (!NON_EMPTY_TRIM(o.operation)) return false;
  if (!NON_EMPTY_TRIM(o.taskId)) return false;
  if (!isValidTimestamp(o.timestamp)) return false;
  if (!isNNInt(o.utf8Bytes) || !isNNInt(o.asciiCount) || !isNNInt(o.nonAsciiCount)) return false;
  // Each Unicode code point requires at least 1 UTF-8 byte
  if ((o.utf8Bytes as number) < (o.asciiCount as number) + (o.nonAsciiCount as number)) return false;
  return true;
};

// --- Public types ---

export type ConfidenceLevel = "low" | "medium" | "high";

export interface TokenEstimateRange {
  readonly min: number; readonly max: number;
  readonly method: string; readonly confidence: ConfidenceLevel;
}

export type ExchangeDirection = "request" | "response";

/** Non-content measurement of one orchestration exchange.  Raw prompt and
 *  response text is counted then discarded — no substring survives. */
export interface RedactedExchangeMeasurement {
  readonly direction: ExchangeDirection;
  readonly operation: string;   readonly taskId: string;
  readonly timestamp: string;   readonly utf8Bytes: number;
  readonly asciiCount: number;  readonly nonAsciiCount: number;
}

export type ExchangeTokenUnavailableReason =
  "no-measurements" | "invalid-exact-evidence" | "invalid-measurement" | "invalid-receipt-evidence";

export type ExchangeTokenEstimate =
  | { readonly kind: "exact"; readonly tokens: number; readonly source: string }
  | { readonly kind: "range"; readonly range: TokenEstimateRange }
  | { readonly kind: "unavailable"; readonly reason: ExchangeTokenUnavailableReason };

export type WorkerVolumeEvidence =
  | { readonly kind: "complete"; readonly inputTokens: number; readonly outputTokens: number;
      readonly cacheReadInputTokens: number; readonly cacheCreationInputTokens: number;
      /** Gross external Worker Token volume (not unique context). */
      readonly grossWorkerTokens: number; readonly sampleCount: number; }
  | { readonly kind: "incomplete"; readonly inputTokens: number; readonly outputTokens: number;
      readonly cacheReadInputTokens: number; readonly cacheCreationInputTokens: number;
      readonly grossWorkerTokens: number; readonly sampleCount: number;
      readonly completeSampleCount: number; readonly missingSampleCount: number; };

export type BoundaryReduction =
  | { readonly available: true; readonly tokens: TokenEstimateRange }
  | { readonly available: false;
      readonly reason: "incomplete-worker-usage" | "missing-exchange-evidence"; };

export interface DirectCodexCalibration {
  readonly minTokens: number;   readonly maxTokens: number;
  readonly method: string;      readonly taskClass: string;
  readonly confidence: ConfidenceLevel;
}

/** Versioned, privacy-safe aggregate direct-Codex calibration evidence
 *  derived from paired runs.  Contains only count and provenance metadata;
 *  no raw prompts, source content, credentials, or logs. */
export interface DirectCodexCalibrationRecord {
  readonly minTokens: number;
  readonly maxTokens: number;
  readonly method: string;
  readonly taskClass: string;
  readonly confidence: ConfidenceLevel;
  readonly version: number;
  readonly sampleSize: number;
  readonly evidenceReferences: readonly string[];
  readonly createdAt: string;
  readonly schemaVersion: 1;
}

export type DirectCodexUnavailableReason =
  | "direct-baseline-missing" | "incompatible-baseline"
  | "task-class-mismatch" | "task-class-required" | "missing-exchange-evidence";

export type PercentageSavings =
  | { readonly available: true; readonly range: TokenEstimateRange }
  | { readonly available: false; readonly reason: "zero-baseline" };

export type DirectCodexSavings =
  | { readonly available: true; readonly absoluteSavings: TokenEstimateRange;
      readonly percentageSavings: PercentageSavings;
      readonly baseline: DirectCodexCalibration; }
  | { readonly available: false; readonly reason: DirectCodexUnavailableReason };

export interface TokenEfficiencyReport {
  readonly workerVolume: WorkerVolumeEvidence;
  readonly exchangeEstimate: ExchangeTokenEstimate;
  readonly boundaryReduction: BoundaryReduction;
  readonly directCodexSavings: DirectCodexSavings;
}

/** Immutable canonical receipt recording one orchestration exchange as
 *  redacted count-only evidence.  The `responseRelationship` is always
 *  `"may-overlap"` — zero to two named response surfaces preserve the
 *  ambiguity that MCP content text and structured JSON may overlap
 *  semantically and must never be summed as exact evidence. */
export type ReceiptTransport = "mcp" | "cli";

export type ReceiptOutcome = "success" | "error";

export interface OrchestrationExchangeReceipt {
  readonly id: string;
  readonly taskId: string;
  readonly operation: string;
  readonly transport: ReceiptTransport;
  readonly capturedAt: string;
  readonly outcome: ReceiptOutcome;
  readonly requestArguments: RedactedExchangeMeasurement;
  readonly responseRelationship: "may-overlap";
  readonly responseContent?: RedactedExchangeMeasurement;
  readonly responseStructured?: RedactedExchangeMeasurement;
}

// --- Public API — redacted measurement ---

function countAscii(text: string): number {
  let n = 0; for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) <= 0x7f) n++; return n;
}

/** Create a redacted exchange measurement from raw text.  The text is used
 *  only to count UTF-8 bytes and ASCII/non-ASCII code points, then discarded.
 *  Validates all metadata — rejects empty/trimmed-empty strings and
 *  non-parseable timestamps. */
export function createRedactedExchangeMeasurement(
  text: string, direction: ExchangeDirection, operation: string,
  taskId: string, timestamp: string,
): RedactedExchangeMeasurement {
  if (typeof text !== "string") throw new TypeError("text must be a string");
  if (!isValidDirection(direction)) throw new TypeError(`invalid direction: ${direction}`);
  if (!NON_EMPTY_TRIM(operation)) throw new TypeError("operation must be non-empty after trim");
  if (!NON_EMPTY_TRIM(taskId)) throw new TypeError("taskId must be non-empty after trim");
  if (!isValidTimestamp(timestamp)) throw new TypeError("timestamp must be parseable ISO");
  const bytes = new TextEncoder().encode(text).length;
  const ascii = countAscii(text);
  const nonAscii = [...text].length - ascii;
  const r: RedactedExchangeMeasurement = { direction, operation, taskId, timestamp,
    utf8Bytes: bytes, asciiCount: ascii, nonAsciiCount: nonAscii };
  deepFreeze(r);
  return r;
}

// --- Private — receipt validation ---

const RECEIPT_KEYS = new Set([
  "id", "taskId", "operation", "transport", "capturedAt", "outcome",
  "requestArguments", "responseRelationship", "responseContent", "responseStructured",
]);

const RECEIPT_REQUIRED = new Set([
  "id", "taskId", "operation", "transport", "capturedAt", "outcome",
  "requestArguments", "responseRelationship",
]);

const MEASUREMENT_KEYS = new Set([
  "direction", "operation", "taskId", "timestamp", "utf8Bytes", "asciiCount", "nonAsciiCount",
]);

const VALID_TRANSPORT = new Set(["mcp", "cli"]);
const VALID_OUTCOME = new Set(["success", "error"]);

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

function validateReceiptMeasurement(
  m: unknown, expectedDirection: ExchangeDirection,
  expectedTaskId: string, expectedOperation: string, expectedTimestamp: string,
): RedactedExchangeMeasurement {
  if (m === null || typeof m !== "object") throw new TypeError("Invalid measurement in receipt");
  const o = m as Record<string, unknown>;
  const k = Object.keys(o);
  if (k.length !== MEASUREMENT_KEYS.size) throw new TypeError("Invalid measurement in receipt");
  for (const key of k) { if (!MEASUREMENT_KEYS.has(key)) throw new TypeError("Invalid measurement in receipt"); }
  if (!isValidDirection(o.direction)) throw new TypeError("Invalid measurement in receipt");
  if (o.direction !== expectedDirection) throw new TypeError("Invalid measurement in receipt");
  if (o.operation !== expectedOperation) throw new TypeError("Invalid measurement in receipt");
  if (o.taskId !== expectedTaskId) throw new TypeError("Invalid measurement in receipt");
  if (o.timestamp !== expectedTimestamp) throw new TypeError("Invalid measurement in receipt");
  if (!isNNInt(o.utf8Bytes)) throw new TypeError("Invalid measurement in receipt");
  if (!isNNInt(o.asciiCount)) throw new TypeError("Invalid measurement in receipt");
  if (!isNNInt(o.nonAsciiCount)) throw new TypeError("Invalid measurement in receipt");
  if ((o.utf8Bytes as number) < (o.asciiCount as number) + (o.nonAsciiCount as number)) {
    throw new TypeError("Invalid measurement in receipt");
  }
  return {
    direction: o.direction as ExchangeDirection,
    operation: o.operation as string, taskId: o.taskId as string, timestamp: o.timestamp as string,
    utf8Bytes: o.utf8Bytes as number, asciiCount: o.asciiCount as number, nonAsciiCount: o.nonAsciiCount as number,
  };
}

// --- Public API — orchestration exchange receipt ---

/** Normalize untrusted receipt-shaped input into a detached deeply-frozen
 *  canonical {@link OrchestrationExchangeReceipt}.  Every measurement is
 *  validated as exact known-key count-only evidence; the response
 *  relationship is always `"may-overlap"`.  Extra keys, inconsistent
 *  attribution, unsafe counts, and non-parseable timestamps all cause a
 *  deterministic non-echoing {@link TypeError}. */
export function normalizeOrchestrationExchangeReceipt(
  input: unknown,
): OrchestrationExchangeReceipt {
  if (input === null || typeof input !== "object") {
    throw new TypeError("Invalid orchestration exchange receipt");
  }
  const o = input as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (!RECEIPT_KEYS.has(key)) throw new TypeError("Invalid orchestration exchange receipt");
  }
  for (const key of RECEIPT_REQUIRED) {
    if (!hasOwn(o, key)) throw new TypeError("Invalid orchestration exchange receipt");
  }
  if (!NON_EMPTY_TRIM(o.id)) throw new TypeError("Invalid orchestration exchange receipt");
  if (!NON_EMPTY_TRIM(o.taskId)) throw new TypeError("Invalid orchestration exchange receipt");
  if (!NON_EMPTY_TRIM(o.operation)) throw new TypeError("Invalid orchestration exchange receipt");
  if (typeof o.transport !== "string" || !VALID_TRANSPORT.has(o.transport)) {
    throw new TypeError("Invalid orchestration exchange receipt");
  }
  if (!isValidTimestamp(o.capturedAt)) throw new TypeError("Invalid orchestration exchange receipt");
  if (typeof o.outcome !== "string" || !VALID_OUTCOME.has(o.outcome)) {
    throw new TypeError("Invalid orchestration exchange receipt");
  }
  if (o.responseRelationship !== "may-overlap") {
    throw new TypeError("Invalid receipt response relationship");
  }
  const id = o.id as string;
  const taskId = o.taskId as string;
  const operation = o.operation as string;
  const transport = o.transport as ReceiptTransport;
  const capturedAt = o.capturedAt as string;
  const outcome = o.outcome as ReceiptOutcome;
  const requestArguments = validateReceiptMeasurement(
    o.requestArguments, "request", taskId, operation, capturedAt);
  let responseContent: RedactedExchangeMeasurement | undefined;
  let responseStructured: RedactedExchangeMeasurement | undefined;
  if (hasOwn(o, "responseContent")) {
    if (o.responseContent == null) throw new TypeError("Invalid orchestration exchange receipt");
    responseContent = validateReceiptMeasurement(o.responseContent, "response", taskId, operation, capturedAt);
  }
  if (hasOwn(o, "responseStructured")) {
    if (o.responseStructured == null) throw new TypeError("Invalid orchestration exchange receipt");
    responseStructured = validateReceiptMeasurement(o.responseStructured, "response", taskId, operation, capturedAt);
  }
  const receipt: OrchestrationExchangeReceipt = {
    id, taskId, operation, transport, capturedAt, outcome,
    requestArguments: frozenCopy(requestArguments),
    responseRelationship: "may-overlap",
    ...(responseContent !== undefined ? { responseContent: frozenCopy(responseContent) } : {}),
    ...(responseStructured !== undefined ? { responseStructured: frozenCopy(responseStructured) } : {}),
  };
  deepFreeze(receipt);
  return receipt;
}

// --- Public API — calibration record normalizer ---

const CALIBRATION_RECORD_KEYS = new Set([
  "minTokens", "maxTokens", "method", "taskClass", "confidence",
  "version", "sampleSize", "evidenceReferences", "createdAt", "schemaVersion",
]);
const CALIBRATION_EVIDENCE_REFERENCE = /^[a-z][a-z0-9-]{1,31}:[A-Za-z0-9._-]{1,128}$/;

/** Validate one versioned aggregate direct-Codex calibration record and return
 *  a detached immutable canonical value.  Extra keys, raw prompts, source
 *  content, credentials, logs, and malformed timestamps are rejected without
 *  value echoing. */
export function normalizeDirectCodexCalibrationRecord(
  input: unknown,
): DirectCodexCalibrationRecord {
  if (input === null || typeof input !== "object") throw new TypeError("Invalid calibration record");
  const o = input as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (!CALIBRATION_RECORD_KEYS.has(key)) throw new TypeError("Invalid calibration record");
  }
  for (const key of CALIBRATION_RECORD_KEYS) {
    if (!hasOwn(o, key)) throw new TypeError("Invalid calibration record");
  }
  if (!isNNInt(o.minTokens) || !isNNInt(o.maxTokens)) throw new TypeError("Invalid calibration record");
  if ((o.minTokens as number) > (o.maxTokens as number)) throw new TypeError("Invalid calibration record");
  if (!Number.isSafeInteger(o.version) || (o.version as number) < 1) throw new TypeError("Invalid calibration record");
  if (!Number.isSafeInteger(o.sampleSize) || (o.sampleSize as number) < 1) throw new TypeError("Invalid calibration record");
  if (o.schemaVersion !== 1) throw new TypeError("Invalid calibration record");
  if (!NON_EMPTY_TRIM(o.method) || o.method.trim().length > 120) throw new TypeError("Invalid calibration record");
  if (!NON_EMPTY_TRIM(o.taskClass) || o.taskClass.trim().length > 80) throw new TypeError("Invalid calibration record");
  if (typeof o.confidence !== "string" || !VALID_CONF.has(o.confidence)) throw new TypeError("Invalid calibration record");
  if (!isValidTimestamp(o.createdAt) || new Date(o.createdAt).toISOString() !== o.createdAt) {
    throw new TypeError("Invalid calibration record");
  }
  if (!Array.isArray(o.evidenceReferences) || o.evidenceReferences.length < 1 || o.evidenceReferences.length > 50) {
    throw new TypeError("Invalid calibration record");
  }
  const seenReferences = new Set<string>();
  for (const ref of o.evidenceReferences as unknown[]) {
    if (typeof ref !== "string" || !CALIBRATION_EVIDENCE_REFERENCE.test(ref) || seenReferences.has(ref)) {
      throw new TypeError("Invalid calibration record");
    }
    seenReferences.add(ref);
  }
  const record: DirectCodexCalibrationRecord = {
    minTokens: o.minTokens as number,
    maxTokens: o.maxTokens as number,
    method: (o.method as string).trim(),
    taskClass: (o.taskClass as string).trim(),
    confidence: o.confidence as ConfidenceLevel,
    version: o.version as number,
    sampleSize: o.sampleSize as number,
    evidenceReferences: (o.evidenceReferences as string[]).map((r) => r.trim()),
    createdAt: o.createdAt as string,
    schemaVersion: 1,
  };
  deepFreeze(record);
  return record;
}

// --- Private — exchange estimation ---

/** Broad UTF-8 byte envelope for Token estimation.  No tokenizer is
 *  available so the range is deliberately wide.
 *
 *  Lower bound: ceil(total code points / 6) — very optimistic.
 *  Upper bound: total UTF-8 bytes — each byte could be a separate Token.
 *
 *  Method: "broad-utf8-byte-envelope-v1" · confidence: "low".
 *  This covers emoji, CJK, ASCII code, and punctuation conservatively. */
function estimateTokensFromMeasurements(
  measurements: readonly RedactedExchangeMeasurement[],
): { min: number; max: number } {
  let bytes = 0, cps = 0;
  for (const m of measurements) {
    bytes += m.utf8Bytes;
    cps += m.asciiCount + m.nonAsciiCount;
  }
  return { min: Math.ceil(cps / 6), max: bytes };
}

// --- Private — receipt-aware exchange estimation ---

/** Conservative Token interval for one receipt using may-overlap response
 *  arithmetic: request is always additive; with zero response surfaces only
 *  the request contributes; with one surface it is additive with request;
 *  with two surfaces the response lower bound uses the larger surface
 *  minimum while the upper bound sums both surface maxima — this preserves
 *  the honest may-overlap range without double-counting. */
function receiptExchangeInterval(receipt: OrchestrationExchangeReceipt): { min: number; max: number } {
  const req = estimateTokensFromMeasurements([receipt.requestArguments]);
  const surfaces: RedactedExchangeMeasurement[] = [];
  if (receipt.responseContent !== undefined) surfaces.push(receipt.responseContent);
  if (receipt.responseStructured !== undefined) surfaces.push(receipt.responseStructured);

  if (surfaces.length === 0) return req;
  if (surfaces.length === 1) {
    const s = estimateTokensFromMeasurements([surfaces[0]!]);
    return { min: req.min + s.min, max: req.max + s.max };
  }
  // Two response surfaces with explicit may-overlap relationship
  const s0 = estimateTokensFromMeasurements([surfaces[0]!]);
  const s1 = estimateTokensFromMeasurements([surfaces[1]!]);
  const respMin = Math.max(s0.min, s1.min);
  const respMax = s0.max + s1.max;
  return { min: req.min + respMin, max: req.max + respMax };
}

/** Validate canonical receipts all-or-nothing and aggregate distinct
 *  orchestration exchanges.  Any invalid receipt in a non-empty list
 *  produces typed-unavailable; individual receipts are not filtered. */
function resolveReceiptExchangeEstimate(
  receipts: readonly OrchestrationExchangeReceipt[],
): ExchangeTokenEstimate {
  const canonical: OrchestrationExchangeReceipt[] = [];
  for (const r of receipts) {
    try {
      canonical.push(normalizeOrchestrationExchangeReceipt(r));
    } catch {
      return frozenCopy({
        kind: "unavailable" as const,
        reason: "invalid-receipt-evidence" as const,
      });
    }
  }
  let totalMin = 0, totalMax = 0;
  for (const receipt of canonical) {
    const interval = receiptExchangeInterval(receipt);
    totalMin += interval.min;
    totalMax += interval.max;
  }
  return frozenCopy({
    kind: "range" as const,
    range: {
      min: totalMin, max: totalMax,
      method: "receipt-aware-broad-utf8-byte-envelope-v1",
      confidence: "low" as const,
    },
  });
}

// --- Private — exchange estimation (precedence chain) ---

function resolveExchangeEstimate(
  exactExchangeTokens: { tokens: number; source: string } | undefined,
  exchangeReceipts: readonly OrchestrationExchangeReceipt[] | undefined,
  exchangeMeasurements: readonly RedactedExchangeMeasurement[] | undefined,
): ExchangeTokenEstimate {
  // Exact path takes absolute precedence — including its invalidity
  if (exactExchangeTokens !== undefined) {
    if (!isNNInt(exactExchangeTokens.tokens) || !NON_EMPTY_TRIM(exactExchangeTokens.source)) {
      return frozenCopy({ kind: "unavailable" as const,
        reason: "invalid-exact-evidence" as const });
    }
    return frozenCopy({ kind: "exact" as const,
      tokens: exactExchangeTokens.tokens, source: exactExchangeTokens.source });
  }

  // Receipts take precedence over flat measurements.  An explicitly
  // supplied empty array means the caller has no receipt evidence and
  // the next evidence level is NOT consulted.
  if (exchangeReceipts !== undefined) {
    if (exchangeReceipts.length === 0) {
      return frozenCopy({ kind: "unavailable" as const, reason: "no-measurements" as const });
    }
    return resolveReceiptExchangeEstimate(exchangeReceipts);
  }

  // Measurements: all-or-nothing — one invalid measurement taints the set
  if (exchangeMeasurements !== undefined && exchangeMeasurements.length > 0) {
    for (const m of exchangeMeasurements) {
      if (!isValidMeasurement(m)) {
        return frozenCopy({ kind: "unavailable" as const,
          reason: "invalid-measurement" as const });
      }
    }
    const est = estimateTokensFromMeasurements(exchangeMeasurements);
    return frozenCopy({
      kind: "range" as const,
      range: { min: est.min, max: est.max, method: "broad-utf8-byte-envelope-v1",
        confidence: "low" as const },
    });
  }

  return frozenCopy({ kind: "unavailable" as const, reason: "no-measurements" as const });
}

// --- Private — Worker volume aggregation ---

function aggregateWorkerVolume(
  usages: readonly (AttemptTokenUsage | null | undefined)[],
): WorkerVolumeEvidence {
  let input = 0, output = 0, cr = 0, cc = 0, complete = 0, missing = 0;
  for (const u of usages) {
    if (isCompleteUsage(u)) {
      input += u.inputTokens; output += u.outputTokens;
      cr += u.cacheReadInputTokens; cc += u.cacheCreationInputTokens;
      complete++;
    } else { missing++; }
  }
  const gross = input + output + cr + cc, total = complete + missing;
  if (total === 0) {
    return frozenCopy({
      kind: "incomplete", inputTokens: 0, outputTokens: 0,
      cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
      grossWorkerTokens: 0, sampleCount: 0, completeSampleCount: 0, missingSampleCount: 0 });
  }
  if (missing > 0) {
    return frozenCopy({
      kind: "incomplete", inputTokens: input, outputTokens: output,
      cacheReadInputTokens: cr, cacheCreationInputTokens: cc,
      grossWorkerTokens: gross, sampleCount: total,
      completeSampleCount: complete, missingSampleCount: missing });
  }
  return frozenCopy({
    kind: "complete", inputTokens: input, outputTokens: output,
    cacheReadInputTokens: cr, cacheCreationInputTokens: cc,
    grossWorkerTokens: gross, sampleCount: total });
}

// --- Private — boundary reduction ---

function exchangeRange(
  ee: ExchangeTokenEstimate,
): { min: number; max: number } | null {
  if (ee.kind === "exact") return { min: ee.tokens, max: ee.tokens };
  if (ee.kind === "range") return { min: ee.range.min, max: ee.range.max };
  return null; // unavailable
}

function computeBoundaryReduction(
  wv: WorkerVolumeEvidence, ee: ExchangeTokenEstimate,
): BoundaryReduction {
  if (wv.kind !== "complete") {
    return frozenCopy({ available: false as const, reason: "incomplete-worker-usage" as const });
  }
  const er = exchangeRange(ee);
  if (er === null) {
    return frozenCopy({ available: false as const, reason: "missing-exchange-evidence" as const });
  }
  const confidence: ConfidenceLevel = ee.kind === "exact" ? "high" : "low";
  const method = ee.kind === "exact"
    ? "worker-volume-minus-exact-exchange"
    : "worker-volume-minus-broad-utf8-byte-envelope";
  return frozenCopy({
    available: true as const,
    tokens: { min: wv.grossWorkerTokens - er.max, max: wv.grossWorkerTokens - er.min, method, confidence },
  });
}

// --- Private — direct-Codex savings ---

function calibrationCompatibility(
  c: unknown, currentTaskClass: string | undefined,
): "valid" | "missing" | "invalid" | "task-class-mismatch" | "task-class-required" {
  if (c === undefined || c === null) return "missing";
  if (typeof c !== "object") return "invalid";
  const o = c as Record<string, unknown>;
  if (!isNNInt(o.minTokens) || !isNNInt(o.maxTokens)) return "invalid";
  if ((o.minTokens as number) > (o.maxTokens as number)) return "invalid";
  if (!NON_EMPTY_TRIM(o.method) || !NON_EMPTY_TRIM(o.taskClass)) return "invalid";
  if (typeof o.confidence !== "string" || !VALID_CONF.has(o.confidence)) return "invalid";
  if (!NON_EMPTY_TRIM(currentTaskClass)) return "task-class-required";
  if (o.taskClass !== currentTaskClass) return "task-class-mismatch";
  return "valid";
}

function confidenceMin(a: ConfidenceLevel, b: ConfidenceLevel): ConfidenceLevel {
  if (a === "low" || b === "low") return "low";
  if (a === "medium" || b === "medium") return "medium";
  return "high";
}

function computeDirectCodexSavings(
  ee: ExchangeTokenEstimate, calibration: unknown,
  currentTaskClass: string | undefined,
): DirectCodexSavings {
  const compat = calibrationCompatibility(calibration, currentTaskClass);
  if (compat !== "valid") {
    const reason = compat === "missing" ? "direct-baseline-missing"
      : compat === "invalid" ? "incompatible-baseline"
      : compat === "task-class-required" ? "task-class-required"
      : "task-class-mismatch";
    return frozenCopy({ available: false as const, reason });
  }

  const cal = calibration as DirectCodexCalibration;
  const baseMin = cal.minTokens, baseMax = cal.maxTokens;

  const er = exchangeRange(ee);
  if (er === null) {
    return frozenCopy({ available: false as const, reason: "missing-exchange-evidence" as const });
  }
  const exMin = er.min, exMax = er.max;

  // Absolute savings: baseline − exchange (not clamped, may be negative)
  const absMin = baseMin - exMax;
  const absMax = baseMax - exMin;

  const exConf: ConfidenceLevel = ee.kind === "exact" ? "high" : "low";
  const conf = confidenceMin(cal.confidence, exConf);

  // Monotonic interval percentage
  // lower = 100 × (1 − exchangeMax / baselineMin)
  // upper = 100 × (1 − exchangeMin / baselineMax)
  // Unavailable when baselineMin is zero (division undefined).
  const pctSavings: PercentageSavings = baseMin > 0
    ? { available: true as const,
        range: { min: 100 * (1 - exMax / baseMin), max: 100 * (1 - exMin / baseMax),
          method: `calibration-${cal.method}-percentage`, confidence: conf } }
    : { available: false as const, reason: "zero-baseline" as const };

  return frozenCopy({
    available: true as const,
    absoluteSavings: { min: absMin, max: absMax,
      method: `calibration-${cal.method}-minus-exchange`, confidence: conf },
    percentageSavings: pctSavings,
    baseline: { minTokens: baseMin, maxTokens: baseMax,
      method: cal.method, taskClass: cal.taskClass, confidence: cal.confidence },
  });
}

// --- Public API — report builder ---

/** Exchange evidence precedence chain (highest to lowest):
 *  exact > receipts > flat measurements > unavailable.
 *  `exchangeReceipts === undefined` defers to the next level (legacy).
 *  `exchangeReceipts === []` means the caller explicitly supplied no
 *  receipt evidence and short-circuits to no-measurements without
 *  consulting exchangeMeasurements.  Non-empty with any invalid
 *  receipt → typed-unavailable. */
export function buildTokenEfficiencyReport(params: {
  usages: readonly (AttemptTokenUsage | null | undefined)[];
  exchangeMeasurements?: readonly RedactedExchangeMeasurement[];
  exchangeReceipts?: readonly OrchestrationExchangeReceipt[];
  exactExchangeTokens?: { tokens: number; source: string };
  calibration?: unknown;
  currentTaskClass?: string;
}): TokenEfficiencyReport {
  // 1. Worker volume — per-model breakdown is NOT added on top of aggregate
  const workerVolume = aggregateWorkerVolume(params.usages);

  // 2. Exchange estimate — precedence: exact > receipts > measurements
  const exchangeEstimate = resolveExchangeEstimate(
    params.exactExchangeTokens, params.exchangeReceipts, params.exchangeMeasurements);

  // 3. Boundary reduction — never conflate with direct-Codex savings
  const boundaryReduction = computeBoundaryReduction(workerVolume, exchangeEstimate);

  // 4. Direct-Codex savings — unavailable without compatible calibration
  const directCodexSavings = computeDirectCodexSavings(
    exchangeEstimate, params.calibration, params.currentTaskClass);

  // Assemble; all children are already detached frozen copies
  const report: TokenEfficiencyReport = { workerVolume, exchangeEstimate,
    boundaryReduction, directCodexSavings };
  deepFreeze(report);
  return report;
}
