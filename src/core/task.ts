import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import YAML from "yaml";
import { isProviderName, providerDefinition, providerNames } from "./providers.js";
import { cloneDefaults, type ContractQualitySettings, type TaskPolicy } from "./settings.js";
import type {
  ContractTaskSpec,
  QualityCheck,
  QualityReport,
  TaskContract,
  TaskModuleContract,
  TaskScenarioContract,
  TaskSpec,
} from "./types.js";

const DEFAULT_EXCLUDES = [
  ".git",
  ".runtime",
  ".forklight",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".DS_Store",
];

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function stringArray(value: unknown, label: string, fallback: string[] = []): string[] {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  return value.map((item) => (item as string).trim());
}

function objectArray(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => object(item, `${label}[${index}]`));
}

function booleanValue(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function numberValue(value: unknown, label: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function expandHome(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return path.join(homedir(), input.slice(2));
  return input;
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

function parseContract(value: unknown): TaskContract {
  const contract = object(value, "task.contract");
  const changeBudget = object(contract.changeBudget, "task.contract.changeBudget");
  return {
    outcome: stringValue(contract.outcome, "task.contract.outcome"),
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

function qualityCheck(id: string, label: string, passed: boolean, detail: string): QualityCheck {
  return { id, label, passed, detail };
}

export function assessTaskQuality(spec: TaskSpec, quality?: ContractQualitySettings): QualityReport {
  if (spec.version === 1) {
    const issue = "Legacy version 1 task has no structured execution contract";
    return {
      passed: false,
      score: 0,
      checks: [qualityCheck("contract-version", "Structured contract", false, issue)],
      issues: [issue],
    };
  }

  const contract = spec.contract;
  const policy = quality ?? cloneDefaults().contractQuality;
  const moduleDetailsComplete =
    contract.modules.length > 0 &&
    contract.modules.every(
      (module) =>
        module.responsibility.length >= policy.minModuleResponsibilityCharacters &&
        module.consumes.length > 0 &&
        module.produces.length > 0 &&
        module.boundaries.length > 0,
    );
  const scenarioNames = new Set(contract.scenarios.map((scenario) => scenario.name.toLowerCase()));
  const serialized = JSON.stringify({ contract, acceptance: spec.acceptance });
  const hasPlaceholder = /\b(?:todo|tbd|fixme|unknown)\b|待定|暂不清楚|以后再说/i.test(serialized);
  const checks = [
    qualityCheck(
      "outcome",
      "Concrete outcome",
      contract.outcome.length >= policy.minOutcomeCharacters,
      `Describe one observable result with enough detail to judge success (minimum ${policy.minOutcomeCharacters} characters)`,
    ),
    qualityCheck(
      "context",
      "Relevant context",
      contract.context.length > 0,
      "Include the current behavior or reason for the change",
    ),
    qualityCheck(
      "scope",
      "In-scope and out-of-scope boundaries",
      contract.inScope.length > 0 && contract.outOfScope.length > 0,
      "State both what may change and what must remain untouched",
    ),
    qualityCheck(
      "execution",
      "Execution path",
      contract.executionSteps.length > 0 && contract.deliverables.length > 0,
      "List implementation steps and concrete deliverables",
    ),
    qualityCheck(
      "modules",
      "Module production and consumption",
      moduleDetailsComplete,
      `Each module needs a responsibility (minimum ${policy.minModuleResponsibilityCharacters} characters), inputs, outputs, and boundaries`,
    ),
    qualityCheck(
      "call-chain",
      "Call chain",
      contract.callChain.length >= policy.minCallChainSteps,
      `Show at least ${policy.minCallChainSteps} step(s) from producer to consumer`,
    ),
    qualityCheck(
      "scenarios",
      "Normal and boundary scenarios",
      contract.scenarios.length >= policy.minScenarios && scenarioNames.size === contract.scenarios.length,
      `Provide at least ${policy.minScenarios} uniquely named scenario(s), including a boundary or failure case`,
    ),
    qualityCheck(
      "risks",
      "Known risks",
      contract.risks.length > 0,
      "Name at least one implementation or integration risk",
    ),
    qualityCheck(
      "acceptance",
      "Behavioral and executable acceptance",
      spec.acceptance.criteria.length > 0 && spec.acceptance.commands.length > 0,
      "Require both human-readable criteria and independent commands",
    ),
    qualityCheck(
      "placeholders",
      "No unresolved placeholders",
      !hasPlaceholder,
      "Remove TODO, TBD, unknown, or equivalent unresolved decisions",
    ),
    qualityCheck(
      "change-budget",
      "Bounded change surface",
      contract.changeBudget.maxFiles <= policy.maxFiles && contract.changeBudget.maxDiffLines <= policy.maxDiffLines,
      `Split the task until one attempt changes at most ${policy.maxFiles} files and ${policy.maxDiffLines} added/deleted lines`,
    ),
    qualityCheck(
      "focus-paths",
      "Focused inspection entry points",
      spec.worker.focusPaths.length > 0 && spec.worker.focusPaths.length <= policy.maxFocusPaths,
      `Name one to ${policy.maxFocusPaths} files or directories the Worker should inspect first`,
    ),
  ];
  const passedCount = checks.filter((check) => check.passed).length;
  const issues = checks.filter((check) => !check.passed).map((check) => `${check.label}: ${check.detail}`);
  return {
    passed: issues.length === 0,
    score: Math.round((passedCount / checks.length) * 100),
    checks,
    issues,
  };
}

export function assertTaskQuality(spec: TaskSpec, quality?: ContractQualitySettings): QualityReport {
  const report = assessTaskQuality(spec, quality);
  if (!report.passed) {
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
  const acceptance = object(root.acceptance ?? {}, "task.acceptance");
  const projectInput = stringValue(root.project, "task.project");
  const project = path.resolve(baseDirectory, expandHome(projectInput));

  const execSettings = policy?.execution ?? cloneDefaults().execution;
  const providerName = stringValue(
    provider.name,
    "task.provider.name",
    execSettings.defaultProvider,
  );
  if (!isProviderName(providerName)) {
    throw new Error(`Unsupported provider: ${providerName}. Supported providers: ${providerNames().join(", ")}`);
  }
  const providerDef = providerDefinition(providerName, policy?.providerDefaults);
  const runtimeName = stringValue(runtime.name, "task.runtime.name", "claude-code");
  if (runtimeName !== "claude-code") {
    throw new Error(`ForkLight currently supports runtime.name=claude-code, received ${runtimeName}`);
  }
  const effort = stringValue(runtime.effort, "task.runtime.effort", execSettings.defaultEffort);
  if (!["low", "medium", "high", "xhigh", "max"].includes(effort)) {
    throw new Error("task.runtime.effort must be low, medium, high, xhigh, or max");
  }
  const maxBudgetUsd = numberValue(
    runtime.maxBudgetUsd,
    "task.runtime.maxBudgetUsd",
    execSettings.defaultMaxBudgetUsd,
  );
  if (maxBudgetUsd > execSettings.maximumBudgetUsd) {
    throw new Error(
      `task.runtime.maxBudgetUsd $${maxBudgetUsd} exceeds configured maximum $${execSettings.maximumBudgetUsd}`,
    );
  }
  const workerAllowedCommands = stringArray(worker.allowedCommands, "task.worker.allowedCommands");
  if (workerAllowedCommands.length > 0) {
    throw new Error(
      "ForkLight requires task.worker.allowedCommands to be empty; acceptance commands run independently",
    );
  }
  const acceptanceCommands = stringArray(acceptance.commands, "task.acceptance.commands");
  if (acceptanceCommands.length === 0) {
    throw new Error("task.acceptance.commands must contain at least one independent verification command");
  }

  const common = {
    name: stringValue(root.name, "task.name"),
    project,
    provider: {
      name: providerName,
      model: stringValue(provider.model, "task.provider.model", providerDef.defaultModel),
      endpoint: provider.endpoint !== undefined
        ? stringValue(provider.endpoint, "task.provider.endpoint")
        : providerDef.defaultEndpoint,
      keychainService: stringValue(
        provider.keychainService,
        "task.provider.keychainService",
        providerDef.defaultKeychainService,
      ),
      ...(provider.keychainAccount === undefined
        ? {}
        : { keychainAccount: stringValue(provider.keychainAccount, "task.provider.keychainAccount") }),
    },
    runtime: {
      name: "claude-code" as const,
      executable: stringValue(runtime.executable, "task.runtime.executable", "claude"),
      effort: effort as "low" | "medium" | "high" | "xhigh" | "max",
      maxBudgetUsd,
    },
    workspace: {
      exclude: Array.from(
        new Set([...DEFAULT_EXCLUDES, ...stringArray(workspace.exclude, "task.workspace.exclude")]),
      ),
    },
    worker: {
      allowEdits: booleanValue(worker.allowEdits, "task.worker.allowEdits", true),
      allowedCommands: workerAllowedCommands,
      focusPaths: stringArray(worker.focusPaths, "task.worker.focusPaths"),
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
  assertTaskQuality(spec, policy?.contractQuality);
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

function toolProtocol(focusPaths: string[]): string[] {
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

function feedbackSection(feedback?: string): string[] {
  return feedback
    ? [
        "",
        "Correction feedback from independent verification or main Codex review:",
        feedback,
        "Address this evidence directly before reporting completion again.",
      ]
    : [];
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
    ...toolProtocol(spec.worker.focusPaths).map((instruction) => `- ${instruction}`),
    "",
    "Hard boundaries:",
    ...hardBoundaries().map((boundary) => `- ${boundary}`),
    ...spec.constraints.map((constraint) => `- ${constraint}`),
    "",
    "Acceptance commands ForkLight will run after you finish:",
    ...spec.acceptance.commands.map((command) => `- ${command}`),
    ...feedbackSection(feedback),
  ];
  return lines.join("\n");
}

export function buildWorkerPrompt(spec: TaskSpec, resuming: boolean, feedback?: string): string {
  if (spec.version === 1) return buildLegacyPrompt(spec, resuming, feedback);
  const lines = [
    resuming
      ? "Resume the previously interrupted task using the agreed execution contract."
      : "Execute this bounded task using the agreed execution contract.",
    "",
    `Task: ${spec.name}`,
    `Observable outcome: ${spec.contract.outcome}`,
    "",
    "Tool protocol:",
    ...toolProtocol(spec.worker.focusPaths).map((instruction) => `- ${instruction}`),
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
    ...feedbackSection(feedback),
    "",
    "Return a concise summary containing: files changed, contract behavior delivered, verification evidence, and remaining risks.",
  );
  return lines.join("\n");
}
