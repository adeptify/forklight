import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const wrapper = readFileSync(path.join(directory, "m5-a1-protected-partial-bootstrap.mjs"), "utf8");
const task = readFileSync(path.join(directory, "02-m5-a1-protected-partial-recovery.yaml"), "utf8");
const spec = readFileSync(
  path.resolve(directory, "../../../../specs/m5-product-graduation/work-items/cli-api-setup/spec.md"),
  "utf8",
);

assert.match(wrapper, /245a5dec-eb63-4c6b-9971-2e503c55109d/);
assert.match(wrapper, /GROK_GOAL_USE_CURRENT_MODEL_ONLY/);
assert.match(wrapper, /GIT_CONFIG_GLOBAL: "\/dev\/null"/);
assert.match(wrapper, /sameBytes/);
assert.doesNotMatch(wrapper, /createHash|sha256|checksum|lock|lease/);
assert.match(wrapper, /EXPECTED_PATHS = \[/);
assert.equal((wrapper.match(/^  "[^\n]+",$/gm) ?? []).length, 16);

assert.match(task, /name: M5-A1 exact protected-partial recovery/);
assert.match(task, /workerProfileId: grok-4-6-xhigh/);
assert.match(task, /executionPreference: auto/);
assert.match(task, /m5-a1-protected-partial-bootstrap\.mjs/);
assert.match(task, /requiredJudges: 2/);
assert.match(task, /maxDurationMs: null/);
assert.match(task, /observedTokenCeiling: null/);
assert.match(task, /noProgressTimeoutMs: null/);
assert.match(task, /maxExtraAttempts: 0/);
assert.match(task, /tests\/cli-setup\.test\.ts/);
assert.match(task, /npm run build/);
assert.match(task, /git diff --check/);

assert.match(spec, /Accepted recovery after Attempt 1 connectivity stop/);
assert.match(spec, /117\/121 focused behavior tests pass/);

console.log("M5-A1 exact partial recovery bootstrap policy passed");
