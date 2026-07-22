import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import path from "node:path";
import type {
  AttemptRecord,
  NormalizedWorkerEvent,
  TaskRecord,
  VerificationResult,
} from "./types.js";
import { taskPaths } from "./config.js";
import { loadTaskSpec } from "./task.js";
import { cloneDefaults, type ExecutionSettings, type ProviderDefaultsSettings, type TaskPolicy } from "./settings.js";
import { StateStore } from "../state/store.js";
import { assertWorkspaceExists, prepareWorkspace } from "../workspace/copy.js";
import { runClaudeWorker } from "../workers/claude.js";
import { verifyTask } from "./verifier.js";

export interface RunResult {
  task: TaskRecord;
  attempt: AttemptRecord;
  verification?: VerificationResult;
}

export type ProgressListener = (event: NormalizedWorkerEvent) => void;

function latestVerificationFeedback(store: StateStore, taskId: string): string | undefined {
  const event = store
    .listEvents(taskId)
    .filter((candidate) => candidate.type === "verification.command.completed")
    .at(-1);
  if (!event || event.payload === null || typeof event.payload !== "object") return undefined;
  const payload = event.payload as { command?: unknown; exitCode?: unknown; stdout?: unknown; stderr?: unknown };
  const stdout = typeof payload.stdout === "string" ? payload.stdout.slice(-12_000) : "";
  const stderr = typeof payload.stderr === "string" ? payload.stderr.slice(-6_000) : "";
  return [
    `Independent command: ${String(payload.command ?? "verification command")}`,
    `Exit code: ${String(payload.exitCode ?? "not recorded")}`,
    stdout ? `stdout:\n${stdout}` : "",
    stderr ? `stderr:\n${stderr}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function timestamp(): string {
  return new Date().toISOString();
}

interface TaskRecordInput {
  spec: TaskRecord["spec"];
  taskFile: string;
  home: string;
  id: string;
  sessionId: string;
  createdAt: string;
}

export function buildTaskRecord(input: TaskRecordInput): TaskRecord {
  const { spec, taskFile, home, id, sessionId, createdAt } = input;
  return {
    id,
    name: spec.name,
    status: "queued",
    sourcePath: spec.project,
    taskFile,
    spec,
    paths: taskPaths(home, id),
    sessionId,
    createdAt,
    updatedAt: createdAt,
  };
}

export function registerTaskFromSpec(
  store: StateStore,
  spec: TaskRecord["spec"],
  taskFile: string,
): TaskRecord {
  const id = randomUUID();
  const createdAt = timestamp();
  const record = buildTaskRecord({
    spec,
    taskFile,
    home: path.dirname(store.databasePath),
    id,
    sessionId: randomUUID(),
    createdAt,
  });
  store.createTask(record);
  store.addEvent(id, undefined, "task.created", `Task created: ${spec.name}`, {
    provider: spec.provider.name,
    model: spec.provider.model,
    runtime: spec.runtime.name,
    sourcePath: spec.project,
  });
  return store.getTask(id);
}

export async function prepareTaskWorkspace(store: StateStore, task: TaskRecord): Promise<TaskRecord> {
  store.setTaskStatus(task.id, "preparing", { finishedAt: null, error: null });
  try {
    const manifest = await prepareWorkspace(task.spec, task.paths);
    store.addEvent(task.id, undefined, "workspace.prepared", "Isolated workspace prepared", {
      workspace: task.paths.workspace,
      baseline: task.paths.baseline,
      copiedFiles: manifest.files.length,
      skippedSymlinks: manifest.skippedSymlinks,
      linkedDependencies: manifest.linkedDependencies,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.setTaskStatus(task.id, "failed", {
      finishedAt: timestamp(),
      error: `Workspace preparation failed: ${message}`,
    });
    throw error;
  }
  return store.getTask(task.id);
}

export async function createTaskFromSpec(
  store: StateStore,
  spec: TaskRecord["spec"],
  taskFile: string,
): Promise<TaskRecord> {
  const task = registerTaskFromSpec(store, spec, taskFile);
  return prepareTaskWorkspace(store, task);
}

export async function createTask(
  store: StateStore,
  taskFileInput: string,
  policy?: TaskPolicy,
): Promise<TaskRecord> {
  const { taskFile, spec } = await loadTaskSpec(taskFileInput, policy);
  return createTaskFromSpec(store, spec, taskFile);
}

function installInterruptForwarding(): {
  setChild: (child: ChildProcess) => void;
  wasInterrupted: () => boolean;
  dispose: () => void;
} {
  let child: ChildProcess | undefined;
  let interrupted = false;
  const handler = (): void => {
    interrupted = true;
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGINT");
  };
  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);
  return {
    setChild: (next) => {
      child = next;
      if (interrupted && child.exitCode === null && child.signalCode === null) child.kill("SIGINT");
    },
    wasInterrupted: () => interrupted,
    dispose: () => {
      process.removeListener("SIGINT", handler);
      process.removeListener("SIGTERM", handler);
    },
  };
}

export async function executeAttempt(
  store: StateStore,
  task: TaskRecord,
  resuming: boolean,
  onProgress?: ProgressListener,
  feedback?: string,
  execution?: ExecutionSettings,
  providerDefaults?: ProviderDefaultsSettings,
): Promise<RunResult> {
  await assertWorkspaceExists(task.paths);
  const exec = execution ?? cloneDefaults().execution;
  const ordinal = store.nextAttemptOrdinal(task.id);
  if (ordinal > exec.maxAttempts) {
    throw new Error(
      `Task ${task.id} has reached maximum attempts (${exec.maxAttempts}); cannot start attempt ${ordinal}`,
    );
  }
  const attemptId = randomUUID();
  const attempt: AttemptRecord = {
    id: attemptId,
    taskId: task.id,
    ordinal,
    status: "running",
    sessionId: task.sessionId,
    rawLogPath: path.join(task.paths.logs, `attempt-${ordinal}.jsonl`),
    startedAt: timestamp(),
  };
  store.createAttempt(attempt);
  store.setTaskStatus(task.id, "running", {
    currentAttemptId: attemptId,
    error: null,
    finishedAt: null,
    ...(task.startedAt === undefined ? { startedAt: attempt.startedAt } : {}),
  });

  const forwarding = installInterruptForwarding();
  let worker;
  try {
    try {
      const pd = providerDefaults?.[task.spec.provider.name];
      worker = await runClaudeWorker(store, store.getTask(task.id), attempt, resuming, {
        onSpawn: forwarding.setChild,
        ...(onProgress === undefined ? {} : { onEvent: onProgress }),
        wasInterrupted: forwarding.wasInterrupted,
        ...(feedback === undefined ? {} : { feedback }),
      }, exec, pd);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedAt = timestamp();
      store.updateAttempt(attemptId, {
        status: "failed",
        finishedAt: failedAt,
        exitCode: 1,
        error: message,
      });
      store.setTaskStatus(task.id, "failed", {
        finishedAt: failedAt,
        workerPid: null,
        error: message,
      });
      store.addEvent(task.id, attemptId, "worker.failed", message);
      return { task: store.getTask(task.id), attempt: store.getAttempt(attemptId) };
    }
  } finally {
    forwarding.dispose();
  }

  const workerFinishedAt = timestamp();
  if (worker.status === "interrupted") {
    store.updateAttempt(attemptId, {
      status: "interrupted",
      finishedAt: workerFinishedAt,
      exitCode: worker.exitCode,
      ...(worker.resultText === undefined ? {} : { resultText: worker.resultText }),
      ...(worker.costUsd === undefined ? {} : { costUsd: worker.costUsd }),
      ...(worker.turns === undefined ? {} : { turns: worker.turns }),
      ...(worker.error === undefined ? {} : { error: worker.error }),
    });
    store.setTaskStatus(task.id, "interrupted", {
      finishedAt: workerFinishedAt,
      workerPid: null,
      error: worker.error ?? "Worker execution interrupted",
    });
    store.addEvent(task.id, attemptId, "worker.interrupted", "Worker execution interrupted");
    return { task: store.getTask(task.id), attempt: store.getAttempt(attemptId) };
  }

  if (worker.status === "failed") {
    store.updateAttempt(attemptId, {
      status: "failed",
      finishedAt: workerFinishedAt,
      exitCode: worker.exitCode,
      ...(worker.resultText === undefined ? {} : { resultText: worker.resultText }),
      ...(worker.costUsd === undefined ? {} : { costUsd: worker.costUsd }),
      ...(worker.turns === undefined ? {} : { turns: worker.turns }),
      error: worker.error ?? "Worker execution failed",
    });
    store.setTaskStatus(task.id, "failed", {
      finishedAt: workerFinishedAt,
      workerPid: null,
      error: worker.error ?? "Worker execution failed",
    });
    store.addEvent(task.id, attemptId, "worker.failed", worker.error ?? "Worker execution failed");
    return { task: store.getTask(task.id), attempt: store.getAttempt(attemptId) };
  }

  const verification = await verifyTask(store, store.getTask(task.id), attemptId);
  const finalStatus = verification.passed ? "succeeded" : "failed";
  const finishedAt = timestamp();
  store.updateAttempt(attemptId, {
    status: finalStatus,
    finishedAt,
    exitCode: worker.exitCode,
    ...(worker.resultText === undefined ? {} : { resultText: worker.resultText }),
    ...(worker.costUsd === undefined ? {} : { costUsd: worker.costUsd }),
    ...(worker.turns === undefined ? {} : { turns: worker.turns }),
    ...(!verification.passed ? { error: "Independent verification failed" } : {}),
  });
  store.setTaskStatus(task.id, finalStatus, {
    finishedAt,
    workerPid: null,
    ...(verification.passed ? { error: null } : {}),
    ...(!verification.passed ? { error: "Independent verification failed" } : {}),
  });
  return {
    task: store.getTask(task.id),
    attempt: store.getAttempt(attemptId),
    verification,
  };
}

export async function runNewTask(
  store: StateStore,
  taskFile: string,
  onProgress?: ProgressListener,
  onCreated?: (task: TaskRecord) => void,
  policy?: TaskPolicy,
): Promise<RunResult> {
  const task = await createTask(store, taskFile, policy);
  onCreated?.(task);
  return executeAttempt(
    store,
    task,
    false,
    onProgress,
    undefined,
    policy?.execution,
    policy?.providerDefaults,
  );
}

export async function resumeTask(
  store: StateStore,
  taskId: string,
  onProgress?: ProgressListener,
  feedback?: string,
  execution?: ExecutionSettings,
  providerDefaults?: ProviderDefaultsSettings,
): Promise<RunResult> {
  const task = store.getTask(taskId);
  if (task.status !== "interrupted" && task.status !== "failed") {
    throw new Error(`Task ${taskId} cannot resume from status ${task.status}`);
  }
  const exec = execution ?? cloneDefaults().execution;
  const attemptCount = store.listAttempts(taskId).length;
  if (attemptCount >= exec.maxAttempts) {
    throw new Error(`Task ${taskId} has reached maximum attempts (${exec.maxAttempts})`);
  }
  const verifierFeedback = latestVerificationFeedback(store, taskId);
  const combinedFeedback = [
    verifierFeedback,
    feedback === undefined ? undefined : `Additional main Codex review:\n${feedback}`,
  ]
    .filter((item): item is string => item !== undefined)
    .join("\n\n");
  return executeAttempt(
    store, task, true, onProgress, combinedFeedback || undefined, exec, providerDefaults,
  );
}

export function reconcileTask(store: StateStore, taskId: string): TaskRecord {
  const task = store.getTask(taskId);
  if (task.status !== "running" || task.workerPid === undefined) return task;
  try {
    process.kill(task.workerPid, 0);
    return task;
  } catch {
    const updated = store.setTaskStatus(task.id, "interrupted", {
      finishedAt: timestamp(),
      workerPid: null,
      error: "Worker process disappeared before recording a terminal result",
    });
    store.addEvent(
      task.id,
      task.currentAttemptId,
      "worker.interrupted",
      "Worker process disappeared; task marked interrupted",
    );
    return updated;
  }
}
