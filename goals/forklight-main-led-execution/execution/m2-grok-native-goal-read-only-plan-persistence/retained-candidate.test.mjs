#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const patchPath = path.join(here, "retained-candidate.diff");
const mode = process.argv[2];
assert.ok(mode === "--source" || mode === "--candidate", "use --source or --candidate");

const projectFlag = process.argv.indexOf("--project");
const project = projectFlag === -1
  ? process.cwd()
  : path.resolve(process.argv[projectFlag + 1] ?? "");

const patchText = readFileSync(patchPath, "utf8");
const changedPaths = [...patchText.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)].map((match) => {
  assert.equal(match[1], match[2], "retained patch must not rename a path");
  return match[1];
});
assert.deepEqual(changedPaths, [
  "src/workers/grok.ts",
  "tests/worker-runtime.test.ts",
]);

const gitArgs = mode === "--source"
  ? ["apply", "--check", patchPath]
  : ["apply", "--reverse", "--check", patchPath];
const result = spawnSync("git", gitArgs, {
  cwd: project,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
if (result.status !== 0) {
  const detail = `${result.stdout}${result.stderr}`.trim();
  throw new Error(`retained Candidate ${mode} check failed in ${project}: ${detail}`);
}

process.stdout.write(
  `retained Candidate ${mode === "--source" ? "source-base" : "reverse-apply"} verified for 2 paths\n`,
);
