import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ProviderModelSummary } from "../src/core/statistics.js";
import type {
  AttemptRecord,
  EffectivePolicySnapshot,
  CompetitionCandidateRecord,
  CompetitionRecord,
  FrozenRoutingAdvisorySnapshot,
  IntegrationReceiptRecord,
  IntegrationResultRecord,
  IntegrationStageEvidence,
  RoutingDecisionSnapshot,
  TaskRecord,
  TaskSpec,
  VerificationResult,
} from "../src/core/types.js";
import type { CompactIntegrationOperationView } from "../src/core/integration-operation.js";
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
import { SettingsService } from "../src/core/settings.js";
import { captureCandidateRevision } from "../src/core/candidate-revision.js";
import { createReviewGraph, reconcileAllReviewGraphs } from "../src/core/review-graph.js";

test("MCP remediation_verify carries optional amendment without leaking command text in receipts", async () => {
  const src = await readFile(new URL("../src/mcp/server.ts", import.meta.url), "utf8");
  assert.ok(src.includes("forklight_remediation_verify"), "remediation tool registered");
  assert.ok(src.includes('reasonCode: z.literal("contradictory-acceptance")'),
    "MCP requires fixed contradictory-acceptance reason code");
  assert.ok(src.includes("originalCommand"), "MCP accepts structured originalCommand");
  assert.ok(src.includes("replacementCommand"), "MCP accepts structured replacementCommand");
  assert.ok(src.includes("amendmentReplacementCount"),
    "exchange receipt uses replacement count only");
  assert.ok(src.includes("amendmentVerificationEventSequence"),
    "exchange receipt binds verification sequence only");
  // Receipt args must not include raw command fields.
  const receiptArgsIdx = src.indexOf("amendmentReplacementCount");
  assert.ok(receiptArgsIdx > 0);
  const receiptWindow = src.slice(receiptArgsIdx - 200, receiptArgsIdx + 400);
  assert.ok(!receiptWindow.includes("originalCommand:"),
    "receipt args must not pass originalCommand content");
  assert.ok(!receiptWindow.includes("replacementCommand:"),
    "receipt args must not pass replacementCommand content");
  // Technical compact reason code may appear in schema; beginner Hub copy is separate.
  assert.ok(src.includes("contradictory-acceptance"),
    "MCP schema keeps the technical reason code");
});

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
        "forklight_adaptation_apply",
        "forklight_adaptation_preview",
        "forklight_backup_create",
        "forklight_backup_inspect",
        "forklight_backup_preview",
        "forklight_candidate_reverify",
        "forklight_compete_submit",
        "forklight_competition_compare",
        "forklight_competition_handoff",
        "forklight_competition_list",
        "forklight_competition_main_decision",
        "forklight_competition_retained_partial",
        "forklight_competition_status",
        "forklight_correct",
        "forklight_correction_eligibility",
        "forklight_delivery_decide",
        "forklight_delivery_prepare",
        "forklight_direct_codex_capture",
        "forklight_direct_codex_capture_task",
        "forklight_direct_codex_inbox",
        "forklight_direct_codex_publication_preview",
        "forklight_direct_codex_publication_register",
        "forklight_direct_codex_review",
        "forklight_goal_advance",
        "forklight_goal_list",
        "forklight_goal_status",
        "forklight_goal_stop",
        "forklight_goal_submit",
        "forklight_goal_task_handoff",
        "forklight_goal_validate",
        "forklight_health",
        "forklight_inspect",
        "forklight_integration_apply",
        "forklight_integration_history",
        "forklight_integration_preflight",
        "forklight_integration_status",
        "forklight_integration_wait",
        "forklight_list",
        "forklight_main_direct_aggregate",
        "forklight_main_direct_complete",
        "forklight_main_direct_list",
        "forklight_main_direct_start",
        "forklight_main_direct_status",
        "forklight_main_failure_attribution",
        "forklight_main_review",
        "forklight_main_token_assess",
        "forklight_main_token_capture",
        "forklight_main_token_capture_episode",
        "forklight_main_token_pair_report",
        "forklight_main_token_status",
        "forklight_main_token_value_report",
        "forklight_model_routing",
        "forklight_outcome_intake_confirm",
        "forklight_outcome_intake_create",
        "forklight_outcome_intake_get",
        "forklight_outcome_intake_list",
        "forklight_outcome_intake_propose",
        "forklight_plan_board",
        "forklight_plan_inspect",
        "forklight_plan_submit",
        "forklight_provider_probe",
        "forklight_provider_status",
        "forklight_remediation_verify", // optional amendment: structured failed-command replacements only
        "forklight_resume",
        "forklight_review_graph_create",
        "forklight_review_graph_repair_result",
        "forklight_review_graph_status",
        "forklight_settings_get",
        "forklight_settings_reset",
        "forklight_settings_update",
        "forklight_statistics",
        "forklight_status",
        "forklight_storage_audit",
        "forklight_storage_preview",
        "forklight_storage_reclaim",
        "forklight_storage_retain",
        "forklight_submit",
        "forklight_task_reopen",
        "forklight_task_resolve",
        "forklight_validate",
        "forklight_wait",
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

test("MCP storage audit and reclaim share daemon lifecycle semantics", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-storage-"));
  const taskId = "mcp-storage-delivered";
  const store = new StateStore(home);
  const timestamp = "2026-08-14T00:00:00.000Z";
  const paths = taskPaths(home, taskId);
  store.createTask({
    id: taskId,
    name: taskId,
    status: "succeeded",
    sourcePath: "/source",
    taskFile: "/task.yaml",
    spec: {
      provider: { name: "deepseek", model: "deepseek-v4-pro[1M]" },
      runtime: { name: "claude-code" },
    } as TaskRecord["spec"],
    paths,
    sessionId: "session-mcp-storage",
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
  });
  store.addEvent(taskId, undefined, "integration.operation.started", "started", {
    operationId: "mcp-storage-op",
    taskId,
    receiptId: "mcp-storage-receipt",
  });
  store.saveIntegrationReceipt({
    id: "mcp-storage-receipt",
    taskId,
    patchDigest: "d".repeat(64),
    affectedFiles: ["src/cli.ts"],
    rejectionReasons: [],
    sourceEvidence: {},
    createdAt: timestamp,
    expiresAt: "2099-01-01T00:00:00.000Z",
    consumed: true,
  });
  store.saveIntegrationResult({
    id: "mcp-storage-op",
    receiptId: "mcp-storage-receipt",
    taskId,
    status: "applied",
    appliedAt: timestamp,
    createdAt: timestamp,
    stages: [
      { stage: "source-applied", status: "passed" },
      { stage: "source-verified", status: "passed" },
      { stage: "artifact-built", status: "not-applicable" },
      { stage: "runtime-activated", status: "not-applicable" },
    ],
  });
  store.close();
  await mkdir(paths.workspace, { recursive: true });
  await writeFile(path.join(paths.workspace, "gone.ts"), "workspace");
  await mkdir(paths.logs, { recursive: true });
  await writeFile(path.join(paths.logs, "worker.log"), "durable");

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const audit = await client.callTool({ name: "forklight_storage_audit", arguments: {} });
    assert.equal(audit.isError, undefined);
    const auditData = audit.structuredContent as {
      kind?: string;
      entries?: Array<{ taskId?: string; classification?: string }>;
    };
    assert.equal(auditData.kind, "storage-audit");
    assert.equal(
      auditData.entries?.find((entry) => entry.taskId === taskId)?.classification,
      "reclaimable",
    );
    const reclaim = await client.callTool({
      name: "forklight_storage_reclaim",
      arguments: { taskId, confirm: true },
    });
    assert.equal(reclaim.isError, undefined);
    const reclaimData = reclaim.structuredContent as {
      kind?: string;
      results?: Array<{ applied?: boolean }>;
    };
    assert.equal(reclaimData.kind, "storage-reclaim");
    assert.equal(reclaimData.results?.[0]?.applied, true);
    await assert.rejects(() => readFile(path.join(paths.workspace, "gone.ts"), "utf8"));
    assert.equal(await readFile(path.join(paths.logs, "worker.log"), "utf8"), "durable");
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("MCP storage audit and preview write no exchange receipts", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-storage-noreceipt-"));
  const taskId = "mcp-storage-preview-task";
  const store = new StateStore(home);
  const timestamp = "2026-08-14T00:00:00.000Z";
  const paths = taskPaths(home, taskId);
  store.createTask({
    id: taskId,
    name: taskId,
    status: "succeeded",
    sourcePath: "/source",
    taskFile: "/task.yaml",
    spec: {
      provider: { name: "deepseek", model: "deepseek-v4-pro[1M]" },
      runtime: { name: "claude-code" },
    } as TaskRecord["spec"],
    paths,
    sessionId: "session-mcp-storage-preview",
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
  });
  store.addEvent(taskId, undefined, "integration.operation.started", "started", {
    operationId: "mcp-storage-preview-op",
    taskId,
    receiptId: "mcp-storage-preview-receipt",
  });
  store.saveIntegrationReceipt({
    id: "mcp-storage-preview-receipt",
    taskId,
    patchDigest: "d".repeat(64),
    affectedFiles: ["src/cli.ts"],
    rejectionReasons: [],
    sourceEvidence: {},
    createdAt: timestamp,
    expiresAt: "2099-01-01T00:00:00.000Z",
    consumed: true,
  });
  store.saveIntegrationResult({
    id: "mcp-storage-preview-op",
    receiptId: "mcp-storage-preview-receipt",
    taskId,
    status: "applied",
    appliedAt: timestamp,
    createdAt: timestamp,
    stages: [
      { stage: "source-applied", status: "passed" },
      { stage: "source-verified", status: "passed" },
      { stage: "artifact-built", status: "not-applicable" },
      { stage: "runtime-activated", status: "not-applicable" },
    ],
  });
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const audit = await client.callTool({ name: "forklight_storage_audit", arguments: {} });
    assert.equal(audit.isError, undefined);
    const preview = await client.callTool({
      name: "forklight_storage_preview",
      arguments: { taskId },
    });
    assert.equal(preview.isError, undefined);
    const after = new StateStore(home);
    try {
      assert.equal(after.listExchangeReceipts(taskId).length, 0);
    } finally {
      after.close();
    }
    const mcpSource = await readFile(new URL("../src/mcp/server.ts", import.meta.url), "utf8");
    const auditIdx = mcpSource.indexOf('"forklight_storage_audit"');
    const previewIdx = mcpSource.indexOf('"forklight_storage_preview"');
    const reclaimIdx = mcpSource.indexOf('"forklight_storage_reclaim"');
    assert.ok(auditIdx > 0 && previewIdx > auditIdx && reclaimIdx > previewIdx);
    assert.ok(!mcpSource.slice(auditIdx, reclaimIdx).includes("withMcpExchangeReceipt"));
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("MCP forklight_goal_validate returns one bounded preview and creates no work", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-goal-validate-"));
  const root = path.join(home, "goal");
  await mkdir(root, { recursive: true });
  const task = path.resolve("examples/deepseek-checkout.yaml");
  const planFile = path.join(root, "plan.json");
  await writeFile(
    planFile,
    JSON.stringify({
      version: 1,
      name: "MCP goal validate plan",
      objective: "Four-task plan for the MCP goal_validate tool.",
      items: [
        { id: "foundation", task, dependsOn: [] },
        { id: "service", task, dependsOn: ["foundation"] },
        { id: "console", task, dependsOn: ["foundation"] },
        { id: "integrate-docs", task, dependsOn: ["service", "console"] },
      ],
    }),
  );
  const goalFile = path.join(root, "goal.json");
  await writeFile(
    goalFile,
    JSON.stringify({
      version: 1,
      name: "MCP goal validate",
      objective: "Prove the MCP goal_validate tool is read-only and bounded.",
      planFile,
      policy: {
        maxDurationMs: null,
        noProgressTimeoutMs: null,
        maxCorrectionRounds: 1,
        maxReviewRounds: 1,
        maxNoNewEvidenceCycles: 2,
      },
      milestones: [
        { itemId: "foundation", gate: "machine" },
        { itemId: "service", gate: "machine" },
        { itemId: "console", gate: "machine" },
        { itemId: "integrate-docs", gate: "machine" },
      ],
    }, null, 2),
  );

  const daemon = new ForkLightDaemon(home, 1);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: "forklight_goal_validate",
      arguments: { goalFile },
    });
    assert.equal(result.isError, undefined);
    const data = result.structuredContent as {
      passed?: boolean;
      version?: number;
      phaseCount?: number;
      taskCount?: number;
      name?: string;
    };
    assert.equal(data.passed, true);
    assert.equal(data.version, 1);
    assert.equal(data.phaseCount, 1);
    assert.equal(data.taskCount, 4);
    assert.equal(data.name, "MCP goal validate");
    const text = Array.isArray(result.content)
      ? result.content.map((c) => ("text" in c ? c.text : "")).join("\n")
      : "";
    assert.doesNotMatch(text, /python3|unittest|deepseek|api-key/);

    // Read-only parity: no Goal, Plan, or Task was created.
    const store = new StateStore(home);
    try {
      assert.deepEqual(store.listGoals(), []);
      assert.deepEqual(store.listTasks(), []);
      assert.deepEqual(store.listPlans(), []);
    } finally {
      store.close();
    }
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP outcome intake records, proposes, reads, and lists without creating work", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-outcome-"));
  const project = path.join(home, "project");
  await mkdir(project, { recursive: true });
  const taskFile = path.join(home, "task.json");
  await writeFile(
    taskFile,
    JSON.stringify(
      {
        version: 2,
        name: "MCP outcome task",
        project: "./project",
        contract: {
          outcome: "Produce one bounded, independently verifiable result for this intake",
          context: ["Existing behavior is known and documented"],
          inScope: ["Make the smallest coherent change that satisfies the outcome"],
          outOfScope: ["Do not touch unrelated areas or external systems"],
          executionSteps: ["Inspect the relevant code paths", "Apply the smallest coherent change"],
          deliverables: ["Updated behavior with the acceptance command passing"],
          modules: [
            {
              name: "bounded result",
              responsibility: "Produce the one bounded result while preserving existing behavior",
              consumes: ["declared inputs"],
              produces: ["a validated result"],
              boundaries: ["no undeclared mutation"],
            },
          ],
          callChain: [
            "The caller provides declared inputs",
            "The Worker produces the validated result",
            "The acceptance command verifies the result",
          ],
          scenarios: [
            {
              name: "nominal",
              given: "declared inputs are valid",
              when: "the task runs",
              then: "the result is produced and verified",
            },
            {
              name: "boundary",
              given: "an edge input is supplied",
              when: "the task runs",
              then: "behavior stays bounded and safe",
            },
          ],
          risks: ["Behavior drift from an over-broad change"],
          changeBudget: { maxFiles: 4, maxDiffLines: 200 },
        },
        provider: { name: "deepseek", model: "deepseek-v4-flash", keychainService: "forklight.mcp.outcome-intake.test" },
        runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: null },
        worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
        acceptance: { criteria: ["The outcome is satisfied"], commands: ["true"] },
      },
      null,
      2,
    ),
  );

  const daemon = new ForkLightDaemon(home, 1);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const created = await client.callTool({
      name: "forklight_outcome_intake_create",
      arguments: { outcome: "A bounded MCP outcome", requestedShape: "auto" },
    });
    assert.equal(created.isError, undefined);
    const createdData = created.structuredContent as {
      id?: string;
      status?: string;
      revision?: number;
    };
    assert.equal(createdData.status, "pending");
    assert.equal(createdData.revision, 1);
    const intakeId = createdData.id as string;

    const proposed = await client.callTool({
      name: "forklight_outcome_intake_propose",
      arguments: {
        intakeId,
        expectedRevision: 1,
        shape: "task",
        reason: "One Task fits this bounded outcome",
        artifactPath: taskFile,
      },
    });
    assert.equal(proposed.isError, undefined);
    const proposedData = proposed.structuredContent as {
      intake?: Record<string, unknown>;
      preview?: Record<string, unknown>;
    };
    assert.equal(proposedData.preview?.selectedShape, "task");
    assert.equal(proposedData.preview?.taskCount, 1);
    assert.equal(proposedData.preview?.confirmationHappened, false);
    assert.equal(proposedData.preview?.workCreated, 0);
    assert.equal(proposedData.intake?.revision, 2);

    const got = await client.callTool({
      name: "forklight_outcome_intake_get",
      arguments: { intakeId },
    });
    assert.equal(got.isError, undefined);
    const gotData = got.structuredContent as {
      status?: string;
      revision?: number;
      proposal?: Record<string, unknown>;
    };
    assert.equal(gotData.status, "proposed");
    assert.equal(gotData.revision, 2);
    assert.equal(gotData.proposal?.shape, "task");
    assert.equal(gotData.proposal?.artifactPath, undefined, "artifact path must never be projected");

    const listed = await client.callTool({
      name: "forklight_outcome_intake_list",
      arguments: { status: "proposed", limit: 1 },
    });
    assert.equal(listed.isError, undefined);
    const listedData = listed.structuredContent as { intakes?: Array<{ id?: string }> };
    assert.equal(listedData.intakes?.length, 1);
    assert.equal(listedData.intakes?.[0]?.id, intakeId);

    const limited = await client.callTool({
      name: "forklight_outcome_intake_list",
      arguments: { limit: 1 },
    });
    assert.equal(limited.isError, undefined);
    const limitedData = limited.structuredContent as { intakes?: Array<{ id?: string }> };
    assert.equal(limitedData.intakes?.length, 1);
    assert.equal(limitedData.intakes?.[0]?.id, intakeId);
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("MCP confirms an outcome intake once and retries return the same receipt without duplicate work", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-outcome-confirm-"));
  const project = path.join(home, "project");
  await mkdir(project, { recursive: true });
  const taskFile = path.join(home, "task.json");
  await writeFile(
    taskFile,
    JSON.stringify(
      {
        version: 2,
        name: "MCP confirm task",
        project: "./project",
        contract: {
          outcome: "Produce one bounded, independently verifiable result for this intake",
          context: ["Existing behavior is known and documented"],
          inScope: ["Make the smallest coherent change that satisfies the outcome"],
          outOfScope: ["Do not touch unrelated areas or external systems"],
          executionSteps: ["Inspect the relevant code paths", "Apply the smallest coherent change"],
          deliverables: ["Updated behavior with the acceptance command passing"],
          modules: [
            {
              name: "bounded result",
              responsibility: "Produce the one bounded result while preserving existing behavior",
              consumes: ["declared inputs"],
              produces: ["a validated result"],
              boundaries: ["no undeclared mutation"],
            },
          ],
          callChain: [
            "The caller provides declared inputs",
            "The Worker produces the validated result",
            "The acceptance command verifies the result",
          ],
          scenarios: [
            {
              name: "nominal",
              given: "declared inputs are valid",
              when: "the task runs",
              then: "the result is produced and verified",
            },
            {
              name: "boundary",
              given: "an edge input is supplied",
              when: "the task runs",
              then: "behavior stays bounded and safe",
            },
          ],
          risks: ["Behavior drift from an over-broad change"],
          changeBudget: { maxFiles: 4, maxDiffLines: 200 },
        },
        provider: { name: "deepseek", model: "deepseek-v4-flash", keychainService: "forklight.mcp.outcome-confirm.test" },
        runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: null },
        worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
        acceptance: { criteria: ["The outcome is satisfied"], commands: ["true"] },
      },
      null,
      2,
    ),
  );

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const created = await client.callTool({
      name: "forklight_outcome_intake_create",
      arguments: { outcome: "A confirmed MCP outcome", requestedShape: "auto" },
    });
    const intakeId = (created.structuredContent as { id?: string }).id as string;

    await client.callTool({
      name: "forklight_outcome_intake_propose",
      arguments: {
        intakeId,
        expectedRevision: 1,
        shape: "task",
        reason: "One Task fits this bounded outcome",
        artifactPath: taskFile,
      },
    });

    const confirmed = await client.callTool({
      name: "forklight_outcome_intake_confirm",
      arguments: { intakeId, expectedRevision: 2, confirm: true },
    });
    assert.equal(confirmed.isError, undefined);
    const confirmedData = confirmed.structuredContent as {
      intake?: Record<string, unknown>;
      receipt?: Record<string, unknown>;
    };
    assert.equal(confirmedData.intake?.status, "created");
    assert.equal(confirmedData.receipt?.shape, "task");
    const taskIds = confirmedData.receipt?.taskIds as unknown[] | undefined;
    assert.equal(taskIds?.length, 1);

    const retry = await client.callTool({
      name: "forklight_outcome_intake_confirm",
      arguments: { intakeId, expectedRevision: 2, confirm: true },
    });
    assert.equal(retry.isError, undefined);
    const retryData = retry.structuredContent as { receipt?: Record<string, unknown> };
    assert.equal(retryData.receipt?.receiptId, confirmedData.receipt?.receiptId);
    assert.deepEqual(retryData.receipt?.taskIds, confirmedData.receipt?.taskIds);

    const got = await client.callTool({
      name: "forklight_outcome_intake_get",
      arguments: { intakeId },
    });
    const gotData = got.structuredContent as { status?: string; confirmation?: Record<string, unknown> };
    assert.equal(gotData.status, "created");
    assert.equal(gotData.confirmation?.receiptId, confirmedData.receipt?.receiptId);
    assert.ok(!JSON.stringify(gotData).includes(taskFile), "MCP view must not expose the artifact path");
    assert.ok(!JSON.stringify(gotData).includes("artifactPath"), "MCP view must not name the private field");

    const tasks = await daemonRequest<unknown[]>("list", {}, home);
    assert.equal(tasks.length, 1, "MCP confirmation created exactly one Task");
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("MCP records one exact failure attribution without echoing the Main note", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-failure-attribution-"));
  const taskId = randomUUID();
  const attemptId = randomUUID();
  const now = new Date().toISOString();
  const store = new StateStore(home);
  const task: TaskRecord = {
    id: taskId,
    name: "Failure attribution MCP fixture",
    status: "failed",
    sourcePath: "/tmp/source",
    taskFile: "forklight://test/failure-attribution-mcp",
    spec: {
      version: 1,
      name: "Failure attribution MCP fixture",
      project: "/tmp/source",
      goal: "Keep machine failure and responsibility separate",
      constraints: [],
      provider: { name: "deepseek", model: "v4", keychainService: "forklight.test" },
      runtime: { name: "claude-code", executable: "claude", effort: "high", maxBudgetUsd: null },
      workspace: { exclude: [] },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
      acceptance: { commands: ["false"] },
    },
    paths: taskPaths(home, taskId),
    sessionId: randomUUID(),
    currentAttemptId: attemptId,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: now,
  };
  const attempt: AttemptRecord = {
    id: attemptId,
    taskId,
    ordinal: 1,
    status: "failed",
    sessionId: task.sessionId,
    rawLogPath: path.join(home, "attempt.jsonl"),
    startedAt: now,
    finishedAt: now,
    exitCode: 1,
  };
  store.createTask(task);
  store.createAttempt(attempt);
  const verification = store.addEvent(taskId, attemptId, "verification.completed", "failed", {
    passed: false,
    behaviorPassed: false,
    policyPassed: true,
    sourceCompatible: true,
    commands: [{ command: "false", exitCode: 1, stdout: "", stderr: "", durationMs: 1, timedOut: false }],
    diffPath: task.paths.diff,
    sourceUnchanged: true,
  } satisfies VerificationResult);
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const missingConfirm = await client.callTool({
      name: "forklight_main_failure_attribution",
      arguments: {
        taskId,
        attemptId,
        verificationEventSequence: verification.sequence,
        cause: "verification-infrastructure",
        note: "private-note-marker",
      },
    });
    assert.equal(missingConfirm.isError, true);

    const recorded = await client.callTool({
      name: "forklight_main_failure_attribution",
      arguments: {
        taskId,
        attemptId,
        verificationEventSequence: verification.sequence,
        cause: "verification-infrastructure",
        note: "private-note-marker",
        confirm: true,
      },
    });
    assert.equal(recorded.isError, undefined);
    assert.equal(JSON.stringify(recorded).includes("private-note-marker"), false);
    const data = recorded.structuredContent as Record<string, unknown>;
    assert.equal(data.impact, "non-model");
    assert.equal(data.noteLength, "private-note-marker".length);
    const recheck = new StateStore(home);
    assert.equal(recheck.getTask(taskId).status, "failed");
    assert.equal(
      recheck.listEvents(taskId).filter((event) => event.type === "main.failure-attribution.recorded").length,
      1,
    );
    recheck.close();
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

// --- Model routing MCP surface tests ---

test("MCP model_routing tool is registered as read-only", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-mr-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tools = await client.listTools();
    const routingTool = tools.tools.find((t) => t.name === "forklight_model_routing");
    assert.ok(routingTool !== undefined, "forklight_model_routing must be registered");
    assert.equal(routingTool.annotations?.readOnlyHint, true,
      "model_routing must be marked read-only");
    assert.equal(routingTool.annotations?.openWorldHint, false,
      "model_routing must be closed-world (never calls Provider)");
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP model_routing returns privacy-safe advisory for empty history", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-mr-safe-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: "forklight_model_routing",
      arguments: {
        taskClass: "nonexistent-class",
        candidates: [
          { provider: "deepseek", model: "v4" },
          { provider: "qwen", model: "plus" },
        ],
      },
    });
    assert.equal(result.isError, undefined);
    const advisory = result.structuredContent as Record<string, unknown>;
    assert.equal(advisory.taskClass, "nonexistent-class");
    assert.equal((advisory.candidates as unknown[]).length, 2);
    assert.equal(advisory.knowledge, "unknown");
    assert.equal(advisory.overallResult, "cannot-determine");
    assert.ok(Array.isArray(advisory.cannotDetermineReasons));
    assert.equal(advisory.evidenceScope, "none");
    assert.equal(advisory.shouldRunCompetition, false);
    const comp = advisory.competition as Record<string, unknown>;
    assert.equal(comp.intent, "none");
    const strategyPolicy = advisory.strategyPolicy as Record<string, unknown> | undefined;
    assert.ok(strategyPolicy);
    assert.equal((strategyPolicy.strategy as Record<string, unknown>).createsWork, false);
    assert.equal((strategyPolicy.competitionPolicy as Record<string, unknown>).determination, "not-advised");
    // Privacy-safe: no Task ids, logs, or credentials
    const json = JSON.stringify(advisory);
    assert.doesNotMatch(json, /error/);
    assert.doesNotMatch(json, /api[_-]?key/);
    assert.doesNotMatch(json, /\/tasks\//);
    assert.doesNotMatch(json, /credential/);
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP model_routing tool schema exposes mutually exclusive workerProfileIds", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-mr-schema-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tools = await client.listTools();
    const routingTool = tools.tools.find((t) => t.name === "forklight_model_routing")!;
    const props = (routingTool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    assert.ok("workerProfileIds" in props, "workerProfileIds is a first-class tool input");
    assert.ok("candidates" in props, "legacy candidates remain available");
    // Mixed input fails closed before any daemon call.
    const mixed = await client.callTool({
      name: "forklight_model_routing",
      arguments: {
        taskClass: "t",
        candidates: [{ provider: "deepseek", model: "v4" }, { provider: "qwen", model: "plus" }],
        workerProfileIds: ["a", "b"],
      },
    });
    assert.equal(mixed.isError, true);
    assert.match(toolErrorText(mixed), /exactly one of candidates or workerProfileIds/i);
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP model_routing resolves saved Worker Profiles and preserves identity", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-mr-profile-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  await daemonRequest("settings_update", {
    patch: {
      workerProfiles: {
        defaultProfileId: "deepseek-primary",
        profiles: [
          {
            id: "deepseek-primary", label: "DeepSeek Primary",
            runtime: "claude-code", modelConfigId: "deepseek-flash", effort: "high",
          },
          {
            id: "qwen-secondary", label: "Qwen Secondary",
            runtime: "claude-code", modelConfigId: "qwen-plus", effort: "medium",
          },
        ],
      },
    },
  }, home);
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: "forklight_model_routing",
      arguments: {
        taskClass: "nonexistent-class",
        workerProfileIds: ["deepseek-primary", "qwen-secondary"],
      },
    });
    assert.equal(result.isError, undefined);
    const advisory = result.structuredContent as Record<string, unknown>;
    const cands = advisory.candidates as Array<Record<string, unknown>>;
    assert.equal(cands.length, 2);
    const deepseek = cands.find((c) => c.workerProfileId === "deepseek-primary")!;
    assert.equal(deepseek.workerLabel, "DeepSeek Primary");
    assert.equal(deepseek.provider, "deepseek");
    assert.equal(deepseek.runtime, "claude-code");
    assert.equal(deepseek.effort, "high");
    const qwen = cands.find((c) => c.workerProfileId === "qwen-secondary")!;
    assert.equal(qwen.workerLabel, "Qwen Secondary");
    assert.equal(qwen.provider, "qwen");
    // Duplicate profile ids fail closed before evidence.
    const dup = await client.callTool({
      name: "forklight_model_routing",
      arguments: {
        taskClass: "nonexistent-class",
        workerProfileIds: ["deepseek-primary", "deepseek-primary"],
      },
    });
    assert.equal(dup.isError, true);
    assert.match(toolErrorText(dup), /duplicate/i);
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP model_routing projects overall result, readiness, and no automatic Competition", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-mr-exec-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  await daemonRequest("settings_update", {
    patch: {
      workerProfiles: {
        defaultProfileId: "deepseek-primary",
        profiles: [
          {
            id: "deepseek-primary", label: "DeepSeek Primary",
            runtime: "claude-code", modelConfigId: "deepseek-flash", effort: "high",
          },
          {
            id: "qwen-secondary", label: "Qwen Secondary",
            runtime: "claude-code", modelConfigId: "qwen-plus", effort: "medium",
          },
        ],
      },
    },
  }, home);
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const empty = await client.callTool({
      name: "forklight_model_routing",
      arguments: {
        taskClass: "nonexistent-class",
        workerProfileIds: ["deepseek-primary", "qwen-secondary"],
        competitionIntent: "none",
      },
    });
    assert.equal(empty.isError, undefined);
    const emptyAdvisory = empty.structuredContent as Record<string, unknown>;
    assert.equal(emptyAdvisory.overallResult, "cannot-determine");
    assert.equal(emptyAdvisory.shouldRunCompetition, false);
    const emptyComp = emptyAdvisory.competition as Record<string, unknown>;
    assert.equal(emptyComp.intent, "none");
    const emptyStrategy = emptyAdvisory.strategyPolicy as Record<string, unknown>;
    assert.ok(emptyStrategy);
    assert.equal((emptyStrategy.strategy as Record<string, unknown>).createsWork, false);
    assert.equal((emptyStrategy.competitionPolicy as Record<string, unknown>).determination, "not-advised");
    assert.equal((emptyStrategy.judgePolicy as Record<string, unknown>).votes, false);
    assert.match(toolErrorText(empty), /cannot determine/i);
    const emptyCands = emptyAdvisory.candidates as Array<Record<string, unknown>>;
    for (const candidate of emptyCands) {
      assert.ok(candidate.workerProfileId);
      assert.ok("canLaunch" in candidate);
      assert.ok("resolvedExecutionMode" in candidate);
    }
    const legacy = await client.callTool({
      name: "forklight_model_routing",
      arguments: {
        taskClass: "nonexistent-class",
        candidates: [
          { provider: "deepseek", model: "v4" },
          { provider: "qwen", model: "plus" },
        ],
        competitionIntent: "none",
      },
    });
    const legacyAdvisory = legacy.structuredContent as Record<string, unknown>;
    assert.equal(legacyAdvisory.overallResult, "cannot-determine");
    const legacyCands = legacyAdvisory.candidates as Array<Record<string, unknown>>;
    for (const candidate of legacyCands) {
      assert.equal(candidate.workerProfileId, undefined);
      assert.equal(candidate.resolvedExecutionMode, undefined);
      assert.equal(candidate.canLaunch, undefined);
    }
    const json = JSON.stringify(emptyAdvisory) + JSON.stringify(legacyAdvisory);
    assert.doesNotMatch(json, /api[_-]?key/i);
    assert.doesNotMatch(json, /endpoint/i);
    assert.doesNotMatch(json, /keychain/i);
    assert.doesNotMatch(json, /\/Users\//);
    assert.doesNotMatch(json, /auth\.json/);
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

// --- Bounded adaptation MCP surface tests ---------------------------------

async function rootAdaptationSnapshot(): Promise<EffectivePolicySnapshot> {
  const { resolveEffectivePolicy, defaultAdvancedPolicyFields, enforcementCapabilityForRuntime } =
    await import("../src/core/advanced-policy.js");
  const caps = enforcementCapabilityForRuntime("claude-code");
  return resolveEffectivePolicy(
    undefined, undefined,
    { ...defaultAdvancedPolicyFields(), maxAdaptationRounds: 1, maxDurationMs: 60_000 },
    "default",
    caps,
  );
}

async function seedTerminalTaskForAdaptation(store: StateStore): Promise<TaskRecord> {
  const { registerTaskFromSpec } = await import("../src/core/runner.js");
  const effectivePolicy = await rootAdaptationSnapshot();
  const task = registerTaskFromSpec(
    store,
    {
      version: 1,
      name: `adapt-mcp-${Math.random().toString(36).slice(2)}`,
      project: "/tmp/src",
      goal: "Adaptation MCP test",
      constraints: [],
      provider: {
        name: "deepseek", model: "deepseek-v4-flash",
        keychainService: "forklight.test.api-key",
      },
      runtime: {
        name: "claude-code", executable: "claude",
        effort: "low", maxBudgetUsd: 0.1,
      },
      workspace: { exclude: [] },
      worker: { allowEdits: false, allowedCommands: [], focusPaths: ["src"] },
      acceptance: { commands: ["true"] },
    },
    `forklight://test/adapt-mcp-${Math.random().toString(36).slice(2)}`,
    effectivePolicy,
  );
  store.setTaskStatus(task.id, "succeeded", { error: null });
  return store.getTask(task.id);
}

test("MCP adaptation tools have truthful read-only vs mutating annotations", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-adapt-annot-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tools = await client.listTools();
    const previewTool = tools.tools.find((t) => t.name === "forklight_adaptation_preview");
    assert.ok(previewTool !== undefined, "adaptation_preview must be registered");
    assert.equal(previewTool.annotations?.readOnlyHint, true,
      "adaptation_preview must be marked read-only");
    assert.equal(previewTool.annotations?.openWorldHint, false,
      "adaptation_preview must not be marked open-world");

    const applyTool = tools.tools.find((t) => t.name === "forklight_adaptation_apply");
    assert.ok(applyTool !== undefined, "adaptation_apply must be registered");
    assert.equal(applyTool.annotations?.readOnlyHint, false,
      "adaptation_apply must NOT be marked read-only");
    assert.equal(applyTool.annotations?.openWorldHint, false,
      "adaptation_apply mutates local ForkLight state but does not reach an external world");
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP adaptation_preview is read-only and returns canonical before/after evidence", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-adapt-preview-"));
  const store = new StateStore(home);
  const task = await seedTerminalTaskForAdaptation(store);
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const preview = await client.callTool({
      name: "forklight_adaptation_preview",
      arguments: {
        taskId: task.id,
        patch: { maxDurationMs: 600_000 },
        reason: "duration-budget",
      },
    });
    assert.equal(preview.isError, undefined);
    const data = preview.structuredContent as Record<string, unknown>;
    assert.equal(data.status, "eligible");
    assert.equal(data.nextRound, 1);
    assert.equal(data.maxAdaptationRounds, 1);
    assert.equal(typeof data.summary, "string");
    const fields = data.fields as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(fields) && fields.length > 0);
    const dur = fields.find((f) => f.field === "maxDurationMs");
    assert.ok(dur);
    assert.equal(dur!.before, 60_000);
    assert.equal(dur!.after, 600_000);
    assert.equal(dur!.changed, true);

    // Verify preview is read-only: no Task created.
    const recheck = new StateStore(home);
    assert.equal(recheck.listTasks().length, 1, "preview must not create a successor Task");
    recheck.close();

    // Repeated preview returns identical shape without side effects.
    const again = await client.callTool({
      name: "forklight_adaptation_preview",
      arguments: {
        taskId: task.id,
        patch: { maxDurationMs: 600_000 },
        reason: "duration-budget",
      },
    });
    assert.deepEqual(again.structuredContent, data);
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP adaptation_apply requires confirm: true and creates at most one successor", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-adapt-apply-"));
  const store = new StateStore(home);
  const task = await seedTerminalTaskForAdaptation(store);
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    // Valid apply with confirm: true.
    const apply = await client.callTool({
      name: "forklight_adaptation_apply",
      arguments: {
        taskId: task.id,
        patch: { maxDurationMs: 600_000 },
        reason: "duration-budget",
        confirm: true,
      },
    });
    assert.equal(apply.isError, undefined);
    const data = apply.structuredContent as Record<string, unknown>;
    assert.equal(data.status, "eligible");
    assert.ok(typeof data.childTaskId === "string" && (data.childTaskId as string).length > 0);
    assert.ok(typeof data.lineageId === "string");

    // Verify exactly one successor exists.
    const recheck = new StateStore(home);
    assert.equal(recheck.listTasks().length, 2, "one successor Task created");
    recheck.close();

    // Duplicate apply returns stopped; no second successor.
    const dup = await client.callTool({
      name: "forklight_adaptation_apply",
      arguments: {
        taskId: task.id,
        patch: { maxDurationMs: 700_000 },
        reason: "duration-budget",
        confirm: true,
      },
    });
    assert.equal(dup.isError, undefined);
    const dupData = dup.structuredContent as Record<string, unknown>;
    assert.equal(dupData.status, "stopped");
    assert.equal((dupData.preview as Record<string, unknown>).stoppedReason, "successor-already-created");

    const final = new StateStore(home);
    assert.equal(final.listTasks().length, 2, "no extra successor on duplicate apply");
    final.close();
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP adaptation surfaces reject malformed JSON, unknown fields, and unknown reasons safely", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-adapt-reject-"));
  const store = new StateStore(home);
  const task = await seedTerminalTaskForAdaptation(store);
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    // Forbidden field (maxAdaptationRounds) rejected by preview gate.
    const forbidden = await client.callTool({
      name: "forklight_adaptation_preview",
      arguments: {
        taskId: task.id,
        patch: { maxAdaptationRounds: 99 },
        reason: "other-flexible-policy",
      },
    });
    assert.equal(forbidden.isError, undefined);
    const fbData = forbidden.structuredContent as Record<string, unknown>;
    assert.equal(fbData.status, "stopped");
    assert.equal(fbData.stoppedReason, "forbidden-field");

    // Verify no Task was mutated.
    const recheck = new StateStore(home);
    assert.equal(recheck.listTasks().length, 1, "no Task created on forbidden patch");
    recheck.close();
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP adaptation apply rejects missing confirm without creating a successor", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-adapt-noconfirm-"));
  const store = new StateStore(home);
  await seedTerminalTaskForAdaptation(store);
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    // MCP schema requires confirm: z.literal(true), so the SDK should reject
    // missing confirm before it reaches the daemon.
    const bad = await client.callTool({
      name: "forklight_adaptation_apply",
      arguments: {
        taskId: "00000000-0000-0000-0000-000000000000",
        patch: { maxDurationMs: 600_000 },
        reason: "duration-budget",
      } as unknown as Record<string, unknown>,
    });
    assert.equal(bad.isError, true, "apply without literal confirm true must fail schema validation");
    const recheck = new StateStore(home);
    assert.equal(recheck.listTasks().length, 1, "missing confirmation must not create a successor");
    recheck.close();
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

    // Compare with override: ephemeral, uses override weights (FL-D114 kind label)
    const cmp = (await client.callTool({ name: "forklight_competition_compare", arguments: { competitionId: "cd", rankingWeights: { duration: 0.8 } } })).structuredContent as Record<string, unknown>;
    assert.equal(cmp.evaluationKind, "ephemeral-preview");
    const cmpEv = cmp.evaluation as Record<string, unknown>;
    const cmpPol = cmpEv.policy as Record<string, unknown>;
    assert.equal((cmpPol.weights as Record<string, number>).duration, 0.8);
    assert.equal(cmpPol.tieThreshold, 0.25);

    // Default compare returns stored evaluation and labels it (FL-D114).
    const defCmp = (await client.callTool({ name: "forklight_competition_compare", arguments: { competitionId: "cd" } })).structuredContent as Record<string, unknown>;
    assert.equal(defCmp.evaluationKind, "stored");
    assert.match(String(defCmp.note ?? ""), /Historical evaluation|stored/i);
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

test("MCP integration preflight carries path classification evidence without recomputing", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-intpe-"));
  const store = new StateStore(home);
  const { task } = await seedSucceededTask(store, home);
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
    assert.equal(pf.isError, undefined);
    const receipt = pf.structuredContent as IntegrationReceiptRecord;
    assert.equal(receipt.rejectionReasons.length, 0);
    // Evidence is one-to-one with affectedFiles, ordered, privacy-safe
    assert.ok(Array.isArray(receipt.pathEvidence));
    assert.equal(receipt.pathEvidence!.length, receipt.affectedFiles.length);
    receipt.pathEvidence!.forEach((entry, i) => {
      assert.equal(entry.path, receipt.affectedFiles[i]);
      assert.ok(["business", "generated", "internal"].includes(entry.category));
      assert.ok([
        "internal-forklight",
        "snapshot-exclusion",
        "builtin-generated-pattern",
        "task-generated-pattern",
        "default-business",
      ].includes(entry.provenance));
    });
    const readme = receipt.pathEvidence!.find((e) => e.path === "readme.md");
    assert.ok(readme);
    assert.equal(readme!.provenance, "default-business");
    // Passing receipt carries no recovery guidance
    assert.equal(receipt.recoveryGuidance, undefined);
    // Privacy: no absolute source path leaks through the MCP projection
    const serialized = JSON.stringify(receipt.pathEvidence);
    assert.ok(!serialized.includes(task.sourcePath));
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
  svc.update({
    execution: { defaultProvider: "deepseek", defaultEffort: "medium" },
    deliveryProfiles: {
      defaultProfileId: "named-profile",
      profiles: [{
        id: "named-profile",
        label: "Named profile",
        buildCommands: ["profile build"],
        activationCommands: ["profile activate"],
        activationCheckCommands: ["profile check"],
      }],
      projectBindings: {},
    },
  });
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
        deliveryProfileId: "named-profile",
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
      buildCommands: ["profile build"],
      activationCommands: ["profile activate"],
      activationCheckCommands: ["profile check"],
    });
    assert.deepEqual(stored.spec.deliveryResolution, {
      source: "explicit",
      profileId: "named-profile",
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
  const failed = {
    id: "statistics-failed",
    name: "statistics failed",
    status: "failed",
    sourcePath: "/source",
    taskFile: "/task-failed.yaml",
    spec: { provider: { name: "minimax", model: "m3" } } as TaskRecord["spec"],
    paths: {} as TaskRecord["paths"],
    sessionId: "statistics-failed-session",
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
    error: "HTTP 401: MCP deep audit diagnostic",
  } satisfies TaskRecord;
  store.createTask(failed);
  store.createAttempt({
    id: "statistics-failed-attempt",
    taskId: failed.id,
    ordinal: 1,
    status: "failed",
    sessionId: failed.sessionId,
    rawLogPath: "/log",
    startedAt: timestamp,
    finishedAt: timestamp,
    exitCode: 1,
    costUsd: 0.1,
    turns: 1,
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
    const summaries = (result.structuredContent as { summaries?: Array<Record<string, unknown>> })
      .summaries;
    assert.equal(summaries?.[0]?.model, "m3");
    assert.equal(summaries?.[0]?.sampleSize, 2);
    assert.equal(summaries?.[0]?.costSampleSize, 2);
    assert.equal("failures" in (summaries?.[0] ?? {}), false);
    const compactText = JSON.stringify(result.structuredContent);
    assert.doesNotMatch(
      compactText,
      /"taskId"|"attemptId"|"diagnostic"|MCP deep audit diagnostic|statistics-failed/,
    );

    const deep = await client.callTool({
      name: "forklight_statistics",
      arguments: { provider: "minimax", deepAudit: true },
    });
    const deepSummaries = (deep.structuredContent as {
      summaries?: ProviderModelSummary[];
    }).summaries;
    assert.equal(deepSummaries?.[0]?.sampleSize, 2);
    assert.equal(deepSummaries?.[0]?.failures.length, 1);
    assert.equal(deepSummaries?.[0]?.failures[0]?.taskId, "statistics-failed");
    assert.equal(
      deepSummaries?.[0]?.failures[0]?.diagnostic,
      "HTTP 401: MCP deep audit diagnostic",
    );

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

// --- FL-D92: MCP null unlimited budget ---

function toolErrorText(result: unknown): string {
  if (result === null || typeof result !== "object") return String(result);
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return JSON.stringify(result);
  const first = content[0] as { text?: unknown };
  return typeof first?.text === "string" ? first.text : JSON.stringify(result);
}

function qualityContractArgs(project: string, overrides: Record<string, unknown> = {}) {
  return {
    project,
    name: "budget-null-test",
    contract: {
      outcome: "Prove MCP accepts null unlimited budget",
      context: ["Default may be null; explicit null must stay unlimited"],
      inScope: ["runtime.maxBudgetUsd"],
      outOfScope: ["Provider billing"],
      executionSteps: ["Validate then submit"],
      deliverables: ["Task with null budget"],
      modules: [{
        name: "budget-adapter",
        responsibility: "Map MCP budget field to runtime maxBudgetUsd",
        consumes: ["MCP input"],
        produces: ["Task runtime"],
        boundaries: ["No invented positive cap"],
      }],
      callChain: ["MCP validate -> parseTaskSpec", "parseTaskSpec -> Worker runtime"],
      scenarios: [
        { name: "explicit-null", given: "maxBudgetUsd is null", when: "validate", then: "unlimited" },
        { name: "inherit-null", given: "field omitted and default null", when: "validate", then: "unlimited" },
      ],
      risks: ["Collapsing null via nullish coalescing"],
      changeBudget: { maxFiles: 3, maxDiffLines: 100 },
    },
    acceptance: { criteria: ["Budget resolved correctly"], commands: ["true"] },
    focusPaths: ["src"],
    ...overrides,
  };
}

test("MCP validate accepts explicit null maxBudgetUsd as unlimited (FL-D92)", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-budget-null-"));
  const store = new StateStore(home);
  const { SettingsService } = await import("../src/core/settings.js");
  new SettingsService(store).update({ execution: { defaultMaxBudgetUsd: 0.5 } });
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: "forklight_validate",
      arguments: qualityContractArgs(home, { maxBudgetUsd: null }),
    });
    assert.equal(result.isError, undefined, toolErrorText(result));
    const body = result.structuredContent as Record<string, unknown>;
    assert.equal(body.passed, true);
    assert.equal(body.resolvedRuntimeMaxBudgetUsd, null);
    const budget = body.budget as Record<string, unknown>;
    assert.equal(budget.maxBudgetUsd, null);
    assert.equal(budget.source, "explicit-null");
    assert.equal(budget.generatesRuntimeFlag, false);
    // FL-D10: MCP validate exposes integration feasibility like CLI.
    const feasibility = body.integrationFeasibility as Record<string, unknown>;
    assert.equal(typeof feasibility.integratable, "boolean");
    assert.equal(feasibility.applicable, true);
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP validate inherits null default when maxBudgetUsd is omitted (FL-D92)", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-budget-inherit-"));
  const store = new StateStore(home);
  const { SettingsService } = await import("../src/core/settings.js");
  new SettingsService(store).update({ execution: { defaultMaxBudgetUsd: null } });
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const args = qualityContractArgs(home);
    // Ensure the field is truly omitted, not null.
    assert.equal("maxBudgetUsd" in args, false);
    const result = await client.callTool({
      name: "forklight_validate",
      arguments: args,
    });
    assert.equal(result.isError, undefined, toolErrorText(result));
    const body = result.structuredContent as Record<string, unknown>;
    assert.equal(body.passed, true);
    assert.equal(body.resolvedRuntimeMaxBudgetUsd, null);
    const budget = body.budget as Record<string, unknown>;
    assert.equal(budget.source, "inherited-null");
    assert.equal(budget.generatesRuntimeFlag, false);
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP validate surfaces the canonical workspace boundary advice", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-boundary-"));
  const project = path.join(home, "project");
  await mkdir(project, { recursive: true });
  for (const dir of ["secret-root-alpha", "secret-root-beta"]) {
    await mkdir(path.join(project, dir), { recursive: true });
    await writeFile(path.join(project, dir, "placeholder.txt"), "ignored\n");
  }
  await writeFile(
    path.join(project, ".gitignore"),
    "secret-root-alpha/\nsecret-root-beta/\n",
  );
  await execFileAsync("git", ["init", "-q"], { cwd: project });

  const store = new StateStore(home);
  store.close();
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: "forklight_validate",
      arguments: qualityContractArgs(project),
    });
    assert.equal(result.isError, undefined, toolErrorText(result));
    const body = result.structuredContent as Record<string, unknown>;
    const advice = body.workspaceBoundaryAdvice as Record<string, unknown>;
    assert.ok(advice, "forklight_validate consumes the canonical boundary advice");
    assert.equal(advice.status, "review");
    assert.equal(advice.ignoredDirectoryRootCount, 2);
    assert.equal(advice.coveredCount, 0);
    assert.equal(advice.visibleBusinessCount, 2);
    assert.equal(advice.nextAction, "review-workspace-boundaries");
    // Privacy: no ignored names, project path, Git output, or diagnostics.
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes("secret-root-alpha"));
    assert.ok(!serialized.includes("secret-root-beta"));
    assert.ok(!serialized.includes(project));
    assert.ok(!serialized.includes("fatal"));
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP submit persists explicit null runtime budget (FL-D92)", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-budget-submit-"));
  const store = new StateStore(home);
  const { SettingsService } = await import("../src/core/settings.js");
  // Finite default would wrongly win if inlineTask used `??` with explicit null.
  new SettingsService(store).update({ execution: { defaultMaxBudgetUsd: 0.75 } });
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const submit = await client.callTool({
      name: "forklight_submit",
      arguments: qualityContractArgs(home, {
        maxBudgetUsd: null,
        provider: "deepseek",
      }),
    });
    assert.equal(submit.isError, undefined, toolErrorText(submit));
    const s = submit.structuredContent as Record<string, unknown>;
    const taskId = String(s.taskId);
    const stored = await daemonRequest<TaskRecord>("status", { taskId }, home);
    assert.equal(stored.spec.runtime.maxBudgetUsd, null);
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP list_summaries path returns progress on forklight_list", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-list-"));
  const store = new StateStore(home);
  const taskId = randomUUID();
  const frozenAt = "2026-07-25T11:00:00.000Z";
  // Use a terminal status so daemon recovery does not rewrite the Task mid-test.
  store.createTask({
    id: taskId,
    name: "list-progress",
    status: "succeeded",
    sourcePath: path.join(home, "src"),
    taskFile: path.join(home, "task.yaml"),
    spec: {
      version: 1,
      name: "list-progress",
      project: path.join(home, "src"),
      provider: { name: "deepseek", model: "deepseek-v4-flash", keychainService: "forklight.deepseek.api-key" },
      runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: 0.1 },
      workspace: { exclude: [] },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
      goal: "list",
      constraints: [],
      acceptance: { commands: ["true"] },
    },
    paths: {
      root: path.join(home, "task"),
      baseline: path.join(home, "baseline"),
      workspace: path.join(home, "workspace"),
      logs: path.join(home, "logs"),
      claudeConfig: path.join(home, "claude"),
      diff: path.join(home, "diff.patch"),
    },
    sessionId: "s1",
    createdAt: frozenAt,
    updatedAt: frozenAt,
    finishedAt: frozenAt,
  });
  store.addEvent(taskId, undefined, "task.created", "queued");
  store.addEvent(taskId, undefined, "worker.tool.completed", "edited list.ts");
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const listed = await client.callTool({ name: "forklight_list", arguments: { limit: 10 } });
    assert.equal(listed.isError, undefined);
    const body = listed.structuredContent as { tasks?: Array<Record<string, unknown>> };
    assert.ok(Array.isArray(body.tasks) && body.tasks.length >= 1);
    const row = body.tasks.find((t) => t.taskId === taskId);
    assert.ok(row, "listed row should include the seeded task");
    const progress = row!.progress as Record<string, unknown>;
    assert.ok(progress, "list must carry progress (not status-only)");
    assert.equal(progress.activity, "terminal");
    assert.equal(progress.latestAction, "edited list.ts");
    assert.ok(Number(progress.latestEventSequence) >= 1);
    assert.equal(typeof progress.lastEventAt, "string");
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP compact inspect exposes the same decision packet semantics", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-packet-"));
  const store = new StateStore(home);
  const taskId = randomUUID();
  const frozenAt = "2026-07-25T11:00:00.000Z";
  store.createTask({
    id: taskId,
    name: "packet-inspect",
    status: "succeeded",
    sourcePath: path.join(home, "src"),
    taskFile: path.join(home, "task.yaml"),
    spec: {
      version: 1,
      name: "packet-inspect",
      project: path.join(home, "src"),
      provider: { name: "deepseek", model: "deepseek-v4-flash", keychainService: "forklight.deepseek.api-key" },
      runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: 0.1 },
      workspace: { exclude: [] },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
      goal: "packet",
      constraints: [],
      acceptance: { commands: ["true"] },
      reviewRequirement: { requiredJudges: 2, reason: "High-risk Integration authority" },
    },
    paths: {
      root: path.join(home, "task"),
      baseline: path.join(home, "baseline"),
      workspace: path.join(home, "workspace"),
      logs: path.join(home, "logs"),
      claudeConfig: path.join(home, "claude"),
      diff: path.join(home, "diff.patch"),
    },
    sessionId: "s1",
    createdAt: frozenAt,
    updatedAt: frozenAt,
    finishedAt: frozenAt,
  });
  store.addEvent(taskId, undefined, "verification.completed", "Independent verification passed", {
    passed: true,
    behaviorPassed: true,
    policyPassed: true,
    sourceCompatible: true,
    commands: [{
      command: "true", exitCode: 0, stdout: "SECRET_STDOUT", stderr: "", durationMs: 1, timedOut: false,
    }],
    diffPath: path.join(home, "diff.patch"),
    sourceUnchanged: true,
  });
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const inspected = await client.callTool({
      name: "forklight_inspect",
      arguments: { taskId, summary: true, eventLimit: 5 },
    });
    assert.equal(inspected.isError, undefined);
    const body = inspected.structuredContent as {
      decisionPacket?: {
        kind?: string;
        nextActionCode?: string;
        review?: { status?: string; requiredJudges?: number; missingOpinions?: number };
      };
    };
    assert.equal(body.decisionPacket?.kind, "main-decision-packet");
    assert.equal(body.decisionPacket?.review?.status, "missing");
    assert.equal(body.decisionPacket?.review?.requiredJudges, 2);
    assert.equal(body.decisionPacket?.review?.missingOpinions, 2);
    assert.equal(body.decisionPacket?.nextActionCode, "await-required-review");
    assert.doesNotMatch(JSON.stringify(body.decisionPacket), /SECRET_STDOUT|sk-[A-Za-z0-9_-]{8,}/);
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP wait returns terminal without requiring full inspect", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-wait-"));
  const store = new StateStore(home);
  const taskId = randomUUID();
  const frozenAt = "2026-07-25T11:00:00.000Z";
  store.createTask({
    id: taskId,
    name: "wait-terminal",
    status: "succeeded",
    sourcePath: path.join(home, "src"),
    taskFile: path.join(home, "task.yaml"),
    spec: {
      version: 1,
      name: "wait-terminal",
      project: path.join(home, "src"),
      provider: { name: "deepseek", model: "deepseek-v4-flash", keychainService: "forklight.deepseek.api-key" },
      runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: 0.1 },
      workspace: { exclude: [] },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
      goal: "wait",
      constraints: [],
      acceptance: { commands: ["true"] },
    },
    paths: {
      root: path.join(home, "task"),
      baseline: path.join(home, "baseline"),
      workspace: path.join(home, "workspace"),
      logs: path.join(home, "logs"),
      claudeConfig: path.join(home, "claude"),
      diff: path.join(home, "diff.patch"),
    },
    sessionId: "s1",
    createdAt: frozenAt,
    updatedAt: frozenAt,
    finishedAt: frozenAt,
  });
  store.addEvent(taskId, undefined, "task.created", "queued");
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const waited = await client.callTool({
      name: "forklight_wait",
      arguments: { taskId, timeoutMs: 5_000, pollMs: 200, until: "terminal" },
    });
    assert.equal(waited.isError, undefined, toolErrorText(waited));
    const body = waited.structuredContent as Record<string, unknown>;
    assert.equal(body.outcome, "terminal");
    assert.equal(typeof body.pollCount, "number");
    const progress = body.progress as Record<string, unknown>;
    assert.ok(progress);
    assert.equal(progress.activity, "terminal");
    // Real store event type, not a synthetic "progress" label from wait reconstruction.
    assert.equal(progress.lastEventType, "task.created");
    assert.notEqual(progress.lastEventType, "progress");
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("inlineTask + parseTaskSpec keep explicit null against finite default (FL-D92)", async () => {
  const { inlineTask } = await import("../src/mcp/server.js");
  const { cloneDefaults } = await import("../src/core/settings.js");
  const settings = structuredClone(cloneDefaults());
  settings.execution.defaultMaxBudgetUsd = 0.5;
  const inline = inlineTask(
    qualityContractArgs("/project", { maxBudgetUsd: null }) as Parameters<typeof inlineTask>[0],
    settings,
  );
  assert.equal((inline.runtime as { maxBudgetUsd: unknown }).maxBudgetUsd, null);
  const { parseTaskSpec } = await import("../src/core/task.js");
  const spec = parseTaskSpec(inline, "/project", {
    contractQuality: settings.contractQuality,
    execution: settings.execution,
    providerDefaults: settings.providerDefaults,
    completionPolicy: settings.completionPolicy,
  });
  assert.equal(spec.runtime.maxBudgetUsd, null);
});

// --- Compact Integration MCP response tests ---

// --- M3: MCP taskClass / taskFamily / routingDecision admission ---

/** Default resolved Worker identity under cloneDefaults (deepseek / flash / claude-code / high / default). */
const DEFAULT_FROZEN_WORKER = {
  provider: "deepseek",
  model: "deepseek-v4-flash",
  runtime: "claude-code" as const,
  effort: "high" as const,
  workerProfileId: "default",
};

function routingDecisionFixture(
  overrides: Record<string, unknown> = {},
): RoutingDecisionSnapshot {
  return {
    taskFamily: "main-orchestration-metadata",
    shortlist: [
      DEFAULT_FROZEN_WORKER,
      {
        provider: "qwen",
        model: "qwen3.7-plus",
        runtime: "claude-code",
        effort: "high",
      },
    ],
    selectedWorker: DEFAULT_FROZEN_WORKER,
    selectedBecause: {
      code: "user-specified",
      note: "User prefers this Worker for the current Task class.",
    },
    competition: { intent: "none", triggers: [] },
    evidenceSnapshot: {
      scope: "none",
      exactSampleCounts: {
        "deepseek\0deepseek-v4-flash\0claude-code\0high": 0,
        "qwen\0qwen3.7-plus\0claude-code\0high": 0,
      },
    },
    ...overrides,
  } as RoutingDecisionSnapshot;
}

test("MCP tool discovery describes taskClass, taskFamily, and routingDecision", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-rd-schema-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tools = await client.listTools();
    for (const name of ["forklight_validate", "forklight_submit"] as const) {
      const tool = tools.tools.find((t) => t.name === name);
      assert.ok(tool, `${name} registered`);
      const props = (tool!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
      assert.ok("taskClass" in props, `${name} exposes taskClass`);
      assert.ok("taskFamily" in props, `${name} exposes taskFamily`);
      assert.ok("routingDecision" in props, `${name} exposes routingDecision`);
      // Nested shape may be inlined or $ref-encoded; require the snapshot field names somewhere.
      const schemaText = JSON.stringify(tool!.inputSchema);
      for (const key of [
        "shortlist",
        "selectedWorker",
        "selectedBecause",
        "competition",
        "evidenceSnapshot",
        "exactSampleCounts",
        "advisory",
        "overallResult",
        "followed-recommendation",
        "manual-override",
        "selected-after-cannot-determine",
        "cannotDetermineReasons",
        "selectedExecution",
      ]) {
        assert.ok(schemaText.includes(key), `${name} schema describes ${key}`);
      }
    }
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("inlineTask + parseTaskSpec preserve exact routing metadata without inference", async () => {
  const { inlineTask } = await import("../src/mcp/server.js");
  const { cloneDefaults } = await import("../src/core/settings.js");
  const { parseTaskSpec } = await import("../src/core/task.js");
  const settings = structuredClone(cloneDefaults());
  const routingDecision = routingDecisionFixture();
  const input = qualityContractArgs("/project", {
    taskClass: "m3-mcp-routing-decision-admission",
    taskFamily: "main-orchestration-metadata",
    routingDecision,
  });
  const inline = inlineTask(input as Parameters<typeof inlineTask>[0], settings);
  assert.equal(inline.taskClass, "m3-mcp-routing-decision-admission");
  assert.equal(inline.taskFamily, "main-orchestration-metadata");
  assert.deepEqual(inline.routingDecision, routingDecision);

  const omitted = inlineTask(
    qualityContractArgs("/project") as Parameters<typeof inlineTask>[0],
    settings,
  );
  assert.equal("taskClass" in omitted, false);
  assert.equal("taskFamily" in omitted, false);
  assert.equal("routingDecision" in omitted, false);

  const spec = parseTaskSpec(inline, "/project", {
    contractQuality: settings.contractQuality,
    execution: settings.execution,
    providerDefaults: settings.providerDefaults,
    completionPolicy: settings.completionPolicy,
    workerProfiles: settings.workerProfiles,
    modelCatalog: settings.modelCatalog,
  });
  assert.equal(spec.taskClass, "m3-mcp-routing-decision-admission");
  assert.equal(spec.taskFamily, "main-orchestration-metadata");
  assert.ok(spec.routingDecision);
  assert.equal(spec.routingDecision!.selectedWorker.provider, "deepseek");
  assert.equal(spec.routingDecision!.selectedWorker.model, "deepseek-v4-flash");
  assert.equal(spec.routingDecision!.selectedWorker.runtime, "claude-code");
  assert.equal(spec.routingDecision!.selectedWorker.effort, "high");
  assert.equal(spec.routingDecision!.competition.intent, "none");
  assert.equal(spec.routingDecision!.evidenceSnapshot.scope, "none");
  assert.equal(spec.provider.name, spec.routingDecision!.selectedWorker.provider);
  assert.equal(spec.provider.model, spec.routingDecision!.selectedWorker.model);
  assert.equal(spec.runtime.name, spec.routingDecision!.selectedWorker.runtime);
  assert.equal(spec.runtime.effort, spec.routingDecision!.selectedWorker.effort);
  assert.equal(spec.routingDecision!.advisory, undefined);
});

test("MCP validate/submit preserve routingDecision; identity drift and omit stay compatible", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-rd-admit-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const routingDecision = routingDecisionFixture();
    const withMeta = qualityContractArgs(home, {
      taskClass: "m3-mcp-routing-decision-admission",
      taskFamily: "main-orchestration-metadata",
      routingDecision,
    });

    const valid = await client.callTool({
      name: "forklight_validate",
      arguments: withMeta,
    });
    assert.equal(valid.isError, undefined, toolErrorText(valid));
    assert.equal((valid.structuredContent as { passed?: boolean }).passed, true);

    // Identity drift: selectedWorker is Grok but resolved Worker is default DeepSeek.
    const drift = await client.callTool({
      name: "forklight_validate",
      arguments: qualityContractArgs(home, {
        taskClass: "m3-mcp-routing-decision-admission",
        taskFamily: "main-orchestration-metadata",
        routingDecision: routingDecisionFixture({
          shortlist: [{
            provider: "xai",
            model: "grok-4.5",
            runtime: "grok-build",
            effort: "high",
            workerProfileId: "local-grok-builder",
          }],
          selectedWorker: {
            provider: "xai",
            model: "grok-4.5",
            runtime: "grok-build",
            effort: "high",
            workerProfileId: "local-grok-builder",
          },
        }),
      }),
    });
    assert.equal(drift.isError, true, "identity drift must fail before admission");
    assert.match(toolErrorText(drift), /does not match resolved Task provider|routingDecision/);

    // Malformed competition: consider without triggers — rejected by parseTaskSpec.
    const malformed = await client.callTool({
      name: "forklight_validate",
      arguments: qualityContractArgs(home, {
        taskClass: "m3-mcp-routing-decision-admission",
        routingDecision: routingDecisionFixture({
          competition: { intent: "consider", triggers: [] },
        }),
      }),
    });
    assert.equal(malformed.isError, true, "malformed competition metadata must fail before admission");
    assert.match(toolErrorText(malformed), /triggers must be non-empty/);

    // Legacy omission remains compatible.
    const legacy = await client.callTool({
      name: "forklight_validate",
      arguments: qualityContractArgs(home),
    });
    assert.equal(legacy.isError, undefined, toolErrorText(legacy));
    assert.equal((legacy.structuredContent as { passed?: boolean }).passed, true);
    assert.equal(
      (legacy.structuredContent as { routingExplanation?: { advisory?: unknown } }).routingExplanation?.advisory,
      null,
      "legacy omit must not invent an advisory relationship",
    );

    // Submit persists the exact snapshot on the stored Task.
    const submit = await client.callTool({
      name: "forklight_submit",
      arguments: withMeta,
    });
    assert.equal(submit.isError, undefined, toolErrorText(submit));
    const taskId = String((submit.structuredContent as { taskId?: string }).taskId);
    const stored = await daemonRequest<TaskRecord>("status", { taskId }, home);
    assert.equal(stored.spec.taskClass, "m3-mcp-routing-decision-admission");
    assert.equal(stored.spec.taskFamily, "main-orchestration-metadata");
    assert.ok(stored.spec.routingDecision);
    assert.deepEqual(stored.spec.routingDecision, routingDecision);
    assert.equal(stored.spec.provider.name, routingDecision.selectedWorker.provider);
    assert.equal(stored.spec.provider.model, routingDecision.selectedWorker.model);
    assert.equal(stored.spec.runtime.name, routingDecision.selectedWorker.runtime);
    assert.equal(stored.spec.runtime.effort, routingDecision.selectedWorker.effort);
    assert.equal(stored.spec.workerProfileId, routingDecision.selectedWorker.workerProfileId);

    // Legacy submit invents nothing.
    const legacySubmit = await client.callTool({
      name: "forklight_submit",
      arguments: qualityContractArgs(home, { name: "legacy-omit-routing" }),
    });
    assert.equal(legacySubmit.isError, undefined, toolErrorText(legacySubmit));
    const legacyId = String((legacySubmit.structuredContent as { taskId?: string }).taskId);
    const legacyStored = await daemonRequest<TaskRecord>("status", { taskId: legacyId }, home);
    assert.equal(legacyStored.spec.taskClass, undefined);
    assert.equal(legacyStored.spec.taskFamily, undefined);
    assert.equal(legacyStored.spec.routingDecision, undefined);
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

const MCP_QWEN_WORKER = {
  provider: "qwen",
  model: "qwen3.7-plus",
  runtime: "claude-code",
  effort: "high",
};
const MCP_SELECTED_EXECUTION = {
  resolvedExecutionMode: "single-run" as const,
  readinessState: "launchable" as const,
  canLaunch: true,
  nextAction: "none" as const,
};

test("MCP validate/submit carry frozen advisory relationship and hide private fields", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-rd-adv-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const followedAdvisory: FrozenRoutingAdvisorySnapshot = {
      overallResult: "recommended",
      selection: "followed-recommendation",
      recommendedWorker: DEFAULT_FROZEN_WORKER,
      confidence: 0.91,
      selectedExecution: MCP_SELECTED_EXECUTION,
    };
    const followed = routingDecisionFixture({
      selectedBecause: {
        code: "user-specified",
        note: "PRIVATE_MCP_M3B_NOTE",
      },
      evidenceSnapshot: {
        scope: "none",
        exactSampleCounts: { SECRET_MCP_SAMPLE_KEY: 0 },
        settingsDigest: "SECRET_MCP_SETTINGS_DIGEST",
      },
      advisory: followedAdvisory,
    });
    const followedArgs = qualityContractArgs(home, {
      taskClass: "m3-b-durable-routing-override",
      taskFamily: "main-orchestration-metadata",
      routingDecision: followed,
    });
    const valid = await client.callTool({ name: "forklight_validate", arguments: followedArgs });
    assert.equal(valid.isError, undefined, toolErrorText(valid));
    const body = valid.structuredContent as {
      passed?: boolean;
      routingExplanation?: {
        advisory?: {
          selection?: string;
          confidence?: number;
          recommendedWorker?: unknown;
          overallResult?: string;
        };
      };
    };
    assert.equal(body.passed, true);
    assert.equal(body.routingExplanation?.advisory?.selection, "followed-recommendation");
    assert.equal(body.routingExplanation?.advisory?.overallResult, "recommended");
    assert.equal(body.routingExplanation?.advisory?.confidence, 0.91);
    assert.deepEqual(body.routingExplanation?.advisory?.recommendedWorker, DEFAULT_FROZEN_WORKER);
    const serialized = JSON.stringify(valid);
    assert.ok(!serialized.includes("PRIVATE_MCP_M3B_NOTE"));
    assert.ok(!serialized.includes("SECRET_MCP_SAMPLE_KEY"));
    assert.ok(!serialized.includes("SECRET_MCP_SETTINGS_DIGEST"));

    const override = routingDecisionFixture({
      selectedBecause: { code: "user-specified", note: "PRIVATE_MCP_M3B_NOTE" },
      advisory: {
        overallResult: "recommended",
        selection: "manual-override",
        recommendedWorker: MCP_QWEN_WORKER,
        confidence: 0.84,
        selectedExecution: MCP_SELECTED_EXECUTION,
      },
    });
    const overrideValid = await client.callTool({
      name: "forklight_validate",
      arguments: qualityContractArgs(home, {
        taskClass: "m3-b-durable-routing-override",
        taskFamily: "main-orchestration-metadata",
        routingDecision: override,
      }),
    });
    assert.equal(overrideValid.isError, undefined, toolErrorText(overrideValid));
    const overrideBody = overrideValid.structuredContent as {
      routingExplanation?: { advisory?: { selection?: string; recommendedWorker?: unknown } };
    };
    assert.equal(overrideBody.routingExplanation?.advisory?.selection, "manual-override");
    assert.deepEqual(overrideBody.routingExplanation?.advisory?.recommendedWorker, MCP_QWEN_WORKER);

    const cannotDetermine = routingDecisionFixture({
      selectedBecause: { code: "user-specified", note: "PRIVATE_MCP_M3B_NOTE" },
      advisory: {
        overallResult: "cannot-determine",
        selection: "selected-after-cannot-determine",
        cannotDetermineReasons: ["insufficient-relevant-samples"],
        selectedExecution: MCP_SELECTED_EXECUTION,
      },
    });
    const cannotValid = await client.callTool({
      name: "forklight_validate",
      arguments: qualityContractArgs(home, {
        taskClass: "m3-b-durable-routing-override",
        taskFamily: "main-orchestration-metadata",
        routingDecision: cannotDetermine,
      }),
    });
    assert.equal(cannotValid.isError, undefined, toolErrorText(cannotValid));
    const cannotBody = cannotValid.structuredContent as {
      routingExplanation?: {
        advisory?: { selection?: string; recommendedWorker?: unknown; confidence?: number };
      };
    };
    assert.equal(cannotBody.routingExplanation?.advisory?.selection, "selected-after-cannot-determine");
    assert.equal(cannotBody.routingExplanation?.advisory?.recommendedWorker, undefined);
    assert.equal(cannotBody.routingExplanation?.advisory?.confidence, undefined);

    const contradictory = await client.callTool({
      name: "forklight_validate",
      arguments: qualityContractArgs(home, {
        taskClass: "m3-b-durable-routing-override",
        routingDecision: routingDecisionFixture({
          selectedBecause: { code: "user-specified", note: "PRIVATE_MCP_M3B_NOTE" },
          advisory: {
            overallResult: "recommended",
            selection: "manual-override",
            recommendedWorker: DEFAULT_FROZEN_WORKER,
            confidence: 0.5,
            selectedExecution: MCP_SELECTED_EXECUTION,
          },
        }),
      }),
    });
    assert.equal(contradictory.isError, true, "contradictory override must fail before admission");
    assert.match(toolErrorText(contradictory), /cannot be manual-override when selectedWorker matches/);
    assert.ok(!toolErrorText(contradictory).includes("PRIVATE_MCP_M3B_NOTE"));

    const submit = await client.callTool({
      name: "forklight_submit",
      arguments: followedArgs,
    });
    assert.equal(submit.isError, undefined, toolErrorText(submit));
    const taskId = String((submit.structuredContent as { taskId?: string }).taskId);
    const stored = await daemonRequest<TaskRecord>("status", { taskId }, home);
    assert.deepEqual(stored.spec.routingDecision?.advisory, followedAdvisory);
    assert.equal(followed.advisory?.selection, "followed-recommendation");
    assert.equal(stored.spec.routingDecision?.selectedBecause.note, "PRIVATE_MCP_M3B_NOTE");

    const twin = { ...DEFAULT_FROZEN_WORKER, workerProfileId: "default-twin" };
    const profileOverride = await client.callTool({
      name: "forklight_validate",
      arguments: qualityContractArgs(home, {
        taskClass: "m3-b-durable-routing-override",
        taskFamily: "main-orchestration-metadata",
        routingDecision: routingDecisionFixture({
          shortlist: [DEFAULT_FROZEN_WORKER, twin],
          selectedBecause: { code: "user-specified", note: "PRIVATE_MCP_M3B_NOTE" },
          advisory: {
            overallResult: "recommended",
            selection: "manual-override",
            recommendedWorker: twin,
            confidence: 0.84,
            selectedExecution: MCP_SELECTED_EXECUTION,
          },
        }),
      }),
    });
    assert.equal(profileOverride.isError, undefined, toolErrorText(profileOverride));
    const profileBody = profileOverride.structuredContent as {
      routingExplanation?: { advisory?: { selection?: string; recommendedWorker?: { workerProfileId?: string } } };
    };
    assert.equal(profileBody.routingExplanation?.advisory?.selection, "manual-override");
    assert.equal(profileBody.routingExplanation?.advisory?.recommendedWorker?.workerProfileId, "default-twin");
    assert.ok(!JSON.stringify(profileOverride).includes("PRIVATE_MCP_M3B_NOTE"));

    const modeMismatch = await client.callTool({
      name: "forklight_validate",
      arguments: qualityContractArgs(home, {
        taskClass: "m3-b-durable-routing-override",
        taskFamily: "main-orchestration-metadata",
        routingDecision: routingDecisionFixture({
          selectedBecause: { code: "user-specified", note: "PRIVATE_MCP_M3B_NOTE" },
          advisory: {
            overallResult: "cannot-determine",
            selection: "selected-after-cannot-determine",
            cannotDetermineReasons: ["insufficient-relevant-samples"],
            selectedExecution: {
              ...MCP_SELECTED_EXECUTION,
              resolvedExecutionMode: "native-goal",
            },
          },
        }),
      }),
    });
    assert.equal(modeMismatch.isError, true, "mode mismatch must fail before admission");
    assert.match(toolErrorText(modeMismatch), /does not match resolved Task executionMode/);
    assert.ok(!toolErrorText(modeMismatch).includes("PRIVATE_MCP_M3B_NOTE"));
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP validates the same optional Main-authored presentation shape as YAML Tasks", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-presentation-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const base = qualityContractArgs(home);
    const contract = base.contract as Record<string, unknown>;
    const valid = await client.callTool({
      name: "forklight_validate",
      arguments: {
        ...base,
        contract: {
          ...contract,
          presentation: {
            summary: "Explain the requested result to the user before technical details.",
            language: "en-GB",
          },
        },
      },
    });
    assert.equal(valid.isError, undefined, toolErrorText(valid));

    const invalid = await client.callTool({
      name: "forklight_validate",
      arguments: {
        ...base,
        contract: {
          ...contract,
          presentation: { summary: "line one\nline two", language: "en" },
        },
      },
    });
    assert.equal(invalid.isError, true);
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP integration status/wait are compact by default in both surfaces, full with detail=full", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-compact-"));
  const store = new StateStore(home);
  const { task } = await seedSucceededTask(store, home);
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const pf = await client.callTool({
      name: "forklight_integration_preflight", arguments: { taskId: task.id },
    });
    const receipt = pf.structuredContent as IntegrationReceiptRecord;
    const applied = await client.callTool({
      name: "forklight_integration_apply",
      arguments: { taskId: task.id, receiptId: receipt.id, confirm: true },
    });
    const operationId = (applied.structuredContent as { operationId: string }).operationId;
    await client.callTool({
      name: "forklight_integration_wait", arguments: { operationId, timeoutMs: 5_000 },
    });

    // --- Default compact status: both content & structuredContent are compact ---
    const cs = await client.callTool({
      name: "forklight_integration_status", arguments: { operationId },
    });
    assert.equal(cs.isError, undefined);
    const csText = (cs.content as Array<{ type: string; text: string }>)[0]!.text;
    const csData = cs.structuredContent as CompactIntegrationOperationView;

    assert.ok(!csText.includes("stdout"), "compact status text excludes stdout");
    assert.ok(!csText.includes("stderr"), "compact status text excludes stderr");
    assert.ok(csText.length < 5_000, `compact status bounded, got ${csText.length}`);
    assert.equal(typeof csData.operationId, "string");
    assert.ok(Array.isArray(csData.stages));
    for (const s of csData.stages) {
      assert.equal(typeof s.commandCount, "number");
      assert.ok(!("commands" in s), "compact structuredContent must not have raw commands");
    }

    // --- Default compact wait: same guarantees ---
    const cw = await client.callTool({
      name: "forklight_integration_wait", arguments: { operationId, timeoutMs: 1_000 },
    });
    assert.equal(cw.isError, undefined);
    const cwText = (cw.content as Array<{ type: string; text: string }>)[0]!.text;
    assert.ok(!cwText.includes("stdout"), "compact wait text excludes stdout");
    const cwData = cw.structuredContent as CompactIntegrationOperationView;
    assert.ok(Array.isArray(cwData.stages));
    for (const s of cwData.stages) {
      assert.ok(!("commands" in s), "compact wait structuredContent must not have raw commands");
    }

    // --- Full detail status: complete view ---
    const fs = await client.callTool({
      name: "forklight_integration_status", arguments: { operationId, detail: "full" },
    });
    assert.equal(fs.isError, undefined);
    const fsData = fs.structuredContent as Record<string, unknown>;
    assert.ok(fsData.result !== undefined, "full detail status has result");
    const fsStages = fsData.stages as IntegrationStageEvidence[] | undefined;
    assert.ok(Array.isArray(fsStages) && fsStages.length > 0, "full detail stages present");

    // --- Full detail wait: complete view ---
    const fw = await client.callTool({
      name: "forklight_integration_wait",
      arguments: { operationId, timeoutMs: 1_000, detail: "full" },
    });
    assert.equal(fw.isError, undefined);
    assert.ok((fw.structuredContent as Record<string, unknown>).result !== undefined,
      "full detail wait has result");
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP forklight_correct tool schema validates feedback, budget, and confirm", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-corr-"));
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tool = (await client.listTools()).tools
      .find((candidate) => candidate.name === "forklight_correct");
    assert.ok(tool, "forklight_correct tool must be registered");
    assert.equal(tool?.annotations?.readOnlyHint, false);
    // Confirm required
    const noConfirm = await client.callTool({
      name: "forklight_correct",
      arguments: { taskId: "00000000-0000-4000-8000-000000000001", feedback: "Fix it" },
    });
    assert.ok(noConfirm.isError);
    // Empty feedback rejected
    const emptyFb = await client.callTool({
      name: "forklight_correct",
      arguments: {
        taskId: "00000000-0000-4000-8000-000000000001",
        feedback: "   ",
        confirm: true,
      },
    });
    assert.ok(emptyFb.isError);
    const incompleteStructured = await client.callTool({
      name: "forklight_correct",
      arguments: {
        taskId: "00000000-0000-4000-8000-000000000001",
        feedback: "Keep the useful output and fix the remaining gap",
        candidateRevisionId: "00000000-0000-4000-8000-000000000002",
        confirm: true,
      },
    });
    assert.ok(incompleteStructured.isError, "structured correction fields are all-or-none");
    const inputSchema = tool?.inputSchema as { properties?: Record<string, unknown> };
    assert.ok(inputSchema.properties?.candidateRevisionId);
    assert.ok(inputSchema.properties?.reusablePaths);
    assert.ok(inputSchema.properties?.remainingGaps);
  } finally {
    await client.close();
    await server.close();
  }
});

test("MCP resolve/reopen tools require confirm and bounded closed inputs", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-resolve-"));
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const resolveTool = (await client.listTools()).tools
      .find((candidate) => candidate.name === "forklight_task_resolve");
    assert.ok(resolveTool, "forklight_task_resolve tool must be registered");
    assert.equal(resolveTool?.annotations?.readOnlyHint, false);
    const reopenTool = (await client.listTools()).tools
      .find((candidate) => candidate.name === "forklight_task_reopen");
    assert.ok(reopenTool, "forklight_task_reopen tool must be registered");
    assert.equal(reopenTool?.annotations?.readOnlyHint, false);

    // Confirm required on resolve.
    const noConfirm = await client.callTool({
      name: "forklight_task_resolve",
      arguments: {
        taskId: "00000000-0000-4000-8000-000000000001",
        reason: "environment-recovered",
        note: "env fixed",
      },
    });
    assert.ok(noConfirm.isError);

    // Unknown reason rejected.
    const badReason = await client.callTool({
      name: "forklight_task_resolve",
      arguments: {
        taskId: "00000000-0000-4000-8000-000000000001",
        reason: "auto-fixed",
        note: "x",
        confirm: true,
      },
    });
    assert.ok(badReason.isError);

    // Overlong note rejected before daemon contact.
    const overlongNote = await client.callTool({
      name: "forklight_task_resolve",
      arguments: {
        taskId: "00000000-0000-4000-8000-000000000001",
        reason: "superseded",
        note: "x".repeat(501),
        confirm: true,
      },
    });
    assert.ok(overlongNote.isError);

    // Confirm required on reopen.
    const reopenNoConfirm = await client.callTool({
      name: "forklight_task_reopen",
      arguments: { taskId: "00000000-0000-4000-8000-000000000001", note: "again" },
    });
    assert.ok(reopenNoConfirm.isError);

    const inputSchema = resolveTool?.inputSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    assert.ok(inputSchema.properties?.reason);
    assert.ok(inputSchema.properties?.evidenceTaskId);
    assert.ok((inputSchema.required ?? []).includes("confirm"), "confirm is required");
    // The public contract describes the shared succeeded-not-delivered eligibility
    // so Main can close stale successful work through the same tool.
    assert.match(resolveTool?.description ?? "", /succeeded.*no delivered outcome/i);
  } finally {
    await client.close();
    await server.close();
  }
});

test("MCP task_resolve/reopen close and reopen a succeeded non-delivered Task", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-resolve-succeeded-"));
  const store = new StateStore(home);
  const taskId = randomUUID();
  store.createTask({
    id: taskId,
    name: "succeeded-resolve",
    status: "succeeded",
    sourcePath: "/source",
    taskFile: `/task-${taskId}.yaml`,
    spec: {
      version: 1,
      name: "succeeded-resolve",
      project: "/source",
      provider: { name: "deepseek", model: "deepseek-v4-flash", keychainService: "forklight.test" },
      runtime: { name: "claude-code", executable: "claude", effort: "high", maxBudgetUsd: null },
      workspace: { exclude: [] },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
      goal: "surface",
      constraints: [],
      acceptance: { commands: ["true"] },
    },
    paths: {
      root: "/state/task",
      baseline: "/state/task/baseline",
      workspace: "/state/task/workspace",
      logs: "/state/task/logs",
      claudeConfig: "/state/task/claude",
      diff: "/state/task/diff.patch",
    },
    sessionId: "session",
    createdAt: "2026-08-03T12:00:00.000Z",
    updatedAt: "2026-08-03T12:00:00.000Z",
  });
  store.addEvent(taskId, undefined, "verification.completed", "Independent verification passed", {
    passed: true,
    behaviorPassed: true,
    policyPassed: true,
    sourceCompatible: true,
    commands: [],
    diffPath: "/state/task/diff.patch",
    sourceUnchanged: false,
  });
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const resolved = await client.callTool({
      name: "forklight_task_resolve",
      arguments: { taskId, reason: "no-longer-needed", confirm: true },
    });
    assert.equal(resolved.isError, undefined, toolErrorText(resolved));
    const body = resolved.structuredContent as Record<string, unknown>;
    assert.equal((body.state as Record<string, unknown>).status, "resolved");
    assert.equal(body.boardScope, "history");
    assert.equal(body.boardReason, "attention-resolved");

    const reopened = await client.callTool({
      name: "forklight_task_reopen",
      arguments: { taskId, confirm: true },
    });
    assert.equal(reopened.isError, undefined, toolErrorText(reopened));
    const reopenBody = reopened.structuredContent as Record<string, unknown>;
    assert.equal((reopenBody.state as Record<string, unknown>).status, "reopened");
    assert.equal(reopenBody.boardScope, "now");
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP review_graph_repair_result requires confirm, is one-shot, and stays privacy-safe", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-repair-"));
  const sourceDir = path.join(home, "source");
  await mkdir(path.join(sourceDir, "src"), { recursive: true });
  await writeFile(path.join(sourceDir, "readme.md"), "# hello\n\nOriginal.\n");
  await writeFile(path.join(sourceDir, "src/app.ts"), "export const n = 1;\n");
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const taskId = randomUUID();
  const paths = taskPaths(home, taskId);
  const spec: TaskSpec = {
    version: 1,
    name: "MCP repair fixture",
    project: sourceDir,
    goal: "Ship a small change",
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
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src", "readme.md"] },
    acceptance: { commands: ["true"] },
  };
  await prepareWorkspace(spec, paths);
  await mkdir(path.join(paths.workspace, "src"), { recursive: true });
  await writeFile(path.join(paths.workspace, "readme.md"), "# hello\n\nChanged.\n");
  await writeFile(path.join(paths.workspace, "src/app.ts"), "export const n = 2;\n");
  await writeWorkspacePatchReport(paths, createPathPolicy(spec));
  const now = new Date().toISOString();
  store.createTask({
    id: taskId,
    name: spec.name,
    status: "succeeded",
    sourcePath: sourceDir,
    taskFile: "forklight://test/mcp-repair",
    spec,
    paths,
    sessionId: "session-mcp-repair",
    currentAttemptId: "attempt-mcp-repair",
    createdAt: now,
    updatedAt: now,
  });
  store.createAttempt({
    id: "attempt-mcp-repair",
    taskId,
    ordinal: 1,
    status: "succeeded",
    sessionId: "session-mcp-repair",
    rawLogPath: path.join(paths.logs, "attempt-1.jsonl"),
    startedAt: now,
    finishedAt: now,
    exitCode: 0,
  });
  const verEvent = store.addEvent(taskId, "attempt-mcp-repair", "verification.completed", "passed", {
    passed: true,
    behaviorPassed: true,
    policyPassed: true,
    sourceCompatible: true,
    commands: [{ command: "true", exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false }],
    diffPath: paths.diff,
    sourceUnchanged: true,
  } satisfies VerificationResult);
  const revision = await captureCandidateRevision(
    store,
    store.getTask(taskId),
    store.getAttempt("attempt-mcp-repair"),
    verEvent.sequence,
    true,
    ["readme.md", "src/app.ts"],
    2,
    4,
  );
  const profileA = settings.get().workerProfiles.defaultProfileId;
  const profileB = settings.get().workerProfiles.profiles.find((profile) => profile.id !== profileA)!.id;
  const created = await createReviewGraph(store, settings.get(), {
    candidateTaskId: taskId,
    reviewerWorkerProfileIds: [profileA, profileB],
    reason: "MCP repair fixture",
    confirm: true,
  });
  const [usable, failed] = store.listReviewAssignments(created.graph.id);
  const finish = (reviewerTaskId: string, resultText: string) => {
    const task = store.getTask(reviewerTaskId);
    store.createAttempt({
      id: `att-${reviewerTaskId}`,
      taskId: reviewerTaskId,
      ordinal: 1,
      status: "succeeded",
      sessionId: task.sessionId,
      rawLogPath: path.join(task.paths.logs, "attempt-1.jsonl"),
      startedAt: now,
      finishedAt: now,
      exitCode: 0,
      resultText,
    });
    store.setTaskStatus(reviewerTaskId, "succeeded", {
      finishedAt: now,
      currentAttemptId: `att-${reviewerTaskId}`,
    });
  };
  finish(usable!.reviewerTaskId, JSON.stringify({
    schemaVersion: 1,
    reviewedRevisionId: revision.id,
    proposedDisposition: "accept",
    summary: "Usable first opinion",
    findings: [],
  }));
  finish(failed!.reviewerTaskId, JSON.stringify({
    schemaVersion: 1,
    reviewedRevisionId: revision.id,
    proposedDisposition: "accept",
    summary: "s".repeat(507),
    findings: [],
  }));
  reconcileAllReviewGraphs(store);
  const assignmentId = failed!.id;
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const missingConfirm = await client.callTool({
      name: "forklight_review_graph_repair_result",
      arguments: {
        taskId,
        assignmentId,
        reason: "shorten summary",
      },
    });
    assert.equal(missingConfirm.isError, true);

    const first = await client.callTool({
      name: "forklight_review_graph_repair_result",
      arguments: {
        taskId,
        assignmentId,
        reason: "shorten summary",
        confirm: true,
      },
    });
    assert.equal(first.isError, undefined, toolErrorText(first));
    const data = first.structuredContent as Record<string, unknown>;
    assert.equal(data.created, true);
    assert.equal(data.originalFailureCode, "schema-violation");
    const graph = data.graph as Record<string, unknown>;
    assert.equal((graph.assignments as unknown[]).length, 2);
    const serialized = JSON.stringify(first);
    assert.ok(!serialized.includes("privatePacketPath"));
    assert.ok(!serialized.includes("packet.json"));
    assert.ok(!serialized.includes("s".repeat(507)));
    assert.ok(!serialized.includes("keychain"));
    assert.ok(!/\/Users\//.test(serialized));

    const second = await client.callTool({
      name: "forklight_review_graph_repair_result",
      arguments: {
        taskId,
        assignmentId,
        reason: "shorten summary again",
        confirm: true,
      },
    });
    assert.equal(second.isError, true);
    assert.match(toolErrorText(second), /already consumed|one-shot/i);
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("MCP main-token capture and status are count-only and status is read-only", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-m4a-"));
  const store = new StateStore(home);
  const { parseTaskSpec } = await import("../src/core/task.js");
  const { buildTaskRecord } = await import("../src/core/runner.js");
  const spec = parseTaskSpec({
    version: 1, name: "mcp-mu", project: "/tmp", goal: "T",
    taskClass: "edit-task", taskFamily: "forklight-storage-lifecycle",
    directCodexProfileId: "codex-main-v1", acceptance: { commands: ["true"] },
  }, "/tmp");
  store.createTask(buildTaskRecord({
    spec, taskFile: "/tmp/mcp-mu.yaml", home, id: "mcp-mu",
    sessionId: "s-mcp-mu", createdAt: "2026-08-17T12:00:00.000Z",
  }));
  const before = {
    samples: store.countMainUsageSamples(),
    events: store.listEvents("mcp-mu").length,
    receipts: store.listExchangeReceipts("mcp-mu").length,
    tasks: store.listTasks().length,
  };
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const usage = {
    type: "turn.completed",
    usage: {
      input_tokens: 4000, cached_input_tokens: 1000, cache_write_input_tokens: 0,
      output_tokens: 500, reasoning_output_tokens: 100,
    },
  };
  try {
    const empty = await client.callTool({
      name: "forklight_main_token_status",
      arguments: { taskId: "mcp-mu", comparisonId: "cmp-mcp" },
    });
    assert.equal(empty.isError, undefined, toolErrorText(empty));
    const emptyData = empty.structuredContent as Record<string, unknown>;
    assert.deepEqual(emptyData.missingRoles, ["direct-main", "delegated-main"]);
    assert.equal(emptyData.countComplete, false);
    assert.equal("saving" in emptyData, false);

    const captured = await client.callTool({
      name: "forklight_main_token_capture",
      arguments: {
        taskId: "mcp-mu", comparisonId: "cmp-mcp", role: "direct-main",
        runRef: "codex-run:mcp-direct", usage,
      },
    });
    assert.equal(captured.isError, undefined, toolErrorText(captured));
    const sample = captured.structuredContent as Record<string, unknown>;
    assert.equal(sample.inputTokens, 3000);
    assert.equal(sample.grossTokens, 4500);
    assert.equal(sample.source, "codex-terminal-result");
    assert.equal("saving" in sample, false);

    const status1 = await client.callTool({
      name: "forklight_main_token_status",
      arguments: { taskId: "mcp-mu", comparisonId: "cmp-mcp" },
    });
    const status2 = await client.callTool({
      name: "forklight_main_token_status",
      arguments: { taskId: "mcp-mu", comparisonId: "cmp-mcp" },
    });
    assert.deepEqual(status1.structuredContent, status2.structuredContent);
    const status = status1.structuredContent as Record<string, unknown>;
    assert.deepEqual(status.capturedRoles, ["direct-main"]);
    assert.deepEqual(status.missingRoles, ["delegated-main"]);
    assert.equal("change" in status, false);
    assert.equal("directCodexSavings" in status, false);

    const check = new StateStore(home);
    assert.equal(check.countMainUsageSamples(), before.samples + 1);
    assert.equal(check.listEvents("mcp-mu").length, before.events);
    assert.equal(check.listExchangeReceipts("mcp-mu").length, before.receipts);
    assert.equal(check.listTasks().length, before.tasks);
    check.close();
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP main-token capture-episode is count-only and agrees with status", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-m4e-"));
  const store = new StateStore(home);
  const { parseTaskSpec } = await import("../src/core/task.js");
  const { buildTaskRecord } = await import("../src/core/runner.js");
  const spec = parseTaskSpec({
    version: 1, name: "mcp-ep", project: "/tmp", goal: "T",
    taskClass: "edit-task", taskFamily: "forklight-storage-lifecycle",
    directCodexProfileId: "codex-main-v1", acceptance: { commands: ["true"] },
  }, "/tmp");
  store.createTask(buildTaskRecord({
    spec, taskFile: "/tmp/mcp-ep.yaml", home, id: "mcp-ep",
    sessionId: "s-mcp-ep", createdAt: "2026-08-17T12:00:00.000Z",
  }));
  store.close();
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const first = {
    type: "turn.completed",
    usage: {
      input_tokens: 4000, cached_input_tokens: 1000, cache_write_input_tokens: 200,
      output_tokens: 500, reasoning_output_tokens: 100,
    },
  };
  const second = {
    type: "turn.completed",
    usage: {
      input_tokens: 2500, cached_input_tokens: 800, cache_write_input_tokens: 100,
      output_tokens: 400, reasoning_output_tokens: 80,
    },
  };
  try {
    const captured = await client.callTool({
      name: "forklight_main_token_capture_episode",
      arguments: {
        taskId: "mcp-ep", comparisonId: "cmp-mcp-ep", role: "delegated-main",
        runRef: "codex-run:mcp-episode",
        segments: [
          { runRef: "codex-run:mcp-ep-a", usage: first },
          { runRef: "codex-run:mcp-ep-b", usage: second },
        ],
      },
    });
    assert.equal(captured.isError, undefined, toolErrorText(captured));
    const sample = captured.structuredContent as Record<string, unknown>;
    assert.equal(sample.schemaVersion, 2);
    assert.equal("saving" in sample, false);
    assert.equal("prompt" in sample, false);
    const segments = sample.segments as Array<Record<string, unknown>>;
    assert.equal(segments.length, 2);
    assert.equal(segments[0]?.runRef, "codex-run:mcp-ep-a");
    assert.equal(
      sample.inputTokens,
      (segments[0]?.inputTokens as number) + (segments[1]?.inputTokens as number),
    );
    assert.equal(
      sample.grossTokens,
      (segments[0]?.grossTokens as number) + (segments[1]?.grossTokens as number),
    );
    const status1 = await client.callTool({
      name: "forklight_main_token_status",
      arguments: { taskId: "mcp-ep", comparisonId: "cmp-mcp-ep" },
    });
    const status2 = await client.callTool({
      name: "forklight_main_token_status",
      arguments: { taskId: "mcp-ep", comparisonId: "cmp-mcp-ep" },
    });
    assert.deepEqual(status1.structuredContent, status2.structuredContent);
    const status = status1.structuredContent as Record<string, unknown>;
    assert.deepEqual(status.capturedRoles, ["delegated-main"]);
    assert.equal("saving" in status, false);
    const statusSample = (status.samples as Array<Record<string, unknown>>)[0];
    assert.equal(statusSample?.grossTokens, sample.grossTokens);
    assert.equal((statusSample?.segments as unknown[]).length, 2);
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP main-token assess and pair-report are privacy-safe and report is read-only", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-m4b-"));
  const store = new StateStore(home);
  const { parseTaskSpec } = await import("../src/core/task.js");
  const { buildTaskRecord } = await import("../src/core/runner.js");
  const spec = parseTaskSpec({
    version: 1, name: "mcp-pair", project: "/tmp", goal: "T",
    taskClass: "edit-task", taskFamily: "forklight-storage-lifecycle",
    directCodexProfileId: "codex-main-v1", acceptance: { commands: ["true"] },
  }, "/tmp");
  store.createTask(buildTaskRecord({
    spec, taskFile: "/tmp/mcp-pair.yaml", home, id: "mcp-pair",
    sessionId: "s-mcp-pair", createdAt: "2026-08-17T12:00:00.000Z",
  }));
  store.saveMainUsageSample({
    sampleId: "mcppaird", forklightTaskId: "mcp-pair", comparisonId: "cmp-mcp-pair",
    role: "direct-main", taskClass: "edit-task", taskFamily: "forklight-storage-lifecycle",
    directCodexProfileId: "codex-main-v1", inputTokens: 4000, outputTokens: 500,
    cacheReadInputTokens: 0, cacheCreationInputTokens: 0, grossTokens: 4500,
    source: "codex-terminal-result", runRef: "codex-run:mcp-pair-d",
    capturedAt: "2026-08-17T12:00:00.000Z", schemaVersion: 1,
  });
  store.saveMainUsageSample({
    sampleId: "mcppairg", forklightTaskId: "mcp-pair", comparisonId: "cmp-mcp-pair",
    role: "delegated-main", taskClass: "edit-task", taskFamily: "forklight-storage-lifecycle",
    directCodexProfileId: "codex-main-v1", inputTokens: 1200, outputTokens: 300,
    cacheReadInputTokens: 0, cacheCreationInputTokens: 0, grossTokens: 1500,
    source: "codex-terminal-result", runRef: "codex-run:mcp-pair-g",
    capturedAt: "2026-08-17T12:00:00.000Z", schemaVersion: 1,
  });
  const digest = "a".repeat(64);
  const verification = store.addEvent("mcp-pair", "att-mcp-pair", "verification.completed", "passed", { passed: true });
  store.addEvent("mcp-pair", "att-mcp-pair", "main-review.completed", "accept", {
    decision: "accept", reason: "accepted", attemptId: "att-mcp-pair",
    verificationEventSequence: verification.sequence,
    candidateRevisionId: "rev-mcp-pair", acceptedPatchDigest: digest,
  });
  store.saveIntegrationReceipt({
    id: "rcpt-mcp-int", taskId: "mcp-pair", patchDigest: digest, affectedFiles: ["src/cli.ts"],
    rejectionReasons: [], sourceEvidence: {}, createdAt: "2026-08-17T12:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z", consumed: true,
  });
  store.saveIntegrationResult({
    id: "intopmcp", receiptId: "rcpt-mcp-int", taskId: "mcp-pair", status: "applied",
    appliedAt: "2026-08-17T12:00:00.000Z", createdAt: "2026-08-17T12:00:00.000Z",
    stages: [
      { stage: "source-applied", status: "passed" },
      { stage: "source-verified", status: "passed" },
      { stage: "artifact-built", status: "passed" },
      { stage: "runtime-activated", status: "passed" },
    ],
  });
  const before = {
    events: store.listEvents("mcp-pair").length,
    integrations: store.listIntegrationResults("mcp-pair").length,
    tasks: store.listTasks().length,
  };
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const assessArgs = {
    taskId: "mcp-pair",
    comparisonId: "cmp-mcp-pair",
    confirm: true as const,
    sameScope: true,
    sameAcceptance: true,
    delegatedQualityNotLower: true,
    directVerificationRef: { referenceId: "dvref1" },
    delegatedIntegrationOperationId: "intopmcp",
    reviewer: "main-codex" as const,
    assessedAt: "2026-08-17T12:30:00.000Z",
    schemaVersion: 1 as const,
  };
  try {
    const assessed = await client.callTool({ name: "forklight_main_token_assess", arguments: assessArgs });
    assert.equal(assessed.isError, undefined, toolErrorText(assessed));
    const assessedData = assessed.structuredContent as Record<string, unknown>;
    assert.equal(assessedData.outcome, "accepted");
    assert.equal("prompt" in assessedData, false);

    const report1 = await client.callTool({
      name: "forklight_main_token_pair_report",
      arguments: { taskId: "mcp-pair", comparisonId: "cmp-mcp-pair" },
    });
    const report2 = await client.callTool({
      name: "forklight_main_token_pair_report",
      arguments: { taskId: "mcp-pair", comparisonId: "cmp-mcp-pair" },
    });
    assert.equal(report1.isError, undefined, toolErrorText(report1));
    assert.deepEqual(report1.structuredContent, report2.structuredContent);
    const report = report1.structuredContent as Record<string, unknown>;
    assert.equal(report.validity, "accepted");
    assert.equal(report.directGrossTokens, 4500);
    assert.equal(report.delegatedGrossTokens, 1500);
    assert.equal(report.signedChange, 3000);
    assert.equal((report.saving as { status?: string }).status, "saving");
    for (const key of ["change", "savings", "directCodexSavings", "calibration", "workerTokens", "cost", "prompt"]) {
      assert.equal(key in report, false);
    }

    const check = new StateStore(home);
    assert.equal(check.listEvents("mcp-pair").length, before.events);
    assert.equal(check.listIntegrationResults("mcp-pair").length, before.integrations);
    assert.equal(check.listTasks().length, before.tasks);
    assert.equal(check.countMainPairAssessments(), 1);
    check.close();
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP main-token value report is read-only and matches two launches", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-m4c-"));
  const store = new StateStore(home);
  const { parseTaskSpec } = await import("../src/core/task.js");
  const { buildTaskRecord } = await import("../src/core/runner.js");
  const spec = parseTaskSpec({
    version: 1, name: "mcp-value", project: "/tmp", goal: "T",
    taskClass: "edit-task", taskFamily: "forklight-storage-lifecycle",
    directCodexProfileId: "codex-main-v1", acceptance: { commands: ["true"] },
  }, "/tmp");
  store.createTask(buildTaskRecord({
    spec, taskFile: "/tmp/mcp-value.yaml", home, id: "mcp-value",
    sessionId: "s-mcp-value", createdAt: "2026-08-17T12:00:00.000Z",
  }));
  store.saveMainUsageSample({
    sampleId: "mcpvalued", forklightTaskId: "mcp-value", comparisonId: "cmp-mcp-value",
    role: "direct-main", taskClass: "edit-task", taskFamily: "forklight-storage-lifecycle",
    directCodexProfileId: "codex-main-v1", inputTokens: 4000, outputTokens: 500,
    cacheReadInputTokens: 0, cacheCreationInputTokens: 0, grossTokens: 4500,
    source: "codex-terminal-result", runRef: "codex-run:mcp-value-d",
    capturedAt: "2026-08-17T12:00:00.000Z", schemaVersion: 1,
  });
  store.saveMainUsageSample({
    sampleId: "mcpvalueg", forklightTaskId: "mcp-value", comparisonId: "cmp-mcp-value",
    role: "delegated-main", taskClass: "edit-task", taskFamily: "forklight-storage-lifecycle",
    directCodexProfileId: "codex-main-v1", inputTokens: 1200, outputTokens: 300,
    cacheReadInputTokens: 0, cacheCreationInputTokens: 0, grossTokens: 1500,
    source: "codex-terminal-result", runRef: "codex-run:mcp-value-g",
    capturedAt: "2026-08-17T12:00:00.000Z", schemaVersion: 1,
  });
  const digest = "a".repeat(64);
  const verification = store.addEvent("mcp-value", "att-mcp-value", "verification.completed", "passed", { passed: true });
  store.addEvent("mcp-value", "att-mcp-value", "main-review.completed", "accept", {
    decision: "accept", reason: "accepted", attemptId: "att-mcp-value",
    verificationEventSequence: verification.sequence,
    candidateRevisionId: "rev-mcp-value", acceptedPatchDigest: digest,
  });
  store.saveIntegrationReceipt({
    id: "rcpt-mcp-value", taskId: "mcp-value", patchDigest: digest, affectedFiles: ["src/cli.ts"],
    rejectionReasons: [], sourceEvidence: {}, createdAt: "2026-08-17T12:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z", consumed: true,
  });
  store.saveIntegrationResult({
    id: "intopmcpv", receiptId: "rcpt-mcp-value", taskId: "mcp-value", status: "applied",
    appliedAt: "2026-08-17T12:00:00.000Z", createdAt: "2026-08-17T12:00:00.000Z",
    stages: [
      { stage: "source-applied", status: "passed" },
      { stage: "source-verified", status: "passed" },
      { stage: "artifact-built", status: "passed" },
      { stage: "runtime-activated", status: "passed" },
    ],
  });
  const before = {
    events: store.listEvents("mcp-value").length,
    tasks: store.listTasks().length,
    assessments: store.countMainPairAssessments(),
  };
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const listed = await client.listTools();
    const valueTool = listed.tools.find((tool) => tool.name === "forklight_main_token_value_report");
    assert.equal(valueTool?.annotations?.readOnlyHint, true);

    const empty = await client.callTool({
      name: "forklight_main_token_value_report",
      arguments: { families: ["worker-runtime"] },
    });
    assert.equal(empty.isError, undefined, toolErrorText(empty));
    const emptyData = empty.structuredContent as Record<string, unknown>;
    assert.equal(emptyData.overall, "cannot-determine");
    assert.ok((emptyData.reasons as string[]).includes("uncovered-family"));

    await client.callTool({
      name: "forklight_main_token_assess",
      arguments: {
        taskId: "mcp-value",
        comparisonId: "cmp-mcp-value",
        confirm: true,
        sameScope: true,
        sameAcceptance: true,
        delegatedQualityNotLower: true,
        directVerificationRef: { referenceId: "dvref1" },
        delegatedIntegrationOperationId: "intopmcpv",
        reviewer: "main-codex",
        assessedAt: "2026-08-17T12:30:00.000Z",
        schemaVersion: 1,
      },
    });

    const report1 = await client.callTool({
      name: "forklight_main_token_value_report",
      arguments: { families: ["forklight-storage-lifecycle"] },
    });
    const report2 = await client.callTool({
      name: "forklight_main_token_value_report",
      arguments: { families: ["forklight-storage-lifecycle"] },
    });
    assert.equal(report1.isError, undefined, toolErrorText(report1));
    assert.deepEqual(report1.structuredContent, report2.structuredContent);
    const report = report1.structuredContent as Record<string, unknown>;
    assert.equal(report.overall, "proven");
    assert.equal(report.createdWork, false);
    const families = report.families as Array<Record<string, unknown>>;
    assert.equal(families[0]?.claim, "proven-lower");
    const comparisons = families[0]?.comparisons as Array<Record<string, unknown>>;
    assert.equal(comparisons[0]?.signedChange, 3000);
    for (const key of ["change", "savings", "directCodexSavings", "prompt", "averagePercentage"]) {
      assert.equal(key in report, false);
    }
    const check = new StateStore(home);
    assert.equal(check.listEvents("mcp-value").length, before.events);
    assert.equal(check.listTasks().length, before.tasks);
    assert.equal(check.countMainPairAssessments(), before.assessments + 1);
    check.close();
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP delivery prepare and decide share the canonical checkpoint schema", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-delivery-"));
  const sourceDir = path.join(home, "source");
  await mkdir(path.join(sourceDir, "src"), { recursive: true });
  await writeFile(path.join(sourceDir, "readme.md"), "# hello\n\nOriginal.\n");
  await writeFile(path.join(sourceDir, "src/app.ts"), "export const n = 1;\n");
  const store = new StateStore(home);
  const taskId = "mcp-delivery-1";
  const paths = taskPaths(home, taskId);
  const spec: TaskSpec = {
    version: 1,
    name: "MCP delivery",
    project: sourceDir,
    goal: "Ship a small change",
    constraints: [],
    provider: {
      name: "deepseek",
      model: "deepseek-v4-flash",
      keychainService: "forklight.deepseek.api-key",
    },
    runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: 0.1 },
    workspace: { exclude: [".git", "node_modules"] },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src", "readme.md"] },
    acceptance: { commands: ["true"] },
    reviewRequirement: { requiredJudges: 0, reason: "Explicit skip for MCP fixture" },
  };
  await prepareWorkspace(spec, paths);
  await mkdir(path.join(paths.workspace, "src"), { recursive: true });
  await writeFile(path.join(paths.workspace, "readme.md"), "# hello\n\nChanged.\n");
  await writeFile(path.join(paths.workspace, "src/app.ts"), "export const n = 2;\n");
  await writeWorkspacePatchReport(paths, createPathPolicy(spec));
  const now = new Date().toISOString();
  store.createTask({
    id: taskId,
    name: spec.name,
    status: "succeeded",
    sourcePath: sourceDir,
    taskFile: "forklight://test/mcp-delivery",
    spec,
    paths,
    sessionId: "session-1",
    currentAttemptId: "attempt-1",
    createdAt: now,
    updatedAt: now,
  });
  store.createAttempt({
    id: "attempt-1",
    taskId,
    ordinal: 1,
    status: "succeeded",
    sessionId: "session-1",
    rawLogPath: path.join(paths.logs, "attempt-1.jsonl"),
    startedAt: now,
    finishedAt: now,
    exitCode: 0,
  });
  const verification: VerificationResult = {
    passed: true,
    behaviorPassed: true,
    policyPassed: true,
    sourceCompatible: true,
    commands: [{ command: "true", exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false }],
    diffPath: paths.diff,
    sourceUnchanged: true,
  };
  const verEvent = store.addEvent(taskId, "attempt-1", "verification.completed", "passed", verification);
  const revision = await captureCandidateRevision(
    store, store.getTask(taskId), store.getAttempt("attempt-1"), verEvent.sequence, true,
    ["readme.md", "src/app.ts"], 2, 4,
  );
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const prepared = await client.callTool({
      name: "forklight_delivery_prepare",
      arguments: {
        taskId,
        reviewerProfileIds: [],
        reason: "Explicit skip",
        timeoutMs: 500,
        confirm: true,
      },
    });
    assert.equal(prepared.isError, undefined);
    const preparedData = prepared.structuredContent as {
      kind?: string;
      observation?: { outcome?: string };
      candidate?: { revisionId?: string; digest?: string };
      nextActionCode?: string;
      mainDecision?: unknown;
      integration?: unknown;
    };
    assert.equal(preparedData.kind, "main-delivery-checkpoint");
    assert.equal(preparedData.observation?.outcome, "ready");
    assert.equal(preparedData.candidate?.revisionId, revision.id);
    assert.equal(preparedData.candidate?.digest, revision.patchDigest);
    assert.equal(preparedData.nextActionCode, "record-main-review");
    assert.equal(preparedData.mainDecision, undefined);
    assert.equal(preparedData.integration, undefined);

    const decided = await client.callTool({
      name: "forklight_delivery_decide",
      arguments: {
        taskId,
        decision: "revise",
        revisionId: revision.id,
        digest: revision.patchDigest,
        reason: "Need a narrower change",
        timeoutMs: 500,
        confirm: true,
      },
    });
    assert.equal(decided.isError, undefined);
    const decidedData = decided.structuredContent as {
      kind?: string;
      mainDecision?: { decision?: string };
      integration?: unknown;
    };
    assert.equal(decidedData.kind, "main-delivery-checkpoint");
    assert.equal(decidedData.mainDecision?.decision, "revise");
    assert.equal(decidedData.integration, undefined);
    const receiptStore = new StateStore(home);
    const receipts = receiptStore.listExchangeReceipts(taskId);
    assert.equal(receipts.filter((receipt) => receipt.operation === "forklight_delivery_prepare").length, 1);
    assert.equal(receipts.filter((receipt) => receipt.operation === "forklight_delivery_decide").length, 1);
    assert.equal(receipts.some((receipt) => receipt.operation === "forklight_wait"), false);
    assert.equal(receipts.some((receipt) => receipt.operation === "forklight_review_graph_create"), false);
    assert.equal(receipts.some((receipt) => receipt.operation === "forklight_main_review"), false);
    receiptStore.close();
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("MCP backup preview create inspect share projections and omit restore", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-backup-"));
  const dest = path.join(path.dirname(home), `mcp-backup-${path.basename(home)}`);
  const store = new StateStore(home);
  store.close();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    assert.ok(names.includes("forklight_backup_preview"));
    assert.ok(names.includes("forklight_backup_create"));
    assert.ok(names.includes("forklight_backup_inspect"));
    assert.equal(names.includes("forklight_backup_restore"), false);

    const preview = await client.callTool({
      name: "forklight_backup_preview",
      arguments: { destination: dest },
    });
    assert.equal(preview.isError, undefined);
    const previewData = preview.structuredContent as {
      included?: string[];
      excluded?: string[];
      integrity?: { quickCheck?: string };
      impact?: string;
      nextAction?: string;
      credentials?: { keychain?: string };
      privacy?: string;
    };
    assert.ok(previewData.included?.includes("forklight.sqlite"));
    assert.ok((previewData.excluded ?? []).length > 0);
    assert.equal(previewData.integrity?.quickCheck, "ok");
    assert.ok((previewData.impact ?? "").length > 0);
    assert.equal(previewData.credentials?.keychain, "not-included");
    assert.equal(previewData.privacy, "keep-private");

    const created = await client.callTool({
      name: "forklight_backup_create",
      arguments: { destination: dest, confirm: true },
    });
    assert.equal(created.isError, undefined);
    assert.equal((created.structuredContent as { status?: string }).status, "completed");

    const inspected = await client.callTool({
      name: "forklight_backup_inspect",
      arguments: { backupPath: dest },
    });
    assert.equal(inspected.isError, undefined);
    assert.equal((inspected.structuredContent as { status?: string }).status, "ready");
    assert.equal(existsSync(path.join(home, "forklight.sock")), false);

    const mcpSource = await readFile(new URL("../src/mcp/server.ts", import.meta.url), "utf8");
    const previewIdx = mcpSource.indexOf('"forklight_backup_preview"');
    const createIdx = mcpSource.indexOf('"forklight_backup_create"');
    const inspectIdx = mcpSource.indexOf('"forklight_backup_inspect"');
    assert.ok(previewIdx > 0 && createIdx > previewIdx && inspectIdx > createIdx);
    assert.equal(mcpSource.includes("forklight_backup_restore"), false);
    assert.doesNotMatch(
      mcpSource.slice(previewIdx, inspectIdx + 400),
      /ensureDaemon/,
    );
  } finally {
    await client.close();
    await server.close();
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
    await rm(dest, { recursive: true, force: true }).catch(() => undefined);
  }
});
