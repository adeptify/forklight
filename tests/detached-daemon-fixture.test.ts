import assert from "node:assert/strict";
import { rm, stat } from "node:fs/promises";
import test from "node:test";
import {
  daemonRequest,
  restartDaemon,
  startDaemonProcess,
  stopDaemon,
} from "../src/daemon/client.js";
import {
  DetachedDaemonFixture,
  type DetachedDaemonCleanupResult,
  probeSocketAlive,
  waitForDaemonReady,
  waitForPidExit,
} from "./helpers/detached-daemon.js";
import { HubCliLifecycleFixture } from "./helpers/hub-cli-fixture.js";

// These tests prove the detached-daemon fixture's cleanup discipline using
// isolated temporary homes and no Provider or user-home access. Each test
// owns its exact child PIDs and endpoint; none scan by process name. Every
// test wraps its body in try/finally so cleanup runs even if readiness or an
// assertion fails.

test("cleanup proves the tracked PID and socket are gone when the test body throws after readiness", async () => {
  const fixture = await DetachedDaemonFixture.create();
  try {
    const health = await fixture.ensureReady();
    const pid = health.pid as number;
    assert.ok(Number.isSafeInteger(pid) && pid > 0);

    // The body throws after readiness; its finally still runs cleanup. The
    // original error must propagate while cleanup proves exit and removal.
    await assert.rejects(
      async () => {
        try {
          throw new Error("simulated assertion failure after readiness");
        } finally {
          await fixture.cleanup();
        }
      },
      /simulated assertion failure after readiness/,
    );

    // The exact child, its socket, and the temporary home are all gone even
    // though the body threw.
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
    assert.equal(await probeSocketAlive(fixture.home), false);
    await assert.rejects(stat(fixture.home), /ENOENT/);
  } finally {
    // Idempotent safety net for any path that bypassed the body's own cleanup.
    await fixture.cleanup();
  }
});

test("cleanup exits every tracked PID when a replacement daemon is started for the same home", async () => {
  const fixture = await DetachedDaemonFixture.create();
  try {
    const first = await fixture.ensureReady();
    const firstPid = first.pid as number;

    // Ordinary shutdown of the first daemon, then start a replacement through
    // the same fixture so both PIDs are tracked.
    await daemonRequest("shutdown", {}, fixture.home);
    await waitForPidExit(firstPid);

    const second = await fixture.ensureReady();
    const secondPid = second.pid as number;
    assert.notEqual(secondPid, firstPid);

    const result: DetachedDaemonCleanupResult = await fixture.cleanup();
    assert.equal(result.homeRemoved, true);
    assert.equal(result.untrackedOwnerPid, undefined);

    // Both returned PIDs are gone and the final endpoint is unreachable.
    assert.throws(() => process.kill(firstPid, 0), /ESRCH/);
    assert.throws(() => process.kill(secondPid, 0), /ESRCH/);
    assert.equal(await probeSocketAlive(fixture.home), false);
    await assert.rejects(stat(fixture.home), /ENOENT/);
  } finally {
    await fixture.cleanup();
  }
});

test("cleanup is a bounded no-op when the daemon was already stopped and is idempotent", async () => {
  const fixture = await DetachedDaemonFixture.create();
  try {
    const health = await fixture.ensureReady();
    const pid = health.pid as number;

    // The test already completed ordinary shutdown and the socket disappeared.
    await daemonRequest("shutdown", {}, fixture.home);
    await waitForPidExit(pid);

    const result = await fixture.cleanup();
    assert.equal(result.homeRemoved, true);
    assert.equal(result.untrackedOwnerPid, undefined);
    assert.deepEqual(result.stoppedPids, []);

    // Idempotent: a second cleanup returns the cached result and does not
    // re-signal or re-remove.
    const again = await fixture.cleanup();
    assert.deepEqual(again, result);

    assert.throws(() => process.kill(pid, 0), /ESRCH/);
    await assert.rejects(stat(fixture.home), /ENOENT/);
  } finally {
    await fixture.cleanup();
  }
});

test("cleanup refuses to signal an untracked endpoint owner and reports the conflict", async () => {
  const fixture = await DetachedDaemonFixture.create();
  // Start a daemon the fixture does NOT track, on the fixture's exact home.
  // A non-spawning readiness wait keeps this PID the sole endpoint owner.
  let untrackedPid: number | undefined;
  try {
    untrackedPid = startDaemonProcess(fixture.home);
    const ownerPid = untrackedPid;
    await waitForDaemonReady(fixture.home);
    const result = await fixture.cleanup();
    assert.equal(result.untrackedOwnerPid, ownerPid);
    assert.equal(result.homeRemoved, false);
    assert.match(result.ownershipConflict ?? "", /untracked/i);
    // The fixture must never have signalled the untracked owner.
    assert.doesNotThrow(() => process.kill(ownerPid, 0));
  } finally {
    // The test owns the daemon it started directly; the fixture refused, so
    // stop it via the production graceful stop (with a direct signal fallback
    // for the PID the test captured) and remove the fixture's home.
    if (untrackedPid !== undefined) {
      await stopDaemon(fixture.home).catch(() => {});
      try {
        process.kill(untrackedPid, "SIGTERM");
      } catch {
        // Already stopped.
      }
      await waitForPidExit([untrackedPid]);
    }
    await rm(fixture.home, { recursive: true, force: true });
  }
});

test("adopted replacement from production restartDaemon does not survive cleanup", async () => {
  const fixture = await DetachedDaemonFixture.create();
  try {
    const firstHealth = await fixture.ensureReady();
    const firstPid = firstHealth.pid as number;

    const replacementHealth = await restartDaemon(fixture.home);
    const replacementPid = replacementHealth.pid as number;
    await fixture.adoptReplacement(replacementPid);
    assert.notEqual(replacementPid, firstPid);

    const result: DetachedDaemonCleanupResult = await fixture.cleanup();
    assert.equal(result.homeRemoved, true);
    assert.equal(result.untrackedOwnerPid, undefined);
    assert.throws(() => process.kill(firstPid, 0), /ESRCH/);
    assert.throws(() => process.kill(replacementPid, 0), /ESRCH/);
    assert.equal(await probeSocketAlive(fixture.home), false);
    await assert.rejects(stat(fixture.home), /ENOENT/);
  } finally {
    await fixture.cleanup();
  }
});

test("adoptReplacement refuses a PID that does not match the endpoint owner", async () => {
  const fixture = await DetachedDaemonFixture.create();
  try {
    const health = await fixture.ensureReady();
    const ownerPid = health.pid as number;
    await assert.rejects(
      fixture.adoptReplacement(ownerPid + 99_999),
      /does not match endpoint owner/,
    );
    assert.doesNotThrow(() => process.kill(ownerPid, 0));
  } finally {
    await fixture.cleanup();
  }
});

test("adoptReplacement is a no-op when the PID is already tracked", async () => {
  const fixture = await DetachedDaemonFixture.create();
  try {
    const health = await fixture.ensureReady();
    const pid = health.pid as number;
    await fixture.adoptReplacement(pid);
    const result = await fixture.cleanup();
    assert.equal(result.homeRemoved, true);
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  } finally {
    await fixture.cleanup();
  }
});

test("Hub CLI cleanup seam preserves an assertion error while proving owned resources gone", async () => {
  const alive = new Set([101, 202]);
  const fixture = await HubCliLifecycleFixture.createWithSeams({
    pidAlive: (pid) => alive.has(pid),
    signal: (pid) => { alive.delete(pid); },
    probeHealth: async () => ({ pid: 202 }),
    shutdown: async () => { alive.delete(202); },
    probeSocket: async () => false,
    waitForExit: async (pids) => [...pids].filter((pid) => alive.has(pid)),
  });
  fixture.registerHubPid(101);

  await assert.rejects(
    async () => {
      try {
        throw new Error("simulated Hub assertion failure");
      } finally {
        await fixture.cleanup();
      }
    },
    /simulated Hub assertion failure/,
  );

  const first = fixture.lastCleanup;
  assert.ok(first);
  assert.equal(first.homeRemoved, true);
  assert.equal(first.hubPid, 101);
  assert.equal(first.daemonPid, 202);
  assert.deepEqual(alive.size, 0);
  assert.deepEqual(await fixture.cleanup(), first, "cleanup is idempotent");
  await assert.rejects(stat(fixture.home), /ENOENT/);
});

test("Hub CLI cleanup seam fails closed before daemon ownership is observable", async () => {
  const fixture = await HubCliLifecycleFixture.createWithSeams({
    pidAlive: () => false,
    probeHealth: async () => {
      const error = new Error("connect ENOENT");
      Object.assign(error, { code: "ENOENT" });
      throw error;
    },
    probeSocket: async () => false,
    waitForExit: async () => [],
  }, "forklight-hub-cli-seam-timeout-");
  try {
    const result = await fixture.cleanup();
    assert.equal(result.homeRemoved, false);
    assert.equal(result.daemonPid, undefined);
    assert.match(result.ownershipConflict ?? "", /never reported an owner/);
    assert.doesNotThrow(() => process.kill(process.pid, 0));
  } finally {
    await rm(fixture.home, { recursive: true, force: true });
  }
});

test("Hub CLI cleanup seam refuses a changed endpoint owner", async () => {
  const reportedOwners = [202, 303];
  const signalled: number[] = [];
  const fixture = await HubCliLifecycleFixture.createWithSeams({
    pidAlive: () => false,
    signal: (pid) => { signalled.push(pid); },
    probeHealth: async () => ({ pid: reportedOwners.shift() }),
    shutdown: async () => undefined,
    probeSocket: async () => false,
    waitForExit: async () => [],
  }, "forklight-hub-cli-seam-mismatch-");
  try {
    assert.equal(await fixture.adoptDaemonOwner(), 202);
    const result = await fixture.cleanup();
    assert.equal(result.homeRemoved, false);
    assert.equal(result.untrackedOwnerPid, 303);
    assert.match(result.ownershipConflict ?? "", /refusing shutdown and signal/);
    assert.deepEqual(signalled, []);
  } finally {
    await rm(fixture.home, { recursive: true, force: true });
  }
});
