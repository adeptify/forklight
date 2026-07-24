import type { TaskDecisionView, TaskRecord } from "./types.js";

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
  };
}
