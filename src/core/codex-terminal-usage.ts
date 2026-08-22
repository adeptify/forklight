// Codex CLI terminal usage → DirectCodexPairedSample adapter.
// Pure, privacy-safe, no JSONL parsing, no Provider/Store access.
// Converts one nested turn.completed event into the disjoint
// four-counter DirectCodexPairedSample so cached+cache_write input
// and reasoning output details never double-count against totals.

import {
  normalizeDirectCodexPairedSample,
  type DirectCodexPairedSample,
} from "./direct-codex-calibration.js";
import { deepFreeze } from "./immutability.js";


const TOP_KEYS: ReadonlySet<string> = new Set(["type", "usage"]);
const USAGE_KEY_SET: ReadonlySet<string> = new Set([
  "input_tokens",
  "cached_input_tokens",
  "cache_write_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
]);
const SAMPLE_META_KEY_SET: ReadonlySet<string> = new Set([
  "sampleId",
  "forklightTaskId",
  "exactTaskClass",
  "directCodexProfileId",
  "directRunRef",
  "pairingRef",
  "capturedAt",
]);

const FIXED = "Invalid Codex terminal usage event";
const FIXED_META = "Invalid Codex paired sample metadata";

const isNNInt = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

function readCounter(usage: Record<string, unknown>, field: string): number {
  if (!isNNInt(usage[field])) throw new TypeError(FIXED);
  return usage[field];
}


export interface CodexTerminalUsageTotals {
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly uncachedInputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
}


/** Validate one nested Codex `turn.completed` event and return
 *  disjoint canonical totals.  Top-level keys must be exactly
 *  `type` and `usage`; `usage` must be a non-array object containing
 *  exactly the five counter keys.  Every counter must be a
 *  non-negative safe integer; cached + cache_write input must not
 *  exceed total input; reasoning output must not exceed total output.
 *  Reasoning and cache counters are validated as subsets and never
 *  appear again — total output is preserved once and uncached input
 *  is total input minus both cache components.  Returns a detached
 *  deeply-frozen CodexTerminalUsageTotals on success; throws a fixed
 *  non-echoing TypeError on any structural, numeric, subset, or
 *  content-bearing failure.  No raw JSONL, terminal text, prompt,
 *  response, log, path, model, thread, or session field is accepted. */
export function normalizeCodexTerminalUsage(
  event: unknown,
): CodexTerminalUsageTotals {
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    throw new TypeError(FIXED);
  }
  const top = event as Record<string, unknown>;
  const topKeys = Object.keys(top);
  if (topKeys.length !== TOP_KEYS.size || topKeys.some(k => !TOP_KEYS.has(k))) {
    throw new TypeError(FIXED);
  }
  if (top.type !== "turn.completed") throw new TypeError(FIXED);
  if (top.usage === null || typeof top.usage !== "object" || Array.isArray(top.usage)) {
    throw new TypeError(FIXED);
  }
  const u = top.usage as Record<string, unknown>;
  const uKeys = Object.keys(u);
  if (uKeys.length !== USAGE_KEY_SET.size || uKeys.some(k => !USAGE_KEY_SET.has(k))) {
    throw new TypeError(FIXED);
  }

  const input = readCounter(u, "input_tokens");
  const cached = readCounter(u, "cached_input_tokens");
  const cacheWrite = readCounter(u, "cache_write_input_tokens");
  const output = readCounter(u, "output_tokens");
  const reasoning = readCounter(u, "reasoning_output_tokens");
  if (cached + cacheWrite > input) throw new TypeError(FIXED);
  if (reasoning > output) throw new TypeError(FIXED);
  if (!Number.isSafeInteger(input + output)) throw new TypeError(FIXED);
  const uncached = input - cached - cacheWrite;

  const totals: CodexTerminalUsageTotals = {
    totalInputTokens: input,
    totalOutputTokens: output,
    uncachedInputTokens: uncached,
    cacheReadInputTokens: cached,
    cacheCreationInputTokens: cacheWrite,
  };
  deepFreeze(totals);
  return totals;
}


/** Build one DirectCodexPairedSample from canonical Codex terminal
 *  usage plus caller-supplied explicit metadata.  Metadata must
 *  contain exactly the seven identity fields (sampleId,
 *  forklightTaskId, exactTaskClass, directCodexProfileId,
 *  directRunRef, pairingRef, capturedAt) and nothing else; no value
 *  is trimmed, defaulted, or inferred.  The four disjoint sample
 *  counters are mutually exclusive: only `uncachedInputTokens` maps
 *  to `sample.inputTokens`; `totalOutputTokens` is preserved once to
 *  `sample.outputTokens`; reasoning is validated as a subset only and
 *  intentionally never reaches any sample field.  Final identity,
 *  profile, ref, and timestamp validation is delegated to
 *  normalizeDirectCodexPairedSample.  Returns a detached deeply-frozen
 *  DirectCodexPairedSample; throws a fixed non-echoing TypeError on
 *  malformed input and never produces a partial object. */
export function buildDirectCodexPairedSample(
  usage: unknown,
  metadata: unknown,
): DirectCodexPairedSample {
  const totals = normalizeCodexTerminalUsage(usage);
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError(FIXED_META);
  }
  const m = metadata as Record<string, unknown>;
  const mKeys = Object.keys(m);
  if (mKeys.length !== SAMPLE_META_KEY_SET.size || mKeys.some(k => !SAMPLE_META_KEY_SET.has(k))) {
    throw new TypeError(FIXED_META);
  }
  const draft = {
    sampleId: m.sampleId,
    forklightTaskId: m.forklightTaskId,
    exactTaskClass: m.exactTaskClass,
    directCodexProfileId: m.directCodexProfileId,
    inputTokens: totals.uncachedInputTokens,
    outputTokens: totals.totalOutputTokens,
    cacheReadInputTokens: totals.cacheReadInputTokens,
    cacheCreationInputTokens: totals.cacheCreationInputTokens,
    source: "codex-terminal-result",
    complete: true,
    directRunRef: m.directRunRef,
    pairingRef: m.pairingRef,
    capturedAt: m.capturedAt,
    schemaVersion: 1,
  };
  return normalizeDirectCodexPairedSample(draft);
}
