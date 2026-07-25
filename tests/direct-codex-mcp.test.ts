// Direct Codex MCP adapter — workflow, privacy, annotation, receipt, isolation,
// confirm-before-mutation, immutability, and Zod-strict tests.
// Uses InMemoryTransport + local daemon; no Provider / Keychain / calibration mutation.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { OrchestrationExchangeReceipt } from "../src/core/token-efficiency.js";
import { buildTaskRecord } from "../src/core/runner.js";
import { parseTaskSpec } from "../src/core/task.js";
import { ForkLightDaemon } from "../src/daemon/server.js";
import { createForkLightMcpServer } from "../src/mcp/server.js";
import { StateStore } from "../src/state/store.js";

const TS = "2026-07-23T12:00:00.000Z";
const DC_CLASS = "edit-task";
const DC_PROFILE = "profileA";

// --- Compact shared fixtures -----------------------------------------------

type TokenOverrides = { inp?: number; cch?: number; cw?: number; out?: number; reas?: number };
function tu(o?: TokenOverrides): Record<string, unknown> {
  return { type: "turn.completed", usage: { input_tokens: o?.inp ?? 4000, cached_input_tokens: o?.cch ?? 1000, cache_write_input_tokens: o?.cw ?? 0, output_tokens: o?.out ?? 500, reasoning_output_tokens: o?.reas ?? 100 } };
}

type MetaOverrides = { sid?: string; tc?: string; pid?: string; ref?: string; pair?: string; ts?: string };
function sm(taskId: string, o?: MetaOverrides): Record<string, unknown> {
  const s = o?.sid ?? `smp-${taskId.slice(0, 8)}`;
  return { sampleId: s, forklightTaskId: taskId, exactTaskClass: o?.tc ?? DC_CLASS, directCodexProfileId: o?.pid ?? DC_PROFILE, directRunRef: o?.ref ?? `codex-run:${s}`, pairingRef: o?.pair ?? `pair:${s}`, capturedAt: o?.ts ?? TS };
}

function seed(home: string, ids: string[], tc = DC_CLASS, pid = DC_PROFILE): void {
  const store = new StateStore(home);
  try {
    for (const id of ids) {
      const spec = parseTaskSpec({ version: 1 as const, name: `dc-${id.slice(0, 8)}`, project: "/tmp/src", goal: "DC MCP test", taskClass: tc, directCodexProfileId: pid, acceptance: { commands: ["true"] } } as Parameters<typeof parseTaskSpec>[0], "/tmp");
      store.createTask(buildTaskRecord({ spec, taskFile: "/tmp/dc.yaml", home, id, sessionId: `s-${id}`, createdAt: TS }));
    }
  } finally { store.close(); }
}

function recv(home: string, taskId: string): OrchestrationExchangeReceipt[] {
  const store = new StateStore(home);
  try { return store.listExchangeReceipts(taskId); } finally { store.close(); }
}

/** Full lifecycle wrapper: temp home → daemon → MCP server → client → callback → teardown. */
async function withDc(fn: (c: Client, h: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(path.join(tmpdir(), "fl-dc-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "fl-dc-test", version: "1.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  try { await fn(client, home); } finally { await client.close(); await server.close(); await daemon.close(); }
}

/** Capture one sample and return structuredContent. Fails the test on error. */
async function cap(client: Client, taskId: string, o?: MetaOverrides): Promise<Record<string, unknown>> {
  const mo: MetaOverrides = { ...o };
  const s = mo.sid ?? `smp-${taskId.slice(0, 8)}`;
  mo.sid = s; mo.ref = mo.ref ?? `codex-run:${s}`; mo.pair = mo.pair ?? `pair:${s}`;
  const r = await client.callTool({ name: "forklight_direct_codex_capture", arguments: { usage: tu(), metadata: sm(taskId, mo) } });
  assert.equal(r.isError, undefined, `capture failed: ${JSON.stringify(r)}`);
  return r.structuredContent as Record<string, unknown>;
}

function sc(r: unknown): Record<string, unknown> {
  return (r as { structuredContent: Record<string, unknown> }).structuredContent;
}
function tx(r: unknown): string {
  return ((r as { content: Array<{ text: string }> }).content[0]!).text;
}
function vs(r: unknown): Record<string, unknown>[] {
  return (sc(r) as { samples: Record<string, unknown>[] }).samples;
}

// --- Tests ------------------------------------------------------------------

test("annotations: inbox/preview readOnly, capture/review/register mutating, all non-destructive", async () => {
  await withDc(async (client) => {
    const tools = (await client.listTools()).tools.filter((t) => t.name.startsWith("forklight_direct_codex_"));
    assert.equal(tools.length, 5);
    const m = new Map(tools.map((t) => [t.name, t.annotations]));
    assert.equal(m.get("forklight_direct_codex_inbox")!.readOnlyHint, true);
    assert.equal(m.get("forklight_direct_codex_publication_preview")!.readOnlyHint, true);
    assert.equal(m.get("forklight_direct_codex_capture")!.readOnlyHint, false);
    assert.equal(m.get("forklight_direct_codex_review")!.readOnlyHint, false);
    assert.equal(m.get("forklight_direct_codex_publication_register")!.readOnlyHint, false);
    for (const [name, a] of m) {
      assert.equal(a!.destructiveHint, false, `${name} destructiveHint must be explicit false`);
      assert.equal(a!.openWorldHint, false, `${name} must be closed-world`);
    }
  });
});

test("output shapes: capture canonical fields, inbox items+reviewStates, preview readiness", async () => {
  await withDc(async (client, home) => {
    const id = randomUUID(); seed(home, [id]);
    const s = await cap(client, id, { sid: "shp" });
    assert.equal(s.sampleId, "shp");
    assert.equal(s.forklightTaskId, id);
    assert.equal(s.exactTaskClass, DC_CLASS);
    assert.equal(s.directCodexProfileId, DC_PROFILE);
    assert.equal(s.source, "codex-terminal-result");
    assert.equal(s.schemaVersion, 1);
    assert.equal(typeof s.inputTokens, "number");
    assert.equal(typeof s.outputTokens, "number");
    for (const raw of ["text", "content", "prompt", "response", "log", "diff", "hash", "secret"]) assert.equal(raw in s, false);

    // Inbox shape
    const items = vs(await client.callTool({ name: "forklight_direct_codex_inbox", arguments: { taskClass: DC_CLASS, directCodexProfileId: DC_PROFILE } }));
    assert.equal(items.length, 1);
    assert.ok(typeof items[0]!.sample === "object");
    assert.ok(["pending", "accepted", "rejected"].includes(items[0]!.reviewState as string));

    // Preview shape
    const p = sc(await client.callTool({ name: "forklight_direct_codex_publication_preview", arguments: { taskClass: DC_CLASS, directCodexProfileId: DC_PROFILE } }));
    assert.equal(p.exactTaskClass, DC_CLASS);
    assert.equal(typeof p.acceptedCount, "number");
    assert.equal(typeof p.rejectedCount, "number");
    assert.equal(typeof p.pendingCount, "number");
    assert.ok(["ready", "no-accepted-samples", "no-new-evidence", "unsafe-version"].includes(p.readiness as string));
  });
});

test("exact-pair isolation: inbox filters by taskClass × directCodexProfileId", async () => {
  await withDc(async (client, home) => {
    const [tA, tB, tC] = [randomUUID(), randomUUID(), randomUUID()];
    seed(home, [tA], "classA", "profX");
    seed(home, [tB], "classA", "profY");
    seed(home, [tC], "classB", "profX");
    await cap(client, tA, { tc: "classA", pid: "profX", sid: "iso-a" });
    await cap(client, tB, { tc: "classA", pid: "profY", sid: "iso-b" });
    await cap(client, tC, { tc: "classB", pid: "profX", sid: "iso-c" });

    assert.equal(vs(await client.callTool({ name: "forklight_direct_codex_inbox", arguments: { taskClass: "classA", directCodexProfileId: "profX" } })).length, 1);
    assert.equal(vs(await client.callTool({ name: "forklight_direct_codex_inbox", arguments: { taskClass: "classA", directCodexProfileId: "profY" } })).length, 1);
    assert.equal(vs(await client.callTool({ name: "forklight_direct_codex_inbox", arguments: { taskClass: "classB", directCodexProfileId: "profX" } })).length, 1);
    assert.deepEqual(vs(await client.callTool({ name: "forklight_direct_codex_inbox", arguments: { taskClass: "classA", directCodexProfileId: "profZ" } })), []);
  });
});

test("full workflow: capture → review → preview → register v1, with receipt attribution", async () => {
  await withDc(async (client, home) => {
    const id = randomUUID(); seed(home, [id]);

    // 1. Capture — only this writes a receipt
    const s = await cap(client, id, { sid: "flow" });
    assert.equal(s.forklightTaskId, id);

    // 2. Inbox shows pending
    let items = vs(await client.callTool({ name: "forklight_direct_codex_inbox", arguments: { taskClass: DC_CLASS, directCodexProfileId: DC_PROFILE } }));
    assert.equal(items.length, 1);
    assert.equal(items[0]!.reviewState, "pending");

    // 3. Review accepted
    const rev = await client.callTool({ name: "forklight_direct_codex_review", arguments: { confirm: true, sampleId: "flow", decision: "accepted", reviewer: "main-codex", reviewedAt: TS, schemaVersion: 1 } });
    assert.equal(rev.isError, undefined);
    assert.equal(sc(rev).decision, "accepted");

    // 4. Inbox reflects accepted
    items = vs(await client.callTool({ name: "forklight_direct_codex_inbox", arguments: { taskClass: DC_CLASS, directCodexProfileId: DC_PROFILE } }));
    assert.equal(items[0]!.reviewState, "accepted");

    // 5. Preview shows ready, nextVersion 1
    let p = sc(await client.callTool({ name: "forklight_direct_codex_publication_preview", arguments: { taskClass: DC_CLASS, directCodexProfileId: DC_PROFILE } }));
    assert.equal(p.readiness, "ready");
    assert.equal(p.nextVersion, 1);
    assert.equal(p.acceptedCount, 1);

    // 6. Register version 1
    const reg = await client.callTool({ name: "forklight_direct_codex_publication_register", arguments: { confirm: true, method: "paired-sample-v1", confidence: "low", createdAt: TS, taskClass: DC_CLASS, directCodexProfileId: DC_PROFILE } });
    assert.equal(reg.isError, undefined);
    const sum = sc(reg).summary as Record<string, unknown>;
    assert.equal(sum.version, 1);
    assert.deepEqual(sum.acceptedSampleIds, ["flow"]);
    assert.ok(typeof sc(reg).publication === "object");

    // 7. Post-register preview: no-new-evidence
    p = sc(await client.callTool({ name: "forklight_direct_codex_publication_preview", arguments: { taskClass: DC_CLASS, directCodexProfileId: DC_PROFILE } }));
    assert.equal(p.readiness, "no-new-evidence");

    // 8. Receipt attribution: only capture wrote a receipt
    const r = recv(home, id);
    assert.equal(r.length, 1);
    assert.equal(r[0]!.operation, "forklight_direct_codex_capture");
    assert.equal(r[0]!.outcome, "success");
    assert.equal(r[0]!.transport, "mcp");
  });
});

test("confirm-before-mutation: review and register reject missing/false confirm, state unchanged", async () => {
  await withDc(async (client, home) => {
    const id = randomUUID(); seed(home, [id]);
    await cap(client, id, { sid: "conf" });

    // Review: missing confirm → error
    assert.equal((await client.callTool({ name: "forklight_direct_codex_review", arguments: { sampleId: "conf", decision: "accepted", reviewer: "main-codex", reviewedAt: TS, schemaVersion: 1 } })).isError, true);
    // Review: false confirm → error
    assert.equal((await client.callTool({ name: "forklight_direct_codex_review", arguments: { confirm: false, sampleId: "conf", decision: "accepted", reviewer: "main-codex", reviewedAt: TS, schemaVersion: 1 } })).isError, true);
    // State unchanged
    assert.equal(vs(await client.callTool({ name: "forklight_direct_codex_inbox", arguments: { taskClass: DC_CLASS, directCodexProfileId: DC_PROFILE } }))[0]!.reviewState, "pending");

    // Register: missing confirm → error
    assert.equal((await client.callTool({ name: "forklight_direct_codex_publication_register", arguments: { method: "v1", confidence: "low", createdAt: TS, taskClass: DC_CLASS, directCodexProfileId: DC_PROFILE } })).isError, true);
    // Register: false confirm → error
    assert.equal((await client.callTool({ name: "forklight_direct_codex_publication_register", arguments: { confirm: false, method: "v1", confidence: "low", createdAt: TS, taskClass: DC_CLASS, directCodexProfileId: DC_PROFILE } })).isError, true);
  });
});

test("Zod-strict rejection + privacy: extra fields rejected, errors never echo content", async () => {
  await withDc(async (client, home) => {
    const id = randomUUID(); seed(home, [id]);
    const priv = "MCP-PRIV-LEAK-9999";

    // Extra in usage → error, no echo
    const r1 = await client.callTool({ name: "forklight_direct_codex_capture", arguments: { usage: { ...tu(), prompt: priv }, metadata: sm(id, { sid: "ex1" }) } });
    assert.equal(r1.isError, true);
    assert.ok(!tx(r1).includes(priv));

    // Extra in metadata → error, no echo
    const r2 = await client.callTool({ name: "forklight_direct_codex_capture", arguments: { usage: tu(), metadata: { ...sm(id, { sid: "ex2" }), text: priv } } });
    assert.equal(r2.isError, true);
    assert.ok(!tx(r2).includes(priv));

    // Extra in inbox args → error
    assert.equal((await client.callTool({ name: "forklight_direct_codex_inbox", arguments: { taskClass: DC_CLASS, directCodexProfileId: DC_PROFILE, raw: "bad" } })).isError, true);

    // Extra in review args → error
    assert.equal((await client.callTool({ name: "forklight_direct_codex_review", arguments: { confirm: true, sampleId: "ex1", decision: "accepted", reviewer: "main-codex", reviewedAt: TS, schemaVersion: 1, text: "bad" } })).isError, true);

    // Malformed usage → error, no echo
    const r5 = await client.callTool({ name: "forklight_direct_codex_capture", arguments: { usage: { type: "turn.completed", usage: { input_tokens: -1, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 } }, metadata: sm(id, { sid: priv }) } });
    assert.equal(r5.isError, true);
    assert.ok(!tx(r5).includes(priv));

    // Unknown-sample review → error, no echo
    const r6 = await client.callTool({ name: "forklight_direct_codex_review", arguments: { confirm: true, sampleId: priv, decision: "accepted", reviewer: "main-codex", reviewedAt: TS, schemaVersion: 1 } });
    assert.equal(r6.isError, true);
    assert.ok(!tx(r6).includes(priv));

    // Unready register → error, no echo
    const r7 = await client.callTool({ name: "forklight_direct_codex_publication_register", arguments: { confirm: true, method: priv, confidence: "low", createdAt: TS, taskClass: DC_CLASS, directCodexProfileId: DC_PROFILE } });
    assert.equal(r7.isError, true);
    assert.ok(!tx(r7).includes(priv));
  });
});

test("review immutability: duplicate review rejected, inbox reflects accepted state", async () => {
  await withDc(async (client, home) => {
    const id = randomUUID(); seed(home, [id]);
    await cap(client, id, { sid: "imm" });

    await client.callTool({ name: "forklight_direct_codex_review", arguments: { confirm: true, sampleId: "imm", decision: "accepted", reviewer: "main-codex", reviewedAt: TS, schemaVersion: 1 } });

    const items = vs(await client.callTool({ name: "forklight_direct_codex_inbox", arguments: { taskClass: DC_CLASS, directCodexProfileId: DC_PROFILE } }));
    assert.equal(items[0]!.reviewState, "accepted");
    assert.ok(typeof items[0]!.review === "object");

    // Duplicate → error with "Review already exists"
    const dup = await client.callTool({ name: "forklight_direct_codex_review", arguments: { confirm: true, sampleId: "imm", decision: "rejected", rejectionReason: "incomplete-evidence", reviewer: "main-codex", reviewedAt: TS, schemaVersion: 1 } });
    assert.equal(dup.isError, true);
    assert.match(tx(dup), /Review already exists/);
  });
});
