import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { isProviderName, providerDefinition, providerNames } from "./providers.js";
import {
  isExecutionPreference,
  nativeGoalSupportForRuntime,
  resolveExecutionMode,
} from "./execution-mode.js";
import { normalizeDirectCodexProfileId } from "./direct-codex-calibration.js";
import {
  assertProviderRuntimePair,
  defaultExecutableForRuntime,
  isRuntimeName,
  supportedRuntimeNamesList,
  type RuntimeName,
} from "./runtime-names.js";
import { isPricingRouteId, resolveWorkerSelection } from "./worker-profiles.js";
import {
  freezeWorkerNetworkPolicy,
  validateWorkerNetworkPolicy,
  type WorkerNetworkPolicy,
} from "./network-policy.js";
import { selectDeliveryProfile } from "./delivery-profiles.js";
import {
  expandHome,
  requireNonEmptyString,
  requireObject,
  requireStringArray,
} from "./parse-helpers.js";
import { cloneDefaults, type ContractQualitySettings, type TaskPolicy } from "./settings.js";
import { validateTaskAdvancedPolicyOverride } from "./advanced-policy.js";
import {
  assessTaskQualityWithPolicy,
  assertTaskQualityWithPolicy,
  deriveEffectiveQualityPolicy,
  effectiveQualityPolicyFromGlobal,
} from "./contract-quality.js";
import { reviewerOutputBoundsLine } from "./review-graph.js";
import type {
  CompetitionTrigger,
  ContextContractTaskSpec,
  ContextTaskContract,
  ContractTaskSpec,
  DeliveryResolution,
  DeliverySpec,
  ExecutionPreference,
  FrozenWorkerIdentity,
  QualityReport,
  ResolvedExecutionMode,
  RoutingDecisionSnapshot,
  TaskAdvancedPolicyOverride,
  TaskBackground,
  TaskCodingExtension,
  TaskContract,
  TaskModuleContract,
  TaskPresentation,
  PolicyMode,
  TaskScenarioContract,
  TaskSpec,
} from "./types.js";

const DELIVERY_COMMAND_MAX_COUNT = 16;
export const TASK_PRESENTATION_SUMMARY_MAX = 300;
export const TASK_PRESENTATION_LANGUAGE_MAX = 35;

const DEFAULT_EXCLUDES = [
  ".git",
  ".runtime",
  ".forklight",
  ".forklight-dev",
  ".forklight-daemon-test",
  "node_modules",
  ".DS_Store",
];

function generatedPathPatterns(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error("task.workspace.generatedPaths must be an array of relative POSIX patterns");
  }
  const patterns = value.map((candidate) => {
    if (
      typeof candidate !== "string"
      || candidate.length === 0
      || candidate !== candidate.trim()
      || candidate.length > 240
      || candidate.includes("\0")
      || candidate.includes("\\")
      || path.posix.isAbsolute(candidate)
      || /^[A-Za-z]:\//.test(candidate)
      || candidate.split("/").some((segment) => segment === "." || segment === ".." || !segment)
    ) {
      throw new Error(
        "task.workspace.generatedPaths must contain relative POSIX patterns of at most 240 characters",
      );
    }
    return candidate;
  });
  return [...new Set(patterns)];
}

/** Snapshot exclusions are global path-segment names, not relative paths or
 * glob patterns. Reject unsupported spellings at Task admission so a typo such
 * as `src-tauri/target` cannot silently trigger a multi-gigabyte scan. */
function snapshotExcludeNames(value: unknown): string[] {
  const names = stringArray(value, "task.workspace.exclude");
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    if (
      name === "."
      || name === ".."
      || name.includes("/")
      || name.includes("\\")
      || /[*?\[\]]/.test(name)
    ) {
      throw new Error(
        `task.workspace.exclude[${index}] must be one directory or file name, not a path or glob; for example, use target instead of src-tauri/target`,
      );
    }
  }
  return names;
}

const object = requireObject;
const stringValue = requireNonEmptyString;
const stringArray = requireStringArray;

function objectArray(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => object(item, `${label}[${index}]`));
}

function deliverySpec(value: unknown): DeliverySpec | undefined {
  if (value === undefined) return undefined;
  const delivery = object(value, "task.delivery");
  const allowed = new Set([
    "buildCommands",
    "activationCommands",
    "activationCheckCommands",
  ]);
  if (Object.keys(delivery).some((key) => !allowed.has(key))) {
    throw new Error("task.delivery contains an unsupported field");
  }
  const commandList = (key: keyof DeliverySpec): string[] => {
    const commands = stringArray(delivery[key], `task.delivery.${key}`);
    if (commands.length > DELIVERY_COMMAND_MAX_COUNT) {
      throw new Error(
        `task.delivery.${key} must contain at most ${DELIVERY_COMMAND_MAX_COUNT} commands`,
      );
    }
    return commands;
  };
  return {
    buildCommands: commandList("buildCommands"),
    activationCommands: commandList("activationCommands"),
    activationCheckCommands: commandList("activationCheckCommands"),
  };
}

function booleanValue(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function policyModeValue(value: unknown, label: string, fallback: PolicyMode): PolicyMode {
  if (value === undefined) return fallback;
  if (value === "hard" || value === "warn" || value === "score" || value === "off") return value;
  throw new Error(`${label} must be hard, warn, score, or off`);
}

const VALID_COMPETITION_INTENTS = new Set(["none", "consider", "required"]);
const VALID_COMPETITION_TRIGGERS = new Set<CompetitionTrigger>([
  "critical", "multiple-plausible-solutions", "new-family", "user-requested",
]);

function validateFrozenWorkerIdentity(raw: unknown, label: string): FrozenWorkerIdentity {
  const obj = object(raw, label);
  const runtime = stringValue(obj.runtime, `${label}.runtime`);
  if (!isRuntimeName(runtime)) {
    throw new Error(`${label}.runtime must be one of: ${supportedRuntimeNamesList()}`);
  }
  const effort = stringValue(obj.effort, `${label}.effort`);
  if (!["low", "medium", "high", "xhigh", "max"].includes(effort)) {
    throw new Error(`${label}.effort must be low, medium, high, xhigh, or max`);
  }
  return {
    provider: stringValue(obj.provider, `${label}.provider`),
    model: stringValue(obj.model, `${label}.model`),
    runtime,
    effort,
    ...(obj.workerProfileId === undefined
      ? {}
      : { workerProfileId: stringValue(obj.workerProfileId, `${label}.workerProfileId`) }),
  };
}

function validateRoutingDecision(raw: unknown): RoutingDecisionSnapshot {
  const obj = object(raw, "task.routingDecision");
  // taskFamily is optional inside routingDecision (can come from top-level too)
  const taskFamily = obj.taskFamily === undefined
    ? undefined
    : (() => {
        const v = obj.taskFamily;
        if (typeof v !== "string" || v.trim() === "" || v.trim().length > 80)
          throw new Error("task.routingDecision.taskFamily must be a non-empty string of at most 80 characters");
        return v.trim();
      })();
  const shortlist = objectArray(obj.shortlist, "task.routingDecision.shortlist")
    .filter((item) => item !== null && typeof item === "object")
    .map((item, i) => validateFrozenWorkerIdentity(item, `task.routingDecision.shortlist[${i}]`));
  if (shortlist.length < 1) throw new Error("task.routingDecision.shortlist must contain at least one Worker");
  const selectedWorker = validateFrozenWorkerIdentity(
    obj.selectedWorker,
    "task.routingDecision.selectedWorker",
  );
  const selectedBecauseObj = object(obj.selectedBecause, "task.routingDecision.selectedBecause");
  const reasonCode = stringValue(selectedBecauseObj.code, "task.routingDecision.selectedBecause.code");
  if (reasonCode.length > 40) throw new Error("task.routingDecision.selectedBecause.code must be at most 40 characters");
  const reasonNote = stringValue(selectedBecauseObj.note, "task.routingDecision.selectedBecause.note");
  if (reasonNote.length > 300) throw new Error("task.routingDecision.selectedBecause.note must be at most 300 characters");
  const competitionObj = object(obj.competition, "task.routingDecision.competition");
  const intent = competitionObj.intent;
  if (typeof intent !== "string" || !VALID_COMPETITION_INTENTS.has(intent)) {
    throw new Error("task.routingDecision.competition.intent must be none, consider, or required");
  }
  const triggers = (() => {
    const raw = competitionObj.triggers;
    if (!Array.isArray(raw)) throw new Error("task.routingDecision.competition.triggers must be an array");
    return raw.map((t, i) => {
      if (typeof t !== "string" || !VALID_COMPETITION_TRIGGERS.has(t as CompetitionTrigger)) {
        throw new Error(
          `task.routingDecision.competition.triggers[${i}] must be one of: ${[...VALID_COMPETITION_TRIGGERS].join(", ")}`,
        );
      }
      return t as CompetitionTrigger;
    });
  })();
  if (intent !== "none" && triggers.length === 0) {
    throw new Error("task.routingDecision.competition.triggers must be non-empty when intent is consider or required");
  }
  const evidenceObj = object(obj.evidenceSnapshot, "task.routingDecision.evidenceSnapshot");
  const scope = evidenceObj.scope;
  if (scope !== "exact-class" && scope !== "task-family" && scope !== "none") {
    throw new Error("task.routingDecision.evidenceSnapshot.scope must be exact-class, task-family, or none");
  }
  const exactSampleCounts: Record<string, number> = {};
  const rawExact = object(evidenceObj.exactSampleCounts, "task.routingDecision.evidenceSnapshot.exactSampleCounts");
  for (const [key, value] of Object.entries(rawExact)) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw new Error(`task.routingDecision.evidenceSnapshot.exactSampleCounts["${key}"] must be a non-negative integer`);
    }
    exactSampleCounts[key] = value;
  }
  let familySampleCounts: Record<string, number> | undefined;
  if (scope === "task-family") {
    if (evidenceObj.familySampleCounts === undefined) {
      throw new Error("task.routingDecision.evidenceSnapshot.familySampleCounts is required when scope is task-family");
    }
    familySampleCounts = {};
    const rawFamily = object(
      evidenceObj.familySampleCounts,
      "task.routingDecision.evidenceSnapshot.familySampleCounts",
    );
    for (const [key, value] of Object.entries(rawFamily)) {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new Error(`task.routingDecision.evidenceSnapshot.familySampleCounts["${key}"] must be a non-negative integer`);
      }
      familySampleCounts[key] = value;
    }
  }
  return {
    ...(taskFamily !== undefined ? { taskFamily } : {}),
    shortlist,
    selectedWorker,
    selectedBecause: { code: reasonCode, note: reasonNote },
    competition: { intent: intent as "none" | "consider" | "required", triggers },
    evidenceSnapshot: {
      scope,
      exactSampleCounts,
      ...(familySampleCounts === undefined ? {} : { familySampleCounts }),
      ...(evidenceObj.settingsDigest !== undefined
        ? { settingsDigest: stringValue(evidenceObj.settingsDigest, "task.routingDecision.evidenceSnapshot.settingsDigest") }
        : {}),
    },
  };
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function parseModules(value: unknown, label = "task.contract.modules"): TaskModuleContract[] {
  return objectArray(value, label).map((module, index) => ({
    name: stringValue(module.name, `${label}[${index}].name`),
    responsibility: stringValue(
      module.responsibility,
      `${label}[${index}].responsibility`,
    ),
    consumes: stringArray(module.consumes, `${label}[${index}].consumes`),
    produces: stringArray(module.produces, `${label}[${index}].produces`),
    boundaries: stringArray(module.boundaries, `${label}[${index}].boundaries`),
  }));
}

function parseScenarios(value: unknown): TaskScenarioContract[] {
  return objectArray(value, "task.contract.scenarios").map((scenario, index) => ({
    name: stringValue(scenario.name, `task.contract.scenarios[${index}].name`),
    given: stringValue(scenario.given, `task.contract.scenarios[${index}].given`),
    when: stringValue(scenario.when, `task.contract.scenarios[${index}].when`),
    then: stringValue(scenario.then, `task.contract.scenarios[${index}].then`),
  }));
}

/** Deliberately covers ordinary BCP-47 language/script/region/variant tags
 * without pretending to be a full language registry. The value is metadata,
 * not an instruction to translate the authored summary. */
export function isTaskPresentationLanguage(value: string): boolean {
  return value.length <= TASK_PRESENTATION_LANGUAGE_MAX
    && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/.test(value);
}

function parsePresentation(value: unknown): TaskPresentation | undefined {
  if (value === undefined) return undefined;
  const presentation = object(value, "task.contract.presentation");
  const keys = Object.keys(presentation);
  if (
    keys.length !== 2
    || !keys.includes("summary")
    || !keys.includes("language")
  ) {
    throw new Error("task.contract.presentation must contain exactly summary and language");
  }
  if (
    typeof presentation.summary !== "string"
    || presentation.summary.length === 0
    || presentation.summary.length > TASK_PRESENTATION_SUMMARY_MAX
    || presentation.summary !== presentation.summary.trim()
    || /[\r\n\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/.test(presentation.summary)
  ) {
    throw new Error(
      `task.contract.presentation.summary must be one trimmed paragraph of 1-${TASK_PRESENTATION_SUMMARY_MAX} characters`,
    );
  }
  if (
    typeof presentation.language !== "string"
    || presentation.language !== presentation.language.trim()
    || !isTaskPresentationLanguage(presentation.language)
  ) {
    throw new Error("task.contract.presentation.language must be a bounded BCP-47-like tag");
  }
  return {
    summary: presentation.summary,
    language: presentation.language,
  };
}

function parseContract(value: unknown): TaskContract {
  const contract = object(value, "task.contract");
  const changeBudget = object(contract.changeBudget, "task.contract.changeBudget");
  const presentation = parsePresentation(contract.presentation);
  return {
    outcome: stringValue(contract.outcome, "task.contract.outcome"),
    ...(presentation === undefined ? {} : { presentation }),
    context: stringArray(contract.context, "task.contract.context"),
    inScope: stringArray(contract.inScope, "task.contract.inScope"),
    outOfScope: stringArray(contract.outOfScope, "task.contract.outOfScope"),
    executionSteps: stringArray(contract.executionSteps, "task.contract.executionSteps"),
    deliverables: stringArray(contract.deliverables, "task.contract.deliverables"),
    modules: parseModules(contract.modules),
    callChain: stringArray(contract.callChain, "task.contract.callChain"),
    scenarios: parseScenarios(contract.scenarios),
    risks: stringArray(contract.risks, "task.contract.risks"),
    changeBudget: {
      maxFiles: positiveInteger(changeBudget.maxFiles, "task.contract.changeBudget.maxFiles"),
      maxDiffLines: positiveInteger(
        changeBudget.maxDiffLines,
        "task.contract.changeBudget.maxDiffLines",
      ),
    },
  };
}

function nonEmptyStringArray(value: unknown, label: string): string[] {
  const items = stringArray(value, label);
  if (items.length === 0) throw new Error(`${label} must contain at least one entry`);
  return items;
}

/** Strict structured background for the domain-neutral version-3 contract.
 *  Scalars are required non-empty strings; decision/authority lists must name
 *  at least one boundary. Every error names the exact field so Main can fix it. */
function parseBackground(value: unknown): TaskBackground {
  const background = object(value, "task.contract.background");
  return {
    purpose: stringValue(background.purpose, "task.contract.background.purpose"),
    audience: stringValue(background.audience, "task.contract.background.audience"),
    currentSituation: stringValue(
      background.currentSituation,
      "task.contract.background.currentSituation",
    ),
    parentGoalPlan: stringValue(
      background.parentGoalPlan,
      "task.contract.background.parentGoalPlan",
    ),
    priorDecisions: stringArray(
      background.priorDecisions,
      "task.contract.background.priorDecisions",
    ),
    suppliedInputs: stringArray(
      background.suppliedInputs,
      "task.contract.background.suppliedInputs",
    ),
    downstreamUse: stringValue(
      background.downstreamUse,
      "task.contract.background.downstreamUse",
    ),
    workerAuthority: nonEmptyStringArray(
      background.workerAuthority,
      "task.contract.background.workerAuthority",
    ),
    returnToMain: nonEmptyStringArray(
      background.returnToMain,
      "task.contract.background.returnToMain",
    ),
  };
}

/** Optional Coding-only technical detail. Absent for domain-neutral Tasks. */
function parseCodingExtension(value: unknown): TaskCodingExtension | undefined {
  if (value === undefined) return undefined;
  const coding = object(value, "task.contract.coding");
  const changeBudget = object(coding.changeBudget, "task.contract.coding.changeBudget");
  return {
    modules: parseModules(coding.modules, "task.contract.coding.modules"),
    callChain: stringArray(coding.callChain, "task.contract.coding.callChain"),
    changeBudget: {
      maxFiles: positiveInteger(changeBudget.maxFiles, "task.contract.coding.changeBudget.maxFiles"),
      maxDiffLines: positiveInteger(
        changeBudget.maxDiffLines,
        "task.contract.coding.changeBudget.maxDiffLines",
      ),
    },
  };
}

function parseContextContract(value: unknown): ContextTaskContract {
  const contract = object(value, "task.contract");
  const presentation = parsePresentation(contract.presentation);
  const coding = parseCodingExtension(contract.coding);
  return {
    outcome: stringValue(contract.outcome, "task.contract.outcome"),
    ...(presentation === undefined ? {} : { presentation }),
    background: parseBackground(contract.background),
    inScope: stringArray(contract.inScope, "task.contract.inScope"),
    outOfScope: stringArray(contract.outOfScope, "task.contract.outOfScope"),
    executionSteps: stringArray(contract.executionSteps, "task.contract.executionSteps"),
    deliverables: stringArray(contract.deliverables, "task.contract.deliverables"),
    scenarios: parseScenarios(contract.scenarios),
    risks: stringArray(contract.risks, "task.contract.risks"),
    ...(coding === undefined ? {} : { coding }),
  };
}

export function assessTaskQuality(spec: TaskSpec, quality?: ContractQualitySettings): QualityReport {
  return assessTaskQualityWithPolicy(
    spec,
    effectiveQualityPolicyFromGlobal(quality ?? cloneDefaults().contractQuality),
  );
}

export function assertTaskQuality(spec: TaskSpec, quality?: ContractQualitySettings): QualityReport {
  const report = assessTaskQuality(spec, quality);
  if (report.admitted !== true) {
    throw new Error(
      `Task Contract quality gate failed (${report.score}/100):\n${report.issues
        .map((issue) => `- ${issue}`)
        .join("\n")}`,
    );
  }
  return report;
}

export function parseTaskSpec(
  parsed: unknown,
  baseDirectory: string,
  policy?: TaskPolicy,
): TaskSpec {
  const root = object(parsed, "task");
  if (root.version !== 1 && root.version !== 2 && root.version !== 3) {
    throw new Error("task.version must be 1, 2, or 3");
  }

  const provider = object(root.provider ?? {}, "task.provider");
  const runtime = object(root.runtime ?? {}, "task.runtime");
  const workspace = object(root.workspace ?? {}, "task.workspace");
  const worker = object(root.worker ?? {}, "task.worker");
  const completionPolicy = object(root.completionPolicy ?? {}, "task.completionPolicy");
  const completionKeys = Object.keys(completionPolicy);
  if (completionKeys.some((key) => key !== "noChangeMode" && key !== "changeBudgetMode")) {
    throw new Error("task.completionPolicy contains an unsupported field");
  }
  const acceptance = object(root.acceptance ?? {}, "task.acceptance");
  const projectInput = stringValue(root.project, "task.project");
  const project = path.resolve(baseDirectory, expandHome(projectInput));

  const execSettings = policy?.execution ?? cloneDefaults().execution;
  const providerDefaults = policy?.providerDefaults ?? cloneDefaults().providerDefaults;
  // Named profiles: only auto-apply the default profile when the policy
  // explicitly carries workerProfiles (runtime settings). Legacy fixtures that
  // only override providerDefaults keep the previous defaultProvider/model path.
  const workerProfiles = policy?.workerProfiles;
  const modelCatalog = policy?.modelCatalog ?? cloneDefaults().modelCatalog;
  let profileDefaults: {
    provider?: string;
    runtime?: string;
    model?: string;
    endpoint?: string;
    effort?: string;
    maxBudgetUsd?: number | null;
    pricingRoute?: string;
    executionPreference?: string;
    networkPolicy?: WorkerNetworkPolicy;
  } = {};
  let selectedProfileId: string | undefined;
  const profileIdRaw = root.workerProfileId;
  if (profileIdRaw !== undefined) {
    if (typeof profileIdRaw !== "string" || profileIdRaw.trim() === "") {
      throw new Error("task.workerProfileId must be a non-empty string when supplied");
    }
    const profilesForId = workerProfiles ?? cloneDefaults().workerProfiles;
    const resolved = resolveWorkerSelection(
      { workerProfileId: profileIdRaw.trim() },
      {
        execution: execSettings,
        providerDefaults,
        workerProfiles: profilesForId,
        modelCatalog,
      },
    );
    selectedProfileId = resolved.profileId;
    profileDefaults = {
      provider: resolved.provider,
      runtime: resolved.runtime,
      model: resolved.model,
      endpoint: resolved.endpoint,
      effort: resolved.effort,
      maxBudgetUsd: resolved.maxBudgetUsd,
      ...(resolved.pricingRoute === undefined ? {} : { pricingRoute: resolved.pricingRoute }),
      ...(resolved.executionPreference === undefined
        ? {}
        : { executionPreference: resolved.executionPreference }),
      ...(resolved.networkPolicy === undefined ? {} : { networkPolicy: resolved.networkPolicy }),
    };
  } else if (
    workerProfiles !== undefined
    && provider.name === undefined
    && runtime.name === undefined
  ) {
    const resolved = resolveWorkerSelection(
      {},
      {
        execution: execSettings,
        providerDefaults,
        workerProfiles,
        ...(policy?.modelCatalog === undefined
          ? {}
          : { modelCatalog: policy.modelCatalog }),
      },
    );
    selectedProfileId = resolved.profileId;
    profileDefaults = {
      provider: resolved.provider,
      runtime: resolved.runtime,
      model: resolved.model,
      endpoint: resolved.endpoint,
      effort: resolved.effort,
      maxBudgetUsd: resolved.maxBudgetUsd,
      ...(resolved.pricingRoute === undefined ? {} : { pricingRoute: resolved.pricingRoute }),
      ...(resolved.executionPreference === undefined
        ? {}
        : { executionPreference: resolved.executionPreference }),
      ...(resolved.networkPolicy === undefined ? {} : { networkPolicy: resolved.networkPolicy }),
    };
  }
  const providerName = stringValue(
    provider.name,
    "task.provider.name",
    profileDefaults.provider ?? execSettings.defaultProvider,
  );
  if (!isProviderName(providerName)) {
    throw new Error(`Unsupported provider: ${providerName}. Supported providers: ${providerNames().join(", ")}`);
  }
  const providerDef = providerDefinition(providerName, providerDefaults);
  const defaultRuntime = profileDefaults.runtime ?? execSettings.defaultRuntime ?? "claude-code";
  const runtimeNameRaw = stringValue(runtime.name, "task.runtime.name", defaultRuntime);
  if (!isRuntimeName(runtimeNameRaw)) {
    throw new Error(
      `Unsupported runtime.name=${runtimeNameRaw}. Supported: ${supportedRuntimeNamesList()}`,
    );
  }
  const runtimeName: RuntimeName = runtimeNameRaw;
  assertProviderRuntimePair(providerName, runtimeName);
  const effort = stringValue(
    runtime.effort,
    "task.runtime.effort",
    profileDefaults.effort ?? execSettings.defaultEffort,
  );
  if (!["low", "medium", "high", "xhigh", "max"].includes(effort)) {
    throw new Error("task.runtime.effort must be low, medium, high, xhigh, or max");
  }
  if (selectedProfileId !== undefined) {
    const selectedProfile = (workerProfiles ?? cloneDefaults().workerProfiles).profiles
      .find((candidate) => candidate.id === selectedProfileId);
    const configuredModel = selectedProfile?.modelConfigId === undefined
      ? undefined
      : modelCatalog.models.find((candidate) => candidate.id === selectedProfile.modelConfigId);
    const effectiveModel = typeof provider.model === "string"
      ? provider.model
      : (profileDefaults.model ?? providerDef.defaultModel);
    if (
      configuredModel?.supportedEfforts !== undefined
      && providerName === configuredModel.provider
      && effectiveModel === configuredModel.model
      && !configuredModel.supportedEfforts.includes(effort as never)
    ) {
      throw new Error(
        `task.runtime.effort=${effort} is not supported by model config ${configuredModel.id}; supported: ${configuredModel.supportedEfforts.join("|")}`,
      );
    }
  }
  const maxBudgetUsd = (() => {
    const raw = runtime.maxBudgetUsd;
    if (raw === null) return null;
    // Worker-granular budget when profile selected and task omits runtime.maxBudgetUsd
    if (raw === undefined) {
      return profileDefaults.maxBudgetUsd !== undefined
        ? profileDefaults.maxBudgetUsd
        : execSettings.defaultMaxBudgetUsd;
    }
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
      throw new Error("task.runtime.maxBudgetUsd must be a positive number or null");
    }
    if (raw > execSettings.maximumBudgetUsd) {
      throw new Error(
        `task.runtime.maxBudgetUsd $${raw} exceeds configured maximum $${execSettings.maximumBudgetUsd}`,
      );
    }
    return raw;
  })();
  const workerAllowedCommands = stringArray(worker.allowedCommands, "task.worker.allowedCommands");
  if (workerAllowedCommands.length > 0) {
    throw new Error(
      "ForkLight requires task.worker.allowedCommands to be empty; acceptance commands run independently",
    );
  }
  const taskClass = (() => {
    const raw = root.taskClass;
    if (raw === undefined) return undefined;
    if (typeof raw !== "string" || raw.trim() === "" || raw.trim().length > 80)
      throw new Error("task.taskClass must be a non-empty string of at most 80 characters when supplied");
    return raw.trim();
  })();
  const taskFamily = (() => {
    const raw = root.taskFamily;
    if (raw === undefined) return undefined;
    if (typeof raw !== "string" || raw.trim() === "" || raw.trim().length > 80)
      throw new Error("task.taskFamily must be a non-empty string of at most 80 characters when supplied");
    return raw.trim();
  })();
  const routingDecision = (() => {
    const raw = root.routingDecision;
    if (raw === undefined) return undefined;
    return validateRoutingDecision(raw);
  })();
  const directCodexProfileId = (() => {
    const raw = root.directCodexProfileId;
    if (raw === undefined) return undefined;
    return normalizeDirectCodexProfileId(raw);
  })();
  const advancedPolicyOverride: TaskAdvancedPolicyOverride | undefined = (() => {
    const raw = root.advancedPolicy;
    if (raw === undefined) return undefined;
    return validateTaskAdvancedPolicyOverride(raw, "task.advancedPolicy");
  })();
  const defaultsCompletion = policy?.completionPolicy ?? cloneDefaults().completionPolicy;
  const completionPolicyMode = policyModeValue(
    completionPolicy.noChangeMode,
    "task.completionPolicy.noChangeMode",
    defaultsCompletion.noChangeMode,
  );
  const changeBudgetMode = policyModeValue(
    completionPolicy.changeBudgetMode,
    "task.completionPolicy.changeBudgetMode",
    defaultsCompletion.changeBudgetMode ?? "hard",
  );
  const acceptanceCommands = stringArray(acceptance.commands, "task.acceptance.commands");
  if (acceptanceCommands.length === 0) {
    throw new Error("task.acceptance.commands must contain at least one independent verification command");
  }
  const generatedPaths = generatedPathPatterns(workspace.generatedPaths);

  // --- Delivery resolution ---
  const deliveryProfileIdRaw = root.deliveryProfileId;
  let deliveryProfileId: string | undefined;
  if (deliveryProfileIdRaw !== undefined) {
    if (typeof deliveryProfileIdRaw !== "string" || deliveryProfileIdRaw.trim() === "") {
      throw new Error("task.deliveryProfileId must be a non-empty string when supplied");
    }
    deliveryProfileId = deliveryProfileIdRaw.trim();
  }

  const inlineDelivery = deliverySpec(root.delivery);

  // Conflict: both inline delivery and explicit profile id
  if (inlineDelivery !== undefined && deliveryProfileId !== undefined) {
    throw new Error(
      "task.delivery and task.deliveryProfileId are mutually exclusive; remove one",
    );
  }

  let resolvedDelivery: DeliverySpec | undefined;
  let deliveryResolution: DeliveryResolution | undefined;
  const deliverySettings = policy?.deliveryProfiles ?? cloneDefaults().deliveryProfiles;

  if (deliveryProfileId !== undefined) {
    // Explicit profile id — selectDeliveryProfile fails closed on malformed/missing
    const selection = selectDeliveryProfile(deliverySettings, project, deliveryProfileId);
    if (!selection) throw new Error("Delivery profile resolution failed");
    resolvedDelivery = {
      buildCommands: [...selection.profile.buildCommands],
      activationCommands: [...selection.profile.activationCommands],
      activationCheckCommands: [...selection.profile.activationCheckCommands],
    };
    deliveryResolution = {
      source: selection.provenance,
      profileId: selection.profile.id,
    };
  } else if (inlineDelivery !== undefined) {
    // Inline delivery — no profile resolution
    resolvedDelivery = inlineDelivery;
    deliveryResolution = { source: "inline" };
  } else {
    // Implicit resolution: project binding → default → null
    const selection = selectDeliveryProfile(deliverySettings, project);
    if (selection !== null) {
      resolvedDelivery = {
        buildCommands: [...selection.profile.buildCommands],
        activationCommands: [...selection.profile.activationCommands],
        activationCheckCommands: [...selection.profile.activationCheckCommands],
      };
      deliveryResolution = {
        source: selection.provenance,
        profileId: selection.profile.id,
      };
    }
  }

  const explicitPricingRoute = provider.pricingRoute === undefined
    ? undefined
    : stringValue(provider.pricingRoute, "task.provider.pricingRoute");
  if (explicitPricingRoute !== undefined && !isPricingRouteId(explicitPricingRoute)) {
    throw new Error("task.provider.pricingRoute must be a bounded non-empty identifier");
  }
  // Explicit Provider or endpoint selection changes the billing identity.
  // Require an explicit route for that override instead of inheriting a stale one.
  const inheritedPricingRoute = provider.name === undefined && provider.endpoint === undefined
    ? profileDefaults.pricingRoute
    : undefined;

  // --- Execution mode resolution ---
  // A saved per-Worker preference is turned into one immutable per-Task mode
  // before admission. Explicit Task override wins over the selected Worker
  // Profile; legacy Tasks with no preference freeze single-run. `auto` may fall
  // back; forced `native-goal` fails closed when the Runtime cannot prove it.
  const taskExecutionPreference = (() => {
    const raw = root.executionPreference;
    if (raw === undefined) return undefined;
    if (typeof raw !== "string" || !isExecutionPreference(raw)) {
      throw new Error("task.executionPreference must be auto, single-run, or native-goal");
    }
    return raw as ExecutionPreference;
  })();
  const effectiveExecutionPreference: ExecutionPreference | undefined =
    taskExecutionPreference ?? profileDefaults.executionPreference as ExecutionPreference | undefined;
  const executionResolution = resolveExecutionMode(
    effectiveExecutionPreference,
    nativeGoalSupportForRuntime(runtimeName),
  );
  const frozenExecutionPreference: ExecutionPreference = executionResolution.preference;
  const frozenExecutionMode: ResolvedExecutionMode = executionResolution.mode;

  // --- Network policy resolution ---
  // A saved per-Worker route is turned into one immutable per-Task snapshot
  // before admission. Explicit Task override wins over the selected Worker
  // Profile; legacy Tasks with no field (and no profile field) freeze inherit
  // so the Daemon environment is preserved exactly as before. Later settings
  // edits can never rewrite an existing Task or its resumed Attempts.
  const taskNetworkPolicyOverride = (() => {
    const raw = root.networkPolicy;
    if (raw === undefined) return undefined;
    return validateWorkerNetworkPolicy(raw, "task.networkPolicy");
  })();
  const frozenNetworkPolicy = freezeWorkerNetworkPolicy(
    taskNetworkPolicyOverride
      ?? profileDefaults.networkPolicy
      ?? { mode: "inherit" },
  );

  const common = {
    name: stringValue(root.name, "task.name"),
    project,
    provider: {
      name: providerName,
      model: stringValue(
        provider.model,
        "task.provider.model",
        profileDefaults.model ?? providerDef.defaultModel,
      ),
      endpoint: provider.endpoint !== undefined
        ? stringValue(provider.endpoint, "task.provider.endpoint")
        : (profileDefaults.endpoint ?? providerDef.defaultEndpoint),
      keychainService: stringValue(
        provider.keychainService,
        "task.provider.keychainService",
        providerDef.defaultKeychainService,
      ),
      ...(provider.keychainAccount === undefined
        ? {}
        : { keychainAccount: stringValue(provider.keychainAccount, "task.provider.keychainAccount") }),
      ...(explicitPricingRoute !== undefined
        ? { pricingRoute: explicitPricingRoute }
        : inheritedPricingRoute !== undefined
          ? { pricingRoute: inheritedPricingRoute }
          : {}),
    },
    runtime: {
      name: runtimeName,
      executable: stringValue(
        runtime.executable,
        "task.runtime.executable",
        defaultExecutableForRuntime(runtimeName),
      ),
      effort: effort as "low" | "medium" | "high" | "xhigh" | "max",
      maxBudgetUsd,
    },
    workspace: {
      exclude: Array.from(
        new Set([...DEFAULT_EXCLUDES, ...snapshotExcludeNames(workspace.exclude)]),
      ),
      ...(generatedPaths === undefined ? {} : { generatedPaths }),
    },
    worker: {
      allowEdits: booleanValue(worker.allowEdits, "task.worker.allowEdits", true),
      allowedCommands: workerAllowedCommands,
      focusPaths: stringArray(worker.focusPaths, "task.worker.focusPaths"),
    },
    ...(resolvedDelivery === undefined ? {} : { delivery: resolvedDelivery }),
    ...(deliveryResolution === undefined ? {} : { deliveryResolution }),
    ...(taskClass !== undefined ? { taskClass } : {}),
    ...(taskFamily !== undefined ? { taskFamily } : {}),
    ...(routingDecision !== undefined ? { routingDecision } : {}),
    ...(directCodexProfileId !== undefined ? { directCodexProfileId } : {}),
    ...(selectedProfileId !== undefined ? { workerProfileId: selectedProfileId } : {}),
    ...(advancedPolicyOverride !== undefined ? { advancedPolicyOverride } : {}),
    completionPolicy: {
      noChangeMode: completionPolicyMode,
      changeBudgetMode,
    },
    executionPreference: frozenExecutionPreference,
    executionMode: frozenExecutionMode,
    networkPolicy: frozenNetworkPolicy,
  };

  // Post-resolve validation: routingDecision must bind to the resolved Task identity.
  if (routingDecision !== undefined) {
    const sw = routingDecision.selectedWorker;
    // selectedWorker must be in the shortlist by frozen identity match.
    const inShortlist = routingDecision.shortlist.some(
      (w) => w.provider === sw.provider && w.model === sw.model
        && w.runtime === sw.runtime && w.effort === sw.effort,
    );
    if (!inShortlist) {
      throw new Error(
        "task.routingDecision.selectedWorker must match an entry in the shortlist by provider, model, runtime, and effort",
      );
    }
    // selectedWorker must match the resolved Task identity.
    if (sw.provider !== common.provider.name) {
      throw new Error(
        `task.routingDecision.selectedWorker.provider "${sw.provider}" does not match resolved Task provider "${common.provider.name}"`,
      );
    }
    if (sw.model !== common.provider.model) {
      throw new Error(
        `task.routingDecision.selectedWorker.model "${sw.model}" does not match resolved Task model "${common.provider.model}"`,
      );
    }
    if (sw.runtime !== common.runtime.name) {
      throw new Error(
        `task.routingDecision.selectedWorker.runtime "${sw.runtime}" does not match resolved Task runtime "${common.runtime.name}"`,
      );
    }
    if (sw.effort !== common.runtime.effort) {
      throw new Error(
        `task.routingDecision.selectedWorker.effort "${sw.effort}" does not match resolved Task effort "${common.runtime.effort}"`,
      );
    }
    if (sw.workerProfileId !== undefined && sw.workerProfileId !== common.workerProfileId) {
      throw new Error(
        `task.routingDecision.selectedWorker.workerProfileId "${sw.workerProfileId}" does not match resolved Task Worker Profile "${common.workerProfileId ?? "none"}"`,
      );
    }
    // taskFamily must be consistent.
    if (routingDecision.taskFamily !== undefined && routingDecision.taskFamily !== common.taskFamily) {
      throw new Error(
        "task.taskFamily and task.routingDecision.taskFamily must be identical when both are present",
      );
    }
  }

  if (root.version === 1) {
    return {
      version: 1,
      ...common,
      goal: stringValue(root.goal, "task.goal"),
      constraints: stringArray(root.constraints, "task.constraints"),
      acceptance: { commands: acceptanceCommands },
    };
  }

  const qualityPolicy = deriveEffectiveQualityPolicy(selectedProfileId, {
    contractQuality: policy?.contractQuality ?? cloneDefaults().contractQuality,
    workerProfiles: workerProfiles ?? cloneDefaults().workerProfiles,
  });

  if (root.version === 3) {
    const spec: ContextContractTaskSpec = {
      version: 3,
      ...common,
      contract: parseContextContract(root.contract),
      acceptance: {
        criteria: stringArray(acceptance.criteria, "task.acceptance.criteria"),
        commands: acceptanceCommands,
      },
    };
    spec.qualityPolicy = qualityPolicy;
    assertTaskQualityWithPolicy(spec, qualityPolicy);
    return spec;
  }

  const spec: ContractTaskSpec = {
    version: 2,
    ...common,
    contract: parseContract(root.contract),
    acceptance: {
      criteria: stringArray(acceptance.criteria, "task.acceptance.criteria"),
      commands: acceptanceCommands,
    },
  };
  spec.qualityPolicy = qualityPolicy;
  assertTaskQualityWithPolicy(spec, qualityPolicy);
  return spec;
}

export async function loadTaskSpec(
  taskFileInput: string,
  policy?: TaskPolicy,
): Promise<{ taskFile: string; taskFileDigest: string; spec: TaskSpec }> {
  const taskFile = path.resolve(expandHome(taskFileInput));
  const rawText = await readFile(taskFile, "utf8");
  const taskFileDigest = createHash("sha256").update(rawText).digest("hex");
  const parsed = taskFile.endsWith(".json") ? JSON.parse(rawText) : YAML.parse(rawText);
  const spec = parseTaskSpec(parsed, path.dirname(taskFile), policy);
  await access(spec.project, constants.R_OK);
  return { taskFile, taskFileDigest, spec };
}

/**
 * Runtime tool-surface policy for hard-boundary wording.
 * Defaults keep Claude/Grok on the tool-only/no-shell contract. Codex uses a
 * workspace-sandboxed command tool for inspect/search/edit, so its wording must
 * not forbid the only path it can use while still denying host shell expansion.
 */
export type WorkerHardBoundaryPolicy =
  | { kind: "tool-only-no-shell" }
  | { kind: "codex-workspace-command"; allowEdits: boolean }
  | { kind: "codex-native-goal-command"; allowEdits: boolean };

/** Compose hard boundaries that match the selected Runtime's real tool surface.
 *  Runtime-specific wording may narrow authority but cannot override isolation,
 *  acceptance, Git, or delivery prohibitions. */
export function hardBoundaries(
  policy: WorkerHardBoundaryPolicy = { kind: "tool-only-no-shell" },
): string[] {
  // Codex workspace-write may still use runtime-private temporary storage
  // (task TMPDIR) while product file work stays inside the Task workspace.
  // Do not claim a narrower write surface than the frozen sandbox enforces.
  const toolAuthority = policy.kind === "codex-workspace-command"
    ? policy.allowEdits
      ? "Use only Codex's workspace-sandboxed command tool for product file inspect, search, and edit inside this isolated Task workspace under workspace-write. Command network access is disabled. Keep product changes inside the Task workspace; do not use global /tmp, host paths, or the source tree for product work. Runtime-private temporary storage is for process needs only. Unrestricted host shell, approval escalation, extra product writable roots, web, apps, MCP, nested agents, source Integration, commit, and push remain forbidden."
      : "Use only Codex's workspace-sandboxed command tool for product file inspect and search inside this isolated Task workspace under read-only. Do not edit product files. Command network access is disabled. Do not use global /tmp, host paths, or the source tree for product work. Runtime-private temporary storage is for process needs only. Unrestricted host shell, approval escalation, extra product writable roots, web, apps, MCP, nested agents, source Integration, commit, and push remain forbidden."
    : policy.kind === "codex-native-goal-command"
      ? policy.allowEdits
        ? "Use only Codex's workspace-sandboxed command tool for product file inspect, search, edit, and the Worker self-check inside this isolated Task workspace under workspace-write. Command network access is disabled. Keep product changes inside the Task workspace; do not use global /tmp, host paths, or the source tree for product work. Runtime-private temporary storage is for process needs only. Unrestricted host shell, approval escalation, extra product writable roots, web, apps, MCP, nested agents, source Integration, commit, and push remain forbidden."
        : "Use only Codex's workspace-sandboxed command tool for product file inspect, search, and the Worker self-check inside this isolated Task workspace under read-only. Do not edit product files. Command network access is disabled. Do not use global /tmp, host paths, or the source tree for product work. Runtime-private temporary storage is for process needs only. Unrestricted host shell, approval escalation, extra product writable roots, web, apps, MCP, nested agents, source Integration, commit, and push remain forbidden."
      : "Shell access is intentionally unavailable. Do not attempt to run commands.";
  return [
    "Work only inside the current workspace.",
    "Read the task-owned .forklight/workspace-context.md, but do not read or modify ForkLight state outside the workspace.",
    "Never commit, push, create a pull request, or change Git remotes.",
    toolAuthority,
    "ForkLight will run the acceptance commands independently after you finish.",
    "Inspect the final changes before reporting completion.",
  ];
}

/** Claude Code tool protocol lines (Worker appendix). */
export function claudeToolProtocolLines(focusPaths: string[]): string[] {
  return [
    "First read .forklight/workspace-context.md; it contains the complete snapshot file index.",
    ...(focusPaths.length === 0
      ? []
      : [
          `Inspect these agreed entry points first: ${focusPaths.join(", ")}.`,
          "Inspect outside the focus paths only when a referenced symbol or failing evidence requires it.",
        ]),
    "Use Glob to discover directory contents; Read accepts files, not directory paths.",
    "Use Grep to find symbols and call sites before guessing file locations.",
    "Use Write to create a new file; Edit only changes a file that already exists.",
    "If a tool call fails, correct the tool or path instead of weakening the agreed module boundaries.",
  ];
}

/** Neutral tool protocol when a non-CC runtime supplies no CC-specific names. */
export function neutralToolProtocolLines(focusPaths: string[]): string[] {
  return [
    "First read .forklight/workspace-context.md; it contains the complete snapshot file index.",
    ...(focusPaths.length === 0
      ? []
      : [
          `Inspect these agreed entry points first: ${focusPaths.join(", ")}.`,
          "Inspect outside the focus paths only when a referenced symbol or failing evidence requires it.",
        ]),
    "Use only the file-read, search, and file-edit tools permitted by this Worker runtime.",
    "Do not use unrestricted shell, web browsing, or nested agents unless the runtime policy explicitly allows them.",
    "If a tool call fails, correct the tool or path instead of weakening the agreed module boundaries.",
  ];
}

function feedbackSection(feedback?: string): string[] {
  return feedback
    ? [
        "",
        "Correction feedback from independent verification or main agent review:",
        feedback,
        "Address this evidence directly before reporting completion again.",
      ]
    : [];
}

/** Claude Code checkpoint MCP protocol lines (Worker appendix). */
export function claudeCheckpointProtocolLines(acceptanceCommands: string[]): string[] {
  const ids = acceptanceCommands.map((_, i) => `acceptance-${i + 1}`);
  return [
    "",
    "Bounded checkpoint (non-authoritative Worker self-check):",
    "- After your final edit, call mcp__forklight_checkpoint__run once when the tool is available.",
    `- Pass every approved command id: ${ids.join(", ")}.`,
    "- ForkLight independently reruns every acceptance command; that result is authoritative for success.",
    "- If the checkpoint tool is unavailable, partial, or fails, mark the Worker self-validation as unverified; do not claim a machine-green self-check or invent a fake pass.",
  ];
}

/** Render the change-budget instruction block truthfully for the frozen
 *  changeBudgetMode. Only hard (and the legacy hard fallback when the field is
 *  absent) describes the budget as a hard gate with a stop-and-report
 *  instruction; warn, score, and off keep the configured file/line values
 *  visible but describe their real non-blocking enforcement, so the Worker
 *  never trims correctness or scope merely to fit the numbers. The agreed
 *  scope, hard boundaries, and independent acceptance stay authoritative in
 *  every mode. Mirrors the verifier's per-mode effect (hard-fail / warning /
 *  score-evidence / ignored) without touching verifier authority. */
function changeBudgetBlock(
  budget: { maxFiles: number; maxDiffLines: number },
  mode: PolicyMode,
): string[] {
  const { maxFiles, maxDiffLines } = budget;
  const limits = [
    `- At most ${maxFiles} changed files`,
    `- At most ${maxDiffLines} added/deleted lines`,
  ];
  const authoritative =
    "- The agreed scope, hard boundaries, and independent acceptance remain authoritative.";
  switch (mode) {
    case "hard":
      return [
        "Hard change budget:",
        ...limits,
        "- If the implementation cannot fit, stop and report the missing decomposition instead of expanding scope.",
      ];
    case "warn":
      return [
        "Change budget guidance (warn):",
        ...limits,
        "- These figures are guidance only; an overrun is a warning, not a Task failure.",
        "- Finish the agreed scoped behavior and report the overrun; do not sacrifice correctness or scope to fit the numbers.",
        authoritative,
      ];
    case "score":
      return [
        "Change budget evidence (score):",
        ...limits,
        "- Size is evaluation evidence, not a pass/fail gate; an overrun does not stop or fail the Task.",
        "- Keep the agreed scope and acceptance authoritative; do not trim behavior to fit the numbers.",
        authoritative,
      ];
    case "off":
      return [
        "Change budget reference (off):",
        ...limits,
        "- Change-budget enforcement is disabled; these figures are reference only.",
        "- Keep the agreed scope and acceptance authoritative; do not expand scope beyond the bounded contract.",
        authoritative,
      ];
  }
}

function buildLegacyPrompt(
  spec: Extract<TaskSpec, { version: 1 }>,
  resuming: boolean,
  feedback?: string,
  appendices?: WorkerPromptAppendices,
): string {
  const toolLines = appendices?.toolLines ?? claudeToolProtocolLines(spec.worker.focusPaths);
  const checkpointLines = appendices?.checkpointLines !== undefined
    ? appendices.checkpointLines
    : claudeCheckpointProtocolLines(spec.acceptance.commands);
  const boundaryLines = hardBoundaries(
    appendices?.hardBoundaryPolicy ?? { kind: "tool-only-no-shell" },
  );
  const lines = [
    resuming
      ? "Resume the previously interrupted bounded coding task from the existing session."
      : "Execute this bounded coding task in the current isolated workspace.",
    "",
    `Task: ${spec.name}`,
    `Goal: ${spec.goal}`,
    "",
    "Tool protocol:",
    ...toolLines.map((instruction) =>
      instruction.startsWith("- ") || instruction.startsWith("  ")
        ? instruction
        : `- ${instruction}`),
    "",
    "Hard boundaries:",
    ...boundaryLines.map((boundary) => `- ${boundary}`),
    ...spec.constraints.map((constraint) => `- ${constraint}`),
    "",
    "Acceptance commands ForkLight will run after you finish:",
    ...spec.acceptance.commands.map((command) => `- ${command}`),
    ...checkpointLines,
    ...(appendices?.validationRepairLines ?? []),
    ...feedbackSection(feedback),
  ];
  return lines.join("\n");
}

export interface WorkerPromptAppendices {
  /** Tool protocol body lines (without the "Tool protocol:" header). */
  toolLines?: string[];
  /** Checkpoint section lines including blank first line if non-empty. */
  checkpointLines?: string[];
  /** Runtime-specific Worker validation contract. It is intentionally
   * separate from independent verification authority. */
  validationRepairLines?: string[];
  /**
   * When set, replaces the generic final coding-summary instruction.
   * Used only for durably identified Review Graph reviewer Tasks.
   */
  terminalOutputLines?: string[];
  /**
   * Runtime-aware hard-boundary policy. Defaults to tool-only/no-shell so
   * Claude Code and Grok keep their existing contract when callers omit it.
   */
  hardBoundaryPolicy?: WorkerHardBoundaryPolicy;
}

/** Durable internal namespace for Review Graph reviewer Tasks (not user content). */
export const REVIEW_GRAPH_TASK_FILE_PREFIX = "forklight://review-graph/";

/** True when taskFile is the durable Review Graph reviewer namespace marker. */
export function isReviewGraphReviewerTaskFile(taskFile: string): boolean {
  return typeof taskFile === "string"
    && taskFile.startsWith(REVIEW_GRAPH_TASK_FILE_PREFIX);
}

/**
 * Final prompt instruction for Review Graph reviewer Tasks.
 * Replaces the generic coding-summary so judges emit one raw JSON object.
 * Numeric bounds reuse Review Graph parser constants (single source of truth).
 */
export function reviewerTerminalOutputLines(): string[] {
  return [
    "Terminal output requirement:",
    "- Return exactly one raw JSON object and nothing else.",
    "- The object must include only: schemaVersion, reviewedRevisionId, proposedDisposition, summary, findings.",
    `- ${reviewerOutputBoundsLine()}`,
    "- Do not wrap the object in Markdown fences, and do not add prose, a coding summary, or a files-changed list before or after it.",
    "- Do not return a generic summary of files changed, contract behavior, or remaining risks.",
  ];
}

/** Generic terminal instruction for ordinary (non-reviewer) Tasks. */
export const GENERIC_CODING_SUMMARY_INSTRUCTION =
  "Return a concise summary containing: files changed, contract behavior delivered, verification evidence, and remaining risks.";

/**
 * Build appendices for a runtime adapter. Review Graph reviewer Tasks receive
 * an explicit terminal-output override; ordinary Tasks are unchanged.
 */
export function workerPromptAppendicesForTask(
  task: { taskFile: string },
  appendices: WorkerPromptAppendices = {},
): WorkerPromptAppendices {
  if (!isReviewGraphReviewerTaskFile(task.taskFile)) return appendices;
  return {
    ...appendices,
    terminalOutputLines: appendices.terminalOutputLines ?? reviewerTerminalOutputLines(),
  };
}

/**
 * Prompt/checkpoint contract for the finite Worker-owned validation loop.
 * Command ids are generated from the original acceptance list, preserving
 * order and preventing a repair from silently substituting a partial suite.
 */
export function workerValidationRepairProtocolLines(
  acceptanceCommands: string[],
  runtime: "codex" | "claude" | "grok",
): string[] {
  const ids = acceptanceCommands.map((_, index) => `acceptance-${index + 1}`);
  if (runtime === "codex") {
    return [
      "",
      "Worker validation self-check:",
      "- After the final edit, use the workspace-sandboxed command tool to run every original acceptance command yourself in this exact order:",
      ...acceptanceCommands.map((command, index) => `  ${ids[index]}: ${command}`),
      "- This self-check is non-authoritative; ForkLight independently reruns the unchanged complete suite before Main review.",
    ];
  }
  if (runtime === "claude") {
    return [
      "",
      "Worker validation self-check:",
      "- After the final edit, call the supported ForkLight checkpoint once with every original command id in this exact order:",
      `  ${ids.join(", ")}`,
      "- A missing or partial checkpoint is unverified evidence, never a machine-green claim; ForkLight still independently reruns the unchanged complete suite.",
    ];
  }
  return [
    "",
    "Worker validation self-check:",
    "- This Runtime does not support ForkLight checkpoint MCP; do not claim a checkpoint or invent one.",
    "- ForkLight independently reruns every original acceptance command in order; the result remains authoritative before Main review.",
  ];
}

export function buildWorkerPrompt(
  spec: TaskSpec,
  resuming: boolean,
  feedback?: string,
  appendices?: WorkerPromptAppendices,
): string {
  if (spec.version === 1) return buildLegacyPrompt(spec, resuming, feedback, appendices);
  // Default appendices stay Claude-compatible for direct callers; adapters pass explicit lines.
  const toolLines = appendices?.toolLines
    ?? claudeToolProtocolLines(spec.worker.focusPaths);
  const checkpointLines = appendices?.checkpointLines !== undefined
    ? appendices.checkpointLines
    : claudeCheckpointProtocolLines(spec.acceptance.commands);
  const terminalOutputLines = appendices?.terminalOutputLines;
  const boundaryLines = hardBoundaries(
    appendices?.hardBoundaryPolicy ?? { kind: "tool-only-no-shell" },
  );
  const lines = [
    resuming
      ? "Resume the previously interrupted task using the agreed execution contract."
      : "Execute this bounded task using the agreed execution contract.",
    "",
    `Task: ${spec.name}`,
    `Observable outcome: ${spec.contract.outcome}`,
    ...(spec.contract.presentation === undefined
      ? []
      : [
          "",
          "Main-authored user explanation (context only; the technical contract and acceptance remain authoritative):",
          `- Summary: ${spec.contract.presentation.summary}`,
          `- Language: ${spec.contract.presentation.language}`,
        ]),
    "",
    "Tool protocol:",
    ...toolLines.map((instruction) =>
      instruction.startsWith("- ") || instruction.startsWith("  ")
        ? instruction
        : `- ${instruction}`),
    "",
  ];

  // Version-3 Tasks lead with the required structured background; legacy v2
  // keeps its exact free-form Context block byte-for-byte.
  if (spec.version === 3) {
    const background = spec.contract.background;
    lines.push("Background:");
    lines.push(`- Why this matters: ${background.purpose}`);
    lines.push(`- Who or what it serves: ${background.audience}`);
    lines.push(`- Current situation: ${background.currentSituation}`);
    lines.push(`- Parent Goal/Plan: ${background.parentGoalPlan}`);
    if (background.priorDecisions.length > 0) {
      lines.push("- Prior decisions:");
      for (const decision of background.priorDecisions) lines.push(`  - ${decision}`);
    }
    if (background.suppliedInputs.length > 0) {
      lines.push("- Supplied inputs:");
      for (const input of background.suppliedInputs) lines.push(`  - ${input}`);
    }
    lines.push(`- How the output is used: ${background.downstreamUse}`);
    lines.push("- Worker authority:");
    for (const authority of background.workerAuthority) lines.push(`  - ${authority}`);
    lines.push("- Decisions that must return to Main:");
    for (const decision of background.returnToMain) lines.push(`  - ${decision}`);
    lines.push("");
  } else {
    lines.push("Context:");
    lines.push(...spec.contract.context.map((item) => `- ${item}`));
    lines.push("");
  }

  lines.push(
    "In scope:",
    ...spec.contract.inScope.map((item) => `- ${item}`),
    "",
    "Out of scope:",
    ...spec.contract.outOfScope.map((item) => `- ${item}`),
    "",
    "Execution steps:",
    ...spec.contract.executionSteps.map((item, index) => `${index + 1}. ${item}`),
    "",
    "Deliverables:",
    ...spec.contract.deliverables.map((item) => `- ${item}`),
    "",
  );

  // Version-3 Tasks isolate Coding-only module/call-chain detail in the optional
  // extension; v2 keeps its exact "Module contracts" block byte-for-byte.
  if (spec.version === 3) {
    const coding = spec.contract.coding;
    if (coding !== undefined) {
      lines.push("Coding detail:");
      for (const module of coding.modules) {
        lines.push(
          `- ${module.name}: ${module.responsibility}`,
          `  consumes: ${module.consumes.join("; ")}`,
          `  produces: ${module.produces.join("; ")}`,
          `  boundaries: ${module.boundaries.join("; ")}`,
        );
      }
      lines.push("", "Call chain:", ...coding.callChain.map((item, index) => `${index + 1}. ${item}`));
    }
  } else {
    lines.push("Module contracts:");
    for (const module of spec.contract.modules) {
      lines.push(
        `- ${module.name}: ${module.responsibility}`,
        `  consumes: ${module.consumes.join("; ")}`,
        `  produces: ${module.produces.join("; ")}`,
        `  boundaries: ${module.boundaries.join("; ")}`,
      );
    }
    lines.push("", "Call chain:", ...spec.contract.callChain.map((item, index) => `${index + 1}. ${item}`));
  }

  lines.push("", "Scenarios:");
  for (const scenario of spec.contract.scenarios) {
    lines.push(
      `- ${scenario.name}`,
      `  Given: ${scenario.given}`,
      `  When: ${scenario.when}`,
      `  Then: ${scenario.then}`,
    );
  }
  lines.push("", "Known risks:", ...spec.contract.risks.map((item) => `- ${item}`));

  // Change budget is Coding-only for v3; v2 always carries it.
  if (spec.version === 3) {
    if (spec.contract.coding !== undefined) {
      lines.push(
        "",
        ...changeBudgetBlock(spec.contract.coding.changeBudget, spec.completionPolicy?.changeBudgetMode ?? "hard"),
      );
    }
  } else {
    lines.push(
      "",
      ...changeBudgetBlock(spec.contract.changeBudget, spec.completionPolicy?.changeBudgetMode ?? "hard"),
    );
  }

  lines.push(
    "",
    "Hard boundaries:",
    ...boundaryLines.map((boundary) => `- ${boundary}`),
    "",
    "Behavioral acceptance criteria:",
    ...spec.acceptance.criteria.map((criterion) => `- ${criterion}`),
    "",
    "Independent acceptance commands:",
    ...spec.acceptance.commands.map((command) => `- ${command}`),
    ...checkpointLines,
    ...(appendices?.validationRepairLines ?? []),
    ...feedbackSection(feedback),
    "",
    ...(terminalOutputLines !== undefined && terminalOutputLines.length > 0
      ? terminalOutputLines
      : [GENERIC_CODING_SUMMARY_INSTRUCTION]),
  );
  return lines.join("\n");
}
