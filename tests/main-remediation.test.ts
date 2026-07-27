import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  projectRemediationVerifyResult,
  verifyMainRemediation,
  REMEDIATION_REASON_MAX_LENGTH,
} from "../src/core/main-remediation.js";
import type {
  AttemptRecord,
  RemediationCheckRecord,
  RemediationDisposition,
  TaskRecord,
  VerificationResult,
} from "../src/core/types.js";
import { StateStore } from "../src/state/store.js";
import { StatisticsService } from "../src/core/statistics.js";
import { buildTaskSummary, projectTaskSurface } from "../src/core/task-summary.js";

// --- Test helpers ---

function taskRecord(
  id: string,
  status: TaskRecord["status"],
  sourcePath: string,
  commands: string[],
): TaskRecord {
  return {
    id,
    name: id,
    status,
    sourcePath,
    taskFile: `/tasks/${id}.yaml`,
    spec: {
      version: 2,
      name: id,
      project: sourcePath,
      provider: { name: "deepseek", model: "v4", keychainService: "forklight.deepseek.api-key" },
      runtime: { name: "claude-code", executable: "claude", effort: "medium", maxBudgetUsd: null },
      workspace: { exclude: [".git", "node_modules"] },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
      contract: {
        outcome: "Test", context: ["test"], inScope: ["test"], outOfScope: ["test"],
        executionSteps: ["test"], deliverables: ["test"], modules: [], callChain: ["a", "b"],
        scenarios: [{ name: "A", given: "G", when: "W", then: "T" }, { name: "B", given: "G2", when: "W2", then: "T2" }],
        risks: ["test"], changeBudget: { maxFiles: 10, maxDiffLines: 500 },
      },
      acceptance: { criteria: ["c1"], commands },
    },
    paths: {
      root: path.join(path.dirname(sourcePath), `.forklight-test-${id}`),
      baseline: sourcePath,
      workspace: sourcePath,
      logs: path.join(path.dirname(sourcePath), `.forklight-test-${id}`, "logs"),
      claudeConfig: path.join(path.dirname(sourcePath), `.forklight-test-${id}`, "claude"),
      diff: path.join(path.dirname(sourcePath), `.forklight-test-${id}`, "result.diff"),
    },
    sessionId: `session-${id}`,
    createdAt: "2026-07-20T00:00:00Z",
    updatedAt: "2026-07-20T02:00:00Z",
    startedAt: "2026-07-20T00:00:00Z",
    finishedAt: "2026-07-20T02:00:00Z",
  };
}

const passedVerification: VerificationResult = {
  passed: true, behaviorPassed: true, policyPassed: true, sourceCompatible: true,
  commands: [{ command: "echo ok", exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false }],
  diffPath: "/tmp/diff", sourceUnchanged: true,
};

function attempt(tid: string, ord: number, st: AttemptRecord["status"]): AttemptRecord {
  return {
    id: `${tid}-${ord}`, taskId: tid, ordinal: ord, status: st,
    sessionId: `session-${tid}`, rawLogPath: "/tmp/log",
    startedAt: "2026-07-20T00:00:00Z", finishedAt: "2026-07-20T01:00:00Z",
  };
}

// --- Domain validation tests ---

test("remediation verify rejects missing confirm", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "fl-rem-"));
  const store = new StateStore(home);
  try {
    const task = taskRecord("t1", "failed", home, ["echo ok"]);
    store.createTask(task);
    await assert.rejects(
      verifyMainRemediation(store, { taskId: task.id, reason: "fixed", confirm: undefined as unknown as true }, 30000),
      /confirm/,
    );
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("remediation verify rejects oversized reason", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "fl-rem-"));
  const store = new StateStore(home);
  try {
    const task = taskRecord("t1", "failed", home, ["echo ok"]);
    store.createTask(task);
    await assert.rejects(
      verifyMainRemediation(store, { taskId: task.id, reason: "x".repeat(REMEDIATION_REASON_MAX_LENGTH + 1), confirm: true }, 30000),
      /reason.*must be/,
    );
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("remediation verify rejects nonterminal Task statuses", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "fl-rem-"));
  const store = new StateStore(home);
  try {
    for (const status of ["succeeded", "running", "queued", "preparing", "verifying"] as const) {
      const id = `t-${status}`;
      const task = taskRecord(id, status, home, ["echo ok"]);
      store.createTask(task);
      await assert.rejects(
        verifyMainRemediation(store, { taskId: task.id, reason: "test", confirm: true }, 30000),
        /requires failed or interrupted/,
        `should reject status=${status}`,
      );
    }
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("remediation verify rejects unknown Task", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "fl-rem-"));
  const store = new StateStore(home);
  try {
    await assert.rejects(
      verifyMainRemediation(store, { taskId: "nonexistent", reason: "test", confirm: true }, 30000),
      /Unknown/,
    );
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

// --- Persistence and restart-safety ---

test("remediation check records are persisted and recoverable across store instances", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "fl-rem-"));
  const sourceDir = path.join(home, "source");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(path.join(sourceDir, "test.js"), 'console.log("ok");');
  // Create a passing command
  await writeFile(path.join(sourceDir, "package.json"), JSON.stringify({
    name: "test", scripts: { check: "node -e 'console.log(42)'" },
  }));

  const store1 = new StateStore(home);
  const task = taskRecord("t-persist", "failed", sourceDir, ["node -e 'console.log(42)'"]);
  store1.createTask(task);

  const result = await verifyMainRemediation(
    store1, { taskId: task.id, reason: "Main repaired the source", confirm: true }, 30000,
  );
  assert.equal(result.check.status, "passed");
  assert.equal(result.disposition?.status, "verified-repaired-delivered");
  store1.close();

  // Restart: open a new store instance and verify the check is still there
  const store2 = new StateStore(home);
  try {
    const checks = store2.getRemediationChecks(task.id);
    assert.equal(checks.length, 1);
    assert.equal(checks[0]!.status, "passed");
    assert.equal(checks[0]!.id, result.check.id);

    const disposition = store2.getRemediationDisposition(task.id);
    assert.ok(disposition !== undefined);
    assert.equal(disposition.status, "verified-repaired-delivered");
    assert.equal(disposition.checkId, result.check.id);
  } finally {
    store2.close();
    rmSync(home, { recursive: true, force: true });
  }
});

// --- Failed-then-passed check ---

test("manual retry after a failed check may pass and become the final disposition", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "fl-rem-"));
  const sourceDir = path.join(home, "source");
  await mkdir(sourceDir, { recursive: true });
  // First: a failing command
  await writeFile(path.join(sourceDir, "test.sh"), 'echo "fail"; exit 1');

  const store1 = new StateStore(home);
  const task = taskRecord("t-retry", "failed", sourceDir, ["bash test.sh"]);
  store1.createTask(task);

  // First check fails
  const failResult = await verifyMainRemediation(
    store1, { taskId: task.id, reason: "first attempt", confirm: true }, 30000,
  );
  assert.equal(failResult.check.status, "failed");
  assert.equal(failResult.disposition, undefined);

  // Now fix the command so it passes
  await writeFile(path.join(sourceDir, "test.sh"), 'echo "pass"; exit 0');

  // Second check passes
  const passResult = await verifyMainRemediation(
    store1, { taskId: task.id, reason: "second attempt after fix", confirm: true }, 30000,
  );
  assert.equal(passResult.check.status, "passed");
  assert.equal(passResult.disposition?.status, "verified-repaired-delivered");

  // Both checks persist
  const checks = store1.getRemediationChecks(task.id);
  assert.equal(checks.length, 2);
  assert.equal(checks[0]!.status, "failed");
  assert.equal(checks[1]!.status, "passed");

  // The failed check is still visible, disposition exists
  const disposition = store1.getRemediationDisposition(task.id);
  assert.ok(disposition !== undefined);
  assert.equal(disposition.checkId, passResult.check.id);

  store1.close();
  rmSync(home, { recursive: true, force: true });
});

// --- Duplicate pass rejection ---

test("duplicate passing disposition is rejected before command execution", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "fl-rem-"));
  const sourceDir = path.join(home, "source");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(path.join(sourceDir, "package.json"), JSON.stringify({
    name: "test", scripts: { check: "node -e ''" },
  }));

  const store = new StateStore(home);
  try {
    const task = taskRecord("t-dup", "failed", sourceDir, ["node -e ''"]);
    store.createTask(task);

    // First pass succeeds
    const first = await verifyMainRemediation(
      store, { taskId: task.id, reason: "first pass", confirm: true }, 30000,
    );
    assert.equal(first.disposition?.status, "verified-repaired-delivered");

    // Second pass is rejected
    await assert.rejects(
      verifyMainRemediation(store, { taskId: task.id, reason: "second pass attempt", confirm: true }, 30000),
      /already has a passing remediation disposition/,
    );

    // Only one check exists (the second was rejected before persistence)
    const checks = store.getRemediationChecks(task.id);
    assert.equal(checks.length, 1);
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

// --- Command authority: only stored acceptance commands run ---

test("only stored acceptance commands run; no arbitrary commands accepted", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "fl-rem-"));
  const sourceDir = path.join(home, "source");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(path.join(sourceDir, "package.json"), JSON.stringify({
    name: "test",
  }));

  const store = new StateStore(home);
  try {
    const task = taskRecord("t-auth", "failed", sourceDir, ["node -e 'process.exit(42)'"]);
    store.createTask(task);

    // The stored command (node -e 'process.exit(42)') exits 42, so this fails
    const result = await verifyMainRemediation(
      store, { taskId: task.id, reason: "testing command authority", confirm: true }, 30000,
    );
    assert.equal(result.check.status, "failed");
    assert.equal(result.check.commands[0]!.exitCode, 42);
    // disposition is undefined because the check failed
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

// --- Failure records pass-through command results but disposition only on pass ---

test("failed check persists all command results but no disposition", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "fl-rem-"));
  const sourceDir = path.join(home, "source");
  await mkdir(sourceDir, { recursive: true });

  const store = new StateStore(home);
  try {
    const task = taskRecord("t-cmds", "failed", sourceDir, [
      "node -e 'console.log(1); process.exit(0)'",
      "node -e 'console.error(\"bad\"); process.exit(2)'",
    ]);
    store.createTask(task);

    const result = await verifyMainRemediation(
      store, { taskId: task.id, reason: "mixed commands", confirm: true }, 30000,
    );

    assert.equal(result.check.status, "failed");
    assert.equal(result.disposition, undefined);
    assert.equal(result.check.commands.length, 2);
    assert.equal(result.check.commands[0]!.exitCode, 0);
    assert.equal(result.check.commands[1]!.exitCode, 2);
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

// --- Task status immutability ---

test("machine Task status is never rewritten by remediation verification", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "fl-rem-"));
  const sourceDir = path.join(home, "source");
  await mkdir(sourceDir, { recursive: true });

  const store = new StateStore(home);
  try {
    const task = taskRecord("t-status", "failed", sourceDir, ["node -e ''"]);
    store.createTask(task);
    const originalStatus = store.getTask(task.id).status;

    await verifyMainRemediation(
      store, { taskId: task.id, reason: "verify immutability", confirm: true }, 30000,
    );

    const after = store.getTask(task.id);
    assert.equal(after.status, originalStatus, "Task status must stay unchanged");
    assert.equal(after.status, "failed");
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

// --- Statistics integration ---

test("statistics add accepted-delivery fields while preserving failure distributions", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "fl-rem-stats-"));
  const sourceDir = path.join(home, "source");
  await mkdir(sourceDir, { recursive: true });

  const store = new StateStore(home);
  try {
    // Create a failed Task with a remediation disposition
    const failedTask = taskRecord("t-failed-stats", "failed", sourceDir, ["node -e ''"]);
    store.createTask(failedTask);
    store.createAttempt(attempt("t-failed-stats", 1, "failed"));
    store.addEvent("t-failed-stats", "t-failed-stats-1", "worker.failed", "failed", { failureCategory: "runtime" });
    store.addEvent("t-failed-stats", "t-failed-stats-1", "verification.completed", "Failed", passedVerification);

    // Create a succeeded Task
    const succeededTask = taskRecord("t-success-stats", "succeeded", sourceDir, ["node -e ''"]);
    store.createTask(succeededTask);
    store.createAttempt(attempt("t-success-stats", 1, "succeeded"));
    store.addEvent("t-success-stats", "t-success-stats-1", "verification.completed", "Passed", passedVerification);

    // Add a remediation check and disposition for the failed task
    const check: RemediationCheckRecord = {
      id: "check-1", taskId: failedTask.id, status: "passed",
      commands: [{ command: "node -e ''", exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false }],
      createdAt: "2026-07-20T03:00:00Z",
    };
    store.saveRemediationCheck(check);
    store.saveRemediationDisposition(failedTask.id, {
      status: "verified-repaired-delivered", checkId: check.id, createdAt: check.createdAt,
    });

    const summaries = new StatisticsService(store).summarize();
    assert.equal(summaries.length, 1, "both tasks share same provider/model");

    const summary = summaries[0]!;
    assert.equal(summary.sampleSize, 2);
    assert.equal(summary.successCount, 1, "machine success is 1");
    assert.equal(summary.successRate, 0.5, "machine successRate is 0.5");
    assert.equal(summary.acceptedDeliveryCount, 2, "accepted delivery counts both");
    assert.equal(summary.acceptedDeliveryRate, 1.0, "both tasks have accepted delivery");
    assert.equal(summary.mainRepairedDeliveryCount, 1, "one task was main-repaired");
    assert.equal(summary.remediationCheckCount, 1);
    // Failure distribution still has the runtime failure
    assert.equal(summary.failureDistribution.unclassified, 1);
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

// --- Task summary projection ---

test("task summary includes remediation disposition when present", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "fl-rem-"));
  const sourceDir = path.join(home, "source");
  await mkdir(sourceDir, { recursive: true });

  const store = new StateStore(home);
  try {
    const task = taskRecord("t-summary", "failed", sourceDir, ["node -e ''"]);
    store.createTask(task);

    // No disposition yet
    const without = buildTaskSummary(task);
    assert.equal(without.remediationDisposition, undefined);

    // Add disposition
    const disposition: RemediationDisposition = {
      status: "verified-repaired-delivered", checkId: "check-1", createdAt: "2026-07-20T03:00:00Z",
    };
    store.saveRemediationDisposition(task.id, disposition);

    const updated = store.getTask(task.id);
    const fetchedDisp = store.getRemediationDisposition(task.id);
    assert.ok(fetchedDisp !== undefined);
    const withDisp = buildTaskSummary(updated, undefined, undefined, fetchedDisp);
    assert.equal(withDisp.remediationDisposition?.status, "verified-repaired-delivered");
    assert.equal(withDisp.remediationDisposition?.checkId, "check-1");
    assert.equal(withDisp.status, "failed", "task status remains failed");

    // projectTaskSurface also propagates
    const surface = projectTaskSurface(updated, { remediationDisposition: fetchedDisp });
    assert.equal(surface.remediationDisposition?.status, "verified-repaired-delivered");
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

// --- Privacy-safe error messages ---

test("error messages do not echo reason or command output", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "fl-rem-"));
  const store = new StateStore(home);
  try {
    const task = taskRecord("t-privacy", "failed", home, ["echo hi"]);
    store.createTask(task);

    // Confirm gate
    try {
      await verifyMainRemediation(store, { taskId: task.id, reason: "test", confirm: undefined as unknown as true }, 30000);
      assert.fail("should reject");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assert.match(msg, /confirm/);
      assert.doesNotMatch(msg, /echo/);
    }
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("public remediation result omits private reason, commands, and output", () => {
  const result = projectRemediationVerifyResult({
    check: {
      id: "check-private",
      taskId: "task-private",
      status: "passed",
      reason: "private Main reasoning",
      commands: [{
        command: "private command",
        exitCode: 0,
        stdout: "private stdout",
        stderr: "private stderr",
        durationMs: 10,
        timedOut: false,
      }],
      createdAt: "2026-07-26T00:00:00.000Z",
    },
    disposition: {
      status: "verified-repaired-delivered",
      checkId: "check-private",
      createdAt: "2026-07-26T00:00:00.000Z",
    },
  }, "failed");

  assert.deepEqual(result.check, {
    id: "check-private",
    status: "passed",
    commandCount: 1,
    passedCommandCount: 1,
    createdAt: "2026-07-26T00:00:00.000Z",
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /private Main reasoning|private command|private stdout|private stderr/);
});

// --- Corrupt row resilience ---

test("corrupt remediation check rows fail closed", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "fl-rem-crpt-"));
  const store = new StateStore(home);
  try {
    const task = taskRecord("t-crpt", "failed", home, ["node -e ''"]);
    store.createTask(task);

    // Manually insert a corrupt row
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (store as any).db;
    db.prepare(
      `INSERT INTO remediation_checks (id, task_id, status, commands_json, record_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("bad-check", task.id, "unknown-status", "[]", JSON.stringify({ id: "bad-check", taskId: task.id, status: "unknown-status", commands: [], createdAt: "2026-01-01" }), "2026-01-01T00:00:00Z");

    assert.throws(
      () => store.getRemediationChecks(task.id),
      /Corrupt/,
    );
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

// --- Corrupt disposition rows fail closed ---

test("corrupt remediation disposition rows fail closed", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "fl-rem-crptd-"));
  const store = new StateStore(home);
  try {
    const task = taskRecord("t-crptd", "failed", home, ["node -e ''"]);
    store.createTask(task);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db2 = (store as any).db;
    db2.prepare(
      `INSERT INTO remediation_dispositions (task_id, disposition_json, created_at)
       VALUES (?, ?, ?)`,
    ).run(task.id, JSON.stringify({ status: "bad-status", checkId: "x", createdAt: "2026-01-01" }), "2026-01-01T00:00:00Z");

    assert.throws(
      () => store.getRemediationDisposition(task.id),
      /Corrupt/,
    );
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

// --- Event completeness ---

test("remediation events are persisted with privacy-safe payloads", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "fl-rem-evt-"));
  const sourceDir = path.join(home, "source");
  await mkdir(sourceDir, { recursive: true });

  const store = new StateStore(home);
  try {
    const task = taskRecord("t-events", "failed", sourceDir, ["node -e ''"]);
    store.createTask(task);

    await verifyMainRemediation(
      store, { taskId: task.id, reason: "test events", confirm: true }, 30000,
    );

    const events = store.listEvents(task.id);
    const started = events.find((e) => e.type === "remediation.check.started");
    const completed = events.find((e) => e.type === "remediation.check.completed");

    assert.ok(started !== undefined, "check.started event exists");
    assert.ok(completed !== undefined, "check.completed event exists");

    // The completed event payload must be privacy-safe: no stdout/stderr/reason
    const payload = completed!.payload as Record<string, unknown> | undefined;
    assert.ok(payload !== undefined && payload !== null);
    assert.equal(typeof payload.checkId, "string");
    assert.equal(typeof payload.status, "string");
    assert.equal(typeof payload.disposition, "string");
    // Privacy: no command output in the payload
    const payloadStr = JSON.stringify(payload);
    assert.doesNotMatch(payloadStr, /stdout|stderr/);
    assert.doesNotMatch(JSON.stringify(started!.payload), /test events/);
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

// --- Verifier Git isolation ---

test("remediation isolates acceptance commands from inherited Git variables", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "fl-rem-git-"));
  const sourceDir = path.join(home, "source");
  await mkdir(sourceDir, { recursive: true });

  const store = new StateStore(home);
  try {
    const task = taskRecord("t-no-git", "failed", sourceDir, [
      "test \"$(git rev-parse --show-toplevel)\" = \"$PWD\"",
    ]);
    store.createTask(task);

    const originalGitDir = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(home, "unrelated.git");
    try {
      const result = await verifyMainRemediation(
        store, { taskId: task.id, reason: "isolated Git test", confirm: true }, 30000,
      );
      assert.equal(result.check.status, "passed");
    } finally {
      if (originalGitDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = originalGitDir;
    }
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});
