#!/usr/bin/env node

// Operational bootstrap for the bounded M5-B Attempt-3 Candidate recovery.
// The retained seven-path Candidate is part of this Task's source snapshot, so
// Grok never reads or mutates the failed sibling Task Workspace.

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const REAL_GROK = "/Users/yijunwang/.grok/bin/grok";
const SEED_RELATIVE = "goals/forklight-main-led-execution/execution/m5-wave-4/m5-b-attempt-3-candidate.patch";
const MARKER_RELATIVE = ".forklight/m5-b-attempt-3-seed.json";
const EXPECTED_PATHS = new Set([
  "DESIGN.md",
  "src/hub/public/app.css",
  "src/hub/public/app.js",
  "src/hub/public/i18n.js",
  "src/hub/public/index.html",
  "tests/hub-responsive-layout.test.ts",
  "tests/hub-ui-assets.test.ts",
]);

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

function seedPaths(seedText) {
  const paths = [];
  for (const match of seedText.matchAll(
    /^diff --git a\/(?:baseline|workspace)\/(.+) b\/workspace\/(.+)$/gm,
  )) {
    if (match[1] !== match[2]) fail("M5-B retained Candidate contains a renamed path");
    paths.push(match[2]);
  }
  return paths;
}

function exactPathSet(paths) {
  const unique = new Set(paths);
  return paths.length === EXPECTED_PATHS.size
    && unique.size === EXPECTED_PATHS.size
    && paths.every((candidate) => EXPECTED_PATHS.has(candidate));
}

function gitApply(workspace, seedPath, extra) {
  return spawnSync("/usr/bin/git", ["apply", "-p2", ...extra, seedPath], {
    cwd: workspace,
    encoding: "utf8",
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function materializeWorkspaceLocalSeed(workspace) {
  const seedPath = path.join(workspace, SEED_RELATIVE);
  let seedText;
  try {
    seedText = readFileSync(seedPath, "utf8");
  } catch (error) {
    fail("M5-B retained Candidate is missing or unreadable", error instanceof Error ? error.message : String(error));
  }
  const paths = seedPaths(seedText);
  if (!exactPathSet(paths)) fail("M5-B retained Candidate path set is not the accepted seven paths");

  const markerPath = path.join(workspace, MARKER_RELATIVE);
  if (!existsSync(markerPath)) {
    const forward = gitApply(workspace, seedPath, ["--check"]);
    if (forward.status !== 0) {
      fail("M5-B retained Candidate does not match this Task source base", forward.stderr);
    }
    const applied = gitApply(workspace, seedPath, []);
    if (applied.status !== 0) fail("M5-B retained Candidate could not be materialized", applied.stderr);
    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, `${JSON.stringify({ seed: SEED_RELATIVE, paths }, null, 2)}\n`);
    return;
  }

  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch (error) {
    fail("M5-B retained Candidate marker is unreadable", error instanceof Error ? error.message : String(error));
  }
  if (marker.seed !== SEED_RELATIVE || !Array.isArray(marker.paths) || !exactPathSet(marker.paths)) {
    fail("M5-B retained Candidate marker does not match the accepted seed");
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
) fail("M5-B recovery requires ForkLight's current-model-only native Goal invocation");

materializeWorkspaceLocalSeed(workspace);

const child = spawn(REAL_GROK, argv, {
  cwd: workspace,
  env: childEnv,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  process.stderr.write(`M5-B recovery could not launch Grok: ${error.message}\n`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
