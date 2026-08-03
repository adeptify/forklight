/**
 * FL-109A: canonical WorkHierarchyView Core projection.
 * Proves hierarchy shapes, seven-column mapping, dependency truth, summaries,
 * ancestor-preserving filters, ordering, and privacy allowlist.
 */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { buildTaskRecord } from "../src/core/runner.js";
import { parseTaskSpec } from "../src/core/task.js";
import {
  buildTaskSummary,
  projectBoardPlacement,
  type SafeTaskSummary,
} from "../src/core/task-summary.js";
import type {
  CandidateHandoffOrigin,
  CandidateHandoffRecord,
  DecisionStage,
  DependencyRecord,
  GoalMilestoneRecord,
  GoalRecord,
  PlanItemRecord,
  PlanRecord,
  TaskRecord,
  TaskStatus,
} from "../src/core/types.js";
import {
  mapTaskToHierarchyColumn,
  parseWorkHierarchyFilter,
  projectWorkHierarchy,
  WORK_HIERARCHY_COLUMNS,
  WORK_HIERARCHY_INVALID_FILTER_REASON,
  type WorkHierarchyColumnCode,
  type WorkHierarchyTaskCard,
  type WorkHierarchyView,
} from "../src/core/work-hierarchy.js";
import { StateStore } from "../src/state/store.js";

const TS = "2026-08-03T12:00:00.000Z";

function taskRecord(
  id: string,
  opts: {
    status?: TaskStatus;
    project?: string;
    workerProfileId?: string;
    name?: string;
    error?: string;
    updatedAt?: string;
  } = {},
): TaskRecord {
  const spec = parseTaskSpec(
    {
      version: 1,
      name: opts.name ?? id,
      project: opts.project ?? "/tmp/source-project",
      goal: "Exercise work hierarchy",
      acceptance: { commands: ["npm test"] },
    },
    "/tmp",
  );
  // Stamp Worker Profile after parse so fixtures need no profile catalog.
  if (opts.workerProfileId !== undefined) {
    (spec as { workerProfileId?: string }).workerProfileId = opts.workerProfileId;
  }
  const base = buildTaskRecord({
    spec,
    taskFile: `/tmp/${id}.yaml`,
    home: "/tmp/forklight-home",
    id,
    sessionId: `session-${id}`,
    createdAt: opts.updatedAt ?? TS,
  });
  return {
    ...base,
    status: opts.status ?? "queued",
    updatedAt: opts.updatedAt ?? TS,
    ...(opts.error === undefined ? {} : { error: opts.error }),
  };
}

function summaryFor(
  task: TaskRecord,
  decisionStage?: DecisionStage,
): SafeTaskSummary {
  return buildTaskSummary(
    task,
    undefined,
    undefined,
    undefined,
    decisionStage,
  );
}

function flatAllCards(view: WorkHierarchyView): WorkHierarchyTaskCard[] {
  const cards: WorkHierarchyTaskCard[] = [];
  for (const goal of view.goals) {
    for (const plan of goal.plans) {
      for (const code of WORK_HIERARCHY_COLUMNS) cards.push(...plan.columns[code]);
    }
  }
  for (const plan of view.independentPlans) {
    for (const code of WORK_HIERARCHY_COLUMNS) cards.push(...plan.columns[code]);
  }
  if (view.oneOffTasks) {
    for (const code of WORK_HIERARCHY_COLUMNS) {
      cards.push(...view.oneOffTasks.columns[code]);
    }
  }
  return cards;
}

function findCard(view: WorkHierarchyView, taskId: string): WorkHierarchyTaskCard | undefined {
  return flatAllCards(view).find((c) => c.taskId === taskId);
}

// ---------------------------------------------------------------------------
// Pure column mapper
// ---------------------------------------------------------------------------

test("maps the seven fixture states to exactly one stable column each", () => {
  const cases: Array<{
    label: string;
    status: TaskStatus;
    decisionStage?: DecisionStage;
    deps: boolean;
    column: WorkHierarchyColumnCode;
  }> = [
    { label: "dep-waiting", status: "queued", deps: false, column: "not-started" },
    { label: "queued-ready", status: "queued", deps: true, column: "ready" },
    { label: "running", status: "running", deps: true, column: "running" },
    { label: "verifying", status: "verifying", deps: true, column: "waiting-verification" },
    {
      label: "main-decision",
      status: "succeeded",
      decisionStage: "awaiting-main-review",
      deps: true,
      column: "waiting-user-decision",
    },
    {
      label: "delivered",
      status: "succeeded",
      decisionStage: "delivered",
      deps: true,
      column: "completed",
    },
    { label: "failed", status: "failed", deps: true, column: "stopped-failed" },
  ];
  for (const c of cases) {
    const placement = projectBoardPlacement({
      status: c.status,
      ...(c.decisionStage === undefined ? {} : { decisionStage: c.decisionStage }),
    });
    const result = mapTaskToHierarchyColumn({
      status: c.status,
      ...(c.decisionStage === undefined ? {} : { decisionStage: c.decisionStage }),
      boardScope: placement.boardScope,
      boardReason: placement.boardReason,
      dependenciesSatisfied: c.deps,
    });
    assert.equal(result.column, c.column, c.label);
  }
});

test("dependencies prevent Ready even when raw status is queued", () => {
  const result = mapTaskToHierarchyColumn({
    status: "queued",
    decisionStage: "queued",
    boardScope: "now",
    boardReason: "active-work",
    dependenciesSatisfied: false,
  });
  assert.equal(result.column, "not-started");
  assert.equal(result.placementReason, "dependency-unsatisfied");
});

test("dependency-held blocked and waiting map to not-started not stopped-failed", () => {
  for (const status of ["blocked", "waiting"] as const) {
    const result = mapTaskToHierarchyColumn({
      status,
      boardScope: "now",
      boardReason: "active-work",
      dependenciesSatisfied: false,
    });
    assert.equal(result.column, "not-started", status);
    assert.equal(result.placementReason, "dependency-unsatisfied", status);
    assert.notEqual(result.column, "stopped-failed", status);
    assert.notEqual(result.column, "ready", status);
  }
  // blocked with deps satisfied remains a terminal failure placement
  const terminal = mapTaskToHierarchyColumn({
    status: "blocked",
    boardScope: "now",
    boardReason: "active-work",
    dependenciesSatisfied: true,
  });
  assert.equal(terminal.column, "stopped-failed");
});

test("machine succeeded without delivery cannot claim Completed", () => {
  const result = mapTaskToHierarchyColumn({
    status: "succeeded",
    decisionStage: "machine-verified",
    boardScope: "now",
    boardReason: "awaiting-main",
    dependenciesSatisfied: true,
  });
  assert.equal(result.column, "waiting-user-decision");
  assert.notEqual(result.column, "completed");
});

test("unrecognized evidence fails closed away from Completed", () => {
  const result = mapTaskToHierarchyColumn({
    status: "succeeded",
    decisionStage: "unknown",
    dependenciesSatisfied: true,
  });
  assert.equal(result.column, "waiting-user-decision");
  assert.equal(result.placementReason, "awaiting-main-decision");
});

test("parseWorkHierarchyFilter rejects unsupported, unknown, and ambiguous inputs", () => {
  assert.throws(
    () => parseWorkHierarchyFilter({ column: "queued" }),
    (err: unknown) =>
      err instanceof Error && err.message === WORK_HIERARCHY_INVALID_FILTER_REASON,
  );
  assert.throws(
    () => parseWorkHierarchyFilter({ project: "" }),
    (err: unknown) =>
      err instanceof Error && err.message === WORK_HIERARCHY_INVALID_FILTER_REASON,
  );
  assert.throws(
    () => parseWorkHierarchyFilter({ limit: 50 }),
    (err: unknown) =>
      err instanceof Error && err.message === WORK_HIERARCHY_INVALID_FILTER_REASON,
  );
  assert.throws(
    () => parseWorkHierarchyFilter({ project: "/tmp/p", unknownKey: "x" }),
    (err: unknown) =>
      err instanceof Error && err.message === WORK_HIERARCHY_INVALID_FILTER_REASON,
  );
  assert.throws(
    () => parseWorkHierarchyFilter({ column: "ready", columns: ["running"] }),
    (err: unknown) =>
      err instanceof Error && err.message === WORK_HIERARCHY_INVALID_FILTER_REASON,
  );
  const ok = parseWorkHierarchyFilter({
    column: "ready,running",
    project: "/tmp/source-project",
    workerProfileId: "deepseek-builder",
  });
  assert.deepEqual(ok.columns, ["ready", "running"]);
  assert.equal(ok.project, "/tmp/source-project");
  assert.equal(ok.workerProfileId, "deepseek-builder");
});

// ---------------------------------------------------------------------------
// Full hierarchy fixtures
// ---------------------------------------------------------------------------

test("projects Goal Plan, Independent Plan, One-off, seven columns, deps, summaries, filters", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-work-hierarchy-"));
  const store = new StateStore(home);
  try {
    // --- Goal plan: foundation (succeeded/delivered) -> service (queued, blocked by dep)
    //                 console (running), review (awaiting main), verify (verifying),
    //                 failed-item (failed)
    const foundation = taskRecord("task-foundation", {
      status: "succeeded",
      name: "Foundation",
      workerProfileId: "deepseek-builder",
      project: "/tmp/goal-project",
    });
    const service = taskRecord("task-service", {
      status: "queued",
      name: "Service layer",
      workerProfileId: "deepseek-builder",
      project: "/tmp/goal-project",
    });
    const consoleTask = taskRecord("task-console", {
      status: "running",
      name: "Console UI",
      workerProfileId: "grok-builder",
      project: "/tmp/goal-project",
    });
    const reviewTask = taskRecord("task-review", {
      status: "succeeded",
      name: "Review gate",
      workerProfileId: "deepseek-builder",
      project: "/tmp/goal-project",
    });
    const verifyTask = taskRecord("task-verify", {
      status: "verifying",
      name: "Verify package",
      workerProfileId: "deepseek-builder",
      project: "/tmp/goal-project",
    });
    const failedTask = taskRecord("task-failed", {
      status: "failed",
      name: "Broken step",
      workerProfileId: "deepseek-builder",
      project: "/tmp/goal-project",
      error: "SECRET_PROMPT resultText sk-private-key proxy://evil",
    });

    // Independent plan: one ready task
    const indepTask = taskRecord("task-indep", {
      status: "queued",
      name: "Independent work",
      workerProfileId: "grok-builder",
      project: "/tmp/indep-project",
    });

    // One-off task
    const oneOff = taskRecord("task-oneoff", {
      status: "queued",
      name: "Standalone fix",
      workerProfileId: "deepseek-builder",
      project: "/tmp/oneoff-project",
      error: "PRIVATE_LOG_CONTENT resultText",
    });

    const goalPlan: PlanRecord = {
      id: "goal-plan-1",
      name: "Goal Plan",
      objective: "Ship the hierarchy foundation",
      planFile: "/tmp/goal-plan.yaml",
      createdAt: TS,
      updatedAt: "2026-08-03T13:00:00.000Z",
    };
    const goalItems: PlanItemRecord[] = [
      { id: "foundation", planId: goalPlan.id, taskId: foundation.id, itemIndex: 0, taskFile: foundation.taskFile },
      { id: "service", planId: goalPlan.id, taskId: service.id, itemIndex: 1, taskFile: service.taskFile },
      { id: "console", planId: goalPlan.id, taskId: consoleTask.id, itemIndex: 2, taskFile: consoleTask.taskFile },
      { id: "review", planId: goalPlan.id, taskId: reviewTask.id, itemIndex: 3, taskFile: reviewTask.taskFile },
      { id: "verify", planId: goalPlan.id, taskId: verifyTask.id, itemIndex: 4, taskFile: verifyTask.taskFile },
      { id: "broken", planId: goalPlan.id, taskId: failedTask.id, itemIndex: 5, taskFile: failedTask.taskFile },
    ];
    const goalDeps: DependencyRecord[] = [
      { planId: goalPlan.id, itemId: "service", dependsOnItemId: "foundation" },
      // service also depends on broken so it stays not-started while foundation is done
      // Actually for "dep prevents ready": make service depend on broken (failed) OR on a non-done item.
      // Foundation is succeeded - so service would be ready if only foundation. Add dep on verify (in progress).
      { planId: goalPlan.id, itemId: "service", dependsOnItemId: "verify" },
    ];
    const goal: GoalRecord = {
      id: "goal-1",
      version: 1,
      name: "Hierarchy Goal",
      objective: "Prove Goal Plan Task hierarchy",
      planId: goalPlan.id,
      goalFile: "/tmp/goal.json",
      policy: {
        maxDurationMs: null,
        noProgressTimeoutMs: null,
        maxCorrectionRounds: 1,
        maxReviewRounds: 1,
        maxNoNewEvidenceCycles: 2,
      },
      status: "running",
      reasonCode: "none",
      reason: "Goal is progressing through its Plan Tasks.",
      evidenceDigest: "a".repeat(64),
      evidenceAt: TS,
      counters: { correctionRounds: 0, reviewRounds: 0, noNewEvidenceCycles: 0 },
      createdAt: TS,
      updatedAt: "2026-08-03T13:00:00.000Z",
    };
    const milestones: GoalMilestoneRecord[] = goalItems.map((item) => ({
      goalId: goal.id,
      itemId: item.id,
      // exactOptionalPropertyTypes: omit taskId when absent; never pass undefined.
      ...(item.taskId === undefined ? {} : { taskId: item.taskId }),
      gate: "machine" as const,
      itemIndex: item.itemIndex,
      satisfied: item.id === "foundation",
      reasonCode: item.id === "foundation" ? "none" as const : "waiting-machine" as const,
      reason: item.id === "foundation" ? "satisfied" : "waiting",
      updatedAt: TS,
    }));

    const indepPlan: PlanRecord = {
      id: "indep-plan-1",
      name: "Independent Plan",
      objective: "No Goal parent",
      planFile: "/tmp/indep-plan.yaml",
      createdAt: TS,
      updatedAt: "2026-08-03T12:30:00.000Z",
    };
    const indepItems: PlanItemRecord[] = [
      { id: "solo", planId: indepPlan.id, taskId: indepTask.id, itemIndex: 0, taskFile: indepTask.taskFile },
    ];

    // Persist via createPlanExecutionWithGoal for goal path
    store.createPlanExecutionWithGoal(
      [foundation, service, consoleTask, reviewTask, verifyTask, failedTask].map((task) => ({
        task,
        creationEvent: { summary: `Task created: ${task.name}`, payload: {} },
      })),
      goalPlan,
      goalItems,
      goalDeps,
      goal,
      milestones,
    );
    // Independent plan + one-off
    store.createTask(indepTask);
    store.createPlanGraph(indepPlan, indepItems, []);
    store.createTask(oneOff);

    // Stamp statuses after create (createPlanExecutionWithGoal inserts as given)
    for (const task of [foundation, service, consoleTask, reviewTask, verifyTask, failedTask, indepTask, oneOff]) {
      if (task.status !== "queued") {
        store.setTaskStatus(task.id, task.status, {
          ...(task.error === undefined ? {} : { error: task.error }),
        });
      }
    }

    const projectSurface = (task: TaskRecord): SafeTaskSummary => {
      let stage: DecisionStage | undefined;
      if (task.id === foundation.id) stage = "delivered";
      else if (task.id === reviewTask.id) stage = "awaiting-main-review";
      else if (task.id === consoleTask.id) stage = "worker-running";
      else if (task.id === verifyTask.id) stage = "worker-running";
      else if (task.id === failedTask.id) stage = "machine-failed";
      else if (task.id === service.id || task.id === indepTask.id || task.id === oneOff.id) {
        stage = "queued";
      }
      return summaryFor(task, stage);
    };

    const view = projectWorkHierarchy(store, projectSurface);
    const again = projectWorkHierarchy(store, projectSurface);
    assert.deepEqual(again, view, "projection is deterministic");

    // Schema + seven columns
    assert.equal(view.schemaVersion, 1);
    assert.deepEqual(
      view.columns.map((c) => c.code),
      [...WORK_HIERARCHY_COLUMNS],
    );
    assert.equal(view.columns.length, 7);

    // Goal path with plans array
    assert.equal(view.goals.length, 1);
    const goalLane = view.goals[0]!;
    assert.equal(goalLane.kind, "goal");
    assert.equal(goalLane.goalId, "goal-1");
    assert.ok(Array.isArray(goalLane.plans));
    assert.equal(goalLane.plans.length, 1);
    assert.equal(goalLane.plans[0]!.planId, "goal-plan-1");
    // Goal is ancestor lane, never a peer card
    assert.equal(goalLane.plans[0]!.kind, "plan");

    // Independent plan, no fake Goal
    assert.equal(view.independentPlans.length, 1);
    assert.equal(view.independentPlans[0]!.planId, "indep-plan-1");
    assert.equal(view.independentPlans[0]!.kind, "plan");
    // No goalId on independent plan cards
    const indepCard = findCard(view, "task-indep")!;
    assert.equal(indepCard.breadcrumb.goalId, undefined);
    assert.equal(indepCard.breadcrumb.planId, "indep-plan-1");
    assert.equal(indepCard.column, "ready");

    // One-off lane: no plan/goal placeholders
    assert.ok(view.oneOffTasks);
    assert.equal(view.oneOffTasks!.kind, "one-off");
    const oneOffCard = findCard(view, "task-oneoff")!;
    assert.equal(oneOffCard.breadcrumb.goalId, undefined);
    assert.equal(oneOffCard.breadcrumb.planId, undefined);
    assert.equal(oneOffCard.column, "ready");
    assert.equal(oneOffCard.itemId, undefined);

    // Seven column placements on goal plan
    const serviceCard = findCard(view, "task-service")!;
    assert.equal(serviceCard.column, "not-started");
    assert.equal(serviceCard.placementReason, "dependency-unsatisfied");
    assert.ok(serviceCard.namedDependencies.some((d) => d.itemId === "verify"));
    assert.ok(serviceCard.blockers.length > 0);
    assert.match(serviceCard.nextAction, /prerequisite|Waiting/i);
    // Reverse edge: foundation unlocks service
    const foundationCard = findCard(view, "task-foundation")!;
    assert.equal(foundationCard.column, "completed");
    assert.ok(foundationCard.namedRequiredBy.some((d) => d.itemId === "service"));
    assert.ok(foundationCard.namedRequiredBy.some((d) => d.taskName === "Service layer"));

    assert.equal(findCard(view, "task-console")!.column, "running");
    assert.equal(findCard(view, "task-verify")!.column, "waiting-verification");
    assert.equal(findCard(view, "task-review")!.column, "waiting-user-decision");
    assert.equal(findCard(view, "task-failed")!.column, "stopped-failed");

    // Ready must not contain the dependency-blocked service card
    const goalPlanCols = goalLane.plans[0]!.columns;
    assert.ok(!goalPlanCols.ready.some((c) => c.taskId === "task-service"));
    assert.ok(goalPlanCols["not-started"].some((c) => c.taskId === "task-service"));

    // Summaries tell a story (not percent alone)
    assert.ok(goalLane.summary.whatCompleted.length > 0);
    assert.ok(goalLane.summary.blocker.length > 0);
    assert.ok(goalLane.summary.nextAction.length > 0);
    assert.ok(typeof goalLane.summary.progress.percent === "number");
    // Plan summary separate fields
    const planSummary = goalLane.plans[0]!.summary;
    assert.ok(planSummary.whatCompleted.length > 0);
    assert.ok(planSummary.blocker.length > 0);
    assert.ok(planSummary.nextAction.length > 0);
    assert.ok(planSummary.progress.total >= 6);

    // Privacy: private markers must not appear
    const serialized = JSON.stringify(view);
    // Real secret/proxy markers only — avoid false positives on ids like task-service.
    assert.doesNotMatch(
      serialized,
      /SECRET_PROMPT|PRIVATE_LOG|sk-private-key|proxy:\/\/evil|resultText/,
    );
    // Cards must not carry raw error
    for (const card of flatAllCards(view)) {
      assert.equal((card as { error?: unknown }).error, undefined);
    }

    // --- Filters preserve ancestors ---
    const filtered = projectWorkHierarchy(store, projectSurface, {
      project: "/tmp/goal-project",
      column: "running",
    });
    assert.equal(filtered.goals.length, 1);
    assert.equal(filtered.goals[0]!.goalId, "goal-1");
    assert.equal(filtered.goals[0]!.plans.length, 1);
    const runningCards = filtered.goals[0]!.plans[0]!.columns.running;
    assert.equal(runningCards.length, 1);
    assert.equal(runningCards[0]!.taskId, "task-console");
    // Empty siblings hidden
    assert.equal(filtered.independentPlans.length, 0);
    assert.equal(filtered.oneOffTasks, undefined);
    // Ancestor path intact
    assert.equal(runningCards[0]!.breadcrumb.goalId, "goal-1");
    assert.equal(runningCards[0]!.breadcrumb.planId, "goal-plan-1");

    // Worker filter
    const byWorker = projectWorkHierarchy(store, projectSurface, {
      workerProfileId: "grok-builder",
    });
    const workerCards = flatAllCards(byWorker);
    assert.ok(workerCards.every((c) => c.workerProfileId === "grok-builder"));
    assert.ok(workerCards.some((c) => c.taskId === "task-console"));
    assert.ok(workerCards.some((c) => c.taskId === "task-indep"));
    // Goal ancestor retained for console
    assert.ok(byWorker.goals.some((g) => g.goalId === "goal-1"));
    assert.ok(byWorker.independentPlans.some((p) => p.planId === "indep-plan-1"));

    // Lifecycle unchanged by the read projection
    assert.equal(store.getTask("task-console").status, "running");
    assert.equal(store.getTask("task-service").status, "queued");
    assert.equal(store.getTask("task-failed").status, "failed");

    // status=blocked with unsatisfied deps projects Not started (not Stopped/failed)
    store.setTaskStatus("task-service", "blocked", {
      error: "Waiting on prerequisites: verify",
    });
    const blockedView = projectWorkHierarchy(store, (task) => {
      if (task.id === "task-service") {
        return summaryFor({ ...task, status: "blocked" }, "queued");
      }
      return projectSurface(task);
    });
    const blockedCard = findCard(blockedView, "task-service")!;
    assert.equal(blockedCard.status, "blocked");
    assert.equal(blockedCard.column, "not-started");
    assert.equal(blockedCard.placementReason, "dependency-unsatisfied");
    assert.ok(!blockedView.goals[0]!.plans[0]!.columns["stopped-failed"]
      .some((c) => c.taskId === "task-service"));
    assert.ok(!blockedView.goals[0]!.plans[0]!.columns.ready
      .some((c) => c.taskId === "task-service"));
  } finally {
    store.close();
  }
});

test("one-off and independent plan never invent blank parent ids", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-wh-parentless-"));
  const store = new StateStore(home);
  try {
    const planTask = taskRecord("p-task", { status: "queued", name: "Plan only" });
    const solo = taskRecord("solo-task", { status: "running", name: "Solo" });
    store.createTask(planTask);
    store.createTask(solo);
    const plan: PlanRecord = {
      id: "orphan-plan",
      name: "Orphan",
      objective: "Independent",
      planFile: "/tmp/o.yaml",
      createdAt: TS,
      updatedAt: TS,
    };
    store.createPlanGraph(
      plan,
      [{ id: "only", planId: plan.id, taskId: planTask.id, itemIndex: 0, taskFile: planTask.taskFile }],
      [],
    );

    const view = projectWorkHierarchy(store, (t) => summaryFor(t));
    assert.equal(view.goals.length, 0);
    assert.equal(view.independentPlans.length, 1);
    assert.ok(view.oneOffTasks);

    const pCard = findCard(view, "p-task")!;
    assert.equal(pCard.breadcrumb.goalId, undefined);
    assert.equal(pCard.breadcrumb.goalName, undefined);
    assert.equal(pCard.breadcrumb.planId, "orphan-plan");

    const sCard = findCard(view, "solo-task")!;
    assert.equal(sCard.breadcrumb.goalId, undefined);
    assert.equal(sCard.breadcrumb.planId, undefined);
    assert.equal(sCard.column, "running");

    // No blank string parents
    assert.notEqual(pCard.breadcrumb.goalId, "");
    assert.notEqual(sCard.breadcrumb.planId, "");
  } finally {
    store.close();
  }
});

test("schema exposes plans as arrays on Goal lanes", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-wh-plans-array-"));
  const store = new StateStore(home);
  try {
    const task = taskRecord("g-task", { status: "queued" });
    const plan: PlanRecord = {
      id: "p1",
      name: "P",
      objective: "O",
      planFile: "/tmp/p.yaml",
      createdAt: TS,
      updatedAt: TS,
    };
    const items: PlanItemRecord[] = [
      { id: "i1", planId: plan.id, taskId: task.id, itemIndex: 0, taskFile: task.taskFile },
    ];
    const goal: GoalRecord = {
      id: "g1",
      version: 1,
      name: "G",
      objective: "O",
      planId: plan.id,
      goalFile: "/tmp/g.json",
      policy: {
        maxDurationMs: null,
        noProgressTimeoutMs: null,
        maxCorrectionRounds: 1,
        maxReviewRounds: 1,
        maxNoNewEvidenceCycles: 1,
      },
      status: "running",
      reasonCode: "none",
      reason: "progressing",
      evidenceDigest: "b".repeat(64),
      evidenceAt: TS,
      counters: { correctionRounds: 0, reviewRounds: 0, noNewEvidenceCycles: 0 },
      createdAt: TS,
      updatedAt: TS,
    };
    const milestones: GoalMilestoneRecord[] = [
      {
        goalId: goal.id,
        itemId: "i1",
        taskId: task.id,
        gate: "machine",
        itemIndex: 0,
        satisfied: false,
        reasonCode: "waiting-machine",
        reason: "waiting",
        updatedAt: TS,
      },
    ];
    store.createPlanExecutionWithGoal(
      [{ task, creationEvent: { summary: "created", payload: {} } }],
      plan,
      items,
      [],
      goal,
      milestones,
    );
    const view = projectWorkHierarchy(store, (x) => summaryFor(x, "queued"));
    assert.ok(Array.isArray(view.goals[0]!.plans));
    assert.equal(view.goals[0]!.plans.length, 1);
  } finally {
    store.close();
  }
});

function handoffRecord(
  id: string,
  origin: CandidateHandoffOrigin,
  sourceTaskId: string,
  successorTaskId: string,
): CandidateHandoffRecord {
  return {
    schemaVersion: 1,
    id,
    status: "prepared",
    origin,
    sourceTaskId,
    sourceCandidateRevisionId: `rev-${id}`,
    sourcePatchDigest: "a".repeat(64),
    gapContractDigest: "b".repeat(64),
    reusablePathCount: 0,
    remainingGapCount: 0,
    reusablePaths: [],
    remainingGaps: [],
    destinationWorkerProfileId: "grok-builder",
    destinationIdentity: {
      provider: "openai",
      model: "gpt-5.4",
      runtime: "codex-cli",
      effort: "medium",
      workerProfileId: "grok-builder",
    },
    successorTaskId,
    reason: "Handoff ownership regression",
    createdAt: TS,
    updatedAt: TS,
    nextAction: "wait-for-successor",
  };
}

test("legacy handoffs without origin load safely and never claim one-off Tasks", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-wh-legacy-handoff-"));
  const store = new StateStore(home);
  try {
    const legacySource = taskRecord("legacy-src", { status: "queued", name: "Legacy source" });
    const legacySuccessor = taskRecord("legacy-succ", { status: "queued", name: "Legacy successor" });
    const goalSource = taskRecord("goal-src", { status: "queued", name: "Goal source" });
    const goalSuccessor = taskRecord("goal-succ", { status: "queued", name: "Goal successor" });
    const compSource = taskRecord("comp-src", { status: "queued", name: "Competition source" });
    const compSuccessor = taskRecord("comp-succ", { status: "queued", name: "Competition successor" });

    for (const task of [legacySource, legacySuccessor, goalSource, compSource]) {
      store.createTask(task);
    }

    // Current goal-task origin: source and successor stay claimed by the Goal lineage.
    store.createCandidateHandoff({
      record: handoffRecord(
        "goal-handoff",
        { kind: "goal-task", goalId: "goal-1", itemId: "item-1" },
        goalSource.id,
        goalSuccessor.id,
      ),
      task: goalSuccessor,
      authorizationEvent: { summary: "Goal handoff authorized", payload: {} },
    });

    // Current non-goal (competition) origin: never claimed by the Goal lineage.
    store.createCandidateHandoff({
      record: handoffRecord(
        "comp-handoff",
        { kind: "competition", competitionId: "comp-1", sourceCandidateId: "cand-1" },
        compSource.id,
        compSuccessor.id,
      ),
      task: compSuccessor,
      authorizationEvent: { summary: "Competition handoff authorized", payload: {} },
    });

    // Legacy durable row predates `origin`: persist a current-format record with
    // the field stripped so the Store genuinely holds an origin-less handoff.
    const legacyRecord = handoffRecord(
      "legacy-handoff",
      { kind: "goal-task", goalId: "legacy-goal", itemId: "legacy-item" },
      legacySource.id,
      legacySuccessor.id,
    );
    const legacyJson = JSON.stringify(legacyRecord, (key, value) =>
      key === "origin" ? undefined : value,
    );
    const legacy = new DatabaseSync(store.databasePath);
    try {
      legacy.prepare(
        `INSERT INTO candidate_handoffs
         (id, source_revision_id, source_task_id, successor_task_id, competition_id,
          status, record_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        legacyRecord.id,
        legacyRecord.sourceCandidateRevisionId,
        legacyRecord.sourceTaskId,
        legacyRecord.successorTaskId,
        "",
        legacyRecord.status,
        legacyJson,
        legacyRecord.createdAt,
        legacyRecord.updatedAt,
      );
    } finally {
      legacy.close();
    }

    // Prove the Store really reads an origin-less durable handoff (not vacuous).
    const durable = store.listCandidateHandoffs();
    assert.equal(durable.length, 3);
    assert.equal(durable.find((h) => h.id === "legacy-handoff")?.origin, undefined);

    // Projection must not throw and must keep the current ownership split.
    const view = projectWorkHierarchy(store, (task) => summaryFor(task));
    const oneOffIds = new Set<string>();
    if (view.oneOffTasks !== undefined) {
      for (const code of WORK_HIERARCHY_COLUMNS) {
        for (const card of view.oneOffTasks.columns[code]) oneOffIds.add(card.taskId);
      }
    }

    // Legacy handoff cannot break the board or hide unrelated one-off Tasks.
    assert.ok(oneOffIds.has("legacy-src"), "legacy source stays one-off");
    assert.ok(oneOffIds.has("legacy-succ"), "legacy successor stays one-off");

    // Current goal-task handoff keeps claiming source and successor.
    assert.ok(!oneOffIds.has("goal-src"), "goal source stays owned");
    assert.ok(!oneOffIds.has("goal-succ"), "goal successor stays owned");

    // Current non-goal handoff is never claimed by the Goal lineage.
    assert.ok(oneOffIds.has("comp-src"), "competition source stays one-off");
    assert.ok(oneOffIds.has("comp-succ"), "competition successor stays one-off");
  } finally {
    store.close();
  }
});

test("every Task card carries a Core-owned action policy covering all seven destinations", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-wh-action-policy-"));
  const store = new StateStore(home);
  try {
    const blocker = taskRecord("policy-blocker", { status: "running", name: "Blocker" });
    const depHeld = taskRecord("policy-dep", { status: "queued", name: "Dep held" });
    const delivered = taskRecord("policy-delivered", { status: "succeeded", name: "Delivered" });
    store.createTask(blocker);
    store.createTask(depHeld);
    store.createTask(delivered);
    const plan: PlanRecord = {
      id: "policy-plan",
      name: "Policy Plan",
      objective: "Policy",
      planFile: "/tmp/p.yaml",
      createdAt: TS,
      updatedAt: TS,
    };
    store.createPlanGraph(
      plan,
      [
        { id: "blocker-item", planId: plan.id, taskId: blocker.id, itemIndex: 0, taskFile: blocker.taskFile },
        { id: "dep-item", planId: plan.id, taskId: depHeld.id, itemIndex: 1, taskFile: depHeld.taskFile },
      ],
      [{ planId: plan.id, itemId: "dep-item", dependsOnItemId: "blocker-item" }],
    );

    const view = projectWorkHierarchy(store, (task) =>
      task.id === delivered.id ? summaryFor(task, "delivered") : summaryFor(task, "queued"));

    const cards = flatAllCards(view);
    assert.equal(cards.length, 3);
    for (const card of cards) {
      assert.ok(card.actionPolicy, `card ${card.taskId} carries an actionPolicy`);
      assert.equal(card.actionPolicy.schemaVersion, 1);
      const destinations = card.actionPolicy.destinations;
      for (const code of WORK_HIERARCHY_COLUMNS) {
        const entry = destinations[code];
        assert.ok(entry, `destination ${code} present on ${card.taskId}`);
        assert.equal(entry.column, code);
      }
    }

    // Dependency-held Task cannot be made Ready by a manual request.
    const depCard = findCard(view, "policy-dep")!;
    assert.equal(depCard.column, "not-started");
    assert.equal(depCard.placementReason, "dependency-unsatisfied");
    const depReady = depCard.actionPolicy.destinations.ready;
    assert.equal(depReady.disposition, "automatic-only");
    assert.equal(depReady.reason, "dependency-held");
    assert.equal(depReady.operation, undefined);

    // Delivered Task cannot move backward.
    const deliveredCard = findCard(view, "policy-delivered")!;
    assert.equal(deliveredCard.column, "completed");
    assert.equal(deliveredCard.actionPolicy.destinations.completed.reason, "already-delivered");
    for (const code of ["not-started", "ready", "running", "waiting-verification", "waiting-user-decision", "stopped-failed"] as const) {
      const entry = deliveredCard.actionPolicy.destinations[code];
      assert.equal(entry.disposition, "no-op", code);
      assert.equal(entry.operation, undefined, code);
    }

    // The policy projection is deterministic and privacy-safe.
    const again = projectWorkHierarchy(store, (task) =>
      task.id === delivered.id ? summaryFor(task, "delivered") : summaryFor(task, "queued"));
    assert.deepEqual(again, view);
    const serialized = JSON.stringify(view);
    assert.doesNotMatch(serialized, /SECRET_PROMPT|PRIVATE_LOG|sk-private-key|proxy:\/\/evil|resultText/);
  } finally {
    store.close();
  }
});
