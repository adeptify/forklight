import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { AttemptRecord, NormalizedWorkerEvent, TaskRecord } from "../core/types.js";
import type { StateStore } from "../state/store.js";
import { buildWorkerPrompt } from "../core/task.js";
import { readProviderKey } from "../core/secrets.js";
import { ClaudeEventNormalizer } from "../events/normalize.js";

export interface WorkerExecutionResult {
  status: "succeeded" | "failed" | "interrupted";
  exitCode: number;
  resultText?: string;
  costUsd?: number;
  turns?: number;
  error?: string;
}

export interface WorkerRunHooks {
  onSpawn?: (child: ChildProcess) => void;
  onEvent?: (event: NormalizedWorkerEvent) => void;
  wasInterrupted?: () => boolean;
}

export interface WorkerLaunch {
  command: string;
  args: string[];
  isolation: "macos-sandbox" | "runtime-permissions";
}

export function allowedToolArguments(task: TaskRecord): {
  tools: string;
  allowed: string;
  denied: string;
} {
  const tools = ["Read", "Glob", "Grep"];
  if (task.spec.worker.allowEdits) tools.push("Edit", "Write");
  const allowed = [...tools];
  const denied = [
    "Bash",
    "WebFetch",
    "WebSearch",
  ];
  return { tools: tools.join(","), allowed: allowed.join(" "), denied: denied.join(" ") };
}

function claudeArguments(task: TaskRecord, resuming: boolean): string[] {
  const permission = allowedToolArguments(task);
  const args = [
    "--bare",
    "--safe-mode",
    "--no-chrome",
    "--disable-slash-commands",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--permission-mode",
    "dontAsk",
    "--tools",
    permission.tools,
    "--allowedTools",
    permission.allowed,
    "--disallowedTools",
    permission.denied,
    "--model",
    task.spec.provider.model,
    "--effort",
    task.spec.runtime.effort,
    "--max-budget-usd",
    String(task.spec.runtime.maxBudgetUsd),
    "--name",
    `forklight-${task.id.slice(0, 8)}`,
    "--verbose",
    "--print",
    "--output-format",
    "stream-json",
  ];
  if (resuming) {
    args.push("--resume", task.sessionId);
  } else {
    args.push("--session-id", task.sessionId);
  }
  args.push(buildWorkerPrompt(task.spec, resuming));
  return args;
}

function childEnvironment(task: TaskRecord, apiKey: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CLAUDE_CONFIG_DIR: task.paths.claudeConfig,
    ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
    ANTHROPIC_AUTH_TOKEN: apiKey,
    ANTHROPIC_API_KEY: apiKey,
    ANTHROPIC_MODEL: task.spec.provider.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: task.spec.provider.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: task.spec.provider.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
  };
}

function sandboxLiteral(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function executablePath(executable: string): string {
  const candidate = executable.includes("/")
    ? executable
    : execFileSync("/usr/bin/which", [executable], { encoding: "utf8" }).trim();
  return realpathSync(candidate);
}

export function workerLaunch(task: TaskRecord, claudeArgs: string[]): WorkerLaunch {
  if (process.platform !== "darwin") {
    return {
      command: task.spec.runtime.executable,
      args: claudeArgs,
      isolation: "runtime-permissions",
    };
  }

  const executable = executablePath(task.spec.runtime.executable);
  const runtimeDirectory = path.dirname(executable);
  const temporaryDirectory = realpathSync(process.env.TMPDIR ?? "/tmp");
  const writablePaths = [task.paths.workspace, task.paths.claudeConfig, temporaryDirectory];
  const writeRules = writablePaths
    .map((writablePath) => `  (subpath "${sandboxLiteral(writablePath)}")`)
    .join("\n");
  const profile = `(version 1)
(deny default)
(import "system.sb")
(allow process*)
(allow file-read*)
(deny file-read*
  (require-all
    (subpath "${sandboxLiteral(homedir())}")
    (require-not (subpath "${sandboxLiteral(task.paths.workspace)}"))
    (require-not (subpath "${sandboxLiteral(task.paths.claudeConfig)}"))
    (require-not (subpath "${sandboxLiteral(runtimeDirectory)}"))))
(allow file-write*
${writeRules})
(allow network*)`;
  return {
    command: "/usr/bin/sandbox-exec",
    args: ["-p", profile, executable, ...claudeArgs],
    isolation: "macos-sandbox",
  };
}

function redact(value: string, secret: string): string {
  return secret ? value.split(secret).join("[REDACTED]") : value;
}

export function interruptedExitCode(exitCode: number): number {
  return exitCode === 0 ? 130 : exitCode;
}

export async function runClaudeWorker(
  store: StateStore,
  task: TaskRecord,
  attempt: AttemptRecord,
  resuming: boolean,
  hooks: WorkerRunHooks = {},
): Promise<WorkerExecutionResult> {
  await mkdir(task.paths.logs, { recursive: true, mode: 0o700 });
  await mkdir(task.paths.claudeConfig, { recursive: true, mode: 0o700 });
  const apiKey = readProviderKey(task.spec);
  const normalizer = new ClaudeEventNormalizer();
  const rawLog = createWriteStream(attempt.rawLogPath, { flags: "a", mode: 0o600 });
  const stderrPath = path.join(task.paths.logs, `attempt-${attempt.ordinal}.stderr.log`);
  const stderrChunks: string[] = [];
  let terminal: NormalizedWorkerEvent["terminal"];

  const launch = workerLaunch(task, claudeArguments(task, resuming));
  store.addEvent(
    task.id,
    attempt.id,
    resuming ? "worker.resumed" : "worker.started",
    resuming ? "Claude Code Worker resumed" : "Claude Code Worker started",
    { model: task.spec.provider.model, runtime: task.spec.runtime.name, isolation: launch.isolation },
  );

  const child = spawn(launch.command, launch.args, {
    cwd: task.paths.workspace,
    env: childEnvironment(task, apiKey),
    stdio: ["ignore", "pipe", "pipe"],
  });
  hooks.onSpawn?.(child);
  if (child.pid !== undefined) {
    store.updateAttempt(attempt.id, { pid: child.pid });
    store.updateTask(task.id, { workerPid: child.pid });
  }

  child.stdout.pipe(rawLog);
  child.stderr.on("data", (chunk: Buffer) => {
    stderrChunks.push(redact(chunk.toString(), apiKey));
  });

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", (line) => {
    for (const event of normalizer.parseLine(line)) {
      if (event.terminal) terminal = event.terminal;
      if (event.terminal && hooks.wasInterrupted?.() === true) continue;
      store.addEvent(task.id, attempt.id, event.type, event.summary, event.payload);
      hooks.onEvent?.(event);
    }
  });

  const outcome = await new Promise<{ code: number; signal: NodeJS.Signals | null; spawnError?: Error }>(
    (resolve) => {
      let spawnError: Error | undefined;
      child.once("error", (error) => {
        spawnError = error;
      });
      child.once("close", (code, signal) => {
        resolve({ code: code ?? (signal ? 128 : 1), signal, ...(spawnError ? { spawnError } : {}) });
      });
    },
  );
  await new Promise<void>((resolve) => rawLog.end(resolve));
  await writeFile(stderrPath, stderrChunks.join(""), { mode: 0o600 });

  const interrupted = hooks.wasInterrupted?.() === true
    || outcome.signal === "SIGINT"
    || outcome.signal === "SIGTERM"
    || outcome.code === 130;
  if (interrupted) {
    return {
      status: "interrupted",
      exitCode: interruptedExitCode(outcome.code),
      ...(terminal?.resultText === undefined ? {} : { resultText: terminal.resultText }),
      ...(terminal?.costUsd === undefined ? {} : { costUsd: terminal.costUsd }),
      ...(terminal?.turns === undefined ? {} : { turns: terminal.turns }),
      error: "Worker execution interrupted",
    };
  }

  if (outcome.spawnError) {
    return {
      status: "failed",
      exitCode: outcome.code,
      error: `Unable to start Claude Code: ${outcome.spawnError.message}`,
    };
  }

  if (outcome.code !== 0 || !terminal || terminal.isError) {
    const stderr = stderrChunks.join("").trim();
    return {
      status: "failed",
      exitCode: outcome.code,
      ...(terminal?.resultText === undefined ? {} : { resultText: terminal.resultText }),
      ...(terminal?.costUsd === undefined ? {} : { costUsd: terminal.costUsd }),
      ...(terminal?.turns === undefined ? {} : { turns: terminal.turns }),
      error: terminal?.resultText ?? (stderr.slice(0, 2_000) || "Claude Code exited without a result event"),
    };
  }

  return {
    status: "succeeded",
    exitCode: outcome.code,
    ...(terminal.resultText === undefined ? {} : { resultText: terminal.resultText }),
    ...(terminal.costUsd === undefined ? {} : { costUsd: terminal.costUsd }),
    ...(terminal.turns === undefined ? {} : { turns: terminal.turns }),
  };
}
