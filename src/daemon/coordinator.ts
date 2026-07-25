import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  CompetitionRecord,
  AttemptAuthorization,
  AttemptExecutionOptions,
  CheckpointReport,
  CheckpointRequest,
  DependencyRecord,
  IntegrationResultRecord,
  IntegrationOperationView,
  IntegrationStageEvidence,
  MainReviewDecision,
  MainReviewDecisionKind,
  PlanItemRecord,
  PlanRecord,
  ProbeEvidence,
  ProviderStatus,
  StagedTaskRegistration,
  TaskRecord,
  TaskSpec,
  TaskStatus,
} from "../core/types.js";
import { runCheckpoint } from "../core/checkpoint.js";
import { authorizeExtraAttempt } from "../core/attempt-authorization.js";
import { latestMainReview, recordMainReview } from "../core/main-review.js";
import type { ProviderName } from "../core/providers.js";
import { providerNames } from "../core/providers.js";
import {
  createClaudeProbeRunner,
  ProviderProbeService,
  realClock,
  realExecFile,
  realKeychainChecker,
  realKeychainReader,
  type ProbePolicy,
} from "../core/provider-probe.js";
import { assertWorkPlan, type WorkPlan } from "../core/plan.js";
import {
  buildTaskRecord,
  checkReviseEligibility,
  describeReviseRejection,
  executeAttempt,
  prepareReviseTask,
  prepareTaskWorkspace,
  registerTaskFromSpec,
  resumeTask,
} from "../core/runner.js";
import {
  CompetitionCoordinator,
  CompetitionService,
  rankingPolicy,
  type CandidateOverride,
  type RankingPolicyOverride,
} from "../core/competition.js";
import { loadTaskSpec, parseTaskSpec } from "../core/task.js";
import { isoTimestamp as timestamp, sleepMs as sleep } from "../core/time.js";
import { providerReadiness } from "../core/providers.js";
import { listWorkerAdapters } from "../workers/registry.js";
import {
  resolveReadiness,
  type DependencyDecision,
} from "../core/dependency-resolver.js";
import { BoardService, type PlanBoard, type PlanBoardSummary } from "../core/board.js";
import {
  StatisticsService,
  type ProviderModelSummary,
  type StatisticsFilter,
} from "../core/statistics.js";
import {
  SettingsService,
  type ForkLightSettings,
  type TaskPolicy,
} from "../core/settings.js";
import type { StateStore } from "../state/store.js";
import { assertWorkspaceExists } from "../workspace/copy.js";
import {
  applyIntegration,
  preflightIntegration,
  type PreflightReceipt,
} from "../core/integration.js";
import { getTaskEconomicsReport, type TaskEconomicsReport } from "../core/task-economics-report.js";
import {
  captureDirectCodexSample,
  listDirectCodexInbox,
  recordDirectCodexReview,
  previewDirectCodexPublication,
  registerDirectCodexCalibrationPublication,
  type DirectCodexInboxItem,
} from "../core/direct-codex-workflow-service.js";
import type { DirectCodexPairedSample } from "../core/direct-codex-calibration.js";
import type { DirectCodexSampleReview } from "../core/direct-codex-review.js";
import type { DirectCodexPublicationPreview, DirectCodexRegistrationResult } from "../core/direct-codex-publication-service.js";
import { currentBuildIdentity } from "../core/build-identity.js";
import {
  buildIntegrationOperationView,
  type IntegrationOperationContext,
} from "../core/integration-operation.js";
import { buildTaskDecisionView } from "../core/task-decision-view.js";
import { projectTaskSurface, type SafeTaskSummary } from "../core/task-summary.js";
import { isTerminalTaskStatus, toLatestEventMeta } from "../core/task-progress.js";
import { failureCategoryForTask } from "../core/worker-failure.js";
import {
  launchActivationRunner,
  writeActivationHandoff,
} from "../activation/runner.js";

export interface PlanRegistrationResult {
  planId: string;
  taskIdsByItemId: Record<string, string>;
}

interface QueuedJob {
  taskId: string;
  resuming: boolean;
  revising?: boolean;
  feedback?: string;
  executionOptions?: AttemptExecutionOptions;
}

type ProviderProbeOutcome = ProbeEvidence | { error: string };

export async function probeProvidersBounded(
  names: readonly ProviderName[],
  policy: Pick<ProbePolicy, "maxProbeConcurrency">,
  probe: (name: ProviderName) => Promise<ProbeEvidence>,
): Promise<Record<ProviderName, ProviderProbeOutcome>> {
  const completed = new Map<ProviderName, ProviderProbeOutcome>();
  let nextIndex = 0;
  const workerCount = Math.min(policy.maxProbeConcurrency, names.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < names.length) {
      const providerName = names[nextIndex]!;
      nextIndex += 1;
      try {
        completed.set(providerName, await probe(providerName));
      } catch (error) {
        completed.set(providerName, {
          error: error instanceof Error ? error.message : "Provider probe failed",
        });
      }
    }
  });
  await Promise.all(workers);

  const ordered = {} as Record<ProviderName, ProviderProbeOutcome>;
  for (const name of names) ordered[name] = completed.get(name)!;
  return ordered;
}

function taskPolicy(settings: ForkLightSettings): TaskPolicy {
  return {
    contractQuality: settings.contractQuality,
    execution: settings.execution,
    providerDefaults: settings.providerDefaults,
    completionPolicy: settings.completionPolicy,
    workerProfiles: settings.workerProfiles,
    modelCatalog: settings.modelCatalog,
  };
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function looksLikeWorker(pid: number): boolean {
  try {
    const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return /(?:claude|grok|sandbox-exec)/i.test(command);
  } catch {
    return false;
  }
}

async function stopOrphanWorker(pid: number): Promise<void> {
  if (!processExists(pid) || !looksLikeWorker(pid)) return;
  process.kill(pid, "SIGINT");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!processExists(pid)) return;
    await sleep(100);
  }
  if (processExists(pid) && looksLikeWorker(pid)) process.kill(pid, "SIGTERM");
}

export class DaemonCoordinator {
  private readonly queue: QueuedJob[] = [];
  private readonly active = new Map<string, Promise<void>>();
  private readonly activeIntegrations = new Map<string, Promise<void>>();
  private readonly integrationOperations = new Map<string, IntegrationOperationContext>();
  private closing = false;

  constructor(
    private readonly store: StateStore,
    private readonly settings: SettingsService,
    private readonly maxConcurrencyOverride?: number,
  ) {}

  health(): Record<string, unknown> {
    let claudeCode = "unavailable";
    try {
      claudeCode = execFileSync("claude", ["--version"], { encoding: "utf8" }).trim();
    } catch {
      // Reported below.
    }
    const effectiveSettings = this.settings.get();
    const readiness = providerReadiness(effectiveSettings.providerDefaults);
    const verification = this.safeVerificationSnapshot();
    const runtimes: Record<string, unknown> = {};
    for (const adapter of listWorkerAdapters()) {
      const doctorResult = adapter.doctor();
      // Built-ins are sync; Promise would be a custom adapter contract change.
      if (doctorResult instanceof Promise) {
        runtimes[adapter.name] = {
          ok: false,
          displayName: adapter.displayName,
          executable: adapter.defaultExecutable,
          issues: ["async doctor not supported in health snapshot"],
          capabilities: adapter.capabilities(),
        };
        continue;
      }
      runtimes[adapter.name] = {
        ok: doctorResult.ok,
        displayName: adapter.displayName,
        executable: doctorResult.executable,
        ...(doctorResult.version === undefined ? {} : { version: doctorResult.version }),
        issues: doctorResult.issues,
        capabilities: doctorResult.capabilities,
      };
    }
    return {
      // Transition: ok still requires Claude for daemon liveness + any provider.
      ok: claudeCode !== "unavailable" && readiness.anyReady,
      pid: process.pid,
      claudeCode,
      runtimes,
      defaultRuntime: effectiveSettings.execution.defaultRuntime,
      providers: readiness.providers,
      providerVerification: verification,
      maxConcurrency: this.maxConcurrencyOverride ?? effectiveSettings.execution.maxConcurrency,
      activeTaskIds: [...this.active.keys()],
      queuedTaskIds: this.queue.map((job) => job.taskId),
      databasePath: this.store.databasePath,
      buildIdentity: currentBuildIdentity(),
    };
  }

  checkpoint(request: CheckpointRequest): Promise<CheckpointReport> {
    return runCheckpoint(this.store, request);
  }

  async submitFile(taskFile: string): Promise<TaskRecord> {
    const settings = this.settings.get();
    const loaded = await loadTaskSpec(taskFile, taskPolicy(settings));
    const task = registerTaskFromSpec(this.store, loaded.spec, loaded.taskFile);
    this.queueTask(task.id);
    return this.store.getTask(task.id);
  }

  async submit(rawTask: unknown, baseDirectory: string): Promise<TaskRecord> {
    const settings = this.settings.get();
    const spec = parseTaskSpec(rawTask, baseDirectory, taskPolicy(settings));
    const task = registerTaskFromSpec(this.store, spec, "forklight://mcp/inline-task");
    this.queueTask(task.id);
    return this.store.getTask(task.id);
  }

  async submitCompetitionFile(taskFile: string, candidates: CandidateOverride[]): Promise<CompetitionRecord> {
    const settings = this.settings.get();
    const loaded = await loadTaskSpec(taskFile, taskPolicy(settings));
    return this.submitCompetition(loaded.spec, loaded.taskFile, candidates);
  }

  async submitInlineCompetition(
    rawTask: unknown,
    baseDirectory: string,
    candidates: CandidateOverride[],
  ): Promise<CompetitionRecord> {
    const settings = this.settings.get();
    const spec = parseTaskSpec(rawTask, baseDirectory, taskPolicy(settings));
    return this.submitCompetition(spec, "forklight://mcp/inline-competition-task", candidates);
  }

  async submitCompetition(
    contractSpec: TaskSpec,
    contractTaskFile: string,
    candidates: CandidateOverride[],
  ): Promise<CompetitionRecord> {
    const coordinator = new CompetitionCoordinator(this.store, this.settings);
    const { competition, taskIds } = await coordinator.create(
      contractSpec,
      contractTaskFile,
      candidates,
    );
    for (const taskId of taskIds) this.queueTask(taskId);
    return competition;
  }

  competitionStatus(competitionId: string): Record<string, unknown> {
    const competition = this.store.getCompetition(competitionId);
    const candidateRecords = this.store.getCompetitionCandidates(competitionId);
    const candidates = candidateRecords.map((record) => {
      const task = this.store.getTask(record.taskId);
      return {
        candidateId: record.id,
        taskId: record.taskId,
        ordinal: record.ordinal,
        providerName: record.providerName,
        modelName: record.modelName,
        taskStatus: task.status,
        ...(task.startedAt === undefined ? {} : { taskStartedAt: task.startedAt }),
        ...(task.finishedAt === undefined ? {} : { taskFinishedAt: task.finishedAt }),
        ...(task.error === undefined ? {} : { error: task.error }),
      };
    });
    const terminal = candidates.filter(
      (c) => typeof c.taskStatus === "string" && isTerminalTaskStatus(c.taskStatus as TaskStatus),
    );
    const progress = { terminal: terminal.length, total: candidates.length };

    let evaluation: unknown;
    if (competition.status === "completed") {
      const evals = this.store.listCompetitionEvaluations(competitionId);
      evaluation = evals.length > 0 ? evals[evals.length - 1] : undefined;
    }

    return { competition, candidates, progress, ...(evaluation === undefined ? {} : { evaluation }) };
  }

  competitionCompare(
    competitionId: string,
    override?: RankingPolicyOverride,
  ): Record<string, unknown> {
    const competition = this.store.getCompetition(competitionId);
    if (override === undefined) {
      // Default: return the stored latest evaluation if it exists (FL-D114: label vs preview).
      const evals = this.store.listCompetitionEvaluations(competitionId);
      if (evals.length > 0) {
        return {
          evaluation: evals[evals.length - 1],
          evaluationKind: "stored",
          note:
            "Historical evaluation recorded when candidates finished. "
            + "Pass rankingWeights for an ephemeral current-policy preview that is not persisted.",
        };
      }

      // No stored evaluation — compute a pure preview with the immutable creation-time policy
      const policy = competition.rankingPolicy;
      const service = new CompetitionService(this.store);
      return {
        evaluation: service.previewScore(competitionId, policy),
        evaluationKind: "ephemeral-preview",
        note:
          "No stored evaluation yet; this is a pure preview with the competition creation-time policy.",
      };
    }
    // Override: ephemeral pure preview — never persists
    const effectiveCompetition = this.settings.get().competition;
    const policy = rankingPolicy(override, {
      ...effectiveCompetition,
      rankingWeights: competition.rankingPolicy.weights,
      tieThreshold: competition.rankingPolicy.tieThreshold,
    });
    const service = new CompetitionService(this.store);
    return {
      evaluation: service.previewScore(competitionId, policy),
      evaluationKind: "ephemeral-preview",
      note:
        "Override weights produce an ephemeral what-if score; nothing is persisted. "
        + "Omit rankingWeights to read the stored historical evaluation when available.",
    };
  }

  competitionList(status?: string): Record<string, unknown>[] {
    const records = this.store.listCompetitions(
      status === "pending" || status === "running" || status === "completed" ? status : undefined,
    );
    return records.map((competition) => {
      const candidates = this.store.getCompetitionCandidates(competition.id);
      const terminal = candidates.filter((record) =>
        isTerminalTaskStatus(this.store.getTask(record.taskId).status));
      return {
        id: competition.id,
        name: competition.name,
        status: competition.status,
        candidateCount: candidates.length,
        progress: { terminal: terminal.length, total: candidates.length },
        createdAt: competition.createdAt,
        updatedAt: competition.updatedAt,
      };
    });
  }

  submitPlan(plan: WorkPlan): PlanRegistrationResult {
    const planId = plan.planFile;
    const createdAt = timestamp();
    const home = path.dirname(this.store.databasePath);
    const taskIdsByItemId: Record<string, string> = {};
    const registrations: StagedTaskRegistration[] = [];
    const items: PlanItemRecord[] = [];

    plan.items.forEach((item, itemIndex) => {
      const taskId = randomUUID();
      taskIdsByItemId[item.id] = taskId;
      registrations.push({
        task: buildTaskRecord({
          spec: item.task,
          taskFile: item.taskFile,
          home,
          id: taskId,
          sessionId: randomUUID(),
          createdAt,
        }),
        creationEvent: {
          summary: `Task created: ${item.task.name}`,
          payload: {
            provider: item.task.provider.name,
            model: item.task.provider.model,
            runtime: item.task.runtime.name,
            sourcePath: item.task.project,
          },
        },
      });
      items.push({
        id: item.id,
        planId,
        taskId,
        itemIndex,
        taskFile: item.taskFile,
      });
    });

    const dependencies: DependencyRecord[] = plan.items.flatMap((item) =>
      item.dependsOn.map((dependsOnItemId) => ({
        planId,
        itemId: item.id,
        dependsOnItemId,
      })),
    );
    const record: PlanRecord = {
      id: planId,
      name: plan.name,
      objective: plan.objective,
      planFile: plan.planFile,
      createdAt,
      updatedAt: createdAt,
    };

    this.store.createPlanExecution(registrations, record, items, dependencies);
    for (const taskId of Object.values(taskIdsByItemId)) this.queueTask(taskId);
    return { planId, taskIdsByItemId };
  }

  async submitPlanFile(planFile: string): Promise<PlanRegistrationResult> {
    const settings = this.settings.get();
    const report = await assertWorkPlan(planFile, taskPolicy(settings));
    return this.submitPlan(report.plan);
  }

  resume(
    taskId: string,
    feedback?: string,
    authorization?: AttemptAuthorization,
  ): TaskRecord {
    const task = this.store.getTask(taskId);
    if (task.status !== "interrupted" && task.status !== "failed") {
      throw new Error(`Task ${taskId} cannot resume from status ${task.status}`);
    }
    const maxAttempts = this.settings.get().execution.maxAttempts;
    const attemptCount = this.store.listAttempts(taskId).length;
    if (attemptCount >= maxAttempts && authorization === undefined) {
      throw new Error(`Task ${taskId} has reached maximum attempts (${maxAttempts})`);
    }
    if (this.closing) throw new Error("ForkLight daemon is shutting down");
    if (this.active.has(taskId) || this.queue.some((job) => job.taskId === taskId)) {
      throw new Error(`Task ${taskId} is already queued or running`);
    }
    const executionOptions = authorization === undefined
      ? undefined
      : authorizeExtraAttempt(
          this.store,
          taskId,
          authorization,
          maxAttempts,
          this.settings.get().execution.maximumBudgetUsd,
        );
    this.enqueue({
      taskId,
      resuming: attemptCount > 0,
      ...(feedback === undefined ? {} : { feedback }),
      ...(executionOptions === undefined ? {} : { executionOptions }),
    });
    return task;
  }

  /** Request a main-review correction attempt for a standalone succeeded
   *  Task.  Validates eligibility (status, plan/competition membership,
   *  integration history, attempt budget, canonical trimmed feedback
   *  under the configured character bound), then checks queue admission
   *  (closing, active, already queued) before transitioning the Task
   *  to queued (clearing terminal and live-attempt fields and recording
   *  a content-free revision event).  Finally enqueues a revise job that
   *  reuses the existing session and workspace with the canonical
   *  feedback.  Returns the canonical queued TaskRecord so callers can
   *  verify the transition occurred before return.
   *
   *  Queue-admission is verified BEFORE prepareReviseTask so a rejection
   *  never strands the Task in queued state with a recorded event.  The
   *  enqueue method retains its own defensive duplicate assertion. */
  revise(
    taskId: string,
    feedback: string,
    authorization?: AttemptAuthorization,
  ): TaskRecord {
    const execution = this.settings.get().execution;
    const maxAttempts = execution.maxAttempts;
    const check = checkReviseEligibility(
      this.store,
      taskId,
      feedback,
      authorization === undefined ? maxAttempts : maxAttempts + 1,
    );
    if (!check.eligible) {
      throw new Error(check.reason !== undefined
        ? describeReviseRejection(check.reason)
        : "revise rejected");
    }
    // Verify queue admission before mutating the Task — a failed enqueue
    // after prepareReviseTask would strand the Task in queued state with
    // a recorded event and no corresponding job.
    if (this.closing) {
      throw new Error("ForkLight daemon is shutting down");
    }
    if (this.active.has(taskId) || this.queue.some((job) => job.taskId === taskId)) {
      throw new Error(`Task ${taskId} is already queued or running`);
    }
    const executionOptions = authorization === undefined
      ? undefined
      : authorizeExtraAttempt(
          this.store,
          taskId,
          authorization,
          maxAttempts,
          execution.maximumBudgetUsd,
        );
    recordMainReview(this.store, taskId, {
      decision: "revise",
      reason: check.canonicalFeedback!,
      confirm: true,
    });
    const queued = prepareReviseTask(this.store, taskId);
    this.enqueue({
      taskId,
      resuming: true,
      revising: true,
      // canonicalFeedback is defined when eligible: true (proven above);
      // the exact trimmed value is what the Worker receives.
      feedback: check.canonicalFeedback!,
      ...(executionOptions === undefined ? {} : { executionOptions }),
    }, true);
    return queued;
  }

  mainReview(
    taskId: string,
    decision: MainReviewDecisionKind,
    reason: string,
    confirm: true,
  ): MainReviewDecision {
    return recordMainReview(this.store, taskId, { decision, reason, confirm });
  }

  status(taskId: string): TaskRecord {
    return this.store.getTask(taskId);
  }

  /** Return the canonical TaskEconomicsReport unchanged — no arithmetic, no
   *  calibration inference, no Task class discovery, and no private content.
   *  The Store verify step is delegated to getTaskEconomicsReport. */
  taskEconomics(taskId: string): TaskEconomicsReport {
    return getTaskEconomicsReport(this.store, taskId);
  }

  // --- Direct-Codex calibration workflow ---

  directCodexCapture(usage: unknown, metadata: unknown): DirectCodexPairedSample {
    return captureDirectCodexSample(this.store, usage, metadata);
  }

  directCodexInbox(taskClass: unknown, profileId: unknown): readonly DirectCodexInboxItem[] {
    return listDirectCodexInbox(this.store, taskClass, profileId);
  }

  directCodexReview(params: unknown): DirectCodexSampleReview {
    return recordDirectCodexReview(this.store, params);
  }

  directCodexPublicationPreview(params: unknown): DirectCodexPublicationPreview {
    return previewDirectCodexPublication(this.store, params);
  }

  directCodexPublicationRegister(params: unknown): DirectCodexRegistrationResult {
    return registerDirectCodexCalibrationPublication(this.store, params);
  }

  list(statuses?: TaskStatus[], limit = 20): TaskRecord[] {
    return this.store.listTasks(statuses).slice(0, Math.max(1, Math.min(limit, 100)));
  }

  /**
   * List Task surfaces with latest-event progress (and failureCategory only
   * for failed|interrupted). Shared by MCP list and Console Board data.
   */
  listTaskSurfaces(statuses?: TaskStatus[], limit = 20): SafeTaskSummary[] {
    const nowMs = Date.now();
    return this.list(statuses, limit).map((task) => {
      const latestEvent = toLatestEventMeta(this.store.latestEventMeta(task.id));
      const failureCategory = failureCategoryForTask(
        task.status,
        this.store.listEvents(task.id),
      );
      return projectTaskSurface(task, {
        ...(latestEvent === undefined ? {} : { latestEvent }),
        ...(failureCategory === undefined ? {} : { failureCategory }),
        nowMs,
      });
    });
  }

  getPlanBoard(planId: string): PlanBoard {
    return new BoardService(this.store).getPlanBoard(planId);
  }

  listPlanBoards(limit?: number): PlanBoardSummary[] {
    return new BoardService(this.store).listPlanBoards(limit);
  }

  statistics(filter: StatisticsFilter = {}): ProviderModelSummary[] {
    return new StatisticsService(this.store).summarize(filter);
  }

  taskTimeline(
    taskId: string,
    limit: number,
  ): Array<{ timestamp: string; type: string; summary: string }> {
    this.store.getTask(taskId); // validates task exists
    return this.store
      .listEvents(taskId)
      .slice(-Math.max(1, Math.min(limit, 100)))
      .map((ev) => ({
        timestamp: ev.timestamp,
        type: ev.type,
        summary: ev.summary,
      }));
  }

  getSettings(): ForkLightSettings {
    return this.settings.get();
  }

  updateSettings(patch: Record<string, unknown>): ForkLightSettings {
    return this.settings.update(patch);
  }

  resetSettings(): ForkLightSettings {
    return this.settings.reset();
  }

  async inspect(taskId: string): Promise<Record<string, unknown>> {
    const task = this.store.getTask(taskId);
    let diff = "";
    try {
      diff = await readFile(task.paths.diff, "utf8");
    } catch {
      // The diff is created when verification starts.
    }
    const attempts = this.store.listAttempts(taskId);
    const events = this.store.listEvents(taskId);
    return {
      task,
      attempts,
      events,
      mainReview: latestMainReview(events),
      decision: buildTaskDecisionView({
        task,
        attempts,
        events,
        integrationResults: this.store.listIntegrationResults(taskId),
      }),
      diff,
    };
  }

  taskDecision(taskId: string): import("../core/types.js").TaskDecisionView {
    const task = this.store.getTask(taskId);
    return buildTaskDecisionView({
      task,
      attempts: this.store.listAttempts(taskId),
      events: this.store.listEvents(taskId),
      integrationResults: this.store.listIntegrationResults(taskId),
    });
  }

  async integrationPreflight(taskId: string): Promise<PreflightReceipt> {
    return preflightIntegration(this.store, taskId, this.settings.get().integration);
  }

  startIntegration(taskId: string, receiptId: string): IntegrationOperationView {
    if (this.closing) throw new Error("ForkLight daemon is shutting down");
    this.store.getTask(taskId);
    const receipt = this.store.getIntegrationReceipt(receiptId);
    if (receipt === undefined) throw new Error("Integration receipt not found");
    if (receipt.taskId !== taskId) throw new Error("Integration receipt belongs to another Task");
    if (receipt.consumed) throw new Error("Integration receipt has already been consumed");
    if (receipt.rejectionReasons.length > 0) {
      throw new Error("Integration preflight receipt did not pass");
    }
    if (Date.parse(receipt.expiresAt) <= Date.now()) {
      throw new Error("Integration preflight receipt has expired");
    }
    if ([...this.integrationOperations.values()].some(
      (operation) =>
        operation.receiptId === receiptId
        && this.activeIntegrations.has(operation.operationId),
    )) {
      throw new Error("Integration receipt already has a running operation");
    }

    const context: IntegrationOperationContext = {
      operationId: randomUUID(),
      taskId,
      receiptId,
    };
    this.integrationOperations.set(context.operationId, context);
    this.store.addEvent(
      taskId,
      undefined,
      "integration.operation.started",
      "Integration operation started",
      context,
    );
    const execution = applyIntegration(
      this.store,
      taskId,
      receiptId,
      this.settings.get().integration,
      context.operationId,
    )
      .then(async (result) => {
        if (result.status !== "activation-pending") return;
        const task = this.store.getTask(taskId);
        try {
          const handoffPath = await writeActivationHandoff(
            task.paths.root,
            {
              ...result.handoff,
              home: path.dirname(this.store.databasePath),
            },
          );
          launchActivationRunner(
            handoffPath,
            path.join(task.paths.logs, `activation-${context.operationId}.log`),
          );
        } catch (error) {
          this.completeIntegrationActivation(
            context.operationId,
            taskId,
            receiptId,
            {
              stage: "runtime-activated",
              status: "failed",
              error: `Activation runner launch failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          );
        }
      })
      .catch(() => {
        if (this.store.getIntegrationResult(context.operationId) === undefined) {
          this.store.addEvent(
            taskId,
            undefined,
            "integration.operation.recovered",
            "Integration background execution ended without a final result",
            { ...context, status: "outcome-unknown" },
          );
        }
      })
      .finally(() => {
        this.activeIntegrations.delete(context.operationId);
      });
    this.activeIntegrations.set(context.operationId, execution);
    return buildIntegrationOperationView(this.store, context, true);
  }

  private integrationContext(operationId: string): IntegrationOperationContext {
    const known = this.integrationOperations.get(operationId);
    if (known !== undefined) return known;
    const result = this.store.getIntegrationResult(operationId);
    if (result === undefined) throw new Error(`Unknown Integration operation: ${operationId}`);
    const context = {
      operationId,
      taskId: result.taskId,
      receiptId: result.receiptId,
    };
    this.integrationOperations.set(operationId, context);
    return context;
  }

  integrationStatus(operationId: string): IntegrationOperationView {
    const context = this.integrationContext(operationId);
    return buildIntegrationOperationView(
      this.store,
      context,
      this.activeIntegrations.has(operationId),
    );
  }

  async waitIntegration(
    operationId: string,
    timeoutMs: number,
  ): Promise<IntegrationOperationView> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 3_600_000) {
      throw new Error("Integration wait timeoutMs must be an integer from 1 to 3600000");
    }
    const context = this.integrationContext(operationId);
    const deadline = Date.now() + timeoutMs;
    while (
      this.store.getIntegrationResult(operationId) === undefined
      && Date.now() < deadline
    ) {
      await sleep(Math.min(50, Math.max(1, deadline - Date.now())));
    }
    const completed = this.store.getIntegrationResult(operationId) !== undefined;
    return buildIntegrationOperationView(
      this.store,
      context,
      this.activeIntegrations.has(operationId),
      !completed,
    );
  }

  completeIntegrationActivation(
    operationId: string,
    taskId: string,
    receiptId: string,
    evidence: IntegrationStageEvidence,
  ): IntegrationOperationView {
    const context = this.integrationContext(operationId);
    if (context.taskId !== taskId || context.receiptId !== receiptId) {
      throw new Error("Activation completion does not match Integration operation");
    }
    if (this.store.getIntegrationResult(operationId) !== undefined) {
      throw new Error("Integration operation already has a final result");
    }
    if (
      evidence.stage !== "runtime-activated"
      || (evidence.status !== "passed" && evidence.status !== "failed")
    ) {
      throw new Error("Activation completion requires passed or failed runtime evidence");
    }
    const allCommandsPassed =
      evidence.commands?.every((command) => command.exitCode === 0) ?? true;
    if (
      (evidence.status === "passed" && !allCommandsPassed)
      || (evidence.status === "failed" && allCommandsPassed && evidence.error === undefined)
    ) {
      throw new Error("Activation completion status conflicts with command evidence");
    }

    const before = buildIntegrationOperationView(this.store, context, true);
    const stage = (name: IntegrationStageEvidence["stage"]): IntegrationStageEvidence | undefined =>
      before.stages.find((candidate) => candidate.stage === name);
    if (stage("source-applied")?.status !== "passed") {
      throw new Error("Activation completion requires source-applied evidence");
    }
    if (stage("source-verified")?.status !== "passed") {
      throw new Error("Activation completion requires source-verified evidence");
    }
    const build = stage("artifact-built");
    if (build?.status !== "passed" && build?.status !== "not-applicable") {
      throw new Error("Activation completion requires artifact-built evidence");
    }

    this.store.addEvent(
      taskId,
      undefined,
      "integration.stage.completed",
      `runtime-activated: ${evidence.status}`,
      { operationId, receiptId, evidence },
    );
    const stages = [
      ...before.stages.filter((candidate) => candidate.stage !== "runtime-activated"),
      evidence,
    ];
    const task = this.store.getTask(taskId);
    const verificationCommands = stage("source-verified")?.commands;
    const record: IntegrationResultRecord = {
      id: operationId,
      receiptId,
      taskId,
      status: evidence.status === "passed" ? "applied" : "retained-failure",
      backupDir: path.join(task.paths.root, "integration", receiptId, "backup"),
      stages,
      ...(verificationCommands === undefined ? {} : { verificationCommands }),
      ...(evidence.status === "passed"
        ? { appliedAt: timestamp() }
        : { error: evidence.error ?? "Runtime activation failed; source changes retained" }),
      createdAt: timestamp(),
    };
    this.store.saveIntegrationResult(record);
    this.store.addEvent(
      taskId,
      undefined,
      "integration.apply.completed",
      evidence.status === "passed"
        ? "Integration applied, built, and activated successfully"
        : "Integration source retained after runtime activation failure",
      record,
    );
    return buildIntegrationOperationView(this.store, context, false);
  }

  integrationHistory(
    taskId: string,
  ): { receipts: PreflightReceipt[]; results: IntegrationResultRecord[] } {
    this.store.getTask(taskId);
    const results = this.store.listIntegrationResults(taskId);
    const receiptIds = new Set(results.map((result) => result.receiptId));
    for (const event of this.store.listEvents(taskId)) {
      if (event.type !== "integration.preflight.completed") continue;
      const payload = event.payload as { receiptId?: unknown } | undefined;
      if (typeof payload?.receiptId === "string") receiptIds.add(payload.receiptId);
    }
    const receipts = [...receiptIds]
      .map((receiptId) => this.store.getIntegrationReceipt(receiptId))
      .filter((receipt): receipt is NonNullable<typeof receipt> => receipt !== undefined)
      .map(({ consumed: _, ...receipt }) => receipt);
    return { receipts, results };
  }

  private _probeService: ProviderProbeService | undefined;

  private get probeService(): ProviderProbeService {
    if (!this._probeService) {
      this._probeService = new ProviderProbeService(
        this.store,
        this.settings,
        createClaudeProbeRunner(realExecFile()),
        realKeychainChecker(),
        realKeychainReader,
        realClock,
      );
    }
    return this._probeService;
  }

  private safeVerificationSnapshot(): Record<ProviderName, Omit<ProviderStatus, "keychainExists">> {
    const result = {} as Record<ProviderName, Omit<ProviderStatus, "keychainExists">>;
    for (const name of providerNames()) {
      const { keychainExists: _, ...safe } = this.probeService.getProviderStatus(name);
      result[name] = safe;
    }
    return result;
  }

  /** Return cached provider verification status without triggering any probe. Read-only. */
  providerStatus(name?: string): Record<string, unknown> {
    if (name !== undefined) {
      const status = this.probeService.getProviderStatus(name as ProviderName);
      return { [name]: status };
    }
    const all = this.probeService.getAllProviderStatuses();
    return all as unknown as Record<string, unknown>;
  }

  /** Run an explicit probe for one or all providers. This is a mutating, potentially billable operation. */
  async providerProbe(name?: string): Promise<Record<string, unknown>> {
    if (name !== undefined) {
      const evidence = await this.probeService.probeProvider(name as ProviderName);
      return { [name]: evidence };
    }
    const policy = this.probeService.probePolicy();
    const names = providerNames();
    return probeProvidersBounded(
      names,
      policy,
      (providerName) => this.probeService.probeProvider(providerName),
    );
  }

  async recover(): Promise<string[]> {
    const recovered: string[] = [];
    const stale = this.store.listTasks(["preparing", "running", "verifying"]);
    for (const task of stale) {
      if (task.workerPid !== undefined) await stopOrphanWorker(task.workerPid);
      if (task.currentAttemptId) {
        try {
          const attempt = this.store.getAttempt(task.currentAttemptId);
          if (attempt.status === "running") {
            this.store.updateAttempt(attempt.id, {
              status: "interrupted",
              finishedAt: timestamp(),
              exitCode: 130,
              error: "ForkLight daemon restarted during execution",
            });
          }
        } catch {
          // A preparing task may not have an attempt yet.
        }
      }
      const hasAttempts = this.store.listAttempts(task.id).length > 0;
      this.store.setTaskStatus(task.id, "interrupted", {
        finishedAt: timestamp(),
        workerPid: null,
        error: "ForkLight daemon restarted during execution",
      });
      this.store.addEvent(
        task.id,
        task.currentAttemptId,
        "worker.interrupted",
        "Daemon restart detected; task queued for recovery",
      );
      this.enqueue({ taskId: task.id, resuming: hasAttempts }, true);
      recovered.push(task.id);
    }
    this.reconcilePlans();
    // Reconcile any running competitions whose candidates are now all terminal
    for (const comp of this.store.listCompetitions("running")) {
      new CompetitionCoordinator(this.store, this.settings).reconcile(comp.id);
    }
    this.recoverIntegrationOperations();
    return recovered;
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    for (const taskId of this.active.keys()) {
      const task = this.store.getTask(taskId);
      if (task.workerPid !== undefined && processExists(task.workerPid) && looksLikeWorker(task.workerPid)) {
        process.kill(task.workerPid, "SIGINT");
      }
    }
    await Promise.allSettled(this.active.values());
    await Promise.allSettled(this.activeIntegrations.values());
  }

  private recoverIntegrationOperations(): void {
    for (const task of this.store.listTasks()) {
      const events = this.store.listEvents(task.id);
      for (const event of events) {
        if (
          event.type !== "integration.operation.started"
          || event.payload === null
          || typeof event.payload !== "object"
        ) {
          continue;
        }
        const payload = event.payload as Partial<IntegrationOperationContext>;
        if (
          typeof payload.operationId !== "string"
          || typeof payload.taskId !== "string"
          || typeof payload.receiptId !== "string"
          || payload.taskId !== task.id
        ) {
          continue;
        }
        const context: IntegrationOperationContext = {
          operationId: payload.operationId,
          taskId: payload.taskId,
          receiptId: payload.receiptId,
        };
        this.integrationOperations.set(context.operationId, context);
        if (this.store.getIntegrationResult(context.operationId) !== undefined) continue;
        const alreadyRecovered = events.some((candidate) => {
          if (
            candidate.type !== "integration.operation.recovered"
            || candidate.payload === null
            || typeof candidate.payload !== "object"
          ) {
            return false;
          }
          return (candidate.payload as { operationId?: unknown }).operationId
            === context.operationId;
        });
        if (!alreadyRecovered) {
          this.store.addEvent(
            task.id,
            undefined,
            "integration.operation.recovered",
            "Daemon restart found Integration outcome unknown",
            { ...context, status: "outcome-unknown" },
          );
        }
      }
    }
  }

  queueTask(taskId: string): TaskRecord {
    this.enqueue({ taskId, resuming: false });
    return this.store.getTask(taskId);
  }

  private dependencyDecision(taskId: string):
    | { planId: string; itemId: string; decision: DependencyDecision }
    | undefined {
    const item = this.store.getPlanItemByTaskId(taskId);
    if (!item) return undefined;
    const dependencyIds = this.store.getDirectDependencies(item.planId, item.itemId);
    const statuses = new Map(
      this.store.getPlanItemStatuses(item.planId).map((status) => [status.itemId, status.taskStatus]),
    );
    return {
      ...item,
      decision: resolveReadiness(
        item.itemId,
        dependencyIds,
        new Map(dependencyIds.map((dependencyId) => [dependencyId, statuses.get(dependencyId)])),
      ),
    };
  }

  private persistDependencyDecision(
    taskId: string,
    planId: string,
    itemId: string,
    decision: Exclude<DependencyDecision, { kind: "ready" }>,
  ): void {
    const task = this.store.getTask(taskId);
    const ids = decision.kind === "blocked" ? decision.failedBy : decision.waitingOn;
    const detail = decision.kind === "blocked"
      ? `Blocked by failed prerequisites: ${ids.join(", ")}`
      : `Waiting on prerequisites: ${ids.join(", ")}`;
    if (task.status === decision.kind && task.error === detail) return;
    this.store.setTaskStatus(taskId, decision.kind, { error: detail, finishedAt: null });
    this.store.addEvent(
      taskId,
      task.currentAttemptId,
      decision.kind === "blocked" ? "task.blocked" : "task.waiting",
      detail,
      { planId, itemId, decision },
    );
  }

  private enqueue(job: QueuedJob, bypassDependencies = false): void {
    if (this.closing) throw new Error("ForkLight daemon is shutting down");
    if (this.active.has(job.taskId) || this.queue.some((queued) => queued.taskId === job.taskId)) {
      throw new Error(`Task ${job.taskId} is already queued or running`);
    }
    if (!bypassDependencies) {
      const dependency = this.dependencyDecision(job.taskId);
      if (dependency && dependency.decision.kind !== "ready") {
        this.persistDependencyDecision(
          job.taskId,
          dependency.planId,
          dependency.itemId,
          dependency.decision,
        );
        return;
      }
      const task = this.store.getTask(job.taskId);
      if (task.status === "waiting" || task.status === "blocked") {
        this.store.setTaskStatus(job.taskId, "queued", { error: null, finishedAt: null });
        this.store.addEvent(
          job.taskId,
          task.currentAttemptId,
          "task.ready",
          "All prerequisites succeeded; task queued",
          dependency,
        );
      }
    }
    this.queue.push(job);
    this.pump();
  }

  private reconcilePlans(): void {
    for (const plan of this.store.listPlans()) {
      for (const item of this.store.getPlanItemStatuses(plan.id)) {
        if (!item.taskId) continue;
        if (this.active.has(item.taskId) || this.queue.some((job) => job.taskId === item.taskId)) {
          continue;
        }
        const task = this.store.getTask(item.taskId);
        if (!["queued", "waiting", "blocked"].includes(task.status)) continue;
        this.enqueue({ taskId: item.taskId, resuming: false });
      }
    }
  }

  private reconcileCompetitions(finishedTaskId: string): void {
    const competitionId = this.store.getCompetitionByCandidateTaskId(finishedTaskId);
    if (!competitionId) return;
    const coordinator = new CompetitionCoordinator(this.store, this.settings);
    coordinator.reconcile(competitionId);
  }

  private pump(): void {
    const maxConcurrency = this.maxConcurrencyOverride ?? this.settings.get().execution.maxConcurrency;
    while (!this.closing && this.active.size < maxConcurrency && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) return;
      const settings = this.settings.get();
      const execution = this.execute(job, settings)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          const task = this.store.getTask(job.taskId);
          const recordedError = task.status === "failed" && task.error ? task.error : message;
          this.store.setTaskStatus(job.taskId, "failed", {
            finishedAt: timestamp(),
            workerPid: null,
            error: recordedError,
          });
          this.store.addEvent(
            job.taskId,
            task.currentAttemptId,
            "worker.failed",
            `Daemon execution failed: ${recordedError}`,
          );
        })
        .finally(() => {
          this.active.delete(job.taskId);
          this.reconcilePlans();
          this.reconcileCompetitions(job.taskId);
          this.pump();
        });
      this.active.set(job.taskId, execution);
    }
  }

  private async execute(job: QueuedJob, settings: ForkLightSettings): Promise<void> {
    const exec = settings.execution;
    if (job.revising) {
      // Revise: status already transitioned to queued and revision
      // event recorded before enqueue; executeAttempt starts the new
      // attempt in the existing session and workspace.
      await executeAttempt(
        this.store, this.store.getTask(job.taskId), true, undefined,
        job.feedback, exec, settings.providerDefaults, job.executionOptions,
      );
    } else if (job.resuming) {
      const attemptCount = this.store.listAttempts(job.taskId).length;
      const maximumOrdinal = job.executionOptions?.maximumOrdinal ?? exec.maxAttempts;
      if (attemptCount >= maximumOrdinal) {
        throw new Error(`Task ${job.taskId} has reached maximum attempts (${maximumOrdinal})`);
      }
      await resumeTask(
        this.store,
        job.taskId,
        undefined,
        job.feedback,
        exec,
        settings.providerDefaults,
        job.executionOptions,
      );
    } else {
      let task = this.store.getTask(job.taskId);
      try {
        await assertWorkspaceExists(task.paths);
      } catch {
        task = await prepareTaskWorkspace(this.store, task);
      }
      await executeAttempt(this.store, task, false, undefined, undefined, exec, settings.providerDefaults);
    }
  }
}
