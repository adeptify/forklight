import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type {
  DependencyRecord,
  PlanItemRecord,
  PlanRecord,
  TaskRecord,
} from "../src/core/types.js";
import type { PlanBoard, PlanBoardSummary } from "../src/core/board.js";
import { daemonRequest } from "../src/daemon/client.js";
import { DaemonCoordinator, probeProvidersBounded } from "../src/daemon/coordinator.js";
import { assertWorkPlan } from "../src/core/plan.js";
import { buildTaskRecord, registerTaskFromSpec } from "../src/core/runner.js";
import { parseTaskSpec } from "../src/core/task.js";
import { ForkLightDaemon } from "../src/daemon/server.js";
import { SettingsService } from "../src/core/settings.js";
import { StateStore } from "../src/state/store.js";

// --- revise harness ---

const REVISE_PROBE = "forklight-revise-PROBE-MARKER-2026";

function standaloneSucceededTask(
  store: StateStore, name: string, status: TaskRecord["status"] = "succeeded",
): TaskRecord {
  const task = registerTaskFromSpec(
    store,
    {
      version: 1,
      name,
      project: "/tmp/forklight-revise-source",
      goal: "Exercise revise eligibility",
      constraints: [],
      provider: {
        name: "deepseek",
        model: "deepseek-v4-flash",
        keychainService: "forklight.test.api-key",
      },
      runtime: {
        name: "claude-code",
        executable: "claude",
        effort: "low",
        maxBudgetUsd: 0.1,
      },
      workspace: { exclude: [] },
      worker: { allowEdits: false, allowedCommands: [], focusPaths: ["src"] },
      acceptance: { commands: ["true"] },
    },
    `forklight://test/${name}`,
  );
  if (status !== "queued") store.setTaskStatus(task.id, status, { error: null });
  return store.getTask(task.id);
}

function testCoordinator(store: StateStore, maxConcurrency: number): DaemonCoordinator {
  const settings = new SettingsService(store);
  return new DaemonCoordinator(store, settings, maxConcurrency);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function graphTask(store: StateStore, name: string): TaskRecord {
  return registerTaskFromSpec(
    store,
    {
      version: 1,
      name,
      project: "/tmp/forklight-graph-test-source",
      goal: "Exercise graph scheduling",
      constraints: [],
      provider: {
        name: "deepseek",
        model: "deepseek-v4-flash",
        keychainService: "forklight.test.api-key",
      },
      runtime: {
        name: "claude-code",
        executable: "claude",
        effort: "low",
        maxBudgetUsd: 0.1,
      },
      workspace: { exclude: [] },
      worker: { allowEdits: false, allowedCommands: [], focusPaths: ["src"] },
      acceptance: { commands: ["true"] },
    },
    `forklight://test/${name}`,
  );
}

function createGraph(
  store: StateStore,
  id: string,
  tasks: Array<{ itemId: string; task: TaskRecord }>,
  dependencies: Array<{ itemId: string; dependsOnItemId: string }>,
): void {
  const now = new Date().toISOString();
  const plan: PlanRecord = {
    id,
    name: id,
    objective: "Exercise dependency scheduling",
    planFile: `/tmp/${id}.yaml`,
    createdAt: now,
    updatedAt: now,
  };
  const items: PlanItemRecord[] = tasks.map(({ itemId, task }, itemIndex) => ({
    id: itemId,
    planId: id,
    taskId: task.id,
    itemIndex,
    taskFile: `/tmp/${itemId}.yaml`,
  }));
  const edges: DependencyRecord[] = dependencies.map((dependency) => ({
    planId: id,
    ...dependency,
  }));
  store.createPlanGraph(plan, items, edges);
}

async function writeTwoWavePlan(root: string): Promise<string> {
  const task = path.resolve("examples/deepseek-checkout.yaml");
  const planFile = path.join(root, "plan.json");
  await writeFile(
    planFile,
    JSON.stringify({
      version: 1,
      name: "Two-wave registration",
      objective: "Exercise coordinator plan registration waves",
      items: [
        { id: "foundation", task, dependsOn: [] },
        { id: "first", task, dependsOn: ["foundation"] },
        { id: "second", task, dependsOn: ["foundation"] },
      ],
    }),
  );
  return planFile;
}

test("daemon serves health and task-list requests over its local socket", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-daemon-"));
  const daemon = new ForkLightDaemon(home, 1);
  await daemon.start();
  try {
    const health = await daemonRequest<Record<string, unknown>>("health", {}, home);
    assert.equal(health.ok, true);
    assert.equal(health.maxConcurrency, 1);
    const tasks = await daemonRequest<unknown[]>("list", {}, home);
    assert.deepEqual(tasks, []);
  } finally {
    await daemon.close();
  }
});

test("daemon submission returns a task before workspace preparation finishes", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-daemon-submit-"));
  const daemon = new ForkLightDaemon(home, 1);
  await daemon.start();
  try {
    const task = await daemonRequest<TaskRecord>(
      "submit",
      {
        baseDirectory: home,
        task: {
          version: 1,
          name: "asynchronous preparation",
          project: path.join(home, "missing-project"),
          goal: "prove submission does not wait for project copying",
          provider: { name: "deepseek", model: "deepseek-v4-flash" },
          runtime: { name: "claude-code" },
          worker: { allowedCommands: [] },
          acceptance: { commands: ["true"] },
        },
      },
      home,
    );
    assert.match(task.id, /^[0-9a-f-]{36}$/);

    let current = task;
    for (let attempt = 0; attempt < 50 && current.status !== "failed"; attempt += 1) {
      await sleep(10);
      current = await daemonRequest<TaskRecord>("status", { taskId: task.id }, home);
    }
    assert.equal(current.status, "failed");
    assert.match(current.error ?? "", /Workspace preparation failed/);
  } finally {
    await daemon.close();
  }
});

test("graph tasks persist waiting and blocked dependency evidence", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-scheduler-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  const foundation = graphTask(store, "foundation");
  const consumer = graphTask(store, "consumer");
  createGraph(
    store,
    "dependency-state",
    [{ itemId: "foundation", task: foundation }, { itemId: "consumer", task: consumer }],
    [{ itemId: "consumer", dependsOnItemId: "foundation" }],
  );

  coordinator.queueTask(consumer.id);
  assert.equal(store.getTask(consumer.id).status, "waiting");
  assert.match(store.getTask(consumer.id).error ?? "", /foundation/);
  assert.equal(store.listEvents(consumer.id).at(-1)?.type, "task.waiting");

  store.setTaskStatus(foundation.id, "failed", { error: "verification failed" });
  await coordinator.recover();
  assert.equal(store.getTask(consumer.id).status, "blocked");
  assert.match(store.getTask(consumer.id).error ?? "", /foundation/);
  assert.equal(store.listEvents(consumer.id).at(-1)?.type, "task.blocked");
  await coordinator.shutdown();
  store.close();
});

test("successful prerequisite queues each waiting dependent exactly once", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-scheduler-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  const foundation = graphTask(store, "foundation");
  const first = graphTask(store, "first-dependent");
  const second = graphTask(store, "second-dependent");
  createGraph(
    store,
    "dependency-unlock",
    [
      { itemId: "foundation", task: foundation },
      { itemId: "first", task: first },
      { itemId: "second", task: second },
    ],
    [
      { itemId: "first", dependsOnItemId: "foundation" },
      { itemId: "second", dependsOnItemId: "foundation" },
    ],
  );
  coordinator.queueTask(first.id);
  coordinator.queueTask(second.id);
  assert.equal(store.getTask(first.id).status, "waiting");
  assert.equal(store.getTask(second.id).status, "waiting");

  store.setTaskStatus(foundation.id, "succeeded", { error: null });
  await coordinator.recover();
  await coordinator.recover();
  assert.equal(store.getTask(first.id).status, "queued");
  assert.equal(store.getTask(second.id).status, "queued");
  const queued = (coordinator.health().queuedTaskIds as string[]).sort();
  assert.deepEqual(queued, [first.id, second.id].sort());
  assert.equal(store.listEvents(first.id).filter((event) => event.type === "task.ready").length, 1);
  await coordinator.shutdown();
  store.close();
});

test("restart preserves blocked work and standalone tasks bypass graph checks", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-scheduler-"));
  const initial = new StateStore(home);
  const foundation = graphTask(initial, "foundation");
  const consumer = graphTask(initial, "consumer");
  const standalone = graphTask(initial, "standalone");
  createGraph(
    initial,
    "dependency-restart",
    [{ itemId: "foundation", task: foundation }, { itemId: "consumer", task: consumer }],
    [{ itemId: "consumer", dependsOnItemId: "foundation" }],
  );
  initial.setTaskStatus(foundation.id, "failed", { error: "verification failed" });
  const firstCoordinator = testCoordinator(initial, 0);
  firstCoordinator.queueTask(consumer.id);
  assert.equal(initial.getTask(consumer.id).status, "blocked");
  await firstCoordinator.shutdown();
  initial.close();

  const reopened = new StateStore(home);
  const recovered = testCoordinator(reopened, 0);
  await recovered.recover();
  assert.equal(reopened.getTask(consumer.id).status, "blocked");
  assert.match(reopened.getTask(consumer.id).error ?? "", /foundation/);
  recovered.queueTask(standalone.id);
  assert.deepEqual(recovered.health().queuedTaskIds, [standalone.id]);
  await recovered.shutdown();
  reopened.close();
});

test("plan-file submission atomically registers tasks before applying dependency gates", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-plan-register-"));
  const planFile = await writeTwoWavePlan(home);
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  try {
    const result = await coordinator.submitPlanFile(planFile);
    const { foundation, first, second } = result.taskIdsByItemId;
    assert.ok(foundation && first && second);
    assert.equal(result.planId, planFile);
    assert.equal(store.getTask(foundation).status, "queued");
    assert.equal(store.getTask(first).status, "waiting");
    assert.equal(store.getTask(second).status, "waiting");
    assert.match(store.getTask(first).error ?? "", /foundation/);
    assert.equal(store.listEvents(first).at(-1)?.type, "task.waiting");
    assert.equal(store.getPlanItems(result.planId).length, 3);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("duplicate plan registration rolls back only the second staged execution", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-plan-duplicate-"));
  const planFile = await writeTwoWavePlan(home);
  const plan = (await assertWorkPlan(planFile)).plan;
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  try {
    const first = coordinator.submitPlan(plan);
    const originalTaskIds = Object.values(first.taskIdsByItemId).sort();

    assert.throws(() => coordinator.submitPlan(plan), /UNIQUE constraint failed/);
    assert.equal(store.listPlans().length, 1);
    assert.deepEqual(store.listTasks().map((task) => task.id).sort(), originalTaskIds);
    for (const taskId of originalTaskIds) {
      assert.equal(store.listEvents(taskId).filter((event) => event.type === "task.created").length, 1);
    }
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("daemon exposes plan submission and stable read-only board responses", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-board-daemon-"));
  const planFile = await writeTwoWavePlan(home);
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const submitted = await daemonRequest<{
      planId: string;
      taskIdsByItemId: Record<string, string>;
    }>("plan_submit_file", { planFile }, home);
    assert.equal(submitted.planId, planFile);
    assert.deepEqual(Object.keys(submitted.taskIdsByItemId).sort(), ["first", "foundation", "second"]);

    const first = await daemonRequest<PlanBoard>("plan_board", { planId: submitted.planId }, home);
    const second = await daemonRequest<PlanBoard>("plan_board", { planId: submitted.planId }, home);
    assert.deepEqual(second, first);
    assert.equal(first.plan.progress.total, 3);
    assert.equal(first.plan.progress.waiting, 2);

    const overview = await daemonRequest<PlanBoardSummary[]>(
      "plan_board_overview",
      { limit: 0 },
      home,
    );
    assert.deepEqual(overview, [first.plan]);
  } finally {
    await daemon.close();
  }
});

test("resume rejects when stored attempts equal configured maxAttempts", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-maxattempts-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  settings.update({ execution: { maxAttempts: 2 } });
  const coordinator = new DaemonCoordinator(store, settings, 0);
  const task = registerTaskFromSpec(
    store,
    {
      version: 1,
      name: "exhausted",
      project: "/tmp",
      goal: "test",
      constraints: [],
      provider: { name: "deepseek", model: "v4", keychainService: "t" },
      runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: 0.1 },
      workspace: { exclude: [] },
      worker: { allowEdits: false, allowedCommands: [], focusPaths: [] },
      acceptance: { commands: ["true"] },
    },
    "forklight://test/exhausted",
  );
  for (const status of ["interrupted", "failed"] as const) {
    store.setTaskStatus(task.id, status, { error: null });
  }
  // Seed 2 attempts so next attempt equals maxAttempts
  store.createAttempt({ id: "a1", taskId: task.id, ordinal: 1, status: "interrupted", sessionId: task.sessionId, rawLogPath: "/dev/null", startedAt: new Date().toISOString() });
  store.createAttempt({ id: "a2", taskId: task.id, ordinal: 2, status: "failed", sessionId: task.sessionId, rawLogPath: "/dev/null", startedAt: new Date().toISOString() });
  store.setTaskStatus(task.id, "failed", { error: "some error" });
  assert.throws(
    () => coordinator.resume(task.id),
    /reached maximum attempts/,
  );
  await coordinator.shutdown();
  store.close();
});

test("live concurrency change is visible without rebuilding the coordinator", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-liveconcurrency-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const coordinator = new DaemonCoordinator(store, settings);
  assert.equal(coordinator.health().maxConcurrency, 2);
  settings.update({ execution: { maxConcurrency: 5 } });
  assert.equal(coordinator.health().maxConcurrency, 5);
  await coordinator.shutdown();
  store.close();
});

test("settings-readiness flows providerDefaults from effective settings", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-provdef-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  // Update a specific provider default.
  settings.update({
    providerDefaults: { deepseek: { defaultModel: "deepseek-v4-pro" } },
  });
  const coordinator = new DaemonCoordinator(store, settings, 0);
  const health = coordinator.health();
  const providers = health.providers as Record<string, { defaultModel: string }>;
  assert.equal(providers.deepseek?.defaultModel, "deepseek-v4-pro");
  await coordinator.shutdown();
  store.close();
});

test("daemon settings get returns complete effective settings", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-settings-get-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const settings = await daemonRequest<Record<string, unknown>>("settings_get", {}, home);
    assert.equal(settings.version, 1);
    assert.equal((settings.execution as Record<string, unknown>).maxConcurrency, 2);
    assert.equal((settings.execution as Record<string, unknown>).defaultProvider, "deepseek");
    assert.equal(
      ((settings.competition as Record<string, unknown>).rankingWeights as Record<string, number>).duration,
      0,
    );
  } finally {
    await daemon.close();
  }
});

test("daemon settings update partial patch reads back unchanged fields", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-settings-patch-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const updated = await daemonRequest<Record<string, unknown>>(
      "settings_update",
      { patch: { competition: { rankingWeights: { duration: 0.5 } } } },
      home,
    );
    const rw = ((updated.competition as Record<string, unknown>).rankingWeights as Record<string, number>);
    assert.equal(rw.duration, 0.5);
    assert.equal(rw.verification, 1); // unchanged
    assert.equal((updated.execution as Record<string, unknown>).maxConcurrency, 2); // unchanged

    // Immediate read confirms persistence
    const reloaded = await daemonRequest<Record<string, unknown>>("settings_get", {}, home);
    assert.equal(
      ((reloaded.competition as Record<string, unknown>).rankingWeights as Record<string, number>).duration,
      0.5,
    );
  } finally {
    await daemon.close();
  }
});

test("daemon settings rejects invalid patch and preserves prior state", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-settings-reject-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    // First, set a valid value
    await daemonRequest("settings_update", {
      patch: { execution: { maxConcurrency: 5 } },
    }, home);
    const before = await daemonRequest<Record<string, unknown>>("settings_get", {}, home);
    assert.equal((before.execution as Record<string, unknown>).maxConcurrency, 5);

    // Attempt invalid update
    await assert.rejects(
      async () =>
        daemonRequest("settings_update", {
          patch: { execution: { maxConcurrency: -1 } },
        }, home),
      /positive integer/,
    );

    // State unchanged
    const after = await daemonRequest<Record<string, unknown>>("settings_get", {}, home);
    assert.equal((after.execution as Record<string, unknown>).maxConcurrency, 5);
  } finally {
    await daemon.close();
  }
});

test("daemon settings rejects credential-like fields in patch", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-settings-cred-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    await assert.rejects(
      async () =>
        daemonRequest("settings_update", {
          patch: { apiSecret: "abc" },
        }, home),
      /credential/,
    );
    await assert.rejects(
      async () =>
        daemonRequest("settings_update", {
          patch: { execution: { authToken: "xyz" } },
        }, home),
      /credential/,
    );
  } finally {
    await daemon.close();
  }
});

test("daemon settings reset restores built-in defaults", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-settings-reset-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    await daemonRequest("settings_update", {
      patch: { execution: { maxConcurrency: 8 }, competition: { rankingWeights: { duration: 0.9 } } },
    }, home);
    const before = await daemonRequest<Record<string, unknown>>("settings_get", {}, home);
    assert.equal((before.execution as Record<string, unknown>).maxConcurrency, 8);

    const reset = await daemonRequest<Record<string, unknown>>("settings_reset", {}, home);
    assert.equal((reset.execution as Record<string, unknown>).maxConcurrency, 2);
    assert.equal(
      ((reset.competition as Record<string, unknown>).rankingWeights as Record<string, number>).duration,
      0,
    );

    // Store confirms reset
    const after = await daemonRequest<Record<string, unknown>>("settings_get", {}, home);
    assert.equal((after.execution as Record<string, unknown>).maxConcurrency, 2);
  } finally {
    await daemon.close();
  }
});

test("daemon settings apply-file loads YAML and updates", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-settings-file-"));
  const settingsFile = path.join(home, "settings.yaml");
  await writeFile(
    settingsFile,
    "execution:\n  maxConcurrency: 7\n  defaultProvider: qwen\n",
  );
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const result = await daemonRequest<Record<string, unknown>>(
      "settings_apply_file",
      { file: settingsFile },
      home,
    );
    assert.equal((result.execution as Record<string, unknown>).maxConcurrency, 7);
    assert.equal((result.execution as Record<string, unknown>).defaultProvider, "qwen");
    assert.equal((result.execution as Record<string, unknown>).defaultMaxBudgetUsd, 0.5); // unchanged
  } finally {
    await daemon.close();
  }
});

test("daemon settings apply-file rejects non-object YAML", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-settings-nonobj-"));
  const settingsFile = path.join(home, "scalar.yaml");
  await writeFile(settingsFile, "just a string\n");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    await assert.rejects(
      async () =>
        daemonRequest("settings_apply_file", { file: settingsFile }, home),
      /must contain.*object/,
    );
  } finally {
    await daemon.close();
  }
});

test("daemon settings rejects non-object patch in update", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-settings-badpatch-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    await assert.rejects(
      async () => daemonRequest("settings_update", {}, home),
      /non-null object/,
    );
    await assert.rejects(
      async () => daemonRequest("settings_update", { patch: null }, home),
      /non-null object/,
    );
    await assert.rejects(
      async () => daemonRequest("settings_update", { patch: [1, 2] }, home),
      /non-null object/,
    );
  } finally {
    await daemon.close();
  }
});

test("health includes provider verification state without triggering a probe", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-provverify-"));
  const daemon = new ForkLightDaemon(home, 0);
  const observer = new StateStore(home);
  await daemon.start();
  try {
    const first = await daemonRequest<Record<string, unknown>>("health", {}, home);
    const pv1 = first.providerVerification as Record<string, Record<string, unknown>> | undefined;
    assert.ok(pv1 !== undefined, "health must include providerVerification");
    assert.ok("deepseek" in pv1);
    assert.ok("qwen" in pv1);

    // Never exposes keychainExists through health
    for (const [name, status] of Object.entries(pv1)) {
      assert.equal("keychainExists" in (status as object), false,
        `health must not leak keychainExists for ${name}`);
    }

    // Repeated health reads do not change verification state
    const second = await daemonRequest<Record<string, unknown>>("health", {}, home);
    assert.deepEqual(second.providerVerification, first.providerVerification);

    // A third health read confirms no probe cost occurred
    const third = await daemonRequest<Record<string, unknown>>("health", {}, home);
    assert.deepEqual(third.providerVerification, first.providerVerification);
    for (const name of ["deepseek", "qwen", "minimax", "glm"]) {
      assert.equal(observer.getProbeEvidence(name), undefined, `health must not probe ${name}`);
    }
  } finally {
    await daemon.close();
    observer.close();
  }
});

test("all-provider probing honors configured concurrency and preserves provider order", async () => {
  let active = 0;
  let peak = 0;
  const names = ["deepseek", "qwen", "minimax", "glm"] as const;
  const results = await probeProvidersBounded(
    names,
    { maxProbeConcurrency: 2 },
    async (provider) => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(provider === "deepseek" ? 15 : 5);
      active -= 1;
      return {
        provider,
        model: `${provider}-model`,
        endpointOrigin: "https://example.test",
        status: "verified",
        latencyMs: 1,
        timestamp: "2026-07-22T00:00:00.000Z",
      };
    },
  );
  assert.equal(peak, 2);
  assert.deepEqual(Object.keys(results), names);
});

test("daemon provider_status returns cached evidence without probing", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-provstat-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const all = await daemonRequest<Record<string, unknown>>("provider_status", {}, home);
    assert.ok("deepseek" in all);
    assert.ok("qwen" in all);
    assert.ok("minimax" in all);
    assert.ok("glm" in all);
    for (const [name, status] of Object.entries(all)) {
      const s = status as Record<string, unknown>;
      assert.ok(typeof s.status === "string", `${name} must have a status string`);
      assert.ok(typeof s.model === "string", `${name} must have a model string`);
    }

    // Single provider status
    const single = await daemonRequest<Record<string, unknown>>(
      "provider_status",
      { provider: "deepseek" },
      home,
    );
    assert.ok("deepseek" in single);
    assert.equal(Object.keys(single).length, 1);
    const ds = single.deepseek as Record<string, unknown>;
    assert.equal(typeof ds.status, "string");
    assert.equal(typeof ds.model, "string");
  } finally {
    await daemon.close();
  }
});

test("daemon settings defaultProvider change flows into omitted inline task fields", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-defprov-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    await daemonRequest("settings_update", {
      patch: { execution: { defaultProvider: "qwen", defaultEffort: "low" } },
    }, home);

    // Submit a task that omits provider; daemon should use effective settings
    const task = await daemonRequest<TaskRecord>(
      "submit",
      {
        baseDirectory: home,
        task: {
          version: 2,
          name: "default-provider-task",
          project: path.join(home, "missing-project"),
          contract: {
            outcome: "Verify provider default",
            context: ["Test"],
            inScope: ["Test"],
            outOfScope: ["Nothing"],
            executionSteps: ["Run test"],
            deliverables: ["Result"],
            modules: [{ name: "m", responsibility: "test module stuff", consumes: ["x"], produces: ["y"], boundaries: ["z"] }],
            callChain: ["A -> B", "B -> C"],
            scenarios: [{ name: "s1", given: "x", when: "y", then: "z" }, { name: "s2", given: "a", when: "b", then: "c" }],
            risks: ["None"],
            changeBudget: { maxFiles: 3, maxDiffLines: 100 },
          },
          runtime: { name: "claude-code" },
          worker: { allowedCommands: [], focusPaths: ["src"] },
          acceptance: { criteria: ["Works"], commands: ["true"] },
        },
      },
      home,
    );
    assert.equal(task.spec.provider.name, "qwen");
    assert.equal(task.spec.provider.model, "qwen3.7-plus"); // qwen default model from settings
    assert.equal(task.spec.runtime.effort, "low");
  } finally {
    await daemon.close();
  }
});

test("daemon health providers reflect persisted Provider defaults", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-provhealth-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    // Update provider defaults to a non-built-in model and endpoint.
    await daemonRequest("settings_update", {
      patch: {
        providerDefaults: {
          deepseek: {
            defaultModel: "deepseek-v4-pro",
            defaultEndpoint: "https://api.deepseek-custom.example.com/anthropic",
            defaultKeychainService: "forklight.deepseek.custom-key",
          },
        },
      },
    }, home);

    const health = await daemonRequest<Record<string, unknown>>("health", {}, home);
    const providers = health.providers as Record<string, Record<string, unknown>>;
    assert.ok(providers.deepseek, "health must include deepseek provider");
    assert.equal(providers.deepseek.defaultModel, "deepseek-v4-pro");
    assert.equal(providers.deepseek.endpoint, "https://api.deepseek-custom.example.com/anthropic");
    assert.equal(providers.deepseek.keychainService, "forklight.deepseek.custom-key");

    // Verify other providers retain their defaults.
    assert.ok(providers.qwen, "health must include qwen provider");
    assert.ok(providers.glm, "health must include glm provider");
    assert.equal(providers.qwen!.defaultModel, "qwen3.7-plus");
    assert.equal(providers.glm!.defaultModel, "glm-5.2");

    // Never exposes credential values.
    const serialized = JSON.stringify(health);
    assert.equal(serialized.includes("password"), false);
    assert.equal(serialized.includes("secret"), false);
    assert.equal(serialized.includes("apiKey"), false);
  } finally {
    await daemon.close();
  }
});

// --- task_economics daemon integration ---

test("task_economics returns separated economics evidence via the daemon", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-econ-daemon-"));
  // Pre-seed a Task, Attempt, and exchange receipt into the database before
  // starting the daemon so the daemon's StateStore picks them up.
  {
    const store = new StateStore(home);
    const TS = "2026-07-23T12:00:00.000Z";
    store.createTask({
      id: "econ-known", name: "econ-known", status: "succeeded",
      sourcePath: "/tmp/src", taskFile: "/tmp/econ-known.yaml",
      spec: {
        version: 2, name: "econ-known", project: "/tmp/proj",
        provider: { name: "deepseek", model: "deepseek-v4-pro", endpoint: "https://api.deepseek.com", keychainService: "fk" },
        runtime: { name: "claude-code", executable: "claude", effort: "medium", maxBudgetUsd: 10 },
        workspace: { exclude: [] },
        worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
        contract: { outcome: "", context: [], inScope: [], outOfScope: [], executionSteps: [], deliverables: [],
          modules: [{ name: "m", responsibility: "r", consumes: ["x"], produces: ["y"], boundaries: ["z"] }],
          callChain: ["A -> B"], scenarios: [{ name: "s1", given: "x", when: "y", then: "z" }],
          risks: ["None"], changeBudget: { maxFiles: 3, maxDiffLines: 100 } },
        acceptance: { criteria: [], commands: ["true"] },
      },
      paths: { root: "/x", baseline: "/x", workspace: "/x", logs: "/x", claudeConfig: "/x", diff: "/x" },
      sessionId: "s-econ-known", createdAt: TS, updatedAt: TS,
    } as TaskRecord);
    store.createAttempt({
      id: "ea1", taskId: "econ-known", ordinal: 1, status: "succeeded",
      sessionId: "s-econ-known", rawLogPath: "/tmp/ea1.log",
      startedAt: TS, finishedAt: TS, exitCode: 0,
      usage: { inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
        source: "terminal-result" as const, complete: true },
      runtimeCostEstimateUsd: 3.25,
      officialCost: {
        stage: "calculation" as const, quoted: true as const,
        result: {
          quoted: true as const, currency: "USD" as const, total: 0.07,
          components: [
            { component: "input", tokens: 1000, ratePerMillion: 0.5, amount: 0.5 },
            { component: "output", tokens: 1000, ratePerMillion: 1.0, amount: 1.0 },
          ],
          pricing: {
            provider: "deepseek", origin: "https://api.deepseek.com", route: "deepseek-direct-payg",
            modelAliases: ["deepseek-v4-pro"], serviceTier: "standard", currency: "USD" as const,
            unitTokens: 1_000_000,
            source: { url: "https://api-docs.deepseek.com/quick_start/pricing/", checkedAt: TS },
            promotion: null,
          },
          appliedTier: { applied: [{ minimumInputTokensExclusive: null, totalPromptInput: 1000 }], totalPromptInput: 1000 },
          usageSource: "terminal-result" as const, providerBillClaim: false,
        },
      },
    });
    store.saveExchangeReceipt({
      id: "er1", taskId: "econ-known", operation: "build", transport: "mcp" as const,
      capturedAt: TS, outcome: "success" as const,
      requestArguments: { direction: "request", operation: "build", taskId: "econ-known",
        timestamp: TS, utf8Bytes: 1000, asciiCount: 900, nonAsciiCount: 100 },
      responseRelationship: "may-overlap" as const,
    });
    store.close();
  }

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const report = await daemonRequest<Record<string, unknown>>(
      "task_economics", { taskId: "econ-known" }, home,
    );
    assert.equal(report.taskId, "econ-known");
    // Budget: capped
    const budget = report.runtimeBudget as Record<string, unknown>;
    assert.equal(budget.maxBudgetUsd, 10);
    assert.equal(budget.capped, true);
    assert.equal(budget.label, "capped");
    // Runtime estimate: complete
    const est = report.runtimeEstimate as Record<string, unknown>;
    assert.equal(est.observedTotalUsd, 3.25);
    assert.equal(est.complete, true);
    // Official cost: USD, not a provider bill
    const oc = report.officialCost as Record<string, unknown>;
    const totals = oc.totals as Array<Record<string, unknown>>;
    assert.equal(totals.length, 1);
    assert.equal(totals[0]!.currency, "USD");
    assert.equal(totals[0]!.total, 0.07);
    assert.equal(totals[0]!.providerBillClaim, false);
    // Token report: Worker volume present; Codex savings unavailable
    const tr = report.tokenReport as Record<string, unknown>;
    assert.equal(tr.taskId, "econ-known");
    const trr = tr.report as Record<string, unknown>;
    const dcs = trr.directCodexSavings as Record<string, unknown>;
    assert.equal(dcs.available, false);
    assert.ok(typeof dcs.reason === "string" && (dcs.reason as string).length > 0,
      "directCodexSavings must state an explicit unavailable reason");
    const wv = trr.workerVolume as Record<string, unknown>;
    assert.ok(wv.kind === "complete" || wv.kind === "incomplete",
      `workerVolume kind must be complete or incomplete, got ${String(wv.kind)}`);
    // No raw task contract, diff, or credentials leaked
    const json = JSON.stringify(report);
    assert.ok(!json.includes("outcome"), "report must not leak contract body");
    assert.ok(!json.includes("executionSteps"), "report must not leak contract body");
    assert.ok(!json.includes("resultText"), "report must not leak attempt result");
    assert.ok(!json.includes("error"), "report must not leak attempt error");
    assert.ok(!json.includes("rawLogPath"), "report must not leak log paths");
    assert.ok(!json.includes("keychainService"), "report must not leak keychain identifier");
  } finally {
    await daemon.close();
  }
});

test("task_economics reports unavailable evidence explicitly through daemon", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-econ-unavail-"));
  {
    const store = new StateStore(home);
    const TS = "2026-07-23T12:00:00.000Z";
    store.createTask({
      id: "econ-missing", name: "econ-missing", status: "interrupted",
      sourcePath: "/tmp/src", taskFile: "/tmp/econ-missing.yaml",
      spec: {
        version: 2, name: "econ-missing", project: "/tmp/proj",
        provider: { name: "deepseek", model: "deepseek-v4-pro", endpoint: "https://api.deepseek.com", keychainService: "fk" },
        runtime: { name: "claude-code", executable: "claude", effort: "medium", maxBudgetUsd: null },
        workspace: { exclude: [] },
        worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
        contract: { outcome: "", context: [], inScope: [], outOfScope: [], executionSteps: [], deliverables: [],
          modules: [], callChain: [], scenarios: [], risks: [], changeBudget: { maxFiles: 1, maxDiffLines: 100 } },
        acceptance: { criteria: [], commands: ["true"] },
      },
      paths: { root: "/x", baseline: "/x", workspace: "/x", logs: "/x", claudeConfig: "/x", diff: "/x" },
      sessionId: "s-econ-missing", createdAt: TS, updatedAt: TS,
    } as TaskRecord);
    // Attempt without official cost and without runtimeCostEstimateUsd
    store.createAttempt({
      id: "eb1", taskId: "econ-missing", ordinal: 1, status: "interrupted",
      sessionId: "s-econ-missing", rawLogPath: "/tmp/eb1.log",
      startedAt: TS, finishedAt: TS, exitCode: 0,
    });
    // Attempt with usage but without officialCost — usage only, no quote
    store.createAttempt({
      id: "eb2", taskId: "econ-missing", ordinal: 2, status: "interrupted",
      sessionId: "s-econ-missing", rawLogPath: "/tmp/eb2.log",
      startedAt: TS, finishedAt: TS, exitCode: 0,
      usage: { inputTokens: 500, outputTokens: 250, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
        source: "terminal-result" as const, complete: true },
      runtimeCostEstimateUsd: 1.5,
    });
    store.close();
  }

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const report = await daemonRequest<Record<string, unknown>>(
      "task_economics", { taskId: "econ-missing" }, home,
    );
    // Budget: uncapped
    const budget = report.runtimeBudget as Record<string, unknown>;
    assert.equal(budget.maxBudgetUsd, null);
    assert.equal(budget.capped, false);
    assert.equal(budget.label, "uncapped");
    // Runtime: incomplete — one estimate, one missing
    const est = report.runtimeEstimate as Record<string, unknown>;
    assert.equal(est.observedTotalUsd, 1.5);
    assert.equal(est.sampleCount, 1);
    assert.equal(est.missingCount, 1);
    assert.equal(est.complete, false);
    // Official cost: both unavailable, no zero-fabrication
    const oc = report.officialCost as Record<string, unknown>;
    const unavailable = oc.unavailable as Record<string, unknown>;
    assert.equal(unavailable.unavailableCount, 2);
    const entries = unavailable.entries as Array<Record<string, unknown>>;
    assert.equal(entries.length, 2);
    // No officialCost record → missing stage
    assert.equal(entries[0]!.stage, "missing");
    assert.equal(entries[0]!.reason, "missing-officialCost-record");
    assert.equal(entries[1]!.stage, "missing");
    assert.equal(entries[1]!.reason, "missing-officialCost-record");
    // Totals are empty — no currency totals fabricated
    const totals = oc.totals as Array<unknown>;
    assert.equal(totals.length, 0);
    // Token report: directCodexSavings unavailable
    const tr = report.tokenReport as Record<string, unknown>;
    const trr = tr.report as Record<string, unknown>;
    const dcs = trr.directCodexSavings as Record<string, unknown>;
    assert.equal(dcs.available, false);
    assert.ok(typeof dcs.reason === "string" && (dcs.reason as string).length > 0);
  } finally {
    await daemon.close();
  }
});

test("task_economics rejects nonexistent Task through the existing error path", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-econ-missing-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    await assert.rejects(
      async () => daemonRequest("task_economics", { taskId: "no-such-task" }, home),
      /Unknown ForkLight task/,
    );
  } finally {
    await daemon.close();
  }
});

test("daemon plan submission works with spaces in directory path", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight spaced path test-"));
  const planFile = path.join(home, "two wave plan.yaml");
  const taskRef = path.resolve("examples/deepseek-checkout.yaml");
  await writeFile(
    planFile,
    JSON.stringify({
      version: 1,
      name: "Plan with spaces in directory",
      objective: "Verify spaces in paths do not break plan registration",
      items: [
        { id: "foundation", task: taskRef, dependsOn: [] },
        { id: "second", task: taskRef, dependsOn: ["foundation"] },
      ],
    }),
  );

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const result = await daemonRequest<{
      planId: string;
      taskIdsByItemId: Record<string, string>;
    }>("plan_submit_file", { planFile }, home);
    assert.equal(result.planId, planFile);
    assert.equal(Object.keys(result.taskIdsByItemId).length, 2);
    assert.ok(result.taskIdsByItemId.foundation);
    assert.ok(result.taskIdsByItemId.second);

    // Verify tasks are registered.
    const board = await daemonRequest<PlanBoard>(
      "plan_board",
      { planId: result.planId },
      home,
    );
    assert.equal(board.plan.progress.total, 2);
  } finally {
    await daemon.close();
  }
});

// --- revise: succeeded-only pre-integration correction ---

test("revise moves eligible succeeded task to queued with content-free event", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-revise-ok-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  const task = standaloneSucceededTask(store, "eligible-standalone");
  // Seed live-attempt pointers so prepareReviseTask must clear them.
  store.setTaskStatus(task.id, "running", {
    startedAt: new Date().toISOString(),
    currentAttemptId: "seed-attempt",
    workerPid: 99999,
  });
  store.setTaskStatus(task.id, "succeeded", { error: null });
  const feedback = `Please tighten the contract. ${REVISE_PROBE}`;
  try {
    const returned = coordinator.revise(task.id, feedback);
    assert.equal(returned.id, task.id);
    assert.equal(returned.status, "queued",
      "revise must return the canonical queued record");
    const after = store.getTask(task.id);
    assert.equal(after.status, "queued");
    // Every terminal and live-attempt field is cleared; sessionId is preserved.
    for (const cleared of ["finishedAt", "error", "workerPid", "currentAttemptId", "startedAt"] as const) {
      assert.equal(after[cleared], undefined, `${cleared} must be cleared`);
    }
    assert.equal(after.sessionId, task.sessionId);
    // Content-free revision event with the canonical fixed summary.
    const revisionEvent = store.listEvents(task.id)
      .find((event) => event.type === "task.revise.requested");
    assert.ok(revisionEvent, "task.revise.requested event must be recorded");
    assert.equal(revisionEvent!.summary, "Task revision requested for main-review correction");
    assert.ok(!JSON.stringify(revisionEvent).includes(REVISE_PROBE),
      "revision event payload must never contain feedback text");
    assert.deepEqual(coordinator.health().queuedTaskIds, [task.id]);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("revise rejection gates: each ineligibility is rejected with a fixed privacy-safe reason", async () => {
  const cases: Array<{
    label: string;
    homePrefix: string;
    seed: (store: StateStore, task: TaskRecord) => void;
    expectedStatus?: TaskRecord["status"];
    reason: RegExp;
  }> = [
    {
      label: "non-succeeded", homePrefix: "forklight-revise-status-",
      seed: () => { /* status set to "failed" by helper */ },
      expectedStatus: "failed", reason: /revision requires succeeded Task/,
    },
    {
      label: "plan-member", homePrefix: "forklight-revise-plan-",
      seed: (store, task) => {
        const ts = new Date().toISOString();
        store.createPlanGraph(
          { id: "p1", name: "p1", objective: "test", planFile: "/tmp/p1.yaml",
            createdAt: ts, updatedAt: ts },
          [{ id: "p1-item", planId: "p1", taskId: task.id, itemIndex: 0, taskFile: "/tmp/p1.yaml" }],
          [],
        );
      },
      reason: /revision rejected: Task belongs to a plan/,
    },
    {
      label: "competition-candidate", homePrefix: "forklight-revise-comp-",
      seed: (store, task) => {
        const sibling = standaloneSucceededTask(store, "comp-sibling");
        const ts = new Date().toISOString();
        store.createCompetition(
          { id: "c1", name: "c1", contractTaskId: task.id, status: "running",
            rankingPolicy: { weights: { verification: 1, diffFocus: 0, retries: 0, cost: 0, duration: 0, delivery: 0 },
              tieThreshold: 1e-9 },
            createdAt: ts, updatedAt: ts },
          [
            { id: "cc1", competitionId: "c1", taskId: task.id, ordinal: 0,
              providerName: "deepseek", modelName: "deepseek-v4-flash" },
            { id: "cc2", competitionId: "c1", taskId: sibling.id, ordinal: 1,
              providerName: "deepseek", modelName: "deepseek-v4-flash" },
          ],
        );
      },
      reason: /revision rejected: Task is a competition candidate/,
    },
    {
      label: "integration-history", homePrefix: "forklight-revise-int-",
      seed: (store, task) => {
        // Persist a canonical integration receipt first (FK requirement),
        // then its result; any IntegrationResult status keeps the Task ineligible.
        const ts = new Date().toISOString();
        store.saveIntegrationReceipt({
          id: "ir-r", taskId: task.id, patchDigest: "x", affectedFiles: [],
          rejectionReasons: [], sourceEvidence: {}, createdAt: ts,
          expiresAt: ts, consumed: false,
        });
        store.saveIntegrationResult({
          id: "ir1", receiptId: "ir-r", taskId: task.id, status: "rejected",
          createdAt: ts,
        });
      },
      reason: /revision rejected: Task has integration history/,
    },
    {
      label: "exhausted-attempts", homePrefix: "forklight-revise-exhausted-",
      seed: (store, task) => {
        for (const id of ["a1", "a2"]) {
          store.createAttempt({ id, taskId: task.id, ordinal: Number(id.slice(1)),
            status: "succeeded", sessionId: task.sessionId, rawLogPath: "/dev/null",
            startedAt: new Date().toISOString() });
        }
      },
      reason: /revision requires remaining configured attempts/,
    },
  ];
  for (const c of cases) {
    const home = await mkdtemp(path.join(tmpdir(), c.homePrefix));
    const store = new StateStore(home);
    let coordinator: DaemonCoordinator;
    if (c.label === "exhausted-attempts") {
      const settings = new SettingsService(store);
      settings.update({ execution: { maxAttempts: 2 } });
      coordinator = new DaemonCoordinator(store, settings, 0);
    } else {
      coordinator = testCoordinator(store, 0);
    }
    const task = standaloneSucceededTask(store, c.label,
      c.label === "non-succeeded" ? "failed" : "succeeded");
    c.seed(store, task);
    const initialEvents = store.listEvents(task.id).length;
    try {
      assert.throws(
        () => coordinator.revise(task.id, "fix the contract"),
        c.reason,
        `case ${c.label} must reject with ${c.reason}`,
      );
      assert.equal(store.getTask(task.id).status, c.expectedStatus ?? "succeeded",
        `case ${c.label} must not change Task status`);
      assert.equal(store.listEvents(task.id).length, initialEvents,
        `case ${c.label} must not append events`);
    } finally {
      await coordinator.shutdown();
      store.close();
    }
  }
});

test("revise rejects blank/padded/oversized feedback with the character limit on the trimmed value", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-revise-fb-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  const task = standaloneSucceededTask(store, "feedback");
  const initialEvents = store.listEvents(task.id).length;
  try {
    for (const blank of ["", "   ", "\n\n", " \t \n"]) {
      assert.throws(
        () => coordinator.revise(task.id, blank),
        /revision requires explicit trimmed feedback/,
        `blank feedback ${JSON.stringify(blank)} must be rejected`,
      );
    }
    // 4000 trimmed chars wrapped in spaces is accepted (limit is on the trimmed value).
    const accepted = coordinator.revise(task.id, `   ${"x".repeat(4000)}   `);
    assert.equal(accepted.status, "queued");
    // 4097 trimmed chars is rejected regardless of padding.
    assert.throws(
      () => coordinator.revise(task.id, `   ${"y".repeat(4097)}   `),
      /revision feedback exceeds configured upper bound/,
    );
    assert.equal(store.getTask(task.id).status, "queued",
      "successful revise must have moved status before the second reject");
    // First revise added exactly one event; the second (rejected) revise added none.
    const newEvents = store.listEvents(task.id).slice(initialEvents);
    assert.equal(newEvents.filter((e) => e.type === "task.revise.requested").length, 1);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("revise rejection messages never echo feedback marker, name, path, or prompt", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-revise-privacy-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  // Pre-create the task so its name and the pre-existing task.created event
  // intentionally carry the probe.  The privacy guarantee is about the
  // rejection delta, not the legacy creation event.
  const task = registerTaskFromSpec(
    store,
    {
      version: 1,
      name: `${REVISE_PROBE}-name`,
      project: `/tmp/${REVISE_PROBE}-source`,
      goal: `goal ${REVISE_PROBE}`,
      constraints: [],
      provider: { name: "deepseek", model: "deepseek-v4-flash",
        keychainService: "forklight.test.api-key" },
      runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: 0.1 },
      workspace: { exclude: [] },
      worker: { allowEdits: false, allowedCommands: [], focusPaths: ["src"] },
      acceptance: { commands: ["true"] },
    },
    `forklight://test/${REVISE_PROBE}`,
  );
  store.setTaskStatus(task.id, "failed", { error: null });
  const countBefore = store.listEvents(task.id).length;
  let caught: unknown;
  try {
    coordinator.revise(task.id, `some ${REVISE_PROBE} feedback text`);
    assert.fail("revise should have rejected");
  } catch (error) { caught = error; }
  const message = caught instanceof Error ? caught.message : String(caught);
  assert.ok(!message.includes(REVISE_PROBE),
    `rejection message must never echo feedback, got: ${message}`);
  assert.equal(store.getTask(task.id).status, "failed");
  // Inspect ONLY the post-request event delta; a rejection must create
  // zero new events.
  const delta = store.listEvents(task.id).slice(countBefore);
  assert.equal(delta.length, 0,
    `rejection must not append any new events, got: ${JSON.stringify(delta)}`);
  assert.ok(!JSON.stringify(delta).includes(REVISE_PROBE),
    "rejection event delta must never contain feedback marker text");
  await coordinator.shutdown();
  store.close();
});

test("revise preserves prior attempts and the same session, clearing stale live-attempt state", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-revise-history-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  const task = standaloneSucceededTask(store, "preserve-history");
  const previousSessionId = task.sessionId;
  const ts = new Date().toISOString();
  for (const a of [
    { id: "ha1", ordinal: 1, status: "succeeded" as const, exitCode: 0 },
    { id: "ha2", ordinal: 2, status: "failed" as const, exitCode: 1 },
  ]) {
    store.createAttempt({ ...a, taskId: task.id, sessionId: previousSessionId,
      rawLogPath: "/dev/null", startedAt: ts, finishedAt: ts });
  }
  const eventsBefore = store.listEvents(task.id).length;
  try {
    coordinator.revise(task.id, "fix the contract please");
    // Previous attempts remain immutable; sessionId preserved.
    const attempts = store.listAttempts(task.id);
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts.map((a) => a.id), ["ha1", "ha2"]);
    assert.equal(store.getTask(task.id).sessionId, previousSessionId);
    // Stale live-attempt fields are cleared.
    const cleared = store.getTask(task.id);
    for (const f of ["finishedAt", "error", "workerPid", "currentAttemptId", "startedAt"] as const) {
      assert.equal(cleared[f], undefined, `${f} must be cleared`);
    }
    // Only the revision event is appended; no integration or workspace mutation.
    const afterRevise = store.listEvents(task.id);
    assert.equal(afterRevise.length, eventsBefore + 1);
    assert.equal(afterRevise[afterRevise.length - 1]!.type, "task.revise.requested");
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("revise keeps ordinary resume rejecting succeeded tasks", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-revise-resume-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  const task = standaloneSucceededTask(store, "succeeded-no-resume");
  try {
    assert.throws(
      () => coordinator.resume(task.id, "any feedback"),
      /cannot resume from status succeeded/,
    );
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("revise admission rejection leaves status, attempts, and events unchanged", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-revise-admit-"));
  const store = new StateStore(home);
  // maxConcurrency=0 so pump() never processes queued jobs — the job
  // stays in the coordinator's internal queue after a successful revise.
  const coordinator = testCoordinator(store, 0);
  const task = standaloneSucceededTask(store, "admission-dupe");
  const initialEvents = store.listEvents(task.id).length;
  const initialStatus = store.getTask(task.id).status;
  try {
    // First revise succeeds and leaves a job in the queue.
    coordinator.revise(task.id, "first revise pass");
    assert.equal(store.getTask(task.id).status, "queued");
    // Reset task status to succeeded so eligibility passes on the
    // second call — but the coordinator's internal queue still holds
    // the first job.
    store.setTaskStatus(task.id, "succeeded", {
      finishedAt: new Date().toISOString(), error: null,
    });
    // Second revise must reject BEFORE mutating the task because the
    // coordinator already has this task in the queue.
    assert.throws(
      () => coordinator.revise(task.id, "second revise attempt"),
      /already queued or running/,
    );
    // Task status, attempts, and events are unchanged by the rejection.
    assert.equal(store.getTask(task.id).status, "succeeded");
    assert.equal(store.listEvents(task.id).length, initialEvents + 1,
      "only the first revise event must exist; rejection appends nothing");
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("revise rejects when daemon is closing before any task mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-revise-close-"));
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  const task = standaloneSucceededTask(store, "close-reject");
  const initialEvents = store.listEvents(task.id).length;
  try {
    await coordinator.shutdown(); // sets coordinator.closing = true
    assert.throws(
      () => coordinator.revise(task.id, "valid feedback text"),
      /shutting down/,
    );
    // Status unchanged; no events added.
    assert.equal(store.getTask(task.id).status, "succeeded");
    assert.equal(store.listEvents(task.id).length, initialEvents);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("daemon revise routes non-string feedback through shared eligibility boundary", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-revise-nonstr-"));
  const store = new StateStore(home);
  const task = standaloneSucceededTask(store, "nonstr-feedback");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    // Every non-string feedback value must produce the same canonical
    // "missing-feedback" reason as the local fallback, never echoing
    // the raw value.
    for (const nonString of [null, 123, true, [], {}]) {
      await assert.rejects(
        async () => daemonRequest("revise", { taskId: task.id, feedback: nonString }, home),
        /revision requires explicit trimmed feedback/,
      );
    }
    // Status unchanged after all rejections.
    assert.equal(store.getTask(task.id).status, "succeeded",
      "non-string feedback rejection must not mutate task status");
  } finally {
    await daemon.close();
    store.close();
  }
});

// --- direct-codex workflow daemon integration ---

const DC_EVENT = {
  type: "turn.completed",
  usage: { input_tokens: 4000, cached_input_tokens: 1000, cache_write_input_tokens: 0, output_tokens: 500, reasoning_output_tokens: 100 },
};

function dcMeta(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    sampleId: overrides?.sampleId ?? "dc-smp",
    forklightTaskId: overrides?.forklightTaskId ?? "dc-task",
    exactTaskClass: overrides?.exactTaskClass ?? "dc-class",
    directCodexProfileId: overrides?.directCodexProfileId ?? "dc-prof",
    directRunRef: overrides?.directRunRef ?? "codex-run:dc-run-abcd",
    pairingRef: overrides?.pairingRef ?? "pair:dc-pair-xyz",
    capturedAt: overrides?.capturedAt ?? "2026-07-23T12:00:00.000Z",
  };
}

function seedTaskForDC(home: string, taskId: string, taskClass: string, profileId: string): void {
  const store = new StateStore(home);
  const spec = parseTaskSpec({ version: 1, name: taskId, project: "/tmp", goal: "T",
    taskClass, directCodexProfileId: profileId, acceptance: { commands: ["true"] } }, "/tmp");
  store.createTask(buildTaskRecord({ spec, taskFile: `/tmp/${taskId}.yaml`, home, id: taskId,
    sessionId: `s-${taskId}`, createdAt: "2026-07-23T12:00:00.000Z" }));
  store.close();
}

test("daemon direct_codex_capture persists and returns canonical sample", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-dc-cap-daemon-"));
  seedTaskForDC(home, "dc-task", "dc-class", "dc-prof");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const s = await daemonRequest<Record<string, unknown>>(
      "direct_codex_capture",
      { usage: DC_EVENT, metadata: dcMeta({ forklightTaskId: "dc-task" }) },
      home,
    );
    assert.equal(s.sampleId, "dc-smp");
    assert.equal(s.forklightTaskId, "dc-task");
    assert.equal(s.exactTaskClass, "dc-class");
    assert.equal(s.inputTokens, 3000); // uncached only
    assert.equal(s.outputTokens, 500);
    assert.equal(s.complete, true);

    // Inbox shows pending
    const inbox = await daemonRequest<Array<Record<string, unknown>>>(
      "direct_codex_inbox",
      { taskClass: "dc-class", directCodexProfileId: "dc-prof" },
      home,
    );
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0]!.reviewState, "pending");
  } finally {
    await daemon.close();
  }
});

test("daemon direct_codex_review and publication pipeline", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-dc-pub-daemon-"));
  seedTaskForDC(home, "dc-task", "dc-class", "dc-prof");
  seedTaskForDC(home, "dc-task2", "dc-class", "dc-prof");
  seedTaskForDC(home, "dc-task3", "dc-class", "dc-prof");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    await daemonRequest("direct_codex_capture", { usage: DC_EVENT, metadata: dcMeta({ sampleId: "s1", forklightTaskId: "dc-task", directRunRef: "codex-run:s1", pairingRef: "pair:s1" }) }, home);
    await daemonRequest("direct_codex_capture", { usage: DC_EVENT, metadata: dcMeta({ sampleId: "s2", forklightTaskId: "dc-task2", directRunRef: "codex-run:s2", pairingRef: "pair:s2" }) }, home);
    await daemonRequest("direct_codex_capture", { usage: DC_EVENT, metadata: dcMeta({ sampleId: "s3", forklightTaskId: "dc-task3", directRunRef: "codex-run:s3", pairingRef: "pair:s3" }) }, home);

    // Review s1 accepted, s2 rejected, s3 left pending
    await daemonRequest("direct_codex_review", { confirm: true, sampleId: "s1", decision: "accepted", reviewer: "main-codex", reviewedAt: "2026-07-23T12:00:00.000Z", schemaVersion: 1 }, home);
    await daemonRequest("direct_codex_review", { confirm: true, sampleId: "s2", decision: "rejected", rejectionReason: "incomplete-evidence", reviewer: "main-codex", reviewedAt: "2026-07-23T12:00:00.000Z", schemaVersion: 1 }, home);

    const inbox = await daemonRequest<Array<Record<string, unknown>>>("direct_codex_inbox", { taskClass: "dc-class", directCodexProfileId: "dc-prof" }, home);
    assert.equal(inbox.length, 3);
    const states = inbox.map(it => it.reviewState).sort();
    assert.deepEqual(states, ["accepted", "pending", "rejected"]);

    // Preview
    const p = await daemonRequest<Record<string, unknown>>("direct_codex_publication_preview", { taskClass: "dc-class", directCodexProfileId: "dc-prof" }, home);
    assert.equal(p.acceptedCount, 1); assert.equal(p.rejectedCount, 1); assert.equal(p.pendingCount, 1);
    assert.equal(p.readiness, "ready"); assert.deepEqual(p.acceptedSampleIds, ["s1"]);

    // Register
    const r = await daemonRequest<Record<string, unknown>>("direct_codex_publication_register", {
      confirm: true, method: "paired-sample-v1", confidence: "low",
      createdAt: "2026-07-23T12:00:00.000Z", taskClass: "dc-class", directCodexProfileId: "dc-prof",
    }, home);
    assert.equal((r.summary as Record<string, unknown>).version, 1);
    assert.deepEqual((r.summary as Record<string, unknown>).acceptedSampleIds, ["s1"]);
  } finally {
    await daemon.close();
  }
});

test("daemon direct_codex_review rejects missing confirm and duplicate decisions", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-dc-revguard-daemon-"));
  seedTaskForDC(home, "dc-task", "dc-class", "dc-prof");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    await daemonRequest("direct_codex_capture", { usage: DC_EVENT, metadata: dcMeta({ sampleId: "g1", forklightTaskId: "dc-task", directRunRef: "codex-run:g1", pairingRef: "pair:g1" }) }, home);

    // Missing confirm
    await assert.rejects(
      async () => daemonRequest("direct_codex_review", { sampleId: "g1", decision: "accepted", reviewer: "main-codex", reviewedAt: "2026-07-23T12:00:00.000Z", schemaVersion: 1 }, home),
      /Review requires explicit confirm true/,
    );

    // Valid review
    await daemonRequest("direct_codex_review", { confirm: true, sampleId: "g1", decision: "accepted", reviewer: "main-codex", reviewedAt: "2026-07-23T12:00:00.000Z", schemaVersion: 1 }, home);

    // Duplicate
    await assert.rejects(
      async () => daemonRequest("direct_codex_review", { confirm: true, sampleId: "g1", decision: "rejected", rejectionReason: "incomplete-evidence", reviewer: "main-codex", reviewedAt: "2026-07-23T12:00:00.000Z", schemaVersion: 1 }, home),
      /Review already exists for this sample/,
    );
  } finally {
    await daemon.close();
  }
});

test("daemon direct_codex errors never echo payload content", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-dc-priv-daemon-"));
  seedTaskForDC(home, "dc-task", "dc-class", "dc-prof");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const secret = "daemon-dc-leak-ABC";
  try {
    await assert.rejects(
      async () => daemonRequest("direct_codex_capture", { usage: null, metadata: dcMeta() }, home),
      /Invalid Codex/,
    );
    // Corrupt review payload should not echo
    await daemonRequest("direct_codex_capture", { usage: DC_EVENT, metadata: dcMeta({ sampleId: "p1", forklightTaskId: "dc-task", directRunRef: "codex-run:p1", pairingRef: "pair:p1" }) }, home);
    await assert.rejects(
      async () => daemonRequest("direct_codex_review", { confirm: true, sampleId: "p1", decision: "accepted", reviewer: "main-codex", reviewedAt: "2026-07-23T12:00:00.000Z", schemaVersion: 1, text: secret }, home),
      /Invalid direct-Codex/,
    );
  } finally {
    await daemon.close();
  }
});

test("daemon direct_codex_publication_register rejects missing confirm", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-dc-regnoconf-daemon-"));
  seedTaskForDC(home, "dc-task", "dc-class", "dc-prof");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    await daemonRequest("direct_codex_capture", { usage: DC_EVENT, metadata: dcMeta({ sampleId: "r1", forklightTaskId: "dc-task", directRunRef: "codex-run:r1", pairingRef: "pair:r1" }) }, home);
    await daemonRequest("direct_codex_review", { confirm: true, sampleId: "r1", decision: "accepted", reviewer: "main-codex", reviewedAt: "2026-07-23T12:00:00.000Z", schemaVersion: 1 }, home);
    await assert.rejects(
      async () => daemonRequest("direct_codex_publication_register", {
        method: "v1", confidence: "low", createdAt: "2026-07-23T12:00:00.000Z",
        taskClass: "dc-class", directCodexProfileId: "dc-prof",
      }, home),
      /Registration requires explicit confirm true/,
    );
  } finally {
    await daemon.close();
  }
});

test("revise via daemon protocol surfaces the same eligibility and privacy behavior", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-revise-daemon-"));
  const store = new StateStore(home);
  const task = standaloneSucceededTask(store, "daemon-eligible");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const queued = await daemonRequest<TaskRecord>(
      "revise", { taskId: task.id, feedback: `daemon ${REVISE_PROBE} feedback` }, home,
    );
    assert.equal(queued.id, task.id);
    assert.equal(queued.status, "queued",
      "daemon must return the canonical queued record");
    assert.equal(store.getTask(task.id).status, "queued");
    // Daemon-recorded events never contain the feedback marker.
    assert.ok(!JSON.stringify(store.listEvents(task.id)).includes(REVISE_PROBE),
      "daemon-recorded events must never contain the feedback marker");
    // Whitespace-only feedback is rejected by the shared eligibility
    // boundary with the same fixed privacy-safe reason the local fallback uses.
    await assert.rejects(
      async () => daemonRequest("revise", { taskId: task.id, feedback: "   " }, home),
      /revision requires explicit trimmed feedback/,
    );
    // Plan membership must surface the same fixed rejection reason — use a
    // fresh task whose status remains succeeded so the eligibility branch
    // reaches the plan-membership check (not the status check).
    const planTask = standaloneSucceededTask(store, "daemon-plan-member");
    const planTs = new Date().toISOString();
    store.createPlanGraph(
      { id: "plan-d", name: "plan-d", objective: "test", planFile: "/tmp/plan-d.yaml",
        createdAt: planTs, updatedAt: planTs },
      [{ id: "item-d", planId: "plan-d", taskId: planTask.id, itemIndex: 0, taskFile: "/tmp/plan-d.yaml" }],
      [],
    );
    await assert.rejects(
      async () => daemonRequest("revise", { taskId: planTask.id, feedback: "eligible" }, home),
      /revision rejected: Task belongs to a plan/,
    );
  } finally {
    await daemon.close();
    store.close();
  }
});
