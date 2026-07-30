/**
 * Isolated clean-run bundle verification runner and atomic publisher.
 *
 * Packs into private staging, verifies from an isolated install + FORKLIGHT_HOME,
 * records external schemaVersion 1 evidence, and renames staging to the explicit
 * destination only after every check passes.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNotRunningInsideNpmTest,
  BUNDLE_ARTIFACT_NAMES,
  BundleBuilderError,
  buildBundleEvidence,
  buildIdentitiesEqual,
  extractTopLevelJson,
  formatBundleFailure,
  parseBundleOutputArgument,
  parseNpmPackJson,
  parseTestSummary,
  planCleanRunBundle,
  requireBuildIdentity,
  scanTarEntries,
  type BundleEvidence,
  type BundlePlan,
  type BundleVerification,
} from "../core/clean-run-bundle.js";
import { isBuildIdentity, type BuildIdentity } from "../core/build-identity.js";
import { runCaptured, type CapturedProcess } from "../core/process.js";
import { sleepMs } from "../core/time.js";

const PACK_TIMEOUT_MS = 60 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const ENTRY_TIMEOUT_MS = 60_000;
const HUB_STARTUP_TIMEOUT_MS = 30_000;
const COMMAND_TIMEOUT_MS = 60_000;
const CLEANUP_WAIT_MS = 10_000;
const MCP_HANDSHAKE_TIMEOUT_MS = 30_000;
const IDENTITY_TAR_PATH = "package/dist/build-identity.json";

const CREDENTIAL_ENV_RE = /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTHORIZATION|AUTH|API[_-]?KEY|DEEPSEEK|OPENAI|ANTHROPIC|MINIMAX|VOLCENGINE|GROK|XAI|AWS_|AZURE|GCP_)/i;

export interface CommandSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
}

export interface BundleCommandRunner {
  (spec: CommandSpec): Promise<CapturedProcess>;
}

export interface BundleFileSystem {
  readonly existsSync: (target: string) => boolean;
  readonly mkdirSync: (
    target: string,
    options?: { recursive?: boolean; mode?: number },
  ) => void;
  readonly rmSync: (
    target: string,
    options?: { recursive?: boolean; force?: boolean },
  ) => void;
  readonly renameSync: (from: string, to: string) => void;
  readonly copyFileSync: (from: string, to: string) => void;
  readonly readFileSync: (target: string, encoding: "utf8") => string;
  readonly writeFileSync: (
    target: string,
    contents: string,
    options?: { mode?: number },
  ) => void;
  readonly statSync: (target: string) => { isDirectory(): boolean; isFile(): boolean };
  readonly hashFile: (target: string) => Promise<string>;
}

export interface BundleProcessControl {
  readonly alive: (pid: number) => boolean;
  readonly signal: (pid: number, signal: NodeJS.Signals) => void;
  readonly sleep: (ms: number) => Promise<void>;
  /** Bounded wait while proving an exact PID exited. Tests may shorten. */
  readonly cleanupWaitMs?: number;
}

export interface McpHandshakeRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly timeoutMs: number;
}

export interface McpHandshakeResult {
  readonly ok: boolean;
  readonly toolCount?: number;
}

export interface BundleBuilderHooks {
  readonly runCommand: BundleCommandRunner;
  readonly fs: BundleFileSystem;
  readonly processControl: BundleProcessControl;
  readonly nowIso: () => string;
  readonly randomSuffix: () => string;
  /** Production: real stdio initialize + tools/list. Tests inject fixtures. */
  readonly handshakeMcp: (request: McpHandshakeRequest) => Promise<McpHandshakeResult>;
  /** When true, skip the npm-test recursion guard (fixture unit tests only). */
  readonly allowUnderNpmTest?: boolean;
}

export interface BuildCleanRunBundleOptions {
  readonly argv: readonly string[];
  readonly projectRoot: string;
  readonly hooks?: Partial<BundleBuilderHooks>;
}

export interface BuildCleanRunBundleResult {
  readonly outputDirectory: string;
  readonly evidence: BundleEvidence;
}

interface OwnedCleanup {
  hubPid?: number | undefined;
  daemonPid?: number | undefined;
  daemonStopHome?: string | undefined;
  prefixDir?: string | undefined;
}

function defaultHashFile(target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(target);
    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/** Strip Provider/API credentials; keep only a minimal system + npm isolation env. */
export function buildMinimalIsolatedEnv(input: {
  readonly workDir: string;
  readonly forklightHome?: string;
  readonly baseEnv?: NodeJS.ProcessEnv;
  /** Keep only the OS home for the authoritative prepack readiness tests. */
  readonly preserveOperatorHome?: boolean;
}): NodeJS.ProcessEnv {
  const base = input.baseEnv ?? process.env;
  const npmHome = path.join(input.workDir, "npm-home");
  const npmCache = path.join(input.workDir, "npm-cache");
  const processHome = input.preserveOperatorHome === true
    && typeof base.HOME === "string"
    && base.HOME.length > 0
    ? base.HOME
    : npmHome;
  const env: NodeJS.ProcessEnv = {
    PATH: base.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: processHome,
    USERPROFILE: processHome,
    npm_config_cache: npmCache,
    npm_config_userconfig: path.join(npmHome, ".npmrc"),
    npm_config_prefix: path.join(input.workDir, "npm-global-prefix"),
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
    npm_config_audit: "false",
  };
  for (const key of ["TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TERM", "USER", "LOGNAME", "SHELL"] as const) {
    const value = base[key];
    if (typeof value === "string" && value.length > 0 && !CREDENTIAL_ENV_RE.test(key)) {
      env[key] = value;
    }
  }
  if (input.forklightHome !== undefined) {
    env.FORKLIGHT_HOME = input.forklightHome;
  }
  return env;
}

/**
 * Production MCP handshake: launch the exact installed entry over stdio,
 * initialize, list tools, and close cleanly. No long-lived server left behind.
 */
export async function defaultMcpHandshake(
  request: McpHandshakeRequest,
): Promise<McpHandshakeResult> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

  const cleanEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.env)) {
    if (typeof value === "string") cleanEnv[key] = value;
  }

  const transport = new StdioClientTransport({
    command: request.executable,
    args: [...request.args],
    env: cleanEnv,
    cwd: request.cwd,
    stderr: "ignore",
  });
  const client = new Client({
    name: "forklight-clean-run-bundle",
    version: "0.2.0",
  });

  let settled = false;
  const timeout = setTimeout(() => {
    if (!settled) {
      void client.close().catch(() => undefined);
    }
  }, request.timeoutMs);
  timeout.unref?.();

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const toolCount = Array.isArray(listed.tools) ? listed.tools.length : 0;
    if (toolCount < 1) {
      throw new BundleBuilderError(
        "mcp-entry-failed",
        "installed MCP entry listed no tools",
      );
    }
    settled = true;
    return { ok: true, toolCount };
  } catch (error) {
    if (error instanceof BundleBuilderError) throw error;
    throw new BundleBuilderError(
      "mcp-entry-failed",
      "installed MCP entry failed initialize/list-tools handshake",
    );
  } finally {
    settled = true;
    clearTimeout(timeout);
    try {
      await client.close();
    } catch {
      // Best-effort close after handshake.
    }
  }
}

function defaultHooks(): BundleBuilderHooks {
  return {
    runCommand: (spec) => {
      const options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {
        cwd: spec.cwd,
      };
      if (spec.env !== undefined) options.env = spec.env;
      if (spec.timeoutMs !== undefined) options.timeoutMs = spec.timeoutMs;
      return runCaptured(spec.command, [...spec.args], options);
    },
    fs: {
      existsSync,
      mkdirSync: (target, options) => {
        mkdirSync(target, options);
      },
      rmSync,
      renameSync,
      copyFileSync,
      readFileSync: (target, encoding) => readFileSync(target, encoding),
      writeFileSync: (target, contents, options) => {
        writeFileSync(target, contents, options);
      },
      statSync: (target) => {
        const stats = statSync(target);
        return {
          isDirectory: () => stats.isDirectory(),
          isFile: () => stats.isFile(),
        };
      },
      hashFile: defaultHashFile,
    },
    processControl: {
      alive: (pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (error) {
          return (error as NodeJS.ErrnoException).code !== "ESRCH";
        }
      },
      signal: (pid, signal) => {
        process.kill(pid, signal);
      },
      sleep: sleepMs,
    },
    nowIso: () => new Date().toISOString(),
    randomSuffix: () => randomBytes(6).toString("hex"),
    handshakeMcp: defaultMcpHandshake,
  };
}

function mergeHooks(partial?: Partial<BundleBuilderHooks>): BundleBuilderHooks {
  const defaults = defaultHooks();
  if (partial === undefined) return defaults;
  const merged: BundleBuilderHooks = {
    runCommand: partial.runCommand ?? defaults.runCommand,
    fs: partial.fs ?? defaults.fs,
    processControl: partial.processControl ?? defaults.processControl,
    nowIso: partial.nowIso ?? defaults.nowIso,
    randomSuffix: partial.randomSuffix ?? defaults.randomSuffix,
    handshakeMcp: partial.handshakeMcp ?? defaults.handshakeMcp,
  };
  if (partial.allowUnderNpmTest !== undefined) {
    return { ...merged, allowUnderNpmTest: partial.allowUnderNpmTest };
  }
  return merged;
}

function combinedOutput(result: CapturedProcess): string {
  return `${result.stdout}\n${result.stderr}`;
}

function throwIfFailed(
  result: CapturedProcess,
  category: BundleBuilderError["category"],
  message: string,
): void {
  if (result.timedOut || result.exitCode !== 0) {
    throw new BundleBuilderError(category, message);
  }
}

function parentDirectoryOk(hooks: BundleBuilderHooks, outputDirectory: string): boolean {
  const parent = path.dirname(outputDirectory);
  if (!hooks.fs.existsSync(parent)) return false;
  try {
    return hooks.fs.statSync(parent).isDirectory();
  } catch {
    return false;
  }
}

async function listTarEntries(
  hooks: BundleBuilderHooks,
  tarballPath: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<string[]> {
  const listed = await hooks.runCommand({
    command: "tar",
    args: ["-tzf", tarballPath],
    cwd,
    env,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  throwIfFailed(listed, "tarball-invalid", "unable to list package tarball entries");
  return listed.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function readPackagedIdentity(
  hooks: BundleBuilderHooks,
  tarballPath: string,
  workDir: string,
  env: NodeJS.ProcessEnv,
): Promise<BuildIdentity> {
  const extract = await hooks.runCommand({
    command: "tar",
    args: ["-xOf", tarballPath, IDENTITY_TAR_PATH],
    cwd: workDir,
    env,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  throwIfFailed(extract, "identity-unavailable", "packaged build identity is missing");
  let parsed: unknown;
  try {
    parsed = JSON.parse(extract.stdout);
  } catch {
    throw new BundleBuilderError(
      "identity-unavailable",
      "packaged build identity is not JSON",
    );
  }
  return requireBuildIdentity(parsed, "packaged");
}

function installedPackageRoot(prefixDir: string): string {
  return path.join(prefixDir, "lib", "node_modules", "forklight");
}

function installedCliEntry(prefixDir: string): string {
  return path.join(installedPackageRoot(prefixDir), "dist", "src", "cli.js");
}

function installedMcpEntry(prefixDir: string): string {
  return path.join(installedPackageRoot(prefixDir), "dist", "src", "mcp", "main.js");
}

function installedCliArgs(prefixDir: string, subcommand: readonly string[]): string[] {
  return [
    "--disable-warning=ExperimentalWarning",
    installedCliEntry(prefixDir),
    ...subcommand,
  ];
}

/** Parse a full top-level JSON object from command output (nested-safe). */
export function parseJsonObject(text: string): Record<string, unknown> {
  const parsed = extractTopLevelJson(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("json object invalid");
  }
  return parsed as Record<string, unknown>;
}

async function waitForPidExit(
  hooks: BundleBuilderHooks,
  pid: number,
): Promise<boolean> {
  const waitMs = hooks.processControl.cleanupWaitMs ?? CLEANUP_WAIT_MS;
  const pollMs = Math.min(100, Math.max(1, waitMs));
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (!hooks.processControl.alive(pid)) return true;
    await hooks.processControl.sleep(pollMs);
  }
  return !hooks.processControl.alive(pid);
}

async function signalExactPid(
  hooks: BundleBuilderHooks,
  pid: number,
): Promise<boolean> {
  if (!hooks.processControl.alive(pid)) return true;
  try {
    hooks.processControl.signal(pid, "SIGTERM");
  } catch {
    // May have exited between probe and signal.
  }
  if (await waitForPidExit(hooks, pid)) return true;
  if (hooks.processControl.alive(pid)) {
    try {
      hooks.processControl.signal(pid, "SIGKILL");
    } catch {
      // ignore
    }
    await hooks.processControl.sleep(100);
  }
  return !hooks.processControl.alive(pid);
}

/**
 * Stop only recorded Hub/daemon PIDs and isolated-home daemon authority.
 * Never scans process names or signals untracked PIDs.
 */
async function stopOwnedProcesses(
  hooks: BundleBuilderHooks,
  owned: OwnedCleanup,
): Promise<{ hubGone: boolean; daemonGone: boolean }> {
  let hubGone = owned.hubPid === undefined;
  if (owned.hubPid !== undefined) {
    hubGone = await signalExactPid(hooks, owned.hubPid);
  }

  let daemonGone = owned.daemonPid === undefined && owned.daemonStopHome === undefined;

  if (owned.daemonStopHome !== undefined && owned.prefixDir !== undefined) {
    const stopEnv = buildMinimalIsolatedEnv({
      workDir: path.dirname(owned.daemonStopHome),
      forklightHome: owned.daemonStopHome,
    });
    const stop = await hooks.runCommand({
      command: process.execPath,
      args: installedCliArgs(owned.prefixDir, ["daemon", "stop"]),
      cwd: owned.daemonStopHome,
      env: stopEnv,
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    const stopAccepted = stop.exitCode === 0
      || /not running/i.test(combinedOutput(stop));
    if (!stopAccepted && owned.daemonPid === undefined) {
      daemonGone = false;
    } else {
      daemonGone = true;
    }
  }

  if (owned.daemonPid !== undefined) {
    const gone = await signalExactPid(hooks, owned.daemonPid);
    daemonGone = gone;
  } else if (owned.daemonStopHome === undefined) {
    daemonGone = true;
  }

  return { hubGone, daemonGone };
}

async function verifyInstalledEntrypoints(
  hooks: BundleBuilderHooks,
  prefixDir: string,
  isolatedHome: string,
  workDir: string,
  packagedIdentity: BuildIdentity,
): Promise<{
  cliOk: boolean;
  mcpOk: boolean;
  installedIdentity: BuildIdentity;
}> {
  const packageRoot = installedPackageRoot(prefixDir);
  const cliEntry = installedCliEntry(prefixDir);
  const mcpEntry = installedMcpEntry(prefixDir);
  const identityPath = path.join(packageRoot, "dist", "build-identity.json");
  const binCli = path.join(prefixDir, "bin", "forklight");
  const binMcp = path.join(prefixDir, "bin", "forklight-mcp");
  const env = buildMinimalIsolatedEnv({
    workDir,
    forklightHome: isolatedHome,
  });

  if (!hooks.fs.existsSync(binCli) || !hooks.fs.existsSync(binMcp)) {
    throw new BundleBuilderError("install-failed", "installed CLI or MCP bin shim is missing");
  }
  if (!hooks.fs.existsSync(cliEntry) || !hooks.fs.existsSync(mcpEntry)) {
    throw new BundleBuilderError("install-failed", "installed CLI or MCP entry is missing");
  }
  if (!hooks.fs.existsSync(identityPath)) {
    throw new BundleBuilderError(
      "identity-unavailable",
      "installed build identity is missing",
    );
  }
  const installedIdentity = requireBuildIdentity(
    JSON.parse(hooks.fs.readFileSync(identityPath, "utf8")) as unknown,
    "installed",
  );
  if (!buildIdentitiesEqual(packagedIdentity, installedIdentity)) {
    throw new BundleBuilderError(
      "identity-mismatch",
      "installed build identity does not match the packaged identity",
    );
  }

  const help = await hooks.runCommand({
    command: process.execPath,
    args: installedCliArgs(prefixDir, ["help"]),
    cwd: packageRoot,
    env,
    timeoutMs: ENTRY_TIMEOUT_MS,
  });
  const cliOk = help.exitCode === 0 && /forklight/i.test(help.stdout);
  if (!cliOk) {
    throw new BundleBuilderError("cli-entry-failed", "installed CLI entry failed to load");
  }

  // Real MCP protocol handshake (initialize + tools/list), not syntax-only --check.
  const handshake = await hooks.handshakeMcp({
    executable: process.execPath,
    args: ["--disable-warning=ExperimentalWarning", mcpEntry],
    env,
    cwd: packageRoot,
    timeoutMs: MCP_HANDSHAKE_TIMEOUT_MS,
  });
  if (!handshake.ok) {
    throw new BundleBuilderError(
      "mcp-entry-failed",
      "installed MCP entry failed initialize/list-tools handshake",
    );
  }

  return { cliOk: true, mcpOk: true, installedIdentity };
}

async function verifyHubDaemonLifecycle(
  hooks: BundleBuilderHooks,
  prefixDir: string,
  isolatedHome: string,
  workDir: string,
  packagedIdentity: BuildIdentity,
  owned: OwnedCleanup,
): Promise<BundleVerification["hubDaemonLifecycle"]> {
  const env = buildMinimalIsolatedEnv({
    workDir,
    forklightHome: isolatedHome,
  });

  const restart = await hooks.runCommand({
    command: process.execPath,
    args: installedCliArgs(prefixDir, [
      "hub",
      "restart",
      "--confirm",
      "--detach",
      "--no-open",
      "--json",
      "--startup-timeout-ms",
      String(HUB_STARTUP_TIMEOUT_MS),
    ]),
    cwd: isolatedHome,
    env,
    timeoutMs: HUB_STARTUP_TIMEOUT_MS + 15_000,
  });
  throwIfFailed(restart, "hub-lifecycle-failed", "installed Hub failed to start");

  let restartJson: Record<string, unknown>;
  try {
    restartJson = parseJsonObject(restart.stdout);
  } catch {
    throw new BundleBuilderError(
      "hub-lifecycle-failed",
      "installed Hub restart did not return JSON",
    );
  }
  if (restartJson.ok !== true) {
    throw new BundleBuilderError(
      "hub-lifecycle-failed",
      "installed Hub restart reported failure",
    );
  }
  const state = restartJson.state;
  if (state !== "ready" && state !== "current") {
    throw new BundleBuilderError(
      "hub-lifecycle-failed",
      "installed Hub is not current or ready",
    );
  }
  const hubPid = restartJson.pid;
  if (typeof hubPid !== "number" || !Number.isSafeInteger(hubPid) || hubPid <= 0) {
    throw new BundleBuilderError(
      "hub-lifecycle-failed",
      "installed Hub did not report a pid",
    );
  }
  owned.hubPid = hubPid;
  owned.daemonStopHome = isolatedHome;
  owned.prefixDir = prefixDir;

  const status = await hooks.runCommand({
    command: process.execPath,
    args: installedCliArgs(prefixDir, ["hub", "status", "--json"]),
    cwd: isolatedHome,
    env,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  throwIfFailed(status, "hub-lifecycle-failed", "installed Hub status failed");
  let statusJson: Record<string, unknown>;
  try {
    statusJson = parseJsonObject(status.stdout);
  } catch {
    throw new BundleBuilderError(
      "hub-lifecycle-failed",
      "installed Hub status is not JSON",
    );
  }
  if (statusJson.state !== "current") {
    throw new BundleBuilderError(
      "hub-lifecycle-failed",
      "installed Hub status is not current",
    );
  }

  // Exact daemon PID + identity from installed daemon status (health payload).
  const daemonStatus = await hooks.runCommand({
    command: process.execPath,
    args: installedCliArgs(prefixDir, ["daemon", "status"]),
    cwd: isolatedHome,
    env,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  throwIfFailed(daemonStatus, "daemon-identity-mismatch", "installed daemon status failed");
  let daemonJson: Record<string, unknown>;
  try {
    daemonJson = parseJsonObject(daemonStatus.stdout);
  } catch {
    throw new BundleBuilderError(
      "daemon-identity-mismatch",
      "installed daemon status is not JSON",
    );
  }
  const daemonPid = daemonJson.pid;
  if (typeof daemonPid !== "number" || !Number.isSafeInteger(daemonPid) || daemonPid <= 0) {
    throw new BundleBuilderError(
      "daemon-identity-mismatch",
      "installed daemon did not report a pid",
    );
  }
  owned.daemonPid = daemonPid;

  const daemonIdentity = daemonJson.buildIdentity ?? daemonJson.serverIdentity;
  if (!isBuildIdentity(daemonIdentity)) {
    throw new BundleBuilderError(
      "daemon-identity-mismatch",
      "installed daemon build identity is unavailable",
    );
  }
  if (!buildIdentitiesEqual(packagedIdentity, daemonIdentity)) {
    throw new BundleBuilderError(
      "daemon-identity-mismatch",
      "installed daemon build identity does not match the tarball",
    );
  }

  const health = await hooks.runCommand({
    command: process.execPath,
    args: installedCliArgs(prefixDir, ["health", "--json"]),
    cwd: isolatedHome,
    env,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  throwIfFailed(health, "daemon-identity-mismatch", "installed health check failed");
  let healthJson: Record<string, unknown>;
  try {
    healthJson = parseJsonObject(health.stdout);
  } catch {
    throw new BundleBuilderError(
      "daemon-identity-mismatch",
      "installed health output is not JSON",
    );
  }
  if (healthJson.identityStatus !== "matched") {
    throw new BundleBuilderError(
      "daemon-identity-mismatch",
      "installed CLI and daemon build identities do not match",
    );
  }

  const cleanup = await stopOwnedProcesses(hooks, owned);
  if (!cleanup.hubGone || !cleanup.daemonGone) {
    throw new BundleBuilderError(
      "cleanup-failed",
      "owned Hub or isolated daemon did not stop cleanly",
    );
  }
  // Clear ownership after successful stop so failure cleanup is a no-op.
  delete owned.hubPid;
  delete owned.daemonPid;
  delete owned.daemonStopHome;
  delete owned.prefixDir;

  return Object.freeze({
    passed: true,
    hubCurrent: true,
    daemonIdentityMatch: true,
    cleanShutdown: true,
  });
}

function publishBundle(
  hooks: BundleBuilderHooks,
  plan: BundlePlan,
  tarballSource: string,
  tarballFileName: string,
  packagedIdentity: BuildIdentity,
  evidence: BundleEvidence,
): void {
  const publishDir = path.join(plan.stagingDirectory, "publish");
  hooks.fs.mkdirSync(publishDir, { recursive: true, mode: 0o755 });

  const tarballDest = path.join(publishDir, tarballFileName);
  const identityDest = path.join(publishDir, BUNDLE_ARTIFACT_NAMES.buildIdentity);
  const runbookDest = path.join(publishDir, BUNDLE_ARTIFACT_NAMES.runbook);
  const evidenceDest = path.join(publishDir, BUNDLE_ARTIFACT_NAMES.evidence);

  hooks.fs.copyFileSync(tarballSource, tarballDest);
  hooks.fs.writeFileSync(
    identityDest,
    `${JSON.stringify(packagedIdentity, null, 2)}\n`,
    { mode: 0o644 },
  );
  const runbookSource = path.join(plan.projectRoot, "docs", BUNDLE_ARTIFACT_NAMES.runbook);
  if (!hooks.fs.existsSync(runbookSource)) {
    throw new BundleBuilderError("publish-failed", "clean-user runbook is missing");
  }
  hooks.fs.copyFileSync(runbookSource, runbookDest);
  hooks.fs.writeFileSync(
    evidenceDest,
    `${JSON.stringify(evidence, null, 2)}\n`,
    { mode: 0o644 },
  );

  const workDir = path.join(plan.stagingDirectory, "work");
  if (hooks.fs.existsSync(workDir)) {
    hooks.fs.rmSync(workDir, { recursive: true, force: true });
  }

  for (const name of [
    tarballFileName,
    BUNDLE_ARTIFACT_NAMES.buildIdentity,
    BUNDLE_ARTIFACT_NAMES.runbook,
    BUNDLE_ARTIFACT_NAMES.evidence,
  ]) {
    hooks.fs.renameSync(path.join(publishDir, name), path.join(plan.stagingDirectory, name));
  }
  hooks.fs.rmSync(publishDir, { recursive: true, force: true });

  // Late race: refuse overwrite if destination appeared after planning.
  if (hooks.fs.existsSync(plan.outputDirectory)) {
    throw new BundleBuilderError(
      "destination-exists",
      "output directory already exists; refuse overwrite",
    );
  }
  hooks.fs.renameSync(plan.stagingDirectory, plan.outputDirectory);
}

/**
 * Build one verified clean-user bundle. On any failure, stops only exact
 * owned processes, removes private staging, and leaves an existing destination
 * untouched. Never retries automatically. Cleanup failures are not swallowed.
 */
export async function buildCleanRunBundle(
  options: BuildCleanRunBundleOptions,
): Promise<BuildCleanRunBundleResult> {
  const hooks = mergeHooks(options.hooks);
  if (hooks.allowUnderNpmTest !== true) {
    assertNotRunningInsideNpmTest();
  }

  const outputRequest = parseBundleOutputArgument(options.argv);
  const destinationPath = path.resolve(options.projectRoot, outputRequest);
  const plan = planCleanRunBundle({
    outputRequest,
    projectRoot: options.projectRoot,
    stagingSuffix: hooks.randomSuffix(),
    destinationExists: hooks.fs.existsSync(destinationPath),
    parentDirectoryOk: parentDirectoryOk(hooks, destinationPath),
  });

  const owned: OwnedCleanup = {};
  let stagingCreated = false;

  const cleanupStaging = (): void => {
    if (stagingCreated && hooks.fs.existsSync(plan.stagingDirectory)) {
      hooks.fs.rmSync(plan.stagingDirectory, { recursive: true, force: true });
    }
  };

  try {
    if (hooks.fs.existsSync(plan.stagingDirectory)) {
      throw new BundleBuilderError(
        "publish-failed",
        "private staging directory already exists",
      );
    }
    hooks.fs.mkdirSync(plan.stagingDirectory, { recursive: true, mode: 0o700 });
    stagingCreated = true;

    const workDir = path.join(plan.stagingDirectory, "work");
    const prefixDir = path.join(workDir, "prefix");
    const isolatedHome = path.join(workDir, "home");
    hooks.fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
    hooks.fs.mkdirSync(path.join(workDir, "npm-home"), { recursive: true, mode: 0o700 });
    hooks.fs.mkdirSync(path.join(workDir, "npm-cache"), { recursive: true, mode: 0o700 });
    hooks.fs.mkdirSync(prefixDir, { recursive: true, mode: 0o700 });
    hooks.fs.mkdirSync(isolatedHome, { recursive: true, mode: 0o700 });

    // The full prepack suite intentionally observes local Worker readiness,
    // which on macOS requires the operator's login Keychain. npm itself stays
    // isolated and no Provider/API credential environment variables pass.
    const packEnv = buildMinimalIsolatedEnv({
      workDir,
      preserveOperatorHome: true,
    });
    const isolatedEnv = buildMinimalIsolatedEnv({ workDir });

    // 1) Pack directly into staging work — no project-root residue.
    const pack = await hooks.runCommand({
      command: "npm",
      args: ["pack", "--json", "--pack-destination", workDir],
      cwd: plan.projectRoot,
      env: packEnv,
      timeoutMs: PACK_TIMEOUT_MS,
    });
    throwIfFailed(pack, "pack-failed", "npm pack failed");
    const packArtifact = parseNpmPackJson(pack.stdout);
    const testSummary = parseTestSummary(combinedOutput(pack));

    const tarballInWork = path.join(workDir, packArtifact.filename);
    if (!hooks.fs.existsSync(tarballInWork)) {
      throw new BundleBuilderError("tarball-invalid", "npm pack did not produce a tarball");
    }
    const tarballSha256 = await hooks.fs.hashFile(tarballInWork);
    if (!/^[a-f0-9]{64}$/.test(tarballSha256)) {
      throw new BundleBuilderError("tarball-invalid", "tarball SHA-256 is invalid");
    }

    // 2) Scan every tar entry for absolute/traversal/sensitive basenames.
    const entries = await listTarEntries(hooks, tarballInWork, workDir, isolatedEnv);
    const scan = scanTarEntries(entries);
    if (!scan.ok) {
      throw new BundleBuilderError(
        "sensitive-package-entry",
        `package entry scan failed (${scan.issueCategory ?? "unknown"})`,
      );
    }

    // 3) Packaged identity from tarball contents (authoritative).
    const packagedIdentity = await readPackagedIdentity(
      hooks,
      tarballInWork,
      workDir,
      isolatedEnv,
    );

    // 4) Isolated prefix install — private npm env only.
    const install = await hooks.runCommand({
      command: "npm",
      args: [
        "install",
        "--global",
        "--prefix",
        prefixDir,
        tarballInWork,
        "--no-fund",
        "--no-audit",
      ],
      cwd: workDir,
      env: isolatedEnv,
      timeoutMs: INSTALL_TIMEOUT_MS,
    });
    throwIfFailed(install, "install-failed", "isolated npm install failed");

    // 5) Installed CLI / MCP handshake / identity.
    const entry = await verifyInstalledEntrypoints(
      hooks,
      prefixDir,
      isolatedHome,
      workDir,
      packagedIdentity,
    );

    // 6) Isolated Hub/daemon lifecycle with exact PID cleanup.
    const hubDaemonLifecycle = await verifyHubDaemonLifecycle(
      hooks,
      prefixDir,
      isolatedHome,
      workDir,
      packagedIdentity,
      owned,
    );

    const verification: BundleVerification = {
      prepack: {
        passed: true,
        testsPassed: testSummary.testsPassed,
        testsTotal: testSummary.testsTotal,
      },
      isolatedInstall: { passed: true },
      cliEntryLoad: { passed: entry.cliOk },
      mcpEntryLoad: { passed: entry.mcpOk },
      installedBuildIdentityMatch: { passed: true },
      sensitiveFilenameScan: { passed: true },
      hubDaemonLifecycle,
    };

    const evidence = buildBundleEvidence({
      createdAt: hooks.nowIso(),
      tarballFileName: packArtifact.filename,
      tarballSha256,
      buildIdentity: packagedIdentity,
      verification,
    });

    // 7) Atomic publication — final rename is the last mutation.
    publishBundle(
      hooks,
      plan,
      tarballInWork,
      packArtifact.filename,
      packagedIdentity,
      evidence,
    );
    stagingCreated = false;

    return {
      outputDirectory: plan.outputDirectory,
      evidence,
    };
  } catch (error) {
    let cleanupError: unknown;
    try {
      const cleanup = await stopOwnedProcesses(hooks, owned);
      if (
        (owned.hubPid !== undefined && !cleanup.hubGone)
        || (owned.daemonPid !== undefined && !cleanup.daemonGone)
        || (owned.daemonStopHome !== undefined && !cleanup.daemonGone)
      ) {
        cleanupError = new BundleBuilderError(
          "cleanup-failed",
          "owned Hub or isolated daemon did not stop after verification failure",
        );
      }
    } catch (stopError) {
      cleanupError = stopError instanceof BundleBuilderError
        ? stopError
        : new BundleBuilderError(
          "cleanup-failed",
          "owned process cleanup failed after verification error",
        );
    }
    cleanupStaging();
    // Never hide a cleanup failure behind the earlier verification error.
    if (cleanupError !== undefined) throw cleanupError;
    throw error;
  }
}

export async function runCleanRunBundleCli(
  argv: readonly string[] = process.argv.slice(2),
  projectRoot: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."),
): Promise<void> {
  try {
    const result = await buildCleanRunBundle({ argv, projectRoot });
    process.stdout.write(
      `clean-run bundle ready\n`
      + `artifacts: ${result.evidence.tarball.file}, `
      + `${BUNDLE_ARTIFACT_NAMES.buildIdentity}, `
      + `${BUNDLE_ARTIFACT_NAMES.runbook}, `
      + `${BUNDLE_ARTIFACT_NAMES.evidence}\n`
      + `tarballSha256: ${result.evidence.tarball.sha256}\n`
      + `buildId: ${result.evidence.buildIdentity.buildId}\n`
      + `prepack: ${result.evidence.verification.testPassed}/`
      + `${result.evidence.verification.testCount}\n`
      + `limits: package verification is not a clean-user journey\n`,
    );
  } catch (error) {
    process.stderr.write(`${formatBundleFailure(error)}\n`);
    process.exitCode = 1;
  }
}

function isExecutedAsCli(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  const self = fileURLToPath(import.meta.url);
  const resolvedEntry = path.resolve(entry);
  if (resolvedEntry === self) return true;
  if (resolvedEntry === self.replace(/\.ts$/u, ".js")) return true;
  if (resolvedEntry === self.replace(/\.js$/u, ".ts")) return true;
  const base = path.basename(resolvedEntry);
  return base === "build-clean-run-bundle.ts" || base === "build-clean-run-bundle.js";
}

if (isExecutedAsCli()) {
  void runCleanRunBundleCli();
}
