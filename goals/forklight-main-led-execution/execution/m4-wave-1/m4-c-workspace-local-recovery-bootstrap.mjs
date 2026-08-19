#!/usr/bin/env node

// Operational bootstrap for the authorized M4-C exact-Candidate recovery.
// The protected Candidate patch is part of this Task's source snapshot, so
// no sibling Task path is read after the Workspace sandbox starts.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const REAL_GROK = "/Users/yijunwang/.grok/bin/grok";
const SEED_RELATIVE = "goals/forklight-main-led-execution/execution/m4-wave-1/m4-c-retained-candidate.patch";
const MARKER_RELATIVE = ".forklight/m4-c-retained-candidate.json";
const EXPECTED_DIGEST = "92c1e363639903d243cc3a1939d50d69ee2f7198e50b0d741286a07c6d836312";
const EXPECTED_PATHS = new Set([
  "src/cli.ts",
  "src/core/main-token-value-report.ts",
  "src/daemon/coordinator.ts",
  "src/daemon/protocol.ts",
  "src/daemon/server.ts",
  "src/mcp/server.ts",
  "tests/daemon-cli.test.ts",
  "tests/daemon.test.ts",
  "tests/main-token-value-report.test.ts",
  "tests/mcp.test.ts",
]);

const argv = process.argv.slice(2);
const gitEnv = {
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
    if (match[1] !== match[2]) fail("M4-C recovery seed contains a renamed path");
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
    env: gitEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function materializeSeed(workspace) {
  const seedPath = path.join(workspace, SEED_RELATIVE);
  let seed;
  try {
    seed = readFileSync(seedPath);
  } catch (error) {
    fail("M4-C recovery seed is missing or unreadable", error instanceof Error ? error.message : String(error));
  }
  const digest = createHash("sha256").update(seed).digest("hex");
  if (digest !== EXPECTED_DIGEST) fail("M4-C recovery seed does not match the authorized Candidate");
  const paths = seedPaths(seed.toString("utf8"));
  if (!exactPathSet(paths)) fail("M4-C recovery seed path set does not match the authorized ten paths");

  const markerPath = path.join(workspace, MARKER_RELATIVE);
  if (!existsSync(markerPath)) {
    const forward = gitApply(workspace, seedPath, ["--check"]);
    if (forward.status !== 0) fail("M4-C recovery seed does not match this Task source base", forward.stderr);
    const applied = gitApply(workspace, seedPath, []);
    if (applied.status !== 0) fail("M4-C recovery seed could not be materialized", applied.stderr);
    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, `${JSON.stringify({ seed: SEED_RELATIVE, digest, paths }, null, 2)}\n`);
    return;
  }

  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch (error) {
    fail("M4-C recovery marker is unreadable", error instanceof Error ? error.message : String(error));
  }
  if (
    marker.seed !== SEED_RELATIVE
    || marker.digest !== EXPECTED_DIGEST
    || !Array.isArray(marker.paths)
    || !exactPathSet(marker.paths)
  ) fail("M4-C recovery marker does not match the authorized seed");
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
) fail("M4-C recovery requires ForkLight's current-model-only native Goal invocation");

materializeSeed(workspace);

const child = spawn(REAL_GROK, argv, {
  cwd: workspace,
  env: gitEnv,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));

child.on("error", (error) => {
  process.stderr.write(`M4-C recovery could not launch Grok: ${error.message}\n`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
