import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ForkLightDaemon } from "../src/daemon/server.js";
import { createForkLightMcpServer } from "../src/mcp/server.js";

test("MCP exposes ForkLight tools and reaches the daemon", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-mcp-"));
  const daemon = new ForkLightDaemon(home, 1);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      [
        "forklight_health",
        "forklight_inspect",
        "forklight_list",
        "forklight_resume",
        "forklight_status",
        "forklight_submit",
      ],
    );
    const health = await client.callTool({ name: "forklight_health", arguments: {} });
    assert.equal(health.isError, undefined);
    assert.equal((health.structuredContent as { ok?: boolean } | undefined)?.ok, true);
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});
