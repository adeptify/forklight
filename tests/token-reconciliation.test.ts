// Token-usage reconciliation acceptance tests — lock state derivation,
// exact component/gross deltas, safe-integer arithmetic, immutability,
// privacy, coverage counting, and the real GLM mismatch.
// No live Provider, daemon, or private project content.

import assert from "node:assert/strict";
import test from "node:test";
import type { AttemptRecord, AttemptTokenUsage } from "../src/core/types.js";
import { reconcileTokenUsage } from "../src/core/token-reconciliation.js";

const TS = "2026-07-23T12:00:00.000Z";

// --- Helpers ---------------------------------------------------------------

function makeUsage(
  input: number, output: number, cr: number, cc: number,
  perModel?: AttemptTokenUsage["perModel"],
): AttemptTokenUsage {
  return {
    inputTokens: input, outputTokens: output,
    cacheReadInputTokens: cr, cacheCreationInputTokens: cc,
    source: "terminal-result" as const, complete: true as const,
    serviceTier: "standard",
    ...(perModel ? { perModel } : {}),
  };
}

function makeAttempt(
  id: string, taskId: string, ordinal: number,
  usage?: AttemptTokenUsage,
): AttemptRecord {
  const base: Omit<AttemptRecord, "usage"> & { usage?: AttemptTokenUsage } = {
    id, taskId, ordinal, status: "succeeded",
    sessionId: `session-${id}`,
    rawLogPath: `/tmp/${id}.log`,
    startedAt: TS, finishedAt: TS, exitCode: 0,
  };
  if (usage !== undefined) base.usage = usage;
  return base as AttemptRecord;
}

function assertDeepFrozen(v: unknown, path = "root"): void {
  if (v === null || typeof v !== "object") return;
  assert.ok(Object.isFrozen(v), `Expected ${path} frozen`);
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) assertDeepFrozen(v[i], `${path}[${i}]`);
  } else {
    for (const k of Object.keys(v as Record<string, unknown>))
      assertDeepFrozen((v as Record<string, unknown>)[k], `${path}.${k}`);
  }
}

function grossAvailable(rec: ReturnType<typeof reconcileTokenUsage>) {
  if (!rec.grossDeltas.available) assert.fail(`Gross comparison unavailable: ${rec.grossDeltas.reason}`);
  return rec.grossDeltas;
}

// --- 1. Exact match ---------------------------------------------------------

test("exact match: every complete attempt has perModel and all sums match", () => {
  const attempts = [
    makeAttempt("a1", "t1", 1, makeUsage(100, 50, 20, 10, [
      { model: "m1", inputTokens: 60, outputTokens: 30, cacheReadInputTokens: 10, cacheCreationInputTokens: 5 },
      { model: "m2", inputTokens: 40, outputTokens: 20, cacheReadInputTokens: 10, cacheCreationInputTokens: 5 },
    ])),
    makeAttempt("a2", "t1", 2, makeUsage(200, 100, 0, 0, [
      { model: "m1", inputTokens: 200, outputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    ])),
  ];

  const rec = reconcileTokenUsage(attempts);
  assert.equal(rec.state, "matched");
  assert.equal(rec.comparedAttemptCount, 2);
  assert.equal(rec.matchedAttemptCount, 2);
  assert.equal(rec.mismatchedAttemptCount, 0);
  assert.equal(rec.missingBreakdownCount, 0);
  assert.equal(rec.missingUsageCount, 0);
  assert.equal(rec.totalAttemptCount, 2);

  const gd = grossAvailable(rec);
  assert.equal(gd.topLevelGross, 480); // 180 + 300
  assert.equal(gd.perModelGross, 480);
  assert.equal(gd.delta, 0);

  assert.equal(rec.evidence.length, 2);
  assert.equal(rec.evidence[0]!.ordinal, 1);
  assert.equal(rec.evidence[0]!.modelCount, 2);
  assert.equal(rec.evidence[0]!.deltas.gross, 0);
  assert.equal(rec.evidence[1]!.ordinal, 2);
  assert.equal(rec.evidence[1]!.modelCount, 1);
  assert.equal(rec.evidence[1]!.deltas.gross, 0);
});

// --- 2. Real GLM mismatch ---------------------------------------------------

test("real GLM mismatch: +1,882,895 diagnostic difference; top-level remains canonical", () => {
  // FL-D216: real Volcengine glm-5.2[1M] Task 54e2dc29
  const usage: AttemptTokenUsage = {
    inputTokens: 378_237,
    outputTokens: 126_836,
    cacheReadInputTokens: 40_756_800,
    cacheCreationInputTokens: 0,
    source: "terminal-result", complete: true,
    serviceTier: "standard",
    perModel: [
      { model: "glm-5.2[1m]", inputTokens: 378_658, outputTokens: 132_190, cacheReadInputTokens: 42_633_920, cacheCreationInputTokens: 0 },
    ],
  };

  const topGross = 378_237 + 126_836 + 40_756_800; // 41,261,873
  const pmGross = 378_658 + 132_190 + 42_633_920; // 43,144,768

  assert.equal(topGross, 41_261_873);
  assert.equal(pmGross, 43_144_768);
  assert.equal(pmGross - topGross, 1_882_895);

  const attempts = [makeAttempt("glm-att", "glm-task", 1, usage)];

  const rec = reconcileTokenUsage(attempts);
  assert.equal(rec.state, "mismatch");
  assert.equal(rec.comparedAttemptCount, 1);
  assert.equal(rec.matchedAttemptCount, 0);
  assert.equal(rec.mismatchedAttemptCount, 1);
  assert.equal(rec.totalAttemptCount, 1);

  const gd = grossAvailable(rec);
  assert.equal(gd.topLevelGross, 41_261_873);
  assert.equal(gd.perModelGross, 43_144_768);
  assert.equal(gd.delta, 1_882_895);

  // Evidence is exact
  const ev = rec.evidence[0]!;
  assert.equal(ev.ordinal, 1);
  assert.equal(ev.topLevel.gross, 41_261_873);
  assert.equal(ev.perModel.gross, 43_144_768);
  assert.equal(ev.deltas.gross, 1_882_895);
  assert.equal(ev.modelCount, 1);

  // Component deltas use perModel minus top-level
  assert.equal(ev.deltas.inputTokens, 421);
  assert.equal(ev.deltas.outputTokens, 5_354);
  assert.equal(ev.deltas.cacheReadInputTokens, 1_877_120);
});

// --- 3. Partial breakdown coverage ------------------------------------------

test("partial coverage: some attempts have matching perModel, others lack breakdown", () => {
  const attempts = [
    makeAttempt("a1", "t3", 1, makeUsage(100, 50, 0, 0, [
      { model: "m1", inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    ])),
    makeAttempt("a2", "t3", 2, makeUsage(200, 100, 0, 0)), // no perModel
  ];

  const rec = reconcileTokenUsage(attempts);
  assert.equal(rec.state, "partial");
  assert.equal(rec.comparedAttemptCount, 1);
  assert.equal(rec.matchedAttemptCount, 1);
  assert.equal(rec.mismatchedAttemptCount, 0);
  assert.equal(rec.missingBreakdownCount, 1);
  assert.equal(rec.missingUsageCount, 0);
  assert.equal(rec.totalAttemptCount, 2);

  const gd = grossAvailable(rec);
  assert.equal(gd.topLevelGross, 150); // only the compared attempt
  assert.equal(gd.perModelGross, 150);
  assert.equal(gd.delta, 0);

  assert.equal(rec.evidence.length, 1);
  assert.equal(rec.evidence[0]!.ordinal, 1);
});

// --- 4. Mismatch plus missing evidence --------------------------------------

test("mismatch plus missing evidence: mismatch dominates while gaps counted", () => {
  const attempts = [
    makeAttempt("a1", "t4", 1, makeUsage(100, 50, 0, 0, [
      { model: "m1", inputTokens: 110, outputTokens: 55, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }, // mismatch
    ])),
    makeAttempt("a2", "t4", 2, makeUsage(200, 100, 0, 0)), // no perModel
    makeAttempt("a3", "t4", 3), // no usage at all
  ];

  const rec = reconcileTokenUsage(attempts);
  assert.equal(rec.state, "mismatch"); // mismatch dominates
  assert.equal(rec.comparedAttemptCount, 1);
  assert.equal(rec.matchedAttemptCount, 0);
  assert.equal(rec.mismatchedAttemptCount, 1);
  assert.equal(rec.missingBreakdownCount, 1);
  assert.equal(rec.missingUsageCount, 1);
  assert.equal(rec.totalAttemptCount, 3);

  const gd = grossAvailable(rec);
  assert.equal(gd.topLevelGross, 150);
  assert.equal(gd.perModelGross, 165);
  assert.equal(gd.delta, 15);

  assert.equal(rec.evidence.length, 1);
  assert.equal(rec.evidence[0]!.ordinal, 1);
  assert.equal(rec.evidence[0]!.deltas.gross, 15);
});

// --- 5. No per-model evidence -----------------------------------------------

test("no per-model evidence: all attempts lack breakdown → unavailable", () => {
  const attempts = [
    makeAttempt("a1", "t5", 1, makeUsage(100, 50, 0, 0)), // no perModel
    makeAttempt("a2", "t5", 2, makeUsage(200, 100, 0, 0)), // no perModel
  ];

  const rec = reconcileTokenUsage(attempts);
  assert.equal(rec.state, "unavailable");
  assert.equal(rec.comparedAttemptCount, 0);
  assert.equal(rec.matchedAttemptCount, 0);
  assert.equal(rec.mismatchedAttemptCount, 0);
  assert.equal(rec.missingBreakdownCount, 2);
  assert.equal(rec.missingUsageCount, 0);
  assert.equal(rec.totalAttemptCount, 2);
  assert.equal(rec.evidence.length, 0);

  assert.equal(rec.grossDeltas.available, false);
  if (rec.grossDeltas.available) assert.fail("No comparison should be available");
  assert.equal(rec.grossDeltas.reason, "no-comparable-attempts");
});

// --- 6. Deeply frozen and immutable -----------------------------------------

test("reconciliation result is deeply frozen and immutable", () => {
  const attempts = [
    makeAttempt("a1", "t6", 1, makeUsage(100, 50, 0, 0, [
      { model: "m1", inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    ])),
  ];

  const rec = reconcileTokenUsage(attempts);
  assertDeepFrozen(rec);

  assert.throws(() => { (rec as any).state = "hacked"; }, TypeError);
  assert.throws(() => { (rec as any).comparedAttemptCount = 999; }, TypeError);
  assert.throws(() => { (rec.grossDeltas as any).available = false; }, TypeError);
  assert.throws(() => { (rec.evidence as any).push({}); }, TypeError);

  // Each evidence element is also frozen
  assert.ok(rec.evidence.length > 0);
  assertDeepFrozen(rec.evidence[0]!);
  assert.throws(() => { (rec.evidence[0]! as any).ordinal = 99; }, TypeError);
  assert.throws(() => { (rec.evidence[0]!.topLevel as any).gross = 0; }, TypeError);
});

// --- 7. Privacy: no model strings, no raw content ---------------------------

test("reconciliation evidence never exposes model strings or raw content", () => {
  const attempts = [
    makeAttempt("a1", "t7", 1, makeUsage(100, 50, 0, 0, [
      { model: "secret-model-name", inputTokens: 60, outputTokens: 30, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    ])),
  ];

  const rec = reconcileTokenUsage(attempts);
  const json = JSON.stringify(rec);

  // Model count is exposed but model strings are not
  assert.equal(rec.evidence[0]!.modelCount, 1);
  assert.ok(!json.includes("secret-model-name"), "model strings must not be exposed");

  // No raw content, paths, credentials
  for (const w of ["prompt", "response", "path", "log", "credential", "apiKey", "secret"]) {
    assert.ok(!json.includes(w), `Reconciliation leaked: ${w}`);
  }
});

// --- 8. Deterministic ordering ----------------------------------------------

test("evidence is deterministically ordered by ordinal", () => {
  const attempts = [
    makeAttempt("a3", "t8", 3, makeUsage(300, 150, 0, 0, [
      { model: "m1", inputTokens: 300, outputTokens: 150, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    ])),
    makeAttempt("a1", "t8", 1, makeUsage(100, 50, 0, 0, [
      { model: "m1", inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    ])),
    makeAttempt("a2", "t8", 2, makeUsage(200, 100, 0, 0, [
      { model: "m1", inputTokens: 200, outputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    ])),
  ];

  const rec = reconcileTokenUsage(attempts);
  assert.equal(rec.evidence.length, 3);
  assert.deepEqual(
    rec.evidence.map(e => e.ordinal),
    [1, 2, 3],
  );

  // Same inputs → same detached result
  const r2 = reconcileTokenUsage(attempts);
  assert.deepEqual(rec, r2);
  assert.notEqual(rec, r2);
  assert.notEqual(rec.evidence, r2.evidence);
});

// --- 9. Empty attempts → unavailable ----------------------------------------

test("empty attempts list → unavailable with zero counts", () => {
  const rec = reconcileTokenUsage([]);
  assert.equal(rec.state, "unavailable");
  assert.equal(rec.totalAttemptCount, 0);
  assert.equal(rec.comparedAttemptCount, 0);
  assert.equal(rec.missingUsageCount, 0);
  assert.equal(rec.grossDeltas.available, false);
  assert.equal(rec.evidence.length, 0);
});

// --- 10. Safe-integer overflow in perModel sum → treated as missing ---------

test("safe-integer overflow in perModel sum: invalid evidence, not missing or guessed", () => {
  const huge = Number.MAX_SAFE_INTEGER;
  const attempts = [
    makeAttempt("a1", "t10", 1, makeUsage(100, 50, 0, 0, [
      { model: "m1", inputTokens: huge, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      { model: "m2", inputTokens: huge, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }, // would overflow
    ])),
  ];

  const rec = reconcileTokenUsage(attempts);
  assert.equal(rec.state, "unavailable");
  assert.equal(rec.missingBreakdownCount, 0);
  assert.equal(rec.invalidCounterEvidenceCount, 1);
  assert.equal(rec.comparedAttemptCount, 0);
});

test("safe-integer overflow in top-level gross is invalid evidence, not a guessed total", () => {
  const attempts = [
    makeAttempt("a1", "t10-top", 1, makeUsage(Number.MAX_SAFE_INTEGER, 1, 0, 0, [
      { model: "m1", inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    ])),
  ];
  const rec = reconcileTokenUsage(attempts);
  assert.equal(rec.state, "unavailable");
  assert.equal(rec.invalidCounterEvidenceCount, 1);
  assert.equal(rec.missingBreakdownCount, 0);
  assert.equal(rec.comparedAttemptCount, 0);
});

test("cross-Attempt gross overflow keeps per-Attempt matches but fails aggregate closed", () => {
  const attempts = [
    makeAttempt("a1", "t10-aggregate", 1, makeUsage(Number.MAX_SAFE_INTEGER, 0, 0, 0, [
      { model: "m1", inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    ])),
    makeAttempt("a2", "t10-aggregate", 2, makeUsage(1, 0, 0, 0, [
      { model: "m1", inputTokens: 1, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    ])),
  ];
  const rec = reconcileTokenUsage(attempts);
  assert.equal(rec.state, "matched");
  assert.equal(rec.matchedAttemptCount, 2);
  assert.equal(rec.grossDeltas.available, false);
  if (rec.grossDeltas.available) assert.fail("Aggregate overflow should be unavailable");
  assert.equal(rec.grossDeltas.reason, "safe-integer-overflow");
});

// --- 11. Empty perModel array → missing breakdown ---------------------------

test("empty perModel array: treated as missing breakdown", () => {
  const attempts = [
    makeAttempt("a1", "t11", 1, makeUsage(100, 50, 0, 0, [])),
  ];

  const rec = reconcileTokenUsage(attempts);
  assert.equal(rec.state, "unavailable");
  assert.equal(rec.missingBreakdownCount, 1);
  assert.equal(rec.comparedAttemptCount, 0);
});

// --- 12. Model count exposed but not model strings --------------------------

test("model count is exposed; multiple perModel entries counted correctly", () => {
  const attempts = [
    makeAttempt("a1", "t12", 1, makeUsage(1000, 500, 200, 50, [
      { model: "alpha-model-v1", inputTokens: 500, outputTokens: 250, cacheReadInputTokens: 100, cacheCreationInputTokens: 25 },
      { model: "beta-router-v3", inputTokens: 300, outputTokens: 150, cacheReadInputTokens: 50, cacheCreationInputTokens: 25 },
      { model: "gamma-adapter-v2", inputTokens: 200, outputTokens: 100, cacheReadInputTokens: 50, cacheCreationInputTokens: 0 },
    ])),
  ];

  const rec = reconcileTokenUsage(attempts);
  assert.equal(rec.evidence[0]!.modelCount, 3);

  // Serialized form must not include model strings
  const json = JSON.stringify(rec);
  assert.ok(!json.includes("alpha-model-v1"));
  assert.ok(!json.includes("beta-router-v3"));
  assert.ok(!json.includes("gamma-adapter-v2"));
});

// --- 13. All matched with no other attempts → matched state -----------------

test("all compared matched, no gaps → matched", () => {
  const attempts = [
    makeAttempt("a1", "t13", 1, makeUsage(10, 20, 0, 0, [
      { model: "m1", inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    ])),
  ];

  const rec = reconcileTokenUsage(attempts);
  assert.equal(rec.state, "matched");
  assert.equal(rec.comparedAttemptCount, 1);
  assert.equal(rec.matchedAttemptCount, 1);
  assert.equal(rec.mismatchedAttemptCount, 0);
  assert.equal(rec.missingBreakdownCount, 0);
  assert.equal(rec.missingUsageCount, 0);
});

// --- 14. Non-terminal usage → missing usage, not compared -------------------

test("non-terminal or incomplete usage: counted as missing, not compared", () => {
  const attempts: AttemptRecord[] = [
    {
      id: "a1", taskId: "t14", ordinal: 1,
      status: "failed", sessionId: "s1", rawLogPath: "/tmp/a1.log",
      startedAt: TS, finishedAt: TS, exitCode: 1,
      usage: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
        source: "terminal-result" as const, complete: true as const,
        perModel: [{ model: "m1", inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }] },
    } as AttemptRecord,
    {
      id: "a2", taskId: "t14", ordinal: 2,
      status: "failed", sessionId: "s2", rawLogPath: "/tmp/a2.log",
      startedAt: TS, finishedAt: TS, exitCode: 1,
      // usage incomplete → not complete
      usage: { inputTokens: 200, outputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
        source: "terminal-result" as const, complete: false as const, // incomplete!
        perModel: [{ model: "m2", inputTokens: 200, outputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }] },
    } as unknown as AttemptTokenUsage,
  ] as unknown as AttemptRecord[];

  const rec = reconcileTokenUsage(attempts);
  assert.equal(rec.state, "partial"); // one match plus one invalid usage record
  assert.equal(rec.comparedAttemptCount, 1);
  assert.equal(rec.missingUsageCount, 0);
  assert.equal(rec.invalidCounterEvidenceCount, 1);
});

// --- 15. Multiple mismatches: all counted, deltas summed correctly ----------

test("multiple mismatches: all counted, deltas aggregated correctly", () => {
  const attempts = [
    makeAttempt("a1", "t15", 1, makeUsage(100, 50, 0, 0, [
      { model: "m1", inputTokens: 110, outputTokens: 55, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }, // +15
    ])),
    makeAttempt("a2", "t15", 2, makeUsage(200, 100, 0, 0, [
      { model: "m1", inputTokens: 190, outputTokens: 95, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }, // -15
    ])),
  ];

  const rec = reconcileTokenUsage(attempts);
  assert.equal(rec.state, "mismatch");
  assert.equal(rec.comparedAttemptCount, 2);
  assert.equal(rec.matchedAttemptCount, 0);
  assert.equal(rec.mismatchedAttemptCount, 2);

  const gd = grossAvailable(rec);
  assert.equal(gd.topLevelGross, 450); // 150 + 300
  assert.equal(gd.perModelGross, 450); // 165 + 285
  assert.equal(gd.delta, 0); // deltas cancel out
});
