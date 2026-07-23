import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { AttemptRecord, AttemptTokenUsage, NormalizedWorkerEvent, TaskRecord } from "../core/types.js";
import type { StateStore } from "../state/store.js";
import { buildWorkerPrompt } from "../core/task.js";
import { providerEnvironment, resolveProvider } from "../core/providers.js";
import { readProviderKey } from "../core/secrets.js";
import { ClaudeEventNormalizer } from "../events/normalize.js";
import { cloneDefaults, type ExecutionSettings, type ProviderDefaultSettings } from "../core/settings.js";

export interface WorkerExecutionResult {
  status: "succeeded" | "failed" | "interrupted";
  exitCode: number;
  resultText?: string;
  costUsd?: number;
  turns?: number;
  error?: string;
  usage?: AttemptTokenUsage;
  runtimeCostEstimateUsd?: number;
}

export interface WorkerRunHooks {
  onSpawn?: (child: ChildProcess) => void;
  onEvent?: (event: NormalizedWorkerEvent) => void;
  wasInterrupted?: () => boolean;
  feedback?: string;
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
  const allowed = ["Read", "Glob", "Grep"];
  if (task.spec.worker.allowEdits) allowed.push("Edit", "Write");
  const denied = [
    "Bash",
    "WebFetch",
    "WebSearch",
    "Task",
  ];
  return { tools: allowed.join(","), allowed: allowed.join(","), denied: denied.join(",") };
}

export function budgetArguments(maxBudgetUsd: number | null): string[] {
  if (maxBudgetUsd === null) return [];
  return ["--max-budget-usd", String(maxBudgetUsd)];
}

function claudeArguments(task: TaskRecord, resuming: boolean, prompt: string): string[] {
  const permission = allowedToolArguments(task);
  const args = [
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
    ...budgetArguments(task.spec.runtime.maxBudgetUsd),
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
  args.push(prompt);
  return args;
}

function childEnvironment(
  task: TaskRecord,
  apiKey: string,
  providerDefaults?: ProviderDefaultSettings,
): NodeJS.ProcessEnv {
  const provider = resolveProvider(task.spec.provider.name, task.spec.provider, providerDefaults);
  return providerEnvironment(provider, apiKey, {
    ...process.env,
    CLAUDE_CONFIG_DIR: task.paths.claudeConfig,
  });
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

function looksLikeBudgetExhaustion(text: string | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return lower.includes("error_max_budget")
    || lower.includes("max_budget_usd")
    || lower.includes("max-budget-usd")
    || lower.includes("exceeded your max budget")
    || (lower.includes("budget") && (lower.includes("exceed") || lower.includes("reached")));
}

/**
 * Prefer explicit budget diagnostics over generic "no result event" (FL-D23).
 * Runtime estimate is labeled as such — not an official Provider bill.
 */
export function resolveWorkerFailure(
  terminal: NormalizedWorkerEvent["terminal"] | undefined,
  stderr: string,
): string {
  const haystack = [
    terminal?.failureReason,
    terminal?.resultText,
    stderr,
  ].filter((part): part is string => typeof part === "string" && part.trim().length > 0).join("\n");

  if (looksLikeBudgetExhaustion(haystack) || looksLikeBudgetExhaustion(terminal?.failureReason)) {
    const estimate = terminal?.runtimeCostEstimateUsd ?? terminal?.costUsd;
    if (typeof estimate === "number" && Number.isFinite(estimate)) {
      return `Worker stopped: max budget exceeded (runtime estimate $${estimate.toFixed(6)}; not Provider official cost)`;
    }
    return "Worker stopped: max budget exceeded";
  }

  return terminal?.resultText?.trim()
    || terminal?.failureReason
    || stderr.trim().slice(0, 2_000)
    || "Claude Code exited without a successful result event";
}

export async function runClaudeWorker(
  store: StateStore,
  task: TaskRecord,
  attempt: AttemptRecord,
  resuming: boolean,
  hooks: WorkerRunHooks = {},
  executionSettings?: ExecutionSettings,
  providerDefaults?: ProviderDefaultSettings,
): Promise<WorkerExecutionResult> {
  await mkdir(task.paths.logs, { recursive: true, mode: 0o700 });
  await mkdir(task.paths.claudeConfig, { recursive: true, mode: 0o700 });
  const apiKey = readProviderKey(task.spec);
  const normalizer = new ClaudeEventNormalizer();
  const rawLog = createWriteStream(attempt.rawLogPath, { flags: "a", mode: 0o600 });
  const stderrPath = path.join(task.paths.logs, `attempt-${attempt.ordinal}.stderr.log`);
  const stderrChunks: string[] = [];
  let terminal: NormalizedWorkerEvent["terminal"];

  // --- no-progress watchdog ---
  const exec = executionSettings ?? cloneDefaults().execution;
  let watchdogTimer: ReturnType<typeof setTimeout> | undefined;
  let escalationTimer: ReturnType<typeof setTimeout> | undefined;
  let watchdogFired = false;
  let watchdogTerminal = false;

  const clearWatchdog = (): void => {
    if (watchdogTimer !== undefined) {
      clearTimeout(watchdogTimer);
      watchdogTimer = undefined;
    }
    if (escalationTimer !== undefined) {
      clearTimeout(escalationTimer);
      escalationTimer = undefined;
    }
  };

  const scheduleWatchdog = (): void => {
    if (watchdogTerminal || watchdogFired) return;
    if (watchdogTimer !== undefined) clearTimeout(watchdogTimer);
    const timeout = setTimeout(() => {
      watchdogFired = true;
      const pid = child?.pid;
      if (pid !== undefined && child?.exitCode === null && child?.signalCode === null) {
        child.kill("SIGINT");
        const escalation = setTimeout(() => {
          if (child?.exitCode === null && child?.signalCode === null) {
            child.kill("SIGTERM");
          }
          escalationTimer = undefined;
        }, exec.workerStopGraceMs);
        escalation.unref();
        escalationTimer = escalation;
      }
    }, exec.noProgressTimeoutMs);
    timeout.unref();
    watchdogTimer = timeout;
  };

  const prompt = buildWorkerPrompt(task.spec, resuming, hooks.feedback);
  await writeFile(path.join(task.paths.logs, `attempt-${attempt.ordinal}.prompt.txt`), prompt, {
    mode: 0o600,
  });
  const launch = workerLaunch(task, claudeArguments(task, resuming, prompt));
  store.addEvent(
    task.id,
    attempt.id,
    resuming ? "worker.resumed" : "worker.started",
    resuming ? "Claude Code Worker resumed" : "Claude Code Worker started",
    {
      model: task.spec.provider.model,
      provider: task.spec.provider.name,
      runtime: task.spec.runtime.name,
      isolation: launch.isolation,
      correctionFeedbackIncluded: Boolean(hooks.feedback),
    },
  );

  const child = spawn(launch.command, launch.args, {
    cwd: task.paths.workspace,
    env: childEnvironment(task, apiKey, providerDefaults),
    stdio: ["ignore", "pipe", "pipe"],
  });
  hooks.onSpawn?.(child);
  if (child.pid !== undefined) {
    store.updateAttempt(attempt.id, { pid: child.pid });
    store.updateTask(task.id, { workerPid: child.pid });
  }

  // Start watchdog AFTER spawn so pre-spawn delay is not counted.
  scheduleWatchdog();

  child.stdout.pipe(rawLog);
  child.stderr.on("data", (chunk: Buffer) => {
    stderrChunks.push(redact(chunk.toString(), apiKey));
  });

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", (line) => {
    for (const event of normalizer.parseLine(line)) {
      if (event.terminal) {
        terminal = event.terminal;
        watchdogTerminal = true;
        if (!watchdogFired && watchdogTimer !== undefined) {
          clearTimeout(watchdogTimer);
          watchdogTimer = undefined;
        }
      }
      // Only normalized tool lifecycle resets the watchdog, never narration.
      if (event.type === "worker.tool.started" || event.type === "worker.tool.completed") {
        scheduleWatchdog();
      }
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
        clearWatchdog();
        resolve({ code: code ?? (signal ? 128 : 1), signal, ...(spawnError ? { spawnError } : {}) });
      });
    },
  );
  await new Promise<void>((resolve) => rawLog.end(resolve));
  await writeFile(stderrPath, stderrChunks.join(""), { mode: 0o600 });

  // Watchdog timeout must be classified before user interruption —
  // the watchdog itself sends SIGINT so signal-based detection is ambiguous.
  if (watchdogFired) {
    return {
      status: "failed",
      exitCode: interruptedExitCode(outcome.code),
      ...(terminal?.resultText === undefined ? {} : { resultText: terminal.resultText }),
      ...(terminal?.costUsd === undefined ? {} : { costUsd: terminal.costUsd }),
      ...(terminal?.turns === undefined ? {} : { turns: terminal.turns }),
      ...(terminal?.runtimeCostEstimateUsd === undefined ? {} : { runtimeCostEstimateUsd: terminal.runtimeCostEstimateUsd }),
      ...(terminal?.usage === undefined ? {} : { usage: terminal.usage }),
      error: "No effective implementation progress detected within the configured interval; worker was terminated by the progress watchdog",
    };
  }

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
      ...(terminal?.runtimeCostEstimateUsd === undefined ? {} : { runtimeCostEstimateUsd: terminal.runtimeCostEstimateUsd }),
      ...(terminal?.usage === undefined ? {} : { usage: terminal.usage }),
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
      ...(terminal?.runtimeCostEstimateUsd === undefined ? {} : { runtimeCostEstimateUsd: terminal.runtimeCostEstimateUsd }),
      ...(terminal?.usage === undefined ? {} : { usage: terminal.usage }),
      error: resolveWorkerFailure(terminal, stderr),
    };
  }

  return {
    status: "succeeded",
    exitCode: outcome.code,
    ...(terminal.resultText === undefined ? {} : { resultText: terminal.resultText }),
    ...(terminal.costUsd === undefined ? {} : { costUsd: terminal.costUsd }),
    ...(terminal.turns === undefined ? {} : { turns: terminal.turns }),
    ...(terminal.runtimeCostEstimateUsd === undefined ? {} : { runtimeCostEstimateUsd: terminal.runtimeCostEstimateUsd }),
    ...(terminal.usage === undefined ? {} : { usage: terminal.usage }),
  };
}
