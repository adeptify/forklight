/**
 * FL-109G5: read-only Goal > Plan > Task hierarchy CLI observers.
 *
 * Proves `forklight work-hierarchy` and `forklight task-plan-context` through
 * real CLI processes against an isolated real daemon and Store:
 * - nested human rendering that never flattens Goal/Plan/Task into peers,
 * - exact daemon JSON projection with filters mapped to the allowlisted fields,
 * - truthful standalone-Task Plan context with bounded named dependency edges,
 * - invalid arguments fail before daemon contact,
 * - stopped-daemon observation fails clearly without starting a daemon.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildTaskRecord } from "../src/core/runner.js";
import { parseTaskSpec } from "../src/core/task.js";
import { daemonLogPath, daemonSocketPath } from "../src/core/config.js";
import { DAEMON_OBSERVER_UNAVAILABLE_MESSAGE, daemonRequest } from "../src/daemon/client.js";
import { ForkLightDaemon } from "../src/daemon/server.js";
import { StateStore } from "../src/state/store.js";
import type {
  DependencyRecord,
  GoalMilestoneRecord,
  GoalRecord,
  PlanItemRecord,
  PlanRecord,
  TaskRecord,
  TaskStatus,
} from "../src/core/types.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TS = "2026-08-05T10:00:00.000Z";

function cliArgs(...args: string[]): string[] {
  return [
    "--disable-warning=ExperimentalWarning",
    "--import",
    "tsx",
    path.join(root, "src", "cli.ts"),
    ...args,
  ];
}

async function runCli(
  home: string,
  args: string[],
  timeoutMs = 20_000,
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const result = await execFileAsync(process.execPath, cliArgs(...args), {
      cwd: root,
      env: { ...process.env, FORKLIGHT_HOME: home },
      timeout: timeoutMs,
    });
    return { stdout: result.stdout, stderr: result.stderr, code: 0 };
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      code: typeof execError.code === "number" ? execError.code : 1,
    };
  }
}

function taskRecord(
  id: string,
  opts: {
    status?: TaskStatus;
    project?: string;
    workerProfileId?: string;
    name?: string;
  } = {},
): TaskRecord {
  const spec = parseTaskSpec(
    {
      version: 1,
      name: opts.name ?? id,
      project: opts.project ?? "/tmp/project",
      goal: "Hierarchy CLI fixture",
      acceptance: { commands: ["npm test"] },
    },
    "/tmp",
  );
  if (opts.workerProfileId !== undefined) {
    (spec as { workerProfileId?: string }).workerProfileId = opts.workerProfileId;
  }
  const base = buildTaskRecord({
    spec,
    taskFile: `/tmp/${id}.yaml`,
    home: "/tmp/forklight-home",
    id,
    sessionId: `session-${id}`,
    createdAt: TS,
  });
  return { ...base, status: opts.status ?? "queued", updatedAt: TS };
}

interface HierarchyFixture {
  home: string;
  goalId: string;
  goalPlanId: string;
  independentPlanId: string;
  goalReady: string;
  goalHeld: string;
  goalFailed: string;
  independent: string;
  oneOff: string;
}

/**
 * Seed one isolated home with a Goal-owned Plan (ready / dependency-held /
 * stopped-failed cards), an independent Plan, and a standalone one-off Task.
 * The daemon must be started with maxConcurrency 0 so queued plan Tasks are
 * never admitted into a Worker launch; observation still proves truthful
 * hierarchy projection from the same authoritative daemon.
 */
async function seedHierarchyHome(): Promise<HierarchyFixture> {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-hierarchy-cli-"));
  const store = new StateStore(home);
  try {
    const goalReady = taskRecord("hc-goal-ready", {
      status: "queued",
      name: "Goal Ready",
      project: "/tmp/goal-project",
      workerProfileId: "grok-builder",
    });
    const goalHeld = taskRecord("hc-goal-held", {
      status: "queued",
      name: "Goal Held",
      project: "/tmp/goal-project",
      workerProfileId: "deepseek-builder",
    });
    const goalFailed = taskRecord("hc-goal-failed", {
      status: "failed",
      name: "Goal Failed",
      project: "/tmp/goal-project",
      workerProfileId: "deepseek-builder",
    });
    const goalPlan: PlanRecord = {
      id: "hc-goal-plan",
      name: "Goal Plan",
      objective: "Owned Plan",
      planFile: "/tmp/hc-goal-plan.yaml",
      createdAt: TS,
      updatedAt: TS,
    };
    const goalItems: PlanItemRecord[] = [
      { id: "g1", planId: goalPlan.id, taskId: goalReady.id, itemIndex: 0, taskFile: goalReady.taskFile },
      { id: "g2", planId: goalPlan.id, taskId: goalHeld.id, itemIndex: 1, taskFile: goalHeld.taskFile },
      { id: "g3", planId: goalPlan.id, taskId: goalFailed.id, itemIndex: 2, taskFile: goalFailed.taskFile },
    ];
    const goalDeps: DependencyRecord[] = [
      { planId: goalPlan.id, itemId: "g2", dependsOnItemId: "g1" },
    ];
    const goal: GoalRecord = {
      id: "hc-goal",
      version: 1,
      name: "Hierarchy Goal",
      objective: "Prove CLI hierarchy",
      planId: goalPlan.id,
      goalFile: "/tmp/hc-goal.json",
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
      updatedAt: TS,
    };
    const milestones: GoalMilestoneRecord[] = goalItems.map((item) => ({
      goalId: goal.id,
      itemId: item.id,
      // exactOptionalPropertyTypes: never pass undefined for an optional field.
      ...(item.taskId === undefined ? {} : { taskId: item.taskId }),
      gate: "machine" as const,
      itemIndex: item.itemIndex,
      satisfied: false,
      reasonCode: "waiting-machine" as const,
      reason: "waiting",
      updatedAt: TS,
    }));
    store.createPlanExecutionWithGoal(
      [goalReady, goalHeld, goalFailed].map((task) => ({
        task,
        creationEvent: { summary: `Task created: ${task.name}`, payload: {} },
      })),
      goalPlan,
      goalItems,
      goalDeps,
      goal,
      milestones,
    );

    const independent = taskRecord("hc-indep", {
      status: "queued",
      name: "Independent",
      project: "/tmp/indep-project",
      workerProfileId: "grok-builder",
    });
    const independentPlan: PlanRecord = {
      id: "hc-indep-plan",
      name: "Independent Plan",
      objective: "No Goal parent",
      planFile: "/tmp/hc-indep-plan.yaml",
      createdAt: TS,
      updatedAt: TS,
    };
    store.createTask(independent);
    store.createPlanGraph(
      independentPlan,
      [
        {
          id: "i1",
          planId: independentPlan.id,
          taskId: independent.id,
          itemIndex: 0,
          taskFile: independent.taskFile,
        },
      ],
      [],
    );

    const oneOff = taskRecord("hc-oneoff", {
      status: "queued",
      name: "Standalone",
      project: "/tmp/oneoff-project",
      workerProfileId: "deepseek-builder",
    });
    store.createTask(oneOff);

    return {
      home,
      goalId: goal.id,
      goalPlanId: goalPlan.id,
      independentPlanId: independentPlan.id,
      goalReady: goalReady.id,
      goalHeld: goalHeld.id,
      goalFailed: goalFailed.id,
      independent: independent.id,
      oneOff: oneOff.id,
    };
  } finally {
    store.close();
  }
}

/** Deterministic Store snapshot used as before/after read-only evidence. */
interface StoreSnapshot {
  tasks: Array<{ id: string; status: string; updatedAt: string }>;
  eventsByTask: Record<string, number>;
  planCount: number;
  receiptCount: number;
}

function snapshotStore(home: string): StoreSnapshot {
  const store = new StateStore(home);
  try {
    const tasks = store.listTasks().map((task) => ({
      id: task.id,
      status: task.status,
      updatedAt: task.updatedAt,
    }));
    const eventsByTask: Record<string, number> = {};
    let receiptCount = 0;
    for (const task of store.listTasks()) {
      eventsByTask[task.id] = store.listEvents(task.id).length;
      receiptCount += store.listExchangeReceipts(task.id).length;
    }
    return {
      tasks,
      eventsByTask,
      planCount: store.listPlans().length,
      receiptCount,
    };
  } finally {
    store.close();
  }
}

/** Prove an observation left every Store row and the daemon PID untouched. */
async function assertObservationReadOnly(
  home: string,
  before: StoreSnapshot,
  pidBefore: number,
): Promise<void> {
  assert.deepEqual(snapshotStore(home), before, "observer must not mutate Store state");
  const health = await daemonRequest<Record<string, unknown>>("health", {}, home);
  assert.equal(health.pid, pidBefore, "observer must not replace the daemon PID");
}

/** Strip the time-varying per-card progress cursor so the deterministic daemon
 *  projection is directly comparable between two independent daemon calls. */
function stripCardProgress(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripCardProgress);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
      if (key === "progress" && "column" in record && "taskId" in record) continue;
      out[key] = stripCardProgress(child);
    }
    return out;
  }
  return value;
}

function findCard(
  view: Record<string, unknown>,
  taskId: string,
): Record<string, unknown> | undefined {
  const all: unknown[] = [];
  for (const goal of (view.goals as Record<string, unknown>[]) ?? []) {
    for (const plan of (goal.plans as Record<string, unknown>[]) ?? []) {
      for (const column of Object.values(plan.columns as Record<string, unknown[]>)) {
        all.push(...column);
      }
    }
  }
  for (const plan of (view.independentPlans as Record<string, unknown>[]) ?? []) {
    for (const column of Object.values(plan.columns as Record<string, unknown[]>)) {
      all.push(...column);
    }
  }
  const oneOff = view.oneOffTasks as Record<string, unknown> | undefined;
  if (oneOff !== undefined) {
    for (const column of Object.values(oneOff.columns as Record<string, unknown[]>)) {
      all.push(...column);
    }
  }
  return all.find((card) => (card as { taskId?: unknown }).taskId === taskId) as
    | Record<string, unknown>
    | undefined;
}

// ---------------------------------------------------------------------------
// Nested hierarchy + exact JSON through a real daemon
// ---------------------------------------------------------------------------

test("work-hierarchy CLI renders nested Goal→Plan→Task and the exact daemon JSON", async () => {
  const fixture = await seedHierarchyHome();
  const daemon = new ForkLightDaemon(fixture.home, 0);
  await daemon.start();
  try {
    const human = await runCli(fixture.home, ["work-hierarchy"]);
    assert.equal(human.code, 0, human.stderr);
    // Goal lane is the ancestor; Plan is nested under it; cards under columns.
    assert.match(human.stdout, /^Goal: Hierarchy Goal \(id=hc-goal\)/m);
    assert.match(human.stdout, /^  Plan: Goal Plan \(id=hc-goal-plan\)$/m);
    assert.match(human.stdout, /^    \[ready\] \(1\)$/m);
    assert.match(human.stdout, /^      hc-goal-ready  Goal Ready  Ready to run when a Worker slot is available\.$/m);
    // Dependency-held work is a truthful not-started card, never a ready card.
    assert.match(human.stdout, /^    \[not-started\] \(1\)$/m);
    assert.match(human.stdout, /^      hc-goal-held  Goal Held  Waiting on prerequisite: Goal Ready\.$/m);
    // The held card must not appear under [ready].
    const readyBlock = human.stdout.slice(human.stdout.indexOf("[ready]"));
    assert.ok(!readyBlock.slice(0, readyBlock.indexOf("\n[")).includes("hc-goal-held"));
    // Stopped/failed card in the Goal's Plan column.
    assert.match(human.stdout, /^    \[stopped\/failed\] \(1\)$/m);
    assert.match(human.stdout, /^      hc-goal-failed  Goal Failed  Needs Main attention or recovery\.$/m);
    // Independent Plan and one-off lanes are their own truthful lanes.
    assert.match(human.stdout, /^Independent Plan: Independent Plan \(id=hc-indep-plan\)$/m);
    assert.match(human.stdout, /^    hc-indep  Independent  Ready to run when a Worker slot is available\.$/m);
    assert.match(human.stdout, /^One-off Tasks:$/m);
    assert.match(human.stdout, /^    hc-oneoff  Standalone  Ready to run when a Worker slot is available\.$/m);
    // Nesting order: the Goal card block, then Plan, then Task cards.
    const goalIndex = human.stdout.indexOf("Goal: Hierarchy Goal");
    const planIndex = human.stdout.indexOf("  Plan: Goal Plan");
    const cardIndex = human.stdout.indexOf("      hc-goal-ready");
    assert.ok(goalIndex >= 0 && planIndex > goalIndex && cardIndex > planIndex);
    // No blank parent placeholders: independent and one-off lanes stay parentless.
    assert.ok(!human.stdout.includes("Plan:  ") && !human.stdout.includes("Goal:  "));

    // --- Exact JSON projection ---
    const first = await runCli(fixture.home, ["work-hierarchy", "--json"]);
    assert.equal(first.code, 0, first.stderr);
    const view = JSON.parse(first.stdout) as Record<string, unknown>;
    assert.equal(view.schemaVersion, 1);
    const goalLane = (view.goals as Record<string, unknown>[])[0]!;
    assert.equal(goalLane.goalId, "hc-goal");
    const planLane = (goalLane.plans as Record<string, unknown>[])[0]!;
    assert.equal(planLane.planId, "hc-goal-plan");
    const columns = planLane.columns as Record<string, unknown[]>;
    assert.ok(columns.ready!.some((card) => (card as { taskId?: unknown }).taskId === "hc-goal-ready"));
    assert.ok(columns["not-started"]!.some((card) => (card as { taskId?: unknown }).taskId === "hc-goal-held"));
    assert.ok(columns["stopped-failed"]!.some((card) => (card as { taskId?: unknown }).taskId === "hc-goal-failed"));
    const heldCard = findCard(view, "hc-goal-held")!;
    assert.equal(heldCard.column, "not-started");
    assert.equal(heldCard.placementReason, "dependency-unsatisfied");
    const deps = heldCard.namedDependencies as Array<Record<string, unknown>>;
    assert.equal(deps[0]?.taskName, "Goal Ready");
    const independentPlans = view.independentPlans as Record<string, unknown>[];
    assert.equal(independentPlans[0]?.planId, "hc-indep-plan");
    const oneOff = view.oneOffTasks as Record<string, unknown> | undefined;
    assert.ok(oneOff !== undefined);
    const oneOffCards = oneOff.columns as Record<string, unknown[]>;
    assert.ok(oneOffCards.ready!.some((card) => (card as { taskId?: unknown }).taskId === "hc-oneoff"));
    const oneOffCard = findCard(view, "hc-oneoff")!;
    const breadcrumb = oneOffCard.breadcrumb as Record<string, unknown>;
    assert.equal(breadcrumb.goalId, undefined);
    assert.equal(breadcrumb.planId, undefined);
    assert.deepEqual(view.filter, { applied: {} });

    // Deterministic: a second CLI invocation is byte-identical.
    const second = await runCli(fixture.home, ["work-hierarchy", "--json"]);
    assert.equal(second.code, 0, second.stderr);
    assert.equal(second.stdout, first.stdout, "hierarchy JSON must be deterministic");

    // Exact daemon projection: the CLI returns the daemon's object, not a
    // CLI-computed view (compared modulo the time-varying progress cursor).
    const direct = await daemonRequest<Record<string, unknown>>("work_hierarchy", {}, fixture.home);
    assert.deepEqual(
      stripCardProgress(JSON.parse(first.stdout)),
      stripCardProgress(direct),
      "CLI JSON must be the existing daemon projection",
    );

    // Observation never mutates Store state and never replaces the daemon.
    const pidBefore = (await daemonRequest<Record<string, unknown>>("health", {}, fixture.home)).pid as number;
    const before = snapshotStore(fixture.home);
    const repeated = await runCli(fixture.home, ["work-hierarchy", "--json"]);
    assert.equal(repeated.code, 0, repeated.stderr);
    await assertObservationReadOnly(fixture.home, before, pidBefore);
  } finally {
    await daemon.close();
    await rm(fixture.home, { recursive: true, force: true }).catch(() => undefined);
  }
});

// ---------------------------------------------------------------------------
// Filters map to the daemon's exact allowlisted fields
// ---------------------------------------------------------------------------

test("work-hierarchy filters map to the daemon's allowlisted project/column/workerProfileId fields", async () => {
  const fixture = await seedHierarchyHome();
  const daemon = new ForkLightDaemon(fixture.home, 0);
  await daemon.start();
  try {
    const projectColumn = await runCli(fixture.home, [
      "work-hierarchy", "--project", "/tmp/goal-project", "--column", "ready", "--json",
    ]);
    assert.equal(projectColumn.code, 0, projectColumn.stderr);
    const projectView = JSON.parse(projectColumn.stdout) as Record<string, unknown>;
    assert.deepEqual(projectView.filter, {
      applied: { project: "/tmp/goal-project", columns: ["ready"] },
    });
    const goalLane = (projectView.goals as Record<string, unknown>[])[0]!;
    assert.equal(goalLane.goalId, "hc-goal");
    const planColumns = (goalLane.plans as Record<string, unknown>[])[0]!.columns as Record<string, unknown[]>;
    assert.equal(planColumns.ready!.length, 1);
    assert.equal((planColumns.ready![0] as { taskId?: unknown }).taskId, "hc-goal-ready");
    assert.equal((projectView.independentPlans as Record<string, unknown>[]).length, 0);
    assert.equal(projectView.oneOffTasks, undefined);

    const commaColumn = await runCli(fixture.home, [
      "work-hierarchy", "--column", "ready,not-started", "--json",
    ]);
    assert.equal(commaColumn.code, 0, commaColumn.stderr);
    const commaView = JSON.parse(commaColumn.stdout) as Record<string, unknown>;
    assert.deepEqual(commaView.filter, {
      applied: { columns: ["ready", "not-started"] },
    });

    const workerFilter = await runCli(fixture.home, [
      "work-hierarchy", "--worker-profile", "grok-builder", "--json",
    ]);
    assert.equal(workerFilter.code, 0, workerFilter.stderr);
    const workerView = JSON.parse(workerFilter.stdout) as Record<string, unknown>;
    assert.deepEqual(workerView.filter, { applied: { workerProfileId: "grok-builder" } });
    // The Goal ancestor stays intact for its grok-builder card, and the
    // independent Plan card is retained; the deepseek one-off is filtered out.
    const workerGoal = (workerView.goals as Record<string, unknown>[])[0]!;
    assert.equal(workerGoal.goalId, "hc-goal");
    const workerPlanColumns = (workerGoal.plans as Record<string, unknown>[])[0]!.columns as Record<string, unknown[]>;
    assert.equal(workerPlanColumns.ready!.length, 1);
    assert.equal((workerPlanColumns.ready![0] as { taskId?: unknown }).taskId, "hc-goal-ready");
    const workerIndependent = (workerView.independentPlans as Record<string, unknown>[])[0]!;
    assert.equal(workerIndependent.planId, "hc-indep-plan");
    const workerCards = workerIndependent.columns as Record<string, unknown[]>;
    assert.equal((workerCards.ready![0] as { taskId?: unknown }).taskId, "hc-indep");
    assert.equal(workerView.oneOffTasks, undefined);

    // Invalid column fails closed with the Core privacy-safe reason, no mutation.
    const pidBefore = (await daemonRequest<Record<string, unknown>>("health", {}, fixture.home)).pid as number;
    const before = snapshotStore(fixture.home);
    const invalid = await runCli(fixture.home, ["work-hierarchy", "--column", "bogus"]);
    assert.notEqual(invalid.code, 0);
    assert.match(invalid.stderr, /Work hierarchy filter is invalid\./);
    await assertObservationReadOnly(fixture.home, before, pidBefore);
  } finally {
    await daemon.close();
    await rm(fixture.home, { recursive: true, force: true }).catch(() => undefined);
  }
});

// ---------------------------------------------------------------------------
// Task Plan context: membership, edges, and standalone truth
// ---------------------------------------------------------------------------

test("task-plan-context CLI shows Plan membership, direct edges, and standalone truth", async () => {
  const fixture = await seedHierarchyHome();
  const daemon = new ForkLightDaemon(fixture.home, 0);
  await daemon.start();
  try {
    const pidBefore = (await daemonRequest<Record<string, unknown>>("health", {}, fixture.home)).pid as number;
    const before = snapshotStore(fixture.home);

    // Plan member with a direct prerequisite: JSON projection.
    const held = await runCli(fixture.home, ["task-plan-context", "hc-goal-held", "--json"]);
    assert.equal(held.code, 0, held.stderr);
    const heldBody = JSON.parse(held.stdout) as Record<string, unknown>;
    assert.equal(heldBody.planId, "hc-goal-plan");
    assert.equal(heldBody.planName, "Goal Plan");
    assert.equal(heldBody.itemId, "g2");
    assert.equal(heldBody.itemIndex, 1);
    const heldDeps = heldBody.namedDependencies as Array<Record<string, unknown>>;
    assert.equal(heldDeps.length, 1);
    assert.equal(heldDeps[0]!.taskName, "Goal Ready");
    assert.equal(heldDeps[0]!.itemId, "g1");
    assert.equal(heldDeps[0]!.state, "waiting");
    assert.deepEqual(heldBody.namedRequiredBy, []);

    // Human rendering names the Plan, position, prerequisite, and dependents.
    const heldHuman = await runCli(fixture.home, ["task-plan-context", "hc-goal-held"]);
    assert.equal(heldHuman.code, 0, heldHuman.stderr);
    assert.match(heldHuman.stdout, /^Task: hc-goal-held$/m);
    assert.match(heldHuman.stdout, /^Plan: Goal Plan \(id=hc-goal-plan\)$/m);
    assert.match(heldHuman.stdout, /^position: item g2 \(index 1\)$/m);
    assert.match(heldHuman.stdout, /^prerequisites: 1$/m);
    assert.match(heldHuman.stdout, /^  Goal Ready \(waiting\)  id=g1 task=hc-goal-ready$/m);
    assert.match(heldHuman.stdout, /^dependents: 0$/m);

    // Reverse edge: the ready task is a direct dependent of nothing, and has
    // the held Task as its direct dependent.
    const ready = await runCli(fixture.home, ["task-plan-context", "hc-goal-ready", "--json"]);
    assert.equal(ready.code, 0, ready.stderr);
    const readyBody = JSON.parse(ready.stdout) as Record<string, unknown>;
    assert.deepEqual(readyBody.namedDependencies, []);
    const readyRequiredBy = readyBody.namedRequiredBy as Array<Record<string, unknown>>;
    assert.equal(readyRequiredBy.length, 1);
    assert.equal(readyRequiredBy[0]!.taskName, "Goal Held");
    assert.equal(readyRequiredBy[0]!.itemId, "g2");

    // Standalone Task: JSON is null, human explains the standalone state.
    const standalone = await runCli(fixture.home, ["task-plan-context", "hc-oneoff", "--json"]);
    assert.equal(standalone.code, 0, standalone.stderr);
    assert.equal(standalone.stdout.trim(), "null");
    const standaloneHuman = await runCli(fixture.home, ["task-plan-context", "hc-oneoff"]);
    assert.equal(standaloneHuman.code, 0, standaloneHuman.stderr);
    assert.match(standaloneHuman.stdout, /hc-oneoff is standalone — it belongs to no Plan\./);

    // Read-only: no Store mutation, no daemon replacement.
    await assertObservationReadOnly(fixture.home, before, pidBefore);
  } finally {
    await daemon.close();
    await rm(fixture.home, { recursive: true, force: true }).catch(() => undefined);
  }
});

// ---------------------------------------------------------------------------
// Never start a stopped daemon; invalid args fail before daemon contact
// ---------------------------------------------------------------------------

test("work-hierarchy and task-plan-context never start a stopped daemon", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-hierarchy-observer-absent-"));
  try {
    for (const args of [
      ["work-hierarchy"],
      ["work-hierarchy", "--json"],
      ["task-plan-context", "hc-oneoff"],
    ]) {
      const result = await runCli(home, args);
      assert.notEqual(result.code, 0, `${args.join(" ")} must fail when no daemon runs`);
      assert.match(
        result.stderr,
        new RegExp(DAEMON_OBSERVER_UNAVAILABLE_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        "observer must emit bounded transition/stopped guidance",
      );
      assert.match(result.stderr, /never starts a daemon/i);
      assert.equal(existsSync(daemonSocketPath(home)), false, "observer must not create a socket");
      assert.equal(
        existsSync(daemonLogPath(home)),
        false,
        "observer must not spawn a detached daemon",
      );
    }
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("invalid hierarchy observer arguments fail before daemon contact", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-hierarchy-cli-args-"));
  try {
    const cases: Array<{ args: string[]; pattern: RegExp }> = [
      {
        args: ["work-hierarchy", "--bogus"],
        pattern: /work-hierarchy: unknown argument: --bogus/,
      },
      {
        args: ["work-hierarchy", "--project"],
        pattern: /work-hierarchy: --project requires a value/,
      },
      {
        args: ["work-hierarchy", "--column", "ready", "--column", "running"],
        pattern: /work-hierarchy: duplicate flag: --column/,
      },
      {
        args: ["work-hierarchy", "--json", "stray-positional"],
        pattern: /work-hierarchy: unexpected argument: stray-positional/,
      },
      {
        args: ["task-plan-context"],
        pattern: /Missing task id/,
      },
      {
        args: ["task-plan-context", "hc-oneoff", "--unknown"],
        pattern: /task-plan-context: unknown argument: --unknown/,
      },
    ];
    for (const { args, pattern } of cases) {
      const result = await runCli(home, args);
      assert.notEqual(result.code, 0, `${args.join(" ")} must fail`);
      assert.match(result.stderr, pattern, result.stderr);
      assert.equal(
        existsSync(daemonSocketPath(home)),
        false,
        `${args.join(" ")} must not start a daemon`,
      );
      assert.equal(
        existsSync(daemonLogPath(home)),
        false,
        `${args.join(" ")} must not spawn a daemon`,
      );
    }
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});
