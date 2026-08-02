/**
 * Best-effort normalizer for Grok Build headless streaming-json lines.
 *
 * Genuine thought/text stream deltas are effective model progress. Launch,
 * session, and keepalive-only records are Runtime liveness only. Classification
 * is closed and content-free — never derived from summary prose.
 *
 * Text deltas are accumulated by the Grok adapter (bounded). Normal EndTurn
 * alone is not treated as useful result content — only explicit result fields
 * or the assembled text deltas become terminal resultText.
 */

import {
  RUNTIME_ACTIVITY_EFFECTIVE,
  RUNTIME_ACTIVITY_LIVENESS,
  withActivityEvidence,
} from "../core/runtime-activity.js";
import type { NormalizedWorkerEvent } from "../core/types.js";

/** Hard bound for ordered Grok text-delta assembly (bytes of UTF-16 code units). */
export const GROK_ASSEMBLED_TEXT_MAX = 32_000;

/** High-frequency thought telemetry is observation only. Persist at most one
 * processing marker per interval so runtime activity cannot flood Task history. */
export const GROK_PROCESSING_THROTTLE_MS = 15_000;

/** Stop reasons that are transport/control signals, never useful result bodies. */
const NON_CONTENT_STOP_REASONS = new Set([
  "endturn",
  "end_turn",
  "stop",
  "max_tokens",
  "maxtokens",
]);

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** Ordered, bounded accumulation of Grok streaming text deltas. */
export interface GrokTextAssembly {
  text: string;
  overflow: boolean;
}

export function createGrokTextAssembly(): GrokTextAssembly {
  return { text: "", overflow: false };
}

/**
 * Append one text delta. Overflow fails closed: clears assembled text so a
 * truncated suffix cannot look like a complete result.
 */
export function appendGrokTextDelta(
  state: GrokTextAssembly,
  delta: string,
): GrokTextAssembly {
  if (state.overflow) return state;
  if (typeof delta !== "string" || delta.length === 0) return state;
  if (state.text.length + delta.length > GROK_ASSEMBLED_TEXT_MAX) {
    return { text: "", overflow: true };
  }
  return { text: state.text + delta, overflow: false };
}

/** Extract a text delta from a raw streaming-json line, if present. */
export function extractGrokTextDeltaFromLine(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  let root: unknown;
  try {
    root = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  const obj = asObject(root);
  if (obj === undefined) return undefined;
  const type = typeof obj.type === "string" ? obj.type.toLowerCase() : "";
  if (type !== "text") return undefined;
  return typeof obj.data === "string" ? obj.data : undefined;
}

/**
 * True when explicit terminal result content is meaningful (not EndTurn noise).
 * Empty strings and known stop-reason tokens are not useful result bodies.
 */
export function isMeaningfulGrokResultText(resultText: string | undefined): boolean {
  if (resultText === undefined) return false;
  const trimmed = resultText.trim();
  if (trimmed.length === 0) return false;
  if (NON_CONTENT_STOP_REASONS.has(trimmed.toLowerCase())) return false;
  return true;
}

/**
 * Select authoritative terminal resultText:
 * 1. Explicit meaningful terminal content always wins.
 * 2. On normal completion with no explicit content, use complete bounded assembly.
 * 3. Overflow without explicit content fails closed (undefined → unusable review).
 * 4. Errors keep explicit diagnostics only; never invent content from deltas.
 */
export function resolveGrokTerminalResultText(input: {
  explicitResultText: string | undefined;
  assembly: GrokTextAssembly;
  isError: boolean;
}): string | undefined {
  if (isMeaningfulGrokResultText(input.explicitResultText)) {
    return input.explicitResultText;
  }
  if (input.isError) {
    // Preserve non-meaningful but diagnostic stop reasons (e.g. Cancelled).
    if (input.explicitResultText !== undefined && input.explicitResultText.trim().length > 0) {
      return input.explicitResultText;
    }
    return undefined;
  }
  if (input.assembly.overflow) return undefined;
  if (input.assembly.text.length > 0) return input.assembly.text;
  return undefined;
}

/** Read explicit content fields only; never treat stopReason as success content. */
function explicitTerminalContent(obj: Record<string, unknown>): string | undefined {
  if (typeof obj.result === "string") return obj.result;
  if (typeof obj.message === "string") return obj.message;
  if (typeof obj.text === "string") return obj.text;
  if (typeof obj.data === "string") return obj.data;
  return undefined;
}

export class GrokEventNormalizer {
  private readonly clock: () => number;
  private readonly processingThrottleMs: number;
  private lastProcessingEmittedAt = -1;

  constructor(input?: { clock?: () => number; processingThrottleMs?: number }) {
    this.clock = input?.clock ?? (() => Date.now());
    this.processingThrottleMs = input?.processingThrottleMs ?? GROK_PROCESSING_THROTTLE_MS;
  }

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
    // activityKind drives live-stage; activityEvidence separates Runtime liveness
    // from effective progress. Summaries are never used for classification.
    if (lower === "thought" || lower === "thinking") {
      const now = this.clock();
      if (
        this.lastProcessingEmittedAt >= 0
        && now - this.lastProcessingEmittedAt < this.processingThrottleMs
      ) return [];
      this.lastProcessingEmittedAt = now;
      return [{
        type: "worker.message",
        summary: "Model is actively processing",
        // Grok thought/thinking is genuine stream content: effective progress
        // for the watchdog, while live-stage still shows model-processing.
        payload: withActivityEvidence(
          { streamType: type, activityKind: "model-processing" },
          RUNTIME_ACTIVITY_EFFECTIVE,
        ),
      }];
    }
    if (lower === "text") {
      const data = typeof obj.data === "string" ? obj.data : "";
      return [{
        type: "worker.message",
        summary: data.slice(0, 240) || "text",
        // Full delta is not stored in events; adapter accumulates from raw lines.
        // Grok text is visible model response and effective progress.
        payload: withActivityEvidence(
          { streamType: type, activityKind: "model-response" },
          RUNTIME_ACTIVITY_EFFECTIVE,
        ),
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
      // Explicit content fields only. Normal EndTurn is not useful result text;
      // error/cancel may fall back to stopReason for diagnostics.
      const explicit = explicitTerminalContent(obj);
      const resultText = explicit !== undefined
        ? explicit
        : (isError && stopReason ? stopReason : undefined);
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
        payload: withActivityEvidence({ tool: name }, RUNTIME_ACTIVITY_EFFECTIVE),
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
        payload: withActivityEvidence({ tool: name }, RUNTIME_ACTIVITY_EFFECTIVE),
      }];
    }

    const summary = typeof obj.summary === "string"
      ? obj.summary
      : typeof obj.message === "string"
        ? obj.message
        : type || "Grok stream event";
    // Launch / session / keepalive-style records: Runtime liveness only.
    return [{
      type: "worker.message",
      summary: String(summary).slice(0, 240),
      payload: withActivityEvidence(
        { streamType: type || "unknown" },
        RUNTIME_ACTIVITY_LIVENESS,
      ),
    }];
  }
}
