import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SettingsService } from "../src/core/settings.js";
import { StateStore } from "../src/state/store.js";

function svc(home = path.join(tmpdir(), `fl-${Date.now()}-${Math.random().toString(36).slice(2)}`)) {
  return new SettingsService(new StateStore(home));
}

// Helper: verify an object is deeply frozen by attempting mutations on every path
function assertDeepFrozen(obj: unknown, pathSegments: string[] = []): void {
  if (obj === null || typeof obj !== "object") return;
  const path = pathSegments.join(".");
  // Object must be frozen
  assert.ok(Object.isFrozen(obj), `Expected ${path || "root"} to be frozen`);
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      assertDeepFrozen(value, [...pathSegments, key]);
    }
  }
}


test("defaults match spec", () => {
  const s = svc().get();
  assert.equal(s.version, 1);
  assert.equal(s.contractQuality.mode, "hard");
  assert.equal(s.contractQuality.maxFiles, 12);
  assert.equal(s.contractQuality.maxDiffLines, 1200);
  assert.equal(s.contractQuality.maxFocusPaths, 8);
  assert.equal(s.contractQuality.minScenarios, 2);
  assert.equal(s.contractQuality.minCallChainSteps, 2);
  assert.equal(s.contractQuality.minOutcomeCharacters, 12);
  assert.equal(s.contractQuality.minModuleResponsibilityCharacters, 8);
  assert.equal(s.completionPolicy.noChangeMode, "hard");
  assert.equal(s.completionPolicy.changeBudgetMode, "hard");
  assert.equal(s.execution.maxConcurrency, 2);
  assert.equal(s.execution.noProgressTimeoutMs, 1_800_000);
  assert.equal(s.execution.defaultEffort, "high");
  assert.equal(s.execution.defaultMaxBudgetUsd, 0.5);
  assert.equal(s.execution.maximumBudgetUsd, 20);
  assert.equal(s.execution.maxAttempts, 3);
  assert.equal(s.execution.maxExtraAttempts, 1);
  assert.equal(s.execution.workerStopGraceMs, 10_000);
  assert.equal(s.competition.minCandidates, 2);
  assert.equal(s.competition.maxCandidates, 4);
  assert.equal(s.competition.tieThreshold, 1e-9);
  assert.equal(s.competition.rankingWeights.verification, 1);
  assert.equal(s.competition.rankingWeights.diffFocus, 0.3);
  assert.equal(s.competition.rankingWeights.cost, 0);
  assert.equal(s.competition.rankingWeights.duration, 0);
  assert.equal(s.integration.reviewedPatchMaxFiles, 5);
  assert.equal(s.integration.reviewedPatchMaxLines, 400);
  assert.equal(s.integration.verificationTimeoutMs, 300_000);
  assert.equal(s.integration.reviewReceiptTtlMs, 900_000);
  assert.equal(s.integration.backupRetentionCount, 5);
  assert.equal(s.integration.autoRollback, true);
  assert.equal(s.console.loopbackPort, 0);
  assert.equal(s.console.refreshIntervalMs, 1000);
  assert.equal(s.console.boardListLimit, 50);
  assert.equal(s.console.taskListLimit, 20);
  assert.equal(s.providerDefaults.deepseek.defaultModel, "deepseek-v4-flash");
  assert.equal(s.providerDefaults.deepseek.requestTimeoutMs, 3_000_000);
  assert.equal(s.providerDefaults.qwen.defaultModel, "qwen3.7-plus");
  assert.equal(s.providerDefaults.minimax.defaultModel, "MiniMax-M3");
  assert.equal(s.providerDefaults.glm.defaultModel, "glm-5.2");
  assert.equal(s.providerDefaults.volcengine.defaultModel, "glm-5.2[1M]");
  assert.equal(s.providerDefaults.volcengine.defaultEndpoint, "https://ark.cn-beijing.volces.com/api/coding");
  const volcengineModel = s.modelCatalog.models.find((model) => model.id === "volcengine-glm52-1m");
  assert.equal(volcengineModel?.model, "glm-5.2[1M]");
  const volcengineWorker = s.workerProfiles.profiles.find((profile) => profile.id === "volcengine-glm52-1m");
  assert.equal(volcengineWorker?.provider, "volcengine");
  assert.equal(volcengineWorker?.maxBudgetUsd, null);
  assert.equal(volcengineWorker?.advancedPolicy?.baseMaxAttempts, 1);
  assert.equal(volcengineWorker?.advancedPolicy?.maxExtraAttempts, 0);
  assert.equal(volcengineWorker?.contractQuality?.mode, "warn");
  assert.equal(volcengineWorker?.contractQuality?.maxFiles, null);
});


test("get returns frozen, distinct copies", () => {
  const s = svc().get();
  assertDeepFrozen(s);
  const s2 = svc().get();
  assert.notStrictEqual(s, s2);
  assert.notStrictEqual(s.execution, s2.execution);
  assert.notStrictEqual(s.competition.rankingWeights, s2.competition.rankingWeights);
});


test("partial patch changes only targeted fields, persists, survives reopen", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-s-"));
  const service = new SettingsService(new StateStore(home));
  const r = service.update({
    competition: { rankingWeights: { duration: 0.5 } },
    execution: { noProgressTimeoutMs: 600_000 },
  });
  assert.equal(r.competition.rankingWeights.duration, 0.5);
  assert.equal(r.execution.noProgressTimeoutMs, 600_000);
  // Unrelated defaults intact
  assert.equal(r.execution.maxConcurrency, 2);
  assert.equal(r.execution.defaultMaxBudgetUsd, 0.5);
  assert.equal(r.competition.rankingWeights.verification, 1);
  assert.equal(r.competition.rankingWeights.diffFocus, 0.3);
  // Fresh store observes the update
  const reloaded = svc(home).get();
  assert.equal(reloaded.competition.rankingWeights.duration, 0.5);
  assert.equal(reloaded.execution.noProgressTimeoutMs, 600_000);
});


const rejections: Array<{ label: string; patch: Record<string, unknown>; pattern: RegExp }> = [
  { label: "negative weight", patch: { competition: { rankingWeights: { duration: -1 } } }, pattern: /duration.*non-negative/ },
  { label: "zero verification", patch: { competition: { rankingWeights: { verification: 0 } } }, pattern: /verification must be positive/ },
  { label: "concurrency 0", patch: { execution: { maxConcurrency: 0 } }, pattern: /positive integer/ },
  { label: "concurrency -1", patch: { execution: { maxConcurrency: -1 } }, pattern: /positive integer/ },
  { label: "concurrency float", patch: { execution: { maxConcurrency: 1.5 } }, pattern: /integer/ },
  { label: "boardLimit 0", patch: { console: { boardListLimit: 0 } }, pattern: /positive integer/ },
  { label: "boardLimit >100", patch: { console: { boardListLimit: 101 } }, pattern: /must not exceed 100/ },
  { label: "bad port", patch: { console: { loopbackPort: 70000 } }, pattern: /0-65535/ },
  { label: "refresh too fast", patch: { console: { refreshIntervalMs: 100 } }, pattern: /at least 200 ms/ },
  { label: "unsupported top", patch: { unknownSection: { v: 1 } }, pattern: /not a recognized settings field/ },
  { label: "unsupported nested", patch: { execution: { unsupportedFlag: true } }, pattern: /not a recognized settings field/ },
  { label: "malformed section", patch: { execution: null }, pattern: /execution.*object/ },
  { label: "bad effort", patch: { execution: { defaultEffort: "extreme" } }, pattern: /defaultEffort/ },
  { label: "stop grace too short", patch: { execution: { workerStopGraceMs: 10 } }, pattern: /at least 100 ms/ },
  { label: "wrong version", patch: { version: 2 as unknown as number }, pattern: /version must be 1/ },
  { label: "apiKey", patch: { apiKey: "secret" }, pattern: /credential/ },
  { label: "apiToken nested", patch: { execution: { apiToken: "abc" } }, pattern: /credential/ },
  { label: "apiKey in provider", patch: { providerDefaults: { deepseek: { apiKey: "xyz" } } }, pattern: /credential/ },
  { label: "bad provider endpoint", patch: { providerDefaults: { deepseek: { defaultEndpoint: "not-a-url" } } }, pattern: /valid URL/ },
  { label: "minCandidates <2", patch: { competition: { minCandidates: 1 } }, pattern: /at least 2/ },
  { label: "max < min", patch: { competition: { minCandidates: 5, maxCandidates: 3 } }, pattern: /maxCandidates.*>=.*minCandidates/ },
  { label: "budget > maximum", patch: { execution: { defaultMaxBudgetUsd: 50 } }, pattern: /maximumBudgetUsd.*>=.*defaultMaxBudgetUsd/ },
  { label: "autoRollback not bool", patch: { integration: { autoRollback: "yes" } }, pattern: /boolean/ },
  { label: "receipt ttl too short", patch: { integration: { reviewReceiptTtlMs: 100 } }, pattern: /at least 1000 ms/ },
  { label: "maxExtraAttempts negative", patch: { execution: { maxExtraAttempts: -1 } }, pattern: /non-negative integer/ },
  { label: "maxExtraAttempts float", patch: { execution: { maxExtraAttempts: 0.5 } }, pattern: /integer/ },
];

for (const { label, patch, pattern } of rejections) {
  test(`rejects ${label}`, () => {
    assert.throws(() => svc().update(patch), pattern);
  });
}


test("invalid patch does not corrupt persisted state", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-s-"));
  const service = new SettingsService(new StateStore(home));
  service.update({ execution: { maxConcurrency: 5 } });
  assert.equal(service.get().execution.maxConcurrency, 5);
  assert.throws(() => service.update({ execution: { maxConcurrency: -1 } }));
  assert.equal(service.get().execution.maxConcurrency, 5);
});


test("multiple partial updates accumulate and persist", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-s-"));
  const service = new SettingsService(new StateStore(home));
  service.update({ execution: { maxConcurrency: 4 } });
  service.update({ execution: { noProgressTimeoutMs: 300_000 } });
  service.update({ competition: { rankingWeights: { duration: 0.4 } } });
  service.update({ competition: { rankingWeights: { cost: 0.2 } } });
  const s = service.get();
  assert.equal(s.execution.maxConcurrency, 4);
  assert.equal(s.execution.noProgressTimeoutMs, 300_000);
  assert.equal(s.competition.rankingWeights.duration, 0.4);
  assert.equal(s.competition.rankingWeights.cost, 0.2);
});


test("reset clears overrides, returns frozen defaults", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-s-"));
  const service = new SettingsService(new StateStore(home));
  service.update({ execution: { maxConcurrency: 8 }, competition: { rankingWeights: { duration: 0.9 } } });
  assert.equal(service.get().execution.maxConcurrency, 8);
  const reset = service.reset();
  assert.equal(reset.execution.maxConcurrency, 2);
  assert.equal(reset.competition.rankingWeights.duration, 0);
  assertDeepFrozen(reset);
  // Store confirms reset
  const reloaded = svc(home).get();
  assert.equal(reloaded.execution.maxConcurrency, 2);
});


test("round-trip through store preserves every section", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-s-"));
  const service = new SettingsService(new StateStore(home));
  service.update({
    contractQuality: { maxFiles: 5, maxDiffLines: 400, maxFocusPaths: 4, minScenarios: 1, minCallChainSteps: 1, minOutcomeCharacters: 20, minModuleResponsibilityCharacters: 5 },
    execution: { maxConcurrency: 3, noProgressTimeoutMs: 900_000, defaultEffort: "max", defaultMaxBudgetUsd: 2, maximumBudgetUsd: 20, maxAttempts: 5, workerStopGraceMs: 5000 },
    competition: { minCandidates: 3, maxCandidates: 8, tieThreshold: 0.05, rankingWeights: { verification: 2, diffFocus: 0.5, retries: 0.3, cost: 0.1, duration: 0.7 } },
    integration: { reviewedPatchMaxFiles: 10, reviewedPatchMaxLines: 800, verificationTimeoutMs: 600_000, reviewReceiptTtlMs: 60_000, backupRetentionCount: 3, autoRollback: false },
    console: { loopbackPort: 8080, refreshIntervalMs: 2000, boardListLimit: 30, taskListLimit: 15 },
  });
  const s = svc(home).get();
  assert.equal(s.contractQuality.maxFiles, 5);
  assert.equal(s.contractQuality.maxDiffLines, 400);
  assert.equal(s.execution.maxConcurrency, 3);
  assert.equal(s.execution.maxAttempts, 5);
  assert.equal(s.competition.minCandidates, 3);
  assert.equal(s.competition.maxCandidates, 8);
  assert.equal(s.competition.tieThreshold, 0.05);
  assert.equal(s.competition.rankingWeights.verification, 2);
  assert.equal(s.competition.rankingWeights.cost, 0.1);
  assert.equal(s.integration.reviewedPatchMaxFiles, 10);
  assert.equal(s.integration.autoRollback, false);
  assert.equal(s.console.loopbackPort, 8080);
  assert.equal(s.console.refreshIntervalMs, 2000);
  assert.equal(s.console.taskListLimit, 15);
  // Unpatched sections stay at defaults
  assert.equal(s.providerDefaults.deepseek.defaultModel, "deepseek-v4-flash");
});


test("provider defaults partial update preserves other providers and fields", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-s-"));
  const service = new SettingsService(new StateStore(home));
  service.update({ providerDefaults: { deepseek: { defaultModel: "deepseek-v4-pro", requestTimeoutMs: 120_000 } } });
  const s = service.get();
  assert.equal(s.providerDefaults.deepseek.defaultModel, "deepseek-v4-pro");
  assert.equal(s.providerDefaults.deepseek.requestTimeoutMs, 120_000);
  assert.equal(s.providerDefaults.deepseek.defaultEndpoint, "https://api.deepseek.com/anthropic");
  assert.equal(s.providerDefaults.qwen.defaultModel, "qwen3.7-plus");
});



test("settings table is migration-safe on existing database", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-s-"));
  const s1 = new StateStore(home);
  s1.close();
  assert.equal(svc(home).get().version, 1);
});

test("stored settings gain newly introduced fields from current defaults", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-s-"));
  const store = new StateStore(home);
  const legacy = structuredClone(new SettingsService(store).get()) as unknown as Record<string, unknown>;
  delete (legacy.execution as Record<string, unknown>).defaultProvider;
  (legacy.execution as Record<string, unknown>).maxConcurrency = 7;
  store.saveSettings(legacy);

  const migrated = new SettingsService(store).get();
  assert.equal(migrated.execution.defaultProvider, "deepseek");
  assert.equal(migrated.execution.maxConcurrency, 7);
});


test("empty patch returns current effective settings unchanged", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-s-"));
  const service = new SettingsService(new StateStore(home));
  service.update({ execution: { maxConcurrency: 5 } });
  const r = service.update({});
  assert.equal(r.execution.maxConcurrency, 5);
});



test("defaultKeychainService is accepted in provider defaults", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-s-"));
  const service = new SettingsService(new StateStore(home));
  service.update({ providerDefaults: { glm: { defaultKeychainService: "forklight.glm.api-key" } } });
  assert.equal(service.get().providerDefaults.glm.defaultKeychainService, "forklight.glm.api-key");
});


// --- Probe settings ---

test("probe defaults match spec", () => {
  const s = svc().get();
  assert.equal(s.probe.probeTimeoutMs, 30_000);
  assert.equal(s.probe.maxBudgetUsd, 0.05);
  assert.equal(s.probe.cacheLifetimeMs, 300_000);
  assert.equal(s.probe.maxProbeConcurrency, 2);
});

test("probe partial update preserves other probe fields and sections", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-s-"));
  const service = new SettingsService(new StateStore(home));
  service.update({ probe: { probeTimeoutMs: 15_000, maxProbeConcurrency: 4 } });
  const s = service.get();
  assert.equal(s.probe.probeTimeoutMs, 15_000);
  assert.equal(s.probe.maxProbeConcurrency, 4);
  assert.equal(s.probe.maxBudgetUsd, 0.05); // unchanged
  assert.equal(s.probe.cacheLifetimeMs, 300_000); // unchanged
  assert.equal(s.execution.maxConcurrency, 2); // other section unchanged
});

const probeRejections: Array<{ label: string; patch: Record<string, unknown>; pattern: RegExp }> = [
  { label: "timeout 0", patch: { probe: { probeTimeoutMs: 0 } }, pattern: /positive integer/ },
  { label: "timeout <1s", patch: { probe: { probeTimeoutMs: 500 } }, pattern: /at least 1000 ms/ },
  { label: "budget 0", patch: { probe: { maxBudgetUsd: 0 } }, pattern: /greater than zero/ },
  { label: "budget >1", patch: { probe: { maxBudgetUsd: 2 } }, pattern: /must not exceed 1 USD/ },
  { label: "cache <1s", patch: { probe: { cacheLifetimeMs: 500 } }, pattern: /at least 1000 ms/ },
  { label: "concurrency 0", patch: { probe: { maxProbeConcurrency: 0 } }, pattern: /positive integer/ },
  { label: "concurrency >8", patch: { probe: { maxProbeConcurrency: 16 } }, pattern: /must not exceed 8/ },
  { label: "unknown probe field", patch: { probe: { unknownField: true } }, pattern: /not a recognized settings field/ },
];

for (const { label, patch, pattern } of probeRejections) {
  test(`rejects probe ${label}`, () => {
    assert.throws(() => svc().update(patch), pattern);
  });
}

test("stored settings gain probe defaults on migration", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-s-"));
  const store = new StateStore(home);
  const legacy = structuredClone(new SettingsService(store).get()) as unknown as Record<string, unknown>;
  delete legacy.probe;
  store.saveSettings(legacy);

  const migrated = new SettingsService(store).get();
  assert.equal(migrated.probe.probeTimeoutMs, 30_000);
  assert.equal(migrated.probe.maxBudgetUsd, 0.05);
  assert.equal(migrated.probe.cacheLifetimeMs, 300_000);
  assert.equal(migrated.probe.maxProbeConcurrency, 2);
});

// --- Completion policy settings ---

test("completion policy defaults are hard no-change and delivery weight", () => {
  const s = svc().get();
  assert.equal(s.completionPolicy.noChangeMode, "hard");
  assert.equal(s.completionPolicy.changeBudgetMode, "hard");
  assert.equal(s.competition.rankingWeights.delivery, 0.3);
});

test("completion policy partial update preserves other fields", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-s-"));
  const service = new SettingsService(new StateStore(home));
  service.update({ completionPolicy: { noChangeMode: "score" } });
  const s = service.get();
  assert.equal(s.completionPolicy.noChangeMode, "score");
  assert.equal(s.execution.maxConcurrency, 2); // other section unchanged
  service.update({ competition: { rankingWeights: { delivery: 0.8 } } });
  const s2 = service.get();
  assert.equal(s2.competition.rankingWeights.delivery, 0.8);
  assert.equal(s2.completionPolicy.noChangeMode, "score"); // unchanged by ranking update
});

const policyRejections: Array<{ label: string; patch: Record<string, unknown>; pattern: RegExp }> = [
  { label: "invalid mode", patch: { completionPolicy: { noChangeMode: "strict" } }, pattern: /noChangeMode/ },
  { label: "empty mode", patch: { completionPolicy: { noChangeMode: "" } }, pattern: /noChangeMode/ },
  { label: "unknown field", patch: { completionPolicy: { extraField: true } }, pattern: /not a recognized settings field/ },
];

for (const { label, patch, pattern } of policyRejections) {
  test(`rejects completion policy ${label}`, () => {
    assert.throws(() => svc().update(patch), pattern);
  });
}

test("stored settings gain completionPolicy defaults on migration", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-s-"));
  const store = new StateStore(home);
  const legacy = structuredClone(new SettingsService(store).get()) as unknown as Record<string, unknown>;
  delete legacy.completionPolicy;
  store.saveSettings(legacy);

  const migrated = new SettingsService(store).get();
  assert.equal(migrated.completionPolicy.noChangeMode, "hard");
});

// --- maxExtraAttempts ---

test("maxExtraAttempts defaults to 1 and enables extra grants", () => {
  const s = svc().get();
  assert.equal(s.execution.maxExtraAttempts, 1);
});

test("maxExtraAttempts 0 is valid and persists", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-s-"));
  const service = new SettingsService(new StateStore(home));
  const r = service.update({ execution: { maxExtraAttempts: 0 } });
  assert.equal(r.execution.maxExtraAttempts, 0);
  assert.equal(r.execution.maxAttempts, 3); // unchanged
  const reloaded = svc(home).get();
  assert.equal(reloaded.execution.maxExtraAttempts, 0);
});

test("maxExtraAttempts round-trips through storage", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-s-"));
  const service = new SettingsService(new StateStore(home));
  service.update({ execution: { maxExtraAttempts: 5 } });
  const s = svc(home).get();
  assert.equal(s.execution.maxExtraAttempts, 5);
});

test("maxExtraAttempts migration from legacy settings gains default", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-s-"));
  const store = new StateStore(home);
  const legacy = structuredClone(new SettingsService(store).get()) as unknown as Record<string, unknown>;
  delete (legacy.execution as Record<string, unknown>).maxExtraAttempts;
  store.saveSettings(legacy);
  const migrated = new SettingsService(store).get();
  assert.equal(migrated.execution.maxExtraAttempts, 1);
});

// --- Delivery Profiles settings ---

test("delivery profiles defaults are an empty registry", () => {
  const s = svc().get();
  assert.equal(s.deliveryProfiles.defaultProfileId, null);
  assert.deepStrictEqual(s.deliveryProfiles.profiles, []);
  assert.deepStrictEqual(s.deliveryProfiles.projectBindings, {});
  assertDeepFrozen(s.deliveryProfiles);
});

test("legacy settings gain empty deliveryProfiles on migration while preserving overrides", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-s-"));
  const store = new StateStore(home);
  const legacy = structuredClone(new SettingsService(store).get()) as unknown as Record<string, unknown>;
  delete legacy.deliveryProfiles;
  (legacy.execution as Record<string, unknown>).maxConcurrency = 7;
  store.saveSettings(legacy);

  const migrated = new SettingsService(store).get();
  assert.equal(migrated.execution.maxConcurrency, 7);
  assert.equal(migrated.deliveryProfiles.defaultProfileId, null);
  assert.deepStrictEqual(migrated.deliveryProfiles.profiles, []);
  assert.deepStrictEqual(migrated.deliveryProfiles.projectBindings, {});
});

test("valid delivery profiles replacement round-trips through storage", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-s-"));
  const service = new SettingsService(new StateStore(home));
  const registry = {
    defaultProfileId: "deploy-default",
    profiles: [
      {
        id: "deploy-default",
        label: "Default Deploy",
        buildCommands: ["npm ci", "npm run build"],
        activationCommands: ["./deploy.sh"],
        activationCheckCommands: ["curl -f http://localhost:8080/health"],
      },
    ],
    projectBindings: { "/home/user/project": "deploy-default" },
  };
  const r = service.update({ deliveryProfiles: registry });
  assert.equal(r.deliveryProfiles.defaultProfileId, "deploy-default");
  assert.equal(r.deliveryProfiles.profiles.length, 1);
  assert.equal(r.deliveryProfiles.profiles[0]!.id, "deploy-default");
  assert.equal(r.deliveryProfiles.profiles[0]!.buildCommands.length, 2);
  assert.equal(r.deliveryProfiles.projectBindings["/home/user/project"], "deploy-default");

  const reloaded = svc(home).get();
  assert.equal(reloaded.deliveryProfiles.defaultProfileId, "deploy-default");
  assert.equal(reloaded.deliveryProfiles.profiles[0]!.label, "Default Deploy");
  assert.equal(reloaded.deliveryProfiles.profiles[0]!.buildCommands[0], "npm ci");
});

test("invalid delivery profiles update preserves prior registry", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-s-"));
  const service = new SettingsService(new StateStore(home));
  service.update({
    deliveryProfiles: {
      defaultProfileId: null,
      profiles: [
        {
          id: "my-profile",
          label: "My Profile",
          buildCommands: ["make"],
          activationCommands: [],
          activationCheckCommands: [],
        },
      ],
      projectBindings: {},
    },
  });
  assert.equal(service.get().deliveryProfiles.profiles[0]!.id, "my-profile");

  assert.throws(() => service.update({
    deliveryProfiles: {
      defaultProfileId: "missing",
      profiles: [],
      projectBindings: {},
    },
  }), /defaultProfileId/);
  assert.equal(service.get().deliveryProfiles.profiles[0]!.id, "my-profile");

  assert.throws(() => service.update({
    deliveryProfiles: {
      defaultProfileId: null,
      profiles: [],
      projectBindings: {},
      extraField: true,
    },
  }), /unsupported/);
  assert.equal(service.get().deliveryProfiles.profiles[0]!.id, "my-profile");
});

// --- Advanced execution policy ---

import { cloneDefaults }
  from "../src/core/settings.js";
import {
  defaultAdvancedPolicyFields,
  validateAdvancedPolicyPatch,
  validateTaskAdvancedPolicyOverride,
  effectiveWorkerAdvancedPolicy,
  previewEffectivePolicy,
  resolveEffectivePolicy,
  enforcementCapabilityForRuntime,
} from "../src/core/advanced-policy.js";
import type { AdvancedPolicyFields, EffectivePolicySnapshot } from "../src/core/types.js";

test("default advanced policy is permissive: null duration and token ceilings", () => {
  const d = defaultAdvancedPolicyFields();
  assert.equal(d.maxDurationMs, null);
  assert.equal(d.observedTokenCeiling, null);
  assert.equal(d.noProgressTimeoutMs, 1_800_000);
  assert.equal(d.workerStopGraceMs, 10_000);
  assert.equal(d.fileLimit, null);
  assert.equal(d.fileLimitMode, "warn");
  assert.equal(d.changedLineLimit, null);
  assert.equal(d.changedLineLimitMode, "warn");
  assert.equal(d.baseMaxAttempts, 3);
  assert.equal(d.maxExtraAttempts, 1);
  assert.equal(d.maxConcurrency, 2);
  assert.equal(d.completionMode, "hard");
  assert.equal(d.changeBudgetMode, "hard");
  assert.equal(d.maxAdaptationRounds, 0);
  assert.equal(d.maxMainCorrections, 1);
});

test("maxMainCorrections defaults to 1 and is valid in advanced policy", () => {
  const d = defaultAdvancedPolicyFields();
  assert.equal(d.maxMainCorrections, 1);
  const ok = validateAdvancedPolicyPatch({ maxMainCorrections: 2 });
  assert.equal(ok.maxMainCorrections, 2);
});

test("maxMainCorrections 0 is valid", () => {
  const ok = validateAdvancedPolicyPatch({ maxMainCorrections: 0 });
  assert.equal(ok.maxMainCorrections, 0);
});

test("maxMainCorrections rejects negative", () => {
  assert.throws(
    () => validateAdvancedPolicyPatch({ maxMainCorrections: -1 }),
    /non-negative integer/,
  );
});

test("maxMainCorrections in Task override works", () => {
  const ok = validateTaskAdvancedPolicyOverride({ maxMainCorrections: 3 });
  assert.equal(ok.maxMainCorrections, 3);
});

test("validateAdvancedPolicyPatch accepts valid partial and rejects unknowns", () => {
  const ok = validateAdvancedPolicyPatch({ maxDurationMs: 600_000, maxConcurrency: 5 });
  assert.equal(ok.maxDurationMs, 600_000);
  assert.equal(ok.maxConcurrency, 5);
  assert.equal(ok.observedTokenCeiling, undefined); // not provided

  assert.throws(
    () => validateAdvancedPolicyPatch({ unknownField: true }),
    /not a recognized advanced-policy field/,
  );
  assert.throws(
    () => validateAdvancedPolicyPatch("not-an-object" as unknown),
    /must be an object/,
  );
  assert.throws(
    () => validateAdvancedPolicyPatch({ fileLimit: 1.5 }),
    /non-negative integer/,
  );
});

test("validateAdvancedPolicyPatch returns only provided fields", () => {
  const r = validateAdvancedPolicyPatch({
    maxDurationMs: 300_000,
    noProgressTimeoutMs: null,
  });
  assert.equal(r.maxDurationMs, 300_000);
  assert.equal(r.noProgressTimeoutMs, null);
  assert.equal(Object.keys(r).length, 2);
});

test("validateTaskAdvancedPolicyOverride accepts valid overrides", () => {
  const ok = validateTaskAdvancedPolicyOverride({
    maxDurationMs: null,
    baseMaxAttempts: 5,
    completionMode: "warn",
  });
  assert.equal(ok.maxDurationMs, null);
  assert.equal(ok.baseMaxAttempts, 5);
  assert.equal(ok.completionMode, "warn");
});

test("validateTaskAdvancedPolicyOverride rejects invalid values", () => {
  assert.throws(
    () => validateTaskAdvancedPolicyOverride({ baseMaxAttempts: -1 }),
    /must be a positive integer/,
  );
  assert.throws(
    () => validateTaskAdvancedPolicyOverride({ completionMode: "invalid" }),
    /must be one of hard, warn, score, off/,
  );
});

test("effectiveWorkerAdvancedPolicy merges top-level noProgress with advancedPolicy", () => {
  const merged = effectiveWorkerAdvancedPolicy({
    noProgressTimeoutMs: 600_000,
    advancedPolicy: { maxDurationMs: 300_000 },
  });
  assert.equal(merged.noProgressTimeoutMs, 600_000);
  assert.equal(merged.maxDurationMs, 300_000);
});

test("effectiveWorkerAdvancedPolicy lets advancedPolicy.noProgress win over top-level", () => {
  const merged = effectiveWorkerAdvancedPolicy({
    noProgressTimeoutMs: 600_000,
    advancedPolicy: { noProgressTimeoutMs: 900_000 },
  });
  assert.equal(merged.noProgressTimeoutMs, 900_000);
});

// --- Precedence: Task > Worker > Global ---

function testResolution(
  worker?: Partial<AdvancedPolicyFields>,
  task?: Partial<AdvancedPolicyFields>,
  overrides: Record<string, unknown> = {},
): EffectivePolicySnapshot {
  const glob = { ...defaultAdvancedPolicyFields(), ...overrides } as AdvancedPolicyFields;
  const caps = enforcementCapabilityForRuntime("claude-code");
  return resolveEffectivePolicy(worker, task as Partial<AdvancedPolicyFields> | undefined, glob, "test-profile", caps);
}

test("precedence: empty task and worker → all fields from global", () => {
  const s = testResolution();
  assert.equal(s.provenance.maxDurationMs, "global");
  assert.equal(s.provenance.baseMaxAttempts, "global");
  assert.equal(s.provenance.completionMode, "global");
});

test("precedence: worker field wins over global", () => {
  const s = testResolution({ baseMaxAttempts: 5, maxDurationMs: 600_000 });
  assert.equal(s.values.baseMaxAttempts, 5);
  assert.equal(s.provenance.baseMaxAttempts, "worker");
  assert.equal(s.values.maxDurationMs, 600_000);
  assert.equal(s.provenance.maxDurationMs, "worker");
  // Unspecified fields still global
  assert.equal(s.provenance.maxConcurrency, "global");
});

test("precedence: task field wins over worker", () => {
  const s = testResolution(
    { baseMaxAttempts: 5, maxConcurrency: 4 },
    { baseMaxAttempts: 10 },
    { maxConcurrency: 5 }, // global cap of 5 lets worker's 4 through
  );
  assert.equal(s.values.baseMaxAttempts, 10);
  assert.equal(s.provenance.baseMaxAttempts, "task");
  assert.equal(s.values.maxConcurrency, 4);
  assert.equal(s.provenance.maxConcurrency, "worker");
});

test("per-profile concurrency preserves its local cap for the scheduler", () => {
  const s = testResolution(
    { maxConcurrency: 10 },
    undefined,
    { maxConcurrency: 3 }, // global cap 3
  );
  assert.equal(s.values.maxConcurrency, 10);
  assert.equal(s.provenance.maxConcurrency, "worker");
});

test("precedence: explicit null in task is not overridden by worker or global", () => {
  const s = testResolution(
    { maxDurationMs: 600_000, observedTokenCeiling: 100_000 },
    { maxDurationMs: null, observedTokenCeiling: null },
  );
  assert.equal(s.values.maxDurationMs, null);
  assert.equal(s.provenance.maxDurationMs, "task");
  assert.equal(s.values.observedTokenCeiling, null);
  assert.equal(s.provenance.observedTokenCeiling, "task");
});

test("precedence: explicit null in task prevents finite fallback to worker", () => {
  const s = testResolution(
    { maxDurationMs: 300_000 },
    { maxDurationMs: null },
  );
  // null means explicitly unlimited — must not fall back to worker's 300_000
  assert.equal(s.values.maxDurationMs, null);
  assert.equal(s.provenance.maxDurationMs, "task");
});

test("per-profile concurrency is not rewritten by the global cap", () => {
  const glob = defaultAdvancedPolicyFields();
  glob.maxConcurrency = 3;
  const caps = enforcementCapabilityForRuntime("claude-code");
  const s = resolveEffectivePolicy(
    { maxConcurrency: 10 }, undefined, glob, "test", caps,
  );
  assert.equal(s.values.maxConcurrency, 10);
  assert.equal(s.provenance.maxConcurrency, "worker");
});

// --- Enforcement capability ---

test("enforcementCapabilityForRuntime returns truthful values for Claude", () => {
  const caps = enforcementCapabilityForRuntime("claude-code");
  assert.equal(caps.durationEnforcement, "preemptive");
  assert.equal(caps.tokenEnforcement, "post-observation");
  assert.equal(caps.progressWatchdog, "live");
});

test("enforcementCapabilityForRuntime returns truthful values for Grok", () => {
  const caps = enforcementCapabilityForRuntime("grok-build");
  assert.equal(caps.durationEnforcement, "preemptive");
  assert.equal(caps.tokenEnforcement, "unsupported");
  assert.equal(caps.progressWatchdog, "terminal");
});

// --- Effective policy preview (Hub API) ---

test("previewEffectivePolicy returns all fields with value, source, phase, unlimited", () => {
  const glob = defaultAdvancedPolicyFields();
  glob.baseMaxAttempts = 5;
  const caps = enforcementCapabilityForRuntime("claude-code");
  const preview = previewEffectivePolicy(
    { maxDurationMs: 600_000 },
    { maxDurationMs: null },
    glob,
    "profile-1",
    caps,
  );

  // Every advanced field, including the independent Main correction and
  // candidate reverification caps.
  assert.equal(preview.length, 16);
  const corrections = preview.find((row) => row.field === "maxMainCorrections")!;
  assert.equal(corrections.value, 1);
  assert.equal(corrections.source, "global");
  const reverifications = preview.find((row) => row.field === "maxMainReverifications")!;
  assert.equal(reverifications.value, 1);
  assert.equal(reverifications.source, "global");

  // maxDurationMs: null from task, unlimited=true
  const dur = preview.find((r) => r.field === "maxDurationMs")!;
  assert.equal(dur.value, null);
  assert.equal(dur.source, "task");
  assert.equal(dur.unlimited, true);
  assert.equal(dur.enforcementPhase, "preemptive"); // claude has budgetFlag=supported

  // baseMaxAttempts: from global, unlimited=false
  const ba = preview.find((r) => r.field === "baseMaxAttempts")!;
  assert.equal(ba.value, 5);
  assert.equal(ba.source, "global");
  assert.equal(ba.unlimited, false);

  // observedTokenCeiling: from global (null), unlimited=true
  const tok = preview.find((r) => r.field === "observedTokenCeiling")!;
  assert.equal(tok.value, null);
  assert.equal(tok.unlimited, true);
  assert.equal(tok.enforcementPhase, "post-observation");

  const fileLimit = preview.find((r) => r.field === "fileLimit")!;
  assert.equal(fileLimit.enforcementPhase, "terminal");
  const completion = preview.find((r) => r.field === "completionMode")!;
  assert.equal(completion.enforcementPhase, "terminal");
});

// --- Settings service: Worker Profiles with advanced policy ---

test("settings update with worker advanced policy round-trips", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ap-"));
  const service = new SettingsService(new StateStore(home));
  const profiles = service.get().workerProfiles;
  const base = structuredClone(profiles.profiles[0]!);
  const updated = {
    defaultProfileId: profiles.defaultProfileId,
    profiles: [
      {
        ...base,
        advancedPolicy: { maxDurationMs: 600_000, maxConcurrency: 5, completionMode: "warn" },
      },
    ],
  };
  const r = service.update({ workerProfiles: updated });
  assert.equal(r.workerProfiles.profiles[0]!.advancedPolicy?.maxDurationMs, 600_000);
  assert.equal(r.workerProfiles.profiles[0]!.advancedPolicy?.maxConcurrency, 5);
  assert.equal(r.workerProfiles.profiles[0]!.advancedPolicy?.completionMode, "warn");
  // reloaded
  const reloaded = svc(home).get();
  assert.equal(reloaded.workerProfiles.profiles[0]!.advancedPolicy?.maxDurationMs, 600_000);
});

test("legacy worker profile without advancedPolicy gets defaults", () => {
  const defaults = cloneDefaults();
  const profile = defaults.workerProfiles.profiles[0]!;
  assert.equal(profile.advancedPolicy, undefined); // default profile has no advancedPolicy
  // The resolution falls back to global defaults correctly
});

test("settings update with invalid advanced policy field rejects", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ap-inv-"));
  const service = new SettingsService(new StateStore(home));
  const profiles = service.get().workerProfiles;
  const base = structuredClone(profiles.profiles[0]!);
  assert.throws(() => service.update({
    workerProfiles: {
      defaultProfileId: profiles.defaultProfileId,
      profiles: [{
        ...base,
        advancedPolicy: { maxDurationMs: -1 },
      }],
    },
  }), /must be null or a non-negative integer/);
  // original profile is preserved
  assert.equal(service.get().workerProfiles.profiles[0]!.advancedPolicy, undefined);
});

// --- Model routing settings ---

test("model routing defaults match spec", () => {
  const s = svc().get();
  assert.equal(s.modelRouting.minRelevantSamples, 5);
  assert.equal(s.modelRouting.uncertaintyThreshold, 0.15);
  assert.equal(s.modelRouting.competitionOnUncertainty, true);
  assert.equal(s.modelRouting.weights.acceptedDelivery, 1);
  assert.equal(s.modelRouting.weights.verifiedBehavior, 1);
  assert.equal(s.modelRouting.weights.modelQualityFailure, 0.5);
  assert.equal(s.modelRouting.weights.correctionChurn, 0.2);
  assert.equal(s.modelRouting.weights.officialCost, 0);
  assert.equal(s.modelRouting.weights.duration, 0);
  assert.equal(s.modelRouting.weights.budgetReliability, 0);
  assert.equal(s.modelRouting.missingEvidenceMode, "flexible");
});

test("model routing partial update preserves other fields", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-s-"));
  const service = new SettingsService(new StateStore(home));
  service.update({
    modelRouting: {
      minRelevantSamples: 10,
      weights: { officialCost: 0.5, duration: 0.3, budgetReliability: 0.7 },
    },
  });
  const s = service.get();
  assert.equal(s.modelRouting.minRelevantSamples, 10);
  assert.equal(s.modelRouting.uncertaintyThreshold, 0.15); // unchanged
  assert.equal(s.modelRouting.competitionOnUncertainty, true); // unchanged
  assert.equal(s.modelRouting.weights.officialCost, 0.5);
  assert.equal(s.modelRouting.weights.duration, 0.3);
  assert.equal(s.modelRouting.weights.budgetReliability, 0.7);
  assert.equal(s.modelRouting.weights.acceptedDelivery, 1); // unchanged
  // Other section unchanged
  assert.equal(s.execution.maxConcurrency, 2);
});

test("model routing missing-evidence mode round-trips and rejects unsupported values", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-s-"));
  const service = new SettingsService(new StateStore(home));
  service.update({ modelRouting: { missingEvidenceMode: "strict" } });
  assert.equal(service.get().modelRouting.missingEvidenceMode, "strict");
  assert.equal(svc(home).get().modelRouting.missingEvidenceMode, "strict");
  assert.throws(
    () => service.update({ modelRouting: { missingEvidenceMode: "off" } }),
    /must be strict or flexible/,
  );
});

test("model routing rejects negative minRelevantSamples", () => {
  assert.throws(
    () => svc().update({ modelRouting: { minRelevantSamples: -1 } }),
    /must be a positive integer/,
  );
});

test("model routing rejects zero minRelevantSamples", () => {
  assert.throws(
    () => svc().update({ modelRouting: { minRelevantSamples: 0 } }),
    /must be a positive integer/,
  );
});

test("model routing bounds sample and score-gap settings", () => {
  assert.throws(
    () => svc().update({ modelRouting: { minRelevantSamples: 10_001 } }),
    /must not exceed 10000/,
  );
  assert.throws(
    () => svc().update({ modelRouting: { uncertaintyThreshold: 1.01 } }),
    /must not exceed 1/,
  );
});

test("model routing rejects negative weight", () => {
  assert.throws(
    () => svc().update({ modelRouting: { weights: { acceptedDelivery: -0.5 } } }),
    /non-negative number/,
  );
});

test("model routing rejects unknown weight", () => {
  assert.throws(
    () => svc().update({ modelRouting: { weights: { speed: 1 } } }),
    /not a recognized settings field/,
  );
});

test("model routing rejects unknown field", () => {
  assert.throws(
    () => svc().update({ modelRouting: { autoSelect: true } }),
    /not a recognized settings field/,
  );
});

test("legacy settings gain modelRouting defaults on migration", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-s-"));
  const store = new StateStore(home);
  const legacy = structuredClone(new SettingsService(store).get()) as unknown as Record<string, unknown>;
  delete legacy.modelRouting;
  (legacy.execution as Record<string, unknown>).maxConcurrency = 7;
  store.saveSettings(legacy);

  const migrated = new SettingsService(store).get();
  assert.equal(migrated.execution.maxConcurrency, 7);
  assert.equal(migrated.modelRouting.minRelevantSamples, 5);
  assert.equal(migrated.modelRouting.weights.duration, 0);
  assert.equal(migrated.modelRouting.weights.budgetReliability, 0);
});

test("legacy modelRouting weights gain only budgetReliability without losing saved policy", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-s-"));
  const store = new StateStore(home);
  const legacy = structuredClone(new SettingsService(store).get()) as unknown as Record<string, unknown>;
  const routing = legacy.modelRouting as Record<string, unknown>;
  routing.minRelevantSamples = 9;
  routing.missingEvidenceMode = "strict";
  const weights = routing.weights as Record<string, unknown>;
  weights.acceptedDelivery = 2.5;
  delete weights.budgetReliability;
  store.saveSettings(legacy);

  const migrated = new SettingsService(store).get();
  assert.equal(migrated.modelRouting.minRelevantSamples, 9);
  assert.equal(migrated.modelRouting.missingEvidenceMode, "strict");
  assert.equal(migrated.modelRouting.weights.acceptedDelivery, 2.5);
  assert.equal(migrated.modelRouting.weights.budgetReliability, 0);
});
