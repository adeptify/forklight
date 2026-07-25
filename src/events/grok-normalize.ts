/**
 * Best-effort normalizer for Grok Build headless streaming-json lines.
 * Heartbeat policy (MVP): any non-terminal stream object resets progress.
 */

import type { NormalizedWorkerEvent } from "../core/types.js";

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export class GrokEventNormalizer {
  parseLine(line: string): NormalizedWorkerEvent[] {
    const trimmed = line.trim();
    if (!trimmed) return [];
    let root: unknown;
    try {
      root = JSON.parse(trimmed);
    } catch {
      return [{
        type: "worker.message",
        summary: trimmed.slice(0, 240),
      }];
    }
    const obj = asObject(root);
    if (obj === undefined) {
      return [{ type: "worker.message", summary: trimmed.slice(0, 240) }];
    }

    const type = typeof obj.type === "string" ? obj.type : "";
    const lower = type.toLowerCase();

    // Live CLI streaming-json: thought / text deltas + end (OAuth dogfood 2026-07-25).
    if (lower === "thought" || lower === "thinking") {
      const data = typeof obj.data === "string" ? obj.data : "";
      return [{
        type: "worker.message",
        summary: data ? `thinking: ${data.slice(0, 200)}` : "thinking",
        payload: { streamType: type },
      }];
    }
    if (lower === "text") {
      const data = typeof obj.data === "string" ? obj.data : "";
      return [{
        type: "worker.message",
        summary: data.slice(0, 240) || "text",
        payload: { streamType: type },
      }];
    }

    // Terminal / result-like
    if (
      lower === "result"
      || lower === "end"
      || lower === "complete"
      || lower === "error"
      || obj.is_error === true
      || obj.error !== undefined
    ) {
      const stopReason = typeof obj.stopReason === "string" ? obj.stopReason : "";
      const isError = lower === "error"
        || obj.is_error === true
        || (typeof obj.ok === "boolean" && obj.ok === false)
        || stopReason === "Cancelled"
        || stopReason.toLowerCase() === "error";
      const resultText = typeof obj.result === "string"
        ? obj.result
        : typeof obj.message === "string"
          ? obj.message
          : typeof obj.text === "string"
            ? obj.text
            : typeof obj.data === "string"
              ? obj.data
              : stopReason || undefined;
      const costUsd = typeof obj.cost_usd === "number"
        ? obj.cost_usd
        : typeof obj.costUsd === "number"
          ? obj.costUsd
          : typeof obj.total_cost_usd === "number"
            ? obj.total_cost_usd
            : undefined;
      const turns = typeof obj.num_turns === "number" ? obj.num_turns : undefined;
      return [{
        type: isError ? "worker.failed" : "worker.completed",
        summary: isError
          ? (resultText?.slice(0, 240) ?? "Grok Worker reported failure")
          : (resultText?.slice(0, 240) ?? "Grok Worker reported completion"),
        terminal: {
          isError,
          ...(resultText === undefined ? {} : { resultText }),
          ...(costUsd === undefined ? {} : { costUsd, runtimeCostEstimateUsd: costUsd }),
          ...(turns === undefined ? {} : { turns }),
        },
        ...(isError ? { payload: { failureCategory: "runtime" as const } } : {}),
      }];
    }

    // Tool-ish events when present
    if (lower.includes("tool") && (lower.includes("start") || lower.includes("begin"))) {
      const name = typeof obj.tool === "string"
        ? obj.tool
        : typeof obj.name === "string"
          ? obj.name
          : "tool";
      return [{
        type: "worker.tool.started",
        summary: `Tool started: ${name}`,
        payload: { tool: name },
      }];
    }
    if (lower.includes("tool") && (lower.includes("end") || lower.includes("complete") || lower.includes("result"))) {
      const name = typeof obj.tool === "string"
        ? obj.tool
        : typeof obj.name === "string"
          ? obj.name
          : "tool";
      return [{
        type: "worker.tool.completed",
        summary: `Tool completed: ${name}`,
        payload: { tool: name },
      }];
    }

    const summary = typeof obj.summary === "string"
      ? obj.summary
      : typeof obj.message === "string"
        ? obj.message
        : type || "Grok stream event";
    return [{
      type: "worker.message",
      summary: String(summary).slice(0, 240),
      payload: { streamType: type || "unknown" },
    }];
  }
}
