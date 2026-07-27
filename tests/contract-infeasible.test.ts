import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assessContractInfeasibility,
  blocksSamePolicyRetry,
  samePolicyRetryBlockedMessage,
} from "../src/core/contract-infeasible.js";
import {
  failureCategoryForTask,
  failureCategoryFromEvents,
} from "../src/core/worker-failure.js";
import {
  evaluateAdaptationGate,
  type AdaptationParentProjection,
} from "../src/core/adaptation.js";
import { authorizeExtraAttempt } from "../src/core/attempt-authorization.js";
import { StateStore } from "../src/state/store.js";
import type {
  EffectivePolicySnapshot,
  TaskRecord,
  TaskSpec,
} from "../src/core/types.js";
import { buildSafeTaskJourney } from "../src/hub/server.js";

test("assessContractInfeasibility: passed verification is never infeasible", () => {
  const result = assessContractInfeasibility({
    verificationPassed: true,
    reasonCodes: ["contradictory-acceptance", "undeclared-dependency"],
  });
  assert.equal(result.infeasible, false);
  assert.equal(result.failureCategory, undefined);
});

test("assessContractInfeasibility: contradictory-acceptance codes stamp failureCategory", () => {
  const result = assessContractInfeasibility({
    verificationPassed: false,
    reasonCodes: ["contradictory-acceptance"],
  });
  assert.equal(result.infeasible, true);
  assert.equal(result.failureCategory, "contract-infeasible");
  assert.equal(result.reason, "contradictory-acceptance");
  assert.match(result.summary, /Main must revise/i);
  assert.match(result.summary, /same effective policy/i);
});

test("assessContractInfeasibility: undeclared-dependency and scope-boundary-conflict map distinctly", () => {
  assert.equal(
    assessContractInfeasibility({
      verificationPassed: false,
      reasonCodes: ["undeclared-dependency"],
    }).reason,
    "undeclared-dependency",
  );
  assert.equal(
    assessContractInfeasibility({
      verificationPassed: false,
      reasonCodes: ["scope-boundary-conflict"],
    }).reason,
    "scope-boundary-conflict",
  );
  assert.equal(
    assessContractInfeasibility({
      verificationPassed: false,
      reasonCodes: ["unknown-noise", "not-a-code"],
    }).infeasible,
    false,
    "unknown codes never invent infeasibility",
  );
});

test("blocksSamePolicyRetry only for contract-infeasible", () => {
  assert.equal(blocksSamePolicyRetry("contract-infeasible"), true);
  assert.equal(blocksSamePolicyRetry("authentication"), false);
  assert.equal(blocksSamePolicyRetry("budget"), false);
  assert.equal(blocksSamePolicyRetry("runtime"), false);
  assert.equal(blocksSamePolicyRetry(undefined), false);
  assert.match(
    samePolicyRetryBlockedMessage("contract-infeasible"),
    /revise the Task Contract/i,
  );
});

test("failureCategoryFromEvents reads contract-infeasible from verification.completed", () => {
  const events = [
    {
      type: "verification.completed",
      sequence: 3,
      payload: {
        passed: false,
        failureCategory: "contract-infeasible",
        contractInfeasibility: {
          reason: "contradictory-acceptance",
          summary: "boundary cannot be satisfied",
        },
      },
    },
  ];
  assert.equal(failureCategoryFromEvents(events), "contract-infeasible");
  assert.equal(failureCategoryForTask("failed", events), "contract-infeasible");
  assert.equal(
    failureCategoryForTask("succeeded", events),
    undefined,
    "category never leaks on non-terminal failed/interrupted",
  );
});

test("failureCategory prefers newest classified event including verification", () => {
  const events = [
    {
      type: "worker.failed",
      sequence: 1,
      payload: { failureCategory: "runtime" },
    },
    {
      type: "verification.completed",
      sequence: 2,
      payload: { failureCategory: "contract-infeasible" },
    },
  ];
  assert.equal(failureCategoryFromEvents(events), "contract-infeasible");
});

function makeSnapshot(rounds = 1): EffectivePolicySnapshot {
  return {
    profileId: "default",
    values: {
      maxDurationMs: null,
      observedTokenCeiling: null,
      noProgressTimeoutMs: 1_800_000,
      workerStopGraceMs: 10_000,
      fileLimit: null,
      fileLimitMode: "warn",
      changedLineLimit: null,
      changedLineLimitMode: "warn",
      baseMaxAttempts: 1,
      maxExtraAttempts: 1,
      maxMainCorrections: 1,
      maxMainReverifications: 1,
      maxConcurrency: 4,
      completionMode: "hard",
      changeBudgetMode: "warn",
      maxAdaptationRounds: rounds,
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
      maxMainCorrections: "global",
      maxMainReverifications: "global",
      maxConcurrency: "global",
      completionMode: "global",
      changeBudgetMode: "global",
      maxAdaptationRounds: "global",
    },
    enforcementCapability: {
      durationEnforcement: "preemptive",
      tokenEnforcement: "post-observation",
      progressWatchdog: "live",
    },
  };
}

test("adaptation gate stops when parent is contract-infeasible", () => {
  const parent: AdaptationParentProjection = {
    id: "parent-1",
    status: "failed",
    effectivePolicy: makeSnapshot(2),
    failureCategory: "contract-infeasible",
  };
  const decision = evaluateAdaptationGate({
    parent,
    rootEffectivePolicy: makeSnapshot(2),
    existingLineage: [],
    rawPatch: { maxDurationMs: 3_600_000 },
  });
  assert.equal(decision.kind, "stopped");
  if (decision.kind !== "stopped") return;
  assert.equal(decision.preview.stoppedReason, "contract-infeasible");
  assert.match(decision.preview.summary, /Main must revise/i);
});

test("adaptation gate remains eligible for ordinary failed verification without infeasible", () => {
  const parent: AdaptationParentProjection = {
    id: "parent-2",
    status: "failed",
    effectivePolicy: makeSnapshot(2),
    // no failureCategory / ordinary verification failure
  };
  const decision = evaluateAdaptationGate({
    parent,
    rootEffectivePolicy: makeSnapshot(2),
    existingLineage: [],
    rawPatch: { maxDurationMs: 3_600_000 },
  });
  assert.equal(decision.kind, "eligible");
});

function minimalSpec(): TaskSpec {
  return {
    version: 2,
    name: "infeasible-task",
    project: "/tmp/project",
    provider: {
      name: "deepseek",
      model: "deepseek-v4-pro",
      keychainService: "forklight.test",
    },
    runtime: {
      name: "claude-code",
      executable: "claude",
      effort: "high",
      maxBudgetUsd: null,
    },
    workspace: { exclude: [] },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
    contract: {
      outcome: "A concrete outcome description",
      context: ["context line"],
      inScope: ["src"],
      outOfScope: ["docs"],
      executionSteps: ["step"],
      deliverables: ["file"],
      modules: [{
        name: "mod",
        responsibility: "long enough responsibility",
        consumes: ["in"],
        produces: ["out"],
        boundaries: ["bound"],
      }],
      callChain: ["a", "b"],
      scenarios: [
        { name: "happy", given: "g", when: "w", then: "t" },
        { name: "edge", given: "g", when: "w", then: "t" },
      ],
      risks: ["r"],
      changeBudget: { maxFiles: 5, maxDiffLines: 200 },
    },
    acceptance: { criteria: ["c"], commands: ["true"] },
  };
}

test("authorizeExtraAttempt rejects same-policy retry when contract-infeasible", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-infeasible-"));
  const store = new StateStore(root);
  const task: TaskRecord = {
    id: "task-infeasible",
    name: "infeasible",
    status: "failed",
    sourcePath: "/source",
    taskFile: "/task.yaml",
    spec: minimalSpec(),
    paths: {
      root: path.join(root, "task"),
      baseline: path.join(root, "baseline"),
      workspace: path.join(root, "workspace"),
      logs: path.join(root, "logs"),
      claudeConfig: path.join(root, "claude"),
      diff: path.join(root, "diff.patch"),
    },
    sessionId: "session",
    currentAttemptId: "attempt-1",
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    finishedAt: "2026-07-27T00:01:00.000Z",
    effectivePolicy: makeSnapshot(0),
  };
  store.createTask(task);
  store.createAttempt({
    id: "attempt-1",
    taskId: task.id,
    ordinal: 1,
    status: "failed",
    sessionId: "session",
    rawLogPath: path.join(root, "log.txt"),
    startedAt: "2026-07-27T00:00:00.000Z",
    finishedAt: "2026-07-27T00:01:00.000Z",
    exitCode: 1,
  });
  // Durable verification terminal with contract-infeasible classification.
  store.addEvent(
    task.id,
    "attempt-1",
    "verification.completed",
    "Task Contract cannot be satisfied under the current boundary",
    {
      passed: false,
      behaviorPassed: false,
      policyPassed: true,
      sourceCompatible: true,
      failureCategory: "contract-infeasible",
      contractInfeasibility: {
        reason: "contradictory-acceptance",
        summary: "acceptance contradicts declared scope",
      },
    },
  );

  assert.equal(
    failureCategoryForTask("failed", store.listEvents(task.id)),
    "contract-infeasible",
  );

  assert.throws(
    () =>
      authorizeExtraAttempt(
        store,
        task.id,
        {
          additionalAttempts: 1,
          maxBudgetUsd: null,
          reason: "retry after verification",
          confirm: true,
        },
        1,
        20,
        1,
      ),
    /contract-infeasible|revise the Task Contract/i,
  );
});

test("Hub journey maps contract-infeasible to revise-contract next action", () => {
  const journey = buildSafeTaskJourney(
    {
      id: "t1",
      name: "contract task",
      status: "failed",
      provider: "deepseek",
      model: "m",
      runtime: "claude-code",
      source: "/src",
      createdAt: "2026-07-27T00:00:00.000Z",
    },
    {
      failureCategory: "contract-infeasible",
      verification: { available: true, passed: false },
    },
  );
  assert.equal(journey.cause.failureCategory, "contract-infeasible");
  assert.match(String(journey.cause.why), /revise/i);
  const next = journey.nextAction as { label?: string } | string;
  const nextLabel = typeof next === "string" ? next : next?.label;
  assert.equal(nextLabel, "revise-contract");
});
