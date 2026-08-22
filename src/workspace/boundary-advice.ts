/**
 * Privacy-safe pre-launch workspace boundary advice.
 *
 * One canonical read-only assessor that asks local Git for ignored directory
 * roots in the resolved Task project, classifies each root through the existing
 * Task PathPolicy, and reports only bounded counts plus one closed next action.
 *
 * Shared by CLI validate, daemon/MCP validate_file, and the Hub submit preview
 * so no surface ever re-derives the workspace boundary or duplicates Core
 * inference.
 *
 * The projection never returns paths, names, Git output, commands, diagnostics,
 * or file content. Non-Git projects, command failure, timeout, truncation,
 * malformed output, and unsafe counts all fail closed to `unavailable`; a
 * partial scan is never presented as a complete `clear` state. The result is a
 * detached, deeply frozen, time-point hint that never enters the preview
 * revision digest and never changes admission authority.
 */

import { runCaptured, type CapturedProcess } from "../core/process.js";
import type { PathPolicy } from "./path-policy.js";
import { deepFreeze } from "../core/immutability.js";

/** Closed check state shared by CLI, daemon/MCP and Hub. */
export type WorkspaceBoundaryStatus = "clear" | "review" | "unavailable";

/** Closed availability reason. Never contains Git stderr or diagnostics. */
export type WorkspaceBoundaryReason =
  | "checked"
  | "not-git"
  | "command-failed"
  | "timed-out"
  | "output-truncated"
  | "malformed-output"
  | "unsafe-count";

/** Closed next-action code derived from the current state. */
type WorkspaceBoundaryNextAction =
  | "continue"
  | "review-workspace-boundaries"
  | "manual-review";

/** Safe workspace-boundary advice shared by CLI, daemon, MCP and Hub. */
export interface WorkspaceBoundaryAdvice {
  status: WorkspaceBoundaryStatus;
  /** Number of directory roots Git explicitly reported as ignored. */
  ignoredDirectoryRootCount: number;
  /** Roots already covered by snapshot exclusion, built-in generated
   *  patterns, Task generatedPaths, or the internal ForkLight path. */
  coveredCount: number;
  /** Roots still classified default-business — they enter the Worker as
   *  ordinary source and are the only reason to review. */
  visibleBusinessCount: number;
  /** Closed availability reason; `checked` when the scan succeeded. */
  reason: WorkspaceBoundaryReason;
  /** Closed next action. */
  nextAction: WorkspaceBoundaryNextAction;
}

/** Fixed bounded Git ignored-roots query timeout. */
const GIT_IGNORED_QUERY_TIMEOUT_MS = 3_000;

/** Bounded cap for parsed ignored directory roots. Higher counts fail closed
 *  so an unbounded ignored tree can never be summarized as a complete scan. */
export const MAX_IGNORED_DIRECTORY_ROOTS = 200;

/** Bounded cap for total Git output entries before the scan is treated as
 *  unbounded and fails closed. */
const MAX_IGNORED_ENTRIES = 2_000;

/** Injectable process runner seam for deterministic failure tests. */
export type GitIgnoredQueryRunner = (
  projectDir: string,
  options: { timeoutMs: number },
) => Promise<CapturedProcess>;

/**
 * Default runner: one fixed read-only, directory-only Git query.
 *
 * `git ls-files --others --ignored --exclude-standard --directory` lists every
 * ignored path, collapsing an entirely-ignored directory to one entry ending in
 * `/`. Unlike `git status --ignored`, it descends into untracked-but-not-ignored
 * parents, so an ignored directory root hidden inside a collapsed `?? dir/`
 * status entry is still reported. Never reads file content.
 */
function runDefaultGitIgnoredQuery(
  projectDir: string,
  options: { timeoutMs: number },
): Promise<CapturedProcess> {
  return runCaptured(
    "git",
    ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"],
    { cwd: projectDir, timeoutMs: options.timeoutMs },
  );
}

type IgnoredDirectoryRootParseResult =
  | { kind: "ok"; roots: string[] }
  | { kind: "truncated" }
  | { kind: "unsafe-count" }
  | { kind: "malformed" };

/**
 * Parse NUL-separated `git ls-files -z --directory` output: an entry ending in
 * `/` is a directory root Git explicitly reported as ignored; any other entry
 * is an ignored single file and never fabricates directory risk. Quoted,
 * escaped, absolute, or `..`-containing entries fail closed as malformed so a
 * partial or ambiguous scan is never presented as complete.
 */
export function parseIgnoredDirectoryRoots(stdout: string): IgnoredDirectoryRootParseResult {
  if (stdout.includes("[output truncated by ForkLight]")) return { kind: "truncated" };
  const entries = stdout.split("\0");
  if (entries.length > MAX_IGNORED_ENTRIES) return { kind: "unsafe-count" };
  const roots: string[] = [];
  for (const entry of entries) {
    if (entry.length === 0) continue;
    // `-z` never quotes; a quoted or backslash-escaped entry cannot be a
    // reliable directory root, so fail closed rather than risk a false clear.
    if (entry.includes("\"") || entry.includes("\\")) return { kind: "malformed" };
    const name = entry.replace(/\/+$/, "");
    if (name === entry) continue; // ignored file, not a directory root
    // A root outside the project (absolute, or a `..` segment from running in a
    // repo subdirectory) cannot be classified against the Task PathPolicy, so
    // fail closed instead of inventing a false review signal.
    if (
      name.length === 0
      || name === "."
      || name === ".."
      || name.startsWith("/")
      || name.split("/").includes("..")
    ) {
      return { kind: "malformed" };
    }
    roots.push(name);
  }
  // `--directory` can also report an untracked parent container when every
  // visible child beneath it is ignored (for example both `out/` and
  // `out/build/` for an ignore rule matching only `build/`).  Such a parent is
  // not itself an ignored root.  Keep the deepest explicitly reported roots
  // and discard only their reported ancestors; a wholly ignored directory is
  // already collapsed by Git to one entry and is therefore preserved.
  const uniqueRoots = [...new Set(roots)];
  const ignoredRoots = uniqueRoots.filter((candidate) =>
    !uniqueRoots.some((other) =>
      other !== candidate && other.startsWith(`${candidate}/`),
    ),
  );
  if (ignoredRoots.length > MAX_IGNORED_DIRECTORY_ROOTS) return { kind: "unsafe-count" };
  return { kind: "ok", roots: ignoredRoots };
}

/** Freeze every object and array in the result graph so no caller can mutate a
 *  shared detached projection. */
function unavailable(reason: WorkspaceBoundaryReason): WorkspaceBoundaryAdvice {
  return deepFreeze({
    status: "unavailable",
    ignoredDirectoryRootCount: 0,
    coveredCount: 0,
    visibleBusinessCount: 0,
    reason,
    nextAction: "manual-review",
  });
}

/**
 * A root is covered when the existing PathPolicy classifies the root itself or
 * its directory subtree as non-business. Two synthetic descendants distinguish
 * directory-subtree patterns such as `dist/**` from partial patterns such as
 * `dist/*`, `dist/*.js`, or directory-entry-only patterns. Excluded segments
 * and the internal ForkLight path cover the root through the bare-path
 * classification exactly as PathPolicy does today.
 */
function isCoveredRoot(policy: PathPolicy, root: string): boolean {
  if (policy.explain(root).category !== "business") return true;
  return policy.explain(`${root}/forklight_boundary_probe`).category !== "business"
    && policy.explain(`${root}/forklight_boundary_probe/nested`).category !== "business";
}

/**
 * Assess one live workspace boundary. Read-only and fail-closed: runs the fixed
 * bounded directory-only Git ignored-roots query, classifies every returned
 * directory root through the existing PathPolicy (including its subtree), and
 * returns only bounded counts plus one closed next action. Never returns paths,
 * names, Git output, commands, diagnostics, or file content, and never mutates
 * anything.
 */
export async function assessWorkspaceBoundary(input: {
  projectDir: string;
  policy: PathPolicy;
  run?: GitIgnoredQueryRunner;
}): Promise<WorkspaceBoundaryAdvice> {
  const runGit = input.run ?? runDefaultGitIgnoredQuery;
  let captured: CapturedProcess;
  try {
    captured = await runGit(input.projectDir, { timeoutMs: GIT_IGNORED_QUERY_TIMEOUT_MS });
  } catch {
    return unavailable("command-failed");
  }
  if (captured.timedOut) return unavailable("timed-out");
  if (captured.exitCode !== 0) {
    return unavailable(
      /not a git repository/i.test(captured.stderr) ? "not-git" : "command-failed",
    );
  }
  const parsed = parseIgnoredDirectoryRoots(captured.stdout);
  if (parsed.kind === "truncated") return unavailable("output-truncated");
  if (parsed.kind === "unsafe-count") return unavailable("unsafe-count");
  if (parsed.kind === "malformed") return unavailable("malformed-output");
  const roots = parsed.roots;
  let covered = 0;
  let visible = 0;
  for (const root of roots) {
    if (isCoveredRoot(input.policy, root)) {
      covered += 1;
    } else {
      visible += 1;
    }
  }
  const observed = roots.length;
  const status: WorkspaceBoundaryStatus = visible > 0 ? "review" : "clear";
  return deepFreeze({
    status,
    ignoredDirectoryRootCount: observed,
    coveredCount: covered,
    visibleBusinessCount: visible,
    reason: "checked",
    nextAction: status === "review" ? "review-workspace-boundaries" : "continue",
  });
}

/** Closed manual-review fallback used for legacy, unknown, or malformed advice
 *  on the CLI so a missing or corrupt payload can never be presented as clear. */
const MANUAL_REVIEW_LINES = [
  "Workspace boundary:",
  "  Workspace boundary could not be checked this time.",
  "  Manually confirm workspace boundaries before launching.",
  "  Next action: manual-review",
];

function boundedCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function isClosedAdviceRecord(record: Record<string, unknown>): record is Record<string, unknown> & {
  status: WorkspaceBoundaryStatus;
  ignoredDirectoryRootCount: number;
  coveredCount: number;
  visibleBusinessCount: number;
} {
  const observed = boundedCount(record.ignoredDirectoryRootCount);
  const covered = boundedCount(record.coveredCount);
  const visible = boundedCount(record.visibleBusinessCount);
  if (observed === null || covered === null || visible === null) return false;
  if (!Number.isSafeInteger(covered + visible) || observed !== covered + visible) return false;
  if (record.status === "clear") {
    return visible === 0 && record.reason === "checked" && record.nextAction === "continue";
  }
  if (record.status === "review") {
    return visible > 0
      && record.reason === "checked"
      && record.nextAction === "review-workspace-boundaries";
  }
  if (record.status === "unavailable") {
    return observed === 0
      && covered === 0
      && visible === 0
      && record.reason !== "checked"
      && [
        "not-git",
        "command-failed",
        "timed-out",
        "output-truncated",
        "malformed-output",
        "unsafe-count",
      ].includes(String(record.reason))
      && record.nextAction === "manual-review";
  }
  return false;
}

/**
 * Concise CLI lines for the safe workspace-boundary advice. Closed codes and
 * counts only — never paths, names, Git output, or diagnostics. Legacy (missing
 * field), unknown status, or malformed counts fail closed to a bounded
 * manual-review fallback; raw advice content is never echoed.
 */
export function formatWorkspaceBoundaryAdviceHuman(advice: unknown): string {
  if (advice === null || typeof advice !== "object") return MANUAL_REVIEW_LINES.join("\n");
  const record = advice as Record<string, unknown>;
  if (!isClosedAdviceRecord(record)) {
    return MANUAL_REVIEW_LINES.join("\n");
  }
  const status = record.status;
  const observed = record.ignoredDirectoryRootCount;
  const covered = record.coveredCount;
  const visible = record.visibleBusinessCount;
  const lines: string[] = ["Workspace boundary:"];
  switch (status) {
    case "clear":
      lines.push(
        "  No Git-ignored directory roots would enter the Worker as ordinary source.",
      );
      lines.push(
        "  (This does not claim future Worker output will stay generated.)",
      );
      lines.push("  Next action: continue");
      break;
    case "review":
      lines.push(
        `  ${visible} Git-ignored directory root(s) would still enter the Worker`
        + " as ordinary source",
      );
      lines.push(
        `  (${observed} observed, ${covered} covered by`
        + " workspace.exclude/generatedPaths)",
      );
      lines.push(
        "  Git ignore does not prove generated output. Check workspace.exclude and",
      );
      lines.push(
        "  workspace.generatedPaths before deciding to continue.",
      );
      lines.push("  Next action: review-workspace-boundaries");
      break;
    case "unavailable":
      lines.push("  Workspace boundary could not be checked this time.");
      lines.push("  Manually confirm workspace boundaries before launching.");
      lines.push("  Next action: manual-review");
      break;
  }
  return lines.join("\n");
}
