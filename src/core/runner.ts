import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import path from "node:path";
import type {
  AttemptOfficialCost,
  AttemptExecutionOptions,
  AttemptRecord,
  AttemptTokenUsage,
  NormalizedWorkerEvent,
  ProviderSpec,
  TaskRecord,
  VerificationResult,
} from "./types.js";
import { resolveAttemptOfficialCost } from "./attempt-economics.js";
import { taskPaths } from "./config.js";
import { loadTaskSpec } from "./task.js";
import { cloneDefaults, type ExecutionSettings, type ProviderDefaultsSettings, type TaskPolicy } from "./settings.js";
import { buildRemediationPacket, formatRemediationPacket } from "./remediation.js";
import {
  MAIN_REVIEW_REASON_MAX_LENGTH,
  recordMainReview,
} from "./main-review.js";
import { isoTimestamp as timestamp } from "./time.js";
import { StateStore } from "../state/store.js";
import { assertWorkspaceExists, prepareWorkspace } from "../workspace/copy.js";
import { verifyTask } from "./verifier.js";
import { checkpointSatisfied } from "./checkpoint.js";
import { getWorkerAdapter } from "../workers/registry.js";

export interface RunResult {
  task: TaskRecord;
  attempt: AttemptRecord;
  verification?: VerificationResult;
}

export type ProgressListener = (event: NormalizedWorkerEvent) => void;

function latestRemediationFeedback(store: StateStore, taskId: string): string | undefined {
  const packet = buildRemediationPacket(store.listEvents(taskId));
  return packet === undefined ? undefined : formatRemediationPacket(packet);
}

function buildOfficialCost(provider: ProviderSpec, usage?: AttemptTokenUsage): AttemptOfficialCost {
  return resolveAttemptOfficialCost(provider, usage);
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
  options?: AttemptExecutionOptions,
): Promise<RunResult> {
  await assertWorkspaceExists(task.paths);
  const exec = execution ?? cloneDefaults().execution;
  const ordinal = store.nextAttemptOrdinal(task.id);
  const maximumOrdinal = options?.maximumOrdinal ?? exec.maxAttempts;
  if (ordinal > maximumOrdinal) {
    throw new Error(
      `Task ${task.id} has reached maximum attempts (${maximumOrdinal}); cannot start attempt ${ordinal}`,
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
    runtimeBudgetUsd: options?.maxBudgetUsdOverride === undefined
      ? task.spec.runtime.maxBudgetUsd
      : options.maxBudgetUsdOverride,
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
      const adapter = getWorkerAdapter(task.spec.runtime.name);
      // KD14: fail closed when the selected runtime doctor is not ok (even if
      // global health.ok is true because Claude is present).
      const doctorResult = adapter.doctor();
      const doctor = doctorResult instanceof Promise ? await doctorResult : doctorResult;
      if (!doctor.ok) {
        const detail = doctor.issues.length > 0
          ? doctor.issues.join("; ")
          : `${adapter.displayName} is not ready`;
        throw new Error(
          `Worker runtime ${adapter.name} doctor failed: ${detail}`,
        );
      }
      worker = await adapter.run({
        store,
        task: store.getTask(task.id),
        attempt,
        resuming,
        hooks: {
          onSpawn: forwarding.setChild,
          ...(onProgress === undefined ? {} : { onEvent: onProgress }),
          wasInterrupted: forwarding.wasInterrupted,
          ...(feedback === undefined ? {} : { feedback }),
        },
        execution: exec,
        ...(pd === undefined ? {} : { providerDefaults: pd }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedAt = timestamp();
      store.updateAttempt(attemptId, {
        status: "failed",
        finishedAt: failedAt,
        exitCode: 1,
        error: message,
        officialCost: buildOfficialCost(task.spec.provider),
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
      ...(worker.runtimeCostEstimateUsd === undefined ? {} : { runtimeCostEstimateUsd: worker.runtimeCostEstimateUsd }),
      ...(worker.usage === undefined ? {} : { usage: worker.usage }),
      ...(worker.error === undefined ? {} : { error: worker.error }),
      officialCost: buildOfficialCost(task.spec.provider, worker.usage),
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
      ...(worker.runtimeCostEstimateUsd === undefined ? {} : { runtimeCostEstimateUsd: worker.runtimeCostEstimateUsd }),
      ...(worker.usage === undefined ? {} : { usage: worker.usage }),
      error: worker.error ?? "Worker execution failed",
      officialCost: buildOfficialCost(task.spec.provider, worker.usage),
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
  const adapter = getWorkerAdapter(task.spec.runtime.name);
  const checkpointCap = adapter.capabilities().checkpoint;
  let checkpointPassed: boolean;
  if (checkpointCap === "unsupported") {
    store.addEvent(
      task.id,
      attemptId,
      "checkpoint.skipped",
      "Checkpoint skipped: runtime does not support ForkLight checkpoint MCP",
      { reason: "runtime-unsupported", runtime: task.spec.runtime.name },
    );
    checkpointPassed = true;
  } else {
    checkpointPassed = checkpointSatisfied(
      store.listEvents(task.id),
      attemptId,
      task.spec.acceptance.commands.length,
    );
  }
  const finalStatus = verification.passed && checkpointPassed ? "succeeded" : "failed";
  const failure = !checkpointPassed
    ? "Required bounded checkpoint missing or failed"
    : "Independent verification failed";
  const finishedAt = timestamp();
  store.updateAttempt(attemptId, {
    status: finalStatus,
    finishedAt,
    exitCode: worker.exitCode,
    ...(worker.resultText === undefined ? {} : { resultText: worker.resultText }),
    ...(worker.costUsd === undefined ? {} : { costUsd: worker.costUsd }),
    ...(worker.turns === undefined ? {} : { turns: worker.turns }),
    ...(worker.runtimeCostEstimateUsd === undefined ? {} : { runtimeCostEstimateUsd: worker.runtimeCostEstimateUsd }),
    ...(worker.usage === undefined ? {} : { usage: worker.usage }),
    ...(finalStatus === "failed" ? { error: failure } : {}),
    officialCost: buildOfficialCost(task.spec.provider, worker.usage),
  });
  store.setTaskStatus(task.id, finalStatus, {
    finishedAt,
    workerPid: null,
    ...(finalStatus === "succeeded" ? { error: null } : { error: failure }),
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
  options?: AttemptExecutionOptions,
): Promise<RunResult> {
  const task = store.getTask(taskId);
  if (task.status !== "interrupted" && task.status !== "failed") {
    throw new Error(`Task ${taskId} cannot resume from status ${task.status}`);
  }
  const exec = execution ?? cloneDefaults().execution;
  const attemptCount = store.listAttempts(taskId).length;
  const maximumOrdinal = options?.maximumOrdinal ?? exec.maxAttempts;
  if (attemptCount >= maximumOrdinal) {
    throw new Error(`Task ${taskId} has reached maximum attempts (${maximumOrdinal})`);
  }
  const verifierFeedback = latestRemediationFeedback(store, taskId);
  const combinedFeedback = [
    verifierFeedback,
    feedback === undefined ? undefined : `Additional main agent review:\n${feedback}`,
  ]
    .filter((item): item is string => item !== undefined)
    .join("\n\n");
  return executeAttempt(
    store, task, true, onProgress, combinedFeedback || undefined, exec, providerDefaults, options,
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

// --- Revision: standalone succeeded-only pre-integration correction ---

/** Fixed upper bound for revise feedback, measured in characters (UTF-16
 *  code units) of the trimmed feedback.  Bounded so the operator never
 *  accidentally forwards a full prompt, contract body, or other sensitive
 *  Task content through the correction channel. */
export const REVISE_FEEDBACK_MAX_LENGTH = MAIN_REVIEW_REASON_MAX_LENGTH;

export type ReviseRejectionReason =
  | "not-succeeded"
  | "missing-feedback"
  | "feedback-too-long"
  | "exhausted-attempts"
  | "plan-member"
  | "competition-candidate"
  | "integration-history";

export interface ReviseCheckResult {
  readonly eligible: boolean;
  readonly reason?: ReviseRejectionReason;
  /** Canonical trimmed feedback; only present when eligible.  This is
   *  the exact string the daemon, coordinator, and local fallback all
   *  pass forward to the Worker. */
  readonly canonicalFeedback?: string;
}

/** Pure eligibility check shared by daemon and local-fallback paths.
 *  Trims the feedback exactly once, validates emptiness and length on
 *  the trimmed value, and returns the canonical trimmed string.  Every
 *  rejection reason is a fixed privacy-safe label that never echoes
 *  feedback content, Task names, paths, prompts, outputs, or credentials. */
export function checkReviseEligibility(
  store: StateStore,
  taskId: string,
  feedback: string,
  maxAttempts: number,
): ReviseCheckResult {
  const trimmed = feedback.trim();
  if (!trimmed) return { eligible: false, reason: "missing-feedback" };
  if (trimmed.length > REVISE_FEEDBACK_MAX_LENGTH) {
    return { eligible: false, reason: "feedback-too-long" };
  }
  const task = store.getTask(taskId);
  if (task.status !== "succeeded") return { eligible: false, reason: "not-succeeded" };
  if (store.getPlanItemByTaskId(taskId) !== undefined) return { eligible: false, reason: "plan-member" };
  if (store.getCompetitionByCandidateTaskId(taskId) !== undefined) {
    return { eligible: false, reason: "competition-candidate" };
  }
  if (store.listIntegrationResults(taskId).length > 0) {
    return { eligible: false, reason: "integration-history" };
  }
  if (store.listAttempts(taskId).length >= maxAttempts) {
    return { eligible: false, reason: "exhausted-attempts" };
  }
  return { eligible: true, canonicalFeedback: trimmed };
}

/** Fixed non-echoing reason string for each rejection.  These strings
 *  are safe to surface in CLI output, daemon errors, and events. */
export function describeReviseRejection(reason: ReviseRejectionReason): string {
  switch (reason) {
    case "not-succeeded": return "revision requires succeeded Task";
    case "missing-feedback": return "revision requires explicit trimmed feedback";
    case "feedback-too-long": return "revision feedback exceeds configured upper bound";
    case "exhausted-attempts": return "revision requires remaining configured attempts";
    case "plan-member": return "revision rejected: Task belongs to a plan";
    case "competition-candidate": return "revision rejected: Task is a competition candidate";
    case "integration-history": return "revision rejected: Task has integration history";
  }
}

/** Move an eligible standalone succeeded Task to queued for a content-free,
 *  bounded review-revision attempt.  Old attempts and verification results
 *  remain immutable; the prior terminal and live-attempt fields
 *  (finishedAt, error, workerPid, currentAttemptId, startedAt) are cleared
 *  so downstream consumers cannot mistake the pre-revision succeeded state
 *  or its live-attempt pointers for the current one.  Historical Attempt
 *  rows are preserved by the Store's existing patch semantics. */
export function prepareReviseTask(store: StateStore, taskId: string): TaskRecord {
  store.setTaskStatus(taskId, "queued", {
    finishedAt: null,
    error: null,
    workerPid: null,
    currentAttemptId: null,
    startedAt: null,
  });
  store.addEvent(
    taskId,
    undefined,
    "task.revise.requested",
    "Task revision requested for main-review correction",
    { reason: "main-review-correction" },
  );
  return store.getTask(taskId);
}

export async function reviseTask(
  store: StateStore,
  taskId: string,
  feedback: string,
  onProgress?: ProgressListener,
  execution?: ExecutionSettings,
  providerDefaults?: ProviderDefaultsSettings,
  options?: AttemptExecutionOptions,
): Promise<RunResult> {
  const exec = execution ?? cloneDefaults().execution;
  const check = checkReviseEligibility(
    store,
    taskId,
    feedback,
    options?.maximumOrdinal ?? exec.maxAttempts,
  );
  if (!check.eligible) {
    throw new Error(check.reason !== undefined
      ? describeReviseRejection(check.reason)
      : "revise rejected");
  }
  recordMainReview(store, taskId, {
    decision: "revise",
    reason: check.canonicalFeedback!,
    confirm: true,
  });
  // Transition to queued first, then re-read so the post-clearance record
  // is what executeAttempt sees; its `task.startedAt === undefined` branch
  // re-seeds startedAt with the new attempt's timestamp.
  prepareReviseTask(store, taskId);
  const cleared = store.getTask(taskId);
  // Verifier feedback is intentionally NOT combined — the previous attempt
  // is what the Main agent is correcting; canonical main-agent feedback stands
  // alone as the correction instruction.
  return executeAttempt(
    store, cleared, true, onProgress, check.canonicalFeedback, exec, providerDefaults, options,
  );
}
