#!/usr/bin/env node

// Final M4-C non-Git post-state-proof replacement. The accepted patches live in
// this Task snapshot; Grok only inspects the materialized exact Candidate.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const REAL_GROK = "/Users/yijunwang/.grok/bin/grok";
const BASE_RELATIVE = "goals/forklight-main-led-execution/execution/m4-wave-1/m4-c-retained-candidate.patch";
const DELTA_RELATIVE = "goals/forklight-main-led-execution/execution/m4-wave-1/m4-c-final-test-delta.patch";
const MARKER_RELATIVE = ".forklight/m4-c-non-git-post-state-proof-replacement.json";
const BASE_DIGEST = "92c1e363639903d243cc3a1939d50d69ee2f7198e50b0d741286a07c6d836312";
const DELTA_DIGEST = "1c997a355684d4b17b96d9753abe72ceca9b15080434889097e24c60f724d6e8";
const TEST_PATH = "tests/main-token-value-report.test.ts";
const EXPECTED_PATHS = new Set([
  "src/cli.ts",
  "src/core/main-token-value-report.ts",
  "src/daemon/coordinator.ts",
  "src/daemon/protocol.ts",
  "src/daemon/server.ts",
  "src/mcp/server.ts",
  "tests/daemon-cli.test.ts",
  "tests/daemon.test.ts",
  TEST_PATH,
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

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function basePaths(text) {
  const paths = [];
  for (const match of text.matchAll(
    /^diff --git a\/(?:baseline|workspace)\/(.+) b\/workspace\/(.+)$/gm,
  )) {
    if (match[1] !== match[2]) fail("M4-C base seed contains a renamed path");
    paths.push(match[2]);
  }
  return paths;
}

function exactBasePaths(paths) {
  const unique = new Set(paths);
  return paths.length === EXPECTED_PATHS.size
    && unique.size === EXPECTED_PATHS.size
    && paths.every((candidate) => EXPECTED_PATHS.has(candidate));
}

function gitApply(workspace, patchPath, strip, extra = []) {
  return spawnSync("/usr/bin/git", ["apply", `-p${strip}`, ...extra, patchPath], {
    cwd: workspace,
    encoding: "utf8",
    env: gitEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function assertApply(result, message) {
  if (result.status !== 0) fail(message, result.stderr);
}

function materialize(workspace) {
  const basePath = path.join(workspace, BASE_RELATIVE);
  const deltaPath = path.join(workspace, DELTA_RELATIVE);
  let base;
  let delta;
  try {
    base = readFileSync(basePath);
    delta = readFileSync(deltaPath);
  } catch (error) {
    fail(
      "M4-C replacement seed is missing or unreadable",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (digest(base) !== BASE_DIGEST) fail("M4-C base seed digest does not match");
  if (digest(delta) !== DELTA_DIGEST) fail("M4-C final test delta digest does not match");
  const paths = basePaths(base.toString("utf8"));
  if (!exactBasePaths(paths)) fail("M4-C base seed path set does not match the authorized ten paths");
  const deltaText = delta.toString("utf8");
  if (!deltaText.startsWith(`--- a/${TEST_PATH}\n+++ b/${TEST_PATH}\n`)) {
    fail("M4-C final delta does not target only the authorized test");
  }
  if ((deltaText.match(/^--- /gm) ?? []).length !== 1
    || (deltaText.match(/^\+\+\+ /gm) ?? []).length !== 1) {
    fail("M4-C final delta contains more than one path");
  }

  const markerPath = path.join(workspace, MARKER_RELATIVE);
  if (!existsSync(markerPath)) {
    assertApply(gitApply(workspace, basePath, 2, ["--check"]), "M4-C base seed does not match this source base");
    assertApply(gitApply(workspace, basePath, 2), "M4-C base seed could not be materialized");
    assertApply(gitApply(workspace, deltaPath, 1, ["--check"]), "M4-C final test delta does not match the retained seed");
    assertApply(gitApply(workspace, deltaPath, 1), "M4-C final test delta could not be materialized");
    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, `${JSON.stringify({ base: BASE_DIGEST, delta: DELTA_DIGEST, paths }, null, 2)}\n`);
  } else {
    let marker;
    try {
      marker = JSON.parse(readFileSync(markerPath, "utf8"));
    } catch (error) {
      fail(
        "M4-C replacement marker is unreadable",
        error instanceof Error ? error.message : String(error),
      );
    }
    if (marker.base !== BASE_DIGEST || marker.delta !== DELTA_DIGEST
      || !exactBasePaths(marker.paths ?? [])) {
      fail("M4-C replacement marker does not match the authorized Candidate");
    }
  }

  assertApply(
    gitApply(workspace, deltaPath, 1, ["--reverse", "--check"]),
    "M4-C final test state drifted",
  );
  assertApply(
    gitApply(workspace, basePath, 2, ["--reverse", "--check", `--exclude=${TEST_PATH}`]),
    "M4-C retained non-test paths drifted",
  );
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
) fail("M4-C replacement requires ForkLight current-model-only native Goal invocation");

materialize(workspace);

const child = spawn(REAL_GROK, argv, { cwd: workspace, env: gitEnv, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
  process.stderr.write(`M4-C replacement could not launch Grok: ${error.message}\n`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
