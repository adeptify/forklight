#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const EXPECTED_DIGEST = "48a73c6b6db1071fd62f2dfffa3799df81805cdc1e6d4a46cb163bb9ebdafcda";
const SEED = "goals/forklight-main-led-execution/execution/m2-resolved-terminal-storage-recovery/172d6a80-bdd7-487a-9e97-b938a67f10c5.patch";
const ALLOWED = new Set(["src/core/storage-lifecycle.ts", "tests/storage-lifecycle.test.ts"]);
const NATIVE_BOOTSTRAP = "goals/forklight-main-led-execution/execution/m2-resolved-terminal-storage-native-plan-recovery/native-plan-only-bootstrap.mjs";
const cwd = process.cwd();
const seedPath = path.join(cwd, SEED);
const nativeBootstrapPath = path.join(cwd, NATIVE_BOOTSTRAP);
const runtimeEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function git(args) {
  return spawnSync("/usr/bin/git", args, { cwd, encoding: "utf8", env: runtimeEnv });
}

function fail(message, detail = "") {
  process.stderr.write(`${message}${detail.trim().length > 0 ? `: ${detail.trim()}` : ""}\n`);
  process.exit(2);
}

let seedBytes;
try {
  seedBytes = readFileSync(seedPath);
} catch (error) {
  fail("exact Candidate seed is unreadable", error instanceof Error ? error.message : String(error));
}

const digest = createHash("sha256").update(seedBytes).digest("hex");
if (digest !== EXPECTED_DIGEST) fail("exact Candidate seed digest mismatch");

const patchPaths = [...seedBytes.toString("utf8").matchAll(
  /^diff --git a\/baseline\/(.+) b\/workspace\/(.+)$/gm,
)].map((match) => {
  const baselinePath = match[1];
  const workspacePath = match[2];
  if (baselinePath !== workspacePath) fail("exact Candidate patch path pair mismatch");
  return workspacePath;
});
const uniquePatchPaths = new Set(patchPaths);
if (
  patchPaths.length !== ALLOWED.size
  || uniquePatchPaths.size !== ALLOWED.size
  || patchPaths.some((value) => !ALLOWED.has(value))
) fail("exact Candidate allowed-path set mismatch");

const check = git(["apply", "-p2", "--check", seedPath]);
if (check.status === 0) {
  const applied = git(["apply", "-p2", seedPath]);
  if (applied.status !== 0) fail("exact Candidate seed apply failed", applied.stderr);
} else {
  const alreadyApplied = git(["apply", "-p2", "--reverse", "--check", seedPath]);
  if (alreadyApplied.status !== 0) {
    fail("Workspace is neither clean-applicable nor exactly applied", check.stderr);
  }
}

const reverse = git(["apply", "-p2", "--reverse", "--check", seedPath]);
if (reverse.status !== 0) fail("exact Candidate reverse-apply proof failed", reverse.stderr);

const child = spawn(nativeBootstrapPath, process.argv.slice(2), {
  cwd,
  env: runtimeEnv,
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => fail("Grok native-plan bootstrap failed to launch", error.message));
child.on("exit", (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
