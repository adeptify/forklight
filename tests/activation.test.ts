import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  ACTIVATION_OPERATION_ID_ENV,
  ACTIVATION_RECEIPT_ID_ENV,
  ACTIVATION_TASK_ID_ENV,
  consumeActivationHandoff,
  readActivationHandoffContext,
  resolveTsxImportSpecifier,
  runActivation,
  setActivationHandoffContext,
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

// --- Activation handoff operation context ---

test("readActivationHandoffContext returns undefined before setActivationHandoffContext", () => {
  const savedOp = process.env[ACTIVATION_OPERATION_ID_ENV];
  delete process.env[ACTIVATION_OPERATION_ID_ENV];
  try {
    assert.equal(readActivationHandoffContext(), undefined);
  } finally {
    if (savedOp !== undefined) process.env[ACTIVATION_OPERATION_ID_ENV] = savedOp;
  }
});

test("setActivationHandoffContext stores operation identity and readActivationHandoffContext reads it back", () => {
  const savedOp = process.env[ACTIVATION_OPERATION_ID_ENV];
  const savedTask = process.env[ACTIVATION_TASK_ID_ENV];
  const savedRec = process.env[ACTIVATION_RECEIPT_ID_ENV];
  delete process.env[ACTIVATION_OPERATION_ID_ENV];
  delete process.env[ACTIVATION_TASK_ID_ENV];
  delete process.env[ACTIVATION_RECEIPT_ID_ENV];
  try {
    const handoff: ActivationHandoff = {
      version: 1,
      operationId: "op-handoff-context",
      taskId: "task-handoff-context",
      receiptId: "rec-handoff-context",
      home: "/tmp",
      sourcePath: "/tmp",
      timeoutMs: 5_000,
      activationCommands: ["true"],
      activationCheckCommands: ["true"],
    };
    setActivationHandoffContext(handoff);
    const ctx = readActivationHandoffContext();
    assert.ok(ctx !== undefined);
    assert.equal(ctx!.operationId, "op-handoff-context");
    assert.equal(ctx!.taskId, "task-handoff-context");
    assert.equal(ctx!.receiptId, "rec-handoff-context");
  } finally {
    delete process.env[ACTIVATION_OPERATION_ID_ENV];
    delete process.env[ACTIVATION_TASK_ID_ENV];
    delete process.env[ACTIVATION_RECEIPT_ID_ENV];
    if (savedOp !== undefined) process.env[ACTIVATION_OPERATION_ID_ENV] = savedOp;
    if (savedTask !== undefined) process.env[ACTIVATION_TASK_ID_ENV] = savedTask;
    if (savedRec !== undefined) process.env[ACTIVATION_RECEIPT_ID_ENV] = savedRec;
  }
});

test("readActivationHandoffContext returns undefined when only some env vars are set", () => {
  const savedOp = process.env[ACTIVATION_OPERATION_ID_ENV];
  const savedTask = process.env[ACTIVATION_TASK_ID_ENV];
  const savedRec = process.env[ACTIVATION_RECEIPT_ID_ENV];
  try {
    process.env[ACTIVATION_OPERATION_ID_ENV] = "only-operation";
    delete process.env[ACTIVATION_TASK_ID_ENV];
    delete process.env[ACTIVATION_RECEIPT_ID_ENV];
    assert.equal(readActivationHandoffContext(), undefined,
      "missing taskId and receiptId must return undefined");
  } finally {
    if (savedOp !== undefined) process.env[ACTIVATION_OPERATION_ID_ENV] = savedOp;
    else delete process.env[ACTIVATION_OPERATION_ID_ENV];
    if (savedTask !== undefined) process.env[ACTIVATION_TASK_ID_ENV] = savedTask;
    else delete process.env[ACTIVATION_TASK_ID_ENV];
    if (savedRec !== undefined) process.env[ACTIVATION_RECEIPT_ID_ENV] = savedRec;
    else delete process.env[ACTIVATION_RECEIPT_ID_ENV];
  }
});

test("resolveTsxImportSpecifier returns a cwd-independent file URL for the repo tsx loader", () => {
  const resolved = resolveTsxImportSpecifier(import.meta.url);
  assert.match(resolved, /^file:\/\//);
  assert.match(resolved, /tsx/);
  // Must not be the bare package name that Node would re-resolve from cwd.
  assert.notEqual(resolved, "tsx");
});

test("self-upgrade delivery profile uses fail-closed stop && start activation", async () => {
  const profilePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "examples",
    "dogfood",
    "forklight-self-upgrade-delivery-settings.yaml",
  );
  const text = await readFile(profilePath, "utf8");
  assert.match(
    text,
    /daemon stop && node dist\/src\/cli\.js daemon start --startup-timeout-ms 60000/,
  );
  assert.doesNotMatch(text, /for i in \{1\.\.100\}/);
  assert.doesNotMatch(text, /daemon status/);
  assert.doesNotMatch(text, /daemon stop;/);
  // Public CLI health proves identity match; it intentionally omits pid.
  assert.match(text, /identityStatus !== "matched"/);
  assert.doesNotMatch(text, /value\.pid/);
});
