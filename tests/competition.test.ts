import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CompetitionCoordinator,
  CompetitionService,
  DEFAULT_RANKING_POLICY,
  rankingPolicy,
  scoreCandidates,
  validateCompetitionReason,
  type CandidateOverride,
  type CompetitionCandidateInput,
} from "../src/core/competition.js";
import {
  CandidateHandoffError,
  buildHandoffInstruction,
  buildHandoffSuccessorSpec,
  executeCandidateHandoff,
  filterPatchToSelectedPaths,
  projectCandidateHandoff,
  recoverCandidateHandoffs,
  resolveHandoffViewForTask,
} from "../src/core/candidate-handoff.js";
import { resolveWorkerSelection } from "../src/core/worker-profiles.js";
import type { CompetitionSettings } from "../src/core/settings.js";
import { SettingsService } from "../src/core/settings.js";
import { upsertModelConfig } from "../src/core/model-catalog.js";
import { upsertWorkerProfile } from "../src/core/worker-profiles.js";
import { recordMainReview } from "../src/core/main-review.js";
import { authorizeMainCorrection } from "../src/core/attempt-authorization.js";
import { resolveCorrectionEligibility } from "../src/core/candidate-revision.js";
import type {
  AttemptRecord,
  CompetitionCandidateRecord,
  CompetitionRecord,
  TaskRecord,
  TaskSpec,
  VerificationResult,
} from "../src/core/types.js";
import { StateStore } from "../src/state/store.js";

const base = Date.parse("2026-07-20T00:00:00Z");
const at = (minutes: number): string => new Date(base + minutes * 60_000).toISOString();

function task(
  id: string,
  provider: string,
  model: string,
  status: TaskRecord["status"] = "succeeded",
  durationMinutes = 10,
): TaskRecord {
  return {
    id,
    name: id,
    status,
    sourcePath: "/source",
    taskFile: `/${id}.yaml`,
    spec: { provider: { name: provider, model } } as TaskRecord["spec"],
    paths: {} as TaskRecord["paths"],
    sessionId: `session-${id}`,
    createdAt: at(0),
    updatedAt: at(durationMinutes),
    startedAt: at(0),
    finishedAt: at(durationMinutes),
  };
}

function attempt(taskId: string, ordinal = 1, costUsd?: number): AttemptRecord {
  return {
    id: `${taskId}-${ordinal}`,
    taskId,
    ordinal,
    status: "succeeded",
    sessionId: `session-${taskId}`,
    rawLogPath: "/log",
    startedAt: at(ordinal - 1),
    finishedAt: at(ordinal),
    ...(costUsd === undefined ? {} : { costUsd }),
  };
}

function verification(
  passed: boolean,
  filesChanged = 1,
  changedLines = 20,
): VerificationResult {
  return {
    passed,
    behaviorPassed: passed,
    policyPassed: passed,
    sourceCompatible: true,
    commands: [
      { command: "npm test", exitCode: passed ? 0 : 1, stdout: "", stderr: "", durationMs: 1, timedOut: false },
    ],
    diffPath: "/diff",
    sourceUnchanged: true,
    changeBudget: {
      filesChanged,
      changedLines,
      maxFiles: 10,
      maxDiffLines: 200,
      withinBudget: passed,
    },
  };
}

function candidate(
  candidateId: string,
  record: TaskRecord,
  verificationResult?: VerificationResult,
  attempts: AttemptRecord[] = [attempt(record.id, 1, 0.2)],
): CompetitionCandidateInput {
  return {
    candidateId,
    taskId: record.id,
    providerName: record.spec.provider.name,
    modelName: record.spec.provider.model,
    evidence: {
      task: record,
      attempts,
      events: [],
      ...(verificationResult === undefined ? {} : { verification: verificationResult }),
    },
  };
}

test("default ranking is speed-neutral and policy overrides are validated", () => {
  assert.equal(DEFAULT_RANKING_POLICY.weights.duration, 0);
  assert.equal(DEFAULT_RANKING_POLICY.weights.cost, 0);
  assert.equal(rankingPolicy({ duration: 0.4 }).weights.duration, 0.4);
  assert.throws(() => rankingPolicy({ verification: 0 }), /positive/);
  assert.throws(() => rankingPolicy({ cost: -1 }), /non-negative/);
});

test("verified focused candidate wins with every factor and missing evidence visible", () => {
  const focused = candidate(
    "focused",
    task("focused-task", "deepseek", "v4", "succeeded", 120),
    verification(true, 1, 10),
    [attempt("focused-task")],
  );
  const broad = candidate(
    "broad",
    task("broad-task", "minimax", "m3", "succeeded", 10),
    verification(true, 8, 160),
    [attempt("broad-task", 1, 0.2), attempt("broad-task", 2, 0.2)],
  );
  const result = scoreCandidates("competition", [focused, broad], DEFAULT_RANKING_POLICY, {
    evaluationId: "evaluation",
    createdAt: at(200),
  });

  assert.equal(result.recommendation?.candidateId, "focused");
  assert.equal(result.candidates[0]?.candidateId, "focused");
  assert.equal(result.candidates[0]?.factors.length, 6);
  assert.equal(
    result.candidates[0]?.factors.find((factor) => factor.factor === "duration")?.weight,
    0,
  );
  assert.equal(
    result.candidates[0]?.factors.find((factor) => factor.factor === "cost")?.available,
    false,
  );
});

test("missing verification is disqualified and exact ties do not force a recommendation", () => {
  const missing = candidate("missing", task("missing-task", "qwen", "q3"));
  const failed = candidate(
    "failed",
    task("failed-task", "deepseek", "v4", "failed"),
    verification(false),
  );
  const none = scoreCandidates("none", [missing, failed], DEFAULT_RANKING_POLICY, {
    evaluationId: "none-evaluation",
    createdAt: at(20),
  });
  assert.equal(none.recommendation, undefined);
  assert.ok(none.candidates.every((score) => !score.eligible));
  assert.match(none.candidates[1]?.disqualificationReason ?? "", /verification/i);

  const first = candidate("a", task("a-task", "deepseek", "v4"), verification(true));
  const second = candidate("b", task("b-task", "minimax", "m3"), verification(true));
  const tied = scoreCandidates("tie", [second, first], DEFAULT_RANKING_POLICY, {
    evaluationId: "tie-evaluation",
    createdAt: at(20),
  });
  assert.equal(tied.recommendation, undefined);
  assert.deepEqual(tied.candidates.map(({ candidateId }) => candidateId), ["a", "b"]);
});

test("competition service persists every evaluation and user-enabled speed preference", () => {
  const home = mkdtempSync(path.join(tmpdir(), "forklight-competition-"));
  const store = new StateStore(home);
  try {
    const slow = task("slow", "deepseek", "v4", "succeeded", 60);
    const fast = task("fast", "minimax", "m3", "succeeded", 5);
    for (const record of [slow, fast]) {
      store.createTask(record);
      const workerAttempt = attempt(record.id, 1, 0.2);
      store.createAttempt(workerAttempt);
      store.addEvent(
        record.id,
        workerAttempt.id,
        "verification.completed",
        "Independent verification passed",
        verification(true),
      );
    }
    const competition: CompetitionRecord = {
      id: "stored-competition",
      name: "stored competition",
      contractTaskId: slow.id,
      status: "running",
      rankingPolicy: DEFAULT_RANKING_POLICY,
      createdAt: at(0),
      updatedAt: at(0),
    };
    const candidates: CompetitionCandidateRecord[] = [slow, fast].map((record, ordinal) => ({
      id: `candidate-${record.id}`,
      competitionId: competition.id,
      taskId: record.id,
      ordinal,
      providerName: record.spec.provider.name,
      modelName: record.spec.provider.model,
    }));
    store.createCompetition(competition, candidates);

    const evaluation = new CompetitionService(store).score(competition.id, { duration: 0.4 });
    assert.equal(evaluation.recommendation?.candidateId, "candidate-fast");
    assert.equal(evaluation.policy.weights.duration, 0.4);
    assert.equal(store.listCompetitionEvaluations(competition.id).length, 1);
    assert.equal(store.getCompetition(competition.id).latestEvaluationId, evaluation.id);
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

// --- configured competition settings ---

test("rankingPolicy uses configured competition settings as base weights and tieThreshold", () => {
  const configured: CompetitionSettings = {
    minCandidates: 2,
    maxCandidates: 4,
    tieThreshold: 0.05,
    rankingWeights: { verification: 2, diffFocus: 0.5, retries: 0.3, cost: 0.2, duration: 0.8, delivery: 0.3 },
  };
  const policy = rankingPolicy({}, configured);
  assert.equal(policy.weights.verification, 2);
  assert.equal(policy.weights.duration, 0.8);
  assert.equal(policy.weights.delivery, 0.3);
  assert.equal(policy.tieThreshold, 0.05);
  // tieThreshold is always present (required field)
  assert.ok(typeof policy.tieThreshold === "number");
});

test("explicit per-call override wins over configured settings weights", () => {
  const configured: CompetitionSettings = {
    minCandidates: 2,
    maxCandidates: 4,
    tieThreshold: 0.05,
    rankingWeights: { verification: 2, diffFocus: 0.5, retries: 0.3, cost: 0.2, duration: 0.8, delivery: 0.3 },
  };
  const policy = rankingPolicy({ duration: 0.1, cost: 0 }, configured);
  assert.equal(policy.weights.duration, 0.1);
  assert.equal(policy.weights.cost, 0);
  // unchanged fields keep configured values
  assert.equal(policy.weights.verification, 2);
  assert.equal(policy.weights.diffFocus, 0.5);
});

const tieTable: Array<{ threshold: number; expectRecommendation: boolean; label: string }> = [
  { threshold: 0.01, expectRecommendation: true, label: "threshold below gap recommends" },
  { threshold: 0.50, expectRecommendation: false, label: "threshold above gap ties" },
];

for (const { threshold, expectRecommendation, label } of tieTable) {
  test(`configured tieThreshold alters recommendation: ${label}`, () => {
    // Focused candidate changes 1 file/10 lines; broad changes 8 files/160 lines.
    // Gap ≈ 0.27 - 0.15 = 0.12, so threshold 0.01 < gap and threshold 0.50 > gap.
    const focused = candidate(
      "a", task("a-task", "deepseek", "v4", "succeeded", 10),
      verification(true, 1, 10),
      [attempt("a-task", 1, 0.2)],
    );
    const broad = candidate(
      "b", task("b-task", "minimax", "m3", "succeeded", 10),
      verification(true, 8, 160),
      [attempt("b-task", 1, 0.2)],
    );
    const policy = rankingPolicy(
      {},
      {
        minCandidates: 2, maxCandidates: 4, tieThreshold: threshold,
        rankingWeights: DEFAULT_RANKING_POLICY.weights,
      },
    );
    const result = scoreCandidates("tie-test", [focused, broad], policy, {
      evaluationId: "tie-eval", createdAt: at(200),
    });
    assert.ok(typeof result.policy.tieThreshold === "number");
    assert.equal(result.policy.tieThreshold, threshold);
    if (expectRecommendation) {
      assert.ok(result.recommendation !== undefined);
    } else {
      assert.equal(result.recommendation, undefined);
    }
  });
}

test("configured duration weight changes recommendation in service evaluation", () => {
  const home = mkdtempSync(path.join(tmpdir(), "forklight-competition-"));
  const store = new StateStore(home);
  try {
    const slow = task("slow", "deepseek", "v4", "succeeded", 60);
    const fast = task("fast", "minimax", "m3", "succeeded", 5);
    for (const record of [slow, fast]) {
      store.createTask(record);
      const wa = attempt(record.id, 1, 0.2);
      store.createAttempt(wa);
      store.addEvent(record.id, wa.id, "verification.completed", "ok", verification(true));
    }
    // Bake configured policy into the competition at creation time.
    const speedSettings: CompetitionSettings = {
      minCandidates: 2, maxCandidates: 4, tieThreshold: 0.01,
      rankingWeights: { verification: 1, diffFocus: 0.3, retries: 0.2, cost: 0, duration: 0.8, delivery: 0.3 },
    };
    const comp: CompetitionRecord = {
      id: "speed-comp", name: "speed", contractTaskId: slow.id,
      status: "running", rankingPolicy: rankingPolicy({}, speedSettings),
      createdAt: at(0), updatedAt: at(0),
    };
    store.createCompetition(comp, [
      { id: "c-slow", competitionId: comp.id, taskId: slow.id, ordinal: 0, providerName: "deepseek", modelName: "v4" },
      { id: "c-fast", competitionId: comp.id, taskId: fast.id, ordinal: 1, providerName: "minimax", modelName: "m3" },
    ]);
    // Score from the stored policy; tie threshold also flows through settings.
    const eval1 = new CompetitionService(store).score(comp.id, {}, speedSettings);
    assert.equal(eval1.policy.weights.duration, 0.8);
    assert.equal(eval1.policy.tieThreshold, 0.01);
    assert.equal(eval1.recommendation?.candidateId, "c-fast");
    // Persisted evaluation carries the exact policy with required tieThreshold.
    const persisted = store.listCompetitionEvaluations(comp.id);
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0]!.policy.tieThreshold, 0.01);
    assert.equal(persisted[0]!.policy.weights.duration, 0.8);
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("verification remains disqualifying regardless of configured weights", () => {
  const missing = candidate("no-verify", task("nv", "deepseek", "v4"));
  const configured: CompetitionSettings = {
    minCandidates: 2, maxCandidates: 4, tieThreshold: 1e-9,
    rankingWeights: { verification: 5, diffFocus: 0, retries: 0, cost: 0, duration: 0, delivery: 0 },
  };
  const policy = rankingPolicy({}, configured);
  const result = scoreCandidates("dq", [missing], policy, {
    evaluationId: "dq-eval", createdAt: at(20),
  });
  assert.ok(result.candidates.every((c) => !c.eligible));
  assert.match(result.candidates[0]?.disqualificationReason ?? "", /verification/i);
  assert.equal(result.recommendation, undefined);
});

// --- Competition coordinator tests ---

function makeSourceProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), "forklight-comp-src-"));
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "README.md"), "# Test\n");
  writeFileSync(path.join(root, "src", "main.ts"), "export const x = 1;\n");
  return root;
}

function makeContractSpec(sourceProject: string): TaskSpec {
  return {
    version: 2,
    name: "Test competition contract",
    project: sourceProject,
    provider: {
      name: "deepseek",
      model: "deepseek-v4-flash",
      keychainService: "forklight.deepseek.api-key",
    },
    runtime: {
      name: "claude-code",
      executable: "claude",
      effort: "low",
      maxBudgetUsd: 0.5,
    },
    workspace: { exclude: ["node_modules", ".git", ".forklight", "dist", "build", ".next", ".DS_Store"] },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
    contract: {
      outcome: "Test outcome",
      context: [],
      inScope: [],
      outOfScope: [],
      executionSteps: [],
      deliverables: [],
      modules: [],
      callChain: [],
      scenarios: [],
      risks: [],
      changeBudget: { maxFiles: 8, maxDiffLines: 1000 },
    },
    acceptance: { criteria: ["Tests pass"], commands: ["true"] },
  };
}

function setupCoordinator(sourceProject?: string): {
  store: StateStore;
  settings: SettingsService;
  coordinator: CompetitionCoordinator;
  sourceProject: string;
  home: string;
  cleanup: () => void;
} {
  const src = sourceProject ?? makeSourceProject();
  const home = mkdtempSync(path.join(tmpdir(), "forklight-comp-test-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const coordinator = new CompetitionCoordinator(store, settings);
  return {
    store,
    settings,
    coordinator,
    sourceProject: src,
    home,
    cleanup: () => {
      store.close();
      rmSync(home, { recursive: true, force: true });
      rmSync(src, { recursive: true, force: true });
    },
  };
}

test("coordinator rejects all-or-nothing: duplicate candidates, blank model, count limits, budget over max", async () => {
  const { coordinator, cleanup } = setupCoordinator();
  try {
    const baseSpec = makeContractSpec("/nonexistent");
    const valid: CandidateOverride[] = [
      { providerName: "deepseek", modelName: "v4" },
      { providerName: "minimax", modelName: "m3" },
    ];

    // Too few candidates
    await assert.rejects(
      () => coordinator.create(baseSpec, "/test.yaml", [{ providerName: "deepseek", modelName: "v4" }]),
      /at least/,
    );

    // Too many candidates (default maxCandidates = 4)
    const many = Array.from({ length: 5 }, (_, i) => ({
      providerName: "deepseek" as const,
      modelName: `m${i}`,
    }));
    await assert.rejects(() => coordinator.create(baseSpec, "/test.yaml", many), /at most/);

    // Duplicate candidates
    await assert.rejects(
      () =>
        coordinator.create(baseSpec, "/test.yaml", [
          { providerName: "deepseek", modelName: "v4" },
          { providerName: "deepseek", modelName: "v4" },
        ]),
      /Duplicate/,
    );

    // Empty provider name
    await assert.rejects(
      () =>
        coordinator.create(baseSpec, "/test.yaml", [
          { providerName: "", modelName: "x" },
          valid[0]!,
        ]),
      /nonempty/,
    );

    // Blank (whitespace) model name
    await assert.rejects(
      () =>
        coordinator.create(baseSpec, "/test.yaml", [
          { providerName: "deepseek", modelName: "  " },
          valid[0]!,
        ]),
      /nonempty/,
    );

    // Unsupported provider
    await assert.rejects(
      () =>
        coordinator.create(baseSpec, "/test.yaml", [
          { providerName: "not-a-provider", modelName: "gpt-4" },
          valid[0]!,
        ]),
      /Unsupported provider/,
    );

    // openai is a real provider but legacy candidates share the parent
    // claude-code runtime, so the pairing must fail closed with a clear reason.
    await assert.rejects(
      () =>
        coordinator.create(baseSpec, "/test.yaml", [
          { providerName: "openai", modelName: "gpt-5.6-luna" },
          valid[0]!,
        ]),
      /codex-cli/,
    );

    // Budget above maximum (default maximumBudgetUsd = 20)
    await assert.rejects(
      () =>
        coordinator.create(baseSpec, "/test.yaml", [
          { providerName: "deepseek", modelName: "v4", maxBudgetUsd: 999 },
          valid[0]!,
        ]),
      /exceeds configured maximum/,
    );
  } finally {
    cleanup();
  }
});

// --- Delivery factor and completion-policy competition tests ---

function verificationWithPolicy(
  passed: boolean,
  filesChanged = 1,
  changedLines = 20,
  completionPolicy?: import("../src/core/types.js").CompletionPolicyCheck,
): VerificationResult {
  return {
    passed,
    behaviorPassed: passed,
    policyPassed: passed,
    sourceCompatible: true,
    commands: [
      { command: "npm test", exitCode: passed ? 0 : 1, stdout: "", stderr: "", durationMs: 1, timedOut: false },
    ],
    diffPath: "/diff",
    sourceUnchanged: true,
    changeBudget: {
      filesChanged,
      changedLines,
      maxFiles: 10,
      maxDiffLines: 200,
      withinBudget: passed,
    },
    ...(completionPolicy === undefined ? {} : { completionPolicy }),
  };
}

test("legacy zero-diff editable candidate is ineligible and cannot be recommended", () => {
  // This mimics the real MiniMax-M3 regression: verification passed (commands
  // succeeded against unchanged workspace), but no files changed and the
  // completionPolicy field is absent (legacy record).
  const zeroDiff = candidate(
    "minimax-zero",
    task("minimax-task", "minimax", "m3", "succeeded", 10),
    // Legacy verification: passed=true, but zero changes and no completionPolicy
    {
      passed: true,
      behaviorPassed: true,
      policyPassed: true,
      sourceCompatible: true,
      commands: [{ command: "npm test", exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false }],
      diffPath: "/diff",
      sourceUnchanged: true,
      changeBudget: {
        filesChanged: 0,
        changedLines: 0,
        maxFiles: 10,
        maxDiffLines: 200,
        withinBudget: true,
      },
      // completionPolicy intentionally absent (legacy)
    },
    [attempt("minimax-task", 1, 0.1)],
  );
  const realDelivery = candidate(
    "deepseek-real",
    task("deepseek-task", "deepseek", "v4", "succeeded", 15),
    verification(true, 3, 80),
    [attempt("deepseek-task", 1, 0.2)],
  );
  const result = scoreCandidates("zero-diff-regression", [zeroDiff, realDelivery], DEFAULT_RANKING_POLICY, {
    evaluationId: "regression-eval",
    createdAt: new Date().toISOString(),
  });

  // MiniMax zero-diff must be ineligible
  const minimaxScore = result.candidates.find((c) => c.candidateId === "minimax-zero");
  assert.ok(minimaxScore, "MiniMax candidate should exist");
  assert.equal(minimaxScore.eligible, false);
  assert.match(minimaxScore.disqualificationReason ?? "", /No workspace changes/);

  // DeepSeek with real delivery must win
  const deepseekScore = result.candidates.find((c) => c.candidateId === "deepseek-real");
  assert.ok(deepseekScore, "DeepSeek candidate should exist");
  assert.equal(deepseekScore.eligible, true);

  // Recommendation must be DeepSeek, not MiniMax
  assert.equal(result.recommendation?.candidateId, "deepseek-real");
});

test("score-mode no-change candidate receives delivery penalty while changed candidate gets full credit", () => {
  const scoreNoChangeCp: import("../src/core/types.js").CompletionPolicyCheck = {
    check: "score-evidence",
    noChangeMode: "score",
    message: "No workspace changes detected; recorded as scoring penalty evidence",
  };
  const noChange = candidate(
    "score-nochange",
    task("sc-nc", "minimax", "m3", "succeeded", 10),
    verificationWithPolicy(true, 0, 0, scoreNoChangeCp),
    [attempt("sc-nc", 1, 0.1)],
  );
  const changed = candidate(
    "score-changed",
    task("sc-ch", "deepseek", "v4", "succeeded", 10),
    verificationWithPolicy(true, 2, 40, {
      check: "satisfied",
      noChangeMode: "score",
      message: "Worker delivered changes: 2 file(s), 40 line(s)",
    }),
    [attempt("sc-ch", 1, 0.1)],
  );
  const result = scoreCandidates("score-mode", [noChange, changed], DEFAULT_RANKING_POLICY, {
    evaluationId: "score-eval",
    createdAt: new Date().toISOString(),
  });

  // Both are eligible
  assert.equal(result.candidates.every((c) => c.eligible), true);

  // No-change candidate has delivery penalty (rawValue=0)
  const ncScore = result.candidates.find((c) => c.candidateId === "score-nochange")!;
  const ncDelivery = ncScore.factors.find((f) => f.factor === "delivery")!;
  assert.equal(ncDelivery.available, true);
  assert.equal(ncDelivery.rawValue, 0);
  assert.equal(ncDelivery.weightedScore, 0);

  // Changed candidate has full delivery credit
  const chScore = result.candidates.find((c) => c.candidateId === "score-changed")!;
  const chDelivery = chScore.factors.find((f) => f.factor === "delivery")!;
  assert.equal(chDelivery.available, true);
  assert.equal(chDelivery.rawValue, 1);
  assert.equal(chDelivery.weightedScore, DEFAULT_RANKING_POLICY.weights.delivery);

  // Changed candidate wins
  assert.equal(result.recommendation?.candidateId, "score-changed");
});

test("hard-mode no-change is ineligible through completion policy", () => {
  const hardNoChangeCp: import("../src/core/types.js").CompletionPolicyCheck = {
    check: "hard-fail",
    noChangeMode: "hard",
    message: "No workspace changes detected after editable Worker completed",
  };
  const noChange = candidate(
    "hard-nochange",
    task("h-nc", "minimax", "m3", "succeeded", 10),
    verificationWithPolicy(true, 0, 0, hardNoChangeCp),
    [attempt("h-nc", 1, 0.1)],
  );
  const result = scoreCandidates("hard-mode", [noChange], DEFAULT_RANKING_POLICY, {
    evaluationId: "hard-eval",
    createdAt: new Date().toISOString(),
  });

  assert.equal(result.candidates[0]?.eligible, false);
  assert.match(result.candidates[0]?.disqualificationReason ?? "", /No workspace changes/);
  assert.equal(result.recommendation, undefined);
});

test("warn-mode no-change is eligible but delivery factor is non-scoring", () => {
  const warnNoChangeCp: import("../src/core/types.js").CompletionPolicyCheck = {
    check: "warning",
    noChangeMode: "warn",
    message: "Warning: No workspace changes detected after editable Worker completed",
  };
  const noChange = candidate(
    "warn-nochange",
    task("w-nc", "minimax", "m3", "succeeded", 10),
    verificationWithPolicy(true, 0, 0, warnNoChangeCp),
    [attempt("w-nc", 1, 0.1)],
  );
  const changed = candidate(
    "warn-changed",
    task("w-ch", "deepseek", "v4", "succeeded", 10),
    verificationWithPolicy(true, 1, 10, {
      check: "satisfied",
      noChangeMode: "warn",
      message: "Worker delivered changes: 1 file(s), 10 line(s)",
    }),
    [attempt("w-ch", 1, 0.1)],
  );
  const result = scoreCandidates("warn-mode", [noChange, changed], DEFAULT_RANKING_POLICY, {
    evaluationId: "warn-eval",
    createdAt: new Date().toISOString(),
  });

  // Both eligible
  assert.equal(result.candidates.every((c) => c.eligible), true);

  // No-change delivery is non-scoring (available=false)
  const ncScore = result.candidates.find((c) => c.candidateId === "warn-nochange")!;
  const ncDelivery = ncScore.factors.find((f) => f.factor === "delivery")!;
  assert.equal(ncDelivery.available, false);
  assert.equal(ncDelivery.weightedScore, 0);

  // Warn mode is evidence-only for both candidates; it never changes ranking.
  const chScore = result.candidates.find((c) => c.candidateId === "warn-changed")!;
  const chDelivery = chScore.factors.find((f) => f.factor === "delivery")!;
  assert.equal(chDelivery.available, true);
  assert.equal(chDelivery.rawValue, 1);
  assert.equal(chDelivery.weight, 0);
  assert.equal(chDelivery.weightedScore, 0);
});

test("read-only task delivery is not-applicable", () => {
  const roCp: import("../src/core/types.js").CompletionPolicyCheck = {
    check: "not-applicable",
    noChangeMode: "hard",
    message: "Read-only Task; no-change delivery policy does not apply",
  };
  const roTask = candidate(
    "readonly",
    task("ro", "deepseek", "v4", "succeeded", 10),
    verificationWithPolicy(true, 0, 0, roCp),
    [attempt("ro", 1, 0.1)],
  );
  const result = scoreCandidates("ro-comp", [roTask], DEFAULT_RANKING_POLICY, {
    evaluationId: "ro-eval",
    createdAt: new Date().toISOString(),
  });

  assert.equal(result.candidates[0]?.eligible, true);
  const delivery = result.candidates[0]?.factors.find((f) => f.factor === "delivery");
  assert.equal(delivery?.available, false);
  assert.match(delivery?.evidence ?? "", /does not apply/);
});

test("off-mode no-change is eligible and cannot affect ranking", () => {
  const noChange = candidate(
    "off-nochange",
    task("off-nc", "minimax", "m3", "succeeded", 10),
    verificationWithPolicy(true, 0, 0, {
      check: "ignored",
      noChangeMode: "off",
      message: "No workspace changes detected; no-change policy is off",
    }),
    [attempt("off-nc", 1, 0.1)],
  );
  const result = scoreCandidates("off-mode", [noChange], DEFAULT_RANKING_POLICY, {
    evaluationId: "off-eval",
    createdAt: new Date().toISOString(),
  });

  assert.equal(result.candidates[0]?.eligible, true);
  const delivery = result.candidates[0]?.factors.find((factor) => factor.factor === "delivery");
  assert.equal(delivery?.available, false);
  assert.equal(delivery?.weight, 0);
  assert.equal(delivery?.weightedScore, 0);
});

test("legacy ranking policy without delivery weight is normalized safely", () => {
  const changed = candidate(
    "legacy-policy",
    task("legacy-policy-task", "deepseek", "v4", "succeeded", 10),
    verificationWithPolicy(true, 1, 10, {
      check: "satisfied",
      noChangeMode: "score",
      message: "Worker delivered changes: 1 file(s), 10 line(s)",
    }),
    [attempt("legacy-policy-task", 1, 0.1)],
  );
  const legacyPolicy = {
    weights: {
      verification: 1,
      diffFocus: 0.3,
      retries: 0.2,
      cost: 0,
      duration: 0,
    },
    tieThreshold: 1e-9,
  } as unknown as import("../src/core/types.js").RankingPolicy;
  const result = scoreCandidates("legacy-policy", [changed], legacyPolicy, {
    evaluationId: "legacy-policy-eval",
    createdAt: new Date().toISOString(),
  });

  assert.equal(result.policy.weights.delivery, DEFAULT_RANKING_POLICY.weights.delivery);
  const delivery = result.candidates[0]?.factors.find((factor) => factor.factor === "delivery");
  assert.equal(delivery?.weight, DEFAULT_RANKING_POLICY.weights.delivery);
});

test("delivery factor is configurable through ranking policy override", () => {
  const changed = candidate(
    "c1",
    task("c1-task", "deepseek", "v4", "succeeded", 10),
    verificationWithPolicy(true, 2, 50, {
      check: "satisfied",
      noChangeMode: "score",
      message: "Worker delivered changes: 2 file(s), 50 line(s)",
    }),
    [attempt("c1-task", 1, 0.1)],
  );
  // Use a policy with elevated delivery weight
  const policy = rankingPolicy({ delivery: 1.5 });
  const result = scoreCandidates("delivery-weight", [changed], policy, {
    evaluationId: "dw-eval",
    createdAt: new Date().toISOString(),
  });

  const delivery = result.candidates[0]?.factors.find((f) => f.factor === "delivery");
  assert.equal(delivery?.weight, 1.5);
  assert.equal(delivery?.weightedScore, 1.5);
  assert.equal(result.policy.weights.delivery, 1.5);
});

test("coordinator rejects all-or-nothing without persisting any task, event, competition, or workspace directory", async () => {
  const { coordinator, store, home, cleanup } = setupCoordinator();
  try {
    const baseSpec = makeContractSpec("/nonexistent");

    await assert.rejects(
      () =>
        coordinator.create(baseSpec, "/test.yaml", [
          { providerName: "deepseek", modelName: "v4" },
          { providerName: "deepseek", modelName: "v4" }, // duplicate
        ]),
      /Duplicate/,
    );

    // Nothing persisted
    assert.equal(store.listTasks().length, 0);
    assert.equal(store.listCompetitions().length, 0);

    // No task workspaces created under runs/
    const runsDir = path.join(home, "runs");
    assert.equal(existsSync(runsDir) ? readdirSync(runsDir).length : 0, 0);

    // No competition snapshot directory
    const compDir = path.join(home, "competitions");
    assert.equal(existsSync(compDir) ? readdirSync(compDir).length : 0, 0);
  } finally {
    cleanup();
  }
});

test("coordinator creates byte-equivalent isolated candidates from one snapshot with cross-provider config", async () => {
  const src = makeSourceProject();
  const { coordinator, store, cleanup } = setupCoordinator(src);
  try {
    const baseSpec = makeContractSpec(src);
    const candidates: CandidateOverride[] = [
      { providerName: "deepseek", modelName: "deepseek-v4-flash" },
      { providerName: "minimax", modelName: "MiniMax-M3" },
    ];

    const { competition, taskIds } = await coordinator.create(baseSpec, "/test.yaml", candidates);

    // Competition persisted
    const stored = store.getCompetition(competition.id);
    assert.equal(stored.status, "running");
    assert.equal(stored.name, "Competition: Test competition contract");
    assert.ok(stored.rankingPolicy.weights.verification > 0);
    assert.ok(typeof stored.rankingPolicy.tieThreshold === "number");

    // Two candidates
    const storedCandidates = store.getCompetitionCandidates(competition.id);
    assert.equal(storedCandidates.length, 2);
    assert.equal(storedCandidates[0]!.providerName, "deepseek");
    assert.equal(storedCandidates[0]!.modelName, "deepseek-v4-flash");
    assert.equal(storedCandidates[1]!.providerName, "minimax");
    assert.equal(storedCandidates[1]!.modelName, "MiniMax-M3");

    // Two tasks
    assert.equal(taskIds.length, 2);
    const task1 = store.getTask(taskIds[0]!);
    const task2 = store.getTask(taskIds[1]!);
    assert.equal(task1.effectivePolicy?.profileId, "global");
    assert.equal(task2.effectivePolicy?.profileId, "global");

    // Different sessions, baselines, workspaces
    assert.notEqual(task1.sessionId, task2.sessionId);
    assert.notEqual(task1.paths.root, task2.paths.root);
    assert.notEqual(task1.paths.baseline, task2.paths.baseline);
    assert.notEqual(task1.paths.workspace, task2.paths.workspace);

    // Same immutable contract content (except provider-specific overrides)
    assert.equal(task1.spec.name, task2.spec.name);
    assert.equal(task1.spec.version, task2.spec.version);
    assert.notEqual(task1.spec.provider.name, task2.spec.provider.name);
    assert.notEqual(task1.spec.provider.model, task2.spec.provider.model);

    // Cross-provider: each candidate gets its own endpoint and keychain
    // deepseek defaults
    const dsDef = (await import("../src/core/providers.js")).providerDefinition("deepseek");
    assert.equal(task1.spec.provider.endpoint, dsDef.defaultEndpoint);
    assert.equal(task1.spec.provider.keychainService, dsDef.defaultKeychainService);
    // minimax defaults
    const mmDef = (await import("../src/core/providers.js")).providerDefinition("minimax");
    assert.equal(task2.spec.provider.endpoint, mmDef.defaultEndpoint);
    assert.equal(task2.spec.provider.keychainService, mmDef.defaultKeychainService);

    // Byte-equivalent source manifests
    const { readFile } = await import("node:fs/promises");
    const manifest1 = JSON.parse(
      await readFile(path.join(task1.paths.root, "source-manifest.json"), "utf8"),
    );
    const manifest2 = JSON.parse(
      await readFile(path.join(task2.paths.root, "source-manifest.json"), "utf8"),
    );
    const cmpManifest = { files: manifest1.files, skippedSymlinks: manifest1.skippedSymlinks };
    assert.deepEqual(cmpManifest, {
      files: manifest2.files,
      skippedSymlinks: manifest2.skippedSymlinks,
    });
    assert.ok(manifest1.files.length >= 2, "Expected at least 2 source files");

    // Workspaces exist on disk
    const { lstatSync } = await import("node:fs");
    assert.ok(lstatSync(task1.paths.workspace).isDirectory());
    assert.ok(lstatSync(task2.paths.workspace).isDirectory());

    // Workspace context files are generated
    assert.ok(
      lstatSync(path.join(task1.paths.workspace, ".forklight", "workspace-context.md")).isFile(),
    );

    // Events persisted atomically
    const events1 = store.listEvents(taskIds[0]!);
    assert.ok(events1.some((e) => e.type === "task.created"));
    assert.ok(events1.some((e) => e.type === "workspace.prepared"));
  } finally {
    cleanup();
  }
});

test("competition candidates rebuild Provider identity without inheriting source billing fields", async () => {
  const src = makeSourceProject();
  const { coordinator, store, settings, cleanup } = setupCoordinator(src);
  try {
    const baseSpec = makeContractSpec(src);
    const sourceSpec: TaskSpec = {
      ...baseSpec,
      provider: {
        ...baseSpec.provider,
        name: "volcengine",
        model: "glm-5.2[1M]",
        keychainService: "forklight.volcengine.api-key",
        keychainAccount: "source-only-account",
        pricingRoute: "volcengine-coding-plan-subscription",
      },
    };
    const sourceBefore = structuredClone(sourceSpec);

    const { competition } = await coordinator.create(sourceSpec, "/test.yaml", [
      { providerName: "deepseek", modelName: "deepseek-v4-flash" },
      { providerName: "minimax", modelName: "MiniMax-M3" },
      { providerName: "volcengine", modelName: "glm-5.2[1M]" },
    ]);

    assert.deepEqual(sourceSpec, sourceBefore, "candidate cloning must not mutate the source spec");
    const defaults = settings.get();
    for (const record of store.getCompetitionCandidates(competition.id)) {
      const provider = store.getTask(record.taskId).spec.provider;
      const expected = defaults.providerDefaults[provider.name];
      assert.deepEqual(Object.keys(provider).sort(), ["endpoint", "keychainService", "model", "name"]);
      assert.equal(provider.name, record.providerName);
      assert.equal(provider.model, record.modelName);
      assert.equal(provider.endpoint, expected.defaultEndpoint);
      assert.equal(provider.keychainService, expected.defaultKeychainService);
      assert.equal(provider.pricingRoute, undefined);
      assert.equal(provider.keychainAccount, undefined);
    }
  } finally {
    cleanup();
  }
});

test("candidates clone canonical snapshot after live source changes", async () => {
  const src = makeSourceProject();
  const { coordinator, store, cleanup } = setupCoordinator(src);
  const baseSpec = makeContractSpec(src);
  const candidates: CandidateOverride[] = [
    { providerName: "deepseek", modelName: "v4" },
    { providerName: "minimax", modelName: "m3" },
  ];

  const { taskIds } = await coordinator.create(baseSpec, "/test.yaml", candidates);

  // Now add a file to the live source after competition creation
  writeFileSync(path.join(src, "src", "after-snapshot.ts"), "export const after = 1;\n");

  // Verify that no candidate workspace has this file
  const { readFile } = await import("node:fs/promises");
  for (const taskId of taskIds) {
    const task = store.getTask(taskId);
    const manifest = JSON.parse(
      await readFile(path.join(task.paths.root, "source-manifest.json"), "utf8"),
    ) as { files: Array<{ path: string }> };
    const hasAfterFile = manifest.files.some((f: { path: string }) =>
      f.path.includes("after-snapshot"),
    );
    assert.equal(hasAfterFile, false, `Task ${taskId} should not see post-snapshot file`);
  }
  cleanup();
});

test("coordinator reconciles partial terminal failure, scores exactly once with immutable policy", async () => {
  const src = makeSourceProject();
  const { coordinator, store, cleanup } = setupCoordinator(src);
  try {
    const baseSpec = makeContractSpec(src);
    const candidates: CandidateOverride[] = [
      { providerName: "deepseek", modelName: "v4" },
      { providerName: "minimax", modelName: "m3" },
    ];

    const { competition } = await coordinator.create(baseSpec, "/test.yaml", candidates);
    const storedCandidates = store.getCompetitionCandidates(competition.id);

    // Not all terminal → no scoring
    const before = coordinator.reconcile(competition.id);
    assert.equal(before, undefined);
    assert.equal(store.listCompetitionEvaluations(competition.id).length, 0);

    // Set one candidate to succeeded and one to failed
    store.setTaskStatus(storedCandidates[0]!.taskId, "succeeded", {
      startedAt: at(0), finishedAt: at(5),
    });
    store.setTaskStatus(storedCandidates[1]!.taskId, "failed", {
      startedAt: at(0), finishedAt: at(3),
      error: "Provider unavailable",
    });

    // First reconcile → should score since all terminal
    const evaluation = coordinator.reconcile(competition.id);
    assert.ok(evaluation !== undefined);
    assert.equal(store.listCompetitionEvaluations(competition.id).length, 1);
    assert.equal(evaluation!.competitionId, competition.id);

    // The competition should be completed
    const afterScoring = store.getCompetition(competition.id);
    assert.equal(afterScoring.status, "completed");

    // Second reconcile → should be a no-op (already completed)
    const second = coordinator.reconcile(competition.id);
    assert.equal(second, undefined);
    assert.equal(store.listCompetitionEvaluations(competition.id).length, 1);
  } finally {
    cleanup();
  }
});

test("reconcile uses immutable creation-time rankingPolicy, not later effective settings", async () => {
  const src = makeSourceProject();
  const { coordinator, store, settings, cleanup } = setupCoordinator(src);
  try {
    const baseSpec = makeContractSpec(src);
    const candidates: CandidateOverride[] = [
      { providerName: "deepseek", modelName: "v4" },
      { providerName: "minimax", modelName: "m3" },
    ];

    // Create with speed-oriented policy at creation time
    const customTieThreshold = 0.99;
    settings.update({
      competition: { tieThreshold: customTieThreshold },
    });

    const { competition } = await coordinator.create(baseSpec, "/test.yaml", candidates);
    const creationPolicy = store.getCompetition(competition.id).rankingPolicy;
    assert.equal(creationPolicy.tieThreshold, customTieThreshold);

    // Now change settings to a different tieThreshold
    settings.update({
      competition: { tieThreshold: 0.00001 },
    });

    // Set both candidates terminal
    const storedCandidates = store.getCompetitionCandidates(competition.id);
    for (const c of storedCandidates) {
      store.setTaskStatus(c.taskId, "succeeded", {
        startedAt: at(0), finishedAt: at(5),
      });
      const att = attempt(c.taskId, 1, 0.1);
      store.createAttempt(att);
      store.addEvent(c.taskId, att.id, "verification.completed", "ok", verification(true, 1, 10));
    }

    // Reconcile — must use creation-time policy, not current settings
    const evaluation = coordinator.reconcile(competition.id);
    assert.ok(evaluation !== undefined);
    // The evaluation should use the creation-time tieThreshold (0.99), not current (0.00001)
    assert.equal(evaluation!.policy.tieThreshold, customTieThreshold);
  } finally {
    cleanup();
  }
});

test("reconcile persists visible error when scoring fails instead of swallowing it", async () => {
  const src = makeSourceProject();
  const { coordinator, store, settings, cleanup } = setupCoordinator(src);
  try {
    const baseSpec = makeContractSpec(src);
    const candidates: CandidateOverride[] = [
      { providerName: "deepseek", modelName: "v4" },
      { providerName: "minimax", modelName: "m3" },
    ];

    const { competition } = await coordinator.create(baseSpec, "/test.yaml", candidates);

    // Set both terminal, then inject a scorer infrastructure failure.
    const storedCandidates = store.getCompetitionCandidates(competition.id);
    for (const c of storedCandidates) {
      store.setTaskStatus(c.taskId, "succeeded", {
        startedAt: at(0), finishedAt: at(5),
      });
    }

    const failingCoordinator = new CompetitionCoordinator(store, settings, {
      scoreWithPolicy: () => {
        throw new Error("forced scoring infrastructure failure");
      },
    });

    // This should not throw; the failure is durable on the group record.
    const result = failingCoordinator.reconcile(competition.id);
    assert.equal(result, undefined);

    // But competition is still marked completed with visible error
    const after = store.getCompetition(competition.id);
    assert.equal(after.status, "completed");
    assert.ok(after.error, "Expected a visible error on the competition record");
    assert.match(after.error!, /forced scoring infrastructure failure/);
  } finally {
    cleanup();
  }
});

test("coordinator cleans up per-candidate task roots and snapshot on create failure", async () => {
  const src = makeSourceProject();
  const { coordinator, home, cleanup } = setupCoordinator(src);
  try {
    // Use a spec pointing to a non-existent project — buildManifest will fail
    const baseSpec = makeContractSpec("/non-existent-directory-" + Date.now());
    const candidates: CandidateOverride[] = [
      { providerName: "deepseek", modelName: "v4" },
      { providerName: "minimax", modelName: "m3" },
    ];

    await assert.rejects(() => coordinator.create(baseSpec, "/test.yaml", candidates));

    // No task root directories left behind under runs/
    const runsDir = path.join(home, "runs");
    const runEntries = existsSync(runsDir) ? readdirSync(runsDir) : [];
    assert.equal(
      runEntries.length,
      0,
      `Leftover task roots found: ${runEntries.join(", ")}`,
    );

    // No snapshot directory
    const compDir = path.join(home, "competitions");
    const competitionEntries = existsSync(compDir) ? readdirSync(compDir) : [];
    assert.equal(competitionEntries.length, 0);
  } finally {
    cleanup();
  }
});

test("daemon coordinator recovery reconciles already-terminal running competitions", async () => {
  const src = makeSourceProject();
  const { coordinator, store, settings, cleanup } = setupCoordinator(src);
  try {
    const baseSpec = makeContractSpec(src);
    const candidates: CandidateOverride[] = [
      { providerName: "deepseek", modelName: "v4" },
      { providerName: "minimax", modelName: "m3" },
    ];

    const { competition } = await coordinator.create(baseSpec, "/test.yaml", candidates);

    // Set all candidates terminal with verification evidence
    const storedCandidates = store.getCompetitionCandidates(competition.id);
    for (const c of storedCandidates) {
      store.setTaskStatus(c.taskId, "succeeded", {
        startedAt: at(0), finishedAt: at(5),
      });
      const att = attempt(c.taskId, 1, 0.1);
      store.createAttempt(att);
      store.addEvent(c.taskId, att.id, "verification.completed", "ok", verification(true));
    }

    // Simulate daemon recovery — should reconcile the running competition
    const { DaemonCoordinator } = await import("../src/daemon/coordinator.js");
    const daemon = new DaemonCoordinator(store, settings);
    await daemon.recover();

    // Competition should now be completed with an evaluation
    const after = store.getCompetition(competition.id);
    assert.equal(after.status, "completed");
    const evals = store.listCompetitionEvaluations(competition.id);
    assert.equal(evals.length, 1);
  } finally {
    cleanup();
  }
});

// --- Reasoned mixed-runtime Competition admission and Main judgment ---

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function seedGrokBuilderProfile(settings: SettingsService): void {
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

const REASONED_OPTIONS = {
  reason: {
    intent: "required" as const,
    triggers: ["user-requested" as const],
    note: "Critical task with two plausible solutions; worth a bounded second run.",
  },
};

/** Seed three launchable Profiles with distinct network policies: direct,
 *  custom-proxy, and legacy inherit (no policy field). */
function seedNetworkProfiles(settings: SettingsService): void {
  const current = settings.get();
  const profiles = upsertWorkerProfile(
    upsertWorkerProfile(
      upsertWorkerProfile(
        current.workerProfiles,
        {
          id: "net-direct",
          label: "Net Direct",
          runtime: "claude-code",
          provider: "deepseek",
          model: "deepseek-v4-flash",
          effort: "medium",
          networkPolicy: { mode: "direct" },
        },
      ),
      {
        id: "net-proxy",
        label: "Net Proxy",
        runtime: "claude-code",
        provider: "minimax",
        model: "MiniMax-M3",
        effort: "medium",
        networkPolicy: {
          mode: "custom-proxy",
          httpProxy: "http://127.0.0.1:7890",
          httpsProxy: "http://127.0.0.1:7891",
          noProxy: "localhost,127.0.0.1",
        },
      },
    ),
    {
      id: "net-inherit",
      label: "Net Inherit",
      runtime: "claude-code",
      provider: "volcengine",
      model: "glm-5.2[1M]",
      effort: "medium",
    },
  );
  settings.update({ workerProfiles: profiles });
}

/** Simulate a terminal candidate with verification, optional revision, and an
 *  optional bound Main Review. Mirrors how the daemon records real evidence. */
function completeCandidate(
  store: StateStore,
  task: TaskRecord,
  opts: {
    passed?: boolean;
    withRevision?: boolean;
    review?: "accept" | "revise" | "reject";
  } = {},
): { attemptId: string } {
  const passed = opts.passed ?? true;
  const attemptId = randomUUID();
  const attempt: AttemptRecord = {
    id: attemptId,
    taskId: task.id,
    ordinal: 1,
    status: "succeeded",
    sessionId: task.sessionId,
    rawLogPath: "/log",
    startedAt: at(0),
    finishedAt: at(5),
  };
  store.createAttempt(attempt);
  store.setTaskStatus(task.id, "succeeded", {
    currentAttemptId: attemptId,
    startedAt: at(0),
    finishedAt: at(5),
  });
  const ev = store.addEvent(
    task.id,
    attemptId,
    "verification.completed",
    passed ? "Independent verification passed" : "Independent verification failed",
    verification(passed),
  );
  if (opts.withRevision) {
    mkdirSync(path.dirname(task.paths.diff), { recursive: true });
    const diffContent = "diff --git a/readme.md b/readme.md\n@@ -1 +1,2 @@\n-old\n+new\n";
    writeFileSync(task.paths.diff, diffContent);
    const revisionId = randomUUID();
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
        patchDigest: sha256(diffContent),
        affectedPaths: ["readme.md"],
        filesChanged: 1,
        changedLines: 2,
        verificationPassed: passed,
        createdAt: at(6),
        privateArtifactPath: path.join(task.paths.root, "revisions", `${revisionId}.patch`),
      },
    );
  }
  if (opts.review !== undefined) {
    recordMainReview(store, task.id, {
      decision: opts.review,
      reason: "test Main review",
      confirm: true,
    });
  }
  return { attemptId };
}

test("validateCompetitionReason bounds intent, triggers, and note", () => {
  const reason = validateCompetitionReason({
    intent: "required",
    triggers: ["user-requested", "user-requested", "critical"],
    note: "  worth it  ",
  });
  assert.equal(reason.intent, "required");
  assert.deepEqual(reason.triggers, ["user-requested", "critical"]);
  assert.equal(reason.note, "worth it");
  assert.throws(() => validateCompetitionReason({ intent: "maybe", triggers: ["user-requested"], note: "x" }), /consider or required/);
  assert.throws(() => validateCompetitionReason({ intent: "none", triggers: ["user-requested"], note: "x" }), /consider or required/);
  assert.throws(() => validateCompetitionReason({ intent: "required", triggers: ["bogus"], note: "x" }), /unsupported/);
  assert.throws(() => validateCompetitionReason({ intent: "required", triggers: [], note: "x" }), /at least one explicit trigger/);
  assert.throws(() => validateCompetitionReason({ intent: "required", triggers: ["user-requested"], note: "" }), /note/);
});

test("mixed-runtime competition freezes each candidate's own Worker identity from its Profile", async () => {
  const src = makeSourceProject();
  const { coordinator, store, settings, cleanup } = setupCoordinator(src);
  try {
    seedGrokBuilderProfile(settings);
    const baseSpec = makeContractSpec(src);
    const candidates: CandidateOverride[] = [
      { workerProfileId: "default" },
      { workerProfileId: "grok-builder" },
    ];

    const { competition } = await coordinator.create(baseSpec, "/test.yaml", candidates, REASONED_OPTIONS);
    const stored = store.getCompetition(competition.id);
    assert.equal(stored.legacy, undefined);
    assert.equal(stored.reason?.intent, "required");
    assert.equal(stored.reason?.note, REASONED_OPTIONS.reason.note);

    const storedCandidates = store.getCompetitionCandidates(competition.id);
    assert.equal(storedCandidates.length, 2);
    const claude = storedCandidates.find((c) => c.identity?.runtime === "claude-code")!;
    const grok = storedCandidates.find((c) => c.identity?.runtime === "grok-build")!;
    assert.ok(claude, "expected a claude-code candidate");
    assert.ok(grok, "expected a grok-build candidate");
    assert.equal(grok.identity?.provider, "xai");
    assert.equal(grok.identity?.effort, "high");
    assert.equal(claude.identity?.provider, "deepseek");
    assert.equal(claude.identity?.workerProfileId, "default");

    // Each candidate Task keeps its own runtime, not the parent's.
    const claudeTask = store.getTask(claude.taskId);
    const grokTask = store.getTask(grok.taskId);
    assert.equal(claudeTask.spec.runtime.name, "claude-code");
    assert.equal(grokTask.spec.runtime.name, "grok-build");
    assert.equal(grokTask.spec.provider.name, "xai");
  } finally {
    cleanup();
  }
});

test("Worker-Profile Competition candidates each freeze their own network policy", async () => {
  const src = makeSourceProject();
  const { coordinator, store, settings, cleanup } = setupCoordinator(src);
  try {
    seedNetworkProfiles(settings);
    const baseSpec = makeContractSpec(src);
    // Source contract carries a frozen inherit policy that must never win.
    const sourceSpec: TaskSpec = { ...baseSpec, networkPolicy: { mode: "inherit" } };
    const sourceBefore = structuredClone(sourceSpec);

    const { competition } = await coordinator.create(sourceSpec, "/test.yaml", [
      { workerProfileId: "net-direct" },
      { workerProfileId: "net-proxy" },
      { workerProfileId: "net-inherit" },
    ], REASONED_OPTIONS);

    // Candidate cloning must not mutate the source contract.
    assert.deepEqual(sourceSpec, sourceBefore);

    const candidates = store.getCompetitionCandidates(competition.id);
    assert.equal(candidates.length, 3);
    const byProfile = new Map(candidates.map((c) => [c.identity?.workerProfileId, c]));

    const direct = store.getTask(byProfile.get("net-direct")!.taskId);
    const proxy = store.getTask(byProfile.get("net-proxy")!.taskId);
    const inherit = store.getTask(byProfile.get("net-inherit")!.taskId);

    // Each candidate freezes its own Profile policy.
    assert.deepEqual(direct.spec.networkPolicy, { mode: "direct" });
    assert.deepEqual(proxy.spec.networkPolicy, {
      mode: "custom-proxy",
      httpProxy: "http://127.0.0.1:7890",
      httpsProxy: "http://127.0.0.1:7891",
      noProxy: "localhost,127.0.0.1",
    });

    // Neither inherits the source contract's policy.
    assert.equal(direct.spec.networkPolicy?.mode, "direct");
    assert.equal(proxy.spec.networkPolicy?.mode, "custom-proxy");
    // Legacy-inherit candidate clears the cloned source policy (absence = inherit).
    assert.equal(inherit.spec.networkPolicy, undefined);

    // Creation events never serialize proxy values.
    const eventText = [direct.id, proxy.id, inherit.id]
      .flatMap((taskId) => store.listEvents(taskId))
      .map((event) => JSON.stringify(event.payload))
      .join("\n");
    assert.ok(!eventText.includes("127.0.0.1:7890"));
    assert.ok(!eventText.includes("httpProxy"));
    assert.ok(!eventText.includes("noProxy"));
  } finally {
    cleanup();
  }
});

test("cross-Worker handoff freezes destination network policy and clears stale source policy", async () => {
  const src = makeTwoFileSourceProject();
  const { store, settings, cleanup } = setupCoordinator(src);
  try {
    seedNetworkProfiles(settings);
    const coordinator = new CompetitionCoordinator(store, settings);
    const baseSpec = makeContractSpec(src);
    const { competition } = await coordinator.create(baseSpec, "/test.yaml", [
      { workerProfileId: "net-direct" },
      { workerProfileId: "net-proxy" },
    ], {
      ...REASONED_OPTIONS,
      readinessVerifier: () => {},
    });
    const candidates = store.getCompetitionCandidates(competition.id);
    const source = candidates.find((c) => c.identity?.workerProfileId === "net-direct")!;
    const sourceTask = store.getTask(source.taskId);
    // Source candidate froze direct.
    assert.deepEqual(sourceTask.spec.networkPolicy, { mode: "direct" });

    const { revisionId } = completeTwoFileCandidate(store, sourceTask, { passed: false });
    coordinator.recordRetainedPartial(
      competition.id,
      source.id,
      ["src/a.ts"],
      [{
        description: "src/b.ts still needs the second export completed",
        acceptanceExpectation: "src/b.ts exports the updated constant and acceptance passes",
      }],
    );

    const view = await executeCandidateHandoff(
      store,
      settings.get(),
      {
        competitionId: competition.id,
        candidateId: source.id,
        candidateRevisionId: revisionId,
        destinationWorkerProfileId: "net-proxy",
        reason: "Hand direct candidate to the custom-proxy Worker for the remaining gap.",
        confirm: true,
      },
      { canLaunch: () => ({ ok: true }) },
    );
    assert.equal(view.status, "prepared");

    // Successor freezes the destination custom-proxy policy.
    const successor = store.getTask(view.successorTaskId);
    assert.deepEqual(successor.spec.networkPolicy, {
      mode: "custom-proxy",
      httpProxy: "http://127.0.0.1:7890",
      httpsProxy: "http://127.0.0.1:7891",
      noProxy: "localhost,127.0.0.1",
    });
    // Source Task is not mutated.
    assert.deepEqual(store.getTask(sourceTask.id).spec.networkPolicy, { mode: "direct" });

    // Public handoff projection never exposes proxy values.
    const viewText = JSON.stringify(view);
    assert.ok(!viewText.includes("127.0.0.1:7890"));
    assert.ok(!viewText.includes("httpProxy"));
    assert.ok(!viewText.includes("noProxy"));

    // Pure builder: a legacy-inherit destination removes the stale direct policy.
    const inheritSelection = resolveWorkerSelection(
      { workerProfileId: "net-inherit" },
      {
        execution: settings.get().execution,
        providerDefaults: settings.get().providerDefaults,
        workerProfiles: settings.get().workerProfiles,
        ...(settings.get().modelCatalog === undefined
          ? {}
          : { modelCatalog: settings.get().modelCatalog }),
      },
    );
    const built = buildHandoffSuccessorSpec(store.getTask(sourceTask.id).spec, inheritSelection, {
      reusablePaths: ["src/a.ts"],
      remainingGaps: [{
        description: "src/b.ts still needs the second export completed",
        acceptanceExpectation: "src/b.ts exports the updated constant and acceptance passes",
      }],
      digestPrefix: "abcd1234ef00",
    });
    assert.equal(built.networkPolicy, undefined, "inherit destination must remove the stale direct policy");
  } finally {
    cleanup();
  }
});

test("reasoned admission rejects missing reason, mixed entrance kinds, and unknown profiles before launch", async () => {
  const src = makeSourceProject();
  const { coordinator, settings, cleanup } = setupCoordinator(src);
  try {
    seedGrokBuilderProfile(settings);
    const baseSpec = makeContractSpec(src);

    // New entrance without a reason stops before any workspace preparation.
    await assert.rejects(
      () => coordinator.create(baseSpec, "/test.yaml", [
        { workerProfileId: "default" },
        { workerProfileId: "grok-builder" },
      ]),
      /reason/,
    );

    // Mixed entrance kinds (one Profile, one provider/model) are rejected.
    await assert.rejects(
      () => coordinator.create(baseSpec, "/test.yaml", [
        { workerProfileId: "default" },
        { providerName: "deepseek", modelName: "v4" },
      ], REASONED_OPTIONS),
      /all reference a Worker Profile/,
    );

    // Unknown profile is rejected before launch (readiness).
    await assert.rejects(
      () => coordinator.create(baseSpec, "/test.yaml", [
        { workerProfileId: "default" },
        { workerProfileId: "no-such-profile" },
      ], REASONED_OPTIONS),
      /Unknown worker profile|workerProfileId/,
    );
  } finally {
    cleanup();
  }
});

test("legacy explicit competition is stored reason-unavailable and carries no frozen identity", async () => {
  const src = makeSourceProject();
  const { coordinator, store, cleanup } = setupCoordinator(src);
  try {
    const baseSpec = makeContractSpec(src);
    const { competition } = await coordinator.create(baseSpec, "/test.yaml", [
      { providerName: "deepseek", modelName: "v4" },
      { providerName: "minimax", modelName: "m3" },
    ]);
    const stored = store.getCompetition(competition.id);
    assert.equal(stored.legacy, true);
    assert.equal(stored.reason, undefined);

    for (const c of store.getCompetitionCandidates(competition.id)) {
      assert.equal(c.identity, undefined, "legacy candidates must not carry a frozen identity");
    }
  } finally {
    cleanup();
  }
});

test("Competition Main decision accept derives from the candidate Main Review and sets the exact final choice", async () => {
  const src = makeSourceProject();
  const { coordinator, store, cleanup } = setupCoordinator(src);
  try {
    const baseSpec = makeContractSpec(src);
    const { competition } = await coordinator.create(baseSpec, "/test.yaml", [
      { providerName: "deepseek", modelName: "v4" },
      { providerName: "minimax", modelName: "m3" },
    ]);
    const candidates = store.getCompetitionCandidates(competition.id);
    const chosen = candidates[0]!;
    completeCandidate(store, store.getTask(chosen.taskId), { withRevision: true, review: "accept" });

    const decision = coordinator.recordMainDecision(
      competition.id,
      chosen.id,
      "accept",
      "This exact revision is the final choice.",
    );
    assert.equal(decision.decision, "accept");
    assert.equal(decision.candidateId, chosen.id);
    assert.equal(decision.taskId, chosen.taskId);
    assert.ok(decision.candidateRevisionId, "accept must bind the exact Candidate Revision");
    assert.ok(decision.acceptedPatchDigest, "accept must bind the exact patch digest");

    const stored = store.getCompetition(competition.id);
    assert.equal(stored.mainDecision?.decision, "accept");
    assert.equal(stored.mainDecision?.candidateRevisionId, decision.candidateRevisionId);
  } finally {
    cleanup();
  }
});

test("machine recommendation alone is not a final choice and never auto-integrates", async () => {
  const src = makeSourceProject();
  const { coordinator, store, cleanup } = setupCoordinator(src);
  try {
    const baseSpec = makeContractSpec(src);
    const { competition } = await coordinator.create(baseSpec, "/test.yaml", [
      { providerName: "deepseek", modelName: "v4" },
      { providerName: "minimax", modelName: "m3" },
    ]);
    const candidates = store.getCompetitionCandidates(competition.id);
    completeCandidate(store, store.getTask(candidates[0]!.taskId), { withRevision: false });
    store.setTaskStatus(candidates[1]!.taskId, "failed", {
      startedAt: at(0), finishedAt: at(3), error: "Provider unavailable",
    });
    const evaluation = coordinator.reconcile(competition.id);
    assert.ok(evaluation?.recommendation, "machine comparison should produce a recommendation");

    // No Main decision yet: machine comparison is waiting for Main.
    const stored = store.getCompetition(competition.id);
    assert.equal(stored.mainDecision, undefined);
    // Integration preflight on the recommended candidate must still require Main accept.
    const recommendedTaskId = candidates.find(
      (c) => c.id === evaluation!.recommendation!.candidateId,
    )!.taskId;
    const { preflightIntegration } = await import("../src/core/integration.js");
    const receipt = await preflightIntegration(store, recommendedTaskId, {
      reviewedPatchMaxFiles: 50, reviewedPatchMaxLines: 5000, verificationTimeoutMs: 60_000,
      reviewReceiptTtlMs: 60_000, backupRetentionCount: 1, autoRollback: false,
    } as never);
    assert.ok(
      receipt.rejectionReasons.some((r: string) => /Main agent review acceptance is required/i.test(r)),
      "machine recommendation must not make a candidate integrable without Main accept",
    );
  } finally {
    cleanup();
  }
});

test("retained-partial stores reusable evidence without retrying or handoff", async () => {
  const src = makeSourceProject();
  const { coordinator, store, cleanup } = setupCoordinator(src);
  try {
    const baseSpec = makeContractSpec(src);
    const { competition } = await coordinator.create(baseSpec, "/test.yaml", [
      { providerName: "deepseek", modelName: "v4" },
      { providerName: "minimax", modelName: "m3" },
    ]);
    const candidates = store.getCompetitionCandidates(competition.id);
    const retained = candidates[1]!;
    const retainedTask = store.getTask(retained.taskId);
    // The non-selected candidate failed but left a revision with reusable work.
    completeCandidate(store, retainedTask, { passed: false, withRevision: true });
    store.setTaskStatus(retained.taskId, "failed", { error: "verification failed" });

    const entry = coordinator.recordRetainedPartial(
      competition.id,
      retained.id,
      ["readme.md"],
      [{ description: "Missing edge case for empty input", acceptanceExpectation: "Acceptance command covers empty input" }],
    );
    assert.equal(entry.candidateId, retained.id);
    assert.deepEqual(entry.reusablePaths, ["readme.md"]);
    assert.equal(entry.remainingGaps.length, 1);

    const stored = store.getCompetition(competition.id);
    assert.equal(stored.retainedPartial?.length, 1);
    // The original failure is preserved; no retry or successor started.
    assert.equal(store.getTask(retained.taskId).status, "failed");
  } finally {
    cleanup();
  }
});

test("retained-partial rejects reusable paths not in the candidate revision affected set", async () => {
  const src = makeSourceProject();
  const { coordinator, store, cleanup } = setupCoordinator(src);
  try {
    const baseSpec = makeContractSpec(src);
    const { competition } = await coordinator.create(baseSpec, "/test.yaml", [
      { providerName: "deepseek", modelName: "v4" },
      { providerName: "minimax", modelName: "m3" },
    ]);
    const candidates = store.getCompetitionCandidates(competition.id);
    const retained = candidates[1]!;
    completeCandidate(store, store.getTask(retained.taskId), { passed: false, withRevision: true });
    store.setTaskStatus(retained.taskId, "failed", { error: "verification failed" });

    assert.throws(
      () => coordinator.recordRetainedPartial(
        competition.id,
        retained.id,
        ["not-in-revision.md"],
        [{ description: "Missing edge case for empty input", acceptanceExpectation: "Acceptance command covers empty input" }],
      ),
      /not in the referenced revision affected set/,
    );
  } finally {
    cleanup();
  }
});

test("Competition Main decision requires a matching Task-level Main Review", async () => {
  const src = makeSourceProject();
  const { coordinator, store, cleanup } = setupCoordinator(src);
  try {
    const baseSpec = makeContractSpec(src);
    const { competition } = await coordinator.create(baseSpec, "/test.yaml", [
      { providerName: "deepseek", modelName: "v4" },
      { providerName: "minimax", modelName: "m3" },
    ]);
    const candidates = store.getCompetitionCandidates(competition.id);
    const chosen = candidates[0]!;
    completeCandidate(store, store.getTask(chosen.taskId), { withRevision: true });

    // No Task-level Main Review yet.
    assert.throws(
      () => coordinator.recordMainDecision(competition.id, chosen.id, "accept", "reason"),
      /Main Review on the candidate first/,
    );

    // Record accept, then try revise -> mismatch.
    recordMainReview(store, chosen.taskId, { decision: "accept", reason: "ok", confirm: true });
    assert.throws(
      () => coordinator.recordMainDecision(competition.id, chosen.id, "revise", "reason"),
      /does not match/,
    );
  } finally {
    cleanup();
  }
});

test("exact Competition Main revise authorizes one bounded same-Candidate correction", async () => {
  const src = makeSourceProject();
  const { coordinator, store, cleanup } = setupCoordinator(src);
  try {
    const baseSpec = makeContractSpec(src);
    const { competition } = await coordinator.create(baseSpec, "/test.yaml", [
      { providerName: "deepseek", modelName: "v4" },
      { providerName: "minimax", modelName: "m3" },
    ]);
    const chosen = store.getCompetitionCandidates(competition.id)[0]!;
    completeCandidate(store, store.getTask(chosen.taskId), {
      withRevision: true,
      review: "revise",
    });

    const before = resolveCorrectionEligibility(store, chosen.taskId);
    assert.equal(before.eligible, false);
    assert.equal(before.category, "competition-main-revise-required");

    const decision = coordinator.recordMainDecision(
      competition.id,
      chosen.id,
      "revise",
      "Repair the named gap on this exact Candidate Revision.",
    );
    assert.ok(decision.candidateRevisionId);
    assert.ok(decision.acceptedPatchDigest);

    const eligible = resolveCorrectionEligibility(store, chosen.taskId);
    assert.equal(eligible.eligible, true);
    assert.ok(eligible.latestRevision);
    const execution = authorizeMainCorrection(
      store,
      chosen.taskId,
      {
        feedback: "Repair the named edge case only.",
        maxBudgetUsd: null,
        confirm: true,
        gapContract: {
          schemaVersion: 1,
          candidateRevisionId: eligible.latestRevision!.id,
          reusablePaths: ["readme.md"],
          remainingGaps: [{
            description: "The empty input path is not handled yet.",
            acceptanceExpectation: "The acceptance test covers empty input explicitly.",
          }],
        },
      },
      1,
      1,
    );
    assert.equal(execution.maximumOrdinal, 2);
    assert.equal(store.listAttempts(chosen.taskId).length, 1, "authorization does not start a Worker");

    assert.throws(
      () => authorizeMainCorrection(
        store,
        chosen.taskId,
        {
          feedback: "Try to authorize another correction.",
          maxBudgetUsd: null,
          confirm: true,
          gapContract: {
            schemaVersion: 1,
            candidateRevisionId: eligible.latestRevision!.id,
            reusablePaths: ["readme.md"],
            remainingGaps: [{
              description: "The empty input path is not handled yet.",
              acceptanceExpectation: "The acceptance test covers empty input explicitly.",
            }],
          },
        },
        1,
        1,
      ),
      /conflicts|allowance|pending correction grant/,
    );
  } finally {
    cleanup();
  }
});

test("reasoned admission fails closed on incoherent intent, triggers, legacy reason, and ambiguous candidate fields", async () => {
  const src = makeSourceProject();
  const { coordinator, settings, cleanup } = setupCoordinator(src);
  try {
    seedGrokBuilderProfile(settings);
    const baseSpec = makeContractSpec(src);
    const profileCandidates = [{ workerProfileId: "default" }, { workerProfileId: "grok-builder" }];
    const legacyCandidates = [{ providerName: "deepseek", modelName: "v4" }, { providerName: "minimax", modelName: "m3" }];

    // intent none is not a reasoned admission.
    await assert.rejects(
      () => coordinator.create(baseSpec, "/test.yaml", profileCandidates, {
        reason: { intent: "none", triggers: ["user-requested"], note: "x" },
      }),
      /consider or required/,
    );
    // empty triggers is not a reasoned admission.
    await assert.rejects(
      () => coordinator.create(baseSpec, "/test.yaml", profileCandidates, {
        reason: { intent: "required", triggers: [], note: "x" },
      }),
      /at least one explicit trigger/,
    );
    // legacy provider/model cannot carry a reason.
    await assert.rejects(
      () => coordinator.create(baseSpec, "/test.yaml", legacyCandidates, REASONED_OPTIONS),
      /cannot carry a Main reason/,
    );
    // ambiguous per-candidate Profile plus provider/model fields.
    await assert.rejects(
      () => coordinator.create(baseSpec, "/test.yaml", [
        { workerProfileId: "default", providerName: "deepseek", modelName: "v4" },
        { workerProfileId: "grok-builder" },
      ], REASONED_OPTIONS),
      /not both/,
    );
  } finally {
    cleanup();
  }
});

test("reasoned admission verifies Worker readiness all-or-nothing before workspace preparation", async () => {
  const src = makeSourceProject();
  const { coordinator, store, settings, home, cleanup } = setupCoordinator(src);
  try {
    seedGrokBuilderProfile(settings);
    const baseSpec = makeContractSpec(src);
    const candidates = [{ workerProfileId: "default" }, { workerProfileId: "grok-builder" }];
    // Verifier rejects because grok-builder is not launchable.
    const failingVerifier = (profileIds: readonly string[]) => {
      if (profileIds.includes("grok-builder")) {
        throw new Error("Competition candidate Worker Profile is not launchable: grok-builder (authentication-missing)");
      }
    };
    await assert.rejects(
      () => coordinator.create(baseSpec, "/test.yaml", candidates, {
        ...REASONED_OPTIONS,
        readinessVerifier: failingVerifier,
      }),
      /not launchable/,
    );
    // All-or-nothing: no Task, event, competition, or workspace persisted.
    assert.equal(store.listTasks().length, 0);
    assert.equal(store.listCompetitions().length, 0);
    const runsDir = path.join(home, "runs");
    assert.equal(existsSync(runsDir) ? readdirSync(runsDir).length : 0, 0);
    const compDir = path.join(home, "competitions");
    assert.equal(existsSync(compDir) ? readdirSync(compDir).length : 0, 0);
  } finally {
    cleanup();
  }
});

test("Competition Main accept requires the exact Candidate Revision id and digest", async () => {
  const src = makeSourceProject();
  const { coordinator, store, cleanup } = setupCoordinator(src);
  try {
    const baseSpec = makeContractSpec(src);
    const { competition } = await coordinator.create(baseSpec, "/test.yaml", [
      { providerName: "deepseek", modelName: "v4" },
      { providerName: "minimax", modelName: "m3" },
    ]);
    const candidates = store.getCompetitionCandidates(competition.id);
    const chosen = candidates[0]!;
    // Verified candidate with a Task-level accept but NO Candidate Revision
    // (legacy digest-less accept). Competition accept must fail closed.
    completeCandidate(store, store.getTask(chosen.taskId), { withRevision: false, review: "accept" });
    assert.throws(
      () => coordinator.recordMainDecision(competition.id, chosen.id, "accept", "final choice"),
      /exact Candidate Revision id and patch digest/,
    );
  } finally {
    cleanup();
  }
});

test("retained-partial rejects the final accepted Candidate", async () => {
  const src = makeSourceProject();
  const { coordinator, store, cleanup } = setupCoordinator(src);
  try {
    const baseSpec = makeContractSpec(src);
    const { competition } = await coordinator.create(baseSpec, "/test.yaml", [
      { providerName: "deepseek", modelName: "v4" },
      { providerName: "minimax", modelName: "m3" },
    ]);
    const candidates = store.getCompetitionCandidates(competition.id);
    const chosen = candidates[0]!;
    completeCandidate(store, store.getTask(chosen.taskId), { withRevision: true, review: "accept" });
    coordinator.recordMainDecision(competition.id, chosen.id, "accept", "final choice");
    // The accepted candidate cannot be marked retained-partial.
    assert.throws(
      () => coordinator.recordRetainedPartial(
        competition.id,
        chosen.id,
        ["readme.md"],
        [{ description: "Missing edge case for empty input", acceptanceExpectation: "Acceptance command covers empty input" }],
      ),
      /final accepted Candidate/,
    );
  } finally {
    cleanup();
  }
});

test("Integration preflight for a Competition candidate requires Competition Main accept of the exact revision", async () => {
  const src = makeSourceProject();
  const { coordinator, store, cleanup } = setupCoordinator(src);
  try {
    const baseSpec = makeContractSpec(src);
    const { competition } = await coordinator.create(baseSpec, "/test.yaml", [
      { providerName: "deepseek", modelName: "v4" },
      { providerName: "minimax", modelName: "m3" },
    ]);
    const candidates = store.getCompetitionCandidates(competition.id);
    const chosen = candidates[0]!;
    completeCandidate(store, store.getTask(chosen.taskId), { withRevision: true, review: "accept" });

    const { preflightIntegration } = await import("../src/core/integration.js");
    const integrationSettings = {
      reviewedPatchMaxFiles: 50, reviewedPatchMaxLines: 5000, verificationTimeoutMs: 60_000,
      reviewReceiptTtlMs: 60_000, backupRetentionCount: 1, autoRollback: false,
    } as never;

    // Task-level accept alone is not enough for a Competition candidate.
    const before = await preflightIntegration(store, chosen.taskId, integrationSettings);
    assert.ok(
      before.rejectionReasons.some((r: string) =>
        /Competition Main accept of this exact Candidate Revision is required/i.test(r)),
      "preflight must require Competition Main accept before the Task-level accept can pass",
    );

    // Record the Competition-level accept of the exact revision.
    coordinator.recordMainDecision(competition.id, chosen.id, "accept", "final choice");
    const after = await preflightIntegration(store, chosen.taskId, integrationSettings);
    assert.ok(
      !after.rejectionReasons.some((r: string) =>
        /Competition Main accept of this exact Candidate Revision is required/i.test(r)),
      "the Competition Main accept reason must be cleared once the exact decision is recorded",
    );
  } finally {
    cleanup();
  }
});

test("daemon submitCompetition rejects a non-launchable Profile all-or-nothing before workspace preparation", async () => {
  const src = makeSourceProject();
  const home = mkdtempSync(path.join(tmpdir(), "forklight-comp-ready-"));
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  seedGrokBuilderProfile(settings);
  // Mock inspector reports no readable credentials, so resolveWorkerReadiness
  // blocks every Profile at authentication (before any runtime check), making
  // the verdict deterministic regardless of which runtimes are installed.
  const mockInspector = {
    hasReadableKeychainValue: () => false,
    hasLocalGrokSignIn: () => false,
  } as never;
  const { DaemonCoordinator } = await import("../src/daemon/coordinator.js");
  const daemon = new DaemonCoordinator(store, settings, undefined, mockInspector);
  const baseSpec = makeContractSpec(src);
  try {
    await assert.rejects(
      () => daemon.submitCompetition(baseSpec, "/test.yaml", [
        { workerProfileId: "default" },
        { workerProfileId: "grok-builder" },
      ], REASONED_OPTIONS),
      /not launchable/,
    );
    // All-or-nothing: no Task, competition, or workspace persisted.
    assert.equal(store.listTasks().length, 0);
    assert.equal(store.listCompetitions().length, 0);
    const runsDir = path.join(home, "runs");
    assert.equal(existsSync(runsDir) ? readdirSync(runsDir).length : 0, 0);
    const compDir = path.join(home, "competitions");
    assert.equal(existsSync(compDir) ? readdirSync(compDir).length : 0, 0);
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(src, { recursive: true, force: true });
  }
});

// --- Cross-Worker Candidate handoff ---

function makeTwoFileSourceProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), "forklight-handoff-src-"));
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "README.md"), "# Test\n");
  writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(path.join(root, "src", "b.ts"), "export const b = 1;\n");
  return root;
}

/** Build a realistic two-file Candidate Diff and private artifact for handoff tests. */
function completeTwoFileCandidate(
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
    rawLogPath: "/log",
    startedAt: at(0),
    finishedAt: at(5),
  };
  store.createAttempt(attempt);
  store.setTaskStatus(task.id, passed ? "succeeded" : "failed", {
    currentAttemptId: attemptId,
    startedAt: at(0),
    finishedAt: at(5),
    ...(passed ? {} : { error: "verification failed" }),
  });

  // Candidate workspace final bytes for both changed files.
  mkdirSync(path.join(task.paths.workspace, "src"), { recursive: true });
  writeFileSync(path.join(task.paths.workspace, "src", "a.ts"), "export const a = 2;\n");
  writeFileSync(path.join(task.paths.workspace, "src", "b.ts"), "export const b = 2;\n");
  // Baseline remains original (as prepared from project).
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
    verification(passed),
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
      createdAt: at(6),
      privateArtifactPath: artifactPath,
    },
  );
  return { attemptId, revisionId, patchText };
}

test("filterPatchToSelectedPaths keeps only approved whole-file sections", () => {
  const patch = [
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
  const filtered = filterPatchToSelectedPaths(patch, ["src/a.ts"]);
  assert.ok(filtered.includes("src/a.ts"));
  assert.ok(!filtered.includes("src/b.ts"));
  assert.throws(
    () => filterPatchToSelectedPaths(patch, ["src/missing.ts"]),
    /missing from the exact Candidate Diff/,
  );
});

test("cross-Worker handoff imports only retained path, freezes destination, leaves source immutable", async () => {
  const src = makeTwoFileSourceProject();
  const { store, settings, home, cleanup } = setupCoordinator(src);
  try {
    seedGrokBuilderProfile(settings);
    const coordinator = new CompetitionCoordinator(store, settings);
    const baseSpec = makeContractSpec(src);
    const { competition } = await coordinator.create(baseSpec, "/test.yaml", [
      { workerProfileId: "default" },
      { workerProfileId: "grok-builder" },
    ], {
      ...REASONED_OPTIONS,
      readinessVerifier: () => {},
    });
    const candidates = store.getCompetitionCandidates(competition.id);
    const retained = candidates.find((c) => c.identity?.workerProfileId === "default")
      ?? candidates[0]!;
    const destination = candidates.find((c) => c.id !== retained.id)!;
    const sourceTask = store.getTask(retained.taskId);
    const { revisionId } = completeTwoFileCandidate(store, sourceTask, { passed: false });

    const entry = coordinator.recordRetainedPartial(
      competition.id,
      retained.id,
      ["src/a.ts"],
      [{
        description: "src/b.ts still needs the second export completed",
        acceptanceExpectation: "src/b.ts exports the updated constant and acceptance passes",
      }],
    );
    assert.equal(entry.candidateRevisionId, revisionId);
    assert.deepEqual(entry.reusablePaths, ["src/a.ts"]);

    const sourceBefore = structuredClone(store.getTask(retained.taskId));
    const eventsBefore = store.listEvents(retained.taskId).length;
    const attemptsBefore = store.listAttempts(retained.taskId).length;
    const handoffReason = "Hand retained a.ts work to the Grok builder for the remaining gap.";

    const view = await executeCandidateHandoff(
      store,
      settings.get(),
      {
        competitionId: competition.id,
        candidateId: retained.id,
        candidateRevisionId: revisionId,
        destinationWorkerProfileId: "grok-builder",
        reason: handoffReason,
        confirm: true,
      },
      { canLaunch: () => ({ ok: true }) },
    );

    assert.equal(view.status, "prepared");
    assert.equal(view.originKind, "competition");
    assert.equal(view.competitionId, competition.id);
    assert.equal(view.sourceCandidateId, retained.id);
    assert.equal(view.goalId, undefined);
    assert.equal(view.destinationWorkerProfileId, "grok-builder");
    assert.equal(view.reusablePathCount, 1);
    assert.equal(view.remainingGapCount, 1);
    assert.equal(view.sourceDigestPrefix.length, 12);
    assert.ok(!JSON.stringify(view).includes(path.join(home, "runs")));
    assert.ok(!JSON.stringify(view).includes("export const"));
    const durable = store.getCandidateHandoff(view.id);
    assert.equal(durable.origin.kind, "competition");
    if (durable.origin.kind === "competition") {
      assert.equal(durable.origin.competitionId, competition.id);
      assert.equal(durable.origin.sourceCandidateId, retained.id);
    }

    // Source Task immutable: status, attempts, error unchanged.
    const sourceAfter = store.getTask(retained.taskId);
    assert.equal(sourceAfter.status, sourceBefore.status);
    assert.equal(sourceAfter.error, sourceBefore.error);
    assert.equal(store.listAttempts(retained.taskId).length, attemptsBefore);
    assert.ok(store.listEvents(retained.taskId).length > eventsBefore); // audit only

    // Successor uses destination identity, not source.
    const successor = store.getTask(view.successorTaskId);
    assert.equal(successor.status, "queued");
    assert.equal(successor.spec.workerProfileId, "grok-builder");
    assert.equal(successor.spec.provider.name, "xai");
    assert.equal(successor.spec.runtime.name, "grok-build");
    assert.notEqual(successor.id, retained.taskId);
    // Destination instruction carries the retained path and remaining gap text.
    assert.equal(successor.spec.version, 2);
    if (successor.spec.version === 2) {
      const promptSurface = [
        ...successor.spec.contract.context,
        ...successor.spec.contract.inScope,
        ...successor.spec.contract.executionSteps,
      ].join("\n");
      assert.ok(promptSurface.includes("src/a.ts"));
      assert.ok(promptSurface.includes("src/b.ts still needs the second export completed"));
      assert.ok(promptSurface.includes("src/b.ts exports the updated constant and acceptance passes"));
      assert.ok(!promptSurface.includes("revisions/"));
      assert.ok(!promptSurface.includes(sourceTask.paths.root));
    }

    // Selected-path-only import with byte proof.
    assert.equal(
      readFileSync(path.join(successor.paths.workspace, "src", "a.ts"), "utf8"),
      "export const a = 2;\n",
    );
    assert.equal(
      readFileSync(path.join(successor.paths.workspace, "src", "b.ts"), "utf8"),
      "export const b = 1;\n",
      "non-reusable Candidate path must remain absent as a Candidate change",
    );
    // Baseline is clean current project so final Diff can include retained + new work.
    assert.equal(
      readFileSync(path.join(successor.paths.baseline, "src", "a.ts"), "utf8"),
      "export const a = 1;\n",
    );

    // Exact replay is idempotent: same competition/candidate/revision/profile/reason.
    const again = await executeCandidateHandoff(
      store,
      settings.get(),
      {
        competitionId: competition.id,
        candidateId: retained.id,
        candidateRevisionId: revisionId,
        destinationWorkerProfileId: "grok-builder",
        reason: handoffReason,
        confirm: true,
      },
      { canLaunch: () => ({ ok: true }) },
    );
    assert.equal(again.successorTaskId, view.successorTaskId);
    assert.equal(again.id, view.id);

    // Changed reason is not an exact replay: reject before mutation, one successor kept.
    await assert.rejects(
      () => executeCandidateHandoff(
        store,
        settings.get(),
        {
          competitionId: competition.id,
          candidateId: retained.id,
          candidateRevisionId: revisionId,
          destinationWorkerProfileId: "grok-builder",
          reason: "A different reason must not reuse the prior handoff authorization.",
          confirm: true,
        },
        { canLaunch: () => ({ ok: true }) },
      ),
      (err: unknown) => err instanceof CandidateHandoffError && err.code === "duplicate-handoff",
    );
    const handoffs = store.listCandidateHandoffsByCompetitionId(competition.id);
    assert.equal(handoffs.length, 1);
    const successorCount = store.listTasks().filter((t) =>
      store.getCandidateHandoffBySuccessorTaskId(t.id) !== undefined
    ).length;
    assert.equal(successorCount, 1);

    // Loop guard: a handoff successor cannot authorize another hop.
    const succView = resolveHandoffViewForTask(store, view.successorTaskId);
    assert.equal(succView?.isSuccessor, true);
    assert.ok(store.getCandidateHandoffBySuccessorTaskId(view.successorTaskId));
    void destination;
  } finally {
    cleanup();
  }
});

test("handoff fails closed on same Profile, final choice, stale revision, and non-launchable destination", async () => {
  const src = makeTwoFileSourceProject();
  const { store, settings, cleanup } = setupCoordinator(src);
  try {
    seedGrokBuilderProfile(settings);
    const coordinator = new CompetitionCoordinator(store, settings);
    const baseSpec = makeContractSpec(src);
    const { competition } = await coordinator.create(baseSpec, "/test.yaml", [
      { workerProfileId: "default" },
      { workerProfileId: "grok-builder" },
    ], {
      ...REASONED_OPTIONS,
      readinessVerifier: () => {},
    });
    const candidates = store.getCompetitionCandidates(competition.id);
    const retained = candidates.find((c) => c.identity?.workerProfileId === "default")!;
    const chosen = candidates.find((c) => c.id !== retained.id)!;
    const sourceTask = store.getTask(retained.taskId);
    const { revisionId } = completeTwoFileCandidate(store, sourceTask, { passed: false });
    coordinator.recordRetainedPartial(
      competition.id,
      retained.id,
      ["src/a.ts"],
      [{
        description: "src/b.ts still needs the second export completed",
        acceptanceExpectation: "src/b.ts exports the updated constant and acceptance passes",
      }],
    );

    // Same profile
    await assert.rejects(
      () => executeCandidateHandoff(
        store,
        settings.get(),
        {
          competitionId: competition.id,
          candidateId: retained.id,
          candidateRevisionId: revisionId,
          destinationWorkerProfileId: "default",
          reason: "Same profile must fail closed.",
          confirm: true,
        },
        { canLaunch: () => ({ ok: true }) },
      ),
      (err: unknown) => err instanceof CandidateHandoffError && err.code === "same-profile",
    );

    // Non-launchable
    await assert.rejects(
      () => executeCandidateHandoff(
        store,
        settings.get(),
        {
          competitionId: competition.id,
          candidateId: retained.id,
          candidateRevisionId: revisionId,
          destinationWorkerProfileId: "grok-builder",
          reason: "Non-launchable destination must fail closed.",
          confirm: true,
        },
        { canLaunch: () => ({ ok: false, reason: "authentication-missing" }) },
      ),
      (err: unknown) => err instanceof CandidateHandoffError && err.code === "profile-not-launchable",
    );

    // Stale revision id
    await assert.rejects(
      () => executeCandidateHandoff(
        store,
        settings.get(),
        {
          competitionId: competition.id,
          candidateId: retained.id,
          candidateRevisionId: randomUUID(),
          destinationWorkerProfileId: "grok-builder",
          reason: "Stale revision must fail closed.",
          confirm: true,
        },
        { canLaunch: () => ({ ok: true }) },
      ),
      (err: unknown) => err instanceof CandidateHandoffError && err.code === "stale-revision",
    );

    // Final accepted choice: handoff guard only needs Competition mainDecision.accept
    // on this candidate. Force the durable decision without Main-review accept on a
    // failed verification (accept requires passing verification).
    const retTask = store.getTask(retained.taskId);
    const attemptId = store.listAttempts(retained.taskId)[0]!.id;
    store.updateCompetition(competition.id, {
      mainDecision: {
        decision: "accept",
        candidateId: retained.id,
        taskId: retained.taskId,
        attemptId,
        verificationEventSequence: store.listEvents(retained.taskId)
          .filter((event) => event.type === "verification.completed")
          .at(-1)!.sequence,
        candidateRevisionId: revisionId,
        acceptedPatchDigest: sha256(readFileSync(retTask.paths.diff, "utf8")),
        reason: "final choice for guard",
        createdAt: at(9),
      },
    });
    void chosen;
    await assert.rejects(
      () => executeCandidateHandoff(
        store,
        settings.get(),
        {
          competitionId: competition.id,
          candidateId: retained.id,
          candidateRevisionId: revisionId,
          destinationWorkerProfileId: "grok-builder",
          reason: "Final choice cannot be handed off.",
          confirm: true,
        },
        { canLaunch: () => ({ ok: true }) },
      ),
      (err: unknown) => err instanceof CandidateHandoffError && err.code === "final-choice",
    );

    // No successor Task created by the failed attempts above.
    assert.equal(store.listCandidateHandoffs().length, 0);
  } finally {
    cleanup();
  }
});

test("handoff preparation failure launches no Worker and restart recovery is idempotent", async () => {
  const src = makeTwoFileSourceProject();
  const { store, settings, cleanup } = setupCoordinator(src);
  try {
    seedGrokBuilderProfile(settings);
    const coordinator = new CompetitionCoordinator(store, settings);
    const baseSpec = makeContractSpec(src);
    const { competition } = await coordinator.create(baseSpec, "/test.yaml", [
      { workerProfileId: "default" },
      { workerProfileId: "grok-builder" },
    ], {
      ...REASONED_OPTIONS,
      readinessVerifier: () => {},
    });
    const retained = store.getCompetitionCandidates(competition.id)
      .find((c) => c.identity?.workerProfileId === "default")!;
    const sourceTask = store.getTask(retained.taskId);
    const { revisionId, patchText } = completeTwoFileCandidate(store, sourceTask, { passed: false });
    coordinator.recordRetainedPartial(
      competition.id,
      retained.id,
      ["src/a.ts"],
      [{
        description: "src/b.ts still needs the second export completed",
        acceptanceExpectation: "src/b.ts exports the updated constant and acceptance passes",
      }],
    );

    // Tamper the private artifact after retention so apply/byte proof fails.
    const artifact = path.join(sourceTask.paths.root, "revisions", `${revisionId}.patch`);
    writeFileSync(artifact, patchText.replace("export const a = 2;", "export const a = 99;"));
    const failReason = "Tampered artifact must fail preparation without launching a Worker.";

    const failed = await executeCandidateHandoff(
      store,
      settings.get(),
      {
        competitionId: competition.id,
        candidateId: retained.id,
        candidateRevisionId: revisionId,
        destinationWorkerProfileId: "grok-builder",
        reason: failReason,
        confirm: true,
      },
      { canLaunch: () => ({ ok: true }) },
    );
    // Digest mismatch is caught before apply as stale-revision/materialization-failed.
    assert.equal(failed.status, "failed");
    assert.ok(failed.failureCode === "stale-revision" || failed.failureCode === "materialization-failed" || failed.failureCode === "apply-mismatch");
    const successor = store.getTask(failed.successorTaskId);
    assert.equal(successor.status, "failed");
    assert.equal(store.listAttempts(failed.successorTaskId).length, 0, "no Worker Attempt on prep failure");

    // Restore artifact; exact replay of the failed authorization returns the same record.
    writeFileSync(artifact, patchText);
    const again = await executeCandidateHandoff(
      store,
      settings.get(),
      {
        competitionId: competition.id,
        candidateId: retained.id,
        candidateRevisionId: revisionId,
        destinationWorkerProfileId: "grok-builder",
        reason: failReason,
        confirm: true,
      },
      { canLaunch: () => ({ ok: true }) },
    );
    assert.equal(again.id, failed.id);
    assert.equal(again.successorTaskId, failed.successorTaskId);
    assert.equal(again.status, "failed");
    assert.equal(store.listCandidateHandoffs().length, 1);

    // Restart recovery of a prepared handoff re-queues the same successor once.
    // Create a fresh competition path: clear by using a new competition.
  } finally {
    cleanup();
  }
});

test("handoff restart recovery finishes preparation once without duplicating successors", async () => {
  const src = makeTwoFileSourceProject();
  const { store, settings, cleanup } = setupCoordinator(src);
  try {
    seedGrokBuilderProfile(settings);
    const coordinator = new CompetitionCoordinator(store, settings);
    const baseSpec = makeContractSpec(src);
    const { competition } = await coordinator.create(baseSpec, "/test.yaml", [
      { workerProfileId: "default" },
      { workerProfileId: "grok-builder" },
    ], {
      ...REASONED_OPTIONS,
      readinessVerifier: () => {},
    });
    const retained = store.getCompetitionCandidates(competition.id)
      .find((c) => c.identity?.workerProfileId === "default")!;
    const sourceTask = store.getTask(retained.taskId);
    const { revisionId } = completeTwoFileCandidate(store, sourceTask, { passed: false });
    coordinator.recordRetainedPartial(
      competition.id,
      retained.id,
      ["src/a.ts"],
      [{
        description: "src/b.ts still needs the second export completed",
        acceptanceExpectation: "src/b.ts exports the updated constant and acceptance passes",
      }],
    );

    // Authorize only (skip prepare) by writing durable record via successful path then
    // rewinding status to authorized and clearing workspace — simulates crash mid-prepare.
    const prepared = await executeCandidateHandoff(
      store,
      settings.get(),
      {
        competitionId: competition.id,
        candidateId: retained.id,
        candidateRevisionId: revisionId,
        destinationWorkerProfileId: "grok-builder",
        reason: "Prepare once, then simulate restart recovery.",
        confirm: true,
      },
      { canLaunch: () => ({ ok: true }) },
    );
    assert.equal(prepared.status, "prepared");
    const record = store.getCandidateHandoff(prepared.id);
    // exactOptionalPropertyTypes: omit preparedAt rather than assign undefined.
    const { preparedAt: _dropPreparedAt, ...rewindBase } = record;
    void _dropPreparedAt;
    store.updateCandidateHandoff({
      ...rewindBase,
      status: "authorized",
      updatedAt: at(20),
      nextAction: "wait-for-successor",
    });
    store.setTaskStatus(prepared.successorTaskId, "queued", { finishedAt: null, error: null });
    // Clear workspace to force re-materialization.
    rmSync(store.getTask(prepared.successorTaskId).paths.workspace, { recursive: true, force: true });
    rmSync(store.getTask(prepared.successorTaskId).paths.baseline, { recursive: true, force: true });

    const recovery = await recoverCandidateHandoffs(store);
    assert.ok(recovery.recoveredHandoffIds.includes(prepared.id));
    assert.ok(recovery.queueTaskIds.includes(prepared.successorTaskId));
    const after = store.getCandidateHandoff(prepared.id);
    assert.equal(after.status, "prepared");
    assert.equal(store.listCandidateHandoffs().length, 1);
    assert.equal(
      readFileSync(path.join(store.getTask(prepared.successorTaskId).paths.workspace, "src", "a.ts"), "utf8"),
      "export const a = 2;\n",
    );

    // Second recovery is idempotent.
    const recovery2 = await recoverCandidateHandoffs(store);
    assert.equal(store.listCandidateHandoffs().length, 1);
    assert.ok(recovery2.queueTaskIds.includes(prepared.successorTaskId));
    assert.equal(projectCandidateHandoff(after).sourceDigestPrefix.length, 12);

    // If the prepared successor was already running when the Daemon stopped,
    // one system-owned continuation is durable and idempotent. It is not a
    // quality retry and a second interruption cannot loop forever.
    const successor = store.getTask(prepared.successorTaskId);
    const firstAttemptId = randomUUID();
    store.createAttempt({
      id: firstAttemptId,
      taskId: successor.id,
      ordinal: 1,
      status: "interrupted",
      sessionId: successor.sessionId,
      rawLogPath: path.join(successor.paths.logs, "attempt-1.jsonl"),
      startedAt: at(21),
      finishedAt: at(22),
      exitCode: 130,
      error: "ForkLight daemon restarted during execution",
    });
    store.setTaskStatus(successor.id, "interrupted", {
      currentAttemptId: firstAttemptId,
      finishedAt: at(22),
      error: "ForkLight daemon restarted during execution",
    });

    const interruptedRecovery = await recoverCandidateHandoffs(store);
    assert.ok(interruptedRecovery.queueTaskIds.includes(successor.id));
    assert.equal(store.getTask(successor.id).status, "interrupted");
    const recoveryGrants = store.listEvents(successor.id).filter((event) => (
      event.type === "attempt.authorization.granted"
      && (event.payload as { kind?: string } | undefined)?.kind === "restart-recovery"
    ));
    assert.equal(recoveryGrants.length, 1);
    assert.equal(
      projectCandidateHandoff(store.getCandidateHandoff(prepared.id), "succeeded").nextAction,
      "review-successor",
    );

    const interruptedRecoveryReplay = await recoverCandidateHandoffs(store);
    assert.ok(interruptedRecoveryReplay.queueTaskIds.includes(successor.id));
    assert.equal(
      store.listEvents(successor.id).filter((event) => (
        event.type === "attempt.authorization.granted"
        && (event.payload as { kind?: string } | undefined)?.kind === "restart-recovery"
      )).length,
      1,
    );

    const secondAttemptId = randomUUID();
    store.createAttempt({
      id: secondAttemptId,
      taskId: successor.id,
      ordinal: 2,
      status: "interrupted",
      sessionId: successor.sessionId,
      rawLogPath: path.join(successor.paths.logs, "attempt-2.jsonl"),
      startedAt: at(23),
      finishedAt: at(24),
      exitCode: 130,
      error: "ForkLight daemon restarted during recovery",
    });
    store.setTaskStatus(successor.id, "interrupted", {
      currentAttemptId: secondAttemptId,
      finishedAt: at(24),
      error: "ForkLight daemon restarted during recovery",
    });
    const cappedRecovery = await recoverCandidateHandoffs(store);
    assert.ok(!cappedRecovery.queueTaskIds.includes(successor.id));
    assert.equal(store.getTask(successor.id).status, "interrupted");
  } finally {
    cleanup();
  }
});

test("handoff delivers all bounded gaps and freezes destination Profile advanced policy", async () => {
  const src = makeTwoFileSourceProject();
  const { store, settings, cleanup } = setupCoordinator(src);
  try {
    seedGrokBuilderProfile(settings);
    // Destination Profile advanced policy differs from source-Task override.
    const current = settings.get();
    const grok = current.workerProfiles.profiles.find((profile) => profile.id === "grok-builder");
    assert.ok(grok);
    settings.update({
      workerProfiles: upsertWorkerProfile(
        current.workerProfiles,
        {
          ...grok,
          advancedPolicy: {
            ...(grok.advancedPolicy ?? {}),
            baseMaxAttempts: 3,
            maxExtraAttempts: 2,
            maxMainCorrections: 2,
          },
        },
        current.modelCatalog,
      ),
    });

    const coordinator = new CompetitionCoordinator(store, settings);
    const baseSpec = makeContractSpec(src);
    // Stale source-Task Worker override that must NOT win on the successor.
    baseSpec.advancedPolicyOverride = {
      baseMaxAttempts: 9,
      maxExtraAttempts: 8,
      maxMainCorrections: 7,
    };
    const { competition } = await coordinator.create(baseSpec, "/test.yaml", [
      { workerProfileId: "default" },
      { workerProfileId: "grok-builder" },
    ], {
      ...REASONED_OPTIONS,
      readinessVerifier: () => {},
    });
    const retained = store.getCompetitionCandidates(competition.id)
      .find((c) => c.identity?.workerProfileId === "default")!;
    const sourceTask = store.getTask(retained.taskId);
    // Source candidate keeps its own frozen policy from create; handoff clones this spec.
    const mutatedSource = store.getTask(retained.taskId);
    const { revisionId } = completeTwoFileCandidate(store, sourceTask, { passed: false });

    // Eight max-bound gaps + one reusable path near allowed maxima.
    const pad = (label: string, size: number): string => {
      const body = `${label} `;
      return (body.repeat(Math.ceil(size / body.length))).slice(0, size);
    };
    const remainingGaps = Array.from({ length: 8 }, (_, index) => ({
      description: pad(`Gap ${index + 1} description for remaining incomplete work.`, 500),
      acceptanceExpectation: pad(`Gap ${index + 1} acceptance must stay fully visible to Worker.`, 500),
    }));
    assert.equal(remainingGaps[0]!.description.length, 500);
    assert.equal(remainingGaps[7]!.acceptanceExpectation.length, 500);

    coordinator.recordRetainedPartial(
      competition.id,
      retained.id,
      ["src/a.ts"],
      remainingGaps,
    );

    // Ensure the source Task still carries the stale override the handoff must strip.
    assert.equal(mutatedSource.spec.advancedPolicyOverride?.baseMaxAttempts, 9);

    const view = await executeCandidateHandoff(
      store,
      settings.get(),
      {
        competitionId: competition.id,
        candidateId: retained.id,
        candidateRevisionId: revisionId,
        destinationWorkerProfileId: "grok-builder",
        reason: "Deliver every gap and freeze destination advanced policy.",
        confirm: true,
      },
      { canLaunch: () => ({ ok: true }) },
    );
    assert.equal(view.status, "prepared");
    assert.equal(view.remainingGapCount, 8);

    const successor = store.getTask(view.successorTaskId);
    assert.equal(successor.spec.workerProfileId, "grok-builder");
    assert.equal(successor.spec.advancedPolicyOverride, undefined);
    assert.equal(successor.effectivePolicy?.profileId, "grok-builder");
    assert.equal(successor.effectivePolicy?.values.baseMaxAttempts, 3);
    assert.equal(successor.effectivePolicy?.values.maxExtraAttempts, 2);
    assert.equal(successor.effectivePolicy?.values.maxMainCorrections, 2);
    // Source override must not leak into successor effective policy.
    assert.notEqual(successor.effectivePolicy?.values.baseMaxAttempts, 9);
    assert.equal(successor.effectivePolicy?.provenance.baseMaxAttempts, "worker");

    assert.equal(successor.spec.version, 2);
    if (successor.spec.version === 2) {
      const surface = [
        ...successor.spec.contract.context,
        ...successor.spec.contract.inScope,
        ...successor.spec.contract.executionSteps,
      ].join("\n");
      assert.ok(surface.includes("src/a.ts"));
      for (const gap of remainingGaps) {
        assert.ok(surface.includes(gap.description), "every gap description must reach the Worker");
        assert.ok(
          surface.includes(gap.acceptanceExpectation),
          "every gap acceptance expectation must reach the Worker",
        );
      }
      assert.ok(!surface.includes(path.join(sourceTask.paths.root, "revisions")));
      assert.ok(!surface.includes("privateArtifactPath"));
    }

    // Pure builder also preserves max-bound instruction content without truncation.
    const selection = resolveWorkerSelection(
      { workerProfileId: "grok-builder" },
      {
        execution: settings.get().execution,
        providerDefaults: settings.get().providerDefaults,
        workerProfiles: settings.get().workerProfiles,
        ...(settings.get().modelCatalog === undefined
          ? {}
          : { modelCatalog: settings.get().modelCatalog }),
      },
    );
    const built = buildHandoffSuccessorSpec(mutatedSource.spec, selection, {
      reusablePaths: ["src/a.ts"],
      remainingGaps,
      digestPrefix: "abcd1234ef00",
    });
    assert.equal(built.advancedPolicyOverride, undefined);
    assert.equal(built.workerProfileId, "grok-builder");
    if (built.version === 2) {
      const text = built.contract.context.join("\n");
      assert.ok(text.includes(remainingGaps[7]!.description));
      assert.ok(text.includes(remainingGaps[7]!.acceptanceExpectation));
    }
    const instruction = buildHandoffInstruction(["src/a.ts"], remainingGaps, "abcd1234ef00");
    assert.ok(instruction.includes(remainingGaps[7]!.description));
    assert.ok(!instruction.includes("revisions/"));
  } finally {
    cleanup();
  }
});

test("handoff rejects non-exact replay of destination Profile while preserving one successor", async () => {
  const src = makeTwoFileSourceProject();
  const { store, settings, cleanup } = setupCoordinator(src);
  try {
    seedGrokBuilderProfile(settings);
    // Add a third launchable profile for non-exact destination replay.
    const current = settings.get();
    settings.update({
      workerProfiles: upsertWorkerProfile(
        current.workerProfiles,
        {
          id: "alt-builder",
          label: "Alt Builder",
          runtime: "grok-build",
          modelConfigId: "xai-grok-builder",
          effort: "medium",
          maxBudgetUsd: 1.0,
        },
        current.modelCatalog,
      ),
    });

    const coordinator = new CompetitionCoordinator(store, settings);
    const baseSpec = makeContractSpec(src);
    const { competition } = await coordinator.create(baseSpec, "/test.yaml", [
      { workerProfileId: "default" },
      { workerProfileId: "grok-builder" },
    ], {
      ...REASONED_OPTIONS,
      readinessVerifier: () => {},
    });
    const retained = store.getCompetitionCandidates(competition.id)
      .find((c) => c.identity?.workerProfileId === "default")!;
    const sourceTask = store.getTask(retained.taskId);
    const { revisionId } = completeTwoFileCandidate(store, sourceTask, { passed: false });
    coordinator.recordRetainedPartial(
      competition.id,
      retained.id,
      ["src/a.ts"],
      [{
        description: "src/b.ts still needs the second export completed",
        acceptanceExpectation: "src/b.ts exports the updated constant and acceptance passes",
      }],
    );
    const reason = "First handoff to grok-builder only.";
    const first = await executeCandidateHandoff(
      store,
      settings.get(),
      {
        competitionId: competition.id,
        candidateId: retained.id,
        candidateRevisionId: revisionId,
        destinationWorkerProfileId: "grok-builder",
        reason,
        confirm: true,
      },
      { canLaunch: () => ({ ok: true }) },
    );
    assert.equal(first.status, "prepared");

    await assert.rejects(
      () => executeCandidateHandoff(
        store,
        settings.get(),
        {
          competitionId: competition.id,
          candidateId: retained.id,
          candidateRevisionId: revisionId,
          destinationWorkerProfileId: "alt-builder",
          reason,
          confirm: true,
        },
        { canLaunch: () => ({ ok: true }) },
      ),
      (err: unknown) => err instanceof CandidateHandoffError && err.code === "duplicate-handoff",
    );
    assert.equal(store.listCandidateHandoffs().length, 1);
    assert.equal(store.getCandidateHandoff(first.id).successorTaskId, first.successorTaskId);
  } finally {
    cleanup();
  }
});
