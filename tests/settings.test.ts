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
  assert.equal(s.contractQuality.maxFiles, 12);
  assert.equal(s.contractQuality.maxDiffLines, 1200);
  assert.equal(s.contractQuality.maxFocusPaths, 8);
  assert.equal(s.contractQuality.minScenarios, 2);
  assert.equal(s.contractQuality.minCallChainSteps, 2);
  assert.equal(s.contractQuality.minOutcomeCharacters, 12);
  assert.equal(s.contractQuality.minModuleResponsibilityCharacters, 8);
  assert.equal(s.execution.maxConcurrency, 2);
  assert.equal(s.execution.noProgressTimeoutMs, 1_800_000);
  assert.equal(s.execution.defaultEffort, "high");
  assert.equal(s.execution.defaultMaxBudgetUsd, 0.5);
  assert.equal(s.execution.maximumBudgetUsd, 20);
  assert.equal(s.execution.maxAttempts, 3);
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
