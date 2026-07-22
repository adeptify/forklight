import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { daemonLogPath, daemonSocketPath, forklightHome } from "../core/config.js";
import type { DaemonMethod, DaemonRequest, DaemonResponse } from "./protocol.js";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function daemonRequest<T = unknown>(
  method: DaemonMethod,
  params: Record<string, unknown> = {},
  home = forklightHome(),
): Promise<T> {
  const request: DaemonRequest = { id: randomUUID(), method, params };
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
    }, 15_000);
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
      if (!response.ok) reject(new Error(response.error ?? "ForkLight daemon request failed"));
      else resolve(response.result as T);
    });
  });
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

export function startDaemonProcess(home = forklightHome()): number {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const logFd = openSync(daemonLogPath(home), "a", 0o600);
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const mainPath = path.join(currentDirectory, "main.js");
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", mainPath], {
    detached: true,
    env: { ...process.env, FORKLIGHT_HOME: home },
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  closeSync(logFd);
  if (child.pid === undefined) throw new Error("Unable to start ForkLight daemon process");
  return child.pid;
}
