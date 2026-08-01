import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ROUTING_POLICY,
  failureImpactFor,
  provideRoutingAdvice,
  type CompetitionIntent,
  type CompetitionTrigger,
  type RoutingPolicySettings,
} from "../src/core/model-routing.js";
import {
  classifyFailure,
  deriveRoutingEvidence,
  type RoutingEvidence,
} from "../src/core/statistics.js";
import type { AttemptRecord, EventRecord, TaskRecord, VerificationResult } from "../src/core/types.js";

const passedVerification: VerificationResult = {
  passed: true,
  behaviorPassed: true,
  policyPassed: true,
  sourceCompatible: true,
  commands: [{ command: "npm test", exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false }],
  diffPath: "/diff",
  sourceUnchanged: true,
};

const behaviorFailure: VerificationResult = {
  ...passedVerification,
  passed: false,
  behaviorPassed: false,
  commands: [{ command: "npm test", exitCode: 1, stdout: "", stderr: "failed", durationMs: 1, timedOut: false }],
};

const policyOnlyFailure: VerificationResult = {
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

function task(
  id: string,
  status: TaskRecord["status"],
  provider: TaskRecord["spec"]["provider"]["name"],
  model: string,
  taskClass: string,
  error?: string,
): TaskRecord {
  return {
    id,
    name: id,
    status,
    sourcePath: "/source",
    taskFile: "/task.yaml",
    spec: {
      version: 2,
      name: id,
      project: "/source",
      provider: { name: provider, model, keychainService: "test" },
      runtime: { name: "claude-code", executable: "claude", effort: "high", maxBudgetUsd: null },
      workspace: { exclude: [] },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
      contract: {
        outcome: "Observable test outcome",
        context: ["context"],
        inScope: ["scope"],
        outOfScope: ["out"],
        executionSteps: ["step"],
        deliverables: ["delivery"],
        modules: [{ name: "module", responsibility: "responsibility", consumes: ["input"], produces: ["output"], boundaries: ["boundary"] }],
        callChain: ["input to output"],
        scenarios: [{ name: "normal", given: "given", when: "when", then: "then" }],
        risks: ["risk"],
        changeBudget: { maxFiles: 10, maxDiffLines: 500 },
      },
      acceptance: { criteria: ["works"], commands: ["npm test"] },
      taskClass,
    } as unknown as TaskRecord["spec"],
    paths: {} as TaskRecord["paths"],
    sessionId: "session-" + id,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:02:00.000Z",
    startedAt: "2026-07-20T00:00:00.000Z",
    finishedAt: "2026-07-20T00:02:00.000Z",
    ...(error === undefined ? {} : { error }),
  };
}

function attempt(
  taskId: string,
  ordinal = 1,
  officialCost?: AttemptRecord["officialCost"],
): AttemptRecord {
  return {
    id: taskId + "-" + ordinal,
    taskId,
    ordinal,
    status: "succeeded",
    sessionId: "session-" + taskId,
    rawLogPath: "/log",
    startedAt: "2026-07-20T00:00:00.000Z",
    finishedAt: "2026-07-20T00:01:00.000Z",
    ...(officialCost === undefined ? {} : { officialCost }),
  };
}

function quoted(currency: "USD" | "CNY", total: number): AttemptRecord["officialCost"] {
  return {
    stage: "calculation",
    quoted: true,
    result: {
      quoted: true,
      currency,
      total,
      components: [],
      pricing: {
        provider: "test",
        origin: "https://example.com",
        route: "payg",
        modelAliases: ["model"],
        serviceTier: "default",
        currency,
        unitTokens: 1_000_000,
        source: { url: "https://example.com/pricing", checkedAt: "2026-07-20T00:00:00.000Z" },
        promotion: null,
      },
      appliedTier: { applied: [], totalPromptInput: 0 },
      usageSource: "terminal-result",
      providerBillClaim: false,
    },
  };
}

function evidence(
  provider: string,
  model: string,
  overrides: Partial<RoutingEvidence> = {},
): RoutingEvidence {
  return {
    provider,
    model,
    terminalTaskCount: 10,
    relevantSampleCount: 10,
    modelQualityFailureCount: 0,
    modelQualityFailureRate: 0,
    ignoredNonModelFailures: {},
    ignoredNonModelTaskCount: 0,
    ambiguousFailureCount: 0,
    correctionChurn: 0,
    correctionChurnRate: 0,
    acceptedDeliveryCount: 10,
    acceptedDeliverySampleCount: 10,
    acceptedDeliveryNotAcceptedCount: 0,
    acceptedDeliveryUnavailableCount: 0,
    acceptedDeliveryRate: 1,
    verifiedBehaviorSampleCount: 10,
    verifiedBehaviorCount: 10,
    verifiedBehaviorRate: 1,
    firstPassVerifiedSampleCount: 10,
    firstPassVerifiedSuccessCount: 10,
    firstPassVerifiedSuccessRate: 1,
    firstPassUnavailableCount: 0,
    officialCostAttemptCount: 0,
    officialCostQuotedAttemptCount: 0,
    officialCostUnavailableCount: 0,
    officialCostUnavailableReasons: {},
    officialCostByCurrency: [],
    durationSampleCount: 10,
    avgDurationMs: 60_000,
    budgetReliability: {
      boundedSampleCount: 0,
      completedWithoutExhaustionCount: 0,
      completedWithoutExhaustionRate: null,
      budgetExhaustionCount: 0,
      excludedUncappedCount: 0,
      excludedUnknownEnforcementCount: 0,
      excludedExternalFailureCount: 0,
      envelope: null,
    },
    ...overrides,
  };
}

function advice(
  left: RoutingEvidence,
  right: RoutingEvidence,
  policy: RoutingPolicySettings = DEFAULT_ROUTING_POLICY,
  opts?: {
    taskFamily?: string;
    familyEvidenceMap?: Map<string, RoutingEvidence>;
    competitionIntent?: CompetitionIntent;
    competitionTriggers?: CompetitionTrigger[];
  },
) {
  return provideRoutingAdvice({
    taskClass: "coding:test",
    candidates: [
      { provider: left.provider, model: left.model },
      { provider: right.provider, model: right.model },
    ],
    evidenceMap: new Map([
      [left.provider + "\0" + left.model, left],
      [right.provider + "\0" + right.model, right],
    ]),
    policy,
    ...(opts?.taskFamily !== undefined ? { taskFamily: opts.taskFamily } : {}),
    ...(opts?.familyEvidenceMap !== undefined ? { familyEvidenceMap: opts.familyEvidenceMap } : {}),
    ...(opts?.competitionIntent !== undefined ? { competitionIntent: opts.competitionIntent } : {}),
    ...(opts?.competitionTriggers !== undefined ? { competitionTriggers: opts.competitionTriggers } : {}),
  });
}

test("failure impact preserves category while policy-only verification is non-model", () => {
  assert.equal(failureImpactFor("verification"), "model-quality");
  const behavior = classifyFailure({ taskStatus: "failed", verification: behaviorFailure });
  assert.equal(behavior.category, "verification");
  assert.equal(behavior.impact, "model-quality");

  const policy = classifyFailure({ taskStatus: "failed", verification: policyOnlyFailure });
  assert.equal(policy.category, "verification");
  assert.equal(policy.impact, "non-model");
  assert.equal(classifyFailure({ taskStatus: "failed", error: "HTTP 401 bad key" }).impact, "non-model");
  assert.equal(classifyFailure({ taskStatus: "failed", error: "HTTP 503 unavailable" }).impact, "non-model");
  assert.equal(classifyFailure({ taskStatus: "failed", error: "no progress" }).impact, "ambiguous");
});

test("routing evidence isolates taskClass and excludes credential failures from sufficiency", () => {
  const success = task("ok", "succeeded", "deepseek", "v4", "coding:test");
  const failed = task("bad", "failed", "deepseek", "v4", "coding:test");
  const credential = task("auth", "failed", "deepseek", "v4", "coding:test", "HTTP 401 bad key");
  const other = task("other", "succeeded", "deepseek", "v4", "coding:other");
  const map = deriveRoutingEvidence({
    taskClass: "coding:test",
    history: [
      { task: success, attempts: [attempt("ok")], events: [], verification: passedVerification },
      { task: failed, attempts: [attempt("bad")], events: [], verification: behaviorFailure },
      { task: credential, attempts: [attempt("auth")], events: [] },
      { task: other, attempts: [attempt("other")], events: [], verification: passedVerification },
    ],
  });
  const actual = map.get("deepseek\0v4")!;
  assert.equal(actual.terminalTaskCount, 3);
  assert.equal(actual.relevantSampleCount, 2);
  assert.equal(actual.modelQualityFailureCount, 1);
  // Machine success alone is unavailable final delivery; model-quality failure
  // is a comparable non-acceptance.
  assert.equal(actual.acceptedDeliveryCount, 0);
  assert.equal(actual.acceptedDeliverySampleCount, 1);
  assert.equal(actual.acceptedDeliveryNotAcceptedCount, 1);
  assert.equal(actual.acceptedDeliveryUnavailableCount, 2);
  assert.equal(actual.ignoredNonModelTaskCount, 1);
  assert.equal(actual.ignoredNonModelFailures.credential, 1);
});

test("policy-only failure contributes passing behavior without lowering model quality", () => {
  const limited = task("limited", "failed", "deepseek", "v4", "coding:test");
  const map = deriveRoutingEvidence({
    taskClass: "coding:test",
    history: [{ task: limited, attempts: [attempt("limited")], events: [], verification: policyOnlyFailure }],
  });
  const actual = map.get("deepseek\0v4")!;
  assert.equal(actual.relevantSampleCount, 1);
  assert.equal(actual.verifiedBehaviorCount, 1);
  assert.equal(actual.modelQualityFailureCount, 0);
  assert.equal(actual.ignoredNonModelFailures.verification, 1);
});

test("Main-remediated delivery and explicit revision produce correction evidence", () => {
  const repaired = task("repair", "failed", "deepseek", "v4", "coding:test");
  const revisionEvent = {
    id: 1,
    taskId: repaired.id,
    sequence: 1,
    timestamp: repaired.finishedAt!,
    type: "task.revise.requested",
    summary: "revision",
  } satisfies EventRecord;
  const map = deriveRoutingEvidence({
    taskClass: "coding:test",
    history: [{ task: repaired, attempts: [attempt("repair")], events: [revisionEvent], verification: behaviorFailure }],
    hasPassingDisposition: () => true,
  });
  const actual = map.get("deepseek\0v4")!;
  assert.equal(actual.acceptedDeliveryCount, 1);
  assert.equal(actual.acceptedDeliverySampleCount, 1);
  assert.equal(actual.acceptedDeliveryRate, 1);
  assert.equal(actual.modelQualityFailureCount, 1);
  assert.equal(actual.correctionChurn, 2);
});

test("acceptedDelivery requires comparable Main/delivery coverage on every candidate", () => {
  const complete = evidence("deepseek", "v4", {
    acceptedDeliverySampleCount: 10,
    acceptedDeliveryCount: 8,
    acceptedDeliveryNotAcceptedCount: 2,
    acceptedDeliveryUnavailableCount: 0,
    acceptedDeliveryRate: 0.8,
  });
  const sparse = evidence("qwen", "plus", {
    acceptedDeliverySampleCount: 2,
    acceptedDeliveryCount: 2,
    acceptedDeliveryNotAcceptedCount: 0,
    acceptedDeliveryUnavailableCount: 8,
    acceptedDeliveryRate: 1,
  });
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    missingEvidenceMode: "flexible",
    weights: { ...DEFAULT_ROUTING_POLICY.weights, acceptedDelivery: 1 },
  };
  const result = advice(complete, sparse, policy);
  assert.deepEqual(result.omittedFactors.filter((f) => f.factor === "acceptedDelivery"), [{
    factor: "acceptedDelivery",
    reason: "accepted-delivery-coverage-incomplete",
  }]);
  assert.ok(result.candidates.every((c) =>
    c.factors.find((f) => f.factor === "acceptedDelivery")?.available === false));
  // Other factors with complete evidence may still participate in flexible mode.
  assert.ok(result.candidates.every((c) =>
    c.factors.find((f) => f.factor === "verifiedBehavior")?.available === true));
});

test("acceptedDelivery strict mode blocks when coverage is incomplete", () => {
  const complete = evidence("deepseek", "v4");
  const sparse = evidence("qwen", "plus", {
    acceptedDeliverySampleCount: 0,
    acceptedDeliveryCount: 0,
    acceptedDeliveryNotAcceptedCount: 0,
    acceptedDeliveryUnavailableCount: 10,
    acceptedDeliveryRate: 0,
  });
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    missingEvidenceMode: "strict",
    weights: { ...DEFAULT_ROUTING_POLICY.weights, acceptedDelivery: 1 },
  };
  const result = advice(complete, sparse, policy);
  assert.equal(result.recommendation, undefined);
  assert.ok(result.candidates.every((c) =>
    c.uncertainty.reasons.includes("positive-factor-unavailable")));
  assert.ok(result.omittedFactors.some((f) =>
    f.factor === "acceptedDelivery" && f.reason === "accepted-delivery-coverage-incomplete"));
});

test("official cost records every quote, missing record, and native currency", () => {
  const priced = task("priced", "succeeded", "deepseek", "v4", "coding:test");
  const map = deriveRoutingEvidence({
    taskClass: "coding:test",
    history: [{
      task: priced,
      attempts: [attempt("priced", 1, quoted("USD", 0.02)), attempt("priced", 2)],
      events: [],
      verification: passedVerification,
    }],
  });
  const actual = map.get("deepseek\0v4")!;
  assert.equal(actual.officialCostAttemptCount, 2);
  assert.equal(actual.officialCostQuotedAttemptCount, 1);
  assert.equal(actual.officialCostUnavailableCount, 1);
  assert.equal(actual.officialCostUnavailableReasons["missing:missing-officialCost-record"], 1);
  assert.equal(actual.officialCostByCurrency[0]!.currency, "USD");
});

test("insufficient or close evidence produces no recommendation and no competition without intent", () => {
  // Sparse evidence, no competition intent → should NOT suggest competition
  const sparse = advice(
    evidence("deepseek", "v4", { terminalTaskCount: 2, relevantSampleCount: 2 }),
    evidence("qwen", "plus", { terminalTaskCount: 1, relevantSampleCount: 1 }),
  );
  assert.equal(sparse.recommendation, undefined);
  assert.equal(sparse.knowledge, "unknown");
  assert.equal(sparse.evidenceScope, "none");
  assert.equal(sparse.shouldRunCompetition, false);
  assert.equal(sparse.competition.intent, "none");

  // Close scores, no intent → no competition
  const close = advice(evidence("deepseek", "v4"), evidence("qwen", "plus"));
  assert.equal(close.recommendation, undefined);
  assert.equal(close.shouldRunCompetition, false);
  assert.ok(close.candidates.every((candidate) => candidate.uncertainty.insufficientGap));
});

test("complete evidence with a clear gap produces one advisory recommendation", () => {
  const weaker = evidence("qwen", "plus", {
    modelQualityFailureCount: 5,
    modelQualityFailureRate: 0.5,
    correctionChurn: 5,
    correctionChurnRate: 0.5,
    acceptedDeliveryCount: 5,
    acceptedDeliveryRate: 0.5,
    verifiedBehaviorCount: 5,
    verifiedBehaviorRate: 0.5,
  });
  const result = advice(evidence("deepseek", "v4"), weaker);
  assert.equal(result.shouldRunCompetition, false);
  assert.equal(result.knowledge, "recommendation");
  assert.equal(result.evidenceScope, "exact-class");
  assert.equal(result.recommendation?.provider, "deepseek");
  assert.equal(result.candidates.find((candidate) => candidate.provider === "qwen")?.eligible, true);
});

test("official cost scores only when every relevant Attempt is exact and same-currency", () => {
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    missingEvidenceMode: "strict",
    weights: { ...DEFAULT_ROUTING_POLICY.weights, officialCost: 1 },
  };
  const exactA = evidence("deepseek", "v4", {
    officialCostAttemptCount: 10,
    officialCostQuotedAttemptCount: 10,
    officialCostByCurrency: [{ currency: "USD", quotedAttemptCount: 10, totalQuotedCost: 1, avgQuotedCost: 0.1 }],
  });
  const exactB = evidence("qwen", "plus", {
    officialCostAttemptCount: 10,
    officialCostQuotedAttemptCount: 10,
    officialCostByCurrency: [{ currency: "USD", quotedAttemptCount: 10, totalQuotedCost: 2, avgQuotedCost: 0.2 }],
  });
  const exact = advice(exactA, exactB, policy);
  assert.equal(exact.candidates[0]!.factors.find((factor) => factor.factor === "officialCost")?.available, true);

  const incomplete = evidence("qwen", "plus", {
    officialCostAttemptCount: 10,
    officialCostQuotedAttemptCount: 9,
    officialCostUnavailableCount: 1,
    officialCostUnavailableReasons: { "usage:usage-missing": 1 },
    officialCostByCurrency: [{ currency: "USD", quotedAttemptCount: 9, totalQuotedCost: 1.8, avgQuotedCost: 0.2 }],
  });
  const missing = advice(exactA, incomplete, policy);
  const missingFactor = missing.candidates[0]!.factors.find((factor) => factor.factor === "officialCost")!;
  assert.equal(missingFactor.available, false);
  assert.equal(missingFactor.unavailableReason, "official-cost-incomplete");
  assert.equal(missing.recommendation, undefined);

  const cny = evidence("qwen", "plus", {
    officialCostAttemptCount: 10,
    officialCostQuotedAttemptCount: 10,
    officialCostByCurrency: [{ currency: "CNY", quotedAttemptCount: 10, totalQuotedCost: 12, avgQuotedCost: 1.2 }],
  });
  const mixed = advice(exactA, cny, policy);
  assert.equal(
    mixed.candidates[0]!.factors.find((factor) => factor.factor === "officialCost")?.unavailableReason,
    "official-cost-currency-mismatch",
  );
});

test("duration is telemetry by default and a complete opt-in factor", () => {
  const defaultResult = advice(
    evidence("deepseek", "v4", { avgDurationMs: 120_000 }),
    evidence("qwen", "plus", { avgDurationMs: 60_000 }),
  );
  assert.equal(
    defaultResult.candidates[0]!.factors.find((factor) => factor.factor === "duration")?.unavailableReason,
    "weight-zero",
  );

  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    missingEvidenceMode: "strict",
    weights: { ...DEFAULT_ROUTING_POLICY.weights, duration: 1 },
  };
  const enabled = advice(
    evidence("deepseek", "v4", { avgDurationMs: 120_000 }),
    evidence("qwen", "plus", { avgDurationMs: 60_000 }),
    policy,
  );
  assert.equal(enabled.candidates[0]!.factors.find((factor) => factor.factor === "duration")?.available, true);

  const partial = advice(
    evidence("deepseek", "v4", { durationSampleCount: 9 }),
    evidence("qwen", "plus"),
    policy,
  );
  assert.equal(partial.recommendation, undefined);
  assert.equal(
    partial.candidates[0]!.factors.find((factor) => factor.factor === "duration")?.unavailableReason,
    "duration-coverage-incomplete",
  );
});

test("public response stays privacy-safe and returns a detached policy snapshot", () => {
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    weights: { ...DEFAULT_ROUTING_POLICY.weights },
  };
  const result = provideRoutingAdvice({
    taskClass: "coding:test",
    candidates: [{ provider: "deepseek", model: "v4" }, { provider: "qwen", model: "plus" }],
    evidenceMap: new Map(),
    policy,
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /taskId|attemptId|rawLog|apiKey|endpoint|sourcePath|diagnostic/i);
  policy.weights.duration = 9;
  assert.equal(result.resolvedPolicy.weights.duration, 0);
});

test("canonical field names match Hub settings bridge expectations", () => {
  const view = DEFAULT_ROUTING_POLICY;
  assert.ok("minRelevantSamples" in view);
  assert.ok("uncertaintyThreshold" in view);
  assert.ok("competitionOnUncertainty" in view);
  assert.ok("weights" in view);
  const w = view.weights;
  assert.ok("acceptedDelivery" in w);
  assert.ok("verifiedBehavior" in w);
  assert.ok("modelQualityFailure" in w);
  assert.ok("correctionChurn" in w);
  assert.ok("firstPassSuccess" in w);
  assert.ok("officialCost" in w);
  assert.ok("duration" in w);
  assert.ok("budgetReliability" in w);
  assert.equal(w.firstPassSuccess, 0.5);
  assert.equal(w.officialCost, 0);
  assert.equal(w.duration, 0);
  assert.equal(w.budgetReliability, 0);
  assert.equal(view.missingEvidenceMode, "flexible");
  assert.notEqual(w.acceptedDelivery, 0);
});

test("zero-weight factors never affect recommendation but remain visible", () => {
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    weights: {
      acceptedDelivery: 1,
      verifiedBehavior: 0,
      modelQualityFailure: 0,
      correctionChurn: 0,
      firstPassSuccess: 0,
      officialCost: 0,
      duration: 0,
      budgetReliability: 0,
    },
  };
  const result = provideRoutingAdvice({
    taskClass: "zero-weights",
    candidates: [{ provider: "a", model: "1" }, { provider: "b", model: "2" }],
    evidenceMap: new Map(),
    policy,
  });
  for (const c of result.candidates) {
    for (const f of c.factors) {
      if (f.weight === 0) {
        assert.equal(f.available, false);
        assert.equal(f.weightedScore, 0);
      }
    }
  }
});

test("insufficient samples produces no recommendation and honest reasons", () => {
  const policy = { ...DEFAULT_ROUTING_POLICY, minRelevantSamples: 10 };
  const result = provideRoutingAdvice({
    taskClass: "slim",
    candidates: [{ provider: "a", model: "1" }, { provider: "b", model: "2" }],
    evidenceMap: new Map(),
    policy,
  });
  assert.equal(result.recommendation, undefined);
  assert.ok(result.candidates[0]!.uncertainty.insufficientSamples);
  assert.ok(result.candidates[0]!.uncertainty.reasons.includes("insufficient-relevant-samples"));
});

test("flexible missing-evidence mode omits incomparable cost but can use clear quality evidence", () => {
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    missingEvidenceMode: "flexible",
    weights: { ...DEFAULT_ROUTING_POLICY.weights, officialCost: 1 },
  };
  const strong = evidence("deepseek", "v4", {
    officialCostAttemptCount: 10,
    officialCostQuotedAttemptCount: 10,
    officialCostByCurrency: [{ currency: "USD", quotedAttemptCount: 10, totalQuotedCost: 1, avgQuotedCost: 0.1 }],
  });
  const weak = evidence("qwen", "plus", {
    acceptedDeliveryCount: 2,
    acceptedDeliveryRate: 0.2,
    verifiedBehaviorCount: 2,
    verifiedBehaviorRate: 0.2,
    modelQualityFailureCount: 8,
    modelQualityFailureRate: 0.8,
    correctionChurn: 8,
    correctionChurnRate: 0.8,
    officialCostAttemptCount: 10,
    officialCostQuotedAttemptCount: 10,
    officialCostByCurrency: [{ currency: "CNY", quotedAttemptCount: 10, totalQuotedCost: 12, avgQuotedCost: 1.2 }],
  });

  const result = advice(strong, weak, policy);
  assert.equal(result.recommendation?.provider, "deepseek");
  assert.deepEqual(result.omittedFactors, [{
    factor: "officialCost",
    reason: "official-cost-currency-mismatch",
  }]);
  assert.ok(result.candidates.every((candidate) =>
    !candidate.uncertainty.reasons.includes("positive-factor-unavailable")));
});

test("strict missing-evidence mode blocks the same otherwise-clear comparison", () => {
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    missingEvidenceMode: "strict",
    weights: { ...DEFAULT_ROUTING_POLICY.weights, officialCost: 1 },
  };
  const exact = evidence("deepseek", "v4", {
    officialCostAttemptCount: 10,
    officialCostQuotedAttemptCount: 10,
    officialCostByCurrency: [{ currency: "USD", quotedAttemptCount: 10, totalQuotedCost: 1, avgQuotedCost: 0.1 }],
  });
  const incomplete = evidence("qwen", "plus", {
    acceptedDeliveryRate: 0.2,
    verifiedBehaviorRate: 0.2,
    modelQualityFailureRate: 0.8,
    correctionChurnRate: 0.8,
    officialCostAttemptCount: 10,
    officialCostQuotedAttemptCount: 0,
  });

  const result = advice(exact, incomplete, policy);
  assert.equal(result.recommendation, undefined);
  assert.ok(result.candidates.every((candidate) =>
    candidate.uncertainty.reasons.includes("positive-factor-unavailable")));
});

test("flexible mode still blocks insufficient samples and zero active factors", () => {
  const insufficient = advice(
    evidence("deepseek", "v4", { relevantSampleCount: 9 }),
    evidence("qwen", "plus"),
    { ...DEFAULT_ROUTING_POLICY, minRelevantSamples: 10, missingEvidenceMode: "flexible" },
  );
  assert.equal(insufficient.recommendation, undefined);
  assert.ok(insufficient.candidates.some((candidate) => candidate.uncertainty.insufficientSamples));

  const noFactors = advice(
    evidence("deepseek", "v4"),
    evidence("qwen", "plus"),
    {
      ...DEFAULT_ROUTING_POLICY,
      missingEvidenceMode: "flexible",
      weights: {
        acceptedDelivery: 0,
        verifiedBehavior: 0,
        modelQualityFailure: 0,
        correctionChurn: 0,
        firstPassSuccess: 0,
        officialCost: 0,
        duration: 0,
        budgetReliability: 0,
      },
    },
  );
  assert.equal(noFactors.recommendation, undefined);
  assert.ok(noFactors.candidates.every((candidate) =>
    candidate.uncertainty.reasons.includes("no-active-factors")));
});

// --- First-pass verified success factor -----------------------------------

test("firstPassSuccess prefers higher Attempt-one verified rate without replacing delivery", () => {
  const firstPassReady = evidence("deepseek", "v4", {
    firstPassVerifiedSampleCount: 10,
    firstPassVerifiedSuccessCount: 9,
    firstPassVerifiedSuccessRate: 0.9,
    acceptedDeliveryRate: 1,
    correctionChurnRate: 0.2,
  });
  const needsCorrection = evidence("qwen", "plus", {
    firstPassVerifiedSampleCount: 10,
    firstPassVerifiedSuccessCount: 2,
    firstPassVerifiedSuccessRate: 0.2,
    acceptedDeliveryRate: 1,
    acceptedDeliveryCount: 10,
    correctionChurnRate: 0.8,
    correctionChurn: 8,
  });
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    missingEvidenceMode: "strict",
    weights: {
      ...DEFAULT_ROUTING_POLICY.weights,
      acceptedDelivery: 0,
      verifiedBehavior: 0,
      modelQualityFailure: 0,
      correctionChurn: 0,
      firstPassSuccess: 1,
      officialCost: 0,
      duration: 0,
      budgetReliability: 0,
    },
  };
  const result = advice(firstPassReady, needsCorrection, policy);
  assert.equal(result.recommendation?.provider, "deepseek");
  const factor = result.candidates
    .find((c) => c.provider === "deepseek")!
    .factors.find((f) => f.factor === "firstPassSuccess")!;
  assert.equal(factor.available, true);
  assert.equal(factor.rawValue, 0.9);
});

test("firstPassSuccess requires comparable coverage on every candidate", () => {
  const complete = evidence("deepseek", "v4", {
    firstPassVerifiedSampleCount: 10,
    firstPassVerifiedSuccessCount: 10,
    firstPassVerifiedSuccessRate: 1,
  });
  const sparse = evidence("qwen", "plus", {
    firstPassVerifiedSampleCount: 2,
    firstPassVerifiedSuccessCount: 2,
    firstPassVerifiedSuccessRate: 1,
    firstPassUnavailableCount: 8,
  });
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    missingEvidenceMode: "flexible",
    weights: { ...DEFAULT_ROUTING_POLICY.weights, firstPassSuccess: 1 },
  };
  const result = advice(complete, sparse, policy);
  assert.deepEqual(result.omittedFactors.filter((f) => f.factor === "firstPassSuccess"), [{
    factor: "firstPassSuccess",
    reason: "first-pass-success-coverage-incomplete",
  }]);
  assert.ok(result.candidates.every((c) =>
    c.factors.find((f) => f.factor === "firstPassSuccess")?.available === false));
});

test("firstPassSuccess strict mode blocks when coverage is incomplete", () => {
  const complete = evidence("deepseek", "v4");
  const sparse = evidence("qwen", "plus", {
    firstPassVerifiedSampleCount: 0,
    firstPassVerifiedSuccessCount: 0,
    firstPassVerifiedSuccessRate: 0,
    firstPassUnavailableCount: 10,
  });
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    missingEvidenceMode: "strict",
    weights: { ...DEFAULT_ROUTING_POLICY.weights, firstPassSuccess: 1 },
  };
  const result = advice(complete, sparse, policy);
  assert.equal(result.recommendation, undefined);
  assert.ok(result.candidates.every((c) =>
    c.uncertainty.reasons.includes("positive-factor-unavailable")));
  assert.ok(result.omittedFactors.some((f) =>
    f.factor === "firstPassSuccess" && f.reason === "first-pass-success-coverage-incomplete"));
});

test("full Worker identity zero history keeps real provider and model", () => {
  const result = provideRoutingAdvice({
    taskClass: "coding:new",
    candidates: [
      { provider: "deepseek", model: "v4", runtime: "claude-code", effort: "high" },
      { provider: "qwen", model: "plus", runtime: "claude-code", effort: "max" },
    ],
    evidenceMap: new Map(),
    familyEvidenceMap: new Map(),
    policy: DEFAULT_ROUTING_POLICY,
  });
  const deepseek = result.candidates.find((c) => c.provider === "deepseek")!;
  const qwen = result.candidates.find((c) => c.provider === "qwen")!;
  assert.equal(deepseek.provider, "deepseek");
  assert.equal(deepseek.model, "v4");
  assert.equal(deepseek.runtime, "claude-code");
  assert.equal(deepseek.effort, "high");
  assert.equal(deepseek.evidence.provider, "deepseek");
  assert.equal(deepseek.evidence.model, "v4");
  assert.equal(deepseek.evidence.terminalTaskCount, 0);
  assert.equal(qwen.provider, "qwen");
  assert.equal(qwen.model, "plus");
  assert.equal(qwen.evidence.provider, "qwen");
  assert.equal(qwen.evidence.model, "plus");
  // Must not fall back to synthetic unknown/unknown identity rows.
  assert.equal(
    result.candidates.some((c) => c.provider === "unknown" || c.model === "unknown"
      || c.evidence.provider === "unknown" || c.evidence.model === "unknown"),
    false,
  );
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /taskId|attemptId|rawLog|apiKey|endpoint|sourcePath|prompt/i);
});

// --- Budget reliability (opt-in budgetReliability factor) -----------------

function budgetEnvelope(
  runtimeBudgetUsd: number | null,
  observedTokenCeiling: number | null,
): { runtimeBudgetUsd: number | null; observedTokenCeiling: number | null } {
  return { runtimeBudgetUsd, observedTokenCeiling };
}

function budgetReliability(
  envelope: { runtimeBudgetUsd: number | null; observedTokenCeiling: number | null } | null,
  bounded: number,
  without: number,
  exhausted: number,
): RoutingEvidence["budgetReliability"] {
  return {
    boundedSampleCount: bounded,
    completedWithoutExhaustionCount: without,
    completedWithoutExhaustionRate: bounded === 0 ? null : without / bounded,
    budgetExhaustionCount: exhausted,
    excludedUncappedCount: 0,
    excludedUnknownEnforcementCount: 0,
    excludedExternalFailureCount: 0,
    envelope,
  };
}

test("budgetReliability defaults to zero and never affects default routing", () => {
  const a = evidence("deepseek", "v4", {
    budgetReliability: budgetReliability(budgetEnvelope(1, null), 10, 10, 0),
  });
  const b = evidence("qwen", "plus", {
    budgetReliability: budgetReliability(budgetEnvelope(1, null), 10, 4, 6),
  });
  const result = advice(a, b);
  const factor = result.candidates[0]!.factors.find(
    (entry) => entry.factor === "budgetReliability",
  )!;
  assert.equal(factor.weight, 0);
  assert.equal(factor.available, false);
  assert.equal(factor.unavailableReason, "weight-zero");
});

test("budgetReliability: comparable bounded envelopes prefer the higher completion rate", () => {
  const env = budgetEnvelope(1.00, null);
  const strong = evidence("deepseek", "v4", {
    budgetReliability: budgetReliability(env, 10, 9, 1),
  });
  const weak = evidence("qwen", "plus", {
    budgetReliability: budgetReliability(env, 10, 4, 6),
  });
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    missingEvidenceMode: "strict",
    weights: { ...DEFAULT_ROUTING_POLICY.weights, budgetReliability: 1 },
  };
  const result = advice(strong, weak, policy);
  const strongFactor = result.candidates
    .find((c) => c.provider === "deepseek")!
    .factors.find((f) => f.factor === "budgetReliability")!;
  const weakFactor = result.candidates
    .find((c) => c.provider === "qwen")!
    .factors.find((f) => f.factor === "budgetReliability")!;
  assert.equal(strongFactor.available, true);
  assert.equal(weakFactor.available, true);
  assert.ok(strongFactor.weightedScore > weakFactor.weightedScore);
  assert.equal(result.recommendation?.provider, "deepseek");
  // Both candidates remain eligible - the factor is a soft preference.
  assert.equal(
    result.candidates.find((c) => c.provider === "qwen")?.eligible,
    true,
  );
});

test("budgetReliability: uncapped history never becomes zero or positive evidence", () => {
  const strong = evidence("deepseek", "v4", {
    acceptedDeliveryCount: 10,
    acceptedDeliveryRate: 1,
    budgetReliability: budgetReliability(null, 0, 0, 0),
  });
  const weak = evidence("qwen", "plus", {
    acceptedDeliveryCount: 2,
    acceptedDeliveryRate: 0.2,
    budgetReliability: budgetReliability(null, 0, 0, 0),
  });
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    missingEvidenceMode: "flexible",
    weights: { ...DEFAULT_ROUTING_POLICY.weights, budgetReliability: 1 },
  };
  const result = advice(strong, weak, policy);
  const factor = result.candidates[0]!.factors.find(
    (entry) => entry.factor === "budgetReliability",
  )!;
  assert.equal(factor.available, false);
  assert.equal(factor.unavailableReason, "budget-reliability-missing-bounded-evidence");
  assert.equal(result.recommendation?.provider, "deepseek",
    "recommendation falls back to quality evidence, not to a synthetic 0");
});

test("budgetReliability: mixed envelopes inside one candidate make the factor unavailable", () => {
  const mixed = budgetReliability(null, 5, 3, 2);
  const a = evidence("deepseek", "v4", { budgetReliability: mixed });
  const b = evidence("qwen", "plus", {
    budgetReliability: budgetReliability(budgetEnvelope(1, null), 10, 9, 1),
  });
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    missingEvidenceMode: "strict",
    weights: { ...DEFAULT_ROUTING_POLICY.weights, budgetReliability: 1 },
  };
  const result = advice(a, b, policy);
  const factor = result.candidates[0]!.factors.find(
    (entry) => entry.factor === "budgetReliability",
  )!;
  assert.equal(factor.available, false);
  // Mixed envelope shows the per-candidate reason, not a cross-candidate one.
  assert.equal(factor.unavailableReason, "budget-reliability-mixed-envelope-candidate");
});

test("budgetReliability: cross-candidate envelope mismatch is unavailable for every candidate", () => {
  const a = evidence("deepseek", "v4", {
    budgetReliability: budgetReliability(budgetEnvelope(1.00, null), 10, 8, 2),
  });
  const b = evidence("qwen", "plus", {
    budgetReliability: budgetReliability(budgetEnvelope(2.00, null), 10, 9, 1),
  });
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    missingEvidenceMode: "strict",
    weights: { ...DEFAULT_ROUTING_POLICY.weights, budgetReliability: 1 },
  };
  const result = advice(a, b, policy);
  for (const c of result.candidates) {
    const factor = c.factors.find((entry) => entry.factor === "budgetReliability")!;
    assert.equal(factor.available, false);
    assert.equal(factor.unavailableReason, "budget-reliability-mixed-envelope-cross-candidate");
  }
});

test("budgetReliability: external failures are excluded from both counts and remain visible", () => {
  // A bounded credential failure must not count as budget exhaustion and
  // must not count as completion-without-exhaustion. The evidence field
  // surfaces it as excludedExternalFailureCount.
  const env = budgetEnvelope(1.00, null);
  const a = evidence("deepseek", "v4", {
    ignoredNonModelTaskCount: 4,
    ignoredNonModelFailures: { credential: 4 },
    budgetReliability: {
      boundedSampleCount: 6,
      completedWithoutExhaustionCount: 6,
      completedWithoutExhaustionRate: 1,
      budgetExhaustionCount: 0,
      excludedUncappedCount: 0,
      excludedUnknownEnforcementCount: 0,
      excludedExternalFailureCount: 4,
      envelope: env,
    },
  });
  const b = evidence("qwen", "plus", {
    budgetReliability: budgetReliability(env, 6, 6, 0),
  });
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    missingEvidenceMode: "strict",
    weights: { ...DEFAULT_ROUTING_POLICY.weights, budgetReliability: 1 },
  };
  const result = advice(a, b, policy);
  const factor = result.candidates
    .find((c) => c.provider === "deepseek")!
    .factors.find((f) => f.factor === "budgetReliability")!;
  assert.equal(factor.available, true);
  // Credential failures remain visible through the non-model ignored counter.
  assert.equal(result.candidates.find((c) => c.provider === "deepseek")?.eligible, true);
});

test("budgetReliability: strict mode blocks when this factor is enabled but unavailable", () => {
  const a = evidence("deepseek", "v4", {
    budgetReliability: budgetReliability(budgetEnvelope(1, null), 10, 10, 0),
  });
  const b = evidence("qwen", "plus", {
    budgetReliability: budgetReliability(null, 0, 0, 0),
  });
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    missingEvidenceMode: "strict",
    weights: { ...DEFAULT_ROUTING_POLICY.weights, budgetReliability: 1 },
  };
  const result = advice(a, b, policy);
  assert.equal(result.recommendation, undefined);
  assert.ok(result.candidates.every((c) =>
    c.uncertainty.reasons.includes("positive-factor-unavailable")));
  assert.ok(result.candidates.some((c) =>
    c.factors.find((f) => f.factor === "budgetReliability")?.unavailableReason
      === "budget-reliability-missing-bounded-evidence"));
});

test("budgetReliability: flexible mode omits the factor and may use other comparable evidence", () => {
  const a = evidence("deepseek", "v4", {
    acceptedDeliveryCount: 10,
    acceptedDeliveryRate: 1,
    budgetReliability: budgetReliability(budgetEnvelope(1, null), 10, 10, 0),
  });
  const b = evidence("qwen", "plus", {
    acceptedDeliveryCount: 2,
    acceptedDeliveryRate: 0.2,
    budgetReliability: budgetReliability(null, 0, 0, 0),
  });
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    missingEvidenceMode: "flexible",
    weights: { ...DEFAULT_ROUTING_POLICY.weights, budgetReliability: 1 },
  };
  const result = advice(a, b, policy);
  assert.equal(result.recommendation?.provider, "deepseek",
    "flexible mode keeps comparing with quality evidence");
  assert.deepEqual(result.omittedFactors, [{
    factor: "budgetReliability",
    reason: "budget-reliability-missing-bounded-evidence",
  }]);
});

test("budgetReliability: bounded-sample coverage gate is additive to general sufficiency", () => {
  // General samples are sufficient (10) but bounded samples are sparse (3).
  const env = budgetEnvelope(1.00, null);
  const a = evidence("deepseek", "v4", {
    budgetReliability: budgetReliability(env, 3, 3, 0),
  });
  const b = evidence("qwen", "plus", {
    budgetReliability: budgetReliability(env, 3, 1, 2),
  });
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    missingEvidenceMode: "strict",
    weights: { ...DEFAULT_ROUTING_POLICY.weights, budgetReliability: 1 },
  };
  const result = advice(a, b, policy);
  const factor = result.candidates[0]!.factors.find(
    (entry) => entry.factor === "budgetReliability",
  )!;
  assert.equal(factor.available, false);
  assert.equal(factor.unavailableReason, "budget-reliability-coverage-incomplete");
});

test("budgetReliability: response payload stays privacy-safe and preserves immutability", () => {
  const env = budgetEnvelope(1.00, null);
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    missingEvidenceMode: "strict",
    weights: { ...DEFAULT_ROUTING_POLICY.weights, budgetReliability: 1 },
  };
  const result = provideRoutingAdvice({
    taskClass: "coding:budget-rel",
    candidates: [{ provider: "deepseek", model: "v4" }, { provider: "qwen", model: "plus" }],
    evidenceMap: new Map([
      ["deepseek\0v4", evidence("deepseek", "v4", { budgetReliability: budgetReliability(env, 10, 10, 0) })],
      ["qwen\0plus", evidence("qwen", "plus", { budgetReliability: budgetReliability(env, 10, 5, 5) })],
    ]),
    policy,
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /taskId|attemptId|rawLog|apiKey|endpoint|sourcePath|diagnostic/i);
  // Immutability: the policy snapshot is detached from the caller's policy.
  policy.weights.budgetReliability = 9;
  assert.equal(result.resolvedPolicy.weights.budgetReliability, 1);
});

// --- Evidence scope, knowledge, and competition separation (M3 V1) ----------

test("unknown + none: zero evidence with intent none never suggests competition", () => {
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    competitionTriggersEnabled: ["critical", "new-family"],
  };
  const result = advice(
    evidence("deepseek", "v4", { terminalTaskCount: 0, relevantSampleCount: 0 }),
    evidence("qwen", "plus", { terminalTaskCount: 0, relevantSampleCount: 0 }),
    policy,
    { competitionIntent: "none" },
  );
  assert.equal(result.knowledge, "unknown");
  assert.equal(result.evidenceScope, "none");
  assert.equal(result.recommendation, undefined);
  assert.equal(result.shouldRunCompetition, false);
  assert.equal(result.competition.intent, "none");
  assert.deepEqual(result.competition.matchingTriggers, []);
});

test("exact evidence wins: sufficient exact class samples use exact scope and ignore family", () => {
  const strong = evidence("deepseek", "v4", { relevantSampleCount: 10, acceptedDeliveryCount: 10 });
  const weak = evidence("qwen", "plus", {
    relevantSampleCount: 10, acceptedDeliveryCount: 2, acceptedDeliveryRate: 0.2,
    modelQualityFailureCount: 8, modelQualityFailureRate: 0.8,
    verifiedBehaviorCount: 2, verifiedBehaviorRate: 0.2,
  });
  // Even if family evidence exists, exact scope wins
  const familyEvidence = new Map([
    ["deepseek\0v4", evidence("deepseek", "v4", {
      terminalTaskCount: 100, relevantSampleCount: 100, acceptedDeliveryCount: 100 })] as const,
    ["qwen\0plus", evidence("qwen", "plus", {
      terminalTaskCount: 100, relevantSampleCount: 100, acceptedDeliveryCount: 50,
      acceptedDeliveryRate: 0.5 })] as const,
  ] as Array<[string, RoutingEvidence]>);
  const result = advice(strong, weak, DEFAULT_ROUTING_POLICY, {
    taskFamily: "coding",
    familyEvidenceMap: familyEvidence,
  });
  assert.equal(result.evidenceScope, "exact-class");
  assert.equal(result.knowledge, "recommendation");
  assert.equal(result.recommendation?.provider, "deepseek");
});

test("family evidence is complete fallback when exact is insufficient", () => {
  const sparse = evidence("deepseek", "v4", { terminalTaskCount: 1, relevantSampleCount: 1 });
  const sparse2 = evidence("qwen", "plus", { terminalTaskCount: 1, relevantSampleCount: 1 });
  const familyMap = new Map([
    ["deepseek\0v4", evidence("deepseek", "v4", {
      terminalTaskCount: 20, relevantSampleCount: 15, acceptedDeliveryCount: 15,
      modelQualityFailureCount: 0, modelQualityFailureRate: 0,
    })] as const,
    ["qwen\0plus", evidence("qwen", "plus", {
      terminalTaskCount: 20, relevantSampleCount: 10, acceptedDeliveryCount: 5,
      acceptedDeliveryRate: 0.5,
      modelQualityFailureCount: 5, modelQualityFailureRate: 0.5,
    })] as const,
  ] as Array<[string, RoutingEvidence]>);
  const result = advice(sparse, sparse2, DEFAULT_ROUTING_POLICY, {
    taskFamily: "coding:backend",
    familyEvidenceMap: familyMap,
  });
  assert.equal(result.evidenceScope, "task-family");
  assert.equal(result.knowledge, "recommendation");
  assert.equal(result.recommendation?.provider, "deepseek");
  assert.equal(result.taskFamily, "coding:backend");
});

test("family fallback fails when not all candidates meet family threshold", () => {
  const sparse = evidence("deepseek", "v4", { terminalTaskCount: 1, relevantSampleCount: 1 });
  const sparse2 = evidence("qwen", "plus", { terminalTaskCount: 1, relevantSampleCount: 1 });
  // Only deepseek has family evidence
  const familyMap = new Map([
    ["deepseek\0v4", evidence("deepseek", "v4", {
      terminalTaskCount: 20, relevantSampleCount: 15 })] as const,
    ["qwen\0plus", evidence("qwen", "plus", {
      terminalTaskCount: 1, relevantSampleCount: 1 })] as const,
  ] as Array<[string, RoutingEvidence]>);
  const result = advice(sparse, sparse2, DEFAULT_ROUTING_POLICY, {
    taskFamily: "coding:backend",
    familyEvidenceMap: familyMap,
  });
  assert.equal(result.evidenceScope, "none");
  assert.equal(result.knowledge, "unknown");
  assert.equal(result.shouldRunCompetition, false);
});

test("asymmetric family history stays undecided but exposes real sample coverage", () => {
  // Scenario: Grok has 13 family samples, MiniMax has 2; threshold is 5 for every candidate.
  // Exact task class is new (zero samples). Incomplete family set must not score or recommend.
  const emptyExactGrok = evidence("xai", "grok-4.5", {
    terminalTaskCount: 0, relevantSampleCount: 0,
  });
  const emptyExactMini = evidence("minimax", "m2", {
    terminalTaskCount: 0, relevantSampleCount: 0,
  });
  const familyMap = new Map([
    ["xai\0grok-4.5", evidence("xai", "grok-4.5", {
      terminalTaskCount: 15, relevantSampleCount: 13,
      acceptedDeliveryCount: 12, acceptedDeliveryRate: 12 / 13,
    })] as const,
    ["minimax\0m2", evidence("minimax", "m2", {
      terminalTaskCount: 3, relevantSampleCount: 2,
      acceptedDeliveryCount: 1, acceptedDeliveryRate: 0.5,
    })] as const,
  ] as Array<[string, RoutingEvidence]>);
  const result = advice(emptyExactGrok, emptyExactMini, DEFAULT_ROUTING_POLICY, {
    taskFamily: "bounded-javascript-change",
    familyEvidenceMap: familyMap,
    competitionIntent: "none",
  });
  assert.equal(result.evidenceScope, "none");
  assert.equal(result.knowledge, "unknown");
  assert.equal(result.recommendation, undefined);
  assert.equal(result.shouldRunCompetition, false);
  assert.equal(result.competition.shouldRunCompetition, false);
  assert.equal(result.competition.intent, "none");

  const grok = result.candidates.find((c) => c.provider === "xai")!;
  const mini = result.candidates.find((c) => c.provider === "minimax")!;
  assert.equal(grok.sampleCoverage.exactRelevantCount, 0);
  assert.equal(grok.sampleCoverage.exactTerminalCount, 0);
  assert.equal(grok.sampleCoverage.exactMinRelevantSamples, 5);
  assert.equal(grok.sampleCoverage.familyRelevantCount, 13);
  assert.equal(grok.sampleCoverage.familyTerminalCount, 15);
  assert.equal(grok.sampleCoverage.familyMinRelevantSamples, 5);
  assert.equal(mini.sampleCoverage.exactRelevantCount, 0);
  assert.equal(mini.sampleCoverage.familyRelevantCount, 2);
  assert.equal(mini.sampleCoverage.familyMinRelevantSamples, 5);
  // Incomplete family evidence must not score: all candidates stay at zero total.
  assert.equal(grok.totalScore, 0);
  assert.equal(mini.totalScore, 0);
  assert.ok(grok.uncertainty.insufficientSamples);
  assert.ok(mini.uncertainty.insufficientSamples);
});

test("sample coverage omits family fields when no task family is supplied", () => {
  const result = advice(
    evidence("deepseek", "v4", { terminalTaskCount: 0, relevantSampleCount: 0 }),
    evidence("qwen", "plus", { terminalTaskCount: 0, relevantSampleCount: 0 }),
  );
  assert.equal(result.evidenceScope, "none");
  for (const c of result.candidates) {
    assert.equal(c.sampleCoverage.exactRelevantCount, 0);
    assert.equal(c.sampleCoverage.exactMinRelevantSamples, 5);
    assert.equal(c.sampleCoverage.familyRelevantCount, undefined);
    assert.equal(c.sampleCoverage.familyTerminalCount, undefined);
    assert.equal(c.sampleCoverage.familyMinRelevantSamples, undefined);
  }
});

test("exact evidence win keeps recommendation and binds coverage by identity", () => {
  const strong = evidence("deepseek", "v4", {
    relevantSampleCount: 10, acceptedDeliveryCount: 10, acceptedDeliveryRate: 1,
  });
  const weak = evidence("qwen", "plus", {
    relevantSampleCount: 10, acceptedDeliveryCount: 2, acceptedDeliveryRate: 0.2,
    modelQualityFailureCount: 8, modelQualityFailureRate: 0.8,
    verifiedBehaviorCount: 2, verifiedBehaviorRate: 0.2,
  });
  const familyEvidence = new Map([
    ["deepseek\0v4", evidence("deepseek", "v4", {
      terminalTaskCount: 40, relevantSampleCount: 30 })] as const,
    ["qwen\0plus", evidence("qwen", "plus", {
      terminalTaskCount: 40, relevantSampleCount: 25 })] as const,
  ] as Array<[string, RoutingEvidence]>);
  const result = advice(strong, weak, DEFAULT_ROUTING_POLICY, {
    taskFamily: "coding",
    familyEvidenceMap: familyEvidence,
  });
  assert.equal(result.evidenceScope, "exact-class");
  assert.equal(result.knowledge, "recommendation");
  assert.equal(result.recommendation?.provider, "deepseek");
  const deepseek = result.candidates.find((c) => c.provider === "deepseek")!;
  const qwen = result.candidates.find((c) => c.provider === "qwen")!;
  assert.equal(deepseek.sampleCoverage.exactRelevantCount, 10);
  assert.equal(deepseek.sampleCoverage.familyRelevantCount, 30);
  assert.equal(qwen.sampleCoverage.exactRelevantCount, 10);
  assert.equal(qwen.sampleCoverage.familyRelevantCount, 25);
});

test("family fallback win keeps recommendation and reports family coverage", () => {
  const sparse = evidence("deepseek", "v4", { terminalTaskCount: 1, relevantSampleCount: 1 });
  const sparse2 = evidence("qwen", "plus", { terminalTaskCount: 1, relevantSampleCount: 1 });
  const familyMap = new Map([
    ["deepseek\0v4", evidence("deepseek", "v4", {
      terminalTaskCount: 20, relevantSampleCount: 15, acceptedDeliveryCount: 15,
      modelQualityFailureCount: 0, modelQualityFailureRate: 0,
    })] as const,
    ["qwen\0plus", evidence("qwen", "plus", {
      terminalTaskCount: 20, relevantSampleCount: 10, acceptedDeliveryCount: 5,
      acceptedDeliveryRate: 0.5,
      modelQualityFailureCount: 5, modelQualityFailureRate: 0.5,
    })] as const,
  ] as Array<[string, RoutingEvidence]>);
  const result = advice(sparse, sparse2, DEFAULT_ROUTING_POLICY, {
    taskFamily: "coding:backend",
    familyEvidenceMap: familyMap,
  });
  assert.equal(result.evidenceScope, "task-family");
  assert.equal(result.knowledge, "recommendation");
  assert.equal(result.recommendation?.provider, "deepseek");
  const deepseek = result.candidates.find((c) => c.provider === "deepseek")!;
  const qwen = result.candidates.find((c) => c.provider === "qwen")!;
  assert.equal(deepseek.sampleCoverage.exactRelevantCount, 1);
  assert.equal(deepseek.sampleCoverage.familyRelevantCount, 15);
  assert.equal(qwen.sampleCoverage.exactRelevantCount, 1);
  assert.equal(qwen.sampleCoverage.familyRelevantCount, 10);
});

test("sample coverage stays bound to identity after score sorting reorders candidates", () => {
  // Weaker model alphabetically first so alphabetical order alone would not sort;
  // strong quality scores put deepseek first after sort.
  const weak = evidence("aaa", "first", {
    relevantSampleCount: 10, acceptedDeliveryCount: 2, acceptedDeliveryRate: 0.2,
    modelQualityFailureCount: 8, modelQualityFailureRate: 0.8,
    verifiedBehaviorCount: 2, verifiedBehaviorRate: 0.2,
  });
  const strong = evidence("zzz", "last", {
    relevantSampleCount: 10, acceptedDeliveryCount: 10, acceptedDeliveryRate: 1,
  });
  const familyMap = new Map([
    ["aaa\0first", evidence("aaa", "first", {
      terminalTaskCount: 7, relevantSampleCount: 6 })] as const,
    ["zzz\0last", evidence("zzz", "last", {
      terminalTaskCount: 99, relevantSampleCount: 88 })] as const,
  ] as Array<[string, RoutingEvidence]>);
  const result = advice(weak, strong, DEFAULT_ROUTING_POLICY, {
    taskFamily: "coding",
    familyEvidenceMap: familyMap,
  });
  assert.equal(result.candidates[0]!.provider, "zzz");
  assert.equal(result.candidates[0]!.sampleCoverage.familyRelevantCount, 88);
  assert.equal(result.candidates[0]!.sampleCoverage.exactRelevantCount, 10);
  assert.equal(result.candidates[1]!.provider, "aaa");
  assert.equal(result.candidates[1]!.sampleCoverage.familyRelevantCount, 6);
  assert.equal(result.candidates[1]!.sampleCoverage.exactRelevantCount, 10);
});

test("sample coverage serialization stays privacy-safe", () => {
  const familyMap = new Map([
    ["deepseek\0v4", evidence("deepseek", "v4", {
      terminalTaskCount: 13, relevantSampleCount: 13 })] as const,
    ["qwen\0plus", evidence("qwen", "plus", {
      terminalTaskCount: 2, relevantSampleCount: 2 })] as const,
  ] as Array<[string, RoutingEvidence]>);
  const result = advice(
    evidence("deepseek", "v4", { terminalTaskCount: 0, relevantSampleCount: 0 }),
    evidence("qwen", "plus", { terminalTaskCount: 0, relevantSampleCount: 0 }),
    DEFAULT_ROUTING_POLICY,
    { taskFamily: "coding", familyEvidenceMap: familyMap },
  );
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /taskId|attemptId|rawLog|apiKey|endpoint|sourcePath|diagnostic/i);
  assert.match(serialized, /"sampleCoverage"/);
  assert.match(serialized, /"exactRelevantCount":0/);
  assert.match(serialized, /"familyRelevantCount":13/);
  // Compact projection only — no nested full evidence clone under sampleCoverage.
  assert.doesNotMatch(serialized, /"sampleCoverage":\{[^}]*"ignoredNonModelFailures"/);
});

test("critical work with consider intent and enabled trigger suggests competition", () => {
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    competitionTriggersEnabled: ["critical"],
  };
  // Good evidence for a recommendation, but criticality overrides for competition advice
  const weak = evidence("qwen", "plus", {
    modelQualityFailureCount: 5, modelQualityFailureRate: 0.5,
    correctionChurn: 5, correctionChurnRate: 0.5,
    acceptedDeliveryCount: 5, acceptedDeliveryRate: 0.5,
    verifiedBehaviorCount: 5, verifiedBehaviorRate: 0.5,
  });
  const result = advice(evidence("deepseek", "v4"), weak, policy, {
    competitionIntent: "consider",
    competitionTriggers: ["critical"],
  });
  // Routing still has a recommendation based on evidence
  assert.equal(result.knowledge, "recommendation");
  assert.equal(result.recommendation?.provider, "deepseek");
  // But competition is advised because of criticality, not uncertainty
  assert.equal(result.shouldRunCompetition, true);
  assert.equal(result.competition.intent, "consider");
  assert.deepEqual(result.competition.matchingTriggers, ["critical"]);
});

test("consider intent with disabled trigger does NOT suggest competition", () => {
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    competitionTriggersEnabled: [], // nothing enabled
  };
  const result = advice(
    evidence("deepseek", "v4"),
    evidence("qwen", "plus"),
    policy,
    {
      competitionIntent: "consider",
      competitionTriggers: ["critical"],
    },
  );
  // Evidence may support recommendation
  assert.equal(result.shouldRunCompetition, false);
  assert.equal(result.competition.intent, "consider");
  assert.deepEqual(result.competition.matchingTriggers, []);
});

test("required intent always suggests competition regardless of triggers", () => {
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    competitionTriggersEnabled: [], // nothing enabled
  };
  const result = advice(
    evidence("deepseek", "v4"),
    evidence("qwen", "plus"),
    policy,
    {
      competitionIntent: "required",
      competitionTriggers: ["user-requested"],
    },
  );
  assert.equal(result.shouldRunCompetition, true);
  assert.equal(result.competition.intent, "required");
  assert.equal(result.competition.suggestedCandidates, 2);
});

test("response includes evidence scope, knowledge, and competition fields", () => {
  const result = advice(
    evidence("deepseek", "v4", { terminalTaskCount: 0, relevantSampleCount: 0 }),
    evidence("qwen", "plus", { terminalTaskCount: 0, relevantSampleCount: 0 }),
  );
  // Verify new fields exist with correct types
  assert.ok(typeof result.evidenceScope === "string");
  assert.ok(typeof result.knowledge === "string");
  assert.ok(typeof result.competition === "object");
  assert.ok(typeof result.competition.shouldRunCompetition === "boolean");
  assert.ok(typeof result.competition.intent === "string");
  assert.ok(Array.isArray(result.competition.matchingTriggers));
  assert.ok(typeof result.competition.suggestedCandidates === "number");
  // Legacy shouldRunCompetition still present
  assert.equal(result.shouldRunCompetition, result.competition.shouldRunCompetition);
});

test("policy carries familyMinRelevantSamples and new fields", () => {
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    familyMinRelevantSamples: 8,
    competitionTriggersEnabled: ["critical", "new-family"],
    defaultCompetitionCandidates: 3,
  };
  const result = advice(
    evidence("deepseek", "v4"),
    evidence("qwen", "plus"),
    policy,
  );
  assert.equal(result.resolvedPolicy.familyMinRelevantSamples, 8);
  assert.deepEqual(result.resolvedPolicy.competitionTriggersEnabled, ["critical", "new-family"]);
  assert.equal(result.resolvedPolicy.defaultCompetitionCandidates, 3);
  // Immutability: resolved policy is a copy
  assert.notEqual(result.resolvedPolicy.competitionTriggersEnabled, policy.competitionTriggersEnabled);
});

test("taskFamily is propagated to response when provided", () => {
  const result = advice(
    evidence("deepseek", "v4"),
    evidence("qwen", "plus"),
    DEFAULT_ROUTING_POLICY,
    { taskFamily: "ui-readability" },
  );
  assert.equal(result.taskFamily, "ui-readability");
});

test("competitionOnUncertainty off blocks consider advice even with matching triggers", () => {
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    competitionOnUncertainty: false, // master switch off
    competitionTriggersEnabled: ["critical"],
  };
  const result = advice(
    evidence("deepseek", "v4"),
    evidence("qwen", "plus"),
    policy,
    { competitionIntent: "consider", competitionTriggers: ["critical"] },
  );
  assert.equal(result.shouldRunCompetition, false);
  assert.equal(result.competition.intent, "consider");
  assert.deepEqual(result.competition.matchingTriggers, []);
});

test("new-family trigger is inactive when family evidence is already available", () => {
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    competitionOnUncertainty: true,
    competitionTriggersEnabled: ["new-family"],
  };
  // Exact evidence is insufficient but family evidence is sufficient
  const sparse = evidence("deepseek", "v4", { terminalTaskCount: 2, relevantSampleCount: 2 });
  const sparse2 = evidence("qwen", "plus", { terminalTaskCount: 2, relevantSampleCount: 2 });
  const familyMap = new Map([
    ["deepseek\0v4", evidence("deepseek", "v4", {
      terminalTaskCount: 20, relevantSampleCount: 15 })] as const,
    ["qwen\0plus", evidence("qwen", "plus", {
      terminalTaskCount: 20, relevantSampleCount: 15 })] as const,
  ] as Array<[string, RoutingEvidence]>);
  const result = advice(sparse, sparse2, policy, {
    taskFamily: "coding",
    familyEvidenceMap: familyMap,
    competitionIntent: "consider",
    competitionTriggers: ["new-family"],
  });
  // Family evidence is available → new-family should not match
  assert.equal(result.evidenceScope, "task-family");
  assert.equal(result.shouldRunCompetition, false);
  assert.deepEqual(result.competition.matchingTriggers, []);
});

test("new-family trigger is active when family evidence is genuinely missing", () => {
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    competitionOnUncertainty: true,
    competitionTriggersEnabled: ["new-family"],
  };
  // No family evidence → new-family trigger should match
  const result = advice(
    evidence("deepseek", "v4", { terminalTaskCount: 0, relevantSampleCount: 0 }),
    evidence("qwen", "plus", { terminalTaskCount: 0, relevantSampleCount: 0 }),
    policy,
    { competitionIntent: "consider", competitionTriggers: ["new-family"] },
  );
  assert.equal(result.evidenceScope, "none");
  assert.equal(result.shouldRunCompetition, true);
  assert.deepEqual(result.competition.matchingTriggers, ["new-family"]);
});

test("candidate results carry runtime and effort when provided", () => {
  const result = provideRoutingAdvice({
    taskClass: "coding:test",
    candidates: [
      { provider: "deepseek", model: "v4", runtime: "claude-code", effort: "high" },
      { provider: "qwen", model: "plus", runtime: "claude-code", effort: "medium" },
    ],
    evidenceMap: new Map([
      ["deepseek\0v4\0claude-code\0high", evidence("deepseek", "v4")],
      ["qwen\0plus\0claude-code\0medium", evidence("qwen", "plus")],
    ]),
    policy: DEFAULT_ROUTING_POLICY,
  });
  const deepseek = result.candidates.find((c) => c.provider === "deepseek")!;
  const qwen = result.candidates.find((c) => c.provider === "qwen")!;
  assert.equal(deepseek.runtime, "claude-code");
  assert.equal(deepseek.effort, "high");
  assert.equal(qwen.effort, "medium");
});

test("same provider/model with different runtime or effort stays separate", () => {
  const result = provideRoutingAdvice({
    taskClass: "coding:test",
    candidates: [
      { provider: "xai", model: "grok-4.5", runtime: "grok-build", effort: "high" },
      { provider: "xai", model: "grok-4.5", runtime: "grok-build", effort: "max" },
    ],
    evidenceMap: new Map([
      ["xai\0grok-4.5\0grok-build\0high", evidence("xai", "grok-4.5", { relevantSampleCount: 8, acceptedDeliveryRate: 1 })],
      ["xai\0grok-4.5\0grok-build\0max", evidence("xai", "grok-4.5", { relevantSampleCount: 8, acceptedDeliveryRate: 0 })],
    ]),
    policy: DEFAULT_ROUTING_POLICY,
  });
  assert.equal(result.evidenceScope, "exact-class");
  assert.notEqual(result.candidates[0]!.totalScore, result.candidates[1]!.totalScore);
});

test("legacy provider/model-only candidates omit runtime and effort", () => {
  const result = advice(evidence("deepseek", "v4"), evidence("qwen", "plus"));
  assert.equal(result.candidates[0]!.runtime, undefined);
  assert.equal(result.candidates[0]!.effort, undefined);
});

test("competition advisory fields are present and have correct types in every response", () => {
  const result = advice(evidence("deepseek", "v4"), evidence("qwen", "plus"));
  assert.ok(typeof result.knowledge === "string");
  assert.ok(typeof result.evidenceScope === "string");
  const comp = result.competition;
  assert.ok(typeof comp.shouldRunCompetition === "boolean");
  assert.ok(typeof comp.intent === "string");
  assert.ok(Array.isArray(comp.evaluatedTriggers));
  assert.ok(Array.isArray(comp.matchingTriggers));
  assert.ok(typeof comp.suggestedCandidates === "number");
  assert.equal(result.shouldRunCompetition, comp.shouldRunCompetition);
});

// --- Profile identity preservation (M3 Worker Profile routing) -------------

test("profile identity survives scoring and sorting on every candidate and recommendation", () => {
  const result = provideRoutingAdvice({
    taskClass: "coding:test",
    candidates: [
      {
        provider: "deepseek", model: "v4", runtime: "claude-code", effort: "high",
        workerProfileId: "deepseek-primary", workerLabel: "DeepSeek Primary",
      },
      {
        provider: "qwen", model: "plus", runtime: "claude-code", effort: "medium",
        workerProfileId: "qwen-secondary", workerLabel: "Qwen Secondary",
      },
    ],
    evidenceMap: new Map([
      ["deepseek\0v4\0claude-code\0high", evidence("deepseek", "v4")],
      ["qwen\0plus\0claude-code\0medium", evidence("qwen", "plus", {
        modelQualityFailureCount: 8, modelQualityFailureRate: 0.8,
        correctionChurn: 8, correctionChurnRate: 0.8,
        acceptedDeliveryCount: 2, acceptedDeliveryRate: 0.2,
        verifiedBehaviorCount: 2, verifiedBehaviorRate: 0.2,
      })],
    ]),
    policy: DEFAULT_ROUTING_POLICY,
  });
  assert.equal(result.knowledge, "recommendation");
  assert.equal(result.recommendation?.workerProfileId, "deepseek-primary");
  assert.equal(result.recommendation?.workerLabel, "DeepSeek Primary");
  const deepseek = result.candidates.find((c) => c.workerProfileId === "deepseek-primary")!;
  assert.equal(deepseek.workerLabel, "DeepSeek Primary");
  assert.equal(deepseek.provider, "deepseek");
  assert.equal(deepseek.runtime, "claude-code");
  assert.equal(deepseek.effort, "high");
  const qwen = result.candidates.find((c) => c.workerProfileId === "qwen-secondary")!;
  assert.equal(qwen.workerLabel, "Qwen Secondary");
  assert.equal(qwen.workerProfileId, "qwen-secondary");
  // The sorted top candidate carries the same Profile binding.
  assert.equal(result.candidates[0]!.workerProfileId, "deepseek-primary");
  assert.equal(result.candidates[0]!.workerLabel, "DeepSeek Primary");
});

test("two Profiles sharing provider/model stay two distinct candidates even with identical full identity", () => {
  const result = provideRoutingAdvice({
    taskClass: "coding:test",
    candidates: [
      {
        provider: "xai", model: "grok-4.5", runtime: "grok-build", effort: "high",
        workerProfileId: "grok-fast", workerLabel: "Grok Fast",
      },
      {
        provider: "xai", model: "grok-4.5", runtime: "grok-build", effort: "high",
        workerProfileId: "grok-thorough", workerLabel: "Grok Thorough",
      },
    ],
    evidenceMap: new Map(),
    policy: DEFAULT_ROUTING_POLICY,
  });
  assert.equal(result.candidates.length, 2);
  const ids = result.candidates.map((c) => c.workerProfileId).sort();
  assert.deepEqual(ids, ["grok-fast", "grok-thorough"]);
  const fast = result.candidates.find((c) => c.workerProfileId === "grok-fast")!;
  const thorough = result.candidates.find((c) => c.workerProfileId === "grok-thorough")!;
  assert.equal(fast.provider, "xai");
  assert.equal(thorough.provider, "xai");
  assert.equal(fast.model, thorough.model);
  assert.equal(fast.runtime, thorough.runtime);
  assert.equal(fast.effort, thorough.effort);
  assert.equal(fast.workerLabel, "Grok Fast");
  assert.equal(thorough.workerLabel, "Grok Thorough");
  // No result-to-Profile binding is lost after sorting.
  assert.ok(result.candidates.some((c) => c.workerProfileId === "grok-fast"));
  assert.ok(result.candidates.some((c) => c.workerProfileId === "grok-thorough"));
});

test("legacy provider/model candidates never carry fabricated profile fields", () => {
  const result = advice(evidence("deepseek", "v4"), evidence("qwen", "plus"));
  assert.equal(result.candidates[0]!.workerProfileId, undefined);
  assert.equal(result.candidates[0]!.workerLabel, undefined);
  assert.equal(result.candidates[1]!.workerProfileId, undefined);
  assert.equal(result.recommendation?.workerProfileId, undefined);
  assert.equal(result.recommendation?.workerLabel, undefined);
  // Recommendation-less responses also omit profile fields.
  const unknown = advice(
    evidence("deepseek", "v4", { relevantSampleCount: 0, terminalTaskCount: 0 }),
    evidence("qwen", "plus", { relevantSampleCount: 0, terminalTaskCount: 0 }),
  );
  assert.equal(unknown.recommendation, undefined);
  assert.equal(unknown.candidates[0]!.workerProfileId, undefined);
});

test("profile identity serializes privacy-safe with no endpoint or credential leak", () => {
  const result = provideRoutingAdvice({
    taskClass: "coding:test",
    candidates: [
      {
        provider: "deepseek", model: "v4", runtime: "claude-code", effort: "high",
        workerProfileId: "deepseek-primary", workerLabel: "DeepSeek Primary",
      },
      {
        provider: "qwen", model: "plus", runtime: "claude-code", effort: "medium",
        workerProfileId: "qwen-secondary", workerLabel: "Qwen Secondary",
      },
    ],
    evidenceMap: new Map(),
    policy: DEFAULT_ROUTING_POLICY,
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /taskId|attemptId|rawLog|apiKey|endpoint|sourcePath|diagnostic/i);
  assert.match(serialized, /"workerProfileId":"deepseek-primary"/);
  assert.match(serialized, /"workerLabel":"DeepSeek Primary"/);
  assert.match(serialized, /"workerProfileId":"qwen-secondary"/);
});

// --- Evidence-ready subset cohort (M3 V2) ------------------------------------

/** Multi-candidate advice helper that accepts arbitrary candidates. */
function multiAdvice(
  candidates: Array<{
    provider: string; model: string;
    runtime?: string; effort?: string;
    workerProfileId?: string; workerLabel?: string;
  }>,
  evidenceMap: Map<string, RoutingEvidence>,
  policy: RoutingPolicySettings = DEFAULT_ROUTING_POLICY,
  opts?: {
    taskFamily?: string;
    familyEvidenceMap?: Map<string, RoutingEvidence>;
    competitionIntent?: CompetitionIntent;
    competitionTriggers?: CompetitionTrigger[];
  },
) {
  return provideRoutingAdvice({
    taskClass: "coding:test",
    candidates,
    evidenceMap,
    policy,
    ...(opts?.taskFamily !== undefined ? { taskFamily: opts.taskFamily } : {}),
    ...(opts?.familyEvidenceMap !== undefined
      ? { familyEvidenceMap: opts.familyEvidenceMap } : {}),
    ...(opts?.competitionIntent !== undefined
      ? { competitionIntent: opts.competitionIntent } : {}),
    ...(opts?.competitionTriggers !== undefined
      ? { competitionTriggers: opts.competitionTriggers } : {}),
  });
}

test("evidence-ready cohort: two ready + two unknown forms exact cohort and keeps excluded eligible", () => {
  const readyA = evidence("deepseek", "v4", { relevantSampleCount: 10, acceptedDeliveryCount: 10 });
  const readyB = evidence("qwen", "plus", {
    relevantSampleCount: 10, acceptedDeliveryCount: 2, acceptedDeliveryRate: 0.2,
    modelQualityFailureCount: 8, modelQualityFailureRate: 0.8,
    verifiedBehaviorCount: 2, verifiedBehaviorRate: 0.2,
  });
  const unknownC = evidence("minimax", "m2", {
    terminalTaskCount: 0, relevantSampleCount: 0,
  });
  const unknownD = evidence("xai", "grok-4.5", {
    terminalTaskCount: 0, relevantSampleCount: 0,
  });
  const result = multiAdvice(
    [
      { provider: "deepseek", model: "v4" },
      { provider: "qwen", model: "plus" },
      { provider: "minimax", model: "m2" },
      { provider: "xai", model: "grok-4.5" },
    ],
    new Map([
      ["deepseek\0v4", readyA],
      ["qwen\0plus", readyB],
      ["minimax\0m2", unknownC],
      ["xai\0grok-4.5", unknownD],
    ]),
  );
  assert.equal(result.evidenceScope, "exact-class");
  assert.equal(result.knowledge, "recommendation");
  assert.equal(result.recommendation?.provider, "deepseek");
  assert.equal(result.allCandidatesCompared, false);
  assert.equal(result.cohortCandidateCount, 2);
  assert.equal(result.totalCandidateCount, 4);

  // Cohort members get compared and have real scores.
  const deepseek = result.candidates.find((c) => c.provider === "deepseek")!;
  const qwen = result.candidates.find((c) => c.provider === "qwen")!;
  assert.equal(deepseek.cohortParticipation, "compared");
  assert.equal(qwen.cohortParticipation, "compared");
  assert.ok(deepseek.totalScore > qwen.totalScore);

  // Excluded candidates stay eligible with zero score and insufficient evidence.
  const minimax = result.candidates.find((c) => c.provider === "minimax")!;
  const grok = result.candidates.find((c) => c.provider === "xai")!;
  assert.equal(minimax.cohortParticipation, "insufficient-evidence");
  assert.equal(grok.cohortParticipation, "insufficient-evidence");
  assert.equal(minimax.totalScore, 0);
  assert.equal(grok.totalScore, 0);
  assert.equal(minimax.eligible, true);
  assert.equal(grok.eligible, true);
  assert.ok(minimax.uncertainty.insufficientSamples);
  assert.ok(grok.uncertainty.insufficientSamples);
  for (const f of minimax.factors) {
    assert.equal(f.available, false);
    assert.equal(f.unavailableReason, "candidate-excluded-from-comparison");
    assert.equal(f.weightedScore, 0);
  }
  for (const f of grok.factors) {
    assert.equal(f.available, false);
    assert.equal(f.unavailableReason, "candidate-excluded-from-comparison");
    assert.equal(f.weightedScore, 0);
  }

  // Serialization is privacy-safe.
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /taskId|attemptId|rawLog|apiKey|endpoint|sourcePath|diagnostic/i);
  assert.match(serialized, /"cohortParticipation":"compared"/);
  assert.match(serialized, /"cohortParticipation":"insufficient-evidence"/);
  assert.match(serialized, /"allCandidatesCompared":false/);
  assert.match(serialized, /"cohortCandidateCount":2/);
  assert.match(serialized, /"totalCandidateCount":4/);
});

test("evidence-ready cohort: family fallback when exact is insufficient but family has three ready identities", () => {
  // Exact is sparse for all four candidates.
  const sparseA = evidence("deepseek", "v4", { terminalTaskCount: 2, relevantSampleCount: 2 });
  const sparseB = evidence("qwen", "plus", { terminalTaskCount: 2, relevantSampleCount: 2 });
  const sparseC = evidence("minimax", "m2", { terminalTaskCount: 2, relevantSampleCount: 2 });
  const sparseD = evidence("xai", "grok-4.5", { terminalTaskCount: 0, relevantSampleCount: 0 });

  // Family evidence: three have sufficient records, one is zero.
  const familyMap = new Map([
    ["deepseek\0v4", evidence("deepseek", "v4", {
      terminalTaskCount: 20, relevantSampleCount: 15, acceptedDeliveryCount: 15,
    })] as const,
    ["qwen\0plus", evidence("qwen", "plus", {
      terminalTaskCount: 20, relevantSampleCount: 10, acceptedDeliveryCount: 5,
      acceptedDeliveryRate: 0.5, modelQualityFailureCount: 5, modelQualityFailureRate: 0.5,
    })] as const,
    ["minimax\0m2", evidence("minimax", "m2", {
      terminalTaskCount: 15, relevantSampleCount: 8, acceptedDeliveryCount: 6,
      acceptedDeliveryRate: 0.75,
    })] as const,
    ["xai\0grok-4.5", evidence("xai", "grok-4.5", {
      terminalTaskCount: 0, relevantSampleCount: 0,
    })] as const,
  ] as Array<[string, RoutingEvidence]>);

  const result = multiAdvice(
    [
      { provider: "deepseek", model: "v4" },
      { provider: "qwen", model: "plus" },
      { provider: "minimax", model: "m2" },
      { provider: "xai", model: "grok-4.5" },
    ],
    new Map([
      ["deepseek\0v4", sparseA],
      ["qwen\0plus", sparseB],
      ["minimax\0m2", sparseC],
      ["xai\0grok-4.5", sparseD],
    ]),
    DEFAULT_ROUTING_POLICY,
    { taskFamily: "coding", familyEvidenceMap: familyMap },
  );
  assert.equal(result.evidenceScope, "task-family");
  assert.equal(result.knowledge, "recommendation");
  assert.equal(result.recommendation?.provider, "deepseek");
  assert.equal(result.allCandidatesCompared, false);
  assert.equal(result.cohortCandidateCount, 3);
  assert.equal(result.totalCandidateCount, 4);

  const grok = result.candidates.find((c) => c.provider === "xai")!;
  assert.equal(grok.cohortParticipation, "insufficient-evidence");
  assert.equal(grok.totalScore, 0);
  assert.equal(grok.eligible, true);

  // Cohort candidates get scored.
  const deepseek = result.candidates.find((c) => c.provider === "deepseek")!;
  assert.equal(deepseek.cohortParticipation, "compared");
  assert.ok(deepseek.totalScore > 0);
});

test("evidence-ready cohort: only one ready identity means no cohort and no recommendation", () => {
  const onlyReady = evidence("deepseek", "v4", { relevantSampleCount: 10, acceptedDeliveryCount: 10 });
  const unknown1 = evidence("qwen", "plus", { terminalTaskCount: 0, relevantSampleCount: 0 });
  const unknown2 = evidence("minimax", "m2", { terminalTaskCount: 0, relevantSampleCount: 0 });

  const result = multiAdvice(
    [
      { provider: "deepseek", model: "v4" },
      { provider: "qwen", model: "plus" },
      { provider: "minimax", model: "m2" },
    ],
    new Map([
      ["deepseek\0v4", onlyReady],
      ["qwen\0plus", unknown1],
      ["minimax\0m2", unknown2],
    ]),
  );
  assert.equal(result.evidenceScope, "none");
  assert.equal(result.knowledge, "unknown");
  assert.equal(result.recommendation, undefined);
  assert.equal(result.allCandidatesCompared, false);
  assert.equal(result.cohortCandidateCount, 0);
  assert.equal(result.totalCandidateCount, 3);

  // All candidates have insufficient samples; the ready one is not scored alone.
  for (const c of result.candidates) {
    assert.ok(c.uncertainty.insufficientSamples);
    assert.ok(c.uncertainty.reasons.includes("insufficient-relevant-samples"));
    assert.equal(c.totalScore, 0);
  }
});

test("evidence-ready cohort: duplicate routing identities do not count as independent comparison points", () => {
  // Two profiles with the same provider+model+runtime+effort count as one identity.
  // Both meet the threshold but don't form a cohort because only 1 distinct identity.
  const sameA = evidence("deepseek", "v4", { relevantSampleCount: 10, acceptedDeliveryCount: 10 });

  const result = provideRoutingAdvice({
    taskClass: "coding:test",
    candidates: [
      { provider: "deepseek", model: "v4", runtime: "claude-code", effort: "high", workerProfileId: "ds-1" },
      { provider: "deepseek", model: "v4", runtime: "claude-code", effort: "high", workerProfileId: "ds-2" },
    ],
    evidenceMap: new Map([
      ["deepseek\0v4\0claude-code\0high", sameA],
    ]),
    policy: DEFAULT_ROUTING_POLICY,
  });
  // Both share the same routing identity → only 1 distinct → no cohort.
  assert.equal(result.evidenceScope, "none");
  assert.equal(result.knowledge, "unknown");
  assert.equal(result.recommendation, undefined);
  assert.equal(result.candidates.length, 2);
  // Both profiles are still present and eligible.
  assert.deepEqual(result.candidates.map((c) => c.workerProfileId).sort(), ["ds-1", "ds-2"]);
});

test("evidence-ready cohort: duplicate identities plus a second distinct identity still forms a cohort", () => {
  // Two Profiles share the same full identity, a third has a different identity.
  // The two distinct identities (deepseek + qwen) form a cohort; both duplicate
  // deepseek profiles participate in the cohort.
  const dsA = evidence("deepseek", "v4", { relevantSampleCount: 10, acceptedDeliveryCount: 10 });
  const qw = evidence("qwen", "plus", {
    relevantSampleCount: 10, modelQualityFailureCount: 8, modelQualityFailureRate: 0.8,
    acceptedDeliveryCount: 2, acceptedDeliveryRate: 0.2,
  });

  const result = provideRoutingAdvice({
    taskClass: "coding:test",
    candidates: [
      { provider: "deepseek", model: "v4", runtime: "claude-code", effort: "high", workerProfileId: "ds-1" },
      { provider: "deepseek", model: "v4", runtime: "claude-code", effort: "high", workerProfileId: "ds-2" },
      { provider: "qwen", model: "plus", runtime: "claude-code", effort: "medium", workerProfileId: "qw-1" },
    ],
    evidenceMap: new Map([
      ["deepseek\0v4\0claude-code\0high", dsA],
      ["qwen\0plus\0claude-code\0medium", qw],
    ]),
    policy: DEFAULT_ROUTING_POLICY,
  });
  // Cohort forms: 2 distinct identities (deepseek + qwen), 3 candidates.
  assert.equal(result.evidenceScope, "exact-class");
  assert.equal(result.knowledge, "recommendation");
  assert.equal(result.distinctIdentityCount, 2);
  assert.equal(result.cohortCandidateCount, 3);
  assert.equal(result.allCandidatesCompared, true);
  // recommendationCoverage is "all-candidates" since all 3 are compared.
  assert.equal(result.recommendationCoverage, "all-candidates");
  assert.equal(result.recommendation?.coverage, "all-candidates");
  assert.equal(result.recommendation?.provider, "deepseek");
  assert.equal(result.recommendation?.model, "v4");
  assert.equal(result.recommendation?.workerProfileId, undefined,
    "shared evidence cannot arbitrarily choose one equivalent Profile");
  assert.match(result.recommendation?.reasoning ?? "", /equivalent-profiles:2/);
  // Both deepseek profiles are in the cohort.
  assert.equal(
    result.candidates.filter((c) => c.cohortParticipation === "compared").length,
    3,
  );
});

test("evidence-ready cohort: exact-class precedence over larger family cohort", () => {
  // Exact: deepseek and qwen meet threshold (2 identities).
  // Family: minimax also meets family threshold (3 identities).
  // Exact should win even though family has more members.
  const exactReadyA = evidence("deepseek", "v4", { relevantSampleCount: 10, acceptedDeliveryCount: 10 });
  const exactReadyB = evidence("qwen", "plus", {
    relevantSampleCount: 10, acceptedDeliveryCount: 2, acceptedDeliveryRate: 0.2,
    modelQualityFailureCount: 8, modelQualityFailureRate: 0.8,
    verifiedBehaviorCount: 2, verifiedBehaviorRate: 0.2,
  });
  const exactSparse = evidence("minimax", "m2", { terminalTaskCount: 2, relevantSampleCount: 2 });

  const familyMap = new Map([
    ["deepseek\0v4", evidence("deepseek", "v4", { terminalTaskCount: 30, relevantSampleCount: 25 })] as const,
    ["qwen\0plus", evidence("qwen", "plus", { terminalTaskCount: 30, relevantSampleCount: 20 })] as const,
    ["minimax\0m2", evidence("minimax", "m2", { terminalTaskCount: 15, relevantSampleCount: 10 })] as const,
  ] as Array<[string, RoutingEvidence]>);

  const result = multiAdvice(
    [
      { provider: "deepseek", model: "v4" },
      { provider: "qwen", model: "plus" },
      { provider: "minimax", model: "m2" },
    ],
    new Map([
      ["deepseek\0v4", exactReadyA],
      ["qwen\0plus", exactReadyB],
      ["minimax\0m2", exactSparse],
    ]),
    DEFAULT_ROUTING_POLICY,
    { taskFamily: "coding", familyEvidenceMap: familyMap },
  );
  // Exact scope wins even though family would have 3 members.
  assert.equal(result.evidenceScope, "exact-class");
  assert.equal(result.knowledge, "recommendation");
  assert.equal(result.cohortCandidateCount, 2);
  // minimax excluded from exact cohort.
  const minimax = result.candidates.find((c) => c.provider === "minimax")!;
  assert.equal(minimax.cohortParticipation, "insufficient-evidence");
  assert.equal(minimax.totalScore, 0);
});

test("evidence-ready cohort: family factor coverage uses familyMinRelevantSamples, not exact threshold", () => {
  const customFamilyThreshold = 8;
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    familyMinRelevantSamples: customFamilyThreshold,
    minRelevantSamples: 5,
    weights: { ...DEFAULT_ROUTING_POLICY.weights, acceptedDelivery: 1 },
  };

  // Exact: sparse (2 each).
  const sparseA = evidence("deepseek", "v4", { terminalTaskCount: 2, relevantSampleCount: 2 });
  const sparseB = evidence("qwen", "plus", { terminalTaskCount: 2, relevantSampleCount: 2 });

  // Family: both have 8 exactly (meeting the family threshold, not the default 5).
  const familyMap = new Map([
    ["deepseek\0v4", evidence("deepseek", "v4", {
      terminalTaskCount: 12, relevantSampleCount: 8,
      acceptedDeliveryCount: 8, acceptedDeliverySampleCount: 8,
      acceptedDeliveryRate: 1,
    })] as const,
    ["qwen\0plus", evidence("qwen", "plus", {
      terminalTaskCount: 10, relevantSampleCount: 8,
      acceptedDeliveryCount: 4, acceptedDeliverySampleCount: 8,
      acceptedDeliveryRate: 0.5,
    })] as const,
  ] as Array<[string, RoutingEvidence]>);

  const result = multiAdvice(
    [
      { provider: "deepseek", model: "v4" },
      { provider: "qwen", model: "plus" },
    ],
    new Map([
      ["deepseek\0v4", sparseA],
      ["qwen\0plus", sparseB],
    ]),
    policy,
    { taskFamily: "coding", familyEvidenceMap: familyMap },
  );
  assert.equal(result.evidenceScope, "task-family");
  // acceptedDelivery factor should use family min (8), not exact min (5).
  // With exactly 8 samples for acceptedDelivery on each, factor is available.
  const deepseekFactor = result.candidates
    .find((c) => c.provider === "deepseek")!
    .factors.find((f) => f.factor === "acceptedDelivery")!;
  assert.equal(deepseekFactor.available, true);
});

test("evidence-ready cohort: strict mode blocks cohort but excluded candidates are not the cause", () => {
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    missingEvidenceMode: "strict",
    weights: { ...DEFAULT_ROUTING_POLICY.weights, acceptedDelivery: 1 },
  };
  // Cohort member deepseek has incomplete acceptedDelivery evidence.
  const complete = evidence("qwen", "plus", {
    relevantSampleCount: 10, acceptedDeliveryCount: 10,
    acceptedDeliverySampleCount: 10, acceptedDeliveryRate: 1,
  });
  const incomplete = evidence("deepseek", "v4", {
    relevantSampleCount: 10, acceptedDeliveryCount: 0,
    acceptedDeliverySampleCount: 2, acceptedDeliveryRate: 0,
    acceptedDeliveryUnavailableCount: 8,
  });
  const unknown = evidence("minimax", "m2", {
    terminalTaskCount: 0, relevantSampleCount: 0,
  });

  const result = multiAdvice(
    [
      { provider: "deepseek", model: "v4" },
      { provider: "qwen", model: "plus" },
      { provider: "minimax", model: "m2" },
    ],
    new Map([
      ["deepseek\0v4", incomplete],
      ["qwen\0plus", complete],
      ["minimax\0m2", unknown],
    ]),
    policy,
  );
  // Strict mode blocks the cohort because a factor is unavailable within it.
  assert.equal(result.knowledge, "unknown");
  assert.equal(result.recommendation, undefined);

  // Cohort members (deepseek, qwen) get positive-factor-unavailable.
  const deepseek = result.candidates.find((c) => c.provider === "deepseek")!;
  const qwen = result.candidates.find((c) => c.provider === "qwen")!;
  assert.ok(deepseek.uncertainty.reasons.includes("positive-factor-unavailable"));
  assert.ok(qwen.uncertainty.reasons.includes("positive-factor-unavailable"));

  // Excluded candidate (minimax) does NOT get positive-factor-unavailable — it
  // was never in the cohort to begin with. It gets insufficient-relevant-samples.
  const minimax = result.candidates.find((c) => c.provider === "minimax")!;
  assert.ok(minimax.uncertainty.reasons.includes("insufficient-relevant-samples"));
  assert.equal(
    minimax.uncertainty.reasons.includes("positive-factor-unavailable"),
    false,
    "excluded candidates must not get positive-factor-unavailable",
  );
});

test("evidence-ready cohort: no auto-Competition from subset knowledge alone", () => {
  const readyA = evidence("deepseek", "v4", { relevantSampleCount: 10, acceptedDeliveryCount: 10 });
  const readyB = evidence("qwen", "plus", {
    relevantSampleCount: 10, modelQualityFailureCount: 8, modelQualityFailureRate: 0.8,
    acceptedDeliveryCount: 2, acceptedDeliveryRate: 0.2,
    verifiedBehaviorCount: 2, verifiedBehaviorRate: 0.2,
  });
  const unknown = evidence("minimax", "m2", { terminalTaskCount: 0, relevantSampleCount: 0 });

  const result = multiAdvice(
    [
      { provider: "deepseek", model: "v4" },
      { provider: "qwen", model: "plus" },
      { provider: "minimax", model: "m2" },
    ],
    new Map([
      ["deepseek\0v4", readyA],
      ["qwen\0plus", readyB],
      ["minimax\0m2", unknown],
    ]),
    DEFAULT_ROUTING_POLICY,
    { competitionIntent: "none" },
  );
  // Evidence produces a recommendation, but Competition intent is none.
  assert.equal(result.knowledge, "recommendation");
  assert.equal(result.shouldRunCompetition, false);
  assert.equal(result.competition.intent, "none");
  assert.equal(result.competition.shouldRunCompetition, false);
  assert.deepEqual(result.competition.matchingTriggers, []);
});

test("evidence-ready cohort: family threshold is independently configurable and used for all factor gates", () => {
  const familyThreshold = 10;
  const policy: RoutingPolicySettings = {
    ...DEFAULT_ROUTING_POLICY,
    minRelevantSamples: 5, // exact uses 5
    familyMinRelevantSamples: familyThreshold, // family uses 10
    weights: { ...DEFAULT_ROUTING_POLICY.weights, acceptedDelivery: 1, firstPassSuccess: 1 },
  };

  // Exact is sparse.
  const sparseA = evidence("deepseek", "v4", { terminalTaskCount: 1, relevantSampleCount: 1 });
  const sparseB = evidence("qwen", "plus", { terminalTaskCount: 1, relevantSampleCount: 1 });

  // Family: each has exactly 10 relevant + accepted delivery + first-pass samples.
  const familyMap = new Map([
    ["deepseek\0v4", evidence("deepseek", "v4", {
      terminalTaskCount: 15, relevantSampleCount: 10,
      acceptedDeliveryCount: 10, acceptedDeliverySampleCount: 10, acceptedDeliveryRate: 1,
      firstPassVerifiedSampleCount: 10, firstPassVerifiedSuccessCount: 8,
      firstPassVerifiedSuccessRate: 0.8,
    })] as const,
    ["qwen\0plus", evidence("qwen", "plus", {
      terminalTaskCount: 12, relevantSampleCount: 10,
      acceptedDeliveryCount: 5, acceptedDeliverySampleCount: 10, acceptedDeliveryRate: 0.5,
      firstPassVerifiedSampleCount: 10, firstPassVerifiedSuccessCount: 4,
      firstPassVerifiedSuccessRate: 0.4,
    })] as const,
  ] as Array<[string, RoutingEvidence]>);

  const result = multiAdvice(
    [
      { provider: "deepseek", model: "v4" },
      { provider: "qwen", model: "plus" },
    ],
    new Map([
      ["deepseek\0v4", sparseA],
      ["qwen\0plus", sparseB],
    ]),
    policy,
    { taskFamily: "coding", familyEvidenceMap: familyMap },
  );
  assert.equal(result.evidenceScope, "task-family");
  // Factor gates must use familyMinRelevantSamples (10), not minRelevantSamples (5).
  // With 10 samples on each, factors are available.
  const deepseek = result.candidates.find((c) => c.provider === "deepseek")!;
  assert.equal(
    deepseek.factors.find((f) => f.factor === "acceptedDelivery")?.available,
    true,
  );
  assert.equal(
    deepseek.factors.find((f) => f.factor === "firstPassSuccess")?.available,
    true,
  );
  // Resolved policy carries both thresholds.
  assert.equal(result.resolvedPolicy.familyMinRelevantSamples, familyThreshold);
  assert.equal(result.resolvedPolicy.minRelevantSamples, 5);
});

test("evidence-ready cohort: allCandidatesCompared is true when every candidate is in the cohort", () => {
  const readyA = evidence("deepseek", "v4", { relevantSampleCount: 10, acceptedDeliveryCount: 10 });
  const readyB = evidence("qwen", "plus", {
    relevantSampleCount: 10, acceptedDeliveryCount: 2, acceptedDeliveryRate: 0.2,
    modelQualityFailureCount: 8, modelQualityFailureRate: 0.8,
    verifiedBehaviorCount: 2, verifiedBehaviorRate: 0.2,
  });

  const result = multiAdvice(
    [
      { provider: "deepseek", model: "v4" },
      { provider: "qwen", model: "plus" },
    ],
    new Map([
      ["deepseek\0v4", readyA],
      ["qwen\0plus", readyB],
    ]),
  );
  // Both candidates meet exact threshold → all compared.
  assert.equal(result.allCandidatesCompared, true);
  assert.equal(result.cohortCandidateCount, 2);
  assert.equal(result.totalCandidateCount, 2);
  assert.equal(result.knowledge, "recommendation");
});

test("evidence-ready cohort: Core, CLI, and Hub share same canonical coverage facts in serialization", () => {
  const readyA = evidence("deepseek", "v4", { relevantSampleCount: 10, acceptedDeliveryCount: 10 });
  const readyB = evidence("qwen", "plus", {
    relevantSampleCount: 10, acceptedDeliveryCount: 2, acceptedDeliveryRate: 0.2,
    modelQualityFailureCount: 8, modelQualityFailureRate: 0.8,
  });
  const unknownC = evidence("minimax", "m2", { terminalTaskCount: 0, relevantSampleCount: 0 });

  const result = multiAdvice(
    [
      { provider: "deepseek", model: "v4", workerProfileId: "ds-1", workerLabel: "DS" },
      { provider: "qwen", model: "plus", workerProfileId: "qw-1", workerLabel: "QW" },
      { provider: "minimax", model: "m2", workerProfileId: "mm-1", workerLabel: "MM" },
    ],
    new Map([
      ["deepseek\0v4", readyA],
      ["qwen\0plus", readyB],
      ["minimax\0m2", unknownC],
    ]),
  );
  const serialized = JSON.stringify(result);
  // Canonical coverage fields are all present.
  assert.ok("allCandidatesCompared" in result);
  assert.ok("cohortCandidateCount" in result);
  assert.ok("distinctIdentityCount" in result);
  assert.ok("totalCandidateCount" in result);
  assert.ok("excludedCandidateCount" in result);
  assert.ok("recommendationCoverage" in result);
  assert.match(serialized, /"allCandidatesCompared":false/);
  assert.match(serialized, /"cohortCandidateCount":2/);
  assert.match(serialized, /"totalCandidateCount":3/);
  assert.match(serialized, /"excludedCandidateCount":1/);
  // Participation facts per candidate.
  assert.match(serialized, /"cohortParticipation":"compared"/);
  assert.match(serialized, /"cohortParticipation":"insufficient-evidence"/);
  assert.match(serialized, /"candidate-excluded-from-comparison"/);
  // Privacy-safe: no raw task or credential content.
  assert.doesNotMatch(serialized, /taskId|attemptId|rawLog|apiKey|endpoint|sourcePath|diagnostic/i);
  // Profile identities survive for both cohort and excluded candidates.
  assert.match(serialized, /"workerProfileId":"ds-1"/);
  assert.match(serialized, /"workerProfileId":"mm-1"/);
  // Canonical recommendationCoverage marker.
  assert.match(serialized, /"recommendationCoverage":"evidence-ready-subset"/);
  assert.equal(result.recommendation?.coverage, "evidence-ready-subset");
  assert.match(serialized, /"distinctIdentityCount":2/);
  // comparisonEvidence is present for every candidate.
  assert.match(serialized, /"comparisonEvidence"/);
});

test("evidence-ready cohort: comparisonEvidence reflects family evidence when scope is task-family", () => {
  const sparseA = evidence("deepseek", "v4", { terminalTaskCount: 2, relevantSampleCount: 2 });
  const sparseB = evidence("qwen", "plus", { terminalTaskCount: 2, relevantSampleCount: 2 });

  // Family evidence has different counts than exact evidence.
  const familyMap = new Map([
    ["deepseek\0v4", evidence("deepseek", "v4", {
      terminalTaskCount: 20, relevantSampleCount: 15,
      acceptedDeliveryCount: 15, acceptedDeliveryRate: 1,
    })] as const,
    ["qwen\0plus", evidence("qwen", "plus", {
      terminalTaskCount: 20, relevantSampleCount: 10, acceptedDeliveryCount: 5,
      acceptedDeliveryRate: 0.5,
    })] as const,
  ] as Array<[string, RoutingEvidence]>);

  const result = multiAdvice(
    [
      { provider: "deepseek", model: "v4" },
      { provider: "qwen", model: "plus" },
    ],
    new Map([
      ["deepseek\0v4", sparseA],
      ["qwen\0plus", sparseB],
    ]),
    DEFAULT_ROUTING_POLICY,
    { taskFamily: "coding", familyEvidenceMap: familyMap },
  );
  assert.equal(result.evidenceScope, "task-family");
  // comparisonEvidence must carry family evidence counts, not exact counts.
  const deepseek = result.candidates.find((c) => c.provider === "deepseek")!;
  assert.equal(deepseek.comparisonEvidence.relevantSampleCount, 15,
    "comparisonEvidence must show family sample count, not exact");
  assert.equal(deepseek.evidence.relevantSampleCount, 2,
    "legacy exact evidence is preserved untouched");
  const qwen = result.candidates.find((c) => c.provider === "qwen")!;
  assert.equal(qwen.comparisonEvidence.relevantSampleCount, 10,
    "comparisonEvidence must show family sample count");
});

test("evidence-ready cohort: excluded candidate with partial family evidence retains truthful sample coverage", () => {
  const readyA = evidence("deepseek", "v4", { relevantSampleCount: 10, acceptedDeliveryCount: 10 });
  const readyB = evidence("qwen", "plus", {
    relevantSampleCount: 10, acceptedDeliveryCount: 2, acceptedDeliveryRate: 0.2,
    modelQualityFailureCount: 8, modelQualityFailureRate: 0.8,
  });
  const partial = evidence("minimax", "m2", { terminalTaskCount: 1, relevantSampleCount: 1 });

  const familyMap = new Map([
    ["deepseek\0v4", evidence("deepseek", "v4", { terminalTaskCount: 25, relevantSampleCount: 20 })] as const,
    ["qwen\0plus", evidence("qwen", "plus", { terminalTaskCount: 20, relevantSampleCount: 15 })] as const,
    ["minimax\0m2", evidence("minimax", "m2", { terminalTaskCount: 5, relevantSampleCount: 3 })] as const,
  ] as Array<[string, RoutingEvidence]>);

  const result = multiAdvice(
    [
      { provider: "deepseek", model: "v4" },
      { provider: "qwen", model: "plus" },
      { provider: "minimax", model: "m2" },
    ],
    new Map([
      ["deepseek\0v4", readyA],
      ["qwen\0plus", readyB],
      ["minimax\0m2", partial],
    ]),
    DEFAULT_ROUTING_POLICY,
    { taskFamily: "coding", familyEvidenceMap: familyMap },
  );
  // Exact cohort forms (2 ready), minimax excluded.
  assert.equal(result.evidenceScope, "exact-class");
  const minimax = result.candidates.find((c) => c.provider === "minimax")!;
  assert.equal(minimax.cohortParticipation, "insufficient-evidence");
  // Family sample coverage is still reported truthfully.
  assert.equal(minimax.sampleCoverage.familyRelevantCount, 3);
  assert.equal(minimax.sampleCoverage.familyTerminalCount, 5);
  assert.equal(minimax.sampleCoverage.familyMinRelevantSamples, 5);
  // Excluded, not scored, but family evidence is visible for Main to consider.
  assert.equal(minimax.totalScore, 0);
  assert.equal(minimax.eligible, true);
});

test("evidence-ready cohort: zero-history candidates across the board produce scope none", () => {
  const zeroA = evidence("deepseek", "v4", { terminalTaskCount: 0, relevantSampleCount: 0 });
  const zeroB = evidence("qwen", "plus", { terminalTaskCount: 0, relevantSampleCount: 0 });
  const zeroC = evidence("minimax", "m2", { terminalTaskCount: 0, relevantSampleCount: 0 });

  const result = multiAdvice(
    [
      { provider: "deepseek", model: "v4" },
      { provider: "qwen", model: "plus" },
      { provider: "minimax", model: "m2" },
    ],
    new Map([
      ["deepseek\0v4", zeroA],
      ["qwen\0plus", zeroB],
      ["minimax\0m2", zeroC],
    ]),
  );
  assert.equal(result.evidenceScope, "none");
  assert.equal(result.knowledge, "unknown");
  assert.equal(result.cohortCandidateCount, 0);
  assert.equal(result.totalCandidateCount, 3);
  assert.equal(result.allCandidatesCompared, false);
  for (const c of result.candidates) {
    assert.equal(c.totalScore, 0);
    assert.ok(c.uncertainty.insufficientSamples);
  }
});
