/**
 * FL-109C1 Daemon/Hub endpoint tests.
 *
 * Proves the Hub `/api/ops/work-hierarchy` read bridge forwards the Core-owned
 * Task action policy on every card unchanged — never recomputes eligibility,
 * never invents a status mutation, and never calls a mutating daemon method.
 * The daemon method itself is the canonical Core projection covered by
 * tests/work-hierarchy.test.ts and tests/task-action-policy.test.ts.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SettingsService } from "../src/core/settings.js";
import { HubServer } from "../src/hub/server.js";
import { SetupService } from "../src/setup/service.js";
import type { SetupKeychainStore, SetupSystemInspector } from "../src/setup/types.js";
import { StateStore } from "../src/state/store.js";

class MemoryKeychain implements SetupKeychainStore {
  readonly values = new Map<string, string>();
  private id(s: string, a: string): string { return `${a}:${s}`; }
  has(s: string, a: string): boolean { return this.values.has(this.id(s, a)); }
  read(s: string, a: string): string | undefined { return this.values.get(this.id(s, a)); }
  write(s: string, a: string, v: string): void { this.values.set(this.id(s, a), v); }
  delete(s: string, a: string): void { this.values.delete(this.id(s, a)); }
}

function inspector(): SetupSystemInspector {
  return {
    platform: () => "darwin",
    nodeVersion: () => "v24.5.0",
    account: () => "hub-ops-user",
    commandExists: () => true,
  };
}

function doGet(
  url: string,
  token?: string,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers["x-forklight-hub-token"] = token;
    get(url, { headers }, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
      res.on("end", () => {
        let parsed: unknown = data;
        try { if (data) parsed = JSON.parse(data); } catch { /* raw */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    }).on("error", reject);
  });
}

const TS = "2026-08-03T12:00:00.000Z";

const COLUMNS = [
  { code: "not-started", order: 0 },
  { code: "ready", order: 1 },
  { code: "running", order: 2 },
  { code: "waiting-verification", order: 3 },
  { code: "waiting-user-decision", order: 4 },
  { code: "completed", order: 5 },
  { code: "stopped-failed", order: 6 },
];

function depHeldCard(): Record<string, unknown> {
  return {
    taskId: "task-dep",
    name: "Dep held",
    column: "not-started",
    placementReason: "dependency-unsatisfied",
    status: "queued",
    provider: "deepseek",
    model: "v4",
    runtime: "claude-code",
    project: "/tmp/proj",
    breadcrumb: { taskId: "task-dep", taskName: "Dep held", planId: "plan-1", planName: "Plan" },
    namedDependencies: [],
    namedRequiredBy: [],
    blockers: [],
    whatCompleted: "Nothing completed yet.",
    nextAction: "Waiting on prerequisite: Blocker.",
    updatedAt: TS,
    actionPolicy: {
      schemaVersion: 1,
      nextCheckpoint: "Wait for the Task prerequisites to be satisfied.",
      destinations: {
        "not-started": {
          column: "not-started", disposition: "no-op", reason: "already-there",
          explanation: "This Task is already in Not started.",
        },
        ready: {
          column: "ready", disposition: "automatic-only", reason: "dependency-held",
          explanation: "This Task is held by unsatisfied prerequisites; it becomes Ready automatically when they are satisfied.",
        },
        running: {
          column: "running", disposition: "automatic-only", reason: "automatic-progression",
          explanation: "The scheduler starts a Task when a Worker slot is available; no manual request exists.",
        },
        "waiting-verification": {
          column: "waiting-verification", disposition: "automatic-only", reason: "automatic-progression",
          explanation: "Independent verification runs automatically after the Worker completes; no manual request exists.",
        },
        "waiting-user-decision": {
          column: "waiting-user-decision", disposition: "no-op", reason: "no-operation",
          explanation: "No operation moves this Task to the Main decision column.",
        },
        completed: {
          column: "completed", disposition: "no-op", reason: "no-operation",
          explanation: "No operation moves this Task to Completed.",
        },
        "stopped-failed": {
          column: "stopped-failed", disposition: "no-op", reason: "no-operation",
          explanation: "No operation moves this Task to Stopped/failed.",
        },
      },
    },
  };
}

function deliveredCard(): Record<string, unknown> {
  const backward = (column: string, explanation: string) => ({
    column, disposition: "no-op", reason: "delivered-backward-blocked", explanation,
  });
  return {
    taskId: "task-delivered",
    name: "Delivered",
    column: "completed",
    placementReason: "delivered-outcome",
    status: "succeeded",
    provider: "deepseek",
    model: "v4",
    runtime: "claude-code",
    project: "/tmp/proj",
    breadcrumb: { taskId: "task-delivered", taskName: "Delivered", planId: "plan-1", planName: "Plan" },
    namedDependencies: [],
    namedRequiredBy: [],
    blockers: [],
    whatCompleted: "Delivered delivered.",
    nextAction: "No further action required.",
    updatedAt: TS,
    actionPolicy: {
      schemaVersion: 1,
      nextCheckpoint: "This Task is delivered; no further action is required.",
      destinations: {
        "not-started": backward("not-started", "Delivered Tasks cannot move backward to Not started."),
        ready: backward("ready", "Delivered Tasks cannot move backward to Ready."),
        running: backward("running", "Delivered Tasks cannot move backward to Running."),
        "waiting-verification": backward("waiting-verification", "Delivered Tasks cannot move backward to verification."),
        "waiting-user-decision": backward("waiting-user-decision", "Delivered Tasks cannot move backward to a Main decision."),
        completed: {
          column: "completed", disposition: "no-op", reason: "already-delivered",
          explanation: "This Task has a durable delivered outcome.",
        },
        "stopped-failed": backward("stopped-failed", "Delivered Tasks cannot move backward to Stopped/failed."),
      },
    },
  };
}

function hierarchyPayload(cards: Record<string, unknown>[]): Record<string, unknown> {
  const columns: Record<string, unknown[]> = {
    "not-started": [],
    ready: [],
    running: [],
    "waiting-verification": [],
    "waiting-user-decision": [],
    completed: [],
    "stopped-failed": [],
  };
  for (const card of cards) {
    (columns[card.column as string] as unknown[]).push(card);
  }
  return {
    schemaVersion: 1,
    columns: COLUMNS,
    goals: [],
    independentPlans: [{
      kind: "plan",
      planId: "plan-1",
      name: "Plan",
      objective: "Objective",
      updatedAt: TS,
      summary: {
        whatCompleted: "No Tasks completed yet.",
        blocker: "No current blocker.",
        nextAction: "Waiting on prerequisite: Blocker.",
        progress: { total: cards.length, completed: cards.filter((c) => c.column === "completed").length, percent: 0 },
      },
      columns,
    }],
    filter: { applied: {} },
  };
}

async function makeHub(daemonRequest: (method: string, params: Record<string, unknown>) => unknown) {
  const home = await mkdtemp(path.join(tmpdir(), "fl-hub-ops-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const keychain = new MemoryKeychain();
  const setup = new SetupService(settings, keychain, inspector());
  const staticDir = path.join(home, "static");
  await mkdir(staticDir, { recursive: true });
  await writeFile(path.join(staticDir, "index.html"), "<!DOCTYPE html><title>Hub</title>\n", "utf8");

  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const server = new HubServer({
    settings,
    setup,
    keychain,
    staticRoot: staticDir,
    account: () => "hub-ops-user",
    port: 0,
    ensureDaemon: async () => ({ ok: true, pid: 99 }),
    probeDaemon: async () => ({ running: true, health: { ok: true, pid: 99 } }),
    daemonRequest: async <T>(method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params });
      return daemonRequest(method, params) as T;
    },
  });
  const port = await server.start();
  return {
    base: `http://127.0.0.1:${port}`,
    token: server.getToken(),
    calls,
    cleanup: async () => {
      await server.stop();
      store.close();
    },
  };
}

test("Hub forwards the Core action policy on every work-hierarchy card unchanged", async () => {
  const payload = hierarchyPayload([depHeldCard()]);
  const ctx = await makeHub((method, _params) => {
    if (method === "work_hierarchy") return payload;
    throw new Error(`unexpected method ${method}`);
  });
  try {
    const res = await doGet(`${ctx.base}/api/ops/work-hierarchy`, ctx.token);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, payload, "Hub must forward the daemon projection unchanged");

    const hierarchy = res.body as { independentPlans: Array<{ columns: Record<string, unknown[]> }> };
    const card = hierarchy.independentPlans[0]!.columns["not-started"]![0] as Record<string, unknown>;
    const policy = card.actionPolicy as Record<string, unknown>;
    assert.equal(policy.schemaVersion, 1);
    const destinations = policy.destinations as Record<string, unknown>;
    assert.equal(Object.keys(destinations).length, 7);
    const ready = destinations.ready as Record<string, unknown>;
    assert.equal(ready.disposition, "automatic-only");
    assert.equal(ready.reason, "dependency-held");
    assert.equal(ready.operation, undefined);
    assert.ok(ctx.calls.some((c) => c.method === "work_hierarchy"));
  } finally {
    await ctx.cleanup();
  }
});

test("Hub forwards a delivered card's backward-blocked policy without mutation", async () => {
  const payload = hierarchyPayload([deliveredCard()]);
  const ctx = await makeHub((method, _params) => {
    if (method === "work_hierarchy") return payload;
    throw new Error(`unexpected method ${method}`);
  });
  try {
    const res = await doGet(`${ctx.base}/api/ops/work-hierarchy`, ctx.token);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, payload);

    const hierarchy = res.body as { independentPlans: Array<{ columns: Record<string, unknown[]> }> };
    const card = hierarchy.independentPlans[0]!.columns.completed![0] as Record<string, unknown>;
    const destinations = (card.actionPolicy as Record<string, unknown>).destinations as Record<string, unknown>;
    for (const column of ["not-started", "ready", "running", "waiting-verification", "waiting-user-decision", "stopped-failed"]) {
      const entry = destinations[column] as Record<string, unknown>;
      assert.equal(entry.disposition, "no-op", column);
      assert.equal(entry.reason, "delivered-backward-blocked", column);
      assert.equal(entry.operation, undefined, column);
    }
    assert.equal((destinations.completed as Record<string, unknown>).reason, "already-delivered");

    // The read path never called a mutating daemon method.
    const mutating = [
      "submit_file", "submit", "resume", "revise", "correct", "main_review",
      "integration_apply", "task_resolve", "task_reopen", "goal_advance", "goal_stop",
    ];
    for (const method of mutating) {
      assert.ok(!ctx.calls.some((c) => c.method === method), `${method} must not be called by the read bridge`);
    }
  } finally {
    await ctx.cleanup();
  }
});

test("Hub work-hierarchy read rejects without token", async () => {
  const payload = hierarchyPayload([depHeldCard()]);
  const ctx = await makeHub((method, _params) => {
    if (method === "work_hierarchy") return payload;
    throw new Error(`unexpected method ${method}`);
  });
  try {
    const unauthorized = await doGet(`${ctx.base}/api/ops/work-hierarchy`);
    assert.equal(unauthorized.status, 401);
    assert.equal(ctx.calls.length, 0, "no daemon call without token");
  } finally {
    await ctx.cleanup();
  }
});

test("Hub work-hierarchy daemon failure returns a bounded privacy-safe message", async () => {
  const ctx = await makeHub((method, _params) => {
    if (method === "work_hierarchy") throw new Error("boom secretValue");
    throw new Error(`unexpected method ${method}`);
  });
  try {
    const res = await doGet(`${ctx.base}/api/ops/work-hierarchy`, ctx.token);
    assert.equal(res.status, 503);
    const body = res.body as { error?: string };
    assert.equal(body.error, "Work hierarchy is unavailable right now; try again.");
    assert.ok(!JSON.stringify(body).includes("boom secretValue"));
    assert.ok(!JSON.stringify(body).includes("\n    at "), "raw stack must not leak");
  } finally {
    await ctx.cleanup();
  }
});
