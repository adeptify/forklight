// Codex terminal usage → DirectCodexPairedSample adapter tests.
// Disjoint counter arithmetic and fixed non-echoing failures.  The
// real format-probe arithmetic test is format evidence only — it
// must not be registered as a representative baseline sample.

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDirectCodexPairedSample,
  normalizeCodexTerminalUsage,
} from "../src/core/codex-terminal-usage.js";
import { grossDirectCodexTokens } from "../src/core/direct-codex-calibration.js";

const TS = "2026-07-23T12:00:00.000Z";

const SAMPLE_KEYS = [
  "cacheCreationInputTokens", "cacheReadInputTokens", "capturedAt", "complete",
  "directCodexProfileId", "directRunRef", "exactTaskClass", "forklightTaskId",
  "inputTokens", "outputTokens", "pairingRef", "sampleId", "schemaVersion", "source",
];
const RAW_FIELDS = [
  "text", "content", "prompt", "raw", "secret", "credential", "log",
  "response", "request", "body", "payload", "model", "thread_id",
  "reasoning_output_tokens", "reasoningOutputTokens", "reasoningTokens",
  "input", "output", "instructions",
];
const USAGE_FIELDS = [
  "input_tokens", "cached_input_tokens", "cache_write_input_tokens",
  "output_tokens", "reasoning_output_tokens",
] as const;

function event(
  usageOverrides: Record<string, unknown> = {},
  topOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const usage: Record<string, unknown> = {
    input_tokens: 31647, cached_input_tokens: 19968, cache_write_input_tokens: 0,
    output_tokens: 113, reasoning_output_tokens: 41,
  };
  for (const [k, v] of Object.entries(usageOverrides)) usage[k] = v;
  const top: Record<string, unknown> = { type: "turn.completed", usage };
  for (const [k, v] of Object.entries(topOverrides)) top[k] = v;
  return top;
}

function meta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    sampleId: "s1", forklightTaskId: "task-a1b2c3", exactTaskClass: "edit-task",
    directCodexProfileId: "profileA",
    directRunRef: "codex-run:a1b2c3d4e5f6", pairingRef: "pair:xyz-789-012",
    capturedAt: TS,
  };
  for (const [k, v] of Object.entries(overrides)) base[k] = v;
  return base;
}

// --- canonical normalizer ---

test("real format probe: input 31647 / cached 19968 / write 0 / output 113 / reasoning 41 → gross 31760", () => {
  const t = normalizeCodexTerminalUsage(event());
  assert.equal(t.totalInputTokens, 31647);
  assert.equal(t.uncachedInputTokens, 11679);
  assert.equal(t.cacheReadInputTokens, 19968);
  assert.equal(t.cacheCreationInputTokens, 0);
  assert.equal(t.totalOutputTokens, 113);
  assert.equal(t.totalInputTokens + t.totalOutputTokens, 31760);
  assert.equal(t.uncachedInputTokens + t.cacheReadInputTokens + t.cacheCreationInputTokens, t.totalInputTokens);
});

test("nested shape: top-level exactly {type, usage}; usage exactly five counters", () => {
  const ev = event();
  for (const k of Object.keys(ev)) {
    const { [k]: _, ...rest } = ev;
    assert.throws(() => normalizeCodexTerminalUsage(rest), TypeError, `top-missing ${k}`);
  }
  for (const k of Object.keys(ev.usage as Record<string, unknown>)) {
    const { [k]: _, ...rest } = ev.usage as Record<string, unknown>;
    assert.throws(() => normalizeCodexTerminalUsage(event({}, { usage: rest })), TypeError, `usage-missing ${k}`);
  }
  for (const extra of ["model", "thread_id", "session_id", "messages", "diff"]) {
    assert.throws(() => normalizeCodexTerminalUsage({ ...ev, [extra]: "x" }), TypeError, `top-extra ${extra}`);
  }
  for (const extra of ["prompt", "response", "text", "raw", "secret", "log", "model"]) {
    assert.throws(() => normalizeCodexTerminalUsage(event({ [extra]: "x" })), TypeError, `usage-extra ${extra}`);
  }
});

test("rejects flattened (alias) shape and any non-{type,usage} top-level keys", () => {
  // Official flattened example is rejected — real Codex events are nested.
  assert.throws(() => normalizeCodexTerminalUsage({ type: "turn.completed", input_tokens: 1000 }), TypeError);
  assert.throws(() => normalizeCodexTerminalUsage({ type: "turn.completed", inputTokens: 1000 }), TypeError);
  assert.throws(() => normalizeCodexTerminalUsage({ input_tokens: 1000 }), TypeError);
  assert.throws(() => normalizeCodexTerminalUsage({ type: "turn.completed", usage: { inputTokens: 1000 } }), TypeError);
});

test("type marker must be the literal turn.completed; usage must be non-array object", () => {
  for (const t of ["Turn.Completed", "turn.completed ", " turn.completed",
    "turn.completd", "message", "", null, undefined, 42, true, []]) {
    assert.throws(() => normalizeCodexTerminalUsage(event({}, { type: t })), TypeError, `type ${String(t)}`);
  }
  for (const u of [null, undefined, 42, "string", true, [], 0]) {
    assert.throws(() => normalizeCodexTerminalUsage({ type: "turn.completed", usage: u }), TypeError, `usage ${String(u)}`);
  }
});

test("rejects non-object event shapes", () => {
  for (const v of [null, undefined, 42, "string", true, false, [], ["turn.completed"]]) {
    assert.throws(() => normalizeCodexTerminalUsage(v), TypeError, `value ${String(v)}`);
  }
});

test("rejects non-integer, negative, NaN, Infinity, and unsafe-integer counters", () => {
  const bad: ReadonlyArray<readonly [unknown, string]> = [
    [1.5, "frac"], [-1, "neg"], ["-5", "str-neg"], ["1000", "str-pos"],
    [null, "null"], [undefined, "undef"], [NaN, "NaN"], [Infinity, "Inf"],
    [-Infinity, "-Inf"], [Number.MAX_SAFE_INTEGER + 1, "unsafe+"],
  ];
  for (const f of USAGE_FIELDS) {
    for (const [v, label] of bad) {
      assert.throws(() => normalizeCodexTerminalUsage(event({ [f]: v })), TypeError, `${f}=${label}`);
    }
  }
});

test("subset overflow: cached + cache_write > input rejected; equal accepted", () => {
  assert.throws(() => normalizeCodexTerminalUsage(event({
    input_tokens: 100, cached_input_tokens: 60, cache_write_input_tokens: 50,
  })), TypeError);
  const t = normalizeCodexTerminalUsage(event({
    input_tokens: 100, cached_input_tokens: 60, cache_write_input_tokens: 40,
  }));
  assert.equal(t.uncachedInputTokens, 0);
  assert.equal(t.cacheReadInputTokens, 60);
  assert.equal(t.cacheCreationInputTokens, 40);
});

test("subset overflow: reasoning > output rejected; equal accepted", () => {
  assert.throws(() => normalizeCodexTerminalUsage(event({
    output_tokens: 50, reasoning_output_tokens: 51,
  })), TypeError);
  const t = normalizeCodexTerminalUsage(event({
    output_tokens: 50, reasoning_output_tokens: 50,
  }));
  assert.equal(t.totalOutputTokens, 50);
});

test("combined input + output must remain a safe gross total", () => {
  assert.throws(() => normalizeCodexTerminalUsage(event({
    input_tokens: Number.MAX_SAFE_INTEGER, cached_input_tokens: 0,
    cache_write_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0,
  })), TypeError);
  const t = normalizeCodexTerminalUsage(event({
    input_tokens: Number.MAX_SAFE_INTEGER - 1, cached_input_tokens: 0,
    cache_write_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0,
  }));
  assert.equal(t.totalInputTokens + t.totalOutputTokens, Number.MAX_SAFE_INTEGER);
});

test("zero values across all counters are valid; canonical is all zero", () => {
  const t = normalizeCodexTerminalUsage(event({
    input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0,
    output_tokens: 0, reasoning_output_tokens: 0,
  }));
  assert.equal(t.totalInputTokens, 0);
  assert.equal(t.totalOutputTokens, 0);
  assert.equal(t.uncachedInputTokens, 0);
  assert.equal(t.cacheReadInputTokens, 0);
  assert.equal(t.cacheCreationInputTokens, 0);
});

test("non-zero cached and cache-write coexist disjointly; reasoning is a subset only", () => {
  const t = normalizeCodexTerminalUsage(event({
    input_tokens: 1000, cached_input_tokens: 300, cache_write_input_tokens: 200,
    output_tokens: 250, reasoning_output_tokens: 41,
  }));
  assert.equal(t.uncachedInputTokens, 500);
  assert.equal(t.cacheReadInputTokens, 300);
  assert.equal(t.cacheCreationInputTokens, 200);
  assert.equal(t.totalOutputTokens, 250);
  assert.equal((t as any).reasoningOutputTokens, undefined);
});

test("input fully covered by cache: uncached becomes zero, cache components retained", () => {
  const t = normalizeCodexTerminalUsage(event({
    input_tokens: 500, cached_input_tokens: 300, cache_write_input_tokens: 200,
  }));
  assert.equal(t.totalInputTokens, 500);
  assert.equal(t.uncachedInputTokens, 0);
  assert.equal(t.cacheReadInputTokens, 300);
  assert.equal(t.cacheCreationInputTokens, 200);
  assert.equal(t.totalOutputTokens, 113);
});

test("output without reasoning detail: total output preserved once, not decremented", () => {
  const t = normalizeCodexTerminalUsage(event({
    input_tokens: 1000, cached_input_tokens: 0, cache_write_input_tokens: 0,
    output_tokens: 250, reasoning_output_tokens: 0,
  }));
  assert.equal(t.totalOutputTokens, 250);
});

test("canonical arithmetic invariant: total + output equals disjoint input sum + output", () => {
  for (const e of [event(), event({ input_tokens: 0, cached_input_tokens: 0,
    cache_write_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 }),
    event({ input_tokens: 1000, cached_input_tokens: 300, cache_write_input_tokens: 200,
      output_tokens: 250, reasoning_output_tokens: 41 })]) {
    const t = normalizeCodexTerminalUsage(e);
    assert.equal(t.totalInputTokens + t.totalOutputTokens,
      t.uncachedInputTokens + t.cacheReadInputTokens + t.cacheCreationInputTokens + t.totalOutputTokens);
  }
});

test("canonical output is detached deeply frozen; caller event unfrozen", () => {
  const ev = event();
  const t = normalizeCodexTerminalUsage(ev);
  assert.ok(Object.isFrozen(t));
  assert.equal(Object.isFrozen(ev), false);
  assert.throws(() => { (t as any).totalInputTokens = 999; }, TypeError);
  assert.throws(() => { (t as any).uncachedInputTokens = 0; }, TypeError);
  assert.throws(() => { (t as any).totalOutputTokens = 0; }, TypeError);
});

test("error messages never echo untrusted values or canonical field names", () => {
  const s1 = "leaked-credential-abc-123";
  const s2 = "leaked-prompt-xy-987";
  const cases: (() => unknown)[] = [
    () => normalizeCodexTerminalUsage({ type: s1 }),
    () => normalizeCodexTerminalUsage(event({ input_tokens: Number.MAX_SAFE_INTEGER + 1 })),
    () => normalizeCodexTerminalUsage(event({ output_tokens: 100, reasoning_output_tokens: 200 })),
    () => normalizeCodexTerminalUsage({ ...event(), [s1]: "x", model: s1 }),
    () => normalizeCodexTerminalUsage(event({ input_tokens: 100, cached_input_tokens: 60, cache_write_input_tokens: 60 })),
    () => normalizeCodexTerminalUsage(event({ input_tokens: -5 })),
    () => normalizeCodexTerminalUsage(null),
    () => normalizeCodexTerminalUsage({ [s1]: 1 }),
  ];
  for (const fn of cases) {
    try { fn(); assert.fail("Expected throw"); }
    catch (e: any) {
      assert.ok(e instanceof TypeError);
      assert.ok(!e.message.includes(s1));
      assert.ok(!e.message.includes(s2));
    }
  }
});

// --- adapter builder ---

test("real format probe → grossDirectCodexTokens returns 31760 (no detail double-count)", () => {
  const s = buildDirectCodexPairedSample(event(), meta());
  assert.equal(grossDirectCodexTokens(s), 31760);
  assert.equal(s.inputTokens + s.outputTokens + s.cacheReadInputTokens + s.cacheCreationInputTokens, 31760);
});

test("adapter maps canonical totals to four disjoint sample counters", () => {
  const s = buildDirectCodexPairedSample(event(), meta());
  assert.equal(s.inputTokens, 11679);          // uncached only
  assert.equal(s.cacheReadInputTokens, 19968);  // cached
  assert.equal(s.cacheCreationInputTokens, 0);  // cache_write
  assert.equal(s.outputTokens, 113);           // total output preserved once
  assert.equal((s as any).totalInputTokens, undefined);
  assert.equal((s as any).totalOutputTokens, undefined);
  assert.equal((s as any).reasoningOutputTokens, undefined);
  assert.equal(s.source, "codex-terminal-result");
  assert.equal(s.complete, true);
  assert.equal(s.schemaVersion, 1);
});

test("adapter preserves every explicit metadata field unchanged; never trimmed or inferred", () => {
  const s = buildDirectCodexPairedSample(event(), meta({
    sampleId: "sa1", forklightTaskId: "taskXY12",
    exactTaskClass: "review-task", directCodexProfileId: "profileZ9",
    directRunRef: "codex-run:runXY12abcd", pairingRef: "pair:pairXY12ab",
    capturedAt: "2026-06-15T08:30:00.000Z",
  }));
  assert.equal(s.sampleId, "sa1");
  assert.equal(s.forklightTaskId, "taskXY12");
  assert.equal(s.exactTaskClass, "review-task");
  assert.equal(s.directCodexProfileId, "profileZ9");
  assert.equal(s.directRunRef, "codex-run:runXY12abcd");
  assert.equal(s.pairingRef, "pair:pairXY12ab");
  assert.equal(s.capturedAt, "2026-06-15T08:30:00.000Z");
});

test("adapter rejects non-object usage and partial usage before metadata", () => {
  for (const v of [null, undefined, 42, true, []]) {
    assert.throws(() => buildDirectCodexPairedSample(v, meta()), TypeError, `usage ${String(v)}`);
  }
  assert.throws(() => buildDirectCodexPairedSample(event({ input_tokens: NaN }), meta()), TypeError);
  assert.throws(() => buildDirectCodexPairedSample(event({ cached_input_tokens: -1 }), meta()), TypeError);
});

test("adapter rejects non-object metadata; rejects unknown/missing/extra metadata keys", () => {
  for (const v of [null, undefined, 42, true, []]) {
    assert.throws(() => buildDirectCodexPairedSample(event(), v), TypeError, `meta ${String(v)}`);
  }
  for (const k of ["sampleId", "forklightTaskId", "exactTaskClass", "directCodexProfileId",
    "directRunRef", "pairingRef", "capturedAt"]) {
    const { [k]: _, ...rest } = meta();
    assert.throws(() => buildDirectCodexPairedSample(event(), rest), TypeError, `missing ${k}`);
  }
  for (const extra of ["prompt", "response", "text", "log", "model", "path",
    "source", "complete", "inputTokens", "extraKey"]) {
    assert.throws(() => buildDirectCodexPairedSample(event(), { ...meta(), [extra]: "x" }), TypeError, `extra ${extra}`);
  }
});

test("adapter delegates identity validation to the paired-sample normalizer", () => {
  const bad: ReadonlyArray<readonly [string, unknown, string]> = [
    ["exactTaskClass", " edit-task", "leading-ws"],
    ["exactTaskClass", "edit-task ", "trailing-ws"],
    ["directCodexProfileId", " x", "profile-lpad"],
    ["directCodexProfileId", "x ", "profile-rpad"],
    ["directRunRef", "run:generic", "swap-prefix"],
    ["pairingRef", "codex-run:swapped", "swap-prefix"],
    ["sampleId", "-bad", "dash-start"],
    ["sampleId", " s1", "space-start"],
    ["capturedAt", "2026-07-23T12:00:00Z", "no-millis"],
    ["capturedAt", "bad", "non-iso"],
  ];
  for (const [k, v, label] of bad) {
    assert.throws(() => buildDirectCodexPairedSample(event(), meta({ [k]: v })), TypeError, `${k}=${label}`);
  }
});

test("adapter sample is detached deeply frozen exact 14-key shape; meta and event unfrozen", () => {
  const ev = event();
  const m = meta();
  const s = buildDirectCodexPairedSample(ev, m);
  assert.ok(Object.isFrozen(s));
  assert.throws(() => { (s as any).inputTokens = 999; }, TypeError);
  assert.throws(() => { (s as any).cacheReadInputTokens = 0; }, TypeError);
  assert.throws(() => { (s as any).cacheCreationInputTokens = 0; }, TypeError);
  assert.throws(() => { (s as any).outputTokens = 0; }, TypeError);
  assert.deepEqual(Object.keys(s).sort(), SAMPLE_KEYS);
  for (const f of RAW_FIELDS) assert.equal(f in s, false, `unexpected ${f}`);
  assert.equal(Object.isFrozen(ev), false);
  assert.equal(Object.isFrozen(m), false);
});

test("adapter error path produces no partial object; non-echoing failures", () => {
  const s = "leaked-secret-abc-xyz";
  const cases: (() => unknown)[] = [
    () => buildDirectCodexPairedSample(event({ input_tokens: 100, cached_input_tokens: 60, cache_write_input_tokens: 60 }), meta()),
    () => buildDirectCodexPairedSample(event({ output_tokens: 1, reasoning_output_tokens: 2 }), meta()),
    () => buildDirectCodexPairedSample({ type: s, usage: { input_tokens: 1, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } }, meta()),
    () => buildDirectCodexPairedSample({ ...event(), [s]: "x" }, meta()),
    () => buildDirectCodexPairedSample(event(), { ...meta(), sampleId: s + "!" }),
    () => buildDirectCodexPairedSample(event(), { ...meta(), prompt: s }),
    () => buildDirectCodexPairedSample(event(), null),
    () => buildDirectCodexPairedSample(null, meta()),
  ];
  for (const fn of cases) {
    try { fn(); assert.fail("Expected throw"); }
    catch (e: any) {
      assert.ok(e instanceof TypeError);
      assert.ok(!e.message.includes(s), `leak: ${e.message}`);
    }
  }
});
