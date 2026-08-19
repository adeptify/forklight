import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const input = JSON.parse(await readFile(
  path.join(here, "inputs", "hub-current-graduation-comprehension.json"),
  "utf8",
));

assert.equal(input.family, "hub-product-comprehension");
assert.equal(input.taskClass, "m4-current-hub-product-comprehension");
assert.equal(input.taskLabel, "M4-E current Hub product-comprehension pair");
assert.equal(input.directCodexProfileId, "codex-main-gpt-5.6-sol-xhigh-v1");
assert.equal(input.requiredProjection.evidenceMode, "current-graduation-read-only");
assert.equal(input.requiredProjection.hubMutationOccurred, false);
assert.equal(input.requiredProjection.m5Implemented, false);
assert.equal(input.evidence.requirements.length, 6);
assert.equal(new Set(input.evidence.requirements.map((item) => item.id)).size, 6);
assert.equal(input.evidence.historicalRouting.scope, "historical-only");
assert.equal(input.outputPath.endsWith("/hub-current-graduation-comprehension.json"), true);

const prepared = JSON.parse(execFileSync(process.execPath, [
  path.join(here, "prepare-current-hub-comprehension-pair.mjs"),
], { encoding: "utf8" }));
assert.equal(prepared.family, "hub-product-comprehension");
assert.equal(prepared.taskClass, "m4-current-hub-product-comprehension");
assert.equal(prepared.comparisonId, "cmp-m4e-hub-current-graduation-20260818");
assert.notEqual(prepared.directRoot, prepared.delegatedRoot);
assert.equal(path.dirname(prepared.directRoot), prepared.pairRoot);
assert.equal(path.dirname(prepared.delegatedRoot), prepared.pairRoot);
assert.equal(path.dirname(prepared.taskPath), prepared.pairRoot);

const task = JSON.parse(await readFile(prepared.taskPath, "utf8"));
assert.equal(task.taskClass, input.taskClass);
assert.equal(task.taskFamily, input.family);
assert.equal(task.workerProfileId, "grok-4-6-xhigh");
assert.equal(task.executionPreference, "auto");
assert.equal(task.reviewRequirement.requiredJudges, 2);
assert.equal(task.advancedPolicy.maxDurationMs, null);
assert.equal(task.advancedPolicy.observedTokenCeiling, null);
assert.equal(task.advancedPolicy.noProgressTimeoutMs, null);
assert.deepEqual(task.worker.focusPaths, [input.outputPath]);
assert.deepEqual(task.acceptance.commands, [input.acceptanceCommand, "git diff --check"]);
assert.equal(task.contract.outOfScope.some((item) => item.includes("Hub/UI")), true);

await rm(prepared.pairRoot, { recursive: true, force: true });
process.stdout.write("M4-E current Hub comprehension pair preflight passed\n");
