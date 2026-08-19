import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { normalizeCodexTerminalUsage } from "../src/core/codex-terminal-usage.js";
import {
  CONTRADICTORY_IDENTITY,
  DUPLICATE_MAIN_USAGE,
  DUPLICATE_MAIN_USAGE_SEGMENT,
  INVALID_MAIN_USAGE_CAPTURE,
  INVALID_MAIN_USAGE_EPISODE,
  NOT_MAIN_USAGE_READY,
  TASK_NOT_FOUND_CAPTURE,
  captureMainUsage,
  captureMainUsageEpisode,
  readMainUsageStatus,
  type MainUsageSample,
  type MainUsageStatus,
} from "../src/core/main-token-usage.js";
import { captureCandidateRevision } from "../src/core/candidate-revision.js";
import { taskPaths } from "../src/core/config.js";
import { applyIntegration, preflightIntegration } from "../src/core/integration.js";
import {
  decideMainDelivery,
  prepareMainDelivery,
  type MainDeliveryHost,
} from "../src/core/main-delivery.js";
import { recordMainReview } from "../src/core/main-review.js";
import {
  createReviewGraph,
  getReviewGraphStatus,
} from "../src/core/review-graph.js";
import { SettingsService, type IntegrationSettings } from "../src/core/settings.js";
import { getTaskTokenReport } from "../src/core/token-report.js";
import type {
  AttemptRecord,
  IntegrationOperationView,
  TaskRecord,
  VerificationResult,
} from "../src/core/types.js";
import { buildTaskRecord } from "../src/core/runner.js";
import { parseTaskSpec } from "../src/core/task.js";
import { daemonRequest } from "../src/daemon/client.js";
import { ForkLightDaemon } from "../src/daemon/server.js";
import { createForkLightMcpServer } from "../src/mcp/server.js";
import { StateStore } from "../src/state/store.js";
import { prepareWorkspace } from "../src/workspace/copy.js";
import { createPathPolicy } from "../src/workspace/path-policy.js";
import { writeWorkspacePatchReport } from "../src/workspace/patch.js";

const ROOT = process.cwd();
const TS = "2026-08-17T12:00:00.000Z";
const TASK_CLASS = "edit-task";
const TASK_FAMILY = "forklight-storage-lifecycle";
const PROFILE = "codex-main-v1";
const COMPARISON = "cmp-edit-1";

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

const EXPECTED_COUNTERS = {
  inputTokens: 3000,
  outputTokens: 500,
  cacheReadInputTokens: 1000,
  cacheCreationInputTokens: 0,
  grossTokens: 4500,
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

function seedTask(
  home: string,
  id: string,
  extras: { taskClass?: string; taskFamily?: string; profileId?: string } = {},
): void {
  const store = new StateStore(home);
  try {
    const spec = parseTaskSpec({
      version: 1, name: id, project: "/tmp/source", goal: "Main usage test",
      ...(extras.taskClass === undefined ? {} : { taskClass: extras.taskClass }),
      ...(extras.taskFamily === undefined ? {} : { taskFamily: extras.taskFamily }),
      ...(extras.profileId === undefined ? {} : { directCodexProfileId: extras.profileId }),
      acceptance: { commands: ["true"] },
    }, "/tmp");
    store.createTask(buildTaskRecord({
      spec, taskFile: `/tmp/${id}.yaml`, home, id,
      sessionId: `session-${id}`, createdAt: TS,
    }));
  } finally {
    store.close();
  }
}

function seedReadyTask(home: string, id: string): void {
  seedTask(home, id, { taskClass: TASK_CLASS, taskFamily: TASK_FAMILY, profileId: PROFILE });
}

function countOnlyFields(sample: MainUsageSample): Record<string, unknown> {
  return {
    sampleId: sample.sampleId,
    forklightTaskId: sample.forklightTaskId,
    comparisonId: sample.comparisonId,
    role: sample.role,
    taskClass: sample.taskClass,
    taskFamily: sample.taskFamily,
    directCodexProfileId: sample.directCodexProfileId,
    inputTokens: sample.inputTokens,
    outputTokens: sample.outputTokens,
    cacheReadInputTokens: sample.cacheReadInputTokens,
    cacheCreationInputTokens: sample.cacheCreationInputTokens,
    grossTokens: sample.grossTokens,
    source: sample.source,
    runRef: sample.runRef,
    capturedAt: sample.capturedAt,
    schemaVersion: sample.schemaVersion,
    ...(sample.segments === undefined ? {} : {
      segments: sample.segments.map((segment) => ({
        ordinal: segment.ordinal,
        runRef: segment.runRef,
        inputTokens: segment.inputTokens,
        outputTokens: segment.outputTokens,
        cacheReadInputTokens: segment.cacheReadInputTokens,
        cacheCreationInputTokens: segment.cacheCreationInputTokens,
        grossTokens: segment.grossTokens,
      })),
    }),
  };
}

function terminalEvent(input: number, cached: number, cacheWrite: number, output: number, reasoning: number) {
  return {
    type: "turn.completed" as const,
    usage: {
      input_tokens: input,
      cached_input_tokens: cached,
      cache_write_input_tokens: cacheWrite,
      output_tokens: output,
      reasoning_output_tokens: reasoning,
    },
  };
}

function expectedCountersFromUsage(usage: unknown): {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  grossTokens: number;
} {
  const totals = normalizeCodexTerminalUsage(usage);
  return {
    inputTokens: totals.uncachedInputTokens,
    outputTokens: totals.totalOutputTokens,
    cacheReadInputTokens: totals.cacheReadInputTokens,
    cacheCreationInputTokens: totals.cacheCreationInputTokens,
    grossTokens: totals.uncachedInputTokens + totals.totalOutputTokens
      + totals.cacheReadInputTokens + totals.cacheCreationInputTokens,
  };
}

function sumExpected(
  usages: readonly unknown[],
): {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  grossTokens: number;
} {
  return usages.map(expectedCountersFromUsage).reduce((acc, part) => ({
    inputTokens: acc.inputTokens + part.inputTokens,
    outputTokens: acc.outputTokens + part.outputTokens,
    cacheReadInputTokens: acc.cacheReadInputTokens + part.cacheReadInputTokens,
    cacheCreationInputTokens: acc.cacheCreationInputTokens + part.cacheCreationInputTokens,
    grossTokens: acc.grossTokens + part.grossTokens,
  }), {
    inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0, grossTokens: 0,
  });
}

function assertCountOnlySample(sample: MainUsageSample, role: "direct-main" | "delegated-main", taskId: string): void {
  assert.equal(sample.role, role);
  assert.equal(sample.forklightTaskId, taskId);
  assert.equal(sample.comparisonId, COMPARISON);
  assert.equal(sample.taskClass, TASK_CLASS);
  assert.equal(sample.taskFamily, TASK_FAMILY);
  assert.equal(sample.directCodexProfileId, PROFILE);
  assert.equal(sample.inputTokens, EXPECTED_COUNTERS.inputTokens);
  assert.equal(sample.outputTokens, EXPECTED_COUNTERS.outputTokens);
  assert.equal(sample.cacheReadInputTokens, EXPECTED_COUNTERS.cacheReadInputTokens);
  assert.equal(sample.cacheCreationInputTokens, EXPECTED_COUNTERS.cacheCreationInputTokens);
  assert.equal(sample.grossTokens, EXPECTED_COUNTERS.grossTokens);
  assert.equal(sample.source, "codex-terminal-result");
  assert.equal(sample.schemaVersion, 1);
  assert.equal("reasoningOutputTokens" in sample, false);
  assert.equal("complete" in sample, false);
  for (const key of ["change", "saving", "savings", "quality", "familyValue", "prompt", "text"]) {
    assert.equal(key in sample, false);
  }
}

function snapshotTruth(home: string, taskId: string): {
  samples: number; events: number; receipts: number; tasks: number;
} {
  const store = new StateStore(home);
  try {
    return {
      samples: store.countMainUsageSamples(),
      events: store.listEvents(taskId).length,
      receipts: store.listExchangeReceipts(taskId).length,
      tasks: store.listTasks().length,
    };
  } finally {
    store.close();
  }
}

test("capture both roles through canonical counters and persist count-only samples", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4a-both-"));
  seedReadyTask(home, "task-ready");
  const store = new StateStore(home);
  try {
    const direct = captureMainUsage(store, {
      taskId: "task-ready", comparisonId: COMPARISON, role: "direct-main",
      runRef: "codex-run:direct-1", usage: USAGE,
    }, () => "mus-direct1", () => "2026-08-17T12:00:01.000Z");
    const delegated = captureMainUsage(store, {
      taskId: "task-ready", comparisonId: COMPARISON, role: "delegated-main",
      runRef: "codex-run:delegated-1", usage: USAGE,
    }, () => "mus-deleg1", () => "2026-08-17T12:00:02.000Z");

    assertCountOnlySample(direct, "direct-main", "task-ready");
    assertCountOnlySample(delegated, "delegated-main", "task-ready");
    assert.equal(direct.runRef, "codex-run:direct-1");
    assert.equal(delegated.runRef, "codex-run:delegated-1");
    assert.ok(Object.isFrozen(direct));
    assert.ok(Object.isFrozen(delegated));

    const listed = store.listMainUsageSamples("task-ready", COMPARISON);
    assert.equal(listed.length, 2);
    assert.deepEqual(countOnlyFields(listed[0]!), countOnlyFields(direct));
    assert.deepEqual(countOnlyFields(listed[1]!), countOnlyFields(delegated));

    const status = readMainUsageStatus(store, "task-ready", COMPARISON);
    assert.deepEqual(status.capturedRoles, ["direct-main", "delegated-main"]);
    assert.deepEqual(status.missingRoles, []);
    assert.equal(status.countComplete, true);
    assert.equal(status.taskClass, TASK_CLASS);
    assert.equal(status.taskFamily, TASK_FAMILY);
    assert.equal(status.directCodexProfileId, PROFILE);
    for (const key of ["change", "saving", "savings", "quality", "familyValue", "directCodexSavings"]) {
      assert.equal(key in status, false);
    }
  } finally {
    store.close();
  }
});

test("malformed, incomplete, extra-key, and content-bearing usage fail closed with no row", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4a-usage-"));
  seedReadyTask(home, "task-ready");
  const store = new StateStore(home);
  const secret = "sk-usage-SECRET-99";
  const params = {
    taskId: "task-ready", comparisonId: COMPARISON, role: "direct-main" as const,
    runRef: "codex-run:bad-1",
  };
  try {
    const before = store.countMainUsageSamples();
    const bad: unknown[] = [
      { ...params, usage: { ...USAGE, prompt: secret } },
      { ...params, usage: { type: "turn.completed", usage: { ...USAGE.usage, extra: 1 } } },
      { ...params, usage: { type: "turn.completed", usage: { ...USAGE.usage, cached_input_tokens: 5000 } } },
      { ...params, usage: { type: "turn.completed", usage: { ...USAGE.usage, reasoning_output_tokens: 900 } } },
      { ...params, usage: { type: "turn.started", usage: USAGE.usage } },
      { ...params, usage: null },
    ];
    for (const input of bad) {
      assert.throws(() => captureMainUsage(store, input), (e: unknown) => {
        assert.ok(e instanceof TypeError);
        assert.ok(!String(e).includes(secret));
        return true;
      });
    }
    assert.equal(store.countMainUsageSamples(), before);
  } finally {
    store.close();
  }
});

test("missing Task identity and caller-supplied identity fail before persist", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4a-ident-"));
  seedTask(home, "no-family", { taskClass: TASK_CLASS, profileId: PROFILE });
  seedTask(home, "no-profile", { taskClass: TASK_CLASS, taskFamily: TASK_FAMILY });
  seedReadyTask(home, "task-ready");
  const store = new StateStore(home);
  try {
    assert.throws(() => captureMainUsage(store, {
      taskId: "no-family", comparisonId: COMPARISON, role: "direct-main",
      runRef: "codex-run:nf", usage: USAGE,
    }), { name: "TypeError", message: NOT_MAIN_USAGE_READY });
    assert.throws(() => captureMainUsage(store, {
      taskId: "no-profile", comparisonId: "cmp-np", role: "direct-main",
      runRef: "codex-run:np", usage: USAGE,
    }), { name: "TypeError", message: NOT_MAIN_USAGE_READY });
    assert.throws(() => captureMainUsage(store, {
      taskId: "missing-task", comparisonId: COMPARISON, role: "direct-main",
      runRef: "codex-run:miss", usage: USAGE,
    }), { name: "TypeError", message: TASK_NOT_FOUND_CAPTURE });
    assert.throws(() => captureMainUsage(store, {
      taskId: "task-ready", comparisonId: COMPARISON, role: "direct-main",
      runRef: "codex-run:ovr", usage: USAGE, taskFamily: "spoofed-family",
    }), { name: "TypeError", message: CONTRADICTORY_IDENTITY });
    assert.throws(() => captureMainUsage(store, {
      taskId: "task-ready", comparisonId: COMPARISON, role: "direct-main",
      runRef: "codex-run:ovr2", usage: USAGE, taskClass: "other-class",
    }), { name: "TypeError", message: CONTRADICTORY_IDENTITY });
    assert.throws(() => captureMainUsage(store, {
      taskId: "task-ready", comparisonId: COMPARISON, role: "direct-main",
      runRef: "codex-run:ovr3", usage: USAGE, directCodexProfileId: "other-prof",
    }), { name: "TypeError", message: CONTRADICTORY_IDENTITY });
    assert.equal(store.countMainUsageSamples(), 0);
  } finally {
    store.close();
  }
});

test("duplicate role, sample id, and run ref leave existing sample unchanged", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4a-dup-"));
  seedReadyTask(home, "task-ready");
  const store = new StateStore(home);
  try {
    const first = captureMainUsage(store, {
      taskId: "task-ready", comparisonId: COMPARISON, role: "direct-main",
      runRef: "codex-run:orig", usage: USAGE,
    }, () => "mus-orig", () => "2026-08-17T12:00:01.000Z");
    const original = JSON.stringify(store.getMainUsageSample("mus-orig"));

    assert.throws(() => captureMainUsage(store, {
      taskId: "task-ready", comparisonId: COMPARISON, role: "direct-main",
      runRef: "codex-run:dup-role", usage: USAGE,
    }, () => "mus-duprole", () => "2026-08-17T12:00:02.000Z"),
    { name: "TypeError", message: DUPLICATE_MAIN_USAGE });

    assert.throws(() => captureMainUsage(store, {
      taskId: "task-ready", comparisonId: COMPARISON, role: "delegated-main",
      runRef: "codex-run:orig", usage: USAGE,
    }, () => "mus-duprun", () => "2026-08-17T12:00:03.000Z"),
    { name: "TypeError", message: DUPLICATE_MAIN_USAGE });

    assert.throws(() => captureMainUsage(store, {
      taskId: "task-ready", comparisonId: COMPARISON, role: "delegated-main",
      runRef: "codex-run:other", usage: USAGE,
    }, () => "mus-orig", () => "2026-08-17T12:00:04.000Z"),
    { name: "TypeError", message: DUPLICATE_MAIN_USAGE });

    assert.equal(JSON.stringify(store.getMainUsageSample("mus-orig")), original);
    assert.equal(store.countMainUsageSamples(), 1);
    assert.deepEqual(countOnlyFields(store.getMainUsageSample("mus-orig")), countOnlyFields(first));
  } finally {
    store.close();
  }
});

test("status is read-only for zero and one roles and never claims savings", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4a-status-"));
  seedReadyTask(home, "task-ready");
  const store = new StateStore(home);
  try {
    const emptyA = readMainUsageStatus(store, "task-ready", COMPARISON);
    const emptyB = readMainUsageStatus(store, "task-ready", COMPARISON);
    assert.deepEqual(emptyA.capturedRoles, []);
    assert.deepEqual(emptyA.missingRoles, ["direct-main", "delegated-main"]);
    assert.equal(emptyA.countComplete, false);
    assert.deepEqual(emptyA, emptyB);
    const before = snapshotTruth(home, "task-ready");

    captureMainUsage(store, {
      taskId: "task-ready", comparisonId: COMPARISON, role: "direct-main",
      runRef: "codex-run:one", usage: USAGE,
    }, () => "mus-one", () => "2026-08-17T12:00:01.000Z");
    const afterCapture = snapshotTruth(home, "task-ready");
    assert.equal(afterCapture.samples, before.samples + 1);

    const oneA = readMainUsageStatus(store, "task-ready", COMPARISON);
    const oneB = readMainUsageStatus(store, "task-ready", COMPARISON);
    assert.deepEqual(oneA.capturedRoles, ["direct-main"]);
    assert.deepEqual(oneA.missingRoles, ["delegated-main"]);
    assert.equal(oneA.countComplete, false);
    assert.deepEqual(oneA, oneB);
    assert.deepEqual(snapshotTruth(home, "task-ready"), afterCapture);
    for (const key of ["change", "saving", "savings", "quality", "familyValue"]) {
      assert.equal(key in oneA, false);
      assert.equal(key in emptyA, false);
    }
  } finally {
    store.close();
  }
});

test("Store, Daemon, CLI --json, and MCP agree on the same count-only fields", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4a-agree-"));
  seedReadyTask(home, "task-ready");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-m4a", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const captured = await daemonRequest<MainUsageSample>("main_token_capture", {
      taskId: "task-ready", comparisonId: COMPARISON, role: "direct-main",
      runRef: "codex-run:agree-d", usage: USAGE,
    }, home);
    await daemonRequest<MainUsageSample>("main_token_capture", {
      taskId: "task-ready", comparisonId: COMPARISON, role: "delegated-main",
      runRef: "codex-run:agree-m", usage: USAGE,
    }, home);

    const store = new StateStore(home);
    const storeStatus = readMainUsageStatus(store, "task-ready", COMPARISON);
    store.close();

    const daemonStatus = await daemonRequest<MainUsageStatus>("main_token_status", {
      taskId: "task-ready", comparisonId: COMPARISON,
    }, home);

    const cli = await runCli(home, [
      "main-token", "status", "--task-id", "task-ready",
      "--comparison-id", COMPARISON, "--json",
    ]);
    assert.equal(cli.exitCode, 0, cli.stderr);
    const cliStatus = JSON.parse(cli.stdout) as MainUsageStatus;

    const mcp = await client.callTool({
      name: "forklight_main_token_status",
      arguments: { taskId: "task-ready", comparisonId: COMPARISON },
    });
    assert.equal(mcp.isError, undefined);
    const mcpStatus = mcp.structuredContent as MainUsageStatus;

    for (const status of [storeStatus, daemonStatus, cliStatus, mcpStatus]) {
      assert.deepEqual(status.capturedRoles, ["direct-main", "delegated-main"]);
      assert.deepEqual(status.missingRoles, []);
      assert.equal(status.countComplete, true);
      assert.equal(status.samples.length, 2);
      assert.equal(status.taskClass, TASK_CLASS);
      assert.equal(status.taskFamily, TASK_FAMILY);
      assert.equal(status.directCodexProfileId, PROFILE);
      for (const key of ["change", "saving", "savings", "quality", "familyValue"]) {
        assert.equal(key in status, false);
      }
      assertCountOnlySample(status.samples[0] as MainUsageSample, "direct-main", "task-ready");
      assertCountOnlySample(status.samples[1] as MainUsageSample, "delegated-main", "task-ready");
    }
    assert.deepEqual(countOnlyFields(storeStatus.samples[0] as MainUsageSample), countOnlyFields(captured));
    assert.deepEqual(
      countOnlyFields(daemonStatus.samples[0] as MainUsageSample),
      countOnlyFields(cliStatus.samples[0] as MainUsageSample),
    );
    assert.deepEqual(
      countOnlyFields(cliStatus.samples[0] as MainUsageSample),
      countOnlyFields(mcpStatus.samples[0] as MainUsageSample),
    );
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

test("legacy tokens and direct-codex surfaces stay separate from Main usage samples", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4a-legacy-"));
  seedReadyTask(home, "task-ready");
  const store = new StateStore(home);
  try {
    captureMainUsage(store, {
      taskId: "task-ready", comparisonId: COMPARISON, role: "direct-main",
      runRef: "codex-run:legacy", usage: USAGE,
    }, () => "mus-legacy", () => "2026-08-17T12:00:01.000Z");
    const report = getTaskTokenReport(store, "task-ready");
    assert.equal("directCodexSavings" in report.report, true);
    assert.equal(store.listDirectCodexPairedSamples(TASK_CLASS, PROFILE).length, 0);
    const status = readMainUsageStatus(store, "task-ready", COMPARISON);
    assert.equal("directCodexSavings" in status, false);
    assert.equal(status.samples[0]!.sampleId, "mus-legacy");
  } finally {
    store.close();
  }
});

const SEGMENT_A = terminalEvent(4000, 1000, 200, 500, 100);
const SEGMENT_B = terminalEvent(2500, 800, 100, 400, 80);

function episodeRequest(
  taskId: string,
  comparisonId: string,
  role: "direct-main" | "delegated-main",
  episodeRef: string,
  segments: ReadonlyArray<{ runRef: string; usage: unknown }>,
) {
  return { taskId, comparisonId, role, runRef: episodeRef, segments };
}

test("episode capture persists one aggregate sample and survives Store reopen", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4e-ep-"));
  seedReadyTask(home, "task-ready");
  const opened = new StateStore(home);
  let store: StateStore | undefined = opened;
  try {
    const segments = [
      { runRef: "codex-run:dispatch", usage: SEGMENT_A },
      { runRef: "codex-run:decide", usage: SEGMENT_B },
    ];
    const expected = sumExpected(segments.map((segment) => segment.usage));
    const captured = captureMainUsageEpisode(
      opened,
      episodeRequest("task-ready", COMPARISON, "delegated-main", "codex-run:episode-1", segments),
      () => "mus-episode1",
      () => "2026-08-18T12:00:01.000Z",
    );
    assert.equal(opened.countMainUsageSamples(), 1);
    assert.equal(captured.schemaVersion, 2);
    assert.equal(captured.role, "delegated-main");
    assert.equal(captured.runRef, "codex-run:episode-1");
    assert.equal(captured.inputTokens, expected.inputTokens);
    assert.equal(captured.outputTokens, expected.outputTokens);
    assert.equal(captured.cacheReadInputTokens, expected.cacheReadInputTokens);
    assert.equal(captured.cacheCreationInputTokens, expected.cacheCreationInputTokens);
    assert.equal(captured.grossTokens, expected.grossTokens);
    assert.notEqual(captured.segments, undefined);
    const capturedSegments = captured.segments!;
    assert.equal(capturedSegments.length, 2);
    assert.equal(capturedSegments[0]!.ordinal, 1);
    assert.equal(capturedSegments[0]!.runRef, "codex-run:dispatch");
    assert.equal(capturedSegments[1]!.ordinal, 2);
    assert.equal(capturedSegments[1]!.runRef, "codex-run:decide");
    const firstExpected = expectedCountersFromUsage(SEGMENT_A);
    const secondExpected = expectedCountersFromUsage(SEGMENT_B);
    assert.equal(capturedSegments[0]!.inputTokens, firstExpected.inputTokens);
    assert.equal(capturedSegments[0]!.outputTokens, firstExpected.outputTokens);
    assert.equal(capturedSegments[0]!.cacheReadInputTokens, firstExpected.cacheReadInputTokens);
    assert.equal(capturedSegments[0]!.cacheCreationInputTokens, firstExpected.cacheCreationInputTokens);
    assert.equal(capturedSegments[0]!.grossTokens, firstExpected.grossTokens);
    assert.equal(capturedSegments[1]!.inputTokens, secondExpected.inputTokens);
    assert.equal(capturedSegments[1]!.grossTokens, secondExpected.grossTokens);
    assert.equal("reasoningOutputTokens" in captured, false);
    assert.equal("prompt" in captured, false);
    assert.equal("saving" in captured, false);
    assert.equal("content" in captured, false);
    const persisted = JSON.stringify(countOnlyFields(opened.getMainUsageSample("mus-episode1")));
    opened.close();
    store = undefined;
    const reopened = new StateStore(home);
    try {
      const again = reopened.getMainUsageSample("mus-episode1");
      assert.equal(JSON.stringify(countOnlyFields(again)), persisted);
      assert.deepEqual(countOnlyFields(again), countOnlyFields(captured));
      const listed = reopened.listMainUsageSamples("task-ready", COMPARISON);
      assert.equal(listed.length, 1);
      assert.equal(listed[0]!.schemaVersion, 2);
      assert.equal(listed[0]!.segments?.length, 2);
    } finally {
      reopened.close();
    }
  } finally {
    if (store !== undefined) store.close();
  }
});

test("single-run capture stays schema-version-1 without segments", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4e-v1-"));
  seedReadyTask(home, "task-ready");
  const store = new StateStore(home);
  try {
    const sample = captureMainUsage(store, {
      taskId: "task-ready", comparisonId: COMPARISON, role: "direct-main",
      runRef: "codex-run:single", usage: USAGE,
    }, () => "mus-single", () => "2026-08-18T12:00:01.000Z");
    assertCountOnlySample(sample, "direct-main", "task-ready");
    assert.equal(sample.schemaVersion, 1);
    assert.equal("segments" in sample, false);
    const raw = JSON.parse(JSON.stringify(store.getMainUsageSample("mus-single"))) as Record<string, unknown>;
    assert.equal(raw.schemaVersion, 1);
    assert.equal("segments" in raw, false);
  } finally {
    store.close();
  }
});

test("malformed episode input fails closed with no partial row", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4e-bad-"));
  seedReadyTask(home, "task-ready");
  seedReadyTask(home, "task-other");
  const store = new StateStore(home);
  const secret = "sk-episode-SECRET-77";
  const valid = [
    { runRef: "codex-run:a", usage: SEGMENT_A },
    { runRef: "codex-run:b", usage: SEGMENT_B },
  ];
  const base = episodeRequest("task-ready", COMPARISON, "delegated-main", "codex-run:ep-bad", valid);
  try {
    const before = store.countMainUsageSamples();
    const cases: Array<{ input: unknown; message?: string }> = [
      { input: { ...base, segments: [{ runRef: "codex-run:a", usage: { ...SEGMENT_A, prompt: secret } }, valid[1]] } },
      { input: { ...base, segments: [{ runRef: "codex-run:a", usage: { type: "turn.started", usage: SEGMENT_A.usage } }, valid[1]] } },
      { input: { ...base, segments: [{ runRef: "codex-run:a", usage: SEGMENT_A, content: secret }, valid[1]] } },
      { input: { ...base, segments: [valid[0], { runRef: "codex-run:a", usage: SEGMENT_B }] }, message: DUPLICATE_MAIN_USAGE_SEGMENT },
      {
        input: {
          ...base,
          segments: [
            valid[0],
            {
              runRef: "codex-run:b",
              usage: terminalEvent(1000, 2000, 0, 10, 0),
            },
          ],
        },
      },
      {
        input: {
          ...base,
          segments: [
            valid[0],
            {
              runRef: "codex-run:b",
              usage: terminalEvent(1000, 0, 0, 10, 20),
            },
          ],
        },
      },
      { input: { ...base, taskClass: "spoofed" }, message: CONTRADICTORY_IDENTITY },
      { input: { ...base, segments: [valid[0]] }, message: INVALID_MAIN_USAGE_EPISODE },
      { input: { ...base, usage: SEGMENT_A }, message: INVALID_MAIN_USAGE_CAPTURE },
      { input: { ...base, prompt: secret }, message: INVALID_MAIN_USAGE_CAPTURE },
      { input: { ...base, taskId: "missing-task" }, message: TASK_NOT_FOUND_CAPTURE },
    ];
    for (const item of cases) {
      assert.throws(() => captureMainUsageEpisode(store, item.input), (error: unknown) => {
        assert.ok(error instanceof TypeError);
        assert.ok(!String(error).includes(secret));
        if (item.message !== undefined) assert.equal(error.message, item.message);
        return true;
      });
    }
    const overflow = episodeRequest("task-ready", "cmp-overflow", "delegated-main", "codex-run:ep-ovf", [
      { runRef: "codex-run:ovf-a", usage: terminalEvent(Number.MAX_SAFE_INTEGER - 10, 0, 0, 5, 0) },
      { runRef: "codex-run:ovf-b", usage: terminalEvent(Number.MAX_SAFE_INTEGER - 10, 0, 0, 5, 0) },
    ]);
    assert.throws(() => captureMainUsageEpisode(store, overflow), (error: unknown) => {
      assert.ok(error instanceof TypeError);
      assert.equal(error.message, INVALID_MAIN_USAGE_EPISODE);
      return true;
    });
    captureMainUsageEpisode(
      store,
      episodeRequest("task-ready", COMPARISON, "delegated-main", "codex-run:ep-ok", valid),
      () => "mus-ep-ok",
      () => "2026-08-18T12:00:02.000Z",
    );
    assert.throws(() => captureMainUsageEpisode(
      store,
      episodeRequest("task-ready", COMPARISON, "delegated-main", "codex-run:ep-dup", [
        { runRef: "codex-run:z1", usage: SEGMENT_A },
        { runRef: "codex-run:z2", usage: SEGMENT_B },
      ]),
    ), { name: "TypeError", message: DUPLICATE_MAIN_USAGE });
    assert.throws(() => captureMainUsageEpisode(
      store,
      episodeRequest("task-other", COMPARISON, "direct-main", "codex-run:ep-id", [
        { runRef: "codex-run:o1", usage: SEGMENT_A },
        { runRef: "codex-run:o2", usage: SEGMENT_B },
      ]),
    ), { name: "TypeError", message: CONTRADICTORY_IDENTITY });
    assert.equal(store.countMainUsageSamples(), before + 1);
  } finally {
    store.close();
  }
});

test("Store, Daemon, CLI, and MCP agree on episode count-only fields", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4e-agree-"));
  seedReadyTask(home, "task-ready");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const server = createForkLightMcpServer(home);
  const client = new Client({ name: "forklight-m4e", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const segments = [
    { runRef: "codex-run:agree-a", usage: SEGMENT_A },
    { runRef: "codex-run:agree-b", usage: SEGMENT_B },
  ];
  const expected = sumExpected(segments.map((segment) => segment.usage));
  try {
    const captured = await daemonRequest<MainUsageSample>("main_token_capture_episode", {
      taskId: "task-ready", comparisonId: COMPARISON, role: "delegated-main",
      runRef: "codex-run:agree-ep", segments,
    }, home);
    assert.equal(captured.inputTokens, expected.inputTokens);
    assert.equal(captured.grossTokens, expected.grossTokens);
    assert.equal(captured.segments?.length, 2);

    const store = new StateStore(home);
    const storeStatus = readMainUsageStatus(store, "task-ready", COMPARISON);
    store.close();

    const daemonStatus = await daemonRequest<MainUsageStatus>("main_token_status", {
      taskId: "task-ready", comparisonId: COMPARISON,
    }, home);
    const cli1 = await runCli(home, [
      "main-token", "status", "--task-id", "task-ready",
      "--comparison-id", COMPARISON, "--json",
    ]);
    const cli2 = await runCli(home, [
      "main-token", "status", "--task-id", "task-ready",
      "--comparison-id", COMPARISON, "--json",
    ]);
    assert.equal(cli1.exitCode, 0, cli1.stderr);
    assert.equal(cli2.stdout, cli1.stdout);
    const cliStatus = JSON.parse(cli1.stdout) as MainUsageStatus;
    const mcp1 = await client.callTool({
      name: "forklight_main_token_status",
      arguments: { taskId: "task-ready", comparisonId: COMPARISON },
    });
    const mcp2 = await client.callTool({
      name: "forklight_main_token_status",
      arguments: { taskId: "task-ready", comparisonId: COMPARISON },
    });
    assert.equal(mcp1.isError, undefined);
    assert.deepEqual(mcp1.structuredContent, mcp2.structuredContent);
    const mcpStatus = mcp1.structuredContent as MainUsageStatus;

    for (const status of [storeStatus, daemonStatus, cliStatus, mcpStatus]) {
      assert.deepEqual(status.capturedRoles, ["delegated-main"]);
      assert.equal(status.samples.length, 1);
      assert.equal("saving" in status, false);
      assert.equal("change" in status, false);
      const sample = status.samples[0] as MainUsageSample;
      assert.deepEqual(countOnlyFields(sample), countOnlyFields(captured));
      assert.equal(sample.segments?.length, 2);
      assert.equal(sample.segments?.[0]?.runRef, "codex-run:agree-a");
      assert.equal(sample.inputTokens, expected.inputTokens);
      assert.equal(sample.grossTokens, expected.grossTokens);
      assert.equal("prompt" in sample, false);
      assert.equal("content" in sample, false);
    }
  } finally {
    await client.close();
    await server.close();
    await daemon.close();
  }
});

const DELIVERY_INTEGRATION: IntegrationSettings = {
  reviewedPatchMaxFiles: 5,
  reviewedPatchMaxLines: 400,
  reviewReceiptTtlMs: 900_000,
  verificationTimeoutMs: 30_000,
  backupRetentionCount: 3,
  autoRollback: true,
};

async function buildUsageReadyDelivery(): Promise<{
  store: StateStore;
  settings: SettingsService;
  task: TaskRecord;
  revisionId: string;
  digest: string;
  profileId: string;
  secondProfileId: string;
}> {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4e-offline-"));
  const sourceDir = path.join(home, "source");
  await mkdir(path.join(sourceDir, "src"), { recursive: true });
  await writeFile(path.join(sourceDir, "readme.md"), "# hello\n\nOriginal.\n");
  await writeFile(path.join(sourceDir, "src/app.ts"), "export const n = 1;\n");
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const snap = settings.get();
  const profileId = snap.workerProfiles.defaultProfileId;
  const second = snap.workerProfiles.profiles.find((profile) => profile.id !== profileId);
  assert.ok(second);
  const taskId = `offline-${randomUUID()}`;
  const paths = taskPaths(home, taskId);
  const spec: TaskRecord["spec"] = {
    version: 1,
    name: "Offline delivery",
    project: sourceDir,
    goal: "Ship a small change",
    constraints: [],
    taskClass: TASK_CLASS,
    taskFamily: TASK_FAMILY,
    directCodexProfileId: PROFILE,
    provider: {
      name: "deepseek",
      model: "deepseek-v4-flash",
      keychainService: "forklight.deepseek.api-key",
    },
    runtime: {
      name: "claude-code",
      executable: "claude",
      effort: "low",
      maxBudgetUsd: 0.1,
    },
    workspace: { exclude: [".git", "node_modules"] },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src", "readme.md"] },
    acceptance: { commands: ["true"] },
    reviewRequirement: {
      requiredJudges: 2,
      reason: "Two independent views of this Candidate",
    },
  };
  await prepareWorkspace(spec, paths);
  await mkdir(path.join(paths.workspace, "src"), { recursive: true });
  await writeFile(path.join(paths.workspace, "readme.md"), "# hello\n\nChanged.\n");
  await writeFile(path.join(paths.workspace, "src/app.ts"), "export const n = 2;\n");
  await writeWorkspacePatchReport(paths, createPathPolicy(spec));
  const now = new Date().toISOString();
  const task: TaskRecord = {
    id: taskId,
    name: spec.name,
    status: "succeeded",
    sourcePath: sourceDir,
    taskFile: "forklight://test/main-offline-episode",
    spec,
    paths,
    sessionId: "session-1",
    currentAttemptId: "attempt-1",
    createdAt: now,
    updatedAt: now,
  };
  store.createTask(task);
  const attempt: AttemptRecord = {
    id: "attempt-1",
    taskId,
    ordinal: 1,
    status: "succeeded",
    sessionId: task.sessionId,
    rawLogPath: path.join(paths.logs, "attempt-1.jsonl"),
    startedAt: now,
    finishedAt: now,
    exitCode: 0,
  };
  store.createAttempt(attempt);
  const verification: VerificationResult = {
    passed: true,
    behaviorPassed: true,
    policyPassed: true,
    sourceCompatible: true,
    commands: [{
      command: "true",
      exitCode: 0,
      stdout: "SECRET-STDOUT-MUST-NOT-LEAK",
      stderr: "",
      durationMs: 1,
      timedOut: false,
    }],
    diffPath: paths.diff,
    sourceUnchanged: true,
  };
  const verEvent = store.addEvent(
    taskId, attempt.id, "verification.completed", "Independent verification passed", verification,
  );
  const revision = await captureCandidateRevision(
    store, store.getTask(taskId), attempt, verEvent.sequence, true,
    ["readme.md", "src/app.ts"], 2, 4,
  );
  return {
    store,
    settings,
    task: store.getTask(taskId),
    revisionId: revision.id,
    digest: revision.patchDigest,
    profileId,
    secondProfileId: second.id,
  };
}

function makeOfflineHost(
  fx: Awaited<ReturnType<typeof buildUsageReadyDelivery>>,
  options: { now?: { value: number }; onSleep?: () => Promise<void> } = {},
): MainDeliveryHost {
  const clock = options.now ?? { value: 0 };
  const pending = new Map<string, {
    taskId: string;
    receiptId: string;
    run: () => Promise<unknown>;
    started?: Promise<unknown>;
  }>();
  return {
    store: fx.store,
    submitFile: async () => {
      throw new Error("submitFile should not run for existing-task tests");
    },
    createReviewGraph: async (input) => createReviewGraph(fx.store, fx.settings.get(), {
      candidateTaskId: input.taskId,
      reviewerWorkerProfileIds: input.reviewerWorkerProfileIds,
      reason: input.reason,
      confirm: true,
    }),
    recordMainReview: (taskId, decision, reason, confirm) =>
      recordMainReview(fx.store, taskId, { decision, reason, confirm }),
    preflightIntegration: (taskId) => preflightIntegration(fx.store, taskId, DELIVERY_INTEGRATION),
    startIntegration: (taskId, receiptId) => {
      const operationId = randomUUID();
      fx.store.addEvent(taskId, undefined, "integration.operation.started", "Integration operation started", {
        operationId, taskId, receiptId,
      });
      const run = () => applyIntegration(fx.store, taskId, receiptId, DELIVERY_INTEGRATION, operationId);
      pending.set(operationId, { taskId, receiptId, run, started: run() });
      return { operationId, taskId, receiptId, status: "running", stages: [] };
    },
    waitIntegration: async (operationId) => {
      const item = pending.get(operationId);
      if (item !== undefined) {
        if (item.started === undefined) item.started = item.run();
        await item.started;
      }
      const result = fx.store.getIntegrationResult(operationId);
      if (result === undefined) {
        return { operationId, taskId: fx.task.id, receiptId: "", status: "running", stages: [] };
      }
      const view: IntegrationOperationView = {
        operationId,
        taskId: result.taskId,
        receiptId: result.receiptId,
        status: result.status === "applied" ? "completed" : "failed",
        stages: result.stages ?? [],
        result,
      };
      return view;
    },
    findIntegration: (taskId) => {
      const results = fx.store.listIntegrationResults(taskId);
      const first = results[0];
      if (first !== undefined) return { operationId: first.id, receiptId: first.receiptId };
      return undefined;
    },
    findLatestReceipt: (taskId) => {
      let latestId: string | undefined;
      for (const event of fx.store.listEvents(taskId)) {
        if (event.type !== "integration.preflight.completed") continue;
        const receiptId = (event.payload as { receiptId?: unknown })?.receiptId;
        if (typeof receiptId === "string") latestId = receiptId;
      }
      return latestId === undefined ? undefined : fx.store.getIntegrationReceipt(latestId);
    },
    sleep: async (milliseconds) => {
      clock.value += milliseconds;
      if (options.onSleep !== undefined) await options.onSleep();
    },
    now: () => clock.value,
    pollMs: 5,
    readDiff: async () => undefined,
  };
}

test("prepare timeout is observation-only; later re-entry and decide stay on one Task and count as one episode", async () => {
  const fx = await buildUsageReadyDelivery();
  try {
    const clock = { value: 0 };
    let finish = false;
    const host = makeOfflineHost(fx, {
      now: clock,
      onSleep: async () => {
        if (!finish) return;
        const graph = getReviewGraphStatus(fx.store, fx.task.id);
        if (graph === undefined) return;
        for (const assignment of graph.assignments) {
          if (assignment.status !== "queued") continue;
          const now = new Date().toISOString();
          const reviewer = fx.store.getTask(assignment.reviewerTaskId);
          const attemptId = `reviewer-attempt-${assignment.reviewerTaskId}`;
          fx.store.createAttempt({
            id: attemptId,
            taskId: assignment.reviewerTaskId,
            ordinal: 1,
            status: "succeeded",
            sessionId: reviewer.sessionId,
            rawLogPath: path.join(reviewer.paths.logs, "attempt-1.jsonl"),
            startedAt: now,
            finishedAt: now,
            exitCode: 0,
            resultText: JSON.stringify({
              schemaVersion: 1,
              reviewedRevisionId: fx.revisionId,
              proposedDisposition: "accept",
              summary: "Scoped change looks ready for Main",
              findings: [{
                severity: "info",
                evidencePath: "src/app.ts",
                affectedBehavior: "Counter increments differently",
                recommendation: "Confirm callers tolerate the new value",
              }],
            }),
          });
          fx.store.setTaskStatus(assignment.reviewerTaskId, "succeeded", {
            finishedAt: now,
            currentAttemptId: attemptId,
          });
        }
      },
    });
    const timedOut = await prepareMainDelivery(host, {
      taskId: fx.task.id,
      reviewerProfileIds: [fx.profileId, fx.secondProfileId],
      reason: "Need two independent views",
      timeoutMs: 15,
      confirm: true,
    });
    assert.equal(timedOut.observation.outcome, "timeout");
    assert.notEqual(fx.store.getTask(fx.task.id).status, "failed");
    const graphId = timedOut.review.graphId;
    assert.ok(graphId);
    const taskIdAfterTimeout = fx.store.getTask(fx.task.id).id;

    finish = true;
    clock.value = 0;
    const resumed = await prepareMainDelivery(host, {
      taskId: fx.task.id,
      reviewerProfileIds: [fx.profileId, fx.secondProfileId],
      reason: "Need two independent views",
      timeoutMs: 50,
      confirm: true,
    });
    assert.equal(resumed.observation.outcome, "ready");
    assert.equal(resumed.review.graphId, graphId);
    assert.equal(fx.store.getTask(fx.task.id).id, taskIdAfterTimeout);
    assert.equal(getReviewGraphStatus(fx.store, fx.task.id)?.id, graphId);

    const decided = await decideMainDelivery(host, {
      taskId: fx.task.id,
      decision: "accept",
      revisionId: fx.revisionId,
      digest: fx.digest,
      reason: "Exact Candidate is ready",
      timeoutMs: 5_000,
      confirm: true,
    });
    assert.equal(decided.observation.outcome, "ready");
    assert.equal(decided.task.id, fx.task.id);

    const episode = captureMainUsageEpisode(fx.store, episodeRequest(
      fx.task.id,
      "cmp-offline-1",
      "delegated-main",
      "codex-run:offline-episode",
      [
        { runRef: "codex-run:offline-dispatch", usage: SEGMENT_A },
        { runRef: "codex-run:offline-review", usage: SEGMENT_B },
        { runRef: "codex-run:offline-decide", usage: terminalEvent(1800, 400, 50, 250, 40) },
      ],
    ), () => "mus-offline", () => "2026-08-18T13:00:00.000Z");
    assert.equal(episode.forklightTaskId, fx.task.id);
    assert.equal(episode.segments?.length, 3);
    assert.equal(episode.segments?.[0]?.runRef, "codex-run:offline-dispatch");
    assert.equal(episode.segments?.[1]?.runRef, "codex-run:offline-review");
    assert.equal(episode.segments?.[2]?.runRef, "codex-run:offline-decide");
    const expected = sumExpected([
      SEGMENT_A, SEGMENT_B, terminalEvent(1800, 400, 50, 250, 40),
    ]);
    assert.equal(episode.grossTokens, expected.grossTokens);
    assert.equal(fx.store.countMainUsageSamples(), 1);
  } finally {
    fx.store.close();
  }
});
