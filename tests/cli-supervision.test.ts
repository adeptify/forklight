import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { AttemptRecord, EventRecord, TaskRecord, TaskStatus } from "../src/core/types.js";
import {
  buildCompactInspection,
  humanCompactInspectionLines,
  humanWaitLines,
  parseInspectSummaryOptions,
  parseWaitOptions,
  waitForTask,
} from "../src/cli/supervision.js";
import { StateStore } from "../src/state/store.js";

const ROOT = process.cwd();
const TS = "2026-07-23T12:00:00.000Z";

function makeTask(id: string, status: TaskStatus = "running"): TaskRecord {
  return {
    id,
    name: `task-${id}`,
    status,
    sourcePath: `/private/source-${id}`,
    taskFile: `/private/${id}.yaml`,
    spec: {
      version: 2,
      name: `task-${id}`,
      project: "/private/project",
      provider: {
        name: "deepseek", model: "deepseek-v4-pro",
        endpoint: "https://private.example", keychainService: "private-keychain",
      },
      runtime: { name: "claude-code", executable: "claude", effort: "medium", maxBudgetUsd: 1 },
      workspace: { exclude: [] },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
      contract: {
        outcome: "private outcome", context: [], inScope: [], outOfScope: [], executionSteps: [],
        deliverables: [], modules: [], callChain: [], scenarios: [], risks: [],
        changeBudget: { maxFiles: 1, maxDiffLines: 20 },
      },
      acceptance: { criteria: [], commands: ["private command"] },
    },
    paths: {
      root: "/private/root", baseline: "/private/baseline", workspace: "/private/workspace",
      logs: "/private/logs", claudeConfig: "/private/config", diff: "/private/result.diff",
    },
    sessionId: `private-session-${id}`,
    createdAt: TS,
    updatedAt: TS,
    ...(status === "succeeded" || status === "failed" || status === "interrupted"
      ? { finishedAt: TS }
      : {}),
  } as TaskRecord;
}

function fakeLifecycle(statuses: TaskStatus[]) {
  let now = 0;
  let reads = 0;
  const sleeps: number[] = [];
  return {
    dependencies: {
      readTask: () => makeTask("wait", statuses[Math.min(reads++, statuses.length - 1)]!),
      sleep: (milliseconds: number) => { sleeps.push(milliseconds); now += milliseconds; },
      now: () => now,
    },
    sleeps,
    readCount: () => reads,
  };
}

function withStore<T>(home: string, fn: (store: StateStore) => T): T {
  const store = new StateStore(home);
  try { return fn(store); } finally { store.close(); }
}

async function runCli(home: string, arguments_: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [
      "--disable-warning=ExperimentalWarning", "--import", "tsx",
      path.join(ROOT, "src/cli.ts"), ...arguments_,
    ], { cwd: ROOT, encoding: "utf8", env: { ...process.env, FORKLIGHT_HOME: home } },
    (error, stdout, stderr) => error
      ? reject(error)
      : resolve({ stdout: String(stdout), stderr: String(stderr) }));
  });
}

test("wait returns changed after one poll with caller timing", async () => {
  const fake = fakeLifecycle(["running", "verifying"]);
  const result = await waitForTask(
    { timeoutMs: 100, pollMs: 7, until: "change" }, fake.dependencies,
  );
  assert.deepEqual(
    { outcome: result.outcome, elapsedMs: result.elapsedMs, pollCount: result.pollCount, status: result.task.status },
    { outcome: "changed", elapsedMs: 7, pollCount: 1, status: "verifying" },
  );
  assert.deepEqual(fake.sleeps, [7]);
  assert.equal(fake.readCount(), 2);
});

test("terminal wait ignores intermediate changes and returns terminal", async () => {
  const fake = fakeLifecycle(["running", "verifying", "failed"]);
  const result = await waitForTask(
    { timeoutMs: 100, pollMs: 11, until: "terminal" }, fake.dependencies,
  );
  assert.equal(result.outcome, "terminal");
  assert.equal(result.task.status, "failed");
  assert.equal(result.elapsedMs, 22);
  assert.equal(result.pollCount, 2);
});

test("timeout uses a bounded final sleep and reports exact poll count", async () => {
  const fake = fakeLifecycle(["running"]);
  const result = await waitForTask(
    { timeoutMs: 25, pollMs: 10, until: "change" }, fake.dependencies,
  );
  assert.equal(result.outcome, "timeout");
  assert.equal(result.elapsedMs, 25);
  assert.equal(result.pollCount, 3);
  assert.deepEqual(fake.sleeps, [10, 10, 5]);
  assert.equal(fake.readCount(), 4);
});

test("initial terminal Task returns without sleeping", async () => {
  const fake = fakeLifecycle(["succeeded"]);
  const result = await waitForTask(
    { timeoutMs: 50, pollMs: 5, until: "change" }, fake.dependencies,
  );
  assert.equal(result.outcome, "terminal");
  assert.equal(result.elapsedMs, 0);
  assert.equal(result.pollCount, 0);
  assert.deepEqual(fake.sleeps, []);
  assert.match(humanWaitLines(result), /^outcome: terminal\nelapsedMs: 0\npollCount: 0\n/);
});

test("wait parsing honors overrides and derives omitted poll interval", () => {
  assert.deepEqual(parseWaitOptions(["--timeout-ms", "90"], 37), {
    timeoutMs: 90, pollMs: 37, until: "change", json: false,
  });
  assert.deepEqual(
    parseWaitOptions(["--poll-ms", "8", "--until", "terminal", "--json", "--timeout-ms", "90"], 37),
    { timeoutMs: 90, pollMs: 8, until: "terminal", json: true },
  );
});

test("supervision options reject missing, non-integer, zero, invalid, and ambiguous flags", () => {
  for (const arguments_ of [
    [], ["--timeout-ms", "0"], ["--timeout-ms", "1.5"],
    ["--timeout-ms", "5", "--poll-ms", "0"],
    ["--timeout-ms", "5", "--until", "done"],
    ["--timeout-ms"], ["--timeout-ms", "5", "--other"],
  ]) assert.throws(() => parseWaitOptions(arguments_, 10));
  assert.throws(() => parseInspectSummaryOptions(["--events", "2"], 4), /requires --summary/);
  assert.throws(() => parseInspectSummaryOptions(["--summary", "--events", "-1"], 4));
  assert.throws(() => parseInspectSummaryOptions(["--summary", "--events"], 4));
  assert.deepEqual(parseInspectSummaryOptions(["--summary", "--events", "0", "--json"], 4), {
    summary: true, eventLimit: 0, json: true,
  });
  assert.equal(parseInspectSummaryOptions(["--summary"], 6).eventLimit, 6);
});

test("compact inspection is allowlisted, latest-event bounded, and omits Diff content", () => {
  const task = makeTask("compact", "failed");
  const attempt = {
    id: "private-attempt-id", taskId: task.id, ordinal: 1, status: "failed",
    sessionId: "private-attempt-session", pid: 123, rawLogPath: "/private/raw.log",
    startedAt: TS, finishedAt: TS, exitCode: 9, turns: 4,
    resultText: "PRIVATE_RESULT_TEXT", error: "PRIVATE_RAW_ERROR", costUsd: 99,
    usage: {
      inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 2, cacheCreationInputTokens: 1,
      source: "terminal-result", complete: true, serviceTier: "standard",
      perModel: [{ model: "PRIVATE_MODEL_ARRAY", inputTokens: 1, outputTokens: 1,
        cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }],
    },
    runtimeCostEstimateUsd: 1.25,
    officialCost: {
      stage: "calculation", quoted: true,
      result: {
        quoted: true, currency: "USD", total: 0.125,
        components: [{ private: "PRIVATE_COMPONENT" }],
        pricing: { private: "PRIVATE_PRICING_SNAPSHOT" },
        appliedTier: { private: "PRIVATE_TIER" },
        usageSource: "terminal-result", providerBillClaim: false,
      },
    },
  } as unknown as AttemptRecord;
  const events = Array.from({ length: 5 }, (_, index) => ({
    id: index + 1, taskId: task.id, sequence: index + 1, timestamp: TS,
    type: "worker.message", summary: index === 4 ? "latest safe summary" : `OLD_PRIVATE_${index}`,
    payload: { private: "PRIVATE_EVENT_PAYLOAD" },
  })) as EventRecord[];
  const diff = "PRIVATE_DIFF_CONTENT\nsecond line\n";
  const compact = buildCompactInspection({ task, attempts: [attempt], events, diff, eventLimit: 1 });

  assert.equal(compact.events.length, 1);
  assert.equal(compact.events[0]!.sequence, 5);
  assert.deepEqual(compact.diff, {
    generated: true, utf8Bytes: Buffer.byteLength(diff, "utf8"), lineCount: 2,
  });
  assert.deepEqual(compact.attempts[0], {
    ordinal: 1, status: "failed", exitCode: 9, turns: 4,
    usage: { present: true, complete: true },
    runtimeEstimate: { present: true, valueUsd: 1.25 },
    officialCost: { present: true, stage: "calculation", quoted: true, total: 0.125, currency: "USD" },
  });
  const jsonOutput = `${JSON.stringify(compact, null, 2)}\n`;
  const humanOutput = humanCompactInspectionLines(compact);
  for (const privateValue of [
    "PRIVATE_RESULT_TEXT", "PRIVATE_RAW_ERROR", "/private/raw.log", "PRIVATE_MODEL_ARRAY",
    "PRIVATE_COMPONENT", "PRIVATE_PRICING_SNAPSHOT", "PRIVATE_EVENT_PAYLOAD", "PRIVATE_DIFF_CONTENT",
    "private outcome", "private command", "private-session-compact", "OLD_PRIVATE_0",
  ]) {
    assert.ok(!jsonOutput.includes(privateValue), privateValue);
    assert.ok(!humanOutput.includes(privateValue), privateValue);
  }
  assert.match(humanOutput, /events: 1/);
  assert.match(humanOutput, /latest safe summary/);
  assert.match(humanOutput, /diff: generated=true utf8Bytes=33 lineCount=2/);
});

test("compact unavailable official cost preserves typed stage and reason", () => {
  const task = makeTask("unavailable", "failed");
  const attempt = {
    id: "a", taskId: task.id, ordinal: 2, status: "failed", sessionId: "s",
    rawLogPath: "/private/log", startedAt: TS,
    officialCost: { stage: "pricing-identity", quoted: false, reason: "unsupported-model" },
  } as unknown as AttemptRecord;
  const compact = buildCompactInspection({ task, attempts: [attempt], events: [], diff: undefined, eventLimit: 3 });
  assert.deepEqual(compact.attempts[0]!.officialCost, {
    present: true, stage: "pricing-identity", quoted: false, reason: "unsupported-model",
  });
  assert.deepEqual(compact.diff, { generated: false, utf8Bytes: 0, lineCount: 0 });
});

test("CLI wait collapses internal polling into one final response and one receipt", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-supervision-wait-"));
  const task = makeTask("cli-wait", "running");
  withStore(home, (store) => store.createTask(task));
  const { stdout } = await runCli(home, [
    "wait", task.id, "--timeout-ms", "12", "--poll-ms", "4", "--json",
  ]);
  const result = JSON.parse(stdout) as Record<string, unknown>;
  assert.equal(result.outcome, "timeout");
  assert.equal((result.task as Record<string, unknown>).status, "running");
  assert.ok(Number(result.pollCount) >= 1);
  const receipts = withStore(home, (store) => store.listExchangeReceipts(task.id));
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]!.operation, "forklight_wait");
  assert.equal(receipts[0]!.responseContent!.utf8Bytes, Buffer.byteLength(stdout));
  assert.equal(receipts[0]!.responseStructured, undefined);
});

test("CLI inspect summary is bounded and legacy inspect/status JSON and human bytes stay unchanged", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-supervision-inspect-"));
  const diffPath = path.join(home, "result.diff");
  const task = {
    ...makeTask("cli-inspect", "failed"),
    paths: { ...makeTask("cli-inspect", "failed").paths, diff: diffPath },
  };
  const attempt = {
    id: "attempt-cli", taskId: task.id, ordinal: 1, status: "failed", sessionId: "private-session",
    rawLogPath: "/private/raw-cli.log", startedAt: TS, error: "PRIVATE_CLI_ERROR",
    resultText: "PRIVATE_CLI_RESULT", exitCode: 1,
  } as unknown as AttemptRecord;
  let events: EventRecord[] = [];
  withStore(home, (store) => {
    store.createTask(task);
    store.createAttempt(attempt);
    events = [
      store.addEvent(task.id, attempt.id, "worker.message", "older summary", { private: true }),
      store.addEvent(task.id, attempt.id, "worker.failed", "latest summary", { private: true }),
    ];
  });
  const diff = "PRIVATE_CLI_DIFF\n";
  await writeFile(diffPath, diff, "utf8");

  const summaryRun = await runCli(home, ["inspect", task.id, "--summary", "--events", "1", "--json"]);
  const summary = JSON.parse(summaryRun.stdout) as Record<string, any>;
  assert.equal(summary.events.length, 1);
  assert.equal(summary.events[0].summary, "latest summary");
  assert.equal(summary.diff.utf8Bytes, Buffer.byteLength(diff));
  for (const privateValue of ["PRIVATE_CLI_ERROR", "PRIVATE_CLI_RESULT", "/private/raw-cli.log", "PRIVATE_CLI_DIFF"])
    assert.ok(!summaryRun.stdout.includes(privateValue));

  const fullRun = await runCli(home, ["inspect", task.id, "--json"]);
  assert.equal(fullRun.stdout, `${JSON.stringify({ task, attempts: [attempt], events, diff }, null, 2)}\n`);
  const expectedHumanStatus = [
    `id: ${task.id}`,
    `name: ${task.name}`,
    `status: ${task.status}`,
    `provider: ${task.spec.provider.name}`,
    `model: ${task.spec.provider.model}`,
    `runtime: ${task.spec.runtime.name}`,
    `source: ${task.sourcePath}`,
    `workspace: ${task.paths.workspace}`,
    `sessionId: ${task.sessionId}`,
    `createdAt: ${task.createdAt}`,
    `finishedAt: ${task.finishedAt}`,
  ];
  const fullHumanRun = await runCli(home, ["inspect", task.id]);
  assert.equal(fullHumanRun.stdout, `${[
    ...expectedHumanStatus,
    "attempts: 1",
    "  #1 failed exit=1 cost=$- turns=-",
    "events:",
    "  1. worker.message — older summary",
    "  2. worker.failed — latest summary",
    `diff: ${diffPath} (1 lines)`,
  ].join("\n")}\n`);
  const statusRun = await runCli(home, ["status", task.id, "--json"]);
  const expectedStatus = {
    id: task.id, name: task.name, status: task.status,
    provider: task.spec.provider.name, model: task.spec.provider.model,
    runtime: task.spec.runtime.name, source: task.sourcePath, workspace: task.paths.workspace,
    sessionId: task.sessionId, createdAt: task.createdAt, startedAt: task.startedAt,
    finishedAt: task.finishedAt, error: task.error,
  };
  assert.equal(statusRun.stdout, `${JSON.stringify(expectedStatus, null, 2)}\n`);
  const statusHumanRun = await runCli(home, ["status", task.id]);
  assert.equal(statusHumanRun.stdout, `${expectedHumanStatus.join("\n")}\n`);

  const receipts = withStore(home, (store) => store.listExchangeReceipts(task.id));
  assert.equal(receipts.filter((receipt) => receipt.operation === "forklight_inspect").length, 3);
  assert.equal(receipts.filter((receipt) => receipt.operation === "forklight_status").length, 2);
  assert.ok(!JSON.stringify(receipts).includes("PRIVATE_CLI_DIFF"));
  assert.ok(!JSON.stringify(receipts).includes("latest summary"));
});
