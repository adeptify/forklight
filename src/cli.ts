#!/usr/bin/env -S node --disable-warning=ExperimentalWarning

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PlanBoard, PlanBoardSummary } from "./core/board.js";
import type { DirectCodexPairedSample } from "./core/direct-codex-calibration.js";
import type {
  DirectCodexPublicationPreview, DirectCodexRegistrationResult,
} from "./core/direct-codex-publication-service.js";
import type { DirectCodexSampleReview } from "./core/direct-codex-review.js";
import type { DirectCodexInboxItem } from "./core/direct-codex-workflow-service.js";
import { forklightHome } from "./core/config.js";
import { providerProbeBatchFailed } from "./core/provider-probe.js";
import { providerLabel, providerNames, providerReadiness } from "./core/providers.js";
import type { RuntimeName } from "./core/runtime-names.js";
import type {
  CompactProviderModelSummary,
  ProviderModelSummary,
} from "./core/statistics.js";
import type {
  AttemptAuthorization, AttemptExecutionOptions, AttemptRecord, EventRecord,
  NormalizedWorkerEvent, TaskDecisionView, TaskRecord,
} from "./core/types.js";
import { loadWorkPlan } from "./core/plan.js";
import {
  checkReviseEligibility, correctTask, describeReviseRejection, prepareMainCorrectionTask,
  reconcileTask, resumeTask, reviseTask, runNewTask,
} from "./core/runner.js";
import {
  authorizeExtraAttempt,
  authorizeMainCorrection,
  resolvePendingGrantExecutionOptions,
} from "./core/attempt-authorization.js";
import { parseRemediationAmendmentInput } from "./core/main-remediation.js";
import { recordMainReview } from "./core/main-review.js";
import {
  describeCorrectionRejection,
  resolveCorrectionEligibility,
  resolveLatestRevision,
  validateStructuredCorrectionInput,
} from "./core/candidate-revision.js";
import { buildCompactIntegrationOperationView } from "./core/integration-operation.js";
import type { IntegrationOperationView } from "./core/types.js";
import {
  parseRequiredStreakCountFromString,
  type SelfUpgradeEvidenceProjection,
} from "./core/self-upgrade-evidence.js";
import {
  buildTaskAdmissionPreview,
  formatTaskAdmissionPreviewHuman,
  taskPolicyFromSettings,
} from "./core/task-preview.js";
import { createKeychainStore } from "./core/secrets.js";
import { SettingsService } from "./core/settings.js";
import {
  daemonObserverRequest,
  daemonRequest,
  ensureDaemon,
  probeDaemon,
  resolveDaemonStartupTimeoutMs,
  restartDaemon,
  routeMutation,
  stopDaemon,
  stopDaemonForHandoff,
} from "./daemon/client.js";
import { readActivationHandoffContext } from "./activation/runner.js";
import type { DaemonMethod } from "./daemon/protocol.js";
import { createSystemInspector, SetupService } from "./setup/service.js";
import { HubServer } from "./hub/server.js";
import {
  discoverOrClaimHub,
  inspectHubStatus,
  publishHubInstance,
  releaseHubInstance,
  replaceHubOwner,
  resolveHubOpenUrl,
  resolveHubStartupTimeoutMs,
  restartHubDetached,
  type DetachedHubRestartResult,
  type HubDiscovery,
  type HubInspectionStatus,
} from "./hub/instance.js";
import { StateStore } from "./state/store.js";
import { withCliExchangeReceipt, humanTokenReportLines } from "./cli/exchange-receipts.js";
import {
  buildHealthWorkerReadiness,
  humanWorkerReadinessLines,
  projectWorkerReadinessJson,
  safeProviderVerificationSnapshot,
  type RuntimeDoctorSnapshot,
} from "./cli/health-readiness.js";
import {
  projectExecutionProviderReadiness,
  resolveExecutionProviderFacts,
  resolveDoctorResult,
  renderDoctorHuman,
  renderDoctorJson,
  type DaemonHealthEvidence,
  type LocalProviderFact,
} from "./setup/doctor.js";
import {
  buildCompactInspection,
  buildProgressCursor,
  humanCompactInspectionLines,
  humanWaitLines,
  parseInspectSummaryOptions,
  parseWaitOptions,
  waitForTask,
  type TaskProgressSnapshot,
} from "./cli/supervision.js";
import {
  DEFAULT_QUIET_AFTER_MS,
  isTerminalTaskStatus,
  projectLiveStage,
  toLatestEventMeta,
} from "./core/task-progress.js";
import { getTaskTokenReport } from "./core/token-report.js";
import {
  buildTaskSummary,
  projectTaskSurface,
  type SafeTaskSummary,
} from "./core/task-summary.js";
import { buildTaskDecisionView } from "./core/task-decision-view.js";
import {
  failureCategoryForTask,
  type WorkerFailureCategory,
} from "./core/worker-failure.js";
import {
  compareBuildIdentity,
  currentBuildIdentity,
  isBuildIdentity,
} from "./core/build-identity.js";
import { daemonExchange } from "./daemon/client.js";

/**
 * Build the same evidence-aware Task surface the daemon exposes to MCP and Hub.
 * Local CLI readers must not lose Main Review, remediation, or Integration facts:
 * omitting them makes already delivered Tasks fail open to Now / needs-review.
 */
function projectStoredTaskSurface(
  store: StateStore,
  task: TaskRecord,
  nowMs: number,
  quietAfterMs = DEFAULT_QUIET_AFTER_MS,
): SafeTaskSummary {
  const events = store.listEvents(task.id);
  const latestEvent = toLatestEventMeta(store.latestEventMeta(task.id));
  const failureCategory = failureCategoryForTask(task.status, events);
  const remediationDisposition = store.getRemediationDisposition(task.id);
  const decisionStage = buildTaskDecisionView({
    task,
    attempts: store.listAttempts(task.id),
    events,
    integrationResults: store.listIntegrationResults(task.id),
    ...(remediationDisposition === undefined ? {} : { remediationDisposition }),
    nowMs,
  }).stage;
  const preparationStage = task.status === "preparing"
    ? store.latestPreparationStageMeta(task.id)
    : undefined;
  return projectTaskSurface(task, {
    ...(latestEvent === undefined ? {} : { latestEvent }),
    ...(failureCategory === undefined ? {} : { failureCategory }),
    ...(remediationDisposition === undefined ? {} : { remediationDisposition }),
    decisionStage,
    ...(preparationStage === undefined ? {} : { preparationStage }),
    events: events.map((event) => ({
      sequence: event.sequence,
      timestamp: event.timestamp,
      type: event.type,
      ...(event.payload === undefined ? {} : { payload: event.payload }),
    })),
    nowMs,
    quietAfterMs,
  });
}

function usage(): string {
  return `ForkLight 0.2

Usage:
  forklight run <task.yaml>
  forklight submit <task.yaml>
  forklight validate <task.yaml> [--json]
  forklight validate-plan <plan.yaml> [--json]
  forklight submit-plan <plan.yaml>
  forklight inspect-plan <plan-id> [--json]
  forklight board [--json]
  forklight submit-goal <goal.yaml>
  forklight goal status <goal-id> [--json]
  forklight goal list [--json] [--limit <n>]
  forklight goal advance <goal-id> --confirm [--json]
  forklight goal stop <goal-id> --confirm [--json]
  forklight goal handoff <task-id> --revision <id> --reusable <json> --gaps <json> --to-profile <id> --reason <text> --confirm [--json]
  forklight status <task-id> [--json]
  forklight wait <task-id> --timeout-ms <positive integer> [--poll-ms <positive integer>] [--until change|terminal] [--json]
      # change = status/attempt/event-sequence/updatedAt cursor (not status-only)
  forklight resume <task-id> [--feedback <text>] [--authorize-extra --max-budget-usd <number|none> --reason <text> --confirm]
  forklight revise <task-id> --feedback <text>
  forklight correct <task-id> --feedback <text> [--max-budget-usd <number|none>] [--candidate-revision <id> --reusable-paths <json-array> --remaining-gaps <json-array>] --confirm
  forklight main-review <task-id> --decision <accept|revise|reject> --reason <text> --confirm
  forklight review-graph create <task-id> --reviewer-profile <id> [--reviewer-profile <id> ...] --reason <text> --confirm [--json]
      # or --reviewer-profiles <id1,id2,id3> for 1–3 independent read-only judges
  forklight review-graph status <task-id> [--json]
  forklight inspect <task-id> [--summary] [--events <nonnegative integer>] [--json]
      # prefer --summary for main-thread supervision; full inspect is for deep audit
  forklight list [--json]
  forklight stats [--json] [--provider <name>] [--model <name>] [--since <ISO>] [--until <ISO>] [--deep-audit]
      # default JSON is aggregate-only; --deep-audit requires --json for full failure evidence
  forklight routing <task-class> --candidates <json> [--json]
  forklight daemon <start|status|stop|restart>
      # start|restart accept optional --startup-timeout-ms <1000-600000>; default 30000
  forklight health [--json]
  forklight settings <get|set|apply|reset> [...]
  forklight integration preflight <task-id> [--json]
  forklight integration apply <task-id> --receipt <receipt-id> --confirm [--json]
  forklight integration status <operation-id> [--json] [--deep-audit]
      # observation only; never starts a daemon
  forklight integration wait <operation-id> --timeout-ms <positive integer> [--json] [--deep-audit]
      # observation only; never starts a daemon
  forklight integration history <task-id> [--json]
      # observation only; never starts a daemon
  forklight main-direct start --task-class <class> [--family <family>] --reason <code> --note <text> [--profiles <json-array>] --confirm [--json]
  forklight main-direct complete --id <id> --outcome <completed|abandoned> [--verification <passed|failed|unavailable>] --note <text> --confirm [--json]
  forklight main-direct status <id> [--json]
  forklight main-direct list [--json]
  forklight main-direct aggregate [--json]
  forklight main-direct recent [--limit <n>] [--json]
      # read-only main-direct projections; never starts a daemon
  forklight upgrade status [--required <1-20>] [--json]
      # read-only consecutive self-upgrade streak; never starts a daemon or Integration
  forklight tokens <task-id> [--json]
  forklight direct-codex capture --usage <json-object> --metadata <json-object> [--json]
  forklight direct-codex capture-task --task-id <id> --run-ref <ref> --usage <json-object> [--json]
  forklight direct-codex inbox --task-class <class> --profile-id <id> [--json]
  forklight direct-codex review --sample-id <id> --decision <accepted|rejected> [--rejection-reason <reason>] --reviewer <reviewer> --reviewed-at <canonical-ISO> --schema-version <version> --confirm [--json]
  forklight direct-codex publication-preview --task-class <class> --profile-id <id> [--json]
  forklight direct-codex publication-register --task-class <class> --profile-id <id> --method <method> --confidence <level> --created-at <canonical-ISO> --confirm [--json]
  forklight compete <task.yaml> --candidates <json> [--reason <text>]
  forklight competition status <id> [--json]
  forklight competition list [--json]
  forklight competition compare <id> [--json] [--weights <json>]
  forklight competition main-decision <id> <candidate-id> <accept|revise|reject> --reason <text> --confirm [--json]
  forklight competition retain-partial <id> <candidate-id> --reusable <json> --gaps <json> --confirm [--json]
  forklight competition handoff <id> <candidate-id> --revision <id> --to-profile <id> --reason <text> --confirm [--json]
  forklight providers status [<name>] [--json]
  forklight providers probe [<name>] [--json]
  forklight adapt preview <task-id> --patch <json> --reason <category> [--json]
  forklight adapt apply <task-id> --patch <json> --reason <category> --confirm [--json]
      # category: duration-budget | size-policy | attempt-budget | completion-policy | concurrency-cap | no-progress-timeout | other-flexible-policy
  forklight remediate verify <task-id> --reason <text> --confirm [--amendment <file>] [--json]
  forklight reverify <task-id> --reason <text> --confirm [--json]
      # rerun a failed candidate's original acceptance suite without a Worker or new Attempt
  forklight hub [--no-open] [--port <port>]
      # starts backend daemon + Hub UI (only control-center UI)
  forklight hub restart --confirm [--detach] [--no-open] [--port <port>] [--startup-timeout-ms <1000-60000>] [--json]
      # replaces a stale-version Hub owner after proving its identity
      # --detach launches one background Hub and returns after authenticated readiness
  forklight hub status [--json]
      # read-only Hub status; never starts, claims, replaces, or signals
  forklight doctor [--json]
`;
}

function required(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Missing ${label}\n\n${usage()}`);
  return value;
}

function progressLine(event: NormalizedWorkerEvent): string | undefined {
  if (event.type === "worker.message" && event.summary.length > 180) return;
  const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
  return `[${time}] ${event.summary}\n`;
}

function printProgress(event: NormalizedWorkerEvent): void {
  const line = progressLine(event);
  if (line !== undefined) process.stdout.write(line);
}

/** Render the human status block (one `key: value` line per defined
 *  field) as a single exact string.  Returns the empty string when the
 *  task has no defined summary fields. */
function humanStatusLines(
  task: TaskRecord,
  progress?: TaskDecisionView["progress"],
  failureCategory?: WorkerFailureCategory,
): string {
  const summary = buildTaskSummary(task, progress, failureCategory);
  const lines: string[] = [];
  for (const [key, value] of Object.entries(summary)) {
    if (value === undefined) continue;
    if (key === "progress" && typeof value === "object" && value !== null) {
      const p = value as TaskDecisionView["progress"];
      if (p.lastEventAt !== undefined) lines.push(`lastEventAt: ${p.lastEventAt}`);
      if (p.lastEventType !== undefined) lines.push(`lastEventType: ${p.lastEventType}`);
      lines.push(`activity: ${p.activity}`);
      lines.push(`latestEventSequence: ${String(p.latestEventSequence)}`);
      if (p.latestAction !== undefined) lines.push(`latestAction: ${p.latestAction}`);
      if (p.liveStage !== undefined) {
        lines.push(`liveStage: ${p.liveStage.stage}`);
        lines.push(`liveStageObservation: ${p.liveStage.observation}`);
        lines.push(`liveStageMeaning: ${p.liveStage.meaning}`);
        lines.push(`liveStageNext: ${p.liveStage.next}`);
        lines.push(`liveStageEvidence: ${p.liveStage.evidence}`);
      }
      continue;
    }
    lines.push(`${key}: ${String(value)}`);
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function printHumanStatus(task: TaskRecord, events: EventRecord[] = []): void {
  process.stdout.write(
    humanStatusLines(task, undefined, failureCategoryForTask(task.status, events)),
  );
}

/** Render the human inspect block as a single exact string. */
function humanInspectLines(
  task: TaskRecord, attempts: AttemptRecord[], events: EventRecord[], diff: string,
): string {
  const lines: string[] = [];
  const statusBody = humanStatusLines(
    task,
    undefined,
    failureCategoryForTask(task.status, events),
  );
  if (statusBody.length > 0) lines.push(statusBody.replace(/\n$/, ""));
  lines.push(`attempts: ${attempts.length}`);
  for (const attempt of attempts) {
    lines.push(
      `  #${attempt.ordinal} ${attempt.status} exit=${attempt.exitCode ?? "-"} cost=$${attempt.costUsd?.toFixed(4) ?? "-"} turns=${attempt.turns ?? "-"}`,
    );
  }
  lines.push("events:");
  for (const event of events) lines.push(`  ${event.sequence}. ${event.type} — ${event.summary}`);
  lines.push(`diff: ${task.paths.diff}${diff ? ` (${diff.split("\n").length - 1} lines)` : " (not generated)"}`);
  return `${lines.join("\n")}\n`;
}

/** Render the human integration preflight block as a single exact
 *  string.  Field order, indentation, and `"(none)"` fallbacks match
 *  the legacy output byte-for-byte. */
function humanIntegrationPreflightLines(receipt: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(`receiptId: ${receipt.id}`);
  lines.push(`taskId: ${receipt.taskId}`);
  const reasons = receipt.rejectionReasons as string[];
  lines.push(`passed: ${reasons.length === 0}`);
  if (reasons.length > 0) {
    lines.push("rejectionReasons:");
    for (const reason of reasons) lines.push(`  - ${reason}`);
  }
  const files = receipt.affectedFiles as string[];
  lines.push(`affectedFiles: ${files.join(", ") || "(none)"}`);
  lines.push(`patchDigest: ${receipt.patchDigest || "(none)"}`);
  return `${lines.join("\n")}\n`;
}

/** Render the human integration apply block as a single exact string. */
function humanIntegrationApplyLines(result: Record<string, unknown>): string {
  const lines: string[] = [];
  if (result.operationId) lines.push(`operationId: ${result.operationId}`);
  if (result.taskId) lines.push(`taskId: ${result.taskId}`);
  lines.push(`status: ${result.status}`);
  lines.push(`receiptId: ${result.receiptId}`);
  if (result.error) lines.push(`error: ${result.error}`);
  if (result.appliedAt) lines.push(`appliedAt: ${result.appliedAt}`);
  return `${lines.join("\n")}\n`;
}

interface HumanReadableIntegrationView {
  operationId: unknown;
  taskId: unknown;
  status: unknown;
  receiptId: unknown;
  stages: unknown;
  result?: unknown;
}

function humanIntegrationOperationLines(view: HumanReadableIntegrationView): string {
  const lines = [
    `operationId: ${view.operationId}`,
    `taskId: ${view.taskId}`,
    `status: ${view.status}`,
    `receiptId: ${view.receiptId}`,
  ];
  const stages = Array.isArray(view.stages) ? view.stages : [];
  if (stages.length > 0) {
    lines.push("stages:");
    for (const stage of stages) {
      const value = stage as Record<string, unknown>;
      let detail = `${value.stage}: ${value.status}`;
      if (typeof value.commandCount === "number") {
        const parts = [`${value.commandCount} cmd`];
        if (typeof value.failedCount === "number" && value.failedCount > 0) {
          parts.push(`${value.failedCount} failed`);
        }
        if (typeof value.timedOutCount === "number" && value.timedOutCount > 0) {
          parts.push(`${value.timedOutCount} timedOut`);
        }
        if (typeof value.totalDurationMs === "number") {
          parts.push(`${value.totalDurationMs}ms`);
        }
        detail += ` (${parts.join(", ")})`;
      }
      if (value.error) detail += ` — ${value.error}`;
      lines.push(`  ${detail}`);
    }
  }
  const result = view.result as Record<string, unknown> | undefined;
  if (result?.error) lines.push(`error: ${result.error}`);
  if (result?.appliedAt) lines.push(`appliedAt: ${result.appliedAt}`);
  if (result?.createdAt) lines.push(`createdAt: ${result.createdAt}`);
  return `${lines.join("\n")}\n`;
}

/** Render the human integration history block as a single exact string. */
function humanIntegrationHistoryLines(history: {
  receipts: unknown[]; results: unknown[];
}): string {
  const lines: string[] = [];
  lines.push(`receipts: ${history.receipts.length}`);
  lines.push(`results: ${history.results.length}`);
  for (const result of history.results) {
    const r = result as Record<string, unknown>;
    lines.push(`  ${r.status} — ${r.receiptId}${r.error ? ` (${r.error})` : ""}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Human-readable one Main-direct decision line. */
function humanMainDirectDecisionLines(record: Record<string, unknown>): string {
  const outcome = typeof record.outcome === "string" ? record.outcome : "";
  const verification = typeof record.verification === "string" ? ` (${record.verification})` : "";
  return [
    `Main-direct decision: ${record.id}`,
    `  taskClass: ${record.taskClass}`,
    typeof record.taskFamily === "string" ? `  taskFamily: ${record.taskFamily}` : null,
    `  reason: ${record.reason}`,
    `  status: ${record.status}`,
    `  consideredWorkers: ${typeof record.consideredWorkerCount === "number" ? String(record.consideredWorkerCount) : "0"}`,
    typeof record.evidenceScope === "string" ? `  evidenceScope: ${record.evidenceScope}` : null,
    `  startedAt: ${typeof record.startedAt === "string" ? record.startedAt : "-"}`,
    outcome ? `  outcome: ${outcome}${verification}` : null,
    typeof record.closedAt === "string" ? `  closedAt: ${record.closedAt}` : null,
  ].filter(Boolean).join("\n") + "\n";
}

/** Human-readable list of Main-direct decisions. */
function humanMainDirectDecisionListLines(records: Record<string, unknown>[]): string {
  if (records.length === 0) return "No Main-direct decisions recorded.\n";
  const lines = [`${records.length} Main-direct decision(s):`];
  for (const r of records) {
    const outcome = typeof r.outcome === "string" ? ` | outcome: ${r.outcome}` : "";
    const verification = typeof r.verification === "string" ? ` (${r.verification})` : "";
    lines.push(
      `  ${r.id} | ${r.taskClass} | ${r.reason} | ${r.status}${outcome}${verification}`,
    );
  }
  return lines.join("\n") + "\n";
}

/** Human-readable Main-direct aggregate. */
function humanMainDirectAggregateLines(record: Record<string, unknown>): string {
  const lines = [
    "Main-direct execution decisions:",
    `  total: ${String(record.totalCount ?? 0)}`,
    `  open: ${String(record.openCount ?? 0)}`,
    `  completed: ${String(record.completedCount ?? 0)}`,
    `  abandoned: ${String(record.abandonedCount ?? 0)}`,
    `  completed verification — passed: ${String(record.completedPassedCount ?? 0)}, failed: ${String(record.completedFailedCount ?? 0)}, unavailable: ${String(record.completedUnavailableCount ?? 0)}`,
  ];
  const dist = record.reasonDistribution as Record<string, number> | undefined;
  if (dist && Object.keys(dist).length > 0) {
    lines.push("  reason distribution:");
    for (const [k, v] of Object.entries(dist)) {
      lines.push(`    ${k}: ${String(v)}`);
    }
  }
  return lines.join("\n") + "\n";
}

/** Plain-language consecutive self-upgrade streak (no raw errors or paths).
 *  JSON keeps stable codes; human output explains progress, break, and next step. */
function humanSelfUpgradeEvidenceLines(
  evidence: SelfUpgradeEvidenceProjection,
): string {
  const lines: string[] = [];
  lines.push(
    `Reliable self-upgrade streak: ${evidence.achieved} of ${evidence.required} consecutive complete upgrades.`,
  );
  switch (evidence.state) {
    case "empty":
      lines.push("No complete upgrade has been recorded yet.");
      break;
    case "in-progress":
      lines.push(
        "A consecutive streak is building, but the reliability milestone is not ready yet.",
      );
      break;
    case "ready":
      lines.push("The required consecutive complete upgrades are ready.");
      break;
  }
  switch (evidence.breakCategory) {
    case "retained-failure":
      lines.push(
        "A previous upgrade failed during activation and broke the streak.",
      );
      break;
    case "rejected":
      lines.push("A previous upgrade was rejected and broke the streak.");
      break;
    case "rolled-back":
      lines.push("A previous upgrade was rolled back and broke the streak.");
      break;
    case "insufficient-evidence":
      lines.push(
        "A previous upgrade lacked complete four-stage evidence and cannot count toward the streak.",
      );
      break;
    case "none":
      break;
  }
  if (evidence.remaining > 0 && evidence.state !== "ready") {
    lines.push(
      `${evidence.remaining} more consecutive complete upgrade(s) still needed.`,
    );
  }
  switch (evidence.nextAction) {
    case "run-first-upgrade":
      lines.push(
        "Next: Run one complete self-upgrade that applies, verifies, builds, and activates successfully.",
      );
      break;
    case "continue-consecutive-proofs":
      lines.push(
        "Next: Run more complete self-upgrades in a row without an intervening failure.",
      );
      break;
    case "milestone-ready":
      lines.push(
        "Next: The consecutive reliability milestone is satisfied for this count.",
      );
      break;
  }
  return `${lines.join("\n")}\n`;
}

/** Render the human adaptation preview block as a single exact string.
 *  Never contains raw prompt, source, Diff, log, or secret content. */
function humanAdaptationPreviewLines(preview: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(`status: ${preview.status}`);
  lines.push(`parentTaskId: ${preview.parentTaskId}`);
  lines.push(`rootTaskId: ${preview.rootTaskId}`);
  lines.push(`nextRound: ${preview.nextRound}`);
  lines.push(`maxAdaptationRounds: ${preview.maxAdaptationRounds}`);
  lines.push(`reason: ${preview.reason ?? "none"}`);
  if (preview.stoppedReason !== undefined) lines.push(`stoppedReason: ${preview.stoppedReason}`);
  lines.push(`summary: ${preview.summary}`);
  const fields = preview.fields as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(fields) && fields.length > 0) {
    lines.push("fields:");
    for (const field of fields) {
      const marker = field.changed ? "*" : " ";
      lines.push(
        `  ${marker} ${field.field}: ${String(field.before)} -> ${String(field.after)} (${field.changed ? "changed" : "unchanged"}, ${field.source ?? "unknown"}, ${field.enforcementPhase ?? "preemptive"})`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Render the human adaptation apply result block as a single exact string.
 *  Never contains raw prompt, source, Diff, log, or secret content. */
function humanAdaptationApplyLines(result: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(`status: ${result.status}`);
  if (result.childTaskId !== undefined) lines.push(`childTaskId: ${result.childTaskId}`);
  if (result.lineageId !== undefined) lines.push(`lineageId: ${result.lineageId}`);
  const preview = result.preview as Record<string, unknown> | undefined;
  if (preview !== undefined) {
    lines.push(`preview: ${preview.status}`);
    if (preview.summary !== undefined) lines.push(`summary: ${preview.summary}`);
  }
  return `${lines.join("\n")}\n`;
}

function option(arguments_: string[], flag: string): string | undefined {
  const index = arguments_.indexOf(flag);
  return index >= 0 ? arguments_[index + 1] : undefined;
}

/** Optional readiness deadline for daemon start/restart only. */
function parseOptionalDaemonStartupTimeoutMs(arguments_: string[]): number | undefined {
  if (!arguments_.includes("--startup-timeout-ms")) return undefined;
  const raw = option(arguments_, "--startup-timeout-ms");
  if (raw === undefined || raw.length === 0 || raw.startsWith("-")) {
    throw new Error(
      "daemon start/restart requires --startup-timeout-ms <integer milliseconds>",
    );
  }
  return resolveDaemonStartupTimeoutMs(Number(raw));
}

/** Optional readiness deadline for detached Hub restart only. */
function parseOptionalHubStartupTimeoutMs(arguments_: string[]): number | undefined {
  if (!arguments_.includes("--startup-timeout-ms")) return undefined;
  const raw = option(arguments_, "--startup-timeout-ms");
  if (raw === undefined || raw.length === 0 || raw.startsWith("-")) {
    throw new Error(
      "hub restart --detach requires --startup-timeout-ms <integer milliseconds>",
    );
  }
  const asNumber = Number(raw);
  if (!Number.isFinite(asNumber)) {
    throw new Error(
      "hub restart --detach requires --startup-timeout-ms <integer milliseconds>",
    );
  }
  return resolveHubStartupTimeoutMs(asNumber);
}

/** Privacy-safe detached restart JSON: closed fields only, never token/nonce/path. */
function renderDetachedHubRestartJson(
  result: DetachedHubRestartResult,
  browserOpened: boolean,
): string {
  const payload: Record<string, unknown> = {
    ok: result.ok,
    state: result.state,
    replacement: result.replacement,
    nextAction: result.nextAction,
    browserOpened,
  };
  if (result.pid !== undefined) payload.pid = result.pid;
  if (result.port !== undefined) payload.port = result.port;
  if (result.reason !== undefined) payload.reason = result.reason;
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/** Human explanation for detached restart. Never prints token, nonce, or path. */
function humanDetachedHubRestartLines(
  result: DetachedHubRestartResult,
  browserOpened: boolean,
): string {
  const lines: string[] = [];
  const details: string[] = [];
  if (result.pid !== undefined) details.push(`pid=${result.pid}`);
  if (result.port !== undefined) details.push(`port=${result.port}`);

  if (result.state === "current") {
    lines.push("The active ForkLight Hub already runs this build. No replacement is needed.");
  } else if (result.state === "ready") {
    if (result.replacement === "replaced") {
      lines.push("Replaced the previous ForkLight Hub owner with the current build.");
    } else {
      lines.push("Started a detached ForkLight Hub with the current build.");
    }
    lines.push("The Hub is authenticated and ready.");
  } else {
    lines.push("Detached ForkLight Hub restart failed.");
    if (result.reason !== undefined) lines.push(`reason: ${result.reason}`);
  }

  if (details.length > 0) lines.push(`details: ${details.join(" ")}`);
  lines.push(`replacement: ${result.replacement}`);
  lines.push(
    browserOpened
      ? "browser: opened"
      : "browser: not opened",
  );
  switch (result.nextAction) {
    case "use-existing-hub":
      lines.push("next: use the existing Hub");
      break;
    case "use-new-hub":
      lines.push("next: use the new Hub");
      break;
    case "investigate":
      lines.push(
        "next: run `forklight hub status` and investigate before any lifecycle action "
        + "(do not retry restart while a launched Hub may still be starting)",
      );
      break;
  }
  return `${lines.join("\n")}\n`;
}

function parseResumeAuthorization(arguments_: string[]): AttemptAuthorization | undefined {
  const authFlags = ["--authorize-extra", "--max-budget-usd", "--reason", "--confirm"];
  const hasAuthorizationFlag = arguments_.includes("--authorize-extra");
  if (!hasAuthorizationFlag) {
    if (authFlags.slice(1).some((flag) => arguments_.includes(flag))) {
      throw new Error("resume authorization options require --authorize-extra");
    }
    return undefined;
  }
  const reason = required(option(arguments_, "--reason"), "authorization reason");
  const rawBudget = required(option(arguments_, "--max-budget-usd"), "authorized max budget");
  if (!arguments_.includes("--confirm")) {
    throw new Error("resume extra-attempt authorization requires --confirm");
  }
  const maxBudgetUsd = rawBudget === "none" || rawBudget === "null"
    ? null
    : Number(rawBudget);
  if (
    maxBudgetUsd !== null
    && (!Number.isFinite(maxBudgetUsd) || maxBudgetUsd <= 0)
  ) {
    throw new Error("--max-budget-usd must be a positive number or none");
  }
  return {
    additionalAttempts: 1,
    maxBudgetUsd,
    reason,
    confirm: true,
  };
}

interface DirectCodexCliOptions {
  readonly values: Readonly<Record<string, string>>;
  readonly switches: ReadonlySet<string>;
}

function parseDirectCodexOptions(
  arguments_: string[], valueFlags: readonly string[], switchFlags: readonly string[] = ["--json"],
): DirectCodexCliOptions {
  const values: Record<string, string> = {};
  const switches = new Set<string>();
  const valueSet = new Set(valueFlags);
  const switchSet = new Set(switchFlags);
  const seen = new Set<string>();
  for (let index = 0; index < arguments_.length; index += 1) {
    const flag = arguments_[index]!;
    if ((!valueSet.has(flag) && !switchSet.has(flag)) || seen.has(flag)) {
      throw new Error("Invalid direct-codex arguments");
    }
    seen.add(flag);
    if (switchSet.has(flag)) {
      switches.add(flag);
      continue;
    }
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error("Invalid direct-codex arguments");
    }
    values[flag] = value;
    index += 1;
  }
  return { values, switches };
}

function requiredDirectCodexOption(options: DirectCodexCliOptions, flag: string): string {
  const value = options.values[flag];
  if (value === undefined) throw new Error(`Missing direct-codex option: ${flag}`);
  return value;
}

function parseDirectCodexJsonObject(raw: string, flag: "--usage" | "--metadata"): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`Invalid ${flag} JSON object`);
  }
}

function parseCliScalar(raw: string): unknown {
  try { return JSON.parse(raw) as unknown; } catch { return raw; }
}

function humanDirectCodexSampleLines(sample: DirectCodexPairedSample): string {
  return [
    `sampleId: ${sample.sampleId}`,
    `forklightTaskId: ${sample.forklightTaskId}`,
    `exactTaskClass: ${sample.exactTaskClass}`,
    `directCodexProfileId: ${sample.directCodexProfileId}`,
    `inputTokens: ${sample.inputTokens}`,
    `outputTokens: ${sample.outputTokens}`,
    `cacheReadInputTokens: ${sample.cacheReadInputTokens}`,
    `cacheCreationInputTokens: ${sample.cacheCreationInputTokens}`,
    `source: ${sample.source}`,
    `complete: ${sample.complete}`,
    `directRunRef: ${sample.directRunRef}`,
    `pairingRef: ${sample.pairingRef}`,
    `capturedAt: ${sample.capturedAt}`,
    `schemaVersion: ${sample.schemaVersion}`,
  ].join("\n") + "\n";
}

function humanDirectCodexInboxLines(
  taskClass: string, profileId: string, items: readonly DirectCodexInboxItem[],
): string {
  const lines = [
    `exactTaskClass: ${taskClass}`,
    `directCodexProfileId: ${profileId}`,
    `items: ${items.length}`,
  ];
  for (const item of items) {
    const sample = item.sample;
    lines.push(`  ${sample.sampleId}: ${item.reviewState}`);
    lines.push(`    forklightTaskId: ${sample.forklightTaskId}`);
    lines.push(`    capturedAt: ${sample.capturedAt}`);
    lines.push(`    tokens: input=${sample.inputTokens} output=${sample.outputTokens} cacheRead=${sample.cacheReadInputTokens} cacheCreation=${sample.cacheCreationInputTokens}`);
    if (item.review !== undefined) {
      lines.push(`    reviewer: ${item.review.reviewer}`);
      lines.push(`    reviewedAt: ${item.review.reviewedAt}`);
      if (item.review.decision === "rejected") {
        lines.push(`    rejectionReason: ${item.review.rejectionReason}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function humanDirectCodexReviewLines(review: DirectCodexSampleReview): string {
  const lines = [`sampleId: ${review.sampleId}`, `decision: ${review.decision}`];
  if (review.decision === "rejected") lines.push(`rejectionReason: ${review.rejectionReason}`);
  lines.push(`reviewer: ${review.reviewer}`);
  lines.push(`reviewedAt: ${review.reviewedAt}`);
  lines.push(`schemaVersion: ${review.schemaVersion}`);
  return `${lines.join("\n")}\n`;
}

function humanDirectCodexPublicationPreviewLines(preview: DirectCodexPublicationPreview): string {
  return [
    `exactTaskClass: ${preview.exactTaskClass}`,
    `directCodexProfileId: ${preview.directCodexProfileId}`,
    `readiness: ${preview.readiness}`,
    `nextVersion: ${preview.nextVersion ?? "unavailable"}`,
    `acceptedCount: ${preview.acceptedCount}`,
    `rejectedCount: ${preview.rejectedCount}`,
    `pendingCount: ${preview.pendingCount}`,
    `hasNewAcceptedEvidence: ${preview.hasNewAcceptedEvidence}`,
    `acceptedSampleIds: ${preview.acceptedSampleIds.join(", ") || "(none)"}`,
  ].join("\n") + "\n";
}

function humanDirectCodexRegistrationLines(result: DirectCodexRegistrationResult): string {
  const calibration = result.publication.calibration;
  return [
    "registered: true",
    `exactTaskClass: ${calibration.taskClass}`,
    `directCodexProfileId: ${result.publication.directCodexProfileId}`,
    `version: ${result.summary.version}`,
    `acceptedSampleCount: ${result.summary.acceptedSampleCount}`,
    `acceptedSampleIds: ${result.summary.acceptedSampleIds.join(", ")}`,
    `method: ${calibration.method}`,
    `confidence: ${calibration.confidence}`,
    `createdAt: ${calibration.createdAt}`,
  ].join("\n") + "\n";
}

function findHubAssets(): string {
  const dist = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "hub", "public",
  );
  if (existsSync(path.join(dist, "index.html"))) return dist;
  const src = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..", "..", "src", "hub", "public",
  );
  if (existsSync(path.join(src, "index.html"))) return src;
  throw new Error("Hub assets not found. Run the build step first.");
}

function findPackageRoot(): string {
  let candidate = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 4; depth += 1) {
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    candidate = path.dirname(candidate);
  }
  throw new Error("ForkLight package root not found");
}

function printStatistics(summaries: CompactProviderModelSummary[]): void {
  if (summaries.length === 0) {
    process.stdout.write("No matching statistics.\n");
    return;
  }
  for (const summary of summaries) {
    process.stdout.write(
      `${summary.provider}/${summary.model}: ${summary.sampleSize} tasks, ${(summary.successRate * 100).toFixed(1)}% success, ${summary.verifiedSuccessCount} verified\n`,
    );
    process.stdout.write(`  retries: ${summary.retryCount} total (${summary.avgRetries.toFixed(1)}/task)\n`);
    process.stdout.write(
      summary.avgTimeToFirstEffectiveActionMs === undefined
        ? "  first effective action: unavailable\n"
        : `  first effective action: avg ${(summary.avgTimeToFirstEffectiveActionMs / 1000).toFixed(1)}s (${summary.firstEffectiveActionSampleSize} samples)\n`,
    );
    process.stdout.write(
      summary.avgDurationMs === undefined
        ? "  duration: unavailable\n"
        : `  duration: avg ${(summary.avgDurationMs / 1000).toFixed(1)}s (${summary.durationSampleSize} samples)\n`,
    );
    process.stdout.write(
      summary.avgCostUsd === undefined
        ? "  cost: unavailable\n"
        : `  cost: avg $${summary.avgCostUsd.toFixed(4)} (${summary.costSampleSize} samples)\n`,
    );
    process.stdout.write(
      summary.avgTurns === undefined
        ? "  turns: unavailable\n"
        : `  turns: avg ${summary.avgTurns.toFixed(1)} (${summary.turnsSampleSize} samples)\n`,
    );
    process.stdout.write(
      `  delivery: ${summary.acceptedDeliveryCount} accepted (${(summary.acceptedDeliveryRate * 100).toFixed(1)}%), ${summary.mainRepairedDeliveryCount} main-repaired\n`,
    );
    process.stdout.write(
      `  remediation checks: ${summary.remediationCheckCount}\n`,
    );
    const failures = Object.entries(summary.failureDistribution)
      .map(([category, count]) => `${category}=${count}`)
      .join(", ");
    if (failures) process.stdout.write(`  failures: ${failures}\n`);
  }
}

async function health(json: boolean): Promise<void> {
  let claudeVersion = "unavailable";
  try {
    claudeVersion = execFileSync("claude", ["--version"], { encoding: "utf8" }).trim();
  } catch {
    // Reported in health output.
  }
  const store = new StateStore(forklightHome());
  try {
    const settings = new SettingsService(store).get();
    const localReadiness = providerReadiness(settings.providerDefaults);
    const { listWorkerAdapters } = await import("./workers/registry.js");
    const runtimes: Record<string, unknown> = {};
    const runtimeDoctors: Partial<Record<RuntimeName, RuntimeDoctorSnapshot>> = {};
    for (const adapter of listWorkerAdapters()) {
      const doctor = adapter.doctor();
      if (doctor instanceof Promise) continue;
      runtimes[adapter.name] = {
        ok: doctor.ok,
        displayName: adapter.displayName,
        executable: doctor.executable,
        ...(doctor.version === undefined ? {} : { version: doctor.version }),
        issues: doctor.issues,
      };
      runtimeDoctors[adapter.name] = { ok: doctor.ok };
    }
    const clientBuildIdentity = currentBuildIdentity();
    let daemonBuildIdentity: unknown;
    let daemonEvidence: DaemonHealthEvidence | undefined;
    let identityStatus = "daemon-unavailable";
    let identityAction: string | undefined;
    try {
      const response = await daemonExchange("health");
      daemonBuildIdentity = response.serverIdentity;
      daemonEvidence = {
        ok: response.ok,
        serverIdentity: response.serverIdentity,
        result: response.result,
      };
      if (isBuildIdentity(response.serverIdentity)) {
        const comparison = compareBuildIdentity(clientBuildIdentity, response.serverIdentity);
        identityStatus = comparison.sameBuild
          ? "matched"
          : comparison.protocolCompatible
            ? "build-mismatch"
            : "protocol-mismatch";
        if (!comparison.sameBuild) {
          identityAction = "Rebuild and restart ForkLight daemon and MCP before changes";
        }
      } else {
        identityStatus = "daemon-identity-unavailable";
        identityAction = "Rebuild and restart ForkLight daemon and MCP before changes";
      }
    } catch {
      // Local CLI health remains useful even when the daemon is not running.
    }
    const executionFacts = resolveExecutionProviderFacts({
      clientBuildIdentity,
      ...(daemonEvidence === undefined ? {} : { daemonEvidence }),
      localProviders: providerNames().map((name) => ({
        name,
        label: providerLabel(name),
        configured: localReadiness.providers[name].ready,
        ready: localReadiness.providers[name].ready,
        authMode: localReadiness.providers[name].authMode,
        defaultModel: localReadiness.providers[name].defaultModel,
      })),
    });
    const readiness = projectExecutionProviderReadiness(
      executionFacts.providers,
      localReadiness.providers,
    );
    const providerVerification = safeProviderVerificationSnapshot(
      store,
      settings,
      readiness.providers,
      Date.now(),
    );
    const workerReadiness = buildHealthWorkerReadiness({
      settings,
      providers: readiness.providers,
      runtimeDoctors,
      providerVerification,
    });
    const result = {
      // Transition: ok still requires Claude + any provider (daemon submit can still pick Grok when doctor ok).
      ok: claudeVersion !== "unavailable" && readiness.anyReady,
      node: process.version,
      claudeCode: claudeVersion,
      runtimes,
      defaultRuntime: settings.execution.defaultRuntime,
      providerReadinessSource: executionFacts.source,
      providerReadinessSourceDetail: executionFacts.sourceDetail,
      providers: readiness.providers,
      workers: projectWorkerReadinessJson(workerReadiness),
      home: forklightHome(),
      clientBuildIdentity,
      ...(daemonBuildIdentity === undefined ? {} : { daemonBuildIdentity }),
      identityStatus,
      ...(identityAction === undefined ? {} : { identityAction }),
    };
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      process.stdout.write(`ok: ${result.ok}\nnode: ${result.node}\nclaudeCode: ${result.claudeCode}\n`);
      process.stdout.write(`defaultRuntime: ${result.defaultRuntime}\n`);
      process.stdout.write(
        `providerReadinessSource: ${result.providerReadinessSource} (${result.providerReadinessSourceDetail})\n`,
      );
      process.stdout.write("runtimes:\n");
      for (const [name, runtime] of Object.entries(result.runtimes)) {
        const r = runtime as { ok?: boolean; displayName?: string; issues?: string[] };
        process.stdout.write(
          `  ${name}: ${r.ok ? "ok" : "unavailable"}${r.displayName ? ` (${r.displayName})` : ""}\n`,
        );
      }
      process.stdout.write("providers:\n");
      for (const [name, provider] of Object.entries(result.providers)) {
        process.stdout.write(
          `  ${name}: ready=${provider.ready} model=${provider.defaultModel} endpoint=${provider.endpoint}\n`,
        );
      }
      process.stdout.write(humanWorkerReadinessLines(workerReadiness));
      process.stdout.write(`home: ${result.home}\n`);
      process.stdout.write(
        `identity: ${result.identityStatus} protocol=${clientBuildIdentity.protocolVersion} build=${clientBuildIdentity.buildId}\n`,
      );
      if (identityAction !== undefined) process.stdout.write(`identityAction: ${identityAction}\n`);
    }
  } finally {
    store.close();
  }
}

function parseDottedPath(dottedPath: string, rawValue: string): Record<string, unknown> {
  const parts = dottedPath.split(".");
  if (parts.length === 0 || parts.some((p) => p.length === 0)) {
    throw new Error("settings path must be a dotted sequence like competition.rankingWeights.duration");
  }
  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(rawValue);
  } catch {
    parsedValue = rawValue;
  }
  let result: Record<string, unknown> = { [parts[parts.length - 1]!]: parsedValue };
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    result = { [parts[i]!]: result };
  }
  return result;
}

function printSettingsHuman(settings: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(settings, null, 2) + "\n");
}

function printProviderStatus(result: Record<string, unknown>): void {
  for (const [name, status] of Object.entries(result)) {
    const s = status as Record<string, unknown>;
    process.stdout.write(`${name}: status=${s.status} model=${s.model}\n`);
    const evidence = s.evidence as Record<string, unknown> | undefined;
    if (evidence) {
      process.stdout.write(
        `  evidence: ${evidence.status} latency=${evidence.latencyMs}ms timestamp=${evidence.timestamp}\n`,
      );
    }
  }
}

function printProviderProbe(result: Record<string, unknown>): void {
  for (const [name, outcome] of Object.entries(result)) {
    const o = outcome as Record<string, unknown>;
    if (o.error) {
      process.stdout.write(`${name}: probe error - ${o.error}\n`);
    } else {
      process.stdout.write(
        `${name}: ${o.status} model=${o.model} latency=${o.latencyMs}ms endpoint=${o.endpointOrigin}\n`,
      );
      if (o.failureCategory) {
        process.stdout.write(
          `  failure: ${o.failureCategory}${o.failureSummary ? ` - ${o.failureSummary}` : ""}\n`,
        );
      }
    }
  }
}

/** Render the read-only Hub status for a human. Never contains the URL,
 *  token, nonce, raw record, private home path, or raw build id. */
function humanHubStatusLines(status: HubInspectionStatus): string {
  const lines: string[] = [];
  const details: string[] = [];
  if (status.pid !== undefined) details.push(`pid=${status.pid}`);
  if (status.port !== undefined) details.push(`port=${status.port}`);
  switch (status.state) {
    case "stopped":
      lines.push("No ForkLight Hub is active.");
      lines.push("next: start one with `forklight hub`");
      break;
    case "current":
      lines.push("A ForkLight Hub is active and matches this build.");
      if (details.length > 0) lines.push(`details: ${details.join(" ")}`);
      lines.push("next: use the existing Hub");
      break;
    case "different-build":
      lines.push("A ForkLight Hub is active but runs a different build.");
      if (details.length > 0) lines.push(`details: ${details.join(" ")}`);
      lines.push("next: run `forklight hub restart --confirm` to replace it");
      break;
    case "legacy":
      lines.push("A ForkLight Hub is active but its build version is unknown.");
      if (details.length > 0) lines.push(`details: ${details.join(" ")}`);
      lines.push("next: run `forklight hub restart --confirm` to replace it");
      break;
    case "unverified":
      lines.push("ForkLight Hub ownership cannot be verified safely.");
      if (status.reason !== undefined) lines.push(`reason: ${status.reason}`);
      lines.push("next: investigate the Hub state before any lifecycle action");
      break;
  }
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const [command, positional, ...rest] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(usage());
    return;
  }
  const json = rest.includes("--json") || positional === "--json";
  if (command === "health") {
    await health(json);
    return;
  }

  if (command === "direct-codex") {
    const subcommand = required(positional, "direct-codex subcommand");
    if (subcommand === "capture") {
      const options = parseDirectCodexOptions(rest, ["--usage", "--metadata"]);
      const usageEvent = parseDirectCodexJsonObject(
        requiredDirectCodexOption(options, "--usage"), "--usage",
      );
      const metadata = parseDirectCodexJsonObject(
        requiredDirectCodexOption(options, "--metadata"), "--metadata",
      );
      const displayJson = options.switches.has("--json");
      let capturedTaskId: string | undefined;
      const { output } = await withCliExchangeReceipt({
        operation: "forklight_direct_codex_capture",
        home: forklightHome(),
        args: { usage: usageEvent, metadata, json: displayJson },
        taskId: () => capturedTaskId,
        invoke: async () => {
          await ensureDaemon();
          const sample = await daemonRequest<DirectCodexPairedSample>(
            "direct_codex_capture", { usage: usageEvent, metadata },
          );
          capturedTaskId = sample.forklightTaskId;
          return sample;
        },
        renderOutput: (sample) => displayJson
          ? `${JSON.stringify(sample, null, 2)}\n`
          : humanDirectCodexSampleLines(sample),
      });
      process.stdout.write(output);
      return;
    }

    if (subcommand === "capture-task") {
      const options = parseDirectCodexOptions(rest, ["--task-id", "--run-ref", "--usage"]);
      const taskId = requiredDirectCodexOption(options, "--task-id");
      const codexRunRef = requiredDirectCodexOption(options, "--run-ref");
      const usageEvent = parseDirectCodexJsonObject(
        requiredDirectCodexOption(options, "--usage"), "--usage",
      );
      const displayJson = options.switches.has("--json");
      let capturedTaskId: string | undefined;
      const { output } = await withCliExchangeReceipt({
        operation: "forklight_direct_codex_capture",
        home: forklightHome(),
        args: { taskId, codexRunRef, usage: usageEvent, json: displayJson },
        taskId: () => capturedTaskId,
        invoke: async () => {
          await ensureDaemon();
          const sample = await daemonRequest<DirectCodexPairedSample>(
            "direct_codex_guided_capture",
            { forklightTaskId: taskId, codexRunRef, usage: usageEvent },
          );
          capturedTaskId = sample.forklightTaskId;
          return sample;
        },
        renderOutput: (sample) => displayJson
          ? `${JSON.stringify(sample, null, 2)}\n`
          : humanDirectCodexSampleLines(sample),
      });
      process.stdout.write(output);
      return;
    }

    if (subcommand === "inbox") {
      const options = parseDirectCodexOptions(rest, ["--task-class", "--profile-id"]);
      const taskClass = requiredDirectCodexOption(options, "--task-class");
      const profileId = requiredDirectCodexOption(options, "--profile-id");
      await ensureDaemon();
      const items = await daemonRequest<readonly DirectCodexInboxItem[]>("direct_codex_inbox", {
        taskClass, directCodexProfileId: profileId,
      });
      process.stdout.write(options.switches.has("--json")
        ? `${JSON.stringify(items, null, 2)}\n`
        : humanDirectCodexInboxLines(taskClass, profileId, items));
      return;
    }

    if (subcommand === "review") {
      const options = parseDirectCodexOptions(rest, [
        "--sample-id", "--decision", "--rejection-reason", "--reviewer",
        "--reviewed-at", "--schema-version",
      ], ["--confirm", "--json"]);
      const sampleId = requiredDirectCodexOption(options, "--sample-id");
      const decision = requiredDirectCodexOption(options, "--decision");
      const reviewer = requiredDirectCodexOption(options, "--reviewer");
      const reviewedAt = requiredDirectCodexOption(options, "--reviewed-at");
      const schemaVersion = parseCliScalar(requiredDirectCodexOption(options, "--schema-version"));
      if (!options.switches.has("--confirm")) {
        throw new Error("Direct Codex review requires explicit --confirm");
      }
      const rejectionReason = options.values["--rejection-reason"];
      const params = {
        sampleId, decision,
        ...(rejectionReason === undefined ? {} : { rejectionReason }),
        reviewer, reviewedAt, schemaVersion, confirm: true,
      };
      await ensureDaemon();
      const review = await daemonRequest<DirectCodexSampleReview>("direct_codex_review", params);
      process.stdout.write(options.switches.has("--json")
        ? `${JSON.stringify(review, null, 2)}\n`
        : humanDirectCodexReviewLines(review));
      return;
    }

    if (subcommand === "publication-preview") {
      const options = parseDirectCodexOptions(rest, ["--task-class", "--profile-id"]);
      const taskClass = requiredDirectCodexOption(options, "--task-class");
      const directCodexProfileId = requiredDirectCodexOption(options, "--profile-id");
      await ensureDaemon();
      const preview = await daemonRequest<DirectCodexPublicationPreview>(
        "direct_codex_publication_preview", { taskClass, directCodexProfileId },
      );
      process.stdout.write(options.switches.has("--json")
        ? `${JSON.stringify(preview, null, 2)}\n`
        : humanDirectCodexPublicationPreviewLines(preview));
      return;
    }

    if (subcommand === "publication-register") {
      const options = parseDirectCodexOptions(rest, [
        "--task-class", "--profile-id", "--method", "--confidence", "--created-at",
      ], ["--confirm", "--json"]);
      const taskClass = requiredDirectCodexOption(options, "--task-class");
      const directCodexProfileId = requiredDirectCodexOption(options, "--profile-id");
      const method = requiredDirectCodexOption(options, "--method");
      const confidence = requiredDirectCodexOption(options, "--confidence");
      const createdAt = requiredDirectCodexOption(options, "--created-at");
      if (!options.switches.has("--confirm")) {
        throw new Error("Direct Codex publication registration requires explicit --confirm");
      }
      await ensureDaemon();
      const result = await daemonRequest<DirectCodexRegistrationResult>(
        "direct_codex_publication_register",
        { taskClass, directCodexProfileId, method, confidence, createdAt, confirm: true },
      );
      process.stdout.write(options.switches.has("--json")
        ? `${JSON.stringify(result, null, 2)}\n`
        : humanDirectCodexRegistrationLines(result));
      return;
    }

    throw new Error(
      "Unknown direct-codex subcommand. Use: capture, capture-task, inbox, review, publication-preview, or publication-register.",
    );
  }

  if (command === "validate") {
    const store = new StateStore(forklightHome());
    try {
      const settings = new SettingsService(store).get();
      const preview = await buildTaskAdmissionPreview(
        required(positional, "task file"),
        settings,
      );
      if (json) {
        process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
      } else {
        process.stdout.write(formatTaskAdmissionPreviewHuman(preview));
      }
      if (!preview.quality.passed) process.exitCode = 1;
    } finally {
      store.close();
    }
    return;
  }

  if (command === "validate-plan") {
    const store = new StateStore(forklightHome());
    try {
      const settings = new SettingsService(store).get();
      const policy = taskPolicyFromSettings(settings);
      const report = await loadWorkPlan(required(positional, "plan file"), policy);
      if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      else {
        process.stdout.write(`Work Plan: ${report.passed ? "PASS" : "FAIL"} (${report.score}/100)\n`);
        process.stdout.write(`Objective: ${report.plan.objective}\n`);
        report.plan.waves.forEach((wave, index) => {
          process.stdout.write(`Wave ${index + 1}: ${wave.join(", ")}\n`);
        });
        for (const issue of report.issues) process.stdout.write(`✗ ${issue}\n`);
      }
      if (!report.passed) process.exitCode = 1;
    } finally {
      store.close();
    }
    return;
  }

  if (command === "submit-plan") {
    await ensureDaemon();
    const result = await daemonRequest<{ planId: string; taskIdsByItemId: Record<string, string> }>(
      "plan_submit_file",
      { planFile: path.resolve(required(positional, "plan file")) },
    );
    process.stdout.write(`planId: ${result.planId}\n`);
    for (const [itemId, taskId] of Object.entries(result.taskIdsByItemId).sort()) {
      process.stdout.write(`  ${itemId}: ${taskId}\n`);
    }
    return;
  }

  if (command === "inspect-plan") {
    await ensureDaemon();
    const board = await daemonRequest<PlanBoard>("plan_board", {
      planId: required(positional, "plan id"),
    });
    if (json) process.stdout.write(`${JSON.stringify(board, null, 2)}\n`);
    else {
      process.stdout.write(`Plan: ${board.plan.name}\nObjective: ${board.plan.objective}\n`);
      process.stdout.write(
        `Progress: ${board.plan.progress.completed}/${board.plan.progress.total} (${board.plan.progress.percent}%)\n`,
      );
      for (const [column, items] of Object.entries(board.columns)) {
        if (items.length === 0) continue;
        process.stdout.write(`[${column}] (${items.length} items)\n`);
        for (const item of items) {
          process.stdout.write(
            `  ${item.itemId} - ${item.taskName ?? "pending"} (${item.taskStatus ?? "not started"})\n`,
          );
        }
      }
    }
    return;
  }

  if (command === "board") {
    await ensureDaemon();
    const boards = await daemonRequest<PlanBoardSummary[]>("plan_board_overview", {});
    if (json) process.stdout.write(`${JSON.stringify(boards, null, 2)}\n`);
    else if (boards.length === 0) process.stdout.write("No active plans.\n");
    else {
      for (const plan of boards) {
        process.stdout.write(`${plan.planId}\n`);
        process.stdout.write(
          `  ${plan.name} — ${plan.progress.completed}/${plan.progress.total} (${plan.progress.percent}%)\n`,
        );
      }
    }
    return;
  }

  if (command === "submit-goal") {
    await ensureDaemon();
    const result = await daemonRequest<{
      goalId: string;
      planId: string;
      taskIdsByItemId: Record<string, string>;
    }>("goal_submit_file", { goalFile: path.resolve(required(positional, "goal file")) });
    process.stdout.write(`goalId: ${result.goalId}\n`);
    process.stdout.write(`planId: ${result.planId}\n`);
    for (const [itemId, taskId] of Object.entries(result.taskIdsByItemId).sort()) {
      process.stdout.write(`  ${itemId}: ${taskId}\n`);
    }
    return;
  }

  if (command === "goal") {
    const operation = required(positional, "goal operation");
    await ensureDaemon();
    if (operation === "status") {
      const goalId = required(rest[0], "goal id");
      const view = await daemonRequest<Record<string, unknown>>("goal_status", { goalId });
      if (json) process.stdout.write(`${JSON.stringify(view, null, 2)}\n`);
      else {
        process.stdout.write(`Goal: ${String(view.name)}\n`);
        process.stdout.write(`Objective: ${String(view.objective)}\n`);
        process.stdout.write(`Status: ${String(view.status)}\n`);
        process.stdout.write(`What just happened: ${String(view.whatJustHappened)}\n`);
        process.stdout.write(`What is waiting: ${String(view.whatIsWaiting)}\n`);
        process.stdout.write(`Next: ${String(view.nextAction)}\n`);
        if (view.reason && view.reasonCode && view.reasonCode !== "none") {
          process.stdout.write(`Reason (${String(view.reasonCode)}): ${String(view.reason)}\n`);
        }
        const policy = view.policy as {
          maxDurationMs?: number | null;
          noProgressTimeoutMs?: number | null;
          maxCorrectionRounds?: number;
          maxReviewRounds?: number;
          maxNoNewEvidenceCycles?: number;
        } | undefined;
        if (policy) {
          const formatPolicyMs = (ms: number | null | undefined): string => {
            if (ms === null || ms === undefined) return "unlimited";
            if (ms >= 3_600_000 && ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
            if (ms >= 60_000) return `${Math.ceil(ms / 60_000)}m`;
            return `${Math.ceil(ms / 1000)}s`;
          };
          process.stdout.write(
            `Policy: total duration ${formatPolicyMs(policy.maxDurationMs)}; `
            + `no-progress stop after ${formatPolicyMs(policy.noProgressTimeoutMs)}; `
            + `max corrections ${String(policy.maxCorrectionRounds ?? 0)}; `
            + `max reviews ${String(policy.maxReviewRounds ?? 0)}; `
            + `max no-new-evidence ${String(policy.maxNoNewEvidenceCycles ?? 0)}\n`,
          );
        }
        if (view.status === "stopped" && view.stoppedAt) {
          process.stdout.write(`Stopped at: ${String(view.stoppedAt)}\n`);
        }
        const current = view.currentMilestone as Record<string, unknown> | undefined;
        if (current) {
          process.stdout.write(
            `Current milestone: ${String(current.itemId)} (${String(current.gate)})\n`,
          );
        }
        const progress = view.progress as { satisfied?: number; total?: number; percent?: number } | undefined;
        if (progress) {
          process.stdout.write(
            `Progress: ${progress.satisfied ?? 0}/${progress.total ?? 0} (${progress.percent ?? 0}%)\n`,
          );
        }
      }
      return;
    }
    if (operation === "list") {
      const limitRaw = option(rest, "--limit");
      const limit = limitRaw === undefined ? 50 : Number(limitRaw);
      const goals = await daemonRequest<Array<Record<string, unknown>>>("goal_list", { limit });
      if (json) process.stdout.write(`${JSON.stringify(goals, null, 2)}\n`);
      else if (goals.length === 0) process.stdout.write("No goals.\n");
      else {
        for (const goal of goals) {
          const progress = goal.progress as { satisfied?: number; total?: number } | undefined;
          process.stdout.write(`${String(goal.goalId)}\n`);
          process.stdout.write(
            `  ${String(goal.name)} — ${String(goal.status)} — ${progress?.satisfied ?? 0}/${progress?.total ?? 0}\n`,
          );
          process.stdout.write(`  Next: ${String(goal.nextAction)}\n`);
        }
      }
      return;
    }
    if (operation === "advance") {
      const goalId = required(rest[0], "goal id");
      if (!rest.includes("--confirm")) {
        throw new Error("goal advance requires --confirm");
      }
      const result = await daemonRequest<Record<string, unknown>>("goal_advance", {
        goalId,
        confirm: true,
      });
      if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else {
        const goal = result.goal as Record<string, unknown> | undefined;
        process.stdout.write(
          `Advanced: ${String(result.advanced)} newEvidence: ${String(result.newEvidence)} cycles: ${String(result.noNewEvidenceCycles)}\n`,
        );
        if (goal) {
          process.stdout.write(`Status: ${String(goal.status)}\n`);
          process.stdout.write(`Next: ${String(goal.nextAction)}\n`);
        }
      }
      return;
    }
    if (operation === "stop") {
      const goalId = required(rest[0], "goal id");
      if (!rest.includes("--confirm")) {
        throw new Error("goal stop requires --confirm");
      }
      const view = await daemonRequest<Record<string, unknown>>("goal_stop", {
        goalId,
        confirm: true,
      });
      if (json) process.stdout.write(`${JSON.stringify(view, null, 2)}\n`);
      else {
        process.stdout.write(`Goal stopped: ${String(view.goalId)}\n`);
        process.stdout.write(`Reason: ${String(view.reason)}\n`);
        process.stdout.write(`Next: ${String(view.nextAction)}\n`);
      }
      return;
    }
    if (operation === "handoff") {
      const taskId = required(rest[0], "source Goal Task id");
      const candidateRevisionId = required(option(rest, "--revision"), "--revision candidateRevisionId");
      const reusableRaw = required(option(rest, "--reusable"), "--reusable JSON array of relative paths");
      const gapsRaw = required(option(rest, "--gaps"), "--gaps JSON array of remaining gaps");
      const destinationWorkerProfileId = required(
        option(rest, "--to-profile"),
        "--to-profile destination Worker Profile id",
      );
      const reason = required(option(rest, "--reason"), "--reason text");
      const reasonText = reason.trim();
      if (reasonText.length === 0 || reasonText.length > 1000) {
        throw new Error("--reason must be 1-1000 characters");
      }
      if (option(rest, "--confirm") === undefined) {
        throw new Error("goal handoff requires --confirm to authorize the cross-Worker successor");
      }
      let reusablePaths: unknown;
      let remainingGaps: unknown;
      try {
        reusablePaths = JSON.parse(reusableRaw);
      } catch {
        throw new Error("--reusable must be valid JSON");
      }
      try {
        remainingGaps = JSON.parse(gapsRaw);
      } catch {
        throw new Error("--gaps must be valid JSON");
      }
      const result = await daemonRequest<Record<string, unknown>>("goal_task_handoff", {
        taskId,
        candidateRevisionId,
        reusablePaths,
        remainingGaps,
        destinationWorkerProfileId,
        reason: reasonText,
        confirm: true,
      });
      if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else {
        process.stdout.write(
          `Goal handoff ${String(result.status)}: retained ${String(result.reusablePathCount)} path(s) and ${String(result.remainingGapCount)} gap(s)\n`,
        );
        process.stdout.write(
          `source Task ${String(result.sourceTaskId)} → destination ${String(result.destinationWorkerProfileId)}\n`,
        );
        process.stdout.write(
          `successor Task ${String(result.successorTaskId)} (not a retry); digest ${String(result.sourceDigestPrefix)}\n`,
        );
        if (result.goalId !== undefined) {
          process.stdout.write(
            `Goal ${String(result.goalId)} milestone ${String(result.itemId ?? "")} now follows the successor for gates.\n`,
          );
        }
        if (result.failureCode !== undefined) {
          process.stdout.write(`failure: ${String(result.failureCode)}\n`);
        }
        process.stdout.write(`next: ${String(result.nextAction)}\n`);
        process.stdout.write(
          "Original Plan Task is history. Fresh verification, Main Review, and Integration still apply to the successor.\n",
        );
      }
      return;
    }
    throw new Error(`Unknown goal operation: ${operation}\n\n${usage()}`);
  }

  if (command === "daemon") {
    const operation = required(positional, "daemon operation");
    if (operation === "start") {
      const startupTimeoutMs = parseOptionalDaemonStartupTimeoutMs(rest);
      const result = await ensureDaemon(
        forklightHome(),
        startupTimeoutMs === undefined ? {} : { startupTimeoutMs },
      );
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    if (operation === "status") {
      const result = await daemonRequest("health");
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    if (operation === "stop") {
      const handoffContext = readActivationHandoffContext();
      if (handoffContext !== undefined) {
        const { operationId, taskId, receiptId } = handoffContext;
        const result = await stopDaemonForHandoff(
          forklightHome(), operationId, taskId, receiptId,
        );
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      const result = await stopDaemon();
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    if (operation === "restart") {
      const startupTimeoutMs = parseOptionalDaemonStartupTimeoutMs(rest);
      const result = await restartDaemon(
        forklightHome(),
        startupTimeoutMs === undefined ? {} : { startupTimeoutMs },
      );
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    throw new Error(`Unknown daemon operation: ${operation}`);
  }

  if (command === "submit") {
    const taskFile = path.resolve(required(positional, "task file"));
    let submittedTaskId: string | undefined;
    const { output } = await withCliExchangeReceipt({
      operation: "forklight_submit",
      home: forklightHome(),
      args: { taskFile },
      taskId: () => submittedTaskId,
      invoke: async () => {
        await ensureDaemon();
        const task = await daemonRequest<TaskRecord>("submit_file", { taskFile });
        submittedTaskId = task.id;
        return task;
      },
      renderOutput: (task) => humanStatusLines(task),
    });
    process.stdout.write(output);
    return;
  }

  if (command === "stats") {
    const options = [positional, ...rest].filter((value): value is string => value !== undefined);
    const deepAudit = options.includes("--deep-audit");
    // Human output prints aggregates only; full failure rows are JSON-only.
    // Reject before daemon contact so --deep-audit never pays transfer cost without delivering detail.
    if (deepAudit && !json) {
      throw new Error(
        "stats --deep-audit requires --json (human output already prints aggregates only)",
      );
    }
    const filter = {
      ...(option(options, "--provider") === undefined
        ? {}
        : { providerName: option(options, "--provider") }),
      ...(option(options, "--model") === undefined ? {} : { modelName: option(options, "--model") }),
      ...(option(options, "--since") === undefined ? {} : { since: option(options, "--since") }),
      ...(option(options, "--until") === undefined ? {} : { until: option(options, "--until") }),
      detail: deepAudit ? "full" as const : "compact" as const,
    };
    await ensureDaemon();
    const summaries = await daemonRequest<ProviderModelSummary[] | CompactProviderModelSummary[]>(
      "statistics",
      filter,
    );
    if (json) process.stdout.write(`${JSON.stringify(summaries, null, 2)}\n`);
    else printStatistics(summaries);
    return;
  }

  if (command === "routing") {
    const taskClass = required(positional, "task class");
    const rawCandidates = required(option(rest, "--candidates"), "--candidates JSON array");
    const taskFamily = option(rest, "--family");
    const compIntentRaw = option(rest, "--comp-intent");
    const compTriggersRaw = option(rest, "--comp-triggers");
    let candidates: Array<{ provider: string; model: string }>;
    try {
      const parsed: unknown = JSON.parse(rawCandidates);
      if (!Array.isArray(parsed)) throw new Error("not an array");
      candidates = (parsed as Array<Record<string, unknown>>).map((c, i) => {
        if (typeof c.provider !== "string" || !c.provider.trim()) {
          throw new Error(`candidates[${i}].provider must be a non-empty string`);
        }
        if (typeof c.model !== "string" || !c.model.trim()) {
          throw new Error(`candidates[${i}].model must be a non-empty string`);
        }
        return { provider: c.provider.trim(), model: c.model.trim() };
      });
    } catch (e) {
      throw new Error(`Invalid --candidates JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    let compIntent: string | undefined;
    if (compIntentRaw !== undefined) {
      if (compIntentRaw !== "none" && compIntentRaw !== "consider" && compIntentRaw !== "required") {
        throw new Error("--comp-intent must be none, consider, or required");
      }
      compIntent = compIntentRaw;
    }
    let compTriggers: string[] | undefined;
    if (compTriggersRaw !== undefined) {
      try {
        const parsed: unknown = JSON.parse(compTriggersRaw);
        if (!Array.isArray(parsed)) throw new Error("not an array");
        compTriggers = (parsed as string[]).filter((t) => typeof t === "string");
      } catch (e) {
        throw new Error(`Invalid --comp-triggers JSON: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await ensureDaemon();
    const advisory = await daemonRequest<Record<string, unknown>>("model_routing", {
      taskClass,
      candidates,
      ...(taskFamily !== undefined ? { taskFamily } : {}),
      ...(compIntent !== undefined ? { competitionIntent: compIntent } : {}),
      ...(compTriggers !== undefined ? { competitionTriggers: compTriggers } : {}),
    });
    if (json) {
      process.stdout.write(`${JSON.stringify(advisory, null, 2)}\n`);
    } else {
      process.stdout.write(`Task class: ${advisory.taskClass}\n`);
      if (advisory.taskFamily) {
        process.stdout.write(`Task family: ${advisory.taskFamily}\n`);
      }
      process.stdout.write(`Evidence scope: ${advisory.evidenceScope}\n`);
      process.stdout.write(`Knowledge: ${advisory.knowledge}\n`);
      const comp = advisory.competition as Record<string, unknown> | undefined;
      process.stdout.write(`Should run competition: ${advisory.shouldRunCompetition}\n`);
      if (comp) {
        process.stdout.write(`Competition intent: ${comp.intent}\n`);
        const matching = comp.matchingTriggers as string[] | undefined;
        if (matching && matching.length > 0) {
          process.stdout.write(`Matching triggers: ${matching.join(", ")}\n`);
        }
      }
      if (advisory.recommendation) {
        const rec = advisory.recommendation as Record<string, unknown>;
        process.stdout.write(
          `Recommendation: ${rec.provider}/${rec.model} (confidence ${rec.confidence})\n  ${rec.reasoning}\n`,
        );
      } else {
        process.stdout.write("Recommendation: none (insufficient or incompatible evidence)\n");
      }
      const cands = advisory.candidates as Array<Record<string, unknown>>;
      for (const cand of cands) {
        process.stdout.write(
          `${cand.provider}/${cand.model}: score=${cand.totalScore}\n`,
        );
        const ev = cand.evidence as Record<string, unknown>;
        process.stdout.write(`  samples: ${ev.relevantSampleCount} | model-quality failures: ${ev.modelQualityFailureCount} | accepted delivery: ${ev.acceptedDeliveryRate !== undefined ? (Number(ev.acceptedDeliveryRate) * 100).toFixed(1) + "%" : "0%"}\n`);
        const nonModel = ev.ignoredNonModelFailures as Record<string, number> | undefined;
        if (nonModel) {
          const entries = Object.entries(nonModel);
          if (entries.length > 0) {
            process.stdout.write(`  ignored non-model failures: ${entries.map(([k, v]) => `${k}=${v}`).join(", ")}\n`);
          }
        }
        const unc = cand.uncertainty as Record<string, boolean>;
        if (unc.insufficientSamples || unc.insufficientGap || unc.incompatibleCost) {
          const reasons: string[] = [];
          if (unc.insufficientSamples) reasons.push("insufficient samples");
          if (unc.insufficientGap) reasons.push("score gap too small");
          if (unc.incompatibleCost) reasons.push("cost evidence not comparable");
          process.stdout.write(`  uncertainty: ${reasons.join(", ")}\n`);
        }
        const factors = cand.factors as Array<Record<string, unknown>>;
        for (const f of factors) {
          const avail = f.available ? "✓" : "✗";
          process.stdout.write(
            `  ${avail} ${f.factor}: raw=${f.rawValue ?? "—"} norm=${Number(f.normalizedScore).toFixed(3)} weighted=${Number(f.weightedScore).toFixed(3)} [w=${f.weight}]${!f.available && f.unavailableReason ? ` — ${f.unavailableReason}` : ""}\n`,
          );
        }
      }
    }
    return;
  }

  if (command === "settings") {
    const subcommand = required(positional, "settings subcommand (get, set, apply, or reset)");
    if (subcommand === "get") {
      await ensureDaemon();
      const settings = await daemonRequest<Record<string, unknown>>("settings_get");
      if (json) process.stdout.write(`${JSON.stringify(settings, null, 2)}\n`);
      else printSettingsHuman(settings);
      return;
    }
    if (subcommand === "set") {
      const dottedPath = required(rest[0], "dotted settings path");
      const rawValue = required(rest[1], "scalar value");
      const patch = parseDottedPath(dottedPath, rawValue);
      await ensureDaemon();
      const settings = await daemonRequest<Record<string, unknown>>("settings_update", { patch });
      if (json) process.stdout.write(`${JSON.stringify(settings, null, 2)}\n`);
      else printSettingsHuman(settings);
      return;
    }
    if (subcommand === "apply") {
      const filePath = path.resolve(required(rest[0], "settings file"));
      await ensureDaemon();
      const settings = await daemonRequest<Record<string, unknown>>("settings_apply_file", { file: filePath });
      if (json) process.stdout.write(`${JSON.stringify(settings, null, 2)}\n`);
      else printSettingsHuman(settings);
      return;
    }
    if (subcommand === "reset") {
      await ensureDaemon();
      const settings = await daemonRequest<Record<string, unknown>>("settings_reset");
      if (json) process.stdout.write(`${JSON.stringify(settings, null, 2)}\n`);
      else printSettingsHuman(settings);
      return;
    }
    throw new Error(`Unknown settings subcommand: ${subcommand}. Use: get, set, apply, or reset.`);
  }

  if (command === "main-direct") {
    const subcommand = required(positional, "main-direct subcommand (start, complete, status, list, aggregate, recent)");
    if (subcommand === "start") {
      const taskClass = required(option(rest, "--task-class"), "--task-class");
      const taskFamily = option(rest, "--family");
      const reason = required(option(rest, "--reason"), "--reason");
      const note = required(option(rest, "--note"), "--note");
      const profileIdsRaw = option(rest, "--profiles") ?? "[]";
      if (!rest.includes("--confirm")) {
        throw new Error("main-direct start requires explicit --confirm");
      }
      let profileIds: string[];
      try {
        const parsed = JSON.parse(profileIdsRaw);
        if (!Array.isArray(parsed)) throw new Error("--profiles must be a JSON array");
        profileIds = parsed;
      } catch (e) {
        throw new Error(`Invalid --profiles JSON: ${e instanceof Error ? e.message : String(e)}`);
      }
      await ensureDaemon();
      const result = await daemonRequest<Record<string, unknown>>("main_direct_start", {
        taskClass, ...(taskFamily === undefined ? {} : { taskFamily }),
        reason, note, consideredWorkerProfileIds: profileIds, confirm: true,
      });
      process.stdout.write(json
        ? `${JSON.stringify(result, null, 2)}\n`
        : humanMainDirectDecisionLines(result));
      return;
    }
    if (subcommand === "complete") {
      const id = required(option(rest, "--id"), "--id");
      const outcome = required(option(rest, "--outcome"), "--outcome");
      const verification = option(rest, "--verification");
      const note = required(option(rest, "--note"), "--note");
      if (!rest.includes("--confirm")) {
        throw new Error("main-direct complete requires explicit --confirm");
      }
      await ensureDaemon();
      const result = await daemonRequest<Record<string, unknown>>("main_direct_complete", {
        id, outcome, ...(verification === undefined ? {} : { verification }), note, confirm: true,
      });
      process.stdout.write(json
        ? `${JSON.stringify(result, null, 2)}\n`
        : humanMainDirectDecisionLines(result));
      return;
    }
    if (subcommand === "status") {
      const id = required(rest[0], "id for main-direct status");
      const result = await daemonObserverRequest<Record<string, unknown>>("main_direct_status", { id });
      process.stdout.write(json
        ? `${JSON.stringify(result, null, 2)}\n`
        : humanMainDirectDecisionLines(result));
      return;
    }
    if (subcommand === "list") {
      const result = await daemonObserverRequest<readonly Record<string, unknown>[]>("main_direct_list");
      process.stdout.write(json
        ? `${JSON.stringify(result, null, 2)}\n`
        : humanMainDirectDecisionListLines(result as Record<string, unknown>[]));
      return;
    }
    if (subcommand === "aggregate") {
      const result = await daemonObserverRequest<Record<string, unknown>>("main_direct_aggregate");
      process.stdout.write(json
        ? `${JSON.stringify(result, null, 2)}\n`
        : humanMainDirectAggregateLines(result));
      return;
    }
    if (subcommand === "recent") {
      const limitRaw = option(rest, "--limit");
      const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;
      const result = await daemonObserverRequest<readonly Record<string, unknown>[]>(
        "main_direct_recent", ...(limit !== undefined ? [{ limit }] : []),
      );
      process.stdout.write(json
        ? `${JSON.stringify(result, null, 2)}\n`
        : humanMainDirectDecisionListLines(result as Record<string, unknown>[]));
      return;
    }
    throw new Error("Unknown main-direct subcommand. Use: start, complete, status, list, aggregate, or recent.");
  }

  if (command === "upgrade") {
    const subcommand = required(positional, "upgrade subcommand (status)");
    if (subcommand === "status") {
      const requiredCount = parseRequiredStreakCountFromString(option(rest, "--required"));
      // Observation only: never ensureDaemon / start Integration / mutate state.
      const evidence = await daemonObserverRequest<SelfUpgradeEvidenceProjection>(
        "self_upgrade_evidence",
        { required: requiredCount },
      );
      process.stdout.write(
        json
          ? `${JSON.stringify(evidence, null, 2)}\n`
          : humanSelfUpgradeEvidenceLines(evidence),
      );
      return;
    }
    throw new Error(`Unknown upgrade subcommand: ${subcommand}. Use: status.`);
  }

  if (command === "integration") {
    const subcommand = required(positional, "integration subcommand (preflight, apply, status, wait, or history)");
    if (subcommand === "preflight") {
      const taskId = required(rest[0], "task id");
      const { output } = await withCliExchangeReceipt({
        operation: "forklight_integration_preflight",
        home: forklightHome(),
        args: { taskId, json },
        taskId,
        invoke: async () => {
          await ensureDaemon();
          return daemonRequest<Record<string, unknown>>("integration_preflight", { taskId });
        },
        renderOutput: (receipt) => json
          ? `${JSON.stringify(receipt, null, 2)}\n`
          : humanIntegrationPreflightLines(receipt),
      });
      process.stdout.write(output);
      return;
    }
    if (subcommand === "apply") {
      const taskId = required(rest[0], "task id");
      // --confirm and --receipt are validated INSIDE the receipt wrapper
      // so that attributable failures (Task id is already known) are
      // captured before any daemon mutation.  Missing task id would be
      // unattributable and is therefore still validated outside.
      const { output } = await withCliExchangeReceipt({
        operation: "forklight_integration_apply",
        home: forklightHome(),
        args: { taskId, receiptId: option(rest, "--receipt"), confirm: rest.includes("--confirm"), json },
        taskId,
        invoke: async () => {
          const receiptId = required(option(rest, "--receipt"), "receipt id (--receipt)");
          if (!rest.includes("--confirm")) throw new Error("Apply requires explicit --confirm\n\n" + usage());
          await ensureDaemon();
          return daemonRequest<Record<string, unknown>>("integration_apply", {
            taskId, receiptId, confirm: true,
          });
        },
        renderOutput: (result) => json
          ? `${JSON.stringify(result, null, 2)}\n`
          : humanIntegrationApplyLines(result),
      });
      process.stdout.write(output);
      return;
    }
    if (subcommand === "history") {
      const taskId = required(rest[0], "task id");
      const { output } = await withCliExchangeReceipt({
        operation: "forklight_integration_history",
        home: forklightHome(),
        args: { taskId, json },
        taskId,
        invoke: async () => {
          // Observation only: never ensureDaemon / start a replacement.
          return daemonObserverRequest<{ receipts: unknown[]; results: unknown[] }>(
            "integration_history", { taskId });
        },
        renderOutput: (history) => json
          ? `${JSON.stringify(history, null, 2)}\n`
          : humanIntegrationHistoryLines(history),
      });
      process.stdout.write(output);
      return;
    }
    if (subcommand === "status" || subcommand === "wait") {
      const operationId = required(rest[0], "operation id");
      let taskId: string | undefined;
      const timeoutRaw = option(rest, "--timeout-ms");
      const timeoutMs = subcommand === "wait"
        ? Number(required(timeoutRaw, "timeout (--timeout-ms)"))
        : undefined;
      if (
        timeoutMs !== undefined
        && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 3_600_000)
      ) {
        throw new Error("Integration wait timeout must be an integer from 1 to 3600000");
      }
      const deepAudit = rest.includes("--deep-audit");
      const operation = subcommand === "wait"
        ? "forklight_integration_wait" as const
        : "forklight_integration_status" as const;
      const method = subcommand === "wait"
        ? "integration_wait" as const
        : "integration_status" as const;
      const { output } = await withCliExchangeReceipt({
        operation,
        home: forklightHome(),
        args: { operationId, ...(timeoutMs === undefined ? {} : { timeoutMs }), json, deepAudit },
        taskId: () => taskId,
        invoke: async () => {
          // Observation only: never ensureDaemon / start a replacement during handoff.
          const view = await daemonObserverRequest<IntegrationOperationView>(
            method,
            { operationId, ...(timeoutMs === undefined ? {} : { timeoutMs }) },
          );
          if (typeof view.taskId === "string") taskId = view.taskId;
          return view;
        },
        renderOutput: (view) => {
          if (deepAudit) {
            return json
              ? `${JSON.stringify(view, null, 2)}\n`
              : humanIntegrationOperationLines(view);
          }
          const compact = buildCompactIntegrationOperationView(view);
          return json
            ? `${JSON.stringify(compact, null, 2)}\n`
            : humanIntegrationOperationLines(compact);
        },
      });
      process.stdout.write(output);
      return;
    }
    throw new Error(`Unknown integration subcommand: ${subcommand}. Use: preflight, apply, status, wait, or history.`);
  }

  if (command === "compete") {
    await ensureDaemon();
    const taskFile = path.resolve(required(positional, "task file"));
    const raw = required(option(rest, "--candidates"), "--candidates JSON array");
    let candidates: unknown[];
    try { candidates = JSON.parse(raw) as unknown[]; if (!Array.isArray(candidates)) throw new Error("not an array"); }
    catch (e) { throw new Error(`Invalid --candidates JSON: ${e instanceof Error ? e.message : String(e)}`); }
    const reasonNote = option(rest, "--reason");
    const params: Record<string, unknown> = { taskFile, candidates };
    if (reasonNote !== undefined) {
      const note = reasonNote.trim();
      if (note.length === 0 || note.length > 1000) {
        throw new Error("--reason must be 1-1000 characters");
      }
      // Explicit CLI compete with a reason is a user-requested Competition.
      params.reason = { intent: "required", triggers: ["user-requested"], note };
    }
    const competition = await daemonRequest<Record<string, unknown>>("competition_submit_file", params);
    if (json) process.stdout.write(`${JSON.stringify(competition, null, 2)}\n`);
    else {
      const r = competition as Record<string, unknown>;
      process.stdout.write(`competitionId: ${r.id}\nname: ${r.name}\nstatus: ${r.status}\ncandidates: ${candidates.length}\n`);
      if (r.legacy === true) process.stdout.write("reason: unavailable (legacy explicit submission)\n");
      else if (r.reason) process.stdout.write(`reason: ${(r.reason as Record<string, unknown>).note}\n`);
    }
    return;
  }

  function printScoredCandidates(candidates: Array<Record<string, unknown>>): void {
    for (const score of candidates) {
      const prefix = score.eligible ? "✓" : "✗";
      process.stdout.write(`${prefix} ${score.candidateId} (${score.providerName}/${score.modelName}) score=${score.totalScore}`);
      if (!score.eligible) process.stdout.write(` disqualified: ${score.disqualificationReason}`);
      process.stdout.write("\n");
      for (const f of score.factors as Array<Record<string, unknown>>) {
        const w = Number(f.weight), sc = Number(f.weightedScore);
        process.stdout.write(`    ${f.factor}: ${sc.toFixed(3)} [w=${w}${w === 0 ? " zero" : ""}] — ${String(f.evidence).slice(0, 120)}\n`);
      }
    }
  }

  if (command === "competition") {
    const subcommand = required(positional, "competition subcommand (status, list, or compare)");
    await ensureDaemon();
    if (subcommand === "status") {
      const result = await daemonRequest<Record<string, unknown>>("competition_status", { competitionId: required(rest[0], "competition id") });
      if (json) { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); return; }
      const r = result, comp = r.competition as Record<string, unknown>, progress = r.progress as Record<string, number>;
      process.stdout.write(`id: ${comp.id}\nname: ${comp.name}\nstatus: ${comp.status}\nprogress: ${progress.terminal}/${progress.total} terminal\n`);
      if (comp.legacy === true) {
        process.stdout.write("reason: unavailable (legacy competition predates reasoned admission)\n");
      } else if (comp.reason) {
        const rn = comp.reason as Record<string, unknown>;
        process.stdout.write(`reason: ${rn.note} (intent=${rn.intent})\n`);
      }
      for (const c of r.candidates as Array<Record<string, unknown>>) {
        process.stdout.write(`  ${c.candidateId}: ${(() => { const id = (c as Record<string, unknown>).identity as Record<string, unknown> | undefined; return id === undefined ? "identity unavailable (legacy)" : `${String(id.provider)}/${String(id.model)} (${String(id.runtime)}/${String(id.effort)})`; })()} [${c.taskStatus}]${c.error ? ` — ${c.error}` : ""}\n`);
      }
      const mc = r.machineComparison as Record<string, unknown> | undefined;
      if (mc) {
        if (mc.state === "no-deliverable") {
          process.stdout.write("machine comparison: no deliverable candidate; no winner was selected\n");
        } else if (mc.state === "waiting") {
          process.stdout.write("machine comparison: candidates are still running or comparison is not ready\n");
        } else if (mc.waitingForMain === true) {
          process.stdout.write("machine comparison: waiting for Main judgment (not a final choice)\n");
        } else if (mc.recommendation) {
          const rec = mc.recommendation as Record<string, unknown>;
          process.stdout.write(`machine comparison: ${rec.candidateId} (confidence ${rec.confidence}) - not a final choice until Main accepts\n`);
        }
      }
      const md = r.mainDecision as Record<string, unknown> | undefined;
      if (md) {
        process.stdout.write(`Main decision: ${md.decision} on candidate ${md.candidateId} - ${md.reason}${r.mainDecisionCurrent === true ? "" : " (historical; a newer Candidate Revision needs review)"}\n`);
      }
      if (r.finalChoice) {
        const fc = r.finalChoice as Record<string, unknown>;
        process.stdout.write(`final choice: candidate ${fc.candidateId} (revision ${fc.candidateRevisionId ?? "-"}); Integration still requires explicit confirmation\n`);
      }
      const handoffs = r.handoffs as Array<Record<string, unknown>> | undefined;
      if (handoffs && handoffs.length > 0) {
        process.stdout.write("handoffs:\n");
        for (const entry of handoffs) {
          process.stdout.write(
            `  ${String(entry.sourceCandidateId)} → ${String(entry.destinationWorkerProfileId)} `
            + `status=${String(entry.status)} successor=${String(entry.successorTaskId)} `
            + `paths=${String(entry.reusablePathCount)} gaps=${String(entry.remainingGapCount)} `
            + `next=${String(entry.nextAction)}\n`,
          );
        }
      }
      const rp = r.retainedPartial as Array<Record<string, unknown>> | undefined;
      if (rp && rp.length > 0) {
        process.stdout.write("retained partial evidence:\n");
        for (const entry of rp) {
          process.stdout.write(`  candidate ${entry.candidateId}: ${(entry.reusablePaths as string[]).length} reusable path(s), ${(entry.remainingGaps as unknown[]).length} gap(s) retained for M2\n`);
        }
      }
      if (r.evaluation) { process.stdout.write("evaluation:\n"); printScoredCandidates((r.evaluation as Record<string, unknown>).candidates as Array<Record<string, unknown>>); const rec = (r.evaluation as Record<string, unknown>).recommendation as Record<string, unknown> | undefined; if (rec) process.stdout.write(`recommendation: ${rec.candidateId} (confidence ${rec.confidence}) — ${rec.reasoning}\n`); }
      process.stdout.write(`next: ${String(r.nextAction ?? "main-review")}\n`);
      return;
    }
    if (subcommand === "list") {
      const list = await daemonRequest<Array<Record<string, unknown>>>("competition_list", {});
      if (json) process.stdout.write(`${JSON.stringify(list, null, 2)}\n`);
      else if (list.length === 0) process.stdout.write("No competitions.\n");
      else for (const item of list) { const pr = item.progress as Record<string, number>; process.stdout.write(`${item.id} ${item.status} ${item.name} (${pr.terminal}/${pr.total} terminal)\n`); }
      return;
    }
    if (subcommand === "compare") {
      const competitionId = required(rest[0], "competition id");
      const wr = option(rest, "--weights");
      let override: Record<string, unknown> | undefined;
      if (wr !== undefined) { try { override = JSON.parse(wr) as Record<string, unknown>; } catch { throw new Error("--weights must be a valid JSON object"); } }
      const result = await daemonRequest<Record<string, unknown>>("competition_compare", { competitionId, ...(override === undefined ? {} : { rankingWeights: override }) });
      if (json) { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); return; }
      const evaluation = result.evaluation as Record<string, unknown>;
      const policy = evaluation.policy as Record<string, unknown>;
      const weights = policy.weights as Record<string, number>;
      process.stdout.write("policy weights:\n");
      for (const [factor, weight] of Object.entries(weights)) process.stdout.write(`  ${factor}: ${weight}${weight === 0 ? " (zero — evidence visible but not ranked)" : ""}\n`);
      printScoredCandidates(evaluation.candidates as Array<Record<string, unknown>>);
      const rec = evaluation.recommendation as Record<string, unknown> | undefined;
      if (rec) process.stdout.write(`recommendation: ${rec.candidateId} (confidence ${rec.confidence})\n  ${rec.reasoning}\n`);
      return;
    }
    if (subcommand === "main-decision") {
      const competitionId = required(rest[0], "competition id");
      const candidateId = required(rest[1], "candidate id");
      const decision = required(rest[2], "decision (accept, revise, or reject)");
      if (decision !== "accept" && decision !== "revise" && decision !== "reject") {
        throw new Error("decision must be accept, revise, or reject");
      }
      const reason = required(option(rest, "--reason"), "--reason text");
      const reasonText = reason.trim();
      if (reasonText.length === 0 || reasonText.length > 1000) {
        throw new Error("--reason must be 1-1000 characters");
      }
      if (option(rest, "--confirm") === undefined) {
        throw new Error("main-decision requires --confirm to authorize the decision");
      }
      const result = await daemonRequest<Record<string, unknown>>("competition_main_decision", {
        competitionId, candidateId, decision, reason: reasonText, confirm: true,
      });
      if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else {
        process.stdout.write(`Competition Main decision: ${result.decision} on candidate ${result.candidateId}\n`);
        if (decision === "accept") {
          process.stdout.write(`final choice: revision ${result.candidateRevisionId ?? "-"}; Integration still requires explicit confirmation\n`);
        } else if (decision === "revise") {
          process.stdout.write("No automatic retry; authorize at most one same-Candidate correction through the existing correction authority.\n");
        } else {
          process.stdout.write("No retry is authorized.\n");
        }
      }
      return;
    }
    if (subcommand === "retain-partial") {
      const competitionId = required(rest[0], "competition id");
      const candidateId = required(rest[1], "candidate id");
      const reusableRaw = required(option(rest, "--reusable"), "--reusable JSON array of paths");
      const gapsRaw = required(option(rest, "--gaps"), "--gaps JSON array of {description, acceptanceExpectation}");
      let reusablePaths: unknown;
      let remainingGaps: unknown;
      try { reusablePaths = JSON.parse(reusableRaw); } catch (e) { throw new Error(`Invalid --reusable JSON: ${e instanceof Error ? e.message : String(e)}`); }
      try { remainingGaps = JSON.parse(gapsRaw); } catch (e) { throw new Error(`Invalid --gaps JSON: ${e instanceof Error ? e.message : String(e)}`); }
      if (option(rest, "--confirm") === undefined) {
        throw new Error("retain-partial requires --confirm to authorize retention");
      }
      const result = await daemonRequest<Record<string, unknown>>("competition_retained_partial", {
        competitionId, candidateId, reusablePaths, remainingGaps, confirm: true,
      });
      if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else {
        process.stdout.write(`Retained ${(result.reusablePaths as string[]).length} reusable path(s) and ${(result.remainingGaps as unknown[]).length} gap(s) from candidate ${result.candidateId} for M2 handoff.\n`);
        process.stdout.write("No Worker retry or successor started.\n");
      }
      return;
    }
    if (subcommand === "handoff") {
      const competitionId = required(rest[0], "competition id");
      const candidateId = required(rest[1], "candidate id");
      const candidateRevisionId = required(option(rest, "--revision"), "--revision candidateRevisionId");
      const destinationWorkerProfileId = required(
        option(rest, "--to-profile"),
        "--to-profile destination Worker Profile id",
      );
      const reason = required(option(rest, "--reason"), "--reason text");
      const reasonText = reason.trim();
      if (reasonText.length === 0 || reasonText.length > 1000) {
        throw new Error("--reason must be 1-1000 characters");
      }
      if (option(rest, "--confirm") === undefined) {
        throw new Error("handoff requires --confirm to authorize the cross-Worker successor");
      }
      const result = await daemonRequest<Record<string, unknown>>("competition_handoff", {
        competitionId,
        candidateId,
        candidateRevisionId,
        destinationWorkerProfileId,
        reason: reasonText,
        confirm: true,
      });
      if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else {
        process.stdout.write(
          `Handoff ${String(result.status)}: retained ${String(result.reusablePathCount)} path(s) and ${String(result.remainingGapCount)} gap(s)\n`,
        );
        process.stdout.write(
          `source candidate ${String(result.sourceCandidateId)} → destination ${String(result.destinationWorkerProfileId)}\n`,
        );
        process.stdout.write(
          `successor Task ${String(result.successorTaskId)} (not a retry); digest ${String(result.sourceDigestPrefix)}\n`,
        );
        if (result.failureCode !== undefined) {
          process.stdout.write(`failure: ${String(result.failureCode)}\n`);
        }
        process.stdout.write(`next: ${String(result.nextAction)}\n`);
        process.stdout.write(
          "Source Task and Candidate evidence are unchanged. Fresh Main Review is required before Integration.\n",
        );
      }
      return;
    }
    throw new Error(`Unknown competition subcommand: ${subcommand}. Use: status, list, compare, main-decision, retain-partial, or handoff.`);
  }

  if (command === "console" || command === "setup") {
    throw new Error(
      `The standalone ${command} UI was removed. Use: forklight hub\n\n${usage()}`,
    );
  }

  if (command === "providers") {
    const subcommand = required(positional, "providers subcommand (status or probe)");
    await ensureDaemon();
    if (subcommand === "status") {
      const providerName = rest.length > 0 && !rest[0]!.startsWith("-") ? rest[0] : undefined;
      const result = await daemonRequest<Record<string, unknown>>("provider_status", {
        ...(providerName === undefined ? {} : { provider: providerName }),
      });
      if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else printProviderStatus(result);
      return;
    }
    if (subcommand === "probe") {
      const providerName = rest.length > 0 && !rest[0]!.startsWith("-") ? rest[0] : undefined;
      if (!json) {
        process.stdout.write(
          `Running explicit provider probe${providerName ? ` for ${providerName}` : " for all providers"}…\n`,
        );
      }
      const result = await daemonRequest<Record<string, unknown>>("provider_probe", {
        ...(providerName === undefined ? {} : { provider: providerName }),
      });
      if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else printProviderProbe(result);
      if (providerProbeBatchFailed(result)) process.exitCode = 1;
      return;
    }
    throw new Error(`Unknown providers subcommand: ${subcommand}. Use: status or probe.`);
  }

  function humanRemediationVerifyLines(result: Record<string, unknown>): string {
    const lines: string[] = [];
    const check = result.check as Record<string, unknown> | undefined;
    if (check !== undefined) {
      lines.push(`checkId: ${check.id}`);
      lines.push(`status: ${check.status}`);
    }
    lines.push(`taskStatus: ${result.taskStatus}`);
    const disp = result.disposition as Record<string, unknown> | undefined;
    if (disp !== undefined) {
      lines.push(`disposition: ${disp.status}`);
      if (typeof disp.acceptanceBasis === "string") {
        lines.push(`acceptanceBasis: ${disp.acceptanceBasis}`);
      }
      if (typeof disp.amendedCommandCount === "number") {
        lines.push(`amendedCommandCount: ${disp.amendedCommandCount}`);
      }
      if (typeof disp.reasonCode === "string") {
        lines.push(`reasonCode: ${disp.reasonCode}`);
      }
    }
    if (typeof check?.commandCount === "number") {
      lines.push(`commandsPassed: ${check.passedCommandCount}/${check.commandCount}`);
    }
    return `${lines.join("\n")}\n`;
  }

  function humanCandidateReverifyLines(result: Record<string, unknown>): string {
    const lines: string[] = [];
    lines.push(`status: ${result.status}`);
    lines.push(`taskId: ${result.taskId}`);
    lines.push(`taskStatus: ${result.taskStatus}`);
    lines.push(`attemptId: ${result.attemptId}`);
    lines.push(`attemptStatus: ${result.attemptStatus}`);
    lines.push(`verificationEventSequence: ${result.verificationEventSequence}`);
    const allowance = result.allowance as Record<string, unknown> | undefined;
    if (allowance !== undefined) {
      lines.push(
        `allowance: ${allowance.remaining} of ${allowance.max} left (consumed ${allowance.consumed}, source ${allowance.source})`,
      );
    }
    const cost = result.costFacts as Record<string, unknown> | undefined;
    if (cost !== undefined) {
      lines.push(`workerInvoked: ${cost.workerInvoked}`);
      lines.push(`incrementalWorkerTokens: ${cost.incrementalWorkerTokens}`);
      lines.push(`incrementalModelRuntimeCostUsd: ${cost.incrementalModelRuntimeCostUsd}`);
      lines.push(`commandsPassed: ${cost.passedCommandCount}/${cost.commandCount}`);
      lines.push(`commandDurationMs: ${cost.commandDurationMs}`);
      lines.push(`wallDurationMs: ${cost.wallDurationMs}`);
    }
    lines.push(`requiresFreshMainAccept: ${result.requiresFreshMainAccept}`);
    return `${lines.join("\n")}\n`;
  }

  if (command === "remediate") {
    const subcommand = required(positional, "remediate subcommand (verify)");
    if (subcommand !== "verify") {
      throw new Error(`Unknown remediate subcommand: ${subcommand}. Use: verify.`);
    }
    const taskId = required(rest[0], "task id");
    const reason = required(option(rest, "--reason"), "remediation reason");
    if (!rest.includes("--confirm")) {
      throw new Error("remediate verify requires explicit --confirm\n\n" + usage());
    }
    const amendmentPath = option(rest, "--amendment");
    let amendment: import("./core/types.js").RemediationAcceptanceAmendment | undefined;
    if (amendmentPath !== undefined) {
      let raw: string;
      try {
        raw = await readFile(amendmentPath, "utf8");
      } catch {
        throw new Error("remediate verify could not read --amendment file");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error("remediate verify --amendment must be valid JSON");
      }
      // Shared structured parser: fixed privacy-safe errors, 4000-char bound,
      // trimmed non-empty commands; never echoes field names or command text.
      amendment = parseRemediationAmendmentInput(parsed);
      if (amendment === undefined) {
        throw new Error("remediate verify --amendment must be a JSON object");
      }
    }
    // Exchange receipts carry only lengths/counts — never command text or file path.
    const { output } = await withCliExchangeReceipt({
      operation: "forklight_remediation_verify",
      home: forklightHome(),
      args: {
        taskId,
        reasonLength: reason.length,
        confirm: true,
        json,
        ...(amendment === undefined
          ? {}
          : {
              amendmentReplacementCount: amendment.replacements.length,
              amendmentReasonCode: amendment.reasonCode,
              amendmentVerificationEventSequence: amendment.verificationEventSequence,
            }),
      },
      taskId,
      invoke: async () => {
        await ensureDaemon();
        return daemonRequest<Record<string, unknown>>("remediation_verify", {
          taskId,
          reason,
          confirm: true,
          ...(amendment === undefined ? {} : { amendment }),
        });
      },
      renderOutput: (result) => json
        ? `${JSON.stringify(result, null, 2)}\n`
        : humanRemediationVerifyLines(result),
    });
    process.stdout.write(output);
    return;
  }

  if (command === "reverify") {
    const taskId = required(positional, "task id");
    const reason = required(option(rest, "--reason"), "reverification reason");
    if (!rest.includes("--confirm")) {
      throw new Error("reverify requires explicit --confirm\n\n" + usage());
    }
    const { output } = await withCliExchangeReceipt({
      operation: "forklight_candidate_reverify",
      home: forklightHome(),
      args: { taskId, reasonLength: reason.length, confirm: true, json },
      taskId,
      invoke: async () => {
        await ensureDaemon();
        return daemonRequest<Record<string, unknown>>("candidate_reverify", {
          taskId,
          reason,
          confirm: true,
        });
      },
      renderOutput: (result) => json
        ? `${JSON.stringify(result, null, 2)}\n`
        : humanCandidateReverifyLines(result),
    });
    process.stdout.write(output);
    return;
  }

  if (command === "adapt") {
    const ADAPTATION_REASONS = new Set([
      "duration-budget", "size-policy", "attempt-budget", "completion-policy",
      "concurrency-cap", "no-progress-timeout", "other-flexible-policy",
    ]);
    const subcommand = required(positional, "adapt subcommand (preview or apply)");
    const taskId = required(rest[0], "task id");
    const rawPatch = required(option(rest, "--patch"), "JSON policy patch (--patch)");
    let patch: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawPatch);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("shape");
      }
      patch = parsed as Record<string, unknown>;
    } catch {
      throw new Error("adapt --patch must be a valid JSON object");
    }
    const reason = required(option(rest, "--reason"), "adaptation reason category (--reason)");
    if (!ADAPTATION_REASONS.has(reason)) {
      throw new Error(
        `adapt --reason must be a bounded category: ${[...ADAPTATION_REASONS].join(", ")}`,
      );
    }

    if (subcommand === "preview") {
      const { output } = await withCliExchangeReceipt({
        operation: "forklight_adaptation_preview",
        home: forklightHome(),
        args: { taskId, reason, json },
        taskId,
        invoke: async () => {
          await ensureDaemon();
          return daemonRequest<Record<string, unknown>>("adaptation_preview", {
            taskId, patch, reason,
          });
        },
        renderOutput: (preview) => json
          ? `${JSON.stringify(preview, null, 2)}\n`
          : humanAdaptationPreviewLines(preview),
      });
      process.stdout.write(output);
      return;
    }

    if (subcommand === "apply") {
      if (!rest.includes("--confirm")) {
        throw new Error("adapt apply requires explicit --confirm\n\n" + usage());
      }
      const { output } = await withCliExchangeReceipt({
        operation: "forklight_adaptation_apply",
        home: forklightHome(),
        args: { taskId, reason, confirm: true, json },
        taskId,
        invoke: async () => {
          await ensureDaemon();
          return daemonRequest<Record<string, unknown>>("adaptation_apply", {
            taskId, patch, reason, confirm: true,
          });
        },
        renderOutput: (result) => json
          ? `${JSON.stringify(result, null, 2)}\n`
          : humanAdaptationApplyLines(result),
      });
      process.stdout.write(output);
      return;
    }

    throw new Error(
      `Unknown adapt subcommand: ${subcommand}. Use: preview or apply.`,
    );
  }

  if (command === "doctor") {
    const inspector = createSystemInspector();
    const store = new StateStore(forklightHome());
    const keychain = createKeychainStore();
    try {
      const settings = new SettingsService(store);
      const service = new SetupService(settings, keychain, inspector);
      const prerequisites = service.inspectPrerequisites();
      const localProviderOptions = service.describeProviders();
      const effective = settings.get();
      const localReadiness = providerReadiness(effective.providerDefaults);
      const localProviders: LocalProviderFact[] = localProviderOptions.map((provider) => ({
        name: provider.name,
        label: provider.label,
        configured: localReadiness.providers[provider.name].ready,
        ready: localReadiness.providers[provider.name].ready,
        authMode: localReadiness.providers[provider.name].authMode,
        defaultModel: provider.defaultModel,
      }));

      let daemonEvidence: DaemonHealthEvidence | undefined;
      try {
        const response = await daemonExchange("health");
        daemonEvidence = {
          ok: response.ok,
          serverIdentity: response.serverIdentity,
          result: response.result,
        };
      } catch {
        // Doctor is read-only and never starts a missing Daemon.
      }

      const result = resolveDoctorResult({
        prerequisites,
        clientBuildIdentity: currentBuildIdentity(),
        ...(daemonEvidence === undefined ? {} : { daemonEvidence }),
        localProviders,
        effectiveDefaultProvider: effective.execution.defaultProvider,
      });
      if (json) {
        process.stdout.write(renderDoctorJson(result));
      } else {
        process.stdout.write(renderDoctorHuman(result));
      }
    } finally {
      store.close();
    }
    return;
  }

  if (command === "hub" && positional === "status") {
    const statusJson = rest.includes("--json");
    for (const flag of rest) {
      if (flag !== "--json") {
        throw new Error(`Unknown hub status flag: ${flag}\n\n${usage()}`);
      }
    }
    const home = forklightHome();
    const status = await inspectHubStatus(home, {
      runIdentity: currentBuildIdentity(),
      probeTimeoutMs: 1_000,
    });
    if (statusJson) {
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    } else {
      process.stdout.write(humanHubStatusLines(status));
    }
    return;
  }

  if (command === "hub") {
    const hubOptions = [positional, ...rest].filter(
      (value): value is string => value !== undefined,
    );
    const noOpen = hubOptions.includes("--no-open");
    const portFlag = option(hubOptions, "--port");
    const port = portFlag !== undefined ? parseInt(portFlag, 10) : 0;
    if (portFlag !== undefined && (!Number.isFinite(port) || port < 0 || port > 65535)) {
      throw new Error("--port must be a valid port number (0-65535)");
    }

    const home = forklightHome();
    const runIdentity = currentBuildIdentity();
    let discovery: HubDiscovery;

    // --- Explicit confirmed restart (hub restart --confirm [--detach]) ---
    if (positional === "restart") {
      const detach = hubOptions.includes("--detach");
      const restartJson = hubOptions.includes("--json");
      const restartConfirm = hubOptions.includes("--confirm");

      // Validate restart flags before any lifecycle mutation.
      const restartFlagValues = new Set([
        "restart",
        "--confirm",
        "--detach",
        "--no-open",
        "--json",
        "--port",
        "--startup-timeout-ms",
      ]);
      for (let index = 0; index < hubOptions.length; index += 1) {
        const flag = hubOptions[index]!;
        if (flag === "--port" || flag === "--startup-timeout-ms") {
          const value = hubOptions[index + 1];
          if (value === undefined || value.startsWith("-")) {
            throw new Error(`${flag} requires a value\n\n${usage()}`);
          }
          index += 1;
          continue;
        }
        if (!restartFlagValues.has(flag)) {
          throw new Error(`Unknown hub restart flag: ${flag}\n\n${usage()}`);
        }
      }

      if (!restartConfirm) {
        throw new Error(
          "Hub restart requires explicit --confirm. A normal `forklight hub` diagnoses a stale owner; "
          + "restart replaces it after proving the exact identity.\n\n" + usage(),
        );
      }

      if (restartJson && !detach) {
        throw new Error(
          "hub restart --json requires --detach so the command can return a finite result.\n\n"
          + usage(),
        );
      }
      if (hubOptions.includes("--startup-timeout-ms") && !detach) {
        throw new Error(
          "hub restart --startup-timeout-ms requires --detach.\n\n" + usage(),
        );
      }

      // --- Detached path: replace if needed, launch one child, wait, return ---
      if (detach) {
        const startupTimeoutMs = parseOptionalHubStartupTimeoutMs(hubOptions);
        const explicitPort = portFlag !== undefined ? port : undefined;
        const result = await restartHubDetached(home, {
          runIdentity,
          ...(explicitPort !== undefined ? { port: explicitPort } : {}),
          ...(startupTimeoutMs === undefined ? {} : { startupTimeoutMs }),
        });

        let browserOpened = false;
        if (
          result.ok
          && !noOpen
          && process.platform === "darwin"
          && result.pid !== undefined
          && result.port !== undefined
        ) {
          const openUrl = resolveHubOpenUrl(home, result.pid, result.port);
          if (openUrl !== undefined) {
            try {
              execFileSync("open", [openUrl], { stdio: "ignore" });
              browserOpened = true;
            } catch {
              browserOpened = false;
            }
          }
        }

        if (restartJson) {
          process.stdout.write(renderDetachedHubRestartJson(result, browserOpened));
        } else {
          process.stdout.write(humanDetachedHubRestartLines(result, browserOpened));
        }
        if (!result.ok) process.exitCode = 1;
        return;
      }

      // --- Foreground path (unchanged): replace then become the Hub owner ---
      discovery = await discoverOrClaimHub(home, { runIdentity });
      if (discovery.kind === "reuse") {
        process.stdout.write(
          "The active ForkLight Hub already runs this build. No replacement is needed.\n",
        );
        return;
      }
      if (discovery.kind === "stale-owner" || discovery.kind === "legacy-owner") {
        process.stdout.write(
          "Proving the diagnosed ForkLight Hub owner identity before restart…\n",
        );
        const replaceResult = await replaceHubOwner(
          home,
          discovery.replacement,
          { graceTimeoutMs: 7_000 },
        );
        if (!replaceResult.success) {
          process.stderr.write(
            `ForkLight Hub restart failed: ${replaceResult.reason}\n`,
          );
          process.exitCode = 1;
          return;
        }
        process.stdout.write(
          "Old Hub owner exited cleanly. Starting a replacement…\n",
        );
        discovery = await discoverOrClaimHub(home, { runIdentity });
      }
      // A clean home already returned a start claim; fall through without
      // inventing an old owner to restart.
    } else {
      discovery = await discoverOrClaimHub(home, { runIdentity });
    }

    // --- Version-aware reuse (matching build identity) ---
    if (discovery.kind === "reuse") {
      process.stdout.write(
        `ForkLight Hub is already active on http://127.0.0.1:${discovery.port}/\n`,
      );
      if (!noOpen && process.platform === "darwin") {
        try {
          execFileSync("open", [discovery.url], { stdio: "ignore" });
          process.stdout.write("Reopened the active Hub in browser.\n");
        } catch {
          process.stdout.write(`Open this URL: ${discovery.url}\n`);
        }
      } else {
        process.stdout.write(`Open this URL: ${discovery.url}\n`);
      }
      return;
    }

    // --- Stale build identity (different version) ---
    if (discovery.kind === "stale-owner") {
      process.stdout.write(
        `A ForkLight Hub is already active on http://127.0.0.1:${discovery.port}/\n`
        + "It runs a different built product than this CLI.\n"
        + "\n"
        + "To replace it with the current build, run:\n"
        + "  forklight hub restart --confirm\n"
        + "\n"
        + "Or stop the original Hub with Ctrl+C in its terminal and run this command again.\n",
      );
      return;
    }

    // --- Legacy descriptor (no build identity — version unknown) ---
    if (discovery.kind === "legacy-owner") {
      process.stdout.write(
        `A ForkLight Hub is already active on http://127.0.0.1:${discovery.port}/\n`
        + "Its version cannot be confirmed (the descriptor has no build identity).\n"
        + "\n"
        + "To replace it with the current build, run:\n"
        + "  forklight hub restart --confirm\n"
        + "\n"
        + "Or stop the original Hub with Ctrl+C in its terminal and run this command again.\n",
      );
      return;
    }

    // --- Start a new Hub ---
    const claim = discovery.claim;
    const builtIdentity = currentBuildIdentity();
    let store: StateStore | undefined;
    let server: HubServer | undefined;
    let requestStop: (() => void) | undefined;
    try {
      process.stdout.write("Starting ForkLight stack (daemon + hub)...\n");
      let daemonHealth: Record<string, unknown> | undefined;
      try {
        daemonHealth = await ensureDaemon() as Record<string, unknown>;
        process.stdout.write("  [backend] daemon: up\n");
      } catch (error) {
        process.stdout.write(
          `  [backend] daemon: failed - ${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.stdout.write(
          "  Hub UI will still start; operate views need a healthy daemon.\n",
        );
      }

      const inspector = createSystemInspector();
      store = new StateStore(home);
      const settings = new SettingsService(store);
      const keychain = createKeychainStore();
      const setup = new SetupService(settings, keychain, inspector);
      const staticRoot = findHubAssets();
      let packageRoot: string | undefined;
      try { packageRoot = findPackageRoot(); } catch { packageRoot = undefined; }

      server = new HubServer({
        settings,
        setup,
        keychain,
        staticRoot,
        account: () => inspector.account(),
        port,
        nonce: claim.nonce,
        ...(packageRoot === undefined ? {} : { packageRoot }),
        ...(packageRoot === undefined ? {} : { sampleRoot: path.join(home, "samples") }),
        ensureDaemon: async () => {
          const result = await ensureDaemon();
          return result as Record<string, unknown>;
        },
        probeDaemon: () => probeDaemon(),
        stopDaemon: () => stopDaemon(),
        restartDaemon: () => restartDaemon(),
        daemonRequest: <T = unknown>(method: DaemonMethod, params?: Record<string, unknown>) =>
          daemonRequest<T>(method, params ?? {}),
      });

      let startedPort: number;
      try {
        startedPort = await server.start();
      } catch (error) {
        throw new Error(
          `Hub server could not start: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const token = server.getToken();
      publishHubInstance(home, claim, startedPort, token, builtIdentity);
      const url = `http://127.0.0.1:${startedPort}/#${encodeURIComponent(token)}`;
      process.stdout.write(`  [frontend] hub UI: http://127.0.0.1:${startedPort}/\n`);
      if (daemonHealth?.ok === false) {
        process.stdout.write("  note: daemon health reported ok=false\n");
      }

      if (!noOpen && process.platform === "darwin") {
        try {
          execFileSync("open", [url], { stdio: "ignore" });
          process.stdout.write(`ForkLight Hub opened in browser. If it did not open, visit:\n${url}\n`);
        } catch {
          process.stdout.write(`Open this URL for ForkLight Hub:\n${url}\n`);
        }
      } else {
        process.stdout.write(`Open this URL for ForkLight Hub:\n${url}\n`);
      }
      process.stdout.write(
        "Stack stays running until you press Ctrl+C (stops Hub UI; daemon keeps running).\n",
      );

      requestStop = (): void => { void server?.stop(); };
      process.once("SIGINT", requestStop);
      process.once("SIGTERM", requestStop);
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (!server?.isRunning()) {
            clearInterval(check);
            resolve();
          }
        }, 250);
      });
    } finally {
      if (requestStop !== undefined) {
        process.removeListener("SIGINT", requestStop);
        process.removeListener("SIGTERM", requestStop);
      }
      await server?.stop();
      store?.close();
      releaseHubInstance(home, claim);
    }
    process.stdout.write("Hub server stopped.\n");
    return;
  }

  const store = new StateStore(forklightHome());
  try {
    if (command === "run") {
      const settings = new SettingsService(store).get();
      const policy = taskPolicyFromSettings(settings);
      const result = await runNewTask(
        store,
        required(positional, "task file"),
        printProgress,
        (task) => process.stdout.write(`taskId: ${task.id}\n`),
        policy,
      );
      printHumanStatus(result.task, store.listEvents(result.task.id));
      if (result.task.status !== "succeeded") process.exitCode = result.task.status === "interrupted" ? 130 : 1;
      return;
    }
    if (command === "resume") {
      const taskId = required(positional, "task id");
      const feedbackIndex = rest.indexOf("--feedback");
      const feedback = feedbackIndex === -1 ? undefined : required(rest[feedbackIndex + 1], "feedback text");
      const authorization = parseResumeAuthorization(rest);
      const resumeSettings = new SettingsService(store).get();
      // The daemon path writes "queued: <id>\n" and exits.  The local
      // fallback runs the worker and emits progress lines via
      // `printProgress`; those lines and the final human status block
      // are accumulated into the rendered-output closure so the receipt
      // measures the exact same bytes that will be written to stdout
      // (no duplicate output, exact exit code preserved).
      const progressLines: string[] = [];
      let renderedOutput = "";
      const { output } = await withCliExchangeReceipt({
        operation: "forklight_resume",
        home: forklightHome(),
        args: {
          taskId,
          ...(feedback === undefined ? {} : { feedback }),
          ...(authorization === undefined ? {} : {
            authorization: {
              additionalAttempts: 1,
              maxBudgetUsd: authorization.maxBudgetUsd,
              reasonLength: authorization.reason.trim().length,
              confirm: true,
            },
          }),
        },
        taskId,
        invoke: async () => {
          const exec = resumeSettings.execution;
          return routeMutation(
            () => ensureDaemon(),
            async () => {
              const task = await daemonRequest<TaskRecord>("resume", {
                taskId,
                ...(feedback === undefined ? {} : { feedback }),
                ...(authorization === undefined ? {} : { authorization }),
              });
              renderedOutput = `queued: ${task.id}\n`;
              return task;
            },
            async () => {
              let executionOptions: AttemptExecutionOptions | undefined;
              if (authorization !== undefined) {
                executionOptions = authorizeExtraAttempt(
                  store,
                  taskId,
                  authorization,
                  exec.maxAttempts,
                  exec.maximumBudgetUsd,
                  exec.maxExtraAttempts,
                );
              } else {
                executionOptions = resolvePendingGrantExecutionOptions(
                  store, taskId, exec.maxAttempts, exec.maxExtraAttempts,
                ) ?? undefined;
              }
              const result = await resumeTask(store, taskId, (event) => {
                const line = progressLine(event);
                if (line !== undefined) progressLines.push(line);
              }, feedback, exec, resumeSettings.providerDefaults, executionOptions);
              const statusBlock = humanStatusLines(
                result.task,
                undefined,
                failureCategoryForTask(result.task.status, store.listEvents(result.task.id)),
              );
              renderedOutput = `${progressLines.join("")}${statusBlock}`;
              if (result.task.status !== "succeeded") {
                process.exitCode = result.task.status === "interrupted" ? 130 : 1;
              }
              return result.task;
            },
          );
        },
        renderOutput: () => renderedOutput,
      });
      process.stdout.write(output);
      return;
    }
    if (command === "correct") {
      const taskId = required(positional, "task id");
      const feedbackIndex = rest.indexOf("--feedback");
      if (feedbackIndex === -1) {
        throw new Error("correct requires --feedback\n\n" + usage());
      }
      const feedback = required(rest[feedbackIndex + 1], "feedback text");
      const rawBudget = option(rest, "--max-budget-usd");
      const maxBudgetUsd = rawBudget === undefined
        ? null
        : rawBudget === "none" || rawBudget === "null"
          ? null
          : Number(rawBudget);
      if (
        maxBudgetUsd !== null
        && (!Number.isFinite(maxBudgetUsd) || maxBudgetUsd <= 0)
      ) {
        throw new Error("--max-budget-usd must be a positive number or none");
      }
      if (!rest.includes("--confirm")) {
        throw new Error("correct requires --confirm");
      }
      const candidateRevisionId = option(rest, "--candidate-revision");
      const rawReusablePaths = option(rest, "--reusable-paths");
      const rawRemainingGaps = option(rest, "--remaining-gaps");
      const structuredCount = [candidateRevisionId, rawReusablePaths, rawRemainingGaps]
        .filter((value) => value !== undefined).length;
      if (structuredCount !== 0 && structuredCount !== 3) {
        throw new Error(
          "--candidate-revision, --reusable-paths, and --remaining-gaps must be provided together",
        );
      }
      let reusablePaths: unknown;
      let remainingGaps: unknown;
      if (structuredCount === 3) {
        try {
          reusablePaths = JSON.parse(rawReusablePaths!);
          remainingGaps = JSON.parse(rawRemainingGaps!);
        } catch {
          throw new Error("--reusable-paths and --remaining-gaps must be valid JSON arrays");
        }
        if (!Array.isArray(reusablePaths) || !Array.isArray(remainingGaps)) {
          throw new Error("--reusable-paths and --remaining-gaps must be JSON arrays");
        }
      }
      const correctSettings = new SettingsService(store).get();
      const progressLines: string[] = [];
      let renderedOutput = "";
      const { output } = await withCliExchangeReceipt({
        operation: "forklight_correct",
        home: forklightHome(),
        args: {
          taskId,
          feedbackLength: feedback.trim().length,
          maxBudgetUsd,
          structuredGapContract: structuredCount === 3,
          confirm: true,
        },
        taskId,
        invoke: async () => {
          const exec = correctSettings.execution;
          return routeMutation(
            () => ensureDaemon(),
            async () => {
              const task = await daemonRequest<TaskRecord>("correct", {
                taskId,
                feedback,
                ...(maxBudgetUsd !== null ? { maxBudgetUsd } : {}),
                ...(structuredCount === 3 ? {
                  candidateRevisionId,
                  reusablePaths,
                  remainingGaps,
                } : {}),
                confirm: true,
              });
              renderedOutput = `queued: ${task.id}\n`;
              return task;
            },
            async () => {
              const task = store.getTask(taskId);
              const baseMaxAttempts = task.effectivePolicy?.values.baseMaxAttempts ?? exec.maxAttempts;
              const maxMainCorrections = task.effectivePolicy?.values.maxMainCorrections ?? 1;
              const latestRevision = resolveLatestRevision(store.listEvents(taskId));
              let gapContract: ReturnType<typeof validateStructuredCorrectionInput>["contract"] | undefined;
              if (structuredCount === 3) {
                const eligibility = resolveCorrectionEligibility(store, taskId);
                if (!eligibility.eligible) {
                  throw new Error(describeCorrectionRejection(eligibility.category));
                }
                if (latestRevision === undefined) {
                  throw new Error(describeCorrectionRejection("no-revision"));
                }
                gapContract = validateStructuredCorrectionInput({
                  feedback,
                  maxBudgetUsd,
                  candidateRevisionId: candidateRevisionId!,
                  reusablePaths,
                  remainingGaps,
                  confirm: true,
                }, latestRevision).contract;
              } else if (latestRevision !== undefined) {
                throw new Error(
                  "correction for a revisioned Task requires the three structured correction flags",
                );
              }
              authorizeMainCorrection(
                store,
                taskId,
                {
                  feedback: feedback.trim(),
                  maxBudgetUsd,
                  confirm: true,
                  ...(gapContract === undefined ? {} : { gapContract }),
                },
                baseMaxAttempts,
                maxMainCorrections,
                exec.maximumBudgetUsd,
              );
              prepareMainCorrectionTask(store, taskId);
              const result = await correctTask(
                store, taskId, (event) => {
                  const line = progressLine(event);
                  if (line !== undefined) progressLines.push(line);
                },
                exec, correctSettings.providerDefaults,
              );
              const statusBlock = humanStatusLines(
                result.task,
                undefined,
                failureCategoryForTask(result.task.status, store.listEvents(result.task.id)),
              );
              renderedOutput = `${progressLines.join("")}${statusBlock}`;
              if (result.task.status !== "succeeded") {
                process.exitCode = result.task.status === "interrupted" ? 130 : 1;
              }
              return result.task;
            },
          );
        },
        renderOutput: () => renderedOutput,
      });
      process.stdout.write(output);
      return;
    }
    if (command === "main-review") {
      const taskId = required(positional, "task id");
      const decision = required(option(rest, "--decision"), "review decision");
      if (decision !== "accept" && decision !== "revise" && decision !== "reject") {
        throw new Error("main-review --decision must be accept, revise, or reject");
      }
      const reason = required(option(rest, "--reason"), "review reason");
      if (!rest.includes("--confirm")) {
        throw new Error("main-review requires --confirm");
      }
      const { output } = await withCliExchangeReceipt({
        operation: "forklight_main_review",
        home: forklightHome(),
        args: { taskId, decision, reasonLength: reason.trim().length, confirm: true },
        taskId,
        invoke: async () => {
          try {
            await ensureDaemon();
            return daemonRequest<Record<string, unknown>>("main_review", {
              taskId,
              decision,
              reason,
              confirm: true,
            });
          } catch {
            return recordMainReview(store, taskId, {
              decision,
              reason,
              confirm: true,
            });
          }
        },
        renderOutput: (review) => `${JSON.stringify(review, null, 2)}\n`,
      });
      process.stdout.write(output);
      return;
    }
    if (command === "review-graph") {
      const sub = required(positional, "review-graph subcommand (create|status)");
      const taskId = required(rest[0], "task id");
      const asJson = rest.includes("--json");
      if (sub === "create") {
        const profileIds: string[] = [];
        const profilesCsv = option(rest, "--reviewer-profiles");
        if (profilesCsv !== undefined) {
          for (const part of profilesCsv.split(",")) {
            const trimmed = part.trim();
            if (trimmed.length > 0) profileIds.push(trimmed);
          }
        }
        for (let index = 0; index < rest.length; index += 1) {
          if (rest[index] === "--reviewer-profile") {
            const value = rest[index + 1];
            if (value === undefined || value.startsWith("--")) {
              throw new Error("review-graph create --reviewer-profile requires a profile id");
            }
            profileIds.push(value.trim());
          }
        }
        if (profileIds.length === 0) {
          throw new Error(
            "review-graph create requires --reviewer-profile <id> or --reviewer-profiles <id1,id2,id3>",
          );
        }
        const reason = required(option(rest, "--reason"), "review reason");
        if (!rest.includes("--confirm")) {
          throw new Error("review-graph create requires --confirm");
        }
        await ensureDaemon();
        const result = await daemonRequest<Record<string, unknown>>("review_graph_create", {
          taskId,
          reviewerWorkerProfileIds: profileIds,
          // Backward-compatible single-profile field for one-item callers.
          ...(profileIds.length === 1
            ? { reviewerWorkerProfileId: profileIds[0] }
            : {}),
          reason,
          confirm: true,
        });
        if (asJson) {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        } else {
          const graph = result.graph as Record<string, unknown> | undefined;
          const reviewerTaskIds = Array.isArray(result.reviewerTaskIds)
            ? result.reviewerTaskIds
            : [result.reviewerTaskId];
          process.stdout.write(`review-graph: ${String(graph?.id ?? result.reviewerTaskId)}\n`);
          process.stdout.write(`created: ${String(result.created)}\n`);
          process.stdout.write(`judges: ${String(reviewerTaskIds.length)}\n`);
          process.stdout.write(`reviewerTaskId: ${String(result.reviewerTaskId)}\n`);
          process.stdout.write(`reviewerTaskIds: ${reviewerTaskIds.map(String).join(",")}\n`);
          process.stdout.write(`status: ${String(graph?.status ?? "unknown")}\n`);
          const aggregation = graph?.aggregation as Record<string, unknown> | undefined;
          if (aggregation !== undefined) {
            process.stdout.write(
              `aggregation: state=${String(aggregation.state)} ` +
              `usable=${String(aggregation.usable)}/${String(aggregation.total)} ` +
              `pending=${String(aggregation.pending)}\n`,
            );
            process.stdout.write(`explanation: ${String(aggregation.explanation ?? "")}\n`);
          }
          process.stdout.write(`next: ${String(graph?.nextAction ?? "")}\n`);
          process.stdout.write(
            "Judge output is evidence only. Main decides accept/revise/reject after every judge finishes. No automatic vote or retry.\n",
          );
        }
        return;
      }
      if (sub === "status") {
        await ensureDaemon();
        const result = await daemonRequest<Record<string, unknown> | null>(
          "review_graph_status",
          { taskId },
        );
        if (asJson) {
          process.stdout.write(`${JSON.stringify(result ?? null, null, 2)}\n`);
        } else if (result === null || result === undefined) {
          process.stdout.write("review-graph: none\n");
        } else {
          process.stdout.write(`review-graph: ${String(result.id)}\n`);
          process.stdout.write(`status: ${String(result.status)}\n`);
          process.stdout.write(`revision: ${String(result.candidateRevisionId)}\n`);
          process.stdout.write(`digestPrefix: ${String(result.digestPrefix)}\n`);
          process.stdout.write(`blocksIntegration: ${String(result.blocksIntegration)}\n`);
          process.stdout.write(
            `requiresFreshMainReview: ${String(result.requiresFreshMainReview)}\n`,
          );
          const aggregation = result.aggregation as Record<string, unknown> | undefined;
          if (aggregation !== undefined) {
            process.stdout.write(
              `aggregation: state=${String(aggregation.state)} ` +
              `usable=${String(aggregation.usable)}/${String(aggregation.total)} ` +
              `unusable=${String(aggregation.unusable)} pending=${String(aggregation.pending)}\n`,
            );
            process.stdout.write(`explanation: ${String(aggregation.explanation ?? "")}\n`);
          }
          process.stdout.write(`next: ${String(result.nextAction)}\n`);
          const assignments = Array.isArray(result.assignments) ? result.assignments : [];
          for (const raw of assignments) {
            const a = raw as Record<string, unknown>;
            process.stdout.write(
              `assignment ${String(a.ordinal)}: profile=${String(a.reviewerWorkerProfileId)} ` +
              `task=${String(a.reviewerTaskId)} status=${String(a.status)} ` +
              `usable=${String(a.resultUsable)}\n`,
            );
            if (a.result && typeof a.result === "object") {
              const r = a.result as Record<string, unknown>;
              process.stdout.write(
                `  suggested: ${String(r.proposedDisposition)} — ${String(r.summary)}\n`,
              );
            }
            if (a.failureCode !== undefined) {
              process.stdout.write(`  failure: ${String(a.failureCode)}\n`);
            }
          }
          process.stdout.write(
            "Main remains the final authority; judge dispositions are never automatic acceptance or a vote.\n",
          );
        }
        return;
      }
      throw new Error("review-graph subcommand must be create or status");
    }
    if (command === "revise") {
      const taskId = required(positional, "task id");
      // The shared eligibility boundary (checkReviseEligibility) canonicalizes
      // the feedback once.  The receipt only carries the raw character length.
      const feedbackIndex = rest.indexOf("--feedback");
      if (feedbackIndex === -1) {
        throw new Error("revise requires --feedback\n\n" + usage());
      }
      const feedback = required(rest[feedbackIndex + 1], "feedback text");
      const authorization = parseResumeAuthorization(rest);
      // Same exchange-receipt semantics as resume: daemon path renders
      // "queued: <id>\n"; local fallback accumulates progress lines plus
      // the final human status block.  Resolve persisted settings once so
      // the local fallback applies the same execution and provider-default
      // policy the daemon coordinator would use.
      const reviseSettings = new SettingsService(store).get();
      const progressLines: string[] = [];
      let renderedOutput = "";
      const { output } = await withCliExchangeReceipt({
        operation: "forklight_revise",
        home: forklightHome(),
        args: {
          taskId,
          feedbackLength: feedback.length,
          ...(authorization === undefined ? {} : {
            authorization: {
              additionalAttempts: 1,
              maxBudgetUsd: authorization.maxBudgetUsd,
              reasonLength: authorization.reason.trim().length,
              confirm: true,
            },
          }),
        },
        taskId,
        invoke: async () => {
          const exec = reviseSettings.execution;
          return routeMutation(
            () => ensureDaemon(),
            async () => {
              const task = await daemonRequest<TaskRecord>("revise", {
                taskId,
                feedback,
                ...(authorization === undefined ? {} : { authorization }),
              });
              renderedOutput = `queued: ${task.id}\n`;
              return task;
            },
            async () => {
              // Resolve durable pending grant before eligibility so the
              // exact maximum ordinal is authoritative — same as the
              // daemon coordinator path.  A pending grant permits
              // admission without duplicate authorization.
              const pendingGrant = resolvePendingGrantExecutionOptions(
                store, taskId, exec.maxAttempts, exec.maxExtraAttempts,
              );
              const effectiveLimit = pendingGrant?.maximumOrdinal
                ?? (authorization !== undefined ? exec.maxAttempts + exec.maxExtraAttempts : exec.maxAttempts);
              // Validate non-attempt eligibility and canonicalize feedback
              // BEFORE recording any authorization grant.  Attempt-count
              // eligibility is enforced by authorizeExtraAttempt and
              // re-validated by reviseTask with its authoritative bound.
              const precheck = checkReviseEligibility(
                store, taskId, feedback, effectiveLimit,
              );
              if (!precheck.eligible && precheck.reason !== "exhausted-attempts") {
                throw new Error(precheck.reason !== undefined
                  ? describeReviseRejection(precheck.reason)
                  : "revise rejected");
              }
              if (!precheck.eligible && authorization === undefined && !pendingGrant) {
                throw new Error(describeReviseRejection("exhausted-attempts"));
              }
              const canonicalFeedback = precheck.canonicalFeedback ?? feedback.trim();
              let executionOptions: AttemptExecutionOptions | undefined;
              if (authorization !== undefined) {
                executionOptions = authorizeExtraAttempt(
                  store,
                  taskId,
                  authorization,
                  exec.maxAttempts,
                  exec.maximumBudgetUsd,
                  exec.maxExtraAttempts,
                );
              } else if (pendingGrant) {
                executionOptions = pendingGrant;
              }
              const result = await reviseTask(
                store, taskId, canonicalFeedback, (event) => {
                  const line = progressLine(event);
                  if (line !== undefined) progressLines.push(line);
                },
                exec,
                reviseSettings.providerDefaults,
                executionOptions,
              );
              const statusBlock = humanStatusLines(
                result.task,
                undefined,
                failureCategoryForTask(result.task.status, store.listEvents(result.task.id)),
              );
              renderedOutput = `${progressLines.join("")}${statusBlock}`;
              if (result.task.status !== "succeeded") {
                process.exitCode = result.task.status === "interrupted" ? 130 : 1;
              }
              return result.task;
            },
          );
        },
        renderOutput: () => renderedOutput,
      });
      process.stdout.write(output);
      return;
    }
    if (command === "status") {
      const taskId = required(positional, "task id");
      const quietAfterMs = DEFAULT_QUIET_AFTER_MS;
      const { output } = await withCliExchangeReceipt({
        operation: "forklight_status",
        home: forklightHome(),
        args: { taskId, json },
        taskId,
        invoke: async () => {
          const task = reconcileTask(store, taskId);
          const summary = projectStoredTaskSurface(store, task, Date.now(), quietAfterMs);
          return { task, summary };
        },
        renderOutput: ({ task, summary }) => json
          ? `${JSON.stringify(summary, null, 2)}\n`
          : humanStatusLines(task, summary.progress, summary.failureCategory),
      });
      process.stdout.write(output);
      return;
    }
    if (command === "wait") {
      const taskId = required(positional, "task id");
      const settings = new SettingsService(store).get();
      const waitOptions = parseWaitOptions(rest, settings.console.refreshIntervalMs);
      const readProgress = (): TaskProgressSnapshot => {
        const task = reconcileTask(store, taskId);
        const latestEvent = toLatestEventMeta(store.latestEventMeta(taskId));
        // When the Task is terminal, rebuild the canonical live-stage projection
        // from ordered events so wait can detect open post-terminal follow-up
        // operations and continue polling instead of returning terminal immediately.
        let liveStage: TaskProgressSnapshot["liveStage"];
        if (
          isTerminalTaskStatus(task.status)
          && latestEvent !== undefined
        ) {
          const events = store.listEvents(taskId);
          liveStage = projectLiveStage(
            task,
            events.map((event) => ({
              sequence: event.sequence,
              timestamp: event.timestamp,
              type: event.type,
              ...(event.payload === undefined ? {} : { payload: event.payload }),
            })),
            Date.now(),
            DEFAULT_QUIET_AFTER_MS,
          );
        }
        return {
          task,
          cursor: buildProgressCursor(task, latestEvent),
          ...(latestEvent === undefined ? {} : { latestEvent }),
          ...(liveStage === undefined ? {} : { liveStage }),
        };
      };
      const { output } = await withCliExchangeReceipt({
        operation: "forklight_wait",
        home: forklightHome(),
        args: {
          taskId,
          timeoutMs: waitOptions.timeoutMs,
          pollMs: waitOptions.pollMs,
          until: waitOptions.until,
          json: waitOptions.json,
        },
        taskId,
        invoke: async () => waitForTask(waitOptions, {
          readProgress,
          sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
          now: () => Date.now(),
        }),
        renderOutput: (result) => waitOptions.json
          ? `${JSON.stringify(result, null, 2)}\n`
          : humanWaitLines(result),
      });
      process.stdout.write(output);
      return;
    }
    if (command === "inspect") {
      const taskId = required(positional, "task id");
      const summaryRequested = rest.includes("--summary") || rest.includes("--events");
      if (summaryRequested) {
        const settings = new SettingsService(store).get();
        const summaryOptions = parseInspectSummaryOptions(rest, settings.console.eventListLimit);
        const { output } = await withCliExchangeReceipt({
          operation: "forklight_inspect",
          home: forklightHome(),
          args: {
            taskId,
            json: summaryOptions.json,
            summary: true,
            events: summaryOptions.eventLimit,
          },
          taskId,
          invoke: async () => {
            const task = reconcileTask(store, taskId);
            const attempts = store.listAttempts(taskId);
            const events = store.listEvents(taskId);
            const integrationResults = store.listIntegrationResults(taskId);
            let diff: string | undefined;
            try {
              diff = await readFile(task.paths.diff, "utf8");
            } catch {
              // A diff does not exist until independent verification begins.
            }
            return buildCompactInspection({
              task,
              attempts,
              events,
              integrationResults,
              decision: buildTaskDecisionView({
                task,
                attempts,
                events,
                integrationResults,
              }),
              diff,
              eventLimit: summaryOptions.eventLimit,
            });
          },
          renderOutput: (inspection) => summaryOptions.json
            ? `${JSON.stringify(inspection, null, 2)}\n`
            : humanCompactInspectionLines(inspection),
        });
        process.stdout.write(output);
        return;
      }
      const { output } = await withCliExchangeReceipt({
        operation: "forklight_inspect",
        home: forklightHome(),
        args: { taskId, json },
        taskId,
        invoke: async () => {
          const task = reconcileTask(store, taskId);
          const attempts = store.listAttempts(taskId);
          const events = store.listEvents(taskId);
          let diff = "";
          try {
            diff = await readFile(task.paths.diff, "utf8");
          } catch {
            // A diff does not exist until independent verification begins.
          }
          return { task, attempts, events, diff };
        },
        renderOutput: ({ task, attempts, events, diff }) => json
          ? `${JSON.stringify({ task, attempts, events, diff }, null, 2)}\n`
          : humanInspectLines(task, attempts, events, diff),
      });
      process.stdout.write(output);
      return;
    }
    if (command === "tokens") {
      const taskId = required(positional, "task id");
      const report = getTaskTokenReport(store, taskId);
      if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      else process.stdout.write(humanTokenReportLines(report));
      return;
    }
    if (command === "list") {
      const nowMs = Date.now();
      const tasks = store.listTasks().slice(0, 20).map(
        (task) => projectStoredTaskSurface(store, task, nowMs),
      );
      if (json) process.stdout.write(`${JSON.stringify(tasks, null, 2)}\n`);
      else for (const task of tasks) {
        const activity = task.progress?.activity ?? "";
        const cat = task.failureCategory ? ` ${task.failureCategory}` : "";
        process.stdout.write(
          activity
            ? `${task.taskId} ${task.status} ${activity}${cat} ${task.name}\n`
            : `${task.taskId} ${task.status}${cat} ${task.name}\n`,
        );
      }
      return;
    }
    throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  } finally {
    store.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`ForkLight error: ${message}\n`);
  process.exitCode = 1;
});
