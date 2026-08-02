import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildTaskRecord, createTask, registerTaskFromSpec } from "../src/core/runner.js";
import {
  REVIEW_SUMMARY_MAX,
  reviewerOutputBoundsLine,
} from "../src/core/review-graph.js";
import {
  assessTaskQuality,
  buildWorkerPrompt,
  GENERIC_CODING_SUMMARY_INSTRUCTION,
  isReviewGraphReviewerTaskFile,
  loadTaskSpec,
  parseTaskSpec,
  reviewerTerminalOutputLines,
  workerPromptAppendicesForTask,
} from "../src/core/task.js";
import { attemptRuntimeBudget, budgetArguments } from "../src/workers/claude.js";
import { cloneDefaults, type ContractQualitySettings, type TaskPolicy } from "../src/core/settings.js";
import { upsertModelConfig } from "../src/core/model-catalog.js";
import { upsertWorkerProfile } from "../src/core/worker-profiles.js";
import { validateDeliveryProfilesSettings } from "../src/core/delivery-profiles.js";
import type {
  AttemptRecord,
  ContractTaskSpec,
  EventRecord,
  QualityReport,
  TaskRecord,
  VerificationCommandResult,
  VerificationResult,
} from "../src/core/types.js";
import { StateStore } from "../src/state/store.js";

test("loads a legacy task and resolves a relative project", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-task-"));
  const project = path.join(root, "project");
  await mkdir(project);
  const taskFile = path.join(root, "task.yaml");
  await writeFile(
    taskFile,
    `version: 1
name: Example
project: ./project
goal: Make the example pass
acceptance:
  commands:
    - node --test
`,
  );
  const loaded = await loadTaskSpec(taskFile);
  assert.equal(loaded.spec.project, project);
  assert.equal(loaded.spec.provider.model, "deepseek-v4-flash");
  assert.equal(loaded.spec.runtime.name, "claude-code");
  assert.ok(loaded.spec.workspace.exclude.includes(".forklight-dev"));
  assert.ok(loaded.spec.workspace.exclude.includes(".forklight-daemon-test"));
});

test("accepts a complete version 2 Task Contract with a perfect quality score", async () => {
  const loaded = await loadTaskSpec(path.resolve("examples/deepseek-checkout.yaml"));
  assert.equal(loaded.spec.version, 2);
  const quality = assessTaskQuality(loaded.spec);
  assert.equal(quality.passed, true);
  assert.equal(quality.score, 100);
});

test("includes independent verification feedback in a resumed Worker prompt", async () => {
  const loaded = await loadTaskSpec(path.resolve("examples/deepseek-checkout.yaml"));
  const prompt = buildWorkerPrompt(
    loaded.spec,
    true,
    "Independent npm test failed because the new boundary assertion was incorrect.",
  );
  assert.match(prompt, /Correction feedback from independent verification/);
  assert.match(prompt, /boundary assertion was incorrect/);
});

test("ordinary Task prompts keep the generic coding summary; reviewer Tasks replace it", async () => {
  const loaded = await loadTaskSpec(path.resolve("examples/deepseek-checkout.yaml"));
  const ordinary = buildWorkerPrompt(loaded.spec, false);
  assert.ok(ordinary.includes(GENERIC_CODING_SUMMARY_INSTRUCTION));
  assert.ok(!ordinary.includes("Return exactly one raw JSON object"));
  // Ordinary Workers must not receive reviewer JSON field bounds.
  assert.ok(!ordinary.includes(reviewerOutputBoundsLine()));
  assert.ok(!ordinary.includes(`summary ≤ ${REVIEW_SUMMARY_MAX} chars`));

  assert.equal(
    isReviewGraphReviewerTaskFile("forklight://review-graph/g1/assignment/a1"),
    true,
  );
  const reviewerPrompt = buildWorkerPrompt(
    loaded.spec,
    false,
    undefined,
    workerPromptAppendicesForTask(
      { taskFile: "forklight://review-graph/g1/assignment/a1" },
    ),
  );
  for (const line of reviewerTerminalOutputLines()) {
    assert.ok(reviewerPrompt.includes(line), `missing: ${line}`);
  }
  assert.ok(!reviewerPrompt.includes(GENERIC_CODING_SUMMARY_INSTRUCTION));
  // Reviewer-only terminal instructions expose exact parser numeric bounds.
  assert.ok(reviewerPrompt.includes(reviewerOutputBoundsLine()));
});

test("prompts the Worker to run the bounded non-authoritative checkpoint when available", async () => {
  const loaded = await loadTaskSpec(path.resolve("examples/deepseek-checkout.yaml"));
  const prompt = buildWorkerPrompt(loaded.spec, false);

  assert.match(prompt, /mcp__forklight_checkpoint__run/);
  assert.match(prompt, /acceptance-1/);
  assert.match(prompt, /non-authoritative/i);
  assert.match(prompt, /authoritative for success/i);
});

test("builds complete remediation from the latest independent verification", async () => {
  const failedOne: VerificationCommandResult = {
    command: "npm test",
    exitCode: 1,
    stdout: "",
    stderr: "first failure",
    durationMs: 10,
    timedOut: false,
  };
  const passedOne: VerificationCommandResult = {
    command: "npm run typecheck",
    exitCode: 0,
    stdout: "types pass",
    stderr: "",
    durationMs: 20,
    timedOut: false,
  };
  const failedTwo: VerificationCommandResult = {
    command: "npm run lint",
    exitCode: 2,
    stdout: "lint output",
    stderr: "second failure",
    durationMs: 30,
    timedOut: false,
  };
  const verification: VerificationResult = {
    passed: false,
    behaviorPassed: false,
    policyPassed: false,
    sourceCompatible: false,
    commands: [failedOne, passedOne, failedTwo],
    diffPath: "/tmp/diff.patch",
    sourceUnchanged: false,
    sourceCompatibility: {
      compatible: false,
      affectedPaths: ["src/a.ts"],
      conflictingPaths: ["src/a.ts"],
      unrelatedDriftPaths: ["README.md"],
    },
    changeBudget: {
      filesChanged: 5,
      changedLines: 410,
      maxFiles: 4,
      maxDiffLines: 300,
      withinBudget: false,
      mode: "hard",
      effect: "hard-fail",
    },
    completionPolicy: {
      check: "satisfied",
      noChangeMode: "hard",
      message: "Worker delivered changes",
    },
  };
  const events: EventRecord[] = [
    {
      id: 1,
      taskId: "task",
      attemptId: "attempt-1",
      sequence: 1,
      timestamp: "2026-07-23T00:00:00.000Z",
      type: "verification.completed",
      summary: "Older verification",
      payload: { ...verification, commands: [failedOne] },
    },
    {
      id: 2,
      taskId: "task",
      attemptId: "attempt-2",
      sequence: 2,
      timestamp: "2026-07-23T00:01:00.000Z",
      type: "verification.completed",
      summary: "Latest verification",
      payload: verification,
    },
  ];

  const { buildRemediationPacket, formatRemediationPacket } = await import(
    "../src/core/remediation.js"
  );
  const packet = buildRemediationPacket(events);

  assert.ok(packet);
  assert.equal(packet.verificationEventSequence, 2);
  assert.deepEqual(packet.failedCommands, [failedOne, failedTwo]);
  assert.ok(packet.passedChecks.includes("Command passed: npm run typecheck"));
  assert.ok(packet.policyFindings.some((finding) => finding.includes("5/4 files")));
  assert.deepEqual(packet.sourceConflicts, ["src/a.ts"]);
  assert.doesNotMatch(JSON.stringify(packet), /README\.md/);

  const feedback = formatRemediationPacket(packet);
  assert.match(feedback, /npm test/);
  assert.match(feedback, /npm run lint/);
  assert.match(feedback, /first failure/);
  assert.match(feedback, /second failure/);
});

test("rejects an underspecified version 2 Task Contract before execution", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-task-"));
  await mkdir(path.join(root, "project"));
  const taskFile = path.join(root, "task.yaml");
  await writeFile(
    taskFile,
    `version: 2
name: Vague task
project: ./project
contract:
  outcome: Fix it
  context: []
  inScope: []
  outOfScope: []
  executionSteps: []
  deliverables: []
  modules: []
  callChain: []
  scenarios: []
  risks: []
  changeBudget:
    maxFiles: 4
    maxDiffLines: 300
acceptance:
  criteria: []
  commands:
    - npm test
`,
  );
  await assert.rejects(() => loadTaskSpec(taskFile), /quality gate failed/);
});

test("rejects a task whose declared change surface is too broad", async () => {
  const loaded = await loadTaskSpec(path.resolve("examples/deepseek-checkout.yaml"));
  assert.equal(loaded.spec.version, 2);
  if (loaded.spec.version !== 2) return;
  loaded.spec.contract.changeBudget.maxFiles = 13;
  const quality = assessTaskQuality(loaded.spec);
  assert.equal(quality.passed, false);
  assert.match(quality.issues.join("\n"), /Bounded change surface/);
});

test("rejects tasks without an independent acceptance command", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-task-"));
  await mkdir(path.join(root, "project"));
  const taskFile = path.join(root, "task.yaml");
  await writeFile(taskFile, "version: 1\nname: Missing verifier\nproject: ./project\ngoal: Test\n");
  await assert.rejects(() => loadTaskSpec(taskFile), /acceptance\.commands/);
});

test("rejects direct Worker shell commands in P2", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-task-"));
  await mkdir(path.join(root, "project"));
  const taskFile = path.join(root, "task.yaml");
  await writeFile(
    taskFile,
    `version: 1
name: Unsafe shell
project: ./project
goal: Test
worker:
  allowedCommands:
    - git status
acceptance:
  commands:
    - node --test
`,
  );
  await assert.rejects(() => loadTaskSpec(taskFile), /allowedCommands to be empty/);
});

test("builds deterministic task records before persistence", async () => {
  const { spec } = await loadTaskSpec(path.resolve("examples/deepseek-checkout.yaml"));
  const input = {
    spec,
    taskFile: "/tmp/plan-item.yaml",
    home: "/tmp/forklight-home",
    id: "task-id",
    sessionId: "session-id",
    createdAt: "2026-07-22T00:00:00.000Z",
  };

  const first = buildTaskRecord(input);
  assert.deepEqual(buildTaskRecord(input), first);
  assert.equal(first.status, "queued");
  assert.equal(first.paths.root, path.join(input.home, "runs", input.id));
  assert.equal(first.updatedAt, input.createdAt);
});

test("standalone registration still persists one task and creation event", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-registration-"));
  const store = new StateStore(home);
  try {
    const { spec, taskFile } = await loadTaskSpec(path.resolve("examples/deepseek-checkout.yaml"));
    const record = registerTaskFromSpec(store, spec, taskFile);

    assert.deepEqual(store.getTask(record.id), record);
    assert.notEqual(record.id, record.sessionId);
    assert.deepEqual(store.listEvents(record.id).map((event) => event.type), ["task.created"]);
  } finally {
    store.close();
  }
});

test("stricter configured maxFiles policy fails task that passes built-in defaults", () => {
  // Parse with built-in defaults so the spec is accepted.
  const spec = parseTaskSpec(
    {
      version: 2,
      name: "Small surface task",
      project: process.cwd(),
      contract: {
        outcome: "A short goal that is way too brief",
        context: ["one"],
        inScope: ["one"],
        outOfScope: ["one"],
        executionSteps: ["one"],
        deliverables: ["one"],
        modules: [{
          name: "a", responsibility: "long enough here",
          consumes: ["one"], produces: ["one"], boundaries: ["one"],
        }],
        callChain: ["producer", "consumer"],
        scenarios: [
          { name: "happy", given: "x", when: "y", then: "z" },
          { name: "sad", given: "a", when: "b", then: "c" },
        ],
        risks: ["one"],
        changeBudget: { maxFiles: 5, maxDiffLines: 250 },
      },
      worker: { focusPaths: ["a.ts", "b.ts"] },
      acceptance: { criteria: ["c"], commands: ["true"] },
    },
    process.cwd(),
  );
  // Default assessment passes (5 ≤ 12, 250 ≤ 1200).
  assert.equal(assessTaskQuality(spec).passed, true);
  // Configured maxFiles=4 is stricter; 5 > 4 → fails.
  const strict: ContractQualitySettings = {
    maxFiles: 4, maxDiffLines: 1200, maxFocusPaths: 8,
    minScenarios: 2, minCallChainSteps: 2,
    minOutcomeCharacters: 12, minModuleResponsibilityCharacters: 8,
  };
  const quality = assessTaskQuality(spec, strict);
  assert.equal(quality.passed, false);
  assert.match(quality.issues.join("\n"), /Bounded change surface/);
});

test("configured quality limits appear in diagnostic detail strings", () => {
  // Parse with built-in defaults first.
  const spec = parseTaskSpec(
    {
      version: 2,
      name: "Diagnostic task",
      project: process.cwd(),
      contract: {
        outcome: "A somewhat longer goal statement",
        context: ["ctx"],
        inScope: ["one"], outOfScope: ["one"],
        executionSteps: ["s"], deliverables: ["d"],
        modules: [{ name: "m", responsibility: "enough chars here", consumes: ["c"], produces: ["p"], boundaries: ["b"] }],
        callChain: ["a", "b"],
        scenarios: [
          { name: "only", given: "g", when: "w", then: "t" },
          { name: "also", given: "g", when: "w", then: "t" },
        ],
        risks: ["r"],
        changeBudget: { maxFiles: 12, maxDiffLines: 1200 },
      },
      worker: { focusPaths: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"] },
      acceptance: { criteria: ["c"], commands: ["true"] },
    },
    process.cwd(),
  );
  // Custom policy clamps maxFiles, maxDiffLines, and maxFocusPaths lower.
  const custom: ContractQualitySettings = {
    maxFiles: 6, maxDiffLines: 500, maxFocusPaths: 4,
    minScenarios: 2, minCallChainSteps: 2,
    minOutcomeCharacters: 12, minModuleResponsibilityCharacters: 8,
  };
  const quality = assessTaskQuality(spec, custom);
  const issueText = quality.issues.join("\n");
  assert.match(issueText, /at most 6 files/);
  assert.match(issueText, /500 added\/deleted lines/);
  assert.match(issueText, /one to 4 files/);
});

// --- placeholder hard gate vs wording warning (FL-D70 / FL-D112) ---

function assessWithContract(contractOverrides: Record<string, unknown>): QualityReport {
  const base = contractSpec();
  const spec = parseTaskSpec(
    { ...base, contract: { ...(base.contract as Record<string, unknown>), ...contractOverrides } },
    process.cwd(),
  );
  return assessTaskQuality(spec);
}

test("clean contract passes with no wording warnings", () => {
  const report = assessWithContract({});
  assert.equal(report.passed, true);
  assert.equal(report.warnings.length, 0);
});

test("natural-language 'unknown' is a non-blocking warning with field location (FL-D70)", () => {
  // A contract that legitimately describes an "unknown Task" error scenario must
  // not be hard-rejected merely for containing the word "unknown".
  const report = assessWithContract({ context: ["Handles unknown Task errors gracefully"] });
  assert.equal(report.passed, true);
  const warning = report.warnings.find((w) => w.term.toLowerCase() === "unknown");
  assert.ok(warning, "expected an 'unknown' wording warning");
  assert.equal(warning!.field, "contract.context[0]");
  assert.match(warning!.excerpt, /unknown/i);
  const placeholder = report.checks.find((c) => c.id === "placeholders");
  assert.ok(placeholder?.passed, "placeholders hard gate must not trip on the word 'unknown'");
});

test("'unknown completion evidence' passes structurally (FL-D112)", () => {
  const report = assessWithContract({ risks: ["Downgrade path for unknown completion evidence"] });
  assert.equal(report.passed, true);
  assert.ok(report.warnings.some((w) => w.term.toLowerCase() === "unknown"));
});

test("template sentinel {{...}} hard-fails at parse time and names the field", () => {
  assert.throws(
    () => assessWithContract({ outcome: "Replace {{owner}} with the real owner name here" }),
    /Remove template placeholders in: contract\.outcome/,
  );
});

test("assessTaskQuality marks a sentinel field as a hard failure, not a warning", () => {
  const clean = parseTaskSpec(contractSpec(), process.cwd()) as ContractTaskSpec;
  const spec: ContractTaskSpec = {
    ...clean,
    contract: { ...clean.contract, outcome: "Replace {{owner}} with the real owner name here" },
  };
  const report = assessTaskQuality(spec);
  assert.equal(report.passed, false);
  const placeholder = report.checks.find((c) => c.id === "placeholders");
  assert.equal(placeholder?.passed, false);
  assert.match(placeholder!.detail, /contract\.outcome/);
  assert.ok(
    !report.warnings.some((w) => w.field === "contract.outcome"),
    "a sentinel field should not also produce a wording warning",
  );
});

test("all-caps TODO is a hard sentinel at parse time; lowercase 'todo' is only a warning", () => {
  assert.throws(
    () => assessWithContract({ context: ["Remember the TODO marker from the template"] }),
    /Remove template placeholders in: contract\.context\[0\]/,
  );
  const lower = assessWithContract({ context: ["Add a todo list feature to the sidebar"] });
  assert.equal(lower.passed, true);
  assert.ok(lower.warnings.some((w) => w.term.toLowerCase() === "todo"));
});

test("Chinese uncertainty phrase '待定' is a warning, not a hard gate", () => {
  const report = assessWithContract({ risks: ["处理待定状态下的回退逻辑"] });
  assert.equal(report.passed, true);
  assert.ok(report.warnings.some((w) => w.term === "待定"));
});

test("loadTaskSpec threads quality settings through to rejection", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-task-"));
  await mkdir(path.join(root, "project"));
  const taskFile = path.join(root, "task.yaml");
  await writeFile(
    taskFile,
    `version: 2
name: Tiny limit
project: ./project
contract:
  outcome: A reasonable outcome description
  context: [c]
  inScope: [i]
  outOfScope: [o]
  executionSteps: [s]
  deliverables: [d]
  modules:
    - name: m
      responsibility: long enough responsibility
      consumes: [c]
      produces: [p]
      boundaries: [b]
  callChain: [a, b]
  scenarios:
    - name: normal
      given: g
      when: w
      then: t
    - name: edge
      given: g
      when: w
      then: t
  risks: [r]
  changeBudget:
    maxFiles: 3
    maxDiffLines: 100
acceptance:
  criteria: [c]
  commands:
    - "true"
`,
  );
  const strict: ContractQualitySettings = {
    maxFiles: 2, maxDiffLines: 50, maxFocusPaths: 2,
    minScenarios: 2, minCallChainSteps: 2,
    minOutcomeCharacters: 12, minModuleResponsibilityCharacters: 8,
  };
  const defaults = cloneDefaults();
  const policy: TaskPolicy = {
    contractQuality: strict,
    execution: defaults.execution,
    providerDefaults: defaults.providerDefaults,
    completionPolicy: defaults.completionPolicy,
  };
  // Strict maxFiles=2 rejects spec whose changeBudget.maxFiles=3.
  await assert.rejects(
    () => loadTaskSpec(taskFile, policy),
    /quality gate failed/,
  );
});

test("configured provider defaults propagate to task spec when fields are omitted", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-task-"));
  await mkdir(path.join(root, "project"));
  const taskFile = path.join(root, "task.yaml");
  await writeFile(
    taskFile,
    `version: 2
name: Provider default test
project: ./project
worker:
  focusPaths: [src]
contract:
  outcome: A reasonable outcome description
  context: [c]
  inScope: [i]
  outOfScope: [o]
  executionSteps: [s]
  deliverables: [d]
  modules:
    - name: m
      responsibility: long enough responsibility
      consumes: [c]
      produces: [p]
      boundaries: [b]
  callChain: [a, b]
  scenarios:
    - name: normal
      given: g
      when: w
      then: t
    - name: edge
      given: g
      when: w
      then: t
  risks: [r]
  changeBudget:
    maxFiles: 4
    maxDiffLines: 300
acceptance:
  criteria: [c]
  commands:
    - "true"
`,
  );
  const defaults = cloneDefaults();
  const policy: TaskPolicy = {
    contractQuality: defaults.contractQuality,
    execution: {
      ...defaults.execution,
      defaultProvider: "qwen",
      defaultEffort: "low",
      defaultMaxBudgetUsd: 1.5,
    },
    providerDefaults: {
      ...defaults.providerDefaults,
      qwen: {
        ...defaults.providerDefaults.qwen,
        defaultModel: "qwen3.7-plus-custom",
        defaultEndpoint: "https://custom.example.com/anthropic",
        defaultKeychainService: "forklight.custom.keychain",
      },
    },
    completionPolicy: defaults.completionPolicy,
  };
  const loaded = await loadTaskSpec(taskFile, policy);
  assert.equal(loaded.spec.provider.name, "qwen");
  assert.equal(loaded.spec.provider.model, "qwen3.7-plus-custom");
  assert.equal(loaded.spec.provider.endpoint, "https://custom.example.com/anthropic");
  assert.equal(loaded.spec.provider.keychainService, "forklight.custom.keychain");
  assert.equal(loaded.spec.runtime.effort, "low");
  assert.equal(loaded.spec.runtime.maxBudgetUsd, 1.5);
});

test("explicit task values override configured defaults", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-task-"));
  await mkdir(path.join(root, "project"));
  const taskFile = path.join(root, "task.yaml");
  await writeFile(
    taskFile,
    `version: 2
name: Explicit win test
project: ./project
provider:
  name: minimax
  model: MiniMax-M3-explicit
  endpoint: https://explicit.example.com/anthropic
  keychainService: forklight.explicit.keychain
runtime:
  effort: max
  maxBudgetUsd: 5.0
worker:
  focusPaths: [src]
contract:
  outcome: A reasonable outcome description
  context: [c]
  inScope: [i]
  outOfScope: [o]
  executionSteps: [s]
  deliverables: [d]
  modules:
    - name: m
      responsibility: long enough responsibility
      consumes: [c]
      produces: [p]
      boundaries: [b]
  callChain: [a, b]
  scenarios:
    - name: normal
      given: g
      when: w
      then: t
    - name: edge
      given: g
      when: w
      then: t
  risks: [r]
  changeBudget:
    maxFiles: 4
    maxDiffLines: 300
acceptance:
  criteria: [c]
  commands:
    - "true"
`,
  );
  const defaults = cloneDefaults();
  const policy: TaskPolicy = {
    contractQuality: defaults.contractQuality,
    execution: {
      ...defaults.execution,
      defaultProvider: "deepseek",
      defaultEffort: "low",
      defaultMaxBudgetUsd: 0.1,
    },
    providerDefaults: {
      ...defaults.providerDefaults,
      minimax: {
        ...defaults.providerDefaults.minimax,
        defaultModel: "MiniMax-M3-config",
        defaultEndpoint: "https://config.example.com/anthropic",
        defaultKeychainService: "forklight.config.keychain",
      },
    },
    completionPolicy: defaults.completionPolicy,
  };
  const loaded = await loadTaskSpec(taskFile, policy);
  // Explicit values win even though configured defaults differ.
  assert.equal(loaded.spec.provider.name, "minimax");
  assert.equal(loaded.spec.provider.model, "MiniMax-M3-explicit");
  assert.equal(loaded.spec.provider.endpoint, "https://explicit.example.com/anthropic");
  assert.equal(loaded.spec.provider.keychainService, "forklight.explicit.keychain");
  assert.equal(loaded.spec.runtime.effort, "max");
  assert.equal(loaded.spec.runtime.maxBudgetUsd, 5.0);
});

test("creation-time boundary: later settings changes do not mutate stored TaskRecords", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-immutable-"));
  const store = new StateStore(home);
  const root = await mkdtemp(path.join(tmpdir(), "forklight-task-"));
  await mkdir(path.join(root, "project"));
  const taskFile = path.join(root, "task.yaml");
  await writeFile(
    taskFile,
    `version: 2
name: Immutable test
project: ./project
worker:
  focusPaths: [src]
contract:
  outcome: A reasonable outcome description
  context: [c]
  inScope: [i]
  outOfScope: [o]
  executionSteps: [s]
  deliverables: [d]
  modules:
    - name: m
      responsibility: long enough responsibility
      consumes: [c]
      produces: [p]
      boundaries: [b]
  callChain: [a, b]
  scenarios:
    - name: normal
      given: g
      when: w
      then: t
    - name: edge
      given: g
      when: w
      then: t
  risks: [r]
  changeBudget:
    maxFiles: 4
    maxDiffLines: 300
acceptance:
  criteria: [c]
  commands:
    - "true"
`,
  );
  try {
    const defaults = cloneDefaults();
    const policy1: TaskPolicy = {
      contractQuality: defaults.contractQuality,
      execution: {
        ...defaults.execution,
        defaultProvider: "deepseek",
      },
      providerDefaults: {
        ...defaults.providerDefaults,
        deepseek: {
          ...defaults.providerDefaults.deepseek,
          defaultModel: "first-model",
        },
      },
      completionPolicy: defaults.completionPolicy,
    };
    const { spec: spec1 } = await loadTaskSpec(taskFile, policy1);
    const record1 = registerTaskFromSpec(store, spec1, taskFile);
    assert.equal(record1.spec.provider.model, "first-model");

    // Change settings — create a second policy with different defaults.
    const policy2: TaskPolicy = {
      contractQuality: defaults.contractQuality,
      execution: {
        ...defaults.execution,
        defaultProvider: "qwen",
      },
      providerDefaults: {
        ...defaults.providerDefaults,
        qwen: {
          ...defaults.providerDefaults.qwen,
          defaultModel: "second-model",
        },
      },
      completionPolicy: defaults.completionPolicy,
    };
    const { spec: spec2 } = await loadTaskSpec(taskFile, policy2);
    const record2 = registerTaskFromSpec(store, spec2, taskFile);

    // First record still has first-model — immutable.
    const stored1 = store.getTask(record1.id);
    assert.equal(stored1.spec.provider.model, "first-model");
    assert.equal(stored1.spec.provider.name, "deepseek");

    // Second record uses second-model — only future tasks reflect new defaults.
    const stored2 = store.getTask(record2.id);
    assert.equal(stored2.spec.provider.model, "second-model");
    assert.equal(stored2.spec.provider.name, "qwen");

    assert.notEqual(record1.id, record2.id);
  } finally {
    store.close();
  }
});

// --- unlimited budget semantics ---

function contractSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 2,
    name: "Budget test",
    project: process.cwd(),
    contract: {
      outcome: "A reasonable outcome description",
      context: ["c"], inScope: ["i"], outOfScope: ["o"],
      executionSteps: ["s"], deliverables: ["d"],
      modules: [{ name: "m", responsibility: "long enough responsibility", consumes: ["c"], produces: ["p"], boundaries: ["b"] }],
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
    ...overrides,
  };
}

function policyWithBudget(defaultMaxBudgetUsd: number | null): TaskPolicy {
  const defaults = cloneDefaults();
  return {
    contractQuality: defaults.contractQuality,
    execution: { ...defaults.execution, defaultMaxBudgetUsd },
    providerDefaults: defaults.providerDefaults,
    completionPolicy: defaults.completionPolicy,
  };
}

test("generated path patterns are snapped and unsafe patterns are rejected", () => {
  const parsed = parseTaskSpec(
    contractSpec({ workspace: { generatedPaths: ["**/.custom-cache/**"] } }),
    process.cwd(),
  );
  assert.deepEqual(parsed.workspace.generatedPaths, ["**/.custom-cache/**"]);

  for (const generatedPath of [
    " **/.cache/**",
    "/tmp/cache/**",
    "../cache/**",
    "pkg\\cache\\**",
    `cache\0/**`,
  ]) {
    assert.throws(
      () => parseTaskSpec(
        contractSpec({ workspace: { generatedPaths: [generatedPath] } }),
        process.cwd(),
      ),
      /task\.workspace\.generatedPaths/,
    );
  }
});

test("workspace excludes fail fast unless every entry is one path-segment name", () => {
  const parsed = parseTaskSpec(
    contractSpec({ workspace: { exclude: ["target", "coverage", "target"] } }),
    process.cwd(),
  );
  assert.ok(parsed.workspace.exclude.includes("target"));
  assert.ok(parsed.workspace.exclude.includes("coverage"));
  assert.equal(parsed.workspace.exclude.filter((name) => name === "target").length, 1);

  for (const exclude of [
    "src-tauri/target",
    "src-tauri\\target",
    "**/target/**",
    "target*",
    ".",
    "..",
  ]) {
    assert.throws(
      () => parseTaskSpec(
        contractSpec({ workspace: { exclude: [exclude] } }),
        process.cwd(),
      ),
      /task\.workspace\.exclude\[0\].*one directory or file name.*use target instead of src-tauri\/target/,
    );
  }
});

test("delivery commands preserve order and reject unsafe shapes", () => {
  const parsed = parseTaskSpec(
    contractSpec({
      delivery: {
        buildCommands: ["npm run build", "npm run package"],
        activationCommands: ["forklight daemon restart"],
        activationCheckCommands: ["forklight health --json"],
      },
    }),
    process.cwd(),
  );
  assert.deepEqual(parsed.delivery, {
    buildCommands: ["npm run build", "npm run package"],
    activationCommands: ["forklight daemon restart"],
    activationCheckCommands: ["forklight health --json"],
  });

  for (const delivery of [
    { buildCommands: "npm run build" },
    { buildCommands: [" "] },
    { buildCommands: Array.from({ length: 17 }, () => "true") },
    { buildCommands: [], unknown: [] },
  ]) {
    assert.throws(
      () => parseTaskSpec(contractSpec({ delivery }), process.cwd()),
      /task\.delivery/,
    );
  }
});

test("null default propagates to runtime spec when task omits budget", () => {
  const spec = parseTaskSpec(contractSpec(), process.cwd(), policyWithBudget(null));
  assert.equal(spec.runtime.maxBudgetUsd, null);
});

test("explicit null wins over finite default", () => {
  const spec = parseTaskSpec(
    contractSpec({ runtime: { maxBudgetUsd: null } }),
    process.cwd(),
    policyWithBudget(0.5),
  );
  assert.equal(spec.runtime.maxBudgetUsd, null);
});

test("finite budget above maximum throws at parse time", () => {
  assert.throws(
    () => parseTaskSpec(
      contractSpec({ runtime: { maxBudgetUsd: 100 } }),
      process.cwd(),
    ),
    /exceeds configured maximum/,
  );
});

test("budgetArguments omits flag for null", () => {
  assert.deepEqual(budgetArguments(null), []);
});

test("budgetArguments emits flag and value for finite number", () => {
  assert.deepEqual(budgetArguments(2.5), ["--max-budget-usd", "2.5"]);
});

test("budgetArguments round-trips zero without special-casing", () => {
  assert.deepEqual(budgetArguments(0), ["--max-budget-usd", "0"]);
});

test("Attempt budget snapshot preserves explicit null instead of falling back to Task budget", () => {
  const task = {
    spec: { runtime: { maxBudgetUsd: 1.5 } },
  } as TaskRecord;
  assert.equal(
    attemptRuntimeBudget(task, { runtimeBudgetUsd: null } as AttemptRecord),
    null,
  );
  assert.equal(
    attemptRuntimeBudget(task, {} as AttemptRecord),
    1.5,
  );
});

test("creation-time budget snapshot survives later policy changes", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-budget-snap-"));
  const store = new StateStore(home);
  const root = await mkdtemp(path.join(tmpdir(), "forklight-task-"));
  await mkdir(path.join(root, "project"));
  const taskFile = path.join(root, "task.yaml");
  await writeFile(
    taskFile,
    `version: 2
name: Budget snap test
project: ./project
worker:
  focusPaths: [src]
contract:
  outcome: A reasonable outcome description
  context: [c]
  inScope: [i]
  outOfScope: [o]
  executionSteps: [s]
  deliverables: [d]
  modules:
    - name: m
      responsibility: long enough responsibility
      consumes: [c]
      produces: [p]
      boundaries: [b]
  callChain: [a, b]
  scenarios:
    - name: normal
      given: g
      when: w
      then: t
    - name: edge
      given: g
      when: w
      then: t
  risks: [r]
  changeBudget:
    maxFiles: 4
    maxDiffLines: 300
acceptance:
  criteria: [c]
  commands:
    - "true"
`,
  );
  try {
    const defaults = cloneDefaults();
    const unlimited: TaskPolicy = {
      contractQuality: defaults.contractQuality,
      execution: { ...defaults.execution, defaultMaxBudgetUsd: null },
      providerDefaults: defaults.providerDefaults,
      completionPolicy: defaults.completionPolicy,
    };
    const { spec: spec1 } = await loadTaskSpec(taskFile, unlimited);
    const record1 = registerTaskFromSpec(store, spec1, taskFile);
    assert.equal(record1.spec.runtime.maxBudgetUsd, null);

    // Later task registered with a finite default does not mutate the earlier record.
    const finite: TaskPolicy = {
      contractQuality: defaults.contractQuality,
      execution: { ...defaults.execution, defaultMaxBudgetUsd: 3 },
      providerDefaults: defaults.providerDefaults,
      completionPolicy: defaults.completionPolicy,
    };
    await loadTaskSpec(taskFile, finite);

    const stored = store.getTask(record1.id);
    assert.equal(stored.spec.runtime.maxBudgetUsd, null);
  } finally {
    store.close();
  }
});

// --- Completion policy snapshot ---

function policyWithCompletion(
  noChangeMode: string,
  changeBudgetMode = "hard",
): TaskPolicy {
  const defaults = cloneDefaults();
  return {
    contractQuality: defaults.contractQuality,
    execution: defaults.execution,
    providerDefaults: defaults.providerDefaults,
    completionPolicy: {
      noChangeMode: noChangeMode as "hard" | "warn" | "score" | "off",
      changeBudgetMode: changeBudgetMode as "hard" | "warn" | "score" | "off",
    },
  };
}

test("newly parsed task snapshots configurable no-change policy", () => {
  // Default policy
  const specDefault = parseTaskSpec(contractSpec(), process.cwd());
  assert.equal(specDefault.completionPolicy?.noChangeMode, "hard");
  assert.equal(specDefault.completionPolicy?.changeBudgetMode, "hard");

  // Score policy
  const specScore = parseTaskSpec(contractSpec(), process.cwd(), policyWithCompletion("score"));
  assert.equal(specScore.completionPolicy?.noChangeMode, "score");

  // Off policy
  const specOff = parseTaskSpec(contractSpec(), process.cwd(), policyWithCompletion("off"));
  assert.equal(specOff.completionPolicy?.noChangeMode, "off");
});

test("task snapshots changeBudgetMode from policy and task override", () => {
  const fromPolicy = parseTaskSpec(contractSpec(), process.cwd(), policyWithCompletion("hard", "warn"));
  assert.equal(fromPolicy.completionPolicy?.changeBudgetMode, "warn");
  const fromTask = parseTaskSpec(
    contractSpec({ completionPolicy: { changeBudgetMode: "score" } }),
    process.cwd(),
    policyWithCompletion("hard", "warn"),
  );
  assert.equal(fromTask.completionPolicy?.changeBudgetMode, "score");
});

test("task-level completion policy explicitly overrides the global default", () => {
  const spec = parseTaskSpec(
    contractSpec({ completionPolicy: { noChangeMode: "warn" } }),
    process.cwd(),
    policyWithCompletion("score"),
  );
  assert.equal(spec.completionPolicy?.noChangeMode, "warn");
});

test("task-level completion policy rejects invalid modes and unsupported fields", () => {
  assert.throws(
    () => parseTaskSpec(
      contractSpec({ completionPolicy: { noChangeMode: "advisory" } }),
      process.cwd(),
    ),
    /task\.completionPolicy\.noChangeMode must be hard, warn, score, or off/,
  );
  assert.throws(
    () => parseTaskSpec(
      contractSpec({ completionPolicy: { noChangeMode: "hard", modelBan: true } }),
      process.cwd(),
    ),
    /task\.completionPolicy contains an unsupported field/,
  );
});

test("completion policy snapshot survives later settings changes", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cp-snap-"));
  const store = new StateStore(home);
  const root = await mkdtemp(path.join(tmpdir(), "forklight-task-"));
  await mkdir(path.join(root, "project"));
  const taskFile = path.join(root, "task.yaml");
  await writeFile(
    taskFile,
    `version: 2
name: CP snap test
project: ./project
worker:
  focusPaths: [src]
contract:
  outcome: A reasonable outcome description
  context: [c]
  inScope: [i]
  outOfScope: [o]
  executionSteps: [s]
  deliverables: [d]
  modules:
    - name: m
      responsibility: long enough responsibility
      consumes: [c]
      produces: [p]
      boundaries: [b]
  callChain: [a, b]
  scenarios:
    - name: normal
      given: g
      when: w
      then: t
    - name: edge
      given: g
      when: w
      then: t
  risks: [r]
  changeBudget:
    maxFiles: 4
    maxDiffLines: 300
acceptance:
  criteria: [c]
  commands:
    - "true"
`,
  );
  try {
    // Create under score mode
    const { spec: specScore } = await loadTaskSpec(taskFile, policyWithCompletion("score"));
    const record = registerTaskFromSpec(store, specScore, taskFile);
    assert.equal(record.spec.completionPolicy?.noChangeMode, "score");

    // Later task created with different policy
    const { spec: specOff } = await loadTaskSpec(taskFile, policyWithCompletion("off"));
    const record2 = registerTaskFromSpec(store, specOff, taskFile);

    // First record still has score policy — immutable
    const stored1 = store.getTask(record.id);
    assert.equal(stored1.spec.completionPolicy?.noChangeMode, "score");

    // Second record has off policy
    const stored2 = store.getTask(record2.id);
    assert.equal(stored2.spec.completionPolicy?.noChangeMode, "off");
  } finally {
    store.close();
  }
});

// --- Delivery Profile Resolution ---

function dpp(opts: Record<string, unknown> = {}): TaskPolicy {
  const d = cloneDefaults();
  return { contractQuality: d.contractQuality, execution: d.execution,
    providerDefaults: d.providerDefaults, completionPolicy: d.completionPolicy,
    deliveryProfiles: validateDeliveryProfilesSettings(
      { defaultProfileId: null, profiles: [], projectBindings: {}, ...opts }) };
}

const dpA = { id: "dp-a", label: "A", buildCommands: ["npm ci"], activationCommands: ["npm start"], activationCheckCommands: ["curl /health"] };
const dpB = { id: "dp-b", label: "B", buildCommands: ["yarn"], activationCommands: [], activationCheckCommands: [] };
const PX = "/tmp/project-x";

test("delivery resolution: precedence, fail-closed, conflict, provenance, detachment", () => {
  const p = dpp({ defaultProfileId: "dp-a", profiles: [dpA, dpB], projectBindings: { [PX]: "dp-b" } });

  // Explicit → explicit provenance
  const e = parseTaskSpec({ ...contractSpec(), project: PX, deliveryProfileId: "dp-b" }, "/", p);
  assert.equal(e.deliveryResolution?.source, "explicit");
  assert.deepEqual(e.delivery!.buildCommands, ["yarn"]);

  // Project binding (no explicit id)
  const b = parseTaskSpec({ ...contractSpec(), project: PX }, "/", p);
  assert.equal(b.deliveryResolution?.source, "project");
  assert.deepEqual(b.delivery!.buildCommands, ["yarn"]);

  // Default (no binding, no explicit)
  const d = parseTaskSpec({ ...contractSpec(), project: "/tmp/unbound" }, "/", p);
  assert.equal(d.deliveryResolution?.source, "default");
  assert.deepEqual(d.delivery!.buildCommands, ["npm ci"]);

  // None (empty registry)
  const ep = dpp({ defaultProfileId: null, profiles: [], projectBindings: {} });
  const n = parseTaskSpec({ ...contractSpec(), project: PX }, "/", ep);
  assert.equal(n.delivery, undefined);
  assert.equal(n.deliveryResolution, undefined);

  // Fail-closed: missing profile id
  assert.throws(() => parseTaskSpec({ ...contractSpec(), project: PX, deliveryProfileId: "no-such" }, "/", p), /not found/);

  // Fail-closed: malformed profile id
  assert.throws(() => parseTaskSpec({ ...contractSpec(), project: PX, deliveryProfileId: "Bad-Id" }, "/", p), /malformed/);

  // Conflict: inline delivery + deliveryProfileId
  assert.throws(() => parseTaskSpec({
    ...contractSpec(), project: PX, deliveryProfileId: "dp-a",
    delivery: { buildCommands: ["npm ci"], activationCommands: [], activationCheckCommands: [] },
  }, "/", p), /mutually exclusive/);

  // Inline provenance
  const il = parseTaskSpec({
    ...contractSpec(), project: PX,
    delivery: { buildCommands: ["npm run build"], activationCommands: ["npm start"], activationCheckCommands: [] },
  }, "/");
  assert.equal(il.deliveryResolution?.source, "inline");
  assert.deepEqual(il.delivery!.buildCommands, ["npm run build"]);

  // Detachment: mutate validated profile arrays after parsing, snapshot unchanged
  const sn = parseTaskSpec({ ...contractSpec(), project: PX, deliveryProfileId: "dp-b" }, "/", p);
  const profs = p.deliveryProfiles!.profiles as unknown as Array<{ buildCommands: string[]; id: string }>;
  profs[1]!.buildCommands = ["evil"];
  profs[1]!.id = "hacked";
  assert.deepEqual(sn.delivery!.buildCommands, ["yarn"]);
  assert.deepEqual(sn.deliveryResolution, { source: "explicit", profileId: "dp-b" });
});

// --- Advanced policy parsing and snapshot ---

import type {
  AdvancedPolicyFields,
} from "../src/core/types.js";
import {
  defaultAdvancedPolicyFields,
  deriveEffectivePolicyForTaskCreation,
  enforcementCapabilityForRuntime,
  resolveEffectivePolicy,
  attemptPolicyFromSnapshot,
  completionPolicyFromSnapshot,
  sizePolicyFromSnapshot,
} from "../src/core/advanced-policy.js";

test("task YAML parses advancedPolicy override as undefined when omitted", () => {
  const spec = parseTaskSpec(contractSpec(), process.cwd());
  assert.equal(spec.advancedPolicyOverride, undefined);
});

test("task YAML parses advancedPolicy override with valid fields", () => {
  const spec = parseTaskSpec(
    contractSpec({ advancedPolicy: { baseMaxAttempts: 10, maxDurationMs: 600_000 } }),
    process.cwd(),
  );
  assert.ok(spec.advancedPolicyOverride !== undefined);
  assert.equal(spec.advancedPolicyOverride!.baseMaxAttempts, 10);
  assert.equal(spec.advancedPolicyOverride!.maxDurationMs, 600_000);
});

test("task YAML rejects unknown advancedPolicy field", () => {
  assert.throws(
    () => parseTaskSpec(
      contractSpec({ advancedPolicy: { unknownLimit: 100 } }),
      process.cwd(),
    ),
    /not a recognized advanced-policy field/,
  );
});

test("task YAML rejects invalid advancedPolicy value", () => {
  assert.throws(
    () => parseTaskSpec(
      contractSpec({ advancedPolicy: { maxDurationMs: -100 } }),
      process.cwd(),
    ),
    /must be null or a non-negative integer/,
  );
});

test("task YAML advancedPolicy with explicit null for nullable field", () => {
  const spec = parseTaskSpec(
    contractSpec({ advancedPolicy: { maxDurationMs: null } }),
    process.cwd(),
  );
  assert.equal(spec.advancedPolicyOverride!.maxDurationMs, null);
});

// --- Effective policy snapshot on TaskRecord ---

function wpSettings(overrides: Partial<AdvancedPolicyFields> = {}) {
  const d = cloneDefaults();
  return {
    contractQuality: d.contractQuality,
    execution: d.execution,
    providerDefaults: d.providerDefaults,
    completionPolicy: d.completionPolicy,
    workerProfiles: {
      defaultProfileId: "default",
      profiles: [{
        id: "default", label: "Default", runtime: "claude-code" as const,
        modelConfigId: "deepseek-flash",
        provider: "deepseek" as const, model: "deepseek-v4-flash",
        endpoint: "https://api.deepseek.com/anthropic",
        effort: "high" as const,
        ...(Object.keys(overrides).length === 0 ? {} : { advancedPolicy: overrides }),
      }],
    },
  };
}

test("effective policy snapshot is stored on TaskRecord at creation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ep-snap-"));
  const store = new StateStore(home);
  const root = await mkdtemp(path.join(tmpdir(), "forklight-task-"));
  await mkdir(path.join(root, "project"));
  const taskFile = path.join(root, "task.yaml");
  await writeFile(
    taskFile,
    `version: 2
name: Policy Test
project: ./project
workerProfileId: default
worker:
  focusPaths: [src]
contract:
  outcome: A reasonable outcome description
  context: [c]
  inScope: [i]
  outOfScope: [o]
  executionSteps: [s]
  deliverables: [d]
  modules:
    - name: m
      responsibility: long enough responsibility
      consumes: [c]
      produces: [p]
      boundaries: [b]
  callChain: [a, b]
  scenarios:
    - name: normal
      given: g
      when: w
      then: t
    - name: edge
      given: g
      when: w
      then: t
  risks: [r]
  changeBudget:
    maxFiles: 4
    maxDiffLines: 300
acceptance:
  criteria: [c]
  commands:
    - "true"
`,
  );
  try {
    const policy = wpSettings({ baseMaxAttempts: 7 });
    const task = await createTask(store, taskFile, policy);
    assert.ok(task.effectivePolicy !== undefined, "Task should have an effective policy snapshot");
    assert.equal(task.effectivePolicy!.values.baseMaxAttempts, 7);
    assert.equal(task.effectivePolicy!.provenance.baseMaxAttempts, "worker");
    assert.equal(task.effectivePolicy!.profileId, "default");
  } finally {
    store.close();
  }
});

test("effective policy snapshot persists across store reload", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ep-reload-"));
  const store = new StateStore(home);
  const root = await mkdtemp(path.join(tmpdir(), "forklight-task-"));
  await mkdir(path.join(root, "project"));
  const taskFile = path.join(root, "task.yaml");
  await writeFile(
    taskFile,
    `version: 2
name: Reload Test
project: ./project
workerProfileId: default
worker:
  focusPaths: [src]
contract:
  outcome: A reasonable outcome description
  context: [c]
  inScope: [i]
  outOfScope: [o]
  executionSteps: [s]
  deliverables: [d]
  modules:
    - name: m
      responsibility: long enough responsibility
      consumes: [c]
      produces: [p]
      boundaries: [b]
  callChain: [a, b]
  scenarios:
    - name: normal
      given: g
      when: w
      then: t
    - name: edge
      given: g
      when: w
      then: t
  risks: [r]
  changeBudget:
    maxFiles: 4
    maxDiffLines: 300
acceptance:
  criteria: [c]
  commands:
    - "true"
`,
  );
  try {
    const policy = wpSettings({ baseMaxAttempts: 10 });
    const task = await createTask(store, taskFile, policy);
    const taskId = task.id;

    // Reload from store
    const reloaded = store.getTask(taskId);
    assert.ok(reloaded.effectivePolicy !== undefined);
    assert.equal(reloaded.effectivePolicy!.values.baseMaxAttempts, 10);
  } finally {
    store.close();
  }
});

// --- Settings drift immunity ---

test("settings change during queued work does not mutate existing Task snapshot", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-drift-"));
  const store = new StateStore(home);
  const root = await mkdtemp(path.join(tmpdir(), "forklight-task-"));
  await mkdir(path.join(root, "project"));
  const taskFile = path.join(root, "task.yaml");
  await writeFile(
    taskFile,
    `version: 2
name: Drift Test
project: ./project
workerProfileId: default
worker:
  focusPaths: [src]
advancedPolicy:
  baseMaxAttempts: 4
  maxConcurrency: 2
contract:
  outcome: A reasonable outcome description
  context: [c]
  inScope: [i]
  outOfScope: [o]
  executionSteps: [s]
  deliverables: [d]
  modules:
    - name: m
      responsibility: long enough responsibility
      consumes: [c]
      produces: [p]
      boundaries: [b]
  callChain: [a, b]
  scenarios:
    - name: normal
      given: g
      when: w
      then: t
    - name: edge
      given: g
      when: w
      then: t
  risks: [r]
  changeBudget:
    maxFiles: 4
    maxDiffLines: 300
acceptance:
  criteria: [c]
  commands:
    - "true"
`,
  );
  try {
    const policyBefore = wpSettings({ baseMaxAttempts: 3, maxConcurrency: 1 });
    const task = await createTask(store, taskFile, policyBefore);

    // Task overrides win over Worker values; the live global scheduler cap is
    // applied later without mutating the Task snapshot.
    assert.equal(task.effectivePolicy!.values.baseMaxAttempts, 4);
    assert.equal(task.effectivePolicy!.provenance.baseMaxAttempts, "task");
    assert.equal(task.effectivePolicy!.values.maxDurationMs, null);
    assert.equal(task.effectivePolicy!.values.maxConcurrency, 2);

    // "Change" settings (different policy for next Task)
    const policyAfter = wpSettings({ baseMaxAttempts: 1, maxConcurrency: 10 });
    const task2 = await createTask(store, taskFile, policyAfter);
    // New task's snapshot reflects new worker settings, but Task override still wins baseMaxAttempts
    assert.equal(task2.effectivePolicy!.values.baseMaxAttempts, 4);
    assert.equal(task2.effectivePolicy!.provenance.baseMaxAttempts, "task");

    // Original task is immutable — still has old profile + Task override
    const stored = store.getTask(task.id);
    assert.equal(stored.effectivePolicy!.values.baseMaxAttempts, 4);
    assert.equal(stored.effectivePolicy!.values.maxConcurrency, 2);
    assert.equal(stored.effectivePolicy!.values.maxDurationMs, null);
  } finally {
    store.close();
  }
});

// --- Explicit unlimited override ---

test("explicit null Task override prevents fallback to finite worker profile", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-null-"));
  const store = new StateStore(home);
  const root = await mkdtemp(path.join(tmpdir(), "forklight-task-"));
  await mkdir(path.join(root, "project"));
  const taskFile = path.join(root, "task.yaml");
  await writeFile(
    taskFile,
    `version: 2
name: Null Override
project: ./project
workerProfileId: default
worker:
  focusPaths: [src]
advancedPolicy:
  maxDurationMs: null
  observedTokenCeiling: null
contract:
  outcome: A reasonable outcome description
  context: [c]
  inScope: [i]
  outOfScope: [o]
  executionSteps: [s]
  deliverables: [d]
  modules:
    - name: m
      responsibility: long enough responsibility
      consumes: [c]
      produces: [p]
      boundaries: [b]
  callChain: [a, b]
  scenarios:
    - name: normal
      given: g
      when: w
      then: t
    - name: edge
      given: g
      when: w
      then: t
  risks: [r]
  changeBudget:
    maxFiles: 4
    maxDiffLines: 300
acceptance:
  criteria: [c]
  commands:
    - "true"
`,
  );
  try {
    // Worker profile has finite duration and token ceilings
    const policy = wpSettings({ maxDurationMs: 300_000, observedTokenCeiling: 100_000 });
    const task = await createTask(store, taskFile, policy);
    // Task overrides to null → explicitly unlimited, not falling back to worker
    assert.equal(task.effectivePolicy!.values.maxDurationMs, null);
    assert.equal(task.effectivePolicy!.provenance.maxDurationMs, "task");
    assert.equal(task.effectivePolicy!.values.observedTokenCeiling, null);
    assert.equal(task.effectivePolicy!.provenance.observedTokenCeiling, "task");
  } finally {
    store.close();
  }
});

// --- Snapshot helper functions for backward compatibility ---

test("completionPolicyFromSnapshot returns snapshot values when present", () => {
  const caps = enforcementCapabilityForRuntime("claude-code");
  const snap = resolveEffectivePolicy(
    { completionMode: "warn", changeBudgetMode: "score" },
    undefined,
    defaultAdvancedPolicyFields(),
    "test",
    caps,
  );
  const result = completionPolicyFromSnapshot(snap, "hard", "hard");
  assert.equal(result.noChangeMode, "warn");
  assert.equal(result.changeBudgetMode, "score");
});

test("completionPolicyFromSnapshot falls back for undefined snapshot", () => {
  const result = completionPolicyFromSnapshot(undefined, "warn", "score");
  assert.equal(result.noChangeMode, "warn");
  assert.equal(result.changeBudgetMode, "score");
});

test("attemptPolicyFromSnapshot returns snapshot values when present", () => {
  const caps = enforcementCapabilityForRuntime("claude-code");
  const snap = resolveEffectivePolicy(
    { baseMaxAttempts: 7, maxExtraAttempts: 2 },
    undefined,
    defaultAdvancedPolicyFields(),
    "test",
    caps,
  );
  const result = attemptPolicyFromSnapshot(snap, 3, 1);
  assert.equal(result.baseMaxAttempts, 7);
  assert.equal(result.maxExtraAttempts, 2);
});

test("attemptPolicyFromSnapshot falls back for undefined snapshot", () => {
  const result = attemptPolicyFromSnapshot(undefined, 5, 3);
  assert.equal(result.baseMaxAttempts, 5);
  assert.equal(result.maxExtraAttempts, 3);
});

test("sizePolicyFromSnapshot returns null limits for undefined snapshot", () => {
  const result = sizePolicyFromSnapshot(undefined);
  assert.equal(result.fileLimit, null);
  assert.equal(result.changedLineLimit, null);
  assert.equal(result.fileLimitMode, "warn");
  assert.equal(result.changedLineLimitMode, "warn");
});

test("sizePolicyFromSnapshot returns configured limits from snapshot", () => {
  const caps = enforcementCapabilityForRuntime("claude-code");
  const snap = resolveEffectivePolicy(
    { fileLimit: 10, fileLimitMode: "warn", changedLineLimit: 500, changedLineLimitMode: "score" },
    undefined,
    defaultAdvancedPolicyFields(),
    "test",
    caps,
  );
  const result = sizePolicyFromSnapshot(snap);
  assert.equal(result.fileLimit, 10);
  assert.equal(result.fileLimitMode, "warn");
  assert.equal(result.changedLineLimit, 500);
  assert.equal(result.changedLineLimitMode, "score");
});

// --- Legacy task recovery ---

test("legacy stored Task without effectivePolicy uses fallback values", () => {
  const policy = attemptPolicyFromSnapshot(undefined);
  assert.equal(policy.baseMaxAttempts, 3);
  assert.equal(policy.maxExtraAttempts, 1);

  const comp = completionPolicyFromSnapshot(undefined, "hard", "hard");
  assert.equal(comp.noChangeMode, "hard");
  assert.equal(comp.changeBudgetMode, "hard");
});

// --- deriveEffectivePolicyForTaskCreation ---

test("deriveEffectivePolicyForTaskCreation resolves with full provenance", () => {
  const caps = enforcementCapabilityForRuntime("claude-code");
  const glob = defaultAdvancedPolicyFields();
  glob.baseMaxAttempts = 5;
  glob.maxConcurrency = 10; // ensure concurrency=4 fits under global cap
  const snapshot = deriveEffectivePolicyForTaskCreation({
    workerProfile: {
      id: "worker-1",
      advancedPolicy: { maxDurationMs: 600_000 },
    },
    taskOverride: { maxConcurrency: 4 },
    globalDefaults: glob,
    enforcementCapability: caps,
  });
  assert.equal(snapshot.profileId, "worker-1");
  assert.equal(snapshot.values.maxDurationMs, 600_000);
  assert.equal(snapshot.provenance.maxDurationMs, "worker");
  assert.equal(snapshot.values.maxConcurrency, 4);
  assert.equal(snapshot.provenance.maxConcurrency, "task");
  assert.equal(snapshot.values.baseMaxAttempts, 5);
  assert.equal(snapshot.provenance.baseMaxAttempts, "global");
});

// --- Enforcement capability truthfulness ---

test("Claude token enforcement is labeled post-observation, never preemptive", () => {
  const caps = enforcementCapabilityForRuntime("claude-code");
  assert.notEqual(caps.tokenEnforcement, "preemptive",
    "Claude Code must NOT claim preemptive Token enforcement — usage is terminal only");
});

// --- taskFamily and routingDecision parsing (M3 V1) ---

test("parses taskFamily from task YAML", () => {
  const spec = parseTaskSpec(
    {
      ...contractSpec(),
      taskFamily: "ui-readability",
    },
    process.cwd(),
  );
  assert.equal(spec.taskFamily, "ui-readability");
});

test("taskFamily rejects empty and overlong strings", () => {
  assert.throws(
    () => parseTaskSpec({ ...contractSpec(), taskFamily: "" }, process.cwd()),
    /task\.taskFamily/,
  );
  assert.throws(
    () => parseTaskSpec({ ...contractSpec(), taskFamily: "x".repeat(81) }, process.cwd()),
    /task\.taskFamily/,
  );
});

test("parses a complete routingDecision snapshot", () => {
  const spec = parseTaskSpec(
    {
      ...contractSpec(),
      taskFamily: "ui-readability",
      workerProfileId: "default",
      routingDecision: {
        shortlist: [
          { provider: "deepseek", model: "deepseek-v4-flash", runtime: "claude-code", effort: "high" },
          { provider: "qwen", model: "plus", runtime: "claude-code", effort: "high", workerProfileId: "qwen-worker" },
        ],
        selectedWorker: { provider: "deepseek", model: "deepseek-v4-flash", runtime: "claude-code", effort: "high", workerProfileId: "default" },
        selectedBecause: { code: "relevant-delivery", note: "DeepSeek has strong delivery history for backend state contracts" },
        competition: { intent: "none", triggers: [] },
        evidenceSnapshot: {
          scope: "none",
          exactSampleCounts: { "deepseek\0deepseek-v4-flash\0claude-code\0high": 0, "qwen\0plus\0claude-code\0high": 0 },
        },
      },
    } satisfies Record<string, unknown>,
    process.cwd(),
  );
  assert.equal(spec.taskFamily, "ui-readability");
  assert.ok(spec.routingDecision);
  assert.equal(spec.routingDecision!.shortlist.length, 2);
  assert.equal(spec.routingDecision!.selectedWorker.provider, "deepseek");
  assert.equal(spec.routingDecision!.selectedWorker.runtime, "claude-code");
  assert.equal(spec.routingDecision!.selectedBecause.code, "relevant-delivery");
  assert.equal(spec.routingDecision!.competition.intent, "none");
  assert.equal(spec.routingDecision!.evidenceSnapshot.scope, "none");
});

test("routingDecision rejects invalid intents and missing triggers on consider", () => {
  const base = {
    taskFamily: "ui",
    routingDecision: {
      shortlist: [{ provider: "deepseek", model: "v4", runtime: "claude-code", effort: "high" }],
      selectedWorker: { provider: "deepseek", model: "v4", runtime: "claude-code", effort: "high" },
      selectedBecause: { code: "main-judgment", note: "Test" },
      evidenceSnapshot: { scope: "none", exactSampleCounts: { "deepseek\0v4": 0 } },
    },
  };
  // Invalid intent
  assert.throws(
    () => parseTaskSpec({
      ...contractSpec(),
      ...base,
      routingDecision: { ...base.routingDecision, competition: { intent: "auto", triggers: [] } },
    }, process.cwd()),
    /task\.routingDecision\.competition\.intent/,
  );
  // Consider with no triggers
  assert.throws(
    () => parseTaskSpec({
      ...contractSpec(),
      ...base,
      routingDecision: { ...base.routingDecision, competition: { intent: "consider", triggers: [] } },
    }, process.cwd()),
    /triggers must be non-empty when intent is consider or required/,
  );
});

test("routingDecision with task-family scope requires familySampleCounts", () => {
  const base = {
    taskFamily: "ui",
    routingDecision: {
      shortlist: [{ provider: "deepseek", model: "deepseek-v4-flash", runtime: "claude-code", effort: "high" }],
      selectedWorker: { provider: "deepseek", model: "deepseek-v4-flash", runtime: "claude-code", effort: "high" },
      selectedBecause: { code: "main-judgment", note: "T" },
      competition: { intent: "none", triggers: [] },
    },
  };
  // Missing familySampleCounts when scope is task-family
  assert.throws(
    () => parseTaskSpec({
      ...contractSpec(),
      ...base,
      routingDecision: {
        ...base.routingDecision,
        evidenceSnapshot: { scope: "task-family", exactSampleCounts: {} },
      },
    }, process.cwd()),
    /familySampleCounts is required when scope is task-family/,
  );
  // Valid with familySampleCounts
  const spec = parseTaskSpec({
    ...contractSpec(),
    ...base,
    routingDecision: {
      ...base.routingDecision,
      evidenceSnapshot: {
        scope: "task-family",
        exactSampleCounts: {},
        familySampleCounts: { "deepseek\0deepseek-v4-flash\0claude-code\0high": 12 },
      },
    },
  }, process.cwd());
  assert.equal(spec.routingDecision!.evidenceSnapshot.scope, "task-family");
  assert.equal(spec.routingDecision!.evidenceSnapshot.familySampleCounts!["deepseek\0deepseek-v4-flash\0claude-code\0high"], 12);
});

test("legacy Task without taskFamily or routingDecision is still readable", () => {
  const spec = parseTaskSpec(contractSpec(), process.cwd());
  assert.equal(spec.taskFamily, undefined);
  assert.equal(spec.routingDecision, undefined);
  // Legacy fields still work
  assert.ok(spec.name);
  assert.equal(spec.version, 2);
});

test("routingDecision frozen identity includes runtime and effort", () => {
  const spec = parseTaskSpec({
    ...contractSpec(),
    workerProfileId: "volcengine-glm52-1m",
    routingDecision: {
      shortlist: [{ provider: "volcengine", model: "glm-5.2[1M]", runtime: "claude-code", effort: "high", workerProfileId: "volcengine-glm52-1m" }],
      selectedWorker: { provider: "volcengine", model: "glm-5.2[1M]", runtime: "claude-code", effort: "high", workerProfileId: "volcengine-glm52-1m" },
      selectedBecause: { code: "runtime-capability", note: "GLM handles large context" },
      competition: { intent: "consider", triggers: ["new-family"] },
      evidenceSnapshot: { scope: "none", exactSampleCounts: { "volcengine\0glm-5.2[1M]\0claude-code\0high": 0 } },
    },
  }, process.cwd());
  assert.equal(spec.routingDecision!.selectedWorker.effort, "high");
  assert.equal(spec.routingDecision!.selectedWorker.runtime, "claude-code");
  assert.equal(spec.routingDecision!.selectedWorker.workerProfileId, "volcengine-glm52-1m");
});

test("routingDecision evidenceSnapshot settingsDigest is optional", () => {
  const without = parseTaskSpec({
    ...contractSpec(),
    routingDecision: {
      shortlist: [{ provider: "deepseek", model: "deepseek-v4-flash", runtime: "claude-code", effort: "high" }],
      selectedWorker: { provider: "deepseek", model: "deepseek-v4-flash", runtime: "claude-code", effort: "high" },
      selectedBecause: { code: "main-judgment", note: "T" },
      competition: { intent: "none", triggers: [] },
      evidenceSnapshot: { scope: "none", exactSampleCounts: { "deepseek\0deepseek-v4-flash\0claude-code\0high": 0 } },
    },
  }, process.cwd());
  assert.equal(without.routingDecision!.evidenceSnapshot.settingsDigest, undefined);

  const withDigest = parseTaskSpec({
    ...contractSpec(),
    routingDecision: {
      shortlist: [{ provider: "deepseek", model: "deepseek-v4-flash", runtime: "claude-code", effort: "high" }],
      selectedWorker: { provider: "deepseek", model: "deepseek-v4-flash", runtime: "claude-code", effort: "high" },
      selectedBecause: { code: "main-judgment", note: "T" },
      competition: { intent: "none", triggers: [] },
      evidenceSnapshot: { scope: "none", exactSampleCounts: { "deepseek\0deepseek-v4-flash\0claude-code\0high": 0 }, settingsDigest: "abc123" },
    },
  }, process.cwd());
  assert.equal(withDigest.routingDecision!.evidenceSnapshot.settingsDigest, "abc123");
});

test("Grok token enforcement is labeled unsupported", () => {
  const caps = enforcementCapabilityForRuntime("grok-build");
  assert.equal(caps.tokenEnforcement, "unsupported");
});

// --- routingDecision identity drift rejection (M3 V1 Gap 3) ---

const rdBase = {
  shortlist: [
    { provider: "deepseek", model: "v4", runtime: "claude-code", effort: "high", workerProfileId: "default" },
    { provider: "qwen", model: "plus", runtime: "claude-code", effort: "high" },
  ],
  selectedBecause: { code: "relevant-delivery", note: "Consistent delivery history" },
  competition: { intent: "none" as const, triggers: [] as string[] },
  evidenceSnapshot: { scope: "none" as const, exactSampleCounts: { "deepseek\0v4": 0, "qwen\0plus": 0 } },
};

test("selectedWorker must be in the shortlist by all four identity fields", () => {
  // selectedWorker NOT in shortlist (different effort)
  assert.throws(
    () => parseTaskSpec({
      ...contractSpec(),
      provider: { name: "deepseek", model: "v4" },
      runtime: { effort: "high" },
      routingDecision: {
        ...rdBase,
        selectedWorker: { provider: "deepseek", model: "v4", runtime: "claude-code", effort: "medium" },
      },
    }, process.cwd()),
    /must match an entry in the shortlist/,
  );
});

test("selectedWorker provider must match resolved Task provider", () => {
  assert.throws(
    () => parseTaskSpec({
      ...contractSpec(),
      provider: { name: "deepseek", model: "v4" },
      runtime: { effort: "high" },
      routingDecision: {
        ...rdBase,
        shortlist: [{ provider: "qwen", model: "v4", runtime: "claude-code", effort: "high" }],
        selectedWorker: { provider: "qwen", model: "v4", runtime: "claude-code", effort: "high" },
      },
    }, process.cwd()),
    /does not match resolved Task provider/,
  );
});

test("selectedWorker runtime must match resolved Task runtime", () => {
  assert.throws(
    () => parseTaskSpec({
      ...contractSpec(),
      provider: { name: "xai", model: "grok-4.5" },
      runtime: { name: "grok-build", effort: "high" },
      routingDecision: {
        ...rdBase,
        shortlist: [{ provider: "xai", model: "grok-4.5", runtime: "claude-code", effort: "high" }],
        selectedWorker: { provider: "xai", model: "grok-4.5", runtime: "claude-code", effort: "high" },
      },
    }, process.cwd()),
    /does not match resolved Task runtime/,
  );
});

test("routingDecision taskFamily must match top-level taskFamily when both present", () => {
  assert.throws(
    () => parseTaskSpec({
      ...contractSpec(),
      provider: { name: "deepseek", model: "v4" },
      runtime: { effort: "high" },
      taskFamily: "ui",
      routingDecision: {
        ...rdBase,
        taskFamily: "backend",
        selectedWorker: { provider: "deepseek", model: "v4", runtime: "claude-code", effort: "high" },
      },
    }, process.cwd()),
    /taskFamily.*must be identical/,
  );
});

// --- Bounded policy adaptation transition chain ---

import {
  evaluateAdaptationGate,
  deriveChildEffectivePolicy,
  lineageRoundOf,
  resolveAdaptiveRoot,
} from "../src/core/adaptation.js";
import type { EffectivePolicySnapshot } from "../src/core/types.js";

function adaptSnapshot(overrides: Partial<EffectivePolicySnapshot["values"]> = {}): EffectivePolicySnapshot {
  const caps = enforcementCapabilityForRuntime("claude-code");
  const base: EffectivePolicySnapshot = resolveEffectivePolicy(
    undefined,
    undefined,
    defaultAdvancedPolicyFields(),
    "default",
    caps,
  );
  return {
    ...base,
    values: { ...base.values, maxAdaptationRounds: 1, ...overrides },
    provenance: { ...base.provenance, maxAdaptationRounds: "global" },
  };
}

function adaptParent(
  id: string,
  status: TaskRecord["status"] = "succeeded",
  effectivePolicy: EffectivePolicySnapshot | undefined = adaptSnapshot(),
): { id: string; status: TaskRecord["status"]; effectivePolicy: EffectivePolicySnapshot | undefined } {
  return { id, status, effectivePolicy };
}

test("adaptation gate: zero rounds produces adaptation-disabled preview", () => {
  const decision = evaluateAdaptationGate({
    parent: adaptParent("p1", "succeeded", adaptSnapshot({ maxAdaptationRounds: 0 })),
    rootEffectivePolicy: adaptSnapshot({ maxAdaptationRounds: 0 }),
    existingLineage: [],
    rawPatch: { maxDurationMs: 600_000 },
  });
  assert.equal(decision.kind, "stopped");
  assert.equal(decision.preview.status, "stopped");
  assert.equal(decision.preview.stoppedReason, "adaptation-disabled");
  assert.equal(decision.preview.fields.length, 0);
});

test("adaptation gate: non-terminal parent produces parent-not-terminal preview", () => {
  const decision = evaluateAdaptationGate({
    parent: adaptParent("p1", "running", adaptSnapshot({ maxAdaptationRounds: 1 })),
    rootEffectivePolicy: adaptSnapshot({ maxAdaptationRounds: 1 }),
    existingLineage: [],
    rawPatch: { maxDurationMs: 600_000 },
  });
  assert.equal(decision.kind, "stopped");
  assert.equal(decision.preview.stoppedReason, "parent-not-terminal");
});

test("adaptation gate: missing effective policy produces missing-effective-policy preview", () => {
  const decision = evaluateAdaptationGate({
    parent: { id: "p1", status: "succeeded", effectivePolicy: undefined },
    rootEffectivePolicy: adaptSnapshot({ maxAdaptationRounds: 1 }),
    existingLineage: [],
    rawPatch: { maxDurationMs: 600_000 },
  });
  assert.equal(decision.kind, "stopped");
  assert.equal(decision.preview.stoppedReason, "missing-effective-policy");
});

test("adaptation gate: no-op patch cannot consume a round", () => {
  const snapshot = adaptSnapshot({ maxDurationMs: 60_000, maxAdaptationRounds: 2 });
  const decision = evaluateAdaptationGate({
    parent: adaptParent("root", "failed", snapshot),
    rootEffectivePolicy: snapshot,
    existingLineage: [],
    rawPatch: { maxDurationMs: 60_000 },
  });
  assert.equal(decision.kind, "stopped");
  assert.equal(decision.preview.stoppedReason, "no-effective-change");
});

test("adaptation gate: eligible preview shows before/after with provenance and changed flag", () => {
  const decision = evaluateAdaptationGate({
    parent: adaptParent("root", "succeeded", adaptSnapshot({ maxDurationMs: 60_000 })),
    rootEffectivePolicy: adaptSnapshot({ maxDurationMs: 60_000, maxAdaptationRounds: 2 }),
    existingLineage: [],
    rawPatch: { maxDurationMs: 600_000 },
  });
  assert.equal(decision.kind, "eligible");
  const fields = decision.preview.fields;
  const dur = fields.find((f) => f.field === "maxDurationMs");
  assert.ok(dur);
  assert.equal(dur!.before, 60_000);
  assert.equal(dur!.after, 600_000);
  assert.equal(dur!.changed, true);
  assert.equal(dur!.source, "global");
  assert.equal(decision.preview.nextRound, 1);
  assert.equal(decision.preview.maxAdaptationRounds, 2);
});

test("adaptation gate: cap of one with existing line stops round-2 from same parent with successor-already-created", () => {
  const decision = evaluateAdaptationGate({
    parent: adaptParent("parent-2", "succeeded", adaptSnapshot({ maxAdaptationRounds: 1 })),
    rootEffectivePolicy: adaptSnapshot({ maxAdaptationRounds: 1 }),
    existingLineage: [
      { rootTaskId: "root", parentTaskId: "root", childTaskId: "parent-2", round: 1 },
      { rootTaskId: "root", parentTaskId: "parent-2", childTaskId: "other", round: 2 },
    ],
    rawPatch: { maxDurationMs: 600_000 },
  });
  // Existing lineage marks parent-2 as already having a successor; the gate
  // surfaces successor-already-created as the more specific stopped reason.
  assert.equal(decision.kind, "stopped");
  assert.equal(decision.preview.stoppedReason, "successor-already-created");
});

test("adaptation gate: cap of one on a child round stops round-2 from same parent", () => {
  // Simulate: root has cap=1, used its round-1 to create child.
  // Try to apply again from root (parent).
  const decision = evaluateAdaptationGate({
    parent: adaptParent("root", "succeeded", adaptSnapshot({ maxAdaptationRounds: 1 })),
    rootEffectivePolicy: adaptSnapshot({ maxAdaptationRounds: 1 }),
    existingLineage: [
      { rootTaskId: "root", parentTaskId: "root", childTaskId: "first-child", round: 1 },
    ],
    rawPatch: { maxDurationMs: 600_000 },
  });
  // root already has one child, so successor-already-created is the right reason.
  assert.equal(decision.kind, "stopped");
  assert.equal(decision.preview.stoppedReason, "successor-already-created");
});

test("adaptation gate: round-limit-reached when next round would exceed cap", () => {
  // p1 is a child (round 1) of root. No edge of which p1 is the parent,
  // so next round = 2 > cap = 1 => round-limit-reached.
  const decision = evaluateAdaptationGate({
    parent: adaptParent("p1", "succeeded", adaptSnapshot({ maxAdaptationRounds: 1 })),
    rootEffectivePolicy: adaptSnapshot({ maxAdaptationRounds: 1 }),
    existingLineage: [
      { rootTaskId: "root", parentTaskId: "root", childTaskId: "p1", round: 1 },
    ],
    rawPatch: { maxDurationMs: 600_000 },
  });
  assert.equal(decision.kind, "stopped");
  assert.equal(decision.preview.stoppedReason, "round-limit-reached");
});

test("adaptation gate: rejected patch containing maxAdaptationRounds reports forbidden-field", () => {
  const decision = evaluateAdaptationGate({
    parent: adaptParent("root", "succeeded", adaptSnapshot({ maxAdaptationRounds: 1 })),
    rootEffectivePolicy: adaptSnapshot({ maxAdaptationRounds: 1 }),
    existingLineage: [],
    rawPatch: { maxAdaptationRounds: 5, maxDurationMs: 60_000 },
  });
  assert.equal(decision.kind, "stopped");
  assert.equal(decision.preview.stoppedReason, "forbidden-field");
});

test("adaptation gate: malformed patch reports invalid-patch", () => {
  const decision = evaluateAdaptationGate({
    parent: adaptParent("root", "succeeded", adaptSnapshot({ maxAdaptationRounds: 1 })),
    rootEffectivePolicy: adaptSnapshot({ maxAdaptationRounds: 1 }),
    existingLineage: [],
    rawPatch: { baseMaxAttempts: -1 },
  });
  assert.equal(decision.kind, "stopped");
  assert.equal(decision.preview.stoppedReason, "invalid-patch");
});

test("adaptation gate: unknown patch field is forbidden-field", () => {
  const decision = evaluateAdaptationGate({
    parent: adaptParent("root", "succeeded", adaptSnapshot({ maxAdaptationRounds: 1 })),
    rootEffectivePolicy: adaptSnapshot({ maxAdaptationRounds: 1 }),
    existingLineage: [],
    rawPatch: { someUnknownField: 5 },
  });
  assert.equal(decision.kind, "stopped");
  assert.equal(decision.preview.stoppedReason, "forbidden-field");
});

test("adaptation gate: settings-related surface fields are forbidden-field", () => {
  // Provider endpoint, runtime authority, credentials, edit permissions,
  // acceptance commands, commit/push, maxAdaptationRounds are all
  // intentionally NOT advanced-policy fields and must be rejected.
  for (const forbidden of [
    { provider: "deepseek", endpoint: "https://example" },
    { allowEdits: true },
    { allowedCommands: ["git push"] },
    { commit: true },
    { push: true },
    { execution: {} },
  ]) {
    const decision = evaluateAdaptationGate({
      parent: adaptParent("root", "succeeded", adaptSnapshot({ maxAdaptationRounds: 1 })),
      rootEffectivePolicy: adaptSnapshot({ maxAdaptationRounds: 1 }),
      existingLineage: [],
      rawPatch: forbidden,
    });
    assert.equal(decision.kind, "stopped");
    assert.equal(decision.preview.stoppedReason, "forbidden-field",
      `must reject ${JSON.stringify(forbidden)} as forbidden-field`);
  }
});

test("adaptation gate: round depth is computed from existing lineage", () => {
  // p1 (round 1) -> p2 (round 2)
  const parentEdge = {
    rootTaskId: "root", parentTaskId: "root", childTaskId: "p1", round: 1,
  };
  const childEdge = {
    rootTaskId: "root", parentTaskId: "p1", childTaskId: "p2", round: 2,
  };
  // Adjusting from p2 should compute nextRound = 3
  const decision = evaluateAdaptationGate({
    parent: adaptParent("p2", "succeeded", adaptSnapshot({ maxAdaptationRounds: 3 })),
    rootEffectivePolicy: adaptSnapshot({ maxAdaptationRounds: 3 }),
    existingLineage: [parentEdge, childEdge],
    rawPatch: { maxDurationMs: 600_000 },
  });
  assert.equal(decision.kind, "eligible");
  assert.equal(decision.preview.nextRound, 3);
});

test("adaptation gate: empty patch is stopped and cannot consume a round", () => {
  const decision = evaluateAdaptationGate({
    parent: adaptParent("root", "succeeded", adaptSnapshot({ maxDurationMs: 60_000 })),
    rootEffectivePolicy: adaptSnapshot({ maxAdaptationRounds: 1 }),
    existingLineage: [],
    rawPatch: {},
  });
  assert.equal(decision.kind, "stopped");
  assert.equal(decision.preview.stoppedReason, "no-effective-change");
});

test("resolveAdaptiveRoot returns itself when no lineage edges exist", () => {
  const result = resolveAdaptiveRoot("root", []);
  assert.deepEqual(result, { rootTaskId: "root" });
});

test("resolveAdaptiveRoot walks lineage to the root ancestor", () => {
  const lineage = [
    { rootTaskId: "root", parentTaskId: "root", childTaskId: "p1", round: 1 },
    { rootTaskId: "root", parentTaskId: "p1", childTaskId: "p2", round: 2 },
  ];
  assert.deepEqual(resolveAdaptiveRoot("p2", lineage), { rootTaskId: "root" });
});

test("lineageRoundOf returns 0 for the root and hops up the chain", () => {
  const lineage = [
    { rootTaskId: "root", parentTaskId: "root", childTaskId: "p1", round: 1 },
    { rootTaskId: "root", parentTaskId: "p1", childTaskId: "p2", round: 2 },
  ];
  assert.equal(lineageRoundOf("root", lineage), 0);
  assert.equal(lineageRoundOf("p1", lineage), 1);
  assert.equal(lineageRoundOf("p2", lineage), 2);
});

test("deriveChildEffectivePolicy preserves root cap and overrides patch fields", () => {
  const parentSnapshot = adaptSnapshot({
    maxAdaptationRounds: 2,
    maxDurationMs: 60_000,
    noProgressTimeoutMs: 1_800_000,
  });
  const child = deriveChildEffectivePolicy(parentSnapshot, {
    maxDurationMs: 600_000,
    noProgressTimeoutMs: 2_500_000,
  });
  assert.equal(child.values.maxAdaptationRounds, 2, "cap is preserved");
  assert.equal(child.values.maxDurationMs, 600_000, "patch value applied");
  assert.equal(child.values.noProgressTimeoutMs, 2_500_000, "patch value applied");
  assert.equal(child.provenance.maxDurationMs, "task", "patched field provenance is task");
  assert.equal(child.provenance.noProgressTimeoutMs, "task", "patched field provenance is task");
});

test("deriveChildEffectivePolicy rejects patch that tries to redefine the cap", () => {
  const parentSnapshot = adaptSnapshot({ maxAdaptationRounds: 1 });
  const child = deriveChildEffectivePolicy(parentSnapshot, {
    maxAdaptationRounds: 99 as unknown as never,
    maxDurationMs: 600_000,
  });
  assert.equal(child.values.maxAdaptationRounds, 1, "cap unchanged despite patch attempt");
  assert.equal(child.values.maxDurationMs, 600_000, "non-cap patch field applied");
});

test("adaptation gate: provenance and enforcement phase are surfaced in the preview", () => {
  const caps = enforcementCapabilityForRuntime("grok-build");
  const caps1 = enforcementCapabilityForRuntime("claude-code");
  // Two different capability matrices to verify the preview reflects each.
  void caps; void caps1;
  const decision = evaluateAdaptationGate({
    parent: adaptParent("root", "succeeded", adaptSnapshot({ maxDurationMs: 60_000 })),
    rootEffectivePolicy: adaptSnapshot({ maxAdaptationRounds: 1 }),
    existingLineage: [],
    rawPatch: { observedTokenCeiling: 100_000 },
  });
  assert.equal(decision.kind, "eligible");
  const row = decision.preview.fields.find((f) => f.field === "observedTokenCeiling");
  assert.ok(row);
  assert.equal(row!.before, null);
  assert.equal(row!.after, 100_000);
});

// --- pricingRoute snapshot on Task creation ----------------------------------

test("pricingRoute from Worker is snapshotted into Task ProviderSpec at creation time", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-pr-snap-"));
  const store = new StateStore(home);
  const root = await mkdtemp(path.join(tmpdir(), "forklight-task-"));
  await mkdir(path.join(root, "project"));
  const taskFile = path.join(root, "task.yaml");
  await writeFile(
    taskFile,
    `version: 2
name: PricingRoute Snap
project: ./project
workerProfileId: mm-cn
worker:
  focusPaths: [src]
contract:
  outcome: A reasonable outcome description for pricing route snapshot
  context: [c]
  inScope: [i]
  outOfScope: [o]
  executionSteps: [s]
  deliverables: [d]
  modules:
    - name: m
      responsibility: long enough responsibility
      consumes: [c]
      produces: [p]
      boundaries: [b]
  callChain: [a, b]
  scenarios:
    - name: normal
      given: g
      when: w
      then: t
    - name: edge
      given: g
      when: w
      then: t
  risks: [r]
  changeBudget:
    maxFiles: 4
    maxDiffLines: 300
acceptance:
  criteria: [c]
  commands:
    - "true"
`,
  );
  try {
    const defaults = cloneDefaults();
    const policy: TaskPolicy = {
      contractQuality: defaults.contractQuality,
      execution: defaults.execution,
      providerDefaults: defaults.providerDefaults,
      completionPolicy: defaults.completionPolicy,
      workerProfiles: {
        defaultProfileId: "mm-cn",
        profiles: [{
          id: "mm-cn",
          label: "MM CN",
          runtime: "claude-code",
          provider: "minimax",
          model: "MiniMax-M3",
          endpoint: "https://api.minimaxi.com/anthropic",
          pricingRoute: "minimax-china-direct-payg",
        }],
      },
    };
    const task = await createTask(store, taskFile, policy);
    // pricingRoute is in the snapshotted ProviderSpec
    assert.equal(task.spec.provider.pricingRoute, "minimax-china-direct-payg");

    // Later settings change the Worker's pricingRoute
    const policy2: TaskPolicy = {
      ...policy,
      workerProfiles: {
        defaultProfileId: "mm-cn",
        profiles: [{
          id: "mm-cn",
          label: "MM CN Changed",
          runtime: "claude-code",
          provider: "minimax",
          model: "MiniMax-M3",
          endpoint: "https://api.minimaxi.com/anthropic",
          pricingRoute: "minimax-international-direct-payg",
        }],
      },
    };
    const task2 = await createTask(store, taskFile, policy2);
    // New task gets the changed route
    assert.equal(task2.spec.provider.pricingRoute, "minimax-international-direct-payg");

    // Original task is immutable
    const stored = store.getTask(task.id);
    assert.equal(stored.spec.provider.pricingRoute, "minimax-china-direct-payg");
  } finally {
    store.close();
  }
});

// --- Main-authored user presentation ---

function taskWithPresentation(presentation?: unknown): Record<string, unknown> {
  const base = contractSpec();
  const contract = base.contract as Record<string, unknown>;
  return {
    ...base,
    contract: {
      ...contract,
      ...(presentation === undefined ? {} : { presentation }),
    },
  };
}

test("Task presentation is stored exactly and stays contextual in the Worker prompt", () => {
  const summary = "让用户一眼看懂这次任务要解决什么，以及完成后会得到什么。";
  const parsed = parseTaskSpec(
    taskWithPresentation({ summary, language: "zh-Hans-CN" }),
    process.cwd(),
  );
  assert.equal(parsed.version, 2);
  assert.deepEqual(parsed.contract.presentation, { summary, language: "zh-Hans-CN" });

  const prompt = buildWorkerPrompt(parsed, false);
  assert.match(prompt, /Main-authored user explanation/);
  assert.ok(prompt.includes(summary));
  assert.match(prompt, /technical contract and acceptance remain authoritative/);
  assert.match(prompt, /Observable outcome:/);
  assert.match(prompt, /Independent acceptance commands:/);
});

test("Task presentation remains optional for existing structured Tasks", () => {
  const parsed = parseTaskSpec(taskWithPresentation(), process.cwd());
  assert.equal(parsed.version, 2);
  assert.equal(parsed.contract.presentation, undefined);
  assert.doesNotMatch(buildWorkerPrompt(parsed, false), /Main-authored user explanation/);
});

test("Task presentation rejects unsafe shapes at one content-free parser boundary", () => {
  const secret = "DO-NOT-ECHO-PRESENTATION";
  const invalid = [
    { summary: "", language: "en" },
    { summary: " leading space", language: "en" },
    { summary: "line one\nline two", language: "en" },
    { summary: "x".repeat(301), language: "en" },
    { summary: "Readable summary", language: "not a tag!" },
    { summary: "Readable summary" },
    { language: "en" },
    { summary: "Readable summary", language: "en", extra: secret },
  ];
  for (const presentation of invalid) {
    assert.throws(
      () => parseTaskSpec(taskWithPresentation(presentation), process.cwd()),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /task\.contract\.presentation/);
        assert.ok(!error.message.includes(secret));
        return true;
      },
    );
  }
});

// --- Worker change-budget wording matches the frozen changeBudgetMode ---

/** Build a version 2 Task spec whose frozen completionPolicy carries the given
 *  changeBudgetMode. The "legacy" shape omits changeBudgetMode so the presenter
 *  must fall back to the hard instruction, matching legacy stored Task records. */
function specWithChangeBudgetMode(
  mode: "hard" | "warn" | "score" | "off" | "legacy",
): ContractTaskSpec {
  const spec = parseTaskSpec(contractSpec(), process.cwd()) as ContractTaskSpec;
  if (mode === "legacy") {
    spec.completionPolicy = { noChangeMode: "hard" };
  } else {
    spec.completionPolicy = { noChangeMode: "hard", changeBudgetMode: mode };
  }
  return spec;
}

test("Worker change-budget block is truthful per frozen changeBudgetMode", () => {
  const maxFilesLine = "- At most 4 changed files";
  const maxDiffLinesLine = "- At most 300 added/deleted lines";
  const hardHeading = "Hard change budget:";
  const hardStop = "stop and report the missing decomposition instead of expanding scope";
  const authoritative = /agreed scope, hard boundaries, and independent acceptance remain authoritative/;

  const cases: Array<{
    mode: "hard" | "warn" | "score" | "off" | "legacy";
    heading: string;
    required: string[];
  }> = [
    {
      mode: "hard",
      heading: hardHeading,
      required: [hardStop],
    },
    {
      mode: "legacy",
      heading: hardHeading,
      required: [hardStop],
    },
    {
      mode: "warn",
      heading: "Change budget guidance (warn):",
      required: [
        "guidance only; an overrun is a warning, not a Task failure",
        "Finish the agreed scoped behavior and report the overrun",
        "do not sacrifice correctness or scope to fit the numbers",
      ],
    },
    {
      mode: "score",
      heading: "Change budget evidence (score):",
      required: [
        "evaluation evidence, not a pass/fail gate",
        "overrun does not stop or fail the Task",
      ],
    },
    {
      mode: "off",
      heading: "Change budget reference (off):",
      required: [
        "enforcement is disabled; these figures are reference only",
        "do not expand scope beyond the bounded contract",
      ],
    },
  ];

  for (const { mode, heading, required } of cases) {
    const prompt = buildWorkerPrompt(specWithChangeBudgetMode(mode), false);
    const isHard = mode === "hard" || mode === "legacy";

    // Every mode keeps the exact configured figures and its mode-accurate heading.
    assert.ok(prompt.includes(maxFilesLine), `[${mode}] expected configured maxFiles line`);
    assert.ok(prompt.includes(maxDiffLinesLine), `[${mode}] expected configured maxDiffLines line`);
    assert.ok(prompt.includes(heading), `[${mode}] expected heading: ${heading}`);
    for (const phrase of required) {
      assert.ok(prompt.includes(phrase), `[${mode}] expected phrase: ${phrase}`);
    }

    if (isHard) {
      // Hard and legacy-hard keep the stop-and-report instruction.
      assert.ok(prompt.includes(hardStop), `[${mode}] hard mode must keep the stop-and-report instruction`);
    } else {
      // Non-hard modes protect correctness and scope, never present as a hard gate.
      assert.match(prompt, authoritative, `[${mode}] non-hard mode must keep scope/acceptance authoritative`);
      assert.ok(!prompt.includes(hardHeading), `[${mode}] must not contain the hard change-budget heading`);
      assert.ok(!prompt.includes(hardStop), `[${mode}] must not contain the hard stop-and-report instruction`);
    }
  }
});

test("legacy Task without a frozen changeBudgetMode falls back to the hard block", () => {
  // changeBudgetMode absent while completionPolicy is present.
  const noMode = parseTaskSpec(contractSpec(), process.cwd()) as ContractTaskSpec;
  noMode.completionPolicy = { noChangeMode: "hard" };
  // Legacy stored Task shape: completionPolicy absent entirely.
  const noCompletion = parseTaskSpec(contractSpec(), process.cwd()) as ContractTaskSpec;
  delete noCompletion.completionPolicy;

  for (const spec of [noMode, noCompletion]) {
    const prompt = buildWorkerPrompt(spec, false);
    assert.match(prompt, /Hard change budget:/);
    assert.match(prompt, /stop and report the missing decomposition instead of expanding scope/);
    assert.ok(prompt.includes("- At most 4 changed files"));
    assert.ok(prompt.includes("- At most 300 added/deleted lines"));
  }
});

test("non-hard change-budget modes still keep independent acceptance commands visible", () => {
  // Soft wording must not strip scope boundaries or acceptance authority.
  for (const mode of ["warn", "score", "off"] as const) {
    const prompt = buildWorkerPrompt(specWithChangeBudgetMode(mode), false);
    assert.match(prompt, /Hard boundaries:/);
    assert.match(prompt, /Independent acceptance commands:/);
    assert.match(prompt, /Behavioral acceptance criteria:/);
  }
});

// --- Execution mode resolution (FL-104) ---

function codexPolicy(): TaskPolicy {
  const d = cloneDefaults();
  const catalog = upsertModelConfig(d.modelCatalog, {
    id: "codex-luna",
    label: "Codex Luna",
    provider: "openai",
    model: "gpt-5.6-luna",
    endpoint: "https://api.openai.com/v1",
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
  });
  const workerProfiles = upsertWorkerProfile(d.workerProfiles, {
    id: "codex-worker",
    label: "Codex Worker",
    runtime: "codex-cli",
    modelConfigId: "codex-luna",
    effort: "max",
    executionPreference: "auto",
  }, catalog);
  return {
    contractQuality: d.contractQuality,
    execution: d.execution,
    providerDefaults: d.providerDefaults,
    completionPolicy: d.completionPolicy,
    workerProfiles,
    modelCatalog: catalog,
  };
}

test("auto Codex Task freezes native-goal and records the preference", () => {
  const spec = parseTaskSpec(
    { ...contractSpec(), workerProfileId: "codex-worker" },
    process.cwd(),
    codexPolicy(),
  );
  assert.equal(spec.executionPreference, "auto");
  assert.equal(spec.executionMode, "native-goal");
});

test("auto Claude Task freezes single-run because Claude has no proven native Goal", () => {
  const spec = parseTaskSpec(contractSpec(), process.cwd());
  assert.equal(spec.executionPreference, "single-run");
  assert.equal(spec.executionMode, "single-run");
});

test("forced native-goal on Claude fails admission before cost", () => {
  assert.throws(
    () => parseTaskSpec({ ...contractSpec(), executionPreference: "native-goal" }, process.cwd()),
    /native-goal/,
  );
});

test("forced native-goal on Codex freezes native-goal", () => {
  const policy = codexPolicy();
  const spec = parseTaskSpec(
    { ...contractSpec(), workerProfileId: "codex-worker", executionPreference: "native-goal" },
    process.cwd(),
    policy,
  );
  assert.equal(spec.executionPreference, "native-goal");
  assert.equal(spec.executionMode, "native-goal");
});

test("legacy Task without a preference freezes single-run", () => {
  const spec = parseTaskSpec(contractSpec(), process.cwd());
  assert.equal(spec.executionMode, "single-run");
});

test("explicit Task preference override wins over the Worker profile", () => {
  const policy = codexPolicy();
  const spec = parseTaskSpec(
    { ...contractSpec(), workerProfileId: "codex-worker", executionPreference: "single-run" },
    process.cwd(),
    policy,
  );
  assert.equal(spec.executionPreference, "single-run");
  assert.equal(spec.executionMode, "single-run");
});

// --- Per-Worker network policy freezing (FL-107) ---

function networkPolicyPolicy(): TaskPolicy {
  const d = cloneDefaults();
  const catalog = upsertModelConfig(d.modelCatalog, {
    id: "net-proxy-model",
    label: "Net Proxy Model",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    endpoint: "https://api.deepseek.com/v1",
  });
  const workerProfiles = upsertWorkerProfile(d.workerProfiles, {
    id: "net-worker",
    label: "Net Worker",
    runtime: "claude-code",
    modelConfigId: "net-proxy-model",
    effort: "high",
    networkPolicy: {
      mode: "custom-proxy",
      httpProxy: "http://127.0.0.1:7890",
      httpsProxy: "http://127.0.0.1:7891",
      noProxy: "localhost,127.0.0.1",
    },
  }, catalog);
  return {
    contractQuality: d.contractQuality,
    execution: d.execution,
    providerDefaults: d.providerDefaults,
    completionPolicy: d.completionPolicy,
    workerProfiles,
    modelCatalog: catalog,
  };
}

test("Task freezes the resolved network policy from the selected Worker Profile", () => {
  const spec = parseTaskSpec(
    { ...contractSpec(), workerProfileId: "net-worker" },
    process.cwd(),
    networkPolicyPolicy(),
  );
  assert.deepEqual(spec.networkPolicy, {
    mode: "custom-proxy",
    httpProxy: "http://127.0.0.1:7890",
    httpsProxy: "http://127.0.0.1:7891",
    noProxy: "localhost,127.0.0.1",
  });
  assert.ok(Object.isFrozen(spec.networkPolicy), "snapshot must be immutable");
});

test("Task-level networkPolicy override wins over the Worker Profile", () => {
  const spec = parseTaskSpec(
    {
      ...contractSpec(),
      workerProfileId: "net-worker",
      networkPolicy: { mode: "direct" },
    },
    process.cwd(),
    networkPolicyPolicy(),
  );
  assert.deepEqual(spec.networkPolicy, { mode: "direct" });
});

test("Task-level networkPolicy rejects authenticated proxy without echoing it", () => {
  const secretUrl = "http://user:proxy-secret@private-proxy.example:7890";
  assert.throws(
    () => parseTaskSpec(
      {
        ...contractSpec(),
        networkPolicy: { mode: "custom-proxy", httpProxy: secretUrl },
      },
      process.cwd(),
    ),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.ok(!message.includes(secretUrl), "error must not echo the proxy URL");
      assert.ok(!message.includes("proxy-secret"), "error must not echo credentials");
      assert.ok(!message.includes("private-proxy.example"), "error must not echo the hostname");
      return /embedded credentials/.test(message);
    },
  );
});

test("legacy Task without a network policy freezes inherit", () => {
  const spec = parseTaskSpec(contractSpec(), process.cwd());
  assert.deepEqual(spec.networkPolicy, { mode: "inherit" });
});

test("network policy is frozen per Task and later profile edits cannot rewrite history", () => {
  const policy = networkPolicyPolicy();
  const spec = parseTaskSpec(
    { ...contractSpec(), workerProfileId: "net-worker" },
    process.cwd(),
    policy,
  );
  assert.deepEqual(spec.networkPolicy, {
    mode: "custom-proxy",
    httpProxy: "http://127.0.0.1:7890",
    httpsProxy: "http://127.0.0.1:7891",
    noProxy: "localhost,127.0.0.1",
  });
  // A later settings edit switches the same profile to direct.
  const d = cloneDefaults();
  const catalog = upsertModelConfig(d.modelCatalog, {
    id: "net-proxy-model",
    label: "Net Proxy Model",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    endpoint: "https://api.deepseek.com/v1",
  });
  const changed = upsertWorkerProfile(policy.workerProfiles!, {
    id: "net-worker",
    label: "Net Worker",
    runtime: "claude-code",
    modelConfigId: "net-proxy-model",
    effort: "high",
    networkPolicy: { mode: "direct" },
  }, catalog);
  const newSpec = parseTaskSpec(
    { ...contractSpec(), workerProfileId: "net-worker" },
    process.cwd(),
    { ...policy, workerProfiles: changed },
  );
  // The existing Task keeps its frozen custom policy; the new Task uses direct.
  assert.deepEqual(spec.networkPolicy, {
    mode: "custom-proxy",
    httpProxy: "http://127.0.0.1:7890",
    httpsProxy: "http://127.0.0.1:7891",
    noProxy: "localhost,127.0.0.1",
  });
  assert.deepEqual(newSpec.networkPolicy, { mode: "direct" });
});
