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
import {
  buildWorkerPrompt,
  claudeToolProtocolLines,
  GENERIC_CODING_SUMMARY_INSTRUCTION,
  hardBoundaries,
  isReviewGraphReviewerTaskFile,
  neutralToolProtocolLines,
  reviewerTerminalOutputLines,
  workerPromptAppendicesForTask,
} from "../src/core/task.js";
import {
  buildGrokCliArgs,
  buildGrokSandboxProfile,
  buildGrokWorkerEnv,
  GrokBuildAdapter,
  GROK_CONNECTIVITY_SAFE_ERROR,
  GROK_NATIVE_FOREGROUND_BLOCK_BUDGET_MS,
  grokAllowTools,
  grokDisallowedTools,
  grokLaunchEvidence,
  grokNativeAllowTools,
  grokNativeDenyArgs,
  grokNativeDisallowedTools,
  grokSessionArgs,
  isGrokConnectivityEvidence,
  sanitizeGrokConnectivityEvent,
  seedGrokHomeAuth,
} from "../src/workers/grok.js";
import {
  evaluateGrokNativeGoalResult,
  GROK_NATIVE_GOAL_FAILURE,
  GROK_NATIVE_GOAL_PROMPT_PREFIX,
  GROK_NATIVE_GOAL_RESUME_PROMPT,
  grokNativeGoalObservation,
  grokNativeGoalStatePath,
  readGrokNativeGoalState,
  resolveGrokNativeGoalLaunch,
} from "../src/workers/grok-goal.js";
import {
  buildCodexCliArgs,
  buildCodexWorkerEnv,
  codexHardBoundaryPolicy,
  CodexCliAdapter,
  codexWorkspaceToolLines,
  runCodexWorker,
  seedCodexHome,
} from "../src/workers/codex.js";
import { childEnvironment, ClaudeCodeAdapter } from "../src/workers/claude.js";
import {
  DEFAULT_NO_PROXY,
  validateWorkerNetworkPolicy,
} from "../src/core/network-policy.js";
import { failureCategoryFromEvents } from "../src/core/worker-failure.js";
import { isEffectiveProgressEvent } from "../src/core/runtime-activity.js";
import { ClaudeEventNormalizer } from "../src/events/normalize.js";
import {
  appendGrokTextDelta,
  createGrokTextAssembly,
  extractGrokTextDeltaFromLine,
  GROK_ASSEMBLED_TEXT_MAX,
  GrokEventNormalizer,
  isMeaningfulGrokResultText,
  resolveGrokTerminalResultText,
} from "../src/events/grok-normalize.js";
import {
  codexAgentMessageFromLine,
  CODEX_ACCOUNT_USAGE_LIMIT_REASON,
  CODEX_ACCOUNT_USAGE_LIMIT_SUMMARY,
  CODEX_APP_SERVER_RESULT_TEXT_MAX,
  codexAppServerTokenUsage,
  CodexEventNormalizer,
  codexUsage,
  isCodexAccountUsageLimitMessage,
  privacySafeToolCorrelationToken,
  privateCodexDiffDigest,
  projectCodexAppServerFinalItem,
  projectCodexAppServerItemProgress,
  projectCodexAppServerWorkspaceChangeMilestone,
} from "../src/events/codex-normalize.js";
import type { AttemptRecord, TaskRecord, TaskSpec } from "../src/core/types.js";
import {
  buildCompactInspection,
  humanCompactInspectionLines,
} from "../src/cli/supervision.js";
import { checkpointSatisfied } from "../src/core/checkpoint.js";
import { mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { StateStore } from "../src/state/store.js";
import {
  authorizeMainCorrection,
  authorizeSystemRestartRecovery,
} from "../src/core/attempt-authorization.js";
import {
  correctTask,
  executeAttempt,
  prepareMainCorrectionTask,
  recordWorkerConnectionEvidenceFromCompletedEvent,
  resumeTask,
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

test("runtime name whitelist includes Claude, Grok, and Codex", () => {
  assert.ok(isRuntimeName("claude-code"));
  assert.ok(isRuntimeName("grok-build"));
  assert.ok(isRuntimeName("codex-cli"));
  assert.equal(isRuntimeName("nope"), false);
  assert.ok(SUPPORTED_RUNTIME_NAMES.includes("claude-code"));
  assert.ok(SUPPORTED_RUNTIME_NAMES.includes("grok-build"));
  assert.ok(SUPPORTED_RUNTIME_NAMES.includes("codex-cli"));
});

test("provider×runtime pairing fail-closed", () => {
  assert.doesNotThrow(() => assertProviderRuntimePair("xai", "grok-build"));
  assert.doesNotThrow(() => assertProviderRuntimePair("deepseek", "claude-code"));
  assert.doesNotThrow(() => assertProviderRuntimePair("openai", "codex-cli"));
  assert.throws(() => assertProviderRuntimePair("deepseek", "grok-build"), /xai/);
  assert.throws(() => assertProviderRuntimePair("xai", "claude-code"), /xai/);
  assert.throws(() => assertProviderRuntimePair("deepseek", "codex-cli"), /openai/);
  assert.throws(() => assertProviderRuntimePair("openai", "claude-code"), /codex-cli/);
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

test("registry dispatches Claude, Grok, and Codex adapters", () => {
  resetWorkerRegistryForTests();
  const names = listWorkerAdapters().map((a) => a.name).sort();
  assert.deepEqual(names, ["claude-code", "codex-cli", "grok-build"]);
  const claude = getWorkerAdapter("claude-code");
  assert.equal(claude.capabilities().checkpoint, "supported");
  const grok = getWorkerAdapter("grok-build");
  assert.equal(grok.capabilities().checkpoint, "unsupported");
  assert.equal(grok.capabilities().nativeGoal, "supported");
  const codex = getWorkerAdapter("codex-cli");
  assert.equal(codex.capabilities().sessionResume, "unsupported");
  assert.equal(codex.capabilities().nativeGoal, "supported");
  assert.equal(codex.defaultExecutable, "codex");
  assert.ok(grokDisallowedTools().includes("run_terminal_cmd"));
  assert.throws(() => getWorkerAdapter("unknown"), /Unknown worker runtime/);
});

test("Codex CLI argv freezes model, effort, sandbox, and disabled expansion paths", () => {
  const args = buildCodexCliArgs({
    prompt: "bounded task",
    workspace: "/private/task/workspace",
    model: "gpt-5.6-luna",
    effort: "max",
    allowEdits: true,
  });
  assert.equal(args[0], "exec");
  assert.ok(args.includes("--ephemeral"));
  assert.ok(args.includes("--json"));
  assert.ok(args.includes("--ignore-user-config"));
  assert.ok(args.includes("--ignore-rules"));
  assert.equal(args[args.indexOf("--sandbox") + 1], "workspace-write");
  assert.equal(args[args.indexOf("--model") + 1], "gpt-5.6-luna");
  assert.ok(args.includes('model_reasoning_effort="max"'));
  assert.ok(args.includes('approval_policy="never"'));
  assert.ok(args.includes("features.multi_agent=false"));
  assert.ok(args.includes("features.apps=false"));
  assert.ok(args.includes('web_search="disabled"'));
  assert.ok(args.includes("project_doc_max_bytes=0"));
  assert.ok(args.includes("sandbox_workspace_write.network_access=false"));
  assert.ok(args.includes("sandbox_workspace_write.exclude_slash_tmp=true"));
  assert.ok(!args.some((arg) => arg.includes("exclude_tmpdir_env_var=true")));
  assert.ok(!args.includes("danger-full-access"));
  assert.ok(!args.includes("--add-dir"));
  assert.ok(!args.includes("ultra"));

  const readOnly = buildCodexCliArgs({
    prompt: "review",
    workspace: "/private/task/workspace",
    model: "gpt-5.6-sol",
    effort: "high",
    allowEdits: false,
  });
  assert.equal(readOnly[readOnly.indexOf("--sandbox") + 1], "read-only");
  assert.ok(readOnly.includes("sandbox_workspace_write.network_access=false"));
  assert.ok(readOnly.includes("sandbox_workspace_write.exclude_slash_tmp=true"));
  assert.ok(!readOnly.includes("danger-full-access"));
  assert.ok(!readOnly.includes("--add-dir"));
  assert.deepEqual(new CodexCliAdapter().effortArgs("xhigh"), [
    "-c", 'model_reasoning_effort="xhigh"',
  ]);
});

/** Shared helpers for Codex prompt+argv contract regressions (FL-111A). */
function codexContractSpec(allowEdits: boolean): TaskSpec {
  return parseTaskSpec(
    minimalContract({
      provider: {
        name: "openai",
        model: "gpt-5.6-luna",
        keychainService: "forklight.openai.api-key",
      },
      runtime: {
        name: "codex-cli",
        executable: "codex",
        effort: "high",
        maxBudgetUsd: 0.1,
      },
      worker: { allowEdits, allowedCommands: [], focusPaths: ["src"] },
    }),
    "/tmp",
    policy(),
  );
}

function renderCodexWorkerPrompt(allowEdits: boolean, nativeGoalExtra = false): string {
  const toolLines = nativeGoalExtra
    ? [
        ...codexWorkspaceToolLines(allowEdits),
        "- Project instructions from operator config are disabled for this Goal.",
        "- This is a Runtime-native Goal: it owns the bounded end-to-end implementation.",
      ]
    : codexWorkspaceToolLines(allowEdits);
  return buildWorkerPrompt(codexContractSpec(allowEdits), false, undefined, {
    toolLines,
    checkpointLines: [
      "",
      "- This Codex Worker foundation does not support ForkLight checkpoint MCP.",
      "- ForkLight will run the independent acceptance commands after the Worker exits.",
    ],
    hardBoundaryPolicy: codexHardBoundaryPolicy(allowEdits),
  });
}

function assertCodexForbiddenAuthorityAbsent(prompt: string, args?: string[]): void {
  // Prompt layer: never grant expansion paths or Worker-run acceptance authority.
  assert.ok(!prompt.includes("Shell access is intentionally unavailable"));
  assert.ok(!/danger-full-access|dangerFullAccess/i.test(prompt));
  assert.ok(!/approval.?escalation is enabled|request approval/i.test(prompt));
  assert.ok(!prompt.includes("You may run the acceptance commands"));
  assert.match(prompt, /ForkLight will run the (independent )?acceptance commands/i);
  assert.match(prompt, /Never commit, push/);
  assert.match(prompt, /Command network access is disabled|command network is disabled/i);
  assert.match(prompt, /product file/i);
  assert.match(prompt, /Runtime-private temporary storage|task-private temporary storage/i);
  assert.match(prompt, /global \/tmp/i);
  if (args === undefined) return;
  // Argv layer: frozen least-privilege launch policy.
  assert.ok(args.includes('approval_policy="never"'));
  assert.ok(args.includes("features.multi_agent=false"));
  assert.ok(args.includes("features.apps=false"));
  assert.ok(args.includes('web_search="disabled"'));
  assert.ok(args.includes("--ignore-user-config"));
  assert.ok(args.includes("--ignore-rules"));
  assert.ok(args.includes("sandbox_workspace_write.network_access=false"));
  assert.ok(args.includes("sandbox_workspace_write.exclude_slash_tmp=true"));
  assert.ok(!args.some((arg) => arg.includes("exclude_tmpdir_env_var=true")));
  assert.ok(!args.includes("danger-full-access"));
  assert.ok(!args.includes("--add-dir"));
}

/** Shared assertions for the Runtime-aware Codex prompt surface (helpers + real artifacts). */
function assertCodexEditablePromptContract(prompt: string): void {
  assert.match(prompt, /workspace-sandboxed command tool/i);
  assert.match(prompt, /product file inspect, search, and edit|inspect, search, and edit as authorized/i);
  assert.match(prompt, /workspace-write/);
  assert.ok(!prompt.includes("Shell access is intentionally unavailable"));
  assert.ok(!prompt.includes("Do not attempt to run commands"));
  assert.match(prompt, /not separate Read\/Grep\/Edit tools/);
  assertCodexForbiddenAuthorityAbsent(prompt);
}

function assertCodexReadOnlyPromptContract(prompt: string): void {
  assert.match(prompt, /workspace-sandboxed command tool/i);
  assert.match(prompt, /inspect and search/i);
  assert.match(prompt, /do not edit product files/i);
  assert.match(prompt, /read-only/);
  assert.ok(!prompt.includes("Shell access is intentionally unavailable"));
  assert.ok(!/inspect, search, and edit as authorized/.test(prompt));
  assert.ok(!prompt.includes("under workspace-write"));
  assertCodexForbiddenAuthorityAbsent(prompt);
}

test("Codex editable prompt+argv permit workspace-sandboxed inspect/search/edit without no-shell contradiction", () => {
  // Regression for the zero-Diff dogfood defect: Codex was told to use Codex
  // tools while the shared boundary forbade the only command-backed path.
  const prompt = renderCodexWorkerPrompt(true);
  const args = buildCodexCliArgs({
    prompt,
    workspace: "/private/task/workspace",
    model: "gpt-5.6-luna",
    effort: "high",
    allowEdits: true,
  });

  assertCodexEditablePromptContract(prompt);
  assert.equal(args[args.indexOf("--sandbox") + 1], "workspace-write");
  assertCodexForbiddenAuthorityAbsent(prompt, args);

  // Same contract is shared with native Goal tool lines (lifecycle unchanged).
  const goalPrompt = renderCodexWorkerPrompt(true, true);
  assertCodexEditablePromptContract(goalPrompt);
  assert.match(goalPrompt, /Runtime-native Goal/);
});

test("Codex read-only prompt+argv permit inspect/search but forbid edits", () => {
  const prompt = renderCodexWorkerPrompt(false);
  const args = buildCodexCliArgs({
    prompt,
    workspace: "/private/task/workspace",
    model: "gpt-5.6-sol",
    effort: "high",
    allowEdits: false,
  });

  assertCodexReadOnlyPromptContract(prompt);
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
  assertCodexForbiddenAuthorityAbsent(prompt, args);
});

test("Claude and Grok keep tool-only/no-shell hard boundaries without Codex command-tool wording", () => {
  const claudeSpec = parseTaskSpec(minimalContract(), "/tmp", policy());
  const claude = new ClaudeCodeAdapter();
  const claudeTask = {
    spec: claudeSpec,
    taskFile: "/tmp/task.yaml",
  } as TaskRecord;
  const claudePrompt = buildWorkerPrompt(claudeSpec, false, undefined, {
    toolLines: claude.toolProtocolAppendix(claudeTask),
    checkpointLines: claude.checkpointProtocolAppendix(claudeTask),
  });
  assert.ok(claudePrompt.includes("Shell access is intentionally unavailable"));
  assert.ok(claudePrompt.includes("Do not attempt to run commands"));
  assert.ok(!claudePrompt.includes("workspace-sandboxed command tool"));
  assert.ok(!claudePrompt.includes("workspace-write"));
  assert.ok(claudeToolProtocolLines(["src"]).some((line) => line.includes("Glob")));

  const grokSpec = parseTaskSpec(
    minimalContract({
      provider: { name: "xai", model: "grok-build", keychainService: "forklight.xai.api-key" },
      runtime: { name: "grok-build", executable: "grok", effort: "high", maxBudgetUsd: 0.1 },
    }),
    "/tmp",
    policy(),
  );
  const grok = new GrokBuildAdapter();
  const grokTask = {
    spec: grokSpec,
    taskFile: "/tmp/task.yaml",
  } as TaskRecord;
  const grokPrompt = buildWorkerPrompt(grokSpec, false, undefined, {
    toolLines: grok.toolProtocolAppendix(grokTask),
    checkpointLines: grok.checkpointProtocolAppendix(grokTask),
  });
  assert.ok(grokPrompt.includes("Shell access is intentionally unavailable"));
  assert.ok(grokPrompt.includes("Do not attempt to run commands"));
  assert.ok(!grokPrompt.includes("workspace-sandboxed command tool"));
  assert.ok(!grokPrompt.includes("workspace-write"));
  assert.ok(
    neutralToolProtocolLines(["src"]).some((line) =>
      line.includes("Do not use unrestricted shell")),
  );
  // Grok tool allowlist still denies unrestricted shell tools.
  assert.ok(grokDisallowedTools().includes("run_terminal_cmd"));

  // Default hardBoundaries (no policy) remain tool-only/no-shell.
  const defaults = hardBoundaries();
  assert.ok(defaults.some((line) => line.includes("Shell access is intentionally unavailable")));
  assert.ok(!defaults.some((line) => line.includes("workspace-sandboxed command tool")));
});

test("Runtime hard-boundary policy cannot drop isolation, Git, or acceptance prohibitions", () => {
  for (const policyKind of [
    { kind: "tool-only-no-shell" as const },
    { kind: "codex-workspace-command" as const, allowEdits: true },
    { kind: "codex-workspace-command" as const, allowEdits: false },
  ]) {
    const lines = hardBoundaries(policyKind);
    assert.ok(lines.some((line) => line.includes("Work only inside the current workspace")));
    assert.ok(lines.some((line) => line.includes("Never commit, push")));
    assert.ok(lines.some((line) =>
      line.includes("ForkLight will run the acceptance commands independently")));
    assert.ok(!lines.some((line) => /danger-full-access|add-dir|nested agents are enabled/i.test(line)));
  }
});

test("Codex JSONL normalizer preserves session, progress, result, and exact usage", () => {
  const normalizer = new CodexEventNormalizer();
  const started = normalizer.parseLine('{"type":"thread.started","thread_id":"thread-1"}');
  assert.equal(started[0]?.sessionId, "thread-1");
  const tool = normalizer.parseLine('{"type":"item.started","item":{"id":"i1","type":"command_execution","command":"npm test"}}');
  assert.equal(tool[0]?.type, "worker.tool.started");
  const messageLine = '{"type":"item.completed","item":{"id":"i2","type":"agent_message","text":"Implemented safely"}}';
  assert.equal(codexAgentMessageFromLine(messageLine), "Implemented safely");
  assert.equal(normalizer.parseLine(messageLine)[0]?.type, "worker.message");
  const done = normalizer.parseLine('{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":40,"cache_write_input_tokens":3,"output_tokens":20,"reasoning_output_tokens":7}}');
  assert.equal(done[0]?.type, "worker.completed");
  assert.deepEqual(done[0]?.terminal?.usage, {
    inputTokens: 100,
    outputTokens: 20,
    cacheReadInputTokens: 40,
    cacheCreationInputTokens: 3,
    source: "terminal-result",
    complete: true,
  });
  assert.equal(codexUsage({ input_tokens: 1, output_tokens: 2 })?.cacheReadInputTokens, 0);
  assert.equal(codexUsage({ input_tokens: 1 }), undefined);
  assert.equal(normalizer.parseLine('{"type":"turn.completed","usage":{}}')[0]?.type, "worker.failed");
});

test("shared activityEvidence: Claude thinking is liveness; response/tool are effective", () => {
  const claude = new ClaudeEventNormalizer();
  const thinking = claude.parseLine(JSON.stringify({
    type: "system",
    subtype: "thinking_tokens",
    estimated_tokens: 99_999,
  }))[0]!;
  assert.equal(isEffectiveProgressEvent(thinking.type, thinking.payload), false);
  assert.equal((thinking.payload as { activityEvidence?: string }).activityEvidence, "liveness");
  assert.ok(!JSON.stringify(thinking.payload).includes("99999"));

  const response = claude.parseLine(JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "visible work" }] },
  }))[0]!;
  assert.equal(isEffectiveProgressEvent(response.type, response.payload), true);
  assert.equal((response.payload as { activityEvidence?: string }).activityEvidence, "effective-progress");

  const tool = claude.parseLine(JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id: "t1", name: "Read", input: { path: "/private" } }],
    },
  }))[0]!;
  assert.equal(isEffectiveProgressEvent(tool.type, tool.payload), true);
  assert.equal((tool.payload as { activityEvidence?: string }).activityEvidence, "effective-progress");
});

test("shared activityEvidence: Codex session/turn-start are liveness; tools and text are effective", () => {
  const normalizer = new CodexEventNormalizer();
  const session = normalizer.parseLine('{"type":"thread.started","thread_id":"thread-1"}')[0]!;
  assert.equal(isEffectiveProgressEvent(session.type, session.payload), false);
  assert.equal((session.payload as { activityEvidence?: string }).activityEvidence, "liveness");

  const turn = normalizer.parseLine('{"type":"turn.started"}')[0]!;
  assert.equal(isEffectiveProgressEvent(turn.type, turn.payload), false);
  assert.equal((turn.payload as { activityEvidence?: string }).activityEvidence, "liveness");

  const tool = normalizer.parseLine('{"type":"item.started","item":{"id":"i1","type":"command_execution"}}')[0]!;
  assert.equal(isEffectiveProgressEvent(tool.type, tool.payload), true);
  assert.equal((tool.payload as { activityEvidence?: string }).activityEvidence, "effective-progress");

  const text = normalizer.parseLine(
    '{"type":"item.completed","item":{"id":"i2","type":"agent_message","text":"done"}}',
  )[0]!;
  assert.equal(isEffectiveProgressEvent(text.type, text.payload), true);
  assert.equal((text.payload as { activityEvidence?: string }).activityEvidence, "effective-progress");

  // Keepalive-style unknown stream records stay liveness-only.
  const keep = normalizer.parseLine('{"type":"session.keepalive"}')[0]!;
  assert.equal(isEffectiveProgressEvent(keep.type, keep.payload), false);
  assert.equal((keep.payload as { activityEvidence?: string }).activityEvidence, "liveness");
});

test("Worker adapters advertise effective-progress heartbeat policy", () => {
  resetWorkerRegistryForTests();
  for (const name of ["claude-code", "grok-build", "codex-cli"] as const) {
    const caps = getWorkerAdapter(name).capabilities();
    assert.equal(
      caps.progressHeartbeat,
      "effective-progress",
      `${name} must reset watchdog only on effective progress`,
    );
  }
});

test("Codex JSONL malformed and conflicting terminal evidence fail closed", () => {
  const malformed = new CodexEventNormalizer().parseLine("not-json");
  assert.equal(malformed[0]?.type, "worker.failed");
  assert.equal(malformed[0]?.terminal?.isError, true);

  const duplicate = new CodexEventNormalizer();
  duplicate.parseLine('{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}');
  const conflict = duplicate.parseLine('{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}');
  assert.equal(conflict[0]?.type, "worker.failed");
  assert.match(conflict[0]?.terminal?.failureReason ?? "", /conflicting terminal/);
});

/** Measured Codex provider account usage-limit message family (FL-111D1). */
const CODEX_QUOTA_MESSAGE =
  "You've hit your usage limit. Try again later.";

function assertSingleCodexQuotaFailure(events: ReturnType<CodexEventNormalizer["parseLine"]>): void {
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "worker.failed");
  assert.equal(events[0]?.summary, CODEX_ACCOUNT_USAGE_LIMIT_SUMMARY);
  assert.equal(events[0]?.terminal?.failureReason, CODEX_ACCOUNT_USAGE_LIMIT_SUMMARY);
  assert.equal(
    (events[0]?.payload as { failureCategory?: string } | undefined)?.failureCategory,
    "budget",
  );
  assert.equal(
    (events[0]?.payload as { reasonCode?: string } | undefined)?.reasonCode,
    CODEX_ACCOUNT_USAGE_LIMIT_REASON,
  );
  assert.equal(events[0]?.terminal?.usage, undefined, "quota rejection never invents usage");
}

test("Codex account usage-limit error then same-message turn.failed is one budget failure", () => {
  // Exact measured two-terminal shape: error, then turn.failed with the same message.
  assert.equal(isCodexAccountUsageLimitMessage(CODEX_QUOTA_MESSAGE), true);
  assert.equal(isCodexAccountUsageLimitMessage("usage limit credits"), false,
    "generic tokens alone must not classify as account quota");
  assert.equal(isCodexAccountUsageLimitMessage("Worker hit a file limit"), false);

  const normalizer = new CodexEventNormalizer();
  normalizer.parseLine('{"type":"thread.started","thread_id":"thread-quota"}');
  normalizer.parseLine('{"type":"turn.started"}');
  const first = normalizer.parseLine(JSON.stringify({
    type: "error",
    message: CODEX_QUOTA_MESSAGE,
  }));
  assertSingleCodexQuotaFailure(first);
  const second = normalizer.parseLine(JSON.stringify({
    type: "turn.failed",
    error: { message: CODEX_QUOTA_MESSAGE },
  }));
  assert.deepEqual(second, [], "identical duplicate failure emits no second public terminal");
  // A later different terminal still fails closed.
  const conflict = normalizer.parseLine(JSON.stringify({
    type: "turn.failed",
    error: { message: "some other failure" },
  }));
  assert.equal(conflict[0]?.type, "worker.failed");
  assert.match(conflict[0]?.terminal?.failureReason ?? "", /conflicting terminal/);
});

test("Codex account usage-limit turn.failed then same-message error is also idempotent", () => {
  const normalizer = new CodexEventNormalizer();
  const first = normalizer.parseLine(JSON.stringify({
    type: "turn.failed",
    error: { message: CODEX_QUOTA_MESSAGE },
  }));
  assertSingleCodexQuotaFailure(first);
  const second = normalizer.parseLine(JSON.stringify({
    type: "error",
    message: CODEX_QUOTA_MESSAGE,
  }));
  assert.deepEqual(second, [], "reverse-order duplicate is suppressed");
});

test("Codex different failure reasons and success-related terminals still conflict", () => {
  // Different failure reasons remain ambiguous.
  const different = new CodexEventNormalizer();
  different.parseLine(JSON.stringify({ type: "error", message: "network boom" }));
  const differentConflict = different.parseLine(JSON.stringify({
    type: "turn.failed",
    error: { message: "auth boom" },
  }));
  assert.match(differentConflict[0]?.terminal?.failureReason ?? "", /conflicting terminal/);

  // Failure then success conflicts.
  const failThenOk = new CodexEventNormalizer();
  failThenOk.parseLine(JSON.stringify({ type: "error", message: CODEX_QUOTA_MESSAGE }));
  const afterFail = failThenOk.parseLine(
    '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}',
  );
  assert.match(afterFail[0]?.terminal?.failureReason ?? "", /conflicting terminal/);

  // Success then failure conflicts.
  const okThenFail = new CodexEventNormalizer();
  okThenFail.parseLine('{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}');
  const afterOk = okThenFail.parseLine(JSON.stringify({
    type: "error",
    message: CODEX_QUOTA_MESSAGE,
  }));
  assert.match(afterOk[0]?.terminal?.failureReason ?? "", /conflicting terminal/);

  // Identical successes still conflict (never deduplicated).
  const twoOk = new CodexEventNormalizer();
  twoOk.parseLine('{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}');
  const secondOk = twoOk.parseLine(
    '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}',
  );
  assert.match(secondOk[0]?.terminal?.failureReason ?? "", /conflicting terminal/);
});

test("Codex JSONL completion without usage succeeds with usage unavailable", () => {
  const events = new CodexEventNormalizer().parseLine('{"type":"turn.completed"}');
  assert.equal(events[0]?.type, "worker.completed");
  assert.equal(events[0]?.terminal?.isError, false);
  assert.equal(events[0]?.terminal?.usage, undefined, "missing usage is never estimated");
});

test("Codex terminal usage fails closed on disjoint counter violations", () => {
  // Cached input alone exceeding total input is malformed (double-count risk).
  assert.equal(
    codexUsage({ input_tokens: 10, cached_input_tokens: 12, output_tokens: 2 }),
    undefined,
  );
  // Cached + cache-write together exceeding total input is malformed too.
  assert.equal(
    codexUsage({
      input_tokens: 10,
      cached_input_tokens: 7,
      cache_write_input_tokens: 5,
      output_tokens: 2,
    }),
    undefined,
  );
  // Exact disjoint counters remain accepted unchanged.
  const ok = codexUsage({
    input_tokens: 10,
    cached_input_tokens: 4,
    cache_write_input_tokens: 3,
    output_tokens: 2,
  });
  assert.deepEqual(ok, {
    inputTokens: 10,
    outputTokens: 2,
    cacheReadInputTokens: 4,
    cacheCreationInputTokens: 3,
    source: "terminal-result",
    complete: true,
  });
  // The normalizer maps a counter-violating terminal to worker.failed.
  const normalizer = new CodexEventNormalizer();
  const failed = normalizer.parseLine(
    '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":12,"output_tokens":2}}',
  );
  assert.equal(failed[0]?.type, "worker.failed");
  assert.equal(failed[0]?.terminal?.isError, true);
  assert.match(failed[0]?.terminal?.failureReason ?? "", /malformed usage/);
});

test("Codex app-server token usage reads canonical camelCase totals and fails closed", () => {
  // Installed app-server `params.tokenUsage.total` uses camelCase counters.
  assert.deepEqual(codexAppServerTokenUsage({
    inputTokens: 100,
    outputTokens: 20,
    cachedInputTokens: 40,
    cacheWriteInputTokens: 3,
  }), {
    inputTokens: 100,
    outputTokens: 20,
    cacheReadInputTokens: 40,
    cacheCreationInputTokens: 3,
    source: "terminal-result",
    complete: true,
  });
  // The snake_case CLI JSONL shape is not the app-server shape.
  assert.equal(
    codexAppServerTokenUsage({ input_tokens: 100, output_tokens: 20 }),
    undefined,
    "snake_case counters are rejected by the app-server reader",
  );
  // Disjoint counter violations fail closed (double-count risk).
  assert.equal(
    codexAppServerTokenUsage({ inputTokens: 10, cachedInputTokens: 12, outputTokens: 2 }),
    undefined,
  );
  // Reasoning output is a subset of total output when present.
  assert.equal(
    codexAppServerTokenUsage({ inputTokens: 10, outputTokens: 5, reasoningOutputTokens: 6 }),
    undefined,
  );
  // A valid reasoning subset is validated but never projected into counters.
  assert.deepEqual(
    codexAppServerTokenUsage({ inputTokens: 10, outputTokens: 5, reasoningOutputTokens: 4 }),
    {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      source: "terminal-result",
      complete: true,
    },
  );
  assert.equal(codexAppServerTokenUsage({ inputTokens: 1 }), undefined, "missing output fails closed");
});

test("Codex app-server final item projection accepts only canonical final answers", () => {
  assert.deepEqual(
    projectCodexAppServerFinalItem(
      { type: "agentMessage", text: "done", phase: "final_answer" },
      true,
    ),
    { finalText: "done", explicitNonNullPhase: true },
  );
  assert.deepEqual(
    projectCodexAppServerFinalItem(
      { type: "agentMessage", text: "note", phase: "commentary" },
      true,
    ),
    { explicitNonNullPhase: true },
    "commentary is never final",
  );
  assert.deepEqual(
    projectCodexAppServerFinalItem(
      { type: "agentMessage", text: "legacy", phase: null },
      true,
    ),
    { finalText: "legacy", explicitNonNullPhase: false },
    "explicit null is legacy-only when still allowed",
  );
  assert.deepEqual(
    projectCodexAppServerFinalItem(
      { type: "agentMessage", text: "legacy", phase: null },
      false,
    ),
    { explicitNonNullPhase: false },
    "legacy null is disabled after any explicit non-null phase",
  );
  assert.deepEqual(
    projectCodexAppServerFinalItem(
      { type: "agent_message", text: "snake", phase: "final_answer" },
      true,
    ),
    { explicitNonNullPhase: false },
    "snake_case type never becomes resultText",
  );
  assert.deepEqual(
    projectCodexAppServerFinalItem(
      { type: "agentMessage", text: "missing-phase" },
      true,
    ),
    { explicitNonNullPhase: false },
    "missing phase fails closed",
  );
  assert.deepEqual(
    projectCodexAppServerFinalItem(
      { type: "agentMessage", text: "weird", phase: "thinking" },
      true,
    ),
    { explicitNonNullPhase: true },
    "unknown phase is never final and disables legacy null",
  );
  const long = "x".repeat(CODEX_APP_SERVER_RESULT_TEXT_MAX + 50);
  const capped = projectCodexAppServerFinalItem(
    { type: "agentMessage", text: long, phase: "final_answer" },
    true,
  );
  assert.equal(capped.finalText?.length, CODEX_APP_SERVER_RESULT_TEXT_MAX);
});

test("Codex app-server item progress projects command/file lifecycle without private content", () => {
  // Private-looking raw ids must never appear publicly; only a one-way token.
  const privateCmdId = "item:/Users/me/secret-cmd-id";
  const privateFileId = "item:/Users/me/secret-file-id";
  const expectedCmdToken = privacySafeToolCorrelationToken(privateCmdId);
  const expectedFileToken = privacySafeToolCorrelationToken(privateFileId);
  assert.equal(typeof expectedCmdToken, "string");
  assert.equal(expectedCmdToken?.length, 16);
  assert.notEqual(expectedCmdToken, privateCmdId);

  const commandStart = projectCodexAppServerItemProgress("item/started", {
    id: privateCmdId,
    type: "commandExecution",
    command: "rg secret /etc/passwd",
    cwd: "/private/host/path",
    status: "inProgress",
  });
  assert.equal(commandStart?.type, "worker.tool.started");
  assert.equal(commandStart?.summary, "command started");
  assert.deepEqual(commandStart?.payload, {
    tool: "commandExecution",
    toolUseId: expectedCmdToken,
    activityEvidence: "effective-progress",
  });
  assert.equal(isEffectiveProgressEvent(commandStart!.type, commandStart!.payload), true);
  assert.ok(!JSON.stringify(commandStart).includes("rg secret"));
  assert.ok(!JSON.stringify(commandStart).includes("/private/host/path"));
  assert.ok(!JSON.stringify(commandStart).includes(privateCmdId));
  assert.ok(!JSON.stringify(commandStart).includes("/Users/me/"));

  const fileDone = projectCodexAppServerItemProgress("item/completed", {
    id: privateFileId,
    type: "fileChange",
    changes: [{ path: "src/secret.ts", kind: "update" }],
    status: "completed",
  });
  assert.equal(fileDone?.type, "worker.tool.completed");
  assert.equal(fileDone?.summary, "file change completed");
  assert.deepEqual(fileDone?.payload, {
    tool: "fileChange",
    toolUseId: expectedFileToken,
    activityEvidence: "effective-progress",
  });
  assert.ok(!JSON.stringify(fileDone).includes("src/secret.ts"));
  assert.ok(!JSON.stringify(fileDone).includes(privateFileId));

  // Start/complete pairing is stable for the same raw id.
  const commandDone = projectCodexAppServerItemProgress("item/completed", {
    id: privateCmdId,
    type: "commandExecution",
  });
  assert.equal(
    (commandDone?.payload as { toolUseId?: string }).toolUseId,
    expectedCmdToken,
  );

  assert.equal(
    projectCodexAppServerItemProgress("item/started", {
      id: "item-msg",
      type: "agentMessage",
      text: "streaming",
    }),
    undefined,
    "agentMessage is not a tool progress event",
  );
  assert.equal(
    projectCodexAppServerItemProgress("item/completed", { type: "command_execution" }),
    undefined,
    "snake_case tool types fail closed",
  );
  // Missing/oversized ids still project tool lifecycle but omit correlation.
  const missingId = projectCodexAppServerItemProgress("item/started", {
    type: "commandExecution",
  });
  assert.equal(missingId?.type, "worker.tool.started");
  assert.equal(
    (missingId?.payload as { toolUseId?: string }).toolUseId,
    undefined,
    "missing item ids produce no correlation token",
  );
  const oversized = projectCodexAppServerItemProgress("item/started", {
    id: "x".repeat(200),
    type: "commandExecution",
  });
  assert.equal(oversized?.type, "worker.tool.started");
  assert.equal(
    (oversized?.payload as { toolUseId?: string }).toolUseId,
    undefined,
    "oversized item ids produce no correlation token",
  );
});

test("Codex app-server private diff digest is material-only and never a public payload", () => {
  const first = privateCodexDiffDigest("diff --git a/src/a.ts b/src/a.ts\n+secret");
  const same = privateCodexDiffDigest("diff --git a/src/a.ts b/src/a.ts\n+secret");
  const next = privateCodexDiffDigest("diff --git a/src/a.ts b/src/a.ts\n+secret\n+more");
  assert.equal(typeof first, "string");
  assert.equal(first, same, "identical private evidence is stable");
  assert.notEqual(first, next, "materially new evidence changes the digest");
  // Tail-only changes on a large body remain material (full-evidence hash).
  const prefix = "x".repeat(300_000);
  const head = privateCodexDiffDigest(prefix);
  const tailChanged = privateCodexDiffDigest(`${prefix}y`);
  assert.notEqual(head, tailChanged, "tail-only changes must alter the private digest");
  assert.equal(privateCodexDiffDigest(""), undefined);
  assert.equal(privateCodexDiffDigest(undefined), undefined);
  assert.equal(privateCodexDiffDigest(null), undefined);

  const milestone = projectCodexAppServerWorkspaceChangeMilestone();
  assert.equal(milestone.type, "worker.message");
  assert.equal(
    (milestone.payload as { activityKind?: string }).activityKind,
    "workspace-change",
  );
  assert.equal(
    (milestone.payload as { activityEvidence?: string }).activityEvidence,
    "effective-progress",
  );
  assert.equal(isEffectiveProgressEvent(milestone.type, milestone.payload), true);
  assert.ok(!JSON.stringify(milestone).includes("diff --git"));
  assert.ok(!JSON.stringify(milestone).includes("src/a.ts"));
  assert.ok(!JSON.stringify(milestone).includes(first ?? "missing"));
});

test("seedCodexHome copies only auth and safe catalog with private permissions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-codex-seed-"));
  const operator = path.join(root, "operator");
  const taskHome = path.join(root, "task-home");
  await mkdir(operator, { recursive: true });
  await writeFile(path.join(operator, "auth.json"), '{"private":"credential"}');
  await writeFile(path.join(operator, "models_cache.json"), '{"models":[]}');
  await writeFile(path.join(operator, "config.toml"), "mcp=true");
  const result = await seedCodexHome(taskHome, operator);
  assert.deepEqual(result.seeded, ["auth.json", "models_cache.json"]);
  const { readdir, stat } = await import("node:fs/promises");
  assert.deepEqual((await readdir(taskHome)).sort(), ["auth.json", "models_cache.json"]);
  assert.equal((await stat(path.join(taskHome, "auth.json"))).mode & 0o777, 0o600);
  assert.equal((await stat(path.join(taskHome, "models_cache.json"))).mode & 0o777, 0o600);
});

// --- Deterministic Codex adapter integration (fake executable, no live model) ---

async function codexRuntimeFixture(
  scriptLines: string[],
  exitCode = 0,
  networkPolicy?: unknown,
) {
  const root = await mkdtemp(path.join(tmpdir(), "fl-codex-run-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "src"), { recursive: true });
  await writeFile(path.join(source, "src", "hello.ts"), "export const n = 1;\n");
  const home = path.join(root, "state");
  const store = new StateStore(home);
  const operatorCodexHome = path.join(root, "operator-codex");
  await mkdir(operatorCodexHome, { recursive: true });
  await writeFile(path.join(operatorCodexHome, "auth.json"), '{"credentials":"placeholder"}', { mode: 0o600 });
  await writeFile(path.join(operatorCodexHome, "models_cache.json"), '{"models":[]}', { mode: 0o600 });
  const script = path.join(root, "fake-codex.cjs");
  await writeFile(script, [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    `const lines = ${JSON.stringify(scriptLines)};`,
    "for (const line of lines) fs.writeSync(1, line + '\\n');",
    "fs.writeFileSync('codex-env-dump.json', JSON.stringify({",
    "  CODEX_HOME: process.env.CODEX_HOME || null,",
    "  TMPDIR: process.env.TMPDIR || null,",
    "  TMP: process.env.TMP || null,",
    "  TEMP: process.env.TEMP || null,",
    "  argv: process.argv.slice(2),",
    "  hasOpenAIKey: Object.prototype.hasOwnProperty.call(process.env, 'OPENAI_API_KEY'),",
    "  hasOpenAIBaseUrl: Object.prototype.hasOwnProperty.call(process.env, 'OPENAI_BASE_URL'),",
    "  hasOpenAIOrgId: Object.prototype.hasOwnProperty.call(process.env, 'OPENAI_ORG_ID'),",
    "  hasOpenAIProject: Object.prototype.hasOwnProperty.call(process.env, 'OPENAI_PROJECT'),",
    "  hasCodexApiKey: Object.prototype.hasOwnProperty.call(process.env, 'CODEX_API_KEY'),",
    "  HTTP_PROXY: process.env.HTTP_PROXY || null,",
    "  http_proxy: process.env.http_proxy || null,",
    "  HTTPS_PROXY: process.env.HTTPS_PROXY || null,",
    "  https_proxy: process.env.https_proxy || null,",
    "  ALL_PROXY: process.env.ALL_PROXY || null,",
    "  all_proxy: process.env.all_proxy || null,",
    "  NO_PROXY: process.env.NO_PROXY || null,",
    "  no_proxy: process.env.no_proxy || null,",
    "  cwd: process.cwd()",
    "}));",
    `process.exit(${exitCode});`,
  ].join("\n"), { mode: 0o755 });

  const { taskPaths } = await import("../src/core/config.js");
  const id = "99999999-9999-4999-8999-999999999999";
  const paths = taskPaths(home, id);
  await mkdir(paths.workspace, { recursive: true });
  await mkdir(paths.baseline, { recursive: true });

  const spec = parseTaskSpec(
    minimalContract({
      project: source,
      provider: { name: "openai", model: "gpt-5.6-luna", keychainService: "forklight.openai.api-key" },
      runtime: { name: "codex-cli", executable: script, effort: "max", maxBudgetUsd: null },
      ...(networkPolicy === undefined ? {} : { networkPolicy }),
    }),
    source,
    policy(),
  ) as TaskSpec;
  const task: TaskRecord = {
    id,
    name: spec.name,
    status: "running",
    sourcePath: source,
    taskFile: path.join(home, "task.yaml"),
    spec,
    paths,
    sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
  store.createTask(task);
  const attempt: AttemptRecord = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    taskId: id,
    ordinal: 1,
    status: "running",
    sessionId: task.sessionId,
    rawLogPath: path.join(paths.logs, "attempt-1.jsonl"),
    startedAt: "2026-08-01T00:00:00.000Z",
    runtimeBudgetUsd: null,
    runtimeBudgetEnforcement: "unsupported",
  };
  store.createAttempt(attempt);
  return { store, task, attempt, operatorCodexHome, workspace: paths.workspace };
}

test("runCodexWorker launches a fake Codex, normalizes success with exact usage, and isolates the env", async () => {
  const fixture = await codexRuntimeFixture([
    '{"type":"thread.started","thread_id":"thread-1"}',
    '{"type":"turn.started"}',
    '{"type":"item.started","item":{"id":"i1","type":"command_execution","command":"npm test"}}',
    '{"type":"item.completed","item":{"id":"i2","type":"agent_message","text":"Implemented the change"}}',
    '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":40,"cache_write_input_tokens":3,"output_tokens":20,"reasoning_output_tokens":7}}',
  ]);
  // Parent holds redirect/tenant vars so absence in the child proves stripping,
  // not an empty parent. Values are never asserted — only presence booleans.
  const parentEnvKeys = [
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_ORG_ID",
    "OPENAI_PROJECT",
    "CODEX_API_KEY",
  ] as const;
  const previousEnv: Partial<Record<(typeof parentEnvKeys)[number], string | undefined>> = {};
  for (const key of parentEnvKeys) {
    previousEnv[key] = process.env[key];
    process.env[key] = `parent-placeholder-${key}`;
  }
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "succeeded");
    assert.equal(result.exitCode, 0);
    assert.equal(result.resultText, "Implemented the change");
    assert.deepEqual(result.usage, {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadInputTokens: 40,
      cacheCreationInputTokens: 3,
      source: "terminal-result",
      complete: true,
    });

    const events = fixture.store.listEvents(fixture.task.id);
    assert.ok(events.some((e) => e.type === "worker.completed"), "worker.completed event persisted");
    const sessionStarted = events.find(
      (e) => (e.payload as { activityKind?: string } | undefined)?.activityKind === "session-started",
    );
    assert.equal(
      (sessionStarted?.payload as { runtimeSessionId?: string } | undefined)?.runtimeSessionId,
      "thread-1",
      "session identity is attached to lifecycle events",
    );

    const envDump = JSON.parse(
      await readFile(path.join(fixture.workspace, "codex-env-dump.json"), "utf8"),
    ) as {
      CODEX_HOME: string | null;
      TMPDIR: string | null;
      TMP: string | null;
      TEMP: string | null;
      argv: string[];
      hasOpenAIKey: boolean;
      hasOpenAIBaseUrl: boolean;
      hasOpenAIOrgId: boolean;
      hasOpenAIProject: boolean;
      hasCodexApiKey: boolean;
      cwd: string;
    };
    assert.equal(envDump.CODEX_HOME, path.join(fixture.task.paths.root, "codex-home"));
    const taskTmp = path.join(fixture.task.paths.root, "codex-tmp");
    assert.equal(envDump.TMPDIR, taskTmp, "task-private TMPDIR is preserved");
    assert.equal(envDump.TMP, taskTmp);
    assert.equal(envDump.TEMP, taskTmp);
    assert.equal(envDump.hasOpenAIKey, false, "OPENAI_API_KEY must not reach the child env");
    assert.equal(envDump.hasOpenAIBaseUrl, false, "OPENAI_BASE_URL must not reach the child env");
    assert.equal(envDump.hasOpenAIOrgId, false, "OPENAI_ORG_ID must not reach the child env");
    assert.equal(envDump.hasOpenAIProject, false, "OPENAI_PROJECT must not reach the child env");
    assert.equal(envDump.hasCodexApiKey, false, "CODEX_API_KEY must not reach the child env");
    // macOS resolves /var to /private/var in the child; compare real paths.
    assert.equal(
      envDump.cwd,
      await realpath(fixture.workspace),
      "Codex runs inside the isolated Task workspace",
    );
    // Real single-run launch argv must enforce network off + slash-tmp exclude.
    assert.ok(Array.isArray(envDump.argv) && envDump.argv.length > 0);
    assert.equal(envDump.argv[envDump.argv.indexOf("--sandbox") + 1], "workspace-write");
    assert.ok(envDump.argv.includes("sandbox_workspace_write.network_access=false"));
    assert.ok(envDump.argv.includes("sandbox_workspace_write.exclude_slash_tmp=true"));
    assert.ok(!envDump.argv.some((arg) => arg.includes("exclude_tmpdir_env_var=true")));
    assert.ok(envDump.argv.includes('approval_policy="never"'));
    assert.ok(!envDump.argv.includes("danger-full-access"));
    assert.ok(!envDump.argv.includes("--add-dir"));

    // Prove runCodexWorker wired the Runtime-aware prompt into the real artifact.
    const promptArtifact = await readFile(
      path.join(fixture.task.paths.logs, "attempt-1.prompt.txt"),
      "utf8",
    );
    assertCodexEditablePromptContract(promptArtifact);
    assert.match(promptArtifact, /Worker validation self-check/);
    assert.match(promptArtifact, /acceptance-1: true/);
    assert.doesNotMatch(
      promptArtifact,
      /Do not integrate source, commit, push, run acceptance commands yourself/,
    );
    assertCodexForbiddenAuthorityAbsent(promptArtifact, envDump.argv);
  } finally {
    for (const key of parentEnvKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    fixture.store.close();
  }
});

test("runCodexWorker fails closed on malformed JSONL and never invents success", async () => {
  const fixture = await codexRuntimeFixture([
    '{"type":"thread.started","thread_id":"thread-1"}',
    "not-json",
  ]);
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.failureCategory, "runtime");
    assert.match(result.error ?? "", /malformed JSONL/);
    assert.equal(result.usage, undefined);
    const failed = fixture.store.listEvents(fixture.task.id).find((e) => e.type === "worker.failed");
    assert.ok(failed, "worker.failed event persisted for malformed stream");
  } finally {
    fixture.store.close();
  }
});

test("runCodexWorker preserves budget class for measured quota error+turn.failed pair", async () => {
  // Complete fake-process path: normalizer budget must survive child exit summary.
  const fixture = await codexRuntimeFixture([
    '{"type":"thread.started","thread_id":"thread-quota"}',
    '{"type":"turn.started"}',
    JSON.stringify({ type: "error", message: CODEX_QUOTA_MESSAGE }),
    JSON.stringify({ type: "turn.failed", error: { message: CODEX_QUOTA_MESSAGE } }),
  ], 1);
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.failureCategory, "budget",
      "child exit must not broaden account-quota budget to runtime");
    assert.equal(result.error, CODEX_ACCOUNT_USAGE_LIMIT_SUMMARY);
    assert.equal(result.usage, undefined, "quota path never invents Tokens");
    assert.equal(result.runtimeCostEstimateUsd, undefined, "quota path never invents cost");

    const failedEvents = fixture.store.listEvents(fixture.task.id)
      .filter((e) => e.type === "worker.failed");
    assert.equal(failedEvents.length, 1, "exactly one durable failure event for the quota pair");
    assert.equal(
      (failedEvents[0]?.payload as { failureCategory?: string } | undefined)?.failureCategory,
      "budget",
    );
    assert.equal(
      (failedEvents[0]?.payload as { reasonCode?: string } | undefined)?.reasonCode,
      CODEX_ACCOUNT_USAGE_LIMIT_REASON,
    );
    assert.equal(failedEvents[0]?.summary, CODEX_ACCOUNT_USAGE_LIMIT_SUMMARY);
    assert.ok(
      !failedEvents.some((e) => /conflicting terminal/i.test(e.summary)),
      "no terminal-conflict event for identical quota pair",
    );
    assert.equal(
      failureCategoryFromEvents(fixture.store.listEvents(fixture.task.id)),
      "budget",
    );
  } finally {
    fixture.store.close();
  }
});

/**
 * Full executeAttempt path for measured Codex quota: adapter persists the
 * terminal, runner must not append a second identical worker.failed.
 * Placed after advanced-policy imports via shared helpers defined later;
 * the test body runs only when the suite reaches this registration order,
 * and imports are module-hoisted.
 */
test("executeAttempt keeps exactly one Codex quota worker.failed with budget reasonCode", async () => {
  const {
    enforcementCapabilityForRuntime: runtimeCaps,
    defaultAdvancedPolicyFields,
  } = await import("../src/core/advanced-policy.js");
  const root = await mkdtemp(path.join(tmpdir(), "fl-codex-quota-e2e-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "src"), { recursive: true });
  await writeFile(path.join(source, "src", "hello.ts"), "export const n = 1;\n");
  const home = path.join(root, "state");
  const store = new StateStore(home);
  const operatorCodexHome = path.join(root, "operator-codex");
  await mkdir(operatorCodexHome, { recursive: true });
  await writeFile(path.join(operatorCodexHome, "auth.json"), '{"credentials":"placeholder"}', { mode: 0o600 });
  await writeFile(path.join(operatorCodexHome, "models_cache.json"), '{"models":[]}', { mode: 0o600 });
  const script = path.join(root, "fake-codex.cjs");
  await writeFile(script, [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    `const lines = ${JSON.stringify([
      '{"type":"thread.started","thread_id":"thread-quota-e2e"}',
      '{"type":"turn.started"}',
      JSON.stringify({ type: "error", message: CODEX_QUOTA_MESSAGE }),
      JSON.stringify({ type: "turn.failed", error: { message: CODEX_QUOTA_MESSAGE } }),
    ])};`,
    "for (const line of lines) fs.writeSync(1, line + '\\n');",
    "process.exit(1);",
  ].join("\n"), { mode: 0o755 });

  const { taskPaths } = await import("../src/core/config.js");
  const { prepareWorkspace } = await import("../src/workspace/copy.js");
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const paths = taskPaths(home, id);
  const spec = parseTaskSpec(
    minimalContract({
      project: source,
      provider: { name: "openai", model: "gpt-5.6-luna", keychainService: "forklight.openai.api-key" },
      runtime: { name: "codex-cli", executable: script, effort: "max", maxBudgetUsd: null },
      acceptance: { criteria: ["c1"], commands: ["true"] },
    }),
    source,
    { ...policy(), completionPolicy: { noChangeMode: "off", changeBudgetMode: "off" } },
  ) as TaskSpec;
  await prepareWorkspace(spec, paths);

  resetWorkerRegistryForTests();
  getWorkerAdapter("codex-cli");
  const capabilities = getWorkerAdapter("codex-cli").capabilities();
  registerWorkerAdapter({
    name: "codex-cli",
    displayName: "Codex CLI (quota e2e)",
    defaultExecutable: script,
    capabilities: () => capabilities,
    doctor: () => ({
      runtime: "codex-cli",
      ok: true,
      executable: script,
      issues: [],
      capabilities,
    }),
    validateSpec: () => {},
    effortArgs: () => [],
    toolProtocolAppendix: () => [],
    checkpointProtocolAppendix: () => [],
    run: (ctx) => runCodexWorker(ctx, operatorCodexHome),
  });

  const values = {
    ...defaultAdvancedPolicyFields(),
    baseMaxAttempts: 1,
    noProgressTimeoutMs: null,
    completionMode: "off" as const,
    changeBudgetMode: "off" as const,
  };
  const provenance = Object.fromEntries(
    Object.keys(values).map((field) => [field, "task"]),
  ) as Record<keyof typeof values, "task">;
  store.createTask({
    id,
    name: spec.name,
    status: "queued",
    sourcePath: source,
    taskFile: path.join(home, "task.yaml"),
    spec,
    paths,
    sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
    effectivePolicy: {
      profileId: "codex-quota-e2e",
      values,
      provenance,
      enforcementCapability: runtimeCaps("codex-cli"),
    },
  });

  try {
    const result = await executeAttempt(store, store.getTask(id), false);
    assert.equal(result.task.status, "failed");
    assert.equal(result.task.error, CODEX_ACCOUNT_USAGE_LIMIT_SUMMARY);
    assert.equal(result.attempt.error, CODEX_ACCOUNT_USAGE_LIMIT_SUMMARY);

    const failed = store.listEvents(id).filter(
      (e) => e.type === "worker.failed" && e.attemptId === result.attempt.id,
    );
    assert.equal(failed.length, 1, "runner must not append a second identical quota terminal");
    assert.equal(failed[0]!.summary, CODEX_ACCOUNT_USAGE_LIMIT_SUMMARY);
    assert.equal(
      (failed[0]!.payload as { failureCategory?: string } | undefined)?.failureCategory,
      "budget",
    );
    assert.equal(
      (failed[0]!.payload as { reasonCode?: string } | undefined)?.reasonCode,
      CODEX_ACCOUNT_USAGE_LIMIT_REASON,
      "earlier normalized reasonCode must be retained",
    );
    assert.equal(failureCategoryFromEvents(store.listEvents(id)), "budget");
    assert.ok(
      !failed.some((e) => /conflicting terminal/i.test(e.summary)),
      "no terminal-conflict event on the full executeAttempt path",
    );
  } finally {
    store.close();
    resetWorkerRegistryForTests();
  }
});

test("executeAttempt still appends nonmatching worker.failed after adapter terminal", async () => {
  // Different summary or category must not be suppressed by the exact-duplicate guard.
  resetWorkerRegistryForTests();
  getWorkerAdapter("claude-code");
  const capabilities = getWorkerAdapter("claude-code").capabilities();

  registerWorkerAdapter({
    name: "claude-code",
    displayName: "Nonmatching failure Worker",
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
    run: async (ctx) => {
      // Adapter already recorded a budget terminal for this Attempt.
      ctx.store.addEvent(
        ctx.task.id,
        ctx.attempt.id,
        "worker.failed",
        "adapter budget terminal",
        { failureCategory: "budget", reasonCode: "adapter-budget" },
      );
      // Runner result differs in both summary and category — must still append.
      return {
        status: "failed",
        exitCode: 1,
        error: "runner runtime terminal",
        failureCategory: "runtime",
      };
    },
  });

  const { store, task } = await policyRunnerFixture({
    completionMode: "off",
    changeBudgetMode: "off",
  });
  try {
    const result = await executeAttempt(store, task, false);
    assert.equal(result.task.status, "failed");
    const failed = store.listEvents(task.id).filter(
      (e) => e.type === "worker.failed" && e.attemptId === result.attempt.id,
    );
    assert.equal(failed.length, 2, "nonmatching failure must still append");
    assert.equal(failed[0]!.summary, "adapter budget terminal");
    assert.equal(
      (failed[0]!.payload as { failureCategory?: string } | undefined)?.failureCategory,
      "budget",
    );
    assert.equal(failed[1]!.summary, "runner runtime terminal");
    assert.equal(
      (failed[1]!.payload as { failureCategory?: string } | undefined)?.failureCategory,
      "runtime",
    );
  } finally {
    store.close();
    resetWorkerRegistryForTests();
  }
});

test("executeAttempt does not suppress same-summary failure when category differs", async () => {
  resetWorkerRegistryForTests();
  getWorkerAdapter("claude-code");
  const capabilities = getWorkerAdapter("claude-code").capabilities();
  const sharedSummary = "shared failure summary";

  registerWorkerAdapter({
    name: "claude-code",
    displayName: "Category mismatch Worker",
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
    run: async (ctx) => {
      ctx.store.addEvent(
        ctx.task.id,
        ctx.attempt.id,
        "worker.failed",
        sharedSummary,
        { failureCategory: "budget" },
      );
      return {
        status: "failed",
        exitCode: 1,
        error: sharedSummary,
        failureCategory: "runtime",
      };
    },
  });

  const { store, task } = await policyRunnerFixture({
    completionMode: "off",
    changeBudgetMode: "off",
  });
  try {
    const result = await executeAttempt(store, task, false);
    const failed = store.listEvents(task.id).filter(
      (e) => e.type === "worker.failed" && e.attemptId === result.attempt.id,
    );
    assert.equal(failed.length, 2, "same summary with different category still appends");
    assert.equal(
      (failed[0]!.payload as { failureCategory?: string } | undefined)?.failureCategory,
      "budget",
    );
    assert.equal(
      (failed[1]!.payload as { failureCategory?: string } | undefined)?.failureCategory,
      "runtime",
    );
  } finally {
    store.close();
    resetWorkerRegistryForTests();
  }
});

test("runCodexWorker reports interruption without inventing result or Tokens", async () => {
  const fixture = await codexRuntimeFixture([
    '{"type":"thread.started","thread_id":"thread-1"}',
    '{"type":"turn.started"}',
  ]);
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: { wasInterrupted: () => true },
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "interrupted");
    assert.equal(result.usage, undefined, "no usage invented on interruption");
    assert.equal(result.resultText, undefined, "no result invented on interruption");
  } finally {
    fixture.store.close();
  }
});

test("runCodexWorker fails closed when Codex changes session identity", async () => {
  // Drift then nonterminal progress and a success terminal: only the first
  // drift failure may reach store/hooks as public runtime evidence.
  const fixture = await codexRuntimeFixture([
    '{"type":"thread.started","thread_id":"thread-1"}',
    '{"type":"thread.started","thread_id":"thread-2"}',
    '{"type":"item.started","item":{"id":"i1","type":"command_execution","command":"npm test"}}',
    '{"type":"item.completed","item":{"id":"i2","type":"agent_message","text":"post-drift message"}}',
    '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}',
  ]);
  try {
    const forwarded: string[] = [];
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {
        onEvent: (event) => {
          forwarded.push(event.type);
        },
      },
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.failureCategory, "runtime");
    assert.match(result.error ?? "", /changed session identity/);
    const events = fixture.store.listEvents(fixture.task.id);
    const driftFailures = events.filter(
      (e) => (e.payload as { reasonCode?: string } | undefined)?.reasonCode === "codex-session-drift",
    );
    assert.equal(driftFailures.length, 1, "exactly one session-drift worker.failed is retained");
    const driftIndex = events.findIndex(
      (e) => (e.payload as { reasonCode?: string } | undefined)?.reasonCode === "codex-session-drift",
    );
    assert.ok(driftIndex >= 0, "session-drift worker.failed event persisted");
    assert.deepEqual(
      events.slice(driftIndex + 1).map((e) => e.type),
      [],
      "no later runtime event is persisted after session-identity drift",
    );
    assert.ok(
      !events.some((e) => e.type === "worker.completed"),
      "a drifted success terminal must not be persisted as terminal evidence",
    );
    assert.ok(
      !events.some((e) => e.type === "worker.tool.started"),
      "post-drift nonterminal tool progress must not reach the store",
    );
    const driftForwardIndex = forwarded.indexOf("worker.failed");
    assert.ok(driftForwardIndex >= 0, "drift failure is forwarded once");
    assert.equal(
      forwarded.filter((type) => type === "worker.failed").length,
      1,
      "exactly one drift failure is forwarded",
    );
    assert.deepEqual(
      forwarded.slice(driftForwardIndex + 1),
      [],
      "no later event is forwarded after session-identity drift",
    );
  } finally {
    fixture.store.close();
  }
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
  // Ordinary Tasks still receive the generic coding-summary instruction.
  assert.ok(prompt.includes(GENERIC_CODING_SUMMARY_INSTRUCTION));
  const defaultCc = buildWorkerPrompt(
    parseTaskSpec(minimalContract(), "/tmp", policy()),
    false,
  );
  assert.ok(defaultCc.includes("mcp__forklight_checkpoint__run"));
  assert.ok(claudeToolProtocolLines(["src"]).some((line) => line.includes("Glob") || line.includes("focus")));
});

test("Review Graph reviewer Tasks replace generic coding summary with strict JSON instructions", () => {
  const spec = parseTaskSpec(minimalContract(), "/tmp", policy());
  const ordinary = workerPromptAppendicesForTask(
    { taskFile: "/tmp/task.yaml" },
    { toolLines: ["read files"] },
  );
  assert.equal(ordinary.terminalOutputLines, undefined);
  assert.equal(isReviewGraphReviewerTaskFile("/tmp/task.yaml"), false);

  const reviewerTaskFile =
    "forklight://review-graph/adb2e3cf-8d7a-4d79-83a7-46f71397b027/assignment/a1";
  assert.equal(isReviewGraphReviewerTaskFile(reviewerTaskFile), true);
  // Do not infer from allowEdits=false alone.
  assert.equal(isReviewGraphReviewerTaskFile("forklight://test/readonly"), false);

  const reviewerAppendices = workerPromptAppendicesForTask(
    { taskFile: reviewerTaskFile },
    {
      toolLines: ["read files"],
      checkpointLines: ["", "Checkpoint: skipped"],
    },
  );
  assert.deepEqual(reviewerAppendices.terminalOutputLines, reviewerTerminalOutputLines());

  const reviewerPrompt = buildWorkerPrompt(spec, false, undefined, reviewerAppendices);
  assert.ok(reviewerPrompt.includes("Return exactly one raw JSON object"));
  assert.ok(!reviewerPrompt.includes(GENERIC_CODING_SUMMARY_INSTRUCTION));
  assert.ok(!reviewerPrompt.includes("files changed, contract behavior delivered"));

  // Grok-shaped appendix path (same override helper used by the adapter).
  const grok = new GrokBuildAdapter();
  const grokTask = {
    spec,
    taskFile: reviewerTaskFile,
  } as TaskRecord;
  const grokReviewerPrompt = buildWorkerPrompt(
    spec,
    false,
    undefined,
    workerPromptAppendicesForTask(grokTask, {
      toolLines: grok.toolProtocolAppendix(grokTask),
      checkpointLines: grok.checkpointProtocolAppendix(grokTask),
    }),
  );
  assert.ok(grokReviewerPrompt.includes("Return exactly one raw JSON object"));
  assert.ok(!grokReviewerPrompt.includes(GENERIC_CODING_SUMMARY_INSTRUCTION));
});

test("GrokEventNormalizer maps stream lines", () => {
  const n = new GrokEventNormalizer();
  const completed = n.parseLine(JSON.stringify({ type: "result", result: "done" }));
  assert.equal(completed[0]?.type, "worker.completed");
  assert.equal(completed[0]?.terminal?.resultText, "done");
  const endOk = n.parseLine(JSON.stringify({
    type: "end",
    stopReason: "EndTurn",
    total_cost_usd: 0.01,
    num_turns: 2,
  }));
  assert.equal(endOk[0]?.type, "worker.completed");
  assert.equal(endOk[0]?.terminal?.costUsd, 0.01);
  // Normal EndTurn alone is not useful result content (live dogfood regression).
  assert.equal(endOk[0]?.terminal?.resultText, undefined);
  assert.equal(isMeaningfulGrokResultText("EndTurn"), false);
  const thought = n.parseLine(JSON.stringify({ type: "thought", data: "hmm" }));
  assert.equal(thought[0]?.type, "worker.message");
  assert.equal(
    (thought[0]?.payload as { activityKind?: string } | undefined)?.activityKind,
    "model-processing",
    "Grok thought emits structured processing activity for live-stage",
  );
  const text = n.parseLine(JSON.stringify({ type: "text", data: "hello" }));
  assert.equal(
    (text[0]?.payload as { activityKind?: string } | undefined)?.activityKind,
    "model-response",
  );
  const failed = n.parseLine(JSON.stringify({ type: "error", message: "auth" }));
  assert.equal(failed[0]?.type, "worker.failed");
  const cancelled = n.parseLine(JSON.stringify({ type: "end", stopReason: "Cancelled" }));
  assert.equal(cancelled[0]?.type, "worker.failed");
  assert.equal(cancelled[0]?.terminal?.resultText, "Cancelled");
  const tool = n.parseLine(JSON.stringify({ type: "tool_start", tool: "read_file" }));
  assert.equal(tool[0]?.type, "worker.tool.started");
});

test("Grok text-delta assembly reconstructs EndTurn results and keeps explicit precedence", () => {
  // Live dogfood: ordered text deltas form valid JSON; terminal is only EndTurn.
  const chunks = [
    '{"schemaVersion":1,',
    '"reviewedRevisionId":"rev-1",',
    '"proposedDisposition":"revise",',
    '"summary":"ok",',
    '"findings":[]}',
  ];
  let assembly = createGrokTextAssembly();
  for (const chunk of chunks) {
    const line = JSON.stringify({ type: "text", data: chunk });
    const delta = extractGrokTextDeltaFromLine(line);
    assert.equal(delta, chunk);
    assembly = appendGrokTextDelta(assembly, delta!);
  }
  const endEvent = new GrokEventNormalizer().parseLine(JSON.stringify({
    type: "end",
    stopReason: "EndTurn",
  }));
  assert.equal(endEvent[0]?.terminal?.resultText, undefined);
  const reconstructed = resolveGrokTerminalResultText({
    explicitResultText: endEvent[0]?.terminal?.resultText,
    assembly,
    isError: false,
  });
  assert.equal(reconstructed, chunks.join(""));
  assert.ok(reconstructed?.includes('"proposedDisposition":"revise"'));
  assert.notEqual(reconstructed, "EndTurn");

  // Explicit meaningful terminal content remains authoritative over deltas.
  const withExplicit = resolveGrokTerminalResultText({
    explicitResultText: "AUTHORITATIVE_RESULT",
    assembly,
    isError: false,
  });
  assert.equal(withExplicit, "AUTHORITATIVE_RESULT");

  // Overflow fails closed: no arbitrary suffix retained as a complete result.
  let overflowed = createGrokTextAssembly();
  overflowed = appendGrokTextDelta(overflowed, "x".repeat(GROK_ASSEMBLED_TEXT_MAX));
  overflowed = appendGrokTextDelta(overflowed, "y");
  assert.equal(overflowed.overflow, true);
  assert.equal(overflowed.text, "");
  const overflowResult = resolveGrokTerminalResultText({
    explicitResultText: undefined,
    assembly: overflowed,
    isError: false,
  });
  assert.equal(overflowResult, undefined);
  // Explicit content still wins even if deltas overflowed.
  assert.equal(
    resolveGrokTerminalResultText({
      explicitResultText: "still-wins",
      assembly: overflowed,
      isError: false,
    }),
    "still-wins",
  );
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

test("Grok first launch and resume use one Task session id", () => {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const first = grokSessionArgs(sessionId, false);
  const resume = grokSessionArgs(sessionId, true);
  assert.deepEqual(first, ["--session-id", sessionId]);
  assert.deepEqual(resume, ["--resume", sessionId]);
  const firstArgs = buildGrokCliArgs({
    prompt: "do work",
    workspace: "/ws",
    model: "grok-4.6",
    allowEdits: true,
    grokHome: "/task/grok-home",
    effort: "xhigh",
    sessionId,
    resuming: false,
  });
  const resumeArgs = buildGrokCliArgs({
    prompt: "do work",
    workspace: "/ws",
    model: "grok-4.6",
    allowEdits: true,
    grokHome: "/task/grok-home",
    effort: "xhigh",
    sessionId,
    resuming: true,
  });
  assert.equal(firstArgs[firstArgs.indexOf("-m") + 1], "grok-4.6");
  assert.equal(firstArgs[firstArgs.indexOf("--effort") + 1], "xhigh");
  assert.deepEqual(firstArgs.slice(-2), ["--session-id", sessionId]);
  assert.deepEqual(resumeArgs.slice(-2), ["--resume", sessionId]);
  assert.ok(!resumeArgs.includes("--session-id"));
  const started = grokLaunchEvidence({
    sessionId,
    resuming: false,
    executionMode: "persistent-session",
  });
  const resumed = grokLaunchEvidence({
    sessionId,
    resuming: true,
    executionMode: "persistent-session",
  });
  assert.deepEqual(started, {
    eventType: "worker.started",
    sessionArg: "--session-id",
    sessionId,
    executionMode: "persistent-session",
    nativeGoal: "unsupported",
  });
  assert.deepEqual(resumed, {
    eventType: "worker.resumed",
    sessionArg: "--resume",
    sessionId,
    executionMode: "persistent-session",
    nativeGoal: "unsupported",
  });
  assert.equal(JSON.stringify(started).includes("native-goal"), false);
  assert.equal(JSON.stringify(resumed).includes("native-goal"), false);
});

test("inspect projects frozen Grok native-goal for new auto work", () => {
  const spec = parseTaskSpec(
    {
      version: 2,
      name: "Inspect Grok",
      project: "/tmp",
      workerProfileId: "grok-4-6-xhigh",
      contract: {
        outcome: "A reasonable outcome description",
        context: ["c"], inScope: ["i"], outOfScope: ["o"],
        executionSteps: ["s"], deliverables: ["d"],
        modules: [{
          name: "m", responsibility: "long enough responsibility",
          consumes: ["c"], produces: ["p"], boundaries: ["b"],
        }],
        callChain: ["a", "b"],
        scenarios: [
          { name: "normal", given: "g", when: "w", then: "t" },
          { name: "edge", given: "g", when: "w", then: "t" },
        ],
        risks: ["r"],
        changeBudget: { maxFiles: 4, maxDiffLines: 300 },
      },
      worker: { focusPaths: ["src"] },
      acceptance: { criteria: ["c"], commands: ["true"] },
    },
    "/tmp",
    {
      contractQuality: cloneDefaults().contractQuality,
      execution: cloneDefaults().execution,
      providerDefaults: cloneDefaults().providerDefaults,
      completionPolicy: cloneDefaults().completionPolicy,
      workerProfiles: cloneDefaults().workerProfiles,
      modelCatalog: cloneDefaults().modelCatalog,
    },
  );
  const inspection = buildCompactInspection({
    task: {
      id: "inspect-grok",
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
      sessionId: "11111111-1111-4111-8111-111111111111",
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z",
    },
    attempts: [],
    events: [],
    diff: undefined,
    eventLimit: 0,
  });
  assert.equal(inspection.task.executionPreference, "auto");
  assert.equal(inspection.task.executionMode, "native-goal");
  const human = humanCompactInspectionLines(inspection);
  assert.match(human, /execution: requested=auto resolved=native-goal/);
});

test("inspect keeps a historically frozen Grok persistent-session Task unchanged", () => {
  const spec = parseTaskSpec(
    {
      version: 2,
      name: "Inspect historical Grok",
      project: "/tmp",
      workerProfileId: "grok-4-6-xhigh",
      executionPreference: "persistent-session",
      contract: {
        outcome: "A reasonable outcome description",
        context: ["c"], inScope: ["i"], outOfScope: ["o"],
        executionSteps: ["s"], deliverables: ["d"],
        modules: [{
          name: "m", responsibility: "long enough responsibility",
          consumes: ["c"], produces: ["p"], boundaries: ["b"],
        }],
        callChain: ["a", "b"],
        scenarios: [
          { name: "normal", given: "g", when: "w", then: "t" },
          { name: "edge", given: "g", when: "w", then: "t" },
        ],
        risks: ["r"],
        changeBudget: { maxFiles: 4, maxDiffLines: 300 },
      },
      worker: { focusPaths: ["src"] },
      acceptance: { criteria: ["c"], commands: ["true"] },
    },
    "/tmp",
    {
      contractQuality: cloneDefaults().contractQuality,
      execution: cloneDefaults().execution,
      providerDefaults: cloneDefaults().providerDefaults,
      completionPolicy: cloneDefaults().completionPolicy,
      workerProfiles: cloneDefaults().workerProfiles,
      modelCatalog: cloneDefaults().modelCatalog,
    },
  );
  const historical = {
    ...spec,
    executionPreference: "auto" as const,
    executionMode: "persistent-session" as const,
  };
  const inspection = buildCompactInspection({
    task: {
      id: "inspect-historical-grok",
      name: historical.name,
      status: "running",
      sourcePath: "/tmp/project",
      taskFile: "/tmp/task.yaml",
      spec: historical,
      paths: {
        root: "/tmp/run",
        baseline: "/tmp/run/baseline",
        workspace: "/tmp/run/workspace",
        logs: "/tmp/run/logs",
        claudeConfig: "/tmp/run/claude",
        diff: "/tmp/run/result.diff",
      },
      sessionId: "11111111-1111-4111-8111-111111111111",
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z",
    },
    attempts: [],
    events: [],
    diff: undefined,
    eventLimit: 0,
  });
  assert.equal(inspection.task.executionPreference, "auto");
  assert.equal(inspection.task.executionMode, "persistent-session");
  const human = humanCompactInspectionLines(inspection);
  assert.match(human, /execution: requested=auto resolved=persistent-session/);
});

const GROK_NATIVE_SESSION = "11111111-1111-4111-8111-111111111111";
const GROK_NATIVE_WORKSPACE = "/task/workspace";
const GROK_NATIVE_CONTRACT = "Complete the Worker contract exactly as written.";
const GROK_NATIVE_PLAN_TOOLS = [
  "read_file",
  "list_dir",
  "grep",
  "Agent",
  "run_terminal_cmd",
  "get_task_output",
  "kill_task",
  "wait_tasks",
  "search_replace",
  "write",
] as const;

function assertExactDenyPair(args: readonly string[], rule: string): void {
  let count = 0;
  for (let i = 0; i < args.length - 1; i += 1) {
    if (args[i] === "--deny" && args[i + 1] === rule) count += 1;
  }
  assert.equal(count, 1, `expected exactly one adjacent --deny ${rule} pair`);
}

function assertNativePlanToolsOnce(tools: string): void {
  const items = tools.split(",");
  for (const name of GROK_NATIVE_PLAN_TOOLS) {
    assert.equal(items.filter((item) => item === name).length, 1, `${name} exactly once`);
  }
}

async function writeGrokNativeState(input: {
  grokHome: string;
  workspace?: string;
  sessionId?: string;
  state: Record<string, unknown>;
  details?: { relativeName?: string; body?: string; absolutePath?: string };
}): Promise<{ statePath: string; detailsPath?: string }> {
  const workspace = input.workspace ?? GROK_NATIVE_WORKSPACE;
  const sessionId = input.sessionId ?? GROK_NATIVE_SESSION;
  const statePath = grokNativeGoalStatePath(input.grokHome, workspace, sessionId);
  await mkdir(path.dirname(statePath), { recursive: true });
  let detailsPath: string | undefined;
  const state = { ...input.state };
  if (input.details !== undefined) {
    detailsPath = input.details.absolutePath
      ?? path.join(path.dirname(statePath), input.details.relativeName ?? "goal-classifier-owned-1.md");
    await mkdir(path.dirname(detailsPath), { recursive: true });
    await writeFile(detailsPath, input.details.body ?? "owned classifier details", { mode: 0o600 });
    state.last_classifier_details_path = detailsPath;
  }
  await writeFile(statePath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  return detailsPath === undefined ? { statePath } : { statePath, detailsPath };
}

function achievedNativeState(goalId = "goal-complete-1"): Record<string, unknown> {
  return {
    goal_id: goalId,
    objective: GROK_NATIVE_CONTRACT,
    status: "complete",
    phase: "Idle",
    total_worker_rounds: 1,
    classifier_runs_attempted: 1,
    last_classifier_verdict: "achieved",
    tokens_used_high_water: 12,
    parent_tokens_spent: 3,
    last_session_tokens_seen: 8,
    token_baseline: 2,
    first_final_response: "SECRET completion prose that must not leak",
  };
}

test("Grok native-goal first launch uses /goal, same Session, frozen model, and bounded tools", () => {
  const grokHome = "/task/grok-home";
  const args = buildGrokCliArgs({
    prompt: `${GROK_NATIVE_GOAL_PROMPT_PREFIX}${GROK_NATIVE_CONTRACT}`,
    workspace: GROK_NATIVE_WORKSPACE,
    model: "grok-4.6",
    allowEdits: true,
    grokHome,
    effort: "xhigh",
    sessionId: GROK_NATIVE_SESSION,
    resuming: false,
    executionMode: "native-goal",
  });
  assert.equal(args[0], "-p");
  assert.ok(args[1]!.startsWith(GROK_NATIVE_GOAL_PROMPT_PREFIX));
  assert.ok(args[1]!.includes(GROK_NATIVE_CONTRACT));
  assert.equal(args[args.indexOf("-m") + 1], "grok-4.6");
  assert.equal(args[args.indexOf("--effort") + 1], "xhigh");
  assert.deepEqual(args.slice(-2), ["--session-id", GROK_NATIVE_SESSION]);
  assert.equal(args.includes("--budget"), false);
  assert.ok(!args.some((arg) => arg.startsWith("--budget")));
  const tools = args[args.indexOf("--tools") + 1] ?? "";
  assert.equal(tools, grokNativeAllowTools(true));
  for (const name of ["Agent", "run_terminal_cmd", "get_task_output", "kill_task", "wait_tasks"]) {
    assert.ok(tools.split(",").includes(name), `${name} must stay registered`);
  }
  const disallowed = args[args.indexOf("--disallowed-tools") + 1] ?? "";
  assert.equal(disallowed, grokNativeDisallowedTools());
  assert.ok(!disallowed.split(",").includes("Agent"));
  assert.ok(!disallowed.split(",").includes("run_terminal_cmd"));
  const denyJoined = args.join("\0");
  assert.ok(denyJoined.includes(`Write(${path.join(grokHome, "auth.json")})`));
  assert.ok(denyJoined.includes(`Write(${path.join(grokHome, "agent_id")})`));
  assert.ok(denyJoined.includes(`Write(${path.join(grokHome, "config.toml")})`));
  assert.ok(denyJoined.includes(
    `Write(${grokNativeGoalStatePath(grokHome, GROK_NATIVE_WORKSPACE, GROK_NATIVE_SESSION)})`,
  ));
  const denyArgs = grokNativeDenyArgs(grokHome, GROK_NATIVE_WORKSPACE, GROK_NATIVE_SESSION, true);
  const denyBashAt = denyArgs.indexOf("Bash");
  assert.ok(denyBashAt > 0 && denyArgs[denyBashAt - 1] === "--deny", "native policy must emit the exact --deny Bash pair");
  const argvBashAt = args.indexOf("Bash");
  assert.ok(argvBashAt > 0 && args[argvBashAt - 1] === "--deny", "buildGrokCliArgs must keep the exact --deny Bash pair");
  assert.equal(denyArgs.includes("run_terminal_cmd"), false);
  assert.equal(denyArgs.includes("Agent"), false);
  assert.ok(!denyJoined.includes(`Write(${grokHome}/**)`));
  const env = buildGrokWorkerEnv("key", grokHome, { mode: "direct" }, { nativeGoal: true });
  assert.equal(env.GROK_GOAL, "1");
  assert.equal(env.GROK_WORKFLOWS, "1");
  assert.equal(env.GROK_GOAL_USE_CURRENT_MODEL_ONLY, "1");
  const started = grokLaunchEvidence({
    sessionId: GROK_NATIVE_SESSION,
    resuming: false,
    executionMode: "native-goal",
  });
  assert.equal(started.nativeGoal, "supported");
  assert.equal(started.executionMode, "native-goal");
  assert.equal(started.sessionArg, "--session-id");
});

test("Grok native-goal resume keeps the Session and explicit persistent-session stays on --resume", () => {
  const resumeArgs = buildGrokCliArgs({
    prompt: GROK_NATIVE_GOAL_RESUME_PROMPT,
    workspace: GROK_NATIVE_WORKSPACE,
    model: "grok-4.6",
    allowEdits: false,
    grokHome: "/task/grok-home",
    effort: "xhigh",
    sessionId: GROK_NATIVE_SESSION,
    resuming: true,
    executionMode: "native-goal",
  });
  assert.equal(resumeArgs[1], GROK_NATIVE_GOAL_RESUME_PROMPT);
  assert.deepEqual(resumeArgs.slice(-2), ["--resume", GROK_NATIVE_SESSION]);
  assert.ok(!resumeArgs.includes("--session-id"));
  const sessionArgs = buildGrokCliArgs({
    prompt: "do work",
    workspace: GROK_NATIVE_WORKSPACE,
    model: "grok-4.6",
    allowEdits: true,
    grokHome: "/task/grok-home",
    effort: "xhigh",
    sessionId: GROK_NATIVE_SESSION,
    resuming: true,
    executionMode: "persistent-session",
  });
  assert.equal(sessionArgs[1], "do work");
  assert.deepEqual(sessionArgs.slice(-2), ["--resume", GROK_NATIVE_SESSION]);
  assert.ok(sessionArgs.join("\0").includes("Write(/task/grok-home/**)"));
  const resumeEnv = buildGrokWorkerEnv("key", "/task/grok-home", { mode: "direct" }, { nativeGoal: true });
  assert.equal(resumeEnv.GROK_GOAL, "1");
  assert.equal(resumeEnv.GROK_WORKFLOWS, "1");
  assert.equal(resumeEnv.GROK_GOAL_USE_CURRENT_MODEL_ONLY, "1");
  const previousCurrentModelOnly = process.env.GROK_GOAL_USE_CURRENT_MODEL_ONLY;
  process.env.GROK_GOAL_USE_CURRENT_MODEL_ONLY = "1";
  try {
    const sessionEnv = buildGrokWorkerEnv("", "/task/grok-home", undefined, { nativeGoal: false });
    assert.equal(sessionEnv.GROK_GOAL, undefined);
    assert.equal(sessionEnv.GROK_GOAL_USE_CURRENT_MODEL_ONLY, undefined);
    assert.equal("GROK_GOAL_USE_CURRENT_MODEL_ONLY" in sessionEnv, false);
  } finally {
    if (previousCurrentModelOnly === undefined) delete process.env.GROK_GOAL_USE_CURRENT_MODEL_ONLY;
    else process.env.GROK_GOAL_USE_CURRENT_MODEL_ONLY = previousCurrentModelOnly;
  }
});

test("Grok native-goal read-only argv registers plan mutators and exact Workspace Write/Edit denials", () => {
  const grokHome = "/task/grok-home";
  const workspace = GROK_NATIVE_WORKSPACE;
  assert.notEqual(workspace, grokHome);
  assertNativePlanToolsOnce(grokNativeAllowTools(false));
  assertNativePlanToolsOnce(grokNativeAllowTools(true));
  const args = buildGrokCliArgs({
    prompt: `${GROK_NATIVE_GOAL_PROMPT_PREFIX}${GROK_NATIVE_CONTRACT}`,
    workspace,
    model: "grok-4.6",
    allowEdits: false,
    grokHome,
    effort: "xhigh",
    sessionId: GROK_NATIVE_SESSION,
    resuming: false,
    executionMode: "native-goal",
  });
  const tools = args[args.indexOf("--tools") + 1] ?? "";
  assert.equal(tools, grokNativeAllowTools(false));
  assertNativePlanToolsOnce(tools);
  assertExactDenyPair(args, `Write(${workspace}/**)`);
  assertExactDenyPair(args, `Edit(${workspace}/**)`);
  assert.equal(args.includes(`Write(${grokHome}/**)`), false);
  assert.equal(args.includes(`Edit(${grokHome}/**)`), false);
  assertExactDenyPair(args, `Write(${path.join(grokHome, "auth.json")})`);
  assertExactDenyPair(args, `Edit(${path.join(grokHome, "auth.json")})`);
  assertExactDenyPair(args, `Write(${path.join(grokHome, "agent_id")})`);
  assertExactDenyPair(args, `Edit(${path.join(grokHome, "agent_id")})`);
  assertExactDenyPair(args, `Write(${path.join(grokHome, "config.toml")})`);
  assertExactDenyPair(args, `Edit(${path.join(grokHome, "config.toml")})`);
  const statePath = grokNativeGoalStatePath(grokHome, workspace, GROK_NATIVE_SESSION);
  assertExactDenyPair(args, `Write(${statePath})`);
  assertExactDenyPair(args, `Edit(${statePath})`);
  assertExactDenyPair(args, "MCPTool");
  assertExactDenyPair(args, "Bash");
  const denyArgs = grokNativeDenyArgs(grokHome, workspace, GROK_NATIVE_SESSION, false);
  assertExactDenyPair(denyArgs, `Write(${workspace}/**)`);
  assertExactDenyPair(denyArgs, `Edit(${workspace}/**)`);
  assert.equal(denyArgs.includes(`Write(${grokHome}/**)`), false);
  assert.equal(denyArgs.includes(`Edit(${grokHome}/**)`), false);
});

test("Grok native-goal editable argv keeps plan mutators without Workspace-wide Write/Edit denials", () => {
  const grokHome = "/task/grok-home";
  const workspace = GROK_NATIVE_WORKSPACE;
  const args = buildGrokCliArgs({
    prompt: `${GROK_NATIVE_GOAL_PROMPT_PREFIX}${GROK_NATIVE_CONTRACT}`,
    workspace,
    model: "grok-4.6",
    allowEdits: true,
    grokHome,
    effort: "xhigh",
    sessionId: GROK_NATIVE_SESSION,
    resuming: false,
    executionMode: "native-goal",
  });
  const tools = args[args.indexOf("--tools") + 1] ?? "";
  assert.equal(tools, grokNativeAllowTools(true));
  assertNativePlanToolsOnce(tools);
  assert.equal(args.includes(`Write(${workspace}/**)`), false);
  assert.equal(args.includes(`Edit(${workspace}/**)`), false);
  const denyArgs = grokNativeDenyArgs(grokHome, workspace, GROK_NATIVE_SESSION, true);
  assert.equal(denyArgs.includes(`Write(${workspace}/**)`), false);
  assert.equal(denyArgs.includes(`Edit(${workspace}/**)`), false);
  assertExactDenyPair(args, "Bash");
  assertExactDenyPair(args, "MCPTool");
});

test("Grok persistent-session read-only argv still omits plan mutators and denies whole GROK_HOME", () => {
  const grokHome = "/task/grok-home";
  const args = buildGrokCliArgs({
    prompt: "do work",
    workspace: GROK_NATIVE_WORKSPACE,
    model: "grok-4.6",
    allowEdits: false,
    grokHome,
    effort: "high",
    sessionId: GROK_NATIVE_SESSION,
    resuming: false,
    executionMode: "persistent-session",
  });
  const tools = args[args.indexOf("--tools") + 1] ?? "";
  assert.equal(tools, grokAllowTools(false));
  assert.equal(tools.includes("search_replace"), false);
  assert.equal(tools.includes("write"), false);
  assertExactDenyPair(args, `Write(${grokHome}/**)`);
  assertExactDenyPair(args, `Edit(${grokHome}/**)`);
});

test("Grok native-goal child env freezes the foreground Planner budget", () => {
  const previousBudget = process.env.GROK_FOREGROUND_BLOCK_BUDGET_MS;
  assert.equal(GROK_NATIVE_FOREGROUND_BLOCK_BUDGET_MS, "86400000");
  try {
    delete process.env.GROK_FOREGROUND_BLOCK_BUDGET_MS;
    const omitted = buildGrokWorkerEnv("key", "/task/grok-home", { mode: "direct" }, { nativeGoal: true });
    assert.equal(omitted.GROK_FOREGROUND_BLOCK_BUDGET_MS, GROK_NATIVE_FOREGROUND_BLOCK_BUDGET_MS);
    assert.equal(omitted.GROK_GOAL, "1");
    assert.equal(omitted.GROK_WORKFLOWS, "1");
    assert.equal(omitted.GROK_GOAL_USE_CURRENT_MODEL_ONLY, "1");

    process.env.GROK_FOREGROUND_BLOCK_BUDGET_MS = "600000";
    const overridden = buildGrokWorkerEnv("key", "/task/grok-home", { mode: "direct" }, { nativeGoal: true });
    assert.equal(overridden.GROK_FOREGROUND_BLOCK_BUDGET_MS, GROK_NATIVE_FOREGROUND_BLOCK_BUDGET_MS);
    assert.equal(overridden.GROK_GOAL, "1");
    assert.equal(overridden.GROK_WORKFLOWS, "1");
    assert.equal(overridden.GROK_GOAL_USE_CURRENT_MODEL_ONLY, "1");
  } finally {
    if (previousBudget === undefined) delete process.env.GROK_FOREGROUND_BLOCK_BUDGET_MS;
    else process.env.GROK_FOREGROUND_BLOCK_BUDGET_MS = previousBudget;
  }
});

test("Grok persistent-session child env drops inherited foreground Planner budget", () => {
  const previousBudget = process.env.GROK_FOREGROUND_BLOCK_BUDGET_MS;
  const previousCurrentModelOnly = process.env.GROK_GOAL_USE_CURRENT_MODEL_ONLY;
  process.env.GROK_FOREGROUND_BLOCK_BUDGET_MS = "600000";
  process.env.GROK_GOAL_USE_CURRENT_MODEL_ONLY = "1";
  try {
    const sessionEnv = buildGrokWorkerEnv("", "/task/grok-home", undefined, { nativeGoal: false });
    assert.equal("GROK_FOREGROUND_BLOCK_BUDGET_MS" in sessionEnv, false);
    assert.equal("GROK_GOAL_USE_CURRENT_MODEL_ONLY" in sessionEnv, false);
  } finally {
    if (previousBudget === undefined) delete process.env.GROK_FOREGROUND_BLOCK_BUDGET_MS;
    else process.env.GROK_FOREGROUND_BLOCK_BUDGET_MS = previousBudget;
    if (previousCurrentModelOnly === undefined) delete process.env.GROK_GOAL_USE_CURRENT_MODEL_ONLY;
    else process.env.GROK_GOAL_USE_CURRENT_MODEL_ONLY = previousCurrentModelOnly;
  }
});

test("Grok native-goal launch, resume, successor, and untyped completed resume stay fail-closed", async () => {
  const grokHome = await mkdtemp(path.join(tmpdir(), "forklight-grok-native-launch-"));
  try {
    const first = resolveGrokNativeGoalLaunch({
      resuming: false,
      workerPrompt: GROK_NATIVE_CONTRACT,
      prior: { ok: false, reason: GROK_NATIVE_GOAL_FAILURE.missing },
    });
    assert.equal(first.ok, true);
    if (first.ok) {
      assert.equal(first.kind, "create");
      assert.ok(first.prompt.startsWith(GROK_NATIVE_GOAL_PROMPT_PREFIX));
      assert.ok(first.prompt.includes(GROK_NATIVE_CONTRACT));
    }

    await writeGrokNativeState({
      grokHome,
      state: {
        goal_id: "goal-paused-1",
        objective: GROK_NATIVE_CONTRACT,
        status: "user_paused",
        phase: "Executing",
        total_worker_rounds: 1,
        classifier_runs_attempted: 0,
      },
    });
    const priorPaused = readGrokNativeGoalState({
      grokHome,
      workspace: GROK_NATIVE_WORKSPACE,
      sessionId: GROK_NATIVE_SESSION,
    });
    const resume = resolveGrokNativeGoalLaunch({
      resuming: true,
      workerPrompt: GROK_NATIVE_CONTRACT,
      prior: priorPaused,
    });
    assert.equal(resume.ok, true);
    if (resume.ok) {
      assert.equal(resume.kind, "resume");
      assert.equal(resume.prompt, GROK_NATIVE_GOAL_RESUME_PROMPT);
      assert.equal(resume.expectedGoalId, "goal-paused-1");
    }

    await writeGrokNativeState({
      grokHome,
      state: achievedNativeState("goal-complete-1"),
      details: { body: "owned details" },
    });
    const priorComplete = readGrokNativeGoalState({
      grokHome,
      workspace: GROK_NATIVE_WORKSPACE,
      sessionId: GROK_NATIVE_SESSION,
    });
    const untyped = resolveGrokNativeGoalLaunch({
      resuming: true,
      workerPrompt: GROK_NATIVE_CONTRACT,
      prior: priorComplete,
    });
    assert.equal(untyped.ok, false);
    if (!untyped.ok) {
      assert.equal(untyped.reason, GROK_NATIVE_GOAL_FAILURE.untypedCompletedResume);
    }
    const successor = resolveGrokNativeGoalLaunch({
      resuming: true,
      workerPrompt: "Fix the remaining acceptance gap.",
      prior: priorComplete,
      correctionIntent: { kind: "main-correction", authorizationEventSequence: 4 },
    });
    assert.equal(successor.ok, true);
    if (successor.ok) {
      assert.equal(successor.kind, "successor");
      assert.ok(successor.prompt.startsWith(`${GROK_NATIVE_GOAL_PROMPT_PREFIX}Fix the remaining acceptance gap.`));
      assert.equal(successor.predecessorGoalId, "goal-complete-1");
      assert.equal(successor.reasonClass, "main-correction");
      const successorEnv = buildGrokWorkerEnv("key", grokHome, { mode: "direct" }, { nativeGoal: true });
      assert.equal(successorEnv.GROK_GOAL, "1");
      assert.equal(successorEnv.GROK_WORKFLOWS, "1");
      assert.equal(successorEnv.GROK_GOAL_USE_CURRENT_MODEL_ONLY, "1");
    }
    const repair = resolveGrokNativeGoalLaunch({
      resuming: true,
      workerPrompt: "Re-run the failed acceptance command.",
      prior: priorComplete,
      validationRepairIntent: {
        kind: "worker-validation-repair",
        authorizationEventSequence: 5,
        round: 1,
        attemptId: "attempt-repair-1",
      },
    });
    assert.equal(repair.ok, true);
    if (repair.ok) {
      assert.equal(repair.kind, "successor");
      assert.equal(repair.reasonClass, "worker-validation-repair");
      assert.equal(repair.predecessorGoalId, "goal-complete-1");
    }
  } finally {
    await rm(grokHome, { recursive: true, force: true });
  }
});

test("Grok native Goal terminal mapper admits only complete plus achieved plus owned details", async () => {
  const grokHome = await mkdtemp(path.join(tmpdir(), "forklight-grok-native-state-"));
  try {
    const missing = evaluateGrokNativeGoalResult({
      grokHome,
      workspace: GROK_NATIVE_WORKSPACE,
      sessionId: GROK_NATIVE_SESSION,
      launch: { ok: true, kind: "create", prompt: `${GROK_NATIVE_GOAL_PROMPT_PREFIX}${GROK_NATIVE_CONTRACT}` },
      exitCode: 0,
      completionProse: "I completed the goal.",
    });
    assert.equal(missing.status, "failed");
    assert.equal(missing.error, GROK_NATIVE_GOAL_FAILURE.missing);

    await writeGrokNativeState({ grokHome, state: { not: "a goal" } });
    const malformed = readGrokNativeGoalState({
      grokHome,
      workspace: GROK_NATIVE_WORKSPACE,
      sessionId: GROK_NATIVE_SESSION,
    });
    assert.equal(malformed.ok, false);
    if (!malformed.ok) assert.equal(malformed.reason, GROK_NATIVE_GOAL_FAILURE.malformed);

    for (const [status, expected] of [
      ["user_paused", GROK_NATIVE_GOAL_FAILURE.paused],
      ["infra_paused", GROK_NATIVE_GOAL_FAILURE.paused],
      ["paused", GROK_NATIVE_GOAL_FAILURE.paused],
      ["blocked", GROK_NATIVE_GOAL_FAILURE.blocked],
      ["budget", GROK_NATIVE_GOAL_FAILURE.budgetLimited],
      ["budget_limited", GROK_NATIVE_GOAL_FAILURE.budgetLimited],
      ["budgetLimited", GROK_NATIVE_GOAL_FAILURE.budgetLimited],
      ["active", GROK_NATIVE_GOAL_FAILURE.active],
    ] as const) {
      await writeGrokNativeState({
        grokHome,
        state: {
          goal_id: `goal-${status}`,
          objective: GROK_NATIVE_CONTRACT,
          status,
          phase: "Executing",
          total_worker_rounds: 1,
          classifier_runs_attempted: 0,
        },
      });
      const mapped = evaluateGrokNativeGoalResult({
        grokHome,
        workspace: GROK_NATIVE_WORKSPACE,
        sessionId: GROK_NATIVE_SESSION,
        launch: { ok: true, kind: "create", prompt: "/goal x" },
        exitCode: 0,
        completionProse: "done",
      });
      assert.equal(mapped.status, "failed", status);
      assert.equal(mapped.error, expected, status);
    }

    await writeGrokNativeState({
      grokHome,
      state: {
        goal_id: "goal-unknown",
        objective: GROK_NATIVE_CONTRACT,
        status: "finished",
        phase: "Idle",
      },
    });
    const unknown = readGrokNativeGoalState({
      grokHome,
      workspace: GROK_NATIVE_WORKSPACE,
      sessionId: GROK_NATIVE_SESSION,
    });
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.equal(unknown.reason, GROK_NATIVE_GOAL_FAILURE.unknownStatus);

    await writeGrokNativeState({
      grokHome,
      state: {
        goal_id: "goal-complete-no-verdict",
        objective: GROK_NATIVE_CONTRACT,
        status: "complete",
        phase: "Idle",
        classifier_runs_attempted: 1,
      },
    });
    const noVerdict = evaluateGrokNativeGoalResult({
      grokHome,
      workspace: GROK_NATIVE_WORKSPACE,
      sessionId: GROK_NATIVE_SESSION,
      launch: { ok: true, kind: "create", prompt: "/goal x" },
      exitCode: 0,
    });
    assert.equal(noVerdict.status, "failed");
    assert.equal(noVerdict.error, GROK_NATIVE_GOAL_FAILURE.completeWithoutAchieved);

    await writeGrokNativeState({
      grokHome,
      state: {
        goal_id: "goal-complete-zero-attempts",
        objective: GROK_NATIVE_CONTRACT,
        status: "complete",
        phase: "Idle",
        classifier_runs_attempted: 0,
        last_classifier_verdict: "achieved",
      },
    });
    const zeroAttempts = evaluateGrokNativeGoalResult({
      grokHome,
      workspace: GROK_NATIVE_WORKSPACE,
      sessionId: GROK_NATIVE_SESSION,
      launch: { ok: true, kind: "create", prompt: "/goal x" },
      exitCode: 0,
    });
    assert.equal(zeroAttempts.status, "failed");
    assert.equal(zeroAttempts.error, GROK_NATIVE_GOAL_FAILURE.completeWithoutAchieved);

    await writeGrokNativeState({
      grokHome,
      state: {
        goal_id: "goal-complete-not-achieved",
        objective: GROK_NATIVE_CONTRACT,
        status: "complete",
        phase: "Idle",
        classifier_runs_attempted: 1,
        last_classifier_verdict: "not_achieved",
      },
    });
    const notAchieved = evaluateGrokNativeGoalResult({
      grokHome,
      workspace: GROK_NATIVE_WORKSPACE,
      sessionId: GROK_NATIVE_SESSION,
      launch: { ok: true, kind: "create", prompt: "/goal x" },
      exitCode: 0,
    });
    assert.equal(notAchieved.status, "failed");
    assert.equal(notAchieved.error, GROK_NATIVE_GOAL_FAILURE.completeWithoutAchieved);

    await writeGrokNativeState({
      grokHome,
      state: {
        goal_id: "goal-achieved-no-details",
        objective: GROK_NATIVE_CONTRACT,
        status: "complete",
        phase: "Idle",
        classifier_runs_attempted: 1,
        last_classifier_verdict: "achieved",
      },
    });
    const noDetails = evaluateGrokNativeGoalResult({
      grokHome,
      workspace: GROK_NATIVE_WORKSPACE,
      sessionId: GROK_NATIVE_SESSION,
      launch: { ok: true, kind: "create", prompt: "/goal x" },
      exitCode: 0,
    });
    assert.equal(noDetails.status, "failed");
    assert.equal(noDetails.error, GROK_NATIVE_GOAL_FAILURE.achievedWithoutDetails);

    await writeGrokNativeState({
      grokHome,
      state: {
        goal_id: "goal-missing-details-file",
        objective: GROK_NATIVE_CONTRACT,
        status: "complete",
        phase: "Idle",
        classifier_runs_attempted: 1,
        last_classifier_verdict: "achieved",
        last_classifier_details_path: path.join(grokHome, "sessions", "missing-details.md"),
      },
    });
    const missingDetails = evaluateGrokNativeGoalResult({
      grokHome,
      workspace: GROK_NATIVE_WORKSPACE,
      sessionId: GROK_NATIVE_SESSION,
      launch: { ok: true, kind: "create", prompt: "/goal x" },
      exitCode: 0,
    });
    assert.equal(missingDetails.status, "failed");
    assert.equal(missingDetails.error, GROK_NATIVE_GOAL_FAILURE.missingDetails);

    const outsideRoot = await mkdtemp(path.join(tmpdir(), "forklight-grok-native-outside-"));
    const outsideDetails = path.join(outsideRoot, "leaked-classifier.md");
    await writeFile(outsideDetails, "classifier prose outside the Task Runtime Home", { mode: 0o600 });
    await writeGrokNativeState({
      grokHome,
      state: {
        ...achievedNativeState("goal-escaping"),
        last_classifier_details_path: outsideDetails,
      },
    });
    const escaping = evaluateGrokNativeGoalResult({
      grokHome,
      workspace: GROK_NATIVE_WORKSPACE,
      sessionId: GROK_NATIVE_SESSION,
      launch: { ok: true, kind: "create", prompt: "/goal x" },
      exitCode: 0,
    });
    await rm(outsideRoot, { recursive: true, force: true });
    assert.equal(escaping.status, "failed");
    assert.equal(escaping.error, GROK_NATIVE_GOAL_FAILURE.escapingDetails);

    await rm(path.join(grokHome, "sessions"), { recursive: true, force: true });
    await writeGrokNativeState({
      grokHome,
      workspace: "/other/workspace",
      state: achievedNativeState("goal-wrong-root"),
      details: { body: "other root" },
    });
    const wrongRoot = readGrokNativeGoalState({
      grokHome,
      workspace: GROK_NATIVE_WORKSPACE,
      sessionId: GROK_NATIVE_SESSION,
    });
    assert.equal(wrongRoot.ok, false);
    if (!wrongRoot.ok) assert.equal(wrongRoot.reason, GROK_NATIVE_GOAL_FAILURE.wrongRoot);

    await writeGrokNativeState({
      grokHome,
      workspace: GROK_NATIVE_WORKSPACE,
      state: achievedNativeState("goal-ambiguous-a"),
      details: { relativeName: "a.md" },
    });
    await writeGrokNativeState({
      grokHome,
      workspace: "/second/workspace",
      state: achievedNativeState("goal-ambiguous-b"),
      details: { relativeName: "b.md" },
    });
    const ambiguous = readGrokNativeGoalState({
      grokHome,
      workspace: GROK_NATIVE_WORKSPACE,
      sessionId: GROK_NATIVE_SESSION,
    });
    assert.equal(ambiguous.ok, false);
    if (!ambiguous.ok) assert.equal(ambiguous.reason, GROK_NATIVE_GOAL_FAILURE.ambiguous);

    await rm(path.join(grokHome, "sessions"), { recursive: true, force: true });
    const { detailsPath } = await writeGrokNativeState({
      grokHome,
      state: achievedNativeState("goal-success-1"),
      details: { body: "0 of 3 skeptics refuted" },
    });
    const success = evaluateGrokNativeGoalResult({
      grokHome,
      workspace: GROK_NATIVE_WORKSPACE,
      sessionId: GROK_NATIVE_SESSION,
      launch: { ok: true, kind: "create", prompt: "/goal x" },
      exitCode: 0,
      completionProse: "I completed the goal.",
    });
    assert.equal(success.status, "succeeded");
    assert.equal(success.goalId, "goal-success-1");
    assert.equal(success.observation?.status, "complete");
    assert.equal(success.observation?.classifierVerdict, "achieved");
    assert.equal(success.observation?.classifierRunsAttempted, 1);
    const serialized = JSON.stringify(success.observation);
    assert.equal(serialized.includes("SECRET"), false);
    assert.equal(serialized.includes("skeptics"), false);
    assert.equal(serialized.includes(detailsPath ?? "goal-classifier"), false);
    assert.equal(serialized.includes("objective"), false);
    assert.equal(serialized.includes("first_final_response"), false);
    const observation = grokNativeGoalObservation({
      goalId: "goal-success-1",
      objective: GROK_NATIVE_CONTRACT,
      status: "complete",
      phase: "Idle",
      lastClassifierVerdict: "achieved",
      ...(detailsPath === undefined ? {} : { lastClassifierDetailsPath: detailsPath }),
      totalWorkerRounds: 1,
    });
    assert.equal("objective" in observation, false);
    assert.equal("lastClassifierDetailsPath" in observation, false);

    const resumeMismatch = evaluateGrokNativeGoalResult({
      grokHome,
      workspace: GROK_NATIVE_WORKSPACE,
      sessionId: GROK_NATIVE_SESSION,
      launch: {
        ok: true,
        kind: "resume",
        prompt: GROK_NATIVE_GOAL_RESUME_PROMPT,
        expectedGoalId: "goal-other",
      },
      exitCode: 0,
    });
    assert.equal(resumeMismatch.status, "failed");
    assert.equal(resumeMismatch.error, GROK_NATIVE_GOAL_FAILURE.resumeGoalMismatch);

    const sameSuccessor = evaluateGrokNativeGoalResult({
      grokHome,
      workspace: GROK_NATIVE_WORKSPACE,
      sessionId: GROK_NATIVE_SESSION,
      launch: {
        ok: true,
        kind: "successor",
        prompt: "/goal fix it",
        predecessorGoalId: "goal-success-1",
        reasonClass: "main-correction",
      },
      exitCode: 0,
    });
    assert.equal(sameSuccessor.status, "failed");
    assert.equal(sameSuccessor.error, GROK_NATIVE_GOAL_FAILURE.successorNotDistinct);

    await writeGrokNativeState({
      grokHome,
      state: achievedNativeState("goal-successor-2"),
      details: { relativeName: "successor.md" },
    });
    const distinctSuccessor = evaluateGrokNativeGoalResult({
      grokHome,
      workspace: GROK_NATIVE_WORKSPACE,
      sessionId: GROK_NATIVE_SESSION,
      launch: {
        ok: true,
        kind: "successor",
        prompt: "/goal fix it",
        predecessorGoalId: "goal-success-1",
        reasonClass: "main-correction",
      },
      exitCode: 1,
      completionProse: "still claiming success",
    });
    assert.equal(distinctSuccessor.status, "succeeded");
    assert.equal(distinctSuccessor.goalId, "goal-successor-2");
    assert.equal(distinctSuccessor.predecessorGoalId, "goal-success-1");
  } finally {
    await rm(grokHome, { recursive: true, force: true });
  }
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
    nativeGoal: "unsupported" as const,
    streamingEvents: "supported" as const,
    progressHeartbeat: "effective-progress" as const,
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
    nativeGoal: "unsupported" as const,
    streamingEvents: "partial" as const,
    progressHeartbeat: "effective-progress" as const,
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
    nativeGoal: "unsupported" as const,
    streamingEvents: "supported" as const,
    progressHeartbeat: "effective-progress" as const,
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
      "No effective progress detected within the configured interval; worker was terminated by the no-effective-progress stop",
    ),
    false,
    "no-effective-progress stop text is not connectivity",
  );
  assert.equal(
    isGrokConnectivityEvidence(
      "No effective implementation progress detected within the configured interval; worker was terminated by the progress watchdog",
    ),
    false,
    "legacy no-progress watchdog text is not connectivity",
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

// --- Profile Worker slot release hook (Attempt boundary) ---

test("executeAttempt notifies Profile slot release after Worker return and before verification", async () => {
  registerPolicyTestClaude(async () => ({
    status: "succeeded",
    exitCode: 0,
    resultText: "ok",
  }));
  const { store, task } = await policyRunnerFixture({
    completionMode: "off",
    changeBudgetMode: "off",
  });
  try {
    let releaseCount = 0;
    let verificationStartedAtRelease = false;
    const result = await executeAttempt(
      store,
      task,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => {
        releaseCount += 1;
        verificationStartedAtRelease = store.listEvents(task.id).some(
          (event) => event.type === "verification.started",
        );
      },
    );
    assert.equal(releaseCount, 1, "release hook fires exactly once on the success path");
    assert.equal(
      verificationStartedAtRelease,
      false,
      "release must precede independent verification",
    );
    assert.equal(result.task.status, "succeeded");
    assert.ok(
      store.listEvents(task.id).some((event) => event.type === "verification.started"),
      "verification still runs after the optional release notification",
    );
  } finally {
    store.close();
    resetWorkerRegistryForTests();
  }
});

test("executeAttempt release hook is optional, idempotent on failure paths, and cannot rewrite success", async () => {
  // 1) Ordinary callers omit the hook and still succeed.
  registerPolicyTestClaude(async () => ({
    status: "succeeded",
    exitCode: 0,
    resultText: "ok",
  }));
  const omitted = await policyRunnerFixture({
    completionMode: "off",
    changeBudgetMode: "off",
  });
  try {
    const result = await executeAttempt(omitted.store, omitted.task, false);
    assert.equal(result.task.status, "succeeded");
  } finally {
    omitted.store.close();
    resetWorkerRegistryForTests();
  }

  // 2) Doctor failure still notifies once so a Profile slot cannot leak.
  resetWorkerRegistryForTests();
  getWorkerAdapter("claude-code");
  const capabilities = getWorkerAdapter("claude-code").capabilities();
  registerWorkerAdapter({
    name: "claude-code",
    displayName: "Doctor-fail release test",
    defaultExecutable: process.execPath,
    capabilities: () => capabilities,
    doctor: () => ({
      runtime: "claude-code",
      ok: false,
      executable: process.execPath,
      issues: ["simulated doctor failure for release hook"],
      capabilities,
    }),
    validateSpec: () => {},
    effortArgs: () => [],
    toolProtocolAppendix: () => [],
    checkpointProtocolAppendix: () => [],
    run: async () => {
      throw new Error("run must not be called when doctor fails");
    },
  });
  const doctorCase = await policyRunnerFixture({});
  try {
    let releaseCount = 0;
    const result = await executeAttempt(
      doctorCase.store,
      doctorCase.task,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => {
        releaseCount += 1;
      },
    );
    assert.equal(result.task.status, "failed");
    assert.match(result.task.error ?? "", /doctor failed/);
    assert.equal(releaseCount, 1);
  } finally {
    doctorCase.store.close();
    resetWorkerRegistryForTests();
  }

  // 3) A throwing release hook must not manufacture failure after Worker success.
  registerPolicyTestClaude(async () => ({
    status: "succeeded",
    exitCode: 0,
    resultText: "ok",
  }));
  const throwCase = await policyRunnerFixture({
    completionMode: "off",
    changeBudgetMode: "off",
  });
  try {
    const result = await executeAttempt(
      throwCase.store,
      throwCase.task,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => {
        throw new Error("scheduler notification must not rewrite Task outcome");
      },
    );
    assert.equal(result.task.status, "succeeded");
    assert.equal(result.verification?.passed, true);
  } finally {
    throwCase.store.close();
    resetWorkerRegistryForTests();
  }

  // 4) Worker failed status also releases exactly once (no verification).
  registerPolicyTestClaude(async () => ({
    status: "failed",
    exitCode: 1,
    error: "simulated worker failure for release",
  }));
  const failedCase = await policyRunnerFixture({});
  try {
    let releaseCount = 0;
    const result = await executeAttempt(
      failedCase.store,
      failedCase.task,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => {
        releaseCount += 1;
      },
    );
    assert.equal(result.task.status, "failed");
    assert.equal(result.verification, undefined);
    assert.equal(releaseCount, 1);
  } finally {
    failedCase.store.close();
    resetWorkerRegistryForTests();
  }
});

test("resumeTask succeeds without onWorkerProfileSlotRelease and preserves pre-hook behavior", async () => {
  // Direct callers (CLI / non-Coordinator) omit the optional release hook.
  // First Attempt fails, then resumeTask without the hook follows the success path.
  registerPolicyTestClaude(async () => ({
    status: "failed",
    exitCode: 1,
    error: "simulated first-attempt failure for resume",
  }));
  const { store, task } = await policyRunnerFixture({
    completionMode: "off",
    changeBudgetMode: "off",
    baseMaxAttempts: 2,
  });
  try {
    const failed = await executeAttempt(store, task, false);
    assert.equal(failed.task.status, "failed");
    assert.equal(store.listAttempts(task.id).length, 1);

    registerPolicyTestClaude(async (ctx) => {
      // Tiny business edit so independent verification has a real patch artifact.
      await writeFile(
        path.join(ctx.task.paths.workspace, "src", "hello.ts"),
        "export const n = 2;\n",
      );
      return { status: "succeeded", exitCode: 0, resultText: "resume ok" };
    });
    // Omit onWorkerProfileSlotRelease entirely — arity and success path only.
    const result = await resumeTask(store, task.id);
    assert.equal(result.task.status, "succeeded");
    assert.equal(result.verification?.passed, true);
    assert.equal(store.listAttempts(task.id).length, 2);
    assert.equal(result.attempt.ordinal, 2);
    assert.equal(result.attempt.status, "succeeded");
    assert.equal(result.attempt.exitCode, 0);
    assert.ok(
      store.listEvents(task.id).some((event) => event.type === "verification.started"),
      "resume without hook still runs independent verification",
    );
  } finally {
    store.close();
    resetWorkerRegistryForTests();
  }
});

test("correctTask succeeds without onWorkerProfileSlotRelease and preserves pre-hook behavior", async () => {
  // Durable Main-correction grant + queued preparation, then correctTask with
  // the optional Profile release hook omitted (direct-caller compatibility).
  registerPolicyTestClaude(async () => ({
    status: "failed",
    exitCode: 1,
    error: "simulated first-attempt failure for correction",
  }));
  const { store, task } = await policyRunnerFixture({
    completionMode: "off",
    changeBudgetMode: "off",
    baseMaxAttempts: 1,
    maxMainCorrections: 1,
    maxExtraAttempts: 0,
  });
  try {
    const failed = await executeAttempt(store, task, false);
    assert.equal(failed.task.status, "failed");
    assert.equal(store.listAttempts(task.id).length, 1);

    const grant = authorizeMainCorrection(
      store,
      task.id,
      {
        feedback: "Bounded Main correction for no-hook direct caller",
        maxBudgetUsd: null,
        confirm: true,
      },
      1,
      1,
    );
    assert.equal(grant.maximumOrdinal, 2);
    const pendingEvents = store.listEvents(task.id).filter(
      (event) => event.type === "attempt.authorization.granted",
    );
    assert.equal(pendingEvents.length, 1);
    assert.equal(
      (pendingEvents[0]!.payload as Record<string, unknown>).kind,
      "correction",
    );

    const queued = prepareMainCorrectionTask(store, task.id);
    assert.equal(queued.status, "queued");

    registerPolicyTestClaude(async (ctx) => {
      await writeFile(
        path.join(ctx.task.paths.workspace, "src", "hello.ts"),
        "export const n = 3;\n",
      );
      return { status: "succeeded", exitCode: 0, resultText: "correction ok" };
    });
    // Omit onWorkerProfileSlotRelease — correctTask must not require the hook.
    const result = await correctTask(store, task.id);
    assert.equal(result.task.status, "succeeded");
    assert.equal(result.verification?.passed, true);
    assert.equal(store.listAttempts(task.id).length, 2);
    assert.equal(result.attempt.ordinal, 2);
    assert.equal(result.attempt.status, "succeeded");
    assert.equal(result.attempt.exitCode, 0);
    assert.ok(
      store.listEvents(task.id).some((event) => event.type === "verification.started"),
      "correction without hook still runs independent verification",
    );
  } finally {
    store.close();
    resetWorkerRegistryForTests();
  }
});

// --- Codex Runtime-native Goal via deterministic fake app-server (FL-104) ---

interface FakeAppServerPolicy {
  cwd: string;
  model: string;
  effort: string;
  allowEdits: boolean;
}

interface FakeAppServerConfig {
  after?: Record<string, Array<{
    method?: string;
    params?: Record<string, unknown>;
    raw?: string;
  }>>;
  /**
   * Notifications emitted on a timer after a method's response/`after` burst.
   * Used for post-activation continuation Turns that must not enter the
   * turn/start race buffer.
   */
  delayedAfter?: Record<string, {
    delayMs?: number;
    /** Test-only release gate; when present, emit only after this file exists. */
    triggerPath?: string;
    notifications: Array<{
      method?: string;
      params?: Record<string, unknown>;
      raw?: string;
    }>;
  }>;
  responders?: Record<string, {
    result?: unknown;
    error?: { code: number; message: string };
  }>;
  /** Exact frozen Thread/Turn policy the adapter must send on every boundary. */
  policy?: FakeAppServerPolicy;
  objective?: string;
  goalStatus?: string;
  exitAfter?: number;
  exitCode?: number;
  initializeError?: { code: number; message: string };
  /**
   * Methods that intentionally never write a response. Used only to prove
   * setup waits terminate through the no-progress policy path.
   */
  hangMethods?: string[];
  /**
   * Methods whose response and configured `after` notifications are written as
   * one bounded stdout batch. Same-burst/overflow fixtures use this so tests
   * do not depend on OS pipe chunk coalescing of separate writes.
   */
  batchAfter?: string[];
  /**
   * When true, outbound messages include `jsonrpc: "2.0"`. Default false matches
   * installed Codex app-server 0.146.0, which omits that member on responses and
   * notifications (and may attach non-authoritative `emittedAtMs`).
   */
  includeJsonrpc?: boolean;
}

/** Deterministic fake `codex app-server` that enforces the installed canonical
 *  JSON-RPC protocol exactly: mandatory initialize/initialized handshake,
 *  camelCase request params, nested `result.thread` / `result.goal` /
 *  `result.turn` response shapes, and exact frozen cwd/model/effort/approval/
 *  sandbox policy on thread/start, thread/resume, and turn/start. Wrong field
 *  names, the ignored `workspace` field, broader roots, or a missing handshake
 *  make the fake reject the request so tests fail closed.
 *
 *  Default outbound envelopes match installed Codex 0.146.0 (no `jsonrpc`
 *  member; notifications may include `emittedAtMs`). Set `includeJsonrpc` to
 *  also cover explicit `jsonrpc: "2.0"` acceptance. Named methods in
 *  `batchAfter` emit the response plus configured after-notifications as one
 *  stdout write so same-burst/overflow fixtures stay independent of pipe
 *  scheduling. `hangMethods` never responds (setup no-progress regressions). */
function fakeAppServerScript(config: FakeAppServerConfig, logPath: string | null): string {
  return [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    "const readline = require('node:readline');",
    `const config = ${JSON.stringify(config)};`,
    `const logPath = ${JSON.stringify(logPath)};`,
    "const state = {};",
    "let initialized = false;",
    "let sawInitializedNotification = false;",
    "function envelope(msg) {",
    "  if (config.includeJsonrpc) msg.jsonrpc = '2.0';",
    "  return msg;",
    "}",
    "function lineFor(msg) { return JSON.stringify(envelope(msg)) + '\\n'; }",
    "function respondLine(id, result) { return lineFor({ id: id, result: result }); }",
    "function respondErrorLine(id, code, message) { return lineFor({ id: id, error: { code: code, message: message } }); }",
    "function notifyLine(method, params) { return lineFor({ emittedAtMs: 1, method: method, params: params }); }",
    "function respond(id, result) { process.stdout.write(respondLine(id, result)); }",
    "function respondError(id, code, message) { process.stdout.write(respondErrorLine(id, code, message)); }",
    "function notify(method, params) { process.stdout.write(notifyLine(method, params)); }",
    "function shouldHang(method) {",
    "  return Array.isArray(config.hangMethods) && config.hangMethods.indexOf(method) !== -1;",
    "}",
    "function shouldBatchAfter(method) {",
    "  return Array.isArray(config.batchAfter) && config.batchAfter.indexOf(method) !== -1;",
    "}",
    "function afterLines(method) {",
    "  const after = (config.after && config.after[method]) || [];",
    "  const lines = [];",
    "  for (const n of after) {",
    "    if (n.raw) lines.push(n.raw + '\\n');",
    "    else lines.push(notifyLine(n.method, n.params));",
    "  }",
    "  return lines;",
    "}",
    "function writeResponseAndAfter(method, responseLine) {",
    "  const trailing = afterLines(method);",
    "  if (shouldBatchAfter(method)) {",
    "    process.stdout.write(responseLine + trailing.join(''));",
    "  } else {",
    "    process.stdout.write(responseLine);",
    "    for (const line of trailing) process.stdout.write(line);",
    "  }",
    "  const delayed = config.delayedAfter && config.delayedAfter[method];",
    "  if (!delayed || !Array.isArray(delayed.notifications)) return;",
    "  function emitDelayed() {",
    "    for (const n of delayed.notifications) {",
    "      if (n.raw) process.stdout.write(n.raw + '\\n');",
    "      else process.stdout.write(notifyLine(n.method, n.params));",
    "    }",
    "  }",
    "  if (typeof delayed.triggerPath === 'string') {",
    "    const timer = setInterval(function() {",
    "      if (!fs.existsSync(delayed.triggerPath)) return;",
    "      clearInterval(timer);",
    "      emitDelayed();",
    "    }, 5);",
    "    timer.unref();",
    "    return;",
    "  }",
    "  const delayMs = typeof delayed.delayMs === 'number' ? delayed.delayMs : 30;",
    "  setTimeout(emitDelayed, delayMs).unref();",
    "}",
    "function exactKeys(obj, keys) {",
    "  const actual = Object.keys(obj).sort();",
    "  const expected = keys.slice().sort();",
    "  if (actual.length !== expected.length) return false;",
    "  for (let i = 0; i < actual.length; i++) if (actual[i] !== expected[i]) return false;",
    "  return true;",
    "}",
    "function noLegacyOrDanger(params) {",
    "  if (Object.prototype.hasOwnProperty.call(params, 'workspace')) return false;",
    "  const raw = JSON.stringify(params);",
    "  if (raw.indexOf('dangerFullAccess') !== -1) return false;",
    "  if (raw.indexOf('danger-full-access') !== -1) return false;",
    "  return true;",
    "}",
    "function threadPolicyOk(params, withThreadId) {",
    "  const policy = config.policy;",
    "  if (!policy) return false;",
    "  const keys = withThreadId",
    "    ? ['threadId', 'cwd', 'model', 'approvalPolicy', 'sandbox']",
    "    : ['cwd', 'model', 'approvalPolicy', 'sandbox'];",
    "  if (!exactKeys(params, keys)) return false;",
    "  if (!noLegacyOrDanger(params)) return false;",
    "  if (withThreadId && (typeof params.threadId !== 'string' || params.threadId.length < 1)) return false;",
    "  if (params.cwd !== policy.cwd) return false;",
    "  if (params.model !== policy.model) return false;",
    "  if (params.approvalPolicy !== 'never') return false;",
    "  const expectedSandbox = policy.allowEdits ? 'workspace-write' : 'read-only';",
    "  if (params.sandbox !== expectedSandbox) return false;",
    "  return true;",
    "}",
    "function turnSandboxPolicyOk(sandboxPolicy) {",
    "  const policy = config.policy;",
    "  if (!policy || sandboxPolicy === null || typeof sandboxPolicy !== 'object' || Array.isArray(sandboxPolicy)) return false;",
    "  if (policy.allowEdits) {",
    "    if (!exactKeys(sandboxPolicy, ['type', 'writableRoots', 'networkAccess'])) return false;",
    "    if (sandboxPolicy.type !== 'workspaceWrite') return false;",
    "    if (!Array.isArray(sandboxPolicy.writableRoots) || sandboxPolicy.writableRoots.length !== 1) return false;",
    "    if (sandboxPolicy.writableRoots[0] !== policy.cwd) return false;",
    "    if (sandboxPolicy.networkAccess !== false) return false;",
    "    return true;",
    "  }",
    "  if (!exactKeys(sandboxPolicy, ['type', 'networkAccess'])) return false;",
    "  if (sandboxPolicy.type !== 'readOnly') return false;",
    "  if (sandboxPolicy.networkAccess !== false) return false;",
    "  if (Object.prototype.hasOwnProperty.call(sandboxPolicy, 'writableRoots')) return false;",
    "  return true;",
    "}",
    "function turnPolicyOk(params) {",
    "  const policy = config.policy;",
    "  if (!policy) return false;",
    "  if (!exactKeys(params, ['threadId', 'input', 'cwd', 'model', 'effort', 'approvalPolicy', 'sandboxPolicy'])) return false;",
    "  if (!noLegacyOrDanger(params)) return false;",
    "  if (typeof params.threadId !== 'string' || params.threadId.length < 1) return false;",
    "  if (!Array.isArray(params.input) || params.input.length < 1) return false;",
    "  if (!params.input[0] || params.input[0].type !== 'text' || typeof params.input[0].text !== 'string') return false;",
    "  if (params.cwd !== policy.cwd) return false;",
    "  if (params.model !== policy.model) return false;",
    "  if (params.effort !== policy.effort) return false;",
    "  if (params.approvalPolicy !== 'never') return false;",
    "  return turnSandboxPolicyOk(params.sandboxPolicy);",
    "}",
    "function validateRequest(method, params) {",
    "  if (params === null || typeof params !== 'object') return false;",
    "  switch (method) {",
    "    case 'thread/start': return threadPolicyOk(params, false);",
    "    case 'thread/resume': return threadPolicyOk(params, true);",
    "    case 'thread/goal/set': return typeof params.threadId === 'string' && typeof params.objective === 'string' && params.status === 'active' && params.tokenBudget === null;",
    "    case 'thread/goal/get': return typeof params.threadId === 'string' && params.threadId.length > 0;",
    "    case 'turn/start': return turnPolicyOk(params);",
    "    case 'turn/interrupt': return typeof params.threadId === 'string' && typeof params.turnId === 'string';",
    "    default: return true;",
    "  }",
    "}",
    "function handle(method, params) {",
    "  switch (method) {",
    "    case 'thread/start': return { thread: { id: 'thread-1' } };",
    "    case 'thread/goal/set': state.objective = params.objective; return { goal: { threadId: 'thread-1', objective: params.objective, status: 'active', tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0 } };",
    "    case 'thread/goal/get': return { goal: { threadId: 'thread-1', objective: state.objective || config.objective || 'missing', status: config.goalStatus || 'active', tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0 } };",
    "    case 'thread/resume': return { thread: { id: params.threadId } };",
    "    case 'turn/start': return { turn: { id: 'turn-1' } };",
    "    case 'turn/interrupt': return { ok: true };",
    "    case 'thread/goal/clear': return { ok: true };",
    "    default: return undefined;",
    "  }",
    "}",
    "fs.writeFileSync('codex-goal-env-dump.json', JSON.stringify({",
    "  cwd: process.cwd(),",
    "  CODEX_HOME: process.env.CODEX_HOME || null,",
    "  TMPDIR: process.env.TMPDIR || null,",
    "  TMP: process.env.TMP || null,",
    "  TEMP: process.env.TEMP || null,",
    "  hasOpenAIKey: Object.prototype.hasOwnProperty.call(process.env, 'OPENAI_API_KEY'),",
    "  hasOpenAIBaseUrl: Object.prototype.hasOwnProperty.call(process.env, 'OPENAI_BASE_URL'),",
    "  hasOpenAIOrgId: Object.prototype.hasOwnProperty.call(process.env, 'OPENAI_ORG_ID'),",
    "  hasOpenAIProject: Object.prototype.hasOwnProperty.call(process.env, 'OPENAI_PROJECT'),",
    "  hasCodexApiKey: Object.prototype.hasOwnProperty.call(process.env, 'CODEX_API_KEY'),",
    "  HTTP_PROXY: process.env.HTTP_PROXY || null,",
    "  http_proxy: process.env.http_proxy || null,",
    "  HTTPS_PROXY: process.env.HTTPS_PROXY || null,",
    "  https_proxy: process.env.https_proxy || null,",
    "  ALL_PROXY: process.env.ALL_PROXY || null,",
    "  all_proxy: process.env.all_proxy || null,",
    "  NO_PROXY: process.env.NO_PROXY || null,",
    "  no_proxy: process.env.no_proxy || null",
    "}));",
    "process.on('SIGINT', function(){ process.exit(130); });",
    "process.on('SIGTERM', function(){ process.exit(143); });",
    "const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });",
    "let count = 0;",
    "rl.on('line', function(line){",
    "  let req;",
    "  try { req = JSON.parse(line); } catch { respondError(-1, -32700, 'parse error'); return; }",
    "  count += 1;",
    "  if (logPath) fs.appendFileSync(logPath, JSON.stringify(req) + '\\n');",
    "  if (shouldHang(req.method)) { return; }",
    "  if (req.method === 'initialize') {",
    "    if (initialized) { respondError(req.id, -32600, 'duplicate initialize'); return; }",
    "    initialized = true;",
    "    if (config.initializeError) { respondError(req.id, config.initializeError.code, config.initializeError.message); return; }",
    "    respond(req.id, { serverInfo: { name: 'fake-codex', version: '0.146.0' }, capabilities: {} });",
    "    return;",
    "  }",
    "  if (req.method === 'initialized') {",
    "    if (!initialized) { respondError(req.id === undefined ? -1 : req.id, -32002, 'not initialized'); return; }",
    "    sawInitializedNotification = true;",
    "    return;",
    "  }",
    "  if (!initialized || !sawInitializedNotification) {",
    "    respondError(req.id === undefined ? -1 : req.id, -32002, 'server not initialized');",
    "    return;",
    "  }",
    // Strict policy validation runs before custom responders so invented response
    // shape tests still prove the request wire is independently correct.
    "  if (!validateRequest(req.method, req.params)) { respondError(req.id, -32602, 'invalid params: ' + req.method); return; }",
    "  const custom = config.responders && config.responders[req.method];",
    "  if (custom && custom.error !== undefined) {",
    "    writeResponseAndAfter(req.method, respondErrorLine(req.id, custom.error.code, custom.error.message));",
    "  } else if (custom && custom.result !== undefined) {",
    "    writeResponseAndAfter(req.method, respondLine(req.id, custom.result));",
    "  } else {",
    "    const r = handle(req.method, req.params);",
    "    if (r === undefined) writeResponseAndAfter(req.method, respondErrorLine(req.id, -32601, 'method not found: ' + req.method));",
    "    else writeResponseAndAfter(req.method, respondLine(req.id, r));",
    "  }",
    "  if (config.exitAfter === count) {",
    "    process.exitCode = config.exitCode === undefined ? 0 : config.exitCode;",
    "    process.stdin.end();",
    "  }",
    "});",
  ].join("\n");
}

async function codexNativeGoalFixture(options: {
  config?: FakeAppServerConfig;
  effectivePolicy?: TaskRecord["effectivePolicy"];
  allowEdits?: boolean;
  networkPolicy?: unknown;
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "fl-codex-goal-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "src"), { recursive: true });
  await writeFile(path.join(source, "src", "hello.ts"), "export const n = 1;\n");
  const home = path.join(root, "state");
  const store = new StateStore(home);
  const operatorCodexHome = path.join(root, "operator-codex");
  await mkdir(operatorCodexHome, { recursive: true });
  await writeFile(path.join(operatorCodexHome, "auth.json"), '{"credentials":"placeholder"}', { mode: 0o600 });
  await writeFile(path.join(operatorCodexHome, "models_cache.json"), '{"models":[]}', { mode: 0o600 });
  const script = path.join(root, "fake-app-server.cjs");
  const requestLog = path.join(root, "appserver-requests.jsonl");

  const { taskPaths } = await import("../src/core/config.js");
  const id = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const paths = taskPaths(home, id);
  await mkdir(paths.workspace, { recursive: true });
  await mkdir(paths.baseline, { recursive: true });

  const allowEdits = options.allowEdits ?? true;
  const model = "gpt-5.6-luna";
  const effort = "max";
  // Policy is baked into the fake before any request so missing/wrong wire
  // fields fail closed even when a custom responder supplies a result shape.
  const serverConfig: FakeAppServerConfig = {
    ...(options.config ?? {}),
    policy: {
      cwd: paths.workspace,
      model,
      effort,
      allowEdits,
    },
  };
  await writeFile(script, fakeAppServerScript(serverConfig, requestLog), { mode: 0o755 });

  const spec = parseTaskSpec(
    minimalContract({
      project: source,
      provider: { name: "openai", model, keychainService: "forklight.openai.api-key" },
      runtime: { name: "codex-cli", executable: script, effort, maxBudgetUsd: null },
      executionPreference: "auto",
      worker: { allowEdits, allowedCommands: [], focusPaths: ["src"] },
      ...(options.networkPolicy === undefined ? {} : { networkPolicy: options.networkPolicy }),
    }),
    source,
    policy(),
  ) as TaskSpec;
  assert.equal(spec.executionMode, "native-goal", "fixture must freeze native-goal");
  assert.equal(spec.worker.allowEdits, allowEdits);

  const task: TaskRecord = {
    id,
    name: spec.name,
    status: "running",
    sourcePath: source,
    taskFile: path.join(home, "task.yaml"),
    spec,
    paths,
    sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...(options.effectivePolicy === undefined ? {} : { effectivePolicy: options.effectivePolicy }),
  };
  store.createTask(task);
  const attempt: AttemptRecord = {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    taskId: id,
    ordinal: 1,
    status: "running",
    sessionId: task.sessionId,
    rawLogPath: path.join(paths.logs, "attempt-1.jsonl"),
    startedAt: "2026-08-01T00:00:00.000Z",
    runtimeBudgetUsd: null,
    runtimeBudgetEnforcement: "unsupported",
  };
  store.createAttempt(attempt);
  return {
    store,
    task,
    attempt,
    operatorCodexHome,
    requestLog,
    bindingPath: path.join(paths.root, "codex-goal-binding.json"),
    root,
    expectedPolicy: serverConfig.policy as FakeAppServerPolicy,
  };
}

/** Assert exact frozen Thread policy params (start or resume). */
function assertThreadPolicyParams(
  params: Record<string, unknown> | undefined,
  expected: FakeAppServerPolicy,
  options: { withThreadId?: string } = {},
): void {
  assert.ok(params, "thread policy params present");
  assert.equal(Object.prototype.hasOwnProperty.call(params, "workspace"), false, "ignored workspace field must be absent");
  assert.equal(params.cwd, expected.cwd);
  assert.equal(params.model, expected.model);
  assert.equal(params.approvalPolicy, "never");
  assert.equal(params.sandbox, expected.allowEdits ? "workspace-write" : "read-only");
  const keys = Object.keys(params).sort();
  if (options.withThreadId !== undefined) {
    assert.equal(params.threadId, options.withThreadId);
    assert.deepEqual(keys, ["approvalPolicy", "cwd", "model", "sandbox", "threadId"]);
  } else {
    assert.deepEqual(keys, ["approvalPolicy", "cwd", "model", "sandbox"]);
  }
  assert.ok(!JSON.stringify(params).includes("dangerFullAccess"));
  assert.ok(!JSON.stringify(params).includes("danger-full-access"));
}

/** Assert exact frozen Turn policy params for new and resumed execution. */
function assertTurnPolicyParams(
  params: Record<string, unknown> | undefined,
  expected: FakeAppServerPolicy,
  threadId: string,
): void {
  assert.ok(params, "turn policy params present");
  assert.equal(Object.prototype.hasOwnProperty.call(params, "workspace"), false, "ignored workspace field must be absent");
  assert.equal(params.threadId, threadId);
  assert.equal(params.cwd, expected.cwd);
  assert.equal(params.model, expected.model);
  assert.equal(params.effort, expected.effort);
  assert.equal(params.approvalPolicy, "never");
  const input = params.input as Array<{ type?: string; text?: string }> | undefined;
  assert.ok(Array.isArray(input) && input.length === 1 && input[0]?.type === "text");
  assert.equal(typeof input?.[0]?.text, "string");
  assert.deepEqual(
    Object.keys(params).sort(),
    ["approvalPolicy", "cwd", "effort", "input", "model", "sandboxPolicy", "threadId"],
  );
  const sandboxPolicy = params.sandboxPolicy as Record<string, unknown> | undefined;
  assert.ok(sandboxPolicy && typeof sandboxPolicy === "object");
  if (expected.allowEdits) {
    assert.deepEqual(sandboxPolicy, {
      type: "workspaceWrite",
      writableRoots: [expected.cwd],
      networkAccess: false,
    });
  } else {
    assert.deepEqual(sandboxPolicy, {
      type: "readOnly",
      networkAccess: false,
    });
    assert.equal(Object.prototype.hasOwnProperty.call(sandboxPolicy, "writableRoots"), false);
  }
  assert.ok(!JSON.stringify(params).includes("dangerFullAccess"));
  assert.ok(!JSON.stringify(params).includes("danger-full-access"));
}

async function readBindingJson(bindingPath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(bindingPath, "utf8")) as Record<string, unknown>;
}

async function waitForBindingTurnId(bindingPath: string, timeoutMs = 2_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const binding = await readBindingJson(bindingPath);
      if (typeof binding.turnId === "string" && binding.turnId.length > 0) return binding.turnId;
    } catch {
      // Initial binding has not reached its durable Turn write yet.
    }
    if (Date.now() >= deadline) throw new Error("timed out waiting for durable Turn binding");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function readRequestLog(requestLog: string): Promise<Array<Record<string, unknown>>> {
  let raw: string;
  try {
    raw = await readFile(requestLog, "utf8");
  } catch (error) {
    // The fake only creates the log on the first received line. A hung setup
    // killed before that first read must still be assertable as "no later
    // Thread request" without treating a missing log as a hard failure.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

/** Canonical `thread/tokenUsage/updated` params: bound threadId plus
 *  `tokenUsage.total` with camelCase counters. */
function goalUsageParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    threadId: "thread-1",
    tokenUsage: {
      total: {
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 40,
        cacheWriteInputTokens: 3,
      },
    },
    ...overrides,
  };
}

/** Canonical `turn/completed` params: bound threadId plus a nested turn object. */
function turnCompletedParams(
  status = "completed",
  turnId = "turn-1",
): Record<string, unknown> {
  return { threadId: "thread-1", turn: { id: turnId, status } };
}

/** Canonical `turn/started` params: bound threadId plus nested turn identity. */
function turnStartedParams(
  turnId = "turn-1",
  threadId = "thread-1",
): Record<string, unknown> {
  return { threadId, turn: { id: turnId } };
}

/** Exact current-Turn terminal join evidence for an explicit Turn id. */
function exactTurnTerminalAfter(
  turnId: string,
  options: {
    text?: string;
    usage?: Record<string, unknown>;
    extra?: Array<{ method?: string; params?: Record<string, unknown>; raw?: string }>;
  } = {},
): Array<{ method?: string; params?: Record<string, unknown>; raw?: string }> {
  return [
    ...(options.usage === undefined
      ? [{ method: "thread/tokenUsage/updated", params: goalUsageParams() }]
      : [{ method: "thread/tokenUsage/updated", params: options.usage }]),
    {
      method: "item/completed",
      params: itemCompletedParams({ turnId, text: options.text ?? "Implemented the change" }),
    },
    { method: "turn/completed", params: turnCompletedParams("completed", turnId) },
    { method: "thread/goal/updated", params: goalUpdatedParams("complete", { turnId }) },
    ...(options.extra ?? []),
  ];
}

/** Canonical `thread/goal/updated` params: bound threadId, current turnId, and Goal. */
function goalUpdatedParams(
  status: string,
  options: { turnId?: string | null; threadId?: string } = {},
): Record<string, unknown> {
  const threadId = options.threadId ?? "thread-1";
  const turnId = options.turnId === undefined ? "turn-1" : options.turnId;
  return {
    threadId,
    ...(turnId === null ? {} : { turnId }),
    goal: {
      threadId,
      objective: "native-goal-test",
      status,
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
    },
  };
}

/** Canonical app-server `item/completed` final-answer params. */
function itemCompletedParams(options: {
  turnId?: string | null;
  threadId?: string;
  text?: string;
  phase?: string | null;
  type?: string;
  omitPhase?: boolean;
} = {}): Record<string, unknown> {
  const item: Record<string, unknown> = {
    type: options.type ?? "agentMessage",
    text: options.text ?? "Implemented the change",
  };
  if (options.omitPhase !== true) {
    item.phase = options.phase === undefined ? "final_answer" : options.phase;
  }
  return {
    threadId: options.threadId ?? "thread-1",
    ...(options.turnId === null ? {} : { turnId: options.turnId ?? "turn-1" }),
    item,
  };
}

/** Private-looking app-server item ids used only in fixtures (never public). */
const PRIVATE_CMD_ITEM_ID = "item:/Users/me/secret-cmd-id";
const PRIVATE_FILE_ITEM_ID = "item:/Users/me/secret-file-id";

/** Canonical app-server tool item lifecycle params (commandExecution/fileChange). */
function itemLifecycleParams(
  method: "item/started" | "item/completed",
  options: {
    itemType?: "commandExecution" | "fileChange";
    itemId?: string;
    turnId?: string;
    threadId?: string;
    privateExtras?: Record<string, unknown>;
  } = {},
): { method: string; params: Record<string, unknown> } {
  const itemType = options.itemType ?? "commandExecution";
  const item: Record<string, unknown> = {
    id: options.itemId ?? (
      itemType === "commandExecution" ? PRIVATE_CMD_ITEM_ID : PRIVATE_FILE_ITEM_ID
    ),
    type: itemType,
    status: method === "item/started" ? "inProgress" : "completed",
    ...(options.privateExtras ?? (
      itemType === "commandExecution"
        ? { command: "sed -i '' 's/n = 1/n = 2/' src/hello.ts", cwd: "/private/workspace" }
        : {
            changes: [{ path: "src/hello.ts", kind: "update" }],
            output: "updated src/hello.ts",
          }
    )),
  };
  return {
    method,
    params: {
      threadId: options.threadId ?? "thread-1",
      turnId: options.turnId ?? "turn-1",
      item,
    },
  };
}

/** Canonical `item/agentMessage/delta` params with private streaming text. */
function agentMessageDeltaParams(
  delta: string,
  options: { itemId?: string; turnId?: string; threadId?: string } = {},
): Record<string, unknown> {
  return {
    threadId: options.threadId ?? "thread-1",
    turnId: options.turnId ?? "turn-1",
    itemId: options.itemId ?? "item-msg-1",
    delta,
  };
}

/** Canonical `turn/diff/updated` params with a private diff body. */
function turnDiffUpdatedParams(
  diff: string,
  options: { turnId?: string; threadId?: string } = {},
): Record<string, unknown> {
  return {
    threadId: options.threadId ?? "thread-1",
    turnId: options.turnId ?? "turn-1",
    diff,
  };
}

/** Exact current-Turn terminal join evidence in a realistic same-burst order. */
function exactCurrentTurnTerminalAfter(
  options: {
    usage?: Record<string, unknown>;
    text?: string;
    extra?: Array<{ method?: string; params?: Record<string, unknown>; raw?: string }>;
  } = {},
): Array<{ method?: string; params?: Record<string, unknown>; raw?: string }> {
  return [
    ...(options.usage === undefined
      ? [{ method: "thread/tokenUsage/updated", params: goalUsageParams() }]
      : [{ method: "thread/tokenUsage/updated", params: options.usage }]),
    {
      method: "item/completed",
      params: itemCompletedParams({ text: options.text ?? "Implemented the change" }),
    },
    { method: "turn/completed", params: turnCompletedParams() },
    { method: "thread/goal/updated", params: goalUpdatedParams("complete") },
    ...(options.extra ?? []),
  ];
}

/** Run one native Goal Worker to a genuine interruption and return the durable
 *  Thread binding it persisted before the first model Turn. */
async function runInterruptedNativeGoal(): Promise<Record<string, unknown>> {
  const fixture = await codexNativeGoalFixture();
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: { wasInterrupted: () => true },
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "interrupted");
    assert.equal(result.usage, undefined, "no usage invented on interruption");
    assert.equal(result.resultText, undefined, "no result invented on interruption");
  } finally {
    fixture.store.close();
  }
  return readBindingJson(fixture.bindingPath);
}

test("Codex native Goal handshakes initialize/initialized and creates one durable Thread Goal", async () => {
  const fixture = await codexNativeGoalFixture({
    config: {
      after: {
        "turn/start": exactCurrentTurnTerminalAfter(),
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "succeeded");
    assert.equal(result.resultText, "Implemented the change");
    assert.deepEqual(result.usage, {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadInputTokens: 40,
      cacheCreationInputTokens: 3,
      source: "terminal-result",
      complete: true,
    });

    // The fake rejects any Thread request before the mandatory handshake, so a
    // passing run proves initialize preceded every Thread request and that the
    // initialized notification was sent after a successful initialize.
    const requests = await readRequestLog(fixture.requestLog);
    assert.equal(requests[0]?.method, "initialize");
    assert.equal(requests[1]?.method, "initialized");
    assert.equal(requests[2]?.method, "thread/start");
    assert.equal(
      ((requests[0]?.params as { clientInfo?: { name?: string } } | undefined)?.clientInfo?.name),
      "forklight",
      "bounded client identity is sent with initialize",
    );
    assertThreadPolicyParams(
      requests[2]?.params as Record<string, unknown> | undefined,
      fixture.expectedPolicy,
    );
    const goalSet = requests.find((r) => r.method === "thread/goal/set");
    assert.deepEqual(
      (goalSet?.params as Record<string, unknown> | undefined)?.threadId,
      "thread-1",
    );
    assert.equal((goalSet?.params as Record<string, unknown> | undefined)?.status, "active");
    assert.equal((goalSet?.params as Record<string, unknown> | undefined)?.tokenBudget, null);
    const turnStart = requests.find((r) => r.method === "turn/start");
    assertTurnPolicyParams(
      turnStart?.params as Record<string, unknown> | undefined,
      fixture.expectedPolicy,
      "thread-1",
    );

    const events = fixture.store.listEvents(fixture.task.id);
    assert.ok(events.some((e) => e.type === "worker.started"), "worker.started persisted");
    assert.ok(events.some((e) => e.type === "worker.completed"), "worker.completed persisted");
    const started = events.find((e) => e.type === "worker.started");
    assert.equal((started?.payload as { threadId?: string } | undefined)?.threadId, "thread-1");
    assert.equal(
      (started?.payload as { goalId?: string } | undefined)?.goalId,
      undefined,
      "no invented goalId in this protocol",
    );
    const binding = await readBindingJson(fixture.bindingPath);
    assert.equal(binding.threadId, "thread-1", "durable binding persisted before the first model Turn");
    assert.equal(binding.goalId, undefined, "durable binding carries no invented goalId");
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal usage snapshots replace rather than add across continuations", async () => {
  const fixture = await codexNativeGoalFixture({
    config: {
      after: {
        "turn/start": [
          { method: "thread/tokenUsage/updated", params: goalUsageParams() },
          { method: "item/completed", params: itemCompletedParams() },
          { method: "turn/completed", params: turnCompletedParams() },
          { method: "thread/tokenUsage/updated", params: goalUsageParams({
            tokenUsage: { total: { inputTokens: 250, outputTokens: 50, cachedInputTokens: 90, cacheWriteInputTokens: 4 } },
          }) },
          { method: "thread/goal/updated", params: goalUpdatedParams("complete") },
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "succeeded");
    assert.equal(result.resultText, "Implemented the change");
    assert.equal(result.usage?.inputTokens, 250, "newest cumulative snapshot replaces earlier totals");
    assert.equal(result.usage?.outputTokens, 50);
    assert.equal(result.usage?.cacheReadInputTokens, 90);
    assert.equal(result.usage?.cacheCreationInputTokens, 4);
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal terminal non-success statuses fail the Worker with a stable reason", async () => {
  const blocked = await codexNativeGoalFixture({
    config: {
      after: {
        "turn/start": [
          { method: "thread/goal/updated", params: goalUpdatedParams("blocked") },
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: blocked.store,
      task: blocked.task,
      attempt: blocked.attempt,
      resuming: false,
      hooks: {},
    }, blocked.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.failureCategory, "runtime");
    assert.match(result.error ?? "", /blocked/);
    const failed = blocked.store.listEvents(blocked.task.id).find((e) => e.type === "worker.failed");
    assert.equal((failed?.payload as { reasonCode?: string } | undefined)?.reasonCode, "codex-goal-stopped");
  } finally {
    blocked.store.close();
  }

  const paused = await codexNativeGoalFixture({
    config: {
      after: {
        "turn/start": [
          { method: "thread/goal/updated", params: goalUpdatedParams("paused") },
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: paused.store,
      task: paused.task,
      attempt: paused.attempt,
      resuming: false,
      hooks: {},
    }, paused.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /paused/);
  } finally {
    paused.store.close();
  }
});

test("Codex native Goal malformed protocol fails closed", async () => {
  const fixture = await codexNativeGoalFixture({
    config: {
      after: {
        "turn/start": [{ raw: "not-json" }],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.failureCategory, "runtime");
    assert.match(result.error ?? "", /malformed JSON-RPC/);
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal accepts installed envelope-less app-server shapes", async () => {
  // Default fake emits installed Codex 0.146.0 envelopes: id/result responses
  // and method/params notifications without jsonrpc (notifications carry
  // non-authoritative emittedAtMs). A full success path proves request
  // correlation through initialize/thread/turn and notification routing for
  // usage + exact current-Turn terminal join evidence.
  const fixture = await codexNativeGoalFixture({
    config: {
      after: {
        "turn/start": exactCurrentTurnTerminalAfter(),
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "succeeded");
    assert.equal(result.resultText, "Implemented the change");
    assert.deepEqual(result.usage, {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadInputTokens: 40,
      cacheCreationInputTokens: 3,
      source: "terminal-result",
      complete: true,
    });
    const requests = await readRequestLog(fixture.requestLog);
    assert.equal(requests[0]?.method, "initialize");
    assert.equal(requests[0]?.jsonrpc, "2.0", "outbound requests still send jsonrpc 2.0");
    assert.ok(requests.some((r) => r.method === "turn/start"), "handshake correlated through turn/start");
    const binding = await readBindingJson(fixture.bindingPath);
    assert.equal(binding.threadId, "thread-1");
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal still accepts explicit jsonrpc 2.0 envelopes", async () => {
  const fixture = await codexNativeGoalFixture({
    config: {
      includeJsonrpc: true,
      after: {
        "turn/start": exactCurrentTurnTerminalAfter(),
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "succeeded");
    assert.equal(result.resultText, "Implemented the change");
    assert.equal(result.usage?.inputTokens, 100);
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal rejects wrong or ambiguous app-server envelopes", async () => {
  // Wrong explicit protocol version fails closed (does not route as notification).
  const wrongVersion = await codexNativeGoalFixture({
    config: {
      after: {
        "turn/start": [
          {
            raw: JSON.stringify({
              jsonrpc: "1.0",
              method: "thread/goal/updated",
              params: goalUpdatedParams("complete"),
            }),
          },
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: wrongVersion.store,
      task: wrongVersion.task,
      attempt: wrongVersion.attempt,
      resuming: false,
      hooks: {},
    }, wrongVersion.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.failureCategory, "runtime");
    assert.match(result.error ?? "", /invalid JSON-RPC envelope/);
  } finally {
    wrongVersion.store.close();
  }

  // Ambiguous hybrid carrying both response id and notification method fails closed.
  const ambiguous = await codexNativeGoalFixture({
    config: {
      after: {
        "turn/start": [
          {
            raw: JSON.stringify({
              id: 1,
              method: "thread/goal/updated",
              params: goalUpdatedParams("complete"),
              result: {},
            }),
          },
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: ambiguous.store,
      task: ambiguous.task,
      attempt: ambiguous.attempt,
      resuming: false,
      hooks: {},
    }, ambiguous.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /invalid JSON-RPC envelope/);
  } finally {
    ambiguous.store.close();
  }

  // Malformed response id type fails closed (not correlated, not ignored).
  const badId = await codexNativeGoalFixture({
    config: {
      after: {
        "turn/start": [
          { raw: JSON.stringify({ id: "1", result: { ok: true } }) },
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: badId.store,
      task: badId.task,
      attempt: badId.attempt,
      resuming: false,
      hooks: {},
    }, badId.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /invalid JSON-RPC envelope/);
  } finally {
    badId.store.close();
  }

  // Unknown response id still fails closed after envelope acceptance.
  const unknownId = await codexNativeGoalFixture({
    config: {
      after: {
        "turn/start": [
          { raw: JSON.stringify({ id: 99999, result: { ok: true } }) },
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: unknownId.store,
      task: unknownId.task,
      attempt: unknownId.attempt,
      resuming: false,
      hooks: {},
    }, unknownId.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /unknown request id 99999/);
  } finally {
    unknownId.store.close();
  }

  // Non-object notification params fail closed (payload validation).
  const badParams = await codexNativeGoalFixture({
    config: {
      after: {
        "turn/start": [
          { raw: JSON.stringify({ method: "thread/goal/updated", params: "not-an-object" }) },
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: badParams.store,
      task: badParams.task,
      attempt: badParams.attempt,
      resuming: false,
      hooks: {},
    }, badParams.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /invalid JSON-RPC envelope/);
  } finally {
    badParams.store.close();
  }
});

test("Codex native Goal malformed usage evidence fails closed", async () => {
  const fixture = await codexNativeGoalFixture({
    config: {
      after: {
        "turn/start": [
          {
            method: "thread/tokenUsage/updated",
            params: { threadId: "thread-1", tokenUsage: { total: { inputTokens: 10, cachedInputTokens: 12, outputTokens: 2 } } },
          },
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.failureCategory, "runtime");
    assert.match(result.error ?? "", /malformed usage evidence/);
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal interruption resumes the exact durable Thread", async () => {
  // Run 1: a genuine native Goal interrupted before any terminal Goal evidence.
  const binding = await runInterruptedNativeGoal();
  assert.equal(binding.threadId, "thread-1");
  assert.equal(binding.goalId, undefined, "no invented goalId in the durable binding");

  // Run 2: resume the exact Thread with the same durable binding. The fake
  // rejects any Thread request before initialize/initialized, so a passing
  // resume proves the new connection handshook before resuming.
  const second = await codexNativeGoalFixture({
    config: {
      objective: binding.objective as string,
      goalStatus: "active",
      after: {
        "turn/start": exactCurrentTurnTerminalAfter({ text: "Resumed and finished" }),
      },
    },
  });
  await writeFile(second.bindingPath, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600 });
  try {
    const result = await runCodexWorker({
      store: second.store,
      task: second.task,
      attempt: second.attempt,
      resuming: true,
      hooks: {},
    }, second.operatorCodexHome);
    assert.equal(result.status, "succeeded");
    assert.equal(result.resultText, "Resumed and finished");
    const events = second.store.listEvents(second.task.id);
    const resumed = events.find((e) => e.type === "worker.resumed");
    assert.ok(resumed, "worker.resumed persisted");
    assert.equal((resumed?.payload as { threadId?: string } | undefined)?.threadId, "thread-1");
    const requests = await readRequestLog(second.requestLog);
    const resumeReq = requests.find((r) => r.method === "thread/resume");
    assertThreadPolicyParams(
      resumeReq?.params as Record<string, unknown> | undefined,
      second.expectedPolicy,
      { withThreadId: "thread-1" },
    );
    const goalGet = requests.find((r) => r.method === "thread/goal/get");
    assert.equal((goalGet?.params as { threadId?: string } | undefined)?.threadId, "thread-1",
      "Goal read targets the exact durable Thread");
    const turnStart = requests.find((r) => r.method === "turn/start");
    assertTurnPolicyParams(
      turnStart?.params as Record<string, unknown> | undefined,
      second.expectedPolicy,
      "thread-1",
    );
    const persisted = await readBindingJson(second.bindingPath);
    assert.equal(persisted.threadId, "thread-1", "resume retains the exact binding");
  } finally {
    second.store.close();
  }
});

test("system restart continuation resumes the exact native Goal under baseMaxAttempts=1", async () => {
  // Frozen single-base-attempt policy: ordinary resume without a system grant
  // is rejected. The restart grant is infrastructure continuity, not a quality
  // retry or Main correction.
  const values = {
    ...testDefaultAdvancedPolicy(),
    baseMaxAttempts: 1,
    maxExtraAttempts: 0,
    maxMainCorrections: 0,
  };
  const provenance = Object.fromEntries(
    Object.keys(values).map((field) => [field, "task"]),
  ) as Record<keyof typeof values, "task">;
  // Interrupt first so the durable Thread binding exists, then resume on a
  // second spawn of the same fake with goalStatus active.
  const binding = await runInterruptedNativeGoal();
  assert.equal(binding.threadId, "thread-1");

  const fixture = await codexNativeGoalFixture({
    config: {
      objective: binding.objective as string,
      goalStatus: "active",
      after: {
        "turn/start": exactCurrentTurnTerminalAfter({
          text: "Restart continuation finished",
        }),
      },
    },
    effectivePolicy: {
      profileId: "test",
      values,
      provenance,
      enforcementCapability: enforcementCapabilityForRuntime("codex-cli"),
    },
  });
  try {
    // Reconstruct the interrupted Attempt/Task on this store so resumeTask
    // and authorization see the same lineage as a post-shutdown Daemon.
    const taskId = fixture.task.id;
    const sessionId = fixture.task.sessionId;
    const now = new Date().toISOString();
    fixture.store.updateAttempt(fixture.attempt.id, {
      status: "interrupted",
      finishedAt: now,
      exitCode: 130,
      error: "Worker execution interrupted",
    });
    fixture.store.setTaskStatus(taskId, "interrupted", {
      currentAttemptId: fixture.attempt.id,
      finishedAt: now,
      workerPid: null,
      error: "Worker execution interrupted",
    });
    await writeFile(
      fixture.bindingPath,
      `${JSON.stringify(binding, null, 2)}\n`,
      { mode: 0o600 },
    );
    await mkdir(fixture.task.paths.workspace, { recursive: true, mode: 0o700 });

    // Without the system grant, baseMaxAttempts=1 blocks any further Attempt.
    // resumeTask rejects before launching a Worker (no doctor / Provider call).
    await assert.rejects(
      () => resumeTask(fixture.store, taskId),
      /maximum attempts/,
    );

    const grant = authorizeSystemRestartRecovery(fixture.store, taskId, 1);
    assert.ok(grant !== null, "system restart grant required when baseMaxAttempts=1");
    assert.equal(grant!.maximumOrdinal, 2);
    const grantPayload = fixture.store.listEvents(taskId)
      .find((e) => e.type === "attempt.authorization.granted")!
      .payload as Record<string, unknown>;
    assert.equal(grantPayload.reason, "system-daemon-restart");
    assert.equal(grantPayload.priorAttemptId, fixture.attempt.id);
    assert.equal(grantPayload.handoffId, undefined);

    // Continuation Attempt under the system grant: same Task/workspace/session,
    // exact Thread resume. Use the Runtime adapter path directly (deterministic
    // fake app-server) the same way Coordinator → resumeTask → adapter does.
    const attempt2: AttemptRecord = {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      taskId,
      ordinal: 2,
      status: "running",
      sessionId,
      rawLogPath: path.join(fixture.task.paths.logs, "attempt-2.jsonl"),
      startedAt: now,
      runtimeBudgetUsd: null,
      runtimeBudgetEnforcement: "unsupported",
    };
    fixture.store.createAttempt(attempt2);
    fixture.store.setTaskStatus(taskId, "running", {
      currentAttemptId: attempt2.id,
      finishedAt: null,
      workerPid: null,
      error: null,
    });
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.store.getTask(taskId),
      attempt: attempt2,
      resuming: true,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "succeeded");
    assert.equal(result.resultText, "Restart continuation finished");
    assert.equal(fixture.store.listAttempts(taskId).length, 2);
    assert.equal(fixture.store.listTasks().length, 1, "no replacement Task");
    assert.equal(fixture.store.getTask(taskId).sessionId, sessionId);

    const events = fixture.store.listEvents(taskId);
    assert.ok(events.some((e) => e.type === "worker.resumed"), "worker.resumed");
    assert.equal(
      events.filter((e) => e.type === "attempt.authorization.granted").length,
      1,
      "exactly one infrastructure grant",
    );
    const requests = await readRequestLog(fixture.requestLog);
    const resumeReq = requests.find((r) => r.method === "thread/resume");
    assertThreadPolicyParams(
      resumeReq?.params as Record<string, unknown> | undefined,
      fixture.expectedPolicy,
      { withThreadId: "thread-1" },
    );
    assert.equal(
      requests.some((r) => r.method === "thread/start"),
      false,
      "restart continuation must not create a fresh Thread",
    );
    const persisted = await readBindingJson(fixture.bindingPath);
    assert.equal(persisted.threadId, "thread-1", "exact Thread binding retained");
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal identity drift on resume fails closed", async () => {
  // The exact durable Thread binding is retained and carried into the resumed
  // Task so identity drift is measured against the authoritative evidence.
  const binding = await runInterruptedNativeGoal();
  const second = await codexNativeGoalFixture({
    config: {
      responders: {
        "thread/goal/get": {
          result: {
            goal: {
              threadId: "thread-1",
              objective: "different-objective",
              status: "active",
              tokenBudget: null,
              tokensUsed: 0,
              timeUsedSeconds: 0,
            },
          },
        },
      },
    },
  });
  await writeFile(second.bindingPath, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600 });
  try {
    const result = await runCodexWorker({
      store: second.store,
      task: second.task,
      attempt: second.attempt,
      resuming: true,
      hooks: {},
    }, second.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.failureCategory, "runtime");
    assert.match(result.error ?? "", /identity drift/);
  } finally {
    second.store.close();
  }
});

test("Codex native Goal resume without a durable binding fails closed", async () => {
  const fixture = await codexNativeGoalFixture();
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: true,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.failureCategory, "runtime");
    assert.match(result.error ?? "", /no durable Thread binding/);
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal resume fails closed when the persisted Goal cannot continue", async () => {
  const binding = await runInterruptedNativeGoal();
  const second = await codexNativeGoalFixture({
    config: { objective: binding.objective as string, goalStatus: "complete" },
  });
  await writeFile(second.bindingPath, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600 });
  try {
    const result = await runCodexWorker({
      store: second.store,
      task: second.task,
      attempt: second.attempt,
      resuming: true,
      hooks: {},
    }, second.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /cannot continue/);
  } finally {
    second.store.close();
  }
});

// --- Completed-Goal Main correction (FL-112E4) ---

/** Canonical typed Main-correction intent used by the deterministic fixtures. */
function correctionIntent42(): import("../src/workers/types.js").CorrectionExecutionIntent {
  return { kind: "main-correction", authorizationEventSequence: 42 };
}

/** Durable original binding for a completed original Goal (no correction unit). */
async function completedOriginalBinding(): Promise<Record<string, unknown>> {
  return runInterruptedNativeGoal();
}

test("Codex native Goal structured correction crosses a prior complete Goal on the exact Thread", async () => {
  // Original Goal completed; Main authorized one structured correction. The
  // adapter must reuse the exact durable Thread and start one fresh bounded
  // app-server execution unit instead of failing on the complete Goal. The
  // installed app-server emits no repeated Goal-complete notification for the
  // correction Turn because the persisted Goal is already complete, so the
  // exact current-Turn completion plus its own canonical final output must
  // close the Worker without a second Goal update. The short no-progress
  // backstop turns a regression into a fast no-progress failure instead of a
  // 30-minute hang.
  const values = { ...testDefaultAdvancedPolicy(), noProgressTimeoutMs: 4_000, workerStopGraceMs: 40 };
  const provenance = Object.fromEntries(
    Object.keys(values).map((field) => [field, "task"]),
  ) as Record<keyof typeof values, "task">;
  const binding = await completedOriginalBinding();
  const fixture = await codexNativeGoalFixture({
    effectivePolicy: {
      profileId: "test",
      values,
      provenance,
      enforcementCapability: enforcementCapabilityForRuntime("codex-cli"),
    },
    config: {
      objective: binding.objective as string,
      goalStatus: "complete",
      batchAfter: ["turn/start"],
      after: {
        "turn/start": [
          { method: "thread/tokenUsage/updated", params: goalUsageParams() },
          { method: "item/completed", params: itemCompletedParams({ text: "Correction finished" }) },
          { method: "turn/completed", params: turnCompletedParams() },
        ],
      },
    },
  });
  await writeFile(fixture.bindingPath, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600 });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: true,
      hooks: {
        feedback: "Canonical structured correction instruction",
        correctionIntent: correctionIntent42(),
      },
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "succeeded", "correction closes on its exact Turn without a repeated Goal-complete");
    assert.equal(result.resultText, "Correction finished");
    assert.deepEqual(result.usage, {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadInputTokens: 40,
      cacheCreationInputTokens: 3,
      source: "terminal-result",
      complete: true,
    });

    const requests = await readRequestLog(fixture.requestLog);
    assert.ok(requests.some((r) => r.method === "thread/resume"), "correction resumes the exact Thread");
    assert.ok(requests.some((r) => r.method === "thread/goal/get"), "correction verifies the prior Goal identity");
    assert.equal(
      requests.some((r) => r.method === "thread/goal/set"),
      false,
      "completed Goal status is never reset to active",
    );
    assert.ok(requests.some((r) => r.method === "turn/start"), "fresh correction Turn starts on the same Thread");
    assert.equal(requests.some((r) => r.method === "thread/start"), false, "no new Thread is created");

    const persisted = await readBindingJson(fixture.bindingPath);
    assert.equal(persisted.threadId, "thread-1", "exact Thread retained");
    assert.equal(persisted.correctionUnit, true, "fresh correction unit durably bound");
    assert.equal(persisted.authorizationEventSequence, 42, "grant identity durably bound");

    const events = fixture.store.listEvents(fixture.task.id);
    const resumed = events.find((e) => e.type === "worker.resumed");
    assert.ok(resumed, "worker.resumed persisted");
    assert.equal(
      (resumed?.payload as { correctionUnit?: unknown }).correctionUnit,
      true,
      "evidence distinguishes completed-Goal correction from ordinary resume",
    );
    assert.equal(events.filter((e) => e.type === "worker.completed").length, 1);
    // A terminal correction Turn with its own final output is never narrated as
    // "continuing": the join closes the Worker once.
    assert.ok(
      !events.some((e) => (e.payload as { activityKind?: string } | undefined)?.activityKind === "goal-continuing"),
      "terminal correction Turn is not narrated as continuing",
    );
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal ordinary resume keeps strict Goal-complete join", async () => {
  // Mirrors the correction Turn but without any correction authority: the
  // resumed active Goal completes its Turn with final output and no current-Turn
  // Goal-complete event. Ordinary Goal success stays closed and the existing
  // no-progress watchdog applies.
  const values = { ...testDefaultAdvancedPolicy(), noProgressTimeoutMs: 4_000, workerStopGraceMs: 40 };
  const provenance = Object.fromEntries(
    Object.keys(values).map((field) => [field, "task"]),
  ) as Record<keyof typeof values, "task">;
  const binding = await completedOriginalBinding();
  const fixture = await codexNativeGoalFixture({
    effectivePolicy: {
      profileId: "test",
      values,
      provenance,
      enforcementCapability: enforcementCapabilityForRuntime("codex-cli"),
    },
    config: {
      objective: binding.objective as string,
      goalStatus: "active",
      batchAfter: ["turn/start"],
      after: {
        "turn/start": [
          { method: "thread/tokenUsage/updated", params: goalUsageParams() },
          { method: "item/completed", params: itemCompletedParams() },
          { method: "turn/completed", params: turnCompletedParams() },
        ],
      },
    },
  });
  await writeFile(fixture.bindingPath, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600 });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: true,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.policyLimit?.category, "no-progress");
    assert.equal(result.resultText, undefined, "ordinary resume cannot close without current-Turn Goal-complete evidence");
    assert.ok(!fixture.store.listEvents(fixture.task.id).some((e) => e.type === "worker.completed"));
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal correction without canonical final output stays fail-closed", async () => {
  // The correction unit is admitted across the completed Goal, but the exact
  // Turn completes without its own canonical final output. Correction terminal
  // authority never invents success: the join stays closed and the existing
  // no-progress policy terminates the Worker.
  const values = { ...testDefaultAdvancedPolicy(), noProgressTimeoutMs: 4_000, workerStopGraceMs: 40 };
  const provenance = Object.fromEntries(
    Object.keys(values).map((field) => [field, "task"]),
  ) as Record<keyof typeof values, "task">;
  const binding = await completedOriginalBinding();
  const fixture = await codexNativeGoalFixture({
    effectivePolicy: {
      profileId: "test",
      values,
      provenance,
      enforcementCapability: enforcementCapabilityForRuntime("codex-cli"),
    },
    config: {
      objective: binding.objective as string,
      goalStatus: "complete",
      batchAfter: ["turn/start"],
      after: {
        "turn/start": [
          { method: "thread/tokenUsage/updated", params: goalUsageParams() },
          { method: "turn/completed", params: turnCompletedParams() },
        ],
      },
    },
  });
  await writeFile(fixture.bindingPath, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600 });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: true,
      hooks: { correctionIntent: correctionIntent42() },
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.policyLimit?.category, "no-progress");
    assert.equal(result.resultText, undefined, "missing final output never invents success");
    assert.ok(!fixture.store.listEvents(fixture.task.id).some((e) => e.type === "worker.completed"));
    const persisted = await readBindingJson(fixture.bindingPath);
    assert.equal(persisted.correctionUnit, true, "authority was durably bound but never invented success");
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal correction failed or interrupted Turn cannot join", async () => {
  // The exact correction Turn reports failed/interrupted even with a final item.
  // Exact current-Turn completion is required; a failed/interrupted Turn never
  // succeeds under correction authority.
  const values = { ...testDefaultAdvancedPolicy(), noProgressTimeoutMs: 4_000, workerStopGraceMs: 40 };
  const provenance = Object.fromEntries(
    Object.keys(values).map((field) => [field, "task"]),
  ) as Record<keyof typeof values, "task">;
  for (const status of ["failed", "interrupted"] as const) {
    const binding = await completedOriginalBinding();
    const fixture = await codexNativeGoalFixture({
      effectivePolicy: {
        profileId: "test",
        values,
        provenance,
        enforcementCapability: enforcementCapabilityForRuntime("codex-cli"),
      },
      config: {
        objective: binding.objective as string,
        goalStatus: "complete",
        batchAfter: ["turn/start"],
        after: {
          "turn/start": [
            { method: "thread/tokenUsage/updated", params: goalUsageParams() },
            { method: "item/completed", params: itemCompletedParams() },
            { method: "turn/completed", params: turnCompletedParams(status) },
          ],
        },
      },
    });
    await writeFile(fixture.bindingPath, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600 });
    try {
      const result = await runCodexWorker({
        store: fixture.store,
        task: fixture.task,
        attempt: fixture.attempt,
        resuming: true,
        hooks: { correctionIntent: correctionIntent42() },
      }, fixture.operatorCodexHome);
      assert.equal(result.status, "failed");
      assert.equal(result.policyLimit?.category, "no-progress");
      assert.equal(result.resultText, undefined, `correction Turn ${status} never produces success`);
      assert.ok(!fixture.store.listEvents(fixture.task.id).some((e) => e.type === "worker.completed"));
    } finally {
      fixture.store.close();
    }
  }
});

test("Codex native Goal correction stale Turn completion cannot join", async () => {
  // The final item belongs to the exact current Turn, but the Turn completion
  // carries a different (stale) Turn id. Exact current-Turn completion is
  // required, so the join stays closed and the no-progress policy terminates.
  const values = { ...testDefaultAdvancedPolicy(), noProgressTimeoutMs: 4_000, workerStopGraceMs: 40 };
  const provenance = Object.fromEntries(
    Object.keys(values).map((field) => [field, "task"]),
  ) as Record<keyof typeof values, "task">;
  const binding = await completedOriginalBinding();
  const fixture = await codexNativeGoalFixture({
    effectivePolicy: {
      profileId: "test",
      values,
      provenance,
      enforcementCapability: enforcementCapabilityForRuntime("codex-cli"),
    },
    config: {
      objective: binding.objective as string,
      goalStatus: "complete",
      batchAfter: ["turn/start"],
      after: {
        "turn/start": [
          { method: "thread/tokenUsage/updated", params: goalUsageParams() },
          { method: "item/completed", params: itemCompletedParams() },
          { method: "turn/completed", params: turnCompletedParams("completed", "turn-stale") },
        ],
      },
    },
  });
  await writeFile(fixture.bindingPath, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600 });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: true,
      hooks: { correctionIntent: correctionIntent42() },
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.policyLimit?.category, "no-progress");
    assert.equal(result.resultText, undefined, "stale Turn completion cannot close the correction");
    assert.ok(!fixture.store.listEvents(fixture.task.id).some((e) => e.type === "worker.completed"));
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal completed-Goal correction without typed authority stays closed", async () => {
  // Same persisted complete Goal, no pending Main correction grant being
  // consumed: ordinary resume must still fail closed and create no unit.
  const binding = await completedOriginalBinding();
  const second = await codexNativeGoalFixture({
    config: { objective: binding.objective as string, goalStatus: "complete" },
  });
  await writeFile(second.bindingPath, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600 });
  try {
    const result = await runCodexWorker({
      store: second.store,
      task: second.task,
      attempt: second.attempt,
      resuming: true,
      hooks: {},
    }, second.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.failureCategory, "runtime");
    assert.match(result.error ?? "", /cannot continue/);
    const failed = second.store.listEvents(second.task.id).find((e) => e.type === "worker.failed");
    assert.equal((failed?.payload as { reasonCode?: string } | undefined)?.reasonCode, "codex-goal-not-continuable");
    assert.equal(
      (await readRequestLog(second.requestLog)).some((r) => r.method === "thread/goal/set"),
      false,
      "no fresh unit without correction authority",
    );
  } finally {
    second.store.close();
  }
});

test("Codex native Goal completed correction unit never starts a second unit", async () => {
  // A fresh correction unit is durably active and its Goal also reports
  // complete. Even with a matching typed intent, recovery must not start
  // another unit; it fails closed instead.
  const binding = await completedOriginalBinding();
  const durable = { ...binding, correctionUnit: true, authorizationEventSequence: 42 };
  const fixture = await codexNativeGoalFixture({
    config: {
      objective: binding.objective as string,
      goalStatus: "complete",
    },
  });
  await writeFile(fixture.bindingPath, `${JSON.stringify(durable, null, 2)}\n`, { mode: 0o600 });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: true,
      hooks: {
        correctionIntent: correctionIntent42(),
      },
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.failureCategory, "runtime");
    assert.match(result.error ?? "", /cannot continue/);
    const requests = await readRequestLog(fixture.requestLog);
    assert.equal(requests.some((r) => r.method === "thread/goal/set"), false, "no second unit starts");
    assert.equal(requests.some((r) => r.method === "turn/start"), false, "no model work starts");
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal correction restart recovers the exact correction unit once", async () => {
  // Run 1: an authorized correction starts a fresh unit and is interrupted
  // before terminal evidence. The fresh unit identity is durably bound.
  const binding = await completedOriginalBinding();
  const first = await codexNativeGoalFixture({
    config: {
      objective: binding.objective as string,
      goalStatus: "complete",
    },
  });
  await writeFile(first.bindingPath, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600 });
  let correctionBinding: Record<string, unknown> = {};
  try {
    const result = await runCodexWorker({
      store: first.store,
      task: first.task,
      attempt: first.attempt,
      resuming: true,
      hooks: {
        wasInterrupted: () => true,
        correctionIntent: correctionIntent42(),
      },
    }, first.operatorCodexHome);
    assert.equal(result.status, "interrupted");
  } finally {
    correctionBinding = await readBindingJson(first.bindingPath);
    first.store.close();
  }
  assert.equal(correctionBinding.correctionUnit, true, "fresh unit durably bound before interrupt");
  assert.equal(correctionBinding.authorizationEventSequence, 42);

  // Run 2: daemon restart recovery resumes that exact correction unit once.
  // The recovery path re-reads the durable restart grant and resumes via
  // resumeTask (no typed correction intent). The persisted Goal is still
  // complete — the real App Server emits no repeated Goal-complete — so the
  // adapter must restore correction terminal authority from the durable unit,
  // resume the same Thread/unit, and close only after the exact new Turn plus
  // its own canonical final output. A short no-progress backstop turns any
  // regression into a fast failure instead of a 30-minute wait.
  const values = { ...testDefaultAdvancedPolicy(), noProgressTimeoutMs: 4_000, workerStopGraceMs: 40 };
  const provenance = Object.fromEntries(
    Object.keys(values).map((field) => [field, "task"]),
  ) as Record<keyof typeof values, "task">;
  const second = await codexNativeGoalFixture({
    effectivePolicy: {
      profileId: "test",
      values,
      provenance,
      enforcementCapability: enforcementCapabilityForRuntime("codex-cli"),
    },
    config: {
      objective: binding.objective as string,
      goalStatus: "complete",
      batchAfter: ["turn/start"],
      after: {
        "turn/start": [
          { method: "thread/tokenUsage/updated", params: goalUsageParams() },
          { method: "item/completed", params: itemCompletedParams({ text: "Correction unit resumed after restart" }) },
          { method: "turn/completed", params: turnCompletedParams() },
        ],
      },
    },
  });
  await writeFile(second.bindingPath, `${JSON.stringify(correctionBinding, null, 2)}\n`, { mode: 0o600 });
  try {
    const result = await runCodexWorker({
      store: second.store,
      task: second.task,
      attempt: second.attempt,
      resuming: true,
      hooks: {},
    }, second.operatorCodexHome);
    assert.equal(result.status, "succeeded", "restart recovery closes on its exact Turn without a repeated Goal-complete");
    assert.equal(result.resultText, "Correction unit resumed after restart");
    const requests = await readRequestLog(second.requestLog);
    assert.ok(requests.some((r) => r.method === "thread/resume"), "recovery resumes the exact Thread");
    assert.equal(requests.some((r) => r.method === "thread/goal/set"), false, "recovery must not start another unit or relabel the Goal");
    assert.equal(requests.some((r) => r.method === "thread/start"), false, "recovery must not create a Thread");
    const persisted = await readBindingJson(second.bindingPath);
    assert.equal(persisted.threadId, "thread-1", "exact Thread retained across recovery");
    assert.equal(persisted.correctionUnit, true, "correction marker retained across recovery");
    assert.equal(persisted.authorizationEventSequence, 42, "grant identity retained across recovery");
    const events = second.store.listEvents(second.task.id);
    const resumed = events.find((e) => e.type === "worker.resumed");
    assert.ok(resumed, "worker.resumed persisted for recovery");
    assert.match(resumed.summary, /recovered the in-progress Main correction unit/);
    assert.equal(
      (resumed?.payload as { correctionUnit?: unknown }).correctionUnit,
      true,
      "recovery restores the same correction unit, not a fresh admission",
    );
    assert.equal(events.filter((e) => e.type === "worker.completed").length, 1, "closes once");
    assert.ok(
      !events.some((e) => (e.payload as { activityKind?: string } | undefined)?.activityKind === "goal-continuing"),
      "recovered terminal correction Turn is not narrated as continuing",
    );
  } finally {
    second.store.close();
  }
});

test("Codex native Goal correction identity drift fails closed", async () => {
  // Bound correction grant identity differs from the grant being consumed:
  // no model work may start and no second unit may be created.
  const binding = await completedOriginalBinding();
  const durable = { ...binding, correctionUnit: true, authorizationEventSequence: 42 };
  const fixture = await codexNativeGoalFixture({
    config: {
      objective: binding.objective as string,
      goalStatus: "active",
      after: { "turn/start": exactCurrentTurnTerminalAfter() },
    },
  });
  await writeFile(fixture.bindingPath, `${JSON.stringify(durable, null, 2)}\n`, { mode: 0o600 });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: true,
      hooks: {
        correctionIntent: { kind: "main-correction", authorizationEventSequence: 99 },
      },
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.failureCategory, "runtime");
    assert.match(result.error ?? "", /identity drift/);
    const requests = await readRequestLog(fixture.requestLog);
    assert.equal(requests.some((r) => r.method === "turn/start"), false, "no model work starts on drift");
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal malformed correction binding fails closed before model work", async () => {
  // The correction identity is one inseparable strict positive safe-integer
  // pair. An orphaned marker, a missing/negative/fractional sequence, or a
  // sequence without the marker is malformed and must never resume or start a
  // unit. Each case shares one fresh original binding.
  const original = await completedOriginalBinding();
  const malformedBindings: Array<Record<string, unknown>> = [
    { ...original, correctionUnit: true },
    { ...original, correctionUnit: true, authorizationEventSequence: 0 },
    { ...original, correctionUnit: true, authorizationEventSequence: -5 },
    { ...original, correctionUnit: true, authorizationEventSequence: 1.5 },
    { ...original, correctionUnit: true, authorizationEventSequence: Number.NaN },
    { ...original, authorizationEventSequence: 42 },
    { ...original, unexpected: true },
    { ...original, updatedAt: null },
  ];
  for (const malformed of malformedBindings) {
    const fixture = await codexNativeGoalFixture({
      config: { objective: original.objective as string, goalStatus: "complete" },
    });
    await writeFile(fixture.bindingPath, `${JSON.stringify(malformed, null, 2)}\n`, { mode: 0o600 });
    try {
      const result = await runCodexWorker({
        store: fixture.store,
        task: fixture.task,
        attempt: fixture.attempt,
        resuming: true,
        hooks: {
          correctionIntent: correctionIntent42(),
        },
      }, fixture.operatorCodexHome);
      assert.equal(result.status, "failed");
      assert.equal(result.failureCategory, "runtime");
      assert.match(result.error ?? "", /binding is invalid/);
      assert.equal(
        (await readRequestLog(fixture.requestLog)).some((r) => r.method === "turn/start"),
        false,
        "malformed binding starts no model work",
      );
    } finally {
      fixture.store.close();
    }
  }
});

test("Codex native Goal malformed repair binding fails closed before model work", async () => {
  // An authorization sequence without a repair-unit marker is the concrete
  // malformed durable shape that previously risked being interpreted as an
  // ordinary resume. It must be rejected by the binding parser before the
  // exact Thread is resumed, and the process must exit naturally without a
  // watchdog-dependent pending request.
  const original = await completedOriginalBinding();
  const malformedBindings: Array<Record<string, unknown>> = [
    { ...original, authorizationEventSequence: 42 },
    { ...original, repairUnit: true },
    { ...original, repairUnit: true, authorizationEventSequence: 42 },
  ];
  for (const malformed of malformedBindings) {
    const fixture = await codexNativeGoalFixture({
      config: { objective: original.objective as string, goalStatus: "complete" },
    });
    await writeFile(fixture.bindingPath, `${JSON.stringify(malformed, null, 2)}\n`, { mode: 0o600 });
    try {
      const result = await runCodexWorker({
        store: fixture.store,
        task: fixture.task,
        attempt: fixture.attempt,
        resuming: true,
        hooks: {
          validationRepairIntent: {
            kind: "worker-validation-repair",
            authorizationEventSequence: 42,
            round: 1,
            attemptId: fixture.attempt.id,
          },
        },
      }, fixture.operatorCodexHome);
      assert.equal(result.status, "failed");
      assert.equal(result.failureCategory, "runtime");
      assert.match(result.error ?? "", /binding is invalid/);
      const requests = await readRequestLog(fixture.requestLog);
      assert.equal(requests.some((r) => r.method === "thread/resume"), false, "no Thread resume starts");
      assert.equal(requests.some((r) => r.method === "thread/goal/get"), false, "no Goal lookup starts");
      assert.equal(requests.some((r) => r.method === "turn/start"), false, "no model work starts");
    } finally {
      fixture.store.close();
    }
  }
});

test("Codex native Goal correction keeps cumulative same-Thread usage replace-not-add", async () => {
  const binding = await completedOriginalBinding();
  const fixture = await codexNativeGoalFixture({
    config: {
      objective: binding.objective as string,
      goalStatus: "complete",
      // batchAfter keeps the whole terminal burst in one race buffer replay so
      // the correction join (which no longer waits for a repeated Goal-complete)
      // still observes the later cumulative usage snapshot deterministically.
      batchAfter: ["turn/start"],
      after: {
        "turn/start": [
          { method: "thread/tokenUsage/updated", params: goalUsageParams() },
          { method: "item/completed", params: itemCompletedParams() },
          { method: "turn/completed", params: turnCompletedParams() },
          {
            method: "thread/tokenUsage/updated",
            params: goalUsageParams({
              tokenUsage: {
                total: {
                  inputTokens: 300,
                  outputTokens: 60,
                  cachedInputTokens: 110,
                  cacheWriteInputTokens: 5,
                },
              },
            }),
          },
          { method: "thread/goal/updated", params: goalUpdatedParams("complete") },
        ],
      },
    },
  });
  await writeFile(fixture.bindingPath, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600 });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: true,
      hooks: {
        correctionIntent: correctionIntent42(),
      },
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "succeeded");
    assert.equal(result.usage?.inputTokens, 300, "newest cumulative snapshot replaces earlier totals");
    assert.equal(result.usage?.outputTokens, 60);
    assert.equal(result.usage?.cacheReadInputTokens, 110);
    assert.equal(result.usage?.cacheCreationInputTokens, 5);
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal no-progress watchdog terminates and reports a policy limit", async () => {
  const values = { ...testDefaultAdvancedPolicy(), noProgressTimeoutMs: 80, workerStopGraceMs: 40 };
  const provenance = Object.fromEntries(
    Object.keys(values).map((field) => [field, "task"]),
  ) as Record<keyof typeof values, "task">;
  const fixture = await codexNativeGoalFixture({
    effectivePolicy: {
      profileId: "test",
      values,
      provenance,
      enforcementCapability: enforcementCapabilityForRuntime("codex-cli"),
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.policyLimit?.category, "no-progress");
    assert.equal(result.policyLimit?.configured, 80);
    assert.match(result.error ?? "", /no-progress|No effective native Goal progress/);
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal repeated unchanged status/usage cannot reset no-effective-progress stop", async () => {
  // Flood identical Goal status and usage after Turn activation. These are
  // Runtime liveness only: the effective-progress watchdog must still fire.
  // The window covers process startup, protocol setup, and the durable
  // turn/start binding write under full-suite load so the same-burst liveness
  // batch is always replayed before the stop. This is not a sleep: each proven
  // setup step still refreshes the interval; the bound only absorbs load.
  const values = { ...testDefaultAdvancedPolicy(), noProgressTimeoutMs: 4_000, workerStopGraceMs: 40 };
  const provenance = Object.fromEntries(
    Object.keys(values).map((field) => [field, "task"]),
  ) as Record<keyof typeof values, "task">;
  const fixture = await codexNativeGoalFixture({
    effectivePolicy: {
      profileId: "test",
      values,
      provenance,
      enforcementCapability: enforcementCapabilityForRuntime("codex-cli"),
    },
    config: {
      batchAfter: ["turn/start"],
      after: {
        "turn/start": [
          { method: "turn/started", params: turnStartedParams() },
          { method: "thread/goal/updated", params: goalUpdatedParams("active") },
          { method: "thread/tokenUsage/updated", params: goalUsageParams() },
          // Identical repeats: must not keep the Worker alive forever.
          { method: "thread/goal/updated", params: goalUpdatedParams("active") },
          { method: "thread/goal/updated", params: goalUpdatedParams("active") },
          { method: "thread/tokenUsage/updated", params: goalUsageParams() },
          { method: "thread/tokenUsage/updated", params: goalUsageParams() },
          { method: "thread/goal/updated", params: goalUpdatedParams("active") },
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.policyLimit?.category, "no-progress");
    assert.match(result.error ?? "", /No effective native Goal progress|no-progress/);
    const events = fixture.store.listEvents(fixture.task.id);
    // Setup already set status "active" via goal/set. Runtime updates that
    // repeat the same status are liveness-only, coalesced to one row per Turn.
    const goalActive = events.filter(
      (e) => (e.payload as { activityKind?: string } | undefined)?.activityKind === "goal-active",
    );
    const goalLiveness = events.filter(
      (e) => (e.payload as { activityKind?: string } | undefined)?.activityKind === "goal-activity"
        && (e.payload as { goalStatus?: string } | undefined)?.goalStatus === "active",
    );
    assert.equal(goalActive.length, 0, "unchanged active status is never effective progress");
    assert.equal(goalLiveness.length, 1, "repeated status coalesces to one liveness row per Turn");
    assert.equal(
      (goalLiveness[0]?.payload as { activityEvidence?: string }).activityEvidence,
      "liveness",
    );
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal projects command/file/diff progress and suppresses delta flood", async () => {
  // Observed successful-edit shape: command + file item lifecycle, several
  // private diffs, and hundreds of agentMessage deltas must become a bounded
  // privacy-safe public history while the exact terminal join still succeeds.
  // Deltas are dropped before the race buffer so 120 same-burst deltas cannot
  // overflow TURN_START_RACE_BUFFER_MAX (64).
  const privateDiffA = "diff --git a/src/hello.ts b/src/hello.ts\n--- a/src/hello.ts\n+++ b/src/hello.ts\n@@ -1 +1 @@\n-export const n = 1;\n+export const n = 2;\n";
  const privateDiffB = `${privateDiffA}+// still private\n`;
  const deltas = Array.from({ length: 120 }, (_, index) => ({
    method: "item/agentMessage/delta",
    params: agentMessageDeltaParams(`token-${index} secret-path=/Users/me/secret.ts`),
  }));
  const fixture = await codexNativeGoalFixture({
    config: {
      batchAfter: ["turn/start"],
      after: {
        "turn/start": [
          { method: "turn/started", params: turnStartedParams() },
          itemLifecycleParams("item/started", { itemType: "commandExecution" }),
          itemLifecycleParams("item/completed", { itemType: "commandExecution" }),
          itemLifecycleParams("item/started", { itemType: "fileChange" }),
          itemLifecycleParams("item/completed", { itemType: "fileChange" }),
          { method: "turn/diff/updated", params: turnDiffUpdatedParams(privateDiffA) },
          { method: "turn/diff/updated", params: turnDiffUpdatedParams(privateDiffA) },
          { method: "turn/diff/updated", params: turnDiffUpdatedParams(privateDiffB) },
          { method: "turn/diff/updated", params: turnDiffUpdatedParams(privateDiffB) },
          { method: "turn/diff/updated", params: turnDiffUpdatedParams(`${privateDiffB}+again\n`) },
          ...deltas,
          ...exactCurrentTurnTerminalAfter({ text: "Edited the one file" }),
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "succeeded");
    assert.equal(result.resultText, "Edited the one file");

    const events = fixture.store.listEvents(fixture.task.id);
    const toolStarted = events.filter((e) => e.type === "worker.tool.started");
    const toolCompleted = events.filter((e) => e.type === "worker.tool.completed");
    const workspaceChange = events.filter(
      (e) => (e.payload as { activityKind?: string } | undefined)?.activityKind === "workspace-change",
    );
    assert.equal(toolStarted.length, 2, "one start per command and file item");
    assert.equal(toolCompleted.length, 2, "one completion per command and file item");
    assert.equal(workspaceChange.length, 1, "diff evidence coalesces to one public milestone per Turn");
    assert.equal(
      (workspaceChange[0]?.payload as { activityEvidence?: string }).activityEvidence,
      "effective-progress",
    );
    const expectedCmdToken = privacySafeToolCorrelationToken(PRIVATE_CMD_ITEM_ID);
    const expectedFileToken = privacySafeToolCorrelationToken(PRIVATE_FILE_ITEM_ID);
    assert.ok(
      toolStarted.some((e) => (e.payload as { toolUseId?: string }).toolUseId === expectedCmdToken),
      "command start carries one-way correlation token",
    );
    assert.ok(
      toolCompleted.some((e) => (e.payload as { toolUseId?: string }).toolUseId === expectedFileToken),
      "file completion carries one-way correlation token",
    );

    const serialized = JSON.stringify(events);
    assert.ok(!serialized.includes("sed -i"));
    assert.ok(!serialized.includes("/private/workspace"));
    assert.ok(!serialized.includes("src/hello.ts"));
    assert.ok(!serialized.includes("secret-path="));
    assert.ok(!serialized.includes("diff --git"));
    assert.ok(!serialized.includes("/Users/me/secret.ts"));
    assert.ok(!serialized.includes(PRIVATE_CMD_ITEM_ID));
    assert.ok(!serialized.includes(PRIVATE_FILE_ITEM_ID));
    assert.ok(!serialized.includes("/Users/me/"));
    assert.ok(
      !events.some((e) => e.summary.includes("item/agentMessage/delta") || e.summary.includes("token-")),
      "raw deltas must not become one stored event each",
    );
    // History stays readable: tools + one workspace milestone + terminal join,
    // not hundreds of delta/liveness rows from the stream.
    assert.ok(
      events.length < 40,
      `expected bounded public history, got ${events.length} events`,
    );
    assert.ok(events.some((e) => e.type === "worker.completed"));
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal liveness-only traffic cannot extend the post-activation watchdog", async () => {
  // Changing usage/status/plan/deltas/unknown traffic without concrete
  // tool/file/diff/final/terminal evidence must yield one finite no-progress
  // stop. Load-safe interval (same family as other post-activation fixtures)
  // so setup cannot race the timer; each proven setup step still refreshes.
  const values = { ...testDefaultAdvancedPolicy(), noProgressTimeoutMs: 4_000, workerStopGraceMs: 40 };
  const provenance = Object.fromEntries(
    Object.keys(values).map((field) => [field, "task"]),
  ) as Record<keyof typeof values, "task">;
  const fixture = await codexNativeGoalFixture({
    effectivePolicy: {
      profileId: "test",
      values,
      provenance,
      enforcementCapability: enforcementCapabilityForRuntime("codex-cli"),
    },
    config: {
      batchAfter: ["turn/start"],
      after: {
        "turn/start": [
          { method: "turn/started", params: turnStartedParams() },
          { method: "thread/goal/updated", params: goalUpdatedParams("active") },
          { method: "thread/goal/updated", params: goalUpdatedParams("active") },
          {
            method: "thread/tokenUsage/updated",
            params: goalUsageParams({
              tokenUsage: {
                total: {
                  inputTokens: 10,
                  outputTokens: 1,
                  cachedInputTokens: 0,
                  cacheWriteInputTokens: 0,
                },
              },
            }),
          },
          {
            method: "thread/tokenUsage/updated",
            params: goalUsageParams({
              tokenUsage: {
                total: {
                  inputTokens: 500,
                  outputTokens: 80,
                  cachedInputTokens: 100,
                  cacheWriteInputTokens: 2,
                },
              },
            }),
          },
          { method: "item/agentMessage/delta", params: agentMessageDeltaParams("still thinking ") },
          { method: "item/agentMessage/delta", params: agentMessageDeltaParams("about secrets") },
          { method: "turn/plan/updated", params: { threadId: "thread-1", turnId: "turn-1", plan: ["read", "edit", "/Users/me/secret-plan"] } },
          { method: "turn/plan/updated", params: { threadId: "thread-1", turnId: "turn-1", plan: ["more"] } },
          { method: "unknown/future", params: { threadId: "thread-1", turnId: "turn-1", noise: true, secret: "/Users/me/x" } },
          { method: "unknown/other", params: { threadId: "thread-1", turnId: "turn-1", more: true } },
        ],
      },
      delayedAfter: {
        "turn/start": {
          delayMs: 30,
          notifications: [
            // Post-activation liveness only — cannot buy unlimited time.
            { method: "item/agentMessage/delta", params: agentMessageDeltaParams("more noise") },
            {
              method: "thread/tokenUsage/updated",
              params: goalUsageParams({
                tokenUsage: {
                  total: {
                    inputTokens: 900,
                    outputTokens: 120,
                    cachedInputTokens: 200,
                    cacheWriteInputTokens: 3,
                  },
                },
              }),
            },
            { method: "thread/goal/updated", params: goalUpdatedParams("active") },
            { method: "turn/plan/updated", params: { threadId: "thread-1", turnId: "turn-1", plan: ["again"] } },
            { method: "unknown/future", params: { threadId: "thread-1", turnId: "turn-1", noise: 2 } },
          ],
        },
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.policyLimit?.category, "no-progress");
    assert.equal(result.policyLimit?.configured, 4_000);
    assert.match(result.error ?? "", /No effective native Goal progress|no-progress/);
    const events = fixture.store.listEvents(fixture.task.id);
    assert.ok(!events.some((e) => e.type === "worker.tool.started"));
    assert.ok(!events.some((e) => e.type === "worker.completed"));
    assert.ok(
      !events.some((e) => e.summary.includes("item/agentMessage/delta") || e.summary.includes("still thinking")),
      "deltas remain unstored",
    );
    // Status / plan / unknown each coalesce to at most one privacy-safe row.
    const statusRows = events.filter(
      (e) => (e.payload as { goalStatus?: string } | undefined)?.goalStatus === "active"
        && (e.payload as { activityKind?: string } | undefined)?.activityKind === "goal-activity",
    );
    const planRows = events.filter((e) => e.summary === "Codex native Goal updated its plan");
    const unknownRows = events.filter(
      (e) => e.summary === "Codex native Goal reported additional runtime activity",
    );
    assert.equal(statusRows.length, 1, "status liveness coalesced per Turn");
    assert.equal(planRows.length, 1, "plan liveness coalesced per Turn");
    assert.equal(unknownRows.length, 1, "unknown liveness coalesced per Turn");
    const serialized = JSON.stringify(events);
    assert.ok(!serialized.includes("/Users/me/secret-plan"));
    assert.ok(!serialized.includes("unknown/future"));
    assert.ok(!serialized.includes("turn/plan/updated"));
    const failed = events.find((e) => e.type === "worker.failed");
    assert.equal(
      (failed?.payload as { reasonCode?: string } | undefined)?.reasonCode,
      "codex-goal-no-progress",
    );
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal private diff refreshes progress without leaking content", async () => {
  // Materially new private diffs refresh the watchdog; identical repeats and
  // public payloads stay free of paths/content. After the last material diff,
  // pure liveness cannot keep the Goal alive. Load-safe interval proves the
  // post-activation path rather than racing setup.
  const values = { ...testDefaultAdvancedPolicy(), noProgressTimeoutMs: 4_000, workerStopGraceMs: 40 };
  const provenance = Object.fromEntries(
    Object.keys(values).map((field) => [field, "task"]),
  ) as Record<keyof typeof values, "task">;
  const privateDiff = "diff --git a/src/private.ts b/src/private.ts\n+const token = 'abc';\n";
  const fixture = await codexNativeGoalFixture({
    effectivePolicy: {
      profileId: "test",
      values,
      provenance,
      enforcementCapability: enforcementCapabilityForRuntime("codex-cli"),
    },
    config: {
      batchAfter: ["turn/start"],
      after: {
        "turn/start": [
          { method: "turn/started", params: turnStartedParams() },
          { method: "turn/diff/updated", params: turnDiffUpdatedParams(privateDiff) },
          { method: "turn/diff/updated", params: turnDiffUpdatedParams(privateDiff) },
          { method: "turn/diff/updated", params: turnDiffUpdatedParams(`${privateDiff}+second material change\n`) },
          { method: "turn/diff/updated", params: turnDiffUpdatedParams(`${privateDiff}+second material change\n`) },
        ],
      },
      delayedAfter: {
        "turn/start": {
          // After material diffs land in the activation batch, only liveness
          // arrives later — the watchdog must still fire once.
          delayMs: 30,
          notifications: [
            {
              method: "thread/tokenUsage/updated",
              params: goalUsageParams({
                tokenUsage: {
                  total: {
                    inputTokens: 40,
                    outputTokens: 8,
                    cachedInputTokens: 1,
                    cacheWriteInputTokens: 0,
                  },
                },
              }),
            },
            { method: "item/agentMessage/delta", params: agentMessageDeltaParams("no real work") },
            { method: "thread/goal/updated", params: goalUpdatedParams("active") },
          ],
        },
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.policyLimit?.category, "no-progress");
    assert.equal(result.policyLimit?.configured, 4_000);
    const events = fixture.store.listEvents(fixture.task.id);
    const workspaceChange = events.filter(
      (e) => (e.payload as { activityKind?: string } | undefined)?.activityKind === "workspace-change",
    );
    assert.equal(workspaceChange.length, 1, "only one public workspace-change milestone per Turn");
    assert.equal(
      (workspaceChange[0]?.payload as { activityEvidence?: string }).activityEvidence,
      "effective-progress",
    );
    const serialized = JSON.stringify(events);
    assert.ok(!serialized.includes("src/private.ts"));
    assert.ok(!serialized.includes("const token"));
    assert.ok(!serialized.includes("diff --git"));
    assert.ok(!serialized.includes("second material change"));
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal ignores stale and malformed item/diff evidence", async () => {
  // Load-safe post-activation interval: stale/malformed evidence must not
  // invent progress, and pure silence still ends in one no-progress stop.
  const values = { ...testDefaultAdvancedPolicy(), noProgressTimeoutMs: 4_000, workerStopGraceMs: 40 };
  const provenance = Object.fromEntries(
    Object.keys(values).map((field) => [field, "task"]),
  ) as Record<keyof typeof values, "task">;
  const fixture = await codexNativeGoalFixture({
    effectivePolicy: {
      profileId: "test",
      values,
      provenance,
      enforcementCapability: enforcementCapabilityForRuntime("codex-cli"),
    },
    config: {
      batchAfter: ["turn/start"],
      after: {
        "turn/start": [
          { method: "turn/started", params: turnStartedParams() },
          // Other Thread/Turn tool evidence cannot invent progress.
          itemLifecycleParams("item/started", {
            itemType: "commandExecution",
            itemId: "stale-cmd",
            threadId: "thread-other",
            turnId: "turn-other",
          }),
          itemLifecycleParams("item/completed", {
            itemType: "fileChange",
            itemId: "stale-file",
            turnId: "turn-other",
          }),
          // Malformed / non-tool: missing item, snake_case type, agentMessage start.
          { method: "item/started", params: { threadId: "thread-1", turnId: "turn-1" } },
          {
            method: "item/completed",
            params: {
              threadId: "thread-1",
              turnId: "turn-1",
              item: { type: "command_execution", command: "echo leak" },
            },
          },
          {
            method: "item/started",
            params: {
              threadId: "thread-1",
              turnId: "turn-1",
              item: { id: "msg-1", type: "agentMessage", text: "should not store" },
            },
          },
          {
            method: "turn/diff/updated",
            params: { threadId: "thread-1", turnId: "turn-other", diff: "diff --git a/x b/x\n+stale" },
          },
          {
            method: "turn/diff/updated",
            params: { threadId: "thread-1", turnId: "turn-1", diff: "" },
          },
          {
            method: "turn/diff/updated",
            params: { threadId: "thread-other", turnId: "turn-1", diff: "diff --git a/x b/x\n+cross" },
          },
          // Missing turnId cannot complete a tool or refresh progress.
          {
            method: "item/started",
            params: {
              threadId: "thread-1",
              item: {
                id: "no-turn",
                type: "commandExecution",
                command: "echo no-turn",
              },
            },
          },
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.policyLimit?.category, "no-progress");
    assert.equal(result.policyLimit?.configured, 4_000);
    const events = fixture.store.listEvents(fixture.task.id);
    assert.ok(!events.some((e) => e.type === "worker.tool.started"));
    assert.ok(!events.some((e) => e.type === "worker.tool.completed"));
    assert.ok(
      !events.some(
        (e) => (e.payload as { activityKind?: string } | undefined)?.activityKind === "workspace-change",
      ),
    );
    const serialized = JSON.stringify(events);
    assert.ok(!serialized.includes("echo leak"));
    assert.ok(!serialized.includes("echo no-turn"));
    assert.ok(!serialized.includes("should not store"));
    assert.ok(!serialized.includes("diff --git"));
    assert.ok(!events.some((e) => e.type === "worker.completed"));
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal setup hang terminates through the no-progress policy path", async () => {
  // A setup request that never responds must not hang the Worker when total
  // duration is unlimited: the same refreshable no-progress policy bounds
  // initialize / Thread / Goal / durable-write / turn/start waits.
  const values = { ...testDefaultAdvancedPolicy(), noProgressTimeoutMs: 80, workerStopGraceMs: 40 };
  const provenance = Object.fromEntries(
    Object.keys(values).map((field) => [field, "task"]),
  ) as Record<keyof typeof values, "task">;
  const fixture = await codexNativeGoalFixture({
    effectivePolicy: {
      profileId: "test",
      values,
      provenance,
      enforcementCapability: enforcementCapabilityForRuntime("codex-cli"),
    },
    config: {
      hangMethods: ["initialize"],
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.policyLimit?.category, "no-progress");
    assert.equal(result.policyLimit?.configured, 80);
    assert.equal(result.policyLimit?.effect, "hard-fail");
    assert.match(result.error ?? "", /no-progress|No effective native Goal progress/);
    assert.ok(
      !result.error?.includes("setup failed"),
      "setup hang must report the no-progress policy path, not a generic setup failure",
    );
    const failed = fixture.store.listEvents(fixture.task.id).find((e) => e.type === "worker.failed");
    assert.equal(
      (failed?.payload as { reasonCode?: string } | undefined)?.reasonCode,
      "codex-goal-no-progress",
    );
    // Do not require initialize to appear in the log: an 80ms watchdog may
    // kill the fake before it reads/logs the first line. Prove only that no
    // later Thread request advanced past the hung setup boundary.
    const requests = await readRequestLog(fixture.requestLog);
    assert.ok(
      !requests.some((r) => r.method === "thread/start" || r.method === "thread/resume"),
      "no Thread request may advance past a hung setup request",
    );
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal fails closed when the app-server rejects initialize", async () => {
  const fixture = await codexNativeGoalFixture({
    config: { initializeError: { code: -32603, message: "internal error" } },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.failureCategory, "runtime");
    assert.match(result.error ?? "", /setup failed/);
    const requests = await readRequestLog(fixture.requestLog);
    assert.equal(requests[0]?.method, "initialize");
    assert.ok(
      !requests.some((r) => r.method === "thread/start"),
      "no Thread request may precede a successful initialize",
    );
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal rejects old invented wire shapes", async () => {
  // thread/start returning a flat thread_id is rejected.
  const flatThread = await codexNativeGoalFixture({
    config: {
      responders: {
        "thread/start": { result: { thread_id: "thread-1" } },
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: flatThread.store,
      task: flatThread.task,
      attempt: flatThread.attempt,
      resuming: false,
      hooks: {},
    }, flatThread.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.failureCategory, "runtime");
    assert.match(result.error ?? "", /omitted thread/);
  } finally {
    flatThread.store.close();
  }

  // thread/goal/set returning an invented goal_id is rejected.
  const inventedGoal = await codexNativeGoalFixture({
    config: {
      responders: {
        "thread/goal/set": { result: { goal_id: "goal-1", status: "active" } },
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: inventedGoal.store,
      task: inventedGoal.task,
      attempt: inventedGoal.attempt,
      resuming: false,
      hooks: {},
    }, inventedGoal.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /omitted goal/);
  } finally {
    inventedGoal.store.close();
  }

  // turn/start returning a flat turn_id is rejected.
  const flatTurn = await codexNativeGoalFixture({
    config: {
      responders: {
        "turn/start": { result: { turn_id: "turn-1" } },
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: flatTurn.store,
      task: flatTurn.task,
      attempt: flatTurn.attempt,
      resuming: false,
      hooks: {},
    }, flatTurn.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /omitted turn/);
  } finally {
    flatTurn.store.close();
  }

  // A turn/completed notification without the canonical nested turn object
  // (the invented result_text shape) fails closed instead of becoming progress.
  const inventedTurn = await codexNativeGoalFixture({
    config: {
      after: {
        "turn/start": [
          { method: "turn/completed", params: { threadId: "thread-1", result_text: "old flat", status: "completed" } },
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: inventedTurn.store,
      task: inventedTurn.task,
      attempt: inventedTurn.attempt,
      resuming: false,
      hooks: {},
    }, inventedTurn.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /canonical turn payload/);
  } finally {
    inventedTurn.store.close();
  }
});

test("Codex native Goal ignores unrelated-thread notifications and cannot be kept alive by them", async () => {
  const values = { ...testDefaultAdvancedPolicy(), noProgressTimeoutMs: 80, workerStopGraceMs: 40 };
  const provenance = Object.fromEntries(
    Object.keys(values).map((field) => [field, "task"]),
  ) as Record<keyof typeof values, "task">;
  const fixture = await codexNativeGoalFixture({
    effectivePolicy: {
      profileId: "test",
      values,
      provenance,
      enforcementCapability: enforcementCapabilityForRuntime("codex-cli"),
    },
    config: {
      after: {
        "turn/start": [
          { method: "thread/goal/updated", params: { threadId: "thread-other", goal: { status: "complete" } } },
          { method: "thread/tokenUsage/updated", params: { threadId: "thread-other", turnId: "turn-other", tokenUsage: { total: { inputTokens: 5, outputTokens: 5 } } } },
          { method: "turn/completed", params: { threadId: "thread-other", turn: { id: "turn-other", status: "completed" } } },
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.policyLimit?.category, "no-progress");
    const events = fixture.store.listEvents(fixture.task.id);
    assert.ok(
      !events.some((e) => e.type === "worker.completed"),
      "an unrelated-thread goal completion is not terminal evidence",
    );
    assert.ok(
      !events.some((e) => (e.payload as { threadId?: string } | undefined)?.threadId === "thread-other"),
      "unrelated-thread notifications are not recorded as progress",
    );
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal failed and interrupted Turns stay truthful and bounded", async () => {
  // This scenario exercises the runtime phase after setup. Setup now uses the
  // same no-progress policy, so give the fake protocol a deterministic window
  // to establish the Turn; the dedicated setup-hang test above keeps the
  // short 80ms boundary for setup protection itself.
  const values = { ...testDefaultAdvancedPolicy(), noProgressTimeoutMs: 1_500, workerStopGraceMs: 40 };
  const provenance = Object.fromEntries(
    Object.keys(values).map((field) => [field, "task"]),
  ) as Record<keyof typeof values, "task">;
  // batchAfter so both Turn completions are replayed before the no-progress
  // timer can fire; separate writes can race the 80ms watchdog under load.
  const fixture = await codexNativeGoalFixture({
    effectivePolicy: {
      profileId: "test",
      values,
      provenance,
      enforcementCapability: enforcementCapabilityForRuntime("codex-cli"),
    },
    config: {
      batchAfter: ["turn/start"],
      after: {
        "turn/start": [
          { method: "turn/completed", params: turnCompletedParams("failed") },
          { method: "turn/completed", params: turnCompletedParams("interrupted") },
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    // A stuck loop of failed/interrupted Turns is recorded truthfully but never
    // defeats the no-progress watchdog and never invents success.
    assert.equal(result.status, "failed");
    assert.equal(result.policyLimit?.category, "no-progress");
    const events = fixture.store.listEvents(fixture.task.id);
    const turnEvents = events.filter(
      (e) => (e.payload as { activityKind?: string } | undefined)?.activityKind === "goal-turn-interrupted",
    );
    assert.equal(turnEvents.length, 2, "failed and interrupted Turns are recorded truthfully");
    assert.ok(!events.some((e) => e.type === "worker.completed"), "failed/interrupted Turns never produce success");
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal cannot succeed from Goal complete after a failed Turn alone", async () => {
  const values = { ...testDefaultAdvancedPolicy(), noProgressTimeoutMs: 80, workerStopGraceMs: 40 };
  const provenance = Object.fromEntries(
    Object.keys(values).map((field) => [field, "task"]),
  ) as Record<keyof typeof values, "task">;
  const fixture = await codexNativeGoalFixture({
    effectivePolicy: {
      profileId: "test",
      values,
      provenance,
      enforcementCapability: enforcementCapabilityForRuntime("codex-cli"),
    },
    config: {
      after: {
        "turn/start": [
          { method: "turn/completed", params: turnCompletedParams("failed") },
          { method: "item/completed", params: itemCompletedParams() },
          { method: "thread/goal/updated", params: goalUpdatedParams("complete") },
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    // Exact current-Turn completion is required; Goal complete + final after a
    // failed Turn cannot invent success.
    assert.equal(result.status, "failed");
    assert.equal(result.policyLimit?.category, "no-progress");
    assert.equal(result.resultText, undefined);
    assert.ok(
      !fixture.store.listEvents(fixture.task.id).some((e) => e.type === "worker.completed"),
      "failed Turn blocks the terminal join",
    );
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal freezes cwd, model, effort, approval, and least-privilege sandbox", async () => {
  const fixture = await codexNativeGoalFixture({
    config: {
      after: {
        "turn/start": exactCurrentTurnTerminalAfter(),
      },
    },
  });
  // Parent holds redirect/tenant vars so absence in the child proves stripping,
  // not an empty parent. Values are never asserted — only presence booleans.
  const parentEnvKeys = [
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_ORG_ID",
    "OPENAI_PROJECT",
    "CODEX_API_KEY",
  ] as const;
  const previousEnv: Partial<Record<(typeof parentEnvKeys)[number], string | undefined>> = {};
  for (const key of parentEnvKeys) {
    previousEnv[key] = process.env[key];
    process.env[key] = `parent-placeholder-${key}`;
  }
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "succeeded");

    // Wire requests must independently freeze policy; config.toml is defense
    // in depth and cannot mask a missing or wrong request field.
    const requests = await readRequestLog(fixture.requestLog);
    const threadStart = requests.find((r) => r.method === "thread/start");
    assertThreadPolicyParams(
      threadStart?.params as Record<string, unknown> | undefined,
      fixture.expectedPolicy,
    );
    const turnStart = requests.find((r) => r.method === "turn/start");
    assertTurnPolicyParams(
      turnStart?.params as Record<string, unknown> | undefined,
      fixture.expectedPolicy,
      "thread-1",
    );

    const config = await readFile(
      path.join(fixture.task.paths.root, "codex-home", "config.toml"),
      "utf8",
    );
    assert.ok(config.includes('model = "gpt-5.6-luna"'), "exact frozen model");
    assert.ok(config.includes('model_reasoning_effort = "max"'), "exact frozen effort");
    assert.ok(config.includes('approval_policy = "never"'), "approval stays never");
    assert.ok(config.includes('sandbox_mode = "workspace-write"'), "editable Tasks get workspace-write sandbox only");
    assert.ok(config.includes('web_search = "disabled"'), "web stays disabled");
    // The config emits a real `[features]` table whose keys disable apps and
    // nested agents; assert that structure instead of nonexistent dotted text.
    const configLines = config.split("\n");
    const featuresIndex = configLines.findIndex((line) => line === "[features]");
    assert.ok(featuresIndex >= 0, "[features] table is present");
    const featuresBody = configLines.slice(featuresIndex + 1);
    assert.ok(featuresBody.includes("apps = false"), "apps stay disabled");
    assert.ok(featuresBody.includes("multi_agent = false"), "nested agents stay disabled");
    assert.ok(!config.includes("danger-full-access"), "never broadens the sandbox");
    // Explicit workspace-write refinements: network off, global /tmp excluded,
    // task-private TMPDIR not denied via exclude_tmpdir_env_var.
    const sandboxWriteIndex = configLines.findIndex((line) => line === "[sandbox_workspace_write]");
    assert.ok(sandboxWriteIndex >= 0, "[sandbox_workspace_write] table is present");
    const sandboxWriteBody = configLines.slice(sandboxWriteIndex + 1);
    const nextTable = sandboxWriteBody.findIndex((line) => line.startsWith("["));
    const sandboxWriteSection = nextTable >= 0 ? sandboxWriteBody.slice(0, nextTable) : sandboxWriteBody;
    assert.ok(sandboxWriteSection.includes("network_access = false"), "command network stays disabled");
    assert.ok(sandboxWriteSection.includes("exclude_slash_tmp = true"), "global /tmp is excluded");
    assert.ok(
      !config.includes("exclude_tmpdir_env_var"),
      "task-private TMPDIR must not be excluded by config",
    );

    const envDump = JSON.parse(
      await readFile(path.join(fixture.task.paths.workspace, "codex-goal-env-dump.json"), "utf8"),
    ) as {
      cwd: string;
      CODEX_HOME: string | null;
      TMPDIR: string | null;
      TMP: string | null;
      TEMP: string | null;
      hasOpenAIKey: boolean;
      hasOpenAIBaseUrl: boolean;
      hasOpenAIOrgId: boolean;
      hasOpenAIProject: boolean;
      hasCodexApiKey: boolean;
    };
    assert.equal(envDump.cwd, await realpath(fixture.task.paths.workspace), "cwd frozen to the Task workspace");
    const taskTmp = path.join(fixture.task.paths.root, "codex-tmp");
    assert.equal(envDump.TMPDIR, taskTmp, "task-private TMPDIR is preserved for native Goal");
    assert.equal(envDump.TMP, taskTmp);
    assert.equal(envDump.TEMP, taskTmp);
    assert.equal(envDump.hasOpenAIKey, false, "OPENAI_API_KEY must not reach the app-server child");
    assert.equal(envDump.hasOpenAIBaseUrl, false, "OPENAI_BASE_URL must not reach the app-server child");
    assert.equal(envDump.hasOpenAIOrgId, false, "OPENAI_ORG_ID must not reach the app-server child");
    assert.equal(envDump.hasOpenAIProject, false, "OPENAI_PROJECT must not reach the app-server child");
    assert.equal(envDump.hasCodexApiKey, false, "CODEX_API_KEY must not reach the app-server child");

    // Prove runCodexNativeGoal wired the Runtime-aware prompt into the real artifact.
    const promptArtifact = await readFile(
      path.join(fixture.task.paths.logs, "attempt-1.prompt.txt"),
      "utf8",
    );
    assertCodexEditablePromptContract(promptArtifact);
    assert.match(promptArtifact, /Runtime-native Goal/);
    assert.ok(
      !promptArtifact.includes("Shell access is intentionally unavailable"),
      "native Goal prompt must not carry the tool-only no-shell contradiction",
    );
  } finally {
    for (const key of parentEnvKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    fixture.store.close();
  }
});

test("Codex native Goal freezes read-only least-privilege policy on thread and turn start", async () => {
  const fixture = await codexNativeGoalFixture({
    allowEdits: false,
    config: {
      after: {
        "turn/start": exactCurrentTurnTerminalAfter(),
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "succeeded");
    assert.equal(result.resultText, "Implemented the change");
    assert.equal(fixture.expectedPolicy.allowEdits, false);

    const requests = await readRequestLog(fixture.requestLog);
    assertThreadPolicyParams(
      requests.find((r) => r.method === "thread/start")?.params as Record<string, unknown> | undefined,
      fixture.expectedPolicy,
    );
    assertTurnPolicyParams(
      requests.find((r) => r.method === "turn/start")?.params as Record<string, unknown> | undefined,
      fixture.expectedPolicy,
      "thread-1",
    );

    const config = await readFile(
      path.join(fixture.task.paths.root, "codex-home", "config.toml"),
      "utf8",
    );
    assert.ok(config.includes('sandbox_mode = "read-only"'), "read-only Tasks freeze read-only sandbox");
    assert.ok(!config.includes('sandbox_mode = "workspace-write"'), "read-only Tasks never enable workspace-write");
    assert.ok(!config.includes("danger-full-access"), "never broadens the sandbox");
    assert.ok(config.includes("network_access = false"), "command network stays disabled");
    assert.ok(config.includes("exclude_slash_tmp = true"), "global /tmp is excluded");
    assert.ok(!config.includes("exclude_tmpdir_env_var"), "task-private TMPDIR is not excluded");

    const promptArtifact = await readFile(
      path.join(fixture.task.paths.logs, "attempt-1.prompt.txt"),
      "utf8",
    );
    assertCodexReadOnlyPromptContract(promptArtifact);
    assert.match(promptArtifact, /Runtime-native Goal/);
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal same-burst response/replay joins exact current-Turn terminals", async () => {
  // Response, usage, Goal complete, final item, and Turn complete share one
  // deterministic stdout batch after turn/start (batchAfter); durable binding
  // yields before replay. Success must wait until the full buffered batch is
  // applied so a later cumulative usage snapshot in the same burst wins.
  // batchAfter keeps this independent of OS pipe chunk coalescing.
  const fixture = await codexNativeGoalFixture({
    config: {
      batchAfter: ["turn/start"],
      after: {
        "turn/start": [
          { method: "thread/tokenUsage/updated", params: goalUsageParams({
            tokenUsage: { total: { inputTokens: 11, outputTokens: 2, cachedInputTokens: 1, cacheWriteInputTokens: 0 } },
          }) },
          { method: "thread/goal/updated", params: goalUpdatedParams("complete") },
          { method: "item/completed", params: itemCompletedParams({ text: "same-burst final" }) },
          { method: "turn/completed", params: turnCompletedParams() },
          { method: "thread/tokenUsage/updated", params: goalUsageParams({
            tokenUsage: { total: { inputTokens: 33, outputTokens: 7, cachedInputTokens: 4, cacheWriteInputTokens: 1 } },
          }) },
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "succeeded");
    assert.equal(result.resultText, "same-burst final");
    assert.equal(result.usage?.inputTokens, 33, "latest exact cumulative usage wins");
    assert.equal(result.usage?.outputTokens, 7);
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal same-burst later fail-closed evidence is not skipped by early success", async () => {
  // All three success gates appear before a later malformed usage snapshot in
  // the same deterministic turn/start batch. Replay must apply the whole batch
  // so the malformed evidence fails closed instead of an early join inventing
  // success. batchAfter avoids depending on OS pipe coalescing.
  const fixture = await codexNativeGoalFixture({
    config: {
      batchAfter: ["turn/start"],
      after: {
        "turn/start": [
          { method: "item/completed", params: itemCompletedParams({ text: "would-succeed" }) },
          { method: "turn/completed", params: turnCompletedParams() },
          { method: "thread/goal/updated", params: goalUpdatedParams("complete") },
          {
            method: "thread/tokenUsage/updated",
            params: {
              threadId: "thread-1",
              tokenUsage: {
                total: { inputTokens: 10, cachedInputTokens: 12, outputTokens: 2 },
              },
            },
          },
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /malformed usage evidence/);
    assert.equal(result.resultText, undefined);
    assert.ok(!fixture.store.listEvents(fixture.task.id).some((e) => e.type === "worker.completed"));
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal non-complete status clears prior completion gate", async () => {
  const values = { ...testDefaultAdvancedPolicy(), noProgressTimeoutMs: 80, workerStopGraceMs: 40 };
  const provenance = Object.fromEntries(
    Object.keys(values).map((field) => [field, "task"]),
  ) as Record<keyof typeof values, "task">;
  // complete → active must invalidate the completion gate even when final and
  // Turn completion remain present.
  const fixture = await codexNativeGoalFixture({
    effectivePolicy: {
      profileId: "test",
      values,
      provenance,
      enforcementCapability: enforcementCapabilityForRuntime("codex-cli"),
    },
    config: {
      after: {
        "turn/start": [
          { method: "item/completed", params: itemCompletedParams({ text: "stale complete" }) },
          { method: "turn/completed", params: turnCompletedParams() },
          { method: "thread/goal/updated", params: goalUpdatedParams("complete") },
          { method: "thread/goal/updated", params: goalUpdatedParams("active") },
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.policyLimit?.category, "no-progress");
    assert.equal(result.resultText, undefined);
    assert.ok(!fixture.store.listEvents(fixture.task.id).some((e) => e.type === "worker.completed"));
  } finally {
    fixture.store.close();
  }

  // A later exact current-Turn complete after the regression restores the gate.
  const restored = await codexNativeGoalFixture({
    config: {
      after: {
        "turn/start": [
          { method: "item/completed", params: itemCompletedParams({ text: "restored final" }) },
          { method: "turn/completed", params: turnCompletedParams() },
          { method: "thread/goal/updated", params: goalUpdatedParams("complete") },
          { method: "thread/goal/updated", params: goalUpdatedParams("active") },
          { method: "thread/goal/updated", params: goalUpdatedParams("complete") },
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: restored.store,
      task: restored.task,
      attempt: restored.attempt,
      resuming: false,
      hooks: {},
    }, restored.operatorCodexHome);
    assert.equal(result.status, "succeeded");
    assert.equal(result.resultText, "restored final");
  } finally {
    restored.store.close();
  }
});

test("Codex native Goal pre-request or stale Goal complete cannot invent success", async () => {
  const values = { ...testDefaultAdvancedPolicy(), noProgressTimeoutMs: 80, workerStopGraceMs: 40 };
  const provenance = Object.fromEntries(
    Object.keys(values).map((field) => [field, "task"]),
  ) as Record<keyof typeof values, "task">;
  // Pre-request Goal complete (before turn/start) and a later current Turn with
  // final + completion but no exact current-Turn Goal complete.
  const preRequest = await codexNativeGoalFixture({
    effectivePolicy: {
      profileId: "test",
      values,
      provenance,
      enforcementCapability: enforcementCapabilityForRuntime("codex-cli"),
    },
    config: {
      after: {
        "thread/goal/set": [
          { method: "thread/goal/updated", params: goalUpdatedParams("complete", { turnId: null }) },
        ],
        "turn/start": [
          { method: "item/completed", params: itemCompletedParams({ text: "later final" }) },
          { method: "turn/completed", params: turnCompletedParams() },
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: preRequest.store,
      task: preRequest.task,
      attempt: preRequest.attempt,
      resuming: false,
      hooks: {},
    }, preRequest.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.policyLimit?.category, "no-progress");
    assert.equal(result.resultText, undefined);
    assert.ok(!preRequest.store.listEvents(preRequest.task.id).some((e) => e.type === "worker.completed"));
  } finally {
    preRequest.store.close();
  }

  // Stale turnId on Goal complete is inert even after the current Turn finishes.
  const stale = await codexNativeGoalFixture({
    effectivePolicy: {
      profileId: "test",
      values,
      provenance,
      enforcementCapability: enforcementCapabilityForRuntime("codex-cli"),
    },
    config: {
      after: {
        "turn/start": [
          { method: "item/completed", params: itemCompletedParams() },
          { method: "turn/completed", params: turnCompletedParams() },
          { method: "thread/goal/updated", params: goalUpdatedParams("complete", { turnId: "turn-stale" }) },
          { method: "thread/goal/updated", params: goalUpdatedParams("complete", { turnId: null }) },
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: stale.store,
      task: stale.task,
      attempt: stale.attempt,
      resuming: false,
      hooks: {},
    }, stale.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.policyLimit?.category, "no-progress");
    assert.equal(result.resultText, undefined);
  } finally {
    stale.store.close();
  }
});

test("Codex native Goal ambiguous final output cannot become resultText", async () => {
  const values = { ...testDefaultAdvancedPolicy(), noProgressTimeoutMs: 80, workerStopGraceMs: 40 };
  const provenance = Object.fromEntries(
    Object.keys(values).map((field) => [field, "task"]),
  ) as Record<keyof typeof values, "task">;
  const ambiguousCases: Array<{ label: string; item: Record<string, unknown> }> = [
    { label: "missing turnId", item: itemCompletedParams({ turnId: null, text: "no-turn" }) },
    { label: "stale turnId", item: itemCompletedParams({ turnId: "turn-old", text: "stale" }) },
    { label: "commentary", item: itemCompletedParams({ phase: "commentary", text: "note" }) },
    { label: "snake_case type", item: itemCompletedParams({ type: "agent_message", text: "snake" }) },
    { label: "missing phase", item: itemCompletedParams({ omitPhase: true, text: "no-phase" }) },
    { label: "unknown phase", item: itemCompletedParams({ phase: "thinking", text: "think" }) },
  ];
  for (const ambiguous of ambiguousCases) {
    const fixture = await codexNativeGoalFixture({
      effectivePolicy: {
        profileId: "test",
        values,
        provenance,
        enforcementCapability: enforcementCapabilityForRuntime("codex-cli"),
      },
      config: {
        after: {
          "turn/start": [
            { method: "item/completed", params: ambiguous.item },
            { method: "turn/completed", params: turnCompletedParams() },
            { method: "thread/goal/updated", params: goalUpdatedParams("complete") },
          ],
        },
      },
    });
    try {
      const result = await runCodexWorker({
        store: fixture.store,
        task: fixture.task,
        attempt: fixture.attempt,
        resuming: false,
        hooks: {},
      }, fixture.operatorCodexHome);
      assert.equal(result.status, "failed", `${ambiguous.label} must not succeed`);
      assert.equal(result.resultText, undefined, `${ambiguous.label} must not become resultText`);
      assert.ok(
        !fixture.store.listEvents(fixture.task.id).some((e) => e.type === "worker.completed"),
        `${ambiguous.label} must not emit worker.completed`,
      );
    } finally {
      fixture.store.close();
    }
  }
});

test("Codex native Goal legacy null final is contained after explicit non-null phase", async () => {
  const values = { ...testDefaultAdvancedPolicy(), noProgressTimeoutMs: 80, workerStopGraceMs: 40 };
  const provenance = Object.fromEntries(
    Object.keys(values).map((field) => [field, "task"]),
  ) as Record<keyof typeof values, "task">;
  const fixture = await codexNativeGoalFixture({
    effectivePolicy: {
      profileId: "test",
      values,
      provenance,
      enforcementCapability: enforcementCapabilityForRuntime("codex-cli"),
    },
    config: {
      after: {
        "turn/start": [
          { method: "item/completed", params: itemCompletedParams({ phase: "commentary", text: "note" }) },
          { method: "item/completed", params: itemCompletedParams({ phase: null, text: "legacy after commentary" }) },
          { method: "turn/completed", params: turnCompletedParams() },
          { method: "thread/goal/updated", params: goalUpdatedParams("complete") },
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.resultText, undefined, "phase:null after explicit phase is not legacy final");
  } finally {
    fixture.store.close();
  }

  // Legacy null alone on the current Turn is still accepted when no explicit
  // non-null phase has been observed.
  const legacyOk = await codexNativeGoalFixture({
    config: {
      after: {
        "turn/start": [
          { method: "item/completed", params: itemCompletedParams({ phase: null, text: "legacy final" }) },
          { method: "turn/completed", params: turnCompletedParams() },
          { method: "thread/goal/updated", params: goalUpdatedParams("complete") },
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: legacyOk.store,
      task: legacyOk.task,
      attempt: legacyOk.attempt,
      resuming: false,
      hooks: {},
    }, legacyOk.operatorCodexHome);
    assert.equal(result.status, "succeeded");
    assert.equal(result.resultText, "legacy final");
  } finally {
    legacyOk.store.close();
  }
});

test("Codex native Goal waits for final item after Goal and Turn terminal gates", async () => {
  // Goal + Turn complete first; final item arrives later in the same burst.
  // Behavior is deterministic and never invents empty success.
  const fixture = await codexNativeGoalFixture({
    config: {
      after: {
        "turn/start": [
          { method: "thread/goal/updated", params: goalUpdatedParams("complete") },
          { method: "turn/completed", params: turnCompletedParams() },
          { method: "item/completed", params: itemCompletedParams({ text: "final after gates" }) },
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "succeeded");
    assert.equal(result.resultText, "final after gates");
  } finally {
    fixture.store.close();
  }

  const values = { ...testDefaultAdvancedPolicy(), noProgressTimeoutMs: 80, workerStopGraceMs: 40 };
  const provenance = Object.fromEntries(
    Object.keys(values).map((field) => [field, "task"]),
  ) as Record<keyof typeof values, "task">;
  // Without a final item, Goal+Turn gates alone never invent empty success.
  const missingFinal = await codexNativeGoalFixture({
    effectivePolicy: {
      profileId: "test",
      values,
      provenance,
      enforcementCapability: enforcementCapabilityForRuntime("codex-cli"),
    },
    config: {
      after: {
        "turn/start": [
          { method: "thread/goal/updated", params: goalUpdatedParams("complete") },
          { method: "turn/completed", params: turnCompletedParams() },
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: missingFinal.store,
      task: missingFinal.task,
      attempt: missingFinal.attempt,
      resuming: false,
      hooks: {},
    }, missingFinal.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.resultText, undefined, "never invent empty success");
    assert.equal(result.policyLimit?.category, "no-progress");
  } finally {
    missingFinal.store.close();
  }
});

test("Codex native Goal turn/start race buffer overflow fails closed", async () => {
  // 65 minimal unknown notifications after the turn/start response in one
  // bounded batch (buffer limit 64). Harmless empty-params noise keeps the
  // single combined write well under 4 KiB so the pipe cannot split the burst.
  // batchAfter avoids depending on OS pipe chunk coalescing of 65 writes.
  const overflowNotifications = Array.from({ length: 65 }, () => ({
    method: "n",
    params: {},
  }));
  const fixture = await codexNativeGoalFixture({
    config: {
      batchAfter: ["turn/start"],
      after: {
        "turn/start": overflowNotifications,
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.failureCategory, "runtime");
    assert.match(result.error ?? "", /race buffer overflowed/);
    const failed = fixture.store.listEvents(fixture.task.id).find((e) => e.type === "worker.failed");
    assert.equal(
      (failed?.payload as { reasonCode?: string } | undefined)?.reasonCode,
      "codex-goal-turn-start-race-overflow",
    );
    assert.equal(result.resultText, undefined);
    assert.ok(!fixture.store.listEvents(fixture.task.id).some((e) => e.type === "worker.completed"));
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal correlates mismatched turn/started id over turn/start response id", async () => {
  // Real app-server shape: turn/started announces 3e47… while turn/start
  // returns 019f…; every later terminal notification uses the started id.
  const responseTurnId = "019fc060-63ab-7d92-99c2-07532d1876a5";
  const startedTurnId = "3e4710ff-2cf8-44e8-9e34-9b2f1ed5eee4";
  const fixture = await codexNativeGoalFixture({
    config: {
      batchAfter: ["turn/start"],
      responders: {
        "turn/start": { result: { turn: { id: responseTurnId } } },
      },
      after: {
        "turn/start": [
          { method: "turn/started", params: turnStartedParams(startedTurnId) },
          ...exactTurnTerminalAfter(startedTurnId, { text: "mismatched-id final" }),
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "succeeded");
    assert.equal(result.resultText, "mismatched-id final");
    const binding = await readBindingJson(fixture.bindingPath);
    assert.equal(binding.turnId, startedTurnId, "durable binding must persist the started Turn id");
    const completed = fixture.store.listEvents(fixture.task.id).find((e) => e.type === "worker.completed");
    assert.equal(
      (completed?.payload as { turnId?: string } | undefined)?.turnId,
      startedTurnId,
    );
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal turn/started matching response id remains compatible", async () => {
  const fixture = await codexNativeGoalFixture({
    config: {
      batchAfter: ["turn/start"],
      after: {
        "turn/start": [
          { method: "turn/started", params: turnStartedParams("turn-1") },
          ...exactTurnTerminalAfter("turn-1", { text: "matching-id final" }),
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "succeeded");
    assert.equal(result.resultText, "matching-id final");
    const binding = await readBindingJson(fixture.bindingPath);
    assert.equal(binding.turnId, "turn-1");
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal falls back to turn/start response id without turn/started", async () => {
  // Compatibility path: no turn/started in the race buffer; terminal evidence
  // uses the canonical response Turn id.
  const fixture = await codexNativeGoalFixture({
    config: {
      batchAfter: ["turn/start"],
      after: {
        "turn/start": exactTurnTerminalAfter("turn-1", { text: "response-id final" }),
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "succeeded");
    assert.equal(result.resultText, "response-id final");
    const binding = await readBindingJson(fixture.bindingPath);
    assert.equal(binding.turnId, "turn-1");
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal late first turn/started replaces an unused response-id fallback", async () => {
  const triggerRoot = await mkdtemp(path.join(tmpdir(), "fl-codex-late-start-trigger-"));
  const triggerPath = path.join(triggerRoot, "release");
  const responseTurnId = "response-turn";
  const actualTurnId = "actual-turn";
  let runPromise: ReturnType<typeof runCodexWorker> | undefined;
  const fixture = await codexNativeGoalFixture({
    config: {
      responders: {
        "turn/start": { result: { turn: { id: responseTurnId } } },
      },
      delayedAfter: {
        "turn/start": {
          triggerPath,
          notifications: [
            { method: "turn/started", params: turnStartedParams(actualTurnId) },
            ...exactTurnTerminalAfter(actualTurnId, { text: "late-start final" }),
          ],
        },
      },
    },
  });
  try {
    runPromise = runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(
      await waitForBindingTurnId(fixture.bindingPath, 10_000),
      responseTurnId,
      "response id is only a durable provisional fallback",
    );
    await writeFile(triggerPath, "release\n");
    const result = await runPromise;
    assert.equal(result.status, "succeeded");
    assert.equal(result.resultText, "late-start final");
    const binding = await readBindingJson(fixture.bindingPath);
    assert.equal(binding.turnId, actualTurnId);
  } finally {
    // Always release and join the fake Runtime, including assertion failures,
    // so one slow full-suite run cannot strand a child process indefinitely.
    await writeFile(triggerPath, "release\n").catch(() => undefined);
    await runPromise?.catch(() => undefined);
    fixture.store.close();
    await rm(triggerRoot, { recursive: true, force: true });
  }
});

test("Codex native Goal fails closed on ambiguous same-Thread turn/started ids", async () => {
  const fixture = await codexNativeGoalFixture({
    config: {
      batchAfter: ["turn/start"],
      after: {
        "turn/start": [
          { method: "turn/started", params: turnStartedParams("turn-a") },
          { method: "turn/started", params: turnStartedParams("turn-b") },
          ...exactTurnTerminalAfter("turn-a", { text: "should-not-win" }),
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /ambiguous Turn start identities/);
    const failed = fixture.store.listEvents(fixture.task.id).find((e) => e.type === "worker.failed");
    assert.equal(
      (failed?.payload as { reasonCode?: string } | undefined)?.reasonCode,
      "codex-goal-turn-start-ambiguous",
    );
    assert.equal(result.resultText, undefined);
    assert.ok(!fixture.store.listEvents(fixture.task.id).some((e) => e.type === "worker.completed"));
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal fails closed on malformed same-Thread turn/started payload", async () => {
  const fixture = await codexNativeGoalFixture({
    config: {
      batchAfter: ["turn/start"],
      after: {
        "turn/start": [
          { method: "turn/started", params: { threadId: "thread-1", turn: { id: "" } } },
          ...exactTurnTerminalAfter("turn-1", { text: "should-not-win" }),
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /without a canonical turn payload/);
    const failed = fixture.store.listEvents(fixture.task.id).find((e) => e.type === "worker.failed");
    assert.equal(
      (failed?.payload as { reasonCode?: string } | undefined)?.reasonCode,
      "codex-goal-turn-start-malformed",
    );
    assert.equal(result.resultText, undefined);
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal ignores unrelated-Thread turn/started during correlation", async () => {
  // Cross-Thread started traffic must not steal authority or fail the race.
  // Response-id fallback remains active and completes on exact current Turn.
  const fixture = await codexNativeGoalFixture({
    config: {
      batchAfter: ["turn/start"],
      after: {
        "turn/start": [
          { method: "turn/started", params: turnStartedParams("turn-other", "thread-other") },
          ...exactTurnTerminalAfter("turn-1", { text: "unrelated-started ignored" }),
        ],
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "succeeded");
    assert.equal(result.resultText, "unrelated-started ignored");
    const binding = await readBindingJson(fixture.bindingPath);
    assert.equal(binding.turnId, "turn-1");
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal continuation turn/started resets gates and completes the new Turn", async () => {
  // delayedAfter emits after activation so the continuation Turn is not part of
  // initial turn/start correlation. Prior Turn must end (completed/failed/
  // interrupted) before a distinct turn/started may promote; promotion waits
  // for durable binding before authority or gate reset.
  const values = { ...testDefaultAdvancedPolicy(), noProgressTimeoutMs: 200, workerStopGraceMs: 40 };
  const provenance = Object.fromEntries(
    Object.keys(values).map((field) => [field, "task"]),
  ) as Record<keyof typeof values, "task">;

  // Positive: turn-1 ends via turn/completed, then explicit turn/started
  // turn-2 promotes after durable write and supplies the full terminal join.
  // Same-burst turn-2 evidence is buffered during the write (persistence order).
  const fixture = await codexNativeGoalFixture({
    config: {
      batchAfter: ["turn/start"],
      after: {
        "turn/start": [
          { method: "turn/started", params: turnStartedParams("turn-1") },
          { method: "item/completed", params: itemCompletedParams({ turnId: "turn-1", text: "stale turn-1 final" }) },
          { method: "turn/completed", params: turnCompletedParams("completed", "turn-1") },
        ],
      },
      delayedAfter: {
        "turn/start": {
          delayMs: 40,
          notifications: [
            { method: "turn/started", params: turnStartedParams("turn-2") },
            // Stale turn-1 goal complete after authority moved must stay inert.
            { method: "thread/goal/updated", params: goalUpdatedParams("complete", { turnId: "turn-1" }) },
            ...exactTurnTerminalAfter("turn-2", { text: "continuation final" }),
          ],
        },
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "succeeded");
    assert.equal(result.resultText, "continuation final", "only the new Turn final may win");
    const binding = await readBindingJson(fixture.bindingPath);
    assert.equal(binding.turnId, "turn-2", "durable binding must reflect promoted Turn before success");
    const events = fixture.store.listEvents(fixture.task.id);
    const continuationIdx = events.findIndex(
      (e) => e.type === "worker.message" && e.summary.includes("continuation Turn"),
    );
    const completedIdx = events.findIndex((e) => e.type === "worker.completed");
    assert.ok(continuationIdx >= 0, "continuation promotion is observed");
    assert.ok(completedIdx >= 0, "worker.completed is observed");
    assert.equal(
      (events[continuationIdx]?.payload as { activityEvidence?: string } | undefined)?.activityEvidence,
      "liveness",
      "continuation turn start is liveness only and cannot buy watchdog time alone",
    );
    assert.ok(
      continuationIdx < completedIdx,
      "continuation message (post-durable-write) must precede terminal success",
    );
    assert.equal(
      (events[completedIdx]?.payload as { turnId?: string } | undefined)?.turnId,
      "turn-2",
    );
  } finally {
    fixture.store.close();
  }

  // Negative leak after valid prior end: turn-1 ends with final + completed
  // (not full success join). After durable promotion, only turn-2 completed
  // plus a stale turn-1 goal complete arrive. Reset gates must prevent
  // mixed-Turn success.
  const leaked = await codexNativeGoalFixture({
    effectivePolicy: {
      profileId: "test",
      values,
      provenance,
      enforcementCapability: enforcementCapabilityForRuntime("codex-cli"),
    },
    config: {
      batchAfter: ["turn/start"],
      after: {
        "turn/start": [
          { method: "item/completed", params: itemCompletedParams({ turnId: "turn-1", text: "leaked turn-1 final" }) },
          { method: "turn/completed", params: turnCompletedParams("completed", "turn-1") },
        ],
      },
      delayedAfter: {
        "turn/start": {
          delayMs: 40,
          notifications: [
            { method: "turn/started", params: turnStartedParams("turn-2") },
            // Stale turn-1 goal complete is inert after promotion; turn-2 only
            // completes the Turn gate. Without a gate reset, turn-1 final could
            // leak if authority moved too early without clearing.
            { method: "thread/goal/updated", params: goalUpdatedParams("complete", { turnId: "turn-1" }) },
            { method: "turn/completed", params: turnCompletedParams("completed", "turn-2") },
          ],
        },
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: leaked.store,
      task: leaked.task,
      attempt: leaked.attempt,
      resuming: false,
      hooks: {},
    }, leaked.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.equal(result.policyLimit?.category, "no-progress");
    assert.equal(result.resultText, undefined, "mixed-Turn gates must not invent resultText");
    assert.ok(!leaked.store.listEvents(leaked.task.id).some((e) => e.type === "worker.completed"));
  } finally {
    leaked.store.close();
  }
});

test("Codex native Goal rejects continuation before prior Turn ended", async () => {
  const fixture = await codexNativeGoalFixture({
    config: {
      batchAfter: ["turn/start"],
      after: {
        "turn/start": [
          // Partial evidence only — prior Turn never completed/failed/interrupted.
          { method: "item/completed", params: itemCompletedParams({ turnId: "turn-1", text: "still running" }) },
        ],
      },
      delayedAfter: {
        "turn/start": {
          delayMs: 40,
          notifications: [
            { method: "turn/started", params: turnStartedParams("turn-2") },
            ...exactTurnTerminalAfter("turn-2", { text: "should-not-win" }),
          ],
        },
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /before the prior Turn ended/);
    const failed = fixture.store.listEvents(fixture.task.id).find((e) => e.type === "worker.failed");
    assert.equal(
      (failed?.payload as { reasonCode?: string } | undefined)?.reasonCode,
      "codex-goal-turn-continuation-premature",
    );
    assert.equal(result.resultText, undefined);
    assert.ok(!fixture.store.listEvents(fixture.task.id).some((e) => e.type === "worker.completed"));
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal continuation allows promotion after failed prior Turn", async () => {
  const fixture = await codexNativeGoalFixture({
    config: {
      batchAfter: ["turn/start"],
      after: {
        "turn/start": [
          { method: "turn/completed", params: turnCompletedParams("failed", "turn-1") },
        ],
      },
      delayedAfter: {
        "turn/start": {
          delayMs: 40,
          notifications: [
            { method: "turn/started", params: turnStartedParams("turn-2") },
            ...exactTurnTerminalAfter("turn-2", { text: "after-failed-prior" }),
          ],
        },
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "succeeded");
    assert.equal(result.resultText, "after-failed-prior");
    const binding = await readBindingJson(fixture.bindingPath);
    assert.equal(binding.turnId, "turn-2");
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal fails closed on overlapping continuation turn/started", async () => {
  const fixture = await codexNativeGoalFixture({
    config: {
      batchAfter: ["turn/start"],
      after: {
        "turn/start": [
          { method: "turn/completed", params: turnCompletedParams("completed", "turn-1") },
        ],
      },
      delayedAfter: {
        "turn/start": {
          delayMs: 40,
          notifications: [
            { method: "turn/started", params: turnStartedParams("turn-2") },
            // Distinct start while turn-2 binding write / buffer is open.
            { method: "turn/started", params: turnStartedParams("turn-3") },
            ...exactTurnTerminalAfter("turn-2", { text: "should-not-win" }),
          ],
        },
      },
    },
  });
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /overlapping Turn start identities/);
    const failed = fixture.store.listEvents(fixture.task.id).find((e) => e.type === "worker.failed");
    assert.equal(
      (failed?.payload as { reasonCode?: string } | undefined)?.reasonCode,
      "codex-goal-turn-continuation-ambiguous",
    );
    assert.equal(result.resultText, undefined);
    assert.ok(!fixture.store.listEvents(fixture.task.id).some((e) => e.type === "worker.completed"));
    const binding = await readBindingJson(fixture.bindingPath);
    assert.equal(binding.turnId, "turn-1", "invalidated promotion must restore prior durable authority");
  } finally {
    fixture.store.close();
  }
});

test("Codex native Goal continuation binding write failure never succeeds", async () => {
  // After the prior Turn ends and the initial Turn binding is durable, replace
  // the binding path with a directory so the continuation write fails. Terminal
  // evidence for turn-2 must not produce success when authority was never
  // durably promoted.
  const triggerRoot = await mkdtemp(path.join(tmpdir(), "fl-codex-continuation-trigger-"));
  const triggerPath = path.join(triggerRoot, "release");
  const values = { ...testDefaultAdvancedPolicy(), noProgressTimeoutMs: 2_000, workerStopGraceMs: 40 };
  const provenance = Object.fromEntries(
    Object.keys(values).map((field) => [field, "task"]),
  ) as Record<keyof typeof values, "task">;
  const fixture = await codexNativeGoalFixture({
    effectivePolicy: {
      profileId: "test",
      values,
      provenance,
      enforcementCapability: enforcementCapabilityForRuntime("codex-cli"),
    },
    config: {
      batchAfter: ["turn/start"],
      after: {
        "turn/start": [
          { method: "turn/completed", params: turnCompletedParams("completed", "turn-1") },
        ],
      },
      delayedAfter: {
        "turn/start": {
          // The fake waits for an explicit file signal, so continuation cannot
          // race initial activation regardless of scheduler or machine load.
          triggerPath,
          notifications: [
            { method: "turn/started", params: turnStartedParams("turn-2") },
            ...exactTurnTerminalAfter("turn-2", { text: "must-not-succeed" }),
          ],
        },
      },
    },
  });
  try {
    const runPromise = runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    // Wait until initial Turn activation has durably written turnId, then poison
    // the binding path before the delayed continuation write.
    assert.equal(await waitForBindingTurnId(fixture.bindingPath), "turn-1");
    await unlink(fixture.bindingPath);
    await mkdir(fixture.bindingPath);
    await writeFile(triggerPath, "release\n");
    const result = await runPromise;
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /failed to persist Turn binding/);
    const failed = fixture.store.listEvents(fixture.task.id).find((e) => e.type === "worker.failed");
    assert.equal(
      (failed?.payload as { reasonCode?: string } | undefined)?.reasonCode,
      "codex-goal-binding-write-failed",
    );
    assert.equal(result.resultText, undefined);
    assert.ok(!fixture.store.listEvents(fixture.task.id).some((e) => e.type === "worker.completed"));
  } finally {
    fixture.store.close();
    await rm(triggerRoot, { recursive: true, force: true });
  }
});

test("Codex native Goal preserves resume-time same-Thread usage until identity is authoritative", async () => {
  const binding = await runInterruptedNativeGoal();
  const second = await codexNativeGoalFixture({
    config: {
      objective: binding.objective as string,
      goalStatus: "active",
      after: {
        // Older pending snapshot while resume identity validation is in flight.
        "thread/resume": [
          { method: "thread/tokenUsage/updated", params: goalUsageParams({
            tokenUsage: { total: { inputTokens: 40, outputTokens: 5, cachedInputTokens: 2, cacheWriteInputTokens: 0 } },
          }) },
        ],
        // Newer same-Thread snapshot around Goal identity confirmation / the
        // durable write window. Whether it lands as pending or bound, it must
        // replace 40 and never be overwritten by the older pending value.
        "thread/goal/get": [
          { method: "thread/tokenUsage/updated", params: goalUsageParams({
            tokenUsage: { total: { inputTokens: 90, outputTokens: 12, cachedInputTokens: 8, cacheWriteInputTokens: 1 } },
          }) },
          // Wrong-thread usage during validation must stay ignored.
          { method: "thread/tokenUsage/updated", params: goalUsageParams({
            threadId: "thread-other",
            tokenUsage: { total: { inputTokens: 999, outputTokens: 999, cachedInputTokens: 0, cacheWriteInputTokens: 0 } },
          }) },
        ],
        "turn/start": [
          { method: "item/completed", params: itemCompletedParams({ text: "resume final" }) },
          { method: "turn/completed", params: turnCompletedParams() },
          { method: "thread/goal/updated", params: goalUpdatedParams("complete") },
        ],
      },
    },
  });
  await writeFile(second.bindingPath, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600 });
  try {
    const result = await runCodexWorker({
      store: second.store,
      task: second.task,
      attempt: second.attempt,
      resuming: true,
      hooks: {},
    }, second.operatorCodexHome);
    assert.equal(result.status, "succeeded");
    assert.equal(result.resultText, "resume final");
    assert.equal(result.usage?.inputTokens, 90, "latest same-Thread snapshot becomes effective once");
    assert.equal(result.usage?.outputTokens, 12);
    assert.equal(result.usage?.cacheReadInputTokens, 8);
    assert.equal(result.usage?.cacheCreationInputTokens, 1);
  } finally {
    second.store.close();
  }
});

test("Codex native Goal resume write-window usage replaces promoted pending snapshot", async () => {
  // Pending usage is promoted before the durable binding write. A newer bound
  // same-Thread snapshot that arrives from the Goal-get after-burst (the
  // write-window race) must replace it; the older pending value must not win.
  const binding = await runInterruptedNativeGoal();
  const second = await codexNativeGoalFixture({
    config: {
      objective: binding.objective as string,
      goalStatus: "active",
      after: {
        "thread/resume": [
          { method: "thread/tokenUsage/updated", params: goalUsageParams({
            tokenUsage: { total: { inputTokens: 15, outputTokens: 1, cachedInputTokens: 0, cacheWriteInputTokens: 0 } },
          }) },
        ],
        "thread/goal/get": [
          { method: "thread/tokenUsage/updated", params: goalUsageParams({
            tokenUsage: { total: { inputTokens: 70, outputTokens: 9, cachedInputTokens: 3, cacheWriteInputTokens: 1 } },
          }) },
        ],
        "turn/start": [
          { method: "thread/tokenUsage/updated", params: goalUsageParams({
            tokenUsage: { total: { inputTokens: 120, outputTokens: 18, cachedInputTokens: 10, cacheWriteInputTokens: 2 } },
          }) },
          { method: "item/completed", params: itemCompletedParams({ text: "write-window final" }) },
          { method: "turn/completed", params: turnCompletedParams() },
          { method: "thread/goal/updated", params: goalUpdatedParams("complete") },
        ],
      },
    },
  });
  await writeFile(second.bindingPath, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600 });
  try {
    const result = await runCodexWorker({
      store: second.store,
      task: second.task,
      attempt: second.attempt,
      resuming: true,
      hooks: {},
    }, second.operatorCodexHome);
    assert.equal(result.status, "succeeded");
    assert.equal(result.resultText, "write-window final");
    assert.equal(result.usage?.inputTokens, 120, "post-identity snapshots replace earlier pending totals");
    assert.equal(result.usage?.outputTokens, 18);
    assert.equal(result.usage?.cacheReadInputTokens, 10);
    assert.equal(result.usage?.cacheCreationInputTokens, 2);
  } finally {
    second.store.close();
  }
});

// --- Per-Worker network policy applied to every built-in Runtime (FL-107) ---

function networkPolicyTaskRecord(networkPolicy: unknown): TaskRecord {
  const spec = parseTaskSpec(
    minimalContract({
      provider: { name: "deepseek", model: "deepseek-v4-flash", keychainService: "forklight.deepseek.api-key" },
      runtime: { name: "claude-code", executable: "claude", effort: "high", maxBudgetUsd: 0.1 },
      ...(networkPolicy === undefined ? {} : { networkPolicy }),
    }),
    "/tmp",
    policy(),
  ) as TaskSpec;
  return {
    id: "net-policy-task",
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
    sessionId: "net-policy-session",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

const PROXY_PARENT_KEYS = [
  "HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy",
  "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy",
] as const;

function withProxyParentEnv<T>(run: () => T): T {
  const previous: Partial<Record<(typeof PROXY_PARENT_KEYS)[number], string | undefined>> = {};
  for (const key of PROXY_PARENT_KEYS) {
    previous[key] = process.env[key];
    process.env[key] = `parent-${key}-value`;
  }
  try {
    return run();
  } finally {
    for (const key of PROXY_PARENT_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("Claude childEnvironment applies the frozen direct network policy without touching auth", () => {
  withProxyParentEnv(() => {
    const env = childEnvironment(networkPolicyTaskRecord({ mode: "direct" }), "test-api-key");
    for (const key of PROXY_PARENT_KEYS) {
      assert.equal(key in env, false, `${key} must be removed for direct mode`);
    }
    // Runtime authentication stays intact.
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, "test-api-key");
    assert.equal(env.CLAUDE_CONFIG_DIR, "/tmp/run/claude");
  });
});

test("Claude childEnvironment applies custom proxy with upper/lower consistency", () => {
  const env = childEnvironment(networkPolicyTaskRecord({
    mode: "custom-proxy",
    httpProxy: "http://127.0.0.1:7890",
    httpsProxy: "http://127.0.0.1:7891",
    noProxy: "localhost,127.0.0.1",
  }), "test-api-key");
  assert.equal(env.HTTP_PROXY, "http://127.0.0.1:7890");
  assert.equal(env.http_proxy, "http://127.0.0.1:7890");
  assert.equal(env.HTTPS_PROXY, "http://127.0.0.1:7891");
  assert.equal(env.https_proxy, "http://127.0.0.1:7891");
  assert.equal(env.NO_PROXY, "localhost,127.0.0.1");
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, "test-api-key");
});

test("Grok worker env builder applies the frozen network policy", () => {
  withProxyParentEnv(() => {
    const direct = buildGrokWorkerEnv("", "/task/grok-home", { mode: "direct" });
    for (const key of PROXY_PARENT_KEYS) {
      assert.equal(key in direct, false, `${key} must be removed for direct mode`);
    }
    assert.equal(direct.GROK_HOME, "/task/grok-home");
    assert.equal("XAI_API_KEY" in direct, false);

    const custom = buildGrokWorkerEnv("grok-key", "/task/grok-home", {
      mode: "custom-proxy",
      httpProxy: "http://127.0.0.1:7890",
    });
    assert.equal(custom.HTTP_PROXY, "http://127.0.0.1:7890");
    assert.equal(custom.http_proxy, "http://127.0.0.1:7890");
    assert.equal(custom.HTTPS_PROXY, "http://127.0.0.1:7890");
    assert.equal(custom.NO_PROXY, DEFAULT_NO_PROXY);
    assert.equal(custom.XAI_API_KEY, "grok-key");
    assert.equal("ALL_PROXY" in custom, false);
  });
});

test("Codex env builder applies the frozen network policy for both execution paths", () => {
  withProxyParentEnv(() => {
    const direct = buildCodexWorkerEnv("/task/codex-home", "/task/codex-tmp", { mode: "direct" });
    for (const key of PROXY_PARENT_KEYS) {
      assert.equal(key in direct, false, `${key} must be removed for direct mode`);
    }
    assert.equal(direct.CODEX_HOME, "/task/codex-home");

    const custom = buildCodexWorkerEnv("/task/codex-home", "/task/codex-tmp", {
      mode: "custom-proxy",
      httpProxy: "http://127.0.0.1:7890",
      httpsProxy: "http://127.0.0.1:7891",
      noProxy: "localhost,127.0.0.1",
    });
    assert.equal(custom.HTTP_PROXY, "http://127.0.0.1:7890");
    assert.equal(custom.HTTPS_PROXY, "http://127.0.0.1:7891");
    assert.equal(custom.NO_PROXY, "localhost,127.0.0.1");
    assert.equal("ALL_PROXY" in custom, false);
    // Codex authentication stripping stays intact.
    assert.equal("OPENAI_API_KEY" in custom, false);
    assert.equal("XAI_API_KEY" in custom, false);
  });
});

test("runCodexWorker applies the frozen network policy to the child environment", async () => {
  const fixture = await codexRuntimeFixture(
    [
      '{"type":"thread.started","thread_id":"thread-1"}',
      '{"type":"turn.started"}',
      '{"type":"item.started","item":{"id":"i1","type":"command_execution","command":"npm test"}}',
      '{"type":"item.completed","item":{"id":"i2","type":"agent_message","text":"done"}}',
      '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}',
    ],
    0,
    {
      mode: "custom-proxy",
      httpProxy: "http://127.0.0.1:7890",
      httpsProxy: "http://127.0.0.1:7891",
      noProxy: "localhost,127.0.0.1",
    },
  );
  const parent = PROXY_PARENT_KEYS.map((key) => [key, process.env[key]] as const);
  for (const [key, value] of parent) {
    process.env[key] = value ?? `parent-${key}`;
  }
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "succeeded");

    const envDump = JSON.parse(
      await readFile(path.join(fixture.workspace, "codex-env-dump.json"), "utf8"),
    ) as Record<string, string | null>;
    assert.equal(envDump.HTTP_PROXY, "http://127.0.0.1:7890");
    assert.equal(envDump.http_proxy, "http://127.0.0.1:7890");
    assert.equal(envDump.HTTPS_PROXY, "http://127.0.0.1:7891");
    assert.equal(envDump.https_proxy, "http://127.0.0.1:7891");
    assert.equal(envDump.NO_PROXY, "localhost,127.0.0.1");
    assert.equal(envDump.no_proxy, "localhost,127.0.0.1");
    assert.equal(envDump.ALL_PROXY, null, "ALL_PROXY is cleaned before setting custom values");
  } finally {
    for (const [key, value] of parent) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fixture.store.close();
  }
});

test("runCodexNativeGoal applies the frozen network policy to the app-server child", async () => {
  const fixture = await codexNativeGoalFixture({
    config: {
      after: {
        "turn/start": exactCurrentTurnTerminalAfter(),
      },
    },
    networkPolicy: { mode: "direct" },
  });
  const parent = PROXY_PARENT_KEYS.map((key) => [key, process.env[key]] as const);
  for (const [key, value] of parent) {
    process.env[key] = value ?? `parent-${key}`;
  }
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "succeeded");

    const envDump = JSON.parse(
      await readFile(path.join(fixture.task.paths.workspace, "codex-goal-env-dump.json"), "utf8"),
    ) as Record<string, string | null>;
    for (const key of PROXY_PARENT_KEYS) {
      assert.ok(
        envDump[key] === null || envDump[key] === undefined,
        `${key} must be absent or null for direct mode in the app-server child`,
      );
    }
  } finally {
    for (const [key, value] of parent) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fixture.store.close();
  }
});

test("Worker-start events record only the network mode, never proxy values", async () => {
  const proxyUrl = "http://127.0.0.1:7890";
  const fixture = await codexRuntimeFixture(
    [
      '{"type":"thread.started","thread_id":"thread-1"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"i2","type":"agent_message","text":"done"}}',
      '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}',
    ],
    0,
    { mode: "custom-proxy", httpProxy: proxyUrl },
  );
  try {
    const result = await runCodexWorker({
      store: fixture.store,
      task: fixture.task,
      attempt: fixture.attempt,
      resuming: false,
      hooks: {},
    }, fixture.operatorCodexHome);
    assert.equal(result.status, "succeeded");
    const events = fixture.store.listEvents(fixture.task.id);
    const started = events.find((event) => event.type === "worker.started");
    assert.ok(started, "worker.started event exists");
    assert.equal(
      (started.payload as { networkPolicyMode?: string }).networkPolicyMode,
      "custom-proxy",
      "start event records the safe mode",
    );
    for (const event of events) {
      const blob = JSON.stringify(event);
      assert.ok(!blob.includes(proxyUrl), "proxy URL must never reach durable events");
      assert.ok(!blob.includes("127.0.0.1:7890"), "proxy host:port must never reach durable events");
    }
    assert.ok(
      validateWorkerNetworkPolicy(fixture.task.spec.networkPolicy) !== undefined,
      "frozen policy still validates",
    );
  } finally {
    fixture.store.close();
  }
});
