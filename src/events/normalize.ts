import type { NormalizedWorkerEvent } from "../core/types.js";

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

function toolTarget(name: string, input: JsonObject): string {
  const target =
    input.file_path ?? input.path ?? input.command ?? input.pattern ?? input.query ?? input.description;
  return target === undefined ? "" : truncate(target, 240);
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
      const resultText = typeof root.result === "string" ? root.result : undefined;
      const costUsd = typeof root.total_cost_usd === "number" ? root.total_cost_usd : undefined;
      const turns = typeof root.num_turns === "number" ? root.num_turns : undefined;
      return [
        {
          type: isError ? "worker.failed" : "worker.completed",
          summary: isError ? "Worker reported failure" : "Worker reported completion",
          payload: {
            subtype: root.subtype,
            ...(resultText === undefined ? {} : { result: truncate(resultText, 2_000) }),
            ...(costUsd === undefined ? {} : { costUsd }),
            ...(turns === undefined ? {} : { turns }),
          },
          terminal: {
            isError,
            ...(resultText === undefined ? {} : { resultText }),
            ...(costUsd === undefined ? {} : { costUsd }),
            ...(turns === undefined ? {} : { turns }),
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
        const target = toolTarget(block.name, input);
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
