// Direct-Codex paired-sample review — immutable decision records.
// Pure privacy-safe core: one explicit bounded review decision per
// sample with no content, mutable notes, or credential-bearing fields.

function freezeDeep(v: unknown): void {
  if (v !== null && typeof v === "object" && !Object.isFrozen(v)) {
    if (Array.isArray(v)) { for (const e of v) freezeDeep(e); }
    else { for (const e of Object.values(v)) freezeDeep(e); }
    Object.freeze(v);
  }
}

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

const STRICT_TOKEN_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

const VALID_REJECTION_REASONS = new Set([
  "not-equivalent-task",
  "insufficient-quality",
  "incomplete-evidence",
  "duplicate-evidence",
]);

export type ReviewRejectionReason =
  | "not-equivalent-task"
  | "insufficient-quality"
  | "incomplete-evidence"
  | "duplicate-evidence";

export type ReviewDecision = "accepted" | "rejected";

export interface DirectCodexSampleReview {
  readonly sampleId: string;
  readonly decision: ReviewDecision;
  /** Present only when decision is "rejected".  Must be one enum value. */
  readonly rejectionReason?: ReviewRejectionReason;
  readonly reviewer: "main-codex";
  readonly reviewedAt: string;
  readonly schemaVersion: 1;
}

const REVIEW_KEYS_ACCEPTED = new Set([
  "sampleId", "decision", "reviewer", "reviewedAt", "schemaVersion",
]);
const REVIEW_KEYS_REJECTED = new Set([
  "sampleId", "decision", "rejectionReason", "reviewer", "reviewedAt", "schemaVersion",
]);

const REJECTED_REQUIRED = new Set([
  "sampleId", "decision", "rejectionReason", "reviewer", "reviewedAt", "schemaVersion",
]);

const RAW_CONTENT_FIELDS = new Set([
  "text", "content", "prompt", "body", "payload", "raw", "secret",
  "credential", "log", "response", "notes", "reason", "detail",
  "evidence", "source", "diff", "hash", "modelConfig",
]);

function isValidTimestamp(s: unknown): s is string {
  if (typeof s !== "string" || s.trim().length === 0) return false;
  const ts = Date.parse(s);
  if (!Number.isFinite(ts)) return false;
  return new Date(s).toISOString() === s;
}


/** Normalize untrusted review input into a detached deeply-frozen
 *  {@link DirectCodexSampleReview}.  Accepted decisions carry no
 *  rejection reason; rejected decisions require exactly one bounded
 *  enum rejection reason.  Extra keys, free-form text, content-bearing
 *  fields, mutable notes, and non-canonical timestamps are rejected
 *  with a fixed non-echoing TypeError. */
export function normalizeDirectCodexSampleReview(
  input: unknown,
): DirectCodexSampleReview {
  if (input === null || typeof input !== "object") {
    throw new TypeError("Invalid direct-Codex sample review");
  }
  const o = input as Record<string, unknown>;

  // Reject any content-bearing or credential-like fields
  for (const f of RAW_CONTENT_FIELDS) {
    if (hasOwn(o, f)) throw new TypeError("Invalid direct-Codex sample review");
  }

  // Validate decision first to pick the correct key set
  if (typeof o.decision !== "string" || !(["accepted", "rejected"] as string[]).includes(o.decision)) {
    throw new TypeError("Invalid direct-Codex sample review");
  }
  const decision = o.decision as ReviewDecision;

  const allowedKeys = decision === "accepted" ? REVIEW_KEYS_ACCEPTED : REVIEW_KEYS_REJECTED;
  for (const key of Object.keys(o)) {
    if (!allowedKeys.has(key)) throw new TypeError("Invalid direct-Codex sample review");
  }

  // Validate sampleId
  if (typeof o.sampleId !== "string" || !STRICT_TOKEN_RE.test(o.sampleId)) {
    throw new TypeError("Invalid direct-Codex sample review");
  }

  // Validate reviewer — must be the exact literal
  if (o.reviewer !== "main-codex") {
    throw new TypeError("Invalid direct-Codex sample review");
  }

  // Validate timestamp
  if (!isValidTimestamp(o.reviewedAt)) {
    throw new TypeError("Invalid direct-Codex sample review");
  }

  // Validate schemaVersion
  if (o.schemaVersion !== 1) {
    throw new TypeError("Invalid direct-Codex sample review");
  }

  // Decision-dependent validation
  let rejectionReason: ReviewRejectionReason | undefined;

  if (decision === "accepted") {
    // Accepted must NOT carry a rejection reason
    if (hasOwn(o, "rejectionReason")) {
      throw new TypeError("Invalid direct-Codex sample review");
    }
    // All required accepted keys must be present
    for (const key of REVIEW_KEYS_ACCEPTED) {
      if (!hasOwn(o, key)) throw new TypeError("Invalid direct-Codex sample review");
    }
  } else {
    // Rejected must carry exactly one bounded enum rejection reason
    for (const key of REJECTED_REQUIRED) {
      if (!hasOwn(o, key)) throw new TypeError("Invalid direct-Codex sample review");
    }
    if (typeof o.rejectionReason !== "string" || !VALID_REJECTION_REASONS.has(o.rejectionReason)) {
      throw new TypeError("Invalid direct-Codex sample review");
    }
    rejectionReason = o.rejectionReason as ReviewRejectionReason;
  }

  const review: DirectCodexSampleReview = {
    sampleId: o.sampleId as string,
    decision,
    ...(rejectionReason !== undefined ? { rejectionReason } : {}),
    reviewer: "main-codex",
    reviewedAt: o.reviewedAt as string,
    schemaVersion: 1,
  };
  freezeDeep(review);
  return review;
}
