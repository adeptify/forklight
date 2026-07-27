import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { taskPaths } from "../src/core/config.js";
import { buildIntegrationOperationView, buildCompactIntegrationOperationView } from "../src/core/integration-operation.js";
import { preflightIntegration } from "../src/core/integration.js";
import { recordMainReview } from "../src/core/main-review.js";
import { SettingsService } from "../src/core/settings.js";
import type {
  AttemptRecord,
  IntegrationOperationView,
  IntegrationResultRecord,
  TaskRecord,
  TaskSpec,
  VerificationResult,
} from "../src/core/types.js";
import { DaemonCoordinator } from "../src/daemon/coordinator.js";
import { ForkLightDaemon } from "../src/daemon/server.js";
import { daemonRequest } from "../src/daemon/client.js";
import { StateStore } from "../src/state/store.js";
import { prepareWorkspace } from "../src/workspace/copy.js";
import { writeWorkspacePatchReport } from "../src/workspace/patch.js";
import { createPathPolicy } from "../src/workspace/path-policy.js";

async function operationFixture(): Promise<{
  home: string;
  source: string;
  store: StateStore;
  settings: SettingsService;
  coordinator: DaemonCoordinator;
  task: TaskRecord;
  receiptId: string;
}>;
async function operationFixture(delivery: TaskSpec["delivery"]): Promise<{
  home: string;
  source: string;
  store: StateStore;
  settings: SettingsService;
  coordinator: DaemonCoordinator;
  task: TaskRecord;
  receiptId: string;
}>;
async function operationFixture(delivery?: TaskSpec["delivery"]): Promise<{
  home: string;
  source: string;
  store: StateStore;
  settings: SettingsService;
  coordinator: DaemonCoordinator;
  task: TaskRecord;
  receiptId: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-int-operation-"));
  const source = path.join(root, "source");
  await mkdir(source);
  await writeFile(path.join(source, "value.txt"), "before\n");
  const spec: TaskSpec = {
    version: 1,
    name: "Async integration",
    project: source,
    goal: "Prove background integration",
    constraints: [],
    provider: {
      name: "deepseek",
      model: "deepseek-v4-flash",
      keychainService: "forklight.test",
    },
    runtime: {
      name: "claude-code",
      executable: "claude",
      effort: "low",
      maxBudgetUsd: null,
    },
    workspace: { exclude: [".git", "node_modules"] },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["value.txt"] },
    acceptance: {
      commands: [
        `node -e "setTimeout(() => process.exit(0), 150)"`,
      ],
    },
    ...(delivery === undefined ? {} : { delivery }),
  };
  const paths = taskPaths(root, "task-operation");
  await prepareWorkspace(spec, paths);
  await writeFile(path.join(paths.workspace, "value.txt"), "after\n");
  await writeWorkspacePatchReport(paths, createPathPolicy(spec));
  const now = new Date().toISOString();
  const task: TaskRecord = {
    id: "task-operation",
    name: spec.name,
    status: "succeeded",
    sourcePath: source,
    taskFile: "forklight://test/integration-operation",
    spec,
    paths,
    sessionId: "session-operation",
    currentAttemptId: "attempt-operation",
    createdAt: now,
    updatedAt: now,
  };
  const store = new StateStore(root);
  store.createTask(task);
  const attempt: AttemptRecord = {
    id: "attempt-operation",
    taskId: task.id,
    ordinal: 1,
    status: "succeeded",
    sessionId: task.sessionId,
    rawLogPath: path.join(paths.logs, "attempt.jsonl"),
    startedAt: now,
    finishedAt: now,
    exitCode: 0,
  };
  store.createAttempt(attempt);
  const verification: VerificationResult = {
    passed: true,
    behaviorPassed: true,
    policyPassed: true,
    sourceCompatible: true,
    commands: [],
    diffPath: paths.diff,
    sourceUnchanged: true,
  };
  store.addEvent(
    task.id,
    attempt.id,
    "verification.completed",
    "Independent verification passed",
    verification,
  );
  recordMainReview(store, task.id, {
    decision: "accept",
    reason: "Independent verification and reviewed Diff passed",
    confirm: true,
  });
  const settings = new SettingsService(store);
  const receipt = await preflightIntegration(store, task.id, settings.get().integration);
  assert.deepEqual(receipt.rejectionReasons, []);
  const coordinator = new DaemonCoordinator(store, settings, 0);
  return {
    home: root,
    source,
    store,
    settings,
    coordinator,
    task,
    receiptId: receipt.id,
  };
}

test("durable Integration results project truthful terminal statuses", async () => {
  const fixture = await operationFixture();
  const expectedStatuses = {
    applied: "completed",
    rejected: "failed",
    "retained-failure": "failed",
    "rolled-back": "failed",
  } as const satisfies Record<
    IntegrationResultRecord["status"],
    "completed" | "failed"
  >;
  try {
    for (const [resultStatus, operationStatus] of Object.entries(expectedStatuses) as Array<
      [IntegrationResultRecord["status"], "completed" | "failed"]
    >) {
      const operationId = `operation-${resultStatus}`;
      const stages: NonNullable<IntegrationResultRecord["stages"]> = resultStatus === "applied"
        ? [{ stage: "source-verified", status: "passed" }]
        : [{
          stage: "source-verified",
          status: "failed",
          error: `${resultStatus} verification evidence`,
        }];
      const result: IntegrationResultRecord = {
        id: operationId,
        receiptId: fixture.receiptId,
        taskId: fixture.task.id,
        status: resultStatus,
        stages,
        createdAt: new Date().toISOString(),
      };
      fixture.store.saveIntegrationResult(result);

      const view = buildIntegrationOperationView(fixture.store, {
        operationId,
        taskId: fixture.task.id,
        receiptId: fixture.receiptId,
      }, false);

      assert.equal(view.status, operationStatus);
      assert.deepEqual(view.result, result);
      assert.deepEqual(view.stages, stages);
    }
  } finally {
    await fixture.coordinator.shutdown();
    fixture.store.close();
  }
});

test("integration starts non-blocking and timeout remains outcome-unknown", async () => {
  const fixture = await operationFixture();
  try {
    const startedAt = performance.now();
    const started = fixture.coordinator.startIntegration(
      fixture.task.id,
      fixture.receiptId,
    );
    assert.equal(started.status, "running");
    assert.ok(performance.now() - startedAt < 100);

    const early = await fixture.coordinator.waitIntegration(started.operationId, 5);
    assert.equal(early.status, "outcome-unknown");
    assert.equal(fixture.store.listIntegrationResults(fixture.task.id).length, 0);

    const final = await fixture.coordinator.waitIntegration(started.operationId, 5_000);
    assert.equal(final.status, "completed");
    assert.equal(final.result?.status, "applied");
    assert.equal(final.result?.id, started.operationId);
    assert.equal(
      fixture.coordinator.integrationStatus(started.operationId).status,
      "completed",
    );
  } finally {
    await fixture.coordinator.shutdown();
    fixture.store.close();
  }
});

test("detached activation completes the durable Integration operation", async () => {
  const markerName = "runtime-ready.txt";
  const fixture = await operationFixture({
    buildCommands: ["node -e \"process.exit(0)\""],
    activationCommands: [
      `node -e 'setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(markerName)}, "ready"), 200)'`,
    ],
    activationCheckCommands: [`test -f ${markerName}`],
  });
  await fixture.coordinator.shutdown();
  fixture.store.close();

  const daemon = new ForkLightDaemon(fixture.home, 0);
  await daemon.start();
  try {
    const started = await daemonRequest<{
      operationId: string;
      status: string;
    }>(
      "integration_apply",
      {
        taskId: fixture.task.id,
        receiptId: fixture.receiptId,
        confirm: true,
      },
      fixture.home,
    );
    assert.equal(started.status, "running");
    const early = await daemonRequest<{ status: string }>(
      "integration_wait",
      { operationId: started.operationId, timeoutMs: 5 },
      fixture.home,
    );
    assert.equal(early.status, "outcome-unknown");

    const final = await daemonRequest<{
      status: string;
      stages: Array<{ stage: string; status: string }>;
      result: IntegrationResultRecord;
    }>(
      "integration_wait",
      { operationId: started.operationId, timeoutMs: 10_000 },
      fixture.home,
    );
    assert.equal(final.status, "completed");
    assert.equal(final.result.status, "applied");
    assert.deepEqual(
      final.stages.map(({ stage, status }) => [stage, status]),
      [
        ["source-applied", "passed"],
        ["source-verified", "passed"],
        ["artifact-built", "passed"],
        ["runtime-activated", "passed"],
      ],
    );
    assert.equal(
      await readFile(path.join(fixture.source, markerName), "utf8"),
      "ready",
    );
    const handoffDirectory = path.join(
      fixture.task.paths.root,
      "integration",
      fixture.receiptId,
    );
    assert.equal(
      (await readdir(handoffDirectory)).some((name) => name.startsWith("activation-")),
      false,
    );
  } finally {
    await daemon.close();
  }
});

// --- Compact Integration Operation View tests ---

function hugeText(length: number): string {
  return "x".repeat(length);
}

test("compact projection retains IDs, truthful statuses, stage aggregates, and terminal timestamps", () => {
  const view: IntegrationOperationView = {
    operationId: "op-1", taskId: "t-1", receiptId: "r-1", status: "completed",
    stages: [
      { stage: "source-applied", status: "passed", commands: [
        { command: "patch", exitCode: 0, stdout: "ok", stderr: "", durationMs: 120, timedOut: false },
      ]},
      { stage: "source-verified", status: "passed", commands: [
        { command: "check", exitCode: 0, stdout: "", stderr: "", durationMs: 45, timedOut: false },
        { command: "test", exitCode: 0, stdout: hugeText(50_000), stderr: hugeText(10_000), durationMs: 3_200, timedOut: false },
      ]},
      { stage: "artifact-built", status: "passed", commands: [
        { command: "build", exitCode: 0, stdout: hugeText(20_000), stderr: "", durationMs: 1_500, timedOut: false },
      ]},
    ],
    result: {
      id: "op-1", receiptId: "r-1", taskId: "t-1", status: "applied",
      backupDir: "/secret/backup", verificationCommands: [
        { command: "secret", exitCode: 0, stdout: "s-o", stderr: "s-e", durationMs: 1, timedOut: false },
      ],
      postApplyDigests: { "f": "sha256:deadbeef" }, rollbackFailures: ["rf"],
      appliedAt: "2026-07-26T10:00:00.000Z", createdAt: "2026-07-26T09:59:00.000Z",
    },
  };
  const compact = buildCompactIntegrationOperationView(view);

  assert.equal(compact.operationId, "op-1");
  assert.equal(compact.taskId, "t-1");
  assert.equal(compact.receiptId, "r-1");
  assert.equal(compact.status, "completed");
  assert.equal(compact.stages.length, 3);
  assert.deepEqual(
    compact.stages.map((s) => [s.stage, s.status, s.commandCount, s.failedCount]),
    [["source-applied", "passed", 1, 0], ["source-verified", "passed", 2, 0], ["artifact-built", "passed", 1, 0]],
  );
  assert.equal(compact.stages[1]!.totalDurationMs, 45 + 3_200);
  assert.equal(compact.result?.status, "applied");
  assert.equal(compact.result?.appliedAt, "2026-07-26T10:00:00.000Z");
  assert.equal(compact.result?.createdAt, "2026-07-26T09:59:00.000Z");

  // Raw payloads excluded
  const json = JSON.stringify(compact);
  assert.ok(!json.includes("secret"), "excludes command text");
  assert.ok(!json.includes("/secret/backup"), "excludes backup path");
  assert.ok(!json.includes("deadbeef"), "excludes digests");
  assert.ok(!json.includes("rf"), "excludes rollback details");
  assert.ok(!json.includes(hugeText(50_000).slice(0, 10)), "excludes huge stdout");
  const fullJson = JSON.stringify(view);
  assert.ok(json.length < fullJson.length, "compact is smaller than full");
  assert.ok(json.length < 5_000, `compact JSON bounded, got ${json.length}`);
});

test("compact projection preserves errors, truncates long errors, and handles edge statuses", () => {
  const longErr = "e".repeat(800);
  const view: IntegrationOperationView = {
    operationId: "op-err", taskId: "t-err", receiptId: "r-err", status: "failed",
    stages: [
      { stage: "source-applied", status: "passed", commands: [
        { command: "x", exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false },
      ]},
      { stage: "source-verified", status: "failed", error: longErr, commands: [
        { command: "x", exitCode: 1, stdout: "", stderr: "bad", durationMs: 30, timedOut: false },
      ]},
    ],
    result: {
      id: "op-err", receiptId: "r-err", taskId: "t-err", status: "rejected",
      error: longErr, createdAt: "2026-07-26T10:00:00.000Z",
    },
  };
  const compact = buildCompactIntegrationOperationView(view);

  assert.equal(compact.status, "failed");
  assert.equal(compact.stages[1]!.status, "failed");
  assert.equal(compact.stages[1]!.commandCount, 1);
  assert.equal(compact.stages[1]!.failedCount, 1);
  assert.equal(compact.result?.status, "rejected");

  // Errors are truncated to ERROR_BOUND
  assert.ok(compact.stages[1]!.error!.length <= 501, "stage error truncated");
  assert.ok(compact.stages[1]!.error!.endsWith("…"), "stage error ends with ellipsis");
  assert.ok(compact.result!.error!.endsWith("…"), "result error truncated");
  // Short errors pass through unchanged
  const shortView: IntegrationOperationView = {
    operationId: "op-short", taskId: "t-short", receiptId: "r-short", status: "failed",
    stages: [{ stage: "source-applied", status: "failed", error: "short err", commands: [] }],
    result: { id: "op-short", receiptId: "r-short", taskId: "t-short", status: "rejected",
      error: "short err", createdAt: "2026-07-26T10:00:00.000Z" },
  };
  const shortC = buildCompactIntegrationOperationView(shortView);
  assert.equal(shortC.stages[0]!.error, "short err");
  assert.equal(shortC.result?.error, "short err");
});

test("compact projection handles outcome-unknown, running, and is pure", () => {
  const unknown: IntegrationOperationView = {
    operationId: "op-u", taskId: "t-u", receiptId: "r-u", status: "outcome-unknown", stages: [],
  };
  const cu = buildCompactIntegrationOperationView(unknown);
  assert.equal(cu.status, "outcome-unknown");
  assert.equal(cu.stages.length, 0);
  assert.equal(cu.result, undefined);

  const running: IntegrationOperationView = {
    operationId: "op-r", taskId: "t-r", receiptId: "r-r", status: "running", stages: [],
  };
  const cr = buildCompactIntegrationOperationView(running);
  assert.equal(cr.status, "running");
  assert.equal(cr.result, undefined);

  // Pure: no mutation of input
  const view: IntegrationOperationView = {
    operationId: "op-pure", taskId: "t-pure", receiptId: "r-pure", status: "completed",
    stages: [{ stage: "source-verified", status: "passed", commands: [
      { command: "test", exitCode: 0, stdout: "out", stderr: "", durationMs: 500, timedOut: false },
    ]}],
    result: { id: "op-pure", receiptId: "r-pure", taskId: "t-pure", status: "applied",
      createdAt: "2026-07-26T10:00:00.000Z" },
  };
  const originalJson = JSON.stringify(view);
  const a = buildCompactIntegrationOperationView(view);
  const b = buildCompactIntegrationOperationView(view);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(view), originalJson, "view not mutated");
  assert.ok(!JSON.stringify(a).includes("test"), "compact excludes command text");
  assert.equal(JSON.stringify(view), originalJson, "full view byte-for-byte compatible");
});
