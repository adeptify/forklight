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
      if (method === "submit_file") {
        if (typeof params.taskFile !== "string" || !params.taskFile) {
          throw new Error("taskFile is required");
        }
        return { id: "task-sub-1", name: "Test Task", status: "queued" } as T;
      }
      if (method === "resume") return { id: params.taskId, status: "queued" } as T;
      if (method === "revise") return { id: params.taskId, status: "queued" } as T;
      if (method === "correct") return { id: params.taskId, status: "queued" } as T;
      if (method === "main_review") return { ok: true, decision: params.decision } as T;
      if (method === "integration_preflight") return { feasible: true, taskId: params.taskId } as T;
      if (method === "integration_apply") return { operationId: "op-1", status: "started" } as T;
      if (method === "provider_probe") return { providers: { deepseek: { status: "ok" } } } as T;
      if (method === "provider_status") return { providers: { deepseek: { ready: true } } } as T;
      if (method === "competition_compare") {
        return { competitionId: params.competitionId, recommendation: { candidateId: "c1" } } as T;
      }
      if (method === "status") {
        return {
          id: params.taskId,
          spec: { taskClass: "hub-journey", directCodexProfileId: "codex-main" },
        } as T;
      }
      if (method === "direct_codex_inbox") {
        return [{
          sample: {
            sampleId: "sample-1",
            forklightTaskId: "t1",
            exactTaskClass: "hub-journey",
            directCodexProfileId: "codex-main",
            inputTokens: 600,
            outputTokens: 200,
            cacheReadInputTokens: 300,
            cacheCreationInputTokens: 100,
            source: "codex-terminal-result",
            complete: true,
            directRunRef: "codex-run:run-1",
            pairingRef: "pair:pair-1",
            capturedAt: "2026-07-27T00:00:00.000Z",
            schemaVersion: 1,
          },
          reviewState: "pending",
        }] as T;
      }
      if (method === "direct_codex_publication_preview") {
        return {
          exactTaskClass: "hub-journey",
          directCodexProfileId: "codex-main",
          nextVersion: 1,
          acceptedCount: 0,
          rejectedCount: 0,
          pendingCount: 1,
          acceptedSampleIds: [],
          hasNewAcceptedEvidence: false,
          readiness: "no-accepted-samples",
        } as T;
      }
      if (method === "direct_codex_guided_capture") return { sampleId: "sample-2" } as T;
      if (method === "direct_codex_review") return { sampleId: params.sampleId, decision: params.decision } as T;
      if (method === "direct_codex_publication_register") {
        return {
          summary: { acceptedSampleCount: 1, acceptedSampleIds: ["sample-1"], version: 1 },
        } as T;
      }
      if (method === "adaptation_preview") {
        const patch = params.patch;
        const hasMax = patch !== null && typeof patch === "object"
          && !Array.isArray(patch) && "maxAdaptationRounds" in (patch as Record<string, unknown>);
        if (hasMax) throw new Error("adaptation patch must not include maxAdaptationRounds");
        return {
          status: "eligible",
          rootTaskId: params.taskId,
          parentTaskId: params.taskId,
          nextRound: 1,
          maxAdaptationRounds: 1,
          profileId: "default",
          reason: "eligible",
          summary: "Adaptation eligible: round 1/1 from parent task-1 with 1 patched field.",
          fields: [{
            field: "maxDurationMs",
            before: 60000,
            after: 600000,
            changed: true,
            source: "task",
            enforcementPhase: "preemptive",
          }],
        } as T;
      }
      if (method === "adaptation_apply") {
        if (params.confirm !== true) throw new Error("adaptation_apply requires explicit confirm: true");
        const patch = params.patch;
        const hasMax = patch !== null && typeof patch === "object"
          && !Array.isArray(patch) && "maxAdaptationRounds" in (patch as Record<string, unknown>);
        if (hasMax) throw new Error("adaptation patch must not include maxAdaptationRounds");
        return {
          status: "eligible",
          preview: {
            status: "eligible",
            rootTaskId: params.taskId,
            parentTaskId: params.taskId,
            nextRound: 1,
            maxAdaptationRounds: 1,
            profileId: "default",
            reason: "eligible",
            summary: "Adaptation eligible: round 1/1 from parent task-1 with 1 patched field.",
            fields: [{
              field: "maxDurationMs",
              before: 60000,
              after: 600000,
              changed: true,
              source: "task",
              enforcementPhase: "preemptive",
            }],
          },
          childTaskId: "task-1-child",
          lineageId: "lineage-1",
        } as T;
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

test("Hub Task Detail contains safe deliveryPlan with counts only", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-hub-dp-detail-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const keychain = new MemoryKeychain();
  const setup = new SetupService(settings, keychain, inspector());
  const staticDir = path.join(home, "static");
  await mkdir(staticDir, { recursive: true });
  await writeFile(path.join(staticDir, "index.html"), "<!DOCTYPE html><title>Hub</title>\n", "utf8");

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
      if (method === "status") {
        return {
          id: params.taskId,
          name: "Delivery Plan Task",
          status: "succeeded",
          sourcePath: "/home/user/repo",
          sessionId: "sess-1",
          createdAt: "2026-07-27T00:00:00.000Z",
          spec: {
            version: 2,
            provider: { name: "deepseek", model: "deepseek-v4-flash" },
            runtime: { name: "claude-code" },
            worker: { focusPaths: [] },
            contract: { outcome: "test", inScope: [], outOfScope: [], executionSteps: [], deliverables: [] },
            acceptance: { criteria: [], commands: [] },
            delivery: {
              buildCommands: ["npm ci"],
              activationCommands: ["npm start", "pm2 start app"],
              activationCheckCommands: ["curl localhost"],
            },
            deliveryResolution: { source: "project", profileId: "bound" },
          },
        } as T;
      }
      if (method === "task_decision") return {} as T;
      if (method === "task_economics") return {} as T;
      if (method === "inspect") return { events: [], attempts: [] } as T;
      throw new Error(`unexpected ${method}`);
    },
  });
  const port = await server.start();
  try {
    const res = await doHttp(`http://127.0.0.1:${port}/api/ops/tasks/t1`, "GET", server.getToken());
    assert.equal(res.status, 200);
    const body = res.body as { deliveryPlan?: Record<string, unknown> };
    assert.ok(body.deliveryPlan, "Task Detail must include deliveryPlan");
    const plan = body.deliveryPlan!;
    assert.equal(plan.resolutionSource, "project");
    assert.equal(plan.profileId, "bound");
    assert.equal(plan.buildCommandCount, 1);
    assert.equal(plan.activationCommandCount, 2);
    assert.equal(plan.activationCheckCommandCount, 1);
    assert.equal(plan.outcome, "activation");
    const stages = plan.stages as Record<string, string>;
    assert.equal(stages.sourceApply, "required");
    assert.equal(stages.sourceVerify, "required");
    assert.equal(stages.artifactBuild, "required");
    assert.equal(stages.runtimeActivation, "required");

    // Verify no command text leaked
    const serialized = JSON.stringify(plan);
    assert.ok(!serialized.includes("npm ci"));
    assert.ok(!serialized.includes("npm start"));
    assert.ok(!serialized.includes("curl localhost"));
  } finally {
    await server.stop();
    store.close();
  }
});

test("Hub Task Detail deliveryPlan for legacy task without delivery is safe", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-hub-dp-leg-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const keychain = new MemoryKeychain();
  const setup = new SetupService(settings, keychain, inspector());
  const staticDir = path.join(home, "static");
  await mkdir(staticDir, { recursive: true });
  await writeFile(path.join(staticDir, "index.html"), "<!DOCTYPE html><title>Hub</title>\n", "utf8");

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
      if (method === "status") {
        return {
          id: params.taskId,
          name: "Legacy Task",
          status: "succeeded",
          spec: {
            version: 1,
            provider: { name: "deepseek", model: "v4" },
            runtime: { name: "claude-code" },
            goal: "test",
            constraints: [],
            acceptance: { commands: ["true"] },
          },
        } as T;
      }
      if (method === "task_decision") return {} as T;
      if (method === "task_economics") return {} as T;
      if (method === "inspect") return { events: [], attempts: [] } as T;
      throw new Error(`unexpected ${method}`);
    },
  });
  const port = await server.start();
  try {
    const res = await doHttp(`http://127.0.0.1:${port}/api/ops/tasks/t2`, "GET", server.getToken());
    assert.equal(res.status, 200);
    const body = res.body as { deliveryPlan?: Record<string, unknown> };
    assert.ok(body.deliveryPlan, "legacy task must still get a deliveryPlan");
    assert.equal(body.deliveryPlan!.resolutionSource, "none");
    assert.equal(body.deliveryPlan!.outcome, "none");
    assert.equal(body.deliveryPlan!.buildCommandCount, 0);
  } finally {
    await server.stop();
    store.close();
  }
});

test("unauthorized ops mutation is rejected", async () => {
  const ctx = await makeOpsHub();
  try {
    const res = await doHttp(`${ctx.base}/api/ops/tasks/t1/resume`, "POST", undefined, {});
    assert.equal(res.status, 401);
  } finally {
    await ctx.cleanup();
  }
});

test("Hub calibration read explains identity, samples, and publication state without raw evidence", async () => {
  const ctx = await makeOpsHub();
  try {
    const res = await doHttp(`${ctx.base}/api/ops/tasks/t1/calibration`, "GET", ctx.token);
    assert.equal(res.status, 200);
    const body = res.body as {
      state: string;
      identity: Record<string, unknown>;
      samples: Array<Record<string, unknown>>;
      publicationPreview: Record<string, unknown>;
    };
    assert.equal(body.state, "ready");
    assert.deepEqual(body.identity, {
      taskClass: "hub-journey",
      directCodexProfileId: "codex-main",
    });
    assert.deepEqual(body.samples, [{
      sampleId: "sample-1",
      capturedAt: "2026-07-27T00:00:00.000Z",
      grossTokens: 1200,
      reviewState: "pending",
    }]);
    assert.equal(body.publicationPreview.ready, false);
    assert.equal(body.publicationPreview.reason, "no-accepted-samples");
    const json = JSON.stringify(body);
    assert.ok(!json.includes("directRunRef"));
    assert.ok(!json.includes("pairingRef"));
    assert.ok(!json.includes("forklightTaskId"));
  } finally {
    await ctx.cleanup();
  }
});

test("Hub calibration capture accepts only one exact five-count terminal event", async () => {
  const ctx = await makeOpsHub();
  const usage = {
    type: "turn.completed",
    usage: {
      input_tokens: 1000,
      cached_input_tokens: 200,
      cache_write_input_tokens: 100,
      output_tokens: 500,
      reasoning_output_tokens: 100,
    },
  };
  try {
    const ok = await doHttp(`${ctx.base}/api/ops/tasks/t1/calibration/capture`, "POST", ctx.token, {
      runRef: "codex-run:run-2",
      usage,
    });
    assert.equal(ok.status, 200);
    const call = ctx.calls.find((entry) => entry.method === "direct_codex_guided_capture");
    assert.deepEqual(call?.params, {
      forklightTaskId: "t1",
      codexRunRef: "codex-run:run-2",
      usage,
    });

    const callCount = ctx.calls.length;
    const invalid = await doHttp(`${ctx.base}/api/ops/tasks/t1/calibration/capture`, "POST", ctx.token, {
      runRef: "codex-run:run-3",
      usage: {
        ...usage,
        usage: { ...usage.usage, cached_input_tokens: 901, cache_write_input_tokens: 100 },
      },
    });
    assert.equal(invalid.status, 422);
    assert.equal(ctx.calls.length, callCount);

    const extra = await doHttp(`${ctx.base}/api/ops/tasks/t1/calibration/capture`, "POST", ctx.token, {
      runRef: "codex-run:run-4",
      usage,
      prompt: "must-not-cross-the-boundary",
    });
    assert.equal(extra.status, 422);
    assert.ok(!JSON.stringify(extra.body).includes("must-not-cross-the-boundary"));
  } finally {
    await ctx.cleanup();
  }
});

test("Hub calibration review binds the sample to the Task and supplies immutable review fields", async () => {
  const ctx = await makeOpsHub();
  try {
    const res = await doHttp(`${ctx.base}/api/ops/tasks/t1/calibration/review`, "POST", ctx.token, {
      sampleId: "sample-1",
      decision: "accepted",
      confirm: true,
    });
    assert.equal(res.status, 200);
    const methods = ctx.calls.map((entry) => entry.method);
    assert.deepEqual(methods.slice(-3), ["status", "direct_codex_inbox", "direct_codex_review"]);
    const review = ctx.calls.at(-1)!;
    assert.equal(review.params.sampleId, "sample-1");
    assert.equal(review.params.reviewer, "main-codex");
    assert.equal(review.params.schemaVersion, 1);
    assert.equal(review.params.confirm, true);
    assert.match(String(review.params.reviewedAt), /^2026-|^20\d\d-/);

    const before = ctx.calls.length;
    const wrongSample = await doHttp(`${ctx.base}/api/ops/tasks/t1/calibration/review`, "POST", ctx.token, {
      sampleId: "sample-other",
      decision: "accepted",
      confirm: true,
    });
    assert.equal(wrongSample.status, 422);
    assert.equal(ctx.calls.slice(before).some((entry) => entry.method === "direct_codex_review"), false);
  } finally {
    await ctx.cleanup();
  }
});

test("Hub calibration publish derives identity and fixes conservative evidence policy", async () => {
  const ctx = await makeOpsHub();
  try {
    const res = await doHttp(`${ctx.base}/api/ops/tasks/t1/calibration/publish`, "POST", ctx.token, {
      confirm: true,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      ok: true,
      action: "direct_codex_publication_register",
      taskId: "t1",
      version: 1,
      acceptedSampleCount: 1,
      acceptedSampleIds: ["sample-1"],
    });
    const publish = ctx.calls.find((entry) => entry.method === "direct_codex_publication_register")!;
    assert.equal(publish.params.taskClass, "hub-journey");
    assert.equal(publish.params.directCodexProfileId, "codex-main");
    assert.equal(publish.params.method, "hub-guided-exact-pair");
    assert.equal(publish.params.confidence, "low");
    assert.equal(publish.params.confirm, true);

    const before = ctx.calls.length;
    const noConfirm = await doHttp(`${ctx.base}/api/ops/tasks/t1/calibration/publish`, "POST", ctx.token, {});
    assert.equal(noConfirm.status, 422);
    assert.equal(ctx.calls.length, before);
  } finally {
    await ctx.cleanup();
  }
});

test("model_routing bridge validates taskClass and candidates before daemon call", async () => {
  const ctx = await makeOpsHub();
  try {
    const before = ctx.calls.length;
    // Missing taskClass
    const noClass = await doHttp(`${ctx.base}/api/ops/model-routing`, "POST", ctx.token, {
      candidates: [{ provider: "deepseek", model: "v4" }, { provider: "xai", model: "grok" }],
    });
    assert.equal(noClass.status, 422);
    // Empty taskClass string
    const emptyClass = await doHttp(`${ctx.base}/api/ops/model-routing`, "POST", ctx.token, {
      taskClass: "",
      candidates: [{ provider: "deepseek", model: "v4" }],
    });
    assert.equal(emptyClass.status, 422);
    // TaskClass too long
    const longClass = await doHttp(`${ctx.base}/api/ops/model-routing`, "POST", ctx.token, {
      taskClass: "a".repeat(201),
      candidates: [{ provider: "deepseek", model: "v4" }, { provider: "xai", model: "grok" }],
    });
    assert.equal(longClass.status, 422);
    // Too few candidates
    const fewCand = await doHttp(`${ctx.base}/api/ops/model-routing`, "POST", ctx.token, {
      taskClass: "test-class",
      candidates: [{ provider: "deepseek", model: "v4" }],
    });
    assert.equal(fewCand.status, 422);
    // Too many candidates
    const manyCand = await doHttp(`${ctx.base}/api/ops/model-routing`, "POST", ctx.token, {
      taskClass: "test-class",
      candidates: Array.from({ length: 11 }, (_, i) => ({ provider: "p", model: `m${i}` })),
    });
    assert.equal(manyCand.status, 422);
    // Duplicate candidates
    const dupCand = await doHttp(`${ctx.base}/api/ops/model-routing`, "POST", ctx.token, {
      taskClass: "test-class",
      candidates: [
        { provider: "deepseek", model: "v4" },
        { provider: "deepseek", model: "v4" },
      ],
    });
    assert.equal(dupCand.status, 422);
    // No daemon call should have been made
    assert.equal(ctx.calls.length, before, "no daemon call on validation failure");
  } finally {
    await ctx.cleanup();
  }
});

test("model_routing bridge is strictly read-only — never mutates task or settings", async () => {
  const ctx = await makeOpsHub();
  try {
    const res = await doHttp(`${ctx.base}/api/ops/model-routing`, "POST", ctx.token, {
      taskClass: "write-tests",
      candidates: [{ provider: "deepseek", model: "v4" }, { provider: "xai", model: "grok" }],
    });
    // The test daemonRequest does not handle model_routing, so it should error
    // but the key assertion is that only model_routing was attempted.
    assert.equal(res.status, 503, "expected daemon error for unhandled method");
    const mrCalls = ctx.calls.filter((c) => c.method === "model_routing");
    assert.equal(mrCalls.length, 1, "only model_routing was called");
    assert.equal(mrCalls[0]!.params.taskClass, "write-tests");
    assert.equal((mrCalls[0]!.params.candidates as Array<unknown>).length, 2);
    // Never called any mutating method
    const mutating = ["submit_file", "submit", "status", "resume", "main_review", "revise",
      "settings_update", "integration_apply", "provider_probe"];
    for (const m of mutating) {
      assert.ok(!ctx.calls.some((c) => c.method === m), `method ${m} must not be called by bridge`);
    }
  } finally {
    await ctx.cleanup();
  }
});

test("model_routing bridge returns the canonical advisory when daemon succeeds", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-hub-mr-bridge-"));
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
      if (method === "model_routing") {
        return {
          taskClass: params.taskClass,
          candidates: [
            {
              provider: "deepseek", model: "v4", eligible: true,
              evidence: { provider: "deepseek", model: "v4", relevantSampleCount: 10, acceptedDeliveryRate: 0.8 },
              factors: [{ factor: "acceptedDelivery", weight: 1, available: true, normalizedScore: 0.8, weightedScore: 0.8 }],
              totalScore: 0.8,
              uncertainty: { insufficientSamples: false, insufficientGap: false, incompatibleCost: false, incompatibleCurrency: false, reasons: [] },
            },
            {
              provider: "xai", model: "grok", eligible: true,
              evidence: { provider: "xai", model: "grok", relevantSampleCount: 10, acceptedDeliveryRate: 0.6 },
              factors: [{ factor: "acceptedDelivery", weight: 1, available: true, normalizedScore: 0.6, weightedScore: 0.6 }],
              totalScore: 0.6,
              uncertainty: { insufficientSamples: false, insufficientGap: false, incompatibleCost: false, incompatibleCurrency: false, reasons: [] },
            },
          ],
          recommendation: { provider: "deepseek", model: "v4", confidence: 0.2, reasoning: "clear-score-gap:0.2000" },
          shouldRunCompetition: false,
          resolvedPolicy: { minRelevantSamples: 5, uncertaintyThreshold: 0.15, competitionOnUncertainty: true, weights: { acceptedDelivery: 1 } },
        } as T;
      }
      throw new Error(`unexpected method ${method}`);
    },
  });
  const port = await server.start();
  try {
    const res = await doHttp(`http://127.0.0.1:${port}/api/ops/model-routing`, "POST", server.getToken(), {
      taskClass: "write-tests",
      candidates: [{ provider: "deepseek", model: "v4" }, { provider: "xai", model: "grok" }],
    });
    assert.equal(res.status, 200);
    const body = res.body as { ok: boolean; advisory: Record<string, unknown> };
    assert.equal(body.ok, true);
    const advisory = body.advisory;
    assert.equal(advisory.taskClass, "write-tests");
    assert.ok(advisory.recommendation, "recommendation present");
    const rec = advisory.recommendation as Record<string, unknown>;
    assert.equal(rec.provider, "deepseek");
    assert.equal(rec.model, "v4");
    assert.equal(advisory.shouldRunCompetition, false);
    assert.equal(calls.filter((c) => c.method === "model_routing").length, 1);
  } finally {
    await server.stop();
    store.close();
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

test("task submit requires confirm gate", async () => {
  const ctx = await makeOpsHub();
  try {
    const noConfirm = await doHttp(
      `${ctx.base}/api/ops/tasks/submit`,
      "POST",
      ctx.token,
      { filePath: "/tmp/task.yaml" },
    );
    assert.equal(noConfirm.status, 422);
  } finally {
    await ctx.cleanup();
  }
});

test("task submit rejects missing, empty, or non-absolute filePath without daemon call", async () => {
  const ctx = await makeOpsHub();
  try {
    const empty = await doHttp(
      `${ctx.base}/api/ops/tasks/submit`,
      "POST",
      ctx.token,
      { confirm: true },
    );
    assert.equal(empty.status, 422);

    const blank = await doHttp(
      `${ctx.base}/api/ops/tasks/submit`,
      "POST",
      ctx.token,
      { filePath: "  ", confirm: true },
    );
    assert.equal(blank.status, 422);

    const beforeSys = ctx.calls.length;
    const relative = await doHttp(
      `${ctx.base}/api/ops/tasks/submit`,
      "POST",
      ctx.token,
      { filePath: "relative/path/task.yaml", confirm: true },
    );
    assert.equal(relative.status, 422);
    // Relative path must be rejected before any daemon call.
    assert.equal(ctx.calls.length, beforeSys);

    const dotRelative = await doHttp(
      `${ctx.base}/api/ops/tasks/submit`,
      "POST",
      ctx.token,
      { filePath: "./task.yaml", confirm: true },
    );
    assert.equal(dotRelative.status, 422);
    assert.equal(ctx.calls.length, beforeSys);
  } finally {
    await ctx.cleanup();
  }
});

test("task submit calls daemon with submit_file and returns task id", async () => {
  const ctx = await makeOpsHub();
  try {
    const res = await doHttp(
      `${ctx.base}/api/ops/tasks/submit`,
      "POST",
      ctx.token,
      { filePath: "/tmp/task.yaml", confirm: true },
    );
    assert.equal(res.status, 200);
    const body = res.body as Record<string, unknown>;
    assert.equal(body.ok, true);
    assert.equal(body.action, "submit_file");
    assert.equal(body.taskId, "task-sub-1");
    const task = body.task as Record<string, unknown>;
    assert.equal(task.id, "task-sub-1");
    assert.equal(task.name, "Test Task");
    const call = ctx.calls.find((c) => c.method === "submit_file");
    assert.ok(call);
    assert.equal(call!.params.taskFile, "/tmp/task.yaml");
  } finally {
    await ctx.cleanup();
  }
});

test("task submit daemon error returns fixed bounded message, never echoes daemon text", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-hub-sub-err-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const setup = new SetupService(settings, new MemoryKeychain(), inspector());
  const staticDir = path.join(home, "static");
  await mkdir(staticDir, { recursive: true });
  await writeFile(path.join(staticDir, "index.html"), "<!DOCTYPE html><title>Hub</title>\n", "utf8");

  const server = new HubServer({
    settings,
    setup,
    keychain: new MemoryKeychain(),
    staticRoot: staticDir,
    account: () => "hub-ops-user",
    port: 0,
    ensureDaemon: async () => ({ ok: true, pid: 99 }),
    probeDaemon: async () => ({ running: true, health: { ok: true, pid: 99 } }),
    daemonRequest: async <T>(method: string, _params: Record<string, unknown> = {}) => {
      if (method === "submit_file") {
        throw new Error("Invalid task contract: missing required field 'name' — /tmp/bad.yaml — secretValue");
      }
      return {} as T;
    },
  });
  const port = await server.start();
  try {
    const res = await doHttp(
      `http://127.0.0.1:${port}/api/ops/tasks/submit`,
      "POST",
      server.getToken(),
      { filePath: "/tmp/bad.yaml", confirm: true },
    );
    assert.equal(res.status, 422);
    const body = res.body as Record<string, unknown>;
    assert.equal(body.error, "Task contract submission rejected by daemon");
  } finally {
    await server.stop();
    store.close();
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

test("adaptation_preview routes to daemon and never mutates", async () => {
  const ctx = await makeOpsHub();
  try {
    const before = ctx.calls.length;
    const res = await doHttp(
      `${ctx.base}/api/ops/tasks/task-1/adaptation/preview`,
      "POST",
      ctx.token,
      { patch: { maxDurationMs: 600000 }, reason: "duration-budget" },
    );
    assert.equal(res.status, 200);
    const body = res.body as Record<string, unknown>;
    assert.equal(body.action, "adaptation_preview");
    assert.equal(body.taskId, "task-1");
    assert.ok(body.preview);
    const call = ctx.calls.find((c) => c.method === "adaptation_preview");
    assert.ok(call);
    assert.equal(call!.params.taskId, "task-1");
    assert.deepEqual(call!.params.patch, { maxDurationMs: 600000 });
    assert.equal(call!.params.reason, "duration-budget");
    // Preview must not call adaptation_apply - it is read-only.
    assert.ok(!ctx.calls.some((c) => c.method === "adaptation_apply"));
    assert.equal(ctx.calls.length, before + 1);
  } finally {
    await ctx.cleanup();
  }
});

test("adaptation_preview rejects non-object patch without calling daemon", async () => {
  const ctx = await makeOpsHub();
  try {
    const before = ctx.calls.length;
    const arr = await doHttp(
      `${ctx.base}/api/ops/tasks/task-1/adaptation/preview`,
      "POST",
      ctx.token,
      { patch: ["maxDurationMs", 600000], reason: "duration-budget" },
    );
    assert.equal(arr.status, 422);
    const nullPatch = await doHttp(
      `${ctx.base}/api/ops/tasks/task-1/adaptation/preview`,
      "POST",
      ctx.token,
      { patch: null, reason: "duration-budget" },
    );
    assert.equal(nullPatch.status, 422);
    const badReason = await doHttp(
      `${ctx.base}/api/ops/tasks/task-1/adaptation/preview`,
      "POST",
      ctx.token,
      { patch: { maxDurationMs: 600000 }, reason: { why: "duration-budget" } },
    );
    assert.equal(badReason.status, 422);
    const unknownReason = await doHttp(
      `${ctx.base}/api/ops/tasks/task-1/adaptation/preview`,
      "POST",
      ctx.token,
      { patch: { maxDurationMs: 600000 }, reason: "invented-reason" },
    );
    assert.equal(unknownReason.status, 422);
    const missingPatch = await doHttp(
      `${ctx.base}/api/ops/tasks/task-1/adaptation/preview`,
      "POST",
      ctx.token,
      { reason: "duration-budget" },
    );
    assert.equal(missingPatch.status, 422);
    assert.equal(ctx.calls.length, before);
  } finally {
    await ctx.cleanup();
  }
});

test("adaptation_apply requires confirm gate and returns child task id", async () => {
  const ctx = await makeOpsHub();
  try {
    const noConfirm = await doHttp(
      `${ctx.base}/api/ops/tasks/task-1/adaptation/apply`,
      "POST",
      ctx.token,
      { patch: { maxDurationMs: 600000 }, reason: "duration-budget" },
    );
    assert.equal(noConfirm.status, 422);

    const apply = await doHttp(
      `${ctx.base}/api/ops/tasks/task-1/adaptation/apply`,
      "POST",
      ctx.token,
      { patch: { maxDurationMs: 600000 }, reason: "duration-budget", confirm: true },
    );
    assert.equal(apply.status, 200);
    const body = apply.body as Record<string, unknown>;
    assert.equal(body.action, "adaptation_apply");
    assert.equal(body.status, "eligible");
    assert.equal(body.childTaskId, "task-1-child");
    const call = ctx.calls.find((c) => c.method === "adaptation_apply");
    assert.ok(call);
    assert.equal(call!.params.confirm, true);
    assert.deepEqual(call!.params.patch, { maxDurationMs: 600000 });
  } finally {
    await ctx.cleanup();
  }
});

test("adaptation_apply rejects non-object patch without calling daemon", async () => {
  const ctx = await makeOpsHub();
  try {
    const before = ctx.calls.length;
    const arr = await doHttp(
      `${ctx.base}/api/ops/tasks/task-1/adaptation/apply`,
      "POST",
      ctx.token,
      { patch: ["maxDurationMs", 600000], reason: "duration-budget", confirm: true },
    );
    assert.equal(arr.status, 422);
    const nullPatch = await doHttp(
      `${ctx.base}/api/ops/tasks/task-1/adaptation/apply`,
      "POST",
      ctx.token,
      { patch: null, reason: "duration-budget", confirm: true },
    );
    assert.equal(nullPatch.status, 422);
    const badReason = await doHttp(
      `${ctx.base}/api/ops/tasks/task-1/adaptation/apply`,
      "POST",
      ctx.token,
      { patch: { maxDurationMs: 600000 }, reason: 7, confirm: true },
    );
    assert.equal(badReason.status, 422);
    const unknownReason = await doHttp(
      `${ctx.base}/api/ops/tasks/task-1/adaptation/apply`,
      "POST",
      ctx.token,
      { patch: { maxDurationMs: 600000 }, reason: "invented-reason", confirm: true },
    );
    assert.equal(unknownReason.status, 422);
    assert.equal(ctx.calls.length, before);
  } finally {
    await ctx.cleanup();
  }
});

// --- Main correction Hub route tests ---

test("correct calls daemon with feedback, budget, and confirm", async () => {
  const ctx = await makeOpsHub();
  try {
    const res = await doHttp(
      `${ctx.base}/api/ops/tasks/task-1/correct`,
      "POST",
      ctx.token,
      { feedback: "Fix the import path", maxBudgetUsd: 2.5, confirm: true },
    );
    assert.equal(res.status, 200);
    const body = res.body as Record<string, unknown>;
    assert.equal(body.ok, true);
    assert.equal(body.action, "correct");
    const call = ctx.calls.find((candidate) => candidate.method === "correct");
    assert.ok(call);
    assert.deepEqual(call!.params, {
      taskId: "task-1",
      feedback: "Fix the import path",
      maxBudgetUsd: 2.5,
      confirm: true,
    });
  } finally {
    await ctx.cleanup();
  }
});

test("correct rejects missing confirm", async () => {
  const ctx = await makeOpsHub();
  try {
    const res = await doHttp(
      `${ctx.base}/api/ops/tasks/task-1/correct`,
      "POST",
      ctx.token,
      { feedback: "Fix it" },
    );
    assert.equal(res.status, 422);
    const body = res.body as Record<string, unknown>;
    assert.ok(typeof body.error === "string" && body.error.includes("confirm"));
  } finally {
    await ctx.cleanup();
  }
});

test("correct rejects empty feedback", async () => {
  const ctx = await makeOpsHub();
  try {
    const res = await doHttp(
      `${ctx.base}/api/ops/tasks/task-1/correct`,
      "POST",
      ctx.token,
      { feedback: "   ", confirm: true },
    );
    assert.equal(res.status, 422);
    const body = res.body as Record<string, unknown>;
    assert.ok(typeof body.error === "string" && body.error.includes("feedback"));
  } finally {
    await ctx.cleanup();
  }
});
