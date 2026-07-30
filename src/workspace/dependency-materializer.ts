/**
 * Canonical project-bound dependency materializer.
 *
 * Two isolation authorities share this module:
 * 1. Excluded runtime directories (currently node_modules) mirrored into the
 *    destination project as a real local directory tree.
 * 2. Root package.json relative file:/link: package roots mirrored into an
 *    explicit per-run isolation container at the same relative path the
 *    destination project expects (sibling layout for ../sdk style deps).
 *
 * Never exposes an external symlink that points outside the isolation
 * container. Copy-on-write is requested via COPYFILE_FICLONE when the
 * platform supports it; ordinary file copy is the correctness fallback.
 * Symlinks are preserved only when their resolved target stays inside the
 * containment root, and are always rewritten as destination-relative links.
 *
 * Boundaries: no package install, no lockfile/package.json mutation, no
 * recursive dependency graph walk, no Candidate diff inclusion, no
 * credential content, fail-closed on absolute/escaping/malformed targets.
 */
import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import path from "node:path";

/** Runtime dependency directory names that may be materialized for verifiers. */
export const RUNTIME_DEPENDENCY_DIRECTORIES = ["node_modules"] as const;

export type RuntimeDependencyDirectory = typeof RUNTIME_DEPENDENCY_DIRECTORIES[number];

/** Root package.json fields consulted for runtime/build resolution. */
const DEPENDENCY_MAP_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

const ESCAPE_ERROR =
  "dependency materialization rejected: dependency link escapes the project";
const SOURCE_ERROR =
  "dependency materialization failed: source project is not accessible";
const MATERIALIZE_ERROR =
  "dependency materialization failed: could not create local dependency mirror";

const LOCAL_ABS_ERROR =
  "declared local dependency rejected: absolute file/link target";
const LOCAL_ESCAPE_ERROR =
  "declared local dependency rejected: destination escapes isolation container";
const LOCAL_MISSING_ERROR =
  "declared local dependency rejected: target is missing or unreadable";
const LOCAL_NOT_DIR_ERROR =
  "declared local dependency rejected: target is not a directory";
const LOCAL_PKG_JSON_ERROR =
  "declared local dependency rejected: target package.json is missing";
const LOCAL_MALFORMED_ERROR =
  "declared local dependency rejected: source package.json is malformed";
const LOCAL_CONFLICT_ERROR =
  "declared local dependency rejected: conflicting destinations";
const LOCAL_MATERIALIZE_ERROR =
  "declared local dependency materialization failed: could not create local package mirror";
const LOCAL_EMPTY_TARGET_ERROR =
  "declared local dependency rejected: empty file/link target";

/** True when candidate is the root or a path strictly inside it. */
export function isPathInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function cloneOrCopyFile(source: string, destination: string): Promise<void> {
  try {
    // Prefer copy-on-write when the filesystem supports it; Node falls back
    // to a full copy when FICLONE is unavailable on some platforms, and we
    // still catch unexpected errors for a second plain-copy attempt.
    await copyFile(source, destination, constants.COPYFILE_FICLONE);
  } catch {
    await copyFile(source, destination);
  }
}

/**
 * Resolve the on-disk directory that backs project/<name>. Follows a
 * top-level dependency symlink (parent-workspace reuse) to its real
 * directory. Returns null when the entry is missing or not a directory.
 */
async function resolveDependencySource(
  sourceProject: string,
  name: string,
): Promise<string | null> {
  const entry = path.join(sourceProject, name);
  try {
    // realpath follows a top-level dependency symlink (parent-workspace reuse)
    // and rejects non-directories / missing paths via throw → null.
    const resolved = await realpath(entry);
    const resolvedMetadata = await lstat(resolved);
    if (!resolvedMetadata.isDirectory()) return null;
    return resolved;
  } catch {
    return null;
  }
}

/**
 * Map a resolved source path into the destination project.
 * - Paths under the dependency source root map into dest dependency root.
 * - Paths under the source project but outside the dependency root map into
 *   the destination project (monorepo-style links such as node_modules/app -> ../packages/app).
 */
function mapToDestination(
  resolvedSource: string,
  sourceRoot: string,
  destRoot: string,
  sourceProjectReal: string,
  destinationProject: string,
): string {
  if (isPathInsideRoot(sourceRoot, resolvedSource)) {
    return path.join(destRoot, path.relative(sourceRoot, resolvedSource));
  }
  return path.join(destinationProject, path.relative(sourceProjectReal, resolvedSource));
}

async function materializeSymlink(
  sourcePath: string,
  destPath: string,
  containmentRoot: string,
  sourceRoot: string,
  destRoot: string,
  sourceProjectReal: string,
  destinationProject: string,
): Promise<void> {
  let resolvedTarget: string;
  try {
    // realpath on the symlink itself yields the final target and catches
    // intermediate escapes through chains of links.
    resolvedTarget = await realpath(sourcePath);
  } catch {
    const linkText = await readlink(sourcePath);
    resolvedTarget = path.resolve(path.dirname(sourcePath), linkText);
  }

  if (!isPathInsideRoot(containmentRoot, resolvedTarget)) {
    throw new Error(ESCAPE_ERROR);
  }

  // Destination targets must also stay project-contained. When the dependency
  // source is external (parent workspace), containment is the dependency root
  // and every mapped path is under destRoot.
  const destTarget = mapToDestination(
    resolvedTarget,
    sourceRoot,
    destRoot,
    sourceProjectReal,
    destinationProject,
  );
  const relativeTarget = path.relative(path.dirname(destPath), destTarget);
  // Always emit a relative link so the isolated tree never carries absolute
  // paths that would re-escape once the workspace moves.
  await symlink(relativeTarget.length > 0 ? relativeTarget : ".", destPath);
}

async function materializeTree(
  sourceDir: string,
  destDir: string,
  containmentRoot: string,
  sourceRoot: string,
  destRoot: string,
  sourceProjectReal: string,
  destinationProject: string,
): Promise<void> {
  await mkdir(destDir, { recursive: true, mode: 0o755 });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    // Dirent: check symbolic links before isDirectory/isFile so a link to a
    // directory is validated and recreated as a link, never walked through.
    if (entry.isSymbolicLink()) {
      await materializeSymlink(
        sourcePath,
        destPath,
        containmentRoot,
        sourceRoot,
        destRoot,
        sourceProjectReal,
        destinationProject,
      );
    } else if (entry.isDirectory()) {
      await materializeTree(
        sourcePath,
        destPath,
        containmentRoot,
        sourceRoot,
        destRoot,
        sourceProjectReal,
        destinationProject,
      );
    } else if (entry.isFile()) {
      await cloneOrCopyFile(sourcePath, destPath);
    }
    // Non-file special nodes are skipped deliberately.
  }
}

export interface MaterializeDependenciesOptions {
  /**
   * When true, replace an existing destination dependency path (symlink or
   * directory). Prepare leaves an existing real directory alone; reverify
   * upgrades only remove legacy external symlinks before calling materialize.
   */
  replaceExisting?: boolean;
}

/**
 * Materialize excluded runtime dependency directories into destinationProject
 * as local directory trees. Missing source dependencies are skipped. Existing
 * real destination directories are left in place unless replaceExisting is set.
 * Legacy destination symlinks are always removed and replaced.
 */
export async function materializeProjectDependencies(
  sourceProject: string,
  destinationProject: string,
  dependencyNames: readonly string[] = RUNTIME_DEPENDENCY_DIRECTORIES,
  options?: MaterializeDependenciesOptions,
): Promise<string[]> {
  let sourceProjectReal: string;
  try {
    sourceProjectReal = await realpath(sourceProject);
  } catch {
    throw new Error(SOURCE_ERROR);
  }

  const materialized: string[] = [];

  for (const name of dependencyNames) {
    // Only top-level dependency directory names are accepted.
    if (name.includes("/") || name.includes("\\") || name === ".." || name === ".") {
      continue;
    }

    const sourceRoot = await resolveDependencySource(sourceProject, name);
    if (sourceRoot === null) continue;

    const destRoot = path.join(destinationProject, name);

    try {
      const existing = await lstat(destRoot);
      if (existing.isSymbolicLink()) {
        // Legacy external link or stale link — always replace with a local mirror.
        await rm(destRoot, { force: true });
      } else if (existing.isDirectory()) {
        if (options?.replaceExisting === true) {
          await rm(destRoot, { recursive: true, force: true });
        } else {
          // Already a local directory (prior materialization). Keep it.
          materialized.push(name);
          continue;
        }
      } else {
        await rm(destRoot, { force: true });
      }
    } catch {
      // Destination path absent — proceed to create.
    }

    // When the dependency source lives inside the project, monorepo-style
    // links to sibling packages are allowed. When the source is an external
    // directory (parent-workspace node_modules link), containment is the
    // dependency tree itself so nothing outside that tree is preserved.
    const containmentRoot = isPathInsideRoot(sourceProjectReal, sourceRoot)
      ? sourceProjectReal
      : sourceRoot;

    try {
      await materializeTree(
        sourceRoot,
        destRoot,
        containmentRoot,
        sourceRoot,
        destRoot,
        sourceProjectReal,
        destinationProject,
      );
    } catch (error) {
      // Clean up a partial mirror so the destination never looks command-ready
      // with an incomplete or escaping dependency tree.
      await rm(destRoot, { recursive: true, force: true }).catch(() => undefined);
      if (error instanceof Error && error.message === ESCAPE_ERROR) throw error;
      if (error instanceof Error && error.message === SOURCE_ERROR) throw error;
      throw new Error(MATERIALIZE_ERROR);
    }

    materialized.push(name);
  }

  return materialized;
}

/**
 * One planned root-manifest relative file:/link: package mirror.
 * Destination is always computed from the destination project so the
 * relative relationship matches what package managers resolve at runtime.
 */
export interface DeclaredLocalPackagePlan {
  /** Package name from the source package.json dependency map. */
  packageName: string;
  /** Protocol as declared (`file` or `link`). Both are copied, never re-linked externally. */
  protocol: "file" | "link";
  /** Relative path text after the protocol (POSIX-style as declared). */
  relativeTarget: string;
  /** Absolute source package root on the original filesystem. */
  sourceAbsolute: string;
  /** Absolute destination package root inside the isolation container. */
  destinationAbsolute: string;
}

/** Stable record of a successfully materialized declared local package. */
export interface MaterializedLocalPackage {
  packageName: string;
  protocol: "file" | "link";
  relativeTarget: string;
  destinationAbsolute: string;
}

interface RawLocalDeclaration {
  packageName: string;
  protocol: "file" | "link";
  relativeTarget: string;
  field: string;
}

function parseLocalProtocol(
  value: string,
): { protocol: "file" | "link"; target: string } | undefined {
  if (value.startsWith("file:")) {
    return { protocol: "file", target: value.slice("file:".length) };
  }
  if (value.startsWith("link:")) {
    return { protocol: "link", target: value.slice("link:".length) };
  }
  return undefined;
}

/**
 * Absolute-path rejection for declared file:/link: targets. Covers POSIX
 * absolute, Windows drive, and UNC forms. Relative targets only.
 */
function isAbsoluteDependencyTarget(target: string): boolean {
  if (target.length === 0) return false;
  if (path.isAbsolute(target)) return true;
  if (target.startsWith("/") || target.startsWith("\\")) return true;
  if (target.startsWith("~/") || target === "~") return true;
  // file:/abs and file:///abs after protocol strip leave a leading slash —
  // already covered. Windows: C:\ or C:/
  if (/^[A-Za-z]:[\\/]/.test(target)) return true;
  // file:////server/share style UNC after strip may start with //
  if (target.startsWith("//") || target.startsWith("\\\\")) return true;
  return false;
}

/**
 * Read root package.json dependency maps and return raw relative file:/link:
 * declarations in stable field/name order. Missing package.json → empty list.
 * Malformed package.json fails closed.
 */
async function readRawLocalDeclarations(
  sourceProject: string,
): Promise<RawLocalDeclaration[]> {
  const manifestPath = path.join(sourceProject, "package.json");
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw new Error(LOCAL_MALFORMED_ERROR);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(LOCAL_MALFORMED_ERROR);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(LOCAL_MALFORMED_ERROR);
  }
  const manifest = parsed as Record<string, unknown>;
  const declarations: RawLocalDeclaration[] = [];

  for (const field of DEPENDENCY_MAP_FIELDS) {
    const map = manifest[field];
    if (map === undefined || map === null) continue;
    if (typeof map !== "object" || Array.isArray(map)) {
      throw new Error(LOCAL_MALFORMED_ERROR);
    }
    const entries = Object.entries(map as Record<string, unknown>)
      .filter(([name]) => typeof name === "string" && name.length > 0)
      .sort(([left], [right]) => left.localeCompare(right));
    for (const [packageName, value] of entries) {
      if (typeof value !== "string") continue;
      const parsedValue = parseLocalProtocol(value.trim());
      if (parsedValue === undefined) continue;
      declarations.push({
        packageName,
        protocol: parsedValue.protocol,
        relativeTarget: parsedValue.target,
        field,
      });
    }
  }
  return declarations;
}

/**
 * Discover and validate relative file:/link: package roots declared by the
 * source project's root package.json. Resolves each target against the
 * original source project, requires an accessible directory package root
 * with package.json, and proves the mirrored destination stays inside the
 * explicit isolation container. Deduplicates identical source/destination
 * pairs; conflicting destinations fail closed. Does not recurse.
 */
export async function planDeclaredLocalPackages(
  sourceProject: string,
  destinationProject: string,
  isolationContainer: string,
): Promise<DeclaredLocalPackagePlan[]> {
  let sourceProjectReal: string;
  let destinationProjectReal: string;
  let containerReal: string;
  try {
    sourceProjectReal = await realpath(sourceProject);
  } catch {
    throw new Error(SOURCE_ERROR);
  }
  try {
    destinationProjectReal = await realpath(destinationProject);
  } catch {
    throw new Error(SOURCE_ERROR);
  }
  try {
    containerReal = await realpath(isolationContainer);
  } catch {
    throw new Error(SOURCE_ERROR);
  }

  if (!isPathInsideRoot(containerReal, destinationProjectReal)) {
    throw new Error(LOCAL_ESCAPE_ERROR);
  }

  const raw = await readRawLocalDeclarations(sourceProjectReal);
  const planned: DeclaredLocalPackagePlan[] = [];
  // destinationAbsolute → sourceReal for conflict detection
  const byDestination = new Map<string, string>();
  // packageName → sourceReal for same-name / different-source conflicts
  const byPackageName = new Map<string, string>();

  for (const declaration of raw) {
    const target = declaration.relativeTarget;
    if (target.length === 0 || target === "." || target === "./") {
      throw new Error(LOCAL_EMPTY_TARGET_ERROR);
    }
    if (isAbsoluteDependencyTarget(target)) {
      throw new Error(LOCAL_ABS_ERROR);
    }

    // Keep the declared relative form for destination recreation; only
    // normalize separators so path.resolve is deterministic.
    const relativeTarget = target.split(/[/\\]+/).join(path.sep);
    if (relativeTarget.length === 0 || relativeTarget === ".") {
      throw new Error(LOCAL_EMPTY_TARGET_ERROR);
    }

    const sourceAbsolute = path.resolve(sourceProjectReal, relativeTarget);
    const destinationAbsolute = path.resolve(destinationProjectReal, relativeTarget);

    // Destination must remain inside the owned isolation container.
    if (!isPathInsideRoot(containerReal, destinationAbsolute)) {
      throw new Error(LOCAL_ESCAPE_ERROR);
    }
    // Reject destinations that are the destination project itself or any
    // ancestor of it (including the container root via file:..). Sibling
    // mirrors and in-project package roots remain allowed.
    if (isPathInsideRoot(destinationAbsolute, destinationProjectReal)) {
      throw new Error(LOCAL_ESCAPE_ERROR);
    }

    // Validate source package root before any copy.
    let sourceReal: string;
    try {
      sourceReal = await realpath(sourceAbsolute);
    } catch {
      throw new Error(LOCAL_MISSING_ERROR);
    }
    let sourceMeta: Awaited<ReturnType<typeof lstat>>;
    try {
      sourceMeta = await lstat(sourceReal);
    } catch {
      throw new Error(LOCAL_MISSING_ERROR);
    }
    if (!sourceMeta.isDirectory()) {
      throw new Error(LOCAL_NOT_DIR_ERROR);
    }
    try {
      const pkgMeta = await lstat(path.join(sourceReal, "package.json"));
      if (!pkgMeta.isFile() && !pkgMeta.isSymbolicLink()) {
        throw new Error(LOCAL_PKG_JSON_ERROR);
      }
    } catch (error) {
      if (error instanceof Error && error.message === LOCAL_PKG_JSON_ERROR) throw error;
      throw new Error(LOCAL_PKG_JSON_ERROR);
    }

    const existingForName = byPackageName.get(declaration.packageName);
    if (existingForName !== undefined && existingForName !== sourceReal) {
      throw new Error(LOCAL_CONFLICT_ERROR);
    }

    const existingSource = byDestination.get(destinationAbsolute);
    if (existingSource !== undefined) {
      if (existingSource !== sourceReal) {
        throw new Error(LOCAL_CONFLICT_ERROR);
      }
      // Identical source/destination — deterministic dedupe; keep first.
      byPackageName.set(declaration.packageName, sourceReal);
      continue;
    }
    byDestination.set(destinationAbsolute, sourceReal);
    byPackageName.set(declaration.packageName, sourceReal);

    planned.push({
      packageName: declaration.packageName,
      protocol: declaration.protocol,
      relativeTarget: target.split(/[/\\]+/).join("/"),
      sourceAbsolute: sourceReal,
      destinationAbsolute,
    });
  }

  // Stable ordering by relative target then package name.
  planned.sort((left, right) => {
    const byTarget = left.relativeTarget.localeCompare(right.relativeTarget);
    if (byTarget !== 0) return byTarget;
    return left.packageName.localeCompare(right.packageName);
  });
  return planned;
}

/**
 * Materialize root-manifest-declared relative file:/link: package roots into
 * the isolation container. Existing destination directories are left in place
 * (idempotent reverify). Missing destinations are clone/copied from the
 * original source package root. Never mutates the source dependency.
 */
export async function materializeDeclaredLocalPackages(
  sourceProject: string,
  destinationProject: string,
  isolationContainer: string,
  options?: MaterializeDependenciesOptions,
): Promise<MaterializedLocalPackage[]> {
  const plans = await planDeclaredLocalPackages(
    sourceProject,
    destinationProject,
    isolationContainer,
  );
  const materialized: MaterializedLocalPackage[] = [];

  for (const plan of plans) {
    try {
      const existing = await lstat(plan.destinationAbsolute);
      if (existing.isSymbolicLink()) {
        await rm(plan.destinationAbsolute, { force: true });
      } else if (existing.isDirectory()) {
        if (options?.replaceExisting === true) {
          await rm(plan.destinationAbsolute, { recursive: true, force: true });
        } else {
          materialized.push({
            packageName: plan.packageName,
            protocol: plan.protocol,
            relativeTarget: plan.relativeTarget,
            destinationAbsolute: plan.destinationAbsolute,
          });
          continue;
        }
      } else {
        await rm(plan.destinationAbsolute, { force: true });
      }
    } catch {
      // Destination absent — create.
    }

    try {
      await mkdir(path.dirname(plan.destinationAbsolute), { recursive: true, mode: 0o755 });
      // Containment is the source package root: only that package is mirrored,
      // never arbitrary siblings of the external source tree.
      await materializeTree(
        plan.sourceAbsolute,
        plan.destinationAbsolute,
        plan.sourceAbsolute,
        plan.sourceAbsolute,
        plan.destinationAbsolute,
        plan.sourceAbsolute,
        plan.destinationAbsolute,
      );
    } catch (error) {
      await rm(plan.destinationAbsolute, { recursive: true, force: true }).catch(
        () => undefined,
      );
      if (error instanceof Error) {
        const known = [
          ESCAPE_ERROR,
          LOCAL_ABS_ERROR,
          LOCAL_ESCAPE_ERROR,
          LOCAL_MISSING_ERROR,
          LOCAL_NOT_DIR_ERROR,
          LOCAL_PKG_JSON_ERROR,
          LOCAL_MALFORMED_ERROR,
          LOCAL_CONFLICT_ERROR,
          LOCAL_EMPTY_TARGET_ERROR,
        ];
        if (known.includes(error.message)) throw error;
      }
      throw new Error(LOCAL_MATERIALIZE_ERROR);
    }

    materialized.push({
      packageName: plan.packageName,
      protocol: plan.protocol,
      relativeTarget: plan.relativeTarget,
      destinationAbsolute: plan.destinationAbsolute,
    });
  }

  return materialized;
}

/**
 * Ensure a retained workspace has local dependency mirrors before no-Worker
 * reverification. Replaces legacy external dependency symlinks without
 * touching business Candidate files. Missing mirrors are created from the
 * original source project. Also materializes root-manifest declared relative
 * file:/link: package roots into the Task isolation container.
 */
export async function ensureWorkspaceDependencyMirrors(
  sourceProject: string,
  workspaceProject: string,
  dependencyNames: readonly string[] = RUNTIME_DEPENDENCY_DIRECTORIES,
  isolationContainer?: string,
): Promise<string[]> {
  for (const name of dependencyNames) {
    if (name.includes("/") || name.includes("\\") || name === ".." || name === ".") {
      continue;
    }
    const dest = path.join(workspaceProject, name);
    try {
      const metadata = await lstat(dest);
      if (metadata.isSymbolicLink()) {
        // Drop the legacy external link so materialize creates a local mirror.
        await rm(dest, { force: true });
      }
    } catch {
      // Absent — materialize will create when the source has the dependency.
    }
  }
  const runtime = await materializeProjectDependencies(
    sourceProject,
    workspaceProject,
    dependencyNames,
  );
  const container = isolationContainer ?? path.dirname(workspaceProject);
  const local = await materializeDeclaredLocalPackages(
    sourceProject,
    workspaceProject,
    container,
  );
  return [...runtime, ...local.map((entry) => entry.relativeTarget)];
}
