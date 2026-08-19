import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

const root = process.cwd();
const directory = path.join(root, "goals/forklight-main-led-execution/execution/m4-e");
const wrapper = readFileSync(path.join(directory, "m4-e-workspace-local-seed-bootstrap.mjs"), "utf8");
const seedPath = path.join(directory, "retained-candidate.diff");
const seed = readFileSync(seedPath, "utf8");
const mode = process.argv[2];
assert.ok(mode === "--source" || mode === "--candidate", "use --source or --candidate");
const task = YAML.parse(readFileSync(path.join(directory, "03-acceptance-contract-recovery.yaml"), "utf8"));
const expectedPaths = new Set([
  "src/core/main-delivery.ts",
  "src/core/types.ts",
  "src/daemon/coordinator.ts",
  "src/daemon/protocol.ts",
  "src/daemon/server.ts",
  "src/daemon/client.ts",
  "src/cli.ts",
  "src/cli/supervision.ts",
  "src/cli/exchange-receipts.ts",
  "src/mcp/server.ts",
  "src/mcp/exchange-receipts.ts",
  "tests/main-delivery.test.ts",
  "tests/cli-supervision.test.ts",
  "tests/cli-exchange-receipts.test.ts",
  "tests/daemon.test.ts",
  "tests/daemon-cli.test.ts",
  "tests/mcp.test.ts",
  "README.md",
  "docs/operations.md",
]);

const seedPaths = [...seed.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)].map((match) => {
  assert.equal(match[1], match[2], "seed must not rename an authorized path");
  return match[1];
});
assert.equal(seedPaths.length, expectedPaths.size);
assert.deepEqual(new Set(seedPaths), expectedPaths);

const applyArgs = mode === "--source"
  ? ["apply", "-p1", "--check", seedPath]
  : ["apply", "-p1", "--reverse", "--check", seedPath];
const sourceCheck = spawnSync("/usr/bin/git", applyArgs, {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
});
assert.equal(sourceCheck.status, 0, sourceCheck.stderr);

assert.match(wrapper, /path\.join\(workspace, SEED_RELATIVE\)/);
assert.match(wrapper, /git", \["apply", "-p1"/);
assert.match(wrapper, /current-model-only native Goal invocation/);
assert.match(wrapper, /GIT_CONFIG_GLOBAL: "\/dev\/null"/);
assert.match(wrapper, /GIT_CONFIG_SYSTEM: "\/dev\/null"/);
assert.doesNotMatch(wrapper, /6928dd28|Application Support\/ForkLight\/runs/);
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
assert.deepEqual(new Set(task.worker.focusPaths), expectedPaths);
assert.equal(task.acceptance.commands[0], "node goals/forklight-main-led-execution/execution/m4-e/m4-e-workspace-local-seed-bootstrap.test.mjs --candidate");
assert.equal(task.acceptance.commands[1], "npm run build");
assert.match(task.acceptance.commands[2], /tests\/main-delivery\.test\.ts.+tests\/mcp\.test\.ts/);
assert.equal(task.acceptance.commands[3], "node goals/forklight-main-led-execution/execution/m4-e/retained-candidate.test.mjs --candidate");
assert.equal(task.acceptance.commands[4], "git diff --check");

console.log(`M4-E Workspace-local-seed bootstrap policy passed (${mode.slice(2)})`);
