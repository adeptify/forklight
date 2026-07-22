import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readlink, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { taskPaths } from "../src/core/config.js";
import type { TaskSpec } from "../src/core/types.js";
import { prepareWorkspace, sourceIsUnchanged, writeWorkspaceDiff } from "../src/workspace/copy.js";

function spec(project: string): TaskSpec {
  return {
    version: 1,
    name: "Workspace test",
    project,
    goal: "Prove isolation",
    constraints: [],
    provider: {
      name: "deepseek",
      model: "deepseek-v4-flash",
      keychainService: "forklight.deepseek.api-key",
    },
    runtime: {
      name: "claude-code",
      executable: "claude",
      effort: "high",
      maxBudgetUsd: 0.25,
    },
    workspace: { exclude: [".git", "node_modules"] },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
    acceptance: { commands: ["node --test"] },
  };
}

test("isolates Worker changes and produces a diff", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-workspace-"));
  const source = path.join(root, "source");
  await mkdir(source);
  await mkdir(path.join(source, "node_modules", "example"), { recursive: true });
  await writeFile(path.join(source, "node_modules", "example", "index.js"), "export default true;\n");
  await writeFile(path.join(source, "value.txt"), "before\n");
  const paths = taskPaths(path.join(root, "state"), "task-1");
  const taskSpec = spec(source);
  await prepareWorkspace(taskSpec, paths);

  assert.equal(await readlink(path.join(paths.workspace, "node_modules")), path.join(source, "node_modules"));
  assert.equal(await readlink(path.join(paths.baseline, "node_modules")), path.join(source, "node_modules"));
  const workspaceContext = await readFile(
    path.join(paths.workspace, ".forklight", "workspace-context.md"),
    "utf8",
  );
  assert.match(workspaceContext, /value\.txt/);
  assert.match(workspaceContext, /Use Read for files/);

  await writeFile(path.join(paths.workspace, "value.txt"), "after\n");
  await mkdir(path.join(paths.workspace, "dist"));
  await writeFile(path.join(paths.workspace, "dist", "generated.js"), "generated\n");
  assert.equal(await readFile(path.join(source, "value.txt"), "utf8"), "before\n");
  assert.equal(await sourceIsUnchanged(taskSpec, paths), true);
  const diff = await writeWorkspaceDiff(paths, ["dist"]);
  assert.match(diff, /-before/);
  assert.match(diff, /\+after/);
  assert.doesNotMatch(diff, /node_modules/);
  assert.doesNotMatch(diff, /generated\.js/);
});

test("reuses a dependency directory that is already linked by a parent workspace", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-nested-workspace-"));
  const dependencies = path.join(root, "dependencies");
  const source = path.join(root, "source");
  await mkdir(path.join(dependencies, "example"), { recursive: true });
  await mkdir(source);
  await writeFile(path.join(dependencies, "example", "index.js"), "export default true;\n");
  await writeFile(path.join(source, "value.txt"), "before\n");
  await symlink(dependencies, path.join(source, "node_modules"), "dir");

  const paths = taskPaths(path.join(root, "state"), "nested-task");
  const manifest = await prepareWorkspace(spec(source), paths);
  const resolvedDependencies = await realpath(dependencies);

  assert.deepEqual(manifest.linkedDependencies, ["node_modules"]);
  assert.equal(await readlink(path.join(paths.workspace, "node_modules")), resolvedDependencies);
  assert.equal(await readlink(path.join(paths.baseline, "node_modules")), resolvedDependencies);
});
