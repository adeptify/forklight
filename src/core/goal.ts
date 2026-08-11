/**
 * Durable Goal supervision over a four-to-eight Task Work Plan.
 *
 * Boundaries:
 *   - Reuses the existing Plan scheduler; never launches undeclared work.
 *   - Never auto-corrects, auto-reviews, auto-accepts, auto-integrates,
 *     commits, or pushes.
 *   - References CandidateRevision, Main Review, Review Graph, and
 *     Integration authorities without copying private content.
 *   - Privacy-safe projections only: no raw patch, resultText, prompts,
 *     absolute paths, credentials, or private artifact paths.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { StateStore } from "../state/store.js";
import {
  latestMainReview,
  latestVerificationEvent,
  resolveLatestRevision,
} from "./candidate-revision.js";
import { validateAcceptanceAmendment } from "./main-remediation.js";
import {
  expandHome,
  requireNonEmptyString,
  requireObject,
} from "./parse-helpers.js";
import { assertWorkPlan, type WorkPlan } from "./plan.js";
import type { TaskPolicy } from "./settings.js";
import { isoTimestamp as timestamp } from "./time.js";
import type {
  AttemptStatus,
  CandidateHandoffRecord,
  EventRecord,
  FrozenWorkerIdentity,
  GoalCounters,
  GoalMilestoneGate,
  GoalMilestoneRecord,
  GoalNextActionCode,
  GoalPolicy,
  GoalReasonCode,
  GoalRecord,
  GoalStatus,
  IntegrationResultRecord,
  MainReviewDecision,
  RemediationAcceptanceBasis,
  RemediationCheckRecord,
  TaskRecord,
  TaskStatus,
} from "./types.js";

/** Compact delivery provenance for a satisfied integration milestone. */
export type GoalDeliveryBasis =
  | "exact-candidate-integration"
  | "original-acceptance"
  | "amended-acceptance";

/** Task statuses that mean Goal-owned work is still under Task authority. */
const GOAL_IN_FLIGHT_STATUSES = new Set<TaskStatus>([
  "queued",
  "preparing",
  "running",
  "verifying",
]);

// --- Constants ---

export const GOAL_VERSION = 1 as const;
export const GOAL_MIN_ITEMS = 4;
export const GOAL_MAX_ITEMS = 8;
export const GOAL_REASON_MAX = 500;

const GATES = new Set<GoalMilestoneGate>(["machine", "main-accept", "integration"]);

// --- Loaded Goal (pre-persistence) ---

export interface GoalMilestoneSpec {
  itemId: string;
  gate: GoalMilestoneGate;
}

/** One ordered Goal phase: a validated Plan plus its local milestone gates. */
export interface GoalPhaseSpec {
  planFile: string;
  plan: WorkPlan;
  milestones: GoalMilestoneSpec[];
}

/**
 * Normalized loaded Goal for both file versions. v1 (one Plan) and v2
 * (two or more ordered Plans) collapse into the same ordered `phases` model.
 * The legacy `planFile` / `plan` / `milestones` fields alias phase zero so
 * v1 callers stay byte-compatible.
 */
export interface LoadedGoal {
  version: 1 | 2;
  name: string;
  objective: string;
  goalFile: string;
  /** Legacy primary Plan identity; equals phases[0].planFile. */
  planFile: string;
  /** Legacy primary Plan; equals phases[0].plan. */
  plan: WorkPlan;
  /** Legacy primary milestones; equals phases[0].milestones. */
  milestones: GoalMilestoneSpec[];
  /** Ordered phases for both versions. v2 requires at least two entries. */
  phases: GoalPhaseSpec[];
  policy: GoalPolicy;
}

export interface GoalLoadReport {
  passed: boolean;
  issues: string[];
  goal?: LoadedGoal;
}

// --- Privacy-safe projection ---

export interface GoalMilestoneView {
  itemId: string;
  /** Owning Plan identity; present on plan-qualified (v2 and migrated) rows. */
  planId?: string;
  itemIndex: number;
  /** Original immutable Plan Task id for this milestone. */
  taskId?: string;
  taskName?: string;
  taskStatus?: TaskStatus;
  /**
   * Effective Task id used for gates (original, or direct Goal-Task handoff
   * successor once authoritative). Always the Plan Task when no handoff.
   */
  effectiveTaskId?: string;
  effectiveTaskName?: string;
  effectiveTaskStatus?: TaskStatus;
  /** Present when a direct Goal-Task handoff is authoritative for this milestone. */
  handoff?: {
    handoffId: string;
    status: CandidateHandoffRecord["status"];
    successorTaskId: string;
    destinationWorkerProfileId: string;
    reusablePathCount: number;
    remainingGapCount: number;
    nextAction: CandidateHandoffRecord["nextAction"];
    failureCode?: CandidateHandoffRecord["failureCode"];
  };
  gate: GoalMilestoneGate;
  satisfied: boolean;
  reasonCode: GoalReasonCode;
  reason: string;
  /**
   * Compact delivery provenance when the integration gate is satisfied.
   * Distinguishes exact Candidate Integration from Main-repaired source under
   * original or amended acceptance. Never carries commands, reasons, or paths.
   */
  deliveryBasis?: GoalDeliveryBasis;
  candidateDigestPrefix?: string;
  reviewGraphStatus?: string;
  reviewResultUsable?: boolean;
  mainDecision?: MainReviewDecision["decision"];
  mainDecisionFresh?: boolean;
  integrationStatus?: IntegrationResultRecord["status"] | "none";
  worker?: FrozenWorkerIdentity;
  nextActionCode: GoalNextActionCode;
  nextAction: string;
}

/**
 * Canonical read-only lineage for one Goal milestone.
 * Original Plan Task identity is always preserved; once a direct Goal-Task
 * handoff is durable, the successor exclusively supplies gate evidence.
 */
export interface EffectiveMilestoneLineage {
  originalTaskId?: string;
  effectiveTaskId?: string;
  handoff?: CandidateHandoffRecord;
  originalTask?: TaskRecord;
  effectiveTask?: TaskRecord;
}

export interface GoalView {
  schemaVersion: 1;
  goalId: string;
  name: string;
  objective: string;
  /** Legacy primary Plan identity; equals planIds[0] when associations exist. */
  planId: string;
  /**
   * Every Plan owned by this Goal in stable ordinal order.
   * v2 phases are milestone-supervised; ownership-attached later Plans remain
   * associated only until a future slice supervises them.
   */
  planIds: string[];
  /**
   * Core-selected current phase: the first supervised phase with an
   * unsatisfied milestone. Absent when every supervised milestone is
   * satisfied (terminal Goal); Hub falls back to the last phase for history.
   */
  currentPlanId?: string;
  status: GoalStatus;
  reasonCode: GoalReasonCode;
  reason: string;
  policy: GoalPolicy;
  counters: GoalCounters;
  evidenceDigestPrefix: string;
  evidenceAt: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  stoppedAt?: string;
  currentMilestone?: {
    itemId: string;
    gate: GoalMilestoneGate;
    taskId?: string;
    taskName?: string;
  };
  whatJustHappened: string;
  whatIsWaiting: string;
  nextActionCode: GoalNextActionCode;
  nextAction: string;
  milestones: GoalMilestoneView[];
  progress: {
    total: number;
    satisfied: number;
    percent: number;
  };
}

/** Per-Plan registration facts in ordered phase order. V2 callers use these
 *  for an unambiguous Task map when Plan-local item IDs repeat across phases. */
export interface GoalPlanRegistrationResult {
  planId: string;
  taskIdsByItemId: Record<string, string>;
}

export interface GoalRegistrationResult {
  goalId: string;
  /** Legacy primary Plan identity (phase zero). */
  planId: string;
  /** Legacy primary Plan Task map (phase zero). */
  taskIdsByItemId: Record<string, string>;
  /** Ordered per-Plan registration results for every phase. */
  planResults: GoalPlanRegistrationResult[];
}

export interface GoalAdvanceResult {
  goal: GoalView;
  advanced: boolean;
  newEvidence: boolean;
  noNewEvidenceCycles: number;
}

// --- Helpers ---

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function digestPrefix(digest: string | undefined): string | undefined {
  if (digest === undefined || digest.length === 0) return undefined;
  return digest.slice(0, 12);
}

function isPositiveIntOrNull(value: unknown, label: string, issues: string[]): number | null {
  if (value === null) return null;
  if (value === undefined) {
    issues.push(`${label} is required (use null for unlimited)`);
    return null;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    issues.push(`${label} must be null or a positive integer`);
    return null;
  }
  return value;
}

function isNonNegativeInt(value: unknown, label: string, issues: string[]): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    issues.push(`${label} must be a non-negative integer`);
    return 0;
  }
  return value;
}

function isGate(value: unknown): value is GoalMilestoneGate {
  return typeof value === "string" && GATES.has(value as GoalMilestoneGate);
}

function reasonText(code: GoalReasonCode, detail?: string): string {
  switch (code) {
    case "main-stop":
      return "Main stopped this Goal. History remains readable; active Tasks use Task authority.";
    case "correction-cap":
      return "Goal correction allowance is exhausted. Main must decide without another automatic correction.";
    case "review-cap":
      return "Goal review-round allowance is exhausted. Main must decide without another review assignment.";
    case "no-new-evidence-cap":
      return "Main advanced without new evidence too many times. Goal stopped; no Worker was launched.";
    case "duration-exceeded":
      return "Goal total duration limit was reached. Future Task admission is blocked; running Workers were not killed.";
    case "no-progress":
      return "No authoritative milestone evidence changed within the Goal no-progress window. Future Task admission is blocked; running Workers were not killed.";
    case "milestone-failed":
      return detail ?? "A Goal milestone Task failed. Downstream work stays blocked.";
    case "waiting-machine":
      return detail ?? "Waiting for machine verification success on this milestone.";
    case "waiting-main-accept":
      return detail ?? "Waiting for a fresh exact Main accept on this milestone.";
    case "waiting-integration":
      return detail ?? "Waiting for successful Integration of the exact accepted Candidate.";
    case "waiting-task":
      return detail ?? "Waiting for the linked Task to finish or become ready.";
    case "goal-completed":
      return "Every milestone gate is satisfied.";
    case "none":
    default:
      return detail ?? "Goal is progressing through its Plan Tasks.";
  }
}

// --- Parser ---

export async function loadGoal(
  goalFileInput: string,
  policy?: TaskPolicy,
): Promise<GoalLoadReport> {
  const goalFile = path.resolve(expandHome(goalFileInput));
  const rawText = await readFile(goalFile, "utf8");
  const root = requireObject(
    goalFile.endsWith(".json") ? JSON.parse(rawText) : YAML.parse(rawText),
    "goal",
  );
  const issues: string[] = [];

  const rawVersion = root.version;
  if (rawVersion !== 1 && rawVersion !== 2) issues.push("goal.version must be 1 or 2");
  // Narrow the parsed file version to the supported literal union without
  // relying on control-flow narrowing of `unknown`. The invalid fallback keeps
  // parsing only to accumulate the version issue; the final guard rejects the
  // load before any record is produced.
  const version: 1 | 2 = rawVersion === 1 ? 1 : rawVersion === 2 ? 2 : 1;
  const name = typeof root.name === "string" && root.name.trim()
    ? root.name.trim()
    : "";
  if (!name) issues.push("goal.name must be a non-empty string");
  const objective = typeof root.objective === "string" && root.objective.trim()
    ? root.objective.trim()
    : "";
  if (!objective) issues.push("goal.objective must be a non-empty string");

  const policyRaw = requireObject(root.policy ?? {}, "goal.policy");
  const maxDurationMs = isPositiveIntOrNull(policyRaw.maxDurationMs, "goal.policy.maxDurationMs", issues);
  // Treat missing maxDurationMs as null (unlimited) only when key present as null.
  // Require explicit key so null survives intentionally.
  if (!("maxDurationMs" in policyRaw)) {
    issues.push("goal.policy.maxDurationMs is required (use null for unlimited)");
  }
  const noProgressTimeoutMs = isPositiveIntOrNull(
    policyRaw.noProgressTimeoutMs,
    "goal.policy.noProgressTimeoutMs",
    issues,
  );
  if (!("noProgressTimeoutMs" in policyRaw)) {
    issues.push("goal.policy.noProgressTimeoutMs is required (use null for unlimited)");
  }
  const maxCorrectionRounds = isNonNegativeInt(
    policyRaw.maxCorrectionRounds,
    "goal.policy.maxCorrectionRounds",
    issues,
  );
  const maxReviewRounds = isNonNegativeInt(
    policyRaw.maxReviewRounds,
    "goal.policy.maxReviewRounds",
    issues,
  );
  const maxNoNewEvidenceCycles = isNonNegativeInt(
    policyRaw.maxNoNewEvidenceCycles,
    "goal.policy.maxNoNewEvidenceCycles",
    issues,
  );

  // Preserve explicit null through the loaded object (JSON.stringify keeps null).
  const frozenPolicy: GoalPolicy = {
    maxDurationMs: policyRaw.maxDurationMs === null ? null : maxDurationMs,
    noProgressTimeoutMs: policyRaw.noProgressTimeoutMs === null ? null : noProgressTimeoutMs,
    maxCorrectionRounds,
    maxReviewRounds,
    maxNoNewEvidenceCycles,
  };

  /** Shared per-Plan milestone parsing. Returns parsed specs and accumulates issues. */
  const parseMilestones = (
    raw: unknown,
    label: string,
  ): { milestones: GoalMilestoneSpec[]; seen: Set<string> } => {
    if (!Array.isArray(raw)) {
      issues.push(`${label} must be an array`);
    }
    const rawMilestones = Array.isArray(raw) ? raw : [];
    const parsed: GoalMilestoneSpec[] = [];
    const seen = new Set<string>();
    rawMilestones.forEach((value, index) => {
      const item = requireObject(value, `${label}[${index}]`);
      const itemId = requireNonEmptyString(item.itemId, `${label}[${index}].itemId`);
      if (seen.has(itemId)) issues.push(`goal milestone itemId ${itemId} is duplicated`);
      seen.add(itemId);
      if (!isGate(item.gate)) {
        issues.push(
          `${label}[${index}].gate must be machine, main-accept, or integration`,
        );
      }
      parsed.push({
        itemId,
        gate: isGate(item.gate) ? item.gate : "machine",
      });
    });
    return { milestones: parsed, seen };
  };

  const phases: GoalPhaseSpec[] = [];

  if (version === 1) {
    // --- v1: one Plan + top-level milestones (byte-compatible) ---
    const planField = root.planFile ?? root.plan;
    if (typeof planField !== "string" || planField.trim() === "") {
      issues.push("goal.planFile (or plan) must be a non-empty string");
    }
    const planFile = typeof planField === "string"
      ? path.resolve(path.dirname(goalFile), expandHome(planField.trim()))
      : "";

    if (!Array.isArray(root.milestones)) {
      issues.push("goal.milestones must be an array");
    }
    const rawMilestones = Array.isArray(root.milestones) ? root.milestones : [];
    if (rawMilestones.length < GOAL_MIN_ITEMS || rawMilestones.length > GOAL_MAX_ITEMS) {
      issues.push(
        `goal.milestones must contain ${GOAL_MIN_ITEMS} to ${GOAL_MAX_ITEMS} items (got ${rawMilestones.length})`,
      );
    }
    const { milestones, seen } = parseMilestones(rawMilestones, "goal.milestones");

    let plan: WorkPlan | undefined;
    if (planFile) {
      try {
        const report = await assertWorkPlan(planFile, policy);
        plan = report.plan;
        if (plan.items.length !== milestones.length) {
          issues.push(
            `goal milestones (${milestones.length}) must match plan items (${plan.items.length})`,
          );
        }
        if (plan.items.length < GOAL_MIN_ITEMS || plan.items.length > GOAL_MAX_ITEMS) {
          issues.push(
            `goal plan must contain ${GOAL_MIN_ITEMS} to ${GOAL_MAX_ITEMS} tasks (got ${plan.items.length})`,
          );
        }
        const planIds = new Set(plan.items.map((item) => item.id));
        for (const milestone of milestones) {
          if (!planIds.has(milestone.itemId)) {
            issues.push(`goal milestone ${milestone.itemId} is not a plan item`);
          }
        }
        for (const item of plan.items) {
          if (!seen.has(item.id)) {
            issues.push(`plan item ${item.id} is missing a goal milestone gate`);
          }
        }
      } catch (error) {
        issues.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (issues.length > 0 || plan === undefined || !name || !objective) {
      return { passed: false, issues };
    }
    phases.push({ planFile: plan.planFile, plan, milestones });
  } else if (version === 2) {
    // --- v2: two or more ordered phase Plans with local milestone gates ---
    if (!Array.isArray(root.plans)) {
      issues.push("goal.plans must be an array");
    }
    const rawPlans = Array.isArray(root.plans) ? root.plans : [];
    if (rawPlans.length < 2) {
      issues.push("goal.plans must contain at least two ordered Plans");
    }
    const seenPlanFiles = new Set<string>();
    for (let index = 0; index < rawPlans.length; index += 1) {
      const entry = requireObject(rawPlans[index], `goal.plans[${index}]`);
      const phasePlanField = entry.planFile ?? entry.plan;
      if (typeof phasePlanField !== "string" || phasePlanField.trim() === "") {
        issues.push(`goal.plans[${index}].planFile must be a non-empty string`);
        continue;
      }
      const phasePlanFile = path.resolve(
        path.dirname(goalFile),
        expandHome(phasePlanField.trim()),
      );
      if (seenPlanFiles.has(phasePlanFile)) {
        issues.push(`goal.plans[${index}].planFile is duplicated`);
      }
      seenPlanFiles.add(phasePlanFile);
      const { milestones, seen } = parseMilestones(
        entry.milestones,
        `goal.plans[${index}].milestones`,
      );
      try {
        const report = await assertWorkPlan(phasePlanFile, policy);
        const plan = report.plan;
        if (plan.items.length !== milestones.length) {
          issues.push(
            `goal.plans[${index}] milestones (${milestones.length}) must match plan items (${plan.items.length})`,
          );
        }
        const planIds = new Set(plan.items.map((item) => item.id));
        for (const milestone of milestones) {
          if (!planIds.has(milestone.itemId)) {
            issues.push(`goal milestone ${milestone.itemId} is not a plan item in phase ${index}`);
          }
        }
        for (const item of plan.items) {
          if (!seen.has(item.id)) {
            issues.push(`plan item ${item.id} is missing a goal milestone gate in phase ${index}`);
          }
        }
        phases.push({ planFile: plan.planFile, plan, milestones });
      } catch (error) {
        issues.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (issues.length > 0 || phases.length < 2 || !name || !objective) {
      return { passed: false, issues };
    }
  }

  if (issues.length > 0 || phases.length === 0 || !name || !objective) {
    return { passed: false, issues };
  }

  return {
    passed: true,
    issues: [],
    goal: {
      version,
      name,
      objective,
      goalFile,
      planFile: phases[0]!.planFile,
      plan: phases[0]!.plan,
      milestones: phases[0]!.milestones,
      phases,
      policy: frozenPolicy,
    },
  };
}

export async function assertGoal(
  goalFileInput: string,
  policy?: TaskPolicy,
): Promise<LoadedGoal> {
  const report = await loadGoal(goalFileInput, policy);
  if (!report.passed || report.goal === undefined) {
    throw new Error(
      `Goal quality gate failed:\n${report.issues.map((issue) => `- ${issue}`).join("\n")}`,
    );
  }
  return report.goal;
}

// --- Gate evaluation (read-only; references existing authorities) ---

export interface MilestoneGateEvidence {
  satisfied: boolean;
  reasonCode: GoalReasonCode;
  reason: string;
  /** Present only when the integration gate is satisfied by a known delivery authority. */
  deliveryBasis?: GoalDeliveryBasis;
  candidateDigestPrefix?: string;
  reviewGraphStatus?: string;
  reviewResultUsable?: boolean;
  mainDecision?: MainReviewDecision["decision"];
  mainDecisionFresh?: boolean;
  integrationStatus?: IntegrationResultRecord["status"] | "none";
  nextActionCode: GoalNextActionCode;
  nextAction: string;
}

function latestEventOfType(
  events: readonly EventRecord[],
  type: EventRecord["type"],
): EventRecord | undefined {
  return events
    .filter((event) => event.type === type)
    .reduce<EventRecord | undefined>(
      (latest, event) =>
        latest === undefined || event.sequence > latest.sequence ? event : latest,
      undefined,
    );
}

function remediationCommandsAllPassed(
  commands: RemediationCheckRecord["commands"],
): boolean {
  return commands.length >= 1
    && commands.every(
      (command) =>
        typeof command.exitCode === "number"
        && command.exitCode === 0
        && command.timedOut !== true,
    );
}

/** Fresh exact Main accept bound to the current Attempt / verification / revision. */
export function hasFreshMainAccept(store: StateStore, taskId: string): boolean {
  const task = store.getTask(taskId);
  if (task.status !== "succeeded") return false;
  const events = store.listEvents(taskId);
  const review = latestMainReview(events);
  if (review === undefined || review.decision !== "accept") return false;
  const verification = latestVerificationEvent(events);
  if (verification === undefined || verification.attemptId === undefined) return false;
  if (review.attemptId !== verification.attemptId) return false;
  if (review.verificationEventSequence !== verification.sequence) return false;
  if (
    task.currentAttemptId !== undefined
    && review.attemptId !== task.currentAttemptId
  ) {
    return false;
  }
  const latestRevision = resolveLatestRevision(events);
  // Goal gates are intentionally fail-closed: a generic/legacy accept without
  // an exact current Candidate binding must never unlock downstream work.
  if (latestRevision === undefined) return false;
  if (
    review.candidateRevisionId !== latestRevision.id
    || review.acceptedPatchDigest !== latestRevision.patchDigest
  ) {
    return false;
  }
  // Terminal Review Graph evidence after the accept requires a fresher accept.
  try {
    const graph = store.getReviewGraphByCandidateTaskId(taskId);
    if (graph?.terminalEvidenceSequence !== undefined) {
      const mainEvent = events
        .filter((event) => event.type === "main-review.completed")
        .reduce<(typeof events)[number] | undefined>(
          (latest, event) =>
            latest === undefined || event.sequence > latest.sequence ? event : latest,
          undefined,
        );
      if (mainEvent === undefined || mainEvent.sequence <= graph.terminalEvidenceSequence) {
        return false;
      }
    }
  } catch {
    // No graph table row is fine.
  }
  return true;
}

/** Successful Integration apply bound to the exact accepted Candidate digest. */
export function hasSuccessfulExactIntegration(store: StateStore, taskId: string): boolean {
  if (!hasFreshMainAccept(store, taskId)) return false;
  const events = store.listEvents(taskId);
  const review = latestMainReview(events);
  if (review?.acceptedPatchDigest === undefined) return false;
  const results = store.listIntegrationResults(taskId);
  for (const result of results) {
    if (result.status !== "applied") continue;
    const receipt = store.getIntegrationReceipt(result.receiptId);
    if (receipt === undefined) continue;
    if (receipt.patchDigest !== review.acceptedPatchDigest) {
      continue;
    }
    return true;
  }
  return false;
}

/**
 * Compact remediation facts for Goal evidence/gates.
 * Absent acceptanceBasis means original-acceptance (legacy records).
 * Never returns command text, private reason, paths, or secrets.
 */
export function readEffectiveRemediationDispositionFacts(
  store: StateStore,
  taskId: string,
): {
  status: "verified-repaired-delivered";
  checkId: string;
  acceptanceBasis: RemediationAcceptanceBasis;
} | undefined {
  try {
    const disposition = store.getRemediationDisposition(taskId);
    if (disposition === undefined) return undefined;
    if (disposition.status !== "verified-repaired-delivered") return undefined;
    return {
      status: "verified-repaired-delivered",
      checkId: disposition.checkId,
      acceptanceBasis: disposition.acceptanceBasis === "amended-acceptance"
        ? "amended-acceptance"
        : "original-acceptance",
    };
  } catch {
    // Corrupt disposition must not crash Goal gate/evidence reads.
    return undefined;
  }
}

/**
 * True when Main repaired the current source and verified the original
 * stored acceptance commands. Compact disposition only (legacy-compatible).
 * Amended acceptance never qualifies through this predicate.
 */
export function hasQualifyingOriginalAcceptanceRemediation(
  store: StateStore,
  taskId: string,
): boolean {
  const facts = readEffectiveRemediationDispositionFacts(store, taskId);
  return facts !== undefined && facts.acceptanceBasis === "original-acceptance";
}

/**
 * Compact qualifying fact for a complete, fresh amended-acceptance remediation
 * delivery chain. Fail-closed: never trusts a compact disposition alone, never
 * mutates, and never projects command text, private reason, paths, or logs.
 */
export function resolveQualifyingAmendedAcceptanceRemediation(
  store: StateStore,
  taskId: string,
): {
  status: "verified-repaired-delivered";
  checkId: string;
  acceptanceBasis: "amended-acceptance";
} | undefined {
  try {
    const task = store.getTask(taskId);
    if (
      task.status !== "succeeded"
      && task.status !== "failed"
      && task.status !== "interrupted"
    ) {
      return undefined;
    }
    if (task.currentAttemptId === undefined) return undefined;

    let disposition;
    try {
      disposition = store.getRemediationDisposition(taskId);
    } catch {
      return undefined;
    }
    if (disposition === undefined) return undefined;
    if (disposition.status !== "verified-repaired-delivered") return undefined;
    if (disposition.acceptanceBasis !== "amended-acceptance") return undefined;
    if (
      typeof disposition.checkId !== "string"
      || disposition.checkId.length < 1
      || typeof disposition.createdAt !== "string"
      || disposition.createdAt.length < 1
      || typeof disposition.amendedCommandCount !== "number"
      || !Number.isSafeInteger(disposition.amendedCommandCount)
      || disposition.amendedCommandCount < 1
      || disposition.reasonCode !== "contradictory-acceptance"
    ) {
      return undefined;
    }

    let checks: RemediationCheckRecord[];
    try {
      checks = store.getRemediationChecks(taskId);
    } catch {
      // Corrupt private check records must never unlock a Goal.
      return undefined;
    }
    const check = checks.find((entry) => entry.id === disposition.checkId);
    if (check === undefined) return undefined;
    if (check.taskId !== taskId) return undefined;
    if (check.status !== "passed") return undefined;
    if (check.createdAt !== disposition.createdAt) return undefined;
    if (check.amendment === undefined) return undefined;
    if (check.amendment.reasonCode !== "contradictory-acceptance") return undefined;
    if (
      !Number.isSafeInteger(check.amendment.verificationEventSequence)
      || check.amendment.verificationEventSequence < 1
    ) {
      return undefined;
    }
    if (check.amendment.replacements.length !== disposition.amendedCommandCount) {
      return undefined;
    }
    if (check.amendment.amendedCommands.length !== check.commands.length) {
      return undefined;
    }
    if (!remediationCommandsAllPassed(check.commands)) return undefined;

    // Reuse the canonical amendment validator instead of trusting the private
    // record's shape alone. This re-proves exact failed-slot replacement,
    // preservation of every originally passing command, and current
    // Attempt/verification/Main-revise binding. The executed commands must be
    // byte-for-byte the suite derived by that validator.
    const validatedAmendment = validateAcceptanceAmendment(store, task, {
      verificationEventSequence: check.amendment.verificationEventSequence,
      reasonCode: check.amendment.reasonCode,
      replacements: check.amendment.replacements,
    });
    if (validatedAmendment.amendedCommandCount !== disposition.amendedCommandCount) {
      return undefined;
    }
    if (
      validatedAmendment.amendedCommands.length !== check.amendment.amendedCommands.length
      || validatedAmendment.amendedCommands.some(
        (command, index) => command !== check.amendment!.amendedCommands[index],
      )
      || validatedAmendment.amendedCommands.some(
        (command, index) => command !== check.commands[index]?.command,
      )
    ) {
      return undefined;
    }

    const events = store.listEvents(taskId);
    const verification = latestVerificationEvent(events);
    if (verification === undefined) return undefined;
    if (verification.attemptId !== task.currentAttemptId) return undefined;
    if (check.amendment.verificationEventSequence !== verification.sequence) {
      return undefined;
    }

    const review = latestMainReview(events);
    if (review === undefined || review.decision !== "revise") return undefined;
    if (review.attemptId !== task.currentAttemptId) return undefined;
    if (review.verificationEventSequence !== verification.sequence) return undefined;

    const reviewEvent = latestEventOfType(events, "main-review.completed");
    if (reviewEvent === undefined) return undefined;
    if (reviewEvent.attemptId !== task.currentAttemptId) return undefined;
    // Envelope must match the typed payload used above.
    if (
      reviewEvent.payload === null
      || typeof reviewEvent.payload !== "object"
      || (reviewEvent.payload as { decision?: unknown }).decision !== "revise"
      || (reviewEvent.payload as { attemptId?: unknown }).attemptId !== task.currentAttemptId
      || (reviewEvent.payload as { verificationEventSequence?: unknown })
        .verificationEventSequence !== verification.sequence
    ) {
      return undefined;
    }

    const completion = events
      .filter((event) => {
        if (event.type !== "remediation.check.completed") return false;
        if (event.payload === null || typeof event.payload !== "object") return false;
        return (event.payload as { checkId?: unknown }).checkId === check.id;
      })
      .reduce<EventRecord | undefined>(
        (latest, event) =>
          latest === undefined || event.sequence > latest.sequence ? event : latest,
        undefined,
      );
    if (completion === undefined) return undefined;
    const payload = completion.payload as {
      status?: unknown;
      disposition?: unknown;
      acceptanceBasis?: unknown;
      amendedCommandCount?: unknown;
      reasonCode?: unknown;
    };
    if (payload.status !== "passed") return undefined;
    if (payload.disposition !== "verified-repaired-delivered") return undefined;
    if (payload.acceptanceBasis !== "amended-acceptance") return undefined;
    if (payload.amendedCommandCount !== disposition.amendedCommandCount) return undefined;
    if (payload.reasonCode !== "contradictory-acceptance") return undefined;

    // Qualifying Main revise must predate this exact remediation completion.
    // A later accept/reject/revise becomes the latest review and fails above,
    // or (if sequence order is wrong) fails this ordering check.
    if (reviewEvent.sequence >= completion.sequence) return undefined;

    return {
      status: "verified-repaired-delivered",
      checkId: check.id,
      acceptanceBasis: "amended-acceptance",
    };
  } catch {
    return undefined;
  }
}

/** True when the full durable amended-acceptance remediation chain is fresh. */
export function hasQualifyingAmendedAcceptanceRemediation(
  store: StateStore,
  taskId: string,
): boolean {
  return resolveQualifyingAmendedAcceptanceRemediation(store, taskId) !== undefined;
}

export function evaluateMilestoneGate(
  store: StateStore,
  gate: GoalMilestoneGate,
  taskId: string | undefined,
  taskStatus: TaskStatus | undefined,
): MilestoneGateEvidence {
  if (taskId === undefined || taskStatus === undefined) {
    return {
      satisfied: false,
      reasonCode: "waiting-task",
      reason: reasonText("waiting-task", "Linked Task is not registered yet."),
      integrationStatus: "none",
      nextActionCode: "wait-for-worker",
      nextAction: "Wait for the Plan Task to be created and scheduled.",
    };
  }

  const events = store.listEvents(taskId);
  const review = latestMainReview(events);
  const latestRevision = resolveLatestRevision(events);
  const candidateDigestPrefix = digestPrefix(latestRevision?.patchDigest);
  let reviewGraphStatus: string | undefined;
  let reviewResultUsable: boolean | undefined;
  try {
    // Read-only: never reconcile or mutate during gate evaluation.
    const graph = store.getReviewGraphByCandidateTaskId(taskId);
    if (graph !== undefined) {
      reviewGraphStatus = graph.status;
      const assignments = store.listReviewAssignments(graph.id);
      reviewResultUsable = assignments.some(
        (assignment) =>
          assignment.result !== undefined && assignment.failureCode === undefined,
      );
    }
  } catch {
    // Review graph optional.
  }
  const results = store.listIntegrationResults(taskId);
  const latestResult = results
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1);
  const integrationStatus: IntegrationResultRecord["status"] | "none" =
    latestResult?.status ?? "none";
  const mainDecision = review?.decision;
  const mainDecisionFresh = hasFreshMainAccept(store, taskId);
  const contextEvidence = {
    ...(candidateDigestPrefix === undefined ? {} : { candidateDigestPrefix }),
    ...(reviewGraphStatus === undefined ? {} : { reviewGraphStatus }),
    ...(reviewResultUsable === undefined ? {} : { reviewResultUsable }),
    ...(mainDecision === undefined ? {} : { mainDecision }),
    integrationStatus,
  };

  // Interrupted Tasks keep historical fail-closed behavior for every gate except
  // a strictly re-proved amended-acceptance integration delivery (below).
  if (taskStatus === "interrupted") {
    if (
      gate === "integration"
      && hasQualifyingAmendedAcceptanceRemediation(store, taskId)
    ) {
      return {
        satisfied: true,
        reasonCode: "none",
        reason:
          "Main repaired the current source and verified it under formally amended acceptance.",
        ...contextEvidence,
        mainDecisionFresh,
        deliveryBasis: "amended-acceptance",
        nextActionCode: "none",
        nextAction:
          "Integration gate is satisfied by verified Main-repaired source delivery (amended acceptance).",
      };
    }
    return {
      satisfied: false,
      reasonCode: "waiting-machine",
      reason: reasonText(
        "waiting-machine",
        "The Worker was interrupted. Durable Task evidence is preserved, but no Worker is running.",
      ),
      ...contextEvidence,
      mainDecisionFresh: false,
      nextActionCode: "resume-task",
      nextAction: "Resume the interrupted Task through existing Task authority.",
    };
  }

  // Integration may still be satisfied by qualifying Main remediation even when
  // the machine Task remains failed. Other gates stay fail-closed on failure.
  if (taskStatus === "failed" && gate !== "integration") {
    return {
      satisfied: false,
      reasonCode: "milestone-failed",
      reason: reasonText("milestone-failed"),
      ...contextEvidence,
      mainDecisionFresh,
      nextActionCode: "correct-or-decide",
      nextAction: "Inspect the failed Task and choose correct, revise, or stop.",
    };
  }

  if (gate === "machine") {
    if (taskStatus === "succeeded") {
      return {
        satisfied: true,
        reasonCode: "none",
        reason: "Machine verification succeeded.",
        ...contextEvidence,
        mainDecisionFresh,
        nextActionCode: "none",
        nextAction: "Machine gate is satisfied.",
      };
    }
    return {
      satisfied: false,
      reasonCode: "waiting-machine",
      reason: reasonText("waiting-machine"),
      ...contextEvidence,
      mainDecisionFresh,
      nextActionCode: "wait-for-worker",
      nextAction: "Wait for the Worker to finish independent verification.",
    };
  }

  if (gate === "main-accept") {
    if (mainDecisionFresh) {
      return {
        satisfied: true,
        reasonCode: "none",
        reason: "Fresh exact Main accept is present.",
        ...contextEvidence,
        mainDecisionFresh: true,
        nextActionCode: "none",
        nextAction: "Main-accept gate is satisfied.",
      };
    }
    if (taskStatus !== "succeeded") {
      return {
        satisfied: false,
        reasonCode: "waiting-machine",
        reason: reasonText("waiting-machine", "Machine success is required before Main accept."),
        ...contextEvidence,
        mainDecisionFresh: false,
        nextActionCode: "wait-for-worker",
        nextAction: "Wait for machine success, then record a fresh Main accept.",
      };
    }
    return {
      satisfied: false,
      reasonCode: "waiting-main-accept",
      reason: reasonText("waiting-main-accept"),
      ...contextEvidence,
      mainDecisionFresh: false,
      nextActionCode: mainDecision === undefined ? "main-accept" : "main-review",
      nextAction: mainDecision === undefined
        ? "Record a fresh Main accept on the exact current Candidate."
        : "Record a fresh Main accept after the latest evidence (prior decision is stale).",
    };
  }

  // integration gate — exact Candidate Integration remains authoritative.
  if (hasSuccessfulExactIntegration(store, taskId)) {
    return {
      satisfied: true,
      reasonCode: "none",
      reason: "Successful Integration of the exact accepted Candidate is present.",
      ...contextEvidence,
      mainDecisionFresh: true,
      integrationStatus: "applied",
      deliveryBasis: "exact-candidate-integration",
      nextActionCode: "none",
      nextAction: "Integration gate is satisfied.",
    };
  }
  // Qualifying Main remediation means repaired current source already passed
  // the original acceptance contract. Do not claim the old Candidate was integrated.
  if (hasQualifyingOriginalAcceptanceRemediation(store, taskId)) {
    return {
      satisfied: true,
      reasonCode: "none",
      reason:
        "Main repaired the current source and verified it against the original acceptance contract.",
      ...contextEvidence,
      mainDecisionFresh,
      deliveryBasis: "original-acceptance",
      nextActionCode: "none",
      nextAction:
        "Integration gate is satisfied by verified Main-repaired source delivery (original acceptance).",
    };
  }
  // Strict amended-acceptance chain: private check + ordered events must re-prove.
  // Never claim exact Candidate Integration.
  if (hasQualifyingAmendedAcceptanceRemediation(store, taskId)) {
    return {
      satisfied: true,
      reasonCode: "none",
      reason:
        "Main repaired the current source and verified it under formally amended acceptance.",
      ...contextEvidence,
      mainDecisionFresh,
      deliveryBasis: "amended-acceptance",
      nextActionCode: "none",
      nextAction:
        "Integration gate is satisfied by verified Main-repaired source delivery (amended acceptance).",
    };
  }
  if (taskStatus === "failed") {
    return {
      satisfied: false,
      reasonCode: "milestone-failed",
      reason: reasonText("milestone-failed"),
      ...contextEvidence,
      mainDecisionFresh,
      nextActionCode: "correct-or-decide",
      nextAction: "Inspect the failed Task and choose correct, revise, or stop.",
    };
  }
  if (!mainDecisionFresh) {
    if (taskStatus !== "succeeded") {
      return {
        satisfied: false,
        reasonCode: "waiting-machine",
        reason: reasonText("waiting-machine"),
        ...contextEvidence,
        mainDecisionFresh: false,
        nextActionCode: "wait-for-worker",
        nextAction: "Wait for machine success before Main accept and Integration.",
      };
    }
    return {
      satisfied: false,
      reasonCode: "waiting-main-accept",
      reason: reasonText("waiting-main-accept", "Main accept is required before Integration."),
      ...contextEvidence,
      mainDecisionFresh: false,
      nextActionCode: "main-accept",
      nextAction: "Record a fresh Main accept, then explicitly confirm Integration.",
    };
  }
  return {
    satisfied: false,
    reasonCode: "waiting-integration",
    reason: reasonText("waiting-integration"),
    ...contextEvidence,
    mainDecisionFresh: true,
    nextActionCode: "integrate",
    nextAction: "Run Integration preflight and explicitly confirm apply for the accepted Candidate.",
  };
}

// --- Evidence cursor ---

/**
 * Authoritative external evidence only. Goal status and orchestration counters
 * are intentionally excluded so status polling / projection updates cannot
 * manufacture progress or reset the no-new-evidence counter.
 *
 * Cursor fields are only persisted facts that can change a milestone gate or
 * Main decision. Raw Worker messages, prompts, paths, credentials, result
 * text, and Goal counters are excluded.
 */
export interface GoalEvidenceFacts {
  items: Array<{
    itemId: string;
    /** Plan identity so duplicate local item IDs across phases stay distinct. */
    planId?: string;
    taskId?: string;
    taskStatus?: TaskStatus;
    /** Effective Task (successor after direct Goal handoff). */
    effectiveTaskId?: string;
    effectiveTaskStatus?: TaskStatus;
    handoffId?: string;
    handoffStatus?: string;
    currentAttemptId?: string;
    currentAttemptStatus?: AttemptStatus;
    gate: GoalMilestoneGate;
    satisfied: boolean;
    verificationSequence?: number;
    verificationPassed?: boolean;
    revisionId?: string;
    patchDigest?: string;
    mainDecision?: string;
    mainRevisionId?: string;
    mainVerificationSequence?: number;
    mainAcceptedPatchDigest?: string;
    reviewGraphStatus?: string;
    reviewGraphTerminalSequence?: number;
    reviewAssignments?: Array<{
      status: string;
      failureCode?: string;
      disposition?: string;
    }>;
    integrationStatus?: string;
    integrationPatchDigest?: string;
    /** Compact remediation disposition on the effective Task only. */
    remediationStatus?: "verified-repaired-delivered";
    remediationCheckId?: string;
    remediationAcceptanceBasis?: RemediationAcceptanceBasis;
    /**
     * Satisfied-gate delivery provenance only. Absent when the gate is not
     * satisfied or when satisfaction is not a known delivery authority.
     */
    deliveryBasis?: GoalDeliveryBasis;
  }>;
}

function loadTaskOrUndefined(store: StateStore, taskId: string | undefined): TaskRecord | undefined {
  if (taskId === undefined) return undefined;
  try {
    return store.getTask(taskId);
  } catch {
    return undefined;
  }
}

/**
 * Resolve original versus direct-handoff successor once. Shared by gates,
 * evidence digest, in-flight checks, restart projection, and dependency admission.
 * Read-only: never mutates store or creates work.
 */
export function resolveEffectiveMilestoneLineage(
  store: StateStore,
  milestone: GoalMilestoneRecord,
): EffectiveMilestoneLineage {
  const originalTaskId = milestone.taskId;
  if (originalTaskId === undefined) {
    return {};
  }
  const originalTask = loadTaskOrUndefined(store, originalTaskId);
  const handoffs = store.listCandidateHandoffsBySourceTaskId(originalTaskId);
  // Authoritative once any durable Goal-Task handoff exists (including failed prep).
  // Competition origin on a Goal Task is unexpected and is ignored for lineage.
  const goalHandoffs = handoffs.filter((entry) => entry.origin.kind === "goal-task");
  const handoff = goalHandoffs.length === 0
    ? undefined
    : goalHandoffs.reduce((latest, entry) =>
      entry.createdAt >= latest.createdAt ? entry : latest);
  if (handoff === undefined) {
    return {
      originalTaskId,
      effectiveTaskId: originalTaskId,
      ...(originalTask === undefined ? {} : { originalTask, effectiveTask: originalTask }),
    };
  }
  const effectiveTask = loadTaskOrUndefined(store, handoff.successorTaskId);
  return {
    originalTaskId,
    effectiveTaskId: handoff.successorTaskId,
    handoff,
    ...(originalTask === undefined ? {} : { originalTask }),
    ...(effectiveTask === undefined ? {} : { effectiveTask }),
  };
}

function isInFlightTaskStatus(status: TaskStatus | undefined): boolean {
  return status !== undefined && GOAL_IN_FLIGHT_STATUSES.has(status);
}

/**
 * True when any Goal milestone Task or linked reviewer Task is still under
 * Task authority (queued / preparing / running / verifying). Goal idle stop
 * must defer to those authorities and never kill in-flight work.
 */
export function hasGoalOwnedWorkInFlight(
  store: StateStore,
  milestones: readonly GoalMilestoneRecord[],
): boolean {
  for (const milestone of milestones) {
    const lineage = resolveEffectiveMilestoneLineage(store, milestone);
    // After direct handoff, only the effective successor (and its reviewers)
    // count as Goal-owned work. Source history is not in-flight authority.
    if (isInFlightTaskStatus(lineage.effectiveTask?.status)) return true;
    if (lineage.effectiveTaskId === undefined) continue;
    try {
      const graph = store.getReviewGraphByCandidateTaskId(lineage.effectiveTaskId);
      if (graph === undefined) continue;
      for (const assignment of store.listReviewAssignments(graph.id)) {
        const reviewer = loadTaskOrUndefined(store, assignment.reviewerTaskId);
        if (isInFlightTaskStatus(reviewer?.status)) return true;
      }
    } catch {
      // Review graph is optional for Goal evidence ownership.
    }
  }
  return false;
}

export function collectGoalEvidenceFacts(
  store: StateStore,
  goal: GoalRecord,
  milestones: readonly GoalMilestoneRecord[],
): GoalEvidenceFacts {
  void goal;
  const items = milestones.map((milestone) => {
    const lineage = resolveEffectiveMilestoneLineage(store, milestone);
    // Gate and evidence always follow the effective Task (successor after handoff).
    const task = lineage.effectiveTask;
    const effectiveTaskId = lineage.effectiveTaskId;
    const events = effectiveTaskId === undefined ? [] : store.listEvents(effectiveTaskId);
    const review = latestMainReview(events);
    const verification = latestVerificationEvent(events);
    const latestRevision = resolveLatestRevision(events);
    let currentAttemptStatus: AttemptStatus | undefined;
    if (task?.currentAttemptId !== undefined) {
      try {
        currentAttemptStatus = store.getAttempt(task.currentAttemptId).status;
      } catch {
        currentAttemptStatus = undefined;
      }
    }
    let reviewGraphStatus: string | undefined;
    let reviewGraphTerminalSequence: number | undefined;
    let reviewAssignments: Array<{
      status: string;
      failureCode?: string;
      disposition?: string;
    }> | undefined;
    try {
      if (effectiveTaskId !== undefined) {
        const graph = store.getReviewGraphByCandidateTaskId(effectiveTaskId);
        if (graph !== undefined) {
          reviewGraphStatus = graph.status;
          reviewGraphTerminalSequence = graph.terminalEvidenceSequence;
          reviewAssignments = store.listReviewAssignments(graph.id)
            .slice()
            .sort((a, b) => a.ordinal - b.ordinal)
            .map((assignment) => ({
              status: assignment.status,
              ...(assignment.failureCode === undefined
                ? {}
                : { failureCode: assignment.failureCode }),
              ...(assignment.result?.proposedDisposition === undefined
                ? {}
                : { disposition: assignment.result.proposedDisposition }),
            }));
        }
      }
    } catch {
      // optional
    }
    const results = effectiveTaskId === undefined
      ? []
      : store.listIntegrationResults(effectiveTaskId);
    const latestResult = results
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .at(-1);
    let integrationPatchDigest: string | undefined;
    if (latestResult !== undefined) {
      try {
        integrationPatchDigest = store.getIntegrationReceipt(latestResult.receiptId)?.patchDigest;
      } catch {
        integrationPatchDigest = undefined;
      }
    }
    const gate = evaluateMilestoneGate(
      store,
      milestone.gate,
      effectiveTaskId,
      task?.status,
    );
    const remediation = effectiveTaskId === undefined
      ? undefined
      : readEffectiveRemediationDispositionFacts(store, effectiveTaskId);
    const verificationPassed =
      verification !== undefined
      && verification.payload !== null
      && typeof verification.payload === "object"
      && typeof (verification.payload as { passed?: unknown }).passed === "boolean"
        ? (verification.payload as { passed: boolean }).passed
        : undefined;
    return {
      itemId: milestone.itemId,
      ...(milestone.planId === undefined ? {} : { planId: milestone.planId }),
      ...(milestone.taskId === undefined ? {} : { taskId: milestone.taskId }),
      ...(lineage.originalTask === undefined
        ? {}
        : { taskStatus: lineage.originalTask.status }),
      ...(effectiveTaskId === undefined ? {} : { effectiveTaskId }),
      ...(task === undefined ? {} : { effectiveTaskStatus: task.status }),
      ...(lineage.handoff === undefined
        ? {}
        : {
          handoffId: lineage.handoff.id,
          handoffStatus: lineage.handoff.status,
        }),
      ...(task?.currentAttemptId === undefined ? {} : { currentAttemptId: task.currentAttemptId }),
      ...(currentAttemptStatus === undefined ? {} : { currentAttemptStatus }),
      gate: milestone.gate,
      satisfied: gate.satisfied,
      ...(verification === undefined ? {} : { verificationSequence: verification.sequence }),
      ...(verificationPassed === undefined ? {} : { verificationPassed }),
      ...(latestRevision === undefined ? {} : {
        revisionId: latestRevision.id,
        patchDigest: latestRevision.patchDigest,
      }),
      ...(review === undefined ? {} : {
        mainDecision: review.decision,
        mainVerificationSequence: review.verificationEventSequence,
        ...(review.candidateRevisionId === undefined
          ? {}
          : { mainRevisionId: review.candidateRevisionId }),
        ...(review.acceptedPatchDigest === undefined
          ? {}
          : { mainAcceptedPatchDigest: review.acceptedPatchDigest }),
      }),
      ...(reviewGraphStatus === undefined ? {} : { reviewGraphStatus }),
      ...(reviewGraphTerminalSequence === undefined
        ? {}
        : { reviewGraphTerminalSequence }),
      ...(reviewAssignments === undefined || reviewAssignments.length === 0
        ? {}
        : { reviewAssignments }),
      ...(latestResult === undefined ? {} : { integrationStatus: latestResult.status }),
      ...(integrationPatchDigest === undefined ? {} : { integrationPatchDigest }),
      // Effective-Task disposition only; never the stale original after handoff.
      ...(remediation === undefined
        ? {}
        : {
          remediationStatus: remediation.status,
          remediationCheckId: remediation.checkId,
          remediationAcceptanceBasis: remediation.acceptanceBasis,
        }),
      // Same authority as the gate — displayed basis cannot disagree with scheduling.
      ...(gate.deliveryBasis === undefined ? {} : { deliveryBasis: gate.deliveryBasis }),
    };
  });
  return { items };
}

export function computeEvidenceDigest(facts: GoalEvidenceFacts): string {
  return sha256(JSON.stringify(facts));
}

/** Privacy-safe human duration for CLI / logs. Null means unlimited. */
export function formatGoalDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "unlimited";
  if (!Number.isFinite(ms) || ms < 0) return "unlimited";
  if (ms >= 3_600_000 && ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms >= 60_000) return `${Math.ceil(ms / 60_000)}m`;
  return `${Math.ceil(ms / 1000)}s`;
}

// --- Projection ---

function workerIdentity(task: TaskRecord | undefined): FrozenWorkerIdentity | undefined {
  if (task === undefined) return undefined;
  // Inherit the actual Task provider/runtime identity; never invent a model.
  const spec = task.spec;
  return {
    provider: spec.provider.name,
    model: spec.provider.model,
    runtime: spec.runtime.name,
    effort: spec.runtime.effort,
    ...(spec.workerProfileId === undefined ? {} : { workerProfileId: spec.workerProfileId }),
  };
}

/**
 * Core-selected current phase: the first supervised Plan whose milestones are
 * not all satisfied, in stable ordinal order. Ownership-attached Plans without
 * milestone rows are not supervised and never block or advance the Goal.
 * Returns undefined when every supervised milestone is satisfied (terminal).
 */
export function resolveGoalCurrentPlanId(
  store: StateStore,
  goalId: string,
): string | undefined {
  const goal = store.getGoal(goalId);
  const associations = store.listGoalPlanAssociations(goalId);
  const orderedPlanIds = associations.length > 0
    ? associations.map((association) => association.planId)
    : [goal.planId];
  const milestones = store.getGoalMilestones(goalId);
  const byPlan = new Map<string, GoalMilestoneRecord[]>();
  for (const milestone of milestones) {
    const key = milestone.planId ?? goal.planId;
    const list = byPlan.get(key) ?? [];
    list.push(milestone);
    byPlan.set(key, list);
  }
  for (const planId of orderedPlanIds) {
    const planMilestones = byPlan.get(planId) ?? [];
    if (planMilestones.length === 0) continue;
    if (planMilestones.some((milestone) => !milestone.satisfied)) return planId;
  }
  return undefined;
}

export function projectGoal(store: StateStore, goalId: string): GoalView {
  const goal = store.getGoal(goalId);
  const milestones = store.getGoalMilestones(goalId);
  const views: GoalMilestoneView[] = milestones.map((milestone) => {
    const lineage = resolveEffectiveMilestoneLineage(store, milestone);
    const original = lineage.originalTask;
    const effective = lineage.effectiveTask;
    const evidence = evaluateMilestoneGate(
      store,
      milestone.gate,
      lineage.effectiveTaskId,
      effective?.status,
    );
    // Worker identity follows the effective Task (destination after handoff).
    const worker = workerIdentity(effective);
    return {
      itemId: milestone.itemId,
      ...(milestone.planId === undefined ? {} : { planId: milestone.planId }),
      itemIndex: milestone.itemIndex,
      ...(milestone.taskId === undefined ? {} : { taskId: milestone.taskId }),
      ...(original === undefined
        ? {}
        : { taskName: original.name, taskStatus: original.status }),
      ...(lineage.effectiveTaskId === undefined
        ? {}
        : { effectiveTaskId: lineage.effectiveTaskId }),
      ...(effective === undefined
        ? {}
        : {
          effectiveTaskName: effective.name,
          effectiveTaskStatus: effective.status,
        }),
      ...(lineage.handoff === undefined
        ? {}
        : {
          handoff: {
            handoffId: lineage.handoff.id,
            status: lineage.handoff.status,
            successorTaskId: lineage.handoff.successorTaskId,
            destinationWorkerProfileId: lineage.handoff.destinationWorkerProfileId,
            reusablePathCount: lineage.handoff.reusablePathCount,
            remainingGapCount: lineage.handoff.remainingGapCount,
            nextAction: lineage.handoff.nextAction,
            ...(lineage.handoff.failureCode === undefined
              ? {}
              : { failureCode: lineage.handoff.failureCode }),
          },
        }),
      gate: milestone.gate,
      satisfied: evidence.satisfied,
      reasonCode: evidence.reasonCode,
      reason: evidence.reason,
      ...(evidence.deliveryBasis === undefined
        ? {}
        : { deliveryBasis: evidence.deliveryBasis }),
      ...(evidence.candidateDigestPrefix === undefined
        ? {}
        : { candidateDigestPrefix: evidence.candidateDigestPrefix }),
      ...(evidence.reviewGraphStatus === undefined
        ? {}
        : { reviewGraphStatus: evidence.reviewGraphStatus }),
      ...(evidence.reviewResultUsable === undefined
        ? {}
        : { reviewResultUsable: evidence.reviewResultUsable }),
      ...(evidence.mainDecision === undefined ? {} : { mainDecision: evidence.mainDecision }),
      ...(evidence.mainDecisionFresh === undefined
        ? {}
        : { mainDecisionFresh: evidence.mainDecisionFresh }),
      ...(evidence.integrationStatus === undefined
        ? {}
        : { integrationStatus: evidence.integrationStatus }),
      ...(worker === undefined ? {} : { worker }),
      nextActionCode: evidence.nextActionCode,
      nextAction: evidence.nextAction,
    };
  });

  const satisfied = views.filter((view) => view.satisfied).length;
  const unsatisfied = views.find((view) => !view.satisfied);
  const failed = views.find((view) => view.reasonCode === "milestone-failed");

  let nextActionCode: GoalNextActionCode = "none";
  let nextAction = "No Main action required.";
  let whatIsWaiting = "Nothing is waiting.";
  let whatJustHappened = "Goal state is current.";

  if (goal.status === "stopped") {
    nextActionCode = "stop-or-decide";
    nextAction = goal.reason;
    whatIsWaiting = "Goal is stopped; future Task admission is blocked.";
    whatJustHappened = goal.reason;
  } else if (goal.status === "completed") {
    nextActionCode = "none";
    nextAction = reasonText("goal-completed");
    whatIsWaiting = "All milestone gates are satisfied.";
    whatJustHappened = reasonText("goal-completed");
  } else if (goal.status === "failed" || failed !== undefined) {
    nextActionCode = "correct-or-decide";
    nextAction = failed?.nextAction ?? goal.reason;
    whatIsWaiting = failed?.reason ?? goal.reason;
    whatJustHappened = failed?.reason ?? goal.reason;
  } else if (unsatisfied !== undefined) {
    nextActionCode = unsatisfied.nextActionCode;
    nextAction = unsatisfied.nextAction;
    whatIsWaiting = unsatisfied.reason;
    const previous = views.filter((view) => view.satisfied).at(-1);
    whatJustHappened = previous === undefined
      ? "Goal started; first wave Tasks may run."
      : `Milestone ${previous.itemId} satisfied (${previous.gate}).`;
  } else {
    nextActionCode = "none";
    nextAction = reasonText("goal-completed");
    whatIsWaiting = "All milestone gates are satisfied.";
    whatJustHappened = reasonText("goal-completed");
  }

  // Prefer goal-level cap wait reasons when active.
  if (
    goal.status === "waiting"
    && (goal.reasonCode === "correction-cap"
      || goal.reasonCode === "review-cap"
      || goal.reasonCode === "no-new-evidence-cap")
  ) {
    nextActionCode = "stop-or-decide";
    nextAction = goal.reason;
    whatIsWaiting = goal.reason;
    whatJustHappened = goal.reason;
  }

  // Ordered associations are the multi-Plan authority; planId stays the legacy primary.
  const associations = store.listGoalPlanAssociations(goalId);
  const planIds = associations.length > 0
    ? associations.map((association) => association.planId)
    : [goal.planId];
  // Core-owned current-phase projection; Hub never computes phase readiness.
  const currentPlanId = resolveGoalCurrentPlanId(store, goalId);

  return {
    schemaVersion: 1,
    goalId: goal.id,
    name: goal.name,
    objective: goal.objective,
    planId: goal.planId,
    planIds,
    ...(currentPlanId === undefined ? {} : { currentPlanId }),
    status: goal.status,
    reasonCode: goal.reasonCode,
    reason: goal.reason,
    policy: {
      maxDurationMs: goal.policy.maxDurationMs,
      noProgressTimeoutMs: goal.policy.noProgressTimeoutMs,
      maxCorrectionRounds: goal.policy.maxCorrectionRounds,
      maxReviewRounds: goal.policy.maxReviewRounds,
      maxNoNewEvidenceCycles: goal.policy.maxNoNewEvidenceCycles,
    },
    counters: { ...goal.counters },
    evidenceDigestPrefix: goal.evidenceDigest.slice(0, 12),
    evidenceAt: goal.evidenceAt,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
    ...(goal.completedAt === undefined ? {} : { completedAt: goal.completedAt }),
    ...(goal.stoppedAt === undefined ? {} : { stoppedAt: goal.stoppedAt }),
    ...(unsatisfied === undefined
      ? {}
      : {
        currentMilestone: {
          itemId: unsatisfied.itemId,
          gate: unsatisfied.gate,
          // Surface effective authority (successor after handoff) for Main action.
          ...(unsatisfied.effectiveTaskId === undefined
            ? (unsatisfied.taskId === undefined ? {} : { taskId: unsatisfied.taskId })
            : { taskId: unsatisfied.effectiveTaskId }),
          ...(unsatisfied.effectiveTaskName === undefined
            ? (unsatisfied.taskName === undefined ? {} : { taskName: unsatisfied.taskName })
            : { taskName: unsatisfied.effectiveTaskName }),
        },
      }),
    whatJustHappened,
    whatIsWaiting,
    nextActionCode,
    nextAction,
    milestones: views,
    progress: {
      total: views.length,
      satisfied,
      percent: views.length === 0 ? 0 : Math.round((satisfied / views.length) * 100),
    },
  };
}

// --- Reconciliation (mutates Goal records only; queues via caller) ---

export interface GoalReconcileResult {
  goal: GoalRecord;
  milestones: GoalMilestoneRecord[];
  /** True when evidence digest changed from authoritative events. */
  evidenceChanged: boolean;
  /** Item task IDs that became newly gate-ready for dependents (caller queues). */
  newlySatisfiedItemIds: string[];
}

export function reconcileGoalRecords(
  store: StateStore,
  goalId: string,
  options: { now?: string; allowDurationStop?: boolean } = {},
): GoalReconcileResult {
  const now = options.now ?? timestamp();
  const goal = store.getGoal(goalId);
  const milestones = store.getGoalMilestones(goalId);

  // Terminal Goal states still refresh milestone projections for inspectability
  // but do not re-open admission.
  const terminal = goal.status === "stopped"
    || goal.status === "completed"
    || goal.status === "failed";

  const previousSatisfied = new Map(
    milestones.map((milestone) => [
      `${milestone.planId ?? goal.planId}::${milestone.itemId}`,
      milestone.satisfied,
    ]),
  );
  const updatedMilestones: GoalMilestoneRecord[] = milestones.map((milestone) => {
    const lineage = resolveEffectiveMilestoneLineage(store, milestone);
    const evidence = evaluateMilestoneGate(
      store,
      milestone.gate,
      lineage.effectiveTaskId,
      lineage.effectiveTask?.status,
    );
    return {
      ...milestone,
      satisfied: evidence.satisfied,
      reasonCode: evidence.reasonCode,
      reason: evidence.reason,
      updatedAt: now,
    };
  });

  const facts = collectGoalEvidenceFacts(store, goal, updatedMilestones);
  // Facts use live gate evaluation; recompute digest from live satisfaction.
  const digest = computeEvidenceDigest({
    ...facts,
    items: facts.items.map((item, index) => ({
      ...item,
      satisfied: updatedMilestones[index]!.satisfied,
    })),
  });
  const evidenceChanged = digest !== goal.evidenceDigest;

  let status: GoalStatus = goal.status;
  let reasonCode: GoalReasonCode = goal.reasonCode;
  let reason = goal.reason;
  let completedAt = goal.completedAt;
  let stoppedAt = goal.stoppedAt;

  const workInFlight = hasGoalOwnedWorkInFlight(store, updatedMilestones);

  if (!terminal) {
    const failed = updatedMilestones.find((m) => m.reasonCode === "milestone-failed");
    const allSatisfied = updatedMilestones.every((m) => m.satisfied);
    if (failed !== undefined) {
      // A failed Task is a Main decision point, not a terminal Goal. Keeping
      // the Goal waiting allows the explicitly bounded correction policy to
      // do useful work while ordinary dependency readiness still blocks every
      // downstream Task.
      status = "waiting";
      reasonCode = "milestone-failed";
      reason = failed.reason;
    } else if (allSatisfied) {
      status = "completed";
      reasonCode = "goal-completed";
      reason = reasonText("goal-completed");
      completedAt = now;
    } else {
      const waiting = updatedMilestones.find((m) => !m.satisfied);
      status = "waiting";
      reasonCode = waiting?.reasonCode ?? "waiting-task";
      reason = waiting?.reason ?? reasonText("waiting-task");
      // Keep running while Goal-owned milestone or reviewer work is in flight.
      if (workInFlight) {
        status = "running";
      }
    }

    // Duration / no-progress only when limits are finite.
    // maxDurationMs:null stays unlimited. Finite noProgressTimeoutMs is a
    // durable terminal stop only when no Goal-owned work is in flight and
    // authoritative evidence has not changed within the frozen window.
    if (options.allowDurationStop !== false) {
      if (
        goal.policy.maxDurationMs !== null
        && Date.parse(now) - Date.parse(goal.createdAt) > goal.policy.maxDurationMs
      ) {
        status = "stopped";
        reasonCode = "duration-exceeded";
        reason = reasonText("duration-exceeded");
        stoppedAt = now;
      } else if (
        goal.policy.noProgressTimeoutMs !== null
        && !evidenceChanged
        && !workInFlight
        && status !== "completed"
        && Date.parse(now) - Date.parse(goal.evidenceAt) > goal.policy.noProgressTimeoutMs
      ) {
        status = "stopped";
        reasonCode = "no-progress";
        reason = reasonText("no-progress");
        stoppedAt = now;
      }
    }

    // Preserve explicit cap wait reasons set by mutation guards until Main acts.
    // Terminal stops (duration / idle no-progress / completed) win over caps.
    if (
      goal.status === "waiting"
      && (goal.reasonCode === "correction-cap"
        || goal.reasonCode === "review-cap"
        || goal.reasonCode === "no-new-evidence-cap")
      && status !== "completed"
      && status !== "stopped"
    ) {
      status = "waiting";
      reasonCode = goal.reasonCode;
      reason = goal.reason;
    }
  }

  const updatedGoal: GoalRecord = {
    ...goal,
    status,
    reasonCode,
    reason,
    evidenceDigest: evidenceChanged ? digest : goal.evidenceDigest,
    evidenceAt: evidenceChanged ? now : goal.evidenceAt,
    updatedAt: now,
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(stoppedAt === undefined ? {} : { stoppedAt }),
  };

  store.saveGoal(updatedGoal, updatedMilestones);

  const newlySatisfiedItemIds = updatedMilestones
    .filter((m) =>
      m.satisfied
      && previousSatisfied.get(`${m.planId ?? goal.planId}::${m.itemId}`) !== true)
    .map((m) => m.itemId);

  return {
    goal: updatedGoal,
    milestones: updatedMilestones,
    evidenceChanged,
    newlySatisfiedItemIds,
  };
}

/** Explicit Main advance: identical evidence increments the bounded counter. */
export function advanceGoalRecords(
  store: StateStore,
  goalId: string,
): GoalAdvanceResult {
  const before = store.getGoal(goalId);
  if (before.status === "stopped" || before.status === "completed") {
    return {
      goal: projectGoal(store, goalId),
      advanced: false,
      newEvidence: false,
      noNewEvidenceCycles: before.counters.noNewEvidenceCycles,
    };
  }

  const reconcile = reconcileGoalRecords(store, goalId);
  if (reconcile.evidenceChanged) {
    // New authoritative evidence: reset the no-new-evidence counter.
    const goal = store.getGoal(goalId);
    const reset: GoalRecord = {
      ...goal,
      counters: { ...goal.counters, noNewEvidenceCycles: 0 },
      updatedAt: timestamp(),
    };
    store.saveGoal(reset, store.getGoalMilestones(goalId));
    return {
      goal: projectGoal(store, goalId),
      advanced: true,
      newEvidence: true,
      noNewEvidenceCycles: 0,
    };
  }

  // No newer evidence: increment bounded counter; stop at cap without launching work.
  // Spec: stop at the frozen cap. When max is 0, first advance without evidence stops.
  const cycles = before.counters.noNewEvidenceCycles + 1;
  const reachedCap = before.policy.maxNoNewEvidenceCycles === 0
    || cycles >= before.policy.maxNoNewEvidenceCycles;
  const now = timestamp();
  const counters: GoalCounters = {
    ...before.counters,
    noNewEvidenceCycles: cycles,
  };
  let status: GoalStatus = before.status === "running" ? "waiting" : before.status;
  let reasonCode: GoalReasonCode = before.reasonCode;
  let reason = before.reason;
  let stoppedAt = before.stoppedAt;
  if (reachedCap) {
    status = "stopped";
    reasonCode = "no-new-evidence-cap";
    reason = reasonText("no-new-evidence-cap");
    stoppedAt = now;
  } else {
    status = "waiting";
    reasonCode = "none";
    reason = `No new evidence on advance (${counters.noNewEvidenceCycles}/${before.policy.maxNoNewEvidenceCycles}).`;
  }
  const updated: GoalRecord = {
    ...store.getGoal(goalId),
    status,
    reasonCode,
    reason,
    counters,
    updatedAt: now,
    ...(stoppedAt === undefined ? {} : { stoppedAt }),
  };
  store.saveGoal(updated, store.getGoalMilestones(goalId));
  return {
    goal: projectGoal(store, goalId),
    advanced: true,
    newEvidence: false,
    noNewEvidenceCycles: updated.counters.noNewEvidenceCycles,
  };
}

export function stopGoalRecords(
  store: StateStore,
  goalId: string,
  confirm: true,
): GoalView {
  if (confirm !== true) throw new Error("goal stop requires confirm: true");
  const goal = store.getGoal(goalId);
  if (goal.status === "stopped") {
    return projectGoal(store, goalId);
  }
  if (goal.status === "completed") {
    throw new Error("completed Goal cannot be stopped");
  }
  const now = timestamp();
  const updated: GoalRecord = {
    ...goal,
    status: "stopped",
    reasonCode: "main-stop",
    reason: reasonText("main-stop"),
    stoppedAt: now,
    updatedAt: now,
  };
  store.saveGoal(updated, store.getGoalMilestones(goalId));
  return projectGoal(store, goalId);
}

/** Build initial durable records before atomic persistence.
 *  Every persisted milestone carries its Plan identity so duplicate local item
 *  IDs across phases never collide. */
export function buildGoalRecords(input: {
  loaded: LoadedGoal;
  /** Ordered Plan ids, one per loaded phase (phase zero is the primary). */
  phasePlanIds: string[];
  /** Per-phase local itemId → staged Task id maps, aligned with `phasePlanIds`. */
  phaseTaskIdsByItemId: Array<Record<string, string>>;
  createdAt: string;
}): { goal: GoalRecord; milestones: GoalMilestoneRecord[] } {
  const { loaded, phasePlanIds, phaseTaskIdsByItemId, createdAt } = input;
  const goalId = loaded.goalFile;
  const emptyFacts: GoalEvidenceFacts = {
    items: loaded.phases.flatMap((phase, phaseIndex) =>
      phase.milestones.map((milestone) => {
        const taskId = phaseTaskIdsByItemId[phaseIndex]![milestone.itemId];
        return {
          itemId: milestone.itemId,
          planId: phasePlanIds[phaseIndex]!,
          ...(taskId === undefined ? {} : { taskId }),
          taskStatus: "queued" as TaskStatus,
          gate: milestone.gate,
          satisfied: false,
        };
      }),
    ),
  };
  const digest = computeEvidenceDigest(emptyFacts);
  const goal: GoalRecord = {
    id: goalId,
    version: 1,
    name: loaded.name,
    objective: loaded.objective,
    planId: phasePlanIds[0]!,
    goalFile: loaded.goalFile,
    policy: {
      maxDurationMs: loaded.policy.maxDurationMs,
      noProgressTimeoutMs: loaded.policy.noProgressTimeoutMs,
      maxCorrectionRounds: loaded.policy.maxCorrectionRounds,
      maxReviewRounds: loaded.policy.maxReviewRounds,
      maxNoNewEvidenceCycles: loaded.policy.maxNoNewEvidenceCycles,
    },
    status: "running",
    reasonCode: "none",
    reason: reasonText("none"),
    evidenceDigest: digest,
    evidenceAt: createdAt,
    counters: { correctionRounds: 0, reviewRounds: 0, noNewEvidenceCycles: 0 },
    createdAt,
    updatedAt: createdAt,
  };
  const milestones: GoalMilestoneRecord[] = loaded.phases.flatMap((phase, phaseIndex) => {
    const planId = phasePlanIds[phaseIndex]!;
    const indexById = new Map(phase.plan.items.map((item, index) => [item.id, index]));
    return phase.milestones.map((milestone) => {
      const taskId = phaseTaskIdsByItemId[phaseIndex]![milestone.itemId];
      return {
        goalId,
        planId,
        itemId: milestone.itemId,
        ...(taskId === undefined ? {} : { taskId }),
        gate: milestone.gate,
        itemIndex: indexById.get(milestone.itemId) ?? 0,
        satisfied: false,
        reasonCode: "waiting-task" as const,
        reason: reasonText("waiting-task"),
        updatedAt: createdAt,
      };
    });
  });
  return { goal, milestones };
}

export function goalAdmissionBlocked(goal: GoalRecord | undefined): boolean {
  if (goal === undefined) return false;
  return goal.status === "stopped" || goal.status === "failed" || goal.status === "completed";
}

export function assertGoalCorrectionAllowed(goal: GoalRecord): void {
  if (goal.status === "stopped" || goal.status === "completed" || goal.status === "failed") {
    throw new Error(
      `Goal is ${goal.status}; correction is blocked. Handle the Task through existing Task authority or submit a new Goal.`,
    );
  }
  if (goal.counters.correctionRounds >= goal.policy.maxCorrectionRounds) {
    throw new Error(
      `Goal correction cap reached (${goal.policy.maxCorrectionRounds}). Main must decide; no replacement work starts.`,
    );
  }
}

export function assertGoalReviewAllowed(goal: GoalRecord): void {
  if (goal.status === "stopped" || goal.status === "completed" || goal.status === "failed") {
    throw new Error(
      `Goal is ${goal.status}; review assignment is blocked. Handle the Task through existing Task authority.`,
    );
  }
  if (goal.counters.reviewRounds >= goal.policy.maxReviewRounds) {
    throw new Error(
      `Goal review cap reached (${goal.policy.maxReviewRounds}). Main must decide; no replacement review starts.`,
    );
  }
}

export function markGoalCapReached(
  store: StateStore,
  goalId: string,
  kind: "correction-cap" | "review-cap",
): void {
  const goal = store.getGoal(goalId);
  if (goal.status === "stopped" || goal.status === "completed") return;
  const now = timestamp();
  const updated: GoalRecord = {
    ...goal,
    status: "waiting",
    reasonCode: kind,
    reason: reasonText(kind),
    updatedAt: now,
  };
  store.saveGoal(updated, store.getGoalMilestones(goalId));
}
