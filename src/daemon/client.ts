import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVATION_HANDOFF_ENV_KEYS,
  resolveTsxImportSpecifier,
} from "../activation/runner.js";
import { daemonLogPath, daemonSocketPath, forklightHome } from "../core/config.js";
import {
  compareBuildIdentity,
  currentBuildIdentity,
  isBuildIdentity,
  type BuildIdentity,
} from "../core/build-identity.js";
import { sleepMs as sleep } from "../core/time.js";
import {
  parseDaemonShutdownIntent,
  requiresMatchingBuildIdentity,
  type DaemonMethod,
  type DaemonRequest,
  type DaemonResponse,
  type DaemonShutdownIntent,
} from "./protocol.js";

export type { DaemonShutdownIntent };

export function daemonExchange(
  method: DaemonMethod,
  params: Record<string, unknown> = {},
  home = forklightHome(),
  clientIdentity: BuildIdentity = currentBuildIdentity(),
): Promise<DaemonResponse> {
  const request: DaemonRequest = {
    id: randomUUID(),
    method,
    params,
    clientIdentity,
  };
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(daemonSocketPath(home));
    let settled = false;
    let buffer = "";
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    };
    const timer = setTimeout(() => {
      fail(new Error(`ForkLight daemon request timed out: ${method}`));
    }, daemonRequestTimeoutMs(method, params));
    socket.once("error", fail);
    socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk: Buffer) => {
      if (settled) return;
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const line = buffer.slice(0, newline);
      let response: DaemonResponse;
      try {
        response = JSON.parse(line) as DaemonResponse;
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.end();
      resolve(response);
    });
  });
}

export async function daemonRequest<T = unknown>(
  method: DaemonMethod,
  params: Record<string, unknown> = {},
  home = forklightHome(),
): Promise<T> {
  const clientIdentity = currentBuildIdentity();
  if (requiresMatchingBuildIdentity(method)) {
    const handshake = await daemonExchange("health", {}, home, clientIdentity);
    if (!handshake.ok) {
      throw new Error(handshake.error ?? "ForkLight daemon identity handshake failed");
    }
    if (!isBuildIdentity(handshake.serverIdentity)) {
      throw new Error("ForkLight daemon identity is unavailable; rebuild and restart before changes");
    }
    const comparison = compareBuildIdentity(clientIdentity, handshake.serverIdentity);
    if (!comparison.protocolCompatible) {
      throw new Error("ForkLight protocol mismatch; rebuild and restart before changes");
    }
    if (!comparison.sameBuild) {
      throw new Error("ForkLight build mismatch; rebuild and restart before changes");
    }
  }
  const response = await daemonExchange(method, params, home, clientIdentity);
  if (!response.ok) {
    throw new Error(response.error ?? "ForkLight daemon request failed");
  }
  return response.result as T;
}

export function daemonRequestTimeoutMs(
  method: DaemonMethod,
  params: Record<string, unknown>,
): number {
  // Remediation and candidate reverification execute the Task's configured
  // acceptance suite before they can respond. Keep the transport from timing
  // out first; the per-command timeout remains authoritative inside the
  // daemon. Callers may request a longer transport window when they know the
  // suite size.
  const requested = method === "integration_wait"
    ? params.timeoutMs
    : method === "remediation_verify" || method === "candidate_reverify"
      ? (params.requestTimeoutMs ?? 6 * 60 * 60 * 1000)
      : undefined;
  return typeof requested === "number"
    && Number.isSafeInteger(requested)
    && requested > 0
    ? Math.max(15_000, requested + 5_000)
    : 15_000;
}

/** Default bounded readiness window after one daemon launch. Long enough for
 *  durable recovery during self-upgrade; still finite. */
export const DEFAULT_DAEMON_STARTUP_TIMEOUT_MS = 30_000;
export const MIN_DAEMON_STARTUP_TIMEOUT_MS = 1_000;
export const MAX_DAEMON_STARTUP_TIMEOUT_MS = 600_000;
export const DAEMON_STARTUP_POLL_INTERVAL_MS = 100;

/** Privacy-safe: no home, socket path, PID table, or raw transport detail. */
export const DAEMON_STARTUP_CHILD_EXITED_MESSAGE =
  "ForkLight daemon process exited before becoming ready";
/** Privacy-safe timeout; includes only the configured bound. */
export const DAEMON_STARTUP_TIMEOUT_MESSAGE =
  "ForkLight daemon did not become ready within the startup timeout";

/** Observed child from a single launch attempt. */
export interface DaemonChildHandle {
  readonly pid: number;
  readonly exited: boolean;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
}

/** Options for the startup supervisor. Test seams keep probes deterministic. */
export interface EnsureDaemonOptions {
  /** Bounded readiness deadline after the single launch (ms). */
  startupTimeoutMs?: number;
  /** Test seam: replace process spawn. Production launches exactly once. */
  launch?: (home: string) => DaemonChildHandle;
  /** Test seam: replace health probe. */
  probeHealth?: (home: string) => Promise<Record<string, unknown>>;
  /** Test seam: clock for deadline math. */
  nowMs?: () => number;
  /** Test seam: sleep between polls. */
  sleepMs?: (ms: number) => Promise<void>;
  /** Test seam: poll interval (default 100ms). */
  pollIntervalMs?: number;
}

/** Validate a startup readiness timeout. Safe for CLI and ensureDaemon. */
export function resolveDaemonStartupTimeoutMs(
  value: unknown = DEFAULT_DAEMON_STARTUP_TIMEOUT_MS,
): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < MIN_DAEMON_STARTUP_TIMEOUT_MS
    || value > MAX_DAEMON_STARTUP_TIMEOUT_MS
  ) {
    throw new Error(
      `Daemon startup timeout must be an integer from ${MIN_DAEMON_STARTUP_TIMEOUT_MS} to ${MAX_DAEMON_STARTUP_TIMEOUT_MS}`,
    );
  }
  return value;
}

/**
 * Ensure a matching daemon is healthy. Fast path returns existing health.
 * Otherwise launches exactly one child, then polls that child and the endpoint
 * until ready, child exit, or the bounded readiness deadline. Never relaunches.
 */
export async function ensureDaemon(
  home = forklightHome(),
  options: EnsureDaemonOptions = {},
): Promise<Record<string, unknown>> {
  const probeHealth = options.probeHealth
    ?? ((targetHome: string) => daemonRequest<Record<string, unknown>>("health", {}, targetHome));
  try {
    return await probeHealth(home);
  } catch {
    // Not reachable — fall through to a single launch.
  }

  const startupTimeoutMs = resolveDaemonStartupTimeoutMs(
    options.startupTimeoutMs ?? DEFAULT_DAEMON_STARTUP_TIMEOUT_MS,
  );
  const launch = options.launch ?? launchDaemonProcess;
  const nowMs = options.nowMs ?? Date.now;
  const sleepMs = options.sleepMs ?? sleep;
  const pollIntervalMs = typeof options.pollIntervalMs === "number"
    && Number.isSafeInteger(options.pollIntervalMs)
    && options.pollIntervalMs > 0
    ? options.pollIntervalMs
    : DAEMON_STARTUP_POLL_INTERVAL_MS;

  const child = launch(home);
  const deadline = nowMs() + startupTimeoutMs;

  while (nowMs() < deadline) {
    if (child.exited) {
      throw new Error(DAEMON_STARTUP_CHILD_EXITED_MESSAGE);
    }
    try {
      return await probeHealth(home);
    } catch {
      // Still starting; keep observing the same child.
    }
    const remaining = deadline - nowMs();
    if (remaining <= 0) break;
    await sleepMs(Math.min(pollIntervalMs, remaining));
  }

  if (child.exited) {
    throw new Error(DAEMON_STARTUP_CHILD_EXITED_MESSAGE);
  }
  throw new Error(`${DAEMON_STARTUP_TIMEOUT_MESSAGE} (${startupTimeoutMs}ms)`);
}

// --- Observation transport (never starts a daemon) ---

/** Bounded guidance for Main when an Integration observer cannot reach a daemon.
 *  Privacy-safe: no home, socket path, operation content, or credentials. */
export const DAEMON_OBSERVER_UNAVAILABLE_MESSAGE =
  "ForkLight daemon is unavailable for observation; it may be transitioning or stopped. Retry the same observation after the daemon is reachable again. Observation never starts a daemon.";

function errorCode(error: unknown): string {
  if (error !== null && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" || typeof code === "number") return String(code);
  }
  return "";
}

/** True when the failure is a transport gap (absent/refused/reset/closed socket),
 *  not a daemon business or identity error. */
export function isDaemonTransportUnavailable(error: unknown): boolean {
  if (error === undefined || error === null) return false;
  const code = errorCode(error);
  if (/^(ENOENT|ECONNREFUSED|ECONNRESET|EPIPE|ENOTCONN|ECONNABORTED|ETIMEDOUT)$/i.test(code)) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (
    /ECONNREFUSED|ENOENT|ECONNRESET|EPIPE|ENOTCONN|ECONNABORTED|ETIMEDOUT|socket hang up|connect E|daemon request timed out/i
      .test(message)
  ) {
    return true;
  }
  if (error instanceof Error && error.cause !== undefined) {
    return isDaemonTransportUnavailable(error.cause);
  }
  return false;
}

/**
 * Read-only Integration (and similar) observer request: talks only to an
 * already-running daemon. Never calls ensureDaemon, startDaemonProcess,
 * restartDaemon, or any other lifecycle mutation. On transport unavailability
 * during activation handoff or after a stop, returns one bounded retry-later
 * error and preserves the original transport error only as `cause`.
 */
export async function daemonObserverRequest<T = unknown>(
  method: DaemonMethod,
  params: Record<string, unknown> = {},
  home = forklightHome(),
): Promise<T> {
  try {
    return await daemonRequest<T>(method, params, home);
  } catch (error) {
    if (isDaemonTransportUnavailable(error)) {
      throw new Error(DAEMON_OBSERVER_UNAVAILABLE_MESSAGE, {
        cause: error instanceof Error ? error : undefined,
      });
    }
    throw error;
  }
}

// --- Daemon lifecycle ---

/** Probe daemon without starting it (for Hub status / control). */
export async function probeDaemon(home = forklightHome()): Promise<{
  running: boolean;
  health?: Record<string, unknown>;
  error?: string;
}> {
  try {
    const health = await daemonRequest<Record<string, unknown>>("health", {}, home);
    return { running: true, health };
  } catch (error) {
    return {
      running: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Options for graceful Daemon stop. Intent defaults to ordinary stop. */
export interface StopDaemonOptions {
  /** Closed stop-versus-restart intent. Omitted means stop (no auto-resume). */
  intent?: DaemonShutdownIntent;
}

/** Gracefully stop the daemon after its exact PID and endpoint are both gone. */
export async function stopDaemon(
  home = forklightHome(),
  options: StopDaemonOptions = {},
): Promise<{
  stopped: boolean;
  result?: Record<string, unknown>;
  message: string;
}> {
  const intent = parseDaemonShutdownIntent(options.intent ?? "stop");
  let targetPid: number;
  try {
    const health = await daemonRequest<Record<string, unknown>>("health", {}, home);
    if (typeof health.pid !== "number" || !Number.isSafeInteger(health.pid) || health.pid <= 0) {
      throw new Error("ForkLight daemon health did not report a valid PID");
    }
    targetPid = health.pid;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/ECONNREFUSED|ENOENT/i.test(msg)) {
      return { stopped: true, message: "Daemon was not running" };
    }
    throw error;
  }

  let result: Record<string, unknown> | undefined;
  try {
    result = await daemonRequest<Record<string, unknown>>("shutdown", { intent }, home);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!/ECONNREFUSED|ENOENT/i.test(msg)) throw error;
  }

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    let pidAlive = false;
    try {
      process.kill(targetPid, 0);
      pidAlive = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") pidAlive = true;
    }
    if (!pidAlive && !(await probeSocketAlive(home))) {
      return {
        stopped: true,
        ...(result === undefined ? {} : { result }),
        message: "Daemon stopped",
      };
    }
    await sleep(100);
  }
  throw new Error("ForkLight daemon did not stop within 10 seconds");
}

function probeSocketAlive(home: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(daemonSocketPath(home));
    socket.setTimeout(200);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
  });
}

/** Stop only for a validated activation handoff.  Sends a
 *  server-validated `activation_handoff_shutdown` request carrying the
 *  operation identity from the consumed one-use handoff.  The daemon
 *  validates these values against its durable Integration state before
 *  acknowledging; replay or mismatch fails.  After positive
 *  acknowledgement this function waits for endpoint relinquishment
 *  only — the old PID may stay alive draining existing connections.
 *
 *  Only call from a `forklight daemon stop` command launched inside an
 *  activation handoff; ordinary user stop must always use `stopDaemon`.
 *  Never returns "already stopped" — missing acknowledgement is a
 *  hard failure. */
export async function stopDaemonForHandoff(
  home: string,
  operationId: string,
  taskId: string,
  receiptId: string,
): Promise<{ stopped: boolean; result?: Record<string, unknown>; message: string }> {
  // 1. Send the server-validated shutdown request.  The daemon verifies
  //    operationId/taskId/receiptId against its durable Integration state.
  //    Any error (unreachable, mismatch, replay, already-complete) fails.
  let result: Record<string, unknown>;
  try {
    result = await daemonRequest<Record<string, unknown>>(
      "activation_handoff_shutdown",
      { operationId, taskId, receiptId },
      home,
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `ForkLight activation handoff shutdown failed: ${msg}`,
      { cause: error instanceof Error ? error : undefined },
    );
  }
  if (result?.handoffAuthorized !== true || result?.stopping !== true) {
    throw new Error(
      "ForkLight daemon did not acknowledge activation handoff shutdown",
    );
  }
  const targetPid = typeof result.targetPid === "number"
    && Number.isSafeInteger(result.targetPid) && result.targetPid > 0
    ? result.targetPid
    : undefined;
  if (targetPid === undefined) {
    throw new Error(
      "ForkLight daemon handoff acknowledgement did not identify the target PID",
    );
  }

  // 2. Wait for endpoint relinquishment only.  The old PID may remain
  //    alive draining existing connections (e.g. integration_wait).
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!(await probeSocketAlive(home))) {
      return {
        stopped: true,
        result,
        message: "Daemon endpoint relinquished for activation handoff",
      };
    }
    // If the socket is still reachable, distinguish same-PID draining
    // (keep waiting) from a replacement daemon (fail closed).
    try {
      const currentHealth = await daemonRequest<Record<string, unknown>>(
        "health", {}, home,
      );
      if (currentHealth.pid !== targetPid) {
        throw new Error(
          "ForkLight daemon endpoint was replaced during activation handoff; refusing to continue",
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // ECONNREFUSED / ENOENT means the socket disappeared between our
      // probe and health request — that's the normal relinquishment path.
      if (!/ECONNREFUSED|ENOENT/i.test(msg)) throw error;
    }
    await sleep(100);
  }
  throw new Error("ForkLight daemon did not relinquish endpoint within 10 seconds");
}

/** Stop fully with restart intent, then start a fresh daemon with the same
 *  bounded readiness rules. The old Daemon records restart-continuation
 *  authority for eligible interrupted Workers before exit. */
export async function restartDaemon(
  home = forklightHome(),
  options: EnsureDaemonOptions = {},
): Promise<Record<string, unknown>> {
  await stopDaemon(home, { intent: "restart" });
  return ensureDaemon(home, options);
}

export function daemonLaunchArguments(moduleUrl: string): {
  executable: string;
  args: string[];
  mode: "dist" | "source-dev";
} {
  const modulePath = fileURLToPath(moduleUrl);
  const directory = path.dirname(modulePath);
  if (modulePath.endsWith(".ts")) {
    return {
      executable: process.execPath,
      args: [
        "--disable-warning=ExperimentalWarning",
        "--import",
        // Cwd-independent absolute file URL so a source-dev CLI launched from
        // an isolated Integration source cwd still loads the repo tsx.
        resolveTsxImportSpecifier(moduleUrl),
        path.join(directory, "main.ts"),
      ],
      mode: "source-dev",
    };
  }
  return {
    executable: process.execPath,
    args: [
      "--disable-warning=ExperimentalWarning",
      path.join(directory, "main.js"),
    ],
    mode: "dist",
  };
}

/**
 * Build the environment for one replacement Daemon child.
 * Removes only the three consumed activation handoff transport fields so a
 * restarted Daemon never inherits stale operation/task/receipt identity.
 * PATH, proxy/auth variables, and FORKLIGHT_HOME behavior are preserved.
 */
export function daemonChildEnvironment(
  home: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv, FORKLIGHT_HOME: home };
  for (const key of ACTIVATION_HANDOFF_ENV_KEYS) {
    delete env[key];
  }
  return env;
}

/** Single-dispatch routing seam: try daemon bootstrap once; if it succeeds
 *  dispatch the mutation exactly once and propagate every outcome.  Only
 *  when bootstrap itself fails (before any mutation request is sent) may the
 *  local fallback run.  This prevents double-mutation when the daemon is
 *  reachable but rejects, times out, or has a build/protocol mismatch. */
export async function routeMutation<T>(
  bootstrap: () => Promise<unknown>,
  dispatch: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> {
  let daemonBooted = false;
  try {
    await bootstrap();
    daemonBooted = true;
  } catch {
    // Bootstrap failure — local fallback is permitted.
  }
  if (daemonBooted) return dispatch();
  return fallback();
}

/**
 * Launch exactly one detached daemon child and return an exit-observing handle.
 * Callers that only need the PID may use `startDaemonProcess`.
 */
export function launchDaemonProcess(home = forklightHome()): DaemonChildHandle {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const logFd = openSync(daemonLogPath(home), "a", 0o600);
  const launch = daemonLaunchArguments(import.meta.url);
  const child = spawn(launch.executable, launch.args, {
    detached: true,
    env: daemonChildEnvironment(home),
    stdio: ["ignore", logFd, logFd],
  });
  let exited = false;
  let exitCode: number | null = null;
  let signalCode: NodeJS.Signals | null = null;
  child.once("exit", (code, signal) => {
    exited = true;
    exitCode = code;
    signalCode = signal;
  });
  child.once("error", () => {
    // Spawn failed after handle creation; treat as an early exit so the
    // startup supervisor can fail closed without relaunching.
    exited = true;
  });
  child.unref();
  closeSync(logFd);
  if (child.pid === undefined) throw new Error("Unable to start ForkLight daemon process");
  return {
    pid: child.pid,
    get exited() {
      return exited;
    },
    get exitCode() {
      return exitCode;
    },
    get signalCode() {
      return signalCode;
    },
  };
}

/** Launch one detached daemon and return its PID (compat wrapper). */
export function startDaemonProcess(home = forklightHome()): number {
  return launchDaemonProcess(home).pid;
}
