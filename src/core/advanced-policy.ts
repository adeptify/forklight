/**
 * Advanced execution policy: schema, defaults, resolution, and preview.
 * Pure functions — no I/O, no Provider calls, no Task mutation.
 *
 * Precedence: explicit Task override > selected Worker Profile > global default.
 * null for nullable fields means explicitly unlimited — never replaced with a finite default.
 * Legacy profiles without advancedPolicy get documented compatible defaults.
 */

import type { PolicyMode } from "./types.js";
import type { RuntimeName } from "./runtime-names.js";
import type { WorkerCapabilityMatrix } from "../workers/types.js";
import type { ExecutionSettings, CompletionPolicySettings } from "./settings.js";
import type { WorkerProfilesSettings } from "./worker-profiles.js";
import type {
  AdvancedPolicyFields,
  EffectivePolicyPreview,
  EffectivePolicyPreviewRow,
  EffectivePolicySnapshot,
  EnforcementCapability,
  EnforcementPhase,
  ProvenanceSource,
  TaskAdvancedPolicyOverride,
  TaskSpec,
} from "./types.js";

// --- Field inventory ---

const POLICY_FIELDS: readonly (keyof AdvancedPolicyFields)[] = [
  "maxDurationMs",
  "observedTokenCeiling",
  "noProgressTimeoutMs",
  "workerStopGraceMs",
  "fileLimit",
  "fileLimitMode",
  "changedLineLimit",
  "changedLineLimitMode",
  "baseMaxAttempts",
  "maxExtraAttempts",
  "maxConcurrency",
  "completionMode",
  "changeBudgetMode",
  "maxAdaptationRounds",
  "maxMainCorrections",
  "maxMainReverifications",
  "maxWorkerValidationRepairs",
];

const NULLABLE_FIELDS: ReadonlySet<keyof AdvancedPolicyFields> = new Set([
  "maxDurationMs",
  "observedTokenCeiling",
  "noProgressTimeoutMs",
  "fileLimit",
  "changedLineLimit",
]);

const POSITIVE_INTEGER_FIELDS: ReadonlySet<keyof AdvancedPolicyFields> = new Set([
  "workerStopGraceMs",
  "baseMaxAttempts",
  "maxConcurrency",
]);

const NON_NEGATIVE_INTEGER_FIELDS: ReadonlySet<keyof AdvancedPolicyFields> = new Set([
  "maxExtraAttempts",
  "maxAdaptationRounds",
  "maxMainCorrections",
  "maxMainReverifications",
  "maxWorkerValidationRepairs",
]);

const POLICY_MODE_FIELDS: ReadonlySet<keyof AdvancedPolicyFields> = new Set([
  "fileLimitMode",
  "changedLineLimitMode",
  "completionMode",
  "changeBudgetMode",
]);

const VALID_POLICY_MODES = new Set<string>(["hard", "warn", "score", "off"]);

// --- Permissive development defaults ---

/** Every field starts permissive so development is unbrittle.
 *  Duration and Token ceilings are unlimited (null).
 *  File and changed-line modes default to "warn".
 *  Only explicit configuration tightens them. */
export function defaultAdvancedPolicyFields(): AdvancedPolicyFields {
  return {
    maxDurationMs: null,
    observedTokenCeiling: null,
    noProgressTimeoutMs: 1_800_000,
    workerStopGraceMs: 10_000,
    fileLimit: null,
    fileLimitMode: "warn",
    changedLineLimit: null,
    changedLineLimitMode: "warn",
    baseMaxAttempts: 3,
    maxExtraAttempts: 1,
    maxConcurrency: 2,
    completionMode: "hard",
    changeBudgetMode: "hard",
    maxAdaptationRounds: 0,
    maxMainCorrections: 1,
    maxMainReverifications: 1,
    maxWorkerValidationRepairs: 1,
  };
}

// --- Runtime capability mapping ---

/** Derive truthful enforcement capability from a Worker adapter's capability matrix.
 *  Never claims preemptive Token control for a runtime that only reports usage at completion. */
export function deriveEnforcementCapability(
  capabilities: WorkerCapabilityMatrix,
): EnforcementCapability {
  return {
    durationEnforcement: "preemptive",
    tokenEnforcement: capabilities.costUsageFidelity === "unsupported"
      ? "unsupported"
      : "post-observation",
    progressWatchdog:
      capabilities.progressHeartbeat === "effective-progress"
        ? "live"
        : "terminal",
  };
}

/** Global default capability when no runtime adapter is available (e.g. test contexts).
 *  Conservative: assumes nothing supports preemptive enforcement. */
export function defaultEnforcementCapability(): EnforcementCapability {
  return {
    durationEnforcement: "unsupported",
    tokenEnforcement: "unsupported",
    progressWatchdog: "terminal",
  };
}

// --- Validation ---

class AdvancedPolicyValidationError extends Error {
  constructor(message: string) {
    super(`Advanced policy validation failed: ${message}`);
    this.name = "AdvancedPolicyValidationError";
  }
}

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || !Number.isInteger(value)
    || value < 0
  ) {
    throw new AdvancedPolicyValidationError(`${label} must be a non-negative integer`);
  }
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || !Number.isInteger(value)
    || value <= 0
  ) {
    throw new AdvancedPolicyValidationError(`${label} must be a positive integer`);
  }
}

function assertPolicyMode(value: unknown, label: string): asserts value is PolicyMode {
  if (typeof value !== "string" || !VALID_POLICY_MODES.has(value)) {
    throw new AdvancedPolicyValidationError(
      `${label} must be one of hard, warn, score, off`,
    );
  }
}

/** Validate a single advanced-policy field value. */
function validateField(field: keyof AdvancedPolicyFields, value: unknown): void {
  if (NULLABLE_FIELDS.has(field)) {
    if (value === null) return;
    if (
      typeof value !== "number"
      || !Number.isFinite(value)
      || !Number.isInteger(value)
      || value < 0
    ) {
      throw new AdvancedPolicyValidationError(
        `${field} must be null or a non-negative integer`,
      );
    }
    if (field === "noProgressTimeoutMs" && value !== null && (value as number) < 1000) {
      throw new AdvancedPolicyValidationError(
        `${field} must be null or at least 1000 ms`,
      );
    }
    return;
  }
  if (POSITIVE_INTEGER_FIELDS.has(field)) {
    assertPositiveInteger(value, field);
    if (field === "workerStopGraceMs" && (value as number) < 100) {
      throw new AdvancedPolicyValidationError(`${field} must be at least 100 ms`);
    }
    return;
  }
  if (NON_NEGATIVE_INTEGER_FIELDS.has(field)) {
    assertNonNegativeInteger(value, field);
    return;
  }
  if (POLICY_MODE_FIELDS.has(field)) {
    assertPolicyMode(value, field);
    return;
  }
  throw new AdvancedPolicyValidationError(`Unknown policy field: ${String(field)}`);
}

/** Validate a partial Worker-Profile advanced-policy object.
 *  Unknown keys fail closed so a misspelled UI field never appears to apply. */
export function validateAdvancedPolicyPatch(
  raw: unknown,
  label = "advancedPolicy",
): Partial<AdvancedPolicyFields> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AdvancedPolicyValidationError(`${label} must be an object or omitted`);
  }
  const o = raw as Record<string, unknown>;
  const result: Partial<AdvancedPolicyFields> = {};
  for (const key of Object.keys(o)) {
    if (!(POLICY_FIELDS as readonly string[]).includes(key)) {
      throw new AdvancedPolicyValidationError(
        `${label}.${key} is not a recognized advanced-policy field`,
      );
    }
    const field = key as keyof AdvancedPolicyFields;
    validateField(field, o[field]);
    (result as Record<string, unknown>)[field] = o[field];
  }
  return result;
}

/** Validate a Task-level advanced-policy override object. */
export function validateTaskAdvancedPolicyOverride(
  raw: unknown,
  label = "task.advancedPolicy",
): TaskAdvancedPolicyOverride {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AdvancedPolicyValidationError(`${label} must be an object or omitted`);
  }
  const o = raw as Record<string, unknown>;
  const result: TaskAdvancedPolicyOverride = {};
  for (const key of Object.keys(o)) {
    if (!(POLICY_FIELDS as readonly string[]).includes(key)) {
      throw new AdvancedPolicyValidationError(
        `${label}.${key} is not a recognized advanced-policy field`,
      );
    }
    const field = key as keyof AdvancedPolicyFields;
    const rawValue = o[field];
    // undefined at Task level means "not overridden" (omit the field)
    if (rawValue === undefined) continue;
    validateField(field, rawValue);
    (result as Record<string, unknown>)[field] = rawValue;
  }
  return result;
}

// --- Field value object helpers ---

function fieldValue(
  field: keyof AdvancedPolicyFields,
  patch: Partial<AdvancedPolicyFields>,
): AdvancedPolicyFields[typeof field] | undefined {
  return (patch as Record<string, unknown>)[field] as
    AdvancedPolicyFields[typeof field] | undefined;
}

function isDefined(value: unknown): boolean {
  return value !== undefined;
}

// --- Resolution: Task > Worker > Global ---

/** Resolve the effective advanced policy with per-field provenance.
 *
 *  Precedence for each flexible field:
 *    1. Explicit Task override (present, non-undefined)
 *    2. Selected Worker Profile advancedPolicy
 *    3. Global defaults
 *
 *  null for nullable fields is explicit unlimited — never falls back.
 *  per-profile maxConcurrency is capped at the global value (intersection).
 */
export function resolveEffectivePolicy(
  workerPolicy: Partial<AdvancedPolicyFields> | undefined,
  taskOverride: TaskAdvancedPolicyOverride | undefined,
  globalDefaults: AdvancedPolicyFields,
  profileId: string,
  enforcementCapability: EnforcementCapability,
): EffectivePolicySnapshot {
  const values: Record<string, unknown> = {};
  const provenance: Record<string, ProvenanceSource> = {};

  for (const field of POLICY_FIELDS) {
    const taskVal = taskOverride
      ? fieldValue(field, taskOverride as Partial<AdvancedPolicyFields>)
      : undefined;
    const workerVal = workerPolicy
      ? fieldValue(field, workerPolicy)
      : undefined;

    if (isDefined(taskVal)) {
      values[field] = taskVal;
      provenance[field] = "task";
    } else if (isDefined(workerVal)) {
      values[field] = workerVal;
      provenance[field] = "worker";
    } else {
      values[field] = globalDefaults[field];
      provenance[field] = "global";
    }
  }

  return {
    profileId,
    values: values as unknown as AdvancedPolicyFields,
    provenance: provenance as Record<keyof AdvancedPolicyFields, ProvenanceSource>,
    enforcementCapability,
  };
}

/** Merge a Worker Profile's top-level noProgressTimeoutMs into its advancedPolicy.
 *  advancedPolicy.noProgressTimeoutMs always wins if set.
 *  Returns the effective partial for resolution. */
export function effectiveWorkerAdvancedPolicy(
  profile: {
    advancedPolicy?: Partial<AdvancedPolicyFields>;
    noProgressTimeoutMs?: number;
  },
): Partial<AdvancedPolicyFields> {
  const base: Partial<AdvancedPolicyFields> = {};
  if (profile.noProgressTimeoutMs !== undefined) {
    base.noProgressTimeoutMs = profile.noProgressTimeoutMs;
  }
  if (profile.advancedPolicy !== undefined) {
    for (const [key, value] of Object.entries(profile.advancedPolicy)) {
      (base as Record<string, unknown>)[key] = value;
    }
  }
  return base;
}

// --- Task-creation policy resolution ---

/** Context for resolving effective policy at Task creation time.
 *  workerProfile fields are explicitly optional for exactOptionalPropertyTypes. */
interface PolicyResolutionContext {
  /** Selected Worker Profile (the resolved profile, not raw input). */
  workerProfile?:
    | {
        advancedPolicy?: Partial<AdvancedPolicyFields>;
        noProgressTimeoutMs?: number;
        id: string;
      }
    | undefined;
  /** Raw Task-level override from YAML (undefined = no override). */
  taskOverride?: TaskAdvancedPolicyOverride;
  /** Global defaults from settings. */
  globalDefaults: AdvancedPolicyFields;
  /** Truthful enforcement capability for the selected runtime. */
  enforcementCapability: EnforcementCapability;
}

/** Determine the effective advanced policy for a newly created Task.
 *  Consumes the parsed Task override, selected Worker Profile, global defaults,
 *  and truthful runtime enforcement capability. Returns the immutable snapshot
 *  to store on TaskRecord.effectivePolicy. */
export function deriveEffectivePolicyForTaskCreation(
  ctx: PolicyResolutionContext,
): EffectivePolicySnapshot {
  const workerEffective =
    ctx.workerProfile === undefined || ctx.workerProfile === null
      ? undefined
      : effectiveWorkerAdvancedPolicy(ctx.workerProfile);
  const profileId =
    ctx.workerProfile !== undefined && ctx.workerProfile !== null
      ? ctx.workerProfile.id
      : "global";
  return resolveEffectivePolicy(
    workerEffective,
    ctx.taskOverride,
    ctx.globalDefaults,
    profileId,
    ctx.enforcementCapability,
  );
}

/** Resolve one Task snapshot through the same pure path for CLI, daemon,
 * plans, and competition candidates. The exact selected profile identity is
 * carried by TaskSpec; an absent id means global settings only. */
export function resolveTaskEffectivePolicy(
  spec: TaskSpec,
  settings: {
    execution: ExecutionSettings;
    completionPolicy: CompletionPolicySettings;
    workerProfiles?: WorkerProfilesSettings;
  },
  enforcementCapability: EnforcementCapability,
): EffectivePolicySnapshot {
  const globalDefaults = defaultAdvancedPolicyFields();
  globalDefaults.noProgressTimeoutMs = settings.execution.noProgressTimeoutMs;
  globalDefaults.workerStopGraceMs = settings.execution.workerStopGraceMs;
  globalDefaults.baseMaxAttempts = settings.execution.maxAttempts;
  globalDefaults.maxExtraAttempts = settings.execution.maxExtraAttempts;
  globalDefaults.maxWorkerValidationRepairs = settings.execution.maxWorkerValidationRepairs;
  globalDefaults.maxConcurrency = settings.execution.maxConcurrency;
  globalDefaults.completionMode = settings.completionPolicy.noChangeMode;
  globalDefaults.changeBudgetMode = settings.completionPolicy.changeBudgetMode;
  // maxMainCorrections defaults to 1 in globalDefaults — no settings-level override.
  // Worker Profile or Task override can change it through the normal resolution chain.

  const selectedProfile = spec.workerProfileId === undefined
    ? undefined
    : settings.workerProfiles?.profiles.find((profile) => profile.id === spec.workerProfileId);
  if (spec.workerProfileId !== undefined && selectedProfile === undefined) {
    throw new AdvancedPolicyValidationError("selected Worker Profile is unavailable");
  }
  const workerProfile = selectedProfile === undefined
    ? undefined
    : {
        id: selectedProfile.id,
        ...(selectedProfile.advancedPolicy === undefined
          ? {}
          : { advancedPolicy: selectedProfile.advancedPolicy }),
        ...(selectedProfile.noProgressTimeoutMs === undefined
          ? {}
          : { noProgressTimeoutMs: selectedProfile.noProgressTimeoutMs }),
      };
  return deriveEffectivePolicyForTaskCreation({
    ...(workerProfile === undefined ? {} : { workerProfile }),
    ...(spec.advancedPolicyOverride === undefined
      ? {}
      : { taskOverride: spec.advancedPolicyOverride }),
    globalDefaults,
    enforcementCapability,
  });
}

// --- Immutable snapshot helpers ---

/** Derive the completion policy values from an effective policy snapshot
 *  for backward-compatible consumption by existing verifier/runner code.
 *  Legacy Tasks without a snapshot fall back to the existing spec.completionPolicy. */
export function completionPolicyFromSnapshot(
  snapshot: EffectivePolicySnapshot | undefined,
  legacyNoChangeMode: PolicyMode = "hard",
  legacyChangeBudgetMode: PolicyMode = "hard",
): { noChangeMode: PolicyMode; changeBudgetMode: PolicyMode } {
  if (snapshot === undefined) {
    return { noChangeMode: legacyNoChangeMode, changeBudgetMode: legacyChangeBudgetMode };
  }
  return {
    noChangeMode: snapshot.values.completionMode,
    changeBudgetMode: snapshot.values.changeBudgetMode,
  };
}

/** Derive file/line policy from an effective policy snapshot.
 *  Legacy Tasks without a snapshot get null limits (development permissive). */
export function sizePolicyFromSnapshot(snapshot: EffectivePolicySnapshot | undefined): {
  fileLimit: number | null;
  fileLimitMode: PolicyMode;
  changedLineLimit: number | null;
  changedLineLimitMode: PolicyMode;
} {
  if (snapshot === undefined) {
    return {
      fileLimit: null,
      fileLimitMode: "warn",
      changedLineLimit: null,
      changedLineLimitMode: "warn",
    };
  }
  return {
    fileLimit: snapshot.values.fileLimit,
    fileLimitMode: snapshot.values.fileLimitMode,
    changedLineLimit: snapshot.values.changedLineLimit,
    changedLineLimitMode: snapshot.values.changedLineLimitMode,
  };
}

/** Derive Attempt admission limits from an effective policy snapshot. */
export function attemptPolicyFromSnapshot(
  snapshot: EffectivePolicySnapshot | undefined,
  legacyBaseMax: number = 3,
  legacyExtraMax: number = 1,
): { baseMaxAttempts: number; maxExtraAttempts: number } {
  if (snapshot === undefined) {
    return { baseMaxAttempts: legacyBaseMax, maxExtraAttempts: legacyExtraMax };
  }
  return {
    baseMaxAttempts: snapshot.values.baseMaxAttempts,
    maxExtraAttempts: snapshot.values.maxExtraAttempts,
  };
}

/** Derive maxMainReverifications from an effective policy snapshot.
 *  Legacy Tasks without a snapshot fall back to the development default of 1. */
export function maxMainReverificationsFromSnapshot(
  snapshot: EffectivePolicySnapshot | undefined,
  legacyMax: number = 1,
): number {
  if (snapshot === undefined) return legacyMax;
  return snapshot.values.maxMainReverifications;
}

/** Derive the finite same-Worker validation-repair allowance. Legacy Tasks
 * without an immutable policy snapshot deliberately retain zero automatic
 * repair rather than inheriting the new default. */
export function maxWorkerValidationRepairsFromSnapshot(
  snapshot: EffectivePolicySnapshot | undefined,
  legacyMax = 0,
): number {
  if (snapshot === undefined) return legacyMax;
  const value = (snapshot.values as Partial<AdvancedPolicyFields>).maxWorkerValidationRepairs;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : legacyMax;
}

/** Derive the no-progress timeout from an effective policy snapshot.
 *  null means unlimited (watchdog disabled). */
export function noProgressFromSnapshot(
  snapshot: EffectivePolicySnapshot | undefined,
  legacyMs: number = 1_800_000,
): number | null {
  if (snapshot === undefined) return legacyMs;
  return snapshot.values.noProgressTimeoutMs;
}

/** Derive the worker stop grace from an effective policy snapshot. */
export function stopGraceFromSnapshot(
  snapshot: EffectivePolicySnapshot | undefined,
  legacyMs: number = 10_000,
): number {
  if (snapshot === undefined) return legacyMs;
  return snapshot.values.workerStopGraceMs;
}

/** Derive the max wall-duration from an effective policy snapshot.
 *  null means unlimited. */
export function maxDurationFromSnapshot(
  snapshot: EffectivePolicySnapshot | undefined,
): number | null {
  if (snapshot === undefined) return null;
  return snapshot.values.maxDurationMs;
}

/** Derive the observed-Token ceiling from an effective policy snapshot.
 *  null means unlimited. */
export function observedTokenCeilingFromSnapshot(
  snapshot: EffectivePolicySnapshot | undefined,
): number | null {
  if (snapshot === undefined) return null;
  return snapshot.values.observedTokenCeiling;
}

// --- Pure effective-policy preview (Hub consumption) ---

function isUnlimited(field: keyof AdvancedPolicyFields, value: unknown): boolean {
  if (NULLABLE_FIELDS.has(field)) return value === null;
  return false;
}

function fieldEnforcementPhase(
  field: keyof AdvancedPolicyFields,
  capability: EnforcementCapability,
): EnforcementPhase {
  switch (field) {
    case "maxDurationMs":
      return capability.durationEnforcement;
    case "observedTokenCeiling":
      return capability.tokenEnforcement;
    case "noProgressTimeoutMs":
      return capability.progressWatchdog === "live" ? "preemptive" : "terminal";
    case "fileLimit":
    case "fileLimitMode":
    case "changedLineLimit":
    case "changedLineLimitMode":
    case "completionMode":
    case "changeBudgetMode":
      return "terminal";
    default:
      return "preemptive";
  }
}

/** Return a content-free field-by-field view for Hub before Task submission.
 *  Pure read-only projection with no Provider call or Task mutation. */
export function previewEffectivePolicy(
  workerPolicy: Partial<AdvancedPolicyFields> | undefined,
  taskOverride: TaskAdvancedPolicyOverride | undefined,
  globalDefaults: AdvancedPolicyFields,
  profileId: string,
  enforcementCapability: EnforcementCapability,
): EffectivePolicyPreview {
  const snapshot = resolveEffectivePolicy(
    workerPolicy, taskOverride, globalDefaults, profileId, enforcementCapability,
  );

  return POLICY_FIELDS.map((field): EffectivePolicyPreviewRow => ({
    field,
    value: snapshot.values[field],
    source: snapshot.provenance[field],
    enforcementPhase: fieldEnforcementPhase(field, enforcementCapability),
    unlimited: isUnlimited(field, snapshot.values[field]),
  }));
}

/** Compute enforcement capability from a runtime name.
 *  Conservative defaults when no adapter is available. */
export function enforcementCapabilityForRuntime(
  runtime: RuntimeName,
): EnforcementCapability {
  switch (runtime) {
    case "claude-code":
    case "codex-cli":
      return {
        durationEnforcement: "preemptive",
        tokenEnforcement: "post-observation",
        progressWatchdog: "live",
      };
    case "grok-build":
      return {
        durationEnforcement: "preemptive",
        tokenEnforcement: "unsupported",
        progressWatchdog: "terminal",
      };
    default:
      return defaultEnforcementCapability();
  }
}

// --- Typed policy-limit evidence factory ---

