import type { AttemptTokenUsage, NormalizedWorkerEvent } from "../core/types.js";

const MAX_SUMMARY = 240;

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function resultTextFromItem(item: Record<string, unknown>): string | undefined {
  if (item.type !== "agent_message") return undefined;
  return typeof item.text === "string" && item.text.trim().length > 0
    ? item.text
    : undefined;
}

export function codexAgentMessageFromLine(line: string): string | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return undefined;
  }
  const root = object(raw);
  if (root?.type !== "item.completed") return undefined;
  const item = object(root.item);
  return item === undefined ? undefined : resultTextFromItem(item);
}

export function codexUsage(raw: unknown): AttemptTokenUsage | undefined {
  const usage = object(raw);
  if (usage === undefined) return undefined;
  const inputTokens = nonNegativeInteger(usage.input_tokens);
  const outputTokens = nonNegativeInteger(usage.output_tokens);
  if (inputTokens === undefined || outputTokens === undefined) return undefined;
  const cacheReadInputTokens = nonNegativeInteger(usage.cached_input_tokens) ?? 0;
  const cacheCreationInputTokens = nonNegativeInteger(usage.cache_write_input_tokens) ?? 0;
  return {
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    source: "terminal-result",
    complete: true,
  };
}

/** Strict stateful projection of `codex exec --json` JSONL. Unknown valid
 * events remain bounded progress; malformed or conflicting terminal evidence
 * becomes a terminal failure rather than guessed success. */
export class CodexEventNormalizer {
  private terminalSeen = false;

  parseLine(line: string): NormalizedWorkerEvent[] {
    const trimmed = line.trim();
    if (!trimmed) return [];
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      this.terminalSeen = true;
      return [{
        type: "worker.failed",
        summary: "Codex emitted malformed JSONL",
        payload: { failureCategory: "runtime", reasonCode: "codex-jsonl-malformed" },
        terminal: { isError: true, failureReason: "Codex emitted malformed JSONL" },
      }];
    }
    const root = object(raw);
    if (root === undefined || typeof root.type !== "string") {
      this.terminalSeen = true;
      return [{
        type: "worker.failed",
        summary: "Codex emitted an invalid event envelope",
        payload: { failureCategory: "runtime", reasonCode: "codex-event-invalid" },
        terminal: { isError: true, failureReason: "Codex emitted an invalid event envelope" },
      }];
    }
    const type = root.type;
    if (this.terminalSeen) {
      return [{
        type: "worker.failed",
        summary: "Codex emitted conflicting terminal evidence",
        payload: { failureCategory: "runtime", reasonCode: "codex-terminal-conflict" },
        terminal: { isError: true, failureReason: "Codex emitted conflicting terminal evidence" },
      }];
    }
    if (type === "thread.started") {
      if (typeof root.thread_id !== "string" || root.thread_id.length < 1) {
        return [{
          type: "worker.failed",
          summary: "Codex omitted its session identity",
          payload: { failureCategory: "runtime", reasonCode: "codex-session-missing" },
          terminal: { isError: true, failureReason: "Codex omitted its session identity" },
        }];
      }
      return [{
        type: "worker.message",
        summary: "Codex session started",
        sessionId: root.thread_id,
        payload: { activityKind: "session-started" },
      }];
    }
    if (type === "turn.started") {
      return [{
        type: "worker.message",
        summary: "Codex is processing the Task",
        payload: { activityKind: "model-processing" },
      }];
    }
    if (type === "item.started" || type === "item.completed") {
      const item = object(root.item);
      if (item === undefined || typeof item.type !== "string") {
        return [{ type: "worker.message", summary: "Codex reported Task progress" }];
      }
      const toolLike = item.type === "command_execution"
        || item.type === "file_change"
        || item.type === "mcp_tool_call";
      if (toolLike) {
        const label = item.type === "command_execution"
          ? "command"
          : item.type === "file_change" ? "file change" : "tool";
        return [{
          type: type === "item.started" ? "worker.tool.started" : "worker.tool.completed",
          summary: `${label} ${type === "item.started" ? "started" : "completed"}`,
          payload: { tool: item.type },
        }];
      }
      const text = resultTextFromItem(item);
      if (text !== undefined) {
        return [{
          type: "worker.message",
          summary: text.slice(0, MAX_SUMMARY),
          payload: { activityKind: "model-response" },
        }];
      }
      return [{
        type: "worker.message",
        summary: `Codex ${item.type.replaceAll("_", " ")} ${type === "item.started" ? "started" : "completed"}`
          .slice(0, MAX_SUMMARY),
      }];
    }
    if (type === "turn.completed") {
      this.terminalSeen = true;
      const usage = codexUsage(root.usage);
      return [{
        type: "worker.completed",
        summary: "Codex Worker reported completion",
        terminal: { isError: false, ...(usage === undefined ? {} : { usage }) },
      }];
    }
    if (type === "turn.failed" || type === "error") {
      this.terminalSeen = true;
      const error = object(root.error);
      const message = typeof root.message === "string"
        ? root.message
        : typeof error?.message === "string" ? error.message : "Codex Worker reported failure";
      return [{
        type: "worker.failed",
        summary: message.slice(0, MAX_SUMMARY),
        payload: { failureCategory: "runtime" },
        terminal: { isError: true, failureReason: message.slice(0, 2_000) },
      }];
    }
    return [{
      type: "worker.message",
      summary: `Codex ${type.replaceAll("_", " ")}`.slice(0, MAX_SUMMARY),
      payload: { streamType: type },
    }];
  }
}
