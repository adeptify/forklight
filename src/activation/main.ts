#!/usr/bin/env -S node --disable-warning=ExperimentalWarning

import { appendFile } from "node:fs/promises";
import { daemonRequest, ensureDaemon } from "../daemon/client.js";
import {
  consumeActivationHandoff,
  runActivation,
} from "./runner.js";

async function main(): Promise<void> {
  const handoffPath = process.argv[2];
  if (handoffPath === undefined) throw new Error("Missing activation handoff path");
  const handoff = await consumeActivationHandoff(handoffPath);
  const evidence = await runActivation(handoff);
  await ensureDaemon(handoff.home);
  await daemonRequest(
    "integration_activation_complete",
    {
      operationId: handoff.operationId,
      taskId: handoff.taskId,
      receiptId: handoff.receiptId,
      evidence,
    },
    handoff.home,
  );
}

main().catch(async (error: unknown) => {
  const line = `${new Date().toISOString()} activation runner failed: ${
    error instanceof Error ? error.stack ?? error.message : String(error)
  }\n`;
  const logPath = process.env.FORKLIGHT_ACTIVATION_LOG;
  if (logPath !== undefined) {
    await appendFile(logPath, line, { encoding: "utf8", mode: 0o600 }).catch(() => undefined);
  }
  process.exitCode = 1;
});
