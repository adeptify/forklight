import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const family = process.argv[2];
const allowed = new Set([
  "forklight-storage-lifecycle",
  "worker-runtime",
  "hub-product-comprehension",
]);
if (!family || !allowed.has(family)) throw new Error("unsupported calibration family");

const here = path.dirname(fileURLToPath(import.meta.url));
const inputSource = path.join(here, "inputs", `${family}.json`);
const validatorSource = path.join(here, "validate-artifact.mjs");
const input = JSON.parse(await (await import("node:fs/promises")).readFile(inputSource, "utf8"));
const pairRoot = await mkdtemp(path.join(tmpdir(), `forklight-m4d-${family}-`));

const roots = {};
for (const role of ["direct", "delegated"]) {
  const root = path.join(pairRoot, role);
  const output = path.join(root, input.outputPath);
  await mkdir(path.dirname(output), { recursive: true });
  await copyFile(inputSource, path.join(root, "calibration-input.json"));
  await copyFile(validatorSource, path.join(root, "validate-artifact.mjs"));
  await writeFile(output, "", "utf8");
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  roots[role] = root;
}

for (const relative of ["calibration-input.json", "validate-artifact.mjs", input.outputPath]) {
  const direct = await (await import("node:fs/promises")).readFile(path.join(roots.direct, relative));
  const delegated = await (await import("node:fs/promises")).readFile(path.join(roots.delegated, relative));
  if (!direct.equals(delegated)) throw new Error(`comparison roots differ at ${relative}`);
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  family,
  pairRoot,
  directRoot: roots.direct,
  delegatedRoot: roots.delegated,
  outputPath: input.outputPath,
  acceptanceCommand: input.acceptanceCommand,
})}\n`);
