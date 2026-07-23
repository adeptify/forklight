import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CompetitionCoordinator,
  CompetitionService,
  DEFAULT_RANKING_POLICY,
  rankingPolicy,
  scoreCandidates,
  type CandidateOverride,
  type CompetitionCandidateInput,
} from "../src/core/competition.js";
import type { CompetitionSettings, ForkLightSettings } from "../src/core/settings.js";
import { SettingsService } from "../src/core/settings.js";
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
          { providerName: "openai", modelName: "gpt-4" },
          valid[0]!,
        ]),
      /Unsupported provider/,
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
  const { coordinator, store, home, cleanup } = setupCoordinator(src);
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

test("candidates clone canonical snapshot after live source changes", async () => {
  const src = makeSourceProject();
  const { coordinator, store, home, cleanup } = setupCoordinator(src);

  // Patch prepareWorkspace to inject a source change between candidates
  const originalPrepare = (
    await import("../src/workspace/copy.js")
  ).prepareWorkspace;
  let injected = false;
  const patched = async (...args: Parameters<typeof originalPrepare>) => {
    const result = await originalPrepare(...args);
    if (!injected) {
      // After first candidate is prepared, modify the live source
      writeFileSync(path.join(src, "src", "after-snapshot.ts"), "export const after = 1;\n");
      injected = true;
    }
    return result;
  };
  // Override the module-level import — since it's imported by name, we can't easily mock.
  // Instead, test that the snapshot captures the state at creation time by verifying
  // that the source change does NOT appear in candidate workspaces.
  // We'll write the file before create but verify the manifest is what it was at snapshot.

  // Simpler approach: create the file BEFORE create but after building the in-memory intent,
  // but the coordinator snapshots first so the race doesn't matter.
  // Better test: create a competition, then verify that post-snapshot source changes
  // are invisible to candidates.
  const baseSpec = makeContractSpec(src);
  const candidates: CandidateOverride[] = [
    { providerName: "deepseek", modelName: "v4" },
    { providerName: "minimax", modelName: "m3" },
  ];

  const { competition, taskIds } = await coordinator.create(baseSpec, "/test.yaml", candidates);

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
