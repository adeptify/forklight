import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const wrapper = readFileSync(path.join(directory, "m5-a1-workspace-local-seed-bootstrap.mjs"), "utf8");
const seed = readFileSync(path.join(directory, "m5-a1-protected-partial.patch"), "utf8");
const task = readFileSync(path.join(directory, "03-m5-a1-workspace-local-seed-recovery.yaml"), "utf8");

const pathMatches = [...seed.matchAll(
  /^diff --git a\/(?:baseline|workspace)\/(.+) b\/workspace\/(.+)$/gm,
)];
assert.equal(pathMatches.length, 16);
assert.equal(new Set(pathMatches.map((match) => match[2])).size, 16);
assert.ok(pathMatches.every((match) => match[1] === match[2]));

assert.match(wrapper, /SEED_RELATIVE = "goals\/forklight-main-led-execution\/execution\/m5-wave-1\/m5-a1-protected-partial\.patch"/);
assert.match(wrapper, /gitApply\(workspace, seedPath, \["--check"\]\)/);
assert.match(wrapper, /gitApply\(workspace, seedPath, \[\]\)/);
assert.match(wrapper, /GROK_GOAL_USE_CURRENT_MODEL_ONLY/);
assert.match(wrapper, /GIT_CONFIG_GLOBAL: "\/dev\/null"/);
assert.doesNotMatch(wrapper, /Application Support\/ForkLight\/runs|createHash|sha256|checksum|lock|lease/);

assert.match(task, /name: M5-A1 Workspace-local exact protected-partial recovery/);
assert.match(task, /m5-a1-workspace-local-seed-bootstrap\.mjs/);
assert.match(task, /requiredJudges: 2/);
assert.match(task, /maxDurationMs: null/);
assert.match(task, /observedTokenCeiling: null/);
assert.match(task, /noProgressTimeoutMs: null/);
assert.match(task, /maxExtraAttempts: 0/);
assert.match(task, /tests\/cli-setup\.test\.ts/);
assert.match(task, /npm run build/);
assert.match(task, /git diff --check/);

console.log("M5-A1 Workspace-local exact partial recovery bootstrap policy passed");
