import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { registerTaskFromSpec } from "../src/core/runner.js";
import { loadTaskSpec } from "../src/core/task.js";
import { verifyTask } from "../src/core/verifier.js";
import { StateStore } from "../src/state/store.js";
import { prepareWorkspace } from "../src/workspace/copy.js";

test("verifier Git commands work without exposing .git inside the workspace", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-verifier-git-home-"));
  const root = await mkdtemp(path.join(tmpdir(), "forklight-verifier-git-task-"));
  const project = path.join(root, "project");
  await mkdir(path.join(project, "src"), { recursive: true });
  await writeFile(path.join(project, "src", "value.ts"), "export const value = 1;\n");
  const taskFile = path.join(root, "task.yaml");
  await writeFile(taskFile, `version: 1
name: Verifier Git test
project: ./project
goal: Run Git acceptance without Worker repository access
worker:
  allowEdits: true
acceptance:
  commands:
    - git diff --check
    - test -n "$(git status --porcelain)"
`);

  const store = new StateStore(home);
  try {
    const { spec } = await loadTaskSpec(taskFile);
    const task = registerTaskFromSpec(store, spec, taskFile);
    await prepareWorkspace(spec, task.paths);
    await writeFile(
      path.join(task.paths.workspace, "src", "value.ts"),
      "export const value = 2;\n",
    );
    const attemptId = "verifier-git-attempt";
    store.createAttempt({
      id: attemptId,
      taskId: task.id,
      ordinal: 1,
      status: "running",
      sessionId: task.sessionId,
      rawLogPath: path.join(task.paths.logs, "attempt-1.jsonl"),
      startedAt: new Date().toISOString(),
    });

    const result = await verifyTask(store, task, attemptId);
    assert.deepEqual(result.commands.map((command) => command.exitCode), [0, 0]);
    assert.equal(result.behaviorPassed, true);
    assert.equal(existsSync(path.join(task.paths.workspace, ".git")), false);
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
