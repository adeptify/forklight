import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

const root = process.cwd();
const directory = path.join(root, "goals/forklight-main-led-execution/execution/m4-wave-1");
const basePath = path.join(directory, "m4-c-retained-candidate.patch");
const deltaPath = path.join(directory, "m4-c-final-test-delta.patch");
const wrapper = readFileSync(path.join(directory, "m4-c-acceptance-replacement-bootstrap.mjs"), "utf8");
const task = YAML.parse(readFileSync(path.join(directory, "05-m4-c-acceptance-contract-replacement.yaml"), "utf8"));
const retainedWorkspace = "/Users/yijunwang/Library/Application Support/ForkLight/runs/89e60adc-d9ca-4560-9940-b423698c51f0/workspace";
const finalWorkspace = "/Users/yijunwang/Library/Application Support/ForkLight/runs/812df915-788c-463c-8ee0-208d71ff9d58/workspace";
const testPath = "tests/main-token-value-report.test.ts";
const expectedPaths = new Set([
  "src/cli.ts", "src/core/main-token-value-report.ts", "src/daemon/coordinator.ts",
  "src/daemon/protocol.ts", "src/daemon/server.ts", "src/mcp/server.ts",
  "tests/daemon-cli.test.ts", "tests/daemon.test.ts", testPath, "tests/mcp.test.ts",
]);

const base = readFileSync(basePath);
const delta = readFileSync(deltaPath);
assert.equal(createHash("sha256").update(base).digest("hex"), "92c1e363639903d243cc3a1939d50d69ee2f7198e50b0d741286a07c6d836312");
assert.equal(createHash("sha256").update(delta).digest("hex"), "1c997a355684d4b17b96d9753abe72ceca9b15080434889097e24c60f724d6e8");
const basePaths = [...base.toString("utf8").matchAll(
  /^diff --git a\/(?:baseline|workspace)\/(.+) b\/workspace\/(.+)$/gm,
)].map((match) => {
  assert.equal(match[1], match[2]);
  return match[2];
});
assert.equal(basePaths.length, expectedPaths.size);
assert.deepEqual(new Set(basePaths), expectedPaths);
assert.match(delta.toString("utf8"), new RegExp(`^--- a/${testPath}\\n\\+\\+\\+ b/${testPath}\\n`));

function check(cwd, patch, strip, extra = []) {
  const result = spawnSync("/usr/bin/git", ["apply", `-p${strip}`, ...extra, "--check", patch], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  assert.equal(result.status, 0, result.stderr);
}

check(root, basePath, 2);
check(retainedWorkspace, basePath, 2, ["--reverse"]);
check(retainedWorkspace, deltaPath, 1);
check(finalWorkspace, deltaPath, 1, ["--reverse"]);
check(finalWorkspace, basePath, 2, ["--reverse", `--exclude=${testPath}`]);

assert.match(wrapper, /path\.join\(workspace, BASE_RELATIVE\)/);
assert.match(wrapper, /path\.join\(workspace, DELTA_RELATIVE\)/);
assert.match(wrapper, /GROK_GOAL_USE_CURRENT_MODEL_ONLY !== "1"/);
assert.match(wrapper, /GIT_CONFIG_GLOBAL: "\/dev\/null"/);
assert.match(wrapper, /GIT_CONFIG_SYSTEM: "\/dev\/null"/);
assert.doesNotMatch(wrapper, /89e60adc|812df915|Application Support\/ForkLight\/runs/);
assert.doesNotMatch(wrapper, /lock|lease|version handshake/);

assert.equal(task.runtime.name, "grok-build");
assert.equal(task.runtime.effort, "xhigh");
assert.equal(task.worker.allowEdits, false);
assert.deepEqual(new Set(task.worker.focusPaths), expectedPaths);
assert.equal(task.reviewRequirement.requiredJudges, 2);
assert.equal(task.advancedPolicy.baseMaxAttempts, 1);
assert.equal(task.advancedPolicy.maxExtraAttempts, 0);
assert.equal(task.advancedPolicy.maxWorkerValidationRepairs, 0);
assert.equal(task.advancedPolicy.maxMainCorrections, 0);
assert.equal(task.advancedPolicy.maxMainReverifications, 0);
assert.equal(task.advancedPolicy.maxAdaptationRounds, 0);
assert.equal(task.advancedPolicy.maxDurationMs, null);
assert.equal(task.advancedPolicy.observedTokenCeiling, null);
assert.equal(task.advancedPolicy.noProgressTimeoutMs, null);
assert.match(task.acceptance.commands[0], /m4-c-acceptance-replacement-postapply\.test\.mjs$/);
assert.equal(task.acceptance.commands[1], "npm run build");
assert.match(task.acceptance.commands[2], /tests\/main-token-usage\.test\.ts.+tests\/mcp\.test\.ts/);
assert.equal(task.acceptance.commands[3], "git diff --check");

console.log("M4-C acceptance-contract-only replacement policy passed");
