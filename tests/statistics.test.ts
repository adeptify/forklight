import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyFailure,
  computeStatistics,
  StatisticsService,
  type FailureCategory,
  type TaskEvidence,
} from "../src/core/statistics.js";
import type { AttemptRecord, EventRecord, TaskRecord, VerificationResult } from "../src/core/types.js";
import { StateStore } from "../src/state/store.js";

const failedVerification: VerificationResult = {
  passed: false,
  commands: [
    { command: "npm test", exitCode: 1, stdout: "", stderr: "failed", durationMs: 10, timedOut: false },
  ],
  diffPath: "/tmp/result.diff",
  sourceUnchanged: true,
};

test("classifies explicit and legacy failure evidence with deterministic precedence", () => {
  const cases: Array<{
    diagnostic: string;
    category: FailureCategory;
    extra?: Partial<Parameters<typeof classifyFailure>[0]>;
  }> = [
    { diagnostic: "HTTP 401 during shutdown", category: "interruption", extra: { attemptExitCode: 143 } },
    { diagnostic: "Authentication failed", category: "interruption", extra: { taskStatus: "interrupted" } },
    { diagnostic: "Independent verification failed", category: "verification", extra: { verification: failedVerification } },
    { diagnostic: "Independent verification failed: HTTP 401", category: "verification" },
    { diagnostic: "Workspace preparation failed: keychain denied", category: "workspace" },
    { diagnostic: "Worker execution interrupted by SIGTERM", category: "interruption" },
    { diagnostic: "HTTP 401: Invalid API key", category: "credential" },
    { diagnostic: "Budget exceeded: max-budget-usd reached", category: "budget" },
    { diagnostic: "HTTP 429: rate limit exceeded", category: "provider" },
    { diagnostic: "unrecognized legacy code 0xDEAD", category: "unclassified" },
    { diagnostic: "", category: "unclassified" },
  ];

  for (const { diagnostic, category, extra } of cases) {
    const input = { taskStatus: "failed" as const, error: diagnostic, ...extra };
    const first = classifyFailure(input);
    assert.deepEqual(classifyFailure(input), first);
    assert.equal(first.category, category, diagnostic);
    assert.equal(first.diagnostic, diagnostic);
    assert.ok(first.reason.length > 0);
  }
});

test("reports failed commands and change-budget evidence without changing diagnostics", () => {
  const command = classifyFailure({
    taskStatus: "failed",
    verification: failedVerification,
    error: "verifier diagnostic",
  });
  assert.match(command.reason, /npm test.*exit 1/);
  assert.equal(command.diagnostic, "verifier diagnostic");

  const budget = classifyFailure({
    taskStatus: "failed",
    verification: {
      ...failedVerification,
      commands: [],
      changeBudget: {
        filesChanged: 4,
        changedLines: 301,
        maxFiles: 3,
        maxDiffLines: 300,
        withinBudget: false,
      },
    },
  });
  assert.match(budget.reason, /4\/3 files.*301\/300 lines/);
});

const baseTime = Date.parse("2026-07-20T00:00:00Z");
const at = (minutes: number): string => new Date(baseTime + minutes * 60_000).toISOString();

function task(
  id: string,
  status: TaskRecord["status"],
  provider = "deepseek",
  model = "v4",
  error?: string,
): TaskRecord {
  return {
    id,
    name: id,
    status,
    sourcePath: "/source",
    taskFile: `/tasks/${id}.yaml`,
    spec: { provider: { name: provider, model } } as TaskRecord["spec"],
    paths: {} as TaskRecord["paths"],
    sessionId: `session-${id}`,
    createdAt: at(0),
    updatedAt: at(120),
    startedAt: at(0),
    finishedAt: at(120),
    ...(error === undefined ? {} : { error }),
  };
}

function attempt(
  taskId: string,
  ordinal: number,
  status: AttemptRecord["status"],
  costUsd?: number,
  turns?: number,
  exitCode?: number,
): AttemptRecord {
  return {
    id: `${taskId}-${ordinal}`,
    taskId,
    ordinal,
    status,
    sessionId: `session-${taskId}`,
    rawLogPath: "/log",
    startedAt: at(ordinal - 1),
    finishedAt: at(ordinal),
    ...(costUsd === undefined ? {} : { costUsd }),
    ...(turns === undefined ? {} : { turns }),
    ...(exitCode === undefined ? {} : { exitCode }),
  };
}

function toolEvent(taskId: string, attemptId: string, minutes: number): EventRecord {
  return {
    id: minutes,
    taskId,
    attemptId,
    sequence: minutes,
    timestamp: at(minutes),
    type: "worker.tool.started",
    summary: "Read started",
    payload: { tool: "Read" },
  };
}

const passedVerification: VerificationResult = {
  passed: true,
  commands: [{ command: "npm test", exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false }],
  diffPath: "/diff",
  sourceUnchanged: true,
};

test("statistics keep timing separate and preserve missing metric samples", () => {
  const running = task("running", "running");
  const succeeded = task("slow", "succeeded");
  const partial = task("partial", "succeeded");
  const history: TaskEvidence[] = [
    { task: running, attempts: [], events: [] },
    {
      task: succeeded,
      attempts: [attempt("slow", 1, "succeeded")],
      events: [toolEvent("slow", "slow-1", 10)],
      verification: passedVerification,
    },
    {
      task: partial,
      attempts: [attempt("partial", 1, "failed", 0.1, 2), attempt("partial", 2, "succeeded")],
      events: [toolEvent("partial", "partial-2", 20)],
      verification: passedVerification,
    },
  ];

  const summary = computeStatistics(history)[0]!;
  assert.equal(summary.sampleSize, 2);
  assert.equal(summary.successCount, 2);
  assert.equal(summary.durationSampleSize, 2);
  assert.equal(summary.avgDurationMs, 120 * 60_000);
  assert.equal(summary.firstEffectiveActionSampleSize, 2);
  assert.equal(summary.avgTimeToFirstEffectiveActionMs, 15 * 60_000);
  assert.equal(summary.costSampleSize, 0);
  assert.equal(summary.avgCostUsd, undefined);
  assert.equal(summary.turnsSampleSize, 0);
  assert.equal(summary.retryCount, 1);
});

test("statistics retain exact diagnostics while aggregating failure categories", () => {
  const credential = task("credential", "failed", "deepseek", "v4", "HTTP 401: bad key");
  const interrupted = task("interrupted", "interrupted", "deepseek", "v4", "SIGTERM");
  const summary = computeStatistics([
    { task: credential, attempts: [attempt("credential", 1, "failed", 0.2, 3, 1)], events: [] },
    { task: interrupted, attempts: [attempt("interrupted", 1, "interrupted", 0.1, 2, 143)], events: [] },
  ])[0]!;

  assert.deepEqual(summary.failureDistribution, { credential: 1, interruption: 1 });
  assert.equal(summary.failures[0]?.diagnostic, "HTTP 401: bad key");
  assert.equal(summary.failures[1]?.diagnostic, "SIGTERM");
  assert.equal(summary.costSampleSize, 2);
  assert.ok(Math.abs((summary.totalCostUsd ?? 0) - 0.3) < 1e-9);
});

test("statistics service reads terminal task evidence without mutating history", () => {
  const home = mkdtempSync(path.join(tmpdir(), "forklight-statistics-"));
  const store = new StateStore(home);
  try {
    const record = task("stored", "succeeded", "minimax", "m3");
    const workerAttempt = attempt("stored", 1, "succeeded", 0.4, 5, 0);
    store.createTask(record);
    store.createAttempt(workerAttempt);
    store.addEvent(
      record.id,
      workerAttempt.id,
      "verification.completed",
      "Independent verification passed",
      passedVerification,
    );

    const summary = new StatisticsService(store).summarize({ providerName: "minimax" });
    assert.equal(summary[0]?.verifiedSuccessCount, 1);
    assert.equal(summary[0]?.model, "m3");
    assert.equal(store.getTask(record.id).status, "succeeded");
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});
