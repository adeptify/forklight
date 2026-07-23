// Token efficiency acceptance tests — lock evidence semantics, arithmetic,
// range ordering, signed savings, privacy, and immutability.
// Module contract: No live Provider, daemon, database, or tokenizer.
// Test production behaviour rather than reimplementing the calculator.

import assert from "node:assert/strict";
import test from "node:test";
import type { AttemptTokenUsage } from "../src/core/types.js";
import {
  buildTokenEfficiencyReport,
  createRedactedExchangeMeasurement,
  normalizeOrchestrationExchangeReceipt,
} from "../src/core/token-efficiency.js";
import type {
  DirectCodexCalibration,
  DirectCodexUnavailableReason,
  OrchestrationExchangeReceipt,
  RedactedExchangeMeasurement,
} from "../src/core/token-efficiency.js";

const TS = "2026-07-23T12:00:00.000Z";

// --- Helpers ---------------------------------------------------------------

function usage(input: number, output: number, cr: number, cc: number): AttemptTokenUsage {
  return { inputTokens: input, outputTokens: output, cacheReadInputTokens: cr,
    cacheCreationInputTokens: cc, source: "terminal-result", complete: true,
    serviceTier: "standard" };
}

/** Make an object that will fail isCompleteUsage (complete: false). */
function badUsage(input: number, output: number, cr: number, cc: number): AttemptTokenUsage {
  return { inputTokens: input, outputTokens: output, cacheReadInputTokens: cr,
    cacheCreationInputTokens: cc, source: "terminal-result", complete: false,
    serviceTier: "standard" } as unknown as AttemptTokenUsage;
}

function eng(text: string, dir: "request" | "response" = "request"): RedactedExchangeMeasurement {
  return createRedactedExchangeMeasurement(text, dir, "tool-call", "task-1", TS);
}

function cjk(text: string): RedactedExchangeMeasurement {
  return createRedactedExchangeMeasurement(text, "response", "tool-result", "task-1", TS);
}

const CAL: DirectCodexCalibration = {
  minTokens: 800, maxTokens: 1200, method: "direct-codex-benchmark",
  taskClass: "edit-task", confidence: "medium" };

function assertDeepFrozen(v: unknown, path = "root"): void {
  if (v === null || typeof v !== "object") return;
  assert.ok(Object.isFrozen(v), `Expected ${path} frozen`);
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) assertDeepFrozen(v[i], `${path}[${i}]`); }
  else { for (const k of Object.keys(v as Record<string, unknown>))
    assertDeepFrozen((v as Record<string, unknown>)[k], `${path}.${k}`); }
}

// --- createRedactedExchangeMeasurement — privacy & correctness --------------

test("redacted measurement counts + validates + private + frozen", () => {
  let m = eng("Hello, World!");
  assert.equal(m.utf8Bytes, 13); assert.equal(m.asciiCount, 13); assert.equal(m.nonAsciiCount, 0);
  m = cjk("你好世界");
  assert.equal(m.asciiCount, 0); assert.equal(m.nonAsciiCount, 4); assert.equal(m.utf8Bytes, 12);
  m = createRedactedExchangeMeasurement("Hi 世界", "request", "read", "t2", TS);
  assert.equal(m.asciiCount, 3); assert.equal(m.nonAsciiCount, 2);
  // Emoji multi-byte: 😀 is 1 code point, 4 UTF-8 bytes
  m = createRedactedExchangeMeasurement("😀", "request", "emoji-op", "t-emoji", TS);
  assert.equal(m.nonAsciiCount, 1); assert.equal(m.utf8Bytes, 4);
  // Empty
  m = eng("");
  assert.equal(m.utf8Bytes, 0); assert.equal(m.asciiCount, 0); assert.equal(m.nonAsciiCount, 0);
  // Validation
  assert.throws(() => eng("x", "unknown" as any), TypeError);
  assert.throws(() => createRedactedExchangeMeasurement("x", "request", "  ", "t", TS), TypeError);
  assert.throws(() => createRedactedExchangeMeasurement("x", "request", "op", "t", "bad"), TypeError);
  // Privacy — no raw text retained
  m = eng("secret prompt content");
  for (const f of ["text", "content", "prompt", "body", "payload", "raw"]) assert.equal(f in m, false);
  // Immutability
  m = eng("test");
  assertDeepFrozen(m);
  assert.throws(() => { (m as any).utf8Bytes = 999; }, TypeError);
});

// --- buildTokenEfficiencyReport — complete usage without baseline -----------

test("complete usage without baseline → range exchange, low confidence", () => {
  const r = buildTokenEfficiencyReport({
    usages: [usage(1000, 500, 200, 50)],
    exchangeMeasurements: [eng("Hello World")],
  });
  assert.equal(r.workerVolume.kind, "complete");
  assert.equal((r.workerVolume as any).grossWorkerTokens, 1750);
  assert.equal(r.exchangeEstimate.kind, "range");
  // "Hello World" = 11 code points, 11 UTF-8 bytes → min=ceil(11/6)=2, max=11
  const ee = r.exchangeEstimate as any;
  assert.equal(ee.range.min, 2); assert.equal(ee.range.max, 11);
  assert.equal(ee.range.method, "broad-utf8-byte-envelope-v1");
  assert.equal(ee.range.confidence, "low");
  assert.equal(r.boundaryReduction.available, true);
  assert.equal(r.directCodexSavings.available, false);
  assert.equal((r.directCodexSavings as any).reason, "direct-baseline-missing");
});

// --- buildTokenEfficiencyReport — partial Worker telemetry -----------------

test("partial/missing usage → incomplete, boundary unavailable", () => {
  let r = buildTokenEfficiencyReport({
    usages: [usage(100, 50, 0, 0), badUsage(200, 100, 0, 0)],
    exchangeMeasurements: [eng("test")],
  });
  assert.equal(r.workerVolume.kind, "incomplete");
  const wv = r.workerVolume as any;
  assert.equal(wv.completeSampleCount, 1); assert.equal(wv.missingSampleCount, 1);
  assert.equal(wv.grossWorkerTokens, 150);
  assert.equal(r.boundaryReduction.available, false);
  assert.equal((r.boundaryReduction as any).reason, "incomplete-worker-usage");
  // Empty array → incomplete, not complete zero
  r = buildTokenEfficiencyReport({ usages: [], exchangeMeasurements: [eng("x")] });
  assert.equal(r.workerVolume.kind, "incomplete");
  assert.equal((r.workerVolume as any).sampleCount, 0);
});

// --- buildTokenEfficiencyReport — calibration with task class ---------------

test("compatible calibration → proper interval arithmetic", () => {
  // 10 chars ASCII → 10 code points, 10 UTF-8 bytes → min=2, max=10
  const r = buildTokenEfficiencyReport({
    usages: [usage(5000, 2000, 1000, 0)],
    exchangeMeasurements: [eng("0123456789")],
    calibration: CAL, currentTaskClass: "edit-task",
  });
  assert.equal(r.directCodexSavings.available, true);
  const dcs = r.directCodexSavings as any;
  assert.equal(dcs.absoluteSavings.min, 790);  // 800-10
  assert.equal(dcs.absoluteSavings.max, 1198); // 1200-2
  assert.equal(dcs.absoluteSavings.confidence, "low");
  // Percentage discriminated union
  assert.equal(dcs.percentageSavings.available, true);
  assert.ok(Math.abs(dcs.percentageSavings.range.min - 98.75) < 0.001);
  assert.ok(Math.abs(dcs.percentageSavings.range.max - (100 * (1 - 2 / 1200))) < 0.001);
});

test("exact exchange + calibration → high confidence propagated", () => {
  const r = buildTokenEfficiencyReport({
    usages: [usage(1000, 500, 0, 0)],
    exactExchangeTokens: { tokens: 500, source: "codex-api" },
    calibration: CAL, currentTaskClass: "edit-task",
  });
  assert.equal(r.exchangeEstimate.kind, "exact");
  assert.equal((r.boundaryReduction as any).tokens.confidence, "high");
  assert.equal((r.boundaryReduction as any).tokens.min, 1000);
  const dcs = r.directCodexSavings as any;
  assert.equal(dcs.available, true);
  assert.equal(dcs.absoluteSavings.min, 300);
  assert.equal(dcs.absoluteSavings.max, 700);
  assert.equal(dcs.absoluteSavings.confidence, "medium");
  assert.ok(Math.abs(dcs.percentageSavings.range.min - 37.5) < 0.001);
  assert.ok(Math.abs(dcs.percentageSavings.range.max - (100 * (1 - 500 / 1200))) < 0.001);
});

// --- calibration: task-class-required / mismatch --------------------------

test("calibration without currentTaskClass → task-class-required", () => {
  const r = buildTokenEfficiencyReport({
    usages: [usage(100, 50, 0, 0)],
    exchangeMeasurements: [eng("test")],
    calibration: CAL,
    // currentTaskClass omitted
  });
  assert.equal(r.directCodexSavings.available, false);
  assert.equal((r.directCodexSavings as any).reason, "task-class-required");
});

test("calibration with mismatched taskClass → task-class-mismatch", () => {
  const r = buildTokenEfficiencyReport({
    usages: [usage(100, 50, 0, 0)],
    exchangeMeasurements: [eng("test")],
    calibration: CAL,
    currentTaskClass: "multi-file-refactor",
  });
  assert.equal(r.directCodexSavings.available, false);
  assert.equal((r.directCodexSavings as any).reason, "task-class-mismatch");
});

// --- negative savings preserved --------------------------------------------

test("negative savings preserved (not clamped), zero baseline percentage unavailable", () => {
  // Exchange 2000 exact > baseline 800-1200
  let r = buildTokenEfficiencyReport({
    usages: [usage(100, 50, 0, 0)],
    exactExchangeTokens: { tokens: 2000, source: "api" },
    calibration: CAL, currentTaskClass: "edit-task",
  });
  let dcs = r.directCodexSavings as any;
  assert.equal(dcs.available, true);
  assert.equal(dcs.absoluteSavings.min, -1200); assert.equal(dcs.absoluteSavings.max, -800);
  assert.ok(dcs.absoluteSavings.min < 0 && dcs.absoluteSavings.max < 0);
  assert.equal(dcs.percentageSavings.available, true);
  assert.ok(dcs.percentageSavings.range.min < 0 && dcs.percentageSavings.range.max < 0);

  // Mixed sign: baseline 800-1500, exchange 1000
  r = buildTokenEfficiencyReport({
    usages: [usage(1, 0, 0, 0)],
    exactExchangeTokens: { tokens: 1000, source: "api" },
    calibration: { ...CAL, minTokens: 800, maxTokens: 1500 },
    currentTaskClass: "edit-task",
  });
  dcs = r.directCodexSavings as any;
  assert.equal(dcs.absoluteSavings.min, -200); assert.equal(dcs.absoluteSavings.max, 500);
  assert.ok(dcs.percentageSavings.range.min < 0 && dcs.percentageSavings.range.max > 0);

  // Zero baseline → percentage unavailable, absolute available
  r = buildTokenEfficiencyReport({
    usages: [usage(1, 0, 0, 0)],
    exactExchangeTokens: { tokens: 100, source: "api" },
    calibration: { ...CAL, minTokens: 0, maxTokens: 0, confidence: "low" },
    currentTaskClass: "edit-task",
  });
  dcs = r.directCodexSavings as any;
  assert.equal(dcs.available, true);
  assert.equal(dcs.absoluteSavings.min, -100); assert.equal(dcs.absoluteSavings.max, -100);
  assert.equal(dcs.percentageSavings.available, false);
  assert.equal(dcs.percentageSavings.reason, "zero-baseline");
});

// --- unavailable exchange evidence -----------------------------------------

test("no measurements → unavailable; invalid exact → invalid-exact-evidence; bad measurement → invalid-measurement", () => {
  // No measurements
  let r = buildTokenEfficiencyReport({ usages: [usage(100, 50, 0, 0)] });
  assert.equal(r.exchangeEstimate.kind, "unavailable");
  assert.equal((r.exchangeEstimate as any).reason, "no-measurements");
  assert.equal(r.boundaryReduction.available, false);
  assert.equal((r.boundaryReduction as any).reason, "missing-exchange-evidence");
  // Direct savings also unavailable due to missing exchange
  assert.equal(r.directCodexSavings.available, false);
  assert.equal((r.directCodexSavings as any).reason, "direct-baseline-missing");

  // Invalid exact tokens → invalid-exact-evidence (does NOT fall through)
  r = buildTokenEfficiencyReport({
    usages: [usage(100, 0, 0, 0)],
    exactExchangeTokens: { tokens: -1, source: "" },
    exchangeMeasurements: [eng("valid data")],
  });
  assert.equal(r.exchangeEstimate.kind, "unavailable");
  assert.equal((r.exchangeEstimate as any).reason, "invalid-exact-evidence");

  // Any invalid measurement contaminates the whole set
  const badM = { direction: "request", operation: "op", taskId: "t", timestamp: TS,
    utf8Bytes: 5, asciiCount: 10, nonAsciiCount: 0 }; // bytes < ascii → invalid
  r = buildTokenEfficiencyReport({
    usages: [usage(1, 0, 0, 0)],
    exchangeMeasurements: [eng("good"), badM as any],
  });
  assert.equal(r.exchangeEstimate.kind, "unavailable");
  assert.equal((r.exchangeEstimate as any).reason, "invalid-measurement");
  assert.equal(r.boundaryReduction.available, false);
  assert.equal((r.boundaryReduction as any).reason, "missing-exchange-evidence");
});

// --- immutability ----------------------------------------------------------

test("report and children deeply frozen; caller inputs unfrozen", () => {
  const r = buildTokenEfficiencyReport({
    usages: [usage(100, 50, 0, 0)],
    exchangeMeasurements: [eng("test")],
    calibration: CAL, currentTaskClass: "edit-task",
  });
  assertDeepFrozen(r);
  assert.throws(() => { (r as any).workerVolume = {}; }, TypeError);
  // Caller inputs remain mutable
  const usages = [usage(100, 50, 0, 0)], meas = [eng("test")], cal = { ...CAL };
  assert.equal(Object.isFrozen(usages), false);
  assert.equal(Object.isFrozen(meas), false);
  assert.equal(Object.isFrozen(cal), false);
  buildTokenEfficiencyReport({ usages, exchangeMeasurements: meas, calibration: cal,
    currentTaskClass: "edit-task" });
  assert.equal(Object.isFrozen(usages), false);
  assert.equal(Object.isFrozen(meas), false);
  assert.equal(Object.isFrozen(cal), false);
});

// --- Semantic + multilingual + per-model + emoji ---------------------------

test("no cost fields; method labels distinct; perModel not double-counted; multilingual+emoji privacy", () => {
  // No cost/price/currency
  let r = buildTokenEfficiencyReport({ usages: [usage(100, 50, 0, 0)] });
  for (const w of ["cost", "price", "currency", "USD", "CNY"])
    assert.ok(!JSON.stringify(r).includes(w));
  // Boundary vs direct method labels are distinct
  r = buildTokenEfficiencyReport({ usages: [usage(1000, 500, 0, 0)],
    exactExchangeTokens: { tokens: 200, source: "api" }, calibration: CAL,
    currentTaskClass: "edit-task" });
  assert.ok((r.boundaryReduction as any).tokens.method.includes("worker-volume-minus"));
  assert.ok(!(r.boundaryReduction as any).tokens.method.includes("calibration"));
  assert.ok((r.directCodexSavings as any).absoluteSavings.method.includes("calibration"));
  // Per-model not added
  const u: AttemptTokenUsage = { ...usage(100, 50, 20, 10),
    perModel: [{ model: "m1", inputTokens: 100, outputTokens: 50,
      cacheReadInputTokens: 20, cacheCreationInputTokens: 10 }] };
  r = buildTokenEfficiencyReport({ usages: [u], exchangeMeasurements: [eng("x")] });
  assert.equal((r.workerVolume as any).grossWorkerTokens, 180);
  // Multilingual CJK+JSON retains only counts
  const text = '{"key":"値","arr":["項目1","項目2"]}';
  const m = createRedactedExchangeMeasurement(text, "response", "tool-result", "t", TS);
  assert.equal(m.utf8Bytes, new TextEncoder().encode(text).length);
  for (const f of ["text", "content", "body", "key", "値", "項目"]) assert.equal(f in m, false);
  // Emoji upper bound uses UTF-8 bytes
  const memoji = createRedactedExchangeMeasurement("😀😀", "request", "emoji", "t-emoji", TS);
  // 2 code points, 8 UTF-8 bytes → min=ceil(2/6)=1, max=8
  r = buildTokenEfficiencyReport({ usages: [usage(1, 0, 0, 0)], exchangeMeasurements: [memoji] });
  const ee = r.exchangeEstimate as any;
  assert.equal(ee.kind, "range"); assert.equal(ee.range.min, 1); assert.equal(ee.range.max, 8);
  assert.equal(ee.range.method, "broad-utf8-byte-envelope-v1");
  assert.equal(ee.range.confidence, "low");
});

// --- Malformed / invalid inputs --------------------------------------------

test("malformed usage fields → treated as missing, not error", () => {
  const tests: [string, AttemptTokenUsage[]][] = [
    ["non-integer", [{ ...usage(1.5, 2, 3, 4) } as any]],
    ["negative", [{ ...usage(-1, 2, 3, 4) } as any]],
    ["wrong source", [{ ...usage(1, 2, 3, 4), source: "manual" } as any]],
    ["unsafe integer", [{ ...usage(1, 2, 3, 4), inputTokens: Number.MAX_SAFE_INTEGER + 1 } as any]],
  ];
  for (const [label, usages] of tests) {
    const r = buildTokenEfficiencyReport({ usages });
    assert.equal(r.workerVolume.kind, "incomplete", label);
    assert.equal((r.workerVolume as any).completeSampleCount, 0, label);
  }
});

test("incompatible calibration → typed unavailable reasons", () => {
  const tests: [DirectCodexUnavailableReason, any, string | undefined][] = [
    ["incompatible-baseline", { minTokens: -1, maxTokens: 100, method: "m", taskClass: "t", confidence: "low" }, "edit-task"],
    ["incompatible-baseline", { minTokens: 200, maxTokens: 100, method: "m", taskClass: "t", confidence: "low" }, "edit-task"],
    ["incompatible-baseline", { minTokens: 0, maxTokens: 100, method: "", taskClass: "t", confidence: "low" }, "edit-task"],
    ["incompatible-baseline", { minTokens: 0, maxTokens: 100, method: "m", taskClass: "t", confidence: "extreme" }, "edit-task"],
    ["incompatible-baseline", { notCalibration: true }, "edit-task"],
    ["direct-baseline-missing", null, undefined],
    ["direct-baseline-missing", undefined, undefined],
    ["task-class-required", { ...CAL }, undefined],
    ["task-class-mismatch", { ...CAL, taskClass: "other" }, "edit-task"],
  ];
  for (const [reason, cal, tcl] of tests) {
    const r = buildTokenEfficiencyReport({
      usages: [usage(1, 0, 0, 0)], calibration: cal,
      // Conditionally include currentTaskClass for exactOptionalPropertyTypes
      ...(tcl !== undefined ? { currentTaskClass: tcl } : {}),
    });
    assert.equal(r.directCodexSavings.available, false, reason);
    assert.equal((r.directCodexSavings as any).reason, reason);
  }
});

// --- Structural invariants + determinism + large counts --------------------

test("range ordering min≤max; deterministic detached; large counts safe", () => {
  const r = buildTokenEfficiencyReport({ usages: [usage(500, 200, 50, 10)],
    exchangeMeasurements: [eng("test content")], calibration: CAL,
    currentTaskClass: "edit-task" });
  assert.ok((r.exchangeEstimate as any).range.min <= (r.exchangeEstimate as any).range.max);
  if (r.boundaryReduction.available) {
    const br = r.boundaryReduction as any;
    assert.ok(br.tokens.min <= br.tokens.max);
  }
  if (r.directCodexSavings.available) {
    const dcs = r.directCodexSavings as any;
    assert.ok(dcs.absoluteSavings.min <= dcs.absoluteSavings.max);
    if (dcs.percentageSavings.available)
      assert.ok(dcs.percentageSavings.range.min <= dcs.percentageSavings.range.max);
  }
  // Determinism
  const params = { usages: [usage(100, 50, 20, 10)], exchangeMeasurements: [eng("test data")],
    calibration: CAL, currentTaskClass: "edit-task" };
  const r1 = buildTokenEfficiencyReport(params), r2 = buildTokenEfficiencyReport(params);
  assert.deepEqual(r1, r2); assert.notEqual(r1, r2);
  // Large counts
  const rl = buildTokenEfficiencyReport({ usages: [usage(10_000_000, 5_000_000, 1_000_000, 500_000)],
    exchangeMeasurements: [eng("x")] });
  assert.equal(rl.workerVolume.kind, "complete");
  assert.equal((rl.workerVolume as any).grossWorkerTokens, 16_500_000);
});

// --- normalizeOrchestrationExchangeReceipt — canonical receipt domain -----

function attrs(overrides?: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: "rec-1", taskId: "task-1", operation: "tool-call", transport: "mcp",
    capturedAt: TS, outcome: "success",
    requestArguments: eng("request payload"),
    responseRelationship: "may-overlap",
    responseContent: eng("response payload", "response"),
    responseStructured: eng("structured payload", "response"),
  };
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) { delete result[k]; }
      else { result[k] = v; }
    }
  }
  return result;
}

test("valid receipt normalizes to detached deeply-frozen canonical", () => {
  const receipt = normalizeOrchestrationExchangeReceipt(attrs());
  assert.equal(receipt.id, "rec-1");
  assert.equal(receipt.taskId, "task-1");
  assert.equal(receipt.operation, "tool-call");
  assert.equal(receipt.transport, "mcp");
  assert.equal(receipt.capturedAt, TS);
  assert.equal(receipt.outcome, "success");
  assert.equal(receipt.responseRelationship, "may-overlap");
  assert.ok(receipt.requestArguments.direction === "request");
  assert.ok(receipt.responseContent !== undefined);
  assert.ok(receipt.responseStructured !== undefined);
  assert.ok(receipt.responseContent!.direction === "response");
  assert.ok(receipt.responseStructured!.direction === "response");
  // Deeply frozen
  assertDeepFrozen(receipt);
  assert.throws(() => { (receipt as any).operation = "x"; }, TypeError);
  assert.throws(() => { (receipt.requestArguments as any).utf8Bytes = 999; }, TypeError);
  // No raw text or unsafe fields
  for (const f of ["text", "content", "prompt", "body", "payload", "raw", "secret"])
    assert.equal(f in receipt, false);
});

test("canonical output normalizes again identically but detached", () => {
  const input = attrs({ responseContent: undefined, responseStructured: undefined });
  const r1 = normalizeOrchestrationExchangeReceipt(input);
  const r2 = normalizeOrchestrationExchangeReceipt(r1);
  assert.deepEqual(r1, r2);
  assert.notEqual(r1, r2);
  assert.notEqual(r1.requestArguments, r2.requestArguments);
});

test("zero response representations → only requestArguments present", () => {
  const receipt = normalizeOrchestrationExchangeReceipt(
    attrs({ responseContent: undefined, responseStructured: undefined }),
  );
  assert.equal(receipt.responseContent, undefined);
  assert.equal(receipt.responseStructured, undefined);
});

test("one response representation → only that named surface survives", () => {
  const r1 = normalizeOrchestrationExchangeReceipt(
    attrs({ responseContent: eng("content", "response"), responseStructured: undefined }),
  );
  assert.ok(r1.responseContent !== undefined);
  assert.equal(r1.responseStructured, undefined);

  const r2 = normalizeOrchestrationExchangeReceipt(
    attrs({ responseContent: undefined, responseStructured: eng("structured", "response") }),
  );
  assert.equal(r2.responseContent, undefined);
  assert.ok(r2.responseStructured !== undefined);
});

test("same-reference response measurements produce detached copies", () => {
  const shared = createRedactedExchangeMeasurement("shared", "response", "tool-call", "task-1", TS);
  const receipt = normalizeOrchestrationExchangeReceipt(
    attrs({ responseContent: shared, responseStructured: shared }),
  );
  assert.ok(receipt.responseContent !== undefined);
  assert.ok(receipt.responseStructured !== undefined);
  // Deeply equal but not reference-equal — detached copies, not overlap evidence
  assert.deepEqual(receipt.responseContent, receipt.responseStructured);
  assert.notEqual(receipt.responseContent, receipt.responseStructured);
  assert.notEqual(receipt.responseContent, shared);
});

test("responseRelationship always may-overlap literal in canonical output", () => {
  const receipt = normalizeOrchestrationExchangeReceipt(attrs());
  assert.equal(receipt.responseRelationship, "may-overlap");
  // Must be the exact literal, never derived or transformed
  assert.strictEqual(receipt.responseRelationship, "may-overlap");
});

test("unsafe receipt or measurement keys → rejected without echoing values", () => {
  const base = attrs({ responseContent: undefined, responseStructured: undefined });
  // Extra key on receipt
  assert.throws(
    () => normalizeOrchestrationExchangeReceipt({ ...base, secretPayload: "leak" }),
    { name: "TypeError", message: "Invalid orchestration exchange receipt" },
  );
  // Extra key on measurement
  assert.throws(
    () => normalizeOrchestrationExchangeReceipt({
      ...base,
      requestArguments: { ...eng("data"), rawText: "secret" },
    }),
    { name: "TypeError", message: "Invalid measurement in receipt" },
  );
  // Extra key on response measurement
  assert.throws(
    () => normalizeOrchestrationExchangeReceipt({
      ...base,
      responseContent: { ...eng("resp", "response"), prompt: "secret" },
    }),
    { name: "TypeError", message: "Invalid measurement in receipt" },
  );
});

test("missing required receipt keys → rejected", () => {
  const required = ["id", "taskId", "operation", "transport", "capturedAt", "outcome",
    "requestArguments", "responseRelationship"];
  const base = attrs({ responseContent: undefined, responseStructured: undefined });
  for (const key of required) {
    const { [key]: _, ...partial } = base;
    assert.throws(
      () => normalizeOrchestrationExchangeReceipt(partial),
      { name: "TypeError", message: "Invalid orchestration exchange receipt" },
      `missing key: ${key}`,
    );
  }
});

test("non-may-overlap responseRelationship → rejected", () => {
  const base = attrs({ responseContent: undefined, responseStructured: undefined });
  for (const v of ["distinct", "no-overlap", "may_overlap", "", null, 123]) {
    assert.throws(
      () => normalizeOrchestrationExchangeReceipt({ ...base, responseRelationship: v }),
      TypeError,
    );
  }
});

test("invalid measurement count fields → rejected", () => {
  const base = attrs({ responseContent: undefined, responseStructured: undefined });
  assert.throws(
    () => normalizeOrchestrationExchangeReceipt({
      ...base,
      requestArguments: { ...eng("data"), utf8Bytes: -1 },
    }),
    { name: "TypeError", message: "Invalid measurement in receipt" },
  );
  assert.throws(
    () => normalizeOrchestrationExchangeReceipt({
      ...base,
      requestArguments: { ...eng("data"), asciiCount: 1.5 },
    }),
    { name: "TypeError", message: "Invalid measurement in receipt" },
  );
  assert.throws(
    () => normalizeOrchestrationExchangeReceipt({
      ...base,
      requestArguments: { ...eng("data"), nonAsciiCount: Number.MAX_SAFE_INTEGER + 1 },
    }),
    { name: "TypeError", message: "Invalid measurement in receipt" },
  );
});

test("measurement attribution mismatch → rejected", () => {
  const base = attrs({ responseContent: undefined, responseStructured: undefined });
  // Wrong taskId
  assert.throws(
    () => normalizeOrchestrationExchangeReceipt({
      ...base,
      requestArguments: createRedactedExchangeMeasurement("d", "request", "tool-call", "task-OTHER", TS),
    }),
    { name: "TypeError", message: "Invalid measurement in receipt" },
  );
  // Wrong operation
  assert.throws(
    () => normalizeOrchestrationExchangeReceipt({
      ...base,
      requestArguments: createRedactedExchangeMeasurement("d", "request", "OTHER-OP", "task-1", TS),
    }),
    { name: "TypeError", message: "Invalid measurement in receipt" },
  );
  // Wrong timestamp
  assert.throws(
    () => normalizeOrchestrationExchangeReceipt({
      ...base,
      requestArguments: createRedactedExchangeMeasurement("d", "request", "tool-call", "task-1",
        "2020-01-01T00:00:00.000Z"),
    }),
    { name: "TypeError", message: "Invalid measurement in receipt" },
  );
  // Response measurement with wrong taskId
  assert.throws(
    () => normalizeOrchestrationExchangeReceipt({
      ...base,
      responseContent: createRedactedExchangeMeasurement("d", "response", "tool-call", "task-OTHER", TS),
    }),
    { name: "TypeError", message: "Invalid measurement in receipt" },
  );
});

test("wrong measurement surface direction → rejected", () => {
  const base = attrs({ responseContent: undefined, responseStructured: undefined });
  // requestArguments must be "request"
  assert.throws(
    () => normalizeOrchestrationExchangeReceipt({ ...base, requestArguments: eng("wrong-dir", "response") }),
    { name: "TypeError", message: "Invalid measurement in receipt" },
  );
  // responseContent must be "response"
  assert.throws(
    () => normalizeOrchestrationExchangeReceipt({ ...base, responseContent: eng("wrong-dir") }),
    { name: "TypeError", message: "Invalid measurement in receipt" },
  );
  // responseStructured must be "response"
  assert.throws(
    () => normalizeOrchestrationExchangeReceipt({ ...base, responseStructured: eng("wrong-dir") }),
    { name: "TypeError", message: "Invalid measurement in receipt" },
  );
});

test("UTF-8 byte inconsistency → rejected", () => {
  assert.throws(
    () => normalizeOrchestrationExchangeReceipt(attrs({
      responseContent: undefined, responseStructured: undefined,
      requestArguments: {
        direction: "request", operation: "tool-call", taskId: "task-1", timestamp: TS,
        utf8Bytes: 3, asciiCount: 10, nonAsciiCount: 0,
      },
    })),
    { name: "TypeError", message: "Invalid measurement in receipt" },
  );
});

test("empty or whitespace string metadata → rejected", () => {
  const base = attrs({ responseContent: undefined, responseStructured: undefined });
  for (const field of ["id", "taskId", "operation", "transport", "outcome"]) {
    for (const val of ["", "   "]) {
      assert.throws(
        () => normalizeOrchestrationExchangeReceipt({ ...base, [field]: val }),
        { name: "TypeError", message: "Invalid orchestration exchange receipt" },
      );
    }
  }
});

test("invalid capturedAt timestamp → rejected", () => {
  const base = attrs({ responseContent: undefined, responseStructured: undefined });
  for (const val of ["", "not-a-date", "2020-13-01"]) {
    assert.throws(
      () => normalizeOrchestrationExchangeReceipt({ ...base, capturedAt: val }),
      { name: "TypeError", message: "Invalid orchestration exchange receipt" },
    );
  }
});

test("non-object or null input → rejected", () => {
  for (const v of [null, undefined, "string", 123, true, []]) {
    assert.throws(
      () => normalizeOrchestrationExchangeReceipt(v),
      { name: "TypeError", message: "Invalid orchestration exchange receipt" },
    );
  }
});

test("error messages never echo untrusted values or raw content", () => {
  const secret = "super-secret-api-key-abc-123";
  const tests: Array<() => void> = [
    () => normalizeOrchestrationExchangeReceipt({
      id: "r", taskId: "t", operation: "o", transport: "mcp",
      capturedAt: TS, outcome: "error",
      requestArguments: eng("d"),
      responseRelationship: "may-overlap",
      apiKey: secret,
    }),
    () => normalizeOrchestrationExchangeReceipt({
      id: "r", taskId: "t", operation: "o", transport: "mcp",
      capturedAt: TS, outcome: "error",
      requestArguments: {
        direction: "request", operation: "o", taskId: "t", timestamp: TS,
        utf8Bytes: 5, asciiCount: 5, nonAsciiCount: 0, rawPrompt: secret,
      },
      responseRelationship: "may-overlap",
    }),
    () => normalizeOrchestrationExchangeReceipt({
      id: "r", taskId: secret, operation: "o", transport: "mcp",
      capturedAt: TS, outcome: "error",
      requestArguments: eng("d"),
      responseRelationship: "may-overlap",
    }),
  ];
  for (const fn of tests) {
    try { fn(); assert.fail("Expected TypeError"); } catch (e: any) {
      assert.ok(e instanceof TypeError);
      assert.ok(!e.message.includes(secret), `Error echoed secret: ${e.message}`);
    }
  }
});

test("invalid transport and outcome literals → rejected", () => {
  const base = attrs({ responseContent: undefined, responseStructured: undefined });
  for (const v of ["http", "stdio", "pipe", "", "mcp-", "CLI"]) {
    assert.throws(
      () => normalizeOrchestrationExchangeReceipt({ ...base, transport: v }),
      { name: "TypeError", message: "Invalid orchestration exchange receipt" },
    );
  }
  for (const v of ["ok", "partial", "failed", "", "SUCCESS", "Error"]) {
    assert.throws(
      () => normalizeOrchestrationExchangeReceipt({ ...base, outcome: v }),
      { name: "TypeError", message: "Invalid orchestration exchange receipt" },
    );
  }
});

test("inherited required fields on prototype → rejected", () => {
  const proto = { id: "rec-proto", taskId: "task-1" };
  const input = Object.create(proto);
  input.operation = "tool-call";
  input.transport = "mcp";
  input.capturedAt = TS;
  input.outcome = "success";
  input.requestArguments = eng("data");
  input.responseRelationship = "may-overlap";
  assert.throws(
    () => normalizeOrchestrationExchangeReceipt(input),
    { name: "TypeError", message: "Invalid orchestration exchange receipt" },
  );
});

test("explicit null or undefined optional surfaces → rejected", () => {
  const base: Record<string, unknown> = {
    id: "rec-null", taskId: "task-1", operation: "tool-call", transport: "mcp",
    capturedAt: TS, outcome: "success",
    requestArguments: eng("data"),
    responseRelationship: "may-overlap",
  };
  assert.throws(
    () => normalizeOrchestrationExchangeReceipt({ ...base, responseContent: null }),
    { name: "TypeError", message: "Invalid orchestration exchange receipt" },
  );
  assert.throws(
    () => normalizeOrchestrationExchangeReceipt({ ...base, responseContent: undefined }),
    { name: "TypeError", message: "Invalid orchestration exchange receipt" },
  );
  assert.throws(
    () => normalizeOrchestrationExchangeReceipt({ ...base, responseStructured: null }),
    { name: "TypeError", message: "Invalid orchestration exchange receipt" },
  );
});

// --- Receipt-aware exchange estimation -------------------------------------

function recFromAttr(attrs: Record<string, unknown>): OrchestrationExchangeReceipt {
  return normalizeOrchestrationExchangeReceipt(attrs);
}

/** Build minimal valid attrs for a receipt with one or two response surfaces. */
function recAttrs(overrides?: Record<string, unknown>): Record<string, unknown> {
  const taskId = (overrides?.taskId as string) ?? "task-r";
  const operation = (overrides?.operation as string) ?? "tool-call";
  const capturedAt = (overrides?.capturedAt as string) ?? TS;
  const m = (text: string, dir: "request" | "response") =>
    createRedactedExchangeMeasurement(text, dir, operation, taskId, capturedAt);
  const result: Record<string, unknown> = {
    id: (overrides?.id as string) ?? "rec-rt",
    taskId, operation, transport: "mcp",
    capturedAt, outcome: "success",
    requestArguments: m((overrides?.reqText as string) ?? "request payload", "request"),
    responseRelationship: "may-overlap",
    responseContent: m((overrides?.contentText as string) ?? "response content payload", "response"),
    responseStructured: m((overrides?.structText as string) ?? '{"ok":true}', "response"),
  };
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) { delete result[k]; }
    }
  }
  return result;
}

// Short English texts to keep test arithmetic legible
// "Hello" = 5 bytes, 5 cps → min=ceil(5/6)=1, max=5
// "World" = 5 bytes, 5 cps → min=1, max=5
// "Hi"    = 2 bytes, 2 cps → min=ceil(2/6)=1, max=2
// "{}"    = 2 bytes, 2 cps → min=1, max=2
// "OK"    = 2 bytes, 2 cps → min=1, max=2
// "Bye"   = 3 bytes, 3 cps → min=1, max=3

test("zero response surfaces — only request contributes", () => {
  // "Hello" request → min=1, max=5
  const receipt = recFromAttr(recAttrs({
    responseContent: undefined, responseStructured: undefined, reqText: "Hello",
  }));
  const r = buildTokenEfficiencyReport({
    usages: [usage(100, 0, 0, 0)],
    exchangeReceipts: [receipt],
  });
  assert.equal(r.exchangeEstimate.kind, "range");
  const ee = r.exchangeEstimate as any;
  assert.equal(ee.range.min, 1);
  assert.equal(ee.range.max, 5);
  assert.equal(ee.range.method, "receipt-aware-broad-utf8-byte-envelope-v1");
  assert.equal(ee.range.confidence, "low");
});

test("one response surface — additive with request", () => {
  // Request "Hello" (min=1, max=5) + Response "World" (min=1, max=5)
  const receipt = recFromAttr(recAttrs({
    responseStructured: undefined, reqText: "Hello", contentText: "World",
  }));
  const r = buildTokenEfficiencyReport({
    usages: [usage(100, 0, 0, 0)],
    exchangeReceipts: [receipt],
  });
  assert.equal(r.exchangeEstimate.kind, "range");
  const ee = r.exchangeEstimate as any;
  assert.equal(ee.range.min, 2);   // 1+1
  assert.equal(ee.range.max, 10);  // 5+5
  assert.equal(ee.range.method, "receipt-aware-broad-utf8-byte-envelope-v1");
});

test("dual MCP response surfaces — may-overlap lower=max, upper=sum", () => {
  // Request "Hi" (2 bytes, 2 cps → min=1, max=2)
  // content "Hello!!" (7 bytes, 7 cps → min=ceil(7/6)=2, max=7)
  // structured "{}" (2 bytes, 2 cps → min=1, max=2)
  // Response lower = max(2, 1) = 2  (≠ sum=3)
  // Response upper = 7 + 2 = 9      (≠ max=7)
  // Total min = 1 + 2 = 3
  // Total max = 2 + 9 = 11
  const receipt = recFromAttr(recAttrs({
    reqText: "Hi", contentText: "Hello!!", structText: "{}",
  }));
  const r = buildTokenEfficiencyReport({
    usages: [usage(100, 0, 0, 0)],
    exchangeReceipts: [receipt],
  });
  assert.equal(r.exchangeEstimate.kind, "range");
  const ee = r.exchangeEstimate as any;
  assert.equal(ee.range.min, 3);
  assert.equal(ee.range.max, 11);
  assert.equal(ee.range.method, "receipt-aware-broad-utf8-byte-envelope-v1");
  // If response minima were summed: total min = 1+(2+1) = 4.  Our
  // result is 3, proving lower = max(2,1) = 2.  If response maxima
  // used max alone: total max = 2+7 = 9.  Our result is 11, proving
  // upper = sum(7,2) = 9.  Neither bound collapses to a single
  // surface or double-counts overlap.
});

test("asymmetric overlapping response surfaces — larger-surface lower bound", () => {
  // Request "Hi" (min=1, max=2)
  // content "Hello" (min=1, max=5), structured "Bye" (min=1, max=3)
  // Response lower = max(1,1) = 1, upper = 5+3 = 8
  // Total min = 1+1 = 2, max = 2+8 = 10
  const receipt = recFromAttr(recAttrs({
    reqText: "Hi", contentText: "Hello", structText: "Bye",
  }));
  const r = buildTokenEfficiencyReport({
    usages: [usage(100, 0, 0, 0)],
    exchangeReceipts: [receipt],
  });
  assert.equal(r.exchangeEstimate.kind, "range");
  const ee = r.exchangeEstimate as any;
  assert.equal(ee.range.min, 2);
  assert.equal(ee.range.max, 10);
  // Now test with swapped surface sizes to prove lower=max(surface minima)
  // content "OK" (min=1, max=2), structured "Hello" (min=1, max=5)
  // Response lower = max(1,1) = 1, upper = 2+5 = 7
  // Total min = 1+1 = 2, max = 2+7 = 9
  const receipt2 = recFromAttr(recAttrs({
    reqText: "Hi", contentText: "OK", structText: "Hello",
  }));
  const r2 = buildTokenEfficiencyReport({
    usages: [usage(100, 0, 0, 0)],
    exchangeReceipts: [receipt2],
  });
  const ee2 = r2.exchangeEstimate as any;
  assert.equal(ee2.range.min, 2);
  assert.equal(ee2.range.max, 9);
  // Upper not just max(surface maxima) — it's sum(5+2)=7 added to req max 2 = 9
});

test("multiple additive receipts — distinct exchanges sum", () => {
  // Receipt 1: Request "Hi" only → min=1, max=2
  const r1 = recFromAttr(recAttrs({
    id: "rec-1", reqText: "Hi", responseContent: undefined, responseStructured: undefined,
  }));
  // Receipt 2: Request "OK" only → min=1, max=2
  const r2 = recFromAttr(recAttrs({
    id: "rec-2", reqText: "OK", responseContent: undefined, responseStructured: undefined,
  }));
  // Receipt 3: Request "Hello" + Response "World" → min=2, max=10
  const r3 = recFromAttr(recAttrs({
    id: "rec-3", reqText: "Hello", contentText: "World", responseStructured: undefined,
  }));
  const report = buildTokenEfficiencyReport({
    usages: [usage(500, 100, 0, 0)],
    exchangeReceipts: [r1, r2, r3],
  });
  assert.equal(report.exchangeEstimate.kind, "range");
  const ee = report.exchangeEstimate as any;
  assert.equal(ee.range.min, 4);   // 1+1+2
  assert.equal(ee.range.max, 14);  // 2+2+10
  assert.equal(ee.range.method, "receipt-aware-broad-utf8-byte-envelope-v1");
  // Evidence counts are not in the pure builder — that's the service layer
});

test("exact evidence overrides receipts and flat measurements", () => {
  const receipt = recFromAttr(recAttrs({
    reqText: "Hello", responseContent: undefined, responseStructured: undefined,
  }));
  const measurements = [eng("valid measurement data")];
  const r = buildTokenEfficiencyReport({
    usages: [usage(100, 0, 0, 0)],
    exchangeReceipts: [receipt],
    exchangeMeasurements: measurements,
    exactExchangeTokens: { tokens: 42, source: "provider-api" },
  });
  assert.equal(r.exchangeEstimate.kind, "exact");
  const ee = r.exchangeEstimate as any;
  assert.equal(ee.tokens, 42);
  assert.equal(ee.source, "provider-api");
  // Boundary reduction uses exact (high confidence)
  assert.equal(r.boundaryReduction.available, true);
  assert.equal((r.boundaryReduction as any).tokens.confidence, "high");
});

test("invalid exact evidence still fails closed even with receipts present", () => {
  const receipt = recFromAttr(recAttrs({
    reqText: "Hello", responseContent: undefined, responseStructured: undefined,
  }));
  const r = buildTokenEfficiencyReport({
    usages: [usage(100, 0, 0, 0)],
    exchangeReceipts: [receipt],
    exactExchangeTokens: { tokens: -1, source: "" },
  });
  assert.equal(r.exchangeEstimate.kind, "unavailable");
  assert.equal((r.exchangeEstimate as any).reason, "invalid-exact-evidence");
});

test("receipts take precedence over flat measurements", () => {
  // Receipt gives receipt-aware-broad-utf8-byte-envelope-v1 method
  const receipt = recFromAttr(recAttrs({
    reqText: "Hello", responseContent: undefined, responseStructured: undefined,
  }));
  const measurements = [eng("flat measurement")];
  const r = buildTokenEfficiencyReport({
    usages: [usage(100, 0, 0, 0)],
    exchangeReceipts: [receipt],
    exchangeMeasurements: measurements,
  });
  assert.equal(r.exchangeEstimate.kind, "range");
  const ee = r.exchangeEstimate as any;
  // Must be receipt-aware method, not flat broad-utf8-byte-envelope-v1
  assert.equal(ee.range.method, "receipt-aware-broad-utf8-byte-envelope-v1");
  // Values match receipt (request "Hello" → min=1, max=5), not flat measurement
  assert.equal(ee.range.min, 1);
  assert.equal(ee.range.max, 5);
});

test("invalid receipt in non-empty list → typed unavailable, not filtered", () => {
  // Tampered receipt with invalid utf8Bytes
  const badReceipt = {
    id: "bad-rec", taskId: "task-r", operation: "tool-call", transport: "mcp",
    capturedAt: TS, outcome: "success",
    requestArguments: {
      direction: "request", operation: "tool-call", taskId: "task-r", timestamp: TS,
      utf8Bytes: -1, asciiCount: 0, nonAsciiCount: 0,
    },
    responseRelationship: "may-overlap",
  };
  const r = buildTokenEfficiencyReport({
    usages: [usage(100, 0, 0, 0)],
    exchangeReceipts: [badReceipt as any],
  });
  assert.equal(r.exchangeEstimate.kind, "unavailable");
  assert.equal((r.exchangeEstimate as any).reason, "invalid-receipt-evidence");
  // Boundary and direct savings unavailable
  assert.equal(r.boundaryReduction.available, false);
  assert.equal((r.boundaryReduction as any).reason, "missing-exchange-evidence");
  assert.equal(r.directCodexSavings.available, false);

  // Invalid receipt among valid ones → whole set tainted
  const goodReceipt = recFromAttr(recAttrs({
    id: "good-rec", reqText: "Hi", responseContent: undefined, responseStructured: undefined,
  }));
  const r2 = buildTokenEfficiencyReport({
    usages: [usage(100, 0, 0, 0)],
    exchangeReceipts: [goodReceipt, badReceipt as any],
  });
  assert.equal(r2.exchangeEstimate.kind, "unavailable");
  assert.equal((r2.exchangeEstimate as any).reason, "invalid-receipt-evidence");
});

test("invalid receipt evidence never echoes untrusted values in error or report", () => {
  const secret = "leaked-api-key-xyz";
  const badReceipt = {
    id: "bad-rec", taskId: secret, operation: "tool-call", transport: "mcp",
    capturedAt: TS, outcome: "success",
    requestArguments: {
      direction: "request", operation: "tool-call", taskId: secret, timestamp: TS,
      utf8Bytes: 5, asciiCount: 5, nonAsciiCount: 0, leakedField: secret,
    },
    responseRelationship: "may-overlap",
  };
  const r = buildTokenEfficiencyReport({
    usages: [usage(100, 0, 0, 0)],
    exchangeReceipts: [badReceipt as any],
  });
  assert.equal(r.exchangeEstimate.kind, "unavailable");
  assert.equal((r.exchangeEstimate as any).reason, "invalid-receipt-evidence");
  const json = JSON.stringify(r);
  assert.ok(!json.includes(secret), "report must not echo untrusted values");
});

test("empty receipt list → no-measurements, does NOT fall through to measurements", () => {
  // Empty receipts + valid measurements → still no-measurements because
  // explicit [] authoritatively says "no receipt evidence".
  const r = buildTokenEfficiencyReport({
    usages: [usage(100, 0, 0, 0)],
    exchangeReceipts: [],
    exchangeMeasurements: [eng("hello world")],
  });
  assert.equal(r.exchangeEstimate.kind, "unavailable");
  assert.equal((r.exchangeEstimate as any).reason, "no-measurements");
});

test("undefined receipts → legacy flat measurement behavior unchanged", () => {
  // No receipts param → behaves exactly as before
  const r = buildTokenEfficiencyReport({
    usages: [usage(1000, 500, 200, 50)],
    exchangeMeasurements: [eng("Hello World")],
  });
  assert.equal(r.workerVolume.kind, "complete");
  assert.equal(r.exchangeEstimate.kind, "range");
  const ee = r.exchangeEstimate as any;
  assert.equal(ee.range.method, "broad-utf8-byte-envelope-v1");
  assert.equal(ee.range.min, 2);
  assert.equal(ee.range.max, 11);

  // Exact evidence still works
  const r2 = buildTokenEfficiencyReport({
    usages: [usage(100, 0, 0, 0)],
    exactExchangeTokens: { tokens: 100, source: "api" },
  });
  assert.equal(r2.exchangeEstimate.kind, "exact");
  assert.equal((r2.exchangeEstimate as any).tokens, 100);
});

test("receipt-aware exchange produces boundary reduction with complete usage", () => {
  const receipt = recFromAttr(recAttrs({
    reqText: "Hi", responseContent: undefined, responseStructured: undefined,
  }));
  // Worker gross = 100+50+0+0 = 150, exchange "Hi" → min=1, max=2
  // Boundary min = 150-2 = 148, max = 150-1 = 149
  const r = buildTokenEfficiencyReport({
    usages: [usage(100, 50, 0, 0)],
    exchangeReceipts: [receipt],
  });
  assert.equal(r.boundaryReduction.available, true);
  const br = r.boundaryReduction as any;
  assert.equal(br.tokens.min, 148);
  assert.equal(br.tokens.max, 149);
  assert.equal(br.tokens.confidence, "low");
  assert.ok(br.tokens.method.includes("worker-volume-minus"));
});

test("receipt-aware exchange with incomplete usage → boundary unavailable", () => {
  const receipt = recFromAttr(recAttrs({
    reqText: "Hi", responseContent: undefined, responseStructured: undefined,
  }));
  const r = buildTokenEfficiencyReport({
    usages: [badUsage(100, 50, 0, 0)],
    exchangeReceipts: [receipt],
  });
  assert.equal(r.boundaryReduction.available, false);
  assert.equal((r.boundaryReduction as any).reason, "incomplete-worker-usage");
});

test("receipt-aware report deeply frozen; immutable children", () => {
  const receipt = recFromAttr(recAttrs({
    reqText: "Hello", responseContent: undefined, responseStructured: undefined,
  }));
  const r = buildTokenEfficiencyReport({
    usages: [usage(100, 50, 0, 0)],
    exchangeReceipts: [receipt],
    calibration: CAL, currentTaskClass: "edit-task",
  });
  assertDeepFrozen(r);
  assert.throws(() => { (r as any).workerVolume = {}; }, TypeError);
  assert.throws(() => { (r.exchangeEstimate as any).range = {}; }, TypeError);
});

test("receipt-aware method label distinct from flat measurement method", () => {
  const receipt = recFromAttr(recAttrs({
    reqText: "test", responseContent: undefined, responseStructured: undefined,
  }));
  const rReceipt = buildTokenEfficiencyReport({
    usages: [usage(100, 0, 0, 0)],
    exchangeReceipts: [receipt],
  });
  const rFlat = buildTokenEfficiencyReport({
    usages: [usage(100, 0, 0, 0)],
    exchangeMeasurements: [eng("test")],
  });
  const mReceipt = (rReceipt.exchangeEstimate as any).range.method;
  const mFlat = (rFlat.exchangeEstimate as any).range.method;
  assert.notEqual(mReceipt, mFlat);
  assert.ok(mReceipt.startsWith("receipt-aware"));
  assert.ok(mFlat.startsWith("broad-utf8"));
});

test("receipt responseRelationship is always may-overlap in canonical output", () => {
  const receipt = recFromAttr(recAttrs({
    responseContent: eng("content", "response"),
    responseStructured: eng("structured", "response"),
  }));
  assert.strictEqual(receipt.responseRelationship, "may-overlap");
  // Both response surfaces present and independently addressable
  assert.ok(receipt.responseContent !== undefined);
  assert.ok(receipt.responseStructured !== undefined);
  assert.notEqual(receipt.responseContent, receipt.responseStructured);
});
