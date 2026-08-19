/**
 * Shared per-Task execution preference and frozen resolved mode.
 *
 * `auto` prefers a Runtime's genuine native Goal when proven, then a proven
 * Task-bound persistent Session, then one ordinary single run. Forced
 * `persistent-session` and `native-goal` never silently fall back. Legacy saved
 * Workers and Tasks without a preference preserve historical single-run
 * behavior. Session resume is not a native Goal.
 *
 * Pure helpers — no I/O, no Provider calls, no Task mutation.
 */

import type { RuntimeName } from "./runtime-names.js";
import type {
  ExecutionPreference,
  ResolvedExecutionMode,
  TaskSpec,
} from "./types.js";

export const EXECUTION_PREFERENCES: readonly ExecutionPreference[] = [
  "auto",
  "single-run",
  "persistent-session",
  "native-goal",
];

export const EXECUTION_PREFERENCE_LIST = "auto, single-run, persistent-session, or native-goal";

export function isExecutionPreference(value: unknown): value is ExecutionPreference {
  return typeof value === "string"
    && (EXECUTION_PREFERENCES as readonly string[]).includes(value);
}

/**
 * Canonical machine-observable native Goal contract per Runtime.
 * Codex and Grok Build are proven. Claude Code remains unsupported until its
 * own observable durable Goal contract is proven. Distinct from persistent
 * Session resume: a Runtime that can resume one Task session does not by
 * itself expose a persisted Goal with progress, blocked state, usage, and
 * interruption bound to one Task lineage.
 */
export function nativeGoalSupportForRuntime(runtime: RuntimeName): boolean {
  switch (runtime) {
    case "codex-cli":
    case "grok-build": return true;
    case "claude-code": return false;
  }
}

/**
 * Proven Task-bound session identity plus resume argv. Grok launches with
 * `--session-id <task.sessionId>` and continues with `--resume <task.sessionId>`.
 * Do not infer this from Provider name or from prose. Claude session resume and
 * Codex native Goal are different contracts.
 */
export function persistentSessionSupportForRuntime(runtime: RuntimeName): boolean {
  switch (runtime) {
    case "grok-build": return true;
    case "codex-cli":
    case "claude-code": return false;
  }
}

export interface ExecutionCapabilities {
  readonly nativeGoalSupported: boolean;
  readonly persistentSessionSupported: boolean;
}

export function executionCapabilitiesForRuntime(runtime: RuntimeName): ExecutionCapabilities {
  return {
    nativeGoalSupported: nativeGoalSupportForRuntime(runtime),
    persistentSessionSupported: persistentSessionSupportForRuntime(runtime),
  };
}

export interface ExecutionModeResolution {
  /** The effective requested preference (legacy omitted → single-run). */
  readonly preference: ExecutionPreference;
  /** The frozen effective execution mode for this Task. */
  readonly mode: ResolvedExecutionMode;
}

/**
 * Project requested preference onto a resolved mode without failing closed.
 * Readiness uses this so a forced unsupported mode can be named and blocked.
 */
export function projectResolvedExecutionMode(
  preference: ExecutionPreference | undefined,
  capabilities: ExecutionCapabilities,
): ExecutionModeResolution {
  if (preference === "native-goal") {
    return { preference, mode: "native-goal" };
  }
  if (preference === "persistent-session") {
    return { preference, mode: "persistent-session" };
  }
  if (preference === "auto") {
    if (capabilities.nativeGoalSupported) {
      return { preference, mode: "native-goal" };
    }
    if (capabilities.persistentSessionSupported) {
      return { preference, mode: "persistent-session" };
    }
    return { preference, mode: "single-run" };
  }
  return { preference: "single-run", mode: "single-run" };
}

/**
 * Turn a requested preference into one immutable, truthful execution mode.
 * `auto` may fall back; forced `persistent-session` and `native-goal` may not
 * and fail closed.
 */
export function resolveExecutionMode(
  preference: ExecutionPreference | undefined,
  capabilities: ExecutionCapabilities,
): ExecutionModeResolution {
  const projected = projectResolvedExecutionMode(preference, capabilities);
  if (projected.preference === "native-goal" && !capabilities.nativeGoalSupported) {
    throw new Error(
      "native-goal execution requires a Runtime with a proven native Goal contract; "
      + "this Runtime does not expose one and forced native-goal never silently falls back",
    );
  }
  if (projected.preference === "persistent-session" && !capabilities.persistentSessionSupported) {
    throw new Error(
      "persistent-session execution requires a Runtime with a proven stable session identity "
      + "and resume path; this Runtime does not expose one and forced persistent-session "
      + "never silently falls back",
    );
  }
  return projected;
}

/** Frozen effective execution mode from a Task spec (legacy → single-run). */
export function executionModeFromTaskSpec(spec: TaskSpec): ResolvedExecutionMode {
  return spec.executionMode ?? "single-run";
}

/** Frozen requested execution preference from a Task spec (legacy → single-run). */
export function executionPreferenceFromTaskSpec(spec: TaskSpec): ExecutionPreference {
  return spec.executionPreference ?? "single-run";
}
