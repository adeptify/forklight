import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { BoardService, boardColumnForStatus, type BoardColumn } from "../src/core/board.js";
import { buildTaskRecord } from "../src/core/runner.js";
import { parseTaskSpec } from "../src/core/task.js";
import type { DependencyRecord, PlanItemRecord, PlanRecord, TaskRecord, TaskStatus } from "../src/core/types.js";
import { StateStore } from "../src/state/store.js";

function taskRecord(id: string, timestamp: string): TaskRecord {
  const spec = parseTaskSpec(
    {
      version: 1,
      name: id,
      project: "/tmp/source",
      goal: "Exercise board aggregation",
      acceptance: { commands: ["npm test"] },
    },
    "/tmp",
  );
  return buildTaskRecord({
    spec,
    taskFile: `/tmp/${id}.yaml`,
    home: "/tmp/forklight-home",
    id,
    sessionId: `session-${id}`,
    createdAt: timestamp,
  });
}

const mappings: Array<[TaskStatus | undefined, BoardColumn]> = [
  [undefined, "queued"],
  ["queued", "queued"],
  ["waiting", "queued"],
  ["preparing", "active"],
  ["running", "active"],
  ["verifying", "active"],
  ["blocked", "blocked"],
  ["failed", "failed"],
  ["interrupted", "failed"],
  ["succeeded", "completed"],
];

test("maps every task lifecycle status to one board column", () => {
  for (const [status, column] of mappings) assert.equal(boardColumnForStatus(status), column);
});

test("builds a deterministic mixed-state board with dependency evidence", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-board-"));
  const store = new StateStore(home);
  try {
    const timestamp = "2026-07-22T00:00:00.000Z";
    const states: TaskStatus[] = ["queued", "waiting", "running", "blocked", "failed", "succeeded"];
    const tasks = states.map((status) => taskRecord(`task-${status}`, timestamp));
    tasks.forEach((task, index) => {
      store.createTask(task);
      const status = states[index]!;
      if (status !== "queued") {
        store.setTaskStatus(task.id, status, status === "failed" ? { error: "Verifier failed" } : {});
      }
    });
    const plan: PlanRecord = {
      id: "mixed-plan",
      name: "Mixed board",
      objective: "Show every lifecycle group",
      planFile: "/tmp/mixed-plan.yaml",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const items: PlanItemRecord[] = tasks.map((task, itemIndex) => ({
      id: states[itemIndex]!,
      planId: plan.id,
      taskId: task.id,
      itemIndex,
      taskFile: task.taskFile,
    }));
    const dependencies: DependencyRecord[] = [
      { planId: plan.id, itemId: "waiting", dependsOnItemId: "blocked" },
      { planId: plan.id, itemId: "blocked", dependsOnItemId: "failed" },
      { planId: plan.id, itemId: "queued", dependsOnItemId: "succeeded" },
    ];
    store.createPlanGraph(plan, items, dependencies);

    const service = new BoardService(store);
    const first = service.getPlanBoard(plan.id);
    assert.deepEqual(service.getPlanBoard(plan.id), first);
    assert.deepEqual(first.plan.progress, {
      total: 6,
      completed: 1,
      active: 1,
      blocked: 1,
      failed: 1,
      queued: 2,
      waiting: 1,
      percent: 17,
    });
    assert.deepEqual(Object.values(first.columns).map((column) => column.length), [2, 1, 1, 1, 1]);
    assert.equal(Object.values(first.columns).flat().length, 6);
    assert.deepEqual(first.columns.queued[1]!.dependencies, [
      { itemId: "blocked", taskId: "task-blocked", taskStatus: "blocked", state: "failed" },
    ]);
    assert.deepEqual(first.columns.blocked[0]!.dependencies[0]?.state, "failed");
    assert.equal(first.columns.failed[0]!.error, "Verifier failed");
    assert.deepEqual(first.columns.completed[0]!.requiredBy, ["queued"]);
    assert.deepEqual(service.listPlanBoards(), [first.plan]);
    assert.equal(store.getTask("task-running").status, "running");
  } finally {
    store.close();
  }
});

test("returns an empty overview and clamps the requested plan limit", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-board-empty-"));
  const store = new StateStore(home);
  try {
    const service = new BoardService(store);
    assert.deepEqual(service.listPlanBoards(), []);
    assert.deepEqual(service.listPlanBoards(0), []);
  } finally {
    store.close();
  }
});
