import { spawn } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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

function parseActivationHandoff(value: unknown): ActivationHandoff {
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

export const ACTIVATION_OPERATION_ID_ENV = "FORKLIGHT_ACTIVATION_OPERATION_ID";
export const ACTIVATION_TASK_ID_ENV = "FORKLIGHT_ACTIVATION_TASK_ID";
export const ACTIVATION_RECEIPT_ID_ENV = "FORKLIGHT_ACTIVATION_RECEIPT_ID";

/** Consumed one-use handoff transport identity. Stripped at replacement Daemon
 *  child launch so a restarted Daemon never inherits stale handoff context. */
export const ACTIVATION_HANDOFF_ENV_KEYS = [
  ACTIVATION_OPERATION_ID_ENV,
  ACTIVATION_TASK_ID_ENV,
  ACTIVATION_RECEIPT_ID_ENV,
] as const;

/** Set operation-context environment variables for every child process
 *  spawned by the activation commands.  The daemon validates these values
 *  against its durable Integration state — they are transport only, not
 *  authority.  Must be called AFTER consuming the one-use handoff. */
export function setActivationHandoffContext(handoff: ActivationHandoff): void {
  process.env[ACTIVATION_OPERATION_ID_ENV] = handoff.operationId;
  process.env[ACTIVATION_TASK_ID_ENV] = handoff.taskId;
  process.env[ACTIVATION_RECEIPT_ID_ENV] = handoff.receiptId;
}

/** Read the operation context set by the activation main entry point.
 *  Returns undefined when the current process was not launched from a
 *  validated activation handoff. */
export function readActivationHandoffContext(): {
  operationId: string;
  taskId: string;
  receiptId: string;
} | undefined {
  const operationId = process.env[ACTIVATION_OPERATION_ID_ENV];
  const taskId = process.env[ACTIVATION_TASK_ID_ENV];
  const receiptId = process.env[ACTIVATION_RECEIPT_ID_ENV];
  if (operationId === undefined || taskId === undefined || receiptId === undefined) {
    return undefined;
  }
  return { operationId, taskId, receiptId };
}

/** Resolve the repository-installed tsx loader as a cwd-independent file URL.
 *  Bare `--import tsx` fails when the child cwd is an isolated Integration
 *  source tree that does not have tsx on its own module path. */
export function resolveTsxImportSpecifier(fromModuleUrl: string): string {
  const require = createRequire(fromModuleUrl);
  return pathToFileURL(require.resolve("tsx")).href;
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
        { cwd: handoff.sourcePath, timeoutMs: handoff.timeoutMs, env: process.env },
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

function activationLaunchArguments(moduleUrl: string, handoffPath: string): {
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
          resolveTsxImportSpecifier(moduleUrl),
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
    env: {
      ...process.env,
      FORKLIGHT_ACTIVATION_LOG: logPath,
    },
  });
  child.unref();
  if (child.pid === undefined) throw new Error("Unable to launch activation runner");
  return child.pid;
}
