import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SettingsService } from "../src/core/settings.js";
import { buildTaskRecord, registerTaskFromSpec } from "../src/core/runner.js";
import { loadTaskSpec } from "../src/core/task.js";
import type { TaskRecord } from "../src/core/types.js";
import { StateStore } from "../src/state/store.js";
import { prepareWorkspace } from "../src/workspace/copy.js";

// --- Verifier completion-policy tests ---
//
// These tests exercise the completion-policy evaluation in verifyTask without
// actually invoking a Worker or running real acceptance commands.  Instead they
// construct Task records whose verifyTask calls will succeed for the first
// command (true) and then assert on the structured policy outcome.

interface VerifierPolicyFixture {
  home: string;
  store: StateStore;
  task: TaskRecord;
  cleanup: () => void;
}

async function fixture(
  noChangeMode: "hard" | "warn" | "score" | "off",
  allowEdits: boolean,
  mutateWorkspace: boolean,
): Promise<VerifierPolicyFixture> {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-vp-"));
  const store = new StateStore(home);
  const root = await mkdtemp(path.join(tmpdir(), "forklight-vp-task-"));
  const project = path.join(root, "project");
  await mkdir(path.join(project, "src"), { recursive: true });
  await writeFile(path.join(project, "README.md"), "# Test\n");
  await writeFile(path.join(project, "src", "main.ts"), "export const x = 1;\n");

  const taskFile = path.join(root, "task.yaml");
  await writeFile(
    taskFile,
    `version: 2
name: Policy test
project: ./project
worker:
  allowEdits: ${allowEdits}
  focusPaths: [src]
contract:
  outcome: A reasonable outcome description
  context: [c]
  inScope: [i]
  outOfScope: [o]
  executionSteps: [s]
  deliverables: [d]
  modules:
    - name: m
      responsibility: long enough responsibility
      consumes: [c]
      produces: [p]
      boundaries: [b]
  callChain: [a, b]
  scenarios:
    - name: normal
      given: g
      when: w
      then: t
    - name: edge
      given: g
      when: w
      then: t
  risks: [r]
  changeBudget:
    maxFiles: 8
    maxDiffLines: 1000
acceptance:
  criteria: [c]
  commands:
    - "true"
`,
  );

  const defaults = (await import("../src/core/settings.js")).cloneDefaults();
  const policy = {
    contractQuality: defaults.contractQuality,
    execution: defaults.execution,
    providerDefaults: defaults.providerDefaults,
    completionPolicy: { noChangeMode },
  };
  const { spec } = await loadTaskSpec(taskFile, policy);
  const record = registerTaskFromSpec(store, spec, taskFile);

  // Prepare baseline and workspace directories so verifyTask can diff them.
  await prepareWorkspace(spec, record.paths);

  // If the test should simulate delivery, write a new file to the workspace
  // so the baseline-to-workspace diff is non-empty.
  if (mutateWorkspace) {
    await writeFile(
      path.join(record.paths.workspace, "delivery-output.ts"),
      "export const output = 1;\n",
    );
  }

  return {
    home,
    store,
    task: record,
    cleanup: () => {
      store.close();
      rmSync(home, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("default hard mode fails editable zero-change task even when acceptance commands pass", async () => {
  const { store, task, cleanup } = await fixture("hard", true, false);
  try {
    const attemptId = "attempt-1";
    store.createAttempt({
      id: attemptId,
      taskId: task.id,
      ordinal: 1,
      status: "running",
      sessionId: task.sessionId,
      rawLogPath: "/tmp/log",
      startedAt: new Date().toISOString(),
    });

    // Import verifyTask lazily to avoid workspace side-effects in import
    const { verifyTask } = await import("../src/core/verifier.js");
    const result = await verifyTask(store, task, attemptId);

    assert.equal(result.passed, false);
    assert.equal(result.completionPolicy?.check, "hard-fail");
    assert.equal(result.completionPolicy?.noChangeMode, "hard");
    assert.match(result.completionPolicy?.message ?? "", /No workspace changes/);

  } finally {
    cleanup();
  }
});

test("warn mode allows editable zero-change task to pass with warning recorded", async () => {
  const { store, task, cleanup } = await fixture("warn", true, false);
  try {
    const attemptId = "attempt-1";
    store.createAttempt({
      id: attemptId,
      taskId: task.id,
      ordinal: 1,
      status: "running",
      sessionId: task.sessionId,
      rawLogPath: "/tmp/log",
      startedAt: new Date().toISOString(),
    });

    const { verifyTask } = await import("../src/core/verifier.js");
    const result = await verifyTask(store, task, attemptId);

    assert.equal(result.passed, true);
    assert.equal(result.completionPolicy?.check, "warning");
    assert.equal(result.completionPolicy?.noChangeMode, "warn");
    assert.match(result.completionPolicy?.message ?? "", /Warning/);

  } finally {
    cleanup();
  }
});

test("score mode allows editable zero-change task to pass with score evidence recorded", async () => {
  const { store, task, cleanup } = await fixture("score", true, false);
  try {
    const attemptId = "attempt-1";
    store.createAttempt({
      id: attemptId,
      taskId: task.id,
      ordinal: 1,
      status: "running",
      sessionId: task.sessionId,
      rawLogPath: "/tmp/log",
      startedAt: new Date().toISOString(),
    });

    const { verifyTask } = await import("../src/core/verifier.js");
    const result = await verifyTask(store, task, attemptId);

    assert.equal(result.passed, true);
    assert.equal(result.completionPolicy?.check, "score-evidence");
    assert.equal(result.completionPolicy?.noChangeMode, "score");

  } finally {
    cleanup();
  }
});

test("off mode allows editable zero-change task to pass with no penalty", async () => {
  const { store, task, cleanup } = await fixture("off", true, false);
  try {
    const attemptId = "attempt-1";
    store.createAttempt({
      id: attemptId,
      taskId: task.id,
      ordinal: 1,
      status: "running",
      sessionId: task.sessionId,
      rawLogPath: "/tmp/log",
      startedAt: new Date().toISOString(),
    });

    const { verifyTask } = await import("../src/core/verifier.js");
    const result = await verifyTask(store, task, attemptId);

    assert.equal(result.passed, true);
    assert.equal(result.completionPolicy?.check, "ignored");
    assert.equal(result.completionPolicy?.noChangeMode, "off");

  } finally {
    cleanup();
  }
});

test("editable task with actual workspace changes passes in all modes", async () => {
  for (const mode of ["hard", "warn", "score", "off"] as const) {
    const { store, task, cleanup } = await fixture(mode, true, true);
    try {
      const attemptId = `attempt-${mode}`;
      store.createAttempt({
        id: attemptId,
        taskId: task.id,
        ordinal: 1,
        status: "running",
        sessionId: task.sessionId,
        rawLogPath: "/tmp/log",
        startedAt: new Date().toISOString(),
      });

      const { verifyTask } = await import("../src/core/verifier.js");
      const result = await verifyTask(store, task, attemptId);

      assert.equal(result.passed, true, `Mode ${mode} should pass with actual changes`);
      assert.equal(result.completionPolicy?.check, "satisfied");
      assert.equal(result.completionPolicy?.noChangeMode, mode);

    } finally {
      cleanup();
    }
  }
});

test("read-only task with no changes passes and is marked not-applicable", async () => {
  for (const mode of ["hard", "warn", "score", "off"] as const) {
    const { store, task, cleanup } = await fixture(mode, false, false);
    try {
      const attemptId = `attempt-ro-${mode}`;
      store.createAttempt({
        id: attemptId,
        taskId: task.id,
        ordinal: 1,
        status: "running",
        sessionId: task.sessionId,
        rawLogPath: "/tmp/log",
        startedAt: new Date().toISOString(),
      });

      const { verifyTask } = await import("../src/core/verifier.js");
      const result = await verifyTask(store, task, attemptId);

      assert.equal(result.passed, true, `Read-only mode ${mode} should pass`);
      assert.equal(result.completionPolicy?.check, "not-applicable");
      assert.equal(result.completionPolicy?.noChangeMode, mode);

    } finally {
      cleanup();
    }
  }
});

test("legacy task without completionPolicy field gets hard fallback on empty editable diff", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-vp-legacy-"));
  const store = new StateStore(home);
  const root = await mkdtemp(path.join(tmpdir(), "forklight-vp-task-"));
  const project = path.join(root, "project");
  await mkdir(project, { recursive: true });
  await writeFile(path.join(project, "README.md"), "# Test\n");

  const taskFile = path.join(root, "task.yaml");
  await writeFile(
    taskFile,
    `version: 2
name: Legacy CP fallback
project: ./project
worker:
  allowEdits: true
  focusPaths: [src]
contract:
  outcome: A reasonable outcome description
  context: [c]
  inScope: [i]
  outOfScope: [o]
  executionSteps: [s]
  deliverables: [d]
  modules:
    - name: m
      responsibility: long enough responsibility
      consumes: [c]
      produces: [p]
      boundaries: [b]
  callChain: [a, b]
  scenarios:
    - name: normal
      given: g
      when: w
      then: t
    - name: edge
      given: g
      when: w
      then: t
  risks: [r]
  changeBudget:
    maxFiles: 8
    maxDiffLines: 1000
acceptance:
  criteria: [c]
  commands:
    - "true"
`,
  );

  try {
    const { spec } = await loadTaskSpec(taskFile);
    // Simulate legacy: delete the completionPolicy field after parsing
    delete (spec as unknown as Record<string, unknown>).completionPolicy;
    const record = registerTaskFromSpec(store, spec, taskFile);
    await prepareWorkspace(spec, record.paths);

    const attemptId = "attempt-legacy";
    store.createAttempt({
      id: attemptId,
      taskId: record.id,
      ordinal: 1,
      status: "running",
      sessionId: record.sessionId,
      rawLogPath: "/tmp/log",
      startedAt: new Date().toISOString(),
    });

    const { verifyTask } = await import("../src/core/verifier.js");
    const result = await verifyTask(store, record, attemptId);

    assert.equal(result.passed, false);
    assert.equal(result.completionPolicy?.check, "hard-fail");
    assert.equal(result.completionPolicy?.noChangeMode, "hard");

  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

