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

test("recreated excluded dist tree stays out of business and integration evidence", async () => {
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

  const { workspacePatchPaths } = await import("../src/workspace/path-policy.js");
  const { writeWorkspacePatchReport } = await import("../src/workspace/patch.js");
  const report = await writeWorkspacePatchReport(paths, createPathPolicy(taskSpec));
  const artifacts = workspacePatchPaths(paths);

  // Raw evidence retains both the source change and the full dist tree.
  const raw = await readFile(artifacts.rawDiff, "utf8");
  assert.match(raw, /src\/value\.ts/);
  assert.match(raw, /dist\/bundle-0\.js/);
  assert.match(raw, /dist\/bundle-199\.js/);
  assert.match(raw, /dist\/nested\/report\.json/);
  assert.ok(raw.length > 1_000);

  // Generated evidence retains dist but never the source change.
  const generated = await readFile(artifacts.generatedDiff, "utf8");
  assert.match(generated, /dist\/bundle-0\.js/);
  assert.match(generated, /dist\/bundle-199\.js/);
  assert.match(generated, /dist\/nested\/report\.json/);
  assert.doesNotMatch(generated, /src\/value\.ts/);

  // Integration evidence keeps only the source change.
  const integration = await readFile(artifacts.integrationDiff, "utf8");
  assert.match(integration, /src\/value\.ts/);
  assert.match(integration, /-before/);
  assert.match(integration, /\+after/);
  assert.doesNotMatch(integration, /dist\//);

  // Metrics: business/integration count only the source file; generated
  // absorbs the recreated dist tree so it cannot inflate Integration.
  assert.deepEqual(report.business.affectedPaths, ["src/value.ts"]);
  assert.deepEqual(report.integration.affectedPaths, ["src/value.ts"]);
  assert.equal(report.business.filesChanged, 1);
  assert.equal(report.business.changedLines, 2);
  assert.equal(report.generated.filesChanged, 201);
  assert.equal(report.generated.changedLines, 201);
  assert.ok(report.generated.affectedPaths.every((p) => p.startsWith("dist/")));
  assert.equal(report.generated.affectedPaths.length, 201);
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
