import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { currentBuildIdentity } from "../src/core/build-identity.js";
import { restartDaemon, stopDaemon } from "../src/daemon/client.js";
import { DetachedDaemonFixture } from "./helpers/detached-daemon.js";

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
    assert.ok(Number.isSafeInteger(pid) && pid > 0, "restart must start a daemon and report its PID");
    assert.equal(health.ok, true, "restarted daemon health must report ok");
    assert.deepEqual(
      health.buildIdentity,
      currentBuildIdentity(),
      "restarted daemon build identity must match client",
    );

    // And we can also register the PID in the fixture so cleanup handles it.
    // The fixture's tracked set already includes the PID from startDaemonProcess
    // inside ensureDaemon, but restartDaemon spawns through ensureDaemon which
    // calls startDaemonProcess — and the fixture cannot automatically track it.
    // We must stop it ourselves so cleanup does not leak.
    await stopDaemon(fixture.home);
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
      { cwd: root, env: { ...process.env, FORKLIGHT_HOME: fixture.home }, timeout: 15_000 },
    );
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
    await stopDaemon(fixture.home).catch(() => undefined);
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
      { cwd: root, env: { ...process.env, FORKLIGHT_HOME: fixture.home }, timeout: 15_000 },
    );
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
    await stopDaemon(fixture.home).catch(() => undefined);
    await fixture.cleanup();
  }
});
