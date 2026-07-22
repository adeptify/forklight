import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function json(relative: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(root, relative), "utf8")) as Record<string, unknown>;
}

test("package declares portable CLI and MCP entrypoints", async () => {
  const pkg = await json("package.json");
  assert.equal(pkg.private, true, "publishing stays disabled until licensing is approved");
  assert.equal(pkg.license, "UNLICENSED");
  assert.deepEqual(pkg.os, ["darwin"]);
  assert.equal((pkg.engines as Record<string, string>).node, ">=24.0.0");
  assert.deepEqual(pkg.bin, {
    forklight: "dist/src/cli.js",
    "forklight-mcp": "dist/src/mcp/main.js",
  });
  const files = pkg.files as string[];
  assert.ok(files.includes("dist/src/"));
  assert.ok(files.includes("plugins/forklight/"));
  assert.ok(files.includes(".agents/plugins/"));
  assert.ok(!files.some((value) => /tests|plans|Library|\.forklight/i.test(value)));
});

test("Codex plugin is portable and wired to the PATH MCP command", async () => {
  const manifest = await json("plugins/forklight/.codex-plugin/plugin.json");
  const mcp = await json("plugins/forklight/.mcp.json");
  const marketplace = await json(".agents/plugins/marketplace.json");
  assert.equal(manifest.name, "forklight");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.deepEqual(mcp, { mcpServers: { forklight: { command: "forklight-mcp" } } });
  assert.equal(marketplace.name, "adeptify");
  const shipped = JSON.stringify({ manifest, mcp, marketplace });
  assert.ok(!shipped.includes("/Users/"));
  assert.ok(!shipped.includes("Library/Application Support/ForkLight/runs"));
});
