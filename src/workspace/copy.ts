import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { lstatSync } from "node:fs";
import path from "node:path";
import type { TaskPaths, TaskSpec } from "../core/types.js";
import {
  materializeDependencySet,
  RUNTIME_DEPENDENCY_DIRECTORIES,
} from "./dependency-materializer.js";
import { matchesExcludedSegment } from "./path-policy.js";

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

const WORKSPACE_CONTEXT_PATH = path.join(".forklight", "workspace-context.md");
const WORKSPACE_CONTEXT_MAX_FILES = 200;

// --- Workspace preparation progress ---
//
// A small stable vocabulary of operation boundaries, monotonically elapsed
// from preparation start.  Stages never include source/workspace paths,
// file names, excluded names, or credential locations in their payloads —
// only the stage code, phase, elapsed milliseconds, and (when actually
// known) a single aggregate count.

export const PREPARATION_STAGES = [
  "init",
  "source-scan",
  "baseline-copy",
  "worker-copy",
  "dependency-link",
  "context-write",
  "complete",
] as const;

export type PreparationStage = typeof PREPARATION_STAGES[number];

export type PreparationPhase = "start" | "complete";

export interface PreparationObservation {
  /** Stable operation-boundary code from PREPARATION_STAGES. */
  stage: PreparationStage;
  /** Boundary the observation belongs to: start of a stage or completion. */
  phase: PreparationPhase;
  /** Monotonic milliseconds since preparation start. Never negative. */
  elapsedMs: number;
  /** What the aggregate count represents. Kept explicit so a UI never has
   *  to guess whether "306" means files, dependencies, or something else. */
  countKind?: "files" | "dependencies";
  /** Aggregate count known at this boundary. Omitted when unknown. */
  count?: number;
}

export type PreparationObserver = (
  observation: PreparationObservation,
) => void | Promise<void>;

interface PreparationOptions {
  /** Optional progress observer. Contract: delivery is awaited, and an
   *  observer error fails closed — prepareWorkspace re-throws so the
   *  caller can mark the Task failed and skip the final workspace.prepared
   *  event.  Observers may be sync or async; when the returned value is a
   *  Promise, prepareWorkspace awaits it before continuing.  Callers that
   *  omit this option see source-compatible behaviour with no progress
   *  evidence emitted. */
  observer?: PreparationObserver;
  /** Injected monotonic clock used only for the elapsedMs field of each
   *  observation.  Defaults to Date.now.  Event wall-clock timestamps are
   *  owned by the Store and remain wall-clock-authoritative. */
  now?: () => number;
}

function excluded(relativePath: string, excludes: Set<string>): boolean {
  // Delegates to the single shared named-segment rule so snapshot copying
  // and Patch classification share one product meaning.  See path-policy.ts.
  return matchesExcludedSegment(relativePath, excludes);
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

/**
 * Materialize excluded runtime dependencies and root-manifest declared relative
 * file:/link: package roots into the Worker/verifier isolation container only.
 * The immutable diff baseline stays dependency-free so Candidate patches never
 * observe node_modules or sibling package mirrors. Dependencies always come
 * from the real project (spec.project), not from an optional snapshot copySource.
 *
 * Uses the canonical dependency-set rule: declared local packages first, then
 * runtime trees with exact declared-package link rewrite. Runtime dirs land
 * under the workspace project. Declared local packages land at the equivalent
 * relative path from the workspace inside the Task root (paths.root), so
 * `file:../sibling/sdk` resolves for workspace commands.
 */
async function materializeSharedDependencies(
  spec: TaskSpec,
  workspaceRoot: string,
  isolationContainer: string,
  excludes: Set<string>,
): Promise<string[]> {
  const names = RUNTIME_DEPENDENCY_DIRECTORIES.filter((name) => excludes.has(name));
  const result = await materializeDependencySet(
    spec.project,
    workspaceRoot,
    isolationContainer,
    names,
  );
  return result.linked;
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
    "## Verifier-only dependency mirrors",
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

/** Emit one PreparationObservation to the optional observer, await its
 *  return value, and propagate any thrown error or rejection unchanged.
 *  When no observer is supplied this is a no-op so source-compatible
 *  callers pay no cost. */
async function emitStage(
  observer: PreparationObserver | undefined,
  now: () => number,
  startedAtMs: number,
  stage: PreparationStage,
  phase: PreparationPhase,
  count?: number,
  countKind?: PreparationObservation["countKind"],
): Promise<void> {
  if (observer === undefined) return;
  const observation: PreparationObservation = {
    stage,
    phase,
    elapsedMs: Math.max(0, now() - startedAtMs),
    ...(count === undefined ? {} : { count }),
    ...(countKind === undefined ? {} : { countKind }),
  };
  // `await` handles synchronous observers, native Promises, and thenables.
  await observer(observation);
}

export async function prepareWorkspace(
  spec: TaskSpec,
  paths: TaskPaths,
  sourceDir?: string,
  options?: PreparationOptions,
): Promise<WorkspaceManifest> {
  const observer = options?.observer;
  const now = options?.now ?? Date.now;
  const startedAtMs = now();

  await emitStage(observer, now, startedAtMs, "init", "start");
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  await mkdir(paths.logs, { recursive: true, mode: 0o700 });
  await mkdir(paths.claudeConfig, { recursive: true, mode: 0o700 });
  const copySource = sourceDir ?? spec.project;
  const excludes = new Set(spec.workspace.exclude);

  await emitStage(observer, now, startedAtMs, "source-scan", "start");
  const sourceManifest = await buildManifest(copySource, excludes);
  await emitStage(
    observer,
    now,
    startedAtMs,
    "source-scan",
    "complete",
    sourceManifest.files.length,
    "files",
  );

  const filter = (source: string): boolean => {
    const relative = path.relative(copySource, source);
    if (excluded(relative, excludes)) return false;
    return !lstatSync(source).isSymbolicLink();
  };

  await emitStage(
    observer,
    now,
    startedAtMs,
    "baseline-copy",
    "start",
    sourceManifest.files.length,
    "files",
  );
  await cp(copySource, paths.baseline, {
    recursive: true,
    preserveTimestamps: true,
    filter,
  });
  await emitStage(observer, now, startedAtMs, "baseline-copy", "complete");

  await emitStage(
    observer,
    now,
    startedAtMs,
    "worker-copy",
    "start",
    sourceManifest.files.length,
    "files",
  );
  await cp(copySource, paths.workspace, {
    recursive: true,
    preserveTimestamps: true,
    filter,
  });
  await emitStage(observer, now, startedAtMs, "worker-copy", "complete");

  // Stage code stays "dependency-link" for durable progress/event compatibility;
  // the implementation materializes workspace-local mirrors (runtime dirs and
  // declared local packages) rather than external symlinks.
  await emitStage(observer, now, startedAtMs, "dependency-link", "start");
  const linkedDependencies = await materializeSharedDependencies(
    spec,
    paths.workspace,
    paths.root,
    excludes,
  );
  await emitStage(
    observer,
    now,
    startedAtMs,
    "dependency-link",
    "complete",
    linkedDependencies.length,
    "dependencies",
  );

  await emitStage(observer, now, startedAtMs, "context-write", "start");
  await writeWorkspaceContext(spec, paths, sourceManifest, linkedDependencies);
  await writeFile(
    path.join(paths.root, "source-manifest.json"),
    `${JSON.stringify(sourceManifest, null, 2)}\n`,
    { mode: 0o600 },
  );
  await emitStage(observer, now, startedAtMs, "context-write", "complete");
  await emitStage(observer, now, startedAtMs, "complete", "complete");
  return { ...sourceManifest, linkedDependencies };
}

interface SourceCompatibilityAssessment {
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

function isManifest(value: unknown): value is Manifest {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<Manifest>;
  if (!Array.isArray(candidate.files) || !Array.isArray(candidate.skippedSymlinks)) return false;
  if (!candidate.skippedSymlinks.every((entry) => typeof entry === "string")) return false;
  return candidate.files.every((entry) => {
    if (entry === null || typeof entry !== "object") return false;
    const file = entry as Partial<ManifestEntry>;
    return typeof file.path === "string"
      && file.path.length > 0
      && typeof file.bytes === "number"
      && Number.isSafeInteger(file.bytes)
      && file.bytes >= 0
      && typeof file.sha256 === "string"
      && /^[a-f0-9]{64}$/.test(file.sha256);
  });
}

/**
 * A Worker may consume a snapshot only after both copies are directories and
 * the final manifest written by prepareWorkspace has the expected shape.
 * Missing, partial, malformed, and wrong-type artifacts are all "not ready".
 */
export async function isWorkspaceReady(paths: TaskPaths): Promise<boolean> {
  try {
    const [baseline, workspace, manifestFile] = await Promise.all([
      lstat(paths.baseline),
      lstat(paths.workspace),
      lstat(path.join(paths.root, "source-manifest.json")),
    ]);
    if (!baseline.isDirectory() || !workspace.isDirectory() || !manifestFile.isFile()) {
      return false;
    }
    const raw = await readFile(path.join(paths.root, "source-manifest.json"), "utf8");
    return isManifest(JSON.parse(raw));
  } catch {
    return false;
  }
}

/**
 * Remove only Task-owned preparation outputs. `force` makes a missing path a
 * no-op; permission, I/O, and other unexpected errors still reject the call.
 */
export async function clearTaskPreparationArtifacts(paths: TaskPaths): Promise<void> {
  await rm(paths.baseline, { recursive: true, force: true });
  await rm(paths.workspace, { recursive: true, force: true });
  await rm(path.join(paths.root, "source-manifest.json"), { recursive: true, force: true });
}
