import type { StateStore } from "../state/store.js";
import { isoTimestamp as timestamp } from "./time.js";

/**
 * Closed vocabulary of why Main explicitly closes handled attention: a
 * failed/interrupted Task or a succeeded Task with no delivered outcome that
 * no longer needs operational action. Pure codes - they never carry a review
 * reason, prompt, path, command, error body, or free text.
 */
export const TASK_RESOLUTION_REASONS = [
  "environment-recovered",
  "superseded",
  "handled-elsewhere",
  "no-longer-needed",
] as const;

export type TaskResolutionReason = (typeof TASK_RESOLUTION_REASONS)[number];

/** Bounded optional Main-authored note for resolve/reopen (1-500 characters).
 *  Omitted notes are allowed and are omitted from the durable payload. */
export const TASK_RESOLUTION_NOTE_MAX_LENGTH = 500;
/** Bounded optional evidence Task id (Task ids are 36-char UUIDs). */
export const TASK_RESOLUTION_EVIDENCE_ID_MAX_LENGTH = 100;

export function isTaskResolutionReason(value: unknown): value is TaskResolutionReason {
  return (
    typeof value === "string"
    && (TASK_RESOLUTION_REASONS as readonly string[]).includes(value)
  );
}

/**
 * Latest privacy-safe attention-resolution state for one Task, derived only
 * from durable ordered events. `resolved` closes handled attention to History;
 * `reopened` returns the unchanged Task to its evidence-derived Now placement.
 * Malformed or unknown resolution evidence fails open to Now, so a Task can
 * never be hidden in History by corrupt or forged evidence.
 */
export type TaskResolutionState =
  | { status: "none" }
  | {
      status: "resolved";
      reason: TaskResolutionReason;
      /** Optional bounded Main-authored explanation. */
      note?: string;
      /** Optional successor/evidence Task id. */
      evidenceTaskId?: string;
      resolvedAt: string;
      /** Event sequence of the resolve evidence. */
      eventSequence: number;
    }
  | {
      status: "reopened";
      /** Optional bounded Main-authored explanation for reopening. */
      note?: string;
      reopenedAt: string;
      /** Event sequence of the reopen evidence. */
      eventSequence: number;
    };

interface TaskResolvedPayload {
  kind: "resolve";
  reason: TaskResolutionReason;
  note?: string;
  evidenceTaskId?: string;
  resolvedAt: string;
}

interface TaskReopenedPayload {
  kind: "reopen";
  note?: string;
  reopenedAt: string;
}

/** Exact ForkLight ISO form (`Date.toISOString` round-trip); narrows to string. */
function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return false;
  // Reject parseable-but-normalized forms (date-only, missing ms, offsets, etc.).
  return new Date(ms).toISOString() === value;
}

function parseResolvedPayload(payload: unknown): TaskResolvedPayload | undefined {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const p = payload as Record<string, unknown>;
  if (p.kind !== "resolve") return undefined;
  if (!isTaskResolutionReason(p.reason)) return undefined;
  if (typeof p.note !== "undefined"
    && (typeof p.note !== "string"
      || p.note.length < 1
      || p.note.length > TASK_RESOLUTION_NOTE_MAX_LENGTH)) {
    return undefined;
  }
  if (!canonicalTimestamp(p.resolvedAt)) return undefined;
  if (p.evidenceTaskId !== undefined
    && (typeof p.evidenceTaskId !== "string"
      || p.evidenceTaskId.length < 1
      || p.evidenceTaskId.length > TASK_RESOLUTION_EVIDENCE_ID_MAX_LENGTH)) {
    return undefined;
  }
  return {
    kind: "resolve",
    reason: p.reason,
    resolvedAt: p.resolvedAt,
    ...(typeof p.note === "string" && p.note.length > 0 ? { note: p.note } : {}),
    ...(typeof p.evidenceTaskId === "string" && p.evidenceTaskId.length > 0
      ? { evidenceTaskId: p.evidenceTaskId }
      : {}),
  };
}

function parseReopenedPayload(payload: unknown): TaskReopenedPayload | undefined {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const p = payload as Record<string, unknown>;
  if (p.kind !== "reopen") return undefined;
  if (typeof p.note !== "undefined"
    && (typeof p.note !== "string"
      || p.note.length < 1
      || p.note.length > TASK_RESOLUTION_NOTE_MAX_LENGTH)) {
    return undefined;
  }
  if (!canonicalTimestamp(p.reopenedAt)) return undefined;
  return {
    kind: "reopen",
    reopenedAt: p.reopenedAt,
    ...(typeof p.note === "string" && p.note.length > 0 ? { note: p.note } : {}),
  };
}

/**
 * Latest valid attention-resolution state over durable ordered events.
 * The LATEST resolution event is authoritative: if it is malformed or has an
 * invalid canonical timestamp, the Task fails open to Now so forged or corrupt
 * evidence can never keep a Task hidden in History. A later valid event can
 * restore a valid state.
 */
export function latestTaskResolutionState(
  events: ReadonlyArray<{ type: string; sequence: number; payload?: unknown }>,
): TaskResolutionState {
  let state: TaskResolutionState = { status: "none" };
  let latestMalformed = false;
  for (const event of events) {
    if (event.type === "task.resolution.completed") {
      const payload = parseResolvedPayload(event.payload);
      if (payload !== undefined) {
        state = {
          status: "resolved",
          reason: payload.reason,
          resolvedAt: payload.resolvedAt,
          eventSequence: event.sequence,
          ...(payload.note === undefined ? {} : { note: payload.note }),
          ...(payload.evidenceTaskId === undefined
            ? {}
            : { evidenceTaskId: payload.evidenceTaskId }),
        };
        latestMalformed = false;
      } else {
        latestMalformed = true;
      }
    } else if (event.type === "task.resolution.reopened") {
      const payload = parseReopenedPayload(event.payload);
      if (payload !== undefined) {
        state = {
          status: "reopened",
          reopenedAt: payload.reopenedAt,
          eventSequence: event.sequence,
          ...(payload.note === undefined ? {} : { note: payload.note }),
        };
        latestMalformed = false;
      } else {
        latestMalformed = true;
      }
    }
  }
  if (latestMalformed) return { status: "none" };
  return state;
}

/**
 * Main resolves a handled Task as closed attention: a failed/interrupted Task
 * or a succeeded Task with no delivered outcome and no running Attempt.
 * Validates authority (explicit confirm), eligibility (terminal
 * failed/interrupted/succeeded, no running Attempt, no delivered outcome),
 * appends one immutable resolve event, and returns the latest state. The exact
 * same resolve request is idempotent (existing=true, no duplicate event); a
 * conflicting resolve fails closed until Main reopens the Task. Never changes
 * machine status, delivery truth, review truth, or statistics.
 *
 * `delivered` is the caller-computed delivery truth (delivered/activated/
 * repaired-delivered). It is required so the Core can fail closed without
 * depending on the Decision View module.
 */
export function resolveTaskResolution(
  store: StateStore,
  taskId: string,
  input: {
    reason: TaskResolutionReason;
    note?: string;
    evidenceTaskId?: string;
    confirm: true;
    /** Caller-owned delivery truth; required with no Core default. */
    delivered: boolean;
  },
): { existing: boolean; state: TaskResolutionState } {
  if (input.confirm !== true) {
    throw new Error("resolve requires explicit confirm: true");
  }
  if (!isTaskResolutionReason(input.reason)) {
    throw new Error("resolve reason must be a bounded resolution reason");
  }
  let note: string | undefined;
  if (input.note !== undefined) {
    const trimmed = input.note.trim();
    if (trimmed.length > TASK_RESOLUTION_NOTE_MAX_LENGTH) {
      throw new Error(`resolve note must be at most ${TASK_RESOLUTION_NOTE_MAX_LENGTH} characters`);
    }
    if (trimmed.length > 0) note = trimmed;
  }
  let evidenceTaskId: string | undefined;
  if (input.evidenceTaskId !== undefined) {
    const trimmed = input.evidenceTaskId.trim();
    if (
      trimmed.length < 1
      || trimmed.length > TASK_RESOLUTION_EVIDENCE_ID_MAX_LENGTH
    ) {
      throw new Error(
        `resolve evidenceTaskId must be 1-${TASK_RESOLUTION_EVIDENCE_ID_MAX_LENGTH} characters`,
      );
    }
    if (trimmed === taskId) {
      throw new Error("resolve evidenceTaskId cannot reference the Task itself");
    }
    // An evidence link must name a real Task so Main never links to nothing.
    store.getTask(trimmed);
    evidenceTaskId = trimmed;
  }

  const task = store.getTask(taskId);
  // Succeeded is eligible ONLY when the caller-computed delivered truth is
  // false (checked below) and no Attempt is running. Delivered/activated/
  // verified-repaired Tasks stay ineligible and are never hidden in History.
  if (
    task.status !== "failed"
    && task.status !== "interrupted"
    && task.status !== "succeeded"
  ) {
    throw new Error(`Task ${taskId} cannot be resolved from status ${task.status}`);
  }
  if (task.currentAttemptId !== undefined) {
    const attempt = store.getAttempt(task.currentAttemptId);
    if (attempt.status === "running") {
      throw new Error(`Task ${taskId} has a running Attempt; resolve requires no active Attempt`);
    }
  }
  if (input.delivered === true) {
    throw new Error(`Task ${taskId} already has a delivered outcome; resolve is not applicable`);
  }

  const state = latestTaskResolutionState(store.listEvents(taskId));
  if (state.status === "resolved") {
    if (
      state.reason === input.reason
      && state.note === note
      && state.evidenceTaskId === evidenceTaskId
    ) {
      return { existing: true, state };
    }
    throw new Error(
      `Task ${taskId} is already resolved; reopen before changing the resolution`,
    );
  }

  // state is "none" or "reopened" - a new resolve is allowed.
  const payload: TaskResolvedPayload = {
    kind: "resolve",
    reason: input.reason,
    resolvedAt: timestamp(),
    ...(note === undefined ? {} : { note }),
    ...(evidenceTaskId === undefined ? {} : { evidenceTaskId }),
  };
  store.addEvent(
    taskId,
    undefined,
    "task.resolution.completed",
    "Main resolved the handled attention",
    payload,
  );
  return {
    existing: false,
    state: latestTaskResolutionState(store.listEvents(taskId)),
  };
}

/**
 * Main explicitly reopens resolved attention, appending one immutable reopen
 * event. The unchanged failed/interrupted or succeeded-not-delivered Task
 * returns to its evidence-derived Now placement. Exact replay is idempotent;
 * nothing to reopen, a delivered outcome, or a conflicting reopen fails closed
 * before writing any event.
 *
 * `delivered` is the caller-computed delivery truth; reopening a Task that
 * later reached delivery is rejected so handled copy can never outrank a real
 * delivered outcome.
 */
export function reopenTaskResolution(
  store: StateStore,
  taskId: string,
  input: {
    note?: string;
    confirm: true;
    /** Caller-owned delivery truth; required with no Core default. */
    delivered: boolean;
  },
): { existing: boolean; state: TaskResolutionState } {
  if (input.confirm !== true) {
    throw new Error("reopen requires explicit confirm: true");
  }
  let note: string | undefined;
  if (input.note !== undefined) {
    const trimmed = input.note.trim();
    if (trimmed.length > TASK_RESOLUTION_NOTE_MAX_LENGTH) {
      throw new Error(`reopen note must be at most ${TASK_RESOLUTION_NOTE_MAX_LENGTH} characters`);
    }
    if (trimmed.length > 0) note = trimmed;
  }
  const task = store.getTask(taskId);
  if (
    task.status !== "failed"
    && task.status !== "interrupted"
    && task.status !== "succeeded"
  ) {
    throw new Error(`Task ${taskId} cannot be reopened from status ${task.status}`);
  }
  const events = store.listEvents(taskId);
  const state = latestTaskResolutionState(events);
  if (state.status === "none") {
    throw new Error(`Task ${taskId} is not resolved; nothing to reopen`);
  }
  if (input.delivered === true) {
    throw new Error(`Task ${taskId} already has a delivered outcome; reopen is not applicable`);
  }
  if (state.status === "reopened") {
    if (state.note === note) return { existing: true, state };
    throw new Error(`Task ${taskId} is already reopened; no conflicting reopen allowed`);
  }
  const payload: TaskReopenedPayload = {
    kind: "reopen",
    reopenedAt: timestamp(),
    ...(note === undefined ? {} : { note }),
  };
  store.addEvent(
    taskId,
    undefined,
    "task.resolution.reopened",
    "Main reopened the handled attention",
    payload,
  );
  return {
    existing: false,
    state: latestTaskResolutionState(store.listEvents(taskId)),
  };
}
