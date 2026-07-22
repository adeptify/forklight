import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildTaskRecord } from "../src/core/runner.js";
import { parseTaskSpec } from "../src/core/task.js";
import type {
  DependencyRecord,
  PlanItemRecord,
  PlanRecord,
  TaskRecord,
} from "../src/core/types.js";
import { StateStore } from "../src/state/store.js";

function queuedTask(id: string, timestamp: string): TaskRecord {
  const spec = parseTaskSpec(
    {
      version: 1,
      name: id,
      project: "/tmp/source",
      goal: "Persist this staged task",
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

test("a resumed task clears stale terminal fields when it starts and succeeds", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-store-"));
  const store = new StateStore(home);
  const now = new Date().toISOString();
  const record = {
    id: "task-1",
    name: "State transition",
    status: "interrupted",
    sourcePath: "/tmp/source",
    taskFile: "/tmp/task.yaml",
    spec: {},
    paths: {},
    sessionId: "session-1",
    workerPid: 123,
    createdAt: now,
    updatedAt: now,
    finishedAt: now,
    error: "interrupted",
  } as unknown as TaskRecord;
  store.createTask(record);
  const running = store.setTaskStatus(record.id, "running", {
    error: null,
    finishedAt: null,
    workerPid: null,
  });
  assert.equal(running.error, undefined);
  assert.equal(running.finishedAt, undefined);
  assert.equal(running.workerPid, undefined);

  const succeeded = store.setTaskStatus(record.id, "succeeded", {
    finishedAt: now,
    error: null,
  });
  assert.equal(succeeded.status, "succeeded");
  assert.equal(succeeded.error, undefined);
  store.close();
});

test("plan graph round trip preserves explicit dependency direction", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-store-"));
  const timestamp = new Date().toISOString();
  const plan: PlanRecord = {
    id: "plan-round-trip",
    name: "Round trip",
    objective: "Preserve the graph",
    planFile: "/tmp/plan.yaml",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const items: PlanItemRecord[] = [
    { id: "foundation", planId: plan.id, itemIndex: 0, taskFile: "/tmp/foundation.yaml" },
    { id: "console", planId: plan.id, itemIndex: 1, taskFile: "/tmp/console.yaml" },
    { id: "statistics", planId: plan.id, itemIndex: 2, taskFile: "/tmp/statistics.yaml" },
  ];
  const dependencies: DependencyRecord[] = [
    { planId: plan.id, itemId: "console", dependsOnItemId: "foundation" },
    { planId: plan.id, itemId: "statistics", dependsOnItemId: "foundation" },
  ];

  const first = new StateStore(home);
  first.createPlanGraph(plan, items, dependencies);
  first.close();

  const reopened = new StateStore(home);
  assert.deepEqual(reopened.getPlan(plan.id), plan);
  assert.deepEqual(reopened.getPlanItems(plan.id), items);
  assert.deepEqual(reopened.getDependencies(plan.id), dependencies);
  assert.deepEqual(reopened.getDirectDependencies(plan.id, "console"), ["foundation"]);
  assert.deepEqual(reopened.getDirectDependents(plan.id, "foundation"), ["console", "statistics"]);
  assert.deepEqual(
    reopened.getPlanItemStatuses(plan.id).map((status) => status.itemId),
    ["foundation", "console", "statistics"],
  );
  reopened.close();
});

test("plan graph creation rolls back all rows when one item is invalid", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-store-"));
  const timestamp = new Date().toISOString();
  const plan: PlanRecord = {
    id: "plan-rollback",
    name: "Rollback",
    objective: "Remain atomic",
    planFile: "/tmp/rollback.yaml",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const store = new StateStore(home);
  assert.throws(
    () =>
      store.createPlanGraph(
        plan,
        [
          {
            id: "invalid-item",
            planId: plan.id,
            taskId: "missing-task",
            itemIndex: 0,
            taskFile: "/tmp/invalid.yaml",
          },
        ],
        [],
      ),
    /FOREIGN KEY constraint failed/,
  );
  assert.deepEqual(store.listPlans(), []);
  store.close();
});

test("plan execution atomically persists staged tasks, events, and graph rows", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-store-"));
  const timestamp = new Date().toISOString();
  const tasks = [queuedTask("task-foundation", timestamp), queuedTask("task-console", timestamp)];
  const plan: PlanRecord = {
    id: "plan-execution",
    name: "Execution",
    objective: "Persist all staged records",
    planFile: "/tmp/execution.yaml",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const items: PlanItemRecord[] = [
    { id: "foundation", planId: plan.id, taskId: tasks[0]!.id, itemIndex: 0, taskFile: tasks[0]!.taskFile },
    { id: "console", planId: plan.id, taskId: tasks[1]!.id, itemIndex: 1, taskFile: tasks[1]!.taskFile },
  ];
  const dependencies: DependencyRecord[] = [
    { planId: plan.id, itemId: "console", dependsOnItemId: "foundation" },
  ];
  const store = new StateStore(home);

  store.createPlanExecution(
    tasks.map((task) => ({
      task,
      creationEvent: { summary: `Task created: ${task.name}`, payload: { taskFile: task.taskFile } },
    })),
    plan,
    items,
    dependencies,
  );

  assert.deepEqual(store.listTasks().map((task) => task.id).sort(), tasks.map((task) => task.id).sort());
  assert.deepEqual(store.listEvents(tasks[0]!.id).map((event) => event.type), ["task.created"]);
  assert.deepEqual(store.listEvents(tasks[1]!.id)[0]!.payload, { taskFile: tasks[1]!.taskFile });
  assert.deepEqual(store.getPlan(plan.id), plan);
  assert.deepEqual(store.getPlanItems(plan.id), items);
  assert.deepEqual(store.getDependencies(plan.id), dependencies);
  store.close();
});

test("plan execution rolls back every staged row after a relational failure", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-store-"));
  const timestamp = new Date().toISOString();
  const tasks = [queuedTask("task-one", timestamp), queuedTask("task-two", timestamp)];
  const plan: PlanRecord = {
    id: "plan-execution-rollback",
    name: "Execution rollback",
    objective: "Leave no partial rows",
    planFile: "/tmp/execution-rollback.yaml",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const store = new StateStore(home);

  assert.throws(
    () =>
      store.createPlanExecution(
        tasks.map((task) => ({ task, creationEvent: { summary: `Task created: ${task.name}` } })),
        plan,
        [
          { id: "one", planId: plan.id, taskId: tasks[0]!.id, itemIndex: 0, taskFile: tasks[0]!.taskFile },
          { id: "two", planId: plan.id, taskId: tasks[1]!.id, itemIndex: 0, taskFile: tasks[1]!.taskFile },
        ],
        [{ planId: plan.id, itemId: "two", dependsOnItemId: "one" }],
      ),
    /UNIQUE constraint failed/,
  );

  assert.deepEqual(store.listTasks(), []);
  assert.deepEqual(store.listPlans(), []);
  assert.deepEqual(store.getPlanItems(plan.id), []);
  assert.deepEqual(store.getDependencies(plan.id), []);
  store.close();
});

test("opening a legacy task-only database adds graph tables without changing the task", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-store-"));
  const databasePath = path.join(home, "forklight.sqlite");
  const timestamp = new Date().toISOString();
  const legacyTask = {
    id: "legacy-task",
    name: "Legacy task",
    status: "succeeded",
    updatedAt: timestamp,
  };
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(
    "CREATE TABLE tasks (id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at TEXT NOT NULL, record_json TEXT NOT NULL)",
  );
  legacy
    .prepare("INSERT INTO tasks (id, status, updated_at, record_json) VALUES (?, ?, ?, ?)")
    .run(legacyTask.id, legacyTask.status, timestamp, JSON.stringify(legacyTask));
  legacy.close();

  const migrated = new StateStore(home);
  assert.deepEqual(migrated.getTask(legacyTask.id), legacyTask);
  assert.deepEqual(migrated.listPlans(), []);
  migrated.close();
});
