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
import { existsSync } from "node:fs";
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
  evaluateReviewResultRepairEligibility,
  getReviewGraphStatus,
  inspectReviewResultForCredentialLabelRepair,
  inspectReviewResultForSummaryRepair,
  normalizeReviewerProfileIds,
  parseReviewResultText,
  projectReviewGraph,
  reconcileAllReviewGraphs,
  reconcileReviewAssignment,
  reconcileReviewResultRepair,
  repairReviewResult,
  REVIEW_EVIDENCE_PATH_MAX,
  REVIEW_FINDING_TEXT_MAX,
  REVIEW_MAX_FINDINGS,
  REVIEW_RESULT_TEXT_MAX,
  REVIEW_SUMMARY_MAX,
  REVIEWER_TASK_NOT_INTEGRATABLE,
  PENDING_REVIEW_BLOCKS_INTEGRATION,
  STALE_MAIN_ACCEPT_AFTER_REVIEW,
  REQUIRED_REVIEW_GRAPH_MISSING,
  REQUIRED_REVIEW_GRAPH_UNDERSIZED,
  REQUIRED_REVIEW_GRAPH_INSUFFICIENT_USABLE,
  REQUIRED_REVIEW_GRAPH_STALE,
  evaluateReviewRequirementGate,
  evaluateReviewRequirementForTask,
  reviewerOutputBoundsLine,
} from "../src/core/review-graph.js";
import {
  buildWorkerPrompt,
  reviewerTerminalOutputLines,
  workerPromptAppendicesForTask,
} from "../src/core/task.js";
import { SettingsService, type IntegrationSettings } from "../src/core/settings.js";
import { upsertModelConfig } from "../src/core/model-catalog.js";
import { upsertWorkerProfile } from "../src/core/worker-profiles.js";
import type {
  AttemptRecord,
  TaskRecord,
  VerificationResult,
} from "../src/core/types.js";
import { StateStore } from "../src/state/store.js";
import { DEFAULT_ROUTING_POLICY } from "../src/core/model-routing.js";
import { projectStrategyPolicyAdvice } from "../src/core/strategy-advice.js";
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

test("public parseReviewResultText stays strict and ignores a fifth relaxed-bound argument", () => {
  const revisionId = "rev-public-strict";
  const over501 = otherwiseValidReviewJson(revisionId, REVIEW_SUMMARY_MAX + 1);
  assert.throws(
    () => parseReviewResultText(over501, revisionId, "t", "t"),
    /schema-violation/,
  );
  assert.equal(parseReviewResultText.length, 4);
  assert.throws(
    () => (parseReviewResultText as (...args: unknown[]) => unknown)(
      over501,
      revisionId,
      "t",
      "t",
      { summaryMax: REVIEW_RESULT_TEXT_MAX },
    ),
    /schema-violation/,
  );
  const inspected = inspectReviewResultForSummaryRepair(over501, revisionId, "t", "t");
  assert.equal(inspected.eligible, true);
  if (inspected.eligible) {
    assert.equal(inspected.original.summary.length, REVIEW_SUMMARY_MAX + 1);
  }
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

test("parseReviewResultText allows credential labels and rejects actual values", () => {
  const revisionId = "rev-label-value";
  const parseFields = (
    summary: string,
    findings: Array<{
      severity: "info" | "warning" | "error";
      evidencePath: string;
      affectedBehavior: string;
      recommendation: string;
    }> = [],
  ) => parseReviewResultText(
    JSON.stringify({
      schemaVersion: 1,
      reviewedRevisionId: revisionId,
      proposedDisposition: "accept",
      summary,
      findings,
    }),
    revisionId,
    "t",
    "t",
  );

  const option = parseFields("Document the --api-key flag without a value");
  assert.equal(option.proposedDisposition, "accept");
  assert.match(option.summary, /--api-key/);
  const env = parseFields("Mentions API_KEY as an environment field name");
  assert.match(env.summary, /API_KEY/);
  const kebab = parseFields("The api-key setting is documented");
  assert.match(kebab.summary, /api-key/);
  const findingLabels = parseFields("ok", [{
    severity: "info",
    evidencePath: "src/app.ts",
    affectedBehavior: "CLI still accepts --api-key",
    recommendation: "Keep API_KEY as a field name only",
  }]);
  assert.equal(findingLabels.findings.length, 1);
  const shortCliWord = parseFields("Mention --api-key abcdefg in the docs");
  assert.match(shortCliWord.summary, /--api-key/);
  const wrappedLabels = parseReviewResultText(
    `Discussed --api-key and API_KEY\n${validResultJson(revisionId)}\nDone.`,
    revisionId,
    "t",
    "t",
  );
  assert.equal(wrappedLabels.proposedDisposition, "revise");

  const unsafeSummary = (summary: string): void => {
    assert.throws(() => parseFields(summary), /unsafe-content/);
  };
  unsafeSummary("uses Bearer tokentoken");
  unsafeSummary("provider token sk-abcdefgh");
  unsafeSummary("password=hunter2");
  unsafeSummary("password: hunter2x");
  unsafeSummary("API_KEY=secret");
  unsafeSummary("API-KEY: assignedvalue");
  unsafeSummary("api-key=secret12");
  unsafeSummary("--api-key=secret12");
  unsafeSummary("export --api-key supersecret");
  unsafeSummary("export --api-key abcdefgh");
  assert.throws(
    () => parseFields("ok", [{
      severity: "error",
      evidencePath: "src/app.ts",
      affectedBehavior: "Command uses --api-key supersecret",
      recommendation: "Remove the value",
    }]),
    /unsafe-content/,
  );
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
    () => parseReviewResultText(
      `config has "api-key":"secret12"\n${validResultJson(revisionId)}`,
      revisionId,
      "t",
      "t",
    ),
    /unsafe-content/,
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

test("Review Graph reviewer Tasks freeze the reviewer Profile network policy per judge", async () => {
  const fx = await buildSucceededCandidate();
  try {
    // Seed a reviewer Profile with a credential-free custom proxy.
    const current = fx.settings.get();
    const catalog = upsertModelConfig(current.modelCatalog, {
      id: "reviewer-proxy-model",
      label: "Reviewer Proxy Model",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      endpoint: "https://api.deepseek.com/v1",
    });
    const profiles = upsertWorkerProfile(
      current.workerProfiles,
      {
        id: "reviewer-proxy",
        label: "Reviewer Proxy",
        runtime: "claude-code",
        modelConfigId: "reviewer-proxy-model",
        effort: "medium",
        networkPolicy: {
          mode: "custom-proxy",
          httpProxy: "http://127.0.0.1:7890",
          httpsProxy: "http://127.0.0.1:7891",
          noProxy: "localhost,127.0.0.1",
        },
      },
      catalog,
    );
    fx.settings.update({ modelCatalog: catalog, workerProfiles: profiles });

    // One legacy-inherit judge plus one custom-proxy judge.
    const created = await createReviewGraph(fx.store, fx.settings.get(), {
      candidateTaskId: fx.task.id,
      reviewerWorkerProfileIds: [fx.profileId, "reviewer-proxy"],
      reason: "Freeze reviewer network policy",
      confirm: true,
    });
    assert.equal(created.reviewerTaskIds.length, 2);

    const [inheritReviewer, proxyReviewer] = fx.store
      .listReviewAssignments(created.graph.id)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((assignment) => fx.store.getTask(assignment.reviewerTaskId));

    // Legacy-inherit Profile: absence of the field is the exact inherit behavior.
    assert.equal(inheritReviewer!.spec.networkPolicy, undefined);
    // Custom-proxy Profile: the reviewer Task freezes the exact policy.
    assert.deepEqual(proxyReviewer!.spec.networkPolicy, {
      mode: "custom-proxy",
      httpProxy: "http://127.0.0.1:7890",
      httpsProxy: "http://127.0.0.1:7891",
      noProxy: "localhost,127.0.0.1",
    });

    // Public projection exposes only mode-level identity, never proxy values.
    const view = projectReviewGraph(
      fx.store.getReviewGraph(created.graph.id),
      fx.store.listReviewAssignments(created.graph.id),
      fx.store.listEvents(fx.task.id),
    );
    const viewText = JSON.stringify(view);
    assert.ok(!viewText.includes("127.0.0.1:7890"));
    assert.ok(!viewText.includes("127.0.0.1:7891"));
    assert.ok(!viewText.includes("localhost,127.0.0.1"));
    assert.ok(!viewText.includes("httpProxy"));
    assert.ok(!viewText.includes("noProxy"));

    // Durable creation events (candidate + reviewer Tasks) never serialize proxy values.
    const candidateEventText = fx.store
      .listEvents(fx.task.id)
      .map((event) => JSON.stringify(event.payload))
      .join("\n");
    const reviewerEventText = created.reviewerTaskIds
      .flatMap((taskId) => fx.store.listEvents(taskId))
      .map((event) => JSON.stringify(event.payload))
      .join("\n");
    for (const eventText of [candidateEventText, reviewerEventText]) {
      assert.ok(!eventText.includes("127.0.0.1:7890"));
      assert.ok(!eventText.includes("noProxy"));
      assert.ok(!eventText.includes("httpProxy"));
    }
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
  assert.equal(requiresMatchingBuildIdentity("review_graph_repair_result"), true);
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

test("declared review requirement gate covers missing, undersized, pending, stale, and skip", () => {
  const skip = evaluateReviewRequirementGate({
    reviewRequirement: { requiredJudges: 0, reason: "Mechanical" },
  });
  assert.equal(skip.status, "explicit-skip");
  assert.equal(skip.blocksIntegration, false);

  const legacy = evaluateReviewRequirementGate({});
  assert.equal(legacy.status, "not-declared");
  assert.equal(legacy.blocksIntegration, false);

  const missing = evaluateReviewRequirementGate({
    reviewRequirement: { requiredJudges: 1, reason: "Need one Judge" },
    currentRevisionId: "rev-current",
  });
  assert.equal(missing.status, "missing");
  assert.ok(missing.rejectionReasons.includes(REQUIRED_REVIEW_GRAPH_MISSING));

  const twoRequired = evaluateReviewRequirementGate({
    reviewRequirement: { requiredJudges: 2, reason: "Need two Judges" },
    currentRevisionId: "rev-current",
    graph: {
      schemaVersion: 1,
      id: "g",
      candidateTaskId: "t",
      candidateRevisionId: "rev-current",
      attemptId: "a",
      attemptOrdinal: 1,
      verificationEventSequence: 2,
      patchDigest: "a".repeat(64),
      status: "completed",
      round: 1,
      maxAssignments: 1,
      assignmentIds: ["as1"],
      createdAt: "t",
      updatedAt: "t",
      terminalEvidenceSequence: 4,
    },
    assignments: [{
      id: "as1",
      graphId: "g",
      ordinal: 1,
      candidateTaskId: "t",
      candidateRevisionId: "rev-current",
      reviewerWorkerProfileId: "p",
      reviewerTaskId: "r",
      status: "completed",
      reason: "one",
      frozenIdentity: { provider: "deepseek", model: "m", runtime: "claude-code", effort: "low" },
      createdAt: "t",
      updatedAt: "t",
      result: {
        schemaVersion: 1,
        reviewedRevisionId: "rev-current",
        proposedDisposition: "accept",
        summary: "ok enough for a usable judge opinion",
        findings: [],
      },
    }],
    events: [{
      id: 5,
      taskId: "t",
      sequence: 5,
      timestamp: "t",
      type: "main-review.completed",
      summary: "accept",
    }],
  });
  assert.equal(twoRequired.status, "undersized");
  assert.equal(twoRequired.missingOpinions, 1);
  assert.ok(twoRequired.rejectionReasons.includes(REQUIRED_REVIEW_GRAPH_UNDERSIZED));

  const pending = evaluateReviewRequirementGate({
    reviewRequirement: { requiredJudges: 1, reason: "Need one Judge" },
    currentRevisionId: "rev-current",
    graph: {
      schemaVersion: 1,
      id: "g",
      candidateTaskId: "t",
      candidateRevisionId: "rev-current",
      attemptId: "a",
      attemptOrdinal: 1,
      verificationEventSequence: 2,
      patchDigest: "a".repeat(64),
      status: "running",
      round: 1,
      maxAssignments: 1,
      assignmentIds: ["as1"],
      createdAt: "t",
      updatedAt: "t",
    },
    assignments: [{
      id: "as1",
      graphId: "g",
      ordinal: 1,
      candidateTaskId: "t",
      candidateRevisionId: "rev-current",
      reviewerWorkerProfileId: "p",
      reviewerTaskId: "r",
      status: "running",
      reason: "one",
      frozenIdentity: { provider: "deepseek", model: "m", runtime: "claude-code", effort: "low" },
      createdAt: "t",
      updatedAt: "t",
    }],
  });
  assert.equal(pending.status, "pending");
  assert.ok(pending.rejectionReasons.includes(PENDING_REVIEW_BLOCKS_INTEGRATION));

  const stale = evaluateReviewRequirementGate({
    reviewRequirement: { requiredJudges: 1, reason: "Need one Judge" },
    currentRevisionId: "rev-new",
    graph: {
      schemaVersion: 1,
      id: "g",
      candidateTaskId: "t",
      candidateRevisionId: "rev-old",
      attemptId: "a",
      attemptOrdinal: 1,
      verificationEventSequence: 2,
      patchDigest: "a".repeat(64),
      status: "completed",
      round: 1,
      maxAssignments: 1,
      assignmentIds: ["as1"],
      createdAt: "t",
      updatedAt: "t",
      terminalEvidenceSequence: 4,
    },
    assignments: [{
      id: "as1",
      graphId: "g",
      ordinal: 1,
      candidateTaskId: "t",
      candidateRevisionId: "rev-old",
      reviewerWorkerProfileId: "p",
      reviewerTaskId: "r",
      status: "completed",
      reason: "one",
      frozenIdentity: { provider: "deepseek", model: "m", runtime: "claude-code", effort: "low" },
      createdAt: "t",
      updatedAt: "t",
      result: {
        schemaVersion: 1,
        reviewedRevisionId: "rev-old",
        proposedDisposition: "accept",
        summary: "ok enough for a usable judge opinion",
        findings: [],
      },
    }],
  });
  assert.equal(stale.status, "stale");
  assert.ok(stale.rejectionReasons.includes(REQUIRED_REVIEW_GRAPH_STALE));
  assert.ok(!stale.rejectionReasons.includes(REQUIRED_REVIEW_GRAPH_INSUFFICIENT_USABLE));
});

test("store-backed requirement gate is read-only and does not invent legacy policy", async () => {
  const fx = await buildSucceededCandidate();
  try {
    const legacy = evaluateReviewRequirementForTask(fx.store, fx.task.id);
    assert.equal(legacy.declared, false);
    assert.equal(legacy.status, "not-declared");
    assert.equal(legacy.blocksIntegration, false);

    const current = fx.store.getTask(fx.task.id);
    fx.store.updateTask(fx.task.id, {
      spec: {
        ...current.spec,
        reviewRequirement: { requiredJudges: 1, reason: "Need one independent Judge" },
      },
    });
    const missing = evaluateReviewRequirementForTask(fx.store, fx.task.id);
    assert.equal(missing.status, "missing");
    assert.ok(missing.rejectionReasons.includes(REQUIRED_REVIEW_GRAPH_MISSING));
    assert.equal(fx.store.getReviewGraphByCandidateTaskId(fx.task.id), undefined);
  } finally {
    fx.store.close();
  }
});

test("legacy and explicit-skip gates honor an existing Review Graph blocker", () => {
  const pendingGraph = {
    schemaVersion: 1 as const,
    id: "g-pending",
    candidateTaskId: "t",
    candidateRevisionId: "rev-current",
    attemptId: "a",
    attemptOrdinal: 1,
    verificationEventSequence: 2,
    patchDigest: "a".repeat(64),
    status: "running" as const,
    round: 1 as const,
    maxAssignments: 1 as const,
    assignmentIds: ["as1"],
    createdAt: "t",
    updatedAt: "t",
  };
  const pendingAssignment = {
    id: "as1",
    graphId: "g-pending",
    ordinal: 1,
    candidateTaskId: "t",
    candidateRevisionId: "rev-current",
    reviewerWorkerProfileId: "p",
    reviewerTaskId: "r",
    status: "running" as const,
    reason: "optional judge",
    frozenIdentity: {
      provider: "deepseek",
      model: "m",
      runtime: "claude-code",
      effort: "low",
    },
    createdAt: "t",
    updatedAt: "t",
  };

  const legacyPending = evaluateReviewRequirementGate({
    currentRevisionId: "rev-current",
    graph: pendingGraph,
    assignments: [pendingAssignment],
  });
  assert.equal(legacyPending.declared, false);
  assert.equal(legacyPending.status, "pending");
  assert.equal(legacyPending.blocksIntegration, true);
  assert.ok(legacyPending.rejectionReasons.includes(PENDING_REVIEW_BLOCKS_INTEGRATION));

  const skipPending = evaluateReviewRequirementGate({
    reviewRequirement: { requiredJudges: 0, reason: "Mechanical" },
    currentRevisionId: "rev-current",
    graph: pendingGraph,
    assignments: [pendingAssignment],
  });
  assert.equal(skipPending.declared, true);
  assert.equal(skipPending.requiredJudges, 0);
  assert.equal(skipPending.status, "pending");
  assert.equal(skipPending.blocksIntegration, true);
  assert.ok(skipPending.rejectionReasons.includes(PENDING_REVIEW_BLOCKS_INTEGRATION));

  const terminalGraph = {
    ...pendingGraph,
    id: "g-terminal",
    status: "completed" as const,
    terminalEvidenceSequence: 4,
  };
  const terminalAssignment = {
    ...pendingAssignment,
    id: "as-terminal",
    graphId: "g-terminal",
    status: "completed" as const,
    result: {
      schemaVersion: 1 as const,
      reviewedRevisionId: "rev-current",
      proposedDisposition: "accept" as const,
      summary: "ok enough for a usable judge opinion",
      findings: [],
    },
  };

  const legacyStaleMain = evaluateReviewRequirementGate({
    currentRevisionId: "rev-current",
    graph: terminalGraph,
    assignments: [terminalAssignment],
    events: [{
      id: 3,
      taskId: "t",
      sequence: 3,
      timestamp: "t",
      type: "main-review.completed",
      summary: "accept before terminal review",
    }],
  });
  assert.equal(legacyStaleMain.status, "stale-main-accept");
  assert.equal(legacyStaleMain.blocksIntegration, true);
  assert.ok(legacyStaleMain.rejectionReasons.includes(STALE_MAIN_ACCEPT_AFTER_REVIEW));

  const skipStaleMain = evaluateReviewRequirementGate({
    reviewRequirement: { requiredJudges: 0, reason: "Mechanical" },
    currentRevisionId: "rev-current",
    graph: terminalGraph,
    assignments: [terminalAssignment],
  });
  assert.equal(skipStaleMain.requiredJudges, 0);
  assert.equal(skipStaleMain.status, "stale-main-accept");
  assert.ok(skipStaleMain.rejectionReasons.includes(STALE_MAIN_ACCEPT_AFTER_REVIEW));

  const legacyFresh = evaluateReviewRequirementGate({
    currentRevisionId: "rev-current",
    graph: terminalGraph,
    assignments: [terminalAssignment],
    events: [{
      id: 5,
      taskId: "t",
      sequence: 5,
      timestamp: "t",
      type: "main-review.completed",
      summary: "fresh accept after review",
    }],
  });
  assert.equal(legacyFresh.status, "not-declared");
  assert.equal(legacyFresh.blocksIntegration, false);
  assert.equal(legacyFresh.rejectionReasons.length, 0);
});

function summaryOfLength(length: number): string {
  return "s".repeat(length);
}

function otherwiseValidReviewJson(
  revisionId: string,
  summaryLength: number,
  extras: {
    proposedDisposition?: "accept" | "revise" | "reject";
    extraRoot?: Record<string, unknown>;
    reviewedRevisionId?: string;
    findings?: unknown;
  } = {},
): string {
  return JSON.stringify({
    schemaVersion: 1,
    reviewedRevisionId: extras.reviewedRevisionId ?? revisionId,
    proposedDisposition: extras.proposedDisposition ?? "accept",
    summary: summaryOfLength(summaryLength),
    findings: extras.findings ?? [],
    ...extras.extraRoot,
  });
}

const HISTORICAL_LABEL_FINDINGS = [
  {
    severity: "info" as const,
    evidencePath: "src/app.ts",
    affectedBehavior: "Mentions API_KEY and api-key as field names only",
    recommendation: "Keep documenting the --api-key flag without embedding values",
  },
];

function labelOnlyReviewJson(
  revisionId: string,
  extras: {
    summary?: string;
    proposedDisposition?: "accept" | "revise" | "reject";
    extraRoot?: Record<string, unknown>;
    reviewedRevisionId?: string;
    findings?: unknown;
  } = {},
): string {
  return JSON.stringify({
    schemaVersion: 1,
    reviewedRevisionId: extras.reviewedRevisionId ?? revisionId,
    proposedDisposition: extras.proposedDisposition ?? "accept",
    summary: extras.summary
      ?? "The change correctly documents the --api-key option without storing a value",
    findings: extras.findings ?? HISTORICAL_LABEL_FINDINGS,
    ...extras.extraRoot,
  });
}

function persistHistoricalUnsafeContent(store: StateStore, assignmentId: string): void {
  const assignment = store.getReviewAssignment(assignmentId);
  const graph = store.getReviewGraph(assignment.graphId);
  const now = new Date().toISOString();
  store.updateReviewAssignmentAndGraph(
    {
      ...assignment,
      status: "failed",
      failureCode: "unsafe-content",
      updatedAt: now,
      completedAt: now,
    },
    {
      ...graph,
      status: "completed",
      updatedAt: now,
    },
  );
}

async function buildTwoJudgeFixture(): Promise<Fixture & {
  usableAssignmentId: string;
  failedAssignmentId: string;
  graphId: string;
}> {
  const fx = await buildSucceededCandidate();
  const alt = secondProfileId(fx.settings);
  const created = await createReviewGraph(fx.store, fx.settings.get(), {
    candidateTaskId: fx.task.id,
    reviewerWorkerProfileIds: [fx.profileId, alt],
    reason: "Two independent judges",
    confirm: true,
  });
  const [usable, failed] = fx.store.listReviewAssignments(created.graph.id);
  return {
    ...fx,
    usableAssignmentId: usable!.id,
    failedAssignmentId: failed!.id,
    graphId: created.graph.id,
  };
}

async function buildTwoAssignmentHistoricalLabelGraph(): Promise<Fixture & {
  usableAssignmentId: string;
  failedAssignmentId: string;
  originalFailureCode: string;
  originalReviewerTaskId: string;
  originalAttemptText: string;
  originalStatus: string;
}> {
  const fx = await buildTwoJudgeFixture();
  const usable = fx.store.getReviewAssignment(fx.usableAssignmentId);
  const failed = fx.store.getReviewAssignment(fx.failedAssignmentId);
  await finishReviewerWithResult(
    fx.store,
    usable.reviewerTaskId,
    validResultJson(fx.revisionId, "accept"),
  );
  reconcileReviewAssignment(fx.store, usable.id);
  const labelJson = labelOnlyReviewJson(fx.revisionId);
  await finishReviewerWithResult(fx.store, failed.reviewerTaskId, labelJson);
  persistHistoricalUnsafeContent(fx.store, failed.id);
  const failedAfter = fx.store.getReviewAssignment(failed.id);
  return {
    ...fx,
    originalFailureCode: failedAfter.failureCode ?? "",
    originalReviewerTaskId: failed.reviewerTaskId,
    originalAttemptText: fx.store.listAttempts(failed.reviewerTaskId).at(-1)?.resultText ?? "",
    originalStatus: failedAfter.status,
  };
}

async function buildTwoAssignmentOverlimitGraph(summaryLength = 507): Promise<Fixture & {
  usableAssignmentId: string;
  failedAssignmentId: string;
  originalFailureCode: string;
  originalReviewerTaskId: string;
  originalAttemptText: string;
  originalStatus: string;
  reviewRoundsBefore: number;
}> {
  const fx = await buildSucceededCandidate();
  const alt = secondProfileId(fx.settings);
  const created = await createReviewGraph(fx.store, fx.settings.get(), {
    candidateTaskId: fx.task.id,
    reviewerWorkerProfileIds: [fx.profileId, alt],
    reason: "Two independent judges",
    confirm: true,
  });
  const [usable, failed] = fx.store.listReviewAssignments(created.graph.id);
  await finishReviewerWithResult(
    fx.store,
    usable!.reviewerTaskId,
    validResultJson(fx.revisionId, "accept"),
  );
  const overlimit = otherwiseValidReviewJson(fx.revisionId, summaryLength);
  await finishReviewerWithResult(fx.store, failed!.reviewerTaskId, overlimit);
  reconcileAllReviewGraphs(fx.store);
  const failedAfter = fx.store.getReviewAssignment(failed!.id);
  const attemptText = fx.store.listAttempts(failed!.reviewerTaskId).at(-1)?.resultText ?? "";
  return {
    ...fx,
    usableAssignmentId: usable!.id,
    failedAssignmentId: failed!.id,
    originalFailureCode: failedAfter.failureCode ?? "",
    originalReviewerTaskId: failed!.reviewerTaskId,
    originalAttemptText: attemptText,
    originalStatus: failedAfter.status,
    reviewRoundsBefore: 0,
  };
}

test("inspectReviewResultForSummaryRepair admits 507/558/733 and rejects 500 and other defects", async () => {
  const { inspectReviewResultForSummaryRepair: inspectFromFocused } = await import("../src/core/review-result-repair.js");
  assert.equal(inspectFromFocused, inspectReviewResultForSummaryRepair);
  const revisionId = "rev-summary-repair";
  const taskId = "judge-1";
  for (const length of [507, 558, 733]) {
    const inspected = inspectReviewResultForSummaryRepair(
      otherwiseValidReviewJson(revisionId, length),
      revisionId,
      taskId,
      taskId,
    );
    assert.equal(inspected.eligible, true, `${length} should be eligible`);
    if (inspected.eligible) {
      assert.equal(inspected.original.summary.length, length);
      assert.equal(inspected.original.proposedDisposition, "accept");
    }
  }
  const atLimit = inspectReviewResultForSummaryRepair(
    otherwiseValidReviewJson(revisionId, REVIEW_SUMMARY_MAX),
    revisionId,
    taskId,
    taskId,
  );
  assert.equal(atLimit.eligible, false);
  assert.equal(atLimit.eligible ? undefined : atLimit.code, "summary-already-valid");

  const malformed = inspectReviewResultForSummaryRepair("not json", revisionId, taskId, taskId);
  assert.equal(malformed.eligible, false);

  const extra = inspectReviewResultForSummaryRepair(
    otherwiseValidReviewJson(revisionId, 507, { extraRoot: { extra: true } }),
    revisionId,
    taskId,
    taskId,
  );
  assert.equal(extra.eligible, false);
  assert.equal(extra.eligible ? undefined : extra.code, "extra-fields");

  const stale = inspectReviewResultForSummaryRepair(
    otherwiseValidReviewJson(revisionId, 507, { reviewedRevisionId: "other-rev" }),
    revisionId,
    taskId,
    taskId,
  );
  assert.equal(stale.eligible, false);
  assert.equal(stale.eligible ? undefined : stale.code, "stale-revision");

  const unsafe = inspectReviewResultForSummaryRepair(
    JSON.stringify({
      schemaVersion: 1,
      reviewedRevisionId: revisionId,
      proposedDisposition: "accept",
      summary: `${summaryOfLength(507)} Bearer sk-abcdefgh`,
      findings: [],
    }),
    revisionId,
    taskId,
    taskId,
  );
  assert.equal(unsafe.eligible, false);
  assert.equal(unsafe.eligible ? undefined : unsafe.code, "unsafe-content");

  const labeledOverlong = inspectReviewResultForSummaryRepair(
    JSON.stringify({
      schemaVersion: 1,
      reviewedRevisionId: revisionId,
      proposedDisposition: "accept",
      summary: `${summaryOfLength(498)}--api-key`,
      findings: [],
    }),
    revisionId,
    taskId,
    taskId,
  );
  assert.equal(labeledOverlong.eligible, true);
  if (labeledOverlong.eligible) {
    assert.equal(labeledOverlong.original.summary.length, 507);
    assert.match(labeledOverlong.original.summary, /--api-key/);
  }

  const oversized = inspectReviewResultForSummaryRepair(
    "x".repeat(REVIEW_RESULT_TEXT_MAX + 1),
    revisionId,
    taskId,
    taskId,
  );
  assert.equal(oversized.eligible, false);
  assert.equal(oversized.eligible ? undefined : oversized.code, "oversized");
});

test("one-shot schema-only repair admits 507, rejects siblings, and updates effective gate", async () => {
  const fx = await buildTwoAssignmentOverlimitGraph(507);
  try {
    const failedBefore = fx.store.getReviewAssignment(fx.failedAssignmentId);
    assert.equal(failedBefore.status, "failed");
    assert.equal(failedBefore.failureCode, "schema-violation");
    assert.equal(failedBefore.resultRepair, undefined);
    const beforeTasks = fx.store.listTasks().length;
    const beforeAssignments = fx.store.listReviewAssignments(
      fx.store.getReviewGraphByCandidateTaskId(fx.task.id)!.id,
    );
    assert.equal(beforeAssignments.length, 2);

    const missingConfirm = evaluateReviewResultRepairEligibility(fx.store, {
      candidateTaskId: fx.task.id,
      assignmentId: fx.failedAssignmentId,
    });
    assert.equal(missingConfirm.eligible, false);
    assert.equal(missingConfirm.code, "missing-confirm");

    const valid500 = await buildSucceededCandidate();
    try {
      const created = await createReviewGraph(valid500.store, valid500.settings.get(), {
        candidateTaskId: valid500.task.id,
        reviewerWorkerProfileIds: [valid500.profileId, secondProfileId(valid500.settings)],
        reason: "500-char sibling",
        confirm: true,
      });
      const [first, second] = valid500.store.listReviewAssignments(created.graph.id);
      await finishReviewerWithResult(
        valid500.store,
        first!.reviewerTaskId,
        validResultJson(valid500.revisionId, "accept"),
      );
      await finishReviewerWithResult(
        valid500.store,
        second!.reviewerTaskId,
        otherwiseValidReviewJson(valid500.revisionId, REVIEW_SUMMARY_MAX),
      );
      reconcileAllReviewGraphs(valid500.store);
      const completed = valid500.store.getReviewAssignment(second!.id);
      assert.equal(completed.status, "completed");
      const rejected500 = evaluateReviewResultRepairEligibility(valid500.store, {
        candidateTaskId: valid500.task.id,
        assignmentId: second!.id,
        confirm: true,
      });
      assert.equal(rejected500.eligible, false);
      await assert.rejects(
        () => repairReviewResult(valid500.store, valid500.settings.get(), {
          candidateTaskId: valid500.task.id,
          assignmentId: second!.id,
          reason: "500 does not need repair",
          confirm: true,
        }),
        /schema-violation|already|not a terminal/i,
      );
      assert.equal(valid500.store.getReviewAssignment(second!.id).resultRepair, undefined);
    } finally {
      valid500.store.close();
    }

    const wrongOwner = evaluateReviewResultRepairEligibility(fx.store, {
      candidateTaskId: "not-this-candidate",
      assignmentId: fx.failedAssignmentId,
      confirm: true,
    });
    assert.equal(wrongOwner.eligible, false);
    assert.equal(wrongOwner.code, "ownership-mismatch");

    const usableReject = evaluateReviewResultRepairEligibility(fx.store, {
      candidateTaskId: fx.task.id,
      assignmentId: fx.usableAssignmentId,
      confirm: true,
    });
    assert.equal(usableReject.eligible, false);

    const eligible = evaluateReviewResultRepairEligibility(fx.store, {
      candidateTaskId: fx.task.id,
      assignmentId: fx.failedAssignmentId,
      confirm: true,
    });
    assert.equal(eligible.eligible, true);
    assert.equal(eligible.kind, "overlong-summary");
    assert.equal(eligible.original?.summary.length, 507);

    const repaired = await repairReviewResult(fx.store, fx.settings.get(), {
      candidateTaskId: fx.task.id,
      assignmentId: fx.failedAssignmentId,
      reason: "Shorten only the over-limit summary",
      confirm: true,
    });
    assert.equal(repaired.created, true);
    const afterAssignment = fx.store.getReviewAssignment(fx.failedAssignmentId);
    assert.equal(afterAssignment.status, fx.originalStatus);
    assert.equal(afterAssignment.failureCode, fx.originalFailureCode);
    assert.equal(afterAssignment.reviewerTaskId, fx.originalReviewerTaskId);
    assert.equal(
      fx.store.listAttempts(fx.originalReviewerTaskId).at(-1)?.resultText,
      fx.originalAttemptText,
    );
    const graphRecord = fx.store.getReviewGraphByCandidateTaskId(fx.task.id)!;
    assert.equal(graphRecord.assignmentIds.length, 2);
    assert.equal(fx.store.listReviewAssignments(graphRecord.id).length, 2);
    assert.equal(fx.store.listTasks().length, beforeTasks + 1);
    const repairTask = fx.store.getTask(repaired.repairTaskId);
    assert.equal(repairTask.spec.worker.allowEdits, false);
    assert.equal(repairTask.spec.provider.name, afterAssignment.frozenIdentity.provider);
    assert.equal(repairTask.spec.provider.model, afterAssignment.frozenIdentity.model);
    assert.equal(repairTask.spec.runtime.name, afterAssignment.frozenIdentity.runtime);
    assert.equal(repairTask.spec.runtime.effort, afterAssignment.frozenIdentity.effort);
    assert.equal(repairTask.effectivePolicy?.values.baseMaxAttempts, 1);
    assert.equal(repairTask.effectivePolicy?.values.maxExtraAttempts, 0);
    assert.equal(repairTask.effectivePolicy?.values.maxMainCorrections, 0);
    assert.equal(repairTask.effectivePolicy?.values.maxAdaptationRounds, 0);
    assert.equal(repairTask.effectivePolicy?.values.maxMainReverifications, 0);
    assert.equal(repairTask.effectivePolicy?.values.maxWorkerValidationRepairs, 0);
    assert.equal(repairTask.taskFile.includes("result-repair"), true);

    await assert.rejects(
      () => repairReviewResult(fx.store, fx.settings.get(), {
        candidateTaskId: fx.task.id,
        assignmentId: fx.failedAssignmentId,
        reason: "Second request must fail closed",
        confirm: true,
      }),
      /already consumed|one-shot/i,
    );
    assert.equal(fx.store.listTasks().length, beforeTasks + 1);
    assert.equal(fx.store.getReviewAssignment(fx.failedAssignmentId).resultRepair?.taskId, repaired.repairTaskId);

    const shorter = otherwiseValidReviewJson(fx.revisionId, 80);
    await finishReviewerWithResult(fx.store, repaired.repairTaskId, shorter);
    reconcileReviewResultRepair(fx.store, fx.failedAssignmentId);
    const records = fx.store.listReviewAssignments(graphRecord.id);
    const aggregated = aggregateReviewAssignments(records);
    assert.equal(aggregated.usable, 2);
    assert.equal(aggregated.state, "agreement");
    assert.equal(aggregated.dispositionCounts.accept, 2);
    assert.match(aggregated.explanation, /accept/i);
    const status = getReviewGraphStatus(fx.store, fx.task.id)!;
    assert.equal(status.assignments.length, 2);
    assert.equal(status.aggregation.usable, 2);
    assert.equal(status.aggregation.state, "agreement");
    assert.equal(status.aggregation.dispositionCounts.accept, 2);
    assert.equal(status.requiresFreshMainReview, true);
    const failedView = status.assignments.find((row) => row.id === fx.failedAssignmentId)!;
    assert.equal(failedView.status, "failed");
    assert.equal(failedView.failureCode, "schema-violation");
    assert.equal(failedView.resultUsable, true);
    assert.equal(failedView.resultRepair?.resultUsable, true);
    assert.equal(failedView.result?.summary.length, 80);

    const receipt = await preflightIntegration(fx.store, fx.task.id, INTEGRATION_DEFAULTS);
    assert.ok(receipt.rejectionReasons.some((reason) =>
      reason.includes(STALE_MAIN_ACCEPT_AFTER_REVIEW) || reason.includes("fresh Main"),
    ));
    recordMainReview(fx.store, fx.task.id, {
      decision: "accept",
      reason: "Fresh Main accept after summary-only repair",
      confirm: true,
    });
    const afterAccept = await preflightIntegration(fx.store, fx.task.id, INTEGRATION_DEFAULTS);
    assert.equal(afterAccept.rejectionReasons.length, 0);
  } finally {
    fx.store.close();
  }
});

test("repair rejects failed Reviewer Tasks and permanently fails semantic drift", async () => {
  const fx = await buildSucceededCandidate();
  try {
    const alt = secondProfileId(fx.settings);
    const created = await createReviewGraph(fx.store, fx.settings.get(), {
      candidateTaskId: fx.task.id,
      reviewerWorkerProfileIds: [fx.profileId, alt],
      reason: "Drift and failed-task siblings",
      confirm: true,
    });
    const [usable, failed] = fx.store.listReviewAssignments(created.graph.id);
    await finishReviewerWithResult(
      fx.store,
      usable!.reviewerTaskId,
      validResultJson(fx.revisionId, "accept"),
    );
    await finishReviewerWithResult(
      fx.store,
      failed!.reviewerTaskId,
      "not structured",
      "failed",
    );
    reconcileAllReviewGraphs(fx.store);
    const failedTask = evaluateReviewResultRepairEligibility(fx.store, {
      candidateTaskId: fx.task.id,
      assignmentId: failed!.id,
      confirm: true,
    });
    assert.equal(failedTask.eligible, false);
    assert.ok(
      failedTask.code === "reviewer-task-not-succeeded"
      || failedTask.code === "failure-not-schema-violation",
    );

    const overlimitFx = await buildTwoAssignmentOverlimitGraph(558);
    try {
      const repaired = await repairReviewResult(overlimitFx.store, overlimitFx.settings.get(), {
        candidateTaskId: overlimitFx.task.id,
        assignmentId: overlimitFx.failedAssignmentId,
        reason: "Repair then drift",
        confirm: true,
      });
      await finishReviewerWithResult(
        overlimitFx.store,
        repaired.repairTaskId,
        otherwiseValidReviewJson(overlimitFx.revisionId, 40, { proposedDisposition: "reject" }),
      );
      const after = reconcileReviewResultRepair(overlimitFx.store, overlimitFx.failedAssignmentId);
      assert.equal(after.resultRepair?.status, "failed");
      assert.equal(after.resultRepair?.failureCode, "semantic-drift");
      assert.equal(after.status, "failed");
      assert.equal(after.failureCode, "schema-violation");
      const status = getReviewGraphStatus(overlimitFx.store, overlimitFx.task.id)!;
      assert.equal(status.aggregation.usable, 1);
      assert.equal(status.assignments.find((row) => row.id === overlimitFx.failedAssignmentId)?.resultUsable, false);
    } finally {
      overlimitFx.store.close();
    }
  } finally {
    fx.store.close();
  }
});

test("restart reconcile resumes the same repair Task on a terminal Graph", async () => {
  const fx = await buildTwoAssignmentOverlimitGraph(733);
  try {
    const repaired = await repairReviewResult(fx.store, fx.settings.get(), {
      candidateTaskId: fx.task.id,
      assignmentId: fx.failedAssignmentId,
      reason: "Queued repair before restart",
      confirm: true,
    });
    const graph = fx.store.getReviewGraphByCandidateTaskId(fx.task.id)!;
    assert.ok(graph.status === "completed" || graph.status === "failed");
    const first = reconcileAllReviewGraphs(fx.store);
    const second = reconcileAllReviewGraphs(fx.store);
    assert.equal(fx.store.getReviewAssignment(fx.failedAssignmentId).resultRepair?.taskId, repaired.repairTaskId);
    assert.equal(fx.store.listReviewAssignments(graph.id).length, 2);
    assert.equal(fx.store.getReviewAssignment(fx.failedAssignmentId).failureCode, "schema-violation");
    assert.ok(!second.includes(repaired.repairTaskId));
    assert.equal(
      fx.store.listTasks().filter((task) => task.taskFile.includes("result-repair")).length,
      1,
    );
    void first;
  } finally {
    fx.store.close();
  }
});

test("interrupted repair Task stays resumable and does not consume the one-shot", async () => {
  const fx = await buildTwoAssignmentOverlimitGraph(507);
  try {
    const repaired = await repairReviewResult(fx.store, fx.settings.get(), {
      candidateTaskId: fx.task.id,
      assignmentId: fx.failedAssignmentId,
      reason: "Repair then daemon interrupt",
      confirm: true,
    });
    const now = new Date().toISOString();
    fx.store.setTaskStatus(repaired.repairTaskId, "running", { startedAt: now });
    reconcileReviewResultRepair(fx.store, fx.failedAssignmentId);
    assert.equal(fx.store.getReviewAssignment(fx.failedAssignmentId).resultRepair?.status, "running");

    fx.store.setTaskStatus(repaired.repairTaskId, "interrupted", {
      finishedAt: now,
      error: "ForkLight daemon restarted during execution",
    });
    const first = reconcileAllReviewGraphs(fx.store);
    const after = fx.store.getReviewAssignment(fx.failedAssignmentId);
    assert.equal(after.resultRepair?.taskId, repaired.repairTaskId);
    assert.notEqual(after.resultRepair?.status, "failed");
    assert.equal(after.resultRepair?.failureCode, undefined);
    assert.equal(after.failureCode, "schema-violation");
    assert.equal(
      fx.store.listTasks().filter((task) => task.taskFile.includes("result-repair")).length,
      1,
    );

    const second = reconcileAllReviewGraphs(fx.store);
    assert.equal(fx.store.getReviewAssignment(fx.failedAssignmentId).resultRepair?.status, "running");
    assert.equal(fx.store.getTask(repaired.repairTaskId).status, "interrupted");
    void first;
    void second;

    await finishReviewerWithResult(
      fx.store,
      repaired.repairTaskId,
      otherwiseValidReviewJson(fx.revisionId, 60),
    );
    reconcileReviewResultRepair(fx.store, fx.failedAssignmentId);
    const status = getReviewGraphStatus(fx.store, fx.task.id)!;
    assert.equal(status.aggregation.usable, 2);
    assert.equal(status.aggregation.state, "agreement");
  } finally {
    fx.store.close();
  }
});

function repairProjectDirFor(
  store: StateStore,
  graphId: string,
  assignmentId: string,
): string {
  return path.join(
    path.dirname(store.databasePath),
    "review-projects",
    graphId,
    assignmentId,
    "result-repair",
  );
}

function repairEventCount(store: StateStore, candidateTaskId: string): number {
  return store.listEvents(candidateTaskId).filter((event) =>
    event.type === "review.result-repair.created"
    || event.type === "review.result-repair.completed"
    || event.type === "review.result-repair.failed"
  ).length;
}

test("repair rejects missing, unreadable, or invalid private packet before any mutation", async () => {
  const assertNoMutation = async (
    fx: Awaited<ReturnType<typeof buildTwoAssignmentOverlimitGraph>>,
    mutate: () => Promise<void>,
  ): Promise<void> => {
    const assignment = fx.store.getReviewAssignment(fx.failedAssignmentId);
    const graph = fx.store.getReviewGraph(assignment.graphId);
    const projectDir = repairProjectDirFor(fx.store, graph.id, assignment.id);
    const tasksBefore = fx.store.listTasks().length;
    const eventsBefore = repairEventCount(fx.store, fx.task.id);
    await mutate();
    const rejected = evaluateReviewResultRepairEligibility(fx.store, {
      candidateTaskId: fx.task.id,
      assignmentId: fx.failedAssignmentId,
      confirm: true,
    });
    assert.equal(rejected.eligible, false);
    assert.equal(rejected.code, "private-packet-unavailable");
    await assert.rejects(
      () => repairReviewResult(fx.store, fx.settings.get(), {
        candidateTaskId: fx.task.id,
        assignmentId: fx.failedAssignmentId,
        reason: "Packet must fail closed",
        confirm: true,
      }),
      /private packet is missing, unreadable, or invalid/i,
    );
    const after = fx.store.getReviewAssignment(fx.failedAssignmentId);
    assert.equal(after.resultRepair, undefined);
    assert.equal(after.status, fx.originalStatus);
    assert.equal(after.failureCode, fx.originalFailureCode);
    assert.equal(fx.store.listTasks().length, tasksBefore);
    assert.equal(repairEventCount(fx.store, fx.task.id), eventsBefore);
    assert.equal(existsSync(projectDir), false);
  };

  const missing = await buildTwoAssignmentOverlimitGraph(507);
  try {
    await assertNoMutation(missing, async () => {
      const assignment = missing.store.getReviewAssignment(missing.failedAssignmentId);
      const graph = missing.store.getReviewGraph(assignment.graphId);
      const withoutPacket = { ...assignment };
      delete withoutPacket.privatePacketPath;
      missing.store.updateReviewAssignmentAndGraph(withoutPacket, graph);
    });
  } finally {
    missing.store.close();
  }

  const unreadable = await buildTwoAssignmentOverlimitGraph(507);
  try {
    await assertNoMutation(unreadable, async () => {
      const assignment = unreadable.store.getReviewAssignment(unreadable.failedAssignmentId);
      const graph = unreadable.store.getReviewGraph(assignment.graphId);
      const blocker = path.join(unreadable.home, "packet-not-a-file");
      await mkdir(blocker);
      unreadable.store.updateReviewAssignmentAndGraph(
        { ...assignment, privatePacketPath: blocker },
        graph,
      );
    });
  } finally {
    unreadable.store.close();
  }

  const invalid = await buildTwoAssignmentOverlimitGraph(507);
  try {
    await assertNoMutation(invalid, async () => {
      const assignment = invalid.store.getReviewAssignment(invalid.failedAssignmentId);
      assert.ok(assignment.privatePacketPath);
      await writeFile(assignment.privatePacketPath, "not-json{");
    });
  } finally {
    invalid.store.close();
  }
});

test("admitted repair copies the original private packet bytes unchanged", async () => {
  const fx = await buildTwoAssignmentOverlimitGraph(507);
  try {
    const assignment = fx.store.getReviewAssignment(fx.failedAssignmentId);
    assert.ok(assignment.privatePacketPath);
    const marked = Buffer.concat([
      await readFile(assignment.privatePacketPath),
      Buffer.from("\n\n"),
    ]);
    await writeFile(assignment.privatePacketPath, marked);
    const repaired = await repairReviewResult(fx.store, fx.settings.get(), {
      candidateTaskId: fx.task.id,
      assignmentId: fx.failedAssignmentId,
      reason: "Copy exact packet bytes",
      confirm: true,
    });
    const graph = fx.store.getReviewGraphByCandidateTaskId(fx.task.id)!;
    const copied = await readFile(
      path.join(
        repairProjectDirFor(fx.store, graph.id, fx.failedAssignmentId),
        "REVIEW_PACKET.json",
      ),
    );
    assert.deepEqual(copied, marked);
    assert.equal(repaired.created, true);
    assert.equal(
      fx.store.getReviewAssignment(fx.failedAssignmentId).resultRepair?.taskId,
      repaired.repairTaskId,
    );
  } finally {
    fx.store.close();
  }
});

test("inspectReviewResultForCredentialLabelRepair admits label-only JSON and rejects values", async () => {
  const { inspectReviewResultForCredentialLabelRepair: inspectFromFocused } = await import(
    "../src/core/review-result-repair.js"
  );
  assert.equal(inspectFromFocused, inspectReviewResultForCredentialLabelRepair);
  const revisionId = "rev-label-inspect";
  const taskId = "judge-1";
  const admitted = inspectReviewResultForCredentialLabelRepair(
    labelOnlyReviewJson(revisionId),
    revisionId,
    taskId,
    taskId,
  );
  assert.equal(admitted.eligible, true);
  if (admitted.eligible) {
    assert.equal(admitted.original.proposedDisposition, "accept");
    assert.match(admitted.original.summary, /--api-key/);
  }

  const missingLabel = inspectReviewResultForCredentialLabelRepair(
    validResultJson(revisionId),
    revisionId,
    taskId,
    taskId,
  );
  assert.equal(missingLabel.eligible, false);
  assert.equal(missingLabel.eligible ? undefined : missingLabel.code, "missing-known-label");

  const actualValues = [
    "export --api-key supersecret",
    "API_KEY=secret",
    "API-KEY: assignedvalue",
    '"api-key":"secret12"',
    "uses Bearer tokentoken",
    "provider token sk-abcdefgh",
    "password=hunter2",
  ];
  for (const summary of actualValues) {
    const inspected = inspectReviewResultForCredentialLabelRepair(
      JSON.stringify({
        schemaVersion: 1,
        reviewedRevisionId: revisionId,
        proposedDisposition: "accept",
        summary,
        findings: [],
      }),
      revisionId,
      taskId,
      taskId,
    );
    assert.equal(inspected.eligible, false, summary);
    assert.equal(inspected.eligible ? undefined : inspected.code, "unsafe-content", summary);
  }

  const extra = inspectReviewResultForCredentialLabelRepair(
    labelOnlyReviewJson(revisionId, { extraRoot: { extra: true } }),
    revisionId,
    taskId,
    taskId,
  );
  assert.equal(extra.eligible, false);
  assert.equal(extra.eligible ? undefined : extra.code, "extra-fields");
});

test("historical label-only unsafe-content repair is one-shot, same-identity, and gates Integration", async () => {
  const fx = await buildTwoAssignmentHistoricalLabelGraph();
  try {
    const failedBefore = fx.store.getReviewAssignment(fx.failedAssignmentId);
    assert.equal(failedBefore.status, "failed");
    assert.equal(failedBefore.failureCode, "unsafe-content");
    assert.equal(failedBefore.resultRepair, undefined);
    const beforeTasks = fx.store.listTasks().length;
    const graphId = fx.store.getReviewGraphByCandidateTaskId(fx.task.id)!.id;
    assert.equal(fx.store.listReviewAssignments(graphId).length, 2);

    const missingConfirm = evaluateReviewResultRepairEligibility(fx.store, {
      candidateTaskId: fx.task.id,
      assignmentId: fx.failedAssignmentId,
    });
    assert.equal(missingConfirm.eligible, false);
    assert.equal(missingConfirm.code, "missing-confirm");

    const eligible = evaluateReviewResultRepairEligibility(fx.store, {
      candidateTaskId: fx.task.id,
      assignmentId: fx.failedAssignmentId,
      confirm: true,
    });
    assert.equal(eligible.eligible, true);
    assert.equal(eligible.kind, "credential-label");
    assert.match(eligible.original?.summary ?? "", /--api-key/);

    const repaired = await repairReviewResult(fx.store, fx.settings.get(), {
      candidateTaskId: fx.task.id,
      assignmentId: fx.failedAssignmentId,
      reason: "Rewrite only the label-only summary",
      confirm: true,
    });
    assert.equal(repaired.created, true);
    const afterAssignment = fx.store.getReviewAssignment(fx.failedAssignmentId);
    assert.equal(afterAssignment.status, fx.originalStatus);
    assert.equal(afterAssignment.failureCode, fx.originalFailureCode);
    assert.equal(afterAssignment.reviewerTaskId, fx.originalReviewerTaskId);
    assert.equal(
      fx.store.listAttempts(fx.originalReviewerTaskId).at(-1)?.resultText,
      fx.originalAttemptText,
    );
    assert.equal(fx.store.listReviewAssignments(graphId).length, 2);
    assert.equal(fx.store.listTasks().length, beforeTasks + 1);
    const repairTask = fx.store.getTask(repaired.repairTaskId);
    assert.equal(repairTask.spec.worker.allowEdits, false);
    assert.equal(repairTask.spec.provider.name, afterAssignment.frozenIdentity.provider);
    assert.equal(repairTask.spec.provider.model, afterAssignment.frozenIdentity.model);
    assert.equal(repairTask.spec.runtime.name, afterAssignment.frozenIdentity.runtime);
    assert.equal(repairTask.spec.runtime.effort, afterAssignment.frozenIdentity.effort);
    assert.equal(repairTask.effectivePolicy?.values.baseMaxAttempts, 1);
    assert.equal(repairTask.effectivePolicy?.values.maxExtraAttempts, 0);
    const instructions = await readFile(
      path.join(repairProjectDirFor(fx.store, graphId, fx.failedAssignmentId), "INSTRUCTIONS.md"),
      "utf8",
    );
    assert.match(instructions, /credential field or option name/);
    assert.match(instructions, /do not write secret values/i);
    assert.doesNotMatch(instructions, /Shorten ONLY the summary field to at most 500 characters/);

    await assert.rejects(
      () => repairReviewResult(fx.store, fx.settings.get(), {
        candidateTaskId: fx.task.id,
        assignmentId: fx.failedAssignmentId,
        reason: "Second historical request must fail closed",
        confirm: true,
      }),
      /already consumed|one-shot/i,
    );
    assert.equal(fx.store.listTasks().length, beforeTasks + 1);
    assert.equal(
      fx.store.getReviewAssignment(fx.failedAssignmentId).resultRepair?.taskId,
      repaired.repairTaskId,
    );

    await finishReviewerWithResult(
      fx.store,
      repaired.repairTaskId,
      labelOnlyReviewJson(fx.revisionId, {
        summary: "Documents --api-key, API_KEY, and api-key as names only",
      }),
    );
    reconcileReviewResultRepair(fx.store, fx.failedAssignmentId);
    const status = getReviewGraphStatus(fx.store, fx.task.id)!;
    assert.equal(status.assignments.length, 2);
    assert.equal(status.aggregation.usable, 2);
    assert.equal(status.aggregation.state, "agreement");
    assert.equal(status.requiresFreshMainReview, true);
    const failedView = status.assignments.find((row) => row.id === fx.failedAssignmentId)!;
    assert.equal(failedView.status, "failed");
    assert.equal(failedView.failureCode, "unsafe-content");
    assert.equal(failedView.resultUsable, true);
    assert.equal(failedView.resultRepair?.resultUsable, true);
    assert.match(failedView.result?.summary ?? "", /API_KEY/);
    assert.deepEqual(failedView.result?.findings, HISTORICAL_LABEL_FINDINGS);

    const receipt = await preflightIntegration(fx.store, fx.task.id, INTEGRATION_DEFAULTS);
    assert.ok(receipt.rejectionReasons.some((reason) =>
      reason.includes(STALE_MAIN_ACCEPT_AFTER_REVIEW) || reason.includes("fresh Main"),
    ));
    recordMainReview(fx.store, fx.task.id, {
      decision: "accept",
      reason: "Fresh Main accept after label-only summary repair",
      confirm: true,
    });
    const afterAccept = await preflightIntegration(fx.store, fx.task.id, INTEGRATION_DEFAULTS);
    assert.equal(afterAccept.rejectionReasons.length, 0);
  } finally {
    fx.store.close();
  }
});

test("historical label repair permanently fails when the repaired summary is unchanged", async () => {
  const fx = await buildTwoAssignmentHistoricalLabelGraph();
  try {
    const repaired = await repairReviewResult(fx.store, fx.settings.get(), {
      candidateTaskId: fx.task.id,
      assignmentId: fx.failedAssignmentId,
      reason: "Repair then return the original summary unchanged",
      confirm: true,
    });
    await finishReviewerWithResult(fx.store, repaired.repairTaskId, fx.originalAttemptText);
    const after = reconcileReviewResultRepair(fx.store, fx.failedAssignmentId);
    assert.equal(after.resultRepair?.status, "failed");
    assert.equal(after.resultRepair?.failureCode, "semantic-drift");
    assert.equal(after.status, "failed");
    assert.equal(after.failureCode, "unsafe-content");
    assert.equal(after.resultRepair?.taskId, repaired.repairTaskId);
    assert.equal(after.resultRepair?.result, undefined);
    const status = getReviewGraphStatus(fx.store, fx.task.id)!;
    const failedView = status.assignments.find((row) => row.id === fx.failedAssignmentId)!;
    assert.equal(status.aggregation.usable, 1);
    assert.equal(failedView.resultUsable, false);
    assert.equal(failedView.resultRepair?.resultUsable, false);
    assert.equal(failedView.status, "failed");
    assert.equal(failedView.failureCode, "unsafe-content");
    await assert.rejects(
      () => repairReviewResult(fx.store, fx.settings.get(), {
        candidateTaskId: fx.task.id,
        assignmentId: fx.failedAssignmentId,
        reason: "No retry after unchanged-summary drift",
        confirm: true,
      }),
      /already consumed|one-shot/i,
    );
  } finally {
    fx.store.close();
  }
});

test("historical unsafe-content repair rejects siblings before mutation", async () => {
  const assertNoMutation = async (
    setup: (fx: Awaited<ReturnType<typeof buildTwoJudgeFixture>>) => Promise<void>,
    expectedCode?: string,
  ): Promise<void> => {
    const fx = await buildTwoJudgeFixture();
    try {
      const usable = fx.store.getReviewAssignment(fx.usableAssignmentId);
      await finishReviewerWithResult(
        fx.store,
        usable.reviewerTaskId,
        validResultJson(fx.revisionId, "accept"),
      );
      reconcileReviewAssignment(fx.store, usable.id);
      await setup(fx);
      const assignment = fx.store.getReviewAssignment(fx.failedAssignmentId);
      const projectDir = repairProjectDirFor(fx.store, fx.graphId, assignment.id);
      const tasksBefore = fx.store.listTasks().length;
      const eventsBefore = repairEventCount(fx.store, fx.task.id);
      const rejected = evaluateReviewResultRepairEligibility(fx.store, {
        candidateTaskId: fx.task.id,
        assignmentId: fx.failedAssignmentId,
        confirm: true,
      });
      assert.equal(rejected.eligible, false);
      if (expectedCode !== undefined) {
        assert.equal(rejected.code, expectedCode);
      }
      await assert.rejects(
        () => repairReviewResult(fx.store, fx.settings.get(), {
          candidateTaskId: fx.task.id,
          assignmentId: fx.failedAssignmentId,
          reason: "Sibling must fail closed",
          confirm: true,
        }),
      );
      const after = fx.store.getReviewAssignment(fx.failedAssignmentId);
      assert.equal(after.resultRepair, undefined);
      assert.equal(fx.store.listTasks().length, tasksBefore);
      assert.equal(repairEventCount(fx.store, fx.task.id), eventsBefore);
      assert.equal(existsSync(projectDir), false);
    } finally {
      fx.store.close();
    }
  };

  await assertNoMutation(async (fx) => {
    const failed = fx.store.getReviewAssignment(fx.failedAssignmentId);
    await finishReviewerWithResult(
      fx.store,
      failed.reviewerTaskId,
      JSON.stringify({
        schemaVersion: 1,
        reviewedRevisionId: fx.revisionId,
        proposedDisposition: "accept",
        summary: "export --api-key supersecret",
        findings: [],
      }),
    );
    reconcileReviewAssignment(fx.store, failed.id);
    assert.equal(fx.store.getReviewAssignment(failed.id).failureCode, "unsafe-content");
  }, "unsafe-content");

  await assertNoMutation(async (fx) => {
    const failed = fx.store.getReviewAssignment(fx.failedAssignmentId);
    await finishReviewerWithResult(fx.store, failed.reviewerTaskId, "not structured json");
    persistHistoricalUnsafeContent(fx.store, failed.id);
  }, "malformed-json");

  await assertNoMutation(async (fx) => {
    const failed = fx.store.getReviewAssignment(fx.failedAssignmentId);
    await finishReviewerWithResult(
      fx.store,
      failed.reviewerTaskId,
      labelOnlyReviewJson(fx.revisionId, { extraRoot: { extra: true } }),
    );
    persistHistoricalUnsafeContent(fx.store, failed.id);
  }, "extra-fields");

  await assertNoMutation(async (fx) => {
    const failed = fx.store.getReviewAssignment(fx.failedAssignmentId);
    await finishReviewerWithResult(
      fx.store,
      failed.reviewerTaskId,
      labelOnlyReviewJson(fx.revisionId, { reviewedRevisionId: "other-rev" }),
    );
    persistHistoricalUnsafeContent(fx.store, failed.id);
  }, "stale-revision");

  await assertNoMutation(async (fx) => {
    const failed = fx.store.getReviewAssignment(fx.failedAssignmentId);
    await finishReviewerWithResult(fx.store, failed.reviewerTaskId, "not structured", "failed");
    reconcileReviewAssignment(fx.store, failed.id);
  });

  await assertNoMutation(async (fx) => {
    const failed = fx.store.getReviewAssignment(fx.failedAssignmentId);
    await finishReviewerWithResult(
      fx.store,
      failed.reviewerTaskId,
      validResultJson(fx.revisionId, "accept"),
    );
    persistHistoricalUnsafeContent(fx.store, failed.id);
  }, "missing-known-label");

  await assertNoMutation(async (fx) => {
    const failed = fx.store.getReviewAssignment(fx.failedAssignmentId);
    await finishReviewerWithResult(
      fx.store,
      failed.reviewerTaskId,
      labelOnlyReviewJson(fx.revisionId),
    );
    persistHistoricalUnsafeContent(fx.store, failed.id);
    const assignment = fx.store.getReviewAssignment(failed.id);
    const graph = fx.store.getReviewGraph(assignment.graphId);
    const withoutPacket = { ...assignment };
    delete withoutPacket.privatePacketPath;
    fx.store.updateReviewAssignmentAndGraph(withoutPacket, graph);
  }, "private-packet-unavailable");
});

test("historical label repair permanently fails semantic drift and resumes the same Task", async () => {
  const driftFx = await buildTwoAssignmentHistoricalLabelGraph();
  try {
    const repaired = await repairReviewResult(driftFx.store, driftFx.settings.get(), {
      candidateTaskId: driftFx.task.id,
      assignmentId: driftFx.failedAssignmentId,
      reason: "Repair then drift",
      confirm: true,
    });
    await finishReviewerWithResult(
      driftFx.store,
      repaired.repairTaskId,
      labelOnlyReviewJson(driftFx.revisionId, { proposedDisposition: "reject" }),
    );
    const after = reconcileReviewResultRepair(driftFx.store, driftFx.failedAssignmentId);
    assert.equal(after.resultRepair?.status, "failed");
    assert.equal(after.resultRepair?.failureCode, "semantic-drift");
    assert.equal(after.status, "failed");
    assert.equal(after.failureCode, "unsafe-content");
    assert.equal(after.resultRepair?.taskId, repaired.repairTaskId);
    const status = getReviewGraphStatus(driftFx.store, driftFx.task.id)!;
    assert.equal(status.aggregation.usable, 1);
    assert.equal(
      status.assignments.find((row) => row.id === driftFx.failedAssignmentId)?.resultUsable,
      false,
    );
    await assert.rejects(
      () => repairReviewResult(driftFx.store, driftFx.settings.get(), {
        candidateTaskId: driftFx.task.id,
        assignmentId: driftFx.failedAssignmentId,
        reason: "No retry after drift",
        confirm: true,
      }),
      /already consumed|one-shot/i,
    );
  } finally {
    driftFx.store.close();
  }

  const findingFx = await buildTwoAssignmentHistoricalLabelGraph();
  try {
    const repaired = await repairReviewResult(findingFx.store, findingFx.settings.get(), {
      candidateTaskId: findingFx.task.id,
      assignmentId: findingFx.failedAssignmentId,
      reason: "Repair then change a finding",
      confirm: true,
    });
    await finishReviewerWithResult(
      findingFx.store,
      repaired.repairTaskId,
      labelOnlyReviewJson(findingFx.revisionId, {
        findings: [{
          severity: "warning",
          evidencePath: "src/app.ts",
          affectedBehavior: "Changed finding text",
          recommendation: "This is semantic drift",
        }],
      }),
    );
    const after = reconcileReviewResultRepair(findingFx.store, findingFx.failedAssignmentId);
    assert.equal(after.resultRepair?.status, "failed");
    assert.equal(after.resultRepair?.failureCode, "semantic-drift");
    assert.equal(after.failureCode, "unsafe-content");
  } finally {
    findingFx.store.close();
  }

  const revisionFx = await buildTwoAssignmentHistoricalLabelGraph();
  try {
    const repaired = await repairReviewResult(revisionFx.store, revisionFx.settings.get(), {
      candidateTaskId: revisionFx.task.id,
      assignmentId: revisionFx.failedAssignmentId,
      reason: "Repair then change revision",
      confirm: true,
    });
    await finishReviewerWithResult(
      revisionFx.store,
      repaired.repairTaskId,
      labelOnlyReviewJson(revisionFx.revisionId, { reviewedRevisionId: "other-rev" }),
    );
    const after = reconcileReviewResultRepair(revisionFx.store, revisionFx.failedAssignmentId);
    assert.equal(after.resultRepair?.status, "failed");
    assert.equal(after.resultRepair?.failureCode, "stale-revision");
    assert.equal(after.failureCode, "unsafe-content");
  } finally {
    revisionFx.store.close();
  }

  const restartFx = await buildTwoAssignmentHistoricalLabelGraph();
  try {
    const repaired = await repairReviewResult(restartFx.store, restartFx.settings.get(), {
      candidateTaskId: restartFx.task.id,
      assignmentId: restartFx.failedAssignmentId,
      reason: "Queued historical repair before restart",
      confirm: true,
    });
    const graph = restartFx.store.getReviewGraphByCandidateTaskId(restartFx.task.id)!;
    const first = reconcileAllReviewGraphs(restartFx.store);
    const second = reconcileAllReviewGraphs(restartFx.store);
    assert.equal(
      restartFx.store.getReviewAssignment(restartFx.failedAssignmentId).resultRepair?.taskId,
      repaired.repairTaskId,
    );
    assert.equal(restartFx.store.listReviewAssignments(graph.id).length, 2);
    assert.equal(
      restartFx.store.getReviewAssignment(restartFx.failedAssignmentId).failureCode,
      "unsafe-content",
    );
    assert.ok(!second.includes(repaired.repairTaskId));
    assert.equal(
      restartFx.store.listTasks().filter((task) => task.taskFile.includes("result-repair")).length,
      1,
    );
    void first;

    const now = new Date().toISOString();
    restartFx.store.setTaskStatus(repaired.repairTaskId, "running", { startedAt: now });
    reconcileReviewResultRepair(restartFx.store, restartFx.failedAssignmentId);
    restartFx.store.setTaskStatus(repaired.repairTaskId, "interrupted", {
      finishedAt: now,
      error: "ForkLight daemon restarted during execution",
    });
    reconcileAllReviewGraphs(restartFx.store);
    const interrupted = restartFx.store.getReviewAssignment(restartFx.failedAssignmentId);
    assert.equal(interrupted.resultRepair?.taskId, repaired.repairTaskId);
    assert.notEqual(interrupted.resultRepair?.status, "failed");
    assert.equal(interrupted.failureCode, "unsafe-content");
  } finally {
    restartFx.store.close();
  }
});

test("judge policy history counts shared identities once and never votes", () => {
  const shared = {
    provider: "xai",
    model: "grok-4.6",
    runtime: "grok-build",
    effort: "xhigh",
  };
  const projection = projectStrategyPolicyAdvice({
    taskClass: "coding:judge-policy",
    policy: DEFAULT_ROUTING_POLICY,
    competitionIntent: "none",
    competitionTriggers: [],
    shouldRunCompetition: false,
    exactEvidence: new Map(),
    ordinaryTasks: [{ taskClass: "coding:judge-policy", requiredJudges: 2 }],
    reviewGraphs: [{
      taskClass: "coding:judge-policy",
      assignments: [
        { ...shared, terminal: true, usable: true },
        { ...shared, terminal: true, usable: false },
        {
          provider: "deepseek",
          model: "v4",
          runtime: "claude-code",
          effort: "high",
          terminal: true,
          usable: true,
        },
      ],
    }],
  });
  assert.equal(projection.judgePolicy.determination, "explained");
  assert.equal(projection.judgePolicy.votes, false);
  assert.equal(projection.judgePolicy.infersRequirement, false);
  assert.equal(projection.judgePolicy.assignsOrReplacesJudge, false);
  assert.equal(projection.judgePolicy.changesIntegrationAuthority, false);
  assert.deepEqual(projection.judgePolicy.declaredRequiredJudges, {
    present: true,
    depths: [2],
    mixed: false,
  });
  assert.equal(projection.judgePolicy.usableOutcomeCount, 2);
  assert.equal(projection.judgePolicy.unusableOutcomeCount, 1);
  assert.equal(projection.judgePolicy.distinctUnderlyingIdentityCount, 2);

  const missing = projectStrategyPolicyAdvice({
    taskClass: "coding:judge-policy",
    policy: DEFAULT_ROUTING_POLICY,
    competitionIntent: "none",
    competitionTriggers: [],
    shouldRunCompetition: false,
    exactEvidence: new Map(),
    ordinaryTasks: [{ taskClass: "coding:judge-policy" }],
    reviewGraphs: [{
      taskClass: "coding:judge-policy",
      assignments: [{ ...shared, terminal: true, usable: false }],
    }],
  });
  assert.equal(missing.judgePolicy.determination, "cannot-determine");
  assert.ok(missing.judgePolicy.reasons.includes("requirement-absent"));
  assert.ok(missing.judgePolicy.reasons.includes("no-usable-history"));
  assert.equal(missing.judgePolicy.declaredRequiredJudges.present, false);
  assert.equal(missing.judgePolicy.usableOutcomeCount, 0);
  assert.equal(missing.judgePolicy.unusableOutcomeCount, 1);
});
