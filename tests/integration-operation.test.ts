import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { resolveTsxImportSpecifier } from "../src/activation/runner.js";
import {
  defaultAdvancedPolicyFields,
  enforcementCapabilityForRuntime,
  resolveEffectivePolicy,
} from "../src/core/advanced-policy.js";
import { daemonSocketPath, localAccountName, taskPaths } from "../src/core/config.js";
import { buildIntegrationOperationView, buildCompactIntegrationOperationView } from "../src/core/integration-operation.js";
import { preflightIntegration } from "../src/core/integration.js";
import { recordMainReview } from "../src/core/main-review.js";
import {
  computeSelfUpgradeEvidence,
  isQualifyingFourStageSuccess,
  isSafeIsoTimestamp,
  isSafeOpaqueId,
  parseRequiredStreakCount,
  SELF_UPGRADE_DELIVERY_PROFILE_ID,
  SELF_UPGRADE_RESULT_WINDOW,
} from "../src/core/self-upgrade-evidence.js";
import { SettingsService } from "../src/core/settings.js";
import type {
  AttemptRecord,
  DeliveryPlanView,
  IntegrationOperationView,
  IntegrationReceiptRecord,
  IntegrationResultRecord,
  IntegrationStageEvidence,
  TaskRecord,
  TaskSpec,
  VerificationResult,
} from "../src/core/types.js";
import { DaemonCoordinator } from "../src/daemon/coordinator.js";
import { ForkLightDaemon } from "../src/daemon/server.js";
import { daemonObserverRequest, daemonRequest } from "../src/daemon/client.js";
import { StateStore } from "../src/state/store.js";
import {
  DetachedDaemonFixture,
  observeUntilTerminal,
  probeSocketAlive,
  waitForDaemonReady,
  type TerminalObservation,
} from "./helpers/detached-daemon.js";
import { prepareWorkspace } from "../src/workspace/copy.js";
import { writeWorkspacePatchReport } from "../src/workspace/patch.js";
import { createPathPolicy } from "../src/workspace/path-policy.js";

const FOUR_STAGE_PASSED: IntegrationStageEvidence[] = [
  { stage: "source-applied", status: "passed" },
  { stage: "source-verified", status: "passed" },
  { stage: "artifact-built", status: "passed" },
  { stage: "runtime-activated", status: "passed" },
];

const SOURCE_ONLY_STAGES: IntegrationStageEvidence[] = [
  { stage: "source-applied", status: "passed" },
  { stage: "source-verified", status: "passed" },
  { stage: "artifact-built", status: "not-applicable" },
  { stage: "runtime-activated", status: "not-applicable" },
];

function selfUpgradeDeliveryPlan(
  resolutionSource: DeliveryPlanView["resolutionSource"] = "explicit",
): DeliveryPlanView {
  return {
    resolutionSource,
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

function minimalTask(id: string, createdAt: string): TaskRecord {
  return {
    id,
    name: id,
    status: "succeeded",
    sourcePath: "/source",
    taskFile: `/tasks/${id}.yaml`,
    spec: {
      version: 1,
      name: id,
      project: "/source",
      goal: "test",
      constraints: [],
      provider: { name: "deepseek", model: "v4", keychainService: "fk-secret" },
      runtime: {
        name: "claude-code",
        executable: "claude",
        effort: "low",
        maxBudgetUsd: null,
      },
      workspace: { exclude: [] },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
      acceptance: { commands: ["true"] },
    },
    paths: {
      root: "/x",
      baseline: "/x",
      workspace: "/x",
      logs: "/x",
      claudeConfig: "/x",
      diff: "/x",
    },
    sessionId: `session-${id}`,
    createdAt,
    updatedAt: createdAt,
  } as TaskRecord;
}

function seedResult(
  store: StateStore,
  input: {
    id: string;
    taskId: string;
    status: IntegrationResultRecord["status"];
    createdAt: string;
    appliedAt?: string;
    stages?: IntegrationStageEvidence[];
    error?: string;
    /** When set, receipt carries this plan; when omitted, no deliveryPlan. */
    deliveryPlan?: DeliveryPlanView;
    /** Convenience: sets deliveryPlan.profileId (and a minimal plan if needed). */
    deliveryProfileId?: string;
  },
): void {
  try {
    store.getTask(input.taskId);
  } catch {
    store.createTask(minimalTask(input.taskId, input.createdAt));
  }
  const receiptId = `receipt-${input.id}`;
  let deliveryPlan = input.deliveryPlan;
  if (deliveryPlan === undefined && input.deliveryProfileId !== undefined) {
    deliveryPlan = {
      ...selfUpgradeDeliveryPlan(),
      profileId: input.deliveryProfileId,
    };
  }
  const receipt: IntegrationReceiptRecord = {
    id: receiptId,
    taskId: input.taskId,
    patchDigest: "a".repeat(64),
    affectedFiles: ["src/core/self-upgrade-evidence.ts"],
    rejectionReasons: [],
    sourceEvidence: {},
    createdAt: input.createdAt,
    expiresAt: "2099-01-01T00:00:00.000Z",
    consumed: true,
    ...(deliveryPlan === undefined ? {} : { deliveryPlan }),
  };
  store.saveIntegrationReceipt(receipt);
  const result: IntegrationResultRecord = {
    id: input.id,
    receiptId,
    taskId: input.taskId,
    status: input.status,
    createdAt: input.createdAt,
    ...(input.appliedAt === undefined ? {} : { appliedAt: input.appliedAt }),
    ...(input.stages === undefined ? {} : { stages: input.stages }),
    ...(input.error === undefined ? {} : { error: input.error }),
  };
  store.saveIntegrationResult(result);
}

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
    const started = fixture.coordinator.startIntegration(
      fixture.task.id,
      fixture.receiptId,
    );
    // Non-blocking is proven by lifecycle evidence, not machine speed: the
    // operation is already running, a short read-only wait reports
    // outcome-unknown, and no durable result exists yet.
    assert.equal(started.status, "running");

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
    // Public Integration views never expose a temporary runner identity.
    assert.ok(
      !JSON.stringify(final).includes("runnerPid"),
      "public Integration view must not expose runnerPid",
    );
  } finally {
    await fixture.coordinator.shutdown();
    fixture.store.close();
  }
});

/** Finally-safe detached teardown: if the test body never captured a terminal
 *  view (it threw while the one operation was still running), observe the SAME
 *  operation until terminal before closing the exact-home daemon. Closing
 *  before terminality would let the late activation runner spawn a replacement
 *  daemon. Then prove the exact endpoint/socket are gone. */
async function closeDaemonAfterTerminal(
  daemon: ForkLightDaemon,
  home: string,
  operationId: string | undefined,
  terminal: TerminalObservation | undefined,
): Promise<void> {
  try {
    if (operationId !== undefined && terminal === undefined) {
      await observeUntilTerminal({ home, operationId });
    }
  } finally {
    await daemon.close();
    assert.equal(
      await probeSocketAlive(home),
      false,
      "exact-home daemon endpoint must be unreachable after close",
    );
    assert.equal(
      existsSync(daemonSocketPath(home)),
      false,
      "exact-home daemon socket must be removed after close",
    );
  }
}

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
  let operationId: string | undefined;
  let terminal: TerminalObservation | undefined;
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
    operationId = started.operationId;

    // A 5ms read-only wait may return outcome-unknown. The test keeps the same
    // operation and keeps observing until a durable terminal result appears;
    // it never starts, resumes, or replaces a runner.
    const early = await daemonObserverRequest<{ status: string }>(
      "integration_wait",
      { operationId, timeoutMs: 5 },
      fixture.home,
    );
    assert.equal(early.status, "outcome-unknown");

    terminal = await observeUntilTerminal({ home: fixture.home, operationId });
    assert.equal(terminal.view.status, "completed");
    assert.equal(terminal.view.result?.status, "applied");
    assert.equal(terminal.view.result?.id, operationId);
    assert.deepEqual(
      terminal.view.stages.map(({ stage, status }) => [stage, status]),
      [
        ["source-applied", "passed"],
        ["source-verified", "passed"],
        ["artifact-built", "passed"],
        ["runtime-activated", "passed"],
      ],
    );
    assert.ok(
      !JSON.stringify(terminal.view).includes("runnerPid"),
      "public Integration view must not expose runnerPid",
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
    await closeDaemonAfterTerminal(daemon, fixture.home, operationId, terminal);
  }
  // The exact-home daemon, endpoint, and runner are all gone; the home is
  // removable with no late replacement daemon.
  await rm(fixture.home, { recursive: true, force: true });
});

test("detached activation failure is durable and teardown waits for the terminal failure", async () => {
  const fixture = await operationFixture({
    buildCommands: ["node -e \"process.exit(0)\""],
    activationCommands: ["node -e \"process.exit(3)\""],
    activationCheckCommands: ["node -e \"process.exit(0)\""],
  });
  await fixture.coordinator.shutdown();
  fixture.store.close();

  const daemon = new ForkLightDaemon(fixture.home, 0);
  await daemon.start();
  let operationId: string | undefined;
  let terminal: TerminalObservation | undefined;
  try {
    const started = await daemonRequest<{ operationId: string; status: string }>(
      "integration_apply",
      { taskId: fixture.task.id, receiptId: fixture.receiptId, confirm: true },
      fixture.home,
    );
    assert.equal(started.status, "running");
    operationId = started.operationId;

    terminal = await observeUntilTerminal({ home: fixture.home, operationId });
    assert.equal(terminal.view.status, "failed");
    assert.equal(terminal.view.result?.status, "retained-failure");
    assert.equal(
      terminal.view.stages.find((stage) => stage.stage === "runtime-activated")?.status,
      "failed",
    );
    assert.ok(
      !JSON.stringify(terminal.view).includes("runnerPid"),
      "public Integration view must not expose runnerPid",
    );
  } finally {
    await closeDaemonAfterTerminal(daemon, fixture.home, operationId, terminal);
  }
  // The exact-home daemon, endpoint, and runner are all gone; the home is
  // removable with no late replacement daemon.
  await rm(fixture.home, { recursive: true, force: true });
});

test("detached activation teardown waits for terminality even when the test body throws", async () => {
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
  let operationId: string | undefined;
  let terminal: TerminalObservation | undefined;
  await assert.rejects(
    async () => {
      try {
        const started = await daemonRequest<{ operationId: string; status: string }>(
          "integration_apply",
          { taskId: fixture.task.id, receiptId: fixture.receiptId, confirm: true },
          fixture.home,
        );
        assert.equal(started.status, "running");
        operationId = started.operationId;
        // Simulated assertion failure while the one operation is still running.
        assert.equal(
          started.status,
          "unexpected-completed",
          "simulated assertion failure before terminality",
        );
      } finally {
        try {
          if (operationId !== undefined) {
            terminal = await observeUntilTerminal({ home: fixture.home, operationId });
          }
        } finally {
          await daemon.close();
          assert.equal(
            await probeSocketAlive(fixture.home),
            false,
            "exact-home daemon endpoint must be unreachable after close",
          );
        }
      }
    },
    /simulated assertion failure before terminality/,
  );

  // The finally waited for the same durable operation to become terminal before
  // closing the daemon, so exactly one terminal result exists and the marker the
  // activation wrote is present.
  assert.equal(terminal?.view.status, "completed");
  assert.equal(terminal?.view.result?.status, "applied");
  assert.equal(
    await readFile(path.join(fixture.source, markerName), "utf8"),
    "ready",
  );
  // The exact-home daemon, endpoint, and runner are all gone; the home is
  // removable with no late replacement daemon.
  await rm(fixture.home, { recursive: true, force: true });
});

test("detached handoff replaces daemon under open observer and recovers active Task once", async () => {
  // Exact-home proof: real command/server/store boundary, no Provider request.
  // Open Integration observer + deterministic hanging Worker stay active across
  // one-use handoff; replacement resumes the Worker through one linked Attempt.
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const tsxImport = resolveTsxImportSpecifier(import.meta.url);
  const cliPath = path.join(repoRoot, "src", "cli.ts");
  const node = process.execPath;
  const cliPrefix = [
    JSON.stringify(node),
    "--disable-warning=ExperimentalWarning",
    "--import",
    JSON.stringify(tsxImport),
    JSON.stringify(cliPath),
  ].join(" ");

  const binDir = await mkdtemp(path.join(tmpdir(), "forklight-fake-claude-"));
  const fakeClaude = path.join(binDir, "claude");
  await writeFile(
    fakeClaude,
    [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then echo "1.0.0 (Claude Code)"; exit 0; fi',
      "trap 'exit 130' INT TERM",
      "while :; do sleep 0.2; done",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  await chmod(fakeClaude, 0o755);

  // Detached Daemon children read Keychain through /usr/bin/security. A
  // createKeychainStore stdin write can leave an entry the child cannot read;
  // the measured detached pattern is a direct add-generic-password -U with the
  // dummy value on argv (test-only; never a live Provider credential).
  const keychainService = `forklight.test.handoff-${randomUUID()}`;
  const account = localAccountName();
  const dummyKey = "test-not-a-live-provider-key";
  execFileSync(
    "/usr/bin/security",
    [
      "add-generic-password",
      "-U",
      "-a",
      account,
      "-s",
      keychainService,
      "-w",
      dummyKey,
    ],
    { stdio: "ignore" },
  );
  // Fail closed before lifecycle work if the child-readable path is broken.
  const verified = execFileSync(
    "/usr/bin/security",
    ["find-generic-password", "-a", account, "-s", keychainService, "-w"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
  assert.equal(verified, dummyKey, "dummy Keychain entry must be readable before Daemon start");

  const previousPath = process.env.PATH ?? "";
  process.env.PATH = `${binDir}${path.delimiter}${previousPath}`;

  const fixture = await DetachedDaemonFixture.create("forklight-handoff-e2e-");
  let oldPid = 0;
  try {
    // --- Seed Integration-ready Task and active Worker Task before start ---
    const seed = new StateStore(fixture.home);
    const settings = new SettingsService(seed);
    settings.update({
      execution: {
        maxAttempts: 1,
        maxExtraAttempts: 0,
        maxConcurrency: 2,
        noProgressTimeoutMs: 600_000,
      },
    });

    const integrationSource = path.join(fixture.home, "integration-source");
    await mkdir(integrationSource);
    await writeFile(path.join(integrationSource, "value.txt"), "before\n");
    const activationCommand =
      `${cliPrefix} daemon stop && ${cliPrefix} daemon start --startup-timeout-ms 60000`;
    const activationCheck =
      `${cliPrefix} health --json | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const v=JSON.parse(d);if(v.identityStatus!=="matched")process.exit(1);});'`;
    const integrationSpec: TaskSpec = {
      version: 1,
      name: "Handoff integration",
      project: integrationSource,
      goal: "Prove self-upgrade handoff",
      constraints: [],
      provider: {
        name: "deepseek",
        model: "deepseek-v4-flash",
        keychainService,
      },
      runtime: {
        name: "claude-code",
        executable: fakeClaude,
        effort: "low",
        maxBudgetUsd: null,
      },
      workspace: { exclude: [".git", "node_modules"] },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: ["value.txt"] },
      acceptance: { commands: ["true"] },
      delivery: {
        buildCommands: ['node -e "process.exit(0)"'],
        activationCommands: [activationCommand],
        activationCheckCommands: [activationCheck],
      },
    };
    const integrationPaths = taskPaths(fixture.home, "task-handoff-integration");
    await prepareWorkspace(integrationSpec, integrationPaths);
    await writeFile(path.join(integrationPaths.workspace, "value.txt"), "after\n");
    await writeWorkspacePatchReport(integrationPaths, createPathPolicy(integrationSpec));
    const now = new Date().toISOString();
    const integrationPolicy = resolveEffectivePolicy(
      undefined,
      { baseMaxAttempts: 1, maxExtraAttempts: 0 },
      defaultAdvancedPolicyFields(),
      "test",
      enforcementCapabilityForRuntime("claude-code"),
    );
    const integrationTask: TaskRecord = {
      id: "task-handoff-integration",
      name: integrationSpec.name,
      status: "succeeded",
      sourcePath: integrationSource,
      taskFile: "forklight://test/handoff-integration",
      spec: integrationSpec,
      paths: integrationPaths,
      sessionId: "session-handoff-integration",
      currentAttemptId: "attempt-handoff-integration",
      effectivePolicy: integrationPolicy,
      createdAt: now,
      updatedAt: now,
    };
    seed.createTask(integrationTask);
    seed.createAttempt({
      id: "attempt-handoff-integration",
      taskId: integrationTask.id,
      ordinal: 1,
      status: "succeeded",
      sessionId: integrationTask.sessionId,
      rawLogPath: path.join(integrationPaths.logs, "attempt.jsonl"),
      startedAt: now,
      finishedAt: now,
      exitCode: 0,
    });
    seed.addEvent(
      integrationTask.id,
      "attempt-handoff-integration",
      "verification.completed",
      "Independent verification passed",
      {
        passed: true,
        behaviorPassed: true,
        policyPassed: true,
        sourceCompatible: true,
        commands: [],
        diffPath: integrationPaths.diff,
        sourceUnchanged: true,
      } satisfies VerificationResult,
    );
    recordMainReview(seed, integrationTask.id, {
      decision: "accept",
      reason: "Independent verification and reviewed Diff passed",
      confirm: true,
    });
    const receipt = await preflightIntegration(
      seed,
      integrationTask.id,
      settings.get().integration,
    );
    assert.deepEqual(receipt.rejectionReasons, []);

    // Worker source prepared for a live submit after the daemon starts.
    const workerSource = path.join(fixture.home, "worker-source");
    await mkdir(path.join(workerSource, "src"), { recursive: true });
    await writeFile(path.join(workerSource, "src", "work.ts"), "export const n = 1;\n");
    seed.close();

    const health = await fixture.ensureReady();
    // PATH was only needed so the child Daemon inherited the fake claude.
    // Restore immediately so sibling tests in this process are not affected.
    process.env.PATH = previousPath;
    oldPid = health.pid as number;
    assert.ok(Number.isSafeInteger(oldPid) && oldPid > 0);

    // Submit a deterministic hanging Worker (baseMaxAttempts=1) so recovery
    // requires the restart grant produced by handoff shutdown intent.
    const workerTask = await daemonRequest<TaskRecord>(
      "submit",
      {
        task: {
          version: 1,
          name: "Handoff active worker",
          project: workerSource,
          goal: "Stay running until daemon restart recovery",
          constraints: [],
          provider: {
            name: "deepseek",
            model: "deepseek-v4-flash",
            keychainService,
          },
          runtime: {
            name: "claude-code",
            executable: fakeClaude,
            effort: "low",
            maxBudgetUsd: null,
          },
          workspace: { exclude: [".git", "node_modules"] },
          worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src/work.ts"] },
          acceptance: { commands: ["true"] },
          advancedPolicyOverride: {
            baseMaxAttempts: 1,
            maxExtraAttempts: 0,
            noProgressTimeoutMs: 600_000,
          },
        },
        baseDirectory: workerSource,
      },
      fixture.home,
    );
    const workerSessionId = workerTask.sessionId;
    const workerRuntime = {
      name: workerTask.spec.runtime.name,
      effort: workerTask.spec.runtime.effort,
      model: workerTask.spec.provider.model,
      provider: workerTask.spec.provider.name,
    };

    let workerRunning = false;
    for (let i = 0; i < 100; i += 1) {
      const status = await daemonRequest<TaskRecord>("status", { taskId: workerTask.id }, fixture.home);
      if (status.status === "running" && typeof status.workerPid === "number" && status.workerPid > 0) {
        workerRunning = true;
        break;
      }
      if (status.status === "failed") {
        throw new Error(`Worker failed to start: ${status.error ?? "unknown"}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(workerRunning, true, "fake Worker must be running before handoff");

    const started = await daemonRequest<{ operationId: string; status: string }>(
      "integration_apply",
      { taskId: integrationTask.id, receiptId: receipt.id, confirm: true },
      fixture.home,
    );
    assert.equal(started.status, "running");
    const operationId = started.operationId;

    // Keep an open observer across endpoint relinquishment and replacement.
    const terminal = await observeUntilTerminal({
      home: fixture.home,
      operationId,
      escapeDeadlineMs: 120_000,
    });
    assert.equal(terminal.view.status, "completed");
    assert.equal(terminal.view.result?.status, "applied");
    assert.equal(terminal.view.result?.id, operationId);
    assert.deepEqual(
      terminal.view.stages.map(({ stage, status }) => [stage, status]),
      [
        ["source-applied", "passed"],
        ["source-verified", "passed"],
        ["artifact-built", "passed"],
        ["runtime-activated", "passed"],
      ],
    );

    // Controlled internal health: replacement PID is positive and differs.
    const replacementHealth = await waitForDaemonReady(fixture.home);
    const newPid = replacementHealth.pid as number;
    assert.ok(Number.isSafeInteger(newPid) && newPid > 0);
    assert.notEqual(newPid, oldPid);
    await fixture.adoptReplacement(newPid);

    // Active Task lineage: Attempt 1 interrupted history, exactly one ordinal-2
    // restart recovery under the same Task/session/runtime identity.
    let recovered = false;
    for (let i = 0; i < 120; i += 1) {
      const inspected = await daemonRequest<{
        task: TaskRecord;
        attempts: AttemptRecord[];
        events: Array<{ type: string; payload?: Record<string, unknown> | null }>;
      }>("inspect", { taskId: workerTask.id }, fixture.home);
      const attempts = inspected.attempts;
      const ordinals = attempts.map((a) => a.ordinal).sort((a, b) => a - b);
      const first = attempts.find((a) => a.ordinal === 1);
      const second = attempts.find((a) => a.ordinal === 2);
      if (
        first?.status === "interrupted"
        && second !== undefined
        && ordinals.length === 2
      ) {
        assert.equal(second.sessionId, workerSessionId);
        assert.equal(inspected.task.id, workerTask.id);
        assert.equal(inspected.task.sessionId, workerSessionId);
        assert.equal(inspected.task.spec.runtime.name, workerRuntime.name);
        assert.equal(inspected.task.spec.runtime.effort, workerRuntime.effort);
        assert.equal(inspected.task.spec.provider.model, workerRuntime.model);
        assert.equal(inspected.task.spec.provider.name, workerRuntime.provider);
        // Exactly one restart-recovery grant (not a quality retry).
        const grants = inspected.events.filter((e) => e.type === "attempt.authorization.granted");
        assert.equal(grants.length, 1);
        assert.equal(grants[0]?.payload?.kind, "restart-recovery");
        assert.equal(grants[0]?.payload?.reason, "system-daemon-restart");
        assert.equal(grants[0]?.payload?.priorAttemptId, first.id);
        recovered = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(recovered, true, "exactly one linked recovery Attempt must appear");

    // Idempotent completion: one Integration result for the operation.
    const history = await daemonRequest<{ results: IntegrationResultRecord[] }>(
      "integration_history",
      { taskId: integrationTask.id },
      fixture.home,
    );
    assert.equal(history.results.filter((r) => r.id === operationId).length, 1);
  } finally {
    process.env.PATH = previousPath;
    try {
      execFileSync(
        "/usr/bin/security",
        ["delete-generic-password", "-a", account, "-s", keychainService],
        { stdio: "ignore" },
      );
    } catch {
      // Best-effort cleanup of the exact test-only service/account pair.
    }
    try {
      await fixture.cleanup();
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
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

// --- Consecutive self-upgrade streak evidence ---

test("self-upgrade evidence: empty history is 0/3", () => {
  const evidence = computeSelfUpgradeEvidence([], 3);
  assert.equal(evidence.required, 3);
  assert.equal(evidence.achieved, 0);
  assert.equal(evidence.remaining, 3);
  assert.equal(evidence.state, "empty");
  assert.equal(evidence.breakCategory, "none");
  assert.equal(evidence.nextAction, "run-first-upgrade");
  assert.equal(evidence.inspectedCount, 0);
});

test("self-upgrade evidence: current 1/3 shape after retained-failure break", () => {
  // Newest first: applied four-stage success, then retained-failure.
  // Matches pre-integration durable history shape (streak = 1/3).
  const results = [
    {
      id: "efa7d9ae-61c9-421a-a1b5-d427d9353a81",
      status: "applied" as const,
      createdAt: "2026-07-30T12:00:00.000Z",
      appliedAt: "2026-07-30T12:00:00.000Z",
      stages: FOUR_STAGE_PASSED,
    },
    {
      id: "66ba9a77-f518-4a37-836f-043e2b70c316",
      status: "retained-failure" as const,
      createdAt: "2026-07-30T11:00:00.000Z",
      stages: [
        { stage: "source-applied" as const, status: "passed" as const },
        { stage: "source-verified" as const, status: "passed" as const },
        { stage: "artifact-built" as const, status: "passed" as const },
        {
          stage: "runtime-activated" as const,
          status: "failed" as const,
          error: "activation failed with secret /Users/private/path and token sk-secret-xyz",
        },
      ],
      error: "retained activation failure: /Users/private/path token=sk-secret-xyz",
    },
  ];
  const evidence = computeSelfUpgradeEvidence(results, 3);
  assert.equal(evidence.achieved, 1);
  assert.equal(evidence.required, 3);
  assert.equal(evidence.remaining, 2);
  assert.equal(evidence.state, "in-progress");
  assert.equal(evidence.breakCategory, "retained-failure");
  assert.equal(evidence.nextAction, "continue-consecutive-proofs");
  assert.equal(evidence.latestQualifyingOperationId, "efa7d9ae-61c9-421a-a1b5-d427d9353a81");
  assert.equal(evidence.breakOperationId, "66ba9a77-f518-4a37-836f-043e2b70c316");
  assert.equal(evidence.latestQualifyingAt, "2026-07-30T12:00:00.000Z");

  const json = JSON.stringify(evidence);
  assert.ok(!json.includes("sk-secret"));
  assert.ok(!json.includes("/Users/private"));
  assert.ok(!json.includes("activation failed"));
  assert.ok(!json.includes("token="));
});

test("self-upgrade evidence: three consecutive successes are ready without older history", () => {
  const results = [
    { id: "s3", status: "applied", createdAt: "2026-07-30T15:00:00.000Z", stages: FOUR_STAGE_PASSED },
    { id: "s2", status: "applied", createdAt: "2026-07-30T14:00:00.000Z", stages: FOUR_STAGE_PASSED },
    { id: "s1", status: "applied", createdAt: "2026-07-30T13:00:00.000Z", stages: FOUR_STAGE_PASSED },
    {
      id: "old-fail",
      status: "retained-failure",
      createdAt: "2026-07-30T12:00:00.000Z",
      stages: [{ stage: "runtime-activated", status: "failed", error: "old" }],
    },
  ];
  const evidence = computeSelfUpgradeEvidence(results, 3);
  assert.equal(evidence.achieved, 3);
  assert.equal(evidence.remaining, 0);
  assert.equal(evidence.state, "ready");
  assert.equal(evidence.breakCategory, "none");
  assert.equal(evidence.nextAction, "milestone-ready");
  assert.equal(evidence.latestQualifyingOperationId, "s3");
  assert.equal(evidence.breakOperationId, undefined);
});

test("self-upgrade evidence: more than required is capped for display", () => {
  const results = Array.from({ length: 5 }, (_, i) => ({
    id: `s${5 - i}`,
    status: "applied" as const,
    createdAt: `2026-07-30T1${5 - i}:00:00.000Z`,
    stages: FOUR_STAGE_PASSED,
  }));
  const evidence = computeSelfUpgradeEvidence(results, 3);
  assert.equal(evidence.achieved, 3);
  assert.equal(evidence.remaining, 0);
  assert.equal(evidence.state, "ready");
  assert.equal(evidence.nextAction, "milestone-ready");
});

test("self-upgrade evidence: missing, duplicate, and not-applicable stage evidence fail closed", () => {
  assert.equal(
    isQualifyingFourStageSuccess({
      id: "missing",
      status: "applied",
      createdAt: "t",
      stages: [
        { stage: "source-applied", status: "passed" },
        { stage: "source-verified", status: "passed" },
        { stage: "artifact-built", status: "passed" },
        // runtime-activated missing
      ],
    }),
    false,
  );
  assert.equal(
    isQualifyingFourStageSuccess({
      id: "duplicate",
      status: "applied",
      createdAt: "t",
      stages: [
        ...FOUR_STAGE_PASSED,
        { stage: "source-applied", status: "passed" },
      ],
    }),
    false,
  );
  assert.equal(
    isQualifyingFourStageSuccess({
      id: "na",
      status: "applied",
      createdAt: "t",
      stages: [
        { stage: "source-applied", status: "passed" },
        { stage: "source-verified", status: "passed" },
        { stage: "artifact-built", status: "passed" },
        { stage: "runtime-activated", status: "not-applicable" },
      ],
    }),
    false,
  );
  assert.equal(
    isQualifyingFourStageSuccess({
      id: "legacy",
      status: "applied",
      createdAt: "t",
      // no stages at all
    }),
    false,
  );
  assert.equal(
    isQualifyingFourStageSuccess({
      id: "pending",
      status: "applied",
      createdAt: "t",
      stages: [
        { stage: "source-applied", status: "passed" },
        { stage: "source-verified", status: "passed" },
        { stage: "artifact-built", status: "passed" },
        { stage: "runtime-activated", status: "pending" },
      ],
    }),
    false,
  );
  assert.equal(
    isQualifyingFourStageSuccess({
      id: "extra-unknown",
      status: "applied",
      createdAt: "t",
      stages: [
        ...FOUR_STAGE_PASSED,
        { stage: "mystery-stage", status: "passed" } as unknown as IntegrationStageEvidence,
      ],
    }),
    false,
    "extra unknown stage must not qualify",
  );
  assert.equal(
    isQualifyingFourStageSuccess({
      id: "unknown-replaces-required",
      status: "applied",
      createdAt: "t",
      stages: [
        { stage: "source-applied", status: "passed" },
        { stage: "source-verified", status: "passed" },
        { stage: "artifact-built", status: "passed" },
        { stage: "mystery-stage", status: "passed" } as unknown as IntegrationStageEvidence,
      ],
    }),
    false,
    "unknown stage in place of a required stage must not qualify",
  );
  assert.equal(
    isQualifyingFourStageSuccess({
      id: "ok-exact",
      status: "applied",
      createdAt: "t",
      stages: FOUR_STAGE_PASSED,
    }),
    true,
  );

  const interrupted = computeSelfUpgradeEvidence(
    [
      {
        id: "ok",
        status: "applied",
        createdAt: "2026-07-30T14:00:00.000Z",
        stages: FOUR_STAGE_PASSED,
      },
      {
        id: "legacy-applied",
        status: "applied",
        createdAt: "2026-07-30T13:00:00.000Z",
        stages: [{ stage: "source-applied", status: "passed" }],
        error: "partial legacy /secret/path",
      },
    ],
    3,
  );
  assert.equal(interrupted.achieved, 1);
  assert.equal(interrupted.breakCategory, "insufficient-evidence");
  assert.equal(interrupted.breakOperationId, "legacy-applied");
  assert.ok(!JSON.stringify(interrupted).includes("/secret/path"));
});

test("self-upgrade evidence: does not skip failures to find older successes", () => {
  const results = [
    {
      id: "fail-newest",
      status: "retained-failure" as const,
      createdAt: "2026-07-30T16:00:00.000Z",
      error: "newest fail",
    },
    { id: "s3", status: "applied" as const, createdAt: "2026-07-30T15:00:00.000Z", stages: FOUR_STAGE_PASSED },
    { id: "s2", status: "applied" as const, createdAt: "2026-07-30T14:00:00.000Z", stages: FOUR_STAGE_PASSED },
    { id: "s1", status: "applied" as const, createdAt: "2026-07-30T13:00:00.000Z", stages: FOUR_STAGE_PASSED },
  ];
  const evidence = computeSelfUpgradeEvidence(results, 3);
  assert.equal(evidence.achieved, 0);
  assert.equal(evidence.remaining, 3);
  assert.equal(evidence.state, "in-progress");
  assert.equal(evidence.breakCategory, "retained-failure");
  assert.equal(evidence.breakOperationId, "fail-newest");
  assert.equal(evidence.latestQualifyingOperationId, undefined);
});

test("self-upgrade evidence: store orders by createdAt DESC then id DESC", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sue-order-"));
  const store = new StateStore(home);
  try {
    // Same createdAt — id tie-break decides newest.
    seedResult(store, {
      id: "op-a",
      taskId: "task-a",
      status: "applied",
      createdAt: "2026-07-30T12:00:00.000Z",
      stages: FOUR_STAGE_PASSED,
      deliveryPlan: selfUpgradeDeliveryPlan(),
    });
    seedResult(store, {
      id: "op-b",
      taskId: "task-b",
      status: "retained-failure",
      createdAt: "2026-07-30T12:00:00.000Z",
      error: "tie older by id",
      deliveryPlan: selfUpgradeDeliveryPlan(),
    });
    seedResult(store, {
      id: "op-c",
      taskId: "task-c",
      status: "applied",
      createdAt: "2026-07-30T13:00:00.000Z",
      stages: FOUR_STAGE_PASSED,
      deliveryPlan: selfUpgradeDeliveryPlan(),
    });

    const recent = store.listRecentSelfUpgradeIntegrationResults(10);
    assert.equal(recent.map((r) => r.id).join(","), "op-c,op-b,op-a");

    const evidence = computeSelfUpgradeEvidence(recent, 3);
    // Newest is qualifying, next is retained-failure → 1/3.
    assert.equal(evidence.achieved, 1);
    assert.equal(evidence.breakCategory, "retained-failure");
    assert.equal(evidence.latestQualifyingOperationId, "op-c");
    assert.equal(evidence.breakOperationId, "op-b");
  } finally {
    store.close();
  }
});

test("self-upgrade evidence: coordinator projection is read-only and privacy-safe", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sue-coord-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const coordinator = new DaemonCoordinator(store, settings, 0);
  try {
    seedResult(store, {
      id: "efa7d9ae-61c9-421a-a1b5-d427d9353a81",
      taskId: "task-success",
      status: "applied",
      createdAt: "2026-07-30T12:00:00.000Z",
      appliedAt: "2026-07-30T12:00:00.000Z",
      stages: FOUR_STAGE_PASSED,
      deliveryPlan: selfUpgradeDeliveryPlan(),
    });
    seedResult(store, {
      id: "66ba9a77-f518-4a37-836f-043e2b70c316",
      taskId: "task-fail",
      status: "retained-failure",
      createdAt: "2026-07-30T11:00:00.000Z",
      stages: [
        { stage: "source-applied", status: "passed" },
        { stage: "source-verified", status: "passed" },
        { stage: "artifact-built", status: "passed" },
        {
          stage: "runtime-activated",
          status: "failed",
          error: "secret /private/path token=sk-live-abc",
          commands: [{
            command: "node dist/index.js --token sk-live-abc",
            exitCode: 1,
            stdout: "PROMPT: ignore previous",
            stderr: "/Users/private/keychain",
            durationMs: 10,
            timedOut: false,
          }],
        },
      ],
      error: "retained: /Users/private/path sk-live-abc",
      deliveryPlan: selfUpgradeDeliveryPlan(),
    });

    const beforeTasks = store.listTasks().length;
    const beforeResults = store.listRecentIntegrationResults(40).length;
    const beforeScoped = store.listRecentSelfUpgradeIntegrationResults(40).length;
    const evidence1 = coordinator.selfUpgradeEvidence(3);
    const evidence2 = coordinator.selfUpgradeEvidence(3);
    assert.deepEqual(evidence1, evidence2);
    assert.equal(evidence1.achieved, 1);
    assert.equal(evidence1.required, 3);
    assert.equal(evidence1.breakCategory, "retained-failure");
    assert.equal(store.listTasks().length, beforeTasks);
    assert.equal(store.listRecentIntegrationResults(40).length, beforeResults);
    assert.equal(store.listRecentSelfUpgradeIntegrationResults(40).length, beforeScoped);

    const json = JSON.stringify(evidence1);
    assert.ok(!json.includes("sk-live"));
    assert.ok(!json.includes("/Users/private"));
    assert.ok(!json.includes("/private/path"));
    assert.ok(!json.includes("PROMPT"));
    assert.ok(!json.includes("keychain"));
    assert.ok(!json.includes("commands"));
    assert.ok(!json.includes("stdout"));
    assert.ok(!json.includes("stderr"));
    assert.ok(!json.includes("error"));
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("self-upgrade evidence: ordinary project Integrations are neutral and do not break ready streak", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sue-scope-ready-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const coordinator = new DaemonCoordinator(store, settings, 0);
  try {
    // Three consecutive self-upgrade four-stage successes.
    for (const [id, ts] of [
      ["sue-s1", "2026-07-29T10:00:00.000Z"],
      ["sue-s2", "2026-07-29T11:00:00.000Z"],
      ["sue-s3", "2026-07-29T12:00:00.000Z"],
    ] as const) {
      seedResult(store, {
        id,
        taskId: `task-${id}`,
        status: "applied",
        createdAt: ts,
        appliedAt: ts,
        stages: FOUR_STAGE_PASSED,
        deliveryPlan: selfUpgradeDeliveryPlan("project"),
      });
    }
    // Newer ordinary Elsewhere Integration: applied with artifact/runtime N/A.
    // Shaped like 7fdbec6b-d122-4bb4-b4b4-b9263146fd65 contamination.
    seedResult(store, {
      id: "7fdbec6b-d122-4bb4-b4b4-b9263146fd65",
      taskId: "task-elsewhere",
      status: "applied",
      createdAt: "2026-07-30T15:00:00.000Z",
      appliedAt: "2026-07-30T15:00:00.000Z",
      stages: SOURCE_ONLY_STAGES,
      deliveryPlan: ordinaryDeliveryPlan(),
    });
    // Another ordinary without any deliveryPlan (legacy-shaped).
    seedResult(store, {
      id: "ordinary-legacy",
      taskId: "task-ordinary-legacy",
      status: "applied",
      createdAt: "2026-07-30T16:00:00.000Z",
      stages: SOURCE_ONLY_STAGES,
    });

    const scoped = store.listRecentSelfUpgradeIntegrationResults(40);
    assert.equal(scoped.map((r) => r.id).join(","), "sue-s3,sue-s2,sue-s1");
    assert.ok(!scoped.some((r) => r.id === "7fdbec6b-d122-4bb4-b4b4-b9263146fd65"));

    const evidence = coordinator.selfUpgradeEvidence(3);
    assert.equal(evidence.achieved, 3);
    assert.equal(evidence.remaining, 0);
    assert.equal(evidence.state, "ready");
    assert.equal(evidence.breakCategory, "none");
    assert.equal(evidence.breakOperationId, undefined);
    assert.equal(evidence.latestQualifyingOperationId, "sue-s3");
    assert.equal(evidence.nextAction, "milestone-ready");
    assert.equal(evidence.inspectedCount, 3);
    assert.ok(!JSON.stringify(evidence).includes("7fdbec6b"));
    assert.ok(!JSON.stringify(evidence).includes("elsewhere"));
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("self-upgrade evidence: ordinary between self-upgrades is neutral; exact-profile failure still breaks", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sue-scope-interleave-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const coordinator = new DaemonCoordinator(store, settings, 0);
  try {
    seedResult(store, {
      id: "sue-fail-old",
      taskId: "task-sue-fail-old",
      status: "retained-failure",
      createdAt: "2026-07-28T09:00:00.000Z",
      error: "old self-upgrade fail /Users/private/path",
      deliveryPlan: selfUpgradeDeliveryPlan(),
    });
    seedResult(store, {
      id: "sue-ok-1",
      taskId: "task-sue-ok-1",
      status: "applied",
      createdAt: "2026-07-28T10:00:00.000Z",
      appliedAt: "2026-07-28T10:00:00.000Z",
      stages: FOUR_STAGE_PASSED,
      deliveryPlan: selfUpgradeDeliveryPlan(),
    });
    // Ordinary app failure interleaved — must be neutral.
    seedResult(store, {
      id: "ordinary-fail",
      taskId: "task-ordinary-fail",
      status: "retained-failure",
      createdAt: "2026-07-28T11:00:00.000Z",
      error: "ordinary fail secret /Users/private/elsewhere sk-live",
      deliveryPlan: ordinaryDeliveryPlan(),
    });
    seedResult(store, {
      id: "sue-ok-2",
      taskId: "task-sue-ok-2",
      status: "applied",
      createdAt: "2026-07-28T12:00:00.000Z",
      appliedAt: "2026-07-28T12:00:00.000Z",
      stages: FOUR_STAGE_PASSED,
      deliveryPlan: selfUpgradeDeliveryPlan(),
    });
    // Newest exact-profile self-upgrade failure — first real break.
    seedResult(store, {
      id: "sue-fail-new",
      taskId: "task-sue-fail-new",
      status: "rejected",
      createdAt: "2026-07-28T13:00:00.000Z",
      error: "self-upgrade rejected /Users/private/path",
      deliveryPlan: selfUpgradeDeliveryPlan(),
    });

    const scoped = store.listRecentSelfUpgradeIntegrationResults(40);
    assert.equal(
      scoped.map((r) => r.id).join(","),
      "sue-fail-new,sue-ok-2,sue-ok-1,sue-fail-old",
    );
    assert.ok(!scoped.some((r) => r.id === "ordinary-fail"));

    const evidence = coordinator.selfUpgradeEvidence(3);
    assert.equal(evidence.achieved, 0);
    assert.equal(evidence.remaining, 3);
    assert.equal(evidence.state, "in-progress");
    assert.equal(evidence.breakCategory, "rejected");
    assert.equal(evidence.breakOperationId, "sue-fail-new");
    assert.equal(evidence.latestQualifyingOperationId, undefined);
    const json = JSON.stringify(evidence);
    assert.ok(!json.includes("ordinary-fail"));
    assert.ok(!json.includes("/Users/private"));
    assert.ok(!json.includes("sk-live"));
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("self-upgrade evidence: missing, lookalike, default-like, and foreign identity are ignored", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sue-scope-identity-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const coordinator = new DaemonCoordinator(store, settings, 0);
  try {
    seedResult(store, {
      id: "sue-only",
      taskId: "task-sue-only",
      status: "applied",
      createdAt: "2026-07-27T10:00:00.000Z",
      appliedAt: "2026-07-27T10:00:00.000Z",
      stages: FOUR_STAGE_PASSED,
      deliveryPlan: selfUpgradeDeliveryPlan(),
    });
    seedResult(store, {
      id: "lookalike",
      taskId: "task-lookalike",
      status: "retained-failure",
      createdAt: "2026-07-27T11:00:00.000Z",
      error: "lookalike fail",
      deliveryProfileId: `${SELF_UPGRADE_DELIVERY_PROFILE_ID}-copy`,
    });
    seedResult(store, {
      id: "foreign",
      taskId: "task-foreign",
      status: "applied",
      createdAt: "2026-07-27T12:00:00.000Z",
      stages: FOUR_STAGE_PASSED,
      deliveryProfileId: "relay-deploy",
    });
    seedResult(store, {
      id: "default-implicit",
      taskId: "task-default",
      status: "applied",
      createdAt: "2026-07-27T13:00:00.000Z",
      stages: FOUR_STAGE_PASSED,
      deliveryPlan: {
        resolutionSource: "default",
        buildCommandCount: 1,
        activationCommandCount: 1,
        activationCheckCommandCount: 0,
        outcome: "activation",
        stages: {
          sourceApply: "required",
          sourceVerify: "required",
          artifactBuild: "required",
          runtimeActivation: "required",
        },
      },
    });
    // Malformed plan evidence: non-object deliveryPlan stored raw; ignore safely.
    {
      store.createTask(minimalTask("task-malformed", "2026-07-27T14:00:00.000Z"));
      store.saveIntegrationReceipt({
        id: "receipt-malformed",
        taskId: "task-malformed",
        patchDigest: "c".repeat(64),
        affectedFiles: ["x.ts"],
        rejectionReasons: [],
        sourceEvidence: {},
        createdAt: "2026-07-27T14:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        consumed: true,
        deliveryPlan: "not-a-plan" as unknown as DeliveryPlanView,
      });
      store.saveIntegrationResult({
        id: "malformed",
        receiptId: "receipt-malformed",
        taskId: "task-malformed",
        status: "retained-failure",
        createdAt: "2026-07-27T14:00:00.000Z",
        error: "malformed receipt secret",
      });
    }
    seedResult(store, {
      id: "legacy-no-plan",
      taskId: "task-legacy",
      status: "retained-failure",
      createdAt: "2026-07-27T15:00:00.000Z",
      error: "legacy fail",
    });

    const scoped = store.listRecentSelfUpgradeIntegrationResults(40);
    assert.equal(scoped.map((r) => r.id).join(","), "sue-only");

    const evidence = coordinator.selfUpgradeEvidence(3);
    assert.equal(evidence.achieved, 1);
    assert.equal(evidence.remaining, 2);
    assert.equal(evidence.state, "in-progress");
    assert.equal(evidence.breakCategory, "none");
    assert.equal(evidence.breakOperationId, undefined);
    assert.equal(evidence.latestQualifyingOperationId, "sue-only");
    assert.equal(evidence.inspectedCount, 1);
    const json = JSON.stringify(evidence);
    assert.ok(!json.includes("lookalike"));
    assert.ok(!json.includes("forklight-self-upgrade-copy"));
    assert.ok(!json.includes("relay-deploy"));
    assert.ok(!json.includes("malformed"));
    assert.ok(!json.includes("secret"));
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("self-upgrade evidence: window bounds matching self-upgrade records after scope", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sue-scope-window-"));
  const store = new StateStore(home);
  try {
    // Many ordinary Integrations newer than older self-upgrades must not hide them.
    for (let i = 0; i < SELF_UPGRADE_RESULT_WINDOW + 5; i += 1) {
      const n = String(i).padStart(3, "0");
      seedResult(store, {
        id: `ordinary-${n}`,
        taskId: `task-ordinary-${n}`,
        status: "applied",
        createdAt: `2026-07-30T${String(10 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000Z`,
        stages: SOURCE_ONLY_STAGES,
        deliveryPlan: ordinaryDeliveryPlan(),
      });
    }
    for (const [id, ts] of [
      ["sue-w1", "2026-07-20T10:00:00.000Z"],
      ["sue-w2", "2026-07-20T11:00:00.000Z"],
      ["sue-w3", "2026-07-20T12:00:00.000Z"],
    ] as const) {
      seedResult(store, {
        id,
        taskId: `task-${id}`,
        status: "applied",
        createdAt: ts,
        appliedAt: ts,
        stages: FOUR_STAGE_PASSED,
        deliveryPlan: selfUpgradeDeliveryPlan(),
      });
    }

    const globalRecent = store.listRecentIntegrationResults(SELF_UPGRADE_RESULT_WINDOW);
    assert.ok(
      !globalRecent.some((r) => r.id.startsWith("sue-w")),
      "global window alone would hide older self-upgrades under ordinary noise",
    );

    const scoped = store.listRecentSelfUpgradeIntegrationResults(SELF_UPGRADE_RESULT_WINDOW);
    assert.equal(scoped.map((r) => r.id).join(","), "sue-w3,sue-w2,sue-w1");
    assert.ok(scoped.length <= SELF_UPGRADE_RESULT_WINDOW);

    const evidence = computeSelfUpgradeEvidence(scoped, 3);
    assert.equal(evidence.achieved, 3);
    assert.equal(evidence.state, "ready");
    assert.equal(evidence.breakCategory, "none");
  } finally {
    store.close();
  }
});

test("self-upgrade evidence: required count is validated and does not rewrite history", () => {
  assert.throws(() => parseRequiredStreakCount(0), /1 to 20/);
  assert.throws(() => parseRequiredStreakCount(21), /1 to 20/);
  assert.throws(() => parseRequiredStreakCount(1.5), /1 to 20/);
  assert.equal(parseRequiredStreakCount(undefined), 3);

  const results = [
    {
      id: "s1",
      status: "applied",
      createdAt: "2026-07-30T10:00:00.000Z",
      stages: FOUR_STAGE_PASSED,
    },
  ];
  const forAudit = computeSelfUpgradeEvidence(results, 5);
  assert.equal(forAudit.required, 5);
  assert.equal(forAudit.achieved, 1);
  assert.equal(forAudit.remaining, 4);
  // Default milestone unchanged for separate call.
  const defaultMilestone = computeSelfUpgradeEvidence(results, 3);
  assert.equal(defaultMilestone.required, 3);
  assert.equal(defaultMilestone.remaining, 2);
});

test("self-upgrade evidence: omits hostile ids and timestamps from public projection", () => {
  assert.equal(isSafeOpaqueId("efa7d9ae-61c9-421a-a1b5-d427d9353a81"), true);
  assert.equal(isSafeOpaqueId("/Users/private/path"), false);
  assert.equal(isSafeOpaqueId("sk-live-abc with spaces"), false);
  assert.equal(isSafeOpaqueId("../secret"), false);
  assert.equal(isSafeOpaqueId("id\nwith\nnewlines"), false);
  assert.equal(isSafeIsoTimestamp("2026-07-30T12:00:00.000Z"), true);
  assert.equal(isSafeIsoTimestamp("not-a-timestamp"), false);
  assert.equal(isSafeIsoTimestamp("2026-07-30 12:00:00"), false);
  assert.equal(isSafeIsoTimestamp("/Users/private/ts"), false);

  const evidence = computeSelfUpgradeEvidence(
    [
      {
        id: "/Users/private/op-id?token=sk-live",
        status: "applied",
        createdAt: "not-iso",
        appliedAt: "also-not-iso",
        stages: FOUR_STAGE_PASSED,
      },
      {
        id: "../../../etc/passwd",
        status: "retained-failure",
        createdAt: "2026-07-30T11:00:00.000Z",
        error: "secret /Users/private/path sk-live-abc",
      },
    ],
    3,
  );
  assert.equal(evidence.achieved, 1);
  assert.equal(evidence.breakCategory, "retained-failure");
  assert.equal(evidence.latestQualifyingOperationId, undefined);
  assert.equal(evidence.latestQualifyingAt, undefined);
  assert.equal(evidence.breakOperationId, undefined);
  const json = JSON.stringify(evidence);
  assert.ok(!json.includes("/Users/private"));
  assert.ok(!json.includes("sk-live"));
  assert.ok(!json.includes("passwd"));
  assert.ok(!json.includes("not-iso"));
  assert.ok(!json.includes("token="));
});
