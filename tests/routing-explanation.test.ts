import assert from "node:assert/strict";
import test from "node:test";
import {
  formatRoutingExplanationHuman,
  projectSafeRoutingExplanation,
} from "../src/core/routing-explanation.js";
import type { RoutingDecisionSnapshot } from "../src/core/types.js";

const DEEPSEEK = {
  provider: "deepseek",
  model: "deepseek-v4-flash",
  runtime: "claude-code",
  effort: "high",
  workerProfileId: "default",
};
const QWEN = {
  provider: "qwen",
  model: "qwen3.7-plus",
  runtime: "claude-code",
  effort: "high",
};
const SELECTED_EXECUTION = {
  resolvedExecutionMode: "single-run" as const,
  readinessState: "launchable" as const,
  canLaunch: true,
  nextAction: "none" as const,
};

function snapshot(overrides: Partial<RoutingDecisionSnapshot> = {}): RoutingDecisionSnapshot {
  return {
    shortlist: [DEEPSEEK, QWEN],
    selectedWorker: DEEPSEEK,
    selectedBecause: { code: "user-specified", note: "PRIVATE_M3B_NOTE_NEVER_PROJECT" },
    competition: { intent: "none", triggers: [] },
    evidenceSnapshot: {
      scope: "exact-class",
      exactSampleCounts: { SECRET_M3B_SAMPLE_KEY: 2 },
      settingsDigest: "SECRET_M3B_SETTINGS_DIGEST",
    },
    ...overrides,
  };
}

function project(decision?: RoutingDecisionSnapshot) {
  return projectSafeRoutingExplanation({
    ...(decision === undefined ? {} : { routingDecision: decision }),
    selectedWorker: DEEPSEEK,
    workerProfileId: "default",
    workerProfileLabel: "Default Worker",
  });
}

test("projection of followed-recommendation keeps recommended, selected, confidence, and execution", () => {
  const explanation = project(snapshot({
    advisory: {
      overallResult: "recommended",
      selection: "followed-recommendation",
      recommendedWorker: DEEPSEEK,
      confidence: 0.91,
      selectedExecution: SELECTED_EXECUTION,
    },
  }));
  assert.equal(explanation.present, true);
  assert.equal(explanation.advisory!.overallResult, "recommended");
  assert.equal(explanation.advisory!.selection, "followed-recommendation");
  assert.deepEqual(explanation.advisory!.recommendedWorker, DEEPSEEK);
  assert.equal(explanation.advisory!.confidence, 0.91);
  assert.deepEqual(explanation.advisory!.selectedExecution, SELECTED_EXECUTION);
  assert.equal(explanation.selectedWorker.provider, "deepseek");
  const human = formatRoutingExplanationHuman(explanation);
  assert.match(human, /Advisory result: recommended/);
  assert.match(human, /Selection: followed-recommendation/);
  assert.match(human, /Confidence: 0\.91/);
  assert.match(human, /Selected execution mode: single-run/);
});

test("projection of manual-override keeps both identities and never emits the private note", () => {
  const explanation = project(snapshot({
    advisory: {
      overallResult: "recommended",
      selection: "manual-override",
      recommendedWorker: QWEN,
      confidence: 0.84,
      selectedExecution: SELECTED_EXECUTION,
    },
  }));
  assert.equal(explanation.advisory!.selection, "manual-override");
  assert.deepEqual(explanation.advisory!.recommendedWorker, QWEN);
  assert.equal(explanation.advisory!.confidence, 0.84);
  const serialized = JSON.stringify(explanation);
  assert.ok(!serialized.includes("PRIVATE_M3B_NOTE_NEVER_PROJECT"));
  assert.ok(!serialized.includes("SECRET_M3B_SETTINGS_DIGEST"));
  assert.ok(!serialized.includes("SECRET_M3B_SAMPLE_KEY"));
  assert.ok(!serialized.includes("settingsDigest"));
  const human = formatRoutingExplanationHuman(explanation);
  assert.ok(!human.includes("PRIVATE_M3B_NOTE_NEVER_PROJECT"));
  assert.ok(!human.includes("SECRET_M3B_SAMPLE_KEY"));
  assert.match(human, /Recommended: qwen\/qwen3\.7-plus/);
});

test("projection of cannot-determine stores no recommendation or confidence and implies no superiority", () => {
  const explanation = project(snapshot({
    advisory: {
      overallResult: "cannot-determine",
      selection: "selected-after-cannot-determine",
      cannotDetermineReasons: ["insufficient-relevant-samples"],
      selectedExecution: SELECTED_EXECUTION,
    },
  }));
  assert.equal(explanation.advisory!.overallResult, "cannot-determine");
  assert.equal(explanation.advisory!.selection, "selected-after-cannot-determine");
  assert.equal(explanation.advisory!.recommendedWorker, undefined);
  assert.equal(explanation.advisory!.confidence, undefined);
  assert.deepEqual(
    explanation.advisory!.cannotDetermineReasons,
    ["insufficient-relevant-samples"],
  );
  const human = formatRoutingExplanationHuman(explanation);
  assert.match(human, /Advisory result: cannot-determine/);
  assert.match(human, /Selection: selected-after-cannot-determine/);
  assert.match(human, /Cannot determine because: insufficient-relevant-samples/);
  assert.doesNotMatch(human, /Recommended:/);
  assert.doesNotMatch(human, /Confidence:/);
  assert.doesNotMatch(human, /best|superior|winner/i);
});

test("legacy decision and missing routingDecision invent no advisory relationship", () => {
  const legacy = project(snapshot());
  assert.equal(legacy.present, true);
  assert.equal(legacy.advisory, null);
  assert.equal(legacy.basis, "user-specified");
  const missing = project();
  assert.equal(missing.present, false);
  assert.equal(missing.advisory, null);
  assert.equal(missing.nextAction, "not-recorded");
  const human = formatRoutingExplanationHuman(legacy);
  assert.doesNotMatch(human, /Advisory result:/);
  assert.doesNotMatch(human, /followed-recommendation|manual-override|selected-after-cannot-determine/);
});
