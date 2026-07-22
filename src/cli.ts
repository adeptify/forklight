#!/usr/bin/env -S node --disable-warning=ExperimentalWarning

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { forklightHome } from "./core/config.js";
import type { EventRecord, NormalizedWorkerEvent, TaskRecord } from "./core/types.js";
import { reconcileTask, resumeTask, runNewTask } from "./core/runner.js";
import { StateStore } from "./state/store.js";
import { daemonRequest, ensureDaemon } from "./daemon/client.js";

function usage(): string {
  return `ForkLight P2

Usage:
  forklight run <task.yaml>
  forklight submit <task.yaml>
  forklight status <task-id> [--json]
  forklight resume <task-id>
  forklight inspect <task-id> [--json]
  forklight list [--json]
  forklight daemon <start|status|stop>
  forklight health [--json]
`;
}

function required(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Missing ${label}\n\n${usage()}`);
  return value;
}

function printProgress(event: NormalizedWorkerEvent): void {
  if (event.type === "worker.message" && event.summary.length > 180) return;
  const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
  process.stdout.write(`[${time}] ${event.summary}\n`);
}

function taskSummary(task: TaskRecord): Record<string, unknown> {
  return {
    id: task.id,
    name: task.name,
    status: task.status,
    model: task.spec.provider.model,
    runtime: task.spec.runtime.name,
    source: task.sourcePath,
    workspace: task.paths.workspace,
    sessionId: task.sessionId,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    error: task.error,
  };
}

function printHumanStatus(task: TaskRecord): void {
  const summary = taskSummary(task);
  for (const [key, value] of Object.entries(summary)) {
    if (value !== undefined) process.stdout.write(`${key}: ${String(value)}\n`);
  }
}

async function inspect(store: StateStore, taskId: string, json: boolean): Promise<void> {
  const task = reconcileTask(store, taskId);
  const attempts = store.listAttempts(taskId);
  const events = store.listEvents(taskId);
  let diff = "";
  try {
    diff = await readFile(task.paths.diff, "utf8");
  } catch {
    // A diff does not exist until independent verification begins.
  }
  if (json) {
    process.stdout.write(`${JSON.stringify({ task, attempts, events, diff }, null, 2)}\n`);
    return;
  }
  printHumanStatus(task);
  process.stdout.write(`attempts: ${attempts.length}\n`);
  for (const attempt of attempts) {
    process.stdout.write(
      `  #${attempt.ordinal} ${attempt.status} exit=${attempt.exitCode ?? "-"} cost=$${attempt.costUsd?.toFixed(4) ?? "-"} turns=${attempt.turns ?? "-"}\n`,
    );
  }
  process.stdout.write("events:\n");
  for (const event of events) printStoredEvent(event);
  process.stdout.write(`diff: ${task.paths.diff}${diff ? ` (${diff.split("\n").length - 1} lines)` : " (not generated)"}\n`);
}

function printStoredEvent(event: EventRecord): void {
  process.stdout.write(`  ${event.sequence}. ${event.type} — ${event.summary}\n`);
}

function health(json: boolean): void {
  let claudeVersion = "unavailable";
  let keychain = false;
  try {
    claudeVersion = execFileSync("claude", ["--version"], { encoding: "utf8" }).trim();
  } catch {
    // Reported in health output.
  }
  try {
    execFileSync(
      "security",
      ["find-generic-password", "-a", userInfo().username, "-s", "forklight.deepseek.api-key"],
      { stdio: "ignore" },
    );
    keychain = true;
  } catch {
    // Reported in health output.
  }
  const result = {
    ok: claudeVersion !== "unavailable" && keychain,
    node: process.version,
    claudeCode: claudeVersion,
    deepseekKeychainEntry: keychain,
    home: forklightHome(),
  };
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else for (const [key, value] of Object.entries(result)) process.stdout.write(`${key}: ${value}\n`);
}

async function main(): Promise<void> {
  const [command, positional, ...rest] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(usage());
    return;
  }
  const json = rest.includes("--json") || positional === "--json";
  if (command === "health") {
    health(json);
    return;
  }

  if (command === "daemon") {
    const operation = required(positional, "daemon operation");
    if (operation === "start") {
      const result = await ensureDaemon();
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    if (operation === "status") {
      const result = await daemonRequest("health");
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    if (operation === "stop") {
      const result = await daemonRequest("shutdown");
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    throw new Error(`Unknown daemon operation: ${operation}`);
  }

  if (command === "submit") {
    await ensureDaemon();
    const task = await daemonRequest<TaskRecord>("submit_file", {
      taskFile: required(positional, "task file"),
    });
    process.stdout.write(`taskId: ${task.id}\n`);
    printHumanStatus(task);
    return;
  }

  const store = new StateStore(forklightHome());
  try {
    if (command === "run") {
      const result = await runNewTask(
        store,
        required(positional, "task file"),
        printProgress,
        (task) => process.stdout.write(`taskId: ${task.id}\n`),
      );
      printHumanStatus(result.task);
      if (result.task.status !== "succeeded") process.exitCode = result.task.status === "interrupted" ? 130 : 1;
      return;
    }
    if (command === "resume") {
      const taskId = required(positional, "task id");
      try {
        await ensureDaemon();
        const task = await daemonRequest<TaskRecord>("resume", { taskId });
        process.stdout.write(`queued: ${task.id}\n`);
      } catch {
        const result = await resumeTask(store, taskId, printProgress);
        printHumanStatus(result.task);
        if (result.task.status !== "succeeded") {
          process.exitCode = result.task.status === "interrupted" ? 130 : 1;
        }
      }
      return;
    }
    if (command === "status") {
      const task = reconcileTask(store, required(positional, "task id"));
      if (json) process.stdout.write(`${JSON.stringify(taskSummary(task), null, 2)}\n`);
      else printHumanStatus(task);
      return;
    }
    if (command === "inspect") {
      await inspect(store, required(positional, "task id"), json);
      return;
    }
    if (command === "list") {
      const tasks = store.listTasks().slice(0, 20).map(taskSummary);
      if (json) process.stdout.write(`${JSON.stringify(tasks, null, 2)}\n`);
      else for (const task of tasks) process.stdout.write(`${task.id} ${task.status} ${task.name}\n`);
      return;
    }
    throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  } finally {
    store.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`ForkLight error: ${message}\n`);
  process.exitCode = 1;
});
