import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, mkdir, readFile, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { taskPaths } from "../src/core/config.js";
import type { TaskSpec } from "../src/core/types.js";
import {
  assessSourceCompatibility,
  clearTaskPreparationArtifacts,
  isWorkspaceReady,
  PREPARATION_STAGES,
  prepareWorkspace,
  type PreparationObservation,
} from "../src/workspace/copy.js";
import {
  copyForVerification,
} from "../src/core/integration-verification-copy.js";
import {
  excludedRootStashPath,
  parseAffectedPathsFromWorkspaceDiff,
  writeWorkspacePatchReport,
} from "../src/workspace/patch.js";
import { createPathPolicy, matchesExcludedSegment } from "../src/workspace/path-policy.js";

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

  // Workspace gets a real local dependency mirror; baseline stays dependency-free.
  const workspaceModules = await lstat(path.join(paths.workspace, "node_modules"));
  assert.equal(workspaceModules.isDirectory(), true);
  assert.equal(workspaceModules.isSymbolicLink(), false);
  await assert.rejects(
    () => lstat(path.join(paths.baseline, "node_modules")),
    /ENOENT/,
  );
  // Local mirror is not an external link to the source project.
  const workspaceReal = await realpath(path.join(paths.workspace, "node_modules"));
  const sourceReal = await realpath(path.join(source, "node_modules"));
  assert.notEqual(workspaceReal, sourceReal);
  assert.ok(workspaceReal.startsWith(await realpath(paths.workspace)));

  const workspaceContext = await readFile(
    path.join(paths.workspace, ".forklight", "workspace-context.md"),
    "utf8",
  );
  assert.match(workspaceContext, /value\.txt/);
  assert.match(workspaceContext, /Use Read for files/);
  assert.match(workspaceContext, /Verifier-only dependency mirrors/);

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

test("materializes content when source node_modules is a parent-workspace link", async () => {
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

  assert.deepEqual(manifest.linkedDependencies, ["node_modules"]);
  const workspaceModules = await lstat(path.join(paths.workspace, "node_modules"));
  assert.equal(workspaceModules.isDirectory(), true);
  assert.equal(workspaceModules.isSymbolicLink(), false);
  // Content is mirrored locally; it is not an external symlink to the parent deps.
  assert.equal(
    await readFile(path.join(paths.workspace, "node_modules", "example", "index.js"), "utf8"),
    "export default true;\n",
  );
  const workspaceReal = await realpath(path.join(paths.workspace, "node_modules"));
  assert.notEqual(workspaceReal, await realpath(dependencies));
  await assert.rejects(
    () => lstat(path.join(paths.baseline, "node_modules")),
    /ENOENT/,
  );
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

test("generated output larger than legacy process cap cannot starve business source", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-large-gen-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "src"), { recursive: true });
  await mkdir(path.join(source, "dist"), { recursive: true });
  await writeFile(path.join(source, "src", "value.ts"), "before ✓\n");
  await writeFile(path.join(source, "dist", "bundle.js"), "seed\n");
  const paths = taskPaths(path.join(root, "state"), "large-gen");
  const taskSpec = spec(source);
  taskSpec.workspace.generatedPaths = ["dist/**"];
  await prepareWorkspace(taskSpec, paths);
  await writeFile(path.join(paths.workspace, "src", "value.ts"), "after ✓\n");
  const largeLines: string[] = [];
  for (let i = 0; i < 22_000; i += 1) {
    largeLines.push(`// ${String(i).padStart(5, "0")}: ${"x".repeat(60)}`);
  }
  await writeFile(path.join(paths.workspace, "dist", "bundle.js"), largeLines.join("\n") + "\n");
  const { createPathPolicy, workspacePatchPaths } = await import(
    "../src/workspace/path-policy.js"
  );
  const { writeWorkspacePatchReport } = await import("../src/workspace/patch.js");
  const report = await writeWorkspacePatchReport(paths, createPathPolicy(taskSpec));
  const artifacts = workspacePatchPaths(paths);
  const raw = await readFile(artifacts.rawDiff, "utf8");
  assert.match(raw, /dist\/bundle\.js/);
  assert.match(raw, /src\/value\.ts/);
  assert.ok(raw.length > 1_100_000);
  assert.doesNotMatch(raw, /truncated/i);
  const generated = await readFile(artifacts.generatedDiff, "utf8");
  assert.match(generated, /dist\/bundle\.js/);
  assert.doesNotMatch(generated, /src\/value\.ts/);
  assert.ok(generated.length > 1_100_000);
  assert.doesNotMatch(generated, /truncated/i);
  const integration = await readFile(artifacts.integrationDiff, "utf8");
  assert.match(integration, /src\/value\.ts/);
  assert.match(integration, /-before/);
  assert.match(integration, /\+after/);
  assert.match(integration, /✓/);
  assert.doesNotMatch(integration, /dist\/bundle\.js/);
  assert.doesNotMatch(integration, /truncated/i);
  assert.deepEqual(report.business.affectedPaths, ["src/value.ts"]);
  assert.deepEqual(report.generated.affectedPaths, ["dist/bundle.js"]);
  assert.deepEqual(report.integration.affectedPaths, ["src/value.ts"]);
  assert.equal(report.generated.filesChanged, 1);
  assert.equal(report.business.filesChanged, 1);
  assert.ok(report.generated.changedLines > 2);
  assert.equal(report.business.changedLines, 2);
});

test("excluded snapshot segments share one nested-segment meaning across copy and classification", async () => {
  const taskSpec = spec("/tmp/project");
  // dist and coverage are excluded from the snapshot but NOT declared in
  // generatedPaths - the exclusion alone must classify recreated output.
  taskSpec.workspace.exclude = [".git", "node_modules", "dist", "coverage"];
  const policy = createPathPolicy(taskSpec);
  const excludes = policy.snapshotExcludes;

  // Nested segments match exactly as top-level segments do, on both the
  // shared matcher (used by snapshot copying) and PathPolicy.classify
  // (used by Patch generation).
  assert.equal(matchesExcludedSegment("coverage", excludes), true);
  assert.equal(matchesExcludedSegment("pkg/coverage/report.json", excludes), true);
  assert.equal(matchesExcludedSegment("dist/bundle.js", excludes), true);
  assert.equal(matchesExcludedSegment("apps/web/dist/main.js", excludes), true);
  assert.equal(matchesExcludedSegment("node_modules/pkg/index.js", excludes), true);
  // An included source path whose name contains "generated" is not excluded
  // by a name heuristic.
  assert.equal(matchesExcludedSegment("src/generated/client.ts", excludes), false);
  assert.equal(matchesExcludedSegment(".", excludes), false);
  assert.equal(matchesExcludedSegment("", excludes), false);

  // Classification follows the same meaning: excluded segments are generated
  // evidence, never business or Integration eligible.
  assert.equal(policy.classify("pkg/coverage/report.json"), "generated");
  assert.equal(policy.classify("apps/web/dist/main.js"), "generated");
  assert.equal(policy.classify("node_modules/pkg/index.js"), "generated");
  // ForkLight internal paths remain internal regardless of exclusion.
  assert.equal(policy.classify(".forklight/workspace-context.md"), "internal");
  // Included source whose name contains "generated" stays business.
  assert.equal(policy.classify("src/generated/client.ts"), "business");

  // Explicit generatedPaths still classify included generated content, and
  // do not downgrade included source whose name contains "generated".
  taskSpec.workspace.generatedPaths = ["**/.custom-cache/**"];
  const withPatterns = createPathPolicy(taskSpec);
  assert.equal(withPatterns.classify("pkg/.custom-cache/value.bin"), "generated");
  assert.equal(withPatterns.classify("src/generated/client.ts"), "business");
});

test("recreated excluded dist tree stays out of raw generated and integration evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-excluded-dist-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "src"), { recursive: true });
  await writeFile(path.join(source, "src", "value.ts"), "before\n");
  // dist is intentionally absent from the source baseline.
  const paths = taskPaths(path.join(root, "state"), "excluded-dist");
  const taskSpec = spec(source);
  // dist is excluded from the snapshot but NOT declared in generatedPaths,
  // matching the scenario where a verifier build recreates it later.
  taskSpec.workspace.exclude = [".git", "node_modules", "dist"];
  await prepareWorkspace(taskSpec, paths);

  // Worker edits one real source file.
  await writeFile(path.join(paths.workspace, "src", "value.ts"), "after\n");
  // An independent acceptance build recreates a large dist tree that was
  // never present in the baseline snapshot.
  await mkdir(path.join(paths.workspace, "dist", "nested"), { recursive: true });
  for (let i = 0; i < 200; i += 1) {
    await writeFile(
      path.join(paths.workspace, "dist", `bundle-${i}.js`),
      `// generated ${i}\n`,
    );
  }
  await writeFile(path.join(paths.workspace, "dist", "nested", "report.json"), "{}\n");
  const distSentinel = path.join(paths.workspace, "dist", "bundle-0.js");
  const distBytes = await readFile(distSentinel, "utf8");

  const { workspacePatchPaths } = await import("../src/workspace/path-policy.js");
  const { writeWorkspacePatchReport } = await import("../src/workspace/patch.js");
  const report = await writeWorkspacePatchReport(paths, createPathPolicy(taskSpec));
  const artifacts = workspacePatchPaths(paths);

  // Snapshot-excluded trees never enter raw/generated/Integration payloads.
  const raw = await readFile(artifacts.rawDiff, "utf8");
  assert.match(raw, /src\/value\.ts/);
  assert.doesNotMatch(raw, /dist\//);
  assert.doesNotMatch(raw, /bundle-0/);
  assert.doesNotMatch(raw, /generated 199/);
  assert.ok(raw.length < 50_000, "raw patch stays bounded by included content");

  const generated = await readFile(artifacts.generatedDiff, "utf8");
  assert.doesNotMatch(generated, /dist\//);
  assert.doesNotMatch(generated, /src\/value\.ts/);

  // Integration evidence keeps only the source change.
  const integration = await readFile(artifacts.integrationDiff, "utf8");
  assert.match(integration, /src\/value\.ts/);
  assert.match(integration, /-before/);
  assert.match(integration, /\+after/);
  assert.doesNotMatch(integration, /dist\//);

  // Metrics: business/integration count only the source file; excluded
  // verifier output is absent from generated evidence too.
  assert.deepEqual(report.business.affectedPaths, ["src/value.ts"]);
  assert.deepEqual(report.integration.affectedPaths, ["src/value.ts"]);
  assert.equal(report.business.filesChanged, 1);
  assert.equal(report.business.changedLines, 2);
  assert.equal(report.generated.filesChanged, 0);
  assert.equal(report.generated.changedLines, 0);
  assert.deepEqual(report.generated.affectedPaths, []);

  // Retained workspace still holds the excluded verifier tree unchanged.
  assert.equal(await readFile(distSentinel, "utf8"), distBytes);
  assert.equal(
    await readFile(path.join(paths.workspace, "dist", "nested", "report.json"), "utf8"),
    "{}\n",
  );
});

test("nested excluded Rust target never enters raw patch and is restored", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-nested-target-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "apps", "shell", "src-tauri"), { recursive: true });
  await writeFile(path.join(source, "apps", "shell", "src-tauri", "main.rs"), "fn main() {}\n");
  const paths = taskPaths(path.join(root, "state"), "nested-target");
  const taskSpec = spec(source);
  taskSpec.workspace.exclude = [".git", "node_modules", "target"];
  await prepareWorkspace(taskSpec, paths);

  await writeFile(
    path.join(paths.workspace, "apps", "shell", "src-tauri", "main.rs"),
    "fn main() { /* edited */ }\n",
  );
  // Verifier-created nested target with a large sparse/binary sentinel.
  const targetDir = path.join(
    paths.workspace,
    "apps",
    "shell",
    "src-tauri",
    "target",
    "release",
  );
  await mkdir(targetDir, { recursive: true });
  const sentinel = "NESTED_TARGET_SENTINEL_" + "X".repeat(64 * 1024);
  await writeFile(path.join(targetDir, "app.bin"), sentinel);

  const { workspacePatchPaths } = await import("../src/workspace/path-policy.js");
  const report = await writeWorkspacePatchReport(paths, createPathPolicy(taskSpec));
  const artifacts = workspacePatchPaths(paths);

  const raw = await readFile(artifacts.rawDiff, "utf8");
  const generated = await readFile(artifacts.generatedDiff, "utf8");
  const integration = await readFile(artifacts.integrationDiff, "utf8");
  for (const body of [raw, generated, integration]) {
    assert.doesNotMatch(body, /NESTED_TARGET_SENTINEL_/);
    assert.doesNotMatch(body, /src-tauri\/target/);
    assert.doesNotMatch(body, /app\.bin/);
  }
  assert.match(raw, /main\.rs/);
  assert.match(integration, /main\.rs/);
  assert.deepEqual(report.business.affectedPaths, ["apps/shell/src-tauri/main.rs"]);
  assert.deepEqual(report.generated.affectedPaths, []);
  assert.ok(raw.length < sentinel.length, "raw patch smaller than excluded sentinel alone");

  // Restored for retained-workspace inspection.
  assert.equal(await readFile(path.join(targetDir, "app.bin"), "utf8"), sentinel);
});

test("multiple outermost excluded roots stash once and restore deterministically", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-multi-exclude-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "src"), { recursive: true });
  await writeFile(path.join(source, "src", "app.ts"), "v1\n");
  const paths = taskPaths(path.join(root, "state"), "multi-exclude");
  const taskSpec = spec(source);
  taskSpec.workspace.exclude = [".git", "node_modules", "dist", "target", "coverage"];
  await prepareWorkspace(taskSpec, paths);

  await writeFile(path.join(paths.workspace, "src", "app.ts"), "v2\n");
  // Top-level and nested excluded roots, including a child exclude under a
  // parent exclude (dist/node_modules) that must move only with the parent.
  await mkdir(path.join(paths.workspace, "node_modules", "pkg"), { recursive: true });
  await writeFile(path.join(paths.workspace, "node_modules", "pkg", "index.js"), "TOP_NM\n");
  await mkdir(path.join(paths.workspace, "dist", "node_modules", "inner"), { recursive: true });
  await writeFile(
    path.join(paths.workspace, "dist", "node_modules", "inner", "x.js"),
    "NESTED_UNDER_DIST\n",
  );
  await writeFile(path.join(paths.workspace, "dist", "out.js"), "DIST_OUT\n");
  await mkdir(
    path.join(paths.workspace, "apps", "web", "target", "debug"),
    { recursive: true },
  );
  await writeFile(
    path.join(paths.workspace, "apps", "web", "target", "debug", "lib.rlib"),
    "TARGET_LIB\n",
  );
  await mkdir(path.join(paths.workspace, "pkg", "coverage"), { recursive: true });
  await writeFile(path.join(paths.workspace, "pkg", "coverage", "report.json"), "COV\n");

  const { workspacePatchPaths } = await import("../src/workspace/path-policy.js");
  const report = await writeWorkspacePatchReport(paths, createPathPolicy(taskSpec));
  const artifacts = workspacePatchPaths(paths);
  const raw = await readFile(artifacts.rawDiff, "utf8");
  for (const marker of ["TOP_NM", "NESTED_UNDER_DIST", "DIST_OUT", "TARGET_LIB", "COV"]) {
    assert.doesNotMatch(raw, new RegExp(marker));
  }
  assert.doesNotMatch(raw, /node_modules/);
  assert.doesNotMatch(raw, /dist\//);
  assert.doesNotMatch(raw, /target\//);
  assert.doesNotMatch(raw, /coverage/);
  assert.match(raw, /app\.ts/);
  assert.deepEqual(report.business.affectedPaths, ["src/app.ts"]);
  assert.deepEqual(report.generated.affectedPaths, []);

  // Every original location is recovered; child under dist stayed with parent.
  assert.equal(
    await readFile(path.join(paths.workspace, "node_modules", "pkg", "index.js"), "utf8"),
    "TOP_NM\n",
  );
  assert.equal(
    await readFile(path.join(paths.workspace, "dist", "node_modules", "inner", "x.js"), "utf8"),
    "NESTED_UNDER_DIST\n",
  );
  assert.equal(await readFile(path.join(paths.workspace, "dist", "out.js"), "utf8"), "DIST_OUT\n");
  assert.equal(
    await readFile(
      path.join(paths.workspace, "apps", "web", "target", "debug", "lib.rlib"),
      "utf8",
    ),
    "TARGET_LIB\n",
  );
  assert.equal(
    await readFile(path.join(paths.workspace, "pkg", "coverage", "report.json"), "utf8"),
    "COV\n",
  );
});

test("exact excluded segment leaves similar names like targeted in Candidate", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-exact-segment-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "targeted"), { recursive: true });
  await writeFile(path.join(source, "targeted", "file.ts"), "before\n");
  const paths = taskPaths(path.join(root, "state"), "exact-segment");
  const taskSpec = spec(source);
  taskSpec.workspace.exclude = [".git", "node_modules", "target"];
  await prepareWorkspace(taskSpec, paths);

  await writeFile(path.join(paths.workspace, "targeted", "file.ts"), "after\n");
  await mkdir(path.join(paths.workspace, "pkg", "target", "debug"), { recursive: true });
  await writeFile(
    path.join(paths.workspace, "pkg", "target", "debug", "blob.bin"),
    "EXCLUDED_TARGET_BYTES\n",
  );

  const { workspacePatchPaths } = await import("../src/workspace/path-policy.js");
  const report = await writeWorkspacePatchReport(paths, createPathPolicy(taskSpec));
  const artifacts = workspacePatchPaths(paths);
  const raw = await readFile(artifacts.rawDiff, "utf8");
  const integration = await readFile(artifacts.integrationDiff, "utf8");

  assert.match(raw, /targeted\/file\.ts/);
  assert.match(integration, /targeted\/file\.ts/);
  assert.doesNotMatch(raw, /EXCLUDED_TARGET_BYTES/);
  assert.doesNotMatch(raw, /blob\.bin/);
  assert.doesNotMatch(integration, /EXCLUDED_TARGET_BYTES/);
  assert.deepEqual(report.business.affectedPaths, ["targeted/file.ts"]);
  assert.deepEqual(report.integration.affectedPaths, ["targeted/file.ts"]);
  assert.deepEqual(report.generated.affectedPaths, []);
  assert.equal(
    await readFile(path.join(paths.workspace, "pkg", "target", "debug", "blob.bin"), "utf8"),
    "EXCLUDED_TARGET_BYTES\n",
  );
});

test("included generatedPaths stay generated evidence when not snapshot-excluded", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-included-gen-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "src"), { recursive: true });
  await writeFile(path.join(source, "src", "value.ts"), "before\n");
  const paths = taskPaths(path.join(root, "state"), "included-gen");
  const taskSpec = spec(source);
  // dist is NOT snapshot-excluded; only classified via generatedPaths.
  taskSpec.workspace.exclude = [".git", "node_modules"];
  taskSpec.workspace.generatedPaths = ["dist/**"];
  await prepareWorkspace(taskSpec, paths);

  await writeFile(path.join(paths.workspace, "src", "value.ts"), "after\n");
  await mkdir(path.join(paths.workspace, "dist"), { recursive: true });
  await writeFile(path.join(paths.workspace, "dist", "out.js"), "build-output\n");

  const { workspacePatchPaths } = await import("../src/workspace/path-policy.js");
  const report = await writeWorkspacePatchReport(paths, createPathPolicy(taskSpec));
  const artifacts = workspacePatchPaths(paths);

  assert.deepEqual(report.business.affectedPaths, ["src/value.ts"]);
  assert.deepEqual(report.generated.affectedPaths, ["dist/out.js"]);
  assert.deepEqual(report.integration.affectedPaths, ["src/value.ts"]);
  assert.match(await readFile(artifacts.rawDiff, "utf8"), /dist\/out\.js/);
  assert.match(await readFile(artifacts.generatedDiff, "utf8"), /dist\/out\.js/);
  assert.doesNotMatch(await readFile(artifacts.integrationDiff, "utf8"), /dist\/out\.js/);
});

test("excluded roots restore after injected patch failure", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-exclude-fail-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "src"), { recursive: true });
  await writeFile(path.join(source, "src", "value.ts"), "before\n");
  const paths = taskPaths(path.join(root, "state"), "exclude-fail");
  const taskSpec = spec(source);
  taskSpec.workspace.exclude = [".git", "node_modules", "target", "dist"];
  await prepareWorkspace(taskSpec, paths);

  await writeFile(path.join(paths.workspace, "src", "value.ts"), "after\n");
  const nestedTarget = path.join(
    paths.workspace,
    "apps",
    "shell",
    "src-tauri",
    "target",
    "release",
  );
  await mkdir(nestedTarget, { recursive: true });
  await writeFile(path.join(nestedTarget, "app.bin"), "FAIL_RESTORE_SENTINEL\n");
  await mkdir(path.join(paths.workspace, "dist"), { recursive: true });
  await writeFile(path.join(paths.workspace, "dist", "out.js"), "DIST_FAIL\n");

  await assert.rejects(
    () => writeWorkspacePatchReport(paths, createPathPolicy(taskSpec), {
      afterExcludedRootStash: async () => {
        // Prove roots were moved out of the comparison tree before diff.
        await assert.rejects(() => lstat(nestedTarget), /ENOENT/);
        await assert.rejects(
          () => lstat(path.join(paths.workspace, "dist")),
          /ENOENT/,
        );
        throw new Error("injected patch failure after exclude stash");
      },
    }),
    /injected patch failure after exclude stash/,
  );

  // Finally restoration returns every excluded root; no partial Integration.
  assert.equal(
    await readFile(path.join(nestedTarget, "app.bin"), "utf8"),
    "FAIL_RESTORE_SENTINEL\n",
  );
  assert.equal(
    await readFile(path.join(paths.workspace, "dist", "out.js"), "utf8"),
    "DIST_FAIL\n",
  );
  await assert.rejects(() => lstat(paths.diff), /ENOENT/);
});

test("exclude discovery never follows symlinks outside comparison trees", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-exclude-symlink-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "src"), { recursive: true });
  await writeFile(path.join(source, "src", "value.ts"), "before\n");
  const paths = taskPaths(path.join(root, "state"), "exclude-symlink");
  const taskSpec = spec(source);
  taskSpec.workspace.exclude = [".git", "node_modules", "target"];
  await prepareWorkspace(taskSpec, paths);

  await writeFile(path.join(paths.workspace, "src", "value.ts"), "after\n");
  // External tree that must never be moved or read into the patch. Identical
  // symlinks in both comparison trees keep the link itself out of the Candidate
  // while proving discovery refuses to traverse it looking for `target`.
  const outside = path.join(root, "outside");
  await mkdir(path.join(outside, "target"), { recursive: true });
  await writeFile(path.join(outside, "target", "escape.bin"), "OUTSIDE_TARGET_SENTINEL\n");
  await symlink(outside, path.join(paths.baseline, "linked-out"));
  await symlink(outside, path.join(paths.workspace, "linked-out"));

  // Real in-tree excluded root still stashed/restored.
  await mkdir(path.join(paths.workspace, "real", "target"), { recursive: true });
  await writeFile(path.join(paths.workspace, "real", "target", "in.bin"), "IN_TREE\n");

  const { workspacePatchPaths } = await import("../src/workspace/path-policy.js");
  const report = await writeWorkspacePatchReport(paths, createPathPolicy(taskSpec));
  const artifacts = workspacePatchPaths(paths);
  const raw = await readFile(artifacts.rawDiff, "utf8");

  assert.doesNotMatch(raw, /OUTSIDE_TARGET_SENTINEL/);
  assert.doesNotMatch(raw, /escape\.bin/);
  assert.doesNotMatch(raw, /IN_TREE/);
  assert.match(raw, /value\.ts/);
  assert.deepEqual(report.business.affectedPaths, ["src/value.ts"]);

  // Outside tree untouched; in-tree target restored.
  assert.equal(
    await readFile(path.join(outside, "target", "escape.bin"), "utf8"),
    "OUTSIDE_TARGET_SENTINEL\n",
  );
  assert.equal(
    await readFile(path.join(paths.workspace, "real", "target", "in.bin"), "utf8"),
    "IN_TREE\n",
  );
  // Symlink itself remains in the workspace (not an excluded segment name).
  assert.equal(await readlink(path.join(paths.workspace, "linked-out")), outside);
});

test("exclude discovery fails closed on unreadable directories", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-exclude-eacces-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "src"), { recursive: true });
  await writeFile(path.join(source, "src", "value.ts"), "before\n");
  const paths = taskPaths(path.join(root, "state"), "exclude-eacces");
  const taskSpec = spec(source);
  taskSpec.workspace.exclude = [".git", "node_modules", "target"];
  await prepareWorkspace(taskSpec, paths);

  await writeFile(path.join(paths.workspace, "src", "value.ts"), "after\n");
  // Nested excluded output under a directory the walker cannot read: discovery
  // must not swallow EACCES and must not produce Candidate evidence.
  const hidden = path.join(paths.workspace, "hidden");
  await mkdir(path.join(hidden, "target", "release"), { recursive: true });
  await writeFile(path.join(hidden, "target", "release", "app.bin"), "HIDDEN_TARGET\n");
  await chmod(hidden, 0o000);
  try {
    await assert.rejects(
      () => writeWorkspacePatchReport(paths, createPathPolicy(taskSpec)),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        const code = (error as NodeJS.ErrnoException).code;
        assert.equal(code, "EACCES");
        return true;
      },
    );
    // No partial Integration authorization artifact.
    await assert.rejects(() => lstat(paths.diff), /ENOENT/);
  } finally {
    await chmod(hidden, 0o755);
  }
});

test("exclude stash refuses pre-existing destination and keeps both roots distinct", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-exclude-collision-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "src"), { recursive: true });
  await writeFile(path.join(source, "src", "value.ts"), "before\n");
  const paths = taskPaths(path.join(root, "state"), "exclude-collision");
  const taskSpec = spec(source);
  // `x+y` is a legal single-segment exclude; with separator substitution it
  // would collide with nested `x/y` when y is also excluded. Hash destinations
  // must keep both distinct.
  taskSpec.workspace.exclude = [".git", "node_modules", "y", "x+y", "dist"];
  await prepareWorkspace(taskSpec, paths);

  await writeFile(path.join(paths.workspace, "src", "value.ts"), "after\n");
  await mkdir(path.join(paths.workspace, "x", "y"), { recursive: true });
  await writeFile(path.join(paths.workspace, "x", "y", "nested.bin"), "NESTED_XY\n");
  await mkdir(path.join(paths.workspace, "x+y"), { recursive: true });
  await writeFile(path.join(paths.workspace, "x+y", "plus.bin"), "PLUS_XY\n");
  await mkdir(path.join(paths.workspace, "dist"), { recursive: true });
  await writeFile(path.join(paths.workspace, "dist", "out.js"), "DIST_OK\n");

  // Distinct collision-resistant destinations for paths that share a "+" encoding.
  const nestedStash = excludedRootStashPath(paths.root, "workspace", "x/y");
  const plusStash = excludedRootStashPath(paths.root, "workspace", "x+y");
  assert.notEqual(nestedStash, plusStash);

  // Pre-existing stash for dist must not be deleted or overwritten.
  const distStash = excludedRootStashPath(paths.root, "workspace", "dist");
  await writeFile(distStash, "PREEXISTING_STASH\n");

  await assert.rejects(
    () => writeWorkspacePatchReport(paths, createPathPolicy(taskSpec)),
    /stash destination already exists/,
  );

  assert.equal(await readFile(distStash, "utf8"), "PREEXISTING_STASH\n");
  // Earlier moves roll back; every excluded root remains at its original path.
  assert.equal(
    await readFile(path.join(paths.workspace, "x", "y", "nested.bin"), "utf8"),
    "NESTED_XY\n",
  );
  assert.equal(
    await readFile(path.join(paths.workspace, "x+y", "plus.bin"), "utf8"),
    "PLUS_XY\n",
  );
  assert.equal(
    await readFile(path.join(paths.workspace, "dist", "out.js"), "utf8"),
    "DIST_OK\n",
  );
  await assert.rejects(() => lstat(paths.diff), /ENOENT/);
});

test("exclude restore attempts every root after a mid-restore failure", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-exclude-multirestore-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "src"), { recursive: true });
  await writeFile(path.join(source, "src", "value.ts"), "before\n");
  const paths = taskPaths(path.join(root, "state"), "exclude-multirestore");
  const taskSpec = spec(source);
  taskSpec.workspace.exclude = [".git", "node_modules", "target", "dist"];
  await prepareWorkspace(taskSpec, paths);

  await writeFile(path.join(paths.workspace, "src", "value.ts"), "after\n");
  const targetParent = path.join(paths.workspace, "apps", "shell", "src-tauri");
  await mkdir(path.join(targetParent, "target", "release"), { recursive: true });
  await writeFile(path.join(targetParent, "target", "release", "app.bin"), "TARGET_KEEP\n");
  await mkdir(path.join(paths.workspace, "dist"), { recursive: true });
  await writeFile(path.join(paths.workspace, "dist", "out.js"), "DIST_KEEP\n");

  const targetStash = excludedRootStashPath(
    paths.root,
    "workspace",
    "apps/shell/src-tauri/target",
  );

  try {
    await assert.rejects(
      () => writeWorkspacePatchReport(paths, createPathPolicy(taskSpec), {
        afterExcludedRootStash: async () => {
          // Block restore of the nested target only; dist must still return.
          await chmod(targetParent, 0o555);
        },
      }),
      /Failed to restore \d+ snapshot-excluded root/,
    );

    // Recoverable root was restored despite the other failure.
    assert.equal(
      await readFile(path.join(paths.workspace, "dist", "out.js"), "utf8"),
      "DIST_KEEP\n",
    );
    // Failed root remains preserved in its stash (content not deleted).
    assert.equal(
      await readFile(path.join(targetStash, "release", "app.bin"), "utf8"),
      "TARGET_KEEP\n",
    );
  } finally {
    await chmod(targetParent, 0o755).catch(() => undefined);
    // Best-effort cleanup of the stranded stash for the temp tree.
    await rm(targetStash, { recursive: true, force: true }).catch(() => undefined);
  }
});

// --- Workspace preparation progress (FL-D preparation observability) ---

test("prepareWorkspace without an observer remains source-compatible", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-prep-nop-"));
  const source = path.join(root, "source");
  await mkdir(source);
  await writeFile(path.join(source, "value.txt"), "before\n");
  const paths = taskPaths(path.join(root, "state"), "prep-nop");
  // Three-argument call: existing callers that omit the new options
  // parameter must still get the same manifest shape and the same
  // workspace layout.
  const manifest = await prepareWorkspace(spec(source), paths);
  assert.equal(manifest.files.length, 1);
  assert.equal(manifest.linkedDependencies.length, 0);
  assert.equal(
    (await readFile(path.join(paths.workspace, "value.txt"), "utf8")),
    "before\n",
  );
});

test("prepareWorkspace emits stage observations in stable order with monotonic elapsed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-prep-order-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "src"), { recursive: true });
  await writeFile(path.join(source, "value.txt"), "before\n");
  await writeFile(path.join(source, "src", "inner.ts"), "export const x = 1;\n");

  // Deterministic clock: elapsed is now() - startedAtMs using a virtual clock.
  let virtualNow = 1_000_000;
  const now = (): number => virtualNow;
  const observed: PreparationObservation[] = [];
  const observer = (observation: PreparationObservation): void => {
    // Advance the clock between observations so each stage records a
    // strictly greater elapsed value than the previous one.
    virtualNow += 5;
    observed.push(observation);
  };

  const paths = taskPaths(path.join(root, "state"), "prep-order");
  await prepareWorkspace(spec(source), paths, undefined, { now, observer });

  // Every expected stage must appear, and in the documented order, with
  // matching start/complete pairs.
  const expectedPairs: Array<["init" | "source-scan" | "baseline-copy" | "worker-copy" | "dependency-link" | "context-write" | "complete", "start" | "complete"]> = [
    ["init", "start"],
    ["source-scan", "start"],
    ["source-scan", "complete"],
    ["baseline-copy", "start"],
    ["baseline-copy", "complete"],
    ["worker-copy", "start"],
    ["worker-copy", "complete"],
    ["dependency-link", "start"],
    ["dependency-link", "complete"],
    ["context-write", "start"],
    ["context-write", "complete"],
    ["complete", "complete"],
  ];
  assert.deepEqual(
    observed.map(({ stage, phase }) => [stage, phase]),
    expectedPairs,
  );

  // Elapsed values are strictly monotonic and use the injected clock.
  let lastElapsed = -1;
  for (const observation of observed) {
    assert.ok(observation.elapsedMs > lastElapsed,
      `elapsed ${observation.elapsedMs} must exceed previous ${lastElapsed}`);
    lastElapsed = observation.elapsedMs;
  }

  // Counts are emitted only when actually known: source-scan complete
  // reports the file aggregate; baseline-copy/worker-copy start report
  // the same known input count; dependency-link complete reports the
  // link count; init/start and copy-complete and context-write pairs
  // never invent a count of zero.
  const sourceScanComplete = observed.find(
    (o) => o.stage === "source-scan" && o.phase === "complete",
  );
  assert.equal(sourceScanComplete?.count, 2);
  assert.equal(sourceScanComplete?.countKind, "files");
  const baselineCopyStart = observed.find(
    (o) => o.stage === "baseline-copy" && o.phase === "start",
  );
  assert.equal(baselineCopyStart?.count, 2);
  assert.equal(baselineCopyStart?.countKind, "files");
  const baselineCopyComplete = observed.find(
    (o) => o.stage === "baseline-copy" && o.phase === "complete",
  );
  assert.equal(baselineCopyComplete?.count, undefined);
  const workerCopyStart = observed.find(
    (o) => o.stage === "worker-copy" && o.phase === "start",
  );
  assert.equal(workerCopyStart?.count, 2);
  assert.equal(workerCopyStart?.countKind, "files");
  const dependencyLinkComplete = observed.find(
    (o) => o.stage === "dependency-link" && o.phase === "complete",
  );
  assert.equal(dependencyLinkComplete?.count, 0);
  assert.equal(dependencyLinkComplete?.countKind, "dependencies");
  const initStart = observed.find(
    (o) => o.stage === "init" && o.phase === "start",
  );
  assert.equal(initStart?.count, undefined);
  const contextWriteComplete = observed.find(
    (o) => o.stage === "context-write" && o.phase === "complete",
  );
  assert.equal(contextWriteComplete?.count, undefined);
});

test("prepareWorkspace observations never carry paths, file names, or raw errors", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-prep-priv-"));
  const source = path.join(root, "PROBE-source");
  await mkdir(path.join(source, "PROBE-private"), { recursive: true });
  await writeFile(path.join(source, "PROBE-private", "secret.txt"), "x");
  const paths = taskPaths(path.join(root, "PROBE-state"), "prep-priv");

  const observed: PreparationObservation[] = [];
  await prepareWorkspace(spec(source), paths, undefined, {
    observer: (observation) => {
      observed.push(observation);
    },
  });
  const serialized = JSON.stringify(observed);
  for (const privateNeedle of [
    "PROBE-source",
    "PROBE-private",
    "secret.txt",
    ".git",
    "node_modules",
    source,
    paths.workspace,
    paths.baseline,
  ]) {
    assert.ok(!serialized.includes(privateNeedle),
      `observation payload must not contain ${privateNeedle}, got: ${serialized}`);
  }
  // String fields stay in the closed stage/phase/count-kind vocabularies.
  for (const observation of observed) {
    assert.ok((PREPARATION_STAGES as readonly string[]).includes(observation.stage));
    assert.ok(observation.phase === "start" || observation.phase === "complete");
    assert.ok(observation.countKind === undefined
      || observation.countKind === "files"
      || observation.countKind === "dependencies");
    assert.equal(typeof observation.elapsedMs, "number");
  }
});

test("prepareWorkspace awaits an async observer and fails closed on observer error", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-prep-await-"));
  const source = path.join(root, "source");
  await mkdir(source);
  await writeFile(path.join(source, "value.txt"), "before\n");
  const paths = taskPaths(path.join(root, "state"), "prep-await");

  // Async observer: must be awaited before the next stage.  If delivery
  // were not awaited, the synchronous "got ..." records below would be
  // interleaved with the awaited promise — the test asserts the awaited
  // resolution marker appears before the next-stage record.
  const order: string[] = [];
  let pending: Promise<void> | undefined;
  const observer = (observation: PreparationObservation): Promise<void> => {
    if (observation.stage === "source-scan" && observation.phase === "start") {
      pending = new Promise<void>((resolve) => {
        setImmediate(() => {
          order.push("awaited:source-scan:start");
          resolve();
        });
      });
      return pending;
    }
    order.push(`got ${observation.stage}:${observation.phase}`);
    return Promise.resolve();
  };

  const manifest = await prepareWorkspace(spec(source), paths, undefined, { observer });
  // The awaited resolution must appear before the "source-scan:complete"
  // record — proof that prepareWorkspace awaited the async observer.
  const awaitedIndex = order.indexOf("awaited:source-scan:start");
  const sourceScanCompleteIndex = order.indexOf("got source-scan:complete");
  assert.ok(awaitedIndex >= 0, "awaited source-scan start marker must be present");
  assert.ok(sourceScanCompleteIndex >= 0, "source-scan complete record must be present");
  assert.ok(awaitedIndex < sourceScanCompleteIndex,
    `awaited marker must appear before next stage record, got order: ${order.join(", ")}`);
  for (const stage of ["init:start", "source-scan:complete", "complete:complete"] as const) {
    assert.ok(order.some((entry) => entry === `got ${stage}`), `expected ${stage} in order`);
  }
  assert.equal(manifest.files.length, 1);
  await pending;

  // Failing observer: error fails closed (propagates) so the runner
  // can mark the Task failed and skip the terminal workspace.prepared.
  const failRoot = await mkdtemp(path.join(tmpdir(), "forklight-prep-fail-"));
  const failSource = path.join(failRoot, "source");
  await mkdir(failSource);
  await writeFile(path.join(failSource, "value.txt"), "x");
  const failPaths = taskPaths(path.join(failRoot, "state"), "prep-fail");
  await assert.rejects(
    () => prepareWorkspace(spec(failSource), failPaths, undefined, {
      observer: (observation) => {
        if (observation.stage === "baseline-copy" && observation.phase === "complete") {
          throw new Error("PROBE observer failure");
        }
      },
    }),
    /PROBE observer failure/,
  );
  await assert.rejects(
    () => prepareWorkspace(spec(failSource), failPaths, undefined, {
      observer: async (observation) => {
        if (observation.stage === "baseline-copy" && observation.phase === "complete") {
          throw new Error("PROBE async observer failure");
        }
      },
    }),
    /PROBE async observer failure/,
  );
});

test("prepareWorkspace dependency-link count reflects actual materialized directories", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-prep-dep-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "node_modules", "example"), { recursive: true });
  await writeFile(path.join(source, "node_modules", "example", "index.js"), "export default true;\n");
  await writeFile(path.join(source, "value.txt"), "before\n");
  const paths = taskPaths(path.join(root, "state"), "prep-dep");

  const observed: PreparationObservation[] = [];
  await prepareWorkspace(spec(source), paths, undefined, {
    observer: (observation) => {
      observed.push(observation);
    },
  });
  const linkComplete = observed.find(
    (o) => o.stage === "dependency-link" && o.phase === "complete",
  );
  assert.equal(linkComplete?.count, 1);
  assert.equal(linkComplete?.countKind, "dependencies");
  // Workspace holds a local mirror; baseline remains dependency-free.
  const workspaceModules = await lstat(path.join(paths.workspace, "node_modules"));
  assert.equal(workspaceModules.isDirectory(), true);
  assert.equal(workspaceModules.isSymbolicLink(), false);
  await assert.rejects(
    () => lstat(path.join(paths.baseline, "node_modules")),
    /ENOENT/,
  );
});

test("workspace dependency mirror is local and source dependencies stay immutable", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-dep-immutable-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "node_modules", "example"), { recursive: true });
  const original = "export const version = 1;\n";
  await writeFile(path.join(source, "node_modules", "example", "index.js"), original);
  await writeFile(path.join(source, "value.txt"), "business\n");
  const paths = taskPaths(path.join(root, "state"), "dep-immutable");
  const taskSpec = spec(source);
  await prepareWorkspace(taskSpec, paths);

  const depFile = path.join(paths.workspace, "node_modules", "example", "index.js");
  await writeFile(depFile, "export const version = 999;\n");
  assert.equal(
    await readFile(path.join(source, "node_modules", "example", "index.js"), "utf8"),
    original,
    "editing the workspace mirror must not mutate source dependencies",
  );

  // Dependency edits never enter the Candidate business/integration diff.
  const report = await writeWorkspacePatchReport(paths, createPathPolicy(taskSpec));
  const diff = await readFile(paths.diff, "utf8");
  assert.doesNotMatch(diff, /node_modules/);
  assert.doesNotMatch(diff, /version = 999/);
  assert.equal(report.business.filesChanged, 0);
  assert.equal(report.integration.filesChanged, 0);
});

test("materialization preserves safe relative project-contained dependency links", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-dep-safe-link-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "node_modules", "pkg"), { recursive: true });
  await writeFile(path.join(source, "node_modules", "pkg", "index.js"), "export default 1;\n");
  // Classic .bin-style relative link that stays inside the dependency tree.
  await symlink(
    path.join("pkg", "index.js"),
    path.join(source, "node_modules", "alias.js"),
  );
  await writeFile(path.join(source, "value.txt"), "ok\n");
  const paths = taskPaths(path.join(root, "state"), "dep-safe-link");
  await prepareWorkspace(spec(source), paths);

  const linkPath = path.join(paths.workspace, "node_modules", "alias.js");
  const linkMeta = await lstat(linkPath);
  assert.equal(linkMeta.isSymbolicLink(), true);
  const linkText = await readlink(linkPath);
  assert.equal(path.isAbsolute(linkText), false);
  assert.equal(
    await readFile(linkPath, "utf8"),
    "export default 1;\n",
  );
  // Resolved target stays inside the isolated workspace project.
  const resolved = await realpath(linkPath);
  assert.ok(resolved.startsWith(await realpath(paths.workspace)));
});

test("materialization fails closed on dependency links that escape the project", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-dep-escape-"));
  const source = path.join(root, "source");
  const outside = path.join(root, "outside-secret");
  await mkdir(path.join(source, "node_modules"), { recursive: true });
  await writeFile(outside, "secret\n");
  await symlink(outside, path.join(source, "node_modules", "escape"));
  await writeFile(path.join(source, "value.txt"), "ok\n");
  const paths = taskPaths(path.join(root, "state"), "dep-escape");

  await assert.rejects(
    () => prepareWorkspace(spec(source), paths),
    /dependency materialization rejected: dependency link escapes the project/,
  );
  // Fail closed: no partial command-ready mirror left behind.
  await assert.rejects(
    () => lstat(path.join(paths.workspace, "node_modules")),
    /ENOENT/,
  );
});

test("copyForVerification materializes a local node_modules mirror", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-verify-copy-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "node_modules", "example"), { recursive: true });
  await writeFile(path.join(source, "node_modules", "example", "index.js"), "export default true;\n");
  await writeFile(path.join(source, "app.js"), "console.log(1);\n");

  const verifyEnv = await copyForVerification(source, []);
  try {
    assert.notEqual(verifyEnv.projectCwd, verifyEnv.cleanupRoot);
    assert.equal(path.dirname(verifyEnv.projectCwd), verifyEnv.cleanupRoot);
    const modules = await lstat(path.join(verifyEnv.projectCwd, "node_modules"));
    assert.equal(modules.isDirectory(), true);
    assert.equal(modules.isSymbolicLink(), false);
    assert.equal(
      await readFile(path.join(verifyEnv.projectCwd, "node_modules", "example", "index.js"), "utf8"),
      "export default true;\n",
    );
    const verifyReal = await realpath(path.join(verifyEnv.projectCwd, "node_modules"));
    const sourceReal = await realpath(path.join(source, "node_modules"));
    assert.notEqual(verifyReal, sourceReal);
  } finally {
    await rm(verifyEnv.cleanupRoot, { recursive: true, force: true });
  }
});

// --- Declared local package dependencies (file:/link: relative) ---

const ELSEWHERE_RELATIVE = "../adeptify/client-core/sdk";

async function writeElsewhereShapedFixture(root: string): Promise<{
  app: string;
  sdk: string;
  sdkIndex: string;
  originalSdkBytes: string;
}> {
  const app = path.join(root, "app");
  const sdk = path.join(root, "adeptify", "client-core", "sdk");
  await mkdir(app, { recursive: true });
  await mkdir(sdk, { recursive: true });
  const originalSdkBytes = "export const sdkVersion = 1;\n";
  await writeFile(path.join(sdk, "package.json"), JSON.stringify({ name: "@adeptify/client-core", version: "1.0.0" }));
  await writeFile(path.join(sdk, "index.js"), originalSdkBytes);
  await writeFile(
    path.join(app, "package.json"),
    `${JSON.stringify({
      name: "elsewhere-app",
      version: "1.0.0",
      dependencies: {
        "@adeptify/client-core": `file:${ELSEWHERE_RELATIVE}`,
      },
      // Duplicate declaration across maps must dedupe deterministically.
      devDependencies: {
        "@adeptify/client-core": `file:${ELSEWHERE_RELATIVE}`,
      },
    }, null, 2)}\n`,
  );
  await writeFile(path.join(app, "value.txt"), "business\n");
  return { app, sdk, sdkIndex: path.join(sdk, "index.js"), originalSdkBytes };
}

test("prepareWorkspace mirrors Elsewhere-shaped file: sibling SDK without Candidate pollution", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-local-pkg-prep-"));
  const { app, sdkIndex, originalSdkBytes } = await writeElsewhereShapedFixture(root);
  const paths = taskPaths(path.join(root, "state"), "local-pkg-prep");
  const taskSpec = spec(app);

  const manifest = await prepareWorkspace(taskSpec, paths);

  assert.ok(manifest.linkedDependencies.includes(ELSEWHERE_RELATIVE));
  const mirrored = path.join(paths.root, "adeptify", "client-core", "sdk");
  assert.equal((await lstat(mirrored)).isDirectory(), true);
  assert.equal(await readFile(path.join(mirrored, "index.js"), "utf8"), originalSdkBytes);
  // Relative resolution from workspace matches the declared relationship.
  const fromWorkspace = path.resolve(paths.workspace, ELSEWHERE_RELATIVE);
  assert.equal(await realpath(fromWorkspace), await realpath(mirrored));
  // Baseline itself must not contain the SDK mirror (sibling lives under Task root).
  await assert.rejects(() => lstat(path.join(paths.baseline, "adeptify")), /ENOENT/);
  // Mirror stays inside the Task isolation container, not under baseline/workspace.
  const containerReal = await realpath(paths.root);
  const mirroredReal = await realpath(mirrored);
  assert.ok(mirroredReal.startsWith(containerReal + path.sep) || mirroredReal === containerReal);
  assert.ok(!mirroredReal.startsWith((await realpath(paths.baseline)) + path.sep));
  assert.ok(!mirroredReal.startsWith((await realpath(paths.workspace)) + path.sep));

  // Mutate the mirror; original source SDK bytes stay unchanged.
  await writeFile(path.join(mirrored, "index.js"), "export const sdkVersion = 999;\n");
  assert.equal(await readFile(sdkIndex, "utf8"), originalSdkBytes);

  // Business Candidate edit only; mirror never enters the integration diff.
  await writeFile(path.join(paths.workspace, "value.txt"), "after\n");
  const report = await writeWorkspacePatchReport(paths, createPathPolicy(taskSpec));
  const diff = await readFile(paths.diff, "utf8");
  assert.doesNotMatch(diff, /adeptify/);
  assert.doesNotMatch(diff, /sdkVersion/);
  assert.doesNotMatch(diff, /client-core/);
  assert.deepEqual(report.business.affectedPaths, ["value.txt"]);
  assert.deepEqual(report.integration.affectedPaths, ["value.txt"]);
});

test("copyForVerification mirrors Elsewhere-shaped sibling SDK and owns full cleanup root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-local-pkg-verify-"));
  const { app, sdkIndex, originalSdkBytes } = await writeElsewhereShapedFixture(root);

  const verifyEnv = await copyForVerification(app, []);
  try {
    assert.equal(path.basename(verifyEnv.projectCwd), "project");
    assert.equal(path.dirname(verifyEnv.projectCwd), verifyEnv.cleanupRoot);
    const mirrored = path.join(verifyEnv.cleanupRoot, "adeptify", "client-core", "sdk");
    assert.equal((await lstat(mirrored)).isDirectory(), true);
    assert.equal(await readFile(path.join(mirrored, "index.js"), "utf8"), originalSdkBytes);
    const fromProject = path.resolve(verifyEnv.projectCwd, ELSEWHERE_RELATIVE);
    assert.equal(await realpath(fromProject), await realpath(mirrored));
    // Isolated copy is not the original source package.
    assert.notEqual(await realpath(mirrored), await realpath(path.dirname(sdkIndex)));

    await writeFile(path.join(mirrored, "index.js"), "export const sdkVersion = 42;\n");
    assert.equal(await readFile(sdkIndex, "utf8"), originalSdkBytes);
  } finally {
    await rm(verifyEnv.cleanupRoot, { recursive: true, force: true });
  }
  // Full container (project + sibling mirror) is gone after cleanup.
  await assert.rejects(() => lstat(verifyEnv.cleanupRoot), /ENOENT/);
  await assert.rejects(() => lstat(verifyEnv.projectCwd), /ENOENT/);
  assert.equal(await readFile(sdkIndex, "utf8"), originalSdkBytes);
});

test("declared local package: absolute, escape, missing, non-dir, no package.json, malformed, conflict fail closed", async () => {
  const {
    planDeclaredLocalPackages,
    materializeDeclaredLocalPackages,
  } = await import("../src/workspace/dependency-materializer.js");

  // Absolute target
  {
    const root = await mkdtemp(path.join(tmpdir(), "forklight-local-abs-"));
    const app = path.join(root, "app");
    const container = path.join(root, "container");
    await mkdir(app);
    await mkdir(path.join(container, "project"), { recursive: true });
    await writeFile(
      path.join(app, "package.json"),
      JSON.stringify({ dependencies: { x: "file:/tmp/secret-sdk" } }),
    );
    await assert.rejects(
      () => planDeclaredLocalPackages(app, path.join(container, "project"), container),
      /declared local dependency rejected: absolute file\/link target/,
    );
  }

  // Destination escapes isolation container
  {
    const root = await mkdtemp(path.join(tmpdir(), "forklight-local-esc-"));
    const app = path.join(root, "app");
    const sdk = path.join(root, "outside-sdk");
    const container = path.join(root, "container");
    await mkdir(app);
    await mkdir(sdk);
    await mkdir(path.join(container, "project"), { recursive: true });
    await writeFile(path.join(sdk, "package.json"), JSON.stringify({ name: "x" }));
    // Enough parent traversal from project/ to leave container.
    await writeFile(
      path.join(app, "package.json"),
      JSON.stringify({ dependencies: { x: "file:../../../outside-sdk" } }),
    );
    // Source may or may not resolve; destination escape is the gate.
    await assert.rejects(
      () => planDeclaredLocalPackages(app, path.join(container, "project"), container),
      /declared local dependency rejected: destination escapes isolation container/,
    );
  }

  // Missing target
  {
    const root = await mkdtemp(path.join(tmpdir(), "forklight-local-miss-"));
    const app = path.join(root, "app");
    const container = path.join(root, "container");
    await mkdir(app);
    await mkdir(path.join(container, "project"), { recursive: true });
    await writeFile(
      path.join(app, "package.json"),
      JSON.stringify({ dependencies: { x: "file:../missing-sdk" } }),
    );
    await assert.rejects(
      () => planDeclaredLocalPackages(app, path.join(container, "project"), container),
      /declared local dependency rejected: target is missing or unreadable/,
    );
  }

  // Non-directory target
  {
    const root = await mkdtemp(path.join(tmpdir(), "forklight-local-file-"));
    const app = path.join(root, "app");
    const container = path.join(root, "container");
    await mkdir(app);
    await mkdir(path.join(container, "project"), { recursive: true });
    await writeFile(path.join(root, "not-a-dir"), "file\n");
    await writeFile(
      path.join(app, "package.json"),
      JSON.stringify({ dependencies: { x: "file:../not-a-dir" } }),
    );
    await assert.rejects(
      () => planDeclaredLocalPackages(app, path.join(container, "project"), container),
      /declared local dependency rejected: target is not a directory/,
    );
  }

  // Missing target package.json
  {
    const root = await mkdtemp(path.join(tmpdir(), "forklight-local-nopkg-"));
    const app = path.join(root, "app");
    const sdk = path.join(root, "sdk");
    const container = path.join(root, "container");
    await mkdir(app);
    await mkdir(sdk);
    await mkdir(path.join(container, "project"), { recursive: true });
    await writeFile(path.join(sdk, "index.js"), "export default 1;\n");
    await writeFile(
      path.join(app, "package.json"),
      JSON.stringify({ dependencies: { x: "file:../sdk" } }),
    );
    await assert.rejects(
      () => planDeclaredLocalPackages(app, path.join(container, "project"), container),
      /declared local dependency rejected: target package\.json is missing/,
    );
  }

  // Malformed source package.json
  {
    const root = await mkdtemp(path.join(tmpdir(), "forklight-local-mal-"));
    const app = path.join(root, "app");
    const container = path.join(root, "container");
    await mkdir(app);
    await mkdir(path.join(container, "project"), { recursive: true });
    await writeFile(path.join(app, "package.json"), "{ not json");
    await assert.rejects(
      () => planDeclaredLocalPackages(app, path.join(container, "project"), container),
      /declared local dependency rejected: source package\.json is malformed/,
    );
  }

  // Same package name mapped to two different sources → conflict
  {
    const root = await mkdtemp(path.join(tmpdir(), "forklight-local-conflict-"));
    const app = path.join(root, "app");
    const sdkA = path.join(root, "sdk-a");
    const sdkB = path.join(root, "sdk-b");
    const container = path.join(root, "container");
    await mkdir(app);
    await mkdir(sdkA);
    await mkdir(sdkB);
    await mkdir(path.join(container, "project"), { recursive: true });
    await writeFile(path.join(sdkA, "package.json"), JSON.stringify({ name: "a" }));
    await writeFile(path.join(sdkB, "package.json"), JSON.stringify({ name: "b" }));
    await writeFile(
      path.join(app, "package.json"),
      JSON.stringify({
        dependencies: { shared: "file:../sdk-a" },
        devDependencies: { shared: "file:../sdk-b" },
      }),
    );
    await assert.rejects(
      () => planDeclaredLocalPackages(app, path.join(container, "project"), container),
      /declared local dependency rejected: conflicting destinations/,
    );
  }

  // Equivalent relative forms of the same source/destination dedupe
  {
    const root = await mkdtemp(path.join(tmpdir(), "forklight-local-dedupe-path-"));
    const app = path.join(root, "app");
    const realSdk = path.join(root, "real-sdk");
    const container = path.join(root, "container");
    await mkdir(app);
    await mkdir(realSdk);
    await mkdir(path.join(container, "project"), { recursive: true });
    await writeFile(path.join(realSdk, "package.json"), JSON.stringify({ name: "real" }));
    await writeFile(
      path.join(app, "package.json"),
      JSON.stringify({
        dependencies: {
          one: "file:../real-sdk",
          two: "file:.././real-sdk",
        },
      }),
    );
    const plans = await planDeclaredLocalPackages(
      app,
      path.join(container, "project"),
      container,
    );
    assert.equal(plans.length, 1);
    assert.equal(plans[0]!.packageName, "one");
  }

  // link: protocol is accepted and copied (not re-linked externally)
  {
    const root = await mkdtemp(path.join(tmpdir(), "forklight-local-link-"));
    const app = path.join(root, "app");
    const sdk = path.join(root, "sibling", "sdk");
    const container = path.join(root, "container");
    await mkdir(app);
    await mkdir(sdk, { recursive: true });
    await mkdir(path.join(container, "project"), { recursive: true });
    await writeFile(path.join(sdk, "package.json"), JSON.stringify({ name: "sibling-sdk" }));
    await writeFile(path.join(sdk, "index.js"), "export default 1;\n");
    await writeFile(
      path.join(app, "package.json"),
      JSON.stringify({ dependencies: { "sibling-sdk": "link:../sibling/sdk" } }),
    );
    // Copy project package.json into destination for realism
    await writeFile(
      path.join(container, "project", "package.json"),
      await readFile(path.join(app, "package.json"), "utf8"),
    );
    const materialized = await materializeDeclaredLocalPackages(
      app,
      path.join(container, "project"),
      container,
    );
    assert.equal(materialized.length, 1);
    assert.equal(materialized[0]!.protocol, "link");
    assert.equal(materialized[0]!.relativeTarget, "../sibling/sdk");
    const dest = path.join(container, "sibling", "sdk");
    assert.equal((await lstat(dest)).isDirectory(), true);
    assert.equal((await lstat(dest)).isSymbolicLink(), false);
    assert.equal(await readFile(path.join(dest, "index.js"), "utf8"), "export default 1;\n");
  }
});

test("declared local package: duplicate declarations are stable and deterministic", async () => {
  const { planDeclaredLocalPackages } = await import("../src/workspace/dependency-materializer.js");
  const root = await mkdtemp(path.join(tmpdir(), "forklight-local-dedupe-"));
  const app = path.join(root, "app");
  const sdk = path.join(root, "sibling", "sdk");
  const container = path.join(root, "container");
  await mkdir(app);
  await mkdir(sdk, { recursive: true });
  await mkdir(path.join(container, "project"), { recursive: true });
  await writeFile(path.join(sdk, "package.json"), JSON.stringify({ name: "sdk" }));
  await writeFile(
    path.join(app, "package.json"),
    JSON.stringify({
      dependencies: {
        zed: "file:../sibling/sdk",
        alpha: "file:../sibling/sdk",
      },
      devDependencies: {
        alpha: "file:../sibling/sdk",
      },
    }),
  );
  const plans = await planDeclaredLocalPackages(
    app,
    path.join(container, "project"),
    container,
  );
  assert.equal(plans.length, 1);
  // First stable encounter: dependencies map, alpha before zed alphabetically...
  // Discovery walks fields in order then sorts names within field, so alpha first.
  assert.equal(plans[0]!.packageName, "alpha");
  assert.equal(plans[0]!.relativeTarget, "../sibling/sdk");
});

// --- Declared local-package runtime-link rewrite (Flyleaf-shaped) ---

const FLYLEAF_SDK_RELATIVE = "../adeptify/adeptify-next/client-core/ts/sdk";

/**
 * Freeze the Flyleaf Task 5a37f666 failure shape without reading real sources:
 * root package.json declares a scoped file: sibling SDK, and node_modules holds
 * a package-manager symlink to that exact SDK path.
 */
async function writeFlyleafShapedRuntimeLinkFixture(root: string): Promise<{
  app: string;
  sdk: string;
  sdkIndex: string;
  originalSdkBytes: string;
  nmLink: string;
}> {
  const app = path.join(root, "app");
  const sdk = path.join(root, "adeptify", "adeptify-next", "client-core", "ts", "sdk");
  await mkdir(app, { recursive: true });
  await mkdir(sdk, { recursive: true });
  const originalSdkBytes = "export const flyleafSdk = 1;\n";
  await writeFile(
    path.join(sdk, "package.json"),
    JSON.stringify({ name: "@adeptify/client-core", version: "0.0.1" }),
  );
  await writeFile(path.join(sdk, "index.js"), originalSdkBytes);
  await writeFile(
    path.join(app, "package.json"),
    `${JSON.stringify({
      name: "flyleaf-shaped-app",
      version: "1.0.0",
      dependencies: {
        "@adeptify/client-core": `file:${FLYLEAF_SDK_RELATIVE}`,
      },
    }, null, 2)}\n`,
  );
  await writeFile(path.join(app, "value.txt"), "business\n");
  // Package-manager layout: scoped package symlink to the declared sibling.
  await mkdir(path.join(app, "node_modules", "@adeptify"), { recursive: true });
  const nmLink = path.join(app, "node_modules", "@adeptify", "client-core");
  await symlink(sdk, nmLink);
  return {
    app,
    sdk,
    sdkIndex: path.join(sdk, "index.js"),
    originalSdkBytes,
    nmLink,
  };
}

test("prepareWorkspace rewrites Flyleaf-shaped scoped node_modules link into the owned container", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-flyleaf-runtime-link-"));
  const { app, sdk, sdkIndex, originalSdkBytes } = await writeFlyleafShapedRuntimeLinkFixture(root);
  const paths = taskPaths(path.join(root, "state"), "flyleaf-runtime-link");
  const taskSpec = spec(app);

  const manifest = await prepareWorkspace(taskSpec, paths);

  assert.ok(manifest.linkedDependencies.includes("node_modules"));
  assert.ok(manifest.linkedDependencies.includes(FLYLEAF_SDK_RELATIVE));

  const mirroredSdk = path.join(
    paths.root,
    "adeptify",
    "adeptify-next",
    "client-core",
    "ts",
    "sdk",
  );
  assert.equal((await lstat(mirroredSdk)).isDirectory(), true);
  assert.equal(await readFile(path.join(mirroredSdk, "index.js"), "utf8"), originalSdkBytes);

  const workspaceLink = path.join(
    paths.workspace,
    "node_modules",
    "@adeptify",
    "client-core",
  );
  const linkMeta = await lstat(workspaceLink);
  assert.equal(linkMeta.isSymbolicLink(), true);
  const linkText = await readlink(workspaceLink);
  assert.equal(path.isAbsolute(linkText), false);
  const resolved = await realpath(workspaceLink);
  assert.equal(resolved, await realpath(mirroredSdk));
  // Must not resolve to the original sibling outside the isolation container.
  assert.notEqual(resolved, await realpath(sdk));
  const containerReal = await realpath(paths.root);
  assert.ok(resolved.startsWith(containerReal + path.sep) || resolved === containerReal);

  // Source package and original package-manager link stay immutable.
  assert.equal(await readFile(sdkIndex, "utf8"), originalSdkBytes);
  assert.equal(await realpath(path.join(app, "node_modules", "@adeptify", "client-core")), await realpath(sdk));

  // Business Candidate edit only; dependency mirrors never enter the patch.
  await writeFile(path.join(paths.workspace, "value.txt"), "after\n");
  await writeFile(path.join(mirroredSdk, "index.js"), "export const flyleafSdk = 999;\n");
  const report = await writeWorkspacePatchReport(paths, createPathPolicy(taskSpec));
  const diff = await readFile(paths.diff, "utf8");
  assert.doesNotMatch(diff, /node_modules/);
  assert.doesNotMatch(diff, /adeptify/);
  assert.doesNotMatch(diff, /flyleafSdk/);
  assert.doesNotMatch(diff, /client-core/);
  assert.deepEqual(report.business.affectedPaths, ["value.txt"]);
  assert.deepEqual(report.integration.affectedPaths, ["value.txt"]);
  assert.equal(await readFile(sdkIndex, "utf8"), originalSdkBytes);
});

test("copyForVerification rewrites Flyleaf-shaped scoped runtime link inside cleanup root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-flyleaf-verify-link-"));
  const { app, sdk, sdkIndex, originalSdkBytes } = await writeFlyleafShapedRuntimeLinkFixture(root);

  const verifyEnv = await copyForVerification(app, []);
  try {
    const mirroredSdk = path.join(
      verifyEnv.cleanupRoot,
      "adeptify",
      "adeptify-next",
      "client-core",
      "ts",
      "sdk",
    );
    const verifyLink = path.join(
      verifyEnv.projectCwd,
      "node_modules",
      "@adeptify",
      "client-core",
    );
    assert.equal((await lstat(verifyLink)).isSymbolicLink(), true);
    assert.equal(path.isAbsolute(await readlink(verifyLink)), false);
    assert.equal(await realpath(verifyLink), await realpath(mirroredSdk));
    assert.notEqual(await realpath(verifyLink), await realpath(sdk));
    assert.equal(await readFile(path.join(mirroredSdk, "index.js"), "utf8"), originalSdkBytes);
    assert.equal(await readFile(sdkIndex, "utf8"), originalSdkBytes);
  } finally {
    await rm(verifyEnv.cleanupRoot, { recursive: true, force: true });
  }
});

test("retained reverify rewrites declared scoped runtime link via ensureWorkspaceDependencyMirrors", async () => {
  const {
    ensureWorkspaceDependencyMirrors,
  } = await import("../src/workspace/dependency-materializer.js");
  const root = await mkdtemp(path.join(tmpdir(), "forklight-flyleaf-reverify-link-"));
  const { app, sdk } = await writeFlyleafShapedRuntimeLinkFixture(root);
  const container = path.join(root, "container");
  const workspace = path.join(container, "workspace");
  // Retained Candidate layout: dependency-free business copy already present.
  await mkdir(workspace, { recursive: true });
  await writeFile(
    path.join(workspace, "package.json"),
    await readFile(path.join(app, "package.json"), "utf8"),
  );
  await writeFile(path.join(workspace, "value.txt"), "business\n");

  const linked = await ensureWorkspaceDependencyMirrors(
    app,
    workspace,
    ["node_modules"],
    container,
  );
  assert.ok(linked.includes("node_modules"));
  assert.ok(linked.includes(FLYLEAF_SDK_RELATIVE));

  const mirroredSdk = path.join(
    container,
    "adeptify",
    "adeptify-next",
    "client-core",
    "ts",
    "sdk",
  );
  const workspaceLink = path.join(workspace, "node_modules", "@adeptify", "client-core");
  assert.equal((await lstat(workspaceLink)).isSymbolicLink(), true);
  assert.equal(path.isAbsolute(await readlink(workspaceLink)), false);
  assert.equal(await realpath(workspaceLink), await realpath(mirroredSdk));
  assert.notEqual(await realpath(workspaceLink), await realpath(sdk));
});

test("declared runtime link with wrong target fails closed and leaves no command-ready external link", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-runtime-wrong-target-"));
  const { app, sdk } = await writeFlyleafShapedRuntimeLinkFixture(root);
  const wrong = path.join(root, "wrong-sdk");
  await mkdir(wrong, { recursive: true });
  await writeFile(path.join(wrong, "package.json"), JSON.stringify({ name: "wrong" }));
  await writeFile(path.join(wrong, "index.js"), "export const wrong = true;\n");
  // Same declared package name, but node_modules points at a different directory.
  const nmLink = path.join(app, "node_modules", "@adeptify", "client-core");
  await rm(nmLink, { force: true });
  await symlink(wrong, nmLink);
  // Declared source remains the real sibling SDK.
  assert.equal(await realpath(path.resolve(app, FLYLEAF_SDK_RELATIVE)), await realpath(sdk));

  const paths = taskPaths(path.join(root, "state"), "wrong-target");
  await assert.rejects(
    () => prepareWorkspace(spec(app), paths),
    /dependency materialization rejected: dependency link escapes the project/,
  );
  await assert.rejects(
    () => lstat(path.join(paths.workspace, "node_modules")),
    /ENOENT/,
  );
});

test("undeclared escaping node_modules link still fails closed when a declared package exists", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-runtime-undeclared-escape-"));
  const { app } = await writeFlyleafShapedRuntimeLinkFixture(root);
  const outside = path.join(root, "outside-secret");
  await writeFile(outside, "secret\n");
  await symlink(outside, path.join(app, "node_modules", "escape-hatch"));

  const paths = taskPaths(path.join(root, "state"), "undeclared-escape");
  await assert.rejects(
    () => prepareWorkspace(spec(app), paths),
    /dependency materialization rejected: dependency link escapes the project/,
  );
  await assert.rejects(
    () => lstat(path.join(paths.workspace, "node_modules")),
    /ENOENT/,
  );
});

test("escape inside declared package fails closed and does not copy external content", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-local-pkg-internal-escape-"));
  const { app, sdk } = await writeFlyleafShapedRuntimeLinkFixture(root);
  const outside = path.join(root, "secret-outside");
  await writeFile(outside, "secret\n");
  await symlink(outside, path.join(sdk, "leaked"));

  const paths = taskPaths(path.join(root, "state"), "pkg-internal-escape");
  await assert.rejects(
    () => prepareWorkspace(spec(app), paths),
    /dependency materialization rejected: dependency link escapes the project/,
  );
  // Declared package mirror must not remain command-ready with an external leak.
  await assert.rejects(
    () => lstat(path.join(
      paths.root,
      "adeptify",
      "adeptify-next",
      "client-core",
      "ts",
      "sdk",
    )),
    /ENOENT/,
  );
});

test("packageNameToNodeModulesRelative maps scoped names and rejects traversal", async () => {
  const {
    packageNameToNodeModulesRelative,
    buildDeclaredRuntimeLinkAuthorizations,
  } = await import("../src/workspace/dependency-materializer.js");

  assert.equal(packageNameToNodeModulesRelative("@adeptify/client-core"), "@adeptify/client-core");
  assert.equal(packageNameToNodeModulesRelative("lodash"), "lodash");
  assert.equal(packageNameToNodeModulesRelative("../evil"), null);
  assert.equal(packageNameToNodeModulesRelative("@scope/../evil"), null);
  assert.equal(packageNameToNodeModulesRelative("@scope"), null);
  assert.equal(packageNameToNodeModulesRelative(""), null);
  assert.equal(packageNameToNodeModulesRelative("a/b/c"), null);

  // Target-only would be unsafe: authorization keys are package-relative paths.
  const auths = buildDeclaredRuntimeLinkAuthorizations([
    {
      packageName: "@adeptify/client-core",
      protocol: "file",
      relativeTarget: "../sdk",
      sourceAbsolute: "/tmp/source-sdk",
      destinationAbsolute: "/tmp/container/sdk",
    },
  ]);
  assert.equal(auths.has("@adeptify/client-core"), true);
  assert.equal(auths.has("client-core"), false);
  assert.equal(auths.get("@adeptify/client-core")?.sourceReal, "/tmp/source-sdk");
  assert.equal(auths.get("@adeptify/client-core")?.relativeTarget, "../sdk");
});

test("runtime-link rewrite resolves through an aliased destination project path", async () => {
  const {
    materializeDependencySet,
  } = await import("../src/workspace/dependency-materializer.js");
  const root = await mkdtemp(path.join(tmpdir(), "forklight-flyleaf-alias-dest-"));
  const { app, sdk } = await writeFlyleafShapedRuntimeLinkFixture(root);

  // Real isolation container, plus a sibling symlink alias into it. Callers may
  // hold the alias form while realpath yields a different string (macOS /var).
  const realContainer = path.join(root, "real-container");
  const aliasContainer = path.join(root, "alias-container");
  const realWorkspace = path.join(realContainer, "workspace");
  await mkdir(realWorkspace, { recursive: true });
  await writeFile(
    path.join(realWorkspace, "package.json"),
    await readFile(path.join(app, "package.json"), "utf8"),
  );
  await symlink(realContainer, aliasContainer);
  const aliasWorkspace = path.join(aliasContainer, "workspace");

  await materializeDependencySet(
    app,
    aliasWorkspace,
    aliasContainer,
    ["node_modules"],
  );

  const mirroredSdk = path.join(
    aliasContainer,
    "adeptify",
    "adeptify-next",
    "client-core",
    "ts",
    "sdk",
  );
  const workspaceLink = path.join(
    aliasWorkspace,
    "node_modules",
    "@adeptify",
    "client-core",
  );
  assert.equal((await lstat(workspaceLink)).isSymbolicLink(), true);
  const linkText = await readlink(workspaceLink);
  assert.equal(path.isAbsolute(linkText), false);
  // Must resolve even when the destination project path is an alias.
  assert.equal(await realpath(workspaceLink), await realpath(mirroredSdk));
  assert.notEqual(await realpath(workspaceLink), await realpath(sdk));
  // Alias and real container are the same isolation root.
  assert.equal(await realpath(aliasContainer), await realpath(realContainer));
});

async function preparedSnapshot(prefix: string): Promise<ReturnType<typeof taskPaths>> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const source = path.join(root, "source");
  await mkdir(source);
  await writeFile(path.join(source, "value.txt"), "source\n");
  const paths = taskPaths(path.join(root, "state"), "task");
  await prepareWorkspace(spec(source), paths);
  return paths;
}

test("workspace readiness requires real directories and the complete manifest shape", async () => {
  const paths = await preparedSnapshot("forklight-ready-shape-");
  assert.equal(await isWorkspaceReady(paths), true);

  await rm(paths.baseline, { recursive: true });
  await writeFile(paths.baseline, "not a directory");
  assert.equal(await isWorkspaceReady(paths), false);

  await rm(paths.baseline);
  await mkdir(paths.baseline);
  await writeFile(
    path.join(paths.root, "source-manifest.json"),
    JSON.stringify({ files: [], skippedSymlinks: [] }),
  );
  assert.equal(await isWorkspaceReady(paths), true);

  const malformed = [
    "not-json",
    JSON.stringify({ files: [] }),
    JSON.stringify({ files: [{ path: "x", bytes: -1, sha256: "bad" }], skippedSymlinks: [] }),
    JSON.stringify({ files: [], skippedSymlinks: "wrong" }),
  ];
  for (const manifest of malformed) {
    await writeFile(path.join(paths.root, "source-manifest.json"), manifest);
    assert.equal(await isWorkspaceReady(paths), false);
  }
});

test("preparation cleanup removes only snapshot outputs and is idempotent", async () => {
  const paths = await preparedSnapshot("forklight-ready-clean-");
  await mkdir(paths.logs, { recursive: true });
  await mkdir(paths.claudeConfig, { recursive: true });
  const log = path.join(paths.logs, "attempt.jsonl");
  const credential = path.join(paths.claudeConfig, "credential-marker");
  const integration = path.join(paths.root, "integration", "operation", "backup.txt");
  await writeFile(log, "log\n");
  await writeFile(credential, "credential\n");
  await mkdir(path.dirname(integration), { recursive: true });
  await writeFile(integration, "backup\n");

  await clearTaskPreparationArtifacts(paths);
  await clearTaskPreparationArtifacts(paths);

  await assert.rejects(lstat(paths.baseline));
  await assert.rejects(lstat(paths.workspace));
  await assert.rejects(lstat(path.join(paths.root, "source-manifest.json")));
  assert.equal(await readFile(log, "utf8"), "log\n");
  assert.equal(await readFile(credential, "utf8"), "credential\n");
  assert.equal(await readFile(integration, "utf8"), "backup\n");
});

test("preparation cleanup propagates unexpected filesystem errors", async () => {
  if (process.platform === "win32") return;
  const paths = await preparedSnapshot("forklight-ready-clean-error-");
  await chmod(paths.baseline, 0o000);
  try {
    await assert.rejects(
      clearTaskPreparationArtifacts(paths),
      (error: unknown) => {
        const code = (error as NodeJS.ErrnoException).code;
        return code === "EACCES" || code === "EPERM";
      },
    );
  } finally {
    await chmod(paths.baseline, 0o755);
  }
  assert.equal(await isWorkspaceReady(paths), true);
});

// --- PathPolicy explanation (category + bounded provenance) ---

test("PathPolicy.explain returns category plus one bounded provenance for every rule", async () => {
  const { createPathPolicy, PATH_CATEGORIES, PATH_PROVENANCES } = await import(
    "../src/workspace/path-policy.js"
  );
  const taskSpec = spec("/tmp/project");
  // dist and coverage are excluded from the snapshot but NOT declared in
  // generatedPaths, so exclusion alone classifies them as generated evidence.
  taskSpec.workspace.exclude = [".git", "node_modules", "dist", "coverage"];
  taskSpec.workspace.generatedPaths = ["**/.custom-cache/**"];
  const policy = createPathPolicy(taskSpec);

  // Internal ForkLight path
  assert.deepEqual(policy.explain(".forklight"), {
    category: "internal", provenance: "internal-forklight",
  });
  assert.deepEqual(policy.explain(".forklight/workspace-context.md"), {
    category: "internal", provenance: "internal-forklight",
  });

  // Configured snapshot exclusion -> generated
  assert.deepEqual(policy.explain("dist/bundle.js"), {
    category: "generated", provenance: "snapshot-exclusion",
  });
  assert.deepEqual(policy.explain("apps/web/coverage/report.json"), {
    category: "generated", provenance: "snapshot-exclusion",
  });

  // Built-in generated pattern -> generated
  assert.deepEqual(policy.explain("pkg/__pycache__/a.pyc"), {
    category: "generated", provenance: "builtin-generated-pattern",
  });
  assert.deepEqual(policy.explain("pkg/.pytest_cache/v/cache"), {
    category: "generated", provenance: "builtin-generated-pattern",
  });

  // Task-declared generated pattern -> generated
  assert.deepEqual(policy.explain("pkg/.custom-cache/value.bin"), {
    category: "generated", provenance: "task-generated-pattern",
  });

  // Default business inclusion - a name containing "generated" is NOT inferred
  assert.deepEqual(policy.explain("src/generated/client.ts"), {
    category: "business", provenance: "default-business",
  });
  assert.deepEqual(policy.explain("src/value.ts"), {
    category: "business", provenance: "default-business",
  });

  // Closed vocabularies - no name heuristic can introduce a new value.
  assert.deepEqual([...PATH_CATEGORIES].sort(), ["business", "generated", "internal"]);
  assert.deepEqual([...PATH_PROVENANCES].sort(), [
    "builtin-generated-pattern",
    "default-business",
    "internal-forklight",
    "snapshot-exclusion",
    "task-generated-pattern",
  ]);
});

test("PathPolicy.classify delegates to explain so category behavior cannot drift", async () => {
  const { createPathPolicy } = await import("../src/workspace/path-policy.js");
  const taskSpec = spec("/tmp/project");
  taskSpec.workspace.exclude = ["dist"];
  taskSpec.workspace.generatedPaths = ["**/.custom-cache/**"];
  const policy = createPathPolicy(taskSpec);
  const paths = [
    ".forklight/x",
    "dist/a.js",
    "pkg/__pycache__/a.pyc",
    "pkg/.custom-cache/v.bin",
    "src/generated/c.ts",
    "src/a.ts",
  ];
  for (const p of paths) {
    assert.equal(
      policy.classify(p),
      policy.explain(p).category,
      `classify must match explain category for ${p}`,
    );
  }
  // A path matching both a built-in and a Task-declared pattern is attributed
  // to the built-in pattern, preserving the historical combined-pattern order.
  const both = createPathPolicy({
    ...spec("/tmp/project"),
    workspace: {
      exclude: [],
      generatedPaths: ["**/__pycache__/**"],
    },
  } as TaskSpec);
  assert.deepEqual(both.explain("pkg/__pycache__/a.pyc"), {
    category: "generated",
    provenance: "builtin-generated-pattern",
  });
});
