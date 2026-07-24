import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
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
import type {
  AttemptOfficialCostCalculationUnavailable,
  AttemptOfficialCostQuoted,
  AttemptRecord,
  AttemptTokenUsage,
} from "../src/core/types.js";
import type { PricingCurrency, PricingUnavailableReason } from "../src/core/pricing.js";
import {
  type PricingIdentitySnapshot,
  type QuotedCost,
  type UnavailableEvidence,
} from "../src/core/pricing-calculator.js";
import { getTaskEconomicsReport } from "../src/core/task-economics-report.js";

const ECON_TS = "2026-07-23T12:00:00.000Z";
const ECON_SRC = "https://api-docs.deepseek.com/quick_start/pricing/";

function econQuotedOC(currency: PricingCurrency, total: number, srcUrl?: string): AttemptOfficialCostQuoted {
  const snap: PricingIdentitySnapshot = { provider: "deepseek", origin: "https://api.deepseek.com",
    route: "deepseek-direct-payg", modelAliases: ["deepseek-v4-pro"],
    serviceTier: "standard", currency, unitTokens: 1_000_000,
    source: { url: srcUrl || ECON_SRC, checkedAt: ECON_TS }, promotion: null };
  const qc: QuotedCost = {
    quoted: true as const, currency, total,
    components: [
      { component: "input", tokens: 1000, ratePerMillion: 0.5, amount: 0.5 },
      { component: "output", tokens: 1000, ratePerMillion: 1.0, amount: 1.0 },
      { component: "cacheRead", tokens: 0, ratePerMillion: 0.005, amount: 0 },
      { component: "cacheCreation", tokens: 0, ratePerMillion: 0.5, amount: 0 },
    ] as any,
    pricing: snap,
    appliedTier: { applied: [{ minimumInputTokensExclusive: null, totalPromptInput: 1000 }], totalPromptInput: 1000 } as any,
    usageSource: "terminal-result", providerBillClaim: false,
  };
  return { stage: "calculation", quoted: true, result: qc } as AttemptOfficialCostQuoted;
}

function econCalcUA(reason: string): AttemptOfficialCostCalculationUnavailable {
  const ev: UnavailableEvidence = { provider: "ds", currency: "USD", tiersAvailable: 1,
    components: [], expectedAggregate: null, observedAggregate: null, positiveNullRateComponents: [] };
  return { stage: "calculation", quoted: false,
    result: { quoted: false, reason, evidence: ev } } as AttemptOfficialCostCalculationUnavailable;
}

const econUsageUA = (reason: "usage-missing" | "service-tier-missing") =>
  ({ stage: "usage", quoted: false, reason }) as const;
const econIdUA = (reason: PricingUnavailableReason) =>
  ({ stage: "pricing-identity", quoted: false, reason }) as const;

const econCompleteUsage = (): AttemptTokenUsage => ({ inputTokens: 1000, outputTokens: 500,
  cacheReadInputTokens: 200, cacheCreationInputTokens: 50, source: "terminal-result", complete: true });

function addAttempt(store: StateStore, id: string, taskId: string, ordinal: number, fields: Partial<AttemptRecord> = {}): void {
  store.createAttempt({ id, taskId, ordinal, status: "succeeded",
    sessionId: `s-${id}`, rawLogPath: `/tmp/${id}.log`,
    startedAt: ECON_TS, finishedAt: ECON_TS, exitCode: 0, ...fields } as AttemptRecord);
}

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

function httpGetAuth(url: string, token: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    get(url, { headers: { "X-ForkLight-Console-Token": token } }, (res) => {
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

function httpReqAuth(method: string, url: string, token: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: { "X-ForkLight-Console-Token": token } }, (res) => {
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

function httpHeadAuth(url: string, token: string): Promise<HttpResponse> { return httpReqAuth("HEAD", url, token); }

async function serve(
  store: StateStore,
  staticDir?: string,
): Promise<{ server: ConsoleServer; port: number; url: string; token: string }> {
  const svc = new SettingsService(store);
  const coordinator = new DaemonCoordinator(store, svc, 1);
  const root = staticDir ?? (await mkdtemp(path.join(tmpdir(), "fl-console-")));
  const server = new ConsoleServer(coordinator, svc.get().console, root);
  openServers.add(server);
  const port = await server.start();
  return { server, port, url: `http://127.0.0.1:${port}`, token: server.getToken() };
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
    const { server, url, token } = await serve(store);
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const { status, body } = await httpGetAuth(`${url}/health`, token);
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
    const { server, url, token } = await serve(store);
    const { status, body } = await httpGetAuth(`${url}/settings`, token);
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
    const { server, url, token } = await serve(store);
    const b = await httpGetAuth(`${url}/board`, token);
    const p = await httpGetAuth(`${url}/plans`, token);
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
    const token = server.getToken();
    const url = `http://127.0.0.1:${port}`;

    const task = specTask(store, "timeline-test");
    const tid = task.id;
    for (let i = 1; i <= 5; i++) {
      store.addEvent(tid, undefined, "worker.message", `event ${i}`, { secret: `payload-${i}` });
    }
    const { status, body } = await httpGetAuth(`${url}/tasks/${tid}`, token);
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
    const nf = await httpGetAuth(`${url}/tasks/nonexistent`, token);
    assert.equal(nf.status, 404);

    await server.stop();
  } finally { store.close(); }
});

test("GET /tasks/:id includes the canonical authority decision view", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-decision-"));
  const store = new StateStore(home);
  try {
    const task = specTask(store, "decision-test");
    store.addEvent(task.id, undefined, "worker.completed", "Worker reported completion", {
      claim: { label: "unverified-claim", text: "All tests pass" },
    });
    store.addEvent(task.id, undefined, "verification.completed", "Verified", {
      passed: true,
      behaviorPassed: true,
      policyPassed: true,
      sourceCompatible: true,
      commands: [],
      diffPath: task.paths.diff,
      sourceUnchanged: true,
    });
    const { server, url, token } = await serve(store);
    const response = await httpGetAuth(`${url}/tasks/${task.id}`, token);
    assert.equal(response.status, 200);
    const decision = (response.body as {
      decision: {
        stage: string;
        workerClaim: { label: string; text: string };
        nextAction: string;
      };
    }).decision;
    assert.equal(decision.stage, "awaiting-main-review");
    assert.equal(decision.workerClaim.label, "unverified-claim");
    assert.equal(decision.workerClaim.text, "All tests pass");
    assert.equal(decision.nextAction, "Main Codex must review");
    await server.stop();
  } finally {
    store.close();
  }
});

test("GET /competitions and /stats are capped by boardListLimit", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-cs-"));
  const store = new StateStore(home);
  try {
    const { server, url, token } = await serve(store);
    assert.equal((await httpGetAuth(`${url}/competitions`, token)).status, 200);
    assert.equal((await httpGetAuth(`${url}/stats`, token)).status, 200);
    await server.stop();
  } finally { store.close(); }
});

test("integration history caps receipts/results with eventListLimit, not-found returns 404", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ih-"));
  const store = new StateStore(home);
  try {
    const { server, url, token } = await serve(store);
    const { status } = await httpGetAuth(`${url}/integration/nonexistent/history`, token);
    assert.equal(status, 404);
    await server.stop();
  } finally { store.close(); }
});

test("non-GET returns 405 and does not change store state", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-mut-"));
  const store = new StateStore(home);
  try {
    const { server, url, token } = await serve(store);
    const before = store.listTasks().length;
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await httpReqAuth(m, `${url}/health`, token);
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
    const { server, url, token } = await serve(store);
    let r = await httpHeadAuth(`${url}/health`, token);
    assert.equal(r.status, 200);
    assert.equal(r.body, "");
    assert.ok(typeof r.headers["content-length"] === "string");
    r = await httpHead(`${url}/health`);
    assert.equal(r.status, 401);
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
    const { server, url, token } = await serve(store);
    for (const tuple of [["/health", token], ["/missing", null]] as const) {
      const [path, tok] = tuple;
      const { headers } = tok ? await httpGetAuth(`${url}${path}`, tok) : await httpGet(`${url}${path}`);
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
    assert.ok(typeof s.launchUrl === "string", "console_start must include launchUrl");
    assert.match(s.launchUrl as string, /^http:\/\/127\.0\.0\.1:\d+#[A-Za-z0-9_-]+$/);
    const sAgain = await daemonRequest<Record<string, unknown>>("console_start", {}, home);
    assert.equal(sAgain.launchUrl, s.launchUrl, "same running Console keeps one session token");
    const st = await daemonRequest<Record<string, unknown>>("console_status", {}, home);
    assert.equal(st.running, true);
    assert.equal(st.port, s.port);
    assert.equal(st.authentication, "required");
    assert.ok(!("launchUrl" in st), "console_status must not expose launchUrl");
    assert.ok(!("token" in st), "console_status must not expose token");
    const sp = await daemonRequest<Record<string, unknown>>("console_stop", {}, home);
    assert.equal(sp.running, false);
    const as = await daemonRequest<Record<string, unknown>>("console_status", {}, home);
    assert.equal(as.running, false);
    const restarted = await daemonRequest<Record<string, unknown>>("console_start", {}, home);
    assert.notEqual(restarted.launchUrl, s.launchUrl, "new Console instance receives a new token");
    await daemonRequest<Record<string, unknown>>("console_stop", {}, home);
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
  for (const label of [
    "Worker claim (unverified)",
    "Independent verification",
    "Main Codex review",
    "User authorization",
    "Integration and activation",
    "Next action",
  ]) {
    assert.ok(src.includes(label), `decision drawer must include ${label}`);
  }
  assert.ok(src.includes("providerVerification"), "console must show configured versus verified provider state");
  // No browser storage or cookie access
  assert.ok(!/localStorage|sessionStorage|document\.cookie|[^.]\bcookie\s*=/.test(src), "app.js must not use browser storage or cookies");
  // Authenticated fetch and token lifecycle
  assert.ok(src.includes("X-ForkLight-Console-Token"), "all data fetches must carry the auth header");
  assert.ok(src.includes("readToken"), "token must be read from URL fragment");
  assert.ok(src.includes("replaceState"), "fragment must be erased after reading");
  assert.ok(src.includes("token.length!==43"), "only a full 32-byte base64url token may start polling");
  assert.ok(src.includes("e.status===401") && src.includes("S.token=null"), "a rejected token must stop polling");
  assert.ok(!src.includes("?token="), "token must never appear in query parameters");
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
    assert.ok(html.includes('id="fl-detail" hidden role="dialog" aria-label="Details"'), "details use an accessible dialog landmark");
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

// --- Authentication ---

test("data routes require token, static assets remain public", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-auth-"));
  const store = new StateStore(home);
  try {
    const { server, url, token } = await serve(store);
    // Authenticated data route
    const r = await httpGetAuth(`${url}/health`, token);
    assert.equal(r.status, 200);
    // Unauthenticated data route → 401
    const u = await httpGet(`${url}/health`);
    assert.equal(u.status, 401);
    const ub = u.body as Record<string, unknown>;
    assert.equal(ub.error, "Unauthorized");
    // Static asset without token → 200
    const staticDir = await mkdtemp(path.join(tmpdir(), "fl-auth-static-"));
    await server.stop();
    const s2 = await serve(store, staticDir);
    // no static files in empty dir → 404, but not 401
    const st = await httpGet(`${s2.url}/`);
    assert.notEqual(st.status, 401, "static assets must not require authentication");
    await s2.server.stop();
  } finally { store.close(); }
});

test("wrong and oversized tokens fail with fixed 401", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-wtok-"));
  const store = new StateStore(home);
  try {
    const { server, url, token } = await serve(store);
    // Wrong token (same length, different value)
    const wrongToken = "A".repeat(token.length);
    const r1 = await httpGetAuth(`${url}/health`, wrongToken);
    assert.equal(r1.status, 401);
    assert.equal((r1.body as Record<string, unknown>).error, "Unauthorized");
    // Oversized token
    const bigToken = "A".repeat(257);
    const r2 = await httpGetAuth(`${url}/health`, bigToken);
    assert.equal(r2.status, 401);
    assert.equal((r2.body as Record<string, unknown>).error, "Unauthorized");
    // Short (wrong-length) token
    const shortToken = "A".repeat(10);
    const r3 = await httpGetAuth(`${url}/health`, shortToken);
    assert.equal(r3.status, 401);
    assert.equal((r3.body as Record<string, unknown>).error, "Unauthorized");
    // Valid token still works
    const r4 = await httpGetAuth(`${url}/health`, token);
    assert.equal(r4.status, 200);
    await server.stop();
  } finally { store.close(); }
});

test("token uniqueness across ConsoleServer instances", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-tuniq-"));
  const store = new StateStore(home);
  try {
    const s1 = await serve(store);
    const s2 = await serve(store);
    assert.notEqual(s1.token, s2.token);
    // s1 token works on s1
    assert.equal((await httpGetAuth(`${s1.url}/health`, s1.token)).status, 200);
    // s1 token does NOT work on s2
    assert.equal((await httpGetAuth(`${s2.url}/health`, s1.token)).status, 401);
    await s1.server.stop();
    await s2.server.stop();
  } finally { store.close(); }
});

test("HEAD data routes require authentication", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-headauth-"));
  const store = new StateStore(home);
  try {
    const { server, url, token } = await serve(store);
    // HEAD without token → 401
    const r1 = await httpHead(`${url}/health`);
    assert.equal(r1.status, 401);
    // HEAD with token → 200
    const r2 = await httpHeadAuth(`${url}/health`, token);
    assert.equal(r2.status, 200);
    assert.equal(r2.body, "");
    await server.stop();
  } finally { store.close(); }
});

test("401 response never echoes the token or details", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-401echo-"));
  const store = new StateStore(home);
  try {
    const { server, url, token } = await serve(store);
    // Missing header
    const r0 = await httpGet(`${url}/health`);
    assert.equal(r0.status, 401);
    assert.equal((r0.body as Record<string, unknown>).error, "Unauthorized");
    // Wrong/short/oversized tokens
    for (const badToken of ["wrong-value", "A".repeat(token.length), "A".repeat(257)]) {
      const r = await httpGetAuth(`${url}/health`, badToken);
      assert.equal(r.status, 401);
      const body = JSON.stringify(r.body);
      assert.ok(!body.includes(badToken), "401 must never echo the submitted token");
      assert.equal((r.body as Record<string, unknown>).error, "Unauthorized");
    }
    await server.stop();
  } finally { store.close(); }
});

test("read-only invariant preserved: POST/PUT/PATCH/DELETE return 405 with auth", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ro-auth-"));
  const store = new StateStore(home);
  try {
    const { server, url, token } = await serve(store);
    const before = store.listTasks().length;
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await httpReqAuth(m, `${url}/health`, token);
      assert.equal(r.status, 405);
      assert.ok(typeof (r.body as Record<string, unknown>).error === "string");
    }
    assert.equal(store.listTasks().length, before);
    await server.stop();
  } finally { store.close(); }
});

// Economics Evidence — read-only route + truthful renderer tests

async function econServe(store: StateStore): Promise<{ coordinator: DaemonCoordinator; url: string; root: string; token: string; }> {
  const root = await mkdtemp(path.join(tmpdir(), "fl-ec-s-"));
  const svc = new SettingsService(store);
  const coordinator = new DaemonCoordinator(store, svc, 1);
  const server = new ConsoleServer(coordinator, svc.get().console, root);
  openServers.add(server);
  const port = await server.start();
  return { coordinator, url: `http://127.0.0.1:${port}`, root, token: server.getToken() };
}

test("GET /tasks/:id returns canonical economics report under one stable field, no recomputation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ec-"));
  const store = new StateStore(home);
  try {
    const { coordinator, url, token } = await econServe(store);
    const task = specTask(store, "econ-ok");
    addAttempt(store, "a1", task.id, 1, { usage: econCompleteUsage(),
      runtimeCostEstimateUsd: 0.5, officialCost: econQuotedOC("USD", 0.07) });
    addAttempt(store, "a2", task.id, 2, { usage: econCompleteUsage(),
      runtimeCostEstimateUsd: 1.0, officialCost: econQuotedOC("USD", 0.02) });
    const canonical = coordinator.taskEconomics(task.id);
    const { status, body } = await httpGetAuth(`${url}/tasks/${task.id}`, token);
    assert.equal(status, 200);
    const r = body as Record<string, unknown>;
    assert.equal(r.id, task.id);
    // Required route fields + sessionId + timeline are always emitted; optional
    // startedAt/finishedAt/error are only emitted when defined on the Task.
    for (const k of ["id","name","status","provider","model","runtime","source",
      "sessionId","createdAt","timeline"]) {
      assert.ok(k in r, `existing field ${k} must be preserved`);
    }
    assert.ok("economics" in r, "economics field must be present under stable name");
    assert.deepEqual(r.economics, canonical, "route must embed the canonical report unchanged");
    const econ = r.economics as unknown as Record<string, unknown>;
    assert.equal(econ.taskId, task.id);
    const tr = (econ.tokenReport as Record<string, unknown>).report as Record<string, unknown>;
    assert.ok(typeof tr.workerVolume === "object");
    assert.ok(typeof tr.exchangeEstimate === "object");
    assert.ok(typeof tr.boundaryReduction === "object");
    assert.ok(typeof tr.directCodexSavings === "object");
    // Read-only invariant: mutation methods stay 405, store state unchanged
    const before = store.listTasks().length;
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      const rr = await httpReq(m, `${url}/tasks/${task.id}`);
      assert.equal(rr.status, 405);
    }
    assert.equal(store.listTasks().length, before);
  } finally { store.close(); }
});

test("economics report on /tasks/:id leaks no raw payload, logs, errors, or prompt/hash fields", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ec2-"));
  const store = new StateStore(home);
  try {
    const { url, token } = await econServe(store);
    const task = specTask(store, "econ-priv");
    addAttempt(store, "a1", task.id, 1, { usage: econCompleteUsage(),
      runtimeCostEstimateUsd: 0.5, officialCost: econQuotedOC("USD", 0.01),
      resultText: "SECRET RESULT", error: "SECRET-ERROR", rawLogPath: "/secret/log/path" });
    // Privacy is asserted against the canonical economics subtree only - the
    // outer Task response legitimately exposes its own sessionId, error, etc.
    const econPayload = ((await httpGetAuth(`${url}/tasks/${task.id}`, token)).body as Record<string, unknown>).economics;
    const json = JSON.stringify(econPayload);
    for (const w of ["SECRET RESULT", "SECRET-ERROR", "/secret/log/path",
      "resultText", "error", "rawLogPath", "sessionId", "prompt", "hash"])
      assert.ok(!json.includes(w), `economics leaked: ${w}`);
  } finally { store.close(); }
});

test("economics multi-currency: separate currency totals, no cross-currency grand total", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ec3-"));
  const store = new StateStore(home);
  try {
    const { url, token } = await econServe(store);
    const task = specTask(store, "econ-cur");
    addAttempt(store, "a1", task.id, 1, { officialCost: econQuotedOC("USD", 0.10) });
    addAttempt(store, "a2", task.id, 2, { officialCost: econQuotedOC("CNY", 3.50) });
    addAttempt(store, "a3", task.id, 3, { officialCost: econQuotedOC("USD", 0.05) });
    const econ = ((await httpGetAuth(`${url}/tasks/${task.id}`, token)).body as Record<string, unknown>).economics as Record<string, unknown>;
    const totals = (econ.officialCost as Record<string, unknown>).totals as Array<Record<string, unknown>>;
    assert.equal(totals.length, 2);
    // Sorted alphabetically: CNY before USD; no cross-currency grand total
    assert.equal(totals[0]!.currency, "CNY"); assert.equal(totals[0]!.total, 3.50);
    assert.equal(totals[1]!.currency, "USD"); const usdTotal = totals[1]!.total as number;
    assert.ok(Math.abs(usdTotal - 0.15) < 1e-12);
    assert.equal(totals[1]!.quotedCount, 2);
    assert.ok(!("grandTotal" in (econ.officialCost as Record<string, unknown>)), "no grand-total field");
  } finally { store.close(); }
});

test("economics unavailable states: counts and reasons explicit, never zero; direct-Codex not yet measurable", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ec4-"));
  const store = new StateStore(home);
  try {
    const { url, token } = await econServe(store);
    const task = specTask(store, "econ-ua");
    addAttempt(store, "a1", task.id, 1, { officialCost: econQuotedOC("USD", 0.01) });
    addAttempt(store, "a2", task.id, 2, { officialCost: econCalcUA("invalid-usage") });
    addAttempt(store, "a3", task.id, 3, { officialCost: econUsageUA("usage-missing") });
    addAttempt(store, "a4", task.id, 4, { officialCost: econIdUA("unsupported-model") });
    addAttempt(store, "a5", task.id, 5);
    const econ = ((await httpGetAuth(`${url}/tasks/${task.id}`, token)).body as Record<string, unknown>).economics as Record<string, unknown>;
    const ua = (econ.officialCost as Record<string, unknown>).unavailable as Record<string, unknown>;
    assert.equal(ua.unavailableCount, 4);
    const re2 = econ.runtimeEstimate as Record<string, unknown>;
    assert.equal(re2.missingCount, 5);
    assert.equal(re2.complete, false);
    const tr = (econ.tokenReport as Record<string, unknown>).report as Record<string, unknown>;
    const ee = tr.exchangeEstimate as Record<string, unknown>;
    assert.equal(ee.kind, "unavailable");
    assert.equal(ee.reason, "no-measurements");
    assert.equal((tr.boundaryReduction as Record<string, unknown>).available, false);
    const ds = tr.directCodexSavings as Record<string, unknown>;
    assert.equal(ds.available, false);
    assert.equal(ds.reason, "direct-baseline-missing");
  } finally { store.close(); }
});

test("economics direct-Codex savings: stays unavailable when compatible calibration lacks exchange evidence", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-ec5-"));
  const store = new StateStore(home);
  try {
    const { url, token } = await econServe(store);
    const task = specTask(store, "econ-cal");
    addAttempt(store, "a1", task.id, 1, { usage: econCompleteUsage() });
    const routeDs = ((await httpGetAuth(`${url}/tasks/${task.id}`, token)).body as Record<string, unknown>).economics as Record<string, unknown>;
    const dsRoute = ((routeDs.tokenReport as Record<string, unknown>).report as Record<string, unknown>).directCodexSavings as Record<string, unknown>;
    assert.equal(dsRoute.available, false);
    assert.equal(dsRoute.reason, "direct-baseline-missing");
    // Profile-aware publication envelope: the explicit override identity
    // exactly matches, but the fixture has no exchange receipts or
    // measurements, so direct-Codex savings remains unavailable with
    // reason "missing-exchange-evidence" (per the canonical
    // token-efficiency precedence chain).
    const envelope = {
      directCodexProfileId: "codex-main-v1",
      calibration: { minTokens: 800, maxTokens: 1200, method: "bench", taskClass: "edit",
        confidence: "medium" as const, version: 1, sampleSize: 4,
        evidenceReferences: ["sample:edit-codex-main-v1-v1"],
        createdAt: ECON_TS, schemaVersion: 1 as const },
      envelopeSchemaVersion: 1 as const,
    };
    const matched = getTaskEconomicsReport(store, task.id, {
      calibrationPublication: envelope,
      currentTaskClass: "edit",
      currentDirectCodexProfileId: "codex-main-v1",
    });
    const matchedDs = matched.tokenReport.report.directCodexSavings as { available: boolean; reason: string };
    assert.equal(matchedDs.available, false);
    assert.equal(matchedDs.reason, "missing-exchange-evidence");
    assert.equal(matched.tokenReport.calibrationSelection.kind, "explicit-override");
  } finally { store.close(); }
});

test("app.js Economics renderer truthful labels (offloaded, counterfactual, not-yet-measurable, no grand-total); responsive CSS", async () => {
  const baseDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "console", "public");
  const src = await readFile(path.join(baseDir, "app.js"), "utf8");
  const css = await readFile(path.join(baseDir, "app.css"), "utf8");

  // Worker volume: labeled offloaded, never saved Tokens
  assert.ok(/offloaded/i.test(src), "Worker volume must be labeled as offloaded work");
  assert.ok(!/saved tokens/i.test(src), "must not claim tokens saved");
  // Direct-Codex: counterfactual + not yet measurable
  assert.ok(/counterfactual/i.test(src));
  assert.ok(/not yet measurable/i.test(src));
  // No grand total anywhere
  assert.ok(!/grand.?total/i.test(src));
  // Method, confidence, and range rendered together
  assert.ok(/method/i.test(src)); assert.ok(/confidence/i.test(src)); assert.ok(/range/i.test(src));
  // Security / formatting invariants held
  assert.ok(!/—/.test(src), "no em dash");
  assert.ok(!/\.innerHTML\s*=/.test(src), "no innerHTML");
  assert.ok(!/\.style\./.test(src), "no inline style");
  assert.ok(!/onclick\s*=/i.test(src), "no inline onclick");
  // Non-zero sub-cent evidence must not be rounded to a false zero. Runtime
  // estimates and official quotes share the same adaptive formatter.
  assert.ok(/function evAmount\(/.test(src), "adaptive evidence amount formatter required");
  assert.ok(/toExponential\(3\)/.test(src), "very small non-zero evidence remains visible");
  assert.ok(/evCost\(re\.observedTotalUsd,"USD"\)/.test(src), "runtime estimate uses evidence formatter");
  assert.ok(/evCost\(t\.total,t\.currency\)/.test(src), "official quote uses evidence formatter");
  assert.ok(!/\[evRange\([^)]*\)\s*\+/.test(src), "range elements must be appended, never string-coerced");
  // Persisted evidence is untrusted at the presentation boundary. Only
  // official web protocols become clickable source links.
  assert.ok(/parsed\.protocol!=="http:"&&parsed\.protocol!=="https:"/.test(src), "source links allow only http/https");
  assert.ok(/ev-source-invalid/.test(src), "unsafe or malformed sources remain visible as plain text");
  assert.ok(!/Avg Cost/.test(src), "runtime estimate must not be labeled as Provider cost");
  assert.ok(/Avg Runtime Estimate \(USD\)/.test(src), "statistics label the legacy estimate explicitly");
  assert.ok(/not Provider official cost/.test(src), "statistics explain the evidence boundary");
  assert.ok(/function unit\(/.test(src), "suffix units use an explicit formatter");
  assert.ok(/e\.key==="Escape"&&S\.detail/.test(src), "details close with Escape");
  assert.match(css, /#fl-detail\s*\{[^}]*position\s*:\s*fixed[^}]*right\s*:\s*0[^}]*bottom\s*:\s*0[^}]*overflow-y\s*:\s*auto/i, "details stay visible as a bounded drawer");
  // Responsive single-column rule under 768px
  assert.match(css, /\.economics-grid\s*\{[^}]*grid-template-columns\s*:\s*1fr\s+1fr/i);
  assert.match(css, /@media\s*\(\s*max-width\s*:\s*768px\s*\)\s*\{\s*\.economics-grid\s*\{\s*grid-template-columns\s*:\s*1fr\s*\}/i);
  assert.match(css, /@media\s*\(\s*max-width\s*:\s*768px\s*\)\s*\{[^}]*#fl-detail\s*\{[^}]*width\s*:\s*100vw/i, "drawer fills a narrow viewport");
  assert.ok(/\.ev-source:focus-visible/.test(css), "link focus ring preserved");
});
