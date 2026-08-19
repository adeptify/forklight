import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const wrapper = readFileSync(path.join(directory, "m5-b-legacy-goal-delivery-bootstrap.mjs"), "utf8");
const delta = readFileSync(path.join(directory, "m5-b-structural-mobile-delta.patch"), "utf8");

assert.match(wrapper, /process\.env\.GROK_WORKFLOWS !== "1"/);
assert.match(wrapper, /GROK_WORKFLOWS: "0"/);
assert.match(wrapper, /GROK_FOREGROUND_BLOCK_BUDGET_MS: FOREGROUND_BUDGET_MS/);
assert.match(wrapper, /process\.env\.GROK_FOREGROUND_BLOCK_BUDGET_MS !== FOREGROUND_BUDGET_MS/);
assert.match(wrapper, /GROK_GOAL_USE_CURRENT_MODEL_ONLY !== "1"/);
assert.match(wrapper, /gitApply\(workspace, seedPath, 2/);
assert.match(wrapper, /gitApply\(workspace, deltaPath, 1/);

const paths = [...delta.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]).sort();
assert.deepEqual(paths, [
  "src/hub/public/app.css",
  "src/hub/public/app.js",
  "src/hub/public/index.html",
  "tests/hub-responsive-layout.test.ts",
]);

console.log("M5-B legacy Goal delivery bootstrap policy passed");
