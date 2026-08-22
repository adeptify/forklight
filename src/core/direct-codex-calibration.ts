// Direct-Codex paired-sample calibration — pure, privacy-safe core.
// Converts explicitly measured direct-Codex Token usage for equivalent
// ForkLight tasks into one versioned exact-class calibration record.
// No confidence inference, raw-content fields, persistence, or Provider access.

import {
  normalizeDirectCodexCalibrationRecord,
  type ConfidenceLevel,
  type DirectCodexCalibrationRecord,
} from "./token-efficiency.js";
import { deepFreeze } from "./immutability.js";


export interface DirectCodexPairedSample {
  readonly sampleId: string;
  readonly forklightTaskId: string;
  readonly exactTaskClass: string;
  readonly directCodexProfileId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly source: "codex-terminal-result";
  readonly complete: true;
  readonly directRunRef: string;
  readonly pairingRef: string;
  readonly capturedAt: string;
  readonly schemaVersion: 1;
}


const isNNInt = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const isValidTimestamp = (s: unknown): s is string => {
  if (typeof s !== "string" || s.trim().length === 0) return false;
  const ts = Date.parse(s);
  if (!Number.isFinite(ts)) return false;
  return new Date(s).toISOString() === s;
};
const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

const STRICT_TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const PROFILE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const RUN_REF = /^codex-run:[A-Za-z0-9._-]{1,128}$/;
const PAIR_REF = /^pair:[A-Za-z0-9._-]{1,128}$/;


/** Canonical exact direct-Codex profile identity normalizer.  Validates a
 *  caller-supplied profile identity against the exact bounded non-content
 *  identifier rule shared by samples, publications, TaskSpec, and selectors.
 *  Returns the identical string on success; throws a non-echoing TypeError
 *  on failure.  No trimming, inference, hashing, provider lookup, or model
 *  lookup is performed. */
export function normalizeDirectCodexProfileId(
  id: unknown,
): string {
  if (typeof id !== "string" || !PROFILE_ID.test(id)) {
    throw new TypeError("Invalid directCodexProfileId");
  }
  return id;
}

const SAMPLE_KEYS = new Set([
  "sampleId", "forklightTaskId", "exactTaskClass", "directCodexProfileId",
  "inputTokens", "outputTokens",
  "cacheReadInputTokens", "cacheCreationInputTokens", "source", "complete",
  "directRunRef", "pairingRef", "capturedAt", "schemaVersion",
]);

const RAW_FIELDS = new Set([
  "text", "content", "prompt", "body", "payload", "raw", "secret", "credential",
  "log", "response", "request", "sourceText", "sourceHash",
]);
const ENVELOPE_KEYS = new Set([
  "directCodexProfileId", "calibration", "envelopeSchemaVersion",
]);


export function normalizeDirectCodexPairedSample(
  input: unknown,
): DirectCodexPairedSample {
  if (input === null || typeof input !== "object") throw new TypeError("Invalid direct-Codex paired sample");
  const o = input as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (!SAMPLE_KEYS.has(key)) throw new TypeError("Invalid direct-Codex paired sample");
  }
  for (const key of SAMPLE_KEYS) {
    if (!hasOwn(o, key)) throw new TypeError("Invalid direct-Codex paired sample");
  }
  for (const f of RAW_FIELDS) {
    if (hasOwn(o, f)) throw new TypeError("Invalid direct-Codex paired sample");
  }
  if (typeof o.sampleId !== "string" || !STRICT_TOKEN.test(o.sampleId)) {
    throw new TypeError("Invalid direct-Codex paired sample");
  }
  if (typeof o.forklightTaskId !== "string" || !STRICT_TOKEN.test(o.forklightTaskId)) {
    throw new TypeError("Invalid direct-Codex paired sample");
  }
  if (typeof o.exactTaskClass !== "string" || o.exactTaskClass !== o.exactTaskClass.trim()
    || o.exactTaskClass.trim().length < 1 || o.exactTaskClass.length > 80) {
    throw new TypeError("Invalid direct-Codex paired sample");
  }
  normalizeDirectCodexProfileId(o.directCodexProfileId);
  if (o.source !== "codex-terminal-result" || o.complete !== true || o.schemaVersion !== 1) {
    throw new TypeError("Invalid direct-Codex paired sample");
  }
  if (!isNNInt(o.inputTokens) || !isNNInt(o.outputTokens)
    || !isNNInt(o.cacheReadInputTokens) || !isNNInt(o.cacheCreationInputTokens)) {
    throw new TypeError("Invalid direct-Codex paired sample");
  }
  const gross = (o.inputTokens as number) + (o.outputTokens as number)
    + (o.cacheReadInputTokens as number) + (o.cacheCreationInputTokens as number);
  if (!Number.isSafeInteger(gross)) throw new TypeError("Invalid direct-Codex paired sample");
  if (typeof o.directRunRef !== "string" || !RUN_REF.test(o.directRunRef)) {
    throw new TypeError("Invalid direct-Codex paired sample");
  }
  if (typeof o.pairingRef !== "string" || !PAIR_REF.test(o.pairingRef)) {
    throw new TypeError("Invalid direct-Codex paired sample");
  }
  if (!isValidTimestamp(o.capturedAt)) throw new TypeError("Invalid direct-Codex paired sample");
  const sample: DirectCodexPairedSample = {
    sampleId: o.sampleId as string,
    forklightTaskId: o.forklightTaskId as string,
    exactTaskClass: o.exactTaskClass as string,
    directCodexProfileId: o.directCodexProfileId as string,
    inputTokens: o.inputTokens as number,
    outputTokens: o.outputTokens as number,
    cacheReadInputTokens: o.cacheReadInputTokens as number,
    cacheCreationInputTokens: o.cacheCreationInputTokens as number,
    source: "codex-terminal-result",
    complete: true,
    directRunRef: o.directRunRef as string,
    pairingRef: o.pairingRef as string,
    capturedAt: o.capturedAt as string,
    schemaVersion: 1,
  };
  deepFreeze(sample);
  return sample;
}


export function grossDirectCodexTokens(sample: unknown): number {
  const s = normalizeDirectCodexPairedSample(sample);
  const gross = s.inputTokens + s.outputTokens
    + s.cacheReadInputTokens + s.cacheCreationInputTokens;
  if (!Number.isSafeInteger(gross)) throw new TypeError("Invalid direct-Codex paired sample");
  return gross;
}


export interface DirectCodexProfilePublication {
  readonly directCodexProfileId: string;
  readonly calibration: DirectCodexCalibrationRecord;
  readonly envelopeSchemaVersion: 1;
}


/** Revalidate a stored or transported publication without trusting TS types. */
export function normalizeDirectCodexProfilePublication(
  input: unknown,
): DirectCodexProfilePublication {
  if (input === null || typeof input !== "object") {
    throw new TypeError("Invalid direct-Codex profile publication");
  }
  const o = input as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== ENVELOPE_KEYS.size || keys.some(key => !ENVELOPE_KEYS.has(key))) {
    throw new TypeError("Invalid direct-Codex profile publication");
  }
  const directCodexProfileId = normalizeDirectCodexProfileId(o.directCodexProfileId);
  if (o.envelopeSchemaVersion !== 1) {
    throw new TypeError("Invalid direct-Codex profile publication");
  }
  const envelope: DirectCodexProfilePublication = {
    directCodexProfileId,
    calibration: normalizeDirectCodexCalibrationRecord(o.calibration),
    envelopeSchemaVersion: 1,
  };
  deepFreeze(envelope);
  return envelope;
}


export function publishDirectCodexCalibration(
  samples: readonly unknown[],
  params: {
    method: string;
    confidence: ConfidenceLevel;
    version: number;
    taskClass: string;
    directCodexProfileId: string;
    createdAt: string;
  },
): DirectCodexProfilePublication {
  if (samples.length < 1 || samples.length > 50) {
    throw new TypeError("Calibration requires 1–50 samples");
  }
  if (typeof params.method !== "string" || params.method.trim().length < 1 || params.method.length > 120) {
    throw new TypeError("Invalid calibration method");
  }
  if (typeof params.confidence !== "string" || !(["low", "medium", "high"] as string[]).includes(params.confidence)) {
    throw new TypeError("Invalid calibration confidence");
  }
  if (!Number.isSafeInteger(params.version) || params.version < 1) {
    throw new TypeError("Invalid calibration version");
  }
  if (typeof params.taskClass !== "string" || params.taskClass !== params.taskClass.trim()
    || params.taskClass.trim().length < 1 || params.taskClass.length > 80) {
    throw new TypeError("Invalid calibration taskClass");
  }
  normalizeDirectCodexProfileId(params.directCodexProfileId);
  if (!isValidTimestamp(params.createdAt)) {
    throw new TypeError("Invalid calibration createdAt");
  }
  const explicitClass = params.taskClass;
  const explicitProfile = params.directCodexProfileId;
  const seenIds = new Set<string>();
  const seenTasks = new Set<string>();
  const seenRuns = new Set<string>();
  const seenPairs = new Set<string>();
  const canonical: DirectCodexPairedSample[] = [];
  for (let i = 0; i < samples.length; i++) {
    const s = normalizeDirectCodexPairedSample(samples[i]);
    if (s.exactTaskClass !== explicitClass) {
      throw new TypeError("Sample taskClass does not match explicit calibration taskClass");
    }
    if (s.directCodexProfileId !== explicitProfile) {
      throw new TypeError("Sample directCodexProfileId does not match explicit calibration profile");
    }
    if (seenIds.has(s.sampleId)) throw new TypeError("Duplicate sampleId rejected");
    seenIds.add(s.sampleId);
    if (seenTasks.has(s.forklightTaskId)) throw new TypeError("Duplicate forklightTaskId rejected");
    seenTasks.add(s.forklightTaskId);
    if (seenRuns.has(s.directRunRef)) throw new TypeError("Duplicate directRunRef rejected");
    seenRuns.add(s.directRunRef);
    if (seenPairs.has(s.pairingRef)) throw new TypeError("Duplicate pairingRef rejected");
    seenPairs.add(s.pairingRef);
    canonical.push(s);
  }
  // Canonicalize order by sampleId for deterministic output regardless of input order
  canonical.sort((a, b) => a.sampleId < b.sampleId ? -1 : a.sampleId > b.sampleId ? 1 : 0);
  let minT = Number.MAX_SAFE_INTEGER, maxT = 0;
  for (const s of canonical) {
    const g = s.inputTokens + s.outputTokens + s.cacheReadInputTokens + s.cacheCreationInputTokens;
    if (g < minT) minT = g;
    if (g > maxT) maxT = g;
  }
  const evidenceRefs = canonical.map(s => `sample:${s.sampleId}`);
  const calibration = normalizeDirectCodexCalibrationRecord({
    minTokens: minT, maxTokens: maxT,
    method: params.method.trim(), taskClass: explicitClass,
    confidence: params.confidence, version: params.version,
    sampleSize: canonical.length, evidenceReferences: evidenceRefs,
    createdAt: params.createdAt, schemaVersion: 1 as const,
  });
  return normalizeDirectCodexProfilePublication({
    directCodexProfileId: explicitProfile, calibration, envelopeSchemaVersion: 1,
  });
}
