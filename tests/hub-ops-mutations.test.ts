/**
 * Hub operate mutations: task supervise, integration, provider probe, competition compare.
 * Injected daemonRequest — no live socket / no billable calls.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { get, request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

async function makeOpsHub() {
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
      if (method === "resume") return { id: params.taskId, status: "queued" } as T;
      if (method === "revise") return { id: params.taskId, status: "queued" } as T;
      if (method === "main_review") return { ok: true, decision: params.decision } as T;
      if (method === "integration_preflight") return { feasible: true, taskId: params.taskId } as T;
      if (method === "integration_apply") return { operationId: "op-1", status: "started" } as T;
      if (method === "provider_probe") return { providers: { deepseek: { status: "ok" } } } as T;
      if (method === "provider_status") return { providers: { deepseek: { ready: true } } } as T;
      if (method === "competition_compare") {
        return { competitionId: params.competitionId, recommendation: { candidateId: "c1" } } as T;
      }
      throw new Error(`unexpected method ${method}`);
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

test("unauthorized ops mutation is rejected", async () => {
  const ctx = await makeOpsHub();
  try {
    const res = await doHttp(`${ctx.base}/api/ops/tasks/t1/resume`, "POST", undefined, {});
    assert.equal(res.status, 401);
  } finally {
    await ctx.cleanup();
  }
});

test("resume and revise call daemon with correct methods", async () => {
  const ctx = await makeOpsHub();
  try {
    const resume = await doHttp(`${ctx.base}/api/ops/tasks/task-a/resume`, "POST", ctx.token, {
      feedback: "try again",
    });
    assert.equal(resume.status, 200);
    assert.equal((resume.body as { action: string }).action, "resume");
    assert.ok(ctx.calls.some((c) => c.method === "resume" && c.params.taskId === "task-a"));

    const reviseMissing = await doHttp(`${ctx.base}/api/ops/tasks/task-a/revise`, "POST", ctx.token, {});
    assert.equal(reviseMissing.status, 422);

    const revise = await doHttp(`${ctx.base}/api/ops/tasks/task-a/revise`, "POST", ctx.token, {
      feedback: "fix the tests",
    });
    assert.equal(revise.status, 200);
    assert.ok(ctx.calls.some((c) => c.method === "revise" && c.params.feedback === "fix the tests"));
  } finally {
    await ctx.cleanup();
  }
});

test("main_review requires confirm and valid decision", async () => {
  const ctx = await makeOpsHub();
  try {
    const noConfirm = await doHttp(`${ctx.base}/api/ops/tasks/t1/main-review`, "POST", ctx.token, {
      decision: "accept",
      reason: "looks good",
    });
    assert.equal(noConfirm.status, 422);

    const badDecision = await doHttp(`${ctx.base}/api/ops/tasks/t1/main-review`, "POST", ctx.token, {
      decision: "maybe",
      reason: "x",
      confirm: true,
    });
    assert.equal(badDecision.status, 422);

    const ok = await doHttp(`${ctx.base}/api/ops/tasks/t1/main-review`, "POST", ctx.token, {
      decision: "accept",
      reason: "verified",
      confirm: true,
    });
    assert.equal(ok.status, 200);
    const call = ctx.calls.find((c) => c.method === "main_review");
    assert.ok(call);
    assert.equal(call!.params.confirm, true);
    assert.equal(call!.params.decision, "accept");
  } finally {
    await ctx.cleanup();
  }
});

test("integration preflight and apply with confirm gate", async () => {
  const ctx = await makeOpsHub();
  try {
    const pre = await doHttp(
      `${ctx.base}/api/ops/tasks/t1/integration/preflight`,
      "POST",
      ctx.token,
      {},
    );
    assert.equal(pre.status, 200);
    assert.ok(ctx.calls.some((c) => c.method === "integration_preflight"));

    const noConfirm = await doHttp(
      `${ctx.base}/api/ops/tasks/t1/integration/apply`,
      "POST",
      ctx.token,
      { receiptId: "r1" },
    );
    assert.equal(noConfirm.status, 422);

    const apply = await doHttp(
      `${ctx.base}/api/ops/tasks/t1/integration/apply`,
      "POST",
      ctx.token,
      { receiptId: "r1", confirm: true },
    );
    assert.equal(apply.status, 200);
    const call = ctx.calls.find((c) => c.method === "integration_apply");
    assert.ok(call);
    assert.equal(call!.params.receiptId, "r1");
    assert.equal(call!.params.confirm, true);
  } finally {
    await ctx.cleanup();
  }
});

test("provider_probe requires confirm (billable gate)", async () => {
  const ctx = await makeOpsHub();
  try {
    const noConfirm = await doHttp(`${ctx.base}/api/ops/providers/probe`, "POST", ctx.token, {});
    assert.equal(noConfirm.status, 422);

    const probe = await doHttp(`${ctx.base}/api/ops/providers/probe`, "POST", ctx.token, {
      provider: "deepseek",
      confirm: true,
    });
    assert.equal(probe.status, 200);
    const call = ctx.calls.find((c) => c.method === "provider_probe");
    assert.ok(call);
    assert.equal(call!.params.provider, "deepseek");
  } finally {
    await ctx.cleanup();
  }
});

test("competition compare routes to daemon", async () => {
  const ctx = await makeOpsHub();
  try {
    const res = await doHttp(
      `${ctx.base}/api/ops/competitions/comp-1/compare`,
      "POST",
      ctx.token,
      {},
    );
    assert.equal(res.status, 200);
    assert.ok(ctx.calls.some((c) =>
      c.method === "competition_compare" && c.params.competitionId === "comp-1"
    ));
  } finally {
    await ctx.cleanup();
  }
});

test("Hub public UI wires supervise, daemon, provider probe, compare controls", async () => {
  const baseDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "hub", "public");
  const app = await readFile(path.join(baseDir, "app.js"), "utf8");
  const html = await readFile(path.join(baseDir, "index.html"), "utf8");

  // Daemon lifecycle
  assert.ok(app.includes("/api/daemon"), "daemon control API");
  assert.ok(app.includes("daemonStart") || app.includes('"start"'), "start control");
  assert.ok(/action:\s*["']stop["']/.test(app) || app.includes('"stop"'), "stop control");
  assert.ok(app.includes("restart"), "restart control");

  // Task supervise
  assert.ok(app.includes("/resume"), "resume route");
  assert.ok(app.includes("/revise"), "revise route");
  assert.ok(app.includes("/main-review"), "main-review route");
  assert.ok(app.includes("integration/preflight"), "preflight route");
  assert.ok(app.includes("integration/apply"), "apply route");
  assert.ok(app.includes("confirm: true") || app.includes("confirm:true"), "confirm gates in UI");

  // Provider probe billable
  assert.ok(app.includes("/api/ops/providers/probe"), "provider probe API");
  assert.ok(app.includes("providerProbeConfirm") || /probe.*confirm/i.test(app), "probe confirm");

  // Competition compare
  assert.ok(app.includes("/compare"), "competition compare");

  // OOB readiness
  assert.ok(app.includes("rReadiness") || app.includes("readyTitle"), "readiness surface");
  assert.ok(html.includes("data-tab=\"model\""), "Models tab");
  assert.ok(html.includes("data-tab=\"worker\""), "Workers tab");
  assert.ok(html.includes("data-tab=\"mains\""), "Main tab");

  // Live health identity surface (AC1)
  assert.ok(app.includes("buildIdentity") || app.includes("formatBuildIdentity"), "Stack shows build identity");
  assert.ok(app.includes("daemonIdentity") || app.includes("identityLine"), "identity line in daemon card");

  // Security invariants
  assert.ok(!/\.innerHTML\s*=/.test(app), "no innerHTML");
  assert.ok(!/—/.test(app), "no em dash");
});
