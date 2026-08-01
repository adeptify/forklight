/**
 * Named Worker profiles — Worker-granular runtime + model + limits.
 * Models live in model-catalog; Workers pick a modelConfigId and own their limits.
 * Pure helpers; no I/O. Pairing fail-closed via assertProviderRuntimePair.
 */

import {
  assertProviderRuntimePair,
  isRuntimeName,
  type RuntimeName,
} from "./runtime-names.js";
import { isProviderName, type ProviderName } from "./providers.js";
import type { EffortLevel, ForkLightSettings, ProviderDefaultsSettings } from "./settings.js";
import {
  getModelConfig,
  isModelConfigId,
  resolveModelEndpoint,
  type ModelCatalogSettings,
} from "./model-catalog.js";
import type {
  AdvancedPolicyFields,
  ContractQualityOverrides,
  PolicyMode,
} from "./types.js";
import {
  validateAdvancedPolicyPatch as validateAdvancedPolicyRaw,
} from "./advanced-policy.js";

const PROFILE_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const MODEL_PATTERN = /^[A-Za-z0-9._+:/\[\]-]{1,128}$/;
const ENDPOINT_PATTERN = /^https:\/\/[^\s]{4,512}$/;
const ROUTE_PATTERN = /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/;
const EFFORTS = new Set<string>(["low", "medium", "high", "xhigh", "max"]);
const QUALITY_MODES = new Set<string>(["hard", "warn", "score", "off"]);
const QUALITY_MAX_FIELDS = new Set<string>(["maxFiles", "maxDiffLines", "maxFocusPaths"]);
const QUALITY_MIN_FIELDS = new Set<string>([
  "minScenarios",
  "minCallChainSteps",
  "minOutcomeCharacters",
  "minModuleResponsibilityCharacters",
]);

export interface WorkerProfile {
  id: string;
  label: string;
  runtime: RuntimeName;
  /** Preferred: select from model catalog. */
  modelConfigId?: string;
  /**
   * Legacy / denormalized provider+model when modelConfigId is absent.
   * When modelConfigId is set these may still be present as a cache for display.
   */
  provider?: ProviderName;
  model?: string;
  endpoint?: string;
  effort?: EffortLevel;
  /** Soft per-task budget for this Worker (null = unlimited soft default). */
  maxBudgetUsd?: number | null;
  /** Legacy top-level no-progress timeout. Superseded by advancedPolicy.noProgressTimeoutMs when set.
   *  Kept for backward-compatible reading of stored profiles. */
  noProgressTimeoutMs?: number;
  /** Per-Worker advanced execution policy. Permissive-by-default: duration and Token ceilings
   *  are unlimited unless explicitly set. */
  advancedPolicy?: Partial<AdvancedPolicyFields>;
  /** Per-Worker Task Contract Quality override. It cannot contain Safety or
   * authority settings. */
  contractQuality?: ContractQualityOverrides;
  /** Optional billing-route identifier for official pricing resolution.
   *  Bounded non-empty identifier; never a credential. Explicit Task/MCP override wins. */
  pricingRoute?: string;
}

export interface WorkerProfilesSettings {
  defaultProfileId: string;
  profiles: WorkerProfile[];
}

export interface ResolvedWorkerSelection {
  profileId: string | undefined;
  modelConfigId: string | undefined;
  runtime: RuntimeName;
  provider: ProviderName;
  model: string;
  endpoint: string;
  effort: EffortLevel;
  keychainService: string;
  /** Soft budget from worker profile when set; else execution.defaultMaxBudgetUsd. */
  maxBudgetUsd: number | null;
  noProgressTimeoutMs: number;
  /** Resolved billing route. Explicit Task/MCP override wins;
   *  otherwise inherited from the selected Worker profile. */
  pricingRoute?: string;
}

export function isWorkerProfileId(value: string): boolean {
  return PROFILE_ID_PATTERN.test(value);
}

export function isPricingRouteId(value: unknown): value is string {
  return typeof value === "string" && ROUTE_PATTERN.test(value);
}

export function defaultWorkerProfiles(
  execution: ForkLightSettings["execution"],
  providerDefaults: ProviderDefaultsSettings,
  modelCatalog?: ModelCatalogSettings,
): WorkerProfilesSettings {
  const preferred = modelCatalog?.models.find((m) => m.provider === execution.defaultProvider)
    ?? modelCatalog?.models[0];
  const provider = preferred?.provider ?? execution.defaultProvider;
  const pd = providerDefaults[provider];
  const id = "default";
  return {
    defaultProfileId: id,
    profiles: [
      {
        id,
        label: "Default Worker",
        runtime: execution.defaultRuntime,
        ...(preferred === undefined
          ? {
              provider,
              model: pd.defaultModel,
              endpoint: pd.defaultEndpoint,
            }
          : {
              modelConfigId: preferred.id,
              provider: preferred.provider,
              model: preferred.model,
              ...(preferred.endpoint === undefined ? {} : { endpoint: preferred.endpoint }),
            }),
        effort: execution.defaultEffort,
        // maxBudgetUsd / noProgressTimeoutMs omitted → inherit execution defaults
      },
    ],
  };
}

function parseOptionalBudget(
  raw: unknown,
  label: string,
): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    throw new Error(`${label} must be a positive number or null`);
  }
  return raw;
}

export function validateContractQualityOverride(
  raw: unknown,
  label = "contractQuality",
): ContractQualityOverrides {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label} must be an object`);
  }
  const input = raw as Record<string, unknown>;
  const result: ContractQualityOverrides = {};
  for (const [field, value] of Object.entries(input)) {
    if (field === "mode") {
      if (typeof value !== "string" || !QUALITY_MODES.has(value)) {
        throw new Error(`${label}.mode must be hard, warn, score, or off`);
      }
      result.mode = value as PolicyMode;
      continue;
    }
    if (QUALITY_MAX_FIELDS.has(field)) {
      if (value !== null && (
        typeof value !== "number"
        || !Number.isFinite(value)
        || !Number.isInteger(value)
        || value <= 0
      )) {
        throw new Error(`${label}.${field} must be null or a positive integer`);
      }
      (result as Record<string, unknown>)[field] = value;
      continue;
    }
    if (QUALITY_MIN_FIELDS.has(field)) {
      if (
        typeof value !== "number"
        || !Number.isFinite(value)
        || !Number.isInteger(value)
        || value < 0
      ) {
        throw new Error(`${label}.${field} must be a non-negative integer`);
      }
      (result as Record<string, unknown>)[field] = value;
      continue;
    }
    throw new Error(`${label}.${field} is not a recognized contract-quality field`);
  }
  return result;
}

/**
 * Validate a worker profile. When catalog is provided, modelConfigId is resolved
 * and provider×runtime pairing is checked against the catalog model.
 */
export function validateWorkerProfile(
  raw: unknown,
  label = "workerProfile",
  catalog?: ModelCatalogSettings,
): WorkerProfile {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label} must be an object`);
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !isWorkerProfileId(o.id)) {
    throw new Error(`${label}.id must match ${PROFILE_ID_PATTERN}`);
  }
  if (typeof o.label !== "string" || o.label.trim().length < 1 || o.label.length > 80) {
    throw new Error(`${label}.label must be a non-empty string ≤ 80 chars`);
  }
  if (typeof o.runtime !== "string" || !isRuntimeName(o.runtime)) {
    throw new Error(`${label}.runtime is unsupported`);
  }

  let modelConfigId: string | undefined;
  let supportedEfforts: readonly string[] | undefined;
  let provider: ProviderName | undefined;
  let model: string | undefined;
  let endpoint: string | undefined;

  if (o.modelConfigId !== undefined) {
    if (typeof o.modelConfigId !== "string" || !isModelConfigId(o.modelConfigId)) {
      throw new Error(`${label}.modelConfigId is invalid`);
    }
    modelConfigId = o.modelConfigId;
    if (catalog) {
      const mc = getModelConfig(catalog, modelConfigId);
      provider = mc.provider;
      model = mc.model;
      endpoint = mc.endpoint;
      supportedEfforts = mc.supportedEfforts;
    }
  }

  if (o.provider !== undefined) {
    if (typeof o.provider !== "string" || !isProviderName(o.provider)) {
      throw new Error(`${label}.provider is unsupported`);
    }
    provider = o.provider;
  }
  if (o.model !== undefined) {
    if (typeof o.model !== "string" || !MODEL_PATTERN.test(o.model)) {
      throw new Error(`${label}.model contains unsupported characters`);
    }
    model = o.model;
  }
  if (o.endpoint !== undefined) {
    if (typeof o.endpoint !== "string" || !ENDPOINT_PATTERN.test(o.endpoint)) {
      throw new Error(`${label}.endpoint must be an https URL`);
    }
    endpoint = o.endpoint;
  }

  if (modelConfigId === undefined && (provider === undefined || model === undefined)) {
    throw new Error(`${label} requires modelConfigId or provider+model`);
  }

  if (provider !== undefined) {
    assertProviderRuntimePair(provider, o.runtime);
  }

  let effort: EffortLevel | undefined;
  if (o.effort !== undefined) {
    if (typeof o.effort !== "string" || !EFFORTS.has(o.effort)) {
      throw new Error(`${label}.effort must be low|medium|high|xhigh|max`);
    }
    effort = o.effort as EffortLevel;
    if (supportedEfforts !== undefined && !supportedEfforts.includes(effort)) {
      throw new Error(
        `${label}.effort=${effort} is not supported by model config ${modelConfigId}; supported: ${supportedEfforts.join("|")}`,
      );
    }
  }

  const maxBudgetUsd = parseOptionalBudget(o.maxBudgetUsd, `${label}.maxBudgetUsd`);
  let noProgressTimeoutMs: number | undefined;
  if (o.noProgressTimeoutMs !== undefined) {
    if (!Number.isInteger(o.noProgressTimeoutMs) || (o.noProgressTimeoutMs as number) < 1000) {
      throw new Error(`${label}.noProgressTimeoutMs must be an integer >= 1000`);
    }
    noProgressTimeoutMs = o.noProgressTimeoutMs as number;
  }

  let advancedPolicy: Partial<AdvancedPolicyFields> | undefined;
  if (o.advancedPolicy !== undefined) {
    advancedPolicy = validateAdvancedPolicyRaw(o.advancedPolicy, `${label}.advancedPolicy`);
  }

  let contractQuality: ContractQualityOverrides | undefined;
  if (o.contractQuality !== undefined) {
    contractQuality = validateContractQualityOverride(
      o.contractQuality,
      `${label}.contractQuality`,
    );
  }

  let pricingRoute: string | undefined;
  if (o.pricingRoute !== undefined) {
    if (!isPricingRouteId(o.pricingRoute)) {
      throw new Error(`${label}.pricingRoute must be a bounded non-empty identifier`);
    }
    pricingRoute = o.pricingRoute;
  }

  return {
    id: o.id,
    label: o.label.trim(),
    runtime: o.runtime,
    ...(modelConfigId === undefined ? {} : { modelConfigId }),
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    ...(endpoint === undefined ? {} : { endpoint }),
    ...(effort === undefined ? {} : { effort }),
    ...(maxBudgetUsd === undefined ? {} : { maxBudgetUsd }),
    ...(noProgressTimeoutMs === undefined ? {} : { noProgressTimeoutMs }),
    ...(advancedPolicy === undefined ? {} : { advancedPolicy }),
    ...(contractQuality === undefined ? {} : { contractQuality }),
    ...(pricingRoute === undefined ? {} : { pricingRoute }),
  };
}

export function validateWorkerProfilesSettings(
  raw: unknown,
  label = "workerProfiles",
  catalog?: ModelCatalogSettings,
): WorkerProfilesSettings {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label} must be an object`);
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.defaultProfileId !== "string" || !isWorkerProfileId(o.defaultProfileId)) {
    throw new Error(`${label}.defaultProfileId is invalid`);
  }
  if (!Array.isArray(o.profiles) || o.profiles.length < 1) {
    throw new Error(`${label}.profiles must be a non-empty array`);
  }
  if (o.profiles.length > 32) {
    throw new Error(`${label}.profiles supports at most 32 entries`);
  }
  const profiles = o.profiles.map((p, i) =>
    validateWorkerProfile(p, `${label}.profiles[${i}]`, catalog));
  const ids = new Set<string>();
  for (const p of profiles) {
    if (ids.has(p.id)) throw new Error(`${label}: duplicate profile id ${p.id}`);
    ids.add(p.id);
    if (p.modelConfigId !== undefined && catalog) {
      getModelConfig(catalog, p.modelConfigId); // throws if missing
    }
  }
  if (!ids.has(o.defaultProfileId)) {
    throw new Error(`${label}.defaultProfileId must reference an existing profile`);
  }
  return { defaultProfileId: o.defaultProfileId, profiles };
}

export function getWorkerProfile(
  settings: WorkerProfilesSettings,
  id: string,
): WorkerProfile {
  const found = settings.profiles.find((p) => p.id === id);
  if (!found) {
    throw new Error(`Unknown worker profile: ${id}`);
  }
  return found;
}

export function listWorkerProfiles(settings: WorkerProfilesSettings): WorkerProfile[] {
  return [...settings.profiles];
}

/** Expand a profile to concrete provider/model/endpoint using catalog when needed. */
export function materializeWorkerModel(
  profile: WorkerProfile,
  catalog: ModelCatalogSettings | undefined,
  providerDefaults: ProviderDefaultsSettings,
): { provider: ProviderName; model: string; endpoint: string; modelConfigId?: string; supportedEfforts?: readonly EffortLevel[] } {
  if (profile.modelConfigId !== undefined) {
    if (catalog === undefined) {
      throw new Error(`Worker ${profile.id} references modelConfigId without modelCatalog`);
    }
    const mc = getModelConfig(catalog, profile.modelConfigId);
    return {
      provider: mc.provider,
      model: mc.model,
      endpoint: resolveModelEndpoint(mc, providerDefaults),
      modelConfigId: mc.id,
      ...(mc.supportedEfforts === undefined ? {} : { supportedEfforts: mc.supportedEfforts }),
    };
  }
  if (profile.provider === undefined || profile.model === undefined) {
    throw new Error(`Worker ${profile.id} has neither modelConfigId nor provider+model`);
  }
  const pd = providerDefaults[profile.provider];
  return {
    provider: profile.provider,
    model: profile.model,
    endpoint: profile.endpoint ?? pd.defaultEndpoint,
  };
}

/**
 * Resolve effective Worker selection for a task/MCP submit.
 * Precedence: explicit provider/runtime/model override profile;
 * workerProfileId selects a profile; else default profile; else legacy execution defaults.
 */
export function resolveWorkerSelection(
  input: {
    workerProfileId?: string;
    provider?: string;
    runtime?: string;
    model?: string;
    endpoint?: string;
    effort?: string;
    maxBudgetUsd?: number | null;
    pricingRoute?: string;
  },
  settings: {
    execution: ForkLightSettings["execution"];
    providerDefaults: ProviderDefaultsSettings;
    workerProfiles: WorkerProfilesSettings;
    modelCatalog?: ModelCatalogSettings;
  },
): ResolvedWorkerSelection {
  const profiles = settings.workerProfiles;
  let base: WorkerProfile | undefined;
  let profileId: string | undefined;

  if (input.workerProfileId !== undefined) {
    if (!isWorkerProfileId(input.workerProfileId)) {
      throw new Error("workerProfileId is invalid");
    }
    base = getWorkerProfile(profiles, input.workerProfileId);
    profileId = base.id;
  } else if (
    input.provider === undefined
    && input.runtime === undefined
    && profiles.profiles.length > 0
  ) {
    base = getWorkerProfile(profiles, profiles.defaultProfileId);
    profileId = base.id;
  }

  let baseModel: ReturnType<typeof materializeWorkerModel> | undefined;
  if (base !== undefined) {
    baseModel = materializeWorkerModel(
      base,
      settings.modelCatalog,
      settings.providerDefaults,
    );
  }

  const providerName = (input.provider
    ?? baseModel?.provider
    ?? settings.execution.defaultProvider) as string;
  if (!isProviderName(providerName)) {
    throw new Error(`Unsupported provider: ${providerName}`);
  }
  const runtimeName = (input.runtime
    ?? base?.runtime
    ?? settings.execution.defaultRuntime) as string;
  if (!isRuntimeName(runtimeName)) {
    throw new Error(`Unsupported runtime: ${runtimeName}`);
  }
  assertProviderRuntimePair(providerName, runtimeName);

  const pd = settings.providerDefaults[providerName];
  const model = input.model ?? baseModel?.model ?? pd.defaultModel;
  if (typeof model !== "string" || !MODEL_PATTERN.test(model)) {
    throw new Error("model contains unsupported characters");
  }
  const endpoint = input.endpoint
    ?? baseModel?.endpoint
    ?? pd.defaultEndpoint;
  if (typeof endpoint !== "string" || !ENDPOINT_PATTERN.test(endpoint)) {
    throw new Error("endpoint must be an https URL");
  }
  const effortRaw = input.effort ?? base?.effort ?? settings.execution.defaultEffort;
  if (typeof effortRaw !== "string" || !EFFORTS.has(effortRaw)) {
    throw new Error("effort must be low|medium|high|xhigh|max");
  }
  if (
    baseModel?.supportedEfforts !== undefined
    && providerName === baseModel.provider
    && model === baseModel.model
    && !baseModel.supportedEfforts.includes(effortRaw as EffortLevel)
  ) {
    throw new Error(
      `effort=${effortRaw} is not supported by model config ${baseModel.modelConfigId}; supported: ${baseModel.supportedEfforts.join("|")}`,
    );
  }

  const maxBudgetUsd = input.maxBudgetUsd !== undefined
    ? input.maxBudgetUsd
    : (base?.maxBudgetUsd !== undefined
      ? base.maxBudgetUsd
      : settings.execution.defaultMaxBudgetUsd);
  if (maxBudgetUsd !== null) {
    if (typeof maxBudgetUsd !== "number" || !Number.isFinite(maxBudgetUsd) || maxBudgetUsd <= 0) {
      throw new Error("maxBudgetUsd must be a positive number or null");
    }
    if (maxBudgetUsd > settings.execution.maximumBudgetUsd) {
      throw new Error(
        `maxBudgetUsd $${maxBudgetUsd} exceeds configured maximum $${settings.execution.maximumBudgetUsd}`,
      );
    }
  }

  const noProgressTimeoutMs = base?.noProgressTimeoutMs
    ?? settings.execution.noProgressTimeoutMs;

  if (input.pricingRoute !== undefined && !isPricingRouteId(input.pricingRoute)) {
    throw new Error("pricingRoute must be a bounded non-empty identifier");
  }
  // Explicit Provider/endpoint changes make the Worker's billing identity stale.
  // A caller can still provide a new explicit pricingRoute for the new identity.
  const baseIdentityStillApplies = baseModel === undefined
    || ((input.provider === undefined || input.provider === baseModel.provider)
      && (input.endpoint === undefined || input.endpoint === baseModel.endpoint));
  const pricingRoute = input.pricingRoute
    ?? (baseIdentityStillApplies ? base?.pricingRoute : undefined);

  return {
    profileId,
    modelConfigId: baseModel?.modelConfigId,
    runtime: runtimeName,
    provider: providerName,
    model,
    endpoint,
    effort: effortRaw as EffortLevel,
    keychainService: pd.defaultKeychainService,
    maxBudgetUsd,
    noProgressTimeoutMs,
    ...(pricingRoute === undefined ? {} : { pricingRoute }),
  };
}

/** Upsert a profile into a copy of settings (pure). Replaces same id or appends. */
export function upsertWorkerProfile(
  current: WorkerProfilesSettings,
  profile: WorkerProfile,
  catalog?: ModelCatalogSettings,
): WorkerProfilesSettings {
  const validated = validateWorkerProfile(profile, "workerProfile", catalog);
  const others = current.profiles.filter((p) => p.id !== validated.id);
  const profiles = [...others, validated];
  const defaultProfileId = profiles.some((p) => p.id === current.defaultProfileId)
    ? current.defaultProfileId
    : validated.id;
  return validateWorkerProfilesSettings({ defaultProfileId, profiles }, "workerProfiles", catalog);
}

export function removeWorkerProfile(
  current: WorkerProfilesSettings,
  id: string,
  catalog?: ModelCatalogSettings,
): WorkerProfilesSettings {
  if (current.profiles.length <= 1) {
    throw new Error("Cannot remove the last worker profile");
  }
  const profiles = current.profiles.filter((p) => p.id !== id);
  if (profiles.length === current.profiles.length) {
    throw new Error(`Unknown worker profile: ${id}`);
  }
  const defaultProfileId = current.defaultProfileId === id
    ? profiles[0]!.id
    : current.defaultProfileId;
  return validateWorkerProfilesSettings({ defaultProfileId, profiles }, "workerProfiles", catalog);
}

export function setDefaultWorkerProfile(
  current: WorkerProfilesSettings,
  id: string,
): WorkerProfilesSettings {
  getWorkerProfile(current, id);
  return { ...current, defaultProfileId: id };
}

export const CATALOG_DEFAULT_PROFILE_ID = "default";

/**
 * When the user sets a named profile as default, mirror into execution defaults
 * for legacy surfaces. Requires catalog when profile uses modelConfigId.
 */
export function executionPatchFromProfile(
  profile: WorkerProfile,
  catalog: ModelCatalogSettings | undefined,
  providerDefaults: ProviderDefaultsSettings,
): {
  execution: {
    defaultProvider: ProviderName;
    defaultRuntime: RuntimeName;
    defaultEffort?: EffortLevel;
    defaultMaxBudgetUsd?: number | null;
    noProgressTimeoutMs?: number;
  };
  providerDefaults: Record<string, { defaultModel: string; defaultEndpoint?: string }>;
} {
  const mat = materializeWorkerModel(profile, catalog, providerDefaults);
  return {
    execution: {
      defaultProvider: mat.provider,
      defaultRuntime: profile.runtime,
      ...(profile.effort === undefined ? {} : { defaultEffort: profile.effort }),
      ...(profile.maxBudgetUsd === undefined ? {} : { defaultMaxBudgetUsd: profile.maxBudgetUsd }),
      ...(profile.noProgressTimeoutMs === undefined
        ? {}
        : { noProgressTimeoutMs: profile.noProgressTimeoutMs }),
    },
    providerDefaults: {
      [mat.provider]: {
        defaultModel: mat.model,
        defaultEndpoint: mat.endpoint,
      },
    },
  };
}

/** Profile ids that reference a given model config (for safe model delete). */
export function workerIdsUsingModel(
  profiles: WorkerProfilesSettings,
  modelConfigId: string,
): string[] {
  return profiles.profiles
    .filter((p) => p.modelConfigId === modelConfigId)
    .map((p) => p.id);
}
