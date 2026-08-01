/**
 * Safe Task-file admission preview.
 *
 * One canonical path for CLI validate and daemon validate_file: load a Task
 * Contract with the complete current taskPolicy (including saved Worker Profiles
 * and model catalog), resolve the exact Worker/model/runtime selection and
 * effective advanced policy, and return only bounded user-relevant facts.
 *
 * Preview is explanation and validation only — never registers, queues,
 * prepares, verifies, integrates, probes a Provider, or calls a Worker.
 * previewRevisionDigest binds a Hub confirmation to the exact Task file bytes
 * and the effective admission settings the user previewed; daemon submit_file
 * recomputes it from one prepared admission and rejects any mismatch before
 * any Task mutation.
 */

import { createHash } from "node:crypto";
import {
  deriveEnforcementCapability,
  enforcementCapabilityForRuntime,
  resolveTaskEffectivePolicy,
} from "./advanced-policy.js";
import {
  assessTaskQualityWithPolicy,
  effectiveQualityPolicyFromGlobal,
} from "./contract-quality.js";
import { assessIntegrationFeasibility, type IntegrationFeasibility } from "./integration-feasibility.js";
import type { ForkLightSettings, TaskPolicy } from "./settings.js";
import { loadTaskSpec } from "./task.js";
import {
  computeClassificationAdvice,
  type ClassificationAdvice,
} from "./classification-advice.js";
import {
  formatRoutingExplanationHuman,
  projectSafeRoutingExplanation,
  type SafeRoutingExplanation,
} from "./routing-explanation.js";
import {
  assessWorkspaceBoundary,
  formatWorkspaceBoundaryAdviceHuman,
  type WorkspaceBoundaryAdvice,
} from "../workspace/boundary-advice.js";
import { createPathPolicy } from "../workspace/path-policy.js";

export type {
  RoutingExplanationNextAction,
  RoutingSelectionBasis,
  SafeRoutingCompetition,
  SafeRoutingEvidence,
  SafeRoutingExplanation,
} from "./routing-explanation.js";
import type {
  AdvancedPolicyFields,
  EffectivePolicySnapshot,
  EnforcementCapability,
  PolicyMode,
  ProvenanceSource,
  QualityCheck,
  QualityReport,
  TaskRecord,
  TaskSpec,
} from "./types.js";
import type { RuntimeName } from "./runtime-names.js";
import { getWorkerAdapter } from "../workers/registry.js";

/** Bounded Integration feasibility facts — no paths or commands. */
export interface SafeIntegrationFeasibility {
  applicable: boolean;
  integratable: boolean;
  taskMaxFiles: number | null;
  taskMaxLines: number | null;
  integrationMaxFiles: number;
  integrationMaxLines: number;
  issues: string[];
}

/** Explicit allowlist result — never spread TaskSpec or settings. */
export interface SafeTaskAdmissionPreview {
  taskName: string;
  workerProfileId?: string;
  workerProfileLabel?: string;
  provider: string;
  model: string;
  runtime: string;
  effort: string;
  budget: {
    maxBudgetUsd: number | null;
    unlimited: boolean;
  };
  effectivePolicy: {
    profileId: string;
    values: Readonly<AdvancedPolicyFields>;
    provenance: Readonly<Record<keyof AdvancedPolicyFields, ProvenanceSource>>;
    enforcementCapability: Readonly<EnforcementCapability>;
  };
  quality: {
    passed: boolean;
    score: number;
    mode?: PolicyMode;
    admitted?: boolean;
    checks: Array<Pick<QualityCheck, "id" | "label" | "passed" | "detail">>;
    issues: string[];
    /** Field + term only; excerpts omitted so raw Task wording is never returned. */
    warnings: Array<{ field: string; term: string }>;
  };
  integration: SafeIntegrationFeasibility;
  /**
   * Current classification reuse advice derived from terminal ordinary Tasks.
   * Read-only evidence for Main; it never infers semantics, never ranks
   * families, and NEVER enters previewRevisionDigest. A sibling Task becoming
   * terminal may change these counts without invalidating a submit
   * confirmation.
   */
  classificationAdvice: ClassificationAdvice;
  /**
   * Privacy-safe pre-submit routing explanation: why this Worker was selected,
   * how many candidates were compared, aggregate historical evidence, and the
   * recorded Competition intent. Detached from mutable Task data, derived only
   * from the frozen Task-file routingDecision and resolved selection, and never
   * enters previewRevisionDigest.
   */
  routingExplanation: SafeRoutingExplanation;
  /**
   * Detached privacy-safe pre-launch workspace boundary advice: how many
   * Git-ignored directory roots were observed, how many the existing
   * PathPolicy already covers, and how many would still enter the Worker as
   * ordinary source. Counts and closed codes only — never paths, names, Git
   * output, or diagnostics. Non-Git projects and any scan failure fail closed
   * to unavailable. This is a review signal, never an admission gate: it does
   * not enter previewRevisionDigest and never changes Task/settings/quality/
   * Integration authority.
   */
  workspaceBoundaryAdvice: WorkspaceBoundaryAdvice;
  /**
   * Content-free digest binding the preview to the exact Task file bytes and
   * the current effective admission settings (selection, policy/provenance,
   * quality result, Integration summary). Daemon submit_file recomputes this
   * from one prepared admission and rejects a stale or malformed value before
   * any Task mutation. Contains no recoverable Task text, path, command,
   * endpoint, credential reference, or Provider response. Classification
   * history is deliberately absent from this digest.
   */
  previewRevisionDigest: string;
}

/** Canonical sha256-hex shape of a preview revision digest. */
export const PREVIEW_REVISION_DIGEST_PATTERN = /^[a-f0-9]{64}$/;

/**
 * Internal prepared admission: one file read, one parsed TaskSpec, and one
 * effective-policy resolution. The safe preview projection and a bound submit
 * consume the same prepared result so a submission never re-reads or
 * re-resolves after its preview revision is accepted.
 */
export interface PreparedTaskAdmission {
  readonly taskFile: string;
  readonly taskFileDigest: string;
  readonly spec: TaskSpec;
  readonly effectivePolicy: EffectivePolicySnapshot;
  readonly qualityReport: QualityReport;
  readonly integration: IntegrationFeasibility;
  readonly profileId: string | undefined;
  readonly profileLabel: string | undefined;
  /**
   * Detached deeply frozen workspace-boundary advice computed once from the
   * resolved project and the Task PathPolicy. Never enters the digest and
   * never changes admission facts.
   */
  readonly workspaceBoundaryAdvice: WorkspaceBoundaryAdvice;
  /** Combined content-free revision digest (file bytes + effective admission). */
  readonly previewRevisionDigest: string;
}

/** Complete taskPolicy snapshot used by submit_file and validate_file alike. */
export function taskPolicyFromSettings(settings: ForkLightSettings): TaskPolicy {
  return {
    contractQuality: settings.contractQuality,
    execution: settings.execution,
    providerDefaults: settings.providerDefaults,
    completionPolicy: settings.completionPolicy,
    workerProfiles: settings.workerProfiles,
    modelCatalog: settings.modelCatalog,
    deliveryProfiles: settings.deliveryProfiles,
  };
}

/**
 * Truthful enforcement capability for the selected runtime.
 * Uses the Worker adapter matrix when available; never probes a Provider.
 */
export function enforcementCapabilityForTaskRuntime(
  runtimeName: RuntimeName,
): EnforcementCapability {
  try {
    const adapter = getWorkerAdapter(runtimeName);
    return deriveEnforcementCapability(adapter.capabilities());
  } catch {
    return enforcementCapabilityForRuntime(runtimeName);
  }
}

function safeQualitySummary(report: QualityReport): SafeTaskAdmissionPreview["quality"] {
  return {
    passed: report.passed,
    score: report.score,
    ...(report.mode === undefined ? {} : { mode: report.mode }),
    ...(report.admitted === undefined ? {} : { admitted: report.admitted }),
    checks: report.checks.map((check) => ({
      id: check.id,
      label: check.label,
      passed: check.passed,
      detail: check.detail,
    })),
    issues: [...report.issues],
    warnings: report.warnings.map((warning) => ({
      field: warning.field,
      term: warning.term,
    })),
  };
}

function safeIntegrationSummary(
  feasibility: ReturnType<typeof assessIntegrationFeasibility>,
): SafeIntegrationFeasibility {
  return {
    applicable: feasibility.applicable,
    integratable: feasibility.integratable,
    taskMaxFiles: feasibility.taskMaxFiles,
    taskMaxLines: feasibility.taskMaxLines,
    integrationMaxFiles: feasibility.integrationMaxFiles,
    integrationMaxLines: feasibility.integrationMaxLines,
    issues: [...feasibility.issues],
  };
}

function safeEffectivePolicy(
  snapshot: EffectivePolicySnapshot,
): SafeTaskAdmissionPreview["effectivePolicy"] {
  return {
    profileId: snapshot.profileId,
    values: { ...snapshot.values },
    provenance: { ...snapshot.provenance },
    enforcementCapability: { ...snapshot.enforcementCapability },
  };
}

/**
 * Prepare one canonical admission from an absolute Task Contract path and the
 * immutable current settings snapshot: one file read, one parsed TaskSpec, and
 * one effective-policy resolution. The safe preview projection and a bound
 * daemon submit consume this same prepared result. Performs no Task/settings
 * mutation.
 */
export async function prepareTaskAdmission(
  taskFileInput: string,
  settings: ForkLightSettings,
): Promise<PreparedTaskAdmission> {
  const policy = taskPolicyFromSettings(settings);
  const loaded = await loadTaskSpec(taskFileInput, policy);
  const spec = loaded.spec;
  const capabilities = enforcementCapabilityForTaskRuntime(spec.runtime.name);
  const effectivePolicy = resolveTaskEffectivePolicy(spec, settings, capabilities);
  const qualityReport = assessTaskQualityWithPolicy(
    spec,
    spec.qualityPolicy
      ?? effectiveQualityPolicyFromGlobal(settings.contractQuality),
  );
  const integration = assessIntegrationFeasibility(spec, settings.integration);
  const profileId = spec.workerProfileId;
  const profileLabel = profileId === undefined
    ? undefined
    : settings.workerProfiles.profiles.find((profile) => profile.id === profileId)?.label;
  // One canonical read-only workspace-boundary check after Task and Settings
  // are resolved. Always fails closed to unavailable; never blocks admission.
  const workspaceBoundaryAdvice = await assessWorkspaceBoundary({
    projectDir: spec.project,
    policy: createPathPolicy(spec),
  });
  const previewRevisionDigest = computePreviewRevisionDigest({
    taskFileDigest: loaded.taskFileDigest,
    spec,
    effective: effectivePolicy,
    qualityReport,
    integration,
  });
  return {
    taskFile: loaded.taskFile,
    taskFileDigest: loaded.taskFileDigest,
    spec,
    effectivePolicy,
    qualityReport,
    integration,
    profileId,
    profileLabel,
    workspaceBoundaryAdvice,
    previewRevisionDigest,
  };
}

/**
 * Project a prepared admission into the explicit safe allowlist. Never spreads
 * the full TaskSpec or settings; never includes path, command, endpoint,
 * credential, raw Task text, or Provider response. The optional read-only
 * history snapshot feeds only the classification advice; it never influences
 * the preview revision digest or any admission fact.
 */
export function projectSafeTaskAdmissionPreview(
  prepared: PreparedTaskAdmission,
  tasks: readonly TaskRecord[] = [],
): SafeTaskAdmissionPreview {
  const spec = prepared.spec;
  const maxBudgetUsd = spec.runtime.maxBudgetUsd;
  return {
    taskName: spec.name,
    ...(prepared.profileId === undefined ? {} : { workerProfileId: prepared.profileId }),
    ...(prepared.profileLabel === undefined ? {} : { workerProfileLabel: prepared.profileLabel }),
    provider: spec.provider.name,
    model: spec.provider.model,
    runtime: spec.runtime.name,
    effort: spec.runtime.effort,
    budget: {
      maxBudgetUsd,
      unlimited: maxBudgetUsd === null,
    },
    effectivePolicy: safeEffectivePolicy(prepared.effectivePolicy),
    quality: safeQualitySummary(prepared.qualityReport),
    integration: safeIntegrationSummary(prepared.integration),
    classificationAdvice: computeClassificationAdvice(
      spec.taskClass,
      spec.taskFamily,
      tasks,
    ),
    routingExplanation: projectSafeRoutingExplanation({
      ...(spec.routingDecision === undefined ? {} : { routingDecision: spec.routingDecision }),
      selectedWorker: {
        provider: spec.provider.name,
        model: spec.provider.model,
        runtime: spec.runtime.name,
        effort: spec.runtime.effort,
      },
      ...(prepared.profileId === undefined ? {} : { workerProfileId: prepared.profileId }),
      ...(prepared.profileLabel === undefined ? {} : { workerProfileLabel: prepared.profileLabel }),
    }),
    workspaceBoundaryAdvice: prepared.workspaceBoundaryAdvice,
    previewRevisionDigest: prepared.previewRevisionDigest,
  };
}

/**
 * Deterministic, explicit allowlist of effective admission facts used as the
 * preview revision digest input. Content-free: no Task text, path, command,
 * endpoint, credential reference, or Provider response. Quality and Integration
 * contribute counts and pass/fail/numbers only, never their issue strings.
 */
function projectAdmissionRevisionFacts(input: {
  taskFileDigest: string;
  spec: TaskSpec;
  effective: EffectivePolicySnapshot;
  qualityReport: QualityReport;
  integration: IntegrationFeasibility;
}): Record<string, unknown> {
  const { taskFileDigest, spec, effective, qualityReport, integration } = input;
  const values: Record<string, unknown> = {};
  const provenance: Record<string, unknown> = {};
  const v = effective.values;
  const p = effective.provenance;
  for (const field of Object.keys(v) as Array<keyof AdvancedPolicyFields>) {
    values[field] = v[field];
    provenance[field] = p[field];
  }
  return {
    fileDigest: taskFileDigest,
    selection: {
      profileId: effective.profileId,
      workerProfileId: spec.workerProfileId ?? null,
      provider: spec.provider.name,
      model: spec.provider.model,
      runtime: spec.runtime.name,
      effort: spec.runtime.effort,
      maxBudgetUsd: spec.runtime.maxBudgetUsd,
    },
    policy: {
      values,
      provenance,
      enforcementCapability: {
        durationEnforcement: effective.enforcementCapability.durationEnforcement,
        tokenEnforcement: effective.enforcementCapability.tokenEnforcement,
        progressWatchdog: effective.enforcementCapability.progressWatchdog,
      },
    },
    quality: {
      passed: qualityReport.passed,
      score: qualityReport.score,
      mode: qualityReport.mode ?? null,
      admitted: qualityReport.admitted ?? null,
      checkCount: qualityReport.checks.length,
      issueCount: qualityReport.issues.length,
      warningCount: qualityReport.warnings.length,
    },
    integration: {
      applicable: integration.applicable,
      integratable: integration.integratable,
      taskMaxFiles: integration.taskMaxFiles,
      taskMaxLines: integration.taskMaxLines,
      integrationMaxFiles: integration.integrationMaxFiles,
      integrationMaxLines: integration.integrationMaxLines,
      issueCount: integration.issues.length,
    },
  };
}

/** Recursively sort object keys so the digest input is order-independent. */
function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

/** Compute the canonical preview revision digest from one prepared admission. */
export function computePreviewRevisionDigest(input: {
  taskFileDigest: string;
  spec: TaskSpec;
  effective: EffectivePolicySnapshot;
  qualityReport: QualityReport;
  integration: IntegrationFeasibility;
}): string {
  return createHash("sha256")
    .update(stableStringify(projectAdmissionRevisionFacts(input)))
    .digest("hex");
}

/**
 * Build one safe admission preview from an absolute Task Contract path and the
 * immutable current settings snapshot. The optional terminal ordinary Task
 * history snapshot feeds only the read-only classification advice; it never
 * enters the preview revision digest and never affects admission facts.
 * Performs no Task/settings mutation.
 */
export async function buildTaskAdmissionPreview(
  taskFileInput: string,
  settings: ForkLightSettings,
  tasks: readonly TaskRecord[] = [],
): Promise<SafeTaskAdmissionPreview> {
  return projectSafeTaskAdmissionPreview(
    await prepareTaskAdmission(taskFileInput, settings),
    tasks,
  );
}

/** Human-readable classification reuse lines. States and counts only — no
 *  semantic guess, no ranking, and no private Task content. */
export function formatClassificationAdviceHuman(advice: ClassificationAdvice): string {
  const lines: string[] = [];
  lines.push("Classification reuse advice:");
  lines.push(
    `  taskClass: ${advice.taskClass.state}`
    + ` (${advice.taskClass.terminalCount} terminal, ${advice.taskClass.completeSelectionCount} complete)`,
  );
  lines.push(
    `  taskFamily: ${advice.taskFamily.state}`
    + ` (${advice.taskFamily.terminalCount} terminal, ${advice.taskFamily.completeSelectionCount} complete)`,
  );
  if (advice.familyChoices.length > 0) {
    lines.push("  Established families:");
    for (const choice of advice.familyChoices) {
      lines.push(
        `    ${choice.family}: ${choice.terminalCount} terminal,`
        + ` ${choice.completeSelectionCount} complete, ${choice.distinctClassCount} class(es)`,
      );
    }
  } else {
    lines.push("  Established families: (none)");
  }
  if (advice.classChoices.length > 0) {
    lines.push("  Existing classes in the selected family:");
    for (const choice of advice.classChoices) {
      lines.push(
        `    ${choice.taskClass}: ${choice.terminalCount} terminal,`
        + ` ${choice.completeSelectionCount} complete`,
      );
    }
  } else {
    lines.push("  Existing classes in the selected family: (none)");
  }
  lines.push(`  Next action: ${advice.nextAction}`);
  return lines.join("\n");
}

/** Human-readable validate lines. Never prints paths, secrets, or raw contract text. */
export function formatTaskAdmissionPreviewHuman(preview: SafeTaskAdmissionPreview): string {
  const lines: string[] = [];
  lines.push(`Task: ${preview.taskName}`);
  if (preview.workerProfileId !== undefined) {
    const label = preview.workerProfileLabel === undefined
      ? preview.workerProfileId
      : `${preview.workerProfileId} (${preview.workerProfileLabel})`;
    lines.push(`Worker Profile: ${label}`);
  } else {
    lines.push("Worker Profile: (none — defaults / explicit Task fields)");
  }
  lines.push(`Provider: ${preview.provider}`);
  lines.push(`Model: ${preview.model}`);
  lines.push(`Runtime: ${preview.runtime}`);
  lines.push(`Effort: ${preview.effort}`);
  lines.push(
    preview.budget.unlimited
      ? "Budget: unlimited"
      : `Budget: $${preview.budget.maxBudgetUsd}`,
  );
  lines.push(`Effective policy profile: ${preview.effectivePolicy.profileId}`);
  const { values, provenance } = preview.effectivePolicy;
  lines.push(
    `  baseMaxAttempts=${values.baseMaxAttempts} (${provenance.baseMaxAttempts})`
    + ` maxExtraAttempts=${values.maxExtraAttempts} (${provenance.maxExtraAttempts})`
    + ` maxConcurrency=${values.maxConcurrency} (${provenance.maxConcurrency})`,
  );
  lines.push(
    `  completionMode=${values.completionMode} (${provenance.completionMode})`
    + ` changeBudgetMode=${values.changeBudgetMode} (${provenance.changeBudgetMode})`,
  );
  lines.push(
    `  noProgressTimeoutMs=${values.noProgressTimeoutMs === null ? "unlimited" : values.noProgressTimeoutMs}`
    + ` (${provenance.noProgressTimeoutMs})`,
  );
  lines.push(
    `Task Contract: ${preview.quality.passed ? "PASS" : "FAIL"} (${preview.quality.score}/100)`,
  );
  for (const check of preview.quality.checks) {
    lines.push(`${check.passed ? "✓" : "✗"} ${check.label} — ${check.detail}`);
  }
  if (preview.quality.warnings.length > 0) {
    lines.push(`Wording warnings (${preview.quality.warnings.length}):`);
    for (const warning of preview.quality.warnings) {
      lines.push(`  ⚠ ${warning.field}: "${warning.term}"`);
    }
  }
  if (preview.integration.applicable) {
    lines.push(
      `Integration feasibility: ${
        preview.integration.integratable
          ? "OK"
          : "WARN — executable but may not be integratable"
      }`,
    );
    lines.push(
      `  task budget: ${preview.integration.taskMaxFiles} files / ${preview.integration.taskMaxLines} lines; `
      + `integration limit: ${preview.integration.integrationMaxFiles} files / ${preview.integration.integrationMaxLines} lines`,
    );
    for (const issue of preview.integration.issues) {
      lines.push(`  ! ${issue}`);
    }
  }
  lines.push("");
  lines.push(formatRoutingExplanationHuman(preview.routingExplanation));
  lines.push("");
  lines.push(formatClassificationAdviceHuman(preview.classificationAdvice));
  lines.push("");
  lines.push(formatWorkspaceBoundaryAdviceHuman(preview.workspaceBoundaryAdvice));
  lines.push("");
  lines.push(`Preview revision digest: ${preview.previewRevisionDigest}`);
  lines.push("(preview only — does not create or submit a Task)");
  return `${lines.join("\n")}\n`;
}
