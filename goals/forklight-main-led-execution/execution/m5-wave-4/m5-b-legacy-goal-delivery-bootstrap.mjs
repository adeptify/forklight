#!/usr/bin/env node

// Operational bridge for the exact M5-B structural-mobile Candidate.
// ForkLight still invokes a real native `/goal`; this wrapper selects Grok's
// documented legacy model-facing Goal driver so the host-owned workflow's
// fixed ten-minute classifier barrier cannot discard an otherwise complete
// read-only delivery.

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const REAL_GROK = "/Users/yijunwang/.grok/bin/grok";
const SEED_RELATIVE = "goals/forklight-main-led-execution/execution/m5-wave-4/m5-b-structural-mobile-candidate.patch";
const DELTA_RELATIVE = "goals/forklight-main-led-execution/execution/m5-wave-4/m5-b-structural-mobile-delta.patch";
const MARKER_RELATIVE = ".forklight/m5-b-legacy-goal-delivery-seed.json";
const FOREGROUND_BUDGET_MS = "86400000";
const EXPECTED_SEED_PATHS = new Set([
  "DESIGN.md",
  "src/hub/public/app.css",
  "src/hub/public/app.js",
  "src/hub/public/i18n.js",
  "src/hub/public/index.html",
  "tests/hub-responsive-layout.test.ts",
  "tests/hub-ui-assets.test.ts",
]);
const EXPECTED_DELTA_PATHS = new Set([
  "src/hub/public/app.css",
  "src/hub/public/app.js",
  "src/hub/public/index.html",
  "tests/hub-responsive-layout.test.ts",
]);

const argv = process.argv.slice(2);
const childEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GROK_WORKFLOWS: "0",
  GROK_FOREGROUND_BLOCK_BUDGET_MS: FOREGROUND_BUDGET_MS,
};

function valueAfter(flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : undefined;
}

function fail(message, detail = "") {
  process.stderr.write(`${message}${detail.trim().length > 0 ? `: ${detail.trim()}` : ""}\n`);
  process.exit(66);
}

function seedPaths(seedText) {
  const paths = [];
  for (const match of seedText.matchAll(
    /^diff --git a\/(?:baseline|workspace)\/(.+) b\/workspace\/(.+)$/gm,
  )) {
    if (match[1] !== match[2]) fail("M5-B exact Candidate contains a renamed path");
    paths.push(match[2]);
  }
  return paths;
}

function deltaPaths(deltaText) {
  return [...deltaText.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]);
}

function exactPathSet(paths, expected) {
  const unique = new Set(paths);
  return paths.length === expected.size
    && unique.size === expected.size
    && paths.every((candidate) => expected.has(candidate));
}

function gitApply(workspace, patchPath, stripLevel, extra) {
  return spawnSync("/usr/bin/git", ["apply", `-p${stripLevel}`, ...extra, patchPath], {
    cwd: workspace,
    encoding: "utf8",
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readPatch(workspace, relativePath, label) {
  try {
    return readFileSync(path.join(workspace, relativePath), "utf8");
  } catch (error) {
    fail(`${label} is missing or unreadable`, error instanceof Error ? error.message : String(error));
  }
}

function materializeExactCandidate(workspace) {
  const seedPath = path.join(workspace, SEED_RELATIVE);
  const deltaPath = path.join(workspace, DELTA_RELATIVE);
  const seedText = readPatch(workspace, SEED_RELATIVE, "M5-B retained Candidate");
  const deltaText = readPatch(workspace, DELTA_RELATIVE, "M5-B structural-mobile delta");
  const seed = seedPaths(seedText);
  const delta = deltaPaths(deltaText);
  if (!exactPathSet(seed, EXPECTED_SEED_PATHS)) {
    fail("M5-B retained Candidate path set is not the accepted seven paths");
  }
  if (!exactPathSet(delta, EXPECTED_DELTA_PATHS)) {
    fail("M5-B structural-mobile delta path set is not the accepted four paths");
  }

  const markerPath = path.join(workspace, MARKER_RELATIVE);
  if (!existsSync(markerPath)) {
    const seedCheck = gitApply(workspace, seedPath, 2, ["--check"]);
    if (seedCheck.status !== 0) fail("M5-B retained Candidate does not match this source base", seedCheck.stderr);
    const seeded = gitApply(workspace, seedPath, 2, []);
    if (seeded.status !== 0) fail("M5-B retained Candidate could not be materialized", seeded.stderr);

    const deltaCheck = gitApply(workspace, deltaPath, 1, ["--check"]);
    if (deltaCheck.status !== 0) fail("M5-B structural-mobile delta does not match the retained Candidate", deltaCheck.stderr);
    const completed = gitApply(workspace, deltaPath, 1, []);
    if (completed.status !== 0) fail("M5-B structural-mobile delta could not be materialized", completed.stderr);

    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, `${JSON.stringify({
      seed: SEED_RELATIVE,
      delta: DELTA_RELATIVE,
      seedPaths: seed,
      deltaPaths: delta,
    }, null, 2)}\n`);
    return;
  }

  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch (error) {
    fail("M5-B legacy Goal seed marker is unreadable", error instanceof Error ? error.message : String(error));
  }
  if (
    marker.seed !== SEED_RELATIVE
    || marker.delta !== DELTA_RELATIVE
    || !Array.isArray(marker.seedPaths)
    || !Array.isArray(marker.deltaPaths)
    || !exactPathSet(marker.seedPaths, EXPECTED_SEED_PATHS)
    || !exactPathSet(marker.deltaPaths, EXPECTED_DELTA_PATHS)
  ) fail("M5-B legacy Goal seed marker does not match the accepted Candidate");
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
  || process.env.GROK_FOREGROUND_BLOCK_BUDGET_MS !== FOREGROUND_BUDGET_MS
) fail("M5-B delivery requires ForkLight's current-model-only native Goal environment");

materializeExactCandidate(workspace);

const child = spawn(REAL_GROK, argv, {
  cwd: workspace,
  env: childEnv,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  process.stderr.write(`M5-B legacy Goal delivery could not launch Grok: ${error.message}\n`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
