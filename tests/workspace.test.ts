import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readlink, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { taskPaths } from "../src/core/config.js";
import type { TaskSpec } from "../src/core/types.js";
import {
  assessSourceCompatibility,
  prepareWorkspace,
} from "../src/workspace/copy.js";
import {
  parseAffectedPathsFromWorkspaceDiff,
  writeWorkspacePatchReport,
} from "../src/workspace/patch.js";
import { createPathPolicy } from "../src/workspace/path-policy.js";

test("PathPolicy classifies nested generated, business, and internal paths", async () => {
  const { createPathPolicy, workspacePatchPaths } = await import(
    "../src/workspace/path-policy.js"
  );
  const taskSpec = spec("/tmp/project");
  taskSpec.workspace.generatedPaths = ["**/.custom-cache/**"];
  const policy = createPathPolicy(taskSpec);

  assert.equal(policy.classify("pkg/__pycache__/a.pyc"), "generated");
  assert.equal(policy.classify("pkg/.pytest_cache/v/cache"), "generated");
  assert.equal(policy.classify("pkg/.custom-cache/value.bin"), "generated");
  assert.equal(policy.classify("src/generated/client.ts"), "business");
  assert.equal(policy.classify(".forklight/workspace-context.md"), "internal");

  const paths = taskPaths("/tmp/forklight-state", "task-1");
  assert.deepEqual(workspacePatchPaths(paths), {
    rawDiff: path.join(paths.root, "workspace.raw.patch"),
    generatedDiff: path.join(paths.root, "workspace.generated.patch"),
    integrationDiff: paths.diff,
  });
});

test("classified patch generation is non-destructive", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-classified-patch-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "src"), { recursive: true });
  await mkdir(path.join(source, "pkg", "__pycache__"), { recursive: true });
  await writeFile(path.join(source, "src", "value.ts"), "before\n");
  await writeFile(path.join(source, "pkg", "__pycache__", "value.pyc"), "cache-before");

  const paths = taskPaths(path.join(root, "state"), "classified");
  const taskSpec = spec(source);
  await prepareWorkspace(taskSpec, paths);
  await writeFile(path.join(paths.workspace, "src", "value.ts"), "after\n");
  const generatedCache = path.join(paths.workspace, "pkg", "__pycache__", "value.pyc");
  await writeFile(generatedCache, "cache-after");
  await writeFile(path.join(paths.workspace, ".forklight", "temp.txt"), "internal\n");

  const { createPathPolicy, workspacePatchPaths } = await import(
    "../src/workspace/path-policy.js"
  );
  const { writeWorkspacePatchReport } = await import("../src/workspace/patch.js");
  const report = await writeWorkspacePatchReport(paths, createPathPolicy(taskSpec));
  const artifacts = workspacePatchPaths(paths);

  assert.equal(await readFile(generatedCache, "utf8"), "cache-after");
  assert.deepEqual(report.business.affectedPaths, ["src/value.ts"]);
  assert.deepEqual(report.generated.affectedPaths, ["pkg/__pycache__/value.pyc"]);
  assert.deepEqual(report.integration.affectedPaths, ["src/value.ts"]);
  assert.doesNotMatch(await readFile(paths.diff, "utf8"), /__pycache__/);
  assert.match(await readFile(artifacts.rawDiff, "utf8"), /__pycache__/);
  assert.match(await readFile(artifacts.generatedDiff, "utf8"), /__pycache__/);
  assert.doesNotMatch(await readFile(paths.diff, "utf8"), /\.forklight/);
});

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
  taskSpec.workspace.generatedPaths = ["dist/**"];
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
  assert.equal(
    (await assessSourceCompatibility(taskSpec, paths, [])).globalUnchanged,
    true,
  );
  const report = await writeWorkspacePatchReport(paths, createPathPolicy(taskSpec));
  const diff = await readFile(paths.diff, "utf8");
  assert.match(diff, /-before/);
  assert.match(diff, /\+after/);
  assert.doesNotMatch(diff, /node_modules/);
  assert.doesNotMatch(diff, /generated\.js/);
  assert.deepEqual(report.generated.affectedPaths, ["dist/generated.js"]);
});

test("parseAffectedPathsFromWorkspaceDiff extracts baseline/workspace relative paths", () => {
  const diff = [
    "diff --git a/baseline/src/a.ts b/workspace/src/a.ts",
    "--- a/baseline/src/a.ts",
    "+++ b/workspace/src/a.ts",
    "diff --git a/workspace/src/new.ts b/workspace/src/new.ts",
    "--- /dev/null",
    "+++ b/workspace/src/new.ts",
  ].join("\n");
  assert.deepEqual(parseAffectedPathsFromWorkspaceDiff(diff), ["src/a.ts", "src/new.ts"]);
});

test("source compatibility ignores unrelated project drift (FL-D33/D110)", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-src-compat-"));
  const source = path.join(root, "source");
  await mkdir(source);
  await writeFile(path.join(source, "value.txt"), "before\n");
  await writeFile(path.join(source, "NOTES.md"), "notes\n");
  const paths = taskPaths(path.join(root, "state"), "compat-1");
  const taskSpec = spec(source);
  await prepareWorkspace(taskSpec, paths);
  await writeFile(path.join(paths.workspace, "value.txt"), "after\n");

  // Concurrent dogfood: unrelated doc changes in the real source tree.
  await writeFile(path.join(source, "NOTES.md"), "notes updated by another agent\n");
  await writeFile(path.join(source, "forklight-dogfood-log.md"), "new log\n");

  const report = await writeWorkspacePatchReport(paths, createPathPolicy(taskSpec));
  const affected = report.integration.affectedPaths;
  assert.deepEqual(affected, ["value.txt"]);
  const assessment = await assessSourceCompatibility(taskSpec, paths, affected);
  assert.equal(assessment.globalUnchanged, false);
  assert.equal(assessment.compatible, true);
  assert.deepEqual(assessment.conflictingPaths, []);
  assert.ok(assessment.unrelatedDriftPaths.includes("NOTES.md"));
  assert.ok(assessment.unrelatedDriftPaths.includes("forklight-dogfood-log.md"));
});

test("source compatibility hard-fails when an affected path changes in source", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-src-conflict-"));
  const source = path.join(root, "source");
  await mkdir(source);
  await writeFile(path.join(source, "value.txt"), "before\n");
  const paths = taskPaths(path.join(root, "state"), "compat-2");
  const taskSpec = spec(source);
  await prepareWorkspace(taskSpec, paths);
  await writeFile(path.join(paths.workspace, "value.txt"), "worker-edit\n");
  // Someone else edited the same path in the real project.
  await writeFile(path.join(source, "value.txt"), "concurrent-edit\n");

  const report = await writeWorkspacePatchReport(paths, createPathPolicy(taskSpec));
  const affected = report.integration.affectedPaths;
  const assessment = await assessSourceCompatibility(taskSpec, paths, affected);
  assert.equal(assessment.compatible, false);
  assert.deepEqual(assessment.conflictingPaths, ["value.txt"]);
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

test("bounded workspace context preserves totals and focus guidance", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-large-context-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "src", "focus"), { recursive: true });
  await mkdir(path.join(source, "packages", "bulk"), { recursive: true });
  for (let index = 0; index < 20; index += 1) {
    await writeFile(
      path.join(source, "src", "focus", `file-${String(index).padStart(3, "0")}.txt`),
      `${index}\n`,
    );
  }
  for (let index = 0; index < 480; index += 1) {
    await writeFile(
      path.join(source, "packages", "bulk", `file-${String(index).padStart(3, "0")}.txt`),
      `${index}\n`,
    );
  }

  const taskSpec = spec(source);
  taskSpec.worker.focusPaths = ["src/focus"];
  const paths = taskPaths(path.join(root, "state"), "large-context");
  await prepareWorkspace(taskSpec, paths);
  const context = await readFile(
    path.join(paths.workspace, ".forklight", "workspace-context.md"),
    "utf8",
  );

  assert.match(context, /Visible files: 500/);
  assert.match(context, /Showing at most 200/);
  assert.match(context, /focus path/i);
  assert.match(context, /src\/focus\/file-000\.txt/);
  assert.ok(Buffer.byteLength(context, "utf8") < 64_000);
});
