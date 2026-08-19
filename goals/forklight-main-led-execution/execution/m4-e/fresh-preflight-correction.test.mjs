#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

const root = process.cwd();
const directory = path.join(root, "goals/forklight-main-led-execution/execution/m4-e");
const seedPath = path.join(directory, "retained-candidate.diff");
const seed = readFileSync(seedPath, "utf8");
const wrapper = readFileSync(path.join(directory, "m4-e-workspace-local-seed-bootstrap.mjs"), "utf8");
const task = YAML.parse(readFileSync(path.join(directory, "04-fresh-preflight-correction.yaml"), "utf8"));
const mode = process.argv[2];
assert.ok(mode === "--source" || mode === "--candidate", "use --source or --candidate");

const editablePaths = new Set([
  "src/core/main-delivery.ts",
  "tests/main-delivery.test.ts",
]);
const expectedPaths = [
  "src/core/main-delivery.ts", "src/core/types.ts", "src/daemon/coordinator.ts",
  "src/daemon/protocol.ts", "src/daemon/server.ts", "src/daemon/client.ts", "src/cli.ts",
  "src/cli/supervision.ts", "src/cli/exchange-receipts.ts", "src/mcp/server.ts",
  "src/mcp/exchange-receipts.ts", "tests/main-delivery.test.ts", "tests/cli-supervision.test.ts",
  "tests/cli-exchange-receipts.test.ts", "tests/daemon.test.ts", "tests/daemon-cli.test.ts",
  "tests/mcp.test.ts", "README.md", "docs/operations.md",
];
const frozenPaths = expectedPaths.filter((candidate) => !editablePaths.has(candidate));
const seedPaths = [...seed.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)].map((match) => {
  assert.equal(match[1], match[2], "retained seed must not rename a path");
  return match[1];
});
assert.deepEqual(seedPaths, expectedPaths);

const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};
function applyCheck(args) {
  return spawnSync("/usr/bin/git", ["apply", "-p1", "--check", ...args, seedPath], {
    cwd: root,
    encoding: "utf8",
    env: gitEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

if (mode === "--source") {
  const forward = applyCheck([]);
  assert.equal(forward.status, 0, forward.stderr);
} else {
  for (const frozenPath of frozenPaths) {
    const reverse = applyCheck(["--reverse", `--include=${frozenPath}`]);
    assert.equal(reverse.status, 0, `${frozenPath}: ${reverse.stderr}`);
  }
}

assert.match(wrapper, /path\.join\(workspace, SEED_RELATIVE\)/);
assert.doesNotMatch(wrapper, /Application Support\/ForkLight\/runs/);
assert.doesNotMatch(wrapper, /createHash|checksum|lock|lease|version handshake/);

assert.equal(task.runtime.name, "grok-build");
assert.equal(task.runtime.effort, "xhigh");
assert.match(task.runtime.executable, /m4-e-workspace-local-seed-bootstrap\.mjs$/);
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
assert.deepEqual(task.contract.editablePaths, [...editablePaths]);
assert.deepEqual(task.worker.focusPaths, expectedPaths);
assert.match(task.contract.outcome, /fresh post-accept preflight/);
assert.match(task.contract.outcome, /exact re-entry/);
assert.equal(
  task.acceptance.commands[0],
  "node goals/forklight-main-led-execution/execution/m4-e/fresh-preflight-correction.test.mjs --candidate",
);
assert.equal(task.acceptance.commands.at(-1), "git diff --check");

console.log(
  mode === "--source"
    ? "M4-E fresh-preflight correction source policy passed"
    : `M4-E fresh-preflight correction retained-path policy passed (${frozenPaths.length} frozen paths)`,
);
