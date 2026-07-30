/**
 * Exact-revision Review Graph: one through three independent read-only judges.
 *
 * Covers create-run-parse-Main-decision, multi-judge aggregation, restart
 * reconciliation, malformed output, stale revision, idempotent same-set create,
 * changed-set rejection, partial usefulness, disagreement, all-unusable failure,
 * terminal evidence timing, reviewer Integration rejection, old-Main-accept
 * invalidation, fresh Main override, and privacy boundaries.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  captureCandidateRevision,
  resolveLatestRevision,
} from "../src/core/candidate-revision.js";
import { taskPaths } from "../src/core/config.js";
import { preflightIntegration } from "../src/core/integration.js";
import { recordMainReview } from "../src/core/main-review.js";
import {
  aggregateReviewAssignments,
  createReviewGraph,
  getReviewGraphStatus,
  normalizeReviewerProfileIds,
  parseReviewResultText,
  projectReviewGraph,
  reconcileAllReviewGraphs,
  reconcileReviewAssignment,
  REVIEW_EVIDENCE_PATH_MAX,
  REVIEW_FINDING_TEXT_MAX,
  REVIEW_MAX_FINDINGS,
  REVIEW_SUMMARY_MAX,
  REVIEWER_TASK_NOT_INTEGRATABLE,
  PENDING_REVIEW_BLOCKS_INTEGRATION,
  STALE_MAIN_ACCEPT_AFTER_REVIEW,
  reviewerOutputBoundsLine,
} from "../src/core/review-graph.js";
import {
  buildWorkerPrompt,
  reviewerTerminalOutputLines,
  workerPromptAppendicesForTask,
} from "../src/core/task.js";
import { SettingsService, type IntegrationSettings } from "../src/core/settings.js";
import type {
  AttemptRecord,
  TaskRecord,
  VerificationResult,
} from "../src/core/types.js";
import { StateStore } from "../src/state/store.js";
import { prepareWorkspace } from "../src/workspace/copy.js";
import { createPathPolicy } from "../src/workspace/path-policy.js";
import { writeWorkspacePatchReport } from "../src/workspace/patch.js";

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

interface Fixture {
  store: StateStore;
  settings: SettingsService;
  task: TaskRecord;
  attemptId: string;
  verificationSequence: number;
  revisionId: string;
  home: string;
  profileId: string;
}

async function buildSucceededCandidate(): Promise<Fixture> {
  const home = await mkdtemp(path.join(tmpdir(), "fl-review-graph-"));
  const sourceDir = path.join(home, "source");
  await mkdir(path.join(sourceDir, "src"), { recursive: true });
  await writeFile(path.join(sourceDir, "readme.md"), "# hello\n\nOriginal.\n");
  await writeFile(path.join(sourceDir, "src/app.ts"), "export const n = 1;\n");

  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const settingsSnap = settings.get();
  const profileId = settingsSnap.workerProfiles.defaultProfileId;

  const taskId = "candidate-1";
  const paths = taskPaths(home, taskId);
  const spec: TaskRecord["spec"] = {
    version: 1,
    name: "Candidate fixture",
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
    taskFile: "forklight://test/review-graph",
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
      stdout: "",
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
    attemptId: attempt.id,
    verificationSequence: verEvent.sequence,
    revisionId: revision.id,
    home,
    profileId,
  };
}

function validResultJson(revisionId: string, disposition: "accept" | "revise" | "reject" = "revise"): string {
  return JSON.stringify({
    schemaVersion: 1,
    reviewedRevisionId: revisionId,
    proposedDisposition: disposition,
    summary: "Scoped change looks mostly fine with one concern",
    findings: [
      {
        severity: "warning",
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
  resultText: string | undefined,
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
    ...(resultText === undefined ? {} : { resultText }),
  });
  store.setTaskStatus(reviewerTaskId, taskStatus, {
    finishedAt: now,
    currentAttemptId: attemptId,
  });
}

function secondProfileId(settings: SettingsService): string {
  const profiles = settings.get().workerProfiles.profiles;
  const second = profiles.find((p) => p.id !== settings.get().workerProfiles.defaultProfileId);
  assert.ok(second, "fixture settings must expose a second Worker Profile");
  return second.id;
}

test("reviewer prompt and packet expose consistent parser output bounds", async () => {
  const fx = await buildSucceededCandidate();
  try {
    const created = await createReviewGraph(fx.store, fx.settings.get(), {
      candidateTaskId: fx.task.id,
      reviewerWorkerProfileId: fx.profileId,
      reason: "Advertise exact output limits",
      confirm: true,
    });
    const assignment = fx.store.getReviewAssignment(created.graph.assignments[0]!.id);
    const packet = JSON.parse(await readFile(assignment.privatePacketPath!, "utf8")) as {
      outputLimits: {
        summaryMaxChars: number;
        findingTextMaxChars: number;
        evidencePathMaxChars: number;
        maxFindings: number;
      };
      requiredOutputSchema: { summary: string };
      rules: { maxFindings: number };
    };
    assert.deepEqual(packet.outputLimits, {
      summaryMaxChars: REVIEW_SUMMARY_MAX,
      findingTextMaxChars: REVIEW_FINDING_TEXT_MAX,
      evidencePathMaxChars: REVIEW_EVIDENCE_PATH_MAX,
      maxFindings: REVIEW_MAX_FINDINGS,
    });
    assert.equal(packet.rules.maxFindings, REVIEW_MAX_FINDINGS);
    assert.ok(packet.requiredOutputSchema.summary.includes(String(REVIEW_SUMMARY_MAX)));
    assert.ok(!packet.requiredOutputSchema.summary.includes("short summary"));

    const projectDir = fx.store.getTask(created.reviewerTaskId).spec.project;
    const instructions = await readFile(path.join(projectDir, "INSTRUCTIONS.md"), "utf8");
    const boundLine = reviewerOutputBoundsLine();
    assert.ok(instructions.includes(boundLine));

    // Runtime prompt bounds must match the same exported parser constants.
    const promptBounds = reviewerTerminalOutputLines().join("\n");
    assert.ok(promptBounds.includes(boundLine));
    assert.equal(packet.outputLimits.summaryMaxChars, REVIEW_SUMMARY_MAX);
    assert.equal(packet.outputLimits.findingTextMaxChars, REVIEW_FINDING_TEXT_MAX);
    assert.equal(packet.outputLimits.evidencePathMaxChars, REVIEW_EVIDENCE_PATH_MAX);
    assert.equal(packet.outputLimits.maxFindings, REVIEW_MAX_FINDINGS);

    // Ordinary Worker prompts stay free of reviewer JSON bounds.
    const ordinary = buildWorkerPrompt(
      {
        version: 1,
        name: "Ordinary",
        project: fx.home,
        goal: "Implement something",
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
        workspace: { exclude: [] },
        worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
        acceptance: { commands: ["true"] },
      },
      false,
      undefined,
      workerPromptAppendicesForTask({ taskFile: "/tmp/ordinary.yaml" }),
    );
    assert.ok(!ordinary.includes("Return exactly one raw JSON object"));
    assert.ok(!ordinary.includes(boundLine));
    // Non-reviewer taskFile never attaches reviewer terminal JSON instructions.
    assert.equal(
      workerPromptAppendicesForTask({ taskFile: "/tmp/ordinary.yaml" }).terminalOutputLines,
      undefined,
    );
  } finally {
    fx.store.close();
  }
});

test("oversized summary still fails closed without truncation", () => {
  const revisionId = "rev-oversize";
  const oversized = "x".repeat(REVIEW_SUMMARY_MAX + 9);
  assert.throws(
    () => parseReviewResultText(
      JSON.stringify({
        schemaVersion: 1,
        reviewedRevisionId: revisionId,
        proposedDisposition: "accept",
        summary: oversized,
        findings: [],
      }),
      revisionId,
      "t",
      "t",
    ),
    /schema-violation/,
  );
  // Boundary length remains accepted.
  const atLimit = parseReviewResultText(
    JSON.stringify({
      schemaVersion: 1,
      reviewedRevisionId: revisionId,
      proposedDisposition: "accept",
      summary: "y".repeat(REVIEW_SUMMARY_MAX),
      findings: [],
    }),
    revisionId,
    "t",
    "t",
  );
  assert.equal(atLimit.summary.length, REVIEW_SUMMARY_MAX);
});

test("parseReviewResultText accepts exact bounded JSON and rejects unsafe forms", () => {
  const revisionId = "rev-abc";
  const ok = parseReviewResultText(
    validResultJson(revisionId),
    revisionId,
    "task-r",
    "task-r",
  );
  assert.equal(ok.proposedDisposition, "revise");
  assert.equal(ok.findings.length, 1);

  assert.throws(
    () => parseReviewResultText("prose only", revisionId, "t", "t"),
    /malformed-json|missing-result/,
  );
  // One fenced object is accepted; wrapper is not stored as evidence.
  const fenced = parseReviewResultText(
    `\`\`\`json\n${validResultJson(revisionId)}\n\`\`\``,
    revisionId,
    "t",
    "t",
  );
  assert.equal(fenced.proposedDisposition, "revise");
  assert.equal(fenced.summary, "Scoped change looks mostly fine with one concern");
  // One prose-wrapped object is accepted.
  const proseWrapped = parseReviewResultText(
    `Judge result:\n${validResultJson(revisionId)}\nDone.`,
    revisionId,
    "t",
    "t",
  );
  assert.equal(proseWrapped.proposedDisposition, "revise");
  // Multiple top-level objects fail closed (no guessing which one).
  assert.throws(
    () => parseReviewResultText(
      `${validResultJson(revisionId)}\n${validResultJson(revisionId, "accept")}`,
      revisionId,
      "t",
      "t",
    ),
    /malformed-json/,
  );
  assert.throws(
    () => parseReviewResultText(
      JSON.stringify({
        schemaVersion: 1,
        reviewedRevisionId: revisionId,
        proposedDisposition: "accept",
        summary: "ok",
        findings: [],
        extra: true,
      }),
      revisionId,
      "t",
      "t",
    ),
    /extra-fields/,
  );
  assert.throws(
    () => parseReviewResultText(
      validResultJson("other-revision"),
      revisionId,
      "t",
      "t",
    ),
    /stale-revision/,
  );
  assert.throws(
    () => parseReviewResultText(
      JSON.stringify({
        schemaVersion: 1,
        reviewedRevisionId: revisionId,
        proposedDisposition: "accept",
        summary: "ok",
        findings: [{
          severity: "error",
          evidencePath: "/etc/passwd",
          affectedBehavior: "x".repeat(12),
          recommendation: "y".repeat(12),
        }],
      }),
      revisionId,
      "t",
      "t",
    ),
    /unsafe-content/,
  );
  assert.throws(
    () => parseReviewResultText(
      JSON.stringify({
        schemaVersion: 1,
        reviewedRevisionId: revisionId,
        proposedDisposition: "accept",
        summary: "uses Bearer sk-abcdefghijklmnop",
        findings: [],
      }),
      revisionId,
      "t",
      "t",
    ),
    /unsafe-content/,
  );
  // Credential-shaped wrapper prose fails closed before extraction.
  assert.throws(
    () => parseReviewResultText(
      `Here is API_KEY=secret\n\`\`\`json\n${validResultJson(revisionId)}\n\`\`\``,
      revisionId,
      "t",
      "t",
    ),
    /unsafe-content/,
  );
  assert.throws(
    () => parseReviewResultText(validResultJson(revisionId), revisionId, "expected", "other"),
    /wrong-identity/,
  );
});

test("MiniMax-shaped fenced JSON plus summary prose is accepted as one canonical object", () => {
  const revisionId = "rev-minimax-live";
  const body = validResultJson(revisionId, "accept");
  // Live dogfood shape: short prose, Markdown fence, then generic coding summary.
  const liveShape = [
    "I reviewed the packet. Here is the structured result:",
    "```json",
    body,
    "```",
    "",
    "files changed: none",
    "contract behavior delivered: structured review JSON",
    "verification evidence: read-only packet only",
    "remaining risks: none",
  ].join("\n");
  const parsed = parseReviewResultText(liveShape, revisionId, "judge-1", "judge-1");
  assert.equal(parsed.proposedDisposition, "accept");
  assert.equal(parsed.reviewedRevisionId, revisionId);
  assert.equal(parsed.findings.length, 1);
  // Canonical object only — wrapper prose never becomes summary/evidence.
  assert.equal(parsed.summary, "Scoped change looks mostly fine with one concern");
  assert.doesNotMatch(parsed.summary, /files changed/i);
});

test("reconciliation accepts fenced single-object resultText as canonical evidence only", async () => {
  const fx = await buildSucceededCandidate();
  try {
    const created = await createReviewGraph(fx.store, fx.settings.get(), {
      candidateTaskId: fx.task.id,
      reviewerWorkerProfileId: fx.profileId,
      reason: "Transport fence acceptance",
      confirm: true,
    });
    const assignmentId = created.graph.assignments[0]!.id;
    const fenced = [
      "Review complete.",
      "```json",
      validResultJson(fx.revisionId, "accept"),
      "```",
      "Return a concise summary containing: files changed, ...",
    ].join("\n");
    await finishReviewerWithResult(fx.store, created.reviewerTaskId, fenced);
    const terminal = reconcileReviewAssignment(fx.store, assignmentId);
    assert.equal(terminal.status, "completed");
    assert.equal(terminal.failureCode, undefined);
    assert.equal(terminal.result?.proposedDisposition, "accept");
    assert.equal(
      terminal.result?.summary,
      "Scoped change looks mostly fine with one concern",
    );
    // Safe status projection never carries wrapper prose or raw resultText.
    const status = getReviewGraphStatus(fx.store, fx.task.id)!;
    assert.equal(status.assignments[0]!.resultUsable, true);
    const projected = JSON.stringify(status);
    assert.ok(!projected.includes("```"));
    assert.ok(!projected.includes("files changed"));
    assert.ok(!projected.includes("resultText"));
  } finally {
    fx.store.close();
  }
});

test("one independent review reaches Main without mutating Candidate", async () => {
  const fx = await buildSucceededCandidate();
  try {
    const created = await createReviewGraph(fx.store, fx.settings.get(), {
      candidateTaskId: fx.task.id,
      reviewerWorkerProfileId: fx.profileId,
      reason: "Independent quality check before Main accept",
      confirm: true,
    });
    assert.equal(created.created, true);
    assert.equal(created.graph.status, "pending");
    assert.equal(created.graph.assignments.length, 1);
    assert.equal(created.graph.maxAssignments, 1);
    assert.equal(created.graph.aggregation.state, "pending");
    assert.equal(created.graph.aggregation.total, 1);
    assert.deepEqual(created.reviewerTaskIds, [created.reviewerTaskId]);
    assert.equal(created.graph.assignments[0]!.reviewerWorkerProfileId, fx.profileId);
    assert.equal(created.graph.blocksIntegration, true);

    const reviewer = fx.store.getTask(created.reviewerTaskId);
    assert.equal(reviewer.spec.worker.allowEdits, false);
    assert.equal(reviewer.spec.worker.allowedCommands.length, 0);
    assert.equal(reviewer.spec.delivery, undefined);
    assert.equal(reviewer.effectivePolicy?.values.baseMaxAttempts, 1);
    assert.equal(reviewer.effectivePolicy?.values.maxExtraAttempts, 0);
    assert.equal(reviewer.effectivePolicy?.values.maxMainCorrections, 0);

    // Packet exists privately and contains the exact patch digest.
    const assignment = fx.store.getReviewAssignment(created.graph.assignments[0]!.id);
    assert.ok(assignment.privatePacketPath);
    const packetRaw = await readFile(assignment.privatePacketPath!, "utf8");
    const packet = JSON.parse(packetRaw) as Record<string, unknown>;
    assert.equal(packet.reviewedRevisionId, fx.revisionId);
    assert.equal(packet.patchDigest, resolveLatestRevision(fx.store.listEvents(fx.task.id))!.patchDigest);
    assert.ok(typeof packet.patch === "string" && (packet.patch as string).length > 0);
    // No credentials / keychain / original source path leakage in packet rules.
    assert.equal((packet.rules as { readOnly: boolean }).readOnly, true);

    await finishReviewerWithResult(
      fx.store,
      created.reviewerTaskId,
      validResultJson(fx.revisionId, "revise"),
    );
    const terminal = reconcileReviewAssignment(fx.store, assignment.id);
    assert.equal(terminal.status, "completed");
    assert.equal(terminal.result?.proposedDisposition, "revise");
    assert.equal(terminal.failureCode, undefined);

    // Candidate unchanged.
    assert.equal(fx.store.getTask(fx.task.id).status, "succeeded");
    const status = getReviewGraphStatus(fx.store, fx.task.id)!;
    assert.equal(status.status, "completed");
    assert.equal(status.assignments[0]!.resultUsable, true);
    assert.equal(status.aggregation.state, "single-opinion");
    assert.equal(status.aggregation.usable, 1);
    assert.ok(status.terminalEvidenceSequence !== undefined);
    assert.match(status.nextAction, /Main|fresh|decide/i);
    // Safe projection has no private paths or raw patch.
    const projected = JSON.stringify(status);
    assert.ok(!projected.includes("privatePacketPath"));
    assert.ok(!projected.includes(assignment.privatePacketPath!));
    assert.ok(!projected.includes("resultText"));
  } finally {
    fx.store.close();
  }
});

test("reviewer output is unusable fails closed without retry or Candidate mutation", async () => {
  const fx = await buildSucceededCandidate();
  try {
    const created = await createReviewGraph(fx.store, fx.settings.get(), {
      candidateTaskId: fx.task.id,
      reviewerWorkerProfileId: fx.profileId,
      reason: "Need structured findings",
      confirm: true,
    });
    await finishReviewerWithResult(
      fx.store,
      created.reviewerTaskId,
      "Looks good overall but here is prose instead of JSON",
    );
    const assignment = fx.store.listReviewAssignments(created.graph.id)[0]!;
    const terminal = reconcileReviewAssignment(fx.store, assignment.id);
    assert.equal(terminal.status, "failed");
    assert.ok(terminal.failureCode);
    assert.equal(terminal.result, undefined);
    // Idempotent second reconcile.
    const again = reconcileReviewAssignment(fx.store, assignment.id);
    assert.equal(again.status, "failed");
    assert.equal(again.failureCode, terminal.failureCode);
    assert.equal(fx.store.getTask(fx.task.id).status, "succeeded");
  } finally {
    fx.store.close();
  }
});

test("pending and terminal review block stale Main accept until fresh decision", async () => {
  const fx = await buildSucceededCandidate();
  try {
    // Main accepts before judge review.
    recordMainReview(fx.store, fx.task.id, {
      decision: "accept",
      reason: "Looks green before judge",
      confirm: true,
    });
    let receipt = await preflightIntegration(fx.store, fx.task.id, INTEGRATION_DEFAULTS);
    assert.equal(receipt.rejectionReasons.length, 0);

    const created = await createReviewGraph(fx.store, fx.settings.get(), {
      candidateTaskId: fx.task.id,
      reviewerWorkerProfileId: fx.profileId,
      reason: "Second opinion before delivery",
      confirm: true,
    });
    receipt = await preflightIntegration(fx.store, fx.task.id, INTEGRATION_DEFAULTS);
    assert.ok(
      receipt.rejectionReasons.some((r) => r.includes(PENDING_REVIEW_BLOCKS_INTEGRATION)
        || r.includes("pending judge")),
    );

    await finishReviewerWithResult(
      fx.store,
      created.reviewerTaskId,
      validResultJson(fx.revisionId, "reject"),
    );
    reconcileReviewAssignment(
      fx.store,
      fx.store.listReviewAssignments(created.graph.id)[0]!.id,
    );
    receipt = await preflightIntegration(fx.store, fx.task.id, INTEGRATION_DEFAULTS);
    assert.ok(
      receipt.rejectionReasons.some((r) => r.includes(STALE_MAIN_ACCEPT_AFTER_REVIEW)
        || r.includes("fresh Main")),
    );

    // Fresh Main accept after terminal review restores authority.
    recordMainReview(fx.store, fx.task.id, {
      decision: "accept",
      reason: "Main overrides judge reject with explicit reason",
      confirm: true,
    });
    const status = getReviewGraphStatus(fx.store, fx.task.id)!;
    assert.equal(status.requiresFreshMainReview, false);
    assert.equal(status.blocksIntegration, false);
    receipt = await preflightIntegration(fx.store, fx.task.id, INTEGRATION_DEFAULTS);
    assert.equal(receipt.rejectionReasons.length, 0);

    fx.store.addEvent(
      fx.task.id,
      fx.attemptId,
      "integration.apply.completed",
      "Integration applied successfully",
    );
    const delivered = getReviewGraphStatus(fx.store, fx.task.id)!;
    assert.match(delivered.nextAction, /integrated successfully/i);
    assert.equal(delivered.nextActionCode, "integrated");
    assert.equal(delivered.blocksIntegration, false);
  } finally {
    fx.store.close();
  }
});

test("reviewer Task cannot pass Integration preflight", async () => {
  const fx = await buildSucceededCandidate();
  try {
    const created = await createReviewGraph(fx.store, fx.settings.get(), {
      candidateTaskId: fx.task.id,
      reviewerWorkerProfileId: fx.profileId,
      reason: "Judge only",
      confirm: true,
    });
    await finishReviewerWithResult(
      fx.store,
      created.reviewerTaskId,
      validResultJson(fx.revisionId, "accept"),
    );
    reconcileAllReviewGraphs(fx.store);
    const receipt = await preflightIntegration(
      fx.store,
      created.reviewerTaskId,
      INTEGRATION_DEFAULTS,
    );
    assert.ok(receipt.rejectionReasons.includes(REVIEWER_TASK_NOT_INTEGRATABLE));
  } finally {
    fx.store.close();
  }
});

test("duplicate same-set create is idempotent; changed or reordered set rejected", async () => {
  const fx = await buildSucceededCandidate();
  try {
    const alt = secondProfileId(fx.settings);
    const first = await createReviewGraph(fx.store, fx.settings.get(), {
      candidateTaskId: fx.task.id,
      reviewerWorkerProfileIds: [fx.profileId, alt],
      reason: "First multi-judge request",
      confirm: true,
    });
    assert.equal(first.created, true);
    assert.equal(first.reviewerTaskIds.length, 2);
    assert.equal(first.reviewerTaskId, first.reviewerTaskIds[0]);
    assert.equal(first.graph.maxAssignments, 2);

    const second = await createReviewGraph(fx.store, fx.settings.get(), {
      candidateTaskId: fx.task.id,
      reviewerWorkerProfileIds: [fx.profileId, alt],
      reason: "Duplicate same ordered set",
      confirm: true,
    });
    assert.equal(second.created, false);
    assert.equal(second.graph.id, first.graph.id);
    assert.deepEqual(second.reviewerTaskIds, first.reviewerTaskIds);

    // Single-profile alias must also match the frozen multi-judge set.
    await assert.rejects(
      () => createReviewGraph(fx.store, fx.settings.get(), {
        candidateTaskId: fx.task.id,
        reviewerWorkerProfileId: fx.profileId,
        reason: "Different set size",
        confirm: true,
      }),
      /different or reordered judge set|frozen set/i,
    );

    // Reordered set is rejected before mutation.
    await assert.rejects(
      () => createReviewGraph(fx.store, fx.settings.get(), {
        candidateTaskId: fx.task.id,
        reviewerWorkerProfileIds: [alt, fx.profileId],
        reason: "Reordered judges",
        confirm: true,
      }),
      /different or reordered judge set|frozen set/i,
    );
    assert.equal(fx.store.listReviewAssignments(first.graph.id).length, 2);
  } finally {
    fx.store.close();
  }
});

test("normalizeReviewerProfileIds rejects empty, duplicates, and more than three", () => {
  assert.deepEqual(
    normalizeReviewerProfileIds({ reviewerWorkerProfileId: " default " }),
    ["default"],
  );
  assert.deepEqual(
    normalizeReviewerProfileIds({ reviewerWorkerProfileIds: ["a", "b"] }),
    ["a", "b"],
  );
  assert.throws(
    () => normalizeReviewerProfileIds({ reviewerWorkerProfileIds: [] }),
    /at least one/,
  );
  assert.throws(
    () => normalizeReviewerProfileIds({
      reviewerWorkerProfileIds: ["a", "b", "c", "d"],
    }),
    /at most 3/,
  );
  assert.throws(
    () => normalizeReviewerProfileIds({
      reviewerWorkerProfileIds: ["a", "a"],
    }),
    /duplicate/,
  );
});

test("two judges disagree without voting, retry, or early terminal evidence", async () => {
  const fx = await buildSucceededCandidate();
  try {
    const alt = secondProfileId(fx.settings);
    const created = await createReviewGraph(fx.store, fx.settings.get(), {
      candidateTaskId: fx.task.id,
      reviewerWorkerProfileIds: [fx.profileId, alt],
      reason: "Independent second opinion",
      confirm: true,
    });
    assert.equal(created.graph.aggregation.state, "pending");
    assert.equal(created.graph.blocksIntegration, true);

    const [a1, a2] = fx.store.listReviewAssignments(created.graph.id);
    assert.ok(a1 && a2);
    assert.notEqual(a1.reviewerTaskId, a2.reviewerTaskId);
    // Isolated reviewer projects even for the same immutable packet.
    const t1 = fx.store.getTask(a1.reviewerTaskId);
    const t2 = fx.store.getTask(a2.reviewerTaskId);
    assert.notEqual(t1.spec.project, t2.spec.project);
    assert.equal(t1.spec.worker.allowEdits, false);
    assert.equal(t2.spec.worker.allowEdits, false);

    await finishReviewerWithResult(
      fx.store,
      a1.reviewerTaskId,
      validResultJson(fx.revisionId, "accept"),
    );
    reconcileReviewAssignment(fx.store, a1.id);
    let graph = fx.store.getReviewGraph(created.graph.id);
    assert.equal(graph.status, "pending");
    assert.equal(graph.terminalEvidenceSequence, undefined);
    let status = getReviewGraphStatus(fx.store, fx.task.id)!;
    assert.equal(status.aggregation.state, "pending");
    assert.equal(status.aggregation.usable, 1);
    assert.equal(status.aggregation.pending, 1);
    assert.equal(status.blocksIntegration, true);

    // Old Main accept still blocked by pending remaining judge.
    recordMainReview(fx.store, fx.task.id, {
      decision: "accept",
      reason: "Too early while second judge pending",
      confirm: true,
    });
    let receipt = await preflightIntegration(fx.store, fx.task.id, INTEGRATION_DEFAULTS);
    assert.ok(receipt.rejectionReasons.some((r) =>
      r.includes(PENDING_REVIEW_BLOCKS_INTEGRATION) || r.includes("pending judge"),
    ));

    await finishReviewerWithResult(
      fx.store,
      a2.reviewerTaskId,
      validResultJson(fx.revisionId, "reject"),
    );
    reconcileReviewAssignment(fx.store, a2.id);
    graph = fx.store.getReviewGraph(created.graph.id);
    assert.equal(graph.status, "completed");
    assert.ok(graph.terminalEvidenceSequence !== undefined);
    status = getReviewGraphStatus(fx.store, fx.task.id)!;
    assert.equal(status.aggregation.state, "disagreement");
    assert.equal(status.aggregation.usable, 2);
    assert.equal(status.aggregation.dispositionCounts.accept, 1);
    assert.equal(status.aggregation.dispositionCounts.reject, 1);
    assert.match(status.aggregation.explanation, /disagree/i);
    assert.equal(status.nextActionCode, "fresh-main-review-disagreement");
    assert.equal(status.requiresFreshMainReview, true);
    assert.equal(status.assignments.every((a) => a.resultUsable), true);

    receipt = await preflightIntegration(fx.store, fx.task.id, INTEGRATION_DEFAULTS);
    assert.ok(receipt.rejectionReasons.some((r) =>
      r.includes(STALE_MAIN_ACCEPT_AFTER_REVIEW) || r.includes("fresh Main"),
    ));

    // Fresh Main after complete terminal evidence restores authority.
    recordMainReview(fx.store, fx.task.id, {
      decision: "accept",
      reason: "Main resolves disagreement with explicit reason",
      confirm: true,
    });
    status = getReviewGraphStatus(fx.store, fx.task.id)!;
    assert.equal(status.requiresFreshMainReview, false);
    receipt = await preflightIntegration(fx.store, fx.task.id, INTEGRATION_DEFAULTS);
    assert.equal(receipt.rejectionReasons.length, 0);
  } finally {
    fx.store.close();
  }
});

test("partial useful evidence retained when another judge fails", async () => {
  const fx = await buildSucceededCandidate();
  try {
    const alt = secondProfileId(fx.settings);
    const created = await createReviewGraph(fx.store, fx.settings.get(), {
      candidateTaskId: fx.task.id,
      reviewerWorkerProfileIds: [fx.profileId, alt],
      reason: "Partial usefulness",
      confirm: true,
    });
    const [a1, a2] = fx.store.listReviewAssignments(created.graph.id);
    await finishReviewerWithResult(
      fx.store,
      a1!.reviewerTaskId,
      validResultJson(fx.revisionId, "revise"),
    );
    await finishReviewerWithResult(
      fx.store,
      a2!.reviewerTaskId,
      "not structured json at all",
    );
    reconcileAllReviewGraphs(fx.store);
    const status = getReviewGraphStatus(fx.store, fx.task.id)!;
    assert.equal(status.status, "completed");
    assert.equal(status.aggregation.state, "single-opinion");
    assert.equal(status.aggregation.usable, 1);
    assert.equal(status.aggregation.unusable, 1);
    assert.equal(status.assignments[0]!.resultUsable, true);
    assert.equal(status.assignments[1]!.resultUsable, false);
    assert.ok(status.assignments[1]!.failureCode);
    assert.match(status.aggregation.explanation, /unusable|single/i);
    // No replacement task was launched.
    assert.equal(fx.store.listReviewAssignments(created.graph.id).length, 2);
    assert.ok(status.terminalEvidenceSequence !== undefined);
  } finally {
    fx.store.close();
  }
});

test("all judges unusable fails as insufficient-evidence without retry", async () => {
  const fx = await buildSucceededCandidate();
  try {
    const alt = secondProfileId(fx.settings);
    const created = await createReviewGraph(fx.store, fx.settings.get(), {
      candidateTaskId: fx.task.id,
      reviewerWorkerProfileIds: [fx.profileId, alt],
      reason: "All unusable path",
      confirm: true,
    });
    const assignments = fx.store.listReviewAssignments(created.graph.id);
    for (const assignment of assignments) {
      await finishReviewerWithResult(
        fx.store,
        assignment.reviewerTaskId,
        undefined,
        "failed",
      );
    }
    reconcileAllReviewGraphs(fx.store);
    const status = getReviewGraphStatus(fx.store, fx.task.id)!;
    assert.equal(status.status, "failed");
    assert.equal(status.aggregation.state, "insufficient-evidence");
    assert.equal(status.aggregation.usable, 0);
    assert.equal(status.aggregation.unusable, 2);
    assert.equal(status.nextActionCode, "fresh-main-review-unusable");
    assert.equal(status.requiresFreshMainReview, true);
    assert.equal(fx.store.listReviewAssignments(created.graph.id).length, 2);
  } finally {
    fx.store.close();
  }
});

test("restart reconciliation keeps multi-judge graph open until all terminal", async () => {
  const fx = await buildSucceededCandidate();
  try {
    const alt = secondProfileId(fx.settings);
    const created = await createReviewGraph(fx.store, fx.settings.get(), {
      candidateTaskId: fx.task.id,
      reviewerWorkerProfileIds: [fx.profileId, alt],
      reason: "Restart multi-judge",
      confirm: true,
    });
    const [a1, a2] = fx.store.listReviewAssignments(created.graph.id);
    await finishReviewerWithResult(
      fx.store,
      a1!.reviewerTaskId,
      validResultJson(fx.revisionId, "accept"),
    );
    const first = reconcileAllReviewGraphs(fx.store);
    assert.ok(first.includes(a1!.id));
    let graph = fx.store.getReviewGraph(created.graph.id);
    assert.equal(graph.terminalEvidenceSequence, undefined);
    assert.notEqual(graph.status, "completed");
    assert.notEqual(graph.status, "failed");

    // Second recover pass does not duplicate the finished assignment.
    const noop = reconcileAllReviewGraphs(fx.store);
    assert.equal(noop.includes(a1!.id), false);

    await finishReviewerWithResult(
      fx.store,
      a2!.reviewerTaskId,
      validResultJson(fx.revisionId, "accept"),
    );
    const second = reconcileAllReviewGraphs(fx.store);
    assert.ok(second.includes(a2!.id));
    graph = fx.store.getReviewGraph(created.graph.id);
    assert.equal(graph.status, "completed");
    assert.ok(graph.terminalEvidenceSequence !== undefined);
    const status = getReviewGraphStatus(fx.store, fx.task.id)!;
    assert.equal(status.aggregation.state, "agreement");
    const again = reconcileAllReviewGraphs(fx.store);
    assert.equal(again.length, 0);
  } finally {
    fx.store.close();
  }
});

test("aggregateReviewAssignments agreement requires two usable same dispositions", () => {
  const base = {
    id: "a",
    graphId: "g",
    candidateTaskId: "c",
    candidateRevisionId: "r",
    reviewerWorkerProfileId: "p",
    reviewerTaskId: "t",
    reason: "x",
    frozenIdentity: {
      provider: "xai",
      model: "grok",
      runtime: "grok-build",
      effort: "high",
      workerProfileId: "p",
    },
    createdAt: "t",
    updatedAt: "t",
  };
  const pending = aggregateReviewAssignments([
    { ...base, id: "1", ordinal: 1, status: "running", reviewerTaskId: "t1" },
    { ...base, id: "2", ordinal: 2, status: "queued", reviewerTaskId: "t2", reviewerWorkerProfileId: "p2" },
  ]);
  assert.equal(pending.state, "pending");

  const agree = aggregateReviewAssignments([
    {
      ...base,
      id: "1",
      ordinal: 1,
      status: "completed",
      reviewerTaskId: "t1",
      result: {
        schemaVersion: 1,
        reviewedRevisionId: "r",
        proposedDisposition: "revise",
        summary: "ok",
        findings: [],
      },
    },
    {
      ...base,
      id: "2",
      ordinal: 2,
      status: "completed",
      reviewerTaskId: "t2",
      reviewerWorkerProfileId: "p2",
      result: {
        schemaVersion: 1,
        reviewedRevisionId: "r",
        proposedDisposition: "revise",
        summary: "also ok",
        findings: [],
      },
    },
  ]);
  assert.equal(agree.state, "agreement");
  assert.equal(agree.dispositionCounts.revise, 2);
});

test("stale Candidate Revision rejects before packet or Task creation", async () => {
  const fx = await buildSucceededCandidate();
  try {
    // Corrupt the live Diff so revision no longer matches.
    await writeFile(fx.task.paths.diff, "diff --git a/x b/x\n+stale\n");
    await assert.rejects(
      () => createReviewGraph(fx.store, fx.settings.get(), {
        candidateTaskId: fx.task.id,
        reviewerWorkerProfileId: fx.profileId,
        reason: "Should fail stale",
        confirm: true,
      }),
      /no longer matches|fresh revision/,
    );
    assert.equal(fx.store.getReviewGraphByCandidateTaskId(fx.task.id), undefined);
    assert.equal(fx.store.listTasks().filter((t) => t.id !== fx.task.id).length, 0);
  } finally {
    fx.store.close();
  }
});

test("unknown profile in plural set leaves no durable review state", async () => {
  const fx = await buildSucceededCandidate();
  try {
    const beforeTasks = fx.store.listTasks().length;
    const beforeEvents = fx.store.listEvents(fx.task.id).length;
    await assert.rejects(
      () => createReviewGraph(fx.store, fx.settings.get(), {
        candidateTaskId: fx.task.id,
        reviewerWorkerProfileIds: [fx.profileId, "unknown-judge-profile-xyz"],
        reason: "Should reject unknown second profile",
        confirm: true,
      }),
      /Unknown worker profile/i,
    );
    assert.equal(fx.store.getReviewGraphByCandidateTaskId(fx.task.id), undefined);
    assert.equal(fx.store.getReviewGraphByCandidateRevisionId(fx.revisionId), undefined);
    assert.equal(fx.store.listTasks().length, beforeTasks);
    assert.equal(fx.store.listEvents(fx.task.id).length, beforeEvents);
    assert.equal(
      fx.store.listEvents(fx.task.id).filter((e) => e.type.startsWith("review.")).length,
      0,
    );
  } finally {
    fx.store.close();
  }
});

test("createReviewGraphExecution rolls back when second reviewer insert collides", async () => {
  const fx = await buildSucceededCandidate();
  try {
    const seeded = await createReviewGraph(fx.store, fx.settings.get(), {
      candidateTaskId: fx.task.id,
      reviewerWorkerProfileId: fx.profileId,
      reason: "Seed one graph for collision fixture",
      confirm: true,
    });
    const existingReviewer = fx.store.getTask(seeded.reviewerTaskId);
    const now = new Date().toISOString();
    const graphId = "graph-rollback-collision";
    const assignmentId1 = "assign-rollback-1";
    const assignmentId2 = "assign-rollback-2";
    const newReviewerId = "reviewer-rollback-new";
    const frozenIdentity = {
      provider: "deepseek",
      model: "deepseek-v4-flash",
      runtime: "claude-code",
      effort: "low",
      workerProfileId: fx.profileId,
    };
    const cloneTask = (id: string): TaskRecord => {
      const cloned: TaskRecord = {
        ...existingReviewer,
        id,
        name: `Rollback clone ${id}`,
        createdAt: now,
        updatedAt: now,
      };
      delete cloned.currentAttemptId;
      delete cloned.finishedAt;
      delete cloned.workerPid;
      delete cloned.error;
      return cloned;
    };
    const graph = {
      schemaVersion: 1 as const,
      id: graphId,
      candidateTaskId: fx.task.id,
      candidateRevisionId: "fake-revision-for-rollback",
      attemptId: fx.attemptId,
      attemptOrdinal: 1,
      verificationEventSequence: fx.verificationSequence,
      patchDigest: "0".repeat(64),
      status: "pending" as const,
      round: 1 as const,
      maxAssignments: 2 as const,
      assignmentIds: [assignmentId1, assignmentId2],
      createdAt: now,
      updatedAt: now,
    };
    const makeAssignment = (id: string, ordinal: number, reviewerTaskId: string) => ({
      id,
      graphId,
      ordinal,
      candidateTaskId: fx.task.id,
      candidateRevisionId: "fake-revision-for-rollback",
      reviewerWorkerProfileId: fx.profileId,
      reviewerTaskId,
      status: "queued" as const,
      reason: "rollback fixture",
      frozenIdentity,
      createdAt: now,
      updatedAt: now,
    });
    // Second reviewer reuses an already-committed Task id so insert fails mid-transaction.
    assert.throws(
      () => fx.store.createReviewGraphExecution({
        graph,
        assignments: [
          makeAssignment(assignmentId1, 1, newReviewerId),
          makeAssignment(assignmentId2, 2, existingReviewer.id),
        ],
        reviewerTasks: [
          cloneTask(newReviewerId),
          cloneTask(existingReviewer.id),
        ],
        assignmentEvents: [
          { summary: "rollback assignment 1" },
          { summary: "rollback assignment 2" },
        ],
        reviewerCreationEvents: [
          { summary: "rollback reviewer 1" },
          { summary: "rollback reviewer 2" },
        ],
      }),
      /UNIQUE|unique|constraint|already|exists|SQLITE/i,
    );
    // Seeded graph remains; collision graph and new reviewer must not exist.
    assert.equal(fx.store.getReviewGraph(seeded.graph.id).id, seeded.graph.id);
    assert.equal(fx.store.getReviewGraphByCandidateRevisionId("fake-revision-for-rollback"), undefined);
    assert.throws(() => fx.store.getReviewGraph(graphId), /Unknown review graph/);
    assert.throws(() => fx.store.getTask(newReviewerId), /Unknown ForkLight task/);
    assert.equal(fx.store.listReviewAssignments(graphId).length, 0);
    assert.equal(
      fx.store.listEvents(fx.task.id).filter((e) =>
        e.summary.includes("rollback assignment"),
      ).length,
      0,
    );
  } finally {
    fx.store.close();
  }
});

test("restart reconciliation completes terminal reviewer evidence once", async () => {
  const fx = await buildSucceededCandidate();
  try {
    const created = await createReviewGraph(fx.store, fx.settings.get(), {
      candidateTaskId: fx.task.id,
      reviewerWorkerProfileId: fx.profileId,
      reason: "Restart safety",
      confirm: true,
    });
    await finishReviewerWithResult(
      fx.store,
      created.reviewerTaskId,
      validResultJson(fx.revisionId, "accept"),
    );
    // Simulate daemon recover path.
    const first = reconcileAllReviewGraphs(fx.store);
    assert.ok(first.length >= 1);
    const second = reconcileAllReviewGraphs(fx.store);
    assert.equal(second.length, 0);
    const status = getReviewGraphStatus(fx.store, fx.task.id)!;
    assert.equal(status.status, "completed");
    assert.equal(status.assignments[0]!.resultUsable, true);
  } finally {
    fx.store.close();
  }
});

test("safe projection never includes private packet, raw patch, or resultText", async () => {
  const fx = await buildSucceededCandidate();
  try {
    const created = await createReviewGraph(fx.store, fx.settings.get(), {
      candidateTaskId: fx.task.id,
      reviewerWorkerProfileId: fx.profileId,
      reason: "Privacy check",
      confirm: true,
    });
    await finishReviewerWithResult(
      fx.store,
      created.reviewerTaskId,
      validResultJson(fx.revisionId),
    );
    reconcileAllReviewGraphs(fx.store);
    const graph = fx.store.getReviewGraph(created.graph.id);
    const view = projectReviewGraph(
      graph,
      fx.store.listReviewAssignments(graph.id),
      fx.store.listEvents(fx.task.id),
    );
    const text = JSON.stringify(view);
    assert.ok(!text.includes("privatePacketPath"));
    assert.ok(!text.includes("packet.json"));
    assert.ok(!text.includes("resultText"));
    assert.ok(!text.includes("keychain"));
    assert.ok(!/\/Users\//.test(text));
    assert.ok(!text.includes("diff --git"));
  } finally {
    fx.store.close();
  }
});

test("Hub UI explains multi-judge review in English and Chinese", async () => {
  const app = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  assert.ok(app.includes("function renderJudgeReviewCard("));
  assert.ok(app.includes('data-fl-role", "judge-review"'));
  assert.ok(app.includes("/review-graph\""));
  assert.ok(app.includes("reviewerWorkerProfileIds"));
  assert.ok(app.includes("function judgeAggregationLabel("));
  assert.ok(app.includes("function judgeAggregationExplanation("));
  assert.ok(!app.includes("agg.explanation"));
  assert.ok(app.includes("if(!window.confirm(t(\"taskJudgeConfirm\"))) return"));
  for (const phrase of [
    "Assign one through three saved Workers as independent read-only judges",
    "Main decides. Judge output is evidence",
    "Usable judges disagree",
    "为当前精确的候选版本指派 1 到 3 个已保存的 Worker 作为独立只读裁判",
    "由 Main 做最终决定。裁判输出是证据",
    "可用裁判意见不一致",
    "仍有 {pending}/{total} 位独立裁判未完成",
  ]) {
    assert.ok(i18n.includes(phrase), phrase);
  }
});

test("daemon protocol: review_graph_create mutates; status is read-only", async () => {
  const { requiresMatchingBuildIdentity } = await import("../src/daemon/protocol.js");
  assert.equal(requiresMatchingBuildIdentity("review_graph_create"), true);
  assert.equal(requiresMatchingBuildIdentity("review_graph_status"), false);
});

test("create requires confirm and bounded reason", async () => {
  const fx = await buildSucceededCandidate();
  try {
    await assert.rejects(
      () => createReviewGraph(fx.store, fx.settings.get(), {
        candidateTaskId: fx.task.id,
        reviewerWorkerProfileId: fx.profileId,
        reason: "x",
        confirm: false as unknown as true,
      }),
      /confirm/,
    );
    await assert.rejects(
      () => createReviewGraph(fx.store, fx.settings.get(), {
        candidateTaskId: fx.task.id,
        reviewerWorkerProfileId: fx.profileId,
        reason: "",
        confirm: true,
      }),
      /reason/,
    );
  } finally {
    fx.store.close();
  }
});
