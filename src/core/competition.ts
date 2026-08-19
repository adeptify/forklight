import { randomUUID } from "node:crypto";
import { cp, mkdir, rm } from "node:fs/promises";
import { lstatSync } from "node:fs";
import path from "node:path";
import type { StateStore } from "../state/store.js";
import type { CompetitionSettings, ForkLightSettings, SettingsService } from "./settings.js";
import { verificationFrom, type TaskEvidence } from "./statistics.js";
import { buildManifest, prepareWorkspace } from "../workspace/copy.js";
import { buildTaskRecord } from "./runner.js";
import { taskPaths } from "./config.js";
import { isProviderName, providerNames } from "./providers.js";
import { isoTimestamp as timestamp } from "./time.js";
import { isTerminalTaskStatus } from "./task-progress.js";
import { assertProviderRuntimePair, defaultExecutableForRuntime } from "./runtime-names.js";
import {
  applyResolvedNetworkPolicy,
  resolveWorkerSelection,
  type ResolvedWorkerSelection,
} from "./worker-profiles.js";
import {
  executionCapabilitiesForRuntime,
  resolveExecutionMode,
} from "./execution-mode.js";
import {
  buildCandidateGapContract,
  candidateRevisionMatchesCurrentDiff,
  latestMainReview,
  resolveLatestRevision,
  resolveRevisionForAttempt,
} from "./candidate-revision.js";
import {
  enforcementCapabilityForRuntime,
  resolveTaskEffectivePolicy,
} from "./advanced-policy.js";
import type {
  CompetitionCandidateIdentity,
  CompetitionCandidateRecord,
  CompetitionCandidateScore,
  CompetitionEvaluationRecord,
  CompetitionFactorScore,
  CompetitionMainDecision,
  CompetitionMainDecisionKind,
  CompetitionReason,
  CompetitionRetainedPartial,
  CompletionPolicyCheck,
  CompetitionRecord,
  CompetitionTrigger,
  ProviderSpec,
  RankingFactor,
  RankingPolicy,
  StagedTaskRegistration,
  TaskSpec,
  VerificationResult,
} from "./types.js";

export const DEFAULT_RANKING_POLICY: RankingPolicy = {
  weights: {
    verification: 1,
    diffFocus: 0.3,
    retries: 0.2,
    cost: 0,
    duration: 0,
    delivery: 0.3,
  },
  tieThreshold: 1e-9,
};

export type RankingPolicyOverride = Partial<Record<RankingFactor, number>>;

export interface CandidateOverride {
  /** Provider name (legacy explicit entrance). Ignored when workerProfileId is set. */
  providerName?: string;
  /** Model name (legacy explicit entrance). Ignored when workerProfileId is set. */
  modelName?: string;
  /** Positive finite cap, or null for unlimited (no Claude budget flag). */
  maxBudgetUsd?: number | null;
  /** Saved Worker Profile id. When set on every candidate, the Competition is
   *  a reasoned mixed-runtime admission: each candidate is resolved from its
   *  own Profile into a frozen provider/model/runtime/effort identity and a
   *  Main reason is required. providerName/modelName are ignored. */
  workerProfileId?: string;
}

/** Bounded Main reason a Competition is worth running. A reason is only
 *  supplied for the reasoned Worker-Profile entrance, so intent must be
 *  consider or required and at least one explicit trigger must be present.
 *  Intent and triggers are separate from evidence uncertainty; both are
 *  validated and frozen at admission so later settings edits cannot rewrite
 *  history. */
export interface CompetitionReasonInput {
  intent: "none" | "consider" | "required";
  triggers?: CompetitionTrigger[];
  /** Plain-language explanation of why a second (or further) Worker run is
   *  worth the cost. Bounded non-empty string (≤ 1000 chars). */
  note: string;
}

/** Admission options. New reasoned admissions require `reason` (consider or
 *  required intent with explicit triggers); legacy provider/model-only
 *  submissions must omit `reason` and are stored reason-unavailable without
 *  inventing history. */
export interface CompetitionCreateOptions {
  reason?: CompetitionReasonInput;
  /** Explicit legacy marker (provider/model-only). When true a reason is
   *  forbidden; admission is stored reason-unavailable. */
  legacy?: boolean;
  /** Optional canonical Worker readiness verifier for the new entrance. The
   *  daemon supplies one built from the existing readiness semantics; when
   *  omitted (e.g. unit tests) readiness is not re-checked here. */
  readinessVerifier?: WorkerReadinessVerifier;
}

/** Verifies every selected Worker Profile is launchable under the existing
 *  readiness semantics (model, pairing, authentication, runtime, permissions).
 *  Throws a privacy-safe message if any selected Profile is not launchable;
 *  the admission is all-or-nothing before any workspace preparation. */
export type WorkerReadinessVerifier = (profileIds: readonly string[]) => void;

const COMPETITION_REASON_NOTE_MAX = 1000;
const COMPETITION_VALID_TRIGGERS = new Set<CompetitionTrigger>([
  "critical",
  "multiple-plausible-solutions",
  "new-family",
  "user-requested",
]);

/** Validate and freeze a Main Competition reason. A reason is only ever
 *  supplied for the reasoned Worker-Profile entrance, so intent must be
 *  consider or required and at least one explicit trigger must be present.
 *  Returns the immutable reason stored on the Competition record. */
export function validateCompetitionReason(input: unknown): CompetitionReason {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Competition reason must be an object");
  }
  const o = input as Record<string, unknown>;
  if (o.intent !== "consider" && o.intent !== "required") {
    throw new Error("Competition reason intent must be consider or required");
  }
  const triggersRaw = Array.isArray(o.triggers) ? o.triggers : [];
  const triggers: CompetitionTrigger[] = [];
  const seen = new Set<string>();
  for (const t of triggersRaw) {
    if (typeof t !== "string" || !COMPETITION_VALID_TRIGGERS.has(t as CompetitionTrigger)) {
      throw new Error("Competition reason triggers contains an unsupported Main reason");
    }
    if (seen.has(t)) continue;
    seen.add(t);
    triggers.push(t as CompetitionTrigger);
  }
  if (triggers.length === 0) {
    throw new Error("Competition reason requires at least one explicit trigger");
  }
  if (typeof o.note !== "string") {
    throw new Error("Competition reason note must be a string");
  }
  const note = o.note.trim();
  if (note.length === 0 || note.length > COMPETITION_REASON_NOTE_MAX) {
    throw new Error(
      `Competition reason note must be 1-${COMPETITION_REASON_NOTE_MAX} characters`,
    );
  }
  return { intent: o.intent as CompetitionReason["intent"], triggers, note };
}

export interface CompetitionCandidateInput {
  candidateId: string;
  taskId: string;
  providerName: string;
  modelName: string;
  evidence: TaskEvidence;
}

interface CandidateMetrics {
  candidate: CompetitionCandidateInput;
  eligible: boolean;
  reason?: string;
  diffFocus?: number;
  retries: number;
  cost?: number;
  duration?: number;
  /** Resolved completion policy check — may be derived from legacy evidence. */
  completionPolicy: CompletionPolicyCheck | undefined;
}

export function rankingPolicy(
  override: RankingPolicyOverride = {},
  settings?: CompetitionSettings,
): RankingPolicy {
  const weights = {
    ...DEFAULT_RANKING_POLICY.weights,
    ...(settings?.rankingWeights ?? {}),
    ...override,
  };
  for (const [factor, weight] of Object.entries(weights)) {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new Error(`Ranking weight ${factor} must be a finite non-negative number`);
    }
  }
  if (weights.verification <= 0) {
    throw new Error("Verification must retain a positive ranking weight");
  }
  const tieThreshold = settings?.tieThreshold ?? DEFAULT_RANKING_POLICY.tieThreshold;
  if (!Number.isFinite(tieThreshold) || tieThreshold < 0) {
    throw new Error("Tie threshold must be a finite non-negative number");
  }
  return {
    weights,
    tieThreshold,
  };
}

function verificationFailure(verification: VerificationResult): string {
  const cp = verification.completionPolicy;
  if (cp && cp.check === "hard-fail") {
    return cp.message;
  }
  const budget = verification.changeBudget;
  if (budget && !budget.withinBudget && (budget.effect === "hard-fail" || budget.effect === undefined)) {
    return `Change budget exceeded: ${budget.filesChanged}/${budget.maxFiles} files, ${budget.changedLines}/${budget.maxDiffLines} lines`;
  }
  const command = verification.commands.find((candidate) => candidate.exitCode !== 0);
  if (command) return `Verification failed: ${command.command} (exit ${command.exitCode})`;
  if (verification.sourceCompatible === false
    || (verification.sourceCompatible === undefined && !verification.sourceUnchanged)) {
    const conflicts = verification.sourceCompatibility?.conflictingPaths?.length
      ? ` (${verification.sourceCompatibility.conflictingPaths.length} affected path(s))`
      : "";
    return `Verification failed: affected source paths changed outside isolation${conflicts}`;
  }
  return "Independent verification failed";
}

function completeTotal(
  evidence: TaskEvidence,
  metric: "costUsd" | "turns",
): number | undefined {
  if (
    evidence.attempts.length === 0
    || evidence.attempts.some((attempt) => attempt[metric] === undefined)
  ) {
    return undefined;
  }
  return evidence.attempts.reduce((total, attempt) => total + (attempt[metric] ?? 0), 0);
}

function metrics(input: CompetitionCandidateInput): CandidateMetrics {
  const { task, verification } = input.evidence;
  let reason: string | undefined;
  if (!isTerminalTaskStatus(task.status)) reason = `Candidate task is still ${task.status}`;
  else if (!verification) reason = "Independent verification evidence is missing";
  else if (!verification.passed) reason = verificationFailure(verification);
  else if (task.status !== "succeeded") reason = `Candidate task ended as ${task.status}`;

  const budget = verification?.changeBudget;
  const diffFocus = budget && budget.maxFiles > 0 && budget.maxDiffLines > 0
    ? Math.max(
        budget.filesChanged / budget.maxFiles,
        budget.changedLines / budget.maxDiffLines,
      )
    : undefined;
  const duration = task.startedAt && task.finishedAt
    ? Date.parse(task.finishedAt) - Date.parse(task.startedAt)
    : undefined;
  const validDuration = duration !== undefined && Number.isFinite(duration) && duration >= 0
    ? duration
    : undefined;
  const cost = completeTotal(input.evidence, "costUsd");

  // Resolve completion policy check from verification evidence.
  // Legacy records (no completionPolicy field) fall back to hard mode when
  // the Task was editable and produced no workspace changes.
  const allowEdits = task.spec.worker?.allowEdits ?? true;
  const noChanges = budget
    && budget.filesChanged === 0
    && budget.changedLines === 0;
  let completionPolicy: CompletionPolicyCheck | undefined = verification?.completionPolicy;
  if (!completionPolicy && allowEdits && noChanges) {
    completionPolicy = {
      check: "hard-fail",
      noChangeMode: "hard",
      message: "No workspace changes detected (legacy fallback: hard)",
    };
  }
  if (!completionPolicy && allowEdits && budget && !noChanges) {
    completionPolicy = {
      check: "satisfied",
      noChangeMode: "hard",
      message: "Workspace changes detected (legacy fallback: hard)",
    };
  }
  if (!completionPolicy && !allowEdits) {
    completionPolicy = {
      check: "not-applicable",
      noChangeMode: "hard",
      message: "Read-only Task; no-change delivery policy does not apply",
    };
  }
  if (reason === undefined && completionPolicy?.check === "hard-fail") {
    reason = completionPolicy.message;
  }

  return {
    candidate: input,
    eligible: reason === undefined,
    ...(reason === undefined ? {} : { reason }),
    ...(diffFocus === undefined ? {} : { diffFocus }),
    retries: Math.max(0, input.evidence.attempts.length - 1),
    ...(cost === undefined ? {} : { cost }),
    ...(validDuration === undefined ? {} : { duration: validDuration }),
    completionPolicy,
  };
}

function inverse(value: number | undefined, values: number[]): number {
  if (value === undefined || values.length === 0) return 0;
  const low = Math.min(...values);
  const high = Math.max(...values);
  return high === low ? 1 : (high - value) / (high - low);
}

function factor(
  factorName: RankingFactor,
  weight: number,
  rawValue: number | undefined,
  normalizedValue: number,
  evidence: string,
): CompetitionFactorScore {
  return {
    factor: factorName,
    weight,
    available: rawValue !== undefined,
    ...(rawValue === undefined ? {} : { rawValue }),
    normalizedValue,
    weightedScore: normalizedValue * weight,
    evidence,
  };
}

function candidateScore(
  item: CandidateMetrics,
  policy: RankingPolicy,
  eligible: CandidateMetrics[],
): CompetitionCandidateScore {
  const base = {
    candidateId: item.candidate.candidateId,
    taskId: item.candidate.taskId,
    providerName: item.candidate.providerName,
    modelName: item.candidate.modelName,
  };
  if (!item.eligible) {
    return {
      ...base,
      eligible: false,
      disqualificationReason: item.reason ?? "Candidate is not eligible",
      factors: [
        factor("verification", policy.weights.verification, 0, 0, item.reason ?? "not eligible"),
      ],
      totalScore: 0,
    };
  }

  const focusScore = item.diffFocus === undefined ? 0 : Math.max(0, 1 - item.diffFocus);
  // Legacy policies may lack the delivery weight; normalize to default.
  const deliveryWeight = typeof policy.weights.delivery === "number" && policy.weights.delivery >= 0
    ? policy.weights.delivery
    : DEFAULT_RANKING_POLICY.weights.delivery;
  const cp = item.completionPolicy;
  const effectiveDeliveryWeight = cp?.noChangeMode === "score" ? deliveryWeight : 0;
  let deliveryRawValue: number | undefined;
  let deliveryNormValue: number;
  let deliveryEvidence: string;
  if (cp?.check === "satisfied") {
    deliveryRawValue = 1;
    deliveryNormValue = 1;
    deliveryEvidence = "Delivery check satisfied";
  } else if (cp?.check === "score-evidence") {
    deliveryRawValue = 0;
    deliveryNormValue = 0;
    deliveryEvidence = "No workspace changes detected; delivery penalty applied";
  } else if (!cp || cp.check === "not-applicable" || cp.check === "ignored") {
    deliveryRawValue = undefined;
    deliveryNormValue = 0;
    deliveryEvidence = cp?.message ?? "Delivery evidence unavailable";
  } else {
    // warning or unknown — non-scoring
    deliveryRawValue = undefined;
    deliveryNormValue = 0;
    deliveryEvidence = cp.check === "warning"
      ? "Warning: No workspace changes detected (warn mode, non-scoring)"
      : cp.message;
  }
  const factors = [
    factor("verification", policy.weights.verification, 1, 1, "independent verification passed"),
    factor(
      "diffFocus",
      policy.weights.diffFocus,
      item.diffFocus,
      focusScore,
      item.diffFocus === undefined ? "change-budget evidence unavailable" : `largest budget usage ${(item.diffFocus * 100).toFixed(1)}%`,
    ),
    factor(
      "retries",
      policy.weights.retries,
      item.retries,
      inverse(item.retries, eligible.map((candidate) => candidate.retries)),
      `${item.retries} retries`,
    ),
    factor(
      "cost",
      policy.weights.cost,
      item.cost,
      inverse(item.cost, eligible.flatMap((candidate) => candidate.cost ?? [])),
      item.cost === undefined ? "complete cost evidence unavailable" : `$${item.cost.toFixed(4)}`,
    ),
    factor(
      "duration",
      policy.weights.duration,
      item.duration,
      inverse(item.duration, eligible.flatMap((candidate) => candidate.duration ?? [])),
      item.duration === undefined ? "duration evidence unavailable" : `${(item.duration / 1000).toFixed(1)}s`,
    ),
    factor("delivery", effectiveDeliveryWeight, deliveryRawValue, deliveryNormValue, deliveryEvidence),
  ];
  return {
    ...base,
    eligible: true,
    factors,
    totalScore: factors.reduce((total, current) => total + current.weightedScore, 0),
  };
}

export function scoreCandidates(
  competitionId: string,
  candidates: CompetitionCandidateInput[],
  policy: RankingPolicy,
  metadata: { evaluationId: string; createdAt: string },
): CompetitionEvaluationRecord {
  const effectivePolicy = {
    ...rankingPolicy(policy.weights),
    tieThreshold: policy.tieThreshold,
  };
  if (!Number.isFinite(effectivePolicy.tieThreshold) || effectivePolicy.tieThreshold < 0) {
    throw new Error("Tie threshold must be a finite non-negative number");
  }
  const measured = candidates.map(metrics);
  const eligible = measured.filter((candidate) => candidate.eligible);
  const scores = measured
    .map((candidate) => candidateScore(candidate, effectivePolicy, eligible))
    .sort((a, b) =>
      Number(b.eligible) - Number(a.eligible)
      || b.totalScore - a.totalScore
      || a.candidateId.localeCompare(b.candidateId));
  const ranked = scores.filter((candidate) => candidate.eligible);
  const complete = measured.every((candidate) => isTerminalTaskStatus(candidate.candidate.evidence.task.status));
  const tied = ranked.length > 1
    && Math.abs(ranked[0]!.totalScore - ranked[1]!.totalScore) < effectivePolicy.tieThreshold;
  const winner = complete && !tied ? ranked[0] : undefined;
  const positiveWeight = Math.max(
    0,
    ...ranked.map((candidate) => candidate.factors.reduce((total, current) => total + current.weight, 0)),
  );
  const gap = winner && ranked[1] ? winner.totalScore - ranked[1].totalScore : undefined;
  const confidence = gap === undefined
    ? 0.5
    : Math.max(0, Math.min(1, gap / positiveWeight));

  return {
    id: metadata.evaluationId,
    competitionId,
    policy: effectivePolicy,
    candidates: scores,
    ...(winner === undefined
      ? {}
      : {
          recommendation: {
            candidateId: winner.candidateId,
            confidence: Math.round(confidence * 100) / 100,
            reasoning: ranked.length === 1
              ? `${winner.providerName}/${winner.modelName} is the only verified candidate`
              : `${winner.providerName}/${winner.modelName} leads the next verified candidate by ${gap?.toFixed(3)}`,
          },
        }),
    createdAt: metadata.createdAt,
  };
}

export class CompetitionService {
  constructor(private readonly store: StateStore) {}

  score(
    competitionId: string,
    override: RankingPolicyOverride = {},
    settings?: CompetitionSettings,
  ): CompetitionEvaluationRecord {
    const competition = this.store.getCompetition(competitionId);
    const policy = rankingPolicy(
      { ...competition.rankingPolicy.weights, ...override },
      settings,
    );
    return this.scoreWithPolicy(competitionId, policy);
  }

  scoreWithPolicy(
    competitionId: string,
    policy: RankingPolicy,
  ): CompetitionEvaluationRecord {
    const candidates = this.readCandidates(competitionId);
    if (candidates.some(({ evidence }) => !isTerminalTaskStatus(evidence.task.status))) {
      throw new Error("Competition cannot be scored until every candidate is terminal");
    }
    const createdAt = timestamp();
    const evaluation = scoreCandidates(competitionId, candidates, policy, {
      evaluationId: randomUUID(),
      createdAt,
    });
    this.store.saveCompetitionEvaluation(evaluation);
    return evaluation;
  }

  /** Pure preview — scores terminal evidence without persisting to store. */
  previewScore(
    competitionId: string,
    policy: RankingPolicy,
  ): CompetitionEvaluationRecord {
    const candidates = this.readCandidates(competitionId);
    if (candidates.some(({ evidence }) => !isTerminalTaskStatus(evidence.task.status))) {
      throw new Error("Competition cannot be scored until every candidate is terminal");
    }
    const createdAt = timestamp();
    return scoreCandidates(competitionId, candidates, policy, {
      evaluationId: randomUUID(),
      createdAt,
    });
  }

  private readCandidates(competitionId: string): CompetitionCandidateInput[] {
    return this.store.getCompetitionCandidates(competitionId).map(
      (record): CompetitionCandidateInput => {
        const task = this.store.getTask(record.taskId);
        const events = this.store.listEvents(record.taskId);
        const verification = verificationFrom(events);
        return {
          candidateId: record.id,
          taskId: record.taskId,
          providerName: record.providerName,
          modelName: record.modelName,
          evidence: {
            task,
            attempts: this.store.listAttempts(record.taskId),
            events,
            ...(verification === undefined ? {} : { verification }),
          },
        };
      },
    );
  }
}

interface CompetitionScorer {
  scoreWithPolicy(
    competitionId: string,
    policy: RankingPolicy,
  ): CompetitionEvaluationRecord;
}

// --- Competition coordinator ---

/** Rebuild a legacy candidate ProviderSpec from provider defaults. The parent
 *  runtime is retained (legacy admissions share one runtime); source-only
 *  pricingRoute/keychainAccount fields are dropped so the candidate identity is
 *  rebuilt truthfully. */
function cloneSpec(
  original: TaskSpec,
  providerName: string,
  modelName: string,
  maxBudgetUsd: number | null | undefined,
  providerDefaults: import("./settings.js").ProviderDefaultsSettings,
): TaskSpec {
  const cloned = structuredClone(original);
  const name = providerName as TaskSpec["provider"]["name"];
  assertProviderRuntimePair(name, original.runtime.name);
  const providerDef = providerDefaults[name];
  // Provider, endpoint, Keychain identity, and billing route form one identity.
  // CandidateOverride cannot authorize source-only pricingRoute/keychainAccount
  // fields, so rebuild instead of partially mutating the cloned ProviderSpec.
  const rebuiltProvider: ProviderSpec = {
    name,
    model: modelName,
    endpoint: providerDef.defaultEndpoint,
    keychainService: providerDef.defaultKeychainService,
  };
  cloned.provider = rebuiltProvider;
  if (maxBudgetUsd !== undefined) {
    cloned.runtime.maxBudgetUsd = maxBudgetUsd;
  }
  return cloned;
}

/** Clone the contract spec from one candidate's own resolved Worker identity.
 *  Each candidate keeps its own provider/model/runtime/effort/policy and
 *  execution preference/mode — it never inherits the parent Task's runtime,
 *  Profile, or frozen execution truth, so a Claude Code Worker and a Grok
 *  Build Worker can truthfully compete in one Competition. */
function cloneSpecFromIdentity(
  original: TaskSpec,
  resolved: ResolvedWorkerSelection,
): TaskSpec {
  const cloned = structuredClone(original);
  cloned.provider = {
    name: resolved.provider as ProviderSpec["name"],
    model: resolved.model,
    endpoint: resolved.endpoint,
    keychainService: resolved.keychainService,
    ...(resolved.pricingRoute === undefined ? {} : { pricingRoute: resolved.pricingRoute }),
  };
  cloned.runtime = {
    ...cloned.runtime,
    name: resolved.runtime,
    executable: defaultExecutableForRuntime(resolved.runtime),
    effort: resolved.effort,
    maxBudgetUsd: resolved.maxBudgetUsd,
  };
  if (resolved.profileId !== undefined) {
    cloned.workerProfileId = resolved.profileId;
  }
  // Profile preference plus this Runtime's capability are the sole authority.
  // Forced unsupported modes fail here, still inside pre-mutation admission.
  const execution = resolveExecutionMode(
    resolved.executionPreference,
    executionCapabilitiesForRuntime(resolved.runtime),
  );
  cloned.executionPreference = execution.preference;
  cloned.executionMode = execution.mode;
  // Each candidate freezes its own Profile's network policy; legacy omission
  // clears any stale policy cloned from the source contract.
  return applyResolvedNetworkPolicy(resolved, cloned);
}

function identityKey(identity: CompetitionCandidateIdentity): string {
  return `${identity.provider}\0${identity.model}\0${identity.runtime}\0${identity.effort}`;
}

interface ResolvedCandidate {
  override: CandidateOverride;
  spec: TaskSpec;
  identity: CompetitionCandidateIdentity | undefined;
  providerName: string;
  modelName: string;
}

interface ResolvedAdmission {
  resolved: ResolvedCandidate[];
  reason: CompetitionReason | undefined;
  legacy: boolean;
}

function validateCandidateCount(count: number, settings: ForkLightSettings): void {
  const comp = settings.competition;
  if (count < comp.minCandidates) {
    throw new Error(
      `Competition requires at least ${comp.minCandidates} candidates, got ${count}`,
    );
  }
  if (count > comp.maxCandidates) {
    throw new Error(
      `Competition allows at most ${comp.maxCandidates} candidates, got ${count}`,
    );
  }
}

function validateLegacyCandidate(
  candidate: CandidateOverride,
  contractRuntime: string,
  settings: ForkLightSettings,
): void {
  const providerName = typeof candidate.providerName === "string"
    ? candidate.providerName.trim()
    : "";
  const modelName = typeof candidate.modelName === "string"
    ? candidate.modelName.trim()
    : "";
  if (!providerName || !modelName) {
    throw new Error("Every candidate must specify a nonempty providerName and modelName");
  }
  if (!isProviderName(providerName)) {
    throw new Error(
      `Unsupported provider: ${providerName}. Supported: ${providerNames().join(", ")}`,
    );
  }
  // Legacy admissions share the parent runtime; reject an illegal pairing
  // before any workspace preparation or Worker launch.
  assertProviderRuntimePair(providerName, contractRuntime);
  if (candidate.maxBudgetUsd !== undefined && candidate.maxBudgetUsd !== null) {
    if (!Number.isFinite(candidate.maxBudgetUsd) || candidate.maxBudgetUsd <= 0) {
      throw new Error(`Candidate maxBudgetUsd must be positive or null, got ${candidate.maxBudgetUsd}`);
    }
    if (candidate.maxBudgetUsd > settings.execution.maximumBudgetUsd) {
      throw new Error(
        `Candidate maxBudgetUsd $${candidate.maxBudgetUsd} exceeds configured maximum $${settings.execution.maximumBudgetUsd}`,
      );
    }
  }
}

/** Resolve and freeze every candidate's Worker identity and effective policy
 *  before any workspace preparation or Worker launch. New reasoned admissions
 *  resolve each candidate from its own saved Worker Profile; legacy explicit
 *  admissions keep the shared provider/model runtime and are stored
 *  reason-unavailable. Invalid pairings, duplicates, missing reasons, and count
 *  violations stop here. */
function resolveCandidateAdmission(
  contractSpec: TaskSpec,
  candidates: CandidateOverride[],
  settings: ForkLightSettings,
  options: CompetitionCreateOptions,
): ResolvedAdmission {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("Competition requires at least one candidate");
  }
  validateCandidateCount(candidates.length, settings);

  // A candidate is either a saved Worker Profile reference or a legacy
  // provider/model pair - never both. Reject ambiguous per-candidate fields
  // before determining the entrance kind.
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i]!;
    if (
      candidate.workerProfileId !== undefined
      && (candidate.providerName !== undefined || candidate.modelName !== undefined)
    ) {
      throw new Error(
        `candidates[${i}] must reference a Worker Profile or provider/model, not both`,
      );
    }
  }

  const profileBased = candidates.filter((c) => c.workerProfileId !== undefined).length;
  if (profileBased > 0 && profileBased !== candidates.length) {
    throw new Error(
      "Competition candidates must either all reference a Worker Profile or all use legacy provider/model",
    );
  }
  const newEntrance = profileBased > 0;

  let reason: CompetitionReason | undefined;
  let legacy: boolean;
  if (newEntrance) {
    if (options.reason === undefined) {
      throw new Error("A reasoned Competition admission requires a Main reason");
    }
    reason = validateCompetitionReason(options.reason);
    legacy = false;
  } else {
    // Legacy provider/model-only admission stays reason-unavailable. A reason
    // cannot be attached to a legacy entrance - that would invent history.
    if (options.reason !== undefined) {
      throw new Error(
        "Legacy provider/model Competition cannot carry a Main reason; use Worker Profile references for a reasoned admission",
      );
    }
    legacy = true;
  }

  const resolved: ResolvedCandidate[] = [];
  const seenLegacy = new Set<string>();
  const seenIdentity = new Set<string>();
  for (const candidate of candidates) {
    if (newEntrance) {
      const selection = resolveWorkerSelection(
        {
          workerProfileId: candidate.workerProfileId!,
          ...(candidate.maxBudgetUsd === undefined ? {} : { maxBudgetUsd: candidate.maxBudgetUsd }),
        },
        {
          execution: settings.execution,
          providerDefaults: settings.providerDefaults,
          workerProfiles: settings.workerProfiles,
          modelCatalog: settings.modelCatalog,
        },
      );
      const identity: CompetitionCandidateIdentity = {
        provider: selection.provider,
        model: selection.model,
        runtime: selection.runtime,
        effort: selection.effort,
        maxBudgetUsd: selection.maxBudgetUsd,
        ...(selection.profileId === undefined ? {} : { workerProfileId: selection.profileId }),
      };
      const key = identityKey(identity);
      if (seenIdentity.has(key)) {
        throw new Error(
          `Duplicate candidate identity: ${identity.provider}/${identity.model} (${identity.runtime}/${identity.effort})`,
        );
      }
      seenIdentity.add(key);
      const spec = cloneSpecFromIdentity(contractSpec, selection);
      resolved.push({
        override: candidate,
        spec,
        identity,
        providerName: identity.provider,
        modelName: identity.model,
      });
    } else {
      validateLegacyCandidate(candidate, contractSpec.runtime.name, settings);
      const providerName = typeof candidate.providerName === "string" ? candidate.providerName.trim() : "";
      const modelName = typeof candidate.modelName === "string" ? candidate.modelName.trim() : "";
      const key = `${providerName}:${modelName}`;
      if (seenLegacy.has(key)) {
        throw new Error(`Duplicate candidate: ${providerName}/${modelName}`);
      }
      seenLegacy.add(key);
      const spec = cloneSpec(contractSpec, providerName, modelName, candidate.maxBudgetUsd, settings.providerDefaults);
      resolved.push({
        override: candidate,
        spec,
        identity: undefined,
        providerName,
        modelName,
      });
    }
  }

  // New entrance: prove every selected Profile is launchable under the
  // existing readiness semantics (model, pairing, authentication, runtime,
  // permissions) before any workspace preparation. All-or-nothing: one
  // not-launchable Profile rejects the whole admission.
  if (newEntrance && options.readinessVerifier !== undefined) {
    const profileIds = resolved
      .map((r) => r.identity?.workerProfileId)
      .filter((id): id is string => typeof id === "string");
    options.readinessVerifier(profileIds);
  }

  return { resolved, reason, legacy };
}

export class CompetitionCoordinator {
  constructor(
    private readonly store: StateStore,
    private readonly settings: SettingsService,
    private readonly scorer: CompetitionScorer = new CompetitionService(store),
  ) {}

  async create(
    contractSpec: TaskSpec,
    contractTaskFile: string,
    candidates: CandidateOverride[],
    options: CompetitionCreateOptions = {},
  ): Promise<{ competition: CompetitionRecord; taskIds: string[] }> {
    const effectiveSettings = this.settings.get();
    // Resolve and freeze every candidate identity and the Main reason before any
    // workspace preparation or Worker launch. Invalid pairings, duplicates,
    // missing reasons, and count violations stop here.
    const admission = resolveCandidateAdmission(contractSpec, candidates, effectiveSettings, options);

    const competitionId = randomUUID();
    const createdAt = timestamp();
    const home = path.dirname(this.store.databasePath);
    const excludes = new Set(contractSpec.workspace.exclude);
    const createdTaskRoots: string[] = [];
    const competitionRoot = path.join(home, "competitions", competitionId);
    const snapshotDir = path.join(competitionRoot, "snapshot");
    const registrations: StagedTaskRegistration[] = [];
    const candidateRecords: CompetitionCandidateRecord[] = [];

    let persisted = false;
    try {
      // 1. Build a canonical snapshot from the live source exactly once.
      await mkdir(snapshotDir, { recursive: true, mode: 0o700 });
      const canonicalManifest = await buildManifest(contractSpec.project, excludes);
      const snapshotFilter = (source: string): boolean => {
        const relative = path.relative(contractSpec.project, source);
        for (const part of relative.split(path.sep)) {
          if (excludes.has(part)) return false;
        }
        try {
          return !lstatSync(source).isSymbolicLink();
        } catch {
          return false;
        }
      };
      await cp(contractSpec.project, snapshotDir, {
        recursive: true,
        preserveTimestamps: true,
        filter: snapshotFilter,
      });

      // 2. Create candidate tasks and clone every workspace from that snapshot.
      for (let ordinal = 0; ordinal < admission.resolved.length; ordinal++) {
        const resolved = admission.resolved[ordinal]!;
        const candidateSpec = resolved.spec;
        const providerName = resolved.providerName;
        const modelName = resolved.modelName;
        const taskId = randomUUID();
        const sessionId = randomUUID();

        const effectivePolicy = resolveTaskEffectivePolicy(
          candidateSpec,
          effectiveSettings,
          enforcementCapabilityForRuntime(candidateSpec.runtime.name),
        );
        const taskRecord = buildTaskRecord({
          spec: candidateSpec,
          taskFile: contractTaskFile,
          home,
          id: taskId,
          sessionId,
          createdAt,
          effectivePolicy,
        });

        const paths = taskPaths(home, taskId);
        createdTaskRoots.push(paths.root);
        const manifest = await prepareWorkspace(candidateSpec, paths, snapshotDir);

        // Symlinks are deliberately omitted from the canonical copy. The
        // byte-bearing file manifest must still match exactly.
        if (JSON.stringify(manifest.files) !== JSON.stringify(canonicalManifest.files)) {
          throw new Error(
            `Candidate ${providerName}/${modelName} manifest does not match the canonical snapshot`,
          );
        }

        registrations.push({
          task: taskRecord,
          creationEvent: {
            summary: `Competition candidate created: ${providerName}/${modelName}`,
            payload: {
              provider: providerName,
              model: modelName,
              competitionId,
              ordinal,
              ...(resolved.identity === undefined
                ? {}
                : {
                    runtime: resolved.identity.runtime,
                    effort: resolved.identity.effort,
                    ...(resolved.identity.workerProfileId === undefined
                      ? {}
                      : { workerProfileId: resolved.identity.workerProfileId }),
                  }),
            },
          },
          extraEvents: [
            {
              type: "workspace.prepared",
              summary: "Isolated workspace prepared from canonical competition snapshot",
              payload: {
                workspace: paths.workspace,
                baseline: paths.baseline,
                copiedFiles: manifest.files.length,
                skippedSymlinks: manifest.skippedSymlinks,
                linkedDependencies: manifest.linkedDependencies,
              },
            },
          ],
        });

        candidateRecords.push({
          id: randomUUID(),
          competitionId,
          taskId,
          ordinal,
          providerName,
          modelName,
          ...(resolved.identity === undefined ? {} : { identity: resolved.identity }),
        });
      }

      // 3. Persist everything atomically (snapshot the policy at creation time)
      const creationPolicy = rankingPolicy({}, effectiveSettings.competition);
      const competition: CompetitionRecord = {
        id: competitionId,
        name: `Competition: ${contractSpec.name}`,
        contractTaskId: registrations[0]!.task.id,
        status: "running",
        rankingPolicy: creationPolicy,
        createdAt,
        updatedAt: createdAt,
        ...(admission.reason === undefined ? {} : { reason: admission.reason }),
        ...(admission.legacy ? { legacy: true } : {}),
      };

      this.store.createCompetitionExecution(registrations, competition, candidateRecords);
      persisted = true;

      // Remove the temporary canonical snapshot after persistence.
      await rm(competitionRoot, { recursive: true, force: true }).catch(() => {});

      return {
        competition: this.store.getCompetition(competitionId),
        taskIds: registrations.map((r) => r.task.id),
      };
    } catch (error) {
      await rm(competitionRoot, { recursive: true, force: true }).catch(() => {});
      // Clean up any created task root directories (not yet persisted)
      if (!persisted) {
        for (const root of createdTaskRoots) {
          await rm(root, { recursive: true, force: true }).catch(() => {});
        }
      }
      throw error;
    }
  }

  reconcile(competitionId: string): CompetitionEvaluationRecord | undefined {
    const competition = this.store.getCompetition(competitionId);
    if (competition.status !== "running") {
      // A completed Competition may be evaluated once more after Main's exact
      // revise produced a newer Attempt on the selected Candidate. This is not
      // a retry loop: the ordinary correction allowance remains authoritative,
      // and only a terminal Attempt newer than the recorded revise can enter.
      if (competition.mainDecision?.decision !== "revise") return undefined;
      const revisedCandidate = this.store
        .getCompetitionCandidates(competitionId)
        .find((candidate) => candidate.id === competition.mainDecision?.candidateId);
      if (revisedCandidate === undefined) return undefined;
      const attempts = this.store.listAttempts(revisedCandidate.taskId);
      const latestAttempt = attempts.reduce<import("./types.js").AttemptRecord | undefined>(
        (latest, attempt) => latest === undefined || attempt.ordinal > latest.ordinal
          ? attempt
          : latest,
        undefined,
      );
      if (
        latestAttempt === undefined
        || latestAttempt.id === competition.mainDecision.attemptId
        || !isTerminalTaskStatus(latestAttempt.status)
      ) {
        return undefined;
      }
      const latestEvaluation = this.store
        .listCompetitionEvaluations(competitionId)
        .at(-1);
      if (
        latestEvaluation !== undefined
        && latestAttempt.finishedAt !== undefined
        && latestEvaluation.createdAt >= latestAttempt.finishedAt
      ) {
        return undefined;
      }
    }

    const candidateRecords = this.store.getCompetitionCandidates(competitionId);
    const terminal = candidateRecords.every((candidate) => {
      const task = this.store.getTask(candidate.taskId);
      return isTerminalTaskStatus(task.status);
    });
    if (!terminal) return undefined;

    try {
      // Use the immutable creation-time rankingPolicy, not current effective settings
      const evaluation = this.scorer.scoreWithPolicy(
        competitionId,
        competition.rankingPolicy,
      );
      return evaluation;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Persist the error visibly on the competition record
      this.store.updateCompetition(competitionId, {
        status: "completed",
        finishedAt: timestamp(),
        error: message,
      });
      return undefined;
    }
  }

  /** Resolve the candidate record for a competition, or throw. */
  private requireCandidate(competitionId: string, candidateId: string): CompetitionCandidateRecord {
    const records = this.store.getCompetitionCandidates(competitionId);
    const record = records.find((c) => c.id === candidateId);
    if (record === undefined) {
      throw new Error(`Candidate ${candidateId} does not belong to competition ${competitionId}`);
    }
    return record;
  }

  /** Record a Competition-level Main decision bound to one exact Candidate
   *  Revision. It is an explicit derivation of the chosen candidate Task's
   *  latest Main Review: the referenced attempt, verification, and revision
   *  must match that Task-level Main Review exactly. The Task-level Main Review
   *  remains the canonical exact-revision authority; this decision never
   *  authorizes a retry, successor, or Integration by itself. */
  recordMainDecision(
    competitionId: string,
    candidateId: string,
    decision: CompetitionMainDecisionKind,
    reason: string,
  ): CompetitionMainDecision {
    if (decision !== "accept" && decision !== "revise" && decision !== "reject") {
      throw new Error("Competition Main decision must be accept, revise, or reject");
    }
    const trimmedReason = typeof reason === "string" ? reason.trim() : "";
    if (trimmedReason.length === 0 || trimmedReason.length > 1000) {
      throw new Error("Competition Main decision reason must be 1-1000 characters");
    }
    // Validate the competition exists and the candidate belongs to it.
    const candidate = this.requireCandidate(competitionId, candidateId);
    const events = this.store.listEvents(candidate.taskId);
    const review = latestMainReview(events);
    if (review === undefined) {
      throw new Error(
        "Competition Main decision requires a Task-level Main Review on the candidate first",
      );
    }
    if (review.decision !== decision) {
      throw new Error(
        `Competition Main decision ${decision} does not match the candidate's latest Main Review ${review.decision}`,
      );
    }
    // Every Competition decision is about one immutable Candidate Revision.
    // This is required for revise as well as accept: otherwise a correction
    // grant could accidentally target a newer Diff than the one Main reviewed.
    const task = this.store.getTask(candidate.taskId);
    const revision = resolveRevisionForAttempt(
      events,
      review.attemptId,
      review.verificationEventSequence,
    );
    if (
      revision === undefined
      || revision.taskId !== candidate.taskId
      || !candidateRevisionMatchesCurrentDiff(task, revision)
      || (review.candidateRevisionId !== undefined && review.candidateRevisionId !== revision.id)
      || (review.acceptedPatchDigest !== undefined && review.acceptedPatchDigest !== revision.patchDigest)
    ) {
      throw new Error(
        "Competition Main decision requires the candidate's exact Candidate Revision id and patch digest for the current Diff",
      );
    }
    const result: CompetitionMainDecision = {
      decision,
      candidateId,
      taskId: candidate.taskId,
      attemptId: review.attemptId,
      verificationEventSequence: review.verificationEventSequence,
      candidateRevisionId: revision.id,
      acceptedPatchDigest: revision.patchDigest,
      reason: trimmedReason,
      createdAt: timestamp(),
    };
    this.store.updateCompetition(competitionId, { mainDecision: result });
    this.store.addEvent(
      candidate.taskId,
      review.attemptId,
      "competition.main-decision.completed",
      `Competition Main decision: ${decision}`,
      result,
    );
    return result;
  }

  /** Record bounded retained-partial evidence for one non-selected Candidate.
   *  Reusable paths are validated against that Candidate's latest revision
   *  affected set and remaining gaps describe what a future M2 successor would
   *  still need. Stores evidence only - it never starts a Worker, retry,
   *  successor, or Integration. */
  recordRetainedPartial(
    competitionId: string,
    candidateId: string,
    reusablePaths: unknown,
    remainingGaps: unknown,
  ): CompetitionRetainedPartial {
    const competition = this.store.getCompetition(competitionId);
    // Retained-partial preserves reusable work from a failed or non-selected
    // Candidate. It must never be recorded for the final accepted Candidate:
    // that candidate is the delivered choice, not partial work for M2.
    if (
      competition.mainDecision?.decision === "accept"
      && competition.mainDecision.candidateId === candidateId
    ) {
      throw new Error(
        "retained-partial cannot be recorded for the final accepted Candidate",
      );
    }
    const candidate = this.requireCandidate(competitionId, candidateId);
    const events = this.store.listEvents(candidate.taskId);
    const revision = resolveLatestRevision(events);
    if (revision === undefined || revision.taskId !== candidate.taskId) {
      throw new Error(
        "retained-partial requires the candidate's latest CandidateRevision evidence",
      );
    }
    // Reuse the canonical gap-contract builder so path-safety, counts, and
    // gap-text bounds are enforced identically to Main correction contracts.
    const contract = buildCandidateGapContract(
      revision.id,
      reusablePaths,
      remainingGaps,
      revision.affectedPaths,
    );
    const entry: CompetitionRetainedPartial = {
      candidateId,
      taskId: candidate.taskId,
      reusablePaths: contract.reusablePaths,
      remainingGaps: contract.remainingGaps,
      candidateRevisionId: revision.id,
    };
    const current = this.store.getCompetition(competitionId).retainedPartial ?? [];
    const others = current.filter((item) => item.candidateId !== candidateId);
    this.store.updateCompetition(competitionId, { retainedPartial: [...others, entry] });
    this.store.addEvent(
      candidate.taskId,
      revision.attemptId,
      "competition.retained-partial.completed",
      "Main retained bounded partial Candidate evidence",
      {
        competitionId,
        candidateId,
        reusablePathCount: entry.reusablePaths.length,
        remainingGapCount: entry.remainingGaps.length,
        candidateRevisionId: revision.id,
      },
    );
    return entry;
  }
}
