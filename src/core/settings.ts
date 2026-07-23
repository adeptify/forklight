import type { StateStore } from "../state/store.js";
import type { PolicyMode } from "./types.js";

// --- Versioned settings contract ---

export const SETTINGS_VERSION = 1;

export type { PolicyMode } from "./types.js";

export interface ContractQualitySettings {
  maxFiles: number;
  maxDiffLines: number;
  maxFocusPaths: number;
  minScenarios: number;
  minCallChainSteps: number;
  minOutcomeCharacters: number;
  minModuleResponsibilityCharacters: number;
}

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface ExecutionSettings {
  maxConcurrency: number;
  noProgressTimeoutMs: number;
  defaultEffort: EffortLevel;
  defaultProvider: "deepseek" | "qwen" | "minimax" | "glm";
  defaultMaxBudgetUsd: number | null;
  maximumBudgetUsd: number;
  maxAttempts: number;
  workerStopGraceMs: number;
}

export interface CompletionPolicySettings {
  noChangeMode: PolicyMode;
  /** Enforcement for Task changeBudget overruns (default hard). */
  changeBudgetMode: PolicyMode;
}

export interface RankingWeightSettings {
  verification: number;
  diffFocus: number;
  retries: number;
  cost: number;
  duration: number;
  delivery: number;
}

export interface CompetitionSettings {
  minCandidates: number;
  maxCandidates: number;
  tieThreshold: number;
  rankingWeights: RankingWeightSettings;
}

export interface IntegrationSettings {
  reviewedPatchMaxFiles: number;
  reviewedPatchMaxLines: number;
  verificationTimeoutMs: number;
  reviewReceiptTtlMs: number;
  backupRetentionCount: number;
  autoRollback: boolean;
}

export interface ConsoleSettings {
  loopbackPort: number;
  refreshIntervalMs: number;
  boardListLimit: number;
  taskListLimit: number;
  eventListLimit: number;
}

export interface ProbeSettings {
  probeTimeoutMs: number;
  maxBudgetUsd: number;
  cacheLifetimeMs: number;
  maxProbeConcurrency: number;
}

export interface ProviderDefaultSettings {
  defaultModel: string;
  defaultEndpoint: string;
  defaultKeychainService: string;
  defaultHaikuModel?: string;
  requestTimeoutMs: number;
}

export interface ProviderDefaultsSettings {
  deepseek: ProviderDefaultSettings;
  qwen: ProviderDefaultSettings;
  minimax: ProviderDefaultSettings;
  glm: ProviderDefaultSettings;
}

export interface ForkLightSettings {
  version: typeof SETTINGS_VERSION;
  contractQuality: ContractQualitySettings;
  completionPolicy: CompletionPolicySettings;
  execution: ExecutionSettings;
  competition: CompetitionSettings;
  integration: IntegrationSettings;
  console: ConsoleSettings;
  providerDefaults: ProviderDefaultsSettings;
  probe: ProbeSettings;
}

/** One immutable snapshot of the settings sections that govern task creation.
 *  Every entry point resolves omitted task fields from this policy so later
 *  settings changes affect only future task creation. */
export interface TaskPolicy {
  contractQuality: ContractQualitySettings;
  execution: ExecutionSettings;
  providerDefaults: ProviderDefaultsSettings;
  completionPolicy: CompletionPolicySettings;
}

// --- Built-in defaults matching current behavior ---

const ALIBABA_ENDPOINT = "https://dashscope.aliyuncs.com/apps/anthropic";

const DEFAULTS: ForkLightSettings = {
  version: SETTINGS_VERSION as typeof SETTINGS_VERSION,
  contractQuality: {
    maxFiles: 12,
    maxDiffLines: 1200,
    maxFocusPaths: 8,
    minScenarios: 2,
    minCallChainSteps: 2,
    minOutcomeCharacters: 12,
    minModuleResponsibilityCharacters: 8,
  },
  completionPolicy: {
    noChangeMode: "hard",
    changeBudgetMode: "hard",
  },
  execution: {
    maxConcurrency: 2,
    noProgressTimeoutMs: 1_800_000,
    defaultEffort: "high" as EffortLevel,
    defaultProvider: "deepseek",
    defaultMaxBudgetUsd: 0.5,
    maximumBudgetUsd: 20,
    maxAttempts: 3,
    workerStopGraceMs: 10_000,
  },
  competition: {
    minCandidates: 2,
    maxCandidates: 4,
    tieThreshold: 1e-9,
    rankingWeights: {
      verification: 1,
      diffFocus: 0.3,
      retries: 0.2,
      cost: 0,
      duration: 0,
      delivery: 0.3,
    },
  },
  integration: {
    reviewedPatchMaxFiles: 5,
    reviewedPatchMaxLines: 400,
    verificationTimeoutMs: 300_000,
    reviewReceiptTtlMs: 900_000,
    backupRetentionCount: 5,
    autoRollback: true,
  },
  console: {
    loopbackPort: 0,
    refreshIntervalMs: 1000,
    boardListLimit: 50,
    taskListLimit: 20,
    eventListLimit: 50,
  },
  providerDefaults: {
    deepseek: {
      defaultModel: "deepseek-v4-flash",
      defaultEndpoint: "https://api.deepseek.com/anthropic",
      defaultKeychainService: "forklight.deepseek.api-key",
      defaultHaikuModel: "deepseek-v4-flash",
      requestTimeoutMs: 3_000_000,
    },
    qwen: {
      defaultModel: "qwen3.7-plus",
      defaultEndpoint: ALIBABA_ENDPOINT,
      defaultKeychainService: "forklight.qwen.api-key",
      requestTimeoutMs: 3_000_000,
    },
    minimax: {
      defaultModel: "MiniMax-M3",
      defaultEndpoint: "https://api.minimax.io/anthropic",
      defaultKeychainService: "forklight.minimax.api-key",
      requestTimeoutMs: 3_000_000,
    },
    glm: {
      defaultModel: "glm-5.2",
      defaultEndpoint: ALIBABA_ENDPOINT,
      defaultKeychainService: "forklight.qwen.api-key",
      requestTimeoutMs: 3_000_000,
    },
  },
  probe: {
    probeTimeoutMs: 30_000,
    maxBudgetUsd: 0.05,
    cacheLifetimeMs: 300_000,
    maxProbeConcurrency: 2,
  },
};

// --- Known field names — anything outside this set is rejected ---

const KNOWN_SECTIONS: Record<string, readonly string[]> = {
  version: [],
  contractQuality: [
    "maxFiles", "maxDiffLines", "maxFocusPaths", "minScenarios",
    "minCallChainSteps", "minOutcomeCharacters", "minModuleResponsibilityCharacters",
  ],
  completionPolicy: ["noChangeMode", "changeBudgetMode"],
  execution: [
    "maxConcurrency", "noProgressTimeoutMs", "defaultEffort",
    "defaultProvider", "defaultMaxBudgetUsd", "maximumBudgetUsd",
    "maxAttempts", "workerStopGraceMs",
  ],
  competition: [
    "minCandidates", "maxCandidates", "tieThreshold", "rankingWeights",
  ],
  integration: [
    "reviewedPatchMaxFiles", "reviewedPatchMaxLines",
    "verificationTimeoutMs", "reviewReceiptTtlMs", "backupRetentionCount", "autoRollback",
  ],
  console: ["loopbackPort", "refreshIntervalMs", "boardListLimit", "taskListLimit", "eventListLimit"],
  providerDefaults: ["deepseek", "qwen", "minimax", "glm"],
  probe: ["probeTimeoutMs", "maxBudgetUsd", "cacheLifetimeMs", "maxProbeConcurrency"],
};

const TOP_LEVEL_KEYS = Object.keys(KNOWN_SECTIONS);

const RANKING_WEIGHT_FIELDS: readonly string[] = [
  "verification", "diffFocus", "retries", "cost", "duration", "delivery",
];

const PROVIDER_DEFAULT_FIELDS: readonly string[] = [
  "defaultModel", "defaultEndpoint", "defaultKeychainService",
  "defaultHaikuModel", "requestTimeoutMs",
];

const VALID_EFFORTS = new Set<string>(["low", "medium", "high", "xhigh", "max"]);
const VALID_PROVIDER_NAMES = new Set<string>(["deepseek", "qwen", "minimax", "glm"]);
const VALID_POLICY_MODES = new Set<string>(["hard", "warn", "score", "off"]);

// Rejects credential-bearing field names.  `defaultKeychainService` names a
// macOS Keychain service (not a credential), so "keychain" is intentionally absent.
const CREDENTIAL_PATTERN =
  /(?:api[_-]?key|secret|token|password|credential|auth[_-]?token)/i;

// --- Strict validation ---

class SettingsValidationError extends Error {
  constructor(message: string) {
    super(`Settings validation failed: ${message}`);
    this.name = "SettingsValidationError";
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new SettingsValidationError(message);
}

function assertNonNegativeInteger(v: unknown, label: string): asserts v is number {
  assert(
    typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 0,
    `${label} must be a non-negative integer, got ${JSON.stringify(v)}`,
  );
}

function assertPositiveInteger(v: unknown, label: string): asserts v is number {
  assert(
    typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 1,
    `${label} must be a positive integer, got ${JSON.stringify(v)}`,
  );
}

function assertNonNegativeNumberOrNull(v: unknown, label: string): asserts v is number | null {
  if (v === null) return;
  assert(
    typeof v === "number" && Number.isFinite(v) && v >= 0,
    `${label} must be a non-negative number or null, got ${JSON.stringify(v)}`,
  );
}

function assertNonNegativeNumber(v: unknown, label: string): asserts v is number {
  assert(
    typeof v === "number" && Number.isFinite(v) && v >= 0,
    `${label} must be a non-negative number, got ${JSON.stringify(v)}`,
  );
}

function assertString(v: unknown, label: string): asserts v is string {
  assert(typeof v === "string" && v.trim().length > 0, `${label} must be a non-empty string`);
}

function assertEndpoint(v: unknown, label: string): asserts v is string {
  assertString(v, label);
  try {
    const endpoint = new URL(v);
    assert(["http:", "https:"].includes(endpoint.protocol), `${label} must use http or https`);
  } catch (error) {
    if (error instanceof SettingsValidationError) throw error;
    throw new SettingsValidationError(`${label} must be a valid URL`);
  }
}

function assertBoolean(v: unknown, label: string): asserts v is boolean {
  assert(typeof v === "boolean", `${label} must be a boolean, got ${JSON.stringify(v)}`);
}

// console host, review, source safety are never configurable.

function assertNoCredentialFields(value: Record<string, unknown>, path: string): void {
  for (const key of Object.keys(value)) {
    assert(!CREDENTIAL_PATTERN.test(key), `${path}${key} resembles a credential field and is rejected`);
    const child = value[key];
    if (child !== null && typeof child === "object" && !Array.isArray(child)) {
      assertNoCredentialFields(child as Record<string, unknown>, `${path}${key}.`);
    }
  }
}

function assertNoUnknownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(value)) {
    assert(allowed.includes(key), `${path}${key} is not a recognized settings field`);
  }
}

function validateSection(value: unknown, path: string): Record<string, unknown> {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${path} must be an object`,
  );
  const obj = value as Record<string, unknown>;
  assertNoCredentialFields(obj, path);
  return obj;
}

function validateVersion(v: unknown): void {
  assert(
    v === SETTINGS_VERSION,
    `version must be ${SETTINGS_VERSION}, got ${JSON.stringify(v)}`,
  );
}

function validateSettingsDocument(doc: Record<string, unknown>): ForkLightSettings {
  assertNoUnknownFields(doc, TOP_LEVEL_KEYS, "");
  validateVersion(doc.version);

  const cq = validateSection(doc.contractQuality, "contractQuality.");
  assertNoUnknownFields(cq, KNOWN_SECTIONS.contractQuality!, "contractQuality.");
  for (const f of KNOWN_SECTIONS.contractQuality!) {
    assertNonNegativeInteger(cq[f], `contractQuality.${f}`);
  }

  const cp = validateSection(doc.completionPolicy, "completionPolicy.");
  assertNoUnknownFields(cp, KNOWN_SECTIONS.completionPolicy!, "completionPolicy.");
  assert(
    typeof cp.noChangeMode === "string" && VALID_POLICY_MODES.has(cp.noChangeMode),
    `completionPolicy.noChangeMode must be one of ${[...VALID_POLICY_MODES].join(", ")}`,
  );
  assert(
    typeof cp.changeBudgetMode === "string" && VALID_POLICY_MODES.has(cp.changeBudgetMode),
    `completionPolicy.changeBudgetMode must be one of ${[...VALID_POLICY_MODES].join(", ")}`,
  );

  const ex = validateSection(doc.execution, "execution.");
  assertNoUnknownFields(ex, KNOWN_SECTIONS.execution!, "execution.");
  assertPositiveInteger(ex.maxConcurrency, "execution.maxConcurrency");
  assertPositiveInteger(ex.noProgressTimeoutMs, "execution.noProgressTimeoutMs");
  assert(ex.noProgressTimeoutMs >= 1000, "execution.noProgressTimeoutMs must be at least 1000 ms");
  assert(
    typeof ex.defaultEffort === "string" && VALID_EFFORTS.has(ex.defaultEffort),
    `execution.defaultEffort must be one of ${[...VALID_EFFORTS].join(", ")}`,
  );
  assert(
    typeof ex.defaultProvider === "string" && VALID_PROVIDER_NAMES.has(ex.defaultProvider),
    `execution.defaultProvider must be one of ${[...VALID_PROVIDER_NAMES].join(", ")}`,
  );
  assertNonNegativeNumberOrNull(ex.defaultMaxBudgetUsd, "execution.defaultMaxBudgetUsd");
  assertNonNegativeNumber(ex.maximumBudgetUsd, "execution.maximumBudgetUsd");
  if (ex.defaultMaxBudgetUsd !== null) {
    assert(
      ex.maximumBudgetUsd >= ex.defaultMaxBudgetUsd,
      "execution.maximumBudgetUsd must be >= defaultMaxBudgetUsd",
    );
  }
  assertPositiveInteger(ex.maxAttempts, "execution.maxAttempts");
  assertPositiveInteger(ex.workerStopGraceMs, "execution.workerStopGraceMs");
  assert(ex.workerStopGraceMs >= 100, "execution.workerStopGraceMs must be at least 100 ms");

  // --- competition ---
  const comp = validateSection(doc.competition, "competition.");
  assertNoUnknownFields(comp, KNOWN_SECTIONS.competition!, "competition.");
  assertPositiveInteger(comp.minCandidates, "competition.minCandidates");
  assert(comp.minCandidates >= 2, "competition.minCandidates must be at least 2");
  assertPositiveInteger(comp.maxCandidates, "competition.maxCandidates");
  assert(
    (comp.maxCandidates as number) >= (comp.minCandidates as number),
    "competition.maxCandidates must be >= minCandidates",
  );
  assertNonNegativeNumber(comp.tieThreshold, "competition.tieThreshold");
  const rw = validateSection(comp.rankingWeights, "competition.rankingWeights.");
  assertNoUnknownFields(rw, RANKING_WEIGHT_FIELDS, "competition.rankingWeights.");
  for (const f of RANKING_WEIGHT_FIELDS) {
    assertNonNegativeNumber(rw[f], `competition.rankingWeights.${f}`);
  }
  assert((rw.verification as number) > 0, "competition.rankingWeights.verification must be positive");

  // --- integration ---
  const ig = validateSection(doc.integration, "integration.");
  assertNoUnknownFields(ig, KNOWN_SECTIONS.integration!, "integration.");
  assertNonNegativeInteger(ig.reviewedPatchMaxFiles, "integration.reviewedPatchMaxFiles");
  assertNonNegativeInteger(ig.reviewedPatchMaxLines, "integration.reviewedPatchMaxLines");
  assertPositiveInteger(ig.verificationTimeoutMs, "integration.verificationTimeoutMs");
  assert(ig.verificationTimeoutMs >= 1000, "integration.verificationTimeoutMs must be at least 1000 ms");
  assertPositiveInteger(ig.reviewReceiptTtlMs, "integration.reviewReceiptTtlMs");
  assert(ig.reviewReceiptTtlMs >= 1000, "integration.reviewReceiptTtlMs must be at least 1000 ms");
  assertNonNegativeInteger(ig.backupRetentionCount, "integration.backupRetentionCount");
  assertBoolean(ig.autoRollback, "integration.autoRollback");

  // --- console ---
  const cn = validateSection(doc.console, "console.");
  assertNoUnknownFields(cn, KNOWN_SECTIONS.console!, "console.");
  assertNonNegativeInteger(cn.loopbackPort, "console.loopbackPort");
  assert(
    (cn.loopbackPort as number) >= 0 && (cn.loopbackPort as number) <= 65535,
    "console.loopbackPort must be 0-65535",
  );
  assertPositiveInteger(cn.refreshIntervalMs, "console.refreshIntervalMs");
  assert(cn.refreshIntervalMs >= 200, "console.refreshIntervalMs must be at least 200 ms");
  assertPositiveInteger(cn.boardListLimit, "console.boardListLimit");
  assert(cn.boardListLimit <= 100, "console.boardListLimit must not exceed 100");
  assertPositiveInteger(cn.taskListLimit, "console.taskListLimit");
  assert(cn.taskListLimit <= 100, "console.taskListLimit must not exceed 100");
  assertPositiveInteger(cn.eventListLimit, "console.eventListLimit");
  assert(cn.eventListLimit <= 100, "console.eventListLimit must not exceed 100");

  // --- providerDefaults ---
  const pd = validateSection(doc.providerDefaults, "providerDefaults.");
  assertNoUnknownFields(pd, KNOWN_SECTIONS.providerDefaults!, "providerDefaults.");
  for (const pn of KNOWN_SECTIONS.providerDefaults!) {
    const ps = validateSection(pd[pn], `providerDefaults.${pn}.`);
    assertNoUnknownFields(ps, PROVIDER_DEFAULT_FIELDS, `providerDefaults.${pn}.`);
    assertString(ps.defaultModel, `providerDefaults.${pn}.defaultModel`);
    assertEndpoint(ps.defaultEndpoint, `providerDefaults.${pn}.defaultEndpoint`);
    assertString(ps.defaultKeychainService, `providerDefaults.${pn}.defaultKeychainService`);
    if (ps.defaultHaikuModel !== undefined) {
      assertString(ps.defaultHaikuModel, `providerDefaults.${pn}.defaultHaikuModel`);
    }
    assertPositiveInteger(ps.requestTimeoutMs, `providerDefaults.${pn}.requestTimeoutMs`);
    assert(
      ps.requestTimeoutMs >= 1000,
      `providerDefaults.${pn}.requestTimeoutMs must be at least 1000 ms`,
    );
  }

  // --- probe ---
  const pr = validateSection(doc.probe, "probe.");
  assertNoUnknownFields(pr, KNOWN_SECTIONS.probe!, "probe.");
  assertPositiveInteger(pr.probeTimeoutMs, "probe.probeTimeoutMs");
  assert(pr.probeTimeoutMs >= 1000, "probe.probeTimeoutMs must be at least 1000 ms");
  assertNonNegativeNumber(pr.maxBudgetUsd, "probe.maxBudgetUsd");
  assert((pr.maxBudgetUsd as number) > 0, "probe.maxBudgetUsd must be greater than zero");
  assert(
    (pr.maxBudgetUsd as number) <= 1,
    "probe.maxBudgetUsd must not exceed 1 USD",
  );
  assertPositiveInteger(pr.cacheLifetimeMs, "probe.cacheLifetimeMs");
  assert(pr.cacheLifetimeMs >= 1000, "probe.cacheLifetimeMs must be at least 1000 ms");
  assertPositiveInteger(pr.maxProbeConcurrency, "probe.maxProbeConcurrency");
  assert(pr.maxProbeConcurrency <= 8, "probe.maxProbeConcurrency must not exceed 8");

  return doc as unknown as ForkLightSettings;
}

// --- Deep merge — only known fields survive ---

function deepMerge<T extends Record<string, unknown>>(
  defaults: T,
  patch: Record<string, unknown>,
  allowedKeys: readonly string[],
): T {
  const merged = { ...defaults };
  for (const key of Object.keys(patch)) {
    if (!allowedKeys.includes(key)) continue;
    (merged as Record<string, unknown>)[key] = patch[key];
  }
  return merged;
}

function mergeSettings(
  current: ForkLightSettings,
  patch: Record<string, unknown>,
): ForkLightSettings {
  const base = structuredClone(current) as unknown as Record<string, unknown>;

  for (const section of TOP_LEVEL_KEYS) {
    if (section === "version") continue; // version is validated, not merged
    if (!(section in patch)) continue;
    const v = (patch as Record<string, unknown>)[section];
    if (v === null || typeof v !== "object" || Array.isArray(v)) continue;
    const obj = v as Record<string, unknown>;

    if (section === "competition") {
      const rp = obj.rankingWeights as Record<string, unknown> | undefined;
      const mergedComp = deepMerge(
        base[section] as unknown as Record<string, unknown>,
        obj,
        KNOWN_SECTIONS.competition!,
      );
      if (rp && typeof rp === "object" && !Array.isArray(rp)) {
        (mergedComp as Record<string, unknown>).rankingWeights = deepMerge(
          (current.competition.rankingWeights as unknown) as Record<string, unknown>,
          rp,
          RANKING_WEIGHT_FIELDS,
        );
      }
      base[section] = mergedComp;
    } else if (section === "providerDefaults") {
      const mergedProvs: Record<string, unknown> = {};
      for (const pn of KNOWN_SECTIONS.providerDefaults!) {
        const pp = obj[pn] as Record<string, unknown> | undefined;
        mergedProvs[pn] = pp && typeof pp === "object"
          ? deepMerge(
              (current.providerDefaults[pn as keyof ProviderDefaultsSettings] as unknown) as Record<string, unknown>,
              pp,
              PROVIDER_DEFAULT_FIELDS,
            )
          : (current.providerDefaults[pn as keyof ProviderDefaultsSettings] as unknown) as Record<string, unknown>;
      }
      base[section] = mergedProvs;
    } else {
      base[section] = deepMerge(
        base[section] as Record<string, unknown>,
        obj,
        KNOWN_SECTIONS[section]!,
      );
    }
  }

  return base as unknown as ForkLightSettings;
}

// --- Defensive copy helpers ---

function deepFreeze<T extends object>(obj: T): T {
  for (const value of Object.values(obj)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value) && !Object.isFrozen(value)) {
      deepFreeze(value as object);
    }
  }
  return Object.freeze(obj);
}

/** Return a frozen, isolated snapshot of the built-in default settings.
 *  Pure callers that cannot inject a SettingsService use this to
 *  obtain backward-compatible defaults without global mutable state. */
export function cloneDefaults(): ForkLightSettings {
  return deepFreeze(structuredClone(DEFAULTS));
}

// --- SettingsService ---

export class SettingsService {
  constructor(private readonly store: StateStore) {}

  /** Return the current effective settings (persisted overrides merged onto defaults). */
  get(): ForkLightSettings {
    const stored = this.store.getSettings();
    if (!stored) return cloneDefaults();
    // Stored documents are complete snapshots, but a newer binary can add a
    // policy field within the same settings version. Merge onto current
    // defaults before validation so existing installations gain that default
    // without discarding their persisted overrides.
    const migrated = mergeSettings(
      cloneDefaults(),
      structuredClone(stored),
    );
    const validated = validateSettingsDocument(
      migrated as unknown as Record<string, unknown>,
    );
    return deepFreeze(validated);
  }

  update(patch: Record<string, unknown>): ForkLightSettings {
    validateSection(patch, "");
    assertNoUnknownFields(patch, TOP_LEVEL_KEYS, "");
    if ("version" in patch) validateVersion((patch as Record<string, unknown>).version);

    // Validate nested fields on the raw patch before merging
    for (const section of TOP_LEVEL_KEYS) {
      if (section === "version" || !(section in patch)) continue;
      const obj = validateSection(patch[section], `${section}.`);
      if (section === "competition") {
        assertNoUnknownFields(obj, KNOWN_SECTIONS.competition!, "competition.");
        if ("rankingWeights" in obj) {
          const rp = validateSection(obj.rankingWeights, "competition.rankingWeights.");
          assertNoUnknownFields(rp, RANKING_WEIGHT_FIELDS, "competition.rankingWeights.");
        }
      } else if (section === "providerDefaults") {
        assertNoUnknownFields(obj, KNOWN_SECTIONS.providerDefaults!, "providerDefaults.");
        for (const pn of KNOWN_SECTIONS.providerDefaults!) {
          if (pn in obj) {
            const pp = validateSection(obj[pn], `providerDefaults.${pn}.`);
            assertNoUnknownFields(pp, PROVIDER_DEFAULT_FIELDS, `providerDefaults.${pn}.`);
          }
        }
      } else {
        assertNoUnknownFields(obj, KNOWN_SECTIONS[section]!, `${section}.`);
      }
    }

    const effective = mergeSettings(this.get(), patch);
    validateSettingsDocument(effective as unknown as Record<string, unknown>);
    this.store.saveSettings(structuredClone(effective) as unknown as Record<string, unknown>);
    return deepFreeze(structuredClone(effective));
  }

  /** Remove all persisted overrides so effective settings equal defaults. */
  reset(): ForkLightSettings {
    this.store.resetSettings();
    return cloneDefaults();
  }
}
