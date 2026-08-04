/**
 * Codex Runtime-native Goal execution via the Codex app-server.
 *
 * Drives one isolated `codex app-server` process over stdio JSON-RPC and binds
 * a persisted Thread Goal to one ForkLight Task lineage. Supports exact-thread
 * resume after interruption: the Thread id is written durably BEFORE the first
 * model Turn, and resume re-reads that authoritative binding instead of
 * guessing from the newest local session.
 *
 * Terminal success is an exact current-Turn join: Goal complete, Turn
 * completion, and canonical final output (camelCase agentMessage with
 * final_answer, or narrowly contained legacy phase:null) must all carry the
 * active Turn id. turn/start same-burst notifications are race-buffered until
 * the Turn binding is durable, then replayed in order. Active Turn identity is
 * correlated from the turn/start response and any one unambiguous same-Thread
 * turn/started announcement observed in that race (real app-servers may use a
 * different notification id than the RPC result); with no started evidence the
 * response id remains the fallback. A later explicit same-Thread turn/started
 * may promote only after the prior Turn ended (completed/failed/interrupted)
 * and only after the new Turn id is durably bound; same-Thread notifications
 * are buffered during that write and replayed after success, with fail-closed
 * handling for write failure, overflow, and overlapping starts. Cumulative
 * usage is a same-Thread replace snapshot, including resume-time traffic
 * preserved until identity is authoritative.
 *
 * Boundaries: no fresh-thread substitution on resume, no hidden permission
 * expansion, no raw prompts/private content on public surfaces, and no
 * unbounded local retry loop. ForkLight duration and no-progress controllers
 * stay authoritative. The no-progress watchdog arms before the first setup
 * request and refreshes on proven setup progress (setup responses and durable
 * binding writes). After the active Turn is bound, only concrete effective
 * progress refreshes it: exact current-Turn command/file tool lifecycle,
 * materially new private diff evidence, new accepted final output, or a real
 * terminal transition (Turn completed / first Goal complete gate). Usage,
 * status churn, plan/unknown traffic, message deltas, and continuation starts
 * are liveness only. Null no-progress stays unlimited with no total-time cap.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { noProgressFromSnapshot, stopGraceFromSnapshot } from "../core/advanced-policy.js";
import { workerNetworkPolicyMode } from "../core/network-policy.js";
import { currentBuildIdentity } from "../core/build-identity.js";
import {
  RUNTIME_ACTIVITY_EFFECTIVE,
  RUNTIME_ACTIVITY_LIVENESS,
  withActivityEvidence,
} from "../core/runtime-activity.js";
import { buildWorkerPrompt, workerPromptAppendicesForTask } from "../core/task.js";
import { cloneDefaults } from "../core/settings.js";
import type {
  AttemptTokenUsage,
  TaskRecord,
  TaskSpec,
} from "../core/types.js";
import {
  codexAppServerTokenUsage,
  privateCodexDiffDigest,
  projectCodexAppServerFinalItem,
  projectCodexAppServerItemProgress,
  projectCodexAppServerWorkspaceChangeMilestone,
} from "../events/codex-normalize.js";
import {
  buildCodexWorkerEnv,
  CODEX_WORKSPACE_WRITE_SANDBOX_OVERRIDES,
  codexHardBoundaryPolicy,
  codexWorkspaceToolLines,
  seedCodexHome,
} from "./codex.js";
import type { WorkerExecutionResult, WorkerRunContext } from "./types.js";

const CODEX_GOAL_OBJECTIVE_MAX = 4000;
/** Same-burst turn/start notifications are buffered until the Turn binding is
 *  durable. Overflow fails closed rather than dropping evidence silently. */
const TURN_START_RACE_BUFFER_MAX = 64;

const TERMINAL_NON_SUCCESS_GOAL_STATUS = new Set([
  "blocked",
  "paused",
  "usageLimited",
  "budgetLimited",
]);

function isContinuableGoalStatus(status: string): boolean {
  return status === "active";
}

function stableGoalFailureReason(status: string): string {
  switch (status) {
    case "blocked": return "Codex native Goal reported blocked and cannot continue";
    case "paused": return "Codex native Goal reported paused and cannot continue";
    case "usageLimited": return "Codex native Goal reached its usage limit and cannot continue";
    case "budgetLimited": return "Codex native Goal reached its budget limit and cannot continue";
    default: return `Codex native Goal stopped with status ${status}`;
  }
}

/** Bounded native Goal objective derived from the frozen Task Contract. */
function buildGoalObjective(spec: TaskSpec): string {
  const lines = spec.version === 1
    ? [
        `Goal: ${spec.goal}`,
        ...spec.constraints.map((constraint) => `Constraint: ${constraint}`),
      ]
    : [
        `Outcome: ${spec.contract.outcome}`,
        ...spec.acceptance.criteria.map((criterion) => `Acceptance: ${criterion}`),
      ];
  return lines.join("\n").slice(0, CODEX_GOAL_OBJECTIVE_MAX);
}

function codexGoalToolLines(task: TaskRecord): string[] {
  return [
    ...codexWorkspaceToolLines(task.spec.worker.allowEdits),
    "- Project instructions from operator config are disabled for this Goal.",
    "- This is a Runtime-native Goal: it owns the bounded end-to-end implementation.",
    "- ForkLight still owns the workspace boundary, independent acceptance, no-progress stop, finite correction/retry authority, and return to Main.",
  ];
}

function codexGoalCheckpointLines(): string[] {
  return [
    "- This Codex Runtime-native Goal does not support ForkLight checkpoint MCP.",
    "- ForkLight will run the independent acceptance commands after the Goal completes.",
  ];
}

/** Minimal task-local app-server config mirroring the single-run CLI flags.
 *  Enforces the exact frozen model and effort, approval=never, disabled
 *  apps/web/multi-agent/project-instructions, and never broadens permissions.
 *  The app-server is long-lived, so these are encoded in config.toml rather
 *  than per-invocation flags. Config is defense in depth only: every Thread
 *  and Turn request must also carry the same frozen policy on the wire. */
function codexGoalConfig(model: string, effort: string, allowEdits: boolean): string {
  return [
    `model = ${JSON.stringify(model)}`,
    `model_reasoning_effort = ${JSON.stringify(effort)}`,
    'approval_policy = "never"',
    `sandbox_mode = ${JSON.stringify(allowEdits ? "workspace-write" : "read-only")}`,
    "project_doc_max_bytes = 0",
    'web_search = "disabled"',
    "",
    // Explicit workspace-write refinements (same contract as single-run -c flags).
    // exclude_tmpdir_env_var is intentionally omitted so task-private TMPDIR stays usable.
    "[sandbox_workspace_write]",
    `network_access = ${CODEX_WORKSPACE_WRITE_SANDBOX_OVERRIDES.networkAccess}`,
    `exclude_slash_tmp = ${CODEX_WORKSPACE_WRITE_SANDBOX_OVERRIDES.excludeSlashTmp}`,
    "",
    "[features]",
    "apps = false",
    "multi_agent = false",
    "",
    "",
  ].join("\n");
}

/** Canonical least-privilege Thread/Turn policy derived from one frozen Task.
 *  Thread sandbox uses kebab-case enum values; Turn sandboxPolicy uses camelCase
 *  tagged objects. Never expands to dangerFullAccess, extra roots, or inherited
 *  approval defaults. */
function codexGoalPolicy(task: TaskRecord): {
  thread: {
    cwd: string;
    model: string;
    approvalPolicy: "never";
    sandbox: "workspace-write" | "read-only";
  };
  turn: {
    cwd: string;
    model: string;
    effort: string;
    approvalPolicy: "never";
    sandboxPolicy:
      | { type: "workspaceWrite"; writableRoots: string[]; networkAccess: false }
      | { type: "readOnly"; networkAccess: false };
  };
} {
  const cwd = task.paths.workspace;
  const model = task.spec.provider.model;
  const effort = task.spec.runtime.effort;
  const allowEdits = task.spec.worker.allowEdits;
  return {
    thread: {
      cwd,
      model,
      approvalPolicy: "never",
      sandbox: allowEdits ? "workspace-write" : "read-only",
    },
    turn: {
      cwd,
      model,
      effort,
      approvalPolicy: "never",
      sandboxPolicy: allowEdits
        ? { type: "workspaceWrite", writableRoots: [cwd], networkAccess: false }
        : { type: "readOnly", networkAccess: false },
    },
  };
}

// --- Durable exact Thread/Goal binding ---

interface CodexGoalBinding {
  schemaVersion: 1;
  threadId: string;
  objective: string;
  turnId?: string;
  updatedAt: string;
}

async function readGoalBinding(bindingPath: string): Promise<CodexGoalBinding> {
  let raw: string;
  try {
    raw = await readFile(bindingPath, "utf8");
  } catch {
    throw new Error("Codex native Goal has no durable Thread binding to resume");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Codex native Goal binding is malformed; refusing to resume");
  }
  const binding = parsed as Record<string, unknown>;
  if (
    binding === null
    || typeof binding !== "object"
    || binding.schemaVersion !== 1
    || typeof binding.threadId !== "string"
    || binding.threadId.length < 1
    || typeof binding.objective !== "string"
    || binding.objective.length < 1
  ) {
    throw new Error("Codex native Goal binding is invalid; refusing to resume");
  }
  return {
    schemaVersion: 1,
    threadId: binding.threadId,
    objective: binding.objective,
    ...(typeof binding.turnId === "string" ? { turnId: binding.turnId } : {}),
    updatedAt: new Date().toISOString(),
  };
}

async function writeGoalBinding(
  bindingPath: string,
  binding: CodexGoalBinding,
): Promise<void> {
  await writeFile(bindingPath, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600 });
}

// --- JSON-RPC 2.0 client over stdio ---
//
// Outbound requests always send `jsonrpc: "2.0"`. Inbound envelopes from
// installed Codex app-server 0.146.0 may omit that member while remaining
// otherwise canonical: numeric-id responses (`id` + `result`|`error`) and
// method notifications (`method` + object `params`, optionally with
// non-authoritative fields such as `emittedAtMs`). Explicit wrong versions,
// ambiguous response/notification hybrids, and malformed ids/methods/payloads
// fail closed.

interface JsonRpcMessage {
  jsonrpc?: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function objectResult(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Codex app-server returned an invalid result");
  }
  return value as Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type InboundAppServerEnvelope =
  | { kind: "response"; message: JsonRpcMessage }
  | { kind: "notification"; method: string; params: Record<string, unknown> }
  | { kind: "invalid"; detail: string };

/**
 * Narrow inbound predicate for Codex app-server stdout lines.
 * Accepts explicit `jsonrpc: "2.0"` or its omission only for otherwise
 * canonical response/notification shapes; never treats arbitrary objects as
 * protocol traffic.
 */
function classifyAppServerEnvelope(raw: unknown): InboundAppServerEnvelope {
  if (!isPlainObject(raw)) {
    return { kind: "invalid", detail: "Codex app-server emitted an invalid JSON-RPC envelope" };
  }
  if (Object.prototype.hasOwnProperty.call(raw, "jsonrpc") && raw.jsonrpc !== "2.0") {
    return { kind: "invalid", detail: "Codex app-server emitted an invalid JSON-RPC envelope" };
  }

  const hasId = Object.prototype.hasOwnProperty.call(raw, "id");
  const hasMethod = Object.prototype.hasOwnProperty.call(raw, "method");
  // Ambiguous hybrid: one object must not carry both response and notification identity.
  if (hasId && hasMethod) {
    return { kind: "invalid", detail: "Codex app-server emitted an invalid JSON-RPC envelope" };
  }

  if (hasId) {
    if (typeof raw.id !== "number" || !Number.isFinite(raw.id)) {
      return { kind: "invalid", detail: "Codex app-server emitted an invalid JSON-RPC envelope" };
    }
    const hasResult = Object.prototype.hasOwnProperty.call(raw, "result");
    const hasError = Object.prototype.hasOwnProperty.call(raw, "error");
    if (hasResult === hasError) {
      // Neither or both: not a canonical response.
      return { kind: "invalid", detail: "Codex app-server emitted an invalid JSON-RPC envelope" };
    }
    if (hasError) {
      const error = raw.error;
      if (
        !isPlainObject(error)
        || typeof error.message !== "string"
        || (error.code !== undefined && typeof error.code !== "number")
      ) {
        return { kind: "invalid", detail: "Codex app-server emitted an invalid JSON-RPC envelope" };
      }
      return {
        kind: "response",
        message: {
          id: raw.id,
          error: {
            code: typeof error.code === "number" ? error.code : -32603,
            message: error.message,
            ...(error.data === undefined ? {} : { data: error.data }),
          },
        },
      };
    }
    return {
      kind: "response",
      message: { id: raw.id, result: raw.result },
    };
  }

  if (hasMethod) {
    if (typeof raw.method !== "string" || raw.method.length < 1) {
      return { kind: "invalid", detail: "Codex app-server emitted an invalid JSON-RPC envelope" };
    }
    if (raw.params === undefined || raw.params === null) {
      return { kind: "notification", method: raw.method, params: {} };
    }
    if (!isPlainObject(raw.params)) {
      return { kind: "invalid", detail: "Codex app-server emitted an invalid JSON-RPC envelope" };
    }
    // Extra non-authoritative fields (e.g. emittedAtMs) are ignored.
    return { kind: "notification", method: raw.method, params: raw.params };
  }

  return { kind: "invalid", detail: "Codex app-server emitted an invalid JSON-RPC envelope" };
}

class CodexAppServerClient {
  private nextId = 1;
  private readonly pending = new Map<number, (message: JsonRpcMessage) => void>();
  private closed = false;

  constructor(
    private readonly child: ChildProcess,
    private readonly onNotification: (
      method: string,
      params: Record<string, unknown>,
    ) => void,
    private readonly onMalformed: (detail: string) => void,
  ) {}

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error(`Codex app-server closed before ${method}`));
        return;
      }
      this.pending.set(id, (message) => {
        if (message.error !== undefined) {
          reject(new Error(`Codex app-server ${method} failed: ${message.error.message}`));
        } else {
          resolve(message.result);
        }
      });
      try {
        this.child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Fire a JSON-RPC notification (no id, no response). Used only for the
   *  `initialized` lifecycle notification after `initialize` succeeds. */
  notify(method: string, params: Record<string, unknown>): void {
    if (this.closed) {
      throw new Error(`Codex app-server closed before ${method}`);
    }
    this.child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  handleLine(line: string): void {
    if (this.closed) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      this.onMalformed("Codex app-server emitted malformed JSON-RPC");
      return;
    }
    const envelope = classifyAppServerEnvelope(raw);
    if (envelope.kind === "invalid") {
      this.onMalformed(envelope.detail);
      return;
    }
    if (envelope.kind === "response") {
      const id = envelope.message.id;
      if (typeof id !== "number") {
        this.onMalformed("Codex app-server emitted an invalid JSON-RPC envelope");
        return;
      }
      const resolve = this.pending.get(id);
      if (resolve === undefined) {
        this.onMalformed(`Codex app-server responded to an unknown request id ${id}`);
        return;
      }
      this.pending.delete(id);
      resolve(envelope.message);
      return;
    }
    this.onNotification(envelope.method, envelope.params);
  }

  close(): void {
    this.closed = true;
    const error: JsonRpcMessage = {
      id: -1,
      error: { code: -32603, message: "Codex app-server process closed" },
    };
    for (const resolve of this.pending.values()) {
      resolve(error);
    }
    this.pending.clear();
  }
}

/** Strict readers for the installed canonical app-server shapes: responses are
 *  nested under `result.thread`, `result.goal`, and `result.turn`; cumulative
 *  usage arrives as `params.tokenUsage.total` with camelCase counter names. */
function objectField(value: Record<string, unknown>, field: string): Record<string, unknown> {
  const child = value[field];
  if (child === null || typeof child !== "object" || Array.isArray(child)) {
    throw new Error(`Codex app-server omitted ${field}`);
  }
  return child as Record<string, unknown>;
}

function nonEmptyStringField(value: Record<string, unknown>, field: string): string | undefined {
  const child = value[field];
  return typeof child === "string" && child.length > 0 ? child : undefined;
}

function notificationUsage(params: Record<string, unknown>): AttemptTokenUsage | undefined {
  const tokenUsage = params.tokenUsage;
  if (tokenUsage === null || typeof tokenUsage !== "object" || Array.isArray(tokenUsage)) {
    return undefined;
  }
  return codexAppServerTokenUsage((tokenUsage as Record<string, unknown>).total);
}

/** Canonical nested `params.turn.id` from turn/started or turn/completed. */
function canonicalNestedTurnId(params: Record<string, unknown>): string | undefined {
  const turn = params.turn;
  if (turn === null || typeof turn !== "object" || Array.isArray(turn)) {
    return undefined;
  }
  return nonEmptyStringField(turn as Record<string, unknown>, "id");
}

/**
 * Resolve one authoritative active Turn from the turn/start RPC result and any
 * exact bound-Thread turn/started evidence in the race buffer.
 *
 * - No same-Thread started evidence → response Turn id (compatibility).
 * - One unambiguous same-Thread started id → that id (even when it differs).
 * - Distinct same-Thread started ids or malformed same-Thread started → fail closed.
 * Unrelated-Thread started notifications are inert and never invent authority.
 */
function resolveActiveTurnId(
  responseTurnId: string,
  buffered: ReadonlyArray<{ method: string; params: Record<string, unknown> }>,
  boundThreadId: string,
): { ok: true; turnId: string } | { ok: false; reason: string; reasonCode: string } {
  const startedIds = new Set<string>();
  for (const entry of buffered) {
    if (entry.method !== "turn/started") continue;
    if (entry.params.threadId !== boundThreadId) continue;
    const startedId = canonicalNestedTurnId(entry.params);
    if (startedId === undefined) {
      return {
        ok: false,
        reason: "Codex native Goal emitted a Turn start without a canonical turn payload",
        reasonCode: "codex-goal-turn-start-malformed",
      };
    }
    startedIds.add(startedId);
  }
  if (startedIds.size === 0) {
    return { ok: true, turnId: responseTurnId };
  }
  if (startedIds.size > 1) {
    return {
      ok: false,
      reason: "Codex native Goal reported ambiguous Turn start identities",
      reasonCode: "codex-goal-turn-start-ambiguous",
    };
  }
  return { ok: true, turnId: startedIds.values().next().value as string };
}

function interruptedExitCode(code: number): number {
  return code === 0 ? 130 : code;
}

// --- Runner ---

export async function runCodexNativeGoal(
  ctx: WorkerRunContext,
  operatorCodexHome?: string,
): Promise<WorkerExecutionResult> {
  const { store, task, attempt, resuming, hooks = {} } = ctx;
  await mkdir(task.paths.logs, { recursive: true, mode: 0o700 });
  const codexHome = path.join(task.paths.root, "codex-home");
  const temporaryDirectory = path.join(task.paths.root, "codex-tmp");
  await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
  const seed = await seedCodexHome(codexHome, operatorCodexHome);
  // Write the task-local app-server config (mode 600) so the long-lived
  // process honors the same isolation and exact frozen identity as single-run.
  await writeFile(
    path.join(codexHome, "config.toml"),
    codexGoalConfig(task.spec.provider.model, task.spec.runtime.effort, task.spec.worker.allowEdits),
    { mode: 0o600 },
  );

  const prompt = buildWorkerPrompt(
    task.spec,
    resuming,
    hooks.feedback,
    workerPromptAppendicesForTask(task, {
      toolLines: codexGoalToolLines(task),
      checkpointLines: codexGoalCheckpointLines(),
      hardBoundaryPolicy: codexHardBoundaryPolicy(task.spec.worker.allowEdits),
    }),
  );
  await writeFile(path.join(task.paths.logs, `attempt-${attempt.ordinal}.prompt.txt`), prompt, {
    mode: 0o600,
  });

  const bindingPath = path.join(task.paths.root, "codex-goal-binding.json");
  const objective = buildGoalObjective(task.spec);
  const frozenPolicy = codexGoalPolicy(task);
  const rawLog = createWriteStream(attempt.rawLogPath, { flags: "a", mode: 0o600 });
  const stderrPath = path.join(task.paths.logs, `attempt-${attempt.ordinal}.stderr.log`);
  const stderrChunks: string[] = [];

  const env = buildCodexWorkerEnv(codexHome, temporaryDirectory, task.spec.networkPolicy);
  const child = spawn(task.spec.runtime.executable || "codex", ["app-server"], {
    cwd: task.paths.workspace,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  hooks.onSpawn?.(child);
  if (child.pid !== undefined) {
    store.updateAttempt(attempt.id, { pid: child.pid });
    store.updateTask(task.id, { workerPid: child.pid });
  }

  const execution = ctx.execution ?? cloneDefaults().execution;
  const noProgressTimeoutMs = noProgressFromSnapshot(
    task.effectivePolicy,
    execution.noProgressTimeoutMs,
  );
  const stopGraceMs = stopGraceFromSnapshot(
    task.effectivePolicy,
    execution.workerStopGraceMs,
  );

  return await new Promise<WorkerExecutionResult>((resolveOutcome) => {
    let outcome: WorkerExecutionResult | undefined;
    let binding: CodexGoalBinding | undefined;
    /** Durable Thread known during resume identity validation before the
     *  binding is authoritative. Same-Thread usage may be preserved here
     *  without granting Goal/Turn/final authority. */
    let resumeExpectedThreadId: string | undefined;
    let pendingResumeUsage: AttemptTokenUsage | undefined;
    let goalStatus: string | undefined;
    let latestUsage: AttemptTokenUsage | undefined;
    /** Authoritative active Turn after correlation and durable write. */
    let currentTurnId: string | undefined;
    let currentTurnGoalComplete = false;
    let currentTurnCompleted = false;
    /** True once the active Turn emitted completed, failed, or interrupted.
     *  Distinct post-activation turn/started may promote only after this. */
    let currentTurnEnded = false;
    /** True only while the response-id compatibility fallback has no matching
     *  turn/started or any other exact-Turn evidence. The first canonical
     *  same-Thread start may still replace that provisional id. */
    let currentTurnAwaitingStartConfirmation = false;
    let finalResultText: string | undefined;
    /** Once any explicit non-null agentMessage phase is seen on the current
     *  Turn, later phase:null items cannot be accepted as legacy finals. */
    let sawExplicitNonNullPhase = false;
    /** Private per-Turn digest of the latest material `turn/diff/updated` body.
     *  Never published; used only to detect new workspace-change evidence. */
    let lastPrivateDiffDigest: string | undefined;
    /** At most one public workspace-change milestone is stored per active Turn. */
    let workspaceChangeMilestoneEmitted = false;
    /** Bounded per-Turn liveness publication: one row each for status, plan, and
     *  unknown traffic. None may refresh the effective-progress watchdog. */
    let livenessStatusEmitted = false;
    let livenessPlanEmitted = false;
    let livenessUnknownEmitted = false;
    let stopReason: "none" | "interrupt" | "no-progress" = "none";
    let watchdogTimer: ReturnType<typeof setTimeout> | undefined;
    let escalationTimer: ReturnType<typeof setTimeout> | undefined;
    let watchdogFired = false;
    /** Non-authoritative buffer open from immediately before turn/start through
     *  durable Turn activation. null means closed (normal strict path). */
    let turnStartRaceBuffer: Array<{ method: string; params: Record<string, unknown> }> | null = null;
    /** While replaying a race/continuation buffer, terminal success is deferred
     *  until every buffered entry has been applied so later cumulative usage
     *  and fail-closed evidence in the same burst still win. Failures settle
     *  immediately. */
    let replayingTurnStartBuffer = false;
    /**
     * In-flight post-activation continuation: durable binding write pending.
     * currentTurnId and per-Turn gates stay on the prior Turn until the write
     * succeeds; same-Thread notifications are buffered then replayed.
     */
    let continuationPromotion: {
      turnId: string;
      buffer: Array<{ method: string; params: Record<string, unknown> }>;
      priorBinding: CodexGoalBinding;
      invalidation?: { reason: string; reasonCode: string };
    } | null = null;

    let client: CodexAppServerClient | undefined;

    const clearWatchdog = (): void => {
      if (watchdogTimer !== undefined) clearTimeout(watchdogTimer);
      if (escalationTimer !== undefined) clearTimeout(escalationTimer);
      watchdogTimer = undefined;
      escalationTimer = undefined;
    };
    const scheduleWatchdog = (): void => {
      if (outcome !== undefined || watchdogFired || noProgressTimeoutMs === null) return;
      if (watchdogTimer !== undefined) clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(() => {
        watchdogFired = true;
        stopReason = "no-progress";
        void requestInterruptAndStop();
      }, noProgressTimeoutMs);
      watchdogTimer.unref();
    };

    const requestInterruptAndStop = async (): Promise<void> => {
      if (outcome !== undefined) return;
      clearWatchdog();
      // Best-effort turn/interrupt before termination: the durable Goal
      // survives even when the process is killed without an ack. Never block
      // the grace-policy termination on the interrupt acknowledgement.
      if (binding !== undefined && client !== undefined) {
        void client.request("turn/interrupt", {
          threadId: binding.threadId,
          ...(binding.turnId === undefined ? {} : { turnId: binding.turnId }),
        }).catch(() => {
          // Best-effort only.
        });
      }
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill("SIGINT");
        } catch {
          // ignore
        }
        escalationTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            try {
              child.kill("SIGTERM");
            } catch {
              // ignore
            }
          }
        }, stopGraceMs);
        escalationTimer.unref();
      }
    };

    const checkExternalInterrupt = (): void => {
      if (stopReason === "none" && hooks.wasInterrupted?.() === true) {
        stopReason = "interrupt";
        void requestInterruptAndStop();
      }
    };

    // stdout/stderr are consumed eagerly; `client` is assigned right after and
    // the line handler only fires once the app-server actually emits, so the
    // optional chaining below is safe.
    const stdoutDone = new Promise<void>((resolve) => {
      if (!child.stdout) return resolve();
      const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
      lines.on("line", (line) => {
        rawLog.write(`${line}\n`);
        client?.handleLine(line);
      });
      lines.on("close", resolve);
    });
    const stderrDone = new Promise<void>((resolve) => {
      if (!child.stderr) return resolve();
      child.stderr.on("data", (chunk: Buffer | string) => stderrChunks.push(String(chunk)));
      child.stderr.on("end", resolve);
      child.stderr.on("error", resolve);
    });

    const finalize = async (): Promise<void> => {
      try {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            child.stdin?.end();
          } catch {
            // ignore
          }
          try {
            child.kill("SIGTERM");
          } catch {
            // ignore
          }
        }
        await Promise.all([stdoutDone, stderrDone]);
        await new Promise<void>((resolve) => rawLog.end(resolve));
        await writeFile(stderrPath, stderrChunks.join(""), { mode: 0o600 });
      } finally {
        resolveOutcome(outcome as WorkerExecutionResult);
      }
    };

    const settle = (result: WorkerExecutionResult): void => {
      if (outcome !== undefined) return;
      outcome = result;
      turnStartRaceBuffer = null;
      continuationPromotion = null;
      clearWatchdog();
      void finalize();
    };

    const fail = (reason: string, reasonCode: string): void => {
      if (outcome !== undefined) return;
      turnStartRaceBuffer = null;
      continuationPromotion = null;
      store.addEvent(task.id, attempt.id, "worker.failed", reason, {
        failureCategory: "runtime",
        reasonCode,
        ...(binding === undefined ? {} : { threadId: binding.threadId }),
        ...(goalStatus === undefined ? {} : { goalStatus }),
      });
      hooks.onEvent?.({
        type: "worker.failed",
        summary: reason,
        payload: { failureCategory: "runtime", reasonCode },
        terminal: { isError: true, failureReason: reason },
      });
      settle({ status: "failed", exitCode: 1, error: reason, failureCategory: "runtime" });
    };

    /** Success requires the exact current-Turn Goal complete, Turn completion,
     *  and canonical final output. Goal complete alone is never sufficient.
     *  During turn/start buffer replay this only records gates; the join runs
     *  once after the full batch so later usage/evidence is not skipped. */
    const tryJoinTerminalSuccess = (): void => {
      if (outcome !== undefined || replayingTurnStartBuffer) return;
      if (!currentTurnGoalComplete || !currentTurnCompleted || finalResultText === undefined) {
        return;
      }
      store.addEvent(task.id, attempt.id, "worker.completed", "Codex native Goal completed", {
        threadId: binding?.threadId,
        turnId: currentTurnId,
        goalStatus: "complete",
      });
      hooks.onEvent?.({
        type: "worker.completed",
        summary: "Codex native Goal completed",
        terminal: {
          isError: false,
          resultText: finalResultText,
          ...(latestUsage === undefined ? {} : { usage: latestUsage }),
        },
      });
      settle({
        status: "succeeded",
        exitCode: 0,
        resultText: finalResultText,
        ...(latestUsage === undefined ? {} : { usage: latestUsage }),
      });
    };

    const notificationTurnId = (params: Record<string, unknown>): string | undefined => {
      const turnId = params.turnId;
      return typeof turnId === "string" && turnId.length > 0 ? turnId : undefined;
    };

    const isExactCurrentTurn = (turnId: string | undefined): boolean => (
      currentTurnId !== undefined
      && turnId !== undefined
      && turnId === currentTurnId
    );

    /** Reset private per-Turn progress projection state when authority moves. */
    const resetTurnProgressProjection = (): void => {
      lastPrivateDiffDigest = undefined;
      workspaceChangeMilestoneEmitted = false;
      livenessStatusEmitted = false;
      livenessPlanEmitted = false;
      livenessUnknownEmitted = false;
    };

    /**
     * Publish one privacy-safe progress event. Effective tool/file/workspace
     * evidence also refreshes the post-activation no-progress watchdog.
     */
    const publishProgressEvent = (
      type: "worker.tool.started" | "worker.tool.completed" | "worker.message",
      summary: string,
      payload: Record<string, unknown>,
      options: { refreshWatchdog: boolean },
    ): void => {
      store.addEvent(task.id, attempt.id, type, summary, payload);
      hooks.onEvent?.({ type, summary, payload });
      if (options.refreshWatchdog) {
        scheduleWatchdog();
      }
    };

    const processNotification = (
      method: string,
      params: Record<string, unknown>,
    ): void => {
      if (outcome !== undefined) return;
      checkExternalInterrupt();
      if (outcome !== undefined) return;

      // Exact Thread identity: only notifications that belong to the bound
      // Thread may carry effective evidence. Unrelated, unidentifiable, or
      // pre-binding traffic is ignored and never resets the no-progress
      // watchdog, so protocol drift can never fake Goal progress.
      const notificationThreadId = params.threadId;
      const boundNotification = binding !== undefined
        && notificationThreadId === binding.threadId;

      // Resume-time cumulative usage: preserve the latest exact same-Thread
      // snapshot while identity validation is still in flight. No Goal/Turn
      // authority is granted here; the snapshot becomes effective once.
      if (
        method === "thread/tokenUsage/updated"
        && binding === undefined
        && resumeExpectedThreadId !== undefined
        && notificationThreadId === resumeExpectedThreadId
      ) {
        const usage = notificationUsage(params);
        if (usage === undefined) {
          fail("Codex native Goal reported malformed usage evidence", "codex-goal-usage-malformed");
          return;
        }
        pendingResumeUsage = usage;
        return;
      }

      const recognized = method === "thread/goal/updated"
        || method === "thread/tokenUsage/updated"
        || method === "turn/completed"
        || method === "turn/started"
        || method === "item/started"
        || method === "item/completed"
        || method === "item/agentMessage/delta"
        || method === "turn/diff/updated"
        || method === "turn/plan/updated";
      if (recognized) {
        if (!boundNotification) return;
      } else if (notificationThreadId !== undefined && !boundNotification) {
        return;
      }

      // Streaming answer deltas: never store one event per token/delta and
      // never treat character output as effective progress. Prefer the early
      // drop in onNotification so same-burst floods never enter race buffers.
      if (method === "item/agentMessage/delta") {
        return;
      }

      if (method === "turn/started") {
        // Explicit same-Thread Turn announcement. During initial turn/start
        // correlation this is resolved from the race buffer before replay; on
        // replay the already-active id is inert. A later distinct id may promote
        // only after the prior Turn ended and only after the new binding is
        // durable — never mutate currentTurnId or gates before that write.
        // Overlapping continuation starts are invalidated only in the
        // continuation buffer path (single authority), not re-checked here.
        if (binding === undefined) return;
        const bound = binding;
        const startedId = canonicalNestedTurnId(params);
        if (startedId === undefined) {
          fail(
            "Codex native Goal emitted a Turn start without a canonical turn payload",
            "codex-goal-turn-start-malformed",
          );
          return;
        }
        if (currentTurnId === undefined) {
          return;
        }
        if (startedId === currentTurnId) {
          currentTurnAwaitingStartConfirmation = false;
          return;
        }
        const lateInitialCorrelation = currentTurnAwaitingStartConfirmation;
        if (!lateInitialCorrelation && !currentTurnEnded) {
          fail(
            "Codex native Goal started a new Turn before the prior Turn ended",
            "codex-goal-turn-continuation-premature",
          );
          return;
        }
        const promoteTo = startedId;
        const nextBinding: CodexGoalBinding = {
          schemaVersion: 1,
          threadId: bound.threadId,
          objective: bound.objective,
          turnId: promoteTo,
          updatedAt: new Date().toISOString(),
        };
        // Open the continuation buffer before the awaited write so same-burst
        // evidence cannot apply under the prior Turn or a non-durable id.
        continuationPromotion = {
          turnId: promoteTo,
          buffer: [],
          priorBinding: bound,
        };
        void writeGoalBinding(bindingPath, nextBinding).then(async () => {
          const promotion = continuationPromotion;
          if (promotion === null || promotion.turnId !== promoteTo) {
            return;
          }
          if (promotion.invalidation !== undefined) {
            const invalidation = promotion.invalidation;
            continuationPromotion = null;
            try {
              // The invalidated write may already have replaced the canonical
              // file. Restore the last authoritative binding before exposing
              // the failure so restart/interrupt can never target the rejected
              // Turn.
              await writeGoalBinding(bindingPath, promotion.priorBinding);
            } catch {
              fail(
                "Codex native Goal could not restore its prior Turn binding after an invalid continuation",
                "codex-goal-binding-restore-failed",
              );
              return;
            }
            if (outcome === undefined) {
              fail(invalidation.reason, invalidation.reasonCode);
            }
            return;
          }
          if (outcome !== undefined) return;
          const buffered = promotion.buffer;
          continuationPromotion = null;
          // Durable write succeeded: only now move authority and reset gates.
          binding = nextBinding;
          currentTurnId = promoteTo;
          currentTurnGoalComplete = false;
          currentTurnCompleted = false;
          currentTurnEnded = false;
          currentTurnAwaitingStartConfirmation = false;
          finalResultText = undefined;
          sawExplicitNonNullPhase = false;
          resetTurnProgressProjection();
          // Continuation start is Runtime liveness only: it cannot reset the
          // post-activation effective-progress watchdog by itself.
          store.addEvent(task.id, attempt.id, "worker.message", "Codex native Goal started a continuation Turn", withActivityEvidence({
            activityKind: "goal-turn-started",
            threadId: nextBinding.threadId,
            turnId: promoteTo,
          }, RUNTIME_ACTIVITY_LIVENESS));
          hooks.onEvent?.({
            type: "worker.message",
            summary: "Codex native Goal started a continuation Turn",
          });
          replayingTurnStartBuffer = true;
          try {
            for (const entry of buffered) {
              if (outcome !== undefined) break;
              processNotification(entry.method, entry.params);
            }
          } finally {
            replayingTurnStartBuffer = false;
          }
          if (outcome !== undefined) return;
          tryJoinTerminalSuccess();
        }).catch((error) => {
          if (outcome !== undefined) return;
          continuationPromotion = null;
          const message = error instanceof Error ? error.message : String(error);
          fail(
            `Codex native Goal failed to persist Turn binding: ${message}`,
            "codex-goal-binding-write-failed",
          );
        });
        return;
      }

      if (method === "thread/goal/updated") {
        // Effective Goal evidence requires params.turnId equal to the current
        // Turn. Pre-request, missing, or stale turnId is inert.
        if (!isExactCurrentTurn(notificationTurnId(params))) {
          return;
        }
        currentTurnAwaitingStartConfirmation = false;
        const goal = params.goal === null || typeof params.goal !== "object"
          || Array.isArray(params.goal)
          ? undefined
          : params.goal as Record<string, unknown>;
        const status = typeof goal?.status === "string" ? goal.status : undefined;
        if (status === undefined) {
          fail("Codex native Goal emitted a goal update without a status", "codex-goal-status-missing");
          return;
        }
        // Goal status churn is Runtime liveness only after activation: it must
        // not reset the no-effective-progress watchdog. The first transition
        // into the Goal-complete gate is a terminal transition and may refresh
        // while other join partners are still open. Public status rows are
        // coalesced to at most one privacy-safe event per Turn.
        goalStatus = status;
        if (status === "complete") {
          const firstCompleteGate = !currentTurnGoalComplete;
          currentTurnGoalComplete = true;
          tryJoinTerminalSuccess();
          if (outcome === undefined && firstCompleteGate) {
            scheduleWatchdog();
          }
          return;
        }
        // Exact current-Turn non-complete status invalidates any earlier
        // completion gate so a later "active" (or similar) cannot leave stale
        // success authority behind.
        currentTurnGoalComplete = false;
        if (TERMINAL_NON_SUCCESS_GOAL_STATUS.has(status)) {
          fail(stableGoalFailureReason(status), "codex-goal-stopped");
          return;
        }
        if (!livenessStatusEmitted) {
          livenessStatusEmitted = true;
          // Closed status label only — never raw goal payload fields.
          const summary = status === "active"
            ? "Codex native Goal is active"
            : "Codex native Goal reported a status update";
          store.addEvent(task.id, attempt.id, "worker.message", summary, withActivityEvidence({
            activityKind: "goal-activity",
            goalStatus: status,
            threadId: binding?.threadId,
            turnId: currentTurnId,
          }, RUNTIME_ACTIVITY_LIVENESS));
          hooks.onEvent?.({
            type: "worker.message",
            summary,
          });
        }
        return;
      }

      if (method === "thread/tokenUsage/updated") {
        const usage = notificationUsage(params);
        if (usage === undefined) {
          fail("Codex native Goal reported malformed usage evidence", "codex-goal-usage-malformed");
          return;
        }
        // Cumulative snapshot REPLACES any earlier total — never double-counts
        // automatic continuation Turns. Token-usage changes are liveness only
        // after activation and must not reset the effective-progress watchdog.
        latestUsage = usage;
        return;
      }

      if (method === "item/started" || method === "item/completed") {
        // Tool/file lifecycle and final output require the exact current Turn.
        // Stale/missing turnId cannot invent progress or terminal text.
        if (!isExactCurrentTurn(notificationTurnId(params))) {
          return;
        }
        currentTurnAwaitingStartConfirmation = false;
        // Privacy-safe command/file projection first: never store command, cwd,
        // output, path, or content from the raw item payload.
        const toolProgress = projectCodexAppServerItemProgress(method, params.item);
        if (toolProgress !== undefined) {
          publishProgressEvent(
            toolProgress.type,
            toolProgress.summary,
            {
              ...toolProgress.payload,
              threadId: binding?.threadId,
              turnId: currentTurnId,
            },
            { refreshWatchdog: true },
          );
          return;
        }
        if (method !== "item/completed") {
          // Non-tool item starts (including agentMessage) are not progress and
          // must not flood history.
          return;
        }
        // Final output only: commentary, snake_case, and unknown/missing phase
        // cannot invent resultText. Prompt/reasoning never enter this path.
        const projected = projectCodexAppServerFinalItem(
          params.item,
          !sawExplicitNonNullPhase,
        );
        if (projected.explicitNonNullPhase) {
          sawExplicitNonNullPhase = true;
        }
        if (projected.finalText !== undefined) {
          // Only a new final-answer body is effective progress.
          const finalChanged = finalResultText !== projected.finalText;
          finalResultText = projected.finalText;
          if (finalChanged) {
            scheduleWatchdog();
          }
          tryJoinTerminalSuccess();
        }
        return;
      }

      if (method === "turn/diff/updated") {
        // Material workspace-change evidence for the exact current Turn.
        // Private digest comparison may refresh the watchdog; public events
        // stay one bounded milestone per Turn and never carry the raw diff.
        if (!isExactCurrentTurn(notificationTurnId(params))) {
          return;
        }
        currentTurnAwaitingStartConfirmation = false;
        const digest = privateCodexDiffDigest(params.diff);
        if (digest === undefined) {
          return;
        }
        if (digest === lastPrivateDiffDigest) {
          return;
        }
        lastPrivateDiffDigest = digest;
        scheduleWatchdog();
        if (!workspaceChangeMilestoneEmitted) {
          workspaceChangeMilestoneEmitted = true;
          const milestone = projectCodexAppServerWorkspaceChangeMilestone();
          publishProgressEvent(
            milestone.type,
            milestone.summary,
            {
              ...milestone.payload,
              threadId: binding?.threadId,
              turnId: currentTurnId,
            },
            // Watchdog already refreshed for the private material change.
            { refreshWatchdog: false },
          );
        }
        return;
      }

      if (method === "turn/completed") {
        const turn = params.turn === null || typeof params.turn !== "object"
          || Array.isArray(params.turn)
          ? undefined
          : params.turn as Record<string, unknown>;
        const completedTurnId = typeof turn?.id === "string" && turn.id.length > 0
          ? turn.id
          : undefined;
        const turnStatus = typeof turn?.status === "string" ? turn.status : undefined;
        if (completedTurnId === undefined || turnStatus === undefined) {
          fail("Codex native Goal emitted a Turn completion without a canonical turn payload", "codex-goal-turn-malformed");
          return;
        }
        // Only the exact current Turn participates in the terminal join.
        // Stale or other-Turn completions are inert for gates and progress.
        if (!isExactCurrentTurn(completedTurnId)) {
          return;
        }
        currentTurnAwaitingStartConfirmation = false;
        if (turnStatus === "completed") {
          currentTurnEnded = true;
          currentTurnCompleted = true;
          tryJoinTerminalSuccess();
          if (outcome !== undefined) return;
          // Completed Turn is progress while other terminal gates are still
          // open; it never invents empty success by itself.
          scheduleWatchdog();
          if (!currentTurnGoalComplete || finalResultText === undefined) {
            store.addEvent(task.id, attempt.id, "worker.message", "Codex native Goal finished a Turn and is continuing", withActivityEvidence({
              activityKind: "goal-continuing",
              threadId: binding?.threadId,
              turnId: completedTurnId,
            }, RUNTIME_ACTIVITY_EFFECTIVE));
            hooks.onEvent?.({
              type: "worker.message",
              summary: "Codex native Goal finished a Turn and is continuing",
            });
          }
          return;
        }
        if (turnStatus === "interrupted" || turnStatus === "failed") {
          // Truthful and bounded: a failed/interrupted Turn ends the active
          // Turn (allowing a later explicit continuation) without refreshing
          // effective progress, so a stuck loop of failed Turns can never
          // defeat the no-progress watchdog.
          currentTurnEnded = true;
          store.addEvent(task.id, attempt.id, "worker.message", `Codex native Goal Turn ${turnStatus} while the Goal continues`, withActivityEvidence({
            activityKind: "goal-turn-interrupted",
            threadId: binding?.threadId,
            turnId: completedTurnId,
            turnStatus,
          }, RUNTIME_ACTIVITY_LIVENESS));
          hooks.onEvent?.({
            type: "worker.message",
            summary: `Codex native Goal Turn ${turnStatus} while the Goal continues`,
          });
          return;
        }
        fail(`Codex native Goal reported an unrecognized Turn status ${turnStatus}`, "codex-goal-turn-status-unknown");
        return;
      }

      // Plan updates: liveness only, one privacy-safe row per Turn, no payload.
      if (method === "turn/plan/updated") {
        if (!livenessPlanEmitted) {
          livenessPlanEmitted = true;
          const summary = "Codex native Goal updated its plan";
          store.addEvent(task.id, attempt.id, "worker.message", summary, withActivityEvidence({
            activityKind: "goal-activity",
            threadId: binding?.threadId,
            turnId: currentTurnId,
          }, RUNTIME_ACTIVITY_LIVENESS));
          hooks.onEvent?.({ type: "worker.message", summary });
        }
        return;
      }

      // Unknown future notification → at most one privacy-safe liveness row per
      // Turn. Never echo raw method names or payloads, and never refresh the
      // effective-progress watchdog.
      if (!livenessUnknownEmitted) {
        livenessUnknownEmitted = true;
        const summary = "Codex native Goal reported additional runtime activity";
        store.addEvent(task.id, attempt.id, "worker.message", summary, withActivityEvidence({
          activityKind: "goal-activity",
          threadId: binding?.threadId,
        }, RUNTIME_ACTIVITY_LIVENESS));
        hooks.onEvent?.({ type: "worker.message", summary });
      }
    };

    const onNotification = (
      method: string,
      params: Record<string, unknown>,
    ): void => {
      if (outcome !== undefined) return;
      checkExternalInterrupt();
      if (outcome !== undefined) return;

      // Drop streaming answer deltas before any race/continuation buffer so a
      // real same-burst flood cannot overflow the bounded buffer or invent
      // progress. processNotification also ignores them as defense in depth.
      if (method === "item/agentMessage/delta") {
        return;
      }

      // Buffer same-burst and in-flight notifications from immediately before
      // turn/start through durable Turn activation. Entries have no authority
      // until ordered replay after the binding write.
      if (turnStartRaceBuffer !== null) {
        if (turnStartRaceBuffer.length >= TURN_START_RACE_BUFFER_MAX) {
          turnStartRaceBuffer = null;
          fail(
            "Codex native Goal turn/start race buffer overflowed",
            "codex-goal-turn-start-race-overflow",
          );
          return;
        }
        turnStartRaceBuffer.push({ method, params });
        return;
      }

      // During continuation binding persistence, buffer same-Thread evidence
      // without changing authority. Fail closed on overflow, malformed starts,
      // or a distinct overlapping turn/started before the pending write lands.
      if (continuationPromotion !== null) {
        if (continuationPromotion.invalidation !== undefined) return;
        const boundThreadId = binding?.threadId;
        const notificationThreadId = params.threadId;
        const sameThread = boundThreadId !== undefined
          && notificationThreadId === boundThreadId;
        if (!sameThread) {
          // Unrelated traffic stays on the strict path (typically inert).
          processNotification(method, params);
          return;
        }
        if (method === "turn/started") {
          const startedId = canonicalNestedTurnId(params);
          if (startedId === undefined) {
            continuationPromotion.invalidation = {
              reason: "Codex native Goal emitted a Turn start without a canonical turn payload",
              reasonCode: "codex-goal-turn-start-malformed",
            };
            continuationPromotion.buffer = [];
            return;
          }
          if (
            startedId !== continuationPromotion.turnId
            && startedId !== currentTurnId
          ) {
            continuationPromotion.invalidation = {
              reason: "Codex native Goal reported overlapping Turn start identities",
              reasonCode: "codex-goal-turn-continuation-ambiguous",
            };
            continuationPromotion.buffer = [];
            return;
          }
        }
        if (continuationPromotion.buffer.length >= TURN_START_RACE_BUFFER_MAX) {
          continuationPromotion.invalidation = {
            reason: "Codex native Goal continuation race buffer overflowed",
            reasonCode: "codex-goal-turn-continuation-overflow",
          };
          continuationPromotion.buffer = [];
          return;
        }
        continuationPromotion.buffer.push({ method, params });
        return;
      }

      processNotification(method, params);
    };

    const onMalformed = (detail: string): void => {
      turnStartRaceBuffer = null;
      continuationPromotion = null;
      fail(detail, "codex-goal-protocol-malformed");
    };

    client = new CodexAppServerClient(child, onNotification, onMalformed);

    child.once("error", (error) => {
      if (outcome === undefined) {
        fail(`Unable to start Codex app-server: ${error.message}`, "codex-goal-spawn-failed");
      }
    });
    child.once("close", (code, signal) => {
      client?.close();
      if (outcome !== undefined) return;
      const interrupted = stopReason === "interrupt"
        || hooks.wasInterrupted?.() === true
        || signal === "SIGINT"
        || signal === "SIGTERM"
        || code === 130;
      if (stopReason === "no-progress") {
        store.addEvent(task.id, attempt.id, "worker.failed", "Codex native Goal made no effective progress", {
          failureCategory: "runtime",
          reasonCode: "codex-goal-no-progress",
          ...(binding === undefined ? {} : { threadId: binding.threadId }),
        });
        settle({
          status: "failed",
          exitCode: interruptedExitCode(code ?? 130),
          error: "No effective native Goal progress detected within the configured interval; Codex Worker was terminated",
          policyLimit: {
            category: "no-progress",
            enforcementPhase: "preemptive",
            configured: noProgressTimeoutMs,
            observed: noProgressTimeoutMs ?? 0,
            effect: "hard-fail",
            detail: "Codex native Goal reached the configured no-effective-progress interval and was terminated",
          },
        });
        return;
      }
      if (interrupted) {
        store.addEvent(task.id, attempt.id, "worker.interrupted", "Codex native Goal Worker interrupted");
        hooks.onEvent?.({ type: "worker.interrupted", summary: "Codex native Goal Worker interrupted" });
        settle({
          status: "interrupted",
          exitCode: interruptedExitCode(code ?? 130),
          error: "Worker execution interrupted",
        });
        return;
      }
      fail("Codex app-server exited without terminal native Goal evidence", "codex-goal-process-exited");
    });

    // --- Establish the durable Thread/Goal binding (new or exact resume) ---
    void (async () => {
      try {
        // Bound every setup wait with the same no-progress policy used at
        // runtime. Arm before the first request can hang; refresh only after
        // proven setup progress (successful setup responses and durable
        // binding writes). This is not a total setup deadline: each proven
        // step resets the interval. null no-progress stays unlimited.
        scheduleWatchdog();

        // Mandatory LSP-style handshake: the installed app-server rejects every
        // request before `initialize` succeeds, and requires the `initialized`
        // notification afterwards. `initialize` is sent before any Thread
        // request and `initialized` only after a successful response.
        objectResult(await client!.request("initialize", {
          clientInfo: {
            name: "forklight",
            version: currentBuildIdentity().packageVersion,
          },
        }));
        scheduleWatchdog();
        client!.notify("initialized", {});

        if (resuming) {
          const durable = await readGoalBinding(bindingPath);
          if (durable.objective !== objective) {
            fail("Codex native Goal binding objective drifted from the frozen Task Contract; refusing to resume", "codex-goal-identity-drift");
            return;
          }
          // Allow same-Thread cumulative usage to be preserved during identity
          // validation without granting Goal/Turn/final authority early.
          resumeExpectedThreadId = durable.threadId;
          const resumed = objectResult(await client!.request("thread/resume", {
            threadId: durable.threadId,
            ...frozenPolicy.thread,
          }));
          scheduleWatchdog();
          const resumedThreadId = nonEmptyStringField(objectField(resumed, "thread"), "id");
          if (resumedThreadId !== durable.threadId) {
            fail("Codex native Goal identity drift: resumed Thread does not match the durable binding", "codex-goal-identity-drift");
            return;
          }
          const goal = objectField(objectResult(await client!.request("thread/goal/get", {
            threadId: durable.threadId,
          })), "goal");
          scheduleWatchdog();
          const goalThreadId = nonEmptyStringField(goal, "threadId");
          if (goalThreadId === undefined || goalThreadId !== durable.threadId) {
            fail("Codex native Goal identity drift: persisted Goal does not belong to the durable Thread", "codex-goal-identity-drift");
            return;
          }
          const persistedObjective = nonEmptyStringField(goal, "objective");
          const persistedStatus = nonEmptyStringField(goal, "status");
          if (persistedObjective !== objective) {
            fail("Codex native Goal identity drift: persisted Goal objective does not match the frozen Task objective", "codex-goal-identity-drift");
            return;
          }
          if (persistedStatus === undefined || !isContinuableGoalStatus(persistedStatus)) {
            fail(`Codex native Goal cannot continue from status ${persistedStatus ?? "unknown"}`, "codex-goal-not-continuable");
            return;
          }
          goalStatus = persistedStatus;
          // Identity is confirmed: promote and clear the latest preserved
          // cumulative snapshot BEFORE the awaited durable write so a newer
          // bound same-Thread snapshot arriving during that write replaces it
          // rather than being overwritten by an older pending value.
          if (pendingResumeUsage !== undefined) {
            latestUsage = pendingResumeUsage;
            pendingResumeUsage = undefined;
          }
          resumeExpectedThreadId = undefined;
          binding = {
            schemaVersion: 1,
            threadId: durable.threadId,
            objective,
            updatedAt: new Date().toISOString(),
          };
          await writeGoalBinding(bindingPath, binding);
          scheduleWatchdog();
          store.addEvent(task.id, attempt.id, "worker.resumed", "Codex native Goal resumed the exact Thread", {
            model: task.spec.provider.model,
            provider: task.spec.provider.name,
            runtime: task.spec.runtime.name,
            effort: task.spec.runtime.effort,
            executionMode: "native-goal",
            isolation: "codex-app-server",
            authMode: "local-sign-in",
            threadId: binding.threadId,
            goalStatus: persistedStatus,
            correctionFeedbackIncluded: Boolean(hooks.feedback),
            // Privacy-safe: mode-level evidence only; proxy values never reach events.
            networkPolicyMode: workerNetworkPolicyMode(task.spec.networkPolicy),
          });
          hooks.onEvent?.({
            type: "worker.resumed",
            summary: "Codex native Goal resumed the exact Thread",
          });
        } else {
          // Canonical thread/start fields only: cwd/model/approvalPolicy/sandbox.
          // The former `workspace` field is ignored by installed Codex 0.146.0
          // and must never reappear (silent default inheritance risk).
          const thread = objectResult(await client!.request("thread/start", {
            ...frozenPolicy.thread,
          }));
          scheduleWatchdog();
          const threadId = nonEmptyStringField(objectField(thread, "thread"), "id");
          if (threadId === undefined) {
            fail("Codex app-server omitted its Thread identity", "codex-goal-thread-missing");
            return;
          }
          binding = {
            schemaVersion: 1,
            threadId,
            objective,
            updatedAt: new Date().toISOString(),
          };
          // Persist the durable binding BEFORE the first model Turn.
          await writeGoalBinding(bindingPath, binding);
          scheduleWatchdog();
          const goal = objectField(objectResult(await client!.request("thread/goal/set", {
            threadId,
            objective,
            status: "active",
            tokenBudget: null,
          })), "goal");
          scheduleWatchdog();
          const goalThreadId = nonEmptyStringField(goal, "threadId");
          if (goalThreadId === undefined || goalThreadId !== threadId) {
            fail("Codex native Goal identity drift: created Goal does not belong to the bound Thread", "codex-goal-identity-drift");
            return;
          }
          const goalStatusFromSet = nonEmptyStringField(goal, "status");
          if (goalStatusFromSet === undefined) {
            fail("Codex app-server omitted its Goal status", "codex-goal-status-missing");
            return;
          }
          goalStatus = goalStatusFromSet;
          await writeGoalBinding(bindingPath, binding);
          scheduleWatchdog();
          store.addEvent(task.id, attempt.id, "worker.started", "Codex native Goal started", {
            model: task.spec.provider.model,
            provider: task.spec.provider.name,
            runtime: task.spec.runtime.name,
            effort: task.spec.runtime.effort,
            executionMode: "native-goal",
            isolation: "codex-app-server",
            authMode: "local-sign-in",
            authSeeded: seed.seeded,
            threadId,
            goalStatus: goalStatusFromSet,
            correctionFeedbackIncluded: Boolean(hooks.feedback),
            // Privacy-safe: mode-level evidence only; proxy values never reach events.
            networkPolicyMode: workerNetworkPolicyMode(task.spec.networkPolicy),
          });
          hooks.onEvent?.({
            type: "worker.started",
            summary: "Codex native Goal started",
          });
        }

        if (binding === undefined) {
          fail("Codex native Goal binding was not established", "codex-goal-binding-missing");
          return;
        }
        // Open the non-authoritative race buffer immediately before turn/start
        // and keep it open through Turn correlation and the durable write so
        // same-burst turn/started and terminal notifications are not lost or
        // applied early under a provisional response id.
        turnStartRaceBuffer = [];
        // responseTurnId is the turn/start RPC result id (compatibility fallback).
        // activeTurnId is the correlated authoritative Turn after started evidence.
        let responseTurnId = "";
        let activeTurnId = "";
        try {
          // Every new or resumed Turn re-sends the same frozen least-privilege
          // policy so stored/operator defaults cannot silently broaden authority.
          const turn = objectResult(await client!.request("turn/start", {
            threadId: binding.threadId,
            input: [{ type: "text", text: prompt }],
            ...frozenPolicy.turn,
          }));
          scheduleWatchdog();
          // Same-burst overflow/malformed handling may settle before this
          // continuation runs; never activate a Turn after a terminal failure.
          if (outcome !== undefined) {
            turnStartRaceBuffer = null;
            return;
          }
          const turnId = nonEmptyStringField(objectField(turn, "turn"), "id");
          if (turnId === undefined) {
            turnStartRaceBuffer = null;
            fail("Codex app-server omitted its Turn identity", "codex-goal-turn-missing");
            return;
          }
          responseTurnId = turnId;
          // Correlate before any Turn-id durable write: real app-servers may
          // announce the active Turn via turn/started with an id that differs
          // from result.turn.id. Prefer the one unambiguous same-Thread
          // started id; fall back to the response id when none is present.
          const correlated = resolveActiveTurnId(
            responseTurnId,
            turnStartRaceBuffer ?? [],
            binding.threadId,
          );
          if (!correlated.ok) {
            turnStartRaceBuffer = null;
            fail(correlated.reason, correlated.reasonCode);
            return;
          }
          activeTurnId = correlated.turnId;
          binding = { ...binding, turnId: activeTurnId };
          await writeGoalBinding(bindingPath, binding);
          scheduleWatchdog();
          if (outcome !== undefined) {
            turnStartRaceBuffer = null;
            return;
          }
        } catch (error) {
          // Invalid/failed turn/start: discard buffered evidence without replay.
          turnStartRaceBuffer = null;
          throw error;
        }
        // Close the race buffer and re-correlate against the complete batch so
        // started evidence that drained during the durable write still wins.
        // Always pass the original RPC response id as the compatibility fallback.
        const buffered = turnStartRaceBuffer;
        turnStartRaceBuffer = null;
        const finalCorrelated = resolveActiveTurnId(
          responseTurnId,
          buffered ?? [],
          binding.threadId,
        );
        if (!finalCorrelated.ok) {
          fail(finalCorrelated.reason, finalCorrelated.reasonCode);
          return;
        }
        if (finalCorrelated.turnId !== activeTurnId) {
          activeTurnId = finalCorrelated.turnId;
          binding = { ...binding, turnId: activeTurnId };
          await writeGoalBinding(bindingPath, binding);
          scheduleWatchdog();
          if (outcome !== undefined) return;
        }
        // Activate the authoritative Turn, reset per-Turn terminal gates, then
        // replay the full buffered batch before any terminal success join so
        // later cumulative usage and fail-closed evidence in the same burst win.
        currentTurnId = activeTurnId;
        currentTurnGoalComplete = false;
        currentTurnCompleted = false;
        currentTurnEnded = false;
        currentTurnAwaitingStartConfirmation = !(buffered ?? []).some((entry) => (
          entry.method === "turn/started"
          && entry.params.threadId === binding?.threadId
          && canonicalNestedTurnId(entry.params) === activeTurnId
        ));
        finalResultText = undefined;
        sawExplicitNonNullPhase = false;
        resetTurnProgressProjection();
        replayingTurnStartBuffer = true;
        try {
          for (const entry of buffered ?? []) {
            // Failures may settle mid-batch; success never does during replay.
            if (outcome !== undefined) break;
            processNotification(entry.method, entry.params);
          }
        } finally {
          replayingTurnStartBuffer = false;
        }
        if (outcome !== undefined) return;
        tryJoinTerminalSuccess();
        if (outcome !== undefined) return;
        checkExternalInterrupt();
        // Runtime phase: continue the same refreshable no-progress protection.
        scheduleWatchdog();
      } catch (error) {
        turnStartRaceBuffer = null;
        // When the no-progress watchdog already stopped the child, the close
        // handler owns the policy-limit outcome. Do not rewrite it as setup
        // failure after the process-closed rejection races in. Rely on
        // outcome/watchdogFired (not a closure-narrowed stopReason compare):
        // the timer mutates stopReason outside this async function.
        if (outcome !== undefined || watchdogFired) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        fail(`Codex native Goal setup failed: ${message}`, "codex-goal-setup-failed");
      }
    })();
  });
}
