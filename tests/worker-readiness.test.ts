import assert from "node:assert/strict";
import test from "node:test";
import { cloneDefaults } from "../src/core/settings.js";
import {
  resolveWorkerReadiness,
  type WorkerReadinessInput,
} from "../src/core/worker-readiness.js";
import type { ProviderName, ProviderReadiness } from "../src/core/providers.js";

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

function input(
  patch: Partial<WorkerReadinessInput> = {},
): WorkerReadinessInput {
  const defaults = cloneDefaults();
  return {
    workerProfiles: {
      defaultProfileId: "deepseek-worker",
      profiles: [
        {
          id: "deepseek-worker",
          label: "DeepSeek Worker",
          runtime: "claude-code",
          modelConfigId: "deepseek-model",
        },
        {
          id: "grok-worker",
          label: "Grok Worker",
          runtime: "grok-build",
          modelConfigId: "xai-model",
          executionPreference: "auto",
        },
      ],
    },
    modelCatalog: {
      models: [
        {
          id: "deepseek-model",
          label: "DeepSeek",
          provider: "deepseek",
          model: "deepseek-v4-pro[1M]",
        },
        {
          id: "xai-model",
          label: "Grok",
          provider: "xai",
          model: "grok-4.5",
        },
      ],
    },
    providerDefaults: defaults.providerDefaults,
    providers: providerEvidence(),
    runtimes: {
      "claude-code": { ok: true },
      "grok-build": { ok: true },
    },
    providerVerification: {
      deepseek: { status: "verified" },
      xai: { status: "unverified" },
    },
    ...patch,
  };
}

test("Worker readiness keeps local launch and Provider verification separate", () => {
  const result = resolveWorkerReadiness(input());
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    workerId: "deepseek-worker",
    workerLabel: "DeepSeek Worker",
    state: "ready",
    canLaunch: true,
    reason: "ready",
    nextAction: "none",
    runtime: "claude-code",
    provider: "deepseek",
    model: "deepseek-v4-pro[1M]",
    executionPreference: "single-run",
    resolvedExecutionMode: "single-run",
    checks: {
      model: "ready",
      pairing: "allowed",
      authentication: "api-key",
      runtime: "ready",
      connection: "verified",
      nativeGoal: "unsupported",
    },
  });
  assert.equal(result[1]!.state, "launchable");
  assert.equal(result[1]!.canLaunch, true);
  assert.equal(result[1]!.checks.authentication, "local-sign-in");
  assert.equal(result[1]!.reason, "connection-unverified");
  assert.equal(result[1]!.nextAction, "run-smoke-check");
});

test("missing authentication blocks before runtime or connection claims", () => {
  const providers = providerEvidence({
    deepseek: { ready: false, authMode: "none", error: "private diagnostic" },
  });
  const [result] = resolveWorkerReadiness(input({ providers }));
  assert.equal(result!.state, "blocked");
  assert.equal(result!.canLaunch, false);
  assert.equal(result!.reason, "authentication-missing");
  assert.equal(result!.nextAction, "configure-authentication");
  assert.equal(result!.checks.runtime, "unknown");
  assert.equal(JSON.stringify(result).includes("private diagnostic"), false);
});

test("runtime failure, stale connection, and failed connection stay distinct", () => {
  const runtimeFailure = resolveWorkerReadiness(input({
    runtimes: { "claude-code": { ok: false }, "grok-build": { ok: true } },
  }))[0]!;
  assert.equal(runtimeFailure.state, "blocked");
  assert.equal(runtimeFailure.reason, "runtime-unavailable");
  assert.equal(runtimeFailure.nextAction, "fix-runtime");

  const stale = resolveWorkerReadiness(input({
    providerVerification: { deepseek: { status: "stale" } },
  }))[0]!;
  assert.equal(stale.state, "launchable");
  assert.equal(stale.reason, "connection-stale");

  const failed = resolveWorkerReadiness(input({
    providerVerification: { deepseek: { status: "failed" } },
  }))[0]!;
  assert.equal(failed.state, "needs-attention");
  assert.equal(failed.canLaunch, true);
  assert.equal(failed.reason, "connection-failed");
  assert.equal(failed.nextAction, "check-provider");
});

test("missing model and forged invalid pairing fail closed without invented identity", () => {
  const missing = input();
  missing.workerProfiles = {
    defaultProfileId: "missing",
    profiles: [{
      id: "missing",
      label: "Missing model",
      runtime: "claude-code",
      modelConfigId: "not-in-catalog",
    }],
  };
  const missingResult = resolveWorkerReadiness(missing)[0]!;
  assert.equal(missingResult.reason, "model-invalid");
  assert.equal(missingResult.provider, undefined);
  assert.equal(missingResult.model, undefined);

  const forged = input();
  forged.workerProfiles = {
    defaultProfileId: "forged",
    profiles: [{
      id: "forged",
      label: "Forged pairing",
      runtime: "grok-build",
      modelConfigId: "deepseek-model",
    }],
  };
  const forgedResult = resolveWorkerReadiness(forged)[0]!;
  assert.equal(forgedResult.reason, "pairing-invalid");
  assert.equal(forgedResult.nextAction, "change-pairing");
  assert.equal(forgedResult.checks.pairing, "invalid");
});

test("readiness output is bounded and omits credentials, endpoints, paths, and diagnostics", () => {
  const serialized = JSON.stringify(resolveWorkerReadiness(input()));
  for (const forbidden of [
    "keychainService",
    "endpoint",
    "auth.json",
    "/Users/",
    "failureSummary",
    "issues",
    "command",
    "token",
    "secret",
  ]) {
    assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
});

// --- Worker-run evidence supersedes probe failure ---

test("worker-run verified evidence supersedes old explicit-probe failure for Grok Worker", () => {
  const result = resolveWorkerReadiness(input({
    providers: providerEvidence({
      xai: { ready: true, authMode: "local-sign-in" },
    }),
    providerVerification: { xai: { status: "verified" } },
  }));
  const grok = result.find((r) => r.workerId === "grok-worker")!;
  assert.equal(grok.state, "ready");
  assert.equal(grok.canLaunch, true);
  assert.equal(grok.reason, "ready");
  assert.equal(grok.checks.connection, "verified");
});

test("Grok Worker with local-sign-in and no evidence is launchable, not failed", () => {
  const result = resolveWorkerReadiness(input({
    providers: providerEvidence({
      xai: { ready: true, authMode: "local-sign-in" },
    }),
    providerVerification: { xai: { status: "unverified" } },
  }));
  const grok = result.find((r) => r.workerId === "grok-worker")!;
  assert.equal(grok.state, "launchable");
  assert.equal(grok.canLaunch, true);
  assert.equal(grok.reason, "connection-unverified");
  assert.equal(grok.checks.authentication, "local-sign-in");
});

test("Grok Worker with local-sign-in and old failed evidence is launchable when evidence treated as unverified", () => {
  // When the old probe-only failure is correctly classified as unverified
  // (because local-sign-in exists), the Worker should be launchable.
  const result = resolveWorkerReadiness(input({
    providers: providerEvidence({
      xai: { ready: true, authMode: "local-sign-in" },
    }),
    providerVerification: { xai: { status: "unverified" } },
  }));
  const grok = result.find((r) => r.workerId === "grok-worker")!;
  assert.equal(grok.state, "launchable");
  assert.equal(grok.canLaunch, true);
  assert.equal(grok.reason, "connection-unverified");
});

test("Worker with failed connection evidence stays needs-attention for non-xAI providers", () => {
  const providers = providerEvidence({
    deepseek: { ready: true, authMode: "api-key" },
  });
  const [result] = resolveWorkerReadiness(input({
    providers,
    providerVerification: { deepseek: { status: "failed" } },
  }));
  assert.equal(result!.state, "needs-attention");
  assert.equal(result!.reason, "connection-failed");
  assert.equal(result!.canLaunch, true);
});

test("Codex Worker with openai local sign-in is launchable with exact identity", () => {
  const defaults = cloneDefaults();
  const providers = providerEvidence();
  providers.openai = {
    ready: true,
    authMode: "local-sign-in",
    endpoint: defaults.providerDefaults.openai.defaultEndpoint,
    defaultModel: defaults.providerDefaults.openai.defaultModel,
    keychainService: defaults.providerDefaults.openai.defaultKeychainService,
  };
  const result = resolveWorkerReadiness(input({
    providers,
    runtimes: {
      "claude-code": { ok: true },
      "grok-build": { ok: true },
      "codex-cli": { ok: true },
    },
    workerProfiles: {
      defaultProfileId: "codex-worker",
      profiles: [{
        id: "codex-worker",
        label: "Codex Worker",
        runtime: "codex-cli",
        modelConfigId: "codex-model",
        effort: "max",
      }],
    },
    modelCatalog: {
      models: [{
        id: "codex-model",
        label: "Codex Luna",
        provider: "openai",
        model: "gpt-5.6-luna",
        endpoint: "https://api.openai.com/v1",
        supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
      }],
    },
  }))[0]!;
  assert.equal(result.state, "launchable");
  assert.equal(result.canLaunch, true);
  assert.equal(result.reason, "connection-unverified");
  assert.equal(result.nextAction, "run-smoke-check");
  assert.equal(result.runtime, "codex-cli");
  assert.equal(result.provider, "openai");
  assert.equal(result.model, "gpt-5.6-luna");
  assert.equal(result.checks.authentication, "local-sign-in");
  assert.equal(result.checks.runtime, "ready");
  assert.equal(JSON.stringify(result).includes("endpoint"), false, "readiness never exposes endpoints");
  assert.equal(JSON.stringify(result).includes("keychainService"), false);
});

// --- Execution preference / resolved mode (FL-104) ---

function codexReadyInput(): WorkerReadinessInput {
  const defaults = cloneDefaults();
  const providers = providerEvidence();
  providers.openai = {
    ready: true,
    authMode: "local-sign-in",
    endpoint: defaults.providerDefaults.openai.defaultEndpoint,
    defaultModel: defaults.providerDefaults.openai.defaultModel,
    keychainService: defaults.providerDefaults.openai.defaultKeychainService,
  };
  return {
    workerProfiles: {
      defaultProfileId: "codex-worker",
      profiles: [{
        id: "codex-worker",
        label: "Codex Worker",
        runtime: "codex-cli",
        modelConfigId: "codex-model",
        effort: "max",
        executionPreference: "auto",
      }],
    },
    modelCatalog: {
      models: [{
        id: "codex-model",
        label: "Codex Luna",
        provider: "openai",
        model: "gpt-5.6-luna",
        endpoint: "https://api.openai.com/v1",
        supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
      }],
    },
    providerDefaults: defaults.providerDefaults,
    providers,
    runtimes: {
      "claude-code": { ok: true },
      "grok-build": { ok: true },
      "codex-cli": { ok: true },
    },
    providerVerification: {
      openai: { status: "verified" },
    },
  };
}

test("auto Codex Worker resolves native-goal and projects the resolved mode", () => {
  const result = resolveWorkerReadiness(codexReadyInput())[0]!;
  assert.equal(result.state, "ready");
  assert.equal(result.executionPreference, "auto");
  assert.equal(result.resolvedExecutionMode, "native-goal");
  assert.equal(result.checks.nativeGoal, "ready");
});

test("auto unsupported Runtime resolves single-run and explains it", () => {
  // A Grok Worker with auto preference has no proven native Goal contract.
  const result = resolveWorkerReadiness(input())[1]!;
  assert.equal(result.workerId, "grok-worker");
  assert.equal(result.executionPreference, "auto");
  assert.equal(result.resolvedExecutionMode, "single-run");
  assert.equal(result.checks.nativeGoal, "unsupported");
});

test("forced native-goal on an unsupported Runtime fails closed", () => {
  const forced = input();
  forced.workerProfiles = {
    defaultProfileId: "forced",
    profiles: [{
      id: "forced",
      label: "Forced native Goal",
      runtime: "grok-build",
      modelConfigId: "xai-model",
      executionPreference: "native-goal",
    }],
  };
  const result = resolveWorkerReadiness(forced)[0]!;
  assert.equal(result.state, "blocked");
  assert.equal(result.canLaunch, false);
  assert.equal(result.reason, "native-goal-unsupported");
  assert.equal(result.nextAction, "choose-execution-mode");
  assert.equal(result.resolvedExecutionMode, "native-goal");
  assert.equal(result.checks.nativeGoal, "unsupported");
});

test("legacy profile without a preference stays single-run", () => {
  const result = resolveWorkerReadiness(input())[0]!;
  assert.equal(result.executionPreference, "single-run");
  assert.equal(result.resolvedExecutionMode, "single-run");
});
