import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { currentBuildIdentity } from "../src/core/build-identity.js";
import type { RoutingAdvisoryResponse } from "../src/core/model-routing.js";
import { buildTaskRecord, registerTaskFromSpec } from "../src/core/runner.js";
import { parseTaskSpec } from "../src/core/task.js";
import type { ProviderAuthInspector } from "../src/core/providers.js";
import { DaemonCoordinator } from "../src/daemon/coordinator.js";
import { daemonLogPath, daemonSocketPath, taskPaths } from "../src/core/config.js";
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
import { cloneDefaults, SettingsService } from "../src/core/settings.js";
import { captureCandidateRevision } from "../src/core/candidate-revision.js";
import {
  createReviewGraph,
  reconcileAllReviewGraphs,
  reconcileReviewResultRepair,
} from "../src/core/review-graph.js";
import { prepareWorkspace } from "../src/workspace/copy.js";
import { createPathPolicy } from "../src/workspace/path-policy.js";
import { writeWorkspacePatchReport } from "../src/workspace/patch.js";
import { formatRoutingAdviceHuman } from "../src/cli/routing-output.js";
import { projectSafeRoutingExplanation } from "../src/core/routing-explanation.js";
import {
  buildTaskAdmissionPreview,
  formatTaskAdmissionPreviewHuman,
} from "../src/core/task-preview.js";
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

test("CLI validate/preview renders the frozen advisory relationship without private fields", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-adv-"));
  try {
    await mkdir(path.join(home, "project"));
    const deepseek = {
      provider: "deepseek",
      model: "deepseek-v4-flash",
      runtime: "claude-code",
      effort: "high",
      workerProfileId: "default",
    };
    const qwen = {
      provider: "qwen",
      model: "qwen3.7-plus",
      runtime: "claude-code",
      effort: "high",
    };
    const routingDecision = {
      taskFamily: "refactor",
      shortlist: [deepseek, qwen],
      selectedWorker: deepseek,
      selectedBecause: { code: "user-specified", note: "PRIVATE_CLI_M3B_NOTE" },
      competition: { intent: "none", triggers: [] },
      evidenceSnapshot: {
        scope: "none",
        exactSampleCounts: { SECRET_CLI_SAMPLE_KEY: 0 },
        settingsDigest: "SECRET_CLI_SETTINGS_DIGEST",
      },
      advisory: {
        overallResult: "recommended",
        selection: "followed-recommendation",
        recommendedWorker: deepseek,
        confidence: 0.91,
        selectedExecution: {
          resolvedExecutionMode: "single-run",
          readinessState: "launchable",
          canLaunch: true,
          nextAction: "none",
        },
      },
    };
    const writeCliTask = async (fileName: string, decision: unknown): Promise<string> => {
      const file = path.join(home, fileName);
      await writeFile(
        file,
        `version: 2
name: CLI Advisory Preview
project: ./project
workerProfileId: default
taskFamily: refactor
worker:
  focusPaths: [src]
contract:
  outcome: CLI validate renders the frozen advisory relationship
  context: [current settings]
  inScope: [preview]
  outOfScope: [mutation]
  executionSteps: [validate]
  deliverables: [safe preview]
  modules:
    - name: cli
      responsibility: render the same safe routing explanation as Core
      consumes: [task file]
      produces: [preview]
      boundaries: [no Task mutation]
  callChain: [cli, preview]
  scenarios:
    - name: followed
      given: advisory
      when: validate
      then: same facts
    - name: private
      given: note
      when: validate
      then: hidden
  risks: [leak]
  changeBudget:
    maxFiles: 4
    maxDiffLines: 80
acceptance:
  criteria: [safe]
  commands:
    - "true"
routingDecision: ${JSON.stringify(decision)}
`,
      );
      return file;
    };
    const taskFile = await writeCliTask("task.yaml", routingDecision);
    const jsonResult = await runCli(home, ["validate", taskFile, "--json"], 20_000);
    assert.ok(jsonResult.stdout.trim().length > 0, jsonResult.stderr || "CLI validate --json produced no preview");
    const preview = JSON.parse(jsonResult.stdout) as {
      routingExplanation: ReturnType<typeof projectSafeRoutingExplanation>;
    };
    assert.equal(preview.routingExplanation.advisory!.selection, "followed-recommendation");
    assert.equal(preview.routingExplanation.advisory!.confidence, 0.91);
    assert.deepEqual(preview.routingExplanation.advisory!.recommendedWorker, deepseek);

    const settings = cloneDefaults();
    const viaPreview = await buildTaskAdmissionPreview(taskFile, settings);
    assert.deepEqual(viaPreview.routingExplanation, preview.routingExplanation);
    assert.equal(viaPreview.routingExplanation.advisory!.selection, "followed-recommendation");
    const humanResult = await runCli(home, ["validate", taskFile], 20_000);
    assert.ok(humanResult.stdout.includes("Routing explanation:"), humanResult.stderr);
    assert.match(humanResult.stdout, /Advisory result: recommended/);
    assert.match(humanResult.stdout, /Selection: followed-recommendation/);
    assert.match(humanResult.stdout, /Confidence: 0\.91/);
    assert.equal(humanResult.stdout, formatTaskAdmissionPreviewHuman(viaPreview));
    const serialized = `${jsonResult.stdout}\n${humanResult.stdout}`;
    assert.ok(!serialized.includes("PRIVATE_CLI_M3B_NOTE"));
    assert.ok(!serialized.includes("SECRET_CLI_SAMPLE_KEY"));
    assert.ok(!serialized.includes("SECRET_CLI_SETTINGS_DIGEST"));

    const twin = { ...deepseek, workerProfileId: "default-twin" };
    const overrideFile = await writeCliTask("override.yaml", {
      ...routingDecision,
      shortlist: [deepseek, twin],
      advisory: {
        overallResult: "recommended",
        selection: "manual-override",
        recommendedWorker: twin,
        confidence: 0.84,
        selectedExecution: routingDecision.advisory.selectedExecution,
      },
    });
    const overrideJson = await runCli(home, ["validate", overrideFile, "--json"], 20_000);
    const overridePreview = JSON.parse(overrideJson.stdout) as {
      routingExplanation: { advisory?: { selection?: string; recommendedWorker?: { workerProfileId?: string } } };
    };
    assert.equal(overridePreview.routingExplanation.advisory?.selection, "manual-override");
    assert.equal(
      overridePreview.routingExplanation.advisory?.recommendedWorker?.workerProfileId,
      "default-twin",
    );

    const mismatchFile = await writeCliTask("mismatch.yaml", {
      ...routingDecision,
      advisory: {
        ...routingDecision.advisory,
        selectedExecution: {
          ...routingDecision.advisory.selectedExecution,
          resolvedExecutionMode: "native-goal",
        },
      },
    });
    const mismatchResult = await runCli(home, ["validate", mismatchFile, "--json"], 20_000);
    assert.notEqual(mismatchResult.code, 0);
    assert.match(
      `${mismatchResult.stderr}\n${mismatchResult.stdout}`,
      /does not match resolved Task executionMode/,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
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
    overallResult: "recommended",
    cannotDetermineReasons: [],
  } as unknown as RoutingAdvisoryResponse;

  const output = formatRoutingAdviceHuman(advisory);
  assert.match(output, /Overall result: recommended/);
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
    assert.ok("overallResult" in advisory, "must include overallResult");
    assert.ok("cannotDetermineReasons" in advisory, "must include cannotDetermineReasons");
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

test("storage reclaim rejects missing confirm before daemon contact", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-storage-noconfirm-"));
  try {
    const result = await runCli(home, ["storage", "reclaim", "--task", "task-1"]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /requires explicit --confirm/);
    assert.equal(existsSync(daemonSocketPath(home)), false);
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("storage CLI audit, preview, and reclaim share lifecycle semantics", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-storage-"));
  const taskId = "cli-storage-delivered";
  const store = new StateStore(home);
  const timestamp = "2026-08-14T00:00:00.000Z";
  const paths = taskPaths(home, taskId);
  store.createTask({
    id: taskId,
    name: taskId,
    status: "succeeded",
    sourcePath: "/source",
    taskFile: "/task.yaml",
    spec: {
      provider: { name: "deepseek", model: "deepseek-v4-pro[1M]" },
      runtime: { name: "claude-code" },
    } as TaskRecord["spec"],
    paths,
    sessionId: "session-cli-storage",
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
  });
  store.addEvent(taskId, undefined, "integration.operation.started", "started", {
    operationId: "cli-storage-op",
    taskId,
    receiptId: "cli-storage-receipt",
  });
  store.saveIntegrationReceipt({
    id: "cli-storage-receipt",
    taskId,
    patchDigest: "d".repeat(64),
    affectedFiles: ["src/cli.ts"],
    rejectionReasons: [],
    sourceEvidence: {},
    createdAt: timestamp,
    expiresAt: "2099-01-01T00:00:00.000Z",
    consumed: true,
  });
  store.saveIntegrationResult({
    id: "cli-storage-op",
    receiptId: "cli-storage-receipt",
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
  });
  store.close();
  await mkdir(paths.workspace, { recursive: true });
  await writeFile(path.join(paths.workspace, "gone.ts"), "workspace");
  await mkdir(paths.logs, { recursive: true });
  await writeFile(path.join(paths.logs, "worker.log"), "durable");

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const audit = await runCli(home, ["storage", "audit", "--json"]);
    assert.equal(audit.code, 0, audit.stderr);
    const auditBody = JSON.parse(audit.stdout) as {
      kind?: string;
      nextAction?: string;
      entries?: Array<{ taskId?: string; classification?: string }>;
    };
    assert.equal(auditBody.kind, "storage-audit");
    assert.equal(
      auditBody.entries?.find((entry) => entry.taskId === taskId)?.classification,
      "reclaimable",
    );

    const human = await runCli(home, ["storage", "preview", "--task", taskId]);
    assert.equal(human.code, 0, human.stderr);
    assert.match(human.stdout, /nextAction: confirm-reclaim/);
    assert.match(human.stdout, /reason: integration-delivered/);

    const reclaim = await runCli(home, [
      "storage", "reclaim", "--task", taskId, "--confirm", "--json",
    ]);
    assert.equal(reclaim.code, 0, reclaim.stderr);
    const reclaimBody = JSON.parse(reclaim.stdout) as {
      kind?: string;
      results?: Array<{ applied?: boolean }>;
    };
    assert.equal(reclaimBody.kind, "storage-reclaim");
    assert.equal(reclaimBody.results?.[0]?.applied, true);
    await assert.rejects(() => readFile(path.join(paths.workspace, "gone.ts"), "utf8"));
    assert.equal(await readFile(path.join(paths.logs, "worker.log"), "utf8"), "durable");
  } finally {
    await daemon.close();
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("storage audit and preview write no CLI exchange receipts", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-storage-noreceipt-"));
  const taskId = "cli-storage-preview-task";
  const store = new StateStore(home);
  const timestamp = "2026-08-14T00:00:00.000Z";
  const paths = taskPaths(home, taskId);
  store.createTask({
    id: taskId,
    name: taskId,
    status: "succeeded",
    sourcePath: "/source",
    taskFile: "/task.yaml",
    spec: {
      provider: { name: "deepseek", model: "deepseek-v4-pro[1M]" },
      runtime: { name: "claude-code" },
    } as TaskRecord["spec"],
    paths,
    sessionId: "session-cli-storage-preview",
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
  });
  store.addEvent(taskId, undefined, "integration.operation.started", "started", {
    operationId: "cli-storage-preview-op",
    taskId,
    receiptId: "cli-storage-preview-receipt",
  });
  store.saveIntegrationReceipt({
    id: "cli-storage-preview-receipt",
    taskId,
    patchDigest: "d".repeat(64),
    affectedFiles: ["src/cli.ts"],
    rejectionReasons: [],
    sourceEvidence: {},
    createdAt: timestamp,
    expiresAt: "2099-01-01T00:00:00.000Z",
    consumed: true,
  });
  store.saveIntegrationResult({
    id: "cli-storage-preview-op",
    receiptId: "cli-storage-preview-receipt",
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
  });
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const audit = await runCli(home, ["storage", "audit", "--json"]);
    assert.equal(audit.code, 0, audit.stderr);
    const preview = await runCli(home, ["storage", "preview", "--task", taskId, "--json"]);
    assert.equal(preview.code, 0, preview.stderr);
    const after = new StateStore(home);
    try {
      assert.equal(after.listExchangeReceipts(taskId).length, 0);
    } finally {
      after.close();
    }
    const cliSource = await readFile(new URL("../src/cli.ts", import.meta.url), "utf8");
    // Anchor inside the storage command block so adaptation preview/apply
    // (earlier in the file) cannot satisfy or poison the zero-receipt check.
    const storageIdx = cliSource.indexOf('if (command === "storage")');
    assert.ok(storageIdx > 0, "storage command block must exist");
    const storageBlockEnd = cliSource.indexOf(
      "throw new Error(`Unknown storage subcommand:",
      storageIdx,
    );
    assert.ok(storageBlockEnd > storageIdx, "storage command block must have a closed end");
    const storageBlock = cliSource.slice(storageIdx, storageBlockEnd);
    const auditIdx = storageBlock.indexOf('if (subcommand === "audit")');
    const previewIdx = storageBlock.indexOf('if (subcommand === "preview")');
    const reclaimIdx = storageBlock.indexOf('if (subcommand === "reclaim")');
    assert.ok(auditIdx >= 0 && previewIdx > auditIdx && reclaimIdx > previewIdx);
    assert.ok(!storageBlock.slice(auditIdx, reclaimIdx).includes("withCliExchangeReceipt"));
  } finally {
    await daemon.close();
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

async function seedTwoJudgeOverlimitGraph(home: string, taskId: string): Promise<{
  assignmentId: string;
  revisionId: string;
}> {
  const sourceDir = path.join(home, "source");
  await mkdir(path.join(sourceDir, "src"), { recursive: true });
  await writeFile(path.join(sourceDir, "readme.md"), "# hello\n\nOriginal.\n");
  await writeFile(path.join(sourceDir, "src/app.ts"), "export const n = 1;\n");
  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const paths = taskPaths(home, taskId);
  const spec = {
    version: 1 as const,
    name: "CLI repair fixture",
    project: sourceDir,
    goal: "Ship a small change",
    constraints: [],
    provider: {
      name: "deepseek" as const,
      model: "deepseek-v4-flash",
      keychainService: "forklight.deepseek.api-key",
    },
    runtime: {
      name: "claude-code" as const,
      executable: "claude",
      effort: "low" as const,
      maxBudgetUsd: 0.1,
    },
    workspace: { exclude: [".git", "node_modules"] },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src", "readme.md"] },
    acceptance: { commands: ["true"] },
  };
  await prepareWorkspace(spec, paths);
  await mkdir(path.join(paths.workspace, "src"), { recursive: true });
  await writeFile(path.join(paths.workspace, "readme.md"), "# hello\n\nChanged.\n");
  await writeFile(path.join(paths.workspace, "src/app.ts"), "export const n = 2;\n");
  await writeWorkspacePatchReport(paths, createPathPolicy(spec));
  const now = new Date().toISOString();
  store.createTask({
    id: taskId,
    name: spec.name,
    status: "succeeded",
    sourcePath: sourceDir,
    taskFile: "forklight://test/cli-repair",
    spec,
    paths,
    sessionId: "session-cli-repair",
    currentAttemptId: "attempt-cli-repair",
    createdAt: now,
    updatedAt: now,
  });
  store.createAttempt({
    id: "attempt-cli-repair",
    taskId,
    ordinal: 1,
    status: "succeeded",
    sessionId: "session-cli-repair",
    rawLogPath: path.join(paths.logs, "attempt-1.jsonl"),
    startedAt: now,
    finishedAt: now,
    exitCode: 0,
  });
  const verEvent = store.addEvent(taskId, "attempt-cli-repair", "verification.completed", "passed", {
    passed: true,
    behaviorPassed: true,
    policyPassed: true,
    sourceCompatible: true,
    commands: [{ command: "true", exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false }],
    diffPath: paths.diff,
    sourceUnchanged: true,
  });
  const revision = await captureCandidateRevision(
    store,
    store.getTask(taskId),
    store.getAttempt("attempt-cli-repair"),
    verEvent.sequence,
    true,
    ["readme.md", "src/app.ts"],
    2,
    4,
  );
  const profileA = settings.get().workerProfiles.defaultProfileId;
  const profileB = settings.get().workerProfiles.profiles.find((profile) => profile.id !== profileA)!.id;
  const created = await createReviewGraph(store, settings.get(), {
    candidateTaskId: taskId,
    reviewerWorkerProfileIds: [profileA, profileB],
    reason: "CLI repair fixture",
    confirm: true,
  });
  const [usable, failed] = store.listReviewAssignments(created.graph.id);
  const finish = (reviewerTaskId: string, resultText: string) => {
    const task = store.getTask(reviewerTaskId);
    store.createAttempt({
      id: `att-${reviewerTaskId}`,
      taskId: reviewerTaskId,
      ordinal: 1,
      status: "succeeded",
      sessionId: task.sessionId,
      rawLogPath: path.join(task.paths.logs, "attempt-1.jsonl"),
      startedAt: now,
      finishedAt: now,
      exitCode: 0,
      resultText,
    });
    store.setTaskStatus(reviewerTaskId, "succeeded", {
      finishedAt: now,
      currentAttemptId: `att-${reviewerTaskId}`,
    });
  };
  finish(usable!.reviewerTaskId, JSON.stringify({
    schemaVersion: 1,
    reviewedRevisionId: revision.id,
    proposedDisposition: "accept",
    summary: "Usable first opinion",
    findings: [],
  }));
  finish(failed!.reviewerTaskId, JSON.stringify({
    schemaVersion: 1,
    reviewedRevisionId: revision.id,
    proposedDisposition: "accept",
    summary: "s".repeat(507),
    findings: [],
  }));
  reconcileAllReviewGraphs(store);
  const assignmentId = failed!.id;
  store.close();
  return { assignmentId, revisionId: revision.id };
}

test("CLI review-graph repair-result requires confirm, is one-shot, and stays privacy-safe", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-repair-"));
  const taskId = "cli-repair-candidate";
  const seeded = await seedTwoJudgeOverlimitGraph(home, taskId);
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const missing = await runCli(home, [
      "review-graph", "repair-result", taskId,
      "--assignment", seeded.assignmentId,
      "--reason", "shorten summary",
    ]);
    assert.notEqual(missing.code, 0);
    assert.match(`${missing.stderr}\n${missing.stdout}`, /confirm/i);

    const first = await runCli(home, [
      "review-graph", "repair-result", taskId,
      "--assignment", seeded.assignmentId,
      "--reason", "shorten summary",
      "--confirm",
      "--json",
    ]);
    assert.equal(first.code, 0, first.stderr);
    const body = JSON.parse(first.stdout) as Record<string, unknown>;
    const graph = body.graph as Record<string, unknown>;
    assert.equal(body.created, true);
    assert.equal(body.originalFailureCode, "schema-violation");
    assert.equal((graph.assignments as unknown[]).length, 2);
    assert.equal(graph.requiresFreshMainReview === true || graph.nextActionCode === "wait-for-result-repair", true);
    const leakText = `${first.stdout}\n${first.stderr}`;
    assert.ok(!leakText.includes("privatePacketPath"));
    assert.ok(!leakText.includes("packet.json"));
    assert.ok(!leakText.includes("s".repeat(507)));
    assert.ok(!leakText.includes("keychain"));
    assert.ok(!/\/Users\//.test(leakText));

    const second = await runCli(home, [
      "review-graph", "repair-result", taskId,
      "--assignment", seeded.assignmentId,
      "--reason", "shorten summary again",
      "--confirm",
      "--json",
    ]);
    assert.notEqual(second.code, 0);
    assert.match(`${second.stderr}\n${second.stdout}`, /already consumed|one-shot/i);

    const human = await runCli(home, [
      "review-graph", "repair-result", taskId,
      "--assignment", seeded.assignmentId,
      "--reason", "human path also closed",
      "--confirm",
    ]);
    assert.notEqual(human.code, 0);
  } finally {
    await daemon.close();
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("CLI review-graph status shows resultRepair lifecycle and stays privacy-safe", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-repair-status-"));
  const taskId = "cli-repair-status-candidate";
  const seeded = await seedTwoJudgeOverlimitGraph(home, taskId);
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const created = await runCli(home, [
      "review-graph", "repair-result", taskId,
      "--assignment", seeded.assignmentId,
      "--reason", "shorten summary",
      "--confirm",
      "--json",
    ]);
    assert.equal(created.code, 0, created.stderr);
    const createdBody = JSON.parse(created.stdout) as Record<string, unknown>;
    const repairTaskId = String(createdBody.repairTaskId);

    const queuedHuman = await runCli(home, ["review-graph", "status", taskId]);
    const queuedJson = await runCli(home, ["review-graph", "status", taskId, "--json"]);
    assert.equal(queuedHuman.code, 0, queuedHuman.stderr);
    assert.equal(queuedJson.code, 0, queuedJson.stderr);
    const queuedGraph = JSON.parse(queuedJson.stdout) as {
      assignments: Array<{
        id: string;
        resultRepair?: { status?: string; resultUsable?: boolean; failureCode?: string };
      }>;
    };
    const queuedRepair = queuedGraph.assignments.find((row) => row.id === seeded.assignmentId)?.resultRepair;
    assert.ok(queuedRepair);
    assert.match(
      queuedHuman.stdout,
      new RegExp(`repair: status=${String(queuedRepair.status)} usable=${String(queuedRepair.resultUsable)}`),
    );
    assert.equal(queuedHuman.stdout.includes("failure="), false);

    await daemon.close();
    const store = new StateStore(home);
    const now = new Date().toISOString();
    const repairTask = store.getTask(repairTaskId);
    store.createAttempt({
      id: `att-${repairTaskId}`,
      taskId: repairTaskId,
      ordinal: 1,
      status: "succeeded",
      sessionId: repairTask.sessionId,
      rawLogPath: path.join(repairTask.paths.logs, "attempt-1.jsonl"),
      startedAt: now,
      finishedAt: now,
      exitCode: 0,
      resultText: JSON.stringify({
        schemaVersion: 1,
        reviewedRevisionId: seeded.revisionId,
        proposedDisposition: "reject",
        summary: "Drifted disposition",
        findings: [],
      }),
    });
    store.setTaskStatus(repairTaskId, "succeeded", {
      finishedAt: now,
      currentAttemptId: `att-${repairTaskId}`,
    });
    reconcileReviewResultRepair(store, seeded.assignmentId);
    store.close();

    const restarted = new ForkLightDaemon(home, 0);
    await restarted.start();
    try {
      const failedHuman = await runCli(home, ["review-graph", "status", taskId]);
      const failedJson = await runCli(home, ["review-graph", "status", taskId, "--json"]);
      assert.equal(failedHuman.code, 0, failedHuman.stderr);
      assert.equal(failedJson.code, 0, failedJson.stderr);
      const failedGraph = JSON.parse(failedJson.stdout) as {
        assignments: Array<{
          id: string;
          resultRepair?: { status?: string; resultUsable?: boolean; failureCode?: string };
        }>;
      };
      const failedRepair = failedGraph.assignments.find((row) => row.id === seeded.assignmentId)?.resultRepair;
      assert.ok(failedRepair);
      assert.equal(failedRepair.status, "failed");
      assert.equal(failedRepair.resultUsable, false);
      assert.ok(failedRepair.failureCode);
      assert.match(
        failedHuman.stdout,
        new RegExp(
          `repair: status=${String(failedRepair.status)} usable=${String(failedRepair.resultUsable)} failure=${String(failedRepair.failureCode)}`,
        ),
      );
      const leakText = `${failedHuman.stdout}\n${failedHuman.stderr}\n${queuedHuman.stdout}`;
      assert.ok(!leakText.includes("privatePacketPath"));
      assert.ok(!leakText.includes("packet.json"));
      assert.ok(!leakText.includes("s".repeat(507)));
      assert.ok(!leakText.includes("keychain"));
      assert.ok(!/\/Users\//.test(leakText));
    } finally {
      await restarted.close();
    }
  } finally {
    await daemon.close().catch(() => undefined);
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

function routingAuthInspector(ready: boolean): ProviderAuthInspector {
  return {
    hasReadableKeychainValue: () => ready,
    hasLocalGrokSignIn: () => ready,
    hasLocalCodexSignIn: () => ready,
  };
}

function seedExecutableRoutingProfiles(settings: SettingsService): void {
  settings.update({
    workerProfiles: {
      defaultProfileId: "deepseek-primary",
      profiles: [
        {
          id: "deepseek-primary",
          label: "DeepSeek Primary",
          runtime: "claude-code",
          modelConfigId: "deepseek-flash",
          effort: "high",
        },
        {
          id: "qwen-secondary",
          label: "Qwen Secondary",
          runtime: "claude-code",
          modelConfigId: "qwen-plus",
          effort: "medium",
        },
      ],
    },
  });
}

function seedComparableRoutingHistory(
  store: StateStore,
  taskClass: string,
): void {
  const now = new Date().toISOString();
  const seed = (
    provider: "deepseek" | "qwen",
    model: string,
    effort: "high" | "medium",
    passed: boolean,
  ): void => {
    const task = registerTaskFromSpec(store, {
      version: 1,
      name: `${provider}-${effort}-${passed}-${Math.random()}`,
      project: "/src",
      goal: "Executable routing evidence",
      constraints: [],
      provider: { name: provider, model, keychainService: "forklight.test" },
      runtime: { name: "claude-code", executable: "claude", effort, maxBudgetUsd: 0.5 },
      workspace: { exclude: [] },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
      acceptance: { commands: ["npm test"] },
      taskClass,
    }, `forklight://test/exec-route-${Date.now()}-${Math.random()}`);
    store.setTaskStatus(task.id, passed ? "succeeded" : "failed", {
      finishedAt: now, workerPid: null,
      ...(passed ? {} : { error: "Independent verification failed" }),
    });
    store.createAttempt({
      id: `${task.id}-a1`, taskId: task.id, ordinal: 1,
      status: passed ? "succeeded" : "failed",
      sessionId: task.sessionId, rawLogPath: "/dev/null", startedAt: now, finishedAt: now,
      ...(passed ? {} : { exitCode: 1 }),
    });
    store.addEvent(task.id, undefined, "verification.completed",
      passed ? "Verification passed" : "Verification failed",
      {
        passed,
        behaviorPassed: passed,
        policyPassed: true,
        sourceCompatible: true,
        commands: passed
          ? [{ command: "npm test", exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false }]
          : [{ command: "npm test", exitCode: 1, stdout: "", stderr: "failed", durationMs: 1, timedOut: false }],
      });
  };
  for (let i = 0; i < 6; i += 1) seed("deepseek", "deepseek-v4-flash", "high", true);
  for (let i = 0; i < 6; i += 1) seed("qwen", "qwen3.7-plus", "medium", false);
}

test("routing CLI help documents --profiles, --family, and Competition flags", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-routing-help-"));
  try {
    const result = await runCli(home, []);
    assert.match(result.stdout, /--profiles <json-array>/);
    assert.match(result.stdout, /--family <family>/);
    assert.match(result.stdout, /--comp-intent none\|consider\|required/);
    assert.match(result.stdout, /--comp-triggers <json>/);
    const helpLines = result.stdout.split("\n");
    const routingStart = helpLines.findIndex((line) => /^\s*forklight routing\b/.test(line));
    assert.ok(routingStart >= 0, "top-level help must document the routing command");
    const routingHelp: string[] = [];
    for (let index = routingStart; index < helpLines.length; index += 1) {
      const line = helpLines[index]!;
      if (index > routingStart && /^\s*forklight\b/.test(line)) break;
      routingHelp.push(line);
    }
    // Routing-only internals stay banned; public setup labels live in other stanzas.
    assert.doesNotMatch(routingHelp.join("\n"), /endpoint|api[_-]?key|keychain/i);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("routing CLI human output renders a launchable Profile recommendation", () => {
  const advisory = {
    taskClass: "coding:ready",
    evidenceScope: "exact-class",
    knowledge: "recommendation",
    overallResult: "recommended",
    cannotDetermineReasons: [],
    candidates: [{
      provider: "deepseek",
      model: "v4",
      runtime: "claude-code",
      effort: "high",
      workerProfileId: "deepseek-primary",
      workerLabel: "DeepSeek Primary",
      resolvedExecutionMode: "single-run",
      executionPreference: "auto",
      readinessState: "launchable",
      canLaunch: true,
      nextAction: "run-smoke-check",
      eligible: true,
      evidence: { relevantSampleCount: 8, modelQualityFailureCount: 0, acceptedDeliveryRate: 1, ignoredNonModelFailures: {} },
      comparisonEvidence: { relevantSampleCount: 8, modelQualityFailureCount: 0, acceptedDeliveryRate: 1, ignoredNonModelFailures: {} },
      sampleCoverage: { exactTerminalCount: 8, exactRelevantCount: 8, exactMinRelevantSamples: 5 },
      cohortParticipation: "compared",
      factors: [],
      totalScore: 2,
      uncertainty: {
        insufficientSamples: false,
        insufficientGap: false,
        incompatibleCost: false,
        incompatibleCurrency: false,
        reasons: [],
      },
    }],
    recommendation: {
      provider: "deepseek",
      model: "v4",
      runtime: "claude-code",
      effort: "high",
      workerProfileId: "deepseek-primary",
      workerLabel: "DeepSeek Primary",
      confidence: 0.5,
      reasoning: "clear-score-gap:0.5000",
      coverage: "all-candidates",
      resolvedExecutionMode: "single-run",
      executionPreference: "auto",
      readinessState: "launchable",
      canLaunch: true,
      nextAction: "run-smoke-check",
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
    allCandidatesCompared: true,
    cohortCandidateCount: 1,
    distinctIdentityCount: 1,
    totalCandidateCount: 1,
    excludedCandidateCount: 0,
    recommendationCoverage: "all-candidates",
  } as unknown as RoutingAdvisoryResponse;
  const output = formatRoutingAdviceHuman(advisory);
  assert.match(output, /Overall result: recommended/);
  assert.match(output, /Runtime: claude-code \| effort: high/);
  assert.match(output, /Execution: auto -> single-run/);
  assert.match(output, /Readiness: launchable \[canLaunch=true\]/);
  assert.match(output, /Next action: run-smoke-check/);
  assert.doesNotMatch(output, /endpoint|api[_-]?key|keychain|\/Users\//i);
});

test("routing CLI human output renders cannot determine with stable reasons", () => {
  const advisory = {
    taskClass: "coding:unknown",
    evidenceScope: "none",
    knowledge: "unknown",
    overallResult: "cannot-determine",
    cannotDetermineReasons: ["insufficient-relevant-samples", "no-active-factors"],
    candidates: [],
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
    cohortCandidateCount: 0,
    distinctIdentityCount: 0,
    totalCandidateCount: 0,
    excludedCandidateCount: 0,
    recommendationCoverage: null,
  } as unknown as RoutingAdvisoryResponse;
  const output = formatRoutingAdviceHuman(advisory);
  assert.match(output, /Overall result: cannot determine/);
  assert.match(output, /Cannot determine because: not enough comparable Tasks; no active comparison factors/);
  assert.match(output, /Recommendation: cannot determine/);
  assert.doesNotMatch(output, /endpoint|api[_-]?key|keychain|\/Users\//i);
});

test("routing CLI human output states strategy and policy without implying auto-start", () => {
  const advisory = {
    taskClass: "coding:strategy",
    evidenceScope: "none",
    knowledge: "unknown",
    overallResult: "cannot-determine",
    cannotDetermineReasons: ["insufficient-relevant-samples"],
    candidates: [],
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
    cohortCandidateCount: 0,
    distinctIdentityCount: 0,
    totalCandidateCount: 0,
    excludedCandidateCount: 0,
    recommendationCoverage: null,
    strategyPolicy: {
      strategy: {
        determination: "cannot-determine",
        reasons: ["insufficient-relevant-samples"],
        evidenceScope: "none",
        rows: [{
          provider: "deepseek",
          model: "v4",
          runtime: "claude-code",
          effort: "high",
          executionMode: "single-run",
          terminalTaskCount: 1,
          relevantSampleCount: 1,
          acceptedDeliveryCount: 0,
          modelQualityFailureCount: 0,
          ignoredNonModelTaskCount: 0,
          ambiguousFailureCount: 0,
          score: 0,
          compared: false,
        }],
        createsWork: false,
      },
      competitionPolicy: {
        determination: "not-advised",
        reasons: ["intent-none"],
        intent: "none",
        shouldRunCompetition: false,
        validTriggers: [],
        matchingCompetitionCount: 0,
        admission: { completed: 0, running: 0, pending: 0, legacyUnknownReason: 0 },
        outcomes: { accept: 0, reject: 0, revise: 0, noDecision: 0 },
        createsWork: false,
        historyCanOverrideIntentNone: false,
      },
      judgePolicy: {
        determination: "cannot-determine",
        reasons: ["requirement-absent"],
        declaredRequiredJudges: { present: false, depths: [], mixed: false },
        usableOutcomeCount: 0,
        unusableOutcomeCount: 0,
        distinctUnderlyingIdentityCount: 0,
        votes: false,
        infersRequirement: false,
        assignsOrReplacesJudge: false,
        changesIntegrationAuthority: false,
      },
      mainDirectHistory: {
        present: true,
        recordCount: 1,
        openCount: 0,
        completedCount: 1,
        abandonedCount: 0,
        reasonDistribution: { "small-clear-change": 1 },
        comparedAsWorkerEvidence: false,
      },
    },
  } as unknown as RoutingAdvisoryResponse;
  const output = formatRoutingAdviceHuman(advisory);
  assert.match(output, /Execution strategy: cannot determine/);
  assert.match(output, /Strategy deepseek\/v4 claude-code\/high single-run: samples=1/);
  assert.match(output, /Competition policy: not advised \(Main intent is none\)/);
  assert.match(output, /History does not start a Competition/);
  assert.doesNotMatch(output, /\d+ matching/);
  assert.match(output, /Judge policy: cannot determine/);
  assert.match(output, /No vote and no inferred requirement/);
  assert.match(output, /Main-direct history: 1 record\(s\) in this scope/);
  assert.doesNotMatch(output, /automatically start|majority vote|replace a Judge/i);
});

test("coordinator modelRouting keeps historical scores independent of current readiness", () => {
  const store = new StateStore(path.join(tmpdir(), `fl-mr-exec-${Date.now()}-${Math.random()}`));
  const settings = new SettingsService(store);
  seedExecutableRoutingProfiles(settings);
  seedComparableRoutingHistory(store, "coding:exec-ready");
  const launchable = new DaemonCoordinator(store, settings, 0, routingAuthInspector(true));
  const blocked = new DaemonCoordinator(store, settings, 0, routingAuthInspector(false));
  try {
    const ready = launchable.modelRouting(
      "coding:exec-ready",
      undefined, undefined, "none", undefined,
      ["deepseek-primary", "qwen-secondary"],
    );
    const unavailable = blocked.modelRouting(
      "coding:exec-ready",
      undefined, undefined, "none", undefined,
      ["deepseek-primary", "qwen-secondary"],
    );
    assert.equal(ready.knowledge, "recommendation");
    assert.equal(unavailable.knowledge, "recommendation");
    assert.equal(ready.recommendation?.workerProfileId, "deepseek-primary");
    assert.equal(unavailable.recommendation?.workerProfileId, "deepseek-primary");
    assert.notEqual(unavailable.recommendation?.workerProfileId, "qwen-secondary");
    assert.equal(ready.shouldRunCompetition, false);
    assert.equal(unavailable.shouldRunCompetition, false);
    assert.deepEqual(
      ready.candidates.map((c) => ({ id: c.workerProfileId, score: c.totalScore })),
      unavailable.candidates.map((c) => ({ id: c.workerProfileId, score: c.totalScore })),
    );
    if (ready.recommendation?.canLaunch === true) {
      assert.equal(ready.overallResult, "recommended");
      assert.equal(ready.recommendation?.runtime, "claude-code");
      assert.equal(ready.recommendation?.effort, "high");
      assert.ok(ready.recommendation?.resolvedExecutionMode);
      assert.ok(ready.recommendation?.nextAction);
    } else {
      assert.equal(ready.overallResult, "historical-best-not-launchable");
    }
    assert.equal(unavailable.recommendation?.canLaunch, false);
    assert.equal(unavailable.overallResult, "historical-best-not-launchable");
    const blockedHuman = formatRoutingAdviceHuman(unavailable);
    assert.match(blockedHuman, /Overall result: historical best not launchable/);
    assert.match(blockedHuman, /No substitute Worker was selected/);
    if (ready.overallResult === "recommended") {
      const readyHuman = formatRoutingAdviceHuman(ready);
      assert.match(readyHuman, /Overall result: recommended/);
      assert.match(readyHuman, /Runtime: claude-code \| effort: high/);
      assert.match(readyHuman, /canLaunch=true/);
    }
    const serialized = JSON.stringify(ready) + JSON.stringify(unavailable);
    assert.doesNotMatch(serialized, /endpoint|api[_-]?key|keychain|\/Users\/|auth\.json/i);
  } finally {
    store.close();
  }
});

test("coordinator legacy modelRouting omits Profile execution and readiness", () => {
  const store = new StateStore(path.join(tmpdir(), `fl-mr-legacy-${Date.now()}-${Math.random()}`));
  const settings = new SettingsService(store);
  const coordinator = new DaemonCoordinator(store, settings);
  try {
    const result = coordinator.modelRouting("coding:legacy-exec", [
      { provider: "deepseek", model: "v4" },
      { provider: "qwen", model: "plus" },
    ], undefined, "none");
    assert.equal(result.overallResult, "cannot-determine");
    assert.equal(result.shouldRunCompetition, false);
    for (const candidate of result.candidates) {
      assert.equal(candidate.workerProfileId, undefined);
      assert.equal(candidate.resolvedExecutionMode, undefined);
      assert.equal(candidate.canLaunch, undefined);
    }
    assert.ok(result.strategyPolicy);
    const human = formatRoutingAdviceHuman(result);
    assert.match(human, /Execution strategy: cannot determine/);
    assert.match(human, /Competition policy: not advised/);
    assert.match(human, /History does not start a Competition/);
    assert.doesNotMatch(human, /\d+ matching/);
    assert.match(human, /Judge policy: cannot determine/);
    assert.match(human, /no inferred requirement/);
    assert.match(human, /Main-direct history:/);
    assert.doesNotMatch(human, /automatically start|majority vote|replace a Judge/i);
  } finally {
    store.close();
  }
});

// --- Complete Main usage CLI (M4-A) ---

const MU_CLI_USAGE = {
  type: "turn.completed",
  usage: {
    input_tokens: 4000, cached_input_tokens: 1000, cache_write_input_tokens: 0,
    output_tokens: 500, reasoning_output_tokens: 100,
  },
};

function runMainTokenCli(home: string, arguments_: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(process.execPath, cliArgs(...arguments_), {
      cwd: root, encoding: "utf8", env: { ...process.env, FORKLIGHT_HOME: home },
    }, (error, stdout, stderr) => {
      const code = (error as (Error & { code?: unknown }) | null)?.code;
      resolve({
        stdout: String(stdout), stderr: String(stderr),
        exitCode: error === null ? 0 : typeof code === "number" ? code : 1,
      });
    });
  });
}

test("main-token CLI capture and status share count-only JSON with no saving field", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4a-cli-"));
  const store = new StateStore(home);
  const spec = parseTaskSpec({
    version: 1, name: "cli-mu", project: "/tmp", goal: "T",
    taskClass: "edit-task", taskFamily: "forklight-storage-lifecycle",
    directCodexProfileId: "codex-main-v1", acceptance: { commands: ["true"] },
  }, "/tmp");
  store.createTask(buildTaskRecord({
    spec, taskFile: "/tmp/cli-mu.yaml", home, id: "cli-mu",
    sessionId: "s-cli-mu", createdAt: "2026-08-17T12:00:00.000Z",
  }));
  store.close();
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const empty = await runMainTokenCli(home, [
      "main-token", "status", "--task-id", "cli-mu", "--comparison-id", "cmp-cli", "--json",
    ]);
    assert.equal(empty.exitCode, 0, empty.stderr);
    const emptyJson = JSON.parse(empty.stdout) as Record<string, unknown>;
    assert.deepEqual(emptyJson.missingRoles, ["direct-main", "delegated-main"]);
    assert.equal(emptyJson.countComplete, false);
    assert.equal("saving" in emptyJson, false);
    assert.equal("change" in emptyJson, false);

    const capture = await runMainTokenCli(home, [
      "main-token", "capture", "--task-id", "cli-mu", "--comparison-id", "cmp-cli",
      "--role", "direct-main", "--run-ref", "codex-run:cli-direct",
      "--usage", JSON.stringify(MU_CLI_USAGE), "--json",
    ]);
    assert.equal(capture.exitCode, 0, capture.stderr);
    const sample = JSON.parse(capture.stdout) as Record<string, unknown>;
    assert.equal(sample.inputTokens, 3000);
    assert.equal(sample.grossTokens, 4500);
    assert.equal(sample.source, "codex-terminal-result");
    assert.equal(sample.taskFamily, "forklight-storage-lifecycle");
    assert.equal("saving" in sample, false);

    const status1 = await runMainTokenCli(home, [
      "main-token", "status", "--task-id", "cli-mu", "--comparison-id", "cmp-cli", "--json",
    ]);
    const status2 = await runMainTokenCli(home, [
      "main-token", "status", "--task-id", "cli-mu", "--comparison-id", "cmp-cli", "--json",
    ]);
    assert.equal(status1.exitCode, 0, status1.stderr);
    assert.equal(status2.stdout, status1.stdout);
    const statusJson = JSON.parse(status1.stdout) as Record<string, unknown>;
    assert.deepEqual(statusJson.capturedRoles, ["direct-main"]);
    assert.deepEqual(statusJson.missingRoles, ["delegated-main"]);
    assert.equal("saving" in statusJson, false);
    assert.equal("directCodexSavings" in statusJson, false);

    const human = await runMainTokenCli(home, [
      "main-token", "status", "--task-id", "cli-mu", "--comparison-id", "cmp-cli",
    ]);
    assert.equal(human.exitCode, 0, human.stderr);
    assert.match(human.stdout, /missingRoles: delegated-main/);
    assert.doesNotMatch(human.stdout, /saving|change|quality|familyValue/i);

    const tokens = await runMainTokenCli(home, ["tokens", "cli-mu", "--json"]);
    assert.equal(tokens.exitCode, 0, tokens.stderr);
    const tokenReport = JSON.parse(tokens.stdout) as { report?: Record<string, unknown> };
    assert.equal("directCodexSavings" in (tokenReport.report ?? {}), true);

    const check = new StateStore(home);
    const afterStatus = check.countMainUsageSamples();
    assert.equal(afterStatus, 1);
    assert.equal(check.listExchangeReceipts("cli-mu").length, 0);
    check.close();
  } finally {
    await daemon.close();
  }
});

test("main-token CLI capture-episode shares count-only JSON with status", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4e-cli-ep-"));
  const store = new StateStore(home);
  const spec = parseTaskSpec({
    version: 1, name: "cli-ep", project: "/tmp", goal: "T",
    taskClass: "edit-task", taskFamily: "forklight-storage-lifecycle",
    directCodexProfileId: "codex-main-v1", acceptance: { commands: ["true"] },
  }, "/tmp");
  store.createTask(buildTaskRecord({
    spec, taskFile: "/tmp/cli-ep.yaml", home, id: "cli-ep",
    sessionId: "s-cli-ep", createdAt: "2026-08-17T12:00:00.000Z",
  }));
  store.close();
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const first = {
    type: "turn.completed",
    usage: {
      input_tokens: 4000, cached_input_tokens: 1000, cache_write_input_tokens: 200,
      output_tokens: 500, reasoning_output_tokens: 100,
    },
  };
  const second = {
    type: "turn.completed",
    usage: {
      input_tokens: 2500, cached_input_tokens: 800, cache_write_input_tokens: 100,
      output_tokens: 400, reasoning_output_tokens: 80,
    },
  };
  const segments = [
    { runRef: "codex-run:cli-ep-a", usage: first },
    { runRef: "codex-run:cli-ep-b", usage: second },
  ];
  try {
    const capture = await runMainTokenCli(home, [
      "main-token", "capture-episode", "--task-id", "cli-ep", "--comparison-id", "cmp-cli-ep",
      "--role", "delegated-main", "--run-ref", "codex-run:cli-episode",
      "--segments", JSON.stringify(segments), "--json",
    ]);
    assert.equal(capture.exitCode, 0, capture.stderr);
    const sample = JSON.parse(capture.stdout) as Record<string, unknown>;
    assert.equal(sample.schemaVersion, 2);
    assert.equal(sample.source, "codex-terminal-result");
    assert.equal("saving" in sample, false);
    const sampleSegments = sample.segments as Array<Record<string, unknown>>;
    assert.equal(sampleSegments.length, 2);
    assert.equal(sampleSegments[0]?.runRef, "codex-run:cli-ep-a");
    assert.equal(
      sample.inputTokens,
      (sampleSegments[0]?.inputTokens as number) + (sampleSegments[1]?.inputTokens as number),
    );
    assert.equal(
      sample.grossTokens,
      (sampleSegments[0]?.grossTokens as number) + (sampleSegments[1]?.grossTokens as number),
    );
    const status1 = await runMainTokenCli(home, [
      "main-token", "status", "--task-id", "cli-ep", "--comparison-id", "cmp-cli-ep", "--json",
    ]);
    const status2 = await runMainTokenCli(home, [
      "main-token", "status", "--task-id", "cli-ep", "--comparison-id", "cmp-cli-ep", "--json",
    ]);
    assert.equal(status1.exitCode, 0, status1.stderr);
    assert.equal(status2.stdout, status1.stdout);
    const statusJson = JSON.parse(status1.stdout) as Record<string, unknown>;
    assert.deepEqual(statusJson.capturedRoles, ["delegated-main"]);
    assert.equal("saving" in statusJson, false);
    const statusSample = (statusJson.samples as Array<Record<string, unknown>>)[0];
    assert.equal(statusSample?.inputTokens, sample.inputTokens);
    assert.equal(statusSample?.grossTokens, sample.grossTokens);
    assert.equal((statusSample?.segments as unknown[]).length, 2);
    const human = await runMainTokenCli(home, [
      "main-token", "status", "--task-id", "cli-ep", "--comparison-id", "cmp-cli-ep",
    ]);
    assert.equal(human.exitCode, 0, human.stderr);
    assert.match(human.stdout, /segments: 2/);
    assert.match(human.stdout, /codex-run:cli-ep-a/);
    assert.doesNotMatch(human.stdout, /saving|prompt|SECRET/i);
  } finally {
    await daemon.close();
  }
});

function seedCliComparablePair(home: string): void {
  const store = new StateStore(home);
  const spec = parseTaskSpec({
    version: 1, name: "cli-pair", project: "/tmp", goal: "T",
    taskClass: "edit-task", taskFamily: "forklight-storage-lifecycle",
    directCodexProfileId: "codex-main-v1", acceptance: { commands: ["true"] },
  }, "/tmp");
  store.createTask(buildTaskRecord({
    spec, taskFile: "/tmp/cli-pair.yaml", home, id: "cli-pair",
    sessionId: "s-cli-pair", createdAt: "2026-08-17T12:00:00.000Z",
  }));
  store.saveMainUsageSample({
    sampleId: "clipaird", forklightTaskId: "cli-pair", comparisonId: "cmp-cli-pair",
    role: "direct-main", taskClass: "edit-task", taskFamily: "forklight-storage-lifecycle",
    directCodexProfileId: "codex-main-v1", inputTokens: 4000, outputTokens: 500,
    cacheReadInputTokens: 0, cacheCreationInputTokens: 0, grossTokens: 4500,
    source: "codex-terminal-result", runRef: "codex-run:cli-pair-d",
    capturedAt: "2026-08-17T12:00:00.000Z", schemaVersion: 1,
  });
  store.saveMainUsageSample({
    sampleId: "clipairg", forklightTaskId: "cli-pair", comparisonId: "cmp-cli-pair",
    role: "delegated-main", taskClass: "edit-task", taskFamily: "forklight-storage-lifecycle",
    directCodexProfileId: "codex-main-v1", inputTokens: 1200, outputTokens: 300,
    cacheReadInputTokens: 0, cacheCreationInputTokens: 0, grossTokens: 1500,
    source: "codex-terminal-result", runRef: "codex-run:cli-pair-g",
    capturedAt: "2026-08-17T12:00:00.000Z", schemaVersion: 1,
  });
  const digest = "a".repeat(64);
  const verification = store.addEvent("cli-pair", "att-cli-pair", "verification.completed", "passed", { passed: true });
  store.addEvent("cli-pair", "att-cli-pair", "main-review.completed", "accept", {
    decision: "accept", reason: "accepted", attemptId: "att-cli-pair",
    verificationEventSequence: verification.sequence,
    candidateRevisionId: "rev-cli-pair", acceptedPatchDigest: digest,
  });
  store.saveIntegrationReceipt({
    id: "rcpt-cli-int", taskId: "cli-pair", patchDigest: digest, affectedFiles: ["src/cli.ts"],
    rejectionReasons: [], sourceEvidence: {}, createdAt: "2026-08-17T12:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z", consumed: true,
  });
  store.saveIntegrationResult({
    id: "intopcli", receiptId: "rcpt-cli-int", taskId: "cli-pair", status: "applied",
    appliedAt: "2026-08-17T12:00:00.000Z", createdAt: "2026-08-17T12:00:00.000Z",
    stages: [
      { stage: "source-applied", status: "passed" },
      { stage: "source-verified", status: "passed" },
      { stage: "artifact-built", status: "passed" },
      { stage: "runtime-activated", status: "passed" },
    ],
  });
  store.close();
}

test("main-token CLI assess and pair-report launch twice with matching report JSON", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-m4b-cli-"));
  seedCliComparablePair(home);
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  const assessArgs = [
    "main-token", "assess", "--task-id", "cli-pair", "--comparison-id", "cmp-cli-pair",
    "--same-scope", "true", "--same-acceptance", "true", "--delegated-quality-not-lower", "true",
    "--direct-verification-ref", "dvref1", "--delegated-integration-id", "intopcli",
    "--reviewer", "main-codex", "--assessed-at", "2026-08-17T12:30:00.000Z",
    "--schema-version", "1", "--confirm", "--json",
  ];
  try {
    const assess1 = await runMainTokenCli(home, assessArgs);
    assert.equal(assess1.exitCode, 0, assess1.stderr);
    const assessJson1 = JSON.parse(assess1.stdout) as Record<string, unknown>;
    assert.equal(assessJson1.outcome, "accepted");
    const assess2 = await runMainTokenCli(home, assessArgs);
    assert.equal(assess2.exitCode, 0, assess2.stderr);
    const assessJson2 = JSON.parse(assess2.stdout) as Record<string, unknown>;
    assert.deepEqual(assessJson2.reasons, ["duplicate-evidence"]);

    const reportArgs = [
      "main-token", "pair-report", "--task-id", "cli-pair", "--comparison-id", "cmp-cli-pair", "--json",
    ];
    const report1 = await runMainTokenCli(home, reportArgs);
    const report2 = await runMainTokenCli(home, reportArgs);
    assert.equal(report1.exitCode, 0, report1.stderr);
    assert.equal(report2.exitCode, 0, report2.stderr);
    assert.equal(report1.stdout, report2.stdout);
    const reportJson = JSON.parse(report1.stdout) as Record<string, unknown>;
    assert.equal(reportJson.validity, "accepted");
    assert.equal(reportJson.directGrossTokens, 4500);
    assert.equal(reportJson.delegatedGrossTokens, 1500);
    assert.equal(reportJson.signedChange, 3000);
    assert.equal(reportJson.method, "codex-terminal-result");
    assert.equal((reportJson.saving as { status?: string }).status, "saving");
    for (const key of ["change", "savings", "directCodexSavings", "calibration", "workerTokens", "cost"]) {
      assert.equal(key in reportJson, false);
    }

    const status = await runMainTokenCli(home, [
      "main-token", "status", "--task-id", "cli-pair", "--comparison-id", "cmp-cli-pair", "--json",
    ]);
    const statusJson = JSON.parse(status.stdout) as Record<string, unknown>;
    assert.equal("change" in statusJson, false);
    assert.equal("saving" in statusJson, false);
  } finally {
    await daemon.close();
  }
});

test("value-report CLI empty and seeded launches agree and stay read-only", async () => {
  const emptyHome = await mkdtemp(path.join(tmpdir(), "fl-m4c-cli-empty-"));
  const emptyDaemon = new ForkLightDaemon(emptyHome, 0);
  await emptyDaemon.start();
  try {
    const emptyArgs = ["value-report", "--families", JSON.stringify(["forklight-storage-lifecycle"]), "--json"];
    const empty1 = await runMainTokenCli(emptyHome, emptyArgs);
    const empty2 = await runMainTokenCli(emptyHome, emptyArgs);
    assert.equal(empty1.exitCode, 0, empty1.stderr);
    assert.equal(empty2.stdout, empty1.stdout);
    const emptyJson = JSON.parse(empty1.stdout) as Record<string, unknown>;
    assert.equal(emptyJson.overall, "cannot-determine");
    assert.ok((emptyJson.reasons as string[]).includes("empty-store"));
    assert.ok((emptyJson.reasons as string[]).includes("uncovered-family"));
    assert.equal(emptyJson.createdWork, false);
    const emptyStore = new StateStore(emptyHome);
    assert.equal(emptyStore.listTasks().length, 0);
    emptyStore.close();
  } finally {
    await emptyDaemon.close();
  }

  const home = await mkdtemp(path.join(tmpdir(), "fl-m4c-cli-seed-"));
  seedCliComparablePair(home);
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const assess = await runMainTokenCli(home, [
      "main-token", "assess", "--task-id", "cli-pair", "--comparison-id", "cmp-cli-pair",
      "--same-scope", "true", "--same-acceptance", "true", "--delegated-quality-not-lower", "true",
      "--direct-verification-ref", "dvref1", "--delegated-integration-id", "intopcli",
      "--reviewer", "main-codex", "--assessed-at", "2026-08-17T12:30:00.000Z",
      "--schema-version", "1", "--confirm", "--json",
    ]);
    assert.equal(assess.exitCode, 0, assess.stderr);
    const reportArgs = ["value-report", "--families", JSON.stringify(["forklight-storage-lifecycle"]), "--json"];
    const report1 = await runMainTokenCli(home, reportArgs);
    const report2 = await runMainTokenCli(home, reportArgs);
    assert.equal(report1.exitCode, 0, report1.stderr);
    assert.equal(report2.stdout, report1.stdout);
    const reportJson = JSON.parse(report1.stdout) as Record<string, unknown>;
    assert.equal(reportJson.overall, "proven");
    const families = reportJson.families as Array<Record<string, unknown>>;
    assert.equal(families[0]?.claim, "proven-lower");
    const comparisons = families[0]?.comparisons as Array<Record<string, unknown>>;
    assert.equal(comparisons[0]?.signedChange, 3000);
    assert.equal(comparisons[0]?.contributesProvenLower, true);
    for (const key of ["change", "savings", "directCodexSavings", "averagePercentage", "bestPair", "prompt"]) {
      assert.equal(key in reportJson, false);
    }
    const human = await runMainTokenCli(home, [
      "value-report", "--families", JSON.stringify(["forklight-storage-lifecycle"]),
    ]);
    assert.equal(human.exitCode, 0, human.stderr);
    assert.match(human.stdout, /overall: proven/);
    assert.match(human.stdout, /claim: proven-lower/);
    assert.match(human.stdout, /signedChange: 3000/);
    assert.match(human.stdout, /unavailable \(no-attempts\)/);
    assert.doesNotMatch(human.stdout, /averagePercentage|bestPair|directCodexSavings/);
  } finally {
    await daemon.close();
  }
});

test("CLI delivery prepare and decide return the canonical checkpoint twice", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-cli-delivery-"));
  const sourceDir = path.join(home, "source");
  await mkdir(path.join(sourceDir, "src"), { recursive: true });
  await writeFile(path.join(sourceDir, "readme.md"), "# hello\n\nOriginal.\n");
  await writeFile(path.join(sourceDir, "src/app.ts"), "export const n = 1;\n");
  const store = new StateStore(home);
  const taskId = "cli-delivery-1";
  const paths = taskPaths(home, taskId);
  const spec = {
    version: 1,
    name: "CLI delivery",
    project: sourceDir,
    goal: "Ship a small change",
    constraints: [],
    provider: {
      name: "deepseek",
      model: "deepseek-v4-flash",
      keychainService: "forklight.deepseek.api-key",
    },
    runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: 0.1 },
    workspace: { exclude: [".git", "node_modules"] },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src", "readme.md"] },
    acceptance: { commands: ["true"] },
    reviewRequirement: { requiredJudges: 0, reason: "Explicit skip for CLI fixture" },
  } as TaskRecord["spec"];
  await prepareWorkspace(spec, paths);
  await mkdir(path.join(paths.workspace, "src"), { recursive: true });
  await writeFile(path.join(paths.workspace, "readme.md"), "# hello\n\nChanged.\n");
  await writeFile(path.join(paths.workspace, "src/app.ts"), "export const n = 2;\n");
  await writeWorkspacePatchReport(paths, createPathPolicy(spec));
  const now = new Date().toISOString();
  store.createTask({
    id: taskId,
    name: spec.name,
    status: "succeeded",
    sourcePath: sourceDir,
    taskFile: "forklight://test/cli-delivery",
    spec,
    paths,
    sessionId: "session-1",
    currentAttemptId: "attempt-1",
    createdAt: now,
    updatedAt: now,
  });
  store.createAttempt({
    id: "attempt-1",
    taskId,
    ordinal: 1,
    status: "succeeded",
    sessionId: "session-1",
    rawLogPath: path.join(paths.logs, "attempt-1.jsonl"),
    startedAt: now,
    finishedAt: now,
    exitCode: 0,
  });
  const verEvent = store.addEvent(taskId, "attempt-1", "verification.completed", "passed", {
    passed: true,
    behaviorPassed: true,
    policyPassed: true,
    sourceCompatible: true,
    commands: [{ command: "true", exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false }],
    diffPath: paths.diff,
    sourceUnchanged: true,
  });
  const revision = await captureCandidateRevision(
    store, store.getTask(taskId), store.getAttempt("attempt-1"), verEvent.sequence, true,
    ["readme.md", "src/app.ts"], 2, 4,
  );
  store.close();

  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const prepareArgs = [
      "delivery", "prepare", "--task", taskId, "--reason", "Explicit skip",
      "--timeout-ms", "2000", "--confirm", "--json",
    ];
    const first = await runCli(home, prepareArgs, 20_000);
    assert.equal(first.code, 0, first.stderr);
    const firstJson = JSON.parse(first.stdout) as {
      kind?: string;
      candidate?: { revisionId?: string; digest?: string };
      nextActionCode?: string;
      observation?: { outcome?: string };
    };
    assert.equal(firstJson.kind, "main-delivery-checkpoint");
    assert.equal(firstJson.observation?.outcome, "ready");
    assert.equal(firstJson.candidate?.revisionId, revision.id);
    assert.equal(firstJson.candidate?.digest, revision.patchDigest);
    assert.equal(firstJson.nextActionCode, "record-main-review");

    const second = await runCli(home, prepareArgs, 20_000);
    assert.equal(second.code, 0, second.stderr);
    const secondJson = JSON.parse(second.stdout) as { candidate?: { revisionId?: string } };
    assert.equal(secondJson.candidate?.revisionId, revision.id);

    const human = await runCli(home, [
      "delivery", "prepare", "--task", taskId, "--reason", "Explicit skip",
      "--timeout-ms", "2000", "--confirm",
    ], 20_000);
    assert.equal(human.code, 0, human.stderr);
    assert.match(human.stdout, /delivery: prepare ready/);
    assert.match(human.stdout, /next: record-main-review/);

    const decideArgs = [
      "delivery", "decide", taskId, "--decision", "accept",
      "--revision", revision.id, "--digest", revision.patchDigest,
      "--reason", "Exact Candidate is acceptable", "--timeout-ms", "20000", "--confirm", "--json",
    ];
    const decide1 = await runCli(home, decideArgs, 30_000);
    assert.equal(decide1.code, 0, decide1.stderr);
    const decideJson = JSON.parse(decide1.stdout) as {
      mainDecision?: { decision?: string };
      integration?: { operationId?: string; status?: string; resultStatus?: string };
      preflight?: { passed?: boolean };
      nextActionCode?: string;
    };
    assert.equal(decideJson.mainDecision?.decision, "accept");
    assert.equal(decideJson.preflight?.passed, true);
    assert.ok(decideJson.integration?.operationId);
    assert.equal(decideJson.integration?.resultStatus, "applied");

    const decide2 = await runCli(home, decideArgs, 30_000);
    assert.equal(decide2.code, 0, decide2.stderr);
    const decide2Json = JSON.parse(decide2.stdout) as {
      mainDecision?: { decision?: string };
      integration?: { operationId?: string; resultStatus?: string };
    };
    assert.equal(decide2Json.mainDecision?.decision, "accept");
    assert.equal(decide2Json.integration?.operationId, decideJson.integration?.operationId);
    assert.equal(decide2Json.integration?.resultStatus, "applied");

    const decideHuman = await runCli(home, [
      "delivery", "decide", taskId, "--decision", "accept",
      "--revision", revision.id, "--digest", revision.patchDigest,
      "--reason", "Exact Candidate is acceptable", "--timeout-ms", "20000", "--confirm",
    ], 30_000);
    assert.equal(decideHuman.code, 0, decideHuman.stderr);
    assert.match(decideHuman.stdout, /delivery: decide ready/);
    assert.match(decideHuman.stdout, /mainDecision: accept/);
    assert.match(decideHuman.stdout, /integration: operation=/);
  } finally {
    await daemon.close();
  }
});

test("backup CLI requires confirm for create and never starts a daemon", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-cli-backup-"));
  const dest = path.join(path.dirname(home), `backup-${path.basename(home)}`);
  try {
    const store = new StateStore(home);
    store.close();
    const missingConfirm = await runCli(home, ["backup", "create", "--destination", dest]);
    assert.notEqual(missingConfirm.code, 0);
    assert.match(missingConfirm.stderr, /--confirm/);
    assert.equal(existsSync(daemonSocketPath(home)), false);

    const preview = await runCli(home, ["backup", "preview", "--destination", dest, "--json"]);
    assert.equal(preview.code, 0, preview.stderr);
    const parsed = JSON.parse(preview.stdout) as {
      included?: string[];
      excluded?: string[];
      integrity?: { quickCheck?: string };
      impact?: string;
      nextAction?: string;
      credentials?: { keychain?: string };
      privacy?: string;
    };
    assert.ok(Array.isArray(parsed.included));
    assert.ok(Array.isArray(parsed.excluded));
    assert.equal(parsed.integrity?.quickCheck, "ok");
    assert.ok((parsed.impact ?? "").length > 0);
    assert.equal(parsed.nextAction, "create-with-confirm");
    assert.equal(parsed.credentials?.keychain, "not-included");
    assert.equal(parsed.privacy, "keep-private");
    assert.equal(existsSync(daemonSocketPath(home)), false);

    const created = await runCli(home, [
      "backup", "create", "--destination", dest, "--confirm", "--json",
    ]);
    assert.equal(created.code, 0, created.stderr);
    assert.equal(existsSync(daemonSocketPath(home)), false);
    const inspected = await runCli(home, ["backup", "inspect", dest, "--json"]);
    assert.equal(inspected.code, 0, inspected.stderr);
    const restorePreview = await runCli(home, ["backup", "restore", dest, "--json"]);
    assert.equal(restorePreview.code, 0, restorePreview.stderr);
    assert.equal(existsSync(daemonSocketPath(home)), false);
    const cliSource = await readFile(new URL("../src/cli/backup.ts", import.meta.url), "utf8");
    assert.doesNotMatch(cliSource, /ensureDaemon|stopDaemon|restartDaemon|replaceHubOwner/);
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
    await rm(dest, { recursive: true, force: true }).catch(() => undefined);
  }
});
