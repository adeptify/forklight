import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ROUTING_POLICY,
  failureImpactFor,
  provideRoutingAdvice,
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
    acceptedDeliveryRate: 1,
    verifiedBehaviorSampleCount: 10,
    verifiedBehaviorCount: 10,
    verifiedBehaviorRate: 1,
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
  assert.equal(actual.acceptedDeliveryCount, 1);
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
  assert.equal(actual.modelQualityFailureCount, 1);
  assert.equal(actual.correctionChurn, 2);
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

test("insufficient or close evidence produces no recommendation and optional competition", () => {
  const sparse = advice(
    evidence("deepseek", "v4", { terminalTaskCount: 2, relevantSampleCount: 2 }),
    evidence("qwen", "plus", { terminalTaskCount: 1, relevantSampleCount: 1 }),
  );
  assert.equal(sparse.recommendation, undefined);
  assert.equal(sparse.shouldRunCompetition, true);

  const close = advice(evidence("deepseek", "v4"), evidence("qwen", "plus"));
  assert.equal(close.recommendation, undefined);
  assert.equal(close.shouldRunCompetition, true);
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
  assert.ok("officialCost" in w);
  assert.ok("duration" in w);
  assert.ok("budgetReliability" in w);
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
