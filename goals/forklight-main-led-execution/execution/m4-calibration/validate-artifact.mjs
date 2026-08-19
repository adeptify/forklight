import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("usage: node validate-artifact.mjs <input.json> <output.json>");
}

const MAX_BYTES = 16 * 1024;
const parseBounded = async (file) => {
  const raw = await readFile(file, "utf8");
  assert.ok(Buffer.byteLength(raw) <= MAX_BYTES, "calibration JSON exceeds 16 KiB");
  return JSON.parse(raw);
};

const input = await parseBounded(inputPath);
const actual = await parseBounded(outputPath);

const base = {
  schemaVersion: 1,
  family: input.family,
};

const expectedByFamily = {
  "forklight-storage-lifecycle": {
    ...base,
    evidenceMode: input.requiredProjection.evidenceMode,
    tasks: input.evidence.items,
    decision: {
      protectedTaskIds: input.requiredProjection.protectedTaskIds,
      reclaimableTaskIds: input.requiredProjection.reclaimableTaskIds,
      reclaimExecuted: input.requiredProjection.reclaimExecuted,
    },
    storeIntegrity: input.evidence.storeIntegrity,
    sourceRefs: input.sourceRefs,
  },
  "worker-runtime": {
    ...base,
    evidenceMode: input.requiredProjection.evidenceMode,
    accepted: input.evidence.accepted,
    predecessors: input.evidence.predecessors,
    runtimeMutationOccurred: input.requiredProjection.runtimeMutationOccurred,
    sourceRefs: input.sourceRefs,
  },
  "hub-product-comprehension": {
    ...base,
    evidenceMode: input.requiredProjection.evidenceMode,
    historicalRouting: input.evidence.historicalRouting,
    requirements: input.evidence.requirements,
    hubMutationOccurred: input.requiredProjection.hubMutationOccurred,
    m5Implemented: input.requiredProjection.m5Implemented,
    sourceRefs: input.sourceRefs,
  },
};

const expected = expectedByFamily[input.family];
assert.ok(expected, "unsupported calibration family");
assert.deepEqual(actual, expected, "artifact does not match the accepted evidence projection");

const serialized = JSON.stringify(actual);
for (const forbidden of [
  "/Users/",
  "Library/Application Support",
  "auth.json",
  "chat_history",
  "system_prompt",
]) {
  assert.equal(serialized.includes(forbidden), false, `artifact contains forbidden private content: ${forbidden}`);
}
assert.equal(/(?:^|[\"'\s:])sk-[A-Za-z0-9]/.test(serialized), false, "artifact contains credential-shaped content");

process.stdout.write(`${JSON.stringify({
  ok: true,
  family: input.family,
  outputPath,
  schemaVersion: 1,
})}\n`);
