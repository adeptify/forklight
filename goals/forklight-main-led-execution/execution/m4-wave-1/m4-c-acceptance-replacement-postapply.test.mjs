import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const directory = path.join(root, "goals/forklight-main-led-execution/execution/m4-wave-1");
const basePath = path.join(directory, "m4-c-retained-candidate.patch");
const deltaPath = path.join(directory, "m4-c-final-test-delta.patch");
const markerPath = path.join(root, ".forklight/m4-c-acceptance-replacement.json");
const testPath = "tests/main-token-value-report.test.ts";
const expectedPaths = new Set([
  "src/cli.ts", "src/core/main-token-value-report.ts", "src/daemon/coordinator.ts",
  "src/daemon/protocol.ts", "src/daemon/server.ts", "src/mcp/server.ts",
  "tests/daemon-cli.test.ts", "tests/daemon.test.ts", testPath, "tests/mcp.test.ts",
]);
const baseDigest = "92c1e363639903d243cc3a1939d50d69ee2f7198e50b0d741286a07c6d836312";
const deltaDigest = "1c997a355684d4b17b96d9753abe72ceca9b15080434889097e24c60f724d6e8";

assert.equal(createHash("sha256").update(readFileSync(basePath)).digest("hex"), baseDigest);
assert.equal(createHash("sha256").update(readFileSync(deltaPath)).digest("hex"), deltaDigest);
const marker = JSON.parse(readFileSync(markerPath, "utf8"));
assert.equal(marker.base, baseDigest);
assert.equal(marker.delta, deltaDigest);
assert.deepEqual(new Set(marker.paths), expectedPaths);

const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
function git(arguments_) {
  return spawnSync("/usr/bin/git", arguments_, { cwd: root, encoding: "utf8", env: gitEnv });
}
function expectPass(result) {
  assert.equal(result.status, 0, result.stderr);
}

const changed = git(["diff", "--name-only", "--"]);
expectPass(changed);
const untracked = git(["ls-files", "--others", "--exclude-standard"]);
expectPass(untracked);
const candidatePaths = new Set(
  `${changed.stdout}\n${untracked.stdout}`.trim().split("\n")
    .filter((candidate) => candidate.length > 0 && candidate !== ".forklight/m4-c-acceptance-replacement.json"),
);
assert.deepEqual(candidatePaths, expectedPaths);
expectPass(git(["apply", "-p1", "--reverse", "--check", deltaPath]));
expectPass(git(["apply", "-p2", "--reverse", "--check", `--exclude=${testPath}`, basePath]));

console.log("M4-C exact Candidate is fully materialized in post-application state");
