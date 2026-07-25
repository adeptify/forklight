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
  grokAllowTools,
  grokDisallowedTools,
  seedGrokHomeAuth,
} from "../src/workers/grok.js";
import { GrokEventNormalizer } from "../src/events/grok-normalize.js";
import type { TaskSpec } from "../src/core/types.js";
import { checkpointSatisfied } from "../src/core/checkpoint.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { StateStore } from "../src/state/store.js";
import { executeAttempt } from "../src/core/runner.js";
import type { WorkerAdapter, WorkerDoctorResult } from "../src/workers/types.js";
import { registerWorkerAdapter } from "../src/workers/registry.js";

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
    temporaryDirectory: "/var/folders/tmp",
  });
  assert.ok(profile.includes('(import "system.sb")'));
  assert.ok(profile.includes("(allow network*)"));
  assert.ok(profile.includes("(allow process*)"));
  assert.ok(profile.includes("(deny default)"));
  assert.ok(profile.includes("/Users/me"));
  assert.ok(profile.includes("/ws"));
  assert.ok(profile.includes("/Users/me/.grok"), "operator .grok must remain readable for CLI assets");
  assert.ok(
    profile.includes("/var/folders/tmp"),
    "temp directory must be on file-write allowlist (Claude parity)",
  );
  // Writes must not allow operator home broadly — only task grok home.
  assert.ok(profile.includes('(subpath "/gh")'));
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
  // Workspace must exist for executeAttempt
  const { mkdir } = await import("node:fs/promises");
  await mkdir(task.paths.workspace, { recursive: true });
  await mkdir(task.paths.logs, { recursive: true });
  store.createTask(task);

  const result = await executeAttempt(store, store.getTask(task.id), false);
  assert.equal(result.task.status, "failed");
  assert.match(result.task.error ?? "", /doctor failed|simulated doctor failure/);
  store.close();
  resetWorkerRegistryForTests();
});
