import { writeFile } from "node:fs/promises";
import path from "node:path";
import { runCaptured } from "../core/process.js";
import type {
  PatchEvidence,
  TaskPaths,
  WorkspacePatchReport,
} from "../core/types.js";
import type { PathPolicy } from "./path-policy.js";
import { workspacePatchPaths } from "./path-policy.js";

function decodeGitPathToken(token: string): string | undefined {
  if (!token.startsWith('"')) return token;
  try {
    const decoded = JSON.parse(token) as unknown;
    return typeof decoded === "string" ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function diffHeaderTokens(line: string): [string, string] | undefined {
  if (!line.startsWith("diff --git ")) return undefined;
  const rest = line.slice("diff --git ".length);
  const token = String.raw`(?:"(?:\\.|[^"])*"|\S+)`;
  const match = rest.match(new RegExp(`^(${token})\\s+(${token})$`));
  if (match === null) return undefined;
  const left = decodeGitPathToken(match[1]!);
  const right = decodeGitPathToken(match[2]!);
  return left === undefined || right === undefined ? undefined : [left, right];
}

function relativeWorkspacePath(raw: string): string | undefined {
  const withoutPrefix = raw.startsWith("a/") || raw.startsWith("b/") ? raw.slice(2) : raw;
  const relative = withoutPrefix.startsWith("baseline/")
    ? withoutPrefix.slice("baseline/".length)
    : withoutPrefix.startsWith("workspace/")
      ? withoutPrefix.slice("workspace/".length)
      : undefined;
  if (
    relative === undefined
    || relative.length === 0
    || relative.includes("\0")
    || path.posix.isAbsolute(relative)
    || relative.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return undefined;
  }
  return relative;
}

/** Strictly extracts normalized relative paths from no-index patch headers. */
export function parseAffectedPathsFromWorkspaceDiff(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split("\n")) {
    const tokens = diffHeaderTokens(line);
    if (tokens === undefined) continue;
    for (const token of tokens) {
      const relative = relativeWorkspacePath(token);
      if (relative !== undefined) files.add(relative);
    }
  }
  return [...files].sort();
}

function splitPatchSections(diff: string): string[] {
  const starts = [...diff.matchAll(/^diff --git /gm)].map((match) => match.index);
  if (starts.length === 0) return [];
  if (diff.slice(0, starts[0]).trim().length > 0) {
    throw new Error("Workspace patch contains unsupported content before the first file section");
  }
  return starts.map((start, index) => diff.slice(start, starts[index + 1] ?? diff.length));
}

function changedLines(diff: string): number {
  return diff.split("\n").filter(
    (line) =>
      (line.startsWith("+") && !line.startsWith("+++"))
      || (line.startsWith("-") && !line.startsWith("---")),
  ).length;
}

function evidence(artifactPath: string, sections: readonly string[]): PatchEvidence {
  const patch = sections.join("");
  return {
    path: artifactPath,
    filesChanged: sections.length,
    changedLines: changedLines(patch),
    affectedPaths: parseAffectedPathsFromWorkspaceDiff(patch),
  };
}

export async function writeWorkspacePatchReport(
  paths: TaskPaths,
  policy: PathPolicy,
): Promise<WorkspacePatchReport> {
  const result = await runCaptured(
    "git",
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "--no-index",
      "--no-ext-diff",
      "--binary",
      "--",
      "baseline",
      "workspace",
    ],
    { cwd: paths.root },
  );
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(`Unable to generate workspace patch: ${result.stderr.trim()}`);
  }

  const artifacts = workspacePatchPaths(paths);
  const sections = splitPatchSections(result.stdout);
  const businessSections: string[] = [];
  const generatedSections: string[] = [];
  for (const section of sections) {
    const affectedPaths = parseAffectedPathsFromWorkspaceDiff(section);
    if (affectedPaths.length !== 1) {
      throw new Error("Workspace patch section must identify exactly one safe relative path");
    }
    switch (policy.classify(affectedPaths[0]!)) {
      case "business":
        businessSections.push(section);
        break;
      case "generated":
        generatedSections.push(section);
        break;
      case "internal":
        break;
    }
  }

  const businessPatch = businessSections.join("");
  const generatedPatch = generatedSections.join("");
  await Promise.all([
    writeFile(artifacts.rawDiff, result.stdout, { mode: 0o600 }),
    writeFile(artifacts.generatedDiff, generatedPatch, { mode: 0o600 }),
    writeFile(artifacts.integrationDiff, businessPatch, { mode: 0o600 }),
  ]);

  return {
    business: evidence(artifacts.integrationDiff, businessSections),
    generated: evidence(artifacts.generatedDiff, generatedSections),
    integration: evidence(artifacts.integrationDiff, businessSections),
  };
}
