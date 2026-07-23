import type { PricingUnavailableReason } from "./pricing.js";
import type { QuotedCost, UnavailableCost } from "./pricing-calculator.js";

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

export type EventType =
  | "task.created"
  | "task.waiting"
  | "task.blocked"
  | "task.ready"
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
  | "integration.preflight.completed"
  | "integration.apply.started"
  | "integration.apply.completed"
  | "integration.rollback.completed"
  | "task.revise.requested";

export interface ProviderSpec {
  name: "deepseek" | "qwen" | "minimax" | "glm";
  model: string;
  endpoint?: string;
  /** Explicit billing route — never forwarded to Worker environment or persisted as a credential. */
  pricingRoute?: string;
  keychainService: string;
  keychainAccount?: string;
}

export interface RuntimeSpec {
  name: "claude-code";
  executable: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxBudgetUsd: number | null;
}

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

export interface TaskContract {
  outcome: string;
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

interface SharedTaskSpec {
  name: string;
  project: string;
  provider: ProviderSpec;
  runtime: RuntimeSpec;
  workspace: {
    exclude: string[];
  };
  worker: {
    allowEdits: boolean;
    allowedCommands: string[];
    focusPaths: string[];
  };
  taskClass?: string;
  /** Exact direct-Codex execution-profile identity selected by the operator.
   *  Must be a canonical profile id validated by the shared normalizer.
   *  Absent for legacy tasks; never inferred from provider, model, or runtime. */
  directCodexProfileId?: string;
  /** Snapped completion policy at Task creation time.
   *  Absent in legacy stored Tasks; runtime code must fall back to hard. */
  completionPolicy?: {
    noChangeMode: PolicyMode;
    /** How changeBudget overruns affect Task success. Defaults to hard when absent. */
    changeBudgetMode?: PolicyMode;
  };
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
}

export interface QualityReport {
  passed: boolean;
  score: number;
  checks: QualityCheck[];
  issues: string[];
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
  officialCost?: AttemptOfficialCost;
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

export type CompetitionStatus = "pending" | "running" | "completed";
export type RankingFactor = "verification" | "diffFocus" | "retries" | "cost" | "duration" | "delivery";

export type PolicyMode = "hard" | "warn" | "score" | "off";

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
}

export interface CompetitionCandidateRecord {
  id: string;
  competitionId: string;
  taskId: string;
  ordinal: number;
  providerName: string;
  modelName: string;
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
  createdAt: string;
}

// --- Provider probe ---

export type ProbeResultStatus = "verified" | "failed";

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
}

export interface ProviderStatus {
  provider: string;
  model: string;
  keychainExists: boolean;
  status: ProviderHealthStatus;
  evidence?: ProbeEvidence;
}
