/**
 * Durable Goal supervision: parser, atomic registration, milestone gates,
 * caps, unlimited duration, no-new-evidence, stop, restart, and privacy.
 * Also covers direct Goal-Task Candidate handoff lineage.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CandidateHandoffError,
  executeGoalTaskHandoff,
  hasSourceBlockingIntegration,
  isGoalTaskHandoffSourceEligible,
  recoverCandidateHandoffs,
} from "../src/core/candidate-handoff.js";
import { resolveLatestRevision } from "../src/core/candidate-revision.js";
import {
  collectGoalEvidenceFacts,
  computeEvidenceDigest,
  evaluateMilestoneGate,
  hasGoalOwnedWorkInFlight,
  hasQualifyingAmendedAcceptanceRemediation,
  hasQualifyingOriginalAcceptanceRemediation,
  loadGoal,
  projectGoal,
  reconcileGoalRecords,
  resolveEffectiveMilestoneLineage,
  resolveQualifyingAmendedAcceptanceRemediation,
} from "../src/core/goal.js";
import { resolveReadiness } from "../src/core/dependency-resolver.js";
import { SettingsService } from "../src/core/settings.js";
import { upsertModelConfig } from "../src/core/model-catalog.js";
import { upsertWorkerProfile } from "../src/core/worker-profiles.js";
import {
  defaultAdvancedPolicyFields,
  enforcementCapabilityForRuntime,
  resolveEffectivePolicy,
} from "../src/core/advanced-policy.js";
import { registerTaskFromSpec } from "../src/core/runner.js";
import type {
  AttemptRecord,
  EffectivePolicySnapshot,
  IntegrationReceiptRecord,
  IntegrationResultRecord,
  RemediationCheckRecord,
  RemediationDisposition,
  TaskRecord,
  TaskStatus,
} from "../src/core/types.js";
import { DaemonCoordinator } from "../src/daemon/coordinator.js";
import type { ProviderAuthInspector } from "../src/core/providers.js";
import { StateStore } from "../src/state/store.js";

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

const taskTemplate = path.resolve("examples/deepseek-checkout.yaml");

async function writeFourTaskPlan(root: string): Promise<string> {
  const planFile = path.join(root, "plan.json");
  await writeFile(
    planFile,
    JSON.stringify({
      version: 1,
      name: "Four-task goal plan",
      objective: "Two dependency waves with an integration gate protecting downstream source.",
      items: [
        { id: "foundation", task: taskTemplate, dependsOn: [] },
        { id: "service", task: taskTemplate, dependsOn: ["foundation"] },
        { id: "console", task: taskTemplate, dependsOn: ["foundation"] },
        { id: "integrate-docs", task: taskTemplate, dependsOn: ["service", "console"] },
      ],
    }),
  );
  return planFile;
}

async function writeGoalFile(
  root: string,
  planFile: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const goalFile = path.join(root, "goal.json");
  const body = {
    version: 1,
    name: "Durable four-task goal",
    objective: "Supervise a four-task plan with mixed milestone gates.",
    planFile,
    policy: {
      maxDurationMs: null,
      noProgressTimeoutMs: null,
      maxCorrectionRounds: 1,
      maxReviewRounds: 1,
      maxNoNewEvidenceCycles: 2,
    },
    milestones: [
      { itemId: "foundation", gate: "machine" },
      { itemId: "service", gate: "integration" },
      { itemId: "console", gate: "main-accept" },
      { itemId: "integrate-docs", gate: "machine" },
    ],
    ...overrides,
  };
  await writeFile(goalFile, JSON.stringify(body, null, 2));
  return goalFile;
}

const TEST_PROVIDER_AUTH_READY: ProviderAuthInspector = {
  hasReadableKeychainValue: () => true,
  hasLocalGrokSignIn: () => true,
};

function testCoordinator(store: StateStore, concurrency = 0): DaemonCoordinator {
  const settings = new SettingsService(store);
  return new DaemonCoordinator(store, settings, concurrency, TEST_PROVIDER_AUTH_READY);
}

function markSucceeded(store: StateStore, taskId: string): void {
  store.setTaskStatus(taskId, "succeeded", { error: null, finishedAt: new Date().toISOString() });
  store.addEvent(taskId, undefined, "verification.completed", "verification passed", {
    passed: true,
    commands: [],
  });
}

function seedMainAccept(store: StateStore, taskId: string, digest = "a".repeat(64)): void {
  const task = store.getTask(taskId);
  const attemptId = task.currentAttemptId ?? `attempt-${taskId.slice(0, 8)}`;
  try {
    store.getAttempt(attemptId);
  } catch {
    const attempt: AttemptRecord = {
      id: attemptId,
      taskId,
      ordinal: 1,
      status: "succeeded",
      sessionId: `session-${attemptId}`,
      rawLogPath: path.join(task.paths.logs, "worker.log"),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
    store.createAttempt(attempt);
  }
  store.updateTask(taskId, { currentAttemptId: attemptId });
  store.setTaskStatus(taskId, "succeeded", { error: null, finishedAt: new Date().toISOString() });
  store.addEvent(taskId, attemptId, "verification.completed", "verification passed", {
    passed: true,
    commands: [],
  });
  const verification = store.listEvents(taskId).filter((e) => e.type === "verification.completed").at(-1)!;
  const revisionId = `rev-${digest.slice(0, 8)}`;
  store.addEvent(taskId, attemptId, "candidate.revision.captured", "revision captured", {
    id: revisionId,
    taskId,
    attemptId,
    attemptOrdinal: 1,
    verificationEventSequence: verification.sequence,
    patchDigest: digest,
    filesChanged: 1,
    changedLines: 1,
    affectedPaths: ["src/a.ts"],
    verificationPassed: true,
    createdAt: new Date().toISOString(),
  });
  store.addEvent(taskId, attemptId, "main-review.completed", "Main agent review: accept", {
    decision: "accept",
    reason: "Looks good for the goal gate fixture",
    attemptId,
    verificationEventSequence: verification.sequence,
    candidateRevisionId: revisionId,
    acceptedPatchDigest: digest,
  });
}

function seedIntegrationApplied(
  store: StateStore,
  taskId: string,
  digest = "a".repeat(64),
): void {
  const receiptId = "receipt-1";
  const receipt: IntegrationReceiptRecord = {
    id: receiptId,
    taskId,
    patchDigest: digest,
    affectedFiles: ["src/a.ts"],
    rejectionReasons: [],
    sourceEvidence: {},
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    consumed: true,
  };
  store.saveIntegrationReceipt(receipt);
  const result: IntegrationResultRecord = {
    id: "op-1",
    receiptId,
    taskId,
    status: "applied",
    appliedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  store.saveIntegrationResult(result);
  store.addEvent(taskId, undefined, "integration.apply.completed", "Integration applied", result);
}

function seedRemediationDisposition(
  store: StateStore,
  taskId: string,
  disposition: RemediationDisposition,
): void {
  store.saveRemediationDisposition(taskId, disposition);
}

function ensureAttempt(store: StateStore, taskId: string): string {
  const task = store.getTask(taskId);
  const attemptId = task.currentAttemptId ?? `attempt-${taskId.slice(0, 8)}`;
  try {
    store.getAttempt(attemptId);
  } catch {
    const attempt: AttemptRecord = {
      id: attemptId,
      taskId,
      ordinal: 1,
      status: "failed",
      sessionId: `session-${attemptId}`,
      rawLogPath: path.join(task.paths.logs, "worker.log"),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
    store.createAttempt(attempt);
  }
  store.updateTask(taskId, { currentAttemptId: attemptId });
  return attemptId;
}

/**
 * Seed a complete durable amended-acceptance remediation chain that the
 * Goal resolver can re-prove: failed verification, bound Main revise,
 * atomic passing private check + disposition, and completion event.
 */
function seedQualifyingAmendedRemediation(
  store: StateStore,
  taskId: string,
  options: {
    status?: TaskStatus;
    checkId?: string;
    skipCompletionEvent?: boolean;
    skipPrivateCheck?: boolean;
    failCommands?: boolean;
    executedCommandMismatch?: boolean;
  } = {},
): {
  checkId: string;
  attemptId: string;
  verificationSequence: number;
  reviewSequence: number;
  createdAt: string;
} {
  const status = options.status ?? "failed";
  const attemptId = ensureAttempt(store, taskId);
  store.setTaskStatus(taskId, status, {
    error: status === "succeeded" ? null : "verification failed",
    finishedAt: new Date().toISOString(),
  });
  store.addEvent(taskId, attemptId, "verification.completed", "verification failed", {
    passed: false,
    behaviorPassed: false,
    policyPassed: true,
    sourceCompatible: true,
    commands: [
      {
        command: "npm run typecheck",
        exitCode: 1,
        stdout: "",
        stderr: "missing script",
        durationMs: 1,
        timedOut: false,
      },
      {
        command: "node -e ''",
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 1,
        timedOut: false,
      },
    ],
  });
  const verification = store.listEvents(taskId)
    .filter((event) => event.type === "verification.completed")
    .at(-1)!;
  store.addEvent(taskId, attemptId, "main-review.completed", "Main agent review: revise", {
    decision: "revise",
    reason: "Acceptance command was wrong; repair current source under amended suite",
    attemptId,
    verificationEventSequence: verification.sequence,
  });
  const review = store.listEvents(taskId)
    .filter((event) => event.type === "main-review.completed")
    .at(-1)!;

  const checkId = options.checkId ?? `check-amended-${taskId.slice(0, 8)}`;
  const createdAt = new Date().toISOString();
  const disposition: RemediationDisposition = {
    status: "verified-repaired-delivered",
    checkId,
    createdAt,
    acceptanceBasis: "amended-acceptance",
    amendedCommandCount: 1,
    reasonCode: "contradictory-acceptance",
  };

  if (!options.skipPrivateCheck) {
    const check: RemediationCheckRecord = {
      id: checkId,
      taskId,
      status: options.failCommands ? "failed" : "passed",
      reason: "private amendment reason must never project",
      commands: [
        {
          command: options.executedCommandMismatch
            ? "node -e 'different passing command'"
            : "node -e ''",
          exitCode: options.failCommands ? 1 : 0,
          stdout: "",
          stderr: options.failCommands ? "boom" : "",
          durationMs: 1,
          timedOut: false,
        },
        {
          command: "node -e ''",
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 1,
          timedOut: false,
        },
      ],
      amendment: {
        verificationEventSequence: verification.sequence,
        reasonCode: "contradictory-acceptance",
        replacements: [{
          originalCommand: "npm run typecheck",
          replacementCommand: "node -e ''",
        }],
        amendedCommands: ["node -e ''", "node -e ''"],
      },
      createdAt,
    };
    if (options.failCommands) {
      store.saveRemediationCheck(check);
    } else {
      store.saveRemediationOutcome(check, disposition);
    }
  } else {
    store.saveRemediationDisposition(taskId, disposition);
  }

  if (!options.skipCompletionEvent && !options.failCommands && !options.skipPrivateCheck) {
    store.addEvent(
      taskId,
      undefined,
      "remediation.check.completed",
      "Main remediation verification passed: 2/2 commands passed",
      {
        checkId,
        status: "passed",
        commandCount: 2,
        passedCommandCount: 2,
        disposition: "verified-repaired-delivered",
        acceptanceBasis: "amended-acceptance",
        amendedCommandCount: 1,
        reasonCode: "contradictory-acceptance",
      },
    );
  }

  return {
    checkId,
    attemptId,
    verificationSequence: verification.sequence,
    reviewSequence: review.sequence,
    createdAt,
  };
}

test("goal parser requires 4-8 milestones and preserves null duration policy", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-goal-parse-"));
  const planFile = await writeFourTaskPlan(root);
  const goalFile = await writeGoalFile(root, planFile);
  const report = await loadGoal(goalFile);
  assert.equal(report.passed, true);
  assert.ok(report.goal);
  assert.equal(report.goal!.policy.maxDurationMs, null);
  assert.equal(report.goal!.policy.noProgressTimeoutMs, null);
  assert.equal(report.goal!.milestones.length, 4);
  assert.equal(report.goal!.milestones[1]!.gate, "integration");

  const tooFew = await writeGoalFile(root, planFile, {
    milestones: [
      { itemId: "foundation", gate: "machine" },
      { itemId: "service", gate: "machine" },
      { itemId: "console", gate: "machine" },
    ],
  });
  // Still points at a 4-item plan, so count mismatch and min items both fail.
  const few = await loadGoal(tooFew);
  assert.equal(few.passed, false);
  assert.match(few.issues.join("\n"), /4 to 8|match plan items/i);
});

test("atomic goal registration creates plan tasks and goal before queue admission", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-atomic-"));
  const planFile = await writeFourTaskPlan(home);
  const goalFile = await writeGoalFile(home, planFile);
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  try {
    const result = await coordinator.submitGoalFile(goalFile);
    assert.equal(result.goalId, path.resolve(goalFile));
    assert.equal(result.planId, path.resolve(planFile));
    assert.equal(Object.keys(result.taskIdsByItemId).length, 4);

    const goal = store.getGoal(result.goalId);
    assert.equal(goal.policy.maxDurationMs, null);
    assert.equal(goal.policy.noProgressTimeoutMs, null);
    assert.equal(goal.status, "running");
    assert.equal(store.getGoalMilestones(result.goalId).length, 4);

    const foundation = result.taskIdsByItemId.foundation!;
    const service = result.taskIdsByItemId.service!;
    const docs = result.taskIdsByItemId["integrate-docs"]!;
    assert.equal(store.getTask(foundation).status, "queued");
    assert.equal(store.getTask(service).status, "waiting");
    assert.equal(store.getTask(docs).status, "waiting");

    // No second scheduler: only ordinary plan queue membership.
    const health = coordinator.health();
    assert.ok((health.queuedTaskIds as string[]).includes(foundation));
    assert.equal((health.queuedTaskIds as string[]).includes(service), false);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("integration milestone gate blocks dependents until exact apply, then queues once", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-gate-"));
  const planFile = await writeFourTaskPlan(home);
  const goalFile = await writeGoalFile(home, planFile);
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  try {
    const result = await coordinator.submitGoalFile(goalFile);
    const foundation = result.taskIdsByItemId.foundation!;
    const service = result.taskIdsByItemId.service!;
    const docs = result.taskIdsByItemId["integrate-docs"]!;

    markSucceeded(store, foundation);
    await coordinator.recover();
    assert.equal(store.getTask(service).status, "queued");

    // Machine-green service is not enough for an integration gate.
    markSucceeded(store, service);
    store.setTaskStatus(docs, "waiting", { error: "Waiting on prerequisites: service, console" });
    // Console also needed; mark console main-accept path later.
    const consoleId = result.taskIdsByItemId.console!;
    markSucceeded(store, consoleId);
    seedMainAccept(store, consoleId, "b".repeat(64));

    // Service still lacks integration — docs must wait even if machine-green.
    await coordinator.recover();
    assert.notEqual(store.getTask(docs).status, "queued");
    const gateBefore = evaluateMilestoneGate(store, "integration", service, "succeeded");
    assert.equal(gateBefore.satisfied, false);
    assert.equal(gateBefore.reasonCode, "waiting-main-accept");

    seedMainAccept(store, service, "c".repeat(64));
    const afterAccept = evaluateMilestoneGate(store, "integration", service, "succeeded");
    assert.equal(afterAccept.satisfied, false);
    assert.equal(afterAccept.reasonCode, "waiting-integration");

    seedIntegrationApplied(store, service, "c".repeat(64));
    const afterApply = evaluateMilestoneGate(store, "integration", service, "succeeded");
    assert.equal(afterApply.satisfied, true);

    // A newer generic accept without an exact revision/digest binding must
    // invalidate the integration gate rather than inheriting old evidence.
    const serviceTask = store.getTask(service);
    const serviceVerification = store.listEvents(service)
      .filter((event) => event.type === "verification.completed")
      .at(-1)!;
    store.addEvent(
      service,
      serviceTask.currentAttemptId,
      "main-review.completed",
      "Main agent review: accept",
      {
        decision: "accept",
        reason: "Legacy unbound accept must fail closed",
        attemptId: serviceTask.currentAttemptId,
        verificationEventSequence: serviceVerification.sequence,
      },
    );
    assert.equal(
      evaluateMilestoneGate(store, "integration", service, "succeeded").satisfied,
      false,
    );
    seedMainAccept(store, service, "c".repeat(64));

    await coordinator.recover();
    await coordinator.recover();
    assert.equal(store.getTask(docs).status, "queued");
    const readyEvents = store.listEvents(docs).filter((e) => e.type === "task.ready");
    assert.equal(readyEvents.length, 1);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("non-goal plans keep machine-only dependency readiness", async () => {
  // Byte-compatible: gateSatisfaction omitted → succeeded is enough.
  const decision = resolveReadiness(
    "consumer",
    ["upstream"],
    new Map([["upstream", "succeeded"]]),
  );
  assert.deepEqual(decision, { kind: "ready" });

  const gated = resolveReadiness(
    "consumer",
    ["upstream"],
    new Map([["upstream", "succeeded"]]),
    new Map([["upstream", false]]),
  );
  assert.deepEqual(gated, { kind: "waiting", waitingOn: ["upstream"] });

  // Satisfied Goal gate is authoritative even when the machine Task is failed
  // (Main original-acceptance remediation). Unsatisfied gates still block.
  assert.deepEqual(
    resolveReadiness(
      "consumer",
      ["upstream"],
      new Map([["upstream", "failed"]]),
      new Map([["upstream", true]]),
    ),
    { kind: "ready" },
  );
  assert.deepEqual(
    resolveReadiness(
      "consumer",
      ["upstream"],
      new Map([["upstream", "failed"]]),
      new Map([["upstream", false]]),
    ),
    { kind: "blocked", failedBy: ["upstream"], waitingOn: [] },
  );
});

test("original-acceptance Main remediation satisfies integration without Candidate re-apply", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-remed-pos-"));
  const planFile = await writeFourTaskPlan(home);
  const goalFile = await writeGoalFile(home, planFile);
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  try {
    const result = await coordinator.submitGoalFile(goalFile);
    const goalId = result.goalId;
    const foundation = result.taskIdsByItemId.foundation!;
    const service = result.taskIdsByItemId.service!;
    const consoleId = result.taskIdsByItemId.console!;
    const docs = result.taskIdsByItemId["integrate-docs"]!;

    markSucceeded(store, foundation);
    await coordinator.recover();
    // Succeeded Candidate + Main revise path: no accept, no Integration.
    markSucceeded(store, service);
    markSucceeded(store, consoleId);
    seedMainAccept(store, consoleId, "b".repeat(64));
    store.setTaskStatus(docs, "waiting", {
      error: "Waiting on prerequisites: service, console",
      finishedAt: null,
    });

    const before = evaluateMilestoneGate(store, "integration", service, "succeeded");
    assert.equal(before.satisfied, false);
    assert.equal(before.reasonCode, "waiting-main-accept");
    assert.equal(hasQualifyingOriginalAcceptanceRemediation(store, service), false);

    const goalBefore = store.getGoal(goalId);
    const digestBefore = goalBefore.evidenceDigest;

    seedRemediationDisposition(store, service, {
      status: "verified-repaired-delivered",
      checkId: "check-orig-1",
      createdAt: new Date().toISOString(),
      acceptanceBasis: "original-acceptance",
    });

    const after = evaluateMilestoneGate(store, "integration", service, "succeeded");
    assert.equal(after.satisfied, true);
    assert.equal(after.reasonCode, "none");
    assert.equal(after.deliveryBasis, "original-acceptance");
    assert.match(after.reason, /repaired the current source/i);
    assert.match(after.reason, /original acceptance/i);
    assert.doesNotMatch(after.reason, /exact accepted Candidate/i);
    assert.match(after.nextAction, /Main-repaired source delivery/i);
    assert.equal(hasQualifyingOriginalAcceptanceRemediation(store, service), true);
    assert.equal(hasQualifyingAmendedAcceptanceRemediation(store, service), false);

    // Evidence cursor advances from compact disposition facts.
    const facts = collectGoalEvidenceFacts(store, goalBefore, store.getGoalMilestones(goalId));
    const serviceFacts = facts.items.find((item) => item.itemId === "service")!;
    assert.equal(serviceFacts.remediationStatus, "verified-repaired-delivered");
    assert.equal(serviceFacts.remediationCheckId, "check-orig-1");
    assert.equal(serviceFacts.remediationAcceptanceBasis, "original-acceptance");
    assert.equal(serviceFacts.deliveryBasis, "original-acceptance");
    assert.equal(serviceFacts.satisfied, true);
    const digestAfterFacts = computeEvidenceDigest(facts);
    assert.notEqual(digestAfterFacts, digestBefore);

    // Reconcile unblocks dependents without fresh Candidate accept/integration.
    await coordinator.recover();
    await coordinator.recover();
    assert.equal(store.getTask(docs).status, "queued");
    const projected = projectGoal(store, goalId);
    const serviceView = projected.milestones.find((m) => m.itemId === "service")!;
    assert.equal(serviceView.satisfied, true);
    assert.equal(serviceView.deliveryBasis, "original-acceptance");
    assert.match(serviceView.reason, /repaired the current source/i);
    assert.notEqual(store.getGoal(goalId).evidenceDigest, digestBefore);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("compact amended disposition without private proof stays fail-closed", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-remed-neg-"));
  const planFile = await writeFourTaskPlan(home);
  const goalFile = await writeGoalFile(home, planFile);
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  try {
    const result = await coordinator.submitGoalFile(goalFile);
    const service = result.taskIdsByItemId.service!;
    const foundation = result.taskIdsByItemId.foundation!;
    markSucceeded(store, foundation);
    await coordinator.recover();
    markSucceeded(store, service);

    // Absent disposition: still needs Main accept + exact Integration.
    const absent = evaluateMilestoneGate(store, "integration", service, "succeeded");
    assert.equal(absent.satisfied, false);
    assert.equal(absent.reasonCode, "waiting-main-accept");

    // Compact amended row alone never unlocks — private check + events required.
    seedRemediationDisposition(store, service, {
      status: "verified-repaired-delivered",
      checkId: "check-amended-1",
      createdAt: new Date().toISOString(),
      acceptanceBasis: "amended-acceptance",
      amendedCommandCount: 1,
      reasonCode: "contradictory-acceptance",
    });
    const amended = evaluateMilestoneGate(store, "integration", service, "succeeded");
    assert.equal(amended.satisfied, false);
    assert.equal(amended.reasonCode, "waiting-main-accept");
    assert.equal(amended.deliveryBasis, undefined);
    assert.equal(hasQualifyingOriginalAcceptanceRemediation(store, service), false);
    assert.equal(hasQualifyingAmendedAcceptanceRemediation(store, service), false);
    assert.equal(resolveQualifyingAmendedAcceptanceRemediation(store, service), undefined);

    // Evidence still records the amended disposition without unlocking the gate.
    const facts = collectGoalEvidenceFacts(
      store,
      store.getGoal(result.goalId),
      store.getGoalMilestones(result.goalId),
    );
    const serviceFacts = facts.items.find((item) => item.itemId === "service")!;
    assert.equal(serviceFacts.remediationAcceptanceBasis, "amended-acceptance");
    assert.equal(serviceFacts.deliveryBasis, undefined);
    assert.equal(serviceFacts.satisfied, false);
    // Private command/reason content must never appear in Goal evidence.
    assert.doesNotMatch(JSON.stringify(facts), /typecheck|private amendment|missing script/);

    // Normal exact Integration path remains authoritative and distinct.
    seedMainAccept(store, service, "c".repeat(64));
    assert.equal(
      evaluateMilestoneGate(store, "integration", service, "succeeded").satisfied,
      false,
    );
    seedIntegrationApplied(store, service, "c".repeat(64));
    const exact = evaluateMilestoneGate(store, "integration", service, "succeeded");
    assert.equal(exact.satisfied, true);
    assert.equal(exact.deliveryBasis, "exact-candidate-integration");
    assert.match(exact.reason, /exact accepted Candidate/i);
    assert.doesNotMatch(exact.reason, /amended acceptance/i);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("qualifying amended remediation satisfies integration without Candidate Integration", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-amended-pos-"));
  const planFile = await writeFourTaskPlan(home);
  const goalFile = await writeGoalFile(home, planFile);
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  try {
    const result = await coordinator.submitGoalFile(goalFile);
    const goalId = result.goalId;
    const foundation = result.taskIdsByItemId.foundation!;
    const service = result.taskIdsByItemId.service!;
    const consoleId = result.taskIdsByItemId.console!;
    const docs = result.taskIdsByItemId["integrate-docs"]!;

    markSucceeded(store, foundation);
    await coordinator.recover();
    store.setTaskStatus(service, "failed", {
      error: "verification failed",
      finishedAt: new Date().toISOString(),
    });
    markSucceeded(store, consoleId);
    seedMainAccept(store, consoleId, "b".repeat(64));
    store.setTaskStatus(docs, "waiting", {
      error: "Waiting on prerequisites: service, console",
      finishedAt: null,
    });

    assert.equal(
      evaluateMilestoneGate(store, "integration", service, "failed").satisfied,
      false,
    );

    const seeded = seedQualifyingAmendedRemediation(store, service, { status: "failed" });
    assert.equal(hasQualifyingAmendedAcceptanceRemediation(store, service), true);
    assert.equal(hasQualifyingOriginalAcceptanceRemediation(store, service), false);
    assert.deepEqual(resolveQualifyingAmendedAcceptanceRemediation(store, service), {
      status: "verified-repaired-delivered",
      checkId: seeded.checkId,
      acceptanceBasis: "amended-acceptance",
    });

    const repaired = evaluateMilestoneGate(store, "integration", service, "failed");
    assert.equal(repaired.satisfied, true);
    assert.equal(repaired.deliveryBasis, "amended-acceptance");
    assert.match(repaired.reason, /amended acceptance/i);
    assert.doesNotMatch(repaired.reason, /exact accepted Candidate/i);
    assert.match(repaired.nextAction, /amended acceptance/i);

    // Task machine status stays failed; no Integration result/receipt created.
    assert.equal(store.getTask(service).status, "failed");
    assert.equal(store.listIntegrationResults(service).length, 0);

    const facts = collectGoalEvidenceFacts(
      store,
      store.getGoal(goalId),
      store.getGoalMilestones(goalId),
    );
    const serviceFacts = facts.items.find((item) => item.itemId === "service")!;
    assert.equal(serviceFacts.satisfied, true);
    assert.equal(serviceFacts.deliveryBasis, "amended-acceptance");
    assert.equal(serviceFacts.remediationAcceptanceBasis, "amended-acceptance");
    assert.equal(serviceFacts.remediationCheckId, seeded.checkId);
    assert.doesNotMatch(
      JSON.stringify(facts),
      /typecheck|private amendment|missing script|replacementCommand/,
    );

    await coordinator.recover();
    await coordinator.recover();
    assert.equal(store.getTask(docs).status, "queued");
    assert.equal(store.getTask(service).status, "failed", "machine failure stays durable");

    const projected = projectGoal(store, goalId);
    const serviceView = projected.milestones.find((m) => m.itemId === "service")!;
    assert.equal(serviceView.satisfied, true);
    assert.equal(serviceView.deliveryBasis, "amended-acceptance");
    assert.match(serviceView.reason, /amended acceptance/i);
    assert.doesNotMatch(serviceView.reason, /exact accepted Candidate/i);

    // Interrupted machine status still qualifies without rewriting Task history.
    store.setTaskStatus(service, "interrupted", {
      error: "worker interrupted",
      finishedAt: new Date().toISOString(),
    });
    const interrupted = evaluateMilestoneGate(store, "integration", service, "interrupted");
    assert.equal(interrupted.satisfied, true);
    assert.equal(interrupted.deliveryBasis, "amended-acceptance");
    assert.equal(store.getTask(service).status, "interrupted");
    assert.equal(store.listIntegrationResults(service).length, 0);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("amended remediation qualification rejects stale, mismatched, and incomplete chains", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-amended-stale-"));
  const planFile = await writeFourTaskPlan(home);
  const goalFile = await writeGoalFile(home, planFile);
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  try {
    const result = await coordinator.submitGoalFile(goalFile);
    const service = result.taskIdsByItemId.service!;
    markSucceeded(store, result.taskIdsByItemId.foundation!);
    await coordinator.recover();

    // Missing completion event.
    seedQualifyingAmendedRemediation(store, service, {
      status: "failed",
      checkId: "check-no-completion",
      skipCompletionEvent: true,
    });
    assert.equal(hasQualifyingAmendedAcceptanceRemediation(store, service), false);
    assert.equal(
      evaluateMilestoneGate(store, "integration", service, "failed").satisfied,
      false,
    );

    // Fresh complete chain qualifies.
    const home2 = await mkdtemp(path.join(tmpdir(), "forklight-goal-amended-stale2-"));
    const planFile2 = await writeFourTaskPlan(home2);
    const goalFile2 = await writeGoalFile(home2, planFile2);
    const store2 = new StateStore(home2);
    const coordinator2 = testCoordinator(store2, 0);
    try {
      const result2 = await coordinator2.submitGoalFile(goalFile2);
      const service2 = result2.taskIdsByItemId.service!;
      markSucceeded(store2, result2.taskIdsByItemId.foundation!);
      await coordinator2.recover();
      const seeded = seedQualifyingAmendedRemediation(store2, service2, { status: "failed" });
      assert.equal(hasQualifyingAmendedAcceptanceRemediation(store2, service2), true);

      // Later independent verification makes the bound amendment stale.
      store2.addEvent(
        service2,
        seeded.attemptId,
        "verification.completed",
        "later verification",
        { passed: false, commands: [] },
      );
      assert.equal(hasQualifyingAmendedAcceptanceRemediation(store2, service2), false);
      assert.equal(
        evaluateMilestoneGate(store2, "integration", service2, "failed").satisfied,
        false,
      );
    } finally {
      await coordinator2.shutdown();
      store2.close();
    }

    // Later Main accept invalidates the revise that authorized remediation.
    const home3 = await mkdtemp(path.join(tmpdir(), "forklight-goal-amended-stale3-"));
    const planFile3 = await writeFourTaskPlan(home3);
    const goalFile3 = await writeGoalFile(home3, planFile3);
    const store3 = new StateStore(home3);
    const coordinator3 = testCoordinator(store3, 0);
    try {
      const result3 = await coordinator3.submitGoalFile(goalFile3);
      const service3 = result3.taskIdsByItemId.service!;
      markSucceeded(store3, result3.taskIdsByItemId.foundation!);
      await coordinator3.recover();
      const seeded = seedQualifyingAmendedRemediation(store3, service3, { status: "failed" });
      assert.equal(hasQualifyingAmendedAcceptanceRemediation(store3, service3), true);
      store3.addEvent(
        service3,
        seeded.attemptId,
        "main-review.completed",
        "Main agent review: accept",
        {
          decision: "accept",
          reason: "later accept must not keep old amended delivery live",
          attemptId: seeded.attemptId,
          verificationEventSequence: seeded.verificationSequence,
          acceptedPatchDigest: "d".repeat(64),
        },
      );
      assert.equal(hasQualifyingAmendedAcceptanceRemediation(store3, service3), false);
      assert.equal(store3.getTask(service3).status, "failed");
      assert.equal(store3.listIntegrationResults(service3).length, 0);
    } finally {
      await coordinator3.shutdown();
      store3.close();
    }

    // Failed private check never qualifies even with a compact disposition row.
    const home4 = await mkdtemp(path.join(tmpdir(), "forklight-goal-amended-failcheck-"));
    const planFile4 = await writeFourTaskPlan(home4);
    const goalFile4 = await writeGoalFile(home4, planFile4);
    const store4 = new StateStore(home4);
    const coordinator4 = testCoordinator(store4, 0);
    try {
      const result4 = await coordinator4.submitGoalFile(goalFile4);
      const service4 = result4.taskIdsByItemId.service!;
      markSucceeded(store4, result4.taskIdsByItemId.foundation!);
      await coordinator4.recover();
      seedQualifyingAmendedRemediation(store4, service4, {
        status: "failed",
        failCommands: true,
      });
      // Disposition was not stored for failed checks; assert fail-closed either way.
      assert.equal(hasQualifyingAmendedAcceptanceRemediation(store4, service4), false);
    } finally {
      await coordinator4.shutdown();
      store4.close();
    }

    // Mismatched check id between disposition and private record.
    const home5 = await mkdtemp(path.join(tmpdir(), "forklight-goal-amended-mismatch-"));
    const planFile5 = await writeFourTaskPlan(home5);
    const goalFile5 = await writeGoalFile(home5, planFile5);
    const store5 = new StateStore(home5);
    const coordinator5 = testCoordinator(store5, 0);
    try {
      const result5 = await coordinator5.submitGoalFile(goalFile5);
      const service5 = result5.taskIdsByItemId.service!;
      markSucceeded(store5, result5.taskIdsByItemId.foundation!);
      await coordinator5.recover();
      const attemptId = ensureAttempt(store5, service5);
      store5.setTaskStatus(service5, "failed", {
        error: "verification failed",
        finishedAt: new Date().toISOString(),
      });
      store5.addEvent(service5, attemptId, "verification.completed", "verification failed", {
        passed: false,
        commands: [{
          command: "npm run typecheck",
          exitCode: 1,
          stdout: "",
          stderr: "missing",
          durationMs: 1,
          timedOut: false,
        }],
      });
      const verification = store5.listEvents(service5)
        .filter((event) => event.type === "verification.completed")
        .at(-1)!;
      store5.addEvent(service5, attemptId, "main-review.completed", "Main agent review: revise", {
        decision: "revise",
        reason: "bound revise for mismatch fixture",
        attemptId,
        verificationEventSequence: verification.sequence,
      });
      const createdAt = new Date().toISOString();
      const realCheckId = "check-real-private";
      store5.saveRemediationCheck({
        id: realCheckId,
        taskId: service5,
        status: "passed",
        reason: "private",
        commands: [{
          command: "node -e ''",
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 1,
          timedOut: false,
        }],
        amendment: {
          verificationEventSequence: verification.sequence,
          reasonCode: "contradictory-acceptance",
          replacements: [{
            originalCommand: "npm run typecheck",
            replacementCommand: "node -e ''",
          }],
          amendedCommands: ["node -e ''"],
        },
        createdAt,
      });
      // Compact disposition points at a different check id than the private proof.
      store5.saveRemediationDisposition(service5, {
        status: "verified-repaired-delivered",
        checkId: "other-check-id",
        createdAt,
        acceptanceBasis: "amended-acceptance",
        amendedCommandCount: 1,
        reasonCode: "contradictory-acceptance",
      });
      store5.addEvent(
        service5,
        undefined,
        "remediation.check.completed",
        "Main remediation verification passed: 1/1 commands passed",
        {
          checkId: realCheckId,
          status: "passed",
          commandCount: 1,
          passedCommandCount: 1,
          disposition: "verified-repaired-delivered",
          acceptanceBasis: "amended-acceptance",
          amendedCommandCount: 1,
          reasonCode: "contradictory-acceptance",
        },
      );
      assert.equal(hasQualifyingAmendedAcceptanceRemediation(store5, service5), false);
    } finally {
      await coordinator5.shutdown();
      store5.close();
    }
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("amended remediation rejects a passing check that ran a different command", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-amended-command-mismatch-"));
  const planFile = await writeFourTaskPlan(home);
  const goalFile = await writeGoalFile(home, planFile);
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  try {
    const result = await coordinator.submitGoalFile(goalFile);
    const service = result.taskIdsByItemId.service!;
    markSucceeded(store, result.taskIdsByItemId.foundation!);
    await coordinator.recover();
    seedQualifyingAmendedRemediation(store, service, {
      status: "failed",
      executedCommandMismatch: true,
    });

    assert.equal(hasQualifyingAmendedAcceptanceRemediation(store, service), false);
    assert.equal(
      evaluateMilestoneGate(store, "integration", service, "failed").satisfied,
      false,
    );
    assert.equal(store.listIntegrationResults(service).length, 0);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("exact Integration and original-acceptance remain distinct from amended delivery", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-bases-distinct-"));
  const planFile = await writeFourTaskPlan(home);
  const goalFile = await writeGoalFile(home, planFile);
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  try {
    const result = await coordinator.submitGoalFile(goalFile);
    const foundation = result.taskIdsByItemId.foundation!;
    const service = result.taskIdsByItemId.service!;
    const consoleId = result.taskIdsByItemId.console!;

    markSucceeded(store, foundation);
    await coordinator.recover();
    markSucceeded(store, service);
    seedMainAccept(store, service, "e".repeat(64));
    seedIntegrationApplied(store, service, "e".repeat(64));
    const exact = evaluateMilestoneGate(store, "integration", service, "succeeded");
    assert.equal(exact.satisfied, true);
    assert.equal(exact.deliveryBasis, "exact-candidate-integration");
    assert.match(exact.reason, /exact accepted Candidate/i);
    assert.doesNotMatch(exact.reason, /amended acceptance|original acceptance/i);

    markSucceeded(store, consoleId);
    // Console uses main-accept gate in the fixture; seed original remediation on a
    // second integration-gated evaluation of service-equivalent facts via direct API.
    seedRemediationDisposition(store, consoleId, {
      status: "verified-repaired-delivered",
      checkId: "check-orig-distinct",
      createdAt: new Date().toISOString(),
      acceptanceBasis: "original-acceptance",
    });
    // Original remediation on an integration gate remains original, never amended.
    const original = evaluateMilestoneGate(store, "integration", consoleId, "succeeded");
    assert.equal(original.satisfied, true);
    assert.equal(original.deliveryBasis, "original-acceptance");
    assert.match(original.reason, /original acceptance/i);
    assert.doesNotMatch(original.reason, /amended acceptance|exact accepted Candidate/i);
    assert.equal(hasQualifyingAmendedAcceptanceRemediation(store, consoleId), false);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("failed Task original-acceptance remediation satisfies integration and unblocks dependents", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-remed-failed-"));
  const planFile = await writeFourTaskPlan(home);
  const goalFile = await writeGoalFile(home, planFile);
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  try {
    const result = await coordinator.submitGoalFile(goalFile);
    const foundation = result.taskIdsByItemId.foundation!;
    const service = result.taskIdsByItemId.service!;
    const consoleId = result.taskIdsByItemId.console!;
    const docs = result.taskIdsByItemId["integrate-docs"]!;

    markSucceeded(store, foundation);
    await coordinator.recover();
    store.setTaskStatus(service, "failed", {
      error: "verification failed",
      finishedAt: new Date().toISOString(),
    });
    markSucceeded(store, consoleId);
    seedMainAccept(store, consoleId, "b".repeat(64));
    store.setTaskStatus(docs, "waiting", {
      error: "Waiting on prerequisites: service, console",
      finishedAt: null,
    });

    assert.equal(
      evaluateMilestoneGate(store, "integration", service, "failed").satisfied,
      false,
    );

    seedRemediationDisposition(store, service, {
      status: "verified-repaired-delivered",
      checkId: "check-failed-orig",
      createdAt: new Date().toISOString(),
      acceptanceBasis: "original-acceptance",
    });

    const repaired = evaluateMilestoneGate(store, "integration", service, "failed");
    assert.equal(repaired.satisfied, true);
    assert.match(repaired.reason, /repaired the current source/i);
    assert.doesNotMatch(repaired.reason, /exact accepted Candidate/i);

    await coordinator.recover();
    await coordinator.recover();
    assert.equal(store.getTask(docs).status, "queued");
    assert.equal(store.getTask(service).status, "failed", "machine failure stays durable");
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("legacy disposition without acceptanceBasis qualifies as original-acceptance", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-remed-legacy-basis-"));
  const planFile = await writeFourTaskPlan(home);
  const goalFile = await writeGoalFile(home, planFile);
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  try {
    const result = await coordinator.submitGoalFile(goalFile);
    const service = result.taskIdsByItemId.service!;
    markSucceeded(store, result.taskIdsByItemId.foundation!);
    await coordinator.recover();
    markSucceeded(store, service);
    seedRemediationDisposition(store, service, {
      status: "verified-repaired-delivered",
      checkId: "check-legacy",
      createdAt: new Date().toISOString(),
      // acceptanceBasis omitted on purpose (legacy compact record).
    });
    const gate = evaluateMilestoneGate(store, "integration", service, "succeeded");
    assert.equal(gate.satisfied, true);
    assert.equal(hasQualifyingOriginalAcceptanceRemediation(store, service), true);
    const facts = collectGoalEvidenceFacts(
      store,
      store.getGoal(result.goalId),
      store.getGoalMilestones(result.goalId),
    );
    const serviceFacts = facts.items.find((item) => item.itemId === "service")!;
    assert.equal(serviceFacts.remediationAcceptanceBasis, "original-acceptance");
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("maxDurationMs null stays unlimited across persistence and restart", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-null-"));
  const planFile = await writeFourTaskPlan(home);
  const goalFile = await writeGoalFile(home, planFile);
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  let goalId = "";
  try {
    const result = await coordinator.submitGoalFile(goalFile);
    goalId = result.goalId;
    const goal = store.getGoal(goalId);
    assert.equal(goal.policy.maxDurationMs, null);
    const view = projectGoal(store, goalId);
    assert.equal(view.policy.maxDurationMs, null);
    await coordinator.shutdown();
    store.close();
  } catch (error) {
    await coordinator.shutdown();
    store.close();
    throw error;
  }

  const reopened = new StateStore(home);
  const recovered = testCoordinator(reopened, 0);
  try {
    await recovered.recover();
    const goal = reopened.getGoal(goalId);
    assert.equal(goal.policy.maxDurationMs, null);
    assert.equal(goal.policy.noProgressTimeoutMs, null);
    const view = recovered.goalStatus(goalId);
    assert.equal(view.policy.maxDurationMs, null);
    // Elapsed time alone never stops unlimited goals.
    assert.notEqual(view.status, "stopped");
    assert.notEqual(view.reasonCode, "duration-exceeded");
  } finally {
    await recovered.shutdown();
    reopened.close();
  }
});

test("duplicate recovery and advance are idempotent; no-new-evidence stops at cap", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-idem-"));
  const planFile = await writeFourTaskPlan(home);
  const goalFile = await writeGoalFile(home, planFile, {
    policy: {
      maxDurationMs: null,
      noProgressTimeoutMs: null,
      maxCorrectionRounds: 1,
      maxReviewRounds: 1,
      maxNoNewEvidenceCycles: 2,
    },
  });
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  try {
    const result = await coordinator.submitGoalFile(goalFile);
    const foundation = result.taskIdsByItemId.foundation!;
    markSucceeded(store, foundation);

    await coordinator.recover();
    await coordinator.recover();
    const service = result.taskIdsByItemId.service!;
    assert.equal(store.getTask(service).status, "queued");
    const readyCount = store.listEvents(service).filter((e) => e.type === "task.ready").length;
    assert.equal(readyCount, 1);

    // Explicit advance without newer evidence increments the bounded counter.
    const a1 = coordinator.advanceGoal(result.goalId, true);
    assert.equal(a1.newEvidence, false);
    assert.equal(a1.noNewEvidenceCycles, 1);
    assert.notEqual(a1.goal.status, "stopped");

    const a2 = coordinator.advanceGoal(result.goalId, true);
    assert.equal(a2.newEvidence, false);
    assert.equal(a2.goal.status, "stopped");
    assert.equal(a2.goal.reasonCode, "no-new-evidence-cap");

    // Further advance does not launch work or mutate Tasks.
    const beforeTasks = store.listTasks().map((t) => `${t.id}:${t.status}`).sort();
    const a3 = coordinator.advanceGoal(result.goalId, true);
    assert.equal(a3.advanced, false);
    const afterTasks = store.listTasks().map((t) => `${t.id}:${t.status}`).sort();
    assert.deepEqual(afterTasks, beforeTasks);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("main stop is durable and blocks future goal task admission", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-stop-"));
  const planFile = await writeFourTaskPlan(home);
  const goalFile = await writeGoalFile(home, planFile);
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  try {
    const result = await coordinator.submitGoalFile(goalFile);
    const view = coordinator.stopGoal(result.goalId, true);
    assert.equal(view.status, "stopped");
    assert.equal(view.reasonCode, "main-stop");

    const service = result.taskIdsByItemId.service!;
    const foundation = result.taskIdsByItemId.foundation!;
    assert.equal(
      (coordinator.health().queuedTaskIds as string[]).includes(foundation),
      false,
    );
    assert.equal(store.getTask(foundation).status, "waiting");
    assert.match(store.getTask(foundation).error ?? "", /stopped|blocked/i);
    markSucceeded(store, foundation);
    await coordinator.recover();
    // Dependent remains unadmitted after stop.
    assert.notEqual(store.getTask(service).status, "queued");
    assert.match(store.getTask(service).error ?? "", /stopped|blocked/i);

    // History remains readable.
    const again = coordinator.goalStatus(result.goalId);
    assert.equal(again.status, "stopped");
    assert.equal(again.milestones.length, 4);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("failed milestone waits for bounded Main correction instead of terminating the Goal", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-correct-"));
  const planFile = await writeFourTaskPlan(home);
  const goalFile = await writeGoalFile(home, planFile);
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  try {
    const result = await coordinator.submitGoalFile(goalFile);
    markSucceeded(store, result.taskIdsByItemId.foundation!);
    const service = result.taskIdsByItemId.service!;
    const serviceTask = store.getTask(service);
    const failedAttemptId = `attempt-${service.slice(0, 8)}`;
    store.createAttempt({
      id: failedAttemptId,
      taskId: service,
      ordinal: 1,
      status: "failed",
      sessionId: serviceTask.sessionId,
      rawLogPath: path.join(serviceTask.paths.logs, "worker.log"),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });
    store.updateTask(service, { currentAttemptId: failedAttemptId });
    store.setTaskStatus(service, "failed", {
      error: "verification failed",
      finishedAt: new Date().toISOString(),
    });

    const waiting = coordinator.goalStatus(result.goalId);
    assert.equal(waiting.status, "waiting");
    assert.equal(waiting.reasonCode, "milestone-failed");

    coordinator.correct(service, "repair the one bounded acceptance gap", null, true);
    assert.equal(store.getTask(service).status, "queued");
    assert.equal(store.getGoal(result.goalId).counters.correctionRounds, 1);
    assert.equal(
      (coordinator.health().queuedTaskIds as string[]).includes(service),
      true,
    );
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("goal projection is privacy-safe and explains next action", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-proj-"));
  const planFile = await writeFourTaskPlan(home);
  const goalFile = await writeGoalFile(home, planFile);
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  try {
    const result = await coordinator.submitGoalFile(goalFile);
    const view = coordinator.goalStatus(result.goalId);
    const text = JSON.stringify(view);
    assert.doesNotMatch(text, /sk-[A-Za-z0-9]/);
    assert.doesNotMatch(text, /password/i);
    assert.doesNotMatch(text, /resultText/);
    assert.ok(view.objective.length > 0);
    assert.ok(view.nextAction.length > 0);
    assert.ok(view.whatJustHappened.length > 0);
    assert.ok(view.whatIsWaiting.length > 0);
    assert.equal(view.policy.maxDurationMs, null);
    for (const milestone of view.milestones) {
      assert.ok(milestone.gate === "machine" || milestone.gate === "main-accept" || milestone.gate === "integration");
      assert.ok(typeof milestone.nextAction === "string");
    }

    const foundation = result.taskIdsByItemId.foundation!;
    store.setTaskStatus(foundation, "interrupted", {
      error: "daemon restart",
      finishedAt: new Date().toISOString(),
    });
    const interrupted = coordinator.goalStatus(result.goalId);
    assert.equal(interrupted.currentMilestone?.itemId, "foundation");
    assert.equal(interrupted.nextActionCode, "resume-task");
    assert.match(interrupted.nextAction, /resume/i);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("goal correction cap rejects before mutation and waits for Main", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-cap-"));
  const planFile = await writeFourTaskPlan(home);
  const goalFile = await writeGoalFile(home, planFile, {
    policy: {
      maxDurationMs: null,
      noProgressTimeoutMs: null,
      maxCorrectionRounds: 0,
      maxReviewRounds: 0,
      maxNoNewEvidenceCycles: 2,
    },
  });
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  try {
    const result = await coordinator.submitGoalFile(goalFile);
    // Use a dependent Task that is waiting (not in the in-memory queue). The
    // wave-1 foundation remains queued after submit and would hit the ordinary
    // "already queued or running" guard before the Goal correction cap.
    const service = result.taskIdsByItemId.service!;
    assert.equal(store.getTask(service).status, "waiting");
    assert.equal(
      (coordinator.health().queuedTaskIds as string[]).includes(service),
      false,
    );
    store.setTaskStatus(service, "failed", {
      error: "verification failed",
      finishedAt: new Date().toISOString(),
    });
    const eventsBefore = store.listEvents(service).length;
    assert.throws(
      () => coordinator.correct(service, "please fix the acceptance gap carefully", null, true),
      /correction cap/i,
    );
    const goal = store.getGoal(result.goalId);
    assert.equal(goal.status, "waiting");
    assert.equal(goal.reasonCode, "correction-cap");
    // No correction grant or other mutation beyond Goal wait projection.
    const grants = store.listEvents(service).filter((e) => e.type === "attempt.authorization.granted");
    assert.equal(grants.length, 0);
    assert.equal(store.getTask(service).status, "failed");
    assert.equal(store.listEvents(service).length, eventsBefore);
    assert.equal(
      (coordinator.health().queuedTaskIds as string[]).includes(service),
      false,
    );
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("four-task goal recovers across daemon restart without duplication", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-restart-"));
  const planFile = await writeFourTaskPlan(home);
  const goalFile = await writeGoalFile(home, planFile);
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  let goalId = "";
  let taskIds: Record<string, string> = {};
  try {
    const result = await coordinator.submitGoalFile(goalFile);
    goalId = result.goalId;
    taskIds = result.taskIdsByItemId;
    markSucceeded(store, taskIds.foundation!);
    await coordinator.recover();
    assert.equal(store.getTask(taskIds.service!).status, "queued");
    await coordinator.shutdown();
    store.close();
  } catch (error) {
    await coordinator.shutdown();
    store.close();
    throw error;
  }

  const reopened = new StateStore(home);
  const recovered = testCoordinator(reopened, 0);
  try {
    await recovered.recover();
    await recovered.recover();
    const goal = reopened.getGoal(goalId);
    assert.equal(goal.policy.maxDurationMs, null);
    assert.equal(reopened.getGoalMilestones(goalId).length, 4);
    assert.equal(reopened.listTasks().length, 4);
    assert.equal(reopened.getTask(taskIds.service!).status, "queued");
    const ready = reopened.listEvents(taskIds.service!).filter((e) => e.type === "task.ready");
    assert.equal(ready.length, 1);
    const view = recovered.goalStatus(goalId);
    assert.equal(view.planId, path.resolve(planFile));
    assert.ok(view.milestones.every((m) => m.taskId));
  } finally {
    await recovered.shutdown();
    reopened.close();
  }
});

test("standalone plan submission invents no goal records", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-compat-"));
  const planFile = await writeFourTaskPlan(home);
  // Two-item minimum plan for standalone still works via plan loader min of 2,
  // but our helper writes 4. Submit as plan only.
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  try {
    const result = await coordinator.submitPlanFile(planFile);
    assert.equal(store.listGoals().length, 0);
    assert.equal(store.getGoalByPlanId(result.planId), undefined);
    const foundation = result.taskIdsByItemId.foundation!;
    const service = result.taskIdsByItemId.service!;
    markSucceeded(store, foundation);
    await coordinator.recover();
    // Machine success alone unlocks dependents for non-Goal plans.
    assert.equal(store.getTask(service).status, "queued");
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("worker chatter and status polls do not reset Goal evidence cursor", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-chatter-"));
  const planFile = await writeFourTaskPlan(home);
  const goalFile = await writeGoalFile(home, planFile, {
    policy: {
      maxDurationMs: null,
      noProgressTimeoutMs: 60_000,
      maxCorrectionRounds: 1,
      maxReviewRounds: 1,
      maxNoNewEvidenceCycles: 2,
    },
  });
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  try {
    const result = await coordinator.submitGoalFile(goalFile);
    const goalId = result.goalId;
    const foundation = result.taskIdsByItemId.foundation!;
    // Move foundation out of the admission queue so idle checks are meaningful,
    // but keep it non-terminal without new authoritative milestone evidence.
    store.setTaskStatus(foundation, "waiting", {
      error: "held for evidence cursor fixture",
      finishedAt: null,
    });
    const t0 = "2026-07-30T00:00:00.000Z";
    reconcileGoalRecords(store, goalId, { now: t0 });
    const before = store.getGoal(goalId);
    const milestones = store.getGoalMilestones(goalId);
    const digestBefore = before.evidenceDigest;
    const evidenceAtBefore = before.evidenceAt;

    store.addEvent(foundation, undefined, "worker.message", "thinking…", {
      text: "still thinking about the plan",
    });
    store.addEvent(foundation, undefined, "worker.message", "thinking again", {
      text: "ordinary Worker chatter must not count",
    });
    // Repeated status projection / reconciliation is not new evidence.
    reconcileGoalRecords(store, goalId, { now: "2026-07-30T00:00:30.000Z" });
    const afterPoll = store.getGoal(goalId);
    assert.equal(afterPoll.evidenceDigest, digestBefore);
    assert.equal(afterPoll.evidenceAt, evidenceAtBefore);

    const facts = collectGoalEvidenceFacts(store, afterPoll, milestones);
    assert.equal(
      facts.items.some((item) => "latestEventSequence" in item),
      false,
      "raw event sequences are not part of the authoritative cursor",
    );
    assert.equal(computeEvidenceDigest(facts), digestBefore);
    assert.equal(afterPoll.status, "waiting");
    assert.notEqual(afterPoll.reasonCode, "no-progress");
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("finite no-progress idle stop is terminal, blocks admission, and survives restart", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-idle-"));
  const planFile = await writeFourTaskPlan(home);
  const goalFile = await writeGoalFile(home, planFile, {
    policy: {
      maxDurationMs: null,
      noProgressTimeoutMs: 60_000,
      maxCorrectionRounds: 1,
      maxReviewRounds: 1,
      maxNoNewEvidenceCycles: 2,
    },
  });
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  let goalId = "";
  let service = "";
  let foundation = "";
  try {
    const result = await coordinator.submitGoalFile(goalFile);
    goalId = result.goalId;
    foundation = result.taskIdsByItemId.foundation!;
    service = result.taskIdsByItemId.service!;
    // No Goal-owned work in flight: hold the ready wave outside active statuses.
    store.setTaskStatus(foundation, "waiting", {
      error: "held idle for no-progress fixture",
      finishedAt: null,
    });
    const tEvidence = "2026-07-30T00:00:00.000Z";
    // Sync the authoritative cursor after the status hold, then freeze evidenceAt.
    reconcileGoalRecords(store, goalId, { now: tEvidence });
    assert.equal(hasGoalOwnedWorkInFlight(store, store.getGoalMilestones(goalId)), false);
    assert.equal(store.getGoal(goalId).evidenceAt, tEvidence);

    const past = "2026-07-30T00:02:00.000Z";
    const stopped = reconcileGoalRecords(store, goalId, { now: past });
    assert.equal(stopped.goal.status, "stopped");
    assert.equal(stopped.goal.reasonCode, "no-progress");
    assert.equal(stopped.goal.stoppedAt, past);
    assert.equal(stopped.goal.policy.maxDurationMs, null);
    assert.match(stopped.goal.reason, /no-progress|authoritative|admission/i);
    assert.match(stopped.goal.reason, /not killed|were not killed/i);

    // Coordinator status path must also prune future admission.
    const view = coordinator.goalStatus(goalId);
    assert.equal(view.status, "stopped");
    assert.equal(view.reasonCode, "no-progress");
    assert.equal(
      (coordinator.health().queuedTaskIds as string[]).includes(foundation),
      false,
    );
    markSucceeded(store, foundation);
    await coordinator.recover();
    assert.notEqual(store.getTask(service).status, "queued");
    assert.match(store.getTask(service).error ?? store.getTask(foundation).error ?? "", /stopped|blocked/i);

    // Second reconcile is idempotent: no duplicate mutation of terminal state.
    const again = reconcileGoalRecords(store, goalId, { now: "2026-07-30T00:05:00.000Z" });
    assert.equal(again.goal.status, "stopped");
    assert.equal(again.goal.reasonCode, "no-progress");
    assert.equal(again.goal.stoppedAt, past);
    await coordinator.shutdown();
    store.close();
  } catch (error) {
    await coordinator.shutdown();
    store.close();
    throw error;
  }

  const reopened = new StateStore(home);
  const recovered = testCoordinator(reopened, 0);
  try {
    await recovered.recover();
    await recovered.recover();
    const goal = reopened.getGoal(goalId);
    assert.equal(goal.status, "stopped");
    assert.equal(goal.reasonCode, "no-progress");
    assert.ok(goal.stoppedAt);
    assert.equal(goal.policy.maxDurationMs, null);
    assert.equal(goal.policy.noProgressTimeoutMs, 60_000);
    const view = recovered.goalStatus(goalId);
    assert.equal(view.status, "stopped");
    assert.equal(view.reasonCode, "no-progress");
    assert.notEqual(reopened.getTask(service).status, "queued");
    const ready = reopened.listEvents(service).filter((e) => e.type === "task.ready");
    assert.equal(ready.length, 0);
  } finally {
    await recovered.shutdown();
    reopened.close();
  }
});

test("in-flight Goal work suppresses idle stop even when wall clock exceeds noProgressTimeoutMs", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-inflight-"));
  const planFile = await writeFourTaskPlan(home);
  const goalFile = await writeGoalFile(home, planFile, {
    policy: {
      maxDurationMs: null,
      noProgressTimeoutMs: 60_000,
      maxCorrectionRounds: 1,
      maxReviewRounds: 1,
      maxNoNewEvidenceCycles: 2,
    },
  });
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  try {
    const result = await coordinator.submitGoalFile(goalFile);
    const goalId = result.goalId;
    const foundation = result.taskIdsByItemId.foundation!;
    store.setTaskStatus(foundation, "running", { error: null, finishedAt: null });
    const attemptId = `attempt-${foundation.slice(0, 8)}`;
    store.createAttempt({
      id: attemptId,
      taskId: foundation,
      ordinal: 1,
      status: "running",
      sessionId: `session-${attemptId}`,
      rawLogPath: path.join(store.getTask(foundation).paths.logs, "worker.log"),
      startedAt: "2026-07-30T00:00:00.000Z",
    });
    store.updateTask(foundation, { currentAttemptId: attemptId });

    const tEvidence = "2026-07-30T00:00:00.000Z";
    // Sync cursor after becoming running so the idle clock is honest.
    reconcileGoalRecords(store, goalId, { now: tEvidence });
    assert.equal(hasGoalOwnedWorkInFlight(store, store.getGoalMilestones(goalId)), true);
    const digestBefore = store.getGoal(goalId).evidenceDigest;
    assert.equal(store.getGoal(goalId).evidenceAt, tEvidence);

    // Worker chatter while running must not change the evidence cursor.
    store.addEvent(foundation, attemptId, "worker.message", "still thinking", {
      text: "long-running worker chatter",
    });
    const past = "2026-07-30T00:10:00.000Z";
    const kept = reconcileGoalRecords(store, goalId, { now: past });
    assert.notEqual(kept.goal.status, "stopped");
    assert.notEqual(kept.goal.reasonCode, "no-progress");
    assert.equal(kept.goal.evidenceDigest, digestBefore);
    assert.equal(kept.goal.evidenceAt, tEvidence);
    assert.equal(kept.goal.status, "running");
    assert.equal(store.getTask(foundation).status, "running");
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("authoritative verification evidence resets the idle window before stop decision", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-evidence-"));
  const planFile = await writeFourTaskPlan(home);
  const goalFile = await writeGoalFile(home, planFile, {
    policy: {
      maxDurationMs: null,
      noProgressTimeoutMs: 60_000,
      maxCorrectionRounds: 1,
      maxReviewRounds: 1,
      maxNoNewEvidenceCycles: 2,
    },
  });
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  try {
    const result = await coordinator.submitGoalFile(goalFile);
    const goalId = result.goalId;
    const foundation = result.taskIdsByItemId.foundation!;
    // Hold the ready wave idle and establish a frozen evidence cursor.
    store.setTaskStatus(foundation, "waiting", {
      error: "held before authoritative evidence",
      finishedAt: null,
    });
    reconcileGoalRecords(store, goalId, { now: "2026-07-30T00:00:00.000Z" });
    const staleAt = store.getGoal(goalId).evidenceAt;
    assert.equal(staleAt, "2026-07-30T00:00:00.000Z");

    // Authoritative machine success is real evidence and must refresh evidenceAt
    // even when wall time is far beyond the previous idle window.
    markSucceeded(store, foundation);
    const now = "2026-07-30T00:10:00.000Z";
    const reconciled = reconcileGoalRecords(store, goalId, { now });
    assert.equal(reconciled.evidenceChanged, true);
    assert.equal(reconciled.goal.evidenceAt, now);
    assert.notEqual(reconciled.goal.status, "stopped");
    assert.notEqual(reconciled.goal.reasonCode, "no-progress");

    // After the reset, force no in-flight ownership so a later idle clock can stop.
    for (const taskId of Object.values(result.taskIdsByItemId)) {
      const task = store.getTask(taskId);
      if (["queued", "preparing", "running", "verifying"].includes(task.status)) {
        store.setTaskStatus(taskId, "waiting", {
          error: "held for post-evidence idle fixture",
          finishedAt: null,
        });
      }
    }
    // Holding statuses is itself authoritative lifecycle evidence — resync once.
    reconcileGoalRecords(store, goalId, { now: "2026-07-30T00:10:30.000Z" });
    const later = "2026-07-30T00:12:00.000Z";
    const idle = reconcileGoalRecords(store, goalId, { now: later });
    assert.equal(idle.goal.status, "stopped");
    assert.equal(idle.goal.reasonCode, "no-progress");
    assert.equal(idle.goal.stoppedAt, later);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("no-new-evidence cap stop survives restart without duplicate Task mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-nne-restart-"));
  const planFile = await writeFourTaskPlan(home);
  const goalFile = await writeGoalFile(home, planFile, {
    policy: {
      maxDurationMs: null,
      noProgressTimeoutMs: null,
      maxCorrectionRounds: 1,
      maxReviewRounds: 1,
      maxNoNewEvidenceCycles: 2,
    },
  });
  const store = new StateStore(home);
  const coordinator = testCoordinator(store, 0);
  let goalId = "";
  let service = "";
  let foundation = "";
  try {
    const result = await coordinator.submitGoalFile(goalFile);
    goalId = result.goalId;
    foundation = result.taskIdsByItemId.foundation!;
    service = result.taskIdsByItemId.service!;
    markSucceeded(store, foundation);
    await coordinator.recover();
    assert.equal(store.getTask(service).status, "queued");
    const a1 = coordinator.advanceGoal(goalId, true);
    assert.equal(a1.noNewEvidenceCycles, 1);
    const a2 = coordinator.advanceGoal(goalId, true);
    assert.equal(a2.goal.status, "stopped");
    assert.equal(a2.goal.reasonCode, "no-new-evidence-cap");
    assert.equal(a2.noNewEvidenceCycles, 2);
    // Cap stop prunes future admission without launching replacements.
    assert.notEqual(store.getTask(service).status, "queued");
    const beforeTasks = store.listTasks().map((t) => `${t.id}:${t.status}`).sort();
    const readyBefore = store.listEvents(service).filter((e) => e.type === "task.ready").length;
    const stoppedAt = store.getGoal(goalId).stoppedAt;
    await coordinator.shutdown();
    store.close();

    const reopened = new StateStore(home);
    const recovered = testCoordinator(reopened, 0);
    try {
      await recovered.recover();
      await recovered.recover();
      const goal = reopened.getGoal(goalId);
      assert.equal(goal.status, "stopped");
      assert.equal(goal.reasonCode, "no-new-evidence-cap");
      assert.equal(goal.counters.noNewEvidenceCycles, 2);
      assert.equal(goal.stoppedAt, stoppedAt);
      const afterTasks = reopened.listTasks().map((t) => `${t.id}:${t.status}`).sort();
      assert.deepEqual(afterTasks, beforeTasks);
      const readyAfter = reopened.listEvents(service).filter((e) => e.type === "task.ready").length;
      assert.equal(readyAfter, readyBefore);
      // Further advance remains a no-op and does not re-admit waiting work.
      const a3 = recovered.advanceGoal(goalId, true);
      assert.equal(a3.advanced, false);
      assert.equal(a3.goal.status, "stopped");
      assert.notEqual(reopened.getTask(service).status, "queued");
    } finally {
      await recovered.shutdown();
      reopened.close();
    }
  } catch (error) {
    await coordinator.shutdown();
    store.close();
    throw error;
  }
});

// --- Direct Goal-Task Candidate handoff ---

async function writeHandoffChainPlan(root: string, projectRoot: string): Promise<string> {
  const planFile = path.join(root, "handoff-plan.json");
  // Point each item at a real Task template; project is overridden via workspace
  // paths when Tasks are created from the template under Goal registration.
  void projectRoot;
  await writeFile(
    planFile,
    JSON.stringify({
      version: 1,
      name: "Goal handoff chain",
      objective: "Four-task chain where milestone two can hand off a partial Candidate.",
      items: [
        { id: "foundation", task: taskTemplate, dependsOn: [] },
        { id: "service", task: taskTemplate, dependsOn: ["foundation"] },
        { id: "follow-on", task: taskTemplate, dependsOn: ["service"] },
        { id: "wrap-up", task: taskTemplate, dependsOn: ["follow-on"] },
      ],
    }),
  );
  return planFile;
}

async function writeHandoffGoalFile(root: string, planFile: string): Promise<string> {
  const goalFile = path.join(root, "handoff-goal.json");
  await writeFile(
    goalFile,
    JSON.stringify({
      version: 1,
      name: "Goal native handoff",
      objective: "Direct handoff without Competition.",
      planFile,
      policy: {
        maxDurationMs: null,
        noProgressTimeoutMs: null,
        maxCorrectionRounds: 2,
        maxReviewRounds: 2,
        maxNoNewEvidenceCycles: 3,
      },
      milestones: [
        { itemId: "foundation", gate: "machine" },
        { itemId: "service", gate: "integration" },
        { itemId: "follow-on", gate: "machine" },
        { itemId: "wrap-up", gate: "machine" },
      ],
    }, null, 2),
  );
  return goalFile;
}

function seedDestinationProfile(settings: SettingsService): void {
  const current = settings.get();
  const catalog = upsertModelConfig(current.modelCatalog, {
    id: "xai-grok-builder",
    label: "xAI Grok Builder",
    provider: "xai",
    model: "grok-4.5",
    endpoint: "https://api.x.ai/v1",
  });
  const profiles = upsertWorkerProfile(
    current.workerProfiles,
    {
      id: "grok-builder",
      label: "Grok Builder",
      runtime: "grok-build",
      modelConfigId: "xai-grok-builder",
      effort: "high",
      maxBudgetUsd: 1.0,
    },
    catalog,
  );
  settings.update({ modelCatalog: catalog, workerProfiles: profiles });
}

function completeTwoFileGoalCandidate(
  store: StateStore,
  task: TaskRecord,
  opts: { passed?: boolean } = {},
): { attemptId: string; revisionId: string; patchText: string } {
  const passed = opts.passed ?? false;
  const attemptId = randomUUID();
  const attempt: AttemptRecord = {
    id: attemptId,
    taskId: task.id,
    ordinal: 1,
    status: "succeeded",
    sessionId: task.sessionId,
    rawLogPath: path.join(task.paths.logs, "worker.log"),
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };
  store.createAttempt(attempt);
  const finishedAt = attempt.finishedAt ?? new Date().toISOString();
  if (passed) {
    store.setTaskStatus(task.id, "succeeded", {
      currentAttemptId: attemptId,
      startedAt: attempt.startedAt,
      finishedAt,
      error: null,
    });
  } else {
    store.setTaskStatus(task.id, "failed", {
      currentAttemptId: attemptId,
      startedAt: attempt.startedAt,
      finishedAt,
      error: "verification failed",
    });
  }
  mkdirSync(path.join(task.paths.workspace, "src"), { recursive: true });
  writeFileSync(path.join(task.paths.workspace, "src", "a.ts"), "export const a = 2;\n");
  writeFileSync(path.join(task.paths.workspace, "src", "b.ts"), "export const b = 2;\n");
  if (!existsSync(path.join(task.paths.baseline, "src", "a.ts"))) {
    mkdirSync(path.join(task.paths.baseline, "src"), { recursive: true });
    writeFileSync(path.join(task.paths.baseline, "src", "a.ts"), "export const a = 1;\n");
    writeFileSync(path.join(task.paths.baseline, "src", "b.ts"), "export const b = 1;\n");
    writeFileSync(path.join(task.paths.baseline, "README.md"), "# Test\n");
  }
  const patchText = [
    "diff --git a/baseline/src/a.ts b/workspace/src/a.ts",
    "--- a/baseline/src/a.ts",
    "+++ b/workspace/src/a.ts",
    "@@ -1 +1 @@",
    "-export const a = 1;",
    "+export const a = 2;",
    "diff --git a/baseline/src/b.ts b/workspace/src/b.ts",
    "--- a/baseline/src/b.ts",
    "+++ b/workspace/src/b.ts",
    "@@ -1 +1 @@",
    "-export const b = 1;",
    "+export const b = 2;",
    "",
  ].join("\n");
  mkdirSync(path.dirname(task.paths.diff), { recursive: true });
  writeFileSync(task.paths.diff, patchText);
  const revisionId = randomUUID();
  const artifactPath = path.join(task.paths.root, "revisions", `${revisionId}.patch`);
  mkdirSync(path.dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, patchText);
  const ev = store.addEvent(
    task.id,
    attemptId,
    "verification.completed",
    passed ? "Independent verification passed" : "Independent verification failed",
    {
      passed,
      behaviorPassed: passed,
      policyPassed: passed,
      sourceCompatible: true,
      commands: [],
      diffPath: task.paths.diff,
      sourceUnchanged: true,
      changeBudget: {
        filesChanged: 2,
        changedLines: 4,
        maxFiles: 10,
        maxDiffLines: 200,
        withinBudget: true,
      },
    },
  );
  store.addEvent(
    task.id,
    attemptId,
    "candidate.revision.captured",
    "Candidate revision captured for attempt ordinal 1",
    {
      id: revisionId,
      taskId: task.id,
      attemptId,
      attemptOrdinal: 1,
      verificationEventSequence: ev.sequence,
      patchDigest: sha256(patchText),
      affectedPaths: ["src/a.ts", "src/b.ts"],
      filesChanged: 2,
      changedLines: 4,
      verificationPassed: passed,
      createdAt: new Date().toISOString(),
      privateArtifactPath: artifactPath,
    },
  );
  return { attemptId, revisionId, patchText };
}

const HANDOFF_GAPS = [{
  description: "src/b.ts still needs the second export completed safely",
  acceptanceExpectation: "src/b.ts exports the updated constant and acceptance passes",
}];

test("direct Goal handoff retains one path, freezes destination, and follows successor for gates", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-handoff-"));
  const project = await mkdtemp(path.join(tmpdir(), "forklight-goal-handoff-proj-"));
  mkdirSync(path.join(project, "src"), { recursive: true });
  writeFileSync(path.join(project, "README.md"), "# Test\n");
  writeFileSync(path.join(project, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(path.join(project, "src", "b.ts"), "export const b = 1;\n");

  const planFile = await writeHandoffChainPlan(home, project);
  const goalFile = await writeHandoffGoalFile(home, planFile);
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  seedDestinationProfile(settings);
  const coordinator = new DaemonCoordinator(store, settings, 0, TEST_PROVIDER_AUTH_READY);
  try {
    const { goalId, taskIdsByItemId } = await coordinator.submitGoalFile(goalFile);
    const foundation = taskIdsByItemId.foundation!;
    const service = taskIdsByItemId.service!;
    const followOn = taskIdsByItemId["follow-on"]!;

    // Satisfy foundation so service is admitted.
    markSucceeded(store, foundation);
    await coordinator.recover();
    assert.equal(store.getTask(service).status, "queued");

    // Point the service Task project at our two-file fixture for materialization.
    const serviceTask = store.getTask(service);
    store.updateTask(service, {
      spec: { ...serviceTask.spec, project },
      sourcePath: project,
    });
    const refreshed = store.getTask(service);
    mkdirSync(refreshed.paths.workspace, { recursive: true });
    mkdirSync(refreshed.paths.baseline, { recursive: true });
    const { revisionId, patchText } = completeTwoFileGoalCandidate(store, refreshed, {
      passed: false,
    });

    const sourceBefore = structuredClone(store.getTask(service));
    const attemptsBefore = store.listAttempts(service).length;
    const digestBefore = store.getGoal(goalId).evidenceDigest;

    const view = await coordinator.goalTaskHandoff({
      taskId: service,
      candidateRevisionId: revisionId,
      reusablePaths: ["src/a.ts"],
      remainingGaps: HANDOFF_GAPS,
      destinationWorkerProfileId: "grok-builder",
      reason: "Keep a.ts and hand the remaining gap to Grok builder.",
      confirm: true,
    });

    assert.equal(view.status, "prepared");
    assert.equal(view.originKind, "goal-task");
    assert.equal(view.goalId, goalId);
    assert.equal(view.itemId, "service");
    assert.equal(view.competitionId, undefined);
    assert.equal(view.sourceCandidateId, undefined);
    assert.equal(view.destinationWorkerProfileId, "grok-builder");
    assert.equal(view.reusablePathCount, 1);
    assert.deepEqual(view.reusablePaths, ["src/a.ts"]);
    assert.ok(!JSON.stringify(view).includes("export const"));
    assert.ok(!JSON.stringify(view).includes(path.join(home, "runs")));

    // Source immutable.
    const sourceAfter = store.getTask(service);
    assert.equal(sourceAfter.status, sourceBefore.status);
    assert.equal(sourceAfter.error, sourceBefore.error);
    assert.equal(store.listAttempts(service).length, attemptsBefore);

    // Selected-path-only materialization with byte proof.
    const successor = store.getTask(view.successorTaskId);
    assert.equal(successor.status, "queued");
    assert.equal(successor.spec.workerProfileId, "grok-builder");
    assert.equal(
      readFileSync(path.join(successor.paths.workspace, "src", "a.ts"), "utf8"),
      "export const a = 2;\n",
    );
    assert.equal(
      readFileSync(path.join(successor.paths.workspace, "src", "b.ts"), "utf8"),
      "export const b = 1;\n",
    );

    // Lineage: original preserved; effective is successor.
    const milestone = store.getGoalMilestone(goalId, "service")!;
    const lineage = resolveEffectiveMilestoneLineage(store, milestone);
    assert.equal(lineage.originalTaskId, service);
    assert.equal(lineage.effectiveTaskId, view.successorTaskId);
    assert.equal(lineage.handoff?.origin.kind, "goal-task");

    // Source evidence cannot satisfy the integration gate after handoff.
    const sourceGate = evaluateMilestoneGate(store, "integration", service, "failed");
    assert.equal(sourceGate.satisfied, false);
    const projected = projectGoal(store, goalId);
    const serviceView = projected.milestones.find((m) => m.itemId === "service")!;
    assert.equal(serviceView.taskId, service);
    assert.equal(serviceView.effectiveTaskId, view.successorTaskId);
    assert.equal(serviceView.satisfied, false);
    assert.ok(serviceView.handoff);

    // Evidence digest changed exactly once for the handoff.
    const afterHandoff = store.getGoal(goalId);
    assert.notEqual(afterHandoff.evidenceDigest, digestBefore);

    // Successor completes retained + remaining gap, then Main accept + Integration.
    const succAttemptId = randomUUID();
    store.createAttempt({
      id: succAttemptId,
      taskId: successor.id,
      ordinal: 1,
      status: "succeeded",
      sessionId: successor.sessionId,
      rawLogPath: path.join(successor.paths.logs, "worker.log"),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });
    store.setTaskStatus(successor.id, "succeeded", {
      currentAttemptId: succAttemptId,
      error: null,
      finishedAt: new Date().toISOString(),
    });
    writeFileSync(path.join(successor.paths.workspace, "src", "b.ts"), "export const b = 2;\n");
    writeFileSync(successor.paths.diff, patchText);
    const ver = store.addEvent(
      successor.id,
      succAttemptId,
      "verification.completed",
      "Independent verification passed",
      { passed: true, commands: [] },
    );
    const succRevId = randomUUID();
    const succDigest = sha256(patchText);
    store.addEvent(successor.id, succAttemptId, "candidate.revision.captured", "revision", {
      id: succRevId,
      taskId: successor.id,
      attemptId: succAttemptId,
      attemptOrdinal: 1,
      verificationEventSequence: ver.sequence,
      patchDigest: succDigest,
      affectedPaths: ["src/a.ts", "src/b.ts"],
      filesChanged: 2,
      changedLines: 4,
      verificationPassed: true,
      createdAt: new Date().toISOString(),
    });
    store.addEvent(successor.id, succAttemptId, "main-review.completed", "Main accept", {
      decision: "accept",
      reason: "Successor completed the remaining gap",
      attemptId: succAttemptId,
      verificationEventSequence: ver.sequence,
      candidateRevisionId: succRevId,
      acceptedPatchDigest: succDigest,
    });
    seedIntegrationApplied(store, successor.id, succDigest);

    reconcileGoalRecords(store, goalId);
    const afterSuccess = projectGoal(store, goalId);
    const serviceDone = afterSuccess.milestones.find((m) => m.itemId === "service")!;
    assert.equal(serviceDone.effectiveTaskId, view.successorTaskId);
    assert.equal(serviceDone.satisfied, true, "integration gate follows successor only");
    assert.equal(serviceDone.taskId, service, "original Plan Task identity preserved");

    // Downstream follow-on is waiting; after service gate is satisfied it admits once.
    store.setTaskStatus(followOn, "waiting", {
      error: "Waiting on prerequisites: service",
      finishedAt: null,
    });
    await coordinator.recover();
    assert.equal(store.getTask(followOn).status, "queued");
    const readyBefore = store.listEvents(followOn).filter((e) => e.type === "task.ready").length;

    await coordinator.shutdown();
    store.close();

    const reopened = new StateStore(home);
    const recovered = new DaemonCoordinator(
      reopened,
      new SettingsService(reopened),
      0,
      TEST_PROVIDER_AUTH_READY,
    );
    try {
      await recovered.recover();
      await recovered.recover();
      const handoffs = reopened.listCandidateHandoffs();
      assert.equal(handoffs.length, 1);
      assert.equal(handoffs[0]!.origin.kind, "goal-task");
      // Recovery never duplicates handoff/successor or re-queues follow-on twice.
      await recoverCandidateHandoffs(reopened);
      assert.equal(reopened.listCandidateHandoffs().length, 1);
      const readyAfter = reopened.listEvents(followOn).filter((e) => e.type === "task.ready").length;
      assert.equal(readyAfter, readyBefore);
      assert.equal(reopened.getTask(service).status, "failed", "source stays failed history");
    } finally {
      await recovered.shutdown();
      reopened.close();
    }
  } catch (error) {
    await coordinator.shutdown().catch(() => {});
    store.close();
    throw error;
  }
});

test("direct Goal handoff admits Main-revise source and rejects invalid sources before mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-handoff-reject-"));
  const project = await mkdtemp(path.join(tmpdir(), "forklight-goal-handoff-rej-proj-"));
  mkdirSync(path.join(project, "src"), { recursive: true });
  writeFileSync(path.join(project, "README.md"), "# Test\n");
  writeFileSync(path.join(project, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(path.join(project, "src", "b.ts"), "export const b = 1;\n");

  const planFile = await writeHandoffChainPlan(home, project);
  const goalFile = await writeHandoffGoalFile(home, planFile);
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  seedDestinationProfile(settings);
  const coordinator = new DaemonCoordinator(store, settings, 0, TEST_PROVIDER_AUTH_READY);
  try {
    const { goalId, taskIdsByItemId } = await coordinator.submitGoalFile(goalFile);
    const foundation = taskIdsByItemId.foundation!;
    const service = taskIdsByItemId.service!;
    markSucceeded(store, foundation);
    await coordinator.recover();

    const serviceTask = store.getTask(service);
    store.updateTask(service, {
      spec: { ...serviceTask.spec, project },
      sourcePath: project,
    });
    const refreshed = store.getTask(service);
    mkdirSync(refreshed.paths.workspace, { recursive: true });
    mkdirSync(refreshed.paths.baseline, { recursive: true });
    const { attemptId, revisionId } = completeTwoFileGoalCandidate(store, refreshed, {
      passed: true,
    });
    // Fresh exact Main revise.
    store.addEvent(service, attemptId, "main-review.completed", "Main revise", {
      decision: "revise",
      reason: "Module b is incomplete and needs another Worker",
      attemptId,
      verificationEventSequence: store.listEvents(service)
        .filter((e) => e.type === "verification.completed")
        .at(-1)!.sequence,
      candidateRevisionId: revisionId,
      acceptedPatchDigest: store.listEvents(service)
        .filter((e) => e.type === "candidate.revision.captured")
        .at(-1)!.payload
        && (store.listEvents(service)
          .filter((e) => e.type === "candidate.revision.captured")
          .at(-1)!.payload as { patchDigest: string }).patchDigest,
    });

    const handoff = await executeGoalTaskHandoff(
      store,
      settings.get(),
      {
        taskId: service,
        candidateRevisionId: revisionId,
        reusablePaths: ["src/a.ts"],
        remainingGaps: HANDOFF_GAPS,
        destinationWorkerProfileId: "grok-builder",
        reason: "Main revise: hand incomplete module to another Worker",
        confirm: true,
      },
      { canLaunch: () => ({ ok: true }) },
    );
    assert.equal(handoff.originKind, "goal-task");
    assert.equal(handoff.status, "prepared");
    // Source success remains visible but cannot satisfy after handoff.
    assert.equal(store.getTask(service).status, "succeeded");
    const lineage = resolveEffectiveMilestoneLineage(
      store,
      store.getGoalMilestone(goalId, "service")!,
    );
    assert.equal(lineage.effectiveTaskId, handoff.successorTaskId);
    assert.notEqual(lineage.effectiveTaskId, service);

    // Mismatched taskId + existing revision is never an exact replay.
    const handoffCountAfterSuccess = store.listCandidateHandoffs().length;
    await assert.rejects(
      () => executeGoalTaskHandoff(
        store,
        settings.get(),
        {
          taskId: foundation,
          candidateRevisionId: revisionId,
          reusablePaths: ["src/a.ts"],
          remainingGaps: HANDOFF_GAPS,
          destinationWorkerProfileId: "grok-builder",
          reason: "Main revise: hand incomplete module to another Worker",
          confirm: true,
        },
        { canLaunch: () => ({ ok: true }) },
      ),
      (err: unknown) => err instanceof CandidateHandoffError && err.code === "duplicate-handoff",
    );
    assert.equal(
      store.listCandidateHandoffs().length,
      handoffCountAfterSuccess,
      "mismatched taskId must not create a second successor",
    );

    // Successor cannot hand off again (one hop).
    await assert.rejects(
      () => executeGoalTaskHandoff(
        store,
        settings.get(),
        {
          taskId: handoff.successorTaskId,
          candidateRevisionId: revisionId,
          reusablePaths: ["src/a.ts"],
          remainingGaps: HANDOFF_GAPS,
          destinationWorkerProfileId: "grok-builder",
          reason: "successor cannot hand off again",
          confirm: true,
        },
        { canLaunch: () => ({ ok: true }) },
      ),
      (err: unknown) => err instanceof CandidateHandoffError
        && (err.code === "source-is-successor" || err.code === "not-goal-task"),
    );

    // Even an exact replay still requires explicit Main confirmation.
    await assert.rejects(
      () => executeGoalTaskHandoff(
        store,
        settings.get(),
        {
          taskId: service,
          candidateRevisionId: revisionId,
          reusablePaths: ["src/a.ts"],
          remainingGaps: HANDOFF_GAPS,
          destinationWorkerProfileId: "grok-builder",
          reason: "Main revise: hand incomplete module to another Worker",
          // Runtime boundary: simulate a malformed caller despite the typed API.
          confirm: false as unknown as true,
        },
        { canLaunch: () => ({ ok: true }) },
      ),
      (err: unknown) => err instanceof CandidateHandoffError && err.code === "confirm-required",
    );
    assert.equal(store.listCandidateHandoffs().length, 1);

    // Exact confirmed replay is idempotent; a different reason is rejected before a second successor.
    const replay = await executeGoalTaskHandoff(
      store,
      settings.get(),
      {
        taskId: service,
        candidateRevisionId: revisionId,
        reusablePaths: ["src/a.ts"],
        remainingGaps: HANDOFF_GAPS,
        destinationWorkerProfileId: "grok-builder",
        reason: "Main revise: hand incomplete module to another Worker",
        confirm: true,
      },
      { canLaunch: () => ({ ok: true }) },
    );
    assert.equal(replay.successorTaskId, handoff.successorTaskId);
    assert.equal(store.listCandidateHandoffs().length, 1);
    await assert.rejects(
      () => executeGoalTaskHandoff(
        store,
        settings.get(),
        {
          taskId: service,
          candidateRevisionId: revisionId,
          reusablePaths: ["src/a.ts"],
          remainingGaps: HANDOFF_GAPS,
          destinationWorkerProfileId: "grok-builder",
          reason: "A different reason must not create a second successor",
          confirm: true,
        },
        { canLaunch: () => ({ ok: true }) },
      ),
      (err: unknown) => err instanceof CandidateHandoffError && err.code === "duplicate-handoff",
    );

    // Terminal Goal rejects before mutation.
    store.saveGoal({
      ...store.getGoal(goalId),
      status: "stopped",
      reasonCode: "main-stop",
      reason: "stopped for rejection fixture",
      stoppedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, store.getGoalMilestones(goalId));
    // Use a fresh Goal task path: wrap-up without handoff.
    const wrap = taskIdsByItemId["wrap-up"]!;
    const wrapTask = store.getTask(wrap);
    store.updateTask(wrap, {
      spec: { ...wrapTask.spec, project },
      sourcePath: project,
    });
    const wrapRef = store.getTask(wrap);
    mkdirSync(wrapRef.paths.workspace, { recursive: true });
    mkdirSync(wrapRef.paths.baseline, { recursive: true });
    const wrapCand = completeTwoFileGoalCandidate(store, wrapRef, { passed: false });
    const beforeCount = store.listCandidateHandoffs().length;
    await assert.rejects(
      () => executeGoalTaskHandoff(
        store,
        settings.get(),
        {
          taskId: wrap,
          candidateRevisionId: wrapCand.revisionId,
          reusablePaths: ["src/a.ts"],
          remainingGaps: HANDOFF_GAPS,
          destinationWorkerProfileId: "grok-builder",
          reason: "terminal goal must reject",
          confirm: true,
        },
        { canLaunch: () => ({ ok: true }) },
      ),
      (err: unknown) => err instanceof CandidateHandoffError && err.code === "goal-terminal",
    );
    assert.equal(store.listCandidateHandoffs().length, beforeCount);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("direct Goal handoff rejects interrupted source and only blocks applied/retained-failure Integration", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-handoff-elig-"));
  const project = await mkdtemp(path.join(tmpdir(), "forklight-goal-handoff-elig-proj-"));
  mkdirSync(path.join(project, "src"), { recursive: true });
  writeFileSync(path.join(project, "README.md"), "# Test\n");
  writeFileSync(path.join(project, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(path.join(project, "src", "b.ts"), "export const b = 1;\n");

  const planFile = await writeHandoffChainPlan(home, project);
  const goalFile = await writeHandoffGoalFile(home, planFile);
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  seedDestinationProfile(settings);
  const coordinator = new DaemonCoordinator(store, settings, 0, TEST_PROVIDER_AUTH_READY);

  function prepareMilestoneTask(taskId: string): TaskRecord {
    const task = store.getTask(taskId);
    store.updateTask(taskId, { spec: { ...task.spec, project }, sourcePath: project });
    const refreshed = store.getTask(taskId);
    mkdirSync(refreshed.paths.workspace, { recursive: true });
    mkdirSync(refreshed.paths.baseline, { recursive: true });
    return refreshed;
  }

  try {
    const { taskIdsByItemId } = await coordinator.submitGoalFile(goalFile);
    const foundation = taskIdsByItemId.foundation!;
    const service = taskIdsByItemId.service!;
    const followOn = taskIdsByItemId["follow-on"]!;
    const wrap = taskIdsByItemId["wrap-up"]!;
    markSucceeded(store, foundation);
    await coordinator.recover();

    // Interrupted source: rejected before mutation.
    {
      const refreshed = prepareMilestoneTask(service);
      const { revisionId } = completeTwoFileGoalCandidate(store, refreshed, { passed: false });
      store.setTaskStatus(service, "interrupted", {
        error: "worker interrupted",
        finishedAt: new Date().toISOString(),
      });
      const before = store.listCandidateHandoffs().length;
      await assert.rejects(
        () => executeGoalTaskHandoff(
          store,
          settings.get(),
          {
            taskId: service,
            candidateRevisionId: revisionId,
            reusablePaths: ["src/a.ts"],
            remainingGaps: HANDOFF_GAPS,
            destinationWorkerProfileId: "grok-builder",
            reason: "interrupted source must reject",
            confirm: true,
          },
          { canLaunch: () => ({ ok: true }) },
        ),
        (err: unknown) => err instanceof CandidateHandoffError && err.code === "source-not-eligible",
      );
      assert.equal(store.listCandidateHandoffs().length, before);
    }

    // Applied Integration blocks.
    {
      const refreshed = prepareMilestoneTask(followOn);
      const { revisionId } = completeTwoFileGoalCandidate(store, refreshed, { passed: false });
      const revision = resolveLatestRevision(store.listEvents(followOn))!;
      seedIntegrationApplied(store, followOn, revision.patchDigest);
      assert.equal(hasSourceBlockingIntegration(store, followOn), true);
      const before = store.listCandidateHandoffs().length;
      await assert.rejects(
        () => executeGoalTaskHandoff(
          store,
          settings.get(),
          {
            taskId: followOn,
            candidateRevisionId: revisionId,
            reusablePaths: ["src/a.ts"],
            remainingGaps: HANDOFF_GAPS,
            destinationWorkerProfileId: "grok-builder",
            reason: "applied integration must block",
            confirm: true,
          },
          { canLaunch: () => ({ ok: true }) },
        ),
        (err: unknown) => err instanceof CandidateHandoffError && err.code === "source-not-eligible",
      );
      assert.equal(store.listCandidateHandoffs().length, before);
    }

    // Rejected Integration history alone does not block handoff.
    {
      const refreshed = prepareMilestoneTask(wrap);
      const { revisionId } = completeTwoFileGoalCandidate(store, refreshed, { passed: false });
      const revision = resolveLatestRevision(store.listEvents(wrap))!;
      store.saveIntegrationReceipt({
        id: "receipt-rejected",
        taskId: wrap,
        patchDigest: revision.patchDigest,
        affectedFiles: ["src/a.ts"],
        rejectionReasons: ["fixture reject"],
        sourceEvidence: {},
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        consumed: false,
      });
      store.saveIntegrationResult({
        id: "op-rejected",
        receiptId: "receipt-rejected",
        taskId: wrap,
        status: "rejected",
        createdAt: new Date().toISOString(),
      });
      assert.equal(hasSourceBlockingIntegration(store, wrap), false);
      const allowedAfterReject = await executeGoalTaskHandoff(
        store,
        settings.get(),
        {
          taskId: wrap,
          candidateRevisionId: revisionId,
          reusablePaths: ["src/a.ts"],
          remainingGaps: HANDOFF_GAPS,
          destinationWorkerProfileId: "grok-builder",
          reason: "rejected integration history alone must not block handoff",
          confirm: true,
        },
        { canLaunch: () => ({ ok: true }) },
      );
      assert.equal(allowedAfterReject.status, "prepared");
    }

    // Retained-failure Integration blocks eligibility (patch left in source).
    {
      const refreshed = prepareMilestoneTask(foundation);
      const { revisionId } = completeTwoFileGoalCandidate(store, refreshed, { passed: false });
      const revision = resolveLatestRevision(store.listEvents(foundation))!;
      assert.equal(revision.id, revisionId);
      store.saveIntegrationReceipt({
        id: "receipt-retained",
        taskId: foundation,
        patchDigest: revision.patchDigest,
        affectedFiles: ["src/a.ts"],
        rejectionReasons: [],
        sourceEvidence: {},
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        consumed: true,
      });
      store.saveIntegrationResult({
        id: "op-retained",
        receiptId: "receipt-retained",
        taskId: foundation,
        status: "retained-failure",
        createdAt: new Date().toISOString(),
      });
      assert.equal(hasSourceBlockingIntegration(store, foundation), true);
      const eligibility = isGoalTaskHandoffSourceEligible(
        store,
        store.getTask(foundation),
        revision,
      );
      assert.equal(eligibility.ok, false);
      if (!eligibility.ok) assert.equal(eligibility.code, "source-not-eligible");
      const before = store.listCandidateHandoffs().length;
      await assert.rejects(
        () => executeGoalTaskHandoff(
          store,
          settings.get(),
          {
            taskId: foundation,
            candidateRevisionId: revisionId,
            reusablePaths: ["src/a.ts"],
            remainingGaps: HANDOFF_GAPS,
            destinationWorkerProfileId: "grok-builder",
            reason: "retained-failure must block handoff",
            confirm: true,
          },
          { canLaunch: () => ({ ok: true }) },
        ),
        (err: unknown) => err instanceof CandidateHandoffError && err.code === "source-not-eligible",
      );
      assert.equal(store.listCandidateHandoffs().length, before);
    }
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("direct Goal handoff counts as evidence change and keeps successor in-flight for no-progress", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-handoff-progress-"));
  const project = await mkdtemp(path.join(tmpdir(), "forklight-goal-handoff-prog-proj-"));
  mkdirSync(path.join(project, "src"), { recursive: true });
  writeFileSync(path.join(project, "README.md"), "# Test\n");
  writeFileSync(path.join(project, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(path.join(project, "src", "b.ts"), "export const b = 1;\n");

  const planFile = await writeHandoffChainPlan(home, project);
  const goalFile = path.join(home, "handoff-goal-progress.json");
  await writeFile(
    goalFile,
    JSON.stringify({
      version: 1,
      name: "Goal handoff progress",
      objective: "Handoff is evidence; successor is in-flight.",
      planFile,
      policy: {
        maxDurationMs: null,
        noProgressTimeoutMs: 60_000,
        maxCorrectionRounds: 1,
        maxReviewRounds: 1,
        maxNoNewEvidenceCycles: 2,
      },
      milestones: [
        { itemId: "foundation", gate: "machine" },
        { itemId: "service", gate: "machine" },
        { itemId: "follow-on", gate: "machine" },
        { itemId: "wrap-up", gate: "machine" },
      ],
    }, null, 2),
  );

  const store = new StateStore(home);
  const settings = new SettingsService(store);
  seedDestinationProfile(settings);
  const coordinator = new DaemonCoordinator(store, settings, 0, TEST_PROVIDER_AUTH_READY);
  try {
    const { goalId, taskIdsByItemId } = await coordinator.submitGoalFile(goalFile);
    const foundation = taskIdsByItemId.foundation!;
    const service = taskIdsByItemId.service!;
    markSucceeded(store, foundation);
    await coordinator.recover();

    const serviceTask = store.getTask(service);
    store.updateTask(service, {
      spec: { ...serviceTask.spec, project },
      sourcePath: project,
    });
    const refreshed = store.getTask(service);
    mkdirSync(refreshed.paths.workspace, { recursive: true });
    mkdirSync(refreshed.paths.baseline, { recursive: true });
    const { revisionId } = completeTwoFileGoalCandidate(store, refreshed, { passed: false });

    const t0 = "2026-07-30T00:00:00.000Z";
    reconcileGoalRecords(store, goalId, { now: t0 });
    const digestBefore = store.getGoal(goalId).evidenceDigest;

    await coordinator.goalTaskHandoff({
      taskId: service,
      candidateRevisionId: revisionId,
      reusablePaths: ["src/a.ts"],
      remainingGaps: HANDOFF_GAPS,
      destinationWorkerProfileId: "grok-builder",
      reason: "Evidence-changing direct Goal handoff",
      confirm: true,
    });

    const after = store.getGoal(goalId);
    assert.notEqual(after.evidenceDigest, digestBefore);
    assert.equal(
      hasGoalOwnedWorkInFlight(store, store.getGoalMilestones(goalId)),
      true,
      "queued successor must count as Goal-owned in-flight work",
    );

    // Idle no-progress must not fire while successor is queued.
    const later = "2026-07-30T00:05:00.000Z";
    const idle = reconcileGoalRecords(store, goalId, { now: later });
    assert.notEqual(idle.goal.reasonCode, "no-progress");
    assert.notEqual(idle.goal.status, "stopped");

    // Polling alone does not change digest.
    const digestAfterHandoff = idle.goal.evidenceDigest;
    reconcileGoalRecords(store, goalId, { now: "2026-07-30T00:05:30.000Z" });
    assert.equal(store.getGoal(goalId).evidenceDigest, digestAfterHandoff);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

test("handoff successor original-acceptance remediation satisfies integration and unblocks follow-on", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-goal-remed-handoff-"));
  const project = await mkdtemp(path.join(tmpdir(), "forklight-goal-remed-handoff-proj-"));
  mkdirSync(path.join(project, "src"), { recursive: true });
  writeFileSync(path.join(project, "README.md"), "# Test\n");
  writeFileSync(path.join(project, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(path.join(project, "src", "b.ts"), "export const b = 1;\n");

  const planFile = await writeHandoffChainPlan(home, project);
  const goalFile = await writeHandoffGoalFile(home, planFile);
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  seedDestinationProfile(settings);
  const coordinator = new DaemonCoordinator(store, settings, 0, TEST_PROVIDER_AUTH_READY);
  try {
    const { goalId, taskIdsByItemId } = await coordinator.submitGoalFile(goalFile);
    const foundation = taskIdsByItemId.foundation!;
    const service = taskIdsByItemId.service!;
    const followOn = taskIdsByItemId["follow-on"]!;
    markSucceeded(store, foundation);
    await coordinator.recover();

    const serviceTask = store.getTask(service);
    store.updateTask(service, {
      spec: { ...serviceTask.spec, project },
      sourcePath: project,
    });
    const refreshed = store.getTask(service);
    mkdirSync(refreshed.paths.workspace, { recursive: true });
    mkdirSync(refreshed.paths.baseline, { recursive: true });
    const { revisionId } = completeTwoFileGoalCandidate(store, refreshed, {
      passed: false,
    });

    const handoff = await coordinator.goalTaskHandoff({
      taskId: service,
      candidateRevisionId: revisionId,
      reusablePaths: ["src/a.ts"],
      remainingGaps: HANDOFF_GAPS,
      destinationWorkerProfileId: "grok-builder",
      reason: "Keep a.ts and hand the remaining gap to Grok builder.",
      confirm: true,
    });

    // Disposition on the original failed source is not effective after handoff.
    seedRemediationDisposition(store, service, {
      status: "verified-repaired-delivered",
      checkId: "check-source-must-be-ignored",
      createdAt: new Date().toISOString(),
      acceptanceBasis: "original-acceptance",
    });
    const projectedSourceOnly = projectGoal(store, goalId);
    const serviceViewBlocked = projectedSourceOnly.milestones.find((m) => m.itemId === "service")!;
    assert.equal(serviceViewBlocked.effectiveTaskId, handoff.successorTaskId);
    assert.equal(serviceViewBlocked.satisfied, false);

    // Successor owns delivery; machine success + Main revise, then remediate.
    const successorId = handoff.successorTaskId;
    markSucceeded(store, successorId);
    store.addEvent(successorId, undefined, "main-review.completed", "Main revise", {
      decision: "revise",
      reason: "Provider contract defect; repair current source",
    });
    const digestBefore = store.getGoal(goalId).evidenceDigest;
    assert.equal(
      evaluateMilestoneGate(
        store,
        "integration",
        successorId,
        store.getTask(successorId).status,
      ).satisfied,
      false,
    );

    seedRemediationDisposition(store, successorId, {
      status: "verified-repaired-delivered",
      checkId: "check-successor-orig",
      createdAt: new Date().toISOString(),
      acceptanceBasis: "original-acceptance",
    });

    const milestone = store.getGoalMilestone(goalId, "service")!;
    const lineage = resolveEffectiveMilestoneLineage(store, milestone);
    assert.equal(lineage.originalTaskId, service);
    assert.equal(lineage.effectiveTaskId, successorId);

    const reconcile = reconcileGoalRecords(store, goalId);
    assert.equal(reconcile.evidenceChanged, true);
    const serviceMilestone = reconcile.milestones.find((m) => m.itemId === "service")!;
    assert.equal(serviceMilestone.satisfied, true);
    assert.match(serviceMilestone.reason, /repaired the current source/i);
    assert.doesNotMatch(serviceMilestone.reason, /exact accepted Candidate/i);
    assert.notEqual(store.getGoal(goalId).evidenceDigest, digestBefore);

    const facts = collectGoalEvidenceFacts(
      store,
      store.getGoal(goalId),
      store.getGoalMilestones(goalId),
    );
    const serviceFacts = facts.items.find((item) => item.itemId === "service")!;
    assert.equal(serviceFacts.effectiveTaskId, successorId);
    assert.equal(serviceFacts.remediationCheckId, "check-successor-orig");
    // Source disposition must not appear as effective evidence.
    assert.notEqual(serviceFacts.remediationCheckId, "check-source-must-be-ignored");

    store.setTaskStatus(followOn, "waiting", {
      error: "Waiting on prerequisites: service",
      finishedAt: null,
    });
    await coordinator.recover();
    assert.equal(store.getTask(followOn).status, "queued");
    assert.equal(store.getTask(service).status, "failed", "original stays failed history");
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});

// --- FL-107B derived-Task network policy preservation ---

const NETWORK_PROXY_POLICY = {
  mode: "custom-proxy" as const,
  httpProxy: "http://127.0.0.1:7890",
  httpsProxy: "http://127.0.0.1:7891",
  noProxy: "localhost,127.0.0.1",
};

/** Seed one saved Worker Profile whose resolved network policy is custom-proxy. */
function seedNetworkPolicyProfile(settings: SettingsService): void {
  const current = settings.get();
  const profiles = upsertWorkerProfile(
    current.workerProfiles,
    {
      id: "net-worker",
      label: "Net Worker",
      runtime: "claude-code",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      effort: "medium",
      networkPolicy: NETWORK_PROXY_POLICY,
    },
  );
  settings.update({ workerProfiles: profiles });
}

/** Write a four-item plan whose templates reference the custom-proxy Profile. */
async function writeNetworkPolicyPlan(root: string): Promise<string> {
  // The plan quality gate loads each template through loadTaskSpec, which
  // requires the resolved project directory to exist and be readable. Copy the
  // known-good checkout contract (passes the quality gate) but repoint its
  // project at a bounded temp fixture so the plan loads deterministically.
  const projectDir = path.join(root, "project");
  mkdirSync(path.join(projectDir, "src"), { recursive: true });
  writeFileSync(path.join(projectDir, "src", "main.ts"), "export const x = 1;\n");
  writeFileSync(path.join(projectDir, "README.md"), "# Fixture\n");
  const example = await readFile(taskTemplate, "utf8");
  const repointed = example.replace(/^project: .*$/m, "project: ./project");
  const template = path.join(root, "net-task.yaml");
  await writeFile(template, `${repointed.trimEnd()}\nworkerProfileId: net-worker\n`);
  const planFile = path.join(root, "net-plan.json");
  await writeFile(
    planFile,
    JSON.stringify({
      version: 1,
      name: "Network policy plan",
      objective: "Prove plan tasks freeze the profile network policy.",
      items: [
        { id: "net-a", task: template, dependsOn: [] },
        { id: "net-b", task: template, dependsOn: ["net-a"] },
        { id: "net-c", task: template, dependsOn: ["net-a"] },
        { id: "net-d", task: template, dependsOn: ["net-b", "net-c"] },
      ],
    }),
  );
  return planFile;
}

const NETWORK_GOAL_MILESTONES = [
  { itemId: "net-a", gate: "machine" },
  { itemId: "net-b", gate: "machine" },
  { itemId: "net-c", gate: "machine" },
  { itemId: "net-d", gate: "machine" },
];

test("Plan and Goal Tasks preserve the frozen network policy from parsed templates", async () => {
  // Standalone Plan registration.
  const planHome = await mkdtemp(path.join(tmpdir(), "forklight-netpolicy-plan-"));
  const planStore = new StateStore(planHome);
  const planSettings = new SettingsService(planStore);
  seedNetworkPolicyProfile(planSettings);
  const planCoordinator = new DaemonCoordinator(planStore, planSettings, 0);
  try {
    const planFile = await writeNetworkPolicyPlan(planHome);
    const planResult = await planCoordinator.submitPlanFile(planFile);
    const planTask = planStore.getTask(planResult.taskIdsByItemId["net-a"]!);
    assert.deepEqual(planTask.spec.networkPolicy, NETWORK_PROXY_POLICY);
  } finally {
    await planCoordinator.shutdown();
    planStore.close();
  }

  // Goal registration re-parses the same template shape.
  const goalHome = await mkdtemp(path.join(tmpdir(), "forklight-netpolicy-goal-"));
  const goalStore = new StateStore(goalHome);
  const goalSettings = new SettingsService(goalStore);
  seedNetworkPolicyProfile(goalSettings);
  const goalCoordinator = new DaemonCoordinator(goalStore, goalSettings, 0);
  try {
    const planFile = await writeNetworkPolicyPlan(goalHome);
    const goalFile = await writeGoalFile(goalHome, planFile, {
      name: "Network policy goal",
      objective: "Prove goal tasks freeze the profile network policy.",
      milestones: NETWORK_GOAL_MILESTONES,
    });
    const goalResult = await goalCoordinator.submitGoalFile(goalFile);
    const goalTask = goalStore.getTask(goalResult.taskIdsByItemId["net-a"]!);
    assert.deepEqual(goalTask.spec.networkPolicy, NETWORK_PROXY_POLICY);

    // Public task.created events never serialize proxy values.
    const eventText = goalStore
      .listEvents(goalTask.id)
      .map((event) => JSON.stringify(event.payload))
      .join("\n");
    assert.ok(!eventText.includes("127.0.0.1:7890"));
    assert.ok(!eventText.includes("httpProxy"));
    assert.ok(!eventText.includes("noProxy"));
  } finally {
    await goalCoordinator.shutdown();
    goalStore.close();
  }
});

test("adaptation copies the parent TaskSpec and preserves the frozen network policy", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-netpolicy-adapt-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  seedNetworkPolicyProfile(settings);
  const coordinator = new DaemonCoordinator(store, settings, 0);
  const caps = enforcementCapabilityForRuntime("claude-code");
  const base = resolveEffectivePolicy(
    undefined,
    undefined,
    defaultAdvancedPolicyFields(),
    "net-worker",
    caps,
  );
  const snapshot: EffectivePolicySnapshot = {
    ...base,
    values: { ...base.values, maxAdaptationRounds: 1 },
  };
  const parent = registerTaskFromSpec(
    store,
    {
      version: 1,
      name: "adapt-net-parent",
      project: "/tmp/net-adapt-src",
      goal: "Adaptation transition test",
      constraints: [],
      provider: { name: "deepseek", model: "deepseek-v4-flash", keychainService: "forklight.test.api-key" },
      runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: 0.1 },
      workspace: { exclude: [] },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
      acceptance: { commands: ["true"] },
      workerProfileId: "net-worker",
      // Real parsed Tasks freeze the snapshot; mirror that for the parent.
      networkPolicy: Object.freeze({ ...NETWORK_PROXY_POLICY }),
    },
    "forklight://test/net-adapt",
    snapshot,
  );
  try {
    store.setTaskStatus(parent.id, "succeeded", { error: null });
    const result = coordinator.adaptationApply({
      taskId: parent.id,
      patch: { maxDurationMs: 600_000 },
      reason: "duration-budget",
      confirm: true,
    });
    assert.equal(result.status, "eligible");
    const child = store.getTask(result.childTaskId!);
    assert.deepEqual(child.spec.networkPolicy, NETWORK_PROXY_POLICY);
    // Parent Task stays byte-equivalent on the network policy.
    assert.deepEqual(store.getTask(parent.id).spec.networkPolicy, NETWORK_PROXY_POLICY);
  } finally {
    await coordinator.shutdown();
    store.close();
  }
});
