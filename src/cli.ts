#!/usr/bin/env -S node --disable-warning=ExperimentalWarning

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PlanBoard, PlanBoardSummary } from "./core/board.js";
import { forklightHome } from "./core/config.js";
import { createClaudeProbeRunner, realExecFile } from "./core/provider-probe.js";
import { providerReadiness } from "./core/providers.js";
import type { ProviderModelSummary } from "./core/statistics.js";
import type { EventRecord, NormalizedWorkerEvent, TaskRecord } from "./core/types.js";
import { loadWorkPlan } from "./core/plan.js";
import { reconcileTask, resumeTask, runNewTask } from "./core/runner.js";
import { assessTaskQuality, loadTaskSpec } from "./core/task.js";
import { createKeychainStore } from "./core/secrets.js";
import { SettingsService, type TaskPolicy } from "./core/settings.js";
import { daemonRequest, ensureDaemon } from "./daemon/client.js";
import type { DaemonMethod } from "./daemon/protocol.js";
import { createSystemInspector, SetupService } from "./setup/service.js";
import { SetupServer } from "./setup/server.js";
import { StateStore } from "./state/store.js";

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
  forklight resume <task-id>
  forklight inspect <task-id> [--json]
  forklight list [--json]
  forklight stats [--json] [--provider <name>] [--model <name>] [--since <ISO>] [--until <ISO>]
  forklight daemon <start|status|stop>
  forklight health [--json]
  forklight settings <get|set|apply|reset> [...]
  forklight integration preflight <task-id> [--json]
  forklight integration apply <task-id> --receipt <receipt-id> --confirm [--json]
  forklight integration history <task-id> [--json]
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

function printProgress(event: NormalizedWorkerEvent): void {
  if (event.type === "worker.message" && event.summary.length > 180) return;
  const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
  process.stdout.write(`[${time}] ${event.summary}\n`);
}

function taskSummary(task: TaskRecord): Record<string, unknown> {
  return {
    id: task.id,
    name: task.name,
    status: task.status,
    provider: task.spec.provider.name,
    model: task.spec.provider.model,
    runtime: task.spec.runtime.name,
    source: task.sourcePath,
    workspace: task.paths.workspace,
    sessionId: task.sessionId,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    error: task.error,
  };
}

function printHumanStatus(task: TaskRecord): void {
  const summary = taskSummary(task);
  for (const [key, value] of Object.entries(summary)) {
    if (value !== undefined) process.stdout.write(`${key}: ${String(value)}\n`);
  }
}

async function inspect(store: StateStore, taskId: string, json: boolean): Promise<void> {
  const task = reconcileTask(store, taskId);
  const attempts = store.listAttempts(taskId);
  const events = store.listEvents(taskId);
  let diff = "";
  try {
    diff = await readFile(task.paths.diff, "utf8");
  } catch {
    // A diff does not exist until independent verification begins.
  }
  if (json) {
    process.stdout.write(`${JSON.stringify({ task, attempts, events, diff }, null, 2)}\n`);
    return;
  }
  printHumanStatus(task);
  process.stdout.write(`attempts: ${attempts.length}\n`);
  for (const attempt of attempts) {
    process.stdout.write(
      `  #${attempt.ordinal} ${attempt.status} exit=${attempt.exitCode ?? "-"} cost=$${attempt.costUsd?.toFixed(4) ?? "-"} turns=${attempt.turns ?? "-"}\n`,
    );
  }
  process.stdout.write("events:\n");
  for (const event of events) printStoredEvent(event);
  process.stdout.write(`diff: ${task.paths.diff}${diff ? ` (${diff.split("\n").length - 1} lines)` : " (not generated)"}\n`);
}

function printStoredEvent(event: EventRecord): void {
  process.stdout.write(`  ${event.sequence}. ${event.type} — ${event.summary}\n`);
}

function option(arguments_: string[], flag: string): string | undefined {
  const index = arguments_.indexOf(flag);
  return index >= 0 ? arguments_[index + 1] : undefined;
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

function health(json: boolean): void {
  let claudeVersion = "unavailable";
  try {
    claudeVersion = execFileSync("claude", ["--version"], { encoding: "utf8" }).trim();
  } catch {
    // Reported in health output.
  }
  const readiness = providerReadiness();
  const result = {
    ok: claudeVersion !== "unavailable" && readiness.anyReady,
    node: process.version,
    claudeCode: claudeVersion,
    providers: readiness.providers,
    home: forklightHome(),
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
    health(json);
    return;
  }

  if (command === "validate") {
    const store = new StateStore(forklightHome());
    try {
      const settings = new SettingsService(store).get();
      const policy: TaskPolicy = {
        contractQuality: settings.contractQuality,
        execution: settings.execution,
        providerDefaults: settings.providerDefaults,
      };
      const loaded = await loadTaskSpec(required(positional, "task file"), policy);
      const report = assessTaskQuality(loaded.spec, settings.contractQuality);
      if (json) process.stdout.write(`${JSON.stringify({ taskFile: loaded.taskFile, report }, null, 2)}\n`);
      else {
        process.stdout.write(`Task Contract: ${report.passed ? "PASS" : "FAIL"} (${report.score}/100)\n`);
        for (const check of report.checks) {
          process.stdout.write(`${check.passed ? "✓" : "✗"} ${check.label} — ${check.detail}\n`);
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
      { planFile: required(positional, "plan file") },
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
    await ensureDaemon();
    const task = await daemonRequest<TaskRecord>("submit_file", {
      taskFile: required(positional, "task file"),
    });
    process.stdout.write(`taskId: ${task.id}\n`);
    printHumanStatus(task);
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
    const subcommand = required(positional, "integration subcommand (preflight, apply, or history)");
    await ensureDaemon();
    if (subcommand === "preflight") {
      const receipt = await daemonRequest<Record<string, unknown>>("integration_preflight", {
        taskId: required(rest[0], "task id"),
      });
      if (json) process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
      else {
        process.stdout.write(`receiptId: ${receipt.id}\n`);
        process.stdout.write(`taskId: ${receipt.taskId}\n`);
        const reasons = receipt.rejectionReasons as string[];
        process.stdout.write(`passed: ${reasons.length === 0}\n`);
        if (reasons.length > 0) {
          process.stdout.write("rejectionReasons:\n");
          for (const reason of reasons) process.stdout.write(`  - ${reason}\n`);
        }
        const files = receipt.affectedFiles as string[];
        process.stdout.write(`affectedFiles: ${files.join(", ") || "(none)"}\n`);
        process.stdout.write(`patchDigest: ${receipt.patchDigest || "(none)"}\n`);
      }
      return;
    }
    if (subcommand === "apply") {
      const taskId = required(rest[0], "task id");
      const receiptId = required(option(rest, "--receipt"), "receipt id (--receipt)");
      if (!rest.includes("--confirm")) throw new Error("Apply requires explicit --confirm\n\n" + usage());
      const result = await daemonRequest<Record<string, unknown>>("integration_apply", {
        taskId,
        receiptId,
        confirm: true,
      });
      if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else {
        process.stdout.write(`status: ${result.status}\n`);
        process.stdout.write(`receiptId: ${result.receiptId}\n`);
        if (result.error) process.stdout.write(`error: ${result.error}\n`);
        if (result.appliedAt) process.stdout.write(`appliedAt: ${result.appliedAt}\n`);
      }
      return;
    }
    if (subcommand === "history") {
      const history = await daemonRequest<{ receipts: unknown[]; results: unknown[] }>("integration_history", {
        taskId: required(rest[0], "task id"),
      });
      if (json) process.stdout.write(`${JSON.stringify(history, null, 2)}\n`);
      else {
        process.stdout.write(`receipts: ${history.receipts.length}\n`);
        process.stdout.write(`results: ${history.results.length}\n`);
        for (const result of history.results) {
          const r = result as Record<string, unknown>;
          process.stdout.write(`  ${r.status} — ${r.receiptId}${r.error ? ` (${r.error})` : ""}\n`);
        }
      }
      return;
    }
    throw new Error(`Unknown integration subcommand: ${subcommand}. Use: preflight, apply, or history.`);
  }

  if (command === "compete") {
    await ensureDaemon();
    const taskFile = required(positional, "task file");
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
      try {
        await ensureDaemon();
        const task = await daemonRequest<TaskRecord>("resume", {
          taskId,
          ...(feedback === undefined ? {} : { feedback }),
        });
        process.stdout.write(`queued: ${task.id}\n`);
      } catch {
        const result = await resumeTask(store, taskId, printProgress, feedback);
        printHumanStatus(result.task);
        if (result.task.status !== "succeeded") {
          process.exitCode = result.task.status === "interrupted" ? 130 : 1;
        }
      }
      return;
    }
    if (command === "status") {
      const task = reconcileTask(store, required(positional, "task id"));
      if (json) process.stdout.write(`${JSON.stringify(taskSummary(task), null, 2)}\n`);
      else printHumanStatus(task);
      return;
    }
    if (command === "inspect") {
      await inspect(store, required(positional, "task id"), json);
      return;
    }
    if (command === "list") {
      const tasks = store.listTasks().slice(0, 20).map(taskSummary);
      if (json) process.stdout.write(`${JSON.stringify(tasks, null, 2)}\n`);
      else for (const task of tasks) process.stdout.write(`${task.id} ${task.status} ${task.name}\n`);
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
