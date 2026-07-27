import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildTaskRecord } from "../src/core/runner.js";
import { parseTaskSpec } from "../src/core/task.js";
import { ForkLightDaemon } from "../src/daemon/server.js";
import { StateStore } from "../src/state/store.js";

const ROOT = process.cwd();
const TS = "2026-07-23T12:00:00.000Z";
const TASK_CLASS = "edit-task";
const PROFILE = "codex-main-v1";
const USAGE = {
  type: "turn.completed",
  usage: {
    input_tokens: 4000,
    cached_input_tokens: 1000,
    cache_write_input_tokens: 0,
    output_tokens: 500,
    reasoning_output_tokens: 100,
  },
};

interface CliResult { readonly stdout: string; readonly stderr: string; readonly exitCode: number }

function runCli(home: string, arguments_: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(process.execPath, [
      "--disable-warning=ExperimentalWarning", "--import", "tsx",
      path.join(ROOT, "src/cli.ts"), ...arguments_,
    ], { cwd: ROOT, encoding: "utf8", env: { ...process.env, FORKLIGHT_HOME: home } },
    (error, stdout, stderr) => {
      const code = (error as (Error & { code?: unknown }) | null)?.code;
      resolve({
        stdout: String(stdout), stderr: String(stderr),
        exitCode: error === null ? 0 : typeof code === "number" ? code : 1,
      });
    });
  });
}

function withStore<T>(home: string, fn: (store: StateStore) => T): T {
  const store = new StateStore(home);
  try { return fn(store); } finally { store.close(); }
}

function seedTask(home: string, id: string, taskClass = TASK_CLASS, profileId = PROFILE): void {
  withStore(home, (store) => {
    const spec = parseTaskSpec({
      version: 1, name: id, project: "/tmp/source", goal: "Test direct Codex CLI",
      taskClass, directCodexProfileId: profileId,
      acceptance: { commands: ["true"] },
    }, "/tmp");
    store.createTask(buildTaskRecord({
      spec, taskFile: `/tmp/${id}.yaml`, home, id,
      sessionId: `session-${id}`, createdAt: TS,
    }));
  });
}

function metadata(
  sampleId: string, taskId: string, capturedAt: string,
  taskClass = TASK_CLASS, profileId = PROFILE,
): Record<string, unknown> {
  return {
    sampleId, forklightTaskId: taskId, exactTaskClass: taskClass,
    directCodexProfileId: profileId, directRunRef: `codex-run:${sampleId}`,
    pairingRef: `pair:${sampleId}`, capturedAt,
  };
}

function captureArguments(meta: Record<string, unknown>, json = false): string[] {
  return [
    "direct-codex", "capture", "--usage", JSON.stringify(USAGE),
    "--metadata", JSON.stringify(meta), ...(json ? ["--json"] : []),
  ];
}

function reviewArguments(sampleId: string, decision: "accepted" | "rejected", confirm: boolean): string[] {
  return [
    "direct-codex", "review", "--sample-id", sampleId,
    "--decision", decision,
    ...(decision === "rejected" ? ["--rejection-reason", "incomplete-evidence"] : []),
    "--reviewer", "main-codex", "--reviewed-at", TS,
    "--schema-version", "1", ...(confirm ? ["--confirm"] : []),
  ];
}

function pairArguments(subcommand: "inbox" | "publication-preview", json = false): string[] {
  return [
    "direct-codex", subcommand, "--task-class", TASK_CLASS,
    "--profile-id", PROFILE, ...(json ? ["--json"] : []),
  ];
}

function assertFixedFailure(result: CliResult, expected: string, secret?: string): void {
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, `ForkLight error: ${expected}\n`);
  if (secret !== undefined) assert.ok(!result.stderr.includes(secret));
}

test("direct-codex CLI runs capture through registration with stable exact-pair output and capture-only receipts", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-direct-cli-flow-"));
  for (const id of ["task-a", "task-b", "task-c"]) seedTask(home, id);
  seedTask(home, "task-other", TASK_CLASS, "codex-other-v1");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const aMeta = metadata("sample-a", "task-a", "2026-07-23T12:00:01.000Z");
    const aCapture = await runCli(home, captureArguments(aMeta, true));
    assert.equal(aCapture.exitCode, 0);
    assert.equal(aCapture.stderr, "");
    assert.deepEqual(JSON.parse(aCapture.stdout), {
      sampleId: "sample-a", forklightTaskId: "task-a", exactTaskClass: TASK_CLASS,
      directCodexProfileId: PROFILE, inputTokens: 3000, outputTokens: 500,
      cacheReadInputTokens: 1000, cacheCreationInputTokens: 0,
      source: "codex-terminal-result", complete: true,
      directRunRef: "codex-run:sample-a", pairingRef: "pair:sample-a",
      capturedAt: "2026-07-23T12:00:01.000Z", schemaVersion: 1,
    });

    const bCapture = await runCli(home, captureArguments(
      metadata("sample-b", "task-b", "2026-07-23T12:00:02.000Z"),
    ));
    assert.equal(bCapture.stdout, [
      "sampleId: sample-b", "forklightTaskId: task-b", `exactTaskClass: ${TASK_CLASS}`,
      `directCodexProfileId: ${PROFILE}`, "inputTokens: 3000", "outputTokens: 500",
      "cacheReadInputTokens: 1000", "cacheCreationInputTokens: 0",
      "source: codex-terminal-result", "complete: true", "directRunRef: codex-run:sample-b",
      "pairingRef: pair:sample-b", "capturedAt: 2026-07-23T12:00:02.000Z", "schemaVersion: 1", "",
    ].join("\n"));
    assert.equal((await runCli(home, captureArguments(
      metadata("sample-c", "task-c", "2026-07-23T12:00:03.000Z"),
    ))).exitCode, 0);
    assert.equal((await runCli(home, captureArguments(
      metadata("sample-other", "task-other", "2026-07-23T12:00:04.000Z", TASK_CLASS, "codex-other-v1"),
    ))).exitCode, 0);

    const pending = await runCli(home, pairArguments("inbox", true));
    const pendingItems = JSON.parse(pending.stdout) as Array<{ reviewState: string }>;
    assert.deepEqual(pendingItems.map((item) => item.reviewState), ["pending", "pending", "pending"]);
    const otherPair = await runCli(home, [
      "direct-codex", "inbox", "--task-class", TASK_CLASS,
      "--profile-id", "codex-other-v1", "--json",
    ]);
    assert.equal((JSON.parse(otherPair.stdout) as unknown[]).length, 1);

    const accepted = await runCli(home, reviewArguments("sample-a", "accepted", true));
    assert.equal(accepted.stdout,
      `sampleId: sample-a\ndecision: accepted\nreviewer: main-codex\nreviewedAt: ${TS}\nschemaVersion: 1\n`);
    const rejected = await runCli(home, reviewArguments("sample-b", "rejected", true));
    assert.equal(rejected.stdout,
      `sampleId: sample-b\ndecision: rejected\nrejectionReason: incomplete-evidence\nreviewer: main-codex\nreviewedAt: ${TS}\nschemaVersion: 1\n`);

    const mixed = await runCli(home, pairArguments("inbox"));
    assert.equal(mixed.stdout, [
      `exactTaskClass: ${TASK_CLASS}`, `directCodexProfileId: ${PROFILE}`, "items: 3",
      "  sample-a: accepted", "    forklightTaskId: task-a",
      "    capturedAt: 2026-07-23T12:00:01.000Z",
      "    tokens: input=3000 output=500 cacheRead=1000 cacheCreation=0",
      "    reviewer: main-codex", `    reviewedAt: ${TS}`,
      "  sample-b: rejected", "    forklightTaskId: task-b",
      "    capturedAt: 2026-07-23T12:00:02.000Z",
      "    tokens: input=3000 output=500 cacheRead=1000 cacheCreation=0",
      "    reviewer: main-codex", `    reviewedAt: ${TS}`,
      "    rejectionReason: incomplete-evidence",
      "  sample-c: pending", "    forklightTaskId: task-c",
      "    capturedAt: 2026-07-23T12:00:03.000Z",
      "    tokens: input=3000 output=500 cacheRead=1000 cacheCreation=0", "",
    ].join("\n"));

    const preview = await runCli(home, pairArguments("publication-preview", true));
    assert.deepEqual(JSON.parse(preview.stdout), {
      exactTaskClass: TASK_CLASS, directCodexProfileId: PROFILE, nextVersion: 1,
      acceptedCount: 1, rejectedCount: 1, pendingCount: 1,
      acceptedSampleIds: ["sample-a"], hasNewAcceptedEvidence: true, readiness: "ready",
    });
    const registered = await runCli(home, [
      "direct-codex", "publication-register", "--task-class", TASK_CLASS,
      "--profile-id", PROFILE, "--method", "paired-sample-v1",
      "--confidence", "low", "--created-at", TS, "--confirm",
    ]);
    assert.equal(registered.stdout, [
      "registered: true", `exactTaskClass: ${TASK_CLASS}`, `directCodexProfileId: ${PROFILE}`,
      "version: 1", "acceptedSampleCount: 1", "acceptedSampleIds: sample-a",
      "method: paired-sample-v1", "confidence: low", `createdAt: ${TS}`, "",
    ].join("\n"));
    const after = await runCli(home, pairArguments("publication-preview"));
    assert.match(after.stdout, /^exactTaskClass: edit-task\ndirectCodexProfileId: codex-main-v1\nreadiness: no-new-evidence\nnextVersion: 2\n/);
    assert.ok(!/saving|saved/i.test(`${mixed.stdout}${preview.stdout}${registered.stdout}${after.stdout}`));

    withStore(home, (store) => {
      for (const id of ["task-a", "task-b", "task-c", "task-other"]) {
        const receipts = store.listExchangeReceipts(id);
        assert.equal(receipts.length, 1, `${id} must have only its capture receipt`);
        assert.equal(receipts[0]!.operation, "forklight_direct_codex_capture");
        assert.equal(receipts[0]!.taskId, id);
      }
      assert.equal(store.latestDirectCodexProfilePublication(TASK_CLASS, PROFILE)?.calibration.version, 1);
    });
  } finally {
    await daemon.close();
  }
});

test("direct-codex CLI rejects missing confirmation and content-bearing review flags before mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-direct-cli-confirm-"));
  seedTask(home, "task-confirm");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const captured = await runCli(home, captureArguments(
      metadata("sample-confirm", "task-confirm", "2026-07-23T12:00:01.000Z"),
    ));
    assert.equal(captured.exitCode, 0);

    const secret = "private-review-note-DELTA";
    const contentBearing = await runCli(home, [
      ...reviewArguments("sample-confirm", "accepted", true), "--notes", secret,
    ]);
    assertFixedFailure(contentBearing, "Invalid direct-codex arguments", secret);
    const missingReviewConfirm = await runCli(home, reviewArguments("sample-confirm", "accepted", false));
    assertFixedFailure(missingReviewConfirm, "Direct Codex review requires explicit --confirm");
    withStore(home, (store) => {
      assert.equal(store.getDirectCodexSampleReviewOptional("sample-confirm"), undefined);
      assert.equal(store.listExchangeReceipts("task-confirm").length, 1);
    });

    assert.equal((await runCli(home, reviewArguments("sample-confirm", "accepted", true))).exitCode, 0);
    const missingRegisterConfirm = await runCli(home, [
      "direct-codex", "publication-register", "--task-class", TASK_CLASS,
      "--profile-id", PROFILE, "--method", "paired-sample-v1",
      "--confidence", "low", "--created-at", TS,
    ]);
    assertFixedFailure(
      missingRegisterConfirm,
      "Direct Codex publication registration requires explicit --confirm",
    );
    withStore(home, (store) => {
      assert.equal(store.latestDirectCodexProfilePublication(TASK_CLASS, PROFILE), undefined);
      assert.equal(store.listExchangeReceipts("task-confirm").length, 1);
    });
  } finally {
    await daemon.close();
  }
});

test("direct-codex capture errors are fixed, non-echoing, duplicate-safe, and leave no partial evidence", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-direct-cli-privacy-"));
  seedTask(home, "task-private");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const goodMetadata = metadata("sample-private", "task-private", "2026-07-23T12:00:01.000Z");
    const secret = "private-capture-payload-OMEGA";
    const malformed = await runCli(home, [
      "direct-codex", "capture", "--usage", `{"secret":"${secret}`,
      "--metadata", JSON.stringify(goodMetadata),
    ]);
    assertFixedFailure(malformed, "Invalid --usage JSON object", secret);
    const invalidShape = await runCli(home, [
      "direct-codex", "capture", "--usage", "[]", "--metadata", JSON.stringify(goodMetadata),
    ]);
    assertFixedFailure(invalidShape, "Invalid --usage JSON object");
    const contentUsage = await runCli(home, [
      "direct-codex", "capture", "--usage", JSON.stringify({ ...USAGE, prompt: secret }),
      "--metadata", JSON.stringify(goodMetadata),
    ]);
    assertFixedFailure(contentUsage, "Invalid Codex terminal usage event", secret);
    const contentMetadata = await runCli(home, [
      "direct-codex", "capture", "--usage", JSON.stringify(USAGE),
      "--metadata", JSON.stringify({ ...goodMetadata, prompt: secret }),
    ]);
    assertFixedFailure(contentMetadata, "Invalid Codex paired sample metadata", secret);
    const duplicateFlag = await runCli(home, [
      ...captureArguments(goodMetadata), "--metadata", JSON.stringify({ prompt: secret }),
    ]);
    assertFixedFailure(duplicateFlag, "Invalid direct-codex arguments", secret);
    withStore(home, (store) => {
      assert.deepEqual(store.listDirectCodexPairedSamples(TASK_CLASS, PROFILE), []);
      assert.equal(store.listExchangeReceipts("task-private").length, 0);
    });

    assert.equal((await runCli(home, captureArguments(goodMetadata))).exitCode, 0);
    const duplicateSample = await runCli(home, captureArguments(goodMetadata));
    assertFixedFailure(duplicateSample, "Duplicate sample identity rejected");
    const badPair = await runCli(home, [
      "direct-codex", "inbox", "--task-class", TASK_CLASS,
      "--profile-id", `${secret}!`, "--json",
    ]);
    assertFixedFailure(badPair, "Invalid directCodexProfileId", secret);
    withStore(home, (store) => {
      assert.equal(store.listDirectCodexPairedSamples(TASK_CLASS, PROFILE).length, 1);
      assert.equal(store.listExchangeReceipts("task-private").length, 1);
    });
  } finally {
    await daemon.close();
  }
});

// --- Guided capture-task CLI tests ---

function captureTaskArguments(taskId: string, runRef: string, json = false): string[] {
  return [
    "direct-codex", "capture-task", "--task-id", taskId,
    "--run-ref", runRef, "--usage", JSON.stringify(USAGE),
    ...(json ? ["--json"] : []),
  ];
}

test("direct-codex capture-task CLI succeeds with human and JSON output, receipt attribution", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-direct-cli-gc-"));
  seedTask(home, "gc-a");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const humanResult = await runCli(home, captureTaskArguments("gc-a", "codex-run:gc-a"));
    assert.equal(humanResult.exitCode, 0);
    assert.equal(humanResult.stderr, "");
    assert.match(humanResult.stdout, /sampleId: /);
    assert.match(humanResult.stdout, /forklightTaskId: gc-a/);
    assert.match(humanResult.stdout, /source: codex-terminal-result/);
    assert.match(humanResult.stdout, /complete: true/);
    // Identity is store-derived; no metadata fields in output aside from runRef.
    assert.match(humanResult.stdout, /directRunRef: codex-run:gc-a/);

    const jsonResult = await runCli(home, captureTaskArguments("gc-a", "codex-run:gc-a-json", true));
    assert.equal(jsonResult.exitCode, 0);
    const parsed = JSON.parse(jsonResult.stdout);
    assert.equal(parsed.forklightTaskId, "gc-a");
    assert.equal(parsed.exactTaskClass, TASK_CLASS);
    assert.equal(parsed.directCodexProfileId, PROFILE);
    assert.equal(parsed.directRunRef, "codex-run:gc-a-json");
    assert.equal(parsed.source, "codex-terminal-result");
    assert.equal(parsed.schemaVersion, 1);
    for (const raw of ["text", "content", "prompt", "response", "log", "diff", "hash", "secret"]) {
      assert.equal(raw in parsed, false, `output must not include "${raw}"`);
    }

    withStore(home, (store) => {
      const receipts = store.listExchangeReceipts("gc-a");
      assert.equal(receipts.length, 2);
      for (const receipt of receipts) {
        assert.equal(receipt.operation, "forklight_direct_codex_capture");
        assert.equal(receipt.taskId, "gc-a");
        assert.equal(receipt.transport, "cli");
      }
    });
  } finally {
    await daemon.close();
  }
});

test("direct-codex capture-task CLI errors are fixed, privacy-safe, and leave no partial evidence", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-direct-cli-gc-err-"));
  seedTask(home, "gc-err");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const secret = "gc-cli-secret-GAMMA";
    // Malformed usage JSON
    const malformed = await runCli(home, [
      "direct-codex", "capture-task", "--task-id", "gc-err",
      "--run-ref", "codex-run:ref", "--usage", `{"bad":`,
    ]);
    assertFixedFailure(malformed, "Invalid --usage JSON object", secret);
    // Usage JSON with extra content fields
    const contentUsage = await runCli(home, [
      "direct-codex", "capture-task", "--task-id", "gc-err",
      "--run-ref", "codex-run:ref", "--usage",
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 }, prompt: secret }),
    ]);
    assertFixedFailure(contentUsage, "Invalid Codex terminal usage event", secret);
    // Unknown task id
    const unknown = await runCli(home, [
      "direct-codex", "capture-task", "--task-id", `gc-unknown-${secret}`,
      "--run-ref", "codex-run:ref", "--usage", JSON.stringify(USAGE),
    ]);
    assertFixedFailure(unknown, "ForkLight Task not found for guided capture", secret);
    // Invalid runRef with content
    const badRef = await runCli(home, [
      "direct-codex", "capture-task", "--task-id", "gc-err",
      "--run-ref", secret, "--usage", JSON.stringify(USAGE),
    ]);
    assertFixedFailure(badRef, "Invalid direct-Codex paired sample", secret);
    // Duplicate flag
    const dup = await runCli(home, [
      ...captureTaskArguments("gc-err", "codex-run:ref"),
      "--run-ref", "codex-run:other",
    ]);
    assertFixedFailure(dup, "Invalid direct-codex arguments", "codex-run:other");

    withStore(home, (store) => {
      assert.deepEqual(store.listDirectCodexPairedSamples(TASK_CLASS, PROFILE), []);
      assert.equal(store.listExchangeReceipts("gc-err").length, 0);
    });

    // Successful capture writes receipt and sample
    assert.equal((await runCli(home, captureTaskArguments("gc-err", "codex-run:ok"))).exitCode, 0);
    // Duplicate sample via same task + runRef
    const dupSample = await runCli(home, captureTaskArguments("gc-err", "codex-run:ok"));
    assertFixedFailure(dupSample, "Duplicate sample identity rejected");

    withStore(home, (store) => {
      assert.equal(store.listDirectCodexPairedSamples(TASK_CLASS, PROFILE).length, 1);
      assert.equal(store.listExchangeReceipts("gc-err").length, 1);
    });
  } finally {
    await daemon.close();
  }
});
