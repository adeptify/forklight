import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import YAML from "yaml";
import type { TaskSpec } from "./types.js";

const DEFAULT_EXCLUDES = [
  ".git",
  ".runtime",
  ".forklight",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".DS_Store",
];

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function stringArray(value: unknown, label: string, fallback: string[] = []): string[] {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  return value.map((item) => (item as string).trim());
}

function booleanValue(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function numberValue(value: unknown, label: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return value;
}

function expandHome(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return path.join(homedir(), input.slice(2));
  return input;
}

export function parseTaskSpec(parsed: unknown, baseDirectory: string): TaskSpec {
  const root = object(parsed, "task");

  if (root.version !== 1) throw new Error("task.version must be 1");

  const provider = object(root.provider ?? {}, "task.provider");
  const runtime = object(root.runtime ?? {}, "task.runtime");
  const workspace = object(root.workspace ?? {}, "task.workspace");
  const worker = object(root.worker ?? {}, "task.worker");
  const acceptance = object(root.acceptance ?? {}, "task.acceptance");

  const projectInput = stringValue(root.project, "task.project");
  const project = path.resolve(baseDirectory, expandHome(projectInput));

  const providerName = stringValue(provider.name, "task.provider.name", "deepseek");
  if (providerName !== "deepseek") {
    throw new Error(`ForkLight P2 supports provider.name=deepseek, received ${providerName}`);
  }

  const runtimeName = stringValue(runtime.name, "task.runtime.name", "claude-code");
  if (runtimeName !== "claude-code") {
    throw new Error(`ForkLight P2 supports runtime.name=claude-code, received ${runtimeName}`);
  }

  const effort = stringValue(runtime.effort, "task.runtime.effort", "max");
  if (!["low", "medium", "high", "xhigh", "max"].includes(effort)) {
    throw new Error("task.runtime.effort must be low, medium, high, xhigh, or max");
  }

  const acceptanceCommands = stringArray(acceptance.commands, "task.acceptance.commands");
  if (acceptanceCommands.length === 0) {
    throw new Error("task.acceptance.commands must contain at least one independent verification command");
  }
  const workerAllowedCommands = stringArray(worker.allowedCommands, "task.worker.allowedCommands");
  if (workerAllowedCommands.length > 0) {
    throw new Error(
      "ForkLight P2 requires task.worker.allowedCommands to be empty; acceptance commands run independently",
    );
  }

  const spec: TaskSpec = {
    version: 1,
    name: stringValue(root.name, "task.name"),
    project,
    goal: stringValue(root.goal, "task.goal"),
    constraints: stringArray(root.constraints, "task.constraints"),
    provider: {
      name: "deepseek",
      model: stringValue(provider.model, "task.provider.model", "deepseek-v4-flash"),
      keychainService: stringValue(
        provider.keychainService,
        "task.provider.keychainService",
        "forklight.deepseek.api-key",
      ),
      ...(provider.keychainAccount === undefined
        ? {}
        : { keychainAccount: stringValue(provider.keychainAccount, "task.provider.keychainAccount") }),
    },
    runtime: {
      name: "claude-code",
      executable: stringValue(runtime.executable, "task.runtime.executable", "claude"),
      effort: effort as TaskSpec["runtime"]["effort"],
      maxBudgetUsd: numberValue(runtime.maxBudgetUsd, "task.runtime.maxBudgetUsd", 0.5),
    },
    workspace: {
      exclude: Array.from(
        new Set([...DEFAULT_EXCLUDES, ...stringArray(workspace.exclude, "task.workspace.exclude")]),
      ),
    },
    worker: {
      allowEdits: booleanValue(worker.allowEdits, "task.worker.allowEdits", true),
      allowedCommands: workerAllowedCommands,
    },
    acceptance: {
      commands: acceptanceCommands,
    },
  };

  return spec;
}

export async function loadTaskSpec(taskFileInput: string): Promise<{ taskFile: string; spec: TaskSpec }> {
  const taskFile = path.resolve(expandHome(taskFileInput));
  const rawText = await readFile(taskFile, "utf8");
  const parsed = taskFile.endsWith(".json") ? JSON.parse(rawText) : YAML.parse(rawText);
  const spec = parseTaskSpec(parsed, path.dirname(taskFile));
  await access(spec.project, constants.R_OK);
  return { taskFile, spec };
}

export function buildWorkerPrompt(spec: TaskSpec, resuming: boolean): string {
  const lines = [
    resuming
      ? "Resume the previously interrupted bounded coding task from the existing session."
      : "Execute this bounded coding task in the current isolated workspace.",
    "",
    `Task: ${spec.name}`,
    `Goal: ${spec.goal}`,
    "",
    "Hard boundaries:",
    "- Work only inside the current workspace.",
    "- Do not read or modify the source project, ForkLight state, or any parent directory.",
    "- Never commit, push, create a pull request, or change Git remotes.",
    "- Shell access is intentionally unavailable. Do not attempt to run commands.",
    "- ForkLight will run the acceptance commands independently after you finish.",
    "- Inspect the final changes before reporting completion.",
  ];

  for (const constraint of spec.constraints) lines.push(`- ${constraint}`);

  lines.push("", "Acceptance commands ForkLight will run after you finish:");
  for (const command of spec.acceptance.commands) lines.push(`- ${command}`);

  lines.push(
    "",
    "Return a concise summary containing: files changed, behavior changed, verification run, and any remaining risk.",
  );
  return lines.join("\n");
}
