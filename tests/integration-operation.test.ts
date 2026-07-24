import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { taskPaths } from "../src/core/config.js";
import { preflightIntegration } from "../src/core/integration.js";
import { recordMainReview } from "../src/core/main-review.js";
import { SettingsService } from "../src/core/settings.js";
import type {
  AttemptRecord,
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
