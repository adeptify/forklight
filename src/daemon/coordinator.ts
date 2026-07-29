import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AdaptationPreview,
  AdaptationProposedReasonCategory,
  AdaptationTransitionRecord,
  CompetitionRecord,
  AttemptAuthorization,
  AttemptExecutionOptions,
  CheckpointReport,
  CheckpointRequest,
  DependencyRecord,
  EffectivePolicySnapshot,
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
import {
  authorizeExtraAttempt,
  authorizeMainCorrection,
  resolvePendingCorrectionGrant,
  resolvePendingGrantExecutionOptions,
  type MainCorrectionAuthorization,
} from "../core/attempt-authorization.js";
import { latestMainReview, recordMainReview } from "../core/main-review.js";
import type { ProviderAuthInspector, ProviderName } from "../core/providers.js";
import { providerNames, realProviderAuthInspector } from "../core/providers.js";
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
  correctTask,
  describeReviseRejection,
  executeAttempt,
  prepareMainCorrectionTask,
  prepareReviseTask,
  prepareTaskWorkspace,
  preflightTaskLaunchAuthentication,
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
  provideRoutingAdvice,
  type RoutingAdvisoryResponse,
  type RoutingPolicySettings,
} from "../core/model-routing.js";
import {
  SettingsService,
  type ForkLightSettings,
  type TaskPolicy,
} from "../core/settings.js";
import type { StateStore } from "../state/store.js";
import { clearTaskPreparationArtifacts, isWorkspaceReady } from "../workspace/copy.js";
import {
  applyIntegration,
  preflightIntegration,
  type PreflightReceipt,
} from "../core/integration.js";
import { getTaskEconomicsReport, type TaskEconomicsReport } from "../core/task-economics-report.js";
import { getPortfolioEconomicsSummary, type PortfolioEconomicsSummary } from "../core/portfolio-economics.js";
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
import { guidedDirectCodexCapture } from "../core/direct-codex-guided-capture-service.js";
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
import { resolveTaskEffectivePolicy } from "../core/advanced-policy.js";
import {
  buildTaskAdmissionPreview,
  enforcementCapabilityForTaskRuntime,
  prepareTaskAdmission,
  taskPolicyFromSettings,
  PREVIEW_REVISION_DIGEST_PATTERN,
  type SafeTaskAdmissionPreview,
} from "../core/task-preview.js";
import {
  deriveChildEffectivePolicy,
  evaluateAdaptationGate,
  type AdaptationEligibleContext,
  type AdaptationGateDecision,
  type AdaptationLineageEdgeProjection,
  type AdaptationParentProjection,
} from "../core/adaptation.js";
import {
  verifyMainRemediation,
  projectRemediationVerifyResult,
  type RemediationVerifyView,
} from "../core/main-remediation.js";
import {
  reverifyCandidate,
  resolveCandidateReverificationEligibility,
  projectCandidateReverificationResult,
  type CandidateReverificationView,
  type CandidateReverificationEligibility,
} from "../core/candidate-reverification.js";
import { maxMainReverificationsFromSnapshot } from "../core/advanced-policy.js";
import {
  resolveCorrectionEligibility,
  resolveLatestRevision,
  describeCorrectionRejection,
  validateStructuredCorrectionInput,
} from "../core/candidate-revision.js";
import type { CorrectionEligibility } from "../core/types.js";

export interface PlanRegistrationResult {
  planId: string;
  taskIdsByItemId: Record<string, string>;
}

/**
 * One bounded stale-preview reason shared by the daemon and Hub. A bound
 * submit_file fails closed with exactly this message when the supplied preview
 * revision is missing, malformed, or no longer matches the current file bytes
 * and effective admission settings. The Hub maps it to a "preview again"
 * instruction without echoing any other daemon text.
 */
export const STALE_PREVIEW_REASON = "Task preview is out of date; preview again before submitting.";

interface QueuedJob {
  taskId: string;
  resuming: boolean;
  revising?: boolean;
  correcting?: boolean;
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
  return taskPolicyFromSettings(settings);
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
  private readonly authorizedHandoffShutdowns = new Set<string>();
  private closing = false;

  constructor(
    private readonly store: StateStore,
    private readonly settings: SettingsService,
    private readonly maxConcurrencyOverride?: number,
    private readonly providerAuthInspector: ProviderAuthInspector = realProviderAuthInspector(),
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

  /** Resolve the effective advanced policy for a newly created Task.
   *  Uses the exact selected workerProfileId from the spec; never guesses by runtime. */
  private resolveEffectivePolicy(spec: TaskSpec): EffectivePolicySnapshot | undefined {
    const settings = this.settings.get();
    const capabilities = enforcementCapabilityForTaskRuntime(spec.runtime.name);
    return resolveTaskEffectivePolicy(spec, settings, capabilities);
  }

  /**
   * Read-only Task Contract admission preview under current saved settings.
   * Never registers, queues, prepares, verifies, integrates, or probes.
   */
  async validateFile(taskFile: string): Promise<SafeTaskAdmissionPreview> {
    if (!path.isAbsolute(taskFile)) {
      throw new Error("validate_file requires an absolute Task Contract file path");
    }
    return buildTaskAdmissionPreview(taskFile, this.settings.get());
  }

  /**
   * Submit a Task Contract file. When expectedPreviewRevisionDigest is
   * supplied, the canonical admission is prepared once from the current file
   * bytes and settings snapshot, the digest is recomputed from that same
   * prepared admission, and any missing/malformed/different value fails closed
   * with the bounded stale-preview reason BEFORE any Task, event, workspace, or
   * queue mutation. Callers that omit the value keep the existing
   * non-interactive behavior.
   */
  async submitFile(
    taskFile: string,
    expectedPreviewRevisionDigest?: unknown,
  ): Promise<TaskRecord> {
    const settings = this.settings.get();
    const prepared = await prepareTaskAdmission(taskFile, settings);
    if (expectedPreviewRevisionDigest !== undefined) {
      if (
        typeof expectedPreviewRevisionDigest !== "string"
        || !PREVIEW_REVISION_DIGEST_PATTERN.test(expectedPreviewRevisionDigest)
      ) {
        throw new Error(STALE_PREVIEW_REASON);
      }
      if (prepared.previewRevisionDigest !== expectedPreviewRevisionDigest) {
        throw new Error(STALE_PREVIEW_REASON);
      }
    }
    const task = registerTaskFromSpec(
      this.store,
      prepared.spec,
      prepared.taskFile,
      prepared.effectivePolicy,
    );
    this.queueTask(task.id);
    return this.store.getTask(task.id);
  }

  async submit(rawTask: unknown, baseDirectory: string): Promise<TaskRecord> {
    const settings = this.settings.get();
    const spec = parseTaskSpec(rawTask, baseDirectory, taskPolicy(settings));
    const effectivePolicy = this.resolveEffectivePolicy(spec);
    const task = registerTaskFromSpec(this.store, spec, "forklight://mcp/inline-task", effectivePolicy);
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
      const effectivePolicy = this.resolveEffectivePolicy(item.task);
      taskIdsByItemId[item.id] = taskId;
      registrations.push({
        task: buildTaskRecord({
          spec: item.task,
          taskFile: item.taskFile,
          home,
          id: taskId,
          sessionId: randomUUID(),
          createdAt,
          ...(effectivePolicy === undefined ? {} : { effectivePolicy }),
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
    const execution = this.settings.get().execution;
    const maxAttempts = task.effectivePolicy?.values.baseMaxAttempts ?? execution.maxAttempts;
    const maxExtraAttempts = task.effectivePolicy?.values.maxExtraAttempts ?? execution.maxExtraAttempts;
    const attemptCount = this.store.listAttempts(taskId).length;
    // Resolve pending grant read-only first — may fail-closed on corrupt
    const pendingGrant = resolvePendingGrantExecutionOptions(
      this.store, taskId, maxAttempts, maxExtraAttempts,
    );
    if (attemptCount >= maxAttempts && authorization === undefined && !pendingGrant) {
      throw new Error(`Task ${taskId} has reached maximum attempts (${maxAttempts})`);
    }
    // Verify queue admission BEFORE creating any durable grant event
    if (this.closing) throw new Error("ForkLight daemon is shutting down");
    if (this.active.has(taskId) || this.queue.some((job) => job.taskId === taskId)) {
      throw new Error(`Task ${taskId} is already queued or running`);
    }
    let executionOptions: AttemptExecutionOptions | undefined;
    if (authorization !== undefined) {
      executionOptions = authorizeExtraAttempt(
        this.store, taskId, authorization, maxAttempts,
        execution.maximumBudgetUsd, maxExtraAttempts,
      );
    } else if (pendingGrant) {
      executionOptions = pendingGrant;
    }
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
    const task = this.store.getTask(taskId);
    const execution = this.settings.get().execution;
    const maxAttempts = task.effectivePolicy?.values.baseMaxAttempts ?? execution.maxAttempts;
    const maxExtraAttempts = task.effectivePolicy?.values.maxExtraAttempts ?? execution.maxExtraAttempts;
    // Always resolve pending grant first — may fail-closed on corrupt
    const pendingGrant = resolvePendingGrantExecutionOptions(
      this.store, taskId, maxAttempts, maxExtraAttempts,
    );
    const effectiveLimit = pendingGrant
      ? pendingGrant.maximumOrdinal
      : (authorization !== undefined ? maxAttempts + maxExtraAttempts : maxAttempts);
    const check = checkReviseEligibility(
      this.store,
      taskId,
      feedback,
      effectiveLimit,
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
    let executionOptions: AttemptExecutionOptions | undefined;
    if (authorization !== undefined) {
      executionOptions = authorizeExtraAttempt(
        this.store,
        taskId,
        authorization,
        maxAttempts,
        execution.maximumBudgetUsd,
        maxExtraAttempts,
      );
    } else if (pendingGrant) {
      executionOptions = pendingGrant;
    }
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

  /** Authorize one explicit Main correction for a failed or interrupted Task.
   *  Reuses the same id, workspace, baseline, logs, and runtime session.
   *  Limited by the Task's frozen maxMainCorrections, independent from maxExtraAttempts.
   *  Records a correction grant, then enqueues a resume job with the canonical feedback.
   *
   *  When structured gap contract fields (reusablePaths, remainingGaps) are supplied,
   *  the correction is bound to the latest CandidateRevision and the contract is
   *  validated before any durable grant or queue mutation. */
  correct(
    taskId: string,
    feedback: string,
    maxBudgetUsd: number | null,
    confirm: boolean,
    candidateRevisionId?: unknown,
    reusablePaths?: unknown,
    remainingGaps?: unknown,
  ): TaskRecord {
    if (confirm !== true) throw new Error("Main correction requires confirm: true");
    const task = this.store.getTask(taskId);
    // Succeeded is allowed only when the latest Main Review is revise (validated
    // downstream by authorizeMainCorrection and resolveCorrectionEligibility).
    if (task.status !== "failed" && task.status !== "interrupted" && task.status !== "succeeded") {
      throw new Error(`Task ${taskId} cannot be corrected from status ${task.status}`);
    }
    const execution = this.settings.get().execution;
    const baseMaxAttempts = task.effectivePolicy?.values.baseMaxAttempts ?? execution.maxAttempts;
    const maxMainCorrections = task.effectivePolicy?.values.maxMainCorrections ?? 1;

    const trimmed = feedback.trim();
    if (trimmed.length === 0 || trimmed.length > 1000) {
      throw new Error("correction feedback must be 1-1000 characters");
    }

    // Verify queue admission before creating any durable grant event.
    if (this.closing) throw new Error("ForkLight daemon is shutting down");
    if (this.active.has(taskId) || this.queue.some((job) => job.taskId === taskId)) {
      throw new Error(`Task ${taskId} is already queued or running`);
    }

    const latestRevision = resolveLatestRevision(this.store.listEvents(taskId));
    const structuredRequested = candidateRevisionId !== undefined
      || reusablePaths !== undefined
      || remainingGaps !== undefined;
    let gapContract: ReturnType<typeof validateStructuredCorrectionInput>["contract"] | undefined;

    if (structuredRequested) {
      const eligibility = resolveCorrectionEligibility(this.store, taskId);
      if (!eligibility.eligible) {
        throw new Error(describeCorrectionRejection(eligibility.category));
      }
      if (eligibility.latestRevision === undefined) {
        throw new Error(describeCorrectionRejection("no-revision"));
      }
      if (latestRevision === undefined || latestRevision.id !== eligibility.latestRevision.id) {
        throw new Error(describeCorrectionRejection("no-revision"));
      }
      if (typeof candidateRevisionId !== "string") {
        throw new Error("structured correction requires candidateRevisionId");
      }
      if (!Array.isArray(reusablePaths) || !Array.isArray(remainingGaps)) {
        throw new Error("structured correction requires reusablePaths and remainingGaps arrays");
      }
      const result = validateStructuredCorrectionInput({
        feedback: trimmed,
        maxBudgetUsd,
        candidateRevisionId,
        reusablePaths,
        remainingGaps,
        confirm: true,
      }, latestRevision);
      gapContract = result.contract;
    } else if (latestRevision !== undefined) {
      throw new Error(
        "correction for a revisioned Task requires candidateRevisionId, reusablePaths, and remainingGaps",
      );
    }

    const authorization: MainCorrectionAuthorization = {
      feedback: trimmed,
      maxBudgetUsd,
      confirm: true,
      ...(gapContract === undefined ? {} : { gapContract }),
    };

    // Calling the authorizer even when a grant is pending makes replay
    // idempotent only when feedback, budget, revision and contract match.
    authorizeMainCorrection(
      this.store,
      taskId,
      authorization,
      baseMaxAttempts,
      maxMainCorrections,
      execution.maximumBudgetUsd,
    );

    const queued = prepareMainCorrectionTask(this.store, taskId);
    this.enqueue({
      taskId,
      resuming: true,
      correcting: true,
    });
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

  directCodexGuidedCapture(forklightTaskId: unknown, codexRunRef: unknown, usage: unknown): DirectCodexPairedSample {
    return guidedDirectCodexCapture(this.store, forklightTaskId, codexRunRef, usage);
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
   * Also surfaces the latest preparation stage so list/status can explain
   * what is happening while a Task is preparing.
   */
  listTaskSurfaces(statuses?: TaskStatus[], limit = 20): SafeTaskSummary[] {
    const nowMs = Date.now();
    return this.list(statuses, limit).map((task) => {
      const events = this.store.listEvents(task.id);
      const latestEvent = toLatestEventMeta(this.store.latestEventMeta(task.id));
      const failureCategory = failureCategoryForTask(
        task.status,
        events,
      );
      const remediationDisposition = this.store.getRemediationDisposition(task.id);
      const decisionStage = buildTaskDecisionView({
        task,
        attempts: this.store.listAttempts(task.id),
        events,
        integrationResults: this.store.listIntegrationResults(task.id),
        ...(remediationDisposition === undefined ? {} : { remediationDisposition }),
        nowMs,
      }).stage;
      const preparationStage = task.status === "preparing"
        ? this.store.latestPreparationStageMeta(task.id)
        : undefined;
      return projectTaskSurface(task, {
        ...(latestEvent === undefined ? {} : { latestEvent }),
        ...(failureCategory === undefined ? {} : { failureCategory }),
        ...(remediationDisposition === undefined ? {} : { remediationDisposition }),
        decisionStage,
        ...(preparationStage === undefined ? {} : { preparationStage }),
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

  /** Read-only evidence-aware model-routing advisory.  Derives routing
   *  evidence from terminal Tasks matching the exact taskClass, resolves
   *  the current flexible routing policy, and returns a privacy-safe
   *  advisory with per-candidate factors, uncertainty flags, competition
   *  guidance, and an optional recommendation.  Never launches work,
   *  switches a Worker, disables a model, mutates settings, retries,
   *  commits, or pushes. */
  modelRouting(
    taskClass: string,
    candidates: Array<{ provider: string; model: string }>,
  ): RoutingAdvisoryResponse {
    if (
      typeof taskClass !== "string"
      || taskClass.trim().length === 0
      || taskClass.trim().length > 200
    ) {
      throw new Error("modelRouting requires a taskClass of 1 to 200 characters");
    }
    if (!Array.isArray(candidates) || candidates.length < 2 || candidates.length > 10) {
      throw new Error("modelRouting requires 2 to 10 provider/model candidates");
    }
    const seen = new Set<string>();
    for (const c of candidates) {
      if (
        typeof c.provider !== "string"
        || c.provider.trim().length === 0
        || c.provider.trim().length > 100
      ) {
        throw new Error("Each candidate provider must contain 1 to 100 characters");
      }
      if (
        typeof c.model !== "string"
        || c.model.trim().length === 0
        || c.model.trim().length > 200
      ) {
        throw new Error("Each candidate model must contain 1 to 200 characters");
      }
      const key = c.provider.trim() + "\0" + c.model.trim();
      if (seen.has(key)) throw new Error("modelRouting candidates must be unique");
      seen.add(key);
    }

    const stats = new StatisticsService(this.store);
    const evidenceMap = stats.routingEvidence(taskClass.trim());
    const settings = this.settings.get();
    const policy: RoutingPolicySettings = {
      minRelevantSamples: settings.modelRouting.minRelevantSamples,
      uncertaintyThreshold: settings.modelRouting.uncertaintyThreshold,
      competitionOnUncertainty: settings.modelRouting.competitionOnUncertainty,
      missingEvidenceMode: settings.modelRouting.missingEvidenceMode,
      weights: {
        acceptedDelivery: settings.modelRouting.weights.acceptedDelivery,
        verifiedBehavior: settings.modelRouting.weights.verifiedBehavior,
        modelQualityFailure: settings.modelRouting.weights.modelQualityFailure,
        correctionChurn: settings.modelRouting.weights.correctionChurn,
        officialCost: settings.modelRouting.weights.officialCost,
        duration: settings.modelRouting.weights.duration,
        budgetReliability: settings.modelRouting.weights.budgetReliability ?? 0,
      },
    };

    return provideRoutingAdvice({
      taskClass: taskClass.trim(),
      candidates: candidates.map((c) => ({
        provider: c.provider.trim(),
        model: c.model.trim(),
      })),
      evidenceMap,
      policy,
    });
  }

  /** Return a detached deeply-frozen portfolio economics summary for all
   *  terminal Tasks matching the optional provider/model/time filter.
   *  Never reads legacy costUsd, never combines currencies, never calls
   *  a Provider, and never mutates state. */
  economicsSummary(filter: StatisticsFilter = {}): PortfolioEconomicsSummary {
    return getPortfolioEconomicsSummary(this.store, filter);
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
    const remediationDisposition = this.store.getRemediationDisposition(taskId);
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
        ...(remediationDisposition === undefined ? {} : { remediationDisposition }),
      }),
      diff,
    };
  }

  taskDecision(taskId: string): import("../core/types.js").TaskDecisionView {
    const task = this.store.getTask(taskId);
    const remediationDisposition = this.store.getRemediationDisposition(taskId);
    return buildTaskDecisionView({
      task,
      attempts: this.store.listAttempts(taskId),
      events: this.store.listEvents(taskId),
      integrationResults: this.store.listIntegrationResults(taskId),
      ...(remediationDisposition === undefined ? {} : { remediationDisposition }),
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

  /** Server-validated, operation-bound, one-use activation shutdown
   *  authorization.  The daemon verifies that the operation exists and is
   *  still activation-pending (no stored result) before acknowledging.
   *  Replay or mismatch fails with a fixed privacy-safe error.
   *
   *  Authorization is durable: an event is persisted before the ack so
   *  recovery after daemon restart can reconstruct the authorized set and
   *  reject replays.  After successful authorization the old daemon
   *  schedules its own shutdown.  This method never calls any live model
   *  or provider. */
  authorizeActivationHandoffShutdown(
    operationId: string,
    taskId: string,
    receiptId: string,
  ): { stopping: true; handoffAuthorized: true; targetPid: number } {
    const context = this.integrationOperations.get(operationId);
    if (context === undefined) {
      throw new Error("Unknown Integration operation; activation handoff shutdown rejected");
    }
    if (context.taskId !== taskId || context.receiptId !== receiptId) {
      throw new Error("Activation handoff shutdown does not match the Integration operation");
    }
    if (this.authorizedHandoffShutdowns.has(operationId)) {
      throw new Error("Activation handoff shutdown already authorized for this operation");
    }
    if (this.store.getIntegrationResult(operationId) !== undefined) {
      throw new Error("Integration activation is already complete; activation handoff shutdown rejected");
    }
    this.store.addEvent(
      taskId,
      undefined,
      "integration.handoff.authorized",
      "Activation handoff shutdown authorized",
      { operationId, taskId, receiptId, targetPid: process.pid },
    );
    this.authorizedHandoffShutdowns.add(operationId);
    setImmediate(() => process.kill(process.pid, "SIGTERM"));
    return { stopping: true, handoffAuthorized: true, targetPid: process.pid };
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
      if (task.status === "preparing") {
        if (this.active.has(task.id) || this.queue.some((job) => job.taskId === task.id)) {
          recovered.push(task.id);
          continue;
        }
        this.store.addEvent(
          task.id,
          undefined,
          "workspace.preparation.stage",
          "Preparation recovery started",
          { stage: "init", phase: "start", elapsedMs: 0 },
        );
        try {
          await clearTaskPreparationArtifacts(task.paths);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.store.setTaskStatus(task.id, "failed", {
            finishedAt: timestamp(),
            workerPid: null,
            error: `Workspace preparation failed: recovery cleanup: ${message}`,
          });
          recovered.push(task.id);
          continue;
        }
        this.store.setTaskStatus(task.id, "preparing", {
          finishedAt: null,
          workerPid: null,
          error: null,
        });
        this.enqueue({ taskId: task.id, resuming: false }, true);
        recovered.push(task.id);
        continue;
      }

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
    // A Main correction grant is durable before its in-memory queue entry.
    // Recover failed/interrupted tasks from the narrow post-grant crash window,
    // and recover already-queued corrections without inventing new feedback.
    for (const task of this.store.listTasks(["failed", "interrupted", "queued"])) {
      if (this.active.has(task.id) || this.queue.some((job) => job.taskId === task.id)) continue;
      const exec = this.settings.get().execution;
      const baseMaxAttempts = task.effectivePolicy?.values.baseMaxAttempts ?? exec.maxAttempts;
      let pending: ReturnType<typeof resolvePendingCorrectionGrant>;
      try {
        pending = resolvePendingCorrectionGrant(this.store, task.id, baseMaxAttempts);
      } catch {
        // Corrupt authorization evidence remains fail-closed and inspectable;
        // it must not prevent unrelated Tasks from recovering.
        continue;
      }
      if (pending === null) continue;
      if (task.status !== "queued") prepareMainCorrectionTask(this.store, task.id);
      this.enqueue({ taskId: task.id, resuming: true, correcting: true });
      recovered.push(task.id);
    }
    // An adaptation transition commits its lineage edge and queued child in
    // one transaction before the in-memory enqueue. A crash in that narrow
    // window must not strand the durable successor.
    for (const task of this.store.listTasks(["queued"])) {
      if (this.store.getAdaptationLineageEdgeForChild(task.id) === undefined) continue;
      if (this.active.has(task.id) || this.queue.some((job) => job.taskId === task.id)) continue;
      this.enqueue({ taskId: task.id, resuming: false }, true);
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
      // Reconstruct durable handoff authorization state.
      for (const event of events) {
        if (
          event.type !== "integration.handoff.authorized"
          || event.payload === null
          || typeof event.payload !== "object"
        ) {
          continue;
        }
        const payload = event.payload as { operationId?: unknown };
        if (typeof payload.operationId === "string") {
          this.authorizedHandoffShutdowns.add(payload.operationId);
        }
      }
    }
  }

  queueTask(taskId: string): TaskRecord {
    this.enqueue({ taskId, resuming: false });
    return this.store.getTask(taskId);
  }

  // --- Bounded policy adaptation ---

  /** Bounded set of caller-supplied reason categories. */
  private static readonly ADAPTATION_PROPOSED_REASONS: ReadonlySet<string> = new Set<string>([
    "duration-budget",
    "size-policy",
    "attempt-budget",
    "completion-policy",
    "concurrency-cap",
    "no-progress-timeout",
    "other-flexible-policy",
  ]);

  private normalizeAdaptationProposedReason(reason: unknown): AdaptationProposedReasonCategory {
    if (typeof reason !== "string" || !DaemonCoordinator.ADAPTATION_PROPOSED_REASONS.has(reason)) {
      throw new Error("adaptation reason must be a bounded reason category");
    }
    return reason as AdaptationProposedReasonCategory;
  }

  /** Build a deterministic parent projection and root snapshot for the gate.
   *  All lineage edges under the rootTaskId are passed in for next-round
   *  computation and idempotency checks. The root's immutable effective
   *  policy is required; if it is missing the gate returns a stopped decision
   *  without reading live settings. */
  private projectionForAdaptation(taskId: string): {
    parent: AdaptationParentProjection;
    rootTaskId: string;
    rootEffectivePolicy: EffectivePolicySnapshot | undefined;
    existingLineage: readonly AdaptationLineageEdgeProjection[];
  } {
    const parentRecord = this.store.getTask(taskId);
    const rootEdge = this.store.getAdaptationLineageEdgeForChild(taskId);
    let rootTaskId: string | undefined;
    let rootEffectivePolicy: EffectivePolicySnapshot | undefined;
    if (rootEdge !== undefined) {
      rootTaskId = rootEdge.rootTaskId;
      try {
        const rootRecord = this.store.getTask(rootEdge.rootTaskId);
        rootEffectivePolicy = rootRecord.effectivePolicy;
      } catch {
        rootEffectivePolicy = undefined;
      }
    } else {
      rootTaskId = taskId;
      rootEffectivePolicy = parentRecord.effectivePolicy;
    }
    const lineage = rootTaskId === undefined
      ? []
      : this.store.listAdaptationLineageForRoot(rootTaskId).map((edge): AdaptationLineageEdgeProjection => ({
        rootTaskId: edge.rootTaskId,
        parentTaskId: edge.parentTaskId,
        childTaskId: edge.childTaskId,
        round: edge.round,
      }));
    const failureCategory = failureCategoryForTask(
      parentRecord.status,
      this.store.listEvents(taskId),
    );
    return {
      parent: {
        id: parentRecord.id,
        status: parentRecord.status,
        effectivePolicy: parentRecord.effectivePolicy,
        ...(failureCategory === undefined ? {} : { failureCategory }),
      },
      rootTaskId,
      rootEffectivePolicy,
      existingLineage: lineage,
    };
  }

  /** Run the eligibility gate against the supplied patch. Always returns
   *  the canonical preview object; never throws on gate-level rejection. */
  private runAdaptationGate(taskId: string, rawPatch: unknown): {
    preview: AdaptationPreview;
    decision: AdaptationGateDecision;
  } {
    const projection = this.projectionForAdaptation(taskId);
    if (projection.rootEffectivePolicy === undefined) {
      const preview: AdaptationPreview = {
        status: "stopped",
        rootTaskId: projection.rootTaskId ?? "",
        parentTaskId: taskId,
        nextRound: 0,
        maxAdaptationRounds: 0,
        profileId: "",
        reason: "missing-effective-policy",
        stoppedReason: "missing-effective-policy",
        fields: [],
        summary: "Adaptation stopped: Task lacks an immutable effective policy snapshot.",
      };
      return {
        preview,
        decision: { kind: "stopped", preview },
      };
    }
    const decision = evaluateAdaptationGate({
      parent: projection.parent,
      rootEffectivePolicy: projection.rootEffectivePolicy,
      existingLineage: projection.existingLineage,
      rawPatch,
    });
    return {
      preview: decision.preview,
      decision,
    };
  }

  /** Read-only adaptation preview. Returns the gate preview. */
  adaptationPreview(params: {
    taskId: string;
    patch: unknown;
    reason?: unknown;
  }): AdaptationPreview {
    const reason = this.normalizeAdaptationProposedReason(params.reason ?? "other-flexible-policy");
    void reason; // persisted only by apply
    return this.runAdaptationGate(params.taskId, params.patch).preview;
  }

  /** Confirmed, transactional adaptation apply. Returns either the persisted
   *  successor summary (eligible path) or the same stopped preview object
   *  (idempotent rejection path). The state machine never recurses on the
   *  successor and may not call a model. */
  adaptationApply(params: {
    taskId: string;
    patch: unknown;
    reason?: unknown;
    confirm: true;
  }): {
    status: "eligible" | "stopped";
    preview: AdaptationPreview;
    childTaskId?: string;
    lineageId?: string;
  } {
    const proposedReason = this.normalizeAdaptationProposedReason(
      params.reason ?? "other-flexible-policy",
    );
    if (this.closing) throw new Error("ForkLight daemon is shutting down");

    const gate = this.runAdaptationGate(params.taskId, params.patch);
    if (gate.decision.kind !== "eligible") {
      this.store.recordAdaptationRejection(
        params.taskId,
        "Adaptation apply rejected",
        {
          preview: gate.preview,
          proposedReason,
        },
      );
      return { status: "stopped", preview: gate.preview };
    }
    const result = this.commitAdaptationTransition(
      gate.decision.context,
      proposedReason,
      gate.preview,
    );
    if (result.status === "eligible") {
      try {
        this.enqueue({ taskId: result.childTaskId, resuming: false });
      } catch {
        this.store.addEvent(
          result.childTaskId,
          undefined,
          "task.ready",
          "Adapted Task persisted and will be recovered from the durable queue",
        );
      }
    }
    return result;
  }

  // --- Main remediation verification ---

  async remediationVerify(
    taskId: string,
    reason: string,
    confirm: true,
  ): Promise<RemediationVerifyView> {
    const verificationTimeoutMs = this.settings.get().integration.verificationTimeoutMs;
    const result = await verifyMainRemediation(
      this.store,
      { taskId, reason, confirm },
      verificationTimeoutMs,
    );
    const task = this.store.getTask(taskId);
    return projectRemediationVerifyResult(result, task.status);
  }

  // --- Candidate reverification (verification-only, no Worker, no Attempt) ---

  /** Read-only correction eligibility shared by daemon, MCP, and Hub.
   *  Never runs commands, never mutates state, never exposes private content. */
  correctionEligibility(taskId: string): CorrectionEligibility {
    this.store.getTask(taskId); // validate task exists
    return resolveCorrectionEligibility(this.store, taskId);
  }

  /** Read-only eligibility for the Task Detail three-way choice. Never runs
   *  commands, never mutates state, never echoes private candidate content. */
  candidateReverificationEligibility(taskId: string): CandidateReverificationEligibility {
    const task = this.store.getTask(taskId);
    const maxMainReverifications = maxMainReverificationsFromSnapshot(task.effectivePolicy);
    return resolveCandidateReverificationEligibility(
      this.store,
      taskId,
      maxMainReverifications,
    );
  }

  /** Authorize and execute one bounded candidate reverification. The Task stays
   *  "failed" throughout verification (never enters a crash-recoverable Worker
   *  state); on pass only the Task status moves to "succeeded" and the failed
   *  Attempt is preserved. Requires no running/queued Worker job. */
  async reverifyCandidate(
    taskId: string,
    reason: string,
    confirm: true,
  ): Promise<CandidateReverificationView> {
    if (confirm !== true) throw new Error("candidate reverification requires confirm: true");
    // Verify queue admission before recording any durable authorization - a
    // running or queued Worker job must finish first.
    if (this.closing) throw new Error("ForkLight daemon is shutting down");
    if (this.active.has(taskId) || this.queue.some((job) => job.taskId === taskId)) {
      throw new Error(`Task ${taskId} is already queued or running`);
    }
    const settings = this.settings.get();
    const verificationTimeoutMs = settings.integration.verificationTimeoutMs;
    const task = this.store.getTask(taskId);
    const maxMainReverifications = maxMainReverificationsFromSnapshot(task.effectivePolicy);
    const result = await reverifyCandidate(
      this.store,
      { taskId, reason, confirm },
      maxMainReverifications,
      verificationTimeoutMs,
    );
    const finalTask = this.store.getTask(taskId);
    // A successful reverification changes a failed plan prerequisite to
    // succeeded without going through the normal Worker completion path.
    // Reconcile immediately so waiting/blocked dependents are not stranded
    // until an unrelated event or daemon restart happens to wake them.
    if (finalTask.status === "succeeded") this.reconcilePlans();
    return projectCandidateReverificationResult(result, finalTask.status);
  }

  private commitAdaptationTransition(
    context: AdaptationEligibleContext,
    proposedReason: AdaptationProposedReasonCategory,
    eligiblePreview: AdaptationPreview,
  ): {
    status: "eligible";
    preview: AdaptationPreview;
    childTaskId: string;
    lineageId: string;
  } | {
    status: "stopped";
    preview: AdaptationPreview;
  } {
    const parent = context.parent;
    const parentRecord = this.store.getTask(parent.id);
    const childId = randomUUID();
    const childSessionId = randomUUID();
    const createdAt = timestamp();

    // Resolve the lineage root task id before constructing the child spec.
    const parentEdge = this.store.getAdaptationLineageEdgeForChild(parent.id);
    const resolvedRootTaskId = parentEdge?.rootTaskId ?? parent.id;

    // Layer the validated patch onto the parent's spec so the contract
    // remains identical except for advanced policy.
    const validatedPatch = context.patch;
    const composedOverride: Record<string, unknown> = {
      ...(parentRecord.spec.advancedPolicyOverride ?? {}),
    };
    for (const [field, value] of Object.entries(validatedPatch)) {
      if (field === "maxAdaptationRounds") continue; // defense in depth
      composedOverride[field] = value;
    }
    const childSpec: TaskSpec = {
      ...parentRecord.spec,
      advancedPolicyOverride: composedOverride,
    };
    const childEffectivePolicy = deriveChildEffectivePolicy(
      parent.effectivePolicy!,
      context.patch,
    );
    const childRecord = buildTaskRecord({
      spec: childSpec,
      taskFile: parentRecord.taskFile,
      home: path.dirname(this.store.databasePath),
      id: childId,
      sessionId: childSessionId,
      createdAt,
      effectivePolicy: childEffectivePolicy,
    });

    const lineageId = randomUUID();
    const lineageRecord: AdaptationTransitionRecord = {
      id: lineageId,
      rootTaskId: resolvedRootTaskId,
      parentTaskId: parent.id,
      childTaskId: childId,
      round: context.nextRound,
      reason: "eligible",
      proposedReason,
      createdAt,
    };

    try {
      this.store.createAdaptationTransition({
        record: lineageRecord,
        task: childRecord,
        creationEvent: {
          summary: `Task created (adapted round ${context.nextRound}): ${childRecord.name}`,
          payload: {
            parentTaskId: parent.id,
            rootTaskId: resolvedRootTaskId,
            round: context.nextRound,
            proposedReason,
          },
        },
        transitionEvent: {
          summary: `Adaptation transition: round ${context.nextRound} from parent ${parent.id}`,
          payload: {
            rootTaskId: resolvedRootTaskId,
            parentTaskId: parent.id,
            childTaskId: childId,
            round: context.nextRound,
            proposedReason,
          },
        },
      });
    } catch (error) {
      // The gate enforces one-successor-per-parent at read time, but a
      // concurrent apply before commit could race. Always translate the
      // UNIQUE failure into a stable stopped preview without ever leaking
      // the original error. The transaction rolled back, so no Task was
      // persisted.
      const message = error instanceof Error ? error.message : String(error);
      if (!/UNIQUE constraint failed/i.test(message)) throw error;
      const preview: AdaptationPreview = {
        status: "stopped",
        rootTaskId: resolvedRootTaskId,
        parentTaskId: parent.id,
        nextRound: 0,
        maxAdaptationRounds: parent.effectivePolicy!.values.maxAdaptationRounds,
        profileId: parent.effectivePolicy!.profileId,
        reason: "successor-already-created",
        stoppedReason: "successor-already-created",
        fields: [],
        summary: "Adaptation stopped: parent already has one successor in the lineage.",
      };
      this.store.recordAdaptationRejection(
        parent.id,
        "Adaptation apply rejected (duplicate lineage edge)",
        { preview, proposedReason },
      );
      return { status: "stopped", preview };
    }

    return {
      status: "eligible",
      preview: eligiblePreview,
      childTaskId: childId,
      lineageId,
    };
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
    const globalCap = this.maxConcurrencyOverride ?? this.settings.get().execution.maxConcurrency;
    while (!this.closing && this.active.size < globalCap && this.queue.length > 0) {
      // Find the next eligible job respecting per-profile concurrency caps
      let jobIndex = -1;
      for (let i = 0; i < this.queue.length; i += 1) {
        const candidate = this.queue[i]!;
        try {
          const task = this.store.getTask(candidate.taskId);
          const profileConcurrency = task.effectivePolicy?.values.maxConcurrency ?? globalCap;
          const cap = Math.min(profileConcurrency, globalCap);
          // Count active jobs from this profile
          let profileActive = 0;
          for (const [activeTaskId] of this.active) {
            try {
              const activeTask = this.store.getTask(activeTaskId);
              if (activeTask.effectivePolicy?.profileId === task.effectivePolicy?.profileId) {
                profileActive += 1;
              }
            } catch {
              // Active task may have been removed; skip
            }
          }
          if (profileActive < cap) {
            jobIndex = i;
            break;
          }
        } catch {
          // Invalid task; skip this candidate
        }
      }
      if (jobIndex === -1) {
        // No eligible job under current concurrency caps; wait for an active job to finish.
        // Queue items beyond index 0 may be eligible later but we cannot skip the head
        // without stalling. Fair scheduling: if the head is blocked by concurrency, we
        // check if any later item from a different profile could run.
        return;
      }
      const job = this.queue.splice(jobIndex, 1)[0]!;
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
    const task = this.store.getTask(job.taskId);
    // Read Attempt limits from immutable task snapshot, falling back to live settings for legacy tasks
    const baseMaxAttempts = task.effectivePolicy?.values.baseMaxAttempts ?? exec.maxAttempts;
    const maxExtraAttempts = task.effectivePolicy?.values.maxExtraAttempts ?? exec.maxExtraAttempts;

    // Canonical launch admission. For a new Task this runs before any source
    // copy; for resume/correction it still runs before a new Attempt or Worker.
    // Authentication failure is environment evidence, never model-quality
    // evidence, and does not trigger retry/adaptation.
    if (!preflightTaskLaunchAuthentication(this.store, task, this.providerAuthInspector)) {
      return;
    }

    if (job.correcting) {
      await correctTask(
        this.store,
        job.taskId,
        undefined,
        exec,
        settings.providerDefaults,
      );
      return;
    }

    // Restart recovery: reconstruct pending generic-extra options when the
    // queued job lost its in-memory execution options after daemon restart.
    let effectiveOptions = job.executionOptions;
    if (!effectiveOptions) {
      const pending = resolvePendingGrantExecutionOptions(
        this.store, job.taskId, baseMaxAttempts, maxExtraAttempts,
      );
      if (pending) effectiveOptions = pending;
    }
    if (job.revising) {
      await executeAttempt(
        this.store, task, true, undefined,
        job.feedback, exec, settings.providerDefaults, effectiveOptions,
      );
    } else if (job.resuming) {
      const attemptCount = this.store.listAttempts(job.taskId).length;
      const maximumOrdinal = effectiveOptions?.maximumOrdinal ?? baseMaxAttempts;
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
        effectiveOptions,
      );
    } else {
      let currentTask = task;
      try {
        if (!(await isWorkspaceReady(currentTask.paths))) {
          await clearTaskPreparationArtifacts(currentTask.paths);
          currentTask = await prepareTaskWorkspace(this.store, currentTask);
        }
      } catch (error) {
        const latest = this.store.getTask(task.id);
        if (latest.status !== "failed") {
          const message = error instanceof Error ? error.message : String(error);
          this.store.setTaskStatus(task.id, "failed", {
            finishedAt: timestamp(),
            workerPid: null,
            error: `Workspace preparation failed: recovery cleanup: ${message}`,
          });
        }
        return;
      }
      await executeAttempt(this.store, currentTask, false, undefined, undefined, exec, settings.providerDefaults);
    }
  }
}
