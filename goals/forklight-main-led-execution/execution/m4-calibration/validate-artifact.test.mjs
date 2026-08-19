import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const families = [
  "forklight-storage-lifecycle",
  "worker-runtime",
  "hub-product-comprehension",
];

const expectedFor = (input) => {
  const base = { schemaVersion: 1, family: input.family };
  if (input.family === "forklight-storage-lifecycle") {
    return {
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
    };
  }
  if (input.family === "worker-runtime") {
    return {
      ...base,
      evidenceMode: input.requiredProjection.evidenceMode,
      accepted: input.evidence.accepted,
      predecessors: input.evidence.predecessors,
      runtimeMutationOccurred: input.requiredProjection.runtimeMutationOccurred,
      sourceRefs: input.sourceRefs,
    };
  }
  return {
    ...base,
    evidenceMode: input.requiredProjection.evidenceMode,
    historicalRouting: input.evidence.historicalRouting,
    requirements: input.evidence.requirements,
    hubMutationOccurred: input.requiredProjection.hubMutationOccurred,
    m5Implemented: input.requiredProjection.m5Implemented,
    sourceRefs: input.sourceRefs,
  };
};

const temp = await mkdtemp(path.join(tmpdir(), "forklight-m4d-validator-"));
for (const family of families) {
  const inputPath = path.join(here, "inputs", `${family}.json`);
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  const outputPath = path.join(temp, `${family}.json`);
  await writeFile(outputPath, `${JSON.stringify(expectedFor(input), null, 2)}\n`, "utf8");
  const stdout = execFileSync(process.execPath, [
    path.join(here, "validate-artifact.mjs"), inputPath, outputPath,
  ], { encoding: "utf8" });
  assert.equal(JSON.parse(stdout).family, family);
}

const storageInputPath = path.join(here, "inputs", "forklight-storage-lifecycle.json");
const storageInput = JSON.parse(await readFile(storageInputPath, "utf8"));
const wrongOutput = { ...expectedFor(storageInput), unexpected: true };
const wrongPath = path.join(temp, "wrong.json");
await writeFile(wrongPath, JSON.stringify(wrongOutput), "utf8");
assert.notEqual(spawnSync(process.execPath, [
  path.join(here, "validate-artifact.mjs"), storageInputPath, wrongPath,
]).status, 0);

const privateInput = structuredClone(storageInput);
privateInput.sourceRefs = ["/Users/private/secret"];
const privateInputPath = path.join(temp, "private-input.json");
const privateOutputPath = path.join(temp, "private-output.json");
await writeFile(privateInputPath, JSON.stringify(privateInput), "utf8");
await writeFile(privateOutputPath, JSON.stringify(expectedFor(privateInput)), "utf8");
assert.notEqual(spawnSync(process.execPath, [
  path.join(here, "validate-artifact.mjs"), privateInputPath, privateOutputPath,
]).status, 0);

process.stdout.write(`${JSON.stringify({ ok: true, families: families.length })}\n`);
