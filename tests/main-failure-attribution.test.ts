import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import {
  FAILURE_ATTRIBUTION_CONFLICT,
  projectMainFailureAttribution,
  recordMainFailureAttribution,
  resolveMainFailureAttribution,
} from "../src/core/main-failure-attribution.js";
import {
  classifyFinalDeliveryOutcome,
  computeStatistics,
  deriveRoutingEvidence,
  projectCompactProviderModelSummaries,
} from "../src/core/statistics.js";
import type { AttemptRecord, TaskRecord, VerificationResult } from "../src/core/types.js";
import { ForkLightDaemon } from "../src/daemon/server.js";
import { StateStore } from "../src/state/store.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface Fixture {
  store: StateStore;
  task: TaskRecord;
  attempt: AttemptRecord;
  verificationSequence: number;
  revision?: { id: string; digest: string };
  verification: VerificationResult;
}

async function fixture(options: { passed?: boolean; revision?: boolean } = {}): Promise<Fixture> {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-failure-attribution-"));
  const store = new StateStore(home);
  const now = new Date().toISOString();
  const task: TaskRecord = {
    id: "task-attribution",
    name: "Attribution fixture",
    status: options.passed ? "succeeded" : "failed",
    sourcePath: "/tmp/source",
    taskFile: "forklight://test/failure-attribution",
    spec: {
      version: 1,
      name: "Attribution fixture",
      project: "/tmp/source",
      goal: "Keep machine failure separate from responsibility",
      constraints: [],
      provider: { name: "deepseek", model: "v4", keychainService: "forklight.test" },
      runtime: { name: "claude-code", executable: "claude", effort: "high", maxBudgetUsd: null },
      workspace: { exclude: [] },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
      acceptance: { commands: ["false"] },
      taskClass: "m3-main-failure-attribution-test",
      taskFamily: "capability-statistics",
    },
    paths: {
      root: home,
      baseline: path.join(home, "baseline"),
      workspace: path.join(home, "workspace"),
      logs: path.join(home, "logs"),
      claudeConfig: path.join(home, "claude"),
      diff: path.join(home, "result.diff"),
    },
    sessionId: "session-attribution",
    currentAttemptId: "attempt-attribution",
    createdAt: now,
    updatedAt: now,
  };
  const attempt: AttemptRecord = {
    id: "attempt-attribution",
    taskId: task.id,
    ordinal: 1,
    status: options.passed ? "succeeded" : "failed",
    sessionId: task.sessionId,
    rawLogPath: path.join(home, "attempt.jsonl"),
    startedAt: now,
    finishedAt: now,
    exitCode: options.passed ? 0 : 1,
  };
  store.createTask(task);
  store.createAttempt(attempt);
  const verification: VerificationResult = {
    passed: options.passed ?? false,
    behaviorPassed: options.passed ?? false,
    policyPassed: true,
    sourceCompatible: true,
    commands: [{
      command: "false",
      exitCode: options.passed ? 0 : 1,
      stdout: "",
      stderr: "",
      durationMs: 1,
      timedOut: false,
    }],
    diffPath: task.paths.diff,
    sourceUnchanged: true,
  };
  const verificationEvent = store.addEvent(
    task.id, attempt.id, "verification.completed", "Independent verification completed", verification,
  );
  let revision: Fixture["revision"];
  if (options.revision) {
    revision = { id: "revision-attribution", digest: "a".repeat(64) };
    store.addEvent(task.id, attempt.id, "candidate.revision.captured", "Candidate captured", {
      id: revision.id,
      taskId: task.id,
      attemptId: attempt.id,
      attemptOrdinal: attempt.ordinal,
      verificationEventSequence: verificationEvent.sequence,
      patchDigest: revision.digest,
      affectedPaths: ["src/index.ts"],
      filesChanged: 1,
      changedLines: 2,
      verificationPassed: verification.passed,
      createdAt: now,
    });
  }
  return {
    store,
    task,
    attempt,
    verificationSequence: verificationEvent.sequence,
    verification,
    ...(revision === undefined ? {} : { revision }),
  };
}

test("records one exact failed-verification attribution without changing machine truth", async () => {
  const f = await fixture({ revision: true });
  try {
    const beforeTask = f.store.getTask(f.task.id);
    const beforeAttempt = f.store.getAttempt(f.attempt.id);
    const beforeVerification = f.store.listEvents(f.task.id)
      .find((event) => event.sequence === f.verificationSequence);
    const recorded = recordMainFailureAttribution(f.store, f.task.id, {
      attemptId: f.attempt.id,
      verificationEventSequence: f.verificationSequence,
      cause: "verification-infrastructure",
      note: " Local process startup failed outside the Candidate change. ",
      candidateRevisionId: f.revision!.id,
      candidatePatchDigest: f.revision!.digest,
      confirm: true,
    });
    assert.equal(recorded.existing, false);
    assert.equal(recorded.impact, "non-model");
    assert.equal(recorded.noteLength, 58);
    assert.deepEqual(f.store.getTask(f.task.id), beforeTask);
    assert.deepEqual(f.store.getAttempt(f.attempt.id), beforeAttempt);
    assert.deepEqual(
      f.store.listEvents(f.task.id).find((event) => event.sequence === f.verificationSequence),
      beforeVerification,
    );
    const resolved = resolveMainFailureAttribution(
      f.store.listEvents(f.task.id), f.attempt.id, f.verificationSequence,
    );
    assert.equal(resolved?.note, "Local process startup failed outside the Candidate change.");
    assert.equal(resolved?.candidateRevisionId, f.revision!.id);
    const projection = projectMainFailureAttribution(
      f.store.getTask(f.task.id), f.store.listAttempts(f.task.id), f.store.listEvents(f.task.id),
    );
    assert.equal(projection.reason, "already-recorded");
    assert.equal(projection.abilityAssessment, "excluded");
    assert.equal(projection.attribution?.note, resolved?.note);
  } finally {
    f.store.close();
  }
});

test("statistics use the exact attribution impact but keep machine failure visible and compact", async () => {
  const f = await fixture({ revision: true });
  try {
    recordMainFailureAttribution(f.store, f.task.id, {
      attemptId: f.attempt.id,
      verificationEventSequence: f.verificationSequence,
      cause: "verification-infrastructure",
      note: "The local verification process failed outside the Candidate.",
      candidateRevisionId: f.revision!.id,
      candidatePatchDigest: f.revision!.digest,
      confirm: true,
    });
    const history = [{
      task: f.store.getTask(f.task.id),
      attempts: f.store.listAttempts(f.task.id),
      events: f.store.listEvents(f.task.id),
      verification: f.verification,
    }];
    const full = computeStatistics(history)[0]!;
    assert.equal(full.failureDistribution.verification, 1, "machine category remains visible");
    assert.equal(full.failures[0]?.impact, "non-model");
    assert.equal(
      classifyFinalDeliveryOutcome(history[0]!),
      "not-accepted",
      "an attribution must not rewrite final-delivery truth",
    );
    assert.deepEqual(full.failureAttributionCounts, {
      modelQuality: 0,
      nonModel: 1,
      ambiguous: 0,
    });
    const compact = projectCompactProviderModelSummaries([full])[0]!;
    assert.equal("failures" in compact, false);
    assert.equal(JSON.stringify(compact).includes(f.task.id), false);
    assert.equal(JSON.stringify(compact).includes("local verification process"), false);
    assert.deepEqual(compact.failureAttributionCounts, full.failureAttributionCounts);

    const routing = deriveRoutingEvidence({
      taskClass: "m3-main-failure-attribution-test",
      history,
    }).get("deepseek\0v4")!;
    assert.equal(routing.ignoredNonModelTaskCount, 1);
    assert.equal(routing.modelQualityFailureCount, 0);
    assert.equal(routing.firstPassUnavailableCount, 1);
    assert.deepEqual(routing.failureAttributionCounts, full.failureAttributionCounts);
  } finally {
    f.store.close();
  }
});

test("identical replay is idempotent and a changed replay conflicts", async () => {
  const f = await fixture();
  try {
    const input = {
      attemptId: f.attempt.id,
      verificationEventSequence: f.verificationSequence,
      cause: "candidate" as const,
      note: "Candidate behavior did not satisfy the independent check.",
      confirm: true as const,
    };
    const first = recordMainFailureAttribution(f.store, f.task.id, input);
    const count = f.store.listEvents(f.task.id).length;
    const replay = recordMainFailureAttribution(f.store, f.task.id, input);
    assert.equal(replay.existing, true);
    assert.equal(replay.eventSequence, first.eventSequence);
    assert.equal(f.store.listEvents(f.task.id).length, count);
    assert.throws(
      () => recordMainFailureAttribution(f.store, f.task.id, {
        ...input,
        cause: "insufficient-evidence",
      }),
      new RegExp(FAILURE_ATTRIBUTION_CONFLICT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    assert.equal(f.store.listEvents(f.task.id).length, count);
  } finally {
    f.store.close();
  }
});

test("rejects stale, passed, partial, and forged Candidate bindings before mutation", async () => {
  const withRevision = await fixture({ revision: true });
  try {
    const base = {
      attemptId: withRevision.attempt.id,
      verificationEventSequence: withRevision.verificationSequence,
      cause: "candidate" as const,
      note: "Candidate did not pass.",
      confirm: true as const,
    };
    const count = withRevision.store.listEvents(withRevision.task.id).length;
    assert.throws(
      () => recordMainFailureAttribution(withRevision.store, withRevision.task.id, base),
      /Candidate Revision binding/,
    );
    assert.throws(
      () => recordMainFailureAttribution(withRevision.store, withRevision.task.id, {
        ...base,
        candidateRevisionId: withRevision.revision!.id,
      }),
      /provided together/,
    );
    assert.throws(
      () => recordMainFailureAttribution(withRevision.store, withRevision.task.id, {
        ...base,
        candidateRevisionId: "wrong",
        candidatePatchDigest: withRevision.revision!.digest,
      }),
      /does not match/,
    );
    assert.equal(withRevision.store.listEvents(withRevision.task.id).length, count);
  } finally {
    withRevision.store.close();
  }

  const passed = await fixture({ passed: true });
  try {
    assert.throws(
      () => recordMainFailureAttribution(passed.store, passed.task.id, {
        attemptId: passed.attempt.id,
        verificationEventSequence: passed.verificationSequence,
        cause: "candidate",
        note: "Not allowed for a passing Task.",
        confirm: true,
      }),
      /failed Task/,
    );
  } finally {
    passed.store.close();
  }
});

test("malformed or duplicate imported attribution fails closed", async () => {
  const f = await fixture();
  try {
    const payload = {
      version: 1,
      attemptId: f.attempt.id,
      verificationEventSequence: f.verificationSequence,
      cause: "candidate",
      impact: "model-quality",
      note: "Candidate failed.",
    };
    f.store.addEvent(f.task.id, f.attempt.id, "main.failure-attribution.recorded", "Imported", payload);
    f.store.addEvent(f.task.id, f.attempt.id, "main.failure-attribution.recorded", "Duplicate", payload);
    assert.equal(
      resolveMainFailureAttribution(f.store.listEvents(f.task.id), f.attempt.id, f.verificationSequence),
      undefined,
    );
    const projection = projectMainFailureAttribution(
      f.store.getTask(f.task.id), f.store.listAttempts(f.task.id), f.store.listEvents(f.task.id),
    );
    assert.equal(projection.reason, "invalid-history");
    assert.equal(projection.eligible, false);
    assert.throws(
      () => recordMainFailureAttribution(f.store, f.task.id, {
        attemptId: f.attempt.id,
        verificationEventSequence: f.verificationSequence,
        cause: "candidate",
        note: "Candidate failed.",
        confirm: true,
      }),
      /immutable attribution/,
    );
  } finally {
    f.store.close();
  }
});

test("successful Tasks do not project a failed machine outcome", async () => {
  const f = await fixture({ passed: true });
  try {
    const projection = projectMainFailureAttribution(
      f.store.getTask(f.task.id), f.store.listAttempts(f.task.id), f.store.listEvents(f.task.id),
    );
    assert.equal(projection.machineOutcome, "not-failed");
    assert.equal(projection.reason, "task-not-failed");
    assert.equal(projection.eligible, false);
  } finally {
    f.store.close();
  }
});

test("CLI records through the Daemon and keeps the private note out of its receipt", async () => {
  const f = await fixture();
  const home = f.task.paths.root;
  const exactDaemon = new ForkLightDaemon(home, 0);
  await exactDaemon.start();
  try {
    const result = await execFileAsync(process.execPath, [
      "--disable-warning=ExperimentalWarning",
      "--import", "tsx",
      path.join(root, "src", "cli.ts"),
      "failure-attribution", f.task.id,
      "--attempt", f.attempt.id,
      "--verification-sequence", String(f.verificationSequence),
      "--cause", "verification-infrastructure",
      "--note", "private-cli-note-marker",
      "--confirm",
      "--json",
    ], {
      cwd: root,
      env: { ...process.env, FORKLIGHT_HOME: home },
      timeout: 15_000,
    });
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.includes("private-cli-note-marker"), false);
    const receipt = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(receipt.impact, "non-model");
    assert.equal(receipt.noteLength, "private-cli-note-marker".length);
    assert.equal(f.store.getTask(f.task.id).status, "failed");
  } finally {
    await exactDaemon.close();
    f.store.close();
  }
});
