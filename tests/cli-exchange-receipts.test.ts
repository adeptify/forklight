// CLI exchange-receipt acceptance tests for task-scoped ForkLight CLI
// operations, including attributable direct-Codex capture.  Locks: one responseContent, no
// responseStructured, exact stdout measurement including Unicode,
// known-task exact error/rethrow identity, unattributable submit
// skipped, fail-open safe warning, JSON/human differ, truthful Token
// report rendering.  No live Provider, daemon, or project content.

import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type { OrchestrationExchangeReceipt } from "../src/core/token-efficiency.js";
import type { TaskTokenReport } from "../src/core/token-report.js";
import type { TaskRecord } from "../src/core/types.js";
import {
  humanTokenReportLines,
  withCliExchangeReceipt,
} from "../src/cli/exchange-receipts.js";
import { StateStore } from "../src/state/store.js";

const SECRET_PROBE = "forklight-cli-secret-DELTA-2026";
const TS = "2026-07-23T12:00:00.000Z";

function makeTask(id: string, overrides?: Partial<TaskRecord>): TaskRecord {
  return {
    id, name: `task-${id}`, status: "succeeded",
    sourcePath: "/tmp/src", taskFile: `/tmp/${id}.yaml`,
    spec: {} as TaskRecord["spec"],
    paths: {} as TaskRecord["paths"],
    createdAt: TS, updatedAt: TS,
    ...overrides,
  } as TaskRecord;
}

function withStore<T>(home: string, fn: (s: StateStore) => T): T {
  const store = new StateStore(home);
  try { return fn(store); } finally { store.close(); }
}

function listReceipts(home: string, taskId: string): OrchestrationExchangeReceipt[] {
  return withStore(home, (s) => s.listExchangeReceipts(taskId));
}

function captureStderr(): { captured: string[]; restore: () => void } {
  const captured: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: typeof originalWrite }).write =
    ((chunk: unknown) => { if (typeof chunk === "string") captured.push(chunk); return true; }) as typeof originalWrite;
  return { captured, restore: () => {
    (process.stderr as unknown as { write: typeof originalWrite }).write = originalWrite;
  } };
}

function seedTask(home: string, id: string): void {
  withStore(home, (s) => { s.createTask(makeTask(id)); });
}

const FORBIDDEN = ["text", "content", "prompt", "body", "payload",
  "raw", "secret", "hash", "diff", "feedback"];

function assertNoForbidden(r: OrchestrationExchangeReceipt): void {
  for (const f of FORBIDDEN) {
    assert.equal(f in r, false, `receipt must not carry field "${f}"`);
  }
}

function makeReport(overrides: {
  workerKind?: "complete" | "incomplete";
  exchangeKind?: "exact" | "range" | "unavailable";
  exchangeReason?: string;
  boundaryAvailable?: boolean;
  boundaryReason?: string;
  dcsAvailable?: boolean;
  dcsReason?: string;
}): TaskTokenReport {
  const wv = overrides.workerKind === "incomplete"
    ? { kind: "incomplete" as const, inputTokens: 100, outputTokens: 50,
        cacheReadInputTokens: 10, cacheCreationInputTokens: 5,
        grossWorkerTokens: 165, sampleCount: 2,
        completeSampleCount: 1, missingSampleCount: 1 }
    : { kind: "complete" as const, inputTokens: 100, outputTokens: 50,
        cacheReadInputTokens: 10, cacheCreationInputTokens: 5,
        grossWorkerTokens: 165, sampleCount: 1 };
  const ee = overrides.exchangeKind === "exact"
    ? { kind: "exact" as const, tokens: 42, source: "test-source" }
    : overrides.exchangeKind === "range"
      ? { kind: "range" as const, range: { min: 10, max: 50, method: "m", confidence: "low" as const } }
      : { kind: "unavailable" as const, reason: overrides.exchangeReason as "no-measurements" };
  const br = overrides.boundaryAvailable
    ? { available: true as const, tokens: { min: 100, max: 150, method: "m", confidence: "low" as const } }
    : { available: false as const, reason: overrides.boundaryReason as "missing-exchange-evidence" };
  const dcs = overrides.dcsAvailable
    ? { available: true as const,
        absoluteSavings: { min: 50, max: 100, method: "m", confidence: "low" as const },
        percentageSavings: { available: true as const, range: { min: 10, max: 20, method: "m", confidence: "low" as const } },
        baseline: { minTokens: 200, maxTokens: 300, method: "m", taskClass: "edit", confidence: "medium" as const } }
    : { available: false as const, reason: overrides.dcsReason as "missing-exchange-evidence" };
  return { taskId: "t", attemptCount: 1, receiptCount: 1,
    report: { workerVolume: wv, exchangeEstimate: ee, boundaryReduction: br, directCodexSavings: dcs },
    calibrationSelection: { kind: "explicit-override" as const,
      profileId: "codex-main-v1", version: 1, sampleSize: 4 } };
}

// --- CLI one-surface success (no responseStructured) ---------------------

test("CLI success: one responseContent, no responseStructured, exact stdout bytes", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-ok-"));
  seedTask(home, "task-ok");
  // Output contains a non-ASCII code point ("✓") to lock Unicode counts.
  const rendered = `status: succeeded ✓\nid: task-ok\n`;
  const { output } = await withCliExchangeReceipt({
    operation: "forklight_status", home,
    args: { taskId: "task-ok", json: false },
    taskId: "task-ok",
    invoke: async () => ({ taskId: "task-ok", status: "succeeded", secret: SECRET_PROBE }),
    renderOutput: () => rendered,
  });
  assert.equal(output, rendered);
  const receipts = listReceipts(home, "task-ok");
  assert.equal(receipts.length, 1);
  const r = receipts[0]!;
  assert.equal(r.transport, "cli");
  assert.equal(r.outcome, "success");
  assert.ok(r.responseContent !== undefined);
  assert.equal(r.responseStructured, undefined);
  assert.equal(r.responseContent!.utf8Bytes, Buffer.byteLength(rendered, "utf8"));
  assert.equal(r.responseContent!.nonAsciiCount, 1);
  assert.ok(!JSON.stringify(r).includes(SECRET_PROBE));
  assertNoForbidden(r);
});

// --- JSON vs human: distinct request measurements and bytes --------------

test("JSON and human modes produce distinct request and responseContent measurements", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-jh-"));
  seedTask(home, "task-jh");
  const humanRendered = `status: succeeded\nid: task-jh\n`;
  const jsonRendered = `${JSON.stringify({ id: "task-jh" }, null, 2)}\n`;
  await withCliExchangeReceipt({
    operation: "forklight_status", home,
    args: { taskId: "task-jh", json: false }, taskId: "task-jh",
    invoke: async () => ({ id: "task-jh" }),
    renderOutput: () => humanRendered,
  });
  await withCliExchangeReceipt({
    operation: "forklight_status", home,
    args: { taskId: "task-jh", json: true }, taskId: "task-jh",
    invoke: async () => ({ id: "task-jh" }),
    renderOutput: () => jsonRendered,
  });
  const receipts = listReceipts(home, "task-jh");
  assert.equal(receipts.length, 2);
  assert.notEqual(receipts[0]!.requestArguments.utf8Bytes, receipts[1]!.requestArguments.utf8Bytes,
    "JSON vs human must produce distinct request byte counts");
  assert.notEqual(receipts[0]!.responseContent!.utf8Bytes, receipts[1]!.responseContent!.utf8Bytes);
  assert.equal(receipts[0]!.responseContent!.utf8Bytes, humanRendered.length);
  assert.equal(receipts[1]!.responseContent!.utf8Bytes, jsonRendered.length);
});

// --- Known-task error: exact rethrow identity and CLI error line ---------

test("known-task CLI failure: responseContent is the exact error line, error is rethrown unchanged", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-err-"));
  seedTask(home, "task-err");
  const retained = new Error("synthetic-cli-daemon-start-failure-X-7");
  retained.name = "CustomCliError";
  let caught: unknown;
  try {
    await withCliExchangeReceipt({
      operation: "forklight_integration_apply", home,
      args: { taskId: "task-err", receiptId: "r", confirm: true, json: false },
      taskId: "task-err",
      invoke: async () => { throw retained; },
      renderOutput: () => "",
    });
    assert.fail("wrapper must rethrow");
  } catch (error) { caught = error; }
  assert.equal(caught, retained, "wrapper must rethrow the exact retained error object");
  assert.equal((caught as Error).name, "CustomCliError", "name must survive unchanged");
  const receipts = listReceipts(home, "task-err");
  assert.equal(receipts.length, 1);
  const r = receipts[0]!;
  assert.equal(r.outcome, "error");
  assert.equal(r.responseStructured, undefined);
  const expectedLine = "ForkLight error: synthetic-cli-daemon-start-failure-X-7\n";
  assert.equal(r.responseContent!.utf8Bytes, expectedLine.length);
  assert.ok(!JSON.stringify(r).includes("synthetic-cli-daemon-start-failure-X-7"),
    "error message text must not survive in the receipt");
  assertNoForbidden(r);
});

// --- Unattributable submit failure: stores nothing ----------------------

test("submit-style unattributable failure stores nothing and rethrows original error", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-unattr-"));
  const original = new Error("synthetic-cli-submit-failure-marker-1234");
  let caught: unknown;
  try {
    await withCliExchangeReceipt({
      operation: "forklight_submit", home,
      args: { taskFile: `/tmp/${SECRET_PROBE}.yaml` },
      taskId: () => undefined,
      invoke: async () => { throw original; },
      renderOutput: () => "",
    });
    assert.fail("wrapper must rethrow");
  } catch (error) { caught = error; }
  assert.equal(caught, original);
  withStore(home, (s) => {
    assert.equal(s.listTasks().length, 0);
    assert.equal(s.listExchangeReceipts("any-unknown-task").length, 0);
  });
});

// --- Fail-open: persistence failure emits only the fixed warning ---------

test("fail-open: storage unavailable emits only the [forklight-cli] warning and preserves result", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-fo-"));
  seedTask(home, "task-fo");
  const dbPath = path.join(home, "forklight.sqlite");
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { chmodSync(p, 0o444); } catch { /* ignore */ }
  }
  const rendered = `status: succeeded\n`;
  const { captured, restore } = captureStderr();
  try {
    const r = await withCliExchangeReceipt({
      operation: "forklight_status", home,
      args: { taskId: "task-fo", json: false }, taskId: "task-fo",
      invoke: async () => ({ id: "task-fo" }),
      renderOutput: () => rendered,
    });
    assert.equal(r.output, rendered);
    const warnings = captured.filter((line) => line.includes("[forklight-cli] exchange receipt capture failed"));
    assert.ok(warnings.length >= 1, "fail-open must emit the fixed CLI stderr warning");
    for (const line of warnings) {
      assert.ok(!line.includes("task-fo"), "warning must not echo task id");
      assert.ok(!line.includes(SECRET_PROBE), "warning must not echo private secret");
    }
  } finally {
    restore();
    for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      try { chmodSync(p, 0o644); } catch { /* ignore */ }
    }
  }
});

test("direct Codex capture receipt uses only the canonical successful sample Task attribution", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-dc-"));
  seedTask(home, "task-canonical");
  seedTask(home, "task-unrelated");
  let canonicalTaskId: string | undefined;
  const rendered = "sampleId: sample-one\nforklightTaskId: task-canonical\n";
  const { output } = await withCliExchangeReceipt({
    operation: "forklight_direct_codex_capture", home,
    args: {
      usage: { input_tokens: 100, output_tokens: 10 },
      metadata: { fieldCount: 7, privateMarker: SECRET_PROBE },
      json: false,
    },
    taskId: () => canonicalTaskId,
    invoke: async () => {
      const sample = { sampleId: "sample-one", forklightTaskId: "task-canonical" };
      canonicalTaskId = sample.forklightTaskId;
      return sample;
    },
    renderOutput: () => rendered,
  });
  assert.equal(output, rendered);
  const receipts = listReceipts(home, "task-canonical");
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]!.operation, "forklight_direct_codex_capture");
  assert.equal(receipts[0]!.outcome, "success");
  assert.equal(receipts[0]!.responseContent!.utf8Bytes, rendered.length);
  assert.equal(listReceipts(home, "task-unrelated").length, 0);
  assert.ok(!JSON.stringify(receipts[0]).includes(SECRET_PROBE));
  assertNoForbidden(receipts[0]!);
});

// --- Truthful tokens report rendering -----------------------------------

test("truthful tokens report: complete Worker volume, exact/range/unavailable, boundary/dcs typed reasons, never 'saved'", () => {
  const out = humanTokenReportLines(makeReport({
    workerKind: "complete",
    exchangeKind: "unavailable", exchangeReason: "no-measurements",
    boundaryAvailable: false, boundaryReason: "missing-exchange-evidence",
    dcsAvailable: false, dcsReason: "direct-baseline-missing",
  }));
  assert.match(out, /Worker volume \(complete\):/);
  assert.match(out, /gross: 165 tokens across 1 samples/);
  assert.match(out, /Exchange estimate \(unavailable\):/);
  assert.match(out, /unavailable: no-measurements/);
  assert.match(out, /Boundary reduction \(unavailable\):/);
  assert.match(out, /unavailable: missing-exchange-evidence/);
  assert.match(out, /Direct Codex savings \(unavailable\):/);
  assert.match(out, /unavailable: direct-baseline-missing/);
  assert.ok(!/\bsaved\b/i.test(out), "Worker volume and boundary reduction must never be labelled 'saved'");
});

// --- forklight_revise receipt regression ---------------------------------

test("forklight_revise receipt: canonical operation, no type escape, metadata never feedback content", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-revise-"));
  seedTask(home, "task-revise-rec");
  const rendered = `queued: task-revise-rec\n`;
  const { output } = await withCliExchangeReceipt({
    operation: "forklight_revise",
    home,
    args: { taskId: "task-revise-rec", feedbackLength: 4 },
    taskId: "task-revise-rec",
    invoke: async () => makeTask("task-revise-rec", { status: "queued" }),
    renderOutput: () => rendered,
  });
  assert.equal(output, rendered);
  const receipts = listReceipts(home, "task-revise-rec");
  assert.equal(receipts.length, 1);
  const r = receipts[0]!;
  assert.equal(r.operation, "forklight_revise");
  assert.equal(r.outcome, "success");
  assert.equal(r.transport, "cli");
  assert.ok(r.responseContent !== undefined);
  assert.equal(r.responseContent!.utf8Bytes, Buffer.byteLength(rendered, "utf8"));
  // The receipt must never carry raw feedback text — args encode metadata only.
  const serialized = JSON.stringify(r);
  assert.ok(!serialized.includes("my review comment"),
    "receipt must never contain raw feedback text");
  assertNoForbidden(r);
});

test("forklight_revise error receipt: operation is canonical, error content redacted", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-revise-err-"));
  seedTask(home, "task-revise-err-rec");
  const original = new Error("revise-daemon-unavailable-REC-42");
  let caught: unknown;
  try {
    await withCliExchangeReceipt({
      operation: "forklight_revise",
      home,
      args: { taskId: "task-revise-err-rec", feedbackLength: 8 },
      taskId: "task-revise-err-rec",
      invoke: async () => { throw original; },
      renderOutput: () => "",
    });
    assert.fail("wrapper must rethrow");
  } catch (error) { caught = error; }
  assert.equal(caught, original);
  const receipts = listReceipts(home, "task-revise-err-rec");
  assert.equal(receipts.length, 1);
  const r = receipts[0]!;
  assert.equal(r.operation, "forklight_revise");
  assert.equal(r.outcome, "error");
  const serialized = JSON.stringify(r);
  assert.ok(!serialized.includes("revise-daemon-unavailable-REC-42"),
    "error receipt must not contain error message text");
  assertNoForbidden(r);
});

test("truthful tokens report: incomplete Worker volume preserves samples and dcs available renders range+baseline", () => {
  const incomplete = humanTokenReportLines(makeReport({
    workerKind: "incomplete",
    exchangeKind: "range",
    boundaryAvailable: true,
    dcsAvailable: true,
  }));
  assert.match(incomplete, /Worker volume \(incomplete\):/);
  assert.match(incomplete, /complete samples: 1/);
  assert.match(incomplete, /missing samples: 1/);
  assert.match(incomplete, /Direct Codex savings \(available\):/);
  assert.match(incomplete, /baseline: 200-300 tokens/);
  assert.match(incomplete, /taskClass: edit/);
});
