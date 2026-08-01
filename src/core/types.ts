import type { PricingUnavailableReason } from "./pricing.js";
import type { QuotedCost, UnavailableCost } from "./pricing-calculator.js";
import type { RuntimeName } from "./runtime-names.js";

export type TaskStatus =
  | "queued"
  | "waiting"
  | "blocked"
  | "preparing"
  | "running"
  | "verifying"
  | "succeeded"
  | "failed"
  | "interrupted";

export type AttemptStatus = "running" | "succeeded" | "failed" | "interrupted";
export type RuntimeBudgetEnforcement = "supported" | "partial" | "unsupported";

export type EventType =
  | "task.created"
  | "task.launch-preflight.failed"
  | "task.waiting"
  | "task.blocked"
  | "task.ready"
  | "workspace.preparation.stage"
  | "workspace.prepared"
  | "worker.started"
  | "worker.resumed"
  | "worker.tool.started"
  | "worker.tool.completed"
  | "worker.message"
  | "worker.completed"
  | "worker.failed"
  | "worker.interrupted"
  | "verification.started"
  | "verification.command.completed"
  | "verification.completed"
  | "checkpoint.started"
  | "checkpoint.completed"
  | "checkpoint.skipped"
  | "attempt.authorization.granted"
  | "main-review.completed"
  | "main.failure-attribution.recorded"
  | "competition.main-decision.completed"
  | "competition.retained-partial.completed"
  | "candidate.handoff.authorized"
  | "candidate.handoff.prepared"
  | "candidate.handoff.failed"
  | "integration.preflight.completed"
  | "integration.operation.started"
  | "integration.operation.recovered"
  | "integration.stage.completed"
  | "integration.apply.started"
  | "integration.apply.completed"
  | "integration.rollback.completed"
  | "integration.handoff.authorized"
  | "task.revise.requested"
  | "policy.duration.exceeded"
  | "policy.token.exceeded"
  | "policy.noprogress.exceeded"
  | "policy.size.exceeded"
  | "task.adaptation.transitioned"
  | "task.adaptation.rejected"
  | "remediation.check.started"
  | "remediation.check.completed"
  | "candidate.revision.captured"
  | "candidate.revision.capture.failed"
  | "candidate.reverification.authorized"
  | "candidate.reverification.started"
  | "candidate.reverification.completed"
  | "review.assignment.created"
  | "review.assignment.completed"
  | "review.assignment.failed";

export interface ProviderSpec {
  name: "deepseek" | "qwen" | "minimax" | "glm" | "volcengine" | "xai";
  model: string;
  endpoint?: string;
  /** Explicit billing route — never forwarded to Worker environment or persisted as a credential. */
  pricingRoute?: string;
  keychainService: string;
  keychainAccount?: string;
}

export interface RuntimeSpec {
  name: RuntimeName;
  executable: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxBudgetUsd: number | null;
}

export interface DeliverySpec {
  buildCommands: string[];
  activationCommands: string[];
  activationCheckCommands: string[];
}

/** Persistent delivery resolution provenance snapshot.
 *  Presence means delivery was resolved at Task creation;
 *  absence means no delivery or a legacy stored Task.
 *  Discriminated: inline has no profileId; explicit/project/default require one. */
export type DeliveryResolution =
  | { source: "inline" }
  | { source: "explicit" | "project" | "default"; profileId: string };

export interface TaskModuleContract {
  name: string;
  responsibility: string;
  consumes: string[];
  produces: string[];
  boundaries: string[];
}

export interface TaskScenarioContract {
  name: string;
  given: string;
  when: string;
  then: string;
}

/** A Main-authored explanation for the user, kept separate from the technical
 * execution outcome. ForkLight stores and displays it exactly; it never
 * generates or translates this text. */
export interface TaskPresentation {
  summary: string;
  language: string;
}

export interface TaskContract {
  outcome: string;
  presentation?: TaskPresentation;
  context: string[];
  inScope: string[];
  outOfScope: string[];
  executionSteps: string[];
  deliverables: string[];
  modules: TaskModuleContract[];
  callChain: string[];
  scenarios: TaskScenarioContract[];
  risks: string[];
  changeBudget: {
    maxFiles: number;
    maxDiffLines: number;
  };
}

/** Frozen Worker identity for routing comparison and audit.
 *  provider + model + runtime + effort is the comparable identity.
 *  workerProfileId is provenance only — later settings edits must not rewrite history. */
export interface FrozenWorkerIdentity {
  provider: string;
  model: string;
  runtime: string;
  effort: string;
  /** Worker Profile id that produced this identity at Task creation time.
   *  Absent when the Task was created from legacy provider/model defaults. */
  workerProfileId?: string;
}

/** Immutable Main-written routing decision stored before any Worker starts.
 *  The frozen identity is used for comparison; workerProfileId is provenance only. */
export interface RoutingDecisionSnapshot {
  /** Stable family id for cross-project evidence. Max 80 chars. Explicit only. */
  taskFamily?: string;
  /** Every Worker Main actually considered, frozen by identity. */
  shortlist: FrozenWorkerIdentity[];
  /** The one Worker Main selected to execute this Task. Must match the Task's
   *  provider/runtime spec. */
  selectedWorker: FrozenWorkerIdentity;
  /** Structured Main reason including code and plain-language explanation. */
  selectedBecause: {
    /** Bounded reason code: relevant-delivery, runtime-capability, user-specified,
     *  only-available, main-judgment, or a custom code of ≤40 chars. */
    code: string;
    /** Plain-language explanation of at most 300 characters. */
    note: string;
  };
  /** Main's explicit Competition intent. */
  competition: {
    /** Intent decision: none, consider, or required. */
    intent: "none" | "consider" | "required";
    /** Explicit triggers when intent is consider or required. */
    triggers: CompetitionTrigger[];
  };
  /** Evidence snapshot at Task creation — scope, sample counts, settings. */
  evidenceSnapshot: {
    /** Which evidence scope was used: exact-class, task-family, or none. */
    scope: "exact-class" | "task-family" | "none";
    /** Exact taskClass sample count per candidate at decision time. */
    exactSampleCounts: Record<string, number>;
    /** Family sample count per candidate when scope is task-family. */
    familySampleCounts?: Record<string, number>;
    /** Settings version fingerprint for traceability. Never contains settings values. */
    settingsDigest?: string;
  };
}

/** Trigger reasons for considering or requiring a Competition. */
export type CompetitionTrigger =
  | "critical"
  | "multiple-plausible-solutions"
  | "new-family"
  | "user-requested";

interface SharedTaskSpec {
  name: string;
  project: string;
  provider: ProviderSpec;
  runtime: RuntimeSpec;
  workspace: {
    exclude: string[];
    generatedPaths?: string[];
  };
  worker: {
    allowEdits: boolean;
    allowedCommands: string[];
    focusPaths: string[];
  };
  delivery?: DeliverySpec;
  /** Resolved delivery provenance snapshot.
   *  Absent on legacy stored Tasks and Tasks with no delivery. */
  deliveryResolution?: DeliveryResolution;
  taskClass?: string;
  /** Stable family id for cross-project evidence. Max 80 chars.
   *  Explicit only — never inferred from name or prompt.
   *  Absent on legacy Tasks; never replaces exact taskClass for audit or Direct Codex. */
  taskFamily?: string;
  /** Immutable Main-authored routing decision snapshot frozen at Task creation.
   *  Absent on legacy Tasks. Settings edits must never change this. */
  routingDecision?: RoutingDecisionSnapshot;
  /** Exact direct-Codex execution-profile identity selected by the operator.
   *  Must be a canonical profile id validated by the shared normalizer.
   *  Absent for legacy tasks; never inferred from provider, model, or runtime. */
  directCodexProfileId?: string;
  /** Selected Worker Profile id at Task creation time.
   *  Absent on legacy tasks without a profile selection.
   *  Required for effective policy resolution. */
  workerProfileId?: string;
  /** Task-level advanced-policy override. Absent on legacy tasks.
   *  Resolved at Task creation: Task override > Worker Profile > global defaults. */
  advancedPolicyOverride?: TaskAdvancedPolicyOverride;
  /** Snapped completion policy at Task creation time.
   *  Absent in legacy stored Tasks; runtime code must fall back to hard. */
  completionPolicy?: {
    noChangeMode: PolicyMode;
    /** How changeBudget overruns affect Task success. Defaults to hard when absent. */
    changeBudgetMode?: PolicyMode;
  };
  /** Creation-time snapshot of the Task Contract Quality layer.
   *  Absent only on legacy Task records created before per-Worker Quality policy. */
  qualityPolicy?: EffectiveQualityPolicySnapshot;
}

export interface LegacyTaskSpec extends SharedTaskSpec {
  version: 1;
  goal: string;
  constraints: string[];
  acceptance: {
    commands: string[];
  };
}

export interface ContractTaskSpec extends SharedTaskSpec {
  version: 2;
  contract: TaskContract;
  acceptance: {
    criteria: string[];
    commands: string[];
  };
}

export type TaskSpec = LegacyTaskSpec | ContractTaskSpec;

export interface QualityCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
  /** How this check affects admission under the resolved Quality mode. */
  effect?: QualityCheckEffect;
}

/**
 * A non-blocking wording heuristic hit. Placeholder detection separates
 * structural template sentinels (hard fail) from natural-language terms that
 * may be legitimate domain wording (soft warning with a field location). See
 * FL-D70 / FL-D112: the word `unknown` must not hard-reject a structured
 * contract.
 */
export interface QualityWarning {
  field: string;
  term: string;
  excerpt: string;
}

export interface QualityReport {
  /** Whether every quality check passed. This remains check truth, not admission. */
  passed: boolean;
  /** Whether the Task may be admitted after applying the configured Quality mode. */
  admitted?: boolean;
  score: number;
  /** Resolved Quality enforcement mode. Absent only on legacy reports. */
  mode?: PolicyMode;
  /** Overall admission effect. Absent only on legacy reports. */
  effect?: QualityAdmissionEffect;
  checks: QualityCheck[];
  /** Every failed Quality check, whether blocking or not. */
  issues: string[];
  /** Failed checks that block submission. */
  blockingIssues?: string[];
  /** Failed checks retained as non-blocking review evidence. */
  advisories?: string[];
  warnings: QualityWarning[];
}

export interface TaskPaths {
  root: string;
  baseline: string;
  workspace: string;
  logs: string;
  claudeConfig: string;
  diff: string;
}

export interface TaskRecord {
  id: string;
  name: string;
  status: TaskStatus;
  sourcePath: string;
  taskFile: string;
  spec: TaskSpec;
  paths: TaskPaths;
  sessionId: string;
  currentAttemptId?: string;
  workerPid?: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  /** Immutable effective advanced-policy snapshot stored at Task creation.
   *  Absent on legacy stored Tasks predating advanced-policy snapshots;
   *  runtime code must derive compatible defaults without inventing new ceilings. */
  effectivePolicy?: EffectivePolicySnapshot;
}

export interface AttemptOfficialCostQuoted {
  readonly stage: "calculation";
  readonly quoted: true;
  /** Immutable calculator result — deeply frozen at persistence time. */
  readonly result: QuotedCost;
}

export interface AttemptOfficialCostUsageUnavailable {
  readonly stage: "usage";
  readonly quoted: false;
  readonly reason: "usage-missing" | "service-tier-missing";
}

export interface AttemptOfficialCostIdentityUnavailable {
  readonly stage: "pricing-identity";
  readonly quoted: false;
  readonly reason: PricingUnavailableReason;
}

export interface AttemptOfficialCostCalculationUnavailable {
  readonly stage: "calculation";
  readonly quoted: false;
  /** Immutable unavailable result — deeply frozen at persistence time. */
  readonly result: UnavailableCost;
}

export type AttemptOfficialCost =
  | AttemptOfficialCostQuoted
  | AttemptOfficialCostUsageUnavailable
  | AttemptOfficialCostIdentityUnavailable
  | AttemptOfficialCostCalculationUnavailable;

export interface AttemptRecord {
  id: string;
  taskId: string;
  ordinal: number;
  status: AttemptStatus;
  sessionId: string;
  pid?: number;
  rawLogPath: string;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  costUsd?: number;
  turns?: number;
  resultText?: string;
  error?: string;
  usage?: AttemptTokenUsage;
  runtimeCostEstimateUsd?: number;
  /** Effective Claude runtime budget for this Attempt. Absent only on legacy Attempts. */
  runtimeBudgetUsd?: number | null;
  /** Frozen evidence of whether this Attempt's runtime could enforce the USD
   * budget flag. Absent on legacy Attempts and therefore not assumed. */
  runtimeBudgetEnforcement?: RuntimeBudgetEnforcement;
  officialCost?: AttemptOfficialCost;
}

export interface AttemptAuthorization {
  additionalAttempts: 1;
  maxBudgetUsd: number | null;
  reason: string;
  confirm: true;
}

export interface AttemptExecutionOptions {
  maximumOrdinal: number;
  maxBudgetUsdOverride?: number | null;
  authorizationEventSequence?: number;
}

export type MainReviewDecisionKind = "accept" | "revise" | "reject";

export interface MainReviewDecision {
  decision: MainReviewDecisionKind;
  reason: string;
  attemptId: string;
  verificationEventSequence: number;
  /** Candidate revision id bound when modern revision evidence exists. */
  candidateRevisionId?: string;
  /** SHA-256 patch digest from the bound CandidateRevision (accept/revise/reject). */
  acceptedPatchDigest?: string;
}

export interface DeliveryLineage {
  complete: boolean;
  missingAttemptIds: string[];
  attemptCount: number;
  verifiedAttemptCount: number;
  hopChurn: {
    filesChanged: number;
    changedLines: number;
  };
  combinedDeliveryDiff: {
    filesChanged: number;
    changedLines: number;
  };
  correctionAttemptIds: string[];
}

export interface ModelTokenUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface AttemptTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  serviceTier?: string;
  perModel?: ModelTokenUsage[];
  source: "terminal-result";
  complete: true;
}

export interface StagedTaskRegistration {
  task: TaskRecord;
  creationEvent: {
    summary: string;
    payload?: unknown;
  };
  extraEvents?: Array<{
    type: EventType;
    summary: string;
    payload?: unknown;
  }>;
}

export interface EventRecord {
  id: number;
  taskId: string;
  attemptId?: string;
  sequence: number;
  timestamp: string;
  type: EventType;
  summary: string;
  payload?: unknown;
}

export interface VerificationCommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface SourceCompatibilityResult {
  /** True when every patch-affected path still matches the prepare-time source snapshot. */
  compatible: boolean;
  /** Relative paths touched by baseline→workspace diff. */
  affectedPaths: string[];
  /** Affected paths whose live source bytes differ from the prepare-time snapshot. */
  conflictingPaths: string[];
  /** Source paths that drifted but are outside the patch affected set (audit only). */
  unrelatedDriftPaths: string[];
}

export interface VerificationResult {
  passed: boolean;
  /** Acceptance commands all exited 0. */
  behaviorPassed: boolean;
  /** Change budget (and related policy size gates) satisfied when present. */
  policyPassed: boolean;
  /** Affected-path source compatibility hard gate. */
  sourceCompatible: boolean;
  commands: VerificationCommandResult[];
  diffPath: string;
  /** Classified patch evidence. Absent only on verification records written before Wave 2. */
  patches?: WorkspacePatchReport;
  /** Full-tree source fingerprint equality (audit). Not a hard gate by itself. */
  sourceUnchanged: boolean;
  sourceCompatibility?: SourceCompatibilityResult;
  changeBudget?: {
    filesChanged: number;
    changedLines: number;
    maxFiles: number;
    maxDiffLines: number;
    withinBudget: boolean;
    /** Enforcement mode used for this evaluation. */
    mode?: PolicyMode;
    /** Effect of the mode on this verification (independent of withinBudget). */
    effect?: "satisfied" | "hard-fail" | "warning" | "score-evidence" | "ignored";
  };
  /** Structured completion policy evaluation.
   *  Absent for legacy verification stored before this field was introduced. */
  completionPolicy?: CompletionPolicyCheck;
  /**
   * Present when independent acceptance proves the Task Contract cannot be
   * satisfied under the current boundary. Same-policy retry is forbidden.
   */
  failureCategory?: "contract-infeasible";
  /** Privacy-safe contract-infeasible detail when failureCategory is set. */
  contractInfeasibility?: {
    reason: "undeclared-dependency" | "contradictory-acceptance" | "scope-boundary-conflict";
    summary: string;
  };
}

/** Derived retry guidance from the latest authoritative verification event. */
export interface RemediationPacket {
  verificationEventSequence: number;
  passedChecks: string[];
  failedCommands: VerificationCommandResult[];
  policyFindings: string[];
  sourceConflicts: string[];
  mainReview?: {
    decision: MainReviewDecisionKind;
    reason: string;
  };
}

/** Worker-authored completion text. It is never authoritative verification evidence. */
export interface WorkerClaim {
  label: "unverified-claim";
  text: string;
}

export interface CheckpointRequest {
  taskId: string;
  attemptId: string;
  commandIds?: string[];
}

export interface CheckpointReport {
  authority: "non-authoritative-checkpoint";
  attemptId: string;
  commands: Array<VerificationCommandResult & { commandId: string }>;
  patches: WorkspacePatchReport;
}

export interface PatchEvidence {
  path: string;
  filesChanged: number;
  changedLines: number;
  affectedPaths: string[];
}

export interface WorkspacePatchReport {
  business: PatchEvidence;
  generated: PatchEvidence;
  integration: PatchEvidence;
}

export interface NormalizedWorkerEvent {
  type: EventType;
  summary: string;
  payload?: unknown;
  sessionId?: string;
  terminal?: {
    isError: boolean;
    /** Stable content-free diagnostic when the terminal envelope is an error. */
    failureReason?: string;
    resultText?: string;
    costUsd?: number;
    turns?: number;
    runtimeCostEstimateUsd?: number;
    usage?: AttemptTokenUsage;
  };
}

/** Privacy-safe typed evidence when a policy limit triggers.
 *  Never contains raw prompt, result text, diff content, or credentials. */
export interface PolicyLimitEvidence {
  category: "duration" | "observed-token" | "no-progress" | "file-limit" | "changed-line-limit";
  enforcementPhase: EnforcementPhase;
  /** The configured limit that triggered. null when unlimited (should not fire). */
  configured: number | null;
  /** The observed value that exceeded the limit. */
  observed: number;
  /** How this limit affects the Task: hard-fail, warn, score, or off (no effect). */
  effect: "hard-fail" | "warning" | "score-evidence" | "ignored";
  /** Human-readable detail with no private content. */
  detail: string;
}

export interface PlanRecord {
  id: string;
  name: string;
  objective: string;
  planFile: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlanItemRecord {
  id: string;
  planId: string;
  taskId?: string;
  itemIndex: number;
  taskFile: string;
}

export interface DependencyRecord {
  planId: string;
  itemId: string;
  dependsOnItemId: string;
}

export interface PlanItemStatus {
  itemId: string;
  taskId?: string;
  taskStatus?: TaskStatus;
}

// --- Durable Goal supervision over Plan Tasks ---

/** Evidence required before a Goal milestone unlocks dependents. */
export type GoalMilestoneGate = "machine" | "main-accept" | "integration";

export type GoalStatus =
  | "running"
  | "waiting"
  | "completed"
  | "stopped"
  | "failed";

/** Closed privacy-safe stop/wait reason codes. Never carry private content. */
export type GoalReasonCode =
  | "main-stop"
  | "correction-cap"
  | "review-cap"
  | "no-new-evidence-cap"
  | "duration-exceeded"
  | "no-progress"
  | "milestone-failed"
  | "waiting-machine"
  | "waiting-main-accept"
  | "waiting-integration"
  | "waiting-task"
  | "goal-completed"
  | "none";

export type GoalNextActionCode =
  | "wait-for-worker"
  | "main-accept"
  | "main-review"
  | "integrate"
  | "correct-or-decide"
  | "advance"
  | "stop-or-decide"
  | "none"
  | "resume-task";

/** Frozen Goal orchestration policy. Explicit null means unlimited. */
export interface GoalPolicy {
  maxDurationMs: number | null;
  noProgressTimeoutMs: number | null;
  maxCorrectionRounds: number;
  maxReviewRounds: number;
  maxNoNewEvidenceCycles: number;
}

export interface GoalCounters {
  correctionRounds: number;
  reviewRounds: number;
  noNewEvidenceCycles: number;
}

export interface GoalRecord {
  id: string;
  version: 1;
  name: string;
  objective: string;
  planId: string;
  goalFile: string;
  policy: GoalPolicy;
  status: GoalStatus;
  reasonCode: GoalReasonCode;
  /** Plain-language English wait/stop explanation. */
  reason: string;
  evidenceDigest: string;
  evidenceAt: string;
  counters: GoalCounters;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  stoppedAt?: string;
}

export interface GoalMilestoneRecord {
  goalId: string;
  itemId: string;
  taskId?: string;
  gate: GoalMilestoneGate;
  itemIndex: number;
  satisfied: boolean;
  reasonCode: GoalReasonCode;
  reason: string;
  updatedAt: string;
}

export type CompetitionStatus = "pending" | "running" | "completed";
export type RankingFactor = "verification" | "diffFocus" | "retries" | "cost" | "duration" | "delivery";

export type PolicyMode = "hard" | "warn" | "score" | "off";

// --- Task Contract Quality policy ---

export type QualityCheckEffect =
  | "satisfied"
  | "blocking"
  | "warning"
  | "score-evidence"
  | "ignored";

export type QualityAdmissionEffect =
  | "passed"
  | "blocked"
  | "admitted-with-warnings"
  | "admitted-with-score"
  | "admitted-ignored";

/** Partial per-Worker Quality override. `null` maximums are explicitly
 * unlimited; zero minimums explicitly disable that minimum. */
export interface ContractQualityOverrides {
  mode?: PolicyMode;
  maxFiles?: number | null;
  maxDiffLines?: number | null;
  maxFocusPaths?: number | null;
  minScenarios?: number;
  minCallChainSteps?: number;
  minOutcomeCharacters?: number;
  minModuleResponsibilityCharacters?: number;
}

export interface ResolvedContractQualityValues {
  maxFiles: number | null;
  maxDiffLines: number | null;
  maxFocusPaths: number | null;
  minScenarios: number;
  minCallChainSteps: number;
  minOutcomeCharacters: number;
  minModuleResponsibilityCharacters: number;
}

/** Immutable Quality policy resolved before Task admission and stored with the
 * Task. Runtime/settings changes cannot reinterpret existing work. */
export interface EffectiveQualityPolicySnapshot {
  readonly profileId: string;
  readonly mode: PolicyMode;
  readonly modeSource: ProvenanceSource;
  readonly values: Readonly<ResolvedContractQualityValues>;
  readonly provenance: Readonly<
    Record<keyof ResolvedContractQualityValues, ProvenanceSource>
  >;
}

export interface QualityPolicyPreviewRow {
  field: "mode" | keyof ResolvedContractQualityValues;
  value: PolicyMode | number | null;
  source: ProvenanceSource;
  layer: "quality";
}

// --- Advanced execution policy ---
// Per-Worker Profile advanced policy. Every field is permissive-by-default
// (unlimited duration / Token ceilings) so development is unbrittle.
// null means explicitly unlimited — never replaced with a finite default.

export type EnforcementPhase = "preemptive" | "terminal" | "post-observation" | "unsupported";

export type ProvenanceSource = "task" | "worker" | "global";

export interface AdvancedPolicyFields {
  /** Maximum wall-clock duration in ms for a single Attempt. null = unlimited. */
  maxDurationMs: number | null;
  /** Observed gross Token ceiling. null = unlimited.
   *  Enforced truthfully: terminal/post-observation unless runtime supports preemptive. */
  observedTokenCeiling: number | null;
  /** No-progress timeout in ms. null = unlimited (no watchdog). */
  noProgressTimeoutMs: number | null;
  /** Grace period after SIGINT before SIGTERM in ms. */
  workerStopGraceMs: number;
  /** Business-patch file limit. null = unlimited. */
  fileLimit: number | null;
  /** Enforcement mode for fileLimit overruns. */
  fileLimitMode: PolicyMode;
  /** Business-patch changed-line limit. null = unlimited. */
  changedLineLimit: number | null;
  /** Enforcement mode for changedLineLimit overruns. */
  changedLineLimitMode: PolicyMode;
  /** Base maximum Attempts (before extra-authorization grants). */
  baseMaxAttempts: number;
  /** Maximum additional Attempts beyond baseMaxAttempts that require explicit authorization. */
  maxExtraAttempts: number;
  /** Per-profile concurrency cap. The scheduler intersects it with the live global cap. */
  maxConcurrency: number;
  /** No-change completion policy mode. */
  completionMode: PolicyMode;
  /** Change-budget overrun policy mode. */
  changeBudgetMode: PolicyMode;
  /** Maximum adaptation rounds for the bounded adaptation service (0 = no adaptation). */
  maxAdaptationRounds: number;
  /** Maximum Main-authorized candidate corrections for a failed or interrupted Task.
   *  Independent from maxExtraAttempts; setting maxExtraAttempts zero does not block an allowed correction.
   *  Default 1 (development-friendly); 0 disables. */
  maxMainCorrections: number;
  /** Maximum Main-authorized candidate reverifications for a failed Task whose
   *  latest independent verification failed only behavior acceptance. Reruns the
   *  original acceptance suite against the retained candidate WITHOUT launching
   *  a Worker or creating an Attempt. Independent from maxMainCorrections and
   *  maxExtraAttempts. Default 1; 0 disables. */
  maxMainReverifications: number;
}

/** Task-level per-field override for advanced execution policy.
 *  null for nullable fields means explicitly unlimited (not "use worker default"). */
export interface TaskAdvancedPolicyOverride {
  maxDurationMs?: number | null;
  observedTokenCeiling?: number | null;
  noProgressTimeoutMs?: number | null;
  workerStopGraceMs?: number;
  fileLimit?: number | null;
  fileLimitMode?: PolicyMode;
  changedLineLimit?: number | null;
  changedLineLimitMode?: PolicyMode;
  baseMaxAttempts?: number;
  maxExtraAttempts?: number;
  maxConcurrency?: number;
  completionMode?: PolicyMode;
  changeBudgetMode?: PolicyMode;
  maxAdaptationRounds?: number;
  maxMainCorrections?: number;
  maxMainReverifications?: number;
}

/** Runtime enforcement capability truthfully derived from the Worker adapter.
 *  Never claims preemptive control for a runtime that only measures at completion. */
export interface EnforcementCapability {
  /** How duration limits are enforced by this runtime. */
  durationEnforcement: EnforcementPhase;
  /** How Token limits are enforced by this runtime.
   *  "post-observation" = usage is reported at completion; was never prevented.
   *  "unsupported" = runtime provides no gross Token data. */
  tokenEnforcement: EnforcementPhase;
  /** Whether the runtime supports a live no-progress watchdog. */
  progressWatchdog: "live" | "terminal";
}

/** Immutable effective-policy snapshot stored with the Task at creation.
 *  Later settings edits must not alter queued, running, resumed, revised, or recovered Tasks. */
export interface EffectivePolicySnapshot {
  /** Selected Worker Profile id at Task creation time, or "global" when none was selected. */
  readonly profileId: string;
  /** Resolved effective values for every advanced-policy field. */
  readonly values: Readonly<AdvancedPolicyFields>;
  /** Per-field provenance: which layer supplied the effective value. */
  readonly provenance: Readonly<Record<keyof AdvancedPolicyFields, ProvenanceSource>>;
  /** Truthful enforcement capability for the selected Worker runtime. */
  readonly enforcementCapability: Readonly<EnforcementCapability>;
}

/** Pure preview row for a single policy field — suitable for Hub UI consumption. */
export interface EffectivePolicyPreviewRow {
  field: keyof AdvancedPolicyFields;
  value: number | PolicyMode | null;
  source: ProvenanceSource;
  enforcementPhase: EnforcementPhase;
  unlimited: boolean;
}

export type EffectivePolicyPreview = EffectivePolicyPreviewRow[];

export interface CompletionPolicyCheck {
  /** The evidence outcome and configured effect remain separate. */
  check: "satisfied" | "hard-fail" | "warning" | "score-evidence" | "ignored" | "not-applicable";
  /** The snapped policy mode that produced this outcome. */
  noChangeMode: PolicyMode;
  /** Human-readable evidence for the policy decision. */
  message: string;
}

export interface RankingPolicy {
  weights: Record<RankingFactor, number>;
  tieThreshold: number;
}

export interface CompetitionRecord {
  id: string;
  name: string;
  contractTaskId: string;
  status: CompetitionStatus;
  rankingPolicy: RankingPolicy;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  latestEvaluationId?: string;
  error?: string;
  /** Bounded Main reason this Competition exists. Absent on legacy records
   *  that predate reasoned admission; never inferred or backfilled. */
  reason?: CompetitionReason;
  /** True for legacy explicit CLI/MCP Competition submissions that predate
   *  reasoned admission and full per-candidate identity snapshots. Hub must
   *  report reason/identity unavailable rather than fabricate either. */
  legacy?: boolean;
  /** Competition-level Main decision bound to one exact Candidate Revision.
   *  An explicit derivation of the chosen candidate Task's Main Review - the
   *  Task-level Main Review remains the canonical exact-revision authority. */
  mainDecision?: CompetitionMainDecision;
  /** Bounded retained-partial evidence for non-selected Candidates. Stores
   *  reusable paths and remaining gaps for later M2 handoff; never starts a
   *  retry, successor, or Integration. */
  retainedPartial?: CompetitionRetainedPartial[];
}

/** Bounded Main reason a Competition is worth running more than once.
 *  Intent and triggers are separate from evidence uncertainty. */
export interface CompetitionReason {
  intent: "none" | "consider" | "required";
  triggers: CompetitionTrigger[];
  /** Plain-language explanation of why a second (or further) Worker run is
   *  worth the cost. Bounded non-empty string. */
  note: string;
}

/** Frozen Worker identity resolved from one saved Worker Profile at Competition
 *  admission. provider + model + runtime + effort is the comparable identity;
 *  workerProfileId is provenance only. Absent on legacy candidate records. */
export interface CompetitionCandidateIdentity {
  provider: string;
  model: string;
  runtime: string;
  effort: string;
  /** Worker Profile id that produced this identity at admission. */
  workerProfileId?: string;
  /** Soft per-candidate budget frozen at admission. */
  maxBudgetUsd: number | null;
}

export interface CompetitionCandidateRecord {
  id: string;
  competitionId: string;
  taskId: string;
  ordinal: number;
  providerName: string;
  modelName: string;
  /** Frozen resolved Worker identity. Absent on legacy records - Hub reports
   *  the historical execution identity as unavailable rather than inferred. */
  identity?: CompetitionCandidateIdentity;
}

/** Competition-level Main decision kind. accept = final choice; revise =
 *  Main requests one bounded same-Candidate correction (executed through the
 *  existing correction authority, never automatically); reject = no retry;
 *  retained-partial is recorded separately on the Competition record. */
export type CompetitionMainDecisionKind = "accept" | "revise" | "reject";

/** Competition-level Main decision bound to one exact Candidate Revision.
 *  It is an explicit derivation of the chosen candidate Task's latest Main
 *  Review: the referenced attemptId, verificationEventSequence, and candidate
 *  revision must match that Task-level Main Review exactly. */
export interface CompetitionMainDecision {
  decision: CompetitionMainDecisionKind;
  candidateId: string;
  taskId: string;
  attemptId: string;
  verificationEventSequence: number;
  /** Candidate revision id bound to this decision (present when the candidate
   *  Task has revision evidence). */
  candidateRevisionId?: string;
  /** SHA-256 patch digest from the accepted CandidateRevision. */
  acceptedPatchDigest?: string;
  reason: string;
  createdAt: string;
}

/** Bounded retained-partial evidence for one non-selected Candidate.
 *  Reusable paths are validated against that Candidate's revision affected
 *  set; remaining gaps describe what a future M2 successor would still need.
 *  Stores evidence only - it never starts a Worker, retry, or handoff. */
export interface CompetitionRetainedPartial {
  candidateId: string;
  taskId: string;
  reusablePaths: string[];
  remainingGaps: GapEntry[];
  /** Exact CandidateRevision id frozen when Main retained the evidence.
   *  Absent on legacy retained-partial entries that predate exact binding. */
  candidateRevisionId?: string;
}

// --- Cross-Worker Candidate handoff (one hop) ---

/** Durable preparation/authorization status for one explicit cross-Worker handoff.
 *  Live successor Task status is projected separately and is never called a retry. */
export type CandidateHandoffStatus =
  | "authorized"
  | "preparing"
  | "prepared"
  | "failed";

/** Bounded closed-reason / failure codes for handoff projections. */
export type CandidateHandoffFailureCode =
  | "stale-revision"
  | "missing-retained"
  | "missing-revision"
  | "same-profile"
  | "profile-not-launchable"
  | "final-choice"
  | "duplicate-handoff"
  | "source-is-successor"
  | "unsafe-path"
  | "materialization-failed"
  | "apply-mismatch"
  | "confirm-required"
  | "reason-invalid"
  | "profile-unknown"
  | "not-goal-task"
  | "goal-terminal"
  | "source-not-eligible";

/** Bounded next-action codes for privacy-safe handoff projections. */
export type CandidateHandoffNextAction =
  | "wait-for-successor"
  | "review-successor"
  | "inspect-failure"
  | "choose-different-profile"
  | "retain-fresh-candidate"
  | "none";

/**
 * Discriminated origin for one durable handoff. Competition and Goal-Task
 * paths share successor materialization but validate admission independently.
 * Never fabricate Competition ids for Goal-Task origins.
 */
export type CandidateHandoffOrigin =
  | {
      kind: "competition";
      competitionId: string;
      sourceCandidateId: string;
    }
  | {
      kind: "goal-task";
      goalId: string;
      itemId: string;
    };

/** Versioned durable handoff record. Never stores raw patch, prompts, logs,
 *  credentials, endpoints, absolute private artifact paths, or unbounded text. */
export interface CandidateHandoffRecord {
  schemaVersion: 1;
  id: string;
  status: CandidateHandoffStatus;
  origin: CandidateHandoffOrigin;
  sourceTaskId: string;
  sourceCandidateRevisionId: string;
  /** Full SHA-256 of the exact source Candidate Diff (not projected in full). */
  sourcePatchDigest: string;
  gapContractDigest: string;
  reusablePathCount: number;
  remainingGapCount: number;
  /** Validated relative paths retained for the successor (bounded, safe). */
  reusablePaths: string[];
  remainingGaps: GapEntry[];
  destinationWorkerProfileId: string;
  destinationIdentity: FrozenWorkerIdentity;
  successorTaskId: string;
  /** Bounded Main reason for this handoff (1–1000 chars). */
  reason: string;
  createdAt: string;
  updatedAt: string;
  preparedAt?: string;
  failedAt?: string;
  failureCode?: CandidateHandoffFailureCode;
  nextAction: CandidateHandoffNextAction;
}

/** Privacy-safe handoff projection for CLI/MCP/Hub. Digest is prefix-only.
 *  Origin-specific ids appear only when applicable. */
export interface CandidateHandoffView {
  id: string;
  status: CandidateHandoffStatus;
  originKind: CandidateHandoffOrigin["kind"];
  /** Present only for Competition origin. */
  competitionId?: string;
  /** Present only for Competition origin. */
  sourceCandidateId?: string;
  /** Present only for Goal-Task origin. */
  goalId?: string;
  /** Present only for Goal-Task origin (Plan item id). */
  itemId?: string;
  sourceTaskId: string;
  sourceCandidateRevisionId: string;
  sourceDigestPrefix: string;
  gapContractDigestPrefix: string;
  reusablePathCount: number;
  remainingGapCount: number;
  reusablePaths: string[];
  remainingGaps: GapEntry[];
  destinationWorkerProfileId: string;
  destinationIdentity: FrozenWorkerIdentity;
  successorTaskId: string;
  reason: string;
  createdAt: string;
  updatedAt: string;
  preparedAt?: string;
  failedAt?: string;
  failureCode?: CandidateHandoffFailureCode;
  nextAction: CandidateHandoffNextAction;
  /** Live successor Task status when the successor still exists. */
  successorTaskStatus?: TaskStatus;
  /** True when this projection describes a handoff successor Task (not a retry). */
  isSuccessor?: boolean;
}

export interface CompetitionFactorScore {
  factor: RankingFactor;
  weight: number;
  available: boolean;
  rawValue?: number;
  normalizedValue: number;
  weightedScore: number;
  evidence: string;
}

export interface CompetitionCandidateScore {
  candidateId: string;
  taskId: string;
  providerName: string;
  modelName: string;
  eligible: boolean;
  disqualificationReason?: string;
  factors: CompetitionFactorScore[];
  totalScore: number;
}

export interface CompetitionRecommendation {
  candidateId: string;
  confidence: number;
  reasoning: string;
}

export interface CompetitionEvaluationRecord {
  id: string;
  competitionId: string;
  policy: RankingPolicy;
  candidates: CompetitionCandidateScore[];
  recommendation?: CompetitionRecommendation;
  createdAt: string;
}

// --- Delivery plan ---

/** One of four immutable stage expectations derived from the Task delivery snapshot.
 *  "required" = stage is configured and will be executed during Integration.
 *  "not-configured" = no commands were bound; Integration will record not-applicable. */
export type DeliveryStageExpectation = "required" | "not-configured";

/** How delivery was resolved for this Task. Mirrors DeliveryResolution.source plus none. */
export type DeliveryPlanResolutionSource = "inline" | "explicit" | "project" | "default" | "none";

/** Safe immutable delivery plan projected from one Task delivery snapshot.
 *  No command text, no settings lookup, no execution. */
export interface DeliveryPlanView {
  /** The resolution provenance: how delivery was configured for this Task. */
  resolutionSource: DeliveryPlanResolutionSource;
  /** Optional profile id when resolution came from explicit/project/default. */
  profileId?: string;
  /** Count of build commands in the snapshot (never command text). */
  buildCommandCount: number;
  /** Count of activation commands in the snapshot (never command text). */
  activationCommandCount: number;
  /** Count of activation check commands in the snapshot (never command text). */
  activationCheckCommandCount: number;
  /** Planned outcome derived from the delivery configuration. */
  outcome: "source-only" | "build" | "activation" | "none";
  /** Four immutable stage expectations derived from the Task snapshot.
   *  These describe what Integration is configured to do, not what has already happened. */
  stages: {
    sourceApply: DeliveryStageExpectation;
    sourceVerify: DeliveryStageExpectation;
    artifactBuild: DeliveryStageExpectation;
    runtimeActivation: DeliveryStageExpectation;
  };
}

// --- Integration path classification explanation ---
//
// Canonical category and bounded provenance for a single Integration-affected
// relative path. The PathPolicy explains the exact existing classification
// decision without changing it; provenance names the rule that produced the
// category so Main can see which contract boundary to review. The values are a
// closed vocabulary - never inferred from a filename and never mutated.

export type PathCategory = "business" | "generated" | "internal";

export type PathProvenance =
  /** A ForkLight-internal path under `.forklight`. */
  | "internal-forklight"
  /** A path whose segment was excluded from the safe snapshot. */
  | "snapshot-exclusion"
  /** A path matching a built-in generated pattern. */
  | "builtin-generated-pattern"
  /** A path matching a Task-declared generated pattern. */
  | "task-generated-pattern"
  /** A path included as business source by default. */
  | "default-business";

export interface PathClassification {
  category: PathCategory;
  provenance: PathProvenance;
}

/** One ordered, privacy-safe classification entry bound to an affected
 *  Integration path. The path is the same validated relative path that appears
 *  in `IntegrationReceiptRecord.affectedFiles`; the entry never carries an
 *  absolute path, Diff content, command text, credentials, or diagnostics. */
export interface IntegrationPathEvidenceEntry {
  path: string;
  category: PathCategory;
  provenance: PathProvenance;
}

/** Fixed advisory guidance code emitted only when a reviewed-patch file/line
 *  limit rejected Preflight and at least one affected path is default business.
 *  Advisory only: it never alters rejectionReasons, the immutable Task,
 *  PathPolicy, Candidate, or retry state. */
export type IntegrationRecoveryGuidanceCode =
  | "review-generated-or-exclusion-policy-vs-source-scope";

export interface IntegrationRecoveryGuidance {
  code: IntegrationRecoveryGuidanceCode;
  /** Count of affected paths classified as default business under current policy. */
  defaultBusinessPathCount: number;
  /** Reviewed-patch file count observed (privacy-safe; already in rejection text). */
  filesChanged: number;
  /** Reviewed-patch changed-line count observed. */
  changedLines: number;
  /** Configured reviewed-patch file limit. */
  reviewedPatchMaxFiles: number;
  /** Configured reviewed-patch line limit. */
  reviewedPatchMaxLines: number;
}

/** Closed, privacy-safe applicability issue recorded when the real
 *  `git apply --check` dry-run exits non-zero. It names only the known
 *  failure stage - never a parsed conflict, absolute path, command, diff,
 *  prompt, credential, or log. Carried unchanged in the receipt and the
 *  durable preflight event; legacy receipts without it remain readable. */
export interface IntegrationApplicabilityIssue {
  /** Fixed closed code identifying this issue. */
  code: "patch-not-applicable";
}

// --- Integration records ---

export interface IntegrationReceiptRecord {
  id: string;
  taskId: string;
  patchDigest: string;
  affectedFiles: string[];
  rejectionReasons: string[];
  sourceEvidence: Record<string, string>;
  createdAt: string;
  expiresAt: string;
  consumed: boolean;
  /** Safe immutable delivery plan visible to Main before authorizing Integration.
   *  Absent on legacy receipts stored before delivery plan support. */
  deliveryPlan?: DeliveryPlanView;
  /** Ordered one-to-one path classification evidence for `affectedFiles`,
   *  derived from the immutable Task PathPolicy. Absent on legacy receipts
   *  stored before path-classification evidence and when no path is affected. */
  pathEvidence?: IntegrationPathEvidenceEntry[];
  /** Advisory recovery guidance, present only when a reviewed-patch file or
   *  line limit rejected Preflight and at least one affected path is default
   *  business. Never alters rejection or retry authority. */
  recoveryGuidance?: IntegrationRecoveryGuidance;
  /** Closed privacy-safe applicability issue, present only when the real
   *  dry-run `git apply --check` exited non-zero. It names only the known
   *  failure stage and never carries a parsed conflict, path, command, diff,
   *  or diagnostic. Absent on legacy receipts and on receipts that rejected
   *  before reaching the dry-run check. */
  applicabilityIssue?: IntegrationApplicabilityIssue;
}

export interface IntegrationResultRecord {
  id: string;
  receiptId: string;
  taskId: string;
  status: "applied" | "rejected" | "retained-failure" | "rolled-back";
  backupDir?: string;
  verificationCommands?: VerificationCommandResult[];
  postApplyDigests?: Record<string, string>;
  rollbackFailures?: string[];
  error?: string;
  appliedAt?: string;
  stages?: IntegrationStageEvidence[];
  createdAt: string;
}

export type IntegrationStageName =
  | "source-applied"
  | "source-verified"
  | "artifact-built"
  | "runtime-activated";

export interface IntegrationStageEvidence {
  stage: IntegrationStageName;
  status: "pending" | "passed" | "failed" | "not-applicable" | "outcome-unknown";
  commands?: VerificationCommandResult[];
  error?: string;
}

export interface IntegrationOperationView {
  operationId: string;
  taskId: string;
  receiptId: string;
  status: "running" | "completed" | "failed" | "outcome-unknown";
  stages: IntegrationStageEvidence[];
  result?: IntegrationResultRecord;
}

export type DecisionStage =
  | "queued"
  | "worker-running"
  | "machine-failed"
  | "machine-verified"
  | "awaiting-main-review"
  | "revision-requested"
  | "main-rejected"
  | "ready-for-integration"
  | "integrating"
  | "applied-not-activated"
  | "delivered"
  | "activated"
  | "integration-failed"
  | "unknown";

/**
 * Closed vocabulary for the canonical privacy-safe live Task activity stage.
 * UI may translate these codes but must not recompute lifecycle semantics.
 */
export type LiveStageCode =
  | "preparing-workspace"
  | "waiting-for-model"
  | "model-processing"
  | "model-responding"
  | "using-tool"
  | "worker-finished"
  | "verifying"
  | "completed"
  | "failed"
  | "interrupted"
  | "legacy-running"
  | "queued"
  | "unknown"
  | "candidate-reverifying"
  | "remediation-checking";

/** What kind of durable evidence produced the current live stage. */
export type LiveStageEvidence =
  | "status"
  | "preparation"
  | "worker-start"
  | "model-activity"
  | "tool-lifecycle"
  | "verification"
  | "terminal"
  | "policy"
  | "legacy"
  | "none"
  | "candidate-reverification"
  | "remediation-check";

/** Whether the present observation is ordinary waiting or needs attention. */
export type LiveStageMeaning = "normal" | "attention";

/** Stable next-step code for bilingual UI translation. */
export type LiveStageNext =
  | "wait-for-preparation"
  | "wait-for-model"
  | "wait-for-tool-result"
  | "wait-for-next-model-step"
  | "wait-for-verification-start"
  | "wait-for-verification-result"
  | "wait-for-new-evidence"
  | "inspect-failure"
  | "none"
  | "wait-for-reverification-result"
  | "wait-for-remediation-result";

/**
 * Canonical, privacy-safe explanation of what is happening around the Task now.
 * Rebuildable from ordered durable events after daemon restart.
 * Never carries prompts, response content, tool arguments, paths, endpoints,
 * credentials, command text/output, raw errors, ETA, or invented percentages.
 */
export interface LiveStageProjection {
  stage: LiveStageCode;
  /** Event-age observation. Quiet is never proof of failure. */
  observation: "active" | "quiet" | "terminal";
  evidence: LiveStageEvidence;
  meaning: LiveStageMeaning;
  next: LiveStageNext;
  /** Timestamp of the determining evidence when available. */
  observedAt?: string;
  /** Sequence of the determining evidence event when available. */
  evidenceSequence?: number;
}

export interface TaskDecisionView {
  taskId: string;
  stage: DecisionStage;
  nextAction: string;
  workerClaim?: WorkerClaim & {
    provider: string;
    model: string;
  };
  checkpoint?: CheckpointReport;
  verification?: VerificationResult;
  mainReview?: MainReviewDecision;
  lineage: DeliveryLineage;
  integration?: IntegrationOperationView;
  progress: {
    activity: "active" | "quiet" | "terminal";
    latestEventSequence: number;
    lastEventAt?: string;
    latestAction?: string;
    /** Real store event type for the latest event (not a synthetic label). */
    lastEventType?: string;
    /** Current structured workspace-preparation stage. Never contains paths,
     *  file names, credentials, command text, or raw errors. */
    preparationStage?: {
      stage: string;
      phase: "start" | "complete";
      elapsedMs: number;
      countKind?: "files" | "dependencies";
      count?: number;
    };
    /**
     * Canonical live Worker stage shared by CLI, daemon, board, and Task Detail.
     * UI translates closed codes only; it must not recompute lifecycle semantics.
     */
    liveStage?: LiveStageProjection;
  };
  /** Latest terminal failure class when task is failed|interrupted.
   *  Includes Worker classes and contract-infeasible (verification/Main). */
  failureCategory?: "authentication" | "budget" | "runtime" | "connectivity" | "contract-infeasible";
  /** Independent final-delivery outcome after Main repaired a machine-failed Task. */
  remediationDisposition?: RemediationDisposition;
}

export interface ActivationHandoff {
  version: 1;
  operationId: string;
  taskId: string;
  receiptId: string;
  home: string;
  sourcePath: string;
  timeoutMs: number;
  activationCommands: string[];
  activationCheckCommands: string[];
}

// --- Provider probe ---

export type ProbeResultStatus = "unverified" | "verified" | "failed";

export type ProbeFailureCategory = "authentication" | "timeout" | "connectivity" | "unknown";

export type ProviderHealthStatus = "unverified" | "verified" | "failed" | "stale";

export interface ProbeEvidence {
  provider: string;
  model: string;
  endpointOrigin: string;
  status: ProbeResultStatus;
  latencyMs: number;
  timestamp: string;
  failureCategory?: ProbeFailureCategory;
  failureSummary?: string;
  /** Evidence origin. "worker-run" supersedes "explicit-probe" for the same Provider. */
  source?: "explicit-probe" | "worker-run";
}

export interface ProviderStatus {
  provider: string;
  model: string;
  keychainExists: boolean;
  status: ProviderHealthStatus;
  evidence?: ProbeEvidence;
}

// --- Bounded policy adaptation transition chain ---
//
// A bounded, evidence-backed successor-creation service for terminal Tasks.
// One parent -> at most one successor. Round number is bounded by the root
// snapshot's maxAdaptationRounds. Settings drift cannot expand the root limit.
// Only flexible advanced-policy fields may change; maxAdaptationRounds itself
// and authority-bearing fields are forbidden in the patch.

/** Bounded reason category for adaptation transitions.
 *  Stable, privacy-safe enum shared by preview and apply paths. */
export type AdaptationReasonCategory =
  | "eligible"
  | "adaptation-disabled"
  | "round-limit-reached"
  | "parent-not-found"
  | "parent-not-terminal"
  | "missing-effective-policy"
  | "successor-already-created"
  | "no-effective-change"
  | "forbidden-field"
  | "invalid-patch"
  /** Parent terminal is contract-infeasible; Main must revise the contract. */
  | "contract-infeasible";

/** Bounded reason category supplied by the caller to describe the intent
 *  of the proposed patch. Stable, privacy-safe, finite. Persisted on the
 *  lineage edge and surfaced in events. */
export type AdaptationProposedReasonCategory =
  | "duration-budget"
  | "size-policy"
  | "attempt-budget"
  | "completion-policy"
  | "concurrency-cap"
  | "no-progress-timeout"
  | "other-flexible-policy";

/** Status discriminator for the gate output. */
export type AdaptationGateStatus = "eligible" | "stopped";

/** Per-field before/after view in an adaptation preview row.
 *  Always includes enforcementPhase and provenance from the parent snapshot. */
export interface AdaptationPreviewField {
  field: keyof AdvancedPolicyFields;
  before: number | PolicyMode | null;
  after: number | PolicyMode | null;
  changed: boolean;
  source: ProvenanceSource;
  enforcementPhase: EnforcementPhase;
}

/** Pure content-free adaptation preview produced by the eligibility gate.
 *  When status is "stopped", fields is empty and stoppedReason is set. */
export interface AdaptationPreview {
  status: AdaptationGateStatus;
  rootTaskId: string;
  parentTaskId: string;
  /** The next round that would be assigned to the successor (1-based, parentDepth+1). */
  nextRound: number;
  /** Immutable maxAdaptationRounds read from the root snapshot. */
  maxAdaptationRounds: number;
  /** Child's worker profile id carried through from the parent/root snapshot. */
  profileId: string;
  /** Reason category, always set. */
  reason: AdaptationReasonCategory;
  stoppedReason?: AdaptationReasonCategory;
  /** Per-field before/after rows for the proposed patch (empty when stopped). */
  fields: AdaptationPreviewField[];
  /** Privacy-safe human-readable summary of the transition. */
  summary: string;
}

/** Durable persisted lineage record. Recovery-safe; UNIQUE(parent_task_id)
 *  enforces one-successor-per-parent. */
export interface AdaptationTransitionRecord {
  id: string;
  rootTaskId: string;
  parentTaskId: string;
  childTaskId: string;
  round: number;
  reason: AdaptationReasonCategory;
  proposedReason: AdaptationProposedReasonCategory;
  createdAt: string;
}

// --- Main remediation verification ---

export type RemediationCheckStatus = "failed" | "passed";

/** Whether final delivery used the original acceptance suite or a Main-amended one. */
export type RemediationAcceptanceBasis =
  | "original-acceptance"
  | "amended-acceptance";

/** Fixed privacy-safe reason code when Main amends failed acceptance commands. */
export type RemediationAmendmentReasonCode = "contradictory-acceptance";

/** One-to-one replacement of an exact failed acceptance command. */
export interface AcceptanceCommandReplacement {
  /** Exact command text that failed in the bound verification event. */
  originalCommand: string;
  /** Non-empty replacement command Main authorizes for this check only. */
  replacementCommand: string;
}

/**
 * Explicit Main acceptance amendment input. Bound to one verification event;
 * never mutates the stored Task Contract or original verification history.
 */
export interface RemediationAcceptanceAmendment {
  verificationEventSequence: number;
  reasonCode: RemediationAmendmentReasonCode;
  replacements: AcceptanceCommandReplacement[];
}

/** Private amendment evidence stored with a remediation check. */
export interface RemediationAmendmentEvidence {
  verificationEventSequence: number;
  reasonCode: RemediationAmendmentReasonCode;
  replacements: AcceptanceCommandReplacement[];
  /** Full amended suite that was actually executed (private). */
  amendedCommands: string[];
}

export interface RemediationCheckRecord {
  id: string;
  taskId: string;
  status: RemediationCheckStatus;
  /** Private audit context. Compact task/list/event projections must not expose it. */
  reason?: string;
  commands: VerificationCommandResult[];
  /** Private amendment evidence when Main replaced failed commands. */
  amendment?: RemediationAmendmentEvidence;
  createdAt: string;
}

export interface RemediationDisposition {
  status: "verified-repaired-delivered";
  checkId: string;
  createdAt: string;
  /**
   * Optional on read for legacy records. Absent means original-acceptance.
   * Public projections may include this compact basis but never command text.
   */
  acceptanceBasis?: RemediationAcceptanceBasis;
  /** Count of commands Main replaced; present only for amended-acceptance. */
  amendedCommandCount?: number;
  /** Privacy-safe reason code; present only for amended-acceptance. */
  reasonCode?: RemediationAmendmentReasonCode;
}

// --- Candidate revision evidence ---

/** Immutable per-Attempt candidate revision snapshot.
 *  The private artifact path is never exposed in Hub, MCP, or CLI output. */
export interface CandidateRevision {
  id: string;
  taskId: string;
  attemptId: string;
  attemptOrdinal: number;
  verificationEventSequence: number;
  /** SHA-256 hex digest of the exact integration Diff bytes at capture time. */
  patchDigest: string;
  affectedPaths: string[];
  filesChanged: number;
  changedLines: number;
  verificationPassed: boolean;
  createdAt: string;
}

/** Control-surface revision summary. It exposes only validated relative
 *  affected paths so Main can mark known-good files; it never contains the
 *  private artifact path or Diff content. */
export interface CandidateRevisionSummary {
  id: string;
  attemptOrdinal: number;
  digestPrefix: string;
  affectedPathCount: number;
  /** Safe relative paths only; bounded by the CandidateRevision validator. */
  affectedPaths: string[];
  filesChanged: number;
  changedLines: number;
  verificationPassed: boolean;
}

/** A single bounded repair gap with description and concrete acceptance expectation. */
export interface GapEntry {
  /** 10–500 character description of what is missing or wrong (trimmed, no newlines). */
  description: string;
  /** 10–500 character concrete acceptance expectation (trimmed, no newlines). */
  acceptanceExpectation: string;
}

/** Structured bounded Gap Contract for Main correction.
 *  Bound to one CandidateRevision and one correction grant. */
export interface CandidateGapContract {
  schemaVersion: 1;
  candidateRevisionId: string;
  /** 0–20 reusable relative paths validated against the revision affected set. */
  reusablePaths: string[];
  /** 1–8 remaining gaps. */
  remainingGaps: GapEntry[];
}

/** Stable eligibility category — shared by daemon, MCP, and Hub. */
export type CorrectionEligibilityCategory =
  | "eligible"
  | "not-failed-or-interrupted"
  | "competition-candidate"
  | "competition-main-revise-required"
  | "running-attempt"
  | "no-revision"
  | "no-latest-attempt-revision"
  | "empty-revision"
  | "allowance-zero"
  | "allowance-exhausted"
  | "pending-incompatible-grant"
  | "stale-revision"
  | "no-main-revise";

/** Canonical read-only correction eligibility projection.
 *  Never exposes private artifact paths, Diff content, or gap text. */
export interface CorrectionEligibility {
  eligible: boolean;
  category: CorrectionEligibilityCategory;
  allowance: {
    max: number;
    consumed: number;
    remaining: number;
    source: ProvenanceSource;
  };
  latestRevision?: CandidateRevisionSummary;
}

// --- Exact-revision Review Graph (1–3 independent read-only judges) ---

/** Graph lifecycle. Pending/running block Candidate Integration; terminal
 *  evidence requires a fresher Main Review before Integration. */
export type ReviewGraphStatus = "pending" | "running" | "completed" | "failed";

/** Per-assignment lifecycle for one explicit reviewer Worker Task. */
export type ReviewAssignmentStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

/** Judge-proposed disposition. Evidence only — never an automatic Main decision. */
export type ReviewDisposition = "accept" | "revise" | "reject";

export type ReviewFindingSeverity = "info" | "warning" | "error";

/** Typed failure when reviewer output is unusable or the Task fails closed. */
export type ReviewResultFailureCode =
  | "missing-result"
  | "malformed-json"
  | "schema-violation"
  | "stale-revision"
  | "wrong-identity"
  | "oversized"
  | "unsafe-content"
  | "extra-fields"
  | "reviewer-task-failed";

/** Aggregate evidence state across independent judges. Never a vote or verdict. */
export type ReviewAggregationState =
  | "pending"
  | "single-opinion"
  | "agreement"
  | "disagreement"
  | "insufficient-evidence";

/** One bounded finding with relative-path evidence only. */
export interface ReviewFinding {
  severity: ReviewFindingSeverity;
  /** Safe relative path evidence (never absolute). */
  evidencePath: string;
  affectedBehavior: string;
  recommendation: string;
}

/** Strict structured judge result accepted from terminal resultText. */
export interface ReviewResult {
  schemaVersion: 1;
  reviewedRevisionId: string;
  proposedDisposition: ReviewDisposition;
  summary: string;
  findings: ReviewFinding[];
}

/** Durable graph binding one exact Candidate Revision to 1–3 reviewer assignments. */
export interface ReviewGraphRecord {
  schemaVersion: 1;
  id: string;
  candidateTaskId: string;
  candidateRevisionId: string;
  attemptId: string;
  attemptOrdinal: number;
  verificationEventSequence: number;
  patchDigest: string;
  status: ReviewGraphStatus;
  /** Always 1 in this slice; reserved for future multi-round reviews. */
  round: 1;
  /** Number of independent judges registered for this exact revision (1–3). */
  maxAssignments: 1 | 2 | 3;
  assignmentIds: string[];
  createdAt: string;
  updatedAt: string;
  /** Candidate Task event sequence when every assignment became terminal. */
  terminalEvidenceSequence?: number;
  /** Private packet path under the Candidate Task root — never projected. */
  privatePacketPath?: string;
}

/** One explicit reviewer assignment linked to a read-only Worker Task. */
export interface ReviewAssignmentRecord {
  id: string;
  graphId: string;
  ordinal: number;
  candidateTaskId: string;
  candidateRevisionId: string;
  reviewerWorkerProfileId: string;
  reviewerTaskId: string;
  status: ReviewAssignmentStatus;
  reason: string;
  frozenIdentity: FrozenWorkerIdentity;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  /** Present only when structured parse succeeded. */
  result?: ReviewResult;
  /** Present only when the assignment failed closed. */
  failureCode?: ReviewResultFailureCode;
  /** Private packet path — never projected. */
  privatePacketPath?: string;
}

/** Privacy-safe finding for Hub/MCP/CLI. */
export interface ReviewFindingView {
  severity: ReviewFindingSeverity;
  evidencePath: string;
  affectedBehavior: string;
  recommendation: string;
}

/** Privacy-safe structured result for control surfaces. */
export interface ReviewResultView {
  schemaVersion: 1;
  reviewedRevisionId: string;
  proposedDisposition: ReviewDisposition;
  summary: string;
  findings: ReviewFindingView[];
}

/** Privacy-safe assignment projection. Never includes packet path, raw patch,
 *  raw resultText, absolute paths, credentials, or prompts. */
export interface ReviewAssignmentView {
  id: string;
  ordinal: number;
  status: ReviewAssignmentStatus;
  reviewerWorkerProfileId: string;
  reviewerTaskId: string;
  frozenIdentity: FrozenWorkerIdentity;
  reason: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  resultUsable: boolean;
  result?: ReviewResultView;
  failureCode?: ReviewResultFailureCode;
}

/** Privacy-safe multi-judge aggregation. Describes evidence only — never a vote. */
export interface ReviewAggregationView {
  total: number;
  pending: number;
  usable: number;
  unusable: number;
  dispositionCounts: {
    accept: number;
    revise: number;
    reject: number;
  };
  state: ReviewAggregationState;
  /** Short plain-language explanation of agreement, disagreement, or gaps. */
  explanation: string;
}

/** Privacy-safe graph projection for Task Detail / CLI / MCP. */
export interface ReviewGraphView {
  schemaVersion: 1;
  id: string;
  candidateTaskId: string;
  candidateRevisionId: string;
  attemptOrdinal: number;
  verificationEventSequence: number;
  digestPrefix: string;
  status: ReviewGraphStatus;
  round: 1;
  maxAssignments: 1 | 2 | 3;
  assignments: ReviewAssignmentView[];
  aggregation: ReviewAggregationView;
  createdAt: string;
  updatedAt: string;
  terminalEvidenceSequence?: number;
  /** True when a pending/running review blocks Integration. */
  blocksIntegration: boolean;
  /** True when terminal review requires a fresher Main decision. */
  requiresFreshMainReview: boolean;
  /** Plain-language next action for Main (not an automatic decision). */
  nextAction: string;
  /** Stable localization key for control surfaces. */
  nextActionCode:
    | "wait-for-judge"
    | "fresh-main-review-usable"
    | "fresh-main-review-unusable"
    | "fresh-main-review-disagreement"
    | "integrated"
    | "ready-for-integration"
    | "main-decision";
}

// --- Main-direct execution decision ---

/** Closed vocabulary for why Main handled work directly. */
export type MainDirectDecisionReason =
  | "small-clear-change"
  | "urgent-fix"
  | "workers-unavailable"
  | "user-requested"
  | "main-judgment";

/** Bounded local verification result from Main's independent check. */
export type MainDirectVerification = "passed" | "failed" | "unavailable";

/** Immutable lifecycle state. Open = started, incomplete. */
export type MainDirectDecisionStatus = "open" | "completed" | "abandoned";

/** Frozen Worker Profile identity snapshot captured at decision start.
 *  provider+model+runtime+effort is the comparable identity;
 *  workerProfileId is the saved profile reference. */
export interface MainDirectConsideredWorkerSnapshot {
  workerProfileId: string;
  label: string;
  provider: string;
  model: string;
  runtime: string;
  effort: string;
  /** Readiness at decision time. Never triggers a Provider probe. */
  readiness: "ready" | "launchable" | "needs-attention" | "blocked" | "unknown";
  /** True when the profile was configured and recognizable at decision time. */
  available: boolean;
}

/** Bounded evidence snapshot for considered profiles at decision time.
 *  Derived read-only from existing Task history — never probes a Provider. */
export interface MainDirectEvidenceSnapshotEntry {
  workerProfileId: string;
  exactClassSampleCount: number;
  familySampleCount: number;
  scope: "exact-class" | "task-family" | "none";
}

/** Bounded close outcome. Completed requires verification; abandoned carries none. */
export interface MainDirectClosedState {
  outcome: "completed" | "abandoned";
  /** Present only when outcome is completed. */
  verification?: MainDirectVerification;
  /** Bounded Main-authored note (0–300 chars). */
  note: string;
  closedAt: string;
}

/** Durable Main-direct execution decision record.
 *  Independent from Task/Attempt/Worker lifecycle. */
export interface MainDirectDecisionRecord {
  id: string;
  /** Stable taskClass — explicit, non-empty, ≤80 chars. */
  taskClass: string;
  /** Optional stable taskFamily — explicit, ≤80 chars. */
  taskFamily?: string;
  /** Closed reason code for handling work directly. */
  reason: MainDirectDecisionReason;
  /** Bounded Main-authored explanation (1–300 chars). */
  note: string;
  /** Considered Worker Profile ids, frozen at start. 0–4 entries. */
  consideredWorkerProfileIds: string[];
  /** Frozen identity snapshots for considered profiles at decision time. */
  consideredWorkers: MainDirectConsideredWorkerSnapshot[];
  /** Evidence snapshot at decision time (never probes a Provider). */
  evidenceSnapshot: MainDirectEvidenceSnapshotEntry[];
  status: MainDirectDecisionStatus;
  startedAt: string;
  /** Present only after explicit close. */
  closedState?: MainDirectClosedState;
}

/** Privacy-safe projection for CLI/MCP/Hub. Never carries raw note content. */
export interface MainDirectDecisionProjection {
  id: string;
  taskClass: string;
  taskFamily?: string;
  reason: MainDirectDecisionReason;
  note: string;
  status: MainDirectDecisionStatus;
  consideredWorkerCount: number;
  consideredWorkerIds: string[];
  /** Only workerProfileId and label — never provider/model/runtime details. */
  consideredWorkerLabels: Array<{ workerProfileId: string; label: string }>;
  evidenceScope: "exact-class" | "task-family" | "none";
  startedAt: string;
  outcome?: "completed" | "abandoned";
  verification?: MainDirectVerification;
  closedAt?: string;
}

/** Aggregate counts only — never per-record details. */
export interface MainDirectDecisionAggregate {
  openCount: number;
  completedCount: number;
  abandonedCount: number;
  completedPassedCount: number;
  completedFailedCount: number;
  completedUnavailableCount: number;
  totalCount: number;
  reasonDistribution: Partial<Record<MainDirectDecisionReason, number>>;
}

/** Bounded recent-decision entry for Hub Insights. Privacy-safe. */
export interface MainDirectDecisionRecentEntry {
  id: string;
  taskClass: string;
  reason: MainDirectDecisionReason;
  status: MainDirectDecisionStatus;
  outcome?: "completed" | "abandoned";
  verification?: MainDirectVerification;
  startedAt: string;
  closedAt?: string;
  consideredWorkerCount: number;
}
