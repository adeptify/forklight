/**
 * Grok Build WorkerAdapter — headless `grok -p` with task-local GROK_HOME.
 * Security: no workspace-writable MCP config; tool deny list; sandbox deny true home.
 */

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, realpathSync } from "node:fs";
// realpathSync used for TMPDIR sandbox roots
import { copyFile, chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import {
  buildWorkerPrompt,
  neutralToolProtocolLines,
} from "../core/task.js";
import { readProviderKey } from "../core/secrets.js";
import { cloneDefaults } from "../core/settings.js";
import type { NormalizedWorkerEvent, TaskRecord } from "../core/types.js";
import { GrokEventNormalizer } from "../events/grok-normalize.js";
import type {
  RuntimeSpecView,
  WorkerAdapter,
  WorkerCapabilityMatrix,
  WorkerDoctorResult,
  WorkerExecutionResult,
  WorkerRunContext,
} from "./types.js";

const GROK_CAPABILITIES: WorkerCapabilityMatrix = {
  budgetFlag: "unsupported",
  checkpoint: "unsupported",
  isolation: "partial",
  toolsPolicy: "supported",
  effortMapping: "partial",
  costUsageFidelity: "partial",
  sessionResume: "partial",
  streamingEvents: "partial",
  progressHeartbeat: "any-nonterminal-stream-event",
};

function sandboxLiteral(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function executablePath(executable: string): string {
  const candidate = executable.includes("/")
    ? executable
    : execFileSync("/usr/bin/which", [executable], { encoding: "utf8" }).trim();
  return realpathSync(candidate);
}

function effortToGrok(effort: RuntimeSpecView["effort"]): string[] {
  // Map ForkLight effort onto Grok --effort when supported.
  const map: Record<RuntimeSpecView["effort"], string> = {
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  };
  return ["--effort", map[effort] ?? "high"];
}

/**
 * MCP meta / shell / web / agent denylist for headless Grok Workers (design §8.1 / A7).
 * Includes Grok meta-tools and Agent spawns; pairs with --disable-web-search.
 */
export function grokDisallowedTools(): string {
  return [
    "run_terminal_cmd",
    "web_search",
    "web_fetch",
    "Agent",
    "search_tool",
    "use_tool",
    "mcp",
    "MCPTool",
  ].join(",");
}

/** Allowlist respects task.worker.allowEdits (same product rule as Claude). */
export function grokAllowTools(allowEdits: boolean): string {
  const readOnly = ["read_file", "list_dir", "grep"];
  if (!allowEdits) return readOnly.join(",");
  return [...readOnly, "search_replace", "write"].join(",");
}

/**
 * Pure CLI argv for headless Grok (exported for unit tests).
 * Uses --always-approve so tool edits run non-interactively (OAuth dogfood).
 * `-m` is only emitted when model is non-empty (empty → CLI default).
 */
export function buildGrokCliArgs(input: {
  prompt: string;
  workspace: string;
  model: string;
  allowEdits: boolean;
  grokHome: string;
  effort: RuntimeSpecView["effort"];
  sessionId: string;
  resuming: boolean;
}): string[] {
  const sessionArgs = input.resuming
    ? ["--resume", input.sessionId]
    : ["--session-id", input.sessionId];
  const modelArgs = input.model.trim().length > 0
    ? ["-m", input.model.trim()]
    : [];
  return [
    "-p",
    input.prompt,
    ...modelArgs,
    "--cwd",
    input.workspace,
    "--output-format",
    "streaming-json",
    // Headless tool execution requires always-approve; dontAsk alone cancels tool turns.
    "--always-approve",
    "--disable-web-search",
    "--tools",
    grokAllowTools(input.allowEdits),
    "--disallowed-tools",
    grokDisallowedTools(),
    // Path denials use Grok permission tool prefixes (Write/Edit), not internal ids.
    "--deny",
    `Write(${input.grokHome}/**)`,
    "--deny",
    `Edit(${input.grokHome}/**)`,
    "--deny",
    "MCPTool",
    "--deny",
    "Agent",
    ...effortToGrok(input.effort),
    ...sessionArgs,
  ];
}

/**
 * Seed task-local GROK_HOME with operator OAuth files so headless Workers work
 * without XAI_API_KEY (copies auth only — sessions stay task-local).
 */
export async function seedGrokHomeAuth(taskGrokHome: string, operatorGrokHome?: string): Promise<{
  mode: "api-key" | "oauth-seed" | "none";
  seeded: string[];
}> {
  const seeded: string[] = [];
  const sourceRoot = operatorGrokHome ?? path.join(homedir(), ".grok");
  for (const name of ["auth.json", "agent_id"] as const) {
    const from = path.join(sourceRoot, name);
    const to = path.join(taskGrokHome, name);
    try {
      await copyFile(from, to);
      await chmod(to, 0o600);
      seeded.push(name);
    } catch {
      // optional per file
    }
  }
  if (seeded.includes("auth.json")) return { mode: "oauth-seed", seeded };
  return { mode: seeded.length > 0 ? "oauth-seed" : "none", seeded };
}

/**
 * Seatbelt profile aligned with Claude's network+system.sb model while
 * denying the operator's real ~/.grok and limiting writes to task paths.
 */
export function buildGrokSandboxProfile(input: {
  workspace: string;
  grokHome: string;
  logs: string;
  runtimeDirectory: string;
  userHome: string;
  /** Operator ~/.grok — read-only for binary/bundled assets; writes stay task-local. */
  operatorGrokHome: string;
  /** Node/Grok temp roots (design §8.4 / Claude parity). */
  temporaryDirectory: string;
}): string {
  // Deny operator home reads EXCEPT workspace/task grok home/logs/runtime/tmp/operator .grok
  // (Grok CLI needs ~/.grok/bin + bundled assets even when GROK_HOME is task-local).
  return `(version 1)
(deny default)
(import "system.sb")
(allow process*)
(allow file-read*)
(deny file-read*
  (require-all
    (subpath "${sandboxLiteral(input.userHome)}")
    (require-not (subpath "${sandboxLiteral(input.workspace)}"))
    (require-not (subpath "${sandboxLiteral(input.grokHome)}"))
    (require-not (subpath "${sandboxLiteral(input.logs)}"))
    (require-not (subpath "${sandboxLiteral(input.runtimeDirectory)}"))
    (require-not (subpath "${sandboxLiteral(input.operatorGrokHome)}"))
    (require-not (subpath "${sandboxLiteral(input.temporaryDirectory)}"))))
(allow file-write*
  (subpath "${sandboxLiteral(input.workspace)}")
  (subpath "${sandboxLiteral(input.grokHome)}")
  (subpath "${sandboxLiteral(input.logs)}")
  (subpath "${sandboxLiteral(input.temporaryDirectory)}"))
(allow network*)`;
}

function redact(value: string, secret: string): string {
  return secret ? value.split(secret).join("[REDACTED]") : value;
}

function terminalFields(terminal: NormalizedWorkerEvent["terminal"] | undefined) {
  if (terminal === undefined) return {} as Record<string, never>;
  return {
    ...(terminal.resultText === undefined ? {} : { resultText: terminal.resultText }),
    ...(terminal.costUsd === undefined ? {} : { costUsd: terminal.costUsd }),
    ...(terminal.turns === undefined ? {} : { turns: terminal.turns }),
    ...(terminal.runtimeCostEstimateUsd === undefined
      ? {}
      : { runtimeCostEstimateUsd: terminal.runtimeCostEstimateUsd }),
    ...(terminal.usage === undefined ? {} : { usage: terminal.usage }),
  };
}

function interruptedExitCode(code: number | null): number {
  return code === null || code === 0 ? 130 : code;
}

export class GrokBuildAdapter implements WorkerAdapter {
  readonly name = "grok-build" as const;
  readonly displayName = "Grok Build";
  readonly defaultExecutable = "grok";

  capabilities(): WorkerCapabilityMatrix {
    return { ...GROK_CAPABILITIES };
  }

  doctor(): WorkerDoctorResult {
    const issues: string[] = [];
    let version: string | undefined;
    let ok = false;
    try {
      const out = execFileSync(this.defaultExecutable, ["--help"], {
        encoding: "utf8",
        timeout: 5_000,
      });
      ok = /Grok|headless|-p/i.test(out) || out.length > 0;
      version = "grok-cli";
    } catch {
      issues.push("grok executable not found or failed --help");
    }
    return {
      runtime: this.name,
      ok,
      executable: this.defaultExecutable,
      ...(version === undefined ? {} : { version }),
      issues,
      capabilities: this.capabilities(),
    };
  }

  validateSpec(runtime: RuntimeSpecView): void {
    if (runtime.name !== "grok-build") {
      throw new Error(`GrokBuildAdapter cannot validate runtime ${runtime.name}`);
    }
  }

  effortArgs(effort: RuntimeSpecView["effort"]): string[] {
    return effortToGrok(effort);
  }

  toolProtocolAppendix(task: TaskRecord): string[] {
    return neutralToolProtocolLines(task.spec.worker.focusPaths);
  }

  checkpointProtocolAppendix(_task: TaskRecord): string[] {
    return [
      "",
      "Checkpoint:",
      "- This Worker runtime does not support ForkLight checkpoint MCP.",
      "- ForkLight will skip the checkpoint gate and run independent acceptance commands after you finish.",
    ];
  }

  async run(ctx: WorkerRunContext): Promise<WorkerExecutionResult> {
    const { store, task, attempt, resuming } = ctx;
    const hooks = ctx.hooks ?? {};
    const exec = ctx.execution ?? cloneDefaults().execution;

    if (task.spec.provider.name !== "xai") {
      throw new Error(
        `Grok Worker requires provider.name=xai (received ${task.spec.provider.name})`,
      );
    }

    await mkdir(task.paths.logs, { recursive: true, mode: 0o700 });
    const grokHome = path.join(task.paths.root, "grok-home");
    await mkdir(grokHome, { recursive: true, mode: 0o700 });

    // Prefer Keychain API key; otherwise seed OAuth auth.json into task-local home.
    let apiKey = "";
    try {
      apiKey = readProviderKey(task.spec);
    } catch {
      apiKey = "";
    }
    const authSeed = await seedGrokHomeAuth(grokHome);
    if (!apiKey && authSeed.mode === "none") {
      throw new Error(
        "Grok Worker needs either Keychain service forklight.xai.api-key (XAI_API_KEY) "
        + "or a signed-in operator ~/.grok/auth.json to seed task-local GROK_HOME",
      );
    }
    const normalizer = new GrokEventNormalizer();
    const rawLog = createWriteStream(attempt.rawLogPath, { flags: "a", mode: 0o600 });
    const stderrChunks: string[] = [];
    let terminal: NormalizedWorkerEvent["terminal"];

    let watchdogTimer: ReturnType<typeof setTimeout> | undefined;
    let escalationTimer: ReturnType<typeof setTimeout> | undefined;
    let watchdogFired = false;
    let watchdogTerminal = false;
    let child: ChildProcess | undefined;

    const clearWatchdog = (): void => {
      if (watchdogTimer !== undefined) clearTimeout(watchdogTimer);
      if (escalationTimer !== undefined) clearTimeout(escalationTimer);
      watchdogTimer = undefined;
      escalationTimer = undefined;
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

    const prompt = buildWorkerPrompt(task.spec, resuming, hooks.feedback, {
      toolLines: this.toolProtocolAppendix(task),
      checkpointLines: this.checkpointProtocolAppendix(task),
    });
    await writeFile(path.join(task.paths.logs, `attempt-${attempt.ordinal}.prompt.txt`), prompt, {
      mode: 0o600,
    });

    const executable = task.spec.runtime.executable || this.defaultExecutable;
    const grokArgs = buildGrokCliArgs({
      prompt,
      workspace: task.paths.workspace,
      model: task.spec.provider.model,
      allowEdits: task.spec.worker.allowEdits,
      grokHome,
      effort: task.spec.runtime.effort,
      sessionId: task.sessionId,
      resuming,
    });

    let launchCommand = executable;
    let launchArgs = grokArgs;
    let isolation: "macos-sandbox" | "runtime-permissions" = "runtime-permissions";

    // Prefer macOS sandbox-exec (network + system.sb like Claude; task-local write roots).
    try {
      const bin = executablePath(executable);
      const profileDir = await mkdtemp(path.join(tmpdir(), "forklight-grok-sbx-"));
      const profilePath = path.join(profileDir, "profile.sb");
      const temporaryDirectory = realpathSync(process.env.TMPDIR ?? "/tmp");
      const operatorGrokHome = path.join(homedir(), ".grok");
      const profile = buildGrokSandboxProfile({
        workspace: task.paths.workspace,
        grokHome,
        logs: task.paths.logs,
        runtimeDirectory: path.dirname(bin),
        userHome: process.env.HOME ?? homedir(),
        operatorGrokHome,
        temporaryDirectory,
      });
      await writeFile(profilePath, profile, { mode: 0o600 });
      launchCommand = "/usr/bin/sandbox-exec";
      launchArgs = ["-p", profile, bin, ...grokArgs];
      isolation = "macos-sandbox";
    } catch {
      isolation = "runtime-permissions";
    }

    store.addEvent(
      task.id,
      attempt.id,
      resuming ? "worker.resumed" : "worker.started",
      resuming ? "Grok Build Worker resumed" : "Grok Build Worker started",
      {
        model: task.spec.provider.model,
        provider: task.spec.provider.name,
        runtime: task.spec.runtime.name,
        isolation,
        correctionFeedbackIncluded: Boolean(hooks.feedback),
        grokHome,
        authMode: apiKey ? "api-key" : authSeed.mode,
        ...(authSeed.seeded.length > 0 ? { authSeeded: authSeed.seeded } : {}),
      },
    );

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GROK_HOME: grokHome,
      // Prevent accidental Anthropic-compat injection for Grok.
    };
    if (apiKey) {
      env.XAI_API_KEY = apiKey;
    } else {
      delete env.XAI_API_KEY;
    }
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_BASE_URL;

    child = spawn(launchCommand, launchArgs, {
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

    const onNormalized = (event: NormalizedWorkerEvent): void => {
      if (event.type === "worker.completed" || event.type === "worker.failed") {
        watchdogTerminal = true;
        clearWatchdog();
        terminal = event.terminal;
      } else if (
        GROK_CAPABILITIES.progressHeartbeat === "any-nonterminal-stream-event"
        || event.type === "worker.tool.started"
        || event.type === "worker.tool.completed"
      ) {
        scheduleWatchdog();
      }
      store.addEvent(task.id, attempt.id, event.type, event.summary, event.payload);
      hooks.onEvent?.(event);
    };

    const stdoutDone = new Promise<void>((resolve) => {
      if (!child?.stdout) {
        resolve();
        return;
      }
      const rl = createInterface({ input: child.stdout });
      rl.on("line", (line) => {
        rawLog.write(`${line}\n`);
        for (const event of normalizer.parseLine(line)) onNormalized(event);
      });
      rl.on("close", () => resolve());
    });

    const stderrDone = new Promise<void>((resolve) => {
      if (!child?.stderr) {
        resolve();
        return;
      }
      child.stderr.on("data", (chunk: Buffer | string) => {
        const text = redact(String(chunk), apiKey);
        stderrChunks.push(text);
        rawLog.write(text);
      });
      child.stderr.on("end", () => resolve());
      child.stderr.on("error", () => resolve());
    });

    const exitCode = await new Promise<number>((resolve, reject) => {
      child!.on("error", reject);
      child!.on("close", (code, signal) => {
        if (signal) resolve(interruptedExitCode(null));
        else resolve(code ?? 1);
      });
    });
    await Promise.all([stdoutDone, stderrDone]);
    clearWatchdog();
    rawLog.end();

    const stderr = stderrChunks.join("");
    if (hooks.wasInterrupted?.()) {
      return {
        status: "interrupted",
        exitCode: interruptedExitCode(exitCode),
        ...terminalFields(terminal),
        error: "Worker execution interrupted",
      };
    }
    if (watchdogFired) {
      return {
        status: "failed",
        exitCode: interruptedExitCode(exitCode),
        ...terminalFields(terminal),
        error:
          "No effective implementation progress detected within the configured interval; worker was terminated by the progress watchdog",
      };
    }
    if (exitCode !== 0 || terminal?.isError) {
      return {
        status: "failed",
        exitCode,
        ...terminalFields(terminal),
        error: terminal?.resultText?.trim()
          || stderr.trim().slice(0, 2_000)
          || "Grok Worker exited without a successful result",
      };
    }
    return {
      status: "succeeded",
      exitCode,
      ...terminalFields(terminal),
    };
  }
}
