/**
 * Daemon health environment snapshot cache.
 *
 * Locks docs/m3-daemon-health-snapshot-efficiency-contract.md:
 *   - Immediate health readers reuse one complete environment snapshot.
 *   - TTL expiry and Settings update/reset replace Provider-default-dependent
 *     facts exactly once on the next read.
 *   - PID, build, queue, verification, default Runtime, and max concurrency
 *     stay fresh on every response.
 *   - Authentication inspection runs once per unexpired snapshot; verification
 *     reuses that truth with fresh persisted probe evidence only.
 *   - claudeCode and claude-code runtime metadata share one doctor generation.
 *   - Caching never invents availability or exposes secrets/cache metadata.
 *
 * Deterministic time and a counting loader keep assertions free of wall-clock
 * and real Keychain/Runtime inspection.
 */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { currentBuildIdentity } from "../src/core/build-identity.js";
import type { ProviderAuthInspector, ProviderName, ProviderReadiness } from "../src/core/providers.js";
import { registerTaskFromSpec } from "../src/core/runner.js";
import {
  cloneDefaults,
  SettingsService,
  type ProviderDefaultsSettings,
} from "../src/core/settings.js";
import type { ProbeEvidence } from "../src/core/types.js";
import { DaemonCoordinator } from "../src/daemon/coordinator.js";
import {
  claudeCodeFromRuntimeDoctor,
  DEFAULT_HEALTH_ENVIRONMENT_TTL_MS,
  HealthEnvironmentCache,
  providerDefaultsIdentity,
  sealHealthEnvironmentSnapshot,
  type HealthEnvironmentSnapshot,
  type HealthRuntimeDoctorFact,
} from "../src/daemon/health-environment.js";
import { StateStore } from "../src/state/store.js";

const PROVIDER_NAMES: ProviderName[] = [
  "deepseek", "qwen", "minimax", "glm", "volcengine", "xai", "openai",
];

function fakeProviders(
  generation: number,
  ready = true,
): Record<ProviderName, ProviderReadiness> {
  const defaults = cloneDefaults().providerDefaults;
  return Object.fromEntries(PROVIDER_NAMES.map((name) => {
    const d = defaults[name];
    const readiness: ProviderReadiness = {
      ready,
      authMode: ready
        ? (name === "xai" || name === "openai" ? "local-sign-in" : "api-key")
        : "none",
      endpoint: d.defaultEndpoint,
      defaultModel: `${d.defaultModel}-g${generation}`,
      keychainService: d.defaultKeychainService,
    };
    if (!ready) readiness.error = "Local authentication not found";
    return [name, readiness];
  })) as Record<ProviderName, ProviderReadiness>;
}

function runtimeFact(
  ok: boolean,
  displayName: string,
  executable: string,
  version: string | undefined,
  issue: string,
): HealthRuntimeDoctorFact {
  const fact: HealthRuntimeDoctorFact = {
    ok,
    displayName,
    executable,
    issues: ok ? [] : [issue],
    capabilities: { budgetFlag: "supported" },
  };
  // exactOptionalPropertyTypes: omit version when absent (never assign undefined).
  if (version !== undefined) fact.version = version;
  return fact;
}

function fakeRuntimes(
  generation: number,
  ok = true,
): Record<string, HealthRuntimeDoctorFact> {
  return {
    "claude-code": runtimeFact(
      ok,
      "Claude Code",
      "claude",
      ok ? `claude-g${generation}` : undefined,
      `claude unavailable generation ${generation}`,
    ),
    "grok-build": runtimeFact(
      ok,
      "Grok Build",
      "grok",
      ok ? `grok-g${generation}` : undefined,
      `grok unavailable generation ${generation}`,
    ),
    "codex-cli": runtimeFact(
      ok,
      "Codex CLI",
      "codex",
      ok ? `codex-g${generation}` : undefined,
      `codex unavailable generation ${generation}`,
    ),
  };
}

function fakeSnapshot(
  generation: number,
  options: { ready?: boolean; runtimesOk?: boolean } = {},
): HealthEnvironmentSnapshot {
  const ready = options.ready ?? true;
  const runtimesOk = options.runtimesOk ?? ready;
  const runtimes = fakeRuntimes(generation, runtimesOk);
  // Complete generation: claudeCode is derived from the same Claude doctor fact.
  return sealHealthEnvironmentSnapshot({
    claudeCode: claudeCodeFromRuntimeDoctor(runtimes),
    anyReady: ready,
    providers: fakeProviders(generation, ready),
    runtimes,
  });
}

function countingLoader(snapshots: HealthEnvironmentSnapshot[]): {
  loadCount: () => number;
  load: (defaults: ProviderDefaultsSettings) => HealthEnvironmentSnapshot;
  loadedDefaults: () => ProviderDefaultsSettings[];
} {
  let count = 0;
  const loaded: ProviderDefaultsSettings[] = [];
  return {
    loadCount: () => count,
    loadedDefaults: () => loaded,
    load: (defaults) => {
      const snapshot = snapshots[Math.min(count, snapshots.length - 1)]!;
      count += 1;
      loaded.push(defaults);
      return snapshot;
    },
  };
}

function countingAuthInspector(ready = true): ProviderAuthInspector & {
  keychainCalls: () => number;
  signInCalls: () => number;
} {
  let keychainCalls = 0;
  let signInCalls = 0;
  return {
    hasReadableKeychainValue() {
      keychainCalls += 1;
      return ready;
    },
    hasLocalGrokSignIn() {
      signInCalls += 1;
      return ready;
    },
    keychainCalls: () => keychainCalls,
    signInCalls: () => signInCalls,
  };
}

// --- Unit: cache reuse, TTL, identity, complete snapshot, privacy ----------

test("health environment cache reuses one complete snapshot inside TTL", () => {
  let nowMs = 1_000;
  const snapshots = [fakeSnapshot(1), fakeSnapshot(2)];
  const loader = countingLoader(snapshots);
  const cache = new HealthEnvironmentCache({
    ttlMs: 1_500,
    now: () => nowMs,
    load: loader.load,
  });
  const defaults = cloneDefaults().providerDefaults;

  const first = cache.get(defaults);
  const second = cache.get(defaults);
  nowMs += 200;
  const third = cache.get(defaults);

  assert.equal(loader.loadCount(), 1);
  assert.equal(first, second);
  assert.equal(first, third);
  // One Claude doctor generation supplies both fields.
  assert.equal(first.claudeCode, "claude-g1");
  assert.equal(first.runtimes["claude-code"]?.version, "claude-g1");
  assert.equal(first.claudeCode, first.runtimes["claude-code"]?.version);
  assert.equal(first.providers.deepseek?.defaultModel.endsWith("-g1"), true);
});

test("health environment cache refreshes once after TTL expiry", () => {
  let nowMs = 1_000;
  const loader = countingLoader([fakeSnapshot(1), fakeSnapshot(2), fakeSnapshot(3)]);
  const cache = new HealthEnvironmentCache({
    ttlMs: 1_000,
    now: () => nowMs,
    load: loader.load,
  });
  const defaults = cloneDefaults().providerDefaults;

  const first = cache.get(defaults);
  nowMs += 999;
  const stillCached = cache.get(defaults);
  assert.equal(loader.loadCount(), 1);
  assert.equal(stillCached, first);

  nowMs += 1; // exactly at TTL boundary → expired
  const refreshed = cache.get(defaults);
  const reusedAfterRefresh = cache.get(defaults);

  assert.equal(loader.loadCount(), 2);
  assert.notEqual(refreshed, first);
  assert.equal(refreshed, reusedAfterRefresh);
  assert.equal(refreshed.claudeCode, "claude-g2");
  // Complete replacement: every expensive field moves together.
  assert.equal(refreshed.runtimes["claude-code"]?.version, "claude-g2");
  assert.equal(refreshed.claudeCode, refreshed.runtimes["claude-code"]?.version);
  assert.equal(refreshed.runtimes["grok-build"]?.version, "grok-g2");
  assert.equal(refreshed.providers.xai?.defaultModel.endsWith("-g2"), true);
});

test("health environment cache stamps TTL after load completion", () => {
  let nowMs = 1_000;
  const loader = countingLoader([fakeSnapshot(1), fakeSnapshot(2)]);
  const cache = new HealthEnvironmentCache({
    ttlMs: 1_000,
    now: () => nowMs,
    load: (defaults) => {
      // Slow inspection advances the clock before returning.
      nowMs += 400;
      return loader.load(defaults);
    },
  });
  const defaults = cloneDefaults().providerDefaults;

  const first = cache.get(defaults);
  // loadedAtMs is after load (1400). TTL of 1000 keeps the entry until 2400.
  assert.equal(nowMs, 1_400);
  nowMs = 2_399;
  assert.equal(cache.get(defaults), first);
  assert.equal(loader.loadCount(), 1);

  nowMs = 2_400;
  const second = cache.get(defaults);
  assert.equal(loader.loadCount(), 2);
  assert.equal(second.claudeCode, "claude-g2");
  assert.notEqual(second, first);
});

test("health environment cache rejects non-positive TTL", () => {
  assert.throws(
    () => new HealthEnvironmentCache({ ttlMs: 0 }),
    /positive finite/,
  );
  assert.throws(
    () => new HealthEnvironmentCache({ ttlMs: -1 }),
    /positive finite/,
  );
  assert.throws(
    () => new HealthEnvironmentCache({ ttlMs: Number.NaN }),
    /positive finite/,
  );
});

test("health environment cache refreshes when Provider defaults identity changes", () => {
  let nowMs = 1_000;
  const loader = countingLoader([fakeSnapshot(1), fakeSnapshot(2)]);
  const cache = new HealthEnvironmentCache({
    ttlMs: 60_000,
    now: () => nowMs,
    load: loader.load,
  });
  const firstDefaults = cloneDefaults().providerDefaults;
  const secondDefaults: ProviderDefaultsSettings = {
    ...firstDefaults,
    deepseek: {
      ...firstDefaults.deepseek,
      defaultModel: "deepseek-changed",
    },
  };

  const first = cache.get(firstDefaults);
  nowMs += 100;
  const second = cache.get(secondDefaults);

  assert.equal(loader.loadCount(), 2);
  assert.notEqual(second, first);
  assert.equal(providerDefaultsIdentity(firstDefaults) !== providerDefaultsIdentity(secondDefaults), true);
  assert.equal(loader.loadedDefaults()[1]?.deepseek.defaultModel, "deepseek-changed");
});

test("health environment cache invalidate forces one complete replacement", () => {
  let nowMs = 1_000;
  const loader = countingLoader([fakeSnapshot(1), fakeSnapshot(2)]);
  const cache = new HealthEnvironmentCache({
    ttlMs: 60_000,
    now: () => nowMs,
    load: loader.load,
  });
  const defaults = cloneDefaults().providerDefaults;

  const first = cache.get(defaults);
  cache.invalidate();
  const second = cache.get(defaults);

  assert.equal(loader.loadCount(), 2);
  assert.notEqual(second, first);
  assert.equal(second.claudeCode, "claude-g2");
});

test("cached negative environment facts remain negative", () => {
  let nowMs = 1_000;
  const negative = fakeSnapshot(1, { ready: false, runtimesOk: false });
  const loader = countingLoader([negative, fakeSnapshot(2)]);
  const cache = new HealthEnvironmentCache({
    ttlMs: 60_000,
    now: () => nowMs,
    load: loader.load,
  });
  const defaults = cloneDefaults().providerDefaults;

  const first = cache.get(defaults);
  const second = cache.get(defaults);

  assert.equal(loader.loadCount(), 1);
  assert.equal(first, second);
  assert.equal(first.claudeCode, "unavailable");
  assert.equal(first.anyReady, false);
  assert.equal(first.providers.deepseek?.ready, false);
  assert.equal(first.runtimes["claude-code"]?.ok, false);
  assert.equal("version" in (first.runtimes["claude-code"] ?? {}), false);
  assert.ok((first.runtimes["claude-code"]?.issues.length ?? 0) > 0);
});

test("environment snapshot seals nested facts against mutation poisoning", () => {
  let nowMs = 1_000;
  const loader = countingLoader([fakeSnapshot(1)]);
  const cache = new HealthEnvironmentCache({
    ttlMs: 60_000,
    now: () => nowMs,
    load: loader.load,
  });
  const defaults = cloneDefaults().providerDefaults;
  const first = cache.get(defaults);

  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.providers), true);
  assert.equal(Object.isFrozen(first.runtimes), true);
  assert.equal(Object.isFrozen(first.providers.deepseek), true);
  assert.equal(Object.isFrozen(first.runtimes["claude-code"]), true);
  assert.equal(Object.isFrozen(first.runtimes["claude-code"]?.issues), true);
  assert.equal(Object.isFrozen(first.runtimes["claude-code"]?.capabilities), true);

  assert.throws(() => {
    (first.runtimes as Record<string, HealthRuntimeDoctorFact>)["claude-code"] = {
      ok: true,
      displayName: "poison",
      executable: "poison",
      issues: [],
      capabilities: {},
    };
  });
  assert.throws(() => {
    (first.providers.deepseek as { ready: boolean }).ready = false;
  });
  assert.throws(() => {
    (first.runtimes["claude-code"]?.issues as string[]).push("poison");
  });
  assert.throws(() => {
    (first.runtimes["claude-code"]?.capabilities as Record<string, string>).budgetFlag =
      "unsupported";
  });

  const second = cache.get(defaults);
  assert.equal(second.claudeCode, "claude-g1");
  assert.equal(second.runtimes["claude-code"]?.ok, true);
  assert.deepEqual(second.runtimes["claude-code"]?.issues, []);
  assert.equal(
    (second.runtimes["claude-code"]?.capabilities as Record<string, string>).budgetFlag,
    "supported",
  );
  assert.equal(second.providers.deepseek?.ready, true);
  assert.equal(loader.loadCount(), 1);
});

test("environment snapshot and public health projection omit cache metadata and secrets", () => {
  const snapshot = fakeSnapshot(1);
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes("loadedAtMs"), false);
  assert.equal(serialized.includes("defaultsIdentity"), false);
  assert.equal(serialized.includes("ttlMs"), false);
  assert.equal(serialized.includes("password"), false);
  assert.equal(serialized.includes("apiKey"), false);
  assert.equal(serialized.includes("ANTHROPIC_AUTH_TOKEN"), false);
  assert.equal(serialized.includes("sk-"), false);

  // Bounded readiness fields only — never credential material.
  assert.equal(typeof snapshot.claudeCode, "string");
  assert.equal(typeof snapshot.anyReady, "boolean");
  for (const name of PROVIDER_NAMES) {
    const p = snapshot.providers[name];
    assert.equal(typeof p.ready, "boolean");
    assert.equal(typeof p.endpoint, "string");
    assert.equal(typeof p.defaultModel, "string");
    assert.equal(typeof p.keychainService, "string");
    assert.equal("secret" in p, false);
    assert.equal("token" in p, false);
    assert.equal("value" in p, false);
  }

  // Cache entry metadata is not part of the public snapshot object.
  assert.equal("loadedAtMs" in snapshot, false);
  assert.equal("defaultsIdentity" in snapshot, false);
  assert.equal(Object.isFrozen(snapshot), true);
});

test("default health environment TTL is a positive finite bound", () => {
  assert.equal(Number.isFinite(DEFAULT_HEALTH_ENVIRONMENT_TTL_MS), true);
  assert.ok(DEFAULT_HEALTH_ENVIRONMENT_TTL_MS > 0);
  assert.ok(DEFAULT_HEALTH_ENVIRONMENT_TTL_MS <= 60_000);
  const cache = new HealthEnvironmentCache();
  assert.equal(cache.getTtlMs(), DEFAULT_HEALTH_ENVIRONMENT_TTL_MS);
});

test("claudeCodeFromRuntimeDoctor uses only the Claude doctor version", () => {
  assert.equal(
    claudeCodeFromRuntimeDoctor({
      "claude-code": runtimeFact(true, "Claude Code", "claude", "1.2.3", ""),
      "grok-build": runtimeFact(true, "Grok Build", "grok", "grok-9", ""),
    }),
    "1.2.3",
  );
  assert.equal(
    claudeCodeFromRuntimeDoctor({
      "claude-code": runtimeFact(false, "Claude Code", "claude", undefined, "missing"),
    }),
    "unavailable",
  );
});

// --- Integration: DaemonCoordinator health projection ----------------------

test("coordinator health reuses environment snapshot across immediate readers", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-health-env-reuse-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  let nowMs = 5_000;
  const loader = countingLoader([fakeSnapshot(1), fakeSnapshot(2)]);
  const cache = new HealthEnvironmentCache({
    ttlMs: 10_000,
    now: () => nowMs,
    load: loader.load,
  });
  const coordinator = new DaemonCoordinator(
    store,
    settings,
    0,
    { hasReadableKeychainValue: () => true, hasLocalGrokSignIn: () => true },
    cache,
  );

  try {
    const a = coordinator.health();
    const b = coordinator.health();
    nowMs += 50;
    const c = coordinator.health();

    assert.equal(loader.loadCount(), 1);
    assert.equal(a.claudeCode, "claude-g1");
    assert.equal(b.claudeCode, "claude-g1");
    assert.equal(c.claudeCode, "claude-g1");
    assert.equal(
      a.claudeCode,
      (a.runtimes as Record<string, HealthRuntimeDoctorFact>)["claude-code"]?.version,
    );
    assert.deepEqual(a.runtimes, b.runtimes);
    assert.deepEqual(a.providers, c.providers);
    // Public field set remains compatible.
    for (const key of [
      "ok", "pid", "claudeCode", "runtimes", "defaultRuntime", "providers",
      "providerVerification", "maxConcurrency", "activeTaskIds", "queuedTaskIds",
      "databasePath", "buildIdentity",
    ]) {
      assert.ok(key in a, `missing health field ${key}`);
    }
    // Cache metadata stays private.
    assert.equal("loadedAtMs" in a, false);
    assert.equal("defaultsIdentity" in a, false);
    assert.equal("ttlMs" in a, false);
    assert.equal(a.pid, process.pid);
    assert.deepEqual(a.buildIdentity, currentBuildIdentity());
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("coordinator health reuses cached auth for verification without a second Keychain inspection", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-health-env-auth-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  let authCalls = 0;
  const loader = countingLoader([fakeSnapshot(1)]);
  const cache = new HealthEnvironmentCache({
    ttlMs: 60_000,
    now: () => 1_000,
    load: (defaults) => {
      // Simulate the real loader's single authentication pass.
      authCalls += 1;
      return loader.load(defaults);
    },
  });
  // Inspector must not be consulted by verification after the snapshot exists.
  const inspector = countingAuthInspector(true);
  const coordinator = new DaemonCoordinator(store, settings, 0, inspector, cache);

  try {
    const first = coordinator.health();
    assert.equal(loader.loadCount(), 1);
    assert.equal(authCalls, 1);
    // Injected inspector is unused while the cache supplies the snapshot.
    assert.equal(inspector.keychainCalls(), 0);
    assert.equal(inspector.signInCalls(), 0);

    const verification = first.providerVerification as Record<string, {
      status: string;
      provider: string;
      model: string;
    }>;
    assert.equal(verification.deepseek?.status, "unverified");
    assert.equal("keychainExists" in (verification.deepseek ?? {}), false);

    // Persist probe evidence between health reads; verification must refresh
    // from store evidence while authentication inspection stays at one.
    const defaults = settings.get().providerDefaults.deepseek;
    const evidence: ProbeEvidence = {
      provider: "deepseek",
      model: defaults.defaultModel,
      endpointOrigin: new URL(defaults.defaultEndpoint).origin,
      status: "verified",
      latencyMs: 12,
      timestamp: new Date().toISOString(),
      source: "explicit-probe",
    };
    store.saveProbeEvidence(evidence);

    const second = coordinator.health();
    assert.equal(loader.loadCount(), 1);
    assert.equal(authCalls, 1);
    assert.equal(inspector.keychainCalls(), 0);
    const verification2 = second.providerVerification as Record<string, {
      status: string;
      evidence?: ProbeEvidence;
    }>;
    assert.equal(verification2.deepseek?.status, "verified");
    assert.equal(verification2.deepseek?.evidence?.status, "verified");
    // Nested runtime facts stay sealed across health projections.
    assert.throws(() => {
      (second.runtimes as Record<string, HealthRuntimeDoctorFact>)["claude-code"] = {
        ok: false,
        displayName: "poison",
        executable: "x",
        issues: ["poison"],
        capabilities: {},
      };
    });
    assert.equal(
      (coordinator.health().runtimes as Record<string, HealthRuntimeDoctorFact>)["claude-code"]?.ok,
      true,
    );
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("coordinator health keeps queue and operational settings fresh without re-inspection", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-health-env-dynamic-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  let nowMs = 1_000;
  const loader = countingLoader([fakeSnapshot(1), fakeSnapshot(2)]);
  const cache = new HealthEnvironmentCache({
    ttlMs: 60_000,
    now: () => nowMs,
    load: loader.load,
  });
  // Override 0 parks queued work so health can observe the queue without launching.
  const coordinator = new DaemonCoordinator(
    store,
    settings,
    0,
    { hasReadableKeychainValue: () => true, hasLocalGrokSignIn: () => true },
    cache,
  );

  try {
    const before = coordinator.health();
    assert.equal(before.maxConcurrency, 0);
    assert.deepEqual(before.queuedTaskIds, []);
    assert.equal(before.defaultRuntime, "claude-code");
    assert.equal(before.claudeCode, "claude-g1");

    // Live Settings maxConcurrency (no override) is covered below via a second
    // coordinator; here operational defaultRuntime must stay fresh without
    // re-inspecting the environment. xai + grok-build is a legal pair.
    coordinator.updateSettings({
      execution: {
        defaultProvider: "xai",
        defaultRuntime: "grok-build",
      },
    });
    const afterSettings = coordinator.health();
    assert.equal(loader.loadCount(), 1);
    assert.equal(afterSettings.defaultRuntime, "grok-build");
    assert.equal(afterSettings.claudeCode, "claude-g1");
    assert.deepEqual(afterSettings.runtimes, before.runtimes);
    assert.deepEqual(afterSettings.providers, before.providers);

    // Queue membership is projected fresh from in-memory coordinator state.
    const task = registerTaskFromSpec(
      store,
      {
        version: 1,
        name: "dynamic-queue-probe",
        project: home,
        goal: "Prove queuedTaskIds stay live under environment reuse",
        constraints: [],
        provider: {
          name: "deepseek",
          model: "deepseek-v4-flash",
          keychainService: "forklight.test.api-key",
        },
        runtime: {
          name: "claude-code",
          executable: "claude",
          effort: "low",
          maxBudgetUsd: 0.1,
        },
        workspace: { exclude: [] },
        worker: { allowEdits: false, allowedCommands: [], focusPaths: ["src"] },
        acceptance: { commands: ["true"] },
      },
      "forklight://test/dynamic-queue-probe",
    );
    coordinator.queueTask(task.id);
    const afterQueue = coordinator.health();
    assert.equal(loader.loadCount(), 1);
    assert.deepEqual(afterQueue.queuedTaskIds, [task.id]);
    assert.equal(afterQueue.claudeCode, "claude-g1");
    assert.equal(afterQueue.defaultRuntime, "grok-build");
    assert.equal(afterQueue.pid, process.pid);
    assert.deepEqual(afterQueue.buildIdentity, currentBuildIdentity());
  } finally {
    await coordinator.shutdown();
    store.close();
  }

  // Separate coordinator without concurrency override: maxConcurrency tracks
  // live Settings while the environment snapshot remains reused.
  const store2 = new StateStore(home);
  const settings2 = new SettingsService(store2);
  const loader2 = countingLoader([fakeSnapshot(10), fakeSnapshot(11)]);
  const cache2 = new HealthEnvironmentCache({
    ttlMs: 60_000,
    now: () => 1_000,
    load: loader2.load,
  });
  const liveConcurrency = new DaemonCoordinator(
    store2,
    settings2,
    undefined,
    { hasReadableKeychainValue: () => true, hasLocalGrokSignIn: () => true },
    cache2,
  );
  try {
    assert.equal(liveConcurrency.health().maxConcurrency, 2);
    liveConcurrency.updateSettings({ execution: { maxConcurrency: 5 } });
    const after = liveConcurrency.health();
    assert.equal(loader2.loadCount(), 1);
    assert.equal(after.maxConcurrency, 5);
    assert.equal(after.claudeCode, "claude-g10");
  } finally {
    await liveConcurrency.shutdown();
    store2.close();
  }
});

test("coordinator invalidates environment snapshot after Provider defaults update and reset", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-health-env-invalidate-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  let nowMs = 1_000;
  const loader = countingLoader([
    fakeSnapshot(1),
    fakeSnapshot(2),
    fakeSnapshot(3),
  ]);
  const cache = new HealthEnvironmentCache({
    ttlMs: 60_000,
    now: () => nowMs,
    load: loader.load,
  });
  const coordinator = new DaemonCoordinator(
    store,
    settings,
    0,
    { hasReadableKeychainValue: () => true, hasLocalGrokSignIn: () => true },
    cache,
  );

  try {
    const first = coordinator.health();
    assert.equal(loader.loadCount(), 1);
    assert.equal(first.claudeCode, "claude-g1");

    coordinator.updateSettings({
      providerDefaults: { deepseek: { defaultModel: "deepseek-v4-pro" } },
    });
    const afterUpdate = coordinator.health();
    assert.equal(loader.loadCount(), 2);
    assert.equal(afterUpdate.claudeCode, "claude-g2");
    // Loader received the updated defaults identity.
    assert.equal(
      loader.loadedDefaults()[1]?.deepseek.defaultModel,
      "deepseek-v4-pro",
    );

    // Same defaults inside TTL → reuse the post-update snapshot.
    nowMs += 100;
    const reused = coordinator.health();
    assert.equal(loader.loadCount(), 2);
    assert.equal(reused.claudeCode, "claude-g2");

    coordinator.resetSettings();
    const afterReset = coordinator.health();
    assert.equal(loader.loadCount(), 3);
    assert.equal(afterReset.claudeCode, "claude-g3");
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("coordinator health TTL expiry replaces the complete environment snapshot once", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-health-env-ttl-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  let nowMs = 1_000;
  const loader = countingLoader([fakeSnapshot(1), fakeSnapshot(2)]);
  const cache = new HealthEnvironmentCache({
    ttlMs: 500,
    now: () => nowMs,
    load: loader.load,
  });
  const coordinator = new DaemonCoordinator(
    store,
    settings,
    0,
    { hasReadableKeychainValue: () => true, hasLocalGrokSignIn: () => true },
    cache,
  );

  try {
    const first = coordinator.health();
    nowMs += 499;
    assert.equal(coordinator.health().claudeCode, "claude-g1");
    assert.equal(loader.loadCount(), 1);

    nowMs += 1;
    const second = coordinator.health();
    assert.equal(loader.loadCount(), 2);
    assert.equal(second.claudeCode, "claude-g2");
    assert.equal(
      (second.runtimes as Record<string, HealthRuntimeDoctorFact>)["claude-code"]?.version,
      "claude-g2",
    );
    assert.equal(
      second.claudeCode,
      (second.runtimes as Record<string, HealthRuntimeDoctorFact>)["claude-code"]?.version,
    );
    // Dynamic fields still present and fresh after refresh.
    assert.equal(second.pid, process.pid);
    assert.deepEqual(second.activeTaskIds, []);
    assert.deepEqual(second.queuedTaskIds, []);
    assert.notEqual(first.claudeCode, second.claudeCode);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("coordinator health never invents Runtime availability from a negative snapshot", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-health-env-negative-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const loader = countingLoader([fakeSnapshot(1, { ready: false, runtimesOk: false })]);
  const cache = new HealthEnvironmentCache({
    ttlMs: 60_000,
    now: () => 1_000,
    load: loader.load,
  });
  const coordinator = new DaemonCoordinator(
    store,
    settings,
    0,
    { hasReadableKeychainValue: () => false, hasLocalGrokSignIn: () => false },
    cache,
  );

  try {
    const health = coordinator.health();
    assert.equal(health.ok, false);
    assert.equal(health.claudeCode, "unavailable");
    const runtimes = health.runtimes as Record<string, HealthRuntimeDoctorFact>;
    assert.equal(runtimes["claude-code"]?.ok, false);
    assert.equal(runtimes["grok-build"]?.ok, false);
    assert.equal(health.claudeCode, claudeCodeFromRuntimeDoctor(runtimes));
    const providers = health.providers as Record<ProviderName, ProviderReadiness>;
    assert.equal(providers.deepseek?.ready, false);
    assert.equal(loader.loadCount(), 1);
    // Second read still negative — no invention of readiness.
    assert.equal(coordinator.health().ok, false);
    assert.equal(loader.loadCount(), 1);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});
