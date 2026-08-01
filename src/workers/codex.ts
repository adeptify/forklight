import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, copyFile, lstat, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { noProgressFromSnapshot, stopGraceFromSnapshot } from "../core/advanced-policy.js";
import { buildWorkerPrompt, workerPromptAppendicesForTask } from "../core/task.js";
import type { NormalizedWorkerEvent, TaskRecord } from "../core/types.js";
import {
  codexAgentMessageFromLine,
  CodexEventNormalizer,
} from "../events/codex-normalize.js";
import { cloneDefaults } from "../core/settings.js";
import type {
  RuntimeSpecView,
  WorkerAdapter,
  WorkerCapabilityMatrix,
  WorkerDoctorResult,
  WorkerExecutionResult,
  WorkerRunContext,
} from "./types.js";

const CODEX_AUTH_MAX_BYTES = 2 * 1024 * 1024;
const CODEX_CATALOG_MAX_BYTES = 4 * 1024 * 1024;

const CODEX_CAPABILITIES: WorkerCapabilityMatrix = {
  budgetFlag: "unsupported",
  checkpoint: "unsupported",
  isolation: "supported",
  toolsPolicy: "supported",
  effortMapping: "supported",
  costUsageFidelity: "partial",
  sessionResume: "unsupported",
  streamingEvents: "supported",
  progressHeartbeat: "any-nonterminal-stream-event",
};

function configValue(key: string, value: string | number | boolean): string {
  return `${key}=${typeof value === "string" ? JSON.stringify(value) : String(value)}`;
}

export function buildCodexCliArgs(input: {
  prompt: string;
  workspace: string;
  model: string;
  effort: RuntimeSpecView["effort"];
  allowEdits: boolean;
}): string[] {
  return [
    "exec",
    "--ephemeral",
    "--json",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--sandbox",
    input.allowEdits ? "workspace-write" : "read-only",
    "-C",
    input.workspace,
    "--model",
    input.model,
    "-c",
    configValue("model_reasoning_effort", input.effort),
    "-c",
    configValue("approval_policy", "never"),
    "-c",
    configValue("project_doc_max_bytes", 0),
    "-c",
    configValue("features.multi_agent", false),
    "-c",
    configValue("features.apps", false),
    "-c",
    configValue("web_search", "disabled"),
    input.prompt,
  ];
}

async function copyPrivateRegularFile(
  from: string,
  to: string,
  maxBytes: number,
  required: boolean,
): Promise<boolean> {
  try {
    const metadata = await lstat(from);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("source is not a regular file");
    }
    if (metadata.size <= 0 || metadata.size > maxBytes) {
      throw new Error("source file size is outside the safe bound");
    }
    await copyFile(from, to);
    await chmod(to, 0o600);
    return true;
  } catch (error) {
    if (!required) return false;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Codex local sign-in is unavailable: ${message}`);
  }
}

/** Seed only the two allowlisted local Codex files. Returned evidence contains
 * file names only — never source paths, contents, account data, or tokens. */
export async function seedCodexHome(
  taskCodexHome: string,
  operatorCodexHome = path.join(homedir(), ".codex"),
): Promise<{ seeded: Array<"auth.json" | "models_cache.json"> }> {
  await mkdir(taskCodexHome, { recursive: true, mode: 0o700 });
  await chmod(taskCodexHome, 0o700);
  const seeded: Array<"auth.json" | "models_cache.json"> = [];
  if (await copyPrivateRegularFile(
    path.join(operatorCodexHome, "auth.json"),
    path.join(taskCodexHome, "auth.json"),
    CODEX_AUTH_MAX_BYTES,
    true,
  )) seeded.push("auth.json");
  if (await copyPrivateRegularFile(
    path.join(operatorCodexHome, "models_cache.json"),
    path.join(taskCodexHome, "models_cache.json"),
    CODEX_CATALOG_MAX_BYTES,
    false,
  )) seeded.push("models_cache.json");
  return { seeded };
}

function terminalFields(
  terminal: NormalizedWorkerEvent["terminal"] | undefined,
  resultText?: string,
): Partial<WorkerExecutionResult> {
  if (terminal === undefined) return resultText === undefined ? {} : { resultText };
  return {
    ...(resultText === undefined ? {} : { resultText }),
    ...(terminal.usage === undefined ? {} : { usage: terminal.usage }),
  };
}

function interruptedExitCode(code: number): number {
  return code === 0 ? 130 : code;
}

function codexToolLines(task: TaskRecord): string[] {
  return [
    "- Work only through Codex tools inside the Task workspace sandbox.",
    `- Workspace mode: ${task.spec.worker.allowEdits ? "edits allowed" : "read-only"}.`,
    "- Web, apps, MCP servers, nested agents, and approval escalation are disabled.",
    "- Do not integrate source, commit, push, or broaden writable paths.",
  ];
}

function codexCheckpointLines(): string[] {
  return [
    "- This Codex Worker foundation does not support ForkLight checkpoint MCP.",
    "- ForkLight will run the independent acceptance commands after the Worker exits.",
  ];
}

export async function runCodexWorker(
  ctx: WorkerRunContext,
  operatorCodexHome?: string,
): Promise<WorkerExecutionResult> {
  const { store, task, attempt, resuming, hooks = {} } = ctx;
  if (resuming) {
    throw new Error("Codex Runtime resume is not supported by this foundation");
  }
  await mkdir(task.paths.logs, { recursive: true, mode: 0o700 });
  const codexHome = path.join(task.paths.root, "codex-home");
  const temporaryDirectory = path.join(task.paths.root, "codex-tmp");
  await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
  const seed = await seedCodexHome(codexHome, operatorCodexHome);

  const prompt = buildWorkerPrompt(
    task.spec,
    false,
    hooks.feedback,
    workerPromptAppendicesForTask(task, {
      toolLines: codexToolLines(task),
      checkpointLines: codexCheckpointLines(),
    }),
  );
  await writeFile(path.join(task.paths.logs, `attempt-${attempt.ordinal}.prompt.txt`), prompt, {
    mode: 0o600,
  });
  const args = buildCodexCliArgs({
    prompt,
    workspace: task.paths.workspace,
    model: task.spec.provider.model,
    effort: task.spec.runtime.effort,
    allowEdits: task.spec.worker.allowEdits,
  });
  const rawLog = createWriteStream(attempt.rawLogPath, { flags: "a", mode: 0o600 });
  const stderrPath = path.join(task.paths.logs, `attempt-${attempt.ordinal}.stderr.log`);
  const stderrChunks: string[] = [];
  const normalizer = new CodexEventNormalizer();
  let terminal: NormalizedWorkerEvent["terminal"];
  let runtimeSessionId: string | undefined;
  let lastAgentText: string | undefined;

  const execution = ctx.execution ?? cloneDefaults().execution;
  const noProgressTimeoutMs = noProgressFromSnapshot(
    task.effectivePolicy,
    execution.noProgressTimeoutMs,
  );
  const stopGraceMs = stopGraceFromSnapshot(
    task.effectivePolicy,
    execution.workerStopGraceMs,
  );
  let watchdogTimer: ReturnType<typeof setTimeout> | undefined;
  let escalationTimer: ReturnType<typeof setTimeout> | undefined;
  let watchdogFired = false;
  let child: ChildProcess | undefined;

  const clearWatchdog = (): void => {
    if (watchdogTimer !== undefined) clearTimeout(watchdogTimer);
    if (escalationTimer !== undefined) clearTimeout(escalationTimer);
    watchdogTimer = undefined;
    escalationTimer = undefined;
  };
  const scheduleWatchdog = (): void => {
    if (terminal !== undefined || watchdogFired || noProgressTimeoutMs === null) return;
    if (watchdogTimer !== undefined) clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(() => {
      watchdogFired = true;
      if (child?.exitCode === null && child.signalCode === null) {
        child.kill("SIGINT");
        escalationTimer = setTimeout(() => {
          if (child?.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
        }, stopGraceMs);
        escalationTimer.unref();
      }
    }, noProgressTimeoutMs);
    watchdogTimer.unref();
  };

  store.addEvent(task.id, attempt.id, "worker.started", "Codex Worker started", {
    model: task.spec.provider.model,
    provider: task.spec.provider.name,
    runtime: task.spec.runtime.name,
    effort: task.spec.runtime.effort,
    isolation: "codex-sandbox",
    authMode: "local-sign-in",
    authSeeded: seed.seeded,
    correctionFeedbackIncluded: Boolean(hooks.feedback),
  });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CODEX_HOME: codexHome,
    TMPDIR: temporaryDirectory,
    TMP: temporaryDirectory,
    TEMP: temporaryDirectory,
  };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_BASE_URL;
  delete env.XAI_API_KEY;

  child = spawn(task.spec.runtime.executable || "codex", args, {
    cwd: task.paths.workspace,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  hooks.onSpawn?.(child);
  if (child.pid !== undefined) {
    store.updateAttempt(attempt.id, { pid: child.pid });
    store.updateTask(task.id, { workerPid: child.pid });
  }
  scheduleWatchdog();

  const emit = (event: NormalizedWorkerEvent): void => {
    if (event.sessionId !== undefined) {
      if (runtimeSessionId !== undefined && runtimeSessionId !== event.sessionId) {
        terminal = { isError: true, failureReason: "Codex changed session identity during one Attempt" };
      } else {
        runtimeSessionId = event.sessionId;
      }
    }
    if (event.terminal !== undefined) {
      terminal = event.terminal;
      clearWatchdog();
    } else {
      scheduleWatchdog();
    }
    const payload = event.sessionId === undefined
      ? event.payload
      : { ...(typeof event.payload === "object" && event.payload !== null ? event.payload : {}), runtimeSessionId: event.sessionId };
    store.addEvent(task.id, attempt.id, event.type, event.summary, payload);
    hooks.onEvent?.(event);
  };

  const stdoutDone = new Promise<void>((resolve) => {
    if (!child?.stdout) return resolve();
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      rawLog.write(`${line}\n`);
      const agentText = codexAgentMessageFromLine(line);
      if (agentText !== undefined) lastAgentText = agentText;
      for (const event of normalizer.parseLine(line)) emit(event);
    });
    lines.on("close", resolve);
  });
  const stderrDone = new Promise<void>((resolve) => {
    if (!child?.stderr) return resolve();
    child.stderr.on("data", (chunk: Buffer | string) => stderrChunks.push(String(chunk)));
    child.stderr.on("end", resolve);
    child.stderr.on("error", resolve);
  });
  const outcome = await new Promise<{ code: number; signal: NodeJS.Signals | null; error?: Error }>(
    (resolve) => {
      let spawnError: Error | undefined;
      child!.once("error", (error) => { spawnError = error; });
      child!.once("close", (code, signal) => resolve({
        code: code ?? (signal ? 128 : 1),
        signal,
        ...(spawnError === undefined ? {} : { error: spawnError }),
      }));
    },
  );
  await Promise.all([stdoutDone, stderrDone]);
  clearWatchdog();
  await new Promise<void>((resolve) => rawLog.end(resolve));
  await writeFile(stderrPath, stderrChunks.join(""), { mode: 0o600 });

  if (watchdogFired) {
    return {
      status: "failed",
      exitCode: interruptedExitCode(outcome.code),
      ...terminalFields(terminal, lastAgentText),
      error: "No effective implementation progress detected within the configured interval; Codex Worker was terminated",
      policyLimit: {
        category: "no-progress",
        enforcementPhase: "preemptive",
        configured: noProgressTimeoutMs,
        observed: noProgressTimeoutMs ?? 0,
        effect: "hard-fail",
        detail: "Codex Worker reached the configured no-progress interval and was terminated",
      },
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
      ...terminalFields(terminal, lastAgentText),
      error: "Worker execution interrupted",
    };
  }
  if (outcome.error !== undefined) {
    return { status: "failed", exitCode: outcome.code, error: "Unable to start Codex Worker" };
  }
  if (runtimeSessionId === undefined) {
    return {
      status: "failed",
      exitCode: outcome.code,
      ...terminalFields(terminal, lastAgentText),
      error: "Codex Worker exited without a session identity",
      failureCategory: "runtime",
    };
  }
  if (outcome.code !== 0 || terminal === undefined || terminal.isError) {
    return {
      status: "failed",
      exitCode: outcome.code,
      ...terminalFields(terminal, lastAgentText),
      error: terminal?.failureReason ?? "Codex Worker exited without successful terminal evidence",
      failureCategory: "runtime",
    };
  }
  return {
    status: "succeeded",
    exitCode: outcome.code,
    ...terminalFields(terminal, lastAgentText),
  };
}

export class CodexCliAdapter implements WorkerAdapter {
  readonly name = "codex-cli" as const;
  readonly displayName = "Codex CLI";
  readonly defaultExecutable = "codex";

  capabilities(): WorkerCapabilityMatrix {
    return { ...CODEX_CAPABILITIES };
  }

  doctor(): WorkerDoctorResult {
    const issues: string[] = [];
    let version: string | undefined;
    try {
      version = execFileSync(this.defaultExecutable, ["--version"], {
        encoding: "utf8",
        timeout: 10_000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      issues.push("codex executable not found or failed --version");
    }
    if (version !== undefined) {
      try {
        execFileSync(this.defaultExecutable, ["login", "status"], {
          encoding: "utf8",
          timeout: 10_000,
          stdio: ["ignore", "pipe", "ignore"],
        });
      } catch {
        issues.push("Codex CLI is not signed in");
      }
    }
    return {
      runtime: this.name,
      ok: version !== undefined && issues.length === 0,
      executable: this.defaultExecutable,
      ...(version === undefined ? {} : { version }),
      issues,
      capabilities: this.capabilities(),
    };
  }

  validateSpec(runtime: RuntimeSpecView): void {
    if (runtime.name !== "codex-cli") {
      throw new Error(`CodexCliAdapter cannot validate runtime ${runtime.name}`);
    }
  }

  effortArgs(effort: RuntimeSpecView["effort"]): string[] {
    return ["-c", configValue("model_reasoning_effort", effort)];
  }

  toolProtocolAppendix(task: TaskRecord): string[] {
    return codexToolLines(task);
  }

  checkpointProtocolAppendix(_task: TaskRecord): string[] {
    return codexCheckpointLines();
  }

  run(ctx: WorkerRunContext): Promise<WorkerExecutionResult> {
    return runCodexWorker(ctx);
  }
}
