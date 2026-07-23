// Direct-Codex publication service — privacy-safe preview and
// confirmed next-version registration from only immutable accepted
// paired samples.  No inference of confidence, profile, time, method,
// or review decisions.  No raw-content, prompt, diff, Task-name, path,
// model-config, credential, or legacy class-only fallback exposure.

import { StateStore } from "../state/store.js";
import {
  normalizeDirectCodexProfileId,
  publishDirectCodexCalibration,
  type DirectCodexPairedSample,
  type DirectCodexProfilePublication,
} from "./direct-codex-calibration.js";
import type { ConfidenceLevel } from "./token-efficiency.js";


function freezeDeep(v: unknown): void {
  if (v !== null && typeof v === "object" && !Object.isFrozen(v)) {
    if (Array.isArray(v)) { for (const e of v) freezeDeep(e); }
    else { for (const e of Object.values(v)) freezeDeep(e); }
    Object.freeze(v);
  }
}

function isValidTimestamp(s: unknown): s is string {
  if (typeof s !== "string" || s.trim().length === 0) return false;
  const ts = Date.parse(s);
  if (!Number.isFinite(ts)) return false;
  return new Date(s).toISOString() === s;
}


export type PublicationReadiness =
  | "ready"
  | "no-accepted-samples"
  | "no-new-evidence"
  | "unsafe-version";

export interface DirectCodexPublicationPreview {
  readonly exactTaskClass: string;
  readonly directCodexProfileId: string;
  readonly nextVersion: number | null;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly pendingCount: number;
  readonly acceptedSampleIds: readonly string[];
  readonly hasNewAcceptedEvidence: boolean;
  readonly readiness: PublicationReadiness;
}

export interface DirectCodexRegistrationSummary {
  readonly acceptedSampleCount: number;
  readonly acceptedSampleIds: readonly string[];
  readonly version: number;
}

export interface DirectCodexRegistrationResult {
  readonly publication: DirectCodexProfilePublication;
  readonly summary: DirectCodexRegistrationSummary;
}


// ---- individual field normalizers -------------------------------------

function normalizeExactTaskClass(input: unknown): string {
  if (typeof input !== "string" || input !== input.trim() || input.length === 0 || input.length > 80) {
    throw new TypeError("Invalid taskClass");
  }
  return input;
}

function normalizeMethod(input: unknown): string {
  if (typeof input !== "string" || input.trim().length < 1 || input.length > 120) {
    throw new TypeError("Invalid calibration method");
  }
  return input.trim();
}

function normalizeConfidence(input: unknown): ConfidenceLevel {
  if (typeof input !== "string" || !(["low", "medium", "high"] as string[]).includes(input)) {
    throw new TypeError("Invalid calibration confidence");
  }
  return input as ConfidenceLevel;
}

function normalizeCreatedAt(input: unknown): string {
  if (!isValidTimestamp(input)) throw new TypeError("Invalid calibration createdAt");
  return input as string;
}


// ---- provenance & evidence helpers ------------------------------------

const SAMPLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function computeNextVersion(latestVersion: number | undefined): number | "unsafe-version" {
  if (latestVersion === undefined) return 1;
  const next = latestVersion + 1;
  if (!Number.isSafeInteger(next) || next < 1) return "unsafe-version";
  return next;
}

function validatePriorPublicationProvenance(pub: DirectCodexProfilePublication): Set<string> {
  const refs = pub.calibration.evidenceReferences;
  if (refs.length !== pub.calibration.sampleSize) {
    throw new Error("Corrupt prior publication provenance in state database");
  }
  const ids = new Set<string>();
  for (const ref of refs) {
    if (!ref.startsWith("sample:")) {
      throw new Error("Corrupt prior publication provenance in state database");
    }
    const id = ref.slice(7);
    if (!SAMPLE_ID_RE.test(id)) {
      throw new Error("Corrupt prior publication provenance in state database");
    }
    if (ids.has(id)) throw new Error("Corrupt prior publication provenance in state database");
    ids.add(id);
  }
  return ids;
}

function evaluateEvidence(
  store: StateStore, exactTaskClass: string, exactProfileId: string,
): {
  acceptedSamples: DirectCodexPairedSample[]; acceptedSampleIds: readonly string[];
  rejectedCount: number; pendingCount: number; nextVersion: number | null;
  hasNewAcceptedEvidence: boolean; readiness: PublicationReadiness;
} {
  const allSamples = store.listDirectCodexPairedSamples(exactTaskClass, exactProfileId);
  const acceptedSamples: DirectCodexPairedSample[] = [];
  const rawAcceptedIds: string[] = [];
  let rejectedCount = 0, pendingCount = 0;

  for (const sample of allSamples) {
    const review = store.getDirectCodexSampleReviewOptional(sample.sampleId);
    if (review === undefined) { pendingCount++; }
    else if (review.decision === "accepted") { acceptedSamples.push(sample); rawAcceptedIds.push(sample.sampleId); }
    else { rejectedCount++; }
  }

  rawAcceptedIds.sort();
  const acceptedSampleIds: readonly string[] = Object.freeze(rawAcceptedIds);

  const latestPub = store.latestDirectCodexProfilePublication(exactTaskClass, exactProfileId);
  let priorIds: Set<string> | undefined;
  if (latestPub !== undefined) {
    priorIds = validatePriorPublicationProvenance(latestPub);
  }

  const versionResult = computeNextVersion(latestPub?.calibration.version);
  if (versionResult === "unsafe-version") {
    return { acceptedSamples, acceptedSampleIds, rejectedCount, pendingCount,
      nextVersion: null, hasNewAcceptedEvidence: false, readiness: "unsafe-version" };
  }
  const nextVersion = versionResult;

  let hasNewAcceptedEvidence = false;
  if (rawAcceptedIds.length > 0) {
    if (priorIds === undefined) { hasNewAcceptedEvidence = true; }
    else { hasNewAcceptedEvidence = rawAcceptedIds.some(id => !priorIds!.has(id)); }
  }

  let readiness: PublicationReadiness;
  if (acceptedSamples.length === 0) { readiness = "no-accepted-samples"; }
  else if (!hasNewAcceptedEvidence && latestPub !== undefined) { readiness = "no-new-evidence"; }
  else { readiness = "ready"; }

  return { acceptedSamples, acceptedSampleIds, rejectedCount, pendingCount,
    nextVersion, hasNewAcceptedEvidence, readiness };
}


// ---- strict descriptor-based param normalization ----------------------

/** Read only data-descriptor values from an untrusted plain object.
 *  Rejects non-objects, arrays, Proxies, non-standard prototypes, symbol
 *  keys, non-enumerable keys, and any accessor descriptor.  A getter on a
 *  required field (e.g. `get taskClass()`) is never invoked.
 *  Every reflection operation is wrapped in one try boundary — a throwing
 *  Proxy trap cannot leak attacker-controlled text into the error. */
function normalizeDescriptorRecord(
  input: unknown, allowedKeys: ReadonlySet<string>, errMsg: string,
): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(errMsg);
  }
  let proto: unknown; let descs: PropertyDescriptorMap; let ownKeys: Array<string | symbol>;
  try {
    proto = Object.getPrototypeOf(input);
    descs = Object.getOwnPropertyDescriptors(input as object);
    ownKeys = Reflect.ownKeys(input as object);
  } catch { throw new TypeError(errMsg); }
  if (proto !== Object.prototype && proto !== null) throw new TypeError(errMsg);
  const result: Record<string, unknown> = {};
  let keyCount = 0;
  for (const key of ownKeys) {
    if (typeof key === "symbol") throw new TypeError(errMsg);
    if (!allowedKeys.has(key)) throw new TypeError(errMsg);
    const d = descs[key]!;
    if (d.get !== undefined || d.set !== undefined) throw new TypeError(errMsg);
    if (d.enumerable !== true) throw new TypeError(errMsg);
    result[key] = d.value;
    keyCount++;
  }
  if (keyCount !== allowedKeys.size) throw new TypeError(errMsg);
  return result;
}

const PREVIEW_KEYS: ReadonlySet<string> = new Set(["taskClass", "directCodexProfileId"]);
const REG_KEYS: ReadonlySet<string> = new Set([
  "method", "confidence", "createdAt", "taskClass", "directCodexProfileId", "confirm",
]);


// ---- exported public entry points -------------------------------------

export function buildDirectCodexPublicationPreview(
  store: StateStore,
  params: unknown,
): DirectCodexPublicationPreview {
  const exact = normalizeDescriptorRecord(params, PREVIEW_KEYS, "Invalid publication preview parameters");
  if (typeof exact.taskClass !== "string" || typeof exact.directCodexProfileId !== "string") {
    throw new TypeError("Invalid publication preview parameters");
  }
  const exactTaskClass = normalizeExactTaskClass(exact.taskClass);
  const exactProfileId = normalizeDirectCodexProfileId(exact.directCodexProfileId);

  const ev = evaluateEvidence(store, exactTaskClass, exactProfileId);

  const preview: DirectCodexPublicationPreview = {
    exactTaskClass, directCodexProfileId: exactProfileId,
    nextVersion: ev.nextVersion, acceptedCount: ev.acceptedSamples.length,
    rejectedCount: ev.rejectedCount, pendingCount: ev.pendingCount,
    acceptedSampleIds: ev.acceptedSampleIds,
    hasNewAcceptedEvidence: ev.hasNewAcceptedEvidence, readiness: ev.readiness,
  };
  freezeDeep(preview);
  return preview;
}

export function registerDirectCodexPublication(
  store: StateStore,
  params: unknown,
): DirectCodexRegistrationResult {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    throw new TypeError("Invalid registration parameters");
  }
  let confirmDescriptor: PropertyDescriptor | undefined;
  try {
    confirmDescriptor = Object.getOwnPropertyDescriptor(params, "confirm");
  } catch {
    throw new TypeError("Invalid registration parameters");
  }
  if (confirmDescriptor === undefined || confirmDescriptor.get !== undefined
    || confirmDescriptor.set !== undefined || confirmDescriptor.value !== true) {
    throw new TypeError("Registration requires explicit confirm true");
  }

  const rec = normalizeDescriptorRecord(params, REG_KEYS, "Invalid registration parameters");

  const method = normalizeMethod(rec.method);
  const confidence = normalizeConfidence(rec.confidence);
  const createdAt = normalizeCreatedAt(rec.createdAt);
  const exactTaskClass = normalizeExactTaskClass(rec.taskClass);
  const exactProfileId = normalizeDirectCodexProfileId(rec.directCodexProfileId);

  const ev = evaluateEvidence(store, exactTaskClass, exactProfileId);

  if (ev.readiness !== "ready") throw new Error(`Publication not ready: ${ev.readiness}`);
  if (ev.acceptedSamples.length === 0) throw new Error("No accepted samples available for publication");
  if (ev.nextVersion === null) throw new Error("Unsafe publication version");

  const publication = publishDirectCodexCalibration(ev.acceptedSamples, {
    method, confidence, version: ev.nextVersion, taskClass: exactTaskClass,
    directCodexProfileId: exactProfileId, createdAt,
  });

  store.saveDirectCodexProfilePublication(publication);

  const summary: DirectCodexRegistrationSummary = {
    acceptedSampleCount: ev.acceptedSampleIds.length,
    acceptedSampleIds: ev.acceptedSampleIds, version: ev.nextVersion,
  };
  freezeDeep(summary);
  const result: DirectCodexRegistrationResult = { publication, summary };
  freezeDeep(result);
  return result;
}
