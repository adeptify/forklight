import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PROTOCOL_VERSION,
  compareBuildIdentity,
  currentBuildIdentity,
  isBuildIdentity,
  projectVersionJourney,
} from "../src/core/build-identity.js";
import type { BuildIdentity } from "../src/core/build-identity.js";
import { inspectSourceTree, sourceInputFiles } from "../src/core/source-digest.js";
import { daemonRequest } from "../src/daemon/client.js";
import { DetachedDaemonFixture, waitForPidExit } from "./helpers/detached-daemon.js";

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
  assert.match(first.sourceDigest ?? "", /^[a-f0-9]{64}$/);
  assert.ok(Number.isFinite(Date.parse(first.builtAt)));
  assert.ok(Object.isFrozen(first));
});

test("source digest includes Hub assets and changes when the UI source changes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-source-digest-"));
  try {
    await mkdir(path.join(root, "src", "hub", "public"), { recursive: true });
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{\"version\":\"0.2.0\"}\n", "utf8");
    await writeFile(path.join(root, "tsconfig.json"), "{}\n", "utf8");
    await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");
    await writeFile(path.join(root, "scripts", "build.mjs"), "export {};\n", "utf8");
    const appPath = path.join(root, "src", "hub", "public", "app.js");
    await writeFile(appPath, "window.appVersion = 1;\n", "utf8");

    const files = sourceInputFiles(root).map((file) => path.relative(root, file));
    assert.ok(files.includes(path.join("src", "hub", "public", "app.js")));
    const first = inspectSourceTree(root);
    assert.equal(first.digest, inspectSourceTree(root).digest);
    await writeFile(appPath, "window.appVersion = 2;\n", "utf8");
    const second = inspectSourceTree(root);
    assert.notEqual(second.digest, first.digest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("modern and legacy build identities remain readable", () => {
  assert.equal(isBuildIdentity(identity), true);
  assert.equal(isBuildIdentity({ ...identity, sourceDigest: "a".repeat(64) }), true);
  assert.equal(isBuildIdentity({ ...identity, sourceDigest: "not-a-digest" }), false);
});

test("version journey reports the first stale layer and one next action", () => {
  const artifact = { ...identity, sourceDigest: "a".repeat(64) };
  const daemon = { ...artifact };
  const source = {
    digest: artifact.sourceDigest,
    latestModifiedAt: "2026-07-27T00:00:00.000Z",
  };
  assert.deepEqual(
    projectVersionJourney(source, artifact, { running: true, buildIdentity: daemon }),
    {
      state: "ready",
      nextAction: "none",
      layers: {
        source: { available: true, ...source },
        artifact: { available: true, buildIdentity: artifact },
        daemon: { available: true, running: true, buildIdentity: daemon },
      },
    },
  );
  assert.equal(
    projectVersionJourney({ ...source, digest: "b".repeat(64) }, artifact, {
      running: true,
      buildIdentity: { ...daemon, protocolVersion: PROTOCOL_VERSION - 1 },
    }).state,
    "source-needs-build",
    "source-to-artifact truth has precedence over the running layer",
  );
  assert.equal(
    projectVersionJourney(source, artifact, {
      running: true,
      buildIdentity: { ...daemon, protocolVersion: PROTOCOL_VERSION - 1 },
    }).state,
    "protocol-mismatch",
  );
  assert.equal(
    projectVersionJourney(source, artifact, {
      running: true,
      buildIdentity: { ...daemon, buildId: "older-build" },
    }).state,
    "artifact-needs-restart",
  );
  assert.equal(
    projectVersionJourney(source, artifact, { running: false }).nextAction,
    "restart",
  );
  assert.equal(
    projectVersionJourney(source, identity, { running: true, buildIdentity: identity }).state,
    "unavailable",
    "legacy artifacts never claim the source is current",
  );
});

test("source-dev daemon can stop and restart with the same build identity", async () => {
  const fixture = await DetachedDaemonFixture.create("forklight-source-daemon-");
  try {
    const first = await fixture.ensureReady();
    const firstPid = first.pid as number;
    assert.ok(Number.isSafeInteger(firstPid));
    assert.deepEqual(first.buildIdentity, currentBuildIdentity());

    await daemonRequest("shutdown", {}, fixture.home);
    await waitForPidExit(firstPid);

    const second = await fixture.ensureReady();
    const secondPid = second.pid as number;
    assert.ok(Number.isSafeInteger(secondPid));
    assert.notEqual(secondPid, firstPid);
    assert.deepEqual(second.buildIdentity, currentBuildIdentity());
    await daemonRequest("shutdown", {}, fixture.home);
  } finally {
    await fixture.cleanup();
  }
});
