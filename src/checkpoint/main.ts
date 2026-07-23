#!/usr/bin/env -S node --disable-warning=ExperimentalWarning

import {
  runCheckpointMcpServer,
  scrubCheckpointEnvironment,
} from "./server.js";

scrubCheckpointEnvironment(process.env);

runCheckpointMcpServer().catch((error: unknown) => {
  process.stderr.write(
    `ForkLight checkpoint MCP failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
