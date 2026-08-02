/**
 * Shared per-Task execution preference and frozen resolved mode.
 *
 * `auto` prefers a Runtime's genuine, machine-observable native Goal mode when
 * the Runtime proves a native Goal contract; otherwise it resolves to one
 * ordinary single run. `native-goal` is a hard requirement — it never silently
 * falls back. Legacy saved Workers and Tasks without a preference preserve the
 * historical single-run behavior.
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
  "native-goal",
];

export function isExecutionPreference(value: unknown): value is ExecutionPreference {
  return typeof value === "string"
    && (EXECUTION_PREFERENCES as readonly string[]).includes(value);
}

/**
 * Canonical machine-observable native Goal contract per Runtime.
 * Codex is proven after this implementation; Claude Code and Grok remain
 * unsupported until their own observable durable Goal contracts are proven.
 * Distinct from `sessionResume`: a Runtime that can resume a chat session does
 * not necessarily expose a persisted Goal with progress, blocked state, usage,
 * and interruption bound to one Task lineage.
 */
export function nativeGoalSupportForRuntime(runtime: RuntimeName): boolean {
  switch (runtime) {
    case "codex-cli": return true;
    case "claude-code":
    case "grok-build": return false;
  }
}

export interface ExecutionModeResolution {
  /** The effective requested preference (legacy omitted → single-run). */
  readonly preference: ExecutionPreference;
  /** The frozen effective execution mode for this Task. */
  readonly mode: ResolvedExecutionMode;
}

/**
 * Turn a requested preference into one immutable, truthful execution mode.
 * `auto` may fall back; forced `native-goal` may not and fails closed.
 */
export function resolveExecutionMode(
  preference: ExecutionPreference | undefined,
  nativeGoalSupported: boolean,
): ExecutionModeResolution {
  if (preference === "native-goal") {
    if (!nativeGoalSupported) {
      throw new Error(
        "native-goal execution requires a Runtime with a proven native Goal contract; "
        + "this Runtime does not expose one and forced native-goal never silently falls back",
      );
    }
    return { preference, mode: "native-goal" };
  }
  if (preference === "auto") {
    return {
      preference,
      mode: nativeGoalSupported ? "native-goal" : "single-run",
    };
  }
  return { preference: "single-run", mode: "single-run" };
}

/** Frozen effective execution mode from a Task spec (legacy → single-run). */
export function executionModeFromTaskSpec(spec: TaskSpec): ResolvedExecutionMode {
  return spec.executionMode ?? "single-run";
}

/** Frozen requested execution preference from a Task spec (legacy → single-run). */
export function executionPreferenceFromTaskSpec(spec: TaskSpec): ExecutionPreference {
  return spec.executionPreference ?? "single-run";
}
