import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyFailure,
  computeStatistics,
  deriveRoutingEvidence,
  failureImpactForCategory,
  normalizeBudgetEnvelope,
  StatisticsService,
  type FailureCategory,
  type TaskEvidence,
} from "../src/core/statistics.js";
import type {
  AttemptRecord,
  EffectivePolicySnapshot,
  EventRecord,
  TaskRecord,
  VerificationResult,
} from "../src/core/types.js";
import { StateStore } from "../src/state/store.js";

const failedVerification: VerificationResult = {
  passed: false,
  behaviorPassed: false,
  policyPassed: true,
  sourceCompatible: true,
  commands: [
    { command: "npm test", exitCode: 1, stdout: "", stderr: "failed", durationMs: 10, timedOut: false },
  ],
  diffPath: "/tmp/result.diff",
  sourceUnchanged: true,
};

test("classifies explicit and legacy failure evidence with deterministic precedence", () => {
  const cases: Array<{
    diagnostic: string;
    category: FailureCategory;
    extra?: Partial<Parameters<typeof classifyFailure>[0]>;
  }> = [
    { diagnostic: "HTTP 401 during shutdown", category: "interruption", extra: { attemptExitCode: 143 } },
    { diagnostic: "Authentication failed", category: "interruption", extra: { taskStatus: "interrupted" } },
    { diagnostic: "Independent verification failed", category: "verification", extra: { verification: failedVerification } },
    { diagnostic: "Independent verification failed: HTTP 401", category: "verification" },
    { diagnostic: "Workspace preparation failed: keychain denied", category: "workspace" },
    { diagnostic: "Worker execution interrupted by SIGTERM", category: "interruption" },
    { diagnostic: "HTTP 401: Invalid API key", category: "credential" },
    { diagnostic: "Budget exceeded: max-budget-usd reached", category: "budget" },
    { diagnostic: "HTTP 429: rate limit exceeded", category: "provider" },
    { diagnostic: "unrecognized legacy code 0xDEAD", category: "unclassified" },
    { diagnostic: "", category: "unclassified" },
  ];

  for (const { diagnostic, category, extra } of cases) {
    const input = { taskStatus: "failed" as const, error: diagnostic, ...extra };
    const first = classifyFailure(input);
    assert.deepEqual(classifyFailure(input), first);
    assert.equal(first.category, category, diagnostic);
    assert.equal(first.diagnostic, diagnostic);
    assert.ok(first.reason.length > 0);
  }
});

test("reports failed commands and change-budget evidence without changing diagnostics", () => {
  const command = classifyFailure({
    taskStatus: "failed",
    verification: failedVerification,
    error: "verifier diagnostic",
  });
  assert.match(command.reason, /npm test.*exit 1/);
  assert.equal(command.diagnostic, "verifier diagnostic");

  const budget = classifyFailure({
    taskStatus: "failed",
    verification: {
      ...failedVerification,
      commands: [],
      changeBudget: {
        filesChanged: 4,
        changedLines: 301,
        maxFiles: 3,
        maxDiffLines: 300,
        withinBudget: false,
      },
    },
  });
  assert.match(budget.reason, /4\/3 files.*301\/300 lines/);
});

const baseTime = Date.parse("2026-07-20T00:00:00Z");
const at = (minutes: number): string => new Date(baseTime + minutes * 60_000).toISOString();

function task(
  id: string,
  status: TaskRecord["status"],
  provider = "deepseek",
  model = "v4",
  error?: string,
): TaskRecord {
  return {
    id,
    name: id,
    status,
    sourcePath: "/source",
    taskFile: `/tasks/${id}.yaml`,
    spec: { provider: { name: provider, model } } as TaskRecord["spec"],
    paths: {} as TaskRecord["paths"],
    sessionId: `session-${id}`,
    createdAt: at(0),
    updatedAt: at(120),
    startedAt: at(0),
    finishedAt: at(120),
    ...(error === undefined ? {} : { error }),
  };
}

function attempt(
  taskId: string,
  ordinal: number,
  status: AttemptRecord["status"],
  costUsd?: number,
  turns?: number,
  exitCode?: number,
  runtimeCostEstimateUsd?: number,
): AttemptRecord {
  return {
    id: `${taskId}-${ordinal}`,
    taskId,
    ordinal,
    status,
    sessionId: `session-${taskId}`,
    rawLogPath: "/log",
    startedAt: at(ordinal - 1),
    finishedAt: at(ordinal),
    runtimeBudgetEnforcement: "supported",
    ...(costUsd === undefined ? {} : { costUsd }),
    ...(turns === undefined ? {} : { turns }),
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(runtimeCostEstimateUsd === undefined ? {} : { runtimeCostEstimateUsd }),
  };
}

function toolEvent(taskId: string, attemptId: string, minutes: number): EventRecord {
  return {
    id: minutes,
    taskId,
    attemptId,
    sequence: minutes,
    timestamp: at(minutes),
    type: "worker.tool.started",
    summary: "Read started",
    payload: { tool: "Read" },
  };
}

function verificationEvent(
  taskId: string,
  attemptId: string,
  sequence: number,
  verification: VerificationResult,
): EventRecord {
  return {
    id: sequence,
    taskId,
    attemptId,
    sequence,
    timestamp: at(sequence),
    type: "verification.completed",
    summary: verification.passed ? "Independent verification passed" : "Independent verification failed",
    payload: verification,
  };
}

function policyTokenEvent(taskId: string, attemptId: string, sequence: number): EventRecord {
  return {
    id: sequence,
    taskId,
    attemptId,
    sequence,
    timestamp: at(sequence),
    type: "policy.token.exceeded",
    summary: "Worker policy limit triggered: observed-token",
    payload: {
      category: "observed-token",
      enforcementPhase: "post-observation",
      configured: 50_000,
      observed: 60_000,
      effect: "hard-fail",
      detail: "Observed gross Tokens exceeded the configured ceiling",
    },
  };
}

function workerFailedEvent(
  taskId: string,
  attemptId: string,
  sequence: number,
  failureCategory?: "authentication" | "budget" | "runtime",
): EventRecord {
  return {
    id: sequence,
    taskId,
    attemptId,
    sequence,
    timestamp: at(sequence),
    type: "worker.failed",
    summary: "Worker execution failed",
    ...(failureCategory === undefined ? {} : { payload: { failureCategory } }),
  };
}

const passedVerification: VerificationResult = {
  passed: true,
  behaviorPassed: true,
  policyPassed: true,
  sourceCompatible: true,
  commands: [{ command: "npm test", exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false }],
  diffPath: "/diff",
  sourceUnchanged: true,
};

test("statistics keep timing separate and preserve missing metric samples", () => {
  const running = task("running", "running");
  const succeeded = task("slow", "succeeded");
  const partial = task("partial", "succeeded");
  const history: TaskEvidence[] = [
    { task: running, attempts: [], events: [] },
    {
      task: succeeded,
      attempts: [attempt("slow", 1, "succeeded")],
      events: [toolEvent("slow", "slow-1", 10)],
      verification: passedVerification,
    },
    {
      task: partial,
      attempts: [attempt("partial", 1, "failed", 0.1, 2), attempt("partial", 2, "succeeded")],
      events: [toolEvent("partial", "partial-2", 20)],
      verification: passedVerification,
    },
  ];

  const summary = computeStatistics(history)[0]!;
  assert.equal(summary.sampleSize, 2);
  assert.equal(summary.successCount, 2);
  assert.equal(summary.durationSampleSize, 2);
  assert.equal(summary.avgDurationMs, 120 * 60_000);
  assert.equal(summary.firstEffectiveActionSampleSize, 2);
  assert.equal(summary.avgTimeToFirstEffectiveActionMs, 15 * 60_000);
  assert.equal(summary.costSampleSize, 0);
  assert.equal(summary.avgCostUsd, undefined);
  assert.equal(summary.turnsSampleSize, 0);
  assert.equal(summary.retryCount, 1);
});

test("statistics retain exact diagnostics while aggregating failure categories", () => {
  const credential = task("credential", "failed", "deepseek", "v4", "HTTP 401: bad key");
  const interrupted = task("interrupted", "interrupted", "deepseek", "v4", "SIGTERM");
  const summary = computeStatistics([
    { task: credential, attempts: [attempt("credential", 1, "failed", 0.2, 3, 1)], events: [] },
    { task: interrupted, attempts: [attempt("interrupted", 1, "interrupted", 0.1, 2, 143)], events: [] },
  ])[0]!;

  assert.deepEqual(summary.failureDistribution, { credential: 1, interruption: 1 });
  assert.equal(summary.failures[0]?.diagnostic, "HTTP 401: bad key");
  assert.equal(summary.failures[1]?.diagnostic, "SIGTERM");
  assert.equal(summary.costSampleSize, 2);
  assert.ok(Math.abs((summary.totalCostUsd ?? 0) - 0.3) < 1e-9);
});

test("statistics service reads terminal task evidence without mutating history", () => {
  const home = mkdtempSync(path.join(tmpdir(), "forklight-statistics-"));
  const store = new StateStore(home);
  try {
    const record = task("stored", "succeeded", "minimax", "m3");
    const workerAttempt = attempt("stored", 1, "succeeded", 0.4, 5, 0);
    store.createTask(record);
    store.createAttempt(workerAttempt);
    store.addEvent(
      record.id,
      workerAttempt.id,
      "verification.completed",
      "Independent verification passed",
      passedVerification,
    );

    const summary = new StatisticsService(store).summarize({ providerName: "minimax" });
    assert.equal(summary[0]?.verifiedSuccessCount, 1);
    assert.equal(summary[0]?.model, "m3");
    assert.equal(store.getTask(record.id).status, "succeeded");
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("statistics keep runtime estimates separate from legacy costUsd", () => {
  const cred = task("rtest", "succeeded", "deepseek", "v4");
  const history: TaskEvidence[] = [
    {
      task: cred,
      attempts: [
        attempt("rtest", 1, "succeeded", 0.2, 3, 0, 1.5),
        attempt("rtest", 2, "succeeded", undefined, undefined, undefined, 2.5),
      ],
      events: [],
    },
  ];

  const summary = computeStatistics(history)[0]!;
  // Legacy cost has one complete task (both attempts have costUsd... wait, second lacks costUsd)
  assert.equal(summary.costSampleSize, 0, "cost must be undefined when any attempt lacks costUsd");
  assert.equal(summary.totalCostUsd, undefined);
  // Runtime estimate: both attempts have values
  assert.equal(summary.runtimeEstimateTaskSampleSize, 1);
  assert.ok(Math.abs((summary.totalRuntimeEstimateUsd ?? 0) - 4.0) < 1e-9);
  assert.ok(Math.abs((summary.avgRuntimeEstimatePerTaskUsd ?? 0) - 4.0) < 1e-9);
});

test("statistics runtime estimate fields are undefined when no complete task", () => {
  const noEstimates: TaskEvidence[] = [
    {
      task: task("noest", "succeeded"),
      attempts: [attempt("noest", 1, "succeeded")],
      events: [],
    },
  ];
  const summary = computeStatistics(noEstimates)[0]!;
  assert.equal(summary.runtimeEstimateTaskSampleSize, 0);
  assert.equal(summary.totalRuntimeEstimateUsd, undefined);
  assert.equal(summary.avgRuntimeEstimatePerTaskUsd, undefined);
});

// --- Failure impact classification tests ---

test("failureImpactForCategory maps every category to the correct impact", () => {
  assert.equal(failureImpactForCategory("verification"), "model-quality");
  assert.equal(failureImpactForCategory("credential"), "non-model");
  assert.equal(failureImpactForCategory("interruption"), "non-model");
  assert.equal(failureImpactForCategory("workspace"), "non-model");
  assert.equal(failureImpactForCategory("budget"), "non-model");
  assert.equal(failureImpactForCategory("provider"), "non-model");
  assert.equal(failureImpactForCategory("noProgress"), "ambiguous");
  assert.equal(failureImpactForCategory("unclassified"), "ambiguous");
});

test("classifyFailure sets impact on every classification", () => {
  const credential = classifyFailure({
    taskStatus: "failed",
    error: "HTTP 401 Unauthorized",
  });
  assert.equal(credential.impact, "non-model");
  assert.equal(credential.category, "credential");

  const provider = classifyFailure({
    taskStatus: "failed",
    error: "HTTP 503 Service Unavailable",
  });
  assert.equal(provider.impact, "non-model");
  assert.equal(provider.category, "provider");

  const interrupt = classifyFailure({
    taskStatus: "failed",
    attemptExitCode: 130,
  });
  assert.equal(interrupt.impact, "non-model");
  assert.equal(interrupt.category, "interruption");

  const unclassified = classifyFailure({
    taskStatus: "failed",
    error: "SIGKILL 9 unexpected",
  });
  assert.equal(unclassified.impact, "ambiguous");
  assert.equal(unclassified.category, "unclassified");
});

test("computeStatistics filters by taskClass", () => {
  const matchClass = task("match", "succeeded", "deepseek", "v4");
  (matchClass.spec as unknown as Record<string, unknown>).taskClass = "target-class";
  const otherClass = task("other", "succeeded", "deepseek", "v4");
  (otherClass.spec as unknown as Record<string, unknown>).taskClass = "other-class";

  const summaries = computeStatistics(
    [
      { task: matchClass, attempts: [attempt("match", 1, "succeeded")], events: [] },
      { task: otherClass, attempts: [attempt("other", 1, "succeeded")], events: [] },
    ],
    { taskClass: "target-class" },
  );
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]!.sampleSize, 1);
});

// --- Routing evidence derivation tests ---

test("deriveRoutingEvidence produces per-model evidence for exact taskClass", () => {
  const t1 = task("r1", "succeeded", "deepseek", "v4");
  (t1.spec as unknown as Record<string, unknown>).taskClass = "routing-test";
  const t2 = task("r2", "failed", "deepseek", "v4", "HTTP 401: bad key");
  (t2.spec as unknown as Record<string, unknown>).taskClass = "routing-test";
  const t3 = task("r3", "succeeded", "qwen", "plus");
  (t3.spec as unknown as Record<string, unknown>).taskClass = "routing-test";

  const evidence = deriveRoutingEvidence({
    taskClass: "routing-test",
    history: [
      { task: t1, attempts: [attempt("r1", 1, "succeeded")], events: [] },
      { task: t2, attempts: [attempt("r2", 1, "failed", undefined, undefined, 1)], events: [] },
      { task: t3, attempts: [attempt("r3", 1, "succeeded")], events: [] },
    ],
  });

  const ds = evidence.get("deepseek\0v4")!;
  assert.ok(ds);
  assert.equal(ds.terminalTaskCount, 2);
  assert.equal(ds.relevantSampleCount, 1);
  assert.equal(ds.modelQualityFailureCount, 0);
  assert.equal(ds.ignoredNonModelFailures["credential"], 1);
  assert.equal(ds.acceptedDeliveryCount, 1);

  const qw = evidence.get("qwen\0plus")!;
  assert.ok(qw);
  assert.equal(qw.relevantSampleCount, 1);
  assert.equal(qw.acceptedDeliveryCount, 1);
});

test("deriveRoutingEvidence handles verification-based model-quality failures", () => {
  const t1 = task("v1", "failed", "deepseek", "v4");
  (t1.spec as unknown as Record<string, unknown>).taskClass = "verify-fail";
  const evidence = deriveRoutingEvidence({
    taskClass: "verify-fail",
    history: [
      {
        task: t1,
        attempts: [attempt("v1", 1, "failed")],
        events: [],
        verification: failedVerification,
      },
    ],
  });

  const ds = evidence.get("deepseek\0v4")!;
  assert.equal(ds.modelQualityFailureCount, 1);
  assert.equal(ds.ignoredNonModelFailures["verification"], undefined);
});

test("deriveRoutingEvidence handles tasks with officialCost evidence", () => {
  const t1 = task("oc1", "succeeded", "deepseek", "v4");
  (t1.spec as unknown as Record<string, unknown>).taskClass = "oc-test";
  const evidence = deriveRoutingEvidence({
    taskClass: "oc-test",
    history: [
      {
        task: t1,
        attempts: [
          {
            ...attempt("oc1", 1, "succeeded"),
            officialCost: {
              stage: "calculation",
              quoted: true,
              result: {
                quoted: true as const,
                currency: "USD" as const,
                total: 0.00028,
                components: [
                  { component: "input", tokens: 1000, ratePerMillion: 0.14, amount: 0.00014 },
                  { component: "output", tokens: 500, ratePerMillion: 0.28, amount: 0.00014 },
                  { component: "cacheRead", tokens: 0, ratePerMillion: 0.014, amount: 0 },
                  { component: "cacheCreation", tokens: 0, ratePerMillion: 0.14, amount: 0 },
                ],
                pricing: {
                  provider: "deepseek",
                  origin: "https://example.com",
                  route: "payg",
                  modelAliases: ["v4"],
                  serviceTier: "default",
                  currency: "USD" as const,
                  unitTokens: 1_000_000,
                  source: { url: "https://example.com/pricing", checkedAt: "2026-01-01T00:00:00Z" },
                  promotion: null,
                },
                appliedTier: { applied: [], totalPromptInput: 1000 },
                usageSource: "terminal-result" as const,
                providerBillClaim: false as const,
              },
            },
          },
        ],
        events: [],
        verification: passedVerification,
      },
    ],
  });

  const ds = evidence.get("deepseek\0v4")!;
 assert.equal(ds.officialCostByCurrency.length, 1);
 assert.equal(ds.officialCostByCurrency[0]!.currency, "USD");
  assert.equal(ds.officialCostByCurrency[0]!.quotedAttemptCount, 1);
});

// --- Budget outcome evidence (opt-in budgetReliability factor) -----------

function boundedTask(
  id: string,
  status: TaskRecord["status"],
  taskClass: string,
  runtimeBudgetUsd: number | null,
  observedTokenCeiling: number | null,
  error?: string,
): TaskRecord {
  const t = task(id, status);
  (t.spec as unknown as Record<string, unknown>).runtime = {
    name: "claude-code",
    executable: "claude",
    effort: "high",
    maxBudgetUsd: runtimeBudgetUsd,
  };
  (t.spec as unknown as Record<string, unknown>).taskClass = taskClass;
  if (observedTokenCeiling !== null) {
    const effectivePolicy: EffectivePolicySnapshot = {
      profileId: "global",
      values: {
        maxDurationMs: null,
        observedTokenCeiling,
        noProgressTimeoutMs: null,
        workerStopGraceMs: 10_000,
        fileLimit: null,
        fileLimitMode: "warn",
        changedLineLimit: null,
        changedLineLimitMode: "warn",
        baseMaxAttempts: 1,
        maxExtraAttempts: 0,
        maxConcurrency: 1,
        completionMode: "warn",
        changeBudgetMode: "warn",
        maxAdaptationRounds: 0,
        maxMainCorrections: 0,
        maxMainReverifications: 0,
      },
      provenance: {
        maxDurationMs: "global",
        observedTokenCeiling: "global",
        noProgressTimeoutMs: "global",
        workerStopGraceMs: "global",
        fileLimit: "global",
        fileLimitMode: "global",
        changedLineLimit: "global",
        changedLineLimitMode: "global",
        baseMaxAttempts: "global",
        maxExtraAttempts: "global",
        maxConcurrency: "global",
        completionMode: "global",
        changeBudgetMode: "global",
        maxAdaptationRounds: "global",
        maxMainCorrections: "global",
        maxMainReverifications: "global",
      },
      enforcementCapability: {
        durationEnforcement: "preemptive",
        tokenEnforcement: "post-observation",
        progressWatchdog: "live",
      },
    };
    t.effectivePolicy = effectivePolicy;
  }
  if (error !== undefined) t.error = error;
  return t;
}

test("budgetReliability: uncapped history is excluded from bounded evidence, never zero", () => {
  const t = boundedTask("u1", "succeeded", "budget-rel-uncapped", null, null);
  const map = deriveRoutingEvidence({
    taskClass: "budget-rel-uncapped",
    history: [{ task: t, attempts: [attempt("u1", 1, "succeeded")], events: [], verification: passedVerification }],
  });
  const ds = map.get("deepseek\0v4")!;
  assert.equal(ds.budgetReliability.boundedSampleCount, 0);
  assert.equal(ds.budgetReliability.excludedUncappedCount, 1);
  assert.equal(ds.budgetReliability.envelope, null);
  assert.equal(ds.budgetReliability.completedWithoutExhaustionRate, null);
});

test("budgetReliability: bounded successful Tasks are counted as completed-without-exhaustion", () => {
  const t = boundedTask("b1", "succeeded", "budget-rel-success", 1.0, null);
  const map = deriveRoutingEvidence({
    taskClass: "budget-rel-success",
    history: [
      { task: t, attempts: [attempt("b1", 1, "succeeded")], events: [], verification: passedVerification },
      {
        task: boundedTask("b2", "succeeded", "budget-rel-success", 1.0, null),
        attempts: [attempt("b2", 1, "succeeded")],
        events: [],
        verification: passedVerification,
      },
      {
        task: boundedTask("b3", "failed", "budget-rel-success", 1.0, null, "Budget exceeded: max-budget-usd reached"),
        attempts: [{ ...attempt("b3", 1, "failed"), error: "Budget exceeded: max-budget-usd reached" }],
        events: [],
      },
    ],
  });
  const ds = map.get("deepseek\0v4")!;
  assert.equal(ds.budgetReliability.boundedSampleCount, 3);
  assert.equal(ds.budgetReliability.completedWithoutExhaustionCount, 2);
  assert.equal(ds.budgetReliability.budgetExhaustionCount, 1);
  assert.equal(ds.budgetReliability.completedWithoutExhaustionRate, 2 / 3);
  assert.deepEqual(ds.budgetReliability.envelope, { runtimeBudgetUsd: 1.0, observedTokenCeiling: null });
});

test("budgetReliability: credential failure is excluded from both counts and surfaces as non-model", () => {
  const t = boundedTask("c1", "failed", "budget-rel-cred", 1.0, null, "HTTP 401 bad key");
  const map = deriveRoutingEvidence({
    taskClass: "budget-rel-cred",
    history: [{ task: t, attempts: [attempt("c1", 1, "failed")], events: [] }],
  });
  const ds = map.get("deepseek\0v4")!;
  assert.equal(ds.budgetReliability.boundedSampleCount, 0);
  assert.equal(ds.budgetReliability.excludedExternalFailureCount, 1);
  assert.equal(ds.budgetReliability.envelope, null);
  assert.equal(ds.ignoredNonModelFailures.credential, 1);
  assert.equal(ds.modelQualityFailureCount, 0);
});

test("budgetReliability: behavior-failed bounded Tasks count as completed-without-exhaustion", () => {
  const t = boundedTask("v1", "failed", "budget-rel-beh", 1.0, null);
  const map = deriveRoutingEvidence({
    taskClass: "budget-rel-beh",
    history: [{
      task: t,
      attempts: [attempt("v1", 1, "failed")],
      events: [verificationEvent("v1", "v1-1", 1, failedVerification)],
      verification: failedVerification,
    }],
  });
  const ds = map.get("deepseek\0v4")!;
  assert.equal(ds.budgetReliability.boundedSampleCount, 1);
  assert.equal(ds.budgetReliability.completedWithoutExhaustionCount, 1);
  assert.equal(ds.budgetReliability.budgetExhaustionCount, 0);
  // Model-quality verification failures are still budget-completed (no exhaustion).
  assert.deepEqual(ds.budgetReliability.envelope, { runtimeBudgetUsd: 1.0, observedTokenCeiling: null });
});

test("budgetReliability: mixed envelopes inside one candidate clear the envelope", () => {
  const a = boundedTask("m1", "succeeded", "budget-rel-mix", 0.5, null);
  const b = boundedTask("m2", "succeeded", "budget-rel-mix", 2.0, null);
  const map = deriveRoutingEvidence({
    taskClass: "budget-rel-mix",
    history: [
      { task: a, attempts: [attempt("m1", 1, "succeeded")], events: [], verification: passedVerification },
      { task: b, attempts: [attempt("m2", 1, "succeeded")], events: [], verification: passedVerification },
    ],
  });
  const ds = map.get("deepseek\0v4")!;
  assert.equal(ds.budgetReliability.boundedSampleCount, 2);
  assert.equal(ds.budgetReliability.envelope, null);
});

test("budgetReliability: observedTokenCeiling participates in the envelope", () => {
  const t = boundedTask("t1", "succeeded", "budget-rel-token", null, 50_000);
  const map = deriveRoutingEvidence({
    taskClass: "budget-rel-token",
    history: [{ task: t, attempts: [attempt("t1", 1, "succeeded")], events: [], verification: passedVerification }],
  });
  const ds = map.get("deepseek\0v4")!;
  assert.deepEqual(ds.budgetReliability.envelope, { runtimeBudgetUsd: null, observedTokenCeiling: 50_000 });
});

test("budgetReliability: observed Token exhaustion is read from the Attempt event", () => {
  const t = boundedTask("token-fail", "failed", "budget-rel-token-fail", null, 50_000);
  const a = { ...attempt("token-fail", 1, "failed"), error: "Worker policy limit exceeded: observed-token" };
  const map = deriveRoutingEvidence({
    taskClass: "budget-rel-token-fail",
    history: [{ task: t, attempts: [a], events: [policyTokenEvent(t.id, a.id, 1)] }],
  });
  const budget = map.get("deepseek\0v4")!.budgetReliability;
  assert.equal(budget.boundedSampleCount, 1);
  assert.equal(budget.budgetExhaustionCount, 1);
  assert.equal(budget.completedWithoutExhaustionCount, 0);
});

test("budgetReliability: durable budget category survives a later bare worker.failed event", () => {
  const t = boundedTask("dual-budget", "failed", "budget-rel-dual-budget", 1, null);
  const a = { ...attempt("dual-budget", 1, "failed"), runtimeBudgetUsd: 1 };
  const map = deriveRoutingEvidence({
    taskClass: "budget-rel-dual-budget",
    history: [{
      task: t,
      attempts: [a],
      events: [
        workerFailedEvent(t.id, a.id, 1, "budget"),
        workerFailedEvent(t.id, a.id, 2),
      ],
    }],
  });
  const budget = map.get("deepseek\0v4")!.budgetReliability;
  assert.equal(budget.boundedSampleCount, 1);
  assert.equal(budget.budgetExhaustionCount, 1);
});

test("budgetReliability: file and line change-budget failure is not execution exhaustion", () => {
  const t = boundedTask("change-budget", "failed", "budget-rel-change-budget", 1, null);
  const a = { ...attempt("change-budget", 1, "failed"), runtimeBudgetUsd: 1 };
  const policyOnlyFailure: VerificationResult = {
    ...failedVerification,
    behaviorPassed: true,
    policyPassed: false,
    commands: [{ command: "npm test", exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false }],
    changeBudget: {
      filesChanged: 8,
      changedLines: 900,
      maxFiles: 5,
      maxDiffLines: 500,
      withinBudget: false,
      effect: "hard-fail",
    },
  };
  const map = deriveRoutingEvidence({
    taskClass: "budget-rel-change-budget",
    history: [{
      task: t,
      attempts: [a],
      events: [verificationEvent(t.id, a.id, 1, policyOnlyFailure)],
      verification: policyOnlyFailure,
    }],
  });
  const budget = map.get("deepseek\0v4")!.budgetReliability;
  assert.equal(budget.boundedSampleCount, 1);
  assert.equal(budget.budgetExhaustionCount, 0);
  assert.equal(budget.completedWithoutExhaustionCount, 1);
});

test("budgetReliability: correction success does not erase an earlier exhausted Attempt", () => {
  const t = boundedTask("corrected", "succeeded", "budget-rel-corrected", 0.5, null);
  const first = {
    ...attempt("corrected", 1, "failed"),
    runtimeBudgetUsd: 0.5,
    error: "Budget exceeded: max-budget-usd reached",
  };
  const second = {
    ...attempt("corrected", 2, "succeeded"),
    runtimeBudgetUsd: 0.5,
  };
  const map = deriveRoutingEvidence({
    taskClass: "budget-rel-corrected",
    history: [{
      task: t,
      attempts: [first, second],
      events: [verificationEvent(t.id, second.id, 2, passedVerification)],
      verification: passedVerification,
    }],
  });
  const budget = map.get("deepseek\0v4")!.budgetReliability;
  assert.equal(budget.boundedSampleCount, 2);
  assert.equal(budget.budgetExhaustionCount, 1);
  assert.equal(budget.completedWithoutExhaustionCount, 1);
  assert.equal(budget.completedWithoutExhaustionRate, 0.5);
});

test("budgetReliability: per-Attempt correction budget overrides remain separate envelopes", () => {
  const t = boundedTask("override", "succeeded", "budget-rel-override", 0.5, null);
  const first = {
    ...attempt("override", 1, "failed"),
    runtimeBudgetUsd: 0.5,
    error: "Budget exceeded: max-budget-usd reached",
  };
  const second = {
    ...attempt("override", 2, "succeeded"),
    runtimeBudgetUsd: 2,
  };
  const map = deriveRoutingEvidence({
    taskClass: "budget-rel-override",
    history: [{
      task: t,
      attempts: [first, second],
      events: [verificationEvent(t.id, second.id, 2, passedVerification)],
      verification: passedVerification,
    }],
  });
  const budget = map.get("deepseek\0v4")!.budgetReliability;
  assert.equal(budget.boundedSampleCount, 2);
  assert.equal(budget.envelope, null);
});

test("budgetReliability: configured USD cap without frozen enforcement proof is excluded", () => {
  const t = boundedTask("unsupported", "succeeded", "budget-rel-unsupported", 1, null);
  const a = { ...attempt("unsupported", 1, "succeeded"), runtimeBudgetEnforcement: "unsupported" as const };
  const map = deriveRoutingEvidence({
    taskClass: "budget-rel-unsupported",
    history: [{ task: t, attempts: [a], events: [], verification: passedVerification }],
  });
  const budget = map.get("deepseek\0v4")!.budgetReliability;
  assert.equal(budget.boundedSampleCount, 0);
  assert.equal(budget.excludedUnknownEnforcementCount, 1);
  assert.equal(budget.envelope, null);
});

test("normalizeBudgetEnvelope coerces non-finite or non-positive values to null", () => {
  assert.deepEqual(
    normalizeBudgetEnvelope(0, -1),
    { runtimeBudgetUsd: null, observedTokenCeiling: null },
  );
  assert.deepEqual(
    normalizeBudgetEnvelope(Number.POSITIVE_INFINITY, Number.NaN),
    { runtimeBudgetUsd: null, observedTokenCeiling: null },
  );
  assert.deepEqual(
    normalizeBudgetEnvelope(undefined, undefined),
    { runtimeBudgetUsd: null, observedTokenCeiling: null },
  );
  assert.deepEqual(
    normalizeBudgetEnvelope(0.5, 1000),
    { runtimeBudgetUsd: 0.5, observedTokenCeiling: 1000 },
  );
});
