#!/usr/bin/env -S node --disable-warning=ExperimentalWarning

import { runForkLightMcpServer } from "./server.js";

runForkLightMcpServer().catch((error: unknown) => {
  process.stderr.write(`ForkLight MCP failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
