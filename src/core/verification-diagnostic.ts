/**
 * Canonical bounded sanitizer for failed independent-verification diagnostics.
 *
 * Finite same-session Worker repair receives only this envelope — never the
 * raw verifier stream. The envelope keeps command identity, exit status, and
 * useful file/line/error lines; it excludes passing output, prompts, secrets,
 * broad logs, absolute private paths, and excessive text.
 *
 * Credential handling is aggressive: Authorization Bearer sequences (label,
 * value, and any suffix) are removed completely, and arbitrarily long
 * credential values following known keys are removed, so a leaked token never
 * reaches the Worker prompt or the durable repair authorization.
 */

import type { VerificationResult } from "./types.js";

export const VERIFICATION_DIAGNOSTIC_MAX_COMMAND_LENGTH = 200;
export const VERIFICATION_DIAGNOSTIC_MAX_LINES_PER_COMMAND = 12;
export const VERIFICATION_DIAGNOSTIC_MAX_LINE_LENGTH = 240;
export const VERIFICATION_DIAGNOSTIC_MAX_TOTAL_CHARS = 6_000;

/** One failed command's bounded, sanitized excerpt. */
export interface FailedCommandDiagnostic {
  command: string;
  exitCode: number;
  timedOut: boolean;
  lines: string[];
  omittedLineCount: number;
}

const FILE_LINE_PATTERN =
  /(?:^|[\s("'])([A-Za-z0-9_./\\~-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|cpp|h|hpp|kt|swift|rb|php|vue|svelte|css|scss|json|ya?ml|md)):\d+(?::\d+)?/;

const ERROR_HINT_PATTERN =
  /\b(?:error|failed|exception|throw|warning)\b|TS\d{2,}|E\d{3,}|Cannot (?:find|read)|is not (?:a function|defined)|undefined is not|SyntaxError|TypeError|ReferenceError|RangeError/i;

/**
 * Explicit passing-test/command markers. Rejected before headline or
 * file/error matching so a passing title can never displace real failure
 * evidence (e.g. `✔ provider×runtime pairing fail-closed`). Failing markers
 * such as `✖` are intentionally NOT matched here.
 */
const PASS_LINE_PATTERN =
  /(?:^|[\s(])[✔✓]|(?:^|[\s(])(?:pass(?:ed|ing)?|ok|success(?:ful)?|succeeded|all green|green|no failures|no errors? found)(?:$|[\s,.:;)]|!)/i;

const PROMPT_PATTERN = /^\s*(?:[$#>]|\d+\))/;

const FILE_EXTENSIONS =
  "(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|cpp|h|hpp|kt|swift|rb|php|vue|svelte|css|scss|json|ya?ml|md)";

/** Remove Authorization Bearer and arbitrarily long credential values. */
export function redactCredentialSequences(text: string): string {
  let result = text;
  // Whole-sequence removal for Authorization Bearer headers and inline tokens:
  // the label, the value, and any suffix are removed completely.
  result = result.replace(
    /authorization\s*[:=]\s*bearer\s+[^\s,;'"`)}]+/gi,
    "[REDACTED]",
  );
  // Any remaining bare Bearer token is bounded to a single marker.
  result = result.replace(
    /\bbearer\s+[^\s,;'"`)}]+/gi,
    "Bearer [REDACTED]",
  );
  // Credential key/value pairs: keep the bounded key label, remove the value.
  result = result.replace(
    /\b(api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd|client[_-]?secret|private[_-]?key)\s*[:=]\s*[^\s,;'"`)}]+/gi,
    "$1=[REDACTED]",
  );
  // Space-separated credential CLI flags (e.g. `--token sk-...`): keep the
  // bounded flag label, remove the value so arbitrary-length tokens never leak.
  result = result.replace(
    /(^|\s)(--?(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd|client[_-]?secret|private[_-]?key))\b(?:\s*[=:]\s*|\s+)[^\s,;'"`)}]+/gi,
    "$1$2=[REDACTED]",
  );
  return result;
}

/**
 * Exclude absolute private paths. A known workspace root is collapsed to a
 * workspace-relative path; any remaining absolute file:line reference is
 * reduced to its bounded relative file:line anchor.
 */
export function redactPrivatePaths(text: string, workspaceRoot?: string): string {
  let result = text;
  if (workspaceRoot !== undefined && workspaceRoot.length > 0) {
    result = result.split(workspaceRoot).join("");
    // The workspace root carries no trailing separator; collapse the leftover
    // leading slash so a stripped absolute path becomes workspace-relative.
    result = result.replace(/^\//, "");
  }
  // Reduce only ABSOLUTE file:line references (leading path not preceded by a
  // path character) to their bounded relative file:line anchor. Relative paths
  // such as `src/foo.ts:3` are preserved intact.
  result = result.replace(
    new RegExp(`(?<![\\w./~-])\\/(?:[^\\s:;,)'"]+\\/)*([A-Za-z0-9_.-]+\\.${FILE_EXTENSIONS}:\\d+(?::\\d+)?)`, "g"),
    (_match, anchor: string) => anchor,
  );
  return result;
}

function isDiagnosticLine(line: string): boolean {
  if (line.length === 0) return false;
  if (PROMPT_PATTERN.test(line)) return false;
  if (PASS_LINE_PATTERN.test(line)) return false;
  return FILE_LINE_PATTERN.test(line) || ERROR_HINT_PATTERN.test(line);
}

function collectUsefulLines(output: string, workspaceRoot?: string): {
  lines: string[];
  omitted: number;
} {
  const rawLines = output.split(/\r?\n/);
  const kept: string[] = [];
  const nonEmpty = rawLines
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  // The headline (first non-empty line) is kept only when it is neither a
  // prompt nor an explicit pass line.
  const headline = nonEmpty[0];
  if (
    headline !== undefined
    && !PROMPT_PATTERN.test(headline)
    && !PASS_LINE_PATTERN.test(headline)
  ) {
    kept.push(redactCredentialSequences(redactPrivatePaths(headline, workspaceRoot)));
  }
  for (const line of nonEmpty.slice(1)) {
    if (!isDiagnosticLine(line)) continue;
    const sanitized = redactCredentialSequences(redactPrivatePaths(line, workspaceRoot));
    if (sanitized.length === 0) continue;
    kept.push(sanitized);
    if (kept.length >= VERIFICATION_DIAGNOSTIC_MAX_LINES_PER_COMMAND) break;
  }
  const bounded = kept.map((line) =>
    line.length <= VERIFICATION_DIAGNOSTIC_MAX_LINE_LENGTH
      ? line
      : `${line.slice(0, VERIFICATION_DIAGNOSTIC_MAX_LINE_LENGTH)}…`);
  const omitted = Math.max(0, nonEmpty.length - bounded.length);
  return { lines: bounded, omitted };
}

/**
 * Build the bounded sanitized diagnostic envelope for failing verification
 * commands only. Passing commands contribute nothing.
 */
export function sanitizeFailedVerificationDiagnostics(
  verification: VerificationResult,
  options: { workspaceRoot?: string } = {},
): FailedCommandDiagnostic[] {
  const diagnostics: FailedCommandDiagnostic[] = [];
  let totalChars = 0;

  const failing = verification.commands.filter(
    (command) => command.exitCode !== 0 || command.timedOut,
  );
  for (const command of failing) {
    const commandText = redactCredentialSequences(command.command);
    const boundedCommand = commandText.length <= VERIFICATION_DIAGNOSTIC_MAX_COMMAND_LENGTH
      ? commandText
      : `${commandText.slice(0, VERIFICATION_DIAGNOSTIC_MAX_COMMAND_LENGTH)}…`;

    // Prefer stderr for diagnostics; use stdout only when stderr has nothing.
    const stderrCollection = collectUsefulLines(command.stderr, options.workspaceRoot);
    const stdoutCollection = stderrCollection.lines.length > 0
      ? stderrCollection
      : collectUsefulLines(command.stdout, options.workspaceRoot);

    const diagnostic: FailedCommandDiagnostic = {
      command: boundedCommand,
      exitCode: command.exitCode,
      timedOut: command.timedOut,
      lines: stdoutCollection.lines,
      omittedLineCount: stdoutCollection.omitted,
    };

    const chars = boundedCommand.length
      + diagnostic.lines.reduce((sum, line) => sum + line.length, 0);
    if (totalChars + chars > VERIFICATION_DIAGNOSTIC_MAX_TOTAL_CHARS && diagnostics.length > 0) {
      break;
    }
    totalChars += chars;
    diagnostics.push(diagnostic);
  }
  return diagnostics;
}

/** Render the sanitized envelope as bounded repair feedback text. */
export function formatVerificationDiagnostics(
  diagnostics: readonly FailedCommandDiagnostic[],
): string {
  const blocks = diagnostics.map((diagnostic) => {
    const lines = diagnostic.lines.length > 0
      ? diagnostic.lines.map((line) => `  ${line}`)
      : ["  (no useful diagnostic lines in failing output)"];
    const omitted = diagnostic.omittedLineCount > 0
      ? `\n  … ${diagnostic.omittedLineCount} line(s) omitted`
      : "";
    return [
      `Command: ${diagnostic.command}`,
      `Exit code: ${diagnostic.exitCode}${diagnostic.timedOut ? " (timed out)" : ""}`,
      ...lines,
      ...(omitted === "" ? [] : [omitted]),
    ].join("\n");
  });
  return blocks.join("\n\n").slice(0, VERIFICATION_DIAGNOSTIC_MAX_TOTAL_CHARS);
}
