import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ProviderModelSummary } from "../src/core/statistics.js";
import type {
  AttemptRecord,
  CompetitionCandidateRecord,
  CompetitionRecord,
  IntegrationReceiptRecord,
  IntegrationResultRecord,
  TaskRecord,
  TaskSpec,
  VerificationResult,
} from "../src/core/types.js";
import { DEFAULT_RANKING_POLICY } from "../src/core/competition.js";
import { taskPaths } from "../src/core/config.js";
import { ForkLightDaemon } from "../src/daemon/server.js";
import { daemonRequest } from "../src/daemon/client.js";
import { createForkLightMcpServer } from "../src/mcp/server.js";
import { StateStore } from "../src/state/store.js";
import { prepareWorkspace } from "../src/workspace/copy.js";
import { createPathPolicy } from "../src/workspace/path-policy.js";
import { writeWorkspacePatchReport } from "../src/workspace/patch.js";
import { recordMainReview } from "../src/core/main-review.js";

test("MCP exposes ForkLight tools and reaches the daemon", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-"));
  const daemon = new ForkLightDaemon(home, 1);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      [
        "forklight_compete_submit",
        "forklight_competition_compare",
        "forklight_competition_list",
        "forklight_competition_status",
        "forklight_direct_codex_capture",
        "forklight_direct_codex_inbox",
        "forklight_direct_codex_publication_preview",
        "forklight_direct_codex_publication_register",
        "forklight_direct_codex_review",
        "forklight_health",
        "forklight_inspect",
        "forklight_integration_apply",
        "forklight_integration_history",
        "forklight_integration_preflight",
        "forklight_integration_status",
        "forklight_integration_wait",
        "forklight_list",
        "forklight_main_review",
        "forklight_plan_board",
        "forklight_plan_inspect",
        "forklight_plan_submit",
        "forklight_provider_probe",
        "forklight_provider_status",
        "forklight_resume",
        "forklight_settings_get",
        "forklight_settings_reset",
        "forklight_settings_update",
        "forklight_statistics",
        "forklight_status",
        "forklight_submit",
        "forklight_validate",
      ],
    );
    const health = await client.callTool({ name: "forklight_health", arguments: {} });
    assert.equal(health.isError, undefined);
    assert.equal((health.structuredContent as { ok?: boolean } | undefined)?.ok, true);
    const healthData = health.structuredContent as {
      identityStatus?: string;
      mcpBuildIdentity?: { protocolVersion?: number; buildId?: string };
      daemonBuildIdentity?: { protocolVersion?: number; buildId?: string };
    };
    assert.equal(healthData.identityStatus, "matched");
    assert.equal(
      healthData.mcpBuildIdentity?.protocolVersion,
      healthData.daemonBuildIdentity?.protocolVersion,
    );
    assert.equal(
      healthData.mcpBuildIdentity?.buildId,
      healthData.daemonBuildIdentity?.buildId,
    );
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

// --- Competition contract tests ---

type CompProvider = TaskSpec["provider"]["name"];

function taskPathsFor(id: string): TaskRecord["paths"] {
  return { root: `/r/${id}`, baseline: `/r/${id}/base`, workspace: `/r/${id}/ws`, logs: `/r/${id}/log`, claudeConfig: `/r/${id}/cc`, diff: `/r/${id}/d.patch` };
}

function compTask(store: StateStore, id: string, provider: CompProvider, model: string, status: TaskRecord["status"]): TaskRecord {
  const now = new Date().toISOString();
  const task: TaskRecord = {
    id, name: `cand-${provider}/${model}`, status, sourcePath: "/src", taskFile: "/t.yaml", sessionId: `s-${id}`,
    spec: { version: 1 as const, name: `sp-${id}`, project: "/src", provider: { name: provider, model, keychainService: `forklight.${provider}.test-key` }, runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: 1 }, workspace: { exclude: [] }, worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] }, goal: "Test", constraints: [], acceptance: { commands: ["true"] } },
    paths: taskPathsFor(id), createdAt: now, updatedAt: now,
    ...(status === "queued" || status === "preparing" ? {} : { startedAt: now }),
    ...(status === "succeeded" || status === "failed" ? { finishedAt: now } : {}),
  };
  store.createTask(task);
  return store.getTask(id);
}

function compAttempt(store: StateStore, taskId: string, ordinal = 1, costUsd = 0.2): AttemptRecord {
  const now = new Date().toISOString();
  const attempt: AttemptRecord = { id: `${taskId}-${ordinal}`, taskId, ordinal, status: "succeeded", sessionId: `s-${taskId}`, rawLogPath: "/log", startedAt: now, finishedAt: now, exitCode: 0, costUsd };
  store.createAttempt(attempt);
  return attempt;
}

const verificationEvidence = {
  passed: true,
  behaviorPassed: true,
  policyPassed: true,
  sourceCompatible: true,
  commands: [{ command: "true", exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false }],
  diffPath: "/d",
  sourceUnchanged: true,
  changeBudget: { filesChanged: 1, changedLines: 10, maxFiles: 10, maxDiffLines: 200, withinBudget: true },
};

function seedRunningCompetition(store: StateStore, compId: string): void {
  const now = new Date().toISOString();
  const comp: CompetitionRecord = { id: compId, name: "Running comp", contractTaskId: `${compId}-a`, status: "running", rankingPolicy: DEFAULT_RANKING_POLICY, createdAt: now, updatedAt: now };
  compTask(store, `${compId}-a`, "deepseek", "v4", "succeeded");
  compTask(store, `${compId}-b`, "minimax", "m3", "queued");
  const c: CompetitionCandidateRecord[] = [
    { id: `${compId}-ca`, competitionId: compId, taskId: `${compId}-a`, ordinal: 0, providerName: "deepseek", modelName: "v4" },
    { id: `${compId}-cb`, competitionId: compId, taskId: `${compId}-b`, ordinal: 1, providerName: "minimax", modelName: "m3" },
  ];
  store.createCompetition(comp, c);
}

function seedCompletedCompetition(store: StateStore, compId: string): void {
  const now = new Date().toISOString();
  const comp: CompetitionRecord = { id: compId, name: "Done comp", contractTaskId: `${compId}-1`, status: "completed", rankingPolicy: { ...DEFAULT_RANKING_POLICY, tieThreshold: 0.25 }, createdAt: now, updatedAt: now };
  for (const tid of [`${compId}-1`, `${compId}-2`]) {
    compTask(store, tid, tid === `${compId}-1` ? "deepseek" : "minimax", tid === `${compId}-1` ? "v4" : "m3", "succeeded");
    const att = compAttempt(store, tid);
    store.addEvent(tid, att.id, "verification.completed", "ok", verificationEvidence);
  }
  const c: CompetitionCandidateRecord[] = [
    { id: `${compId}-c1`, competitionId: compId, taskId: `${compId}-1`, ordinal: 0, providerName: "deepseek", modelName: "v4" },
    { id: `${compId}-c2`, competitionId: compId, taskId: `${compId}-2`, ordinal: 1, providerName: "minimax", modelName: "m3" },
  ];
  store.createCompetition(comp, c);
}

async function connectCompetitionClient(home: string): Promise<{ client: Client; server: ReturnType<typeof createForkLightMcpServer>; daemon: ForkLightDaemon; close: () => Promise<void> }> {
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, server, daemon, close: async () => { await client.close(); await server.close(); await daemon.close(); } };
}

test("running competition status/list shows progress, no premature evaluation, and is read-only", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-comp-run-"));
  { const store = new StateStore(home); seedRunningCompetition(store, "cr"); store.close(); }
  const { client, close } = await connectCompetitionClient(home);
  try {
    const st = (await client.callTool({ name: "forklight_competition_status", arguments: { competitionId: "cr" } })).structuredContent as Record<string, unknown>;
    const pr = st.progress as Record<string, number>;
    assert.equal(pr.terminal, 1); assert.equal(pr.total, 2);
    assert.equal((st.competition as Record<string, unknown>).status, "running");
    assert.equal(st.evaluation, undefined); // no premature winner

    const lst = (await client.callTool({ name: "forklight_competition_list", arguments: {} })).structuredContent as { competitions?: Array<Record<string, unknown>> };
    assert.equal(lst.competitions?.length, 1);
    assert.equal((lst.competitions![0]!.progress as Record<string, number>).terminal, 1);

    // Read-only: repeated reads do not change evaluation count or competition status
    await client.callTool({ name: "forklight_competition_status", arguments: { competitionId: "cr" } });
    await client.callTool({ name: "forklight_competition_list", arguments: {} });
    const recheck = new StateStore(home);
    assert.equal(recheck.listCompetitionEvaluations("cr").length, 0);
    assert.equal(recheck.getCompetition("cr").status, "running");
    recheck.close();
  } finally { await close(); }
});

test("completed competition compare + status: zero-weight evidence, override ephemeral, idempotent reads", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-comp-done-"));
  {
    const store = new StateStore(home);
    seedCompletedCompetition(store, "cd");
    const { CompetitionService } = await import("../src/core/competition.js");
    new CompetitionService(store).scoreWithPolicy("cd", DEFAULT_RANKING_POLICY);
    store.close();
  }
  const { client, close } = await connectCompetitionClient(home);
  try {
    // Status returns stored evaluation
    const st = (await client.callTool({ name: "forklight_competition_status", arguments: { competitionId: "cd" } })).structuredContent as Record<string, unknown>;
    const ev = st.evaluation as Record<string, unknown>;
    assert.ok(ev !== undefined);
    const sc = ev.candidates as Array<Record<string, unknown>>;
    assert.equal(sc.length, 2);
    assert.ok(sc.every((c) => c.eligible));
    // Zero-weight evidence is visible
    const factors = sc[0]!.factors as Array<Record<string, unknown>>;
    const dur = factors.find((f) => f.factor === "duration")!;
    assert.equal(dur.weight, 0); // speed-neutral default
    assert.ok(typeof dur.evidence === "string" && dur.evidence.length > 0); // evidence present

    // Compare with override: ephemeral, uses override weights
    const cmp = (await client.callTool({ name: "forklight_competition_compare", arguments: { competitionId: "cd", rankingWeights: { duration: 0.8 } } })).structuredContent as Record<string, unknown>;
    const cmpEv = cmp.evaluation as Record<string, unknown>;
    const cmpPol = cmpEv.policy as Record<string, unknown>;
    assert.equal((cmpPol.weights as Record<string, number>).duration, 0.8);
    assert.equal(cmpPol.tieThreshold, 0.25);

    // Default compare returns stored evaluation
    const defCmp = (await client.callTool({ name: "forklight_competition_compare", arguments: { competitionId: "cd" } })).structuredContent as Record<string, unknown>;
    assert.equal((defCmp.evaluation as Record<string, unknown>).id, ev.id);

    // Read-only: evaluation count unchanged after all reads
    const recheck = new StateStore(home);
    const beforeLen = recheck.listCompetitionEvaluations("cd").length;
    assert.ok(beforeLen >= 1);
    await client.callTool({ name: "forklight_competition_status", arguments: { competitionId: "cd" } });
    await client.callTool({ name: "forklight_competition_compare", arguments: { competitionId: "cd" } });
    assert.equal(recheck.listCompetitionEvaluations("cd").length, beforeLen);
    recheck.close();
  } finally { await close(); }
});

// --- Integration tool helpers ---

function integrationSpec(project: string): TaskSpec {
  return {
    version: 1,
    name: "MCP integration test",
    project,
    goal: "Prove integration controls",
    constraints: [],
    provider: {
      name: "deepseek",
      model: "deepseek-v4-flash",
      keychainService: "forklight.deepseek.api-key",
    },
    runtime: {
      name: "claude-code",
      executable: "claude",
      effort: "low",
      maxBudgetUsd: 0.1,
    },
    workspace: { exclude: [".git", "node_modules"] },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
    acceptance: { commands: ["true"] },
  };
}

async function seedSucceededTask(
  store: StateStore,
  home: string,
  withAcceptedMainReview = true,
): Promise<{ task: TaskRecord; sourceDir: string }> {
  const sourceDir = path.join(home, "source");
  const taskHome = path.join(home, "state");
  const taskId = randomUUID();
  await mkdir(sourceDir);
  await writeFile(path.join(sourceDir, "readme.md"), "# hello\n\nOriginal text.\n");
  await writeFile(path.join(sourceDir, "other.txt"), "Unrelated.\n");

  const paths = taskPaths(taskHome, taskId);
  const taskSpec = integrationSpec(sourceDir);
  await prepareWorkspace(taskSpec, paths);

  // Simulate worker edit in workspace
  await writeFile(
    path.join(paths.workspace, "readme.md"),
    "# hello\n\nChanged text.\n",
  );
  await writeWorkspacePatchReport(paths, createPathPolicy(taskSpec));

  const task: TaskRecord = {
    id: taskId,
    name: taskSpec.name,
    status: "succeeded",
    sourcePath: sourceDir,
    taskFile: "/nonexistent/task.yaml",
    spec: taskSpec,
    paths,
    sessionId: "test-session",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.createTask(task);
  const attempt = compAttempt(store, task.id);
  const storedAttempt = store.getAttempt(attempt.id);
  store.updateTask(task.id, { currentAttemptId: storedAttempt.id });
  const verification: VerificationResult = {
    passed: true,
    behaviorPassed: true,
    policyPassed: true,
    sourceCompatible: true,
    commands: [{
      command: "true",
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
      timedOut: false,
    }],
    diffPath: paths.diff,
    sourceUnchanged: true,
  };
  store.addEvent(
    task.id,
    storedAttempt.id,
    "verification.completed",
    "Independent verification passed",
    verification,
  );
  if (withAcceptedMainReview) {
    recordMainReview(store, task.id, {
      decision: "accept",
      reason: "MCP Integration fixture independently verified",
      confirm: true,
    });
  }
  return { task: store.getTask(task.id), sourceDir };
}

test("MCP records Main Codex review but does not claim Integration authority", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-main-review-"));
  const store = new StateStore(home);
  const { task } = await seedSucceededTask(store, home, false);
  store.close();
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tool = (await client.listTools()).tools
      .find((candidate) => candidate.name === "forklight_main_review");
    assert.equal(tool?.annotations?.readOnlyHint, false);
    assert.equal(tool?.annotations?.destructiveHint, false);
    assert.equal(tool?.annotations?.openWorldHint, false);

    const result = await client.callTool({
      name: "forklight_main_review",
      arguments: {
        taskId: task.id,
        decision: "accept",
        reason: "Independent verification and scoped Diff reviewed",
        confirm: true,
      },
    });
    assert.equal(
      (result.structuredContent as { decision?: string }).decision,
      "accept",
    );
    const content = Array.isArray(result.content) ? result.content : [];
    const first = content[0] as { type?: string; text?: string } | undefined;
    assert.match(
      first?.type === "text" ? first.text ?? "" : "",
      /Integration is still separately authorized/,
    );
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP integration preflight persists audit receipt and is source-safe", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-intpf-"));
  const store = new StateStore(home);
  const { task, sourceDir } = await seedSucceededTask(store, home);
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    // --- preflight produces a receipt without mutating source ---
    const before = await readFile(path.join(sourceDir, "readme.md"), "utf8");
    const pf = await client.callTool({
      name: "forklight_integration_preflight",
      arguments: { taskId: task.id },
    });
    assert.equal(pf.isError, undefined);
    const receipt = pf.structuredContent as IntegrationReceiptRecord;
    assert.equal(receipt.rejectionReasons.length, 0);
    assert.ok(receipt.affectedFiles.includes("readme.md"));
    assert.ok(receipt.patchDigest.length > 0);
    assert.ok(receipt.id.length > 0);

    // Source unchanged
    const after = await readFile(path.join(sourceDir, "readme.md"), "utf8");
    assert.equal(after, before);

    // --- repeated preflight returns fresh receipt, source still unchanged ---
    const pf2 = await client.callTool({
      name: "forklight_integration_preflight",
      arguments: { taskId: task.id },
    });
    assert.equal(pf2.isError, undefined);
    const receipt2 = pf2.structuredContent as IntegrationReceiptRecord;
    // New receipt has a distinct ID but same evidence
    assert.notEqual(receipt2.id, receipt.id);
    assert.deepEqual(receipt2.affectedFiles, receipt.affectedFiles);
    assert.equal(await readFile(path.join(sourceDir, "readme.md"), "utf8"), before);
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP integration apply requires confirm: true and mutates source", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-intapply-"));
  const store = new StateStore(home);
  const { task, sourceDir } = await seedSucceededTask(store, home);
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const pf = await client.callTool({
      name: "forklight_integration_preflight",
      arguments: { taskId: task.id },
    });
    const receipt = pf.structuredContent as IntegrationReceiptRecord;
    assert.equal(receipt.rejectionReasons.length, 0);

    const before = await readFile(path.join(sourceDir, "readme.md"), "utf8");
    assert.match(before, /Original text/);

    const result = await client.callTool({
      name: "forklight_integration_apply",
      arguments: { taskId: task.id, receiptId: receipt.id, confirm: true },
    });
    assert.equal(result.isError, undefined);
    const apply = result.structuredContent as {
      operationId: string;
      status: string;
    };
    assert.equal(apply.status, "running");
    const waited = await client.callTool({
      name: "forklight_integration_wait",
      arguments: { operationId: apply.operationId, timeoutMs: 5_000 },
    });
    const final = waited.structuredContent as {
      status: string;
      result: IntegrationResultRecord;
    };
    assert.equal(final.status, "completed");
    assert.equal(final.result.status, "applied");

    // Source is mutated
    const after = await readFile(path.join(sourceDir, "readme.md"), "utf8");
    assert.match(after, /Changed text/);
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP integration history returns receipts and results read-only", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-inthist-"));
  const store = new StateStore(home);
  const { task, sourceDir } = await seedSucceededTask(store, home);
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    // Apply to generate history records
    const pf = await client.callTool({
      name: "forklight_integration_preflight",
      arguments: { taskId: task.id },
    });
    const receipt = pf.structuredContent as IntegrationReceiptRecord;
    const applied = await client.callTool({
      name: "forklight_integration_apply",
      arguments: { taskId: task.id, receiptId: receipt.id, confirm: true },
    });
    const operationId = (applied.structuredContent as { operationId: string }).operationId;
    await client.callTool({
      name: "forklight_integration_wait",
      arguments: { operationId, timeoutMs: 5_000 },
    });

    const before = await readFile(path.join(sourceDir, "readme.md"), "utf8");

    // --- history is read-only, returns both receipts and results ---
    const hist = await client.callTool({
      name: "forklight_integration_history",
      arguments: { taskId: task.id },
    });
    assert.equal(hist.isError, undefined);
    const h = hist.structuredContent as { receipts: unknown[]; results: unknown[] };
    assert.ok(h.results.length >= 1, "should have at least one result");
    assert.ok(h.receipts.length >= 1, "should reference at least one receipt");

    // Source unchanged by history read
    assert.equal(await readFile(path.join(sourceDir, "readme.md"), "utf8"), before);

    // --- repeated history returns identical structure ---
    const hist2 = await client.callTool({
      name: "forklight_integration_history",
      arguments: { taskId: task.id },
    });
    const h2 = hist2.structuredContent as { receipts: unknown[]; results: unknown[] };
    assert.equal(h2.results.length, h.results.length);
    assert.equal(h2.receipts.length, h.receipts.length);
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP settings get returns complete effective settings", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-setget-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name: "forklight_settings_get", arguments: {} });
    assert.equal(result.isError, undefined);
    const s = result.structuredContent as Record<string, unknown>;
    assert.equal(s.version, 1);
    assert.equal((s.execution as Record<string, unknown>).maxConcurrency, 2);
    assert.equal((s.execution as Record<string, unknown>).defaultProvider, "deepseek");
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP settings update applies patch and reads back", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-setpatch-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const update = await client.callTool({
      name: "forklight_settings_update",
      arguments: {
        patch: { competition: { rankingWeights: { duration: 0.7 } } },
      },
    });
    assert.equal(update.isError, undefined);
    const u = update.structuredContent as Record<string, unknown>;
    const rw = ((u.competition as Record<string, unknown>).rankingWeights as Record<string, number>);
    assert.equal(rw.duration, 0.7);
    assert.equal(rw.verification, 1);

    // Read back confirms persistence
    const get = await client.callTool({ name: "forklight_settings_get", arguments: {} });
    const g = get.structuredContent as Record<string, unknown>;
    const grw = ((g.competition as Record<string, unknown>).rankingWeights as Record<string, number>);
    assert.equal(grw.duration, 0.7);
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP settings rejects invalid patch atomically", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-setinvalid-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    // Set a valid value first
    await client.callTool({
      name: "forklight_settings_update",
      arguments: { patch: { execution: { maxConcurrency: 5 } } },
    });

    // Attempt invalid update — should fail
    const fail = await client.callTool({
      name: "forklight_settings_update",
      arguments: { patch: { execution: { maxConcurrency: -1 } } },
    });
    assert.equal(fail.isError, true);

    // State unchanged
    const get = await client.callTool({ name: "forklight_settings_get", arguments: {} });
    const s = get.structuredContent as Record<string, unknown>;
    assert.equal((s.execution as Record<string, unknown>).maxConcurrency, 5);
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP submit uses effective defaults but explicit provider wins", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-defprov-"));
  // Pre-configure settings so that defaultProvider is deepseek but submit says minimax
  const store = new StateStore(home);
  const { SettingsService } = await import("../src/core/settings.js");
  const svc = new SettingsService(store);
  svc.update({ execution: { defaultProvider: "deepseek", defaultEffort: "medium" } });
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    // Submit with explicit provider=minimax; settings default is deepseek
    const submit = await client.callTool({
      name: "forklight_submit",
      arguments: {
        project: home,
        name: "explicit-provider-test",
        provider: "minimax",
        contract: {
          outcome: "Verify explicit provider wins",
          context: ["Test"],
          inScope: ["Test"],
          outOfScope: ["Nothing"],
          executionSteps: ["Run test"],
          deliverables: ["Result"],
          modules: [{ name: "m", responsibility: "test module stuff", consumes: ["x"], produces: ["y"], boundaries: ["z"] }],
          callChain: ["A -> B", "B -> C"],
          scenarios: [{ name: "s1", given: "x", when: "y", then: "z" }, { name: "s2", given: "a", when: "b", then: "c" }],
          risks: ["None"],
          changeBudget: { maxFiles: 3, maxDiffLines: 100 },
        },
        acceptance: { criteria: ["Works"], commands: ["true"] },
        effort: "xhigh",
        maxBudgetUsd: 1.5,
        focusPaths: ["src"],
        generatedPaths: ["**/.custom-cache/**"],
        delivery: {
          buildCommands: ["npm run build"],
          activationCommands: ["forklight daemon restart"],
          activationCheckCommands: ["forklight health --json"],
        },
      },
    });
    assert.equal(submit.isError, undefined);
    const s = submit.structuredContent as Record<string, unknown>;
    // Explicit provider wins over defaultProvider
    assert.equal(s.provider, "minimax");
    // Explicit effort wins over defaultEffort
    assert.equal(s.runtime, "claude-code");
    const stored = await daemonRequest<TaskRecord>(
      "status",
      { taskId: String(s.taskId) },
      home,
    );
    assert.deepEqual(stored.spec.workspace.generatedPaths, ["**/.custom-cache/**"]);
    assert.deepEqual(stored.spec.delivery, {
      buildCommands: ["npm run build"],
      activationCommands: ["forklight daemon restart"],
      activationCheckCommands: ["forklight health --json"],
    });
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP settings reset restores built-in defaults", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-setreset-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    await client.callTool({
      name: "forklight_settings_update",
      arguments: { patch: { execution: { maxConcurrency: 8 } } },
    });

    const reset = await client.callTool({ name: "forklight_settings_reset", arguments: {} });
    assert.equal(reset.isError, undefined);
    const r = reset.structuredContent as Record<string, unknown>;
    assert.equal((r.execution as Record<string, unknown>).maxConcurrency, 2);

    // Read back confirms
    const get = await client.callTool({ name: "forklight_settings_get", arguments: {} });
    const g = get.structuredContent as Record<string, unknown>;
    assert.equal((g.execution as Record<string, unknown>).maxConcurrency, 2);
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP plan tools submit, inspect, and repeat board reads without side effects", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-plan-"));
  const planFile = path.join(home, "plan.json");
  const taskFile = path.resolve("examples/deepseek-checkout.yaml");
  await writeFile(
    planFile,
    JSON.stringify({
      version: 1,
      name: "MCP plan test",
      objective: "Exercise plan board tools",
      items: [
        { id: "first", task: taskFile, dependsOn: [] },
        { id: "second", task: taskFile, dependsOn: ["first"] },
      ],
    }),
  );
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const submit = await client.callTool({
      name: "forklight_plan_submit",
      arguments: { planFile },
    });
    assert.equal(submit.isError, undefined);
    assert.equal((submit.structuredContent as { planId?: string }).planId, planFile);

    const first = await client.callTool({
      name: "forklight_plan_inspect",
      arguments: { planId: planFile },
    });
    const second = await client.callTool({
      name: "forklight_plan_inspect",
      arguments: { planId: planFile },
    });
    assert.deepEqual(second.structuredContent, first.structuredContent);
    assert.equal(
      (first.structuredContent as { plan?: { progress?: { waiting?: number } } }).plan?.progress?.waiting,
      1,
    );

    const overview = await client.callTool({ name: "forklight_plan_board", arguments: {} });
    assert.equal((overview.structuredContent as { plans?: unknown[] }).plans?.length, 1);
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP provider_status returns cached verification and is read-only", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-pvs-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const all = await client.callTool({ name: "forklight_provider_status", arguments: {} });
    assert.equal(all.isError, undefined);
    const data = all.structuredContent as Record<string, Record<string, unknown>>;
    assert.ok("deepseek" in data);
    assert.ok("qwen" in data);

    // Read-only: repeated calls return consistent status without cost
    const again = await client.callTool({ name: "forklight_provider_status", arguments: {} });
    assert.deepEqual(again.structuredContent, all.structuredContent);

    // Single provider
    const single = await client.callTool({
      name: "forklight_provider_status",
      arguments: { provider: "minimax" },
    });
    const sd = single.structuredContent as Record<string, Record<string, unknown>>;
    assert.ok("minimax" in sd);
    assert.equal(Object.keys(sd).length, 1);

    // Verify tool metadata: readOnlyHint is true
    const tools = await client.listTools();
    const pvsTool = tools.tools.find((t) => t.name === "forklight_provider_status");
    assert.ok(pvsTool !== undefined);
    assert.equal(pvsTool.annotations?.readOnlyHint, true);
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP provider_probe tool exists with explicit mutation metadata", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-pvp-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tools = await client.listTools();
    const probeTool = tools.tools.find((t) => t.name === "forklight_provider_probe");
    assert.ok(probeTool !== undefined, "forklight_provider_probe must be registered");
    assert.equal(probeTool.annotations?.readOnlyHint, false,
      "probe must NOT be marked read-only");
    assert.equal(probeTool.annotations?.openWorldHint, true,
      "probe must be marked as open-world (billable mutation)");

    // Status tool remains read-only
    const statusTool = tools.tools.find((t) => t.name === "forklight_provider_status");
    assert.equal(statusTool?.annotations?.readOnlyHint, true);
    assert.equal(statusTool?.annotations?.openWorldHint, false);
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP statistics exposes filtered local evidence and explicit sample sizes", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-statistics-"));
  const timestamp = new Date().toISOString();
  const store = new StateStore(home);
  const record = {
    id: "statistics-task",
    name: "statistics task",
    status: "succeeded",
    sourcePath: "/source",
    taskFile: "/task.yaml",
    spec: { provider: { name: "minimax", model: "m3" } } as TaskRecord["spec"],
    paths: {} as TaskRecord["paths"],
    sessionId: "statistics-session",
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
  } satisfies TaskRecord;
  store.createTask(record);
  store.createAttempt({
    id: "statistics-attempt",
    taskId: record.id,
    ordinal: 1,
    status: "succeeded",
    sessionId: record.sessionId,
    rawLogPath: "/log",
    startedAt: timestamp,
    finishedAt: timestamp,
    exitCode: 0,
    costUsd: 0.4,
    turns: 5,
  });
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: "forklight_statistics",
      arguments: { provider: "minimax" },
    });
    const summaries = (result.structuredContent as { summaries?: ProviderModelSummary[] }).summaries;
    assert.equal(summaries?.[0]?.model, "m3");
    assert.equal(summaries?.[0]?.sampleSize, 1);
    assert.equal(summaries?.[0]?.costSampleSize, 1);

    const empty = await client.callTool({
      name: "forklight_statistics",
      arguments: { provider: "deepseek" },
    });
    assert.deepEqual((empty.structuredContent as { summaries?: unknown[] }).summaries, []);
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});
