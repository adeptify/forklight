import {
  buildStatusProgress,
  DEFAULT_QUIET_AFTER_MS,
  type LatestEventMeta,
} from "./task-progress.js";
import type {
  DecisionStage,
  TaskDecisionView,
  TaskRecord,
  RemediationDisposition,
} from "./types.js";
import type { WorkerFailureCategory } from "./worker-failure.js";

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
  } = {},
): SafeTaskSummary {
  const progress = buildStatusProgress(
    task,
    options.latestEvent,
    options.nowMs ?? Date.now(),
    options.quietAfterMs ?? DEFAULT_QUIET_AFTER_MS,
    options.preparationStage,
  );
  return buildTaskSummary(
    task,
    progress,
    options.failureCategory,
    options.remediationDisposition,
    options.decisionStage,
  );
}
