import assert from "node:assert/strict";
import test from "node:test";
import {
  assessTaskQualityWithPolicy,
  deriveEffectiveQualityPolicy,
  previewQualityPolicy,
  resolveEffectiveQualityPolicy,
} from "../src/core/contract-quality.js";
import { cloneDefaults } from "../src/core/settings.js";
import { parseTaskSpec } from "../src/core/task.js";
import type {
  ContractTaskSpec,
  EffectiveQualityPolicySnapshot,
  LegacyTaskSpec,
} from "../src/core/types.js";
import {
  upsertWorkerProfile,
  validateContractQualityOverride,
} from "../src/core/worker-profiles.js";

function validSpec(): ContractTaskSpec {
  return {
    version: 2,
    name: "quality-test",
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
    worker: {
      allowEdits: true,
      allowedCommands: [],
      focusPaths: ["src"],
    },
    contract: {
      outcome: "Deliver one observable and independently verifiable result",
      context: ["Current behavior needs a policy boundary"],
      inScope: ["Quality policy"],
      outOfScope: ["Security policy"],
      executionSteps: ["Resolve", "Assess"],
      deliverables: ["Policy snapshot"],
      modules: [{
        name: "quality",
        responsibility: "Resolve and evaluate Task Contract quality policy",
        consumes: ["settings"],
        produces: ["report"],
        boundaries: ["No authority changes"],
      }],
      callChain: ["Worker Profile resolves", "Task assessment consumes snapshot"],
      scenarios: [
        { name: "normal", given: "valid", when: "assessed", then: "passes" },
        { name: "boundary", given: "large", when: "warned", then: "admits" },
      ],
      risks: ["Mutable settings"],
      changeBudget: { maxFiles: 4, maxDiffLines: 300 },
    },
    acceptance: { criteria: ["Behavior is visible"], commands: ["true"] },
  };
}

function qualitySnapshot(mode: EffectiveQualityPolicySnapshot["mode"]): EffectiveQualityPolicySnapshot {
  const defaults = cloneDefaults().contractQuality;
  return resolveEffectiveQualityPolicy({ mode }, defaults, "test-worker");
}

function rawTask(workerProfileId: string): Record<string, unknown> {
  const spec = validSpec();
  return {
    version: 2,
    name: spec.name,
    project: spec.project,
    workerProfileId,
    contract: {
      ...spec.contract,
      changeBudget: { maxFiles: 100, maxDiffLines: 20_000 },
    },
    worker: { ...spec.worker, focusPaths: [] },
    acceptance: spec.acceptance,
  };
}

test("Worker Quality override preserves explicit null, zero, provenance, and immutability", () => {
  const defaults = cloneDefaults().contractQuality;
  const snapshot = resolveEffectiveQualityPolicy({
    mode: "warn",
    maxFiles: null,
    maxDiffLines: null,
    maxFocusPaths: null,
    minScenarios: 0,
  }, defaults, "loose");

  assert.equal(snapshot.mode, "warn");
  assert.equal(snapshot.modeSource, "worker");
  assert.equal(snapshot.values.maxFiles, null);
  assert.equal(snapshot.values.minScenarios, 0);
  assert.equal(snapshot.provenance.maxFiles, "worker");
  assert.equal(snapshot.provenance.minCallChainSteps, "global");
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.values));
  assert.throws(() => {
    (snapshot.values as { maxFiles: number | null }).maxFiles = 1;
  }, TypeError);
});

test("hard, warn, score, and off keep check truth separate from admission", () => {
  const invalid = validSpec();
  invalid.contract.outcome = "x";

  const hard = assessTaskQualityWithPolicy(invalid, qualitySnapshot("hard"));
  assert.equal(hard.passed, false);
  assert.equal(hard.admitted, false);
  assert.equal(hard.effect, "blocked");
  assert.equal(hard.checks.find((item) => item.id === "outcome")?.effect, "blocking");

  const warn = assessTaskQualityWithPolicy(invalid, qualitySnapshot("warn"));
  assert.equal(warn.passed, false);
  assert.equal(warn.admitted, true);
  assert.equal(warn.effect, "admitted-with-warnings");
  assert.equal(warn.advisories?.length, 1);
  assert.equal(warn.checks.find((item) => item.id === "outcome")?.effect, "warning");

  const score = assessTaskQualityWithPolicy(invalid, qualitySnapshot("score"));
  assert.equal(score.passed, false);
  assert.equal(score.admitted, true);
  assert.equal(score.effect, "admitted-with-score");
  assert.equal(score.checks.find((item) => item.id === "outcome")?.effect, "score-evidence");

  const off = assessTaskQualityWithPolicy(invalid, qualitySnapshot("off"));
  assert.equal(off.passed, false);
  assert.equal(off.admitted, true);
  assert.equal(off.effect, "admitted-ignored");
  assert.equal(off.checks.find((item) => item.id === "outcome")?.effect, "ignored");
});

test("legacy contract version remains blocked even when Quality mode is off", () => {
  const current = validSpec();
  const legacy: LegacyTaskSpec = {
    version: 1,
    name: current.name,
    project: current.project,
    provider: current.provider,
    runtime: current.runtime,
    workspace: current.workspace,
    worker: current.worker,
    goal: "legacy",
    constraints: [],
    acceptance: { commands: ["true"] },
  };
  const report = assessTaskQualityWithPolicy(legacy, qualitySnapshot("off"));
  assert.equal(report.admitted, false);
  assert.equal(report.effect, "blocked");
});

test("Quality preview exposes only layer, value, and provenance", () => {
  const rows = previewQualityPolicy(
    { mode: "warn", maxFiles: null },
    cloneDefaults().contractQuality,
    "loose",
  );
  assert.deepEqual(rows[0], {
    field: "mode",
    value: "warn",
    source: "worker",
    layer: "quality",
  });
  assert.deepEqual(rows.find((row) => row.field === "maxFiles"), {
    field: "maxFiles",
    value: null,
    source: "worker",
    layer: "quality",
  });
  assert.doesNotMatch(JSON.stringify(rows), /command|prompt|secret|token/i);
});

test("Worker Quality validation rejects unknown and malformed fields", () => {
  assert.deepEqual(validateContractQualityOverride({
    mode: "warn",
    maxFiles: null,
    minScenarios: 0,
  }), { mode: "warn", maxFiles: null, minScenarios: 0 });
  assert.throws(() => validateContractQualityOverride({ maxFilez: 4 }), /not a recognized/);
  assert.throws(() => validateContractQualityOverride({ maxFiles: 0 }), /positive integer/);
  assert.throws(() => validateContractQualityOverride({ minScenarios: -1 }), /non-negative/);
  assert.throws(() => validateContractQualityOverride({ mode: "soft" }), /hard, warn, score, or off/);
  assert.throws(() => validateContractQualityOverride({ apiKey: "secret" }), /not a recognized/);
});

test("parseTaskSpec resolves and freezes the selected Worker Quality policy", () => {
  const settings = cloneDefaults();
  const profiles = upsertWorkerProfile(settings.workerProfiles, {
    id: "loose",
    label: "Loose development",
    runtime: "claude-code",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    contractQuality: {
      mode: "warn",
      maxFiles: null,
      maxDiffLines: null,
      maxFocusPaths: null,
      minScenarios: 0,
    },
  });
  const policy = {
    contractQuality: settings.contractQuality,
    execution: settings.execution,
    providerDefaults: settings.providerDefaults,
    completionPolicy: settings.completionPolicy,
    workerProfiles: profiles,
    modelCatalog: settings.modelCatalog,
  };

  const spec = parseTaskSpec(rawTask("loose"), process.cwd(), policy);
  assert.equal(spec.qualityPolicy?.profileId, "loose");
  assert.equal(spec.qualityPolicy?.mode, "warn");
  assert.equal(spec.qualityPolicy?.values.maxFiles, null);
  assert.ok(Object.isFrozen(spec.qualityPolicy));

  const storedValue = spec.qualityPolicy?.values.maxFiles;
  profiles.profiles.find((profile) => profile.id === "loose")!.contractQuality!.maxFiles = 1;
  assert.equal(spec.qualityPolicy?.values.maxFiles, storedValue);
});

test("Quality off cannot disable hard command-authority and acceptance boundaries", () => {
  const settings = cloneDefaults();
  const profiles = upsertWorkerProfile(settings.workerProfiles, {
    id: "off",
    label: "Quality off",
    runtime: "claude-code",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    contractQuality: { mode: "off", maxFiles: null, maxDiffLines: null },
  });
  const policy = {
    contractQuality: settings.contractQuality,
    execution: settings.execution,
    providerDefaults: settings.providerDefaults,
    completionPolicy: settings.completionPolicy,
    workerProfiles: profiles,
    modelCatalog: settings.modelCatalog,
  };
  const withCommand = rawTask("off");
  withCommand.worker = {
    allowEdits: true,
    focusPaths: [],
    allowedCommands: ["rm -rf project"],
  };
  assert.throws(
    () => parseTaskSpec(withCommand, process.cwd(), policy),
    /allowedCommands to be empty/,
  );

  const noAcceptance = rawTask("off");
  noAcceptance.acceptance = { criteria: [], commands: [] };
  assert.throws(
    () => parseTaskSpec(noAcceptance, process.cwd(), policy),
    /must contain at least one independent verification command/,
  );
});

test("deriveEffectiveQualityPolicy always returns an explicit global snapshot", () => {
  const settings = cloneDefaults();
  const snapshot = deriveEffectiveQualityPolicy(undefined, settings);
  assert.equal(snapshot.profileId, "global");
  assert.equal(snapshot.mode, "hard");
  assert.equal(snapshot.modeSource, "global");
});
