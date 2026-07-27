import path from "node:path";
import type { TaskPaths, TaskSpec } from "../core/types.js";

const DEFAULT_GENERATED_PATTERNS = [
  "**/__pycache__/**",
  "**/.pytest_cache/**",
  "**/.ruff_cache/**",
  "**/.mypy_cache/**",
  "**/.coverage",
  "**/coverage/**",
] as const;

export interface PathPolicy {
  snapshotExcludes: ReadonlySet<string>;
  generatedPatterns: readonly string[];
  classify(relativePath: string): "business" | "generated" | "internal";
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
  const generatedPatterns = [
    ...DEFAULT_GENERATED_PATTERNS,
    ...(spec.workspace.generatedPaths ?? []),
  ];
  const snapshotExcludes = new Set(spec.workspace.exclude);
  return {
    snapshotExcludes,
    generatedPatterns,
    classify(relativePath) {
      const normalized = normalizedPosixPath(relativePath);
      if (normalized === ".forklight" || normalized.startsWith(".forklight/")) {
        return "internal";
      }
      // A path whose segment was deliberately excluded from the safe
      // snapshot is non-business generated evidence: it has no trustworthy
      // baseline, so it must fail closed out of Integration even when an
      // acceptance build recreated it.  Explicit generatedPaths still
      // classify included generated content below; included source whose
      // name happens to contain `generated` is never inferred from the name.
      if (matchesExcludedSegment(normalized, snapshotExcludes)) {
        return "generated";
      }
      return generatedPatterns.some((pattern) => matches(normalized, pattern))
        ? "generated"
        : "business";
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
