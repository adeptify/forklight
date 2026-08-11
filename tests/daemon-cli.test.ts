import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { currentBuildIdentity } from "../src/core/build-identity.js";
import type { RoutingAdvisoryResponse } from "../src/core/model-routing.js";
import { daemonLogPath, daemonSocketPath } from "../src/core/config.js";
import { sleepMs as sleep } from "../src/core/time.js";
import { SELF_UPGRADE_DELIVERY_PROFILE_ID } from "../src/core/self-upgrade-evidence.js";
import type {
  DeliveryPlanView,
  IntegrationReceiptRecord,
  IntegrationResultRecord,
  TaskRecord,
} from "../src/core/types.js";
import {
  DEFAULT_DAEMON_STARTUP_TIMEOUT_MS,
  DAEMON_OBSERVER_UNAVAILABLE_MESSAGE,
  daemonObserverRequest,
  daemonRequest,
  isDaemonTransportUnavailable,
  restartDaemon,
  stopDaemon,
} from "../src/daemon/client.js";
import { ForkLightDaemon } from "../src/daemon/server.js";
import { StateStore } from "../src/state/store.js";
import { formatRoutingAdviceHuman } from "../src/cli/routing-output.js";
import {
  APPLICABILITY_REASON_MAX,
  humanIntegrationPreflightLines,
} from "../src/cli/integration-output.js";
import { DetachedDaemonFixture, probeSocketAlive } from "./helpers/detached-daemon.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// --- Running daemon restart ---

test("restart replaces a running daemon: old PID gone, new PID different, build identity matches", async () => {
  const fixture = await DetachedDaemonFixture.create("forklight-restart-running-");
  try {
    const firstHealth = await fixture.ensureReady();
    const firstPid = firstHealth.pid as number;
    assert.ok(Number.isSafeInteger(firstPid) && firstPid > 0, "first daemon must report a valid PID");
    assert.deepEqual(
      firstHealth.buildIdentity,
      currentBuildIdentity(),
      "first daemon build identity must match client",
    );

    const replacementHealth = await restartDaemon(fixture.home);
    const replacementPid = replacementHealth.pid as number;
    assert.ok(
      Number.isSafeInteger(replacementPid) && replacementPid > 0,
      "replacement daemon must report a valid PID",
    );
    // Register cleanup authority before any later assertion can abort the test.
    await fixture.adoptReplacement(replacementPid);
    assert.notEqual(
      replacementPid,
      firstPid,
      "replacement must have a different PID from the original",
    );
    assert.deepEqual(
      replacementHealth.buildIdentity,
      currentBuildIdentity(),
      "replacement daemon build identity must match client",
    );
    assert.throws(
      () => process.kill(firstPid, 0),
      /ESRCH/,
      "original daemon PID must be gone after restart",
    );
  } finally {
    await fixture.cleanup();
  }
});

// --- Stopped daemon restart ---

test("restart starts a daemon when none is running", async () => {
  const fixture = await DetachedDaemonFixture.create("forklight-restart-stopped-");
  try {
    // Verify no daemon is running on the fresh home.
    const stopResult = await stopDaemon(fixture.home);
    assert.equal(
      stopResult.stopped,
      true,
      "fresh home must report no running daemon",
    );

    const health = await restartDaemon(fixture.home);
    const pid = health.pid as number;
    if (Number.isSafeInteger(pid) && pid > 0) {
      await fixture.adoptReplacement(pid);
    }
    assert.ok(Number.isSafeInteger(pid) && pid > 0, "restart must start a daemon and report its PID");
    assert.equal(health.ok, true, "restarted daemon health must report ok");
    assert.deepEqual(
      health.buildIdentity,
      currentBuildIdentity(),
      "restarted daemon build identity must match client",
    );

  } finally {
    await fixture.cleanup();
  }
});

// --- Unknown daemon operation stays rejected ---

function cliArgs(...args: string[]): string[] {
  return [
    "--disable-warning=ExperimentalWarning",
    "--import",
    "tsx",
    path.join(root, "src", "cli.ts"),
    ...args,
  ];
}

test("unknown daemon operations are rejected with the existing error", async () => {
  const { stderr } = await execFileAsync(
    process.execPath,
    cliArgs("daemon", "force-restart"),
    { cwd: root, timeout: 15_000 },
  ).catch((error: unknown) => {
    // execFile rejects when exitCode !== 0 — capture stdout/stderr from the error.
    const execError = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      code: execError.code ?? 1,
    };
  });
  assert.match(
    stderr,
    /Unknown daemon operation: force-restart/,
    "unknown daemon operation must produce the canonical error message",
  );
});

test("routing CLI requires exactly one of --candidates or --profiles before daemon contact", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-routing-cli-mix-"));
  try {
    // Both present → mutually exclusive, no daemon socket created.
    const both = await runCli(home, [
      "routing", "some-class",
      "--candidates", '[{"provider":"deepseek","model":"v4"},{"provider":"qwen","model":"plus"}]',
      "--profiles", '["deepseek-primary","qwen-secondary"]',
    ]);
    assert.notEqual(both.code, 0);
    assert.match(both.stderr, /mutually exclusive/);
    assert.equal(existsSync(daemonSocketPath(home)), false, "mutual-exclusion failure must not start a daemon");

    // Neither present → canonical missing-flag guidance.
    const neither = await runCli(home, ["routing", "some-class"]);
    assert.notEqual(neither.code, 0);
    assert.match(neither.stderr, /Missing --candidates JSON array or --profiles JSON array/);
    assert.equal(existsSync(daemonSocketPath(home)), false, "missing-flag failure must not start a daemon");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("routing CLI rejects malformed --profiles before daemon contact", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-routing-cli-profiles-"));
  try {
    const badJson = await runCli(home, ["routing", "some-class", "--profiles", "not-json"]);
    assert.notEqual(badJson.code, 0);
    assert.match(badJson.stderr, /Invalid --profiles JSON/);
    assert.equal(existsSync(daemonSocketPath(home)), false, "bad JSON must not start a daemon");

    const nonString = await runCli(home, ["routing", "some-class", "--profiles", '[123,"deepseek-primary"]']);
    assert.notEqual(nonString.code, 0);
    assert.match(nonString.stderr, /profiles\[0\] must be a non-empty string/);
    assert.equal(existsSync(daemonSocketPath(home)), false, "non-string profile must not start a daemon");

    const emptyId = await runCli(home, ["routing", "some-class", "--profiles", '["  ","deepseek-primary"]']);
    assert.notEqual(emptyId.code, 0);
    assert.match(emptyId.stderr, /profiles\[0\] must be a non-empty string/);
    assert.equal(existsSync(daemonSocketPath(home)), false, "empty profile must not start a daemon");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("routing CLI accepts full-identity legacy candidates with runtime and effort", async () => {
  const fixture = await DetachedDaemonFixture.create("forklight-routing-cli-full-");
  try {
    await fixture.ensureReady();
    // Full identity candidates are forwarded with runtime/effort intact; the
    // daemon returns a valid advisory (no CLI-local rejection of runtime/effort).
    const result = await runCli(fixture.home, [
      "routing", "some-class", "--json",
      "--candidates", '[{"provider":"deepseek","model":"v4","runtime":"claude-code","effort":"high"},{"provider":"qwen","model":"plus","runtime":"claude-code","effort":"medium"}]',
    ], 20_000);
    assert.equal(result.code, 0, `routing must succeed: ${result.stderr}`);
    const advisory = JSON.parse(result.stdout) as {
      candidates: Array<Record<string, unknown>>;
    };
    assert.equal(advisory.candidates.length, 2);
    const deepseek = advisory.candidates.find((c) => c.provider === "deepseek")!;
    assert.equal(deepseek.runtime, "claude-code");
    assert.equal(deepseek.effort, "high");
    assert.equal(deepseek.workerProfileId, undefined,
      "legacy candidates must not gain fabricated profile identity");
  } finally {
    await fixture.cleanup();
  }
});

test("routing CLI human output explains an evidence-ready subset without judging missing history", () => {
  const evidence = {
    relevantSampleCount: 8,
    modelQualityFailureCount: 1,
    acceptedDeliveryRate: 0.75,
    ignoredNonModelFailures: {},
  };
  const candidate = (provider: string, model: string, compared: boolean) => ({
    provider,
    model,
    eligible: true as const,
    evidence,
    comparisonEvidence: evidence,
    sampleCoverage: {
      exactTerminalCount: 8,
      exactRelevantCount: 8,
      exactMinRelevantSamples: 5,
    },
    cohortParticipation: compared ? "compared" as const : "insufficient-evidence" as const,
    factors: [],
    totalScore: compared ? 1 : 0,
    uncertainty: {
      insufficientSamples: !compared,
      insufficientGap: false,
      incompatibleCost: false,
      incompatibleCurrency: false,
      reasons: [],
    },
  });
  const advisory = {
    taskClass: "coding:cohort-test",
    evidenceScope: "exact-class",
    knowledge: "recommendation",
    candidates: [
      candidate("deepseek", "v4", true),
      candidate("qwen", "plus", true),
      candidate("minimax", "m2", false),
    ],
    recommendation: {
      provider: "deepseek",
      model: "v4",
      confidence: 0.5,
      reasoning: "clear-score-gap:0.5000",
      coverage: "evidence-ready-subset",
    },
    competition: {
      shouldRunCompetition: false,
      intent: "none",
      evaluatedTriggers: [],
      matchingTriggers: [],
      suggestedCandidates: 0,
    },
    shouldRunCompetition: false,
    resolvedPolicy: {},
    omittedFactors: [],
    allCandidatesCompared: false,
    cohortCandidateCount: 2,
    distinctIdentityCount: 2,
    totalCandidateCount: 3,
    excludedCandidateCount: 1,
    recommendationCoverage: "evidence-ready-subset",
  } as unknown as RoutingAdvisoryResponse;

  const output = formatRoutingAdviceHuman(advisory);
  assert.match(output, /Comparison: 2 of 3 candidate\(s\).*1 not included yet/);
  assert.match(output, /\[not compared yet: insufficient evidence\]/);
  assert.doesNotMatch(output, /excluded|failed|scored as zero/i);
});

test("integration preflight human output leads with the applicability explanation before raw evidence", () => {
  const receipt = {
    id: "rec-1",
    taskId: "task-1",
    rejectionReasons: ["Patch does not apply cleanly: error: patch failed"],
    affectedFiles: ["readme.md"],
    patchDigest: "abc",
    applicabilityIssue: { code: "patch-not-applicable" },
  };
  const out = humanIntegrationPreflightLines(receipt);
  // Stable header and verdict remain.
  assert.match(out, /^receiptId: rec-1$/m);
  assert.match(out, /^taskId: task-1$/m);
  assert.match(out, /^passed: false$/m);
  // Plain explanation leads the body, before the raw rejection evidence.
  const explIdx = out.indexOf("patchNotApplicable:");
  const rejectIdx = out.indexOf("rejectionReasons:");
  assert.ok(explIdx > 0, "explanation block present");
  assert.ok(rejectIdx > explIdx, "explanation appears before raw rejection evidence");
  assert.match(out, /what happened:/);
  assert.match(out, /what it may mean:/);
  assert.match(out, /next action:/);
  // The explanation is cautious: it does not blame a Worker or promise that
  // retrying unchanged will fix the problem.
  assert.doesNotMatch(out, /worker failed/i);
  assert.doesNotMatch(out, /retry.*will fix/i);
  // Raw rejection evidence is retained after the explanation.
  assert.match(out, /Patch does not apply cleanly/);
  assert.match(out, /affectedFiles: readme\.md/);
});

test("integration preflight human output omits the explanation when the issue is absent", () => {
  const receipt = {
    id: "rec-2",
    taskId: "task-2",
    rejectionReasons: ["Patch changes 6 files (limit: 5)"],
    affectedFiles: ["a.ts"],
    patchDigest: "def",
  };
  const out = humanIntegrationPreflightLines(receipt);
  assert.ok(!out.includes("patchNotApplicable:"), "no explanation for non-applicability rejection");
  assert.match(out, /rejectionReasons:/);
  assert.match(out, /Patch changes 6 files/);
  assert.match(out, /^passed: false$/m);
});

test("integration preflight human output for a passing receipt stays legacy-shaped", () => {
  const receipt = {
    id: "rec-3",
    taskId: "task-3",
    rejectionReasons: [],
    affectedFiles: ["readme.md"],
    patchDigest: "ghi",
  };
  const out = humanIntegrationPreflightLines(receipt);
  assert.ok(!out.includes("patchNotApplicable:"));
  assert.ok(!out.includes("rejectionReasons:"));
  assert.match(out, /^passed: true$/m);
  assert.match(out, /affectedFiles: readme\.md/);
  assert.match(out, /patchDigest: ghi/);
});

test("integration preflight human output bounds each technical reason for the applicability case", () => {
  const longReason = "Patch does not apply cleanly: " + "x".repeat(500);
  const receipt = {
    id: "rec-trunc",
    taskId: "task-trunc",
    rejectionReasons: [longReason, "short reason"],
    affectedFiles: ["a.ts"],
    patchDigest: "dig",
    applicabilityIssue: { code: "patch-not-applicable" },
  };
  const out = humanIntegrationPreflightLines(receipt);
  // Plain explanation still leads before the bounded technical evidence.
  assert.ok(out.indexOf("patchNotApplicable:") < out.indexOf("rejectionReasons:"),
    "explanation appears before bounded rejection evidence");
  // Each rendered reason is bounded to the deterministic maximum.
  const reasonLines = out
    .split("\n")
    .filter((line) => line.startsWith("  - "))
    .map((line) => line.slice("  - ".length));
  assert.equal(reasonLines.length, 2);
  for (const rendered of reasonLines) {
    assert.ok(rendered.length <= APPLICABILITY_REASON_MAX,
      `reason bounded to ${APPLICABILITY_REASON_MAX}: got ${rendered.length}`);
  }
  // The long reason is truncated with an ellipsis at exactly the max; the
  // short one is rendered verbatim.
  assert.equal(reasonLines[0]!.length, APPLICABILITY_REASON_MAX);
  assert.ok(reasonLines[0]!.endsWith("..."), "long reason truncated with ellipsis");
  assert.equal(reasonLines[1], "short reason");
  // The formatter is pure: it never mutates the input receipt, so JSON output
  // (produced elsewhere via JSON.stringify) is unchanged.
  assert.deepEqual(receipt.rejectionReasons, [longReason, "short reason"]);
});

test("integration preflight human output preserves legacy byte shape without truncation", () => {
  const longReason = "Patch changes 6 files (limit: 5): " + "y".repeat(500);
  const receipt = {
    id: "rec-legacy-long",
    taskId: "task-legacy-long",
    rejectionReasons: [longReason],
    affectedFiles: ["a.ts"],
    patchDigest: "dig2",
    // No applicabilityIssue: legacy / non-applicability receipt.
  };
  const out = humanIntegrationPreflightLines(receipt);
  assert.ok(!out.includes("patchNotApplicable:"), "no explanation block without the issue");
  // No truncation: the raw reason is rendered verbatim (legacy byte shape).
  assert.ok(out.includes(`  - ${longReason}`), "long reason preserved verbatim without truncation");
  assert.match(out, /^passed: false$/m);
});

test("routing CLI JSON output includes canonical cohort coverage facts", async () => {
  const fixture = await DetachedDaemonFixture.create("forklight-routing-cli-cohort-json-");
  try {
    await fixture.ensureReady();
    const result = await runCli(fixture.home, [
      "routing", "coding:cohort-test", "--json",
      "--candidates",
      '[{"provider":"deepseek","model":"v4"},{"provider":"qwen","model":"plus"},{"provider":"minimax","model":"m2"}]',
    ], 20_000);
    assert.equal(result.code, 0, `routing must succeed: ${result.stderr}`);
    const advisory = JSON.parse(result.stdout) as Record<string, unknown>;
    // Canonical coverage facts must be present in the JSON response.
    assert.ok("allCandidatesCompared" in advisory, "must include allCandidatesCompared");
    assert.ok("cohortCandidateCount" in advisory, "must include cohortCandidateCount");
    assert.ok("distinctIdentityCount" in advisory, "must include distinctIdentityCount");
    assert.ok("totalCandidateCount" in advisory, "must include totalCandidateCount");
    assert.ok("recommendationCoverage" in advisory, "must include recommendationCoverage");
    // Each candidate must carry cohortParticipation and comparisonEvidence.
    const cands = advisory.candidates as Array<Record<string, unknown>>;
    assert.ok(cands.length >= 2);
    for (const c of cands) {
      assert.ok(typeof c.cohortParticipation === "string", "every candidate must have cohortParticipation");
      assert.ok(typeof c.comparisonEvidence === "object", "every candidate must have comparisonEvidence");
    }
  } finally {
    await fixture.cleanup();
  }
});

test("daemon start/restart reject invalid --startup-timeout-ms before lifecycle mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-daemon-startup-timeout-cli-"));
  try {
    for (const operation of ["start", "restart"] as const) {
      const result = await runCli(home, [
        "daemon", operation, "--startup-timeout-ms", "0",
      ]);
      assert.notEqual(result.code, 0, `${operation} must reject timeout 0`);
      assert.match(
        result.stderr,
        /Daemon startup timeout must be an integer from 1000 to 600000/,
      );
      assert.equal(
        existsSync(daemonSocketPath(home)),
        false,
        `${operation} must not create a socket when timeout validation fails`,
      );
      assert.equal(
        existsSync(path.join(home, "daemon.log")),
        false,
        `${operation} must not spawn a daemon when timeout validation fails`,
      );
    }
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("daemon restart CLI prints JSON health to stdout", async () => {
  const fixture = await DetachedDaemonFixture.create("forklight-restart-cli-json-");
  try {
    // Ensure a running daemon first so restart has something to replace.
    const firstHealth = await fixture.ensureReady();
    const firstPid = firstHealth.pid as number;
    assert.ok(Number.isSafeInteger(firstPid) && firstPid > 0);

    const { stdout } = await execFileAsync(
      process.execPath,
      cliArgs("daemon", "restart"),
      {
        cwd: root,
        env: { ...process.env, FORKLIGHT_HOME: fixture.home },
        timeout: DEFAULT_DAEMON_STARTUP_TIMEOUT_MS + 20_000,
      },
    );
    const rawPidMatch = /"pid"\s*:\s*(\d+)/.exec(stdout);
    if (rawPidMatch) await fixture.adoptReplacement(Number(rawPidMatch[1]));
    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    const replacementPid = parsed.pid as number;
    assert.ok(
      Number.isSafeInteger(replacementPid) && replacementPid > 0,
      "CLI restart must print JSON with a valid PID",
    );
    assert.notEqual(
      replacementPid,
      firstPid,
      "CLI restart must replace the old PID with a new one",
    );
    assert.equal(parsed.ok, true, "CLI restart health must report ok");
    assert.deepEqual(
      parsed.buildIdentity,
      currentBuildIdentity(),
      "CLI restart health build identity must match client",
    );
    assert.throws(
      () => process.kill(firstPid, 0),
      /ESRCH/,
      "original daemon PID must be gone after CLI restart",
    );
  } finally {
    await fixture.cleanup();
  }
});

test("daemon restart CLI starts a daemon when none is running", async () => {
  const fixture = await DetachedDaemonFixture.create("forklight-restart-cli-stopped-");
  try {
    // Verify no running daemon.
    const stopResult = await stopDaemon(fixture.home);
    assert.equal(stopResult.stopped, true);

    const { stdout } = await execFileAsync(
      process.execPath,
      cliArgs("daemon", "restart"),
      {
        cwd: root,
        env: { ...process.env, FORKLIGHT_HOME: fixture.home },
        timeout: DEFAULT_DAEMON_STARTUP_TIMEOUT_MS + 20_000,
      },
    );
    const rawPidMatch = /"pid"\s*:\s*(\d+)/.exec(stdout);
    if (rawPidMatch) await fixture.adoptReplacement(Number(rawPidMatch[1]));
    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    const pid = parsed.pid as number;
    assert.ok(
      Number.isSafeInteger(pid) && pid > 0,
      "CLI restart on a stopped home must start a daemon and report its PID",
    );
    assert.equal(parsed.ok, true, "CLI restart health must report ok");
    assert.deepEqual(
      parsed.buildIdentity,
      currentBuildIdentity(),
      "CLI restart build identity must match client",
    );
  } finally {
    await fixture.cleanup();
  }
});

// --- Integration observation: never starts a missing daemon ---

async function runCli(
  home: string,
  args: string[],
  timeoutMs = 10_000,
): Promise<{ stdout: string; stderr: string; code: number; elapsedMs: number }> {
  const started = Date.now();
  try {
    const result = await execFileAsync(process.execPath, cliArgs(...args), {
      cwd: root,
      env: { ...process.env, FORKLIGHT_HOME: home },
      timeout: timeoutMs,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      code: 0,
      elapsedMs: Date.now() - started,
    };
  } catch (error: unknown) {
    const execError = error as {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      code: typeof execError.code === "number" ? execError.code : 1,
      elapsedMs: Date.now() - started,
    };
  }
}

function assertObserverUnavailableGuidance(stderr: string, home: string): void {
  assert.match(
    stderr,
    new RegExp(DAEMON_OBSERVER_UNAVAILABLE_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "observer must emit bounded transition/stopped guidance",
  );
  assert.match(stderr, /never starts a daemon/i);
  assert.match(stderr, /Retry the same observation/i);
  assert.doesNotMatch(
    stderr,
    new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "observer error must not expose the isolated home path",
  );
  assert.doesNotMatch(
    stderr,
    /forklight\.sock|ECONNREFUSED|ENOENT|ECONNRESET|EPIPE|socket path/i,
    "observer error must not expose private transport details",
  );
}

async function assertEndpointRemainsAbsent(home: string): Promise<void> {
  // Bounded grace: a leaked ensureDaemon spawn would create a socket within
  // a few hundred ms; wait longer than that bootstrap window.
  await sleep(400);
  assert.equal(
    existsSync(daemonSocketPath(home)),
    false,
    "observation must not create a daemon socket",
  );
  assert.equal(
    await probeSocketAlive(home),
    false,
    "observation must leave the endpoint unreachable",
  );
  assert.equal(
    existsSync(path.join(home, "daemon.log")),
    false,
    "observation must not spawn a detached daemon (no daemon.log)",
  );
}

interface HomeLifecycleFacts {
  socketAbsent: boolean;
  logAbsent: boolean;
  endpointUnreachable: boolean;
  taskCount: number;
  resultCount: number;
}

/** Deterministic exact-home lifecycle facts used as before/after evidence.
 *  Correctness is decided by these facts, never by a wall-clock threshold.
 *  Opening a StateStore creates the test home's store file; that is a
 *  test-local file, not a daemon lifecycle side effect. */
async function collectHomeLifecycleFacts(home: string): Promise<HomeLifecycleFacts> {
  const store = new StateStore(home);
  try {
    return {
      socketAbsent: !existsSync(daemonSocketPath(home)),
      logAbsent: !existsSync(daemonLogPath(home)),
      endpointUnreachable: !(await probeSocketAlive(home)),
      taskCount: store.listTasks().length,
      resultCount: store.listRecentIntegrationResults(100).length,
    };
  } finally {
    store.close();
  }
}

test("isDaemonTransportUnavailable classifies socket gaps and leaves business errors alone", () => {
  const refused = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  assert.equal(isDaemonTransportUnavailable(refused), true);
  assert.equal(
    isDaemonTransportUnavailable(new Error("Unknown Integration operation: op-x")),
    false,
  );
  assert.equal(
    isDaemonTransportUnavailable(new Error("Unknown ForkLight task: task-x")),
    false,
  );
});

test("daemonObserverRequest never starts a daemon and normalizes transport gaps", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-observer-unit-"));
  try {
    await assert.rejects(
      () => daemonObserverRequest("integration_status", { operationId: "op-absent" }, home),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, DAEMON_OBSERVER_UNAVAILABLE_MESSAGE);
        assert.ok(error.cause instanceof Error, "original transport error retained as cause");
        return true;
      },
    );
    await assertEndpointRemainsAbsent(home);
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("Integration status/wait/history on a fresh home never start a daemon", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-int-observer-absent-"));
  try {
    const cases: Array<{ args: string[]; label: string }> = [
      { label: "status", args: ["integration", "status", "op-absent-status"] },
      {
        label: "wait",
        args: ["integration", "wait", "op-absent-wait", "--timeout-ms", "1000"],
      },
      { label: "history", args: ["integration", "history", "task-absent-history"] },
    ];
    const before = await collectHomeLifecycleFacts(home);
    for (const { args, label } of cases) {
      const result = await runCli(home, args);
      assert.notEqual(result.code, 0, `${label} must fail when no daemon is running`);
      assertObserverUnavailableGuidance(result.stderr, home);
      // Public CLI error output never exposes a temporary runner identity.
      assert.ok(
        !result.stderr.includes("runnerPid"),
        `${label} observer error must not expose runnerPid`,
      );
    }
    // Correctness is judged by exact-home lifecycle facts, not by elapsed time:
    // no daemon, endpoint, log, Task, Integration result, or process may appear.
    const after = await collectHomeLifecycleFacts(home);
    assert.deepEqual(
      after,
      before,
      "status/wait/history on a fresh home must not start a daemon or create any endpoint, log, Task, result, or process",
    );
    await assertEndpointRemainsAbsent(home);
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("Integration wait validates timeout before any daemon contact", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-int-observer-timeout-"));
  try {
    const result = await runCli(home, [
      "integration", "wait", "op-x", "--timeout-ms", "0",
    ]);
    assert.notEqual(result.code, 0);
    assert.match(
      result.stderr,
      /Integration wait timeout must be an integer from 1 to 3600000/,
    );
    assert.doesNotMatch(result.stderr, /unavailable for observation|never starts a daemon/i);
    await assertEndpointRemainsAbsent(home);
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

function seedCompletedIntegration(home: string): {
  taskId: string;
  operationId: string;
  receiptId: string;
} {
  const store = new StateStore(home);
  const timestamp = "2026-07-30T12:00:00.000Z";
  const taskId = "task-observer-active";
  const operationId = "op-observer-active";
  const receiptId = "receipt-observer-active";
  const task: TaskRecord = {
    id: taskId,
    name: "observer active",
    status: "succeeded",
    sourcePath: "/source",
    taskFile: "/task-observer.yaml",
    spec: { provider: { name: "deepseek", model: "v4" } } as TaskRecord["spec"],
    paths: {} as TaskRecord["paths"],
    sessionId: "session-observer",
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
  };
  store.createTask(task);
  // Results FK to preflight receipts; persist the matching receipt first.
  const receipt: IntegrationReceiptRecord = {
    id: receiptId,
    taskId,
    patchDigest: "a".repeat(64),
    affectedFiles: ["value.txt"],
    rejectionReasons: [],
    sourceEvidence: {},
    createdAt: timestamp,
    expiresAt: "2026-07-30T13:00:00.000Z",
    consumed: true,
  };
  store.saveIntegrationReceipt(receipt);
  const result: IntegrationResultRecord = {
    id: operationId,
    receiptId,
    taskId,
    status: "applied",
    appliedAt: timestamp,
    createdAt: timestamp,
    stages: [
      { stage: "source-applied", status: "passed" },
      { stage: "source-verified", status: "passed" },
      { stage: "artifact-built", status: "not-applicable" },
      { stage: "runtime-activated", status: "not-applicable" },
    ],
  };
  store.saveIntegrationResult(result);
  store.close();
  return { taskId, operationId, receiptId };
}

function seedCliTaskSurfaceEvidence(home: string): {
  deliveredTaskId: string;
  repairedTaskId: string;
  awaitingTaskId: string;
} {
  const store = new StateStore(home);
  const timestamp = "2026-07-31T03:30:00.000Z";
  const paths = {
    root: "/state/task",
    baseline: "/state/task/baseline",
    workspace: "/state/task/workspace",
    logs: "/state/task/logs",
    claudeConfig: "/state/task/claude",
    diff: "/state/task/diff.patch",
  };
  const task = (id: string, status: TaskRecord["status"]): TaskRecord => ({
    id,
    name: id,
    status,
    sourcePath: "/source",
    taskFile: `/task-${id}.yaml`,
    spec: {
      provider: { name: "deepseek", model: "deepseek-v4-pro[1M]" },
      runtime: { name: "claude-code" },
    } as TaskRecord["spec"],
    paths,
    sessionId: `session-${id}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
  });

  const deliveredTaskId = "cli-surface-delivered";
  const operationId = "cli-surface-operation";
  const receiptId = "cli-surface-receipt";
  store.createTask(task(deliveredTaskId, "succeeded"));
  store.addEvent(
    deliveredTaskId,
    undefined,
    "integration.operation.started",
    "integration started",
    { operationId, taskId: deliveredTaskId, receiptId },
  );
  store.saveIntegrationReceipt({
    id: receiptId,
    taskId: deliveredTaskId,
    patchDigest: "d".repeat(64),
    affectedFiles: ["src/cli.ts"],
    rejectionReasons: [],
    sourceEvidence: {},
    createdAt: timestamp,
    expiresAt: "2099-01-01T00:00:00.000Z",
    consumed: true,
  });
  store.saveIntegrationResult({
    id: operationId,
    receiptId,
    taskId: deliveredTaskId,
    status: "applied",
    appliedAt: timestamp,
    createdAt: timestamp,
    stages: [
      { stage: "source-applied", status: "passed" },
      { stage: "source-verified", status: "passed" },
      { stage: "artifact-built", status: "not-applicable" },
      { stage: "runtime-activated", status: "not-applicable" },
    ],
  });

  const repairedTaskId = "cli-surface-repaired";
  store.createTask(task(repairedTaskId, "failed"));
  store.saveRemediationDisposition(repairedTaskId, {
    status: "verified-repaired-delivered",
    checkId: "cli-surface-remediation",
    createdAt: timestamp,
  });

  const awaitingTaskId = "cli-surface-awaiting";
  store.createTask(task(awaitingTaskId, "succeeded"));
  store.addEvent(awaitingTaskId, undefined, "verification.completed", "verification passed", {
    passed: true,
    behaviorPassed: true,
    policyPassed: true,
    sourceCompatible: true,
    commands: [],
    diffPath: paths.diff,
    sourceUnchanged: false,
  });
  store.close();
  return { deliveredTaskId, repairedTaskId, awaitingTaskId };
}

test("CLI status/list preserve canonical Main, remediation, and Integration placement", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-task-surface-"));
  const seeded = seedCliTaskSurfaceEvidence(home);
  try {
    const status = await runCli(home, ["status", seeded.deliveredTaskId, "--json"]);
    assert.equal(status.code, 0, status.stderr);
    const statusBody = JSON.parse(status.stdout) as Record<string, unknown>;
    assert.equal(statusBody.decisionStage, "delivered");
    assert.equal(statusBody.boardScope, "history");
    assert.equal(statusBody.boardReason, "delivered");

    const list = await runCli(home, ["list", "--json"]);
    assert.equal(list.code, 0, list.stderr);
    const rows = JSON.parse(list.stdout) as Array<Record<string, unknown>>;
    const byId = new Map(rows.map((row) => [row.taskId, row]));
    assert.deepEqual(
      [
        byId.get(seeded.deliveredTaskId)?.decisionStage,
        byId.get(seeded.deliveredTaskId)?.boardScope,
        byId.get(seeded.deliveredTaskId)?.boardReason,
      ],
      ["delivered", "history", "delivered"],
    );
    assert.deepEqual(
      [
        byId.get(seeded.repairedTaskId)?.boardScope,
        byId.get(seeded.repairedTaskId)?.boardReason,
      ],
      ["history", "repaired-delivered"],
    );
    assert.deepEqual(
      [
        byId.get(seeded.awaitingTaskId)?.decisionStage,
        byId.get(seeded.awaitingTaskId)?.boardScope,
        byId.get(seeded.awaitingTaskId)?.boardReason,
      ],
      ["awaiting-main-review", "now", "awaiting-main"],
    );
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

function seedFailedCliTask(
  home: string,
  taskId: string,
  options?: { evidenceTaskId?: string },
): void {
  const store = new StateStore(home);
  const taskRecord: TaskRecord = {
    id: taskId,
    name: taskId,
    status: "failed",
    sourcePath: "/source",
    taskFile: `/task-${taskId}.yaml`,
    spec: {
      provider: { name: "deepseek", model: "deepseek-v4-pro[1M]" },
      runtime: { name: "claude-code" },
    } as TaskRecord["spec"],
    paths: {
      root: "/state/task",
      baseline: "/state/task/baseline",
      workspace: "/state/task/workspace",
      logs: "/state/task/logs",
      claudeConfig: "/state/task/claude",
      diff: "/state/task/diff.patch",
    },
    sessionId: `session-${taskId}`,
    createdAt: "2026-07-31T03:30:00.000Z",
    updatedAt: "2026-07-31T03:30:00.000Z",
  };
  store.createTask(taskRecord);
  store.addEvent(taskId, undefined, "worker.failed", "Worker failed: connectivity", {
    failureCategory: "connectivity",
  });
  if (options?.evidenceTaskId !== undefined) {
    const evidence: TaskRecord = {
      ...taskRecord,
      id: options.evidenceTaskId,
      name: options.evidenceTaskId,
      status: "succeeded",
      taskFile: `/task-${options.evidenceTaskId}.yaml`,
      sessionId: `session-${options.evidenceTaskId}`,
    };
    store.createTask(evidence);
  }
  store.close();
}

function seedSucceededCliTask(home: string, taskId: string): void {
  const store = new StateStore(home);
  const taskRecord: TaskRecord = {
    id: taskId,
    name: taskId,
    status: "succeeded",
    sourcePath: "/source",
    taskFile: `/task-${taskId}.yaml`,
    spec: {
      provider: { name: "deepseek", model: "deepseek-v4-pro[1M]" },
      runtime: { name: "claude-code" },
    } as TaskRecord["spec"],
    paths: {
      root: "/state/task",
      baseline: "/state/task/baseline",
      workspace: "/state/task/workspace",
      logs: "/state/task/logs",
      claudeConfig: "/state/task/claude",
      diff: "/state/task/diff.patch",
    },
    sessionId: `session-${taskId}`,
    createdAt: "2026-07-31T03:30:00.000Z",
    updatedAt: "2026-07-31T03:30:00.000Z",
  };
  store.createTask(taskRecord);
  store.addEvent(taskId, undefined, "verification.completed", "Independent verification passed", {
    passed: true,
    behaviorPassed: true,
    policyPassed: true,
    sourceCompatible: true,
    commands: [],
    diffPath: "/state/task/diff.patch",
    sourceUnchanged: false,
  });
  store.close();
}

function taskMutationSnapshot(home: string, taskId: string): {
  events: number;
  resolutionCompleted: number;
  resolutionReopened: number;
  receipts: number;
} {
  const store = new StateStore(home);
  try {
    const events = store.listEvents(taskId);
    return {
      events: events.length,
      resolutionCompleted: events.filter((e) => e.type === "task.resolution.completed").length,
      resolutionReopened: events.filter((e) => e.type === "task.resolution.reopened").length,
      receipts: store.listExchangeReceipts(taskId).length,
    };
  } finally {
    store.close();
  }
}

test("CLI resolve closes a handled failure; reopen restores Now without changing status", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-resolve-"));
  const taskId = "cli-resolve-task";
  seedFailedCliTask(home, taskId);

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const resolved = await runCli(home, [
      "resolve", taskId, "--reason", "environment-recovered", "--note", "env fixed by recovery", "--confirm", "--json",
    ]);
    assert.equal(resolved.code, 0, resolved.stderr);
    const resolvedBody = JSON.parse(resolved.stdout) as Record<string, unknown>;
    assert.equal(resolvedBody.existing, false);
    assert.equal((resolvedBody.state as Record<string, unknown>).status, "resolved");
    assert.equal(resolvedBody.boardScope, "history");
    assert.equal(resolvedBody.boardReason, "attention-resolved");

    // Exact replay is idempotent.
    const replay = await runCli(home, [
      "resolve", taskId, "--reason", "environment-recovered", "--note", "env fixed by recovery", "--confirm", "--json",
    ]);
    assert.equal(replay.code, 0, replay.stderr);
    assert.equal((JSON.parse(replay.stdout) as Record<string, unknown>).existing, true);

    // Conflicting resolve fails closed.
    const conflict = await runCli(home, [
      "resolve", taskId, "--reason", "superseded", "--note", "different", "--confirm", "--json",
    ]);
    assert.notEqual(conflict.code, 0);

    const reopened = await runCli(home, [
      "reopen", taskId, "--note", "actionable again", "--confirm", "--json",
    ]);
    assert.equal(reopened.code, 0, reopened.stderr);
    const reopenedBody = JSON.parse(reopened.stdout) as Record<string, unknown>;
    assert.equal(reopenedBody.existing, false);
    assert.equal((reopenedBody.state as Record<string, unknown>).status, "reopened");
    assert.equal(reopenedBody.boardScope, "now");

    // Machine status is unchanged by resolve/reopen.
    const status = await runCli(home, ["status", taskId, "--json"]);
    assert.equal(status.code, 0, status.stderr);
    assert.equal((JSON.parse(status.stdout) as Record<string, unknown>).status, "failed");

    // Human path (no --json) remains compatible after reopen.
    const human = await runCli(home, [
      "resolve", taskId, "--reason", "no-longer-needed", "--confirm",
    ]);
    assert.equal(human.code, 0, human.stderr);
    assert.match(human.stdout, /resolved|attention/i);
    assert.ok(!human.stdout.trimStart().startsWith("{"), "human path is not JSON");
  } finally {
    await daemon.close();
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("CLI resolve accepts optional --evidence without inventing success", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-resolve-evidence-"));
  const taskId = "cli-resolve-evidence-task";
  const evidenceTaskId = "cli-resolve-evidence-successor";
  seedFailedCliTask(home, taskId, { evidenceTaskId });

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const resolved = await runCli(home, [
      "resolve",
      taskId,
      "--reason",
      "superseded",
      "--evidence",
      evidenceTaskId,
      "--confirm",
      "--json",
    ]);
    assert.equal(resolved.code, 0, resolved.stderr);
    const body = JSON.parse(resolved.stdout) as Record<string, unknown>;
    assert.equal(body.existing, false);
    const state = body.state as Record<string, unknown>;
    assert.equal(state.status, "resolved");
    assert.equal(state.evidenceTaskId, evidenceTaskId);
    assert.equal(body.boardReason, "attention-resolved");

    const status = await runCli(home, ["status", taskId, "--json"]);
    assert.equal(status.code, 0, status.stderr);
    assert.equal(
      (JSON.parse(status.stdout) as Record<string, unknown>).status,
      "failed",
      "evidence link does not invent machine success",
    );
  } finally {
    await daemon.close();
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("CLI resolve closes a succeeded non-delivered Task; reopen restores Now without changing status", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-resolve-succeeded-"));
  const taskId = "cli-resolve-succeeded-task";
  seedSucceededCliTask(home, taskId);

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const resolved = await runCli(home, [
      "resolve", taskId, "--reason", "no-longer-needed", "--note", "historical evidence only", "--confirm", "--json",
    ]);
    assert.equal(resolved.code, 0, resolved.stderr);
    const resolvedBody = JSON.parse(resolved.stdout) as Record<string, unknown>;
    assert.equal(resolvedBody.existing, false);
    assert.equal((resolvedBody.state as Record<string, unknown>).status, "resolved");
    assert.equal(resolvedBody.boardScope, "history");
    assert.equal(resolvedBody.boardReason, "attention-resolved");

    // Machine status is unchanged.
    const status = await runCli(home, ["status", taskId, "--json"]);
    assert.equal(status.code, 0, status.stderr);
    assert.equal((JSON.parse(status.stdout) as Record<string, unknown>).status, "succeeded");

    // Exact replay is idempotent.
    const replay = await runCli(home, [
      "resolve", taskId, "--reason", "no-longer-needed", "--note", "historical evidence only", "--confirm", "--json",
    ]);
    assert.equal(replay.code, 0, replay.stderr);
    assert.equal((JSON.parse(replay.stdout) as Record<string, unknown>).existing, true);

    // Reopen restores the same unresolved succeeded Task to Now.
    const reopened = await runCli(home, [
      "reopen", taskId, "--note", "needs review again", "--confirm", "--json",
    ]);
    assert.equal(reopened.code, 0, reopened.stderr);
    const reopenedBody = JSON.parse(reopened.stdout) as Record<string, unknown>;
    assert.equal((reopenedBody.state as Record<string, unknown>).status, "reopened");
    assert.equal(reopenedBody.boardScope, "now");

    const afterStatus = await runCli(home, ["status", taskId, "--json"]);
    assert.equal(afterStatus.code, 0, afterStatus.stderr);
    assert.equal((JSON.parse(afterStatus.stdout) as Record<string, unknown>).status, "succeeded");
  } finally {
    await daemon.close();
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("CLI resolve rejects a delivered succeeded Task before writing a resolution event", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-resolve-delivered-"));
  const taskId = "cli-resolve-delivered-task";
  seedSucceededCliTask(home, taskId);
  const store = new StateStore(home);
  store.saveRemediationDisposition(taskId, {
    status: "verified-repaired-delivered",
    checkId: "check-1",
    createdAt: "2026-07-31T04:00:00.000Z",
  });
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const before = taskMutationSnapshot(home, taskId);
    const resolved = await runCli(home, [
      "resolve", taskId, "--reason", "no-longer-needed", "--confirm", "--json",
    ]);
    assert.notEqual(resolved.code, 0);
    assert.match(resolved.stderr, /delivered/i);
    const after = taskMutationSnapshot(home, taskId);
    assert.equal(after.events, before.events, "delivered rejection writes no Task event");
    assert.equal(after.resolutionCompleted, before.resolutionCompleted);
    assert.equal(after.resolutionReopened, before.resolutionReopened);
  } finally {
    await daemon.close();
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("CLI resolve/reopen reject unknown, stray, duplicate, and missing-value args before mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-resolve-args-"));
  const taskId = "cli-resolve-args-task";
  seedFailedCliTask(home, taskId);

  // Pre-daemon path: invalid grammar never starts a Daemon or writes receipts.
  const noDaemonCases: Array<{ args: string[]; pattern: RegExp }> = [
    {
      args: ["resolve", taskId, "--reason", "environment-recovered", "--confirm", "--typo-flag"],
      pattern: /unknown argument: --typo-flag/,
    },
    {
      args: ["resolve", taskId, "--reason", "environment-recovered", "--confirm", "stray-text"],
      pattern: /unexpected argument: stray-text/,
    },
    {
      args: [
        "resolve", taskId, "--reason", "environment-recovered",
        "--reason", "superseded", "--confirm",
      ],
      pattern: /duplicate flag: --reason/,
    },
    {
      args: ["resolve", taskId, "--reason", "--confirm"],
      pattern: /--reason requires a value/,
    },
    {
      args: [
        "resolve", taskId, "--reason", "environment-recovered",
        "--confirm", "--confirm",
      ],
      pattern: /duplicate flag: --confirm/,
    },
    {
      args: ["reopen", taskId, "--confirm", "--evidence", "not-allowed"],
      pattern: /unknown argument: --evidence/,
    },
    {
      args: ["reopen", taskId, "--note", "--confirm"],
      pattern: /--note requires a value/,
    },
    {
      args: ["reopen", taskId, "--confirm", "--confirm"],
      pattern: /duplicate flag: --confirm/,
    },
  ];

  try {
    for (const { args, pattern } of noDaemonCases) {
      const before = taskMutationSnapshot(home, taskId);
      const result = await runCli(home, args);
      assert.notEqual(result.code, 0, `expected failure for ${args.join(" ")}`);
      assert.match(result.stderr, pattern, result.stderr);
      assert.equal(
        existsSync(daemonSocketPath(home)),
        false,
        `invalid ${args[0]} must not start a daemon`,
      );
      assert.deepEqual(
        taskMutationSnapshot(home, taskId),
        before,
        `invalid ${args.join(" ")} must not mutate events or receipts`,
      );
    }

    // With a live Daemon, the same grammar still fails before Task events or
    // exchange receipts are written.
    const daemon = new ForkLightDaemon(home, 0);
    await daemon.start();
    try {
      const before = taskMutationSnapshot(home, taskId);
      const live = await runCli(home, [
        "resolve", taskId, "--reason", "environment-recovered", "--confirm", "--unknown",
      ]);
      assert.notEqual(live.code, 0);
      assert.match(live.stderr, /unknown argument: --unknown/);
      assert.deepEqual(
        taskMutationSnapshot(home, taskId),
        before,
        "live-daemon invalid resolve must not mutate events or receipts",
      );

      const liveReopen = await runCli(home, [
        "reopen", taskId, "--confirm", "extra",
      ]);
      assert.notEqual(liveReopen.code, 0);
      assert.match(liveReopen.stderr, /unexpected argument: extra/);
      assert.deepEqual(
        taskMutationSnapshot(home, taskId),
        before,
        "live-daemon invalid reopen must not mutate events or receipts",
      );
    } finally {
      await daemon.close();
    }
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("Integration status/history/wait succeed against an existing daemon without lifecycle mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-int-observer-active-"));
  const seeded = seedCompletedIntegration(home);
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    // Deterministic lifecycle facts BEFORE any observation: the daemon PID and
    // the durable Task / Integration result / event / exchange-receipt counts.
    const healthBefore = await daemonRequest<Record<string, unknown>>("health", {}, home);
    const pidBefore = healthBefore.pid as number;
    const beforeFacts = (() => {
      const store = new StateStore(home);
      try {
        return {
          tasks: store.listTasks().length,
          results: store.listRecentIntegrationResults(100).length,
          events: store.listEvents(seeded.taskId).length,
          receipts: store.listExchangeReceipts(seeded.taskId).length,
        };
      } finally {
        store.close();
      }
    })();

    const status = await runCli(home, [
      "integration", "status", seeded.operationId, "--json",
    ]);
    assert.equal(status.code, 0, status.stderr);
    const statusBody = JSON.parse(status.stdout) as Record<string, unknown>;
    assert.equal(statusBody.operationId, seeded.operationId);
    assert.equal(statusBody.taskId, seeded.taskId);
    assert.equal(statusBody.receiptId, seeded.receiptId);
    assert.equal(statusBody.status, "completed");
    assert.ok(Array.isArray(statusBody.stages));
    // Compact default: no full command streams.
    assert.doesNotMatch(status.stdout, /"commands"/);
    assert.ok(!status.stdout.includes("runnerPid"), "status JSON must not expose runnerPid");

    const deep = await runCli(home, [
      "integration", "status", seeded.operationId, "--json", "--deep-audit",
    ]);
    assert.equal(deep.code, 0, deep.stderr);
    const deepBody = JSON.parse(deep.stdout) as Record<string, unknown>;
    assert.equal(deepBody.operationId, seeded.operationId);
    assert.equal(deepBody.status, "completed");
    assert.ok(deepBody.result !== undefined, "deep-audit retains the result snapshot");
    assert.ok(!deep.stdout.includes("runnerPid"), "deep status JSON must not expose runnerPid");

    const history = await runCli(home, [
      "integration", "history", seeded.taskId, "--json",
    ]);
    assert.equal(history.code, 0, history.stderr);
    const historyBody = JSON.parse(history.stdout) as {
      receipts: unknown[];
      results: Array<Record<string, unknown>>;
    };
    assert.ok(Array.isArray(historyBody.receipts));
    assert.equal(historyBody.results.length, 1);
    assert.equal(historyBody.results[0]!.id, seeded.operationId);
    assert.equal(historyBody.results[0]!.status, "applied");
    assert.ok(!history.stdout.includes("runnerPid"), "history JSON must not expose runnerPid");

    const wait = await runCli(home, [
      "integration", "wait", seeded.operationId, "--timeout-ms", "2000", "--json",
    ]);
    assert.equal(wait.code, 0, wait.stderr);
    const waitBody = JSON.parse(wait.stdout) as Record<string, unknown>;
    const waitResult = waitBody.result as { status?: string } | undefined;
    assert.equal(waitBody.operationId, seeded.operationId);
    assert.equal(waitBody.status, "completed");
    assert.equal(waitResult?.status, "applied");
    assert.ok(!wait.stdout.includes("runnerPid"), "wait JSON must not expose runnerPid");

    // Deterministic AFTER facts: the same daemon is still the endpoint owner and
    // the durable Task / Integration result / event counts are unchanged. Only
    // the four attributable CLI exchange receipts are added (status, deep-audit
    // status, history, wait). No scheduler-speed assertion is needed.
    const healthAfter = await daemonRequest<Record<string, unknown>>("health", {}, home);
    assert.equal(healthAfter.pid, pidBefore, "observation must not replace the daemon PID");
    const storeAfter = new StateStore(home);
    try {
      assert.equal(storeAfter.listTasks().length, beforeFacts.tasks, "observation must not create Tasks");
      const resultsAfter = storeAfter.listRecentIntegrationResults(100);
      assert.equal(resultsAfter.length, beforeFacts.results, "observation must not change Integration result count");
      assert.equal(resultsAfter[0]?.id, seeded.operationId, "the same durable result remains");
      assert.equal(storeAfter.listEvents(seeded.taskId).length, beforeFacts.events, "observation must not add daemon events");
      assert.equal(
        storeAfter.listExchangeReceipts(seeded.taskId).length,
        beforeFacts.receipts + 4,
        "only the four CLI exchange receipts may be added",
      );
    } finally {
      storeAfter.close();
    }
  } finally {
    await daemon.close();
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

function selfUpgradeDeliveryPlan(): DeliveryPlanView {
  return {
    resolutionSource: "explicit",
    profileId: SELF_UPGRADE_DELIVERY_PROFILE_ID,
    buildCommandCount: 1,
    activationCommandCount: 1,
    activationCheckCommandCount: 1,
    outcome: "activation",
    stages: {
      sourceApply: "required",
      sourceVerify: "required",
      artifactBuild: "required",
      runtimeActivation: "required",
    },
  };
}

function ordinaryDeliveryPlan(): DeliveryPlanView {
  return {
    resolutionSource: "inline",
    buildCommandCount: 0,
    activationCommandCount: 0,
    activationCheckCommandCount: 0,
    outcome: "source-only",
    stages: {
      sourceApply: "required",
      sourceVerify: "required",
      artifactBuild: "not-configured",
      runtimeActivation: "not-configured",
    },
  };
}

function seedSelfUpgradePair(home: string): void {
  const store = new StateStore(home);
  const four = [
    { stage: "source-applied" as const, status: "passed" as const },
    { stage: "source-verified" as const, status: "passed" as const },
    { stage: "artifact-built" as const, status: "passed" as const },
    { stage: "runtime-activated" as const, status: "passed" as const },
  ];
  const TS_OK = "2026-07-30T12:00:00.000Z";
  const TS_FAIL = "2026-07-30T11:00:00.000Z";
  for (const [taskId, ts] of [
    ["task-sue-ok", TS_OK],
    ["task-sue-fail", TS_FAIL],
  ] as const) {
    store.createTask({
      id: taskId,
      name: taskId,
      status: "succeeded",
      sourcePath: "/source",
      taskFile: `/task-${taskId}.yaml`,
      spec: { provider: { name: "deepseek", model: "v4" } } as TaskRecord["spec"],
      paths: {} as TaskRecord["paths"],
      sessionId: `session-${taskId}`,
      createdAt: ts,
      updatedAt: ts,
    });
  }
  store.saveIntegrationReceipt({
    id: "receipt-sue-ok",
    taskId: "task-sue-ok",
    patchDigest: "a".repeat(64),
    affectedFiles: ["value.txt"],
    rejectionReasons: [],
    sourceEvidence: {},
    createdAt: TS_OK,
    expiresAt: "2099-01-01T00:00:00.000Z",
    consumed: true,
    deliveryPlan: selfUpgradeDeliveryPlan(),
  });
  store.saveIntegrationResult({
    id: "efa7d9ae-61c9-421a-a1b5-d427d9353a81",
    receiptId: "receipt-sue-ok",
    taskId: "task-sue-ok",
    status: "applied",
    appliedAt: TS_OK,
    createdAt: TS_OK,
    stages: four,
  });
  store.saveIntegrationReceipt({
    id: "receipt-sue-fail",
    taskId: "task-sue-fail",
    patchDigest: "b".repeat(64),
    affectedFiles: ["value.txt"],
    rejectionReasons: [],
    sourceEvidence: {},
    createdAt: TS_FAIL,
    expiresAt: "2099-01-01T00:00:00.000Z",
    consumed: true,
    deliveryPlan: selfUpgradeDeliveryPlan(),
  });
  store.saveIntegrationResult({
    id: "66ba9a77-f518-4a37-836f-043e2b70c316",
    receiptId: "receipt-sue-fail",
    taskId: "task-sue-fail",
    status: "retained-failure",
    createdAt: TS_FAIL,
    error: "secret /Users/private/path sk-live-abc",
    stages: [
      { stage: "source-applied", status: "passed" },
      { stage: "source-verified", status: "passed" },
      { stage: "artifact-built", status: "passed" },
      {
        stage: "runtime-activated",
        status: "failed",
        error: "secret /Users/private/path",
      },
    ],
  });
  store.close();
}

/** Live-history shape: three self-upgrade successes, then ordinary Elsewhere applied. */
function seedLiveHistoryReadyStreak(home: string): void {
  const store = new StateStore(home);
  const four = [
    { stage: "source-applied" as const, status: "passed" as const },
    { stage: "source-verified" as const, status: "passed" as const },
    { stage: "artifact-built" as const, status: "passed" as const },
    { stage: "runtime-activated" as const, status: "passed" as const },
  ];
  const sourceOnly = [
    { stage: "source-applied" as const, status: "passed" as const },
    { stage: "source-verified" as const, status: "passed" as const },
    { stage: "artifact-built" as const, status: "not-applicable" as const },
    { stage: "runtime-activated" as const, status: "not-applicable" as const },
  ];
  const successes: Array<[string, string, string]> = [
    ["task-sue-1", "sue-hist-1", "2026-07-28T10:00:00.000Z"],
    ["task-sue-2", "sue-hist-2", "2026-07-28T11:00:00.000Z"],
    ["task-sue-3", "sue-hist-3", "2026-07-28T12:00:00.000Z"],
  ];
  for (const [taskId, resultId, ts] of successes) {
    store.createTask({
      id: taskId,
      name: taskId,
      status: "succeeded",
      sourcePath: "/source",
      taskFile: `/task-${taskId}.yaml`,
      spec: { provider: { name: "deepseek", model: "v4" } } as TaskRecord["spec"],
      paths: {} as TaskRecord["paths"],
      sessionId: `session-${taskId}`,
      createdAt: ts,
      updatedAt: ts,
    });
    store.saveIntegrationReceipt({
      id: `receipt-${resultId}`,
      taskId,
      patchDigest: "a".repeat(64),
      affectedFiles: ["src/core/self-upgrade-evidence.ts"],
      rejectionReasons: [],
      sourceEvidence: {},
      createdAt: ts,
      expiresAt: "2099-01-01T00:00:00.000Z",
      consumed: true,
      deliveryPlan: selfUpgradeDeliveryPlan(),
    });
    store.saveIntegrationResult({
      id: resultId,
      receiptId: `receipt-${resultId}`,
      taskId,
      status: "applied",
      appliedAt: ts,
      createdAt: ts,
      stages: four,
    });
  }
  // Ordinary Elsewhere contamination (real history id shape).
  const elsewhereTs = "2026-07-30T15:00:00.000Z";
  store.createTask({
    id: "task-elsewhere",
    name: "task-elsewhere",
    status: "succeeded",
    sourcePath: "/elsewhere",
    taskFile: "/task-elsewhere.yaml",
    spec: { provider: { name: "deepseek", model: "v4" } } as TaskRecord["spec"],
    paths: {} as TaskRecord["paths"],
    sessionId: "session-elsewhere",
    createdAt: elsewhereTs,
    updatedAt: elsewhereTs,
  });
  store.saveIntegrationReceipt({
    id: "receipt-elsewhere",
    taskId: "task-elsewhere",
    patchDigest: "b".repeat(64),
    affectedFiles: ["app.tsx"],
    rejectionReasons: [],
    sourceEvidence: {},
    createdAt: elsewhereTs,
    expiresAt: "2099-01-01T00:00:00.000Z",
    consumed: true,
    deliveryPlan: ordinaryDeliveryPlan(),
  });
  store.saveIntegrationResult({
    id: "7fdbec6b-d122-4bb4-b4b4-b9263146fd65",
    receiptId: "receipt-elsewhere",
    taskId: "task-elsewhere",
    status: "applied",
    appliedAt: elsewhereTs,
    createdAt: elsewhereTs,
    stages: sourceOnly,
  });
  store.close();
}

test("upgrade status CLI is read-only observer and reports 1/3 with retained-failure break", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sue-cli-"));
  seedSelfUpgradePair(home);
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const jsonRun = await runCli(home, ["upgrade", "status", "--json"]);
    assert.equal(jsonRun.code, 0, jsonRun.stderr);
    const body = JSON.parse(jsonRun.stdout) as Record<string, unknown>;
    assert.equal(body.achieved, 1);
    assert.equal(body.required, 3);
    assert.equal(body.remaining, 2);
    assert.equal(body.state, "in-progress");
    assert.equal(body.breakCategory, "retained-failure");
    assert.equal(body.nextAction, "continue-consecutive-proofs");
    assert.ok(!jsonRun.stdout.includes("sk-live"));
    assert.ok(!jsonRun.stdout.includes("/Users/private"));
    assert.ok(!jsonRun.stdout.includes("secret"));

    const human = await runCli(home, ["upgrade", "status"]);
    assert.equal(human.code, 0, human.stderr);
    assert.match(human.stdout, /1 of 3 consecutive complete upgrades/);
    assert.match(human.stdout, /failed during activation and broke the streak/i);
    assert.match(human.stdout, /2 more consecutive complete upgrade/);
    assert.match(human.stdout, /Next: Run more complete self-upgrades/i);
    // Machine codes stay in JSON only; human output is plain language.
    assert.doesNotMatch(human.stdout, /breakCategory:/);
    assert.doesNotMatch(human.stdout, /nextAction:/);
    assert.doesNotMatch(human.stdout, /continue-consecutive-proofs/);
    assert.doesNotMatch(human.stdout, /retained-failure/);
    assert.ok(!human.stdout.includes("sk-live"));
    assert.ok(!human.stdout.includes("/Users/private"));

    const audit = await runCli(home, [
      "upgrade", "status", "--required", "5", "--json",
    ]);
    assert.equal(audit.code, 0, audit.stderr);
    const auditBody = JSON.parse(audit.stdout) as Record<string, unknown>;
    assert.equal(auditBody.required, 5);
    assert.equal(auditBody.achieved, 1);
    assert.equal(auditBody.remaining, 4);

    const bad = await runCli(home, ["upgrade", "status", "--required", "99"]);
    assert.notEqual(bad.code, 0);
    assert.match(bad.stderr, /1 to 20|1–20|required/i);
  } finally {
    await daemon.close();
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("upgrade status never starts a daemon when none is running", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sue-cli-nod-"));
  try {
    const result = await runCli(home, ["upgrade", "status", "--json"]);
    assert.notEqual(result.code, 0);
    assertObserverUnavailableGuidance(result.stderr, home);
    assert.ok(!existsSync(daemonSocketPath(home)), "observer must not create a daemon socket");
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("upgrade status stays 3/3 when newer ordinary Elsewhere Integration is applied", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sue-cli-ready-"));
  seedLiveHistoryReadyStreak(home);
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const jsonRun = await runCli(home, ["upgrade", "status", "--required", "3", "--json"]);
    assert.equal(jsonRun.code, 0, jsonRun.stderr);
    const body = JSON.parse(jsonRun.stdout) as Record<string, unknown>;
    assert.equal(body.achieved, 3);
    assert.equal(body.required, 3);
    assert.equal(body.remaining, 0);
    assert.equal(body.state, "ready");
    assert.equal(body.breakCategory, "none");
    assert.equal(body.nextAction, "milestone-ready");
    assert.equal(body.breakOperationId, undefined);
    assert.equal(body.latestQualifyingOperationId, "sue-hist-3");
    assert.ok(!jsonRun.stdout.includes("7fdbec6b"));
    assert.ok(!jsonRun.stdout.includes("elsewhere"));

    const human = await runCli(home, ["upgrade", "status", "--required", "3"]);
    assert.equal(human.code, 0, human.stderr);
    assert.match(human.stdout, /3 of 3 consecutive complete upgrades/);
    assert.ok(!human.stdout.includes("7fdbec6b"));
    assert.ok(!human.stdout.includes("/Users/private"));
  } finally {
    await daemon.close();
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});
