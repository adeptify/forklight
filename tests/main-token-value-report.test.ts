import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildTaskRecord } from "../src/core/runner.js";
import { parseTaskSpec } from "../src/core/task.js";
import { assessMainPair, computeMainPairArithmetic, readMainPairReport } from "../src/core/main-token-pair.js";
import { captureMainUsageEpisode } from "../src/core/main-token-usage.js";
import {
  formatMainTokenValueReportHuman,
  readMainTokenValueReport,
  type MainTokenValueReport,
} from "../src/core/main-token-value-report.js";
import { ForkLightDaemon } from "../src/daemon/server.js";
import { StateStore } from "../src/state/store.js";
import type {
  AttemptOfficialCostQuoted,
  AttemptRecord,
  AttemptTokenUsage,
  MainDirectDecisionRecord,
} from "../src/core/types.js";

const TS = "2026-08-17T12:00:00.000Z";
const ASSESSED_AT = "2026-08-17T12:30:00.000Z";
const TASK_CLASS = "edit-task";
const FAMILY_STORAGE = "forklight-storage-lifecycle";
const FAMILY_RUNTIME = "worker-runtime";
const PROFILE = "codex-main-v1";
const DIGEST = "a".repeat(64);
const SECRET = "value-report-SECRET-prompt";
const FORBIDDEN = [
  "prompt", "response", "source", "diff", "path", "log", "credential", "note", "notes",
  "change", "savings", "directCodexSavings", "familyValue", "calibration",
  "averagePercentage", "bestPair", "ranking", "workerMainTotal", "fxTotal",
  "text", "content", "body", "payload", "raw",
] as const;

function createReadyTask(store: StateStore, id: string, taskFamily = FAMILY_STORAGE): void {
  const home = store.databasePath.replace(/\/forklight\.sqlite$/, "");
  const spec = parseTaskSpec({
    version: 1, name: id, project: "/tmp/source", goal: "Value report test",
    taskClass: TASK_CLASS, taskFamily, directCodexProfileId: PROFILE,
    acceptance: { commands: ["true"] },
  }, "/tmp");
  store.createTask(buildTaskRecord({
    spec, taskFile: `/tmp/${id}.yaml`, home, id, sessionId: `session-${id}`, createdAt: TS,
  }));
}

function seedSamples(
  store: StateStore,
  taskId: string,
  comparisonId: string,
  direct: { input: number; output: number },
  delegated: { input: number; output: number },
  prefix: string,
  taskFamily = FAMILY_STORAGE,
): void {
  store.saveMainUsageSample({
    sampleId: `${prefix}d`, forklightTaskId: taskId, comparisonId, role: "direct-main",
    taskClass: TASK_CLASS, taskFamily, directCodexProfileId: PROFILE,
    inputTokens: direct.input, outputTokens: direct.output,
    cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
    grossTokens: direct.input + direct.output,
    source: "codex-terminal-result", runRef: `codex-run:${prefix}d`,
    capturedAt: TS, schemaVersion: 1,
  });
  store.saveMainUsageSample({
    sampleId: `${prefix}g`, forklightTaskId: taskId, comparisonId, role: "delegated-main",
    taskClass: TASK_CLASS, taskFamily, directCodexProfileId: PROFILE,
    inputTokens: delegated.input, outputTokens: delegated.output,
    cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
    grossTokens: delegated.input + delegated.output,
    source: "codex-terminal-result", runRef: `codex-run:${prefix}g`,
    capturedAt: TS, schemaVersion: 1,
  });
}

function seedCurrentDelivery(store: StateStore, taskId: string, operationId: string): void {
  const attemptId = `att-${taskId}`.slice(0, 64);
  const verification = store.addEvent(taskId, attemptId, "verification.completed", "passed", {
    passed: true,
  });
  store.addEvent(taskId, attemptId, "main-review.completed", "accept", {
    decision: "accept",
    reason: "accepted",
    attemptId,
    verificationEventSequence: verification.sequence,
    candidateRevisionId: `rev-${taskId}`.slice(0, 64),
    acceptedPatchDigest: DIGEST,
  });
  store.saveIntegrationReceipt({
    id: `rcpt-${operationId}`.slice(0, 64),
    taskId,
    patchDigest: DIGEST,
    affectedFiles: ["src/cli.ts"],
    rejectionReasons: [],
    sourceEvidence: {},
    createdAt: TS,
    expiresAt: "2099-01-01T00:00:00.000Z",
    consumed: true,
  });
  store.saveIntegrationResult({
    id: operationId,
    receiptId: `rcpt-${operationId}`.slice(0, 64),
    taskId,
    status: "applied",
    appliedAt: TS,
    createdAt: TS,
    stages: [
      { stage: "source-applied", status: "passed" },
      { stage: "source-verified", status: "passed" },
      { stage: "artifact-built", status: "passed" },
      { stage: "runtime-activated", status: "passed" },
    ],
  });
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

function acceptPair(
  store: StateStore,
  taskId: string,
  comparisonId: string,
  operationId: string,
  direct: { input: number; output: number },
  delegated: { input: number; output: number },
  prefix: string,
  taskFamily = FAMILY_STORAGE,
): void {
  createReadyTask(store, taskId, taskFamily);
  seedSamples(store, taskId, comparisonId, direct, delegated, prefix, taskFamily);
  seedCurrentDelivery(store, taskId, operationId);
  const result = assessMainPair(store, assessInput(taskId, comparisonId, operationId));
  assert.equal(result.outcome, "accepted");
}

function snapshot(store: StateStore, taskIds: readonly string[]) {
  return {
    assessments: store.countMainPairAssessments(),
    samples: store.countMainUsageSamples(),
    tasks: store.listTasks().length,
    events: Object.fromEntries(taskIds.map((id) => [id, store.listEvents(id).length])),
  };
}

function assertPrivacy(report: MainTokenValueReport): void {
  const json = JSON.stringify(report);
  assert.equal(json.includes(SECRET), false);
  assert.equal("createdWork" in report, true);
  assert.equal(report.createdWork, false);
  for (const key of FORBIDDEN) {
    assert.equal(key in report, false, key);
    for (const family of report.families) {
      assert.equal(key in family, false, `${family.taskFamily}.${key}`);
      for (const comparison of family.comparisons) {
        assert.equal(key in comparison, false, `${comparison.comparisonId}.${key}`);
      }
    }
  }
}

function assertDeepFrozen(value: unknown, label = "root"): void {
  if (value === null || typeof value !== "object") return;
  assert.ok(Object.isFrozen(value), `Expected ${label} frozen`);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertDeepFrozen(entry, `${label}[${index}]`));
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    assertDeepFrozen(entry, `${label}.${key}`);
  }
}

function runValueReportCli(home: string, arguments_: string[]): Promise<{
  stdout: string; stderr: string; exitCode: number;
}> {
  return new Promise((resolve) => {
    execFile(process.execPath, [
      "--disable-warning=ExperimentalWarning", "--import", "tsx",
      path.join(process.cwd(), "src/cli.ts"), ...arguments_,
    ], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, FORKLIGHT_HOME: home } },
    (error, stdout, stderr) => {
      const code = (error as (Error & { code?: unknown }) | null)?.code;
      resolve({
        stdout: String(stdout), stderr: String(stderr),
        exitCode: error === null ? 0 : typeof code === "number" ? code : 1,
      });
    });
  });
}

function quotedCost(currency: "USD" | "CNY", total: number, url: string): AttemptOfficialCostQuoted {
  return {
    stage: "calculation",
    quoted: true,
    result: {
      quoted: true,
      currency,
      total,
      components: [],
      pricing: {
        provider: "deepseek",
        origin: "https://api.deepseek.com",
        route: "deepseek-direct-payg",
        modelAliases: ["deepseek-v4-pro"],
        serviceTier: "standard",
        currency,
        unitTokens: 1_000_000,
        source: { url, checkedAt: TS },
        promotion: null,
      },
      appliedTier: { applied: [], totalPromptInput: 0 },
      usageSource: "terminal-result",
      providerBillClaim: false,
    },
  } as unknown as AttemptOfficialCostQuoted;
}

function completeUsage(input: number, output: number): AttemptTokenUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    source: "terminal-result",
    complete: true,
  };
}

function makeAttempt(id: string, taskId: string, ordinal: number, overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    id,
    taskId,
    ordinal,
    status: "succeeded",
    sessionId: `s-${id}`,
    rawLogPath: `/tmp/${id}.log`,
    startedAt: TS,
    finishedAt: "2026-08-17T12:00:01.000Z",
    exitCode: 0,
    ...overrides,
  } as AttemptRecord;
}

test("empty Store is cannot-determine with typed reasons and no zero sample", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4c-empty-"));
  const store = new StateStore(home);
  try {
    const first = readMainTokenValueReport(store, { families: [FAMILY_STORAGE] });
    const second = readMainTokenValueReport(store, { families: [FAMILY_STORAGE] });
    assert.deepEqual(first, second);
    assert.equal(first.overall, "cannot-determine");
    assert.ok(first.reasons.includes("empty-store"));
    assert.ok(first.reasons.includes("uncovered-family"));
    assert.equal(first.families[0]?.claim, "cannot-determine");
    assert.deepEqual(first.families[0]?.reasons, ["uncovered-family"]);
    assert.equal(first.families[0]?.comparisons.length, 0);
    assert.equal(first.families[0]?.acceptedPairCount, 0);
    assert.equal("grossTokens" in (first.families[0] ?? {}), false);
    assertPrivacy(first);
    assertDeepFrozen(first);
    const human = formatMainTokenValueReportHuman(first);
    assert.match(human, /overall: cannot-determine/);
    assert.match(human, /uncovered-family/);
    assert.doesNotMatch(human, /saving claim|averagePercentage|bestPair/i);
  } finally {
    store.close();
  }
});

test("invalid request is cannot-determine and does not invent families", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4c-invalid-"));
  const store = new StateStore(home);
  try {
    const none = readMainTokenValueReport(store, { families: [] });
    assert.equal(none.overall, "cannot-determine");
    assert.deepEqual(none.reasons, ["invalid-request"]);
    assert.deepEqual(none.requestedFamilies, []);

    const tooMany = readMainTokenValueReport(store, {
      families: Array.from({ length: 11 }, (_, index) => `family-${index}`),
    });
    assert.deepEqual(tooMany.reasons, ["invalid-request"]);

    const duplicate = readMainTokenValueReport(store, {
      families: [FAMILY_STORAGE, FAMILY_STORAGE],
    });
    assert.deepEqual(duplicate.reasons, ["invalid-request"]);

    const unknownKey = readMainTokenValueReport(store, {
      families: [FAMILY_STORAGE],
      prompt: SECRET,
    });
    assert.deepEqual(unknownKey.reasons, ["invalid-request"]);
    assert.equal(JSON.stringify(unknownKey).includes(SECRET), false);
    assert.equal(store.countMainPairAssessments(), 0);
  } finally {
    store.close();
  }
});

test("uncovered and legacy-only families stay cannot-determine", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4c-legacy-"));
  const store = new StateStore(home);
  createReadyTask(store, "task-legacy");
  store.saveDirectCodexProfilePublication({
    directCodexProfileId: PROFILE,
    calibration: {
      minTokens: 1000, maxTokens: 1500, method: "paired-sample-v1",
      taskClass: TASK_CLASS, confidence: "medium", version: 1, sampleSize: 1,
      evidenceReferences: ["sample:legacy-pub-v1"], createdAt: TS, schemaVersion: 1,
    },
    envelopeSchemaVersion: 1,
  });
  try {
    const report = readMainTokenValueReport(store, {
      families: [FAMILY_STORAGE, FAMILY_RUNTIME],
    });
    assert.equal(report.overall, "cannot-determine");
    assert.equal(report.families[0]?.taskFamily, FAMILY_STORAGE);
    assert.deepEqual(report.families[0]?.reasons, ["legacy-pair-contract-missing"]);
    assert.equal(report.families[0]?.comparisons.length, 0);
    assert.equal(report.families[1]?.taskFamily, FAMILY_RUNTIME);
    assert.deepEqual(report.families[1]?.reasons, ["uncovered-family"]);
    assert.equal(report.createdWork, false);
    assert.ok(!report.reasons.includes("not-strictly-positive"));
  } finally {
    store.close();
  }
});

test("accepted strictly-positive pair proves a family; omitted filter lists it", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4c-ok-"));
  const store = new StateStore(home);
  acceptPair(store, "task-ok", "cmp-ok", "intop-ok", { input: 4000, output: 500 }, { input: 1200, output: 300 }, "ok");
  const before = snapshot(store, ["task-ok"]);
  try {
    const first = readMainTokenValueReport(store, { families: [FAMILY_STORAGE] });
    const second = readMainTokenValueReport(store, { families: [FAMILY_STORAGE] });
    assert.deepEqual(first, second);
    assert.equal(first.overall, "proven");
    assert.equal(first.families[0]?.claim, "proven-lower");
    assert.deepEqual(first.families[0]?.reasons, []);
    assert.equal(first.families[0]?.comparisons.length, 1);
    const comparison = first.families[0]!.comparisons[0]!;
    const pair = readMainPairReport(store, "task-ok", "cmp-ok");
    const expected = computeMainPairArithmetic(pair.directGrossTokens!, pair.delegatedGrossTokens!, true);
    assert.equal(comparison.listingStatus, "accepted");
    assert.equal(comparison.pairValidity, "accepted");
    assert.equal(comparison.directGrossTokens, pair.directGrossTokens);
    assert.equal(comparison.delegatedGrossTokens, pair.delegatedGrossTokens);
    assert.equal(comparison.signedChange, expected.signedChange);
    assert.ok(comparison.signedChange! > 0);
    assert.deepEqual(comparison.percentageChange, expected.percentageChange);
    assert.equal(comparison.contributesProvenLower, true);
    assert.deepEqual(comparison.qualityGates, {
      sameScope: true, sameAcceptance: true, delegatedQualityNotLower: true,
    });
    assert.equal(comparison.deliveryValue.workerTokens.status, "unavailable");
    assert.equal(comparison.deliveryValue.workerTokens.reason, "no-attempts");
    assert.equal("grossTokens" in comparison.deliveryValue.workerTokens, false);
    assert.equal(first.createdWork, false);
    assert.deepEqual(snapshot(store, ["task-ok"]), before);
    const human = formatMainTokenValueReportHuman(first);
    assert.match(human, /claim: proven-lower/);
    assert.match(human, /signedChange: 3000/);
    assert.match(human, /workerTokens: unavailable \(no-attempts\)/);
  } finally {
    store.close();
  }
});

test("equal and higher accepted pairs stay visible and cannot graduate a family", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4c-eq-"));
  const store = new StateStore(home);
  acceptPair(store, "task-eq", "cmp-eq", "intop-eq", { input: 2000, output: 0 }, { input: 2000, output: 0 }, "eq");
  acceptPair(store, "task-hi", "cmp-hi", "intop-hi", { input: 1000, output: 0 }, { input: 1500, output: 0 }, "hi");
  try {
    const report = readMainTokenValueReport(store, { families: [FAMILY_STORAGE] });
    assert.equal(report.overall, "cannot-determine");
    assert.equal(report.families[0]?.claim, "cannot-determine");
    assert.ok(report.families[0]?.reasons.includes("not-strictly-positive"));
    const byId = Object.fromEntries(report.families[0]!.comparisons.map((entry) => [entry.comparisonId, entry]));
    assert.equal(byId["cmp-eq"]?.signedChange, 0);
    assert.equal(byId["cmp-eq"]?.contributesProvenLower, false);
    assert.equal(byId["cmp-eq"]?.saving.status, "not-lower");
    assert.equal(byId["cmp-hi"]?.signedChange, -500);
    assert.equal(byId["cmp-hi"]?.contributesProvenLower, false);
    assert.equal(byId["cmp-hi"]?.saving.status, "higher");
    assert.equal(report.families[0]?.comparisons.length, 2);
  } finally {
    store.close();
  }
});

test("mixed family lists every pair and proves only from a strictly-positive accepted pair", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4c-mix-"));
  const store = new StateStore(home);
  acceptPair(store, "task-low", "cmp-low", "intop-low", { input: 4000, output: 500 }, { input: 1200, output: 300 }, "low");
  acceptPair(store, "task-eq2", "cmp-eq2", "intop-eq2", { input: 2000, output: 0 }, { input: 2000, output: 0 }, "eq2");
  createReadyTask(store, "task-rej");
  seedSamples(store, "task-rej", "cmp-rej", { input: 3000, output: 0 }, { input: 1000, output: 0 }, "rej");
  seedCurrentDelivery(store, "task-rej", "intop-rej");
  const rejected = assessMainPair(store, assessInput("task-rej", "cmp-rej", "intop-rej", { sameScope: false }));
  assert.equal(rejected.outcome, "rejected");
  createReadyTask(store, "task-inc");
  seedSamples(store, "task-inc", "cmp-inc", { input: 900, output: 0 }, { input: 100, output: 0 }, "inc");
  acceptPair(store, "task-stale", "cmp-stale", "intop-stale", { input: 5000, output: 0 }, { input: 1000, output: 0 }, "stale");
  store.addEvent("task-stale", "att-task-stale", "verification.completed", "passed-again", { passed: true });
  try {
    const report = readMainTokenValueReport(store, { families: [FAMILY_STORAGE] });
    assert.equal(report.overall, "proven");
    assert.equal(report.families[0]?.claim, "proven-lower");
    const statuses = report.families[0]!.comparisons.map((entry) => [entry.comparisonId, entry.listingStatus]);
    assert.deepEqual(statuses, [
      ["cmp-eq2", "accepted"],
      ["cmp-inc", "incomplete"],
      ["cmp-low", "accepted"],
      ["cmp-rej", "rejected"],
      ["cmp-stale", "stale"],
    ]);
    const low = report.families[0]!.comparisons.find((entry) => entry.comparisonId === "cmp-low")!;
    const eq = report.families[0]!.comparisons.find((entry) => entry.comparisonId === "cmp-eq2")!;
    const stale = report.families[0]!.comparisons.find((entry) => entry.comparisonId === "cmp-stale")!;
    assert.equal(low.contributesProvenLower, true);
    assert.equal(eq.contributesProvenLower, false);
    assert.equal(stale.contributesProvenLower, false);
    assert.equal(stale.pairValidity, "cannot-determine");
    assert.equal("averagePercentage" in report, false);
    for (const entry of report.families[0]!.comparisons) {
      if (entry.directGrossTokens === undefined || entry.delegatedGrossTokens === undefined) continue;
      const expected = computeMainPairArithmetic(
        entry.directGrossTokens,
        entry.delegatedGrossTokens,
        entry.listingStatus === "accepted",
      );
      assert.equal(entry.signedChange, expected.signedChange);
      assert.deepEqual(entry.percentageChange, expected.percentageChange);
    }
  } finally {
    store.close();
  }
});

test("two-family set is proven only when every requested family is proven-lower", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4c-two-"));
  const store = new StateStore(home);
  acceptPair(store, "task-a", "cmp-a", "intop-a", { input: 4000, output: 0 }, { input: 1000, output: 0 }, "a", FAMILY_STORAGE);
  acceptPair(store, "task-b", "cmp-b", "intop-b", { input: 2000, output: 0 }, { input: 2000, output: 0 }, "b", FAMILY_RUNTIME);
  try {
    const partial = readMainTokenValueReport(store, { families: [FAMILY_STORAGE, FAMILY_RUNTIME] });
    assert.equal(partial.overall, "cannot-determine");
    assert.equal(partial.families[0]?.claim, "proven-lower");
    assert.equal(partial.families[1]?.claim, "cannot-determine");
    assert.ok(partial.families[1]?.reasons.includes("not-strictly-positive"));

    const onlyStorage = readMainTokenValueReport(store, { families: [FAMILY_STORAGE] });
    assert.equal(onlyStorage.overall, "proven");

    const filtered = readMainTokenValueReport(store, {
      families: [FAMILY_STORAGE, FAMILY_RUNTIME],
      comparisons: ["cmp-a"],
    });
    assert.equal(filtered.families[0]?.comparisons.length, 1);
    assert.equal(filtered.families[0]?.comparisons[0]?.comparisonId, "cmp-a");
    assert.equal(filtered.families[1]?.comparisons.length, 0);
    assert.equal(filtered.overall, "cannot-determine");
  } finally {
    store.close();
  }
});

test("partial economics stay separate from exact Main pair arithmetic", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4c-econ-"));
  const store = new StateStore(home);
  acceptPair(store, "task-econ", "cmp-econ", "intop-econ", { input: 4000, output: 500 }, { input: 1200, output: 300 }, "econ");
  store.createAttempt(makeAttempt("att-e1", "task-econ", 1, {
    usage: completeUsage(100, 20),
    runtimeCostEstimateUsd: 1.25,
    officialCost: quotedCost("USD", 2.5, "https://example.test/usd"),
    executionKind: "standard",
  }));
  store.createAttempt({
    id: "att-e2",
    taskId: "task-econ",
    ordinal: 2,
    status: "succeeded",
    sessionId: "s-att-e2",
    rawLogPath: "/tmp/att-e2.log",
    startedAt: TS,
    exitCode: 0,
    officialCost: quotedCost("CNY", 8, "https://example.test/cny"),
    executionKind: "main-correction",
  });
  store.addEvent("task-econ", "att-e1", "worker.validation-repair.authorized", "repair", { kind: "worker-validation-repair" });
  store.addEvent("task-econ", "att-e1", "candidate.reverification.authorized", "reverify", { kind: "reverification" });
  store.addEvent("task-econ", "att-e1", "worker.message", SECRET, { prompt: SECRET });
  store.saveMainDirectDecision({
    id: "md-econ",
    taskClass: TASK_CLASS,
    taskFamily: FAMILY_STORAGE,
    reason: "user-requested",
    note: "bounded",
    consideredWorkerProfileIds: [],
    consideredWorkers: [],
    evidenceSnapshot: [],
    status: "completed",
    startedAt: TS,
    closedState: {
      outcome: "completed",
      note: "bounded",
      closedAt: "2026-08-17T12:00:05.000Z",
    },
  } as MainDirectDecisionRecord);
  try {
    const report = readMainTokenValueReport(store, { families: [FAMILY_STORAGE] });
    const comparison = report.families[0]!.comparisons[0]!;
    assert.equal(comparison.signedChange, 3000);
    assert.equal(comparison.contributesProvenLower, true);
    assert.equal(comparison.deliveryValue.workerTokens.status, "incomplete");
    assert.equal(comparison.deliveryValue.workerTokens.completeCount, 1);
    assert.equal(comparison.deliveryValue.workerTokens.incompleteCount, 1);
    assert.equal(comparison.deliveryValue.workerTokens.grossTokens, 120);
    assert.equal(comparison.deliveryValue.runtimeEstimate.status, "incomplete");
    assert.equal(comparison.deliveryValue.runtimeEstimate.observedTotalUsd, 1.25);
    assert.equal(comparison.deliveryValue.officialCost.status, "quoted");
    assert.deepEqual(
      comparison.deliveryValue.officialCost.totals.map((total) => total.currency),
      ["CNY", "USD"],
    );
    assert.equal(comparison.deliveryValue.officialCost.totals.length, 2);
    assert.equal("fxTotal" in comparison.deliveryValue.officialCost, false);
    assert.equal(comparison.deliveryValue.attemptElapsed.status, "incomplete");
    assert.equal(comparison.deliveryValue.attemptElapsed.measuredCount, 1);
    assert.equal(comparison.deliveryValue.corrections.workerValidationRepairCount, 1);
    assert.equal(comparison.deliveryValue.corrections.mainCorrectionCount, 1);
    assert.equal(comparison.deliveryValue.corrections.mainReverificationCount, 1);
    assert.equal(comparison.deliveryValue.corrections.handoffCount, 0);
    assert.equal(report.families[0]?.mainDirectElapsed.status, "complete");
    assert.equal(report.families[0]?.mainDirectElapsed.binding, "task-family");
    assert.equal(report.families[0]?.mainDirectElapsed.totalMs, 5000);
    assertPrivacy(report);
    const json = JSON.stringify(report);
    assert.equal(json.includes(SECRET), false);
    assert.equal("directCodexSavings" in report, false);
    const pairTokens = (comparison.directGrossTokens ?? 0) + (comparison.deliveryValue.workerTokens.grossTokens ?? 0);
    assert.notEqual(comparison.signedChange, pairTokens);
  } finally {
    store.close();
  }
});

test("comparison filter mismatch and missing ids are typed and do not invent zeros", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4c-filter-"));
  const store = new StateStore(home);
  acceptPair(store, "task-f", "cmp-f", "intop-f", { input: 4000, output: 0 }, { input: 1000, output: 0 }, "f");
  try {
    const missing = readMainTokenValueReport(store, {
      families: [FAMILY_STORAGE],
      comparisons: ["cmp-missing"],
    });
    assert.equal(missing.overall, "cannot-determine");
    assert.ok(missing.reasons.includes("comparison-not-found"));
    assert.equal(missing.families[0]?.comparisons.length, 0);

    const mismatch = readMainTokenValueReport(store, {
      families: [FAMILY_RUNTIME],
      comparisons: ["cmp-f"],
    });
    assert.ok(mismatch.reasons.includes("comparison-family-mismatch"));
    assert.equal(mismatch.families[0]?.comparisons.length, 0);
    assert.equal(mismatch.families[0]?.claim, "cannot-determine");
  } finally {
    store.close();
  }
});

test("value-report CLI reads flags from the full remainder after the command", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4c-cli-remainder-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const launched = await runValueReportCli(home, [
      "value-report",
      "--families", JSON.stringify([FAMILY_STORAGE]),
      "--comparisons", JSON.stringify(["cmp-remainder"]),
      "--json",
    ]);
    assert.equal(launched.exitCode, 0, launched.stderr);
    const report = JSON.parse(launched.stdout) as MainTokenValueReport;
    assert.deepEqual(report.requestedFamilies, [FAMILY_STORAGE]);
    assert.deepEqual(report.requestedComparisons, ["cmp-remainder"]);
    assert.equal(report.overall, "cannot-determine");
    assert.ok(report.reasons.includes("empty-store"));
    assert.ok(report.reasons.includes("comparison-not-found"));
    assert.equal(report.families[0]?.claim, "cannot-determine");
    assert.equal(report.createdWork, false);
  } finally {
    await daemon.close();
  }
});

test("value report accepts episode parent totals and leaves legacy rows unchanged", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4e-value-ep-"));
  const store = new StateStore(home);
  try {
    createReadyTask(store, "task-value-ep");
    seedCurrentDelivery(store, "task-value-ep", "intop-value-ep");
    store.saveMainUsageSample({
      sampleId: "valueepd", forklightTaskId: "task-value-ep", comparisonId: "cmp-value-ep",
      role: "direct-main", taskClass: TASK_CLASS, taskFamily: FAMILY_STORAGE,
      directCodexProfileId: PROFILE, inputTokens: 4000, outputTokens: 500,
      cacheReadInputTokens: 0, cacheCreationInputTokens: 0, grossTokens: 4500,
      source: "codex-terminal-result", runRef: "codex-run:value-ep-d",
      capturedAt: TS, schemaVersion: 1,
    });
    const beforeBytes = JSON.stringify(store.getMainUsageSample("valueepd"));
    const delegated = captureMainUsageEpisode(store, {
      taskId: "task-value-ep",
      comparisonId: "cmp-value-ep",
      role: "delegated-main",
      runRef: "codex-run:value-episode",
      segments: [
        {
          runRef: "codex-run:value-seg-a",
          usage: {
            type: "turn.completed",
            usage: {
              input_tokens: 900, cached_input_tokens: 200, cache_write_input_tokens: 50,
              output_tokens: 120, reasoning_output_tokens: 30,
            },
          },
        },
        {
          runRef: "codex-run:value-seg-b",
          usage: {
            type: "turn.completed",
            usage: {
              input_tokens: 700, cached_input_tokens: 100, cache_write_input_tokens: 0,
              output_tokens: 80, reasoning_output_tokens: 10,
            },
          },
        },
      ],
    }, () => "valueepg", () => TS);
    assert.equal(JSON.stringify(store.getMainUsageSample("valueepd")), beforeBytes);
    const assessed = assessMainPair(store, assessInput("task-value-ep", "cmp-value-ep", "intop-value-ep"));
    assert.equal(assessed.outcome, "accepted");
    const report = readMainTokenValueReport(store, { families: [FAMILY_STORAGE] });
    const pair = readMainPairReport(store, "task-value-ep", "cmp-value-ep");
    const direct = store.getMainUsageSample("valueepd");
    const expected = computeMainPairArithmetic(direct.grossTokens, delegated.grossTokens, true);
    assert.equal(pair.directGrossTokens, direct.grossTokens);
    assert.equal(pair.delegatedGrossTokens, delegated.grossTokens);
    assert.deepEqual(pair.percentageChange, expected.percentageChange);
    const comparison = report.families[0]?.comparisons[0];
    assert.ok(comparison);
    assert.equal(comparison.directGrossTokens, direct.grossTokens);
    assert.equal(comparison.delegatedGrossTokens, delegated.grossTokens);
    assert.equal(comparison.signedChange, expected.signedChange);
    assert.equal("saving" in report, false);
    assert.equal(JSON.stringify(store.getMainUsageSample("valueepd")), beforeBytes);
  } finally {
    store.close();
  }
});
