/**
 * Canonical consecutive self-upgrade streak evidence.
 *
 * Pure, fail-closed calculator over durable Integration result records.
 * Never reads command output, raw errors, patches, paths, or Provider data.
 * Never mutates state.
 */

import type {
  IntegrationResultRecord,
  IntegrationStageEvidence,
  IntegrationStageName,
} from "./types.js";

/** Default M0 milestone: three consecutive complete four-stage upgrades. */
export const DEFAULT_SELF_UPGRADE_STREAK_REQUIRED = 3;
export const MIN_SELF_UPGRADE_STREAK_REQUIRED = 1;
export const MAX_SELF_UPGRADE_STREAK_REQUIRED = 20;

/**
 * Canonical durable delivery identity for ForkLight self-upgrade Integrations.
 * Only receipts whose deliveryPlan.profileId equals this exact value participate
 * in the M0 consecutive streak. Ordinary project deliveries (Elsewhere, Relay,
 * lookalikes, missing/legacy identity) are invisible to the streak.
 */
export const SELF_UPGRADE_DELIVERY_PROFILE_ID = "forklight-self-upgrade";

/**
 * Store window large enough for max required (20) plus one break result
 * and a small margin for audit. Display still caps achieved at required.
 * Applied to already-scoped self-upgrade results, never to all-project history.
 */
export const SELF_UPGRADE_RESULT_WINDOW = 40;

/** Stages that must each appear exactly once with status "passed". */
export const QUALIFYING_STAGES: readonly IntegrationStageName[] = Object.freeze([
  "source-applied",
  "source-verified",
  "artifact-built",
  "runtime-activated",
]);

const QUALIFYING_STAGE_SET: ReadonlySet<string> = new Set(QUALIFYING_STAGES);

type SelfUpgradeStreakState = "empty" | "in-progress" | "ready";

export type SelfUpgradeBreakCategory =
  | "none"
  | "retained-failure"
  | "rejected"
  | "rolled-back"
  | "insufficient-evidence";

type SelfUpgradeNextAction =
  | "run-first-upgrade"
  | "continue-consecutive-proofs"
  | "milestone-ready";

/** Bounded privacy-safe public projection. No command streams, raw errors, or paths. */
export interface SelfUpgradeEvidenceProjection {
  readonly required: number;
  readonly achieved: number;
  readonly remaining: number;
  readonly state: SelfUpgradeStreakState;
  readonly breakCategory: SelfUpgradeBreakCategory;
  readonly nextAction: SelfUpgradeNextAction;
  /** ISO timestamp of the newest qualifying success in the streak, when any. */
  readonly latestQualifyingAt?: string;
  /** Opaque operation id of the newest qualifying success (Main inspection only). */
  readonly latestQualifyingOperationId?: string;
  /** Opaque operation id of the result that broke the streak, when any. */
  readonly breakOperationId?: string;
  /** How many durable results were inspected (bounded window size). */
  readonly inspectedCount: number;
}

/** Minimal fields the calculator needs; keeps tests free of full store fixtures. */
export interface SelfUpgradeResultInput {
  id: string;
  status: IntegrationResultRecord["status"] | string;
  createdAt: string;
  appliedAt?: string;
  stages?: readonly IntegrationStageEvidence[] | readonly unknown[];
  /** Present on stored records but never projected. */
  error?: string;
}

/** Opaque ids only: no paths, spaces, or arbitrary text. */
export function isSafeOpaqueId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length < 1 || value.length > 80) return false;
  // Alphanumeric with limited separators; never path separators or spaces.
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(value)) return false;
  if (value.includes("..") || value.includes("/") || value.includes("\\")) return false;
  return true;
}

/** Canonical ISO-8601 UTC timestamps only. */
export function isSafeIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length < 20 || value.length > 40) return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

export function parseRequiredStreakCount(value: unknown): number {
  if (value === undefined || value === null) {
    return DEFAULT_SELF_UPGRADE_STREAK_REQUIRED;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(
      `required must be an integer from ${MIN_SELF_UPGRADE_STREAK_REQUIRED} to ${MAX_SELF_UPGRADE_STREAK_REQUIRED}`,
    );
  }
  if (
    value < MIN_SELF_UPGRADE_STREAK_REQUIRED
    || value > MAX_SELF_UPGRADE_STREAK_REQUIRED
  ) {
    throw new Error(
      `required must be an integer from ${MIN_SELF_UPGRADE_STREAK_REQUIRED} to ${MAX_SELF_UPGRADE_STREAK_REQUIRED}`,
    );
  }
  return value;
}

export function parseRequiredStreakCountFromString(
  raw: string | undefined,
): number {
  if (raw === undefined) return DEFAULT_SELF_UPGRADE_STREAK_REQUIRED;
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `required must be an integer from ${MIN_SELF_UPGRADE_STREAK_REQUIRED} to ${MAX_SELF_UPGRADE_STREAK_REQUIRED}`,
    );
  }
  return parseRequiredStreakCount(Number(raw));
}

/**
 * A qualifying success is status "applied" with exactly four stage evidence
 * entries: one for each required stage name, each status "passed".
 * Unknown, extra, duplicate, missing, failed, not-applicable, pending, or
 * outcome-unknown stage evidence does not qualify. Never infers success from
 * absent legacy evidence.
 */
export function isQualifyingFourStageSuccess(
  result: SelfUpgradeResultInput,
): boolean {
  if (result.status !== "applied") return false;
  const stages = result.stages;
  if (!Array.isArray(stages) || stages.length !== QUALIFYING_STAGES.length) {
    return false;
  }

  const seen = new Set<string>();
  for (const entry of stages) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return false;
    }
    const stage = (entry as IntegrationStageEvidence).stage;
    const status = (entry as IntegrationStageEvidence).status;
    if (typeof stage !== "string" || typeof status !== "string") return false;
    if (!QUALIFYING_STAGE_SET.has(stage)) return false;
    if (seen.has(stage)) return false;
    if (status !== "passed") return false;
    seen.add(stage);
  }
  return seen.size === QUALIFYING_STAGES.length;
}

function classifyBreak(result: SelfUpgradeResultInput): SelfUpgradeBreakCategory {
  switch (result.status) {
    case "retained-failure":
      return "retained-failure";
    case "rejected":
      return "rejected";
    case "rolled-back":
      return "rolled-back";
    case "applied":
      // Applied without complete unique four-stage evidence.
      return "insufficient-evidence";
    default:
      // Unknown or legacy status: fail closed.
      return "insufficient-evidence";
  }
}

function freezeProjection(
  projection: SelfUpgradeEvidenceProjection,
): SelfUpgradeEvidenceProjection {
  return Object.freeze({ ...projection });
}

function safeTimestampFrom(result: SelfUpgradeResultInput): string | undefined {
  if (isSafeIsoTimestamp(result.appliedAt)) return result.appliedAt;
  if (isSafeIsoTimestamp(result.createdAt)) return result.createdAt;
  return undefined;
}

/**
 * Count consecutive qualifying results from newest backward and stop at the
 * first non-qualifying terminal result. Does not skip failures. Achieved is
 * capped at required for display. Unsafe ids and timestamps are omitted.
 *
 * @param results Newest-first ordered durable Integration results.
 * @param required Streak milestone (1-20). Defaults to 3.
 */
export function computeSelfUpgradeEvidence(
  results: readonly SelfUpgradeResultInput[],
  required: number = DEFAULT_SELF_UPGRADE_STREAK_REQUIRED,
): SelfUpgradeEvidenceProjection {
  const requiredCount = parseRequiredStreakCount(required);
  const inspectedCount = results.length;

  if (results.length === 0) {
    return freezeProjection({
      required: requiredCount,
      achieved: 0,
      remaining: requiredCount,
      state: "empty",
      breakCategory: "none",
      nextAction: "run-first-upgrade",
      inspectedCount: 0,
    });
  }

  let rawAchieved = 0;
  let latestQualifyingAt: string | undefined;
  let latestQualifyingOperationId: string | undefined;
  let breakCategory: SelfUpgradeBreakCategory = "none";
  let breakOperationId: string | undefined;

  for (const result of results) {
    if (isQualifyingFourStageSuccess(result)) {
      if (rawAchieved === 0) {
        latestQualifyingAt = safeTimestampFrom(result);
        if (isSafeOpaqueId(result.id)) {
          latestQualifyingOperationId = result.id;
        }
      }
      rawAchieved += 1;
      // Stop once the display milestone is satisfied; older history is irrelevant.
      if (rawAchieved >= requiredCount) {
        break;
      }
      continue;
    }
    breakCategory = classifyBreak(result);
    if (isSafeOpaqueId(result.id)) {
      breakOperationId = result.id;
    }
    break;
  }

  const achieved = Math.min(rawAchieved, requiredCount);
  const remaining = requiredCount - achieved;

  if (achieved >= requiredCount) {
    return freezeProjection({
      required: requiredCount,
      achieved,
      remaining: 0,
      state: "ready",
      breakCategory: "none",
      nextAction: "milestone-ready",
      ...(latestQualifyingAt === undefined ? {} : { latestQualifyingAt }),
      ...(latestQualifyingOperationId === undefined
        ? {}
        : { latestQualifyingOperationId }),
      inspectedCount,
    });
  }

  return freezeProjection({
    required: requiredCount,
    achieved,
    remaining,
    state: "in-progress",
    breakCategory,
    nextAction: "continue-consecutive-proofs",
    ...(latestQualifyingAt === undefined ? {} : { latestQualifyingAt }),
    ...(latestQualifyingOperationId === undefined
      ? {}
      : { latestQualifyingOperationId }),
    ...(breakOperationId === undefined ? {} : { breakOperationId }),
    inspectedCount,
  });
}
