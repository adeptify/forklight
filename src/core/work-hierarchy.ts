/**
 * Canonical Goal -> Plan -> Task hierarchy read model (FL-109A).
 *
 * Joins existing safe Goal, Plan, dependency, and Task evidence into one
 * versioned WorkHierarchyView. Read-only and deterministic: does not write
 * status, schedule work, resolve Profiles, or expose private evidence.
 */
import {
  isPrerequisiteResultComplete,
  resolveReadiness,
} from "./dependency-resolver.js";
import {
  evaluateMilestoneGate,
  projectGoal,
  resolveEffectiveMilestoneLineage,
  type GoalDeliveryBasis,
  type GoalView,
} from "./goal.js";
import {
  isLegalBoardPlacement,
  type BoardReason,
  type BoardScope,
  type SafeTaskSummary,
} from "./task-summary.js";
import {
  projectTaskActionPolicy,
  type TaskActionPolicy,
} from "./task-action-policy.js";
import type {
  DecisionStage,
  DependencyRecord,
  GoalMilestoneGate,
  GoalMilestoneRecord,
  GoalReasonCode,
  PlanItemRecord,
  PlanRecord,
  TaskRecord,
  TaskStatus,
} from "./types.js";
import type { StateStore } from "../state/store.js";

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/** Seven stable execution-state columns. Goal/Plan are ancestor lanes only. */
export type WorkHierarchyColumnCode =
  | "not-started"
  | "ready"
  | "running"
  | "waiting-verification"
  | "waiting-user-decision"
  | "completed"
  | "stopped-failed";

/** Bounded placement reason explaining why a card sits in its column. */
export type WorkHierarchyPlacementReason =
  | "dependency-unsatisfied"
  | "queued-ready"
  | "lifecycle-running"
  | "lifecycle-verifying"
  | "awaiting-main-decision"
  | "delivered-outcome"
  | "stopped-or-failed"
  | "unrecognized-evidence"
  | "goal-gate-satisfied";

export const WORK_HIERARCHY_COLUMNS: readonly WorkHierarchyColumnCode[] = [
  "not-started",
  "ready",
  "running",
  "waiting-verification",
  "waiting-user-decision",
  "completed",
  "stopped-failed",
] as const;

const COLUMN_SET = new Set<string>(WORK_HIERARCHY_COLUMNS);

/** Fixed privacy-safe reason for malformed filter input. */
export const WORK_HIERARCHY_INVALID_FILTER_REASON =
  "Work hierarchy filter is invalid.";

const MAX_NAME_LEN = 200;
const MAX_BLOCKERS = 5;
const MAX_EDGES = 20;
const MAX_PROJECT_FILTER_LEN = 500;
const MAX_WORKER_FILTER_LEN = 200;
const MAX_COMPLETED_NAMES = 3;

// ---------------------------------------------------------------------------
// Schema types (schemaVersion 1)
// ---------------------------------------------------------------------------

export interface WorkHierarchyColumnDefinition {
  code: WorkHierarchyColumnCode;
  order: number;
}

export interface WorkHierarchyNamedEdge {
  itemId: string;
  taskId?: string;
  taskName?: string;
  taskStatus?: TaskStatus;
  state?: "satisfied" | "waiting" | "failed";
}

export interface WorkHierarchyBlocker {
  code: "dependency-waiting" | "dependency-failed" | "task-failed" | "task-blocked";
  /** Bounded plain label naming the blocker; never raw error/prompt text. */
  label: string;
}

export interface WorkHierarchyBreadcrumb {
  taskId: string;
  taskName: string;
  goalId?: string;
  goalName?: string;
  planId?: string;
  planName?: string;
  /** Original Plan-item Task when a Goal handoff successor is effective. */
  originalTaskId?: string;
  effectiveTaskId?: string;
}

/**
 * Closed Work hierarchy narrative codes (FL-108C1).
 * Core owns meaning; Hub localizes known codes and fails closed on unknowns.
 * Never derived by parsing legacy English prose.
 */
export type WorkHierarchyNarrativeCode =
  // Goal what-happened
  | "goal-what-completed"
  | "goal-what-main-stop"
  | "goal-what-correction-cap"
  | "goal-what-review-cap"
  | "goal-what-no-new-evidence-cap"
  | "goal-what-duration-exceeded"
  | "goal-what-no-progress"
  | "goal-what-milestone-failed"
  | "goal-what-started"
  | "goal-what-milestone-satisfied"
  | "goal-what-current"
  // Goal waiting / blocker
  | "goal-wait-admission-blocked"
  | "goal-wait-all-gates-satisfied"
  | "goal-wait-nothing"
  | "goal-wait-machine"
  | "goal-wait-main-accept"
  | "goal-wait-integration"
  | "goal-wait-task"
  | "goal-wait-milestone-failed"
  | "goal-wait-main-stop"
  | "goal-wait-correction-cap"
  | "goal-wait-review-cap"
  | "goal-wait-no-new-evidence-cap"
  | "goal-wait-duration-exceeded"
  | "goal-wait-no-progress"
  | "goal-wait-progressing"
  // Goal next action (mirrors GoalNextActionCode)
  | "goal-next-wait-for-worker"
  | "goal-next-main-accept"
  | "goal-next-main-review"
  | "goal-next-integrate"
  | "goal-next-correct-or-decide"
  | "goal-next-advance"
  | "goal-next-stop-or-decide"
  | "goal-next-resume-task"
  | "goal-next-none"
  // Card what-happened
  | "card-what-delivered"
  | "card-what-nothing"
  | "card-what-goal-gate-complete"
  // Card next action
  | "card-next-waiting-prerequisite"
  | "card-next-not-started"
  | "card-next-ready"
  | "card-next-running"
  | "card-next-waiting-verification"
  | "card-next-waiting-main-decision"
  | "card-next-no-further-action"
  | "card-next-needs-recovery"
  | "card-next-goal-gate-satisfied"
  // Lane aggregation
  | "lane-what-none-completed"
  | "lane-what-completed-names"
  | "lane-what-completed-count"
  | "lane-blocker-blocked"
  | "lane-blocker-waiting"
  | "lane-blocker-none"
  | "lane-next-no-step";

/** Bounded primitive params only: labels, names, counts, closed codes, milestone ids. */
export type WorkHierarchyNarrativeParamValue = string | number;

export interface WorkHierarchyNarrativeMessage {
  code: WorkHierarchyNarrativeCode;
  params?: Record<string, WorkHierarchyNarrativeParamValue>;
}

export interface WorkHierarchyLaneSummary {
  whatCompleted: string;
  blocker: string;
  nextAction: string;
  /** Coded what-happened; Hub prefers this over the legacy string when present. */
  whatCompletedMessage?: WorkHierarchyNarrativeMessage;
  /** Coded blocker/waiting state; empty codes stay additive compatibility only. */
  blockerMessage?: WorkHierarchyNarrativeMessage;
  /** Coded next action; Hub prefers this over the legacy string when present. */
  nextActionMessage?: WorkHierarchyNarrativeMessage;
  progress: {
    total: number;
    completed: number;
    percent: number;
  };
}

/** Bounded Plan-relative milestone truth on a Goal-owned card.
 *  Explains why the card is complete (or still waiting) in this Goal's lane
 *  without hiding the underlying Task-wide decision stage, status, or board
 *  placement. Derived from the same evaluateMilestoneGate authority as the
 *  Goal milestone projection; never inferred from the Goal label alone. */
export interface WorkHierarchyGoalGateEvidence {
  gate: GoalMilestoneGate;
  satisfied: boolean;
  reasonCode: GoalReasonCode;
  /** Privacy-safe plain explanation from the Goal gate authority. */
  reason: string;
  /** Privacy-safe next action in the Goal's lane. */
  nextAction: string;
  /** Delivery provenance when an integration gate is satisfied. */
  deliveryBasis?: GoalDeliveryBasis;
}

export interface WorkHierarchyTaskCard {
  taskId: string;
  name: string;
  column: WorkHierarchyColumnCode;
  placementReason: WorkHierarchyPlacementReason;
  status: TaskStatus;
  decisionStage?: DecisionStage;
  boardScope?: BoardScope;
  boardReason?: BoardReason;
  provider: string;
  model: string;
  runtime: string;
  workerProfileId?: string;
  /** Task project path used for project filter matching (bounded allowlist). */
  project: string;
  itemId?: string;
  itemIndex?: number;
  breadcrumb: WorkHierarchyBreadcrumb;
  namedDependencies: WorkHierarchyNamedEdge[];
  namedRequiredBy: WorkHierarchyNamedEdge[];
  blockers: WorkHierarchyBlocker[];
  whatCompleted: string;
  nextAction: string;
  /** Coded what-happened beside the legacy string (FL-108C1). */
  whatCompletedMessage?: WorkHierarchyNarrativeMessage;
  /** Coded next action beside the legacy string (FL-108C1). */
  nextActionMessage?: WorkHierarchyNarrativeMessage;
  /** Present only on Goal-supervised Plan cards (FL-109E2). */
  goalGate?: WorkHierarchyGoalGateEvidence;
  /** Core-owned truthful action policy (FL-109C1). Read-only; Hub never recomputes. */
  actionPolicy: TaskActionPolicy;
  updatedAt: string;
}

export interface WorkHierarchyPlanLane {
  kind: "plan";
  planId: string;
  name: string;
  objective: string;
  updatedAt: string;
  summary: WorkHierarchyLaneSummary;
  /** Cards grouped by the seven stable columns. */
  columns: Record<WorkHierarchyColumnCode, WorkHierarchyTaskCard[]>;
}

export interface WorkHierarchyGoalLane {
  kind: "goal";
  goalId: string;
  name: string;
  objective: string;
  status: GoalView["status"];
  updatedAt: string;
  summary: WorkHierarchyLaneSummary;
  /** Always an array so future multi-Plan storage does not replace the contract. */
  plans: WorkHierarchyPlanLane[];
  /**
   * Core-selected current phase. Absent when every supervised milestone is
   * satisfied (terminal Goal); Hub falls back to the last phase for history.
   */
  currentPlanId?: string;
}

export interface WorkHierarchyOneOffLane {
  kind: "one-off";
  summary: WorkHierarchyLaneSummary;
  columns: Record<WorkHierarchyColumnCode, WorkHierarchyTaskCard[]>;
}

export interface WorkHierarchyFilter {
  project?: string;
  /** One or more column codes; card must match any listed column. */
  columns?: WorkHierarchyColumnCode[];
  workerProfileId?: string;
}

interface WorkHierarchyFilterMeta {
  applied: WorkHierarchyFilter;
}

export interface WorkHierarchyView {
  schemaVersion: 1;
  columns: WorkHierarchyColumnDefinition[];
  goals: WorkHierarchyGoalLane[];
  independentPlans: WorkHierarchyPlanLane[];
  /** Exactly one One-off lane object when any one-off cards remain after filter. */
  oneOffTasks?: WorkHierarchyOneOffLane;
  filter: WorkHierarchyFilterMeta;
}

// ---------------------------------------------------------------------------
// Pure column mapper
// ---------------------------------------------------------------------------

interface HierarchyColumnInput {
  status: TaskStatus | undefined;
  decisionStage?: DecisionStage;
  boardScope?: BoardScope;
  boardReason?: BoardReason;
  /** True when every direct plan dependency is durably satisfied (or none). */
  dependenciesSatisfied: boolean;
}

/**
 * Closed Task-to-column mapping. Dependencies outrank raw queued/waiting/
 * blocked status for Ready. Unrecognized or contradictory evidence fails
 * closed away from Completed so unfinished work is never hidden.
 */
export function mapTaskToHierarchyColumn(
  input: HierarchyColumnInput,
): { column: WorkHierarchyColumnCode; placementReason: WorkHierarchyPlacementReason } {
  const status = input.status;
  const stage = input.decisionStage;
  const legalPlacement = isLegalBoardPlacement(input.boardScope, input.boardReason);
  const boardReason = legalPlacement ? input.boardReason : undefined;
  const boardScope = legalPlacement ? input.boardScope : undefined;

  // 1. Durable delivered outcomes only claim Completed.
  if (
    boardScope === "history"
    && (boardReason === "delivered"
      || boardReason === "activated"
      || boardReason === "repaired-delivered")
  ) {
    return { column: "completed", placementReason: "delivered-outcome" };
  }
  if (stage === "delivered" || stage === "activated") {
    return { column: "completed", placementReason: "delivered-outcome" };
  }

  // 2. Dependency-held queued/waiting/blocked work is Not started — never Ready
  // and never Stopped/failed. Scheduler may stamp waiting/blocked while deps
  // remain unsatisfied; that is pre-start holding, not terminal failure.
  if (
    !input.dependenciesSatisfied
    && (status === undefined
      || status === "queued"
      || status === "waiting"
      || status === "blocked"
      || stage === "queued")
  ) {
    return { column: "not-started", placementReason: "dependency-unsatisfied" };
  }

  // 3. Stopped / failed / rejected / unresolved (including history closures that
  // are not deliveries). blocked with satisfied deps remains terminal here.
  if (
    status === "failed"
    || status === "interrupted"
    || status === "blocked"
    || stage === "machine-failed"
    || stage === "integration-failed"
    || stage === "main-rejected"
    || boardReason === "main-rejected"
    || boardReason === "attention-resolved"
    || boardReason === "unresolved-failure"
  ) {
    return { column: "stopped-failed", placementReason: "stopped-or-failed" };
  }

  // 4. Active execution / verification / Main decision — these outrank
  // dependency placement so an in-flight Task is never labelled Not started.
  if (status === "verifying") {
    return { column: "waiting-verification", placementReason: "lifecycle-verifying" };
  }
  if (
    stage === "awaiting-main-review"
    || stage === "machine-verified"
    || stage === "revision-requested"
    || stage === "ready-for-integration"
    || stage === "integrating"
    || stage === "applied-not-activated"
    || boardReason === "awaiting-main"
    || boardReason === "revision-requested"
    || boardReason === "integration-pending"
  ) {
    return { column: "waiting-user-decision", placementReason: "awaiting-main-decision" };
  }
  if (
    status === "preparing"
    || status === "running"
    || stage === "worker-running"
  ) {
    return { column: "running", placementReason: "lifecycle-running" };
  }

  // 5. Queued / waiting / no status with deps satisfied: Ready.
  if (
    status === undefined
    || status === "queued"
    || status === "waiting"
    || stage === "queued"
  ) {
    return { column: "ready", placementReason: "queued-ready" };
  }

  // 6. Machine succeeded without durable delivery evidence: fail closed to
  // waiting-user-decision so it cannot claim Completed.
  if (status === "succeeded") {
    return { column: "waiting-user-decision", placementReason: "awaiting-main-decision" };
  }

  // 7. Unrecognized / contradictory evidence: never Completed.
  if (boardReason === "needs-review" || stage === "unknown" || stage === undefined) {
    return { column: "waiting-user-decision", placementReason: "unrecognized-evidence" };
  }

  return { column: "waiting-user-decision", placementReason: "unrecognized-evidence" };
}

// ---------------------------------------------------------------------------
// Filter parsing
// ---------------------------------------------------------------------------

/** Closed allowlist of filter object keys. Any other key fails closed. */
const FILTER_ALLOWED_KEYS = new Set(["project", "workerProfileId", "column", "columns"]);

/**
 * Strict bounded filter parsing. Unknown keys, simultaneous column+columns,
 * unsupported column codes, empty strings, and overlong values all fail closed
 * with a fixed privacy-safe reason.
 */
export function parseWorkHierarchyFilter(
  input: Record<string, unknown> | undefined,
): WorkHierarchyFilter {
  if (input === undefined) return {};

  for (const key of Object.keys(input)) {
    if (!FILTER_ALLOWED_KEYS.has(key)) {
      throw new Error(WORK_HIERARCHY_INVALID_FILTER_REASON);
    }
  }

  // Ambiguous dual column keys fail closed instead of silently preferring one.
  if (input.column !== undefined && input.columns !== undefined) {
    throw new Error(WORK_HIERARCHY_INVALID_FILTER_REASON);
  }

  const filter: WorkHierarchyFilter = {};

  if (input.project !== undefined) {
    if (typeof input.project !== "string") {
      throw new Error(WORK_HIERARCHY_INVALID_FILTER_REASON);
    }
    const project = input.project.trim();
    if (project.length === 0 || project.length > MAX_PROJECT_FILTER_LEN) {
      throw new Error(WORK_HIERARCHY_INVALID_FILTER_REASON);
    }
    filter.project = project;
  }

  if (input.workerProfileId !== undefined) {
    if (typeof input.workerProfileId !== "string") {
      throw new Error(WORK_HIERARCHY_INVALID_FILTER_REASON);
    }
    const workerProfileId = input.workerProfileId.trim();
    if (workerProfileId.length === 0 || workerProfileId.length > MAX_WORKER_FILTER_LEN) {
      throw new Error(WORK_HIERARCHY_INVALID_FILTER_REASON);
    }
    filter.workerProfileId = workerProfileId;
  }

  // Accept singular `column` or plural `columns` (string, comma-list, or array).
  const rawColumns = input.columns ?? input.column;
  if (rawColumns !== undefined) {
    const codes: string[] = [];
    if (typeof rawColumns === "string") {
      for (const part of rawColumns.split(",")) {
        const trimmed = part.trim();
        if (trimmed.length > 0) codes.push(trimmed);
      }
    } else if (Array.isArray(rawColumns)) {
      for (const value of rawColumns) {
        if (typeof value !== "string") {
          throw new Error(WORK_HIERARCHY_INVALID_FILTER_REASON);
        }
        const trimmed = value.trim();
        if (trimmed.length > 0) codes.push(trimmed);
      }
    } else {
      throw new Error(WORK_HIERARCHY_INVALID_FILTER_REASON);
    }
    if (codes.length === 0) {
      throw new Error(WORK_HIERARCHY_INVALID_FILTER_REASON);
    }
    const columns: WorkHierarchyColumnCode[] = [];
    for (const code of codes) {
      if (!COLUMN_SET.has(code)) {
        throw new Error(WORK_HIERARCHY_INVALID_FILTER_REASON);
      }
      if (!columns.includes(code as WorkHierarchyColumnCode)) {
        columns.push(code as WorkHierarchyColumnCode);
      }
    }
    filter.columns = columns;
  }

  return filter;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyColumns(): Record<WorkHierarchyColumnCode, WorkHierarchyTaskCard[]> {
  return {
    "not-started": [],
    ready: [],
    running: [],
    "waiting-verification": [],
    "waiting-user-decision": [],
    completed: [],
    "stopped-failed": [],
  };
}

function sanitiseName(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const cleaned = raw.slice(0, MAX_NAME_LEN).replace(/[\x00-\x1f\x7f]/g, "").trim();
  return cleaned.length === 0 ? undefined : cleaned;
}

function columnDefinitions(): WorkHierarchyColumnDefinition[] {
  return WORK_HIERARCHY_COLUMNS.map((code, order) => ({ code, order }));
}

function dependencyEdgeState(
  status: TaskStatus | undefined,
): "satisfied" | "waiting" | "failed" {
  if (status === "succeeded") return "satisfied";
  if (status === "failed" || status === "interrupted" || status === "blocked") return "failed";
  return "waiting";
}

function cardCount(columns: Record<WorkHierarchyColumnCode, WorkHierarchyTaskCard[]>): number {
  let total = 0;
  for (const code of WORK_HIERARCHY_COLUMNS) total += columns[code].length;
  return total;
}

function flatCards(
  columns: Record<WorkHierarchyColumnCode, WorkHierarchyTaskCard[]>,
): WorkHierarchyTaskCard[] {
  const out: WorkHierarchyTaskCard[] = [];
  for (const code of WORK_HIERARCHY_COLUMNS) out.push(...columns[code]);
  return out;
}

function sortCards(cards: WorkHierarchyTaskCard[]): WorkHierarchyTaskCard[] {
  return cards.slice().sort((a, b) => {
    const ai = a.itemIndex ?? Number.MAX_SAFE_INTEGER;
    const bi = b.itemIndex ?? Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
    return a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0;
  });
}

function placeCards(
  cards: WorkHierarchyTaskCard[],
): Record<WorkHierarchyColumnCode, WorkHierarchyTaskCard[]> {
  const columns = emptyColumns();
  for (const card of sortCards(cards)) {
    columns[card.column].push(card);
  }
  return columns;
}

function cardMatchesFilter(
  card: WorkHierarchyTaskCard,
  filter: WorkHierarchyFilter,
): boolean {
  if (filter.project !== undefined && card.project !== filter.project) return false;
  if (
    filter.workerProfileId !== undefined
    && card.workerProfileId !== filter.workerProfileId
  ) {
    return false;
  }
  if (filter.columns !== undefined && !filter.columns.includes(card.column)) {
    return false;
  }
  return true;
}

function hasActiveFilter(filter: WorkHierarchyFilter): boolean {
  return filter.project !== undefined
    || filter.workerProfileId !== undefined
    || filter.columns !== undefined;
}

function filterColumns(
  columns: Record<WorkHierarchyColumnCode, WorkHierarchyTaskCard[]>,
  filter: WorkHierarchyFilter,
): Record<WorkHierarchyColumnCode, WorkHierarchyTaskCard[]> {
  if (!hasActiveFilter(filter)) return columns;
  const kept: WorkHierarchyTaskCard[] = [];
  for (const card of flatCards(columns)) {
    if (cardMatchesFilter(card, filter)) kept.push(card);
  }
  return placeCards(kept);
}

const MAX_NARRATIVE_PARAM_KEYS = 8;
const MAX_NARRATIVE_PARAM_STR = 200;
const MAX_NARRATIVE_PARAM_INT = 1_000_000;

/** Build a bounded narrative message; params are user-safe primitives only. */
function narrativeMessage(
  code: WorkHierarchyNarrativeCode,
  params?: Record<string, WorkHierarchyNarrativeParamValue>,
): WorkHierarchyNarrativeMessage {
  if (params === undefined) return { code };
  const safe: Record<string, WorkHierarchyNarrativeParamValue> = {};
  let count = 0;
  for (const [key, value] of Object.entries(params)) {
    if (count >= MAX_NARRATIVE_PARAM_KEYS) break;
    if (typeof value === "string") {
      const trimmed = value.slice(0, MAX_NARRATIVE_PARAM_STR);
      if (trimmed.length === 0) continue;
      safe[key] = trimmed;
      count += 1;
    } else if (
      typeof value === "number"
      && Number.isSafeInteger(value)
      && value >= 0
      && value <= MAX_NARRATIVE_PARAM_INT
    ) {
      safe[key] = value;
      count += 1;
    }
  }
  return Object.keys(safe).length > 0 ? { code, params: safe } : { code };
}

interface LaneSummaryFallback {
  whatCompleted?: string;
  blocker?: string;
  nextAction?: string;
  whatCompletedMessage?: WorkHierarchyNarrativeMessage;
  blockerMessage?: WorkHierarchyNarrativeMessage;
  nextActionMessage?: WorkHierarchyNarrativeMessage;
}

function deriveLaneSummary(
  cards: readonly WorkHierarchyTaskCard[],
  fallback?: LaneSummaryFallback,
): WorkHierarchyLaneSummary {
  const completed = cards.filter((c) => c.column === "completed");
  const total = cards.length;
  const completedCount = completed.length;
  const percent = total === 0 ? 0 : Math.round((completedCount / total) * 100);

  let whatCompleted: string;
  let whatCompletedMessage: WorkHierarchyNarrativeMessage;
  if (fallback?.whatCompleted !== undefined && fallback.whatCompleted.length > 0) {
    whatCompleted = fallback.whatCompleted.slice(0, 500);
    whatCompletedMessage = fallback.whatCompletedMessage
      ?? narrativeMessage("lane-what-none-completed");
  } else if (completedCount === 0) {
    whatCompleted = "No Tasks completed yet.";
    whatCompletedMessage = narrativeMessage("lane-what-none-completed");
  } else {
    const names = completed
      .map((c) => c.name)
      .filter((n) => n.length > 0)
      .slice(0, MAX_COMPLETED_NAMES);
    const extraCount = completedCount > names.length
      ? completedCount - names.length
      : 0;
    const extra = extraCount > 0 ? ` (+${extraCount} more)` : "";
    if (names.length === 0) {
      whatCompleted = `${completedCount} Task(s) completed.`;
      whatCompletedMessage = narrativeMessage("lane-what-completed-count", {
        count: completedCount,
      });
    } else {
      whatCompleted = `Completed: ${names.join(", ")}${extra}.`;
      whatCompletedMessage = narrativeMessage(
        "lane-what-completed-names",
        extraCount > 0
          ? { names: names.join(", "), extraCount }
          : { names: names.join(", ") },
      );
    }
  }

  let blocker: string;
  let blockerMessage: WorkHierarchyNarrativeMessage;
  if (fallback?.blocker !== undefined && fallback.blocker.length > 0) {
    blocker = fallback.blocker.slice(0, 500);
    blockerMessage = fallback.blockerMessage
      ?? narrativeMessage("lane-blocker-none");
  } else {
    const failed = cards.find((c) => c.column === "stopped-failed");
    const waiting = cards.find(
      (c) => c.column === "not-started" && c.blockers.length > 0,
    );
    if (failed !== undefined) {
      const label = failed.blockers[0]?.label ?? failed.name;
      blocker = `Blocked: ${label}.`;
      blockerMessage = narrativeMessage("lane-blocker-blocked", { label });
    } else if (waiting !== undefined) {
      const label = waiting.blockers[0]?.label ?? waiting.name;
      blocker = `Waiting: ${label}.`;
      blockerMessage = narrativeMessage("lane-blocker-waiting", { label });
    } else {
      blocker = "No current blocker.";
      blockerMessage = narrativeMessage("lane-blocker-none");
    }
  }

  let nextAction: string;
  let nextActionMessage: WorkHierarchyNarrativeMessage;
  if (fallback?.nextAction !== undefined && fallback.nextAction.length > 0) {
    nextAction = fallback.nextAction.slice(0, 500);
    nextActionMessage = fallback.nextActionMessage
      ?? narrativeMessage("lane-next-no-step");
  } else {
    const priority: WorkHierarchyColumnCode[] = [
      "running",
      "waiting-verification",
      "waiting-user-decision",
      "ready",
      "not-started",
      "stopped-failed",
    ];
    let chosen: WorkHierarchyTaskCard | undefined;
    for (const code of priority) {
      chosen = cards.find((c) => c.column === code);
      if (chosen !== undefined) break;
    }
    if (chosen !== undefined) {
      nextAction = chosen.nextAction;
      nextActionMessage = chosen.nextActionMessage
        ?? narrativeMessage("lane-next-no-step");
    } else {
      nextAction = "No next executable step.";
      nextActionMessage = narrativeMessage("lane-next-no-step");
    }
  }

  return {
    whatCompleted,
    blocker,
    nextAction,
    whatCompletedMessage,
    blockerMessage,
    nextActionMessage,
    progress: { total, completed: completedCount, percent },
  };
}

function nextActionForCard(
  column: WorkHierarchyColumnCode,
  blockers: WorkHierarchyBlocker[],
): { text: string; message: WorkHierarchyNarrativeMessage } {
  switch (column) {
    case "not-started": {
      const dep = blockers.find(
        (b) => b.code === "dependency-waiting" || b.code === "dependency-failed",
      );
      if (dep !== undefined) {
        return {
          text: `Waiting on prerequisite: ${dep.label}.`,
          message: narrativeMessage("card-next-waiting-prerequisite", {
            label: dep.label,
          }),
        };
      }
      return {
        text: "Not started yet.",
        message: narrativeMessage("card-next-not-started"),
      };
    }
    case "ready":
      return {
        text: "Ready to run when a Worker slot is available.",
        message: narrativeMessage("card-next-ready"),
      };
    case "running":
      return {
        text: "Worker is executing this Task.",
        message: narrativeMessage("card-next-running"),
      };
    case "waiting-verification":
      return {
        text: "Waiting for machine verification.",
        message: narrativeMessage("card-next-waiting-verification"),
      };
    case "waiting-user-decision":
      return {
        text: "Waiting for a Main decision.",
        message: narrativeMessage("card-next-waiting-main-decision"),
      };
    case "completed":
      return {
        text: "No further action required.",
        message: narrativeMessage("card-next-no-further-action"),
      };
    case "stopped-failed":
      return {
        text: "Needs Main attention or recovery.",
        message: narrativeMessage("card-next-needs-recovery"),
      };
  }
}

function whatCompletedForCard(
  column: WorkHierarchyColumnCode,
  name: string,
): { text: string; message: WorkHierarchyNarrativeMessage } {
  if (column === "completed") {
    return {
      text: `${name} delivered.`,
      message: narrativeMessage("card-what-delivered", { name }),
    };
  }
  return {
    text: "Nothing completed yet.",
    message: narrativeMessage("card-what-nothing"),
  };
}

function goalGateSatisfiedNext(
  goalGate: WorkHierarchyGoalGateEvidence,
): { text: string; message: WorkHierarchyNarrativeMessage } {
  const params: Record<string, WorkHierarchyNarrativeParamValue> = {
    gate: goalGate.gate,
  };
  if (goalGate.deliveryBasis !== undefined) {
    params.deliveryBasis = goalGate.deliveryBasis;
  }
  return {
    text: goalGate.nextAction,
    message: narrativeMessage("card-next-goal-gate-satisfied", params),
  };
}

function goalWhatMessage(
  reasonCode: GoalReasonCode,
): WorkHierarchyNarrativeMessage {
  switch (reasonCode) {
    case "goal-completed":
      return narrativeMessage("goal-what-completed");
    case "main-stop":
      return narrativeMessage("goal-what-main-stop");
    case "correction-cap":
      return narrativeMessage("goal-what-correction-cap");
    case "review-cap":
      return narrativeMessage("goal-what-review-cap");
    case "no-new-evidence-cap":
      return narrativeMessage("goal-what-no-new-evidence-cap");
    case "duration-exceeded":
      return narrativeMessage("goal-what-duration-exceeded");
    case "no-progress":
      return narrativeMessage("goal-what-no-progress");
    case "milestone-failed":
      return narrativeMessage("goal-what-milestone-failed");
    default:
      return narrativeMessage("goal-what-current");
  }
}

function goalWaitMessage(
  reasonCode: GoalReasonCode,
): WorkHierarchyNarrativeMessage {
  switch (reasonCode) {
    case "main-stop":
      return narrativeMessage("goal-wait-main-stop");
    case "correction-cap":
      return narrativeMessage("goal-wait-correction-cap");
    case "review-cap":
      return narrativeMessage("goal-wait-review-cap");
    case "no-new-evidence-cap":
      return narrativeMessage("goal-wait-no-new-evidence-cap");
    case "duration-exceeded":
      return narrativeMessage("goal-wait-duration-exceeded");
    case "no-progress":
      return narrativeMessage("goal-wait-no-progress");
    case "milestone-failed":
      return narrativeMessage("goal-wait-milestone-failed");
    case "waiting-machine":
      return narrativeMessage("goal-wait-machine");
    case "waiting-main-accept":
      return narrativeMessage("goal-wait-main-accept");
    case "waiting-integration":
      return narrativeMessage("goal-wait-integration");
    case "waiting-task":
      return narrativeMessage("goal-wait-task");
    case "goal-completed":
      return narrativeMessage("goal-wait-all-gates-satisfied");
    case "none":
    default:
      return narrativeMessage("goal-wait-progressing");
  }
}

function goalNextMessage(
  nextActionCode: GoalView["nextActionCode"],
): WorkHierarchyNarrativeMessage {
  switch (nextActionCode) {
    case "wait-for-worker":
      return narrativeMessage("goal-next-wait-for-worker");
    case "main-accept":
      return narrativeMessage("goal-next-main-accept");
    case "main-review":
      return narrativeMessage("goal-next-main-review");
    case "integrate":
      return narrativeMessage("goal-next-integrate");
    case "correct-or-decide":
      return narrativeMessage("goal-next-correct-or-decide");
    case "advance":
      return narrativeMessage("goal-next-advance");
    case "stop-or-decide":
      return narrativeMessage("goal-next-stop-or-decide");
    case "resume-task":
      return narrativeMessage("goal-next-resume-task");
    case "none":
    default:
      return narrativeMessage("goal-next-none");
  }
}

/**
 * Derive Goal-lane narrative codes from GoalView authority (status,
 * reasonCode, nextActionCode, milestone evidence). Mirrors projectGoal
 * branches that create the legacy English sentences; never parses prose.
 */
function deriveGoalLaneMessages(goalView: GoalView): {
  whatCompletedMessage: WorkHierarchyNarrativeMessage;
  blockerMessage: WorkHierarchyNarrativeMessage;
  nextActionMessage: WorkHierarchyNarrativeMessage;
} {
  const nextActionMessage = goalNextMessage(goalView.nextActionCode);
  const capCodes = new Set<GoalReasonCode>([
    "correction-cap",
    "review-cap",
    "no-new-evidence-cap",
  ]);

  if (goalView.status === "stopped") {
    return {
      whatCompletedMessage: goalWhatMessage(goalView.reasonCode),
      blockerMessage: narrativeMessage("goal-wait-admission-blocked"),
      nextActionMessage,
    };
  }
  if (goalView.status === "completed") {
    return {
      whatCompletedMessage: narrativeMessage("goal-what-completed"),
      blockerMessage: narrativeMessage("goal-wait-all-gates-satisfied"),
      nextActionMessage: narrativeMessage("goal-next-none"),
    };
  }

  const failed = goalView.milestones.find((m) => m.reasonCode === "milestone-failed");
  if (goalView.status === "failed" || failed !== undefined) {
    return {
      whatCompletedMessage: narrativeMessage("goal-what-milestone-failed"),
      blockerMessage: narrativeMessage("goal-wait-milestone-failed"),
      nextActionMessage,
    };
  }

  if (goalView.status === "waiting" && capCodes.has(goalView.reasonCode)) {
    return {
      whatCompletedMessage: goalWhatMessage(goalView.reasonCode),
      blockerMessage: goalWaitMessage(goalView.reasonCode),
      nextActionMessage,
    };
  }

  const unsatisfied = goalView.milestones.find((m) => !m.satisfied);
  if (unsatisfied !== undefined) {
    const previous = goalView.milestones.filter((m) => m.satisfied).at(-1);
    return {
      whatCompletedMessage: previous === undefined
        ? narrativeMessage("goal-what-started")
        : narrativeMessage("goal-what-milestone-satisfied", {
          itemId: previous.itemId,
          gate: previous.gate,
        }),
      blockerMessage: goalWaitMessage(unsatisfied.reasonCode),
      nextActionMessage,
    };
  }

  return {
    whatCompletedMessage: narrativeMessage("goal-what-completed"),
    blockerMessage: narrativeMessage("goal-wait-all-gates-satisfied"),
    nextActionMessage: narrativeMessage("goal-next-none"),
  };
}

/** True only when the summary carries durable delivered/activated/
 *  repaired-delivered outcome evidence. Used to fail closed on backward moves. */
function hasDeliveredSummary(summary: SafeTaskSummary): boolean {
  return summary.remediationDisposition?.status === "verified-repaired-delivered"
    || summary.decisionStage === "delivered"
    || summary.decisionStage === "activated"
    || (summary.boardScope === "history"
        && (summary.boardReason === "delivered"
          || summary.boardReason === "activated"
          || summary.boardReason === "repaired-delivered"));
}

// ---------------------------------------------------------------------------
// Plan projection internals
// ---------------------------------------------------------------------------

interface PlanProjectionContext {
  plan: PlanRecord;
  items: PlanItemRecord[];
  dependencies: DependencyRecord[];
  goalId?: string;
  goalName?: string;
  goalView?: GoalView;
  milestones?: GoalMilestoneRecord[];
  /** True when this Plan is a supervised Goal phase after the current phase.
   *  Its cards stay not-started regardless of within-Plan readiness. */
  phaseBlocked?: boolean;
  summaries: Map<string, SafeTaskSummary>;
  /** Task ids claimed by this plan (original + effective) so one-off excludes them. */
  claimedTaskIds: Set<string>;
}

function resolvePlanDependencySatisfaction(
  store: StateStore,
  ctx: PlanProjectionContext,
  itemId: string,
): {
  satisfied: boolean;
  depIds: string[];
  statuses: Map<string, TaskStatus | undefined>;
  gateSatisfaction?: Map<string, boolean>;
  prerequisiteCompletion?: Map<string, boolean>;
} {
  const depIds = ctx.dependencies
    .filter((d) => d.itemId === itemId)
    .map((d) => d.dependsOnItemId)
    .sort();
  const itemStatuses = store.getPlanItemStatuses(ctx.plan.id);
  const statusByItem = new Map(itemStatuses.map((s) => [s.itemId, s]));
  const statuses = new Map<string, TaskStatus | undefined>(
    itemStatuses.map((s) => [s.itemId, s.taskStatus]),
  );
  const effectiveStatuses = new Map<string, TaskStatus | undefined>(statuses);

  let gateSatisfaction: Map<string, boolean> | undefined;
  let prerequisiteCompletion: Map<string, boolean> | undefined;
  // Goal-owned Plans keep milestone-gate authority (machine fallback when a
  // milestone row is absent). Independent Plans use the shared delivery rule.
  if (ctx.goalId !== undefined) {
    gateSatisfaction = new Map();
    for (const dependencyId of depIds) {
      const milestone = ctx.milestones?.find((m) => m.itemId === dependencyId);
      const dep = statusByItem.get(dependencyId);
      if (milestone === undefined) {
        gateSatisfaction.set(dependencyId, dep?.taskStatus === "succeeded");
        continue;
      }
      const lineage = resolveEffectiveMilestoneLineage(store, milestone);
      if (lineage.effectiveTask?.status !== undefined) {
        effectiveStatuses.set(dependencyId, lineage.effectiveTask.status);
      }
      const evidence = evaluateMilestoneGate(
        store,
        milestone.gate,
        lineage.effectiveTaskId ?? dep?.taskId ?? milestone.taskId,
        lineage.effectiveTask?.status ?? dep?.taskStatus,
      );
      gateSatisfaction.set(dependencyId, evidence.satisfied);
    }
  } else {
    // Same Core completion fact as the Plan scheduler for independent Plans.
    prerequisiteCompletion = new Map();
    for (const dependencyId of depIds) {
      const dep = statusByItem.get(dependencyId);
      prerequisiteCompletion.set(
        dependencyId,
        isPrerequisiteResultComplete(store, dep?.taskId, dep?.taskStatus),
      );
    }
  }

  const decision = resolveReadiness(
    itemId,
    depIds,
    effectiveStatuses,
    gateSatisfaction,
    prerequisiteCompletion,
  );
  return {
    satisfied: decision.kind === "ready",
    depIds,
    statuses: effectiveStatuses,
    ...(gateSatisfaction === undefined ? {} : { gateSatisfaction }),
    ...(prerequisiteCompletion === undefined ? {} : { prerequisiteCompletion }),
  };
}

function buildNamedEdges(
  store: StateStore,
  planId: string,
  depIds: string[],
  dependentIds: string[],
  statuses: Map<string, TaskStatus | undefined>,
  gateSatisfaction?: Map<string, boolean>,
  prerequisiteCompletion?: Map<string, boolean>,
): { namedDependencies: WorkHierarchyNamedEdge[]; namedRequiredBy: WorkHierarchyNamedEdge[] } {
  const itemStatuses = store.getPlanItemStatuses(planId);
  const byItem = new Map(itemStatuses.map((s) => [s.itemId, s]));

  const namedDependencies: WorkHierarchyNamedEdge[] = depIds.slice(0, MAX_EDGES).map((depId) => {
    const dep = byItem.get(depId);
    const task = dep?.taskId === undefined ? undefined : (() => {
      try { return store.getTask(dep.taskId!); } catch { return undefined; }
    })();
    const safeName = sanitiseName(task?.name);
    const status = statuses.get(depId) ?? dep?.taskStatus;
    // Gate-satisfied deps count as satisfied even when machine status lags.
    // Independent Plans: material Candidate without reviewed delivery stays waiting.
    const state = gateSatisfaction?.get(depId) === true
      ? "satisfied" as const
      : (gateSatisfaction === undefined
          && prerequisiteCompletion?.get(depId) === false)
        ? "waiting" as const
        : dependencyEdgeState(status);
    return {
      itemId: depId,
      ...(dep?.taskId === undefined ? {} : { taskId: dep.taskId }),
      ...(safeName === undefined ? {} : { taskName: safeName }),
      ...(status === undefined ? {} : { taskStatus: status }),
      state,
    };
  });

  const namedRequiredBy: WorkHierarchyNamedEdge[] = dependentIds.slice(0, MAX_EDGES).map((depId) => {
    const dep = byItem.get(depId);
    const task = dep?.taskId === undefined ? undefined : (() => {
      try { return store.getTask(dep.taskId!); } catch { return undefined; }
    })();
    const safeName = sanitiseName(task?.name);
    return {
      itemId: depId,
      ...(dep?.taskId === undefined ? {} : { taskId: dep.taskId }),
      ...(safeName === undefined ? {} : { taskName: safeName }),
      ...(dep?.taskStatus === undefined ? {} : { taskStatus: dep.taskStatus }),
    };
  });

  return { namedDependencies, namedRequiredBy };
}

function buildCardBlockers(
  namedDependencies: WorkHierarchyNamedEdge[],
  status: TaskStatus | undefined,
  name: string,
): WorkHierarchyBlocker[] {
  const blockers: WorkHierarchyBlocker[] = [];
  for (const dep of namedDependencies) {
    if (dep.state === "waiting") {
      blockers.push({
        code: "dependency-waiting",
        label: dep.taskName ?? dep.itemId,
      });
    } else if (dep.state === "failed") {
      blockers.push({
        code: "dependency-failed",
        label: dep.taskName ?? dep.itemId,
      });
    }
    if (blockers.length >= MAX_BLOCKERS) break;
  }
  if (blockers.length < MAX_BLOCKERS) {
    if (status === "failed" || status === "interrupted") {
      blockers.push({ code: "task-failed", label: name });
    } else if (status === "blocked") {
      blockers.push({ code: "task-blocked", label: name });
    }
  }
  return blockers.slice(0, MAX_BLOCKERS);
}

function projectPlanLane(
  store: StateStore,
  ctx: PlanProjectionContext,
): WorkHierarchyPlanLane {
  const dependentMap = new Map<string, string[]>();
  for (const dep of ctx.dependencies) {
    dependentMap.set(
      dep.dependsOnItemId,
      [...(dependentMap.get(dep.dependsOnItemId) ?? []), dep.itemId],
    );
  }

  const cards: WorkHierarchyTaskCard[] = [];
  for (const item of ctx.items) {
    // Resolve effective Task identity for Goal-supervised handoffs.
    let originalTaskId = item.taskId;
    let effectiveTaskId = item.taskId;
    let effectiveTask: TaskRecord | undefined;
    let milestone: GoalMilestoneRecord | undefined;
    if (item.taskId !== undefined) {
      ctx.claimedTaskIds.add(item.taskId);
      try {
        effectiveTask = store.getTask(item.taskId);
      } catch {
        effectiveTask = undefined;
      }
    }
    if (ctx.milestones !== undefined && item.taskId !== undefined) {
      milestone = ctx.milestones.find((m) => m.itemId === item.id);
      if (milestone !== undefined) {
        const lineage = resolveEffectiveMilestoneLineage(store, milestone);
        if (lineage.originalTaskId !== undefined) {
          originalTaskId = lineage.originalTaskId;
          ctx.claimedTaskIds.add(lineage.originalTaskId);
        }
        if (lineage.effectiveTaskId !== undefined) {
          effectiveTaskId = lineage.effectiveTaskId;
          ctx.claimedTaskIds.add(lineage.effectiveTaskId);
        }
        if (lineage.effectiveTask !== undefined) {
          effectiveTask = lineage.effectiveTask;
        }
      }
    }

    if (effectiveTaskId === undefined || effectiveTask === undefined) {
      // Plan item without a Task yet: project a not-started placeholder card
      // only when we have an item identity. Skip inventing Task ids.
      continue;
    }

    const summary = ctx.summaries.get(effectiveTaskId)
      ?? buildFallbackSummary(effectiveTask);
    const depInfo = resolvePlanDependencySatisfaction(store, ctx, item.id);
    const dependentIds = (dependentMap.get(item.id) ?? []).slice().sort();
    const { namedDependencies, namedRequiredBy } = buildNamedEdges(
      store,
      ctx.plan.id,
      depInfo.depIds,
      dependentIds,
      depInfo.statuses,
      depInfo.gateSatisfaction,
      depInfo.prerequisiteCompletion,
    );

    // FL-109E2: Plan-relative milestone gate truth. The configured Goal gate is
    // the authority for this card's column in the Goal lane. The underlying
    // Task-wide status / decision stage / board placement stay inspectable on
    // the card; they never downgrade a satisfied gate back to a required Main
    // decision or integration step that the Goal already outscoped.
    let goalGate: WorkHierarchyGoalGateEvidence | undefined;
    if (ctx.goalId !== undefined && milestone !== undefined) {
      const gateEvidence = evaluateMilestoneGate(
        store,
        milestone.gate,
        effectiveTaskId,
        effectiveTask?.status,
      );
      goalGate = {
        gate: milestone.gate,
        satisfied: gateEvidence.satisfied,
        reasonCode: gateEvidence.reasonCode,
        reason: gateEvidence.reason,
        nextAction: gateEvidence.nextAction,
        ...(gateEvidence.deliveryBasis === undefined
          ? {}
          : { deliveryBasis: gateEvidence.deliveryBasis }),
      };
    }

    // Phase order is an additional Core prerequisite: a card in a supervised
    // phase after the current one stays not-started regardless of its
    // within-Plan dependency readiness or gate evidence. The browser never
    // computes this — it reads the Core-projected currentPlanId.
    const phaseBlocked = ctx.phaseBlocked === true;
    const dependenciesSatisfied = phaseBlocked ? false : depInfo.satisfied;

    let placement = mapTaskToHierarchyColumn({
      status: summary.status,
      ...(summary.decisionStage === undefined ? {} : { decisionStage: summary.decisionStage }),
      ...(summary.boardScope === undefined ? {} : { boardScope: summary.boardScope }),
      ...(summary.boardReason === undefined ? {} : { boardReason: summary.boardReason }),
      dependenciesSatisfied,
    });
    // A satisfied configured gate completes the card in this Goal's lane even
    // when the Task-wide decision stage still shows a broader review or
    // Integration step. A Task already Task-wide completed keeps its durable
    // delivered-outcome signal; the gate truth is still carried in goalGate.
    // Later-phase cards never claim completion while their phase is blocked.
    if (goalGate?.satisfied === true && placement.column !== "completed" && !phaseBlocked) {
      placement = { column: "completed", placementReason: "goal-gate-satisfied" };
    }
    const goalGateCompleted = goalGate?.satisfied === true && !phaseBlocked;

    // FL-109C1: Core-owned truthful action policy fed only by authoritative
    // Store evidence. Read-only; the Hub forwards it unchanged. A Goal-gate
    // satisfied card must never claim a required Main decision or card move.
    const actionPolicy = projectTaskActionPolicy(store, {
      taskId: effectiveTaskId,
      status: summary.status,
      ...(summary.decisionStage === undefined ? {} : { decisionStage: summary.decisionStage }),
      ...(summary.boardScope === undefined ? {} : { boardScope: summary.boardScope }),
      ...(summary.boardReason === undefined ? {} : { boardReason: summary.boardReason }),
      dependenciesSatisfied,
      delivered: hasDeliveredSummary(summary),
      resolutionState: summary.attentionResolution ?? { status: "none" },
      currentColumn: placement.column,
      ...(goalGate?.satisfied === true && !phaseBlocked
        ? { planGateSatisfied: true }
        : {}),
    });

    const safeName = sanitiseName(summary.name) ?? sanitiseName(effectiveTask.name) ?? "Task";
    // A gate-satisfied card is complete in the Goal lane; dependency or terminal
    // status blockers describe scheduling, not this milestone's own completion.
    const blockers = goalGateCompleted
      ? []
      : buildCardBlockers(namedDependencies, summary.status, safeName);
    if (phaseBlocked && !goalGateCompleted) {
      blockers.unshift({ code: "dependency-waiting", label: "Earlier Goal phase" });
    }
    const planName = sanitiseName(ctx.plan.name);
    const goalName = sanitiseName(ctx.goalName);

    const breadcrumb: WorkHierarchyBreadcrumb = {
      taskId: effectiveTaskId,
      taskName: safeName,
      ...(ctx.goalId === undefined ? {} : { goalId: ctx.goalId }),
      ...(goalName === undefined ? {} : { goalName }),
      planId: ctx.plan.id,
      ...(planName === undefined ? {} : { planName }),
      ...(originalTaskId !== undefined && originalTaskId !== effectiveTaskId
        ? { originalTaskId, effectiveTaskId }
        : {}),
    };

    const workerProfileId = effectiveTask.spec.workerProfileId;
    // FL-108C1: legacy strings and coded messages are produced on the same
    // typed branch so Hub never recovers meaning from English prose.
    let whatCompleted: string;
    let whatCompletedMessage: WorkHierarchyNarrativeMessage;
    let nextAction: string;
    let nextActionMessage: WorkHierarchyNarrativeMessage;
    if (goalGateCompleted && goalGate !== undefined) {
      const gateNext = goalGateSatisfiedNext(goalGate);
      whatCompleted = `${safeName} complete for this Goal (${goalGate.gate} gate).`;
      whatCompletedMessage = narrativeMessage("card-what-goal-gate-complete", {
        name: safeName,
        gate: goalGate.gate,
      });
      nextAction = gateNext.text;
      nextActionMessage = gateNext.message;
    } else {
      const what = whatCompletedForCard(placement.column, safeName);
      const next = nextActionForCard(placement.column, blockers);
      whatCompleted = what.text;
      whatCompletedMessage = what.message;
      nextAction = next.text;
      nextActionMessage = next.message;
    }
    cards.push({
      taskId: effectiveTaskId,
      name: safeName,
      column: placement.column,
      placementReason: placement.placementReason,
      status: summary.status,
      ...(summary.decisionStage === undefined ? {} : { decisionStage: summary.decisionStage }),
      ...(summary.boardScope === undefined ? {} : { boardScope: summary.boardScope }),
      ...(summary.boardReason === undefined ? {} : { boardReason: summary.boardReason }),
      provider: summary.provider,
      model: summary.model,
      runtime: summary.runtime,
      ...(workerProfileId === undefined ? {} : { workerProfileId }),
      project: effectiveTask.spec.project,
      itemId: item.id,
      itemIndex: item.itemIndex,
      breadcrumb,
      namedDependencies,
      namedRequiredBy,
      blockers,
      whatCompleted,
      whatCompletedMessage,
      nextAction,
      nextActionMessage,
      ...(goalGate === undefined ? {} : { goalGate }),
      actionPolicy,
      updatedAt: summary.updatedAt,
    });
  }

  const columns = placeCards(cards);
  const allCards = flatCards(columns);
  return {
    kind: "plan",
    planId: ctx.plan.id,
    name: sanitiseName(ctx.plan.name) ?? ctx.plan.id,
    objective: sanitiseName(ctx.plan.objective) ?? "",
    updatedAt: ctx.plan.updatedAt,
    summary: deriveLaneSummary(allCards),
    columns,
  };
}

function buildFallbackSummary(task: TaskRecord): SafeTaskSummary {
  // Minimal privacy-safe fallback when the caller did not project a surface.
  // Placement fails open via mapTaskToHierarchyColumn without inventing delivery.
  return {
    taskId: task.id,
    name: task.name,
    status: task.status,
    provider: task.spec.provider.name,
    model: task.spec.provider.model,
    runtime: task.spec.runtime.name,
    sourcePath: task.sourcePath,
    workspacePath: task.paths.workspace,
    sessionId: task.sessionId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    boardScope: "now",
    boardReason: "active-work",
  };
}

function projectOneOffCard(
  store: StateStore,
  task: TaskRecord,
  summary: SafeTaskSummary,
): WorkHierarchyTaskCard {
  const placement = mapTaskToHierarchyColumn({
    status: summary.status,
    ...(summary.decisionStage === undefined ? {} : { decisionStage: summary.decisionStage }),
    ...(summary.boardScope === undefined ? {} : { boardScope: summary.boardScope }),
    ...(summary.boardReason === undefined ? {} : { boardReason: summary.boardReason }),
    dependenciesSatisfied: true,
  });
  const actionPolicy = projectTaskActionPolicy(store, {
    taskId: task.id,
    status: summary.status,
    ...(summary.decisionStage === undefined ? {} : { decisionStage: summary.decisionStage }),
    ...(summary.boardScope === undefined ? {} : { boardScope: summary.boardScope }),
    ...(summary.boardReason === undefined ? {} : { boardReason: summary.boardReason }),
    dependenciesSatisfied: true,
    delivered: hasDeliveredSummary(summary),
    resolutionState: summary.attentionResolution ?? { status: "none" },
    currentColumn: placement.column,
  });
  const safeName = sanitiseName(summary.name) ?? sanitiseName(task.name) ?? "Task";
  const blockers = buildCardBlockers([], summary.status, safeName);
  const workerProfileId = task.spec.workerProfileId;
  const what = whatCompletedForCard(placement.column, safeName);
  const next = nextActionForCard(placement.column, blockers);
  return {
    taskId: task.id,
    name: safeName,
    column: placement.column,
    placementReason: placement.placementReason,
    status: summary.status,
    ...(summary.decisionStage === undefined ? {} : { decisionStage: summary.decisionStage }),
    ...(summary.boardScope === undefined ? {} : { boardScope: summary.boardScope }),
    ...(summary.boardReason === undefined ? {} : { boardReason: summary.boardReason }),
    provider: summary.provider,
    model: summary.model,
    runtime: summary.runtime,
    ...(workerProfileId === undefined ? {} : { workerProfileId }),
    project: task.spec.project,
    breadcrumb: {
      taskId: task.id,
      taskName: safeName,
    },
    namedDependencies: [],
    namedRequiredBy: [],
    blockers,
    whatCompleted: what.text,
    whatCompletedMessage: what.message,
    nextAction: next.text,
    nextActionMessage: next.message,
    actionPolicy,
    updatedAt: summary.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Public projection
// ---------------------------------------------------------------------------

/**
 * Project the canonical WorkHierarchyView from durable Store evidence.
 *
 * @param store - StateStore (read-only use)
 * @param projectTaskSurface - Caller-supplied SafeTaskSummary projector so the
 *   hierarchy reuses the same Decision Stage / board placement authority as
 *   list/status surfaces instead of recomputing lifecycle truth.
 * @param filterInput - Optional raw filter object (parsed strictly)
 */
export function projectWorkHierarchy(
  store: StateStore,
  projectTaskSurface: (task: TaskRecord) => SafeTaskSummary,
  filterInput?: Record<string, unknown>,
): WorkHierarchyView {
  const filter = parseWorkHierarchyFilter(filterInput);
  const allTasks = store.listTasks();
  const summaries = new Map<string, SafeTaskSummary>();
  for (const task of allTasks) {
    summaries.set(task.id, projectTaskSurface(task));
  }

  const claimedTaskIds = new Set<string>();
  // Pre-claim Goal-Task handoff successors so they never become one-off cards.
  // Legacy durable handoffs written before `origin` existed read as unknown:
  // fail closed and claim nothing instead of hiding unrelated Tasks.
  for (const handoff of store.listCandidateHandoffs()) {
    if (handoff.origin?.kind === "goal-task") {
      claimedTaskIds.add(handoff.sourceTaskId);
      claimedTaskIds.add(handoff.successorTaskId);
    }
  }

  const plans = store.listPlans();
  const goalsRaw = store.listGoals(100);
  const planById = new Map(plans.map((p) => [p.id, p]));
  // Every associated Plan (primary + later) is Goal-owned and never independent.
  const goalPlanIds = new Set<string>();
  for (const goal of goalsRaw) {
    goalPlanIds.add(goal.planId);
    try {
      for (const association of store.listGoalPlanAssociations(goal.id)) {
        goalPlanIds.add(association.planId);
      }
    } catch {
      // Unknown or corrupt Goal rows are skipped below when projecting.
    }
  }

  // --- Goal lanes (all associated Plans in ordinal order) ---
  const goalLanes: WorkHierarchyGoalLane[] = [];
  const goalsOrdered = goalsRaw
    .slice()
    .sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
    );

  for (const goal of goalsOrdered) {
    let goalView: GoalView;
    try {
      goalView = projectGoal(store, goal.id);
    } catch {
      continue;
    }
    // Associations are the multi-Plan authority; fall back to legacy primary only.
    let associations = store.listGoalPlanAssociations(goal.id);
    if (associations.length === 0) {
      associations = [{
        goalId: goal.id,
        planId: goal.planId,
        ordinal: 0,
        createdAt: goal.createdAt,
      }];
    }
    // Every supervised phase carries its own plan-qualified milestones; later
    // supervised phases stay not-started until the current phase completes.
    const milestones = store.getGoalMilestones(goal.id);
    const milestonesByPlan = new Map<string, GoalMilestoneRecord[]>();
    for (const milestone of milestones) {
      const key = milestone.planId ?? goal.planId;
      const list = milestonesByPlan.get(key) ?? [];
      list.push(milestone);
      milestonesByPlan.set(key, list);
    }
    const currentIndex = goalView.currentPlanId === undefined
      ? -1
      : associations.findIndex((association) => association.planId === goalView.currentPlanId);
    const filteredPlans: WorkHierarchyPlanLane[] = [];

    for (const association of associations) {
      const plan = planById.get(association.planId);
      if (plan === undefined) continue;
      const items = store.getPlanItems(plan.id);
      const dependencies = store.getDependencies(plan.id);
      const planClaimed = new Set<string>();
      const planMilestones = milestonesByPlan.get(association.planId) ?? [];
      const supervised = planMilestones.length > 0;
      const ordinal = associations.findIndex((a) => a.planId === association.planId);
      const phaseBlocked = supervised && currentIndex >= 0 && ordinal > currentIndex;
      const planLane = projectPlanLane(store, {
        plan,
        items,
        dependencies,
        goalId: goal.id,
        goalName: goalView.name,
        goalView,
        ...(supervised ? { milestones: planMilestones } : {}),
        ...(phaseBlocked ? { phaseBlocked: true } : {}),
        summaries,
        claimedTaskIds: planClaimed,
      });
      for (const id of planClaimed) claimedTaskIds.add(id);

      const filteredPlanColumns = filterColumns(planLane.columns, filter);
      if (cardCount(filteredPlanColumns) === 0) {
        // Omit empty sibling Plans under filters; keep empty Plans unfiltered.
        if (hasActiveFilter(filter)) continue;
      }

      filteredPlans.push({
        ...planLane,
        columns: filteredPlanColumns,
        summary: deriveLaneSummary(flatCards(filteredPlanColumns)),
      });
    }

    if (filteredPlans.length === 0) {
      // Hide empty Goal ancestors under filters; keep empty Goals unfiltered only
      // when at least the primary Plan row still exists.
      if (hasActiveFilter(filter)) continue;
      if (planById.get(goal.planId) === undefined) continue;
    }

    const planCards = filteredPlans.flatMap((planLane) => flatCards(planLane.columns));
    const goalMessages = deriveGoalLaneMessages(goalView);
    goalLanes.push({
      kind: "goal",
      goalId: goalView.goalId,
      name: sanitiseName(goalView.name) ?? goalView.goalId,
      objective: sanitiseName(goalView.objective) ?? "",
      status: goalView.status,
      updatedAt: goalView.updatedAt,
      ...(goalView.currentPlanId === undefined
        ? {}
        : { currentPlanId: goalView.currentPlanId }),
      summary: deriveLaneSummary(planCards, {
        whatCompleted: goalView.whatJustHappened,
        blocker: goalView.whatIsWaiting,
        nextAction: goalView.nextAction,
        whatCompletedMessage: goalMessages.whatCompletedMessage,
        blockerMessage: goalMessages.blockerMessage,
        nextActionMessage: goalMessages.nextActionMessage,
      }),
      plans: filteredPlans,
    });
  }

  // --- Independent plans (no Goal parent; associated later Plans are excluded) ---
  const independentPlans: WorkHierarchyPlanLane[] = [];
  const independentOrdered = plans
    .filter((p) => !goalPlanIds.has(p.id))
    .slice()
    .sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
    );

  for (const plan of independentOrdered) {
    const items = store.getPlanItems(plan.id);
    const dependencies = store.getDependencies(plan.id);
    const planClaimed = new Set<string>();
    const planLane = projectPlanLane(store, {
      plan,
      items,
      dependencies,
      summaries,
      claimedTaskIds: planClaimed,
    });
    for (const id of planClaimed) claimedTaskIds.add(id);

    const filteredPlanColumns = filterColumns(planLane.columns, filter);
    if (cardCount(filteredPlanColumns) === 0) continue;

    independentPlans.push({
      ...planLane,
      columns: filteredPlanColumns,
      summary: deriveLaneSummary(flatCards(filteredPlanColumns)),
    });
  }

  // --- One-off tasks (no Plan membership, not a Goal handoff successor) ---
  // Also claim any task that is a plan item member we may have missed.
  for (const plan of plans) {
    for (const item of store.getPlanItems(plan.id)) {
      if (item.taskId !== undefined) claimedTaskIds.add(item.taskId);
    }
  }

  const oneOffCards: WorkHierarchyTaskCard[] = [];
  for (const task of allTasks) {
    if (claimedTaskIds.has(task.id)) continue;
    // Defensive: if Store still has plan membership, skip.
    if (store.getPlanItemByTaskId(task.id) !== undefined) continue;
    // Goal-task handoff successor already claimed; competition successors without
    // plan membership remain honest one-off work.
    const summary = summaries.get(task.id) ?? buildFallbackSummary(task);
    const card = projectOneOffCard(store, task, summary);
    if (!cardMatchesFilter(card, filter)) continue;
    oneOffCards.push(card);
  }

  let oneOffTasks: WorkHierarchyOneOffLane | undefined;
  if (oneOffCards.length > 0) {
    const columns = placeCards(oneOffCards);
    oneOffTasks = {
      kind: "one-off",
      summary: deriveLaneSummary(flatCards(columns)),
      columns,
    };
  }

  return {
    schemaVersion: 1,
    columns: columnDefinitions(),
    goals: goalLanes,
    independentPlans,
    ...(oneOffTasks === undefined ? {} : { oneOffTasks }),
    filter: { applied: filter },
  };
}

/**
 * Work hierarchy service bound to a Store and a Task surface projector.
 * Thin wrapper so Daemon/coordinator can inject the shared projection path.
 */
export class WorkHierarchyService {
  constructor(
    private readonly store: StateStore,
    private readonly projectTaskSurface: (task: TaskRecord) => SafeTaskSummary,
  ) {}

  getWorkHierarchy(filterInput?: Record<string, unknown>): WorkHierarchyView {
    return projectWorkHierarchy(this.store, this.projectTaskSurface, filterInput);
  }
}
