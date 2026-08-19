import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const directory = path.join(root, "goals/forklight-main-led-execution/execution/m3-wave-2");
const wrapper = readFileSync(path.join(directory, "m3-b-exact-candidate-recovery-bootstrap.mjs"), "utf8");
const task = readFileSync(path.join(directory, "02-m3-b-exact-candidate-recovery.yaml"), "utf8");
const seed = readFileSync(path.join(directory, "23b7f864-6f6f-44ac-9726-6b0c83bbfe50.patch"));
const expectedDigest = "7fb1fdcf9f156964ac4444c1611e91c77c6b958538eaf34088b9c8780bf30a3a";
const expectedPaths = new Set([
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

assert.equal(createHash("sha256").update(seed).digest("hex"), expectedDigest);
const paths = [...seed.toString("utf8").matchAll(
  /^diff --git a\/(?:baseline|workspace)\/(.+) b\/workspace\/(.+)$/gm,
)].map((match) => {
  assert.equal(match[1], match[2], "seed must not rename a Candidate path");
  return match[2];
});
assert.equal(paths.length, expectedPaths.size);
assert.deepEqual(new Set(paths), expectedPaths);

assert.match(wrapper, new RegExp(expectedDigest));
assert.match(wrapper, /git", \["apply", "-p2"/);
assert.match(wrapper, /--exclude=\$\{DELTA_PATH\}/);
assert.match(wrapper, /retainedPath === DELTA_PATH/);
assert.match(wrapper, /Write\(\$\{absolute\}\)/);
assert.match(wrapper, /Edit\(\$\{absolute\}\)/);
assert.match(wrapper, /prompt\.startsWith\("\/goal "\)/);
assert.match(wrapper, /GROK_GOAL_USE_CURRENT_MODEL_ONLY !== "1"/);
assert.match(wrapper, /GIT_CONFIG_GLOBAL: "\/dev\/null"/);
assert.match(wrapper, /GIT_CONFIG_SYSTEM: "\/dev\/null"/);
assert.doesNotMatch(wrapper, /GROK_GOAL_USE_CURRENT_MODEL_ONLY:/);
assert.doesNotMatch(wrapper, /argv\[promptIndex/);

assert.match(task, /m3-b-exact-candidate-recovery-bootstrap\.mjs/);
assert.match(task, /requiredJudges: 2/);
assert.match(task, /baseMaxAttempts: 1/);
for (const field of [
  "maxExtraAttempts",
  "maxMainCorrections",
  "maxMainReverifications",
  "maxWorkerValidationRepairs",
  "maxAdaptationRounds",
]) assert.match(task, new RegExp(`${field}: 0`));
assert.doesNotMatch(task, /maxDurationMs: [1-9]/);
assert.doesNotMatch(task, /observedTokenCeiling: [1-9]/);
assert.doesNotMatch(task, /noProgressTimeoutMs: [1-9]/);
assert.match(task, /Relative to the frozen Candidate, edit only tests\/mcp\.test\.ts/);

console.log("M3-B exact-Candidate recovery bootstrap policy passed");
