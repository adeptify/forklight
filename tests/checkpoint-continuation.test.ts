import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type {
  EventRecord,
  TaskRecord,
  TaskSpec,
  VerificationResult,
} from "../src/core/types.js";
import { workerLaunch } from "../src/workers/claude.js";
import {
  ClaudeEventNormalizer,
  parseMcpServerReadiness,
} from "../src/events/normalize.js";
import {
  checkpointMcpReadinessFromEvents,
  resolveTerminalAfterVerification,
} from "../src/core/checkpoint.js";
import {
  aggregateAttemptUsage,
  consumedAttemptCostUsd,
  remainingContinuationBudget,
} from "../src/core/worker-aggregate.js";
import {
  formatVerificationDiagnostics,
  sanitizeFailedVerificationDiagnostics,
} from "../src/core/verification-diagnostic.js";
import { workerValidationRepairFeedback } from "../src/core/worker-validation-repair.js";
import { parseTaskSpec } from "../src/core/task.js";
import { cloneDefaults } from "../src/core/settings.js";
import { executeAttempt } from "../src/core/runner.js";
import { getWorkerAdapter, registerWorkerAdapter, resetWorkerRegistryForTests } from "../src/workers/registry.js";
import { StateStore } from "../src/state/store.js";
import { prepareWorkspace } from "../src/workspace/copy.js";
import { taskPaths } from "../src/core/config.js";
import { defaultAdvancedPolicyFields, enforcementCapabilityForRuntime } from "../src/core/advanced-policy.js";
import type { WorkerAdapter, WorkerDoctorResult } from "../src/workers/types.js";
import type { AttemptExecutionOptions } from "../src/core/types.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function usageWith(input: number, output = 0, cacheRead = 0, cacheCreate = 0, extra: Record<string, unknown> = {}) {
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadInputTokens: cacheRead,
    cacheCreationInputTokens: cacheCreate,
    source: "terminal-result",
    complete: true,
    ...extra,
  };
}

function makeEvent(sequence: number, type: string, attemptId: string, payload?: unknown): EventRecord {
  return {
    id: sequence,
    taskId: "task-1",
    attemptId,
    sequence,
    timestamp: "2026-08-09T00:00:00.000Z",
    type,
    summary: type,
    ...(payload === undefined ? {} : { payload }),
  } as unknown as EventRecord;
}

// --- Sandbox launch paths ---------------------------------------------------

test("checkpoint MCP launch sandbox allows only the exact Node runtime and canonical modules", { skip: process.platform !== "darwin" }, () => {
  const task = {
    id: "task-ckpt-1",
    paths: {
      root: "/tmp/forklight-ckpt/runs/task-ckpt-1",
      workspace: "/tmp/forklight-ckpt/runs/task-ckpt-1/workspace",
      claudeConfig: "/tmp/forklight-ckpt/runs/task-ckpt-1/claude-config",
    },
    spec: {
      runtime: { executable: "claude" },
    },
  } as unknown as TaskRecord;
  const launch = workerLaunch(task, ["--version"]);
  assert.equal(launch.command, "/usr/bin/sandbox-exec");
  const profile = launch.args[1] ?? "";
  const nodeExec = process.execPath;
  // Only the exact Node runtime (and its realpath) is readable, and only as a
  // literal exception — never a subpath that would broaden the NVM directory.
  assert.match(profile, new RegExp(`\\(literal "${escapeRegExp(nodeExec)}"\\)`));
  assert.match(profile, new RegExp(`\\(literal "${escapeRegExp(realpathSync(nodeExec))}"\\)`));
  assert.doesNotMatch(profile, new RegExp(`\\(require-not \\(subpath "${escapeRegExp(nodeExec)}"\\)\\)`));
  assert.doesNotMatch(profile, new RegExp(`\\(require-not \\(subpath "${escapeRegExp(path.dirname(nodeExec))}"\\)\\)`));
  // Canonical source/dist modules proven necessary for the checkpoint server,
  // granted as literal-only exceptions.
  assert.match(profile, /\(literal "[^"]*src\/activation\/runner\.ts"\)/);
  assert.match(profile, /\(literal "[^"]*src\/core\/process\.ts"\)/);
  assert.match(profile, /\(literal "[^"]*src\/core\/source-digest\.ts"\)/);
  assert.match(profile, /\(literal "[^"]*src\/core\/time\.ts"\)/);
  assert.doesNotMatch(profile, /\(require-not \(subpath "[^"]*src\/activation\/runner\.ts"\)\)/);
  assert.doesNotMatch(profile, /\(require-not \(subpath "[^"]*src\/core\/process\.ts"\)\)/);
  assert.doesNotMatch(profile, /\(require-not \(subpath "[^"]*src\/core\/source-digest\.ts"\)\)/);
  assert.doesNotMatch(profile, /\(require-not \(subpath "[^"]*src\/core\/time\.ts"\)\)/);
  assert.match(profile, /daemon\/client\.ts/);
  assert.match(profile, /core\/build-identity\.ts/);
  // No scoped broad file-read allow (only the global allow + deny Home tree).
  assert.equal(profile.indexOf("(allow file-read* (subpath"), -1);
});

// --- MCP readiness classification -------------------------------------------

test("Claude init mcp_servers projects bounded readiness and completion guard records supported-but-unavailable", () => {
  // Measured Claude Code 2.1.206 shape: array of {name, status}.
  const events = new ClaudeEventNormalizer().parseLine(JSON.stringify({
    type: "system",
    subtype: "init",
    model: "deepseek-v4-flash",
    session_id: "session-1",
    mcp_servers: [
      { name: "forklight_checkpoint", status: "failed" },
      { name: "other-tool", status: "running" },
    ],
  }));
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "worker.message");
  const payload = events[0]?.payload as Record<string, unknown>;
  assert.deepEqual(payload?.mcpServers, [
    { name: "forklight_checkpoint", status: "failed" },
    { name: "other-tool", status: "ready" },
  ]);

  // Object-map + camelCase variant with a string status.
  const objectMap = new ClaudeEventNormalizer().parseLine(JSON.stringify({
    type: "system",
    subtype: "init",
    mcpServers: { forklight_checkpoint: "failed" },
  }));
  const objectPayload = objectMap[0]?.payload as Record<string, unknown>;
  assert.deepEqual(objectPayload?.mcpServers, [{ name: "forklight_checkpoint", status: "failed" }]);

  // Direct parser accepts the object-map shape with nested status.
  assert.deepEqual(parseMcpServerReadiness({ mcpServers: { forklight_checkpoint: { status: "ready" } } }), [
    { name: "forklight_checkpoint", status: "ready" },
  ]);

  // Only bounded codes are stored; unknown statuses are retained as bounded.
  assert.deepEqual(parseMcpServerReadiness({ mcp_servers: [{ name: "x", status: "starting" }] }), [
    { name: "x", status: "unknown" },
  ]);

  const failedEvent = makeEvent(1, "worker.message", "attempt-1", {
    mcpServers: [{ name: "forklight_checkpoint", status: "failed" }],
  });
  assert.equal(checkpointMcpReadinessFromEvents([failedEvent], "attempt-1"), "failed");
  assert.equal(checkpointMcpReadinessFromEvents([
    makeEvent(2, "worker.message", "attempt-1", {
      mcpServers: [{ name: "forklight_checkpoint", status: "ready" }],
    }),
  ], "attempt-1"), "ready");
  assert.equal(checkpointMcpReadinessFromEvents([
    makeEvent(3, "worker.message", "attempt-1", { model: "m" }),
  ], "attempt-1"), "unknown");

  // Completion guard: supported runtime + explicit MCP failure + no checkpoint
  // is supported-but-unavailable, never Worker omission.
  const unavailable = resolveTerminalAfterVerification({
    verificationPassed: true,
    checkpointCapability: "supported",
    checkpointSatisfied: false,
    mcpReadiness: "failed",
  });
  assert.equal(unavailable.status, "succeeded");
  assert.equal(unavailable.recordCheckpointGap, true);
  assert.equal(unavailable.gapReason, "mcp-unavailable");

  // A reported-ready server that still skipped its checkpoint remains the
  // existing missing-or-failed classification.
  const skipped = resolveTerminalAfterVerification({
    verificationPassed: true,
    checkpointCapability: "supported",
    checkpointSatisfied: false,
    mcpReadiness: "ready",
  });
  assert.equal(skipped.gapReason, "missing-or-failed-non-authoritative");
});

// --- Same-Attempt aggregation (deliberately non-cumulative) -----------------

test("same-Attempt continuation metrics are summed, never assumed cumulative", () => {
  const events = [
    makeEvent(1, "worker.started", "attempt-1"),
    makeEvent(2, "worker.completed", "attempt-1", {
      usage: usageWith(100, 20, 10, 5, {
        serviceTier: "default",
        perModel: [{ model: "deepseek-v4-flash", inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 10, cacheCreationInputTokens: 5 }],
      }),
      costUsd: 0.01,
      turns: 1,
    }),
    makeEvent(3, "worker.resumed", "attempt-1"),
    makeEvent(4, "worker.completed", "attempt-1", {
      usage: usageWith(80, 10, 0, 0, {
        serviceTier: "default",
        perModel: [{ model: "deepseek-v4-flash", inputTokens: 80, outputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }],
      }),
      costUsd: 0.02,
      turns: 1,
    }),
  ];
  const aggregate = aggregateAttemptUsage(events, "attempt-1");
  assert.equal(aggregate.invocationCount, 2);
  assert.equal(aggregate.usage?.inputTokens, 180, "100 + 80, not the latest 80");
  assert.equal(aggregate.usage?.outputTokens, 30);
  assert.equal(aggregate.usage?.cacheReadInputTokens, 10);
  assert.equal(aggregate.usage?.cacheCreationInputTokens, 5);
  assert.equal(aggregate.costUsd, 0.03);
  assert.equal(aggregate.runtimeCostEstimateUsd, 0.03);
  assert.equal(aggregate.turns, 2);
  assert.equal(aggregate.serviceTier, "default");
  assert.deepEqual(aggregate.perModel, [
    { model: "deepseek-v4-flash", inputTokens: 180, outputTokens: 30, cacheReadInputTokens: 10, cacheCreationInputTokens: 5 },
  ]);
  assert.equal(aggregate.costComplete, true);
});

test("aggregate usage omits incomplete or inconsistent detail instead of presenting it as truth", () => {
  // One invocation has complete=false usage → aggregate usage omitted.
  const incompleteUsage = {
    inputTokens: 100,
    outputTokens: 20,
    cacheReadInputTokens: 10,
    cacheCreationInputTokens: 5,
    source: "terminal-result",
    complete: false,
  };
  const partial = aggregateAttemptUsage([
    makeEvent(1, "worker.started", "attempt-1"),
    makeEvent(2, "worker.completed", "attempt-1", { usage: incompleteUsage, costUsd: 0.01, turns: 1 }),
    makeEvent(3, "worker.resumed", "attempt-1"),
    makeEvent(4, "worker.completed", "attempt-1", { usage: usageWith(80), costUsd: 0.02, turns: 1 }),
  ], "attempt-1");
  assert.equal(partial.usage, undefined, "incomplete usage must not be published as truth");
  assert.equal(partial.costUsd, 0.03, "cost remains exact when every invocation supplies it");

  // Different serviceTier across invocations → serviceTier omitted.
  const tierConflict = aggregateAttemptUsage([
    makeEvent(1, "worker.started", "attempt-1"),
    makeEvent(2, "worker.completed", "attempt-1", { usage: usageWith(1, 0, 0, 0, { serviceTier: "default" }), costUsd: 0.01 }),
    makeEvent(3, "worker.resumed", "attempt-1"),
    makeEvent(4, "worker.completed", "attempt-1", { usage: usageWith(1, 0, 0, 0, { serviceTier: "premium" }), costUsd: 0.01 }),
  ], "attempt-1");
  assert.equal(tierConflict.serviceTier, undefined, "conflicting tiers must not be presented as one tier");

  // perModel present in only one invocation → perModel omitted.
  const partialModel = aggregateAttemptUsage([
    makeEvent(1, "worker.started", "attempt-1"),
    makeEvent(2, "worker.completed", "attempt-1", {
      usage: usageWith(1, 0, 0, 0, { perModel: [{ model: "m1", inputTokens: 1, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }] }),
      costUsd: 0.01,
    }),
    makeEvent(3, "worker.resumed", "attempt-1"),
    makeEvent(4, "worker.completed", "attempt-1", { usage: usageWith(1), costUsd: 0.01 }),
  ], "attempt-1");
  assert.equal(partialModel.perModel, undefined, "perModel requires full coverage");

  // Missing per-invocation cost evidence fails closed for continuations.
  const missingCost = [
    makeEvent(1, "worker.started", "attempt-1"),
    makeEvent(2, "worker.completed", "attempt-1", { usage: usageWith(100) }),
  ];
  const consumed = consumedAttemptCostUsd(missingCost, "attempt-1");
  assert.equal(consumed.costComplete, false);
  assert.equal(remainingContinuationBudget(1.0, missingCost, "attempt-1"), 0, "zero remaining, not a reset");
});

test("continuation budget reduces the original maximum and never restores it", () => {
  const costed = [
    makeEvent(1, "worker.started", "attempt-1"),
    makeEvent(2, "worker.completed", "attempt-1", { costUsd: 0.4, turns: 1 }),
  ];
  assert.equal(remainingContinuationBudget(1.0, costed, "attempt-1"), 0.6);
  // The persisted aggregate is authoritative even when no event carried the cost.
  assert.equal(remainingContinuationBudget(1.0, [], "attempt-1", { costUsd: 0.4 }), 0.6);
  // A second prior invocation consumes further; the ceiling is never restored.
  // Binary float yields 1.0 - (0.4 + 0.5) === 0.0999…; the public remainder
  // must be the stable monetary value 0.1 at bounded USD handoff precision.
  const twoCosted = [
    makeEvent(1, "worker.started", "attempt-1"),
    makeEvent(2, "worker.completed", "attempt-1", { costUsd: 0.4 }),
    makeEvent(3, "worker.resumed", "attempt-1"),
    makeEvent(4, "worker.completed", "attempt-1", { costUsd: 0.5 }),
  ];
  assert.equal(remainingContinuationBudget(1.0, twoCosted, "attempt-1"), 0.1);
  // Uncapped budgets stay uncapped.
  assert.equal(remainingContinuationBudget(null, twoCosted, "attempt-1"), null);
  // Missing cost evidence remains fail-closed at zero (not a float remainder).
  const missingCost = [
    makeEvent(1, "worker.started", "attempt-1"),
    makeEvent(2, "worker.completed", "attempt-1", { usage: usageWith(100) }),
  ];
  assert.equal(remainingContinuationBudget(1.0, missingCost, "attempt-1"), 0);
});

// --- Runner integration: aggregate token ceiling ----------------------------

function testPolicy(): ReturnType<typeof cloneDefaults> {
  return cloneDefaults();
}

function minimalContract(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 2,
    name: "continuation-test",
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
    completionPolicy: { noChangeMode: "off", changeBudgetMode: "off" },
    ...overrides,
  };
}

function registerContinuationClaude(
  run: (call: number) => Promise<Record<string, unknown>>,
  onAttempt?: (call: number, attempt: { runtimeBudgetUsd?: number | null }) => void,
): void {
  resetWorkerRegistryForTests();
  getWorkerAdapter("claude-code");
  const capabilities = getWorkerAdapter("claude-code").capabilities();
  let callCount = 0;
  registerWorkerAdapter({
    name: "claude-code",
    displayName: "Continuation test Claude",
    defaultExecutable: process.execPath,
    capabilities: () => capabilities,
    doctor: (): WorkerDoctorResult => ({
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
    run: async (ctx: { attempt: { runtimeBudgetUsd?: number | null } }) => {
      callCount += 1;
      onAttempt?.(callCount, ctx.attempt);
      return run(callCount);
    },
  } as unknown as WorkerAdapter);
}

test("observed Token ceiling applies to the aggregate Attempt total, not the last sub-run", async () => {
  const seenBudgets: Array<number | null | undefined> = [];
  registerContinuationClaude(async (call) => {
    if (call === 1) {
      // Gross = 80 + 20 = 100 observed tokens.
      return {
        status: "interrupted",
        exitCode: 130,
        usage: usageWith(80, 20, 0, 0),
        costUsd: 0.05,
        turns: 1,
        runtimeCostEstimateUsd: 0.05,
      };
    }
    // Gross = 70 + 10 = 80 observed tokens.
    return {
      status: "succeeded",
      exitCode: 0,
      resultText: "ok",
      usage: usageWith(70, 10, 0, 0),
      costUsd: 0.04,
      turns: 1,
      runtimeCostEstimateUsd: 0.04,
    };
  }, (_call, attempt) => {
    seenBudgets.push(attempt.runtimeBudgetUsd);
  });

  const root = await mkdtemp(path.join(tmpdir(), "forklight-continuation-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "src"), { recursive: true });
  await writeFile(path.join(source, "src", "hello.ts"), "export const n = 1;\n");
  const home = path.join(root, "state");
  const store = new StateStore(home);
  const id = "99999999-9999-4999-8999-999999999999";
  const paths = taskPaths(home, id);
  const spec = parseTaskSpec(minimalContract({ project: source }), source, testPolicy()) as TaskSpec;
  await prepareWorkspace(spec, paths);
  await writeFile(path.join(paths.workspace, "src", "hello.ts"), "export const n = 2;\n");

  const values = { ...defaultAdvancedPolicyFields(), observedTokenCeiling: 150 };
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
    sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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

  const options: AttemptExecutionOptions = {
    maximumOrdinal: 2,
    attemptId: "continuation-attempt",
    executionKind: "standard",
  };
  try {
    const first = await executeAttempt(store, store.getTask(id), false, undefined, undefined, undefined, undefined, options);
    assert.equal(first.attempt.status, "interrupted");
    assert.equal(first.attempt.usage?.inputTokens, 80);

    const second = await executeAttempt(store, store.getTask(id), true, undefined, undefined, undefined, undefined, options);
    assert.equal(second.task.status, "failed");
    assert.equal(second.verification, undefined, "token ceiling fails before independent verification");
    assert.match(second.task.error ?? "", /observed-token/);
    assert.equal(second.attempt.usage?.inputTokens, 150, "aggregate across both invocations");

    const event = store.listEvents(id).find((candidate) => candidate.type === "policy.token.exceeded");
    assert.ok(event);
    const evidence = event.payload as { observed: number; configured: number };
    assert.equal(evidence.observed, 180, "ceiling sees the aggregate gross (100 + 80), not the latest 80");
    assert.equal(evidence.configured, 150);
    assert.deepEqual(
      seenBudgets,
      [0.1, 0.05],
      "first invocation gets the original ceiling; the continuation gets the remaining budget, never a reset",
    );
  } finally {
    store.close();
    resetWorkerRegistryForTests();
  }
});

// --- Sanitized repair diagnostics -------------------------------------------

function failingVerification(): VerificationResult {
  return {
    passed: false,
    behaviorPassed: false,
    policyPassed: true,
    sourceCompatible: true,
    commands: [
      {
        command: "npm run typecheck -- --header 'Authorization: Bearer sk-secret-token-abc'",
        exitCode: 1,
        stdout: "",
        stderr: "src/foo.ts:3:5 - error TS2322: Type 'string' is not assignable to type 'number'.\n"
          + "3   const x: number = 'hello';\n"
          + "      ~\n"
          + "Found 1 error.\n"
          + "Authorization: Bearer sk-other-secret-xyz\n",
        durationMs: 10,
        timedOut: false,
      },
      {
        command: "npm run passing",
        exitCode: 0,
        stdout: "all green",
        stderr: "",
        durationMs: 2,
        timedOut: false,
      },
    ],
    diffPath: "/tmp/diff",
    sourceUnchanged: false,
  };
}

test("sanitized diagnostics include command identity, exit status, and useful file/line/error; exclude secrets, passing output, and private paths", () => {
  const diagnostics = sanitizeFailedVerificationDiagnostics(failingVerification(), {
    workspaceRoot: "/private/tmp/workspace",
  });
  assert.equal(diagnostics.length, 1, "only the failing command contributes");
  const diagnostic = diagnostics[0]!;
  assert.equal(diagnostic.exitCode, 1);
  assert.equal(diagnostic.timedOut, false);
  // Useful file:line and error code are preserved.
  const text = formatVerificationDiagnostics(diagnostics);
  assert.match(text, /src\/foo\.ts:3:5/);
  assert.match(text, /error TS2322/);
  // Passing output never appears.
  assert.doesNotMatch(text, /all green/);
  assert.doesNotMatch(text, /npm run passing/);
  // Credentials are removed completely, including command labels.
  assert.doesNotMatch(text, /sk-secret-token-abc/);
  assert.doesNotMatch(text, /sk-other-secret-xyz/);
  assert.doesNotMatch(text, /Authorization/);
  assert.doesNotMatch(text, /Bearer/);
  // Absolute private paths are absent.
  assert.doesNotMatch(text, /\/private\/tmp\/workspace/);
});

test("sanitized diagnostics are bounded in size and line count", () => {
  const hugeStderr = Array.from({ length: 500 }, (_, index) =>
    `src/foo.ts:${index + 1}:1 - error TS999${index}: repeated error ${"x".repeat(300)}`).join("\n");
  const verification: VerificationResult = {
    passed: false,
    behaviorPassed: false,
    policyPassed: true,
    sourceCompatible: true,
    commands: [{
      command: "tsc",
      exitCode: 2,
      stdout: "",
      stderr: hugeStderr,
      durationMs: 5,
      timedOut: false,
    }],
    diffPath: "/tmp/diff",
    sourceUnchanged: false,
  };
  const diagnostics = sanitizeFailedVerificationDiagnostics(verification);
  assert.equal(diagnostics.length, 1);
  assert.ok(diagnostics[0]!.lines.length <= 12, "per-command line bound");
  assert.ok(diagnostics[0]!.omittedLineCount > 0, "overflow is reported as omitted");
  const text = formatVerificationDiagnostics(diagnostics);
  assert.ok(text.length <= 6_000, "total envelope bound");
  assert.ok(text.length > 0);
});

test("sanitizer rejects explicit pass lines and keeps the real failing test evidence", () => {
  const verification: VerificationResult = {
    passed: false,
    behaviorPassed: false,
    policyPassed: true,
    sourceCompatible: true,
    commands: [{
      command: "node --test tests/checkpoint-continuation.test.ts",
      exitCode: 1,
      stdout: "",
      stderr: "✔ provider×runtime pairing fail-closed (0.2465ms)\n"
        + "✔ Codex JSONL malformed and conflicting terminal evidence fail closed (0.065084ms)\n"
        + "✖ sanitized diagnostics include command identity, exit status, and useful file/line/error (1.742792ms)\n"
        + "    src/core/worker-aggregate.ts(334,3): error TS2375: Type is not assignable.\n"
        + "Found 1 error.",
      durationMs: 10,
      timedOut: false,
    }],
    diffPath: "/tmp/diff",
    sourceUnchanged: false,
  };
  const text = formatVerificationDiagnostics(sanitizeFailedVerificationDiagnostics(verification));
  // Passing titles are excluded, including a passing title whose name contains
  // "fail-closed"; the real failing test and its file/line error are retained.
  assert.doesNotMatch(text, /provider×runtime pairing fail-closed/);
  assert.doesNotMatch(text, /Codex JSONL malformed and conflicting terminal evidence/);
  assert.match(text, /sanitized diagnostics include command identity/);
  assert.match(text, /worker-aggregate\.ts\(334,3\)/);
  assert.match(text, /error TS2375/);
  assert.match(text, /Found 1 error/);
});

test("finite validation repair feedback carries the sanitized diagnostic", () => {
  const feedback = workerValidationRepairFeedback(failingVerification(), 1, "/private/tmp/workspace");
  assert.match(feedback, /validation-repair round 1/);
  assert.match(feedback, /src\/foo\.ts:3:5/);
  assert.match(feedback, /error TS2322/);
  assert.doesNotMatch(feedback, /sk-secret-token-abc/);
  assert.doesNotMatch(feedback, /all green/);
  assert.doesNotMatch(feedback, /Authorization/);
});
