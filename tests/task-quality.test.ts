import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";
import {
  assessTaskQuality,
  buildWorkerPrompt,
  loadTaskSpec,
  parseTaskSpec,
} from "../src/core/task.js";
import {
  assessTaskQualityWithPolicy,
  effectiveQualityPolicyFromGlobal,
} from "../src/core/contract-quality.js";
import { cloneDefaults } from "../src/core/settings.js";
import type {
  ContextContractTaskSpec,
  ContractTaskSpec,
  LegacyTaskSpec,
  TaskBackground,
} from "../src/core/types.js";

/** Domain-neutral version-3 fixture: product research. No modules, call chain,
 *  change budget, or any code-shaped field. */
const NON_CODING_YAML = `version: 3
name: Product Research
project: ./project
worker:
  focusPaths: [research-notes]
contract:
  outcome: A research report recommending the first retention lever with evidence.
  background:
    purpose: Decide which retention lever to pull first.
    audience: Product leadership and the retention squad.
    currentSituation: Churn rose eight percent in the last quarter with no confirmed root cause.
    parentGoalPlan: Goal retention-2026, plan item three.
    priorDecisions:
      - Research before changing the onboarding flow.
    suppliedInputs:
      - Churn cohort export from 2026-07.
      - Support ticket sample.
    downstreamUse: The report sets the quarter retention roadmap.
    workerAuthority:
      - Read the supplied cohort and ticket files only.
      - Do not contact customers or run experiments.
    returnToMain:
      - Recommend the first root cause to act on.
      - Flag any decision needing leadership input.
  inScope:
    - Analyze churn cohorts and ticket themes.
  outOfScope:
    - Implementing any change.
  executionSteps:
    - Read the cohort export and ticket sample.
    - Draft prioritized recommendations.
  deliverables:
    - A concise research report.
  scenarios:
    - name: Conflicting evidence
      given: Cohort and tickets point to different causes
      when: the report is drafted
      then: both causes surface with an explicit decision request
    - name: Small sample
      given: Evidence is thin
      when: recommendations are written
      then: confidence is stated per recommendation
  risks:
    - Small samples may not generalize.
acceptance:
  criteria:
    - The report names one retention lever with evidence.
  commands:
    - "true"
`;

/** Coding version-3 fixture: the same universal background plus an isolated
 *  optional Coding extension (modules, call chain, change budget). */
const CODING_YAML = `version: 3
name: Pricing Refactor
project: ./project
worker:
  focusPaths: [src/pricing]
contract:
  outcome: Refactor the pricing module to read limits from settings.
  background:
    purpose: Make pricing limits configurable without code changes.
    audience: The billing team and operators.
    currentSituation: Pricing limits are hard-coded in the module.
    parentGoalPlan: Goal configurable-platform, plan item two.
    priorDecisions:
      - Keep the public API unchanged.
    suppliedInputs:
      - Current pricing module source.
    downstreamUse: Operators set limits through existing settings.
    workerAuthority:
      - Edit the pricing module and its tests.
    returnToMain:
      - Return any API incompatibility for a Main decision.
  inScope:
    - Move limits into settings.
  outOfScope:
    - Changing the public API shape.
  executionSteps:
    - Locate hard-coded limits.
    - Read limits from settings.
    - Update tests.
  deliverables:
    - Refactored pricing module with passing tests.
  scenarios:
    - name: Missing setting
      given: A limit is absent from settings
      when: the module loads
      then: a default limit is used
    - name: Zero limit
      given: A limit is zero
      when: the module loads
      then: the feature is disabled
  risks:
    - Settings drift could change limits mid-flight.
  coding:
    modules:
      - name: pricing
        responsibility: Resolve pricing limits from settings with defaults
        consumes: [settings, defaults]
        produces: [effective limits]
        boundaries: [no network, no public API change]
    callChain:
      - Settings resolve limits
      - Pricing module reads effective limits
      - Tests verify each limit path
    changeBudget:
      maxFiles: 4
      maxDiffLines: 80
acceptance:
  criteria:
    - Limits come from settings with defaults.
  commands:
    - "true"
`;

/** Parse a version-3 YAML fixture and narrow to the version-3 spec type. */
function parseV3(yaml: string): ContextContractTaskSpec {
  const spec = parseTaskSpec(YAML.parse(yaml), process.cwd());
  if (spec.version !== 3) throw new Error("expected version 3 fixture");
  return spec;
}

/** Fully typed version-3 spec for direct quality calls (bypasses the strict
 *  parser so quality can be exercised on incomplete background shapes). */
function contextSpec(
  overrides: { background?: Partial<TaskBackground> } = {},
): ContextContractTaskSpec {
  return {
    version: 3,
    name: "context-spec",
    project: process.cwd(),
    provider: {
      name: "deepseek",
      model: "deepseek-v4-flash",
      keychainService: "forklight.test",
    },
    runtime: {
      name: "claude-code",
      executable: "claude",
      effort: "high",
      maxBudgetUsd: null,
    },
    workspace: { exclude: [] },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
    contract: {
      outcome: "One observable domain-neutral result",
      background: {
        purpose: "Decide the next move",
        audience: "Leadership",
        currentSituation: "Evidence is incomplete",
        parentGoalPlan: "Goal plan item",
        priorDecisions: ["Research first"],
        suppliedInputs: ["Dataset A"],
        downstreamUse: "Roadmap prioritization",
        workerAuthority: ["Read only"],
        returnToMain: ["Recommend the next move"],
        ...overrides.background,
      },
      inScope: ["Analyze data"],
      outOfScope: ["Implement changes"],
      executionSteps: ["Read inputs", "Draft findings"],
      deliverables: ["A report"],
      scenarios: [
        { name: "normal", given: "valid data", when: "analyzed", then: "recommendation" },
        { name: "sparse", given: "thin data", when: "analyzed", then: "confidence stated" },
      ],
      risks: ["Small sample"],
    },
    acceptance: { criteria: ["A clear recommendation"], commands: ["true"] },
  };
}

/** Minimal valid version-2 Coding spec for the legacy regression assertions. */
function v2CodingSpec(): ContractTaskSpec {
  return {
    version: 2,
    name: "v2-coding",
    project: process.cwd(),
    provider: {
      name: "deepseek",
      model: "deepseek-v4-flash",
      keychainService: "forklight.test",
    },
    runtime: {
      name: "claude-code",
      executable: "claude",
      effort: "high",
      maxBudgetUsd: null,
    },
    workspace: { exclude: [] },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
    contract: {
      outcome: "One observable coding result",
      context: ["Current behavior"],
      inScope: ["Scope"],
      outOfScope: ["Outside"],
      executionSteps: ["Step"],
      deliverables: ["Deliverable"],
      modules: [{
        name: "mod",
        responsibility: "A module responsibility",
        consumes: ["in"],
        produces: ["out"],
        boundaries: ["none"],
      }],
      callChain: ["a", "b"],
      scenarios: [
        { name: "a", given: "g", when: "w", then: "t" },
        { name: "b", given: "g", when: "w", then: "t" },
      ],
      risks: ["risk"],
      changeBudget: { maxFiles: 4, maxDiffLines: 80 },
    },
    acceptance: { criteria: ["c"], commands: ["true"] },
  };
}

/** Minimal valid version-1 legacy spec for the regression assertions. */
function v1LegacySpec(): LegacyTaskSpec {
  return {
    version: 1,
    name: "legacy",
    project: process.cwd(),
    provider: {
      name: "deepseek",
      model: "deepseek-v4-flash",
      keychainService: "forklight.test",
    },
    runtime: {
      name: "claude-code",
      executable: "claude",
      effort: "high",
      maxBudgetUsd: null,
    },
    workspace: { exclude: [] },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
    goal: "legacy goal",
    constraints: ["no shell"],
    acceptance: { commands: ["true"] },
  };
}

test("version 3 non-Coding contract parses without modules, call chain, or change budget", () => {
  const spec = parseV3(NON_CODING_YAML);
  assert.equal(spec.contract.outcome, "A research report recommending the first retention lever with evidence.");
  assert.equal(spec.contract.background.purpose, "Decide which retention lever to pull first.");
  assert.equal(spec.contract.background.audience, "Product leadership and the retention squad.");
  assert.equal(spec.contract.background.currentSituation, "Churn rose eight percent in the last quarter with no confirmed root cause.");
  assert.equal(spec.contract.background.parentGoalPlan, "Goal retention-2026, plan item three.");
  assert.deepEqual(spec.contract.background.priorDecisions, ["Research before changing the onboarding flow."]);
  assert.deepEqual(spec.contract.background.suppliedInputs, [
    "Churn cohort export from 2026-07.",
    "Support ticket sample.",
  ]);
  assert.equal(spec.contract.background.downstreamUse, "The report sets the quarter retention roadmap.");
  assert.deepEqual(spec.contract.background.workerAuthority, [
    "Read the supplied cohort and ticket files only.",
    "Do not contact customers or run experiments.",
  ]);
  assert.deepEqual(spec.contract.background.returnToMain, [
    "Recommend the first root cause to act on.",
    "Flag any decision needing leadership input.",
  ]);
  // Domain-neutral: no code-shaped fields exist anywhere in the contract.
  assert.equal("context" in spec.contract, false);
  assert.equal("modules" in spec.contract, false);
  assert.equal("callChain" in spec.contract, false);
  assert.equal("changeBudget" in spec.contract, false);
  assert.equal(spec.contract.coding, undefined);
  assert.equal(spec.acceptance.criteria.length, 1);

  const quality = assessTaskQuality(spec);
  assert.equal(quality.passed, true);
  assert.equal(quality.score, 100);
});

test("version 3 Coding contract parses with the optional Coding extension", () => {
  const spec = parseV3(CODING_YAML);
  assert.equal(spec.contract.background.purpose, "Make pricing limits configurable without code changes.");
  const coding = spec.contract.coding;
  if (coding === undefined) throw new Error("expected Coding extension");
  assert.equal(coding.modules.length, 1);
  assert.equal(coding.modules[0]!.name, "pricing");
  assert.deepEqual(coding.callChain, [
    "Settings resolve limits",
    "Pricing module reads effective limits",
    "Tests verify each limit path",
  ]);
  assert.deepEqual(coding.changeBudget, { maxFiles: 4, maxDiffLines: 80 });
  // Technical detail stays inside the Coding extension, not the universal brief.
  assert.equal("context" in spec.contract, false);

  const quality = assessTaskQuality(spec);
  assert.equal(quality.passed, true);
  assert.equal(quality.score, 100);
});

test("version 3 round-trips through loadTaskSpec from a real YAML file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-v3-quality-"));
  const project = path.join(root, "project");
  await mkdir(project);
  const taskFile = path.join(root, "task.yaml");
  await writeFile(taskFile, NON_CODING_YAML);
  const loaded = await loadTaskSpec(taskFile);
  if (loaded.spec.version !== 3) throw new Error("expected version 3 fixture");
  assert.equal(loaded.spec.contract.background.purpose, "Decide which retention lever to pull first.");
  assert.equal(loaded.spec.contract.coding, undefined);
  const quality = assessTaskQuality(loaded.spec);
  assert.equal(quality.passed, true);
});

test("version 3 missing purpose fails with a field-specific parse error", () => {
  const obj = YAML.parse(NON_CODING_YAML) as Record<string, unknown>;
  const background = (obj.contract as Record<string, unknown>).background as Record<string, unknown>;
  delete background.purpose;
  assert.throws(
    () => parseTaskSpec(obj, process.cwd()),
    /task\.contract\.background\.purpose must be a non-empty string/,
  );
});

test("version 3 missing return-to-Main boundaries fails with a field-specific parse error", () => {
  const obj = YAML.parse(NON_CODING_YAML) as Record<string, unknown>;
  const background = (obj.contract as Record<string, unknown>).background as Record<string, unknown>;
  delete background.returnToMain;
  assert.throws(
    () => parseTaskSpec(obj, process.cwd()),
    /task\.contract\.background\.returnToMain must contain at least one entry/,
  );
});

test("version 3 quality flags empty background fields with exact field paths", () => {
  const spec = contextSpec({
    background: {
      priorDecisions: [],
      suppliedInputs: [],
      workerAuthority: [],
      returnToMain: [],
    },
  });
  const report = assessTaskQualityWithPolicy(
    spec,
    effectiveQualityPolicyFromGlobal(cloneDefaults().contractQuality),
  );
  assert.equal(report.passed, false);
  const joined = report.issues.join("\n");
  assert.ok(joined.includes("task.contract.background.priorDecisions"));
  assert.ok(joined.includes("task.contract.background.suppliedInputs"));
  assert.ok(joined.includes("task.contract.background.workerAuthority"));
  assert.ok(joined.includes("task.contract.background.returnToMain"));
});

test("version 3 Worker prompt renders background before scope and each fact once", () => {
  const spec = parseV3(NON_CODING_YAML);
  const prompt = buildWorkerPrompt(spec, false);

  const backgroundIndex = prompt.indexOf("Background:");
  const inScopeIndex = prompt.indexOf("In scope:");
  const executionIndex = prompt.indexOf("Execution steps:");
  assert.ok(backgroundIndex >= 0, "background block present");
  assert.ok(inScopeIndex > backgroundIndex, "background leads before scope");
  assert.ok(executionIndex > backgroundIndex, "background leads before execution details");

  // Every required background section renders exactly once.
  for (const section of [
    "Why this matters:",
    "Who or what it serves:",
    "Current situation:",
    "Parent Goal/Plan:",
    "Prior decisions:",
    "Supplied inputs:",
    "How the output is used:",
    "Worker authority:",
    "Decisions that must return to Main:",
  ]) {
    assert.equal(
      prompt.split(section).length - 1,
      1,
      `background section rendered once: ${section}`,
    );
  }

  // The exact Main-authored facts are preserved verbatim.
  assert.ok(prompt.includes("- Why this matters: Decide which retention lever to pull first."));
  assert.ok(prompt.includes("  - Recommend the first root cause to act on."));
  // No coding detail exists for the domain-neutral Task.
  assert.ok(!prompt.includes("Coding detail:"));
  assert.ok(!prompt.includes("Hard change budget:"));
});

test("version 3 Coding prompt places technical detail after the universal brief", () => {
  const spec = parseV3(CODING_YAML);
  const prompt = buildWorkerPrompt(spec, false);

  const backgroundIndex = prompt.indexOf("Background:");
  const codingIndex = prompt.indexOf("Coding detail:");
  const inScopeIndex = prompt.indexOf("In scope:");
  assert.ok(backgroundIndex >= 0);
  assert.ok(codingIndex > backgroundIndex, "coding detail follows the universal brief");
  assert.ok(codingIndex > inScopeIndex, "coding detail follows scope");

  assert.ok(prompt.includes("- pricing: Resolve pricing limits from settings with defaults"));
  assert.ok(prompt.includes("1. Settings resolve limits"));
  assert.ok(prompt.includes("Hard change budget:"));
  assert.ok(prompt.includes("- At most 4 changed files"));
});

test("legacy version 2 Coding prompt keeps its exact byte shape", () => {
  const prompt = buildWorkerPrompt(v2CodingSpec(), false);
  assert.ok(prompt.includes("Context:"));
  assert.ok(prompt.includes("Module contracts:"));
  assert.ok(prompt.includes("Call chain:"));
  assert.ok(prompt.includes("Hard change budget:"));
  assert.ok(!prompt.includes("Background:"));
  assert.ok(!prompt.includes("Coding detail:"));
});

test("legacy version 1 prompt keeps its exact byte shape", () => {
  const prompt = buildWorkerPrompt(v1LegacySpec(), false);
  assert.ok(prompt.includes("Goal: legacy goal"));
  assert.ok(prompt.includes("Hard boundaries:"));
  assert.ok(!prompt.includes("Background:"));
  assert.ok(!prompt.includes("Context:"));
});
