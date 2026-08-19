import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { get, request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseTaskSpec } from "../src/core/task.js";
import {
  defaultAdvancedPolicyFields,
  defaultEnforcementCapability,
  deriveEffectivePolicyForTaskCreation,
} from "../src/core/advanced-policy.js";
import { cloneDefaults, SettingsService } from "../src/core/settings.js";
import {
  defaultWorkerProfiles,
  resolveWorkerSelection,
  setDefaultWorkerProfile,
  upsertWorkerProfile,
  validateWorkerProfile,
  validateWorkerProfilesSettings,
  type WorkerProfile,
} from "../src/core/worker-profiles.js";
import {
  removeModelConfig as removeMC,
  upsertModelConfig as upsertMC,
} from "../src/core/model-catalog.js";
import { inlineTask } from "../src/mcp/server.js";
import { StateStore } from "../src/state/store.js";
import { HubServer } from "../src/hub/server.js";
import { SetupService } from "../src/setup/service.js";
import type { SetupKeychainStore, SetupSystemInspector } from "../src/setup/types.js";

const baseContract = {
  outcome: "Ship a tiny verified change that is reviewable",
  modules: [
    {
      name: "core",
      responsibility: "Owns the main path of the feature",
      consumes: ["input"],
      produces: ["output"],
      boundaries: ["no network"],
    },
  ],
  callChain: ["start", "finish"],
  scenarios: [
    { name: "happy", given: "ok", when: "run", then: "pass" },
    { name: "fail", given: "bad", when: "run", then: "error" },
  ],
  risks: ["scope creep"],
  changeBudget: { maxFiles: 4, maxDiffLines: 80 },
};

test("model catalog + worker with modelConfigId and per-worker budget", () => {
  const settings = cloneDefaults();
  assert.ok(settings.modelCatalog.models.length >= 1);
  const catalog = upsertMC(settings.modelCatalog, {
    id: "deepseek-pro",
    label: "DeepSeek Pro",
    provider: "deepseek",
    model: "deepseek-v4-pro",
    endpoint: "https://api.deepseek.com/anthropic",
  });
  const profiles = upsertWorkerProfile(settings.workerProfiles, {
    id: "pro-worker",
    label: "Pro worker",
    runtime: "claude-code",
    modelConfigId: "deepseek-pro",
    maxBudgetUsd: 1.25,
    effort: "high",
    noProgressTimeoutMs: 120_000,
  }, catalog);

  const resolved = resolveWorkerSelection({ workerProfileId: "pro-worker" }, {
    execution: settings.execution,
    providerDefaults: settings.providerDefaults,
    workerProfiles: profiles,
    modelCatalog: catalog,
  });
  assert.equal(resolved.model, "deepseek-v4-pro");
  assert.equal(resolved.provider, "deepseek");
  assert.equal(resolved.maxBudgetUsd, 1.25);
  assert.equal(resolved.noProgressTimeoutMs, 120_000);
  assert.equal(resolved.modelConfigId, "deepseek-pro");

  assert.throws(
    () => upsertWorkerProfile(profiles, {
      id: "bad",
      label: "Bad",
      runtime: "grok-build",
      modelConfigId: "deepseek-pro",
    }, catalog),
    /grok-build requires provider.name=xai/,
  );

  assert.throws(
    () => removeMC(catalog, "deepseek-pro", ["pro-worker"]),
    /used by worker/,
  );
});

test("legacy provider+model worker profiles still resolve", () => {
  const settings = cloneDefaults();
  const profiles = upsertWorkerProfile(settings.workerProfiles, {
    id: "legacy",
    label: "Legacy",
    runtime: "claude-code",
    provider: "qwen",
    model: "qwen3.7-plus",
    maxBudgetUsd: 0.2,
  }, settings.modelCatalog);
  const resolved = resolveWorkerSelection({ workerProfileId: "legacy" }, {
    execution: settings.execution,
    providerDefaults: settings.providerDefaults,
    workerProfiles: profiles,
    modelCatalog: settings.modelCatalog,
  });
  assert.equal(resolved.provider, "qwen");
  assert.equal(resolved.model, "qwen3.7-plus");
  assert.equal(resolved.maxBudgetUsd, 0.2);
});

test("Codex Worker profile enforces the model-specific supported effort", () => {
  const settings = cloneDefaults();
  const catalog = upsertMC(settings.modelCatalog, {
    id: "codex-luna",
    label: "Codex Luna",
    provider: "openai",
    model: "gpt-5.6-luna",
    endpoint: "https://api.openai.com/v1",
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
  });
  const profiles = upsertWorkerProfile(settings.workerProfiles, {
    id: "codex-luna-high",
    label: "Codex Luna High",
    runtime: "codex-cli",
    modelConfigId: "codex-luna",
    effort: "high",
    maxBudgetUsd: null,
  }, catalog);
  const resolved = resolveWorkerSelection({ workerProfileId: "codex-luna-high" }, {
    execution: settings.execution,
    providerDefaults: settings.providerDefaults,
    workerProfiles: profiles,
    modelCatalog: catalog,
  });
  assert.equal(resolved.provider, "openai");
  assert.equal(resolved.runtime, "codex-cli");
  assert.equal(resolved.model, "gpt-5.6-luna");
  assert.equal(resolved.effort, "high");
  assert.throws(
    () => validateWorkerProfile({
      id: "codex-bad",
      label: "Codex bad effort",
      runtime: "codex-cli",
      modelConfigId: "codex-luna",
      effort: "ultra",
    }, "workerProfile", catalog),
    /effort must be/,
  );
  assert.throws(
    () => resolveWorkerSelection({ workerProfileId: "codex-limited", effort: "max" }, {
      execution: settings.execution,
      providerDefaults: settings.providerDefaults,
      workerProfiles: upsertWorkerProfile(profiles, {
        id: "codex-limited",
        label: "Codex limited",
        runtime: "codex-cli",
        modelConfigId: "codex-luna-limited",
        effort: "low",
      }, upsertMC(catalog, {
        id: "codex-luna-limited",
        label: "Codex Luna Limited",
        provider: "openai",
        model: "gpt-5.6-luna",
        supportedEfforts: ["low"],
      })),
      modelCatalog: upsertMC(catalog, {
        id: "codex-luna-limited",
        label: "Codex Luna Limited",
        provider: "openai",
        model: "gpt-5.6-luna",
        supportedEfforts: ["low"],
      }),
    }),
    /not supported/,
  );
});

test("MCP inlineTask uses worker modelConfigId and budget", () => {
  const settings = cloneDefaults();
  const catalog = settings.modelCatalog;
  const profiles = setDefaultWorkerProfile(
    upsertWorkerProfile(settings.workerProfiles, {
      id: "flash",
      label: "Flash",
      runtime: "claude-code",
      modelConfigId: "deepseek-flash",
      maxBudgetUsd: 0.33,
    }, catalog),
    "flash",
  );
  const settingsWith = { ...settings, workerProfiles: profiles, modelCatalog: catalog };
  const doc = inlineTask({
    name: "t",
    project: "/tmp/proj",
    contract: baseContract as never,
    focusPaths: ["src"],
    acceptance: { criteria: ["ok"], commands: ["true"] },
    workerProfileId: "flash",
    allowEdits: true,
  }, settingsWith);
  assert.equal((doc.provider as { model: string }).model, "deepseek-v4-flash");
  assert.equal((doc.runtime as { maxBudgetUsd: number }).maxBudgetUsd, 0.33);
  assert.equal(doc.workerProfileId, "flash");
});

test("parseTaskSpec honors workerProfileId with model catalog", async () => {
  const settings = cloneDefaults();
  const catalog = upsertMC(settings.modelCatalog, {
    id: "pro-model",
    label: "Pro",
    provider: "deepseek",
    model: "deepseek-v4-pro",
    endpoint: "https://api.deepseek.com/anthropic",
  });
  const profiles = upsertWorkerProfile(settings.workerProfiles, {
    id: "pro",
    label: "Pro",
    runtime: "claude-code",
    modelConfigId: "pro-model",
  }, catalog);
  const policy = {
    contractQuality: settings.contractQuality,
    execution: settings.execution,
    providerDefaults: settings.providerDefaults,
    completionPolicy: settings.completionPolicy,
    workerProfiles: profiles,
    modelCatalog: catalog,
  };
  const { loadTaskSpec } = await import("../src/core/task.js");
  const example = await loadTaskSpec(path.resolve("examples/deepseek-checkout.yaml"), policy);
  const raw = {
    version: 2,
    name: example.spec.name,
    project: example.spec.project,
    workerProfileId: "pro",
    contract: (example.spec as { contract: unknown }).contract,
    worker: {
      focusPaths: example.spec.worker.focusPaths,
      allowedCommands: [],
      allowEdits: true,
    },
    acceptance: example.spec.acceptance,
  };
  const spec = parseTaskSpec(raw, process.cwd(), policy);
  assert.equal(spec.provider.model, "deepseek-v4-pro");
  assert.equal(spec.runtime.name, "claude-code");
});

test("Hub Models + Workers chain: model catalog, worker with limits, setDefault", async () => {
  class MemoryKeychain implements SetupKeychainStore {
    readonly values = new Map<string, string>();
    private id(s: string, a: string): string { return `${a}:${s}`; }
    has(s: string, a: string): boolean { return this.values.has(this.id(s, a)); }
    read(s: string, a: string): string | undefined { return this.values.get(this.id(s, a)); }
    write(s: string, a: string, v: string): void { this.values.set(this.id(s, a), v); }
    delete(s: string, a: string): void { this.values.delete(this.id(s, a)); }
  }
  function doHttp(
    u: string, method: "GET" | "POST", token?: string, body?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (token) headers["x-forklight-hub-token"] = token;
      const payload = body !== undefined ? JSON.stringify(body) : undefined;
      if (payload) {
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = String(Buffer.byteLength(payload));
      }
      function onRes(res: import("node:http").IncomingMessage): void {
        let d = "";
        res.on("data", (c: Buffer) => { d += c.toString(); });
        res.on("end", () => {
          let parsed: unknown = d;
          try { if (d) parsed = JSON.parse(d); } catch { /* raw */ }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      }
      if (method === "GET") get(u, { headers }, onRes).on("error", reject);
      else {
        const req = request(u, { method: "POST", headers }, onRes);
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
      }
    });
  }

  const home = await mkdtemp(path.join(tmpdir(), "fl-mw-chain-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const keychain = new MemoryKeychain();
  const inspector: SetupSystemInspector = {
    platform: () => "darwin",
    nodeVersion: () => "v24.5.0",
    account: () => "cfg-user",
    commandExists: () => true,
  };
  const setup = new SetupService(settings, keychain, inspector);
  const staticDir = path.join(home, "static");
  await mkdir(staticDir, { recursive: true });
  await writeFile(path.join(staticDir, "index.html"), "<!DOCTYPE html><title>Hub</title>\n", "utf8");
  const server = new HubServer({
    settings,
    setup,
    keychain,
    staticRoot: staticDir,
    account: () => "cfg-user",
    port: 0,
    loadCodexModels: async () => [{
      model: "gpt-5.6-luna",
      label: "GPT-5.6-Luna",
      supportedEfforts: ["low", "high", "max"],
      defaultEffort: "high",
    }],
  });
  const port = await server.start();
  const token = server.getToken();
  const base = `http://127.0.0.1:${port}`;
  try {
    let res = await doHttp(`${base}/api/codex-model-catalog`, "POST", token, {
      action: "import",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((res.body as { imported: number }).imported, 1);
    const imported = (res.body as { modelCatalog: { models: Array<Record<string, unknown>> } })
      .modelCatalog.models.find((model) => model.id === "codex-gpt-5-6-luna");
    assert.deepEqual(imported?.supportedEfforts, ["low", "high", "max"]);

    res = await doHttp(`${base}/api/worker-profiles`, "POST", token, {
      action: "upsert",
      profile: {
        id: "codex-luna-max",
        label: "Codex Luna Max",
        runtime: "codex-cli",
        modelConfigId: "codex-gpt-5-6-luna",
        effort: "max",
        maxBudgetUsd: null,
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    res = await doHttp(`${base}/api/model-catalog`, "POST", token, {
      action: "upsert",
      model: {
        id: "qwen-cheap",
        label: "Qwen cheap",
        provider: "qwen",
        model: "qwen3.7-plus",
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    res = await doHttp(`${base}/api/worker-profiles`, "POST", token, {
      action: "upsert",
      profile: {
        id: "worker-qwen",
        label: "Qwen worker",
        runtime: "claude-code",
        modelConfigId: "qwen-cheap",
        maxBudgetUsd: 0.4,
        effort: "low",
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    res = await doHttp(`${base}/api/worker-profiles`, "POST", token, {
      action: "setDefault",
      id: "worker-qwen",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const wp = (res.body as { workerProfiles: { defaultProfileId: string; profiles: Array<Record<string, unknown>> } })
      .workerProfiles;
    assert.equal(wp.defaultProfileId, "worker-qwen");
    const w = wp.profiles.find((p) => p.id === "worker-qwen");
    assert.equal(w!.modelConfigId, "qwen-cheap");
    assert.equal(w!.maxBudgetUsd, 0.4);

    // Cannot delete model still referenced
    res = await doHttp(`${base}/api/model-catalog`, "POST", token, {
      action: "remove",
      id: "qwen-cheap",
    });
    assert.equal(res.status, 422);

    // Illegal pair: grok-build + qwen model
    res = await doHttp(`${base}/api/worker-profiles`, "POST", token, {
      action: "upsert",
      profile: {
        id: "bad",
        label: "Bad",
        runtime: "grok-build",
        modelConfigId: "qwen-cheap",
      },
    });
    assert.equal(res.status, 422);
  } finally {
    await server.stop();
    store.close();
  }
});

// --- pricingRoute: Worker profile, resolution, and precedence ---

test("Worker profile with pricingRoute threads into resolved selection", () => {
  const settings = cloneDefaults();
  const profiles = upsertWorkerProfile(settings.workerProfiles, {
    id: "minimax-cn",
    label: "MiniMax CN",
    runtime: "claude-code",
    provider: "minimax",
    model: "MiniMax-M3",
    endpoint: "https://api.minimaxi.com/anthropic",
    pricingRoute: "minimax-china-direct-payg",
  });
  const resolved = resolveWorkerSelection({ workerProfileId: "minimax-cn" }, {
    execution: settings.execution,
    providerDefaults: settings.providerDefaults,
    workerProfiles: profiles,
  });
  assert.equal(resolved.pricingRoute, "minimax-china-direct-payg");
});

test("explicit pricingRoute override wins over Worker profile", () => {
  const settings = cloneDefaults();
  const profiles = upsertWorkerProfile(settings.workerProfiles, {
    id: "intl",
    label: "MiniMax Intl",
    runtime: "claude-code",
    provider: "minimax",
    model: "MiniMax-M3",
    endpoint: "https://api.minimax.io/anthropic",
    pricingRoute: "minimax-international-direct-payg",
  });
  const resolved = resolveWorkerSelection({
    workerProfileId: "intl",
    pricingRoute: "minimax-china-direct-payg",
  }, {
    execution: settings.execution,
    providerDefaults: settings.providerDefaults,
    workerProfiles: profiles,
  });
  assert.equal(resolved.pricingRoute, "minimax-china-direct-payg");
});

test("missing pricingRoute stays undefined through resolution", () => {
  const settings = cloneDefaults();
  const resolved = resolveWorkerSelection({}, {
    execution: settings.execution,
    providerDefaults: settings.providerDefaults,
    workerProfiles: settings.workerProfiles,
    modelCatalog: settings.modelCatalog,
  });
  assert.equal(resolved.pricingRoute, undefined);
});

test("explicit Provider or endpoint override does not inherit a stale Worker pricingRoute", () => {
  const settings = cloneDefaults();
  const profiles = upsertWorkerProfile(settings.workerProfiles, {
    id: "mm-cn-stale-route",
    label: "MM CN",
    runtime: "claude-code",
    provider: "minimax",
    model: "MiniMax-M3",
    endpoint: "https://api.minimaxi.com/anthropic",
    pricingRoute: "minimax-china-direct-payg",
  });
  const common = {
    execution: settings.execution,
    providerDefaults: settings.providerDefaults,
    workerProfiles: profiles,
  };
  assert.equal(resolveWorkerSelection({
    workerProfileId: "mm-cn-stale-route",
    provider: "deepseek",
    model: "deepseek-v4-pro",
  }, common).pricingRoute, undefined);
  assert.equal(resolveWorkerSelection({
    workerProfileId: "mm-cn-stale-route",
    endpoint: "https://api.minimax.io/anthropic",
  }, common).pricingRoute, undefined);
});

test("explicit pricingRoute override is syntactically validated", () => {
  const settings = cloneDefaults();
  assert.throws(() => resolveWorkerSelection({ pricingRoute: " padded route " }, {
    execution: settings.execution,
    providerDefaults: settings.providerDefaults,
    workerProfiles: settings.workerProfiles,
    modelCatalog: settings.modelCatalog,
  }), /bounded non-empty identifier/);
});

test("pricingRoute is not forwarded to worker environment", async () => {
  const { resolveProvider, providerEnvironment } = await import("../src/core/providers.js");
  const config = resolveProvider("minimax", {
    endpoint: "https://api.minimax.io/anthropic",
    model: "MiniMax-M3",
    keychainService: "forklight.minimax.api-key",
  });
  const env = providerEnvironment(config, "test-api-key");
  // pricingRoute must not appear in the environment
  for (const key of Object.keys(env)) {
    assert.ok(!/pricing/i.test(key), `pricingRoute leaked into env key: ${key}`);
    assert.ok(!/route/i.test(key), `route leaked into env key: ${key}`);
  }
});

test("parseTaskSpec snapshots Worker pricingRoute into Task ProviderSpec", async () => {
  const settings = cloneDefaults();
  const profiles = upsertWorkerProfile(settings.workerProfiles, {
    id: "mm-cn",
    label: "MM CN",
    runtime: "claude-code",
    provider: "minimax",
    model: "MiniMax-M3",
    endpoint: "https://api.minimaxi.com/anthropic",
    pricingRoute: "minimax-china-direct-payg",
  });
  const policy = {
    contractQuality: settings.contractQuality,
    execution: settings.execution,
    providerDefaults: settings.providerDefaults,
    completionPolicy: settings.completionPolicy,
    workerProfiles: profiles,
  };
  const raw = {
    version: 2,
    name: "pricing-route-inherit",
    project: process.cwd(),
    workerProfileId: "mm-cn",
    contract: {
      outcome: "A reasonable outcome description for testing pricing route inheritance",
      context: ["c"],
      inScope: ["i"],
      outOfScope: ["o"],
      executionSteps: ["s"],
      deliverables: ["d"],
      modules: [{
        name: "m",
        responsibility: "long enough responsibility here for this test",
        consumes: ["c"],
        produces: ["p"],
        boundaries: ["b"],
      }],
      callChain: ["a", "b"],
      scenarios: [
        { name: "normal", given: "g", when: "w", then: "t" },
        { name: "edge", given: "g", when: "w", then: "t" },
      ],
      risks: ["r"],
      changeBudget: { maxFiles: 4, maxDiffLines: 300 },
    },
    worker: { focusPaths: ["src"], allowedCommands: [], allowEdits: true },
    acceptance: { criteria: ["c"], commands: ["true"] },
  };
  const spec = parseTaskSpec(raw, process.cwd(), policy);
  assert.equal(spec.provider.pricingRoute, "minimax-china-direct-payg");

  const invalid = {
    ...raw,
    provider: {
      name: "minimax",
      model: "MiniMax-M3",
      endpoint: "https://api.minimaxi.com/anthropic",
      pricingRoute: " padded route ",
      keychainService: "forklight.minimax.api-key",
    },
  };
  assert.throws(() => parseTaskSpec(invalid, process.cwd(), policy),
    /task\.provider\.pricingRoute must be a bounded non-empty identifier/);

  const changedIdentity = {
    ...raw,
    provider: {
      name: "deepseek",
      model: "deepseek-v4-pro",
      endpoint: "https://api.deepseek.com/anthropic",
      keychainService: "forklight.deepseek.api-key",
    },
  };
  const changed = parseTaskSpec(changedIdentity, process.cwd(), policy);
  assert.equal(changed.provider.pricingRoute, undefined);
});

test("parseTaskSpec explicit pricingRoute overrides Worker pricingRoute", async () => {
  const settings = cloneDefaults();
  const profiles = upsertWorkerProfile(settings.workerProfiles, {
    id: "mm-intl",
    label: "MM Intl",
    runtime: "claude-code",
    provider: "minimax",
    model: "MiniMax-M3",
    endpoint: "https://api.minimax.io/anthropic",
    pricingRoute: "minimax-international-direct-payg",
  });
  const policy = {
    contractQuality: settings.contractQuality,
    execution: settings.execution,
    providerDefaults: settings.providerDefaults,
    completionPolicy: settings.completionPolicy,
    workerProfiles: profiles,
  };
  const raw = {
    version: 2,
    name: "explicit-override",
    project: process.cwd(),
    workerProfileId: "mm-intl",
    provider: {
      name: "minimax",
      model: "MiniMax-M3",
      endpoint: "https://api.minimax.io/anthropic",
      pricingRoute: "minimax-china-direct-payg",
      keychainService: "forklight.minimax.api-key",
    },
    contract: {
      outcome: "A reasonable outcome description for testing explicit pricing route override",
      context: ["c"],
      inScope: ["i"],
      outOfScope: ["o"],
      executionSteps: ["s"],
      deliverables: ["d"],
      modules: [{
        name: "m",
        responsibility: "long enough responsibility here for this test",
        consumes: ["c"],
        produces: ["p"],
        boundaries: ["b"],
      }],
      callChain: ["a", "b"],
      scenarios: [
        { name: "normal", given: "g", when: "w", then: "t" },
        { name: "edge", given: "g", when: "w", then: "t" },
      ],
      risks: ["r"],
      changeBudget: { maxFiles: 4, maxDiffLines: 300 },
    },
    worker: { focusPaths: ["src"], allowedCommands: [], allowEdits: true },
    acceptance: { criteria: ["c"], commands: ["true"] },
  };
  const spec = parseTaskSpec(raw, process.cwd(), policy);
  assert.equal(spec.provider.pricingRoute, "minimax-china-direct-payg");
});

test("validateWorkerProfile rejects invalid pricingRoute", () => {
  assert.throws(() => validateWorkerProfile({
    id: "bad-route",
    label: "Bad route",
    runtime: "claude-code",
    provider: "minimax",
    model: "MiniMax-M3",
    pricingRoute: "",
  } as unknown as WorkerProfile, "workerProfile", cloneDefaults().modelCatalog),
    /pricingRoute must be a bounded non-empty identifier/);
});

test("MCP inlineTask propagates pricingRoute from Worker profile", () => {
  const settings = cloneDefaults();
  const profiles = upsertWorkerProfile(settings.workerProfiles, {
    id: "mm-cn-worker",
    label: "MM CN",
    runtime: "claude-code",
    provider: "minimax",
    model: "MiniMax-M3",
    endpoint: "https://api.minimaxi.com/anthropic",
    pricingRoute: "minimax-china-direct-payg",
  });
  const settingsWith = { ...settings, workerProfiles: profiles };
  const doc = inlineTask({
    name: "t",
    project: "/tmp/proj",
    contract: {
      outcome: "A proper outcome description with enough length here",
      modules: [{
        name: "core",
        responsibility: "Owns the main path of the feature",
        consumes: ["input"],
        produces: ["output"],
        boundaries: ["no network"],
      }],
      callChain: ["start", "finish"],
      scenarios: [
        { name: "happy", given: "ok", when: "run", then: "pass" },
        { name: "fail", given: "bad", when: "run", then: "error" },
      ],
      risks: ["scope creep"],
      changeBudget: { maxFiles: 4, maxDiffLines: 80 },
    } as never,
    focusPaths: ["src"],
    acceptance: { criteria: ["ok"], commands: ["true"] },
    workerProfileId: "mm-cn-worker",
    allowEdits: true,
  }, settingsWith);
  assert.equal((doc.provider as Record<string, unknown>).pricingRoute, "minimax-china-direct-payg");
});

test("MCP inlineTask explicit pricingRoute overrides Worker pricingRoute", () => {
  const settings = cloneDefaults();
  const profiles = upsertWorkerProfile(settings.workerProfiles, {
    id: "mm-intl-worker",
    label: "MM Intl",
    runtime: "claude-code",
    provider: "minimax",
    model: "MiniMax-M3",
    endpoint: "https://api.minimax.io/anthropic",
    pricingRoute: "minimax-international-direct-payg",
  });
  const settingsWith = { ...settings, workerProfiles: profiles };
  const doc = inlineTask({
    name: "t",
    project: "/tmp/proj",
    contract: {
      outcome: "A proper outcome description with enough length here",
      modules: [{
        name: "core",
        responsibility: "Owns the main path of the feature",
        consumes: ["input"],
        produces: ["output"],
        boundaries: ["no network"],
      }],
      callChain: ["start", "finish"],
      scenarios: [
        { name: "happy", given: "ok", when: "run", then: "pass" },
        { name: "fail", given: "bad", when: "run", then: "error" },
      ],
      risks: ["scope creep"],
      changeBudget: { maxFiles: 4, maxDiffLines: 80 },
    } as never,
    focusPaths: ["src"],
    acceptance: { criteria: ["ok"], commands: ["true"] },
    workerProfileId: "mm-intl-worker",
    pricingRoute: "minimax-china-direct-payg",
    allowEdits: true,
  }, settingsWith);
  assert.equal((doc.provider as Record<string, unknown>).pricingRoute, "minimax-china-direct-payg");
});

test("SettingsService persists model catalog and worker profiles", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-profiles-"));
  const store = new StateStore(home);
  try {
    const settings = new SettingsService(store);
    const current = settings.get();
    const catalog = upsertMC(current.modelCatalog, {
      id: "extra",
      label: "Extra",
      provider: "deepseek",
      model: "deepseek-v4-pro",
      endpoint: "https://api.deepseek.com/anthropic",
    });
    const nextProfiles = upsertWorkerProfile(current.workerProfiles, {
      id: "w2",
      label: "W2",
      runtime: "claude-code",
      modelConfigId: "extra",
      maxBudgetUsd: 0.9,
    }, catalog);
    const updated = settings.update({
      modelCatalog: catalog,
      workerProfiles: setDefaultWorkerProfile(nextProfiles, "w2"),
    });
    assert.equal(updated.workerProfiles.defaultProfileId, "w2");
    assert.ok(updated.modelCatalog.models.some((m) => m.id === "extra"));
    const reloaded = new SettingsService(store).get();
    assert.equal(reloaded.workerProfiles.defaultProfileId, "w2");
    assert.equal(
      reloaded.workerProfiles.profiles.find((p) => p.id === "w2")?.maxBudgetUsd,
      0.9,
    );
  } finally {
    store.close();
  }
});

// --- Execution preference (FL-104) ---

test("worker profile validates executionPreference and threads it into resolution", () => {
  const settings = cloneDefaults();
  const catalog = upsertMC(settings.modelCatalog, {
    id: "codex-luna",
    label: "Codex Luna",
    provider: "openai",
    model: "gpt-5.6-luna",
    endpoint: "https://api.openai.com/v1",
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
  });
  const profiles = upsertWorkerProfile(settings.workerProfiles, {
    id: "codex-auto",
    label: "Codex Auto",
    runtime: "codex-cli",
    modelConfigId: "codex-luna",
    effort: "high",
    executionPreference: "auto",
  }, catalog);
  const resolved = resolveWorkerSelection({ workerProfileId: "codex-auto" }, {
    execution: settings.execution,
    providerDefaults: settings.providerDefaults,
    workerProfiles: profiles,
    modelCatalog: catalog,
  });
  assert.equal(resolved.executionPreference, "auto");
});

test("legacy worker profile without executionPreference preserves single-run", () => {
  const settings = cloneDefaults();
  const profiles = upsertWorkerProfile(settings.workerProfiles, {
    id: "legacy-ex",
    label: "Legacy",
    runtime: "claude-code",
    provider: "deepseek",
    model: "deepseek-v4-flash",
  }, settings.modelCatalog);
  const resolved = resolveWorkerSelection({ workerProfileId: "legacy-ex" }, {
    execution: settings.execution,
    providerDefaults: settings.providerDefaults,
    workerProfiles: profiles,
    modelCatalog: settings.modelCatalog,
  });
  assert.equal(resolved.executionPreference, undefined);
});

test("forced native-goal profile on Grok is accepted", () => {
  const validated = validateWorkerProfile({
    id: "grok-native",
    label: "Grok native",
    runtime: "grok-build",
    provider: "xai",
    model: "grok-4.6",
    effort: "xhigh",
    executionPreference: "native-goal",
  }, "workerProfile", cloneDefaults().modelCatalog);
  assert.equal(validated.executionPreference, "native-goal");
});

test("forced native-goal profile on an unsupported Runtime fails validation", () => {
  assert.throws(
    () => validateWorkerProfile({
      id: "bad-native",
      label: "Bad native",
      runtime: "claude-code",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      executionPreference: "native-goal",
    } as unknown as WorkerProfile, "workerProfile", cloneDefaults().modelCatalog),
    /native-goal.*proven native Goal contract/,
  );
  assert.throws(
    () => validateWorkerProfile({
      id: "bad-value",
      label: "Bad value",
      runtime: "claude-code",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      executionPreference: "goal-magic",
    } as unknown as WorkerProfile, "workerProfile", cloneDefaults().modelCatalog),
    /executionPreference must be auto, single-run, persistent-session, or native-goal/,
  );
});

test("forced persistent-session profile on Grok is accepted", () => {
  const validated = validateWorkerProfile({
    id: "grok-persist",
    label: "Grok persist",
    runtime: "grok-build",
    provider: "xai",
    model: "grok-4.6",
    effort: "xhigh",
    executionPreference: "persistent-session",
  }, "workerProfile", cloneDefaults().modelCatalog);
  assert.equal(validated.executionPreference, "persistent-session");
});

test("forced persistent-session profile on an unsupported Runtime fails validation", () => {
  assert.throws(
    () => validateWorkerProfile({
      id: "bad-session",
      label: "Bad session",
      runtime: "claude-code",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      executionPreference: "persistent-session",
    } as unknown as WorkerProfile, "workerProfile", cloneDefaults().modelCatalog),
    /persistent-session.*stable session identity/,
  );
});

test("default catalog and Profile materialize exact Grok 4.6 Xhigh identity", () => {
  const settings = cloneDefaults();
  const model = settings.modelCatalog.models.find((entry) => entry.id === "xai-grok-4-6");
  assert.equal(model?.provider, "xai");
  assert.equal(model?.model, "grok-4.6");
  assert.ok(model?.supportedEfforts?.includes("xhigh"));
  const profile = settings.workerProfiles.profiles.find((entry) => entry.id === "grok-4-6-xhigh");
  assert.equal(profile?.runtime, "grok-build");
  assert.equal(profile?.modelConfigId, "xai-grok-4-6");
  assert.equal(profile?.effort, "xhigh");
  assert.equal(profile?.executionPreference, "auto");
  const resolved = resolveWorkerSelection({ workerProfileId: "grok-4-6-xhigh" }, {
    execution: settings.execution,
    providerDefaults: settings.providerDefaults,
    workerProfiles: settings.workerProfiles,
    modelCatalog: settings.modelCatalog,
  });
  assert.equal(resolved.runtime, "grok-build");
  assert.equal(resolved.provider, "xai");
  assert.equal(resolved.model, "grok-4.6");
  assert.equal(resolved.effort, "xhigh");
  assert.equal(resolved.executionPreference, "auto");
});

test("persisted Profile arrays are not rewritten when validating a legacy set", () => {
  const settings = cloneDefaults();
  const legacy = validateWorkerProfilesSettings({
    defaultProfileId: "legacy-only",
    profiles: [{
      id: "legacy-only",
      label: "Legacy only",
      runtime: "claude-code",
      provider: "deepseek",
      model: "deepseek-v4-flash",
    }],
  }, "workerProfiles", settings.modelCatalog);
  assert.equal(legacy.profiles.length, 1);
  assert.equal(legacy.profiles[0]?.id, "legacy-only");
  assert.equal(legacy.profiles[0]?.executionPreference, undefined);
  assert.equal(legacy.profiles.some((profile) => profile.id === "grok-4-6-xhigh"), false);
});

test("forced native-goal profile on Codex is accepted", () => {
  const settings = cloneDefaults();
  const catalog = upsertMC(settings.modelCatalog, {
    id: "codex-luna",
    label: "Codex Luna",
    provider: "openai",
    model: "gpt-5.6-luna",
    endpoint: "https://api.openai.com/v1",
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
  });
  const validated = validateWorkerProfile({
    id: "codex-native",
    label: "Codex Native",
    runtime: "codex-cli",
    modelConfigId: "codex-luna",
    effort: "high",
    executionPreference: "native-goal",
  }, "workerProfile", catalog);
  assert.equal(validated.executionPreference, "native-goal");
});

test("default Worker Profile defaults to auto execution", () => {
  const settings = cloneDefaults();
  const profiles = defaultWorkerProfiles(
    settings.execution,
    settings.providerDefaults,
    settings.modelCatalog,
  );
  assert.equal(
    profiles.profiles.find((profile) => profile.id === "default")?.executionPreference,
    "auto",
  );
  assert.equal(
    profiles.profiles.some((profile) => profile.id === "grok-4-6-xhigh"),
    false,
    "fallback defaultWorkerProfiles must not inject a saved Grok Profile",
  );
});

// --- Finite validation-repair allowance freezes into new Tasks ---

test("Worker validation-repair override round-trips and freezes into a new Task policy", async () => {
  const settings = cloneDefaults();
  const catalog = settings.modelCatalog;
  const profiles = upsertWorkerProfile(settings.workerProfiles, {
    id: "repair-three",
    label: "Repair three",
    runtime: "claude-code",
    modelConfigId: "deepseek-flash",
    advancedPolicy: { maxWorkerValidationRepairs: 3 },
  }, catalog);
  const profile = profiles.profiles.find((p) => p.id === "repair-three");
  assert.equal(profile?.advancedPolicy?.maxWorkerValidationRepairs, 3);

  const globalDefaults = defaultAdvancedPolicyFields();
  const frozen = deriveEffectivePolicyForTaskCreation({
    workerProfile: profile,
    globalDefaults,
    enforcementCapability: defaultEnforcementCapability(),
  });
  assert.equal(frozen.values.maxWorkerValidationRepairs, 3);
  assert.equal(frozen.provenance.maxWorkerValidationRepairs, "worker");

  // Persistence round-trip: saving and reloading keeps the finite override.
  const home = await mkdtemp(path.join(tmpdir(), "fl-repair-persist-"));
  const store = new StateStore(home);
  try {
    const service = new SettingsService(store);
    service.update({ workerProfiles: profiles });
    const reloaded = new SettingsService(store).get();
    const saved = reloaded.workerProfiles.profiles.find((p) => p.id === "repair-three");
    assert.equal(saved?.advancedPolicy?.maxWorkerValidationRepairs, 3);
  } finally {
    store.close();
  }
});

test("a Worker without a validation-repair override inherits the global default", () => {
  const settings = cloneDefaults();
  const profile = settings.workerProfiles.profiles[0];
  const globalDefaults = defaultAdvancedPolicyFields();
  const frozen = deriveEffectivePolicyForTaskCreation({
    workerProfile: profile,
    globalDefaults,
    enforcementCapability: defaultEnforcementCapability(),
  });
  assert.equal(frozen.values.maxWorkerValidationRepairs, 1);
  assert.equal(frozen.provenance.maxWorkerValidationRepairs, "global");
});

test("zero validation-repair override disables automatic repair for new Tasks", () => {
  const settings = cloneDefaults();
  const catalog = settings.modelCatalog;
  const profiles = upsertWorkerProfile(settings.workerProfiles, {
    id: "repair-off",
    label: "Repair off",
    runtime: "claude-code",
    modelConfigId: "deepseek-flash",
    advancedPolicy: { maxWorkerValidationRepairs: 0 },
  }, catalog);
  const profile = profiles.profiles.find((p) => p.id === "repair-off");
  const frozen = deriveEffectivePolicyForTaskCreation({
    workerProfile: profile,
    globalDefaults: defaultAdvancedPolicyFields(),
    enforcementCapability: defaultEnforcementCapability(),
  });
  assert.equal(frozen.values.maxWorkerValidationRepairs, 0);
  assert.equal(frozen.provenance.maxWorkerValidationRepairs, "worker");
});
