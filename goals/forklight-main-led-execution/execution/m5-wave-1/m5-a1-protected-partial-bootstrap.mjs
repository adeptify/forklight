#!/usr/bin/env node

// Operational bootstrap for the accepted M5-A1 protected-partial recovery.
// It reads the immutable failed Task before the Grok child starts, proves the
// fresh Workspace starts from the same source bytes, copies exactly the
// accepted partial paths, and then forwards ForkLight's native /goal argv.
// This is project execution evidence, not product code.

import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const REAL_GROK = "/Users/yijunwang/.grok/bin/grok";
const OLD_TASK_ROOT = "/Users/yijunwang/Library/Application Support/ForkLight/runs/245a5dec-eb63-4c6b-9971-2e503c55109d";
const MARKER_RELATIVE = ".forklight/m5-a1-protected-partial.json";
const EXPECTED_PATHS = [
  "README.md",
  "docs/configuration.md",
  "docs/m1-clean-user-runbook.md",
  "docs/operations.md",
  "src/cli.ts",
  "src/cli/setup.ts",
  "src/core/providers.ts",
  "src/hub/server.ts",
  "src/setup/service.ts",
  "src/setup/status.ts",
  "src/setup/types.ts",
  "tests/cli-setup.test.ts",
  "tests/hub-main-install.test.ts",
  "tests/hub-settings.test.ts",
  "tests/main-install-skill.test.ts",
  "tests/setup-service.test.ts",
];

const argv = process.argv.slice(2);
const childEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function valueAfter(flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : undefined;
}

function fail(message, detail = "") {
  process.stderr.write(`${message}${detail.trim().length > 0 ? `: ${detail.trim()}` : ""}\n`);
  process.exit(66);
}

function fileBytes(file, label, allowMissing = false) {
  if (!existsSync(file)) {
    if (allowMissing) return undefined;
    fail(`${label} is missing`);
  }
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label} is not an ordinary file`);
  return readFileSync(file);
}

function sameBytes(left, right) {
  if (left === undefined || right === undefined) return left === right;
  return left.equals(right);
}

function materialize(workspace) {
  const markerPath = path.join(workspace, MARKER_RELATIVE);
  if (existsSync(markerPath)) {
    let marker;
    try {
      marker = JSON.parse(readFileSync(markerPath, "utf8"));
    } catch (error) {
      fail("M5-A1 partial marker is unreadable", error instanceof Error ? error.message : String(error));
    }
    if (
      marker.sourceTaskId !== "245a5dec-eb63-4c6b-9971-2e503c55109d"
      || !Array.isArray(marker.paths)
      || JSON.stringify(marker.paths) !== JSON.stringify(EXPECTED_PATHS)
    ) fail("M5-A1 partial marker does not match the accepted recovery");
    for (const relative of EXPECTED_PATHS) {
      const expected = fileBytes(path.join(OLD_TASK_ROOT, "workspace", relative), "protected partial");
      const actual = fileBytes(path.join(workspace, relative), "materialized partial");
      if (!sameBytes(expected, actual)) fail(`Materialized M5-A1 partial changed before resume: ${relative}`);
    }
    return;
  }

  for (const relative of EXPECTED_PATHS) {
    const oldBaseline = fileBytes(
      path.join(OLD_TASK_ROOT, "baseline", relative),
      "protected baseline",
      true,
    );
    const freshBaseline = fileBytes(path.join(workspace, relative), "fresh Workspace source", true);
    if (!sameBytes(oldBaseline, freshBaseline)) {
      fail(`M5-A1 recovery source base does not match the protected Task: ${relative}`);
    }
    const partialPath = path.join(OLD_TASK_ROOT, "workspace", relative);
    fileBytes(partialPath, "protected partial");
    const target = path.join(workspace, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(partialPath, target);
  }

  mkdirSync(path.dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, `${JSON.stringify({
    sourceTaskId: "245a5dec-eb63-4c6b-9971-2e503c55109d",
    paths: EXPECTED_PATHS,
  }, null, 2)}\n`);
}

const workspace = valueAfter("--cwd") ?? process.cwd();
const prompt = valueAfter("-p") ?? "";
const sessionId = valueAfter("--resume") ?? valueAfter("--session-id");

if (
  prompt.length === 0
  || !prompt.startsWith("/goal ")
  || !sessionId
  || process.env.GROK_GOAL !== "1"
  || process.env.GROK_WORKFLOWS !== "1"
  || process.env.GROK_GOAL_USE_CURRENT_MODEL_ONLY !== "1"
) fail("M5-A1 recovery requires ForkLight's current-model-only native Goal invocation");

materialize(workspace);

const child = spawn(REAL_GROK, argv, {
  cwd: workspace,
  env: childEnv,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  process.stderr.write(`M5-A1 recovery could not launch Grok: ${error.message}\n`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});

