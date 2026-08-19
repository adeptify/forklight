import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const directory = path.join(root, "goals/forklight-main-led-execution/execution/m4-wave-1");
const basePath = path.join(directory, "m4-c-retained-candidate.patch");
const deltaPath = path.join(directory, "m4-c-final-test-delta.patch");
const testPath = "tests/main-token-value-report.test.ts";
const expectedPaths = new Set([
  "src/cli.ts", "src/core/main-token-value-report.ts", "src/daemon/coordinator.ts",
  "src/daemon/protocol.ts", "src/daemon/server.ts", "src/mcp/server.ts",
  "tests/daemon-cli.test.ts", "tests/daemon.test.ts", testPath, "tests/mcp.test.ts",
]);
const baseDigest = "92c1e363639903d243cc3a1939d50d69ee2f7198e50b0d741286a07c6d836312";
const deltaDigest = "1c997a355684d4b17b96d9753abe72ceca9b15080434889097e24c60f724d6e8";

const base = readFileSync(basePath);
const delta = readFileSync(deltaPath);
assert.equal(createHash("sha256").update(base).digest("hex"), baseDigest);
assert.equal(createHash("sha256").update(delta).digest("hex"), deltaDigest);
const basePaths = [...base.toString("utf8").matchAll(
  /^diff --git a\/(?:baseline|workspace)\/(.+) b\/workspace\/(.+)$/gm,
)].map((match) => {
  assert.equal(match[1], match[2]);
  return match[2];
});
assert.equal(basePaths.length, expectedPaths.size);
assert.deepEqual(new Set(basePaths), expectedPaths);
const deltaText = delta.toString("utf8");
assert.ok(deltaText.startsWith(`--- a/${testPath}\n+++ b/${testPath}\n`));
assert.equal((deltaText.match(/^--- /gm) ?? []).length, 1);
assert.equal((deltaText.match(/^\+\+\+ /gm) ?? []).length, 1);

const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};
function reverseCheck(patchPath, strip, extra = []) {
  return spawnSync(
    "/usr/bin/git",
    ["apply", `-p${strip}`, "--reverse", "--check", ...extra, patchPath],
    { cwd: root, encoding: "utf8", env: gitEnv },
  );
}
function expectPass(result) {
  assert.equal(result.status, 0, result.stderr);
}

expectPass(reverseCheck(deltaPath, 1));
expectPass(reverseCheck(basePath, 2, [`--exclude=${testPath}`]));

console.log("M4-C exact Candidate post-state passed without Task-local or Git metadata");
