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
  EffectivePolicySnapshot,
  PolicyLimitEvidence,
} from "./types.js";
import { resolveAttemptOfficialCost } from "./attempt-economics.js";
import { taskPaths } from "./config.js";
import { loadTaskSpec } from "./task.js";
import { cloneDefaults, type ExecutionSettings, type ProviderDefaultsSettings, type TaskPolicy } from "./settings.js";
import {
  deriveEnforcementCapability,
  enforcementCapabilityForRuntime,
  resolveTaskEffectivePolicy,
} from "./advanced-policy.js";
import { buildRemediationPacket, formatRemediationPacket } from "./remediation.js";
import {
  MAIN_REVIEW_REASON_MAX_LENGTH,
  recordMainReview,
} from "./main-review.js";
import { resolvePendingCorrectionGrant } from "./attempt-authorization.js";
import {
  captureCandidateRevision,
  buildCorrectionInstruction,
  candidateRevisionMatchesCurrentDiff,
  resolveLatestRevision,
} from "./candidate-revision.js";
import { isoTimestamp as timestamp } from "./time.js";
import { StateStore } from "../state/store.js";
import {
  assertWorkspaceExists,
  isWorkspaceReady,
  prepareWorkspace,
  type PreparationObservation,
} from "../workspace/copy.js";
import { verifyTask } from "./verifier.js";
import { checkpointSatisfied, resolveTerminalAfterVerification } from "./checkpoint.js";
import { getWorkerAdapter } from "../workers/registry.js";
import type { WorkerExecutionResult } from "../workers/types.js";
import {
  providerLabel,
  providerLaunchAuthentication,
  resolveProvider,
  type ProviderAuthInspector,
} from "./providers.js";

export interface RunResult {
  task: TaskRecord;
  attempt: AttemptRecord;
  verification?: VerificationResult;
}

export type ProgressListener = (event: NormalizedWorkerEvent) => void;

export class TaskLaunchAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskLaunchAuthenticationError";
  }
}

/**
 * True when this Attempt already recorded worker.failed with the exact same
 * public summary and the exact same durable failureCategory (including both
 * absent). Used only to avoid a second identical runner terminal after the
 * adapter already persisted one; any mismatch still appends.
 */
function sameAttemptExactWorkerFailed(
  store: StateStore,
  taskId: string,
  attemptId: string,
  summary: string,
  failureCategory: WorkerExecutionResult["failureCategory"],
): boolean {
  for (const event of store.listEvents(taskId)) {
    if (event.type !== "worker.failed") continue;
    if (event.attemptId !== attemptId) continue;
    if (event.summary !== summary) continue;
    const existing = event.payload !== null && typeof event.payload === "object"
      ? (event.payload as { failureCategory?: unknown }).failureCategory
      : undefined;
    const existingCategory = typeof existing === "string" ? existing : undefined;
    if (existingCategory === failureCategory) return true;
  }
  return false;
}

/** Persist remote connection evidence only when the selected adapter returned
 * success and the same Attempt emitted the canonical terminal event. This is
 * intentionally independent from later code-quality verification. */
export function recordWorkerConnectionEvidenceFromCompletedEvent(
  store: StateStore,
  task: TaskRecord,
  attemptId: string,
  workerStatus: WorkerExecutionResult["status"],
  observedAt: string,
  providerDefaults?: ProviderDefaultsSettings,
): boolean {
  if (workerStatus !== "succeeded") return false;
  const completed = store.listEvents(task.id).some(
    (event) => event.type === "worker.completed" && event.attemptId === attemptId,
  );
  if (!completed) return false;

  try {
    const providerParams: { model: string; endpoint?: string } = {
      model: task.spec.provider.model,
    };
    if (task.spec.provider.endpoint !== undefined) {
      providerParams.endpoint = task.spec.provider.endpoint;
    }
    const resolved = resolveProvider(
      task.spec.provider.name,
      providerParams,
      providerDefaults?.[task.spec.provider.name],
    );
    store.saveProbeEvidence({
      provider: task.spec.provider.name,
      model: resolved.model,
      endpointOrigin: new URL(resolved.endpoint).origin,
      status: "verified",
      latencyMs: 0,
      timestamp: observedAt,
      source: "worker-run",
    });
    return true;
  } catch {
    // Readiness evidence must never change the Task outcome.
    return false;
  }
}

/**
 * Fail one Task before workspace preparation or Attempt creation when the
 * selected Worker's exact local authentication path is not readable. The
 * event is safe for Task Detail and explicitly records that no Worker ran.
 */
export function preflightTaskLaunchAuthentication(
  store: StateStore,
  task: TaskRecord,
  inspector?: ProviderAuthInspector,
): boolean {
  const result = providerLaunchAuthentication(task.spec, inspector);
  if (result.ready) return true;

  const label = providerLabel(task.spec.provider.name);
  const message = `Worker could not start because ${label} authentication is not readable. Re-save or renew this Worker's authentication, then start a new Task.`;
  store.setTaskStatus(task.id, "failed", {
    finishedAt: timestamp(),
    workerPid: null,
    error: message,
  });
  store.addEvent(
    task.id,
    undefined,
    "task.launch-preflight.failed",
    message,
    {
      failureCategory: "authentication",
      reasonCode: result.reasonCode,
      provider: task.spec.provider.name,
      workerInvoked: false,
      workspacePrepared: false,
      attemptCreated: false,
    },
  );
  return false;
}

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
  effectivePolicy?: EffectivePolicySnapshot | undefined;
}

export function buildTaskRecord(input: TaskRecordInput): TaskRecord {
  const { spec, taskFile, home, id, sessionId, createdAt, effectivePolicy } = input;
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
    ...(effectivePolicy === undefined ? {} : { effectivePolicy }),
  };
}

export function registerTaskFromSpec(
  store: StateStore,
  spec: TaskRecord["spec"],
  taskFile: string,
  effectivePolicy?: EffectivePolicySnapshot,
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
    ...(effectivePolicy === undefined ? {} : { effectivePolicy }),
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

/** Privacy-safe Task-event bridge for typed preparation observations.
 *  Each observation becomes a durable `workspace.preparation.stage` event
 *  whose payload contains only the stage code, phase, monotonic elapsed
 *  milliseconds, and the aggregate count when actually known — never
 *  paths, file names, excluded names, credentials, or command text. */
function persistPreparationObservation(
  store: StateStore,
  taskId: string,
  observation: PreparationObservation,
): void {
  store.addEvent(
    taskId,
    undefined,
    "workspace.preparation.stage",
    `Preparation: ${observation.stage} (${observation.phase})`,
    {
      stage: observation.stage,
      phase: observation.phase,
      elapsedMs: observation.elapsedMs,
      ...(observation.count === undefined ? {} : { count: observation.count }),
      ...(observation.countKind === undefined ? {} : { countKind: observation.countKind }),
    },
  );
}

export async function prepareTaskWorkspace(store: StateStore, task: TaskRecord): Promise<TaskRecord> {
  store.setTaskStatus(task.id, "preparing", { finishedAt: null, error: null });
  try {
    const manifest = await prepareWorkspace(
      task.spec,
      task.paths,
      undefined,
      {
        observer: (observation) => {
          // Bridge to a durable Task event before returning.  Storing the
          // event here keeps observation order identical to the order in
          // which prepareWorkspace emits them.  The observer contract is
          // fail-closed: any throw or rejection from a downstream
          // observer attached by an external caller propagates out of
          // prepareWorkspace unchanged, and the existing catch block
          // then records the terminal failure without emitting the
          // final workspace.prepared event.
          persistPreparationObservation(store, task.id, observation);
        },
      },
    );
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
  effectivePolicy?: EffectivePolicySnapshot,
): Promise<TaskRecord> {
  const task = registerTaskFromSpec(store, spec, taskFile, effectivePolicy);
  return prepareTaskWorkspace(store, task);
}

export async function createTask(
  store: StateStore,
  taskFileInput: string,
  policy?: TaskPolicy,
): Promise<TaskRecord> {
  const { taskFile, spec } = await loadTaskSpec(taskFileInput, policy);
  const effectivePolicy = resolvePolicyFromTaskSpec(spec, policy);
  return createTaskFromSpec(store, spec, taskFile, effectivePolicy);
}

/** Resolve the effective advanced policy from a TaskSpec and optional policy.
 *  Returns undefined for legacy tasks without a policy.
 *  Never invents a strict new ceiling for legacy tasks. */
function resolvePolicyFromTaskSpec(
  spec: TaskRecord["spec"],
  policy?: TaskPolicy,
): EffectivePolicySnapshot | undefined {
  if (policy === undefined) return undefined;

  let capabilities = enforcementCapabilityForRuntime(spec.runtime.name);

  try {
    const adapter = getWorkerAdapter(spec.runtime.name);
    capabilities = deriveEnforcementCapability(adapter.capabilities());
  } catch {
    // Conservative defaults for unknown runtimes
  }

  return resolveTaskEffectivePolicy(spec, policy, capabilities);
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

function createDurationController(
  task: TaskRecord,
  attempt: AttemptRecord,
): {
  attach: (child: ChildProcess) => void;
  stop: () => void;
  triggered: () => boolean;
  observedMs: () => number;
} {
  const maxDurationMs = task.effectivePolicy?.values.maxDurationMs ?? null;
  const stopGraceMs = task.effectivePolicy?.values.workerStopGraceMs ?? 10_000;
  let durationTimer: ReturnType<typeof setTimeout> | undefined;
  let escalationTimer: ReturnType<typeof setTimeout> | undefined;
  let didTrigger = false;

  const observedMs = (): number => Math.max(0, Date.now() - Date.parse(attempt.startedAt));
  const attach = (child: ChildProcess): void => {
    if (maxDurationMs === null) return;
    const remainingMs = Math.max(0, maxDurationMs - observedMs());
    durationTimer = setTimeout(() => {
      didTrigger = true;
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGINT");
        escalationTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
          escalationTimer = undefined;
        }, stopGraceMs);
        escalationTimer.unref();
      }
    }, remainingMs);
    durationTimer.unref();
  };
  const stop = (): void => {
    if (durationTimer !== undefined) clearTimeout(durationTimer);
    if (escalationTimer !== undefined) clearTimeout(escalationTimer);
    durationTimer = undefined;
    escalationTimer = undefined;
  };
  return { attach, stop, triggered: () => didTrigger, observedMs };
}

function policyEventType(evidence: PolicyLimitEvidence):
  "policy.duration.exceeded" | "policy.token.exceeded" | "policy.noprogress.exceeded" | "policy.size.exceeded" {
  switch (evidence.category) {
    case "duration": return "policy.duration.exceeded";
    case "observed-token": return "policy.token.exceeded";
    case "no-progress": return "policy.noprogress.exceeded";
    case "file-limit":
    case "changed-line-limit": return "policy.size.exceeded";
  }
}

function recordPolicyLimit(
  store: StateStore,
  task: TaskRecord,
  attemptId: string,
  evidence: PolicyLimitEvidence,
): void {
  store.addEvent(
    task.id,
    attemptId,
    policyEventType(evidence),
    `Worker policy limit triggered: ${evidence.category}`,
    evidence,
  );
}

function failForPolicyLimit(
  store: StateStore,
  task: TaskRecord,
  attempt: AttemptRecord,
  worker: WorkerExecutionResult,
  evidence: PolicyLimitEvidence,
): RunResult {
  const finishedAt = timestamp();
  const error = `Worker policy limit exceeded: ${evidence.category}`;
  recordPolicyLimit(store, task, attempt.id, evidence);
  store.updateAttempt(attempt.id, {
    status: "failed",
    finishedAt,
    exitCode: worker.exitCode,
    ...(worker.resultText === undefined ? {} : { resultText: worker.resultText }),
    ...(worker.costUsd === undefined ? {} : { costUsd: worker.costUsd }),
    ...(worker.turns === undefined ? {} : { turns: worker.turns }),
    ...(worker.runtimeCostEstimateUsd === undefined
      ? {}
      : { runtimeCostEstimateUsd: worker.runtimeCostEstimateUsd }),
    ...(worker.usage === undefined ? {} : { usage: worker.usage }),
    error,
    officialCost: buildOfficialCost(task.spec.provider, worker.usage),
  });
  store.setTaskStatus(task.id, "failed", {
    finishedAt,
    workerPid: null,
    error,
  });
  return { task: store.getTask(task.id), attempt: store.getAttempt(attempt.id) };
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
  /**
   * Optional non-authoritative scheduler notification: the Worker process is no
   * longer occupying a Profile slot. Invoked at most once after the runtime
   * returns (or doctor/run fails before/while launching) and before independent
   * verification. Must never redefine Worker or Task success; ordinary direct
   * callers may omit it.
   */
  onWorkerProfileSlotRelease?: () => void,
): Promise<RunResult> {
  if (resuming) {
    await assertWorkspaceExists(task.paths);
  } else if (!(await isWorkspaceReady(task.paths))) {
    throw new Error("Worker snapshot is incomplete; preparation must finish before execution");
  }
  const exec = execution ?? cloneDefaults().execution;
  const ordinal = store.nextAttemptOrdinal(task.id);
  // Read base maxAttempts from immutable task snapshot, falling back to live settings for legacy tasks
  const baseMaxAttempts = task.effectivePolicy?.values.baseMaxAttempts ?? exec.maxAttempts;
  const maximumOrdinal = options?.maximumOrdinal ?? baseMaxAttempts;
  if (ordinal > maximumOrdinal) {
    throw new Error(
      `Task ${task.id} has reached maximum attempts (${maximumOrdinal}); cannot start attempt ${ordinal}`,
    );
  }
  const attemptId = randomUUID();
  const adapter = getWorkerAdapter(task.spec.runtime.name);
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
    runtimeBudgetEnforcement: adapter.capabilities().budgetFlag,
  };
  store.createAttempt(attempt);
  store.setTaskStatus(task.id, "running", {
    currentAttemptId: attemptId,
    error: null,
    finishedAt: null,
    ...(task.startedAt === undefined ? { startedAt: attempt.startedAt } : {}),
  });

  // Idempotent optional release: one notification per Attempt at the
  // Worker-return / pre-verification boundary. Failures here never rewrite
  // Worker, verification, or Task outcome.
  let profileSlotReleaseNotified = false;
  const notifyWorkerProfileSlotRelease = (): void => {
    if (profileSlotReleaseNotified) return;
    profileSlotReleaseNotified = true;
    if (onWorkerProfileSlotRelease === undefined) return;
    try {
      onWorkerProfileSlotRelease();
    } catch {
      // Non-authoritative: scheduler notification must not change Task outcome.
    }
  };

  const forwarding = installInterruptForwarding();
  const duration = createDurationController(task, attempt);
  let worker;
  try {
    try {
      const pd = providerDefaults?.[task.spec.provider.name];
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
          onSpawn: (child) => {
            forwarding.setChild(child);
            duration.attach(child);
          },
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
      // Doctor / launch failure: model process is not running. Notify so a
      // Profile slot is not held until the outer job Promise settles.
      notifyWorkerProfileSlotRelease();
      return { task: store.getTask(task.id), attempt: store.getAttempt(attemptId) };
    }
  } finally {
    duration.stop();
    forwarding.dispose();
  }

  // Worker child has exited. Drop the live PID immediately so status polling
  // (reconcileTask) cannot treat a finished Worker as a disappeared running
  // process while this attempt records terminal evidence or enters verification.
  // Failed/interrupted paths also clear workerPid; this closes the success-path race.
  store.updateTask(task.id, { workerPid: null });
  // Profile Worker occupancy ends when the model process returns — before
  // independent verification, Candidate capture, or final Task status.
  notifyWorkerProfileSlotRelease();

  const workerFinishedAt = timestamp();
  const maxDurationMs = task.effectivePolicy?.values.maxDurationMs ?? null;
  if (
    maxDurationMs !== null
    && (duration.triggered() || duration.observedMs() > maxDurationMs)
  ) {
    return failForPolicyLimit(store, task, attempt, worker, {
      category: "duration",
      enforcementPhase: duration.triggered() ? "preemptive" : "post-observation",
      configured: maxDurationMs,
      observed: duration.observedMs(),
      effect: "hard-fail",
      detail: "Worker exceeded the configured wall-duration limit",
    });
  }

  if (worker.policyLimit !== undefined) {
    recordPolicyLimit(store, task, attemptId, worker.policyLimit);
  }
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
    // Adapters such as Codex already persist the authoritative terminal
    // worker.failed (including reasonCode). Skip only an exact same-Attempt
    // duplicate of summary + durable failureCategory so that one truthful
    // reason remains; different summary, category, Attempt, or missing class
    // still appends normally.
    const failedSummary = worker.error ?? "Worker execution failed";
    if (!sameAttemptExactWorkerFailed(
      store,
      task.id,
      attemptId,
      failedSummary,
      worker.failureCategory,
    )) {
      store.addEvent(
        task.id,
        attemptId,
        "worker.failed",
        failedSummary,
        worker.failureCategory === undefined
          ? undefined
          : { failureCategory: worker.failureCategory },
      );
    }
    return { task: store.getTask(task.id), attempt: store.getAttempt(attemptId) };
  }

  // Genuine Worker connection succeeded — record verified evidence for the
  // exact Provider, model, and endpoint origin.  This evidence supersedes
  // any older explicit-probe failure and never exposes prompts, output,
  // credentials, or paths.
  //
  // Requires both adapter status "succeeded" AND a canonical worker.completed
  // event for this Attempt so launch failure, interruption, and absence of a
  // terminal response never fabricate connection evidence.
  recordWorkerConnectionEvidenceFromCompletedEvent(
    store,
    task,
    attempt.id,
    worker.status,
    workerFinishedAt,
    providerDefaults,
  );

  // Post-observation Token enforcement from the immutable Task snapshot.
  const snap = task.effectivePolicy;
  if (snap !== undefined && worker.status === "succeeded") {
    if (snap.values.observedTokenCeiling !== null && worker.usage !== undefined) {
      const grossTokens =
        worker.usage.inputTokens
        + worker.usage.outputTokens
        + worker.usage.cacheReadInputTokens
        + worker.usage.cacheCreationInputTokens;
      if (grossTokens > snap.values.observedTokenCeiling) {
        return failForPolicyLimit(store, task, attempt, worker, {
          category: "observed-token",
          enforcementPhase: "post-observation",
          configured: snap.values.observedTokenCeiling,
          observed: grossTokens,
          effect: "hard-fail",
          detail: "Observed gross Tokens exceeded the configured ceiling",
        });
      }
    }
  }

  const verification = await verifyTask(store, store.getTask(task.id), attemptId);

 // Capture immutable CandidateRevision evidence with private snapshot artifact.
 // The revision is bound to this Attempt, the verification event sequence,
 // and the exact integration Diff bytes at this point in time.
 // Must complete before the terminal status update.
  const verificationEvent = store.listEvents(task.id)
    .filter((event) => event.type === "verification.completed" && event.attemptId === attemptId)
    .at(-1);
  let revisionCaptureFailure: string | undefined;
  try {
    if (verificationEvent === undefined) {
      throw new Error("canonical verification event is missing");
    }
    const affected = verification.sourceCompatibility?.affectedPaths ?? [];
    const business = verification.patches?.business;
    await captureCandidateRevision(
      store,
      store.getTask(task.id),
      store.getAttempt(attemptId),
      verificationEvent.sequence,
      verification.passed,
      affected,
      business?.filesChanged ?? 0,
      business?.changedLines ?? 0,
    );
  } catch (error) {
    revisionCaptureFailure = error instanceof Error ? error.message : String(error);
    store.addEvent(
      task.id,
      attemptId,
      "candidate.revision.capture.failed",
      "Candidate revision capture failed",
      { category: "candidate-evidence", reason: revisionCaptureFailure.slice(0, 500) },
    );
  }

  const checkpointCap = adapter.capabilities().checkpoint;
  // Only inspect events when the runtime can produce a checkpoint; unsupported
  // never satisfies via payload (gapReason = runtime-unsupported instead).
  const checkpointOk = checkpointCap === "unsupported"
    ? false
    : checkpointSatisfied(
      store.listEvents(task.id),
      attemptId,
      task.spec.acceptance.commands.length,
    );
  const terminal = resolveTerminalAfterVerification({
    verificationPassed: verification.passed,
    checkpointCapability: checkpointCap,
    checkpointSatisfied: checkpointOk,
  });
  if (terminal.recordCheckpointGap && terminal.gapReason !== undefined) {
    const reason = terminal.gapReason;
    store.addEvent(
      task.id,
      attemptId,
      "checkpoint.skipped",
      reason === "runtime-unsupported"
        ? "Checkpoint skipped: runtime does not support ForkLight checkpoint MCP"
        : "Worker checkpoint missing or failed (non-authoritative); independent verification is decisive",
      {
        reason,
        runtime: task.spec.runtime.name,
        verificationPassed: verification.passed,
      },
    );
  }
  const finalStatus = revisionCaptureFailure === undefined ? terminal.status : "failed";
  const failure = revisionCaptureFailure === undefined
    ? terminal.failureReason
    : `Candidate revision capture failed: ${revisionCaptureFailure}`;
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
    ...(finalStatus === "failed" && failure !== undefined ? { error: failure } : {}),
    officialCost: buildOfficialCost(task.spec.provider, worker.usage),
  });
  store.setTaskStatus(task.id, finalStatus, {
    finishedAt,
    workerPid: null,
    ...(finalStatus === "succeeded" ? { error: null } : { error: failure ?? "Independent verification failed" }),
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
  const loaded = await loadTaskSpec(taskFile, policy);
  const effectivePolicy = resolvePolicyFromTaskSpec(loaded.spec, policy);
  let task = registerTaskFromSpec(store, loaded.spec, loaded.taskFile, effectivePolicy);
  onCreated?.(task);
  if (!preflightTaskLaunchAuthentication(store, task)) {
    throw new TaskLaunchAuthenticationError(store.getTask(task.id).error ?? "Worker authentication is not readable");
  }
  task = await prepareTaskWorkspace(store, task);
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
  onWorkerProfileSlotRelease?: () => void,
): Promise<RunResult> {
  const task = store.getTask(taskId);
  if (task.status !== "interrupted" && task.status !== "failed") {
    throw new Error(`Task ${taskId} cannot resume from status ${task.status}`);
  }
  const exec = execution ?? cloneDefaults().execution;
  const baseMaxAttempts = task.effectivePolicy?.values.baseMaxAttempts ?? exec.maxAttempts;
  const attemptCount = store.listAttempts(taskId).length;
  const maximumOrdinal = options?.maximumOrdinal ?? baseMaxAttempts;
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
    onWorkerProfileSlotRelease,
  );
}

/** Move a failed candidate into a durable queued correction state after its
 * authorization grant has been recorded. Existing Attempts, verification,
 * workspace, session, and logs remain immutable. */
export function prepareMainCorrectionTask(store: StateStore, taskId: string): TaskRecord {
  const task = store.getTask(taskId);
  if (task.status !== "failed" && task.status !== "interrupted" && task.status !== "succeeded") {
    throw new Error(`Task ${taskId} cannot prepare correction from status ${task.status}`);
  }
  // For succeeded tasks, a valid durable correction grant must already exist.
  // This prevents direct or reordered callers from queuing a succeeded Task
  // without the required authorization evidence.
  if (task.status === "succeeded") {
    const baseMaxAttempts = task.effectivePolicy?.values.baseMaxAttempts ?? 3;
    const pending = resolvePendingCorrectionGrant(store, taskId, baseMaxAttempts);
    if (pending === null) {
      throw new Error(
        "correction rejected: no pending correction grant for succeeded Task; call authorizeMainCorrection first",
      );
    }
  }
  store.setTaskStatus(taskId, "queued", {
    finishedAt: null,
    error: null,
    workerPid: null,
    currentAttemptId: null,
  });
  return store.getTask(taskId);
}

/** Execute exactly one previously authorized Main correction. The durable
 * grant is re-read so local, daemon, and restart-recovery paths all use the
 * same canonical feedback and budget. */
export async function correctTask(
  store: StateStore,
  taskId: string,
  onProgress?: ProgressListener,
  execution?: ExecutionSettings,
  providerDefaults?: ProviderDefaultsSettings,
  onWorkerProfileSlotRelease?: () => void,
): Promise<RunResult> {
  const exec = execution ?? cloneDefaults().execution;
  const task = store.getTask(taskId);
  if (task.status !== "queued") {
    throw new Error(`Task ${taskId} correction requires queued status`);
  }
  const baseMaxAttempts = task.effectivePolicy?.values.baseMaxAttempts ?? exec.maxAttempts;
  const pending = resolvePendingCorrectionGrant(store, taskId, baseMaxAttempts);
  if (pending === null) {
    throw new Error(`Task ${taskId} has no pending Main correction grant`);
  }
  const verifierFeedback = latestRemediationFeedback(store, taskId);

  // When a structured gap contract is bound to this correction, build the
  // canonical Worker instruction with reusable paths, gaps, and stop rule.
  let correctionFeedback: string;
  if (pending.gapContract !== undefined) {
    const revision = resolveLatestRevision(store.listEvents(taskId));
    if (
      revision === undefined
      || revision.taskId !== taskId
      || revision.id !== pending.gapContract.candidateRevisionId
      || !candidateRevisionMatchesCurrentDiff(task, revision)
    ) {
      throw new Error("Structured correction rejected: retained candidate no longer matches its authorized revision");
    }
    correctionFeedback = [
      verifierFeedback,
      buildCorrectionInstruction(pending.gapContract, pending.feedback),
    ].filter((item): item is string => item !== undefined).join("\n\n");
  } else {
    correctionFeedback = [
      verifierFeedback,
      `Additional main agent review:\n${pending.feedback}`,
    ].filter((item): item is string => item !== undefined).join("\n\n");
  }

  return executeAttempt(
    store,
    task,
    true,
    onProgress,
    correctionFeedback,
    exec,
    providerDefaults,
    pending.executionOptions,
    onWorkerProfileSlotRelease,
  );
}

/**
 * Status-poll supervision: if a running Task still has a live Worker PID and
 * that process is gone, mark interrupted. Never mutates verifying/terminal
 * Tasks and never starts a retry. Callers that enter verification must clear
 * workerPid (and set verifying) so a finished Worker cannot be interrupted here.
 */
export function reconcileTask(store: StateStore, taskId: string): TaskRecord {
  const task = store.getTask(taskId);
  // Only supervise live Worker execution. Independent verification and every
  // non-running status are durable and must not be interrupted by a status poll.
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
  const task = store.getTask(taskId);
  const baseMaxAttempts = task.effectivePolicy?.values.baseMaxAttempts ?? exec.maxAttempts;
  const check = checkReviseEligibility(
    store,
    taskId,
    feedback,
    options?.maximumOrdinal ?? baseMaxAttempts,
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
