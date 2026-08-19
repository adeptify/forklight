import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const inputSource = path.join(
  here,
  "inputs",
  "forklight-storage-lifecycle-host-staged-checkpoint.json",
);
const validatorSource = path.join(here, "validate-artifact.mjs");
const renderTask = path.join(here, "render-task.mjs");
const input = JSON.parse(await readFile(inputSource, "utf8"));

if (
  input.family !== "forklight-storage-lifecycle"
  || input.taskClass !== "m4-host-staged-storage-lifecycle-checkpoint"
) {
  throw new Error("host-staged storage-lifecycle comparison input identity is invalid");
}
if (!input.outputPath.endsWith("/forklight-storage-lifecycle-host-staged-checkpoint.json")) {
  throw new Error("host-staged storage-lifecycle output path is invalid");
}

const pairRoot = await mkdtemp(path.join(tmpdir(), "forklight-m4e-host-staged-storage-pair-"));
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
  const direct = await readFile(path.join(roots.direct, relative));
  const delegated = await readFile(path.join(roots.delegated, relative));
  if (!direct.equals(delegated)) throw new Error(`comparison roots differ at ${relative}`);
}

const rendered = JSON.parse(execFileSync(process.execPath, [renderTask, roots.delegated], {
  encoding: "utf8",
}));

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  family: input.family,
  taskClass: input.taskClass,
  comparisonId: "cmp-m4e-storage-host-staged-20260818",
  pairRoot,
  directRoot: roots.direct,
  delegatedRoot: roots.delegated,
  taskPath: rendered.taskPath,
  outputPath: input.outputPath,
  acceptanceCommand: input.acceptanceCommand,
})}\n`);
