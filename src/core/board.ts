import type { StateStore } from "../state/store.js";
import type { PlanRecord, TaskStatus } from "./types.js";

export type BoardColumn = "queued" | "active" | "blocked" | "failed" | "completed";
export type BoardDependencyState = "satisfied" | "waiting" | "failed";

export interface BoardDependency {
  itemId: string;
  taskId?: string;
  taskStatus?: TaskStatus;
  state: BoardDependencyState;
}

export interface BoardItem {
  itemId: string;
  itemIndex: number;
  taskFile: string;
  taskId?: string;
  taskName?: string;
  taskStatus?: TaskStatus;
  error?: string;
  dependencies: BoardDependency[];
  requiredBy: string[];
}

export interface BoardProgress {
  total: number;
  completed: number;
  active: number;
  blocked: number;
  failed: number;
  queued: number;
  waiting: number;
  percent: number;
}

export interface PlanBoardSummary {
  planId: string;
  name: string;
  objective: string;
  updatedAt: string;
  progress: BoardProgress;
}

export interface PlanBoard {
  plan: PlanBoardSummary;
  columns: Record<BoardColumn, BoardItem[]>;
}

export function boardColumnForStatus(status: TaskStatus | undefined): BoardColumn {
  switch (status) {
    case "preparing":
    case "running":
    case "verifying":
      return "active";
    case "blocked":
      return "blocked";
    case "failed":
    case "interrupted":
      return "failed";
    case "succeeded":
      return "completed";
    case "queued":
    case "waiting":
    case undefined:
      return "queued";
  }
}

function dependencyState(status: TaskStatus | undefined): BoardDependencyState {
  if (status === "succeeded") return "satisfied";
  if (status === "failed" || status === "interrupted" || status === "blocked") return "failed";
  return "waiting";
}

function progress(columns: Record<BoardColumn, BoardItem[]>): BoardProgress {
  const total = Object.values(columns).reduce((sum, items) => sum + items.length, 0);
  const completed = columns.completed.length;
  return {
    total,
    completed,
    active: columns.active.length,
    blocked: columns.blocked.length,
    failed: columns.failed.length,
    queued: columns.queued.length,
    waiting: columns.queued.filter((item) => item.taskStatus === "waiting").length,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

export class BoardService {
  constructor(private readonly store: StateStore) {}

  getPlanBoard(planId: string): PlanBoard {
    const plan = this.store.getPlan(planId);
    const items = this.store.getPlanItems(planId);
    const statuses = new Map(
      this.store.getPlanItemStatuses(planId).map((item) => [item.itemId, item]),
    );
    const directDependencies = new Map<string, string[]>();
    const directDependents = new Map<string, string[]>();
    for (const dependency of this.store.getDependencies(planId)) {
      directDependencies.set(
        dependency.itemId,
        [...(directDependencies.get(dependency.itemId) ?? []), dependency.dependsOnItemId],
      );
      directDependents.set(
        dependency.dependsOnItemId,
        [...(directDependents.get(dependency.dependsOnItemId) ?? []), dependency.itemId],
      );
    }

    const columns: Record<BoardColumn, BoardItem[]> = {
      queued: [],
      active: [],
      blocked: [],
      failed: [],
      completed: [],
    };
    for (const item of items) {
      const status = statuses.get(item.id);
      const task = item.taskId === undefined ? undefined : this.store.getTask(item.taskId);
      const dependencies = (directDependencies.get(item.id) ?? []).map((dependencyItemId) => {
        const dependency = statuses.get(dependencyItemId);
        return {
          itemId: dependencyItemId,
          ...(dependency?.taskId === undefined ? {} : { taskId: dependency.taskId }),
          ...(dependency?.taskStatus === undefined ? {} : { taskStatus: dependency.taskStatus }),
          state: dependencyState(dependency?.taskStatus),
        } satisfies BoardDependency;
      });
      const boardItem: BoardItem = {
        itemId: item.id,
        itemIndex: item.itemIndex,
        taskFile: item.taskFile,
        ...(item.taskId === undefined ? {} : { taskId: item.taskId }),
        ...(task === undefined ? {} : { taskName: task.name }),
        ...(status?.taskStatus === undefined ? {} : { taskStatus: status.taskStatus }),
        ...(task?.error === undefined ? {} : { error: task.error }),
        dependencies,
        requiredBy: directDependents.get(item.id) ?? [],
      };
      columns[boardColumnForStatus(status?.taskStatus)].push(boardItem);
    }
    return { plan: this.summary(plan, columns), columns };
  }

  listPlanBoards(limit = 50): PlanBoardSummary[] {
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    return this.store
      .listPlans()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .slice(0, boundedLimit)
      .map((plan) => this.getPlanBoard(plan.id).plan);
  }

  private summary(plan: PlanRecord, columns: Record<BoardColumn, BoardItem[]>): PlanBoardSummary {
    return {
      planId: plan.id,
      name: plan.name,
      objective: plan.objective,
      updatedAt: plan.updatedAt,
      progress: progress(columns),
    };
  }
}
