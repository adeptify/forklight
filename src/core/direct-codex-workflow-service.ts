// Direct-Codex calibration workflow — composes canonical adapters and Store
// operations into one capture → inbox → review → preview → register chain.
// No Token arithmetic, identity rules, review normalization, or publication
// logic is duplicated.  All writes are insert-only and all reads fail closed.

import { StateStore } from "../state/store.js";
import { buildDirectCodexPairedSample } from "./codex-terminal-usage.js";
import { normalizeDirectCodexSampleReview, type DirectCodexSampleReview } from "./direct-codex-review.js";
import {
  buildDirectCodexPublicationPreview,
  registerDirectCodexPublication,
  type DirectCodexPublicationPreview,
  type DirectCodexRegistrationResult,
} from "./direct-codex-publication-service.js";
import type { DirectCodexPairedSample } from "./direct-codex-calibration.js";
import { deepFreeze } from "./immutability.js";


const DUP_MSG = "Duplicate sample identity rejected";


// ---- Inbox types -------------------------------------------------------

export type DirectCodexInboxReviewState = "pending" | "accepted" | "rejected";

export interface DirectCodexInboxItem {
  readonly sample: DirectCodexPairedSample;
  readonly reviewState: DirectCodexInboxReviewState;
  readonly review?: DirectCodexSampleReview;
}


// ---- Capture -----------------------------------------------------------

/** Compose one count-only Codex terminal usage event plus seven explicit
 *  sample metadata fields into a canonical DirectCodexPairedSample,
 *  validate Task class/profile identity through the Store, and persist the
 *  immutable sample.  Returns the detached deeply-frozen canonical sample;
 *  throws a fixed non-echoing TypeError on any structural, numeric, or
 *  identity failure; maps SQLite UNIQUE to a fixed privacy-safe error. */
export function captureDirectCodexSample(
  store: StateStore,
  usage: unknown,
  metadata: unknown,
): DirectCodexPairedSample {
  const sample = buildDirectCodexPairedSample(usage, metadata);
  try {
    store.saveDirectCodexPairedSample(sample);
  } catch (e) {
    const sqlite = e as { code?: unknown; errcode?: unknown };
    if (e instanceof Error && sqlite.code === "ERR_SQLITE_ERROR"
      && (sqlite.errcode === 1555 || sqlite.errcode === 2067)) {
      throw new TypeError(DUP_MSG);
    }
    throw e;
  }
  return sample;
}


// ---- Inbox -------------------------------------------------------------

/** Return every DirectCodexPairedSample for an exact taskClass × profileId
 *  pair with explicit review state.  Identity validation is delegated
 *  entirely to the Store's {@link StateStore.listDirectCodexPairedSamples}
 *  (normalizeProfileQueryTaskClass + normalizeDirectCodexProfileId).
 *  Samples are ordered deterministically by capturedAt then sampleId.
 *  Every inbox item and the returned array are deeply frozen.  If any
 *  stored review row is corrupt the call fails closed — a corrupt review
 *  is never silently treated as pending. */
export function listDirectCodexInbox(
  store: StateStore,
  taskClass: unknown,
  profileId: unknown,
): readonly DirectCodexInboxItem[] {
  const samples = store.listDirectCodexPairedSamples(taskClass, profileId);
  const items: DirectCodexInboxItem[] = [];

  for (const sample of samples) {
    const review = store.getDirectCodexSampleReviewOptional(sample.sampleId);
    const reviewState: DirectCodexInboxReviewState = review === undefined
      ? "pending" : review.decision;
    const item: DirectCodexInboxItem = {
      sample,
      reviewState,
      ...(review !== undefined ? { review } : {}),
    };
    deepFreeze(item);
    items.push(item);
  }
  Object.freeze(items);
  return items;
}


// ---- Review ------------------------------------------------------------

const REVIEW_CONFIRM_MSG = "Review requires explicit confirm true";
const REVIEW_IMMUTABLE_MSG = "Review already exists for this sample";
const REVIEW_INVALID_MSG = "Invalid direct-Codex sample review";

const ACCEPTED_KEYS: ReadonlySet<string> = new Set([
  "sampleId", "decision", "reviewer", "reviewedAt", "schemaVersion",
]);
const REJECTED_KEYS: ReadonlySet<string> = new Set([
  "sampleId", "decision", "rejectionReason", "reviewer", "reviewedAt", "schemaVersion",
]);

/** Record one explicit immutable review decision for an existing
 *  DirectCodexPairedSample.  `params` must include `confirm: true` as a
 *  plain data property (not a getter), plus exactly the review fields
 *  required by {@link normalizeDirectCodexSampleReview}.  All property
 *  reads use descriptor-level access only — getters are never invoked,
 *  Proxy traps are caught and mapped to one fixed non-echoing error.
 *  Rejected decisions require exactly one bounded enum rejection reason;
 *  accepted decisions must not carry one.  The referenced sample/Task
 *  identity chain is revalidated before the insert.  Duplicate reviews
 *  are rejected.  Returns the detached deeply-frozen canonical review. */
export function recordDirectCodexReview(
  store: StateStore,
  params: unknown,
): DirectCodexSampleReview {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    throw new TypeError(REVIEW_CONFIRM_MSG);
  }

  // One safe descriptor traversal — getters never invoked, Proxy traps caught.
  let proto: unknown;
  let descs: PropertyDescriptorMap;
  let ownKeys: Array<string | symbol>;
  try {
    proto = Object.getPrototypeOf(params);
    descs = Object.getOwnPropertyDescriptors(params as object);
    ownKeys = Reflect.ownKeys(params as object);
  } catch {
    throw new TypeError(REVIEW_CONFIRM_MSG);
  }
  if (proto !== Object.prototype && proto !== null) throw new TypeError(REVIEW_CONFIRM_MSG);

  // Check confirm — plain data property, enumerable, value true.
  const cd = descs["confirm"];
  if (cd === undefined || cd.enumerable !== true
    || cd.get !== undefined || cd.set !== undefined || cd.value !== true) {
    throw new TypeError(REVIEW_CONFIRM_MSG);
  }

  // Check decision — must be "accepted" or "rejected" to select the key set.
  const dd = descs["decision"];
  if (dd === undefined || dd.get !== undefined || dd.set !== undefined
    || typeof dd.value !== "string" || !(["accepted", "rejected"] as string[]).includes(dd.value)) {
    throw new TypeError(REVIEW_INVALID_MSG);
  }
  const decision = dd.value as "accepted" | "rejected";
  const allowedKeys = decision === "accepted" ? ACCEPTED_KEYS : REJECTED_KEYS;

  // Build review-only record from descriptors, stripping confirm.
  const reviewInput: Record<string, unknown> = {};
  let keyCount = 0;
  for (const key of ownKeys) {
    if (typeof key === "symbol") throw new TypeError(REVIEW_INVALID_MSG);
    if (key === "confirm") continue;             // already validated, strip from review
    if (!allowedKeys.has(key)) throw new TypeError(REVIEW_INVALID_MSG);
    const d = descs[key]!;
    if (d.get !== undefined || d.set !== undefined) throw new TypeError(REVIEW_INVALID_MSG);
    if (d.enumerable !== true) throw new TypeError(REVIEW_INVALID_MSG);
    reviewInput[key] = d.value;
    keyCount++;
  }
  if (keyCount !== allowedKeys.size) throw new TypeError(REVIEW_INVALID_MSG);

  const review = normalizeDirectCodexSampleReview(reviewInput);

  // Verify sample identity chain; throws on unknown or corrupt.
  store.getDirectCodexPairedSample(review.sampleId);

  // Reject duplicate review — immutable.
  if (store.getDirectCodexSampleReviewOptional(review.sampleId) !== undefined) {
    throw new Error(REVIEW_IMMUTABLE_MSG);
  }

  store.saveDirectCodexSampleReview(review);
  return review;
}


// ---- Publication preview & registration --------------------------------

export function previewDirectCodexPublication(
  store: StateStore,
  params: unknown,
): DirectCodexPublicationPreview {
  return buildDirectCodexPublicationPreview(store, params);
}

export function registerDirectCodexCalibrationPublication(
  store: StateStore,
  params: unknown,
): DirectCodexRegistrationResult {
  return registerDirectCodexPublication(store, params);
}
