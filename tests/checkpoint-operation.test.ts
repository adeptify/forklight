import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { checkpointSatisfied } from "../src/core/checkpoint.js";
import { checkpointOperationId } from "../src/core/checkpoint-operation.js";
import { SettingsService } from "../src/core/settings.js";
import { sleepMs } from "../src/core/time.js";
import type { CheckpointOperationView, CheckpointReport } from "../src/core/types.js";
import { registerTaskFromSpec } from "../src/core/runner.js";
import { loadTaskSpec } from "../src/core/task.js";
import { daemonRequest } from "../src/daemon/client.js";
import { DaemonCoordinator } from "../src/daemon/coordinator.js";
import { ForkLightDaemon } from "../src/daemon/server.js";
import { StateStore } from "../src/state/store.js";
import { prepareWorkspace } from "../src/workspace/copy.js";

async function operationFixture(commands: string[]): Promise<{
  store: StateStore;
  coordinator: DaemonCoordinator;
  taskId: string;
  attemptId: string;
  cleanup: () => void;
}> {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cp-op-home-"));
  const root = await mkdtemp(path.join(tmpdir(), "forklight-cp-op-task-"));
  const project = path.join(root, "project");
  await mkdir(path.join(project, "src"), { recursive: true });
  await writeFile(path.join(project, "src", "main.ts"), "export const value = 1;\n");
  const taskFile = path.join(root, "task.yaml");
  await writeFile(taskFile, `version: 1
name: Checkpoint operation test
project: ./project
goal: Exercise checkpoint operation lifecycle
worker:
  allowEdits: true
acceptance:
  commands:
${commands.map((command) => `    - ${command}`).join("\n")}
`);
  const store = new StateStore(home);
  const { spec } = await loadTaskSpec(taskFile);
  const task = registerTaskFromSpec(store, spec, taskFile);
  await prepareWorkspace(spec, task.paths);
  const attemptId = "cp-op-attempt";
  store.createAttempt({
    id: attemptId,
    taskId: task.id,
    ordinal: 1,
    status: "running",
    sessionId: task.sessionId,
    rawLogPath: path.join(task.paths.logs, "attempt-1.jsonl"),
    startedAt: new Date().toISOString(),
  });
  store.setTaskStatus(task.id, "running", { currentAttemptId: attemptId });
  const coordinator = new DaemonCoordinator(store, new SettingsService(store));
  return {
    store,
    coordinator,
    taskId: task.id,
    attemptId,
    cleanup: () => {
      store.close();
      rmSync(home, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    },
  };
}

async function waitForTerminal(
  coordinator: DaemonCoordinator,
  operationId: string,
  timeoutMs = 8_000,
): Promise<CheckpointOperationView> {
  const deadline = Date.now() + timeoutMs;
  let view = coordinator.checkpointStatus(operationId);
  while (view.status === "running" && Date.now() < deadline) {
    await sleepMs(50);
    view = coordinator.checkpointStatus(operationId);
  }
  if (view.status === "running") {
    throw new Error("checkpoint operation did not reach terminal within timeout");
  }
  return view;
}

test("checkpoint operation starts fast, waits bounded, and completes to a report", async () => {
  const { store, coordinator, taskId, attemptId, cleanup } = await operationFixture(["sleep 2"]);
  try {
    const startedAt = Date.now();
    const view = coordinator.checkpointStart({ taskId, attemptId });
    const startMs = Date.now() - startedAt;
    assert.equal(view.status, "running");
    assert.ok(startMs < 1_000, `start should be a short exchange, took ${startMs}ms`);
    assert.ok(view.operationId.startsWith("checkpoint-"));
    assert.equal(view.commandCount, 1);
    assert.equal(view.failedCommandCount, 0);

    // A bounded running wait returns quickly without waiting for completion.
    const boundedAt = Date.now();
    const running = await coordinator.waitCheckpoint(view.operationId, 100);
    assert.equal(running.status, "running");
    assert.ok(Date.now() - boundedAt < 1_000, "bounded running wait stayed bounded");

    const terminal = await waitForTerminal(coordinator, view.operationId);
    assert.equal(terminal.status, "completed");
    assert.equal(terminal.commandCount, 1);
    assert.equal(terminal.passedCommandCount, 1);
    assert.equal(terminal.failedCommandCount, 0);

    const report = coordinator.checkpointReport(view.operationId);
    assert.equal(report.authority, "non-authoritative-checkpoint");
    assert.equal(report.attemptId, attemptId);
    assert.equal(report.commands[0]?.commandId, "acceptance-1");
    assert.equal(report.commands[0]?.exitCode, 0);

    const events = store.listEvents(taskId);
    assert.equal(events.filter((event) => event.type === "checkpoint.started").length, 1);
    assert.equal(events.filter((event) => event.type === "checkpoint.completed").length, 1);
  } finally {
    cleanup();
  }
});

test("repeated canonical start reuses one operation and executes commands exactly once", async () => {
  const { store, coordinator, taskId, attemptId, cleanup } = await operationFixture([
    "node -e \"require('fs').appendFileSync('cp-count.txt','x');setTimeout(()=>{},500)\"",
  ]);
  try {
    const first = coordinator.checkpointStart({ taskId, attemptId, commandIds: ["acceptance-1"] });
    const second = coordinator.checkpointStart({ taskId, attemptId, commandIds: ["acceptance-1"] });
    assert.equal(second.operationId, first.operationId);
    assert.equal(second.status, "running");

    const terminal = await waitForTerminal(coordinator, first.operationId);
    assert.equal(terminal.status, "completed");

    const workspace = store.getTask(taskId).paths.workspace;
    const count = await readFile(path.join(workspace, "cp-count.txt"), "utf8");
    assert.equal(count.length, 1, "the approved command must execute exactly once");

    const events = store.listEvents(taskId);
    assert.equal(events.filter((event) => event.type === "checkpoint.started").length, 1);
    assert.equal(events.filter((event) => event.type === "checkpoint.completed").length, 1);
  } finally {
    cleanup();
  }
});

test("daemon restart with a started operation reports outcome-unknown and never reruns", async () => {
  const { store, coordinator, taskId, attemptId, cleanup } = await operationFixture(["sleep 2"]);
  try {
    const first = coordinator.checkpointStart({ taskId, attemptId });
    assert.equal(first.status, "running");

    // New daemon process on the same durable store: no in-memory execution.
    const restarted = new DaemonCoordinator(store, new SettingsService(store));
    const observed = restarted.checkpointStart({ taskId, attemptId });
    assert.equal(observed.operationId, first.operationId);
    assert.equal(observed.status, "outcome-unknown");
    assert.equal(restarted.checkpointStatus(first.operationId).status, "outcome-unknown");

    // A bounded wait does not invent progress for a lost in-memory execution.
    const bounded = await restarted.waitCheckpoint(first.operationId, 50);
    assert.equal(bounded.status, "outcome-unknown");

    const before = store.listEvents(taskId);
    assert.equal(before.filter((event) => event.type === "checkpoint.started").length, 1);
    assert.equal(before.filter((event) => event.type === "checkpoint.completed").length, 0);

    // The original in-memory execution still completes exactly once.
    const terminal = await waitForTerminal(coordinator, first.operationId);
    assert.equal(terminal.status, "completed");
    const after = store.listEvents(taskId);
    assert.equal(after.filter((event) => event.type === "checkpoint.started").length, 1);
    assert.equal(after.filter((event) => event.type === "checkpoint.completed").length, 1);
  } finally {
    cleanup();
  }
});

test("a failing approved command completes the operation with a truthful report", async () => {
  const { store, coordinator, taskId, attemptId, cleanup } = await operationFixture([
    "node -e \"console.log('ok')\"",
    "node -e \"process.exit(3)\"",
  ]);
  try {
    const view = coordinator.checkpointStart({ taskId, attemptId });
    const terminal = await waitForTerminal(coordinator, view.operationId);
    assert.equal(terminal.status, "completed", "operation completes normally despite command failure");
    assert.equal(terminal.passedCommandCount, 1);
    assert.equal(terminal.failedCommandCount, 1);

    const report = coordinator.checkpointReport(view.operationId);
    assert.deepEqual(
      report.commands.map((command) => [command.commandId, command.exitCode]),
      [["acceptance-1", 0], ["acceptance-2", 3]],
    );
    // checkpointSatisfied semantics are unchanged: a failed command stays false.
    assert.equal(checkpointSatisfied(store.listEvents(taskId), attemptId, 2), false);
  } finally {
    cleanup();
  }
});

test("checkpoint operation lifecycle views never expose raw command output", async () => {
  const { coordinator, taskId, attemptId, cleanup } = await operationFixture([
    "node -e \"console.log('secret-stdout'); console.error('secret-stderr')\"",
  ]);
  try {
    const view = coordinator.checkpointStart({ taskId, attemptId });
    const terminal = await waitForTerminal(coordinator, view.operationId);
    assert.equal(terminal.status, "completed");
    const serialized = JSON.stringify(terminal);
    assert.ok(!serialized.includes("secret-stdout"));
    assert.ok(!serialized.includes("secret-stderr"));
    assert.ok(!serialized.includes("stdout"));
    assert.ok(!serialized.includes("stderr"));
    assert.ok(!serialized.includes("patches"));
    assert.ok(!serialized.includes("console.log"));
  } finally {
    cleanup();
  }
});

test("a fully passing operation satisfies checkpointSatisfied unchanged", async () => {
  const { store, coordinator, taskId, attemptId, cleanup } = await operationFixture([
    "node -e \"console.log('ok')\"",
  ]);
  try {
    const view = coordinator.checkpointStart({ taskId, attemptId });
    await waitForTerminal(coordinator, view.operationId);
    assert.equal(checkpointSatisfied(store.listEvents(taskId), attemptId, 1), true);
    assert.equal(checkpointSatisfied(store.listEvents(taskId), "other-attempt", 1), false);
  } finally {
    cleanup();
  }
});

test("an eleven-command full suite keeps catalog order and satisfies checkpointSatisfied", async () => {
  const commands = Array.from({ length: 11 }, (_, i) => `node -e "console.log(${i + 1})"`);
  const { store, coordinator, taskId, attemptId, cleanup } = await operationFixture(commands);
  try {
    const view = coordinator.checkpointStart({ taskId, attemptId });
    const terminal = await waitForTerminal(coordinator, view.operationId);
    assert.equal(terminal.status, "completed");
    assert.equal(terminal.commandCount, 11);
    const report = coordinator.checkpointReport(view.operationId);
    assert.deepEqual(
      report.commands.map((command) => command.commandId),
      [
        "acceptance-1", "acceptance-2", "acceptance-3", "acceptance-4", "acceptance-5",
        "acceptance-6", "acceptance-7", "acceptance-8", "acceptance-9", "acceptance-10",
        "acceptance-11",
      ],
    );
    assert.equal(checkpointSatisfied(store.listEvents(taskId), attemptId, 11), true);
  } finally {
    cleanup();
  }
});

test("reordered equivalent selections reuse one canonical operation", async () => {
  const { coordinator, taskId, attemptId, cleanup } = await operationFixture([
    "node -e \"console.log('a')\"",
    "node -e \"console.log('b')\"",
  ]);
  try {
    const first = coordinator.checkpointStart({
      taskId,
      attemptId,
      commandIds: ["acceptance-2", "acceptance-1"],
    });
    const second = coordinator.checkpointStart({
      taskId,
      attemptId,
      commandIds: ["acceptance-1", "acceptance-2"],
    });
    assert.equal(second.operationId, first.operationId);
    const terminal = await waitForTerminal(coordinator, first.operationId);
    assert.equal(terminal.status, "completed");
    // The reordered first request still executes in Task Contract catalog order.
    const report = coordinator.checkpointReport(first.operationId);
    assert.deepEqual(
      report.commands.map((command) => command.commandId),
      ["acceptance-1", "acceptance-2"],
    );
  } finally {
    cleanup();
  }
});

test("duplicate command ids are rejected before any execution", async () => {
  const { store, coordinator, taskId, attemptId, cleanup } = await operationFixture([
    "node -e \"console.log('a')\"",
  ]);
  try {
    assert.throws(
      () => coordinator.checkpointStart({
        taskId,
        attemptId,
        commandIds: ["acceptance-1", "acceptance-1"],
      }),
      /duplicate checkpoint command id/,
    );
    const events = store.listEvents(taskId);
    assert.equal(events.filter((event) => event.type === "checkpoint.started").length, 0);
    assert.equal(events.filter((event) => event.type === "checkpoint.completed").length, 0);
  } finally {
    cleanup();
  }
});

test("corrupt checkpoint operation records fail closed with a stable content-free error", async () => {
  const { store, taskId, attemptId, cleanup } = await operationFixture(["sleep 1"]);
  try {
    const db = new DatabaseSync(store.databasePath);
    try {
      db.prepare(
        `INSERT INTO checkpoint_operations (id, task_id, attempt_id, record_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        "checkpoint-corrupt-json",
        taskId,
        attemptId,
        "{not valid json",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      );
      db.prepare(
        `INSERT INTO checkpoint_operations (id, task_id, attempt_id, record_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        "checkpoint-corrupt-shape",
        taskId,
        attemptId,
        JSON.stringify({ operationId: "checkpoint-corrupt-shape" }),
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      );
    } finally {
      db.close();
    }
    assert.throws(
      () => store.getCheckpointOperation("checkpoint-corrupt-json"),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.equal(message, "Corrupt checkpoint operation record in state database");
        assert.ok(!message.includes("{not valid json"));
        return true;
      },
    );
    assert.throws(
      () => store.getCheckpointOperation("checkpoint-corrupt-shape"),
      /Corrupt checkpoint operation record in state database/,
    );
  } finally {
    cleanup();
  }
});

test("a corrupt durable record makes checkpoint start fail closed without rerunning", async () => {
  const { store, coordinator, taskId, attemptId, cleanup } = await operationFixture(["sleep 1"]);
  try {
    const operationId = checkpointOperationId(taskId, attemptId, ["acceptance-1"]);
    const db = new DatabaseSync(store.databasePath);
    try {
      db.prepare(
        `INSERT INTO checkpoint_operations (id, task_id, attempt_id, record_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(operationId, taskId, attemptId, "{broken", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    } finally {
      db.close();
    }
    assert.throws(
      () => coordinator.checkpointStart({ taskId, attemptId }),
      /Corrupt checkpoint operation record in state database/,
    );
    const events = store.listEvents(taskId);
    assert.equal(events.filter((event) => event.type === "checkpoint.started").length, 0);
    assert.equal(events.filter((event) => event.type === "checkpoint.completed").length, 0);
  } finally {
    cleanup();
  }
});

test("checkpoint operation protocol completes end-to-end through bounded daemon waits", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-cp-op-e2e-"));
  const root = await mkdtemp(path.join(tmpdir(), "fl-cp-op-e2e-task-"));
  const project = path.join(root, "project");
  await mkdir(path.join(project, "src"), { recursive: true });
  await writeFile(path.join(project, "src", "main.ts"), "export const value = 1;\n");
  const taskFile = path.join(root, "task.yaml");
  await writeFile(taskFile, `version: 1
name: Checkpoint e2e test
project: ./project
goal: Exercise checkpoint daemon protocol
worker:
  allowEdits: true
acceptance:
  commands:
    - sleep 1
`);
  const seed = new StateStore(home);
  const { spec } = await loadTaskSpec(taskFile);
  const task = registerTaskFromSpec(seed, spec, taskFile);
  await prepareWorkspace(spec, task.paths);
  seed.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    // Mark the task running on a second connection after recover() has run so
    // the daemon observes a current running attempt for the checkpoint.
    const live = new StateStore(home);
    const attemptId = "e2e-attempt";
    live.createAttempt({
      id: attemptId,
      taskId: task.id,
      ordinal: 1,
      status: "running",
      sessionId: task.sessionId,
      rawLogPath: path.join(task.paths.logs, "attempt-1.jsonl"),
      startedAt: new Date().toISOString(),
    });
    live.setTaskStatus(task.id, "running", { currentAttemptId: attemptId });
    live.close();

    // Start through a short exchange; no generic 15-second transport timeout.
    const startedAt = Date.now();
    const view = await daemonRequest<CheckpointOperationView>(
      "checkpoint_start",
      { taskId: task.id, attemptId, commandIds: ["acceptance-1"] },
      home,
    );
    const startMs = Date.now() - startedAt;
    assert.equal(view.status, "running");
    assert.ok(startMs < 1_000, `start exchange should be short, took ${startMs}ms`);

    // Observe the same operation through repeated bounded daemon waits.
    let current = view;
    const deadline = Date.now() + 8_000;
    while (current.status === "running" && Date.now() < deadline) {
      current = await daemonRequest<CheckpointOperationView>(
        "checkpoint_wait",
        { operationId: current.operationId, timeoutMs: 500 },
        home,
      );
    }
    assert.equal(current.status, "completed");
    assert.equal(current.passedCommandCount, 1);

    const report = await daemonRequest<CheckpointReport>(
      "checkpoint_report",
      { operationId: current.operationId },
      home,
    );
    assert.equal(report.commands[0]?.commandId, "acceptance-1");
    assert.equal(report.commands[0]?.exitCode, 0);
  } finally {
    await daemon.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("daemon exposes checkpoint operation protocol with strict input parsing", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-cp-op-daemon-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    await assert.rejects(
      () => daemonRequest(
        "checkpoint_start",
        { taskId: "missing-task", attemptId: "attempt", commandIds: ["acceptance-1"] },
        home,
      ),
      /Unknown ForkLight task/,
    );
    await assert.rejects(
      () => daemonRequest(
        "checkpoint_start",
        { taskId: "missing-task", attemptId: "attempt", commandIds: "acceptance-1" },
        home,
      ),
      /commandIds must be an array/,
    );
    await assert.rejects(
      () => daemonRequest("checkpoint_status", { operationId: "checkpoint-missing" }, home),
      /Unknown checkpoint operation/,
    );
    await assert.rejects(
      () => daemonRequest("checkpoint_wait", { operationId: "checkpoint-missing", timeoutMs: 100 }, home),
      /Unknown checkpoint operation/,
    );
    await assert.rejects(
      () => daemonRequest("checkpoint_wait", { operationId: "checkpoint-missing", timeoutMs: -1 }, home),
      /Checkpoint wait timeoutMs/,
    );
    await assert.rejects(
      () => daemonRequest("checkpoint_report", { operationId: "checkpoint-missing" }, home),
      /Unknown checkpoint operation/,
    );
  } finally {
    await daemon.close();
  }
});
