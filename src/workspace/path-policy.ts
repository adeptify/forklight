import path from "node:path";
import type { TaskPaths, TaskSpec } from "../core/types.js";

export const DEFAULT_GENERATED_PATTERNS = [
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

export function createPathPolicy(spec: TaskSpec): PathPolicy {
  const generatedPatterns = [
    ...DEFAULT_GENERATED_PATTERNS,
    ...(spec.workspace.generatedPaths ?? []),
  ];
  return {
    snapshotExcludes: new Set(spec.workspace.exclude),
    generatedPatterns,
    classify(relativePath) {
      const normalized = normalizedPosixPath(relativePath);
      if (normalized === ".forklight" || normalized.startsWith(".forklight/")) {
        return "internal";
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
