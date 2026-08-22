import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import type { WriteStream } from "node:fs";
import { lstat, readdir, rename, rm } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import path from "node:path";
import type {
  PatchEvidence,
  TaskPaths,
  WorkspacePatchReport,
} from "../core/types.js";
import type { PathPolicy } from "./path-policy.js";
import { workspacePatchPaths } from "./path-policy.js";

interface StashedRoot {
  original: string;
  stashed: string;
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT"
  );
}

/**
 * Discover outermost exact snapshot-excluded roots under a comparison tree.
 * Uses PathPolicy named-segment equality only: an entry whose name equals a
 * configured exclude is collected and never descended into. Symlinks are not
 * followed, so discovery cannot escape the owned Task root via a link.
 */
async function discoverOutermostExcludedRoots(
  absoluteRoot: string,
  excludes: ReadonlySet<string>,
): Promise<string[]> {
  if (excludes.size === 0) return [];
  const found: string[] = [];

  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      // Only a genuinely disappeared directory is ignorable (TOCTOU between
      // parent listing and descent). Permission and other FS errors fail closed
      // so excluded build output cannot stay hidden from discovery and leak
      // into the raw Candidate diff.
      if (isEnoent(error)) return;
      throw error;
    }
    // Stable order keeps stash names and restore sequencing deterministic.
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (excludes.has(entry.name)) {
        found.push(absolute);
        continue;
      }
      // Dirent for a pure symlink reports isSymbolicLink and not isDirectory,
      // so this never traverses linked trees.
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await walk(absolute);
      }
    }
  }

  await walk(absoluteRoot);
  return found;
}

/**
 * Deterministic, collision-resistant stash destination under the Task root.
 * Hash covers the exact role and relative path so `a/b` and `a+b` never share
 * a destination (unlike separator substitution).
 */
export function excludedRootStashPath(
  taskRoot: string,
  role: "baseline" | "workspace",
  relativePosix: string,
): string {
  const digest = createHash("sha256")
    .update(role)
    .update("\0")
    .update(relativePosix)
    .digest("hex");
  return path.join(taskRoot, `.forklight-exclude-stash-${digest}`);
}

/**
 * Atomically move every outermost snapshot-excluded root out of baseline and
 * workspace before `git diff --no-index`. Stashes live on the same Task
 * filesystem so rename never copies multi-gigabyte verifier trees.
 */
async function stashExcludedRoots(
  paths: TaskPaths,
  excludes: ReadonlySet<string>,
): Promise<StashedRoot[]> {
  const stashed: StashedRoot[] = [];
  const roots: Array<{ role: "baseline" | "workspace"; absolute: string }> = [
    { role: "baseline", absolute: paths.baseline },
    { role: "workspace", absolute: paths.workspace },
  ];
  try {
    for (const { role, absolute } of roots) {
      const discovered = await discoverOutermostExcludedRoots(absolute, excludes);
      for (const original of discovered) {
        const relativePosix = path.relative(absolute, original).split(path.sep).join("/");
        if (
          !relativePosix
          || relativePosix === ".."
          || relativePosix.startsWith("../")
          || path.isAbsolute(relativePosix)
        ) {
          // Never move the comparison root or anything outside it.
          continue;
        }
        const stashedPath = excludedRootStashPath(paths.root, role, relativePosix);
        // Never delete an unexpected pre-existing stash: collision or leftover
        // state must fail closed so retained data cannot be overwritten.
        try {
          await lstat(stashedPath);
          throw new Error(
            "Excluded-root stash destination already exists; refusing to overwrite retained data",
          );
        } catch (error) {
          if (!isEnoent(error)) throw error;
        }
        await rename(original, stashedPath);
        stashed.push({ original, stashed: stashedPath });
      }
    }
    return stashed;
  } catch (error) {
    // Roll back any roots already moved so a mid-stash failure cannot leave
    // the retained workspace partially emptied.
    try {
      await restoreStashedRoots(stashed);
    } catch {
      // Every recorded root was already attempted; surface the stash failure.
    }
    throw error;
  }
}

/**
 * Restore every stashed root to its exact original path (reverse order).
 * Continues after individual failures so one bad rename cannot leave later
 * roots stranded in the stash, then surfaces a single bounded error.
 */
async function restoreStashedRoots(stashed: readonly StashedRoot[]): Promise<void> {
  let failureCount = 0;
  for (let index = stashed.length - 1; index >= 0; index -= 1) {
    const entry = stashed[index]!;
    try {
      await rm(entry.original, { recursive: true, force: true }).catch(() => undefined);
      await rename(entry.stashed, entry.original);
    } catch {
      failureCount += 1;
    }
  }
  if (failureCount > 0) {
    throw new Error(
      `Failed to restore ${failureCount} snapshot-excluded root(s) after patch generation`,
    );
  }
}

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

function sectionHeaderAffectedPaths(headerLine: string): string[] {
  const tokens = diffHeaderTokens(headerLine);
  if (!tokens) return [];
  const paths = new Set<string>();
  for (const token of tokens) {
    const relative = relativeWorkspacePath(token);
    if (relative !== undefined) paths.add(relative);
  }
  return [...paths].sort();
}

function isChangedLine(line: string): boolean {
  return (
    (line.startsWith("+") && !line.startsWith("+++"))
    || (line.startsWith("-") && !line.startsWith("---"))
  );
}

interface SectionAccumulator {
  filesChanged: number;
  changedLines: number;
  affectedPaths: Set<string>;
}

function toEvidence(artifactPath: string, acc: SectionAccumulator): PatchEvidence {
  return {
    path: artifactPath,
    filesChanged: acc.filesChanged,
    changedLines: acc.changedLines,
    affectedPaths: [...acc.affectedPaths].sort(),
  };
}

interface WriteWorkspacePatchOptions {
  /**
   * Optional hook invoked after excluded roots are stashed and before the raw
   * diff runs. Production callers omit this; tests use it to inject failures
   * while proving finally-restoration.
   */
  afterExcludedRootStash?: () => void | Promise<void>;
}

export async function writeWorkspacePatchReport(
  paths: TaskPaths,
  policy: PathPolicy,
  options?: WriteWorkspacePatchOptions,
): Promise<WorkspacePatchReport> {
  // Snapshot-excluded roots (nested target, dist, node_modules, …) must not
  // enter raw/generated/Integration patch payloads. Stash outermost exact
  // matches for the baseline↔workspace comparison, then always restore so
  // retained-workspace inspection still sees verifier output.
  const stashedRoots = await stashExcludedRoots(paths, policy.snapshotExcludes);
  try {
    if (options?.afterExcludedRootStash !== undefined) {
      await options.afterExcludedRootStash();
    }
    return await writeWorkspacePatchReportCore(paths, policy);
  } finally {
    await restoreStashedRoots(stashedRoots);
  }
}

async function writeWorkspacePatchReportCore(
  paths: TaskPaths,
  policy: PathPolicy,
): Promise<WorkspacePatchReport> {
  const artifacts = workspacePatchPaths(paths);
  const rawStream = createWriteStream(artifacts.rawDiff, { mode: 0o600 });
  const generatedStream = createWriteStream(artifacts.generatedDiff, { mode: 0o600 });
  const integrationStream = createWriteStream(artifacts.integrationDiff, { mode: 0o600 });

  const businessAcc: SectionAccumulator = {
    filesChanged: 0, changedLines: 0, affectedPaths: new Set(),
  };
  const generatedAcc: SectionAccumulator = {
    filesChanged: 0, changedLines: 0, affectedPaths: new Set(),
  };

  return new Promise((resolve, reject) => {
    const child = spawn("git", [
      "-c", "core.quotePath=false",
      "diff", "--no-index", "--no-ext-diff", "--binary",
      "--", "baseline", "workspace",
    ], {
      cwd: paths.root,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    const decoder = new StringDecoder("utf8");
    let stderr = "";
    let settled = false;

    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      rawStream.destroy();
      generatedStream.destroy();
      integrationStream.destroy();
      reject(err);
    };

    const draining = new Set<WriteStream>();
    const write = (stream: WriteStream, data: string | Buffer): void => {
      if (stream.write(data) || draining.has(stream)) return;
      if (draining.size === 0) child.stdout.pause();
      draining.add(stream);
      stream.once("drain", () => {
        draining.delete(stream);
        if (draining.size === 0 && !settled) child.stdout.resume();
      });
    };

    let lineBuffer = "";
    let preambleChecked = false;
    let preambleHadContent = false;
    let classification: "business" | "generated" | "internal" | null = null;
    let affectedPath: string | null = null;
    let sectionChangedLines = 0;

    const flushSection = (): void => {
      if (classification !== null && classification !== "internal") {
        const acc = classification === "business" ? businessAcc : generatedAcc;
        acc.filesChanged += 1;
        acc.changedLines += sectionChangedLines;
        if (affectedPath !== null) acc.affectedPaths.add(affectedPath);
      }
      classification = null;
      affectedPath = null;
      sectionChangedLines = 0;
    };

    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      write(rawStream, chunk);
      lineBuffer += decoder.write(chunk);
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop()!;

      for (const line of lines) {
        if (line.startsWith("diff --git ")) {
          if (!preambleChecked) {
            if (preambleHadContent) {
              fail(new Error("Workspace patch contains unsupported content before the first file section"));
              return;
            }
            preambleChecked = true;
          } else {
            flushSection();
          }
          const paths = sectionHeaderAffectedPaths(line);
          if (paths.length !== 1) {
            fail(new Error("Workspace patch section must identify exactly one safe relative path"));
            return;
          }
          affectedPath = paths[0]!;
          classification = policy.classify(affectedPath);
        } else if (!preambleChecked) {
          if (line.trim().length > 0) preambleHadContent = true;
          continue;
        } else {
          if (isChangedLine(line)) sectionChangedLines += 1;
        }
        if (preambleChecked && classification !== null && classification !== "internal") {
          write(
            classification === "business" ? integrationStream : generatedStream,
            line + "\n",
          );
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length >= 100_000) return;
      const next = stderr + chunk.toString();
      stderr = next.length <= 100_000 ? next : next.slice(0, 100_000);
    });

    rawStream.on("error", (err) => fail(err));
    generatedStream.on("error", (err) => fail(err));
    integrationStream.on("error", (err) => fail(err));
    child.once("error", (err) => fail(err));

    child.once("close", (code, signal) => {
      if (settled) return;
      lineBuffer += decoder.end();
      if (!preambleChecked) {
        if (preambleHadContent || lineBuffer.trim().length > 0) {
          fail(new Error("Workspace patch contains unsupported content before the first file section"));
          return;
        }
      } else {
        if (lineBuffer.length > 0 && classification !== null) {
          if (isChangedLine(lineBuffer)) sectionChangedLines += 1;
          if (classification !== "internal") {
            write(
              classification === "business" ? integrationStream : generatedStream,
              lineBuffer,
            );
          }
        }
        flushSection();
      }
      const exitCode = code ?? (signal ? 128 : 1);
      if (exitCode !== 0 && exitCode !== 1) {
        fail(new Error(`Unable to generate workspace patch: ${stderr.trim()}`));
        return;
      }
      let finished = 0;
      const done = (): void => {
        if (++finished === 3) {
          settled = true;
          resolve({
            business: toEvidence(artifacts.integrationDiff, businessAcc),
            generated: toEvidence(artifacts.generatedDiff, generatedAcc),
            integration: toEvidence(artifacts.integrationDiff, businessAcc),
          });
        }
      };
      rawStream.end(done);
      generatedStream.end(done);
      integrationStream.end(done);
    });
  });
}
