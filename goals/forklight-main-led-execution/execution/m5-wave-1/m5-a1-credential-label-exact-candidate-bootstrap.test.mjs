import assert from "node:assert/strict";
import { accessSync, constants, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const wrapperName = "m5-a1-credential-label-exact-candidate-bootstrap.mjs";
const wrapper = readFileSync(path.join(directory, wrapperName), "utf8");
const seed = readFileSync(path.join(directory, "m5-a1-credential-label-exact-candidate.patch"), "utf8");
const task = readFileSync(path.join(directory, "08-m5-a1-credential-label-final-exact-candidate-recovery.yaml"), "utf8");

accessSync(path.join(directory, wrapperName), constants.X_OK);

const pathMatches = [...seed.matchAll(
  /^diff --git a\/(?:baseline|workspace)\/(.+) b\/workspace\/(.+)$/gm,
)];
assert.equal(pathMatches.length, 3);
assert.deepEqual(
  new Set(pathMatches.map((match) => match[2])),
  new Set(["src/core/review-graph.ts", "src/core/review-result-repair.ts", "tests/review-graph.test.ts"]),
);
assert.ok(pathMatches.every((match) => match[1] === match[2]));

assert.match(wrapper, /m5-a1-credential-label-exact-candidate\.patch/);
assert.match(wrapper, /gitApply\(workspace, seedPath, \["--check"\]\)/);
assert.match(wrapper, /GROK_GOAL_USE_CURRENT_MODEL_ONLY/);
assert.match(wrapper, /GIT_CONFIG_GLOBAL: "\/dev\/null"/);
assert.doesNotMatch(wrapper, /Application Support\/ForkLight\/runs|createHash|sha256|checksum|lock|lease/);

assert.match(task, /name: M5-A1Q final exact-Candidate unchanged-summary recovery/);
assert.match(task, /m5-a1-credential-label-exact-candidate-bootstrap\.mjs/);
assert.match(task, /requiredJudges: 2/);
assert.match(task, /maxDurationMs: null/);
assert.match(task, /observedTokenCeiling: null/);
assert.match(task, /noProgressTimeoutMs: null/);
assert.match(task, /maxExtraAttempts: 0/);
assert.match(task, /maxMainCorrections: 0/);
assert.match(task, /maxWorkerValidationRepairs: 0/);
assert.match(task, /summary actually differs/);
assert.match(task, /tests\/review-graph\.test\.ts/);
assert.match(task, /npm run build/);
assert.match(task, /git diff --check/);

console.log("M5-A1Q final exact-Candidate recovery bootstrap policy passed");
