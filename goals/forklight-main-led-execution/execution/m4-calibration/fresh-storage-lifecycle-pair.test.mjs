import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const input = JSON.parse(await readFile(
  path.join(here, "inputs", "forklight-storage-lifecycle-checkpoint.json"),
  "utf8",
));

assert.equal(input.family, "forklight-storage-lifecycle");
assert.equal(input.taskClass, "m4-fresh-checkpoint-storage-lifecycle");
assert.equal(input.taskLabel, "M4-E fresh storage-lifecycle checkpoint pair");
assert.equal(input.directCodexProfileId, "codex-main-gpt-5.6-sol-xhigh-v1");
assert.deepEqual(input.requiredProjection.protectedTaskIds, [
  "2d774265-344f-43ea-8f69-79e2624765d3",
]);
assert.deepEqual(input.requiredProjection.reclaimableTaskIds, [
  "3e2740eb-4c4e-4a55-9a80-86c51c35a5b5",
  "da6a7615-2b2a-483b-bb1c-3b8a1269e65b",
]);
assert.equal(input.requiredProjection.reclaimExecuted, false);
assert.equal(input.evidence.storeIntegrity.quickCheck, "ok");
assert.equal(input.evidence.storeIntegrity.foreignKeyViolationCount, 0);
assert.equal(input.evidence.items.every((item) => item.unknownBytes === 0), true);
assert.equal(input.evidence.items.every((item) => item.processCount === 0), true);
assert.equal(input.outputPath.endsWith("/forklight-storage-lifecycle-checkpoint.json"), true);
assert.notEqual(input.outputPath.endsWith("/forklight-storage-lifecycle.json"), true);

const prepared = JSON.parse(execFileSync(process.execPath, [
  path.join(here, "prepare-fresh-storage-lifecycle-pair.mjs"),
], { encoding: "utf8" }));
assert.equal(prepared.family, "forklight-storage-lifecycle");
assert.equal(prepared.taskClass, "m4-fresh-checkpoint-storage-lifecycle");
assert.notEqual(prepared.directRoot, prepared.delegatedRoot);
assert.equal(path.dirname(prepared.directRoot), prepared.pairRoot);
assert.equal(path.dirname(prepared.delegatedRoot), prepared.pairRoot);
await rm(prepared.pairRoot, { recursive: true, force: true });

process.stdout.write("M4-E fresh storage-lifecycle pair preflight passed\n");
