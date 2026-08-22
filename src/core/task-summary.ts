import {
  buildStatusProgress,
  DEFAULT_QUIET_AFTER_MS,
  type LatestEventMeta,
  type LiveStageEventEvidence,
} from "./task-progress.js";
import {
  latestTaskResolutionState,
  type TaskResolutionState,
} from "./task-resolution.js";
import type {
  DecisionStage,
  TaskDecisionView,
  TaskRecord,
  RemediationDisposition,
} from "./types.js";
import type { WorkerFailureCategory } from "./worker-failure.js";

/**
 * Canonical board placement: whether a Task still needs attention (`now`) or
 * has reached a durably closed end-to-end outcome (`history`). A closed
 * privacy-safe code produced by the Core read projection; the Hub only
 * translates these codes and must never recompute lifecycle semantics.
 */
export type BoardScope = "now" | "history";

/**
 * Closed reason code describing why a Task holds its board placement. Pure
 * vocabulary - it never carries a review reason, prompt, path, command, error
 * body, event payload, or free text.
 */
export type BoardReason =
  | "active-work"
  | "awaiting-main"
  | "revision-requested"
  | "integration-pending"
  | "unresolved-failure"
  | "needs-review"
  | "delivered"
  | "activated"
  | "repaired-delivered"
  | "main-rejected"
  | "attention-resolved";

/** Closed vocabulary of board scope codes, shared with the Hub adapter. */
export const BOARD_SCOPE_VALUES: readonly BoardScope[] = ["now", "history"];

/** Legal boardReason codes for each boardScope. The Hub adapter validates a
 *  placement as a legal pair (not two independent vocabulary memberships) so
 *  contradictory but individually valid tokens are rejected and the UI fails
 *  open to Now. */
export const BOARD_REASON_BY_SCOPE: Readonly<Record<BoardScope, readonly BoardReason[]>> = {
  now: [
    "active-work",
    "awaiting-main",
    "revision-requested",
    "integration-pending",
    "unresolved-failure",
    "needs-review",
  ],
  history: [
    "delivered",
    "activated",
    "repaired-delivered",
    "main-rejected",
    "attention-resolved",
  ],
};

/** Flat closed vocabulary of all board reason codes (union of the per-scope
 *  sets), shared with tests and the Hub adapter. */
export const BOARD_REASON_VALUES: readonly BoardReason[] = [
  ...BOARD_REASON_BY_SCOPE.now,
  ...BOARD_REASON_BY_SCOPE.history,
];

/** True only when boardScope and boardReason form a legal placement pair.
 *  Unknown types and contradictory pairs return false so callers fail open. */
export function isLegalBoardPlacement(boardScope: unknown, boardReason: unknown): boolean {
  if (typeof boardScope !== "string" || typeof boardReason !== "string") return false;
  const reasons = boardScope === "now" || boardScope === "history"
    ? BOARD_REASON_BY_SCOPE[boardScope]
    : undefined;
  return reasons !== undefined && (reasons as readonly string[]).includes(boardReason);
}

interface BoardPlacement {
  boardScope: BoardScope;
  boardReason: BoardReason;
}

/**
 * Pure, deterministic projection of Task status, Decision Stage, verified
 * repaired-delivery disposition, and explicit attention resolution into a
 * closed Now/History placement.
 *
 * History requires durable evidence: a delivered or activated Integration, an
 * explicit Main rejection, a Main-verified repaired delivery, or an explicit
 * Main resolution that the real-world failure was handled. Machine
 * `succeeded` alone is never enough for History; machine `failed` alone is
 * never a final outcome. Unknown, contradictory, malformed, or omitted
 * evidence fails open to `now` so unfinished work is never hidden.
 *
 * Contains no review reason, prompt, path, command, error body, event payload,
 * or free text. The Decision Stage already encodes the status-derived workflow
 * state; `status` is consumed as a legacy fallback so still-executing work is
 * labelled `active-work` rather than `needs-review` when Decision evidence is
 * absent.
 */
export function projectBoardPlacement(input: {
  status: TaskRecord["status"];
  decisionStage?: DecisionStage;
  remediationDisposition?: RemediationDisposition;
  attentionResolution?: TaskResolutionState;
}): BoardPlacement {
  // Delivered/activated Integration is the strongest current evidence and
  // stays authoritative over any earlier Main rejection or Main-repaired
  // delivery.
  switch (input.decisionStage) {
    case "delivered":
      return { boardScope: "history", boardReason: "delivered" };
    case "activated":
      return { boardScope: "history", boardReason: "activated" };
    default:
      break;
  }
  // Main-verified repaired delivery is a closed delivered outcome and beats an
  // older Main rejection: a later Main-repaired delivery is grouped Delivered
  // even when the machine Task status remains failed or interrupted and the
  // Decision Stage has not advanced to Integration.
  if (
    input.remediationDisposition !== undefined
    && input.remediationDisposition.status === "verified-repaired-delivered"
  ) {
    return { boardScope: "history", boardReason: "repaired-delivered" };
  }
  // Explicit Main resolution of handled attention is a durable closed outcome
  // for a terminal failed/interrupted/succeeded Task: it moves to History while
  // its machine status is preserved. Succeeded is eligible only because the
  // delivered/activated/repaired branches above already outrank it — a delivered
  // succeeded Task is never hidden here. Forged resolution evidence on
  // queued/running/preparing/verifying/blocked/waiting targets must never hide
  // the work in History; reopened or malformed evidence also falls through to
  // the normal placement.
  if (
    input.attentionResolution?.status === "resolved"
    && (input.status === "failed"
      || input.status === "interrupted"
      || input.status === "succeeded")
  ) {
    return { boardScope: "history", boardReason: "attention-resolved" };
  }
  switch (input.decisionStage) {
    case "main-rejected":
      return { boardScope: "history", boardReason: "main-rejected" };
    case "awaiting-main-review":
    case "machine-verified":
      return { boardScope: "now", boardReason: "awaiting-main" };
    case "revision-requested":
      return { boardScope: "now", boardReason: "revision-requested" };
    case "ready-for-integration":
    case "integrating":
    case "applied-not-activated":
      return { boardScope: "now", boardReason: "integration-pending" };
    case "machine-failed":
    case "integration-failed":
      return { boardScope: "now", boardReason: "unresolved-failure" };
    case "queued":
    case "worker-running":
      return { boardScope: "now", boardReason: "active-work" };
    case "unknown":
    default:
      // No closed outcome and no recognizable open stage. Legacy callers that
      // omit Decision evidence fail open to Now. Still-executing machine work
      // is active; terminal or contradictory evidence needs review.
      if (
        input.status === "queued"
        || input.status === "waiting"
        || input.status === "blocked"
        || input.status === "preparing"
        || input.status === "running"
        || input.status === "verifying"
      ) {
        return { boardScope: "now", boardReason: "active-work" };
      }
      return { boardScope: "now", boardReason: "needs-review" };
  }
}

export interface SafeTaskSummary {
  taskId: string;
  name: string;
  status: TaskRecord["status"];
  provider: string;
  model: string;
  runtime: string;
  sourcePath: string;
  workspacePath: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  progress?: TaskDecisionView["progress"];
  /** Current end-to-end workflow stage. This lets compact list surfaces explain
   *  what happens after machine verification without exposing review reasons. */
  decisionStage?: DecisionStage;
  /** Present when a Worker terminal failure was classified (auth/budget/runtime). */
  failureCategory?: WorkerFailureCategory;
  /** Present when Main has verified the repaired source as delivered.
   *  Contains only status, checkId, and createdAt — no raw command output, reason, or source. */
  remediationDisposition?: RemediationDisposition;
  /** Latest explicit Main attention-resolution state (resolved/reopened/none).
   *  `resolved` closes handled attention (a failed/interrupted or
   *  succeeded-not-delivered Task) to History without changing machine status;
   *  `reopened` returns it to Now. Privacy-safe: reason code + bounded Main
   *  note + optional evidence Task id + timestamps only. */
  attentionResolution?: TaskResolutionState;
  /** Canonical Now/History placement. Always set by buildTaskSummary; absent
   *  only on hand-built legacy summaries. `history` means a durably closed
   *  end-to-end outcome; `now` means work or a decision still needs attention. */
  boardScope?: BoardScope;
  /** Closed reason code for the board placement. Privacy-safe: no review
   *  reason, prompt, path, command, error body, or event payload. */
  boardReason?: BoardReason;
}

/**
 * Flat TaskRecord projection for the status/list surfaces. `progress` carries
 * the canonical lastEventAt + activity signal (FL-D83): a running task's
 * tasks.updatedAt is frozen between spawn and terminal, so callers that want to
 * show real Worker activity pass the progress cursor computed from
 * store.latestEventMeta (CLI status) or TaskDecisionView.progress (MCP).
 */
export function buildTaskSummary(
  task: TaskRecord,
  progress?: TaskDecisionView["progress"],
  failureCategory?: WorkerFailureCategory,
  remediationDisposition?: RemediationDisposition,
  decisionStage?: DecisionStage,
  attentionResolution?: TaskResolutionState,
): SafeTaskSummary {
  return {
    taskId: task.id,
    name: task.name,
    status: task.status,
    provider: task.spec.provider.name,
    model: task.spec.provider.model,
    runtime: task.spec.runtime.name,
    sourcePath: task.sourcePath,
    workspacePath: task.paths.workspace,
    sessionId: task.sessionId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.startedAt === undefined ? {} : { startedAt: task.startedAt }),
    ...(task.finishedAt === undefined ? {} : { finishedAt: task.finishedAt }),
    ...(task.error === undefined ? {} : { error: task.error }),
    ...(progress === undefined ? {} : { progress }),
    ...(decisionStage === undefined ? {} : { decisionStage }),
    ...(failureCategory === undefined ? {} : { failureCategory }),
    ...(remediationDisposition === undefined ? {} : { remediationDisposition }),
    // Only terminal failed/interrupted/succeeded Tasks can project attention
    // resolution; forged resolution evidence on other statuses never surfaces
    // on the summary. Delivered truth still outranks resolution in placement.
    ...(attentionResolution === undefined
      || attentionResolution.status === "none"
      || (task.status !== "failed"
        && task.status !== "interrupted"
        && task.status !== "succeeded")
      ? {}
      : { attentionResolution }),
    // Canonical Now/History placement is always provided so every board/list
    // surface can default to Now without recomputing lifecycle semantics.
    ...projectBoardPlacement({
      status: task.status,
      ...(decisionStage === undefined ? {} : { decisionStage }),
      ...(remediationDisposition === undefined ? {} : { remediationDisposition }),
      ...(attentionResolution === undefined ? {} : { attentionResolution }),
    }),
  };
}

/**
 * One-shot list/status projection: progress from latest-event meta + optional
 * failureCategory. Shared by CLI list, MCP list, and Console /tasks.
 */
export function projectTaskSurface(
  task: TaskRecord,
  options: {
    latestEvent?: LatestEventMeta;
    failureCategory?: WorkerFailureCategory;
    remediationDisposition?: RemediationDisposition;
    decisionStage?: DecisionStage;
    nowMs?: number;
    quietAfterMs?: number;
    /** Caller-provided preparation-stage cursor keeps this projection pure. */
    preparationStage?: {
      stage: string;
      phase: "start" | "complete";
      elapsedMs: number;
      countKind?: "files" | "dependencies";
      count?: number;
    };
    /**
     * Ordered durable event evidence for the canonical live-stage reducer.
     * When omitted, progress falls back to a coarse latest-event projection.
     */
    events?: readonly LiveStageEventEvidence[];
  } = {},
): SafeTaskSummary {
  const progress = buildStatusProgress(
    task,
    options.latestEvent,
    options.nowMs ?? Date.now(),
    options.quietAfterMs ?? DEFAULT_QUIET_AFTER_MS,
    options.preparationStage,
    options.events,
  );
  // Latest explicit Main attention resolution derived from the same ordered
  // durable events the live-stage reducer uses. Absent events (legacy callers)
  // leave resolution unset so placement fails open to Now.
  const attentionResolution = options.events === undefined
    ? undefined
    : latestTaskResolutionState(options.events);
  return buildTaskSummary(
    task,
    progress,
    options.failureCategory,
    options.remediationDisposition,
    options.decisionStage,
    attentionResolution,
  );
}
