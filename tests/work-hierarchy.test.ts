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
  AttemptRecord,
  CandidateHandoffOrigin,
  CandidateHandoffRecord,
  DecisionStage,
  DependencyRecord,
  GoalMilestoneRecord,
  GoalRecord,
  IntegrationReceiptRecord,
  IntegrationResultRecord,
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

/** Machine gate evidence: succeeded + passing verification event. */
function seedMachineSucceeded(store: StateStore, taskId: string): void {
  store.setTaskStatus(taskId, "succeeded", {
    error: null,
    finishedAt: new Date().toISOString(),
  });
  store.addEvent(taskId, undefined, "verification.completed", "verification passed", {
    passed: true,
    commands: [],
  });
}

/** Fresh exact Main accept bound to the current Candidate revision. */
function seedMainAccept(store: StateStore, taskId: string, digest = "a".repeat(64)): void {
  const task = store.getTask(taskId);
  const attemptId = task.currentAttemptId ?? `attempt-${taskId.slice(0, 8)}`;
  try {
    store.getAttempt(attemptId);
  } catch {
    const attempt: AttemptRecord = {
      id: attemptId,
      taskId,
      ordinal: 1,
      status: "succeeded",
      sessionId: `session-${attemptId}`,
      rawLogPath: path.join(task.paths.logs, "worker.log"),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
    store.createAttempt(attempt);
  }
  store.updateTask(taskId, { currentAttemptId: attemptId });
  store.setTaskStatus(taskId, "succeeded", { error: null, finishedAt: new Date().toISOString() });
  store.addEvent(taskId, attemptId, "verification.completed", "verification passed", {
    passed: true,
    commands: [],
  });
  const verification = store.listEvents(taskId)
    .filter((e) => e.type === "verification.completed")
    .at(-1)!;
  const revisionId = `rev-${digest.slice(0, 8)}`;
  store.addEvent(taskId, attemptId, "candidate.revision.captured", "revision captured", {
    id: revisionId,
    taskId,
    attemptId,
    attemptOrdinal: 1,
    verificationEventSequence: verification.sequence,
    patchDigest: digest,
    filesChanged: 1,
    changedLines: 1,
    affectedPaths: ["src/a.ts"],
    verificationPassed: true,
    createdAt: new Date().toISOString(),
  });
  store.addEvent(taskId, attemptId, "main-review.completed", "Main agent review: accept", {
    decision: "accept",
    reason: "Accepted for the work-hierarchy regression fixture",
    attemptId,
    verificationEventSequence: verification.sequence,
    candidateRevisionId: revisionId,
    acceptedPatchDigest: digest,
  });
}

/** Integration gate evidence: applied receipt bound to the exact accepted digest. */
function seedIntegrationApplied(
  store: StateStore,
  taskId: string,
  digest = "a".repeat(64),
): void {
  const receiptId = "receipt-1";
  const receipt: IntegrationReceiptRecord = {
    id: receiptId,
    taskId,
    patchDigest: digest,
    affectedFiles: ["src/a.ts"],
    rejectionReasons: [],
    sourceEvidence: {},
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    consumed: true,
  };
  store.saveIntegrationReceipt(receipt);
  const result: IntegrationResultRecord = {
    id: "op-1",
    receiptId,
    taskId,
    status: "applied",
    appliedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  store.saveIntegrationResult(result);
  store.addEvent(taskId, undefined, "integration.apply.completed", "Integration applied", result);
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
    // FL-109E2: the machine gate is satisfied for this Goal milestone, so the
    // card is complete in the Goal lane even though the Task-wide decision
    // stage (awaiting-main-review) is still inspectable on the card.
    const reviewCard = findCard(view, "task-review")!;
    assert.equal(reviewCard.column, "completed");
    assert.equal(reviewCard.placementReason, "goal-gate-satisfied");
    assert.equal(reviewCard.decisionStage, "awaiting-main-review");
    assert.equal(reviewCard.goalGate?.gate, "machine");
    assert.equal(reviewCard.goalGate?.satisfied, true);
    assert.equal(reviewCard.nextAction, "Machine gate is satisfied.");
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

// ---------------------------------------------------------------------------
// FL-109E2: Goal milestone gate satisfaction reconciles the Goal Plan lane
// ---------------------------------------------------------------------------

test("completed mixed-gate Goal projects a 4/4 completed Plan with no required user-decision story", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-wh-goal-gate-reconcile-"));
  const store = new StateStore(home);
  try {
    const m1 = taskRecord("wh-m1", { status: "queued", name: "Machine one", project: "/tmp/reconcile-project" });
    const m2 = taskRecord("wh-main", { status: "queued", name: "Main accept", project: "/tmp/reconcile-project" });
    const m3 = taskRecord("wh-int", { status: "queued", name: "Integration", project: "/tmp/reconcile-project" });
    const m4 = taskRecord("wh-m2", { status: "queued", name: "Machine two", project: "/tmp/reconcile-project" });

    const plan: PlanRecord = {
      id: "reconcile-plan",
      name: "Reconcile Goal Plan",
      objective: "Mixed gates",
      planFile: "/tmp/reconcile-plan.yaml",
      createdAt: TS,
      updatedAt: "2026-08-03T13:00:00.000Z",
    };
    const items: PlanItemRecord[] = [
      { id: "m1", planId: plan.id, taskId: m1.id, itemIndex: 0, taskFile: m1.taskFile },
      { id: "m2", planId: plan.id, taskId: m2.id, itemIndex: 1, taskFile: m2.taskFile },
      { id: "m3", planId: plan.id, taskId: m3.id, itemIndex: 2, taskFile: m3.taskFile },
      { id: "m4", planId: plan.id, taskId: m4.id, itemIndex: 3, taskFile: m4.taskFile },
    ];
    const gates = ["machine", "main-accept", "integration", "machine"] as const;
    const milestones: GoalMilestoneRecord[] = items.map((item, index) => ({
      goalId: "reconcile-goal",
      itemId: item.id,
      taskId: item.taskId!,
      gate: gates[index]!,
      itemIndex: item.itemIndex,
      satisfied: true,
      reasonCode: "none" as const,
      reason: "satisfied",
      updatedAt: TS,
    }));
    const goal: GoalRecord = {
      id: "reconcile-goal",
      version: 1,
      name: "Reconcile Goal",
      objective: "Reproduce completed Goal vs 1/4 Plan contradiction",
      planId: plan.id,
      goalFile: "/tmp/reconcile-goal.json",
      policy: {
        maxDurationMs: null,
        noProgressTimeoutMs: null,
        maxCorrectionRounds: 1,
        maxReviewRounds: 1,
        maxNoNewEvidenceCycles: 2,
      },
      status: "completed",
      reasonCode: "goal-completed",
      reason: "Every milestone gate is satisfied.",
      evidenceDigest: "c".repeat(64),
      evidenceAt: TS,
      counters: { correctionRounds: 0, reviewRounds: 0, noNewEvidenceCycles: 0 },
      createdAt: TS,
      updatedAt: "2026-08-03T13:00:00.000Z",
      completedAt: "2026-08-03T13:00:00.000Z",
    };

    store.createPlanExecutionWithGoal(
      [m1, m2, m3, m4].map((task) => ({
        task,
        creationEvent: { summary: `created ${task.id}`, payload: {} },
      })),
      plan,
      items,
      [],
      goal,
      milestones,
    );

    // Seed the four mixed gate evidence chains.
    seedMachineSucceeded(store, m1.id);
    seedMainAccept(store, m2.id, "b".repeat(64));
    seedMainAccept(store, m3.id, "c".repeat(64));
    seedIntegrationApplied(store, m3.id, "c".repeat(64));
    // Real retained-delivery shape: machine history remains failed while Main
    // has separately verified the repaired source as delivered.
    store.setTaskStatus(m3.id, "failed", {
      error: "historical Worker failure",
      finishedAt: new Date().toISOString(),
    });
    store.saveRemediationDisposition(m3.id, {
      status: "verified-repaired-delivered",
      checkId: "repair-check",
      createdAt: new Date().toISOString(),
      acceptanceBasis: "original-acceptance",
    });
    seedMachineSucceeded(store, m4.id);

    // The real contradiction: underlying Tasks still carry broader Task-wide
    // decision stages (waiting for Main / ready for Integration) that the Goal
    // gates already outscope.
    const projectSurface = (task: TaskRecord): SafeTaskSummary => {
      let stage: DecisionStage | undefined;
      if (task.id === m1.id || task.id === m4.id) stage = "awaiting-main-review";
      else if (task.id === m2.id) stage = "ready-for-integration";
      else if (task.id === m3.id) {
        return buildTaskSummary(
          task,
          undefined,
          undefined,
          {
            status: "verified-repaired-delivered",
            checkId: "repair-check",
            createdAt: new Date().toISOString(),
            acceptanceBasis: "original-acceptance",
          },
          "revision-requested",
        );
      }
      return summaryFor(task, stage);
    };

    const view = projectWorkHierarchy(store, projectSurface);
    const goalLane = view.goals[0]!;
    const planLane = goalLane.plans[0]!;
    assert.equal(goalLane.status, "completed");

    // Every Goal-owned card is completed in this Goal's lane.
    for (const taskId of [m1.id, m2.id, m3.id, m4.id]) {
      const card = findCard(view, taskId)!;
      assert.equal(card.column, "completed", taskId);
      assert.equal(card.goalGate?.satisfied, true, taskId);
    }
    // The gate override explains the cards whose Task-wide stage would otherwise
    // claim a required decision; the already-delivered integration card keeps
    // its durable delivered-outcome placement while still carrying goalGate.
    assert.equal(findCard(view, m1.id)!.placementReason, "goal-gate-satisfied");
    assert.equal(findCard(view, m2.id)!.placementReason, "goal-gate-satisfied");
    assert.equal(findCard(view, m4.id)!.placementReason, "goal-gate-satisfied");
    assert.equal(findCard(view, m3.id)!.placementReason, "delivered-outcome");
    assert.equal(findCard(view, m3.id)!.status, "failed");
    assert.deepEqual(findCard(view, m3.id)!.blockers, []);
    assert.match(
      findCard(view, m3.id)!.nextAction,
      /Integration gate is satisfied by verified Main-repaired source delivery/,
    );

    // Progress is 4/4 with no required user-decision story.
    assert.deepEqual(planLane.summary.progress, { total: 4, completed: 4, percent: 100 });
    assert.equal(planLane.columns.completed.length, 4);
    assert.equal(planLane.columns["waiting-user-decision"].length, 0);
    assert.equal(planLane.columns["stopped-failed"].length, 0);
    assert.ok(!/Main decision|Main must/i.test(planLane.summary.nextAction));

    // Underlying Task facts stay inspectable and the action policy never
    // demands a required Main decision or a card move.
    const m1Card = findCard(view, m1.id)!;
    assert.equal(m1Card.status, "succeeded");
    assert.equal(m1Card.decisionStage, "awaiting-main-review");
    assert.equal(m1Card.goalGate!.gate, "machine");
    assert.equal(
      m1Card.actionPolicy.nextCheckpoint,
      "This Plan item is complete for its Goal; no Goal action is required.",
    );
    for (const code of WORK_HIERARCHY_COLUMNS) {
      const entry = m1Card.actionPolicy.destinations[code];
      assert.equal(entry.disposition, "no-op", code);
      assert.equal(entry.operation, undefined, code);
    }

    // A main-accept gated card completes while its Task-wide stage is
    // ready-for-integration; the broader Integration step is outside the gate.
    const m2Card = findCard(view, m2.id)!;
    assert.equal(m2Card.goalGate!.gate, "main-accept");
    assert.equal(m2Card.decisionStage, "ready-for-integration");
    assert.equal(m2Card.nextAction, "Main-accept gate is satisfied.");

    // Deterministic and privacy-safe.
    assert.deepEqual(projectWorkHierarchy(store, projectSurface), view);
    const serialized = JSON.stringify(view);
    assert.doesNotMatch(serialized, /SECRET_PROMPT|PRIVATE_LOG|sk-private-key|proxy:\/\/evil|resultText/);
  } finally {
    store.close();
  }
});

test("unsatisfied effective handoff successor stays non-complete; independent and one-off work unchanged", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-wh-handoff-fails-closed-"));
  const store = new StateStore(home);
  try {
    const original = taskRecord("ho-orig", { status: "queued", name: "Handoff original", project: "/tmp/handoff-project" });
    const successor = taskRecord("ho-succ", { status: "queued", name: "Handoff successor", project: "/tmp/handoff-project" });
    // Independent and one-off Tasks share the underlying machine-succeeded +
    // awaiting-Main-review facts of the Goal card so placement comparison is exact.
    const indep = taskRecord("ho-indep", { status: "succeeded", name: "Independent same stage", project: "/tmp/indep-project" });
    const oneOff = taskRecord("ho-oneoff", { status: "succeeded", name: "One-off same stage", project: "/tmp/oneoff-project" });

    const plan: PlanRecord = {
      id: "handoff-plan",
      name: "Handoff Plan",
      objective: "Successor fails closed",
      planFile: "/tmp/handoff-plan.yaml",
      createdAt: TS,
      updatedAt: TS,
    };
    const items: PlanItemRecord[] = [
      { id: "ho-item", planId: plan.id, taskId: original.id, itemIndex: 0, taskFile: original.taskFile },
    ];
    const milestones: GoalMilestoneRecord[] = [
      {
        goalId: "handoff-goal",
        itemId: "ho-item",
        taskId: original.id,
        gate: "machine",
        itemIndex: 0,
        satisfied: false,
        reasonCode: "waiting-machine",
        reason: "waiting",
        updatedAt: TS,
      },
    ];
    const goal: GoalRecord = {
      id: "handoff-goal",
      version: 1,
      name: "Handoff Goal",
      objective: "Successor authority",
      planId: plan.id,
      goalFile: "/tmp/handoff-goal.json",
      policy: {
        maxDurationMs: null,
        noProgressTimeoutMs: null,
        maxCorrectionRounds: 1,
        maxReviewRounds: 1,
        maxNoNewEvidenceCycles: 2,
      },
      status: "waiting",
      reasonCode: "waiting-machine",
      reason: "Waiting for machine verification success on this milestone.",
      evidenceDigest: "d".repeat(64),
      evidenceAt: TS,
      counters: { correctionRounds: 0, reviewRounds: 0, noNewEvidenceCycles: 0 },
      createdAt: TS,
      updatedAt: TS,
    };
    store.createPlanExecutionWithGoal(
      [{ task: original, creationEvent: { summary: "created", payload: {} } }],
      plan,
      items,
      [],
      goal,
      milestones,
    );
    const indepPlan: PlanRecord = {
      id: "handoff-indep-plan",
      name: "Independent Plan",
      objective: "No Goal parent",
      planFile: "/tmp/handoff-indep-plan.yaml",
      createdAt: TS,
      updatedAt: TS,
    };
    store.createTask(indep);
    store.createPlanGraph(
      indepPlan,
      [{ id: "indep-item", planId: indepPlan.id, taskId: indep.id, itemIndex: 0, taskFile: indep.taskFile }],
      [],
    );
    store.createTask(oneOff);

    // The original is machine-succeeded, but a durable Goal-Task handoff makes
    // the still-queued successor authoritative for the gate.
    seedMachineSucceeded(store, original.id);
    store.createCandidateHandoff({
      record: handoffRecord(
        "ho-handoff",
        { kind: "goal-task", goalId: "handoff-goal", itemId: "ho-item" },
        original.id,
        successor.id,
      ),
      task: successor,
      authorizationEvent: { summary: "handoff authorized", payload: {} },
    });

    const projectSurface = (task: TaskRecord): SafeTaskSummary => {
      if (task.id === oneOff.id || task.id === indep.id) {
        return summaryFor(task, "awaiting-main-review");
      }
      return summaryFor(task, "queued");
    };
    const view = projectWorkHierarchy(store, projectSurface);

    // The queued successor keeps the gate unsatisfied; the terminal original
    // record cannot paint the card complete.
    const card = findCard(view, "ho-succ")!;
    assert.equal(card.taskId, "ho-succ");
    assert.equal(card.breadcrumb.originalTaskId, "ho-orig");
    assert.equal(card.column, "ready");
    assert.equal(card.goalGate?.satisfied, false);
    assert.equal(card.goalGate?.reasonCode, "waiting-machine");
    assert.notEqual(card.column, "completed");
    assert.equal(findCard(view, "ho-orig"), undefined);

    // Independent Plan card with the same Task-wide stage keeps Task placement
    // and its Task-wide action policy (no Goal-gate override).
    const indepCard = findCard(view, "ho-indep")!;
    assert.equal(indepCard.breadcrumb.goalId, undefined);
    assert.equal(indepCard.goalGate, undefined);
    assert.equal(indepCard.column, "waiting-user-decision");
    assert.match(indepCard.actionPolicy.nextCheckpoint, /Main must review this Task/);
    assert.notEqual(
      indepCard.actionPolicy.nextCheckpoint,
      "This Plan item is complete for its Goal; no Goal action is required.",
    );

    // One-off card with the same Task-wide stage keeps Task placement.
    const oneOffCard = findCard(view, "ho-oneoff")!;
    assert.equal(oneOffCard.goalGate, undefined);
    assert.equal(oneOffCard.column, "waiting-user-decision");
    assert.match(oneOffCard.actionPolicy.nextCheckpoint, /Main must review this Task/);
  } finally {
    store.close();
  }
});

// ---------------------------------------------------------------------------
// FL-108C1: closed Work hierarchy narrative messages (additive, bilingual-ready)
// ---------------------------------------------------------------------------

const DEFAULT_GOAL_POLICY = {
  maxDurationMs: null,
  noProgressTimeoutMs: null,
  maxCorrectionRounds: 1,
  maxReviewRounds: 1,
  maxNoNewEvidenceCycles: 2,
} as const;

function seedMinimalGoal(
  store: StateStore,
  opts: {
    goalId: string;
    planId: string;
    status: GoalRecord["status"];
    reasonCode: GoalRecord["reasonCode"];
    reason: string;
    task: TaskRecord;
    itemId?: string;
    gate?: GoalMilestoneRecord["gate"];
    milestoneSatisfied?: boolean;
    milestoneReasonCode?: GoalMilestoneRecord["reasonCode"];
  },
): void {
  const itemId = opts.itemId ?? "m1";
  const plan: PlanRecord = {
    id: opts.planId,
    name: `Plan ${opts.planId}`,
    objective: "Narrative fixture",
    planFile: `/tmp/${opts.planId}.yaml`,
    createdAt: TS,
    updatedAt: TS,
  };
  const items: PlanItemRecord[] = [
    {
      id: itemId,
      planId: plan.id,
      taskId: opts.task.id,
      itemIndex: 0,
      taskFile: opts.task.taskFile,
    },
  ];
  const milestones: GoalMilestoneRecord[] = [
    {
      goalId: opts.goalId,
      itemId,
      taskId: opts.task.id,
      gate: opts.gate ?? "machine",
      itemIndex: 0,
      satisfied: opts.milestoneSatisfied ?? opts.status === "completed",
      reasonCode: opts.milestoneReasonCode
        ?? (opts.status === "completed" ? "none" : opts.reasonCode),
      reason: opts.reason,
      updatedAt: TS,
    },
  ];
  const goal: GoalRecord = {
    id: opts.goalId,
    version: 1,
    name: `Goal ${opts.goalId}`,
    objective: "Narrative",
    planId: plan.id,
    goalFile: `/tmp/${opts.goalId}.json`,
    policy: { ...DEFAULT_GOAL_POLICY },
    status: opts.status,
    reasonCode: opts.reasonCode,
    reason: opts.reason,
    evidenceDigest: "d".repeat(64),
    evidenceAt: TS,
    counters: { correctionRounds: 0, reviewRounds: 0, noNewEvidenceCycles: 0 },
    createdAt: TS,
    updatedAt: TS,
    ...(opts.status === "completed" ? { completedAt: TS } : {}),
    ...(opts.status === "stopped" ? { stoppedAt: TS } : {}),
  };
  store.createPlanExecutionWithGoal(
    [{ task: opts.task, creationEvent: { summary: "created", payload: {} } }],
    plan,
    items,
    [],
    goal,
    milestones,
  );
}

test("FL-108C1 coded messages cover Goal, Plan, Task, and one-off narration", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-wh-narrative-"));
  const store = new StateStore(home);
  try {
    // --- Completed Goal ---
    const doneTask = taskRecord("narr-done", {
      status: "succeeded",
      name: "Done task",
      project: "/tmp/narr-done",
    });
    seedMinimalGoal(store, {
      goalId: "narr-completed",
      planId: "narr-completed-plan",
      status: "completed",
      reasonCode: "goal-completed",
      reason: "Every milestone gate is satisfied.",
      task: doneTask,
      milestoneSatisfied: true,
      milestoneReasonCode: "none",
    });
    seedMachineSucceeded(store, doneTask.id);

    // --- Main-stopped Goal ---
    const stopTask = taskRecord("narr-stop", {
      status: "queued",
      name: "Stopped mid",
      project: "/tmp/narr-stop",
    });
    seedMinimalGoal(store, {
      goalId: "narr-main-stop",
      planId: "narr-stop-plan",
      status: "stopped",
      reasonCode: "main-stop",
      reason: "Main stopped this Goal. History remains readable; active Tasks use Task authority.",
      task: stopTask,
      milestoneSatisfied: false,
      milestoneReasonCode: "waiting-task",
    });

    // --- No-progress stopped Goal ---
    const npTask = taskRecord("narr-np", {
      status: "queued",
      name: "No progress",
      project: "/tmp/narr-np",
    });
    seedMinimalGoal(store, {
      goalId: "narr-no-progress",
      planId: "narr-np-plan",
      status: "stopped",
      reasonCode: "no-progress",
      reason: "No authoritative milestone evidence changed within the Goal no-progress window. Future Task admission is blocked; running Workers were not killed.",
      task: npTask,
      milestoneSatisfied: false,
      milestoneReasonCode: "waiting-machine",
    });

    // --- Cap-stopped Goal ---
    const capTask = taskRecord("narr-cap", {
      status: "queued",
      name: "Cap stop",
      project: "/tmp/narr-cap",
    });
    seedMinimalGoal(store, {
      goalId: "narr-cap",
      planId: "narr-cap-plan",
      status: "stopped",
      reasonCode: "correction-cap",
      reason: "Goal correction allowance is exhausted. Main must decide without another automatic correction.",
      task: capTask,
      milestoneSatisfied: false,
      milestoneReasonCode: "waiting-main-accept",
    });

    // --- Active first-milestone Goal (running card) ---
    const runTask = taskRecord("narr-run", {
      status: "running",
      name: "Active first",
      project: "/tmp/narr-run",
    });
    seedMinimalGoal(store, {
      goalId: "narr-active",
      planId: "narr-active-plan",
      status: "running",
      reasonCode: "waiting-machine",
      reason: "Waiting for machine verification success on this milestone.",
      task: runTask,
      milestoneSatisfied: false,
      milestoneReasonCode: "waiting-machine",
    });

    // --- Independent plan: completed names + extra, dependency waiting, failed ---
    const c1 = taskRecord("narr-c1", {
      status: "succeeded",
      name: "Alpha",
      project: "/tmp/narr-plan",
    });
    const c2 = taskRecord("narr-c2", {
      status: "succeeded",
      name: "Beta",
      project: "/tmp/narr-plan",
    });
    const c3 = taskRecord("narr-c3", {
      status: "succeeded",
      name: "Gamma",
      project: "/tmp/narr-plan",
    });
    const c4 = taskRecord("narr-c4", {
      status: "succeeded",
      name: "Delta",
      project: "/tmp/narr-plan",
    });
    const waitDep = taskRecord("narr-wait", {
      status: "queued",
      name: "Needs dep",
      project: "/tmp/narr-plan",
    });
    const failTask = taskRecord("narr-fail", {
      status: "failed",
      name: "Broken",
      project: "/tmp/narr-plan",
      error: "SECRET_PROMPT boom",
    });
    const verifyTask = taskRecord("narr-verify", {
      status: "verifying",
      name: "Verifying",
      project: "/tmp/narr-plan",
    });
    const readyTask = taskRecord("narr-ready", {
      status: "queued",
      name: "Ready one",
      project: "/tmp/narr-plan",
    });
    const indepPlan: PlanRecord = {
      id: "narr-indep-plan",
      name: "Indep narrative plan",
      objective: "Card coverage",
      planFile: "/tmp/narr-indep.yaml",
      createdAt: TS,
      updatedAt: TS,
    };
    const indepItems: PlanItemRecord[] = [
      { id: "a", planId: indepPlan.id, taskId: c1.id, itemIndex: 0, taskFile: c1.taskFile },
      { id: "b", planId: indepPlan.id, taskId: c2.id, itemIndex: 1, taskFile: c2.taskFile },
      { id: "c", planId: indepPlan.id, taskId: c3.id, itemIndex: 2, taskFile: c3.taskFile },
      { id: "d", planId: indepPlan.id, taskId: c4.id, itemIndex: 3, taskFile: c4.taskFile },
      { id: "w", planId: indepPlan.id, taskId: waitDep.id, itemIndex: 4, taskFile: waitDep.taskFile },
      { id: "f", planId: indepPlan.id, taskId: failTask.id, itemIndex: 5, taskFile: failTask.taskFile },
      { id: "v", planId: indepPlan.id, taskId: verifyTask.id, itemIndex: 6, taskFile: verifyTask.taskFile },
      { id: "r", planId: indepPlan.id, taskId: readyTask.id, itemIndex: 7, taskFile: readyTask.taskFile },
    ];
    const indepDeps: DependencyRecord[] = [
      { planId: indepPlan.id, itemId: "w", dependsOnItemId: "f" },
    ];
    for (const task of [c1, c2, c3, c4, waitDep, failTask, verifyTask, readyTask]) {
      store.createTask(task);
    }
    // Delivered outcomes for completed cards
    for (const task of [c1, c2, c3, c4]) {
      store.setTaskStatus(task.id, "succeeded", {
        error: null,
        finishedAt: TS,
      });
    }
    store.createPlanGraph(indepPlan, indepItems, indepDeps);

    // --- One-off waiting for Main decision ---
    const oneOff = taskRecord("narr-oneoff", {
      status: "succeeded",
      name: "One-off decide",
      project: "/tmp/narr-oneoff",
    });
    store.createTask(oneOff);

    const projectSurface = (task: TaskRecord): SafeTaskSummary => {
      if (task.id === doneTask.id || task.id === c1.id || task.id === c2.id
        || task.id === c3.id || task.id === c4.id) {
        return summaryFor(task, "delivered");
      }
      if (task.id === oneOff.id) return summaryFor(task, "awaiting-main-review");
      if (task.id === runTask.id) return summaryFor(task, "worker-running");
      if (task.id === verifyTask.id) return summaryFor(task, "queued");
      if (task.id === failTask.id) return summaryFor(task, "machine-failed");
      if (task.id === waitDep.id) return summaryFor(task, "queued");
      if (task.id === readyTask.id) return summaryFor(task, "queued");
      return summaryFor(task);
    };

    const view = projectWorkHierarchy(store, projectSurface);

    // Completed Goal messages
    const completedGoal = view.goals.find((g) => g.goalId === "narr-completed")!;
    assert.equal(completedGoal.summary.whatCompletedMessage?.code, "goal-what-completed");
    assert.equal(completedGoal.summary.blockerMessage?.code, "goal-wait-all-gates-satisfied");
    assert.equal(completedGoal.summary.nextActionMessage?.code, "goal-next-none");
    // Legacy compatibility strings remain
    assert.match(completedGoal.summary.whatCompleted, /Every milestone gate is satisfied/);
    assert.equal(completedGoal.summary.whatCompletedMessage?.code, "goal-what-completed");

    // Main-stopped Goal
    const stoppedGoal = view.goals.find((g) => g.goalId === "narr-main-stop")!;
    assert.equal(stoppedGoal.summary.whatCompletedMessage?.code, "goal-what-main-stop");
    assert.equal(stoppedGoal.summary.blockerMessage?.code, "goal-wait-admission-blocked");
    assert.equal(stoppedGoal.summary.nextActionMessage?.code, "goal-next-stop-or-decide");
    assert.match(stoppedGoal.summary.blocker, /Goal is stopped; future Task admission is blocked/);

    // No-progress stopped keeps reason distinction
    const npGoal = view.goals.find((g) => g.goalId === "narr-no-progress")!;
    assert.equal(npGoal.summary.whatCompletedMessage?.code, "goal-what-no-progress");
    assert.equal(npGoal.summary.blockerMessage?.code, "goal-wait-admission-blocked");

    // Cap-stopped keeps reason distinction
    const capGoal = view.goals.find((g) => g.goalId === "narr-cap")!;
    assert.equal(capGoal.summary.whatCompletedMessage?.code, "goal-what-correction-cap");
    assert.equal(capGoal.summary.blockerMessage?.code, "goal-wait-admission-blocked");

    // Active first milestone
    const activeGoal = view.goals.find((g) => g.goalId === "narr-active")!;
    assert.equal(activeGoal.summary.whatCompletedMessage?.code, "goal-what-started");
    assert.equal(activeGoal.summary.blockerMessage?.code, "goal-wait-machine");
    const runCard = findCard(view, "narr-run")!;
    assert.equal(runCard.column, "running");
    assert.equal(runCard.nextActionMessage?.code, "card-next-running");
    assert.equal(runCard.whatCompletedMessage?.code, "card-what-nothing");

    // Independent plan: completed-name aggregation with extra count
    const indep = view.independentPlans.find((p) => p.planId === "narr-indep-plan")!;
    assert.equal(indep.summary.whatCompletedMessage?.code, "lane-what-completed-names");
    assert.equal(indep.summary.whatCompletedMessage?.params?.extraCount, 1);
    assert.match(String(indep.summary.whatCompletedMessage?.params?.names ?? ""), /Alpha/);
    // Failed card recovery
    const failedCard = findCard(view, "narr-fail")!;
    assert.equal(failedCard.column, "stopped-failed");
    assert.equal(failedCard.nextActionMessage?.code, "card-next-needs-recovery");
    assert.equal(failedCard.whatCompletedMessage?.code, "card-what-nothing");
    // Dependency waiting (failed dep → dependency-failed blocker)
    const waitCard = findCard(view, "narr-wait")!;
    assert.equal(waitCard.column, "not-started");
    assert.equal(waitCard.nextActionMessage?.code, "card-next-waiting-prerequisite");
    assert.equal(waitCard.nextActionMessage?.params?.label, "Broken");
    // Verification
    const vCard = findCard(view, "narr-verify")!;
    assert.equal(vCard.column, "waiting-verification");
    assert.equal(vCard.nextActionMessage?.code, "card-next-waiting-verification");
    // Ready
    const rCard = findCard(view, "narr-ready")!;
    assert.equal(rCard.column, "ready");
    assert.equal(rCard.nextActionMessage?.code, "card-next-ready");
    // Completed delivered names preserved
    const alpha = findCard(view, "narr-c1")!;
    assert.equal(alpha.whatCompletedMessage?.code, "card-what-delivered");
    assert.equal(alpha.whatCompletedMessage?.params?.name, "Alpha");
    assert.equal(alpha.nextActionMessage?.code, "card-next-no-further-action");
    // Plan blocker uses failed card
    assert.equal(indep.summary.blockerMessage?.code, "lane-blocker-blocked");
    assert.equal(indep.summary.blockerMessage?.params?.label, "Broken");

    // One-off waiting for Main decision
    assert.ok(view.oneOffTasks);
    const oneOffCard = findCard(view, "narr-oneoff")!;
    assert.equal(oneOffCard.column, "waiting-user-decision");
    assert.equal(oneOffCard.nextActionMessage?.code, "card-next-waiting-main-decision");
    assert.equal(
      view.oneOffTasks!.summary.nextActionMessage?.code,
      "card-next-waiting-main-decision",
    );
    assert.match(view.oneOffTasks!.summary.nextAction, /Waiting for a Main decision/);

    // Filtered hierarchy recomputes lane messages from filtered cards only
    const filtered = projectWorkHierarchy(store, projectSurface, {
      project: "/tmp/narr-plan",
      column: "ready",
    });
    assert.equal(filtered.independentPlans.length, 1);
    const fPlan = filtered.independentPlans[0]!;
    assert.equal(fPlan.summary.progress.total, 1);
    assert.equal(fPlan.summary.progress.completed, 0);
    assert.equal(fPlan.summary.whatCompletedMessage?.code, "lane-what-none-completed");
    assert.equal(fPlan.summary.blockerMessage?.code, "lane-blocker-none");
    assert.equal(fPlan.summary.nextActionMessage?.code, "card-next-ready");
    // Goal-owned messages stay Goal authority even under filter
    const fActive = filtered.goals.find((g) => g.goalId === "narr-active");
    // Active goal has no ready cards under this project filter → hidden when filtered
    assert.equal(fActive, undefined);

    // No private leakage in messages
    const serialized = JSON.stringify(view);
    assert.doesNotMatch(serialized, /SECRET_PROMPT|PRIVATE_LOG|sk-private-key/);
    // Lifecycle unchanged
    assert.equal(store.getTask("narr-run").status, "running");
    assert.equal(store.getTask("narr-fail").status, "failed");
  } finally {
    store.close();
  }
});

test("FL-108C1 completed Goal gate cards expose coded gate-satisfied messages", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-wh-narr-gate-"));
  const store = new StateStore(home);
  try {
    const m1 = taskRecord("ng-m1", { status: "queued", name: "Gate machine", project: "/tmp/ng" });
    const plan: PlanRecord = {
      id: "ng-plan",
      name: "NG Plan",
      objective: "Gate narrative",
      planFile: "/tmp/ng-plan.yaml",
      createdAt: TS,
      updatedAt: TS,
    };
    const items: PlanItemRecord[] = [
      { id: "m1", planId: plan.id, taskId: m1.id, itemIndex: 0, taskFile: m1.taskFile },
    ];
    const milestones: GoalMilestoneRecord[] = [{
      goalId: "ng-goal",
      itemId: "m1",
      taskId: m1.id,
      gate: "machine",
      itemIndex: 0,
      satisfied: true,
      reasonCode: "none",
      reason: "satisfied",
      updatedAt: TS,
    }];
    const goal: GoalRecord = {
      id: "ng-goal",
      version: 1,
      name: "NG Goal",
      objective: "Gate",
      planId: plan.id,
      goalFile: "/tmp/ng-goal.json",
      policy: { ...DEFAULT_GOAL_POLICY },
      status: "completed",
      reasonCode: "goal-completed",
      reason: "Every milestone gate is satisfied.",
      evidenceDigest: "e".repeat(64),
      evidenceAt: TS,
      counters: { correctionRounds: 0, reviewRounds: 0, noNewEvidenceCycles: 0 },
      createdAt: TS,
      updatedAt: TS,
      completedAt: TS,
    };
    store.createPlanExecutionWithGoal(
      [{ task: m1, creationEvent: { summary: "created", payload: {} } }],
      plan,
      items,
      [],
      goal,
      milestones,
    );
    seedMachineSucceeded(store, m1.id);
    const view = projectWorkHierarchy(store, (task) => summaryFor(task, "awaiting-main-review"));
    const card = findCard(view, m1.id)!;
    assert.equal(card.column, "completed");
    assert.equal(card.whatCompletedMessage?.code, "card-what-goal-gate-complete");
    assert.equal(card.whatCompletedMessage?.params?.name, "Gate machine");
    assert.equal(card.whatCompletedMessage?.params?.gate, "machine");
    assert.equal(card.nextActionMessage?.code, "card-next-goal-gate-satisfied");
    assert.equal(card.nextActionMessage?.params?.gate, "machine");
    // Legacy string preserved for compatibility consumers
    assert.equal(card.nextAction, "Machine gate is satisfied.");
  } finally {
    store.close();
  }
});
