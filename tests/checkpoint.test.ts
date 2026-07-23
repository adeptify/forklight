import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { registerTaskFromSpec } from "../src/core/runner.js";
import { loadTaskSpec } from "../src/core/task.js";
import { StateStore } from "../src/state/store.js";
import { prepareWorkspace } from "../src/workspace/copy.js";

async function checkpointFixture(): Promise<{
  store: StateStore;
  taskId: string;
  attemptId: string;
  cleanup: () => void;
}> {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-checkpoint-home-"));
  const root = await mkdtemp(path.join(tmpdir(), "forklight-checkpoint-task-"));
  const project = path.join(root, "project");
  await mkdir(path.join(project, "src"), { recursive: true });
  await writeFile(path.join(project, "src", "main.ts"), "export const value = 1;\n");
  const taskFile = path.join(root, "task.yaml");
  await writeFile(taskFile, `version: 1
name: Checkpoint test
project: ./project
goal: Exercise approved checkpoint commands
worker:
  allowEdits: true
acceptance:
  commands:
    - node -e "console.log('one')"
    - node -e "console.error('two'); process.exit(2)"
`);

  const store = new StateStore(home);
  const { spec } = await loadTaskSpec(taskFile);
  const task = registerTaskFromSpec(store, spec, taskFile);
  await prepareWorkspace(spec, task.paths);
  const attemptId = "checkpoint-attempt";
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
  await writeFile(path.join(task.paths.workspace, "src", "added.ts"), "export const added = true;\n");
  await mkdir(path.join(task.paths.workspace, "pkg", "__pycache__"), { recursive: true });
  await writeFile(path.join(task.paths.workspace, "pkg", "__pycache__", "value.pyc"), "generated");

  return {
    store,
    taskId: task.id,
    attemptId,
    cleanup: () => {
      store.close();
      rmSync(home, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("checkpoint runs only contract command ids for the current attempt", async () => {
  const { store, taskId, attemptId, cleanup } = await checkpointFixture();
  try {
    const { runCheckpoint } = await import("../src/core/checkpoint.js");

    await assert.rejects(
      () => runCheckpoint(store, { taskId, attemptId, commandIds: ["git status"] }),
      /unknown checkpoint command id/,
    );
    await assert.rejects(
      () => runCheckpoint(store, {
        taskId,
        attemptId: "other-attempt",
        commandIds: ["acceptance-1"],
      }),
      /current running attempt/,
    );

    const report = await runCheckpoint(store, { taskId, attemptId });
    assert.equal(report.authority, "non-authoritative-checkpoint");
    assert.equal(report.attemptId, attemptId);
    assert.deepEqual(
      report.commands.map((command) => [command.commandId, command.exitCode]),
      [["acceptance-1", 0], ["acceptance-2", 2]],
    );
    assert.ok(report.patches.business.filesChanged >= 1);
    assert.ok(report.patches.business.changedLines >= 1);
    assert.deepEqual(report.patches.generated.affectedPaths, ["pkg/__pycache__/value.pyc"]);
    assert.deepEqual(report.patches.integration.affectedPaths, ["src/added.ts"]);
    assert.equal(
      store.listEvents(taskId).filter((event) => event.type === "checkpoint.completed").length,
      1,
    );
  } finally {
    cleanup();
  }
});

test("checkpoint satisfaction requires every approved command to pass for the same attempt", async () => {
  const { checkpointSatisfied } = await import("../src/core/checkpoint.js");
  const event = {
    attemptId: "attempt-1",
    type: "checkpoint.completed",
    payload: {
      authority: "non-authoritative-checkpoint",
      commands: [
        { commandId: "acceptance-1", exitCode: 0, timedOut: false },
        { commandId: "acceptance-2", exitCode: 0, timedOut: false },
      ],
    },
  } as unknown as import("../src/core/types.js").EventRecord;

  assert.equal(checkpointSatisfied([event], "attempt-1", 2), true);
  assert.equal(checkpointSatisfied([event], "attempt-2", 2), false);
  assert.equal(checkpointSatisfied([event], "attempt-1", 3), false);
  assert.equal(checkpointSatisfied([
    {
      ...event,
      payload: {
        authority: "non-authoritative-checkpoint",
        commands: [
          { commandId: "acceptance-1", exitCode: 0, timedOut: false },
          { commandId: "acceptance-2", exitCode: 1, timedOut: false },
        ],
      },
    },
  ], "attempt-1", 2), false);
});
