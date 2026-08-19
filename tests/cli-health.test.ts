import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { currentBuildIdentity } from "../src/core/build-identity.js";
import { projectExecutionClaudeOk, resolveExecutionRuntimeFacts } from "../src/setup/doctor.js";
import {
  buildHealthWorkerReadiness,
  describeNextAction,
  describeReason,
  humanWorkerReadinessLines,
  projectWorkerReadinessJson,
  safeProviderVerificationSnapshot,
  type RuntimeDoctorSnapshot,
} from "../src/cli/health-readiness.js";
import type { ProviderName, ProviderReadiness } from "../src/core/providers.js";
import {
  cloneDefaults,
  type ForkLightSettings,
} from "../src/core/settings.js";
import type { ProviderHealthStatus, ProbeEvidence } from "../src/core/types.js";
import { upsertModelConfig } from "../src/core/model-catalog.js";
import {
  upsertWorkerProfile,
  type WorkerProfilesSettings,
} from "../src/core/worker-profiles.js";
import { StateStore } from "../src/state/store.js";
import { resolveWorkerReadiness } from "../src/core/worker-readiness.js";

function providerEvidence(
  overrides: Partial<Record<ProviderName, Partial<ProviderReadiness>>> = {},
): Record<ProviderName, ProviderReadiness> {
  const settings = cloneDefaults();
  const names: ProviderName[] = ["deepseek", "qwen", "minimax", "glm", "volcengine", "xai"];
  return Object.fromEntries(names.map((name) => {
    const defaults = settings.providerDefaults[name];
    return [name, {
      ready: true,
      authMode: name === "xai" ? "local-sign-in" : "api-key",
      endpoint: defaults.defaultEndpoint,
      defaultModel: defaults.defaultModel,
      keychainService: defaults.defaultKeychainService,
      ...overrides[name],
    }];
  })) as Record<ProviderName, ProviderReadiness>;
}

function settingsWithProfiles(): ForkLightSettings {
  const defaults = cloneDefaults();
  let catalog = defaults.modelCatalog;
  catalog = upsertModelConfig(catalog, {
    id: "minimax-m3",
    label: "MiniMax M3",
    provider: "minimax",
    model: defaults.providerDefaults.minimax.defaultModel,
    endpoint: defaults.providerDefaults.minimax.defaultEndpoint,
  });
  catalog = upsertModelConfig(catalog, {
    id: "xai-grok",
    label: "xAI Grok",
    provider: "xai",
    model: defaults.providerDefaults.xai.defaultModel,
    endpoint: defaults.providerDefaults.xai.defaultEndpoint,
  });
  catalog = upsertModelConfig(catalog, {
    id: "deepseek-flash",
    label: "DeepSeek Flash",
    provider: "deepseek",
    model: defaults.providerDefaults.deepseek.defaultModel,
    endpoint: defaults.providerDefaults.deepseek.defaultEndpoint,
  });
  let profiles: WorkerProfilesSettings = defaults.workerProfiles;
  profiles = upsertWorkerProfile(profiles, {
    id: "minimax-builder",
    label: "MiniMax Builder",
    runtime: "claude-code",
    modelConfigId: "minimax-m3",
    provider: "minimax",
    model: defaults.providerDefaults.minimax.defaultModel,
    endpoint: defaults.providerDefaults.minimax.defaultEndpoint,
  }, catalog);
  profiles = upsertWorkerProfile(profiles, {
    id: "grok-builder",
    label: "Grok Builder",
    runtime: "grok-build",
    modelConfigId: "xai-grok",
    provider: "xai",
    model: defaults.providerDefaults.xai.defaultModel,
    endpoint: defaults.providerDefaults.xai.defaultEndpoint,
  }, catalog);
  return { ...defaults, modelCatalog: catalog, workerProfiles: profiles };
}

const ALL_RUNTIMES_READY = {
  "claude-code": { ok: true },
  "grok-build": { ok: true },
} satisfies Partial<Record<string, RuntimeDoctorSnapshot>>;

function readiness(providerStatus: Partial<Record<ProviderName, ProviderHealthStatus>> = {}) {
  const providerVerification: Partial<Record<ProviderName, { status: ProviderHealthStatus }>> = {};
  for (const [name, status] of Object.entries(providerStatus)) {
    if (status === undefined) continue;
    providerVerification[name as ProviderName] = { status };
  }
  return buildHealthWorkerReadiness({
    settings: settingsWithProfiles(),
    providers: providerEvidence(),
    runtimeDoctors: ALL_RUNTIMES_READY,
    providerVerification,
  });
}

test("canonical resolver and CLI adapter agree for every Worker Profile", () => {
  const settings = settingsWithProfiles();
  const providers = providerEvidence();
  const providerVerification = {
    deepseek: { status: "verified" as const },
    xai: { status: "stale" as const },
  };
  const canonical = resolveWorkerReadiness({
    workerProfiles: settings.workerProfiles,
    modelCatalog: settings.modelCatalog,
    providerDefaults: settings.providerDefaults,
    providers,
    runtimes: ALL_RUNTIMES_READY,
    providerVerification,
  });
  const adapter = buildHealthWorkerReadiness({
    settings,
    providers,
    runtimeDoctors: ALL_RUNTIMES_READY,
    providerVerification,
  });
  assert.deepEqual(adapter, canonical);
});

test("Grok 4.6 Xhigh health projects native-goal and legacy Grok stays single-run", () => {
  const results = readiness({ xai: "verified" });
  const grok46 = results.find((r) => r.workerId === "grok-4-6-xhigh");
  assert.ok(grok46, "expected saved Grok 4.6 Xhigh Worker");
  assert.equal(grok46!.runtime, "grok-build");
  assert.equal(grok46!.provider, "xai");
  assert.equal(grok46!.model, "grok-4.6");
  assert.equal(grok46!.executionPreference, "auto");
  assert.equal(grok46!.resolvedExecutionMode, "native-goal");
  const legacyGrok = results.find((r) => r.workerId === "grok-builder");
  assert.ok(legacyGrok);
  assert.equal(legacyGrok!.executionPreference, "single-run");
  assert.equal(legacyGrok!.resolvedExecutionMode, "single-run");
  const projected = projectWorkerReadinessJson(results);
  const json46 = projected.find((entry) => entry.workerId === "grok-4-6-xhigh");
  assert.equal(json46?.resolvedExecutionMode, "native-goal");
  const jsonLegacy = projected.find((entry) => entry.workerId === "grok-builder");
  assert.equal(jsonLegacy?.resolvedExecutionMode, "single-run");
  const human = humanWorkerReadinessLines(results);
  assert.match(human, /grok-4-6-xhigh \(Grok 4\.6 Xhigh\)/);
  assert.match(human, /execution: auto -> native-goal/);
  assert.match(human, /execution: single-run -> single-run/);
  assert.equal(describeReason("persistent-session-unsupported"),
    "the Runtime cannot prove a persistent Session for the forced mode");
});

test("saved MiniMax Worker with verified evidence is ready and can launch", () => {
  const results = readiness({ minimax: "verified", xai: "verified" });
  assert.equal(results.length, 5);
  const minimaxWorker = results.find((r) => r.workerId === "minimax-builder");
  assert.ok(minimaxWorker, "expected MiniMax Worker to exist");
  assert.equal(minimaxWorker!.state, "ready");
  assert.equal(minimaxWorker!.canLaunch, true);
  assert.equal(minimaxWorker!.reason, "ready");
  assert.equal(minimaxWorker!.nextAction, "none");
  assert.equal(minimaxWorker!.provider, "minimax");
  assert.equal(minimaxWorker!.model, "MiniMax-M3");
});

test("locally launchable Worker is not falsely blocked when connection evidence is stale", () => {
  const results = readiness({ minimax: "stale" });
  const minimaxWorker = results.find((r) => r.workerId === "minimax-builder")!;
  assert.equal(minimaxWorker.state, "launchable");
  assert.equal(minimaxWorker.canLaunch, true);
  assert.equal(minimaxWorker.reason, "connection-stale");
  assert.equal(minimaxWorker.nextAction, "run-smoke-check");
});

test("locally launchable Worker with no connection evidence is launchable, not failed", () => {
  const results = readiness();
  const minimaxWorker = results.find((r) => r.workerId === "minimax-builder")!;
  assert.equal(minimaxWorker.state, "launchable");
  assert.equal(minimaxWorker.canLaunch, true);
  assert.equal(minimaxWorker.reason, "connection-unverified");
  assert.equal(minimaxWorker.nextAction, "run-smoke-check");
});

test("failed persisted connection surfaces needs-attention without blocking local launch", () => {
  const results = readiness({ minimax: "failed" });
  const minimaxWorker = results.find((r) => r.workerId === "minimax-builder")!;
  assert.equal(minimaxWorker.state, "needs-attention");
  assert.equal(minimaxWorker.canLaunch, true);
  assert.equal(minimaxWorker.reason, "connection-failed");
  assert.equal(minimaxWorker.nextAction, "check-provider");
});

test("missing local authentication blocks before runtime or connection claims", () => {
  const results = buildHealthWorkerReadiness({
    settings: settingsWithProfiles(),
    providers: providerEvidence({
      minimax: { ready: false, authMode: "none", error: "private diagnostic" },
    }),
    runtimeDoctors: ALL_RUNTIMES_READY,
    providerVerification: { minimax: { status: "verified" } },
  });
  const minimaxWorker = results.find((r) => r.workerId === "minimax-builder")!;
  assert.equal(minimaxWorker.state, "blocked");
  assert.equal(minimaxWorker.canLaunch, false);
  assert.equal(minimaxWorker.reason, "authentication-missing");
  assert.equal(minimaxWorker.nextAction, "configure-authentication");
  const serialized = JSON.stringify(results);
  assert.equal(serialized.toLowerCase().includes("private diagnostic"), false);
});

test("unavailable runtime blocks even when authentication and evidence are present", () => {
  const results = buildHealthWorkerReadiness({
    settings: settingsWithProfiles(),
    providers: providerEvidence(),
    runtimeDoctors: {
      "claude-code": { ok: false },
      "grok-build": { ok: true },
    } satisfies Partial<Record<string, RuntimeDoctorSnapshot>>,
    providerVerification: { minimax: { status: "verified" } },
  });
  const minimaxWorker = results.find((r) => r.workerId === "minimax-builder")!;
  assert.equal(minimaxWorker.state, "blocked");
  assert.equal(minimaxWorker.canLaunch, false);
  assert.equal(minimaxWorker.reason, "runtime-unavailable");
  assert.equal(minimaxWorker.nextAction, "fix-runtime");
});

test("malformed saved model fails closed without inventing identity or fallbacks", () => {
  // Simulate an already-persisted Worker whose saved modelConfigId
  // no longer resolves to any catalog entry.  The readiness resolver
  // must fail closed and never invent a Provider/model fallback.
  const settings = settingsWithProfiles();
  settings.workerProfiles = {
    defaultProfileId: settings.workerProfiles.defaultProfileId,
    profiles: [
      ...settings.workerProfiles.profiles,
      {
        id: "broken-builder",
        label: "Broken Builder",
        runtime: "claude-code",
        modelConfigId: "missing-model-config",
      },
    ],
  };
  const results = buildHealthWorkerReadiness({
    settings,
    providers: providerEvidence(),
    runtimeDoctors: ALL_RUNTIMES_READY,
    providerVerification: {},
  });
  const broken = results.find((r) => r.workerId === "broken-builder")!;
  assert.equal(broken.state, "blocked");
  assert.equal(broken.reason, "model-invalid");
  assert.equal(broken.nextAction, "choose-model");
  assert.equal(broken.provider, undefined);
  assert.equal(broken.model, undefined);
});

test("results preserve saved Worker Profile order from the settings snapshot", () => {
  const results = readiness();
  const ids = results.map((r) => r.workerId);
  assert.deepEqual(ids, [
    "default",
    "grok-4-6-xhigh",
    "volcengine-glm52-1m",
    "minimax-builder",
    "grok-builder",
  ]);
});

test("daemon-independent composition never starts a service or probes a Provider", async () => {
  const settings = settingsWithProfiles();
  const evidence: ProbeEvidence = {
    provider: "minimax",
    model: settings.providerDefaults.minimax.defaultModel,
    endpointOrigin: new URL(settings.providerDefaults.minimax.defaultEndpoint).origin,
    status: "verified",
    latencyMs: 12,
    timestamp: new Date(Date.now() - 1000).toISOString(),
  };
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-health-"));
  const store = new StateStore(home);
  try {
    store.saveProbeEvidence(evidence);
    const snapshot = safeProviderVerificationSnapshot(
      store,
      settings,
      providerEvidence(),
      Date.now(),
    );
    assert.deepEqual(snapshot.minimax, { status: "verified" });
  } finally {
    store.close();
  }
});

test("persisted probe evidence derives stale, failed, and unverified status safely", async () => {
  const settings = settingsWithProfiles();
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-health-status-"));
  const store = new StateStore(home);
  try {
    const now = Date.now();
    const origin = new URL(settings.providerDefaults.deepseek.defaultEndpoint).origin;
    const model = settings.providerDefaults.deepseek.defaultModel;
    const stale: ProbeEvidence = {
      provider: "deepseek",
      model,
      endpointOrigin: origin,
      status: "verified",
      latencyMs: 12,
      timestamp: new Date(now - settings.probe.cacheLifetimeMs - 1000).toISOString(),
    };
    const failed: ProbeEvidence = {
      provider: "minimax",
      model: settings.providerDefaults.minimax.defaultModel,
      endpointOrigin: new URL(settings.providerDefaults.minimax.defaultEndpoint).origin,
      status: "failed",
      latencyMs: 0,
      timestamp: new Date(now - 1000).toISOString(),
      failureCategory: "authentication",
      failureSummary: "private failure detail that must not leak",
    };
    const mismatched: ProbeEvidence = {
      provider: "volcengine",
      model: "wrong-model",
      endpointOrigin: origin,
      status: "verified",
      latencyMs: 0,
      timestamp: new Date(now - 1000).toISOString(),
    };
    store.saveProbeEvidence(stale);
    store.saveProbeEvidence(failed);
    store.saveProbeEvidence(mismatched);
    const snapshot = safeProviderVerificationSnapshot(
      store,
      settings,
      providerEvidence(),
      now,
    );
    assert.equal(snapshot.deepseek?.status, "stale");
    assert.equal(snapshot.minimax?.status, "failed");
    assert.equal(snapshot.volcengine?.status, "unverified");
    assert.equal(snapshot.xai, undefined);

    const results = buildHealthWorkerReadiness({
      settings,
      providers: providerEvidence(),
      runtimeDoctors: ALL_RUNTIMES_READY,
      providerVerification: snapshot,
    });
    const serialized = JSON.stringify(results);
    assert.equal(serialized.toLowerCase().includes("private failure detail"), false);
  } finally {
    store.close();
  }
});

test("JSON and human output agree on state, launchability, reason, and next action", () => {
  const results = readiness({
    minimax: "verified",
    deepseek: "stale",
    volcengine: "failed",
  });
  const projected = projectWorkerReadinessJson(results);
  const human = humanWorkerReadinessLines(results);
  for (const entry of projected) {
    const canonical = results.find((r) => r.workerId === entry.workerId)!;
    assert.equal(entry.state, canonical.state);
    assert.equal(entry.canLaunch, canonical.canLaunch);
    assert.equal(entry.reason, canonical.reason);
    assert.equal(entry.nextAction, canonical.nextAction);
    assert.equal(entry.runtime, canonical.runtime);
    assert.match(human, new RegExp(`${entry.workerId} \\(${entry.workerLabel}\\): ${entry.state}`));
    assert.match(human, new RegExp(`reason: ${describeReason(canonical.reason)}`));
    assert.match(human, new RegExp(`next: ${describeNextAction(canonical.nextAction)}`));
  }
});

const FORBIDDEN_TOKENS = [
  "keychainService",
  "endpoint",
  "auth.json",
  "/Users/",
  "failureSummary",
  "issues",
  "command",
  "token",
  "secret",
  "checks",
  "ANTHROPIC_",
  "https://",
];

test("JSON output exposes only the bounded readiness allowlist", () => {
  const projected = projectWorkerReadinessJson(readiness({ minimax: "verified", xai: "verified" }));
  const serialized = JSON.stringify(projected);
  for (const forbidden of FORBIDDEN_TOKENS) {
    assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
  for (const entry of projected) {
    assert.ok(["ready", "launchable", "needs-attention", "blocked"].includes(entry.state));
    assert.equal(typeof entry.canLaunch, "boolean");
  }
});

test("human workers section exposes only the bounded readiness allowlist", () => {
  const lines = humanWorkerReadinessLines(readiness({ minimax: "stale", xai: "failed" }));
  for (const forbidden of FORBIDDEN_TOKENS) {
    assert.equal(lines.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
  assert.match(lines, /^workers:\n/m);
});

test("human workers section preserves saved order", () => {
  const results = readiness();
  const lines = humanWorkerReadinessLines(results);
  const orderedIds = [
    "default",
    "grok-4-6-xhigh",
    "volcengine-glm52-1m",
    "minimax-builder",
    "grok-builder",
  ];
  let cursor = 0;
  for (const id of orderedIds) {
    const index = lines.indexOf(`${id} (`);
    assert.ok(index >= 0, `expected ${id} line in output`);
    assert.ok(index >= cursor, `${id} appears out of saved order`);
    cursor = index;
  }
});

test("empty results produce an empty human section without throwing", () => {
  assert.equal(humanWorkerReadinessLines([]), "workers: (none)\n");
  assert.deepEqual(projectWorkerReadinessJson([]), []);
});

// --- xAI local-sign-in with old probe failure → unverified ---

test("safeProviderVerificationSnapshot treats old explicit-probe xAI failure as unverified when local-sign-in exists", async () => {
  const settings = settingsWithProfiles();
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-xai-"));
  const store = new StateStore(home);
  try {
    const now = Date.now();
    const failedEvidence: ProbeEvidence = {
      provider: "xai",
      model: settings.providerDefaults.xai.defaultModel,
      endpointOrigin: new URL(settings.providerDefaults.xai.defaultEndpoint).origin,
      status: "failed",
      latencyMs: 0,
      timestamp: new Date(now - 1000).toISOString(),
      failureCategory: "authentication",
      failureSummary: "xAI keychain entry missing (used with runtime grok-build)",
      source: "explicit-probe",
    };
    store.saveProbeEvidence(failedEvidence);
    const providers = providerEvidence({
      xai: { ready: true, authMode: "local-sign-in" },
    });
    const snapshot = safeProviderVerificationSnapshot(
      store,
      settings,
      providers,
      now,
    );
    // Old probe failure ignored because local-sign-in is a viable launch path
    assert.equal(snapshot.xai?.status, "unverified");
    // Privacy: failureSummary must never appear
    const serialized = JSON.stringify(snapshot);
    assert.equal(serialized.includes("keychain entry missing"), false);
  } finally {
    store.close();
  }
});

test("safeProviderVerificationSnapshot reports worker-run evidence as verified for xAI", async () => {
  const settings = settingsWithProfiles();
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-xai-wr-"));
  const store = new StateStore(home);
  try {
    const now = Date.now();
    store.saveProbeEvidence({
      provider: "xai",
      model: settings.providerDefaults.xai.defaultModel,
      endpointOrigin: new URL(settings.providerDefaults.xai.defaultEndpoint).origin,
      status: "verified",
      latencyMs: 0,
      timestamp: new Date(now - 1000).toISOString(),
      source: "worker-run",
    });
    const providers = providerEvidence({
      xai: { ready: true, authMode: "local-sign-in" },
    });
    const snapshot = safeProviderVerificationSnapshot(
      store,
      settings,
      providers,
      now,
    );
    assert.equal(snapshot.xai?.status, "verified");
  } finally {
    store.close();
  }
});

test("safeProviderVerificationSnapshot does not treat explicit-probe xAI failure as unverified when auth mode is api-key", async () => {
  // When auth mode is api-key (Keychain exists), a probe failure is real.
  const settings = settingsWithProfiles();
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-xai-key-"));
  const store = new StateStore(home);
  try {
    const now = Date.now();
    store.saveProbeEvidence({
      provider: "xai",
      model: settings.providerDefaults.xai.defaultModel,
      endpointOrigin: new URL(settings.providerDefaults.xai.defaultEndpoint).origin,
      status: "failed",
      latencyMs: 0,
      timestamp: new Date(now - 1000).toISOString(),
      failureCategory: "authentication",
      source: "explicit-probe",
    });
    const providers = providerEvidence({
      xai: { ready: true, authMode: "api-key" },
    });
    const snapshot = safeProviderVerificationSnapshot(
      store,
      settings,
      providers,
      now,
    );
    // api-key mode: probe failure IS a real connectivity failure
    assert.equal(snapshot.xai?.status, "failed");
  } finally {
    store.close();
  }
});

// ── Execution runtime authority through the CLI readiness adapter ──

function daemonRuntimeEvidence(runtimes: Record<string, unknown>): {
  ok: true;
  serverIdentity: ReturnType<typeof currentBuildIdentity>;
  result: Record<string, unknown>;
} {
  return {
    ok: true,
    serverIdentity: currentBuildIdentity(),
    result: { ok: true, runtimes },
  };
}

test("exact-build Daemon runtime facts keep saved Workers launchable despite a contradictory local PATH", () => {
  const facts = resolveExecutionRuntimeFacts({
    clientBuildIdentity: currentBuildIdentity(),
    daemonEvidence: daemonRuntimeEvidence({
      "claude-code": { ok: true, displayName: "Claude Code", executable: "claude", issues: [], capabilities: {} },
      "grok-build": { ok: true, displayName: "Grok Build", executable: "grok", issues: [], capabilities: {} },
      "codex-cli": { ok: true, displayName: "Codex CLI", executable: "codex", issues: [], capabilities: {} },
    }),
    // The caller shell PATH cannot find either runtime.
    localRuntimes: [
      { name: "claude-code", ok: false },
      { name: "grok-build", ok: false },
    ],
  });
  assert.equal(facts.source, "daemon");
  assert.equal(facts.sourceDetail, "build-matched daemon");
  assert.equal(facts.runtimes["claude-code"]?.ok, true);

  const results = buildHealthWorkerReadiness({
    settings: settingsWithProfiles(),
    providers: providerEvidence(),
    runtimeDoctors: facts.runtimes,
    providerVerification: {
      minimax: { status: "verified" },
      xai: { status: "verified" },
      volcengine: { status: "verified" },
      deepseek: { status: "verified" },
    },
  });
  const minimaxWorker = results.find((r) => r.workerId === "minimax-builder")!;
  const grokWorker = results.find((r) => r.workerId === "grok-builder")!;
  const volcengineWorker = results.find((r) => r.workerId === "volcengine-glm52-1m")!;
  assert.equal(minimaxWorker.canLaunch, true, "claude-code Worker must not be false-blocked by caller PATH");
  assert.equal(grokWorker.canLaunch, true, "grok-build Worker must not be false-blocked by caller PATH");
  assert.equal(volcengineWorker.canLaunch, true);
  assert.notEqual(minimaxWorker.reason, "runtime-unavailable");
  assert.notEqual(grokWorker.reason, "runtime-unavailable");
});

test("exact-build Daemon runtime unavailability blocks only the affected saved Worker", () => {
  const facts = resolveExecutionRuntimeFacts({
    clientBuildIdentity: currentBuildIdentity(),
    daemonEvidence: daemonRuntimeEvidence({
      "claude-code": { ok: true },
      "grok-build": { ok: false },
      "codex-cli": { ok: true },
    }),
    // Local PATH claims both are ready — the Daemon launches the work and wins.
    localRuntimes: [
      { name: "claude-code", ok: true },
      { name: "grok-build", ok: true },
    ],
  });
  assert.equal(facts.source, "daemon");
  assert.equal(facts.runtimes["grok-build"]?.ok, false);

  const results = buildHealthWorkerReadiness({
    settings: settingsWithProfiles(),
    providers: providerEvidence(),
    runtimeDoctors: facts.runtimes,
    providerVerification: {
      minimax: { status: "verified" },
      xai: { status: "verified" },
    },
  });
  const grokWorker = results.find((r) => r.workerId === "grok-builder")!;
  const minimaxWorker = results.find((r) => r.workerId === "minimax-builder")!;
  assert.equal(grokWorker.canLaunch, false);
  assert.equal(grokWorker.reason, "runtime-unavailable");
  assert.equal(grokWorker.nextAction, "fix-runtime");
  assert.equal(minimaxWorker.canLaunch, true, "the unaffected runtime stays launchable");
});

test("safe local fallback keeps the complete local runtime snapshot for Worker readiness", () => {
  const facts = resolveExecutionRuntimeFacts({
    clientBuildIdentity: currentBuildIdentity(),
    localRuntimes: [
      { name: "claude-code", ok: true },
      { name: "grok-build", ok: false },
    ],
  });
  assert.equal(facts.source, "local-fallback");
  assert.equal(facts.sourceDetail, "daemon unavailable");

  const results = buildHealthWorkerReadiness({
    settings: settingsWithProfiles(),
    providers: providerEvidence(),
    runtimeDoctors: facts.runtimes,
    providerVerification: {
      minimax: { status: "verified" },
      xai: { status: "verified" },
    },
  });
  const minimaxWorker = results.find((r) => r.workerId === "minimax-builder")!;
  const grokWorker = results.find((r) => r.workerId === "grok-builder")!;
  assert.equal(minimaxWorker.canLaunch, true);
  assert.equal(grokWorker.canLaunch, false);
  assert.equal(grokWorker.reason, "runtime-unavailable");
});

test("malformed Daemon runtime evidence falls back whole to local without mixing booleans", () => {
  const facts = resolveExecutionRuntimeFacts({
    clientBuildIdentity: currentBuildIdentity(),
    daemonEvidence: daemonRuntimeEvidence({ "claude-code": { ok: true } }),
    localRuntimes: [
      { name: "claude-code", ok: false },
      { name: "grok-build", ok: true },
    ],
  });
  assert.equal(facts.source, "local-fallback");
  assert.equal(facts.sourceDetail, "malformed daemon evidence");
  assert.equal(facts.runtimes["claude-code"]?.ok, false, "daemon claude-code ok is not mixed into the local snapshot");
  assert.equal(facts.runtimes["grok-build"]?.ok, true);
});

test("CLI health header agrees with the effective runtime authority (Daemon truth vs local fallback)", () => {
  // Caller shell PATH cannot find claude; the exact-build Daemon reports it.
  const daemonEv = {
    ok: true,
    serverIdentity: currentBuildIdentity(),
    result: {
      ok: true,
      claudeCode: "1.0.0",
      runtimes: {
        "claude-code": { ok: true },
        "grok-build": { ok: true },
        "codex-cli": { ok: true },
      },
    },
  };
  const daemonFacts = resolveExecutionRuntimeFacts({
    clientBuildIdentity: currentBuildIdentity(),
    daemonEvidence: daemonEv,
    localRuntimes: [
      { name: "claude-code", ok: false },
      { name: "grok-build", ok: false },
    ],
  });
  assert.equal(daemonFacts.source, "daemon");
  const daemonHeader = projectExecutionClaudeOk(
    daemonFacts,
    daemonEv,
    true,
    { ok: false, claudeCode: "unavailable" },
  );
  assert.deepEqual(daemonHeader, { ok: true, claudeCode: "1.0.0" });

  // No Daemon: the local caller snapshot wins as a whole.
  const localFacts = resolveExecutionRuntimeFacts({
    clientBuildIdentity: currentBuildIdentity(),
    localRuntimes: [
      { name: "claude-code", ok: true },
      { name: "grok-build", ok: false },
    ],
  });
  assert.equal(localFacts.source, "local-fallback");
  const localHeader = projectExecutionClaudeOk(
    localFacts,
    undefined,
    true,
    { ok: true, claudeCode: "3.2.1" },
  );
  assert.deepEqual(localHeader, { ok: true, claudeCode: "3.2.1" });
});
