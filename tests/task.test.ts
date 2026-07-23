import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildTaskRecord, registerTaskFromSpec } from "../src/core/runner.js";
import { assessTaskQuality, buildWorkerPrompt, loadTaskSpec, parseTaskSpec } from "../src/core/task.js";
import { attemptRuntimeBudget, budgetArguments } from "../src/workers/claude.js";
import { cloneDefaults, type ContractQualitySettings, type TaskPolicy } from "../src/core/settings.js";
import type {
  AttemptRecord,
  EventRecord,
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

test("requires the Worker to run the bounded checkpoint before reporting completion", async () => {
  const loaded = await loadTaskSpec(path.resolve("examples/deepseek-checkout.yaml"));
  const prompt = buildWorkerPrompt(loaded.spec, false);

  assert.match(prompt, /mcp__forklight_checkpoint__run/);
  assert.match(prompt, /acceptance-1/);
  assert.match(prompt, /non-authoritative/);
  assert.match(prompt, /must call/i);
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
