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
  getWorkerProfile,
  resolveWorkerSelection,
} from "./worker-profiles.js";
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
  ReviewResult,
  ReviewResultFailureCode,
  ReviewResultView,
  TaskRecord,
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

const CREDENTIAL_PATTERN =
  /\b(sk-[A-Za-z0-9_-]{8,}|API[_-]?KEY|Bearer\s+[A-Za-z0-9_\-.]{8,}|password\s*[:=])/i;

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

function rejectCredential(text: string): void {
  if (CREDENTIAL_PATTERN.test(text)) throw typedFailure("unsafe-content");
}

function boundedText(value: unknown, max: number, code: ReviewResultFailureCode = "schema-violation"): string {
  if (typeof value !== "string") throw typedFailure(code);
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > max) throw typedFailure(code);
  if (/[\r\n]/.test(trimmed)) throw typedFailure("unsafe-content");
  rejectCredential(trimmed);
  return trimmed;
}

/** Strictly parse exactly one bounded JSON judge result from a whole reply.
 *  Allows optional fence/prose wrappers around a unique object; scans the entire
 *  original text for credentials and size before extraction. Fail closed on any
 *  missing, ambiguous, malformed, stale, unsafe, oversized, or extra-field content. */
export function parseReviewResultText(
  resultText: string | undefined,
  expectedRevisionId: string,
  expectedReviewerTaskId: string,
  actualReviewerTaskId: string,
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
  const summary = boundedText(obj.summary, REVIEW_SUMMARY_MAX);
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

function projectAssignment(assignment: ReviewAssignmentRecord): ReviewAssignmentView {
  const resultUsable = assignment.result !== undefined && assignment.failureCode === undefined;
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
    ...(assignment.result === undefined ? {} : { result: projectResult(assignment.result) }),
    ...(assignment.failureCode === undefined ? {} : { failureCode: assignment.failureCode }),
  };
}

function isAssignmentTerminal(assignment: ReviewAssignmentRecord): boolean {
  return assignment.status === "completed" || assignment.status === "failed";
}

function isAssignmentUsable(assignment: ReviewAssignmentRecord): boolean {
  return assignment.result !== undefined && assignment.failureCode === undefined;
}

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
    const disposition = assignment.result!.proposedDisposition;
    dispositionCounts[disposition] += 1;
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
      usableList.map((a) => a.result!.proposedDisposition),
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
    const disposition = counts.usableList[0]?.result?.proposedDisposition ?? "unknown";
    if (counts.unusable > 0) {
      return `One usable judge suggested ${disposition}; ${counts.unusable} other judge result(s) were unusable. Useful evidence is retained; no replacement judge runs automatically.`;
    }
    return `One usable judge suggested ${disposition}. This is a single opinion, not automatic acceptance.`;
  }
  if (state === "agreement") {
    const disposition = counts.usableList[0]?.result?.proposedDisposition ?? "unknown";
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
): {
  nextAction: string;
  nextActionCode: ReviewGraphView["nextActionCode"];
  blocksIntegration: boolean;
  requiresFreshMainReview: boolean;
} {
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
  const nav = nextActionFor(graph, events, aggregation);
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

/** True when this Task id is a linked reviewer Task (never integratable). */
export function isReviewerTask(store: StateStore, taskId: string): boolean {
  return store.getReviewAssignmentByReviewerTaskId(taskId) !== undefined;
}

/** Collect Integration rejection reasons from any Review Graph linked to the
 *  Candidate Task. Empty when no review exists or a fresh Main accept is present. */
export function reviewGraphIntegrationReasons(
  store: StateStore,
  candidateTaskId: string,
): string[] {
  const graph = store.getReviewGraphByCandidateTaskId(candidateTaskId);
  if (graph === undefined) return [];
  const reasons: string[] = [];
  if (graph.status === "pending" || graph.status === "running") {
    reasons.push(PENDING_REVIEW_BLOCKS_INTEGRATION);
    return reasons;
  }
  if (graph.terminalEvidenceSequence === undefined) return reasons;
  const events = store.listEvents(candidateTaskId);
  const mainEvent = events
    .filter((e) => e.type === "main-review.completed")
    .reduce<EventRecord | undefined>(
      (latest, e) => (latest === undefined || e.sequence > latest.sequence ? e : latest),
      undefined,
    );
  if (mainEvent === undefined || mainEvent.sequence <= graph.terminalEvidenceSequence) {
    reasons.push(STALE_MAIN_ACCEPT_AFTER_REVIEW);
  }
  return reasons;
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
    candidate.spec.version === 2
      ? [...candidate.spec.acceptance.criteria].slice(0, 20).map((c) => c.slice(0, 300))
      : [];
  const contractOutcome =
    candidate.spec.version === 2
      ? candidate.spec.contract.outcome.slice(0, 500)
      : candidate.spec.goal.slice(0, 500);

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
  const defaultExecutable = selection.runtime === "grok-build" ? "grok" : "claude";
  return {
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
  if (CREDENTIAL_PATTERN.test(reason)) {
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
 *  finished (normal completion or daemon restart). Idempotent. */
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
  return reconciled;
}

/** Reconcile the graph linked to a finished Task if it is a reviewer Task. */
export function reconcileReviewGraphForTask(
  store: StateStore,
  taskId: string,
): ReviewGraphView | undefined {
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
  }
  const fresh = store.getReviewGraphByCandidateTaskId(candidateTaskId);
  if (fresh === undefined) return undefined;
  return projectReviewGraph(
    fresh,
    store.listReviewAssignments(fresh.id),
    store.listEvents(candidateTaskId),
  );
}
