import {
  RUNTIME_ACTIVITY_EFFECTIVE,
  RUNTIME_ACTIVITY_LIVENESS,
  withActivityEvidence,
} from "../core/runtime-activity.js";
import type {
  AttemptTokenUsage,
  ModelTokenUsage,
  NormalizedWorkerEvent,
  WorkerClaim,
} from "../core/types.js";

type JsonObject = Record<string, unknown>;

/** Throttle interval for high-frequency Claude processing markers (ms).
 *  The first marker emits immediately; subsequent markers inside this window
 *  are dropped before Store writes. This is internal backpressure — it proves
 *  Runtime liveness only and never resets the no-effective-progress watchdog. */
const CLAUDE_PROCESSING_THROTTLE_MS = 15_000;

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function truncate(value: unknown, limit = 500): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function toolTarget(input: JsonObject): string {
  const target =
    input.file_path ?? input.path ?? input.command ?? input.pattern ?? input.query ?? input.description;
  return target === undefined ? "" : truncate(target, 240);
}

export type McpServerReadiness = "ready" | "failed" | "unknown";

/** One privacy-safe MCP readiness entry. Only bounded codes are stored. */
export interface McpServerReadinessEntry {
  name: string;
  status: McpServerReadiness;
}

function normalizeMcpStatus(value: unknown): McpServerReadiness | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "ready" || normalized === "running" || normalized === "connected" || normalized === "ok") {
    return "ready";
  }
  if (normalized === "failed" || normalized === "error" || normalized === "unavailable") {
    return "failed";
  }
  return "unknown";
}

/**
 * Project Claude init MCP readiness into bounded codes. Accepts the measured
 * Claude Code 2.1.206 shape (array of `{name, status}`), object-map shapes
 * (`{forklight_checkpoint: {status}}`), and camelCase variants. Only bounded
 * readiness codes are stored; raw server diagnostics never leave this parser.
 */
export function parseMcpServerReadiness(root: JsonObject): McpServerReadinessEntry[] {
  const raw = root.mcp_servers ?? root.mcpServers;
  const entries: McpServerReadinessEntry[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const server = asObject(item);
      if (server === undefined) continue;
      const name = typeof server.name === "string" ? server.name.trim() : "";
      const status = normalizeMcpStatus(server.status);
      if (name.length === 0 || status === undefined) continue;
      entries.push({ name, status });
    }
  } else {
    const map = asObject(raw);
    if (map !== undefined) {
      for (const [name, value] of Object.entries(map)) {
        if (name.length === 0) continue;
        const status = typeof value === "string"
          ? normalizeMcpStatus(value)
          : normalizeMcpStatus(asObject(value)?.status);
        if (status === undefined) continue;
        entries.push({ name, status });
      }
    }
  }
  return entries;
}

function strictNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value)) return undefined;
  if (!Number.isInteger(value)) return undefined;
  if (value < 0) return undefined;
  return value;
}

function parseModelUsage(value: unknown): ModelTokenUsage[] | undefined {
  const models = asObject(value);
  if (!models) return undefined;
  const entries: ModelTokenUsage[] = [];
  for (const [model, data] of Object.entries(models)) {
    const d = asObject(data);
    if (!d) continue;
    const inputTokens = strictNonNegativeInt(d.inputTokens);
    const outputTokens = strictNonNegativeInt(d.outputTokens);
    const cacheReadInputTokens = strictNonNegativeInt(d.cacheReadInputTokens);
    const cacheCreationInputTokens = strictNonNegativeInt(d.cacheCreationInputTokens);
    if (
      inputTokens === undefined ||
      outputTokens === undefined ||
      cacheReadInputTokens === undefined ||
      cacheCreationInputTokens === undefined
    ) continue;
    entries.push({ model, inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens });
  }
  return entries.length > 0 ? entries : undefined;
}

function parseTokenUsage(root: JsonObject): AttemptTokenUsage | undefined {
  const usage = asObject(root.usage);
  if (!usage) return undefined;
  const inputTokens = strictNonNegativeInt(usage.input_tokens);
  const outputTokens = strictNonNegativeInt(usage.output_tokens);
  const cacheReadInputTokens = strictNonNegativeInt(usage.cache_read_input_tokens);
  const cacheCreationInputTokens = strictNonNegativeInt(usage.cache_creation_input_tokens);
  if (
    inputTokens === undefined ||
    outputTokens === undefined ||
    cacheReadInputTokens === undefined ||
    cacheCreationInputTokens === undefined
  ) {
    return undefined;
  }
  const perModel = parseModelUsage(root.modelUsage);
  return {
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    ...(typeof usage.service_tier === "string" ? { serviceTier: usage.service_tier } : {}),
    ...(perModel === undefined ? {} : { perModel }),
    source: "terminal-result",
    complete: true,
  };
}

export class ClaudeEventNormalizer {
  private readonly tools = new Map<string, string>();
  private readonly completedTools = new Set<string>();
  /** Deterministic clock seam: returns milliseconds since epoch. */
  private readonly clock: () => number;
  /** Throttle interval for processing markers (ms). */
  private readonly processingThrottleMs: number;
  /** Timestamp (from clock) of the last emitted processing marker, or -1 if none. */
  private lastProcessingEmittedAt: number;

  constructor(input?: {
    clock?: () => number;
    processingThrottleMs?: number;
  }) {
    this.clock = input?.clock ?? (() => Date.now());
    this.processingThrottleMs = input?.processingThrottleMs ?? CLAUDE_PROCESSING_THROTTLE_MS;
    this.lastProcessingEmittedAt = -1;
  }

  parseLine(line: string): NormalizedWorkerEvent[] {
    let root: JsonObject;
    try {
      const parsed = JSON.parse(line) as unknown;
      const object = asObject(parsed);
      if (!object) return [];
      root = object;
    } catch {
      return [];
    }

    const type = root.type;
    if (type === "stream_event" || type === "rate_limit_event") return [];

    if (type === "system" && root.subtype === "init") {
      const sessionId = typeof root.session_id === "string" ? root.session_id : undefined;
      const mcpServers = parseMcpServerReadiness(root);
      return [
        {
          type: "worker.message",
          summary: `Claude Code initialized${typeof root.model === "string" ? ` with ${root.model}` : ""}`,
          payload: withActivityEvidence(
            {
              model: root.model,
              tools: root.tools,
              ...(mcpServers.length === 0 ? {} : { mcpServers }),
            },
            RUNTIME_ACTIVITY_LIVENESS,
          ),
          ...(sessionId === undefined ? {} : { sessionId }),
        },
      ];
    }

    if (type === "assistant") return this.parseAssistant(root);
    if (type === "user") return this.parseToolResults(root);

    if (type === "system" && root.subtype === "thinking_tokens") return this.parseProcessing(root);

    if (type === "result") {
      const isError = root.is_error === true;
      const stopReason = typeof root.stop_reason === "string" ? root.stop_reason : undefined;
      const subtype = typeof root.subtype === "string" ? root.subtype : undefined;
      // Explicit runtime error signals override is_error false.
      // A Worker that reports stop_reason "error" or an error subtype terminated
      // abnormally even when the envelope omits is_error or the process exits zero.
      const terminalError = isError
        || stopReason === "error"
        || (subtype !== undefined && (subtype === "error" || subtype.startsWith("error_")));
      const resultText = typeof root.result === "string" ? root.result : undefined;
      const costUsd = typeof root.total_cost_usd === "number" ? root.total_cost_usd : undefined;
      const turns = typeof root.num_turns === "number" ? root.num_turns : undefined;
      const usage = parseTokenUsage(root);
      const budgetExceeded = typeof subtype === "string"
        && (subtype === "error_max_budget_usd"
          || subtype.includes("max_budget")
          || subtype.includes("max-budget"));
      // FL-D15 / FL-D16: classify auth vs generic failure so status/inspect surfaces
      // the real blocker (e.g. 401 authentication_failed) instead of opaque "failure".
      const authFailed = (() => {
        const blob = [
          typeof subtype === "string" ? subtype : "",
          typeof resultText === "string" ? resultText : "",
          typeof stopReason === "string" ? stopReason : "",
        ].join(" ").toLowerCase();
        return (
          blob.includes("authentication_failed")
          || blob.includes("authentication failed")
          || /\b401\b/.test(blob)
          || blob.includes("invalid api key")
          || blob.includes("unauthorized")
        );
      })();
      const summary = terminalError
        ? (budgetExceeded
            ? (typeof costUsd === "number"
                ? `Worker stopped: max budget exceeded (runtime estimate $${costUsd.toFixed(6)})`
                : "Worker stopped: max budget exceeded")
            : authFailed
              ? "Worker failed: authentication/provider credentials rejected"
            : stopReason === "error" && !isError
              ? "Worker terminated with error stop reason"
              : subtype !== undefined && !isError
                ? "Worker reported an error terminal subtype"
                : "Worker reported failure")
        : "Worker reported completion";
      const failureCategory = budgetExceeded
        ? "budget"
        : authFailed
          ? "authentication"
          : terminalError
            ? "runtime"
            : undefined;
      const claim: WorkerClaim | undefined = !terminalError && resultText !== undefined
        ? { label: "unverified-claim", text: truncate(resultText, 2_000) }
        : undefined;
      return [
        {
          type: terminalError ? "worker.failed" : "worker.completed",
          summary,
          payload: {
            subtype: root.subtype,
            ...(stopReason !== undefined ? { stopReason } : {}),
            ...(claim === undefined ? {} : { claim }),
            ...(!terminalError || resultText === undefined
              ? {}
              : { result: truncate(resultText, 2_000) }),
            ...(costUsd === undefined ? {} : { costUsd }),
            ...(turns === undefined ? {} : { turns }),
            ...(usage === undefined ? {} : { usage }),
            ...(failureCategory === undefined ? {} : { failureCategory }),
          },
          terminal: {
            isError: terminalError,
            ...(terminalError ? { failureReason: summary } : {}),
            ...(resultText === undefined ? {} : { resultText }),
            ...(costUsd === undefined ? {} : { costUsd }),
            ...(turns === undefined ? {} : { turns }),
            ...(costUsd !== undefined ? { runtimeCostEstimateUsd: costUsd } : {}),
            ...(usage === undefined ? {} : { usage }),
          },
        },
      ];
    }

    return [];
  }

  private parseAssistant(root: JsonObject): NormalizedWorkerEvent[] {
    const message = asObject(root.message);
    const content = Array.isArray(message?.content) ? message.content : [];
    const events: NormalizedWorkerEvent[] = [];

    for (const blockValue of content) {
      const block = asObject(blockValue);
      if (!block) continue;
      if (block.type === "tool_use" && typeof block.name === "string") {
        const id = typeof block.id === "string" ? block.id : `${block.name}:${this.tools.size}`;
        if (this.tools.has(id)) continue;
        const input = asObject(block.input) ?? {};
        this.tools.set(id, block.name);
        const target = toolTarget(input);
        events.push({
          type: "worker.tool.started",
          summary: `${block.name}${target ? `: ${target}` : ""}`,
          payload: withActivityEvidence(
            { toolUseId: id, tool: block.name, target },
            RUNTIME_ACTIVITY_EFFECTIVE,
          ),
        });
      } else if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        events.push({
          type: "worker.message",
          summary: truncate(block.text.trim(), 500),
          // Closed activity marker only; stage classification must not need prose.
          // Visible model response is effective progress, not a liveness heartbeat.
          payload: withActivityEvidence(
            { activityKind: "model-response" },
            RUNTIME_ACTIVITY_EFFECTIVE,
          ),
        });
      }
    }
    return events;
  }

  private parseToolResults(root: JsonObject): NormalizedWorkerEvent[] {
    const message = asObject(root.message);
    const content = Array.isArray(message?.content) ? message.content : [];
    const events: NormalizedWorkerEvent[] = [];

    for (const blockValue of content) {
      const block = asObject(blockValue);
      if (!block || block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
      if (this.completedTools.has(block.tool_use_id)) continue;
      this.completedTools.add(block.tool_use_id);
      const tool = this.tools.get(block.tool_use_id) ?? "Tool";
      const failed = block.is_error === true;
      events.push({
        type: "worker.tool.completed",
        summary: `${tool} ${failed ? "failed" : "completed"}`,
        payload: withActivityEvidence(
          {
            toolUseId: block.tool_use_id,
            tool,
            failed,
            output: truncate(block.content, 500),
          },
          RUNTIME_ACTIVITY_EFFECTIVE,
        ),
      });
    }
    return events;
  }

  /**
   * Emit a closed model-processing marker for Claude system thinking_tokens.
   * Rate-limited: the first marker emits immediately; subsequent markers inside
   * the throttle interval are dropped before Store writes. Token estimates and
   * raw payload fields are never stored. This is Runtime liveness only — it
   * must never reset the no-effective-progress watchdog.
   */
  private parseProcessing(_root: JsonObject): NormalizedWorkerEvent[] {
    const now = this.clock();
    if (
      this.lastProcessingEmittedAt >= 0
      && now - this.lastProcessingEmittedAt < this.processingThrottleMs
    ) {
      return [];
    }
    this.lastProcessingEmittedAt = now;
    return [
      {
        type: "worker.message",
        summary: "Model is actively processing",
        payload: withActivityEvidence(
          { activityKind: "model-processing" },
          RUNTIME_ACTIVITY_LIVENESS,
        ),
      },
    ];
  }
}
