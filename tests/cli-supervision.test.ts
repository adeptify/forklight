import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { AttemptRecord, EventRecord, TaskRecord, TaskStatus } from "../src/core/types.js";
import {
  buildCompactInspection,
  buildProgressCursor,
  buildStatusProgress,
  humanCompactInspectionLines,
  humanWaitLines,
  parseInspectSummaryOptions,
  parseWaitOptions,
  progressCursorKey,
  toLatestEventMeta,
  waitForTask,
  type LatestEventMeta,
  type TaskProgressSnapshot,
} from "../src/cli/supervision.js";
import { buildTaskSummary } from "../src/core/task-summary.js";
import { StateStore } from "../src/state/store.js";

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

function snapshotFor(
  status: TaskStatus,
  sequence: number,
  updatedAt = TS,
): TaskProgressSnapshot {
  const task = { ...makeTask("wait", status), updatedAt };
  const latestEvent: LatestEventMeta | undefined = sequence <= 0
    ? undefined
    : {
      sequence,
      timestamp: updatedAt,
      type: "worker.tool.completed",
      summary: `event-${sequence}`,
    };
  return {
    task,
    cursor: buildProgressCursor(task, latestEvent),
    ...(latestEvent === undefined ? {} : { latestEvent }),
  };
}

/** Sequence of progress snapshots; each read advances one step. */
function fakeLifecycle(steps: TaskProgressSnapshot[]) {
  let now = 0;
  let reads = 0;
  const sleeps: number[] = [];
  return {
    dependencies: {
      readProgress: () => steps[Math.min(reads++, steps.length - 1)]!,
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

test("wait returns changed after status change with caller timing", async () => {
  const fake = fakeLifecycle([
    snapshotFor("running", 1),
    snapshotFor("verifying", 1),
  ]);
  const result = await waitForTask(
    { timeoutMs: 100, pollMs: 7, until: "change" }, fake.dependencies,
  );
  assert.deepEqual(
    { outcome: result.outcome, elapsedMs: result.elapsedMs, pollCount: result.pollCount, status: result.task.status },
    { outcome: "changed", elapsedMs: 7, pollCount: 1, status: "verifying" },
  );
  assert.deepEqual(fake.sleeps, [7]);
  assert.equal(fake.readCount(), 2);
  assert.equal(result.progress.latestEventSequence, 1);
});

test("wait --until change fires when event sequence advances without status change (FL-D97/D111)", async () => {
  const fake = fakeLifecycle([
    snapshotFor("running", 10, TS),
    snapshotFor("running", 10, TS),
    snapshotFor("running", 51, TS), // events grew; status/updatedAt unchanged
  ]);
  const result = await waitForTask(
    { timeoutMs: 100, pollMs: 5, until: "change" }, fake.dependencies,
  );
  assert.equal(result.outcome, "changed");
  assert.equal(result.task.status, "running");
  assert.equal(result.progress.latestEventSequence, 51);
  assert.equal(result.pollCount, 2);
  assert.match(humanWaitLines(result), /latestEventSequence: 51/);
  assert.match(humanWaitLines(result), /activity: /);
});

test("wait does not treat identical cursor as change", async () => {
  const same = snapshotFor("running", 3, TS);
  const fake = fakeLifecycle([same, same, same, same]);
  const result = await waitForTask(
    { timeoutMs: 15, pollMs: 5, until: "change" }, fake.dependencies,
  );
  assert.equal(result.outcome, "timeout");
  assert.equal(result.progress.latestEventSequence, 3);
});

test("terminal wait ignores intermediate changes and returns terminal", async () => {
  const fake = fakeLifecycle([
    snapshotFor("running", 1),
    snapshotFor("verifying", 2),
    snapshotFor("failed", 3),
  ]);
  const result = await waitForTask(
    { timeoutMs: 100, pollMs: 11, until: "terminal" }, fake.dependencies,
  );
  assert.equal(result.outcome, "terminal");
  assert.equal(result.task.status, "failed");
  assert.equal(result.elapsedMs, 22);
  assert.equal(result.pollCount, 2);
});

test("timeout uses a bounded final sleep and reports exact poll count", async () => {
  const fake = fakeLifecycle([snapshotFor("running", 1)]);
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
  const fake = fakeLifecycle([snapshotFor("succeeded", 2)]);
  const result = await waitForTask(
    { timeoutMs: 50, pollMs: 5, until: "change" }, fake.dependencies,
  );
  assert.equal(result.outcome, "terminal");
  assert.equal(result.elapsedMs, 0);
  assert.equal(result.pollCount, 0);
  assert.deepEqual(fake.sleeps, []);
  assert.match(humanWaitLines(result), /^outcome: terminal\nelapsedMs: 0\npollCount: 0\n/);
  assert.equal(result.progress.activity, "terminal");
});

test("progress cursor key includes event sequence", () => {
  const a = buildProgressCursor(makeTask("a", "running"), {
    sequence: 1, timestamp: TS, type: "worker.message", summary: "x",
  });
  const b = buildProgressCursor(makeTask("a", "running"), {
    sequence: 2, timestamp: TS, type: "worker.message", summary: "y",
  });
  assert.notEqual(progressCursorKey(a), progressCursorKey(b));
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
  events.push({
    id: 99, taskId: task.id, sequence: 6, timestamp: TS,
    type: "verification.completed", summary: "Independent verification failed",
    payload: {
      passed: false,
      sourceUnchanged: true,
      commands: [{ command: "npm test", exitCode: 0 }],
      changeBudget: {
        filesChanged: 2, changedLines: 50, maxFiles: 1, maxDiffLines: 20, withinBudget: false,
      },
    },
  } as EventRecord);
  const diff = "PRIVATE_DIFF_CONTENT\nsecond line\n";
  const compact = buildCompactInspection({
    task, attempts: [attempt], events, diff, eventLimit: 1, nowMs: Date.parse(TS),
  });

  assert.equal(compact.events.length, 1);
  assert.equal(compact.events[0]!.sequence, 6);
  assert.deepEqual(compact.diff, {
    generated: true, utf8Bytes: Buffer.byteLength(diff, "utf8"), lineCount: 2,
  });
  assert.deepEqual(compact.attempts[0], {
    ordinal: 1, status: "failed", exitCode: 9, turns: 4,
    usage: { present: true, complete: true },
    runtimeEstimate: { present: true, valueUsd: 1.25 },
    officialCost: { present: true, stage: "calculation", quoted: true, total: 0.125, currency: "USD" },
  });
  assert.equal(compact.progress.latestEventSequence, 6);
  assert.equal(compact.verification.present, true);
  assert.equal(compact.verification.passed, false);
  assert.match(compact.verification.policyHint ?? "", /change_budget_exceeded/);
  assert.equal(compact.verification.behaviorHint, "commands_passed");
  assert.equal(compact.verification.sourceHint, "source_unchanged");
  assert.deepEqual(compact.lineage, {
    complete: false,
    missingAttemptIds: ["private-attempt-id"],
    attemptCount: 1,
    verifiedAttemptCount: 0,
    hopChurn: { filesChanged: 0, changedLines: 0 },
    combinedDeliveryDiff: { filesChanged: 0, changedLines: 0 },
    correctionAttemptIds: [],
  });
  const jsonOutput = `${JSON.stringify(compact, null, 2)}\n`;
  assert.doesNotMatch(jsonOutput, /PRIVATE_/);
  assert.match(humanCompactInspectionLines(compact), /verification: passed=false/);
});

test("store.latestEventMeta returns newest sequence without payload", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sup-"));
  withStore(home, (store) => {
    const task = makeTask("meta", "running");
    store.createTask(task);
    store.addEvent(task.id, undefined, "task.created", "created");
    store.addEvent(task.id, undefined, "worker.message", "hello", { secret: "nope" });
    const meta = store.latestEventMeta(task.id);
    assert.equal(meta?.sequence, 2);
    assert.equal(meta?.type, "worker.message");
    assert.equal(meta?.summary, "hello");
    assert.equal(store.latestEventMeta("missing"), undefined);
  });
});

// --- status reflects real Worker activity (FL-D83) ---

test("buildStatusProgress surfaces lastEventAt + activity for a running task (FL-D83)", () => {
  const task = makeTask("status-active", "running");
  const latestEvent: LatestEventMeta = {
    sequence: 42,
    timestamp: "2026-07-23T12:00:00.000Z",
    type: "worker.tool.completed",
    summary: "edited file.ts",
  };
  const nowMs = Date.parse("2026-07-23T12:00:05.000Z"); // 5s after the event
  const progress = buildStatusProgress(task, latestEvent, nowMs, 30_000);
  assert.equal(progress.activity, "active");
  assert.equal(progress.latestEventSequence, 42);
  assert.equal(progress.lastEventAt, "2026-07-23T12:00:00.000Z");
  assert.equal(progress.latestAction, "edited file.ts");
});

test("buildStatusProgress marks a stale event quiet and a terminal task terminal (FL-D83)", () => {
  const running = makeTask("status-quiet", "running");
  const latestEvent: LatestEventMeta = {
    sequence: 1,
    timestamp: "2026-07-23T12:00:00.000Z",
    type: "worker.message",
    summary: "thinking",
  };
  const stale = Date.parse("2026-07-23T12:05:00.000Z"); // 5 min later
  assert.equal(buildStatusProgress(running, latestEvent, stale, 30_000).activity, "quiet");
  const terminal = makeTask("status-terminal", "failed");
  assert.equal(buildStatusProgress(terminal, latestEvent, stale, 30_000).activity, "terminal");
});

test("buildStatusProgress with no events is quiet, not terminal, for a running task (FL-D83)", () => {
  const task = makeTask("status-noevents", "running");
  const progress = buildStatusProgress(task, undefined, Date.parse(TS), 30_000);
  assert.equal(progress.activity, "quiet");
  assert.equal(progress.latestEventSequence, 0);
  assert.equal(progress.lastEventAt, undefined);
});

test("status progress reads the real latest event from the store (FL-D83)", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sup-"));
  withStore(home, (store) => {
    const task = makeTask("status-store", "running");
    store.createTask(task);
    store.addEvent(task.id, undefined, "task.created", "created");
    store.addEvent(task.id, undefined, "worker.tool.completed", "edited file.ts");
    const meta = store.latestEventMeta(task.id);
    assert.ok(meta, "latest event should exist");
    const latestEvent: LatestEventMeta | undefined = meta === undefined
      ? undefined
      : { sequence: meta.sequence, timestamp: meta.timestamp, type: meta.type, summary: meta.summary };
    const progress = buildStatusProgress(task, latestEvent, Date.parse(meta!.timestamp), 30_000);
    assert.equal(progress.lastEventAt, meta!.timestamp);
    assert.equal(progress.activity, "active");
    assert.equal(progress.latestAction, "edited file.ts");
    assert.equal(progress.latestEventSequence, 2);
  });
});

test("buildTaskSummary carries progress and keeps the frozen updatedAt (FL-D83)", () => {
  const task = makeTask("status-summary", "running");
  const latestEvent: LatestEventMeta = {
    sequence: 7,
    timestamp: "2026-07-23T12:00:00.000Z",
    type: "worker.message",
    summary: "thinking",
  };
  const progress = buildStatusProgress(task, latestEvent, Date.parse(TS), 30_000);
  const summary = buildTaskSummary(task, progress);
  assert.equal(summary.updatedAt, task.updatedAt);
  assert.equal(summary.progress?.lastEventAt, "2026-07-23T12:00:00.000Z");
  assert.equal(summary.progress?.activity, "active");
});

test("status list-style summary from store mirrors CLI status path with frozen updatedAt (FL-D83)", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sup-"));
  withStore(home, (store) => {
    // Spawn-time updatedAt stays frozen; only events advance.
    const frozenAt = "2026-07-23T11:00:00.000Z";
    const task = { ...makeTask("status-cli-path", "running"), updatedAt: frozenAt, createdAt: frozenAt };
    store.createTask(task);
    store.addEvent(task.id, undefined, "task.created", "queued");
    store.addEvent(task.id, undefined, "worker.tool.completed", "edited file.ts");
    const latestEvent = toLatestEventMeta(store.latestEventMeta(task.id));
    assert.ok(latestEvent);
    const nowMs = Date.parse(latestEvent!.timestamp) + 5_000;
    const progress = buildStatusProgress(task, latestEvent, nowMs, 30_000);
    const summary = buildTaskSummary(task, progress);
    assert.equal(summary.updatedAt, frozenAt);
    assert.notEqual(summary.progress?.lastEventAt, frozenAt);
    assert.equal(summary.progress?.activity, "active");
    assert.equal(summary.progress?.latestEventSequence, 2);
    assert.equal(summary.progress?.latestAction, "edited file.ts");
    // Same shape MCP status spreads into structuredContent via decision.progress.
    assert.equal(typeof summary.progress?.lastEventAt, "string");
  });
});

test("compact inspection handles absent verification and empty diff", () => {
  const task = makeTask("empty", "running");
  const attempt = {
    id: "a", taskId: task.id, ordinal: 1, status: "running",
    sessionId: "s", rawLogPath: "/p", startedAt: TS,
  } as AttemptRecord;
  const compact = buildCompactInspection({
    task, attempts: [attempt], events: [], diff: undefined, eventLimit: 3, nowMs: Date.parse(TS),
  });
  assert.equal(compact.verification.present, false);
  assert.equal(compact.diff.generated, false);
  assert.equal(compact.progress.latestEventSequence, 0);
});

test("compact inspection exposes authority without raw claim or verification payloads", () => {
  const task = makeTask("decision", "failed");
  const events = [
    {
      id: 1,
      taskId: task.id,
      sequence: 1,
      timestamp: TS,
      type: "worker.completed",
      summary: "Worker reported completion",
      payload: {
        claim: { label: "unverified-claim", text: "All tests pass" },
        private: "DO_NOT_SURFACE",
      },
    },
    {
      id: 2,
      taskId: task.id,
      sequence: 2,
      timestamp: TS,
      type: "verification.completed",
      summary: "Independent verification failed",
      payload: {
        passed: false,
        behaviorPassed: false,
        policyPassed: true,
        sourceCompatible: true,
        commands: [{
          command: "npm test",
          exitCode: 1,
          stdout: "",
          stderr: "failure",
          durationMs: 1,
          timedOut: false,
        }],
        diffPath: task.paths.diff,
        sourceUnchanged: true,
        private: "DO_NOT_SURFACE",
      },
    },
  ] as EventRecord[];
  const compact = buildCompactInspection({
    task,
    attempts: [],
    events,
    diff: undefined,
    eventLimit: 0,
  });
  assert.equal(compact.decision.stage, "machine-failed");
  assert.equal(compact.decision.workerClaim?.label, "unverified-claim");
  assert.equal(compact.decision.verification?.behaviorPassed, false);
  assert.equal(
    compact.decision.nextAction,
    "Review remediation and decide whether to resume",
  );
  assert.doesNotMatch(JSON.stringify(compact), /DO_NOT_SURFACE/);
});
