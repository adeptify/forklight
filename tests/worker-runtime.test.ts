import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProviderRuntimePair,
  isRuntimeName,
  SUPPORTED_RUNTIME_NAMES,
} from "../src/core/runtime-names.js";
import { parseTaskSpec } from "../src/core/task.js";
import { cloneDefaults } from "../src/core/settings.js";
import { getWorkerAdapter, listWorkerAdapters, resetWorkerRegistryForTests } from "../src/workers/registry.js";
import { buildWorkerPrompt, claudeToolProtocolLines } from "../src/core/task.js";
import {
  buildGrokCliArgs,
  buildGrokSandboxProfile,
  GROK_CONNECTIVITY_SAFE_ERROR,
  grokAllowTools,
  grokDisallowedTools,
  isGrokConnectivityEvidence,
  sanitizeGrokConnectivityEvent,
  seedGrokHomeAuth,
} from "../src/workers/grok.js";
import { failureCategoryFromEvents } from "../src/core/worker-failure.js";
import { GrokEventNormalizer } from "../src/events/grok-normalize.js";
import type { TaskRecord, TaskSpec } from "../src/core/types.js";
import { checkpointSatisfied } from "../src/core/checkpoint.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { StateStore } from "../src/state/store.js";
import {
  executeAttempt,
  recordWorkerConnectionEvidenceFromCompletedEvent,
} from "../src/core/runner.js";
import type { WorkerAdapter, WorkerDoctorResult } from "../src/workers/types.js";
import { registerWorkerAdapter } from "../src/workers/registry.js";
import { spawn } from "node:child_process";
import type { WorkerExecutionResult, WorkerRunContext } from "../src/workers/types.js";

function policy() {
  const s = cloneDefaults();
  return {
    contractQuality: s.contractQuality,
    execution: s.execution,
    providerDefaults: s.providerDefaults,
    completionPolicy: s.completionPolicy,
  };
}

function minimalContract(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 2,
    name: "runtime-test",
    project: "/tmp/project",
    provider: { name: "deepseek", model: "deepseek-v4-flash", keychainService: "forklight.deepseek.api-key" },
    runtime: { name: "claude-code", executable: "claude", effort: "high", maxBudgetUsd: 0.1 },
    workspace: { exclude: [] },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
    contract: {
      outcome: "Observable outcome text here",
      context: ["ctx"],
      inScope: ["in"],
      outOfScope: ["out"],
      executionSteps: ["step one", "step two"],
      deliverables: ["d1"],
      modules: [{
        name: "m1",
        responsibility: "does work",
        consumes: ["a"],
        produces: ["b"],
        boundaries: ["c"],
      }],
      callChain: ["one", "two"],
      scenarios: [
        { name: "s1", given: "g", when: "w", then: "t" },
        { name: "s2", given: "g", when: "w", then: "t" },
      ],
      risks: ["r"],
      changeBudget: { maxFiles: 4, maxDiffLines: 100 },
    },
    acceptance: { criteria: ["c1"], commands: ["true"] },
    ...overrides,
  };
}

test("runtime name whitelist includes claude-code and grok-build", () => {
  assert.ok(isRuntimeName("claude-code"));
  assert.ok(isRuntimeName("grok-build"));
  assert.equal(isRuntimeName("nope"), false);
  assert.ok(SUPPORTED_RUNTIME_NAMES.includes("claude-code"));
  assert.ok(SUPPORTED_RUNTIME_NAMES.includes("grok-build"));
});

test("provider×runtime pairing fail-closed", () => {
  assert.doesNotThrow(() => assertProviderRuntimePair("xai", "grok-build"));
  assert.doesNotThrow(() => assertProviderRuntimePair("deepseek", "claude-code"));
  assert.throws(() => assertProviderRuntimePair("deepseek", "grok-build"), /xai/);
  assert.throws(() => assertProviderRuntimePair("xai", "claude-code"), /xai/);
});

test("parseTaskSpec accepts grok-build + xai and rejects mismatches", () => {
  const p = policy();
  const ok = parseTaskSpec(
    minimalContract({
      provider: { name: "xai", model: "grok-build", keychainService: "forklight.xai.api-key" },
      runtime: { name: "grok-build", executable: "grok", effort: "high", maxBudgetUsd: 0.1 },
    }),
    "/tmp",
    p,
  );
  assert.equal(ok.runtime.name, "grok-build");
  assert.equal(ok.provider.name, "xai");

  assert.throws(
    () => parseTaskSpec(
      minimalContract({
        provider: { name: "deepseek", model: "m", keychainService: "forklight.deepseek.api-key" },
        runtime: { name: "grok-build", executable: "grok", effort: "high", maxBudgetUsd: 0.1 },
      }),
      "/tmp",
      p,
    ),
    /xai/,
  );

  assert.throws(
    () => parseTaskSpec(
      minimalContract({
        runtime: { name: "nope-runtime", executable: "x", effort: "high", maxBudgetUsd: 0.1 },
      }),
      "/tmp",
      p,
    ),
    /Unsupported runtime/,
  );
});

test("registry dispatches Claude and Grok adapters", () => {
  resetWorkerRegistryForTests();
  const names = listWorkerAdapters().map((a) => a.name).sort();
  assert.deepEqual(names, ["claude-code", "grok-build"]);
  const claude = getWorkerAdapter("claude-code");
  assert.equal(claude.capabilities().checkpoint, "supported");
  const grok = getWorkerAdapter("grok-build");
  assert.equal(grok.capabilities().checkpoint, "unsupported");
  assert.ok(grokDisallowedTools().includes("run_terminal_cmd"));
  assert.throws(() => getWorkerAdapter("unknown"), /Unknown worker runtime/);
});

test("Grok adapter prompt has no Claude checkpoint MCP tool name", () => {
  resetWorkerRegistryForTests();
  const grok = getWorkerAdapter("grok-build");
  const spec = parseTaskSpec(
    minimalContract({
      provider: { name: "xai", model: "grok-build", keychainService: "forklight.xai.api-key" },
      runtime: { name: "grok-build", executable: "grok", effort: "high", maxBudgetUsd: 0.1 },
    }),
    "/tmp",
    policy(),
  ) as TaskSpec;
  const task = {
    id: "t",
    name: spec.name,
    status: "running" as const,
    sourcePath: "/p",
    taskFile: "/t.yaml",
    spec,
    paths: {
      root: "/r",
      baseline: "/b",
      workspace: "/w",
      logs: "/l",
      claudeConfig: "/c",
      diff: "/d",
    },
    sessionId: "s",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const prompt = buildWorkerPrompt(spec, false, undefined, {
    toolLines: grok.toolProtocolAppendix(task),
    checkpointLines: grok.checkpointProtocolAppendix(task),
  });
  assert.ok(!prompt.includes("mcp__forklight_checkpoint__run"));
  assert.ok(prompt.includes("does not support ForkLight checkpoint"));
  const defaultCc = buildWorkerPrompt(
    parseTaskSpec(minimalContract(), "/tmp", policy()),
    false,
  );
  assert.ok(defaultCc.includes("mcp__forklight_checkpoint__run"));
  assert.ok(claudeToolProtocolLines(["src"]).some((line) => line.includes("Glob") || line.includes("focus")));
});

test("GrokEventNormalizer maps stream lines", () => {
  const n = new GrokEventNormalizer();
  const completed = n.parseLine(JSON.stringify({ type: "result", result: "done" }));
  assert.equal(completed[0]?.type, "worker.completed");
  const endOk = n.parseLine(JSON.stringify({
    type: "end",
    stopReason: "EndTurn",
    total_cost_usd: 0.01,
    num_turns: 2,
  }));
  assert.equal(endOk[0]?.type, "worker.completed");
  assert.equal(endOk[0]?.terminal?.costUsd, 0.01);
  const thought = n.parseLine(JSON.stringify({ type: "thought", data: "hmm" }));
  assert.equal(thought[0]?.type, "worker.message");
  const failed = n.parseLine(JSON.stringify({ type: "error", message: "auth" }));
  assert.equal(failed[0]?.type, "worker.failed");
  const cancelled = n.parseLine(JSON.stringify({ type: "end", stopReason: "Cancelled" }));
  assert.equal(cancelled[0]?.type, "worker.failed");
  const tool = n.parseLine(JSON.stringify({ type: "tool_start", tool: "read_file" }));
  assert.equal(tool[0]?.type, "worker.tool.started");
});

test("Worker connection evidence requires the same Attempt's canonical completion", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-worker-evidence-"));
  const store = new StateStore(home);
  const spec = parseTaskSpec(
    minimalContract({
      provider: { name: "xai", model: "grok-4.5", keychainService: "forklight.xai.api-key" },
      runtime: { name: "grok-build", executable: "grok", effort: "high", maxBudgetUsd: null },
    }),
    "/tmp",
    policy(),
  );
  const task: TaskRecord = {
    id: "81818181-8181-4181-8181-818181818181",
    name: spec.name,
    status: "running",
    sourcePath: "/tmp/project",
    taskFile: "/tmp/task.yaml",
    spec,
    paths: {
      root: "/tmp/run",
      baseline: "/tmp/run/baseline",
      workspace: "/tmp/run/workspace",
      logs: "/tmp/run/logs",
      claudeConfig: "/tmp/run/claude",
      diff: "/tmp/run/result.diff",
    },
    sessionId: "82828282-8282-4282-8282-828282828282",
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
  };
  store.createTask(task);

  assert.equal(
    recordWorkerConnectionEvidenceFromCompletedEvent(
      store, task, "attempt-1", "succeeded", "2026-07-29T00:01:00.000Z",
    ),
    false,
  );
  store.addEvent(task.id, "other-attempt", "worker.completed", "completed elsewhere");
  assert.equal(
    recordWorkerConnectionEvidenceFromCompletedEvent(
      store, task, "attempt-1", "succeeded", "2026-07-29T00:02:00.000Z",
    ),
    false,
  );
  store.addEvent(task.id, "attempt-1", "worker.completed", "completed here");
  assert.equal(
    recordWorkerConnectionEvidenceFromCompletedEvent(
      store, task, "attempt-1", "succeeded", "2026-07-29T00:03:00.000Z",
    ),
    true,
  );
  const evidence = store.getProbeEvidence("xai");
  assert.equal(evidence?.source, "worker-run");
  assert.equal(evidence?.model, "grok-4.5");
  assert.equal(evidence?.endpointOrigin, "https://api.x.ai");
  assert.equal(evidence?.timestamp, "2026-07-29T00:03:00.000Z");
  assert.equal(
    recordWorkerConnectionEvidenceFromCompletedEvent(
      store, task, "attempt-1", "failed", "2026-07-29T00:04:00.000Z",
    ),
    false,
  );
  assert.equal(store.getProbeEvidence("xai")?.timestamp, "2026-07-29T00:03:00.000Z");
  store.close();
});

test("seedGrokHomeAuth copies operator OAuth files into task-local home", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-seed-auth-"));
  const op = path.join(root, "op");
  const taskHome = path.join(root, "task");
  const { mkdir, writeFile, readFile } = await import("node:fs/promises");
  await mkdir(op, { recursive: true });
  await mkdir(taskHome, { recursive: true });
  await writeFile(path.join(op, "auth.json"), '{"token":"test"}', { mode: 0o600 });
  await writeFile(path.join(op, "agent_id"), "agent-1", { mode: 0o600 });
  const result = await seedGrokHomeAuth(taskHome, op);
  assert.equal(result.mode, "oauth-seed");
  assert.ok(result.seeded.includes("auth.json"));
  assert.equal(await readFile(path.join(taskHome, "auth.json"), "utf8"), '{"token":"test"}');
});

test("Grok CLI argv includes model, web disable, MCP deny, and respects allowEdits", () => {
  const base = {
    prompt: "do work",
    workspace: "/ws",
    model: "grok-build-test-model",
    grokHome: "/task/grok-home",
    effort: "high" as const,
    sessionId: "11111111-1111-4111-8111-111111111111",
    resuming: false,
  };
  const withEdits = buildGrokCliArgs({ ...base, allowEdits: true });
  assert.ok(withEdits.includes("-m"));
  assert.equal(withEdits[withEdits.indexOf("-m") + 1], "grok-build-test-model");
  assert.ok(withEdits.includes("--always-approve"));
  assert.ok(withEdits.includes("--disable-web-search"));
  assert.ok(withEdits.includes("--disallowed-tools"));
  assert.ok(grokDisallowedTools().includes("MCPTool") || withEdits.includes("MCPTool"));
  assert.ok(withEdits.includes("MCPTool"));
  assert.ok(withEdits.join("\0").includes("search_replace"));
  assert.ok(withEdits.join("\0").includes("write"));

  const readOnly = buildGrokCliArgs({ ...base, allowEdits: false });
  const toolsIdx = readOnly.indexOf("--tools");
  const toolsValue = readOnly[toolsIdx + 1] ?? "";
  assert.equal(toolsValue, grokAllowTools(false));
  assert.ok(!toolsValue.includes("write"));
  assert.ok(!toolsValue.includes("search_replace"));
});

test("Grok sandbox profile allows network, system.sb, and TMPDIR write roots", () => {
  const profile = buildGrokSandboxProfile({
    workspace: "/ws",
    grokHome: "/gh",
    logs: "/logs",
    runtimeDirectory: "/Users/me/.grok/bin",
    userHome: "/Users/me",
    operatorGrokHome: "/Users/me/.grok",
    operatorClaudeHome: "/Users/me/.claude",
    temporaryDirectory: "/var/folders/tmp",
  });
  assert.ok(profile.includes('(import "system.sb")'));
  assert.ok(profile.includes("(allow network*)"));
  assert.ok(profile.includes("(allow process*)"));
  assert.ok(profile.includes("(deny default)"));
  assert.ok(profile.includes("/Users/me"));
  assert.ok(profile.includes("(deny file-read-data"));
  assert.ok(!profile.includes("(deny file-read*"));
  assert.ok(profile.includes("/ws"));
  assert.ok(profile.includes("/Users/me/.grok"), "operator .grok must remain readable for CLI assets");
  assert.ok(
    profile.includes("/Users/me/.claude"),
    "operator .claude must remain readable because Grok imports compatible settings",
  );
  assert.ok(
    profile.includes("/var/folders/tmp"),
    "temp directory must be on file-write allowlist (Claude parity)",
  );
  // Writes must not allow operator home broadly — only task grok home.
  assert.ok(profile.includes('(subpath "/gh")'));
});

test("executeAttempt succeeds when verify passes even if supported-runtime checkpoint is missing", async () => {
  resetWorkerRegistryForTests();
  getWorkerAdapter("claude-code");
  const caps = {
    budgetFlag: "supported" as const,
    checkpoint: "supported" as const,
    isolation: "supported" as const,
    toolsPolicy: "supported" as const,
    effortMapping: "supported" as const,
    costUsageFidelity: "partial" as const,
    sessionResume: "supported" as const,
    streamingEvents: "supported" as const,
    progressHeartbeat: "tool-lifecycle" as const,
  };
  registerWorkerAdapter({
    name: "claude-code",
    displayName: "Claude Code (test double)",
    defaultExecutable: "claude",
    capabilities: () => caps,
    doctor: (): WorkerDoctorResult => ({
      runtime: "claude-code",
      ok: true,
      executable: "claude",
      issues: [],
      capabilities: caps,
    }),
    validateSpec: () => {},
    effortArgs: () => [],
    toolProtocolAppendix: () => [],
    checkpointProtocolAppendix: () => [],
    // Succeed without emitting checkpoint.completed — the false-fail class under test.
    run: async () => ({ status: "succeeded", exitCode: 0, resultText: "ok" }),
  });

  const root = await mkdtemp(path.join(tmpdir(), "forklight-ckpt-missing-"));
  const source = path.join(root, "source");
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(path.join(source, "src"), { recursive: true });
  await writeFile(path.join(source, "src", "hello.ts"), "export const n = 1;\n");

  const home = path.join(root, "state");
  const store = new StateStore(home);
  const { taskPaths } = await import("../src/core/config.js");
  const { prepareWorkspace } = await import("../src/workspace/copy.js");
  const paths = taskPaths(home, "66666666-6666-4666-8666-666666666666");
  const spec = parseTaskSpec(
    minimalContract({
      project: source,
      provider: { name: "deepseek", model: "deepseek-v4-flash", keychainService: "forklight.deepseek.api-key" },
      runtime: { name: "claude-code", executable: "claude", effort: "high", maxBudgetUsd: 0.1 },
      acceptance: { criteria: ["c1"], commands: ["true"] },
      contract: {
        outcome: "Observable outcome text here",
        context: ["ctx"],
        inScope: ["in"],
        outOfScope: ["out"],
        executionSteps: ["step one", "step two"],
        deliverables: ["d1"],
        modules: [{
          name: "m1",
          responsibility: "does work",
          consumes: ["a"],
          produces: ["b"],
          boundaries: ["c"],
        }],
        callChain: ["one", "two"],
        scenarios: [
          { name: "s1", given: "g", when: "w", then: "t" },
          { name: "s2", given: "g", when: "w", then: "t" },
        ],
        risks: ["r"],
        changeBudget: { maxFiles: 4, maxDiffLines: 100 },
      },
    }),
    source,
    {
      ...policy(),
      completionPolicy: { noChangeMode: "off", changeBudgetMode: "off" },
    },
  );
  await prepareWorkspace(spec, paths);
  await writeFile(path.join(paths.workspace, "src", "hello.ts"), "export const n = 2;\n");

  const task = {
    id: "66666666-6666-4666-8666-666666666666",
    name: spec.name,
    status: "queued" as const,
    sourcePath: source,
    taskFile: path.join(home, "task.yaml"),
    spec,
    paths,
    sessionId: "77777777-7777-4777-8777-777777777777",
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
  };
  store.createTask(task);

  const result = await executeAttempt(store, store.getTask(task.id), false);
  assert.equal(result.attempt.runtimeBudgetEnforcement, "supported");
  assert.equal(result.verification?.passed, true);
  assert.equal(result.task.status, "succeeded", "must not false-fail on missing non-authoritative checkpoint");
  assert.notEqual(result.task.error, "Required bounded checkpoint missing or failed");
  const events = store.listEvents(task.id);
  const gap = events.find((e) => e.type === "checkpoint.skipped");
  assert.ok(gap, "audit event for missing checkpoint");
  assert.equal(
    (gap!.payload as { reason?: string } | undefined)?.reason,
    "missing-or-failed-non-authoritative",
  );
  assert.equal(checkpointSatisfied(events, result.attempt.id, 1), false);
  store.close();
  resetWorkerRegistryForTests();
});

test("executeAttempt emits checkpoint.skipped for unsupported checkpoint runtime", async () => {
  resetWorkerRegistryForTests();
  getWorkerAdapter("grok-build"); // load builtins
  const caps = {
    budgetFlag: "unsupported" as const,
    checkpoint: "unsupported" as const,
    isolation: "partial" as const,
    toolsPolicy: "supported" as const,
    effortMapping: "partial" as const,
    costUsageFidelity: "partial" as const,
    sessionResume: "partial" as const,
    streamingEvents: "partial" as const,
    progressHeartbeat: "any-nonterminal-stream-event" as const,
  };
  // Fake Grok worker: succeed without spawn so shipped runner gate runs.
  registerWorkerAdapter({
    name: "grok-build",
    displayName: "Grok Build (test double)",
    defaultExecutable: "grok",
    capabilities: () => caps,
    doctor: (): WorkerDoctorResult => ({
      runtime: "grok-build",
      ok: true,
      executable: "grok",
      issues: [],
      capabilities: caps,
    }),
    validateSpec: () => {},
    effortArgs: () => [],
    toolProtocolAppendix: () => [],
    checkpointProtocolAppendix: () => [],
    run: async () => ({ status: "succeeded", exitCode: 0, resultText: "ok" }),
  });

  const root = await mkdtemp(path.join(tmpdir(), "forklight-ckpt-skip-"));
  const source = path.join(root, "source");
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(path.join(source, "src"), { recursive: true });
  await writeFile(path.join(source, "src", "hello.ts"), "export const n = 1;\n");

  const home = path.join(root, "state");
  const store = new StateStore(home);
  const { taskPaths } = await import("../src/core/config.js");
  const { prepareWorkspace } = await import("../src/workspace/copy.js");
  const paths = taskPaths(home, "44444444-4444-4444-8444-444444444444");
  const spec = parseTaskSpec(
    minimalContract({
      project: source,
      provider: { name: "xai", model: "grok-build", keychainService: "forklight.xai.api-key" },
      runtime: { name: "grok-build", executable: "grok", effort: "high", maxBudgetUsd: 0.1 },
      acceptance: { criteria: ["c1"], commands: ["true"] },
      // Avoid hard-fail on zero business diff for an empty worker double.
      contract: {
        outcome: "Observable outcome text here",
        context: ["ctx"],
        inScope: ["in"],
        outOfScope: ["out"],
        executionSteps: ["step one", "step two"],
        deliverables: ["d1"],
        modules: [{
          name: "m1",
          responsibility: "does work",
          consumes: ["a"],
          produces: ["b"],
          boundaries: ["c"],
        }],
        callChain: ["one", "two"],
        scenarios: [
          { name: "s1", given: "g", when: "w", then: "t" },
          { name: "s2", given: "g", when: "w", then: "t" },
        ],
        risks: ["r"],
        changeBudget: { maxFiles: 4, maxDiffLines: 100 },
      },
    }),
    source,
    {
      ...policy(),
      completionPolicy: { noChangeMode: "off", changeBudgetMode: "off" },
    },
  );
  await prepareWorkspace(spec, paths);
  // Make a business edit so completion policy hard mode is not required.
  await writeFile(path.join(paths.workspace, "src", "hello.ts"), "export const n = 2;\n");

  const task = {
    id: "44444444-4444-4444-8444-444444444444",
    name: spec.name,
    status: "queued" as const,
    sourcePath: source,
    taskFile: path.join(home, "task.yaml"),
    spec,
    paths,
    sessionId: "55555555-5555-4555-8555-555555555555",
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
  };
  store.createTask(task);

  const result = await executeAttempt(store, store.getTask(task.id), false);
  assert.equal(result.attempt.runtimeBudgetEnforcement, "unsupported");
  const events = store.listEvents(task.id);
  const skipped = events.find((e) => e.type === "checkpoint.skipped");
  assert.ok(skipped, "shipped executeAttempt must emit checkpoint.skipped");
  assert.equal(
    (skipped!.payload as { reason?: string } | undefined)?.reason,
    "runtime-unsupported",
  );
  // Without skip, checkpointSatisfied alone would fail (no checkpoint.completed).
  assert.equal(
    checkpointSatisfied(events, result.attempt.id, 1),
    false,
  );
  assert.equal(result.task.status, "succeeded");
  assert.equal(result.verification?.passed, true);
  store.close();
  resetWorkerRegistryForTests();
});

test("executeAttempt fails closed when worker doctor.ok is false", async () => {
  resetWorkerRegistryForTests();
  // Register a broken runtime that reuses Claude name after builtins, then override.
  // Use a one-off adapter name by temporarily wrapping via register after builtins.
  const home = await mkdtemp(path.join(tmpdir(), "forklight-doctor-gate-"));
  const store = new StateStore(home);
  const caps = {
    budgetFlag: "supported" as const,
    checkpoint: "supported" as const,
    isolation: "supported" as const,
    toolsPolicy: "supported" as const,
    effortMapping: "supported" as const,
    costUsageFidelity: "partial" as const,
    sessionResume: "supported" as const,
    streamingEvents: "supported" as const,
    progressHeartbeat: "tool-lifecycle" as const,
  };
  const broken: WorkerAdapter = {
    name: "claude-code",
    displayName: "Broken Claude",
    defaultExecutable: "claude",
    capabilities: () => caps,
    doctor: (): WorkerDoctorResult => ({
      runtime: "claude-code",
      ok: false,
      executable: "claude",
      issues: ["simulated doctor failure for test"],
      capabilities: caps,
    }),
    validateSpec: () => {},
    effortArgs: () => [],
    toolProtocolAppendix: () => [],
    checkpointProtocolAppendix: () => [],
    run: async () => {
      throw new Error("run must not be called when doctor fails");
    },
  };
  // ensure builtins first then replace claude
  getWorkerAdapter("claude-code");
  registerWorkerAdapter(broken);

  const spec = parseTaskSpec(minimalContract(), home, policy());
  const task = {
    id: "22222222-2222-4222-8222-222222222222",
    name: spec.name,
    status: "queued" as const,
    sourcePath: path.join(home, "src"),
    taskFile: path.join(home, "task.yaml"),
    spec,
    paths: {
      root: path.join(home, "task"),
      baseline: path.join(home, "baseline"),
      workspace: path.join(home, "workspace"),
      logs: path.join(home, "logs"),
      claudeConfig: path.join(home, "claude"),
      diff: path.join(home, "diff.patch"),
    },
    sessionId: "33333333-3333-4333-8333-333333333333",
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
  };
  // A first Attempt now requires the same completed snapshot boundary as
  // production: baseline + workspace directories and the final manifest.
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(task.paths.root, { recursive: true });
  await mkdir(task.paths.baseline, { recursive: true });
  await mkdir(task.paths.workspace, { recursive: true });
  await mkdir(task.paths.logs, { recursive: true });
  await writeFile(
    path.join(task.paths.root, "source-manifest.json"),
    JSON.stringify({ files: [], skippedSymlinks: [] }),
  );
  store.createTask(task);

  const result = await executeAttempt(store, store.getTask(task.id), false);
  assert.equal(result.task.status, "failed");
  assert.match(result.task.error ?? "", /doctor failed|simulated doctor failure/);
  store.close();
  resetWorkerRegistryForTests();
});

// --- Advanced policy snapshot: runtime watchdog/timer consumption ---

import {
  noProgressFromSnapshot,
  stopGraceFromSnapshot,
  maxDurationFromSnapshot,
  observedTokenCeilingFromSnapshot,
  enforcementCapabilityForRuntime,
  defaultAdvancedPolicyFields as testDefaultAdvancedPolicy,
} from "../src/core/advanced-policy.js";

test("noProgressFromSnapshot returns null for null in snapshot (unlimited/watchdog disabled)", () => {
  const caps = enforcementCapabilityForRuntime("claude-code");
  const snap = {
    profileId: "test",
    values: { ...testDefaultAdvancedPolicy(), noProgressTimeoutMs: null },
    provenance: {} as Record<keyof ReturnType<typeof testDefaultAdvancedPolicy>, "task" | "worker" | "global">,
    enforcementCapability: caps,
  };
  const result = noProgressFromSnapshot(snap);
  assert.equal(result, null, "null noProgressTimeoutMs means unlimited (watchdog disabled)");
});

test("stopGraceFromSnapshot returns configured value", () => {
  const caps = enforcementCapabilityForRuntime("claude-code");
  const snap = {
    profileId: "test",
    values: { ...testDefaultAdvancedPolicy(), workerStopGraceMs: 5000 },
    provenance: {} as Record<keyof ReturnType<typeof testDefaultAdvancedPolicy>, "task" | "worker" | "global">,
    enforcementCapability: caps,
  };
  assert.equal(stopGraceFromSnapshot(snap), 5000);
});

test("maxDurationFromSnapshot returns null for unlimited, finite for configured", () => {
  const caps = enforcementCapabilityForRuntime("claude-code");
  const unlimited = {
    profileId: "test",
    values: { ...testDefaultAdvancedPolicy(), maxDurationMs: null },
    provenance: {} as Record<keyof ReturnType<typeof testDefaultAdvancedPolicy>, "task" | "worker" | "global">,
    enforcementCapability: caps,
  };
  assert.equal(maxDurationFromSnapshot(unlimited), null);

  const finite = {
    profileId: "test",
    values: { ...testDefaultAdvancedPolicy(), maxDurationMs: 300_000 },
    provenance: {} as Record<keyof ReturnType<typeof testDefaultAdvancedPolicy>, "task" | "worker" | "global">,
    enforcementCapability: caps,
  };
  assert.equal(maxDurationFromSnapshot(finite), 300_000);
});

test("observedTokenCeilingFromSnapshot returns null for unlimited, finite for configured", () => {
  const caps = enforcementCapabilityForRuntime("claude-code");
  const unlimited = {
    profileId: "test",
    values: { ...testDefaultAdvancedPolicy(), observedTokenCeiling: null },
    provenance: {} as Record<keyof ReturnType<typeof testDefaultAdvancedPolicy>, "task" | "worker" | "global">,
    enforcementCapability: caps,
  };
  assert.equal(observedTokenCeilingFromSnapshot(unlimited), null);

  const finite = {
    profileId: "test",
    values: { ...testDefaultAdvancedPolicy(), observedTokenCeiling: 50_000 },
    provenance: {} as Record<keyof ReturnType<typeof testDefaultAdvancedPolicy>, "task" | "worker" | "global">,
    enforcementCapability: caps,
  };
  assert.equal(observedTokenCeilingFromSnapshot(finite), 50_000);
});

test("legacy task without snapshot gets compatible defaults", () => {
  assert.equal(noProgressFromSnapshot(undefined), 1_800_000);
  assert.equal(stopGraceFromSnapshot(undefined), 10_000);
  assert.equal(maxDurationFromSnapshot(undefined), null);
  assert.equal(observedTokenCeilingFromSnapshot(undefined), null);
});

async function policyRunnerFixture(
  advancedPolicy: Partial<ReturnType<typeof testDefaultAdvancedPolicy>>,
) {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-policy-runner-"));
  const source = path.join(root, "source");
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(path.join(source, "src"), { recursive: true });
  await writeFile(path.join(source, "src", "hello.ts"), "export const n = 1;\n");
  const home = path.join(root, "state");
  const store = new StateStore(home);
  const { taskPaths } = await import("../src/core/config.js");
  const { prepareWorkspace } = await import("../src/workspace/copy.js");
  const id = "77777777-7777-4777-8777-777777777777";
  const paths = taskPaths(home, id);
  const spec = parseTaskSpec(
    minimalContract({ project: source }),
    source,
    { ...policy(), completionPolicy: { noChangeMode: "off", changeBudgetMode: "off" } },
  );
  await prepareWorkspace(spec, paths);
  const values = { ...testDefaultAdvancedPolicy(), ...advancedPolicy };
  const provenance = Object.fromEntries(
    Object.keys(values).map((field) => [field, "task"]),
  ) as Record<keyof typeof values, "task">;
  const task = {
    id,
    name: spec.name,
    status: "queued" as const,
    sourcePath: source,
    taskFile: path.join(home, "task.yaml"),
    spec,
    paths,
    sessionId: "88888888-8888-4888-8888-888888888888",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    effectivePolicy: {
      profileId: "test-worker",
      values,
      provenance,
      enforcementCapability: enforcementCapabilityForRuntime("claude-code"),
    },
  };
  store.createTask(task);
  return { store, task: store.getTask(id) };
}

function registerPolicyTestClaude(
  run: (ctx: WorkerRunContext) => Promise<WorkerExecutionResult>,
): void {
  resetWorkerRegistryForTests();
  getWorkerAdapter("claude-code");
  const capabilities = getWorkerAdapter("claude-code").capabilities();
  registerWorkerAdapter({
    name: "claude-code",
    displayName: "Policy test Claude",
    defaultExecutable: process.execPath,
    capabilities: () => capabilities,
    doctor: () => ({
      runtime: "claude-code",
      ok: true,
      executable: process.execPath,
      issues: [],
      capabilities,
    }),
    validateSpec: () => {},
    effortArgs: () => [],
    toolProtocolAppendix: () => [],
    checkpointProtocolAppendix: () => [],
    run,
  });
}

test("observed Token ceiling hard-fails after gross terminal usage", async () => {
  registerPolicyTestClaude(async () => ({
    status: "succeeded",
    exitCode: 0,
    resultText: "ok",
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadInputTokens: 3,
      cacheCreationInputTokens: 4,
      source: "terminal-result",
      complete: true,
    },
  }));
  const { store, task } = await policyRunnerFixture({ observedTokenCeiling: 20 });
  try {
    const result = await executeAttempt(store, task, false);
    assert.equal(result.task.status, "failed");
    assert.equal(result.verification, undefined);
    assert.match(result.task.error ?? "", /observed-token/);
    const event = store.listEvents(task.id).find((candidate) => candidate.type === "policy.token.exceeded");
    assert.ok(event);
    const evidence = event.payload as { observed: number; enforcementPhase: string };
    assert.equal(evidence.observed, 22, "gross usage includes both cache surfaces");
    assert.equal(evidence.enforcementPhase, "post-observation");
  } finally {
    store.close();
    resetWorkerRegistryForTests();
  }
});

test("Grok connectivity classifier matches measured transport family only", () => {
  assert.equal(
    isGrokConnectivityEvidence("Error: model/settings fetch timeout after 30000ms"),
    true,
    "model/settings fetch timeout is connectivity",
  );
  assert.equal(
    isGrokConnectivityEvidence("connect ECONNREFUSED 127.0.0.1:8080 via http://user:secret-token@proxy.local:7890"),
    true,
    "connection refused is connectivity",
  );
  assert.equal(
    isGrokConnectivityEvidence("fetch settings timed out while contacting cli-chat-proxy.grok.com"),
    true,
    "settings fetch timed out is connectivity",
  );
  assert.equal(
    isGrokConnectivityEvidence(
      "No effective implementation progress detected within the configured interval; worker was terminated by the progress watchdog",
    ),
    false,
    "no-progress watchdog text is not connectivity",
  );
  assert.equal(
    isGrokConnectivityEvidence("Model refused the edit because the patch was incorrect"),
    false,
    "ordinary model error is not connectivity",
  );
  assert.equal(
    isGrokConnectivityEvidence("timeout waiting for tool confirmation"),
    false,
    "bare non-transport timeout is not connectivity",
  );

  const secret = "http://user:secret-token@proxy.internal:7890";
  const rawTerminal = new GrokEventNormalizer().parseLine(JSON.stringify({
    type: "error",
    message: `Failed to fetch models: connection refused via ${secret} at https://private.example/v1`,
  }))[0]!;
  const safeTerminal = sanitizeGrokConnectivityEvent(rawTerminal);
  assert.equal(safeTerminal.summary, GROK_CONNECTIVITY_SAFE_ERROR);
  assert.equal(
    (safeTerminal.payload as { failureCategory?: string }).failureCategory,
    "connectivity",
  );
  assert.equal(safeTerminal.terminal?.resultText, GROK_CONNECTIVITY_SAFE_ERROR);
  const publicEvent = JSON.stringify(safeTerminal);
  assert.ok(!publicEvent.includes(secret));
  assert.ok(!publicEvent.includes("secret-token"));
  assert.ok(!publicEvent.includes("private.example"));
});

test("runner persists Grok connectivity category with fixed safe public error", async () => {
  const secretProxy = "http://user:super-secret-proxy-token@proxy.internal:7890";
  const rawStderr =
    `Failed model/settings fetch timeout via ${secretProxy} to https://cli-chat-proxy.grok.com path=/Users/private/.grok`;
  assert.equal(isGrokConnectivityEvidence(rawStderr), true);

  resetWorkerRegistryForTests();
  getWorkerAdapter("claude-code");
  const capabilities = getWorkerAdapter("claude-code").capabilities();
  registerWorkerAdapter({
    name: "claude-code",
    displayName: "Connectivity test Worker",
    defaultExecutable: process.execPath,
    capabilities: () => capabilities,
    doctor: () => ({
      runtime: "claude-code",
      ok: true,
      executable: process.execPath,
      issues: [],
      capabilities,
    }),
    validateSpec: () => {},
    effortArgs: () => [],
    toolProtocolAppendix: () => [],
    checkpointProtocolAppendix: () => [],
    run: async () => ({
      status: "failed",
      exitCode: 1,
      // Public error must already be the fixed safe summary from the adapter boundary.
      error: GROK_CONNECTIVITY_SAFE_ERROR,
      failureCategory: "connectivity",
    }),
  });

  const { store, task } = await policyRunnerFixture({});
  try {
    const result = await executeAttempt(store, task, false);
    assert.equal(result.task.status, "failed");
    assert.equal(result.task.error, GROK_CONNECTIVITY_SAFE_ERROR);
    assert.equal(result.attempt.error, GROK_CONNECTIVITY_SAFE_ERROR);

    const events = store.listEvents(task.id);
    assert.equal(failureCategoryFromEvents(events), "connectivity");
    const failed = events.filter((event) => event.type === "worker.failed");
    assert.ok(failed.length >= 1);
    const classified = failed.find(
      (event) => (event.payload as { failureCategory?: string } | undefined)?.failureCategory === "connectivity",
    );
    assert.ok(classified, "terminal worker.failed must carry connectivity category");
    assert.equal(classified.summary, GROK_CONNECTIVITY_SAFE_ERROR);

    const publicBlob = JSON.stringify({
      taskError: result.task.error,
      attemptError: result.attempt.error,
      events: failed.map((event) => ({ summary: event.summary, payload: event.payload })),
    });
    assert.ok(!publicBlob.includes(secretProxy), "proxy URL must not reach public evidence");
    assert.ok(!publicBlob.includes("super-secret-proxy-token"), "proxy token must not reach public evidence");
    assert.ok(!publicBlob.includes("cli-chat-proxy.grok.com"), "endpoint must not reach public evidence");
    assert.ok(!publicBlob.includes("/Users/private"), "local path must not reach public evidence");
  } finally {
    store.close();
    resetWorkerRegistryForTests();
  }
});

test("runner leaves ordinary runtime failures without connectivity category", async () => {
  resetWorkerRegistryForTests();
  getWorkerAdapter("claude-code");
  const capabilities = getWorkerAdapter("claude-code").capabilities();
  registerWorkerAdapter({
    name: "claude-code",
    displayName: "Runtime fail Worker",
    defaultExecutable: process.execPath,
    capabilities: () => capabilities,
    doctor: () => ({
      runtime: "claude-code",
      ok: true,
      executable: process.execPath,
      issues: [],
      capabilities,
    }),
    validateSpec: () => {},
    effortArgs: () => [],
    toolProtocolAppendix: () => [],
    checkpointProtocolAppendix: () => [],
    run: async () => ({
      status: "failed",
      exitCode: 1,
      error: "Grok Worker exited without a successful result",
    }),
  });

  const { store, task } = await policyRunnerFixture({});
  try {
    const result = await executeAttempt(store, task, false);
    assert.equal(result.task.status, "failed");
    const events = store.listEvents(task.id);
    assert.equal(failureCategoryFromEvents(events), undefined);
    assert.ok(!isGrokConnectivityEvidence(result.task.error));
  } finally {
    store.close();
    resetWorkerRegistryForTests();
  }
});

test("maximum wall duration preemptively terminates the spawned Worker", async () => {
  registerPolicyTestClaude(async (ctx) => {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"]);
    ctx.hooks?.onSpawn?.(child);
    const exitCode = await new Promise<number>((resolve) => {
      child.once("close", (code) => resolve(code ?? 130));
    });
    return { status: "interrupted", exitCode, error: "terminated for test" };
  });
  const { store, task } = await policyRunnerFixture({
    maxDurationMs: 50,
    workerStopGraceMs: 20,
  });
  try {
    const result = await executeAttempt(store, task, false);
    assert.equal(result.task.status, "failed");
    assert.match(result.task.error ?? "", /duration/);
    const event = store.listEvents(task.id).find((candidate) => candidate.type === "policy.duration.exceeded");
    assert.ok(event);
    const evidence = event.payload as { enforcementPhase: string; configured: number };
    assert.equal(evidence.enforcementPhase, "preemptive");
    assert.equal(evidence.configured, 50);
  } finally {
    store.close();
    resetWorkerRegistryForTests();
  }
});
