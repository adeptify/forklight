import path from "node:path";
import type {
  PathCategory,
  PathClassification,
  PathProvenance,
  TaskPaths,
  TaskSpec,
} from "../core/types.js";

const DEFAULT_GENERATED_PATTERNS = [
  "**/__pycache__/**",
  "**/.pytest_cache/**",
  "**/.ruff_cache/**",
  "**/.mypy_cache/**",
  "**/.coverage",
  "**/coverage/**",
] as const;

/** Closed category vocabulary shared by PathPolicy and Integration evidence
 *  validation. Never inferred from a filename. */
export const PATH_CATEGORIES: ReadonlySet<PathCategory> = new Set<PathCategory>([
  "business",
  "generated",
  "internal",
]);

/** Closed provenance vocabulary. Each value names the single rule that produced
 *  a category for one path, so Main can see which contract boundary to review. */
export const PATH_PROVENANCES: ReadonlySet<PathProvenance> = new Set<PathProvenance>([
  "internal-forklight",
  "snapshot-exclusion",
  "builtin-generated-pattern",
  "task-generated-pattern",
  "default-business",
]);

export interface PathPolicy {
  snapshotExcludes: ReadonlySet<string>;
  generatedPatterns: readonly string[];
  classify(relativePath: string): PathCategory;
  /** Explain the exact existing classification decision without changing it.
   *  Returns the category plus the single bounded provenance rule that produced
   *  it, in the same precedence `classify` uses. No filename heuristic and no
   *  policy mutation. */
  explain(relativePath: string): PathClassification;
}

function normalizedPosixPath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function matches(relativePath: string, pattern: string): boolean {
  return path.matchesGlob(normalizedPosixPath(relativePath), pattern);
}

/** The single shared named-segment exclusion rule. A relative path is
 *  excluded when any of its normalized path segments equals a configured
 *  exclude name.  Safe-snapshot copying (a filesystem scan that may use
 *  platform separators) and Patch classification (POSIX diff headers) both
 *  route through here, so the two product surfaces cannot drift: content
 *  deliberately omitted from the comparison baseline is never eligible for
 *  automatic source Integration.
 *
 *  Nested matches are intentional and identical to top-level matches - a
 *  configured name such as `dist` or `coverage` excludes `pkg/coverage/x`
 *  exactly as it excludes `coverage/x`.  This is segment equality only; it
 *  never infers generated content from an arbitrary directory name such as
 *  `src/generated`, which stays business when not explicitly excluded. */
export function matchesExcludedSegment(
  relativePath: string,
  excludes: ReadonlySet<string>,
): boolean {
  if (!relativePath || relativePath === ".") return false;
  if (excludes.size === 0) return false;
  return normalizedPosixPath(relativePath)
    .split("/")
    .some((segment) => excludes.has(segment));
}

export function createPathPolicy(spec: TaskSpec): PathPolicy {
  const builtinGeneratedPatterns = [...DEFAULT_GENERATED_PATTERNS];
  const taskGeneratedPatterns = [...(spec.workspace.generatedPaths ?? [])];
  const generatedPatterns = [...builtinGeneratedPatterns, ...taskGeneratedPatterns];
  const snapshotExcludes = new Set(spec.workspace.exclude);

  // The single canonical classification decision. `classify` delegates here so
  // category behavior cannot drift from the explained provenance. Precedence is
  // identical to the historical classify: internal ForkLight path first, then
  // snapshot exclusion, then built-in generated patterns, then Task-declared
  // generated patterns, then default business inclusion. A path that matches
  // both a built-in and a Task-declared pattern is attributed to the built-in
  // pattern, exactly as the combined-pattern `.some()` order did before.
  function explainPath(normalized: string): PathClassification {
    if (normalized === ".forklight" || normalized.startsWith(".forklight/")) {
      return { category: "internal", provenance: "internal-forklight" };
    }
    // A path whose segment was deliberately excluded from the safe snapshot is
    // non-business generated evidence: it has no trustworthy baseline, so it
    // must fail closed out of Integration even when an acceptance build
    // recreated it.  Explicit generatedPaths still classify included generated
    // content below; included source whose name happens to contain `generated`
    // is never inferred from the name.
    if (matchesExcludedSegment(normalized, snapshotExcludes)) {
      return { category: "generated", provenance: "snapshot-exclusion" };
    }
    if (builtinGeneratedPatterns.some((pattern) => matches(normalized, pattern))) {
      return { category: "generated", provenance: "builtin-generated-pattern" };
    }
    if (taskGeneratedPatterns.some((pattern) => matches(normalized, pattern))) {
      return { category: "generated", provenance: "task-generated-pattern" };
    }
    return { category: "business", provenance: "default-business" };
  }

  return {
    snapshotExcludes,
    generatedPatterns,
    classify(relativePath) {
      return explainPath(normalizedPosixPath(relativePath)).category;
    },
    explain(relativePath) {
      return explainPath(normalizedPosixPath(relativePath));
    },
  };
}

export function workspacePatchPaths(paths: TaskPaths): {
  rawDiff: string;
  generatedDiff: string;
  integrationDiff: string;
} {
  return {
    rawDiff: path.join(paths.root, "workspace.raw.patch"),
    generatedDiff: path.join(paths.root, "workspace.generated.patch"),
    integrationDiff: paths.diff,
  };
}
