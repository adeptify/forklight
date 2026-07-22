import { chmod, mkdir, unlink } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { createInterface } from "node:readline";
import { daemonSocketPath } from "../core/config.js";
import type { TaskStatus } from "../core/types.js";
import { StateStore } from "../state/store.js";
import { DaemonCoordinator } from "./coordinator.js";
import type { DaemonRequest, DaemonResponse } from "./protocol.js";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

export class ForkLightDaemon {
  private readonly store: StateStore;
  private readonly coordinator: DaemonCoordinator;
  private readonly socketPath: string;
  private server?: net.Server;

  constructor(
    private readonly home: string,
    maxConcurrency = Number(process.env.FORKLIGHT_MAX_WORKERS ?? 2),
  ) {
    this.store = new StateStore(home);
    this.coordinator = new DaemonCoordinator(this.store, maxConcurrency);
    this.socketPath = daemonSocketPath(home);
  }

  async start(): Promise<void> {
    await mkdir(path.dirname(this.socketPath), { recursive: true, mode: 0o700 });
    try {
      await unlink(this.socketPath);
    } catch {
      // No stale socket.
    }
    await this.coordinator.recover();
    this.server = net.createServer((socket) => {
      const lines = createInterface({ input: socket, crlfDelay: Infinity });
      lines.on("line", (line) => {
        void this.handleLine(line).then((response) => {
          socket.write(`${JSON.stringify(response)}\n`);
        });
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.socketPath, resolve);
    });
    await chmod(this.socketPath, 0o600);
  }

  async close(): Promise<void> {
    await this.coordinator.shutdown();
    if (this.server) {
      await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    }
    try {
      await unlink(this.socketPath);
    } catch {
      // Socket may already be gone.
    }
    this.store.close();
  }

  private async handleLine(line: string): Promise<DaemonResponse> {
    let request: DaemonRequest;
    try {
      request = JSON.parse(line) as DaemonRequest;
      if (!request.id || !request.method) throw new Error("Malformed daemon request");
      const result = await this.dispatch(request);
      return { id: request.id, ok: true, result };
    } catch (error) {
      const fallbackId = (() => {
        try {
          return (JSON.parse(line) as { id?: string }).id ?? "unknown";
        } catch {
          return "unknown";
        }
      })();
      return {
        id: fallbackId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async dispatch(request: DaemonRequest): Promise<unknown> {
    const params = object(request.params);
    switch (request.method) {
      case "health":
        return this.coordinator.health();
      case "submit_file":
        return this.coordinator.submitFile(requiredString(params.taskFile, "taskFile"));
      case "submit":
        return this.coordinator.submit(
          params.task,
          typeof params.baseDirectory === "string" ? params.baseDirectory : process.cwd(),
        );
      case "status":
        return this.coordinator.status(requiredString(params.taskId, "taskId"));
      case "inspect":
        return this.coordinator.inspect(requiredString(params.taskId, "taskId"));
      case "resume":
        return this.coordinator.resume(requiredString(params.taskId, "taskId"));
      case "list": {
        const statuses = Array.isArray(params.statuses)
          ? params.statuses.filter((value): value is TaskStatus => typeof value === "string")
          : undefined;
        const limit = typeof params.limit === "number" ? params.limit : 20;
        return this.coordinator.list(statuses, limit);
      }
      case "shutdown":
        setImmediate(() => process.kill(process.pid, "SIGTERM"));
        return { stopping: true };
      default:
        throw new Error(`Unknown daemon method: ${String(request.method)}`);
    }
  }
}
