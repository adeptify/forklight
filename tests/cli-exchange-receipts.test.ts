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
import { routeMutation } from "../src/daemon/client.js";
import { StateStore } from "../src/state/store.js";
import { authorizeExtraAttempt, resolvePendingGrantExecutionOptions } from "../src/core/attempt-authorization.js";
import { registerTaskFromSpec } from "../src/core/runner.js";

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
      profileId: "codex-main-v1", version: 1, sampleSize: 4 },
    usageReconciliation: {
      state: "unavailable" as const,
      workerVolumeSource: "terminal-top-level" as const,
      perModelRole: "diagnostic-only" as const,
      comparedAttemptCount: 0, matchedAttemptCount: 0, mismatchedAttemptCount: 0,
      missingBreakdownCount: 1, missingUsageCount: 0, invalidCounterEvidenceCount: 0,
      totalAttemptCount: 1,
      grossDeltas: { available: false as const, scope: "compared-attempts-only" as const,
        reason: "no-comparable-attempts" as const },
      evidence: [],
    } };
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
  const responseBytes = receipts.map(r => r.responseContent!.utf8Bytes).sort((a, b) => a - b);
  assert.deepEqual(responseBytes, [humanRendered.length, jsonRendered.length].sort((a, b) => a - b));
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

// --- routing: bootstrap fallback vs post-dispatch fail-closed receipt checks ---

const ROUTE_CLI_PROBE = "forklight-cli-route-BETA-2026";

test("routing produces success receipt on bootstrap failure and error receipt on post-dispatch rejection, never replaying locally", async () => {
  // Bootstrap failure routes to local fallback → success receipt.
  const homeBoot = await mkdtemp(path.join(tmpdir(), "forklight-cli-route-boot-"));
  seedTask(homeBoot, "task-boot");
  let fallbackCalled = false;
  const { output } = await withCliExchangeReceipt({
    operation: "forklight_resume", home: homeBoot,
    args: { taskId: "task-boot" }, taskId: "task-boot",
    invoke: async () => routeMutation(
      async () => { throw new Error("ECONNREFUSED"); },
      async () => { throw new Error("unreachable"); },
      async () => { fallbackCalled = true; return makeTask("task-boot", { status: "queued" }); },
    ),
    renderOutput: () => "ok\n",
  });
  assert.equal(fallbackCalled, true);
  assert.equal(output, "ok\n");
  const bootReceipts = listReceipts(homeBoot, "task-boot");
  assert.equal(bootReceipts.length, 1);
  assert.equal(bootReceipts[0]!.outcome, "success");

  // Post-dispatch daemon rejection → error receipt, local never called.
  const homeDispatch = await mkdtemp(path.join(tmpdir(), "forklight-cli-route-disp-"));
  seedTask(homeDispatch, "task-disp");
  const dispatchError = new Error(`daemon ${ROUTE_CLI_PROBE} build mismatch`);
  fallbackCalled = false;
  let caught: unknown;
  try {
    await withCliExchangeReceipt({
      operation: "forklight_revise", home: homeDispatch,
      args: { taskId: "task-disp", feedbackLength: 5 }, taskId: "task-disp",
      invoke: async () => routeMutation(
        async () => {},
        async () => { throw dispatchError; },
        async () => { fallbackCalled = true; return makeTask("task-disp"); },
      ),
      renderOutput: () => "",
    });
    assert.fail("must rethrow");
  } catch (error) { caught = error; }
  assert.equal(caught, dispatchError);
  assert.equal(fallbackCalled, false);
  const dispReceipts = listReceipts(homeDispatch, "task-disp");
  assert.equal(dispReceipts.length, 1);
  assert.equal(dispReceipts[0]!.outcome, "error");
  assert.equal(dispReceipts[0]!.operation, "forklight_revise");
  const serialized = JSON.stringify(dispReceipts[0]);
  assert.ok(!serialized.includes(ROUTE_CLI_PROBE));
  assertNoForbidden(dispReceipts[0]!);
});

// --- local resume fallback recovers pending grant ---

function exhaustedBaseTask(store: StateStore): { taskId: string; sessionId: string } {
  const task = registerTaskFromSpec(store, {
    version: 1, name: "recovery-resume", project: "/tmp/src",
    goal: "Pending grant recovery", constraints: [],
    provider: { name: "deepseek", model: "deepseek-v4-flash", keychainService: "forklight.test" },
    runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: 1 },
    workspace: { exclude: [] },
    worker: { allowEdits: false, allowedCommands: [], focusPaths: ["src"] },
    acceptance: { commands: ["true"] },
  }, "forklight://test/cli-recovery");
  const now = new Date().toISOString();
  for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
    store.createAttempt({
      id: `a${ordinal}`, taskId: task.id, ordinal, status: "failed",
      sessionId: task.sessionId, rawLogPath: "/dev/null",
      startedAt: now, finishedAt: now, exitCode: 1,
    });
  }
  store.setTaskStatus(task.id, "failed", { error: "Independent verification failed" });
  return { taskId: task.id, sessionId: task.sessionId };
}

const CLI_PENDING_PROBE = "forklight-cli-pending-GAMMA-2026";

test("local resume recovers pending grant without duplicate authorization", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-resume-pending-"));
  const store = new StateStore(home);
  const { taskId } = exhaustedBaseTask(store);
  // Authorize ordinal 4 as a durable pending grant, then close the store
  // so the local fallback sees the persisted event but no in-memory state.
  authorizeExtraAttempt(store, taskId, {
    additionalAttempts: 1, maxBudgetUsd: null,
    reason: CLI_PENDING_PROBE, confirm: true,
  }, 3, 20, 2);
  const grantEventsBefore = store.listEvents(taskId).filter(
    (e) => e.type === "attempt.authorization.granted",
  );
  assert.equal(grantEventsBefore.length, 1);
  store.close();

  // Reopen store for the local-fallback simulation.
  const reopened = new StateStore(home);
  try {
    // Simulate the resume local fallback: resolve pending grant when
    // authorization is undefined.
    const resolved = resolvePendingGrantExecutionOptions(reopened, taskId, 3, 2);
    assert.ok(resolved !== null, "pending grant must be resolved");
    assert.equal(resolved!.maximumOrdinal, 4);
    assert.equal(resolved!.maxBudgetUsdOverride, null);
    // No second grant event was minted by the read-only resolver.
    const grantEventsAfter = reopened.listEvents(taskId).filter(
      (e) => e.type === "attempt.authorization.granted",
    );
    assert.equal(grantEventsAfter.length, 1,
      "resolvePendingGrantExecutionOptions must not mint a duplicate grant event");
  } finally {
    reopened.close();
  }
});

test("local revise recovers pending grant for eligibility and execution", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-revise-pending-"));
  const store = new StateStore(home);
  // Create a standalone succeeded task with 2 base attempts (maxAttempts=2).
  const task = registerTaskFromSpec(store, {
    version: 1, name: "revise-recovery", project: "/tmp/src",
    goal: "Pending revise grant", constraints: [],
    provider: { name: "deepseek", model: "deepseek-v4-flash", keychainService: "forklight.test" },
    runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: 1 },
    workspace: { exclude: [] },
    worker: { allowEdits: false, allowedCommands: [], focusPaths: ["src"] },
    acceptance: { commands: ["true"] },
  }, "forklight://test/cli-revise-recovery");
  const now = new Date().toISOString();
  for (let ordinal = 1; ordinal <= 2; ordinal += 1) {
    store.createAttempt({
      id: `a${ordinal}`, taskId: task.id, ordinal, status: "succeeded",
      sessionId: task.sessionId, rawLogPath: "/dev/null",
      startedAt: now, finishedAt: now, exitCode: 0,
    });
  }
  store.setTaskStatus(task.id, "succeeded", { error: null });
  // Authorize ordinal 3 as a durable pending grant for the revise.
  authorizeExtraAttempt(store, task.id, {
    additionalAttempts: 1, maxBudgetUsd: null,
    reason: `${CLI_PENDING_PROBE}-revise`, confirm: true,
  }, 2, 20, 2);
  const grantEventsBefore = store.listEvents(task.id).filter(
    (e) => e.type === "attempt.authorization.granted",
  );
  assert.equal(grantEventsBefore.length, 1);
  store.close();

  const reopened = new StateStore(home);
  try {
    // Simulate revise local fallback: resolve pending grant with
    // configured maxAttempts=2 and maxExtraAttempts=2.
    const pending = resolvePendingGrantExecutionOptions(reopened, task.id, 2, 2);
    assert.ok(pending !== null);
    assert.equal(pending!.maximumOrdinal, 3);
    assert.equal(pending!.maxBudgetUsdOverride, null);
    // Eligibility should use the pending ordinal (3), not base maxAttempts (2).
    const { checkReviseEligibility } = await import("../src/core/runner.js");
    const effectiveLimit = pending!.maximumOrdinal;
    const check = checkReviseEligibility(reopened, task.id, "valid feedback text", effectiveLimit);
    assert.equal(check.eligible, true, "must be eligible with pending grant ceiling");
    assert.equal(check.canonicalFeedback, "valid feedback text");
    // No duplicate grant event.
    const grantEventsAfter = reopened.listEvents(task.id).filter(
      (e) => e.type === "attempt.authorization.granted",
    );
    assert.equal(grantEventsAfter.length, 1);
  } finally {
    reopened.close();
  }
});

test("configured second correction: local fallback passes maxExtraAttempts to authorizeExtraAttempt", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-maxextra-"));
  const store = new StateStore(home);
  const { taskId, sessionId } = exhaustedBaseTask(store);
  // Consume one extra attempt (ordinal 4) so the next is ordinal 5.
  authorizeExtraAttempt(store, taskId, {
    additionalAttempts: 1, maxBudgetUsd: 1, reason: "First correction", confirm: true,
  }, 3, 20, 2);
  store.createAttempt({
    id: "a4", taskId, ordinal: 4, status: "failed",
    sessionId, rawLogPath: "/dev/null",
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), exitCode: 1,
  });
  const eventsBefore = store.listEvents(taskId).length;
  // Local fallback with a second authorization and maxExtraAttempts=2 — must
  // authorize ordinal 5, not reject with "already used".
  const opts = authorizeExtraAttempt(store, taskId, {
    additionalAttempts: 1, maxBudgetUsd: 2, reason: "Second correction", confirm: true,
  }, 3, 20, 2);
  assert.equal(opts.maximumOrdinal, 5, "second correction must target ordinal 5");
  assert.equal(opts.maxBudgetUsdOverride, 2);
  const grants = store.listEvents(taskId).filter((e) => e.type === "attempt.authorization.granted");
  assert.equal(grants.length, 2, "one new grant event in addition to the existing one");
  assert.equal(store.listEvents(taskId).length, eventsBefore + 1,
    "only the new grant event was appended; no duplicate");
  // With default maxExtraAttempts=1 the same call would reject.
  store.close();
});
