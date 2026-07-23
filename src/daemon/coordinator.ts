import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  CompetitionRecord,
  DependencyRecord,
  IntegrationResultRecord,
  PlanItemRecord,
  PlanRecord,
  ProbeEvidence,
  ProviderStatus,
  StagedTaskRegistration,
  TaskRecord,
  TaskSpec,
  TaskStatus,
} from "../core/types.js";
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
import { providerReadiness } from "../core/providers.js";
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
  type ExecutionSettings,
  type ForkLightSettings,
  type TaskPolicy,
} from "../core/settings.js";
import type { StateStore } from "../state/store.js";
import { assertWorkspaceExists } from "../workspace/copy.js";
import {
  applyIntegration,
  preflightIntegration,
  type IntegrationResult,
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

export interface PlanRegistrationResult {
  planId: string;
  taskIdsByItemId: Record<string, string>;
}

interface QueuedJob {
  taskId: string;
  resuming: boolean;
  revising?: boolean;
  feedback?: string;
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

function timestamp(): string {
  return new Date().toISOString();
}

function taskPolicy(settings: ForkLightSettings): TaskPolicy {
  return {
    contractQuality: settings.contractQuality,
    execution: settings.execution,
    providerDefaults: settings.providerDefaults,
    completionPolicy: settings.completionPolicy,
  };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
    return /(?:claude|sandbox-exec)/i.test(command);
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
    return {
      ok: claudeCode !== "unavailable" && readiness.anyReady,
      pid: process.pid,
      claudeCode,
      providers: readiness.providers,
      providerVerification: verification,
      maxConcurrency: this.maxConcurrencyOverride ?? effectiveSettings.execution.maxConcurrency,
      activeTaskIds: [...this.active.keys()],
      queuedTaskIds: this.queue.map((job) => job.taskId),
      databasePath: this.store.databasePath,
    };
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
      (c) => typeof c.taskStatus === "string"
        && (["succeeded", "failed", "interrupted"] as string[]).includes(c.taskStatus),
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
      // Default: return the stored latest evaluation if it exists
      const evals = this.store.listCompetitionEvaluations(competitionId);
      if (evals.length > 0) return { evaluation: evals[evals.length - 1] };

      // No stored evaluation — compute a pure preview with the immutable creation-time policy
      const policy = competition.rankingPolicy;
      const service = new CompetitionService(this.store);
      return { evaluation: service.previewScore(competitionId, policy) };
    }
    // Override: ephemeral pure preview — never persists
    const effectiveCompetition = this.settings.get().competition;
    const policy = rankingPolicy(override, {
      ...effectiveCompetition,
      rankingWeights: competition.rankingPolicy.weights,
      tieThreshold: competition.rankingPolicy.tieThreshold,
    });
    const service = new CompetitionService(this.store);
    return { evaluation: service.previewScore(competitionId, policy) };
  }

  competitionList(status?: string): Record<string, unknown>[] {
    const records = this.store.listCompetitions(
      status === "pending" || status === "running" || status === "completed" ? status : undefined,
    );
    return records.map((competition) => {
      const candidates = this.store.getCompetitionCandidates(competition.id);
      const terminal = candidates.filter((record) =>
        (["succeeded", "failed", "interrupted"] as string[])
          .includes(this.store.getTask(record.taskId).status));
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

  resume(taskId: string, feedback?: string): TaskRecord {
    const task = this.store.getTask(taskId);
    if (task.status !== "interrupted" && task.status !== "failed") {
      throw new Error(`Task ${taskId} cannot resume from status ${task.status}`);
    }
    const maxAttempts = this.settings.get().execution.maxAttempts;
    const attemptCount = this.store.listAttempts(taskId).length;
    if (attemptCount >= maxAttempts) {
      throw new Error(`Task ${taskId} has reached maximum attempts (${maxAttempts})`);
    }
    this.enqueue({
      taskId,
      resuming: attemptCount > 0,
      ...(feedback === undefined ? {} : { feedback }),
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
  revise(taskId: string, feedback: string): TaskRecord {
    const maxAttempts = this.settings.get().execution.maxAttempts;
    const check = checkReviseEligibility(this.store, taskId, feedback, maxAttempts);
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
    const queued = prepareReviseTask(this.store, taskId);
    this.enqueue({
      taskId,
      resuming: true,
      revising: true,
      // canonicalFeedback is defined when eligible: true (proven above);
      // the exact trimmed value is what the Worker receives.
      feedback: check.canonicalFeedback!,
    }, true);
    return queued;
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
    return {
      task,
      attempts: this.store.listAttempts(taskId),
      events: this.store.listEvents(taskId),
      diff,
    };
  }

  async integrationPreflight(taskId: string): Promise<PreflightReceipt> {
    return preflightIntegration(this.store, taskId, this.settings.get().integration);
  }

  async integrationApply(taskId: string, receiptId: string): Promise<IntegrationResult> {
    return applyIntegration(this.store, taskId, receiptId, this.settings.get().integration);
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
        job.feedback, exec, settings.providerDefaults,
      );
    } else if (job.resuming) {
      const attemptCount = this.store.listAttempts(job.taskId).length;
      if (attemptCount >= exec.maxAttempts) {
        throw new Error(`Task ${job.taskId} has reached maximum attempts (${exec.maxAttempts})`);
      }
      await resumeTask(this.store, job.taskId, undefined, job.feedback, exec, settings.providerDefaults);
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
