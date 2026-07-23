#!/usr/bin/env node
/**
 * Wave 0 read-only economics snapshot for ForkLight local state.
 * Usage:
 *   node scripts/economics-snapshot.mjs
 *   FORKLIGHT_HOME=/path node scripts/economics-snapshot.mjs --json
 */
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";

const json = process.argv.includes("--json");
const home = process.env.FORKLIGHT_HOME?.trim()
  || (process.platform === "darwin"
    ? path.join(os.homedir(), "Library", "Application Support", "ForkLight")
    : path.join(os.homedir(), ".local", "share", "forklight"));
const dbPath = path.join(home, "forklight.sqlite");

function parse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const tasks = db.prepare("SELECT id, status, record_json FROM tasks").all()
  .map((r) => ({ ...r, rec: parse(r.record_json) })).filter((t) => t.rec);
const attempts = db.prepare("SELECT id, task_id, ordinal, status, record_json FROM attempts").all()
  .map((r) => ({ ...r, rec: parse(r.record_json) })).filter((a) => a.rec);
const receipts = db.prepare(
  "SELECT id, task_id, record_json FROM orchestration_exchange_receipts",
).all().map((r) => ({ ...r, rec: parse(r.record_json) })).filter((r) => r.rec);

const taskStatus = {};
for (const t of tasks) taskStatus[t.status] = (taskStatus[t.status] || 0) + 1;

const attemptStatus = {};
let official = 0, officialN = 0, runtime = 0, runtimeN = 0;
let usageIn = 0, usageOut = 0, usageCr = 0, usageCc = 0, usageN = 0;
for (const a of attempts) {
  attemptStatus[a.status] = (attemptStatus[a.status] || 0) + 1;
  const oc = a.rec.officialCost;
  if (oc?.quoted === true && Number.isFinite(oc.result?.total)) {
    official += oc.result.total;
    officialN += 1;
  }
  const rt = a.rec.runtimeCostEstimateUsd ?? a.rec.costUsd;
  if (typeof rt === "number" && Number.isFinite(rt)) {
    runtime += rt;
    runtimeN += 1;
  }
  const u = a.rec.usage;
  if (u?.complete === true) {
    usageIn += u.inputTokens || 0;
    usageOut += u.outputTokens || 0;
    usageCr += u.cacheReadInputTokens || 0;
    usageCc += u.cacheCreationInputTokens || 0;
    usageN += 1;
  }
}

const firstOk = attempts.filter((a) => a.ordinal === 1 && a.status === "succeeded").length;
const firstN = attempts.filter((a) => a.ordinal === 1).length;

const ops = {};
let inspectN = 0;
for (const r of receipts) {
  const op = r.rec?.operation || "unknown";
  ops[op] = (ops[op] || 0) + 1;
  if (op === "forklight_inspect") inspectN += 1;
}

const snapshot = {
  capturedAt: new Date().toISOString(),
  home,
  tasks: tasks.length,
  attempts: attempts.length,
  taskStatus,
  attemptStatus,
  firstAttemptSuccessRate: firstN ? firstOk / firstN : null,
  taskSuccessRate: tasks.length ? (taskStatus.succeeded || 0) / tasks.length : null,
  cost: {
    officialQuotedUsd: official,
    officialQuotedAttempts: officialN,
    runtimeEstimateUsd: runtime,
    runtimeEstimateAttempts: runtimeN,
  },
  tokens: {
    completeUsageAttempts: usageN,
    input: usageIn,
    output: usageOut,
    cacheRead: usageCr,
    cacheCreate: usageCc,
    gross: usageIn + usageOut + usageCr + usageCc,
  },
  exchangeReceipts: {
    total: receipts.length,
    byOperation: ops,
    inspectShare: receipts.length ? inspectN / receipts.length : null,
  },
};

if (json) {
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
} else {
  const lines = [
    `ForkLight economics snapshot @ ${snapshot.capturedAt}`,
    `home: ${home}`,
    `tasks: ${snapshot.tasks}  attempts: ${snapshot.attempts}`,
    `taskStatus: ${JSON.stringify(taskStatus)}`,
    `taskSuccessRate: ${snapshot.taskSuccessRate?.toFixed(3) ?? "n/a"}  firstAttemptSuccessRate: ${snapshot.firstAttemptSuccessRate?.toFixed(3) ?? "n/a"}`,
    `officialQuotedUsd: ${official.toFixed(6)} (n=${officialN})`,
    `runtimeEstimateUsd: ${runtime.toFixed(4)} (n=${runtimeN})`,
    `workerGrossTokens (complete usage n=${usageN}): ${snapshot.tokens.gross}`,
    `exchangeReceipts: ${receipts.length}  inspectShare: ${snapshot.exchangeReceipts.inspectShare?.toFixed(3) ?? "n/a"}`,
    `ops: ${JSON.stringify(ops)}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}
