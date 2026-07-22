#!/usr/bin/env -S node --disable-warning=ExperimentalWarning

import { forklightHome } from "../core/config.js";
import { ForkLightDaemon } from "./server.js";

const daemon = new ForkLightDaemon(forklightHome());
let closing = false;

async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  await daemon.close();
}

process.on("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

daemon.start().catch((error: unknown) => {
  process.stderr.write(`ForkLight daemon failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
