/**
 * Task Contract Quality policy.
 *
 * This module owns flexible authoring-quality checks only. Task schema,
 * acceptance-command authority, credentials, workspace isolation, Main Review,
 * Integration confirmation, commit, and push remain hard outside this module.
 */

import type { ContractQualitySettings } from "./settings.js";
import type { WorkerProfilesSettings } from "./worker-profiles.js";
import type {
  ContractQualityOverrides,
  EffectiveQualityPolicySnapshot,
  PolicyMode,
  ProvenanceSource,
  QualityAdmissionEffect,
  QualityCheck,
  QualityCheckEffect,
  QualityPolicyPreviewRow,
  QualityReport,
  QualityWarning,
  ResolvedContractQualityValues,
  TaskSpec,
} from "./types.js";

const QUALITY_FIELDS: readonly (keyof ResolvedContractQualityValues)[] = [
  "maxFiles",
  "maxDiffLines",
  "maxFocusPaths",
  "minScenarios",
  "minCallChainSteps",
  "minOutcomeCharacters",
  "minModuleResponsibilityCharacters",
];

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function resolveValue<K extends keyof ResolvedContractQualityValues>(
  field: K,
  worker: ContractQualityOverrides | undefined,
  global: ContractQualitySettings,
): ResolvedContractQualityValues[K] {
  const candidate = worker?.[field];
  return (candidate === undefined ? global[field] : candidate) as ResolvedContractQualityValues[K];
}

export function resolveEffectiveQualityPolicy(
  workerOverride: ContractQualityOverrides | undefined,
  globalDefaults: ContractQualitySettings,
  profileId: string,
): EffectiveQualityPolicySnapshot {
  const values: ResolvedContractQualityValues = {
    maxFiles: resolveValue("maxFiles", workerOverride, globalDefaults),
    maxDiffLines: resolveValue("maxDiffLines", workerOverride, globalDefaults),
    maxFocusPaths: resolveValue("maxFocusPaths", workerOverride, globalDefaults),
    minScenarios: resolveValue("minScenarios", workerOverride, globalDefaults),
    minCallChainSteps: resolveValue("minCallChainSteps", workerOverride, globalDefaults),
    minOutcomeCharacters: resolveValue("minOutcomeCharacters", workerOverride, globalDefaults),
    minModuleResponsibilityCharacters: resolveValue(
      "minModuleResponsibilityCharacters",
      workerOverride,
      globalDefaults,
    ),
  };
  const provenance = {} as Record<keyof ResolvedContractQualityValues, ProvenanceSource>;
  for (const field of QUALITY_FIELDS) {
    provenance[field] = workerOverride?.[field] === undefined ? "global" : "worker";
  }
  return deepFreeze({
    profileId,
    mode: workerOverride?.mode ?? globalDefaults.mode ?? "hard",
    modeSource: workerOverride?.mode === undefined ? "global" : "worker",
    values,
    provenance,
  });
}

export function effectiveQualityPolicyFromGlobal(
  globalDefaults: ContractQualitySettings,
): EffectiveQualityPolicySnapshot {
  return resolveEffectiveQualityPolicy(undefined, globalDefaults, "global");
}

export function deriveEffectiveQualityPolicy(
  workerProfileId: string | undefined,
  settings: {
    contractQuality: ContractQualitySettings;
    workerProfiles?: WorkerProfilesSettings;
  },
): EffectiveQualityPolicySnapshot {
  const selected = workerProfileId === undefined
    ? undefined
    : settings.workerProfiles?.profiles.find((profile) => profile.id === workerProfileId);
  if (workerProfileId !== undefined && selected === undefined) {
    throw new Error("selected Worker Profile is unavailable for Quality policy resolution");
  }
  return resolveEffectiveQualityPolicy(
    selected?.contractQuality,
    settings.contractQuality,
    selected?.id ?? "global",
  );
}

export function previewQualityPolicy(
  workerOverride: ContractQualityOverrides | undefined,
  globalDefaults: ContractQualitySettings,
  profileId: string,
): QualityPolicyPreviewRow[] {
  const snapshot = resolveEffectiveQualityPolicy(workerOverride, globalDefaults, profileId);
  return [
    { field: "mode", value: snapshot.mode, source: snapshot.modeSource, layer: "quality" },
    ...QUALITY_FIELDS.map((field): QualityPolicyPreviewRow => ({
      field,
      value: snapshot.values[field],
      source: snapshot.provenance[field],
      layer: "quality",
    })),
  ];
}

const PLACEHOLDER_SENTINEL = /\b(?:TODO|TBD|FIXME)\b|\{\{[^}]+\}\}|_{3,}|\?{3,}/;
const PLACEHOLDER_WORDING = /\b(?:unknown|todo|tbd|fixme)\b|待定|暂不清楚|以后再说/i;

interface ContractStringField {
  field: string;
  text: string;
}

function collectContractStringFields(
  value: unknown,
  prefix: string,
  result: ContractStringField[],
): void {
  if (typeof value === "string") {
    if (value.length > 0) result.push({ field: prefix, text: value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectContractStringFields(item, `${prefix}[${index}]`, result);
    });
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      collectContractStringFields(nested, prefix ? `${prefix}.${key}` : key, result);
    }
  }
}

function boundedExcerpt(text: string, match: RegExpMatchArray): string {
  const start = match.index ?? 0;
  const end = start + match[0].length;
  const from = Math.max(0, start - 20);
  const to = Math.min(text.length, end + 20);
  return `${from > 0 ? "…" : ""}${text.slice(from, to).trim()}${to < text.length ? "…" : ""}`;
}

function scanPlaceholders(fields: ContractStringField[]): {
  sentinelFields: string[];
  warnings: QualityWarning[];
} {
  const sentinelFields: string[] = [];
  const warnings: QualityWarning[] = [];
  for (const field of fields) {
    const sentinel = field.text.match(PLACEHOLDER_SENTINEL);
    if (sentinel !== null) {
      sentinelFields.push(field.field);
      continue;
    }
    const wording = field.text.match(PLACEHOLDER_WORDING);
    if (wording !== null) {
      warnings.push({
        field: field.field,
        term: wording[0],
        excerpt: boundedExcerpt(field.text, wording),
      });
    }
  }
  return { sentinelFields, warnings };
}

function checkEffect(mode: PolicyMode, passed: boolean): QualityCheckEffect {
  if (passed) return "satisfied";
  switch (mode) {
    case "hard": return "blocking";
    case "warn": return "warning";
    case "score": return "score-evidence";
    case "off": return "ignored";
  }
}

function admissionEffect(
  mode: PolicyMode,
  allPassed: boolean,
): QualityAdmissionEffect {
  if (allPassed) return "passed";
  switch (mode) {
    case "hard": return "blocked";
    case "warn": return "admitted-with-warnings";
    case "score": return "admitted-with-score";
    case "off": return "admitted-ignored";
  }
}

function qualityCheck(
  mode: PolicyMode,
  id: string,
  label: string,
  passed: boolean,
  detail: string,
): QualityCheck {
  return { id, label, passed, detail, effect: checkEffect(mode, passed) };
}

function maximumSatisfied(observed: number, maximum: number | null): boolean {
  return maximum === null || observed <= maximum;
}

function maximumLabel(maximum: number | null): string {
  return maximum === null ? "unlimited" : String(maximum);
}

/** Evaluate flexible Quality checks. `passed` remains check truth;
 * `admitted` is the separate policy decision. */
export function assessTaskQualityWithPolicy(
  spec: TaskSpec,
  policy: EffectiveQualityPolicySnapshot,
): QualityReport {
  if (spec.version === 1) {
    const issue = "Legacy version 1 task has no structured execution contract";
    return {
      passed: false,
      admitted: false,
      score: 0,
      mode: policy.mode,
      effect: "blocked",
      checks: [{
        id: "contract-version",
        label: "Structured contract",
        passed: false,
        detail: issue,
        effect: "blocking",
      }],
      issues: [issue],
      blockingIssues: [issue],
      advisories: [],
      warnings: [],
    };
  }

  const { values, mode } = policy;
  const contract = spec.contract;
  const moduleDetailsComplete = contract.modules.length > 0
    && contract.modules.every((module) =>
      module.responsibility.length >= values.minModuleResponsibilityCharacters
      && module.consumes.length > 0
      && module.produces.length > 0
      && module.boundaries.length > 0
    );
  const scenarioNames = new Set(contract.scenarios.map((scenario) => scenario.name.toLowerCase()));
  const stringFields: ContractStringField[] = [];
  collectContractStringFields({ contract, acceptance: spec.acceptance }, "", stringFields);
  const placeholders = scanPlaceholders(stringFields);
  const placeholderDetail = placeholders.sentinelFields.length === 0
    ? "Remove TODO, TBD, FIXME, or template variables before submitting"
    : `Remove template placeholders in: ${placeholders.sentinelFields.join(", ")}`;

  const checks: QualityCheck[] = [
    qualityCheck(mode, "outcome", "Concrete outcome",
      contract.outcome.length >= values.minOutcomeCharacters,
      `Describe one observable result with enough detail to judge success (minimum ${values.minOutcomeCharacters} characters)`),
    qualityCheck(mode, "context", "Relevant context", contract.context.length > 0,
      "Include the current behavior or reason for the change"),
    qualityCheck(mode, "scope", "In-scope and out-of-scope boundaries",
      contract.inScope.length > 0 && contract.outOfScope.length > 0,
      "State both what may change and what must remain untouched"),
    qualityCheck(mode, "execution", "Execution path",
      contract.executionSteps.length > 0 && contract.deliverables.length > 0,
      "List implementation steps and concrete deliverables"),
    qualityCheck(mode, "modules", "Module production and consumption", moduleDetailsComplete,
      `Each module needs a responsibility (minimum ${values.minModuleResponsibilityCharacters} characters), inputs, outputs, and boundaries`),
    qualityCheck(mode, "call-chain", "Call chain",
      contract.callChain.length >= values.minCallChainSteps,
      `Show at least ${values.minCallChainSteps} step(s) from producer to consumer`),
    qualityCheck(mode, "scenarios", "Normal and boundary scenarios",
      contract.scenarios.length >= values.minScenarios
        && scenarioNames.size === contract.scenarios.length,
      `Provide at least ${values.minScenarios} uniquely named scenario(s), including a boundary or failure case`),
    qualityCheck(mode, "risks", "Known risks", contract.risks.length > 0,
      "Name at least one implementation or integration risk"),
    qualityCheck(mode, "acceptance", "Behavioral and executable acceptance",
      spec.acceptance.criteria.length > 0 && spec.acceptance.commands.length > 0,
      "Require both human-readable criteria and independent commands"),
    qualityCheck(mode, "placeholders", "No unresolved placeholders",
      placeholders.sentinelFields.length === 0, placeholderDetail),
    qualityCheck(mode, "change-budget", "Bounded change surface",
      maximumSatisfied(contract.changeBudget.maxFiles, values.maxFiles)
        && maximumSatisfied(contract.changeBudget.maxDiffLines, values.maxDiffLines),
      `Split the task until one attempt changes at most ${maximumLabel(values.maxFiles)} files and ${maximumLabel(values.maxDiffLines)} added/deleted lines`),
    qualityCheck(mode, "focus-paths", "Focused inspection entry points",
      spec.worker.focusPaths.length > 0
        && maximumSatisfied(spec.worker.focusPaths.length, values.maxFocusPaths),
      `Name one to ${maximumLabel(values.maxFocusPaths)} files or directories the Worker should inspect first`),
  ];

  const failedChecks = checks.filter((check) => !check.passed);
  const issues = failedChecks.map((check) => `${check.label}: ${check.detail}`);
  const passed = failedChecks.length === 0;
  const admitted = passed || mode !== "hard";
  return {
    passed,
    admitted,
    score: Math.round((checks.filter((check) => check.passed).length / checks.length) * 100),
    mode,
    effect: admissionEffect(mode, passed),
    checks,
    issues,
    blockingIssues: mode === "hard" ? issues : [],
    advisories: mode === "warn" ? issues : [],
    warnings: placeholders.warnings,
  };
}

export function assertTaskQualityWithPolicy(
  spec: TaskSpec,
  policy: EffectiveQualityPolicySnapshot,
): QualityReport {
  const report = assessTaskQualityWithPolicy(spec, policy);
  if (report.admitted !== true) {
    throw new Error(
      `Task Contract quality gate failed (${report.score}/100):\n${report.issues
        .map((issue) => `- ${issue}`)
        .join("\n")}`,
    );
  }
  return report;
}
