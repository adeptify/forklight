/**
 * Pure Hub settings helpers — testable without HTTP/UI.
 * Keys never leave Keychain; this only patches settings documents.
 */

import {
  assertProviderRuntimePair,
  isRuntimeName,
  type RuntimeName,
} from "../core/runtime-names.js";
import { isProviderName, type ProviderName } from "../core/providers.js";
import type { ForkLightSettings } from "../core/settings.js";

export interface HubSettingsView {
  defaultProvider: ProviderName;
  defaultRuntime: RuntimeName;
  defaultMaxBudgetUsd: number | null;
  maximumBudgetUsd: number;
  maxConcurrency: number;
  noProgressTimeoutMs: number;
  defaultEffort: ForkLightSettings["execution"]["defaultEffort"];
  /** Effective default model/endpoint for the selected default provider. */
  defaultModel: string;
  defaultEndpoint: string;
  /** Evidence-aware model routing advisory settings. */
  modelRouting: ForkLightSettings["modelRouting"];
  /** Reusable Delivery Profile registry (profiles, project bindings, default). */
  deliveryProfiles: ForkLightSettings["deliveryProfiles"];
}

export interface HubSettingsPatch {
  defaultProvider?: string;
  defaultRuntime?: string;
  defaultMaxBudgetUsd?: number | null;
  maximumBudgetUsd?: number;
  maxConcurrency?: number;
  noProgressTimeoutMs?: number;
  defaultEffort?: string;
  /** When set with defaultProvider (or current), updates that provider's defaults. */
  defaultModel?: string;
  defaultEndpoint?: string;
  /** Bounded modelRouting policy patch. Weights can be partially provided. */
  modelRouting?: {
    minRelevantSamples?: number;
    uncertaintyThreshold?: number;
    competitionOnUncertainty?: boolean;
    missingEvidenceMode?: "strict" | "flexible";
    weights?: {
      acceptedDelivery?: number;
      verifiedBehavior?: number;
      modelQualityFailure?: number;
      correctionChurn?: number;
      officialCost?: number;
      duration?: number;
      budgetReliability?: number;
    };
  };
  /** Complete Delivery Profile registry replacement. Validated atomically;
   *  invalid profiles, references, paths, or unknown fields reject the whole update. */
  deliveryProfiles?: Record<string, unknown>;
}

export interface HubModelRoutingView {
  minRelevantSamples: number;
  uncertaintyThreshold: number;
  competitionOnUncertainty: boolean;
  missingEvidenceMode: "strict" | "flexible";
  weights: {
    acceptedDelivery: number;
    verifiedBehavior: number;
    modelQualityFailure: number;
    correctionChurn: number;
    officialCost: number;
    duration: number;
    budgetReliability: number;
  };
}

const MODEL_PATTERN = /^[A-Za-z0-9._+:/\[\]-]{1,128}$/;
const ENDPOINT_PATTERN = /^https:\/\/[^\s]{4,512}$/;

export function viewHubSettings(settings: ForkLightSettings): HubSettingsView {
  const provider = settings.execution.defaultProvider;
  const pd = settings.providerDefaults[provider];
  return {
    defaultProvider: provider,
    defaultRuntime: settings.execution.defaultRuntime,
    defaultMaxBudgetUsd: settings.execution.defaultMaxBudgetUsd,
    maximumBudgetUsd: settings.execution.maximumBudgetUsd,
    maxConcurrency: settings.execution.maxConcurrency,
    noProgressTimeoutMs: settings.execution.noProgressTimeoutMs,
    defaultEffort: settings.execution.defaultEffort,
    defaultModel: pd.defaultModel,
    defaultEndpoint: pd.defaultEndpoint,
    modelRouting: viewModelRoutingSettings(settings),
    deliveryProfiles: settings.deliveryProfiles,
  };
}

/** Project only the flexible modelRouting policy, no secrets or hard invariants. */
export function viewModelRoutingSettings(settings: ForkLightSettings): HubModelRoutingView {
  return {
    minRelevantSamples: settings.modelRouting.minRelevantSamples,
    uncertaintyThreshold: settings.modelRouting.uncertaintyThreshold,
    competitionOnUncertainty: settings.modelRouting.competitionOnUncertainty,
    missingEvidenceMode: settings.modelRouting.missingEvidenceMode,
    weights: { ...settings.modelRouting.weights },
  };
}

/**
 * Build a settings.update patch for Hub fields with fail-closed pairing.
 * Throws Error with a user-facing message on invalid input.
 * When modelRouting is included, validates and returns it as a separate section.
 */
export function buildHubSettingsPatch(
  current: ForkLightSettings,
  patch: HubSettingsPatch,
): {
  execution: Record<string, unknown>;
  providerDefaults?: Record<string, Record<string, unknown>>;
  modelRouting?: Record<string, unknown>;
  deliveryProfiles?: Record<string, unknown>;
} {
  const nextProvider = patch.defaultProvider ?? current.execution.defaultProvider;
  const nextRuntime = patch.defaultRuntime ?? current.execution.defaultRuntime;

  if (typeof nextProvider !== "string" || !isProviderName(nextProvider)) {
    throw new Error(`Unsupported provider: ${String(nextProvider)}`);
  }
  if (typeof nextRuntime !== "string" || !isRuntimeName(nextRuntime)) {
    throw new Error(`Unsupported runtime: ${String(nextRuntime)}`);
  }
  assertProviderRuntimePair(nextProvider, nextRuntime);

  const execution: Record<string, unknown> = {
    defaultProvider: nextProvider,
    defaultRuntime: nextRuntime,
  };

  let providerDefaults: Record<string, Record<string, unknown>> | undefined;
  if (patch.defaultModel !== undefined || patch.defaultEndpoint !== undefined) {
    const currentPd = current.providerDefaults[nextProvider as ProviderName];
    const model = patch.defaultModel ?? currentPd.defaultModel;
    const endpoint = patch.defaultEndpoint ?? currentPd.defaultEndpoint;
    if (typeof model !== "string" || !MODEL_PATTERN.test(model)) {
      throw new Error("defaultModel contains unsupported characters");
    }
    if (typeof endpoint !== "string" || !ENDPOINT_PATTERN.test(endpoint)) {
      throw new Error("defaultEndpoint must be an https URL");
    }
    providerDefaults = {
      [nextProvider]: {
        defaultModel: model,
        defaultEndpoint: endpoint,
        defaultKeychainService: currentPd.defaultKeychainService,
      },
    };
  }

  if (patch.defaultMaxBudgetUsd !== undefined) {
    if (patch.defaultMaxBudgetUsd !== null) {
      if (typeof patch.defaultMaxBudgetUsd !== "number"
        || !Number.isFinite(patch.defaultMaxBudgetUsd)
        || patch.defaultMaxBudgetUsd <= 0) {
        throw new Error("defaultMaxBudgetUsd must be a positive number or null");
      }
    }
    execution.defaultMaxBudgetUsd = patch.defaultMaxBudgetUsd;
  }

  if (patch.maximumBudgetUsd !== undefined) {
    if (typeof patch.maximumBudgetUsd !== "number"
      || !Number.isFinite(patch.maximumBudgetUsd)
      || patch.maximumBudgetUsd <= 0) {
      throw new Error("maximumBudgetUsd must be a positive number");
    }
    execution.maximumBudgetUsd = patch.maximumBudgetUsd;
  }

  if (patch.maxConcurrency !== undefined) {
    if (!Number.isInteger(patch.maxConcurrency) || patch.maxConcurrency < 1) {
      throw new Error("maxConcurrency must be an integer >= 1");
    }
    execution.maxConcurrency = patch.maxConcurrency;
  }

  if (patch.noProgressTimeoutMs !== undefined) {
    if (!Number.isInteger(patch.noProgressTimeoutMs) || patch.noProgressTimeoutMs < 1000) {
      throw new Error("noProgressTimeoutMs must be an integer >= 1000");
    }
    execution.noProgressTimeoutMs = patch.noProgressTimeoutMs;
  }

  if (patch.defaultEffort !== undefined) {
    const efforts = new Set(["low", "medium", "high", "xhigh", "max"]);
    if (!efforts.has(patch.defaultEffort)) {
      throw new Error("defaultEffort must be low|medium|high|xhigh|max");
    }
    execution.defaultEffort = patch.defaultEffort;
  }

  const defaultBudget = execution.defaultMaxBudgetUsd !== undefined
    ? execution.defaultMaxBudgetUsd as number | null
    : current.execution.defaultMaxBudgetUsd;
  const maximum = execution.maximumBudgetUsd !== undefined
    ? execution.maximumBudgetUsd as number
    : current.execution.maximumBudgetUsd;
  if (defaultBudget !== null && typeof defaultBudget === "number" && defaultBudget > maximum) {
    throw new Error("defaultMaxBudgetUsd must not exceed maximumBudgetUsd");
  }

  let modelRouting: Record<string, unknown> | undefined;
  if (patch.modelRouting !== undefined) {
    modelRouting = buildModelRoutingPatch(patch.modelRouting);
  }

  let deliveryProfiles: Record<string, unknown> | undefined;
  if (patch.deliveryProfiles !== undefined) {
    if (patch.deliveryProfiles === null || typeof patch.deliveryProfiles !== "object" || Array.isArray(patch.deliveryProfiles)) {
      throw new Error("deliveryProfiles must be an object");
    }
    // Validation is deferred to SettingsService.update which calls the canonical
    // validateDeliveryProfilesSettings. No duplicated validation here.
    deliveryProfiles = structuredClone(patch.deliveryProfiles) as Record<string, unknown>;
  }

  const base: {
    execution: Record<string, unknown>;
    providerDefaults?: Record<string, Record<string, unknown>>;
    modelRouting?: Record<string, unknown>;
    deliveryProfiles?: Record<string, unknown>;
  } = { execution };
  if (providerDefaults !== undefined) base.providerDefaults = providerDefaults;
  if (modelRouting !== undefined) base.modelRouting = modelRouting;
  if (deliveryProfiles !== undefined) base.deliveryProfiles = deliveryProfiles;
  return base;
}

/**
 * Preserve the bounded Hub object for SettingsService, which is the single
 * authority for model-routing field names, value ranges and deep-merge rules.
 * This layer checks only the transport shape; duplicating canonical bounds
 * here would let Hub validation drift from CLI/MCP settings validation.
 */
export function buildModelRoutingPatch(
  patch: unknown,
): Record<string, unknown> {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("modelRouting must be an object");
  }
  return structuredClone(patch as Record<string, unknown>);
}
