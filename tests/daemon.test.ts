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
import { registerTaskFromSpec } from "../src/core/runner.js";
import { ForkLightDaemon } from "../src/daemon/server.js";
import { SettingsService } from "../src/core/settings.js";
import { StateStore } from "../src/state/store.js";

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
