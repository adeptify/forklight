import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const input = JSON.parse(await readFile(
  path.join(here, "inputs", "forklight-storage-lifecycle-host-staged-checkpoint.json"),
  "utf8",
));

assert.equal(input.family, "forklight-storage-lifecycle");
assert.equal(input.taskClass, "m4-host-staged-storage-lifecycle-checkpoint");
assert.equal(input.taskLabel, "M4-E host-staged storage-lifecycle checkpoint pair");
assert.equal(input.directCodexProfileId, "codex-main-gpt-5.6-sol-xhigh-v1");
assert.deepEqual(input.requiredProjection.protectedTaskIds, [
  "2d774265-344f-43ea-8f69-79e2624765d3",
]);
assert.deepEqual(input.requiredProjection.reclaimableTaskIds, [
  "6676be3a-24b4-4bbc-a8c0-7f2a3079e848",
  "b664e69e-ee30-4268-8de3-1f7c07fb808d",
]);
assert.equal(input.requiredProjection.reclaimExecuted, false);
assert.equal(input.evidence.storeIntegrity.quickCheck, "ok");
assert.equal(input.evidence.storeIntegrity.foreignKeyViolationCount, 0);
assert.equal(input.evidence.items.every((item) => item.unknownBytes === 0), true);
assert.equal(input.evidence.items.every((item) => item.processCount === 0), true);
assert.equal(
  input.outputPath.endsWith("/forklight-storage-lifecycle-host-staged-checkpoint.json"),
  true,
);

const prepared = JSON.parse(execFileSync(process.execPath, [
  path.join(here, "prepare-host-staged-storage-lifecycle-pair.mjs"),
], { encoding: "utf8" }));
assert.equal(prepared.family, "forklight-storage-lifecycle");
assert.equal(prepared.taskClass, "m4-host-staged-storage-lifecycle-checkpoint");
assert.equal(prepared.comparisonId, "cmp-m4e-storage-host-staged-20260818");
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
await rm(prepared.pairRoot, { recursive: true, force: true });

process.stdout.write("M4-E host-staged storage-lifecycle pair preflight passed\n");
