import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PROTOCOL_VERSION,
  compareBuildIdentity,
  currentBuildIdentity,
} from "../src/core/build-identity.js";
import type { BuildIdentity } from "../src/core/build-identity.js";
import {
  daemonRequest,
  ensureDaemon,
  startDaemonProcess,
} from "../src/daemon/client.js";

const identity: BuildIdentity = {
  protocolVersion: PROTOCOL_VERSION,
  packageVersion: "0.2.0",
  buildId: "build-one",
  builtAt: "2026-07-24T00:00:00.000Z",
  sourceRevision: "dev-source",
};

test("build identity distinguishes protocol compatibility from exact build", () => {
  assert.deepEqual(compareBuildIdentity(identity, identity), {
    protocolCompatible: true,
    sameBuild: true,
  });
  assert.deepEqual(
    compareBuildIdentity({ ...identity, buildId: "build-old" }, identity),
    { protocolCompatible: true, sameBuild: false },
  );
  assert.deepEqual(
    compareBuildIdentity({ ...identity, protocolVersion: PROTOCOL_VERSION - 1 }, identity),
    { protocolCompatible: false, sameBuild: false },
  );
});

test("current source identity is stable, bounded, and truthful", () => {
  const first = currentBuildIdentity();
  const second = currentBuildIdentity();
  assert.deepEqual(second, first);
  assert.equal(first.protocolVersion, PROTOCOL_VERSION);
  assert.equal(first.packageVersion, "0.2.0");
  assert.equal(first.sourceRevision, "dev-source");
  assert.match(first.buildId, /^dev-[a-f0-9]{32}$/);
  assert.ok(Number.isFinite(Date.parse(first.builtAt)));
  assert.ok(Object.isFrozen(first));
});

test("source-dev daemon can stop and restart with the same build identity", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-source-daemon-"));
  let firstPid: number | undefined;
  let secondPid: number | undefined;
  try {
    startDaemonProcess(home);
    const first = await ensureDaemon(home);
    firstPid = first.pid as number;
    assert.ok(Number.isSafeInteger(firstPid));
    assert.deepEqual(first.buildIdentity, currentBuildIdentity());

    await daemonRequest("shutdown", {}, home);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        process.kill(firstPid, 0);
      } catch {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    startDaemonProcess(home);
    const second = await ensureDaemon(home);
    secondPid = second.pid as number;
    assert.ok(Number.isSafeInteger(secondPid));
    assert.notEqual(secondPid, firstPid);
    assert.deepEqual(second.buildIdentity, currentBuildIdentity());
    await daemonRequest("shutdown", {}, home);
  } finally {
    for (const pid of [firstPid, secondPid]) {
      if (pid === undefined) continue;
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Already stopped.
      }
    }
  }
});
