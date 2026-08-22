/**
 * Closed Runtime-signal vs effective-progress classification.
 *
 * Shared by every Worker normalizer, adapter watchdog, and Task dual-clock
 * projection. Classification is content-free: it never reads summary prose,
 * prompts, tool arguments, paths, credentials, or private diagnostics.
 */

/** Closed meaning for one normalized Runtime activity record. */
export type RuntimeActivityEvidence = "liveness" | "effective-progress";

export const RUNTIME_ACTIVITY_LIVENESS = "liveness" as const;
export const RUNTIME_ACTIVITY_EFFECTIVE = "effective-progress" as const;

/** Payload field name written by normalizers and read by replay/watchdogs. */
export const ACTIVITY_EVIDENCE_FIELD = "activityEvidence" as const;

/** Closed activityKind values that prove effective Task progress without an
 *  explicit activityEvidence field (legacy-safe fallback). */
const EFFECTIVE_ACTIVITY_KINDS = new Set([
  "model-response",
  // Turn completion while the Goal continues is a real terminal transition.
  "goal-continuing",
  // Privacy-safe workspace-change milestones from native-Goal diff evidence.
  "workspace-change",
]);

/** Closed activityKind values that are Runtime communication only. */
const LIVENESS_ACTIVITY_KINDS = new Set([
  "model-processing",
  "session-started",
  "goal-turn-interrupted",
  "goal-activity",
  // Continuation starts and Goal status churn are observability only: they
  // cannot buy unlimited time after the active Turn is established.
  "goal-turn-started",
  "goal-active",
]);

function payloadObject(payload: unknown): Record<string, unknown> | undefined {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  return payload as Record<string, unknown>;
}

/** Read the closed activityEvidence field from a durable event payload. */
function readActivityEvidence(
  payload: unknown,
): RuntimeActivityEvidence | undefined {
  const value = payloadObject(payload)?.[ACTIVITY_EVIDENCE_FIELD];
  if (value === RUNTIME_ACTIVITY_LIVENESS || value === RUNTIME_ACTIVITY_EFFECTIVE) {
    return value;
  }
  return undefined;
}

/** Read closed activityKind without treating prose as evidence. */
function readActivityKind(payload: unknown): string | undefined {
  const value = payloadObject(payload)?.activityKind;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Merge a closed activityEvidence marker into a payload object.
 * Never stores private content; only the closed enum value.
 */
export function withActivityEvidence(
  payload: Record<string, unknown> | undefined,
  evidence: RuntimeActivityEvidence,
): Record<string, unknown> {
  return {
    ...(payload ?? {}),
    [ACTIVITY_EVIDENCE_FIELD]: evidence,
  };
}

/**
 * True when the record proves effective Task progress and may reset the
 * no-effective-progress watchdog.
 *
 * Prefer explicit activityEvidence. Fall back only to closed event types and
 * activityKind values; never to summary text.
 */
export function isEffectiveProgressEvent(
  type: string,
  payload?: unknown,
): boolean {
  const explicit = readActivityEvidence(payload);
  if (explicit === RUNTIME_ACTIVITY_EFFECTIVE) return true;
  if (explicit === RUNTIME_ACTIVITY_LIVENESS) return false;

  if (type === "worker.tool.started" || type === "worker.tool.completed") {
    return true;
  }
  if (
    type === "checkpoint.started"
    || type === "checkpoint.completed"
  ) {
    return true;
  }
  if (type === "worker.message") {
    const kind = readActivityKind(payload);
    if (kind !== undefined && EFFECTIVE_ACTIVITY_KINDS.has(kind)) return true;
    // model-processing / session-started / goal-activity / unknown: not progress.
    if (kind !== undefined && LIVENESS_ACTIVITY_KINDS.has(kind)) return false;
    return false;
  }
  return false;
}

/**
 * True when the record is structured Runtime communication that may refresh
 * the Runtime-signal clock. Liveness-only heartbeats count; terminal and
 * policy events are handled by the dual-clock projector separately.
 */
export function isRuntimeSignalEvent(type: string): boolean {
  return (
    type === "worker.started"
    || type === "worker.resumed"
    || type === "worker.tool.started"
    || type === "worker.tool.completed"
    || type === "worker.message"
    || type === "checkpoint.started"
    || type === "checkpoint.completed"
    || type === "checkpoint.skipped"
  );
}

/**
 * True when the record is Worker-start baseline for the effective-progress
 * clock (progress clock starts here until the first effective step).
 */
export function isWorkerStartBaseline(type: string): boolean {
  return type === "worker.started" || type === "worker.resumed";
}

/**
 * Classify a durable or normalized event into closed evidence for clocks.
 * Returns undefined for events that are neither Runtime signals nor progress
 * (e.g. verification, board follow-ups).
 */
export function classifyRuntimeActivity(
  type: string,
  payload?: unknown,
): RuntimeActivityEvidence | "baseline" | undefined {
  if (isWorkerStartBaseline(type)) return "baseline";
  if (isEffectiveProgressEvent(type, payload)) return RUNTIME_ACTIVITY_EFFECTIVE;
  if (isRuntimeSignalEvent(type)) return RUNTIME_ACTIVITY_LIVENESS;
  return undefined;
}
