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

export function buildTaskSummary(
  task: TaskRecord,
  decision?: TaskDecisionView,
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
    ...(decision === undefined ? {} : { progress: decision.progress }),
  };
}
