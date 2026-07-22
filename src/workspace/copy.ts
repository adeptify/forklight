import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
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

function excluded(relativePath: string, excludes: Set<string>): boolean {
  if (!relativePath || relativePath === ".") return false;
  return relativePath.split(path.sep).some((part) => excludes.has(part));
}

async function buildManifest(root: string, excludes: Set<string>): Promise<Manifest> {
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

export async function prepareWorkspace(spec: TaskSpec, paths: TaskPaths): Promise<Manifest> {
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  await mkdir(paths.logs, { recursive: true, mode: 0o700 });
  await mkdir(paths.claudeConfig, { recursive: true, mode: 0o700 });
  const excludes = new Set(spec.workspace.exclude);
  const sourceManifest = await buildManifest(spec.project, excludes);
  const filter = (source: string): boolean => {
    const relative = path.relative(spec.project, source);
    if (excluded(relative, excludes)) return false;
    return !lstatSync(source).isSymbolicLink();
  };

  await cp(spec.project, paths.baseline, {
    recursive: true,
    preserveTimestamps: true,
    filter,
  });
  await cp(spec.project, paths.workspace, {
    recursive: true,
    preserveTimestamps: true,
    filter,
  });
  await writeFile(
    path.join(paths.root, "source-manifest.json"),
    `${JSON.stringify(sourceManifest, null, 2)}\n`,
    { mode: 0o600 },
  );
  return sourceManifest;
}

export async function sourceIsUnchanged(spec: TaskSpec, paths: TaskPaths): Promise<boolean> {
  const beforeText = await readFile(path.join(paths.root, "source-manifest.json"), "utf8");
  const before = JSON.parse(beforeText) as Manifest;
  const after = await buildManifest(spec.project, new Set(spec.workspace.exclude));
  return JSON.stringify(before) === JSON.stringify(after);
}

export async function writeWorkspaceDiff(paths: TaskPaths): Promise<string> {
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
