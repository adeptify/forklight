/**
 * Clean-user bundle plan and evidence core.
 *
 * Pure validators for destinations, artifact names, tar entries, build
 * identity, test summaries, and schemaVersion 1 evidence compatible with the
 * prior frozen clean-run bundle. Never runs subprocesses, touches
 * Keychain/Providers, or embeds absolute paths or credential values.
 */

import path from "node:path";
import {
  isBuildIdentity,
  type BuildIdentity,
} from "./build-identity.js";

const BUNDLE_EVIDENCE_SCHEMA_VERSION = 1 as const;

/** Closed relative artifact names published in a clean-run directory. */
export const BUNDLE_ARTIFACT_NAMES = Object.freeze({
  buildIdentity: "build-identity.json",
  runbook: "m1-clean-user-runbook.md",
  evidence: "bundle-evidence.json",
} as const);

const TARBALL_BASENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * Closed sensitive-filename policy. Basename only — never opens content and
 * never serializes matched names into public evidence.
 */
const SENSITIVE_FILENAME_BASENAME_RES: readonly RegExp[] = Object.freeze([
  /^\.env$/i,
  /^\.env\..+$/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /^\.pgpass$/i,
  /^id_rsa(\.pub)?$/i,
  /^id_ed25519(\.pub)?$/i,
  /^id_ecdsa(\.pub)?$/i,
  /^id_dsa(\.pub)?$/i,
  /\.pem$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.key$/i,
  /\.sqlite$/i,
  /\.sqlite3$/i,
  /\.db$/i,
  /^credentials(\.json)?$/i,
  /^secrets?(\.json)?$/i,
  /^auth(\.json)?$/i,
  /^settings\.json$/i,
  /^token(\.json)?$/i,
  /^api[-_]?keys?(\.json)?$/i,
  /^password/i,
  /^keychain/i,
  /^\.forklight$/i,
]);

/**
 * Explicit limits that must always appear — package checks ≠ clean user.
 * Field name `limits` matches the prior frozen schemaVersion 1 bundle.
 */
export const BUNDLE_EVIDENCE_LIMITS: readonly string[] = Object.freeze([
  "Package verification on the development machine is not a clean-user journey.",
  "First-time Keychain entry still requires a new macOS user, disposable VM, or new Mac.",
  "Main install, session restart, and comprehension still require a clean-user run.",
  "Fifteen-minute configuration and thirty-minute first-Task timing still require a clean-user run.",
]);

export type BundleFailureCategory =
  | "invalid-output"
  | "destination-exists"
  | "pack-failed"
  | "test-summary-unavailable"
  | "tarball-invalid"
  | "sensitive-package-entry"
  | "identity-unavailable"
  | "identity-mismatch"
  | "install-failed"
  | "cli-entry-failed"
  | "mcp-entry-failed"
  | "hub-lifecycle-failed"
  | "daemon-identity-mismatch"
  | "cleanup-failed"
  | "publish-failed"
  | "recursive-pack-refused";

export class BundleBuilderError extends Error {
  readonly category: BundleFailureCategory;

  constructor(category: BundleFailureCategory, message: string) {
    super(message);
    this.name = "BundleBuilderError";
    this.category = category;
  }
}

export interface BundlePlan {
  readonly outputDirectory: string;
  readonly stagingDirectory: string;
  readonly projectRoot: string;
  readonly runbookSourceRelative: string;
}

export interface NpmPackArtifact {
  readonly filename: string;
  readonly name?: string;
  readonly version?: string;
}

interface TestSummary {
  readonly testsPassed: number;
  readonly testsTotal: number;
}

export type TarEntryIssueCategory =
  | "absolute-path"
  | "path-traversal"
  | "sensitive-filename";

interface TarEntryScanResult {
  readonly ok: boolean;
  /** Bounded category only — never the offending path. */
  readonly issueCategory?: TarEntryIssueCategory;
  readonly entryCount: number;
}

export interface BundleCheckFact {
  readonly passed: boolean;
}

interface BundlePrepackCheck extends BundleCheckFact {
  readonly testsPassed: number;
  readonly testsTotal: number;
}

interface BundleHubDaemonCheck extends BundleCheckFact {
  readonly hubCurrent: boolean;
  readonly daemonIdentityMatch: boolean;
  readonly cleanShutdown: boolean;
}

/** Closed verification observations recorded in schemaVersion 1 evidence. */
export interface BundleVerification {
  readonly prepack: BundlePrepackCheck;
  readonly isolatedInstall: BundleCheckFact;
  readonly cliEntryLoad: BundleCheckFact;
  readonly mcpEntryLoad: BundleCheckFact;
  readonly installedBuildIdentityMatch: BundleCheckFact;
  readonly sensitiveFilenameScan: BundleCheckFact;
  readonly hubDaemonLifecycle: BundleHubDaemonCheck;
}

/** Exact public verification shape used by the frozen schemaVersion 1 bundle. */
interface BundleEvidenceVerification {
  readonly prepack: "passed";
  readonly testCount: number;
  readonly testPassed: number;
  readonly isolatedPrefixInstall: "passed";
  readonly installedIdentityMatchesTarball: true;
  readonly cliEntry: "passed";
  readonly mcpEntry: "passed";
  readonly installedHubStart: "passed";
  readonly installedHubStatus: "current";
  readonly installedDaemonBuildMatchesTarball: true;
  readonly installedStackCleanShutdown: "passed";
  readonly sensitiveFilenameScan: "passed";
}

/**
 * Prior frozen clean-run schemaVersion 1 evidence shape.
 * Compatible field names: status, createdAt, tarball.file, buildIdentity,
 * verification, limits.
 */
export interface BundleEvidence {
  readonly schemaVersion: 1;
  readonly status: "ready-for-clean-user-run";
  readonly createdAt: string;
  readonly tarball: {
    readonly file: string;
    readonly sha256: string;
  };
  readonly buildIdentity: BuildIdentity;
  readonly verification: BundleEvidenceVerification;
  readonly limits: readonly string[];
}

interface BuildBundleEvidenceInput {
  readonly createdAt: string;
  readonly tarballFileName: string;
  readonly tarballSha256: string;
  readonly buildIdentity: BuildIdentity;
  readonly verification: BundleVerification;
}

/** Parse `bundle:clean -- --output <dir>` style argv (after node/script). */
export function parseBundleOutputArgument(argv: readonly string[]): string {
  const args = [...argv];
  let output: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (token === "--output" || token === "-o") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new BundleBuilderError(
          "invalid-output",
          "bundle:clean requires --output <new-directory>",
        );
      }
      if (output !== undefined) {
        throw new BundleBuilderError(
          "invalid-output",
          "bundle:clean accepts exactly one --output directory",
        );
      }
      output = value;
      index += 1;
      continue;
    }
    if (token === "--") continue;
    throw new BundleBuilderError(
      "invalid-output",
      `Unknown bundle:clean argument: ${token}`,
    );
  }
  if (output === undefined || output.trim().length === 0) {
    throw new BundleBuilderError(
      "invalid-output",
      "bundle:clean requires an explicit new --output directory",
    );
  }
  return output;
}

export function isSafeTarballFileName(value: unknown): value is string {
  return typeof value === "string"
    && TARBALL_BASENAME_RE.test(value)
    && !value.includes("/")
    && !value.includes("\\")
    && !value.includes("..");
}

function isSafeRelativeArtifactName(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 180
    && !value.startsWith("/")
    && !value.includes("\\")
    && !value.includes("..")
    && !path.isAbsolute(value)
    && value === path.posix.basename(value);
}

/**
 * Validate an explicit destination and sibling staging name. Does not create
 * directories. Refuses an existing destination before any pack/install work.
 */
export function planCleanRunBundle(input: {
  readonly outputRequest: string;
  readonly projectRoot: string;
  readonly stagingSuffix: string;
  readonly destinationExists: boolean;
  /** When false, parent of the output path is missing or not a directory. */
  readonly parentDirectoryOk?: boolean;
}): BundlePlan {
  const outputRequest = input.outputRequest.trim();
  if (outputRequest.length === 0) {
    throw new BundleBuilderError(
      "invalid-output",
      "bundle:clean requires an explicit new --output directory",
    );
  }
  if (outputRequest.includes("\0")) {
    throw new BundleBuilderError("invalid-output", "output directory is invalid");
  }
  const outputDirectory = path.resolve(input.projectRoot, outputRequest);
  if (outputDirectory === path.resolve(input.projectRoot)) {
    throw new BundleBuilderError(
      "invalid-output",
      "output directory must not be the project root",
    );
  }
  if (input.parentDirectoryOk === false) {
    throw new BundleBuilderError(
      "invalid-output",
      "output parent directory is missing or not a directory",
    );
  }
  if (input.destinationExists) {
    throw new BundleBuilderError(
      "destination-exists",
      "output directory already exists; refuse overwrite",
    );
  }
  const suffix = input.stagingSuffix.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,64}$/.test(suffix)) {
    throw new BundleBuilderError("invalid-output", "staging suffix is invalid");
  }
  const parent = path.dirname(outputDirectory);
  const stagingDirectory = path.join(parent, `.forklight-clean-run-staging.${suffix}`);
  if (stagingDirectory === outputDirectory) {
    throw new BundleBuilderError("invalid-output", "staging directory collides with output");
  }
  return Object.freeze({
    outputDirectory,
    stagingDirectory,
    projectRoot: path.resolve(input.projectRoot),
    runbookSourceRelative: path.posix.join("docs", BUNDLE_ARTIFACT_NAMES.runbook),
  });
}

/**
 * Extract the final complete top-level JSON value (object or array), including
 * nested structures. The final npm pack result may follow JSON printed by
 * prepack tests. For equal end positions, the outermost candidate wins.
 */
export function extractTopLevelJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new BundleBuilderError("pack-failed", "npm pack did not return JSON");
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through for mixed prepack/pack streams.
  }

  let best: { readonly start: number; readonly end: number; readonly value: unknown } | undefined;
  for (let start = 0; start < trimmed.length; start += 1) {
    const opener = trimmed[start];
    if (opener !== "{" && opener !== "[") continue;

    let depth = 0;
    let inString = false;
    let escape = false;
    for (let index = start; index < trimmed.length; index += 1) {
      const ch = trimmed[index]!;
      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === "\\") {
          escape = true;
          continue;
        }
        if (ch === "\"") inString = false;
        continue;
      }
      if (ch === "\"") {
        inString = true;
        continue;
      }
      if (ch === "{" || ch === "[") {
        depth += 1;
        continue;
      }
      if (ch === "}" || ch === "]") {
        depth -= 1;
        if (depth === 0) {
          try {
            const value: unknown = JSON.parse(trimmed.slice(start, index + 1));
            if (
              best === undefined
              || index > best.end
              || (index === best.end && start < best.start)
            ) {
              best = { start, end: index, value };
            }
          } catch {
            // This opener did not begin a complete JSON value.
          }
          break;
        }
      }
    }
  }
  if (best !== undefined) return best.value;
  throw new BundleBuilderError("pack-failed", "npm pack did not return JSON");
}

/** Parse `npm pack --json` output into exactly one artifact filename. */
export function parseNpmPackJson(stdout: string): NpmPackArtifact {
  const parsed = extractTopLevelJson(stdout);
  const row = Array.isArray(parsed) ? parsed[0] : parsed;
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    throw new BundleBuilderError("pack-failed", "npm pack JSON shape is invalid");
  }
  const record = row as Record<string, unknown>;
  const filename = record.filename;
  if (!isSafeTarballFileName(filename)) {
    throw new BundleBuilderError("pack-failed", "npm pack filename is unsafe or missing");
  }
  const artifact: NpmPackArtifact = {
    filename,
    ...(typeof record.name === "string" ? { name: record.name } : {}),
    ...(typeof record.version === "string" ? { version: record.version } : {}),
  };
  return Object.freeze(artifact);
}

/**
 * Parse a single line form of the Node test summary (`# tests N` or `ℹ tests N`).
 * Returns the last complete triple so nested/fixture runs do not invent counts.
 */
function lastSummaryField(
  combinedOutput: string,
  field: "tests" | "pass" | "fail",
): number | undefined {
  // Support TAP `# tests N` and Node reporter `ℹ tests N` (info symbol U+2139).
  const pattern = new RegExp(
    `(?:^|\\n)(?:#|\\u2139)\\s*${field}\\s+(\\d+)\\s*(?:\\n|$)`,
    "g",
  );
  let last: number | undefined;
  for (const match of combinedOutput.matchAll(pattern)) {
    const value = Number(match[1]);
    if (Number.isSafeInteger(value) && value >= 0) last = value;
  }
  return last;
}

/**
 * Parse the authoritative Node test summary emitted by prepack/`npm test`.
 * Accepts both `#` and `ℹ` forms. Never invents counts when absent/inconsistent.
 */
export function parseTestSummary(combinedOutput: string): TestSummary {
  const testsTotal = lastSummaryField(combinedOutput, "tests");
  const testsPassed = lastSummaryField(combinedOutput, "pass");
  const testsFailed = lastSummaryField(combinedOutput, "fail") ?? 0;
  if (testsTotal === undefined || testsPassed === undefined) {
    throw new BundleBuilderError(
      "test-summary-unavailable",
      "prepack test summary is unavailable",
    );
  }
  if (
    testsPassed > testsTotal
    || testsFailed < 0
    || testsPassed + testsFailed > testsTotal
  ) {
    throw new BundleBuilderError(
      "test-summary-unavailable",
      "prepack test summary is inconsistent",
    );
  }
  if (testsFailed > 0 || testsPassed !== testsTotal) {
    throw new BundleBuilderError(
      "pack-failed",
      "prepack full check did not pass every test",
    );
  }
  return Object.freeze({ testsPassed, testsTotal });
}

function pathSegments(entry: string): string[] {
  return entry.replace(/\\/g, "/").split("/").filter((part) => part.length > 0);
}

export function isSensitiveFilename(basename: string): boolean {
  return SENSITIVE_FILENAME_BASENAME_RES.some((pattern) => pattern.test(basename));
}

/** Classify one tar entry; never returns the path in public evidence. */
export function classifyTarEntry(entry: string): TarEntryIssueCategory | undefined {
  if (entry.length === 0) return "absolute-path";
  const normalized = entry.replace(/\\/g, "/");
  if (
    normalized.startsWith("/")
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.startsWith("//")
  ) {
    return "absolute-path";
  }
  const segments = pathSegments(normalized);
  if (segments.some((segment) => segment === "..")) return "path-traversal";
  for (const segment of segments) {
    if (isSensitiveFilename(segment)) return "sensitive-filename";
  }
  return undefined;
}

export function scanTarEntries(entries: readonly string[]): TarEntryScanResult {
  if (!Array.isArray(entries)) {
    return Object.freeze({ ok: false, issueCategory: "absolute-path" as const, entryCount: 0 });
  }
  for (const entry of entries) {
    if (typeof entry !== "string") {
      return Object.freeze({
        ok: false,
        issueCategory: "absolute-path" as const,
        entryCount: entries.length,
      });
    }
    const issue = classifyTarEntry(entry);
    if (issue !== undefined) {
      return Object.freeze({
        ok: false,
        issueCategory: issue,
        entryCount: entries.length,
      });
    }
  }
  return Object.freeze({ ok: true, entryCount: entries.length });
}

export function buildIdentitiesEqual(
  left: BuildIdentity,
  right: BuildIdentity,
): boolean {
  return left.protocolVersion === right.protocolVersion
    && left.packageVersion === right.packageVersion
    && left.buildId === right.buildId
    && left.builtAt === right.builtAt
    && left.sourceRevision === right.sourceRevision
    && left.sourceDigest === right.sourceDigest;
}

export function requireBuildIdentity(value: unknown, label: string): BuildIdentity {
  if (!isBuildIdentity(value)) {
    throw new BundleBuilderError(
      "identity-unavailable",
      `${label} build identity is unavailable or malformed`,
    );
  }
  return Object.freeze({ ...value });
}

export function buildBundleEvidence(input: BuildBundleEvidenceInput): BundleEvidence {
  if (!isSafeTarballFileName(input.tarballFileName)) {
    throw new BundleBuilderError("tarball-invalid", "tarball file name is unsafe");
  }
  if (!SHA256_RE.test(input.tarballSha256)) {
    throw new BundleBuilderError("tarball-invalid", "tarball SHA-256 is invalid");
  }
  if (!ISO_RE.test(input.createdAt) || !Number.isFinite(Date.parse(input.createdAt))) {
    throw new BundleBuilderError("publish-failed", "evidence timestamp is invalid");
  }
  const identity = requireBuildIdentity(input.buildIdentity, "packaged");
  const verification = input.verification;
  const requiredPassed = [
    verification.prepack.passed,
    verification.isolatedInstall.passed,
    verification.cliEntryLoad.passed,
    verification.mcpEntryLoad.passed,
    verification.installedBuildIdentityMatch.passed,
    verification.sensitiveFilenameScan.passed,
    verification.hubDaemonLifecycle.passed,
    verification.hubDaemonLifecycle.hubCurrent,
    verification.hubDaemonLifecycle.daemonIdentityMatch,
    verification.hubDaemonLifecycle.cleanShutdown,
  ];
  if (requiredPassed.some((value) => value !== true)) {
    throw new BundleBuilderError(
      "publish-failed",
      "evidence requires every verification fact to pass",
    );
  }
  if (
    !Number.isSafeInteger(verification.prepack.testsPassed)
    || !Number.isSafeInteger(verification.prepack.testsTotal)
    || verification.prepack.testsPassed !== verification.prepack.testsTotal
    || verification.prepack.testsTotal < 0
  ) {
    throw new BundleBuilderError(
      "test-summary-unavailable",
      "evidence test counts are inconsistent",
    );
  }

  const evidence: BundleEvidence = {
    schemaVersion: BUNDLE_EVIDENCE_SCHEMA_VERSION,
    status: "ready-for-clean-user-run",
    createdAt: input.createdAt,
    tarball: {
      file: input.tarballFileName,
      sha256: input.tarballSha256,
    },
    buildIdentity: identity,
    verification: {
      prepack: "passed",
      testCount: verification.prepack.testsTotal,
      testPassed: verification.prepack.testsPassed,
      isolatedPrefixInstall: "passed",
      installedIdentityMatchesTarball: true,
      cliEntry: "passed",
      mcpEntry: "passed",
      installedHubStart: "passed",
      installedHubStatus: "current",
      installedDaemonBuildMatchesTarball: true,
      installedStackCleanShutdown: "passed",
      sensitiveFilenameScan: "passed",
    },
    limits: [...BUNDLE_EVIDENCE_LIMITS],
  };
  assertEvidencePrivacy(evidence);
  return Object.freeze(evidence) as BundleEvidence;
}

/** Fail closed if evidence embeds absolute paths or credential-like keys. */
function assertEvidencePrivacy(evidence: BundleEvidence): void {
  const serialized = JSON.stringify(evidence);
  if (
    serialized.includes("/Users/")
    || serialized.includes("/home/")
    || serialized.includes("\\\\")
    || /[A-Za-z]:\\/.test(serialized)
  ) {
    throw new BundleBuilderError(
      "publish-failed",
      "evidence must not embed absolute paths",
    );
  }
  if (
    /"(token|nonce|password|apiKey|api_key|authorization|FORKLIGHT_HOME|PATH)"\s*:/i
      .test(serialized)
  ) {
    throw new BundleBuilderError(
      "publish-failed",
      "evidence must not embed credentials or environment material",
    );
  }
  if (!isSafeRelativeArtifactName(evidence.tarball.file)) {
    throw new BundleBuilderError(
      "publish-failed",
      "evidence tarball name must be a relative basename only",
    );
  }
  if (evidence.limits.length < BUNDLE_EVIDENCE_LIMITS.length) {
    throw new BundleBuilderError(
      "publish-failed",
      "evidence must retain explicit clean-user limits",
    );
  }
  for (const required of BUNDLE_EVIDENCE_LIMITS) {
    if (!evidence.limits.includes(required)) {
      throw new BundleBuilderError(
        "publish-failed",
        "evidence limits omit a required clean-user boundary",
      );
    }
  }
}

export function isBundleEvidence(value: unknown): value is BundleEvidence {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<BundleEvidence>;
  if (candidate.schemaVersion !== 1) return false;
  if (candidate.status !== "ready-for-clean-user-run") return false;
  if (typeof candidate.createdAt !== "string" || !ISO_RE.test(candidate.createdAt)) {
    return false;
  }
  if (
    candidate.tarball === null
    || typeof candidate.tarball !== "object"
    || !isSafeTarballFileName(candidate.tarball.file)
    || !SHA256_RE.test(candidate.tarball.sha256)
  ) {
    return false;
  }
  if (!isBuildIdentity(candidate.buildIdentity)) return false;
  if (candidate.verification === null || typeof candidate.verification !== "object") {
    return false;
  }
  const verification = candidate.verification;
  if (
    verification.prepack !== "passed"
    || !Number.isSafeInteger(verification.testCount)
    || !Number.isSafeInteger(verification.testPassed)
    || verification.testCount !== verification.testPassed
    || verification.isolatedPrefixInstall !== "passed"
    || verification.installedIdentityMatchesTarball !== true
    || verification.cliEntry !== "passed"
    || verification.mcpEntry !== "passed"
    || verification.installedHubStart !== "passed"
    || verification.installedHubStatus !== "current"
    || verification.installedDaemonBuildMatchesTarball !== true
    || verification.installedStackCleanShutdown !== "passed"
    || verification.sensitiveFilenameScan !== "passed"
  ) {
    return false;
  }
  if (!Array.isArray(candidate.limits) || candidate.limits.length === 0) {
    return false;
  }
  return candidate.limits.every((line) => typeof line === "string" && line.length > 0);
}

/**
 * Refuse running the real pack path under `npm test` to prevent recursive
 * prepack → test → pack loops. Fixture-driven unit tests inject seams instead.
 */
export function assertNotRunningInsideNpmTest(env: NodeJS.ProcessEnv = process.env): void {
  if (env.npm_lifecycle_event === "test" || env.npm_command === "test") {
    throw new BundleBuilderError(
      "recursive-pack-refused",
      "clean-run bundle builder refuses to run under npm test; use injected seams",
    );
  }
}

/** Scrub POSIX and Windows absolute paths from bounded public failure text. */
export function scrubAbsolutePaths(text: string): string {
  return text
    .replace(/[A-Za-z]:\\[^\s"'`]+/g, "[path]")
    .replace(/\\\\[^\s"'`]+/g, "[path]")
    .replace(/\/(?:Users|home|var|tmp|private|opt|Volumes|Library)\/[^\s"'`]+/g, "[path]")
    .replace(/(^|[\s="'(:])(\/(?:[^/\s"'`]+\/)+[^/\s"'`]+)/g, "$1[path]");
}

/** Bounded public error line — category plus short cause, no paths or dumps. */
export function formatBundleFailure(error: unknown): string {
  if (error instanceof BundleBuilderError) {
    return scrubAbsolutePaths(
      `clean-run bundle failed (${error.category}): ${error.message}`,
    );
  }
  if (error instanceof Error && error.message.length > 0 && error.message.length <= 240) {
    return scrubAbsolutePaths(`clean-run bundle failed: ${error.message}`);
  }
  return "clean-run bundle failed: unexpected error";
}
