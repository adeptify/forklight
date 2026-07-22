import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadTaskSpec } from "../src/core/task.js";

test("loads a versioned task and resolves a relative project", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-task-"));
  const project = path.join(root, "project");
  await mkdir(project);
  const taskFile = path.join(root, "task.yaml");
  await writeFile(
    taskFile,
    `version: 1
name: Example
project: ./project
goal: Make the example pass
acceptance:
  commands:
    - node --test
`,
  );
  const loaded = await loadTaskSpec(taskFile);
  assert.equal(loaded.spec.project, project);
  assert.equal(loaded.spec.provider.model, "deepseek-v4-flash");
  assert.equal(loaded.spec.runtime.name, "claude-code");
});

test("rejects tasks without an independent acceptance command", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-task-"));
  await mkdir(path.join(root, "project"));
  const taskFile = path.join(root, "task.yaml");
  await writeFile(taskFile, "version: 1\nname: Missing verifier\nproject: ./project\ngoal: Test\n");
  await assert.rejects(() => loadTaskSpec(taskFile), /acceptance\.commands/);
});

test("rejects direct Worker shell commands in P2", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-task-"));
  await mkdir(path.join(root, "project"));
  const taskFile = path.join(root, "task.yaml");
  await writeFile(
    taskFile,
    `version: 1
name: Unsafe shell
project: ./project
goal: Test
worker:
  allowedCommands:
    - git status
acceptance:
  commands:
    - node --test
`,
  );
  await assert.rejects(() => loadTaskSpec(taskFile), /allowedCommands to be empty/);
});
