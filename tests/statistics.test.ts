import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyFailure,
  classifyFinalDeliveryOutcome,
  computeRoutingEvidenceCoverage,
  computeStatistics,
  deriveRoutingEvidence,
  failureImpactForCategory,
  normalizeBudgetEnvelope,
  projectCompactProviderModelSummaries,
  projectCompactProviderModelSummary,
  resolveCurrentMainDecision,
  StatisticsService,
  verificationFrom,
  type FailureCategory,
  type TaskEvidence,
} from "../src/core/statistics.js";
import { REVIEW_GRAPH_TASK_FILE_PREFIX } from "../src/core/task.js";
import type {
  AttemptRecord,
  EffectivePolicySnapshot,
  EventRecord,
  RoutingDecisionSnapshot,
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

test("final verification projection stays fail-closed when the latest record is malformed", () => {
  const earlier: EventRecord = {
    id: 1,
    taskId: "verification-shape",
    sequence: 1,
    timestamp: "2026-07-30T00:00:00.000Z",
    type: "verification.completed",
    summary: "earlier valid record",
    payload: failedVerification,
  };
  const malformedLatest: EventRecord = {
    id: 2,
    taskId: "verification-shape",
    sequence: 2,
    timestamp: "2026-07-30T00:00:01.000Z",
    type: "verification.completed",
    summary: "latest malformed record",
    payload: { passed: true },
  };

  assert.equal(verificationFrom([earlier, malformedLatest]), undefined);
});

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
  failureCategory?: "authentication" | "budget" | "runtime" | "connectivity",
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

test("compact statistics projection keeps aggregate parity and omits row-level failure evidence", () => {
  const credential = task("credential", "failed", "deepseek", "v4", "HTTP 401: bad key");
  const interrupted = task("interrupted", "interrupted", "deepseek", "v4", "SIGTERM");
  const succeeded = task("ok", "succeeded", "deepseek", "v4");
  const full = computeStatistics([
    { task: credential, attempts: [attempt("credential", 1, "failed", 0.2, 3, 1)], events: [] },
    { task: interrupted, attempts: [attempt("interrupted", 1, "interrupted", 0.1, 2, 143)], events: [] },
    {
      task: succeeded,
      attempts: [attempt("ok", 1, "succeeded", 0.4, 5, 0)],
      events: [verificationEvent("ok", "ok-1", 1, passedVerification)],
      verification: passedVerification,
    },
  ])[0]!;

  const compact = projectCompactProviderModelSummary(full);
  assert.equal(compact.provider, full.provider);
  assert.equal(compact.model, full.model);
  assert.equal(compact.sampleSize, full.sampleSize);
  assert.equal(compact.successCount, full.successCount);
  assert.equal(compact.verifiedSuccessCount, full.verifiedSuccessCount);
  assert.equal(compact.successRate, full.successRate);
  assert.equal(compact.verifiedSuccessRate, full.verifiedSuccessRate);
  assert.equal(compact.retryCount, full.retryCount);
  assert.equal(compact.avgRetries, full.avgRetries);
  assert.equal(compact.durationSampleSize, full.durationSampleSize);
  assert.equal(compact.totalDurationMs, full.totalDurationMs);
  assert.equal(compact.avgDurationMs, full.avgDurationMs);
  assert.equal(compact.firstEffectiveActionSampleSize, full.firstEffectiveActionSampleSize);
  assert.equal(compact.avgTimeToFirstEffectiveActionMs, full.avgTimeToFirstEffectiveActionMs);
  assert.equal(compact.costSampleSize, full.costSampleSize);
  assert.equal(compact.totalCostUsd, full.totalCostUsd);
  assert.equal(compact.avgCostUsd, full.avgCostUsd);
  assert.equal(compact.runtimeEstimateTaskSampleSize, full.runtimeEstimateTaskSampleSize);
  assert.equal(compact.totalRuntimeEstimateUsd, full.totalRuntimeEstimateUsd);
  assert.equal(compact.avgRuntimeEstimatePerTaskUsd, full.avgRuntimeEstimatePerTaskUsd);
  assert.equal(compact.turnsSampleSize, full.turnsSampleSize);
  assert.equal(compact.totalTurns, full.totalTurns);
  assert.equal(compact.avgTurns, full.avgTurns);
  assert.deepEqual(compact.failureDistribution, full.failureDistribution);
  assert.equal(compact.acceptedDeliveryCount, full.acceptedDeliveryCount);
  assert.equal(compact.acceptedDeliverySampleCount, full.acceptedDeliverySampleCount);
  assert.equal(compact.acceptedDeliveryNotAcceptedCount, full.acceptedDeliveryNotAcceptedCount);
  assert.equal(compact.acceptedDeliveryUnavailableCount, full.acceptedDeliveryUnavailableCount);
  assert.equal(compact.acceptedDeliveryRate, full.acceptedDeliveryRate);
  assert.equal(compact.mainRepairedDeliveryCount, full.mainRepairedDeliveryCount);
  assert.equal(compact.remediationCheckCount, full.remediationCheckCount);

  assert.equal("failures" in compact, false);
  const serialized = JSON.stringify(compact);
  assert.doesNotMatch(serialized, /"taskId"|"attemptId"|"diagnostic"|"HTTP 401"|"SIGTERM"/);
  assert.doesNotMatch(serialized, /"failures"/);
  // Category counts remain; only row-level ids/diagnostics are omitted.
  assert.match(serialized, /"credential":1/);
  // Detached: mutating compact distribution must not touch the full summary.
  compact.failureDistribution.credential = 99;
  assert.equal(full.failureDistribution.credential, 1);
  assert.equal(full.failures.length, 2);
  assert.equal(full.failures[0]?.taskId, "credential");
  assert.equal(full.failures[0]?.diagnostic, "HTTP 401: bad key");

  const list = projectCompactProviderModelSummaries([full]);
  assert.equal(list.length, 1);
  assert.equal("failures" in list[0]!, false);
  assert.equal(list[0]!.sampleSize, full.sampleSize);
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
  assert.equal(failureImpactForCategory("contract-infeasible"), "non-model");
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

// --- Final-delivery evidence (Main/delivery-backed, never machine alone) ---

const PATCH_DIGEST_A = "a".repeat(64);
const PATCH_DIGEST_B = "b".repeat(64);

function mainReviewEvent(
  taskId: string,
  attemptId: string,
  sequence: number,
  decision: "accept" | "revise" | "reject",
  verificationSequence: number,
  revision?: { id: string; patchDigest: string },
): EventRecord {
  return {
    id: sequence,
    taskId,
    attemptId,
    sequence,
    timestamp: at(sequence),
    type: "main-review.completed",
    summary: `Main ${decision}`,
    payload: {
      decision,
      reason: "bounded test reason",
      attemptId,
      verificationEventSequence: verificationSequence,
      ...(revision === undefined
        ? {}
        : {
            candidateRevisionId: revision.id,
            acceptedPatchDigest: revision.patchDigest,
          }),
    },
  };
}

function revisionEvent(
  taskId: string,
  attemptId: string,
  sequence: number,
  revisionId: string,
  verificationSequence: number,
  patchDigest = PATCH_DIGEST_A,
): EventRecord {
  return {
    id: sequence,
    taskId,
    attemptId,
    sequence,
    timestamp: at(sequence),
    type: "candidate.revision.captured",
    summary: "Candidate revision captured",
    payload: {
      id: revisionId,
      taskId,
      attemptId,
      attemptOrdinal: 1,
      verificationEventSequence: verificationSequence,
      patchDigest,
      affectedPaths: ["src/core/statistics.ts"],
      filesChanged: 1,
      changedLines: 10,
      verificationPassed: true,
      createdAt: at(sequence),
    },
  };
}

function boundAcceptEvidence(taskId: string): TaskEvidence {
  const a1 = attempt(taskId, 1, "succeeded");
  const verificationSeq = 10;
  return {
    task: { ...task(taskId, "succeeded"), currentAttemptId: a1.id },
    attempts: [a1],
    events: [
      verificationEvent(taskId, a1.id, verificationSeq, passedVerification),
      revisionEvent(taskId, a1.id, 11, `rev-${taskId}`, verificationSeq),
      mainReviewEvent(taskId, a1.id, 12, "accept", verificationSeq, {
        id: `rev-${taskId}`,
        patchDigest: PATCH_DIGEST_A,
      }),
    ],
    verification: passedVerification,
  };
}

test("accepted delivery counts each terminal Task at most once when accept and remediation overlap", () => {
  // Current Main accept later also repaired must remain one accepted delivery.
  const overlap = boundAcceptEvidence("overlap-ok");
  const plainAccepted = boundAcceptEvidence("plain-ok");
  const summary = computeStatistics(
    [overlap, plainAccepted],
    {},
    {
      checksCount: (taskId) => (taskId === "overlap-ok" ? 1 : 0),
      hasPassingDisposition: (taskId) => taskId === "overlap-ok",
    },
  )[0]!;

  assert.equal(summary.sampleSize, 2);
  assert.equal(summary.successCount, 2, "both Tasks succeeded by machine verification");
  assert.equal(summary.mainRepairedDeliveryCount, 1, "repair path remains visible");
  assert.equal(
    summary.acceptedDeliveryCount,
    2,
    "union must not double-count the overlapping Task",
  );
  assert.equal(summary.acceptedDeliverySampleCount, 2);
  assert.equal(summary.acceptedDeliveryUnavailableCount, 0);
  assert.equal(summary.acceptedDeliveryRate, 1);
  assert.ok(summary.acceptedDeliveryCount <= summary.acceptedDeliverySampleCount);
  assert.ok(summary.acceptedDeliveryRate <= 1);
  assert.equal(summary.remediationCheckCount, 1);
});

test("accepted delivery counts Main-repaired failures without treating bare machine success as accepted", () => {
  const failedRepaired = task("fail-repaired", "failed", "volcengine", "glm-5.2", "verification failed");
  const plainSuccess = task("ok-only", "succeeded", "volcengine", "glm-5.2");
  const unrepairedFailure = task("still-failed", "failed", "volcengine", "glm-5.2", "HTTP 401: bad key");
  const summary = computeStatistics(
    [
      {
        task: failedRepaired,
        attempts: [attempt("fail-repaired", 1, "failed")],
        events: [],
        verification: failedVerification,
      },
      {
        task: plainSuccess,
        attempts: [attempt("ok-only", 1, "succeeded")],
        events: [],
        verification: passedVerification,
      },
      {
        task: unrepairedFailure,
        attempts: [attempt("still-failed", 1, "failed", undefined, undefined, 1)],
        events: [],
      },
    ],
    {},
    {
      checksCount: (taskId) => (taskId === "fail-repaired" ? 1 : 0),
      hasPassingDisposition: (taskId) => taskId === "fail-repaired",
    },
  )[0]!;

  assert.equal(summary.sampleSize, 3);
  assert.equal(summary.successCount, 1);
  assert.equal(summary.mainRepairedDeliveryCount, 1);
  assert.equal(summary.acceptedDeliveryCount, 1, "only Main-repaired counts as accepted");
  assert.equal(summary.acceptedDeliverySampleCount, 1);
  assert.equal(summary.acceptedDeliveryUnavailableCount, 2,
    "bare success and external failure stay unavailable");
  assert.equal(summary.acceptedDeliveryRate, 1);
  // Failure evidence stays visible for both failed Tasks.
  assert.equal(summary.failureDistribution.verification, 1);
  assert.equal(summary.failureDistribution.credential, 1);
  assert.equal(summary.failures.length, 2);
});

test("repeated remediation checks do not multiply accepted delivery or Main-repaired counts", () => {
  const repaired = task("multi-check", "succeeded", "volcengine", "glm-5.2");
  const summary = computeStatistics(
    [
      {
        task: repaired,
        attempts: [attempt("multi-check", 1, "succeeded")],
        events: [],
        verification: passedVerification,
      },
    ],
    {},
    {
      // Multiple checks (e.g. failed then passed) must not inflate delivery.
      checksCount: () => 3,
      hasPassingDisposition: () => true,
    },
  )[0]!;

  assert.equal(summary.sampleSize, 1);
  assert.equal(summary.successCount, 1);
  assert.equal(summary.mainRepairedDeliveryCount, 1, "one Task, one disposition");
  assert.equal(summary.acceptedDeliveryCount, 1, "one Task, one accepted delivery");
  assert.equal(summary.acceptedDeliverySampleCount, 1);
  assert.equal(summary.acceptedDeliveryRate, 1);
  assert.equal(summary.remediationCheckCount, 3, "check count remains the real total");
  assert.ok(summary.acceptedDeliveryCount <= summary.acceptedDeliverySampleCount);
  assert.ok(summary.acceptedDeliveryRate <= 1);
});

test("machine success with latest Main reject is zero accepted of one comparable outcome", () => {
  // Production Task 5e5ad6a1 shape: machine-succeeded Attempt 2, verification
  // sequence 550, Main reject bound to that Attempt+verification, revision
  // capture present, but the review predates candidateRevisionId /
  // acceptedPatchDigest. No Integration/remediation. Must be 0 accepted of 1
  // comparable outcome — never unavailable, never accepted.
  const taskId = "5e5ad6a1-0cfb-4e64-814b-cd3e9faa8ff4";
  const a1 = attempt(taskId, 1, "succeeded");
  const a2 = attempt(taskId, 2, "succeeded");
  const verificationSeq = 550;
  const item: TaskEvidence = {
    task: { ...task(taskId, "succeeded"), currentAttemptId: a2.id },
    attempts: [a1, a2],
    events: [
      verificationEvent(taskId, a1.id, 100, passedVerification),
      revisionEvent(taskId, a1.id, 101, "rev-attempt-1", 100),
      verificationEvent(taskId, a2.id, verificationSeq, passedVerification),
      revisionEvent(taskId, a2.id, 551, "rev-attempt-2", verificationSeq),
      // Legacy Main reject: attempt + verification only; no revision fields.
      mainReviewEvent(taskId, a2.id, 552, "reject", verificationSeq),
    ],
    verification: passedVerification,
  };

  assert.equal(classifyFinalDeliveryOutcome(item), "not-accepted");
  assert.equal(resolveCurrentMainDecision(item), "reject");

  const summary = computeStatistics([item])[0]!;
  assert.equal(summary.successCount, 1, "machine success remains visible");
  assert.equal(summary.acceptedDeliveryCount, 0, "reject is never accepted delivery");
  assert.equal(summary.acceptedDeliverySampleCount, 1);
  assert.equal(summary.acceptedDeliveryNotAcceptedCount, 1);
  assert.equal(summary.acceptedDeliveryUnavailableCount, 0);
  assert.equal(summary.acceptedDeliveryRate, 0);

  const map = deriveRoutingEvidence({
    taskClass: "reject-shape",
    history: [{
      ...item,
      task: {
        ...item.task,
        spec: { ...item.task.spec, taskClass: "reject-shape" } as TaskRecord["spec"],
      },
    }],
  });
  const ds = map.get("deepseek\0v4")!;
  assert.equal(ds.acceptedDeliveryCount, 0);
  assert.equal(ds.acceptedDeliverySampleCount, 1);
  assert.equal(ds.acceptedDeliveryNotAcceptedCount, 1);
  assert.equal(ds.acceptedDeliveryRate, 0);
  assert.equal(ds.relevantSampleCount, 1, "machine success remains relevant for other factors");
});

test("legacy current Main revise without revision-binding fields is comparable non-acceptance", () => {
  const taskId = "fd-legacy-revise";
  const a1 = attempt(taskId, 1, "succeeded");
  const verificationSeq = 20;
  const item: TaskEvidence = {
    task: { ...task(taskId, "succeeded"), currentAttemptId: a1.id },
    attempts: [a1],
    events: [
      verificationEvent(taskId, a1.id, verificationSeq, passedVerification),
      revisionEvent(taskId, a1.id, 21, "rev-legacy-revise", verificationSeq),
      // Both revision-binding fields absent — correction evidence only.
      mainReviewEvent(taskId, a1.id, 22, "revise", verificationSeq),
    ],
    verification: passedVerification,
  };

  assert.equal(resolveCurrentMainDecision(item), "revise");
  assert.equal(classifyFinalDeliveryOutcome(item), "not-accepted");
  const summary = computeStatistics([item])[0]!;
  assert.equal(summary.successCount, 1);
  assert.equal(summary.acceptedDeliveryCount, 0);
  assert.equal(summary.acceptedDeliverySampleCount, 1);
  assert.equal(summary.acceptedDeliveryNotAcceptedCount, 1);
  assert.equal(summary.acceptedDeliveryUnavailableCount, 0);
  assert.equal(summary.acceptedDeliveryRate, 0);
});

test("modern Main accept without the exact patch digest is unavailable", () => {
  const taskId = "fd-missing-digest";
  const a1 = attempt(taskId, 1, "succeeded");
  const verificationSeq = 10;
  const malformedReview = mainReviewEvent(
    taskId,
    a1.id,
    12,
    "accept",
    verificationSeq,
    { id: "rev-missing-digest", patchDigest: PATCH_DIGEST_A },
  );
  delete (malformedReview.payload as { acceptedPatchDigest?: string }).acceptedPatchDigest;
  const item: TaskEvidence = {
    task: { ...task(taskId, "succeeded"), currentAttemptId: a1.id },
    attempts: [a1],
    events: [
      verificationEvent(taskId, a1.id, verificationSeq, passedVerification),
      revisionEvent(taskId, a1.id, 11, "rev-missing-digest", verificationSeq),
      malformedReview,
    ],
    verification: passedVerification,
  };

  assert.equal(resolveCurrentMainDecision(item), undefined);
  assert.equal(classifyFinalDeliveryOutcome(item), "unavailable");
  const summary = computeStatistics([item])[0]!;
  assert.equal(summary.acceptedDeliveryCount, 0);
  assert.equal(summary.acceptedDeliverySampleCount, 0);
  assert.equal(summary.acceptedDeliveryUnavailableCount, 1);
});

test("legacy accept without revision-binding fields never becomes acceptance authority", () => {
  // Accept must stay fail-closed: both fields absent cannot authorize accept
  // when revision history exists, even if Attempt + verification match.
  const taskId = "fd-legacy-accept-unbound";
  const a1 = attempt(taskId, 1, "succeeded");
  const verificationSeq = 30;
  const item: TaskEvidence = {
    task: { ...task(taskId, "succeeded"), currentAttemptId: a1.id },
    attempts: [a1],
    events: [
      verificationEvent(taskId, a1.id, verificationSeq, passedVerification),
      revisionEvent(taskId, a1.id, 31, "rev-legacy-accept", verificationSeq),
      mainReviewEvent(taskId, a1.id, 32, "accept", verificationSeq),
    ],
    verification: passedVerification,
  };

  assert.equal(resolveCurrentMainDecision(item), undefined);
  assert.equal(classifyFinalDeliveryOutcome(item), "unavailable");
});

test("partial or mismatched negative revision bindings stay unavailable", () => {
  const verificationSeq = 40;

  // Reject with only revision id (digest absent) — malformed partial.
  const partialIdTask = "fd-neg-partial-id";
  const partialIdAttempt = attempt(partialIdTask, 1, "succeeded");
  const partialIdReview = mainReviewEvent(
    partialIdTask,
    partialIdAttempt.id,
    42,
    "reject",
    verificationSeq,
    { id: "rev-partial-id", patchDigest: PATCH_DIGEST_A },
  );
  delete (partialIdReview.payload as { acceptedPatchDigest?: string }).acceptedPatchDigest;
  const partialId: TaskEvidence = {
    task: { ...task(partialIdTask, "succeeded"), currentAttemptId: partialIdAttempt.id },
    attempts: [partialIdAttempt],
    events: [
      verificationEvent(partialIdTask, partialIdAttempt.id, verificationSeq, passedVerification),
      revisionEvent(partialIdTask, partialIdAttempt.id, 41, "rev-partial-id", verificationSeq),
      partialIdReview,
    ],
    verification: passedVerification,
  };

  // Revise with only digest (revision id absent) — malformed partial.
  const partialDigestTask = "fd-neg-partial-digest";
  const partialDigestAttempt = attempt(partialDigestTask, 1, "succeeded");
  const partialDigestReview = mainReviewEvent(
    partialDigestTask,
    partialDigestAttempt.id,
    42,
    "revise",
    verificationSeq,
    { id: "rev-partial-digest", patchDigest: PATCH_DIGEST_A },
  );
  delete (partialDigestReview.payload as { candidateRevisionId?: string }).candidateRevisionId;
  const partialDigest: TaskEvidence = {
    task: {
      ...task(partialDigestTask, "succeeded"),
      currentAttemptId: partialDigestAttempt.id,
    },
    attempts: [partialDigestAttempt],
    events: [
      verificationEvent(
        partialDigestTask,
        partialDigestAttempt.id,
        verificationSeq,
        passedVerification,
      ),
      revisionEvent(
        partialDigestTask,
        partialDigestAttempt.id,
        41,
        "rev-partial-digest",
        verificationSeq,
      ),
      partialDigestReview,
    ],
    verification: passedVerification,
  };

  // Reject with both fields present but wrong revision id — stale/mismatched.
  const mismatchIdTask = "fd-neg-mismatch-id";
  const mismatchIdAttempt = attempt(mismatchIdTask, 1, "succeeded");
  const mismatchId: TaskEvidence = {
    task: { ...task(mismatchIdTask, "succeeded"), currentAttemptId: mismatchIdAttempt.id },
    attempts: [mismatchIdAttempt],
    events: [
      verificationEvent(mismatchIdTask, mismatchIdAttempt.id, verificationSeq, passedVerification),
      revisionEvent(mismatchIdTask, mismatchIdAttempt.id, 41, "rev-current", verificationSeq),
      mainReviewEvent(mismatchIdTask, mismatchIdAttempt.id, 42, "reject", verificationSeq, {
        id: "rev-stale",
        patchDigest: PATCH_DIGEST_A,
      }),
    ],
    verification: passedVerification,
  };

  // Revise with both fields present but wrong digest — stale/mismatched.
  const mismatchDigestTask = "fd-neg-mismatch-digest";
  const mismatchDigestAttempt = attempt(mismatchDigestTask, 1, "succeeded");
  const mismatchDigest: TaskEvidence = {
    task: {
      ...task(mismatchDigestTask, "succeeded"),
      currentAttemptId: mismatchDigestAttempt.id,
    },
    attempts: [mismatchDigestAttempt],
    events: [
      verificationEvent(
        mismatchDigestTask,
        mismatchDigestAttempt.id,
        verificationSeq,
        passedVerification,
      ),
      revisionEvent(
        mismatchDigestTask,
        mismatchDigestAttempt.id,
        41,
        "rev-digest-current",
        verificationSeq,
      ),
      mainReviewEvent(
        mismatchDigestTask,
        mismatchDigestAttempt.id,
        42,
        "revise",
        verificationSeq,
        { id: "rev-digest-current", patchDigest: PATCH_DIGEST_B },
      ),
    ],
    verification: passedVerification,
  };

  // Reject bound to an older Attempt while a newer Attempt is current — stale.
  const staleAttemptTask = "fd-neg-stale-attempt";
  const staleA1 = attempt(staleAttemptTask, 1, "succeeded");
  const staleA2 = attempt(staleAttemptTask, 2, "succeeded");
  const staleAttempt: TaskEvidence = {
    task: { ...task(staleAttemptTask, "succeeded"), currentAttemptId: staleA2.id },
    attempts: [staleA1, staleA2],
    events: [
      verificationEvent(staleAttemptTask, staleA1.id, 5, passedVerification),
      verificationEvent(staleAttemptTask, staleA2.id, 15, passedVerification),
      revisionEvent(staleAttemptTask, staleA2.id, 16, "rev-stale-neg", 15, PATCH_DIGEST_B),
      mainReviewEvent(staleAttemptTask, staleA1.id, 17, "reject", 5),
    ],
    verification: passedVerification,
  };

  for (const item of [partialId, partialDigest, mismatchId, mismatchDigest, staleAttempt]) {
    assert.equal(
      resolveCurrentMainDecision(item),
      undefined,
      `expected unavailable current decision for ${item.task.id}`,
    );
    assert.equal(
      classifyFinalDeliveryOutcome(item),
      "unavailable",
      `expected unavailable final delivery for ${item.task.id}`,
    );
  }

  const summary = computeStatistics([
    partialId,
    partialDigest,
    mismatchId,
    mismatchDigest,
    staleAttempt,
  ])[0]!;
  assert.equal(summary.successCount, 5, "machine success unchanged");
  assert.equal(summary.acceptedDeliveryCount, 0);
  assert.equal(summary.acceptedDeliverySampleCount, 0);
  assert.equal(summary.acceptedDeliveryNotAcceptedCount, 0);
  assert.equal(summary.acceptedDeliveryUnavailableCount, 5);
});

test("final-delivery outcomes cover accept, revise, no review, stale, remediation, integration, overlap", () => {
  const accepted = boundAcceptEvidence("fd-accept");

  const reviseA = attempt("fd-revise", 1, "succeeded");
  const revise: TaskEvidence = {
    task: { ...task("fd-revise", "succeeded"), currentAttemptId: reviseA.id },
    attempts: [reviseA],
    events: [
      verificationEvent("fd-revise", reviseA.id, 10, passedVerification),
      revisionEvent("fd-revise", reviseA.id, 11, "rev-revise", 10),
      mainReviewEvent("fd-revise", reviseA.id, 12, "revise", 10, {
        id: "rev-revise",
        patchDigest: PATCH_DIGEST_A,
      }),
    ],
    verification: passedVerification,
  };

  const noReview: TaskEvidence = {
    task: task("fd-noreview", "succeeded"),
    attempts: [attempt("fd-noreview", 1, "succeeded")],
    events: [verificationEvent("fd-noreview", "fd-noreview-1", 1, passedVerification)],
    verification: passedVerification,
  };

  const staleA1 = attempt("fd-stale", 1, "succeeded");
  const staleA2 = attempt("fd-stale", 2, "succeeded");
  const stale: TaskEvidence = {
    task: { ...task("fd-stale", "succeeded"), currentAttemptId: staleA2.id },
    attempts: [staleA1, staleA2],
    events: [
      verificationEvent("fd-stale", staleA1.id, 5, passedVerification),
      verificationEvent("fd-stale", staleA2.id, 15, passedVerification),
      revisionEvent("fd-stale", staleA2.id, 16, "rev-stale-new", 15, PATCH_DIGEST_B),
      // Accept is bound to the earlier Attempt — stale against current Candidate.
      mainReviewEvent("fd-stale", staleA1.id, 17, "accept", 5, {
        id: "rev-stale-old",
        patchDigest: PATCH_DIGEST_A,
      }),
    ],
    verification: passedVerification,
  };

  const remediationOnly: TaskEvidence = {
    task: task("fd-remediation", "failed", "deepseek", "v4", "verification failed"),
    attempts: [attempt("fd-remediation", 1, "failed")],
    events: [],
    verification: failedVerification,
  };

  const legacyIntegration: TaskEvidence = {
    task: task("fd-integration", "succeeded"),
    attempts: [attempt("fd-integration", 1, "succeeded")],
    events: [verificationEvent("fd-integration", "fd-integration-1", 1, passedVerification)],
    verification: passedVerification,
  };

  const overlap: TaskEvidence = boundAcceptEvidence("fd-overlap");

  const modelFail: TaskEvidence = {
    task: task("fd-modelfail", "failed"),
    attempts: [attempt("fd-modelfail", 1, "failed")],
    events: [],
    verification: failedVerification,
  };

  assert.equal(classifyFinalDeliveryOutcome(accepted), "accepted");
  assert.equal(classifyFinalDeliveryOutcome(revise), "not-accepted");
  assert.equal(classifyFinalDeliveryOutcome(noReview), "unavailable");
  assert.equal(classifyFinalDeliveryOutcome(stale), "unavailable");
  assert.equal(
    classifyFinalDeliveryOutcome(remediationOnly, {
      hasPassingDisposition: () => true,
    }),
    "accepted",
  );
  assert.equal(
    classifyFinalDeliveryOutcome(legacyIntegration, {
      hasAppliedIntegration: (id) => id === "fd-integration",
    }),
    "accepted",
  );
  assert.equal(
    classifyFinalDeliveryOutcome(overlap, {
      hasPassingDisposition: () => true,
      hasAppliedIntegration: () => true,
    }),
    "accepted",
  );
  assert.equal(classifyFinalDeliveryOutcome(modelFail), "not-accepted");

  // Current Main reject after applied Integration is contradictory non-acceptance.
  const integThenReject = boundAcceptEvidence("fd-integ-reject");
  // Rewrite the current decision to reject while Integration remains applied.
  const rejectEvents = integThenReject.events.map((event) =>
    event.type === "main-review.completed"
      ? mainReviewEvent(
          "fd-integ-reject",
          integThenReject.attempts[0]!.id,
          event.sequence,
          "reject",
          10,
          { id: "rev-fd-integ-reject", patchDigest: PATCH_DIGEST_A },
        )
      : event);
  assert.equal(
    classifyFinalDeliveryOutcome(
      { ...integThenReject, events: rejectEvents },
      { hasAppliedIntegration: () => true },
    ),
    "not-accepted",
  );

  const summary = computeStatistics(
    [accepted, revise, noReview, stale, remediationOnly, legacyIntegration, overlap, modelFail],
    {},
    {
      checksCount: (taskId) =>
        taskId === "fd-remediation" || taskId === "fd-overlap" ? 1 : 0,
      hasPassingDisposition: (taskId) =>
        taskId === "fd-remediation" || taskId === "fd-overlap",
      hasAppliedIntegration: (taskId) => taskId === "fd-integration",
    },
  )[0]!;
  // accepted: accept, remediation, integration, overlap = 4
  // not-accepted: revise, model-fail = 2
  // unavailable: no-review, stale = 2
  assert.equal(summary.acceptedDeliveryCount, 4);
  assert.equal(summary.acceptedDeliveryNotAcceptedCount, 2);
  assert.equal(summary.acceptedDeliveryUnavailableCount, 2);
  assert.equal(summary.acceptedDeliverySampleCount, 6);
  assert.equal(summary.acceptedDeliveryRate, 4 / 6);
  assert.equal(summary.mainRepairedDeliveryCount, 2);
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
  // Machine success alone is unavailable final delivery, not accepted.
  assert.equal(ds.acceptedDeliveryCount, 0);
  assert.equal(ds.acceptedDeliverySampleCount, 0);
  assert.equal(ds.acceptedDeliveryUnavailableCount, 2);

  const qw = evidence.get("qwen\0plus")!;
  assert.ok(qw);
  assert.equal(qw.relevantSampleCount, 1);
  assert.equal(qw.acceptedDeliveryCount, 0);
  assert.equal(qw.acceptedDeliveryUnavailableCount, 1);
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

test("full Worker identity evidence does not merge different effort levels", () => {
  const high = task("identity-high", "succeeded", "deepseek", "v4");
  const max = task("identity-max", "succeeded", "deepseek", "v4");
  (high.spec as unknown as Record<string, unknown>).taskClass = "identity-test";
  (max.spec as unknown as Record<string, unknown>).taskClass = "identity-test";
  (high.spec as unknown as Record<string, unknown>).runtime = { name: "claude-code", effort: "high" };
  (max.spec as unknown as Record<string, unknown>).runtime = { name: "claude-code", effort: "max" };
  const evidence = deriveRoutingEvidence({
    taskClass: "identity-test",
    identityMode: "full-worker",
    history: [
      { task: high, attempts: [attempt(high.id, 1, "succeeded")], events: [] },
      { task: max, attempts: [attempt(max.id, 1, "succeeded")], events: [] },
    ],
  });
  assert.equal(evidence.get("deepseek\0v4\0claude-code\0high")!.terminalTaskCount, 1);
  assert.equal(evidence.get("deepseek\0v4\0claude-code\0max")!.terminalTaskCount, 1);
});

test("amended-acceptance delivery keeps machine failure but not model-quality blame", () => {
  const t1 = task("amended-1", "failed", "deepseek", "v4");
  (t1.spec as unknown as Record<string, unknown>).taskClass = "amended-class";
  const evidence = deriveRoutingEvidence({
    taskClass: "amended-class",
    history: [
      {
        task: t1,
        attempts: [attempt("amended-1", 1, "failed")],
        events: [],
        verification: failedVerification,
      },
    ],
    hasPassingDisposition: () => true,
    getDisposition: () => ({
      status: "verified-repaired-delivered",
      checkId: "check-amended",
      createdAt: "2026-07-26T00:00:00.000Z",
      acceptanceBasis: "amended-acceptance",
      amendedCommandCount: 1,
      reasonCode: "contradictory-acceptance",
    }),
  });

  const ds = evidence.get("deepseek\0v4")!;
  assert.equal(ds.terminalTaskCount, 1);
  assert.equal(ds.acceptedDeliveryCount, 1, "Main-repaired delivery counted");
  assert.equal(ds.modelQualityFailureCount, 0, "amended acceptance is not model-quality failure");
  assert.equal(
    ds.ignoredNonModelFailures["contract-infeasible"],
    1,
    "amended delivery is contract-infeasible non-model evidence",
  );
  assert.equal(ds.ignoredNonModelFailures["verification"], undefined,
    "must not remain model-quality verification category");
  assert.equal(ds.relevantSampleCount, 1);
  // Original-acceptance repaired delivery still counts as model-quality when
  // the underlying verification failure was model behavior.
  const original = deriveRoutingEvidence({
    taskClass: "amended-class",
    history: [
      {
        task: t1,
        attempts: [attempt("amended-1", 1, "failed")],
        events: [],
        verification: failedVerification,
      },
    ],
    hasPassingDisposition: () => true,
    getDisposition: () => ({
      status: "verified-repaired-delivered",
      checkId: "check-original",
      createdAt: "2026-07-26T00:00:00.000Z",
      acceptanceBasis: "original-acceptance",
    }),
  });
  const od = original.get("deepseek\0v4")!;
  assert.equal(od.modelQualityFailureCount, 1);
  assert.equal(od.acceptedDeliveryCount, 1);
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

test("durable connectivity is Provider/infrastructure non-model evidence", () => {
  const safeError =
    "Worker could not reach the Provider service due to a network connectivity failure";
  const t = task("conn-1", "failed", "xai", "grok-4.5", safeError);
  (t.spec as unknown as Record<string, unknown>).taskClass = "conn-routing";
  const a = { ...attempt("conn-1", 1, "failed", undefined, undefined, 1), error: safeError };
  const history: TaskEvidence[] = [{
    task: t,
    attempts: [a],
    events: [workerFailedEvent(t.id, a.id, 1, "connectivity")],
  }];

  const summary = computeStatistics(history)[0]!;
  assert.equal(summary.failureDistribution.provider, 1);
  assert.equal(summary.failures[0]?.impact, "non-model");
  assert.equal(summary.failures[0]?.category, "provider");
  assert.equal(summary.failures[0]?.diagnostic, safeError);

  const routing = deriveRoutingEvidence({
    taskClass: "conn-routing",
    history,
  });
  const evidence = routing.get("xai\0grok-4.5")!;
  assert.equal(evidence.modelQualityFailureCount, 0);
  assert.equal(evidence.relevantSampleCount, 0);
  assert.equal(evidence.ignoredNonModelFailures.provider, 1);
  assert.equal(evidence.ignoredNonModelTaskCount, 1);
});

test("safe connectivity diagnostic classifies as non-model provider without raw transport text", () => {
  const classified = classifyFailure({
    taskStatus: "failed",
    error: "Worker could not reach the Provider service due to a network connectivity failure",
  });
  assert.equal(classified.category, "provider");
  assert.equal(classified.impact, "non-model");
  assert.equal(failureImpactForCategory("provider"), "non-model");
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

// --- First-pass verified success (Attempt one only) --------------------------

test("first-pass success counts only Attempt one own verification", () => {
  const t1 = task("fp-ok", "succeeded");
  (t1.spec as unknown as Record<string, unknown>).taskClass = "first-pass";
  const a1 = attempt("fp-ok", 1, "succeeded");
  const map = deriveRoutingEvidence({
    taskClass: "first-pass",
    history: [{
      task: t1,
      attempts: [a1],
      events: [verificationEvent("fp-ok", a1.id, 1, passedVerification)],
      verification: passedVerification,
    }],
  });
  const ds = map.get("deepseek\0v4")!;
  assert.equal(ds.firstPassVerifiedSampleCount, 1);
  assert.equal(ds.firstPassVerifiedSuccessCount, 1);
  assert.equal(ds.firstPassVerifiedSuccessRate, 1);
  assert.equal(ds.firstPassUnavailableCount, 0);
  assert.equal(ds.acceptedDeliveryCount, 0, "machine success alone is not accepted delivery");
  assert.equal(ds.acceptedDeliveryUnavailableCount, 1);
});

test("first-pass zero-of-one when Attempt one fails and a later Attempt delivers", () => {
  const t1 = task("fp-retry", "succeeded");
  (t1.spec as unknown as Record<string, unknown>).taskClass = "first-pass-retry";
  const first = attempt("fp-retry", 1, "failed");
  const second = attempt("fp-retry", 2, "succeeded");
  const map = deriveRoutingEvidence({
    taskClass: "first-pass-retry",
    history: [{
      task: t1,
      attempts: [first, second],
      events: [
        verificationEvent("fp-retry", first.id, 1, failedVerification),
        verificationEvent("fp-retry", second.id, 2, passedVerification),
      ],
      // Task-level verification is the later pass — must not rewrite first-pass.
      verification: passedVerification,
    }],
  });
  const ds = map.get("deepseek\0v4")!;
  assert.equal(ds.firstPassVerifiedSampleCount, 1);
  assert.equal(ds.firstPassVerifiedSuccessCount, 0);
  assert.equal(ds.firstPassVerifiedSuccessRate, 0);
  assert.equal(ds.firstPassUnavailableCount, 0);
  assert.equal(ds.acceptedDeliveryCount, 0, "machine success alone is not final delivery");
  assert.equal(ds.acceptedDeliveryUnavailableCount, 1);
  assert.equal(ds.verifiedBehaviorCount, 1, "eventual verified behavior still counts");
});

test("first-pass excludes credential and external Attempt-one failures as unavailable", () => {
  const auth = task("fp-auth", "failed", "deepseek", "v4", "HTTP 401: Invalid API key");
  (auth.spec as unknown as Record<string, unknown>).taskClass = "first-pass-ext";
  const provider = task("fp-provider", "failed", "deepseek", "v4");
  (provider.spec as unknown as Record<string, unknown>).taskClass = "first-pass-ext";
  const providerAttempt = attempt("fp-provider", 1, "failed");
  const map = deriveRoutingEvidence({
    taskClass: "first-pass-ext",
    history: [
      {
        task: auth,
        attempts: [attempt("fp-auth", 1, "failed", undefined, undefined, 1)],
        events: [],
      },
      {
        task: provider,
        attempts: [providerAttempt],
        events: [
          workerFailedEvent(provider.id, providerAttempt.id, 1, "connectivity"),
          verificationEvent(provider.id, providerAttempt.id, 2, passedVerification),
        ],
        verification: passedVerification,
      },
    ],
  });
  const ds = map.get("deepseek\0v4")!;
  assert.equal(ds.firstPassVerifiedSampleCount, 0);
  assert.equal(ds.firstPassVerifiedSuccessCount, 0);
  assert.equal(ds.firstPassUnavailableCount, 2);
  assert.equal(ds.firstPassVerifiedSuccessRate, 0);
  assert.equal(ds.ignoredNonModelFailures.credential, 1);
  assert.equal(ds.ignoredNonModelFailures.provider, 1);
});

test("first-pass excludes missing verification rather than synthetic failure", () => {
  const t1 = task("fp-missing", "succeeded");
  (t1.spec as unknown as Record<string, unknown>).taskClass = "first-pass-missing";
  const map = deriveRoutingEvidence({
    taskClass: "first-pass-missing",
    history: [{
      task: t1,
      attempts: [attempt("fp-missing", 1, "succeeded")],
      events: [],
      // Task-level verification without attempt binding is not first-pass evidence.
      verification: passedVerification,
    }],
  });
  const ds = map.get("deepseek\0v4")!;
  assert.equal(ds.firstPassVerifiedSampleCount, 0);
  assert.equal(ds.firstPassUnavailableCount, 1);
  assert.equal(ds.acceptedDeliveryCount, 0);
  assert.equal(ds.acceptedDeliveryUnavailableCount, 1);
});

test("first-pass excludes policy-only verification failure from the failure denominator", () => {
  const policyOnly: VerificationResult = {
    ...passedVerification,
    passed: false,
    policyPassed: false,
    changeBudget: {
      filesChanged: 12,
      changedLines: 500,
      maxFiles: 8,
      maxDiffLines: 400,
      withinBudget: false,
      mode: "hard",
      effect: "hard-fail",
    },
  };
  const t1 = task("fp-policy", "failed");
  (t1.spec as unknown as Record<string, unknown>).taskClass = "first-pass-policy";
  const a1 = attempt("fp-policy", 1, "failed");
  const map = deriveRoutingEvidence({
    taskClass: "first-pass-policy",
    history: [{
      task: t1,
      attempts: [a1],
      events: [verificationEvent("fp-policy", a1.id, 1, policyOnly)],
      verification: policyOnly,
    }],
  });
  const ds = map.get("deepseek\0v4")!;
  // behaviorPassed true → first-pass success, not failure or unavailable.
  assert.equal(ds.firstPassVerifiedSampleCount, 1);
  assert.equal(ds.firstPassVerifiedSuccessCount, 1);
  assert.equal(ds.firstPassUnavailableCount, 0);
  assert.equal(ds.modelQualityFailureCount, 0);
});

test("first-pass excludes formally amended acceptance from model evidence", () => {
  const t1 = task("fp-amended", "failed");
  (t1.spec as unknown as Record<string, unknown>).taskClass = "first-pass-amended";
  const a1 = attempt("fp-amended", 1, "failed");
  const map = deriveRoutingEvidence({
    taskClass: "first-pass-amended",
    history: [{
      task: t1,
      attempts: [a1],
      events: [verificationEvent("fp-amended", a1.id, 1, failedVerification)],
      verification: failedVerification,
    }],
    hasPassingDisposition: () => true,
    getDisposition: () => ({
      status: "verified-repaired-delivered",
      checkId: "check-amended",
      createdAt: "2026-07-26T00:00:00.000Z",
      acceptanceBasis: "amended-acceptance",
      amendedCommandCount: 1,
      reasonCode: "contradictory-acceptance",
    }),
  });
  const ds = map.get("deepseek\0v4")!;
  assert.equal(ds.firstPassVerifiedSampleCount, 0);
  assert.equal(ds.firstPassVerifiedSuccessCount, 0);
  assert.equal(ds.firstPassUnavailableCount, 1);
  assert.equal(ds.acceptedDeliveryCount, 1, "remediation remains accepted final delivery");
  assert.equal(ds.modelQualityFailureCount, 0);
});

test("first-pass never borrows a later Attempt verification for Attempt one", () => {
  const t1 = task("fp-borrow", "succeeded");
  (t1.spec as unknown as Record<string, unknown>).taskClass = "first-pass-borrow";
  const first = attempt("fp-borrow", 1, "failed");
  const second = attempt("fp-borrow", 2, "succeeded");
  const map = deriveRoutingEvidence({
    taskClass: "first-pass-borrow",
    history: [{
      task: t1,
      attempts: [first, second],
      // Only Attempt two has verification — Attempt one stays unavailable.
      events: [verificationEvent("fp-borrow", second.id, 2, passedVerification)],
      verification: passedVerification,
    }],
  });
  const ds = map.get("deepseek\0v4")!;
  assert.equal(ds.firstPassVerifiedSampleCount, 0);
  assert.equal(ds.firstPassVerifiedSuccessCount, 0);
  assert.equal(ds.firstPassUnavailableCount, 1);
  assert.equal(ds.acceptedDeliveryCount, 0);
  assert.equal(ds.acceptedDeliveryUnavailableCount, 1);
});

test("first-pass keeps original Worker failure when same Attempt later passes Main reverification", () => {
  // Live pattern: Attempt one fails independent behavior verification, then Main
  // repairs the retained Candidate and reverifies the same Attempt without a
  // Worker. Final delivery may pass; first-pass must stay zero of one.
  const t1 = task("fp-reverify-repair", "succeeded");
  (t1.spec as unknown as Record<string, unknown>).taskClass = "first-pass-reverify";
  const a1 = attempt("fp-reverify-repair", 1, "succeeded");
  const map = deriveRoutingEvidence({
    taskClass: "first-pass-reverify",
    history: [{
      task: t1,
      attempts: [a1],
      // Deliberately put the later pass first in the array so selection must use
      // durable sequence order, not array accident.
      events: [
        verificationEvent("fp-reverify-repair", a1.id, 20, passedVerification),
        verificationEvent("fp-reverify-repair", a1.id, 10, failedVerification),
      ],
      // Task-level latest verification is the Main reverify pass.
      verification: passedVerification,
    }],
    hasPassingDisposition: () => true,
  });
  const ds = map.get("deepseek\0v4")!;
  assert.equal(ds.firstPassVerifiedSampleCount, 1);
  assert.equal(ds.firstPassVerifiedSuccessCount, 0);
  assert.equal(ds.firstPassVerifiedSuccessRate, 0);
  assert.equal(ds.firstPassUnavailableCount, 0);
  assert.equal(ds.acceptedDeliveryCount, 1, "remediation disposition remains accepted delivery");
  assert.equal(ds.verifiedBehaviorCount, 1, "latest verification still drives final behavior view");
});

test("first-pass keeps original Worker success when a later same-Attempt record is non-passing", () => {
  const t1 = task("fp-reverify-stable", "succeeded");
  (t1.spec as unknown as Record<string, unknown>).taskClass = "first-pass-reverify-stable";
  const a1 = attempt("fp-reverify-stable", 1, "succeeded");
  const map = deriveRoutingEvidence({
    taskClass: "first-pass-reverify-stable",
    history: [{
      task: t1,
      attempts: [a1],
      // Later non-passing record must not erase the original first-pass success.
      events: [
        verificationEvent("fp-reverify-stable", a1.id, 5, passedVerification),
        verificationEvent("fp-reverify-stable", a1.id, 15, failedVerification),
      ],
      verification: failedVerification,
    }],
  });
  const ds = map.get("deepseek\0v4")!;
  assert.equal(ds.firstPassVerifiedSampleCount, 1);
  assert.equal(ds.firstPassVerifiedSuccessCount, 1);
  assert.equal(ds.firstPassVerifiedSuccessRate, 1);
  assert.equal(ds.firstPassUnavailableCount, 0);
  assert.equal(ds.acceptedDeliveryCount, 0, "machine success alone is not accepted delivery");
  assert.equal(ds.acceptedDeliveryUnavailableCount, 1);
});

// --- Routing-evidence coverage -----------------------------------------------

function completeRoutingDecision(
  overrides: Partial<RoutingDecisionSnapshot> = {},
): RoutingDecisionSnapshot {
  const worker = {
    provider: "xai",
    model: "grok-4.5",
    runtime: "grok-build",
    effort: "high",
    workerProfileId: "local-grok-builder",
  };
  return {
    taskFamily: "hub-explainability",
    shortlist: [worker],
    selectedWorker: worker,
    selectedBecause: {
      code: "user-specified",
      note: "private Main reason that must never appear in coverage output",
    },
    competition: { intent: "none", triggers: [] },
    evidenceSnapshot: { scope: "none", exactSampleCounts: {} },
    ...overrides,
  };
}

function coverageTask(
  id: string,
  status: TaskRecord["status"],
  options: {
    taskFile?: string;
    taskClass?: string;
    taskFamily?: string;
    routingDecision?: RoutingDecisionSnapshot | Record<string, unknown>;
  } = {},
): TaskRecord {
  const base = task(id, status);
  return {
    ...base,
    taskFile: options.taskFile ?? base.taskFile,
    spec: {
      ...base.spec,
      ...(options.taskClass === undefined ? {} : { taskClass: options.taskClass }),
      ...(options.taskFamily === undefined ? {} : { taskFamily: options.taskFamily }),
      ...(options.routingDecision === undefined
        ? {}
        : { routingDecision: options.routingDecision as RoutingDecisionSnapshot }),
    } as TaskRecord["spec"],
  };
}

test("routing-evidence coverage is empty when no eligible terminal Tasks exist", () => {
  const coverage = computeRoutingEvidenceCoverage([
    coverageTask("running", "running", {
      taskClass: "hub-routing-evidence-coverage",
      taskFamily: "hub-explainability",
      routingDecision: completeRoutingDecision(),
    }),
  ]);
  assert.deepEqual(coverage, {
    eligibleTerminalTaskCount: 0,
    withTaskClassCount: 0,
    withTaskFamilyCount: 0,
    withCompleteRoutingDecisionCount: 0,
    distinctTaskClassCount: 0,
    distinctTaskFamilyCount: 0,
  });
});

test("routing-evidence coverage counts legacy, partial, and complete ordinary Tasks", () => {
  const legacy = coverageTask("legacy", "succeeded");
  const classOnly = coverageTask("class-only", "failed", {
    taskClass: "hub-routing-evidence-coverage",
  });
  const familyOnly = coverageTask("family-only", "interrupted", {
    taskFamily: "hub-explainability",
  });
  const classAndFamilyNoDecision = coverageTask("class-family-only", "succeeded", {
    taskClass: "hub-routing-evidence-coverage",
    taskFamily: "hub-explainability",
  });
  const complete = coverageTask("complete", "succeeded", {
    taskClass: "hub-routing-evidence-coverage",
    taskFamily: "hub-explainability",
    routingDecision: completeRoutingDecision(),
  });
  const otherClass = coverageTask("other-class", "succeeded", {
    taskClass: "other-class",
    taskFamily: "other-family",
    routingDecision: completeRoutingDecision({
      taskFamily: "other-family",
      selectedBecause: { code: "main-judgment", note: "another private note" },
    }),
  });

  const coverage = computeRoutingEvidenceCoverage([
    legacy, classOnly, familyOnly, classAndFamilyNoDecision, complete, otherClass,
  ]);
  assert.equal(coverage.eligibleTerminalTaskCount, 6);
  assert.equal(coverage.withTaskClassCount, 4);
  assert.equal(coverage.withTaskFamilyCount, 4);
  // Complete requires class + family + stored routingDecision on the same Task.
  assert.equal(coverage.withCompleteRoutingDecisionCount, 2);
  assert.equal(coverage.distinctTaskClassCount, 2);
  assert.equal(coverage.distinctTaskFamilyCount, 2);

  const json = JSON.stringify(coverage);
  assert.ok(!json.includes("private Main reason"));
  assert.ok(!json.includes("another private note"));
  assert.ok(!json.includes("/tasks/"));
  assert.ok(!json.includes("local-grok-builder"));
  assert.ok(!json.includes("hub-routing-evidence-coverage"));
});

test("complete coverage requires taskClass, taskFamily, and stored routingDecision together", () => {
  const decisionOnly = coverageTask("decision-only", "succeeded", {
    routingDecision: completeRoutingDecision(),
  });
  const decisionMissingFamily = coverageTask("decision-no-family", "succeeded", {
    taskClass: "hub-routing-evidence-coverage",
    routingDecision: completeRoutingDecision(),
  });
  const decisionMissingClass = coverageTask("decision-no-class", "succeeded", {
    taskFamily: "hub-explainability",
    routingDecision: completeRoutingDecision(),
  });
  const labelsOnly = coverageTask("labels-only", "succeeded", {
    taskClass: "hub-routing-evidence-coverage",
    taskFamily: "hub-explainability",
  });
  const complete = coverageTask("complete-all", "succeeded", {
    taskClass: "hub-routing-evidence-coverage",
    taskFamily: "hub-explainability",
    routingDecision: completeRoutingDecision(),
  });

  const coverage = computeRoutingEvidenceCoverage([
    decisionOnly,
    decisionMissingFamily,
    decisionMissingClass,
    labelsOnly,
    complete,
  ]);
  assert.equal(coverage.eligibleTerminalTaskCount, 5);
  assert.equal(coverage.withTaskClassCount, 3, "class present on three Tasks");
  assert.equal(coverage.withTaskFamilyCount, 3, "family present on three Tasks");
  assert.equal(
    coverage.withCompleteRoutingDecisionCount,
    1,
    "valid routingDecision without both labels must not inflate complete count",
  );
  assert.equal(coverage.distinctTaskClassCount, 1);
  assert.equal(coverage.distinctTaskFamilyCount, 1);
});

test("routing-evidence coverage excludes Review Graph reviewer Tasks", () => {
  const ordinary = coverageTask("ordinary", "succeeded", {
    taskClass: "hub-routing-evidence-coverage",
    taskFamily: "hub-explainability",
    routingDecision: completeRoutingDecision(),
  });
  const reviewer = coverageTask("reviewer", "succeeded", {
    taskFile: `${REVIEW_GRAPH_TASK_FILE_PREFIX}graph-1/assignment-1`,
    taskClass: "review-graph-reviewer",
    taskFamily: "review-graph",
    routingDecision: completeRoutingDecision({
      taskFamily: "review-graph",
      selectedBecause: {
        code: "reviewer-identity",
        note: "reviewer private reason must never inflate ordinary coverage",
      },
    }),
  });

  const coverage = computeRoutingEvidenceCoverage([ordinary, reviewer]);
  assert.equal(coverage.eligibleTerminalTaskCount, 1);
  assert.equal(coverage.withTaskClassCount, 1);
  assert.equal(coverage.withTaskFamilyCount, 1);
  assert.equal(coverage.withCompleteRoutingDecisionCount, 1);
  assert.equal(coverage.distinctTaskClassCount, 1);
  assert.equal(coverage.distinctTaskFamilyCount, 1);
});

test("StatisticsService.routingEvidenceCoverage is read-only over durable Tasks", () => {
  const home = mkdtempSync(path.join(tmpdir(), "forklight-rec-stats-"));
  try {
    const store = new StateStore(home);
    const TS = "2026-07-30T12:00:00.000Z";
    const makeSpec = (opts: {
      taskClass?: string;
      taskFamily?: string;
      routingDecision?: RoutingDecisionSnapshot;
    }) => ({
      version: 2 as const,
      name: "rec",
      project: "/tmp/proj",
      provider: {
        name: "xai", model: "grok-4.5",
        endpoint: "https://api.x.ai", keychainService: "fk",
      },
      runtime: {
        name: "grok-build" as const, executable: "grok",
        effort: "high" as const, maxBudgetUsd: 1,
      },
      workspace: { exclude: [] as string[] },
      worker: { allowEdits: true, allowedCommands: [] as string[], focusPaths: [] as string[] },
      contract: {
        outcome: "o", context: [] as string[], inScope: [] as string[],
        outOfScope: [] as string[], executionSteps: [] as string[],
        deliverables: [] as string[], modules: [], callChain: [] as string[],
        scenarios: [], risks: [] as string[],
        changeBudget: { maxFiles: 1, maxDiffLines: 10 },
      },
      acceptance: { criteria: [] as string[], commands: ["true"] },
      ...(opts.taskClass === undefined ? {} : { taskClass: opts.taskClass }),
      ...(opts.taskFamily === undefined ? {} : { taskFamily: opts.taskFamily }),
      ...(opts.routingDecision === undefined ? {} : { routingDecision: opts.routingDecision }),
    });

    store.createTask({
      id: "rec-legacy", name: "rec-legacy", status: "succeeded",
      sourcePath: "/tmp/src", taskFile: "/tmp/rec-legacy.yaml",
      spec: makeSpec({}),
      paths: {
        root: "/x", baseline: "/x", workspace: "/x",
        logs: "/x", claudeConfig: "/x", diff: "/x",
      },
      sessionId: "s-legacy", createdAt: TS, updatedAt: TS,
    } as TaskRecord);
    store.createTask({
      id: "rec-complete", name: "rec-complete", status: "succeeded",
      sourcePath: "/tmp/src", taskFile: "/tmp/rec-complete.yaml",
      spec: makeSpec({
        taskClass: "hub-routing-evidence-coverage",
        taskFamily: "hub-explainability",
        routingDecision: completeRoutingDecision(),
      }),
      paths: {
        root: "/x", baseline: "/x", workspace: "/x",
        logs: "/x", claudeConfig: "/x", diff: "/x",
      },
      sessionId: "s-complete", createdAt: TS, updatedAt: TS,
    } as TaskRecord);
    store.createTask({
      id: "rec-reviewer", name: "rec-reviewer", status: "succeeded",
      sourcePath: "/tmp/src",
      taskFile: `${REVIEW_GRAPH_TASK_FILE_PREFIX}g1/a1`,
      spec: makeSpec({
        taskClass: "review-graph-reviewer",
        taskFamily: "review-graph",
        routingDecision: completeRoutingDecision({ taskFamily: "review-graph" }),
      }),
      paths: {
        root: "/x", baseline: "/x", workspace: "/x",
        logs: "/x", claudeConfig: "/x", diff: "/x",
      },
      sessionId: "s-reviewer", createdAt: TS, updatedAt: TS,
    } as TaskRecord);

    const before = store.listTasks().length;
    const coverage = new StatisticsService(store).routingEvidenceCoverage();
    assert.equal(coverage.eligibleTerminalTaskCount, 2);
    assert.equal(coverage.withTaskClassCount, 1);
    assert.equal(coverage.withTaskFamilyCount, 1);
    assert.equal(coverage.withCompleteRoutingDecisionCount, 1);
    assert.equal(store.listTasks().length, before, "coverage must not mutate Task history");
    store.close();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
