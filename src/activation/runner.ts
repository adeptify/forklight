import { spawn } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ActivationHandoff,
  IntegrationStageEvidence,
  VerificationCommandResult,
} from "../core/types.js";
import { runCaptured } from "../core/process.js";

const HANDOFF_MAX_BYTES = 64 * 1024;

function commandList(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value)
    || value.length > 16
    || value.some((item) => typeof item !== "string" || item.trim().length === 0)
  ) {
    throw new Error(`${label} must contain at most 16 non-empty commands`);
  }
  return value as string[];
}

export function parseActivationHandoff(value: unknown): ActivationHandoff {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Activation handoff must be an object");
  }
  const input = value as Record<string, unknown>;
  const allowed = new Set([
    "version",
    "operationId",
    "taskId",
    "receiptId",
    "home",
    "sourcePath",
    "timeoutMs",
    "activationCommands",
    "activationCheckCommands",
  ]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`Activation handoff contains unknown fields: ${unknown.join(", ")}`);
  }
  const stringField = (key: "operationId" | "taskId" | "receiptId" | "home" | "sourcePath"): string => {
    const valueAtKey = input[key];
    if (typeof valueAtKey !== "string" || valueAtKey.trim().length === 0) {
      throw new Error(`Activation handoff ${key} must be a non-empty string`);
    }
    return valueAtKey;
  };
  if (input.version !== 1) throw new Error("Unsupported activation handoff version");
  if (
    !Number.isSafeInteger(input.timeoutMs)
    || (input.timeoutMs as number) <= 0
    || (input.timeoutMs as number) > 3_600_000
  ) {
    throw new Error("Activation handoff timeoutMs must be an integer from 1 to 3600000");
  }
  const home = stringField("home");
  const sourcePath = stringField("sourcePath");
  if (!path.isAbsolute(home) || !path.isAbsolute(sourcePath)) {
    throw new Error("Activation handoff home and sourcePath must be absolute");
  }
  return {
    version: 1,
    operationId: stringField("operationId"),
    taskId: stringField("taskId"),
    receiptId: stringField("receiptId"),
    home,
    sourcePath,
    timeoutMs: input.timeoutMs as number,
    activationCommands: commandList(input.activationCommands, "activationCommands"),
    activationCheckCommands: commandList(
      input.activationCheckCommands,
      "activationCheckCommands",
    ),
  };
}

export async function writeActivationHandoff(
  taskRoot: string,
  handoff: ActivationHandoff,
): Promise<string> {
  const directory = path.join(taskRoot, "integration", handoff.receiptId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const handoffPath = path.join(directory, `activation-${handoff.operationId}.json`);
  const serialized = `${JSON.stringify(handoff)}\n`;
  if (Buffer.byteLength(serialized) > HANDOFF_MAX_BYTES) {
    throw new Error("Activation handoff exceeds 64 KiB");
  }
  await writeFile(handoffPath, serialized, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await chmod(handoffPath, 0o600);
  return handoffPath;
}

export async function consumeActivationHandoff(
  handoffPath: string,
): Promise<ActivationHandoff> {
  const metadata = await lstat(handoffPath);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
    throw new Error("Activation handoff must be a regular 0600 file");
  }
  if (metadata.size > HANDOFF_MAX_BYTES) {
    throw new Error("Activation handoff exceeds 64 KiB");
  }
  const raw = await readFile(handoffPath, "utf8");
  const handoff = parseActivationHandoff(JSON.parse(raw) as unknown);
  await unlink(handoffPath);
  return handoff;
}

async function executeCommands(
  commands: string[],
  handoff: ActivationHandoff,
): Promise<VerificationCommandResult[]> {
  const results: VerificationCommandResult[] = [];
  for (const command of commands) {
    try {
      const result = await runCaptured(
        "/bin/zsh",
        ["-lc", command],
        { cwd: handoff.sourcePath, timeoutMs: handoff.timeoutMs },
      );
      results.push({
        command,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
      });
    } catch (error) {
      results.push({
        command,
        exitCode: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        durationMs: 0,
        timedOut: false,
      });
    }
  }
  return results;
}

export async function runActivation(
  handoff: ActivationHandoff,
): Promise<IntegrationStageEvidence> {
  const activationResults = await executeCommands(handoff.activationCommands, handoff);
  const activationPassed = activationResults.every((result) => result.exitCode === 0);
  const checkResults = activationPassed
    ? await executeCommands(handoff.activationCheckCommands, handoff)
    : [];
  const commands = [...activationResults, ...checkResults];
  const passed =
    activationPassed
    && checkResults.every((result) => result.exitCode === 0);
  return {
    stage: "runtime-activated",
    status: passed ? "passed" : "failed",
    ...(commands.length === 0 ? {} : { commands }),
    ...(passed ? {} : { error: "Runtime activation or activation check failed" }),
  };
}

export function activationLaunchArguments(moduleUrl: string, handoffPath: string): {
  executable: string;
  args: string[];
} {
  const modulePath = fileURLToPath(moduleUrl);
  const source = modulePath.endsWith(".ts");
  const mainPath = path.join(path.dirname(modulePath), source ? "main.ts" : "main.js");
  return {
    executable: process.execPath,
    args: source
      ? [
          "--disable-warning=ExperimentalWarning",
          "--import",
          "tsx",
          mainPath,
          handoffPath,
        ]
      : ["--disable-warning=ExperimentalWarning", mainPath, handoffPath],
  };
}

export function launchActivationRunner(handoffPath: string, logPath: string): number {
  const launch = activationLaunchArguments(import.meta.url, handoffPath);
  const child = spawn(launch.executable, launch.args, {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env, FORKLIGHT_ACTIVATION_LOG: logPath },
  });
  child.unref();
  if (child.pid === undefined) throw new Error("Unable to launch activation runner");
  return child.pid;
}
