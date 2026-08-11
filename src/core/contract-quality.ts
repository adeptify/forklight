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
  TaskBackground,
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

/** Every background field path whose value is empty. Field-specific so Main can
 *  fix exactly the missing context. Strictly mirrors the parser's required
 *  shape (a quality gate cannot be looser than the schema it validates). */
function missingBackgroundFields(background: TaskBackground): string[] {
  const missing: string[] = [];
  if (background.purpose.length === 0) missing.push("task.contract.background.purpose");
  if (background.audience.length === 0) missing.push("task.contract.background.audience");
  if (background.currentSituation.length === 0) {
    missing.push("task.contract.background.currentSituation");
  }
  if (background.parentGoalPlan.length === 0) missing.push("task.contract.background.parentGoalPlan");
  if (background.priorDecisions.length === 0) missing.push("task.contract.background.priorDecisions");
  if (background.suppliedInputs.length === 0) missing.push("task.contract.background.suppliedInputs");
  if (background.downstreamUse.length === 0) missing.push("task.contract.background.downstreamUse");
  if (background.workerAuthority.length === 0) missing.push("task.contract.background.workerAuthority");
  if (background.returnToMain.length === 0) missing.push("task.contract.background.returnToMain");
  return missing;
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
  ];

  if (spec.version === 2) {
    const v2 = spec.contract;
    const moduleDetailsComplete = v2.modules.length > 0
      && v2.modules.every((module) =>
        module.responsibility.length >= values.minModuleResponsibilityCharacters
        && module.consumes.length > 0
        && module.produces.length > 0
        && module.boundaries.length > 0
      );
    checks.push(
      qualityCheck(mode, "context", "Relevant context", v2.context.length > 0,
        "Include the current behavior or reason for the change"),
      qualityCheck(mode, "scope", "In-scope and out-of-scope boundaries",
        v2.inScope.length > 0 && v2.outOfScope.length > 0,
        "State both what may change and what must remain untouched"),
      qualityCheck(mode, "execution", "Execution path",
        v2.executionSteps.length > 0 && v2.deliverables.length > 0,
        "List implementation steps and concrete deliverables"),
      qualityCheck(mode, "modules", "Module production and consumption", moduleDetailsComplete,
        `Each module needs a responsibility (minimum ${values.minModuleResponsibilityCharacters} characters), inputs, outputs, and boundaries`),
      qualityCheck(mode, "call-chain", "Call chain",
        v2.callChain.length >= values.minCallChainSteps,
        `Show at least ${values.minCallChainSteps} step(s) from producer to consumer`),
      qualityCheck(mode, "scenarios", "Normal and boundary scenarios",
        v2.scenarios.length >= values.minScenarios
          && scenarioNames.size === v2.scenarios.length,
        `Provide at least ${values.minScenarios} uniquely named scenario(s), including a boundary or failure case`),
      qualityCheck(mode, "risks", "Known risks", v2.risks.length > 0,
        "Name at least one implementation or integration risk"),
      qualityCheck(mode, "acceptance", "Behavioral and executable acceptance",
        spec.acceptance.criteria.length > 0 && spec.acceptance.commands.length > 0,
        "Require both human-readable criteria and independent commands"),
      qualityCheck(mode, "placeholders", "No unresolved placeholders",
        placeholders.sentinelFields.length === 0, placeholderDetail),
      qualityCheck(mode, "change-budget", "Bounded change surface",
        maximumSatisfied(v2.changeBudget.maxFiles, values.maxFiles)
          && maximumSatisfied(v2.changeBudget.maxDiffLines, values.maxDiffLines),
        `Split the task until one attempt changes at most ${maximumLabel(values.maxFiles)} files and ${maximumLabel(values.maxDiffLines)} added/deleted lines`),
      qualityCheck(mode, "focus-paths", "Focused inspection entry points",
        spec.worker.focusPaths.length > 0
          && maximumSatisfied(spec.worker.focusPaths.length, values.maxFocusPaths),
        `Name one to ${maximumLabel(values.maxFocusPaths)} files or directories the Worker should inspect first`),
    );
  } else {
    const v3 = spec.contract;
    const missingBackground = missingBackgroundFields(v3.background);
    const coding = v3.coding;
    // Coding-only checks pass for domain-neutral Tasks (no Coding extension).
    const moduleDetailsComplete = coding === undefined
      || (coding.modules.length > 0
        && coding.modules.every((module) =>
          module.responsibility.length >= values.minModuleResponsibilityCharacters
          && module.consumes.length > 0
          && module.produces.length > 0
          && module.boundaries.length > 0
        ));
    const callChainComplete = coding === undefined
      || coding.callChain.length >= values.minCallChainSteps;
    const changeBudgetSatisfied = coding === undefined
      || (maximumSatisfied(coding.changeBudget.maxFiles, values.maxFiles)
        && maximumSatisfied(coding.changeBudget.maxDiffLines, values.maxDiffLines));
    checks.push(
      qualityCheck(mode, "background", "Structured background",
        missingBackground.length === 0,
        missingBackground.length === 0
          ? "Explain why the work matters, who it serves, the current situation, parent work, prior decisions, inputs, output use, Worker authority, and return-to-Main decisions"
          : `Missing required background: ${missingBackground.join(", ")}`),
      qualityCheck(mode, "scope", "In-scope and out-of-scope boundaries",
        v3.inScope.length > 0 && v3.outOfScope.length > 0,
        "State both what may change and what must remain untouched"),
      qualityCheck(mode, "execution", "Execution path",
        v3.executionSteps.length > 0 && v3.deliverables.length > 0,
        "List implementation steps and concrete deliverables"),
      qualityCheck(mode, "modules", "Coding detail (optional)", moduleDetailsComplete,
        `Optional Coding extension modules need a responsibility (minimum ${values.minModuleResponsibilityCharacters} characters), inputs, outputs, and boundaries; domain-neutral Tasks may omit them`),
      qualityCheck(mode, "call-chain", "Coding call chain (optional)", callChainComplete,
        `When a Coding extension is present, show at least ${values.minCallChainSteps} step(s) from producer to consumer`),
      qualityCheck(mode, "scenarios", "Normal and boundary scenarios",
        v3.scenarios.length >= values.minScenarios
          && scenarioNames.size === v3.scenarios.length,
        `Provide at least ${values.minScenarios} uniquely named scenario(s), including a boundary or failure case`),
      qualityCheck(mode, "risks", "Known risks", v3.risks.length > 0,
        "Name at least one implementation or integration risk"),
      qualityCheck(mode, "acceptance", "Behavioral and executable acceptance",
        spec.acceptance.criteria.length > 0 && spec.acceptance.commands.length > 0,
        "Require both human-readable criteria and independent commands"),
      qualityCheck(mode, "placeholders", "No unresolved placeholders",
        placeholders.sentinelFields.length === 0, placeholderDetail),
      qualityCheck(mode, "change-budget", "Coding change budget (optional)", changeBudgetSatisfied,
        `When a Coding extension is present, split the task until one attempt changes at most ${maximumLabel(values.maxFiles)} files and ${maximumLabel(values.maxDiffLines)} added/deleted lines`),
      qualityCheck(mode, "focus-paths", "Focused inspection entry points",
        spec.worker.focusPaths.length > 0
          && maximumSatisfied(spec.worker.focusPaths.length, values.maxFocusPaths),
        `Name one to ${maximumLabel(values.maxFocusPaths)} files or directories the Worker should inspect first`),
    );
  }

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
