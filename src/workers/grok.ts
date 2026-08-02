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
  workerPromptAppendicesForTask,
} from "../core/task.js";
import { readProviderKey } from "../core/secrets.js";
import { cloneDefaults } from "../core/settings.js";
import { noProgressFromSnapshot, stopGraceFromSnapshot } from "../core/advanced-policy.js";
import {
  applyWorkerNetworkPolicy,
  workerNetworkPolicyMode,
  type WorkerNetworkPolicy,
} from "../core/network-policy.js";
import { isEffectiveProgressEvent } from "../core/runtime-activity.js";
import type { NormalizedWorkerEvent, TaskRecord } from "../core/types.js";
import {
  appendGrokTextDelta,
  createGrokTextAssembly,
  extractGrokTextDeltaFromLine,
  GrokEventNormalizer,
  resolveGrokTerminalResultText,
  type GrokTextAssembly,
} from "../events/grok-normalize.js";
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
  nativeGoal: "unsupported",
  streamingEvents: "partial",
  progressHeartbeat: "effective-progress",
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
  /** Grok imports Claude-compatible settings at startup; keep them read-only. */
  operatorClaudeHome: string;
  /** Node/Grok temp roots (design §8.4 / Claude parity). */
  temporaryDirectory: string;
}): string {
  // Deny operator-home file contents EXCEPT the task paths and the two
  // read-only configuration roots Grok imports at startup. Metadata remains
  // readable because macOS trust discovery fails before network startup when
  // every home-directory metadata read is denied.
  return `(version 1)
(deny default)
(import "system.sb")
(allow process*)
(allow file-read*)
(deny file-read-data
  (require-all
    (subpath "${sandboxLiteral(input.userHome)}")
    (require-not (subpath "${sandboxLiteral(input.workspace)}"))
    (require-not (subpath "${sandboxLiteral(input.grokHome)}"))
    (require-not (subpath "${sandboxLiteral(input.logs)}"))
    (require-not (subpath "${sandboxLiteral(input.runtimeDirectory)}"))
    (require-not (subpath "${sandboxLiteral(input.operatorGrokHome)}"))
    (require-not (subpath "${sandboxLiteral(input.operatorClaudeHome)}"))
    (require-not (subpath "${sandboxLiteral(input.temporaryDirectory)}"))))
(allow file-write*
  (subpath "${sandboxLiteral(input.workspace)}")
  (subpath "${sandboxLiteral(input.grokHome)}")
  (subpath "${sandboxLiteral(input.logs)}")
  (subpath "${sandboxLiteral(input.temporaryDirectory)}"))
(allow network*)`;
}

/**
 * Task-local Grok environment: seeded GROK_HOME, optional XAI_API_KEY, and a
 * deliberate Anthropic-compat strip, then the frozen per-Task network policy.
 * Pure so adapter tests can assert the exact child environment.
 */
export function buildGrokWorkerEnv(
  apiKey: string,
  grokHome: string,
  networkPolicy?: WorkerNetworkPolicy,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GROK_HOME: grokHome,
  };
  if (apiKey) {
    env.XAI_API_KEY = apiKey;
  } else {
    delete env.XAI_API_KEY;
  }
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_BASE_URL;
  return applyWorkerNetworkPolicy(env, networkPolicy);
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

/**
 * Fixed public summary for Grok Provider transport failures.
 * Never includes raw stderr, proxy values, credentials, endpoints, or paths.
 */
export const GROK_CONNECTIVITY_SAFE_ERROR =
  "Worker could not reach the Provider service due to a network connectivity failure";

/**
 * Detect explicit Grok service transport evidence only.
 * Bare "timeout", model-quality errors, and no-progress watchdog text must not match.
 */
export function isGrokConnectivityEvidence(text: string | undefined): boolean {
  if (!text || !text.trim()) return false;
  const lower = text.toLowerCase();

  // Explicit OS/transport error codes and connection refusal family.
  if (
    lower.includes("econnrefused")
    || lower.includes("connection refused")
    || lower.includes("etimedout")
    || lower.includes("econnreset")
    || lower.includes("enotfound")
    || lower.includes("econnaborted")
    || lower.includes("enetunreach")
    || lower.includes("ehostunreach")
    || lower.includes("socket hang up")
    || lower.includes("getaddrinfo")
    || lower.includes("fetch failed")
    || lower.includes("network request failed")
  ) {
    return true;
  }

  // Measured model/settings fetch timeout family from Grok CLI stderr.
  if (
    /model\s*\/\s*settings/.test(lower)
    && (lower.includes("timeout") || lower.includes("timed out"))
  ) {
    return true;
  }
  if (
    /fetch\s+(models?|settings)/.test(lower)
    && (lower.includes("timeout") || lower.includes("timed out"))
  ) {
    return true;
  }

  // Transport-scoped timeout / connect failures (not generic policy timeouts).
  // Use word-aware markers so "confirmation" does not match "connect".
  if (
    (lower.includes("timed out") || /\btimeouts?\b/.test(lower))
    && (
      /\bconnect(?:ion|ed|ing)?\b/.test(lower)
      || /\bfetch\b/.test(lower)
      || /\bproxy\b/.test(lower)
      || /\bnetwork\b/.test(lower)
      || lower.includes("request failed")
      || /\bdns\b/.test(lower)
    )
  ) {
    return true;
  }

  if (
    /\bunable to connect\b/.test(lower)
    || /\bcould not connect\b/.test(lower)
    || /\bfailed to connect\b/.test(lower)
  ) {
    return true;
  }

  return false;
}

/**
 * Keep the raw streaming line in the private Attempt log, but never persist a
 * connectivity-shaped terminal result as a public Task event. Grok can report
 * transport detail on stdout as well as stderr, so sanitizing only the final
 * adapter return would be too late.
 */
export function sanitizeGrokConnectivityEvent(
  event: NormalizedWorkerEvent,
): NormalizedWorkerEvent {
  if (event.type !== "worker.failed") return event;
  const evidence = [
    event.summary,
    event.terminal?.resultText,
    event.terminal?.failureReason,
  ].filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n");
  if (!isGrokConnectivityEvidence(evidence)) return event;

  return {
    ...event,
    summary: GROK_CONNECTIVITY_SAFE_ERROR,
    payload: { failureCategory: "connectivity" },
    ...(event.terminal === undefined
      ? {}
      : {
          terminal: {
            ...event.terminal,
            resultText: GROK_CONNECTIVITY_SAFE_ERROR,
            failureReason: GROK_CONNECTIVITY_SAFE_ERROR,
          },
        }),
  };
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
    const noProgressTimeoutMs = noProgressFromSnapshot(
      task.effectivePolicy,
      exec.noProgressTimeoutMs,
    );
    const workerStopGraceMs = stopGraceFromSnapshot(
      task.effectivePolicy,
      exec.workerStopGraceMs,
    );

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
    // Ordered bounded text deltas; used only when terminal has no meaningful result.
    let textAssembly: GrokTextAssembly = createGrokTextAssembly();

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
      if (noProgressTimeoutMs === null) {
        watchdogTimer = undefined;
        return;
      }
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
          }, workerStopGraceMs);
          escalation.unref();
          escalationTimer = escalation;
        }
      }, noProgressTimeoutMs);
      timeout.unref();
      watchdogTimer = timeout;
    };

    const prompt = buildWorkerPrompt(
      task.spec,
      resuming,
      hooks.feedback,
      workerPromptAppendicesForTask(task, {
        toolLines: this.toolProtocolAppendix(task),
        checkpointLines: this.checkpointProtocolAppendix(task),
      }),
    );
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
      const operatorClaudeHome = path.join(homedir(), ".claude");
      const profile = buildGrokSandboxProfile({
        workspace: task.paths.workspace,
        grokHome,
        logs: task.paths.logs,
        runtimeDirectory: path.dirname(bin),
        userHome: process.env.HOME ?? homedir(),
        operatorGrokHome,
        operatorClaudeHome,
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
        // Privacy-safe: mode-level evidence only; proxy values never reach events.
        networkPolicyMode: workerNetworkPolicyMode(task.spec.networkPolicy),
      },
    );

    const env = buildGrokWorkerEnv(apiKey, grokHome, task.spec.networkPolicy);

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

    const onNormalized = (rawEvent: NormalizedWorkerEvent): void => {
      const event = sanitizeGrokConnectivityEvent(rawEvent);
      if (event.type === "worker.completed" || event.type === "worker.failed") {
        watchdogTerminal = true;
        clearWatchdog();
        terminal = event.terminal;
      } else if (isEffectiveProgressEvent(event.type, event.payload)) {
        // Genuine thought/text deltas and tools reset the stop; keepalive-only
        // records refresh Runtime liveness in durable history without resetting.
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
        // Accumulate full text deltas from raw lines (summary is truncated).
        const delta = extractGrokTextDeltaFromLine(line);
        if (delta !== undefined) {
          textAssembly = appendGrokTextDelta(textAssembly, delta);
        }
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

    /**
     * Authoritative terminal result: explicit meaningful content wins;
     * otherwise complete bounded text assembly for normal EndTurn.
     * Errors / interruption / watchdog keep their own semantics.
     */
    const resolveTerminal = (
      isError: boolean,
    ): NormalizedWorkerEvent["terminal"] | undefined => {
      const resolved = resolveGrokTerminalResultText({
        explicitResultText: terminal?.resultText,
        assembly: textAssembly,
        isError,
      });
      if (terminal === undefined && resolved === undefined) return undefined;
      return {
        isError,
        ...(terminal?.failureReason === undefined ? {} : { failureReason: terminal.failureReason }),
        ...(resolved === undefined ? {} : { resultText: resolved }),
        ...(terminal?.costUsd === undefined ? {} : { costUsd: terminal.costUsd }),
        ...(terminal?.turns === undefined ? {} : { turns: terminal.turns }),
        ...(terminal?.runtimeCostEstimateUsd === undefined
          ? {}
          : { runtimeCostEstimateUsd: terminal.runtimeCostEstimateUsd }),
        ...(terminal?.usage === undefined ? {} : { usage: terminal.usage }),
      };
    };

    if (hooks.wasInterrupted?.()) {
      // Interruption remains authoritative; do not invent success content from deltas.
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
          "No effective progress detected within the configured interval; worker was terminated by the no-effective-progress stop",
        policyLimit: {
          category: "no-progress",
          enforcementPhase: "preemptive",
          configured: noProgressTimeoutMs,
          observed: noProgressTimeoutMs ?? 0,
          effect: "hard-fail",
          detail: "Worker reached the configured no-effective-progress interval and was terminated",
        },
      };
    }
    if (exitCode !== 0 || terminal?.isError) {
      const failedTerminal = resolveTerminal(true);
      const haystack = [
        failedTerminal?.resultText,
        stderr,
      ].filter((part): part is string => typeof part === "string" && part.trim().length > 0)
        .join("\n");
      // Connectivity classification uses private stderr for evidence only.
      // Public Task/Attempt error stays a fixed safe summary.
      if (isGrokConnectivityEvidence(haystack)) {
        return {
          status: "failed",
          exitCode,
          ...terminalFields(failedTerminal),
          error: GROK_CONNECTIVITY_SAFE_ERROR,
          failureCategory: "connectivity",
        };
      }
      return {
        status: "failed",
        exitCode,
        ...terminalFields(failedTerminal),
        error: failedTerminal?.resultText?.trim()
          || stderr.trim().slice(0, 2_000)
          || "Grok Worker exited without a successful result",
      };
    }
    const succeededTerminal = resolveTerminal(false);
    return {
      status: "succeeded",
      exitCode,
      ...terminalFields(succeededTerminal),
    };
  }
}
