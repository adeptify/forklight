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
const project = projectFlag === -1 ? process.cwd() : path.resolve(process.argv[projectFlag + 1] ?? "");
const expectedPaths = [
  "src/core/main-delivery.ts", "src/core/types.ts", "src/daemon/coordinator.ts",
  "src/daemon/protocol.ts", "src/daemon/server.ts", "src/daemon/client.ts", "src/cli.ts",
  "src/cli/supervision.ts", "src/cli/exchange-receipts.ts", "src/mcp/server.ts",
  "src/mcp/exchange-receipts.ts", "tests/main-delivery.test.ts", "tests/cli-supervision.test.ts",
  "tests/cli-exchange-receipts.test.ts", "tests/daemon.test.ts", "tests/daemon-cli.test.ts",
  "tests/mcp.test.ts", "README.md", "docs/operations.md",
];

const patchText = readFileSync(patchPath, "utf8");
const changedPaths = [...patchText.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)].map((match) => {
  assert.equal(match[1], match[2], "retained patch must not rename a path");
  return match[1];
});
assert.deepEqual(changedPaths, expectedPaths);

const gitArgs = mode === "--source"
  ? ["apply", "-p1", "--check", patchPath]
  : ["apply", "-p1", "--reverse", "--check", patchPath];
const result = spawnSync("/usr/bin/git", gitArgs, {
  cwd: project,
  encoding: "utf8",
  env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  stdio: ["ignore", "pipe", "pipe"],
});
if (result.status !== 0) {
  const detail = `${result.stdout}${result.stderr}`.trim();
  throw new Error(`retained Candidate ${mode} check failed in ${project}: ${detail}`);
}

process.stdout.write(
  `retained Candidate ${mode === "--source" ? "source-base" : "reverse-apply"} verified for 19 paths\n`,
);
