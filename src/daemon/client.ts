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
  const requested = method === "integration_wait" ? params.timeoutMs : undefined;
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

/** Request graceful daemon shutdown. No-op error if already down. */
export async function stopDaemon(home = forklightHome()): Promise<{
  stopped: boolean;
  result?: Record<string, unknown>;
  message: string;
}> {
  try {
    const result = await daemonRequest<Record<string, unknown>>("shutdown", {}, home);
    return {
      stopped: true,
      result,
      message: "Daemon shutdown requested",
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Treat "not running" as success for control UX.
    if (/ECONNREFUSED|ENOENT|connect|not running|timed out/i.test(msg)) {
      return { stopped: true, message: "Daemon was not running" };
    }
    throw error;
  }
}

/** Stop (if up) then ensureDaemon. */
export async function restartDaemon(home = forklightHome()): Promise<Record<string, unknown>> {
  try {
    await stopDaemon(home);
  } catch {
    /* continue to start */
  }
  // Allow socket cleanup after shutdown.
  await sleep(250);
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
