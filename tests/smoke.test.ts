import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { daemonRequest } from "../src/daemon/client.js";
import { ForkLightDaemon } from "../src/daemon/server.js";

interface HttpResponse {
  status: number;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
}

function httpGet(url: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => (data += chunk.toString()));
      res.on("end", () => {
        try {
          resolve({
            status: res.statusCode ?? 0,
            body: JSON.parse(data),
            headers: res.headers,
          });
        } catch {
          resolve({
            status: res.statusCode ?? 0,
            body: data,
            headers: res.headers,
          });
        }
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

/**
 * Offline smoke verification — exercises the local control path without
 * contacting any model provider, mutating a source project, integrating,
 * committing, or pushing.  Uses an isolated temporary ForkLight home that
 * is cleaned up after the test regardless of success or failure.
 */
test("smoke: daemon lifecycle, settings read/write, console read endpoints, safe shutdown", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-smoke-"));
  const daemon = new ForkLightDaemon(home, 1);
  try {
    // --- daemon lifecycle ---
    await daemon.start();
    const health = await daemonRequest<Record<string, unknown>>("health", {}, home);
    assert.equal(typeof health.ok, "boolean");
    assert.equal(typeof health.pid, "number");
    assert.equal(health.maxConcurrency, 1);
    assert.ok(Array.isArray(health.activeTaskIds));
    assert.ok(Array.isArray(health.queuedTaskIds));

    // --- settings: read defaults ---
    const settings = await daemonRequest<Record<string, unknown>>("settings_get", {}, home);
    assert.equal(settings.version, 1);
    const exec = settings.execution as Record<string, unknown>;
    assert.equal(exec.maxConcurrency, 2); // default, not overridden by constructor
    assert.equal(exec.defaultProvider, "deepseek");
    assert.equal(exec.defaultMaxBudgetUsd, 0.5);

    // --- settings: safe partial update ---
    const updated = await daemonRequest<Record<string, unknown>>(
      "settings_update",
      { patch: { execution: { maxConcurrency: 4 }, console: { loopbackPort: 0 } } },
      home,
    );
    const updatedExec = (updated.execution as Record<string, unknown>);
    assert.equal(updatedExec.maxConcurrency, 4);
    // defaults unchanged
    assert.equal(updatedExec.defaultProvider, "deepseek");
    assert.equal(updatedExec.defaultMaxBudgetUsd, 0.5);

    // --- settings: unchanged fields survive reopen ---
    const reloaded = await daemonRequest<Record<string, unknown>>("settings_get", {}, home);
    assert.equal((reloaded.execution as Record<string, unknown>).maxConcurrency, 4);

    // --- settings: reject invalid patch, prior state preserved ---
    await assert.rejects(
      () =>
        daemonRequest("settings_update", {
          patch: { execution: { maxConcurrency: -1 } },
        }, home),
      /Settings validation failed/,
    );
    const afterReject = await daemonRequest<Record<string, unknown>>("settings_get", {}, home);
    assert.equal((afterReject.execution as Record<string, unknown>).maxConcurrency, 4);

    // --- settings: reject credential-like fields ---
    await assert.rejects(
      () =>
        daemonRequest("settings_update", {
          patch: { apiToken: "abc123" },
        }, home),
      /credential/,
    );

    // --- settings: reset restores built-in defaults ---
    const reset = await daemonRequest<Record<string, unknown>>("settings_reset", {}, home);
    assert.equal((reset.execution as Record<string, unknown>).maxConcurrency, 2);

    // --- console lifecycle ---
    const started = await daemonRequest<Record<string, unknown>>("console_start", {}, home);
    assert.equal(started.running, true);
    const port = started.port as number;
    assert.ok(port > 0);
    assert.equal(started.loopback, "127.0.0.1");

    const status = await daemonRequest<Record<string, unknown>>("console_status", {}, home);
    assert.equal(status.running, true);
    assert.equal(status.port, port);

    // --- console read-only endpoints ---
    const baseUrl = `http://127.0.0.1:${port}`;

    const healthRes = await httpGet(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const h = healthRes.body as Record<string, unknown>;
    assert.equal(typeof h.pid, "number");
    assert.ok(
      !/"keychain(?:Service|Exists)"\s*:/i.test(JSON.stringify(h)),
      "health must not expose keychain metadata fields",
    );
    const hProviders = h.providers as Record<string, Record<string, unknown>> | undefined;
    if (hProviders) {
      for (const [_, pv] of Object.entries(hProviders)) {
        assert.ok(
          typeof pv.ready === "boolean" && typeof pv.defaultModel === "string",
        );
      }
    }

    const settingsRes = await httpGet(`${baseUrl}/settings`);
    assert.equal(settingsRes.status, 200);
    // redacted: no keychain fields
    const bodyStr = JSON.stringify(settingsRes.body);
    assert.ok(!/keychain/i.test(bodyStr), "settings must not expose keychain fields");

    const boardRes = await httpGet(`${baseUrl}/board`);
    assert.equal(boardRes.status, 200);
    assert.ok(Array.isArray(boardRes.body));

    const tasksRes = await httpGet(`${baseUrl}/tasks`);
    assert.equal(tasksRes.status, 200);
    assert.ok(Array.isArray(tasksRes.body));

    const compRes = await httpGet(`${baseUrl}/competitions`);
    assert.equal(compRes.status, 200);
    assert.ok(Array.isArray(compRes.body));

    const statsRes = await httpGet(`${baseUrl}/stats`);
    assert.equal(statsRes.status, 200);
    assert.ok(Array.isArray(statsRes.body));

    // unknown route returns 404
    const missingRes = await httpGet(`${baseUrl}/no-such-route`);
    assert.equal(missingRes.status, 404);

    // read-only enforcement: POST returns 405
    const { request } = await import("node:http");
    const postRes = await new Promise<HttpResponse>((resolve, reject) => {
      const u = new URL(`${baseUrl}/health`);
      const req = request(
        { hostname: u.hostname, port: u.port, path: u.pathname, method: "POST" },
        (res) => {
          let d = "";
          res.on("data", (c: Buffer) => (d += c.toString()));
          res.on("end", () => {
            try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(d), headers: res.headers }); }
            catch { resolve({ status: res.statusCode ?? 0, body: d, headers: res.headers }); }
          });
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(postRes.status, 405);

    // security headers
    const hdrs = healthRes.headers;
    assert.equal(hdrs["cache-control"], "no-store");
    assert.equal(hdrs["x-content-type-options"], "nosniff");
    assert.equal(hdrs["x-frame-options"], "DENY");
    assert.ok(String(hdrs["content-security-policy"] ?? "").includes("default-src 'self'"));

    // --- console stop ---
    const stopped = await daemonRequest<Record<string, unknown>>("console_stop", {}, home);
    assert.equal(stopped.running, false);
    const afterStop = await daemonRequest<Record<string, unknown>>("console_status", {}, home);
    assert.equal(afterStop.running, false);

    // --- provider status: read-only, cached, never probes ---
    const provAll = await daemonRequest<Record<string, unknown>>("provider_status", {}, home);
    for (const name of ["deepseek", "qwen", "minimax", "glm"]) {
      assert.ok(name in provAll, `provider_status must include ${name}`);
      const s = provAll[name] as Record<string, unknown>;
      assert.ok(typeof s.status === "string");
      assert.ok(typeof s.model === "string");
    }

    // --- daemon shutdown ---
    await daemon.close();
  } finally {
    // Ensure daemon is stopped even on failure
    try { await daemon.close(); } catch { /* already closed */ }
    // Clean up temporary state
    await rm(home, { recursive: true, force: true }).catch(() => {});
  }
});
