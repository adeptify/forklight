import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";
import type { TaskRecord, TaskStatus } from "../core/types.js";
import {
  executeAttempt,
  prepareTaskWorkspace,
  registerTaskFromSpec,
  resumeTask,
} from "../core/runner.js";
import { loadTaskSpec, parseTaskSpec } from "../core/task.js";
import type { StateStore } from "../state/store.js";

interface QueuedJob {
  taskId: string;
  resuming: boolean;
}

function timestamp(): string {
  return new Date().toISOString();
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function looksLikeWorker(pid: number): boolean {
  try {
    const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return /(?:claude|sandbox-exec)/i.test(command);
  } catch {
    return false;
  }
}

async function stopOrphanWorker(pid: number): Promise<void> {
  if (!processExists(pid) || !looksLikeWorker(pid)) return;
  process.kill(pid, "SIGINT");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!processExists(pid)) return;
    await sleep(100);
  }
  if (processExists(pid) && looksLikeWorker(pid)) process.kill(pid, "SIGTERM");
}

export class DaemonCoordinator {
  private readonly queue: QueuedJob[] = [];
  private readonly active = new Map<string, Promise<void>>();
  private closing = false;

  constructor(
    private readonly store: StateStore,
    private readonly maxConcurrency = 2,
  ) {}

  health(): Record<string, unknown> {
    let claudeCode = "unavailable";
    let deepseekKeychainEntry = false;
    try {
      claudeCode = execFileSync("claude", ["--version"], { encoding: "utf8" }).trim();
    } catch {
      // Reported below.
    }
    try {
      execFileSync(
        "security",
        [
          "find-generic-password",
          "-a",
          userInfo().username,
          "-s",
          "forklight.deepseek.api-key",
        ],
        { stdio: "ignore" },
      );
      deepseekKeychainEntry = true;
    } catch {
      // Reported below.
    }
    return {
      ok: claudeCode !== "unavailable" && deepseekKeychainEntry,
      pid: process.pid,
      claudeCode,
      deepseekKeychainEntry,
      maxConcurrency: this.maxConcurrency,
      activeTaskIds: [...this.active.keys()],
      queuedTaskIds: this.queue.map((job) => job.taskId),
      databasePath: this.store.databasePath,
    };
  }

  async submitFile(taskFile: string): Promise<TaskRecord> {
    const loaded = await loadTaskSpec(taskFile);
    const task = registerTaskFromSpec(this.store, loaded.spec, loaded.taskFile);
    this.enqueue({ taskId: task.id, resuming: false });
    return this.store.getTask(task.id);
  }

  async submit(rawTask: unknown, baseDirectory: string): Promise<TaskRecord> {
    const spec = parseTaskSpec(rawTask, baseDirectory);
    const task = registerTaskFromSpec(this.store, spec, "forklight://mcp/inline-task");
    this.enqueue({ taskId: task.id, resuming: false });
    return this.store.getTask(task.id);
  }

  resume(taskId: string): TaskRecord {
    const task = this.store.getTask(taskId);
    if (task.status !== "interrupted" && task.status !== "failed") {
      throw new Error(`Task ${taskId} cannot resume from status ${task.status}`);
    }
    this.enqueue({ taskId, resuming: this.store.listAttempts(taskId).length > 0 });
    return task;
  }

  status(taskId: string): TaskRecord {
    return this.store.getTask(taskId);
  }

  list(statuses?: TaskStatus[], limit = 20): TaskRecord[] {
    return this.store.listTasks(statuses).slice(0, Math.max(1, Math.min(limit, 100)));
  }

  async inspect(taskId: string): Promise<Record<string, unknown>> {
    const task = this.store.getTask(taskId);
    let diff = "";
    try {
      diff = await readFile(task.paths.diff, "utf8");
    } catch {
      // The diff is created when verification starts.
    }
    return {
      task,
      attempts: this.store.listAttempts(taskId),
      events: this.store.listEvents(taskId),
      diff,
    };
  }

  async recover(): Promise<string[]> {
    const recovered: string[] = [];
    const stale = this.store.listTasks(["preparing", "running", "verifying"]);
    for (const task of stale) {
      if (task.workerPid !== undefined) await stopOrphanWorker(task.workerPid);
      if (task.currentAttemptId) {
        try {
          const attempt = this.store.getAttempt(task.currentAttemptId);
          if (attempt.status === "running") {
            this.store.updateAttempt(attempt.id, {
              status: "interrupted",
              finishedAt: timestamp(),
              exitCode: 130,
              error: "ForkLight daemon restarted during execution",
            });
          }
        } catch {
          // A preparing task may not have an attempt yet.
        }
      }
      const hasAttempts = this.store.listAttempts(task.id).length > 0;
      this.store.setTaskStatus(task.id, "interrupted", {
        finishedAt: timestamp(),
        workerPid: null,
        error: "ForkLight daemon restarted during execution",
      });
      this.store.addEvent(
        task.id,
        task.currentAttemptId,
        "worker.interrupted",
        "Daemon restart detected; task queued for recovery",
      );
      this.enqueue({ taskId: task.id, resuming: hasAttempts });
      recovered.push(task.id);
    }
    return recovered;
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    for (const taskId of this.active.keys()) {
      const task = this.store.getTask(taskId);
      if (task.workerPid !== undefined && processExists(task.workerPid) && looksLikeWorker(task.workerPid)) {
        process.kill(task.workerPid, "SIGINT");
      }
    }
    await Promise.allSettled(this.active.values());
  }

  private enqueue(job: QueuedJob): void {
    if (this.closing) throw new Error("ForkLight daemon is shutting down");
    if (this.active.has(job.taskId) || this.queue.some((queued) => queued.taskId === job.taskId)) {
      throw new Error(`Task ${job.taskId} is already queued or running`);
    }
    this.queue.push(job);
    this.pump();
  }

  private pump(): void {
    while (!this.closing && this.active.size < this.maxConcurrency && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) return;
      const execution = this.execute(job)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          const task = this.store.getTask(job.taskId);
          const recordedError = task.status === "failed" && task.error ? task.error : message;
          this.store.setTaskStatus(job.taskId, "failed", {
            finishedAt: timestamp(),
            workerPid: null,
            error: recordedError,
          });
          this.store.addEvent(
            job.taskId,
            task.currentAttemptId,
            "worker.failed",
            `Daemon execution failed: ${recordedError}`,
          );
        })
        .finally(() => {
          this.active.delete(job.taskId);
          this.pump();
        });
      this.active.set(job.taskId, execution);
    }
  }

  private async execute(job: QueuedJob): Promise<void> {
    if (job.resuming) {
      await resumeTask(this.store, job.taskId);
    } else {
      const prepared = await prepareTaskWorkspace(this.store, this.store.getTask(job.taskId));
      await executeAttempt(this.store, prepared, false);
    }
  }
}
