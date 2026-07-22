import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { get, request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { DaemonMethod } from "../src/daemon/protocol.js";
import type { ProbeRunner } from "../src/core/provider-probe.js";
import { SettingsService } from "../src/core/settings.js";
import { SetupServer } from "../src/setup/server.js";
import { createSystemInspector, SetupService } from "../src/setup/service.js";
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
    platform: () => "darwin", nodeVersion: () => "v24.5.0",
    account: () => "test-user", commandExists: () => true, ...overrides,
  };
}

function doHttp(
  u: string, method: "GET" | "POST", token?: string, body?: unknown,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers["x-forklight-setup-token"] = token;
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

async function makeServer(overrides: {
  probe?: ProbeRunner; consolePort?: number; pluginOk?: boolean;
} = {}) {
  const home = await mkdtemp(path.join(tmpdir(), "fl-svr-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const keychain = new MemoryKeychain();
  const svc = new SetupService(settings, keychain, inspector());
  const staticDir = path.join(home, "static");
  mkdirSync(staticDir, { recursive: true });
  writeFileSync(path.join(staticDir, "index.html"), "<!DOCTYPE html><title>T</title>", "utf8");
  const evidence: Array<Record<string, unknown>> = [];
  const server = new SetupServer({
    service: svc, staticRoot: staticDir, port: 0,
    runProbe: overrides.probe ?? (async () => ({ ok: true, latencyMs: 123 })),
    probePolicy: () => ({ probeTimeoutMs: 30_000, maxBudgetUsd: 0.05, cacheLifetimeMs: 300_000, maxProbeConcurrency: 2 }),
    installPlugin: overrides.pluginOk === false
      ? () => { throw new Error("install rejected"); } : () => {},
    ensureDaemon: () => Promise.resolve({}),
    daemonRequest: <T>(_m: DaemonMethod, _p?: Record<string, unknown>): Promise<T> =>
      Promise.resolve({ port: overrides.consolePort ?? 9090, loopback: "127.0.0.1", running: true } as unknown as T),
    saveProbeEvidence: (e) => { evidence.push(e as unknown as Record<string, unknown>); },
  });
  return { server, store, settings, keychain, evidence, cleanup: () => store.close() };
}

async function verifyProvider(server: SetupServer, port: number): Promise<void> {
  const token = server.getToken();
  await doHttp(`http://127.0.0.1:${port}/api/provider`, "POST", token, { provider: "deepseek", variant: "default" });
  const probe = await doHttp(`http://127.0.0.1:${port}/api/probe`, "POST", token, {
    provider: "deepseek", variant: "default", apiKey: "sk-ready-test-key-123456", confirmCost: true,
  });
  assert.equal(probe.status, 200);
}

// === Security tests ===

test("unauthorized POST gets 401; correct token passes", async () => {
  const { server, cleanup } = await makeServer();
  const port = await server.start();
  const noTok = await doHttp(`http://127.0.0.1:${port}/api/provider`, "POST", undefined, { provider: "deepseek", variant: "default" });
  assert.equal(noTok.status, 401);
  const wrongTok = await doHttp(`http://127.0.0.1:${port}/api/provider`, "POST", "wrong", { provider: "deepseek", variant: "default" });
  assert.equal(wrongTok.status, 401);
  const goodTok = await doHttp(`http://127.0.0.1:${port}/api/provider`, "POST", server.getToken(), { provider: "deepseek", variant: "default" });
  assert.equal(goodTok.status, 200);
  await server.stop(); cleanup();
});

test("oversized body is rejected", async () => {
  const { server, cleanup } = await makeServer();
  const port = await server.start();
  const r = await doHttp(`http://127.0.0.1:${port}/api/provider`, "POST", server.getToken(), { provider: "deepseek", variant: "default", junk: "x".repeat(20_000) });
  assert.equal(r.status, 400);
  await server.stop(); cleanup();
});

test("GET bootstrap requires auth token", async () => {
  const { server, cleanup } = await makeServer();
  const port = await server.start();
  const noAuth = await doHttp(`http://127.0.0.1:${port}/api/bootstrap`, "GET");
  assert.equal(noAuth.status, 401);
  const withAuth = await doHttp(`http://127.0.0.1:${port}/api/bootstrap`, "GET", server.getToken());
  assert.equal(withAuth.status, 200);
  const body = withAuth.body as Record<string, unknown>;
  assert.ok(Array.isArray(body.prerequisites));
  await server.stop(); cleanup();
});

// === Provider: draft only, no persistence ===

test("POST /api/provider validates in-memory draft only, no Keychain write", async () => {
  const { server, keychain, settings, cleanup } = await makeServer();
  const port = await server.start();
  const before = settings.get();
  const r = await doHttp(`http://127.0.0.1:${port}/api/provider`, "POST", server.getToken(), { provider: "minimax", variant: "china" });
  assert.equal(r.status, 200);
  assert.equal((r.body as Record<string, unknown>).drafted, true);
  assert.equal(keychain.values.size, 0);
  assert.deepEqual(settings.get(), before);
  await server.stop(); cleanup();
});

test("POST /api/provider rejects unknown variants", async () => {
  const { server, cleanup } = await makeServer();
  const port = await server.start();
  const r = await doHttp(`http://127.0.0.1:${port}/api/provider`, "POST", server.getToken(), { provider: "minimax", variant: "fake" });
  assert.equal(r.status, 422);
  await server.stop(); cleanup();
});

// === Probe: confirmCost required; success persists, failure does not ===

test("probe requires confirmCost: true", async () => {
  const { server, cleanup } = await makeServer();
  const port = await server.start();
  const r = await doHttp(`http://127.0.0.1:${port}/api/probe`, "POST", server.getToken(), { provider: "deepseek", variant: "default", apiKey: "sk-test-key-enough-chars-12345" });
  assert.equal(r.status, 400);
  assert.match(String((r.body as Record<string, unknown>).error), /confirmCost/);
  await server.stop(); cleanup();
});

test("successful probe persists Keychain, settings, and evidence; redacts key", async () => {
  const { server, keychain, settings, evidence, cleanup } = await makeServer();
  const port = await server.start();
  const key = "sk-test-successful-key-abcdefgh";
  await doHttp(`http://127.0.0.1:${port}/api/provider`, "POST", server.getToken(), { provider: "deepseek", variant: "default" });
  const r = await doHttp(`http://127.0.0.1:${port}/api/probe`, "POST", server.getToken(), { provider: "deepseek", variant: "default", apiKey: key, confirmCost: true });
  assert.equal(r.status, 200);
  const body = r.body as Record<string, unknown>;
  assert.equal(body.ok, true);
  assert.equal(body.persisted, true);
  assert.equal(keychain.values.get("test-user:forklight.deepseek.api-key"), key);
  assert.equal(settings.get().execution.defaultProvider, "deepseek");
  assert.equal(evidence.length, 1);
  assert.equal(JSON.stringify(body).includes(key), false);
  await server.stop(); cleanup();
});

test("failed probe does NOT persist anything", async () => {
  const failingProbe: ProbeRunner = async () => ({ ok: false, category: "authentication", latencyMs: 99 });
  const { server, keychain, settings, evidence, cleanup } = await makeServer({ probe: failingProbe });
  const port = await server.start();
  const before = settings.get();
  await doHttp(`http://127.0.0.1:${port}/api/provider`, "POST", server.getToken(), { provider: "deepseek", variant: "default" });
  const r = await doHttp(`http://127.0.0.1:${port}/api/probe`, "POST", server.getToken(), { provider: "deepseek", variant: "default", apiKey: "sk-invalid-key-that-fails-99999", confirmCost: true });
  assert.equal(r.status, 422);
  const body = r.body as Record<string, unknown>;
  assert.equal(body.ok, false);
  assert.equal(body.persisted, false);
  assert.equal(keychain.values.size, 0);
  assert.deepEqual(settings.get(), before);
  assert.equal(evidence.length, 0);
  await server.stop(); cleanup();
});

test("probe rejects short API keys", async () => {
  const { server, cleanup } = await makeServer();
  const port = await server.start();
  const r = await doHttp(`http://127.0.0.1:${port}/api/probe`, "POST", server.getToken(), { provider: "deepseek", variant: "default", apiKey: "short", confirmCost: true });
  assert.equal(r.status, 400);
  await server.stop(); cleanup();
});

// === Plugin: confirm required ===

test("plugin requires confirm: true", async () => {
  const { server, cleanup } = await makeServer();
  const port = await server.start();
  const r = await doHttp(`http://127.0.0.1:${port}/api/plugin`, "POST", server.getToken(), { plugin: "codex" });
  assert.equal(r.status, 400);
  assert.match(String((r.body as Record<string, unknown>).error), /confirm/);
  await server.stop(); cleanup();
});

test("setup cannot install or finish before provider verification", async () => {
  const { server, cleanup } = await makeServer();
  const port = await server.start();
  const token = server.getToken();
  const plugin = await doHttp(`http://127.0.0.1:${port}/api/plugin`, "POST", token, { plugin: "codex", confirm: true });
  assert.equal(plugin.status, 409);
  const finish = await doHttp(`http://127.0.0.1:${port}/api/finish`, "POST", token, {});
  assert.equal(finish.status, 409);
  await server.stop(); cleanup();
});

test("plugin installs successfully with confirm", async () => {
  const { server, cleanup } = await makeServer();
  const port = await server.start();
  await verifyProvider(server, port);
  const r = await doHttp(`http://127.0.0.1:${port}/api/plugin`, "POST", server.getToken(), { plugin: "codex", confirm: true });
  assert.equal(r.status, 200);
  assert.equal((r.body as Record<string, unknown>).ok, true);
  await server.stop(); cleanup();
});

// === Finish: console URL, server shutdown ===

test("finish returns console URL and shuts down server", async () => {
  const { server, cleanup } = await makeServer({ consolePort: 8472 });
  const port = await server.start();
  await verifyProvider(server, port);
  const plugin = await doHttp(`http://127.0.0.1:${port}/api/plugin`, "POST", server.getToken(), { plugin: "codex", confirm: true });
  assert.equal(plugin.status, 200);
  const r = await doHttp(`http://127.0.0.1:${port}/api/finish`, "POST", server.getToken(), {});
  assert.equal(r.status, 200);
  const body = r.body as Record<string, unknown>;
  assert.equal(body.consoleUrl, "http://127.0.0.1:8472");
  assert.equal(body.complete, true);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(server.isRunning(), false);
  cleanup();
});

test("finish rejects unauthenticated", async () => {
  const { server, cleanup } = await makeServer();
  const port = await server.start();
  const r = await doHttp(`http://127.0.0.1:${port}/api/finish`, "POST", "bad", {});
  assert.equal(r.status, 401);
  await server.stop(); cleanup();
});

// === Security headers ===

test("responses carry security headers", async () => {
  const { server, cleanup } = await makeServer();
  const port = await server.start();
  await new Promise<void>((resolve, reject) => {
    get({ hostname: "127.0.0.1", port, path: "/api/bootstrap", headers: { Accept: "application/json" } }, (res) => {
      assert.equal(res.headers["x-content-type-options"], "nosniff");
      assert.equal(res.headers["x-frame-options"], "DENY");
      assert.equal(res.headers["cache-control"], "no-store");
      assert.ok(res.headers["content-security-policy"]);
      resolve();
    }).on("error", reject);
  });
  await server.stop(); cleanup();
});

// === Lifecycle & uniqueness ===

test("server starts, serves, stops idempotently; tokens are unique", async () => {
  const { server, cleanup } = await makeServer();
  const port = await server.start();
  assert.ok(port > 0);
  assert.ok(server.isRunning());
  const r = await doHttp(`http://127.0.0.1:${port}/api/bootstrap`, "GET", server.getToken());
  assert.equal(r.status, 200);
  await server.stop();
  assert.equal(server.isRunning(), false);
  await server.stop();
  assert.equal(server.isRunning(), false);

  const b = await makeServer();
  assert.notEqual(server.getToken(), b.server.getToken());
  await b.server.stop(); b.cleanup();
  cleanup();
});

// === Doctor read-only guarantees ===

test("doctor/bootstrap is read-only, never writes Keychain or settings", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-doctor-"));
  const store = new StateStore(home);
  const writes: string[] = [];
  const kc: SetupKeychainStore = {
    has: () => false, read: () => undefined,
    write: () => { writes.push("w"); }, delete: () => { writes.push("d"); },
  };
  try {
    const svc = new SetupService(new SettingsService(store), kc, createSystemInspector());
    const checks = svc.inspectPrerequisites();
    for (const c of checks) {
      assert.equal(typeof c.id, "string");
      assert.equal(typeof c.ready, "boolean");
      assert.equal(typeof c.blocker, "boolean");
      if (c.blocker && c.id !== "codex") assert.equal(typeof c.fix, "string");
    }
    assert.equal(writes.length, 0);
    assert.equal(store.getSettings(), undefined);
  } finally { store.close(); }
});

test("doctor JSON output is well-formed", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-doctor-json-"));
  const store = new StateStore(home);
  try {
    const svc = new SetupService(new SettingsService(store), { has: () => false, read: () => undefined, write: () => {}, delete: () => {} }, createSystemInspector());
    const out = { prereqs: svc.inspectPrerequisites(), providers: svc.describeProviders(), current: svc.currentProvider() };
    const json = JSON.stringify(out);
    assert.ok(json.length > 0);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    assert.ok(Array.isArray(parsed.prereqs));
  } finally { store.close(); }
});

// === Confirm cost blocks probe until explicit ===

test("confirmCost guard prevents probe from firing", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-confirm-"));
  const store = new StateStore(home);
  const svc = new SetupService(new SettingsService(store), { has: () => false, read: () => undefined, write: () => {}, delete: () => {} }, createSystemInspector());
  const dir = path.join(home, "static"); mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, "index.html"), "ok", "utf8");
  let probed = false;
  const server = new SetupServer({
    service: svc, staticRoot: dir, port: 0,
    runProbe: async () => { probed = true; return { ok: true, latencyMs: 1 }; },
    probePolicy: () => ({ probeTimeoutMs: 30_000, maxBudgetUsd: 0.05, cacheLifetimeMs: 300_000, maxProbeConcurrency: 2 }),
    installPlugin: () => {}, ensureDaemon: () => Promise.resolve({}),
    daemonRequest: <T>(_m: DaemonMethod, _p?: Record<string, unknown>): Promise<T> => Promise.resolve({ port: 9999 } as unknown as T),
    saveProbeEvidence: () => {},
  });
  const port = await server.start();
  const tok = server.getToken();
  // confirmCost: false → probe NOT called
  const r1 = await doHttp(`http://127.0.0.1:${port}/api/probe`, "POST", tok, { provider: "deepseek", variant: "default", apiKey: "sk-test-key-enough-length", confirmCost: false });
  assert.equal(r1.status, 400);
  assert.equal(probed, false);
  // confirmCost: true → probe fires
  const r2 = await doHttp(`http://127.0.0.1:${port}/api/probe`, "POST", tok, { provider: "deepseek", variant: "default", apiKey: "sk-test-key-enough-two", confirmCost: true });
  assert.equal(r2.status, 200);
  assert.equal(probed, true);
  await server.stop(); store.close();
});

// === Setup assets exist ===

test("setup assets exist in source tree", () => {
  const srcDir = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "setup", "public"));
  assert.ok(existsSync(path.join(srcDir, "index.html")), "setup index.html must exist");
});

// === Token in URL fragment, never query string ===

test("token is placed in URL fragment only", () => {
  const url = new URL("http://127.0.0.1:9999/#myToken");
  assert.equal(url.hash, "#myToken");
  assert.equal(url.search, "");
});

// === Full integration flow ===

test("full flow: draft → probe → plugin → finish", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-full-"));
  const store = new StateStore(home);
  const svc = new SetupService(new SettingsService(store), { has: () => false, read: () => undefined, write: () => {}, delete: () => {} }, createSystemInspector());
  const dir = path.join(home, "static"); mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, "index.html"), "ok", "utf8");
  let pluginOk = false;
  const server = new SetupServer({
    service: svc, staticRoot: dir, port: 0,
    runProbe: async () => ({ ok: true, latencyMs: 42 }),
    probePolicy: () => ({ probeTimeoutMs: 30_000, maxBudgetUsd: 0.05, cacheLifetimeMs: 300_000, maxProbeConcurrency: 2 }),
    installPlugin: () => { pluginOk = true; },
    ensureDaemon: () => Promise.resolve({}),
    daemonRequest: <T>(_m: DaemonMethod, _p?: Record<string, unknown>): Promise<T> => Promise.resolve({ port: 8080 } as unknown as T),
    saveProbeEvidence: () => {},
  });
  const port = await server.start();
  const tok = server.getToken();
  const key = "sk-fullflow-test-key-xxyyzz";

  const draft = await doHttp(`http://127.0.0.1:${port}/api/provider`, "POST", tok, { provider: "qwen", variant: "token-plan", model: "qwen3.8-max-preview" });
  assert.equal(draft.status, 200);

  const probe = await doHttp(`http://127.0.0.1:${port}/api/probe`, "POST", tok, { provider: "qwen", variant: "token-plan", model: "qwen3.8-max-preview", apiKey: key, confirmCost: true });
  assert.equal(probe.status, 200);
  assert.equal((probe.body as Record<string, unknown>).persisted, true);

  const plugin = await doHttp(`http://127.0.0.1:${port}/api/plugin`, "POST", tok, { plugin: "codex", confirm: true });
  assert.equal(plugin.status, 200);
  assert.equal(pluginOk, true);

  const finish = await doHttp(`http://127.0.0.1:${port}/api/finish`, "POST", tok, {});
  assert.equal(finish.status, 200);
  assert.equal((finish.body as Record<string, unknown>).consoleUrl, "http://127.0.0.1:8080");

  await new Promise((r) => setTimeout(r, 200));
  assert.equal(server.isRunning(), false);
  store.close();
});
