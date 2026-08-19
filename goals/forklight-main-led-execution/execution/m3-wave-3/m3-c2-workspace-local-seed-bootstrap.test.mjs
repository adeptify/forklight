import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

const root = process.cwd();
const directory = path.join(root, "goals/forklight-main-led-execution/execution/m3-wave-3");
const wrapper = readFileSync(path.join(directory, "m3-c2-workspace-local-seed-bootstrap.mjs"), "utf8");
const seedPath = path.join(directory, "m3-c2-protected-partial.patch");
const seed = readFileSync(seedPath, "utf8");
const task = YAML.parse(readFileSync(path.join(directory, "03-m3-c2-workspace-local-seed-replacement.yaml"), "utf8"));
const oldRoot = "/Users/yijunwang/Library/Application Support/ForkLight/runs/bbec21f9-ae21-4bfd-9cc4-9476aea3f73a";
const expectedPaths = new Set([
  "src/core/statistics.ts",
  "src/core/model-routing.ts",
  "src/core/strategy-advice.ts",
  "src/daemon/coordinator.ts",
  "src/cli/routing-output.ts",
  "src/mcp/server.ts",
  "tests/statistics.test.ts",
  "tests/model-routing.test.ts",
  "tests/competition.test.ts",
  "tests/review-graph.test.ts",
  "tests/main-failure-attribution.test.ts",
  "tests/daemon.test.ts",
  "tests/daemon-cli.test.ts",
  "tests/mcp.test.ts",
]);

const seedPaths = [...seed.matchAll(
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

checkApply(path.join(oldRoot, "baseline"));
checkApply(path.join(oldRoot, "workspace"), ["--reverse"]);

assert.match(wrapper, /path\.join\(workspace, SEED_RELATIVE\)/);
assert.match(wrapper, /git", \["apply", "-p2"/);
assert.match(wrapper, /current-model-only native Goal invocation/);
assert.match(wrapper, /GIT_CONFIG_GLOBAL: "\/dev\/null"/);
assert.match(wrapper, /GIT_CONFIG_SYSTEM: "\/dev\/null"/);
assert.doesNotMatch(wrapper, /bbec21f9|Application Support\/ForkLight\/runs/);
assert.doesNotMatch(wrapper, /createHash|checksum|lock|lease|version handshake/);

assert.equal(task.runtime.name, "grok-build");
assert.equal(task.runtime.effort, "xhigh");
assert.match(task.runtime.executable, /m3-c2-workspace-local-seed-bootstrap\.mjs$/);
assert.equal(task.reviewRequirement.requiredJudges, 2);
assert.equal(task.advancedPolicy.baseMaxAttempts, 1);
assert.equal(task.advancedPolicy.maxExtraAttempts, 0);
assert.equal(task.advancedPolicy.maxWorkerValidationRepairs, 1);
assert.equal(task.advancedPolicy.maxMainCorrections, 1);
assert.equal(task.advancedPolicy.maxMainReverifications, 1);
assert.equal(task.advancedPolicy.maxAdaptationRounds, 0);
assert.equal(task.advancedPolicy.maxDurationMs, null);
assert.equal(task.advancedPolicy.observedTokenCeiling, null);
assert.equal(task.advancedPolicy.noProgressTimeoutMs, null);
assert.deepEqual(new Set(task.worker.focusPaths), expectedPaths);
assert.equal(task.acceptance.commands.at(-3), "npm run build");
assert.match(task.acceptance.commands.at(-2), /tests\/statistics\.test\.ts.+tests\/mcp\.test\.ts/);
assert.equal(task.acceptance.commands.at(-1), "git diff --check");

console.log("M3-C2 Workspace-local-seed bootstrap policy passed");
