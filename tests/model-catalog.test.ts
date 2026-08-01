import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  codexModelConfigFromEntry,
  loadLocalCodexModelCatalog,
  projectCodexModelCatalog,
} from "../src/core/codex-model-catalog.js";
import { validateModelConfig } from "../src/core/model-catalog.js";

function catalog(overrides: Record<string, unknown> = {}): unknown {
  return {
    client_version: "0.146.0",
    account: { mustNotLeak: true },
    models: [{
      slug: "gpt-5.6-luna",
      display_name: "GPT-5.6-Luna",
      visibility: "list",
      base_instructions: "private instructions",
      supported_reasoning_levels: [
        { effort: "low", description: "private detail" },
        { effort: "high", description: "private detail" },
        { effort: "max", description: "private detail" },
        { effort: "ultra", description: "delegates automatically" },
      ],
      default_reasoning_level: "high",
    }],
    ...overrides,
  };
}

test("Codex catalog projection keeps only visible identity and safe efforts", () => {
  const projected = projectCodexModelCatalog(catalog());
  assert.deepEqual(projected, [{
    model: "gpt-5.6-luna",
    label: "GPT-5.6-Luna",
    supportedEfforts: ["low", "high", "max"],
    defaultEffort: "high",
  }]);
  const serialized = JSON.stringify(projected);
  assert.ok(!serialized.includes("base_instructions"));
  assert.ok(!serialized.includes("account"));
  assert.ok(!serialized.includes("description"));
  assert.ok(!serialized.includes("ultra"));

  const config = codexModelConfigFromEntry(projected[0]!);
  assert.equal(config.id, "codex-gpt-5-6-luna");
  assert.doesNotThrow(() => validateModelConfig(config));
});

test("Codex catalog projection rejects malformed and duplicate identity", () => {
  assert.throws(() => projectCodexModelCatalog({}), /models must be an array/);
  assert.throws(() => projectCodexModelCatalog(catalog({
    models: [
      {
        slug: "gpt-5.6-luna", display_name: "Luna", visibility: "list",
        supported_reasoning_levels: [{ effort: "low" }],
      },
      {
        slug: "gpt-5.6-luna", display_name: "Luna 2", visibility: "list",
        supported_reasoning_levels: [{ effort: "high" }],
      },
    ],
  })), /duplicate/);
  assert.throws(() => projectCodexModelCatalog(catalog({
    models: [{
      slug: "gpt-5.6-luna", display_name: "Luna", visibility: "list",
      supported_reasoning_levels: [{ effort: "ultra" }],
    }],
  })), /no ForkLight-supported effort/);
});

test("local Codex catalog loader rejects symlinks and returns a detached projection", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-codex-catalog-"));
  const home = path.join(root, "home");
  await mkdir(home, { recursive: true });
  await writeFile(path.join(home, "models_cache.json"), JSON.stringify(catalog()));
  const projected = await loadLocalCodexModelCatalog(home);
  assert.equal(projected[0]?.model, "gpt-5.6-luna");

  const target = path.join(root, "target.json");
  await writeFile(target, JSON.stringify(catalog()));
  const linkedHome = path.join(root, "linked");
  await mkdir(linkedHome);
  await symlink(target, path.join(linkedHome, "models_cache.json"));
  await assert.rejects(() => loadLocalCodexModelCatalog(linkedHome), /regular file/);
});

test("model config supportedEfforts rejects ultra and duplicates", () => {
  assert.throws(() => validateModelConfig({
    id: "codex-ultra",
    label: "Codex Ultra",
    provider: "openai",
    model: "gpt-5.6-luna",
    supportedEfforts: ["ultra"],
  }), /supportedEfforts/);
  assert.throws(() => validateModelConfig({
    id: "codex-duplicate",
    label: "Codex Duplicate",
    provider: "openai",
    model: "gpt-5.6-luna",
    supportedEfforts: ["high", "high"],
  }), /duplicate/);
});
