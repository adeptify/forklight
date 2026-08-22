/**
 * Grok CLI native /goal state boundary.
 *
 * Reads only the exact Task-owned Runtime state and maps verified native
 * terminal truth into Worker success or a bounded failure. No Store copy,
 * hash, manifest, version handshake, or classifier prose is persisted.
 */

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type {
  CorrectionExecutionIntent,
  WorkerValidationRepairExecutionIntent,
} from "./types.js";

export const GROK_NATIVE_GOAL_PROMPT_PREFIX = "/goal ";
export const GROK_NATIVE_GOAL_RESUME_PROMPT = "/goal resume";

const KNOWN_STATUSES = new Set([
  "active",
  "complete",
  "user_paused",
  "infra_paused",
  "paused",
  "blocked",
  "budget",
  "budget_limited",
  "budgetLimited",
]);

const PAUSED_STATUSES = new Set(["user_paused", "infra_paused", "paused"]);
const BUDGET_STATUSES = new Set(["budget", "budget_limited", "budgetLimited"]);

const OPTIONAL_NON_NEGATIVE_NUMBERS = [
  "total_worker_rounds",
  "total_verify_rounds",
  "classifier_runs_attempted",
  "classifier_max_runs",
  "token_baseline",
  "tokens_used_high_water",
  "parent_tokens_spent",
  "last_session_tokens_seen",
  "elapsed_ms",
  "evaluator_blocked_streak",
] as const;

export const GROK_NATIVE_GOAL_FAILURE = {
  missing: "Grok native Goal state is missing under the Task-local Runtime Home",
  malformed: "Grok native Goal state is malformed or unreadable",
  ambiguous: "Grok native Goal state is ambiguous for this Task Session",
  wrongRoot: "Grok native Goal state is not in the exact Task Workspace Session namespace",
  unknownStatus: "Grok native Goal status is unknown",
  completeWithoutAchieved: "Grok native Goal is complete without an achieved classifier verdict",
  achievedWithoutDetails: "Grok native Goal is achieved without readable Task-owned classifier details",
  missingDetails: "Grok native Goal classifier details are missing or unreadable",
  escapingDetails: "Grok native Goal classifier details escape the Task Runtime Home",
  paused: "Grok native Goal is paused and is not complete",
  blocked: "Grok native Goal is blocked and is not complete",
  budgetLimited: "Grok native Goal is budget-limited and is not complete",
  active: "Grok native Goal is still active and is not complete",
  untypedCompletedResume: "Grok native Goal cannot resume a completed Goal without authorized correction",
  successorNotDistinct: "Grok native Goal correction did not create a distinct successor Goal",
  resumeGoalMismatch: "Grok native Goal resume did not retain the same Goal id",
  successorRequiresComplete: "Grok native Goal correction requires a completed predecessor Goal",
  resumeRequiresState: "Grok native Goal resume requires existing Task-local Goal state",
} as const;

export type GrokNativeGoalFailureReason =
  (typeof GROK_NATIVE_GOAL_FAILURE)[keyof typeof GROK_NATIVE_GOAL_FAILURE];

export type GrokNativeGoalStatus =
  | "active"
  | "complete"
  | "user_paused"
  | "infra_paused"
  | "paused"
  | "blocked"
  | "budget"
  | "budget_limited"
  | "budgetLimited";

export interface ParsedGrokNativeGoalState {
  readonly goalId: string;
  readonly objective: string;
  readonly status: GrokNativeGoalStatus;
  readonly phase: string;
  readonly totalWorkerRounds?: number;
  readonly classifierRunsAttempted?: number;
  readonly lastClassifierVerdict?: string;
  readonly lastClassifierDetailsPath?: string;
  readonly tokensUsedHighWater?: number;
  readonly parentTokensSpent?: number;
  readonly lastSessionTokensSeen?: number;
  readonly tokenBaseline?: number;
}

export interface GrokNativeGoalObservation {
  readonly goalId: string;
  readonly status: string;
  readonly phase: string;
  readonly rounds?: number;
  readonly classifierVerdict?: string;
  readonly classifierRunsAttempted?: number;
  readonly tokensUsedHighWater?: number;
  readonly parentTokensSpent?: number;
  readonly lastSessionTokensSeen?: number;
  readonly tokenBaseline?: number;
}

export type GrokNativeGoalReadResult =
  | { readonly ok: true; readonly state: ParsedGrokNativeGoalState; readonly statePath: string }
  | { readonly ok: false; readonly reason: GrokNativeGoalFailureReason };

export type GrokNativeGoalLaunch =
  | { readonly ok: true; readonly kind: "create"; readonly prompt: string }
  | {
      readonly ok: true;
      readonly kind: "resume";
      readonly prompt: typeof GROK_NATIVE_GOAL_RESUME_PROMPT;
      readonly expectedGoalId: string;
    }
  | {
      readonly ok: true;
      readonly kind: "successor";
      readonly prompt: string;
      readonly predecessorGoalId: string;
      readonly reasonClass: "main-correction" | "worker-validation-repair";
    }
  | { readonly ok: false; readonly reason: GrokNativeGoalFailureReason };

export interface GrokNativeGoalEvaluation {
  readonly status: "succeeded" | "failed";
  readonly error?: string;
  readonly observation?: GrokNativeGoalObservation;
  readonly goalId?: string;
  readonly predecessorGoalId?: string;
}

function grokNativeGoalCreatePrompt(workerPrompt: string): string {
  return `${GROK_NATIVE_GOAL_PROMPT_PREFIX}${workerPrompt}`;
}

function grokNativeGoalResumePrompt(): typeof GROK_NATIVE_GOAL_RESUME_PROMPT {
  return GROK_NATIVE_GOAL_RESUME_PROMPT;
}

function grokNativeGoalSuccessorPrompt(correctionObjective: string): string {
  return `${GROK_NATIVE_GOAL_PROMPT_PREFIX}${correctionObjective}`;
}

/** Exact Grok 1.0.3 Task-local state path for one Workspace Session. */
export function grokNativeGoalStatePath(
  grokHome: string,
  workspace: string,
  sessionId: string,
): string {
  return path.join(
    grokHome,
    "sessions",
    encodeURIComponent(workspace),
    sessionId,
    "goal",
    "state.json",
  );
}

export function grokNativeGoalObservation(
  state: ParsedGrokNativeGoalState,
): GrokNativeGoalObservation {
  return {
    goalId: state.goalId,
    status: state.status,
    phase: state.phase,
    ...(state.totalWorkerRounds === undefined ? {} : { rounds: state.totalWorkerRounds }),
    ...(state.lastClassifierVerdict === undefined
      ? {}
      : { classifierVerdict: state.lastClassifierVerdict }),
    ...(state.classifierRunsAttempted === undefined
      ? {}
      : { classifierRunsAttempted: state.classifierRunsAttempted }),
    ...(state.tokensUsedHighWater === undefined
      ? {}
      : { tokensUsedHighWater: state.tokensUsedHighWater }),
    ...(state.parentTokensSpent === undefined ? {} : { parentTokensSpent: state.parentTokensSpent }),
    ...(state.lastSessionTokensSeen === undefined
      ? {}
      : { lastSessionTokensSeen: state.lastSessionTokensSeen }),
    ...(state.tokenBaseline === undefined ? {} : { tokenBaseline: state.tokenBaseline }),
  };
}

export function resolveGrokNativeGoalLaunch(input: {
  resuming: boolean;
  workerPrompt: string;
  prior: GrokNativeGoalReadResult;
  correctionIntent?: CorrectionExecutionIntent;
  validationRepairIntent?: WorkerValidationRepairExecutionIntent;
}): GrokNativeGoalLaunch {
  const authorized = input.correctionIntent !== undefined
    || input.validationRepairIntent !== undefined;
  const reasonClass = input.validationRepairIntent !== undefined
    ? "worker-validation-repair" as const
    : "main-correction" as const;

  if (input.prior.ok && input.prior.state.status === "complete" && !authorized) {
    return { ok: false, reason: GROK_NATIVE_GOAL_FAILURE.untypedCompletedResume };
  }

  if (authorized) {
    if (!input.prior.ok) {
      return {
        ok: false,
        reason: input.prior.reason === GROK_NATIVE_GOAL_FAILURE.missing
          ? GROK_NATIVE_GOAL_FAILURE.resumeRequiresState
          : input.prior.reason,
      };
    }
    if (input.prior.state.status !== "complete") {
      return { ok: false, reason: GROK_NATIVE_GOAL_FAILURE.successorRequiresComplete };
    }
    return {
      ok: true,
      kind: "successor",
      prompt: grokNativeGoalSuccessorPrompt(input.workerPrompt),
      predecessorGoalId: input.prior.state.goalId,
      reasonClass,
    };
  }

  if (input.resuming) {
    if (!input.prior.ok) {
      return {
        ok: false,
        reason: input.prior.reason === GROK_NATIVE_GOAL_FAILURE.missing
          ? GROK_NATIVE_GOAL_FAILURE.resumeRequiresState
          : input.prior.reason,
      };
    }
    return {
      ok: true,
      kind: "resume",
      prompt: grokNativeGoalResumePrompt(),
      expectedGoalId: input.prior.state.goalId,
    };
  }

  if (!input.prior.ok && input.prior.reason !== GROK_NATIVE_GOAL_FAILURE.missing) {
    return { ok: false, reason: input.prior.reason };
  }

  return {
    ok: true,
    kind: "create",
    prompt: grokNativeGoalCreatePrompt(input.workerPrompt),
  };
}

/**
 * Read the exact Task-local native state. Exit code and completion prose are
 * ignored here; callers must still fail closed unless this returns a parsed
 * complete + achieved + owned-details state.
 */
export function readGrokNativeGoalState(input: {
  grokHome: string;
  workspace: string;
  sessionId: string;
}): GrokNativeGoalReadResult {
  if (!isNonEmptyString(input.grokHome) || !isNonEmptyString(input.workspace)) {
    return { ok: false, reason: GROK_NATIVE_GOAL_FAILURE.malformed };
  }
  if (!isSafeSessionId(input.sessionId)) {
    return { ok: false, reason: GROK_NATIVE_GOAL_FAILURE.malformed };
  }

  const expected = grokNativeGoalStatePath(input.grokHome, input.workspace, input.sessionId);
  if (!pathContainedInRoot(expected, input.grokHome)) {
    return { ok: false, reason: GROK_NATIVE_GOAL_FAILURE.wrongRoot };
  }

  const matches = findSessionStateFiles(input.grokHome, input.sessionId);
  const expectedExists = existsSync(expected);
  const extras = matches.filter((candidate) => path.resolve(candidate) !== path.resolve(expected));

  if (expectedExists && extras.length > 0) {
    return { ok: false, reason: GROK_NATIVE_GOAL_FAILURE.ambiguous };
  }
  if (!expectedExists && extras.length > 1) {
    return { ok: false, reason: GROK_NATIVE_GOAL_FAILURE.ambiguous };
  }
  if (!expectedExists && extras.length === 1) {
    return { ok: false, reason: GROK_NATIVE_GOAL_FAILURE.wrongRoot };
  }
  if (!expectedExists) {
    return { ok: false, reason: GROK_NATIVE_GOAL_FAILURE.missing };
  }
  if (!pathOwnedByRoot(expected, input.grokHome)) {
    return { ok: false, reason: GROK_NATIVE_GOAL_FAILURE.wrongRoot };
  }

  return parseGrokNativeGoalStateFile(expected);
}

export function mapGrokNativeGoalTerminal(
  read: GrokNativeGoalReadResult,
  grokHome: string,
): GrokNativeGoalEvaluation {
  if (!read.ok) {
    return { status: "failed", error: read.reason };
  }
  const observation = grokNativeGoalObservation(read.state);
  const status = read.state.status;
  if (PAUSED_STATUSES.has(status)) {
    return { status: "failed", error: GROK_NATIVE_GOAL_FAILURE.paused, observation, goalId: read.state.goalId };
  }
  if (status === "blocked") {
    return { status: "failed", error: GROK_NATIVE_GOAL_FAILURE.blocked, observation, goalId: read.state.goalId };
  }
  if (BUDGET_STATUSES.has(status)) {
    return {
      status: "failed",
      error: GROK_NATIVE_GOAL_FAILURE.budgetLimited,
      observation,
      goalId: read.state.goalId,
    };
  }
  if (status === "active") {
    return { status: "failed", error: GROK_NATIVE_GOAL_FAILURE.active, observation, goalId: read.state.goalId };
  }
  if (status !== "complete") {
    return {
      status: "failed",
      error: GROK_NATIVE_GOAL_FAILURE.unknownStatus,
      observation,
      goalId: read.state.goalId,
    };
  }

  const attempts = read.state.classifierRunsAttempted;
  if (attempts === undefined || attempts < 1 || read.state.lastClassifierVerdict !== "achieved") {
    return {
      status: "failed",
      error: GROK_NATIVE_GOAL_FAILURE.completeWithoutAchieved,
      observation,
      goalId: read.state.goalId,
    };
  }

  const detailsPath = read.state.lastClassifierDetailsPath;
  if (!isNonEmptyString(detailsPath)) {
    return {
      status: "failed",
      error: GROK_NATIVE_GOAL_FAILURE.achievedWithoutDetails,
      observation,
      goalId: read.state.goalId,
    };
  }

  const resolvedDetails = resolveDetailsPath(detailsPath, path.dirname(read.statePath));
  if (resolvedDetails === undefined) {
    return {
      status: "failed",
      error: GROK_NATIVE_GOAL_FAILURE.missingDetails,
      observation,
      goalId: read.state.goalId,
    };
  }
  if (!pathOwnedByRoot(resolvedDetails, grokHome)) {
    return {
      status: "failed",
      error: GROK_NATIVE_GOAL_FAILURE.escapingDetails,
      observation,
      goalId: read.state.goalId,
    };
  }
  if (!isReadableFile(resolvedDetails)) {
    return {
      status: "failed",
      error: GROK_NATIVE_GOAL_FAILURE.missingDetails,
      observation,
      goalId: read.state.goalId,
    };
  }

  return {
    status: "succeeded",
    observation,
    goalId: read.state.goalId,
  };
}

/**
 * Map Task-local native state into Worker success or a bounded failure.
 * Exit 0 and completion prose cannot impersonate complete + achieved + owned details.
 */
export function evaluateGrokNativeGoalResult(input: {
  grokHome: string;
  workspace: string;
  sessionId: string;
  launch: Extract<GrokNativeGoalLaunch, { ok: true }>;
  exitCode: number;
  completionProse?: string;
}): GrokNativeGoalEvaluation {
  void input.exitCode;
  void input.completionProse;
  const read = readGrokNativeGoalState({
    grokHome: input.grokHome,
    workspace: input.workspace,
    sessionId: input.sessionId,
  });
  if (input.launch.kind === "resume") {
    if (!read.ok) {
      return { status: "failed", error: read.reason };
    }
    if (read.state.goalId !== input.launch.expectedGoalId) {
      return {
        status: "failed",
        error: GROK_NATIVE_GOAL_FAILURE.resumeGoalMismatch,
        observation: grokNativeGoalObservation(read.state),
        goalId: read.state.goalId,
      };
    }
  }
  if (input.launch.kind === "successor") {
    if (!read.ok) {
      return { status: "failed", error: read.reason };
    }
    if (read.state.goalId === input.launch.predecessorGoalId) {
      return {
        status: "failed",
        error: GROK_NATIVE_GOAL_FAILURE.successorNotDistinct,
        observation: grokNativeGoalObservation(read.state),
        goalId: read.state.goalId,
        predecessorGoalId: input.launch.predecessorGoalId,
      };
    }
    const mapped = mapGrokNativeGoalTerminal(read, input.grokHome);
    return {
      ...mapped,
      predecessorGoalId: input.launch.predecessorGoalId,
    };
  }
  return mapGrokNativeGoalTerminal(read, input.grokHome);
}

function parseGrokNativeGoalStateFile(statePath: string): GrokNativeGoalReadResult {
  let raw: string;
  try {
    raw = readFileSync(statePath, "utf8");
  } catch {
    return { ok: false, reason: GROK_NATIVE_GOAL_FAILURE.malformed };
  }

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, reason: GROK_NATIVE_GOAL_FAILURE.malformed };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: GROK_NATIVE_GOAL_FAILURE.malformed };
  }
  const record = value as Record<string, unknown>;
  const goalId = record.goal_id;
  const objective = record.objective;
  const status = record.status;
  const phase = record.phase;
  if (!isNonEmptyString(goalId) || !isNonEmptyString(objective) || !isNonEmptyString(phase)) {
    return { ok: false, reason: GROK_NATIVE_GOAL_FAILURE.malformed };
  }
  if (typeof status !== "string" || status.trim().length === 0) {
    return { ok: false, reason: GROK_NATIVE_GOAL_FAILURE.malformed };
  }
  if (!KNOWN_STATUSES.has(status)) {
    return { ok: false, reason: GROK_NATIVE_GOAL_FAILURE.unknownStatus };
  }
  for (const field of OPTIONAL_NON_NEGATIVE_NUMBERS) {
    if (record[field] === undefined) continue;
    if (!isNonNegativeFiniteNumber(record[field])) {
      return { ok: false, reason: GROK_NATIVE_GOAL_FAILURE.malformed };
    }
    if (
      (field === "total_worker_rounds" || field === "classifier_runs_attempted")
      && !Number.isInteger(record[field])
    ) {
      return { ok: false, reason: GROK_NATIVE_GOAL_FAILURE.malformed };
    }
  }
  if (record.last_classifier_verdict !== undefined && !isNonEmptyString(record.last_classifier_verdict)) {
    return { ok: false, reason: GROK_NATIVE_GOAL_FAILURE.malformed };
  }
  if (
    record.last_classifier_details_path !== undefined
    && !isNonEmptyString(record.last_classifier_details_path)
  ) {
    return { ok: false, reason: GROK_NATIVE_GOAL_FAILURE.malformed };
  }

  return {
    ok: true,
    statePath,
    state: {
      goalId,
      objective,
      status: status as GrokNativeGoalStatus,
      phase,
      ...(record.total_worker_rounds === undefined
        ? {}
        : { totalWorkerRounds: record.total_worker_rounds as number }),
      ...(record.classifier_runs_attempted === undefined
        ? {}
        : { classifierRunsAttempted: record.classifier_runs_attempted as number }),
      ...(record.last_classifier_verdict === undefined
        ? {}
        : { lastClassifierVerdict: record.last_classifier_verdict as string }),
      ...(record.last_classifier_details_path === undefined
        ? {}
        : { lastClassifierDetailsPath: record.last_classifier_details_path as string }),
      ...(record.tokens_used_high_water === undefined
        ? {}
        : { tokensUsedHighWater: record.tokens_used_high_water as number }),
      ...(record.parent_tokens_spent === undefined
        ? {}
        : { parentTokensSpent: record.parent_tokens_spent as number }),
      ...(record.last_session_tokens_seen === undefined
        ? {}
        : { lastSessionTokensSeen: record.last_session_tokens_seen as number }),
      ...(record.token_baseline === undefined ? {} : { tokenBaseline: record.token_baseline as number }),
    },
  };
}

function findSessionStateFiles(grokHome: string, sessionId: string): string[] {
  const sessionsRoot = path.join(grokHome, "sessions");
  if (!existsSync(sessionsRoot)) return [];
  try {
    const entries = readdirSync(sessionsRoot, { withFileTypes: true, encoding: "utf8" });
    const found: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(sessionsRoot, entry.name, sessionId, "goal", "state.json");
      if (existsSync(candidate)) found.push(candidate);
    }
    return found;
  } catch {
    return [];
  }
}

function resolveDetailsPath(detailsPath: string, goalDir: string): string | undefined {
  const candidate = path.isAbsolute(detailsPath)
    ? detailsPath
    : path.resolve(goalDir, detailsPath);
  try {
    return realpathSync(candidate);
  } catch {
    return existsSync(candidate) ? path.resolve(candidate) : undefined;
  }
}

function isReadableFile(filePath: string): boolean {
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return false;
    readFileSync(filePath, { encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

function pathOwnedByRoot(candidatePath: string, root: string): boolean {
  let rootReal: string;
  let candidateReal: string;
  try {
    rootReal = realpathSync(root);
  } catch {
    return false;
  }
  try {
    candidateReal = realpathSync(candidatePath);
  } catch {
    candidateReal = path.resolve(candidatePath);
  }
  return pathContainedInRoot(candidateReal, rootReal);
}

function pathContainedInRoot(candidatePath: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidatePath));
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function isSafeSessionId(sessionId: string): boolean {
  return isNonEmptyString(sessionId)
    && !sessionId.includes("/")
    && !sessionId.includes("\\")
    && !sessionId.includes("..");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
