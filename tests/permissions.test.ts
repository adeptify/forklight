import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { AttemptRecord, TaskRecord } from "../src/core/types.js";
import {
  allowedToolArguments,
  interruptedExitCode,
  runtimeTemporaryDirectory,
  runtimeTemporaryDirectoryAliases,
  workerLaunch,
} from "../src/workers/claude.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("P2 Worker never receives Bash or web tools", () => {
  const task = {
    spec: {
      worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
      acceptance: { commands: ["node --test"] },
    },
  } as unknown as TaskRecord;
  const permission = allowedToolArguments(task);
  assert.doesNotMatch(permission.tools, /Bash|Web|Task/);
  assert.match(permission.tools, /Glob/);
  assert.match(permission.tools, /Write/);
  assert.match(permission.denied, /Bash/);
  assert.match(permission.denied, /WebFetch/);
  assert.match(permission.denied, /Task/);
  assert.match(permission.allowed, /Read/);
  assert.match(permission.allowed, /Glob/);
  assert.match(permission.allowed, /Grep/);
  assert.match(permission.allowed, /Edit/);
  assert.match(permission.allowed, /Write/);
  assert.match(permission.allowed, /mcp__forklight_checkpoint__run/);
});

test("an interrupted Worker never records a successful exit code", () => {
  assert.equal(interruptedExitCode(0), 130);
  assert.equal(interruptedExitCode(143), 143);
});

test("Claude Worker canonicalizes its runtime temp directory for the macOS sandbox", () => {
  assert.equal(runtimeTemporaryDirectory({}), realpathSync("/tmp"));
  assert.equal(
    runtimeTemporaryDirectory({ TMPDIR: "/tmp" }),
    realpathSync("/tmp"),
  );
  assert.deepEqual(
    runtimeTemporaryDirectoryAliases({ TMPDIR: "/tmp" }),
    [
      "/tmp",
      realpathSync("/tmp"),
      `/tmp/claude-${process.getuid?.() ?? 0}`,
      `${realpathSync("/tmp")}/claude-${process.getuid?.() ?? 0}`,
    ],
  );
});

test("checkpoint MCP configuration contains identity but no credential or command text", async () => {
  const task = {
    id: "task-1",
    sourcePath: "/Users/example/original-project",
    paths: {
      root: "/tmp/forklight-home/runs/task-1",
      workspace: "/tmp/forklight-home/runs/task-1/workspace",
      claudeConfig: "/tmp/forklight-home/runs/task-1/claude-config",
    },
    spec: {
      acceptance: { commands: ["npm test -- --secret-contract-text"] },
      runtime: { executable: "claude" },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
    },
  } as unknown as TaskRecord;
  const attempt = { id: "attempt-1", taskId: task.id } as AttemptRecord;
  const { checkpointLaunch } = await import("../src/core/checkpoint.js");
  const workerModule = await import("../src/workers/claude.js");
  const launch = checkpointLaunch(task, attempt);
  const mcpConfig = (workerModule as unknown as {
    checkpointMcpConfiguration: (task: TaskRecord, attempt: AttemptRecord) => string;
  }).checkpointMcpConfiguration(task, attempt);

  assert.deepEqual(Object.keys(launch.env).sort(), [
    "FORKLIGHT_CHECKPOINT_ATTEMPT_ID",
    "FORKLIGHT_CHECKPOINT_TASK_ID",
    "FORKLIGHT_HOME",
  ]);
  assert.match(mcpConfig, /forklight_checkpoint/);
  assert.match(mcpConfig, /task-1/);
  assert.match(mcpConfig, /attempt-1/);
  assert.doesNotMatch(mcpConfig, /api[-_]?key|auth[_-]?token/i);
  assert.doesNotMatch(mcpConfig, /secret-contract-text|original-project|\.git/);
  assert.doesNotMatch(mcpConfig, /GIT_DIR|GIT_INDEX_FILE|verifier-git/);

  const { scrubCheckpointEnvironment } = await import("../src/checkpoint/server.js");
  const environment = {
    FORKLIGHT_HOME: "/tmp/forklight-home",
    ANTHROPIC_AUTH_TOKEN: "secret",
    OPENAI_API_KEY: "secret",
    PATH: "/usr/bin",
  };
  scrubCheckpointEnvironment(environment);
  assert.deepEqual(environment, {
    FORKLIGHT_HOME: "/tmp/forklight-home",
    PATH: "/usr/bin",
  });
});

test("macOS Worker launch restricts writes to task-owned directories", { skip: process.platform !== "darwin" }, () => {
  const task = {
    paths: {
      root: "/tmp/forklight-task/runs/task-1",
      workspace: "/tmp/forklight-task/workspace",
      claudeConfig: "/tmp/forklight-task/claude-config",
    },
    spec: {
      runtime: { executable: "claude" },
    },
  } as unknown as TaskRecord;
  const launch = workerLaunch(task, ["--version"]);
  assert.equal(launch.command, "/usr/bin/sandbox-exec");
  assert.equal(launch.isolation, "macos-sandbox");
  const profile = launch.args[1] ?? "";
  assert.match(profile, /\(deny default\)/);
  assert.match(profile, /\(deny file-read\*/);
  assert.match(profile, /forklight-task\/workspace/);
  assert.match(profile, /forklight-task\/claude-config/);
  assert.match(profile, new RegExp(`\\(subpath "\\/tmp\\/claude-${process.getuid?.() ?? 0}"\\)`));
  assert.match(profile, new RegExp(`\\(subpath "\\/private\\/tmp\\/claude-${process.getuid?.() ?? 0}"\\)`));
  assert.match(profile, /daemon\/protocol\.ts/);
  assert.match(profile, /core\/build-identity\.ts/);
  assert.match(profile, /forklight\.sock/);
  const sourceRoot = path.join(
    path.dirname(path.dirname(fileURLToPath(import.meta.url))),
    "src",
  );
  const escapedSourceRoot = sourceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(profile, new RegExp(`\\(literal "${escapedSourceRoot}"\\)`));
  assert.doesNotMatch(profile, /fixtures\/checkout/);
  assert.doesNotMatch(profile, /verifier-git|GIT_DIR|GIT_INDEX_FILE/);
});

test("macOS checkpoint launch sandbox allows the exact Node runtime and canonical modules, never broad Home", { skip: process.platform !== "darwin" }, () => {
  const task = {
    id: "task-ckpt-perm",
    paths: {
      root: "/tmp/forklight-perm/runs/task-ckpt-perm",
      workspace: "/tmp/forklight-perm/runs/task-ckpt-perm/workspace",
      claudeConfig: "/tmp/forklight-perm/runs/task-ckpt-perm/claude-config",
    },
    spec: {
      runtime: { executable: "claude" },
    },
  } as unknown as TaskRecord;
  const launch = workerLaunch(task, ["--version"]);
  assert.equal(launch.command, "/usr/bin/sandbox-exec");
  const profile = launch.args[1] ?? "";
  const nodeExec = process.execPath;
  // The exact Node runtime (and its realpath) used to launch the checkpoint
  // MCP server is readable; a broad Home read allow is never added.
  assert.match(profile, new RegExp(`\\(literal "${escapeRegExp(nodeExec)}"\\)`));
  assert.match(profile, new RegExp(`\\(literal "${escapeRegExp(realpathSync(nodeExec))}"\\)`));
  assert.equal(profile.indexOf("(allow file-read* (subpath"), -1);
  assert.equal(profile.indexOf(`(allow file-read* (subpath "${homedir()}")`), -1);
  // Canonical source/dist module closure proven necessary for the server.
  assert.match(profile, /activation\/runner\.ts/);
  assert.match(profile, /core\/process\.ts/);
  assert.match(profile, /core\/source-digest\.ts/);
  assert.match(profile, /core\/time\.ts/);
  assert.match(profile, /daemon\/client\.ts/);
  assert.match(profile, /daemon\/protocol\.ts/);
  assert.match(profile, /core\/config\.ts/);
  assert.match(profile, /core\/build-identity\.ts/);
  // Workspace isolation stays intact: the exact configured workspace path is
  // exempt from the Home read-deny (asserted by its full path, not a shortened
  // substring), and verifier credential state never leaks into the profile.
  const workspace = "/tmp/forklight-perm/runs/task-ckpt-perm/workspace";
  assert.match(profile, new RegExp(`\\(require-not \\(subpath "${escapeRegExp(workspace)}"\\)\\)`));
  assert.doesNotMatch(profile, /verifier-git|GIT_DIR|GIT_INDEX_FILE/);
  // process.execPath is literal-only: never a subpath exception that would
  // broaden the Node/NVM directory or its parents into a readable tree.
  assert.doesNotMatch(profile, new RegExp(`\\(require-not \\(subpath "${escapeRegExp(nodeExec)}"\\)\\)`));
  assert.doesNotMatch(profile, new RegExp(`\\(require-not \\(subpath "${escapeRegExp(path.dirname(nodeExec))}"\\)\\)`));
  assert.doesNotMatch(profile, new RegExp(`\\(require-not \\(subpath "${escapeRegExp(path.join(homedir(), ".nvm"))}"\\)\\)`));
  // The four canonical module files are literal-only exceptions as well.
  assert.doesNotMatch(profile, /\(require-not \(subpath "[^"]*src\/activation\/runner\.ts"\)\)/);
  assert.doesNotMatch(profile, /\(require-not \(subpath "[^"]*src\/core\/process\.ts"\)\)/);
  assert.doesNotMatch(profile, /\(require-not \(subpath "[^"]*src\/core\/source-digest\.ts"\)\)/);
  assert.doesNotMatch(profile, /\(require-not \(subpath "[^"]*src\/core\/time\.ts"\)\)/);
});
