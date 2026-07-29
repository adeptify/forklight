import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { get, request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SettingsService } from "../src/core/settings.js";
import {
  providerNames,
  type ProviderName,
  type ProviderReadiness,
} from "../src/core/providers.js";
import { buildHubSettingsPatch, viewHubSettings } from "../src/hub/settings-api.js";
import { HubServer } from "../src/hub/server.js";
import { SetupService } from "../src/setup/service.js";
import type { SetupKeychainStore, SetupSystemInspector } from "../src/setup/types.js";
import { StateStore } from "../src/state/store.js";
import { currentBuildIdentity } from "../src/core/build-identity.js";

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
    inspectProviderReadiness: () => {
      const effective = settings.get();
      const providers = Object.fromEntries(providerNames().map((name) => {
        const defaults = effective.providerDefaults[name];
        const ready = name === "deepseek" || name === "xai";
        return [name, {
          ready,
          authMode: name === "xai" ? "local-sign-in" : ready ? "api-key" : "none",
          endpoint: defaults.defaultEndpoint,
          defaultModel: defaults.defaultModel,
          keychainService: defaults.defaultKeychainService,
          ...(ready ? {} : { error: "Local authentication not found" }),
        } satisfies ProviderReadiness];
      })) as Record<ProviderName, ProviderReadiness>;
      return { anyReady: true, providers };
    },
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
    setHealth: (next: Record<string, unknown>) => { health = next; },
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

test("viewModelRoutingSettings projects modelRouting policy fields only", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-hub-mr-view-"));
  const store = new StateStore(home);
  try {
    const settings = new SettingsService(store);
    const { viewModelRoutingSettings } = await import("../src/hub/settings-api.js");
    const view = viewModelRoutingSettings(settings.get());
    assert.equal(typeof view.minRelevantSamples, "number");
    assert.equal(typeof view.uncertaintyThreshold, "number");
    assert.equal(typeof view.competitionOnUncertainty, "boolean");
    assert.equal(view.missingEvidenceMode, "flexible");
    assert.equal(typeof view.weights.acceptedDelivery, "number");
    assert.equal(typeof view.weights.verifiedBehavior, "number");
    assert.equal(typeof view.weights.officialCost, "number");
    assert.equal(typeof view.weights.duration, "number");
    assert.equal(typeof view.weights.budgetReliability, "number");
    assert.equal(view.weights.officialCost, 0);
    assert.equal(view.weights.duration, 0);
    assert.equal(view.weights.budgetReliability, 0);
  } finally {
    store.close();
  }
});

test("Hub status returns one privacy-safe readiness result per saved Worker", async () => {
  const ctx = await makeHub();
  try {
    const status = await doHttp(
      `http://127.0.0.1:${ctx.port}/api/status`,
      "GET",
      ctx.token,
    );
    assert.equal(status.status, 200);
    const body = status.body as {
      workerProfiles: { profiles: Array<{ id: string }> };
      workerReadiness: Array<Record<string, unknown>>;
      providers: Array<{ name: string; configured: boolean; authMode: string }>;
    };
    assert.equal(body.workerReadiness.length, body.workerProfiles.profiles.length);
    const defaultReadiness = body.workerReadiness.find((row) => row.workerId === "default");
    assert.ok(defaultReadiness);
    assert.equal(defaultReadiness.canLaunch, true);
    assert.equal(defaultReadiness.state, "launchable");
    assert.equal(defaultReadiness.reason, "connection-unverified");
    const xai = body.providers.find((provider) => provider.name === "xai");
    assert.equal(xai?.configured, true);
    assert.equal(xai?.authMode, "local-sign-in");

    const serialized = JSON.stringify(body.workerReadiness);
    for (const forbidden of [
      "keychainService", "endpoint", "auth.json", "/Users/", "token", "secret", "issues",
    ]) {
      assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
    }
  } finally {
    await ctx.cleanup();
  }
});

test("Hub status prefers exact-build Daemon launch truth over contradictory local inspection", async () => {
  const ctx = await makeHub();
  try {
    const effective = ctx.settings.get();
    const daemonProviders = Object.fromEntries(providerNames().map((name) => {
      const ready = name === "deepseek" || name === "minimax" || name === "volcengine" || name === "xai";
      return [name, {
        ready,
        authMode: name === "xai" && ready ? "local-sign-in" : ready ? "api-key" : "none",
        endpoint: effective.providerDefaults[name].defaultEndpoint,
        defaultModel: effective.providerDefaults[name].defaultModel,
        keychainService: effective.providerDefaults[name].defaultKeychainService,
        ...(ready ? {} : { error: "Local authentication not found" }),
      }];
    }));
    ctx.setHealth({
      ok: true,
      pid: 4242,
      buildIdentity: currentBuildIdentity(),
      providers: daemonProviders,
    });

    const status = await doHttp(
      `http://127.0.0.1:${ctx.port}/api/status`,
      "GET",
      ctx.token,
    );
    assert.equal(status.status, 200);
    const body = status.body as {
      providerReadinessSource: string;
      providers: Array<{ name: string; configured: boolean; authMode: string }>;
      workerReadiness: Array<{ workerId: string; canLaunch: boolean }>;
    };
    assert.equal(body.providerReadinessSource, "daemon");
    assert.equal(body.providers.find((provider) => provider.name === "minimax")?.configured, true);
    assert.equal(body.workerReadiness.find((worker) => worker.workerId === "volcengine-glm52-1m")?.canLaunch, true);
  } finally {
    await ctx.cleanup();
  }
});

test("buildModelRoutingPatch preserves shape for canonical SettingsService validation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-hub-mr-patch-"));
  const store = new StateStore(home);
  try {
    const { buildModelRoutingPatch } = await import("../src/hub/settings-api.js");
    const ok = buildModelRoutingPatch({
      minRelevantSamples: 10,
      uncertaintyThreshold: 0.2,
      competitionOnUncertainty: false,
      weights: { acceptedDelivery: 2, officialCost: 0.5 },
    });
    assert.equal(ok.minRelevantSamples, 10);
    assert.equal(ok.uncertaintyThreshold, 0.2);
    assert.equal(ok.competitionOnUncertainty, false);
    const wts = ok.weights as Record<string, unknown>;
    assert.equal(wts.acceptedDelivery, 2);
    assert.equal(wts.officialCost, 0.5);
    assert.throws(() => buildModelRoutingPatch(null), /must be an object/);
    assert.throws(() => buildModelRoutingPatch([]), /must be an object/);
  } finally {
    store.close();
  }
});

test("Hub modelRouting settings save and reload via API", async () => {
  const ctx = await makeHub();
  try {
    const base = `http://127.0.0.1:${ctx.port}`;
    const status = await doHttp(`${base}/api/status`, "GET", ctx.token);
    assert.equal(status.status, 200);
    const hubBody = status.body as { modelRouting: Record<string, unknown> };
    assert.ok(hubBody.modelRouting, "modelRouting appears in /api/status");
    assert.equal(hubBody.modelRouting.minRelevantSamples, 5);
    const save = await doHttp(`${base}/api/settings`, "POST", ctx.token, {
      modelRouting: {
        minRelevantSamples: 8,
        uncertaintyThreshold: 0.12,
        competitionOnUncertainty: false,
        missingEvidenceMode: "strict",
        weights: { acceptedDelivery: 2, officialCost: 0.3, budgetReliability: 0.6 },
      },
    });
    assert.equal(save.status, 200);
    const savedBody = save.body as { settings: { modelRouting: Record<string, unknown> } };
    const savedMR = savedBody.settings.modelRouting;
    assert.equal(savedMR.minRelevantSamples, 8);
    assert.equal(savedMR.uncertaintyThreshold, 0.12);
    assert.equal(savedMR.competitionOnUncertainty, false);
    assert.equal(savedMR.missingEvidenceMode, "strict");
    const savedWeights = savedMR.weights as Record<string, unknown>;
    assert.equal(savedWeights.acceptedDelivery, 2);
    assert.equal(savedWeights.officialCost, 0.3);
    assert.equal(savedWeights.budgetReliability, 0.6);
    const reloaded = ctx.settings.get();
    assert.equal(reloaded.modelRouting.minRelevantSamples, 8);
    assert.equal(reloaded.modelRouting.missingEvidenceMode, "strict");
    assert.equal(reloaded.modelRouting.weights.acceptedDelivery, 2);
    assert.equal(reloaded.modelRouting.weights.budgetReliability, 0.6);
    const reject = await doHttp(`${base}/api/settings`, "POST", ctx.token, {
      modelRouting: { minRelevantSamples: 0 },
    });
    assert.equal(reject.status, 422);
  } finally {
    await ctx.cleanup();
  }
});

test("buildSafeTaskJourney projects v2 Contract into bounded assignment section", async () => {
  const { buildSafeTaskJourney } = await import("../src/hub/server.js");
  const task = {
    id: "j1",
    name: "Test Contract Task",
    status: "succeeded",
    sourcePath: "/abs/path/task.yaml",
    sessionId: "sess-abc",
    createdAt: "2026-07-27T00:00:00.000Z",
    spec: {
      version: 2,
      provider: { name: "deepseek", model: "deepseek-v4-flash" },
      runtime: { name: "claude-code" },
      worker: { focusPaths: ["src/hub/server.ts", "src/hub/public/app.js"] },
      contract: {
        outcome: "Deliver a working feature",
        presentation: {
          summary: "A user can understand the requested feature before reading technical evidence.",
          language: "en",
        },
        inScope: ["Add feature X", "Update tests"],
        outOfScope: ["Rewrite database"],
        executionSteps: ["Step 1", "Step 2", "Step 3"],
        deliverables: ["Updated server", "Working tests"],
      },
      acceptance: {
        criteria: ["Tests pass", "Typecheck passes"],
        commands: ["npm test", "npm run typecheck"],
      },
    },
  };
  const decision = {
    stage: "ready-for-integration",
    nextAction: "User may authorize Integration",
    workerClaim: {
      label: "unverified-claim",
      text: "I modified the server and fixed all tests. The feature is ready.",
      provider: "deepseek",
      model: "deepseek-v4-flash",
    },
    verification: {
      passed: true,
      behaviorPassed: true,
      policyPassed: true,
      sourceCompatible: true,
      sourceCompatibility: {
        affectedPaths: ["src/hub/server.ts", "tests/hub-settings.test.ts"],
        conflictingPaths: [],
        unrelatedDriftPaths: [],
        compatible: true,
      },
      commands: [
        { command: "npm test", exitCode: 0, stdout: "ok", stderr: "", durationMs: 500, timedOut: false },
        { command: "npm run typecheck", exitCode: 0, stdout: "", stderr: "", durationMs: 1200, timedOut: false },
      ],
    },
    mainReview: { decision: "accept", reason: "Looks good" },
    lineage: { attemptCount: 1, combinedDeliveryDiff: { filesChanged: 2, changedLines: 40 }, correctionAttemptIds: [] },
  };

  const journey = buildSafeTaskJourney(task, decision);

  // Assignment
  assert.equal(journey.assignment.contractVersion, 2);
  assert.deepEqual(journey.assignment.presentation, {
    summary: "A user can understand the requested feature before reading technical evidence.",
    language: "en",
  });
  assert.equal(journey.assignment.outcome, "Deliver a working feature");
  assert.ok(journey.assignment.inScope!.length > 0);
  assert.ok(journey.assignment.outOfScope!.length > 0);
  assert.ok(journey.assignment.executionSteps!.length > 0);
  assert.ok(journey.assignment.focusPaths!.length === 2);
  assert.ok(journey.assignment.acceptanceCriteria!.length > 0);
  assert.ok(journey.assignment.acceptanceCommands!.length > 0);

  // Worker execution
  assert.equal(journey.workerExecution.provider, "deepseek");
  assert.equal(journey.workerExecution.model, "deepseek-v4-flash");
  assert.equal(journey.workerExecution.runtime, "claude-code");
  assert.equal(journey.workerExecution.workerClaim!.label, "unverified-claim");
  assert.ok(journey.workerExecution.workerClaim!.text.length > 0);
  assert.ok(journey.workerExecution.workerClaim!.text.length <= 1200);
  assert.ok(journey.workerExecution.changedFilePaths.length > 0);

  // Verification
  assert.equal(journey.independentVerification.available, true);
  assert.ok(journey.independentVerification.checks.length > 0);
  assert.ok(journey.independentVerification.conclusion.length > 0);

  // Final delivery
  assert.equal(journey.finalDelivery.mainReview!.decision, "accept");

  // Cause — what and why must be different
  assert.notEqual(journey.cause.what, journey.cause.why);
  assert.equal(journey.cause.what, "succeeded");
  assert.ok(journey.cause.why.length > 0);
});

test("buildSafeTaskJourney projects v1 Task with honest unavailable labels", async () => {
  const { buildSafeTaskJourney } = await import("../src/hub/server.js");
  const task = {
    id: "j2",
    name: "Legacy Task",
    status: "failed",
    spec: {
      version: 1,
      provider: { name: "deepseek", model: "deepseek-v4-flash" },
      runtime: { name: "claude-code" },
      goal: "Update the server to log requests",
      constraints: ["Keep existing API stable"],
      acceptance: { commands: ["npm test"] },
    },
  };
  const decision = {
    failureCategory: "authentication",
    workerClaim: {
      label: "unverified-claim",
      text: "Attempted to start but got auth error.",
      provider: "deepseek",
      model: "deepseek-v4-flash",
    },
  };

  const journey = buildSafeTaskJourney(task, decision);

  assert.equal(journey.assignment.contractVersion, 1);
  assert.equal(journey.assignment.goal, "Update the server to log requests");
  assert.equal(journey.assignment.presentation, undefined);
  assert.ok(journey.assignment.constraints!.length > 0);
  assert.equal(journey.assignment.inScope, undefined);
  assert.equal(journey.assignment.outOfScope, undefined);
  assert.equal(journey.assignment.focusPaths, undefined);

  assert.equal(journey.cause.what, "failed");
  assert.equal(journey.cause.failureCategory, "authentication");
  assert.ok(journey.cause.why.includes("credentials") || journey.cause.why.includes("rejected"));
});

test("buildSafeTaskJourney explains Main correction input and factual incremental outcome", async () => {
  const { buildSafeTaskJourney } = await import("../src/hub/server.js");
  const task = {
    id: "reuse-1",
    status: "failed",
    effectivePolicy: { values: { maxMainCorrections: 2 } },
    spec: {
      version: 1,
      provider: { name: "minimax", model: "MiniMax-M3" },
      runtime: { name: "claude-code" },
      goal: "Repair a partially useful candidate",
      acceptance: { commands: ["npm test"] },
    },
  };
  const inspect = {
    attempts: [
      { id: "a1", ordinal: 1, status: "failed" },
      {
        id: "a2",
        ordinal: 2,
        status: "failed",
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadInputTokens: 300,
          cacheCreationInputTokens: 5,
        },
        runtimeCostEstimateUsd: 0.42,
      },
    ],
    events: [{
      type: "attempt.authorization.granted",
      payload: {
        kind: "correction",
        targetOrdinal: 2,
        priorAttemptId: "a1",
        feedback: "Keep the useful UI and repair the failed state transition",
      },
    }],
  };
  const journey = buildSafeTaskJourney(task, {}, inspect);
  assert.deepEqual(journey.candidateReuse, {
    feedback: "Keep the useful UI and repair the failed state transition",
    targetAttemptOrdinal: 2,
    priorAttemptOrdinal: 1,
    status: "failed",
    totalAllowance: 2,
    remainingAllowance: 1,
    grossTokens: 425,
    runtimeEstimateUsd: 0.42,
  });
});

test("buildSafeTaskJourney uses real Attempt records and diff paths", async () => {
  const { buildSafeTaskJourney } = await import("../src/hub/server.js");
  const task = {
    status: "failed",
    spec: {
      version: 1,
      provider: { name: "minimax", model: "MiniMax-M3" },
      runtime: { name: "claude-code" },
      goal: "Improve the Hub",
      constraints: [],
      acceptance: { commands: ["npm test"] },
    },
  };
  const inspect = {
    attempts: [
      { ordinal: 1, status: "failed", startedAt: "2026-07-27T00:00:00.000Z", finishedAt: "2026-07-27T00:01:00.000Z", exitCode: 0, turns: 18, resultText: "raw output must not be copied" },
      { ordinal: 2, status: "succeeded", startedAt: "2026-07-27T00:02:00.000Z", finishedAt: "2026-07-27T00:03:00.000Z", exitCode: 0, turns: 7 },
    ],
    diff: "diff --git a/baseline/src/hub/server.ts b/workspace/src/hub/server.ts\n",
  };
  const journey = buildSafeTaskJourney(task, {}, inspect);

  assert.deepEqual(journey.workerExecution.changedFilePaths, ["src/hub/server.ts"]);
  assert.equal(journey.workerExecution.attempts.length, 2);
  assert.equal(journey.workerExecution.attempts[0]!.ordinal, 2, "latest Attempt is shown first");
  assert.equal(journey.workerExecution.attempts[0]!.status, "succeeded");
  assert.equal(journey.workerExecution.attempts[1]!.turns, 18);
  assert.ok(!JSON.stringify(journey).includes("raw output must not be copied"));
});

test("buildSafeTaskJourney treats Main-repaired verified delivery as done without rewriting machine failure", async () => {
  const { buildSafeTaskJourney } = await import("../src/hub/server.js");
  const task = {
    status: "failed",
    spec: {
      version: 1,
      provider: { name: "minimax", model: "MiniMax-M3" },
      runtime: { name: "claude-code" },
      goal: "Improve the Hub",
      constraints: [],
      acceptance: { commands: ["npm test"] },
    },
  };
  const journey = buildSafeTaskJourney(task, {
    failureCategory: "verification",
    verification: { passed: false, commands: [{ command: "npm test", exitCode: 1 }] },
    remediationDisposition: { status: "verified-repaired-delivered" },
  });

  assert.equal(journey.cause.what, "failed", "machine outcome remains failed");
  assert.equal(journey.finalDelivery.remediationDisposition?.status, "verified-repaired-delivered");
  assert.equal(journey.nextAction.label, "done", "verified final delivery needs no retry");
});

test("buildSafeTaskJourney projections bounded — no raw prompt, diff, log, credential data leaked", async () => {
  const { buildSafeTaskJourney } = await import("../src/hub/server.js");
  const task = {
    id: "j3",
    name: "Sensitive Task",
    status: "failed",
    spec: {
      version: 2,
      provider: { name: "deepseek", model: "deepseek-v4-flash", keychainService: "forklight.deepseek.api-key" },
      runtime: { name: "claude-code" },
      worker: { focusPaths: ["some/file.ts"] },
      contract: {
        outcome: "Fix a bug".repeat(50), // Very long outcome
        inScope: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"], // More than 6
        outOfScope: [],
        executionSteps: [],
        deliverables: [],
      },
      acceptance: {
        criteria: [],
        commands: ["echo secret-credential-12345 && cat .env"],
      },
    },
    sourcePath: "/Users/private/home/project/.env",
    sessionId: "secret-session-token",
  };
  const decision = {
    workerClaim: {
      label: "unverified-claim",
      text: "Done. Here is the full diff:\n" + "-".repeat(5000) + "\nAnd the prompt was: " + "prompt-".repeat(2000),
      provider: "deepseek",
      model: "deepseek-v4-flash",
    },
    verification: {
      passed: false,
      behaviorPassed: false,
      policyPassed: true,
      sourceCompatible: true,
      sourceCompatibility: { affectedPaths: Array.from({ length: 50 }, function(_, i){ return "file" + (i + 1); }) } as Record<string, unknown>,
      commands: [
        { command: "npm test --verbose --json --coverage --reporters=all", exitCode: 1, stdout: "x".repeat(10000), stderr: "e".repeat(10000), durationMs: 5000, timedOut: false },
      ],
    },
  };

  const journey = buildSafeTaskJourney(task, decision);

  // Outcome is bounded
  assert.ok(journey.assignment.outcome!.length <= 600);
  // inScope is capped to 6
  assert.ok(journey.assignment.inScope!.length <= 6);
  // Worker claim is bounded
  const claimText = journey.workerExecution.workerClaim!.text;
  assert.ok(claimText.length <= 1200);
  // No raw diff content leaked
  assert.ok(!claimText.includes("-".repeat(100)));
  // Changed file paths capped to 40
  assert.ok(journey.workerExecution.changedFilePaths.length <= 40);
  // Verification commands capped to 12
  assert.ok(journey.independentVerification.checks.length <= 12);
  // No raw stdout/stderr leaked
  const json = JSON.stringify(journey);
  assert.ok(!json.includes("secret-credential"));
  assert.ok(!json.includes(".env"));
  assert.ok(!json.includes("keychainService"));
  assert.ok(!json.includes("sourcePath"));
  assert.ok(!json.includes("sessionId"));
  // What and why are always separate
  assert.notEqual(journey.cause.what, journey.cause.why);
});

test("buildSafeTaskJourney handles queued, running, and succeeded cause separation", async () => {
  const { buildSafeTaskJourney } = await import("../src/hub/server.js");
  const baseTask = {
    id: "jq",
    name: "State Test",
    spec: { version: 1, provider: { name: "deepseek", model: "v4" }, runtime: { name: "claude-code" }, goal: "test", constraints: [], acceptance: { commands: [] } },
  };

  // Queued
  const q = buildSafeTaskJourney({ ...baseTask, status: "queued" }, {});
  assert.equal(q.cause.what, "queued");
  assert.equal(q.nextAction.label, "wait");

  // Running
  const r = buildSafeTaskJourney({ ...baseTask, status: "running" }, {});
  assert.equal(r.cause.what, "running");
  assert.equal(r.nextAction.label, "wait");

  // Succeeded
  const s = buildSafeTaskJourney({ ...baseTask, status: "succeeded" }, {
    verification: { passed: true, behaviorPassed: true, policyPassed: true, sourceCompatible: true, commands: [] },
  });
  assert.equal(s.cause.what, "succeeded");
  assert.equal(s.nextAction.label, "review");

  // Failed auth
  const fa = buildSafeTaskJourney({ ...baseTask, status: "failed" }, { failureCategory: "authentication" });
  assert.equal(fa.cause.what, "failed");
  assert.equal(fa.cause.failureCategory, "authentication");
  assert.equal(fa.nextAction.label, "credentials");

  // Failed budget
  const fb = buildSafeTaskJourney({ ...baseTask, status: "failed" }, { failureCategory: "budget" });
  assert.equal(fb.cause.what, "failed");
  assert.equal(fb.cause.failureCategory, "budget");
  assert.equal(fb.nextAction.label, "budget");

  // Failed runtime
  const fr = buildSafeTaskJourney({ ...baseTask, status: "failed" }, { failureCategory: "runtime" });
  assert.equal(fr.cause.what, "failed");
  assert.equal(fr.cause.failureCategory, "runtime");
  assert.equal(fr.nextAction.label, "runtime");

  // Failed verification
  const fv = buildSafeTaskJourney({ ...baseTask, status: "failed" }, {
    verification: { passed: false, behaviorPassed: false, policyPassed: true, sourceCompatible: true,
      commands: [{ command: "test", exitCode: 1, stdout: "", stderr: "fail", durationMs: 100, timedOut: false }] },
  });
  assert.equal(fv.cause.what, "failed");
  assert.equal(fv.cause.failureCategory, "verification");

  // All what != why
  [q, r, s, fa, fb, fr, fv].forEach(function(j) {
    assert.notEqual(j.cause.what, j.cause.why, `what and why must differ for state ${j.cause.what}`);
  });
});

test("Hub /api/ops/tasks preserves compact final-delivery disposition only", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-hub-tasks-rep-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const keychain = new MemoryKeychain();
  const setup = new SetupService(settings, keychain, inspector());
  const staticDir = path.join(home, "static");
  await mkdir(staticDir, { recursive: true });
  await writeFile(path.join(staticDir, "index.html"), "<!DOCTYPE html><title>Hub</title>\n", "utf8");
  // Three Task shapes:
  //  - failed Task with verified final delivery (must keep machine status)
  //  - failed Task with no disposition (must not synthesize a delivery claim)
  //  - succeeded Task with no disposition (must not show a repair badge)
  const sample = [
    {
      taskId: "rep-1",
      name: "repaired",
      status: "failed",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      runtime: "claude-code",
      remediationDisposition: {
        status: "verified-repaired-delivered",
        checkId: "check-abc",
        createdAt: "2026-07-26T00:00:00.000Z",
      },
    },
    {
      taskId: "rep-2",
      name: "failed-no-repair",
      status: "failed",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      runtime: "claude-code",
    },
    {
      taskId: "rep-3",
      name: "ok",
      status: "succeeded",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      runtime: "claude-code",
      decisionStage: "ready-for-integration",
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
    const body = res.body as Array<{
      id: string;
      status: string;
      remediationDisposition?: { status: string; checkId: string; createdAt: string };
      decisionStage?: string;
    }>;
    assert.equal(body.length, 3);
    const rep1 = body.find((t) => t.id === "rep-1")!;
    assert.equal(rep1.status, "failed", "machine status preserved");
    assert.ok(rep1.remediationDisposition, "compact disposition threaded");
    assert.equal(rep1.remediationDisposition!.status, "verified-repaired-delivered");
    assert.equal(rep1.remediationDisposition!.checkId, "check-abc");
    assert.equal(rep1.remediationDisposition!.createdAt, "2026-07-26T00:00:00.000Z");
    // Privacy boundary: only status, checkId, createdAt - no extra keys.
    const keys = Object.keys(rep1.remediationDisposition!).sort();
    assert.deepEqual(keys, ["checkId", "createdAt", "status"]);
    // Other shapes must not leak a disposition.
    assert.equal(body.find((t) => t.id === "rep-2")!.remediationDisposition, undefined);
    assert.equal(body.find((t) => t.id === "rep-3")!.remediationDisposition, undefined);
    assert.equal(body.find((t) => t.id === "rep-3")!.decisionStage, "ready-for-integration");
  } finally {
    await server.stop();
    store.close();
  }
});

test("Hub /api/ops/tasks strips disposition keys that fall outside the compact shape", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-hub-tasks-strip-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const keychain = new MemoryKeychain();
  const setup = new SetupService(settings, keychain, inspector());
  const staticDir = path.join(home, "static");
  await mkdir(staticDir, { recursive: true });
  await writeFile(path.join(staticDir, "index.html"), "<!DOCTYPE html><title>Hub</title>\n", "utf8");
  const sample = [
    {
      taskId: "leaky",
      name: "leaky",
      status: "failed",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      runtime: "claude-code",
      remediationDisposition: {
        status: "verified-repaired-delivered",
        checkId: "ok",
        createdAt: "2026-07-26T00:00:00.000Z",
        reason: "private remediation reason that must never reach the Hub",
        command: "rm -rf /tmp/secret-source",
        output: "stdout payload",
        source: "private source path",
      },
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
    const body = res.body as Array<{
      id: string;
      remediationDisposition?: Record<string, unknown>;
    }>;
    const t = body[0]!;
    assert.ok(t.remediationDisposition, "valid compact disposition survives");
    const keys = Object.keys(t.remediationDisposition!).sort();
    assert.deepEqual(keys, ["checkId", "createdAt", "status"],
      "private remediation fields must not be passed through");
  } finally {
    await server.stop();
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
      versionJourney?: { state?: string; nextAction?: string; layers?: unknown };
    };
    assert.equal(hubBody.daemon.running, true);
    assert.ok(hubBody.daemon.buildIdentity?.buildId);
    assert.ok(hubBody.versionJourney, "status explains source, artifact, and daemon version truth");
    assert.equal(typeof hubBody.versionJourney?.state, "string");
    assert.equal(typeof hubBody.versionJourney?.nextAction, "string");
    assert.ok(hubBody.versionJourney?.layers);
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

test("Hub /api/worker-advanced-preview returns preview rows for valid draft", async () => {
  const ctx = await makeHub();
  try {
    const base = `http://127.0.0.1:${ctx.port}`;
    const res = await doHttp(`${base}/api/worker-advanced-preview`, "POST", ctx.token, {
      runtime: "claude-code",
      draftAdvancedPolicy: { maxDurationMs: 60000, maxConcurrency: 1, completionMode: "warn" },
    });
    assert.equal(res.status, 200);
    const body = res.body as { ok: boolean; preview: Array<Record<string, unknown>> };
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.preview));
    assert.ok(body.preview.length > 0, "preview must include rows for all 14 fields");
    const maxConcurrencyRow = body.preview.find((r) => r.field === "maxConcurrency");
    assert.ok(maxConcurrencyRow, "preview must include maxConcurrency");
    assert.equal(maxConcurrencyRow!.value, 1);
    assert.equal(maxConcurrencyRow!.source, "worker");
    assert.equal(maxConcurrencyRow!.enforcementPhase, "preemptive");
    assert.equal(maxConcurrencyRow!.unlimited, false);
    const tokenRow = body.preview.find((r) => r.field === "observedTokenCeiling");
    assert.ok(tokenRow, "preview must include observedTokenCeiling");
    assert.equal(tokenRow!.enforcementPhase, "post-observation",
      "Claude Token enforcement must be post-observation");
    const completionRow = body.preview.find((r) => r.field === "completionMode");
    assert.equal(completionRow!.enforcementPhase, "terminal",
      "completion policy is checked after Worker delivery");
  } finally {
    await ctx.cleanup();
  }
});

test("Hub /api/worker-advanced-preview respects blank-null convention", async () => {
  const ctx = await makeHub();
  try {
    const base = `http://127.0.0.1:${ctx.port}`;
    const res = await doHttp(`${base}/api/worker-advanced-preview`, "POST", ctx.token, {
      runtime: "claude-code",
      draftAdvancedPolicy: { maxDurationMs: null, fileLimit: null, noProgressTimeoutMs: null },
    });
    assert.equal(res.status, 200);
    const body = res.body as { preview: Array<Record<string, unknown>> };
    const durRow = body.preview.find((r) => r.field === "maxDurationMs");
    assert.ok(durRow);
    assert.equal(durRow!.unlimited, true);
    assert.equal(durRow!.source, "worker", "explicit null is a Worker override, not inherited");
    const fileRow = body.preview.find((r) => r.field === "fileLimit");
    assert.ok(fileRow);
    assert.equal(fileRow!.unlimited, true);
    assert.equal(fileRow!.source, "worker");
  } finally {
    await ctx.cleanup();
  }
});

test("Hub /api/worker-advanced-preview rejects unknown fields and invalid values", async () => {
  const ctx = await makeHub();
  try {
    const base = `http://127.0.0.1:${ctx.port}`;
    const bad = await doHttp(`${base}/api/worker-advanced-preview`, "POST", ctx.token, {
      runtime: "claude-code",
      draftAdvancedPolicy: { notAField: 42 },
    });
    assert.equal(bad.status, 422);
    const neg = await doHttp(`${base}/api/worker-advanced-preview`, "POST", ctx.token, {
      runtime: "claude-code",
      draftAdvancedPolicy: { maxConcurrency: -1 },
    });
    assert.equal(neg.status, 422);
    const badMode = await doHttp(`${base}/api/worker-advanced-preview`, "POST", ctx.token, {
      runtime: "claude-code",
      draftAdvancedPolicy: { completionMode: "super-hard" },
    });
    assert.equal(badMode.status, 422);
    const badRuntime = await doHttp(`${base}/api/worker-advanced-preview`, "POST", ctx.token, {
      runtime: "nonexistent",
      draftAdvancedPolicy: {},
    });
    assert.equal(badRuntime.status, 422);
  } finally {
    await ctx.cleanup();
  }
});

test("Hub /api/worker-advanced-preview merges existing and draft policy", async () => {
  const ctx = await makeHub();
  try {
    const base = `http://127.0.0.1:${ctx.port}`;
    const res = await doHttp(`${base}/api/worker-advanced-preview`, "POST", ctx.token, {
      runtime: "claude-code",
      existingAdvancedPolicy: { maxDurationMs: 120000, maxConcurrency: 3 },
      draftAdvancedPolicy: { maxConcurrency: 1, completionMode: "warn" },
    });
    assert.equal(res.status, 200);
    const body = res.body as { preview: Array<Record<string, unknown>> };
    const durRow = body.preview.find((r) => r.field === "maxDurationMs");
    assert.equal(durRow!.value, 120000, "existing value preserved when not overridden");
    const concRow = body.preview.find((r) => r.field === "maxConcurrency");
    assert.equal(concRow!.value, 1, "draft value overrides existing");
    const modeRow = body.preview.find((r) => r.field === "completionMode");
    assert.equal(modeRow!.value, "warn", "new draft field is added");
  } finally {
    await ctx.cleanup();
  }
});

test("Hub worker profile round-trips advancedPolicy through save and reload", async () => {
  const ctx = await makeHub();
  try {
    const base = `http://127.0.0.1:${ctx.port}`;
    const save = await doHttp(`${base}/api/worker-profiles`, "POST", ctx.token, {
      action: "upsert",
      profile: {
        id: "adv-test",
        label: "Advanced Worker",
        runtime: "claude-code",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        advancedPolicy: {
          maxDurationMs: 300000,
          maxConcurrency: 1,
          completionMode: "warn",
          maxAdaptationRounds: 0,
          maxMainCorrections: 2,
          maxMainReverifications: 2,
        },
      },
    });
    assert.equal(save.status, 200);
    const saved = (save.body as { workerProfiles: { profiles: Array<{ id: string; advancedPolicy?: Record<string, unknown> }> } }).workerProfiles;
    const profile = saved.profiles.find((p: { id: string }) => p.id === "adv-test");
    assert.ok(profile, "profile was saved");
    assert.ok(profile!.advancedPolicy, "advancedPolicy was persisted");
    assert.equal(profile!.advancedPolicy!.maxDurationMs, 300000);
    assert.equal(profile!.advancedPolicy!.completionMode, "warn");
    assert.equal(profile!.advancedPolicy!.maxAdaptationRounds, 0);
    assert.equal(profile!.advancedPolicy!.maxMainCorrections, 2);
    assert.equal(profile!.advancedPolicy!.maxMainReverifications, 2);

    const edit = await doHttp(`${base}/api/worker-profiles`, "POST", ctx.token, {
      action: "upsert",
      profile: {
        id: "adv-test",
        label: "Advanced Worker v2",
        runtime: "claude-code",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        advancedPolicy: {
          maxDurationMs: null,
          maxConcurrency: 2,
          completionMode: "hard",
          maxAdaptationRounds: 0,
          maxMainCorrections: 3,
          maxMainReverifications: 3,
        },
      },
    });
    assert.equal(edit.status, 200);
    const edited = (edit.body as { workerProfiles: { profiles: Array<{ id: string; advancedPolicy?: Record<string, unknown> }> } }).workerProfiles;
    const editedProfile = edited.profiles.find((p: { id: string }) => p.id === "adv-test");
    assert.ok(editedProfile);
    assert.equal(editedProfile!.advancedPolicy!.maxDurationMs, null, "null persists as unlimited");
    assert.equal(editedProfile!.advancedPolicy!.maxConcurrency, 2);
    assert.equal(editedProfile!.advancedPolicy!.completionMode, "hard");
    assert.equal(editedProfile!.advancedPolicy!.maxMainReverifications, 3);

    const get = await doHttp(`${base}/api/worker-profiles`, "GET", ctx.token);
    assert.equal(get.status, 200);
    const stored = (get.body as { workerProfiles: { profiles: Array<{ id: string; advancedPolicy?: Record<string, unknown> }> } }).workerProfiles;
    const storedProfile = stored.profiles.find((p: { id: string }) => p.id === "adv-test");
    assert.ok(storedProfile);
    assert.ok(storedProfile!.advancedPolicy, "advancedPolicy survives get/load cycle");
  } finally {
    await ctx.cleanup();
  }
});

test("Hub worker profile edit preserves all supplied fields", async () => {
  const ctx = await makeHub();
  try {
    const base = `http://127.0.0.1:${ctx.port}`;
    const create = await doHttp(`${base}/api/worker-profiles`, "POST", ctx.token, {
      action: "upsert",
      profile: {
        id: "partial-edit",
        label: "Partial Worker",
        runtime: "claude-code",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        effort: "high",
        maxBudgetUsd: 0.5,
        noProgressTimeoutMs: 120000,
      },
    });
    assert.equal(create.status, 200);

    const edit = await doHttp(`${base}/api/worker-profiles`, "POST", ctx.token, {
      action: "upsert",
      profile: {
        id: "partial-edit",
        label: "Partial Worker v2",
        runtime: "claude-code",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        effort: "high",
        maxBudgetUsd: 0.5,
        noProgressTimeoutMs: 120000,
        advancedPolicy: { maxConcurrency: 1 },
      },
    });
    assert.equal(edit.status, 200);
    const edited = (edit.body as { workerProfiles: { profiles: Array<{ id: string; label: string; effort?: string; maxBudgetUsd?: number; noProgressTimeoutMs?: number; advancedPolicy?: Record<string, unknown> }> } }).workerProfiles;
    const prof = edited.profiles.find((p: { id: string }) => p.id === "partial-edit");
    assert.ok(prof);
    assert.equal(prof!.label, "Partial Worker v2");
    assert.equal(prof!.effort, "high", "effort preserved from original");
    assert.equal(prof!.maxBudgetUsd, 0.5, "maxBudgetUsd preserved");
    assert.equal(prof!.noProgressTimeoutMs, 120000, "noProgressTimeoutMs preserved");
    assert.ok(prof!.advancedPolicy, "advancedPolicy was set");
    assert.equal(prof!.advancedPolicy!.maxConcurrency, 1);
  } finally {
    await ctx.cleanup();
  }
});

test("Hub settings view includes deliveryProfiles", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-hub-dp-view-"));
  const store = new StateStore(home);
  try {
    const settings = new SettingsService(store);
    const view = viewHubSettings(settings.get());
    assert.ok(view.deliveryProfiles, "deliveryProfiles must be included in settings view");
    assert.equal(view.deliveryProfiles.defaultProfileId, null);
    assert.equal(Array.isArray(view.deliveryProfiles.profiles), true);
    assert.equal(typeof view.deliveryProfiles.projectBindings, "object");
  } finally {
    store.close();
  }
});

test("Hub status includes deliveryProfiles in response", async () => {
  const ctx = await makeHub();
  try {
    const base = `http://127.0.0.1:${ctx.port}`;
    const status = await doHttp(`${base}/api/status`, "GET", ctx.token);
    assert.equal(status.status, 200);
    const body = status.body as { settings?: { deliveryProfiles?: Record<string, unknown> } };
    const dp = body.settings?.deliveryProfiles;
    assert.ok(dp, "deliveryProfiles must appear in /api/status settings");
    assert.equal(dp!.defaultProfileId, null);
    assert.equal(Array.isArray(dp!.profiles), true);
  } finally {
    await ctx.cleanup();
  }
});

test("Hub saves valid deliveryProfiles atomically", async () => {
  const ctx = await makeHub();
  try {
    const base = `http://127.0.0.1:${ctx.port}`;
    const save = await doHttp(`${base}/api/settings`, "POST", ctx.token, {
      deliveryProfiles: {
        defaultProfileId: "default",
        profiles: [
          { id: "default", label: "Default", buildCommands: ["npm ci"], activationCommands: [], activationCheckCommands: [] },
          { id: "full", label: "Full", buildCommands: ["make build"], activationCommands: ["make start"], activationCheckCommands: ["make test"] },
        ],
        projectBindings: { "/home/user/repo": "full" },
      },
    });
    assert.equal(save.status, 200);
    const saved = (save.body as { settings: { deliveryProfiles: Record<string, unknown> } }).settings;
    assert.equal(saved.deliveryProfiles.defaultProfileId, "default");
    assert.equal((saved.deliveryProfiles.profiles as unknown[]).length, 2);

    const reloaded = ctx.settings.get();
    assert.equal(reloaded.deliveryProfiles.defaultProfileId, "default");
    assert.equal(reloaded.deliveryProfiles.profiles.length, 2);
    assert.equal(reloaded.deliveryProfiles.projectBindings["/home/user/repo"], "full");
  } finally {
    await ctx.cleanup();
  }
});

test("Hub rejects invalid deliveryProfiles atomically with error", async () => {
  const ctx = await makeHub();
  try {
    const base = `http://127.0.0.1:${ctx.port}`;
    // First save a valid registry
    await doHttp(`${base}/api/settings`, "POST", ctx.token, {
      deliveryProfiles: {
        defaultProfileId: null,
        profiles: [
          { id: "valid", label: "Valid", buildCommands: ["echo ok"], activationCommands: [], activationCheckCommands: [] },
        ],
        projectBindings: {},
      },
    });

    // Try to replace with an invalid registry — duplicate id
    const dup = await doHttp(`${base}/api/settings`, "POST", ctx.token, {
      deliveryProfiles: {
        defaultProfileId: null,
        profiles: [
          { id: "valid", label: "A", buildCommands: [], activationCommands: [], activationCheckCommands: [] },
          { id: "valid", label: "B", buildCommands: [], activationCommands: [], activationCheckCommands: [] },
        ],
        projectBindings: {},
      },
    });
    assert.equal(dup.status, 422);

    // Try to replace with bad project binding key (non-canonical path)
    const badPath = await doHttp(`${base}/api/settings`, "POST", ctx.token, {
      deliveryProfiles: {
        defaultProfileId: null,
        profiles: [
          { id: "valid", label: "Valid", buildCommands: [], activationCommands: [], activationCheckCommands: [] },
        ],
        projectBindings: { "relative/path": "valid" },
      },
    });
    assert.equal(badPath.status, 422);

    // Original valid registry must remain intact after failed replacements
    const after = ctx.settings.get();
    assert.equal(after.deliveryProfiles.profiles.length, 1);
    assert.equal(after.deliveryProfiles.profiles[0]!.id, "valid");
  } finally {
    await ctx.cleanup();
  }
});

test("buildHubSettingsPatch passes deliveryProfiles through as whole section", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-hub-dp-patch-"));
  const store = new StateStore(home);
  try {
    const settings = new SettingsService(store).get();
    const patch = buildHubSettingsPatch(settings, {
      deliveryProfiles: {
        defaultProfileId: null,
        profiles: [
          { id: "ci", label: "CI", buildCommands: ["npm ci"], activationCommands: [], activationCheckCommands: [] },
        ],
        projectBindings: {},
      },
    });
    assert.ok(patch.deliveryProfiles, "deliveryProfiles must be in patch output");
    assert.equal(patch.deliveryProfiles!.defaultProfileId, null);
    assert.equal((patch.deliveryProfiles!.profiles as unknown[]).length, 1);
  } finally {
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

function revisionDigest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function retainedCandidateJourney(options: {
  taskId: string;
  recordedDiff: string;
  currentDiff?: string;
  affectedPaths?: string[];
  verificationPassed?: boolean;
  taskStatus?: string;
  decision?: Record<string, unknown>;
  malformedPayload?: Record<string, unknown>;
}) {
  const { buildSafeTaskJourney } = await import("../src/hub/server.js");
  const home = await mkdtemp(path.join(tmpdir(), "fl-hub-retained-"));
  const diffPath = path.join(home, "result.diff");
  await writeFile(diffPath, options.currentDiff ?? options.recordedDiff, "utf8");
  const affectedPaths = options.affectedPaths ?? ["src/feature.ts"];
  const payload = options.malformedPayload ?? {
    id: "revision-1",
    taskId: options.taskId,
    attemptId: "attempt-1",
    attemptOrdinal: 2,
    verificationEventSequence: 7,
    patchDigest: revisionDigest(options.recordedDiff),
    affectedPaths,
    filesChanged: affectedPaths.length,
    changedLines: 42,
    verificationPassed: options.verificationPassed ?? true,
    createdAt: "2026-07-28T00:00:00.000Z",
    privateArtifactPath: "/private/revisions/revision-1.patch",
  };
  return buildSafeTaskJourney({
    id: options.taskId,
    name: "Retained Candidate fixture",
    status: options.taskStatus ?? "succeeded",
    paths: { diff: diffPath },
    spec: {
      version: 1,
      provider: { name: "deepseek", model: "deepseek-v4-pro[1M]" },
      runtime: { name: "claude-code" },
      goal: "Exercise retained Candidate evidence",
      acceptance: { commands: ["npm test"] },
    },
  }, options.decision ?? {}, {
    events: [{
      type: "candidate.revision.captured",
      sequence: 8,
      timestamp: "2026-07-28T00:00:01.000Z",
      summary: "Candidate captured",
      attemptId: "attempt-1",
      payload,
    }],
    attempts: [{ id: "attempt-1", ordinal: 2, status: "succeeded" }],
    diff: options.currentDiff ?? options.recordedDiff,
  });
}

test("retained Candidate projection proves a matching revision and caps safe paths", async () => {
  const paths = Array.from({ length: 45 }, (_, index) => `src/file-${index + 1}.ts`);
  const diff = "diff --git a/src/feature.ts b/src/feature.ts\n+retained\n";
  const journey = await retainedCandidateJourney({
    taskId: "retained-main-revise",
    recordedDiff: diff,
    affectedPaths: paths,
    decision: {
      mainReview: { decision: "revise", reason: "Tighten the copy" },
      verification: { passed: true, commands: [{ command: "npm test", exitCode: 0 }] },
    },
  });

  assert.equal(journey.retainedCandidate.status, "available");
  if (journey.retainedCandidate.status !== "available") return;
  assert.equal(journey.retainedCandidate.attemptOrdinal, 2);
  assert.equal(journey.retainedCandidate.verificationPassed, true);
  assert.equal(journey.retainedCandidate.affectedPathCount, 45);
  assert.equal(journey.retainedCandidate.affectedPaths.length, 40);
  assert.equal(journey.finalDelivery.mainReview?.decision, "revise");
  const safeJson = JSON.stringify(journey);
  assert.ok(!safeJson.includes(revisionDigest(diff)), "full digest stays private");
  assert.ok(!safeJson.includes("privateArtifactPath"), "private artifact key stays private");
  assert.ok(!safeJson.includes("/private/revisions"), "private artifact path stays private");
  assert.ok(!safeJson.includes("+retained"), "raw Diff content stays private");
});

test("retained Candidate projection fails closed for stale or malformed evidence", async () => {
  const stale = await retainedCandidateJourney({
    taskId: "retained-stale",
    recordedDiff: "recorded candidate",
    currentDiff: "changed after capture",
  });
  assert.deepEqual(stale.retainedCandidate, { status: "evidence-unavailable" });

  const malformed = await retainedCandidateJourney({
    taskId: "retained-malformed",
    recordedDiff: "same bytes",
    malformedPayload: {
      id: "revision-unsafe",
      taskId: "retained-malformed",
      attemptId: "attempt-1",
      attemptOrdinal: 2,
      verificationEventSequence: 7,
      patchDigest: revisionDigest("same bytes"),
      affectedPaths: ["../secret"],
      filesChanged: 1,
      changedLines: 1,
      verificationPassed: true,
      createdAt: "2026-07-28T00:00:00.000Z",
    },
  });
  assert.deepEqual(malformed.retainedCandidate, { status: "evidence-unavailable" });
});

test("retained Candidate stays separate from a later Main-repaired delivery", async () => {
  const journey = await retainedCandidateJourney({
    taskId: "retained-main-repair",
    recordedDiff: "original Worker candidate",
    verificationPassed: false,
    taskStatus: "failed",
    decision: {
      remediationDisposition: { status: "verified-repaired-delivered" },
      verification: { passed: false, commands: [{ command: "npm test", exitCode: 1 }] },
    },
  });
  assert.equal(journey.retainedCandidate.status, "available");
  if (journey.retainedCandidate.status !== "available") return;
  assert.equal(journey.retainedCandidate.verificationPassed, false);
  assert.equal(journey.finalDelivery.remediationDisposition?.status, "verified-repaired-delivered");
  assert.equal(journey.cause.what, "failed", "original machine failure remains visible");
  assert.equal(journey.nextAction.label, "done");
});

test("legacy Task reports unavailable retained evidence without denying historical work", async () => {
  const { buildSafeTaskJourney } = await import("../src/hub/server.js");
  const journey = buildSafeTaskJourney({
    id: "retained-legacy",
    status: "failed",
    spec: {
      version: 1,
      provider: { name: "minimax", model: "MiniMax-M3" },
      runtime: { name: "claude-code" },
      goal: "Legacy task",
      acceptance: { commands: ["npm test"] },
    },
  }, {}, { events: [], attempts: [], diff: "historical observation" });
  assert.deepEqual(journey.retainedCandidate, { status: "evidence-unavailable" });
});
