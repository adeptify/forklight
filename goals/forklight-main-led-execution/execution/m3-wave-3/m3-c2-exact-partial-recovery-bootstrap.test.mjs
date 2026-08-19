import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import YAML from "yaml";

const root = process.cwd();
const directory = path.join(root, "goals/forklight-main-led-execution/execution/m3-wave-3");
const wrapper = readFileSync(path.join(directory, "m3-c2-exact-partial-recovery-bootstrap.mjs"), "utf8");
const task = YAML.parse(readFileSync(path.join(directory, "02-m3-c2-exact-partial-recovery.yaml"), "utf8"));
const seedTaskId = "bbec21f9-ae21-4bfd-9cc4-9476aea3f73a";
const seedRoot = `/Users/yijunwang/Library/Application Support/ForkLight/runs/${seedTaskId}`;
const seedBaseline = path.join(seedRoot, "baseline");
const seedWorkspace = path.join(seedRoot, "workspace");
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

function collectFiles(treeRoot, relative, files) {
  const absolute = path.join(treeRoot, relative);
  if (!existsSync(absolute)) return;
  const stat = statSync(absolute);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(absolute).sort()) {
      collectFiles(treeRoot, path.join(relative, entry), files);
    }
    return;
  }
  files.set(relative.split(path.sep).join("/"), readFileSync(absolute));
}

function changedProductTestPaths(left, right) {
  const leftFiles = new Map();
  const rightFiles = new Map();
  for (const scannedRoot of ["src", "tests"]) {
    collectFiles(left, scannedRoot, leftFiles);
    collectFiles(right, scannedRoot, rightFiles);
  }
  return [...new Set([...leftFiles.keys(), ...rightFiles.keys()])]
    .filter((candidate) => {
      const leftValue = leftFiles.get(candidate);
      const rightValue = rightFiles.get(candidate);
      return !leftValue || !rightValue || !leftValue.equals(rightValue);
    })
    .sort();
}

const seedDelta = changedProductTestPaths(seedBaseline, seedWorkspace);
assert.deepEqual(new Set(seedDelta), expectedPaths, "protected partial must name exactly the authorized paths");

const currentDelta = changedProductTestPaths(seedBaseline, root);
assert.ok(
  currentDelta.length === 0 || (
    currentDelta.length === expectedPaths.size
    && currentDelta.every((candidate) => expectedPaths.has(candidate))
  ),
  `current Workspace must be either the exact source base or an exact-path recovery; got ${currentDelta.join(", ")}`,
);

assert.match(wrapper, new RegExp(seedTaskId));
assert.match(wrapper, /GROK_GOAL_USE_CURRENT_MODEL_ONLY !== "1"/);
assert.match(wrapper, /currentDelta\.length !== 0/);
assert.match(wrapper, /materializedDelta/);
assert.doesNotMatch(wrapper, /createHash|checksum|lock|lease|version handshake/);

assert.equal(task.runtime.name, "grok-build");
assert.equal(task.runtime.effort, "xhigh");
assert.match(task.runtime.executable, /m3-c2-exact-partial-recovery-bootstrap\.mjs$/);
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

console.log("M3-C2 exact-partial recovery bootstrap policy passed");
