import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  defaultAdvancedPolicyFields,
  defaultEnforcementCapability,
} from "../src/core/advanced-policy.js";
import { captureCandidateRevision } from "../src/core/candidate-revision.js";
import { reverifyCandidate } from "../src/core/candidate-reverification.js";
import { taskPaths } from "../src/core/config.js";
import {
  preflightIntegration,
  applyIntegration,
} from "../src/core/integration.js";
import { recordMainReview } from "../src/core/main-review.js";
import {
  createReviewGraph,
  reconcileReviewAssignment,
  REVIEWER_TASK_NOT_INTEGRATABLE,
  PENDING_REVIEW_BLOCKS_INTEGRATION,
  STALE_MAIN_ACCEPT_AFTER_REVIEW,
} from "../src/core/review-graph.js";
import { SettingsService, type IntegrationSettings } from "../src/core/settings.js";
import type {
  AttemptRecord,
  DeliverySpec,
  EffectivePolicySnapshot,
  ProvenanceSource,
  TaskRecord,
  TaskSpec,
  VerificationResult,
} from "../src/core/types.js";
import { StateStore } from "../src/state/store.js";
import { prepareWorkspace } from "../src/workspace/copy.js";
import { createPathPolicy } from "../src/workspace/path-policy.js";
import { writeWorkspacePatchReport } from "../src/workspace/patch.js";

// --- Helpers ---

const INTEGRATION_DEFAULTS: IntegrationSettings = {
  reviewedPatchMaxFiles: 5,
  reviewedPatchMaxLines: 400,
  reviewReceiptTtlMs: 900_000,
  verificationTimeoutMs: 30_000,
  backupRetentionCount: 3,
  autoRollback: true,
};

function spec(project: string, acceptanceCommands: string[]): TaskSpec {
  return {
    version: 1,
    name: "Integration test",
    project,
    goal: "Prove integration safety",
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
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
    acceptance: { commands: acceptanceCommands },
  };
}

async function buildSucceededTask(
  store: StateStore,
  acceptanceCommands: string[],
  withAcceptedMainReview = true,
  delivery?: DeliverySpec,
): Promise<{ task: TaskRecord; sourceDir: string; taskHome: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const sourceDir = path.join(root, "source");
  const taskHome = path.join(root, "state");
  await mkdir(sourceDir);
  await writeFile(path.join(sourceDir, "readme.md"), "# hello\n\nThis is the original text.\n");
  await writeFile(path.join(sourceDir, "other.txt"), "Unrelated file content.\n");

  const paths = taskPaths(taskHome, "task-1");
  const taskSpec = spec(sourceDir, acceptanceCommands);
  if (delivery !== undefined) taskSpec.delivery = delivery;
  await prepareWorkspace(taskSpec, paths);

  // Simulate worker edit in workspace
  await writeFile(
    path.join(paths.workspace, "readme.md"),
    "# hello\n\nThis is the changed text.\n",
  );
  await writeWorkspacePatchReport(paths, createPathPolicy(taskSpec));

  const task: TaskRecord = {
    id: "task-1",
    name: taskSpec.name,
    status: "succeeded",
    sourcePath: sourceDir,
    taskFile: "/nonexistent/task.yaml",
    spec: taskSpec,
    paths,
    sessionId: "test-session",
    currentAttemptId: "attempt-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.createTask(task);
  const attempt: AttemptRecord = {
    id: "attempt-1",
    taskId: task.id,
    ordinal: 1,
    status: "succeeded",
    sessionId: task.sessionId,
    rawLogPath: path.join(paths.logs, "attempt-1.jsonl"),
    startedAt: task.createdAt,
    finishedAt: task.updatedAt,
    exitCode: 0,
    runtimeBudgetUsd: taskSpec.runtime.maxBudgetUsd,
  };
  store.createAttempt(attempt);
  const verification: VerificationResult = {
    passed: true,
    behaviorPassed: true,
    policyPassed: true,
    sourceCompatible: true,
    commands: acceptanceCommands.map((command) => ({
      command,
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
      timedOut: false,
    })),
    diffPath: paths.diff,
    sourceUnchanged: true,
  };
  store.addEvent(
    task.id,
    attempt.id,
    "verification.completed",
    "Independent verification passed",
    verification,
  );
  if (withAcceptedMainReview) {
    recordMainReview(store, task.id, {
      decision: "accept",
      reason: "Integration fixture independently verified",
      confirm: true,
    });
  }
  return { task: store.getTask(task.id), sourceDir, taskHome };
}

// --- Existing positive-path tests (updated to taskId signature) ---

test("preflight rejects non-succeeded task", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const task: TaskRecord = {
    id: "task-fail",
    name: "Failed task",
    status: "failed",
    sourcePath: "/tmp/does-not-exist",
    taskFile: "/nonexistent",
    spec: spec("/tmp/does-not-exist", ["true"]),
    paths: taskPaths(root, "task-fail"),
    sessionId: "test",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.createTask(task);

  const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
  assert.ok(receipt.rejectionReasons.length > 0);
  assert.match(receipt.rejectionReasons[0]!, /must be "succeeded"/);
});

test("preflight passes and apply succeeds with passing acceptance", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task, sourceDir } = await buildSucceededTask(store, ["true"]);

  const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
  assert.equal(receipt.rejectionReasons.length, 0);
  assert.ok(receipt.affectedFiles.includes("readme.md"));
  assert.ok(receipt.patchDigest.length > 0);

  const result = await applyIntegration(store, task.id, receipt.id, INTEGRATION_DEFAULTS);
  assert.equal(result.status, "applied");
  assert.deepEqual(
    result.stages?.map(({ stage, status }) => [stage, status]),
    [
      ["source-applied", "passed"],
      ["source-verified", "passed"],
      ["artifact-built", "not-applicable"],
      ["runtime-activated", "not-applicable"],
    ],
  );

  // Verify the source file changed
  const content = await readFile(path.join(sourceDir, "readme.md"), "utf8");
  assert.match(content, /changed text/);
});

test("integration runs all build commands and retains source when build fails", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-build-"));
  const store = new StateStore(root);
  try {
    const marker = path.join(root, "build-after-failure.txt");
    const { task, sourceDir } = await buildSucceededTask(
      store,
      ["true"],
      true,
      {
        buildCommands: [
          "node -e \"process.exit(7)\"",
          `node -e 'require("node:fs").writeFileSync(process.argv[1], "ran")' ${JSON.stringify(marker)}`,
        ],
        activationCommands: [],
        activationCheckCommands: [],
      },
    );
    const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    const result = await applyIntegration(
      store,
      task.id,
      receipt.id,
      INTEGRATION_DEFAULTS,
    );

    assert.equal(result.status, "retained-failure");
    assert.equal(await readFile(marker, "utf8"), "ran");
    assert.match(await readFile(path.join(sourceDir, "readme.md"), "utf8"), /changed text/);
    const build = result.stages?.find((stage) => stage.stage === "artifact-built");
    assert.equal(build?.status, "failed");
    assert.deepEqual(build?.commands?.map((command) => command.exitCode), [7, 0]);
  } finally {
    store.close();
  }
});

test("preflight receipt includes safe delivery plan from task snapshot", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-dp-"));
  const store = new StateStore(root);
  try {
    const { task } = await buildSucceededTask(
      store,
      ["true"],
      true,
      {
        buildCommands: ["npm ci"],
        activationCommands: ["npm run build"],
        activationCheckCommands: ["npm test"],
      },
    );
    const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    assert.equal(receipt.rejectionReasons.length, 0);
    assert.ok(receipt.deliveryPlan, "delivery plan must be present in receipt");
    assert.equal(receipt.deliveryPlan!.buildCommandCount, 1);
    assert.equal(receipt.deliveryPlan!.activationCommandCount, 1);
    assert.equal(receipt.deliveryPlan!.activationCheckCommandCount, 1);
    assert.equal(receipt.deliveryPlan!.outcome, "activation");
    assert.equal(receipt.deliveryPlan!.stages.artifactBuild, "required");
    assert.equal(receipt.deliveryPlan!.stages.runtimeActivation, "required");
    // Verify no command text leaked
    const serialized = JSON.stringify(receipt.deliveryPlan);
    assert.ok(!serialized.includes("npm ci"));
    assert.ok(!serialized.includes("npm test"));
  } finally {
    store.close();
  }
});

test("preflight event payload includes delivery plan", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-dp-ev-"));
  const store = new StateStore(root);
  try {
    const { task } = await buildSucceededTask(
      store,
      ["true"],
      true,
      { buildCommands: ["make"], activationCommands: [], activationCheckCommands: [] },
    );
    await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    const events = store.listEvents(task.id);
    const preflightEvent = events.find((e) => e.type === "integration.preflight.completed");
    assert.ok(preflightEvent, "preflight event must exist");
    const payload = preflightEvent!.payload as Record<string, unknown> | undefined;
    assert.ok(payload?.deliveryPlan, "preflight event payload must include deliveryPlan");
    const plan = payload!.deliveryPlan as Record<string, unknown>;
    assert.equal(plan.outcome, "build");
  } finally {
    store.close();
  }
});

test("preflight delivery plan for source-only task reports not-configured build and activation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-dp-src-"));
  const store = new StateStore(root);
  try {
    const { task } = await buildSucceededTask(store, ["true"]);
    const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    assert.ok(receipt.deliveryPlan);
    assert.equal(receipt.deliveryPlan!.outcome, "none");
    assert.equal(receipt.deliveryPlan!.stages.artifactBuild, "not-configured");
    assert.equal(receipt.deliveryPlan!.stages.runtimeActivation, "not-configured");
    assert.equal(receipt.deliveryPlan!.stages.sourceApply, "required");
    assert.equal(receipt.deliveryPlan!.stages.sourceVerify, "required");
  } finally {
    store.close();
  }
});

test("legacy receipt without deliveryPlan remains readable", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-leg-"));
  const store = new StateStore(root);
  try {
    const { task } = await buildSucceededTask(store, ["true"]);
    const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    assert.equal(receipt.rejectionReasons.length, 0);
    const stored = store.getIntegrationReceipt(receipt.id);
    assert.ok(stored);
    // Receipt was just created with delivery plan; test that absence is compatible
    const { deliveryPlan: _, ...withoutPlan } = receipt;
    const json = JSON.stringify(withoutPlan);
    const parsed = JSON.parse(json);
    assert.equal(parsed.deliveryPlan, undefined, "absent deliveryPlan parses as undefined");
    assert.equal(parsed.taskId, task.id);
  } finally {
    store.close();
  }
});

test("passing machine verification cannot preflight without current Main Codex accept", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-review-gate-"));
  const store = new StateStore(root);
  try {
    const { task } = await buildSucceededTask(store, ["true"], false);
    const rejected = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    assert.ok(rejected.rejectionReasons.includes("Main agent review acceptance is required"));

    recordMainReview(store, task.id, {
      decision: "accept",
      reason: "Diff is scoped and independently verified",
      confirm: true,
    });
    const accepted = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    assert.deepEqual(accepted.rejectionReasons, []);
  } finally {
    store.close();
  }
});

test("integration verification supports Git commands without source repository access", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-git-"));
  const store = new StateStore(root);
  try {
    const { task } = await buildSucceededTask(store, [
      "git diff --check",
      `test -n "$(git status --porcelain)"`,
    ]);
    const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    assert.deepEqual(receipt.rejectionReasons, []);

    const result = await applyIntegration(store, task.id, receipt.id, INTEGRATION_DEFAULTS);
    assert.equal(result.status, "applied");
    assert.deepEqual(
      result.verificationCommands?.map((command) => command.exitCode),
      [0, 0],
    );
    assert.equal(existsSync(path.join(task.sourcePath, ".git")), false);
  } finally {
    store.close();
  }
});

test("failed verification rolls back patch", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task, sourceDir } = await buildSucceededTask(store, ["false"]);

  const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
  assert.equal(receipt.rejectionReasons.length, 0);

  // Read original content before apply
  const before = await readFile(path.join(sourceDir, "readme.md"), "utf8");

  const result = await applyIntegration(store, task.id, receipt.id, INTEGRATION_DEFAULTS);
  assert.equal(result.status, "rolled-back");
  assert.ok(result.error?.includes("verification failed"));

  // Verify source was restored
  const after = await readFile(path.join(sourceDir, "readme.md"), "utf8");
  assert.equal(after, before);
});

test("unrelated user edit does not block preflight or apply", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task, sourceDir } = await buildSucceededTask(store, ["true"]);

  // Modify an unrelated source file (not in the diff)
  await writeFile(path.join(sourceDir, "other.txt"), "Modified by user.\n");

  const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
  assert.equal(receipt.rejectionReasons.length, 0);

  const result = await applyIntegration(store, task.id, receipt.id, INTEGRATION_DEFAULTS);
  assert.equal(result.status, "applied");

  // Verify patched file changed
  const changed = await readFile(path.join(sourceDir, "readme.md"), "utf8");
  assert.match(changed, /changed text/);

  // Verify unrelated file survived byte-for-byte
  const unrelated = await readFile(path.join(sourceDir, "other.txt"), "utf8");
  assert.equal(unrelated, "Modified by user.\n");
});

test("affected source edit is rejected at preflight", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task, sourceDir } = await buildSucceededTask(store, ["true"]);

  // Modify an affected source file before preflight
  await writeFile(path.join(sourceDir, "readme.md"), "# changed by someone else\n");

  const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
  assert.ok(receipt.rejectionReasons.length > 0);
  assert.equal(
    await readFile(path.join(sourceDir, "readme.md"), "utf8"),
    "# changed by someone else\n",
  );
});

test("receipt reuse is rejected", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task } = await buildSucceededTask(store, ["true"]);

  const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
  assert.equal(receipt.rejectionReasons.length, 0);

  const first = await applyIntegration(store, task.id, receipt.id, INTEGRATION_DEFAULTS);
  assert.equal(first.status, "applied");

  const second = await applyIntegration(store, task.id, receipt.id, INTEGRATION_DEFAULTS);
  assert.equal(second.status, "rejected");
  assert.match(second.error!, /already been consumed/);
});

test("changed patch digest after preflight is rejected at apply", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task } = await buildSucceededTask(store, ["true"]);

  const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
  assert.equal(receipt.rejectionReasons.length, 0);

  // Tamper with the diff file
  await writeFile(task.paths.diff, "tampered diff content\n");

  const result = await applyIntegration(store, task.id, receipt.id, INTEGRATION_DEFAULTS);
  assert.equal(result.status, "rejected");
  assert.match(result.error!, /digest changed/);
});

test("changed source file after preflight is rejected at apply", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task, sourceDir } = await buildSucceededTask(store, ["true"]);

  const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
  assert.equal(receipt.rejectionReasons.length, 0);

  // Modify affected source after preflight but before apply
  await writeFile(path.join(sourceDir, "readme.md"), "# intercepted change\n");

  const result = await applyIntegration(store, task.id, receipt.id, INTEGRATION_DEFAULTS);
  assert.equal(result.status, "rejected");
  assert.match(result.error!, /changed since preflight/);

  // Source should remain unchanged (no mutation happened)
  const content = await readFile(path.join(sourceDir, "readme.md"), "utf8");
  assert.equal(content, "# intercepted change\n");
});

test("expired receipt is rejected at apply", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task } = await buildSucceededTask(store, ["true"]);

  // Use a 1 ms TTL so the receipt expires immediately
  const shortTtl: IntegrationSettings = {
    ...INTEGRATION_DEFAULTS,
    reviewReceiptTtlMs: 1,
  };

  const receipt = await preflightIntegration(store, task.id, shortTtl);
  assert.equal(receipt.rejectionReasons.length, 0);

  // Small delay to guarantee expiry
  await new Promise((resolve) => setTimeout(resolve, 10));

  const result = await applyIntegration(store, task.id, receipt.id, INTEGRATION_DEFAULTS);
  assert.equal(result.status, "rejected");
  assert.match(result.error!, /expired/);
});

test("receipt survives store close and reopen", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const storeA = new StateStore(root);
  const { task } = await buildSucceededTask(storeA, ["true"]);

  const receipt = await preflightIntegration(storeA, task.id, INTEGRATION_DEFAULTS);
  assert.equal(receipt.rejectionReasons.length, 0);

  // Close and reopen store — receipt must still be loadable
  storeA.close();
  const storeB = new StateStore(root);
  const stored = storeB.getIntegrationReceipt(receipt.id);
  assert.ok(stored !== undefined);
  assert.equal(stored.consumed, false);
  assert.equal(stored.patchDigest, receipt.patchDigest);
});

test("configured file limit rejects oversized patch", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task } = await buildSucceededTask(store, ["true"]);

  const strict: IntegrationSettings = {
    ...INTEGRATION_DEFAULTS,
    reviewedPatchMaxFiles: 0,
  };

  const receipt = await preflightIntegration(store, task.id, strict);
  assert.ok(receipt.rejectionReasons.length > 0);
  assert.match(receipt.rejectionReasons[0]!, /files.*limit/);
});

test("configured line limit rejects oversized patch", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task } = await buildSucceededTask(store, ["true"]);

  const strict: IntegrationSettings = {
    ...INTEGRATION_DEFAULTS,
    reviewedPatchMaxLines: 1,
  };

  const receipt = await preflightIntegration(store, task.id, strict);
  assert.ok(receipt.rejectionReasons.length > 0);
  assert.match(receipt.rejectionReasons[0]!, /lines.*limit/);
});

test("traversal path in diff is rejected", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task } = await buildSucceededTask(store, ["true"]);

  // Inject a traversal path into the diff
  const maliciousDiff =
    "diff --git a/baseline/../outside.txt b/workspace/../outside.txt\n" +
    "--- a/baseline/../outside.txt\n" +
    "+++ b/workspace/../outside.txt\n" +
    "@@ -0,0 +1 @@\n" +
    "+danger\n";
  await writeFile(task.paths.diff, maliciousDiff);

  const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
  assert.ok(receipt.rejectionReasons.length > 0);
  assert.ok(
    receipt.rejectionReasons.some((r) =>
      r.includes("Traversal path"),
    ),
  );
});

test("dry-run git apply failure is rejected at preflight", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task } = await buildSucceededTask(store, ["true"]);

  // Create a diff that references a hunk that won't cleanly apply:
  // modify a file that doesn't exist in source
  const badDiff =
    "diff --git a/baseline/nonexistent.txt b/workspace/nonexistent.txt\n" +
    "--- a/baseline/nonexistent.txt\n" +
    "+++ b/workspace/nonexistent.txt\n" +
    "@@ -1,1 +1,1 @@\n" +
    "-original\n" +
    "+changed\n";
  await writeFile(task.paths.diff, badDiff);

  const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
  assert.ok(receipt.rejectionReasons.length > 0);
  assert.ok(
    receipt.rejectionReasons.some((r) =>
      r.includes("does not apply cleanly"),
    ),
  );
});

test("dry-run git apply failure emits one canonical privacy-safe applicability issue without mutating source", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-applic-"));
  const store = new StateStore(root);
  try {
    const { task, sourceDir } = await buildSucceededTask(store, ["true"]);
    const before = await readFile(path.join(sourceDir, "readme.md"), "utf8");

    // Well-formed diff that fails the real `git apply --check` dry-run
    // (modifies a file absent from source), within size limits.
    const badDiff =
      "diff --git a/baseline/nonexistent.txt b/workspace/nonexistent.txt\n" +
      "--- a/baseline/nonexistent.txt\n" +
      "+++ b/workspace/nonexistent.txt\n" +
      "@@ -1,1 +1,1 @@\n" +
      "-original\n" +
      "+changed\n";
    await writeFile(task.paths.diff, badDiff);

    const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    assert.ok(receipt.rejectionReasons.length > 0);
    assert.ok(
      receipt.rejectionReasons.some((r) => r.includes("does not apply cleanly")),
    );
    // Exactly one closed privacy-safe issue, naming only the known stage.
    assert.ok(receipt.applicabilityIssue, "applicability issue must be present");
    assert.deepEqual(receipt.applicabilityIssue, { code: "patch-not-applicable" });
    // Source remains unchanged - preflight never mutates source.
    assert.equal(await readFile(path.join(sourceDir, "readme.md"), "utf8"), before);
    // Privacy: the structured issue carries no raw diagnostic, path, command,
    // diff, or log - only the fixed closed code.
    const issueJson = JSON.stringify(receipt.applicabilityIssue);
    assert.equal(issueJson, '{"code":"patch-not-applicable"}');
    assert.ok(!issueJson.includes("nonexistent.txt"), "no path in issue");
    assert.ok(!issueJson.includes("does not apply cleanly"), "no raw reason in issue");
    assert.ok(!issueJson.includes("error"), "no diagnostic in issue");
    assert.ok(!issueJson.includes("diff --git"), "no diff in issue");
  } finally {
    store.close();
  }
});

test("preflight event payload projects the applicability issue unchanged", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-applic-ev-"));
  const store = new StateStore(root);
  try {
    const { task } = await buildSucceededTask(store, ["true"]);
    const badDiff =
      "diff --git a/baseline/nonexistent.txt b/workspace/nonexistent.txt\n" +
      "--- a/baseline/nonexistent.txt\n" +
      "+++ b/workspace/nonexistent.txt\n" +
      "@@ -1,1 +1,1 @@\n" +
      "-original\n" +
      "+changed\n";
    await writeFile(task.paths.diff, badDiff);

    const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    const events = store.listEvents(task.id);
    const preflightEvent = events.find((e) => e.type === "integration.preflight.completed");
    assert.ok(preflightEvent, "preflight event must exist");
    const payload = preflightEvent!.payload as Record<string, unknown> | undefined;
    assert.ok(payload?.applicabilityIssue, "event carries the applicability issue");
    assert.deepEqual(
      payload!.applicabilityIssue,
      receipt.applicabilityIssue,
      "event issue is copied unchanged from the receipt",
    );
    assert.deepEqual(payload!.applicabilityIssue, { code: "patch-not-applicable" });
  } finally {
    store.close();
  }
});

test("preflight event summary is a fixed privacy-safe marker for applicability failures", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-applic-sum-"));
  const store = new StateStore(root);
  try {
    const { task } = await buildSucceededTask(store, ["true"]);
    const badDiff =
      "diff --git a/baseline/nonexistent.txt b/workspace/nonexistent.txt\n" +
      "--- a/baseline/nonexistent.txt\n" +
      "+++ b/workspace/nonexistent.txt\n" +
      "@@ -1,1 +1,1 @@\n" +
      "-original\n" +
      "+changed\n";
    await writeFile(task.paths.diff, badDiff);

    await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    const events = store.listEvents(task.id);
    const preflightEvent = events.find((e) => e.type === "integration.preflight.completed");
    assert.ok(preflightEvent, "preflight event must exist");
    // The durable summary is a fixed closed marker - no raw git stdout/stderr,
    // no fixture path, no apply diagnostic leaks into the durable summary.
    assert.equal(
      preflightEvent!.summary,
      "Integration preflight rejected: patch-not-applicable",
    );
    assert.ok(!preflightEvent!.summary.includes("nonexistent.txt"), "no fixture path in summary");
    assert.ok(
      !preflightEvent!.summary.includes("does not apply cleanly"),
      "no raw apply diagnostic in summary",
    );
    // Raw rejection reasons and the issue remain available in the payload for audit.
    const payload = preflightEvent!.payload as Record<string, unknown> | undefined;
    assert.ok(
      Array.isArray(payload?.rejectionReasons) && (payload!.rejectionReasons as unknown[]).length > 0,
      "payload keeps raw rejectionReasons for audit",
    );
    assert.ok(
      (payload!.rejectionReasons as string[]).some((r) => r.includes("does not apply cleanly")),
      "raw apply diagnostic remains in payload rejectionReasons",
    );
    assert.deepEqual(payload!.applicabilityIssue, { code: "patch-not-applicable" });
  } finally {
    store.close();
  }
});

test("non-applicability rejection does not fabricate an applicability issue", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-applic-neg-"));
  const store = new StateStore(root);
  try {
    const { task } = await buildSucceededTask(store, ["true"]);
    // A traversal path rejects at path validation, before the dry-run check.
    const maliciousDiff =
      "diff --git a/baseline/../outside.txt b/workspace/../outside.txt\n" +
      "--- a/baseline/../outside.txt\n" +
      "+++ b/workspace/../outside.txt\n" +
      "@@ -0,0 +1 @@\n" +
      "+danger\n";
    await writeFile(task.paths.diff, maliciousDiff);

    const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    assert.ok(receipt.rejectionReasons.length > 0);
    assert.ok(
      receipt.rejectionReasons.some((r) => r.includes("Traversal path")),
    );
    assert.equal(
      receipt.applicabilityIssue,
      undefined,
      "no applicability issue when preflight rejects before the dry-run check",
    );
  } finally {
    store.close();
  }
});

test("verification timeout triggers rollback and records timedOut evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task, sourceDir } = await buildSucceededTask(store, ["sleep 3"]);

  const before = await readFile(path.join(sourceDir, "readme.md"), "utf8");

  const shortTimeout: IntegrationSettings = {
    ...INTEGRATION_DEFAULTS,
    verificationTimeoutMs: 200,
  };

  const receipt = await preflightIntegration(store, task.id, shortTimeout);
  assert.equal(receipt.rejectionReasons.length, 0);

  const result = await applyIntegration(store, task.id, receipt.id, shortTimeout);
  assert.equal(result.status, "rolled-back");

  // Either a timeout message or verification failure with timedOut evidence
  const timedOutCommand = result.verificationCommands?.find((c) => c.timedOut);
  if (timedOutCommand) {
    assert.equal(timedOutCommand.timedOut, true);
  } else {
    // Shell may report timeout differently — verify rollback occurred
    assert.ok(result.error?.includes("verification failed"));
  }

  // Source must be restored byte-for-byte
  const after = await readFile(path.join(sourceDir, "readme.md"), "utf8");
  assert.equal(after, before);
});

test("retained failure keeps patch applied when autoRollback is disabled", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task, sourceDir } = await buildSucceededTask(store, ["false"]);

  const noRollback: IntegrationSettings = {
    ...INTEGRATION_DEFAULTS,
    autoRollback: false,
  };

  const receipt = await preflightIntegration(store, task.id, noRollback);
  assert.equal(receipt.rejectionReasons.length, 0);

  const result = await applyIntegration(store, task.id, receipt.id, noRollback);
  assert.equal(result.status, "retained-failure");
  assert.ok(result.error?.includes("retained"));

  // Source should still contain the patch — no rollback
  const content = await readFile(path.join(sourceDir, "readme.md"), "utf8");
  assert.match(content, /changed text/);
});

// --- Adversarial regression tests ---

test("canonical store TaskRecord used — caller cannot substitute source path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task } = await buildSucceededTask(store, ["true"]);

  // preflightIntegration now takes a taskId string, not a TaskRecord.
  // The caller cannot supply an alternate sourcePath — the store owns the record.
  const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
  assert.equal(receipt.rejectionReasons.length, 0);
  assert.equal(receipt.taskId, task.id);

  // Verify the canonical sourcePath from the store is the one used
  // (receipt would fail if an alternate path were used)
  const storedTask = store.getTask(task.id);
  assert.equal(storedTask.sourcePath, task.sourcePath);
});

test("backup failure produces durable rejection without mutation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task, sourceDir } = await buildSucceededTask(store, ["true"]);

  const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
  assert.equal(receipt.rejectionReasons.length, 0);

  // Block the backup directory by creating a regular file where a parent
  // directory component should be
  const blockPath = path.join(task.paths.root, "integration", receipt.id);
  await mkdir(path.dirname(blockPath), { recursive: true });
  await writeFile(blockPath, "block");

  const result = await applyIntegration(store, task.id, receipt.id, INTEGRATION_DEFAULTS);
  assert.equal(result.status, "rejected");
  assert.ok(result.error?.includes("Backup failed"));

  // Check durable rejection persisted
  const storedResults = store.listIntegrationResults(task.id);
  const rejection = storedResults.find((r) => r.status === "rejected");
  assert.ok(rejection, "Durable rejection should be persisted");
  assert.ok(rejection.error?.includes("Backup failed"));

  // Source must be unchanged — no mutation happened
  const content = await readFile(path.join(sourceDir, "readme.md"), "utf8");
  assert.match(content, /original text/);
});

test("mismatched diff header paths are rejected at preflight", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task } = await buildSucceededTask(store, ["true"]);

  // Diff with mismatched old/new paths (rename-like without proper headers)
  const mismatchedDiff =
    "diff --git a/baseline/foo.md b/workspace/bar.md\n" +
    "--- a/baseline/foo.md\n" +
    "+++ b/workspace/bar.md\n" +
    "@@ -1,1 +1,1 @@\n" +
    "-old\n" +
    "+new\n";
  await writeFile(task.paths.diff, mismatchedDiff);

  const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
  assert.ok(receipt.rejectionReasons.length > 0);
  assert.ok(
    receipt.rejectionReasons.some((r) =>
      r.includes("Mismatched header paths"),
    ),
  );
});

test("symlink mode in diff is rejected", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task } = await buildSucceededTask(store, ["true"]);

  // Symlink creates use mode 120000
  const symlinkDiff =
    "diff --git a/baseline/link b/workspace/link\n" +
    "new file mode 120000\n" +
    "--- /dev/null\n" +
    "+++ b/workspace/link\n" +
    "@@ -0,0 +1 @@\n" +
    "+target\n";
  await writeFile(task.paths.diff, symlinkDiff);

  const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
  assert.ok(receipt.rejectionReasons.length > 0);
  assert.ok(
    receipt.rejectionReasons.some((r) =>
      r.includes("Symlink mode"),
    ),
  );
});

test("mode-only patch is rejected", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task } = await buildSucceededTask(store, ["true"]);

  // Mode-only change (no content hunk)
  const modeOnlyDiff =
    "diff --git a/baseline/readme.md b/workspace/readme.md\n" +
    "old mode 100644\n" +
    "new mode 100755\n";
  await writeFile(task.paths.diff, modeOnlyDiff);

  const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
  assert.ok(receipt.rejectionReasons.length > 0);
  assert.ok(
    receipt.rejectionReasons.some((r) =>
      r.includes("Mode-only patch"),
    ),
  );
});

test("concurrent affected-file edits during verification trigger retained-failure", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task, sourceDir } = await buildSucceededTask(store, ["sleep 2 && false"]);

  const before = await readFile(path.join(sourceDir, "readme.md"), "utf8");

  const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
  assert.equal(receipt.rejectionReasons.length, 0);

  // Schedule a concurrent edit to the source file during verification.
  // The verification runs in an isolated temp dir, but the source is monitored.
  const concurrentEdit = "# injected during verification\n";
  const timer = setTimeout(async () => {
    await writeFile(path.join(sourceDir, "readme.md"), concurrentEdit);
  }, 500);

  const result = await applyIntegration(store, task.id, receipt.id, INTEGRATION_DEFAULTS);
  clearTimeout(timer);

  // Must be retained-failure (not rolled-back), since rollback would overwrite user edit
  assert.equal(result.status, "retained-failure");
  assert.ok(result.error?.includes("concurrent file edits detected"));
  assert.ok(result.error?.includes("readme.md"));

  // Source should contain the concurrent edit, NOT the rollback-restored content
  const after = await readFile(path.join(sourceDir, "readme.md"), "utf8");
  assert.equal(after, concurrentEdit);
  // The user edit must not have been overwritten by a stale backup rollback
  assert.notEqual(after, before);
});

test("concurrent edit of new file during verification is detected", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task, sourceDir } = await buildSucceededTask(store, ["sleep 2 && false"]);

  // Add a new file only in the Worker workspace. It must remain absent from
  // source until the reviewed patch is applied.
  await writeFile(
    path.join(task.paths.workspace, "newfile.txt"),
    "patched content\n",
  );
  await writeWorkspacePatchReport(task.paths, createPathPolicy(task.spec));

  const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
  assert.equal(receipt.rejectionReasons.length, 0);
  assert.ok(receipt.affectedFiles.includes("newfile.txt"));

  // Schedule concurrent edit to newfile.txt during verification
  const timer = setTimeout(async () => {
    await writeFile(path.join(sourceDir, "newfile.txt"), "concurrent edit\n");
  }, 500);

  const result = await applyIntegration(store, task.id, receipt.id, INTEGRATION_DEFAULTS);
  clearTimeout(timer);

  // Must retain failure, not rollback to overwrite user edit
  assert.equal(result.status, "retained-failure");
  assert.ok(result.error?.includes("concurrent file edits"));
});

test("concurrent affected-file edit is retained even when verification passes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task, sourceDir } = await buildSucceededTask(store, ["sleep 2 && true"]);

  const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
  assert.equal(receipt.rejectionReasons.length, 0);

  const concurrentEdit = "# user edit while passing verification\n";
  const timer = setTimeout(async () => {
    await writeFile(path.join(sourceDir, "readme.md"), concurrentEdit);
  }, 500);

  const result = await applyIntegration(store, task.id, receipt.id, INTEGRATION_DEFAULTS);
  clearTimeout(timer);

  assert.equal(result.status, "retained-failure");
  assert.match(result.error!, /verification passed/i);
  assert.match(result.error!, /concurrent file edits detected/);
  assert.equal(
    await readFile(path.join(sourceDir, "readme.md"), "utf8"),
    concurrentEdit,
  );
});

test("rollback with missing backup records failure evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task } = await buildSucceededTask(store, ["sleep 2 && false"]);

  const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
  assert.equal(receipt.rejectionReasons.length, 0);

  // Schedule deletion of the backup file during verification.
  // This simulates a corrupted or missing backup.
  const timer = setTimeout(async () => {
    const backupDir = path.join(task.paths.root, "integration", receipt.id, "backup");
    const backupFile = path.join(backupDir, "readme.md");
    try { await rm(backupFile, { force: true }); } catch { /* may not exist yet */ }
  }, 400);

  const result = await applyIntegration(store, task.id, receipt.id, INTEGRATION_DEFAULTS);
  clearTimeout(timer);

  // Should detect the missing backup and record evidence
  if (result.status === "retained-failure") {
    assert.ok(
      result.rollbackFailures && result.rollbackFailures.length > 0 ||
      result.error?.includes("concurrent file edits"),
    );
  } else if (result.status === "rolled-back") {
    assert.equal(result.rollbackFailures, undefined);
  }
});

test("durable rejection persisted for expired receipt", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task } = await buildSucceededTask(store, ["true"]);

  const shortTtl: IntegrationSettings = {
    ...INTEGRATION_DEFAULTS,
    reviewReceiptTtlMs: 1,
  };

  const receipt = await preflightIntegration(store, task.id, shortTtl);
  assert.equal(receipt.rejectionReasons.length, 0);

  await new Promise((resolve) => setTimeout(resolve, 10));

  const result = await applyIntegration(store, task.id, receipt.id, INTEGRATION_DEFAULTS);
  assert.equal(result.status, "rejected");
  assert.match(result.error!, /expired/);

  // Verify durable rejection is persisted in the store
  const storedResults = store.listIntegrationResults(task.id);
  const rejection = storedResults.find((r) =>
    r.status === "rejected" && r.error?.includes("expired"),
  );
  assert.ok(rejection, "Durable rejection should be persisted for expired receipt");
});

test("quoted-ambiguous diff header path is rejected", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task } = await buildSucceededTask(store, ["true"]);

  // Quoted form with embedded quote — ambiguous
  const ambiguousDiff =
    'diff --git "a/baseline/foo"".md" "b/workspace/foo"".md"\n' +
    "--- a/baseline/foo.md\n" +
    "+++ b/workspace/foo.md\n" +
    "@@ -1,1 +1,1 @@\n-old\n+new\n";
  await writeFile(task.paths.diff, ambiguousDiff);

  const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
  assert.ok(receipt.rejectionReasons.length > 0);
  assert.ok(
    receipt.rejectionReasons.some((r) =>
      r.includes("Quoted-ambiguous"),
    ),
  );
});

test("absolute path in diff header is rejected", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task } = await buildSucceededTask(store, ["true"]);

  const absoluteDiff =
    "diff --git a/baseline//etc/passwd b/workspace//etc/passwd\n" +
    "--- a/baseline//etc/passwd\n" +
    "+++ b/workspace//etc/passwd\n" +
    "@@ -0,0 +1 @@\n" +
    "+danger\n";
  await writeFile(task.paths.diff, absoluteDiff);

  const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
  assert.ok(receipt.rejectionReasons.length > 0);
  assert.ok(
    receipt.rejectionReasons.some((r) =>
      r.includes("Absolute path"),
    ),
  );
});

test("binary patch is rejected at preflight", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task } = await buildSucceededTask(store, ["true"]);

  const binaryDiff =
    "diff --git a/baseline/img.png b/workspace/img.png\n" +
    "Binary files a/baseline/img.png and b/workspace/img.png differ\n";
  await writeFile(task.paths.diff, binaryDiff);

  const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
  assert.ok(receipt.rejectionReasons.length > 0);
  assert.ok(
    receipt.rejectionReasons.some((r) =>
      r.includes("Binary patch"),
    ),
  );
});

test("rename patch is rejected at preflight", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const store = new StateStore(root);
  const { task } = await buildSucceededTask(store, ["true"]);

  const renameDiff =
    "diff --git a/baseline/old.txt b/workspace/new.txt\n" +
    "similarity index 100%\n" +
    "rename from old.txt\n" +
    "rename to new.txt\n";
  await writeFile(task.paths.diff, renameDiff);

  const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
  assert.ok(receipt.rejectionReasons.length > 0);
  assert.ok(
    receipt.rejectionReasons.some((r) =>
      r.includes("rename"),
    ),
  );
});

test("recreated excluded dist does not inflate the integration patch or block apply", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-dist-"));
  const store = new StateStore(root);
  try {
    const sourceDir = path.join(root, "source");
    const taskHome = path.join(root, "state");
    await mkdir(sourceDir);
    await writeFile(path.join(sourceDir, "readme.md"), "# hello\n\nOriginal text.\n");
    const acceptanceCommands = ["true"];
    const taskSpec = spec(sourceDir, acceptanceCommands);
    // dist is excluded from the snapshot but NOT declared in generatedPaths,
    // so a verifier build that recreates it must be classified as generated
    // evidence rather than business delivery.
    taskSpec.workspace.exclude = [".git", "node_modules", "dist"];

    const paths = taskPaths(taskHome, "task-dist");
    await prepareWorkspace(taskSpec, paths);

    // Worker edits one real source file.
    await writeFile(
      path.join(paths.workspace, "readme.md"),
      "# hello\n\nChanged text.\n",
    );
    // Independent acceptance build recreates a large dist tree that was
    // never present in the baseline snapshot.
    await mkdir(path.join(paths.workspace, "dist"), { recursive: true });
    for (let i = 0; i < 300; i += 1) {
      await writeFile(
        path.join(paths.workspace, "dist", `bundle-${i}.js`),
        `// generated ${i}\n`,
      );
    }
    await writeWorkspacePatchReport(paths, createPathPolicy(taskSpec));

    const task: TaskRecord = {
      id: "task-dist",
      name: taskSpec.name,
      status: "succeeded",
      sourcePath: sourceDir,
      taskFile: "/nonexistent/task.yaml",
      spec: taskSpec,
      paths,
      sessionId: "test-session",
      currentAttemptId: "attempt-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.createTask(task);
    const attempt: AttemptRecord = {
      id: "attempt-1",
      taskId: task.id,
      ordinal: 1,
      status: "succeeded",
      sessionId: task.sessionId,
      rawLogPath: path.join(paths.logs, "attempt-1.jsonl"),
      startedAt: task.createdAt,
      finishedAt: task.updatedAt,
      exitCode: 0,
      runtimeBudgetUsd: taskSpec.runtime.maxBudgetUsd,
    };
    store.createAttempt(attempt);
    const verification: VerificationResult = {
      passed: true,
      behaviorPassed: true,
      policyPassed: true,
      sourceCompatible: true,
      commands: acceptanceCommands.map((command) => ({
        command,
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 1,
        timedOut: false,
      })),
      diffPath: paths.diff,
      sourceUnchanged: true,
    };
    store.addEvent(
      task.id,
      attempt.id,
      "verification.completed",
      "Independent verification passed",
      verification,
    );
    recordMainReview(store, task.id, {
      decision: "accept",
      reason: "Scoped source change independently verified",
      confirm: true,
    });

    // Integration preflight measures only the reviewed (source-only) patch,
    // so the 300 recreated dist files cannot push it over the configured
    // file or line limits.
    const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    assert.deepEqual(receipt.rejectionReasons, []);
    assert.deepEqual(receipt.affectedFiles, ["readme.md"]);

    const result = await applyIntegration(store, task.id, receipt.id, INTEGRATION_DEFAULTS);
    assert.equal(result.status, "applied");
    assert.match(await readFile(path.join(sourceDir, "readme.md"), "utf8"), /Changed text/);

    // Raw and generated audit evidence retain the full recreated dist tree.
    const raw = await readFile(path.join(paths.root, "workspace.raw.patch"), "utf8");
    assert.match(raw, /dist\/bundle-0\.js/);
    assert.match(raw, /dist\/bundle-299\.js/);
    assert.match(raw, /readme\.md/);
    const generated = await readFile(
      path.join(paths.root, "workspace.generated.patch"),
      "utf8",
    );
    assert.match(generated, /dist\/bundle-0\.js/);
    assert.match(generated, /dist\/bundle-299\.js/);
    assert.doesNotMatch(generated, /readme\.md/);
    // The reviewed Integration patch stayed source-only.
    const integration = await readFile(paths.diff, "utf8");
    assert.match(integration, /readme\.md/);
    assert.doesNotMatch(integration, /dist\//);
  } finally {
    store.close();
  }
});

// --- Integration path classification evidence + recovery guidance ---

test("preflight receipt carries ordered one-to-one privacy-safe path evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-pe-"));
  const store = new StateStore(root);
  try {
    const { task } = await buildSucceededTask(store, ["true"]);
    const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    assert.equal(receipt.rejectionReasons.length, 0);
    assert.ok(receipt.pathEvidence, "pathEvidence must be present for affected paths");
    assert.equal(receipt.pathEvidence!.length, receipt.affectedFiles.length);
    receipt.pathEvidence!.forEach((entry, i) => {
      assert.equal(entry.path, receipt.affectedFiles[i],
        `evidence entry ${i} must match affectedFiles order`);
      assert.ok(
        ["business", "generated", "internal"].includes(entry.category),
        `category ${entry.category} must be in the closed vocabulary`,
      );
      assert.ok(
        [
          "internal-forklight",
          "snapshot-exclusion",
          "builtin-generated-pattern",
          "task-generated-pattern",
          "default-business",
        ].includes(entry.provenance),
        `provenance ${entry.provenance} must be in the closed vocabulary`,
      );
    });
    // readme.md is default business under the fixture spec
    const readme = receipt.pathEvidence!.find((e) => e.path === "readme.md");
    assert.ok(readme, "readme.md evidence present");
    assert.equal(readme!.category, "business");
    assert.equal(readme!.provenance, "default-business");
    // Privacy: no absolute source path, no Diff content, no command text
    const serialized = JSON.stringify(receipt.pathEvidence);
    assert.ok(!serialized.includes(task.sourcePath), "no absolute source path");
    assert.ok(!serialized.includes("changed text"), "no Diff content");
    assert.ok(!serialized.includes("diff --git"), "no Diff headers");
    // A passing receipt carries no recovery guidance
    assert.equal(receipt.recoveryGuidance, undefined);
  } finally {
    store.close();
  }
});

test("preflight event payload projects path evidence without recomputing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-pe-ev-"));
  const store = new StateStore(root);
  try {
    const { task } = await buildSucceededTask(store, ["true"]);
    await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    const events = store.listEvents(task.id);
    const preflightEvent = events.find((e) => e.type === "integration.preflight.completed");
    assert.ok(preflightEvent);
    const payload = preflightEvent!.payload as Record<string, unknown> | undefined;
    assert.ok(Array.isArray(payload?.pathEvidence), "event carries path evidence");
    assert.equal((payload!.pathEvidence as unknown[]).length, 1);
    assert.equal(payload!.recoveryGuidance, undefined);
  } finally {
    store.close();
  }
});

test("preflight size rejection adds recovery guidance and default-business provenance", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-size-"));
  const store = new StateStore(root);
  try {
    const sourceDir = path.join(root, "source");
    const taskHome = path.join(root, "state");
    await mkdir(sourceDir);
    const fileNames = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"];
    for (const name of fileNames) {
      await writeFile(path.join(sourceDir, name), "before\n");
    }
    const taskSpec = spec(sourceDir, ["true"]);
    const paths = taskPaths(taskHome, "task-size");
    await prepareWorkspace(taskSpec, paths);
    for (const name of fileNames) {
      await writeFile(path.join(paths.workspace, name), "after\n");
    }
    await writeWorkspacePatchReport(paths, createPathPolicy(taskSpec));

    const now = new Date().toISOString();
    const task: TaskRecord = {
      id: "task-size",
      name: taskSpec.name,
      status: "succeeded",
      sourcePath: sourceDir,
      taskFile: "/nonexistent/task.yaml",
      spec: taskSpec,
      paths,
      sessionId: "test-session",
      currentAttemptId: "attempt-1",
      createdAt: now,
      updatedAt: now,
    };
    store.createTask(task);
    const attempt: AttemptRecord = {
      id: "attempt-1",
      taskId: task.id,
      ordinal: 1,
      status: "succeeded",
      sessionId: task.sessionId,
      rawLogPath: path.join(paths.logs, "attempt-1.jsonl"),
      startedAt: now,
      finishedAt: now,
      exitCode: 0,
      runtimeBudgetUsd: taskSpec.runtime.maxBudgetUsd,
    };
    store.createAttempt(attempt);
    const verification: VerificationResult = {
      passed: true,
      behaviorPassed: true,
      policyPassed: true,
      sourceCompatible: true,
      commands: [
        { command: "true", exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false },
      ],
      diffPath: paths.diff,
      sourceUnchanged: true,
    };
    store.addEvent(
      task.id,
      attempt.id,
      "verification.completed",
      "Independent verification passed",
      verification,
    );
    recordMainReview(store, task.id, {
      decision: "accept",
      reason: "Scoped source change independently verified",
      confirm: true,
    });

    const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    // Size gate stays rejected
    assert.ok(receipt.rejectionReasons.length > 0);
    assert.ok(receipt.rejectionReasons.some((r) => /files.*limit/.test(r)));
    // Every affected path shows default-business provenance
    assert.equal(receipt.affectedFiles.length, fileNames.length);
    assert.ok(receipt.pathEvidence);
    assert.equal(receipt.pathEvidence!.length, fileNames.length);
    assert.ok(
      receipt.pathEvidence!.every((e) => e.provenance === "default-business"),
      "every affected path is default business under the immutable Task policy",
    );
    // One advisory guidance code with bounded counts, never auto-raising limits
    assert.ok(receipt.recoveryGuidance);
    assert.equal(
      receipt.recoveryGuidance!.code,
      "review-generated-or-exclusion-policy-vs-source-scope",
    );
    assert.equal(receipt.recoveryGuidance!.defaultBusinessPathCount, fileNames.length);
    assert.equal(receipt.recoveryGuidance!.filesChanged, fileNames.length);
    assert.equal(
      receipt.recoveryGuidance!.reviewedPatchMaxFiles,
      INTEGRATION_DEFAULTS.reviewedPatchMaxFiles,
    );
    // Guidance is privacy-safe: only the fixed code and counts, no paths
    const guidanceJson = JSON.stringify(receipt.recoveryGuidance);
    assert.ok(!guidanceJson.includes("/"), "no path separator in guidance");
    assert.ok(!guidanceJson.includes("a.ts"), "no file name in guidance");
  } finally {
    store.close();
  }
});

test("Integration verifies Elsewhere-shaped file: sibling SDK without mutating source dependency", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-local-pkg-"));
  const store = new StateStore(root);
  try {
    const app = path.join(root, "app");
    const sdk = path.join(root, "adeptify", "client-core", "sdk");
    await mkdir(app, { recursive: true });
    await mkdir(sdk, { recursive: true });
    const originalSdk = "export const sdkVersion = 1;\n";
    await writeFile(path.join(sdk, "package.json"), JSON.stringify({
      name: "@adeptify/client-core",
      version: "1.0.0",
    }));
    await writeFile(path.join(sdk, "index.js"), originalSdk);
    await writeFile(
      path.join(app, "package.json"),
      `${JSON.stringify({
        name: "elsewhere-app",
        version: "1.0.0",
        dependencies: {
          "@adeptify/client-core": "file:../adeptify/client-core/sdk",
        },
      }, null, 2)}\n`,
    );
    await writeFile(path.join(app, "readme.md"), "# hello\n\nThis is the original text.\n");

    // Acceptance proves the isolated verification cwd can resolve the sibling
    // at the declared relative path (the Integration failure mode Elsewhere hit).
    const acceptanceCommands = [
      "node -e \"const fs=require('node:fs');const p=require('node:path');const t=p.resolve('..','adeptify','client-core','sdk','index.js');if(!fs.existsSync(t)){console.error('missing sibling sdk');process.exit(1);}const body=fs.readFileSync(t,'utf8');if(!body.includes('sdkVersion')){console.error('bad sdk');process.exit(1);}\"",
    ];
    const taskSpec = spec(app, acceptanceCommands);
    const taskHome = path.join(root, "state");
    const paths = taskPaths(taskHome, "task-local-pkg");
    await prepareWorkspace(taskSpec, paths);

    // Sibling mirror exists for workspace commands; baseline stays free of it.
    const workspaceMirror = path.join(paths.root, "adeptify", "client-core", "sdk", "index.js");
    assert.equal(await readFile(workspaceMirror, "utf8"), originalSdk);
    await assert.rejects(() => readFile(path.join(paths.baseline, "adeptify", "client-core", "sdk", "index.js")));

    await writeFile(
      path.join(paths.workspace, "readme.md"),
      "# hello\n\nThis is the changed text.\n",
    );
    await writeWorkspacePatchReport(paths, createPathPolicy(taskSpec));
    const integrationDiff = await readFile(paths.diff, "utf8");
    assert.doesNotMatch(integrationDiff, /adeptify|client-core|sdkVersion/);

    const now = new Date().toISOString();
    const task: TaskRecord = {
      id: "task-local-pkg",
      name: taskSpec.name,
      status: "succeeded",
      sourcePath: app,
      taskFile: "/nonexistent/task.yaml",
      spec: taskSpec,
      paths,
      sessionId: "test-session",
      currentAttemptId: "attempt-1",
      createdAt: now,
      updatedAt: now,
    };
    store.createTask(task);
    store.createAttempt({
      id: "attempt-1",
      taskId: task.id,
      ordinal: 1,
      status: "succeeded",
      sessionId: task.sessionId,
      rawLogPath: path.join(paths.logs, "attempt-1.jsonl"),
      startedAt: now,
      finishedAt: now,
      exitCode: 0,
      runtimeBudgetUsd: taskSpec.runtime.maxBudgetUsd,
    });
    store.addEvent(
      task.id,
      "attempt-1",
      "verification.completed",
      "Independent verification passed",
      {
        passed: true,
        behaviorPassed: true,
        policyPassed: true,
        sourceCompatible: true,
        commands: acceptanceCommands.map((command) => ({
          command,
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 1,
          timedOut: false,
        })),
        diffPath: paths.diff,
        sourceUnchanged: true,
      } satisfies VerificationResult,
    );
    recordMainReview(store, task.id, {
      decision: "accept",
      reason: "Sibling SDK candidate independently verified",
      confirm: true,
    });

    const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    assert.deepEqual(receipt.rejectionReasons, []);
    const result = await applyIntegration(store, task.id, receipt.id, INTEGRATION_DEFAULTS);
    assert.equal(result.status, "applied");
    assert.equal(
      result.stages?.find((stage) => stage.stage === "source-verified")?.status,
      "passed",
    );
    assert.match(await readFile(path.join(app, "readme.md"), "utf8"), /changed text/);
    // Original external SDK bytes remain immutable through Integration.
    assert.equal(await readFile(path.join(sdk, "index.js"), "utf8"), originalSdk);
  } finally {
    store.close();
  }
});

test("preflight non-size rejection emits no recovery guidance", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-noguide-"));
  const store = new StateStore(root);
  try {
    const { task } = await buildSucceededTask(store, ["true"]);
    // Well-formed diff that will not apply cleanly (within size limits).
    const badDiff =
      "diff --git a/baseline/nonexistent.txt b/workspace/nonexistent.txt\n" +
      "--- a/baseline/nonexistent.txt\n" +
      "+++ b/workspace/nonexistent.txt\n" +
      "@@ -1,1 +1,1 @@\n" +
      "-original\n" +
      "+changed\n";
    await writeFile(task.paths.diff, badDiff);

    const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    assert.ok(receipt.rejectionReasons.length > 0);
    assert.ok(
      !receipt.rejectionReasons.some((r) => /files.*limit|lines.*limit/.test(r)),
      "no size-limit rejection",
    );
    assert.equal(receipt.recoveryGuidance, undefined, "no guidance for non-size rejection");
    // Evidence still explains the one affected path
    assert.ok(receipt.pathEvidence);
    assert.equal(receipt.pathEvidence!.length, receipt.affectedFiles.length);
    assert.equal(receipt.pathEvidence![0]!.provenance, "default-business");
  } finally {
    store.close();
  }
});

test("legacy receipt without path evidence remains readable and still applies", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-peleg-"));
  const store = new StateStore(root);
  try {
    const { task, sourceDir } = await buildSucceededTask(store, ["true"]);
    const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    assert.equal(receipt.rejectionReasons.length, 0);
    assert.ok(receipt.pathEvidence);

    // Store a legacy receipt that predates path-classification evidence.
    const ts = new Date().toISOString();
    store.saveIntegrationReceipt({
      id: "leg-pe",
      taskId: task.id,
      patchDigest: receipt.patchDigest,
      affectedFiles: receipt.affectedFiles,
      rejectionReasons: [],
      sourceEvidence: receipt.sourceEvidence,
      createdAt: ts,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      consumed: false,
    });
    const legacy = store.getIntegrationReceipt("leg-pe");
    assert.ok(legacy);
    assert.equal(legacy!.pathEvidence, undefined, "legacy receipt has no path evidence");
    assert.equal(legacy!.recoveryGuidance, undefined, "legacy receipt has no guidance");
    assert.equal(legacy!.applicabilityIssue, undefined, "legacy receipt has no applicability issue");

    // Applying the legacy receipt (evidence absent) still works
    const result = await applyIntegration(store, task.id, "leg-pe", INTEGRATION_DEFAULTS);
    assert.equal(result.status, "applied");
    assert.match(await readFile(path.join(sourceDir, "readme.md"), "utf8"), /changed text/);
  } finally {
    store.close();
  }
});

test("apply fails closed when stored path evidence is inconsistent", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-pebad-"));
  const store = new StateStore(root);
  try {
    const { task, sourceDir } = await buildSucceededTask(store, ["true"]);
    const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    assert.equal(receipt.rejectionReasons.length, 0);
    assert.ok(receipt.pathEvidence);
    const before = await readFile(path.join(sourceDir, "readme.md"), "utf8");

    // Cardinality mismatch: empty evidence for a one-file affected set
    store.saveIntegrationReceipt({
      ...receipt,
      id: "tamper-card",
      consumed: false,
      pathEvidence: [],
    });
    const r1 = await applyIntegration(store, task.id, "tamper-card", INTEGRATION_DEFAULTS);
    assert.equal(r1.status, "rejected");
    assert.match(r1.error!, /path evidence/i);
    assert.equal(await readFile(path.join(sourceDir, "readme.md"), "utf8"), before);

    // Path mismatch: evidence entry names a different path than affectedFiles
    store.saveIntegrationReceipt({
      ...receipt,
      id: "tamper-path",
      consumed: false,
      pathEvidence: [{ ...receipt.pathEvidence![0]!, path: "wrong.txt" }],
    });
    const r2 = await applyIntegration(store, task.id, "tamper-path", INTEGRATION_DEFAULTS);
    assert.equal(r2.status, "rejected");
    assert.match(r2.error!, /path evidence/i);
    assert.equal(await readFile(path.join(sourceDir, "readme.md"), "utf8"), before);
  } finally {
    store.close();
  }
});

test("explicit Task generated paths keep recreated output out of integration evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-petask-"));
  const store = new StateStore(root);
  try {
    const sourceDir = path.join(root, "source");
    const taskHome = path.join(root, "state");
    await mkdir(sourceDir);
    await writeFile(path.join(sourceDir, "readme.md"), "# hello\n\nOriginal text.\n");
    const acceptanceCommands = ["true"];
    const taskSpec = spec(sourceDir, acceptanceCommands);
    // dist is declared as generated output, so it stays out of the integration
    // patch and never appears as a default-business affected path.
    taskSpec.workspace.generatedPaths = ["dist/**"];

    const paths = taskPaths(taskHome, "task-petask");
    await prepareWorkspace(taskSpec, paths);
    await writeFile(path.join(paths.workspace, "readme.md"), "# hello\n\nChanged text.\n");
    await mkdir(path.join(paths.workspace, "dist"), { recursive: true });
    for (let i = 0; i < 10; i += 1) {
      await writeFile(path.join(paths.workspace, "dist", `bundle-${i}.js`), `// ${i}\n`);
    }
    await writeWorkspacePatchReport(paths, createPathPolicy(taskSpec));

    const now = new Date().toISOString();
    const task: TaskRecord = {
      id: "task-petask",
      name: taskSpec.name,
      status: "succeeded",
      sourcePath: sourceDir,
      taskFile: "/nonexistent/task.yaml",
      spec: taskSpec,
      paths,
      sessionId: "test-session",
      currentAttemptId: "attempt-1",
      createdAt: now,
      updatedAt: now,
    };
    store.createTask(task);
    const attempt: AttemptRecord = {
      id: "attempt-1",
      taskId: task.id,
      ordinal: 1,
      status: "succeeded",
      sessionId: task.sessionId,
      rawLogPath: path.join(paths.logs, "attempt-1.jsonl"),
      startedAt: now,
      finishedAt: now,
      exitCode: 0,
      runtimeBudgetUsd: taskSpec.runtime.maxBudgetUsd,
    };
    store.createAttempt(attempt);
    const verification: VerificationResult = {
      passed: true,
      behaviorPassed: true,
      policyPassed: true,
      sourceCompatible: true,
      commands: acceptanceCommands.map((command) => ({
        command,
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 1,
        timedOut: false,
      })),
      diffPath: paths.diff,
      sourceUnchanged: true,
    };
    store.addEvent(
      task.id,
      attempt.id,
      "verification.completed",
      "Independent verification passed",
      verification,
    );
    recordMainReview(store, task.id, {
      decision: "accept",
      reason: "Scoped source change independently verified",
      confirm: true,
    });

    const receipt = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    assert.deepEqual(receipt.rejectionReasons, []);
    assert.deepEqual(receipt.affectedFiles, ["readme.md"]);
    // Only the actual source path appears; no fabricated generated path is added
    assert.ok(receipt.pathEvidence);
    assert.equal(receipt.pathEvidence!.length, 1);
    assert.equal(receipt.pathEvidence![0]!.path, "readme.md");
    assert.equal(receipt.pathEvidence![0]!.provenance, "default-business");
    assert.equal(receipt.recoveryGuidance, undefined);
  } finally {
    store.close();
  }
});

test("preflight accepts only after succeeded+Main-revise reverify and fresh accept of repaired revision", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-reverify-"));
  const store = new StateStore(root);
  try {
    const sourceDir = path.join(root, "source");
    const taskHome = path.join(root, "state");
    await mkdir(sourceDir);
    await writeFile(path.join(sourceDir, "readme.md"), "# hello\n\nOriginal.\n");
    const markerPath = path.join(root, ".int-reverify-marker");
    await writeFile(markerPath, "pass\n");
    const command = `test -f ${markerPath}`;
    const paths = taskPaths(taskHome, "task-reverify");
    const taskSpec = spec(sourceDir, [command]);
    await prepareWorkspace(taskSpec, paths);
    await writeFile(path.join(paths.workspace, "readme.md"), "# hello\n\nRevision A.\n");
    await writeWorkspacePatchReport(paths, createPathPolicy(taskSpec));

    const policyValues = { ...defaultAdvancedPolicyFields(), maxMainReverifications: 1 };
    const provenance = Object.fromEntries(
      Object.keys(policyValues).map((key) => [key, "global" as ProvenanceSource]),
    ) as Record<keyof typeof policyValues, ProvenanceSource>;
    const effectivePolicy: EffectivePolicySnapshot = {
      profileId: "test-profile",
      values: policyValues,
      provenance,
      enforcementCapability: defaultEnforcementCapability(),
    };
    const task: TaskRecord = {
      id: "task-reverify",
      name: taskSpec.name,
      status: "succeeded",
      sourcePath: sourceDir,
      taskFile: "/nonexistent/task.yaml",
      spec: taskSpec,
      paths,
      sessionId: "session-reverify",
      currentAttemptId: "attempt-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      effectivePolicy,
    };
    store.createTask(task);
    const attempt: AttemptRecord = {
      id: "attempt-1",
      taskId: task.id,
      ordinal: 1,
      status: "succeeded",
      sessionId: task.sessionId,
      rawLogPath: path.join(paths.logs, "attempt-1.jsonl"),
      startedAt: task.createdAt,
      finishedAt: task.updatedAt,
      exitCode: 0,
    };
    store.createAttempt(attempt);
    const verification: VerificationResult = {
      passed: true,
      behaviorPassed: true,
      policyPassed: true,
      sourceCompatible: true,
      commands: [{ command, exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false }],
      diffPath: paths.diff,
      patches: {
        business: {
          path: paths.diff,
          filesChanged: 1,
          changedLines: 2,
          affectedPaths: ["readme.md"],
        },
        generated: { path: paths.diff, filesChanged: 0, changedLines: 0, affectedPaths: [] },
        integration: {
          path: paths.diff,
          filesChanged: 1,
          changedLines: 2,
          affectedPaths: ["readme.md"],
        },
      },
      sourceUnchanged: true,
    };
    const verificationEvent = store.addEvent(
      task.id,
      attempt.id,
      "verification.completed",
      "Independent verification passed",
      verification,
    );
    const revisionA = await captureCandidateRevision(
      store,
      store.getTask(task.id),
      attempt,
      verificationEvent.sequence,
      true,
      ["readme.md"],
      1,
      2,
    );
    const revise = recordMainReview(store, task.id, {
      decision: "revise",
      reason: "Semantic repair needed",
      confirm: true,
    });
    assert.equal(revise.candidateRevisionId, revisionA.id);

    // Main repairs retained workspace without a Worker.
    await writeFile(path.join(paths.workspace, "readme.md"), "# hello\n\nRevision B repaired.\n");
    await writeWorkspacePatchReport(paths, createPathPolicy(taskSpec));

    const reverify = await reverifyCandidate(
      store,
      { taskId: task.id, reason: "reverify repaired candidate", confirm: true },
      1,
      30_000,
    );
    assert.equal(reverify.status, "passed");
    assert.equal(store.getTask(task.id).status, "succeeded");
    assert.equal(store.listAttempts(task.id).length, 1);

    const blocked = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    assert.ok(blocked.rejectionReasons.some((reason) => reason.includes("Main agent review acceptance is required")));

    const accept = recordMainReview(store, task.id, {
      decision: "accept",
      reason: "Accept repaired revision B",
      confirm: true,
    });
    assert.equal(accept.verificationEventSequence, reverify.verificationEventSequence);
    assert.notEqual(accept.candidateRevisionId, revisionA.id);

    const allowed = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    assert.equal(allowed.rejectionReasons.length, 0);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("reviewer Task is permanently non-integratable and pending review blocks Candidate", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-review-"));
  const store = new StateStore(root);
  const settings = new SettingsService(store);
  try {
    const { task } = await buildSucceededTask(store, ["true"], true);
    const events = store.listEvents(task.id);
    const verification = events.find((e) => e.type === "verification.completed")!;
    const attempt = store.getAttempt(task.currentAttemptId!);
    const revision = await captureCandidateRevision(
      store,
      store.getTask(task.id),
      attempt,
      verification.sequence,
      true,
      ["readme.md"],
      1,
      2,
    );
    // Re-record accept bound to the modern revision.
    recordMainReview(store, task.id, {
      decision: "accept",
      reason: "Accept exact revision before judge",
      confirm: true,
    });

    const profileId = settings.get().workerProfiles.defaultProfileId;
    const created = await createReviewGraph(store, settings.get(), {
      candidateTaskId: task.id,
      reviewerWorkerProfileId: profileId,
      reason: "Integration gate check",
      confirm: true,
    });
    const pending = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    assert.ok(pending.rejectionReasons.some((r) => r.includes(PENDING_REVIEW_BLOCKS_INTEGRATION)));

    const reviewerReceipt = await preflightIntegration(
      store,
      created.reviewerTaskId,
      INTEGRATION_DEFAULTS,
    );
    assert.ok(reviewerReceipt.rejectionReasons.includes(REVIEWER_TASK_NOT_INTEGRATABLE));

    const now = new Date().toISOString();
    store.createAttempt({
      id: "reviewer-attempt",
      taskId: created.reviewerTaskId,
      ordinal: 1,
      status: "succeeded",
      sessionId: store.getTask(created.reviewerTaskId).sessionId,
      rawLogPath: path.join(store.getTask(created.reviewerTaskId).paths.logs, "a.jsonl"),
      startedAt: now,
      finishedAt: now,
      exitCode: 0,
      resultText: JSON.stringify({
        schemaVersion: 1,
        reviewedRevisionId: revision.id,
        proposedDisposition: "reject",
        summary: "Judge rejects for integration gate test",
        findings: [],
      }),
    });
    store.setTaskStatus(created.reviewerTaskId, "succeeded", {
      finishedAt: now,
      currentAttemptId: "reviewer-attempt",
    });
    reconcileReviewAssignment(
      store,
      store.listReviewAssignments(created.graph.id)[0]!.id,
    );
    const stale = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    assert.ok(stale.rejectionReasons.some((r) => r.includes(STALE_MAIN_ACCEPT_AFTER_REVIEW)));

    recordMainReview(store, task.id, {
      decision: "accept",
      reason: "Main overrides judge after reading findings",
      confirm: true,
    });
    const fresh = await preflightIntegration(store, task.id, INTEGRATION_DEFAULTS);
    assert.equal(fresh.rejectionReasons.length, 0);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
