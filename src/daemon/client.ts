import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { daemonLogPath, daemonSocketPath, forklightHome } from "../core/config.js";
import {
  compareBuildIdentity,
  currentBuildIdentity,
  isBuildIdentity,
  type BuildIdentity,
} from "../core/build-identity.js";
import { sleepMs as sleep } from "../core/time.js";
import {
  requiresMatchingBuildIdentity,
  type DaemonMethod,
  type DaemonRequest,
  type DaemonResponse,
} from "./protocol.js";

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

export async function ensureDaemon(home = forklightHome()): Promise<Record<string, unknown>> {
  try {
    return await daemonRequest<Record<string, unknown>>("health", {}, home);
  } catch {
    startDaemonProcess(home);
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await sleep(100);
    try {
      return await daemonRequest<Record<string, unknown>>("health", {}, home);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `ForkLight daemon failed to start: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
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

/** Gracefully stop the daemon after its exact PID and endpoint are both gone. */
export async function stopDaemon(home = forklightHome()): Promise<{
  stopped: boolean;
  result?: Record<string, unknown>;
  message: string;
}> {
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
    result = await daemonRequest<Record<string, unknown>>("shutdown", {}, home);
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

/** Stop fully, then start a fresh daemon. */
export async function restartDaemon(home = forklightHome()): Promise<Record<string, unknown>> {
  await stopDaemon(home);
  return ensureDaemon(home);
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
        "tsx",
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

export function startDaemonProcess(home = forklightHome()): number {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const logFd = openSync(daemonLogPath(home), "a", 0o600);
  const launch = daemonLaunchArguments(import.meta.url);
  const child = spawn(launch.executable, launch.args, {
    detached: true,
    env: { ...process.env, FORKLIGHT_HOME: home },
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  closeSync(logFd);
  if (child.pid === undefined) throw new Error("Unable to start ForkLight daemon process");
  return child.pid;
}
