import { createHash } from "node:crypto";
import {
  RUNTIME_ACTIVITY_EFFECTIVE,
  RUNTIME_ACTIVITY_LIVENESS,
  withActivityEvidence,
} from "../core/runtime-activity.js";
import type { AttemptTokenUsage, NormalizedWorkerEvent } from "../core/types.js";

const MAX_SUMMARY = 240;
/** Raw app-server item ids accepted only when non-empty and length-bounded. */
const MAX_RAW_ITEM_ID = 128;
/** Public correlation token length (hex chars of a one-way digest). */
const TOOL_CORRELATION_TOKEN_HEX = 16;

type CodexAppServerItemProgressEvent = {
  type: "worker.tool.started" | "worker.tool.completed";
  summary: string;
  payload: Record<string, unknown>;
};

type CodexAppServerWorkspaceChangeEvent = {
  type: "worker.message";
  summary: string;
  payload: Record<string, unknown>;
};

/**
 * One-way bounded correlation token for tool start/complete pairing.
 * Requires a non-empty length-bounded raw id; never returns the raw id.
 */
export function privacySafeToolCorrelationToken(rawId: unknown): string | undefined {
  if (typeof rawId !== "string" || rawId.length < 1 || rawId.length > MAX_RAW_ITEM_ID) {
    return undefined;
  }
  return createHash("sha256").update(rawId).digest("hex").slice(0, TOOL_CORRELATION_TOKEN_HEX);
}

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
  // Cached and cache-write input are disjoint subsets of total input. A usage
  // record where they exceed total input is malformed: it would double-count
  // Tokens, so it fails closed instead of being accepted as exact evidence.
  if (cacheReadInputTokens + cacheCreationInputTokens > inputTokens) return undefined;
  return {
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    source: "terminal-result",
    complete: true,
  };
}

/** Strict reader for the installed Codex app-server `params.tokenUsage.total`
 *  shape, which uses canonical camelCase counter names. The cumulative total is
 *  projected into ForkLight exact disjoint counters without double-counting;
 *  malformed or arithmetically inconsistent evidence fails closed (undefined),
 *  never estimated. */
export function codexAppServerTokenUsage(raw: unknown): AttemptTokenUsage | undefined {
  const usage = object(raw);
  if (usage === undefined) return undefined;
  const inputTokens = nonNegativeInteger(usage.inputTokens);
  const outputTokens = nonNegativeInteger(usage.outputTokens);
  if (inputTokens === undefined || outputTokens === undefined) return undefined;
  const cacheReadInputTokens = nonNegativeInteger(usage.cachedInputTokens) ?? 0;
  const cacheCreationInputTokens = nonNegativeInteger(usage.cacheWriteInputTokens) ?? 0;
  // Cached and cache-write input are disjoint subsets of total input.
  if (cacheReadInputTokens + cacheCreationInputTokens > inputTokens) return undefined;
  // Reasoning output is a subset of total output when the counter is present.
  const reasoningOutputTokens = nonNegativeInteger(usage.reasoningOutputTokens);
  if (reasoningOutputTokens !== undefined && reasoningOutputTokens > outputTokens) {
    return undefined;
  }
  return {
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    source: "terminal-result",
    complete: true,
  };
}

/** Public terminal resultText bound for one native-Goal final answer. */
export const CODEX_APP_SERVER_RESULT_TEXT_MAX = 32_000;

/**
 * Privacy-safe projection of exact-current-Turn `item/started` and
 * `item/completed` for commandExecution and fileChange. Emits only closed
 * tool enums and an optional one-way correlation token — never raw item ids,
 * command, cwd, output, path, or content fields from the raw item.
 */
export function projectCodexAppServerItemProgress(
  method: "item/started" | "item/completed",
  item: unknown,
): CodexAppServerItemProgressEvent | undefined {
  const obj = object(item);
  if (obj === undefined) return undefined;
  const itemType = obj.type;
  if (itemType !== "commandExecution" && itemType !== "fileChange") {
    return undefined;
  }
  const started = method === "item/started";
  const label = itemType === "commandExecution" ? "command" : "file change";
  // Require a valid non-empty id for pairing; publish only the one-way token.
  const toolUseId = privacySafeToolCorrelationToken(obj.id);
  return {
    type: started ? "worker.tool.started" : "worker.tool.completed",
    summary: `${label} ${started ? "started" : "completed"}`,
    payload: withActivityEvidence(
      {
        tool: itemType,
        ...(toolUseId === undefined ? {} : { toolUseId }),
      },
      RUNTIME_ACTIVITY_EFFECTIVE,
    ),
  };
}

/**
 * Private material digest for `turn/diff/updated`. Compares whether the
 * app-server presented new workspace-change evidence without ever exposing
 * paths, patches, or content on public surfaces. Returns undefined for empty
 * or unusable evidence so callers stay inert.
 *
 * Hashes the complete serialized body (plus length) so tail-only changes
 * remain material even for large diffs.
 */
export function privateCodexDiffDigest(diff: unknown): string | undefined {
  if (diff === undefined || diff === null) return undefined;
  let serialized: string;
  if (typeof diff === "string") {
    serialized = diff;
  } else if (typeof diff === "object") {
    try {
      serialized = JSON.stringify(diff);
    } catch {
      return undefined;
    }
  } else {
    return undefined;
  }
  if (serialized.length < 1) return undefined;
  return createHash("sha256")
    .update(`${serialized.length}\n`)
    .update(serialized)
    .digest("hex");
}

/**
 * One bounded public milestone for workspace-change evidence on a Turn.
 * Carries only closed activity metadata — never paths, diffs, or content.
 */
export function projectCodexAppServerWorkspaceChangeMilestone(): CodexAppServerWorkspaceChangeEvent {
  return {
    type: "worker.message",
    summary: "Codex native Goal updated workspace files",
    payload: withActivityEvidence(
      { activityKind: "workspace-change" },
      RUNTIME_ACTIVITY_EFFECTIVE,
    ),
  };
}

/**
 * Strict projection of one Codex app-server item into optional final-answer
 * text. Canonical items use camelCase `agentMessage` with an explicit phase:
 * - `final_answer` may yield bounded non-empty terminal text
 * - `commentary` is never final and disables later legacy `phase: null`
 * - explicit `null` is legacy-only when no prior non-null phase was observed
 * - missing, unknown, snake_case, or empty evidence never becomes resultText
 */
export function projectCodexAppServerFinalItem(
  item: unknown,
  allowLegacyNullPhase: boolean,
): {
  finalText?: string;
  explicitNonNullPhase: boolean;
} {
  const obj = object(item);
  if (obj === undefined || obj.type !== "agentMessage") {
    // snake_case agent_message and non-message items are never final.
    return { explicitNonNullPhase: false };
  }
  if (!Object.prototype.hasOwnProperty.call(obj, "phase")) {
    // Missing phase fails closed for final-output acceptance.
    return { explicitNonNullPhase: false };
  }
  const phase = obj.phase;
  if (phase === "commentary") {
    return { explicitNonNullPhase: true };
  }
  if (phase === "final_answer") {
    const text = typeof obj.text === "string" ? obj.text : undefined;
    if (text === undefined || text.trim().length < 1) {
      return { explicitNonNullPhase: true };
    }
    return {
      finalText: text.slice(0, CODEX_APP_SERVER_RESULT_TEXT_MAX),
      explicitNonNullPhase: true,
    };
  }
  if (phase === null) {
    if (!allowLegacyNullPhase) {
      return { explicitNonNullPhase: false };
    }
    const text = typeof obj.text === "string" ? obj.text : undefined;
    if (text === undefined || text.trim().length < 1) {
      return { explicitNonNullPhase: false };
    }
    return {
      finalText: text.slice(0, CODEX_APP_SERVER_RESULT_TEXT_MAX),
      explicitNonNullPhase: false,
    };
  }
  // Unknown non-null phase: never final, and it disables later legacy null.
  if (phase !== undefined && phase !== null) {
    return { explicitNonNullPhase: true };
  }
  return { explicitNonNullPhase: false };
}

/**
 * Content-safe summary for the measured Codex provider account usage-limit
 * family. Public surfaces must not depend on raw provider prose or URLs.
 */
export const CODEX_ACCOUNT_USAGE_LIMIT_SUMMARY = "Codex account usage limit reached";

/** Stable reason code for Codex provider/account quota exhaustion (not Task maxBudget). */
export const CODEX_ACCOUNT_USAGE_LIMIT_REASON = "codex-account-usage-limit";

/**
 * Narrow match for the measured OpenAI/Codex account usage-limit message family.
 * Requires the multi-word provider phrase; bare tokens such as "usage", "limit",
 * or "credits" alone never classify as account quota.
 */
export function isCodexAccountUsageLimitMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  // Measured family: "You've hit your usage limit..." / "You have hit your usage limit..."
  // Also accept "reached your usage limit" as the same provider family.
  return normalized.includes("hit your usage limit")
    || normalized.includes("reached your usage limit");
}

function extractCodexFailureMessage(root: Record<string, unknown>): string {
  const error = object(root.error);
  if (typeof root.message === "string" && root.message.length > 0) return root.message;
  if (typeof error?.message === "string" && error.message.length > 0) return error.message;
  return "Codex Worker reported failure";
}

function classifyCodexFailure(message: string): {
  summary: string;
  failureCategory: "budget" | "runtime";
  reasonCode?: string;
  failureReason: string;
} {
  if (isCodexAccountUsageLimitMessage(message)) {
    return {
      summary: CODEX_ACCOUNT_USAGE_LIMIT_SUMMARY,
      failureCategory: "budget",
      reasonCode: CODEX_ACCOUNT_USAGE_LIMIT_REASON,
      failureReason: CODEX_ACCOUNT_USAGE_LIMIT_SUMMARY,
    };
  }
  return {
    summary: message.slice(0, MAX_SUMMARY),
    failureCategory: "runtime",
    failureReason: message.slice(0, 2_000),
  };
}

function terminalConflictEvent(): NormalizedWorkerEvent {
  return {
    type: "worker.failed",
    summary: "Codex emitted conflicting terminal evidence",
    payload: { failureCategory: "runtime", reasonCode: "codex-terminal-conflict" },
    terminal: { isError: true, failureReason: "Codex emitted conflicting terminal evidence" },
  };
}

/** Strict stateful projection of `codex exec --json` JSONL. Unknown valid
 * events remain bounded progress; malformed or conflicting terminal evidence
 * becomes a terminal failure rather than guessed success. */
export class CodexEventNormalizer {
  private terminalSeen = false;
  /**
   * Fingerprint of the first failure terminal's full extracted message.
   * Only an identical later failure (`error` / `turn.failed`) is idempotent;
   * success is never deduplicated and different failure reasons conflict.
   */
  private failureTerminalFingerprint: string | undefined;

  parseLine(line: string): NormalizedWorkerEvent[] {
    const trimmed = line.trim();
    if (!trimmed) return [];
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      this.terminalSeen = true;
      this.failureTerminalFingerprint = undefined;
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
      this.failureTerminalFingerprint = undefined;
      return [{
        type: "worker.failed",
        summary: "Codex emitted an invalid event envelope",
        payload: { failureCategory: "runtime", reasonCode: "codex-event-invalid" },
        terminal: { isError: true, failureReason: "Codex emitted an invalid event envelope" },
      }];
    }
    const type = root.type;
    if (this.terminalSeen) {
      // Codex often emits one `error` and one same-message `turn.failed` for a
      // single rejection. That pair is duplicate terminal evidence, not conflict.
      if (type === "turn.failed" || type === "error") {
        const message = extractCodexFailureMessage(root);
        if (
          this.failureTerminalFingerprint !== undefined
          && this.failureTerminalFingerprint === message
        ) {
          return [];
        }
      }
      return [terminalConflictEvent()];
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
        // Session setup is Runtime liveness only — cannot postpone the watchdog.
        payload: withActivityEvidence(
          { activityKind: "session-started" },
          RUNTIME_ACTIVITY_LIVENESS,
        ),
      }];
    }
    if (type === "turn.started") {
      return [{
        type: "worker.message",
        summary: "Codex is processing the Task",
        // Turn start without item/tool/text is liveness, not effective progress.
        payload: withActivityEvidence(
          { activityKind: "model-processing" },
          RUNTIME_ACTIVITY_LIVENESS,
        ),
      }];
    }
    if (type === "item.started" || type === "item.completed") {
      const item = object(root.item);
      if (item === undefined || typeof item.type !== "string") {
        return [{
          type: "worker.message",
          summary: "Codex reported Task progress",
          payload: withActivityEvidence({}, RUNTIME_ACTIVITY_EFFECTIVE),
        }];
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
          payload: withActivityEvidence(
            { tool: item.type },
            RUNTIME_ACTIVITY_EFFECTIVE,
          ),
        }];
      }
      const text = resultTextFromItem(item);
      if (text !== undefined) {
        return [{
          type: "worker.message",
          summary: text.slice(0, MAX_SUMMARY),
          payload: withActivityEvidence(
            { activityKind: "model-response" },
            RUNTIME_ACTIVITY_EFFECTIVE,
          ),
        }];
      }
      return [{
        type: "worker.message",
        summary: `Codex ${item.type.replaceAll("_", " ")} ${type === "item.started" ? "started" : "completed"}`
          .slice(0, MAX_SUMMARY),
        payload: withActivityEvidence(
          { activityKind: "model-response" },
          RUNTIME_ACTIVITY_EFFECTIVE,
        ),
      }];
    }
    if (type === "turn.completed") {
      this.terminalSeen = true;
      // Success is never an idempotent fingerprint; a later terminal always
      // conflicts (including another success or any failure).
      this.failureTerminalFingerprint = undefined;
      // A terminal completion that carries a usage object which cannot be
      // projected into exact disjoint counters is malformed terminal evidence
      // and fails closed. An absent usage stays unavailable on a successful
      // completion — it is never estimated.
      if (root.usage !== undefined && codexUsage(root.usage) === undefined) {
        return [{
          type: "worker.failed",
          summary: "Codex reported completion with malformed usage",
          payload: { failureCategory: "runtime", reasonCode: "codex-usage-malformed" },
          terminal: { isError: true, failureReason: "Codex reported completion with malformed usage" },
        }];
      }
      const usage = codexUsage(root.usage);
      return [{
        type: "worker.completed",
        summary: "Codex Worker reported completion",
        terminal: { isError: false, ...(usage === undefined ? {} : { usage }) },
      }];
    }
    if (type === "turn.failed" || type === "error") {
      const message = extractCodexFailureMessage(root);
      this.terminalSeen = true;
      this.failureTerminalFingerprint = message;
      const classified = classifyCodexFailure(message);
      return [{
        type: "worker.failed",
        summary: classified.summary,
        payload: {
          failureCategory: classified.failureCategory,
          ...(classified.reasonCode === undefined ? {} : { reasonCode: classified.reasonCode }),
        },
        terminal: { isError: true, failureReason: classified.failureReason },
      }];
    }
    // Unknown structured stream records: Runtime liveness only so noisy
    // keepalive cannot defeat the effective-progress watchdog.
    return [{
      type: "worker.message",
      summary: `Codex ${type.replaceAll("_", " ")}`.slice(0, MAX_SUMMARY),
      payload: withActivityEvidence(
        { streamType: type },
        RUNTIME_ACTIVITY_LIVENESS,
      ),
    }];
  }
}
