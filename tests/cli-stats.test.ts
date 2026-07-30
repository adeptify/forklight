/**
 * CLI stats detail pairing: compact JSON by default, full only with
 * --json --deep-audit, and --deep-audit without --json never fetches.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import type { TaskRecord } from "../src/core/types.js";
import { ForkLightDaemon } from "../src/daemon/server.js";
import { StateStore } from "../src/state/store.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function cliArgs(...args: string[]): string[] {
  return [
    "--disable-warning=ExperimentalWarning",
    "--import",
    "tsx",
    path.join(root, "src", "cli.ts"),
    ...args,
  ];
}

async function runCli(
  home: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const result = await execFileAsync(process.execPath, cliArgs(...args), {
      cwd: root,
      env: { ...process.env, FORKLIGHT_HOME: home },
      timeout: 20_000,
    });
    return { stdout: result.stdout, stderr: result.stderr, code: 0 };
  } catch (error: unknown) {
    const execError = error as {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      code: typeof execError.code === "number" ? execError.code : 1,
    };
  }
}

function seedFailedAndSucceeded(home: string): void {
  const store = new StateStore(home);
  const timestamp = new Date().toISOString();
  const succeeded: TaskRecord = {
    id: "cli-stats-ok",
    name: "cli stats ok",
    status: "succeeded",
    sourcePath: "/source",
    taskFile: "/task-ok.yaml",
    spec: { provider: { name: "deepseek", model: "v4" } } as TaskRecord["spec"],
    paths: {} as TaskRecord["paths"],
    sessionId: "cli-stats-ok-session",
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
  };
  store.createTask(succeeded);
  store.createAttempt({
    id: "cli-stats-ok-1",
    taskId: succeeded.id,
    ordinal: 1,
    status: "succeeded",
    sessionId: succeeded.sessionId,
    rawLogPath: "/log",
    startedAt: timestamp,
    finishedAt: timestamp,
    exitCode: 0,
    costUsd: 0.4,
    turns: 5,
  });
  const failed: TaskRecord = {
    id: "cli-stats-failed",
    name: "cli stats failed",
    status: "failed",
    sourcePath: "/source",
    taskFile: "/task-failed.yaml",
    spec: { provider: { name: "deepseek", model: "v4" } } as TaskRecord["spec"],
    paths: {} as TaskRecord["paths"],
    sessionId: "cli-stats-failed-session",
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
    error: "HTTP 401: CLI deep audit diagnostic",
  };
  store.createTask(failed);
  store.createAttempt({
    id: "cli-stats-failed-1",
    taskId: failed.id,
    ordinal: 1,
    status: "failed",
    sessionId: failed.sessionId,
    rawLogPath: "/log",
    startedAt: timestamp,
    finishedAt: timestamp,
    exitCode: 1,
    costUsd: 0.1,
    turns: 1,
  });
  store.close();
}

test("CLI stats --json is compact by default and --deep-audit returns full rows", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-stats-json-"));
  seedFailedAndSucceeded(home);
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const compact = await runCli(home, ["stats", "--json"]);
    assert.equal(compact.code, 0, compact.stderr);
    const compactBody = JSON.parse(compact.stdout) as Array<Record<string, unknown>>;
    assert.equal(compactBody.length, 1);
    assert.equal(compactBody[0]!.provider, "deepseek");
    assert.equal(compactBody[0]!.model, "v4");
    assert.equal(compactBody[0]!.sampleSize, 2);
    assert.equal(compactBody[0]!.successCount, 1);
    assert.deepEqual(compactBody[0]!.failureDistribution, { credential: 1 });
    assert.equal("failures" in compactBody[0]!, false);
    assert.doesNotMatch(
      compact.stdout,
      /"taskId"|"attemptId"|"diagnostic"|CLI deep audit diagnostic|cli-stats-failed/,
    );

    const full = await runCli(home, ["stats", "--json", "--deep-audit"]);
    assert.equal(full.code, 0, full.stderr);
    const fullBody = JSON.parse(full.stdout) as Array<Record<string, unknown>>;
    assert.equal(fullBody.length, 1);
    assert.equal(fullBody[0]!.sampleSize, compactBody[0]!.sampleSize);
    assert.equal(fullBody[0]!.successRate, compactBody[0]!.successRate);
    assert.deepEqual(fullBody[0]!.failureDistribution, compactBody[0]!.failureDistribution);
    const failures = fullBody[0]!.failures as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(failures));
    assert.equal(failures.length, 1);
    assert.equal(failures[0]!.taskId, "cli-stats-failed");
    assert.equal(failures[0]!.attemptId, "cli-stats-failed-1");
    assert.equal(failures[0]!.diagnostic, "HTTP 401: CLI deep audit diagnostic");
  } finally {
    await daemon.close();
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("CLI stats --deep-audit without --json is rejected before statistics fetch", async () => {
  // Isolated home with no daemon: a successful reject must not touch statistics.
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-stats-reject-"));
  try {
    const result = await runCli(home, ["stats", "--deep-audit"]);
    assert.notEqual(result.code, 0);
    assert.match(
      result.stderr,
      /stats --deep-audit requires --json/,
      "must reject the unpaired deep-audit flag",
    );
    assert.doesNotMatch(
      result.stderr,
      /daemon|socket|ECONNREFUSED|not running|statistics/i,
      "must fail before daemon contact or statistics fetch",
    );
    assert.equal(result.stdout.trim(), "");
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});
