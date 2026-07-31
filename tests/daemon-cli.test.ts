import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { currentBuildIdentity } from "../src/core/build-identity.js";
import { daemonSocketPath } from "../src/core/config.js";
import { sleepMs as sleep } from "../src/core/time.js";
import { SELF_UPGRADE_DELIVERY_PROFILE_ID } from "../src/core/self-upgrade-evidence.js";
import type {
  DeliveryPlanView,
  IntegrationReceiptRecord,
  IntegrationResultRecord,
  TaskRecord,
} from "../src/core/types.js";
import {
  DAEMON_OBSERVER_UNAVAILABLE_MESSAGE,
  daemonObserverRequest,
  isDaemonTransportUnavailable,
  restartDaemon,
  stopDaemon,
} from "../src/daemon/client.js";
import { ForkLightDaemon } from "../src/daemon/server.js";
import { StateStore } from "../src/state/store.js";
import { DetachedDaemonFixture, probeSocketAlive } from "./helpers/detached-daemon.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// --- Running daemon restart ---

test("restart replaces a running daemon: old PID gone, new PID different, build identity matches", async () => {
  const fixture = await DetachedDaemonFixture.create("forklight-restart-running-");
  try {
    const firstHealth = await fixture.ensureReady();
    const firstPid = firstHealth.pid as number;
    assert.ok(Number.isSafeInteger(firstPid) && firstPid > 0, "first daemon must report a valid PID");
    assert.deepEqual(
      firstHealth.buildIdentity,
      currentBuildIdentity(),
      "first daemon build identity must match client",
    );

    const replacementHealth = await restartDaemon(fixture.home);
    const replacementPid = replacementHealth.pid as number;
    assert.ok(
      Number.isSafeInteger(replacementPid) && replacementPid > 0,
      "replacement daemon must report a valid PID",
    );
    // Register cleanup authority before any later assertion can abort the test.
    await fixture.adoptReplacement(replacementPid);
    assert.notEqual(
      replacementPid,
      firstPid,
      "replacement must have a different PID from the original",
    );
    assert.deepEqual(
      replacementHealth.buildIdentity,
      currentBuildIdentity(),
      "replacement daemon build identity must match client",
    );
    assert.throws(
      () => process.kill(firstPid, 0),
      /ESRCH/,
      "original daemon PID must be gone after restart",
    );
  } finally {
    await fixture.cleanup();
  }
});

// --- Stopped daemon restart ---

test("restart starts a daemon when none is running", async () => {
  const fixture = await DetachedDaemonFixture.create("forklight-restart-stopped-");
  try {
    // Verify no daemon is running on the fresh home.
    const stopResult = await stopDaemon(fixture.home);
    assert.equal(
      stopResult.stopped,
      true,
      "fresh home must report no running daemon",
    );

    const health = await restartDaemon(fixture.home);
    const pid = health.pid as number;
    assert.ok(Number.isSafeInteger(pid) && pid > 0, "restart must start a daemon and report its PID");
    assert.equal(health.ok, true, "restarted daemon health must report ok");
    assert.deepEqual(
      health.buildIdentity,
      currentBuildIdentity(),
      "restarted daemon build identity must match client",
    );

    // And we can also register the PID in the fixture so cleanup handles it.
    // The fixture's tracked set already includes the PID from startDaemonProcess
    // inside ensureDaemon, but restartDaemon spawns through ensureDaemon which
    // calls startDaemonProcess — and the fixture cannot automatically track it.
    // We must stop it ourselves so cleanup does not leak.
    await stopDaemon(fixture.home);
  } finally {
    await fixture.cleanup();
  }
});

// --- Unknown daemon operation stays rejected ---

function cliArgs(...args: string[]): string[] {
  return [
    "--disable-warning=ExperimentalWarning",
    "--import",
    "tsx",
    path.join(root, "src", "cli.ts"),
    ...args,
  ];
}

test("unknown daemon operations are rejected with the existing error", async () => {
  const { stderr } = await execFileAsync(
    process.execPath,
    cliArgs("daemon", "force-restart"),
    { cwd: root, timeout: 15_000 },
  ).catch((error: unknown) => {
    // execFile rejects when exitCode !== 0 — capture stdout/stderr from the error.
    const execError = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      code: execError.code ?? 1,
    };
  });
  assert.match(
    stderr,
    /Unknown daemon operation: force-restart/,
    "unknown daemon operation must produce the canonical error message",
  );
});

test("daemon start/restart reject invalid --startup-timeout-ms before lifecycle mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-daemon-startup-timeout-cli-"));
  try {
    for (const operation of ["start", "restart"] as const) {
      const result = await runCli(home, [
        "daemon", operation, "--startup-timeout-ms", "0",
      ]);
      assert.notEqual(result.code, 0, `${operation} must reject timeout 0`);
      assert.match(
        result.stderr,
        /Daemon startup timeout must be an integer from 1000 to 600000/,
      );
      assert.equal(
        existsSync(daemonSocketPath(home)),
        false,
        `${operation} must not create a socket when timeout validation fails`,
      );
      assert.equal(
        existsSync(path.join(home, "daemon.log")),
        false,
        `${operation} must not spawn a daemon when timeout validation fails`,
      );
    }
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("daemon restart CLI prints JSON health to stdout", async () => {
  const fixture = await DetachedDaemonFixture.create("forklight-restart-cli-json-");
  try {
    // Ensure a running daemon first so restart has something to replace.
    const firstHealth = await fixture.ensureReady();
    const firstPid = firstHealth.pid as number;
    assert.ok(Number.isSafeInteger(firstPid) && firstPid > 0);

    const { stdout } = await execFileAsync(
      process.execPath,
      cliArgs("daemon", "restart"),
      { cwd: root, env: { ...process.env, FORKLIGHT_HOME: fixture.home }, timeout: 15_000 },
    );
    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    const replacementPid = parsed.pid as number;
    assert.ok(
      Number.isSafeInteger(replacementPid) && replacementPid > 0,
      "CLI restart must print JSON with a valid PID",
    );
    assert.notEqual(
      replacementPid,
      firstPid,
      "CLI restart must replace the old PID with a new one",
    );
    assert.equal(parsed.ok, true, "CLI restart health must report ok");
    assert.deepEqual(
      parsed.buildIdentity,
      currentBuildIdentity(),
      "CLI restart health build identity must match client",
    );
    assert.throws(
      () => process.kill(firstPid, 0),
      /ESRCH/,
      "original daemon PID must be gone after CLI restart",
    );
  } finally {
    await stopDaemon(fixture.home).catch(() => undefined);
    await fixture.cleanup();
  }
});

test("daemon restart CLI starts a daemon when none is running", async () => {
  const fixture = await DetachedDaemonFixture.create("forklight-restart-cli-stopped-");
  try {
    // Verify no running daemon.
    const stopResult = await stopDaemon(fixture.home);
    assert.equal(stopResult.stopped, true);

    const { stdout } = await execFileAsync(
      process.execPath,
      cliArgs("daemon", "restart"),
      { cwd: root, env: { ...process.env, FORKLIGHT_HOME: fixture.home }, timeout: 15_000 },
    );
    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    const pid = parsed.pid as number;
    assert.ok(
      Number.isSafeInteger(pid) && pid > 0,
      "CLI restart on a stopped home must start a daemon and report its PID",
    );
    assert.equal(parsed.ok, true, "CLI restart health must report ok");
    assert.deepEqual(
      parsed.buildIdentity,
      currentBuildIdentity(),
      "CLI restart build identity must match client",
    );
  } finally {
    await stopDaemon(fixture.home).catch(() => undefined);
    await fixture.cleanup();
  }
});

// --- Integration observation: never starts a missing daemon ---

async function runCli(
  home: string,
  args: string[],
  timeoutMs = 10_000,
): Promise<{ stdout: string; stderr: string; code: number; elapsedMs: number }> {
  const started = Date.now();
  try {
    const result = await execFileAsync(process.execPath, cliArgs(...args), {
      cwd: root,
      env: { ...process.env, FORKLIGHT_HOME: home },
      timeout: timeoutMs,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      code: 0,
      elapsedMs: Date.now() - started,
    };
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
      elapsedMs: Date.now() - started,
    };
  }
}

function assertObserverUnavailableGuidance(stderr: string, home: string): void {
  assert.match(
    stderr,
    new RegExp(DAEMON_OBSERVER_UNAVAILABLE_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "observer must emit bounded transition/stopped guidance",
  );
  assert.match(stderr, /never starts a daemon/i);
  assert.match(stderr, /Retry the same observation/i);
  assert.doesNotMatch(
    stderr,
    new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "observer error must not expose the isolated home path",
  );
  assert.doesNotMatch(
    stderr,
    /forklight\.sock|ECONNREFUSED|ENOENT|ECONNRESET|EPIPE|socket path/i,
    "observer error must not expose private transport details",
  );
}

async function assertEndpointRemainsAbsent(home: string): Promise<void> {
  // Bounded grace: a leaked ensureDaemon spawn would create a socket within
  // a few hundred ms; wait longer than that bootstrap window.
  await sleep(400);
  assert.equal(
    existsSync(daemonSocketPath(home)),
    false,
    "observation must not create a daemon socket",
  );
  assert.equal(
    await probeSocketAlive(home),
    false,
    "observation must leave the endpoint unreachable",
  );
  assert.equal(
    existsSync(path.join(home, "daemon.log")),
    false,
    "observation must not spawn a detached daemon (no daemon.log)",
  );
}

test("isDaemonTransportUnavailable classifies socket gaps and leaves business errors alone", () => {
  const refused = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  assert.equal(isDaemonTransportUnavailable(refused), true);
  assert.equal(
    isDaemonTransportUnavailable(new Error("Unknown Integration operation: op-x")),
    false,
  );
  assert.equal(
    isDaemonTransportUnavailable(new Error("Unknown ForkLight task: task-x")),
    false,
  );
});

test("daemonObserverRequest never starts a daemon and normalizes transport gaps", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-observer-unit-"));
  try {
    await assert.rejects(
      () => daemonObserverRequest("integration_status", { operationId: "op-absent" }, home),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, DAEMON_OBSERVER_UNAVAILABLE_MESSAGE);
        assert.ok(error.cause instanceof Error, "original transport error retained as cause");
        return true;
      },
    );
    await assertEndpointRemainsAbsent(home);
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("Integration status/wait/history on a fresh home never start a daemon", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-int-observer-absent-"));
  try {
    const cases: Array<{ args: string[]; label: string }> = [
      { label: "status", args: ["integration", "status", "op-absent-status"] },
      {
        label: "wait",
        args: ["integration", "wait", "op-absent-wait", "--timeout-ms", "1000"],
      },
      { label: "history", args: ["integration", "history", "task-absent-history"] },
    ];
    for (const { args, label } of cases) {
      const result = await runCli(home, args);
      assert.notEqual(result.code, 0, `${label} must fail when no daemon is running`);
      assertObserverUnavailableGuidance(result.stderr, home);
      assert.ok(
        result.elapsedMs < 3_000,
        `${label} must fail fast without ensureDaemon bootstrap wait (elapsed ${result.elapsedMs}ms)`,
      );
    }
    await assertEndpointRemainsAbsent(home);
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("Integration wait validates timeout before any daemon contact", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-int-observer-timeout-"));
  try {
    const result = await runCli(home, [
      "integration", "wait", "op-x", "--timeout-ms", "0",
    ]);
    assert.notEqual(result.code, 0);
    assert.match(
      result.stderr,
      /Integration wait timeout must be an integer from 1 to 3600000/,
    );
    assert.doesNotMatch(result.stderr, /unavailable for observation|never starts a daemon/i);
    await assertEndpointRemainsAbsent(home);
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

function seedCompletedIntegration(home: string): {
  taskId: string;
  operationId: string;
  receiptId: string;
} {
  const store = new StateStore(home);
  const timestamp = "2026-07-30T12:00:00.000Z";
  const taskId = "task-observer-active";
  const operationId = "op-observer-active";
  const receiptId = "receipt-observer-active";
  const task: TaskRecord = {
    id: taskId,
    name: "observer active",
    status: "succeeded",
    sourcePath: "/source",
    taskFile: "/task-observer.yaml",
    spec: { provider: { name: "deepseek", model: "v4" } } as TaskRecord["spec"],
    paths: {} as TaskRecord["paths"],
    sessionId: "session-observer",
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
  };
  store.createTask(task);
  // Results FK to preflight receipts; persist the matching receipt first.
  const receipt: IntegrationReceiptRecord = {
    id: receiptId,
    taskId,
    patchDigest: "a".repeat(64),
    affectedFiles: ["value.txt"],
    rejectionReasons: [],
    sourceEvidence: {},
    createdAt: timestamp,
    expiresAt: "2026-07-30T13:00:00.000Z",
    consumed: true,
  };
  store.saveIntegrationReceipt(receipt);
  const result: IntegrationResultRecord = {
    id: operationId,
    receiptId,
    taskId,
    status: "applied",
    appliedAt: timestamp,
    createdAt: timestamp,
    stages: [
      { stage: "source-applied", status: "passed" },
      { stage: "source-verified", status: "passed" },
      { stage: "artifact-built", status: "not-applicable" },
      { stage: "runtime-activated", status: "not-applicable" },
    ],
  };
  store.saveIntegrationResult(result);
  store.close();
  return { taskId, operationId, receiptId };
}

function seedCliTaskSurfaceEvidence(home: string): {
  deliveredTaskId: string;
  repairedTaskId: string;
  awaitingTaskId: string;
} {
  const store = new StateStore(home);
  const timestamp = "2026-07-31T03:30:00.000Z";
  const paths = {
    root: "/state/task",
    baseline: "/state/task/baseline",
    workspace: "/state/task/workspace",
    logs: "/state/task/logs",
    claudeConfig: "/state/task/claude",
    diff: "/state/task/diff.patch",
  };
  const task = (id: string, status: TaskRecord["status"]): TaskRecord => ({
    id,
    name: id,
    status,
    sourcePath: "/source",
    taskFile: `/task-${id}.yaml`,
    spec: {
      provider: { name: "deepseek", model: "deepseek-v4-pro[1M]" },
      runtime: { name: "claude-code" },
    } as TaskRecord["spec"],
    paths,
    sessionId: `session-${id}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
  });

  const deliveredTaskId = "cli-surface-delivered";
  const operationId = "cli-surface-operation";
  const receiptId = "cli-surface-receipt";
  store.createTask(task(deliveredTaskId, "succeeded"));
  store.addEvent(
    deliveredTaskId,
    undefined,
    "integration.operation.started",
    "integration started",
    { operationId, taskId: deliveredTaskId, receiptId },
  );
  store.saveIntegrationReceipt({
    id: receiptId,
    taskId: deliveredTaskId,
    patchDigest: "d".repeat(64),
    affectedFiles: ["src/cli.ts"],
    rejectionReasons: [],
    sourceEvidence: {},
    createdAt: timestamp,
    expiresAt: "2099-01-01T00:00:00.000Z",
    consumed: true,
  });
  store.saveIntegrationResult({
    id: operationId,
    receiptId,
    taskId: deliveredTaskId,
    status: "applied",
    appliedAt: timestamp,
    createdAt: timestamp,
    stages: [
      { stage: "source-applied", status: "passed" },
      { stage: "source-verified", status: "passed" },
      { stage: "artifact-built", status: "not-applicable" },
      { stage: "runtime-activated", status: "not-applicable" },
    ],
  });

  const repairedTaskId = "cli-surface-repaired";
  store.createTask(task(repairedTaskId, "failed"));
  store.saveRemediationDisposition(repairedTaskId, {
    status: "verified-repaired-delivered",
    checkId: "cli-surface-remediation",
    createdAt: timestamp,
  });

  const awaitingTaskId = "cli-surface-awaiting";
  store.createTask(task(awaitingTaskId, "succeeded"));
  store.addEvent(awaitingTaskId, undefined, "verification.completed", "verification passed", {
    passed: true,
    behaviorPassed: true,
    policyPassed: true,
    sourceCompatible: true,
    commands: [],
    diffPath: paths.diff,
    sourceUnchanged: false,
  });
  store.close();
  return { deliveredTaskId, repairedTaskId, awaitingTaskId };
}

test("CLI status/list preserve canonical Main, remediation, and Integration placement", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-task-surface-"));
  const seeded = seedCliTaskSurfaceEvidence(home);
  try {
    const status = await runCli(home, ["status", seeded.deliveredTaskId, "--json"]);
    assert.equal(status.code, 0, status.stderr);
    const statusBody = JSON.parse(status.stdout) as Record<string, unknown>;
    assert.equal(statusBody.decisionStage, "delivered");
    assert.equal(statusBody.boardScope, "history");
    assert.equal(statusBody.boardReason, "delivered");

    const list = await runCli(home, ["list", "--json"]);
    assert.equal(list.code, 0, list.stderr);
    const rows = JSON.parse(list.stdout) as Array<Record<string, unknown>>;
    const byId = new Map(rows.map((row) => [row.taskId, row]));
    assert.deepEqual(
      [
        byId.get(seeded.deliveredTaskId)?.decisionStage,
        byId.get(seeded.deliveredTaskId)?.boardScope,
        byId.get(seeded.deliveredTaskId)?.boardReason,
      ],
      ["delivered", "history", "delivered"],
    );
    assert.deepEqual(
      [
        byId.get(seeded.repairedTaskId)?.boardScope,
        byId.get(seeded.repairedTaskId)?.boardReason,
      ],
      ["history", "repaired-delivered"],
    );
    assert.deepEqual(
      [
        byId.get(seeded.awaitingTaskId)?.decisionStage,
        byId.get(seeded.awaitingTaskId)?.boardScope,
        byId.get(seeded.awaitingTaskId)?.boardReason,
      ],
      ["awaiting-main-review", "now", "awaiting-main"],
    );
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("Integration status/history/wait succeed against an existing daemon without lifecycle mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-int-observer-active-"));
  const seeded = seedCompletedIntegration(home);
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const status = await runCli(home, [
      "integration", "status", seeded.operationId, "--json",
    ]);
    assert.equal(status.code, 0, status.stderr);
    const statusBody = JSON.parse(status.stdout) as Record<string, unknown>;
    assert.equal(statusBody.operationId, seeded.operationId);
    assert.equal(statusBody.taskId, seeded.taskId);
    assert.equal(statusBody.receiptId, seeded.receiptId);
    assert.equal(statusBody.status, "completed");
    assert.ok(Array.isArray(statusBody.stages));
    // Compact default: no full command streams.
    assert.doesNotMatch(status.stdout, /"commands"/);

    const deep = await runCli(home, [
      "integration", "status", seeded.operationId, "--json", "--deep-audit",
    ]);
    assert.equal(deep.code, 0, deep.stderr);
    const deepBody = JSON.parse(deep.stdout) as Record<string, unknown>;
    assert.equal(deepBody.operationId, seeded.operationId);
    assert.equal(deepBody.status, "completed");
    assert.ok(deepBody.result !== undefined, "deep-audit retains the result snapshot");

    const history = await runCli(home, [
      "integration", "history", seeded.taskId, "--json",
    ]);
    assert.equal(history.code, 0, history.stderr);
    const historyBody = JSON.parse(history.stdout) as {
      receipts: unknown[];
      results: Array<Record<string, unknown>>;
    };
    assert.ok(Array.isArray(historyBody.receipts));
    assert.equal(historyBody.results.length, 1);
    assert.equal(historyBody.results[0]!.id, seeded.operationId);
    assert.equal(historyBody.results[0]!.status, "applied");

    const waitStarted = Date.now();
    const wait = await runCli(home, [
      "integration", "wait", seeded.operationId, "--timeout-ms", "2000", "--json",
    ]);
    const waitElapsed = Date.now() - waitStarted;
    assert.equal(wait.code, 0, wait.stderr);
    const waitBody = JSON.parse(wait.stdout) as Record<string, unknown>;
    assert.equal(waitBody.operationId, seeded.operationId);
    assert.equal(waitBody.status, "completed");
    assert.ok(
      waitElapsed < 1_500,
      `completed wait must return promptly (elapsed ${waitElapsed}ms), not hang on timeout`,
    );
  } finally {
    await daemon.close();
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

function selfUpgradeDeliveryPlan(): DeliveryPlanView {
  return {
    resolutionSource: "explicit",
    profileId: SELF_UPGRADE_DELIVERY_PROFILE_ID,
    buildCommandCount: 1,
    activationCommandCount: 1,
    activationCheckCommandCount: 1,
    outcome: "activation",
    stages: {
      sourceApply: "required",
      sourceVerify: "required",
      artifactBuild: "required",
      runtimeActivation: "required",
    },
  };
}

function ordinaryDeliveryPlan(): DeliveryPlanView {
  return {
    resolutionSource: "inline",
    buildCommandCount: 0,
    activationCommandCount: 0,
    activationCheckCommandCount: 0,
    outcome: "source-only",
    stages: {
      sourceApply: "required",
      sourceVerify: "required",
      artifactBuild: "not-configured",
      runtimeActivation: "not-configured",
    },
  };
}

function seedSelfUpgradePair(home: string): void {
  const store = new StateStore(home);
  const four = [
    { stage: "source-applied" as const, status: "passed" as const },
    { stage: "source-verified" as const, status: "passed" as const },
    { stage: "artifact-built" as const, status: "passed" as const },
    { stage: "runtime-activated" as const, status: "passed" as const },
  ];
  const TS_OK = "2026-07-30T12:00:00.000Z";
  const TS_FAIL = "2026-07-30T11:00:00.000Z";
  for (const [taskId, ts] of [
    ["task-sue-ok", TS_OK],
    ["task-sue-fail", TS_FAIL],
  ] as const) {
    store.createTask({
      id: taskId,
      name: taskId,
      status: "succeeded",
      sourcePath: "/source",
      taskFile: `/task-${taskId}.yaml`,
      spec: { provider: { name: "deepseek", model: "v4" } } as TaskRecord["spec"],
      paths: {} as TaskRecord["paths"],
      sessionId: `session-${taskId}`,
      createdAt: ts,
      updatedAt: ts,
    });
  }
  store.saveIntegrationReceipt({
    id: "receipt-sue-ok",
    taskId: "task-sue-ok",
    patchDigest: "a".repeat(64),
    affectedFiles: ["value.txt"],
    rejectionReasons: [],
    sourceEvidence: {},
    createdAt: TS_OK,
    expiresAt: "2099-01-01T00:00:00.000Z",
    consumed: true,
    deliveryPlan: selfUpgradeDeliveryPlan(),
  });
  store.saveIntegrationResult({
    id: "efa7d9ae-61c9-421a-a1b5-d427d9353a81",
    receiptId: "receipt-sue-ok",
    taskId: "task-sue-ok",
    status: "applied",
    appliedAt: TS_OK,
    createdAt: TS_OK,
    stages: four,
  });
  store.saveIntegrationReceipt({
    id: "receipt-sue-fail",
    taskId: "task-sue-fail",
    patchDigest: "b".repeat(64),
    affectedFiles: ["value.txt"],
    rejectionReasons: [],
    sourceEvidence: {},
    createdAt: TS_FAIL,
    expiresAt: "2099-01-01T00:00:00.000Z",
    consumed: true,
    deliveryPlan: selfUpgradeDeliveryPlan(),
  });
  store.saveIntegrationResult({
    id: "66ba9a77-f518-4a37-836f-043e2b70c316",
    receiptId: "receipt-sue-fail",
    taskId: "task-sue-fail",
    status: "retained-failure",
    createdAt: TS_FAIL,
    error: "secret /Users/private/path sk-live-abc",
    stages: [
      { stage: "source-applied", status: "passed" },
      { stage: "source-verified", status: "passed" },
      { stage: "artifact-built", status: "passed" },
      {
        stage: "runtime-activated",
        status: "failed",
        error: "secret /Users/private/path",
      },
    ],
  });
  store.close();
}

/** Live-history shape: three self-upgrade successes, then ordinary Elsewhere applied. */
function seedLiveHistoryReadyStreak(home: string): void {
  const store = new StateStore(home);
  const four = [
    { stage: "source-applied" as const, status: "passed" as const },
    { stage: "source-verified" as const, status: "passed" as const },
    { stage: "artifact-built" as const, status: "passed" as const },
    { stage: "runtime-activated" as const, status: "passed" as const },
  ];
  const sourceOnly = [
    { stage: "source-applied" as const, status: "passed" as const },
    { stage: "source-verified" as const, status: "passed" as const },
    { stage: "artifact-built" as const, status: "not-applicable" as const },
    { stage: "runtime-activated" as const, status: "not-applicable" as const },
  ];
  const successes: Array<[string, string, string]> = [
    ["task-sue-1", "sue-hist-1", "2026-07-28T10:00:00.000Z"],
    ["task-sue-2", "sue-hist-2", "2026-07-28T11:00:00.000Z"],
    ["task-sue-3", "sue-hist-3", "2026-07-28T12:00:00.000Z"],
  ];
  for (const [taskId, resultId, ts] of successes) {
    store.createTask({
      id: taskId,
      name: taskId,
      status: "succeeded",
      sourcePath: "/source",
      taskFile: `/task-${taskId}.yaml`,
      spec: { provider: { name: "deepseek", model: "v4" } } as TaskRecord["spec"],
      paths: {} as TaskRecord["paths"],
      sessionId: `session-${taskId}`,
      createdAt: ts,
      updatedAt: ts,
    });
    store.saveIntegrationReceipt({
      id: `receipt-${resultId}`,
      taskId,
      patchDigest: "a".repeat(64),
      affectedFiles: ["src/core/self-upgrade-evidence.ts"],
      rejectionReasons: [],
      sourceEvidence: {},
      createdAt: ts,
      expiresAt: "2099-01-01T00:00:00.000Z",
      consumed: true,
      deliveryPlan: selfUpgradeDeliveryPlan(),
    });
    store.saveIntegrationResult({
      id: resultId,
      receiptId: `receipt-${resultId}`,
      taskId,
      status: "applied",
      appliedAt: ts,
      createdAt: ts,
      stages: four,
    });
  }
  // Ordinary Elsewhere contamination (real history id shape).
  const elsewhereTs = "2026-07-30T15:00:00.000Z";
  store.createTask({
    id: "task-elsewhere",
    name: "task-elsewhere",
    status: "succeeded",
    sourcePath: "/elsewhere",
    taskFile: "/task-elsewhere.yaml",
    spec: { provider: { name: "deepseek", model: "v4" } } as TaskRecord["spec"],
    paths: {} as TaskRecord["paths"],
    sessionId: "session-elsewhere",
    createdAt: elsewhereTs,
    updatedAt: elsewhereTs,
  });
  store.saveIntegrationReceipt({
    id: "receipt-elsewhere",
    taskId: "task-elsewhere",
    patchDigest: "b".repeat(64),
    affectedFiles: ["app.tsx"],
    rejectionReasons: [],
    sourceEvidence: {},
    createdAt: elsewhereTs,
    expiresAt: "2099-01-01T00:00:00.000Z",
    consumed: true,
    deliveryPlan: ordinaryDeliveryPlan(),
  });
  store.saveIntegrationResult({
    id: "7fdbec6b-d122-4bb4-b4b4-b9263146fd65",
    receiptId: "receipt-elsewhere",
    taskId: "task-elsewhere",
    status: "applied",
    appliedAt: elsewhereTs,
    createdAt: elsewhereTs,
    stages: sourceOnly,
  });
  store.close();
}

test("upgrade status CLI is read-only observer and reports 1/3 with retained-failure break", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sue-cli-"));
  seedSelfUpgradePair(home);
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const jsonRun = await runCli(home, ["upgrade", "status", "--json"]);
    assert.equal(jsonRun.code, 0, jsonRun.stderr);
    const body = JSON.parse(jsonRun.stdout) as Record<string, unknown>;
    assert.equal(body.achieved, 1);
    assert.equal(body.required, 3);
    assert.equal(body.remaining, 2);
    assert.equal(body.state, "in-progress");
    assert.equal(body.breakCategory, "retained-failure");
    assert.equal(body.nextAction, "continue-consecutive-proofs");
    assert.ok(!jsonRun.stdout.includes("sk-live"));
    assert.ok(!jsonRun.stdout.includes("/Users/private"));
    assert.ok(!jsonRun.stdout.includes("secret"));

    const human = await runCli(home, ["upgrade", "status"]);
    assert.equal(human.code, 0, human.stderr);
    assert.match(human.stdout, /1 of 3 consecutive complete upgrades/);
    assert.match(human.stdout, /failed during activation and broke the streak/i);
    assert.match(human.stdout, /2 more consecutive complete upgrade/);
    assert.match(human.stdout, /Next: Run more complete self-upgrades/i);
    // Machine codes stay in JSON only; human output is plain language.
    assert.doesNotMatch(human.stdout, /breakCategory:/);
    assert.doesNotMatch(human.stdout, /nextAction:/);
    assert.doesNotMatch(human.stdout, /continue-consecutive-proofs/);
    assert.doesNotMatch(human.stdout, /retained-failure/);
    assert.ok(!human.stdout.includes("sk-live"));
    assert.ok(!human.stdout.includes("/Users/private"));

    const audit = await runCli(home, [
      "upgrade", "status", "--required", "5", "--json",
    ]);
    assert.equal(audit.code, 0, audit.stderr);
    const auditBody = JSON.parse(audit.stdout) as Record<string, unknown>;
    assert.equal(auditBody.required, 5);
    assert.equal(auditBody.achieved, 1);
    assert.equal(auditBody.remaining, 4);

    const bad = await runCli(home, ["upgrade", "status", "--required", "99"]);
    assert.notEqual(bad.code, 0);
    assert.match(bad.stderr, /1 to 20|1–20|required/i);
  } finally {
    await daemon.close();
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("upgrade status never starts a daemon when none is running", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sue-cli-nod-"));
  try {
    const result = await runCli(home, ["upgrade", "status", "--json"]);
    assert.notEqual(result.code, 0);
    assertObserverUnavailableGuidance(result.stderr, home);
    assert.ok(!existsSync(daemonSocketPath(home)), "observer must not create a daemon socket");
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("upgrade status stays 3/3 when newer ordinary Elsewhere Integration is applied", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sue-cli-ready-"));
  seedLiveHistoryReadyStreak(home);
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const jsonRun = await runCli(home, ["upgrade", "status", "--required", "3", "--json"]);
    assert.equal(jsonRun.code, 0, jsonRun.stderr);
    const body = JSON.parse(jsonRun.stdout) as Record<string, unknown>;
    assert.equal(body.achieved, 3);
    assert.equal(body.required, 3);
    assert.equal(body.remaining, 0);
    assert.equal(body.state, "ready");
    assert.equal(body.breakCategory, "none");
    assert.equal(body.nextAction, "milestone-ready");
    assert.equal(body.breakOperationId, undefined);
    assert.equal(body.latestQualifyingOperationId, "sue-hist-3");
    assert.ok(!jsonRun.stdout.includes("7fdbec6b"));
    assert.ok(!jsonRun.stdout.includes("elsewhere"));

    const human = await runCli(home, ["upgrade", "status", "--required", "3"]);
    assert.equal(human.code, 0, human.stderr);
    assert.match(human.stdout, /3 of 3 consecutive complete upgrades/);
    assert.ok(!human.stdout.includes("7fdbec6b"));
    assert.ok(!human.stdout.includes("/Users/private"));
  } finally {
    await daemon.close();
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});
