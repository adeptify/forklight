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
import { createClaudeProbeRunner, providerProbeBatchFailed, realExecFile } from "./core/provider-probe.js";
import { providerReadiness } from "./core/providers.js";
import type { ProviderModelSummary } from "./core/statistics.js";
import type {
  AttemptAuthorization, AttemptRecord, EventRecord, NormalizedWorkerEvent, TaskRecord,
} from "./core/types.js";
import { loadWorkPlan } from "./core/plan.js";
import { reconcileTask, resumeTask, reviseTask, runNewTask } from "./core/runner.js";
import { authorizeExtraAttempt } from "./core/attempt-authorization.js";
import { recordMainReview } from "./core/main-review.js";
import { assessIntegrationFeasibility } from "./core/integration-feasibility.js";
import { assessTaskQuality, loadTaskSpec } from "./core/task.js";
import { createKeychainStore } from "./core/secrets.js";
import { SettingsService, type TaskPolicy } from "./core/settings.js";
import { daemonRequest, ensureDaemon } from "./daemon/client.js";
import type { DaemonMethod } from "./daemon/protocol.js";
import { createSystemInspector, SetupService } from "./setup/service.js";
import { SetupServer } from "./setup/server.js";
import { StateStore } from "./state/store.js";
import { withCliExchangeReceipt, humanTokenReportLines } from "./cli/exchange-receipts.js";
import {
  buildCompactInspection,
  buildProgressCursor,
  humanCompactInspectionLines,
  humanWaitLines,
  parseInspectSummaryOptions,
  parseWaitOptions,
  waitForTask,
  type LatestEventMeta,
  type TaskProgressSnapshot,
} from "./cli/supervision.js";
import { getTaskTokenReport } from "./core/token-report.js";
import { buildTaskSummary } from "./core/task-summary.js";
import { buildTaskDecisionView } from "./core/task-decision-view.js";
import {
  compareBuildIdentity,
  currentBuildIdentity,
  isBuildIdentity,
} from "./core/build-identity.js";
import { daemonExchange } from "./daemon/client.js";

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
  forklight status <task-id> [--json]
  forklight wait <task-id> --timeout-ms <positive integer> [--poll-ms <positive integer>] [--until change|terminal] [--json]
      # change = status/attempt/event-sequence/updatedAt cursor (not status-only)
  forklight resume <task-id> [--feedback <text>] [--authorize-extra --max-budget-usd <number|none> --reason <text> --confirm]
  forklight revise <task-id> --feedback <text>
  forklight main-review <task-id> --decision <accept|revise|reject> --reason <text> --confirm
  forklight inspect <task-id> [--summary] [--events <nonnegative integer>] [--json]
      # prefer --summary for main-thread supervision; full inspect is for deep audit
  forklight list [--json]
  forklight stats [--json] [--provider <name>] [--model <name>] [--since <ISO>] [--until <ISO>]
  forklight daemon <start|status|stop>
  forklight health [--json]
  forklight settings <get|set|apply|reset> [...]
  forklight integration preflight <task-id> [--json]
  forklight integration apply <task-id> --receipt <receipt-id> --confirm [--json]
  forklight integration status <operation-id> [--json]
  forklight integration wait <operation-id> --timeout-ms <positive integer> [--json]
  forklight integration history <task-id> [--json]
  forklight tokens <task-id> [--json]
  forklight direct-codex capture --usage <json-object> --metadata <json-object> [--json]
  forklight direct-codex inbox --task-class <class> --profile-id <id> [--json]
  forklight direct-codex review --sample-id <id> --decision <accepted|rejected> [--rejection-reason <reason>] --reviewer <reviewer> --reviewed-at <canonical-ISO> --schema-version <version> --confirm [--json]
  forklight direct-codex publication-preview --task-class <class> --profile-id <id> [--json]
  forklight direct-codex publication-register --task-class <class> --profile-id <id> --method <method> --confidence <level> --created-at <canonical-ISO> --confirm [--json]
  forklight compete <task.yaml> --candidates <json>
  forklight competition status <id> [--json]
  forklight competition list [--json]
  forklight competition compare <id> [--json] [--weights <json>]
  forklight console <start|status|stop>
  forklight providers status [<name>] [--json]
  forklight providers probe [<name>] [--json]
  forklight setup [--no-open] [--port <port>]
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
function humanStatusLines(task: TaskRecord): string {
  const summary = buildTaskSummary(task);
  const lines: string[] = [];
  for (const [key, value] of Object.entries(summary)) {
    if (value !== undefined) lines.push(`${key}: ${String(value)}`);
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function printHumanStatus(task: TaskRecord): void {
  process.stdout.write(humanStatusLines(task));
}

/** Render the human inspect block as a single exact string. */
function humanInspectLines(
  task: TaskRecord, attempts: AttemptRecord[], events: EventRecord[], diff: string,
): string {
  const lines: string[] = [];
  const statusBody = humanStatusLines(task);
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

function humanIntegrationOperationLines(view: Record<string, unknown>): string {
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
      lines.push(`  ${value.stage}: ${value.status}`);
    }
  }
  const result = view.result as Record<string, unknown> | undefined;
  if (result?.error) lines.push(`error: ${result.error}`);
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

function option(arguments_: string[], flag: string): string | undefined {
  const index = arguments_.indexOf(flag);
  return index >= 0 ? arguments_[index + 1] : undefined;
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

function findSetupAssets(): string {
  const dist = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "setup", "public",
  );
  if (existsSync(path.join(dist, "index.html"))) return dist;
  const src = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..", "..", "src", "setup", "public",
  );
  if (existsSync(path.join(src, "index.html"))) return src;
  throw new Error("Setup assets not found. Run the build step first.");
}

function findPackageRoot(): string {
  let candidate = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 4; depth += 1) {
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    candidate = path.dirname(candidate);
  }
  throw new Error("ForkLight package root not found");
}

function printStatistics(summaries: ProviderModelSummary[]): void {
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
    const readiness = providerReadiness(settings.providerDefaults);
    const clientBuildIdentity = currentBuildIdentity();
    let daemonBuildIdentity: unknown;
    let identityStatus = "daemon-unavailable";
    let identityAction: string | undefined;
    try {
      const response = await daemonExchange("health");
      daemonBuildIdentity = response.serverIdentity;
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
    const result = {
      ok: claudeVersion !== "unavailable" && readiness.anyReady,
      node: process.version,
      claudeCode: claudeVersion,
      providers: readiness.providers,
      home: forklightHome(),
      clientBuildIdentity,
      ...(daemonBuildIdentity === undefined ? {} : { daemonBuildIdentity }),
      identityStatus,
      ...(identityAction === undefined ? {} : { identityAction }),
    };
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      process.stdout.write(`ok: ${result.ok}\nnode: ${result.node}\nclaudeCode: ${result.claudeCode}\n`);
      process.stdout.write("providers:\n");
      for (const [name, provider] of Object.entries(result.providers)) {
        process.stdout.write(
          `  ${name}: ready=${provider.ready} model=${provider.defaultModel} endpoint=${provider.endpoint}\n`,
        );
      }
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
      process.stdout.write(`${name}: probe error — ${o.error}\n`);
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
      "Unknown direct-codex subcommand. Use: capture, inbox, review, publication-preview, or publication-register.",
    );
  }

  if (command === "validate") {
    const store = new StateStore(forklightHome());
    try {
      const settings = new SettingsService(store).get();
      const policy: TaskPolicy = {
        contractQuality: settings.contractQuality,
        execution: settings.execution,
        providerDefaults: settings.providerDefaults,
        completionPolicy: settings.completionPolicy,
      };
      const loaded = await loadTaskSpec(required(positional, "task file"), policy);
      const report = assessTaskQuality(loaded.spec, settings.contractQuality);
      const integration = assessIntegrationFeasibility(loaded.spec, settings.integration);
      if (json) {
        process.stdout.write(`${JSON.stringify({
          taskFile: loaded.taskFile,
          report,
          integrationFeasibility: integration,
        }, null, 2)}\n`);
      } else {
        process.stdout.write(`Task Contract: ${report.passed ? "PASS" : "FAIL"} (${report.score}/100)\n`);
        for (const check of report.checks) {
          process.stdout.write(`${check.passed ? "✓" : "✗"} ${check.label} — ${check.detail}\n`);
        }
        if (report.warnings.length > 0) {
          process.stdout.write(`Wording warnings (${report.warnings.length}):\n`);
          for (const warning of report.warnings) {
            process.stdout.write(`  ⚠ ${warning.field}: "${warning.term}" - ${warning.excerpt}\n`);
          }
        }
        if (integration.applicable) {
          process.stdout.write(
            `Integration feasibility: ${integration.integratable ? "OK" : "WARN — executable but may not be integratable"}\n`,
          );
          process.stdout.write(
            `  task budget: ${integration.taskMaxFiles} files / ${integration.taskMaxLines} lines; `
            + `integration limit: ${integration.integrationMaxFiles} files / ${integration.integrationMaxLines} lines\n`,
          );
          for (const issue of integration.issues) {
            process.stdout.write(`  ! ${issue}\n`);
          }
        }
      }
      if (!report.passed) process.exitCode = 1;
    } finally {
      store.close();
    }
    return;
  }

  if (command === "validate-plan") {
    const store = new StateStore(forklightHome());
    try {
      const settings = new SettingsService(store).get();
      const policy: TaskPolicy = {
        contractQuality: settings.contractQuality,
        execution: settings.execution,
        providerDefaults: settings.providerDefaults,
        completionPolicy: settings.completionPolicy,
      };
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

  if (command === "daemon") {
    const operation = required(positional, "daemon operation");
    if (operation === "start") {
      const result = await ensureDaemon();
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    if (operation === "status") {
      const result = await daemonRequest("health");
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    if (operation === "stop") {
      const result = await daemonRequest("shutdown");
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
    const filter = {
      ...(option(options, "--provider") === undefined
        ? {}
        : { providerName: option(options, "--provider") }),
      ...(option(options, "--model") === undefined ? {} : { modelName: option(options, "--model") }),
      ...(option(options, "--since") === undefined ? {} : { since: option(options, "--since") }),
      ...(option(options, "--until") === undefined ? {} : { until: option(options, "--until") }),
    };
    await ensureDaemon();
    const summaries = await daemonRequest<ProviderModelSummary[]>("statistics", filter);
    if (json) process.stdout.write(`${JSON.stringify(summaries, null, 2)}\n`);
    else printStatistics(summaries);
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
          await ensureDaemon();
          return daemonRequest<{ receipts: unknown[]; results: unknown[] }>(
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
      const operation = subcommand === "wait"
        ? "forklight_integration_wait" as const
        : "forklight_integration_status" as const;
      const method = subcommand === "wait"
        ? "integration_wait" as const
        : "integration_status" as const;
      const { output } = await withCliExchangeReceipt({
        operation,
        home: forklightHome(),
        args: { operationId, ...(timeoutMs === undefined ? {} : { timeoutMs }), json },
        taskId: () => taskId,
        invoke: async () => {
          await ensureDaemon();
          const view = await daemonRequest<Record<string, unknown>>(
            method,
            { operationId, ...(timeoutMs === undefined ? {} : { timeoutMs }) },
          );
          if (typeof view.taskId === "string") taskId = view.taskId;
          return view;
        },
        renderOutput: (view) => json
          ? `${JSON.stringify(view, null, 2)}\n`
          : humanIntegrationOperationLines(view),
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
    const competition = await daemonRequest<Record<string, unknown>>("competition_submit_file", { taskFile, candidates });
    if (json) process.stdout.write(`${JSON.stringify(competition, null, 2)}\n`);
    else { const r = competition as Record<string, unknown>; process.stdout.write(`competitionId: ${r.id}\nname: ${r.name}\nstatus: ${r.status}\ncandidates: ${candidates.length}\n`); }
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
      for (const c of r.candidates as Array<Record<string, unknown>>) {
        process.stdout.write(`  ${c.candidateId}: ${c.providerName}/${c.modelName} [${c.taskStatus}]${c.error ? ` — ${c.error}` : ""}\n`);
      }
      if (r.evaluation) { process.stdout.write("evaluation:\n"); printScoredCandidates((r.evaluation as Record<string, unknown>).candidates as Array<Record<string, unknown>>); const rec = (r.evaluation as Record<string, unknown>).recommendation as Record<string, unknown> | undefined; if (rec) process.stdout.write(`recommendation: ${rec.candidateId} (confidence ${rec.confidence}) — ${rec.reasoning}\n`); }
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
    throw new Error(`Unknown competition subcommand: ${subcommand}. Use: status, list, or compare.`);
  }

  if (command === "console") {
    const operation = required(positional, "console operation (start, status, or stop)");
    await ensureDaemon();
    if (operation === "start") {
      const result = await daemonRequest<Record<string, unknown>>("console_start");
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    if (operation === "status") {
      const result = await daemonRequest<Record<string, unknown>>("console_status");
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    if (operation === "stop") {
      const result = await daemonRequest<Record<string, unknown>>("console_stop");
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    throw new Error(`Unknown console operation: ${operation}. Use: start, status, or stop.`);
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

  if (command === "doctor") {
    const inspector = createSystemInspector();
    const store = new StateStore(forklightHome());
    const keychain = createKeychainStore();
    try {
      const service = new SetupService(new SettingsService(store), keychain, inspector);
      const prerequisites = service.inspectPrerequisites();
      const providers = service.describeProviders();
      const current = service.currentProvider();
      if (json) {
        process.stdout.write(`${JSON.stringify({ prerequisites, providers, current }, null, 2)}\n`);
      } else {
        process.stdout.write("Prerequisites:\n");
        for (const check of prerequisites) {
          process.stdout.write(`  ${check.ready ? "✓" : "✗"} ${check.label}: ${check.message}\n`);
          if (check.fix) process.stdout.write(`    fix: ${check.fix}\n`);
        }
        process.stdout.write("Providers:\n");
        for (const p of providers) {
          process.stdout.write(`  ${p.name} (${p.label}): configured=${p.configured} model=${p.defaultModel}\n`);
        }
        if (current) {
          process.stdout.write(`Current default: ${current.providerLabel} model=${current.model} endpoint=${current.endpoint}\n`);
        } else {
          process.stdout.write("No provider configured.\n");
        }
      }
    } finally {
      store.close();
    }
    return;
  }

  if (command === "setup") {
    const setupOptions = [positional, ...rest].filter(
      (value): value is string => value !== undefined,
    );
    const noOpen = setupOptions.includes("--no-open");
    const portFlag = option(setupOptions, "--port");
    const port = portFlag !== undefined ? parseInt(portFlag, 10) : 0;
    if (portFlag !== undefined && (!Number.isFinite(port) || port < 0 || port > 65535)) {
      throw new Error("--port must be a valid port number (0-65535)");
    }

    const inspector = createSystemInspector();
    const store = new StateStore(forklightHome());
    const settings = new SettingsService(store);
    const keychain = createKeychainStore();
    const service = new SetupService(settings, keychain, inspector);
    const runProbe = createClaudeProbeRunner(realExecFile());
    const staticRoot = findSetupAssets();

    const server = new SetupServer({
      service,
      staticRoot,
      port,
      runProbe,
      probePolicy: () => ({ ...settings.get().probe }),
      installPlugin: () => {
        const root = findPackageRoot();
        try {
          execFileSync("codex", ["plugin", "marketplace", "add", root], { stdio: "pipe" });
        } catch {
          // An already-configured Adeptify marketplace is expected on repeat setup.
        }
        execFileSync("codex", ["plugin", "add", "forklight@adeptify"], { stdio: "pipe" });
      },
      ensureDaemon: () => ensureDaemon(),
      daemonRequest: <T = unknown>(method: DaemonMethod, params?: Record<string, unknown>) =>
        daemonRequest<T>(method, params ?? {}),
      saveProbeEvidence: (evidence) => store.saveProbeEvidence(evidence),
    });

    let startedPort: number;
    try {
      startedPort = await server.start();
    } catch (error) {
      store.close();
      throw new Error(
        `Setup server could not start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const token = server.getToken();
    const url = `http://127.0.0.1:${startedPort}/#${encodeURIComponent(token)}`;

    if (!noOpen && process.platform === "darwin") {
      try {
        execFileSync("open", [url], { stdio: "ignore" });
        process.stdout.write(`Setup opened in browser. If it did not open, visit:\n${url}\n`);
      } catch {
        process.stdout.write(`Open this URL to continue setup:\n${url}\n`);
      }
    } else {
      process.stdout.write(`Open this URL to continue setup:\n${url}\n`);
    }

    const requestStop = (): void => { void server.stop(); };
    process.once("SIGINT", requestStop);
    process.once("SIGTERM", requestStop);
    try {
      // Keep the process alive until setup finishes or the user cancels it.
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (!server.isRunning()) {
            clearInterval(check);
            resolve();
          }
        }, 250);
      });
    } finally {
      process.removeListener("SIGINT", requestStop);
      process.removeListener("SIGTERM", requestStop);
      await server.stop();
      store.close();
    }
    process.stdout.write("Setup server stopped.\n");
    return;
  }

  const store = new StateStore(forklightHome());
  try {
    if (command === "run") {
      const settings = new SettingsService(store).get();
      const policy: TaskPolicy = {
        contractQuality: settings.contractQuality,
        execution: settings.execution,
        providerDefaults: settings.providerDefaults,
        completionPolicy: settings.completionPolicy,
      };
      const result = await runNewTask(
        store,
        required(positional, "task file"),
        printProgress,
        (task) => process.stdout.write(`taskId: ${task.id}\n`),
        policy,
      );
      printHumanStatus(result.task);
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
          try {
            await ensureDaemon();
            const task = await daemonRequest<TaskRecord>("resume", {
              taskId,
              ...(feedback === undefined ? {} : { feedback }),
              ...(authorization === undefined ? {} : { authorization }),
            });
            renderedOutput = `queued: ${task.id}\n`;
            return task;
          } catch {
            const executionOptions = authorization === undefined
              ? undefined
              : authorizeExtraAttempt(
                  store,
                  taskId,
                  authorization,
                  resumeSettings.execution.maxAttempts,
                  resumeSettings.execution.maximumBudgetUsd,
                );
            const result = await resumeTask(store, taskId, (event) => {
              const line = progressLine(event);
              if (line !== undefined) progressLines.push(line);
            }, feedback, resumeSettings.execution, resumeSettings.providerDefaults, executionOptions);
            const statusBlock = humanStatusLines(result.task);
            renderedOutput = `${progressLines.join("")}${statusBlock}`;
            if (result.task.status !== "succeeded") {
              process.exitCode = result.task.status === "interrupted" ? 130 : 1;
            }
            return result.task;
          }
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
          try {
            await ensureDaemon();
            const task = await daemonRequest<TaskRecord>("revise", {
              taskId,
              feedback,
              ...(authorization === undefined ? {} : { authorization }),
            });
            renderedOutput = `queued: ${task.id}\n`;
            return task;
          } catch {
            const executionOptions = authorization === undefined
              ? undefined
              : authorizeExtraAttempt(
                  store,
                  taskId,
                  authorization,
                  reviseSettings.execution.maxAttempts,
                  reviseSettings.execution.maximumBudgetUsd,
                );
            const result = await reviseTask(
              store, taskId, feedback, (event) => {
                const line = progressLine(event);
                if (line !== undefined) progressLines.push(line);
              },
              reviseSettings.execution,
              reviseSettings.providerDefaults,
              executionOptions,
            );
            const statusBlock = humanStatusLines(result.task);
            renderedOutput = `${progressLines.join("")}${statusBlock}`;
            if (result.task.status !== "succeeded") {
              process.exitCode = result.task.status === "interrupted" ? 130 : 1;
            }
            return result.task;
          }
        },
        renderOutput: () => renderedOutput,
      });
      process.stdout.write(output);
      return;
    }
    if (command === "status") {
      const taskId = required(positional, "task id");
      const { output } = await withCliExchangeReceipt({
        operation: "forklight_status",
        home: forklightHome(),
        args: { taskId, json },
        taskId,
        invoke: async () => reconcileTask(store, taskId),
        renderOutput: (task) => json
          ? `${JSON.stringify(buildTaskSummary(task), null, 2)}\n`
          : humanStatusLines(task),
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
        const meta = store.latestEventMeta(taskId);
        const latestEvent: LatestEventMeta | undefined = meta === undefined
          ? undefined
          : {
            sequence: meta.sequence,
            timestamp: meta.timestamp,
            type: meta.type,
            summary: meta.summary,
          };
        return {
          task,
          cursor: buildProgressCursor(task, latestEvent),
          ...(latestEvent === undefined ? {} : { latestEvent }),
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
      const tasks = store.listTasks().slice(0, 20).map((task) => buildTaskSummary(task));
      if (json) process.stdout.write(`${JSON.stringify(tasks, null, 2)}\n`);
      else for (const task of tasks) {
        process.stdout.write(`${task.taskId} ${task.status} ${task.name}\n`);
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
