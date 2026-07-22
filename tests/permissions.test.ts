import assert from "node:assert/strict";
import test from "node:test";
import type { TaskRecord } from "../src/core/types.js";
import {
  allowedToolArguments,
  interruptedExitCode,
  workerLaunch,
} from "../src/workers/claude.js";

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
});

test("an interrupted Worker never records a successful exit code", () => {
  assert.equal(interruptedExitCode(0), 130);
  assert.equal(interruptedExitCode(143), 143);
});

test("macOS Worker launch restricts writes to task-owned directories", { skip: process.platform !== "darwin" }, () => {
  const task = {
    paths: {
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
  assert.doesNotMatch(profile, /fixtures\/checkout/);
});
