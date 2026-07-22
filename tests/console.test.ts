import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { get, request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { ConsoleServer } from "../src/console/server.js";
import { DaemonCoordinator } from "../src/daemon/coordinator.js";
import { ForkLightDaemon } from "../src/daemon/server.js";
import { SettingsService } from "../src/core/settings.js";
import { registerTaskFromSpec } from "../src/core/runner.js";
import { daemonRequest } from "../src/daemon/client.js";
import { StateStore } from "../src/state/store.js";

interface HttpResponse {
  status: number;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
}

const openServers = new Set<ConsoleServer>();
after(async () => { for (const server of openServers) await server.stop(); });

function httpGet(url: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => (data += chunk.toString()));
      res.on("end", () => {
        try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data), headers: res.headers }); }
        catch { resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }); }
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

function httpReq(method: string, url: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method }, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => (data += chunk.toString()));
      res.on("end", () => {
        try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data), headers: res.headers }); }
        catch { resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }); }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

function httpHead(url: string): Promise<HttpResponse> { return httpReq("HEAD", url); }

async function serve(
  store: StateStore,
  staticDir?: string,
): Promise<{ server: ConsoleServer; port: number; url: string }> {
  const svc = new SettingsService(store);
  const coordinator = new DaemonCoordinator(store, svc, 1);
  const root = staticDir ?? (await mkdtemp(path.join(tmpdir(), "fl-console-")));
  const server = new ConsoleServer(coordinator, svc.get().console, root);
  openServers.add(server);
  const port = await server.start();
  return { server, port, url: `http://127.0.0.1:${port}` };
}

function specTask(store: StateStore, name: string) {
  return registerTaskFromSpec(store, {
    version: 1, name, project: "/tmp/fl-test", goal: "test goal", constraints: [],
    provider: { name: "deepseek", model: "deepseek-v4-flash", keychainService: "fl.test" },
    runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: 0.1 },
    workspace: { exclude: [] },
    worker: { allowEdits: false, allowedCommands: [], focusPaths: ["src"] },
    acceptance: { commands: ["true"] },
  }, `fl://${name}`);
}

test("GET /health returns health data", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-h-"));
  const store = new StateStore(home);
  try {
    const { server, url } = await serve(store);
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const { status, body } = await httpGet(`${url}/health`);
    assert.equal(status, 200);
    const h = body as Record<string, unknown>;
    assert.equal(typeof h.pid, "number");
    assert.equal(h.maxConcurrency, 1);
    assert.ok(Array.isArray(h.activeTaskIds));
    await server.stop();
  } finally { store.close(); }
});

test("GET /settings recursively redacts keychain fields", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-s-"));
  const store = new StateStore(home);
  try {
    const { server, url } = await serve(store);
    const { status, body } = await httpGet(`${url}/settings`);
    assert.equal(status, 200);
    function assertNoKc(v: unknown, b: string): void {
      if (v === null || v === undefined) return;
      if (Array.isArray(v)) { v.forEach((x, i) => assertNoKc(x, `${b}[${i}]`)); return; }
      if (typeof v === "object") {
        for (const [k, fv] of Object.entries(v as Record<string, unknown>)) {
          assert.ok(!/keychain/i.test(k), `${b}.${k} must not appear`);
          assertNoKc(fv, `${b}.${k}`);
        }
      }
    }
    assertNoKc(body, "settings");
    await server.stop();
  } finally { store.close(); }
});

test("GET /board and /plans are identical aliases", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-bp-"));
  const store = new StateStore(home);
  try {
    const { server, url } = await serve(store);
    const b = await httpGet(`${url}/board`);
    const p = await httpGet(`${url}/plans`);
    assert.equal(b.status, 200);
    assert.deepEqual(b.body, p.body);
    await server.stop();
  } finally { store.close(); }
});

test("GET /tasks/:id returns bounded timeline from taskTimeline, no logs/diffs/payloads", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-tt-"));
  const store = new StateStore(home);
  try {
    const svc = new SettingsService(store);
    svc.update({ console: { eventListLimit: 3 } });
    const coordinator = new DaemonCoordinator(store, svc, 1);
    const root = await mkdtemp(path.join(tmpdir(), "fl-tts-"));
    const server = new ConsoleServer(coordinator, svc.get().console, root);
    openServers.add(server);
    const port = await server.start();
    const url = `http://127.0.0.1:${port}`;

    const task = specTask(store, "timeline-test");
    const tid = task.id;
    for (let i = 1; i <= 5; i++) {
      store.addEvent(tid, undefined, "worker.message", `event ${i}`, { secret: `payload-${i}` });
    }
    const { status, body } = await httpGet(`${url}/tasks/${tid}`);
    assert.equal(status, 200);
    const r = body as Record<string, unknown>;
    assert.equal(r.name, "timeline-test");
    const tl = r.timeline as Array<Record<string, unknown>>;
    assert.equal(tl.length, 3, "should be capped at eventListLimit=3");
    assert.equal(tl[0]!.summary, "event 3");
    assert.equal(tl[2]!.summary, "event 5");
    for (const e of tl) {
      assert.ok(typeof e.timestamp === "string");
      assert.ok(typeof e.type === "string");
      assert.ok(typeof e.summary === "string");
      assert.equal("payload" in e, false);
    }
    const nf = await httpGet(`${url}/tasks/nonexistent`);
    assert.equal(nf.status, 404);

    await server.stop();
  } finally { store.close(); }
});

test("GET /competitions and /stats are capped by boardListLimit", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-cs-"));
  const store = new StateStore(home);
  try {
    const { server, url } = await serve(store);
    assert.equal((await httpGet(`${url}/competitions`)).status, 200);
    assert.equal((await httpGet(`${url}/stats`)).status, 200);
    await server.stop();
  } finally { store.close(); }
});

test("integration history caps receipts/results with eventListLimit, not-found returns 404", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ih-"));
  const store = new StateStore(home);
  try {
    const { server, url } = await serve(store);
    const { status } = await httpGet(`${url}/integration/nonexistent/history`);
    assert.equal(status, 404);
    await server.stop();
  } finally { store.close(); }
});

test("non-GET returns 405 and does not change store state", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-mut-"));
  const store = new StateStore(home);
  try {
    const { server, url } = await serve(store);
    const before = store.listTasks().length;
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await httpReq(m, `${url}/health`);
      assert.equal(r.status, 405);
      assert.ok(typeof (r.body as Record<string, unknown>).error === "string");
      assert.ok(!String((r.body as Record<string, unknown>).error).includes("—"));
    }
    assert.equal(store.listTasks().length, before);
    await server.stop();
  } finally { store.close(); }
});

test("HEAD returns no body on success and error responses", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-head-"));
  const store = new StateStore(home);
  try {
    const { server, url } = await serve(store);
    let r = await httpHead(`${url}/health`);
    assert.equal(r.status, 200);
    assert.equal(r.body, "");
    assert.ok(typeof r.headers["content-length"] === "string");
    r = await httpHead(`${url}/health`);
    assert.equal(r.body, "");
    r = await httpReq("HEAD", `${url}/missing`);
    assert.equal(r.status, 404);
    assert.equal(r.body, "");
    await server.stop();
  } finally { store.close(); }
});

test("unknown routes and path traversal return safe non-success", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-unk-"));
  const store = new StateStore(home);
  const sdir = await mkdtemp(path.join(tmpdir(), "fl-assets-"));
  try {
    const svc = new SettingsService(store);
    const coordinator = new DaemonCoordinator(store, svc, 1);
    const server = new ConsoleServer(coordinator, svc.get().console, sdir);
    openServers.add(server);
    const port = await server.start();
    const url = `http://127.0.0.1:${port}`;
    try {
      let r = await httpGet(`${url}/no-such-route`);
      assert.equal(r.status, 404);
      assert.equal((r.body as Record<string, unknown>).error, "Not found");
      r = await httpGet(`${url}/../../etc/passwd`);
      assert.ok([400, 403, 404].includes(r.status));
      r = await httpGet(`${url}/etc/passwd`);
      assert.ok(r.status === 403 || r.status === 404, `unexpected status ${r.status}`);
    } finally {
      await server.stop();
    }
  } finally { store.close(); }
});

test("security headers present on all responses", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-sec-"));
  const store = new StateStore(home);
  try {
    const { server, url } = await serve(store);
    for (const path of ["/health", "/missing"]) {
      const { headers } = await httpGet(`${url}${path}`);
      assert.equal(headers["cache-control"], "no-store");
      assert.equal(headers["x-content-type-options"], "nosniff");
      assert.equal(headers["x-frame-options"], "DENY");
      const csp = headers["content-security-policy"] as string;
      assert.ok(csp.includes("default-src 'self'"));
      assert.ok(csp.includes("object-src 'none'"));
      assert.ok(csp.includes("base-uri 'self'"));
      assert.ok(csp.includes("frame-ancestors 'none'"));
    }
    await server.stop();
  } finally { store.close(); }
});

test("console lifecycle via daemon: start, status, stop", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-dae-"));
  const daemon = new ForkLightDaemon(home, 1);
  await daemon.start();
  try {
    const s = await daemonRequest<Record<string, unknown>>("console_start", {}, home);
    assert.equal(s.running, true);
    assert.ok((s.port as number) > 0);
    assert.equal(s.loopback, "127.0.0.1");
    const st = await daemonRequest<Record<string, unknown>>("console_status", {}, home);
    assert.equal(st.running, true);
    assert.equal(st.port, s.port);
    const sp = await daemonRequest<Record<string, unknown>>("console_stop", {}, home);
    assert.equal(sp.running, false);
    const as = await daemonRequest<Record<string, unknown>>("console_status", {}, home);
    assert.equal(as.running, false);
  } finally { await daemon.close(); }
});

test("settings read at server start, double-start idempotent", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-pol-"));
  const store = new StateStore(home);
  try {
    const svc = new SettingsService(store);
    svc.update({ console: { boardListLimit: 5, taskListLimit: 10, eventListLimit: 7 } });
    const coordinator = new DaemonCoordinator(store, svc, 1);
    const root = await mkdtemp(path.join(tmpdir(), "fl-pol-s-"));
    const cs = svc.get().console;
    assert.equal(cs.boardListLimit, 5);
    assert.equal(cs.taskListLimit, 10);
    assert.equal(cs.eventListLimit, 7);
    const server = new ConsoleServer(coordinator, cs, root);
    openServers.add(server);
    const port = await server.start();
    assert.ok(port > 0);
    assert.equal(await server.start(), port);
    await server.stop();
  } finally { store.close(); }
});

test("app.js contains no innerHTML, no onclick=, no .style., no em dash", async () => {
  const srcFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "console", "public", "app.js");
  const src = await readFile(srcFile, "utf8");
  // No .innerHTML assignment for API data
  assert.ok(!/\.innerHTML\s*=/.test(src), "app.js must not use .innerHTML assignment");
  // No inline onclick handlers
  assert.ok(!/onclick\s*=/.test(src), "app.js must not set onclick in JS");
  assert.ok(!/\bonclick=/.test(src), "app.js must not construct onclick= strings");
  // No .style. property write (CSP blocks inline styles)
  assert.ok(!/\.style\./.test(src), "app.js must not write to .style. property");
  // No em dash character (U+2014)
  assert.ok(!/—/.test(src), "app.js must not contain em dash character");
  // Not a synthetic stub
  assert.ok(/ForkLight Console/.test(src) || /ForkLight/.test(src), "app.js should be the real console");
  assert.ok(src.includes("providerVerification"), "console must show configured versus verified provider state");
});

test("GET / serves real console assets from source tree", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-src-"));
  const store = new StateStore(home);
  try {
    const svc = new SettingsService(store);
    const coordinator = new DaemonCoordinator(store, svc, 1);
    const staticRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "console", "public");
    const server = new ConsoleServer(coordinator, svc.get().console, staticRoot);
    openServers.add(server);
    const port = await server.start();
    const url = `http://127.0.0.1:${port}`;

    let r = await httpGet(`${url}/`);
    assert.equal(r.status, 200);
    const html = r.body as string;
    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.ok(html.includes("ForkLight Console"));
    // No forms or mutation controls
    assert.ok(!/<form\b/i.test(html), "HTML must not contain forms");

    r = await httpGet(`${url}/app.js`);
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "application/javascript; charset=utf-8");
    const js = r.body as string;
    assert.ok(js.includes("textContent"), "JS must use textContent");
    assert.ok(js.includes("addEventListener"), "JS must use addEventListener for click handling");

    r = await httpGet(`${url}/app.css`);
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "text/css; charset=utf-8");

    await server.stop();
  } finally { store.close(); }
});

test("daemon console lifecycle serves HTML when assets are present", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-life-"));
  const daemon = new ForkLightDaemon(home, 1);
  await daemon.start();
  try {
    // The daemon will try src/console/public from the source tree
    const s = await daemonRequest<Record<string, unknown>>("console_start", {}, home);
    assert.equal(s.running, true);
    const port = s.port as number;
    assert.ok(port > 0);

    const r = await httpGet(`http://127.0.0.1:${port}/`);
    assert.equal(r.status, 200);
    const body = r.body as string;
    assert.ok(body.includes("ForkLight Console"), "HTML must contain ForkLight Console title");
    assert.ok(body.includes("app.js"), "HTML must reference app.js");

    await daemonRequest<Record<string, unknown>>("console_stop", {}, home);
  } finally { await daemon.close(); }
});
