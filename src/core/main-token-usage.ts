// Role-aware complete Main usage capture — count-only, privacy-safe.
// Reuses normalizeCodexTerminalUsage for disjoint Codex terminal counters.
// Derives taskClass / taskFamily / directCodexProfileId only from a stored Task.
// No tokenizer, raw content, saving arithmetic, pair validity, or work creation.

import { randomUUID } from "node:crypto";
import { normalizeCodexTerminalUsage } from "./codex-terminal-usage.js";
import { normalizeDirectCodexProfileId } from "./direct-codex-calibration.js";
import { isoTimestamp } from "./time.js";

/** Minimal Store port so this module stays free of a StateStore import cycle. */
export interface MainUsageStore {
  getTask(taskId: string): {
    spec: {
      taskClass?: string;
      taskFamily?: string;
      directCodexProfileId?: string;
    };
  };
  saveMainUsageSample(sample: MainUsageSample): void;
  listMainUsageSamples(taskId: unknown, comparisonId: unknown): MainUsageSample[];
  listMainUsageSamplesByComparison(comparisonId: unknown): MainUsageSample[];
}


export const MAIN_USAGE_ROLES = ["direct-main", "delegated-main"] as const;
export type MainUsageRole = (typeof MAIN_USAGE_ROLES)[number];

export const MAIN_USAGE_SOURCE = "codex-terminal-result" as const;
export const MAIN_USAGE_SCHEMA_VERSION = 1 as const;
export const MAIN_USAGE_EPISODE_SCHEMA_VERSION = 2 as const;
export const MIN_MAIN_USAGE_EPISODE_SEGMENTS = 2 as const;
export const MAX_MAIN_USAGE_EPISODE_SEGMENTS = 16 as const;

export interface MainUsageEpisodeSegment {
  readonly ordinal: number;
  readonly runRef: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly grossTokens: number;
}

export interface MainUsageSample {
  readonly sampleId: string;
  readonly forklightTaskId: string;
  readonly comparisonId: string;
  readonly role: MainUsageRole;
  readonly taskClass: string;
  readonly taskFamily: string;
  readonly directCodexProfileId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly grossTokens: number;
  readonly source: typeof MAIN_USAGE_SOURCE;
  readonly runRef: string;
  readonly capturedAt: string;
  readonly schemaVersion: typeof MAIN_USAGE_SCHEMA_VERSION | typeof MAIN_USAGE_EPISODE_SCHEMA_VERSION;
  readonly segments?: readonly MainUsageEpisodeSegment[];
}

export interface MainUsageStatus {
  readonly forklightTaskId: string;
  readonly comparisonId: string;
  readonly taskClass?: string;
  readonly taskFamily?: string;
  readonly directCodexProfileId?: string;
  readonly capturedRoles: readonly MainUsageRole[];
  readonly missingRoles: readonly MainUsageRole[];
  readonly countComplete: boolean;
  readonly samples: readonly MainUsageSample[];
  readonly schemaVersion: typeof MAIN_USAGE_SCHEMA_VERSION;
}

export type SampleIdFactory = () => string;
export type TimestampFactory = () => string;

export const INVALID_MAIN_USAGE_CAPTURE = "Invalid Main usage capture";
export const INVALID_MAIN_USAGE_SAMPLE = "Invalid Main usage sample";
export const INVALID_MAIN_USAGE_STATUS = "Invalid Main usage status query";
export const TASK_NOT_FOUND_CAPTURE = "ForkLight Task not found for Main usage capture";
export const TASK_NOT_FOUND_STATUS = "ForkLight Task not found for Main usage status";
export const NOT_MAIN_USAGE_READY =
  "Task is not Main-usage-ready: taskClass, taskFamily and directCodexProfileId are required";
export const CONTRADICTORY_IDENTITY = "Contradictory Main usage identity";
export const DUPLICATE_MAIN_USAGE = "Duplicate Main usage identity rejected";
export const UNKNOWN_MAIN_USAGE_SAMPLE = "Unknown Main usage sample";
export const CORRUPT_MAIN_USAGE_SAMPLE = "Corrupt Main usage sample record in state database";
export const SAMPLE_UNKNOWN_TASK = "Sample references unknown Task";
export const SAMPLE_IDENTITY_MISMATCH = "Sample identity does not match declared Task identity";
export const INVALID_MAIN_USAGE_EPISODE = "Invalid Main usage episode";
export const DUPLICATE_MAIN_USAGE_SEGMENT = "Duplicate Main usage episode segment rejected";

const CAPTURE_KEYS: ReadonlySet<string> = new Set([
  "taskId", "comparisonId", "role", "runRef", "usage",
]);
const EPISODE_CAPTURE_KEYS: ReadonlySet<string> = new Set([
  "taskId", "comparisonId", "role", "runRef", "segments",
]);
const EPISODE_REQUEST_SEGMENT_KEYS: ReadonlySet<string> = new Set(["runRef", "usage"]);
const IDENTITY_OVERRIDE_KEYS: ReadonlySet<string> = new Set([
  "taskClass", "taskFamily", "directCodexProfileId", "exactTaskClass",
]);
const SAMPLE_PARENT_KEYS: ReadonlySet<string> = new Set([
  "sampleId", "forklightTaskId", "comparisonId", "role",
  "taskClass", "taskFamily", "directCodexProfileId",
  "inputTokens", "outputTokens", "cacheReadInputTokens", "cacheCreationInputTokens",
  "grossTokens", "source", "runRef", "capturedAt", "schemaVersion",
]);
const SAMPLE_EPISODE_KEYS: ReadonlySet<string> = new Set([...SAMPLE_PARENT_KEYS, "segments"]);
const EPISODE_SEGMENT_KEYS: ReadonlySet<string> = new Set([
  "ordinal", "runRef", "inputTokens", "outputTokens",
  "cacheReadInputTokens", "cacheCreationInputTokens", "grossTokens",
]);
const STATUS_FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  "change", "saving", "savings", "directCodexSavings", "quality", "familyValue",
]);
const RAW_FIELDS: ReadonlySet<string> = new Set([
  "text", "content", "prompt", "body", "payload", "raw", "secret", "credential",
  "log", "response", "request", "sourceText", "sourceHash", "diff", "path",
]);

const STRICT_TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const COMPARISON_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RUN_REF = /^codex-run:[A-Za-z0-9._-]{1,128}$/;
const TASK_LABEL = /^[^\s].{0,79}$/;

const defaultSampleId: SampleIdFactory = () => `mus-${randomUUID()}`;
const defaultTimestamp: TimestampFactory = () => isoTimestamp();

function freezeDeep(v: unknown): void {
  if (v === null || typeof v !== "object" || Object.isFrozen(v)) return;
  if (Array.isArray(v)) { for (const e of v) freezeDeep(e); }
  else { for (const e of Object.values(v)) freezeDeep(e); }
  Object.freeze(v);
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

function isMainUsageRole(value: unknown): value is MainUsageRole {
  return value === "direct-main" || value === "delegated-main";
}

function isBoundedTaskLabel(value: unknown): value is string {
  return typeof value === "string" && value === value.trim() && TASK_LABEL.test(value);
}

export function normalizeMainUsageComparisonId(id: unknown): string {
  if (typeof id !== "string" || !COMPARISON_ID.test(id)) {
    throw new TypeError(INVALID_MAIN_USAGE_SAMPLE);
  }
  return id;
}

export function normalizeMainUsageRunRef(ref: unknown): string {
  if (typeof ref !== "string" || !RUN_REF.test(ref)) {
    throw new TypeError(INVALID_MAIN_USAGE_SAMPLE);
  }
  return ref;
}

function addDisjoint(left: number, right: number, message: string): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum) || sum < 0) throw new TypeError(message);
  return sum;
}

function fourCounterGross(
  inputTokens: number,
  outputTokens: number,
  cacheReadInputTokens: number,
  cacheCreationInputTokens: number,
  message: string,
): number {
  return addDisjoint(
    addDisjoint(inputTokens, outputTokens, message),
    addDisjoint(cacheReadInputTokens, cacheCreationInputTokens, message),
    message,
  );
}

function rejectUnknownKeys(
  o: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  message: string,
): void {
  for (const key of Object.keys(o)) {
    if (!allowed.has(key) || RAW_FIELDS.has(key)) throw new TypeError(message);
  }
}

function requireKeys(o: Record<string, unknown>, required: ReadonlySet<string>, message: string): void {
  for (const key of required) {
    if (!hasOwn(o, key)) throw new TypeError(message);
  }
}

function normalizeEpisodeSegment(input: unknown, expectedOrdinal: number): MainUsageEpisodeSegment {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(INVALID_MAIN_USAGE_SAMPLE);
  }
  const o = input as Record<string, unknown>;
  rejectUnknownKeys(o, EPISODE_SEGMENT_KEYS, INVALID_MAIN_USAGE_SAMPLE);
  requireKeys(o, EPISODE_SEGMENT_KEYS, INVALID_MAIN_USAGE_SAMPLE);
  if (!isNNInt(o.ordinal) || o.ordinal !== expectedOrdinal) {
    throw new TypeError(INVALID_MAIN_USAGE_SAMPLE);
  }
  const runRef = normalizeMainUsageRunRef(o.runRef);
  if (!isNNInt(o.inputTokens) || !isNNInt(o.outputTokens)
    || !isNNInt(o.cacheReadInputTokens) || !isNNInt(o.cacheCreationInputTokens)
    || !isNNInt(o.grossTokens)) {
    throw new TypeError(INVALID_MAIN_USAGE_SAMPLE);
  }
  const gross = fourCounterGross(
    o.inputTokens, o.outputTokens, o.cacheReadInputTokens, o.cacheCreationInputTokens,
    INVALID_MAIN_USAGE_SAMPLE,
  );
  if (gross !== o.grossTokens) throw new TypeError(INVALID_MAIN_USAGE_SAMPLE);
  const segment: MainUsageEpisodeSegment = {
    ordinal: expectedOrdinal,
    runRef,
    inputTokens: o.inputTokens,
    outputTokens: o.outputTokens,
    cacheReadInputTokens: o.cacheReadInputTokens,
    cacheCreationInputTokens: o.cacheCreationInputTokens,
    grossTokens: gross,
  };
  freezeDeep(segment);
  return segment;
}

function normalizeEpisodeSegments(
  input: unknown,
  parentRunRef: string,
): readonly MainUsageEpisodeSegment[] {
  if (!Array.isArray(input)
    || input.length < MIN_MAIN_USAGE_EPISODE_SEGMENTS
    || input.length > MAX_MAIN_USAGE_EPISODE_SEGMENTS) {
    throw new TypeError(INVALID_MAIN_USAGE_SAMPLE);
  }
  const seen = new Set<string>();
  const segments: MainUsageEpisodeSegment[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const segment = normalizeEpisodeSegment(input[index], index + 1);
    if (segment.runRef === parentRunRef || seen.has(segment.runRef)) {
      throw new TypeError(INVALID_MAIN_USAGE_SAMPLE);
    }
    seen.add(segment.runRef);
    segments.push(segment);
  }
  freezeDeep(segments);
  return segments;
}

function parentCountersFromSegments(segments: readonly MainUsageEpisodeSegment[]): {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  grossTokens: number;
} {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadInputTokens = 0;
  let cacheCreationInputTokens = 0;
  for (const segment of segments) {
    inputTokens = addDisjoint(inputTokens, segment.inputTokens, INVALID_MAIN_USAGE_SAMPLE);
    outputTokens = addDisjoint(outputTokens, segment.outputTokens, INVALID_MAIN_USAGE_SAMPLE);
    cacheReadInputTokens = addDisjoint(
      cacheReadInputTokens, segment.cacheReadInputTokens, INVALID_MAIN_USAGE_SAMPLE,
    );
    cacheCreationInputTokens = addDisjoint(
      cacheCreationInputTokens, segment.cacheCreationInputTokens, INVALID_MAIN_USAGE_SAMPLE,
    );
  }
  return {
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    grossTokens: fourCounterGross(
      inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens,
      INVALID_MAIN_USAGE_SAMPLE,
    ),
  };
}

export function normalizeMainUsageSample(input: unknown): MainUsageSample {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(INVALID_MAIN_USAGE_SAMPLE);
  }
  const o = input as Record<string, unknown>;
  const episode = o.schemaVersion === MAIN_USAGE_EPISODE_SCHEMA_VERSION;
  const allowed = episode ? SAMPLE_EPISODE_KEYS : SAMPLE_PARENT_KEYS;
  rejectUnknownKeys(o, allowed, INVALID_MAIN_USAGE_SAMPLE);
  requireKeys(o, allowed, INVALID_MAIN_USAGE_SAMPLE);
  if (typeof o.sampleId !== "string" || !STRICT_TOKEN.test(o.sampleId)) {
    throw new TypeError(INVALID_MAIN_USAGE_SAMPLE);
  }
  if (typeof o.forklightTaskId !== "string" || !STRICT_TOKEN.test(o.forklightTaskId)) {
    throw new TypeError(INVALID_MAIN_USAGE_SAMPLE);
  }
  const comparisonId = normalizeMainUsageComparisonId(o.comparisonId);
  if (!isMainUsageRole(o.role)) throw new TypeError(INVALID_MAIN_USAGE_SAMPLE);
  if (!isBoundedTaskLabel(o.taskClass) || !isBoundedTaskLabel(o.taskFamily)) {
    throw new TypeError(INVALID_MAIN_USAGE_SAMPLE);
  }
  const directCodexProfileId = normalizeDirectCodexProfileId(o.directCodexProfileId);
  if (o.source !== MAIN_USAGE_SOURCE) throw new TypeError(INVALID_MAIN_USAGE_SAMPLE);
  if (episode) {
    if (o.schemaVersion !== MAIN_USAGE_EPISODE_SCHEMA_VERSION) {
      throw new TypeError(INVALID_MAIN_USAGE_SAMPLE);
    }
  } else if (o.schemaVersion !== MAIN_USAGE_SCHEMA_VERSION) {
    throw new TypeError(INVALID_MAIN_USAGE_SAMPLE);
  }
  if (!isNNInt(o.inputTokens) || !isNNInt(o.outputTokens)
    || !isNNInt(o.cacheReadInputTokens) || !isNNInt(o.cacheCreationInputTokens)
    || !isNNInt(o.grossTokens)) {
    throw new TypeError(INVALID_MAIN_USAGE_SAMPLE);
  }
  const parentGross = fourCounterGross(
    o.inputTokens as number, o.outputTokens as number,
    o.cacheReadInputTokens as number, o.cacheCreationInputTokens as number,
    INVALID_MAIN_USAGE_SAMPLE,
  );
  if (parentGross !== o.grossTokens) throw new TypeError(INVALID_MAIN_USAGE_SAMPLE);
  const runRef = normalizeMainUsageRunRef(o.runRef);
  if (!isValidTimestamp(o.capturedAt)) throw new TypeError(INVALID_MAIN_USAGE_SAMPLE);
  const sample: MainUsageSample = {
    sampleId: o.sampleId as string,
    forklightTaskId: o.forklightTaskId as string,
    comparisonId,
    role: o.role,
    taskClass: o.taskClass,
    taskFamily: o.taskFamily,
    directCodexProfileId,
    inputTokens: o.inputTokens as number,
    outputTokens: o.outputTokens as number,
    cacheReadInputTokens: o.cacheReadInputTokens as number,
    cacheCreationInputTokens: o.cacheCreationInputTokens as number,
    grossTokens: parentGross,
    source: MAIN_USAGE_SOURCE,
    runRef,
    capturedAt: o.capturedAt as string,
    schemaVersion: episode ? MAIN_USAGE_EPISODE_SCHEMA_VERSION : MAIN_USAGE_SCHEMA_VERSION,
  };
  if (episode) {
    const segments = normalizeEpisodeSegments(o.segments, runRef);
    const summed = parentCountersFromSegments(segments);
    if (
      summed.inputTokens !== sample.inputTokens
      || summed.outputTokens !== sample.outputTokens
      || summed.cacheReadInputTokens !== sample.cacheReadInputTokens
      || summed.cacheCreationInputTokens !== sample.cacheCreationInputTokens
      || summed.grossTokens !== sample.grossTokens
    ) {
      throw new TypeError(INVALID_MAIN_USAGE_SAMPLE);
    }
    const episodeSample: MainUsageSample = { ...sample, segments };
    freezeDeep(episodeSample);
    return episodeSample;
  }
  freezeDeep(sample);
  return sample;
}

function assertNoStatusClaimFields(value: object): void {
  for (const key of Object.keys(value)) {
    if (STATUS_FORBIDDEN_KEYS.has(key)) throw new TypeError(INVALID_MAIN_USAGE_STATUS);
  }
}

function deriveTaskIdentity(task: { spec: {
  taskClass?: string;
  taskFamily?: string;
  directCodexProfileId?: string;
} }): { taskClass: string; taskFamily: string; directCodexProfileId: string } {
  const taskClass = task.spec.taskClass;
  const taskFamily = task.spec.taskFamily;
  const directCodexProfileId = task.spec.directCodexProfileId;
  if (!taskClass || !taskFamily || !directCodexProfileId) {
    throw new TypeError(NOT_MAIN_USAGE_READY);
  }
  return { taskClass, taskFamily, directCodexProfileId };
}

function loadTaskOr(store: MainUsageStore, taskId: string, notFound: string) {
  try {
    return store.getTask(taskId);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Unknown ForkLight task:")) {
      throw new TypeError(notFound);
    }
    throw e;
  }
}

function mapUniqueFailure(error: unknown): never {
  const sqlite = error as { code?: unknown; errcode?: unknown };
  if (error instanceof Error && sqlite.code === "ERR_SQLITE_ERROR"
    && (sqlite.errcode === 1555 || sqlite.errcode === 2067)) {
    throw new TypeError(DUPLICATE_MAIN_USAGE);
  }
  throw error;
}

/** Build one detached count-only sample from a complete Codex terminal event
 *  plus Task-derived identity. Usage is validated by the canonical adapter. */
export function buildMainUsageSample(
  usage: unknown,
  metadata: {
    readonly sampleId: string;
    readonly forklightTaskId: string;
    readonly comparisonId: string;
    readonly role: MainUsageRole;
    readonly taskClass: string;
    readonly taskFamily: string;
    readonly directCodexProfileId: string;
    readonly runRef: string;
    readonly capturedAt: string;
  },
): MainUsageSample {
  const totals = normalizeCodexTerminalUsage(usage);
  const inputTokens = totals.uncachedInputTokens;
  const outputTokens = totals.totalOutputTokens;
  const cacheReadInputTokens = totals.cacheReadInputTokens;
  const cacheCreationInputTokens = totals.cacheCreationInputTokens;
  const grossTokens = inputTokens + outputTokens
    + cacheReadInputTokens + cacheCreationInputTokens;
  return normalizeMainUsageSample({
    sampleId: metadata.sampleId,
    forklightTaskId: metadata.forklightTaskId,
    comparisonId: metadata.comparisonId,
    role: metadata.role,
    taskClass: metadata.taskClass,
    taskFamily: metadata.taskFamily,
    directCodexProfileId: metadata.directCodexProfileId,
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    grossTokens,
    source: MAIN_USAGE_SOURCE,
    runRef: metadata.runRef,
    capturedAt: metadata.capturedAt,
    schemaVersion: MAIN_USAGE_SCHEMA_VERSION,
  });
}

function parseCaptureEnvelope(
  params: unknown,
  allowedKeys: ReadonlySet<string>,
): {
  raw: Record<string, unknown>;
  taskId: string;
  comparisonId: string;
  role: MainUsageRole;
  runRef: string;
} {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    throw new TypeError(INVALID_MAIN_USAGE_CAPTURE);
  }
  const raw = params as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (IDENTITY_OVERRIDE_KEYS.has(key)) throw new TypeError(CONTRADICTORY_IDENTITY);
    if (!allowedKeys.has(key) || RAW_FIELDS.has(key)) {
      throw new TypeError(INVALID_MAIN_USAGE_CAPTURE);
    }
  }
  requireKeys(raw, allowedKeys, INVALID_MAIN_USAGE_CAPTURE);

  const taskId = raw.taskId;
  const comparisonId = raw.comparisonId;
  const role = raw.role;
  const runRef = raw.runRef;
  if (typeof taskId !== "string" || !STRICT_TOKEN.test(taskId)) {
    throw new TypeError(INVALID_MAIN_USAGE_CAPTURE);
  }
  if (typeof comparisonId !== "string" || !COMPARISON_ID.test(comparisonId)) {
    throw new TypeError(INVALID_MAIN_USAGE_CAPTURE);
  }
  if (!isMainUsageRole(role)) throw new TypeError(INVALID_MAIN_USAGE_CAPTURE);
  if (typeof runRef !== "string" || !RUN_REF.test(runRef)) {
    throw new TypeError(INVALID_MAIN_USAGE_CAPTURE);
  }
  return { raw, taskId, comparisonId, role, runRef };
}

function loadCaptureIdentity(
  store: MainUsageStore,
  taskId: string,
  comparisonId: string,
): { taskClass: string; taskFamily: string; directCodexProfileId: string } {
  const task = loadTaskOr(store, taskId, TASK_NOT_FOUND_CAPTURE);
  const identity = deriveTaskIdentity(task);
  const existing = store.listMainUsageSamplesByComparison(comparisonId);
  for (const sample of existing) {
    if (sample.forklightTaskId !== taskId
      || sample.taskClass !== identity.taskClass
      || sample.taskFamily !== identity.taskFamily
      || sample.directCodexProfileId !== identity.directCodexProfileId) {
      throw new TypeError(CONTRADICTORY_IDENTITY);
    }
  }
  return identity;
}

function persistUsageSample(store: MainUsageStore, sample: MainUsageSample): MainUsageSample {
  try {
    store.saveMainUsageSample(sample);
  } catch (e) {
    mapUniqueFailure(e);
  }
  return sample;
}

function countersFromTerminalUsage(usage: unknown): {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  grossTokens: number;
} {
  const totals = normalizeCodexTerminalUsage(usage);
  const inputTokens = totals.uncachedInputTokens;
  const outputTokens = totals.totalOutputTokens;
  const cacheReadInputTokens = totals.cacheReadInputTokens;
  const cacheCreationInputTokens = totals.cacheCreationInputTokens;
  return {
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    grossTokens: fourCounterGross(
      inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens,
      INVALID_MAIN_USAGE_EPISODE,
    ),
  };
}

function buildEpisodeSegments(input: unknown, episodeRunRef: string): MainUsageEpisodeSegment[] {
  if (!Array.isArray(input)
    || input.length < MIN_MAIN_USAGE_EPISODE_SEGMENTS
    || input.length > MAX_MAIN_USAGE_EPISODE_SEGMENTS) {
    throw new TypeError(INVALID_MAIN_USAGE_EPISODE);
  }
  const seen = new Set<string>();
  const segments: MainUsageEpisodeSegment[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const entry = input[index];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError(INVALID_MAIN_USAGE_EPISODE);
    }
    const raw = entry as Record<string, unknown>;
    rejectUnknownKeys(raw, EPISODE_REQUEST_SEGMENT_KEYS, INVALID_MAIN_USAGE_EPISODE);
    requireKeys(raw, EPISODE_REQUEST_SEGMENT_KEYS, INVALID_MAIN_USAGE_EPISODE);
    if (typeof raw.runRef !== "string" || !RUN_REF.test(raw.runRef)) {
      throw new TypeError(INVALID_MAIN_USAGE_EPISODE);
    }
    if (raw.runRef === episodeRunRef || seen.has(raw.runRef)) {
      throw new TypeError(DUPLICATE_MAIN_USAGE_SEGMENT);
    }
    seen.add(raw.runRef);
    const counters = countersFromTerminalUsage(raw.usage);
    const segment: MainUsageEpisodeSegment = {
      ordinal: index + 1,
      runRef: raw.runRef,
      ...counters,
    };
    freezeDeep(segment);
    segments.push(segment);
  }
  return segments;
}

/** Persist one complete role-aware Main usage sample. Identity comes only
 *  from the stored Task. Caller may supply only taskId, comparisonId, role,
 *  runRef, and usage. */
export function captureMainUsage(
  store: MainUsageStore,
  params: unknown,
  generateSampleId?: SampleIdFactory,
  generateTimestamp?: TimestampFactory,
): MainUsageSample {
  const { raw, taskId, comparisonId, role, runRef } = parseCaptureEnvelope(params, CAPTURE_KEYS);
  const identity = loadCaptureIdentity(store, taskId, comparisonId);
  const sample = buildMainUsageSample(raw.usage, {
    sampleId: (generateSampleId ?? defaultSampleId)(),
    forklightTaskId: taskId,
    comparisonId,
    role,
    taskClass: identity.taskClass,
    taskFamily: identity.taskFamily,
    directCodexProfileId: identity.directCodexProfileId,
    runRef,
    capturedAt: (generateTimestamp ?? defaultTimestamp)(),
  });
  return persistUsageSample(store, sample);
}

/** Persist one complete multi-session Main usage episode as a single role
 *  sample. Each named terminal segment is adapted independently; parent
 *  counters are the safe sums of those disjoint segment counters. */
export function captureMainUsageEpisode(
  store: MainUsageStore,
  params: unknown,
  generateSampleId?: SampleIdFactory,
  generateTimestamp?: TimestampFactory,
): MainUsageSample {
  const { raw, taskId, comparisonId, role, runRef } = parseCaptureEnvelope(
    params, EPISODE_CAPTURE_KEYS,
  );
  const identity = loadCaptureIdentity(store, taskId, comparisonId);
  const segments = buildEpisodeSegments(raw.segments, runRef);
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadInputTokens = 0;
  let cacheCreationInputTokens = 0;
  for (const segment of segments) {
    inputTokens = addDisjoint(inputTokens, segment.inputTokens, INVALID_MAIN_USAGE_EPISODE);
    outputTokens = addDisjoint(outputTokens, segment.outputTokens, INVALID_MAIN_USAGE_EPISODE);
    cacheReadInputTokens = addDisjoint(
      cacheReadInputTokens, segment.cacheReadInputTokens, INVALID_MAIN_USAGE_EPISODE,
    );
    cacheCreationInputTokens = addDisjoint(
      cacheCreationInputTokens, segment.cacheCreationInputTokens, INVALID_MAIN_USAGE_EPISODE,
    );
  }
  const sample = normalizeMainUsageSample({
    sampleId: (generateSampleId ?? defaultSampleId)(),
    forklightTaskId: taskId,
    comparisonId,
    role,
    taskClass: identity.taskClass,
    taskFamily: identity.taskFamily,
    directCodexProfileId: identity.directCodexProfileId,
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    grossTokens: fourCounterGross(
      inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens,
      INVALID_MAIN_USAGE_EPISODE,
    ),
    source: MAIN_USAGE_SOURCE,
    runRef,
    capturedAt: (generateTimestamp ?? defaultTimestamp)(),
    schemaVersion: MAIN_USAGE_EPISODE_SCHEMA_VERSION,
    segments,
  });
  return persistUsageSample(store, sample);
}

function optionalTaskLabel(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}

/** Read-only comparison status. Reports captured and missing roles and
 *  count-completeness only. Never writes and never claims savings. */
export function readMainUsageStatus(
  store: MainUsageStore,
  taskId: unknown,
  comparisonId: unknown,
): MainUsageStatus {
  if (typeof taskId !== "string" || !STRICT_TOKEN.test(taskId)) {
    throw new TypeError(INVALID_MAIN_USAGE_STATUS);
  }
  if (typeof comparisonId !== "string" || !COMPARISON_ID.test(comparisonId)) {
    throw new TypeError(INVALID_MAIN_USAGE_STATUS);
  }
  const task = loadTaskOr(store, taskId, TASK_NOT_FOUND_STATUS);
  const samples = store.listMainUsageSamples(taskId, comparisonId);
  const present = new Set(samples.map((sample) => sample.role));
  const capturedRoles = MAIN_USAGE_ROLES.filter((role) => present.has(role));
  const missingRoles = MAIN_USAGE_ROLES.filter((role) => !present.has(role));
  const status: MainUsageStatus = {
    forklightTaskId: taskId,
    comparisonId,
    ...(optionalTaskLabel(task.spec.taskClass) === undefined
      ? {}
      : { taskClass: task.spec.taskClass }),
    ...(optionalTaskLabel(task.spec.taskFamily) === undefined
      ? {}
      : { taskFamily: task.spec.taskFamily }),
    ...(optionalTaskLabel(task.spec.directCodexProfileId) === undefined
      ? {}
      : { directCodexProfileId: task.spec.directCodexProfileId }),
    capturedRoles,
    missingRoles,
    countComplete: missingRoles.length === 0,
    samples,
    schemaVersion: MAIN_USAGE_SCHEMA_VERSION,
  };
  assertNoStatusClaimFields(status);
  freezeDeep(status);
  return status;
}
