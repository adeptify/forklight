import type { EventType, TaskDecisionView, TaskRecord, TaskStatus } from "./types.js";

/** Default quiet window for last-event activity (30s). Shared by CLI status/wait and Decision View. */
export const DEFAULT_QUIET_AFTER_MS = 30_000;

const TERMINAL_STATUSES = new Set<TaskStatus>(["succeeded", "failed", "interrupted"]);

export type ProgressActivity = "active" | "quiet" | "terminal";

/** True when Task status will never receive further Worker progress. */
export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** O(1) latest-event cursor fields used by status/wait without loading full payloads. */
export interface LatestEventMeta {
  sequence: number;
  timestamp: string;
  type: EventType | string;
  summary: string;
}

/**
 * Classify Worker activity from Task status + latest event age (FL-D83).
 * `tasks.updatedAt` is frozen between spawn and terminal, so callers must not
 * treat updatedAt as a liveness signal.
 */
export function classifyActivity(
  task: TaskRecord,
  latestEvent: LatestEventMeta | undefined,
  nowMs: number,
  quietAfterMs: number,
): ProgressActivity {
  if (isTerminalTaskStatus(task.status)) return "terminal";
  if (latestEvent === undefined) return "quiet";
  const eventMs = Date.parse(latestEvent.timestamp);
  if (!Number.isFinite(eventMs)) return "quiet";
  return nowMs - eventMs <= quietAfterMs ? "active" : "quiet";
}

/**
 * Canonical TaskDecisionView.progress for status surfaces (CLI status, MCP
 * status via Decision View, list JSON). Driven by latest-event metadata rather
 * than frozen tasks.updatedAt.
 */
export function buildStatusProgress(
  task: TaskRecord,
  latestEvent: LatestEventMeta | undefined,
  nowMs: number,
  quietAfterMs: number = DEFAULT_QUIET_AFTER_MS,
): TaskDecisionView["progress"] {
  return {
    activity: classifyActivity(task, latestEvent, nowMs, quietAfterMs),
    latestEventSequence: latestEvent?.sequence ?? 0,
    ...(latestEvent === undefined ? {} : { lastEventAt: latestEvent.timestamp }),
    ...(latestEvent === undefined ? {} : { latestAction: latestEvent.summary }),
  };
}

/** Map store.latestEventMeta rows into the progress cursor shape. */
export function toLatestEventMeta(
  meta: Pick<LatestEventMeta, "sequence" | "timestamp" | "type" | "summary"> | undefined,
): LatestEventMeta | undefined {
  if (meta === undefined) return undefined;
  return {
    sequence: meta.sequence,
    timestamp: meta.timestamp,
    type: meta.type,
    summary: meta.summary,
  };
}
