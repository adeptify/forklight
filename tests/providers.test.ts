import assert from "node:assert/strict";
import test from "node:test";
import {
  providerDefinition,
  providerEnvironment,
  providerNames,
  providerReadiness,
  providerVariants,
  resolveProvider,
} from "../src/core/providers.js";
import { cloneDefaults, type ProviderDefaultSettings } from "../src/core/settings.js";
import { parseTaskSpec } from "../src/core/task.js";

test("provider registry exposes Claude Code-compatible defaults plus xai", () => {
  assert.deepEqual(providerNames(), ["deepseek", "qwen", "minimax", "glm", "xai"]);
  assert.deepEqual(
    providerNames().map((name) => {
      const definition = providerDefinition(name);
      return [name, definition.defaultModel, definition.defaultEndpoint];
    }),
    [
      ["deepseek", "deepseek-v4-flash", "https://api.deepseek.com/anthropic"],
      ["qwen", "qwen3.7-plus", "https://dashscope.aliyuncs.com/apps/anthropic"],
      ["minimax", "MiniMax-M3", "https://api.minimax.io/anthropic"],
      ["glm", "glm-5.2", "https://dashscope.aliyuncs.com/apps/anthropic"],
      ["xai", "grok-4.5", "https://api.x.ai/v1"],
    ],
  );
});

test("DeepSeek providerVariants lists Flash and Pro families, not only the default (FL-D18)", () => {
  const variants = providerVariants("deepseek");
  assert.equal(variants.length, 1);
  const models = variants[0]!.models;
  assert.ok(models.includes("deepseek-v4-flash"), "flash must be listed");
  assert.ok(models.includes("deepseek-v4-pro"), "pro must be listed");
  assert.ok(models.includes("deepseek-v4-pro[1m]"), "pro 1m must be listed");
  // Default model still appears (and is not the sole entry).
  assert.ok(models.includes(providerDefinition("deepseek").defaultModel));
  assert.ok(models.length >= 3);
});

test("task parsing stores provider metadata but never credential values", () => {
  for (const name of providerNames()) {
    // xai pairs only with grok-build; Anthropic-compat providers use claude-code.
    const runtime = name === "xai"
      ? { name: "grok-build", executable: "grok", effort: "high", maxBudgetUsd: 0.1 }
      : { name: "claude-code", executable: "claude", effort: "high", maxBudgetUsd: 0.1 };
    const spec = parseTaskSpec(
      {
        version: 1,
        name: `${name} task`,
        project: ".",
        provider: { name },
        runtime,
        goal: "Exercise provider selection",
        acceptance: { commands: ["true"] },
      },
      process.cwd(),
    );
    const definition = providerDefinition(name);
    assert.equal(spec.provider.name, name);
    assert.equal(spec.provider.model, definition.defaultModel);
    assert.equal(spec.provider.keychainService, definition.defaultKeychainService);
    assert.equal("apiKey" in spec.provider, false);
    assert.equal("credential" in spec.provider, false);
  }
  assert.throws(
    () => providerEnvironment(resolveProvider("xai"), "k"),
    /does not support xai/,
  );
});

test("runtime environment is assembled only from normalized metadata and a transient key", () => {
  const config = resolveProvider("minimax", {
    model: "MiniMax-M2.7-highspeed",
    endpoint: "https://api.minimaxi.com/anthropic",
  });
  const environment = providerEnvironment(config, "transient-test-key");
  assert.equal(environment.ANTHROPIC_BASE_URL, "https://api.minimaxi.com/anthropic");
  assert.equal(environment.ANTHROPIC_MODEL, "MiniMax-M2.7-highspeed");
  assert.equal(environment.ANTHROPIC_AUTH_TOKEN, "transient-test-key");
  assert.equal(environment.ANTHROPIC_API_KEY, undefined);
  assert.equal(environment.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1");
  assert.equal(JSON.stringify(config).includes("transient-test-key"), false);
});

test("runtime environment removes an inherited Anthropic API key", () => {
  const config = resolveProvider("minimax");
  const environment = providerEnvironment(config, "transient-test-key", {
    ANTHROPIC_API_KEY: "parent-key-that-must-not-win",
    FORKLIGHT_PARENT_MARKER: "preserved",
  });
  assert.equal(environment.ANTHROPIC_API_KEY, undefined);
  assert.equal(environment.ANTHROPIC_AUTH_TOKEN, "transient-test-key");
  assert.equal(environment.FORKLIGHT_PARENT_MARKER, "preserved");
});

test("unknown provider names fail before workspace execution", () => {
  assert.throws(
    () =>
      parseTaskSpec(
        {
          version: 1,
          name: "unsupported",
          project: ".",
          provider: { name: "unknown" },
          goal: "Must not run",
          acceptance: { commands: ["true"] },
        },
        process.cwd(),
      ),
    /Unsupported provider: unknown/,
  );
});

// --- configured provider defaults (table-driven) ---

test("configured provider defaults override built-in definition defaults", () => {
  const minimaxDefaults: ProviderDefaultSettings = {
    defaultModel: "MiniMax-M3-custom",
    defaultEndpoint: "https://api.minimax-custom.io/anthropic",
    defaultKeychainService: "forklight.minimax.custom-key",
    defaultHaikuModel: "MiniMax-M3-haiku",
    requestTimeoutMs: 120_000,
  };
  const config = resolveProvider("minimax", {}, minimaxDefaults);
  assert.equal(config.model, "MiniMax-M3-custom");
  assert.equal(config.endpoint, "https://api.minimax-custom.io/anthropic");
  assert.equal(config.keychainService, "forklight.minimax.custom-key");
  assert.equal(config.haikuModel, "MiniMax-M3-haiku");
  // environment reflects configured timeout with the configured key
  const apiKey = "distinctive-api-key-value-for-testing";
  const env = providerEnvironment(config, apiKey);
  assert.equal(env.API_TIMEOUT_MS, "120000");
  assert.equal(env.ANTHROPIC_MODEL, "MiniMax-M3-custom");
  assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "MiniMax-M3-haiku");
  // config never leaks credential values; keychainService is a service name
  const configJson = JSON.stringify(config);
  assert.equal(configJson.includes(apiKey), false);
  assert.ok("keychainService" in config);
});

test("explicit task overrides win over configured provider defaults", () => {
  const minimaxDefaults: ProviderDefaultSettings = {
    defaultModel: "MiniMax-M3-settings",
    defaultEndpoint: "https://settings.example.com",
    defaultKeychainService: "forklight.minimax.settings-key",
    requestTimeoutMs: 60_000,
  };
  const config = resolveProvider(
    "minimax",
    { model: "task-override-model", endpoint: "https://task.example.com" },
    minimaxDefaults,
  );
  assert.equal(config.model, "task-override-model");
  assert.equal(config.endpoint, "https://task.example.com");
  // keychainService not overridden by task → uses settings
  assert.equal(config.keychainService, "forklight.minimax.settings-key");
  // haikuModel falls back to task model when settings and definition both omit it
  assert.equal(config.haikuModel, "task-override-model");
});

const providerDefaultTable: Array<{
  provider: string;
  field: keyof ProviderDefaultSettings;
  configured: string | number;
  verify: (config: ReturnType<typeof resolveProvider>, env: NodeJS.ProcessEnv) => void;
}> = [
  {
    provider: "deepseek",
    field: "defaultModel",
    configured: "deepseek-v4-pro",
    verify: (c, e) => {
      assert.equal(c.model, "deepseek-v4-pro");
      assert.equal(e.ANTHROPIC_MODEL, "deepseek-v4-pro");
    },
  },
  {
    provider: "deepseek",
    field: "defaultEndpoint",
    configured: "https://api.deepseek-custom.example.com",
    verify: (c, e) => {
      assert.equal(c.endpoint, "https://api.deepseek-custom.example.com");
      assert.equal(e.ANTHROPIC_BASE_URL, "https://api.deepseek-custom.example.com");
    },
  },
  {
    provider: "qwen",
    field: "defaultKeychainService",
    configured: "forklight.qwen.custom-key",
    verify: (c) => { assert.equal(c.keychainService, "forklight.qwen.custom-key"); },
  },
  {
    provider: "deepseek",
    field: "defaultHaikuModel",
    configured: "deepseek-haiku-custom",
    verify: (_, e) => { assert.equal(e.ANTHROPIC_DEFAULT_HAIKU_MODEL, "deepseek-haiku-custom"); },
  },
  {
    provider: "glm",
    field: "requestTimeoutMs",
    configured: 300_000,
    verify: (_, e) => { assert.equal(e.API_TIMEOUT_MS, "300000"); },
  },
];

for (const { provider, field, configured, verify } of providerDefaultTable) {
  test(`configured ${provider} ${field} flows through resolution and environment`, () => {
    const defaults: ProviderDefaultSettings = {
      defaultModel: "default-model",
      defaultEndpoint: "https://default.example.com",
      defaultKeychainService: "forklight.default-key",
      requestTimeoutMs: 999_000,
      ...{ [field]: configured },
    };
    const config = resolveProvider(provider as "deepseek" | "qwen" | "minimax" | "glm", {}, defaults);
    const env = providerEnvironment(config, "test-key");
    assert.equal(JSON.stringify(config).includes("test-key"), false);
    verify(config, env);
  });
}

// --- providerReadiness with effective defaults ---

test("providerReadiness with built-in defaults checks keychain presence without credentials", () => {
  const readiness = providerReadiness();
  assert.equal(typeof readiness.anyReady, "boolean");
  for (const name of providerNames()) {
    const provider = readiness.providers[name];
    assert.ok(provider, `missing readiness entry for ${name}`);
    assert.equal(typeof provider.ready, "boolean");
    assert.equal(typeof provider.defaultModel, "string");
    assert.equal(typeof provider.endpoint, "string");
    assert.equal(typeof provider.keychainService, "string");
    // Never leaks credential values.
    const serialized = JSON.stringify(provider);
    assert.equal(serialized.includes("password"), false);
    assert.equal(serialized.includes("apiKey"), false);
    assert.equal(serialized.includes("secret"), false);
    assert.equal(serialized.includes("token"), false);
    if (!provider.ready) assert.equal(provider.error, "Keychain entry not found");
  }
});

test("providerReadiness reflects non-built-in Provider defaults", () => {
  const defaults = cloneDefaults();
  const customDefaults = JSON.parse(JSON.stringify(defaults.providerDefaults)) as typeof defaults.providerDefaults;
  customDefaults.deepseek.defaultModel = "deepseek-v4-pro";
  customDefaults.deepseek.defaultEndpoint = "https://custom.example.com/anthropic";
  customDefaults.deepseek.defaultKeychainService = "forklight.deepseek.custom-key";
  const readiness = providerReadiness(customDefaults);
  const ds = readiness.providers.deepseek;
  assert.equal(ds.defaultModel, "deepseek-v4-pro");
  assert.equal(ds.endpoint, "https://custom.example.com/anthropic");
  assert.equal(ds.keychainService, "forklight.deepseek.custom-key");
});

test("providerReadiness with custom defaults never leaks keychain account or credential", () => {
  const defaults = cloneDefaults();
  const customDefaults = JSON.parse(JSON.stringify(defaults.providerDefaults)) as typeof defaults.providerDefaults;
  customDefaults.deepseek.defaultKeychainService = "forklight.deepseek.api-key";
  customDefaults.deepseek.defaultModel = "deepseek-v4-pro";
  const readiness = providerReadiness(customDefaults);
  const serialized = JSON.stringify(readiness);
  assert.equal(serialized.includes("password"), false);
  assert.equal(serialized.includes("secret"), false);
  assert.equal(serialized.includes("apiKey"), false);
  assert.equal(serialized.includes("credential"), false);
});
