import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { get, request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SettingsService } from "../src/core/settings.js";
import { buildHubSettingsPatch, viewHubSettings } from "../src/hub/settings-api.js";
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

function inspector(overrides: Partial<SetupSystemInspector> = {}): SetupSystemInspector {
  return {
    platform: () => "darwin",
    nodeVersion: () => "v24.5.0",
    account: () => "hub-test-user",
    commandExists: () => true,
    ...overrides,
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

async function makeHub() {
  const home = await mkdtemp(path.join(tmpdir(), "fl-hub-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const keychain = new MemoryKeychain();
  const setup = new SetupService(settings, keychain, inspector());
  const staticDir = path.join(home, "static");
  await mkdir(staticDir, { recursive: true });
  await writeFile(path.join(staticDir, "index.html"), "<!DOCTYPE html><title>Hub</title>\n", "utf8");
  let daemonRunning = true;
  let ensureCount = 0;
  let health: Record<string, unknown> = {
    ok: true,
    pid: 4242,
    activeTaskIds: ["t-active"],
    queuedTaskIds: ["t-q1"],
    maxConcurrency: 1,
    buildIdentity: {
      protocolVersion: 1,
      packageVersion: "0.2.0",
      buildId: "test-build-abc123",
      sourceMode: "dist",
    },
  };
  const server = new HubServer({
    settings,
    setup,
    keychain,
    staticRoot: staticDir,
    account: () => "hub-test-user",
    port: 0,
    ensureDaemon: async () => {
      ensureCount += 1;
      daemonRunning = true;
      return { ...health, ok: true };
    },
    probeDaemon: async () => {
      if (!daemonRunning) return { running: false, error: "not running" };
      return { running: true, health: { ...health } };
    },
    stopDaemon: async () => {
      daemonRunning = false;
      return { stopped: true, message: "Daemon shutdown requested" };
    },
    restartDaemon: async () => {
      ensureCount += 1;
      daemonRunning = true;
      return { ...health, ok: true };
    },
    daemonRequest: async <T>(method: string) => {
      if (!daemonRunning) {
        throw new Error("Daemon is not running (connection refused)");
      }
      if (method === "health") return { ...health } as T;
      if (method === "list_summaries") return [] as T;
      if (method === "plan_board_overview") return [] as T;
      if (method === "competition_list") return [] as T;
      if (method === "statistics") return [] as T;
      if (method === "settings_get") return settings.get() as T;
      throw new Error(`unexpected ${method}`);
    },
  });
  const port = await server.start();
  return {
    server,
    settings,
    keychain,
    port,
    token: server.getToken(),
    getDaemonRunning: () => daemonRunning,
    setDaemonRunning: (v: boolean) => { daemonRunning = v; },
    getEnsureCount: () => ensureCount,
    cleanup: async () => {
      await server.stop();
      store.close();
    },
  };
}

test("viewHubSettings projects execution defaults", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-hub-view-"));
  const store = new StateStore(home);
  try {
    const settings = new SettingsService(store);
    const view = viewHubSettings(settings.get());
    assert.equal(typeof view.defaultProvider, "string");
    assert.equal(typeof view.defaultRuntime, "string");
    assert.equal(typeof view.maximumBudgetUsd, "number");
    assert.equal(typeof view.maxConcurrency, "number");
  } finally {
    store.close();
  }
});

test("buildHubSettingsPatch accepts L1 pair and rejects illegal pairs", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-hub-patch-"));
  const store = new StateStore(home);
  try {
    const settings = new SettingsService(store).get();
    const ok = buildHubSettingsPatch(settings, {
      defaultProvider: "deepseek",
      defaultRuntime: "claude-code",
      defaultMaxBudgetUsd: 0.5,
      maxConcurrency: 1,
    });
    assert.equal(ok.execution.defaultProvider, "deepseek");
    assert.equal(ok.execution.defaultRuntime, "claude-code");
    assert.equal(ok.execution.defaultMaxBudgetUsd, 0.5);

    assert.throws(
      () => buildHubSettingsPatch(settings, {
        defaultProvider: "deepseek",
        defaultRuntime: "grok-build",
      }),
      /grok-build requires provider.name=xai/,
    );
    assert.throws(
      () => buildHubSettingsPatch(settings, {
        defaultProvider: "xai",
        defaultRuntime: "claude-code",
      }),
      /claude-code does not support provider.name=xai/,
    );
    assert.throws(
      () => buildHubSettingsPatch(settings, {
        defaultMaxBudgetUsd: -1,
      }),
      /defaultMaxBudgetUsd/,
    );
  } finally {
    store.close();
  }
});

test("Hub settings save and reload via API", async () => {
  const ctx = await makeHub();
  try {
    const base = `http://127.0.0.1:${ctx.port}`;
    const unauthorized = await doHttp(`${base}/api/status`, "GET");
    assert.equal(unauthorized.status, 401);

    const status = await doHttp(`${base}/api/status`, "GET", ctx.token);
    assert.equal(status.status, 200);
    const body = status.body as { settings: { defaultProvider: string } };
    assert.ok(body.settings.defaultProvider);

    const save = await doHttp(`${base}/api/settings`, "POST", ctx.token, {
      defaultProvider: "deepseek",
      defaultRuntime: "claude-code",
      defaultMaxBudgetUsd: 0.5,
      maximumBudgetUsd: 5,
      maxConcurrency: 2,
      noProgressTimeoutMs: 120_000,
      defaultEffort: "low",
    });
    assert.equal(save.status, 200);
    const saved = (save.body as { settings: Record<string, unknown> }).settings;
    assert.equal(saved.defaultProvider, "deepseek");
    assert.equal(saved.defaultRuntime, "claude-code");
    assert.equal(saved.defaultMaxBudgetUsd, 0.5);
    assert.equal(saved.maxConcurrency, 2);
    assert.equal(saved.defaultEffort, "low");

    const reloaded = ctx.settings.get();
    assert.equal(reloaded.execution.defaultProvider, "deepseek");
    assert.equal(reloaded.execution.defaultRuntime, "claude-code");
    assert.equal(reloaded.execution.maxConcurrency, 2);

    const reject = await doHttp(`${base}/api/settings`, "POST", ctx.token, {
      defaultProvider: "deepseek",
      defaultRuntime: "grok-build",
    });
    assert.equal(reject.status, 422);
  } finally {
    await ctx.cleanup();
  }
});

test("Hub provider-key writes to Keychain with setup account", async () => {
  const ctx = await makeHub();
  try {
    const base = `http://127.0.0.1:${ctx.port}`;
    const res = await doHttp(`${base}/api/provider-key`, "POST", ctx.token, {
      provider: "deepseek",
      apiKey: "sk-hub-test-key-abcdef",
    });
    assert.equal(res.status, 200);
    assert.equal(ctx.keychain.has("forklight.deepseek.api-key", "hub-test-user"), true);
    assert.equal(
      ctx.keychain.read("forklight.deepseek.api-key", "hub-test-user"),
      "sk-hub-test-key-abcdef",
    );

    const bad = await doHttp(`${base}/api/provider-key`, "POST", ctx.token, {
      provider: "deepseek",
      apiKey: "short",
    });
    assert.equal(bad.status, 422);
  } finally {
    await ctx.cleanup();
  }
});

test("Hub serves static index without token", async () => {
  const ctx = await makeHub();
  try {
    const page = await doHttp(`http://127.0.0.1:${ctx.port}/`, "GET");
    assert.equal(page.status, 200);
    assert.match(String(page.body), /ForkLight|Control Center|Hub/i);
  } finally {
    await ctx.cleanup();
  }
});

test("Hub daemon control: status probe, stop, start, restart without auto-start on poll", async () => {
  const ctx = await makeHub();
  try {
    const base = `http://127.0.0.1:${ctx.port}`;

    const status = await doHttp(`${base}/api/daemon`, "GET", ctx.token);
    assert.equal(status.status, 200);
    const st = status.body as {
      running: boolean;
      pid?: number;
      buildIdentity?: { buildId?: string };
      activeTaskIds?: string[];
      queuedTaskIds?: string[];
    };
    assert.equal(st.running, true);
    assert.equal(st.pid, 4242);
    assert.ok(st.buildIdentity?.buildId, "live health must expose build identity");
    assert.equal(st.activeTaskIds?.length, 1);
    assert.equal(st.queuedTaskIds?.length, 1);

    // /api/status must probe, not force-start
    const ensureBefore = ctx.getEnsureCount();
    const hubStatus = await doHttp(`${base}/api/status`, "GET", ctx.token);
    assert.equal(hubStatus.status, 200);
    const hubBody = hubStatus.body as {
      daemon: { running: boolean; buildIdentity?: { buildId?: string } };
    };
    assert.equal(hubBody.daemon.running, true);
    assert.ok(hubBody.daemon.buildIdentity?.buildId);
    assert.equal(ctx.getEnsureCount(), ensureBefore, "/api/status must not call ensureDaemon");

    const stop = await doHttp(`${base}/api/daemon`, "POST", ctx.token, { action: "stop" });
    assert.equal(stop.status, 200);
    assert.equal(ctx.getDaemonRunning(), false);

    const afterStop = await doHttp(`${base}/api/status`, "GET", ctx.token);
    const afterBody = afterStop.body as { daemon: { running: boolean } };
    assert.equal(afterBody.daemon.running, false, "status poll must not auto-start daemon");
    assert.equal(ctx.getDaemonRunning(), false);

    // Real Hub UI poll path: /api/ops/* must not revive a stopped daemon
    const ensureAtStop = ctx.getEnsureCount();
    const opsHealth = await doHttp(`${base}/api/ops/health`, "GET", ctx.token);
    assert.notEqual(opsHealth.status, 200, "ops health must fail closed when daemon is down");
    assert.equal(ctx.getDaemonRunning(), false, "ops health must not start daemon");
    assert.equal(ctx.getEnsureCount(), ensureAtStop, "ops health must not call ensureDaemon");

    const opsTasks = await doHttp(`${base}/api/ops/tasks`, "GET", ctx.token);
    assert.notEqual(opsTasks.status, 200);
    assert.equal(ctx.getDaemonRunning(), false);
    assert.equal(ctx.getEnsureCount(), ensureAtStop, "ops tasks poll must not call ensureDaemon");

    const opsBoard = await doHttp(`${base}/api/ops/board`, "GET", ctx.token);
    assert.notEqual(opsBoard.status, 200);
    assert.equal(ctx.getDaemonRunning(), false);
    assert.equal(ctx.getEnsureCount(), ensureAtStop);

    const start = await doHttp(`${base}/api/daemon`, "POST", ctx.token, { action: "start" });
    assert.equal(start.status, 200);
    assert.equal(ctx.getDaemonRunning(), true);
    assert.ok(ctx.getEnsureCount() > ensureAtStop, "explicit start must ensureDaemon");

    // After explicit start, ops reads work without extra ensure if already running
    const ensureAfterStart = ctx.getEnsureCount();
    const healthOk = await doHttp(`${base}/api/ops/health`, "GET", ctx.token);
    assert.equal(healthOk.status, 200);
    assert.equal(ctx.getEnsureCount(), ensureAfterStart, "ops health must not ensure when daemon already up");

    ctx.setDaemonRunning(false);
    const restart = await doHttp(`${base}/api/daemon`, "POST", ctx.token, { action: "restart" });
    assert.equal(restart.status, 200);
    assert.equal(ctx.getDaemonRunning(), true);

    const bad = await doHttp(`${base}/api/daemon`, "POST", ctx.token, { action: "explode" });
    assert.equal(bad.status, 422);
  } finally {
    await ctx.cleanup();
  }
});

test("Hub /api/tasks without daemon bridge returns 503", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-hub-nodaemon-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const keychain = new MemoryKeychain();
  const setup = new SetupService(settings, keychain, inspector());
  const staticDir = path.join(home, "static");
  await mkdir(staticDir, { recursive: true });
  await writeFile(path.join(staticDir, "index.html"), "<!DOCTYPE html><title>Hub</title>\n", "utf8");
  // Intentionally omit daemonRequest / ensureDaemon so operate bridge is unavailable.
  const server = new HubServer({
    settings,
    setup,
    keychain,
    staticRoot: staticDir,
    account: () => "hub-test-user",
    port: 0,
  });
  const port = await server.start();
  try {
    const res = await doHttp(`http://127.0.0.1:${port}/api/tasks`, "GET", server.getToken());
    assert.equal(res.status, 503);
    const body = res.body as { error: string };
    assert.ok(typeof body.error === "string" && body.error.length > 0);
  } finally {
    await server.stop();
    store.close();
  }
});

test("Hub /api/ops/tasks with daemon bridge returns console-shaped task list", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-hub-tasks-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const keychain = new MemoryKeychain();
  const setup = new SetupService(settings, keychain, inspector());
  const staticDir = path.join(home, "static");
  await mkdir(staticDir, { recursive: true });
  await writeFile(path.join(staticDir, "index.html"), "<!DOCTYPE html><title>Hub</title>\n", "utf8");
  const sample = [
    {
      taskId: "t1",
      name: "hello",
      status: "running",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      runtime: "claude-code",
    },
  ];
  const server = new HubServer({
    settings,
    setup,
    keychain,
    staticRoot: staticDir,
    account: () => "hub-test-user",
    port: 0,
    ensureDaemon: async () => ({ ok: true }),
    daemonRequest: async <T>(method: string) => {
      if (method === "list_summaries") return sample as T;
      throw new Error(`unexpected ${method}`);
    },
  });
  const port = await server.start();
  try {
    const res = await doHttp(`http://127.0.0.1:${port}/api/ops/tasks`, "GET", server.getToken());
    assert.equal(res.status, 200);
    const body = res.body as Array<{ id: string; name: string; status: string }>;
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 1);
    assert.equal(body[0]!.id, "t1");
    assert.equal(body[0]!.status, "running");
  } finally {
    await server.stop();
    store.close();
  }
});
