/**
 * Hub health/status evidence cache.
 *
 * Locks the contract from examples/dogfood/hub-health-polling-cache-minimax.yaml:
 *   - Hub tabs polling /api/status, /api/daemon, and /api/ops/health within one
 *     TTL must share one underlying inspection (cache hits + concurrent
 *     coalescing). /api/ops/health is the normal ~2 s per-tab refresh and must
 *     not rerun daemon health evidence once per tab every refresh.
 *   - Task, Board, Plan, Competition, statistics, settings, economics reads
 *     stay uncached and current.
 *   - Successful settings / Provider key / model / Worker / Main / lifecycle
 *     mutations invalidate the affected snapshot so the next read reflects
 *     the new state. Failed mutations do not invent a fresh snapshot.
 *   - Cached responses expose a bounded checkedAt timestamp; never credentials,
 *     raw commands, paths beyond existing responses, or internal errors.
 *   - /api/ops/health reads issue only the daemon `health` method and never
 *     trigger a Provider probe or status call.
 *
 * Deterministic time is injected via HubEvidenceCache({ now, ttlMs }) so
 * the test does not rely on wall-clock timing.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { get, request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { RuntimeName } from "../src/core/runtime-names.js";
import { SettingsService } from "../src/core/settings.js";
import {
  HubEvidenceCache,
  HubServer,
} from "../src/hub/server.js";
import { SetupService } from "../src/setup/service.js";
import type {
  SetupKeychainStore,
  SetupSystemInspector,
} from "../src/setup/types.js";
import { StateStore } from "../src/state/store.js";
import {
  ensureBuiltinsRegistered,
  getWorkerAdapter,
  registerWorkerAdapter,
} from "../src/workers/registry.js";
import type {
  RuntimeSpecView,
  WorkerAdapter,
  WorkerCapabilityMatrix,
  WorkerDoctorResult,
  WorkerExecutionResult,
  WorkerRunContext,
} from "../src/workers/types.js";
import type { TaskRecord } from "../src/core/types.js";

// --- Shared fixtures -------------------------------------------------------

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
    account: () => "hub-cache-user",
    commandExists: () => true,
  };
}

function doHttp(
  u: string,
  method: "GET" | "POST",
  token?: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers["x-forklight-hub-token"] = token;
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(payload));
    }
    function onRes(res: import("node:http").IncomingMessage): void {
      let d = "";
      res.on("data", (c: Buffer) => { d += c.toString(); });
      res.on("end", () => {
        let parsed: unknown = d;
        try { if (d) parsed = JSON.parse(d); } catch { /* raw */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    }
    if (method === "GET") {
      get(u, { headers }, onRes).on("error", reject);
    } else {
      const req = request(u, { method: "POST", headers }, onRes);
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    }
  });
}

interface CacheHub {
  base: string;
  token: string;
  cache: HubEvidenceCache;
  /** Cumulative count of underlying /api/status inspections (each call runs
   * one describeProviders + one inspectPrerequisites + doctor() per adapter +
   * one probeDaemon + one listMainSurfaceStatus). */
  setupCalls: () => number;
  daemonCalls: {
    probeCount: () => number;
    ensureCount: () => number;
    /** Cumulative count of underlying daemon `health` reads (one per /api/ops/health
     * cache miss) - the expensive operations-health evidence we coalesce. */
    healthCount: () => number;
    /** Every daemonRequest method name the Hub issued, in order - used to prove
     * /api/ops/health never triggers a Provider probe or status call. */
    methods: () => string[];
  };
  daemonRunning: { get: () => boolean; set: (v: boolean) => void };
  cleanup: () => Promise<void>;
}

interface CacheHubOptions {
  ttlMs: number;
  now: () => number;
}

/** Hub with counted, dependency-injected, deterministic-time cache. */
async function makeCacheHub(options: CacheHubOptions): Promise<CacheHub> {
  const home = await mkdtemp(path.join(tmpdir(), "fl-hub-cache-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const keychain = new MemoryKeychain();
  const setup = new SetupService(settings, keychain, inspector());
  const staticDir = path.join(home, "static");
  await mkdir(staticDir, { recursive: true });
  await writeFile(path.join(staticDir, "index.html"), "<!DOCTYPE html><title>Hub</title>\n", "utf8");

  const cache = new HubEvidenceCache({ ttlMs: options.ttlMs, now: options.now });

  // Patch the real built-in doctor() methods so we can count expensive runtime
  // subprocesses (claude --version, grok help) per Hub /api/status call without
  // touching the registry state machine.
  ensureBuiltinsRegistered();
  let doctorCalls = 0;
  const wrapDoctor = (
    name: RuntimeName,
    executable: string,
    ok: boolean,
  ): void => {
    const original = getWorkerAdapter(name);
    const wrapped: WorkerAdapter = {
      name: original.name,
      displayName: original.displayName,
      defaultExecutable: original.defaultExecutable,
      capabilities(): WorkerCapabilityMatrix {
        return original.capabilities();
      },
      doctor(): WorkerDoctorResult {
        doctorCalls += 1;
        return {
          runtime: name,
          ok,
          executable,
          version: `${executable}-test`,
          issues: ok ? [] : [`${executable} not ok`],
          capabilities: this.capabilities(),
        };
      },
      validateSpec(runtime: RuntimeSpecView): void {
        original.validateSpec(runtime);
      },
      effortArgs(effort: RuntimeSpecView["effort"]): string[] {
        return original.effortArgs(effort);
      },
      toolProtocolAppendix(task: TaskRecord): string[] {
        return original.toolProtocolAppendix(task);
      },
      checkpointProtocolAppendix(task: TaskRecord): string[] {
        return original.checkpointProtocolAppendix(task);
      },
      run(ctx: WorkerRunContext): Promise<WorkerExecutionResult> {
        return original.run(ctx);
      },
    };
    registerWorkerAdapter(wrapped);
  };
  wrapDoctor("claude-code", "claude", true);
  wrapDoctor("grok-build", "grok", true);

  // Patch SetupService to count expensive inspector calls. We track both
  // describeProviders and inspectPrerequisites separately so the test can
  // assert "one fresh inspection" as a sum across both expensive sources.
  const originalDescribeProviders = setup.describeProviders.bind(setup);
  let describeProvidersCalls = 0;
  setup.describeProviders = () => {
    describeProvidersCalls += 1;
    return originalDescribeProviders();
  };
  const originalInspect = setup.inspectPrerequisites.bind(setup);
  let inspectPrereqCalls = 0;
  setup.inspectPrerequisites = () => {
    inspectPrereqCalls += 1;
    return originalInspect();
  };

  let daemonRunning = true;
  let probeCount = 0;
  let ensureCount = 0;
  let healthCalls = 0;
  const daemonMethods: string[] = [];
  const server = new HubServer({
    settings,
    setup,
    keychain,
    staticRoot: staticDir,
    account: () => "hub-cache-user",
    port: 0,
    cache,
    probeDaemon: async () => {
      probeCount += 1;
      if (!daemonRunning) return { running: false, error: "not running" };
      return { running: true, health: { ok: true, pid: 4242, buildIdentity: { buildId: "test-build" } } };
    },
    ensureDaemon: async () => {
      ensureCount += 1;
      daemonRunning = true;
      return { ok: true, pid: 4242 };
    },
    stopDaemon: async () => {
      daemonRunning = false;
      return { stopped: true, message: "stopped" };
    },
    restartDaemon: async () => {
      ensureCount += 1;
      daemonRunning = true;
      return { ok: true, pid: 4242 };
    },
    daemonRequest: async <T>(method: string) => {
      daemonMethods.push(method);
      if (method === "list_summaries") return [{ id: "t1", status: "running", provider: "deepseek", model: "m", runtime: "claude-code" }] as T;
      if (method === "plan_board_overview") return [] as T;
      if (method === "competition_list") return [] as T;
      if (method === "statistics") return [] as T;
      if (method === "settings_get") return settings.get() as T;
      if (method === "health") {
        healthCalls += 1;
        return { ok: true, pid: 4242 } as T;
      }
      throw new Error(`unexpected ${method}`);
    },
  });
  const port = await server.start();
  return {
    base: `http://127.0.0.1:${port}`,
    token: server.getToken(),
    cache,
    // One /api/status inspection = one describeProviders + one
    // inspectPrerequisites call. Both counts increment together so the max
    // is a faithful proxy for "underlying inspection ran once".
    setupCalls: () => Math.max(describeProvidersCalls, inspectPrereqCalls),
    daemonCalls: {
      probeCount: () => probeCount,
      ensureCount: () => ensureCount,
      healthCount: () => healthCalls,
      methods: () => [...daemonMethods],
    },
    daemonRunning: {
      get: () => daemonRunning,
      set: (v) => { daemonRunning = v; },
    },
    cleanup: async () => {
      await server.stop();
      store.close();
    },
  };
}

// --- 1. Cache hit returns the same snapshot -------------------------------

test("cache: a second /api/status call within TTL reuses the cached snapshot", async () => {
  let nowMs = 1_000;
  const ctx = await makeCacheHub({ ttlMs: 1_500, now: () => nowMs });
  try {
    const before = ctx.setupCalls();
    const first = await doHttp(`${ctx.base}/api/status`, "GET", ctx.token);
    assert.equal(first.status, 200);
    const firstBody = first.body as { checkedAt: string; prerequisites: unknown };
    assert.ok(typeof firstBody.checkedAt === "string");
    const afterFirst = ctx.setupCalls();
    assert.equal(afterFirst - before, 1,
      "the first uncached read must run one underlying inspection");

    nowMs += 200;
    const second = await doHttp(`${ctx.base}/api/status`, "GET", ctx.token);
    assert.equal(second.status, 200);
    const secondBody = second.body as { checkedAt: string };
    assert.equal(secondBody.checkedAt, firstBody.checkedAt,
      "second read within TTL must return the identical checkedAt");
    assert.equal(ctx.setupCalls(), afterFirst,
      "underlying inspection must not have run twice within TTL");
  } finally {
    await ctx.cleanup();
  }
});

// --- 2. Concurrent tabs share one underlying inspection -------------------

test("cache: concurrent /api/status calls share one in-flight inspection", async () => {
  let nowMs = 1_000;
  const ctx = await makeCacheHub({ ttlMs: 1_500, now: () => nowMs });
  try {
    const before = ctx.setupCalls();
    const beforeProbe = ctx.daemonCalls.probeCount();
    const [a, b, c] = await Promise.all([
      doHttp(`${ctx.base}/api/status`, "GET", ctx.token),
      doHttp(`${ctx.base}/api/status`, "GET", ctx.token),
      doHttp(`${ctx.base}/api/status`, "GET", ctx.token),
    ]);
    for (const r of [a, b, c]) assert.equal(r.status, 200);
    assert.equal(
      ctx.setupCalls() - before,
      1,
      "describeProviders / inspectPrerequisites must run exactly once across 3 concurrent tabs",
    );
    assert.equal(
      ctx.daemonCalls.probeCount() - beforeProbe,
      1,
      "probeDaemon must run exactly once across 3 concurrent tabs",
    );
    const cAt = (a.body as { checkedAt: string }).checkedAt;
    assert.equal((b.body as { checkedAt: string }).checkedAt, cAt);
    assert.equal((c.body as { checkedAt: string }).checkedAt, cAt);
  } finally {
    await ctx.cleanup();
  }
});

// --- 3. Concurrent /api/daemon GETs share one inspection ------------------

test("cache: concurrent /api/daemon GETs share one probeDaemon call", async () => {
  let nowMs = 1_000;
  const ctx = await makeCacheHub({ ttlMs: 1_500, now: () => nowMs });
  try {
    const beforeProbe = ctx.daemonCalls.probeCount();
    const [a, b, c] = await Promise.all([
      doHttp(`${ctx.base}/api/daemon`, "GET", ctx.token),
      doHttp(`${ctx.base}/api/daemon`, "GET", ctx.token),
      doHttp(`${ctx.base}/api/daemon`, "GET", ctx.token),
    ]);
    for (const r of [a, b, c]) {
      assert.equal(r.status, 200);
      const body = r.body as { running: boolean; checkedAt: string };
      assert.equal(body.running, true);
      assert.ok(typeof body.checkedAt === "string");
    }
    assert.equal(ctx.daemonCalls.probeCount() - beforeProbe, 1,
      "probeDaemon must run exactly once across 3 concurrent /api/daemon GETs");
  } finally {
    await ctx.cleanup();
  }
});

// --- 4. Cache expiry forces a fresh inspection ---------------------------

test("cache: /api/status re-runs inspection once the TTL elapses", async () => {
  let nowMs = 1_000;
  const ctx = await makeCacheHub({ ttlMs: 1_500, now: () => nowMs });
  try {
    const first = await doHttp(`${ctx.base}/api/status`, "GET", ctx.token);
    const firstBody = first.body as { checkedAt: string };
    const firstInspectorCount = ctx.setupCalls();

    nowMs += 1_000;
    const stillFresh = await doHttp(`${ctx.base}/api/status`, "GET", ctx.token);
    assert.equal((stillFresh.body as { checkedAt: string }).checkedAt, firstBody.checkedAt);
    assert.equal(ctx.setupCalls(), firstInspectorCount);

    // Advance past TTL.
    nowMs += 600;
    const afterTtl = await doHttp(`${ctx.base}/api/status`, "GET", ctx.token);
    const afterBody = afterTtl.body as { checkedAt: string };
    assert.notEqual(afterBody.checkedAt, firstBody.checkedAt,
      "after TTL expires the cache must serve a fresh checkedAt");
    assert.equal(ctx.setupCalls() - firstInspectorCount, 1,
      "expired cache must trigger exactly one underlying inspection");
  } finally {
    await ctx.cleanup();
  }
});

// --- 5. Mutation invalidation ---------------------------------------------

test("cache: successful settings mutation invalidates the cached setup snapshot", async () => {
  let nowMs = 1_000;
  const ctx = await makeCacheHub({ ttlMs: 1_500, now: () => nowMs });
  try {
    const first = await doHttp(`${ctx.base}/api/status`, "GET", ctx.token);
    const firstCheckedAt = (first.body as { checkedAt: string }).checkedAt;

    const beforeSave = ctx.setupCalls();
    const save = await doHttp(`${ctx.base}/api/settings`, "POST", ctx.token, {
      defaultProvider: "deepseek",
      defaultRuntime: "claude-code",
      defaultMaxBudgetUsd: 0.5,
      maximumBudgetUsd: 5,
      maxConcurrency: 1,
      noProgressTimeoutMs: 120_000,
      defaultEffort: "low",
    });
    assert.equal(save.status, 200);
    assert.equal(ctx.setupCalls(), beforeSave,
      "save path itself must not run the inspector");

    // Still within TTL — without invalidation the next read would be cached.
    nowMs += 100;
    const second = await doHttp(`${ctx.base}/api/status`, "GET", ctx.token);
    const secondCheckedAt = (second.body as { checkedAt: string }).checkedAt;
    assert.notEqual(secondCheckedAt, firstCheckedAt,
      "settings mutation must invalidate the cached setup snapshot");
    assert.equal(ctx.setupCalls() - beforeSave, 1,
      "exactly one fresh inspection after invalidation");
  } finally {
    await ctx.cleanup();
  }
});

test("cache: failed settings mutation does not invalidate the cached setup snapshot", async () => {
  let nowMs = 1_000;
  const ctx = await makeCacheHub({ ttlMs: 1_500, now: () => nowMs });
  try {
    const first = await doHttp(`${ctx.base}/api/status`, "GET", ctx.token);
    const firstCheckedAt = (first.body as { checkedAt: string }).checkedAt;

    const beforeSave = ctx.setupCalls();
    const badSave = await doHttp(`${ctx.base}/api/settings`, "POST", ctx.token, {
      defaultProvider: "deepseek",
      defaultRuntime: "grok-build", // illegal pair — fails assertProviderRuntimePair
    });
    assert.equal(badSave.status, 422);

    nowMs += 50;
    const second = await doHttp(`${ctx.base}/api/status`, "GET", ctx.token);
    const secondCheckedAt = (second.body as { checkedAt: string }).checkedAt;
    assert.equal(secondCheckedAt, firstCheckedAt,
      "failed settings mutation must NOT invalidate the cache");
    assert.equal(ctx.setupCalls(), beforeSave,
      "no fresh inspection should have been triggered");
  } finally {
    await ctx.cleanup();
  }
});

test("cache: provider key write invalidates the cached setup snapshot", async () => {
  let nowMs = 1_000;
  const ctx = await makeCacheHub({ ttlMs: 1_500, now: () => nowMs });
  try {
    const first = await doHttp(`${ctx.base}/api/status`, "GET", ctx.token);
    const firstCheckedAt = (first.body as { checkedAt: string }).checkedAt;
    const beforeInspector = ctx.setupCalls();

    const res = await doHttp(`${ctx.base}/api/provider-key`, "POST", ctx.token, {
      provider: "deepseek",
      apiKey: "sk-cache-test-key-abcdef",
    });
    assert.equal(res.status, 200);

    nowMs += 50;
    const second = await doHttp(`${ctx.base}/api/status`, "GET", ctx.token);
    const secondCheckedAt = (second.body as { checkedAt: string }).checkedAt;
    assert.notEqual(secondCheckedAt, firstCheckedAt,
      "provider-key write must invalidate the cached setup snapshot");
    assert.equal(ctx.setupCalls() - beforeInspector, 1);
  } finally {
    await ctx.cleanup();
  }
});

test("cache: model catalog mutation invalidates the cached setup snapshot", async () => {
  let nowMs = 1_000;
  const ctx = await makeCacheHub({ ttlMs: 1_500, now: () => nowMs });
  try {
    const first = await doHttp(`${ctx.base}/api/status`, "GET", ctx.token);
    const firstCheckedAt = (first.body as { checkedAt: string }).checkedAt;
    const beforeInspector = ctx.setupCalls();

    const res = await doHttp(`${ctx.base}/api/model-catalog`, "POST", ctx.token, {
      action: "upsert",
      model: {
        id: "cache-model",
        label: "Cache Test Model",
        provider: "deepseek",
        model: "deepseek-v4-flash",
      },
    });
    assert.equal(res.status, 200);

    nowMs += 50;
    const second = await doHttp(`${ctx.base}/api/status`, "GET", ctx.token);
    const secondCheckedAt = (second.body as { checkedAt: string }).checkedAt;
    assert.notEqual(secondCheckedAt, firstCheckedAt,
      "model catalog mutation must invalidate the cached setup snapshot");
    assert.equal(ctx.setupCalls() - beforeInspector, 1);
  } finally {
    await ctx.cleanup();
  }
});

test("cache: worker profile mutation invalidates the cached setup snapshot", async () => {
  let nowMs = 1_000;
  const ctx = await makeCacheHub({ ttlMs: 1_500, now: () => nowMs });
  try {
    const first = await doHttp(`${ctx.base}/api/status`, "GET", ctx.token);
    const firstCheckedAt = (first.body as { checkedAt: string }).checkedAt;
    const beforeInspector = ctx.setupCalls();

    const res = await doHttp(`${ctx.base}/api/worker-profiles`, "POST", ctx.token, {
      action: "upsert",
      profile: {
        id: "cache-profile",
        label: "Cache Worker",
        runtime: "claude-code",
        provider: "deepseek",
        model: "deepseek-v4-flash",
      },
    });
    assert.equal(res.status, 200);

    nowMs += 50;
    const second = await doHttp(`${ctx.base}/api/status`, "GET", ctx.token);
    const secondCheckedAt = (second.body as { checkedAt: string }).checkedAt;
    assert.notEqual(secondCheckedAt, firstCheckedAt,
      "worker profile mutation must invalidate the cached setup snapshot");
    assert.equal(ctx.setupCalls() - beforeInspector, 1);
  } finally {
    await ctx.cleanup();
  }
});

// --- 6. Daemon lifecycle invalidation -------------------------------------

test("cache: daemon stop invalidates daemon, setup, and operations-health snapshots", async () => {
  let nowMs = 1_000;
  const ctx = await makeCacheHub({ ttlMs: 1_500, now: () => nowMs });
  try {
    const firstStatus = await doHttp(`${ctx.base}/api/status`, "GET", ctx.token);
    const firstDaemon = await doHttp(`${ctx.base}/api/daemon`, "GET", ctx.token);
    const firstOpsHealth = await doHttp(`${ctx.base}/api/ops/health`, "GET", ctx.token);
    assert.equal((firstStatus.body as { daemon: { running: boolean } }).daemon.running, true);
    assert.equal((firstDaemon.body as { running: boolean }).running, true);
    const firstOpsCheckedAt = (firstOpsHealth.body as { checkedAt: string }).checkedAt;
    const healthBeforeStop = ctx.daemonCalls.healthCount();

    const stopRes = await doHttp(`${ctx.base}/api/daemon`, "POST", ctx.token, { action: "stop" });
    assert.equal(stopRes.status, 200);
    assert.equal(ctx.daemonRunning.get(), false);

    // Cache invalidated by stop — next read re-probes.
    nowMs += 50;
    const afterStatus = await doHttp(`${ctx.base}/api/status`, "GET", ctx.token);
    const afterDaemon = await doHttp(`${ctx.base}/api/daemon`, "GET", ctx.token);
    const afterOpsHealth = await doHttp(`${ctx.base}/api/ops/health`, "GET", ctx.token);
    assert.equal((afterStatus.body as { daemon: { running: boolean } }).daemon.running, false,
      "stop must invalidate the daemon field in /api/status");
    assert.equal((afterDaemon.body as { running: boolean }).running, false,
      "stop must invalidate the dedicated /api/daemon snapshot");
    assert.notEqual((afterOpsHealth.body as { checkedAt: string }).checkedAt, firstOpsCheckedAt,
      "stop must invalidate the cached /api/ops/health evidence");
    assert.equal(ctx.daemonCalls.healthCount() - healthBeforeStop, 1,
      "the next operations-health read refreshes exactly once after stop");

    const probeBefore = ctx.daemonCalls.probeCount();
    nowMs += 100; // still within TTL
    // /api/daemon GET must reuse the post-stop snapshot, not auto-start.
    await doHttp(`${ctx.base}/api/daemon`, "GET", ctx.token);
    assert.equal(ctx.daemonCalls.probeCount() - probeBefore, 0,
      "post-stop /api/daemon GET must hit the cache, not call probeDaemon again");
  } finally {
    await ctx.cleanup();
  }
});

test("cache: explicit daemon POST status action bypasses the cache and refreshes", async () => {
  let nowMs = 1_000;
  const ctx = await makeCacheHub({ ttlMs: 1_500, now: () => nowMs });
  try {
    const first = await doHttp(`${ctx.base}/api/daemon`, "GET", ctx.token);
    const firstCheckedAt = (first.body as { checkedAt: string }).checkedAt;
    const beforeProbe = ctx.daemonCalls.probeCount();

    nowMs += 50; // still within TTL
    const userRefresh = await doHttp(`${ctx.base}/api/daemon`, "POST", ctx.token, { action: "status" });
    assert.equal(userRefresh.status, 200);
    const userCheckedAt = (userRefresh.body as { checkedAt: string }).checkedAt;
    assert.notEqual(userCheckedAt, firstCheckedAt,
      "user-requested status refresh must bypass the cache");
    assert.equal(ctx.daemonCalls.probeCount() - beforeProbe, 1,
      "user-requested refresh must perform exactly one fresh probe");
  } finally {
    await ctx.cleanup();
  }
});

// --- 7. Operational progress endpoints are NEVER cached -------------------

test("cache: /api/ops/tasks is not cached across repeated calls", async () => {
  let nowMs = 1_000;
  const ctx = await makeCacheHub({ ttlMs: 60_000, now: () => nowMs });
  try {
    const a = await doHttp(`${ctx.base}/api/ops/tasks`, "GET", ctx.token);
    assert.equal(a.status, 200);
    // Mutate the task list response between calls by changing the daemon-backed
    // mock — but the daemon mock here is static. The contract assertion is:
    // no checkedAt / freshness envelope is attached to operational reads.
    const ab = a.body as Array<Record<string, unknown>>;
    assert.equal("checkedAt" in ab, false,
      "Task reads must not carry a Hub freshness envelope");
    assert.equal(Array.isArray(ab), true);
    // Also ensure neither evidence cache was touched by this operational read.
    assert.equal(ctx.cache.peek("setupStatus"), undefined);
    assert.equal(ctx.cache.peek("opsHealth"), undefined);
  } finally {
    await ctx.cleanup();
  }
});

test("cache: /api/ops/board, /api/ops/competitions, /api/ops/stats, /api/ops/settings remain uncached", async () => {
  let nowMs = 1_000;
  const ctx = await makeCacheHub({ ttlMs: 60_000, now: () => nowMs });
  try {
    // /api/ops/health is intentionally excluded - it is the one cached ops
    // read (covered by the dedicated ops-health tests below). All other ops
    // reads must stay uncached and current.
    const endpoints = [
      "/api/ops/board",
      "/api/ops/competitions",
      "/api/ops/stats",
      "/api/ops/settings",
    ] as const;
    for (const ep of endpoints) {
      const res = await doHttp(`${ctx.base}${ep}`, "GET", ctx.token);
      assert.equal(res.status, 200, `${ep} must succeed`);
      const body = res.body as Record<string, unknown> | unknown[];
      assert.equal(
        typeof body === "object"
          && body !== null
          && !Array.isArray(body)
          && "checkedAt" in body,
        false,
        `${ep} must not carry a Hub freshness envelope`,
      );
    }
  } finally {
    await ctx.cleanup();
  }
});

// --- 8. /api/ops/health coalescing (the one cached ops read) -------------

test("ops-health: a second /api/ops/health call within TTL reuses the cached snapshot", async () => {
  let nowMs = 1_000;
  const ctx = await makeCacheHub({ ttlMs: 1_500, now: () => nowMs });
  try {
    const before = ctx.daemonCalls.healthCount();
    const first = await doHttp(`${ctx.base}/api/ops/health`, "GET", ctx.token);
    assert.equal(first.status, 200);
    const firstBody = first.body as { ok: boolean; pid: number; checkedAt: string };
    assert.equal(firstBody.ok, true);
    assert.equal(firstBody.pid, 4242);
    assert.match(firstBody.checkedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(ctx.daemonCalls.healthCount() - before, 1,
      "the first uncached health read must run one daemon health call");

    nowMs += 200;
    const second = await doHttp(`${ctx.base}/api/ops/health`, "GET", ctx.token);
    assert.equal(second.status, 200);
    const secondBody = second.body as { ok: boolean; pid: number; checkedAt: string };
    assert.equal(secondBody.ok, true);
    assert.equal(secondBody.pid, 4242);
    assert.equal(secondBody.checkedAt, firstBody.checkedAt,
      "second health read within TTL must return the identical checkedAt");
    assert.equal(ctx.daemonCalls.healthCount() - before, 1,
      "daemon health must not run twice within TTL");
  } finally {
    await ctx.cleanup();
  }
});

test("ops-health: concurrent /api/ops/health calls share one daemon health read", async () => {
  let nowMs = 1_000;
  const ctx = await makeCacheHub({ ttlMs: 1_500, now: () => nowMs });
  try {
    const before = ctx.daemonCalls.healthCount();
    const [a, b, c] = await Promise.all([
      doHttp(`${ctx.base}/api/ops/health`, "GET", ctx.token),
      doHttp(`${ctx.base}/api/ops/health`, "GET", ctx.token),
      doHttp(`${ctx.base}/api/ops/health`, "GET", ctx.token),
    ]);
    for (const r of [a, b, c]) {
      assert.equal(r.status, 200);
      const body = r.body as { ok: boolean; checkedAt: string };
      assert.equal(body.ok, true);
      assert.ok(typeof body.checkedAt === "string");
    }
    assert.equal(ctx.daemonCalls.healthCount() - before, 1,
      "daemon health must run exactly once across 3 concurrent tabs");
    const cAt = (a.body as { checkedAt: string }).checkedAt;
    assert.equal((b.body as { checkedAt: string }).checkedAt, cAt);
    assert.equal((c.body as { checkedAt: string }).checkedAt, cAt);
  } finally {
    await ctx.cleanup();
  }
});

test("ops-health: /api/ops/health re-runs daemon health once the TTL elapses", async () => {
  let nowMs = 1_000;
  const ctx = await makeCacheHub({ ttlMs: 1_500, now: () => nowMs });
  try {
    const first = await doHttp(`${ctx.base}/api/ops/health`, "GET", ctx.token);
    const firstCheckedAt = (first.body as { checkedAt: string }).checkedAt;
    const firstHealthCount = ctx.daemonCalls.healthCount();

    nowMs += 1_000;
    const stillFresh = await doHttp(`${ctx.base}/api/ops/health`, "GET", ctx.token);
    assert.equal((stillFresh.body as { checkedAt: string }).checkedAt, firstCheckedAt);
    assert.equal(ctx.daemonCalls.healthCount(), firstHealthCount,
      "health read within TTL must not call daemon health again");

    // Advance past TTL.
    nowMs += 600;
    const afterTtl = await doHttp(`${ctx.base}/api/ops/health`, "GET", ctx.token);
    const afterBody = afterTtl.body as { checkedAt: string };
    assert.notEqual(afterBody.checkedAt, firstCheckedAt,
      "after TTL expires the health cache must serve a fresh checkedAt");
    assert.equal(ctx.daemonCalls.healthCount() - firstHealthCount, 1,
      "expired health cache must trigger exactly one daemon health call");
  } finally {
    await ctx.cleanup();
  }
});

test("ops-health: successful settings mutation invalidates the cached health snapshot", async () => {
  let nowMs = 1_000;
  const ctx = await makeCacheHub({ ttlMs: 1_500, now: () => nowMs });
  try {
    const first = await doHttp(`${ctx.base}/api/ops/health`, "GET", ctx.token);
    const firstCheckedAt = (first.body as { checkedAt: string }).checkedAt;

    const beforeSave = ctx.daemonCalls.healthCount();
    const save = await doHttp(`${ctx.base}/api/settings`, "POST", ctx.token, {
      defaultProvider: "deepseek",
      defaultRuntime: "claude-code",
      defaultMaxBudgetUsd: 0.5,
      maximumBudgetUsd: 5,
      maxConcurrency: 1,
      noProgressTimeoutMs: 120_000,
      defaultEffort: "low",
    });
    assert.equal(save.status, 200);
    assert.equal(ctx.daemonCalls.healthCount(), beforeSave,
      "settings save path itself must not run daemon health");

    // Still within TTL - without invalidation the next read would be cached.
    nowMs += 100;
    const second = await doHttp(`${ctx.base}/api/ops/health`, "GET", ctx.token);
    const secondCheckedAt = (second.body as { checkedAt: string }).checkedAt;
    assert.notEqual(secondCheckedAt, firstCheckedAt,
      "settings mutation must invalidate the cached health snapshot");
    assert.equal(ctx.daemonCalls.healthCount() - beforeSave, 1,
      "exactly one fresh daemon health call after invalidation");
  } finally {
    await ctx.cleanup();
  }
});

test("ops-health: repeated /api/ops/health reads never trigger a Provider probe or status call", async () => {
  let nowMs = 1_000;
  const ctx = await makeCacheHub({ ttlMs: 1_500, now: () => nowMs });
  try {
    const before = ctx.daemonCalls.healthCount();
    // Cache miss, cache hit, then a TTL-expired concurrent pair that coalesces.
    await doHttp(`${ctx.base}/api/ops/health`, "GET", ctx.token);
    nowMs += 200;
    await doHttp(`${ctx.base}/api/ops/health`, "GET", ctx.token);
    nowMs += 2_000; // past TTL -> one refreshed read
    await Promise.all([
      doHttp(`${ctx.base}/api/ops/health`, "GET", ctx.token),
      doHttp(`${ctx.base}/api/ops/health`, "GET", ctx.token),
    ]);
    assert.equal(ctx.daemonCalls.healthCount() - before, 2,
      "health reads must coalesce: one initial read plus one TTL refresh");
    const methods = ctx.daemonCalls.methods();
    assert.ok(!methods.includes("provider_probe"),
      "/api/ops/health must never trigger a billable provider_probe");
    assert.ok(!methods.includes("provider_status"),
      "/api/ops/health must never trigger a provider_status call");
    // The only daemon method a health read issues is `health`.
    assert.ok(methods.every((m) => m === "health"),
      "health reads must issue only the daemon health method");
  } finally {
    await ctx.cleanup();
  }
});

// --- 9. Cached responses never leak credentials / commands / paths -------

test("cache: cached responses do not include credentials, raw commands, or new internal fields", async () => {
  let nowMs = 1_000;
  const ctx = await makeCacheHub({ ttlMs: 1_500, now: () => nowMs });
  try {
    // Pre-write a fake key so we can prove it never reaches the wire.
    await doHttp(`${ctx.base}/api/provider-key`, "POST", ctx.token, {
      provider: "deepseek",
      apiKey: "sk-cache-test-key-abcdef",
    });
    const first = await doHttp(`${ctx.base}/api/status`, "GET", ctx.token);
    const text = JSON.stringify(first.body);
    // No raw API key, no internal error strings.
    assert.ok(!text.includes("sk-cache-test-key-abcdef"),
      "cached status must never echo an API key");
    // The only allowed freshness envelope field is `checkedAt`. No internal
    // diagnostics like `inspectorCount`, `inFlight`, or stack traces.
    for (const banned of ["inspectorCount", "inFlight", "stack", "Error: "]) {
      assert.ok(!text.includes(banned), `cached status must not include ${banned}`);
    }
    // checkedAt must look like an ISO timestamp.
    const checkedAt = (first.body as { checkedAt: string }).checkedAt;
    assert.match(checkedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // /api/status body keys are bounded: settings, modelCatalog, modelRouting, workerProfiles,
    // prerequisites, providers, runtimes, mains, daemon, versionJourney, checkedAt.
    const keys = Object.keys(first.body as Record<string, unknown>).sort();
    assert.deepEqual(keys, [
      "checkedAt", "daemon", "mains", "modelCatalog", "modelRouting", "prerequisites",
      "providers", "runtimes", "settings", "versionJourney", "workerProfiles",
    ]);
  } finally {
    await ctx.cleanup();
  }
});

// --- 10. Cache unit-level: ttlMs bounds, monotonic now() ----------------

test("HubEvidenceCache: TTL is bounded; peek() returns undefined after expiry", async () => {
  let nowMs = 1_000;
  const cache = new HubEvidenceCache({ ttlMs: 100, now: () => nowMs });
  let computeCalls = 0;
  const first = await cache.getOrCompute("setupStatus", async () => {
    computeCalls += 1;
    return { hello: "world" };
  });
  assert.equal(computeCalls, 1);
  assert.ok(first.value.hello === "world");
  // Within TTL: peek returns the live entry.
  nowMs += 50;
  const freshPeek = cache.peek("setupStatus");
  assert.ok(freshPeek !== undefined, "peek within TTL must return the entry");
  assert.equal(freshPeek!.checkedAtMs, 1_000);
  // After TTL: peek returns undefined.
  nowMs += 60;
  assert.equal(cache.peek("setupStatus"), undefined,
    "peek after TTL must be undefined");
  // A fresh getOrCompute after expiry must run compute again.
  const second = await cache.getOrCompute("setupStatus", async () => {
    computeCalls += 1;
    return { hello: "world-2" };
  });
  assert.equal(computeCalls, 2);
  assert.equal(second.value.hello, "world-2");
  assert.equal(cache.getTtlMs(), 100);
});

test("HubEvidenceCache: concurrent getOrCompute for one kind runs compute exactly once", async () => {
  let nowMs = 1_000;
  const cache = new HubEvidenceCache({ ttlMs: 60_000, now: () => nowMs });
  let computeCalls = 0;
  const slow = (): Promise<{ tag: string }> => new Promise((resolve) => {
    computeCalls += 1;
    setTimeout(() => resolve({ tag: "only-once" }), 30);
  });
  const [a, b, c, d] = await Promise.all([
    cache.getOrCompute("setupStatus", slow),
    cache.getOrCompute("setupStatus", slow),
    cache.getOrCompute("setupStatus", slow),
    cache.getOrCompute("setupStatus", slow),
  ]);
  assert.equal(computeCalls, 1, "compute() must run exactly once across 4 concurrent calls");
  assert.equal(a.value.tag, "only-once");
  assert.equal(b.value.tag, "only-once");
  assert.equal(c.value.tag, "only-once");
  assert.equal(d.value.tag, "only-once");
  assert.equal(a.checkedAtMs, b.checkedAtMs);
});

test("HubEvidenceCache: failed compute leaves no entry behind; retry runs again", async () => {
  let nowMs = 1_000;
  const cache = new HubEvidenceCache({ ttlMs: 60_000, now: () => nowMs });
  let attempts = 0;
  await assert.rejects(async () => {
    await cache.getOrCompute("setupStatus", async () => {
      attempts += 1;
      throw new Error("boom");
    });
  }, /boom/);
  assert.equal(attempts, 1);
  assert.equal(cache.peek("setupStatus"), undefined,
    "a failed compute must not leave an entry behind");
  // Retry — compute() must be called again.
  const ok = await cache.getOrCompute("setupStatus", async () => {
    attempts += 1;
    return { ok: true };
  });
  assert.equal(attempts, 2);
  assert.deepEqual(ok.value, { ok: true });
});
