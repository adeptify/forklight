import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  HealthEnvironmentCache,
  loadHealthEnvironmentSnapshot,
} from "./health-environment.js";
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
  GoalMilestoneRecord,
  GoalRecord,
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
  noteRestartContinuationSkipped,
  recordRestartContinuationsForTasks,
  resolvePendingCorrectionGrant,
  resolvePendingGrantExecutionOptions,
  resolvePendingRestartRecoveryGrant,
  type MainCorrectionAuthorization,
} from "../core/attempt-authorization.js";
import type { DaemonShutdownIntent } from "./protocol.js";
import { latestMainReview, recordMainReview } from "../core/main-review.js";
import {
  projectMainFailureAttribution,
  recordMainFailureAttribution,
  type FailureAttributionCause,
  type MainFailureAttributionProjection,
  type MainFailureAttributionReceipt,
} from "../core/main-failure-attribution.js";
import type { ProviderAuthInspector, ProviderName, ProviderReadiness } from "../core/providers.js";
import { providerNames, realProviderAuthInspector, resolveProvider } from "../core/providers.js";
import {
  createClaudeProbeRunner,
  deriveProviderHealthStatus,
  normalizeProbeStatusWithLocalSignIn,
  ProviderProbeService,
  realClock,
  realExecFile,
  realKeychainChecker,
  realKeychainReader,
  type ProbePolicy,
} from "../core/provider-probe.js";
import { assertWorkPlan, type WorkPlan } from "../core/plan.js";
import {
  computeSelfUpgradeEvidence,
  parseRequiredStreakCount,
  SELF_UPGRADE_RESULT_WINDOW,
  type SelfUpgradeEvidenceProjection,
} from "../core/self-upgrade-evidence.js";
import {
  advanceGoalRecords,
  assertGoal,
  assertGoalCorrectionAllowed,
  assertGoalReviewAllowed,
  buildGoalRecords,
  evaluateMilestoneGate,
  goalAdmissionBlocked,
  markGoalCapReached,
  projectGoal,
  reconcileGoalRecords,
  resolveEffectiveMilestoneLineage,
  stopGoalRecords,
  type GoalAdvanceResult,
  type GoalRegistrationResult,
  type GoalView,
  type LoadedGoal,
} from "../core/goal.js";
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
  type CompetitionCreateOptions,
  type RankingPolicyOverride,
  type WorkerReadinessVerifier,
} from "../core/competition.js";
import {
  CandidateHandoffError,
  executeCandidateHandoff,
  executeGoalTaskHandoff,
  projectCandidateHandoff,
  recoverCandidateHandoffs,
  resolveHandoffViewForTask,
  type CandidateHandoffRequest,
  type GoalTaskHandoffRequest,
} from "../core/candidate-handoff.js";
import { loadTaskSpec, parseTaskSpec } from "../core/task.js";
import {
  buildCreatedOutcomeIntake,
  buildOutcomeIntakeConfirmationPreview,
  buildOutcomeIntakeConfirmationReceipt,
  buildProposedOutcomeIntake,
  createOutcomeIntakeRecord,
  normalizeOutcomeIntakeConfirm,
  normalizeOutcomeIntakeCreate,
  normalizeOutcomeIntakeListLimit,
  normalizeOutcomeIntakePropose,
  outcomeIntakeArtifactGraphDigest,
  projectOutcomeIntake,
  projectOutcomeIntakeConfirmation,
  OUTCOME_INTAKE_CONFIRM_IN_PROGRESS_REASON,
  OUTCOME_INTAKE_NO_PROPOSAL_REASON,
  OUTCOME_INTAKE_STALE_ARTIFACT_REASON,
  STALE_OUTCOME_INTAKE_CONFIRM_REASON,
  STALE_OUTCOME_INTAKE_REASON,
  type OutcomeIntakeArtifactLoad,
  type OutcomeIntakeConfirmationPreview,
  type OutcomeIntakeConfirmationView,
  type OutcomeIntakeView,
  type ProposedShape,
} from "../core/outcome-intake.js";
import { isoTimestamp as timestamp, sleepMs as sleep } from "../core/time.js";
import { providerReadiness } from "../core/providers.js";
import { listWorkerAdapters } from "../workers/registry.js";
import { resolveWorkerReadiness } from "../core/worker-readiness.js";
import type { RuntimeName } from "../core/runtime-names.js";
import {
  resolveReadiness,
  type DependencyDecision,
} from "../core/dependency-resolver.js";
import { BoardService, type PlanBoard, type PlanBoardSummary } from "../core/board.js";
import {
  WorkHierarchyService,
  type WorkHierarchyView,
} from "../core/work-hierarchy.js";
import {
  StatisticsService,
  type ProviderModelSummary,
  type RoutingEvidenceCoverage,
  type StatisticsFilter,
} from "../core/statistics.js";
import {
  provideRoutingAdvice,
  type CompetitionTrigger,
  type RoutingAdvisoryResponse,
  type RoutingPolicySettings,
} from "../core/model-routing.js";
import { resolveProfileRoutingCandidates } from "../core/profile-routing.js";
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
  computeMainDirectAggregate,
  createMainDirectDecision,
  isIdenticalClose,
  MAIN_DIRECT_RECENT_LIMIT,
  projectMainDirectDecision,
  projectMainDirectDecisionList,
  selectMainDirectRecentEntries,
  validateMainDirectClose,
  validateMainDirectStart,
  type MainDirectCompleteInput,
  type MainDirectStartContext,
  type MainDirectStartInput,
} from "../core/main-direct-execution-decision.js";
import type {
  MainDirectDecisionAggregate,
  MainDirectDecisionProjection,
  MainDirectDecisionRecentEntry,
  MainDirectVerification,
} from "../core/types.js";
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
import {
  projectTaskSurface,
  type SafeTaskSummary,
} from "../core/task-summary.js";
import {
  latestTaskResolutionState,
  reopenTaskResolution,
  resolveTaskResolution,
  type TaskResolutionReason,
  type TaskResolutionState,
} from "../core/task-resolution.js";
import { paginateTaskHistory, type TaskHistoryPage, type TaskHistoryPageRequest } from "../core/task-history.js";
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
  applyReusedTaskClass,
  CLASS_REUSE_STALE_REASON,
} from "../core/task-class-reuse.js";
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
import type { CorrectionEligibility, ReviewGraphView } from "../core/types.js";
import {
  createReviewGraph,
  getReviewGraphStatus,
  reconcileAllReviewGraphs,
  reconcileReviewGraphForTask,
} from "../core/review-graph.js";

export interface PlanRegistrationResult {
  planId: string;
  taskIdsByItemId: Record<string, string>;
}

export type { GoalRegistrationResult, GoalView, GoalAdvanceResult };

/** The exact validated artifact graph bound to an outcome-intake proposal.
 *  Created from the same load used for digest identity so confirmation never
 *  validates one byte set and registers a later independent read. */
type OutcomeIntakeArtifactRegistration =
  | { kind: "task"; spec: TaskSpec; taskFile: string }
  | { kind: "plan"; plan: WorkPlan }
  | { kind: "goal"; goal: LoadedGoal };

/** A validated artifact plus its complete registration source. Extends the
 *  public facts/digest load so proposal previews stay unchanged while
 *  confirmation can reuse the identical load for the existing registrations. */
interface LoadedOutcomeIntakeArtifact extends OutcomeIntakeArtifactLoad {
  registration: OutcomeIntakeArtifactRegistration;
}

/** Staged outcome-intake confirmation registration result. */
interface OutcomeIntakeRegistrationResult {
  taskIds: string[];
  registrations: StagedTaskRegistration[];
  planRecord?: PlanRecord;
  items?: PlanItemRecord[];
  dependencies?: DependencyRecord[];
  goal?: GoalRecord;
  milestones?: GoalMilestoneRecord[];
  planId?: string;
  goalId?: string;
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

/** Strip one matching surrounding quote pair from a ps command token so paths
 *  containing spaces stay path-agnostic and the executable name is comparable. */
function unquoteCommandToken(token: string): string {
  if (token.length < 2) return token;
  const first = token[0]!;
  const last = token[token.length - 1]!;
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return token.slice(1, -1);
  }
  return token;
}

/**
 * Bounded managed-Worker command classification used by the exact-PID shutdown
 * and crash-recovery stop path. Only ForkLight-owned Worker launch shapes are
 * classified; never enumerates processes, never broadens to unrelated daemon
 * processes, and never matches the word "codex" in arbitrary arguments.
 *
 * Existing runtimes keep the pre-existing substring behavior: the claude and
 * grok CLI binaries appear as the executable, and sandbox-exec is the macOS
 * sandbox wrapper that launches them.
 *
 * Codex app-server is recognized by its executable shape plus the exact
 * "app-server" subcommand, so any install path is covered and a process that
 * merely mentions codex is never classified. A node/env interpreter indirection
 * is accepted so the JS-shim installation shape is also recognized.
 */
export function isManagedWorkerCommand(command: string): boolean {
  if (/(?:claude|grok|sandbox-exec)/i.test(command)) return true;
  const tokens = command.trim().split(/\s+/).map(unquoteCommandToken);
  if (!tokens.includes("app-server")) return false;
  const executable = tokens[0] ?? "";
  const executableName = path.basename(executable).toLowerCase();
  if (executableName === "codex" || executableName === "codex.js") return true;
  if (executableName === "node" || executableName === "env") {
    const script = tokens[executableName === "env" ? 2 : 1] ?? "";
    const scriptName = path.basename(script).toLowerCase();
    return scriptName === "codex" || scriptName === "codex.js";
  }
  return false;
}

function looksLikeWorker(pid: number): boolean {
  try {
    const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return isManagedWorkerCommand(command);
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
  /** Full Task lifecycle in-flight set: preparation, Worker, verification, Candidate capture. */
  private readonly active = new Map<string, Promise<void>>();
  /**
   * Private Profile Worker occupancy: Task ids that currently hold a Worker
   * Profile slot (from scheduler admission through runtime return). Independent
   * verification keeps the Task in `active` but must not keep the Profile slot.
   */
  private readonly profileWorkerOccupancy = new Set<string>();
  private readonly activeIntegrations = new Map<string, Promise<void>>();
  private readonly integrationOperations = new Map<string, IntegrationOperationContext>();
  private readonly authorizedHandoffShutdowns = new Set<string>();
  /** Same-path serialization gate for preview-bound draft classification writes.
   *  A second in-progress write to the same Task Contract is rejected so a
   *  stale confirmation can never overwrite a concurrent first result. */
  private readonly classReuseInFlight = new Set<string>();
  /** One per-intake confirmation gate. A second explicit confirmation for the
   *  same outcome intake is rejected while the first is running; the caller
   *  retries and then receives the already-stored receipt. */
  private readonly outcomeIntakeConfirmInFlight = new Set<string>();
  private closing = false;
  /** Process-local complete snapshot of expensive Keychain/Runtime inspection. */
  private readonly healthEnvironment: HealthEnvironmentCache;

  constructor(
    private readonly store: StateStore,
    private readonly settings: SettingsService,
    private readonly maxConcurrencyOverride?: number,
    private readonly providerAuthInspector: ProviderAuthInspector = realProviderAuthInspector(),
    healthEnvironment?: HealthEnvironmentCache,
  ) {
    this.healthEnvironment = healthEnvironment ?? new HealthEnvironmentCache({
      load: (defaults) => loadHealthEnvironmentSnapshot(defaults, this.providerAuthInspector),
    });
  }

  health(): Record<string, unknown> {
    const effectiveSettings = this.settings.get();
    // Expensive environment facts are reused as one complete snapshot.
    const environment = this.healthEnvironment.get(effectiveSettings.providerDefaults);
    // Dynamic operational facts are always read fresh. Verification reuses the
    // snapshot's authentication truth so health never re-opens Keychain or
    // local-sign-in paths for the same unexpired generation.
    const verification = this.safeVerificationSnapshotFromAuth(environment.providers);
    return {
      // Transition: ok still requires Claude for daemon liveness + any provider.
      ok: environment.claudeCode !== "unavailable" && environment.anyReady,
      pid: process.pid,
      claudeCode: environment.claudeCode,
      runtimes: environment.runtimes,
      defaultRuntime: effectiveSettings.execution.defaultRuntime,
      providers: environment.providers,
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
   * Terminal ordinary Task history feeds only the classification reuse advice;
   * it never enters the preview revision digest. Never registers, queues,
   * prepares, verifies, integrates, or probes.
   */
  async validateFile(taskFile: string): Promise<SafeTaskAdmissionPreview> {
    if (!path.isAbsolute(taskFile)) {
      throw new Error("validate_file requires an absolute Task Contract file path");
    }
    return buildTaskAdmissionPreview(taskFile, this.settings.get(), this.store.listTasks());
  }

  /**
   * Preview-bound draft classification reuse. Daemon authority owns the
   * mutation gate and same-path serialization: it recomputes every authority
   * condition (file digest, effective preview digest, family/class state and
   * exact current classChoice) and never trusts Hub-displayed state or file
   * contents. Only the root taskClass of an unsubmitted Task Contract draft
   * may change; the operation never submits a Task, starts a Worker, or
   * mutates settings/history/lifecycle. Returns the fresh SafeTaskAdmissionPreview
   * generated from the written file.
   */
  async reuseTaskClass(params: {
    taskFile: string;
    expectedPreviewRevisionDigest: string;
    taskClass: string;
    confirm: true;
  }): Promise<SafeTaskAdmissionPreview> {
    if (params.confirm !== true) {
      throw new Error("reuse_task_class requires explicit confirm: true");
    }
    if (typeof params.taskFile !== "string" || !path.isAbsolute(params.taskFile)) {
      throw new Error("reuse_task_class requires an absolute Task Contract file path");
    }
    if (
      typeof params.expectedPreviewRevisionDigest !== "string"
      || !PREVIEW_REVISION_DIGEST_PATTERN.test(params.expectedPreviewRevisionDigest)
    ) {
      throw new Error(CLASS_REUSE_STALE_REASON);
    }
    const taskClass = typeof params.taskClass === "string" ? params.taskClass.trim() : "";
    if (taskClass.length === 0 || taskClass.length > 80) {
      throw new Error("reuse_task_class requires a taskClass of 1 to 80 characters");
    }
    const lockKey = path.resolve(params.taskFile);
    if (this.classReuseInFlight.has(lockKey)) {
      throw new Error(
        "A classification change is already in progress for this Task contract; preview again before applying",
      );
    }
    this.classReuseInFlight.add(lockKey);
    try {
      const result = await applyReusedTaskClass({
        taskFileInput: params.taskFile,
        expectedPreviewRevisionDigest: params.expectedPreviewRevisionDigest,
        taskClass,
        settings: this.settings.get(),
        tasks: this.store.listTasks(),
      });
      return result.preview;
    } finally {
      this.classReuseInFlight.delete(lockKey);
    }
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

  async submitCompetitionFile(
    taskFile: string,
    candidates: CandidateOverride[],
    options: CompetitionCreateOptions = {},
  ): Promise<CompetitionRecord> {
    const settings = this.settings.get();
    const loaded = await loadTaskSpec(taskFile, taskPolicy(settings));
    return this.submitCompetition(loaded.spec, loaded.taskFile, candidates, options);
  }

  async submitInlineCompetition(
    rawTask: unknown,
    baseDirectory: string,
    candidates: CandidateOverride[],
    options: CompetitionCreateOptions = {},
  ): Promise<CompetitionRecord> {
    const settings = this.settings.get();
    const spec = parseTaskSpec(rawTask, baseDirectory, taskPolicy(settings));
    return this.submitCompetition(spec, "forklight://mcp/inline-competition-task", candidates, options);
  }

  async submitCompetition(
    contractSpec: TaskSpec,
    contractTaskFile: string,
    candidates: CandidateOverride[],
    options: CompetitionCreateOptions = {},
  ): Promise<CompetitionRecord> {
    const coordinator = new CompetitionCoordinator(this.store, this.settings);
    // The daemon always supplies the canonical Worker readiness verifier so
    // every selected Profile is provably launchable before any workspace
    // preparation. Client-supplied options never override it.
    const admissionOptions: CompetitionCreateOptions = {
      ...options,
      readinessVerifier: this.buildCompetitionReadinessVerifier(),
    };
    const { competition, taskIds } = await coordinator.create(
      contractSpec,
      contractTaskFile,
      candidates,
      admissionOptions,
    );
    for (const taskId of taskIds) this.queueTask(taskId);
    return competition;
  }

  /** Build the canonical Worker readiness verifier for Competition admission.
   *  Reuses resolveWorkerReadiness (model, pairing, authentication, runtime,
   *  permissions) so admission is all-or-nothing: one not-launchable Profile
   *  rejects the whole Competition before any Task, event, snapshot, workspace,
   *  or Provider call is created. */
  private buildCompetitionReadinessVerifier(): WorkerReadinessVerifier {
    return (profileIds: readonly string[]): void => {
      const settings = this.settings.get();
      const providers = providerReadiness(settings.providerDefaults, this.providerAuthInspector);
      const runtimes: Partial<Record<RuntimeName, { ok: boolean }>> = {};
      for (const adapter of listWorkerAdapters()) {
        const doctor = adapter.doctor();
        if (!(doctor instanceof Promise)) {
          runtimes[adapter.name] = { ok: doctor.ok };
        }
      }
      const results = resolveWorkerReadiness({
        workerProfiles: settings.workerProfiles,
        providerDefaults: settings.providerDefaults,
        providers: providers.providers,
        runtimes,
        ...(settings.modelCatalog === undefined ? {} : { modelCatalog: settings.modelCatalog }),
      });
      const byId = new Map(results.map((r) => [r.workerId, r]));
      for (const id of profileIds) {
        const result = byId.get(id);
        if (result === undefined) {
          throw new Error(`Competition candidate references an unknown Worker Profile: ${id}`);
        }
        if (!result.canLaunch) {
          throw new Error(
            `Competition candidate Worker Profile is not launchable: ${id} (${result.reason})`,
          );
        }
      }
    };
  }

  /** Record a Competition-level Main decision (accept/revise/reject) bound to
   *  one exact Candidate Revision. An explicit derivation of the chosen
   *  candidate Task's latest Main Review; never auto-retries, auto-accepts, or
   *  auto-integrates. Only `accept` makes the exact revision the final choice
   *  eligible for Integration (which still requires explicit confirmation). */
  competitionMainDecision(
    competitionId: string,
    candidateId: string,
    decision: "accept" | "revise" | "reject",
    reason: string,
    confirm: true,
  ): import("../core/types.js").CompetitionMainDecision {
    if (confirm !== true) throw new Error("competition_main_decision requires explicit confirm: true");
    return new CompetitionCoordinator(this.store, this.settings).recordMainDecision(
      competitionId,
      candidateId,
      decision,
      reason,
    );
  }

  /** Record bounded retained-partial evidence for one non-selected Candidate.
   *  Stores reusable paths and remaining gaps for later M2 handoff only; never
   *  starts a Worker, retry, successor, or Integration. */
  competitionRetainedPartial(
    competitionId: string,
    candidateId: string,
    reusablePaths: unknown,
    remainingGaps: unknown,
    confirm: true,
  ): import("../core/types.js").CompetitionRetainedPartial {
    if (confirm !== true) throw new Error("competition_retained_partial requires explicit confirm: true");
    return new CompetitionCoordinator(this.store, this.settings).recordRetainedPartial(
      competitionId,
      candidateId,
      reusablePaths,
      remainingGaps,
    );
  }

  /** Explicit confirmed one-hop handoff of one exact retained Candidate to one
   *  different saved Worker Profile. Creates exactly one durable successor Task
   *  from the current project snapshot with selected-path import only. Never
   *  mutates the source Task, auto-selects a Worker, retries, accepts, or
   *  integrates. Preparation failure launches no Worker. */
  async competitionHandoff(
    request: CandidateHandoffRequest,
  ): Promise<import("../core/types.js").CandidateHandoffView> {
    if (request.confirm !== true) {
      throw new CandidateHandoffError(
        "confirm-required",
        "competition_handoff requires explicit confirm: true",
      );
    }
    if (this.closing) throw new Error("ForkLight daemon is shutting down");
    const view = await executeCandidateHandoff(
      this.store,
      this.settings.get(),
      request,
      this.handoffReadiness(),
    );
    await this.queuePreparedHandoffSuccessor(view);
    return view;
  }

  /**
   * Explicit confirmed direct Goal-Task handoff: retain selected whole-file
   * paths and bounded gaps from one exact normal Goal milestone Candidate and
   * hand them to one different saved Worker Profile. Never creates a
   * Competition, mutates the source Task, auto-selects, retries, accepts,
   * integrates, commits, or pushes.
   */
  async goalTaskHandoff(
    request: GoalTaskHandoffRequest,
  ): Promise<import("../core/types.js").CandidateHandoffView> {
    if (request.confirm !== true) {
      throw new CandidateHandoffError(
        "confirm-required",
        "goal_task_handoff requires explicit confirm: true",
      );
    }
    if (this.closing) throw new Error("ForkLight daemon is shutting down");
    const view = await executeGoalTaskHandoff(
      this.store,
      this.settings.get(),
      request,
      this.handoffReadiness(),
    );
    await this.queuePreparedHandoffSuccessor(view);
    // Handoff is one authoritative evidence change for the Goal.
    if (view.originKind === "goal-task" && view.goalId !== undefined) {
      try {
        this.reconcileGoal(view.goalId);
      } catch {
        // Goal projection refresh is best-effort; durable handoff already committed.
      }
    } else if (view.sourceTaskId) {
      this.reconcileGoalsForTask(view.sourceTaskId);
    }
    return view;
  }

  private handoffReadiness(): {
    canLaunch: (profileId: string) => { ok: boolean; reason?: string };
  } {
    return {
      canLaunch: (profileId) => {
        try {
          this.buildCompetitionReadinessVerifier()([profileId]);
          return { ok: true };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { ok: false, reason: message };
        }
      },
    };
  }

  private async queuePreparedHandoffSuccessor(
    view: import("../core/types.js").CandidateHandoffView,
  ): Promise<void> {
    // Queue only after successful preparation. Failed preparation leaves a
    // durable failed record and never launches a Worker.
    if (view.status !== "prepared") return;
    try {
      this.enqueue({ taskId: view.successorTaskId, resuming: false });
    } catch {
      this.store.addEvent(
        view.successorTaskId,
        undefined,
        "task.ready",
        "Handoff successor persisted and will be recovered from the durable queue",
        { handoffId: view.id },
      );
    }
  }

  /** Privacy-safe handoff projection for a Task (source or successor). */
  candidateHandoffForTask(taskId: string): import("../core/types.js").CandidateHandoffView | undefined {
    this.store.getTask(taskId);
    return resolveHandoffViewForTask(this.store, taskId);
  }

  competitionStatus(competitionId: string): Record<string, unknown> {
    const competition = this.store.getCompetition(competitionId);
    const candidateRecords = this.store.getCompetitionCandidates(competitionId);
    const candidates = candidateRecords.map((record) => {
      const task = this.store.getTask(record.taskId);
      const review = latestMainReview(this.store.listEvents(record.taskId));
      return {
        candidateId: record.id,
        taskId: record.taskId,
        ordinal: record.ordinal,
        providerName: record.providerName,
        modelName: record.modelName,
        taskStatus: task.status,
        // Frozen Worker identity resolved at admission. Absent on legacy
        // records - Hub reports the historical identity as unavailable.
        ...(record.identity === undefined ? {} : { identity: record.identity }),
        // Candidate Task-level Main Review decision (canonical authority).
        // Absent when Main has not reviewed this candidate yet.
        ...(review === undefined ? {} : { mainReviewDecision: review.decision }),
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

    const mainDecision = competition.mainDecision;
    let mainDecisionCurrent = false;
    if (mainDecision !== undefined) {
      const decidedCandidate = candidateRecords.find(
        (candidate) => candidate.id === mainDecision.candidateId,
      );
      if (decidedCandidate !== undefined) {
        const decidedEvents = this.store.listEvents(decidedCandidate.taskId);
        const latestRevision = resolveLatestRevision(decidedEvents);
        const latestReview = latestMainReview(decidedEvents);
        mainDecisionCurrent = latestRevision !== undefined
          && latestReview !== undefined
          && mainDecision.taskId === decidedCandidate.taskId
          && mainDecision.attemptId === latestReview.attemptId
          && mainDecision.verificationEventSequence === latestReview.verificationEventSequence
          && mainDecision.candidateRevisionId === latestRevision.id
          && mainDecision.acceptedPatchDigest === latestRevision.patchDigest;
      }
    }
    // The machine recommendation is a comparison only - never a final Winner.
    // A final choice exists only when Main has accepted an exact Candidate
    // Revision at the Competition level.
    const machineComparison = {
      kind: "machine-comparison" as const,
      state: evaluation === undefined
        ? "waiting"
        : (evaluation as Record<string, unknown>).recommendation === undefined
          ? "no-deliverable"
          : "recommendation",
      waitingForMain: evaluation !== undefined && !mainDecisionCurrent,
      ...(evaluation === undefined ? {} : { recommendation: (evaluation as Record<string, unknown>).recommendation }),
    };
    const finalChoice = mainDecisionCurrent && mainDecision?.decision === "accept"
      ? {
          candidateId: mainDecision.candidateId,
          taskId: mainDecision.taskId,
          ...(mainDecision.candidateRevisionId === undefined ? {} : { candidateRevisionId: mainDecision.candidateRevisionId }),
          ...(mainDecision.acceptedPatchDigest === undefined ? {} : { acceptedPatchDigest: mainDecision.acceptedPatchDigest }),
        }
      : undefined;
    const nextAction = progress.terminal < progress.total
      ? "wait-for-candidates"
      : evaluation === undefined
        ? "compare"
        : !mainDecisionCurrent
          ? "main-review"
          : mainDecision?.decision === "accept"
            ? "integration"
            : mainDecision?.decision === "revise"
              ? "correct-candidate"
              : "stopped";

    return {
      competition,
      candidates,
      progress,
      // Bounded Main reason. Absent on legacy records - never inferred.
      ...(competition.reason === undefined ? {} : { reason: competition.reason }),
      ...(competition.legacy ? { legacy: true } : {}),
      ...(competition.retainedPartial === undefined ? {} : { retainedPartial: competition.retainedPartial }),
      ...(mainDecision === undefined ? {} : { mainDecision }),
      mainDecisionCurrent,
      machineComparison,
      ...(finalChoice === undefined ? {} : { finalChoice }),
      nextAction,
      ...(evaluation === undefined ? {} : { evaluation }),
      // Privacy-safe handoff projections for this Competition (source identities only).
      handoffs: this.store.listCandidateHandoffsByCompetitionId(competitionId).map((record) => {
        let successorTaskStatus: TaskStatus | undefined;
        try {
          successorTaskStatus = this.store.getTask(record.successorTaskId).status;
        } catch {
          successorTaskStatus = undefined;
        }
        return projectCandidateHandoff(record, successorTaskStatus);
      }),
    };
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
    const createdAt = timestamp();
    const { registrations, items, dependencies, planRecord, taskIdsByItemId } =
      this.preparePlanRegistration(plan, createdAt);
    this.store.createPlanExecution(registrations, planRecord, items, dependencies);
    for (const taskId of Object.values(taskIdsByItemId)) this.queueTask(taskId);
    return { planId: planRecord.id, taskIdsByItemId };
  }

  /** Build the exact existing Plan registration graph from one validated load.
   *  Shared by ordinary Plan submission and confirmed outcome-intake creation so
   *  both paths produce identical Task records, events, items, and dependency
   *  rows. Never mutates or queues by itself. */
  private preparePlanRegistration(
    plan: WorkPlan,
    createdAt: string,
  ): {
    registrations: StagedTaskRegistration[];
    items: PlanItemRecord[];
    dependencies: DependencyRecord[];
    planRecord: PlanRecord;
    taskIdsByItemId: Record<string, string>;
  } {
    const planId = plan.planFile;
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
    const planRecord: PlanRecord = {
      id: planId,
      name: plan.name,
      objective: plan.objective,
      planFile: plan.planFile,
      createdAt,
      updatedAt: createdAt,
    };
    return { registrations, items, dependencies, planRecord, taskIdsByItemId };
  }

  async submitPlanFile(planFile: string): Promise<PlanRegistrationResult> {
    const settings = this.settings.get();
    const report = await assertWorkPlan(planFile, taskPolicy(settings));
    return this.submitPlan(report.plan);
  }

  /**
   * Atomically freeze one Goal over a four-to-eight Task Plan, then queue
   * only dependency-ready work through the ordinary Plan scheduler.
   */
  submitGoal(loaded: LoadedGoal): GoalRegistrationResult {
    const createdAt = timestamp();
    const prepared = this.prepareGoalRegistration(loaded, createdAt);
    this.store.createPlanExecutionWithGoal(
      prepared.registrations,
      prepared.planRecord,
      prepared.items,
      prepared.dependencies,
      prepared.goal,
      prepared.milestones,
    );
    // Queue only after durable registration; Goal gates apply on admission.
    for (const taskId of Object.values(prepared.taskIdsByItemId)) this.queueTask(taskId);
    this.reconcileGoal(prepared.goal.id);
    return {
      goalId: prepared.goal.id,
      planId: prepared.planRecord.id,
      taskIdsByItemId: prepared.taskIdsByItemId,
    };
  }

  /** Build the exact existing Goal registration graph (Plan Tasks, dependencies,
   *  Goal, and milestones) from one validated load. Shared by ordinary Goal
   *  submission and confirmed outcome-intake creation so both paths produce
   *  identical records. Never mutates or queues by itself. */
  private prepareGoalRegistration(
    loaded: LoadedGoal,
    createdAt: string,
  ): {
    registrations: StagedTaskRegistration[];
    items: PlanItemRecord[];
    dependencies: DependencyRecord[];
    planRecord: PlanRecord;
    goal: GoalRecord;
    milestones: GoalMilestoneRecord[];
    taskIdsByItemId: Record<string, string>;
  } {
    const plan = loaded.plan;
    const planId = plan.planFile;
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
            goalFile: loaded.goalFile,
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
    const planRecord: PlanRecord = {
      id: planId,
      name: plan.name,
      objective: plan.objective,
      planFile: plan.planFile,
      createdAt,
      updatedAt: createdAt,
    };
    const { goal, milestones } = buildGoalRecords({
      loaded,
      planId,
      taskIdsByItemId,
      createdAt,
    });
    return { registrations, items, dependencies, planRecord, goal, milestones, taskIdsByItemId };
  }

  /** Build one exact staged Task registration from a validated Task load. */
  private prepareTaskRegistration(
    spec: TaskSpec,
    taskFile: string,
    createdAt: string,
  ): { taskId: string; task: TaskRecord; creationEvent: StagedTaskRegistration["creationEvent"] } {
    const taskId = randomUUID();
    const effectivePolicy = this.resolveEffectivePolicy(spec);
    const task = buildTaskRecord({
      spec,
      taskFile,
      home: path.dirname(this.store.databasePath),
      id: taskId,
      sessionId: randomUUID(),
      createdAt,
      ...(effectivePolicy === undefined ? {} : { effectivePolicy }),
    });
    return {
      taskId,
      task,
      creationEvent: {
        summary: `Task created: ${spec.name}`,
        payload: {
          provider: spec.provider.name,
          model: spec.provider.model,
          runtime: spec.runtime.name,
          sourcePath: spec.project,
        },
      },
    };
  }

  async submitGoalFile(goalFile: string): Promise<GoalRegistrationResult> {
    const settings = this.settings.get();
    const loaded = await assertGoal(goalFile, taskPolicy(settings));
    return this.submitGoal(loaded);
  }

  goalStatus(goalId: string): GoalView {
    // Read-only inspect still reconciles durable milestone projections so
    // Main sees current evidence without treating the poll as new evidence.
    this.reconcileGoal(goalId, { fromStatusPoll: true });
    return projectGoal(this.store, goalId);
  }

  listGoals(limit = 50): GoalView[] {
    return this.store.listGoals(limit).map((goal) => {
      this.reconcileGoal(goal.id, { fromStatusPoll: true });
      return projectGoal(this.store, goal.id);
    });
  }

  advanceGoal(goalId: string, confirm: true): GoalAdvanceResult {
    if (confirm !== true) throw new Error("goal advance requires confirm: true");
    this.store.getGoal(goalId);
    const result = advanceGoalRecords(this.store, goalId);
    // Reconcile may unlock dependents only when evidence actually changed.
    if (result.newEvidence) {
      this.reconcilePlans();
    }
    // Explicit no-new-evidence cap is a durable terminal stop: prune queued
    // (not active) work so admission control matches the Goal label.
    if (goalAdmissionBlocked(this.store.getGoal(goalId))) {
      this.pruneGoalBlockedQueuedJobs();
    }
    return result;
  }

  stopGoal(goalId: string, confirm: true): GoalView {
    if (confirm !== true) throw new Error("goal stop requires confirm: true");
    const view = stopGoalRecords(this.store, goalId, true);
    // Stop is durable admission control only; do not kill active Workers.
    // Jobs that were queued before the stop are not active yet, so remove
    // them now and leave a truthful waiting record for Main.
    this.pruneGoalBlockedQueuedJobs();
    return view;
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

    // Goal-level correction cap rejects before any durable mutation.
    const goalForCorrection = this.store.getGoalByTaskId(taskId);
    if (goalForCorrection !== undefined) {
      try {
        assertGoalCorrectionAllowed(goalForCorrection);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/correction cap/i.test(message)) {
          markGoalCapReached(this.store, goalForCorrection.id, "correction-cap");
        }
        throw error;
      }
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

    if (goalForCorrection !== undefined) {
      const now = timestamp();
      const goal = this.store.getGoal(goalForCorrection.id);
      this.store.saveGoal({
        ...goal,
        counters: {
          ...goal.counters,
          correctionRounds: goal.counters.correctionRounds + 1,
        },
        updatedAt: now,
      }, this.store.getGoalMilestones(goal.id));
    }

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
    const result = recordMainReview(this.store, taskId, { decision, reason, confirm });
    // Fresh Main Review is authoritative Goal evidence; unlock gates once.
    this.reconcileGoalsForTask(taskId);
    this.reconcilePlans();
    return result;
  }

  mainFailureAttribution(
    taskId: string,
    input: {
      attemptId: string;
      verificationEventSequence: number;
      cause: FailureAttributionCause;
      note: string;
      candidateRevisionId?: string;
      candidatePatchDigest?: string;
      confirm: true;
    },
  ): MainFailureAttributionReceipt {
    return recordMainFailureAttribution(this.store, taskId, input);
  }

  mainFailureAttributionProjection(taskId: string): MainFailureAttributionProjection {
    return projectMainFailureAttribution(
      this.store.getTask(taskId),
      this.store.listAttempts(taskId),
      this.store.listEvents(taskId),
    );
  }

  /** Delivery truth for the resolution Core: delivered/activated Integration
   *  or verified repaired delivery. Computed once from the canonical Decision
   *  View so the Core never depends on that module (no import cycle). */
  private taskHasDeliveredOutcome(taskId: string): boolean {
    const task = this.store.getTask(taskId);
    const disposition = this.store.getRemediationDisposition(taskId);
    if (disposition?.status === "verified-repaired-delivered") return true;
    const stage = buildTaskDecisionView({
      task,
      attempts: this.store.listAttempts(taskId),
      events: this.store.listEvents(taskId),
      integrationResults: this.store.listIntegrationResults(taskId),
      ...(disposition === undefined ? {} : { remediationDisposition: disposition }),
    }).stage;
    return stage === "delivered" || stage === "activated";
  }

  /**
   * Main resolves a failed/interrupted Task as handled after the real-world
   * problem has been fixed. Delegates all authority, eligibility, idempotency,
   * and conflict semantics to the Core service; returns the closed result with
   * the canonical board placement. Never changes machine status, delivery
   * truth, review truth, or statistics.
   */
  resolveTask(
    taskId: string,
    reason: TaskResolutionReason,
    note: string | undefined,
    evidenceTaskId: string | undefined,
    confirm: true,
  ): {
    taskId: string;
    existing: boolean;
    state: TaskResolutionState;
    boardScope: import("../core/task-summary.js").BoardScope;
    boardReason: import("../core/task-summary.js").BoardReason;
  } {
    if (confirm !== true) throw new Error("resolve requires explicit confirm: true");
    const result = resolveTaskResolution(this.store, taskId, {
      reason,
      ...(note === undefined ? {} : { note }),
      ...(evidenceTaskId === undefined ? {} : { evidenceTaskId }),
      confirm,
      delivered: this.taskHasDeliveredOutcome(taskId),
    });
    const task = this.store.getTask(taskId);
    const summary = this.projectOneTaskSurface(task, Date.now());
    return {
      taskId,
      existing: result.existing,
      state: result.state,
      boardScope: summary.boardScope ?? "now",
      boardReason: summary.boardReason ?? "unresolved-failure",
    };
  }

  /**
   * Main explicitly reopens a handled failure, returning the unchanged
   * failed/interrupted Task to Now. Delegates all authority, idempotency, and
   * conflict semantics to the Core service. Reopen is rejected when the Task
   * later gained delivered/activated/repaired-delivery truth.
   */
  reopenTask(
    taskId: string,
    note: string | undefined,
    confirm: true,
  ): {
    taskId: string;
    existing: boolean;
    state: TaskResolutionState;
    boardScope: import("../core/task-summary.js").BoardScope;
    boardReason: import("../core/task-summary.js").BoardReason;
  } {
    if (confirm !== true) throw new Error("reopen requires explicit confirm: true");
    const result = reopenTaskResolution(this.store, taskId, {
      ...(note === undefined ? {} : { note }),
      confirm,
      delivered: this.taskHasDeliveredOutcome(taskId),
    });
    const task = this.store.getTask(taskId);
    const summary = this.projectOneTaskSurface(task, Date.now());
    return {
      taskId,
      existing: result.existing,
      state: result.state,
      boardScope: summary.boardScope ?? "now",
      boardReason: summary.boardReason ?? "unresolved-failure",
    };
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
    return this.list(statuses, limit).map((task) => this.projectOneTaskSurface(task, nowMs));
  }

  /**
   * Project one Task into its canonical SafeTaskSummary surface. Shared by the
   * recent list projection and the durable History page so both routes derive
   * identical privacy-safe evidence (progress, failureCategory, remediation
   * disposition, Decision Stage, and the canonical board placement).
   */
  private projectOneTaskSurface(task: TaskRecord, nowMs: number): SafeTaskSummary {
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
      // Same ordered evidence Decision View uses so board/list liveStage matches.
      events: events.map((event) => ({
        sequence: event.sequence,
        timestamp: event.timestamp,
        type: event.type,
        ...(event.payload === undefined ? {} : { payload: event.payload }),
      })),
      nowMs,
    });
  }

  /**
   * Read-only durable History page. Derives canonical SafeTaskSummary surfaces
   * for every terminal Task, then delegates to the pure Core paginator which
   * keeps only canonical History, applies the safe summary search, and returns
   * one deterministic bounded page with an opaque continuation.
   *
   * Canonical History always sits on a terminal machine status (delivered,
   * activated, main-rejected, or repaired-delivered outcomes), so the read is
   * narrowed to terminal Tasks before projection. This is an explicit archive
   * read; it is not yet optimized database work. Never mutates Tasks, never
   * echoes private fields, and never infers client-side lifecycle.
   */
  listHistoryPage(request: TaskHistoryPageRequest = {}): TaskHistoryPage {
    const tasks = this.store.listTasks(["succeeded", "failed", "interrupted"]);
    const nowMs = Date.now();
    const summaries = tasks.map((task) => this.projectOneTaskSurface(task, nowMs));
    return paginateTaskHistory(summaries, request);
  }

  getPlanBoard(planId: string): PlanBoard {
    return new BoardService(this.store).getPlanBoard(planId);
  }

  listPlanBoards(limit?: number): PlanBoardSummary[] {
    return new BoardService(this.store).listPlanBoards(limit);
  }

  /**
   * Read-only canonical Goal -> Plan -> Task hierarchy (FL-109A).
   * Reuses the shared SafeTaskSummary projector so Decision Stage and board
   * placement stay single-authority. Never mutates lifecycle state.
   */
  getWorkHierarchy(filterInput?: Record<string, unknown>): WorkHierarchyView {
    const nowMs = Date.now();
    return new WorkHierarchyService(
      this.store,
      (task) => this.projectOneTaskSurface(task, nowMs),
    ).getWorkHierarchy(filterInput);
  }

  /** Bounded, privacy-safe Plan context for a single Task. Returns undefined
   *  when the Task is standalone (no Plan membership). The projection includes
   *  the Plan identity, the owning item, and direct named dependency/dependent
   *  edges. Names are sanitised; IDs remain in the payload only for technical
   *  disclosure. Read-only — never mutates store state. */
  getTaskPlanContext(taskId: string): Record<string, unknown> | undefined {
    const item = this.store.getPlanItemByTaskId(taskId);
    if (!item) return undefined;
    const plan = this.store.getPlan(item.planId);
    if (!plan) return undefined;
    const board = new BoardService(this.store).getPlanBoard(plan.id);
    const boardItem = Object.values(board.columns)
      .flat()
      .find((bi) => bi.taskId === taskId);
    if (!boardItem) return undefined;
    const safePlanName = board.plan.name
      .slice(0, 200)
      .replace(/[\x00-\x1f\x7f]/g, "")
      .trim();
    return {
      planId: board.plan.planId,
      ...(safePlanName.length === 0 ? {} : { planName: safePlanName }),
      itemId: boardItem.itemId,
      itemIndex: boardItem.itemIndex,
      namedDependencies: boardItem.namedDependencies.slice(0, 20),
      namedRequiredBy: boardItem.namedRequiredBy.slice(0, 20),
    };
  }

  statistics(filter: StatisticsFilter = {}): ProviderModelSummary[] {
    return new StatisticsService(this.store).summarize(filter);
  }

  /** Read-only evidence-aware model-routing advisory.  Derives routing
   *  evidence from terminal Tasks matching the exact taskClass, resolves
   *  the current flexible routing policy, and returns a privacy-safe
   *  advisory with per-candidate factors, uncertainty flags, competition
   *  guidance, and an optional recommendation.  When taskFamily is
   *  provided and exact evidence is insufficient, family evidence is
   *  used as a complete-set fallback.  Never launches work, switches a
   *  Worker, disables a model, mutates settings, retries, commits, or pushes. */
  modelRouting(
    taskClass: string,
    candidates?: Array<{ provider: string; model: string; runtime?: string; effort?: string }>,
    taskFamily?: string,
    competitionIntent?: "none" | "consider" | "required",
    competitionTriggers?: string[],
    workerProfileIds?: string[],
  ): RoutingAdvisoryResponse {
    if (
      typeof taskClass !== "string"
      || taskClass.trim().length === 0
      || taskClass.trim().length > 200
    ) {
      throw new Error("modelRouting requires a taskClass of 1 to 200 characters");
    }
    const settings = this.settings.get();
    const profilePath = workerProfileIds !== undefined;
    if (profilePath && candidates !== undefined) {
      throw new Error("modelRouting accepts exactly one of workerProfileIds or candidates");
    }

    // Resolved candidates always carry runtime+effort; profile-bound rows also
    // carry workerProfileId/workerLabel for identity-preserving output.
    let resolvedCandidates: Array<{
      provider: string;
      model: string;
      runtime?: string;
      effort?: string;
      workerProfileId?: string;
      workerLabel?: string;
    }>;
    let fullIdentity: boolean;
    if (profilePath) {
      resolvedCandidates = resolveProfileRoutingCandidates(workerProfileIds, {
        workerProfiles: settings.workerProfiles,
        modelCatalog: settings.modelCatalog,
        providerDefaults: settings.providerDefaults,
        defaultEffort: settings.execution.defaultEffort,
      });
      fullIdentity = true;
    } else {
      if (!Array.isArray(candidates) || candidates.length < 2 || candidates.length > 10) {
        throw new Error("modelRouting requires 2 to 10 provider/model candidates");
      }
      const seen = new Set<string>();
      const identityModes = new Set<"legacy" | "full" | "partial">();
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
        const hasRuntime = typeof c.runtime === "string" && c.runtime.trim().length > 0;
        const hasEffort = typeof c.effort === "string" && c.effort.trim().length > 0;
        identityModes.add(hasRuntime && hasEffort ? "full" : (!hasRuntime && !hasEffort ? "legacy" : "partial"));
        const key = c.provider.trim() + "\0" + c.model.trim()
          + (hasRuntime && hasEffort ? `\0${c.runtime!.trim()}\0${c.effort!.trim()}` : "");
        if (seen.has(key)) throw new Error("modelRouting candidates must be unique");
        seen.add(key);
      }

      if (identityModes.has("partial") || identityModes.size !== 1) {
        throw new Error("modelRouting candidates must either all include runtime and effort, or all omit both for legacy comparison");
      }
      fullIdentity = identityModes.has("full");
      resolvedCandidates = candidates.map((c) => ({
        provider: c.provider.trim(),
        model: c.model.trim(),
        ...(c.runtime !== undefined ? { runtime: c.runtime.trim() } : {}),
        ...(c.effort !== undefined ? { effort: c.effort.trim() } : {}),
      }));
    }

    const stats = new StatisticsService(this.store);
    const identityMode = fullIdentity ? "full-worker" : "provider-model";
    const evidenceMap = stats.routingEvidence(taskClass.trim(), identityMode);
    const policy: RoutingPolicySettings = {
      minRelevantSamples: settings.modelRouting.minRelevantSamples,
      familyMinRelevantSamples: settings.modelRouting.familyMinRelevantSamples,
      uncertaintyThreshold: settings.modelRouting.uncertaintyThreshold,
      competitionOnUncertainty: settings.modelRouting.competitionOnUncertainty,
      competitionTriggersEnabled: [...settings.modelRouting.competitionTriggersEnabled],
      defaultCompetitionCandidates: settings.modelRouting.defaultCompetitionCandidates,
      missingEvidenceMode: settings.modelRouting.missingEvidenceMode,
      weights: {
        acceptedDelivery: settings.modelRouting.weights.acceptedDelivery,
        verifiedBehavior: settings.modelRouting.weights.verifiedBehavior,
        modelQualityFailure: settings.modelRouting.weights.modelQualityFailure,
        correctionChurn: settings.modelRouting.weights.correctionChurn,
        firstPassSuccess: settings.modelRouting.weights.firstPassSuccess ?? 0.5,
        officialCost: settings.modelRouting.weights.officialCost,
        duration: settings.modelRouting.weights.duration,
        budgetReliability: settings.modelRouting.weights.budgetReliability ?? 0,
      },
    };

    // Validate and normalize competition triggers
    const VALID_TRIGGERS = new Set(["critical", "multiple-plausible-solutions", "new-family", "user-requested"]);
    if (competitionTriggers?.some((trigger) => !VALID_TRIGGERS.has(trigger as CompetitionTrigger))) {
      throw new Error("competitionTriggers contains an unsupported Main reason");
    }
    const normalizedTriggers = competitionTriggers as CompetitionTrigger[] | undefined;
    if (competitionIntent !== undefined
      && competitionIntent !== "none"
      && competitionIntent !== "consider"
      && competitionIntent !== "required") {
      throw new Error("competitionIntent must be none, consider, or required");
    }
    const normalizedIntent = competitionIntent === "none" || competitionIntent === "consider" || competitionIntent === "required"
      ? competitionIntent
      : undefined;

    // Derive family evidence when taskFamily is provided
    const familyEvidenceMap = taskFamily !== undefined && taskFamily.trim().length > 0
      ? stats.routingEvidenceByFamily(taskFamily.trim(), identityMode)
      : undefined;

    const adviceInput: Parameters<typeof provideRoutingAdvice>[0] = {
      taskClass: taskClass.trim(),
      candidates: resolvedCandidates,
      evidenceMap,
      policy,
    };
    if (taskFamily !== undefined && taskFamily.trim().length > 0) {
      adviceInput.taskFamily = taskFamily.trim();
    }
    if (familyEvidenceMap !== undefined) {
      adviceInput.familyEvidenceMap = familyEvidenceMap;
    }
    if (normalizedIntent !== undefined) {
      adviceInput.competitionIntent = normalizedIntent;
    }
    if (normalizedTriggers !== undefined) {
      adviceInput.competitionTriggers = normalizedTriggers;
    }
    return provideRoutingAdvice(adviceInput);
  }

  /** Return a detached deeply-frozen portfolio economics summary for all
   *  terminal Tasks matching the optional provider/model/time filter.
   *  Never reads legacy costUsd, never combines currencies, never calls
   *  a Provider, and never mutates state. */
  economicsSummary(filter: StatisticsFilter = {}): PortfolioEconomicsSummary {
    return getPortfolioEconomicsSummary(this.store, filter);
  }

  /** Read-only portfolio coverage of classification + Main-authored
   *  Worker-selection evidence on terminal ordinary Tasks. Never mutates,
   *  never calls a Provider, never scores a model, and never counts Review
   *  Graph reviewer Tasks as implementation samples. */
  routingEvidenceCoverage(): RoutingEvidenceCoverage {
    return new StatisticsService(this.store).routingEvidenceCoverage();
  }

  /**
   * Canonical consecutive self-upgrade streak evidence. Read-only:
   * never starts Integration, never mutates state, never loads command
   * streams or Provider data. Only durable results whose receipt names the
   * exact forklight-self-upgrade delivery profile enter the streak window.
   */
  selfUpgradeEvidence(required?: number): SelfUpgradeEvidenceProjection {
    const requiredCount = parseRequiredStreakCount(required);
    const results = this.store.listRecentSelfUpgradeIntegrationResults(
      SELF_UPGRADE_RESULT_WINDOW,
    );
    return computeSelfUpgradeEvidence(results, requiredCount);
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
    const next = this.settings.update(patch);
    // Provider-default-dependent readiness must not outlive a defaults change.
    if (Object.prototype.hasOwnProperty.call(patch, "providerDefaults")) {
      this.healthEnvironment.invalidate();
    }
    return next;
  }

  resetSettings(): ForkLightSettings {
    // Reset restores Provider defaults; drop any readiness derived from the old ones.
    this.healthEnvironment.invalidate();
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
    const competitionId = this.store.getCompetitionByCandidateTaskId(taskId);
    let competitionContext: Record<string, unknown> | undefined;
    if (competitionId !== undefined) {
      const status = this.competitionStatus(competitionId);
      const competition = status.competition as CompetitionRecord;
      const candidates = status.candidates as Array<Record<string, unknown>>;
      const candidate = candidates.find((entry) => entry.taskId === taskId);
      competitionContext = {
        competitionId,
        name: competition.name,
        legacy: competition.legacy === true,
        ...(competition.reason === undefined ? {} : { reason: competition.reason }),
        ...(candidate === undefined ? {} : { candidate }),
        candidates,
        machineComparison: status.machineComparison,
        ...(status.mainDecision === undefined ? {} : { mainDecision: status.mainDecision }),
        mainDecisionCurrent: status.mainDecisionCurrent === true,
        ...(status.retainedPartial === undefined ? {} : { retainedPartial: status.retainedPartial }),
        ...(status.finalChoice === undefined ? {} : { finalChoice: status.finalChoice }),
        nextAction: status.nextAction,
      };
    }
    const reviewGraph = getReviewGraphStatus(this.store, taskId);
    const attentionResolution = latestTaskResolutionState(events);
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
      ...(competitionContext === undefined ? {} : { competitionContext }),
      ...(reviewGraph === undefined ? {} : { reviewGraph }),
      // Latest explicit Main attention resolution from durable events. Only
      // failed/interrupted Tasks project it; forged evidence fails open.
      ...(attentionResolution.status === "none"
        || (task.status !== "failed" && task.status !== "interrupted")
        ? {}
        : { attentionResolution }),
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
        // Integration apply (with or without activation) is Goal gate evidence.
        this.reconcileGoalsForTask(taskId);
        this.reconcilePlans();
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
    this.reconcileGoalsForTask(taskId);
    this.reconcilePlans();
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

  /**
   * Project providerVerification for health without a second Keychain or
   * local-sign-in inspection. Persisted probe evidence and live model/endpoint
   * Settings are read fresh; authentication readiness comes only from the
   * cached environment snapshot. Never probes a Provider network endpoint.
   */
  private safeVerificationSnapshotFromAuth(
    providers: Readonly<Record<ProviderName, ProviderReadiness>>,
  ): Record<ProviderName, Omit<ProviderStatus, "keychainExists">> {
    const settings = this.settings.get();
    const policy = this.probeService.probePolicy();
    const nowMs = realClock();
    const result = {} as Record<ProviderName, Omit<ProviderStatus, "keychainExists">>;
    for (const name of providerNames()) {
      const readiness = providers[name];
      const config = resolveProvider(name, {}, settings.providerDefaults[name]);
      const evidence = this.store.getProbeEvidence(name);
      let status = deriveProviderHealthStatus(
        readiness.ready,
        evidence ?? null,
        config.model,
        new URL(config.endpoint).origin,
        policy.cacheLifetimeMs,
        nowMs,
      );
      if (name === "xai") {
        status = normalizeProbeStatusWithLocalSignIn(
          status,
          evidence,
          readiness.authMode === "local-sign-in",
        );
      }
      result[name] = {
        provider: name,
        model: config.model,
        status,
        ...(evidence === undefined ? {} : { evidence }),
      };
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
    // Graceful restart continuity: a durable restart-continuation grant binds
    // one system (or handoff) recovery Attempt outside quality-retry budgets.
    // Only pending restart-recovery grants that revalidate against the exact
    // interrupted Attempt and scope auto-queue; ordinary stop leaves
    // interrupted Tasks for Main without inventing success or a new Task.
    for (const task of this.store.listTasks(["failed", "interrupted"])) {
      if (this.active.has(task.id) || this.queue.some((job) => job.taskId === task.id)) continue;
      const exec = this.settings.get().execution;
      const baseMaxAttempts = task.effectivePolicy?.values.baseMaxAttempts ?? exec.maxAttempts;
      let restartPending: ReturnType<typeof resolvePendingRestartRecoveryGrant>;
      try {
        restartPending = resolvePendingRestartRecoveryGrant(
          this.store,
          task.id,
          baseMaxAttempts,
        );
      } catch {
        // Corrupt history: one content-free skip event; unrelated Tasks continue.
        noteRestartContinuationSkipped(
          this.store,
          task.id,
          "corrupt-history",
          task.currentAttemptId,
        );
        continue;
      }
      if (restartPending === null) continue;
      this.enqueue({
        taskId: task.id,
        resuming: true,
        executionOptions: restartPending,
      }, true);
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
    // Cross-Worker handoff: finish authorized/preparing materialization once,
    // then queue the same prepared successor without creating a second handoff.
    try {
      const handoffRecovery = await recoverCandidateHandoffs(this.store);
      for (const taskId of handoffRecovery.queueTaskIds) {
        if (this.active.has(taskId) || this.queue.some((job) => job.taskId === taskId)) continue;
        const task = this.store.getTask(taskId);
        const attemptCount = this.store.listAttempts(taskId).length;
        const baseMaxAttempts = task.effectivePolicy?.values.baseMaxAttempts
          ?? this.settings.get().execution.maxAttempts;
        const maxExtraAttempts = task.effectivePolicy?.values.maxExtraAttempts
          ?? this.settings.get().execution.maxExtraAttempts;
        const recoveryOptions = resolvePendingGrantExecutionOptions(
          this.store,
          taskId,
          baseMaxAttempts,
          maxExtraAttempts,
        );
        this.enqueue({
          taskId,
          resuming: attemptCount > 0,
          ...(recoveryOptions === null ? {} : { executionOptions: recoveryOptions }),
        }, true);
        recovered.push(taskId);
      }
    } catch {
      // Corrupt handoff evidence remains inspectable; unrelated recovery continues.
    }
    this.reconcilePlans();
    // Reconcile any running competitions whose candidates are now all terminal
    for (const comp of this.store.listCompetitions("running")) {
      new CompetitionCoordinator(this.store, this.settings).reconcile(comp.id);
    }
    // Re-queue stranded read-only reviewer Tasks that were durably registered
    // but not yet running when the daemon stopped.
    for (const task of this.store.listTasks(["queued"])) {
      if (this.store.getReviewAssignmentByReviewerTaskId(task.id) === undefined) continue;
      if (this.active.has(task.id) || this.queue.some((job) => job.taskId === task.id)) continue;
      this.enqueue({ taskId: task.id, resuming: false }, true);
      recovered.push(task.id);
    }
    // Turn terminal reviewer resultText into validated evidence exactly once.
    reconcileAllReviewGraphs(this.store);
    this.recoverIntegrationOperations();
    // Reconstruct Goal supervision from durable records without duplicating work.
    for (const goal of this.store.listGoals(100)) {
      this.reconcileGoal(goal.id);
    }
    return recovered;
  }

  /**
   * Graceful coordinator shutdown. Intent defaults to stop.
   * On restart, after active Workers settle interrupted, persist at most one
   * restart-continuation grant per eligible Task (before Store close).
   * Stop never records continuation authority.
   */
  async shutdown(intent: DaemonShutdownIntent = "stop"): Promise<void> {
    this.closing = true;
    const activeAtShutdown = [...this.active.keys()];
    for (const taskId of activeAtShutdown) {
      const task = this.store.getTask(taskId);
      if (task.workerPid !== undefined && processExists(task.workerPid) && looksLikeWorker(task.workerPid)) {
        process.kill(task.workerPid, "SIGINT");
      }
    }
    await Promise.allSettled(this.active.values());
    await Promise.allSettled(this.activeIntegrations.values());
    // Bind only after truthful Attempt settlement: grants require the latest
    // Attempt to already be interrupted and pre-verification.
    if (intent === "restart") {
      recordRestartContinuationsForTasks(
        this.store,
        activeAtShutdown,
        (taskId) => {
          const task = this.store.getTask(taskId);
          return task.effectivePolicy?.values.baseMaxAttempts
            ?? this.settings.get().execution.maxAttempts;
        },
      );
    }
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
    amendment?: import("../core/types.js").RemediationAcceptanceAmendment,
  ): Promise<RemediationVerifyView> {
    const verificationTimeoutMs = this.settings.get().integration.verificationTimeoutMs;
    const result = await verifyMainRemediation(
      this.store,
      {
        taskId,
        reason,
        confirm,
        ...(amendment === undefined ? {} : { amendment }),
      },
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

  /** Explicitly assign 1–3 saved Worker Profiles as independent read-only judges
   *  for the current exact Candidate Revision. Registers all reviewer Tasks
   *  durably before queueing. Idempotent for the same revision + ordered set.
   *  One multi-judge graph consumes one Goal review round. */
  async createReviewGraph(input: {
    taskId: string;
    reviewerWorkerProfileId?: string;
    reviewerWorkerProfileIds?: string[];
    reason: string;
    confirm: true;
  }): Promise<{
    graph: ReviewGraphView;
    reviewerTaskId: string;
    reviewerTaskIds: string[];
    created: boolean;
  }> {
    if (input.confirm !== true) throw new Error("review graph requires confirm: true");
    if (this.closing) throw new Error("ForkLight daemon is shutting down");
    // Goal-level review cap rejects before any durable mutation.
    const goalForReviewCap = this.store.getGoalByTaskId(input.taskId);
    if (goalForReviewCap !== undefined) {
      try {
        assertGoalReviewAllowed(goalForReviewCap);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/review cap/i.test(message)) {
          markGoalCapReached(this.store, goalForReviewCap.id, "review-cap");
        }
        throw error;
      }
    }
    const result = await createReviewGraph(this.store, this.settings.get(), {
      candidateTaskId: input.taskId,
      ...(input.reviewerWorkerProfileIds === undefined
        ? {}
        : { reviewerWorkerProfileIds: input.reviewerWorkerProfileIds }),
      ...(input.reviewerWorkerProfileId === undefined
        ? {}
        : { reviewerWorkerProfileId: input.reviewerWorkerProfileId }),
      reason: input.reason,
      confirm: true,
    });
    if (result.created) {
      if (goalForReviewCap !== undefined) {
        const now = timestamp();
        const goal = this.store.getGoal(goalForReviewCap.id);
        this.store.saveGoal({
          ...goal,
          counters: {
            ...goal.counters,
            reviewRounds: goal.counters.reviewRounds + 1,
          },
          updatedAt: now,
        }, this.store.getGoalMilestones(goal.id));
      }
      // Queue only after durable registration of every assignment/task.
      for (const reviewerTaskId of result.reviewerTaskIds) {
        try {
          this.queueTask(reviewerTaskId);
        } catch {
          // Durable registration survives; recovery will re-queue.
          this.store.addEvent(
            reviewerTaskId,
            undefined,
            "task.ready",
            "Reviewer Task persisted and will be recovered from the durable queue",
          );
        }
      }
    } else {
      // Resume any existing non-terminal reviewer Task that was stranded.
      for (const reviewerTaskId of result.reviewerTaskIds) {
        const reviewer = this.store.getTask(reviewerTaskId);
        if (
          (reviewer.status === "queued" || reviewer.status === "interrupted")
          && !this.active.has(reviewer.id)
          && !this.queue.some((job) => job.taskId === reviewer.id)
        ) {
          this.enqueue({
            taskId: reviewer.id,
            resuming: reviewer.status === "interrupted",
          }, true);
        } else {
          // Still reconcile terminal evidence if the Task already finished.
          reconcileReviewGraphForTask(this.store, reviewerTaskId);
        }
      }
    }
    const graph = getReviewGraphStatus(this.store, input.taskId);
    if (graph === undefined) {
      throw new Error("review graph status missing after create");
    }
    return {
      graph,
      reviewerTaskId: result.reviewerTaskId,
      reviewerTaskIds: result.reviewerTaskIds,
      created: result.created,
    };
  }

  /** Privacy-safe Review Graph status for a Candidate Task. Reconciles terminal
   *  reviewer evidence first. Never exposes private packet or raw result text. */
  reviewGraphStatus(taskId: string): ReviewGraphView | undefined {
    this.store.getTask(taskId);
    return getReviewGraphStatus(this.store, taskId);
  }

  /** Authorize and execute one bounded candidate reverification. Never enters a
   *  crash-recoverable Worker state. Failed path: on pass the Task moves to
   *  "succeeded" while the Attempt is preserved. Succeeded+Main-revise path:
   *  Task and Attempt status are preserved on both pass and failure. A fresh
   *  Main accept is always required before Integration. Requires no
   *  running/queued Worker job. */
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
    const priorStatus = task.status;
    const maxMainReverifications = maxMainReverificationsFromSnapshot(task.effectivePolicy);
    const result = await reverifyCandidate(
      this.store,
      { taskId, reason, confirm },
      maxMainReverifications,
      verificationTimeoutMs,
    );
    const finalTask = this.store.getTask(taskId);
    // A successful reverification that newly moves a failed plan prerequisite
    // to succeeded does not go through the normal Worker completion path.
    // Reconcile immediately so waiting/blocked dependents are not stranded
    // until an unrelated event or daemon restart happens to wake them.
    // Succeeded-path reverifications keep the prior status and need no wake.
    if (priorStatus !== "succeeded" && finalTask.status === "succeeded") {
      this.reconcileGoalsForTask(taskId);
      this.reconcilePlans();
    }
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
    const itemStatuses = this.store.getPlanItemStatuses(item.planId);
    const statuses = new Map(
      itemStatuses.map((status) => [status.itemId, status.taskStatus]),
    );
    const statusByItem = new Map(itemStatuses.map((status) => [status.itemId, status]));
    // Goal-supervised Plans combine ordinary readiness with milestone gates.
    // Non-Goal Plans omit gateSatisfaction so behavior stays byte-compatible.
    const goal = this.store.getGoalByPlanId(item.planId);
    let gateSatisfaction: Map<string, boolean> | undefined;
    // Goal-supervised Plans use effective Task status (handoff successor when
    // authoritative) so a failed source does not permanently block downstream
    // after a successful successor completes the milestone gate.
    const effectiveStatuses = new Map<string, TaskStatus | undefined>(
      dependencyIds.map((dependencyId) => [dependencyId, statuses.get(dependencyId)]),
    );
    if (goal !== undefined) {
      gateSatisfaction = new Map();
      for (const dependencyId of dependencyIds) {
        const milestone = this.store.getGoalMilestone(goal.id, dependencyId);
        const dep = statusByItem.get(dependencyId);
        if (milestone === undefined) {
          // Machine-only fallback when milestone row is missing (should not happen).
          gateSatisfaction.set(dependencyId, dep?.taskStatus === "succeeded");
          continue;
        }
        const lineage = resolveEffectiveMilestoneLineage(this.store, milestone);
        if (lineage.effectiveTask?.status !== undefined) {
          effectiveStatuses.set(dependencyId, lineage.effectiveTask.status);
        }
        const evidence = evaluateMilestoneGate(
          this.store,
          milestone.gate,
          lineage.effectiveTaskId ?? dep?.taskId ?? milestone.taskId,
          lineage.effectiveTask?.status ?? dep?.taskStatus,
        );
        gateSatisfaction.set(dependencyId, evidence.satisfied);
      }
    }
    return {
      ...item,
      decision: resolveReadiness(
        item.itemId,
        dependencyIds,
        effectiveStatuses,
        gateSatisfaction,
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
      // Stopped/failed/completed Goals block future Task admission only.
      const goal = this.store.getGoalByTaskId(job.taskId);
      if (goalAdmissionBlocked(goal)) {
        const task = this.store.getTask(job.taskId);
        if (task.status === "queued" || task.status === "waiting" || task.status === "blocked") {
          const detail = goal?.reasonCode === "main-stop"
            ? "Goal stopped; future Task admission is blocked"
            : `Goal ${goal?.status ?? "closed"}; future Task admission is blocked`;
          if (task.status !== "waiting" || task.error !== detail) {
            this.store.setTaskStatus(job.taskId, "waiting", { error: detail, finishedAt: null });
            this.store.addEvent(
              job.taskId,
              task.currentAttemptId,
              "task.waiting",
              detail,
              { goalId: goal?.id, reasonCode: goal?.reasonCode },
            );
          }
        }
        return;
      }
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
    // Keep Goal projections current after plan queue decisions.
    for (const goal of this.store.listGoals(100)) {
      this.reconcileGoal(goal.id);
    }
  }

  private reconcileGoal(
    goalId: string,
    options: { fromStatusPoll?: boolean; now?: string } = {},
  ): void {
    // Status polling reconciles projections but must not invent progress:
    // evidence digest only changes from authoritative persisted facts.
    void options.fromStatusPoll;
    const result = reconcileGoalRecords(this.store, goalId, {
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    // Terminal Goals block future admission. Prune queued (not active) jobs
    // on every path that can discover a stop — recovery, status poll, or
    // ordinary plan reconciliation — without killing in-flight Workers.
    if (goalAdmissionBlocked(result.goal)) {
      this.pruneGoalBlockedQueuedJobs();
    }
  }

  private reconcileGoalsForTask(taskId: string): void {
    const goal = this.store.getGoalByTaskId(taskId);
    if (goal === undefined) return;
    this.reconcileGoal(goal.id);
  }

  private reconcileCompetitions(finishedTaskId: string): void {
    const competitionId = this.store.getCompetitionByCandidateTaskId(finishedTaskId);
    if (!competitionId) return;
    const coordinator = new CompetitionCoordinator(this.store, this.settings);
    coordinator.reconcile(competitionId);
  }

  private reconcileReviewGraphs(finishedTaskId: string): void {
    reconcileReviewGraphForTask(this.store, finishedTaskId);
  }

  /**
   * Remove queued (not active) jobs whose Goal has become terminal. Active
   * Workers are deliberately untouched; this is future-admission control.
   */
  private pruneGoalBlockedQueuedJobs(): void {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const job = this.queue[index]!;
      const goal = this.store.getGoalByTaskId(job.taskId);
      if (!goalAdmissionBlocked(goal)) continue;
      this.queue.splice(index, 1);
      const task = this.store.getTask(job.taskId);
      if (!["queued", "waiting", "blocked"].includes(task.status)) continue;
      const detail = goal?.reasonCode === "main-stop"
        ? "Goal stopped; future Task admission is blocked"
        : `Goal ${goal?.status ?? "closed"}; future Task admission is blocked`;
      if (task.status === "waiting" && task.error === detail) continue;
      this.store.setTaskStatus(job.taskId, "waiting", { error: detail, finishedAt: null });
      this.store.addEvent(
        job.taskId,
        task.currentAttemptId,
        "task.waiting",
        detail,
        { goalId: goal?.id, reasonCode: goal?.reasonCode },
      );
    }
  }

  /**
   * Release one Task's Profile Worker occupancy exactly once and immediately
   * reconsider the queue. Idempotent: a second call is a no-op. Does not remove
   * the Task from the full-lifecycle `active` set (verification may continue).
   */
  private releaseProfileWorkerOccupancy(taskId: string): void {
    if (!this.profileWorkerOccupancy.delete(taskId)) return;
    this.pump();
  }

  private pump(): void {
    this.pruneGoalBlockedQueuedJobs();
    const globalCap = this.maxConcurrencyOverride ?? this.settings.get().execution.maxConcurrency;
    // Global in-flight cap still counts full Task lifecycle (active), including
    // Tasks that have released their Profile Worker slot and are verifying.
    while (!this.closing && this.active.size < globalCap && this.queue.length > 0) {
      // Find the next eligible job respecting per-profile Worker occupancy caps
      let jobIndex = -1;
      for (let i = 0; i < this.queue.length; i += 1) {
        const candidate = this.queue[i]!;
        try {
          const task = this.store.getTask(candidate.taskId);
          const profileConcurrency = task.effectivePolicy?.values.maxConcurrency ?? globalCap;
          const cap = Math.min(profileConcurrency, globalCap);
          // Count only Tasks that still occupy a Worker Profile slot — not
          // Tasks that are only verifying after the model process returned.
          let profileOccupied = 0;
          for (const occupiedTaskId of this.profileWorkerOccupancy) {
            try {
              const occupiedTask = this.store.getTask(occupiedTaskId);
              if (occupiedTask.effectivePolicy?.profileId === task.effectivePolicy?.profileId) {
                profileOccupied += 1;
              }
            } catch {
              // Occupied task may have been removed; skip
            }
          }
          if (profileOccupied < cap) {
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
      // Record Profile occupancy at admission (covers preparation and pre-Worker
      // gates). Released after runtime returns, or idempotently in job finally.
      this.profileWorkerOccupancy.add(job.taskId);
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
          // Idempotent cleanup: covers auth/prep failures that never reached the
          // Worker-return release hook, and double-releases after early notify.
          this.profileWorkerOccupancy.delete(job.taskId);
          this.reconcileGoalsForTask(job.taskId);
          this.reconcilePlans();
          this.reconcileCompetitions(job.taskId);
          this.reconcileReviewGraphs(job.taskId);
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
    // Non-authoritative: notify scheduler that the model process no longer
    // occupies this Profile slot. Safe to call more than once.
    const onWorkerProfileSlotRelease = (): void => {
      this.releaseProfileWorkerOccupancy(job.taskId);
    };

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
        onWorkerProfileSlotRelease,
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
        onWorkerProfileSlotRelease,
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
        onWorkerProfileSlotRelease,
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
      await executeAttempt(
        this.store,
        currentTask,
        false,
        undefined,
        undefined,
        exec,
        settings.providerDefaults,
        undefined,
        onWorkerProfileSlotRelease,
      );
    }
  }

  // --- Main-direct execution decisions ---

  /** Start a Main-direct execution decision. Validates input, resolves
   *  considered Worker snapshots and evidence, then persists an immutable
   *  open record. Never creates a Task, launches a Worker, or probes a Provider. */
  async mainDirectStart(params: Record<string, unknown>): Promise<MainDirectDecisionProjection> {
    const input: MainDirectStartInput = {
      taskClass: (() => {
        const v = params.taskClass;
        if (typeof v !== "string" || v.trim().length === 0 || v.trim().length > 80) {
          throw new Error("taskClass must be 1-80 characters");
        }
        return v.trim();
      })(),
      ...(params.taskFamily === undefined ? {} : {
        taskFamily: (() => {
          const v = params.taskFamily;
          if (typeof v !== "string" || v.trim().length === 0 || v.trim().length > 80) {
            throw new Error("taskFamily must be 1-80 characters");
          }
          return v.trim();
        })(),
      }),
      reason: (() => {
        const v = params.reason;
        if (typeof v !== "string") throw new Error("reason must be a valid Main-direct reason code");
        return v as MainDirectStartInput["reason"];
      })(),
      note: (() => {
        const v = params.note;
        if (typeof v !== "string" || v.trim().length === 0 || v.length > 300) {
          throw new Error("note must be 1-300 characters");
        }
        return v.trim();
      })(),
      consideredWorkerProfileIds: (() => {
        const v = params.consideredWorkerProfileIds;
        if (!Array.isArray(v)) throw new Error("consideredWorkerProfileIds must be an array");
        return v as string[];
      })(),
      confirm: params.confirm === true ? true as const : (() => {
        throw new Error("main_direct_start requires explicit confirm: true");
      })(),
    };

    const settings = this.settings.get();
    const ready = providerReadiness(settings.providerDefaults, this.providerAuthInspector);
    const providers = ready.providers;
    const runtimes: MainDirectStartContext["runtimes"] = {};
    for (const adapter of listWorkerAdapters()) {
      try {
        const result = await adapter.doctor();
        runtimes[adapter.name] = { ok: result.ok };
      } catch {
        runtimes[adapter.name] = { ok: false };
      }
    }
    const context: MainDirectStartContext = {
      workerProfiles: settings.workerProfiles,
      ...(settings.modelCatalog === undefined ? {} : { modelCatalog: settings.modelCatalog }),
      providerDefaults: settings.providerDefaults,
      providers,
      runtimes,
    };

    const statsService = new StatisticsService(this.store);
    context.routingEvidence = {
      exact: statsService.routingEvidence(input.taskClass.trim(), "full-worker"),
      ...(input.taskFamily === undefined ? {} : {
        family: statsService.routingEvidenceByFamily(input.taskFamily, "full-worker"),
      }),
      minRelevantSamples: settings.modelRouting.minRelevantSamples,
      familyMinRelevantSamples: settings.modelRouting.familyMinRelevantSamples,
    };
    const { consideredWorkers, evidenceSnapshot } = validateMainDirectStart(input, context);
    const record = createMainDirectDecision(input, consideredWorkers, evidenceSnapshot);
    this.store.saveMainDirectDecision(record);
    return projectMainDirectDecision(record);
  }

  /** Close a Main-direct execution decision. Idempotent: identical replay
   *  returns the existing result; conflicting replay fails without mutation. */
  mainDirectComplete(params: Record<string, unknown>): MainDirectDecisionProjection {
    const id = (() => {
      const v = params.id;
      if (typeof v !== "string" || v.trim().length === 0) throw new Error("id is required");
      return v.trim();
    })();
    const outcome = (() => {
      const v = params.outcome;
      if (v !== "completed" && v !== "abandoned") {
        throw new Error("outcome must be completed or abandoned");
      }
      return v;
    })();
    const verification: MainDirectVerification | undefined = params.verification === undefined
      ? undefined
      : (() => {
          const v = params.verification;
          if (v !== "passed" && v !== "failed" && v !== "unavailable") {
            throw new Error("verification must be passed, failed, or unavailable");
          }
          return v as MainDirectVerification;
        })();
    const confirm = params.confirm === true ? true as const : (() => {
      throw new Error("main_direct_complete requires explicit confirm: true");
    })();
    const noteVal = (() => {
      const v = params.note;
      if (typeof v !== "string" || v.trim().length === 0 || v.length > 300) {
        throw new Error("note must be 1-300 characters");
      }
      return v.trim();
    })();
    const input: MainDirectCompleteInput = {
      id,
      outcome,
      ...(verification === undefined ? {} : { verification }),
      note: noteVal,
      confirm,
    };

    const existing = this.store.getMainDirectDecision(input.id);
    if (existing.status !== "open") {
      // Idempotency check: if already closed, verify identical close
      if (existing.closedState) {
        const newClosed = validateMainDirectClose(input, { ...existing, status: "open" as const });
        if (isIdenticalClose(existing.closedState, newClosed)) {
          return projectMainDirectDecision(existing);
        }
      }
      throw new Error(`Decision ${input.id} is already ${existing.status}`);
    }

    const closedState = validateMainDirectClose(input, existing);
    const closed: typeof existing = {
      ...existing,
      status: closedState.outcome as typeof existing.status,
      closedState,
    };
    const result = this.store.closeMainDirectDecision(closed);
    if (result.applied) return projectMainDirectDecision(result.record);
    if (result.record.closedState && isIdenticalClose(result.record.closedState, closedState)) {
      return projectMainDirectDecision(result.record);
    }
    throw new Error(`Decision ${input.id} is already ${result.record.status}`);
  }

  /** Read-only status of one Main-direct decision. */
  mainDirectStatus(id: string): MainDirectDecisionProjection {
    return projectMainDirectDecision(this.store.getMainDirectDecision(id));
  }

  /** Read-only list of all Main-direct decisions. */
  mainDirectList(): MainDirectDecisionProjection[] {
    return projectMainDirectDecisionList(this.store.listMainDirectDecisions());
  }

  /** Read-only aggregate counts. */
  mainDirectAggregate(): MainDirectDecisionAggregate {
    return computeMainDirectAggregate(this.store.listMainDirectDecisions());
  }

  /** Read-only recent entries for Hub Insights. */
  mainDirectRecent(limit?: number): MainDirectDecisionRecentEntry[] {
    return selectMainDirectRecentEntries(
      this.store.listRecentMainDirectDecisions(limit ?? MAIN_DIRECT_RECENT_LIMIT),
    );
  }

  // --- Outcome intake (FL-109D1) ---

  /** Create a pending outcome intake. Records what the user wants to achieve
   *  without deciding the shape and without creating any Task, Plan, Goal,
   *  Worker, or Provider action. */
  createOutcomeIntake(input: unknown): OutcomeIntakeView {
    const normalized = normalizeOutcomeIntakeCreate(input);
    const record = createOutcomeIntakeRecord(normalized, randomUUID());
    this.store.createOutcomeIntake(record);
    return projectOutcomeIntake(record);
  }

  /** Read one outcome intake as a privacy-safe view. Read-only. */
  outcomeIntake(intakeId: string): OutcomeIntakeView {
    return projectOutcomeIntake(this.store.getOutcomeIntake(intakeId));
  }

  /** List pending/current outcome intakes as privacy-safe views. Optional
   *  closed status filter and validated list limit; invalid values fail
   *  closed. Read-only. */
  listOutcomeIntakes(status?: unknown, limit?: unknown): OutcomeIntakeView[] {
    let statuses: Array<"pending" | "proposed" | "created"> | undefined;
    if (status !== undefined) {
      if (status !== "pending" && status !== "proposed" && status !== "created") {
        throw new Error("status must be pending, proposed, or created");
      }
      statuses = [status as "pending" | "proposed" | "created"];
    }
    const safeLimit = normalizeOutcomeIntakeListLimit(limit);
    return this.store.listOutcomeIntakes(statuses, safeLimit).map(projectOutcomeIntake);
  }

  /** Attach or replace one explicit Main proposal. Validates the bound
   *  artifact through the existing Task/Work Plan/Goal loader and quality gate,
   *  then persists validated facts (never raw contract content) with an
   *  optimistic revision match. Returns the privacy-safe intake view plus the
   *  confirmation preview. Never submits the artifact and never creates work. */
  async proposeOutcomeIntake(input: unknown): Promise<{
    intake: OutcomeIntakeView;
    preview: OutcomeIntakeConfirmationPreview;
  }> {
    const proposal = normalizeOutcomeIntakePropose(input);
    const current = this.store.getOutcomeIntake(proposal.intakeId);
    if (current.status === "created") {
      throw new Error("Created outcome intake cannot be re-proposed; create a new intake for new work.");
    }
    if (current.revision !== proposal.expectedRevision) {
      throw new Error(STALE_OUTCOME_INTAKE_REASON);
    }
    const artifact = await this.loadOutcomeIntakeArtifact(proposal.shape, proposal.artifactPath);
    const updated = buildProposedOutcomeIntake(current, proposal, artifact);
    // Atomic optimistic revision check; a concurrent replacement fails closed.
    this.store.updateOutcomeIntake(updated);
    return {
      intake: projectOutcomeIntake(updated),
      preview: buildOutcomeIntakeConfirmationPreview(updated),
    };
  }

  /** Validate one artifact through the existing contract loader for the
   *  selected shape. Reuses the current quality gate; never reimplements it
   *  and never submits the artifact. The returned load carries the full
   *  registration source from the SAME validated bytes that produced the
   *  digest identity, so confirmation can prove digest equality and then
   *  create from the identical load — never a second independent read. */
  private async loadOutcomeIntakeArtifact(
    shape: ProposedShape,
    artifactPath: string,
  ): Promise<LoadedOutcomeIntakeArtifact> {
    const policy = taskPolicy(this.settings.get());
    if (shape === "task") {
      const loaded = await loadTaskSpec(artifactPath, policy);
      if (loaded.spec.version !== 2) {
        throw new Error("Task proposal requires a version-2 Task Contract");
      }
      return {
        facts: {
          shape,
          displayName: loaded.spec.name,
          objective: loaded.spec.contract.outcome,
          taskCount: 1,
        },
        artifactDigest: loaded.taskFileDigest,
        registration: { kind: "task", spec: loaded.spec, taskFile: loaded.taskFile },
      };
    }
    if (shape === "plan") {
      const report = await assertWorkPlan(artifactPath, policy);
      return {
        facts: {
          shape,
          displayName: report.plan.name,
          objective: report.plan.objective,
          taskCount: report.plan.items.length,
          dependencyWaves: report.plan.waves,
        },
        artifactDigest: await outcomeIntakeArtifactGraphDigest(
          artifactPath,
          report.plan.items.map((item) => item.taskFile),
        ),
        registration: { kind: "plan", plan: report.plan },
      };
    }
    const loadedGoal = await assertGoal(artifactPath, policy);
    return {
      facts: {
        shape,
        displayName: loadedGoal.name,
        objective: loadedGoal.objective,
        taskCount: loadedGoal.plan.items.length,
        dependencyWaves: loadedGoal.plan.waves,
      },
      artifactDigest: await outcomeIntakeArtifactGraphDigest(
        artifactPath,
        [
          loadedGoal.planFile,
          ...loadedGoal.plan.items.map((item) => item.taskFile),
        ],
      ),
      registration: { kind: "goal", goal: loadedGoal },
    };
  }

  /** Prepare the exact existing Task/Plan/Goal registration graph from the same
   *  validated load that produced the artifact digest. Never validates one byte
   *  set and registers a later independent read. */
  private prepareOutcomeIntakeRegistration(
    shape: ProposedShape,
    artifact: LoadedOutcomeIntakeArtifact,
    createdAt: string,
  ): OutcomeIntakeRegistrationResult {
    if (shape === "task") {
      if (artifact.registration.kind !== "task") {
        throw new Error("Outcome intake proposal shape mismatch");
      }
      const { taskId, task, creationEvent } = this.prepareTaskRegistration(
        artifact.registration.spec,
        artifact.registration.taskFile,
        createdAt,
      );
      return {
        taskIds: [taskId],
        registrations: [{ task, creationEvent }],
      };
    }
    if (shape === "plan") {
      if (artifact.registration.kind !== "plan") {
        throw new Error("Outcome intake proposal shape mismatch");
      }
      const prepared = this.preparePlanRegistration(artifact.registration.plan, createdAt);
      return {
        taskIds: Object.values(prepared.taskIdsByItemId),
        registrations: prepared.registrations,
        planRecord: prepared.planRecord,
        items: prepared.items,
        dependencies: prepared.dependencies,
        planId: prepared.planRecord.id,
      };
    }
    if (artifact.registration.kind !== "goal") {
      throw new Error("Outcome intake proposal shape mismatch");
    }
    const prepared = this.prepareGoalRegistration(artifact.registration.goal, createdAt);
    return {
      taskIds: Object.values(prepared.taskIdsByItemId),
      registrations: prepared.registrations,
      planRecord: prepared.planRecord,
      items: prepared.items,
      dependencies: prepared.dependencies,
      goal: prepared.goal,
      milestones: prepared.milestones,
      planId: prepared.planRecord.id,
      goalId: prepared.goal.id,
    };
  }

  /**
   * Explicit Main confirmation authority. One proposed intake is revalidated in
   * full (complete artifact graph digest equality) and, only when unchanged,
   * the existing Task/Plan/Goal registration graph plus the intake's durable
   * receipt commit in one database transaction. Work is queued only after the
   * commit. Retries for the same intake and proposal revision return the stored
   * receipt and canonical ids without inserting or queueing anything.
   */
  async confirmOutcomeIntake(input: unknown): Promise<{
    intake: OutcomeIntakeView;
    receipt: OutcomeIntakeConfirmationView;
  }> {
    const normalized = normalizeOutcomeIntakeConfirm(input);
    const intakeId = normalized.intakeId;
    if (this.closing) throw new Error("ForkLight daemon is shutting down");
    if (this.outcomeIntakeConfirmInFlight.has(intakeId)) {
      throw new Error(OUTCOME_INTAKE_CONFIRM_IN_PROGRESS_REASON);
    }
    this.outcomeIntakeConfirmInFlight.add(intakeId);
    try {
      const current = this.store.getOutcomeIntake(intakeId);
      // Exactly-once retry: the same proposal revision already confirmed. The
      // created record revision advanced by one, so idempotency is bound to the
      // durable receipt's proposalRevision — never the created record revision.
      if (current.status === "created") {
        if (current.confirmation === undefined) {
          throw new Error("Outcome intake has no confirmation receipt");
        }
        if (current.confirmation.proposalRevision !== normalized.expectedRevision) {
          throw new Error(STALE_OUTCOME_INTAKE_CONFIRM_REASON);
        }
        return {
          intake: projectOutcomeIntake(current),
          receipt: projectOutcomeIntakeConfirmation(current.confirmation),
        };
      }
      if (current.status !== "proposed" || current.proposal === undefined) {
        throw new Error(OUTCOME_INTAKE_NO_PROPOSAL_REASON);
      }
      if (current.revision !== normalized.expectedRevision) {
        throw new Error(STALE_OUTCOME_INTAKE_CONFIRM_REASON);
      }
      // Re-read and re-validate the complete proposed artifact graph through
      // the existing loaders. Any changed root or referenced contract fails
      // before any mutation or intake change.
      const artifact = await this.loadOutcomeIntakeArtifact(
        current.proposal.shape,
        current.proposal.artifactPath,
      );
      if (artifact.artifactDigest !== current.proposal.artifactDigest) {
        throw new Error(OUTCOME_INTAKE_STALE_ARTIFACT_REASON);
      }
      const confirmedAt = timestamp();
      const registration = this.prepareOutcomeIntakeRegistration(
        current.proposal.shape,
        artifact,
        confirmedAt,
      );
      const receipt = buildOutcomeIntakeConfirmationReceipt({
        intakeId,
        proposalRevision: current.revision,
        artifactDigest: current.proposal.artifactDigest,
        shape: current.proposal.shape,
        taskIds: registration.taskIds,
        ...(registration.planId === undefined ? {} : { planId: registration.planId }),
        ...(registration.goalId === undefined ? {} : { goalId: registration.goalId }),
        confirmedAt,
      });
      const updated = buildCreatedOutcomeIntake(current, receipt, confirmedAt);
      // One SQLite transaction: complete work graph + intake receipt, or none.
      this.store.createOutcomeIntakeConfirmation({
        intakeId,
        expectedRevision: current.revision,
        updatedIntake: updated,
        registrations: registration.registrations,
        ...(registration.planRecord === undefined ? {} : { plan: registration.planRecord }),
        ...(registration.items === undefined ? {} : { items: registration.items }),
        ...(registration.dependencies === undefined
          ? {}
          : { dependencies: registration.dependencies }),
        ...(registration.goal === undefined ? {} : { goal: registration.goal }),
        ...(registration.milestones === undefined
          ? {}
          : { milestones: registration.milestones }),
      });
      // Queue only committed Task ids; restart recovery re-queues if the process
      // ends between the commit and this in-memory admission.
      for (const taskId of registration.taskIds) {
        try {
          this.enqueue({ taskId, resuming: false });
        } catch {
          this.store.addEvent(
            taskId,
            undefined,
            "task.ready",
            "Confirmed work persisted and will be recovered from the durable queue",
          );
        }
      }
      if (registration.goalId !== undefined) {
        this.reconcileGoal(registration.goalId);
      }
      return {
        intake: projectOutcomeIntake(updated),
        receipt: projectOutcomeIntakeConfirmation(receipt),
      };
    } finally {
      this.outcomeIntakeConfirmInFlight.delete(intakeId);
    }
  }
}
