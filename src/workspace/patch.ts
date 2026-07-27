import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import type { WriteStream } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import path from "node:path";
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

export async function writeWorkspacePatchReport(
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
