/**
 * Named model configs — reusable by Worker profiles.
 * Pure helpers; no I/O. Provider keys stay in Keychain (not in this catalog).
 */

import { isProviderName, type ProviderName } from "./providers.js";
import type { ProviderDefaultsSettings } from "./settings.js";

const ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const MODEL_PATTERN = /^[A-Za-z0-9._+:/\[\]-]{1,128}$/;
const ENDPOINT_PATTERN = /^https:\/\/[^\s]{4,512}$/;

export interface ModelConfig {
  id: string;
  label: string;
  provider: ProviderName;
  model: string;
  /** Optional endpoint override; omit → providerDefaults for that provider. */
  endpoint?: string;
}

export interface ModelCatalogSettings {
  models: ModelConfig[];
}

export function isModelConfigId(value: string): boolean {
  return ID_PATTERN.test(value);
}

export function defaultModelCatalog(
  providerDefaults: ProviderDefaultsSettings,
  _defaultProvider: ProviderName = "deepseek",
): ModelCatalogSettings {
  return {
    models: [
      {
        id: "deepseek-flash",
        label: "DeepSeek Flash",
        provider: "deepseek",
        model: providerDefaults.deepseek.defaultModel,
        endpoint: providerDefaults.deepseek.defaultEndpoint,
      },
      {
        id: "qwen-plus",
        label: "Qwen Plus",
        provider: "qwen",
        model: providerDefaults.qwen.defaultModel,
        endpoint: providerDefaults.qwen.defaultEndpoint,
      },
      {
        id: "xai-grok",
        label: "xAI Grok",
        provider: "xai",
        model: providerDefaults.xai.defaultModel,
        endpoint: providerDefaults.xai.defaultEndpoint,
      },
    ],
  };
}

export function validateModelConfig(raw: unknown, label = "modelConfig"): ModelConfig {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label} must be an object`);
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !isModelConfigId(o.id)) {
    throw new Error(`${label}.id must match ${ID_PATTERN}`);
  }
  if (typeof o.label !== "string" || o.label.trim().length < 1 || o.label.length > 80) {
    throw new Error(`${label}.label must be a non-empty string ≤ 80 chars`);
  }
  if (typeof o.provider !== "string" || !isProviderName(o.provider)) {
    throw new Error(`${label}.provider is unsupported`);
  }
  if (typeof o.model !== "string" || !MODEL_PATTERN.test(o.model)) {
    throw new Error(`${label}.model contains unsupported characters`);
  }
  let endpoint: string | undefined;
  if (o.endpoint !== undefined) {
    if (typeof o.endpoint !== "string" || !ENDPOINT_PATTERN.test(o.endpoint)) {
      throw new Error(`${label}.endpoint must be an https URL`);
    }
    endpoint = o.endpoint;
  }
  return {
    id: o.id,
    label: o.label.trim(),
    provider: o.provider,
    model: o.model,
    ...(endpoint === undefined ? {} : { endpoint }),
  };
}

export function validateModelCatalogSettings(
  raw: unknown,
  label = "modelCatalog",
): ModelCatalogSettings {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label} must be an object`);
  }
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.models) || o.models.length < 1) {
    throw new Error(`${label}.models must be a non-empty array`);
  }
  if (o.models.length > 64) {
    throw new Error(`${label}.models supports at most 64 entries`);
  }
  const models = o.models.map((m, i) => validateModelConfig(m, `${label}.models[${i}]`));
  const ids = new Set<string>();
  for (const m of models) {
    if (ids.has(m.id)) throw new Error(`${label}: duplicate model id ${m.id}`);
    ids.add(m.id);
  }
  return { models };
}

export function getModelConfig(catalog: ModelCatalogSettings, id: string): ModelConfig {
  const found = catalog.models.find((m) => m.id === id);
  if (!found) throw new Error(`Unknown model config: ${id}`);
  return found;
}

export function upsertModelConfig(
  current: ModelCatalogSettings,
  config: ModelConfig,
): ModelCatalogSettings {
  const validated = validateModelConfig(config);
  const others = current.models.filter((m) => m.id !== validated.id);
  return validateModelCatalogSettings({ models: [...others, validated] });
}

export function removeModelConfig(
  current: ModelCatalogSettings,
  id: string,
  /** Worker profile ids that still reference this model (from workerIdsUsingModel). */
  referencedByWorkerIds: string[] = [],
): ModelCatalogSettings {
  if (current.models.length <= 1) {
    throw new Error("Cannot remove the last model config");
  }
  if (referencedByWorkerIds.length > 0) {
    throw new Error(
      `Model ${id} is used by worker profile(s): ${referencedByWorkerIds.join(", ")}`,
    );
  }
  const models = current.models.filter((m) => m.id !== id);
  if (models.length === current.models.length) {
    throw new Error(`Unknown model config: ${id}`);
  }
  return validateModelCatalogSettings({ models });
}

/** Resolve endpoint from model config or provider defaults. */
export function resolveModelEndpoint(
  config: ModelConfig,
  providerDefaults: ProviderDefaultsSettings,
): string {
  return config.endpoint ?? providerDefaults[config.provider].defaultEndpoint;
}
