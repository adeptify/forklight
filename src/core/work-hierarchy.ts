/**
 * Canonical Goal -> Plan -> Task hierarchy read model (FL-109A).
 *
 * Joins existing safe Goal, Plan, dependency, and Task evidence into one
 * versioned WorkHierarchyView. Read-only and deterministic: does not write
 * status, schedule work, resolve Profiles, or expose private evidence.
 */
import { resolveReadiness } from "./dependency-resolver.js";
import {
  evaluateMilestoneGate,
  projectGoal,
  resolveEffectiveMilestoneLineage,
  type GoalView,
} from "./goal.js";
import {
  isLegalBoardPlacement,
  type BoardReason,
  type BoardScope,
  type SafeTaskSummary,
} from "./task-summary.js";
import type {
  DecisionStage,
  DependencyRecord,
  GoalMilestoneRecord,
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
  | "unrecognized-evidence";

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

export interface WorkHierarchyLaneSummary {
  whatCompleted: string;
  blocker: string;
  nextAction: string;
  progress: {
    total: number;
    completed: number;
    percent: number;
  };
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

export interface WorkHierarchyFilterMeta {
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

export interface HierarchyColumnInput {
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

function deriveLaneSummary(
  cards: readonly WorkHierarchyTaskCard[],
  fallback?: { whatCompleted?: string; blocker?: string; nextAction?: string },
): WorkHierarchyLaneSummary {
  const completed = cards.filter((c) => c.column === "completed");
  const total = cards.length;
  const completedCount = completed.length;
  const percent = total === 0 ? 0 : Math.round((completedCount / total) * 100);

  let whatCompleted: string;
  if (fallback?.whatCompleted !== undefined && fallback.whatCompleted.length > 0) {
    whatCompleted = fallback.whatCompleted.slice(0, 500);
  } else if (completedCount === 0) {
    whatCompleted = "No Tasks completed yet.";
  } else {
    const names = completed
      .map((c) => c.name)
      .filter((n) => n.length > 0)
      .slice(0, MAX_COMPLETED_NAMES);
    const extra = completedCount > names.length
      ? ` (+${completedCount - names.length} more)`
      : "";
    whatCompleted = names.length === 0
      ? `${completedCount} Task(s) completed.`
      : `Completed: ${names.join(", ")}${extra}.`;
  }

  let blocker: string;
  if (fallback?.blocker !== undefined && fallback.blocker.length > 0) {
    blocker = fallback.blocker.slice(0, 500);
  } else {
    const failed = cards.find((c) => c.column === "stopped-failed");
    const waiting = cards.find(
      (c) => c.column === "not-started" && c.blockers.length > 0,
    );
    if (failed !== undefined) {
      const label = failed.blockers[0]?.label ?? failed.name;
      blocker = `Blocked: ${label}.`;
    } else if (waiting !== undefined) {
      const label = waiting.blockers[0]?.label ?? waiting.name;
      blocker = `Waiting: ${label}.`;
    } else {
      blocker = "No current blocker.";
    }
  }

  let nextAction: string;
  if (fallback?.nextAction !== undefined && fallback.nextAction.length > 0) {
    nextAction = fallback.nextAction.slice(0, 500);
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
    nextAction = chosen?.nextAction ?? "No next executable step.";
  }

  return {
    whatCompleted,
    blocker,
    nextAction,
    progress: { total, completed: completedCount, percent },
  };
}

function nextActionForCard(
  column: WorkHierarchyColumnCode,
  blockers: WorkHierarchyBlocker[],
): string {
  switch (column) {
    case "not-started": {
      const dep = blockers.find(
        (b) => b.code === "dependency-waiting" || b.code === "dependency-failed",
      );
      return dep !== undefined
        ? `Waiting on prerequisite: ${dep.label}.`
        : "Not started yet.";
    }
    case "ready":
      return "Ready to run when a Worker slot is available.";
    case "running":
      return "Worker is executing this Task.";
    case "waiting-verification":
      return "Waiting for machine verification.";
    case "waiting-user-decision":
      return "Waiting for a Main decision.";
    case "completed":
      return "No further action required.";
    case "stopped-failed":
      return "Needs Main attention or recovery.";
  }
}

function whatCompletedForCard(
  column: WorkHierarchyColumnCode,
  name: string,
): string {
  if (column === "completed") return `${name} delivered.`;
  return "Nothing completed yet.";
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
  if (ctx.goalId !== undefined && ctx.milestones !== undefined) {
    gateSatisfaction = new Map();
    for (const dependencyId of depIds) {
      const milestone = ctx.milestones.find((m) => m.itemId === dependencyId);
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
  }

  const decision = resolveReadiness(
    itemId,
    depIds,
    effectiveStatuses,
    gateSatisfaction,
  );
  return {
    satisfied: decision.kind === "ready",
    depIds,
    statuses: effectiveStatuses,
    ...(gateSatisfaction === undefined ? {} : { gateSatisfaction }),
  };
}

function buildNamedEdges(
  store: StateStore,
  planId: string,
  depIds: string[],
  dependentIds: string[],
  statuses: Map<string, TaskStatus | undefined>,
  gateSatisfaction?: Map<string, boolean>,
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
    const state = gateSatisfaction?.get(depId) === true
      ? "satisfied" as const
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
    if (item.taskId !== undefined) {
      ctx.claimedTaskIds.add(item.taskId);
      try {
        effectiveTask = store.getTask(item.taskId);
      } catch {
        effectiveTask = undefined;
      }
    }
    if (ctx.milestones !== undefined && item.taskId !== undefined) {
      const milestone = ctx.milestones.find((m) => m.itemId === item.id);
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
    );

    const placement = mapTaskToHierarchyColumn({
      status: summary.status,
      ...(summary.decisionStage === undefined ? {} : { decisionStage: summary.decisionStage }),
      ...(summary.boardScope === undefined ? {} : { boardScope: summary.boardScope }),
      ...(summary.boardReason === undefined ? {} : { boardReason: summary.boardReason }),
      dependenciesSatisfied: depInfo.satisfied,
    });

    const safeName = sanitiseName(summary.name) ?? sanitiseName(effectiveTask.name) ?? "Task";
    const blockers = buildCardBlockers(namedDependencies, summary.status, safeName);
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
      whatCompleted: whatCompletedForCard(placement.column, safeName),
      nextAction: nextActionForCard(placement.column, blockers),
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
  const safeName = sanitiseName(summary.name) ?? sanitiseName(task.name) ?? "Task";
  const blockers = buildCardBlockers([], summary.status, safeName);
  const workerProfileId = task.spec.workerProfileId;
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
    whatCompleted: whatCompletedForCard(placement.column, safeName),
    nextAction: nextActionForCard(placement.column, blockers),
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
  for (const handoff of store.listCandidateHandoffs()) {
    if (handoff.origin.kind === "goal-task") {
      claimedTaskIds.add(handoff.sourceTaskId);
      claimedTaskIds.add(handoff.successorTaskId);
    }
  }

  const plans = store.listPlans();
  const goalsRaw = store.listGoals(100);
  const planById = new Map(plans.map((p) => [p.id, p]));
  const goalPlanIds = new Set(goalsRaw.map((g) => g.planId));

  // --- Goal lanes (plans[] even for one-Plan storage) ---
  const goalLanes: WorkHierarchyGoalLane[] = [];
  const goalsOrdered = goalsRaw
    .slice()
    .sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
    );

  for (const goal of goalsOrdered) {
    const plan = planById.get(goal.planId);
    if (plan === undefined) continue;
    let goalView: GoalView;
    try {
      goalView = projectGoal(store, goal.id);
    } catch {
      continue;
    }
    const milestones = store.getGoalMilestones(goal.id);
    const items = store.getPlanItems(plan.id);
    const dependencies = store.getDependencies(plan.id);
    const planClaimed = new Set<string>();
    const planLane = projectPlanLane(store, {
      plan,
      items,
      dependencies,
      goalId: goal.id,
      goalName: goalView.name,
      goalView,
      milestones,
      summaries,
      claimedTaskIds: planClaimed,
    });
    for (const id of planClaimed) claimedTaskIds.add(id);

    const filteredPlanColumns = filterColumns(planLane.columns, filter);
    if (cardCount(filteredPlanColumns) === 0) {
      // Hide empty Goal ancestors under filters; keep empty Goals unfiltered.
      if (hasActiveFilter(filter)) continue;
    }

    const filteredPlan: WorkHierarchyPlanLane = {
      ...planLane,
      columns: filteredPlanColumns,
      summary: deriveLaneSummary(flatCards(filteredPlanColumns)),
    };
    const planCards = flatCards(filteredPlanColumns);
    goalLanes.push({
      kind: "goal",
      goalId: goalView.goalId,
      name: sanitiseName(goalView.name) ?? goalView.goalId,
      objective: sanitiseName(goalView.objective) ?? "",
      status: goalView.status,
      updatedAt: goalView.updatedAt,
      summary: deriveLaneSummary(planCards, {
        whatCompleted: goalView.whatJustHappened,
        blocker: goalView.whatIsWaiting,
        nextAction: goalView.nextAction,
      }),
      plans: [filteredPlan],
    });
  }

  // --- Independent plans (no Goal parent) ---
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
    const card = projectOneOffCard(task, summary);
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
