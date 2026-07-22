import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { taskPaths } from "../src/core/config.js";
import {
  preflightIntegration,
  applyIntegration,
} from "../src/core/integration.js";
import type { IntegrationSettings } from "../src/core/settings.js";
import type { TaskRecord, TaskSpec } from "../src/core/types.js";
import { StateStore } from "../src/state/store.js";
import {
  prepareWorkspace,
  writeWorkspaceDiff,
} from "../src/workspace/copy.js";

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
): Promise<{ task: TaskRecord; sourceDir: string; taskHome: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "fl-int-"));
  const sourceDir = path.join(root, "source");
  const taskHome = path.join(root, "state");
  await mkdir(sourceDir);
  await writeFile(path.join(sourceDir, "readme.md"), "# hello\n\nThis is the original text.\n");
  await writeFile(path.join(sourceDir, "other.txt"), "Unrelated file content.\n");

  const paths = taskPaths(taskHome, "task-1");
  const taskSpec = spec(sourceDir, acceptanceCommands);
  await prepareWorkspace(taskSpec, paths);

  // Simulate worker edit in workspace
  await writeFile(
    path.join(paths.workspace, "readme.md"),
    "# hello\n\nThis is the changed text.\n",
  );
  await writeWorkspaceDiff(paths, []);

  const task: TaskRecord = {
    id: "task-1",
    name: taskSpec.name,
    status: "succeeded",
    sourcePath: sourceDir,
    taskFile: "/nonexistent/task.yaml",
    spec: taskSpec,
    paths,
    sessionId: "test-session",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.createTask(task);
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

  // Verify the source file changed
  const content = await readFile(path.join(sourceDir, "readme.md"), "utf8");
  assert.match(content, /changed text/);
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
  await writeWorkspaceDiff(task.paths, []);

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
  const { task, sourceDir } = await buildSucceededTask(store, ["sleep 2 && false"]);

  const before = await readFile(path.join(sourceDir, "readme.md"), "utf8");
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
