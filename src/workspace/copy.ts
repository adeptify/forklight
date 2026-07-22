import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { lstatSync } from "node:fs";
import path from "node:path";
import type { TaskPaths, TaskSpec } from "../core/types.js";
import { runCaptured } from "../core/process.js";

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
  paths: TaskPaths,
  sourceManifest: Manifest,
  linkedDependencies: string[],
): Promise<void> {
  const content = [
    "# ForkLight Workspace Context",
    "",
    "This index is generated from the isolated snapshot. Use it instead of guessing directory contents.",
    "Use Read for files, Grep for symbols, Glob for further discovery, Write for new files, and Edit for existing files.",
    "Shell and web tools are intentionally unavailable.",
    "",
    "## Visible files",
    ...sourceManifest.files.map((file) => `- ${file.path}`),
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
  await writeWorkspaceContext(paths, sourceManifest, linkedDependencies);
  await writeFile(
    path.join(paths.root, "source-manifest.json"),
    `${JSON.stringify(sourceManifest, null, 2)}\n`,
    { mode: 0o600 },
  );
  return { ...sourceManifest, linkedDependencies };
}

export async function sourceIsUnchanged(spec: TaskSpec, paths: TaskPaths): Promise<boolean> {
  const beforeText = await readFile(path.join(paths.root, "source-manifest.json"), "utf8");
  const before = JSON.parse(beforeText) as Manifest;
  const after = await buildManifest(spec.project, new Set(spec.workspace.exclude));
  return JSON.stringify(before) === JSON.stringify(after);
}

async function removeGeneratedExcludes(paths: TaskPaths, excludes: string[]): Promise<void> {
  for (const excludedName of excludes) {
    if (!excludedName || excludedName.includes(path.sep)) continue;
    for (const root of [paths.baseline, paths.workspace]) {
      const target = path.join(root, excludedName);
      try {
        const metadata = await lstat(target);
        if (!metadata.isSymbolicLink()) await rm(target, { recursive: true, force: true });
      } catch {
        // The excluded path was never created.
      }
    }
  }
}

export async function writeWorkspaceDiff(paths: TaskPaths, excludes: string[] = []): Promise<string> {
  await removeGeneratedExcludes(paths, excludes);
  const result = await runCaptured(
    "git",
    ["diff", "--no-index", "--no-ext-diff", "--binary", "--", "baseline", "workspace"],
    { cwd: paths.root },
  );
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(`Unable to generate workspace diff: ${result.stderr.trim()}`);
  }
  const diff = result.stdout;
  await writeFile(paths.diff, diff, { mode: 0o600 });
  return diff;
}

export async function assertWorkspaceExists(paths: TaskPaths): Promise<void> {
  const metadata = await lstat(paths.workspace);
  if (!metadata.isDirectory()) throw new Error(`Worker workspace is not a directory: ${paths.workspace}`);
}
