#!/usr/bin/env node

// One-shot operational materializer for the authorized M3-B recovery. It
// applies the exact protected Candidate inside the isolated Task Workspace,
// freezes every retained path except the sole test-fixture delta, and then
// delegates unchanged native /goal argv/env to the real Grok CLI. This file is
// project execution evidence and is never part of the product Candidate.

import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const REAL_GROK = "/Users/yijunwang/.grok/bin/grok";
const SEED_RELATIVE = "goals/forklight-main-led-execution/execution/m3-wave-2/23b7f864-6f6f-44ac-9726-6b0c83bbfe50.patch";
const EXPECTED_DIGEST = "7fb1fdcf9f156964ac4444c1611e91c77c6b958538eaf34088b9c8780bf30a3a";
const DELTA_PATH = "tests/mcp.test.ts";
const RETAINED_PATHS = new Set([
  "src/core/routing-explanation.ts",
  "src/core/task-preview.ts",
  "src/core/task.ts",
  "src/core/types.ts",
  "src/mcp/server.ts",
  "tests/daemon-cli.test.ts",
  "tests/daemon.test.ts",
  "tests/mcp.test.ts",
  "tests/routing-explanation.test.ts",
  "tests/task-preview.test.ts",
  "tests/task.test.ts",
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

function gitApply(workspace, seedPath, extra) {
  return spawnSync("/usr/bin/git", ["apply", "-p2", ...extra, seedPath], {
    cwd: workspace,
    encoding: "utf8",
    env: gitEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function seedPaths(seedText) {
  const paths = [];
  for (const match of seedText.matchAll(
    /^diff --git a\/(baseline|workspace)\/(.+) b\/workspace\/(.+)$/gm,
  )) {
    if (match[2] !== match[3]) fail("M3-B recovery seed contains a renamed path");
    paths.push(match[3]);
  }
  return paths;
}

function materializeExactCandidate(workspace) {
  const seedPath = path.join(workspace, SEED_RELATIVE);
  let seed;
  try {
    seed = readFileSync(seedPath);
  } catch (error) {
    fail("M3-B recovery seed is missing or unreadable", error instanceof Error ? error.message : String(error));
  }

  const digest = createHash("sha256").update(seed).digest("hex");
  if (digest !== EXPECTED_DIGEST) fail("M3-B recovery seed digest does not match the authorized Candidate");

  const paths = seedPaths(seed.toString("utf8"));
  const unique = new Set(paths);
  if (
    paths.length !== RETAINED_PATHS.size
    || unique.size !== RETAINED_PATHS.size
    || paths.some((candidate) => !RETAINED_PATHS.has(candidate))
  ) fail("M3-B recovery seed path set does not match the authorized Candidate");

  const forward = gitApply(workspace, seedPath, ["--check"]);
  if (forward.status === 0) {
    const applied = gitApply(workspace, seedPath, []);
    if (applied.status !== 0) fail("M3-B recovery seed could not be materialized", applied.stderr);
  } else {
    // A daemon restart may relaunch the same durable Attempt after Grok has
    // already touched the sole authorized delta. The other ten paths must
    // still prove exact reverse applicability before the same Goal resumes.
    const retained = gitApply(workspace, seedPath, [
      "--reverse",
      "--check",
      `--exclude=${DELTA_PATH}`,
    ]);
    if (retained.status !== 0) {
      fail("M3-B Candidate does not match this Workspace source base", forward.stderr);
    }
  }

  const retained = gitApply(workspace, seedPath, [
    "--reverse",
    "--check",
    `--exclude=${DELTA_PATH}`,
  ]);
  if (retained.status !== 0) fail("M3-B retained Candidate paths changed before Grok launch", retained.stderr);
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
) fail("M3-B recovery requires ForkLight's current-model-only native Goal invocation");

materializeExactCandidate(workspace);

for (const retainedPath of RETAINED_PATHS) {
  if (retainedPath === DELTA_PATH) continue;
  const absolute = path.join(workspace, retainedPath);
  argv.push("--deny", `Write(${absolute})`, "--deny", `Edit(${absolute})`);
}

const child = spawn(REAL_GROK, argv, {
  cwd: workspace,
  env: gitEnv,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  process.stderr.write(`M3-B recovery could not launch Grok: ${error.message}\n`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
