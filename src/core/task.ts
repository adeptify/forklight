import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { isProviderName, providerDefinition, providerNames } from "./providers.js";
import { normalizeDirectCodexProfileId } from "./direct-codex-calibration.js";
import {
  assertProviderRuntimePair,
  isRuntimeName,
  supportedRuntimeNamesList,
  type RuntimeName,
} from "./runtime-names.js";
import { isPricingRouteId, resolveWorkerSelection } from "./worker-profiles.js";
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
import type {
  ContractTaskSpec,
  DeliveryResolution,
  DeliverySpec,
  QualityReport,
  TaskAdvancedPolicyOverride,
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

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function parseModules(value: unknown): TaskModuleContract[] {
  return objectArray(value, "task.contract.modules").map((module, index) => ({
    name: stringValue(module.name, `task.contract.modules[${index}].name`),
    responsibility: stringValue(
      module.responsibility,
      `task.contract.modules[${index}].responsibility`,
    ),
    consumes: stringArray(module.consumes, `task.contract.modules[${index}].consumes`),
    produces: stringArray(module.produces, `task.contract.modules[${index}].produces`),
    boundaries: stringArray(module.boundaries, `task.contract.modules[${index}].boundaries`),
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
  if (root.version !== 1 && root.version !== 2) throw new Error("task.version must be 1 or 2");

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
        runtimeName === "grok-build" ? "grok" : "claude",
      ),
      effort: effort as "low" | "medium" | "high" | "xhigh" | "max",
      maxBudgetUsd,
    },
    workspace: {
      exclude: Array.from(
        new Set([...DEFAULT_EXCLUDES, ...stringArray(workspace.exclude, "task.workspace.exclude")]),
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
    ...(directCodexProfileId !== undefined ? { directCodexProfileId } : {}),
    ...(selectedProfileId !== undefined ? { workerProfileId: selectedProfileId } : {}),
    ...(advancedPolicyOverride !== undefined ? { advancedPolicyOverride } : {}),
    completionPolicy: {
      noChangeMode: completionPolicyMode,
      changeBudgetMode,
    },
  };

  if (root.version === 1) {
    return {
      version: 1,
      ...common,
      goal: stringValue(root.goal, "task.goal"),
      constraints: stringArray(root.constraints, "task.constraints"),
      acceptance: { commands: acceptanceCommands },
    };
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
  const qualityPolicy = deriveEffectiveQualityPolicy(selectedProfileId, {
    contractQuality: policy?.contractQuality ?? cloneDefaults().contractQuality,
    workerProfiles: workerProfiles ?? cloneDefaults().workerProfiles,
  });
  spec.qualityPolicy = qualityPolicy;
  assertTaskQualityWithPolicy(spec, qualityPolicy);
  return spec;
}

export async function loadTaskSpec(
  taskFileInput: string,
  policy?: TaskPolicy,
): Promise<{ taskFile: string; spec: TaskSpec }> {
  const taskFile = path.resolve(expandHome(taskFileInput));
  const rawText = await readFile(taskFile, "utf8");
  const parsed = taskFile.endsWith(".json") ? JSON.parse(rawText) : YAML.parse(rawText);
  const spec = parseTaskSpec(parsed, path.dirname(taskFile), policy);
  await access(spec.project, constants.R_OK);
  return { taskFile, spec };
}

function hardBoundaries(): string[] {
  return [
    "Work only inside the current workspace.",
    "Read the task-owned .forklight/workspace-context.md, but do not read or modify ForkLight state outside the workspace.",
    "Never commit, push, create a pull request, or change Git remotes.",
    "Shell access is intentionally unavailable. Do not attempt to run commands.",
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
    "- If the checkpoint tool is unavailable or fails, still report completion after fixing issues you can see; do not invent a fake pass.",
  ];
}

function buildLegacyPrompt(
  spec: Extract<TaskSpec, { version: 1 }>,
  resuming: boolean,
  feedback?: string,
): string {
  const lines = [
    resuming
      ? "Resume the previously interrupted bounded coding task from the existing session."
      : "Execute this bounded coding task in the current isolated workspace.",
    "",
    `Task: ${spec.name}`,
    `Goal: ${spec.goal}`,
    "",
    "Tool protocol:",
    ...claudeToolProtocolLines(spec.worker.focusPaths).map((instruction) => `- ${instruction}`),
    "",
    "Hard boundaries:",
    ...hardBoundaries().map((boundary) => `- ${boundary}`),
    ...spec.constraints.map((constraint) => `- ${constraint}`),
    "",
    "Acceptance commands ForkLight will run after you finish:",
    ...spec.acceptance.commands.map((command) => `- ${command}`),
    ...claudeCheckpointProtocolLines(spec.acceptance.commands),
    ...feedbackSection(feedback),
  ];
  return lines.join("\n");
}

export interface WorkerPromptAppendices {
  /** Tool protocol body lines (without the "Tool protocol:" header). */
  toolLines?: string[];
  /** Checkpoint section lines including blank first line if non-empty. */
  checkpointLines?: string[];
}

export function buildWorkerPrompt(
  spec: TaskSpec,
  resuming: boolean,
  feedback?: string,
  appendices?: WorkerPromptAppendices,
): string {
  if (spec.version === 1) return buildLegacyPrompt(spec, resuming, feedback);
  // Default appendices stay Claude-compatible for direct callers; adapters pass explicit lines.
  const toolLines = appendices?.toolLines
    ?? claudeToolProtocolLines(spec.worker.focusPaths);
  const checkpointLines = appendices?.checkpointLines !== undefined
    ? appendices.checkpointLines
    : claudeCheckpointProtocolLines(spec.acceptance.commands);
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
    "Context:",
    ...spec.contract.context.map((item) => `- ${item}`),
    "",
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
    "Module contracts:",
  ];
  for (const module of spec.contract.modules) {
    lines.push(
      `- ${module.name}: ${module.responsibility}`,
      `  consumes: ${module.consumes.join("; ")}`,
      `  produces: ${module.produces.join("; ")}`,
      `  boundaries: ${module.boundaries.join("; ")}`,
    );
  }
  lines.push(
    "",
    "Call chain:",
    ...spec.contract.callChain.map((item, index) => `${index + 1}. ${item}`),
    "",
    "Scenarios:",
  );
  for (const scenario of spec.contract.scenarios) {
    lines.push(
      `- ${scenario.name}`,
      `  Given: ${scenario.given}`,
      `  When: ${scenario.when}`,
      `  Then: ${scenario.then}`,
    );
  }
  lines.push(
    "",
    "Known risks:",
    ...spec.contract.risks.map((item) => `- ${item}`),
    "",
    "Hard change budget:",
    `- At most ${spec.contract.changeBudget.maxFiles} changed files`,
    `- At most ${spec.contract.changeBudget.maxDiffLines} added/deleted lines`,
    "- If the implementation cannot fit, stop and report the missing decomposition instead of expanding scope.",
    "",
    "Hard boundaries:",
    ...hardBoundaries().map((boundary) => `- ${boundary}`),
    "",
    "Behavioral acceptance criteria:",
    ...spec.acceptance.criteria.map((criterion) => `- ${criterion}`),
    "",
    "Independent acceptance commands:",
    ...spec.acceptance.commands.map((command) => `- ${command}`),
    ...checkpointLines,
    ...feedbackSection(feedback),
    "",
    "Return a concise summary containing: files changed, contract behavior delivered, verification evidence, and remaining risks.",
  );
  return lines.join("\n");
}
