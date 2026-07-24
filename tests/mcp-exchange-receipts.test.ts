// MCP exchange-receipt acceptance tests for the seven task-scoped ForkLight
// MCP tools.  Verify privacy-safe count-only receipts are persisted under
// the originating Task id without changing the tool result contract.
//
// Module contract: No live Provider calls; no private project data;
// no reimplementation of receipt normalization.

import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { IntegrationReceiptRecord, TaskRecord, TaskStatus } from "../src/core/types.js";
import type { OrchestrationExchangeReceipt } from "../src/core/token-efficiency.js";
import { taskPaths } from "../src/core/config.js";
import { ForkLightDaemon } from "../src/daemon/server.js";
import { createForkLightMcpServer } from "../src/mcp/server.js";
import { StateStore } from "../src/state/store.js";
import { withMcpExchangeReceipt } from "../src/mcp/exchange-receipts.js";
import { prepareWorkspace } from "../src/workspace/copy.js";
import { createPathPolicy } from "../src/workspace/path-policy.js";
import { writeWorkspacePatchReport } from "../src/workspace/patch.js";
import { buildTaskRecord } from "../src/core/runner.js";
import { parseTaskSpec } from "../src/core/task.js";
import { recordMainReview } from "../src/core/main-review.js";

const SECRET_PROBE = "forklight-test-secret-api-key-XYZ-9876";

async function connectMcp(home: string): Promise<{
  client: Client; server: ReturnType<typeof createForkLightMcpServer>;
  daemon: ForkLightDaemon; close: () => Promise<void>;
}> {
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, server, daemon,
    close: async () => { await client.close(); await server.close(); await daemon.close(); } };
}

function withStore<T>(home: string, fn: (s: StateStore) => T): T {
  const store = new StateStore(home);
  try { return fn(store); } finally { store.close(); }
}

function listReceipts(home: string, taskId: string): OrchestrationExchangeReceipt[] {
  return withStore(home, (s) => s.listExchangeReceipts(taskId));
}

function submitArgs(home: string, secret: string): Record<string, unknown> {
  return {
    project: home, name: "secret-name", provider: "deepseek",
    contract: {
      outcome: "Secret outcome contract for attribution test",
      context: [`secret=${secret}`], inScope: [`s ${secret}`], outOfScope: [`o ${secret}`],
      executionSteps: [`e ${secret}`], deliverables: [`d ${secret}`],
      modules: [{ name: "m", responsibility: "module responsibility text",
        consumes: [`c ${secret}`], produces: [`p ${secret}`], boundaries: [`b ${secret}`] }],
      callChain: [`call ${secret}`, `chain ${secret}`],
      scenarios: [
        { name: "s1", given: `g ${secret}`, when: `w ${secret}`, then: `t ${secret}` },
        { name: "s2", given: "g2", when: "w2", then: "t2" },
      ],
      risks: [`r ${secret}`], changeBudget: { maxFiles: 3, maxDiffLines: 100 },
    },
    acceptance: { criteria: [`crit ${secret}`], commands: ["true"] },
    effort: "low", focusPaths: ["src"],
  };
}

/** Seed a Task with workspace prepared and a candidate diff in the
 *  workspace.  Status defaults to "succeeded"; pass "failed" to seed an
 *  eligible-resume task with 0 attempts. */
async function seedTaskWithDiff(
  home: string, status: TaskStatus = "succeeded",
): Promise<{ task: TaskRecord }> {
  const sourceDir = path.join(home, "source");
  const taskHome = path.join(home, "state");
  const taskId = randomUUID();
  await mkdir(sourceDir);
  await writeFile(path.join(sourceDir, "readme.md"), "# hello\n\nOriginal text.\n");
  await writeFile(path.join(sourceDir, "other.txt"), "Unrelated.\n");
  const paths = taskPaths(taskHome, taskId);
  const spec = {
    version: 1 as const, name: "MCP receipts integration seed",
    project: sourceDir, goal: "Seed a task for receipt tests",
    provider: { name: "deepseek" as const, model: "deepseek-v4-flash",
      keychainService: "forklight.deepseek.api-key" },
    runtime: { name: "claude-code" as const, executable: "claude",
      effort: "low" as const, maxBudgetUsd: 0.1 },
    workspace: { exclude: [".git", "node_modules"] },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
    constraints: [], acceptance: { commands: ["true"] },
  };
  await prepareWorkspace(spec, paths);
  await writeFile(path.join(paths.workspace, "readme.md"), "# hello\n\nChanged text.\n");
  await writeWorkspacePatchReport(paths, createPathPolicy(spec));
  const startedAt = new Date().toISOString();
  const task: TaskRecord = {
    id: taskId, name: spec.name, status,
    sourcePath: sourceDir, taskFile: "/nonexistent/task.yaml",
    spec, paths, sessionId: "test-session",
    createdAt: startedAt, updatedAt: startedAt, startedAt,
    ...(status !== "queued" && status !== "preparing" ? { finishedAt: startedAt } : {}),
    ...(status === "failed" ? { error: "seed-failure-marker-9999" } : {}),
  };
  return { task };
}

function persistTaskInHome(home: string, task: TaskRecord, attemptId?: string): void {
  withStore(home, (s) => {
    s.createTask(task);
    if (attemptId !== undefined) {
      s.createAttempt({
        id: attemptId, taskId: task.id, ordinal: 1, status: "succeeded",
        sessionId: task.sessionId, rawLogPath: "/log",
        startedAt: task.createdAt, finishedAt: task.createdAt,
        exitCode: 0, costUsd: 0.1,
      });
    }
  });
}

function assertMayOverlap(r: OrchestrationExchangeReceipt): void {
  assert.equal(r.responseRelationship, "may-overlap");
  assert.equal(r.requestArguments.direction, "request");
  assert.ok(r.responseContent !== undefined);
  assert.ok(r.responseStructured !== undefined);
  assert.equal(r.responseContent!.direction, "response");
  assert.equal(r.responseStructured!.direction, "response");
  assert.equal(r.requestArguments.timestamp, r.capturedAt);
  assert.equal(r.responseContent!.timestamp, r.capturedAt);
  assert.equal(r.responseStructured!.timestamp, r.capturedAt);
  assert.notEqual(r.responseContent, r.responseStructured);
}

function captureStderr(): { captured: string[]; restore: () => void } {
  const captured: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: typeof originalWrite }).write =
    ((chunk: unknown) => {
      if (typeof chunk === "string") captured.push(chunk);
      return true;
    }) as typeof originalWrite;
  return { captured, restore: () => {
    (process.stderr as unknown as { write: typeof originalWrite }).write = originalWrite;
  } };
}

const FORBIDDEN_FIELDS = ["text", "content", "prompt", "body", "payload", "raw",
  "secret", "hash", "diff", "feedback"];

function assertNoForbiddenFields(r: OrchestrationExchangeReceipt): void {
  for (const f of FORBIDDEN_FIELDS) {
    assert.equal(f in r, false, `receipt must not carry field "${f}"`);
  }
}

// --- Acceptance tests ------------------------------------------------------

test("forklight_submit persists one success receipt under the returned Task id with no raw contract text", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-receipt-submit-"));
  const { client, close } = await connectMcp(home);
  try {
    const submit = await client.callTool({
      name: "forklight_submit", arguments: submitArgs(home, SECRET_PROBE),
    });
    assert.equal(submit.isError, undefined);
    const taskId = (submit.structuredContent as Record<string, unknown>).taskId as string;
    assert.ok(taskId);
    const receipts = listReceipts(home, taskId);
    assert.equal(receipts.length, 1);
    const r = receipts[0]!;
    assert.equal(r.transport, "mcp");
    assert.equal(r.operation, "forklight_submit");
    assert.equal(r.outcome, "success");
    assertMayOverlap(r);
    assert.ok(r.requestArguments.utf8Bytes > 0);
    // Privacy is asserted against the canonical receipt — the raw SQLite
    // file legitimately contains the persisted Task Contract in the
    // tasks table, which is by design.
    assert.ok(!JSON.stringify(r).includes(SECRET_PROBE),
      "canonical receipt must not contain synthetic secret");
    assertNoForbiddenFields(r);
  } finally { await close(); }
});

test("forklight_status, forklight_inspect, and forklight_resume emit success receipts with may-overlap dual response surfaces", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-receipt-read-"));
  // Seed an eligible-resume failed Task with 0 attempts so resume succeeds.
  const { task } = await seedTaskWithDiff(home, "failed");
  persistTaskInHome(home, task);

  const { client, close } = await connectMcp(home);
  try {
    await client.callTool({ name: "forklight_status", arguments: { taskId: task.id } });
    await client.callTool({ name: "forklight_inspect", arguments: { taskId: task.id } });
    await client.callTool({ name: "forklight_resume", arguments: { taskId: task.id } });
    const receipts = listReceipts(home, task.id);
    assert.equal(receipts.length, 3);
    assert.deepEqual(receipts.map((r) => r.operation).sort(),
      ["forklight_inspect", "forklight_resume", "forklight_status"]);
    for (const r of receipts) {
      assert.equal(r.outcome, "success");
      assertMayOverlap(r);
    }
    // may-overlap: dual surfaces are detached measurements, never summed.
    const status = receipts.find((r) => r.operation === "forklight_status")!;
    assert.ok(status.responseContent!.utf8Bytes > 0);
    assert.ok(status.responseStructured!.utf8Bytes > 0);
  } finally { await close(); }
});

test("forklight_integration_preflight, forklight_integration_apply, and forklight_integration_history emit success receipts", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-receipt-int-"));
  const { task } = await seedTaskWithDiff(home);
  const attemptId = `${task.id}-1`;
  persistTaskInHome(home, task, attemptId);
  withStore(home, (store) => {
    store.addEvent(
      task.id,
      attemptId,
      "verification.completed",
      "Independent verification passed",
      { passed: true },
    );
    recordMainReview(store, task.id, {
      decision: "accept",
      reason: "Receipt test approval",
      confirm: true,
    });
  });

  const { client, close } = await connectMcp(home);
  try {
    const pf = await client.callTool({
      name: "forklight_integration_preflight", arguments: { taskId: task.id },
    });
    const receipt = pf.structuredContent as IntegrationReceiptRecord;
    const apply = await client.callTool({
      name: "forklight_integration_apply",
      arguments: { taskId: task.id, receiptId: receipt.id, confirm: true },
    });
    assert.equal(apply.isError, undefined);
    await client.callTool({
      name: "forklight_integration_history", arguments: { taskId: task.id },
    });
    const receipts = listReceipts(home, task.id);
    assert.deepEqual(receipts.map((r) => r.operation).sort(), [
      "forklight_integration_apply",
      "forklight_integration_history",
      "forklight_integration_preflight",
    ]);
    for (const r of receipts) assertMayOverlap(r);
  } finally { await close(); }
});

test("known-task MCP error preserves original error identity and records count-only responseContent receipt", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-receipt-err-"));
  const { task } = await seedTaskWithDiff(home);
  // Succeeded tasks cannot resume, so this triggers a known-task error.
  persistTaskInHome(home, task, `${task.id}-1`);

  const { client, close } = await connectMcp(home);
  try {
    const result = await client.callTool({
      name: "forklight_resume", arguments: { taskId: task.id },
    });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.match(content[0]!.text, /cannot resume from status succeeded/);
    const errReceipt = listReceipts(home, task.id).find((r) => r.outcome === "error");
    assert.ok(errReceipt !== undefined, "known-task failure must record outcome error");
    assert.equal(errReceipt!.responseRelationship, "may-overlap");
    assert.equal(errReceipt!.requestArguments.direction, "request");
    assert.ok(errReceipt!.responseContent !== undefined,
      "error receipt must carry count-only responseContent measurement");
    assert.equal(errReceipt!.responseContent!.direction, "response");
    assert.equal(errReceipt!.responseStructured, undefined);
    assert.ok(errReceipt!.responseContent!.utf8Bytes > 0);
    assert.equal(errReceipt!.responseContent!.timestamp, errReceipt!.capturedAt);
    const serialised = JSON.stringify(errReceipt);
    assert.ok(!serialised.includes("cannot resume from status"),
      "error receipt must not echo daemon error message");
    assert.ok(!serialised.includes(SECRET_PROBE),
      "error receipt must not echo synthetic secret");
  } finally { await close(); }
});

test("direct wrapper: retained Error rethrows with strict identity and records count-only error receipt", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-receipt-directerr-"));
  const { task } = await seedTaskWithDiff(home);
  persistTaskInHome(home, task, `${task.id}-1`);

  const retained = new Error("synthetic-direct-error-marker-XYZ-7777");
  let caught: unknown;
  try {
    await withMcpExchangeReceipt({
      operation: "forklight_status", home, args: { taskId: task.id }, taskId: task.id,
      invoke: async () => { throw retained; },
    });
    assert.fail("wrapper must rethrow the retained error");
  } catch (error) { caught = error; }
  assert.equal(caught, retained, "wrapper must rethrow the exact retained error object");

  const errReceipt = listReceipts(home, task.id).find((r) => r.outcome === "error");
  assert.ok(errReceipt !== undefined);
  assert.equal(errReceipt!.responseRelationship, "may-overlap");
  assert.equal(errReceipt!.requestArguments.direction, "request");
  assert.ok(errReceipt!.responseContent !== undefined);
  assert.equal(errReceipt!.responseContent!.direction, "response");
  assert.equal(errReceipt!.responseStructured, undefined);
  assert.ok(errReceipt!.responseContent!.utf8Bytes > 0);
  const serialised = JSON.stringify(errReceipt);
  assert.ok(!serialised.includes("synthetic-direct-error-marker-XYZ-7777"));
  assert.ok(!serialised.includes(SECRET_PROBE));
});

test("submit failure before attribution produces no receipt and rethrows the exact original error", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-receipt-unattr-"));
  const original = new Error("synthetic-submit-failure-marker-9876");
  let caught: unknown;
  try {
    await withMcpExchangeReceipt({
      operation: "forklight_submit", home,
      args: { project: home, name: "x" },
      taskId: () => undefined,
      invoke: async () => { throw original; },
    });
    assert.fail("wrapper must rethrow the original submit error");
  } catch (error) { caught = error; }
  assert.equal(caught, original, "wrapper must rethrow the exact original error object");
  withStore(home, (s) => {
    assert.equal(s.listTasks().length, 0);
    assert.equal(s.listExchangeReceipts("any-unknown-task").length, 0);
  });
});

test("multiple ordered receipts on the same Task follow capturedAt then id ordering", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-receipt-order-"));
  const { task } = await seedTaskWithDiff(home);
  persistTaskInHome(home, task, `${task.id}-1`);

  const { client, close } = await connectMcp(home);
  try {
    await client.callTool({ name: "forklight_status", arguments: { taskId: task.id } });
    await client.callTool({ name: "forklight_status", arguments: { taskId: task.id } });
    await client.callTool({ name: "forklight_inspect", arguments: { taskId: task.id } });
    await client.callTool({ name: "forklight_status", arguments: { taskId: task.id } });
    const receipts = listReceipts(home, task.id);
    assert.equal(receipts.length, 4);
    for (let i = 1; i < receipts.length; i++) {
      assert.ok(receipts[i - 1]!.capturedAt <= receipts[i]!.capturedAt,
        "receipts must be ordered by capturedAt");
    }
    const ids = new Set(receipts.map((r) => r.id));
    assert.equal(ids.size, 4, "every receipt must have a unique id");
    const ops = receipts.map((r) => r.operation);
    assert.equal(ops.filter((o) => o === "forklight_status").length, 3);
    assert.equal(ops.filter((o) => o === "forklight_inspect").length, 1);
  } finally { await close(); }
});

test("fail-open: when receipt storage is unavailable, the original MCP result is unchanged and no receipt is added", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-receipt-failopen-"));
  const { task } = await seedTaskWithDiff(home);
  persistTaskInHome(home, task, `${task.id}-1`);

  const { client, close } = await connectMcp(home);
  try {
    await client.callTool({ name: "forklight_status", arguments: { taskId: task.id } });
    const baseline = listReceipts(home, task.id).length;
    assert.ok(baseline >= 1);

    // Make the receipt store unavailable for new connections. The daemon's
    // existing connection retains open fds; new StateStore connections are
    // denied write access.
    const dbPath = path.join(home, "forklight.sqlite");
    for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      try { chmodSync(p, 0o444); } catch { /* ignore */ }
    }
    const { captured, restore } = captureStderr();
    try {
      const result = await client.callTool({
        name: "forklight_status", arguments: { taskId: task.id },
      });
      assert.equal(result.isError, undefined,
        "original MCP result must remain a success even when receipt capture fails");
      const sc = result.structuredContent as Record<string, unknown>;
      assert.equal(sc.taskId, task.id);
      assert.equal(sc.status, "succeeded");
      const warnings = captured.filter((line) => line.includes("exchange receipt capture failed"));
      assert.ok(warnings.length >= 1, "fail-open must emit the fixed stderr warning");
      for (const line of warnings) {
        assert.ok(!line.includes(SECRET_PROBE), `warning must not echo synthetic secret: ${line}`);
        assert.ok(!line.includes(task.id), `warning must not echo task id: ${line}`);
      }
    } finally {
      restore();
      for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
        try { chmodSync(p, 0o644); } catch { /* ignore */ }
      }
    }
    assert.equal(listReceipts(home, task.id).length, baseline,
      "fail-open must not persist a partial receipt");
  } finally { await close(); }
});

test("fail-open: capture serialization failure does not fabricate a zero-byte measurement and emits only the fixed warning", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-receipt-serial-"));
  const { task } = await seedTaskWithDiff(home);
  persistTaskInHome(home, task, `${task.id}-1`);

  // Circular structure forces JSON.stringify to throw.
  const circular: Record<string, unknown> = {};
  circular.self = circular;

  const { captured, restore } = captureStderr();
  try {
    const result = await withMcpExchangeReceipt({
      operation: "forklight_status", home, args: circular, taskId: task.id,
      invoke: async () => ({
        content: [{ type: "text", text: "ok" }], structuredContent: { ok: true },
      }),
    });
    const sc = (result as { structuredContent: Record<string, unknown> }).structuredContent;
    assert.equal(sc.ok, true);
    const warnings = captured.filter((line) => line.includes("exchange receipt capture failed"));
    assert.ok(warnings.length >= 1,
      "serialization failure must trigger the fixed fail-open warning");
    assert.equal(listReceipts(home, task.id).length, 0,
      "serialization failure must not persist a zero-byte receipt");
  } finally { restore(); }
});

// --- Direct Codex capture receipt regressions ---------------------------

const DC_TS = "2026-07-23T12:00:00.000Z";

function dcUsage(): Record<string, unknown> {
  return { type: "turn.completed", usage: { input_tokens: 4000, cached_input_tokens: 1000, cache_write_input_tokens: 0, output_tokens: 500, reasoning_output_tokens: 100 } };
}

function dcMeta(taskId: string, overrides?: Record<string, unknown>): Record<string, unknown> {
  const o = overrides ?? {};
  return { sampleId: o.sampleId ?? `smp-${taskId.slice(0, 8)}`, forklightTaskId: taskId, exactTaskClass: o.exactTaskClass ?? "dc-class", directCodexProfileId: o.directCodexProfileId ?? "dc-profile", directRunRef: o.directRunRef ?? `codex-run:${taskId.slice(0, 8)}`, pairingRef: o.pairingRef ?? `pair:${taskId.slice(0, 8)}`, capturedAt: o.capturedAt ?? DC_TS };
}

async function seedDcTask(home: string, taskId: string, taskClass = "dc-class", profileId = "dc-profile"): Promise<void> {
  const spec = parseTaskSpec({ version: 1 as const, name: `dc-${taskId.slice(0, 8)}`, project: "/tmp/src", goal: "DC receipt test", taskClass, directCodexProfileId: profileId, acceptance: { commands: ["true"] } } as Parameters<typeof parseTaskSpec>[0], "/tmp");
  const record = buildTaskRecord({ spec, taskFile: "/tmp/dc.yaml", home, id: taskId, sessionId: `s-${taskId}`, createdAt: DC_TS });
  withStore(home, (s) => s.createTask(record));
}

test("forklight_direct_codex_capture persists one may-overlap receipt under the canonical sample's forklightTaskId", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-receipt-dccap-"));
  const taskId = randomUUID();
  await seedDcTask(home, taskId);
  const { client, close } = await connectMcp(home);
  try {
    const result = await client.callTool({
      name: "forklight_direct_codex_capture",
      arguments: {
        usage: dcUsage(),
        metadata: dcMeta(taskId),
      },
    });
    assert.equal(result.isError, undefined);
    const sc = result.structuredContent as Record<string, unknown>;
    assert.equal(sc.forklightTaskId, taskId);

    const receipts = listReceipts(home, taskId);
    assert.equal(receipts.length, 1);
    const r = receipts[0]!;
    assert.equal(r.transport, "mcp");
    assert.equal(r.operation, "forklight_direct_codex_capture");
    assert.equal(r.outcome, "success");
    assertMayOverlap(r);
    assertNoForbiddenFields(r);
  } finally { await close(); }
});

test("forklight_direct_codex_inbox, review, preview, and register are unattributed — zero receipts", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-receipt-dcunattr-"));
  const t1 = randomUUID();
  const t2 = randomUUID();
  const t3 = randomUUID();
  await seedDcTask(home, t1);
  await seedDcTask(home, t2);
  await seedDcTask(home, t3);

  const { client, close } = await connectMcp(home);
  try {
    // Capture three samples
    for (const [tid, sid] of [[t1, "s1"], [t2, "s2"], [t3, "s3"]] as const) {
      await client.callTool({
        name: "forklight_direct_codex_capture",
        arguments: {
          usage: dcUsage(),
          metadata: dcMeta(tid, {
            sampleId: sid,
            directRunRef: `codex-run:${sid}`,
            pairingRef: `pair:${sid}`,
          }),
        },
      });
    }

    // Inbox — unattributed
    await client.callTool({
      name: "forklight_direct_codex_inbox",
      arguments: { taskClass: "dc-class", directCodexProfileId: "dc-profile" },
    });

    // Review — unattributed (pair-level)
    await client.callTool({
      name: "forklight_direct_codex_review",
      arguments: {
        confirm: true, sampleId: "s1", decision: "accepted",
        reviewer: "main-codex", reviewedAt: DC_TS, schemaVersion: 1,
      },
    });

    // Preview — unattributed
    await client.callTool({
      name: "forklight_direct_codex_publication_preview",
      arguments: { taskClass: "dc-class", directCodexProfileId: "dc-profile" },
    });

    // Register — unattributed (publication-level)
    await client.callTool({
      name: "forklight_direct_codex_publication_register",
      arguments: {
        confirm: true, method: "paired-v1", confidence: "low",
        createdAt: DC_TS, taskClass: "dc-class", directCodexProfileId: "dc-profile",
      },
    });

    // Only capture receipts exist — inbox, review, preview, register are unattributed
    for (const tid of [t1, t2, t3]) {
      const receipts = listReceipts(home, tid);
      assert.equal(receipts.length, 1, `Task ${tid} should have only its capture receipt`);
      assert.equal(receipts[0]!.operation, "forklight_direct_codex_capture");
    }
  } finally { await close(); }
});

test("forklight_direct_codex_capture duplicate sample fails unattributed — no error receipt", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-receipt-dcerr-"));
  const taskId = randomUUID();
  await seedDcTask(home, taskId);
  const { client, close } = await connectMcp(home);
  try {
    // First capture succeeds — one canonical receipt
    await client.callTool({
      name: "forklight_direct_codex_capture",
      arguments: { usage: dcUsage(), metadata: dcMeta(taskId, { sampleId: "dup-smp", directRunRef: "codex-run:dup1", pairingRef: "pair:dup1" }) },
    });
    // Duplicate sampleId — daemon rejects before canonical sample exists, so unattributed
    const errResult = await client.callTool({
      name: "forklight_direct_codex_capture",
      arguments: { usage: dcUsage(), metadata: dcMeta(taskId, { sampleId: "dup-smp", directRunRef: "codex-run:dup2", pairingRef: "pair:dup2" }) },
    });
    assert.equal(errResult.isError, true);
    const receipts = listReceipts(home, taskId);
    assert.equal(receipts.length, 1, "only the first success capture produces a receipt");
    assert.equal(receipts[0]!.outcome, "success");
    const errText = (errResult.content as Array<{ text: string }>)[0]!.text;
    assert.ok(!errText.includes("dup-smp"), "error must not echo sample identity");
  } finally { await close(); }
});
