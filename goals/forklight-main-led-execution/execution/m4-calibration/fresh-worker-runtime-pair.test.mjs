import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const input = JSON.parse(await readFile(path.join(here, "inputs", "worker-runtime-checkpoint.json"), "utf8"));

assert.equal(input.family, "worker-runtime");
assert.equal(input.taskClass, "m4-fresh-checkpoint-worker-runtime");
assert.equal(input.taskLabel, "M4-E fresh worker-runtime checkpoint pair");
assert.equal(input.directCodexProfileId, "codex-main-gpt-5.6-sol-xhigh-v1");
assert.equal(input.evidence.accepted.subject, "m4-e-main-efficient-delivery");
assert.equal(input.evidence.accepted.taskId, "3e2740eb-4c4e-4a55-9a80-86c51c35a5b5");
assert.equal(input.evidence.accepted.delivery.freshPostReview, true);
assert.equal(input.evidence.accepted.checkpoints.observationTimeoutCancelsUnderlyingWork, false);
assert.deepEqual(input.evidence.predecessors, []);
assert.equal(input.outputPath.endsWith("/worker-runtime-checkpoint.json"), true);
assert.notEqual(input.outputPath.endsWith("/worker-runtime.json"), true);

const prepared = JSON.parse(execFileSync(process.execPath, [
  path.join(here, "prepare-fresh-worker-runtime-pair.mjs"),
], { encoding: "utf8" }));
assert.equal(prepared.family, "worker-runtime");
assert.equal(prepared.taskClass, "m4-fresh-checkpoint-worker-runtime");
assert.notEqual(prepared.directRoot, prepared.delegatedRoot);
assert.equal(path.dirname(prepared.directRoot), prepared.pairRoot);
assert.equal(path.dirname(prepared.delegatedRoot), prepared.pairRoot);
await rm(prepared.pairRoot, { recursive: true, force: true });

process.stdout.write("M4-E fresh worker-runtime pair preflight passed\n");
