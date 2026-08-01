import { lstat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { ModelConfig, ModelSupportedEffort } from "./model-catalog.js";

export const CODEX_MODEL_CATALOG_MAX_BYTES = 4 * 1024 * 1024;
export const CODEX_MODEL_CATALOG_MAX_MODELS = 64;

const SAFE_EFFORTS = new Set<ModelSupportedEffort>([
  "low", "medium", "high", "xhigh", "max",
]);
const MODEL_PATTERN = /^[A-Za-z0-9._+:/\[\]-]{1,128}$/;

export interface CodexModelCatalogEntry {
  model: string;
  label: string;
  supportedEfforts: ModelSupportedEffort[];
  defaultEffort?: ModelSupportedEffort;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Convert Codex's local cache into a detached allowlist. Instructions,
 * descriptions, account data, timestamps, cache headers, and unknown fields
 * are deliberately discarded.
 */
export function projectCodexModelCatalog(raw: unknown): CodexModelCatalogEntry[] {
  const root = object(raw, "Codex model catalog");
  if (!Array.isArray(root.models)) {
    throw new Error("Codex model catalog.models must be an array");
  }
  if (root.models.length > CODEX_MODEL_CATALOG_MAX_MODELS) {
    throw new Error(`Codex model catalog supports at most ${CODEX_MODEL_CATALOG_MAX_MODELS} entries`);
  }

  const projected: CodexModelCatalogEntry[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < root.models.length; index += 1) {
    const model = object(root.models[index], `Codex model catalog.models[${index}]`);
    if (model.visibility !== "list") continue;
    if (typeof model.slug !== "string" || !MODEL_PATTERN.test(model.slug)) {
      throw new Error(`Codex model catalog.models[${index}].slug is invalid`);
    }
    if (seen.has(model.slug)) throw new Error(`Codex model catalog contains duplicate ${model.slug}`);
    if (
      typeof model.display_name !== "string"
      || model.display_name.trim().length < 1
      || model.display_name.length > 80
    ) {
      throw new Error(`Codex model catalog.models[${index}].display_name is invalid`);
    }
    if (!Array.isArray(model.supported_reasoning_levels)) {
      throw new Error(
        `Codex model catalog.models[${index}].supported_reasoning_levels must be an array`,
      );
    }
    const efforts: ModelSupportedEffort[] = [];
    const effortSeen = new Set<string>();
    for (let effortIndex = 0; effortIndex < model.supported_reasoning_levels.length; effortIndex += 1) {
      const level = object(
        model.supported_reasoning_levels[effortIndex],
        `Codex model catalog.models[${index}].supported_reasoning_levels[${effortIndex}]`,
      );
      if (typeof level.effort !== "string") {
        throw new Error(`Codex model catalog.models[${index}] has an invalid effort`);
      }
      // `ultra` and future unknown levels remain unavailable until ForkLight
      // can account for their execution behavior.
      if (!SAFE_EFFORTS.has(level.effort as ModelSupportedEffort)) continue;
      if (effortSeen.has(level.effort)) {
        throw new Error(`Codex model catalog.models[${index}] contains duplicate effort ${level.effort}`);
      }
      effortSeen.add(level.effort);
      efforts.push(level.effort as ModelSupportedEffort);
    }
    if (efforts.length < 1) {
      throw new Error(`Codex model ${model.slug} exposes no ForkLight-supported effort`);
    }
    const defaultEffort = typeof model.default_reasoning_level === "string"
      && SAFE_EFFORTS.has(model.default_reasoning_level as ModelSupportedEffort)
      && efforts.includes(model.default_reasoning_level as ModelSupportedEffort)
      ? model.default_reasoning_level as ModelSupportedEffort
      : undefined;
    seen.add(model.slug);
    projected.push({
      model: model.slug,
      label: model.display_name.trim(),
      supportedEfforts: [...efforts],
      ...(defaultEffort === undefined ? {} : { defaultEffort }),
    });
  }
  if (projected.length < 1) throw new Error("Codex model catalog has no visible supported models");
  return projected;
}

export function codexModelConfigFromEntry(entry: CodexModelCatalogEntry): ModelConfig {
  const safeId = `codex-${entry.model.toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`
    .replace(/-+/g, "-")
    .slice(0, 64)
    .replace(/-$/, "");
  return {
    id: safeId,
    label: entry.label,
    provider: "openai",
    model: entry.model,
    endpoint: "https://api.openai.com/v1",
    supportedEfforts: [...entry.supportedEfforts],
  };
}

export async function loadLocalCodexModelCatalog(
  codexHome = path.join(homedir(), ".codex"),
): Promise<CodexModelCatalogEntry[]> {
  const catalogPath = path.join(codexHome, "models_cache.json");
  const metadata = await lstat(catalogPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Codex model catalog must be a regular file");
  }
  if (metadata.size <= 0 || metadata.size > CODEX_MODEL_CATALOG_MAX_BYTES) {
    throw new Error(`Codex model catalog must be 1-${CODEX_MODEL_CATALOG_MAX_BYTES} bytes`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(catalogPath, "utf8"));
  } catch {
    throw new Error("Codex model catalog is not valid JSON");
  }
  return projectCodexModelCatalog(raw);
}
