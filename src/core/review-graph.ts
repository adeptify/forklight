/**
 * Exact-revision Review Graph: one through three independent read-only judges.
 *
 * Boundaries:
 *   - Binds 1–3 reviewer Tasks and structured results to one immutable
 *     Candidate Revision. One graph round; max three unique Worker Profiles.
 *   - Never mutates the Candidate Task status, Main Review, Diff, or source.
 *   - Never auto-accepts, auto-retries, auto-corrects, auto-votes, or auto-integrates.
 *   - Private packet path, raw patch, raw resultText, credentials, and absolute
 *     paths are never projected to Hub/MCP/CLI.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StateStore } from "../state/store.js";
import type { ForkLightSettings } from "./settings.js";
import {
  enforcementCapabilityForRuntime,
  resolveTaskEffectivePolicy,
} from "./advanced-policy.js";
import {
  candidateRevisionMatchesCurrentDiff,
  latestMainReview,
  latestVerificationEvent,
  resolveLatestRevision,
  summarizeRevision,
} from "./candidate-revision.js";
import { isoTimestamp as timestamp } from "./time.js";
import {
  applyResolvedNetworkPolicy,
  getWorkerProfile,
  resolveWorkerSelection,
} from "./worker-profiles.js";
import { defaultExecutableForRuntime } from "./runtime-names.js";
import type {
  ContractTaskSpec,
  EffectivePolicySnapshot,
  EventRecord,
  FrozenWorkerIdentity,
  ReviewAggregationState,
  ReviewAggregationView,
  ReviewAssignmentRecord,
  ReviewAssignmentStatus,
  ReviewAssignmentView,
  ReviewDisposition,
  ReviewFinding,
  ReviewFindingSeverity,
  ReviewGraphRecord,
  ReviewGraphStatus,
  ReviewGraphView,
  ReviewRequirementGate,
  ReviewResult,
  ReviewResultFailureCode,
  ReviewResultRepairFailureCode,
  ReviewResultRepairRecord,
  ReviewResultRepairStatus,
  ReviewResultRepairView,
  ReviewResultView,
  TaskRecord,
  TaskReviewRequirement,
  TaskSpec,
} from "./types.js";

// --- Constants ---

export const REVIEW_REASON_MAX_LENGTH = 1000;
export const REVIEW_RESULT_SCHEMA_VERSION = 1 as const;
export const REVIEW_MAX_FINDINGS = 8;
export const REVIEW_SUMMARY_MAX = 500;
export const REVIEW_FINDING_TEXT_MAX = 500;
/** Max characters for a relative evidencePath in a finding (parser bound). */
export const REVIEW_EVIDENCE_PATH_MAX = 240;
export const REVIEW_RESULT_TEXT_MAX = 32_000;
export const REVIEW_PACKET_SCHEMA_VERSION = 1 as const;
export const REVIEW_MAX_JUDGES = 3 as const;

/**
 * Compact human-readable parser field limits for reviewer prompts and packets.
 * Must stay aligned with parseReviewResultText bounds.
 */
export function reviewerOutputBoundsLine(): string {
  return `Bounds: summary ≤ ${REVIEW_SUMMARY_MAX} chars; each finding text (affectedBehavior, recommendation) ≤ ${REVIEW_FINDING_TEXT_MAX} chars; evidencePath ≤ ${REVIEW_EVIDENCE_PATH_MAX} chars; 0–${REVIEW_MAX_FINDINGS} findings.`;
}

/** Speakable credential field/option bodies. Values after these stay unsafe. */
const CREDENTIAL_LABEL_BODY =
  String.raw`(?:api[_-]?key|access[_-]?token|secret[_-]?key|client[_-]?secret|auth[_-]?token)`;
const PROVIDER_TOKEN_VALUE = /\bsk-[A-Za-z0-9_-]{8,}/i;
const AUTHORIZATION_VALUE = /\bBearer\s+[A-Za-z0-9_\-.]{8,}/i;
const PASSWORD_ASSIGNMENT = /\bpassword\s*[:=]/i;
const CREDENTIAL_ASSIGNMENT_VALUE = new RegExp(
  String.raw`(?:--)?${CREDENTIAL_LABEL_BODY}["']?\s*[:=]\s*["']?\S`,
  "i",
);
const CREDENTIAL_CLI_WHITESPACE_VALUE = new RegExp(
  String.raw`--${CREDENTIAL_LABEL_BODY}\s+["']?[^\s"']{8,}`,
  "i",
);
const KNOWN_CREDENTIAL_LABEL = /(?:^|[^A-Za-z0-9])(?:--)?api[_-]?key\b/i;

/** True when text contains an actual secret-shaped value, not a bare label. */
function containsUnsafeCredentialValue(text: string): boolean {
  return PROVIDER_TOKEN_VALUE.test(text)
    || AUTHORIZATION_VALUE.test(text)
    || PASSWORD_ASSIGNMENT.test(text)
    || CREDENTIAL_ASSIGNMENT_VALUE.test(text)
    || CREDENTIAL_CLI_WHITESPACE_VALUE.test(text);
}

/** Historical admission only: the old false-positive family is present. */
function containsKnownCredentialLabel(text: string): boolean {
  return KNOWN_CREDENTIAL_LABEL.test(text);
}

const RESULT_ROOT_KEYS = new Set([
  "schemaVersion",
  "reviewedRevisionId",
  "proposedDisposition",
  "summary",
  "findings",
]);

const FINDING_KEYS = new Set([
  "severity",
  "evidencePath",
  "affectedBehavior",
  "recommendation",
]);

const DISPOSITIONS = new Set<ReviewDisposition>(["accept", "revise", "reject"]);
const SEVERITIES = new Set<ReviewFindingSeverity>(["info", "warning", "error"]);

// --- Public inputs / results ---

export interface CreateReviewGraphInput {
  candidateTaskId: string;
  /**
   * Preferred: ordered unique set of 1–3 saved Worker Profile ids.
   * When omitted, `reviewerWorkerProfileId` is accepted as a one-item alias.
   */
  reviewerWorkerProfileIds?: string[];
  /** Backward-compatible single-profile alias for one-item create. */
  reviewerWorkerProfileId?: string;
  reason: string;
  confirm: true;
}

export interface CreateReviewGraphResult {
  graph: ReviewGraphView;
  /** First reviewer Task id (stable compatibility field). */
  reviewerTaskId: string;
  /** All reviewer Task ids in assignment ordinal order. */
  reviewerTaskIds: string[];
  created: boolean;
}

/** Normalize 1–3 unique profile ids from plural list or single-profile alias. */
export function normalizeReviewerProfileIds(input: {
  reviewerWorkerProfileIds?: unknown;
  reviewerWorkerProfileId?: unknown;
}): string[] {
  const fromList = input.reviewerWorkerProfileIds;
  const fromSingle = input.reviewerWorkerProfileId;
  let raw: string[] = [];
  if (fromList !== undefined) {
    if (!Array.isArray(fromList)) {
      throw new Error("review graph reviewerWorkerProfileIds must be an array of profile ids");
    }
    raw = fromList.map((entry, index) => {
      if (typeof entry !== "string" || entry.trim().length === 0) {
        throw new Error(
          `review graph reviewerWorkerProfileIds[${index}] must be a non-empty profile id`,
        );
      }
      return entry.trim();
    });
  } else if (typeof fromSingle === "string" && fromSingle.trim().length > 0) {
    raw = [fromSingle.trim()];
  } else {
    throw new Error(
      "review graph requires reviewerWorkerProfileIds (1–3) or reviewerWorkerProfileId",
    );
  }
  if (raw.length < 1) {
    throw new Error("review graph requires at least one reviewer Worker Profile");
  }
  if (raw.length > REVIEW_MAX_JUDGES) {
    throw new Error(
      `review graph admits at most ${REVIEW_MAX_JUDGES} independent judges per exact revision`,
    );
  }
  const seen = new Set<string>();
  for (const id of raw) {
    if (seen.has(id)) {
      throw new Error(
        `review graph rejected: duplicate reviewer Worker Profile id "${id}"`,
      );
    }
    seen.add(id);
  }
  return raw;
}

// --- Path helpers ---

function detectUnsafePath(file: string): string | undefined {
  if (path.isAbsolute(file)) return `Absolute path: "${file}"`;
  if (!file || file.includes("\\") || file.includes("\0")) {
    return `Ambiguous path: "${file}"`;
  }
  if (file.split("/").some((segment) => segment === ".." || segment === "." || !segment)) {
    return `Traversal path: "${file}"`;
  }
  return undefined;
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function privateArtifactPath(task: TaskRecord, revisionId: string): string {
  return path.join(task.paths.root, "revisions", `${revisionId}.patch`);
}

function privatePacketPath(task: TaskRecord, graphId: string): string {
  return path.join(task.paths.root, "reviews", graphId, "packet.json");
}

/** Isolated project root per assignment so parallel judges never share a workspace. */
function reviewerProjectDir(home: string, graphId: string, assignmentId: string): string {
  return path.join(home, "review-projects", graphId, assignmentId);
}

// --- Strict result parsing ---

/**
 * Try to parse one complete JSON object starting at `start` (must be '{').
 * Respects JSON string escapes so braces inside strings do not change depth.
 * Returns the end index (exclusive) and parsed value, or undefined on failure.
 */
function tryParseObjectAt(
  text: string,
  start: number,
): { end: number; value: unknown } | undefined {
  if (text[start] !== "{") return undefined;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try {
          return { end: i + 1, value: JSON.parse(slice) };
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/**
 * Extract exactly one complete JSON object from a bounded whole reply.
 * Allows optional surrounding whitespace, Markdown fences, or short prose.
 * Rejects zero objects, multiple top-level objects, and unparseable braces.
 * Caller must already enforce whole-reply length and credential scanning.
 */
function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw typedFailure("missing-result");
  if (trimmed.length > REVIEW_RESULT_TEXT_MAX) throw typedFailure("oversized");

  const candidates: unknown[] = [];
  let i = 0;
  while (i < trimmed.length) {
    if (trimmed[i] === "{") {
      const parsed = tryParseObjectAt(trimmed, i);
      if (parsed !== undefined) {
        candidates.push(parsed.value);
        i = parsed.end;
        continue;
      }
    }
    i += 1;
  }

  if (candidates.length === 0) throw typedFailure("malformed-json");
  if (candidates.length > 1) throw typedFailure("malformed-json");
  return candidates[0];
}

class ReviewParseError extends Error {
  readonly code: ReviewResultFailureCode;
  constructor(code: ReviewResultFailureCode) {
    super(code);
    this.name = "ReviewParseError";
    this.code = code;
  }
}

function typedFailure(code: ReviewResultFailureCode): ReviewParseError {
  return new ReviewParseError(code);
}

/** Typed parser failure code, or undefined when the error is not a review parse. */
export function reviewParseFailureCode(error: unknown): ReviewResultFailureCode | undefined {
  return error instanceof ReviewParseError ? error.code : undefined;
}

export type ReviewResultRepairIneligibilityCode =
  | ReviewResultFailureCode
  | "missing-confirm"
  | "ownership-mismatch"
  | "assignment-not-failed"
  | "failure-not-schema-violation"
  | "reviewer-task-not-succeeded"
  | "already-repaired"
  | "summary-already-valid"
  | "missing-known-label"
  | "private-packet-unavailable";

export type ReviewResultRepairKind = "overlong-summary" | "credential-label";

export interface ReviewResultRepairEligibility {
  eligible: boolean;
  code?: ReviewResultRepairIneligibilityCode;
  kind?: ReviewResultRepairKind;
  message: string;
  original?: ReviewResult;
  assignment?: ReviewAssignmentRecord;
  reviewerTask?: TaskRecord;
  resultText?: string;
}

/**
 * Inspect one whole-reply blob with the same strict parser checks, except
 * `summary` may exceed 500 characters. Eligible only when that is the sole
 * defect and the whole reply stays within the published total-result bound.
 */
export function inspectReviewResultForSummaryRepair(
  resultText: string | undefined,
  expectedRevisionId: string,
  expectedReviewerTaskId: string,
  actualReviewerTaskId: string,
): { eligible: true; original: ReviewResult } | { eligible: false; code: ReviewResultFailureCode | "summary-already-valid" } {
  try {
    const original = parseReviewResultTextAllowingOverlongSummary(
      resultText,
      expectedRevisionId,
      expectedReviewerTaskId,
      actualReviewerTaskId,
    );
    if (original.summary.length <= REVIEW_SUMMARY_MAX) {
      return { eligible: false, code: "summary-already-valid" };
    }
    return { eligible: true, original };
  } catch (error) {
    return { eligible: false, code: reviewParseFailureCode(error) ?? "schema-violation" };
  }
}

/**
 * Historical admission: retained JSON must now pass the refined strict parser
 * and still contain a known credential label. Actual values stay ineligible.
 */
export function inspectReviewResultForCredentialLabelRepair(
  resultText: string | undefined,
  expectedRevisionId: string,
  expectedReviewerTaskId: string,
  actualReviewerTaskId: string,
): { eligible: true; original: ReviewResult } | { eligible: false; code: ReviewResultFailureCode | "missing-known-label" } {
  try {
    const original = parseReviewResultText(
      resultText,
      expectedRevisionId,
      expectedReviewerTaskId,
      actualReviewerTaskId,
    );
    if (!containsKnownCredentialLabel(resultText ?? "")) {
      return { eligible: false, code: "missing-known-label" };
    }
    return { eligible: true, original };
  } catch (error) {
    return { eligible: false, code: reviewParseFailureCode(error) ?? "schema-violation" };
  }
}

export function findingsEqual(
  left: readonly ReviewFinding[],
  right: readonly ReviewFinding[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((finding, index) => {
    const other = right[index];
    return other !== undefined
      && finding.severity === other.severity
      && finding.evidencePath === other.evidencePath
      && finding.affectedBehavior === other.affectedBehavior
      && finding.recommendation === other.recommendation;
  });
}

/** True when repaired JSON is the same independent opinion except `summary`. */
export function sameOpinionExceptSummary(original: ReviewResult, repaired: ReviewResult): boolean {
  return original.schemaVersion === repaired.schemaVersion
    && original.reviewedRevisionId === repaired.reviewedRevisionId
    && original.proposedDisposition === repaired.proposedDisposition
    && findingsEqual(original.findings, repaired.findings);
}

function latestAttemptResultText(store: StateStore, taskId: string): string | undefined {
  const attempts = store.listAttempts(taskId);
  const latest = attempts.reduce<(typeof attempts)[number] | undefined>(
    (best, attempt) => (best === undefined || attempt.ordinal > best.ordinal ? attempt : best),
    undefined,
  );
  return latest?.resultText;
}

function repairIneligible(
  code: ReviewResultRepairIneligibilityCode,
  message: string,
): ReviewResultRepairEligibility {
  return { eligible: false, code, message };
}

/**
 * Pre-mutation admission for one explicit Main-confirmed summary repair.
 * Rejects before any durable repair record or Task is created.
 */
export function evaluateReviewResultRepairEligibility(
  store: StateStore,
  input: {
    candidateTaskId: string;
    assignmentId: string;
    confirm?: unknown;
  },
): ReviewResultRepairEligibility {
  if (input.confirm !== true) {
    return repairIneligible("missing-confirm", "review result repair requires confirm: true");
  }
  let assignment: ReviewAssignmentRecord;
  try {
    assignment = store.getReviewAssignment(input.assignmentId);
  } catch {
    return repairIneligible(
      "ownership-mismatch",
      "review result repair rejected: assignment does not belong to this Candidate",
    );
  }
  if (assignment.candidateTaskId !== input.candidateTaskId) {
    return repairIneligible(
      "ownership-mismatch",
      "review result repair rejected: assignment does not belong to this Candidate",
    );
  }
  const graph = store.getReviewGraph(assignment.graphId);
  if (graph.candidateTaskId !== input.candidateTaskId) {
    return repairIneligible(
      "ownership-mismatch",
      "review result repair rejected: assignment does not belong to this Candidate",
    );
  }
  if (assignment.resultRepair !== undefined) {
    return repairIneligible(
      "already-repaired",
      "review result repair rejected: one-shot allowance already consumed",
    );
  }
  if (assignment.status !== "failed") {
    return repairIneligible(
      "assignment-not-failed",
      "review result repair rejected: assignment is not a terminal schema-violation",
    );
  }
  if (
    assignment.failureCode !== "schema-violation"
    && assignment.failureCode !== "unsafe-content"
  ) {
    return repairIneligible(
      "failure-not-schema-violation",
      "review result repair rejected: assignment is not a terminal schema-violation",
    );
  }
  let reviewerTask: TaskRecord;
  try {
    reviewerTask = store.getTask(assignment.reviewerTaskId);
  } catch {
    return repairIneligible(
      "reviewer-task-not-succeeded",
      "review result repair rejected: original reviewer Task did not succeed",
    );
  }
  if (reviewerTask.status !== "succeeded") {
    return repairIneligible(
      "reviewer-task-not-succeeded",
      "review result repair rejected: original reviewer Task did not succeed",
    );
  }
  const resultText = latestAttemptResultText(store, reviewerTask.id);
  const inspected = assignment.failureCode === "unsafe-content"
    ? inspectReviewResultForCredentialLabelRepair(
      resultText,
      assignment.candidateRevisionId,
      assignment.reviewerTaskId,
      reviewerTask.id,
    )
    : inspectReviewResultForSummaryRepair(
      resultText,
      assignment.candidateRevisionId,
      assignment.reviewerTaskId,
      reviewerTask.id,
    );
  if (!inspected.eligible) {
    if (inspected.code === "summary-already-valid") {
      return repairIneligible(
        "summary-already-valid",
        "review result repair rejected: summary is already within the published bound",
      );
    }
    if (assignment.failureCode === "unsafe-content") {
      return repairIneligible(
        inspected.code,
        `review result repair rejected: result is not an otherwise-valid credential-label false positive (${inspected.code})`,
      );
    }
    return repairIneligible(
      inspected.code,
      `review result repair rejected: result is not an otherwise-valid over-limit summary (${inspected.code})`,
    );
  }
  const packet = readExactPrivatePacket(assignment);
  if (!packet.ok) {
    return repairIneligible(
      "private-packet-unavailable",
      "review result repair rejected: original private packet is missing, unreadable, or invalid",
    );
  }
  return {
    eligible: true,
    kind: assignment.failureCode === "unsafe-content" ? "credential-label" : "overlong-summary",
    message: "Eligible for one-shot same-Judge schema-only summary repair",
    original: inspected.original,
    assignment,
    reviewerTask,
    ...(resultText === undefined ? {} : { resultText }),
  };
}

function rejectCredential(text: string): void {
  if (containsUnsafeCredentialValue(text)) throw typedFailure("unsafe-content");
}

function boundedText(value: unknown, max: number, code: ReviewResultFailureCode = "schema-violation"): string {
  if (typeof value !== "string") throw typedFailure(code);
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > max) throw typedFailure(code);
  if (/[\r\n]/.test(trimmed)) throw typedFailure("unsafe-content");
  rejectCredential(trimmed);
  return trimmed;
}

/** Repair-only: same strict shape as parseReviewResultText, except summary may
 *  exceed 500 characters while the whole reply stays within REVIEW_RESULT_TEXT_MAX.
 *  Not exported — ordinary callers cannot relax the published summary bound. */
function parseReviewResultTextAllowingOverlongSummary(
  resultText: string | undefined,
  expectedRevisionId: string,
  expectedReviewerTaskId: string,
  actualReviewerTaskId: string,
): ReviewResult {
  return parseReviewResultTextInternal(
    resultText,
    expectedRevisionId,
    expectedReviewerTaskId,
    actualReviewerTaskId,
    REVIEW_RESULT_TEXT_MAX,
  );
}

/** Strictly parse exactly one bounded JSON judge result from a whole reply.
 *  Allows optional fence/prose wrappers around a unique object; scans the entire
 *  original text for credentials and size before extraction. Fail closed on any
 *  missing, ambiguous, malformed, stale, unsafe, oversized, or extra-field content.
 *  The published summary bound is always 500 characters. */
export function parseReviewResultText(
  resultText: string | undefined,
  expectedRevisionId: string,
  expectedReviewerTaskId: string,
  actualReviewerTaskId: string,
): ReviewResult {
  return parseReviewResultTextInternal(
    resultText,
    expectedRevisionId,
    expectedReviewerTaskId,
    actualReviewerTaskId,
    REVIEW_SUMMARY_MAX,
  );
}

function parseReviewResultTextInternal(
  resultText: string | undefined,
  expectedRevisionId: string,
  expectedReviewerTaskId: string,
  actualReviewerTaskId: string,
  summaryMax: number,
): ReviewResult {
  if (actualReviewerTaskId !== expectedReviewerTaskId) {
    throw typedFailure("wrong-identity");
  }
  if (resultText === undefined || resultText.trim().length === 0) {
    throw typedFailure("missing-result");
  }
  if (resultText.length > REVIEW_RESULT_TEXT_MAX) {
    throw typedFailure("oversized");
  }
  rejectCredential(resultText);

  const raw = extractJsonObject(resultText);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw typedFailure("schema-violation");
  }
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== RESULT_ROOT_KEYS.size || keys.some((k) => !RESULT_ROOT_KEYS.has(k))) {
    throw typedFailure("extra-fields");
  }
  if (obj.schemaVersion !== REVIEW_RESULT_SCHEMA_VERSION) {
    throw typedFailure("schema-violation");
  }
  if (typeof obj.reviewedRevisionId !== "string" || obj.reviewedRevisionId.trim().length === 0) {
    throw typedFailure("schema-violation");
  }
  if (obj.reviewedRevisionId !== expectedRevisionId) {
    throw typedFailure("stale-revision");
  }
  if (typeof obj.proposedDisposition !== "string" || !DISPOSITIONS.has(obj.proposedDisposition as ReviewDisposition)) {
    throw typedFailure("schema-violation");
  }
  const summary = boundedText(obj.summary, summaryMax);
  if (!Array.isArray(obj.findings)) throw typedFailure("schema-violation");
  if (obj.findings.length > REVIEW_MAX_FINDINGS) throw typedFailure("oversized");

  const findings: ReviewFinding[] = [];
  for (const entry of obj.findings) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw typedFailure("schema-violation");
    }
    const f = entry as Record<string, unknown>;
    const fKeys = Object.keys(f);
    if (fKeys.length !== FINDING_KEYS.size || fKeys.some((k) => !FINDING_KEYS.has(k))) {
      throw typedFailure("extra-fields");
    }
    if (typeof f.severity !== "string" || !SEVERITIES.has(f.severity as ReviewFindingSeverity)) {
      throw typedFailure("schema-violation");
    }
    const evidencePath = boundedText(f.evidencePath, REVIEW_EVIDENCE_PATH_MAX);
    if (detectUnsafePath(evidencePath) !== undefined) {
      throw typedFailure("unsafe-content");
    }
    findings.push({
      severity: f.severity as ReviewFindingSeverity,
      evidencePath,
      affectedBehavior: boundedText(f.affectedBehavior, REVIEW_FINDING_TEXT_MAX),
      recommendation: boundedText(f.recommendation, REVIEW_FINDING_TEXT_MAX),
    });
  }

  return {
    schemaVersion: 1,
    reviewedRevisionId: expectedRevisionId,
    proposedDisposition: obj.proposedDisposition as ReviewDisposition,
    summary,
    findings,
  };
}

// --- Safe projections ---

function projectResult(result: ReviewResult): ReviewResultView {
  return {
    schemaVersion: 1,
    reviewedRevisionId: result.reviewedRevisionId,
    proposedDisposition: result.proposedDisposition,
    summary: result.summary,
    findings: result.findings.map((f) => ({
      severity: f.severity,
      evidencePath: f.evidencePath,
      affectedBehavior: f.affectedBehavior,
      recommendation: f.recommendation,
    })),
  };
}

function projectResultRepair(repair: ReviewResultRepairRecord): ReviewResultRepairView {
  const resultUsable = repair.status === "succeeded"
    && repair.result !== undefined
    && repair.failureCode === undefined;
  return {
    taskId: repair.taskId,
    status: repair.status,
    resultUsable,
    createdAt: repair.createdAt,
    updatedAt: repair.updatedAt,
    ...(repair.completedAt === undefined ? {} : { completedAt: repair.completedAt }),
    ...(repair.failureCode === undefined ? {} : { failureCode: repair.failureCode }),
    ...(repair.result === undefined ? {} : { result: projectResult(repair.result) }),
  };
}

function projectAssignment(assignment: ReviewAssignmentRecord): ReviewAssignmentView {
  const effective = effectiveAssignmentResult(assignment);
  const resultUsable = effective !== undefined;
  return {
    id: assignment.id,
    ordinal: assignment.ordinal,
    status: assignment.status,
    reviewerWorkerProfileId: assignment.reviewerWorkerProfileId,
    reviewerTaskId: assignment.reviewerTaskId,
    frozenIdentity: { ...assignment.frozenIdentity },
    reason: assignment.reason,
    createdAt: assignment.createdAt,
    updatedAt: assignment.updatedAt,
    ...(assignment.completedAt === undefined ? {} : { completedAt: assignment.completedAt }),
    resultUsable,
    ...(effective === undefined ? {} : { result: projectResult(effective) }),
    ...(assignment.failureCode === undefined ? {} : { failureCode: assignment.failureCode }),
    ...(assignment.resultRepair === undefined
      ? {}
      : { resultRepair: projectResultRepair(assignment.resultRepair) }),
  };
}

function isAssignmentTerminal(assignment: ReviewAssignmentRecord): boolean {
  return assignment.status === "completed" || assignment.status === "failed";
}

function isAssignmentUsable(assignment: ReviewAssignmentRecord): boolean {
  return effectiveAssignmentResult(assignment) !== undefined;
}

function effectiveAssignmentResult(assignment: ReviewAssignmentRecord): ReviewResult | undefined {
  const repair = assignment.resultRepair;
  if (
    repair !== undefined
    && repair.status === "succeeded"
    && repair.result !== undefined
    && repair.failureCode === undefined
  ) {
    return repair.result;
  }
  if (assignment.result !== undefined && assignment.failureCode === undefined) {
    return assignment.result;
  }
  return undefined;
}

export function hasActiveReviewResultRepair(assignment: ReviewAssignmentRecord): boolean {
  return assignment.resultRepair !== undefined
    && (assignment.resultRepair.status === "queued" || assignment.resultRepair.status === "running");
}

/** Stable reason when a same-Judge schema-only repair is still running. */
export const PENDING_RESULT_REPAIR_BLOCKS_INTEGRATION =
  "A same-Judge schema-only result repair is still running; Integration waits until that repair is terminal and Main records a fresh decision";

/** Canonical multi-judge aggregation. Describes evidence only — never a vote. */
export function aggregateReviewAssignments(
  assignments: readonly ReviewAssignmentRecord[],
): ReviewAggregationView {
  const ordered = [...assignments].sort((a, b) => a.ordinal - b.ordinal);
  const total = ordered.length;
  const pending = ordered.filter((a) => !isAssignmentTerminal(a)).length;
  const usableList = ordered.filter(isAssignmentUsable);
  const unusable = ordered.filter((a) => isAssignmentTerminal(a) && !isAssignmentUsable(a)).length;
  const dispositionCounts = { accept: 0, revise: 0, reject: 0 };
  for (const assignment of usableList) {
    const disposition = effectiveAssignmentResult(assignment)?.proposedDisposition;
    if (disposition !== undefined) dispositionCounts[disposition] += 1;
  }

  let state: ReviewAggregationState;
  if (pending > 0) {
    state = "pending";
  } else if (usableList.length === 0) {
    state = "insufficient-evidence";
  } else if (usableList.length === 1) {
    state = "single-opinion";
  } else {
    const dispositions = new Set(
      usableList.flatMap((assignment) => {
        const disposition = effectiveAssignmentResult(assignment)?.proposedDisposition;
        return disposition === undefined ? [] : [disposition];
      }),
    );
    state = dispositions.size === 1 ? "agreement" : "disagreement";
  }

  const explanation = explanationForAggregation(state, {
    total,
    pending,
    usable: usableList.length,
    unusable,
    dispositionCounts,
    usableList,
  });

  return {
    total,
    pending,
    usable: usableList.length,
    unusable,
    dispositionCounts,
    state,
    explanation,
  };
}

function explanationForAggregation(
  state: ReviewAggregationState,
  counts: {
    total: number;
    pending: number;
    usable: number;
    unusable: number;
    dispositionCounts: ReviewAggregationView["dispositionCounts"];
    usableList: readonly ReviewAssignmentRecord[];
  },
): string {
  if (state === "pending") {
    return counts.total === 1
      ? "Waiting for the read-only judge to finish. Main decides only after terminal review evidence."
      : `Waiting for ${counts.pending} of ${counts.total} independent judges to finish. Main decides only after every judge is terminal.`;
  }
  if (state === "insufficient-evidence") {
    return counts.total === 1
      ? "The judge result was unusable. Nothing retries automatically; Main must decide from other evidence or start new work."
      : `All ${counts.total} judges finished without usable structured results. Nothing retries automatically; Main must decide from other evidence or start new work.`;
  }
  if (state === "single-opinion") {
    const first = counts.usableList[0];
    const disposition = first === undefined
      ? "unknown"
      : (effectiveAssignmentResult(first)?.proposedDisposition ?? "unknown");
    if (counts.unusable > 0) {
      return `One usable judge suggested ${disposition}; ${counts.unusable} other judge result(s) were unusable. Useful evidence is retained; no replacement judge runs automatically.`;
    }
    return `One usable judge suggested ${disposition}. This is a single opinion, not automatic acceptance.`;
  }
  if (state === "agreement") {
    const first = counts.usableList[0];
    const disposition = first === undefined
      ? "unknown"
      : (effectiveAssignmentResult(first)?.proposedDisposition ?? "unknown");
    return `${counts.usable} usable judges proposed the same disposition (${disposition}). Agreement is evidence only; Main still records the final decision.`;
  }
  // disagreement
  const parts: string[] = [];
  if (counts.dispositionCounts.accept > 0) {
    parts.push(`accept×${counts.dispositionCounts.accept}`);
  }
  if (counts.dispositionCounts.revise > 0) {
    parts.push(`revise×${counts.dispositionCounts.revise}`);
  }
  if (counts.dispositionCounts.reject > 0) {
    parts.push(`reject×${counts.dispositionCounts.reject}`);
  }
  return `Usable judges disagree (${parts.join(", ")}). Every individual opinion remains visible; no automatic vote, winner, or retry. Main must decide.`;
}

function nextActionFor(
  graph: ReviewGraphRecord,
  events: readonly EventRecord[],
  aggregation: ReviewAggregationView,
  assignments: readonly ReviewAssignmentRecord[] = [],
): {
  nextAction: string;
  nextActionCode: ReviewGraphView["nextActionCode"];
  blocksIntegration: boolean;
  requiresFreshMainReview: boolean;
} {
  if (assignments.some(hasActiveReviewResultRepair)) {
    return {
      nextAction:
        "Waiting for the same-Judge schema-only summary repair to finish. Main decides only after that repair is terminal.",
      nextActionCode: "wait-for-result-repair",
      blocksIntegration: true,
      requiresFreshMainReview: false,
    };
  }
  if (graph.status === "pending" || graph.status === "running" || aggregation.state === "pending") {
    return {
      nextAction: aggregation.explanation,
      nextActionCode: "wait-for-judge",
      blocksIntegration: true,
      requiresFreshMainReview: false,
    };
  }
  const mainReview = latestMainReview(events);
  const mainEvent = events
    .filter((e) => e.type === "main-review.completed")
    .reduce<EventRecord | undefined>(
      (latest, e) => (latest === undefined || e.sequence > latest.sequence ? e : latest),
      undefined,
    );
  const terminalSeq = graph.terminalEvidenceSequence;
  const needsFresh =
    terminalSeq !== undefined
    && (mainEvent === undefined || mainEvent.sequence <= terminalSeq);
  if (needsFresh) {
    if (aggregation.state === "insufficient-evidence") {
      return {
        nextAction:
          `${aggregation.explanation} Record a Main accept/revise/reject or start future work explicitly.`,
        nextActionCode: "fresh-main-review-unusable",
        blocksIntegration: true,
        requiresFreshMainReview: true,
      };
    }
    if (aggregation.state === "disagreement") {
      return {
        nextAction:
          `${aggregation.explanation} Record a fresh Main accept/revise/reject after this complete review.`,
        nextActionCode: "fresh-main-review-disagreement",
        blocksIntegration: true,
        requiresFreshMainReview: true,
      };
    }
    return {
      nextAction:
        `${aggregation.explanation} Record a fresh Main accept/revise/reject after this review; judge output is evidence only.`,
      nextActionCode: "fresh-main-review-usable",
      blocksIntegration: true,
      requiresFreshMainReview: true,
    };
  }
  const integrationCompleted = events.some((event) =>
    event.type === "integration.apply.completed"
  );
  if (mainReview?.decision === "accept" && integrationCompleted) {
    return {
      nextAction:
        "This exact Candidate was integrated successfully. No review action remains.",
      nextActionCode: "integrated",
      blocksIntegration: false,
      requiresFreshMainReview: false,
    };
  }
  if (mainReview?.decision === "accept") {
    return {
      nextAction:
        "Fresh Main accept is present. Integration still requires explicit preflight and confirmation.",
      nextActionCode: "ready-for-integration",
      blocksIntegration: false,
      requiresFreshMainReview: false,
    };
  }
  return {
    nextAction:
      "Main may record accept/revise/reject. Judge dispositions are never automatic acceptance.",
    nextActionCode: "main-decision",
    blocksIntegration: false,
    requiresFreshMainReview: false,
  };
}

/** Build a privacy-safe graph projection. Never includes packet path, raw patch,
 *  raw resultText, absolute paths, credentials, or prompts. */
export function projectReviewGraph(
  graph: ReviewGraphRecord,
  assignments: readonly ReviewAssignmentRecord[],
  events: readonly EventRecord[],
): ReviewGraphView {
  const ordered = [...assignments].sort((a, b) => a.ordinal - b.ordinal);
  const aggregation = aggregateReviewAssignments(ordered);
  const nav = nextActionFor(graph, events, aggregation, ordered);
  const maxAssignments = (Math.min(Math.max(graph.maxAssignments, ordered.length), REVIEW_MAX_JUDGES)
    || ordered.length
    || 1) as 1 | 2 | 3;
  return {
    schemaVersion: 1,
    id: graph.id,
    candidateTaskId: graph.candidateTaskId,
    candidateRevisionId: graph.candidateRevisionId,
    attemptOrdinal: graph.attemptOrdinal,
    verificationEventSequence: graph.verificationEventSequence,
    digestPrefix: graph.patchDigest.slice(0, 12),
    status: graph.status,
    round: 1,
    maxAssignments,
    assignments: ordered.map(projectAssignment),
    aggregation,
    createdAt: graph.createdAt,
    updatedAt: graph.updatedAt,
    ...(graph.terminalEvidenceSequence === undefined
      ? {}
      : { terminalEvidenceSequence: graph.terminalEvidenceSequence }),
    blocksIntegration: nav.blocksIntegration,
    requiresFreshMainReview: nav.requiresFreshMainReview,
    nextAction: nav.nextAction,
    nextActionCode: nav.nextActionCode,
  };
}

// --- Integration gates (pure reads) ---

/** Stable reason when a reviewer Task is never product-integratable. */
export const REVIEWER_TASK_NOT_INTEGRATABLE =
  "Reviewer Task evidence is not product code and cannot be integrated";

/** Stable reason when a pending/running review blocks Candidate Integration. */
export const PENDING_REVIEW_BLOCKS_INTEGRATION =
  "Explicit pending judge review blocks Integration until every assigned judge is terminal and Main records a fresh decision";

/** Stable reason when terminal review evidence is newer than Main accept. */
export const STALE_MAIN_ACCEPT_AFTER_REVIEW =
  "Terminal judge review evidence requires a fresh Main accept recorded after every judge finished; older acceptance cannot bypass the review";

/** Stable reason when a declared nonzero requirement has no Review Graph. */
export const REQUIRED_REVIEW_GRAPH_MISSING =
  "Required Review Graph is missing; Integration needs the declared independent judges first";

/** Stable reason when assigned judges are fewer than requiredJudges. */
export const REQUIRED_REVIEW_GRAPH_UNDERSIZED =
  "Required Review Graph is undersized: fewer independent assignments than requiredJudges";

/** Stable reason when usable terminal opinions are fewer than requiredJudges. */
export const REQUIRED_REVIEW_GRAPH_INSUFFICIENT_USABLE =
  "Required Review Graph is undersized: fewer usable terminal independent opinions than requiredJudges";

/** Stable reason when the graph is not bound to the current exact revision. */
export const REQUIRED_REVIEW_GRAPH_STALE =
  "Required Review Graph is stale: it is not bound to the current exact Candidate Revision";

/** True when this Task id is a linked reviewer Task (never integratable). */
export function isReviewerTask(store: StateStore, taskId: string): boolean {
  return store.getReviewAssignmentByReviewerTaskId(taskId) !== undefined
    || store.getReviewAssignmentByRepairTaskId(taskId) !== undefined;
}

function latestMainReviewEvent(
  events: readonly EventRecord[],
): EventRecord | undefined {
  return events
    .filter((event) => event.type === "main-review.completed")
    .reduce<EventRecord | undefined>(
      (latest, event) =>
        latest === undefined || event.sequence > latest.sequence ? event : latest,
      undefined,
    );
}

function existingGraphRejectionReasons(
  graph: ReviewGraphRecord,
  events: readonly EventRecord[],
  assignments: readonly ReviewAssignmentRecord[] = [],
): string[] {
  if (assignments.some(hasActiveReviewResultRepair)) {
    return [PENDING_REVIEW_BLOCKS_INTEGRATION, PENDING_RESULT_REPAIR_BLOCKS_INTEGRATION];
  }
  if (graph.status === "pending" || graph.status === "running") {
    return [PENDING_REVIEW_BLOCKS_INTEGRATION];
  }
  if (graph.terminalEvidenceSequence === undefined) return [];
  const mainEvent = latestMainReviewEvent(events);
  if (mainEvent === undefined || mainEvent.sequence <= graph.terminalEvidenceSequence) {
    return [STALE_MAIN_ACCEPT_AFTER_REVIEW];
  }
  return [];
}

/**
 * When a legacy or explicit-skip Task already has a Review Graph, that graph
 * keeps Integration authority. Surface pending / stale-main-accept so the
 * decision packet never recommends Integration while preflight would block.
 */
function statusForOptionalGraph(
  base: "not-declared" | "explicit-skip",
  graphReasons: readonly string[],
): ReviewRequirementGate["status"] {
  if (graphReasons.includes(PENDING_REVIEW_BLOCKS_INTEGRATION)) return "pending";
  if (graphReasons.includes(STALE_MAIN_ACCEPT_AFTER_REVIEW)) return "stale-main-accept";
  return base;
}

function emptyGate(partial: Partial<ReviewRequirementGate> & Pick<ReviewRequirementGate, "status">): ReviewRequirementGate {
  return {
    declared: false,
    assigned: 0,
    terminal: 0,
    usableTerminal: 0,
    missingOpinions: 0,
    blocksIntegration: false,
    rejectionReasons: [],
    ...partial,
  };
}

/** Compare a frozen review requirement with the current exact revision and graph.
 *  Pure: never creates Judges, never votes, never mutates. */
export function evaluateReviewRequirementGate(input: {
  reviewRequirement?: TaskReviewRequirement;
  currentRevisionId?: string;
  graph?: ReviewGraphRecord;
  assignments?: readonly ReviewAssignmentRecord[];
  events?: readonly EventRecord[];
}): ReviewRequirementGate {
  const requirement = input.reviewRequirement;
  const assignments = [...(input.assignments ?? [])].sort((a, b) => a.ordinal - b.ordinal);
  const assigned = assignments.length;
  const terminal = assignments.filter(isAssignmentTerminal).length;
  const usableTerminal = assignments.filter(isAssignmentUsable).length;
  const events = input.events ?? [];
  const graphReasons = input.graph === undefined
    ? []
    : existingGraphRejectionReasons(input.graph, events, assignments);

  if (requirement === undefined) {
    return emptyGate({
      status: statusForOptionalGraph("not-declared", graphReasons),
      assigned,
      terminal,
      usableTerminal,
      ...(input.currentRevisionId === undefined ? {} : { currentRevisionId: input.currentRevisionId }),
      ...(input.graph === undefined ? {} : { graphRevisionId: input.graph.candidateRevisionId }),
      blocksIntegration: graphReasons.length > 0,
      rejectionReasons: graphReasons,
    });
  }

  const declaredBase = {
    declared: true as const,
    requiredJudges: requirement.requiredJudges,
    reason: requirement.reason,
    assigned,
    terminal,
    usableTerminal,
    ...(input.currentRevisionId === undefined ? {} : { currentRevisionId: input.currentRevisionId }),
    ...(input.graph === undefined ? {} : { graphRevisionId: input.graph.candidateRevisionId }),
  };

  if (requirement.requiredJudges === 0) {
    return {
      ...declaredBase,
      status: statusForOptionalGraph("explicit-skip", graphReasons),
      missingOpinions: 0,
      blocksIntegration: graphReasons.length > 0,
      rejectionReasons: graphReasons,
    };
  }

  const required = requirement.requiredJudges;
  if (input.graph === undefined) {
    return {
      ...declaredBase,
      status: "missing",
      missingOpinions: required,
      blocksIntegration: true,
      rejectionReasons: [REQUIRED_REVIEW_GRAPH_MISSING],
    };
  }

  const reasons: string[] = [];
  let status: ReviewRequirementGate["status"] = "satisfied";
  if (
    input.currentRevisionId !== undefined
    && input.graph.candidateRevisionId !== input.currentRevisionId
  ) {
    status = "stale";
    reasons.push(REQUIRED_REVIEW_GRAPH_STALE);
  }
  if (assigned < required && status !== "stale") {
    status = "undersized";
    reasons.push(REQUIRED_REVIEW_GRAPH_UNDERSIZED);
  }
  const pending = input.graph.status === "pending"
    || input.graph.status === "running"
    || terminal < assigned
    || assignments.some(hasActiveReviewResultRepair);
  if (pending && status === "satisfied") {
    status = "pending";
    reasons.push(PENDING_REVIEW_BLOCKS_INTEGRATION);
  } else if (pending && !reasons.includes(PENDING_REVIEW_BLOCKS_INTEGRATION)) {
    reasons.push(PENDING_REVIEW_BLOCKS_INTEGRATION);
  }
  if (!pending && usableTerminal < required && status !== "stale") {
    if (status === "satisfied") status = "undersized";
    if (!reasons.includes(REQUIRED_REVIEW_GRAPH_UNDERSIZED)
      && !reasons.includes(REQUIRED_REVIEW_GRAPH_INSUFFICIENT_USABLE)) {
      reasons.push(REQUIRED_REVIEW_GRAPH_INSUFFICIENT_USABLE);
    }
  }
  if (!pending && graphReasons.includes(STALE_MAIN_ACCEPT_AFTER_REVIEW)) {
    if (status === "satisfied") status = "stale-main-accept";
    if (!reasons.includes(STALE_MAIN_ACCEPT_AFTER_REVIEW)) {
      reasons.push(STALE_MAIN_ACCEPT_AFTER_REVIEW);
    }
  } else if (pending && graphReasons.includes(PENDING_REVIEW_BLOCKS_INTEGRATION)
    && !reasons.includes(PENDING_REVIEW_BLOCKS_INTEGRATION)) {
    reasons.push(PENDING_REVIEW_BLOCKS_INTEGRATION);
  }

  const missingOpinions = Math.max(0, required - usableTerminal);
  return {
    ...declaredBase,
    status,
    missingOpinions,
    blocksIntegration: reasons.length > 0,
    rejectionReasons: reasons,
  };
}

/** Non-mutating Review Graph projection for read surfaces. */
export function readReviewGraphView(
  store: StateStore,
  candidateTaskId: string,
): ReviewGraphView | undefined {
  const graph = store.getReviewGraphByCandidateTaskId(candidateTaskId);
  if (graph === undefined) return undefined;
  return projectReviewGraph(
    graph,
    store.listReviewAssignments(graph.id),
    store.listEvents(candidateTaskId),
  );
}

/** Store-backed exact-revision review gate. Read-only. */
export function evaluateReviewRequirementForTask(
  store: StateStore,
  candidateTaskId: string,
): ReviewRequirementGate {
  const task = store.getTask(candidateTaskId);
  const events = store.listEvents(candidateTaskId);
  const graph = store.getReviewGraphByCandidateTaskId(candidateTaskId);
  const assignments = graph === undefined ? [] : store.listReviewAssignments(graph.id);
  const latestRevision = resolveLatestRevision(events);
  return evaluateReviewRequirementGate({
    ...(task.spec.reviewRequirement === undefined
      ? {}
      : { reviewRequirement: task.spec.reviewRequirement }),
    ...(latestRevision === undefined ? {} : { currentRevisionId: latestRevision.id }),
    ...(graph === undefined ? {} : { graph }),
    assignments,
    events,
  });
}

/** Collect Integration rejection reasons from the declared review requirement
 *  and any Review Graph linked to the Candidate Task. Legacy Tasks without a
 *  requirement keep the existing missing-graph-is-not-a-gate behavior. */
export function reviewGraphIntegrationReasons(
  store: StateStore,
  candidateTaskId: string,
): string[] {
  return [...evaluateReviewRequirementForTask(store, candidateTaskId).rejectionReasons];
}

// --- Packet construction ---

interface ReviewPacket {
  schemaVersion: typeof REVIEW_PACKET_SCHEMA_VERSION;
  kind: "candidate-review-packet";
  reviewedRevisionId: string;
  candidateTaskId: string;
  attemptOrdinal: number;
  verificationEventSequence: number;
  verificationPassed: boolean;
  patchDigest: string;
  affectedPaths: string[];
  filesChanged: number;
  changedLines: number;
  contractOutcome?: string;
  acceptanceCriteria: string[];
  patch: string;
  requiredOutputSchema: {
    schemaVersion: 1;
    reviewedRevisionId: string;
    proposedDisposition: "accept" | "revise" | "reject";
    summary: string;
    findings: Array<{
      severity: "info" | "warning" | "error";
      evidencePath: string;
      affectedBehavior: string;
      recommendation: string;
    }>;
  };
  /** Exact parser field limits; single source of truth with parseReviewResultText. */
  outputLimits: {
    summaryMaxChars: typeof REVIEW_SUMMARY_MAX;
    findingTextMaxChars: typeof REVIEW_FINDING_TEXT_MAX;
    evidencePathMaxChars: typeof REVIEW_EVIDENCE_PATH_MAX;
    maxFindings: typeof REVIEW_MAX_FINDINGS;
  };
  rules: {
    readOnly: true;
    noEdits: true;
    noIntegration: true;
    noMainDecision: true;
    noLaunchWork: true;
    stopAfterOneResult: true;
    maxFindings: typeof REVIEW_MAX_FINDINGS;
  };
}

async function buildReviewPacket(
  candidate: TaskRecord,
  revision: {
    id: string;
    attemptOrdinal: number;
    verificationEventSequence: number;
    patchDigest: string;
    affectedPaths: string[];
    filesChanged: number;
    changedLines: number;
    verificationPassed: boolean;
  },
): Promise<ReviewPacket> {
  const artifact = privateArtifactPath(candidate, revision.id);
  let patchBytes: Buffer;
  try {
    patchBytes = await readFile(artifact);
  } catch {
    throw new Error(
      "review graph rejected: private Candidate Revision artifact is missing; produce a fresh revision",
    );
  }
  if (sha256(patchBytes) !== revision.patchDigest) {
    throw new Error(
      "review graph rejected: private Candidate Revision artifact digest mismatch; produce a fresh revision",
    );
  }

  const acceptanceCriteria =
    candidate.spec.version !== 1
      ? [...candidate.spec.acceptance.criteria].slice(0, 20).map((c) => c.slice(0, 300))
      : [];
  const contractOutcome =
    candidate.spec.version === 1
      ? candidate.spec.goal.slice(0, 500)
      : candidate.spec.contract.outcome.slice(0, 500);

  return {
    schemaVersion: REVIEW_PACKET_SCHEMA_VERSION,
    kind: "candidate-review-packet",
    reviewedRevisionId: revision.id,
    candidateTaskId: candidate.id,
    attemptOrdinal: revision.attemptOrdinal,
    verificationEventSequence: revision.verificationEventSequence,
    verificationPassed: revision.verificationPassed,
    patchDigest: revision.patchDigest,
    affectedPaths: [...revision.affectedPaths],
    filesChanged: revision.filesChanged,
    changedLines: revision.changedLines,
    contractOutcome,
    acceptanceCriteria,
    patch: patchBytes.toString("utf8"),
    requiredOutputSchema: {
      schemaVersion: 1,
      reviewedRevisionId: revision.id,
      proposedDisposition: "accept",
      summary: `trimmed summary, 1-${REVIEW_SUMMARY_MAX} characters`,
      findings: [{
        severity: "info",
        evidencePath: `relative/path, 1-${REVIEW_EVIDENCE_PATH_MAX} characters`,
        affectedBehavior: `trimmed text, 1-${REVIEW_FINDING_TEXT_MAX} characters`,
        recommendation: `trimmed text, 1-${REVIEW_FINDING_TEXT_MAX} characters`,
      }],
    },
    outputLimits: {
      summaryMaxChars: REVIEW_SUMMARY_MAX,
      findingTextMaxChars: REVIEW_FINDING_TEXT_MAX,
      evidencePathMaxChars: REVIEW_EVIDENCE_PATH_MAX,
      maxFindings: REVIEW_MAX_FINDINGS,
    },
    rules: {
      readOnly: true,
      noEdits: true,
      noIntegration: true,
      noMainDecision: true,
      noLaunchWork: true,
      stopAfterOneResult: true,
      maxFindings: REVIEW_MAX_FINDINGS,
    },
  };
}

async function writePrivatePacket(
  candidate: TaskRecord,
  graphId: string,
  packet: ReviewPacket,
): Promise<string> {
  const packetPath = privatePacketPath(candidate, graphId);
  await mkdir(path.dirname(packetPath), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(packetPath), 0o700);
  await writeFile(packetPath, JSON.stringify(packet, null, 2), { mode: 0o600, flag: "wx" });
  await chmod(packetPath, 0o600);
  return packetPath;
}

/** Isolated reviewer project: only the packet, never original source paths. */
async function writeReviewerProject(
  home: string,
  graphId: string,
  assignmentId: string,
  packet: ReviewPacket,
  revisionId: string,
): Promise<string> {
  const projectDir = reviewerProjectDir(home, graphId, assignmentId);
  await mkdir(projectDir, { recursive: true, mode: 0o700 });
  await chmod(projectDir, 0o700);
  const projectPacket = path.join(projectDir, "REVIEW_PACKET.json");
  await writeFile(projectPacket, JSON.stringify(packet, null, 2), { mode: 0o600, flag: "wx" });
  await chmod(projectPacket, 0o600);
  const instructions = [
    "Read-only Candidate Revision review.",
    "Inspect REVIEW_PACKET.json only.",
    "Do not edit files, run product commands, integrate, commit, or push.",
    "Return exactly one JSON object matching requiredOutputSchema and outputLimits.",
    `reviewedRevisionId must be exactly: ${revisionId}`,
    reviewerOutputBoundsLine(),
    "Relative evidence paths only. No credentials, absolute paths, or extra fields.",
    "Your proposedDisposition is evidence for Main; Main decides.",
  ].join("\n");
  await writeFile(path.join(projectDir, "INSTRUCTIONS.md"), `${instructions}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  return projectDir;
}

function buildReviewerSpec(
  candidate: TaskRecord,
  projectDir: string,
  selection: ReturnType<typeof resolveWorkerSelection>,
  revisionId: string,
): ContractTaskSpec {
  const defaultExecutable = defaultExecutableForRuntime(selection.runtime);
  const spec: ContractTaskSpec = {
    version: 2,
    name: `Read-only review of ${candidate.name}`.slice(0, 120),
    project: projectDir,
    ...(selection.profileId === undefined ? {} : { workerProfileId: selection.profileId }),
    contract: {
      outcome:
        "Return exactly one structured JSON review of the immutable Candidate Revision packet without editing any files.",
      presentation: {
        summary: "只读裁判审查候选版本并返回结构化 JSON；不得修改文件。",
        language: "zh-CN",
      },
      context: [
        "REVIEW_PACKET.json contains the exact immutable patch and bounded verification facts.",
        "This Task is permanently non-integratable evidence for Main.",
      ],
      inScope: [
        "Read REVIEW_PACKET.json and INSTRUCTIONS.md",
        "Emit one JSON object with schemaVersion, reviewedRevisionId, proposedDisposition, summary, findings",
      ],
      outOfScope: [
        "Editing files",
        "Launching work",
        "Integration, commit, push",
        "Automatic Main decisions",
      ],
      executionSteps: [
        "Open REVIEW_PACKET.json",
        "Evaluate the exact patch against the bounded contract facts",
        "Return exactly one strict JSON result and stop",
      ],
      deliverables: [
        "One structured JSON judge result in the terminal result text",
      ],
      modules: [
        {
          name: "Read-only judge",
          responsibility: "Inspect the review packet and emit bounded findings",
          consumes: ["REVIEW_PACKET.json"],
          produces: ["structured review JSON"],
          boundaries: ["No edits", "No Integration", "No Main decision"],
        },
      ],
      callChain: [
        "Read packet",
        "Assess patch",
        "Emit JSON result",
      ],
      scenarios: [
        {
          name: "Valid review",
          given: "A complete review packet",
          when: "The judge finishes",
          then: "Exactly one schema-valid JSON object is returned",
        },
      ],
      risks: [
        "Unstructured prose is rejected",
        "Extra fields or absolute paths fail closed",
      ],
      changeBudget: { maxFiles: 1, maxDiffLines: 1 },
    },
    provider: {
      name: selection.provider as ContractTaskSpec["provider"]["name"],
      model: selection.model,
      keychainService: selection.keychainService,
      endpoint: selection.endpoint,
      ...(selection.pricingRoute === undefined ? {} : { pricingRoute: selection.pricingRoute }),
    },
    runtime: {
      name: selection.runtime,
      executable: defaultExecutable,
      effort: selection.effort,
      maxBudgetUsd: selection.maxBudgetUsd,
    },
    workspace: { exclude: [] },
    worker: {
      allowEdits: false,
      allowedCommands: [],
      focusPaths: ["REVIEW_PACKET.json", "INSTRUCTIONS.md"],
    },
    acceptance: {
      criteria: [
        `Emit one JSON review for revision ${revisionId}`,
        "Do not modify any files",
      ],
      commands: ["true"],
    },
    advancedPolicyOverride: {
      baseMaxAttempts: 1,
      maxExtraAttempts: 0,
      maxMainCorrections: 0,
      maxAdaptationRounds: 0,
      maxMainReverifications: 0,
    },
    completionPolicy: {
      noChangeMode: "off",
      changeBudgetMode: "warn",
    },
  };
  // Freeze the reviewer Profile's network policy (or clear it for legacy
  // inherit) so read-only judges never fall back to a different environment.
  return applyResolvedNetworkPolicy(selection, spec);
}

// --- Create ---

function validateCreateInput(input: CreateReviewGraphInput): {
  reason: string;
  profileIds: string[];
} {
  if (input.confirm !== true) {
    throw new Error("review graph requires confirm: true");
  }
  const profileIds = normalizeReviewerProfileIds(input);
  if (typeof input.reason !== "string") {
    throw new Error("review graph reason must be a string");
  }
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > REVIEW_REASON_MAX_LENGTH) {
    throw new Error(
      `review graph reason must be 1-${REVIEW_REASON_MAX_LENGTH} characters`,
    );
  }
  if (containsUnsafeCredentialValue(reason)) {
    throw new Error("review graph reason must not contain credentials");
  }
  return { reason, profileIds };
}

function orderedProfileIds(assignments: readonly ReviewAssignmentRecord[]): string[] {
  return [...assignments]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((a) => a.reviewerWorkerProfileId);
}

function sameOrderedProfileSet(
  existing: readonly string[],
  requested: readonly string[],
): boolean {
  if (existing.length !== requested.length) return false;
  return existing.every((id, index) => id === requested[index]);
}

/** Create one Review Graph + 1–3 read-only reviewer Tasks for the latest valid
 *  Candidate Revision. Idempotent for the same exact revision + ordered profile set. */
export async function createReviewGraph(
  store: StateStore,
  settings: ForkLightSettings,
  input: CreateReviewGraphInput,
): Promise<CreateReviewGraphResult> {
  const { reason, profileIds } = validateCreateInput(input);
  const candidate = store.getTask(input.candidateTaskId);

  if (isReviewerTask(store, candidate.id)) {
    throw new Error("review graph rejected: a reviewer Task cannot itself be reviewed");
  }
  if (candidate.status !== "succeeded") {
    throw new Error("review graph requires a succeeded Candidate Task with retained revision evidence");
  }

  const events = store.listEvents(candidate.id);
  const revision = resolveLatestRevision(events);
  if (revision === undefined || revision.taskId !== candidate.id) {
    throw new Error(
      "review graph rejected: no Candidate Revision evidence; produce a fresh revision first",
    );
  }
  if (!candidateRevisionMatchesCurrentDiff(candidate, revision)) {
    throw new Error(
      "review graph rejected: latest Candidate Revision no longer matches the retained Diff; produce a fresh revision",
    );
  }
  const verification = latestVerificationEvent(events);
  if (
    verification === undefined
    || verification.attemptId !== revision.attemptId
    || verification.sequence !== revision.verificationEventSequence
  ) {
    throw new Error(
      "review graph rejected: Candidate Revision is not bound to the latest verification evidence; produce a fresh revision",
    );
  }
  if (candidate.currentAttemptId !== undefined
    && revision.attemptId !== candidate.currentAttemptId) {
    throw new Error(
      "review graph rejected: Candidate Revision does not belong to the current Attempt",
    );
  }

  // Idempotent: existing graph for this exact revision + same ordered judge set.
  const existing = store.getReviewGraphByCandidateRevisionId(revision.id);
  if (existing !== undefined) {
    const assignments = store.listReviewAssignments(existing.id);
    const existingProfiles = orderedProfileIds(assignments);
    if (sameOrderedProfileSet(existingProfiles, profileIds)) {
      const reviewerTaskIds = [...assignments]
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((a) => a.reviewerTaskId);
      return {
        graph: projectReviewGraph(existing, assignments, events),
        reviewerTaskId: reviewerTaskIds[0]!,
        reviewerTaskIds,
        created: false,
      };
    }
    throw new Error(
      "review graph rejected: this Candidate Revision already has a different or reordered judge set; the frozen set cannot be changed",
    );
  }

  // Resolve every explicit saved Worker Profile before any durable mutation.
  const selections = profileIds.map((profileId) => {
    getWorkerProfile(settings.workerProfiles, profileId);
    const selection = resolveWorkerSelection(
      { workerProfileId: profileId },
      {
        execution: settings.execution,
        providerDefaults: settings.providerDefaults,
        workerProfiles: settings.workerProfiles,
        modelCatalog: settings.modelCatalog,
      },
    );
    if (selection.profileId !== profileId) {
      throw new Error("review graph rejected: reviewer Worker Profile resolution mismatch");
    }
    return selection;
  });

  const home = path.dirname(store.databasePath);
  const graphId = randomUUID();
  const now = timestamp();
  const packet = await buildReviewPacket(candidate, revision);
  const packetPath = await writePrivatePacket(candidate, graphId, packet);

  const assignmentIds: string[] = [];
  const assignments: ReviewAssignmentRecord[] = [];
  const reviewerTasks: TaskRecord[] = [];
  const assignmentEvents: Array<{
    summary: string;
    payload?: Record<string, unknown>;
  }> = [];
  const reviewerCreationEvents: Array<{
    summary: string;
    payload?: Record<string, unknown>;
  }> = [];

  // Lazy import avoids a static cycle: review-graph → runner → task → review-graph
  // (task imports reviewerOutputBoundsLine for terminal instructions).
  const { buildTaskRecord } = await import("./runner.js");

  for (let index = 0; index < profileIds.length; index += 1) {
    const profileId = profileIds[index]!;
    const selection = selections[index]!;
    const assignmentId = randomUUID();
    const reviewerTaskId = randomUUID();
    const ordinal = index + 1;
    assignmentIds.push(assignmentId);

    const projectDir = await writeReviewerProject(
      home,
      graphId,
      assignmentId,
      packet,
      revision.id,
    );
    const reviewerSpec = buildReviewerSpec(candidate, projectDir, selection, revision.id);
    const capabilities = enforcementCapabilityForRuntime(reviewerSpec.runtime.name);
    const effectivePolicy: EffectivePolicySnapshot = resolveTaskEffectivePolicy(
      reviewerSpec,
      settings,
      capabilities,
    );
    // Enforce single Attempt / no correction even if profile overrides expand.
    const frozenPolicy: EffectivePolicySnapshot = {
      ...effectivePolicy,
      values: {
        ...effectivePolicy.values,
        baseMaxAttempts: 1,
        maxExtraAttempts: 0,
        maxMainCorrections: 0,
        maxAdaptationRounds: 0,
        maxMainReverifications: 0,
      },
    };

    const frozenIdentity: FrozenWorkerIdentity = {
      provider: selection.provider,
      model: selection.model,
      runtime: selection.runtime,
      effort: selection.effort,
      workerProfileId: profileId,
    };

    const reviewerTask = buildTaskRecord({
      spec: reviewerSpec as TaskSpec,
      taskFile: `forklight://review-graph/${graphId}/assignment/${assignmentId}`,
      home,
      id: reviewerTaskId,
      sessionId: randomUUID(),
      createdAt: now,
      effectivePolicy: frozenPolicy,
    });
    reviewerTasks.push(reviewerTask);

    assignments.push({
      id: assignmentId,
      graphId,
      ordinal,
      candidateTaskId: candidate.id,
      candidateRevisionId: revision.id,
      reviewerWorkerProfileId: profileId,
      reviewerTaskId,
      status: "queued",
      reason,
      frozenIdentity,
      createdAt: now,
      updatedAt: now,
      privatePacketPath: packetPath,
    });

    assignmentEvents.push({
      summary:
        profileIds.length === 1
          ? `Read-only judge review assigned for revision ${summarizeRevision(revision).digestPrefix}`
          : `Read-only judge ${ordinal}/${profileIds.length} assigned for revision ${summarizeRevision(revision).digestPrefix}`,
      payload: {
        graphId,
        assignmentId,
        ordinal,
        candidateRevisionId: revision.id,
        reviewerTaskId,
        reviewerWorkerProfileId: profileId,
        frozenIdentity,
        judgeCount: profileIds.length,
      },
    });
    reviewerCreationEvents.push({
      summary: `Reviewer Task created for Candidate ${candidate.id}`,
      payload: {
        graphId,
        assignmentId,
        ordinal,
        candidateTaskId: candidate.id,
        candidateRevisionId: revision.id,
        reviewerWorkerProfileId: profileId,
        allowEdits: false,
      },
    });
  }

  const maxAssignments = profileIds.length as 1 | 2 | 3;
  const graph: ReviewGraphRecord = {
    schemaVersion: 1,
    id: graphId,
    candidateTaskId: candidate.id,
    candidateRevisionId: revision.id,
    attemptId: revision.attemptId,
    attemptOrdinal: revision.attemptOrdinal,
    verificationEventSequence: revision.verificationEventSequence,
    patchDigest: revision.patchDigest,
    status: "pending",
    round: 1,
    maxAssignments,
    assignmentIds,
    createdAt: now,
    updatedAt: now,
    privatePacketPath: packetPath,
  };

  store.createReviewGraphExecution({
    graph,
    assignments,
    reviewerTasks,
    assignmentEvents,
    reviewerCreationEvents,
  });

  const reviewerTaskIds = assignments.map((a) => a.reviewerTaskId);
  const freshEvents = store.listEvents(candidate.id);
  return {
    graph: projectReviewGraph(graph, assignments, freshEvents),
    reviewerTaskId: reviewerTaskIds[0]!,
    reviewerTaskIds,
    created: true,
  };
}

// --- Reconcile terminal reviewer Tasks ---

function mapAssignmentStatusFromTask(
  taskStatus: TaskRecord["status"],
): ReviewAssignmentStatus | "active" {
  if (taskStatus === "queued" || taskStatus === "waiting" || taskStatus === "blocked") {
    return "queued";
  }
  if (
    taskStatus === "preparing"
    || taskStatus === "running"
    || taskStatus === "verifying"
  ) {
    return "running";
  }
  if (taskStatus === "succeeded" || taskStatus === "failed" || taskStatus === "interrupted") {
    return taskStatus === "succeeded" ? "completed" : "failed";
  }
  return "active";
}

function graphStatusFromAssignments(
  assignments: readonly ReviewAssignmentRecord[],
): ReviewGraphStatus {
  if (assignments.some((a) => a.status === "queued" || a.status === "running")) {
    return assignments.some((a) => a.status === "running") ? "running" : "pending";
  }
  // All terminal: completed when any usable result remains; failed only when none usable.
  if (assignments.some(isAssignmentUsable)) {
    return "completed";
  }
  return "failed";
}

/** Reconcile one assignment from its linked reviewer Task terminal state.
 *  Idempotent: already-terminal assignments are left unchanged. */
export function reconcileReviewAssignment(
  store: StateStore,
  assignmentId: string,
): ReviewAssignmentRecord {
  const assignment = store.getReviewAssignment(assignmentId);
  if (assignment.status === "completed" || assignment.status === "failed") {
    return assignment;
  }

  const reviewerTask = store.getTask(assignment.reviewerTaskId);
  const mapped = mapAssignmentStatusFromTask(reviewerTask.status);

  if (mapped === "queued" || mapped === "running" || mapped === "active") {
    if (mapped === "running" && assignment.status !== "running") {
      const updated: ReviewAssignmentRecord = {
        ...assignment,
        status: "running",
        updatedAt: timestamp(),
      };
      const graph = store.getReviewGraph(assignment.graphId);
      store.updateReviewAssignmentAndGraph(updated, {
        ...graph,
        status: "running",
        updatedAt: updated.updatedAt,
      });
      return updated;
    }
    return assignment;
  }

  // Terminal reviewer Task — parse once.
  const now = timestamp();
  let result: ReviewResult | undefined;
  let failureCode: ReviewResultFailureCode | undefined;
  let status: ReviewAssignmentStatus = "failed";

  if (reviewerTask.status === "succeeded") {
    const attempts = store.listAttempts(reviewerTask.id);
    const latest = attempts.reduce<typeof attempts[number] | undefined>(
      (best, a) => (best === undefined || a.ordinal > best.ordinal ? a : best),
      undefined,
    );
    try {
      result = parseReviewResultText(
        latest?.resultText,
        assignment.candidateRevisionId,
        assignment.reviewerTaskId,
        reviewerTask.id,
      );
      status = "completed";
    } catch (error) {
      failureCode = error instanceof ReviewParseError
        ? error.code
        : "schema-violation";
      status = "failed";
    }
  } else {
    failureCode = "reviewer-task-failed";
    status = "failed";
  }

  const completed: ReviewAssignmentRecord = {
    ...assignment,
    status,
    updatedAt: now,
    completedAt: now,
    ...(result === undefined ? {} : { result }),
    ...(failureCode === undefined ? {} : { failureCode }),
  };

  // Prefer an existing terminal event for this assignment (crash recovery) so
  // creation/completion stay idempotent and never invent a second round.
  const existingTerminal = store.listEvents(assignment.candidateTaskId).find((event) => {
    if (event.type !== "review.assignment.completed" && event.type !== "review.assignment.failed") {
      return false;
    }
    const payload = event.payload as { assignmentId?: unknown } | undefined;
    return payload?.assignmentId === assignment.id;
  });

  const eventType = status === "completed" ? "review.assignment.completed" : "review.assignment.failed";
  const event = existingTerminal ?? store.addEvent(
    assignment.candidateTaskId,
    undefined,
    eventType,
    status === "completed"
      ? `Read-only judge completed for revision ${assignment.candidateRevisionId.slice(0, 8)}`
      : `Read-only judge failed (${failureCode ?? "unknown"}) for revision ${assignment.candidateRevisionId.slice(0, 8)}`,
    {
      graphId: assignment.graphId,
      assignmentId: assignment.id,
      candidateRevisionId: assignment.candidateRevisionId,
      reviewerTaskId: assignment.reviewerTaskId,
      reviewerWorkerProfileId: assignment.reviewerWorkerProfileId,
      status,
      resultUsable: result !== undefined,
      ...(failureCode === undefined ? {} : { failureCode }),
      ...(result === undefined
        ? {}
        : {
            proposedDisposition: result.proposedDisposition,
            findingCount: result.findings.length,
          }),
    },
  );

  const graph = store.getReviewGraph(assignment.graphId);
  const allAssignments = store.listReviewAssignments(graph.id).map((a) =>
    a.id === completed.id ? completed : a,
  );
  const allTerminal = allAssignments.every(isAssignmentTerminal);
  // Terminal graph evidence is written exactly once, only when every judge is terminal.
  // Closing early after the first judge would let stale Main evidence bypass remaining judges.
  const terminalEvidenceSequence = allTerminal
    ? (graph.terminalEvidenceSequence ?? event.sequence)
    : graph.terminalEvidenceSequence;
  const nextGraph: ReviewGraphRecord = {
    ...graph,
    status: graphStatusFromAssignments(allAssignments),
    updatedAt: now,
    ...(terminalEvidenceSequence === undefined
      ? {}
      : { terminalEvidenceSequence }),
  };
  // Keep private packet paths for audit only; never project them.
  store.updateReviewAssignmentAndGraph(completed, nextGraph);
  return completed;
}

/** Reconcile every non-terminal Review Graph whose reviewer Tasks may have
 *  finished (normal completion or daemon restart). Also reconciles active
 *  result repairs even when the Graph is already terminal. Idempotent. */
export function reconcileAllReviewGraphs(store: StateStore): string[] {
  const reconciled: string[] = [];
  for (const graph of store.listReviewGraphs(["pending", "running"])) {
    const assignments = store.listReviewAssignments(graph.id);
    for (const assignment of assignments) {
      if (assignment.status === "completed" || assignment.status === "failed") continue;
      const before = assignment.status;
      const after = reconcileReviewAssignment(store, assignment.id);
      if (after.status !== before || after.completedAt !== undefined) {
        reconciled.push(assignment.id);
      }
    }
  }
  for (const assignment of store.listReviewAssignmentsWithActiveResultRepair()) {
    const before = assignment.resultRepair?.status;
    const after = reconcileReviewResultRepair(store, assignment.id);
    if (after.resultRepair?.status !== before) {
      reconciled.push(assignment.id);
    }
  }
  return reconciled;
}

/** Reconcile the graph linked to a finished Task if it is a reviewer or repair Task. */
export function reconcileReviewGraphForTask(
  store: StateStore,
  taskId: string,
): ReviewGraphView | undefined {
  const byRepair = store.getReviewAssignmentByRepairTaskId(taskId);
  if (byRepair !== undefined) {
    reconcileReviewResultRepair(store, byRepair.id);
    const graph = store.getReviewGraph(byRepair.graphId);
    const assignments = store.listReviewAssignments(graph.id);
    return projectReviewGraph(graph, assignments, store.listEvents(graph.candidateTaskId));
  }
  const assignment = store.getReviewAssignmentByReviewerTaskId(taskId);
  if (assignment === undefined) return undefined;
  reconcileReviewAssignment(store, assignment.id);
  const graph = store.getReviewGraph(assignment.graphId);
  const assignments = store.listReviewAssignments(graph.id);
  return projectReviewGraph(graph, assignments, store.listEvents(graph.candidateTaskId));
}

/** Read-only status projection for a Candidate Task's Review Graph. */
export function getReviewGraphStatus(
  store: StateStore,
  candidateTaskId: string,
): ReviewGraphView | undefined {
  // Best-effort reconcile before projecting so status is current after restart.
  const graph = store.getReviewGraphByCandidateTaskId(candidateTaskId);
  if (graph === undefined) return undefined;
  for (const assignment of store.listReviewAssignments(graph.id)) {
    if (assignment.status !== "completed" && assignment.status !== "failed") {
      try {
        reconcileReviewAssignment(store, assignment.id);
      } catch {
        // Projection must remain readable even if a concurrent race fails.
      }
    }
    if (hasActiveReviewResultRepair(assignment)) {
      try {
        reconcileReviewResultRepair(store, assignment.id);
      } catch {
        // Projection must remain readable even if a concurrent race fails.
      }
    }
  }
  const fresh = store.getReviewGraphByCandidateTaskId(candidateTaskId);
  if (fresh === undefined) return undefined;
  return projectReviewGraph(
    fresh,
    store.listReviewAssignments(fresh.id),
    store.listEvents(candidateTaskId),
  );
}

export interface RepairReviewResultInput {
  candidateTaskId: string;
  assignmentId: string;
  reason: string;
  confirm: true;
}

export interface RepairReviewResultResult {
  graph: ReviewGraphView;
  assignmentId: string;
  repairTaskId: string;
  created: true;
  originalFailureCode: ReviewResultFailureCode;
}

function validateRepairInput(input: RepairReviewResultInput): { reason: string } {
  if (input.confirm !== true) {
    throw new Error("review result repair requires confirm: true");
  }
  if (typeof input.reason !== "string") {
    throw new Error("review result repair reason must be a string");
  }
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > REVIEW_REASON_MAX_LENGTH) {
    throw new Error(
      `review result repair reason must be 1-${REVIEW_REASON_MAX_LENGTH} characters`,
    );
  }
  if (containsUnsafeCredentialValue(reason)) {
    throw new Error("review result repair reason must not contain credentials");
  }
  return { reason };
}

function repairProjectDir(home: string, graphId: string, assignmentId: string): string {
  return path.join(home, "review-projects", graphId, assignmentId, "result-repair");
}

/** Exact original packet bytes, or fail closed. Does not parse beyond JSON validity. */
function readExactPrivatePacket(
  assignment: ReviewAssignmentRecord,
): { ok: true; bytes: Buffer } | { ok: false } {
  const packetPath = assignment.privatePacketPath;
  if (typeof packetPath !== "string" || packetPath.length === 0) {
    return { ok: false };
  }
  try {
    const bytes = readFileSync(packetPath);
    JSON.parse(bytes.toString("utf8"));
    return { ok: true, bytes };
  } catch {
    return { ok: false };
  }
}

function repairInstructionLines(
  kind: ReviewResultRepairKind,
  revisionId: string,
): string[] {
  const sharedTail = [
    "Do not change schemaVersion, reviewedRevisionId, proposedDisposition, or any finding.",
    `reviewedRevisionId must be exactly: ${revisionId}`,
    reviewerOutputBoundsLine(),
    "Do not edit files, integrate, commit, push, or decide for Main.",
    "Return exactly one JSON object matching requiredOutputSchema and outputLimits.",
  ];
  if (kind === "credential-label") {
    return [
      "Same-Judge schema-only summary repair.",
      "The original JSON in ORIGINAL_RESULT.json is otherwise valid.",
      "It previously failed only because a credential field or option name appeared without a secret value.",
      "Rewrite ONLY the summary field. Credential labels and CLI options are allowed; do not write secret values.",
      ...sharedTail,
    ];
  }
  return [
    "Same-Judge schema-only summary repair.",
    "The original JSON in ORIGINAL_RESULT.json is otherwise valid.",
    "Shorten ONLY the summary field to at most 500 characters.",
    ...sharedTail,
  ];
}

async function writeRepairProject(
  home: string,
  graphId: string,
  assignmentId: string,
  original: ReviewResult,
  packetBytes: Buffer,
  revisionId: string,
  kind: ReviewResultRepairKind,
): Promise<string> {
  const projectDir = repairProjectDir(home, graphId, assignmentId);
  await mkdir(projectDir, { recursive: true, mode: 0o700 });
  await chmod(projectDir, 0o700);
  await writeFile(
    path.join(projectDir, "ORIGINAL_RESULT.json"),
    `${JSON.stringify(original, null, 2)}\n`,
    { mode: 0o600, flag: "wx" },
  );
  await writeFile(
    path.join(projectDir, "REVIEW_PACKET.json"),
    packetBytes,
    { mode: 0o600, flag: "wx" },
  );
  const instructions = repairInstructionLines(kind, revisionId).join("\n");
  await writeFile(path.join(projectDir, "INSTRUCTIONS.md"), `${instructions}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  return projectDir;
}

function buildRepairSpec(
  candidate: TaskRecord,
  originalReviewer: TaskRecord,
  projectDir: string,
  revisionId: string,
  kind: ReviewResultRepairKind,
): ContractTaskSpec {
  const originalSpec = originalReviewer.spec;
  const label = kind === "credential-label";
  const spec: ContractTaskSpec = {
    version: 2,
    name: `Schema-only summary repair of ${candidate.name}`.slice(0, 120),
    project: projectDir,
    ...(originalSpec.workerProfileId === undefined
      ? {}
      : { workerProfileId: originalSpec.workerProfileId }),
    contract: {
      outcome: label
        ? "Rewrite only the summary of the original otherwise-valid review JSON that named a credential label and return exactly one structured JSON object."
        : "Shorten only the over-limit summary of the original otherwise-valid review JSON and return exactly one structured JSON object.",
      presentation: {
        summary: label
          ? "同一裁判只改写 summary，不得改 disposition 或 findings。字段名可写，真实密钥值不可写。"
          : "同一裁判只缩短超长 summary，不得改 disposition 或 findings。",
        language: "zh-CN",
      },
      context: [
        label
          ? "ORIGINAL_RESULT.json is the otherwise-valid original judge JSON that named a credential label without a secret value."
          : "ORIGINAL_RESULT.json is the otherwise-valid original judge JSON.",
        "REVIEW_PACKET.json is the same private Candidate Revision packet.",
        "This Task is permanently non-integratable evidence for Main.",
      ],
      inScope: [
        "Read ORIGINAL_RESULT.json, REVIEW_PACKET.json, and INSTRUCTIONS.md",
        "Emit one JSON object that changes only summary",
      ],
      outOfScope: [
        "Editing files",
        "Changing disposition or findings",
        "Launching work",
        "Integration, commit, push",
        "Automatic Main decisions",
      ],
      executionSteps: [
        "Open ORIGINAL_RESULT.json",
        label
          ? "Rewrite only summary; credential labels are allowed and secret values are not"
          : "Shorten only summary to at most 500 characters",
        "Return exactly one strict JSON result and stop",
      ],
      deliverables: [
        label
          ? "One structured JSON judge result with only summary rewritten"
          : "One structured JSON judge result with only summary shortened",
      ],
      modules: [
        {
          name: "Same-Judge summary repair",
          responsibility: label
            ? "Rewrite only the summary of a label-only historical result"
            : "Shorten only the over-limit summary",
          consumes: ["ORIGINAL_RESULT.json"],
          produces: ["structured review JSON"],
          boundaries: ["No edits", "No disposition/findings change", "No Integration"],
        },
      ],
      callChain: [
        "Read original JSON",
        label ? "Rewrite summary" : "Shorten summary",
        "Emit JSON result",
      ],
      scenarios: [
        {
          name: "Summary-only repair",
          given: label
            ? "An otherwise-valid historical label-only unsafe-content result"
            : "An otherwise-valid over-limit summary",
          when: "The same Judge finishes",
          then: "Exactly one schema-valid JSON object is returned with only summary changed",
        },
      ],
      risks: [
        "Changing disposition or findings makes the repair unusable",
        "Extra fields or absolute paths fail closed",
      ],
      changeBudget: { maxFiles: 1, maxDiffLines: 1 },
    },
    provider: {
      name: originalSpec.provider.name,
      model: originalSpec.provider.model,
      keychainService: originalSpec.provider.keychainService,
      ...(originalSpec.provider.endpoint === undefined
        ? {}
        : { endpoint: originalSpec.provider.endpoint }),
      ...(originalSpec.provider.pricingRoute === undefined
        ? {}
        : { pricingRoute: originalSpec.provider.pricingRoute }),
    },
    runtime: {
      name: originalSpec.runtime.name,
      executable: originalSpec.runtime.executable,
      effort: originalSpec.runtime.effort,
      maxBudgetUsd: originalSpec.runtime.maxBudgetUsd,
    },
    workspace: { exclude: [] },
    worker: {
      allowEdits: false,
      allowedCommands: [],
      focusPaths: ["ORIGINAL_RESULT.json", "INSTRUCTIONS.md", "REVIEW_PACKET.json"],
    },
    acceptance: {
      criteria: [
        `Emit one JSON review for revision ${revisionId} that changes only summary`,
        "Do not modify any files",
      ],
      commands: ["true"],
    },
    advancedPolicyOverride: {
      baseMaxAttempts: 1,
      maxExtraAttempts: 0,
      maxMainCorrections: 0,
      maxAdaptationRounds: 0,
      maxMainReverifications: 0,
      maxWorkerValidationRepairs: 0,
    },
    completionPolicy: {
      noChangeMode: "off",
      changeBudgetMode: "warn",
    },
    ...(originalSpec.networkPolicy === undefined
      ? {}
      : { networkPolicy: originalSpec.networkPolicy }),
  };
  return spec;
}

function frozenIdentityMatches(task: TaskRecord, identity: FrozenWorkerIdentity): boolean {
  return task.spec.provider.name === identity.provider
    && task.spec.provider.model === identity.model
    && task.spec.runtime.name === identity.runtime
    && task.spec.runtime.effort === identity.effort
    && (identity.workerProfileId === undefined
      || task.spec.workerProfileId === identity.workerProfileId);
}

/** Explicit Main-confirmed one-shot same-Judge schema-only summary repair.
 *  Appends at most one repair record and one derived read-only Task. */
export async function repairReviewResult(
  store: StateStore,
  settings: ForkLightSettings,
  input: RepairReviewResultInput,
): Promise<RepairReviewResultResult> {
  const { reason } = validateRepairInput(input);
  const eligibility = evaluateReviewResultRepairEligibility(store, input);
  if (!eligibility.eligible || eligibility.assignment === undefined
    || eligibility.reviewerTask === undefined || eligibility.original === undefined) {
    throw new Error(eligibility.message);
  }
  const assignment = eligibility.assignment;
  const originalReviewer = eligibility.reviewerTask;
  const original = eligibility.original;
  const kind = eligibility.kind ?? "overlong-summary";
  const candidate = store.getTask(input.candidateTaskId);
  const graph = store.getReviewGraph(assignment.graphId);
  const home = path.dirname(store.databasePath);
  const repairTaskId = randomUUID();
  const now = timestamp();

  const packet = readExactPrivatePacket(assignment);
  if (!packet.ok) {
    throw new Error(
      "review result repair rejected: original private packet is missing, unreadable, or invalid",
    );
  }
  const projectDir = await writeRepairProject(
    home,
    graph.id,
    assignment.id,
    original,
    packet.bytes,
    assignment.candidateRevisionId,
    kind,
  );
  const repairSpec = buildRepairSpec(
    candidate,
    originalReviewer,
    projectDir,
    assignment.candidateRevisionId,
    kind,
  );
  const capabilities = enforcementCapabilityForRuntime(repairSpec.runtime.name);
  const effectivePolicy: EffectivePolicySnapshot = resolveTaskEffectivePolicy(
    repairSpec,
    settings,
    capabilities,
  );
  const frozenPolicy: EffectivePolicySnapshot = {
    ...effectivePolicy,
    values: {
      ...effectivePolicy.values,
      baseMaxAttempts: 1,
      maxExtraAttempts: 0,
      maxMainCorrections: 0,
      maxAdaptationRounds: 0,
      maxMainReverifications: 0,
      maxWorkerValidationRepairs: 0,
    },
  };
  const { buildTaskRecord } = await import("./runner.js");
  const repairTask = buildTaskRecord({
    spec: repairSpec as TaskSpec,
    taskFile: `forklight://review-graph/${graph.id}/assignment/${assignment.id}/result-repair`,
    home,
    id: repairTaskId,
    sessionId: randomUUID(),
    createdAt: now,
    effectivePolicy: frozenPolicy,
  });
  if (!frozenIdentityMatches(repairTask, assignment.frozenIdentity)) {
    throw new Error("review result repair rejected: frozen Judge identity mismatch");
  }
  if (repairTask.spec.worker.allowEdits !== false) {
    throw new Error("review result repair rejected: repair Task must be read-only");
  }

  const resultRepair: ReviewResultRepairRecord = {
    taskId: repairTaskId,
    status: "queued",
    createdAt: now,
    updatedAt: now,
  };
  const updatedAssignment: ReviewAssignmentRecord = {
    ...assignment,
    updatedAt: now,
    resultRepair,
  };
  const updatedGraph: ReviewGraphRecord = {
    ...graph,
    updatedAt: now,
  };
  store.createReviewResultRepairExecution({
    assignment: updatedAssignment,
    repairTask,
    graph: updatedGraph,
    candidateEvent: {
      summary: `Same-Judge schema-only summary repair assigned for revision ${assignment.candidateRevisionId.slice(0, 8)}`,
      payload: {
        graphId: graph.id,
        assignmentId: assignment.id,
        repairTaskId,
        reviewerTaskId: assignment.reviewerTaskId,
        originalFailureCode: assignment.failureCode,
        reason,
      },
    },
    repairCreationEvent: {
      summary: `Schema-only summary repair Task created for assignment ${assignment.id}`,
      payload: {
        graphId: graph.id,
        assignmentId: assignment.id,
        candidateTaskId: candidate.id,
        candidateRevisionId: assignment.candidateRevisionId,
        allowEdits: false,
        oneShot: true,
      },
    },
  });

  const freshEvents = store.listEvents(candidate.id);
  const freshAssignment = store.getReviewAssignment(assignment.id);
  return {
    graph: projectReviewGraph(
      store.getReviewGraph(graph.id),
      store.listReviewAssignments(graph.id).map((item) =>
        item.id === freshAssignment.id ? freshAssignment : item,
      ),
      freshEvents,
    ),
    assignmentId: assignment.id,
    repairTaskId,
    created: true,
    originalFailureCode: assignment.failureCode ?? "schema-violation",
  };
}

function mapRepairStatusFromTask(taskStatus: TaskRecord["status"]): ReviewResultRepairStatus | "active" {
  if (taskStatus === "queued" || taskStatus === "waiting" || taskStatus === "blocked") {
    return "queued";
  }
  // Interrupted is a restart-resume state, not a terminal repair failure.
  // Daemon recover() interrupts a running repair Task; treating that as failed
  // would permanently consume the one-shot allowance.
  if (
    taskStatus === "preparing"
    || taskStatus === "running"
    || taskStatus === "verifying"
    || taskStatus === "interrupted"
  ) {
    return "running";
  }
  if (taskStatus === "succeeded") return "succeeded";
  if (taskStatus === "failed") return "failed";
  return "active";
}

/** Reconcile one assignment's append-only result repair from its linked Task.
 *  Idempotent: already-terminal repairs are left unchanged. */
export function reconcileReviewResultRepair(
  store: StateStore,
  assignmentId: string,
): ReviewAssignmentRecord {
  const assignment = store.getReviewAssignment(assignmentId);
  const repair = assignment.resultRepair;
  if (repair === undefined) return assignment;
  if (repair.status === "succeeded" || repair.status === "failed") return assignment;

  const repairTask = store.getTask(repair.taskId);
  const mapped = mapRepairStatusFromTask(repairTask.status);
  if (mapped === "queued" || mapped === "running" || mapped === "active") {
    if (mapped === "running" && repair.status !== "running") {
      const updated: ReviewAssignmentRecord = {
        ...assignment,
        updatedAt: timestamp(),
        resultRepair: { ...repair, status: "running", updatedAt: timestamp() },
      };
      const graph = store.getReviewGraph(assignment.graphId);
      store.updateReviewAssignmentAndGraph(updated, {
        ...graph,
        updatedAt: updated.updatedAt,
      });
      return updated;
    }
    return assignment;
  }

  const now = timestamp();
  let result: ReviewResult | undefined;
  let failureCode: ReviewResultRepairFailureCode | undefined;
  let status: ReviewResultRepairStatus = "failed";

  if (!frozenIdentityMatches(repairTask, assignment.frozenIdentity)
    || repairTask.spec.worker.allowEdits !== false) {
    failureCode = "wrong-identity";
  } else if (repairTask.status !== "succeeded") {
    failureCode = "reviewer-task-failed";
  } else {
    const originalText = latestAttemptResultText(store, assignment.reviewerTaskId);
    const originalInspect = assignment.failureCode === "unsafe-content"
      ? inspectReviewResultForCredentialLabelRepair(
        originalText,
        assignment.candidateRevisionId,
        assignment.reviewerTaskId,
        assignment.reviewerTaskId,
      )
      : inspectReviewResultForSummaryRepair(
        originalText,
        assignment.candidateRevisionId,
        assignment.reviewerTaskId,
        assignment.reviewerTaskId,
      );
    try {
      result = parseReviewResultText(
        latestAttemptResultText(store, repairTask.id),
        assignment.candidateRevisionId,
        repairTask.id,
        repairTask.id,
      );
      if (!originalInspect.eligible) {
        failureCode = originalInspect.code === "summary-already-valid"
          || originalInspect.code === "missing-known-label"
          ? "schema-violation"
          : originalInspect.code;
        result = undefined;
      } else if (!sameOpinionExceptSummary(originalInspect.original, result)) {
        failureCode = result.reviewedRevisionId !== originalInspect.original.reviewedRevisionId
          ? "stale-revision"
          : "semantic-drift";
        result = undefined;
      } else if (result.summary === originalInspect.original.summary) {
        failureCode = "semantic-drift";
        result = undefined;
      } else {
        status = "succeeded";
      }
    } catch (error) {
      failureCode = reviewParseFailureCode(error) ?? "schema-violation";
    }
  }

  const completedRepair: ReviewResultRepairRecord = {
    ...repair,
    status,
    updatedAt: now,
    completedAt: now,
    ...(result === undefined ? {} : { result }),
    ...(failureCode === undefined ? {} : { failureCode }),
  };
  const completed: ReviewAssignmentRecord = {
    ...assignment,
    updatedAt: now,
    resultRepair: completedRepair,
  };

  const existingTerminal = store.listEvents(assignment.candidateTaskId).find((event) => {
    if (event.type !== "review.result-repair.completed" && event.type !== "review.result-repair.failed") {
      return false;
    }
    const payload = event.payload as { assignmentId?: unknown; repairTaskId?: unknown } | undefined;
    return payload?.assignmentId === assignment.id && payload?.repairTaskId === repair.taskId;
  });

  const eventType = status === "succeeded"
    ? "review.result-repair.completed"
    : "review.result-repair.failed";
  const event = existingTerminal ?? store.addEvent(
    assignment.candidateTaskId,
    undefined,
    eventType,
    status === "succeeded"
      ? `Same-Judge schema-only summary repair completed for revision ${assignment.candidateRevisionId.slice(0, 8)}`
      : `Same-Judge schema-only summary repair failed (${failureCode ?? "unknown"}) for revision ${assignment.candidateRevisionId.slice(0, 8)}`,
    {
      graphId: assignment.graphId,
      assignmentId: assignment.id,
      repairTaskId: repair.taskId,
      reviewerTaskId: assignment.reviewerTaskId,
      originalFailureCode: assignment.failureCode,
      status,
      resultUsable: status === "succeeded",
      ...(failureCode === undefined ? {} : { failureCode }),
      ...(result === undefined
        ? {}
        : {
            proposedDisposition: result.proposedDisposition,
            findingCount: result.findings.length,
          }),
    },
  );

  const graph = store.getReviewGraph(assignment.graphId);
  const allAssignments = store.listReviewAssignments(graph.id).map((item) =>
    item.id === completed.id ? completed : item,
  );
  const terminalEvidenceSequence = status === "succeeded"
    ? event.sequence
    : graph.terminalEvidenceSequence;
  const nextGraph: ReviewGraphRecord = {
    ...graph,
    status: graphStatusFromAssignments(allAssignments),
    updatedAt: now,
    ...(terminalEvidenceSequence === undefined
      ? {}
      : { terminalEvidenceSequence }),
  };
  store.updateReviewAssignmentAndGraph(completed, nextGraph);
  return completed;
}
