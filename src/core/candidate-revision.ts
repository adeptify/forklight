/**
 * Candidate revision evidence and structured gap contract core.
 *
 * Boundaries:
 *   - Immutable per-Attempt CandidateRevision with SHA-256 patch digest and
 *     private snapshot artifact.
 *   - Structured bounded CandidateGapContract for Main correction.
 *   - Canonical correction eligibility shared by daemon, MCP, and Hub.
 *   - Never exposes private artifact paths, full diff content, or credentials.
 *   - Legacy Tasks without revision evidence remain readable; authority-bearing
 *     paths fail closed.
 */
import { createHash, randomUUID } from "node:crypto";
import { constants, readFileSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { StateStore } from "../state/store.js";
import type {
  AttemptRecord,
  CandidateGapContract,
  CandidateRevision,
  CandidateRevisionSummary,
  CorrectionEligibility,
  CorrectionEligibilityCategory,
  EventRecord,
  GapEntry,
  MainReviewDecision,
  MainReviewDecisionKind,
  TaskRecord,
} from "./types.js";

// --- Constants ---

const REUSABLE_PATH_MAX = 20;
const MAX_GAPS = 8;
const MIN_GAPS = 1;
const GAP_DESC_MIN = 10;
const GAP_DESC_MAX = 500;
const GAP_EXPECT_MIN = 10;
const GAP_EXPECT_MAX = 500;
const FEEDBACK_MIN = 1;
const FEEDBACK_MAX = 1000;

// --- Safe relative-path validation (mirrors integration.ts) ---

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

/** Read-only freshness check used at correction authorization and again before
 * execution. It never mutates the workspace or exposes Diff content. */
export function candidateRevisionMatchesCurrentDiff(
  task: TaskRecord,
  revision: CandidateRevision,
): boolean {
  try {
    return sha256(readFileSync(task.paths.diff)) === revision.patchDigest;
  } catch {
    return false;
  }
}

// --- Candidate revision capture ---

/** Freeze the exact integration Diff as an immutable CandidateRevision.
 *
 *  Reads the current diff from `task.paths.diff`, computes its SHA-256,
 *  copies the bytes to a private task-internal artifact, then records a
 *  durable `candidate.revision.captured` event. The private artifact path
 *  is stored in the event payload but never projected to Hub, MCP, or CLI.
 *
 *  Idempotent: if a revision already exists for the same attemptId,
 *  verificationEventSequence, and digest, the existing revision is returned.
 *  Conflicting duplicate identity (same keys, different digest) throws. */
export async function captureCandidateRevision(
  store: StateStore,
  task: TaskRecord,
  attempt: AttemptRecord,
  verificationEventSequence: number,
  verificationPassed: boolean,
  affectedPaths: string[],
  filesChanged: number,
  changedLines: number,
): Promise<CandidateRevision> {
  if (attempt.taskId !== task.id) {
    throw new Error("Cannot capture candidate revision: Attempt does not belong to Task");
  }
  if (!Number.isSafeInteger(verificationEventSequence) || verificationEventSequence < 1) {
    throw new Error("Cannot capture candidate revision: invalid verification event sequence");
  }
  if (!Number.isSafeInteger(filesChanged) || filesChanged < 0
    || !Number.isSafeInteger(changedLines) || changedLines < 0) {
    throw new Error("Cannot capture candidate revision: invalid patch metrics");
  }
  const normalizedPaths = normalizeAffectedPaths(affectedPaths);

  // Read the diff bytes
  let diffBytes: Buffer;
  try {
    diffBytes = await readFile(task.paths.diff);
  } catch {
    throw new Error("Cannot capture candidate revision: diff file is missing");
  }

  const digest = sha256(diffBytes);

  // Check idempotent: existing revision for same attempt + verification + digest
  const events = store.listEvents(task.id);
  const existing = resolveRevisionForAttempt(
    events,
    attempt.id,
    verificationEventSequence,
  );
  if (existing !== undefined) {
    if (existing.patchDigest !== digest) {
      throw new Error(
        `Candidate revision conflict: attempt ${attempt.id} verification seq ${verificationEventSequence} already has a different digest`,
      );
    }
    if (
      existing.taskId !== task.id
      || existing.attemptOrdinal !== attempt.ordinal
      || existing.verificationPassed !== verificationPassed
      || existing.filesChanged !== filesChanged
      || existing.changedLines !== changedLines
      || JSON.stringify(existing.affectedPaths) !== JSON.stringify(normalizedPaths)
    ) {
      throw new Error("Candidate revision conflict: immutable metadata does not match");
    }
    const existingEvent = events.find((event) =>
      event.type === "candidate.revision.captured"
      && event.attemptId === attempt.id
      && (event.payload as { id?: unknown } | undefined)?.id === existing.id,
    );
    await verifyPrivateArtifact(task, existing, existingEvent);
    return existing;
  }

  // Create private artifact
  const revisionId = randomUUID();
  const revisionsDir = path.join(task.paths.root, "revisions");
  await mkdir(revisionsDir, { recursive: true, mode: 0o700 });
  await chmod(revisionsDir, 0o700);
  const artifactPath = path.join(revisionsDir, `${revisionId}.patch`);
  await copyFile(task.paths.diff, artifactPath, constants.COPYFILE_EXCL);
  await chmod(artifactPath, 0o600);

  const now = new Date().toISOString();
  const revision: CandidateRevision = {
    id: revisionId,
    taskId: task.id,
    attemptId: attempt.id,
    attemptOrdinal: attempt.ordinal,
    verificationEventSequence,
    patchDigest: digest,
    affectedPaths: normalizedPaths,
    filesChanged,
    changedLines,
    verificationPassed,
    createdAt: now,
  };

  // Record immutable event — privateArtifactPath is in the store but not projected
  store.addEvent(
    task.id,
    attempt.id,
    "candidate.revision.captured",
    `Candidate revision captured for attempt ordinal ${attempt.ordinal}`,
    {
      ...revision,
      privateArtifactPath: artifactPath,
    },
  );

  return revision;
}

// --- Revision resolution ---

/** Resolve the latest CandidateRevision for a Task from its events.
 *  Returns undefined for legacy Tasks without revision evidence. */
export function resolveLatestRevision(
  events: readonly EventRecord[],
): CandidateRevision | undefined {
  const revisionEvents = events
    .filter((e) => e.type === "candidate.revision.captured")
    .sort((a, b) => b.sequence - a.sequence);
  for (const event of revisionEvents) {
    const revision = revisionFromPayload(event.payload as Record<string, unknown> | undefined);
    if (revision !== undefined) return revision;
  }
  return undefined;
}

/** Resolve a specific CandidateRevision for an attempt + verification pair. */
export function resolveRevisionForAttempt(
  events: readonly EventRecord[],
  attemptId: string,
  verificationEventSequence: number,
): CandidateRevision | undefined {
  for (const event of events) {
    if (event.type !== "candidate.revision.captured") continue;
    const payload = event.payload as Record<string, unknown> | undefined;
    if (payload === undefined) continue;
    if (
      payload.attemptId === attemptId
      && payload.verificationEventSequence === verificationEventSequence
    ) {
      return revisionFromPayload(payload);
    }
  }
  return undefined;
}

export function resolveLatestRevisionForAttempt(
  events: readonly EventRecord[],
  attemptId: string,
): CandidateRevision | undefined {
  const candidates = events
    .filter((event) => event.type === "candidate.revision.captured" && event.attemptId === attemptId)
    .sort((left, right) => right.sequence - left.sequence);
  for (const event of candidates) {
    const revision = revisionFromPayload(event.payload as Record<string, unknown> | undefined);
    if (revision !== undefined && revision.attemptId === attemptId) return revision;
  }
  return undefined;
}

function revisionFromPayload(
  payload: Record<string, unknown> | undefined,
): CandidateRevision | undefined {
  if (payload === undefined) return undefined;
  if (
    typeof payload.id !== "string"
    || payload.id.length === 0
    || typeof payload.taskId !== "string"
    || typeof payload.attemptId !== "string"
    || !Number.isSafeInteger(payload.attemptOrdinal)
    || (payload.attemptOrdinal as number) < 1
    || !Number.isSafeInteger(payload.verificationEventSequence)
    || (payload.verificationEventSequence as number) < 1
    || typeof payload.patchDigest !== "string"
    || !/^[a-f0-9]{64}$/.test(payload.patchDigest)
    || !Array.isArray(payload.affectedPaths)
    || !Number.isSafeInteger(payload.filesChanged)
    || (payload.filesChanged as number) < 0
    || !Number.isSafeInteger(payload.changedLines)
    || (payload.changedLines as number) < 0
    || typeof payload.verificationPassed !== "boolean"
    || typeof payload.createdAt !== "string"
  ) {
    return undefined;
  }
  let normalizedPaths: string[];
  try {
    normalizedPaths = normalizeAffectedPaths(payload.affectedPaths);
  } catch {
    return undefined;
  }
  return {
    id: payload.id,
    taskId: payload.taskId,
    attemptId: payload.attemptId,
    attemptOrdinal: payload.attemptOrdinal as number,
    verificationEventSequence: payload.verificationEventSequence as number,
    patchDigest: payload.patchDigest,
    affectedPaths: normalizedPaths,
    filesChanged: payload.filesChanged as number,
    changedLines: payload.changedLines as number,
    verificationPassed: payload.verificationPassed,
    createdAt: payload.createdAt,
  };
}

function normalizeAffectedPaths(input: readonly unknown[]): string[] {
  const normalized = input.map((value) => {
    if (typeof value !== "string" || value !== value.trim() || detectUnsafePath(value) !== undefined) {
      throw new Error("Candidate revision contains an unsafe affected path");
    }
    return value;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Candidate revision contains duplicate affected paths");
  }
  return [...normalized].sort();
}

async function verifyPrivateArtifact(
  task: TaskRecord,
  revision: CandidateRevision,
  event: EventRecord | undefined,
): Promise<void> {
  const payload = event?.payload as Record<string, unknown> | undefined;
  const expected = path.join(task.paths.root, "revisions", `${revision.id}.patch`);
  if (payload?.privateArtifactPath !== expected) {
    throw new Error("Candidate revision history is corrupt: private artifact identity mismatch");
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(expected);
  } catch {
    throw new Error("Candidate revision history is corrupt: private artifact is missing");
  }
  if (sha256(bytes) !== revision.patchDigest) {
    throw new Error("Candidate revision history is corrupt: private artifact digest mismatch");
  }
}

// --- Privacy-safe summary ---

/** Build a bounded control-surface summary. Never exposes the private artifact
 *  path or Diff content; affected paths have already passed relative-path
 *  validation and let Main mark known-good files explicitly. */
export function summarizeRevision(
  revision: CandidateRevision,
): CandidateRevisionSummary {
  return {
    id: revision.id,
    attemptOrdinal: revision.attemptOrdinal,
    digestPrefix: revision.patchDigest.slice(0, 12),
    affectedPathCount: revision.affectedPaths.length,
    affectedPaths: [...revision.affectedPaths],
    filesChanged: revision.filesChanged,
    changedLines: revision.changedLines,
    verificationPassed: revision.verificationPassed,
  };
}

// --- Gap contract validation and building ---

/** Compute a deterministic SHA-256 digest for a gap contract.
 *  Used to bind correction grants to the exact contract content. */
export function computeGapContractDigest(contract: CandidateGapContract): string {
  const normalized = JSON.stringify({
    v: contract.schemaVersion,
    r: contract.candidateRevisionId,
    p: [...contract.reusablePaths].sort(),
    g: contract.remainingGaps.map((g) => ({
      d: g.description,
      e: g.acceptanceExpectation,
    })),
  });
  return sha256(normalized);
}

/** Validate and build a bounded CandidateGapContract.
 *  Throws on invalid paths, counts, lengths, or content. */
export function buildCandidateGapContract(
  candidateRevisionId: string,
  reusablePaths: unknown,
  remainingGaps: unknown,
  revisionAffectedPaths: readonly string[],
): CandidateGapContract {
  if (typeof candidateRevisionId !== "string" || candidateRevisionId !== candidateRevisionId.trim()
    || candidateRevisionId.length === 0 || candidateRevisionId.length > 200) {
    throw new Error("candidateRevisionId must be a bounded non-empty string");
  }
  // Validate reusablePaths
  if (!Array.isArray(reusablePaths)) {
    throw new Error("reusablePaths must be an array");
  }
  if (reusablePaths.length > REUSABLE_PATH_MAX) {
    throw new Error(`reusablePaths must contain at most ${REUSABLE_PATH_MAX} entries`);
  }
  const validatedPaths: string[] = [];
  for (const p of reusablePaths) {
    if (typeof p !== "string" || p.trim().length === 0) {
      throw new Error("each reusable path must be a non-empty string");
    }
    const trimmed = p.trim();
    const unsafe = detectUnsafePath(trimmed);
    if (unsafe) throw new Error(unsafe);
    if (!revisionAffectedPaths.includes(trimmed)) {
      throw new Error(
        `reusable path "${trimmed}" is not in the referenced revision affected set`,
      );
    }
    validatedPaths.push(trimmed);
  }
  if (new Set(validatedPaths).size !== validatedPaths.length) {
    throw new Error("reusablePaths must not contain duplicates");
  }

  // Validate remainingGaps
  if (!Array.isArray(remainingGaps)) {
    throw new Error("remainingGaps must be an array");
  }
  if (remainingGaps.length < MIN_GAPS || remainingGaps.length > MAX_GAPS) {
    throw new Error(`remainingGaps must contain at least ${MIN_GAPS} and at most ${MAX_GAPS} entries`);
  }
  const validatedGaps: GapEntry[] = [];
  for (const g of remainingGaps) {
    if (g === null || typeof g !== "object" || Array.isArray(g)) {
      throw new Error("each remaining gap must be an object");
    }
    const entry = g as Record<string, unknown>;
    const keys = Object.keys(entry).sort();
    if (keys.length !== 2 || keys[0] !== "acceptanceExpectation" || keys[1] !== "description") {
      throw new Error("each remaining gap must contain only description and acceptanceExpectation");
    }
    if (typeof entry.description !== "string") {
      throw new Error("each gap must have a description string");
    }
    if (typeof entry.acceptanceExpectation !== "string") {
      throw new Error("each gap must have an acceptanceExpectation string");
    }
    const desc = entry.description.trim();
    const expect = entry.acceptanceExpectation.trim();
    // Check credential-shaped text before length checks so a redacted/short
    // expectation cannot hide the more important rejection reason.
    if (
      /\b(sk-[A-Za-z0-9_-]{8,}|API[_-]?KEY|Bearer\s+[A-Za-z0-9_\-.]{8,}|password\s*[:=])/i.test(desc)
      || /\b(sk-[A-Za-z0-9_-]{8,}|API[_-]?KEY|Bearer\s+[A-Za-z0-9_\-.]{8,}|password\s*[:=])/i.test(expect)
    ) {
      throw new Error("gap text must not contain credentials");
    }
    if (desc.length < GAP_DESC_MIN || desc.length > GAP_DESC_MAX) {
      throw new Error(
        `gap description must be ${GAP_DESC_MIN}-${GAP_DESC_MAX} characters`,
      );
    }
    if (expect.length < GAP_EXPECT_MIN || expect.length > GAP_EXPECT_MAX) {
      throw new Error(
        `gap acceptanceExpectation must be ${GAP_EXPECT_MIN}-${GAP_EXPECT_MAX} characters`,
      );
    }
    // Reject raw logs, prompts, credentials, or arbitrary nested data patterns
    if (/[\r\n]/.test(desc) || /[\r\n]/.test(expect)) {
      throw new Error("gap text must not contain newlines");
    }
    validatedGaps.push({ description: desc, acceptanceExpectation: expect });
  }

  return {
    schemaVersion: 1,
    candidateRevisionId,
    reusablePaths: validatedPaths,
    remainingGaps: validatedGaps,
  };
}

// --- Main Review evidence parsing (dependency-neutral, canonical) ---

export function isDecision(value: unknown): value is MainReviewDecisionKind {
  return value === "accept" || value === "revise" || value === "reject";
}

/** Return the latest verification event, or undefined if none exists.
 *  Canonical parser shared by main-review.ts and correction eligibility. */
export function latestVerificationEvent(events: readonly EventRecord[]): EventRecord | undefined {
  return events
    .filter((event) => event.type === "verification.completed")
    .reduce<EventRecord | undefined>(
      (latest, event) => latest === undefined || event.sequence > latest.sequence ? event : latest,
      undefined,
    );
}

/** Return the latest verification event's sequence, or 0 if none exists.
 *  Convenience wrapper used by correction eligibility and authorization. */
export function latestVerificationSequence(events: readonly EventRecord[]): number {
  return latestVerificationEvent(events)?.sequence ?? 0;
}

/** Canonical typed Main Review evidence parser — shared by main-review.ts,
 *  correction eligibility, authorization, integration, and Task Detail.
 *  Pure event filter; never mutates, runs commands, or exposes private content. */
export function latestMainReview(
  events: readonly EventRecord[],
): MainReviewDecision | undefined {
  const event = events
    .filter((candidate) => candidate.type === "main-review.completed")
    .reduce<EventRecord | undefined>(
      (latest, candidate) => latest === undefined || candidate.sequence > latest.sequence
        ? candidate
        : latest,
      undefined,
    );
  if (event?.payload === null || typeof event?.payload !== "object") return undefined;
  const payload = event.payload as Partial<MainReviewDecision>;
  if (
    !isDecision(payload.decision)
    || typeof payload.reason !== "string"
    || typeof payload.attemptId !== "string"
    || typeof payload.verificationEventSequence !== "number"
  ) {
    return undefined;
  }
  return {
    decision: payload.decision,
    reason: payload.reason,
    attemptId: payload.attemptId,
    verificationEventSequence: payload.verificationEventSequence,
    ...(typeof payload.candidateRevisionId === "string"
      ? { candidateRevisionId: payload.candidateRevisionId }
      : {}),
    ...(typeof payload.acceptedPatchDigest === "string"
      ? { acceptedPatchDigest: payload.acceptedPatchDigest }
      : {}),
  };
}

/** Validate that the latest Main Review is a typed revise decision bound
 *  to the exact latest attempt and latest verification event.
 *  Uses the canonical `latestMainReview` parser — no duplicated event filtering. */
export function isLatestMainReviewRevise(
  events: readonly EventRecord[],
  latestAttemptId: string,
  latestVerificationSeq: number,
): boolean {
  const review = latestMainReview(events);
  return review !== undefined
    && review.decision === "revise"
    && review.attemptId === latestAttemptId
    && review.verificationEventSequence === latestVerificationSeq;
}

/** A Competition Candidate may use the ordinary structured-correction engine
 * only when Main has explicitly recorded a Competition-level revise for this
 * exact Task, Attempt, verification event, CandidateRevision, and patch
 * digest. This preserves the standalone correction authority while closing
 * the old blanket ban without turning machine comparison into retry authority. */
export function hasExactCompetitionMainRevise(
  store: StateStore,
  taskId: string,
  latestAttemptId: string,
  latestVerificationSeq: number,
  latestRevision: CandidateRevision,
): boolean {
  const competitionId = store.getCompetitionByCandidateTaskId(taskId);
  if (competitionId === undefined) return true;
  const competition = store.getCompetition(competitionId);
  const candidate = store
    .getCompetitionCandidates(competitionId)
    .find((entry) => entry.taskId === taskId);
  const decision = competition.mainDecision;
  return candidate !== undefined
    && decision !== undefined
    && decision.decision === "revise"
    && decision.candidateId === candidate.id
    && decision.taskId === taskId
    && decision.attemptId === latestAttemptId
    && decision.verificationEventSequence === latestVerificationSeq
    && decision.candidateRevisionId === latestRevision.id
    && decision.acceptedPatchDigest === latestRevision.patchDigest;
}

// --- Correction eligibility ---

/** Canonical read-only correction eligibility shared by daemon, MCP, and Hub.
 *  Never runs commands or exposes private content. */
export function resolveCorrectionEligibility(
  store: StateStore,
  taskId: string,
): CorrectionEligibility {
  const task = store.getTask(taskId);
  const events = store.listEvents(taskId);

  // Resolve frozen allowance from immutable task snapshot
  const maxMainCorrections =
    task.effectivePolicy?.values.maxMainCorrections ?? 1;
  const consumed = countCorrectionGrants(events);
  const allowance = {
    max: maxMainCorrections,
    consumed,
    remaining: Math.max(0, maxMainCorrections - consumed),
    source: task.effectivePolicy?.provenance.maxMainCorrections ?? "global" as const,
  };

  // Category checks in priority order.
  // Status gate: only failed, interrupted, or (with Main revise) succeeded.
  if (task.status !== "failed" && task.status !== "interrupted") {
    if (task.status !== "succeeded") {
      return { eligible: false, category: "not-failed-or-interrupted", allowance };
    }
    // Succeeded hard stop: delivered work cannot be corrected in place.
    if (store.listIntegrationResults(taskId).length > 0) {
      return { eligible: false, category: "not-failed-or-interrupted", allowance };
    }
    // All remaining checks (revision, allowance, diff, and Main Review binding)
    // live in the shared path below so allowance fires before review proof.
  }

  // --- Shared checks for all correction-eligible statuses ---
  const attempts = store.listAttempts(taskId);
  if (attempts.some((a) => a.status === "running")) {
    return { eligible: false, category: "running-attempt", allowance };
  }
  const latestRevision = resolveLatestRevision(events);
  if (latestRevision === undefined) {
    return { eligible: false, category: "no-revision", allowance };
  }
  if (latestRevision.taskId !== task.id) {
    return { eligible: false, category: "stale-revision", allowance };
  }
  if (maxMainCorrections === 0) {
    return {
      eligible: false,
      category: "allowance-zero",
      allowance,
      latestRevision: summarizeRevision(latestRevision),
    };
  }
  if (consumed >= maxMainCorrections) {
    return {
      eligible: false,
      category: "allowance-exhausted",
      allowance,
      latestRevision: summarizeRevision(latestRevision),
    };
  }
  const latestAttempt = attempts.reduce<AttemptRecord | undefined>(
    (latest, attempt) => latest === undefined || attempt.ordinal > latest.ordinal ? attempt : latest,
    undefined,
  );
  if (latestAttempt === undefined || latestRevision.attemptId !== latestAttempt.id) {
    return {
      eligible: false,
      category: "no-latest-attempt-revision",
      allowance,
      latestRevision: summarizeRevision(latestRevision),
    };
  }
  // Check pending incompatible grant
  const pendingGrant = findPendingCorrectionGrant(events, attempts);
  if (pendingGrant !== undefined) {
    return {
      eligible: false,
      category: "pending-incompatible-grant",
      allowance,
      latestRevision: summarizeRevision(latestRevision),
    };
  }
  if (latestRevision.filesChanged === 0 || latestRevision.affectedPaths.length === 0) {
    return {
      eligible: false,
      category: "empty-revision",
      allowance,
      latestRevision: summarizeRevision(latestRevision),
    };
  }
  if (!candidateRevisionMatchesCurrentDiff(task, latestRevision)) {
    return {
      eligible: false,
      category: "stale-revision",
      allowance,
      latestRevision: summarizeRevision(latestRevision),
    };
  }
  // For succeeded tasks: all revision/diff/allowance checks passed above;
  // now prove the Main Review is a typed revise bound to the latest attempt.
  // When the review proof fails, never leak the CandidateRevision summary —
  // the task is not correctable and front-ends must not expose revision details.
  if (task.status === "succeeded") {
    const verSeq = latestVerificationSequence(events);
    if (!isLatestMainReviewRevise(events, latestAttempt.id, verSeq)) {
      return {
        eligible: false,
        category: "no-main-revise",
        allowance,
      };
    }
  }

  // Standalone Tasks arrive here directly. Competition Candidates need one
  // additional, exact Competition-level Main revise; a ranking result, Task
  // review alone, stale revise, accept, or reject never authorizes a Worker.
  if (!hasExactCompetitionMainRevise(
    store,
    taskId,
    latestAttempt.id,
    latestVerificationSequence(events),
    latestRevision,
  )) {
    return {
      eligible: false,
      category: "competition-main-revise-required",
      allowance,
    };
  }

  return {
    eligible: true,
    category: "eligible",
    allowance,
    latestRevision: summarizeRevision(latestRevision),
  };
}

/** Stable privacy-safe rejection messages — never echo private content. */
export function describeCorrectionRejection(
  category: CorrectionEligibilityCategory,
): string {
  switch (category) {
    case "eligible":
      return "correction is eligible";
    case "not-failed-or-interrupted":
      return "correction requires a failed or interrupted Task";
    case "competition-candidate":
      return "correction rejected: competition candidates cannot be corrected";
    case "competition-main-revise-required":
      return "correction rejected: Competition Main must revise this exact Candidate Revision first";
    case "running-attempt":
      return "correction rejected: Task has a running Attempt";
    case "no-revision":
      return "correction rejected: no CandidateRevision evidence is available; a verified Worker Attempt is required before structured correction";
    case "no-latest-attempt-revision":
      return "correction rejected: the latest terminal Attempt has no matching CandidateRevision";
    case "empty-revision":
      return "correction rejected: the latest CandidateRevision has no reusable changed files";
    case "allowance-zero":
      return "correction rejected: maxMainCorrections is zero; corrections are disabled";
    case "allowance-exhausted":
      return "correction rejected: maxMainCorrections allowance is exhausted";
    case "pending-incompatible-grant":
      return "correction rejected: a pending correction grant is already present";
    case "stale-revision":
      return "correction rejected: the referenced revision no longer matches the current workspace";
    case "no-main-revise":
      return "correction rejected: Task succeeded but Main has not recorded a valid revise decision bound to the latest Attempt";
  }
}

function countCorrectionGrants(events: readonly EventRecord[]): number {
  let count = 0;
  for (const event of events) {
    if (event.type !== "attempt.authorization.granted") continue;
    const payload = event.payload as Record<string, unknown> | undefined;
    if (payload?.kind === "correction") count += 1;
  }
  return count;
}

function findPendingCorrectionGrant(
  events: readonly EventRecord[],
  attempts: readonly AttemptRecord[],
): EventRecord | undefined {
  const attemptOrdinals = new Set(attempts.map((a) => a.ordinal));
  for (const event of events) {
    if (event.type !== "attempt.authorization.granted") continue;
    const payload = event.payload as Record<string, unknown> | undefined;
    if (
      payload !== undefined
      && typeof payload.targetOrdinal === "number"
      && !attemptOrdinals.has(payload.targetOrdinal)
    ) {
      return event;
    }
  }
  return undefined;
}

// --- Worker correction instruction ---

/** Build a concise generated correction instruction for the Worker.
 *  Includes reusable paths, remaining gaps, acceptance expectations, and
 *  the return-to-Main no-progress stop rule. Never includes the private
 *  revision artifact path. */
export function buildCorrectionInstruction(
  contract: CandidateGapContract,
  feedback: string,
): string {
  const sections: string[] = [];

  sections.push("## Main Correction Instruction\n");
  sections.push("### Reusable Work");
  if (contract.reusablePaths.length === 0) {
    sections.push("No specific paths are marked as reusable.");
  } else {
    sections.push(
      "The following paths contain work that should be retained and built upon:",
    );
    for (const p of contract.reusablePaths) {
      sections.push(`- ${p}`);
    }
  }

  sections.push("\n### Remaining Gaps");
  for (let i = 0; i < contract.remainingGaps.length; i += 1) {
    const gap = contract.remainingGaps[i]!;
    sections.push(`**Gap ${i + 1}:** ${gap.description}`);
    sections.push(`- Acceptance: ${gap.acceptanceExpectation}`);
  }

  sections.push("\n### Stop Rule");
  sections.push(
    "If you cannot make progress on any remaining gap after a reasonable attempt, " +
    "return control to Main with a summary of what was attempted. " +
    "Do not loop — one correction attempt covers one pass through the gaps above.",
  );

  if (feedback.trim().length > 0) {
    sections.push("\n### Additional Main Feedback");
    sections.push(feedback.trim());
  }

  return sections.join("\n");
}

// --- Correction authorization helpers ---

export interface StructuredCorrectionInput {
  feedback: string;
  maxBudgetUsd: number | null;
  candidateRevisionId: string;
  reusablePaths: unknown;
  remainingGaps: unknown;
  confirm: true;
}

/** Validate the unstructured feedback and gap contract inputs, then build the
 *  canonical contract and compute its digest. Throws on any validation failure
 *  before any grant or queue mutation. */
export function validateStructuredCorrectionInput(
  input: StructuredCorrectionInput,
  latestRevision: CandidateRevision,
): { contract: CandidateGapContract; contractDigest: string; trimmedFeedback: string } {
  if (input.confirm !== true) {
    throw new Error("correction requires confirm: true");
  }

  const trimmedFeedback = input.feedback.trim();
  if (trimmedFeedback.length < FEEDBACK_MIN || trimmedFeedback.length > FEEDBACK_MAX) {
    throw new Error(
      `correction feedback must be ${FEEDBACK_MIN}-${FEEDBACK_MAX} characters`,
    );
  }

  const budget = input.maxBudgetUsd;
  if (budget !== null && (!Number.isFinite(budget) || budget <= 0)) {
    throw new Error("correction maxBudgetUsd must be null or a finite positive number");
  }

  if (input.candidateRevisionId !== latestRevision.id) {
    throw new Error(
      "stale revision: the requested revision does not match the latest CandidateRevision",
    );
  }

  const contract = buildCandidateGapContract(
    input.candidateRevisionId,
    input.reusablePaths,
    input.remainingGaps,
    latestRevision.affectedPaths,
  );
  const contractDigest = computeGapContractDigest(contract);

  return { contract, contractDigest, trimmedFeedback };
}
