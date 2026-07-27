import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { registerTaskFromSpec } from "../src/core/runner.js";
import { loadTaskSpec } from "../src/core/task.js";
import { runCaptured } from "../src/core/process.js";
import { verifierProcessEnvironment } from "../src/workspace/verifier-git.js";
import { StateStore } from "../src/state/store.js";
import { prepareWorkspace } from "../src/workspace/copy.js";

test("verifier Git commands work without exposing .git inside the workspace", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-verifier-git-home-"));
  const root = await mkdtemp(path.join(tmpdir(), "forklight-verifier-git-task-"));
  const project = path.join(root, "project");
  await mkdir(path.join(project, "src"), { recursive: true });
  await writeFile(path.join(project, "src", "value.ts"), "export const value = 1;\n");
  const taskFile = path.join(root, "task.yaml");
  await writeFile(taskFile, `version: 1
name: Verifier Git test
project: ./project
goal: Run Git acceptance without Worker repository access
worker:
  allowEdits: true
acceptance:
  commands:
    - git diff --check
    - test -n "$(git status --porcelain)"
`);

  const store = new StateStore(home);
  try {
    const { spec } = await loadTaskSpec(taskFile);
    const task = registerTaskFromSpec(store, spec, taskFile);
    await prepareWorkspace(spec, task.paths);
    await writeFile(
      path.join(task.paths.workspace, "src", "value.ts"),
      "export const value = 2;\n",
    );
    const attemptId = "verifier-git-attempt";
    store.createAttempt({
      id: attemptId,
      taskId: task.id,
      ordinal: 1,
      status: "running",
      sessionId: task.sessionId,
      rawLogPath: path.join(task.paths.logs, "attempt-1.jsonl"),
      startedAt: new Date().toISOString(),
    });

    const { verifyTask } = await import("../src/core/verifier.js");
    const result = await verifyTask(store, task, attemptId);
    assert.deepEqual(result.commands.map((command) => command.exitCode), [0, 0]);
    assert.equal(result.behaviorPassed, true);
    assert.equal(existsSync(path.join(task.paths.workspace, ".git")), false);
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("nested temporary Git repository works without GIT_WORK_TREE leakage", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-verifier-git-home-"));
  const root = await mkdtemp(path.join(tmpdir(), "forklight-verifier-git-task-"));
  const project = path.join(root, "project");
  await mkdir(project, { recursive: true });
  await writeFile(path.join(project, "README.md"), "# Test\n");

  const taskFile = path.join(root, "task.yaml");
  await writeFile(taskFile, `version: 1
name: Nested Git test
project: ./project
goal: Verifier Git must not leak into nested repos
worker:
  allowEdits: false
acceptance:
  commands:
    - |
      NESTED="$(mktemp -d)" &&
      cd "$NESTED" &&
      git init --quiet &&
      echo hello > README.md &&
      git add README.md &&
      git status --porcelain &&
      rm -rf "$NESTED"
`);

  const store = new StateStore(home);
  try {
    const { spec } = await loadTaskSpec(taskFile);
    const task = registerTaskFromSpec(store, spec, taskFile);
    await prepareWorkspace(spec, task.paths);

    // Write a change so the verifier env is prepared and active.
    await writeFile(
      path.join(task.paths.workspace, "README.md"),
      "# Changed\n",
    );

    const { env: verifierEnv, shellGitPrefix } = await verifierProcessEnvironment(task);

    // Simulate an acceptance command: run a subprocess that creates
    // its own temporary Git repository.
    const result = await runCaptured("/bin/zsh", ["-lc", shellGitPrefix + [
      'NESTED="$(mktemp -d)"',
      'cd "$NESTED"',
      "git init --quiet",
      "echo hello > README.md",
      "git add README.md",
      'OUT="$(git status --porcelain)"',
      'test -n "$OUT" && echo "OK: $OUT" || echo "FAIL: no output"',
      'rm -rf "$NESTED"',
    ].join(" && ")], {
      cwd: task.paths.workspace,
      env: verifierEnv,
    });

    assert.equal(result.exitCode, 0, `nested git should succeed: ${result.stderr}`);
    assert.match(result.stdout, /OK:/, "nested git status should produce output");
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("inherited GIT_DIR does not contaminate verifier preparation or acceptance subprocesses", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-verifier-git-home-"));
  const root = await mkdtemp(path.join(tmpdir(), "forklight-verifier-git-task-"));
  const project = path.join(root, "project");
  await mkdir(project, { recursive: true });
  await writeFile(path.join(project, "README.md"), "# Test\n");

  const taskFile = path.join(root, "task.yaml");
  await writeFile(taskFile, `version: 1
name: Inherited contamination test
project: ./project
goal: Verifier must resist inherited GIT_* variables
worker:
  allowEdits: false
acceptance:
  commands:
    - test -z "$GIT_DIR" && test -z "$GIT_WORK_TREE" && test -z "$GIT_INDEX_FILE" && echo "CLEAN"
`);

  // Simulate a contaminated parent: ForkLight launched with GIT_* set.
  const savedGitDir = process.env.GIT_DIR;
  const savedGitWorkTree = process.env.GIT_WORK_TREE;
  const savedGitIndexFile = process.env.GIT_INDEX_FILE;
  try {
    process.env.GIT_DIR = "/fake/parent/git";
    process.env.GIT_WORK_TREE = "/fake/parent/worktree";
    process.env.GIT_INDEX_FILE = "/fake/parent/index";

    const store = new StateStore(home);
    try {
      const { spec } = await loadTaskSpec(taskFile);
      const task = registerTaskFromSpec(store, spec, taskFile);
      await prepareWorkspace(spec, task.paths);

      const { env: verifierEnv, shellGitPrefix } = await verifierProcessEnvironment(task);

      // The verifier environment itself must not carry inherited GIT_*.
      assert.equal(verifierEnv.GIT_DIR, undefined, "GIT_DIR should be stripped from verifier env");
      assert.equal(verifierEnv.GIT_WORK_TREE, undefined, "GIT_WORK_TREE should be stripped from verifier env");
      assert.equal(verifierEnv.GIT_INDEX_FILE, undefined, "GIT_INDEX_FILE should be stripped from verifier env");

      // An acceptance subprocess must also see clean GIT_* variables.
      const result = await runCaptured("/bin/zsh", ["-lc", shellGitPrefix + [
        'test -z "$GIT_DIR" && test -z "$GIT_WORK_TREE" && test -z "$GIT_INDEX_FILE" && echo "CLEAN"',
      ].join(" && ")], {
        cwd: task.paths.workspace,
        env: verifierEnv,
      });

      assert.equal(result.exitCode, 0, `acceptance subprocess should succeed: ${result.stderr}`);
      assert.match(result.stdout, /CLEAN/, "acceptance subprocess should see clean Git variables");
    } finally {
      store.close();
      rmSync(home, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  } finally {
    // Restore original environment.
    if (savedGitDir === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = savedGitDir;
    if (savedGitWorkTree === undefined) delete process.env.GIT_WORK_TREE; else process.env.GIT_WORK_TREE = savedGitWorkTree;
    if (savedGitIndexFile === undefined) delete process.env.GIT_INDEX_FILE; else process.env.GIT_INDEX_FILE = savedGitIndexFile;
  }
});

test("wrapper script only applies verifier Git context inside the workspace", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-verifier-git-home-"));
  const root = await mkdtemp(path.join(tmpdir(), "forklight-verifier-git-task-"));
  const project = path.join(root, "project");
  await mkdir(project, { recursive: true });
  await writeFile(path.join(project, "README.md"), "# Test\n");

  const taskFile = path.join(root, "task.yaml");
  await writeFile(taskFile, `version: 1
name: Wrapper scope test
project: ./project
goal: Wrapper must not intercept Git outside the workspace
worker:
  allowEdits: false
acceptance:
  commands:
    - "true"
`);

  const store = new StateStore(home);
  try {
    const { spec } = await loadTaskSpec(taskFile);
    const task = registerTaskFromSpec(store, spec, taskFile);
    await prepareWorkspace(spec, task.paths);

    const { env: verifierEnv, shellGitPrefix } = await verifierProcessEnvironment(task);

    // Run git from /tmp — outside the workspace. The shell function must not
    // apply verifier context, so the real git should just fail normally
    // (no repo) rather than redirecting to the verifier repo.
    const result = await runCaptured("/bin/zsh", ["-lc", shellGitPrefix + [
      'cd /tmp',
      'if git rev-parse --git-dir >/dev/null 2>&1; then echo "LEAKED"; else echo "SAFE"; fi',
    ].join(" && ")], {
      cwd: "/tmp",
      env: verifierEnv,
    });

    assert.equal(result.exitCode, 0, `git probe outside workspace should not crash: ${result.stderr}`);
    assert.match(result.stdout, /SAFE/, "wrapper must not redirect Git outside the workspace");
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("direct workspace Git still observes Worker changes through the wrapper", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-verifier-git-home-"));
  const root = await mkdtemp(path.join(tmpdir(), "forklight-verifier-git-task-"));
  const project = path.join(root, "project");
  await mkdir(path.join(project, "src"), { recursive: true });
  await writeFile(path.join(project, "src", "main.ts"), "export const x = 1;\n");

  const taskFile = path.join(root, "task.yaml");
  await writeFile(taskFile, `version: 1
name: Direct Git test
project: ./project
goal: Direct Git commands observe Worker changes through the wrapper
worker:
  allowEdits: true
acceptance:
  commands:
    - git diff --check
    - test -n "$(git status --porcelain)"
    - git diff --name-only
`);

  const store = new StateStore(home);
  try {
    const { spec } = await loadTaskSpec(taskFile);
    const task = registerTaskFromSpec(store, spec, taskFile);
    await prepareWorkspace(spec, task.paths);
    await writeFile(
      path.join(task.paths.workspace, "src", "main.ts"),
      "export const x = 2;\n",
    );

    const attemptId = "direct-git-attempt";
    store.createAttempt({
      id: attemptId,
      taskId: task.id,
      ordinal: 1,
      status: "running",
      sessionId: task.sessionId,
      rawLogPath: path.join(task.paths.logs, "attempt-1.jsonl"),
      startedAt: new Date().toISOString(),
    });

    const { verifyTask } = await import("../src/core/verifier.js");
    const result = await verifyTask(store, task, attemptId);

    assert.deepEqual(
      result.commands.map((c) => c.exitCode),
      [0, 0, 0],
      "all direct Git acceptance commands should pass",
    );
    assert.equal(result.behaviorPassed, true);
    // git diff --name-only should report the changed file.
    const diffNameOnly = result.commands[2];
    assert.ok(diffNameOnly, "third acceptance command should exist");
    assert.match(
      diffNameOnly.stdout,
      /src\/main\.ts/,
      "git diff --name-only should list the changed file",
    );
    assert.equal(existsSync(path.join(task.paths.workspace, ".git")), false);
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
