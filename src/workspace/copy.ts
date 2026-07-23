import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { lstatSync } from "node:fs";
import path from "node:path";
import type { TaskPaths, TaskSpec } from "../core/types.js";

interface ManifestEntry {
  path: string;
  bytes: number;
  sha256: string;
}

interface Manifest {
  files: ManifestEntry[];
  skippedSymlinks: string[];
}

interface WorkspaceManifest extends Manifest {
  linkedDependencies: string[];
}

const SHARED_DEPENDENCY_DIRECTORIES = ["node_modules"];
const WORKSPACE_CONTEXT_PATH = path.join(".forklight", "workspace-context.md");
const WORKSPACE_CONTEXT_MAX_FILES = 200;

function excluded(relativePath: string, excludes: Set<string>): boolean {
  if (!relativePath || relativePath === ".") return false;
  return relativePath.split(path.sep).some((part) => excludes.has(part));
}

export async function buildManifest(root: string, excludes: Set<string>): Promise<Manifest> {
  const files: ManifestEntry[] = [];
  const skippedSymlinks: string[] = [];

  async function visit(relativeDirectory: string): Promise<void> {
    const absoluteDirectory = path.join(root, relativeDirectory);
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = path.join(relativeDirectory, entry.name);
      if (excluded(relative, excludes)) continue;
      if (entry.isSymbolicLink()) {
        skippedSymlinks.push(relative);
      } else if (entry.isDirectory()) {
        await visit(relative);
      } else if (entry.isFile()) {
        const content = await readFile(path.join(root, relative));
        files.push({
          path: relative,
          bytes: content.byteLength,
          sha256: createHash("sha256").update(content).digest("hex"),
        });
      }
    }
  }

  await visit("");
  return { files, skippedSymlinks };
}

async function linkSharedDependencies(
  spec: TaskSpec,
  paths: TaskPaths,
  excludes: Set<string>,
): Promise<string[]> {
  const linked: string[] = [];
  for (const name of SHARED_DEPENDENCY_DIRECTORIES) {
    if (!excludes.has(name)) continue;
    const source = path.join(spec.project, name);
    let dependencySource = source;
    try {
      const metadata = await lstat(source);
      if (metadata.isSymbolicLink()) dependencySource = await realpath(source);
      const resolvedMetadata = await lstat(dependencySource);
      if (!resolvedMetadata.isDirectory()) continue;
    } catch {
      continue;
    }
    for (const root of [paths.baseline, paths.workspace]) {
      const target = path.join(root, name);
      try {
        await lstat(target);
      } catch {
        await symlink(dependencySource, target, "dir");
      }
    }
    linked.push(name);
  }
  return linked;
}

async function writeWorkspaceContext(
  spec: TaskSpec,
  paths: TaskPaths,
  sourceManifest: Manifest,
  linkedDependencies: string[],
): Promise<void> {
  const normalizedFocusPaths = spec.worker.focusPaths.map((focusPath) =>
    focusPath.split(path.sep).join("/").replace(/\/+$/, "")
  );
  const isFocused = (filePath: string): boolean => normalizedFocusPaths.some(
    (focusPath) => filePath === focusPath || filePath.startsWith(`${focusPath}/`),
  );
  const files = sourceManifest.files.map((file) => file.path.split(path.sep).join("/"));
  const focused = files.filter(isFocused);
  const rootFiles = files.filter((filePath) => !filePath.includes("/") && !isFocused(filePath));
  const remaining = files.filter(
    (filePath) => !isFocused(filePath) && filePath.includes("/"),
  );
  const shownFiles = [...focused, ...rootFiles, ...remaining].slice(0, WORKSPACE_CONTEXT_MAX_FILES);
  const topLevelCounts = new Map<string, number>();
  for (const filePath of files) {
    const topLevel = filePath.includes("/") ? filePath.split("/", 1)[0]! : "[root]";
    topLevelCounts.set(topLevel, (topLevelCounts.get(topLevel) ?? 0) + 1);
  }
  const content = [
    "# ForkLight Workspace Context",
    "",
    "This index is generated from the isolated snapshot. Use it instead of guessing directory contents.",
    "Use Read for files, Grep for symbols, Glob for further discovery, Write for new files, and Edit for existing files.",
    "Shell and web tools are intentionally unavailable.",
    "",
    `## Visible files: ${files.length}`,
    `Showing at most ${WORKSPACE_CONTEXT_MAX_FILES} paths. Declared focus paths are prioritized.`,
    ...(shownFiles.length < files.length
      ? [`${files.length - shownFiles.length} additional visible path(s) are omitted from this index.`]
      : []),
    "",
    "## Top-level counts",
    ...[...topLevelCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, count]) => `- ${name}: ${count}`),
    "",
    "## Declared focus paths",
    ...(normalizedFocusPaths.length > 0
      ? normalizedFocusPaths.map((focusPath) =>
          `- ${focusPath} (${focused.filter(
            (filePath) => filePath === focusPath || filePath.startsWith(`${focusPath}/`),
          ).length} matching file(s))`
        )
      : ["- None"]),
    "",
    "## Prioritized file index",
    ...shownFiles.map((filePath) => `- ${filePath}`),
    "",
    "## Verifier-only dependency links",
    ...(linkedDependencies.length > 0
      ? linkedDependencies.map((dependency) => `- ${dependency}`)
      : ["- None"]),
    "",
  ].join("\n");
  for (const root of [paths.baseline, paths.workspace]) {
    const contextPath = path.join(root, WORKSPACE_CONTEXT_PATH);
    await mkdir(path.dirname(contextPath), { recursive: true, mode: 0o700 });
    await writeFile(contextPath, content, { mode: 0o600 });
  }
}

export async function prepareWorkspace(
  spec: TaskSpec,
  paths: TaskPaths,
  sourceDir?: string,
): Promise<WorkspaceManifest> {
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  await mkdir(paths.logs, { recursive: true, mode: 0o700 });
  await mkdir(paths.claudeConfig, { recursive: true, mode: 0o700 });
  const copySource = sourceDir ?? spec.project;
  const excludes = new Set(spec.workspace.exclude);
  const sourceManifest = await buildManifest(copySource, excludes);
  const filter = (source: string): boolean => {
    const relative = path.relative(copySource, source);
    if (excluded(relative, excludes)) return false;
    return !lstatSync(source).isSymbolicLink();
  };

  await cp(copySource, paths.baseline, {
    recursive: true,
    preserveTimestamps: true,
    filter,
  });
  await cp(copySource, paths.workspace, {
    recursive: true,
    preserveTimestamps: true,
    filter,
  });
  const linkedDependencies = await linkSharedDependencies(spec, paths, excludes);
  await writeWorkspaceContext(spec, paths, sourceManifest, linkedDependencies);
  await writeFile(
    path.join(paths.root, "source-manifest.json"),
    `${JSON.stringify(sourceManifest, null, 2)}\n`,
    { mode: 0o600 },
  );
  return { ...sourceManifest, linkedDependencies };
}

export interface SourceCompatibilityAssessment {
  globalUnchanged: boolean;
  compatible: boolean;
  affectedPaths: string[];
  conflictingPaths: string[];
  unrelatedDriftPaths: string[];
}

/**
 * Hard gate for concurrent source edits: only paths in the Worker patch
 * (baseline→workspace) must still match the prepare-time source snapshot.
 * Unrelated project drift is reported but does not fail compatibility.
 */
export async function assessSourceCompatibility(
  spec: TaskSpec,
  paths: TaskPaths,
  affectedPaths: readonly string[],
): Promise<SourceCompatibilityAssessment> {
  const beforeText = await readFile(path.join(paths.root, "source-manifest.json"), "utf8");
  const before = JSON.parse(beforeText) as Manifest;
  const after = await buildManifest(spec.project, new Set(spec.workspace.exclude));
  const beforeMap = new Map(before.files.map((file) => [file.path, file.sha256]));
  const afterMap = new Map(after.files.map((file) => [file.path, file.sha256]));

  const allPaths = new Set<string>([...beforeMap.keys(), ...afterMap.keys()]);
  const drifted: string[] = [];
  for (const filePath of allPaths) {
    if (beforeMap.get(filePath) !== afterMap.get(filePath)) drifted.push(filePath);
  }
  drifted.sort();

  const affected = [...new Set(affectedPaths)].sort();
  const affectedSet = new Set(affected);
  const conflictingPaths = affected.filter(
    (filePath) => beforeMap.get(filePath) !== afterMap.get(filePath),
  );
  const unrelatedDriftPaths = drifted.filter((filePath) => !affectedSet.has(filePath));

  return {
    globalUnchanged: drifted.length === 0,
    compatible: conflictingPaths.length === 0,
    affectedPaths: affected,
    conflictingPaths,
    unrelatedDriftPaths,
  };
}

export async function assertWorkspaceExists(paths: TaskPaths): Promise<void> {
  const metadata = await lstat(paths.workspace);
  if (!metadata.isDirectory()) throw new Error(`Worker workspace is not a directory: ${paths.workspace}`);
}
