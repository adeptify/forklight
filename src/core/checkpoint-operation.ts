import { createHash } from "node:crypto";
import type { CheckpointOperationStatus } from "./types.js";

/**
 * Checkpoint operation core: owns one logical approved-command execution and
 * reconstructs its terminal status from durable event evidence.
 *
 * Identity is deterministic per (Task, Attempt, canonical command-id selection)
 * so a lost start response or a repeated start reuses the same operation and
 * never spawns a second verifier process. Terminal status is always rebuilt
 * from ordered events; a durable started event with no terminal event and no
 * in-memory execution is projected as outcome-unknown and never rerun.
 */

/** Stable deterministic operation identity for one canonical selection. */
export function checkpointOperationId(
  taskId: string,
  attemptId: string,
  canonicalCommandIds: readonly string[],
): string {
  const digest = createHash("sha256")
    .update(`${taskId}\0${attemptId}\0${canonicalCommandIds.join("\0")}`)
    .digest("hex");
  return `checkpoint-${digest.slice(0, 32)}`;
}

/** Extract the embedded operationId from a checkpoint lifecycle event payload. */
export function checkpointPayloadOperationId(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const value = (payload as { operationId?: unknown }).operationId;
  return typeof value === "string" ? value : undefined;
}

export type CheckpointTerminalState =
  | { status: "completed"; report: unknown }
  | { status: "failed" }
  | undefined;

/** Reconstruct the terminal state for one operation from ordered events.
 *  The last terminal event wins; started-without-terminal is not terminal. */
export function checkpointTerminalFromEvents(
  events: readonly { type: string; payload?: unknown }[],
  operationId: string,
): CheckpointTerminalState {
  let terminal: CheckpointTerminalState = undefined;
  for (const event of events) {
    if (
      event.type === "checkpoint.completed"
      && checkpointPayloadOperationId(event.payload) === operationId
    ) {
      terminal = { status: "completed", report: event.payload };
    } else if (
      event.type === "checkpoint.failed"
      && checkpointPayloadOperationId(event.payload) === operationId
    ) {
      terminal = { status: "failed" };
    }
  }
  return terminal;
}

/** True when durable started evidence exists for the operation. */
export function checkpointStartedFromEvents(
  events: readonly { type: string; payload?: unknown }[],
  operationId: string,
): boolean {
  return events.some(
    (event) =>
      event.type === "checkpoint.started"
      && checkpointPayloadOperationId(event.payload) === operationId,
  );
}

/** Bounded terminal status classification for one operation view. */
export function checkpointViewStatus(
  terminal: CheckpointTerminalState,
  running: boolean,
): CheckpointOperationStatus {
  if (terminal?.status === "completed") return "completed";
  if (terminal?.status === "failed") return "failed";
  if (running) return "running";
  return "outcome-unknown";
}
