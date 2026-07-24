import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  consumeActivationHandoff,
  runActivation,
  writeActivationHandoff,
} from "../src/activation/runner.js";
import type { ActivationHandoff } from "../src/core/types.js";

test("activation handoff is protected, consumed once, and commands are evidenced", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-activation-"));
  const marker = path.join(root, "ready.txt");
  const handoff: ActivationHandoff = {
    version: 1,
    operationId: "operation-1",
    taskId: "task-1",
    receiptId: "receipt-1",
    home: root,
    sourcePath: root,
    timeoutMs: 5_000,
    activationCommands: [
      `node -e 'require("node:fs").writeFileSync(process.argv[1], "ready")' ${JSON.stringify(marker)}`,
    ],
    activationCheckCommands: [`test -f ${JSON.stringify(marker)}`],
  };
  const handoffPath = await writeActivationHandoff(root, handoff);
  assert.equal((await stat(handoffPath)).mode & 0o777, 0o600);

  const consumed = await consumeActivationHandoff(handoffPath);
  await assert.rejects(stat(handoffPath), /ENOENT/);
  const evidence = await runActivation(consumed);
  assert.equal(evidence.status, "passed");
  assert.deepEqual(evidence.commands?.map((command) => command.exitCode), [0, 0]);
});

test("failed activation does not run activation checks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-activation-fail-"));
  const handoff: ActivationHandoff = {
    version: 1,
    operationId: "operation-2",
    taskId: "task-2",
    receiptId: "receipt-2",
    home: root,
    sourcePath: root,
    timeoutMs: 5_000,
    activationCommands: ["node -e \"process.exit(3)\""],
    activationCheckCommands: ["node -e \"process.exit(9)\""],
  };
  const evidence = await runActivation(handoff);
  assert.equal(evidence.status, "failed");
  assert.deepEqual(evidence.commands?.map((command) => command.exitCode), [3]);
});
