import type {
  AttemptTokenUsage,
  ModelTokenUsage,
  NormalizedWorkerEvent,
  WorkerClaim,
} from "../core/types.js";

type JsonObject = Record<string, unknown>;

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
      return [
        {
          type: "worker.message",
          summary: `Claude Code initialized${typeof root.model === "string" ? ` with ${root.model}` : ""}`,
          payload: {
            model: root.model,
            tools: root.tools,
          },
          ...(sessionId === undefined ? {} : { sessionId }),
        },
      ];
    }

    if (type === "assistant") return this.parseAssistant(root);
    if (type === "user") return this.parseToolResults(root);

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
      const summary = terminalError
        ? (budgetExceeded
            ? (typeof costUsd === "number"
                ? `Worker stopped: max budget exceeded (runtime estimate $${costUsd.toFixed(6)})`
                : "Worker stopped: max budget exceeded")
            : stopReason === "error" && !isError
              ? "Worker terminated with error stop reason"
              : subtype !== undefined && !isError
                ? "Worker reported an error terminal subtype"
                : "Worker reported failure")
        : "Worker reported completion";
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
            ...(budgetExceeded ? { failureCategory: "budget" } : {}),
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
          payload: { toolUseId: id, tool: block.name, target },
        });
      } else if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        events.push({
          type: "worker.message",
          summary: truncate(block.text.trim(), 500),
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
        payload: {
          toolUseId: block.tool_use_id,
          tool,
          failed,
          output: truncate(block.content, 500),
        },
      });
    }
    return events;
  }
}
