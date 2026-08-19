#!/usr/bin/env node

// Operational bootstrap for the explicitly authorized M3-C2 recovery. It
// materializes the exact protected partial only on the fresh Task's first
// launch, then preserves later validation-repair or Main-correction edits.
// The source-base and path-set checks prevent adopting a Candidate from the
// wrong product/test base; this file is not product code.

import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const REAL_GROK = "/Users/yijunwang/.grok/bin/grok";
const SEED_TASK_ID = "bbec21f9-ae21-4bfd-9cc4-9476aea3f73a";
const SEED_ROOT = `/Users/yijunwang/Library/Application Support/ForkLight/runs/${SEED_TASK_ID}`;
const SEED_BASELINE = path.join(SEED_ROOT, "baseline");
const SEED_WORKSPACE = path.join(SEED_ROOT, "workspace");
const MARKER_RELATIVE = ".forklight/m3-c2-exact-partial-materialized.json";
const SCANNED_ROOTS = ["src", "tests"];
const EXPECTED_PATHS = new Set([
  "src/core/statistics.ts",
  "src/core/model-routing.ts",
  "src/core/strategy-advice.ts",
  "src/daemon/coordinator.ts",
  "src/cli/routing-output.ts",
  "src/mcp/server.ts",
  "tests/statistics.test.ts",
  "tests/model-routing.test.ts",
  "tests/competition.test.ts",
  "tests/review-graph.test.ts",
  "tests/main-failure-attribution.test.ts",
  "tests/daemon.test.ts",
  "tests/daemon-cli.test.ts",
  "tests/mcp.test.ts",
]);

const argv = process.argv.slice(2);

function valueAfter(flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : undefined;
}

function fail(message, detail = "") {
  process.stderr.write(`${message}${detail.trim().length > 0 ? `: ${detail.trim()}` : ""}\n`);
  process.exit(66);
}

function collectFiles(root, relative, files) {
  const absolute = path.join(root, relative);
  if (!existsSync(absolute)) return;
  const stat = statSync(absolute);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(absolute).sort()) {
      collectFiles(root, path.join(relative, entry), files);
    }
    return;
  }
  files.set(relative.split(path.sep).join("/"), readFileSync(absolute));
}

function changedProductTestPaths(left, right) {
  const leftFiles = new Map();
  const rightFiles = new Map();
  for (const root of SCANNED_ROOTS) {
    collectFiles(left, root, leftFiles);
    collectFiles(right, root, rightFiles);
  }
  const paths = new Set([...leftFiles.keys(), ...rightFiles.keys()]);
  return [...paths]
    .filter((candidate) => {
      const leftValue = leftFiles.get(candidate);
      const rightValue = rightFiles.get(candidate);
      return !leftValue || !rightValue || !leftValue.equals(rightValue);
    })
    .sort();
}

function exactPathSet(actual, expected) {
  return actual.length === expected.size && actual.every((candidate) => expected.has(candidate));
}

function materializeExactPartial(workspace) {
  const seedDelta = changedProductTestPaths(SEED_BASELINE, SEED_WORKSPACE);
  if (!exactPathSet(seedDelta, EXPECTED_PATHS)) {
    fail("M3-C2 protected partial path set no longer matches the authorized 14 paths", seedDelta.join(", "));
  }

  const markerPath = path.join(workspace, MARKER_RELATIVE);
  const currentDelta = changedProductTestPaths(SEED_BASELINE, workspace);
  if (!existsSync(markerPath)) {
    if (currentDelta.length !== 0) {
      fail("M3-C2 recovery Workspace does not match the protected partial source base", currentDelta.join(", "));
    }
    for (const relative of EXPECTED_PATHS) {
      const source = path.join(SEED_WORKSPACE, relative);
      const destination = path.join(workspace, relative);
      if (!existsSync(source)) fail("M3-C2 protected partial is missing an authorized path", relative);
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    }
    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, `${JSON.stringify({ seedTaskId: SEED_TASK_ID, paths: [...EXPECTED_PATHS] }, null, 2)}\n`);
  } else {
    let marker;
    try {
      marker = JSON.parse(readFileSync(markerPath, "utf8"));
    } catch (error) {
      fail("M3-C2 recovery materialization marker is unreadable", error instanceof Error ? error.message : String(error));
    }
    if (marker.seedTaskId !== SEED_TASK_ID) fail("M3-C2 recovery marker names the wrong seed Task");
    if (!Array.isArray(marker.paths) || !exactPathSet([...marker.paths].sort(), EXPECTED_PATHS)) {
      fail("M3-C2 recovery marker names the wrong path set");
    }
  }

  const materializedDelta = changedProductTestPaths(SEED_BASELINE, workspace);
  if (!exactPathSet(materializedDelta, EXPECTED_PATHS)) {
    fail("M3-C2 recovery contains product/test changes outside the authorized 14 paths", materializedDelta.join(", "));
  }
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
) fail("M3-C2 recovery requires ForkLight's current-model-only native Goal invocation");

materializeExactPartial(workspace);

const child = spawn(REAL_GROK, argv, {
  cwd: workspace,
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  process.stderr.write(`M3-C2 recovery could not launch Grok: ${error.message}\n`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
