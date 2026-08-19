import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

const root = process.cwd();
const directory = path.join(root, "goals/forklight-main-led-execution/execution/m4-wave-1");
const wrapper = readFileSync(path.join(directory, "m4-c-workspace-local-recovery-bootstrap.mjs"), "utf8");
const seedPath = path.join(directory, "m4-c-retained-candidate.patch");
const seed = readFileSync(seedPath);
const task = YAML.parse(readFileSync(path.join(directory, "04-m4-c-exact-candidate-test-recovery.yaml"), "utf8"));
const retainedWorkspace = "/Users/yijunwang/Library/Application Support/ForkLight/runs/89e60adc-d9ca-4560-9940-b423698c51f0/workspace";
const expectedDigest = "92c1e363639903d243cc3a1939d50d69ee2f7198e50b0d741286a07c6d836312";
const expectedPaths = new Set([
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

assert.equal(createHash("sha256").update(seed).digest("hex"), expectedDigest);
const seedPaths = [...seed.toString("utf8").matchAll(
  /^diff --git a\/(?:baseline|workspace)\/(.+) b\/workspace\/(.+)$/gm,
)].map((match) => {
  assert.equal(match[1], match[2], "seed must not rename an authorized path");
  return match[2];
});
assert.equal(seedPaths.length, expectedPaths.size);
assert.deepEqual(new Set(seedPaths), expectedPaths);

function checkApply(cwd, extra = []) {
  const result = spawnSync("/usr/bin/git", ["apply", "-p2", ...extra, "--check", seedPath], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  assert.equal(result.status, 0, result.stderr);
}

checkApply(root);
checkApply(retainedWorkspace, ["--reverse"]);

assert.match(wrapper, /path\.join\(workspace, SEED_RELATIVE\)/);
assert.match(wrapper, /createHash\("sha256"\)/);
assert.match(wrapper, /git", \["apply", "-p2"/);
assert.match(wrapper, /GROK_GOAL_USE_CURRENT_MODEL_ONLY !== "1"/);
assert.match(wrapper, /GIT_CONFIG_GLOBAL: "\/dev\/null"/);
assert.match(wrapper, /GIT_CONFIG_SYSTEM: "\/dev\/null"/);
assert.doesNotMatch(wrapper, /89e60adc|Application Support\/ForkLight\/runs/);
assert.doesNotMatch(wrapper, /lock|lease|version handshake/);

assert.equal(task.runtime.name, "grok-build");
assert.equal(task.runtime.effort, "xhigh");
assert.match(task.runtime.executable, /m4-c-workspace-local-recovery-bootstrap\.mjs$/);
assert.equal(task.reviewRequirement.requiredJudges, 2);
assert.equal(task.advancedPolicy.baseMaxAttempts, 1);
assert.equal(task.advancedPolicy.maxExtraAttempts, 0);
assert.equal(task.advancedPolicy.maxWorkerValidationRepairs, 0);
assert.equal(task.advancedPolicy.maxMainCorrections, 0);
assert.equal(task.advancedPolicy.maxMainReverifications, 1);
assert.equal(task.advancedPolicy.maxAdaptationRounds, 0);
assert.equal(task.advancedPolicy.maxDurationMs, null);
assert.equal(task.advancedPolicy.observedTokenCeiling, null);
assert.equal(task.advancedPolicy.noProgressTimeoutMs, null);
assert.deepEqual(new Set(task.worker.focusPaths), expectedPaths);
assert.equal(task.acceptance.commands.at(-3), "npm run build");
assert.match(task.acceptance.commands.at(-2), /tests\/main-token-usage\.test\.ts.+tests\/mcp\.test\.ts/);
assert.equal(task.acceptance.commands.at(-1), "git diff --check");

console.log("M4-C Workspace-local exact-Candidate recovery bootstrap policy passed");
