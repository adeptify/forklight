import assert from "node:assert/strict";
import { accessSync, constants, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const wrapper = readFileSync(path.join(directory, "m5-a1-accepted-candidate-bootstrap.mjs"), "utf8");
const seed = readFileSync(path.join(directory, "m5-a1-accepted-candidate.patch"), "utf8");
const task = readFileSync(path.join(directory, "05-m5-a1-final-wrapper-mode-delivery.yaml"), "utf8");

accessSync(path.join(directory, "m5-a1-accepted-candidate-bootstrap.mjs"), constants.X_OK);

const pathMatches = [...seed.matchAll(
  /^diff --git a\/(?:baseline|workspace)\/(.+) b\/workspace\/(.+)$/gm,
)];
assert.equal(pathMatches.length, 16);
assert.equal(new Set(pathMatches.map((match) => match[2])).size, 16);
assert.ok(pathMatches.every((match) => match[1] === match[2]));

assert.match(wrapper, /SEED_RELATIVE = "goals\/forklight-main-led-execution\/execution\/m5-wave-1\/m5-a1-accepted-candidate\.patch"/);
assert.match(wrapper, /gitApply\(workspace, seedPath, \["--check"\]\)/);
assert.match(wrapper, /gitApply\(workspace, seedPath, \[\]\)/);
assert.match(wrapper, /GROK_GOAL_USE_CURRENT_MODEL_ONLY/);
assert.match(wrapper, /GIT_CONFIG_GLOBAL: "\/dev\/null"/);
assert.doesNotMatch(wrapper, /Application Support\/ForkLight\/runs|createHash|sha256|checksum|lock|lease/);

assert.match(task, /name: M5-A1 final executable-wrapper accepted-Candidate delivery/);
assert.match(task, /m5-a1-accepted-candidate-bootstrap\.mjs/);
assert.match(task, /requiredJudges: 2/);
assert.match(task, /maxDurationMs: null/);
assert.match(task, /observedTokenCeiling: null/);
assert.match(task, /noProgressTimeoutMs: null/);
assert.match(task, /maxExtraAttempts: 0/);
assert.match(task, /tests\/cli-setup\.test\.ts/);
assert.match(task, /npm run build/);
assert.match(task, /git diff --check/);

console.log("M5-A1 accepted-Candidate delivery replacement bootstrap policy passed");
