import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { ProbeFailureCategory } from "../src/core/types.js";
import { SettingsService } from "../src/core/settings.js";
import { StateStore } from "../src/state/store.js";
import {
  createClaudeProbeRunner,
  providerProbeBatchFailed,
  ProviderProbeService,
  type ProbeRunner,
  type KeychainChecker,
  type KeychainReader,
  type Clock,
} from "../src/core/provider-probe.js";
import { resolveProvider, type ProviderName } from "../src/core/providers.js";

// --- Test helpers ---

function makeStore(): StateStore {
  return new StateStore(
    path.join(tmpdir(), `fl-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`),
  );
}

function makeSettings(store: StateStore): SettingsService {
  return new SettingsService(store);
}

function stubRunner(
  results: Record<string, { ok: boolean; category?: ProbeFailureCategory; summary?: string; latencyMs: number }>,
): ProbeRunner {
  return async (_config, _apiKey, _policy) => {
    const name = _config.name;
    const r = results[name] ?? { ok: true, latencyMs: 42 };
    return r;
  };
}

function stubKeychain(present: Set<string>): KeychainChecker {
  return (service: string) => present.has(service);
}

function stubClock(ms: number): Clock {
  return () => ms;
}

function stubKeychainReader(): KeychainReader {
  return (_service: string) => "test-probe-key";
}

function mkSvc(
  store: StateStore = makeStore(),
  settings: SettingsService = makeSettings(store),
  runner: ProbeRunner = stubRunner({}),
  keychain: KeychainChecker = stubKeychain(new Set()),
  reader: KeychainReader = stubKeychainReader(),
  clock: Clock = stubClock(0),
): ProviderProbeService {
  return new ProviderProbeService(store, settings, runner, keychain, reader, clock);
}

const ALL_PROVIDERS: ProviderName[] = ["deepseek", "qwen", "minimax", "glm", "xai"];

// --- Probe policy ---

test("probe policy returns frozen snapshot from settings defaults", () => {
  const policy = mkSvc().probePolicy();
  assert.equal(policy.probeTimeoutMs, 30_000);
  assert.equal(policy.maxBudgetUsd, 0.05);
  assert.equal(policy.cacheLifetimeMs, 300_000);
  assert.equal(policy.maxProbeConcurrency, 2);
  assert.ok(Object.isFrozen(policy));
});

test("probe policy reflects updated settings", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-pp-"));
  const store = new StateStore(home);
  const svc = makeSettings(store);
  svc.update({ probe: { probeTimeoutMs: 15_000, maxBudgetUsd: 0.1 } });
  const service = mkSvc(store, svc);
  assert.equal(service.probePolicy().probeTimeoutMs, 15_000);
  assert.equal(service.probePolicy().maxBudgetUsd, 0.1);
  assert.equal(service.probePolicy().cacheLifetimeMs, 300_000);
});

// --- Probe success ---

test("probe success persists safe evidence and reports verified", async () => {
  const store = makeStore();
  const svc = makeSettings(store);
  const clock = stubClock(1700000000000);
  const reader = stubKeychainReader();
  const service = new ProviderProbeService(
    store, svc,
    stubRunner({ deepseek: { ok: true, latencyMs: 123 } }),
    stubKeychain(new Set(["forklight.deepseek.api-key"])),
    reader, clock,
  );

  const evidence = await service.probeProvider("deepseek");

  assert.equal(evidence.provider, "deepseek");
  assert.equal(evidence.model, "deepseek-v4-flash");
  assert.equal(evidence.endpointOrigin, "https://api.deepseek.com");
  assert.equal(evidence.status, "verified");
  assert.equal(evidence.latencyMs, 123);
  assert.equal(evidence.timestamp, "2023-11-14T22:13:20.000Z");
  assert.equal(evidence.failureCategory, undefined);

  // Evidence must not contain credential or raw output keys
  const rawKeys = Object.keys(JSON.parse(JSON.stringify(evidence)) as Record<string, unknown>);
  for (const key of rawKeys) {
    assert.ok(!key.toLowerCase().includes("key"), `Evidence key "${key}" looks credential-like`);
    assert.ok(!key.toLowerCase().includes("secret"), `Evidence key "${key}" looks credential-like`);
    assert.ok(!key.toLowerCase().includes("token"), `Evidence key "${key}" looks credential-like`);
    assert.ok(!key.toLowerCase().includes("password"), `Evidence key "${key}" looks credential-like`);
  }

  // Durable: store confirms persistence
  const reloaded = store.getProbeEvidence("deepseek");
  assert.ok(reloaded !== undefined);
  assert.equal(reloaded!.status, "verified");

  // Read model
  const status = service.getProviderStatus("deepseek");
  assert.equal(status.status, "verified");
  assert.equal(status.keychainExists, true);
});

// --- Transient key reaches only runner, never evidence or store ---

test("transient key reaches only runner, never persisted", async () => {
  const store = makeStore();
  const svc = makeSettings(store);
  let capturedKey: string | undefined;

  const capturingRunner: ProbeRunner = async (_config, apiKey, _policy) => {
    capturedKey = apiKey;
    return { ok: true, latencyMs: 5 };
  };

  const service = new ProviderProbeService(
    store, svc, capturingRunner,
    stubKeychain(new Set(["forklight.deepseek.api-key"])),
    () => "secret-api-key-12345", // stub reader returns a known key
    stubClock(0),
  );

  await service.probeProvider("deepseek");

  // Runner received the key
  assert.equal(capturedKey, "secret-api-key-12345");

  // Evidence in store does not contain the key
  const stored = store.getProbeEvidence("deepseek");
  assert.ok(stored !== undefined);
  const storedJson = JSON.stringify(stored);
  assert.ok(!storedJson.includes("secret-api-key-12345"), "credential must not appear in stored evidence");
  assert.ok(!storedJson.includes("12345"), "credential must not appear in stored evidence");

  // ProviderStatus evidence field also does not contain the key
  const status = service.getProviderStatus("deepseek");
  const statusJson = JSON.stringify(status.evidence);
  assert.ok(!statusJson.includes("secret-api-key-12345"), "credential must not appear in status");
});

test("failure categories persist without raw provider output", async () => {
  for (const category of ["authentication", "timeout", "connectivity", "unknown"] as const) {
    const store = makeStore();
    const service = new ProviderProbeService(
      store, makeSettings(store),
      stubRunner({ deepseek: { ok: false, category, summary: "Safe bounded evidence", latencyMs: 7 } }),
      stubKeychain(new Set(["forklight.deepseek.api-key"])),
      stubKeychainReader(), stubClock(0),
    );
    const evidence = await service.probeProvider("deepseek");
    assert.equal(evidence.failureCategory, category);
    assert.equal(evidence.failureSummary, "Safe bounded evidence");
    assert.equal(store.getProbeEvidence("deepseek")?.failureSummary, "Safe bounded evidence");
    assert.equal(service.getProviderStatus("deepseek").status, "failed");
  }
});

test("Claude probe runner uses only injected async execution", async () => {
  const defaults = new SettingsService(makeStore()).get();
  const config = resolveProvider("deepseek", {}, defaults.providerDefaults.deepseek);
  let observedToken = "";
  const runner = createClaudeProbeRunner(async (command, args, options) => {
    assert.equal(command, "claude");
    assert.ok(args.includes("--strict-mcp-config"));
    assert.equal(args[args.indexOf("--print") + 1], "Say OK.");
    observedToken = options.env.ANTHROPIC_AUTH_TOKEN ?? "";
    assert.equal(options.env.ANTHROPIC_API_KEY, undefined);
    return { stdout: '{"type":"result","is_error":false}\n', stderr: "" };
  });
  const result = await runner(config, "transient-key", {
    probeTimeoutMs: 1000, maxBudgetUsd: 0.01, cacheLifetimeMs: 1000, maxProbeConcurrency: 1,
  });
  assert.equal(result.ok, true);
  assert.equal(observedToken, "transient-key");
});

test("Claude probe runner classifies authentication failures emitted on stdout", async () => {
  const defaults = new SettingsService(makeStore()).get();
  const config = resolveProvider("minimax", {}, defaults.providerDefaults.minimax);
  const runner = createClaudeProbeRunner(async () => {
    const error = new Error("Command failed") as Error & { stdout: string; stderr: string };
    error.stdout = [
      JSON.stringify({
        type: "result",
        is_error: true,
        result: "Failed to authenticate. API Error: 401 invalid api key",
      }),
      "",
    ].join("\n");
    error.stderr = "";
    throw error;
  });
  const result = await runner(config, "transient-key", {
    probeTimeoutMs: 1000,
    maxBudgetUsd: 0.01,
    cacheLifetimeMs: 1000,
    maxProbeConcurrency: 1,
  });
  assert.deepEqual(
    { ok: result.ok, category: result.category },
    { ok: false, category: "authentication" },
  );

  const nestedRunner = createClaudeProbeRunner(async () => ({
    stdout: [
      JSON.stringify({
        type: "result",
        is_error: true,
        result: { message: "API Error", status: 401 },
      }),
      "",
    ].join("\n"),
    stderr: "",
  }));
  const nested = await nestedRunner(config, "transient-key", {
    probeTimeoutMs: 1000,
    maxBudgetUsd: 0.01,
    cacheLifetimeMs: 1000,
    maxProbeConcurrency: 1,
  });
  assert.deepEqual(
    { ok: nested.ok, category: nested.category },
    { ok: false, category: "authentication" },
  );
});

test("Claude probe runner isolates provider settings and cleans configuration", async () => {
  const defaults = new SettingsService(makeStore()).get();
  const config = resolveProvider("minimax", {}, defaults.providerDefaults.minimax);
  let isolatedDir = "";
  const runner = createClaudeProbeRunner(async (_command, args, options) => {
    isolatedDir = options.env.CLAUDE_CONFIG_DIR ?? "";
    assert.equal(options.cwd, isolatedDir);
    assert.notEqual(isolatedDir, "/global/deepseek-config");
    assert.equal(options.env.ANTHROPIC_BASE_URL, config.endpoint);
    assert.equal(options.env.ANTHROPIC_MODEL, config.model);
    assert.equal(args[args.indexOf("--model") + 1], config.model);
    await access(isolatedDir);
    return { stdout: '{"type":"result","is_error":false}\n', stderr: "" };
  });
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = "/global/deepseek-config";
  try {
    assert.equal((await runner(config, "transient-key", {
      probeTimeoutMs: 1000, maxBudgetUsd: 0.01, cacheLifetimeMs: 1000, maxProbeConcurrency: 1,
    })).ok, true);
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
  }
  await assert.rejects(access(isolatedDir));
});

test("provider probe batch classification is deterministic", () => {
  assert.equal(providerProbeBatchFailed({ minimax: { status: "verified" } }), false);
  assert.equal(providerProbeBatchFailed({ minimax: { status: "failed" } }), true);
  assert.equal(providerProbeBatchFailed({ minimax: { error: "probe failed" } }), true);
  assert.equal(providerProbeBatchFailed({ minimax: null }), true);
});

test("Claude probe runner redacts and bounds failure evidence while cleaning after throws", async () => {
  const config = resolveProvider("minimax");
  let isolatedDir = "";
  const runner = createClaudeProbeRunner(async (_command, _args, options) => {
    isolatedDir = options.env.CLAUDE_CONFIG_DIR ?? "";
    throw new Error(`401 invalid api key transient-secret ${"x".repeat(500)}`);
  });
  const result = await runner(config, "transient-secret", {
    probeTimeoutMs: 1000, maxBudgetUsd: 0.01, cacheLifetimeMs: 1000, maxProbeConcurrency: 1,
  });
  assert.equal(result.category, "authentication");
  assert.ok(result.summary !== undefined && result.summary.length <= 240);
  assert.ok(!result.summary.includes("transient-secret"));
  await assert.rejects(access(isolatedDir));
});

// --- Staleness ---

test("stale success reported after cache lifetime expires", async () => {
  const store = makeStore();
  const svc = makeSettings(store);
  const probeTime = 1700000000000;
  const service = new ProviderProbeService(
    store, svc,
    stubRunner({ deepseek: { ok: true, latencyMs: 5 } }),
    stubKeychain(new Set(["forklight.deepseek.api-key"])),
    stubKeychainReader(), stubClock(probeTime),
  );

  await service.probeProvider("deepseek");
  assert.equal(service.getProviderStatus("deepseek").status, "verified");

  const staleService = new ProviderProbeService(
    store, svc,
    stubRunner({}),
    stubKeychain(new Set(["forklight.deepseek.api-key"])),
    stubKeychainReader(), stubClock(probeTime + 300_001),
  );
  assert.equal(staleService.getProviderStatus("deepseek").status, "stale");
});

// --- Changed defaults invalidate evidence ---

test("changed model defaults make previously verified provider unverified", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-cd-"));
  const store = new StateStore(home);
  const svc = makeSettings(store);
  const probeTime = 1700000000000;

  const probeSvc = new ProviderProbeService(
    store, svc,
    stubRunner({ deepseek: { ok: true, latencyMs: 10 } }),
    stubKeychain(new Set(["forklight.deepseek.api-key"])),
    stubKeychainReader(), stubClock(probeTime),
  );

  await probeSvc.probeProvider("deepseek");
  assert.equal(probeSvc.getProviderStatus("deepseek").status, "verified");

  svc.update({ providerDefaults: { deepseek: { defaultModel: "deepseek-v4-pro" } } });
  const afterSvc = new SettingsService(store);

  const checkSvc = new ProviderProbeService(
    store, afterSvc,
    stubRunner({}),
    stubKeychain(new Set(["forklight.deepseek.api-key"])),
    stubKeychainReader(), stubClock(probeTime),
  );
  assert.equal(checkSvc.getProviderStatus("deepseek").status, "unverified");
});

test("changed endpoint origin makes previously verified provider unverified", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ce-"));
  const store = new StateStore(home);
  const svc = makeSettings(store);
  const probeTime = 1700000000000;

  const probeSvc = new ProviderProbeService(
    store, svc,
    stubRunner({ deepseek: { ok: true, latencyMs: 10 } }),
    stubKeychain(new Set(["forklight.deepseek.api-key"])),
    stubKeychainReader(), stubClock(probeTime),
  );
  await probeSvc.probeProvider("deepseek");
  assert.equal(probeSvc.getProviderStatus("deepseek").status, "verified");

  // Change origin, not just path
  svc.update({ providerDefaults: { deepseek: { defaultEndpoint: "https://other-api.example.com/anthropic" } } });
  const afterSvc = new SettingsService(store);

  const checkSvc = new ProviderProbeService(
    store, afterSvc,
    stubRunner({}),
    stubKeychain(new Set(["forklight.deepseek.api-key"])),
    stubKeychainReader(), stubClock(probeTime),
  );
  assert.equal(checkSvc.getProviderStatus("deepseek").status, "unverified");
});

// --- Missing keychain ---

test("provider without keychain entry is unverified", () => {
  const service = mkSvc();
  const status = service.getProviderStatus("qwen");
  assert.equal(status.keychainExists, false);
  assert.equal(status.status, "unverified");
  assert.equal(status.evidence, undefined);
});

// --- Unprobed but keychain exists ---

test("provider with keychain but no probe evidence is unverified", () => {
  const service = mkSvc(undefined, undefined, undefined, stubKeychain(new Set(["forklight.deepseek.api-key"])));
  const status = service.getProviderStatus("deepseek");
  assert.equal(status.keychainExists, true);
  assert.equal(status.status, "unverified");
});

// --- getAllProviderStatuses ---

test("getAllProviderStatuses returns all registered providers including xai", () => {
  const service = mkSvc(undefined, undefined, undefined, stubKeychain(new Set(["forklight.deepseek.api-key"])));
  const all = service.getAllProviderStatuses();
  assert.equal(Object.keys(all).length, 5);
  for (const n of ALL_PROVIDERS) {
    assert.ok(n in all, `${n} missing from getAllProviderStatuses`);
  }
  assert.ok("xai" in all);
});
