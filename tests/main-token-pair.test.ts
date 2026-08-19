import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildTaskRecord } from "../src/core/runner.js";
import { parseTaskSpec } from "../src/core/task.js";
import {
  ASSESS_REQUIRES_CONFIRM,
  INVALID_MAIN_PAIR_ASSESSMENT,
  assessMainPair,
  computeMainPairArithmetic,
  readMainPairReport,
  type MainPairStore,
} from "../src/core/main-token-pair.js";
import { captureMainUsage, captureMainUsageEpisode, readMainUsageStatus } from "../src/core/main-token-usage.js";
import { StateStore } from "../src/state/store.js";

const TS = "2026-08-17T12:00:00.000Z";
const ASSESSED_AT = "2026-08-17T12:30:00.000Z";
const TASK_CLASS = "edit-task";
const TASK_FAMILY = "forklight-storage-lifecycle";
const PROFILE = "codex-main-v1";
const DIGEST = "a".repeat(64);

function createReadyTask(store: StateStore, id: string): void {
  const home = store.databasePath.replace(/\/forklight\.sqlite$/, "");
  const spec = parseTaskSpec({
    version: 1, name: id, project: "/tmp/source", goal: "Main pair test",
    taskClass: TASK_CLASS, taskFamily: TASK_FAMILY, directCodexProfileId: PROFILE,
    acceptance: { commands: ["true"] },
  }, "/tmp");
  store.createTask(buildTaskRecord({
    spec, taskFile: `/tmp/${id}.yaml`, home, id, sessionId: `session-${id}`, createdAt: TS,
  }));
}

function usageSample(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const inputTokens = typeof overrides.inputTokens === "number" ? overrides.inputTokens : 3000;
  const outputTokens = typeof overrides.outputTokens === "number" ? overrides.outputTokens : 500;
  const cacheReadInputTokens = typeof overrides.cacheReadInputTokens === "number"
    ? overrides.cacheReadInputTokens : 1000;
  const cacheCreationInputTokens = typeof overrides.cacheCreationInputTokens === "number"
    ? overrides.cacheCreationInputTokens : 0;
  return {
    sampleId: "mus-direct",
    forklightTaskId: "task-pair",
    comparisonId: "cmp-pair-1",
    role: "direct-main",
    taskClass: TASK_CLASS,
    taskFamily: TASK_FAMILY,
    directCodexProfileId: PROFILE,
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    grossTokens: inputTokens + outputTokens + cacheReadInputTokens + cacheCreationInputTokens,
    source: "codex-terminal-result",
    runRef: "codex-run:pair-direct",
    capturedAt: TS,
    schemaVersion: 1,
    ...overrides,
  };
}

function seedSamples(
  store: StateStore,
  taskId: string,
  comparisonId: string,
  directGross: { input: number; output: number },
  delegatedGross: { input: number; output: number },
  prefix: string,
): void {
  store.saveMainUsageSample(usageSample({
    sampleId: `${prefix}d`, forklightTaskId: taskId, comparisonId, role: "direct-main",
    inputTokens: directGross.input, outputTokens: directGross.output,
    cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
    grossTokens: directGross.input + directGross.output,
    runRef: `codex-run:${prefix}d`,
  }));
  store.saveMainUsageSample(usageSample({
    sampleId: `${prefix}g`, forklightTaskId: taskId, comparisonId, role: "delegated-main",
    inputTokens: delegatedGross.input, outputTokens: delegatedGross.output,
    cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
    grossTokens: delegatedGross.input + delegatedGross.output,
    runRef: `codex-run:${prefix}g`,
  }));
}

function seedCurrentDelivery(
  store: StateStore,
  taskId: string,
  operationId: string,
  digest = DIGEST,
  createdAt = TS,
): { verificationSequence: number } {
  const attemptId = `att-${taskId}`.slice(0, 64);
  const verification = store.addEvent(taskId, attemptId, "verification.completed", "passed", {
    passed: true,
  });
  store.addEvent(taskId, attemptId, "main-review.completed", "Main agent review: accept", {
    decision: "accept",
    reason: "accepted",
    attemptId,
    verificationEventSequence: verification.sequence,
    candidateRevisionId: `rev-${taskId}`.slice(0, 64),
    acceptedPatchDigest: digest,
  });
  store.saveIntegrationReceipt({
    id: `rcpt-${operationId}`.slice(0, 64),
    taskId,
    patchDigest: digest,
    affectedFiles: ["src/cli.ts"],
    rejectionReasons: [],
    sourceEvidence: {},
    createdAt,
    expiresAt: "2099-01-01T00:00:00.000Z",
    consumed: true,
  });
  store.saveIntegrationResult({
    id: operationId,
    receiptId: `rcpt-${operationId}`.slice(0, 64),
    taskId,
    status: "applied",
    appliedAt: createdAt,
    createdAt,
    stages: [
      { stage: "source-applied", status: "passed" },
      { stage: "source-verified", status: "passed" },
      { stage: "artifact-built", status: "passed" },
      { stage: "runtime-activated", status: "passed" },
    ],
  });
  return { verificationSequence: verification.sequence };
}

function assessInput(taskId: string, comparisonId: string, operationId: string, extra: Record<string, unknown> = {}) {
  return {
    taskId,
    comparisonId,
    confirm: true,
    sameScope: true,
    sameAcceptance: true,
    delegatedQualityNotLower: true,
    directVerificationRef: { referenceId: "dvref1" },
    delegatedIntegrationOperationId: operationId,
    reviewer: "main-codex",
    assessedAt: ASSESSED_AT,
    schemaVersion: 1,
    ...extra,
  };
}

function snapshot(store: StateStore, taskId: string) {
  return {
    assessments: store.countMainPairAssessments(),
    samples: store.countMainUsageSamples(),
    events: store.listEvents(taskId).length,
    integrations: store.listIntegrationResults(taskId).length,
    tasks: store.listTasks().length,
  };
}

test("accepted pair persists once and report exposes signed change from stored totals", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4b-ok-"));
  const store = new StateStore(home);
  createReadyTask(store, "task-pair");
  seedSamples(store, "task-pair", "cmp-pair-1", { input: 4000, output: 500 }, { input: 1200, output: 300 }, "ok");
  seedCurrentDelivery(store, "task-pair", "intop1");
  const before = snapshot(store, "task-pair");
  try {
    const first = assessMainPair(store, assessInput("task-pair", "cmp-pair-1", "intop1"), () => "mpa-ok1");
    assert.equal(first.outcome, "accepted");
    assert.deepEqual(first.reasons, []);
    assert.equal(first.assessment?.decision, "accepted");
    assert.equal(first.assessment?.sameScope, true);
    assert.equal(first.assessment?.sameAcceptance, true);
    assert.equal(first.assessment?.delegatedQualityNotLower, true);
    assert.deepEqual(first.assessment?.directVerificationRef, { referenceId: "dvref1" });
    assert.equal(first.assessment?.delegatedIntegrationOperationId, "intop1");
    assert.ok(Object.isFrozen(first));
    assert.ok(Object.isFrozen(first.assessment));

    const second = assessMainPair(store, assessInput("task-pair", "cmp-pair-1", "intop1"), () => "mpa-ok2");
    assert.equal(second.outcome, "rejected");
    assert.deepEqual(second.reasons, ["duplicate-evidence"]);
    assert.equal(second.assessment?.assessmentId, "mpa-ok1");
    assert.equal(store.countMainPairAssessments(), before.assessments + 1);
    assert.equal(store.getMainPairAssessment("mpa-ok1").assessmentId, "mpa-ok1");

    const report1 = readMainPairReport(store, "task-pair", "cmp-pair-1");
    const report2 = readMainPairReport(store, "task-pair", "cmp-pair-1");
    assert.deepEqual(report1, report2);
    const samples = store.listMainUsageSamples("task-pair", "cmp-pair-1");
    const direct = samples.find((sample) => sample.role === "direct-main")!;
    const delegated = samples.find((sample) => sample.role === "delegated-main")!;
    const expected = computeMainPairArithmetic(direct.grossTokens, delegated.grossTokens, true);
    assert.equal(report1.validity, "accepted");
    assert.deepEqual(report1.reasons, []);
    assert.equal(report1.method, "codex-terminal-result");
    assert.equal(report1.directCodexProfileId, PROFILE);
    assert.equal(report1.directGrossTokens, direct.grossTokens);
    assert.equal(report1.delegatedGrossTokens, delegated.grossTokens);
    assert.equal(report1.signedChange, expected.signedChange);
    assert.equal(report1.signedChange, direct.grossTokens - delegated.grossTokens);
    assert.deepEqual(report1.percentageChange, expected.percentageChange);
    assert.deepEqual(report1.saving, expected.saving);
    assert.equal(report1.saving.status, "saving");
    assert.deepEqual(report1.evidence, {
      directVerificationRef: { referenceId: "dvref1" },
      delegatedIntegrationOperationId: "intop1",
    });
    for (const key of ["change", "savings", "directCodexSavings", "calibration", "workerTokens", "cost", "budget"]) {
      assert.equal(key in report1, false);
    }

    const status = readMainUsageStatus(store, "task-pair", "cmp-pair-1");
    assert.equal("change" in status, false);
    assert.equal("saving" in status, false);
    const after = snapshot(store, "task-pair");
    assert.equal(after.events, before.events);
    assert.equal(after.integrations, before.integrations);
    assert.equal(after.tasks, before.tasks);
    assert.equal(after.samples, before.samples);
  } finally {
    store.close();
  }
});

test("each failed gate or incomplete direct verification persists one closed rejection", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4b-gate-"));
  const store = new StateStore(home);
  createReadyTask(store, "task-pair");
  const cases: Array<{ cmp: string; extra: Record<string, unknown>; reason: string }> = [
    { cmp: "cmp-scope", extra: { sameScope: false }, reason: "scope-mismatch" },
    { cmp: "cmp-acc", extra: { sameAcceptance: false }, reason: "acceptance-mismatch" },
    { cmp: "cmp-qual", extra: { delegatedQualityNotLower: false }, reason: "delegated-quality-lower" },
    { cmp: "cmp-ref", extra: { directVerificationRef: { referenceId: "" } }, reason: "incomplete-evidence" },
  ];
  try {
    for (const item of cases) {
      seedSamples(store, "task-pair", item.cmp, { input: 2000, output: 200 }, { input: 800, output: 100 }, item.cmp);
      seedCurrentDelivery(store, "task-pair", `op${item.cmp}`.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64));
      const before = store.countMainPairAssessments();
      const result = assessMainPair(
        store,
        assessInput("task-pair", item.cmp, `op${item.cmp}`.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64), item.extra),
        () => `mpa${item.cmp}`.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64),
      );
      assert.equal(result.outcome, "rejected", item.reason);
      assert.deepEqual(result.reasons, [item.reason]);
      assert.equal(result.assessment?.rejectionReason, item.reason);
      assert.equal("sameScope" in (result.assessment ?? {}), false);
      assert.equal(store.countMainPairAssessments(), before + 1);
      const report = readMainPairReport(store, "task-pair", item.cmp);
      assert.equal(report.validity, "rejected");
      assert.deepEqual(report.reasons, [item.reason]);
      assert.equal(report.saving.status, "unavailable");
      assert.equal("calibration" in report, false);
    }
  } finally {
    store.close();
  }
});

test("stale or missing delegated delivery is cannot-determine and writes no accepted row", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4b-stale-"));
  const store = new StateStore(home);
  createReadyTask(store, "task-pair");
  try {
    seedSamples(store, "task-pair", "cmp-miss", { input: 2000, output: 100 }, { input: 900, output: 50 }, "ms");
    const missing = assessMainPair(store, assessInput("task-pair", "cmp-miss", "intmissing"));
    assert.equal(missing.outcome, "cannot-determine");
    assert.deepEqual(missing.reasons, ["cannot-determine"]);
    assert.equal(missing.assessment, undefined);
    assert.equal(store.getMainPairAssessmentByComparison("cmp-miss"), undefined);

    seedSamples(store, "task-pair", "cmp-stale", { input: 2000, output: 100 }, { input: 900, output: 50 }, "st");
    seedCurrentDelivery(store, "task-pair", "intold", DIGEST, "2026-08-17T12:00:00.000Z");
    store.saveIntegrationReceipt({
      id: "rcpt-intnew",
      taskId: "task-pair",
      patchDigest: DIGEST,
      affectedFiles: ["src/cli.ts"],
      rejectionReasons: [],
      sourceEvidence: {},
      createdAt: "2026-08-17T13:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      consumed: true,
    });
    store.saveIntegrationResult({
      id: "intnew",
      receiptId: "rcpt-intnew",
      taskId: "task-pair",
      status: "applied",
      appliedAt: "2026-08-17T13:00:00.000Z",
      createdAt: "2026-08-17T13:00:00.000Z",
      stages: [
        { stage: "source-applied", status: "passed" },
        { stage: "source-verified", status: "passed" },
        { stage: "artifact-built", status: "passed" },
        { stage: "runtime-activated", status: "passed" },
      ],
    });
    const before = store.countMainPairAssessments();
    const stale = assessMainPair(store, assessInput("task-pair", "cmp-stale", "intold"));
    assert.equal(stale.outcome, "cannot-determine");
    assert.equal(store.countMainPairAssessments(), before);
    const staleReport = readMainPairReport(store, "task-pair", "cmp-stale");
    assert.equal(staleReport.validity, "cannot-determine");
    assert.equal(staleReport.saving.status, "unavailable");

    seedSamples(store, "task-pair", "cmp-live", { input: 2500, output: 100 }, { input: 900, output: 50 }, "lv");
    const accepted = assessMainPair(
      store,
      assessInput("task-pair", "cmp-live", "intnew"),
      () => "mpalive",
    );
    assert.equal(accepted.outcome, "accepted");
    store.addEvent("task-pair", "att-later", "verification.completed", "passed-again", { passed: true });
    const later = readMainPairReport(store, "task-pair", "cmp-live");
    assert.equal(later.validity, "cannot-determine");
    assert.deepEqual(later.reasons, ["cannot-determine"]);
    assert.equal(later.saving.status, "unavailable");
    assert.equal(store.getMainPairAssessment("mpalive").decision, "accepted");
  } finally {
    store.close();
  }
});

test("zero baseline and negative change stay signed and invent no saving", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4b-arith-"));
  const store = new StateStore(home);
  createReadyTask(store, "task-pair");
  try {
    seedSamples(store, "task-pair", "cmp-zero", { input: 0, output: 0 }, { input: 80, output: 20 }, "zr");
    seedCurrentDelivery(store, "task-pair", "intzero");
    assert.equal(assessMainPair(store, assessInput("task-pair", "cmp-zero", "intzero"), () => "mpazero").outcome, "accepted");
    const zero = readMainPairReport(store, "task-pair", "cmp-zero");
    const zeroExpected = computeMainPairArithmetic(zero.directGrossTokens!, zero.delegatedGrossTokens!, true);
    assert.equal(zero.signedChange, 0 - zero.delegatedGrossTokens!);
    assert.equal(zero.signedChange, zeroExpected.signedChange);
    assert.deepEqual(zero.percentageChange, { available: false, reason: "zero-direct-baseline" });
    assert.equal(zero.saving.status, "higher");

    seedSamples(store, "task-pair", "cmp-neg", { input: 100, output: 0 }, { input: 150, output: 0 }, "ng");
    seedCurrentDelivery(store, "task-pair", "intneg", "b".repeat(64), "2026-08-17T14:00:00.000Z");
    assert.equal(assessMainPair(store, assessInput("task-pair", "cmp-neg", "intneg"), () => "mpaneg").outcome, "accepted");
    const negative = readMainPairReport(store, "task-pair", "cmp-neg");
    assert.equal(negative.signedChange, 100 - 150);
    assert.equal(negative.percentageChange.available, true);
    if (negative.percentageChange.available) {
      assert.equal(negative.percentageChange.value, (100 - 150) / 100 * 100);
    }
    assert.equal(negative.saving.status, "higher");

    seedSamples(store, "task-pair", "cmp-eq", { input: 90, output: 10 }, { input: 90, output: 10 }, "eq");
    seedCurrentDelivery(store, "task-pair", "inteq", "c".repeat(64), "2026-08-17T15:00:00.000Z");
    assert.equal(assessMainPair(store, assessInput("task-pair", "cmp-eq", "inteq"), () => "mpaeq").outcome, "accepted");
    const equal = readMainPairReport(store, "task-pair", "cmp-eq");
    assert.equal(equal.signedChange, 0);
    assert.equal(equal.saving.status, "not-lower");
  } finally {
    store.close();
  }
});

test("legacy review or publication evidence is not an M4 pair", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4b-leg-"));
  const store = new StateStore(home);
  createReadyTask(store, "task-pair");
  try {
    store.saveDirectCodexPairedSample({
      sampleId: "smp-leg1",
      forklightTaskId: "task-pair",
      exactTaskClass: TASK_CLASS,
      directCodexProfileId: PROFILE,
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      source: "codex-terminal-result",
      complete: true,
      directRunRef: "codex-run:legacy-1",
      pairingRef: "pair:legacy-1",
      capturedAt: TS,
      schemaVersion: 1,
    });
    store.saveDirectCodexSampleReview({
      sampleId: "smp-leg1",
      decision: "accepted",
      reviewer: "main-codex",
      reviewedAt: TS,
      schemaVersion: 1,
    });
    const report = readMainPairReport(store, "task-pair", "cmp-legacy");
    assert.equal(report.validity, "cannot-determine");
    assert.deepEqual(report.reasons, ["legacy-pair-contract-missing"]);
    assert.equal(report.saving.status, "unavailable");
    assert.equal("directGrossTokens" in report, false);
    const status = readMainUsageStatus(store, "task-pair", "cmp-legacy");
    assert.equal(status.countComplete, false);
    assert.equal("change" in status, false);
    assert.equal("saving" in status, false);
  } finally {
    store.close();
  }
});

test("publication-only legacy evidence is legacy-pair-contract-missing", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4b-leg-pub-"));
  const store = new StateStore(home);
  createReadyTask(store, "task-pair");
  try {
    store.saveDirectCodexProfilePublication({
      directCodexProfileId: PROFILE,
      calibration: {
        minTokens: 1000,
        maxTokens: 1500,
        method: "paired-sample-v1",
        taskClass: TASK_CLASS,
        confidence: "medium",
        version: 1,
        sampleSize: 1,
        evidenceReferences: ["sample:legacy-pub-v1"],
        createdAt: TS,
        schemaVersion: 1,
      },
      envelopeSchemaVersion: 1,
    });
    assert.equal(store.countMainUsageSamples(), 0);
    assert.equal(store.countMainPairAssessments(), 0);
    assert.equal(store.hasLegacyMainPairEvidence("task-pair"), true);

    const report = readMainPairReport(store, "task-pair", "cmp-legacy-pub");
    assert.equal(report.validity, "cannot-determine");
    assert.deepEqual(report.reasons, ["legacy-pair-contract-missing"]);
    assert.equal(report.saving.status, "unavailable");
    assert.equal("directGrossTokens" in report, false);
    assert.equal("signedChange" in report, false);
    assert.equal("calibration" in report, false);
    assert.equal(store.countMainUsageSamples(), 0);
    assert.equal(store.countMainPairAssessments(), 0);
  } finally {
    store.close();
  }
});

test("privacy, confirm, and missing roles fail closed without an accepted claim", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4b-priv-"));
  const store = new StateStore(home);
  createReadyTask(store, "task-pair");
  const secret = "sk-pair-SECRET-77";
  try {
    seedSamples(store, "task-pair", "cmp-priv", { input: 1000, output: 100 }, { input: 400, output: 50 }, "pv");
    seedCurrentDelivery(store, "task-pair", "intpriv");
    const before = store.countMainPairAssessments();
    assert.throws(
      () => assessMainPair(store, { ...assessInput("task-pair", "cmp-priv", "intpriv"), prompt: secret }),
      (error: unknown) => {
        assert.ok(error instanceof TypeError);
        assert.equal((error as Error).message, INVALID_MAIN_PAIR_ASSESSMENT);
        assert.ok(!String(error).includes(secret));
        return true;
      },
    );
    assert.throws(
      () => assessMainPair(store, { ...assessInput("task-pair", "cmp-priv", "intpriv"), confirm: false }),
      { name: "TypeError", message: ASSESS_REQUIRES_CONFIRM },
    );
    assert.equal(store.countMainPairAssessments(), before);

    store.saveMainUsageSample(usageSample({
      sampleId: "musonlyd", forklightTaskId: "task-pair", comparisonId: "cmp-only",
      role: "direct-main", runRef: "codex-run:only-d",
    }));
    const incomplete = assessMainPair(store, assessInput("task-pair", "cmp-only", "intpriv"));
    assert.equal(incomplete.outcome, "cannot-determine");
    assert.deepEqual(incomplete.reasons, ["incomplete-evidence"]);
    assert.equal(store.getMainPairAssessmentByComparison("cmp-only"), undefined);
  } finally {
    store.close();
  }
});

test("incompatible stored identity rejects without accepting", () => {
  const samples = [
    {
      sampleId: "mus-a", forklightTaskId: "task-pair", comparisonId: "cmp-x", role: "direct-main" as const,
      taskClass: TASK_CLASS, taskFamily: TASK_FAMILY, directCodexProfileId: PROFILE,
      inputTokens: 10, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
      grossTokens: 10, source: "codex-terminal-result" as const, runRef: "codex-run:a",
      capturedAt: TS, schemaVersion: 1 as const,
    },
    {
      sampleId: "mus-b", forklightTaskId: "task-pair", comparisonId: "cmp-x", role: "delegated-main" as const,
      taskClass: TASK_CLASS, taskFamily: TASK_FAMILY, directCodexProfileId: "other-profile",
      inputTokens: 4, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
      grossTokens: 4, source: "codex-terminal-result" as const, runRef: "codex-run:b",
      capturedAt: TS, schemaVersion: 1 as const,
    },
  ];
  const saved: unknown[] = [];
  const fake: MainPairStore = {
    getTask: () => ({ spec: { taskClass: TASK_CLASS, taskFamily: TASK_FAMILY, directCodexProfileId: PROFILE } }),
    listMainUsageSamples: () => samples,
    listEvents: () => [],
    listIntegrationResults: () => [],
    getIntegrationResult: () => undefined,
    getIntegrationReceipt: () => undefined,
    saveMainPairAssessment: (assessment) => { saved.push(assessment); },
    getMainPairAssessmentByComparison: () => undefined,
    hasLegacyMainPairEvidence: () => false,
  };
  const result = assessMainPair(fake, assessInput("task-pair", "cmp-x", "intx"), () => "mpamis");
  assert.equal(result.outcome, "rejected");
  assert.deepEqual(result.reasons, ["incompatible-main-profile"]);
  assert.equal(saved.length, 1);
});

test("capture still does not compute a pair or saving", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4b-cap-"));
  const store = new StateStore(home);
  createReadyTask(store, "task-pair");
  try {
    const sample = captureMainUsage(store, {
      taskId: "task-pair", comparisonId: "cmp-cap", role: "direct-main",
      runRef: "codex-run:cap-d",
      usage: {
        type: "turn.completed",
        usage: {
          input_tokens: 4000, cached_input_tokens: 1000, cache_write_input_tokens: 0,
          output_tokens: 500, reasoning_output_tokens: 100,
        },
      },
    });
    assert.equal("change" in sample, false);
    assert.equal("saving" in sample, false);
    const status = readMainUsageStatus(store, "task-pair", "cmp-cap");
    assert.equal("change" in status, false);
    assert.equal("saving" in status, false);
    assert.equal(store.countMainPairAssessments(), 0);
  } finally {
    store.close();
  }
});

test("pair assess and report use episode parent aggregates without changing gates", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4e-pair-ep-"));
  const store = new StateStore(home);
  createReadyTask(store, "task-pair");
  seedCurrentDelivery(store, "task-pair", "intop-ep");
  const first = {
    type: "turn.completed",
    usage: {
      input_tokens: 2000, cached_input_tokens: 400, cache_write_input_tokens: 100,
      output_tokens: 200, reasoning_output_tokens: 40,
    },
  };
  const second = {
    type: "turn.completed",
    usage: {
      input_tokens: 1500, cached_input_tokens: 300, cache_write_input_tokens: 0,
      output_tokens: 150, reasoning_output_tokens: 20,
    },
  };
  try {
    const original = usageSample({
      sampleId: "legacyd", forklightTaskId: "task-pair", comparisonId: "cmp-pair-ep",
      role: "direct-main", runRef: "codex-run:legacy-direct",
    });
    store.saveMainUsageSample(original);
    const beforeBytes = JSON.stringify(store.getMainUsageSample("legacyd"));
    const delegated = captureMainUsageEpisode(store, {
      taskId: "task-pair",
      comparisonId: "cmp-pair-ep",
      role: "delegated-main",
      runRef: "codex-run:pair-episode",
      segments: [
        { runRef: "codex-run:pair-seg-a", usage: first },
        { runRef: "codex-run:pair-seg-b", usage: second },
      ],
    }, () => "musepg", () => TS);
    assert.equal(JSON.stringify(store.getMainUsageSample("legacyd")), beforeBytes);
    const assessed = assessMainPair(store, assessInput("task-pair", "cmp-pair-ep", "intop-ep"), () => "mpa-ep1");
    assert.equal(assessed.outcome, "accepted");
    const report = readMainPairReport(store, "task-pair", "cmp-pair-ep");
    const expected = computeMainPairArithmetic(
      store.getMainUsageSample("legacyd").grossTokens,
      delegated.grossTokens,
      true,
    );
    assert.equal(report.validity, "accepted");
    assert.equal(report.directGrossTokens, store.getMainUsageSample("legacyd").grossTokens);
    assert.equal(report.delegatedGrossTokens, delegated.grossTokens);
    assert.equal(report.signedChange, expected.signedChange);
    assert.deepEqual(report.percentageChange, expected.percentageChange);
    assert.deepEqual(report.saving, expected.saving);
    assert.equal("segments" in report, false);
  } finally {
    store.close();
  }
});
