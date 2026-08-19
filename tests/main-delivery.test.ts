/**
 * M4-E Main delivery checkpoints: shipped prepare/decide service.
 *
 * Drives prepareMainDelivery / decideMainDelivery (the same functions
 * Coordinator, CLI, and MCP call). Store/event counts prove zero Main
 * accept and zero Integration after prepare alone.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { captureCandidateRevision } from "../src/core/candidate-revision.js";
import { taskPaths } from "../src/core/config.js";
import { applyIntegration, preflightIntegration } from "../src/core/integration.js";
import {
  countIntegrationOperations,
  countMainReviews,
  countPreflightReceipts,
  decideMainDelivery,
  formatMainDeliveryCheckpointHuman,
  prepareMainDelivery,
  type MainDeliveryHost,
} from "../src/core/main-delivery.js";
import { recordMainReview } from "../src/core/main-review.js";
import {
  createReviewGraph,
  getReviewGraphStatus,
} from "../src/core/review-graph.js";
import { SettingsService, type IntegrationSettings } from "../src/core/settings.js";
import type {
  AttemptRecord,
  IntegrationOperationView,
  MainDeliveryCheckpoint,
  TaskRecord,
  VerificationResult,
} from "../src/core/types.js";
import { StateStore } from "../src/state/store.js";
import { prepareWorkspace } from "../src/workspace/copy.js";
import { createPathPolicy } from "../src/workspace/path-policy.js";
import { writeWorkspacePatchReport } from "../src/workspace/patch.js";

const INTEGRATION_DEFAULTS: IntegrationSettings = {
  reviewedPatchMaxFiles: 5,
  reviewedPatchMaxLines: 400,
  reviewReceiptTtlMs: 900_000,
  verificationTimeoutMs: 30_000,
  backupRetentionCount: 3,
  autoRollback: true,
};

interface Fixture {
  store: StateStore;
  settings: SettingsService;
  task: TaskRecord;
  revisionId: string;
  digest: string;
  home: string;
  profileId: string;
  secondProfileId: string;
}

async function buildSucceededCandidate(
  requiredJudges: 0 | 1 | 2 = 2,
): Promise<Fixture> {
  const home = await mkdtemp(path.join(tmpdir(), "fl-main-delivery-"));
  const sourceDir = path.join(home, "source");
  await mkdir(path.join(sourceDir, "src"), { recursive: true });
  await writeFile(path.join(sourceDir, "readme.md"), "# hello\n\nOriginal.\n");
  await writeFile(path.join(sourceDir, "src/app.ts"), "export const n = 1;\n");

  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const snap = settings.get();
  const profileId = snap.workerProfiles.defaultProfileId;
  const second = snap.workerProfiles.profiles.find((profile) => profile.id !== profileId);
  assert.ok(second, "default settings must expose a second Worker Profile");

  const taskId = `candidate-${randomUUID()}`;
  const paths = taskPaths(home, taskId);
  const spec: TaskRecord["spec"] = {
    version: 1,
    name: "Delivery fixture",
    project: sourceDir,
    goal: "Ship a small change",
    constraints: [],
    provider: {
      name: "deepseek",
      model: "deepseek-v4-flash",
      keychainService: "forklight.deepseek.api-key",
    },
    runtime: {
      name: "claude-code",
      executable: "claude",
      effort: "low",
      maxBudgetUsd: 0.1,
    },
    workspace: { exclude: [".git", "node_modules"] },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src", "readme.md"] },
    acceptance: { commands: ["true"] },
    reviewRequirement: {
      requiredJudges,
      reason: requiredJudges === 0
        ? "Explicit skip for a mechanical fixture"
        : "Two independent views of this Candidate",
    },
  };
  await prepareWorkspace(spec, paths);
  await mkdir(path.join(paths.workspace, "src"), { recursive: true });
  await writeFile(path.join(paths.workspace, "readme.md"), "# hello\n\nChanged.\n");
  await writeFile(path.join(paths.workspace, "src/app.ts"), "export const n = 2;\n");
  await writeWorkspacePatchReport(paths, createPathPolicy(spec));

  const now = new Date().toISOString();
  const task: TaskRecord = {
    id: taskId,
    name: spec.name,
    status: "succeeded",
    sourcePath: sourceDir,
    taskFile: "forklight://test/main-delivery",
    spec,
    paths,
    sessionId: "session-1",
    currentAttemptId: "attempt-1",
    createdAt: now,
    updatedAt: now,
  };
  store.createTask(task);
  const attempt: AttemptRecord = {
    id: "attempt-1",
    taskId,
    ordinal: 1,
    status: "succeeded",
    sessionId: task.sessionId,
    rawLogPath: path.join(paths.logs, "attempt-1.jsonl"),
    startedAt: now,
    finishedAt: now,
    exitCode: 0,
  };
  store.createAttempt(attempt);
  const verification: VerificationResult = {
    passed: true,
    behaviorPassed: true,
    policyPassed: true,
    sourceCompatible: true,
    commands: [{
      command: "true",
      exitCode: 0,
      stdout: "SECRET-STDOUT-MUST-NOT-LEAK",
      stderr: "",
      durationMs: 1,
      timedOut: false,
    }],
    diffPath: paths.diff,
    sourceUnchanged: true,
  };
  const verEvent = store.addEvent(
    taskId,
    attempt.id,
    "verification.completed",
    "Independent verification passed",
    verification,
  );
  const revision = await captureCandidateRevision(
    store,
    store.getTask(taskId),
    attempt,
    verEvent.sequence,
    true,
    ["readme.md", "src/app.ts"],
    2,
    4,
  );
  return {
    store,
    settings,
    task: store.getTask(taskId),
    revisionId: revision.id,
    digest: revision.patchDigest,
    home,
    profileId,
    secondProfileId: second.id,
  };
}

function validResultJson(revisionId: string, disposition: "accept" | "revise" = "accept"): string {
  return JSON.stringify({
    schemaVersion: 1,
    reviewedRevisionId: revisionId,
    proposedDisposition: disposition,
    summary: "Scoped change looks ready for Main",
    findings: [
      {
        severity: "info",
        evidencePath: "src/app.ts",
        affectedBehavior: "Counter increments differently",
        recommendation: "Confirm callers tolerate the new value",
      },
    ],
  });
}

async function finishReviewerWithResult(
  store: StateStore,
  reviewerTaskId: string,
  resultText: string,
  taskStatus: "succeeded" | "failed" = "succeeded",
): Promise<void> {
  const now = new Date().toISOString();
  const task = store.getTask(reviewerTaskId);
  const attemptId = `reviewer-attempt-${reviewerTaskId}`;
  store.createAttempt({
    id: attemptId,
    taskId: reviewerTaskId,
    ordinal: 1,
    status: taskStatus === "succeeded" ? "succeeded" : "failed",
    sessionId: task.sessionId,
    rawLogPath: path.join(task.paths.logs, "attempt-1.jsonl"),
    startedAt: now,
    finishedAt: now,
    exitCode: taskStatus === "succeeded" ? 0 : 1,
    resultText,
  });
  store.setTaskStatus(reviewerTaskId, taskStatus, {
    finishedAt: now,
    currentAttemptId: attemptId,
  });
}

function makeHost(
  fx: Fixture,
  options: {
    now?: { value: number };
    onSleep?: () => Promise<void>;
    holdApply?: boolean;
  } = {},
): MainDeliveryHost {
  const clock = options.now ?? { value: 0 };
  const pending = new Map<string, {
    taskId: string;
    receiptId: string;
    run: () => Promise<unknown>;
    started?: Promise<unknown>;
  }>();
  return {
    store: fx.store,
    submitFile: async () => {
      throw new Error("submitFile should not run for existing-task tests");
    },
    createReviewGraph: async (input) => createReviewGraph(fx.store, fx.settings.get(), {
      candidateTaskId: input.taskId,
      reviewerWorkerProfileIds: input.reviewerWorkerProfileIds,
      reason: input.reason,
      confirm: true,
    }),
    recordMainReview: (taskId, decision, reason, confirm) =>
      recordMainReview(fx.store, taskId, { decision, reason, confirm }),
    preflightIntegration: (taskId) =>
      preflightIntegration(fx.store, taskId, INTEGRATION_DEFAULTS),
    startIntegration: (taskId, receiptId) => {
      const operationId = randomUUID();
      fx.store.addEvent(
        taskId,
        undefined,
        "integration.operation.started",
        "Integration operation started",
        { operationId, taskId, receiptId },
      );
      const run = () => applyIntegration(
        fx.store,
        taskId,
        receiptId,
        INTEGRATION_DEFAULTS,
        operationId,
      );
      pending.set(operationId, options.holdApply === true
        ? { taskId, receiptId, run }
        : { taskId, receiptId, run, started: run() });
      return {
        operationId,
        taskId,
        receiptId,
        status: "running",
        stages: [],
      };
    },
    waitIntegration: async (operationId) => {
      const item = pending.get(operationId);
      if (item !== undefined) {
        if (options.holdApply === true && item.started === undefined) {
          return {
            operationId,
            taskId: item.taskId,
            receiptId: item.receiptId,
            status: "running",
            stages: [],
          };
        }
        if (item.started === undefined) item.started = item.run();
        await item.started;
      }
      const result = fx.store.getIntegrationResult(operationId);
      if (result === undefined) {
        return {
          operationId,
          taskId: fx.task.id,
          receiptId: "",
          status: "running",
          stages: [],
        };
      }
      const view: IntegrationOperationView = {
        operationId,
        taskId: result.taskId,
        receiptId: result.receiptId,
        status: result.status === "applied" ? "completed" : "failed",
        stages: result.stages ?? [],
        result,
      };
      return view;
    },
    findIntegration: (taskId) => {
      const results = fx.store.listIntegrationResults(taskId);
      const first = results[0];
      if (first !== undefined) {
        return { operationId: first.id, receiptId: first.receiptId };
      }
      for (const event of fx.store.listEvents(taskId)) {
        if (event.type !== "integration.operation.started") continue;
        const payload = event.payload as { operationId?: unknown; receiptId?: unknown };
        if (typeof payload.operationId === "string" && typeof payload.receiptId === "string") {
          return { operationId: payload.operationId, receiptId: payload.receiptId };
        }
      }
      return undefined;
    },
    findLatestReceipt: (taskId) => {
      let latestId: string | undefined;
      for (const event of fx.store.listEvents(taskId)) {
        if (event.type !== "integration.preflight.completed") continue;
        const receiptId = (event.payload as { receiptId?: unknown })?.receiptId;
        if (typeof receiptId === "string") latestId = receiptId;
      }
      return latestId === undefined ? undefined : fx.store.getIntegrationReceipt(latestId);
    },
    sleep: async (milliseconds) => {
      clock.value += milliseconds;
      if (options.onSleep !== undefined) await options.onSleep();
    },
    now: () => clock.value,
    pollMs: 5,
    readDiff: async (task) => {
      const { readFile } = await import("node:fs/promises");
      try {
        return await readFile(task.paths.diff, "utf8");
      } catch {
        return undefined;
      }
    },
  };
}

function profiles(fx: Fixture): string[] {
  return [fx.profileId, fx.secondProfileId];
}

async function finishAllReviewers(fx: Fixture): Promise<void> {
  const graph = getReviewGraphStatus(fx.store, fx.task.id);
  assert.ok(graph);
  for (const assignment of graph.assignments) {
    await finishReviewerWithResult(
      fx.store,
      assignment.reviewerTaskId,
      validResultJson(fx.revisionId),
    );
  }
}

function assertNoPrivacyLeak(checkpoint: MainDeliveryCheckpoint): void {
  const text = JSON.stringify(checkpoint);
  assert.equal(text.includes("SECRET-STDOUT-MUST-NOT-LEAK"), false);
  assert.equal("events" in checkpoint, false);
  assert.equal("decision" in checkpoint, false);
  assert.equal("commands" in checkpoint.verification, false);
  assert.match(JSON.stringify(checkpoint.verification), /"present":true/);
}

function reviewSequence(store: StateStore, taskId: string): number | undefined {
  let sequence: number | undefined;
  for (const event of store.listEvents(taskId)) {
    if (event.type === "main-review.completed") sequence = event.sequence;
  }
  return sequence;
}

function receiptSequence(
  store: StateStore,
  taskId: string,
  receiptId: string,
): number | undefined {
  for (const event of store.listEvents(taskId)) {
    if (event.type !== "integration.preflight.completed") continue;
    const id = (event.payload as { receiptId?: unknown } | undefined)?.receiptId;
    if (id === receiptId) return event.sequence;
  }
  return undefined;
}

test("happy-path prepare then exact decide accept: one Task, graph, accept, receipt, Integration", async () => {
  const fx = await buildSucceededCandidate(2);
  try {
    const host = makeHost(fx, {
      onSleep: async () => {
        const graph = getReviewGraphStatus(fx.store, fx.task.id);
        if (graph === undefined) return;
        if (graph.assignments.some((assignment) => assignment.status === "queued")) {
          await finishAllReviewers(fx);
        }
      },
    });
    const prepared = await prepareMainDelivery(host, {
      taskId: fx.task.id,
      reviewerProfileIds: profiles(fx),
      reason: "Need two independent views",
      timeoutMs: 100,
      confirm: true,
    });
    assert.equal(prepared.kind, "main-delivery-checkpoint");
    assert.equal(prepared.call, "prepare");
    assert.equal(prepared.observation.outcome, "ready");
    assert.equal(prepared.task.id, fx.task.id);
    assert.equal(prepared.candidate?.revisionId, fx.revisionId);
    assert.equal(prepared.candidate?.digest, fx.digest);
    assert.equal(prepared.review.requiredJudges, 2);
    assert.equal(prepared.review.judges.length, 2);
    assert.ok(prepared.review.judges.every((judge) => judge.resultUsable));
    assert.ok(prepared.review.judges.every((judge) => judge.summary !== undefined));
    assert.equal(prepared.mainDecision, undefined);
    assert.equal(prepared.preflight, undefined);
    assert.equal(prepared.integration, undefined);
    assert.equal(prepared.nextActionCode, "record-main-review");
    assert.equal(countMainReviews(fx.store, fx.task.id), 0);
    assert.equal(countPreflightReceipts(fx.store, fx.task.id), 0);
    assert.equal(countIntegrationOperations(fx.store, fx.task.id), 0);
    assert.equal(prepared.diff, undefined);
    assertNoPrivacyLeak(prepared);
    const human = formatMainDeliveryCheckpointHuman(prepared);
    assert.match(human, /judge 1:/);
    assert.match(human, /judge 2:/);
    assert.match(human, /next: record-main-review/);

    const graphId = prepared.review.graphId;
    assert.ok(graphId);

    const decided = await decideMainDelivery(host, {
      taskId: fx.task.id,
      decision: "accept",
      revisionId: fx.revisionId,
      digest: fx.digest,
      reason: "Exact Candidate is acceptable",
      timeoutMs: 5_000,
      confirm: true,
    });
    assert.equal(decided.call, "decide");
    assert.equal(decided.observation.outcome, "ready");
    assert.equal(decided.mainDecision?.decision, "accept");
    assert.equal(decided.preflight?.passed, true);
    assert.ok(decided.integration?.operationId);
    assert.equal(decided.integration?.resultStatus, "applied");
    assert.equal(countMainReviews(fx.store, fx.task.id), 1);
    assert.equal(countPreflightReceipts(fx.store, fx.task.id), 1);
    assert.equal(countIntegrationOperations(fx.store, fx.task.id), 1);
    assert.equal(getReviewGraphStatus(fx.store, fx.task.id)?.id, graphId);
    assertNoPrivacyLeak(decided);
  } finally {
    fx.store.close();
  }
});

test("decide revise and reject persist the decision and never integrate", async () => {
  const fx = await buildSucceededCandidate(0);
  try {
    const host = makeHost(fx);
    const prepared = await prepareMainDelivery(host, {
      taskId: fx.task.id,
      reviewerProfileIds: [],
      reason: "Explicit skip",
      timeoutMs: 50,
      confirm: true,
    });
    assert.equal(prepared.observation.outcome, "ready");
    assert.equal(prepared.review.judges.length, 0);
    assert.equal(countMainReviews(fx.store, fx.task.id), 0);

    const revised = await decideMainDelivery(host, {
      taskId: fx.task.id,
      decision: "revise",
      revisionId: fx.revisionId,
      digest: fx.digest,
      reason: "Need a narrower change",
      timeoutMs: 50,
      confirm: true,
    });
    assert.equal(revised.mainDecision?.decision, "revise");
    assert.equal(revised.preflight, undefined);
    assert.equal(revised.integration, undefined);
    assert.equal(countMainReviews(fx.store, fx.task.id), 1);
    assert.equal(countPreflightReceipts(fx.store, fx.task.id), 0);
    assert.equal(countIntegrationOperations(fx.store, fx.task.id), 0);

    const rejectedFx = await buildSucceededCandidate(0);
    try {
      const rejectHost = makeHost(rejectedFx);
      await prepareMainDelivery(rejectHost, {
        taskId: rejectedFx.task.id,
        reviewerProfileIds: [],
        reason: "Explicit skip",
        timeoutMs: 50,
        confirm: true,
      });
      const rejected = await decideMainDelivery(rejectHost, {
        taskId: rejectedFx.task.id,
        decision: "reject",
        revisionId: rejectedFx.revisionId,
        digest: rejectedFx.digest,
        reason: "Out of contract",
        timeoutMs: 50,
        confirm: true,
      });
      assert.equal(rejected.mainDecision?.decision, "reject");
      assert.equal(countIntegrationOperations(rejectedFx.store, rejectedFx.task.id), 0);
    } finally {
      rejectedFx.store.close();
    }
  } finally {
    fx.store.close();
  }
});

test("observation timeout does not fail durable work; exact re-entry reuses the graph", async () => {
  const fx = await buildSucceededCandidate(2);
  try {
    const clock = { value: 0 };
    let finish = false;
    const host = makeHost(fx, {
      now: clock,
      onSleep: async () => {
        if (finish) await finishAllReviewers(fx);
      },
    });
    const timedOut = await prepareMainDelivery(host, {
      taskId: fx.task.id,
      reviewerProfileIds: profiles(fx),
      reason: "Need two independent views",
      timeoutMs: 15,
      confirm: true,
    });
    assert.equal(timedOut.observation.outcome, "timeout");
    assert.equal(timedOut.nextActionCode, "resume-prepare");
    assert.notEqual(fx.store.getTask(fx.task.id).status, "failed");
    assert.equal(timedOut.task.status, "succeeded");
    const graphId = timedOut.review.graphId;
    assert.ok(graphId);
    assert.equal(countMainReviews(fx.store, fx.task.id), 0);

    finish = true;
    clock.value = 0;
    const resumed = await prepareMainDelivery(host, {
      taskId: fx.task.id,
      reviewerProfileIds: profiles(fx),
      reason: "Need two independent views",
      timeoutMs: 50,
      confirm: true,
    });
    assert.equal(resumed.observation.outcome, "ready");
    assert.equal(resumed.review.graphId, graphId);
    assert.equal(getReviewGraphStatus(fx.store, fx.task.id)?.id, graphId);
  } finally {
    fx.store.close();
  }
});

test("changed reviewer order or reason fails closed without a second graph", async () => {
  const fx = await buildSucceededCandidate(2);
  try {
    const host = makeHost(fx, {
      onSleep: async () => {
        const graph = getReviewGraphStatus(fx.store, fx.task.id);
        if (graph?.assignments.some((assignment) => assignment.status === "queued")) {
          await finishAllReviewers(fx);
        }
      },
    });
    const first = await prepareMainDelivery(host, {
      taskId: fx.task.id,
      reviewerProfileIds: profiles(fx),
      reason: "Need two independent views",
      timeoutMs: 100,
      confirm: true,
    });
    assert.equal(first.observation.outcome, "ready");
    const graphId = first.review.graphId;

    const reordered = await prepareMainDelivery(host, {
      taskId: fx.task.id,
      reviewerProfileIds: [fx.secondProfileId, fx.profileId],
      reason: "Need two independent views",
      timeoutMs: 50,
      confirm: true,
    });
    assert.equal(reordered.observation.outcome, "blocked");
    assert.ok(reordered.blockers.some((item) => item.code === "reviewer-set-mismatch"));
    assert.equal(getReviewGraphStatus(fx.store, fx.task.id)?.id, graphId);

    const reasonChanged = await prepareMainDelivery(host, {
      taskId: fx.task.id,
      reviewerProfileIds: profiles(fx),
      reason: "A different prepare reason",
      timeoutMs: 50,
      confirm: true,
    });
    assert.equal(reasonChanged.observation.outcome, "blocked");
    assert.ok(reasonChanged.blockers.some((item) => item.code === "reason-mismatch"));
    assert.equal(getReviewGraphStatus(fx.store, fx.task.id)?.id, graphId);
  } finally {
    fx.store.close();
  }
});

test("stale identity and unusable Judge fail closed with no Main accept", async () => {
  const fx = await buildSucceededCandidate(1);
  try {
    const host = makeHost(fx, {
      onSleep: async () => {
        const graph = getReviewGraphStatus(fx.store, fx.task.id);
        const assignment = graph?.assignments[0];
        if (assignment?.status === "queued") {
          await finishReviewerWithResult(
            fx.store,
            assignment.reviewerTaskId,
            "not-json",
          );
        }
      },
    });
    const prepared = await prepareMainDelivery(host, {
      taskId: fx.task.id,
      reviewerProfileIds: [fx.profileId],
      reason: "One judge",
      timeoutMs: 100,
      confirm: true,
    });
    assert.equal(prepared.observation.outcome, "blocked");
    assert.ok(prepared.blockers.some((item) => item.code === "unusable-judge"));
    assert.equal(countMainReviews(fx.store, fx.task.id), 0);

    const stale = await decideMainDelivery(host, {
      taskId: fx.task.id,
      decision: "accept",
      revisionId: fx.revisionId,
      digest: "a".repeat(64),
      reason: "Stale digest",
      timeoutMs: 50,
      confirm: true,
    });
    assert.equal(stale.observation.outcome, "blocked");
    assert.ok(stale.blockers.some((item) => item.code === "stale-identity"));
    assert.equal(countMainReviews(fx.store, fx.task.id), 0);
    assert.equal(countIntegrationOperations(fx.store, fx.task.id), 0);
  } finally {
    fx.store.close();
  }
});

test("changed decide decision or reason fails closed without a second mutation", async () => {
  const fx = await buildSucceededCandidate(0);
  try {
    const host = makeHost(fx);
    await prepareMainDelivery(host, {
      taskId: fx.task.id,
      reviewerProfileIds: [],
      reason: "Explicit skip",
      timeoutMs: 50,
      confirm: true,
    });
    const first = await decideMainDelivery(host, {
      taskId: fx.task.id,
      decision: "revise",
      revisionId: fx.revisionId,
      digest: fx.digest,
      reason: "Need a narrower change",
      timeoutMs: 50,
      confirm: true,
    });
    assert.equal(first.mainDecision?.decision, "revise");
    const second = await decideMainDelivery(host, {
      taskId: fx.task.id,
      decision: "reject",
      revisionId: fx.revisionId,
      digest: fx.digest,
      reason: "Need a narrower change",
      timeoutMs: 50,
      confirm: true,
    });
    assert.equal(second.observation.outcome, "blocked");
    assert.ok(second.blockers.some((item) => item.code === "decision-mismatch"));
    assert.equal(countMainReviews(fx.store, fx.task.id), 1);

    const reasonChanged = await decideMainDelivery(host, {
      taskId: fx.task.id,
      decision: "revise",
      revisionId: fx.revisionId,
      digest: fx.digest,
      reason: "A different decide reason",
      timeoutMs: 50,
      confirm: true,
    });
    assert.equal(reasonChanged.observation.outcome, "blocked");
    assert.ok(reasonChanged.blockers.some((item) => item.code === "reason-mismatch"));
    assert.equal(countMainReviews(fx.store, fx.task.id), 1);
  } finally {
    fx.store.close();
  }
});

test("optional diff obeys the explicit byte bound and is omitted by default", async () => {
  const fx = await buildSucceededCandidate(0);
  try {
    const host = makeHost(fx);
    const without = await prepareMainDelivery(host, {
      taskId: fx.task.id,
      reviewerProfileIds: [],
      reason: "Explicit skip",
      timeoutMs: 50,
      confirm: true,
    });
    assert.equal(without.diff, undefined);

    const bounded = await prepareMainDelivery(host, {
      taskId: fx.task.id,
      reviewerProfileIds: [],
      reason: "Explicit skip",
      timeoutMs: 50,
      confirm: true,
      includeDiffMaxBytes: 12,
    });
    assert.ok(bounded.diff?.included);
    assert.ok((bounded.diff?.utf8Bytes ?? 99) <= 12);
    assert.equal(bounded.diff?.truncated, true);
    assert.ok((bounded.diff?.text?.length ?? 99) <= 12);
  } finally {
    fx.store.close();
  }
});

test("wrong reviewer count is a typed blocker and does not create a graph", async () => {
  const fx = await buildSucceededCandidate(2);
  try {
    const host = makeHost(fx);
    const checkpoint = await prepareMainDelivery(host, {
      taskId: fx.task.id,
      reviewerProfileIds: [fx.profileId],
      reason: "Need two independent views",
      timeoutMs: 50,
      confirm: true,
    });
    assert.equal(checkpoint.observation.outcome, "blocked");
    assert.ok(checkpoint.blockers.some((item) => item.code === "judge-count-mismatch"));
    assert.equal(getReviewGraphStatus(fx.store, fx.task.id), undefined);
    assert.equal(countMainReviews(fx.store, fx.task.id), 0);
  } finally {
    fx.store.close();
  }
});

test("source-incompatible preflight is a typed blocker and starts no Integration", async () => {
  const fx = await buildSucceededCandidate(0);
  try {
    const host = makeHost(fx);
    await prepareMainDelivery(host, {
      taskId: fx.task.id,
      reviewerProfileIds: [],
      reason: "Explicit skip",
      timeoutMs: 50,
      confirm: true,
    });
    await writeFile(path.join(fx.task.sourcePath, "src/app.ts"), "export const n = 99;\n");
    const decided = await decideMainDelivery(host, {
      taskId: fx.task.id,
      decision: "accept",
      revisionId: fx.revisionId,
      digest: fx.digest,
      reason: "Exact Candidate is acceptable",
      timeoutMs: 5_000,
      confirm: true,
    });
    assert.equal(decided.observation.outcome, "blocked");
    assert.ok(decided.blockers.some((item) => item.code === "source-incompatible"));
    assert.equal(decided.preflight?.passed, false);
    assert.equal(decided.integration, undefined);
    assert.equal(countMainReviews(fx.store, fx.task.id), 1);
    assert.equal(countIntegrationOperations(fx.store, fx.task.id), 0);
  } finally {
    fx.store.close();
  }
});

test("exact decide accept re-entry reuses the one receipt and Integration operation", async () => {
  const fx = await buildSucceededCandidate(0);
  try {
    const host = makeHost(fx);
    await prepareMainDelivery(host, {
      taskId: fx.task.id,
      reviewerProfileIds: [],
      reason: "Explicit skip",
      timeoutMs: 50,
      confirm: true,
    });
    const first = await decideMainDelivery(host, {
      taskId: fx.task.id,
      decision: "accept",
      revisionId: fx.revisionId,
      digest: fx.digest,
      reason: "Exact Candidate is acceptable",
      timeoutMs: 5_000,
      confirm: true,
    });
    assert.equal(first.observation.outcome, "ready");
    const receiptId = first.preflight?.receiptId;
    const operationId = first.integration?.operationId;
    const second = await decideMainDelivery(host, {
      taskId: fx.task.id,
      decision: "accept",
      revisionId: fx.revisionId,
      digest: fx.digest,
      reason: "Exact Candidate is acceptable",
      timeoutMs: 5_000,
      confirm: true,
    });
    assert.equal(second.preflight?.receiptId, receiptId);
    assert.equal(second.integration?.operationId, operationId);
    assert.equal(countMainReviews(fx.store, fx.task.id), 1);
    assert.equal(countPreflightReceipts(fx.store, fx.task.id), 1);
    assert.equal(countIntegrationOperations(fx.store, fx.task.id), 1);
  } finally {
    fx.store.close();
  }
});

test("verification failure and running-Worker timeout stay observation-safe", async () => {
  const failedFx = await buildSucceededCandidate(0);
  try {
    failedFx.store.setTaskStatus(failedFx.task.id, "failed");
    const host = makeHost(failedFx);
    const blocked = await prepareMainDelivery(host, {
      taskId: failedFx.task.id,
      reviewerProfileIds: [],
      reason: "Explicit skip",
      timeoutMs: 50,
      confirm: true,
    });
    assert.equal(blocked.observation.outcome, "failed");
    assert.ok(blocked.blockers.some((item) => item.code === "verification-failed"));
    assert.equal(blocked.review.graphId, undefined);
    assert.equal(countMainReviews(failedFx.store, failedFx.task.id), 0);
    assert.equal(countIntegrationOperations(failedFx.store, failedFx.task.id), 0);
  } finally {
    failedFx.store.close();
  }

  const runningFx = await buildSucceededCandidate(0);
  try {
    runningFx.store.setTaskStatus(runningFx.task.id, "running");
    const host = makeHost(runningFx);
    const timedOut = await prepareMainDelivery(host, {
      taskId: runningFx.task.id,
      reviewerProfileIds: [],
      reason: "Explicit skip",
      timeoutMs: 12,
      confirm: true,
    });
    assert.equal(timedOut.observation.outcome, "timeout");
    assert.equal(timedOut.nextActionCode, "resume-prepare");
    assert.equal(runningFx.store.getTask(runningFx.task.id).status, "running");
    assert.equal(countMainReviews(runningFx.store, runningFx.task.id), 0);
    runningFx.store.setTaskStatus(runningFx.task.id, "succeeded");
    const resumed = await prepareMainDelivery(host, {
      taskId: runningFx.task.id,
      reviewerProfileIds: [],
      reason: "Explicit skip",
      timeoutMs: 50,
      confirm: true,
    });
    assert.equal(resumed.observation.outcome, "ready");
    assert.equal(resumed.task.id, runningFx.task.id);
    assert.equal(countMainReviews(runningFx.store, runningFx.task.id), 0);
    assert.equal(countIntegrationOperations(runningFx.store, runningFx.task.id), 0);
  } finally {
    runningFx.store.close();
  }
});

test("Integration observation timeout reuses the one operation on exact re-entry", async () => {
  const fx = await buildSucceededCandidate(0);
  try {
    const clock = { value: 0 };
    const opts = { now: clock, holdApply: true };
    const host = makeHost(fx, opts);
    await prepareMainDelivery(host, {
      taskId: fx.task.id,
      reviewerProfileIds: [],
      reason: "Explicit skip",
      timeoutMs: 50,
      confirm: true,
    });
    const timedOut = await decideMainDelivery(host, {
      taskId: fx.task.id,
      decision: "accept",
      revisionId: fx.revisionId,
      digest: fx.digest,
      reason: "Exact Candidate is acceptable",
      timeoutMs: 20,
      confirm: true,
    });
    assert.equal(timedOut.observation.outcome, "timeout");
    assert.equal(timedOut.nextActionCode, "resume-decide");
    assert.ok(timedOut.integration?.operationId);
    assert.notEqual(fx.store.getTask(fx.task.id).status, "failed");
    assert.equal(countMainReviews(fx.store, fx.task.id), 1);
    assert.equal(countIntegrationOperations(fx.store, fx.task.id), 1);
    assert.equal(fx.store.listIntegrationResults(fx.task.id).length, 0);

    opts.holdApply = false;
    const resumed = await decideMainDelivery(host, {
      taskId: fx.task.id,
      decision: "accept",
      revisionId: fx.revisionId,
      digest: fx.digest,
      reason: "Exact Candidate is acceptable",
      timeoutMs: 5_000,
      confirm: true,
    });
    assert.equal(resumed.observation.outcome, "ready");
    assert.equal(resumed.preflight?.receiptId, timedOut.preflight?.receiptId);
    assert.equal(resumed.integration?.operationId, timedOut.integration?.operationId);
    assert.equal(resumed.integration?.resultStatus, "applied");
    assert.equal(countMainReviews(fx.store, fx.task.id), 1);
    assert.equal(countPreflightReceipts(fx.store, fx.task.id), 1);
    assert.equal(countIntegrationOperations(fx.store, fx.task.id), 1);
    const timedOutResult = fx.store.getIntegrationResult(resumed.integration!.operationId);
    assert.ok(timedOutResult);
    assert.equal(timedOutResult.receiptId, resumed.preflight?.receiptId);
  } finally {
    fx.store.close();
  }
});

test("prepare with a Task file submits once; existing id is observation-only", async () => {
  const fx = await buildSucceededCandidate(2);
  try {
    let submits = 0;
    const host = makeHost(fx, {
      onSleep: async () => {
        const graph = getReviewGraphStatus(fx.store, fx.task.id);
        if (graph?.assignments.some((assignment) => assignment.status === "queued")) {
          await finishAllReviewers(fx);
        }
      },
    });
    host.submitFile = async () => {
      submits += 1;
      return fx.store.getTask(fx.task.id);
    };
    host.inspectTaskFile = async () => ({ requiredJudges: 2 });
    const fromFile = await prepareMainDelivery(host, {
      taskFile: "forklight://test/once.yaml",
      reviewerProfileIds: profiles(fx),
      reason: "Need two independent views",
      timeoutMs: 100,
      confirm: true,
    });
    assert.equal(fromFile.observation.outcome, "ready");
    assert.equal(submits, 1);
    assert.equal(countMainReviews(fx.store, fx.task.id), 0);
    assert.equal(countIntegrationOperations(fx.store, fx.task.id), 0);
    const fromId = await prepareMainDelivery(host, {
      taskId: fx.task.id,
      reviewerProfileIds: profiles(fx),
      reason: "Need two independent views",
      timeoutMs: 100,
      confirm: true,
    });
    assert.equal(fromId.observation.outcome, "ready");
    assert.equal(fromId.review.graphId, fromFile.review.graphId);
    assert.equal(submits, 1);
  } finally {
    fx.store.close();
  }
});

test("older rejected granular receipt does not poison the first decide accept", async () => {
  const fx = await buildSucceededCandidate(0);
  try {
    const host = makeHost(fx);
    await prepareMainDelivery(host, {
      taskId: fx.task.id,
      reviewerProfileIds: [],
      reason: "Explicit skip",
      timeoutMs: 50,
      confirm: true,
    });
    const older = await preflightIntegration(fx.store, fx.task.id, INTEGRATION_DEFAULTS);
    assert.ok(older.rejectionReasons.length > 0);
    assert.match(older.rejectionReasons.join("\n"), /acceptance is required/i);
    assert.equal(countMainReviews(fx.store, fx.task.id), 0);
    assert.equal(countPreflightReceipts(fx.store, fx.task.id), 1);

    const decided = await decideMainDelivery(host, {
      taskId: fx.task.id,
      decision: "accept",
      revisionId: fx.revisionId,
      digest: fx.digest,
      reason: "Exact Candidate is acceptable",
      timeoutMs: 5_000,
      confirm: true,
    });
    assert.equal(decided.observation.outcome, "ready");
    assert.equal(decided.preflight?.passed, true);
    assert.notEqual(decided.preflight?.receiptId, older.id);
    assert.ok(decided.integration?.operationId);
    assert.equal(decided.integration?.resultStatus, "applied");
    assert.equal(decided.blockers.some((item) => item.detail === older.rejectionReasons[0]), false);
    assert.equal(countMainReviews(fx.store, fx.task.id), 1);
    assert.equal(countPreflightReceipts(fx.store, fx.task.id), 2);
    assert.equal(countIntegrationOperations(fx.store, fx.task.id), 1);
    const reviewSeq = reviewSequence(fx.store, fx.task.id);
    const freshSeq = receiptSequence(fx.store, fx.task.id, decided.preflight!.receiptId);
    const olderSeq = receiptSequence(fx.store, fx.task.id, older.id);
    assert.ok(reviewSeq !== undefined);
    assert.ok(freshSeq !== undefined);
    assert.ok(olderSeq !== undefined);
    assert.ok(olderSeq < reviewSeq);
    assert.ok(freshSeq > reviewSeq);
    const result = fx.store.getIntegrationResult(decided.integration!.operationId);
    assert.ok(result);
    assert.equal(result.receiptId, decided.preflight?.receiptId);
  } finally {
    fx.store.close();
  }
});

test("older unconsumed receipt is ignored by the first decide accept", async () => {
  const fx = await buildSucceededCandidate(0);
  try {
    const host = makeHost(fx);
    await prepareMainDelivery(host, {
      taskId: fx.task.id,
      reviewerProfileIds: [],
      reason: "Explicit skip",
      timeoutMs: 50,
      confirm: true,
    });
    const older = await preflightIntegration(fx.store, fx.task.id, INTEGRATION_DEFAULTS);
    const storedOlder = fx.store.getIntegrationReceipt(older.id);
    assert.ok(storedOlder);
    assert.equal(storedOlder.consumed, false);
    assert.equal(countMainReviews(fx.store, fx.task.id), 0);

    const decided = await decideMainDelivery(host, {
      taskId: fx.task.id,
      decision: "accept",
      revisionId: fx.revisionId,
      digest: fx.digest,
      reason: "Exact Candidate is acceptable",
      timeoutMs: 5_000,
      confirm: true,
    });
    assert.notEqual(decided.preflight?.receiptId, older.id);
    assert.equal(decided.preflight?.passed, true);
    assert.equal(decided.observation.outcome, "ready");
    const reviewSeq = reviewSequence(fx.store, fx.task.id);
    const returnedSeq = receiptSequence(fx.store, fx.task.id, decided.preflight!.receiptId);
    assert.ok(reviewSeq !== undefined);
    assert.ok(returnedSeq !== undefined);
    assert.ok(returnedSeq > reviewSeq);
    assert.equal(fx.store.getIntegrationReceipt(older.id)?.consumed, false);
    assert.equal(countMainReviews(fx.store, fx.task.id), 1);
    assert.equal(countIntegrationOperations(fx.store, fx.task.id), 1);
  } finally {
    fx.store.close();
  }
});

test("exact re-entry keeps the first post-review receipt when a later receipt exists", async () => {
  const fx = await buildSucceededCandidate(0);
  try {
    const host = makeHost(fx);
    await prepareMainDelivery(host, {
      taskId: fx.task.id,
      reviewerProfileIds: [],
      reason: "Explicit skip",
      timeoutMs: 50,
      confirm: true,
    });
    const first = await decideMainDelivery(host, {
      taskId: fx.task.id,
      decision: "accept",
      revisionId: fx.revisionId,
      digest: fx.digest,
      reason: "Exact Candidate is acceptable",
      timeoutMs: 5_000,
      confirm: true,
    });
    assert.equal(first.observation.outcome, "ready");
    const boundReceiptId = first.preflight?.receiptId;
    const boundOperationId = first.integration?.operationId;
    assert.ok(boundReceiptId);
    assert.ok(boundOperationId);

    const later = await preflightIntegration(fx.store, fx.task.id, INTEGRATION_DEFAULTS);
    assert.notEqual(later.id, boundReceiptId);
    assert.equal(countPreflightReceipts(fx.store, fx.task.id), 2);

    const second = await decideMainDelivery(host, {
      taskId: fx.task.id,
      decision: "accept",
      revisionId: fx.revisionId,
      digest: fx.digest,
      reason: "Exact Candidate is acceptable",
      timeoutMs: 5_000,
      confirm: true,
    });
    assert.equal(second.preflight?.receiptId, boundReceiptId);
    assert.equal(second.integration?.operationId, boundOperationId);
    assert.notEqual(second.preflight?.receiptId, later.id);
    assert.equal(countMainReviews(fx.store, fx.task.id), 1);
    assert.equal(countPreflightReceipts(fx.store, fx.task.id), 2);
    assert.equal(countIntegrationOperations(fx.store, fx.task.id), 1);
    const result = fx.store.getIntegrationResult(boundOperationId);
    assert.ok(result);
    assert.equal(result.receiptId, boundReceiptId);
  } finally {
    fx.store.close();
  }
});

test("bound rejected receipt is reused as a blocker and does not retry preflight", async () => {
  const fx = await buildSucceededCandidate(0);
  try {
    const host = makeHost(fx);
    await prepareMainDelivery(host, {
      taskId: fx.task.id,
      reviewerProfileIds: [],
      reason: "Explicit skip",
      timeoutMs: 50,
      confirm: true,
    });
    await writeFile(path.join(fx.task.sourcePath, "src/app.ts"), "export const n = 99;\n");
    const first = await decideMainDelivery(host, {
      taskId: fx.task.id,
      decision: "accept",
      revisionId: fx.revisionId,
      digest: fx.digest,
      reason: "Exact Candidate is acceptable",
      timeoutMs: 5_000,
      confirm: true,
    });
    assert.equal(first.observation.outcome, "blocked");
    assert.ok(first.blockers.some((item) => item.code === "source-incompatible"));
    assert.equal(first.preflight?.passed, false);
    const boundReceiptId = first.preflight?.receiptId;
    assert.ok(boundReceiptId);
    assert.equal(countMainReviews(fx.store, fx.task.id), 1);
    assert.equal(countPreflightReceipts(fx.store, fx.task.id), 1);
    assert.equal(countIntegrationOperations(fx.store, fx.task.id), 0);

    const second = await decideMainDelivery(host, {
      taskId: fx.task.id,
      decision: "accept",
      revisionId: fx.revisionId,
      digest: fx.digest,
      reason: "Exact Candidate is acceptable",
      timeoutMs: 5_000,
      confirm: true,
    });
    assert.equal(second.observation.outcome, "blocked");
    assert.equal(second.preflight?.receiptId, boundReceiptId);
    assert.equal(second.preflight?.passed, false);
    assert.ok(second.blockers.some((item) => item.code === "source-incompatible"));
    assert.equal(second.integration, undefined);
    assert.equal(countMainReviews(fx.store, fx.task.id), 1);
    assert.equal(countPreflightReceipts(fx.store, fx.task.id), 1);
    assert.equal(countIntegrationOperations(fx.store, fx.task.id), 0);
    const reviewSeq = reviewSequence(fx.store, fx.task.id);
    assert.ok(reviewSeq !== undefined);
    const postReviewPreflights = fx.store.listEvents(fx.task.id).filter((event) => (
      event.type === "integration.preflight.completed" && event.sequence > reviewSeq
    ));
    assert.equal(postReviewPreflights.length, 1);
  } finally {
    fx.store.close();
  }
});

test("later passing receipt cannot replace the bound decide receipt on exact re-entry", async () => {
  const fx = await buildSucceededCandidate(0);
  try {
    const clock = { value: 0 };
    const opts = { now: clock, holdApply: true };
    const host = makeHost(fx, opts);
    await prepareMainDelivery(host, {
      taskId: fx.task.id,
      reviewerProfileIds: [],
      reason: "Explicit skip",
      timeoutMs: 50,
      confirm: true,
    });
    const first = await decideMainDelivery(host, {
      taskId: fx.task.id,
      decision: "accept",
      revisionId: fx.revisionId,
      digest: fx.digest,
      reason: "Exact Candidate is acceptable",
      timeoutMs: 20,
      confirm: true,
    });
    assert.equal(first.observation.outcome, "timeout");
    const boundReceiptId = first.preflight?.receiptId;
    const boundOperationId = first.integration?.operationId;
    assert.ok(boundReceiptId);
    assert.ok(boundOperationId);
    assert.equal(first.preflight?.passed, true);

    const later = await preflightIntegration(fx.store, fx.task.id, INTEGRATION_DEFAULTS);
    assert.notEqual(later.id, boundReceiptId);
    assert.equal(later.rejectionReasons.length, 0);

    opts.holdApply = false;
    clock.value = 0;
    const second = await decideMainDelivery(host, {
      taskId: fx.task.id,
      decision: "accept",
      revisionId: fx.revisionId,
      digest: fx.digest,
      reason: "Exact Candidate is acceptable",
      timeoutMs: 5_000,
      confirm: true,
    });
    assert.equal(second.preflight?.receiptId, boundReceiptId);
    assert.equal(second.integration?.operationId, boundOperationId);
    assert.notEqual(second.preflight?.receiptId, later.id);
    assert.equal(second.observation.outcome, "ready");
    assert.equal(countMainReviews(fx.store, fx.task.id), 1);
    assert.equal(countPreflightReceipts(fx.store, fx.task.id), 2);
    assert.equal(countIntegrationOperations(fx.store, fx.task.id), 1);
    const result = fx.store.getIntegrationResult(boundOperationId);
    assert.ok(result);
    assert.equal(result.receiptId, boundReceiptId);
  } finally {
    fx.store.close();
  }
});
