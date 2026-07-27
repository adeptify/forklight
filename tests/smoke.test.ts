import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { daemonRequest } from "../src/daemon/client.js";
import { ForkLightDaemon } from "../src/daemon/server.js";

/**
 * Offline smoke verification — local control path without providers,
 * integration, commits, or push. Isolated temporary ForkLight home.
 */
test("smoke: daemon lifecycle, settings, provider status, safe shutdown", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-smoke-"));
  const daemon = new ForkLightDaemon(home, 1);
  try {
    await daemon.start();
    const health = await daemonRequest<Record<string, unknown>>("health", {}, home);
    assert.equal(typeof health.ok, "boolean");
    assert.equal(typeof health.pid, "number");
    assert.equal(health.maxConcurrency, 1);
    assert.ok(Array.isArray(health.activeTaskIds));
    assert.ok(Array.isArray(health.queuedTaskIds));

    const settings = await daemonRequest<Record<string, unknown>>("settings_get", {}, home);
    assert.equal(settings.version, 1);
    const exec = settings.execution as Record<string, unknown>;
    assert.equal(exec.maxConcurrency, 2);
    assert.equal(exec.defaultProvider, "deepseek");
    assert.equal(exec.defaultMaxBudgetUsd, 0.5);

    const updated = await daemonRequest<Record<string, unknown>>(
      "settings_update",
      { patch: { execution: { maxConcurrency: 4 }, console: { loopbackPort: 0 } } },
      home,
    );
    assert.equal((updated.execution as Record<string, unknown>).maxConcurrency, 4);
    assert.equal((updated.execution as Record<string, unknown>).defaultProvider, "deepseek");

    const reloaded = await daemonRequest<Record<string, unknown>>("settings_get", {}, home);
    assert.equal((reloaded.execution as Record<string, unknown>).maxConcurrency, 4);

    await assert.rejects(
      () =>
        daemonRequest("settings_update", {
          patch: { execution: { maxConcurrency: -1 } },
        }, home),
      /Settings validation failed/,
    );
    const afterReject = await daemonRequest<Record<string, unknown>>("settings_get", {}, home);
    assert.equal((afterReject.execution as Record<string, unknown>).maxConcurrency, 4);

    await assert.rejects(
      () =>
        daemonRequest("settings_update", {
          patch: { apiToken: "abc123" },
        }, home),
      /credential/,
    );

    const reset = await daemonRequest<Record<string, unknown>>("settings_reset", {}, home);
    assert.equal((reset.execution as Record<string, unknown>).maxConcurrency, 2);

    // Standalone Console lifecycle APIs are removed
    await assert.rejects(
      () => daemonRequest("console_start" as never, {}, home),
      /Unknown daemon method|console_start/,
    );

    const provAll = await daemonRequest<Record<string, unknown>>("provider_status", {}, home);
    for (const name of ["deepseek", "qwen", "minimax", "glm", "volcengine"]) {
      assert.ok(name in provAll, `provider_status must include ${name}`);
      const s = provAll[name] as Record<string, unknown>;
      assert.ok(typeof s.status === "string");
      assert.ok(typeof s.model === "string");
    }

    await daemon.close();
  } finally {
    try { await daemon.close(); } catch { /* already closed */ }
  }
});
