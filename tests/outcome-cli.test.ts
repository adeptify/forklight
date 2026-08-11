import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { daemonSocketPath } from "../src/core/config.js";
import { ForkLightDaemon } from "../src/daemon/server.js";
import { StateStore } from "../src/state/store.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// --- Fixtures ---

async function writeTaskContract(home: string): Promise<string> {
  await mkdir(path.join(home, "project"), { recursive: true });
  const taskFile = path.join(home, "task.json");
  await writeFile(
    taskFile,
    JSON.stringify(
      {
        version: 2,
        name: "Bounded outcome CLI task",
        project: "./project",
        contract: {
          outcome: "Produce one bounded, independently verifiable result for this intake",
          context: ["Existing behavior is known and documented"],
          inScope: ["Make the smallest coherent change that satisfies the outcome"],
          outOfScope: ["Do not touch unrelated areas or external systems"],
          executionSteps: [
            "Inspect the relevant code paths",
            "Apply the smallest coherent change",
            "Run the acceptance command",
          ],
          deliverables: ["Updated behavior with the acceptance command passing"],
          modules: [
            {
              name: "bounded result",
              responsibility: "Produce the one bounded result while preserving existing behavior",
              consumes: ["declared inputs"],
              produces: ["a validated result"],
              boundaries: ["no undeclared mutation"],
            },
          ],
          callChain: [
            "The caller provides declared inputs",
            "The Worker produces the validated result",
            "The acceptance command verifies the result",
          ],
          scenarios: [
            {
              name: "nominal",
              given: "declared inputs are valid",
              when: "the task runs",
              then: "the result is produced and verified",
            },
            {
              name: "boundary",
              given: "an edge input is supplied",
              when: "the task runs",
              then: "behavior stays bounded and safe",
            },
          ],
          risks: ["Behavior drift from an over-broad change"],
          changeBudget: { maxFiles: 4, maxDiffLines: 200 },
        },
        provider: {
          name: "deepseek",
          model: "deepseek-v4-flash",
          keychainService: "forklight.outcome-cli.test",
        },
        runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: null },
        worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
        acceptance: { criteria: ["The outcome is satisfied"], commands: ["true"] },
      },
      null,
      2,
    ),
  );
  return taskFile;
}

// --- CLI subprocess helpers ---

function cliArgs(...args: string[]): string[] {
  return [
    "--disable-warning=ExperimentalWarning",
    "--import",
    "tsx",
    path.join(root, "src", "cli.ts"),
    ...args,
  ];
}

async function runCli(
  home: string,
  args: string[],
  timeoutMs = 20_000,
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const result = await execFileAsync(process.execPath, cliArgs(...args), {
      cwd: root,
      env: { ...process.env, FORKLIGHT_HOME: home },
      timeout: timeoutMs,
    });
    return { stdout: result.stdout, stderr: result.stderr, code: 0 };
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      code: typeof execError.code === "number" ? execError.code : 1,
    };
  }
}

function escapedPath(filePath: string): string {
  return filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function storeTaskCount(home: string): number {
  const store = new StateStore(home);
  try {
    return store.listTasks().length;
  } finally {
    store.close();
  }
}

// --- End-to-end two-phase CLI flow ---

test("forklight outcome CLI runs the full two-phase flow against a real daemon", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-cli-"));
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const taskFile = await writeTaskContract(home);

    // Human create output names status, revision, and the exact next command,
    // and never leaks any artifact path (none was supplied yet).
    const createdHuman = await runCli(home, [
      "outcome", "create", "--outcome", "Human visible outcome",
    ]);
    assert.equal(createdHuman.code, 0, createdHuman.stderr);
    assert.match(createdHuman.stdout, /status: pending/);
    assert.match(createdHuman.stdout, /revision: 1/);
    assert.match(createdHuman.stdout, /outcome propose /);
    assert.doesNotMatch(createdHuman.stdout, /task\.json/);
    const humanIntakeId = /intakeId: (\S+)/.exec(createdHuman.stdout)?.[1];
    assert.ok(humanIntakeId, "human create must print the intake id");

    // Human propose output is privacy-safe and names the exact confirm revision.
    const proposedHuman = await runCli(home, [
      "outcome", "propose", humanIntakeId,
      "--expected-revision", "1",
      "--shape", "task",
      "--artifact", taskFile,
      "--reason", "One bounded Task fits",
    ]);
    assert.equal(proposedHuman.code, 0, proposedHuman.stderr);
    assert.match(proposedHuman.stdout, /selectedShape: task/);
    assert.match(proposedHuman.stdout, /workCreated: 0/);
    assert.match(proposedHuman.stdout, /confirmationHappened: false/);
    assert.match(proposedHuman.stdout, /outcome confirm .* --expected-revision 2 --confirm/);
    assert.doesNotMatch(proposedHuman.stdout, new RegExp(escapedPath(taskFile)));
    assert.equal(storeTaskCount(home), 0, "propose must not create work");

    // 1. Create a pending draft through the daemon: one intake record, zero work.
    const created = await runCli(home, [
      "outcome", "create", "--outcome", "Ship a bounded CLI outcome", "--json",
    ]);
    assert.equal(created.code, 0, created.stderr);
    const createdBody = JSON.parse(created.stdout) as Record<string, unknown>;
    assert.equal(createdBody.status, "pending");
    assert.equal(createdBody.revision, 1);
    assert.equal(createdBody.requestedShape, "auto");
    assert.equal(storeTaskCount(home), 0, "create must not create work");
    const intakeId = String(createdBody.id);
    assert.ok(intakeId.length > 0);

    // 2. List and get read back the pending draft through the daemon.
    const listed = await runCli(home, ["outcome", "list", "--json"]);
    assert.equal(listed.code, 0, listed.stderr);
    const listedBody = JSON.parse(listed.stdout) as Array<Record<string, unknown>>;
    assert.ok(
      listedBody.some((view) => view.id === intakeId && view.status === "pending"),
      "pending draft must appear in the list",
    );

    const filtered = await runCli(home, [
      "outcome", "list", "--status", "pending", "--limit", "1", "--json",
    ]);
    assert.equal(filtered.code, 0, filtered.stderr);
    const filteredBody = JSON.parse(filtered.stdout) as Array<Record<string, unknown>>;
    assert.equal(filteredBody.length, 1);
    assert.equal(filteredBody[0]!.id, intakeId);

    const got = await runCli(home, ["outcome", "get", intakeId, "--json"]);
    assert.equal(got.code, 0, got.stderr);
    const gotBody = JSON.parse(got.stdout) as Record<string, unknown>;
    assert.equal(gotBody.status, "pending");
    assert.equal(gotBody.revision, 1);

    // 3. Propose one validated Task at the expected revision: preview only.
    const proposed = await runCli(home, [
      "outcome", "propose", intakeId,
      "--expected-revision", "1",
      "--shape", "task",
      "--artifact", taskFile,
      "--reason", "One bounded Task fits",
      "--json",
    ]);
    assert.equal(proposed.code, 0, proposed.stderr);
    const proposedBody = JSON.parse(proposed.stdout) as {
      intake: Record<string, unknown>;
      preview: Record<string, unknown>;
    };
    assert.equal(proposedBody.intake.status, "proposed");
    assert.equal(proposedBody.intake.revision, 2);
    assert.equal(proposedBody.preview.selectedShape, "task");
    assert.equal(proposedBody.preview.taskCount, 1);
    assert.equal(proposedBody.preview.confirmationHappened, false);
    assert.equal(proposedBody.preview.workCreated, 0);
    assert.deepEqual(proposedBody.preview.contractsInvolved, ["task-contract-v2"]);
    assert.equal(storeTaskCount(home), 0, "propose must not create work");

    // 4. Confirmation without --confirm fails before any work.
    const missingConfirm = await runCli(home, [
      "outcome", "confirm", intakeId, "--expected-revision", "2", "--json",
    ]);
    assert.notEqual(missingConfirm.code, 0);
    assert.match(missingConfirm.stderr, /requires --confirm/);
    assert.equal(storeTaskCount(home), 0, "missing --confirm must not create work");

    // 5. Stale revision fails closed and leaves everything unchanged.
    const stale = await runCli(home, [
      "outcome", "confirm", intakeId, "--expected-revision", "1", "--confirm", "--json",
    ]);
    assert.notEqual(stale.code, 0);
    assert.match(stale.stderr, /out of date/);
    assert.equal(storeTaskCount(home), 0);

    // 6. Explicit confirm creates work exactly once; retry returns the same receipt.
    const confirmed = await runCli(home, [
      "outcome", "confirm", intakeId, "--expected-revision", "2", "--confirm", "--json",
    ]);
    assert.equal(confirmed.code, 0, confirmed.stderr);
    const confirmedBody = JSON.parse(confirmed.stdout) as {
      intake: Record<string, unknown>;
      receipt: Record<string, unknown>;
    };
    assert.equal(confirmedBody.intake.status, "created");
    assert.equal(confirmedBody.receipt.shape, "task");
    assert.equal((confirmedBody.receipt.taskIds as unknown[]).length, 1);
    const receiptId = String(confirmedBody.receipt.receiptId);
    assert.equal(storeTaskCount(home), 1, "confirm must create exactly one Task");

    const retry = await runCli(home, [
      "outcome", "confirm", intakeId, "--expected-revision", "2", "--confirm", "--json",
    ]);
    assert.equal(retry.code, 0, retry.stderr);
    const retryBody = JSON.parse(retry.stdout) as { receipt: Record<string, unknown> };
    assert.equal(String(retryBody.receipt.receiptId), receiptId, "retry must return the same receipt");
    assert.equal(storeTaskCount(home), 1, "retry must not create a second Task");

    // 7. Get after creation shows the durable receipt through the daemon.
    const createdRead = await runCli(home, ["outcome", "get", intakeId, "--json"]);
    assert.equal(createdRead.code, 0, createdRead.stderr);
    const createdReadBody = JSON.parse(createdRead.stdout) as Record<string, unknown>;
    assert.equal(createdReadBody.status, "created");
    assert.equal(
      (createdReadBody.confirmation as Record<string, unknown>).receiptId,
      receiptId,
    );

    // Confirm human output is concise, private, and terminal.
    const confirmedHuman = await runCli(home, [
      "outcome", "confirm", intakeId, "--expected-revision", "2", "--confirm",
    ]);
    assert.equal(confirmedHuman.code, 0, confirmedHuman.stderr);
    assert.match(confirmedHuman.stdout, /status: created/);
    assert.match(confirmedHuman.stdout, /receiptId: /);
    assert.doesNotMatch(confirmedHuman.stdout, new RegExp(escapedPath(taskFile)));
  } finally {
    await daemon.close();
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("outcome list/get are read-only projections and never start a daemon", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-cli-observer-"));
  try {
    const listed = await runCli(home, ["outcome", "list", "--json"]);
    assert.notEqual(listed.code, 0);
    assert.match(listed.stderr, /never starts a daemon/i);

    const got = await runCli(home, ["outcome", "get", "intake-absent", "--json"]);
    assert.notEqual(got.code, 0);
    assert.match(got.stderr, /never starts a daemon/i);

    assert.equal(
      existsSync(daemonSocketPath(home)),
      false,
      "read-only outcome commands must not start a daemon",
    );
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("outcome CLI rejects malformed arguments before any daemon contact", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-cli-args-"));
  try {
    const cases: Array<{ args: string[]; pattern: RegExp }> = [
      {
        args: ["outcome", "create", "--outcome", "x", "--shape", "epic"],
        pattern: /auto, task, plan, or goal/,
      },
      {
        args: ["outcome", "create", "--shape", "task"],
        pattern: /Missing outcome text/,
      },
      {
        args: ["outcome", "list", "--status", "running"],
        pattern: /pending, proposed, or created/,
      },
      {
        args: ["outcome", "list", "--limit", "0"],
        pattern: /integer from 1 to 100/,
      },
      {
        args: ["outcome", "get", "intake-x", "--unknown"],
        pattern: /unknown argument: --unknown/,
      },
      {
        args: ["outcome", "propose", "intake-x", "--shape", "task"],
        pattern: /Missing expected revision/,
      },
      {
        args: ["outcome", "confirm", "intake-x", "--expected-revision", "not-a-number", "--confirm"],
        pattern: /positive integer/,
      },
      {
        args: ["outcome", "create", "--outcome", "x", "stray"],
        pattern: /unexpected argument: stray/,
      },
    ];
    for (const { args, pattern } of cases) {
      const result = await runCli(home, args);
      assert.notEqual(result.code, 0, `expected failure for ${args.join(" ")}`);
      assert.match(result.stderr, pattern, result.stderr);
      assert.equal(
        existsSync(daemonSocketPath(home)),
        false,
        `invalid outcome args must not start a daemon: ${args.join(" ")}`,
      );
    }
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});
