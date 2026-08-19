import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildCreatedOutcomeIntake,
  buildOutcomeIntakeConfirmationReceipt,
  buildProposedOutcomeIntake,
  createOutcomeIntakeRecord,
  normalizeOutcomeIntakeCreate,
  normalizeOutcomeIntakePropose,
} from "../src/core/outcome-intake.js";
import { projectCandidateHandoff } from "../src/core/candidate-handoff.js";
import { resolveEffectiveMilestoneLineage } from "../src/core/goal.js";
import { buildTaskRecord } from "../src/core/runner.js";
import { parseTaskSpec } from "../src/core/task.js";
import { createRedactedExchangeMeasurement } from "../src/core/token-efficiency.js";
import type {
  CandidateHandoffRecord,
  DependencyRecord,
  GoalMilestoneRecord,
  GoalPlanAssociation,
  GoalRecord,
  PlanItemRecord,
  PlanRecord,
  TaskRecord,
} from "../src/core/types.js";
import {
  backupStoreDatabase,
  CANDIDATE_HANDOFF_CORRUPTION_ERROR,
  checkDatabaseFileIntegrity,
  StateStore,
  STORE_UNREADABLE_ERROR,
} from "../src/state/store.js";

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

test("store integrity exposes SQLite quick_check and foreign-key violations", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-store-integrity-"));
  const store = new StateStore(home);
  try {
    const integrity = store.checkStoreIntegrity();
    assert.equal(integrity.quickCheck, "ok");
    assert.equal(integrity.foreignKeyViolationCount, 0);
  } finally {
    store.close();
  }
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

// --- Orchestration exchange receipts — durable persistence ----------------

const TS = "2026-07-23T12:00:00.000Z";

function makeReceiptInput(overrides?: Record<string, unknown>): Record<string, unknown> {
  const taskId = (overrides?.taskId as string) ?? "task-store";
  const operation = (overrides?.operation as string) ?? "tool-call";
  const capturedAt = (overrides?.capturedAt as string) ?? TS;
  const m = (text: string, dir: "request" | "response") =>
    createRedactedExchangeMeasurement(text, dir, operation, taskId, capturedAt);
  return {
    id: (overrides?.id as string) ?? "receipt-1",
    taskId, operation, transport: "mcp",
    capturedAt, outcome: "success",
    requestArguments: m("request text", "request"),
    responseRelationship: "may-overlap",
    responseContent: m("response text", "response"),
    responseStructured: m('{"ok":true}', "response"),
  };
}

test("save and list exchange receipts round-trip as frozen canonical", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-store-"));
  const timestamp = new Date().toISOString();
  const store = new StateStore(home);
  store.createTask(queuedTask("task-store", timestamp));

  store.saveExchangeReceipt(makeReceiptInput({ id: "rec-a" }));
  const receipts = store.listExchangeReceipts("task-store");
  assert.equal(receipts.length, 1);
  const r = receipts[0]!;
  assert.equal(r.id, "rec-a");
  assert.equal(r.taskId, "task-store");
  assert.equal(r.responseRelationship, "may-overlap");
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.requestArguments));
  assert.ok(r.responseContent !== undefined);
  assert.ok(r.responseStructured !== undefined);
  // Detached copies for may-overlap response surfaces
  assert.notEqual(r.responseContent, r.responseStructured);
  store.close();
});

test("empty list for task with no receipts", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-store-"));
  const timestamp = new Date().toISOString();
  const store = new StateStore(home);
  store.createTask(queuedTask("task-empty", timestamp));
  assert.deepEqual(store.listExchangeReceipts("task-empty"), []);
  store.close();
});

test("receipts ordered by capturedAt then id", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-store-"));
  const timestamp = new Date().toISOString();
  const store = new StateStore(home);
  store.createTask(queuedTask("task-order", timestamp));

  const t1 = "2026-01-01T00:00:00.000Z";
  const t2 = "2026-01-02T00:00:00.000Z";

  store.saveExchangeReceipt(makeReceiptInput({ id: "rec-b", taskId: "task-order", capturedAt: t1 }));
  store.saveExchangeReceipt(makeReceiptInput({ id: "rec-c", taskId: "task-order", capturedAt: t2 }));
  store.saveExchangeReceipt(makeReceiptInput({ id: "rec-a", taskId: "task-order", capturedAt: t2 }));

  const receipts = store.listExchangeReceipts("task-order");
  assert.equal(receipts.length, 3);
  assert.equal(receipts[0]!.id, "rec-b"); // t1
  assert.equal(receipts[1]!.id, "rec-a"); // t2, id "rec-a" < "rec-c"
  assert.equal(receipts[2]!.id, "rec-c"); // t2, id "rec-c"
  store.close();
});

test("duplicate receipt id → UNIQUE constraint, only one persisted", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-store-"));
  const timestamp = new Date().toISOString();
  const store = new StateStore(home);
  store.createTask(queuedTask("task-dup", timestamp));

  store.saveExchangeReceipt(makeReceiptInput({ id: "rec-dup", taskId: "task-dup" }));
  assert.throws(
    () => store.saveExchangeReceipt(makeReceiptInput({ id: "rec-dup", taskId: "task-dup" })),
    /UNIQUE constraint failed/,
  );
  assert.equal(store.listExchangeReceipts("task-dup").length, 1);
  store.close();
});

test("nonexistent task → FOREIGN KEY constraint rejected", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-store-"));
  const store = new StateStore(home);
  assert.throws(
    () => store.saveExchangeReceipt(makeReceiptInput({ id: "rec-fk", taskId: "nonexistent" })),
    /FOREIGN KEY constraint failed/,
  );
  store.close();
});

test("corrupt stored JSON → list fails closed without raw byte echo", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-store-"));
  const timestamp = new Date().toISOString();
  const store = new StateStore(home);
  store.createTask(queuedTask("task-corrupt", timestamp));
  store.close();

  const raw = new DatabaseSync(path.join(home, "forklight.sqlite"));
  raw.prepare(
    `INSERT INTO orchestration_exchange_receipts (id, task_id, captured_at, record_json)
     VALUES (?, ?, ?, ?)`,
  ).run("rec-corrupt", "task-corrupt", TS, "{this is not valid json[[[");
  raw.close();

  const reopened = new StateStore(home);
  assert.throws(
    () => reopened.listExchangeReceipts("task-corrupt"),
    { name: "Error", message: "Corrupt receipt record in state database" },
  );
  reopened.close();
});

test("unsafe stored record (extra keys) → list fails closed", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-store-"));
  const timestamp = new Date().toISOString();
  const store = new StateStore(home);
  store.createTask(queuedTask("task-unsafe", timestamp));
  store.close();

  const raw = new DatabaseSync(path.join(home, "forklight.sqlite"));
  const unsafeRecord = {
    id: "rec-unsafe", taskId: "task-unsafe", operation: "tool-call", transport: "mcp",
    capturedAt: TS, outcome: "success",
    requestArguments: {
      direction: "request", operation: "tool-call", taskId: "task-unsafe", timestamp: TS,
      utf8Bytes: 12, asciiCount: 12, nonAsciiCount: 0,
    },
    responseRelationship: "may-overlap",
    leakedSecret: "should-not-be-here",
  };
  raw.prepare(
    `INSERT INTO orchestration_exchange_receipts (id, task_id, captured_at, record_json)
     VALUES (?, ?, ?, ?)`,
  ).run("rec-unsafe", "task-unsafe", TS, JSON.stringify(unsafeRecord));
  raw.close();

  const reopened = new StateStore(home);
  assert.throws(
    () => reopened.listExchangeReceipts("task-unsafe"),
    { name: "TypeError", message: "Invalid orchestration exchange receipt" },
  );
  reopened.close();
});

test("stored record with mismatched task attribution → list fails closed", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-store-"));
  const timestamp = new Date().toISOString();
  const store = new StateStore(home);
  store.createTask(queuedTask("task-mismatch", timestamp));
  store.close();

  const raw = new DatabaseSync(path.join(home, "forklight.sqlite"));
  const mismatchedRecord = {
    id: "rec-mismatch", taskId: "task-OTHER", operation: "tool-call", transport: "mcp",
    capturedAt: TS, outcome: "success",
    requestArguments: {
      direction: "request", operation: "tool-call", taskId: "task-OTHER", timestamp: TS,
      utf8Bytes: 12, asciiCount: 12, nonAsciiCount: 0,
    },
    responseRelationship: "may-overlap",
  };
  raw.prepare(
    `INSERT INTO orchestration_exchange_receipts (id, task_id, captured_at, record_json)
     VALUES (?, ?, ?, ?)`,
  ).run("rec-mismatch", "task-mismatch", TS, JSON.stringify(mismatchedRecord));
  raw.close();

  const reopened = new StateStore(home);
  assert.throws(
    () => reopened.listExchangeReceipts("task-mismatch"),
    { name: "Error", message: "Receipt task mismatch in state database" },
  );
  reopened.close();
});

test("stored receipts are re-normalized on read (frozen, no unsafe fields)", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-store-"));
  const timestamp = new Date().toISOString();
  const store = new StateStore(home);
  store.createTask(queuedTask("task-renorm", timestamp));

  store.saveExchangeReceipt(makeReceiptInput({ id: "rec-n1", taskId: "task-renorm" }));
  store.saveExchangeReceipt(makeReceiptInput({ id: "rec-n2", taskId: "task-renorm" }));

  const receipts = store.listExchangeReceipts("task-renorm");
  assert.equal(receipts.length, 2);
  for (const r of receipts) {
    assert.ok(Object.isFrozen(r));
    assert.ok(Object.isFrozen(r.requestArguments));
    if (r.responseContent) assert.ok(Object.isFrozen(r.responseContent));
    if (r.responseStructured) assert.ok(Object.isFrozen(r.responseStructured));
    assert.equal(r.responseRelationship, "may-overlap");
    for (const f of ["text", "content", "payload", "raw", "secret", "leakedSecret"])
      assert.equal(f in r, false);
  }
  store.close();
});

test("legacy database without receipt table → additive migration preserves tasks, empty list", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-store-"));
  const databasePath = path.join(home, "forklight.sqlite");
  const timestamp = new Date().toISOString();

  const legacy = new DatabaseSync(databasePath);
  legacy.exec(
    "CREATE TABLE tasks (id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at TEXT NOT NULL, record_json TEXT NOT NULL)",
  );
  const legacyTask = { id: "legacy-rt", status: "succeeded", updatedAt: timestamp };
  legacy.prepare("INSERT INTO tasks (id, status, updated_at, record_json) VALUES (?, ?, ?, ?)")
    .run(legacyTask.id, legacyTask.status, timestamp, JSON.stringify(legacyTask));
  legacy.close();

  const migrated = new StateStore(home);
  assert.deepEqual(migrated.getTask("legacy-rt"), legacyTask);
  assert.deepEqual(migrated.listExchangeReceipts("legacy-rt"), []);
  migrated.close();
});

test("receipt insert-only: no mutation, re-open preserves records", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-store-"));
  const timestamp = new Date().toISOString();
  const store = new StateStore(home);
  store.createTask(queuedTask("task-insertonly", timestamp));

  store.saveExchangeReceipt(makeReceiptInput({ id: "rec-io", taskId: "task-insertonly" }));
  assert.equal(store.listExchangeReceipts("task-insertonly").length, 1);
  // Duplicate fails, original preserved
  assert.throws(
    () => store.saveExchangeReceipt(makeReceiptInput({ id: "rec-io", taskId: "task-insertonly" })),
    /UNIQUE/,
  );
  assert.equal(store.listExchangeReceipts("task-insertonly").length, 1);

  // Re-open and verify record survived intact
  store.close();
  const reopened = new StateStore(home);
  const receipts = reopened.listExchangeReceipts("task-insertonly");
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]!.id, "rec-io");
  reopened.close();
});

test("corrupt JSON error message never echoes raw bytes", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-store-"));
  const timestamp = new Date().toISOString();
  const store = new StateStore(home);
  store.createTask(queuedTask("task-noecho", timestamp));
  store.close();

  const secret = "xyz-secret-key-789";
  const corruptPayload = `{"broken": true, "secret": "${secret}"}[[[INVALID`;
  const raw = new DatabaseSync(path.join(home, "forklight.sqlite"));
  raw.prepare(
    `INSERT INTO orchestration_exchange_receipts (id, task_id, captured_at, record_json)
     VALUES (?, ?, ?, ?)`,
  ).run("rec-noecho", "task-noecho", TS, corruptPayload);
  raw.close();

  const reopened = new StateStore(home);
  try {
    reopened.listExchangeReceipts("task-noecho");
    assert.fail("Expected error");
  } catch (e: any) {
    assert.ok(!e.message.includes(secret), `Error echoed secret: ${e.message}`);
    assert.ok(!e.message.includes("[[["), `Error echoed corrupt bytes: ${e.message}`);
    assert.equal(e.message, "Corrupt receipt record in state database");
  }
  reopened.close();
});

test("id/time/task column mismatch → list fails closed with non-echoing error", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-store-"));
  const timestamp = new Date().toISOString();
  const store = new StateStore(home);
  store.createTask(queuedTask("task-colmismatch", timestamp));
  store.close();

  const validJson = {
    id: "rec-json-id", taskId: "task-colmismatch", operation: "tool-call",
    transport: "mcp", capturedAt: TS, outcome: "success",
    requestArguments: {
      direction: "request", operation: "tool-call", taskId: "task-colmismatch",
      timestamp: TS, utf8Bytes: 1, asciiCount: 1, nonAsciiCount: 0,
    },
    responseRelationship: "may-overlap",
  };

  // Insert with column id and captured_at differing from JSON values
  const raw = new DatabaseSync(path.join(home, "forklight.sqlite"));
  raw.prepare(
    `INSERT INTO orchestration_exchange_receipts (id, task_id, captured_at, record_json)
     VALUES (?, ?, ?, ?)`,
  ).run("rec-col-id", "task-colmismatch", "2020-01-01T00:00:00.000Z", JSON.stringify(validJson));
  raw.close();

  const reopened = new StateStore(home);
  assert.throws(
    () => reopened.listExchangeReceipts("task-colmismatch"),
    { name: "Error", message: "Corrupt receipt record in state database" },
  );
  reopened.close();
});

// --- Direct-Codex calibration registry ---

import { publishDirectCodexCalibration, normalizeDirectCodexPairedSample } from "../src/core/direct-codex-calibration.js";
import { normalizeDirectCodexCalibrationRecord } from "../src/core/token-efficiency.js";

function validCal(overrides?: Record<string, unknown>): Record<string, unknown> {
  return { minTokens: 800, maxTokens: 1200, method: "direct-codex-benchmark",
    taskClass: "edit-task", confidence: "medium", version: 1, sampleSize: 5,
    evidenceReferences: ["experiment:ref-a", "experiment:ref-b"], createdAt: TS, schemaVersion: 1, ...overrides };
}

function assertFrozen(v: unknown, path = "root"): void {
  if (v === null || typeof v !== "object") return;
  assert.ok(Object.isFrozen(v), `Expected ${path} frozen`);
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) assertFrozen(v[i], `${path}[${i}]`); }
  else { for (const k of Object.keys(v as Record<string, unknown>))
    assertFrozen((v as Record<string, unknown>)[k], `${path}.${k}`); }
}

// --- Normalizer validation ---

test("normalizer validates shape, bounds, versions, timestamps, privacy", () => {
  // Null / non-object → rejected
  for (const v of [null, undefined, "string", 123, true, []])
    assert.throws(() => normalizeDirectCodexCalibrationRecord(v), TypeError);

  // Extra keys → rejected without echoing values
  assert.throws(() => normalizeDirectCodexCalibrationRecord({ ...validCal(), apiKey: "secret-123" }), TypeError);

  // Missing required keys → rejected
  for (const key of ["minTokens", "maxTokens", "method", "taskClass", "confidence",
    "version", "sampleSize", "evidenceReferences", "createdAt", "schemaVersion"]) {
    const { [key]: _, ...partial } = validCal();
    assert.throws(() => normalizeDirectCodexCalibrationRecord(partial), TypeError);
  }

  // Invalid bounds
  assert.throws(() => normalizeDirectCodexCalibrationRecord(validCal({ minTokens: -1 })), TypeError);
  assert.throws(() => normalizeDirectCodexCalibrationRecord(validCal({ minTokens: 1.5 })), TypeError);
  assert.throws(() => normalizeDirectCodexCalibrationRecord(validCal({ minTokens: 200, maxTokens: 100 })), TypeError);

  // Invalid version/sampleSize
  assert.throws(() => normalizeDirectCodexCalibrationRecord(validCal({ version: 0 })), TypeError);
  assert.throws(() => normalizeDirectCodexCalibrationRecord(validCal({ version: 1.5 })), TypeError);
  assert.throws(() => normalizeDirectCodexCalibrationRecord(validCal({ sampleSize: 0 })), TypeError);

  // schemaVersion != 1
  assert.throws(() => normalizeDirectCodexCalibrationRecord(validCal({ schemaVersion: 2 })), TypeError);

  // Invalid string/meta fields
  assert.throws(() => normalizeDirectCodexCalibrationRecord(validCal({ confidence: "extreme" })), TypeError);
  assert.throws(() => normalizeDirectCodexCalibrationRecord(validCal({ method: "" })), TypeError);
  assert.throws(() => normalizeDirectCodexCalibrationRecord(validCal({ taskClass: "  " })), TypeError);
  assert.throws(() => normalizeDirectCodexCalibrationRecord(validCal({ createdAt: "bad-date" })), TypeError);
  assert.throws(() => normalizeDirectCodexCalibrationRecord(validCal({ createdAt: "2026-07-23" })), TypeError);
  assert.throws(() => normalizeDirectCodexCalibrationRecord(validCal({ evidenceReferences: [""] })), TypeError);
  assert.throws(() => normalizeDirectCodexCalibrationRecord(validCal({ evidenceReferences: [] })), TypeError);
  assert.throws(() => normalizeDirectCodexCalibrationRecord(validCal({ evidenceReferences: ["raw prompt text"] })), TypeError);
  assert.throws(() => normalizeDirectCodexCalibrationRecord(validCal({ evidenceReferences: ["experiment:same", "experiment:same"] })), TypeError);
  assert.throws(() => normalizeDirectCodexCalibrationRecord(validCal({ evidenceReferences: "not-array" })), TypeError);
});

test("valid calibration → detached deeply-frozen canonical, no raw content fields", () => {
  const r = normalizeDirectCodexCalibrationRecord(validCal());
  assert.equal(r.minTokens, 800); assert.equal(r.taskClass, "edit-task");
  assert.equal(r.confidence, "medium"); assert.equal(r.version, 1);
  assert.equal(r.sampleSize, 5); assert.deepEqual(r.evidenceReferences, ["experiment:ref-a", "experiment:ref-b"]);
  assert.equal(r.createdAt, TS); assert.equal(r.schemaVersion, 1);
  assertFrozen(r); assert.ok(Object.isFrozen(r.evidenceReferences));
  for (const f of ["text", "content", "prompt", "body", "payload", "raw", "secret"])
    assert.equal(f in r, false);
  // Idempotent but detached
  const r2 = normalizeDirectCodexCalibrationRecord(r);
  assert.deepEqual(r2, r); assert.notEqual(r2, r);
  assert.notEqual(r2.evidenceReferences, r.evidenceReferences);
});

// --- Store persistence ---

test("save, list, latest calibration round-trip with version ordering", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cal-"));
  const store = new StateStore(home);

  store.saveDirectCodexCalibration(validCal({ taskClass: "class-a", version: 2 }));
  store.saveDirectCodexCalibration(validCal({ taskClass: "class-a", version: 1 }));
  store.saveDirectCodexCalibration(validCal({ taskClass: "class-b", version: 1 }));

  const all = store.listDirectCodexCalibrations();
  assert.equal(all.length, 3);
  assert.equal(all[0]!.taskClass, "class-a"); assert.equal(all[0]!.version, 1);
  assert.equal(all[1]!.taskClass, "class-a"); assert.equal(all[1]!.version, 2);
  assert.equal(all[2]!.taskClass, "class-b");

  assert.equal(store.listDirectCodexCalibrations("class-a").length, 2);
  assert.equal(store.listDirectCodexCalibrations("class-c").length, 0);
  assert.equal(store.listDirectCodexCalibrations("class").length, 0); // no prefix match

  const latest = store.latestDirectCodexCalibration("class-a");
  assert.ok(latest !== undefined); assert.equal(latest!.version, 2);
  assertFrozen(latest);
  assert.equal(store.latestDirectCodexCalibration("class-b")!.version, 1);
  assert.equal(store.latestDirectCodexCalibration("other"), undefined);
  assert.equal(store.latestDirectCodexCalibration("class"), undefined); // no prefix match

  store.close();
});

test("duplicate version → UNIQUE constraint, insert-only", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cal-"));
  const store = new StateStore(home);
  store.saveDirectCodexCalibration(validCal({ taskClass: "dup", version: 1 }));
  assert.throws(() => store.saveDirectCodexCalibration(validCal({ taskClass: "dup", version: 1 })), /UNIQUE/);
  assert.equal(store.listDirectCodexCalibrations("dup").length, 1);
  store.close();
});

test("legacy database without calibration table → additive migration preserves tasks", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cal-"));
  const databasePath = path.join(home, "forklight.sqlite");
  const ts = new Date().toISOString();

  const legacy = new DatabaseSync(databasePath);
  legacy.exec("CREATE TABLE tasks (id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at TEXT NOT NULL, record_json TEXT NOT NULL)");
  const legacyTask = { id: "legacy", status: "succeeded", updatedAt: ts };
  legacy.prepare("INSERT INTO tasks (id, status, updated_at, record_json) VALUES (?, ?, ?, ?)").run(legacyTask.id, legacyTask.status, ts, JSON.stringify(legacyTask));
  legacy.close();

  const migrated = new StateStore(home);
  assert.deepEqual(migrated.getTask("legacy"), legacyTask);
  assert.deepEqual(migrated.listDirectCodexCalibrations(), []);
  assert.equal(migrated.latestDirectCodexCalibration("any"), undefined);
  migrated.close();
});

test("corrupt stored JSON → list fails closed without echoing raw bytes or secrets", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cal-"));
  const store = new StateStore(home); store.close();

  const raw = new DatabaseSync(path.join(home, "forklight.sqlite"));
  raw.exec("CREATE TABLE IF NOT EXISTS direct_codex_calibrations (id TEXT PRIMARY KEY, task_class TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, record_json TEXT NOT NULL, UNIQUE(task_class, version))");
  const secret = "s3cret-abc-xyz";
  raw.prepare("INSERT INTO direct_codex_calibrations (id, task_class, version, created_at, record_json) VALUES (?, ?, ?, ?, ?)").run("c:v1", "c", 1, TS, `{"taskClass":"c","secret":"${secret}"}[[[BROKEN`);
  raw.close();

  const reopened = new StateStore(home);
  try { reopened.listDirectCodexCalibrations("c"); assert.fail("Expected"); }
  catch (e: any) {
    assert.ok(!e.message.includes(secret));
    assert.ok(!e.message.includes("[[["));
    assert.equal(e.message, "Corrupt calibration record in state database");
  }
  reopened.close();
});

test("extra keys in stored JSON → re-normalize fails closed", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cal-"));
  const store = new StateStore(home); store.close();

  const raw = new DatabaseSync(path.join(home, "forklight.sqlite"));
  raw.exec("CREATE TABLE IF NOT EXISTS direct_codex_calibrations (id TEXT PRIMARY KEY, task_class TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, record_json TEXT NOT NULL, UNIQUE(task_class, version))");
  const unsafe = { ...validCal({ taskClass: "unsafe" }), leakedField: "should-not-exist" };
  raw.prepare("INSERT INTO direct_codex_calibrations (id, task_class, version, created_at, record_json) VALUES (?, ?, ?, ?, ?)").run("unsafe:v1", "unsafe", 1, TS, JSON.stringify(unsafe));
  raw.close();

  const reopened = new StateStore(home);
  assert.throws(() => reopened.listDirectCodexCalibrations("unsafe"),
    { name: "TypeError", message: "Invalid calibration record" });
  reopened.close();
});

test("returned records are deeply frozen and immutable", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cal-"));
  const store = new StateStore(home);
  store.saveDirectCodexCalibration(validCal({ taskClass: "frozen", version: 1 }));

  const list = store.listDirectCodexCalibrations("frozen");
  assert.equal(list.length, 1); assertFrozen(list[0]!);
  assert.throws(() => { (list[0] as any).minTokens = 999; }, TypeError);

  const latest = store.latestDirectCodexCalibration("frozen");
  assert.ok(latest !== undefined); assertFrozen(latest);
  assert.throws(() => { (latest as any).version = 99; }, TypeError);

  store.close();
});

// --- Task class in parsing and persistence ---

test("taskClass survives parsing + persistence; absence backward compatible", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cal-"));
  const store = new StateStore(home);

  // With taskClass (surrounding whitespace trimmed)
  const specWith = parseTaskSpec({ version: 1, name: "Classified", project: "/tmp/source",
    goal: "Test", taskClass: "  edit-task  ", acceptance: { commands: ["npm test"] } }, "/tmp");
  assert.equal(specWith.taskClass, "edit-task");

  const recordWith = buildTaskRecord({ spec: specWith, taskFile: "/tmp/c.yaml", home,
    id: "classified", sessionId: "s-c", createdAt: new Date().toISOString() });
  assert.equal(recordWith.spec.taskClass, "edit-task");
  store.createTask(recordWith);
  assert.equal(store.getTask("classified").spec.taskClass, "edit-task");

  // Without taskClass — absence valid
  const specWithout = parseTaskSpec({ version: 1, name: "Unclassified", project: "/tmp/source",
    goal: "Test", acceptance: { commands: ["npm test"] } }, "/tmp");
  assert.equal(specWithout.taskClass, undefined);
  assert.equal("taskClass" in specWithout, false);

  const recordWithout = buildTaskRecord({ spec: specWithout, taskFile: "/tmp/u.yaml", home,
    id: "unclassified", sessionId: "s-u", createdAt: new Date().toISOString() });
  assert.equal(recordWithout.spec.taskClass, undefined);
  store.createTask(recordWithout);
  assert.equal(store.getTask("unclassified").spec.taskClass, undefined);

  store.close();
});

test("blank taskClass rejected at parse time", () => {
  assert.throws(() => parseTaskSpec({ version: 1, name: "Bad", project: "/tmp",
    goal: "T", taskClass: "", acceptance: { commands: ["true"] } }, "/tmp"),
    /task\.taskClass must be a non-empty string/);
  assert.throws(() => parseTaskSpec({ version: 1, name: "Bad", project: "/tmp",
    goal: "T", taskClass: "   ", acceptance: { commands: ["true"] } }, "/tmp"),
    /task\.taskClass must be a non-empty string/);
  assert.throws(() => parseTaskSpec({ version: 1, name: "Bad", project: "/tmp",
    goal: "T", taskClass: "x".repeat(81), acceptance: { commands: ["true"] } }, "/tmp"),
    /at most 80 characters/);
});

test("exact class lookup — no case-fold, prefix, or fuzzy match", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cal-"));
  const store = new StateStore(home);
  store.saveDirectCodexCalibration(validCal({ taskClass: "edit", version: 1 }));
  store.saveDirectCodexCalibration(validCal({ taskClass: "edit-task", version: 1 }));

  assert.equal(store.listDirectCodexCalibrations("edit").length, 1);
  assert.equal(store.listDirectCodexCalibrations("edit-task").length, 1);
  assert.equal(store.listDirectCodexCalibrations("EDIT").length, 0);
  assert.equal(store.listDirectCodexCalibrations("edit-").length, 0);
  assert.ok(store.latestDirectCodexCalibration("edit") !== undefined);
  assert.equal(store.latestDirectCodexCalibration("EDIT"), undefined);
  store.close();
});

test("calibration rows cross-check indexed columns against canonical JSON", async () => {
  const cases = [
    ["id", "other:v1"], ["task_class", "other"], ["version", 2],
    ["created_at", "2026-07-23T12:00:01.000Z"],
  ] as const;
  for (const [column, value] of cases) {
    const home = await mkdtemp(path.join(tmpdir(), "forklight-cal-row-"));
    const store = new StateStore(home);
    store.saveDirectCodexCalibration(validCal({ taskClass: "cross-check", version: 1 }));
    store.close();
    const raw = new DatabaseSync(path.join(home, "forklight.sqlite"));
    raw.prepare(`UPDATE direct_codex_calibrations SET ${column} = ?`).run(value);
    raw.close();
    const reopened = new StateStore(home);
    const action = column === "task_class"
      ? () => reopened.listDirectCodexCalibrations("other")
      : () => reopened.listDirectCodexCalibrations("cross-check");
    assert.throws(action, { name: "Error", message: "Corrupt calibration record in state database" });
    reopened.close();
  }
});

// --- Direct-Codex profile publication registry ---

function profilePublicationInput(overrides?: {
  taskClass?: string; profileId?: string; version?: number; createdAt?: string;
}): Record<string, unknown> {
  const tc = overrides?.taskClass ?? "edit-task";
  const pid = overrides?.profileId ?? "profileA";
  const pp = {
    method: "paired-sample-v1", confidence: "low" as const,
    version: overrides?.version ?? 1, taskClass: tc,
    directCodexProfileId: pid, createdAt: overrides?.createdAt ?? TS,
  };
  const s = {
    sampleId: "s1", forklightTaskId: "task-a1b", exactTaskClass: tc,
    directCodexProfileId: pid,
    inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 200, cacheCreationInputTokens: 50,
    source: "codex-terminal-result" as const, complete: true as const,
    directRunRef: "codex-run:a1b2c3d4", pairingRef: "pair:xyz-789",
    capturedAt: TS, schemaVersion: 1 as const,
  };
  return publishDirectCodexCalibration(
    [normalizeDirectCodexPairedSample(s)], pp,
  ) as unknown as Record<string, unknown>;
}

test("save, list, latest profile publication round-trip with version ordering", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-pp-"));
  const store = new StateStore(home);

  store.saveDirectCodexProfilePublication(profilePublicationInput({ taskClass: "class-a", profileId: "profileA", version: 2 }));
  store.saveDirectCodexProfilePublication(profilePublicationInput({ taskClass: "class-a", profileId: "profileA", version: 1 }));
  store.saveDirectCodexProfilePublication(profilePublicationInput({ taskClass: "class-a", profileId: "profileB", version: 1 }));

  const listA = store.listDirectCodexProfilePublications("class-a", "profileA");
  assert.equal(listA.length, 2);
  assert.equal(listA[0]!.calibration.version, 1);
  assert.equal(listA[1]!.calibration.version, 2);

  const listB = store.listDirectCodexProfilePublications("class-a", "profileB");
  assert.equal(listB.length, 1);
  assert.equal(listB[0]!.calibration.version, 1);

  // Different profile returns empty list for that pair
  assert.deepEqual(store.listDirectCodexProfilePublications("class-a", "nonexistent"), []);

  // Latest picks highest version for exact pair
  const latest = store.latestDirectCodexProfilePublication("class-a", "profileA");
  assert.ok(latest !== undefined);
  assert.equal(latest!.calibration.version, 2);
  assert.equal(latest!.directCodexProfileId, "profileA");

  // No cross-profile latest
  assert.equal(store.latestDirectCodexProfilePublication("class-a", "profileC"), undefined);
  // No prefix match
  assert.equal(store.latestDirectCodexProfilePublication("class", "profileA"), undefined);

  store.close();
});

test("same class across two profiles coexist; exact lookup never crosses profiles", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-pp-"));
  const store = new StateStore(home);

  store.saveDirectCodexProfilePublication(profilePublicationInput({ taskClass: "shared-class", profileId: "profileX", version: 1 }));
  store.saveDirectCodexProfilePublication(profilePublicationInput({ taskClass: "shared-class", profileId: "profileY", version: 1 }));
  store.saveDirectCodexProfilePublication(profilePublicationInput({ taskClass: "shared-class", profileId: "profileX", version: 2 }));

  assert.equal(store.listDirectCodexProfilePublications("shared-class", "profileX").length, 2);
  assert.equal(store.listDirectCodexProfilePublications("shared-class", "profileY").length, 1);

  const latestX = store.latestDirectCodexProfilePublication("shared-class", "profileX");
  assert.ok(latestX !== undefined);
  assert.equal(latestX!.calibration.version, 2);
  assert.equal(latestX!.directCodexProfileId, "profileX");

  const latestY = store.latestDirectCodexProfilePublication("shared-class", "profileY");
  assert.ok(latestY !== undefined);
  assert.equal(latestY!.calibration.version, 1);
  assert.equal(latestY!.directCodexProfileId, "profileY");

  store.close();
});

test("duplicate class+profile+version → UNIQUE constraint, insert-only", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-pp-"));
  const store = new StateStore(home);
  store.saveDirectCodexProfilePublication(profilePublicationInput({ taskClass: "dup-class", profileId: "dupProf", version: 1 }));
  assert.throws(
    () => store.saveDirectCodexProfilePublication(profilePublicationInput({ taskClass: "dup-class", profileId: "dupProf", version: 1 })),
    /UNIQUE/,
  );
  assert.equal(store.listDirectCodexProfilePublications("dup-class", "dupProf").length, 1);
  store.close();
});

test("legacy database without profile publication table → additive migration preserves tasks, empty list", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-pp-mig-"));
  const databasePath = path.join(home, "forklight.sqlite");
  const ts = new Date().toISOString();

  const legacy = new DatabaseSync(databasePath);
  legacy.exec("CREATE TABLE tasks (id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at TEXT NOT NULL, record_json TEXT NOT NULL)");
  const legacyTask = { id: "legacy-pp", status: "succeeded", updatedAt: ts };
  legacy.prepare("INSERT INTO tasks (id, status, updated_at, record_json) VALUES (?, ?, ?, ?)").run(legacyTask.id, legacyTask.status, ts, JSON.stringify(legacyTask));
  legacy.close();

  const migrated = new StateStore(home);
  assert.deepEqual(migrated.getTask("legacy-pp"), legacyTask);
  assert.deepEqual(migrated.listDirectCodexProfilePublications("any", "any"), []);
  assert.equal(migrated.latestDirectCodexProfilePublication("any", "any"), undefined);
  migrated.close();
});

test("legacy calibration table still works after profile publication migration", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-pp-legacy-"));
  const store = new StateStore(home);

  // Legacy calibration save/list/latest still work
  store.saveDirectCodexCalibration(validCal({ taskClass: "legacy-class", version: 1 }));
  assert.equal(store.listDirectCodexCalibrations("legacy-class").length, 1);
  assert.ok(store.latestDirectCodexCalibration("legacy-class") !== undefined);

  // Profile publication table starts empty
  assert.deepEqual(store.listDirectCodexProfilePublications("legacy-class", "anyProfile"), []);

  // Saving a profile publication does not affect legacy calibrations
  store.saveDirectCodexProfilePublication(profilePublicationInput({ taskClass: "legacy-class", profileId: "profA", version: 1 }));
  assert.equal(store.listDirectCodexCalibrations("legacy-class").length, 1);
  assert.equal(store.listDirectCodexProfilePublications("legacy-class", "profA").length, 1);

  store.close();
});

test("returned profile publications are deeply frozen and immutable", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-pp-"));
  const store = new StateStore(home);
  store.saveDirectCodexProfilePublication(profilePublicationInput({ taskClass: "frozen-pp", profileId: "fzProf", version: 1 }));

  const list = store.listDirectCodexProfilePublications("frozen-pp", "fzProf");
  assert.equal(list.length, 1);
  const p = list[0]!;
  assertFrozen(p);
  assertFrozen(p.calibration);
  assert.ok(Object.isFrozen(p.calibration.evidenceReferences));
  assert.throws(() => { (p as any).directCodexProfileId = "hacked"; }, TypeError);
  assert.throws(() => { (p.calibration as any).minTokens = 999; }, TypeError);

  const latest = store.latestDirectCodexProfilePublication("frozen-pp", "fzProf");
  assert.ok(latest !== undefined);
  assertFrozen(latest);
  assert.throws(() => { (latest as any).calibration = null; }, TypeError);

  store.close();
});

test("no stored profile publication exposes raw fields", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-pp-"));
  const store = new StateStore(home);
  store.saveDirectCodexProfilePublication(profilePublicationInput({ taskClass: "privacy-pp", profileId: "privProf", version: 1 }));

  const latest = store.latestDirectCodexProfilePublication("privacy-pp", "privProf");
  assert.ok(latest !== undefined);
  for (const f of ["text", "content", "prompt", "body", "payload", "raw", "secret", "credential", "log", "response", "promptText", "modelConfig"])
    assert.equal(f in latest, false, `Unexpected field: ${f}`);
  assert.equal("directCodexProfileId" in latest, true);
  assert.equal("calibration" in latest, true);
  assert.equal("envelopeSchemaVersion" in latest, true);

  store.close();
});

test("corrupt stored JSON → list fails closed without echoing raw bytes or secrets", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-pp-corr-"));
  const databasePath = path.join(home, "forklight.sqlite");
  const store = new StateStore(home);
  store.close();

  const secret = "x-secret-leak-pp-999";
  const raw = new DatabaseSync(databasePath);
  // Ensure the table exists (created by store constructor)
  raw.prepare(
    `INSERT INTO direct_codex_profile_publications (task_class, profile_id, version, created_at, record_json)
     VALUES (?, ?, ?, ?, ?)`,
  ).run("corr", "profC", 1, TS, `{"secret":"${secret}"}[[[NOT-JSON`);
  raw.close();

  const reopened = new StateStore(home);
  assert.throws(
    () => reopened.listDirectCodexProfilePublications("corr", "profC"),
    (e: any) =>
      e.message === "Corrupt profile publication record in state database" &&
      !e.message.includes(secret) &&
      !e.message.includes("[["),
  );
  reopened.close();
});

test("extra keys in stored JSON → re-normalize fails closed", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-pp-extra-"));
  const databasePath = path.join(home, "forklight.sqlite");
  const store = new StateStore(home);
  store.close();

  const pub = profilePublicationInput({ taskClass: "extra-class", profileId: "profE", version: 1 });
  const unsafe = { ...pub, leakedModelConfig: { model: "gpt-5", apikey: "sk-abc" } };

  const raw = new DatabaseSync(databasePath);
  raw.prepare(
    `INSERT INTO direct_codex_profile_publications (task_class, profile_id, version, created_at, record_json)
     VALUES (?, ?, ?, ?, ?)`,
  ).run("extra-class", "profE", 1, TS, JSON.stringify(unsafe));
  raw.close();

  const reopened = new StateStore(home);
  assert.throws(
    () => reopened.listDirectCodexProfilePublications("extra-class", "profE"),
    { name: "TypeError", message: "Invalid direct-Codex profile publication" },
  );
  reopened.close();
});

test("column/JSON cross-check fails closed on mismatch for each indexed column", async () => {
  const columns = [
    { column: "task_class", forgedValue: "forged-class", queryClass: "forged-class", queryProf: "colProf" },
    { column: "profile_id", forgedValue: "forgedProf", queryClass: "col-class", queryProf: "forgedProf" },
    { column: "version", forgedValue: 99, queryClass: "col-class", queryProf: "colProf" },
    { column: "created_at", forgedValue: "2020-01-01T00:00:00.000Z", queryClass: "col-class", queryProf: "colProf" },
  ] as const;
  for (const { column, forgedValue, queryClass, queryProf } of columns) {
    const home = await mkdtemp(path.join(tmpdir(), "forklight-pp-col-"));
    const store = new StateStore(home);
    store.saveDirectCodexProfilePublication(profilePublicationInput({ taskClass: "col-class", profileId: "colProf", version: 1 }));
    store.close();

    const raw = new DatabaseSync(path.join(home, "forklight.sqlite"));
    raw.prepare(`UPDATE direct_codex_profile_publications SET ${column} = ?`).run(forgedValue);
    raw.close();

    const reopened = new StateStore(home);
    assert.throws(
      () => reopened.listDirectCodexProfilePublications(queryClass, queryProf),
      { name: "Error", message: "Corrupt profile publication record in state database" },
    );
    reopened.close();
  }
});

test("exact match lookup — no case-fold, prefix, fuzzy, or cross-profile match", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-pp-exact-"));
  const store = new StateStore(home);

  store.saveDirectCodexProfilePublication(profilePublicationInput({ taskClass: "exactTask", profileId: "exactProf", version: 1 }));
  store.saveDirectCodexProfilePublication(profilePublicationInput({ taskClass: "exactTask", profileId: "nearbyProf", version: 1 }));
  store.saveDirectCodexProfilePublication(profilePublicationInput({ taskClass: "exactTaskX", profileId: "exactProf", version: 1 }));

  // Exact pair only
  assert.equal(store.listDirectCodexProfilePublications("exactTask", "exactProf").length, 1);
  // Case-fold rejected
  assert.equal(store.listDirectCodexProfilePublications("EXACTTASK", "exactProf").length, 0);
  assert.equal(store.listDirectCodexProfilePublications("exactTask", "EXACTPROF").length, 0);
  // Prefix rejected
  assert.equal(store.listDirectCodexProfilePublications("exactTas", "exactProf").length, 0);
  assert.equal(store.listDirectCodexProfilePublications("exactTask", "exactPro").length, 0);
  // Cross-profile latest
  assert.ok(store.latestDirectCodexProfilePublication("exactTask", "exactProf") !== undefined);
  assert.equal(store.latestDirectCodexProfilePublication("exactTask", "nonexistent"), undefined);

  store.close();
});

test("profile publication queries reject noncanonical keys without trimming or echoing", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-pp-query-"));
  const store = new StateStore(home);
  const calls = (taskClass: unknown, profileId: unknown) => [
    () => store.listDirectCodexProfilePublications(taskClass as string, profileId as string),
    () => store.latestDirectCodexProfilePublication(taskClass as string, profileId as string),
  ];
  for (const taskClass of ["", " ", " exactTask", "exactTask ", "x".repeat(81), null, undefined, 42]) {
    for (const call of calls(taskClass, "profileA")) {
      assert.throws(call, { name: "TypeError", message: "Invalid direct-Codex profile publication query" });
    }
  }
  for (const profileId of ["", " ", " profileA", "profileA ", "-bad", "x/y", null, undefined, 42]) {
    for (const call of calls("exactTask", profileId)) assert.throws(call, TypeError);
  }
  const secret = "leaked-query-profile";
  for (const call of calls("exactTask", `${secret}:`)) {
    assert.throws(call, { name: "TypeError", message: "Invalid directCodexProfileId" });
  }
  store.close();
});

test("TaskSpec directCodexProfileId round-trip: parsing → persistence → retrieval", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-pp-ts-"));
  const store = new StateStore(home);

  // Parse TaskSpec with explicit directCodexProfileId
  const spec = parseTaskSpec({
    version: 1, name: "ProfileTask", project: "/tmp/source",
    goal: "Test profile identity", taskClass: "edit-task",
    directCodexProfileId: "myProfile-v2",
    acceptance: { commands: ["npm test"] },
  }, "/tmp");
  assert.equal(spec.directCodexProfileId, "myProfile-v2");
  assert.equal(spec.taskClass, "edit-task");

  const record = buildTaskRecord({
    spec, taskFile: "/tmp/p.yaml", home,
    id: "profile-task-id", sessionId: "s-pt", createdAt: new Date().toISOString(),
  });
  assert.equal(record.spec.directCodexProfileId, "myProfile-v2");
  store.createTask(record);

  // Retrieval preserves profile identity
  const retrieved = store.getTask("profile-task-id");
  assert.equal(retrieved.spec.directCodexProfileId, "myProfile-v2");

  // Legacy task without directCodexProfileId remains absent
  const legacySpec = parseTaskSpec({
    version: 1, name: "NoProfile", project: "/tmp/source",
    goal: "Test", acceptance: { commands: ["true"] },
  }, "/tmp");
  assert.equal(legacySpec.directCodexProfileId, undefined);
  assert.equal("directCodexProfileId" in legacySpec, false);

  const legacyRecord = buildTaskRecord({
    spec: legacySpec, taskFile: "/tmp/l.yaml", home,
    id: "no-profile-id", sessionId: "s-np", createdAt: new Date().toISOString(),
  });
  assert.equal(legacyRecord.spec.directCodexProfileId, undefined);
  store.createTask(legacyRecord);
  const retrievedLegacy = store.getTask("no-profile-id");
  assert.equal(retrievedLegacy.spec.directCodexProfileId, undefined);

  store.close();
});

test("noncanonical profile id → rejected at parse time without echoing", async () => {
  for (const bad of ["", " has-space ", "-bad", "x/y", "x:y", "a".repeat(65), 123, true, null]) {
    assert.throws(
      () => parseTaskSpec({
        version: 1, name: "Bad", project: "/tmp/source",
        goal: "T", directCodexProfileId: bad,
        acceptance: { commands: ["true"] },
      }, "/tmp"),
      /directCodexProfileId/,
    );
  }
  // Verify the error does not echo secret-like values
  const secret = "leaked-profile-abcd-1234";
  assert.throws(
    () => parseTaskSpec({
      version: 1, name: "Bad", project: "/tmp/source",
      goal: "T", directCodexProfileId: secret + ":",
      acceptance: { commands: ["true"] },
    }, "/tmp"),
    (e: any) => e instanceof TypeError && !e.message.includes(secret) && e.message.includes("directCodexProfileId"),
  );
});

// --- Direct-Codex paired-sample evidence registry ---

function validPairedSample(overrides?: Record<string, unknown>): Record<string, unknown> {
  return { sampleId: "smp-001", forklightTaskId: "task-ev", exactTaskClass: "edit-task",
    directCodexProfileId: "profA", inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 200,
    cacheCreationInputTokens: 50, source: "codex-terminal-result", complete: true,
    directRunRef: "codex-run:a1b2c3d4", pairingRef: "pair:xyz-001",
    capturedAt: TS, schemaVersion: 1, ...overrides };
}

function createTaskWithProfile(store: any, id: string, taskClass: string, profileId: string, ts: string): void {
  const home = (store as any).databasePath.replace(/\/forklight\.sqlite$/, "");
  const spec = parseTaskSpec({ version: 1, name: id, project: "/tmp/source", goal: "Evidence task",
    taskClass, directCodexProfileId: profileId, acceptance: { commands: ["true"] } }, "/tmp");
  store.createTask(buildTaskRecord({ spec, taskFile: `/tmp/${id}.yaml`, home, id,
    sessionId: `session-${id}`, createdAt: ts }));
}

test("paired-sample save, identity checks, duplicates, and list ordering", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-smp-"));
  const ts = new Date().toISOString();
  const store = new StateStore(home);
  createTaskWithProfile(store, "task-ev", "edit-task", "profA", ts);

  // --- Eligible save → frozen, Task-identity-verified return ---
  store.saveDirectCodexPairedSample(validPairedSample({ forklightTaskId: "task-ev" }));
  const s = store.getDirectCodexPairedSample("smp-001");
  assert.equal(s.sampleId, "smp-001"); assert.equal(s.exactTaskClass, "edit-task");
  assert.ok(Object.isFrozen(s));

  // --- Task identity missing/mismatched → fail (detected before FK) ---
  const noClass = buildTaskRecord({ spec: parseTaskSpec({ version: 1, name: "no-cls",
    project: "/tmp", goal: "T", acceptance: { commands: ["true"] } }, "/tmp"),
    taskFile: "/tmp/nc.yaml", home, id: "no-cls", sessionId: "s-nc", createdAt: ts });
  store.createTask(noClass);
  assert.throws(() => store.saveDirectCodexPairedSample(validPairedSample({ forklightTaskId: "no-cls" })),
    { name: "Error", message: "Sample taskClass does not match declared Task identity" });

  createTaskWithProfile(store, "task-mc", "other-class", "profA", ts);
  assert.throws(() => store.saveDirectCodexPairedSample(validPairedSample({ forklightTaskId: "task-mc" })),
    { name: "Error", message: "Sample taskClass does not match declared Task identity" });

  const noProf = buildTaskRecord({ spec: parseTaskSpec({ version: 1, name: "no-pf",
    project: "/tmp", goal: "T", taskClass: "edit-task", acceptance: { commands: ["true"] } }, "/tmp"),
    taskFile: "/tmp/np.yaml", home, id: "no-pf", sessionId: "s-np", createdAt: ts });
  store.createTask(noProf);
  assert.throws(() => store.saveDirectCodexPairedSample(validPairedSample({ forklightTaskId: "no-pf" })),
    { name: "Error", message: "Sample directCodexProfileId does not match declared Task identity" });

  createTaskWithProfile(store, "task-mp", "edit-task", "profB", ts);
  assert.throws(() => store.saveDirectCodexPairedSample(validPairedSample({ forklightTaskId: "task-mp" })), {
    name: "Error", message: "Sample directCodexProfileId does not match declared Task identity" });

  // Missing task → caught before FK with fixed non-echoing error
  assert.throws(() => store.saveDirectCodexPairedSample(validPairedSample({ forklightTaskId: "no-task" })),
    { name: "Error", message: "Sample references unknown Task" });

  // --- Duplicates: sampleId / directRunRef / pairingRef UNIQUE ---
  store.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-uniq",
    forklightTaskId: "task-ev", directRunRef: "codex-run:u1", pairingRef: "pair:u1" }));
  assert.throws(() => store.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-uniq",
    forklightTaskId: "task-ev", directRunRef: "codex-run:u2", pairingRef: "pair:u2" })), /UNIQUE/);
  createTaskWithProfile(store, "task-dr2", "edit-task", "profA", ts);
  assert.throws(() => store.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-dr2",
    forklightTaskId: "task-dr2", directRunRef: "codex-run:u1", pairingRef: "pair:dr2" })), /UNIQUE/);
  assert.throws(() => store.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-pr2",
    forklightTaskId: "task-dr2", directRunRef: "codex-run:pr2", pairingRef: "pair:u1" })), /UNIQUE/);

  // --- List by exact pair in deterministic order ---
  createTaskWithProfile(store, "task-L1", "class-L", "profL", ts);
  createTaskWithProfile(store, "task-L2", "class-L", "profL", ts);
  store.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-L1", forklightTaskId: "task-L1",
    exactTaskClass: "class-L", directCodexProfileId: "profL", capturedAt: "2026-01-02T00:00:00.000Z",
    directRunRef: "codex-run:rL1", pairingRef: "pair:pL1" }));
  store.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-L2", forklightTaskId: "task-L2",
    exactTaskClass: "class-L", directCodexProfileId: "profL", capturedAt: "2026-01-01T00:00:00.000Z",
    directRunRef: "codex-run:rL2", pairingRef: "pair:pL2" }));
  const list = store.listDirectCodexPairedSamples("class-L", "profL");
  assert.equal(list.length, 2);
  assert.equal(list[0]!.sampleId, "smp-L2"); assert.equal(list[1]!.sampleId, "smp-L1");
  assert.deepEqual(store.listDirectCodexPairedSamples("CLASS-L", "profL"), []);

  // --- Stricter sampleId validation: reject padded/non-canonical ---
  assert.throws(() => store.getDirectCodexPairedSample(""), { name: "TypeError", message: "Invalid sampleId" });
  assert.throws(() => store.getDirectCodexPairedSample(" smp-001"), { name: "TypeError", message: "Invalid sampleId" });
  assert.throws(() => store.getDirectCodexPairedSample("-bad"), { name: "TypeError", message: "Invalid sampleId" });

  store.close();
});

test("sample migration, corruption, and adversarial Task-identity revalidation", async () => {
  // Legacy migration
  const home1 = await mkdtemp(path.join(tmpdir(), "forklight-smp-mig-"));
  const dbPath = path.join(home1, "forklight.sqlite");
  const ts = new Date().toISOString();
  const legacy = new DatabaseSync(dbPath);
  legacy.exec("CREATE TABLE tasks (id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at TEXT NOT NULL, record_json TEXT NOT NULL)");
  legacy.prepare("INSERT INTO tasks (id, status, updated_at, record_json) VALUES (?, ?, ?, ?)").run("legacy-sm", "succeeded", ts, JSON.stringify({ id: "legacy-sm", status: "succeeded", updatedAt: ts }));
  legacy.close();
  const migrated = new StateStore(home1);
  assert.equal(migrated.getTask("legacy-sm").id, "legacy-sm");
  assert.deepEqual(migrated.listDirectCodexPairedSamples("any", "any"), []);
  assert.deepEqual(migrated.listPendingDirectCodexPairedSamples("any", "any"), []);
  migrated.close();

  // Corrupt JSON → non-echoing error; normalize failure → wrapped as corruption
  const home2 = await mkdtemp(path.join(tmpdir(), "forklight-smp-corr-"));
  const store2 = new StateStore(home2);
  createTaskWithProfile(store2, "task-cr", "edit-task", "profA", ts);
  store2.close();
  const secret = "sk-crpt-sample-888";
  const raw = new DatabaseSync(path.join(home2, "forklight.sqlite"));
  raw.prepare(`INSERT INTO direct_codex_paired_samples (sample_id, forklight_task_id, task_class, profile_id, direct_run_ref, pairing_ref, captured_at, record_json) VALUES (?,?,?,?,?,?,?,?)`)
    .run("smp-cr", "task-cr", "edit-task", "profA", "codex-run:cr", "pair:cr", TS, `{"secret":"${secret}"}[[[BROKEN`);
  // Also insert one with valid JSON but extra key (normalize failure)
  raw.prepare(`INSERT INTO direct_codex_paired_samples (sample_id, forklight_task_id, task_class, profile_id, direct_run_ref, pairing_ref, captured_at, record_json) VALUES (?,?,?,?,?,?,?,?)`)
    .run("smp-nr", "task-cr", "edit-task", "profA", "codex-run:nr", "pair:nr", TS, JSON.stringify({ ...validPairedSample({ forklightTaskId: "task-cr", sampleId: "smp-nr",
    directRunRef: "codex-run:nr", pairingRef: "pair:nr" }), leakedField: "bad" }));
  raw.close();
  try { new StateStore(home2).getDirectCodexPairedSample("smp-cr"); assert.fail("Expected"); }
  catch (e: any) { assert.ok(!e.message.includes(secret)); assert.equal(e.message, "Corrupt paired-sample record in state database"); }
  assert.throws(() => new StateStore(home2).getDirectCodexPairedSample("smp-nr"),
    { name: "Error", message: "Corrupt paired-sample record in state database" });

  // Column/JSON mismatch
  const home3 = await mkdtemp(path.join(tmpdir(), "forklight-smp-col-"));
  const store3 = new StateStore(home3);
  createTaskWithProfile(store3, "task-col", "edit-task", "profA", ts);
  store3.saveDirectCodexPairedSample(validPairedSample({ forklightTaskId: "task-col" }));
  store3.close();
  const raw3 = new DatabaseSync(path.join(home3, "forklight.sqlite"));
  raw3.prepare("UPDATE direct_codex_paired_samples SET task_class = ? WHERE sample_id = ?").run("forged", "smp-001");
  raw3.close();
  assert.throws(() => new StateStore(home3).getDirectCodexPairedSample("smp-001"),
    { name: "Error", message: "Corrupt paired-sample record in state database" });

  // Adversarial: columns + JSON forged together but Task identity differs
  const home4 = await mkdtemp(path.join(tmpdir(), "forklight-smp-adv-"));
  const store4 = new StateStore(home4);
  createTaskWithProfile(store4, "task-adv", "edit-task", "profA", ts);
  store4.saveDirectCodexPairedSample(validPairedSample({ forklightTaskId: "task-adv" }));
  store4.close();
  const raw4 = new DatabaseSync(path.join(home4, "forklight.sqlite"));
  raw4.prepare("UPDATE direct_codex_paired_samples SET task_class = ? WHERE sample_id = ?").run("forged-class", "smp-001");
  raw4.prepare("UPDATE direct_codex_paired_samples SET record_json = ? WHERE sample_id = ?")
    .run(JSON.stringify({ ...validPairedSample({ forklightTaskId: "task-adv" }), sampleId: "smp-001", exactTaskClass: "forged-class" }), "smp-001");
  raw4.close();
  assert.throws(() => new StateStore(home4).getDirectCodexPairedSample("smp-001"),
    { name: "Error", message: "Corrupt paired-sample record in state database" });

  // Privacy: no raw fields on stored sample
  const home5 = await mkdtemp(path.join(tmpdir(), "forklight-smp-priv-"));
  const store5 = new StateStore(home5);
  createTaskWithProfile(store5, "task-priv", "edit-task", "profA", ts);
  store5.saveDirectCodexPairedSample(validPairedSample({ forklightTaskId: "task-priv" }));
  const sp = store5.getDirectCodexPairedSample("smp-001");
  for (const f of ["text","content","prompt","body","payload","raw","secret","credential","log","response","diff","hash"])
    assert.equal(f in sp, false);
  store5.close();

  // RESTRICT FK: deleting a Task with evidence fails
  const home6 = await mkdtemp(path.join(tmpdir(), "forklight-smp-restr-"));
  const store6 = new StateStore(home6);
  createTaskWithProfile(store6, "task-restr", "edit-task", "profA", ts);
  store6.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-restr", forklightTaskId: "task-restr",
    directRunRef: "codex-run:restr", pairingRef: "pair:restr" }));
  store6.close();
  const raw6 = new DatabaseSync(path.join(home6, "forklight.sqlite"));
  raw6.exec("PRAGMA foreign_keys = ON");
  assert.throws(() => raw6.prepare("DELETE FROM tasks WHERE id = ?").run("task-restr"), /FOREIGN KEY/);
  raw6.close();
});

// --- Direct-Codex review-decision registry ---

function validReviewInput(overrides?: Record<string, unknown>): Record<string, unknown> {
  return { sampleId: "smp-001", decision: "accepted", reviewer: "main-codex",
    reviewedAt: TS, schemaVersion: 1, ...overrides };
}

test("review save/get, immutability, and pending exclusion", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-rev-"));
  const ts = new Date().toISOString();
  const store = new StateStore(home);
  createTaskWithProfile(store, "task-rev", "edit-task", "profA", ts);

  // Accepted review
  store.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-A", forklightTaskId: "task-rev",
    directRunRef: "codex-run:rA", pairingRef: "pair:pA" }));
  store.saveDirectCodexSampleReview(validReviewInput({ sampleId: "smp-A", decision: "accepted" }));
  const rA = store.getDirectCodexSampleReview("smp-A");
  assert.equal(rA.decision, "accepted"); assert.equal("rejectionReason" in rA, false);
  assert.ok(Object.isFrozen(rA));

  // Rejected review
  store.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-B", forklightTaskId: "task-rev",
    directRunRef: "codex-run:rB", pairingRef: "pair:pB" }));
  store.saveDirectCodexSampleReview(validReviewInput({ sampleId: "smp-B", decision: "rejected",
    rejectionReason: "insufficient-quality" }));
  const rB = store.getDirectCodexSampleReview("smp-B");
  assert.equal(rB.decision, "rejected"); assert.equal(rB.rejectionReason, "insufficient-quality");

  // Second decision → UNIQUE, first unchanged
  assert.throws(() => store.saveDirectCodexSampleReview(validReviewInput({ sampleId: "smp-A",
    decision: "rejected", rejectionReason: "duplicate-evidence" })), /UNIQUE/);
  assert.equal(store.getDirectCodexSampleReview("smp-A").decision, "accepted");

  // Review for nonexistent sample → non-echoing error (via full read path)
  assert.throws(() => store.saveDirectCodexSampleReview(validReviewInput({ sampleId: "no-sample" })),
    { name: "Error", message: "Unknown paired sample for review" });
  assert.throws(() => store.getDirectCodexSampleReview("no-review"),
    { name: "Error", message: "No review decision for sample" });
  assert.throws(() => store.getDirectCodexSampleReview(""), { name: "TypeError", message: "Invalid sampleId" });

  // --- Pending: only unreviewed samples ---
  createTaskWithProfile(store, "task-pend", "pend-class", "pendProf", ts);
  store.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-pend", forklightTaskId: "task-pend",
    exactTaskClass: "pend-class", directCodexProfileId: "pendProf",
    directRunRef: "codex-run:pend", pairingRef: "pair:pend" }));
  assert.equal(store.listPendingDirectCodexPairedSamples("pend-class", "pendProf").length, 1);
  // Accepted & rejected samples excluded
  createTaskWithProfile(store, "task-p2", "pend-class", "pendProf", ts);
  store.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-p2", forklightTaskId: "task-p2",
    exactTaskClass: "pend-class", directCodexProfileId: "pendProf",
    directRunRef: "codex-run:p2", pairingRef: "pair:p2" }));
  store.saveDirectCodexSampleReview(validReviewInput({ sampleId: "smp-p2", decision: "accepted" }));
  assert.equal(store.listPendingDirectCodexPairedSamples("pend-class", "pendProf").length, 1);
  assert.deepEqual(store.listPendingDirectCodexPairedSamples("other", "pendProf"), []);

  store.close();
});

test("review corruption, column mismatch, adversarial pending, and privacy", async () => {
  const ts = new Date().toISOString();

  // Column mismatch → corruption
  const home = await mkdtemp(path.join(tmpdir(), "forklight-rev-corr-"));
  const store = new StateStore(home);
  createTaskWithProfile(store, "task-rc", "edit-task", "profA", ts);
  store.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-rc", forklightTaskId: "task-rc",
    directRunRef: "codex-run:rc", pairingRef: "pair:rc" }));
  store.saveDirectCodexSampleReview(validReviewInput({ sampleId: "smp-rc", decision: "accepted" }));
  store.close();
  const raw = new DatabaseSync(path.join(home, "forklight.sqlite"));
  raw.prepare("UPDATE direct_codex_review_decisions SET decision = ? WHERE sample_id = ?").run("rejected", "smp-rc");
  raw.close();
  assert.throws(() => new StateStore(home).getDirectCodexSampleReview("smp-rc"),
    { name: "Error", message: "Corrupt review-decision record in state database" });

  // Corrupt JSON → non-echoing; normalize failure → wrapped as corruption
  const home2 = await mkdtemp(path.join(tmpdir(), "forklight-rev-cr2-"));
  const store2 = new StateStore(home2);
  createTaskWithProfile(store2, "task-cr2", "edit-task", "profA", ts);
  store2.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-cr2", forklightTaskId: "task-cr2",
    directRunRef: "codex-run:cr2", pairingRef: "pair:cr2" }));
  store2.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-rn", forklightTaskId: "task-cr2",
    directRunRef: "codex-run:rn", pairingRef: "pair:rn" }));
  store2.close();
  const secret = "sk-review-leak-777";
  const raw2 = new DatabaseSync(path.join(home2, "forklight.sqlite"));
  raw2.prepare(`INSERT INTO direct_codex_review_decisions (sample_id, decision, rejection_reason, reviewer, reviewed_at, record_json) VALUES (?,?,?,?,?,?)`)
    .run("smp-cr2", "accepted", null, "main-codex", TS, `{"secret":"${secret}"}[[[BROKEN`);
  // Also insert valid JSON with extra key (normalize failure)
  raw2.prepare(`INSERT INTO direct_codex_review_decisions (sample_id, decision, rejection_reason, reviewer, reviewed_at, record_json) VALUES (?,?,?,?,?,?)`)
    .run("smp-rn", "accepted", null, "main-codex", TS, JSON.stringify({ sampleId: "smp-rn", decision: "accepted", reviewer: "main-codex", reviewedAt: TS, schemaVersion: 1, extraBad: true }));
  raw2.close();
  try { new StateStore(home2).getDirectCodexSampleReview("smp-cr2"); assert.fail("Expected"); }
  catch (e: any) { assert.ok(!e.message.includes(secret)); assert.equal(e.message, "Corrupt review-decision record in state database"); }
  assert.throws(() => new StateStore(home2).getDirectCodexSampleReview("smp-rn"),
    { name: "Error", message: "Corrupt review-decision record in state database" });

  // Adversarial: corrupt review must NOT silently hide sample via pending
  const home3 = await mkdtemp(path.join(tmpdir(), "forklight-rev-pend-"));
  const store3 = new StateStore(home3);
  createTaskWithProfile(store3, "task-ap", "adv-pend", "profAP", ts);
  store3.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-ap", forklightTaskId: "task-ap",
    exactTaskClass: "adv-pend", directCodexProfileId: "profAP",
    directRunRef: "codex-run:ap", pairingRef: "pair:ap" }));
  store3.close();
  const raw3 = new DatabaseSync(path.join(home3, "forklight.sqlite"));
  raw3.prepare(`INSERT INTO direct_codex_review_decisions (sample_id, decision, rejection_reason, reviewer, reviewed_at, record_json) VALUES (?,?,?,?,?,?)`)
    .run("smp-ap", "accepted", null, "main-codex", TS, `{broken[[[`);
  raw3.close();
  assert.throws(() => new StateStore(home3).listPendingDirectCodexPairedSamples("adv-pend", "profAP"),
    { name: "Error", message: "Corrupt review-decision record in state database" });

  // Corruption in sample → review save propagates (not mislabeled as missing)
  const home4 = await mkdtemp(path.join(tmpdir(), "forklight-rev-cs-"));
  const store4 = new StateStore(home4);
  createTaskWithProfile(store4, "task-cs", "edit-task", "profA", ts);
  store4.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-cs", forklightTaskId: "task-cs",
    directRunRef: "codex-run:cs", pairingRef: "pair:cs" }));
  store4.close();
  const raw4 = new DatabaseSync(path.join(home4, "forklight.sqlite"));
  raw4.prepare("UPDATE direct_codex_paired_samples SET record_json = ? WHERE sample_id = ?")
    .run(JSON.stringify({ ...validPairedSample({ forklightTaskId: "task-cs" }), sampleId: "smp-cs", extraBad: true }), "smp-cs");
  raw4.close();
  assert.throws(() => new StateStore(home4).saveDirectCodexSampleReview(validReviewInput({ sampleId: "smp-cs" })),
    { name: "Error", message: "Corrupt paired-sample record in state database" });

  // Review revalidation: forged sample identity breaks review read
  const home5 = await mkdtemp(path.join(tmpdir(), "forklight-rev-rv-"));
  const store5 = new StateStore(home5);
  createTaskWithProfile(store5, "task-rv", "edit-task", "profA", ts);
  store5.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-rv", forklightTaskId: "task-rv",
    directRunRef: "codex-run:rv", pairingRef: "pair:rv" }));
  store5.saveDirectCodexSampleReview(validReviewInput({ sampleId: "smp-rv", decision: "accepted" }));
  store5.close();
  const raw5 = new DatabaseSync(path.join(home5, "forklight.sqlite"));
  raw5.prepare("UPDATE direct_codex_paired_samples SET task_class = ? WHERE sample_id = ?").run("forged-class", "smp-rv");
  raw5.prepare("UPDATE direct_codex_paired_samples SET record_json = ? WHERE sample_id = ?")
    .run(JSON.stringify({ ...validPairedSample({ forklightTaskId: "task-rv" }), sampleId: "smp-rv", exactTaskClass: "forged-class" }), "smp-rv");
  raw5.close();
  assert.throws(() => new StateStore(home5).getDirectCodexSampleReview("smp-rv"),
    { name: "Error", message: "Corrupt paired-sample record in state database" });

  // Privacy: no raw fields in stored review
  const home6 = await mkdtemp(path.join(tmpdir(), "forklight-rev-priv-"));
  const store6 = new StateStore(home6);
  createTaskWithProfile(store6, "task-rp", "edit-task", "profA", ts);
  store6.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-rp", forklightTaskId: "task-rp",
    directRunRef: "codex-run:rp", pairingRef: "pair:rp" }));
  store6.saveDirectCodexSampleReview(validReviewInput({ sampleId: "smp-rp", decision: "rejected",
    rejectionReason: "not-equivalent-task" }));
  const rp = store6.getDirectCodexSampleReview("smp-rp");
  for (const f of ["text","content","prompt","body","payload","raw","secret","credential","log","response","notes","diff","hash"])
    assert.equal(f in rp, false);
  assert.equal("sampleId" in rp, true); assert.equal("rejectionReason" in rp, true);
  store6.close();
});

// --- Optional review lookup --------------------------------------------------

test("optional review lookup returns undefined for no review, frozen review when present", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-rev-opt-"));
  const ts = new Date().toISOString();
  const store = new StateStore(home);
  createTaskWithProfile(store, "task-opt", "edit-task", "profA", ts);

  // No review → undefined
  store.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-opt", forklightTaskId: "task-opt",
    directRunRef: "codex-run:opt", pairingRef: "pair:opt" }));
  assert.equal(store.getDirectCodexSampleReviewOptional("smp-opt"), undefined);

  // After saving accepted review → returned frozen
  store.saveDirectCodexSampleReview(validReviewInput({ sampleId: "smp-opt", decision: "accepted" }));
  const r = store.getDirectCodexSampleReviewOptional("smp-opt");
  assert.ok(r !== undefined);
  assert.equal(r!.decision, "accepted");
  assert.ok(Object.isFrozen(r!));

  // After saving rejected review on different sample → returned frozen
  store.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-opt2", forklightTaskId: "task-opt",
    directRunRef: "codex-run:opt2", pairingRef: "pair:opt2" }));
  store.saveDirectCodexSampleReview(validReviewInput({ sampleId: "smp-opt2", decision: "rejected",
    rejectionReason: "duplicate-evidence" }));
  const r2 = store.getDirectCodexSampleReviewOptional("smp-opt2");
  assert.ok(r2 !== undefined);
  assert.equal(r2!.decision, "rejected");
  assert.equal(r2!.rejectionReason, "duplicate-evidence");

  store.close();
});

test("optional review lookup revalidates sample identity; corrupt sample fails closed", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-rev-opt-id-"));
  const ts = new Date().toISOString();
  const store = new StateStore(home);
  createTaskWithProfile(store, "task-oid", "edit-task", "profA", ts);
  store.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-oid", forklightTaskId: "task-oid",
    directRunRef: "codex-run:oid", pairingRef: "pair:oid" }));
  store.saveDirectCodexSampleReview(validReviewInput({ sampleId: "smp-oid", decision: "accepted" }));
  store.close();

  // Forge sample identity → optional lookup fails closed
  const raw = new DatabaseSync(path.join(home, "forklight.sqlite"));
  raw.prepare("UPDATE direct_codex_paired_samples SET task_class = ? WHERE sample_id = ?")
    .run("forged-class", "smp-oid");
  raw.prepare("UPDATE direct_codex_paired_samples SET record_json = ? WHERE sample_id = ?")
    .run(JSON.stringify({ ...validPairedSample({ forklightTaskId: "task-oid" }),
      sampleId: "smp-oid", exactTaskClass: "forged-class" }), "smp-oid");
  raw.close();

  assert.throws(
    () => new StateStore(home).getDirectCodexSampleReviewOptional("smp-oid"),
    { name: "Error", message: "Corrupt paired-sample record in state database" },
  );
});

test("optional review lookup: corrupt JSON → fails closed without echoing", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-rev-opt-cr-"));
  const ts = new Date().toISOString();
  const store = new StateStore(home);
  createTaskWithProfile(store, "task-ocr", "edit-task", "profA", ts);
  store.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-ocr", forklightTaskId: "task-ocr",
    directRunRef: "codex-run:ocr", pairingRef: "pair:ocr" }));
  store.close();

  const secret = "sk-opt-leak-456";
  const raw = new DatabaseSync(path.join(home, "forklight.sqlite"));
  raw.prepare(
    `INSERT INTO direct_codex_review_decisions (sample_id, decision, rejection_reason, reviewer, reviewed_at, record_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("smp-ocr", "accepted", null, "main-codex", TS, `{"secret":"${secret}"}[[[BROKEN`);
  raw.close();

  try {
    new StateStore(home).getDirectCodexSampleReviewOptional("smp-ocr");
    assert.fail("Expected error");
  } catch (e: any) {
    assert.ok(!e.message.includes(secret), `Error echoed secret: ${e.message}`);
    assert.equal(e.message, "Corrupt review-decision record in state database");
  }
});

test("optional review lookup: column mismatch → fails closed", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-rev-opt-col-"));
  const ts = new Date().toISOString();
  const store = new StateStore(home);
  createTaskWithProfile(store, "task-ocol", "edit-task", "profA", ts);
  store.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-ocol", forklightTaskId: "task-ocol",
    directRunRef: "codex-run:ocol", pairingRef: "pair:ocol" }));
  store.saveDirectCodexSampleReview(validReviewInput({ sampleId: "smp-ocol", decision: "accepted" }));
  store.close();

  const raw = new DatabaseSync(path.join(home, "forklight.sqlite"));
  raw.prepare("UPDATE direct_codex_review_decisions SET decision = ? WHERE sample_id = ?")
    .run("rejected", "smp-ocol");
  raw.close();

  assert.throws(
    () => new StateStore(home).getDirectCodexSampleReviewOptional("smp-ocol"),
    { name: "Error", message: "Corrupt review-decision record in state database" },
  );
});

test("optional review lookup: invalid sampleId → rejected", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-rev-opt-inv-"));
  const store = new StateStore(home);
  assert.throws(
    () => store.getDirectCodexSampleReviewOptional(""),
    { name: "TypeError", message: "Invalid sampleId" },
  );
  assert.throws(
    () => store.getDirectCodexSampleReviewOptional("-bad"),
    { name: "TypeError", message: "Invalid sampleId" },
  );
  store.close();
});

test("optional review lookup: undefined means no row only, never hides accepted/rejected/malformed", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-rev-opt-sem-"));
  const ts = new Date().toISOString();
  const store = new StateStore(home);
  createTaskWithProfile(store, "task-os1", "edit-task", "profA", ts);
  createTaskWithProfile(store, "task-os2", "edit-task", "profA", ts);
  createTaskWithProfile(store, "task-os3", "edit-task", "profA", ts);
  store.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-os1", forklightTaskId: "task-os1",
    directRunRef: "codex-run:os1", pairingRef: "pair:os1" }));
  store.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-os2", forklightTaskId: "task-os2",
    directRunRef: "codex-run:os2", pairingRef: "pair:os2" }));
  store.saveDirectCodexPairedSample(validPairedSample({ sampleId: "smp-os3", forklightTaskId: "task-os3",
    directRunRef: "codex-run:os3", pairingRef: "pair:os3" }));
  store.saveDirectCodexSampleReview(validReviewInput({ sampleId: "smp-os1", decision: "accepted" }));
  store.saveDirectCodexSampleReview(validReviewInput({ sampleId: "smp-os2", decision: "rejected",
    rejectionReason: "insufficient-quality" }));
  // smp-os3 has no review → should be undefined (pending)

  // Accepted → returned
  const r1 = store.getDirectCodexSampleReviewOptional("smp-os1");
  assert.ok(r1 !== undefined);
  assert.equal(r1!.decision, "accepted");

  // Rejected → returned
  const r2 = store.getDirectCodexSampleReviewOptional("smp-os2");
  assert.ok(r2 !== undefined);
  assert.equal(r2!.decision, "rejected");

  // No row → undefined (pending)
  assert.equal(store.getDirectCodexSampleReviewOptional("smp-os3"), undefined);

  // Throwing getter delegates to optional getter; identical canonical review
  assert.deepEqual(store.getDirectCodexSampleReview("smp-os1"), r1);
  assert.deepEqual(store.getDirectCodexSampleReview("smp-os2"), r2);

  store.close();
});

// --- FL-112E1: durable ordered Goal–Plan associations ----------------------

function goalFixture(planId: string, timestamp: string): {
  goal: GoalRecord;
  milestones: GoalMilestoneRecord[];
  plan: PlanRecord;
  items: PlanItemRecord[];
  task: TaskRecord;
} {
  const task = queuedTask(`task-${planId}`, timestamp);
  const plan: PlanRecord = {
    id: planId,
    name: `Plan ${planId}`,
    objective: `Objective ${planId}`,
    planFile: `/tmp/${planId}.yaml`,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const items: PlanItemRecord[] = [
    {
      id: "item-0",
      planId: plan.id,
      taskId: task.id,
      itemIndex: 0,
      taskFile: task.taskFile,
    },
  ];
  const goal: GoalRecord = {
    id: `goal-for-${planId}`,
    version: 1,
    name: `Goal ${planId}`,
    objective: `Goal objective ${planId}`,
    planId: plan.id,
    goalFile: `/tmp/goal-${planId}.json`,
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
    evidenceDigest: "c".repeat(64),
    evidenceAt: timestamp,
    counters: { correctionRounds: 0, reviewRounds: 0, noNewEvidenceCycles: 0 },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const milestones: GoalMilestoneRecord[] = [
    {
      goalId: goal.id,
      itemId: "item-0",
      taskId: task.id,
      gate: "machine",
      itemIndex: 0,
      satisfied: false,
      reasonCode: "waiting-machine",
      reason: "waiting",
      updatedAt: timestamp,
    },
  ];
  return { goal, milestones, plan, items, task };
}

test("legacy goals.plan_id backfills ordinal-zero association idempotently", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-gpa-legacy-"));
  const databasePath = path.join(home, "forklight.sqlite");
  const timestamp = "2026-08-01T00:00:00.000Z";
  const planId = "legacy-primary-plan";
  const goalId = "legacy-goal-1";
  const taskId = "legacy-task-1";

  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      record_json TEXT NOT NULL
    );
    CREATE TABLE plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      objective TEXT NOT NULL,
      plan_file TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      record_json TEXT NOT NULL
    );
    CREATE TABLE goals (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL UNIQUE REFERENCES plans(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      record_json TEXT NOT NULL
    );
  `);
  const task = queuedTask(taskId, timestamp);
  const plan: PlanRecord = {
    id: planId,
    name: "Legacy plan",
    objective: "Primary only",
    planFile: "/tmp/legacy-plan.yaml",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const goal: GoalRecord = {
    id: goalId,
    version: 1,
    name: "Legacy goal",
    objective: "One plan",
    planId,
    goalFile: "/tmp/legacy-goal.json",
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
    evidenceDigest: "d".repeat(64),
    evidenceAt: timestamp,
    counters: { correctionRounds: 0, reviewRounds: 0, noNewEvidenceCycles: 0 },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  legacy.prepare(
    "INSERT INTO tasks (id, status, updated_at, record_json) VALUES (?, ?, ?, ?)",
  ).run(task.id, task.status, task.updatedAt, JSON.stringify(task));
  legacy.prepare(
    "INSERT INTO plans (id, name, objective, plan_file, created_at, updated_at, record_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(plan.id, plan.name, plan.objective, plan.planFile, plan.createdAt, plan.updatedAt, JSON.stringify(plan));
  legacy.prepare(
    "INSERT INTO goals (id, plan_id, status, created_at, updated_at, record_json) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(goal.id, goal.planId, goal.status, goal.createdAt, goal.updatedAt, JSON.stringify(goal));
  legacy.close();

  const first = new StateStore(home);
  const associations = first.listGoalPlanAssociations(goalId);
  assert.equal(associations.length, 1);
  assert.deepEqual(associations[0], {
    goalId,
    planId,
    ordinal: 0,
    createdAt: timestamp,
  });
  assert.equal(first.getGoalByPlanId(planId)?.id, goalId);
  assert.equal(first.getGoal(goalId).planId, planId);
  first.close();

  const second = new StateStore(home);
  const again = second.listGoalPlanAssociations(goalId);
  assert.equal(again.length, 1);
  assert.equal(again[0]!.ordinal, 0);
  assert.equal(again[0]!.planId, planId);
  // Direct row count proves no duplication on reopen.
  const raw = new DatabaseSync(databasePath);
  const count = raw.prepare(
    "SELECT COUNT(*) AS n FROM goal_plan_associations WHERE goal_id = ?",
  ).get(goalId) as { n: number };
  assert.equal(count.n, 1);
  raw.close();
  second.close();
});

test("createPlanExecutionWithGoal inserts primary association; attach appends ordered later Plans", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-gpa-attach-"));
  const timestamp = "2026-08-02T00:00:00.000Z";
  const store = new StateStore(home);
  const primary = goalFixture("primary-plan", timestamp);
  store.createPlanExecutionWithGoal(
    [{ task: primary.task, creationEvent: { summary: "created", payload: {} } }],
    primary.plan,
    primary.items,
    [],
    primary.goal,
    primary.milestones,
  );

  const primaryAssociations = store.listGoalPlanAssociations(primary.goal.id);
  assert.equal(primaryAssociations.length, 1);
  assert.equal(primaryAssociations[0]!.planId, "primary-plan");
  assert.equal(primaryAssociations[0]!.ordinal, 0);
  assert.equal(store.getGoalByPlanId("primary-plan")?.id, primary.goal.id);

  const laterTask = queuedTask("task-later-plan", timestamp);
  const laterPlan: PlanRecord = {
    id: "later-plan",
    name: "Later phase",
    objective: "Second phase",
    planFile: "/tmp/later-plan.yaml",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  store.createTask(laterTask);
  store.createPlanGraph(
    laterPlan,
    [{
      id: "later-item",
      planId: laterPlan.id,
      taskId: laterTask.id,
      itemIndex: 0,
      taskFile: laterTask.taskFile,
    }],
    [],
  );

  const attached = store.attachPlanToGoal(primary.goal.id, laterPlan.id);
  assert.equal(attached.ordinal, 1);
  assert.equal(attached.planId, laterPlan.id);

  const ordered = store.listGoalPlanAssociations(primary.goal.id);
  assert.deepEqual(
    ordered.map((row) => ({ planId: row.planId, ordinal: row.ordinal })),
    [
      { planId: "primary-plan", ordinal: 0 },
      { planId: "later-plan", ordinal: 1 },
    ],
  );
  assert.equal(store.getGoalByPlanId("later-plan")?.id, primary.goal.id);
  assert.equal(store.getGoalByTaskId(laterTask.id)?.id, primary.goal.id);
  // Legacy primary field unchanged.
  assert.equal(store.getGoal(primary.goal.id).planId, "primary-plan");

  store.close();
});

test("attachPlanToGoal fails closed on missing rows, duplicate ownership, and re-association", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-gpa-fail-"));
  const timestamp = "2026-08-03T00:00:00.000Z";
  const store = new StateStore(home);
  const first = goalFixture("goal-a-plan", timestamp);
  const second = goalFixture("goal-b-plan", timestamp);
  // Distinct goal ids from fixture (derived from plan id).
  store.createPlanExecutionWithGoal(
    [{ task: first.task, creationEvent: { summary: "created", payload: {} } }],
    first.plan,
    first.items,
    [],
    first.goal,
    first.milestones,
  );
  store.createPlanExecutionWithGoal(
    [{ task: second.task, creationEvent: { summary: "created", payload: {} } }],
    second.plan,
    second.items,
    [],
    second.goal,
    second.milestones,
  );

  const freeTask = queuedTask("task-free-plan", timestamp);
  const freePlan: PlanRecord = {
    id: "free-plan",
    name: "Free",
    objective: "Unowned",
    planFile: "/tmp/free.yaml",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  store.createTask(freeTask);
  store.createPlanGraph(
    freePlan,
    [{
      id: "free-item",
      planId: freePlan.id,
      taskId: freeTask.id,
      itemIndex: 0,
      taskFile: freeTask.taskFile,
    }],
    [],
  );

  assert.throws(() => store.attachPlanToGoal("missing-goal", freePlan.id), /Unknown ForkLight goal/);
  assert.throws(() => store.attachPlanToGoal(first.goal.id, "missing-plan"), /Unknown ForkLight plan/);
  assert.throws(
    () => store.attachPlanToGoal(first.goal.id, first.plan.id),
    /already associated/,
  );
  assert.throws(
    () => store.attachPlanToGoal(first.goal.id, second.plan.id),
    /already owned by goal/,
  );

  // Successful attach then re-attach fails without mutating order.
  store.attachPlanToGoal(first.goal.id, freePlan.id);
  assert.throws(
    () => store.attachPlanToGoal(first.goal.id, freePlan.id),
    /already associated/,
  );
  assert.throws(
    () => store.attachPlanToGoal(second.goal.id, freePlan.id),
    /already owned by goal/,
  );
  assert.deepEqual(
    store.listGoalPlanAssociations(first.goal.id).map((row) => row.planId),
    ["goal-a-plan", "free-plan"],
  );
  assert.deepEqual(
    store.listGoalPlanAssociations(second.goal.id).map((row) => row.planId),
    ["goal-b-plan"],
  );
  assert.throws(() => store.listGoalPlanAssociations("missing-goal"), /Unknown ForkLight goal/);

  store.close();
});

// --- FL-112E2: plan-qualified milestone identity + atomic multi-phase Goals ---

function multiPhaseGoalFixture(planIds: string[], timestamp: string): {
  goal: GoalRecord;
  milestones: GoalMilestoneRecord[];
  plans: PlanRecord[];
  itemsByPlan: PlanItemRecord[][];
  dependenciesByPlan: DependencyRecord[][];
  associations: GoalPlanAssociation[];
  registrationsByPlan: Array<Array<{ task: TaskRecord; creationEvent: { summary: string; payload?: unknown } }>>;
} {
  const goal: GoalRecord = {
    id: `goal-for-${planIds[0]}`,
    version: 1,
    name: `Goal ${planIds[0]}`,
    objective: `Goal objective ${planIds[0]}`,
    planId: planIds[0]!,
    goalFile: `/tmp/goal-${planIds[0]}.json`,
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
    evidenceDigest: "c".repeat(64),
    evidenceAt: timestamp,
    counters: { correctionRounds: 0, reviewRounds: 0, noNewEvidenceCycles: 0 },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const plans: PlanRecord[] = [];
  const itemsByPlan: PlanItemRecord[][] = [];
  const dependenciesByPlan: DependencyRecord[][] = [];
  const registrationsByPlan: Array<Array<{ task: TaskRecord; creationEvent: { summary: string; payload?: unknown } }>> = [];
  const milestones: GoalMilestoneRecord[] = [];
  const associations: GoalPlanAssociation[] = [];

  planIds.forEach((planId, index) => {
    const task = queuedTask(`task-${planId}`, timestamp);
    const plan: PlanRecord = {
      id: planId,
      name: `Plan ${planId}`,
      objective: `Objective ${planId}`,
      planFile: `/tmp/${planId}.yaml`,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const items: PlanItemRecord[] = [{
      id: "item-1",
      planId,
      taskId: task.id,
      itemIndex: 0,
      taskFile: task.taskFile,
    }];
    plans.push(plan);
    itemsByPlan.push(items);
    dependenciesByPlan.push([]);
    registrationsByPlan.push([{ task, creationEvent: { summary: `Task created: ${task.name}`, payload: {} } }]);
    associations.push({ goalId: goal.id, planId, ordinal: index, createdAt: timestamp });
    milestones.push({
      goalId: goal.id,
      planId,
      itemId: "item-1",
      taskId: task.id,
      gate: "machine",
      itemIndex: 0,
      satisfied: false,
      reasonCode: "waiting-machine",
      reason: "waiting",
      updatedAt: timestamp,
    });
  });

  return {
    goal,
    milestones,
    plans,
    itemsByPlan,
    dependenciesByPlan,
    associations,
    registrationsByPlan,
  };
}

test("legacy goal milestone rows migrate to plan-qualified identity", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-gm-migrate-"));
  const databasePath = path.join(home, "forklight.sqlite");
  const timestamp = "2026-08-05T00:00:00.000Z";
  const planId = "legacy-mp-plan";
  const goalId = "legacy-mp-goal";
  const taskId = "legacy-mp-task";

  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      record_json TEXT NOT NULL
    );
    CREATE TABLE plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      objective TEXT NOT NULL,
      plan_file TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      record_json TEXT NOT NULL
    );
    CREATE TABLE goals (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL UNIQUE REFERENCES plans(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      record_json TEXT NOT NULL
    );
    CREATE TABLE goal_milestones (
      goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      gate TEXT NOT NULL,
      item_index INTEGER NOT NULL,
      satisfied INTEGER NOT NULL DEFAULT 0,
      record_json TEXT NOT NULL,
      PRIMARY KEY (goal_id, item_id),
      UNIQUE (goal_id, item_index)
    );
  `);
  const task = queuedTask(taskId, timestamp);
  const plan: PlanRecord = {
    id: planId,
    name: "Legacy mp plan",
    objective: "Primary",
    planFile: "/tmp/legacy-mp.yaml",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const goal: GoalRecord = {
    id: goalId,
    version: 1,
    name: "Legacy mp goal",
    objective: "One plan",
    planId,
    goalFile: "/tmp/legacy-mp-goal.json",
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
    evidenceDigest: "e".repeat(64),
    evidenceAt: timestamp,
    counters: { correctionRounds: 0, reviewRounds: 0, noNewEvidenceCycles: 0 },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const milestoneRecord = {
    goalId,
    itemId: "item-1",
    taskId,
    gate: "machine",
    itemIndex: 0,
    satisfied: false,
    reasonCode: "waiting-machine",
    reason: "waiting",
    updatedAt: timestamp,
  };
  legacy.prepare("INSERT INTO tasks (id, status, updated_at, record_json) VALUES (?, ?, ?, ?)")
    .run(task.id, task.status, task.updatedAt, JSON.stringify(task));
  legacy.prepare(
    "INSERT INTO plans (id, name, objective, plan_file, created_at, updated_at, record_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(plan.id, plan.name, plan.objective, plan.planFile, plan.createdAt, plan.updatedAt, JSON.stringify(plan));
  legacy.prepare(
    "INSERT INTO goals (id, plan_id, status, created_at, updated_at, record_json) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(goal.id, goal.planId, goal.status, goal.createdAt, goal.updatedAt, JSON.stringify(goal));
  legacy.prepare(
    `INSERT INTO goal_milestones (goal_id, item_id, task_id, gate, item_index, satisfied, record_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(goalId, "item-1", taskId, "machine", 0, 0, JSON.stringify(milestoneRecord));
  legacy.close();

  const migrated = new StateStore(home);
  const milestones = migrated.getGoalMilestones(goalId);
  assert.equal(milestones.length, 1);
  assert.equal(milestones[0]!.planId, planId);
  assert.equal(milestones[0]!.itemId, "item-1");
  assert.deepEqual(
    migrated.listGoalPlanAssociations(goalId).map((row) => row.planId),
    [planId],
  );
  migrated.close();

  // Re-open is idempotent and never duplicates rows.
  const again = new StateStore(home);
  assert.equal(again.getGoalMilestones(goalId)[0]!.planId, planId);
  const raw = new DatabaseSync(databasePath);
  const count = raw.prepare(
    "SELECT COUNT(*) AS n FROM goal_milestones WHERE goal_id = ?",
  ).get(goalId) as { n: number };
  assert.equal(count.n, 1);
  raw.close();
  again.close();
});

test("createGoalPhasesExecution commits every phase graph and plan-qualified milestone", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-gpe-commit-"));
  const timestamp = "2026-08-06T00:00:00.000Z";
  const store = new StateStore(home);
  const fixture = multiPhaseGoalFixture(["plan-a", "plan-b"], timestamp);
  store.createGoalPhasesExecution(fixture);

  assert.equal(store.listTasks().length, 2);
  assert.deepEqual(store.listPlans().map((p) => p.id).sort(), ["plan-a", "plan-b"]);
  assert.deepEqual(
    store.listGoalPlanAssociations(fixture.goal.id).map((row) => row.planId),
    ["plan-a", "plan-b"],
  );
  const milestones = store.getGoalMilestones(fixture.goal.id);
  assert.equal(milestones.length, 2);
  assert.equal(milestones[0]!.planId, "plan-a");
  assert.equal(milestones[1]!.planId, "plan-b");
  assert.equal(milestones[0]!.itemId, "item-1");
  assert.equal(milestones[1]!.itemId, "item-1");
  assert.equal(store.getGoal(fixture.goal.id).planId, "plan-a");

  // Duplicate local item ids stay addressable by Plan + item.
  const planAMilestone = store.getGoalMilestone(fixture.goal.id, "item-1", "plan-a")!;
  const planBMilestone = store.getGoalMilestone(fixture.goal.id, "item-1", "plan-b")!;
  assert.equal(planAMilestone.planId, "plan-a");
  assert.equal(planBMilestone.planId, "plan-b");
  assert.notEqual(planAMilestone.taskId, planBMilestone.taskId);
  store.close();
});

test("createGoalPhasesExecution rolls back every row when a later phase fails", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-gpe-rollback-"));
  const timestamp = "2026-08-06T00:00:00.000Z";
  const store = new StateStore(home);
  const fixture = multiPhaseGoalFixture(["plan-a", "plan-b"], timestamp);
  // Phase two reuses the phase-one Task to force a relational UNIQUE failure
  // after phase one has already been inserted inside the transaction.
  const phaseOneTask = fixture.registrationsByPlan[0]![0]!.task;
  fixture.registrationsByPlan[1] = [{
    task: phaseOneTask,
    creationEvent: { summary: "duplicate", payload: {} },
  }];
  fixture.itemsByPlan[1] = [{
    id: "item-1",
    planId: "plan-b",
    taskId: phaseOneTask.id,
    itemIndex: 0,
    taskFile: phaseOneTask.taskFile,
  }];
  // The phase-two milestone must reference the reused Task so semantic
  // validation passes and the conflict surfaces only during insert.
  fixture.milestones[1] = { ...fixture.milestones[1]!, taskId: phaseOneTask.id };

  assert.throws(() => store.createGoalPhasesExecution(fixture), /UNIQUE constraint failed/);
  assert.deepEqual(store.listTasks(), []);
  assert.deepEqual(store.listPlans(), []);
  assert.deepEqual(store.listGoals(), []);
  assert.deepEqual(store.getPlanItems("plan-a"), []);
  assert.deepEqual(store.getDependencies("plan-a"), []);
  assert.equal(store.getGoalMilestones(fixture.goal.id).length, 0);
  store.close();
});

test("createGoalPhasesExecution rejects missing or duplicate milestone coverage per Plan item", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-gpe-coverage-"));
  const timestamp = "2026-08-06T00:00:00.000Z";

  // Missing: phase-two item has no plan-qualified milestone.
  {
    const store = new StateStore(home);
    const fixture = multiPhaseGoalFixture(["plan-a", "plan-b"], timestamp);
    fixture.milestones = [fixture.milestones[0]!];
    assert.throws(
      () => store.createGoalPhasesExecution(fixture),
      /Plan item item-1 is missing a goal milestone gate/,
    );
    assert.deepEqual(store.listPlans(), []);
    assert.deepEqual(store.listGoals(), []);
    store.close();
  }

  // Duplicate: phase-one item gets a second identical milestone.
  {
    const store = new StateStore(home);
    const fixture = multiPhaseGoalFixture(["plan-a", "plan-b"], timestamp);
    fixture.milestones = [
      ...fixture.milestones,
      { ...fixture.milestones[0]!, itemId: "item-1" },
    ];
    assert.throws(
      () => store.createGoalPhasesExecution(fixture),
      /Plan item item-1 has duplicate goal milestone gates/,
    );
    assert.deepEqual(store.listPlans(), []);
    assert.deepEqual(store.listGoals(), []);
    store.close();
  }
});

test("createOutcomeIntakeConfirmation rejects multi-phase registration graph mismatch before mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-phase-graph-mismatch-"));
  const store = new StateStore(home);
  const timestamp = "2026-08-07T00:00:00.000Z";
  const fixture = multiPhaseGoalFixture(["phase-a-plan", "phase-b-plan"], timestamp);
  const flatRegistrations = fixture.registrationsByPlan.flat();
  // Receipt and flat registrations agree, but the ordered phase graph is
  // reordered so insertion-facing identity diverges from the receipt surface.
  const reorderedByPlan = [
    fixture.registrationsByPlan[1]!,
    fixture.registrationsByPlan[0]!,
  ];
  const proposed = buildProposedOutcomeIntake(
    createOutcomeIntakeRecord(
      normalizeOutcomeIntakeCreate({ outcome: "Phase graph identity guard" }),
      "intake-phase-graph",
      timestamp,
    ),
    normalizeOutcomeIntakePropose({
      intakeId: "intake-phase-graph",
      expectedRevision: 1,
      shape: "goal",
      reason: "Two ordered phases",
      artifactPath: fixture.goal.goalFile,
    }),
    {
      artifactDigest: "d".repeat(64),
      facts: {
        shape: "goal",
        displayName: fixture.goal.name,
        objective: fixture.goal.objective,
        taskCount: 2,
        goalVersion: 2,
      },
    },
    "2026-08-07T00:00:01.000Z",
  );
  store.createOutcomeIntake(proposed);
  const receipt = buildOutcomeIntakeConfirmationReceipt({
    intakeId: "intake-phase-graph",
    proposalRevision: 2,
    artifactDigest: "d".repeat(64),
    shape: "goal",
    taskIds: flatRegistrations.map(({ task }) => task.id),
    planId: fixture.plans[0]!.id,
    goalId: fixture.goal.id,
    confirmedAt: "2026-08-07T00:00:02.000Z",
  });
  const created = buildCreatedOutcomeIntake(proposed, receipt, "2026-08-07T00:00:02.000Z");

  assert.throws(
    () => store.createOutcomeIntakeConfirmation({
      intakeId: "intake-phase-graph",
      expectedRevision: 2,
      updatedIntake: created,
      registrations: flatRegistrations,
      goal: fixture.goal,
      milestones: fixture.milestones,
      goalPhases: {
        registrationsByPlan: reorderedByPlan,
        plans: fixture.plans,
        itemsByPlan: fixture.itemsByPlan,
        dependenciesByPlan: fixture.dependenciesByPlan,
        associations: fixture.associations,
      },
    }),
    /ordered phase registrations/,
  );

  // Fail closed: zero Task, Plan, Goal, milestone, event, or receipt mutation.
  assert.deepEqual(store.listTasks(), []);
  assert.deepEqual(store.listPlans(), []);
  assert.deepEqual(store.listGoals(), []);
  assert.equal(store.getGoalMilestones(fixture.goal.id).length, 0);
  assert.equal(store.listEvents(flatRegistrations[0]!.task.id).length, 0);
  assert.equal(store.listEvents(flatRegistrations[1]!.task.id).length, 0);
  const intake = store.getOutcomeIntake("intake-phase-graph");
  assert.equal(intake.status, "proposed");
  assert.equal(intake.revision, 2);
  assert.equal(intake.confirmation, undefined);
  store.close();
});

const HANDOFF_TS = "2026-08-14T00:00:00.000Z";

function currentHandoffRecord(
  id: string,
  origin: CandidateHandoffRecord["origin"],
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
    reusablePathCount: 1,
    remainingGapCount: 1,
    reusablePaths: ["src/app.ts"],
    remainingGaps: [{
      description: "finish remaining gap",
      acceptanceExpectation: "tests pass",
    }],
    destinationWorkerProfileId: "grok-builder",
    destinationIdentity: {
      provider: "xai",
      model: "grok-4.6",
      runtime: "grok-build",
      effort: "xhigh",
    },
    successorTaskId,
    reason: "Continue remaining gaps",
    createdAt: HANDOFF_TS,
    updatedAt: HANDOFF_TS,
    preparedAt: HANDOFF_TS,
    nextAction: "wait-for-successor",
  };
}

function authenticLegacyCompetitionJson(record: CandidateHandoffRecord): string {
  if (record.origin.kind !== "competition") {
    throw new Error("legacy fixture requires competition identity");
  }
  const { origin, ...rest } = record;
  return JSON.stringify({
    ...rest,
    competitionId: origin.competitionId,
    sourceCandidateId: origin.sourceCandidateId,
  });
}

function insertRawHandoffJson(
  databasePath: string,
  record: CandidateHandoffRecord,
  recordJson: string,
  competitionId: string,
): void {
  const db = new DatabaseSync(databasePath);
  try {
    db.prepare(
      `INSERT INTO candidate_handoffs
       (id, source_revision_id, source_task_id, successor_task_id, competition_id,
        status, record_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.id,
      record.sourceCandidateRevisionId,
      record.sourceTaskId,
      record.successorTaskId,
      competitionId,
      record.status,
      recordJson,
      record.createdAt,
      record.updatedAt,
    );
  } finally {
    db.close();
  }
}

function readRawHandoffJson(databasePath: string, id: string): string {
  const db = new DatabaseSync(databasePath);
  try {
    const row = db.prepare(
      `SELECT record_json FROM candidate_handoffs WHERE id = ?`,
    ).get(id) as { record_json: string } | undefined;
    if (row === undefined) throw new Error(`missing handoff ${id}`);
    return row.record_json;
  } finally {
    db.close();
  }
}

test("authentic pre-origin Competition handoff is readable without rewriting Store", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-handoff-legacy-"));
  const store = new StateStore(home);
  try {
    const legacySource = queuedTask("legacy-src", HANDOFF_TS);
    const legacySuccessor = queuedTask("legacy-succ", HANDOFF_TS);
    const currentCompSource = queuedTask("cur-comp-src", HANDOFF_TS);
    const currentCompSuccessor = queuedTask("cur-comp-succ", HANDOFF_TS);
    const goalSource = queuedTask("goal-src", HANDOFF_TS);
    const goalSuccessor = queuedTask("goal-succ", HANDOFF_TS);
    for (const task of [legacySource, legacySuccessor, currentCompSource, goalSource]) {
      store.createTask(task);
    }

    const currentCompetition = currentHandoffRecord(
      "current-comp-handoff",
      { kind: "competition", competitionId: "comp-current", sourceCandidateId: "cand-current" },
      currentCompSource.id,
      currentCompSuccessor.id,
    );
    store.createCandidateHandoff({
      record: currentCompetition,
      task: currentCompSuccessor,
      authorizationEvent: { summary: "current competition handoff" },
    });
    const currentGoal = currentHandoffRecord(
      "current-goal-handoff",
      { kind: "goal-task", goalId: "goal-1", itemId: "item-1" },
      goalSource.id,
      goalSuccessor.id,
    );
    store.createCandidateHandoff({
      record: currentGoal,
      task: goalSuccessor,
      authorizationEvent: { summary: "current goal-task handoff" },
    });

    const legacy = currentHandoffRecord(
      "legacy-comp-handoff",
      { kind: "competition", competitionId: "comp-legacy", sourceCandidateId: "cand-legacy" },
      legacySource.id,
      legacySuccessor.id,
    );
    const legacyJson = authenticLegacyCompetitionJson(legacy);
    insertRawHandoffJson(store.databasePath, legacy, legacyJson, "comp-legacy");

    const eventCounts = {
      legacySource: store.listEvents(legacySource.id).length,
      legacySuccessor: store.listEvents(legacySuccessor.id).length,
      currentCompSource: store.listEvents(currentCompSource.id).length,
      goalSource: store.listEvents(goalSource.id).length,
    };
    const taskCount = store.listTasks().length;
    const currentCompJson = readRawHandoffJson(store.databasePath, currentCompetition.id);
    const currentGoalJson = readRawHandoffJson(store.databasePath, currentGoal.id);

    const byId = store.getCandidateHandoff(legacy.id);
    const byRevision = store.getCandidateHandoffBySourceRevisionId(legacy.sourceCandidateRevisionId);
    const bySuccessor = store.getCandidateHandoffBySuccessorTaskId(legacy.successorTaskId);
    const bySource = store.listCandidateHandoffsBySourceTaskId(legacy.sourceTaskId);
    const byCompetition = store.listCandidateHandoffsByCompetitionId("comp-legacy");
    const listed = store.listCandidateHandoffs();
    assert.ok(byRevision);
    assert.ok(bySuccessor);
    const fromSource = bySource[0];
    const fromCompetition = byCompetition[0];
    assert.ok(fromSource);
    assert.ok(fromCompetition);

    for (const record of [byId, byRevision, bySuccessor, fromSource, fromCompetition]) {
      assert.equal(record.origin.kind, "competition");
      if (record.origin.kind === "competition") {
        assert.equal(record.origin.competitionId, "comp-legacy");
        assert.equal(record.origin.sourceCandidateId, "cand-legacy");
      }
    }
    assert.equal(bySource.length, 1);
    assert.equal(byCompetition.length, 1);
    assert.equal(listed.length, 3);

    const currentCompRead = store.getCandidateHandoff(currentCompetition.id);
    assert.equal(currentCompRead.origin.kind, "competition");
    if (currentCompRead.origin.kind === "competition") {
      assert.equal(currentCompRead.origin.competitionId, "comp-current");
      assert.equal(currentCompRead.origin.sourceCandidateId, "cand-current");
    }

    const currentGoalRead = store.getCandidateHandoff(currentGoal.id);
    assert.equal(currentGoalRead.origin.kind, "goal-task");
    if (currentGoalRead.origin.kind === "goal-task") {
      assert.equal(currentGoalRead.origin.goalId, "goal-1");
      assert.equal(currentGoalRead.origin.itemId, "item-1");
    }
    assert.equal(store.listCandidateHandoffsByCompetitionId("").length, 1);
    assert.equal(store.listCandidateHandoffsByCompetitionId("")[0]?.id, currentGoal.id);

    assert.equal(readRawHandoffJson(store.databasePath, legacy.id), legacyJson);
    assert.equal("origin" in JSON.parse(legacyJson), false);
    assert.equal(JSON.parse(legacyJson).competitionId, "comp-legacy");
    assert.equal(readRawHandoffJson(store.databasePath, currentCompetition.id), currentCompJson);
    assert.equal(readRawHandoffJson(store.databasePath, currentGoal.id), currentGoalJson);
    assert.equal(JSON.parse(currentCompJson).origin.kind, "competition");
    assert.equal(JSON.parse(currentGoalJson).origin.kind, "goal-task");
    assert.equal(store.listEvents(legacySource.id).length, eventCounts.legacySource);
    assert.equal(store.listEvents(legacySuccessor.id).length, eventCounts.legacySuccessor);
    assert.equal(store.listEvents(currentCompSource.id).length, eventCounts.currentCompSource);
    assert.equal(store.listEvents(goalSource.id).length, eventCounts.goalSource);
    assert.equal(store.listTasks().length, taskCount);
  } finally {
    store.close();
  }
});

test("unknown-origin handoff stays collectable; semantic projection fails closed", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-handoff-corrupt-"));
  const store = new StateStore(home);
  try {
    const source = queuedTask("corrupt-src", HANDOFF_TS);
    const successor = queuedTask("corrupt-succ", HANDOFF_TS);
    store.createTask(source);
    store.createTask(successor);
    const secret = "SECRET-HANDOFF-BODY-sk-not-a-real-key";
    const shaped = currentHandoffRecord(
      "corrupt-handoff",
      { kind: "goal-task", goalId: "must-not-guess", itemId: "must-not-guess" },
      source.id,
      successor.id,
    );
    const corruptJson = JSON.stringify({ ...shaped, reason: secret }, (key, value) =>
      key === "origin" ? undefined : value,
    );
    insertRawHandoffJson(store.databasePath, shaped, corruptJson, "");
    const eventsBefore = store.listEvents(source.id).length + store.listEvents(successor.id).length;

    const byId = store.getCandidateHandoff(shaped.id);
    const byRevision = store.getCandidateHandoffBySourceRevisionId(shaped.sourceCandidateRevisionId);
    const bySuccessor = store.getCandidateHandoffBySuccessorTaskId(successor.id);
    const bySource = store.listCandidateHandoffsBySourceTaskId(source.id);
    const listed = store.listCandidateHandoffs();
    assert.equal(byId.origin, undefined);
    assert.equal(byRevision?.origin, undefined);
    assert.equal(bySuccessor?.origin, undefined);
    assert.equal(bySource.length, 1);
    assert.equal(listed.length, 1);
    assert.equal(store.getGoalByTaskId(successor.id), undefined);
    const lineage = resolveEffectiveMilestoneLineage(store, {
      goalId: "must-not-guess",
      itemId: "must-not-guess",
      taskId: source.id,
      gate: "machine",
      itemIndex: 0,
      satisfied: false,
      reasonCode: "waiting-machine",
      reason: "waiting",
      updatedAt: HANDOFF_TS,
    });
    assert.equal(lineage.effectiveTaskId, source.id);
    assert.equal(lineage.handoff, undefined);

    assert.throws(
      () => projectCandidateHandoff(byId),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, CANDIDATE_HANDOFF_CORRUPTION_ERROR);
        assert.ok(!error.message.includes(secret));
        assert.ok(!error.message.includes("must-not-guess"));
        return true;
      },
    );

    const invalidOrigin = currentHandoffRecord(
      "invalid-origin-handoff",
      { kind: "competition", competitionId: "comp-x", sourceCandidateId: "cand-x" },
      queuedTask("invalid-src", HANDOFF_TS).id,
      queuedTask("invalid-succ", HANDOFF_TS).id,
    );
    store.createTask(queuedTask("invalid-src", HANDOFF_TS));
    store.createTask(queuedTask("invalid-succ", HANDOFF_TS));
    insertRawHandoffJson(
      store.databasePath,
      invalidOrigin,
      JSON.stringify({
        ...invalidOrigin,
        origin: { kind: "mystery" },
        reason: secret,
        competitionId: "comp-x",
        sourceCandidateId: "cand-x",
      }),
      "comp-x",
    );
    const mystery = store.getCandidateHandoff(invalidOrigin.id);
    assert.equal((mystery.origin as { kind?: string } | undefined)?.kind, "mystery");
    assert.throws(
      () => projectCandidateHandoff(mystery),
      { name: "Error", message: CANDIDATE_HANDOFF_CORRUPTION_ERROR },
    );

    assert.equal(readRawHandoffJson(store.databasePath, shaped.id), corruptJson);
    assert.equal(
      store.listEvents(source.id).length + store.listEvents(successor.id).length,
      eventsBefore,
    );
  } finally {
    store.close();
  }
});

test("createReviewResultRepairExecution is append-only and one-shot", async () => {
  const { mkdir, readFile, writeFile } = await import("node:fs/promises");
  const { captureCandidateRevision } = await import("../src/core/candidate-revision.js");
  const { taskPaths } = await import("../src/core/config.js");
  const { createReviewGraph, repairReviewResult, reconcileAllReviewGraphs } = await import("../src/core/review-graph.js");
  const { SettingsService } = await import("../src/core/settings.js");
  const { prepareWorkspace } = await import("../src/workspace/copy.js");
  const { createPathPolicy } = await import("../src/workspace/path-policy.js");
  const { writeWorkspacePatchReport } = await import("../src/workspace/patch.js");

  const home = await mkdtemp(path.join(tmpdir(), "fl-store-repair-"));
  const sourceDir = path.join(home, "source");
  await mkdir(path.join(sourceDir, "src"), { recursive: true });
  await writeFile(path.join(sourceDir, "readme.md"), "# hello\n\nOriginal.\n");
  await writeFile(path.join(sourceDir, "src/app.ts"), "export const n = 1;\n");
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const taskId = "candidate-store-repair";
  const paths = taskPaths(home, taskId);
  const spec = {
    version: 1 as const,
    name: "Store repair fixture",
    project: sourceDir,
    goal: "Ship a small change",
    constraints: [],
    provider: {
      name: "deepseek" as const,
      model: "deepseek-v4-flash",
      keychainService: "forklight.deepseek.api-key",
    },
    runtime: {
      name: "claude-code" as const,
      executable: "claude",
      effort: "low" as const,
      maxBudgetUsd: 0.1,
    },
    workspace: { exclude: [".git", "node_modules"] },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src", "readme.md"] },
    acceptance: { commands: ["true"] },
  };
  await prepareWorkspace(spec, paths);
  await mkdir(path.join(paths.workspace, "src"), { recursive: true });
  await writeFile(path.join(paths.workspace, "readme.md"), "# hello\n\nChanged.\n");
  await writeFile(path.join(paths.workspace, "src/app.ts"), "export const n = 2;\n");
  await writeWorkspacePatchReport(paths, createPathPolicy(spec));
  const now = new Date().toISOString();
  store.createTask({
    id: taskId,
    name: spec.name,
    status: "succeeded",
    sourcePath: sourceDir,
    taskFile: "forklight://test/store-repair",
    spec,
    paths,
    sessionId: "session-store-repair",
    currentAttemptId: "attempt-store-repair",
    createdAt: now,
    updatedAt: now,
  });
  store.createAttempt({
    id: "attempt-store-repair",
    taskId,
    ordinal: 1,
    status: "succeeded",
    sessionId: "session-store-repair",
    rawLogPath: path.join(paths.logs, "attempt-1.jsonl"),
    startedAt: now,
    finishedAt: now,
    exitCode: 0,
  });
  const verEvent = store.addEvent(taskId, "attempt-store-repair", "verification.completed", "passed", {
    passed: true,
    behaviorPassed: true,
    policyPassed: true,
    sourceCompatible: true,
    commands: [{ command: "true", exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false }],
    diffPath: paths.diff,
    sourceUnchanged: true,
  });
  const revision = await captureCandidateRevision(
    store,
    store.getTask(taskId),
    store.getAttempt("attempt-store-repair"),
    verEvent.sequence,
    true,
    ["readme.md", "src/app.ts"],
    2,
    4,
  );
  const profiles = settings.get().workerProfiles.profiles;
  const profileA = settings.get().workerProfiles.defaultProfileId;
  const profileB = profiles.find((profile) => profile.id !== profileA)!.id;
  const created = await createReviewGraph(store, settings.get(), {
    candidateTaskId: taskId,
    reviewerWorkerProfileIds: [profileA, profileB],
    reason: "Store one-shot repair",
    confirm: true,
  });
  const [usable, failed] = store.listReviewAssignments(created.graph.id);
  const usableJson = JSON.stringify({
    schemaVersion: 1,
    reviewedRevisionId: revision.id,
    proposedDisposition: "accept",
    summary: "Usable first opinion for store repair fixture",
    findings: [],
  });
  const overlimit = JSON.stringify({
    schemaVersion: 1,
    reviewedRevisionId: revision.id,
    proposedDisposition: "accept",
    summary: "s".repeat(507),
    findings: [],
  });
  const finish = (reviewerTaskId: string, resultText: string) => {
    const task = store.getTask(reviewerTaskId);
    store.createAttempt({
      id: `att-${reviewerTaskId}`,
      taskId: reviewerTaskId,
      ordinal: 1,
      status: "succeeded",
      sessionId: task.sessionId,
      rawLogPath: path.join(task.paths.logs, "attempt-1.jsonl"),
      startedAt: now,
      finishedAt: now,
      exitCode: 0,
      resultText,
    });
    store.setTaskStatus(reviewerTaskId, "succeeded", {
      finishedAt: now,
      currentAttemptId: `att-${reviewerTaskId}`,
    });
  };
  finish(usable!.reviewerTaskId, usableJson);
  finish(failed!.reviewerTaskId, overlimit);
  reconcileAllReviewGraphs(store);
  const snapshot = store.getReviewAssignment(failed!.id);
  const rawBefore = store.listAttempts(failed!.reviewerTaskId).at(-1)?.resultText;
  assert.ok(snapshot.privatePacketPath);
  const originalPacketBytes = await readFile(snapshot.privatePacketPath);
  const repaired = await repairReviewResult(store, settings.get(), {
    candidateTaskId: taskId,
    assignmentId: failed!.id,
    reason: "Persist one repair",
    confirm: true,
  });
  const after = store.getReviewAssignment(failed!.id);
  assert.equal(after.status, snapshot.status);
  assert.equal(after.failureCode, snapshot.failureCode);
  assert.equal(after.reviewerTaskId, snapshot.reviewerTaskId);
  assert.equal(store.listAttempts(failed!.reviewerTaskId).at(-1)?.resultText, rawBefore);
  assert.equal(after.resultRepair?.taskId, repaired.repairTaskId);
  assert.equal(store.getReviewAssignmentByRepairTaskId(repaired.repairTaskId)?.id, failed!.id);
  assert.equal(store.listReviewAssignments(created.graph.id).length, 2);
  await assert.rejects(
    () => repairReviewResult(store, settings.get(), {
      candidateTaskId: taskId,
      assignmentId: failed!.id,
      reason: "Second persist must fail",
      confirm: true,
    }),
    /already consumed|one-shot/i,
  );
  assert.equal(
    store.listTasks().filter((task) => task.taskFile.includes("result-repair")).length,
    1,
  );
  const copiedPacket = await readFile(
    path.join(
      path.dirname(store.databasePath),
      "review-projects",
      created.graph.id,
      failed!.id,
      "result-repair",
      "REVIEW_PACKET.json",
    ),
  );
  assert.deepEqual(copiedPacket, originalPacketBytes);
  store.close();
});

// --- Complete Main usage samples (M4-A) ---

function validMainUsageSample(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    sampleId: "mus-001", forklightTaskId: "task-mu", comparisonId: "cmp-store-1",
    role: "direct-main", taskClass: "edit-task", taskFamily: "forklight-storage-lifecycle",
    directCodexProfileId: "profA", inputTokens: 3000, outputTokens: 500,
    cacheReadInputTokens: 1000, cacheCreationInputTokens: 0, grossTokens: 4500,
    source: "codex-terminal-result", runRef: "codex-run:store-a",
    capturedAt: TS, schemaVersion: 1, ...overrides,
  };
}

function createTaskWithFamily(
  store: StateStore, id: string, taskClass: string, taskFamily: string, profileId: string, ts: string,
): void {
  const home = store.databasePath.replace(/\/forklight\.sqlite$/, "");
  const spec = parseTaskSpec({
    version: 1, name: id, project: "/tmp/source", goal: "Main usage store task",
    taskClass, taskFamily, directCodexProfileId: profileId, acceptance: { commands: ["true"] },
  }, "/tmp");
  store.createTask(buildTaskRecord({
    spec, taskFile: `/tmp/${id}.yaml`, home, id, sessionId: `session-${id}`, createdAt: ts,
  }));
}

test("main usage sample save, identity, uniqueness, and rollback", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mus-"));
  const store = new StateStore(home);
  createTaskWithFamily(store, "task-mu", "edit-task", "forklight-storage-lifecycle", "profA", TS);

  store.saveMainUsageSample(validMainUsageSample());
  const saved = store.getMainUsageSample("mus-001");
  assert.equal(saved.role, "direct-main");
  assert.equal(saved.grossTokens, 4500);
  assert.ok(Object.isFrozen(saved));
  assert.equal(store.countMainUsageSamples(), 1);

  createTaskWithFamily(store, "task-other", "other-class", "other-family", "profB", TS);
  assert.throws(
    () => store.saveMainUsageSample(validMainUsageSample({
      sampleId: "mus-002", forklightTaskId: "task-other", comparisonId: "cmp-store-1",
      role: "delegated-main", taskClass: "other-class", taskFamily: "other-family",
      directCodexProfileId: "profB", runRef: "codex-run:store-b",
    })),
    { name: "Error", message: "Sample identity does not match declared Task identity" },
  );
  assert.equal(store.countMainUsageSamples(), 1);
  assert.deepEqual(store.getMainUsageSample("mus-001"), saved);

  store.saveMainUsageSample(validMainUsageSample({
    sampleId: "mus-002", role: "delegated-main", runRef: "codex-run:store-b",
  }));
  assert.equal(store.listMainUsageSamples("task-mu", "cmp-store-1").length, 2);

  const original = JSON.stringify(store.getMainUsageSample("mus-001"));
  assert.throws(
    () => store.saveMainUsageSample(validMainUsageSample({
      sampleId: "mus-001", role: "direct-main", runRef: "codex-run:store-c", comparisonId: "cmp-store-2",
    })),
    /UNIQUE/,
  );
  assert.throws(
    () => store.saveMainUsageSample(validMainUsageSample({
      sampleId: "mus-003", role: "direct-main", runRef: "codex-run:store-d",
    })),
    /UNIQUE/,
  );
  assert.throws(
    () => store.saveMainUsageSample(validMainUsageSample({
      sampleId: "mus-004", comparisonId: "cmp-store-2", role: "direct-main", runRef: "codex-run:store-a",
    })),
    /UNIQUE/,
  );
  assert.equal(JSON.stringify(store.getMainUsageSample("mus-001")), original);
  assert.equal(store.countMainUsageSamples(), 2);

  const noFamily = buildTaskRecord({
    spec: parseTaskSpec({
      version: 1, name: "no-fam", project: "/tmp", goal: "T",
      taskClass: "edit-task", directCodexProfileId: "profA", acceptance: { commands: ["true"] },
    }, "/tmp"),
    taskFile: "/tmp/nf.yaml", home, id: "no-fam", sessionId: "s-nf", createdAt: TS,
  });
  store.createTask(noFamily);
  assert.throws(
    () => store.saveMainUsageSample(validMainUsageSample({
      sampleId: "mus-nf", forklightTaskId: "no-fam", comparisonId: "cmp-nf", runRef: "codex-run:nf",
    })),
    { name: "Error", message: "Sample identity does not match declared Task identity" },
  );
  assert.throws(
    () => store.saveMainUsageSample(validMainUsageSample({
      sampleId: "mus-nt", forklightTaskId: "no-task", comparisonId: "cmp-nt", runRef: "codex-run:nt",
    })),
    { name: "Error", message: "Sample references unknown Task" },
  );
  assert.equal(store.countMainUsageSamples(), 2);
  store.close();
});

// --- Main Token pair assessments (M4-B) ---

function validMainPairAssessment(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    assessmentId: "mpa-001",
    forklightTaskId: "task-mu",
    comparisonId: "cmp-pair-store",
    taskClass: "edit-task",
    taskFamily: "forklight-storage-lifecycle",
    directCodexProfileId: "profA",
    decision: "accepted",
    sameScope: true,
    sameAcceptance: true,
    delegatedQualityNotLower: true,
    directVerificationRef: { referenceId: "dvref1" },
    delegatedIntegrationOperationId: "intop1",
    directSampleId: "mus-001",
    delegatedSampleId: "mus-002",
    reviewer: "main-codex",
    assessedAt: TS,
    schemaVersion: 1,
    ...overrides,
  };
}

test("main pair assessment uniqueness and failed-insert rollback", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mpa-"));
  const store = new StateStore(home);
  createTaskWithFamily(store, "task-mu", "edit-task", "forklight-storage-lifecycle", "profA", TS);
  store.saveMainUsageSample(validMainUsageSample({
    sampleId: "mus-001", comparisonId: "cmp-pair-store", role: "direct-main", runRef: "codex-run:pair-a",
  }));
  store.saveMainUsageSample(validMainUsageSample({
    sampleId: "mus-002", comparisonId: "cmp-pair-store", role: "delegated-main", runRef: "codex-run:pair-b",
  }));

  store.saveMainPairAssessment(validMainPairAssessment());
  const saved = store.getMainPairAssessment("mpa-001");
  assert.equal(saved.decision, "accepted");
  assert.ok(Object.isFrozen(saved));
  assert.equal(store.countMainPairAssessments(), 1);
  assert.equal(store.getMainPairAssessmentByComparison("cmp-pair-store")?.assessmentId, "mpa-001");

  const original = JSON.stringify(store.getMainPairAssessment("mpa-001"));
  assert.throws(
    () => store.saveMainPairAssessment(validMainPairAssessment({
      assessmentId: "mpa-002", comparisonId: "cmp-pair-store",
      delegatedIntegrationOperationId: "intop2",
    })),
    /UNIQUE/,
  );
  assert.throws(
    () => store.saveMainPairAssessment(validMainPairAssessment({
      assessmentId: "mpa-001", comparisonId: "cmp-pair-other",
      delegatedIntegrationOperationId: "intop3",
    })),
    /UNIQUE/,
  );
  assert.equal(JSON.stringify(store.getMainPairAssessment("mpa-001")), original);
  assert.equal(store.countMainPairAssessments(), 1);

  assert.throws(
    () => store.saveMainPairAssessment(validMainPairAssessment({
      assessmentId: "mpa-nt", forklightTaskId: "no-task", comparisonId: "cmp-pair-none",
    })),
    { name: "Error", message: "Assessment references unknown Task" },
  );
  assert.equal(store.countMainPairAssessments(), 1);
  assert.equal(JSON.stringify(store.getMainPairAssessment("mpa-001")), original);

  store.saveMainPairAssessment({
    assessmentId: "mpa-rej",
    forklightTaskId: "task-mu",
    comparisonId: "cmp-pair-rej",
    taskClass: "edit-task",
    taskFamily: "forklight-storage-lifecycle",
    directCodexProfileId: "profA",
    decision: "rejected",
    rejectionReason: "scope-mismatch",
    reviewer: "main-codex",
    assessedAt: TS,
    schemaVersion: 1,
  });
  const rejected = store.getMainPairAssessmentByComparison("cmp-pair-rej");
  assert.equal(rejected?.decision, "rejected");
  assert.equal(rejected?.rejectionReason, "scope-mismatch");
  assert.equal("sameScope" in (rejected ?? {}), false);
  assert.equal(store.countMainPairAssessments(), 2);
  store.close();
});

test("legacy pair evidence includes matching publication-only records", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mpa-pub-"));
  const store = new StateStore(home);
  createTaskWithFamily(store, "task-pub", "edit-task", "forklight-storage-lifecycle", "profA", TS);
  createTaskWithFamily(store, "task-other", "edit-task", "forklight-storage-lifecycle", "profB", TS);
  assert.equal(store.hasLegacyMainPairEvidence("task-pub"), false);
  assert.equal(store.hasLegacyMainPairEvidence("task-other"), false);

  store.saveDirectCodexProfilePublication(profilePublicationInput({
    taskClass: "edit-task", profileId: "profA", version: 1,
  }));
  assert.equal(store.hasLegacyMainPairEvidence("task-pub"), true);
  assert.equal(store.hasLegacyMainPairEvidence("task-other"), false);
  assert.equal(store.countMainUsageSamples(), 0);
  store.close();
});

test("online backup copies Store integrity without inventing a second check", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-store-online-backup-"));
  const store = new StateStore(home);
  store.createTask(queuedTask("backup-task", "2026-08-19T00:00:00.000Z"));
  const live = store.checkStoreIntegrity();
  assert.equal(live.quickCheck, "ok");
  assert.equal(live.foreignKeyViolationCount, 0);
  const sourcePath = store.databasePath;
  store.close();

  const dest = path.join(home, "online-copy.sqlite");
  await backupStoreDatabase(sourcePath, dest);
  const copied = checkDatabaseFileIntegrity(dest);
  assert.deepEqual(copied, live);

  const copiedDb = new DatabaseSync(dest, { readOnly: true });
  try {
    const row = copiedDb.prepare("SELECT id FROM tasks WHERE id = ?").get("backup-task") as
      | { id: string }
      | undefined;
    assert.equal(row?.id, "backup-task");
  } finally {
    copiedDb.close();
  }

  assert.throws(
    () => checkDatabaseFileIntegrity(path.join(home, "missing.sqlite")),
    { message: STORE_UNREADABLE_ERROR },
  );
});
