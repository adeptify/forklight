/**
 * Candidate revision evidence and structured gap contract tests.
 *
 * Covers: immutable snapshot bytes and digest, duplicate/conflicting capture,
 * safe projection, structured validation, stale revision, zero/exhausted
 * allowance, no mutation on rejection, restart recovery, Main Review binding,
 * Integration mismatch rejection, legacy records, bilingual UI, and no
 * automatic loop.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  captureCandidateRevision,
  resolveLatestRevision,
  summarizeRevision,
  buildCandidateGapContract,
  computeGapContractDigest,
  resolveCorrectionEligibility,
  describeCorrectionRejection,
  buildCorrectionInstruction,
  validateStructuredCorrectionInput,
} from "../src/core/candidate-revision.js";
import { recordMainReview, latestMainReview } from "../src/core/main-review.js";
import { preflightIntegration } from "../src/core/integration.js";
import {
  authorizeMainCorrection,
  resolvePendingCorrectionGrant,
} from "../src/core/attempt-authorization.js";
import type {
  AdvancedPolicyFields,
  AttemptRecord,
  EffectivePolicySnapshot,
  ProvenanceSource,
  TaskRecord,
  VerificationResult,
} from "../src/core/types.js";
import type { IntegrationSettings } from "../src/core/settings.js";
import { StateStore } from "../src/state/store.js";
import { taskPaths } from "../src/core/config.js";
import { prepareWorkspace } from "../src/workspace/copy.js";
import { createPathPolicy } from "../src/workspace/path-policy.js";
import { writeWorkspacePatchReport } from "../src/workspace/patch.js";
import { defaultAdvancedPolicyFields, defaultEnforcementCapability } from "../src/core/advanced-policy.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const hubPublic = path.join(root, "src", "hub", "public");

const INTEGRATION_DEFAULTS: IntegrationSettings = {
  reviewedPatchMaxFiles: 5,
  reviewedPatchMaxLines: 400,
  reviewReceiptTtlMs: 900_000,
  verificationTimeoutMs: 30_000,
  backupRetentionCount: 3,
  autoRollback: true,
};

// --- Fixtures ---

function snapshot(overrides: Partial<AdvancedPolicyFields> = {}): EffectivePolicySnapshot {
  const values: AdvancedPolicyFields = {
    ...defaultAdvancedPolicyFields(),
    ...overrides,
  };
  const provenance = Object.fromEntries(
    Object.keys(values).map((key) => [key, "global" as ProvenanceSource]),
  ) as Record<keyof AdvancedPolicyFields, ProvenanceSource>;
  return {
    profileId: "test-profile",
    values,
    provenance,
    enforcementCapability: defaultEnforcementCapability(),
  };
}

function v1Spec(project: string, commands: string[]): TaskRecord["spec"] {
  return {
    version: 1,
    name: "revision-fixture",
    project,
    goal: "Exercise candidate revision capture",
    constraints: [],
    provider: { name: "deepseek", model: "v4", keychainService: "forklight.deepseek.api-key" },
    runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: 0.1 },
    workspace: { exclude: [".git", "node_modules"] },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
    acceptance: { commands },
  };
}

interface BuiltTask {
  task: TaskRecord;
  attemptId: string;
  store: StateStore;
  home: string;
  diffPath: string;
}

async function buildTaskWithWorkspace(
  id: string,
  effectivePolicy?: EffectivePolicySnapshot,
): Promise<BuiltTask> {
  const home = await mkdtemp(path.join(tmpdir(), `fl-rev-${id}-`));
  const sourceDir = path.join(home, "source");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(path.join(sourceDir, "readme.md"), "# hello\n\nOriginal text.\n");
  await writeFile(path.join(sourceDir, "utils.ts"), "export const x = 1;\n");

  const spec = v1Spec(sourceDir, ["true"]);
  const paths = taskPaths(home, id);
  await prepareWorkspace(spec, paths);
  await writeFile(path.join(paths.workspace, "readme.md"), "# hello\n\nChanged text.\n");
  await writeFile(path.join(paths.workspace, "utils.ts"), "export const x = 2;\n");
  await writeWorkspacePatchReport(paths, createPathPolicy(spec));

  const store = new StateStore(home);
  const task: TaskRecord = {
    id,
    name: spec.name,
    status: "failed",
    sourcePath: sourceDir,
    taskFile: `forklight://test/${id}`,
    spec,
    paths,
    sessionId: `session-${id}`,
    currentAttemptId: `${id}-att-1`,
    createdAt: "2026-07-27T00:00:00Z",
    updatedAt: "2026-07-27T01:00:00Z",
    startedAt: "2026-07-27T00:00:00Z",
    finishedAt: "2026-07-27T01:00:00Z",
    error: "Independent verification failed",
    ...(effectivePolicy === undefined ? {} : { effectivePolicy }),
  };
  store.createTask(task);
  const attempt: AttemptRecord = {
    id: `${id}-att-1`,
    taskId: id,
    ordinal: 1,
    status: "succeeded",
    sessionId: task.sessionId,
    rawLogPath: path.join(paths.logs, "att-1.jsonl"),
    startedAt: "2026-07-27T00:00:00Z",
    finishedAt: "2026-07-27T00:30:00Z",
    exitCode: 0,
    runtimeBudgetUsd: 0.1,
  };
  store.createAttempt(attempt);

  return { task: store.getTask(id), attemptId: attempt.id, store, home, diffPath: paths.diff };
}

// --- Immutable snapshot bytes and digest ---

test("capture creates immutable CandidateRevision with SHA-256 digest and private artifact", async () => {
  const built = await buildTaskWithWorkspace("capture-1");
  try {
    const diffContent = await readFile(built.diffPath, "utf8");
    assert.ok(diffContent.length > 0, "diff must be non-empty");

    const revision = await captureCandidateRevision(
      built.store,
      built.task,
      built.store.getAttempt(built.attemptId),
      1,
      false,
      ["readme.md", "utils.ts"],
      2,
      4,
    );
    assert.equal(revision.taskId, built.task.id);
    assert.equal(revision.attemptId, built.attemptId);
    assert.equal(revision.attemptOrdinal, 1);
    assert.equal(revision.verificationEventSequence, 1);
    assert.equal(revision.verificationPassed, false);
    assert.equal(revision.filesChanged, 2);
    assert.equal(revision.changedLines, 4);
    assert.equal(revision.affectedPaths.length, 2);
    assert.ok(revision.patchDigest.length === 64, "SHA-256 hex is 64 chars");
    assert.ok(revision.createdAt.length > 0);

    // Private artifact exists on disk
    const artifactPath = path.join(
      built.task.paths.root,
      "revisions",
      `${revision.id}.patch`,
    );
    const artifactBytes = await readFile(artifactPath);
    assert.deepEqual(artifactBytes, Buffer.from(diffContent));

    // Event is recorded
    const events = built.store.listEvents(built.task.id);
    const revisionEvent = events.find((e) => e.type === "candidate.revision.captured");
    assert.ok(revisionEvent, "revision event must be recorded");
    const payload = revisionEvent!.payload as Record<string, unknown>;
    assert.equal(payload.id, revision.id);
    assert.equal(payload.patchDigest, revision.patchDigest);
    assert.ok(typeof payload.privateArtifactPath === "string", "private artifact path in payload");

    // Resolve from events
    const resolved = resolveLatestRevision(events);
    assert.ok(resolved !== undefined);
    assert.equal(resolved!.patchDigest, revision.patchDigest);

    // Privacy-safe summary
    const summary = summarizeRevision(revision);
    assert.equal(summary.digestPrefix, revision.patchDigest.slice(0, 12));
    assert.equal(summary.affectedPathCount, 2);
    // Artifact path must NOT be in summary
    const summaryJson = JSON.stringify(summary);
    assert.ok(!summaryJson.includes("privateArtifactPath"));
    assert.ok(!summaryJson.includes(artifactPath));
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

// --- Duplicate / conflicting capture ---

test("idempotent capture returns existing revision for same attempt + verification + digest", async () => {
  const built = await buildTaskWithWorkspace("idempotent-1");
  try {
    const r1 = await captureCandidateRevision(
      built.store, built.task, built.store.getAttempt(built.attemptId),
      1, false, ["readme.md"], 1, 2,
    );
    const r2 = await captureCandidateRevision(
      built.store, built.task, built.store.getAttempt(built.attemptId),
      1, false, ["readme.md"], 1, 2,
    );
    assert.equal(r2.id, r1.id);
    assert.equal(r2.patchDigest, r1.patchDigest);
    assert.equal(
      built.store.listEvents(built.task.id).filter((e) => e.type === "candidate.revision.captured").length,
      1,
      "only one revision event",
    );
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("idempotent capture rejects changed immutable metadata or a missing private artifact", async () => {
  const built = await buildTaskWithWorkspace("idempotent-integrity-1");
  try {
    const revision = await captureCandidateRevision(
      built.store, built.task, built.store.getAttempt(built.attemptId),
      1, false, ["readme.md"], 1, 2,
    );
    await assert.rejects(
      captureCandidateRevision(
        built.store, built.task, built.store.getAttempt(built.attemptId),
        1, false, ["readme.md", "utils.ts"], 2, 4,
      ),
      /immutable metadata/,
    );
    await unlink(path.join(built.task.paths.root, "revisions", `${revision.id}.patch`));
    await assert.rejects(
      captureCandidateRevision(
        built.store, built.task, built.store.getAttempt(built.attemptId),
        1, false, ["readme.md"], 1, 2,
      ),
      /private artifact is missing/,
    );
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("empty Diff is captured as evidence but is not eligible for Worker correction", async () => {
  const built = await buildTaskWithWorkspace("empty-revision-1");
  try {
    await writeFile(built.diffPath, "");
    const revision = await captureCandidateRevision(
      built.store, built.task, built.store.getAttempt(built.attemptId),
      1, false, [], 0, 0,
    );
    assert.equal(revision.filesChanged, 0);
    assert.equal(resolveCorrectionEligibility(built.store, built.task.id).category, "empty-revision");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("conflicting duplicate identity (same keys, different digest) throws", async () => {
  const built = await buildTaskWithWorkspace("conflict-1");
  try {
    await captureCandidateRevision(
      built.store, built.task, built.store.getAttempt(built.attemptId),
      1, false, ["readme.md"], 1, 2,
    );
    // Tamper with the diff so the digest differs
    await writeFile(built.diffPath, "tampered content\n");
    await assert.rejects(
      captureCandidateRevision(
        built.store, built.task, built.store.getAttempt(built.attemptId),
        1, false, ["readme.md"], 1, 2,
      ),
      /different digest/,
    );
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

// --- Legacy records ---

test("legacy task without revision returns undefined from resolveLatestRevision", async () => {
  const built = await buildTaskWithWorkspace("legacy-1");
  try {
    // No revision captured yet — equivalent to a legacy task
    const resolved = resolveLatestRevision(built.store.listEvents(built.task.id));
    assert.equal(resolved, undefined);
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

// --- Gap contract validation ---

test("buildCandidateGapContract validates paths, counts, and content", async () => {
  // Valid contract
  const contract = buildCandidateGapContract(
    "rev-1",
    ["readme.md"],
    [{ description: "Fix the import path in the module", acceptanceExpectation: "All imports resolve correctly" }],
    ["readme.md", "utils.ts"],
  );
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.candidateRevisionId, "rev-1");
  assert.deepEqual(contract.reusablePaths, ["readme.md"]);
  assert.equal(contract.remainingGaps.length, 1);
  assert.equal(contract.remainingGaps[0]!.description, "Fix the import path in the module");
  assert.equal(contract.remainingGaps[0]!.acceptanceExpectation, "All imports resolve correctly");

  // Digest is deterministic
  const d1 = computeGapContractDigest(contract);
  const d2 = computeGapContractDigest(contract);
  assert.equal(d1, d2);
  assert.ok(d1.length === 64);
});

test("gap contract rejects invalid paths", async () => {
  // Path not in revision affected set
  assert.throws(
    () => buildCandidateGapContract("rev-1", ["nonexistent.ts"], [
      { description: "Missing file that is not in patch", acceptanceExpectation: "It exists" },
    ], ["readme.md"]),
    /not in the referenced revision/,
  );

  // Traversal path
  assert.throws(
    () => buildCandidateGapContract("rev-1", ["../outside.txt"], [
      { description: "Traversal path attempt", acceptanceExpectation: "Rejected" },
    ], ["../outside.txt"]),
    /Traversal/,
  );

  // Absolute path
  assert.throws(
    () => buildCandidateGapContract("rev-1", ["/etc/passwd"], [
      { description: "Absolute path attempt", acceptanceExpectation: "Rejected" },
    ], ["/etc/passwd"]),
    /Absolute/,
  );
});

test("gap contract rejects invalid gap counts and content", async () => {
  // Too few gaps
  assert.throws(
    () => buildCandidateGapContract("rev-1", [], [], ["readme.md"]),
    /at least 1/,
  );

  // Description too short
  assert.throws(
    () => buildCandidateGapContract("rev-1", [], [
      { description: "short", acceptanceExpectation: "Long enough expectation text" },
    ], ["readme.md"]),
    /must be 10-500/,
  );

  // Credential pattern in gap
  assert.throws(
    () => buildCandidateGapContract("rev-1", [], [
      { description: "Use API_KEY=sk-1234567890abcdef for the fix", acceptanceExpectation: "API works" },
    ], ["readme.md"]),
    /credentials/,
  );
});

// --- Correction eligibility ---

test("correction eligibility: eligible failed task with revision", async () => {
  const built = await buildTaskWithWorkspace("elig-1", snapshot({ maxMainCorrections: 2 }));
  try {
    await captureCandidateRevision(
      built.store, built.task, built.store.getAttempt(built.attemptId),
      1, false, ["readme.md", "utils.ts"], 2, 4,
    );
    const elig = resolveCorrectionEligibility(built.store, built.task.id);
    assert.equal(elig.eligible, true);
    assert.equal(elig.category, "eligible");
    assert.equal(elig.allowance.max, 2);
    assert.equal(elig.allowance.remaining, 2);
    assert.ok(elig.latestRevision !== undefined);
    assert.equal(elig.latestRevision!.attemptOrdinal, 1);
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("correction eligibility: not-failed-or-interrupted rejected", async () => {
  const built = await buildTaskWithWorkspace("elig-2");
  try {
    built.store.setTaskStatus(built.task.id, "succeeded", { error: null });
    const elig = resolveCorrectionEligibility(built.store, built.task.id);
    assert.equal(elig.category, "not-failed-or-interrupted");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("correction eligibility: no-revision rejected", async () => {
  const built = await buildTaskWithWorkspace("elig-3");
  try {
    // No revision captured
    const elig = resolveCorrectionEligibility(built.store, built.task.id);
    assert.equal(elig.category, "no-revision");
    assert.equal(elig.latestRevision, undefined);
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("correction eligibility: allowance-zero rejected", async () => {
  const built = await buildTaskWithWorkspace("elig-4", snapshot({ maxMainCorrections: 0 }));
  try {
    await captureCandidateRevision(
      built.store, built.task, built.store.getAttempt(built.attemptId),
      1, false, ["readme.md"], 1, 2,
    );
    const elig = resolveCorrectionEligibility(built.store, built.task.id);
    assert.equal(elig.category, "allowance-zero");
    assert.equal(elig.allowance.max, 0);
    assert.equal(elig.allowance.remaining, 0);
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("correction eligibility: allowance-exhausted rejected", async () => {
  const built = await buildTaskWithWorkspace("elig-5", snapshot({ maxMainCorrections: 1 }));
  try {
    await captureCandidateRevision(
      built.store, built.task, built.store.getAttempt(built.attemptId),
      1, false, ["readme.md"], 1, 2,
    );
    // Simulate consumed correction grant
    built.store.addEvent(built.task.id, built.attemptId, "attempt.authorization.granted",
      "correction consumed", {
        kind: "correction", additionalAttempts: 1, targetOrdinal: 2,
        maxBudgetUsd: null, budgetMode: "uncapped-for-authorized-attempt",
        reason: "main-correction", feedback: "test", priorAttemptId: built.attemptId,
      });
    // Also add the attempt that consumed the grant so it's not pending
    built.store.createAttempt({
      id: `${built.task.id}-att-2`, taskId: built.task.id, ordinal: 2, status: "failed",
      sessionId: built.task.sessionId, rawLogPath: "/tmp/att-2.jsonl",
      startedAt: "2026-07-27T01:00:00Z", finishedAt: "2026-07-27T01:30:00Z", exitCode: 1,
    });
    const elig = resolveCorrectionEligibility(built.store, built.task.id);
    assert.equal(elig.category, "allowance-exhausted");
    assert.equal(elig.allowance.consumed, 1);
    assert.equal(elig.allowance.remaining, 0);
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("correction eligibility rejects a stale Diff and a latest Attempt without revision", async () => {
  const stale = await buildTaskWithWorkspace("elig-stale");
  try {
    await captureCandidateRevision(
      stale.store, stale.task, stale.store.getAttempt(stale.attemptId),
      1, false, ["readme.md"], 1, 2,
    );
    await writeFile(stale.diffPath, "changed after capture\n");
    assert.equal(resolveCorrectionEligibility(stale.store, stale.task.id).category, "stale-revision");
  } finally {
    stale.store.close();
    await rm(stale.home, { recursive: true, force: true });
  }

  const newest = await buildTaskWithWorkspace("elig-newest");
  try {
    await captureCandidateRevision(
      newest.store, newest.task, newest.store.getAttempt(newest.attemptId),
      1, false, ["readme.md"], 1, 2,
    );
    newest.store.createAttempt({
      id: `${newest.task.id}-att-2`, taskId: newest.task.id, ordinal: 2, status: "failed",
      sessionId: newest.task.sessionId, rawLogPath: "/tmp/elig-newest-att-2.jsonl",
      startedAt: "2026-07-27T02:00:00Z", finishedAt: "2026-07-27T02:10:00Z", exitCode: 1,
    });
    assert.equal(
      resolveCorrectionEligibility(newest.store, newest.task.id).category,
      "no-latest-attempt-revision",
    );
  } finally {
    newest.store.close();
    await rm(newest.home, { recursive: true, force: true });
  }
});

test("correction eligibility: running-attempt rejected", async () => {
  const built = await buildTaskWithWorkspace("elig-6");
  try {
    await captureCandidateRevision(
      built.store, built.task, built.store.getAttempt(built.attemptId),
      1, false, ["readme.md"], 1, 2,
    );
    built.store.updateAttempt(built.attemptId, { status: "running" });
    const elig = resolveCorrectionEligibility(built.store, built.task.id);
    assert.equal(elig.category, "running-attempt");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("correction eligibility: competition-candidate rejected", async () => {
  const built = await buildTaskWithWorkspace("elig-7");
  try {
    await captureCandidateRevision(
      built.store, built.task, built.store.getAttempt(built.attemptId),
      1, false, ["readme.md"], 1, 2,
    );
    const siblingId = "comp-sib";
    built.store.createTask({
      id: siblingId,
      name: "comp-sib",
      status: "queued",
      sourcePath: built.task.sourcePath,
      taskFile: `forklight://test/${siblingId}`,
      spec: built.task.spec,
      paths: taskPaths(built.home, siblingId),
      sessionId: `session-${siblingId}`,
      createdAt: "2026-07-27T00:00:00Z",
      updatedAt: "2026-07-27T00:00:00Z",
    });
    built.store.createCompetition(
      { id: "c1", name: "comp", contractTaskId: built.task.id, status: "completed",
        rankingPolicy: { weights: { verification: 1, diffFocus: 0, retries: 0, cost: 0, duration: 0, delivery: 0 },
        tieThreshold: 0 }, createdAt: "2026-07-27T00:00:00Z", updatedAt: "2026-07-27T00:00:00Z" },
      [
        { id: "cand-1", competitionId: "c1", taskId: built.task.id, ordinal: 1, providerName: "deepseek", modelName: "v4" },
        { id: "cand-2", competitionId: "c1", taskId: siblingId, ordinal: 2, providerName: "minimax", modelName: "m3" },
      ],
    );
    const elig = resolveCorrectionEligibility(built.store, built.task.id);
    assert.equal(elig.category, "competition-candidate");
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

// --- Rejection messages are privacy-safe ---

test("describeCorrectionRejection returns stable non-echoing messages", async () => {
  for (const category of [
    "not-failed-or-interrupted",
    "competition-candidate",
    "running-attempt",
    "no-revision",
    "allowance-zero",
    "allowance-exhausted",
    "pending-incompatible-grant",
    "stale-revision",
  ] as const) {
    const msg = describeCorrectionRejection(category);
    assert.ok(msg.length > 10);
    assert.ok(!msg.includes("null"));
    assert.ok(!msg.includes("undefined"));
  }
});

// --- Correction instruction ---

test("buildCorrectionInstruction includes reusable paths, gaps, and stop rule", async () => {
  const instruction = buildCorrectionInstruction(
    {
      schemaVersion: 1,
      candidateRevisionId: "rev-1",
      reusablePaths: ["src/utils.ts"],
      remainingGaps: [
        { description: "Fix the missing import", acceptanceExpectation: "TypeScript compiles cleanly" },
      ],
    },
    "Please focus on the import issue",
  );
  assert.ok(instruction.includes("src/utils.ts"));
  assert.ok(instruction.includes("Fix the missing import"));
  assert.ok(instruction.includes("TypeScript compiles cleanly"));
  assert.ok(instruction.includes("Stop Rule") || instruction.includes("return control"));
  assert.ok(instruction.includes("Please focus on the import issue"));
  // Never contains private artifact path
  assert.ok(!instruction.includes("/revisions/"));
  assert.ok(!instruction.includes("privateArtifactPath"));
});

// --- Structured correction input validation ---

test("validateStructuredCorrectionInput rejects stale revision", async () => {
  const built = await buildTaskWithWorkspace("struct-1");
  try {
    const revision = await captureCandidateRevision(
      built.store, built.task, built.store.getAttempt(built.attemptId),
      1, false, ["readme.md", "utils.ts"], 2, 4,
    );
    assert.throws(
      () => validateStructuredCorrectionInput(
        {
          feedback: "Fix the import paths correctly",
          maxBudgetUsd: null,
          candidateRevisionId: "nonexistent-rev-id",
          reusablePaths: [],
          remainingGaps: [
            { description: "Fix import paths", acceptanceExpectation: "All imports resolve" },
          ],
          confirm: true,
        },
        revision,
      ),
      /stale revision/,
    );
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

// --- Main Review binding ---

test("Main Review accept binds to CandidateRevision digest", async () => {
  const built = await buildTaskWithWorkspace("review-1");
  try {
    const revision = await captureCandidateRevision(
      built.store, built.task, built.store.getAttempt(built.attemptId),
      1, false, ["readme.md", "utils.ts"], 2, 4,
    );
    // Record a passing verification
    const verif: VerificationResult = {
      passed: true, behaviorPassed: true, policyPassed: true, sourceCompatible: true,
      commands: [{ command: "true", exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false }],
      diffPath: built.diffPath, sourceUnchanged: true,
    };
    built.store.addEvent(built.task.id, built.attemptId, "verification.completed",
      "Independent verification passed", verif);
    built.store.setTaskStatus(built.task.id, "succeeded", { error: null });

    const review = recordMainReview(built.store, built.task.id, {
      decision: "accept", reason: "Verified and scoped", confirm: true,
    });
    assert.equal(review.decision, "accept");
    assert.equal(review.candidateRevisionId, revision.id);
    assert.equal(review.acceptedPatchDigest, revision.patchDigest);

    const latest = latestMainReview(built.store.listEvents(built.task.id));
    assert.ok(latest !== undefined);
    assert.equal(latest!.candidateRevisionId, revision.id);
    assert.equal(latest!.acceptedPatchDigest, revision.patchDigest);
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("Main Review cannot accept after the captured Diff changes", async () => {
  const built = await buildTaskWithWorkspace("review-stale-1");
  try {
    await captureCandidateRevision(
      built.store, built.task, built.store.getAttempt(built.attemptId),
      1, true, ["readme.md", "utils.ts"], 2, 4,
    );
    const verif: VerificationResult = {
      passed: true, behaviorPassed: true, policyPassed: true, sourceCompatible: true,
      commands: [{ command: "true", exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false }],
      diffPath: built.diffPath, sourceUnchanged: true,
    };
    built.store.addEvent(built.task.id, built.attemptId, "verification.completed",
      "Independent verification passed", verif);
    built.store.setTaskStatus(built.task.id, "succeeded", { error: null });
    await writeFile(built.diffPath, "changed after verification\n");
    assert.throws(
      () => recordMainReview(built.store, built.task.id, {
        decision: "accept", reason: "Should fail closed", confirm: true,
      }),
      /current Diff to match/,
    );
    assert.equal(latestMainReview(built.store.listEvents(built.task.id)), undefined);
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

// --- Integration mismatch rejection ---

test("Integration preflight rejects when accepted revision digest does not match current diff", async () => {
  const built = await buildTaskWithWorkspace("int-mismatch-1");
  try {
    await captureCandidateRevision(
      built.store, built.task, built.store.getAttempt(built.attemptId),
      1, false, ["readme.md", "utils.ts"], 2, 4,
    );
    const verif: VerificationResult = {
      passed: true, behaviorPassed: true, policyPassed: true, sourceCompatible: true,
      commands: [{ command: "true", exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false }],
      diffPath: built.diffPath, sourceUnchanged: true,
    };
    built.store.addEvent(built.task.id, built.attemptId, "verification.completed",
      "Independent verification passed", verif);
    built.store.setTaskStatus(built.task.id, "succeeded", { error: null });
    recordMainReview(built.store, built.task.id, {
      decision: "accept", reason: "Good patch", confirm: true,
    });

    // Tamper with the diff after accept
    await writeFile(built.diffPath, "completely different diff\n");

    const receipt = await preflightIntegration(built.store, built.task.id, INTEGRATION_DEFAULTS);
    assert.ok(
      receipt.rejectionReasons.some((r) =>
        r.includes("digest does not match") || r.includes("changed since Main acceptance"),
      ),
      `Expected digest mismatch rejection, got: ${receipt.rejectionReasons.join("; ")}`,
    );
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

// --- Legacy task compatibility ---

test("legacy task without revision: preflight works with normal checks but no digest binding", async () => {
  const built = await buildTaskWithWorkspace("legacy-int-1");
  try {
    built.store.setTaskStatus(built.task.id, "succeeded", { error: null });
    const verif: VerificationResult = {
      passed: true, behaviorPassed: true, policyPassed: true, sourceCompatible: true,
      commands: [{ command: "true", exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false }],
      diffPath: built.diffPath, sourceUnchanged: true,
    };
    built.store.addEvent(built.task.id, built.attemptId, "verification.completed",
      "Independent verification passed", verif);
    // Accept without revision digest binding (legacy)
    recordMainReview(built.store, built.task.id, {
      decision: "accept", reason: "Legacy accept", confirm: true,
    });

    const receipt = await preflightIntegration(built.store, built.task.id, INTEGRATION_DEFAULTS);
    assert.equal(receipt.rejectionReasons.length, 0, "legacy preflight should still pass");
    // No digest binding but still passes through normal checks
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

// --- No automatic loop ---

test("correction authorization does not auto-start or retry", async () => {
  const built = await buildTaskWithWorkspace("no-loop-1", snapshot({ maxMainCorrections: 1 }));
  try {
    await captureCandidateRevision(
      built.store, built.task, built.store.getAttempt(built.attemptId),
      1, false, ["readme.md"], 1, 2,
    );
    // Correction authorization creates a grant event but does NOT create an attempt or change task status
    const options = authorizeMainCorrection(
      built.store, built.task.id,
      { feedback: "Fix the thing", maxBudgetUsd: null, confirm: true },
      3, 1, 20,
    );
    assert.equal(options.maximumOrdinal, 2);
    // Task is still failed — no auto-transition
    assert.equal(built.store.getTask(built.task.id).status, "failed");
    // No new Attempt was created
    assert.equal(built.store.listAttempts(built.task.id).length, 1);
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

test("structured correction grant survives recovery and only replays the exact Gap Contract", async () => {
  const built = await buildTaskWithWorkspace("structured-grant-1", snapshot({ maxMainCorrections: 1 }));
  try {
    const revision = await captureCandidateRevision(
      built.store, built.task, built.store.getAttempt(built.attemptId),
      1, false, ["readme.md", "utils.ts"], 2, 4,
    );
    const contract = buildCandidateGapContract(
      revision.id,
      ["readme.md"],
      [{ description: "Fix the remaining import issue", acceptanceExpectation: "The full test command now passes" }],
      revision.affectedPaths,
    );
    const authorization = {
      feedback: "Repair only the remaining checked issue",
      maxBudgetUsd: null,
      confirm: true as const,
      gapContract: contract,
    };
    const first = authorizeMainCorrection(
      built.store, built.task.id, authorization, 3, 1, 20,
    );
    const pending = resolvePendingCorrectionGrant(built.store, built.task.id, 3);
    assert.ok(pending !== null);
    assert.deepEqual(pending!.gapContract, contract);
    assert.equal(pending!.gapContractDigest, computeGapContractDigest(contract));
    assert.equal(
      authorizeMainCorrection(built.store, built.task.id, authorization, 3, 1, 20)
        .authorizationEventSequence,
      first.authorizationEventSequence,
    );
    assert.throws(
      () => authorizeMainCorrection(
        built.store,
        built.task.id,
        {
          ...authorization,
          gapContract: {
            ...contract,
            remainingGaps: [{
              description: "Fix a different remaining issue",
              acceptanceExpectation: "A different check now passes",
            }],
          },
        },
        3,
        1,
        20,
      ),
      /conflicts with requested authorization/,
    );
  } finally {
    built.store.close();
    await rm(built.home, { recursive: true, force: true });
  }
});

// --- Bilingual UI assets ---

test("Hub i18n carries correction eligibility keys in both languages", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  for (const key of [
    "taskCorrectRejectNotFailed",
    "taskCorrectRejectCompetition",
    "taskCorrectRejectRunning",
    "taskCorrectRejectNoRevision",
    "taskCorrectRejectNoLatestRevision",
    "taskCorrectRejectEmptyRevision",
    "taskCorrectRejectAllowanceZero",
    "taskCorrectRejectAllowanceExhausted",
    "taskCorrectRejectPendingGrant",
    "taskCorrectRejectStale",
    "taskCorrectUnavailable",
    "taskCorrectGapTitle",
    "taskCorrectGapHint",
    "taskCorrectGapReusableLabel",
    "taskCorrectGapRemainingLabel",
    "taskCorrectRevisionLabel",
    "taskCorrectRevisionValue",
  ]) {
    assert.ok(i18n.indexOf(key) !== i18n.lastIndexOf(key), `${key} exists in both en and zh`);
  }
  // Chinese truthfulness: structured correction with gap contract
  assert.ok(i18n.includes("结构化修正"));
  assert.ok(i18n.includes("保留可用成果，只修剩余问题"));
  assert.ok(i18n.includes("这次修正会新增成本"));
  // English truthfulness: incremental cost caveat
  assert.match(i18n, /This correction adds cost/);
});

test("Hub app.js references correction eligibility", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  assert.ok(src.includes("correctionEligibility"), "correction eligibility used in UI");
  assert.ok(src.includes("correctionRejectionLabel"), "rejection label function");
  assert.ok(src.includes("correctBtn.disabled = true"), "button disabled when not eligible");
  assert.ok(src.includes('data-fl-role", "correct-reusable-path'), "reusable paths are selectable");
  assert.ok(src.includes('data-fl-role", "correct-gap-entry'), "remaining gaps are editable");
  assert.ok(src.includes("body.candidateRevisionId"), "submitted correction binds the revision");
  assert.ok(src.includes("body.remainingGaps = gaps"), "submitted correction carries the gap contract");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  assert.ok(css.includes(".task-correction-gap-entry"), "structured correction is styled");
});
