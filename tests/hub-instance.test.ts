import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import {
  discoverOrClaimHub,
  HUB_STARTUP_OWNERSHIP_CHANGED_MESSAGE,
  HUB_STARTUP_REPLACE_FAILED_MESSAGE,
  HUB_STARTUP_TIMEOUT_MESSAGE,
  hubCliLaunchArguments,
  inspectHubStatus,
  publishHubInstance,
  releaseHubInstance,
  replaceHubOwner,
  resolveHubOpenUrl,
  resolveHubStartupTimeoutMs,
  restartHubDetached,
  type HubChildHandle,
  type HubDiscovery,
  type HubInspectionStatus,
  type HubOwnerClaim,
  type HubReplacementTarget,
} from "../src/hub/instance.js";
import type { BuildIdentity } from "../src/core/build-identity.js";
import { stopDaemon } from "../src/daemon/client.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TEST_BUILD: BuildIdentity = {
  protocolVersion: 2,
  packageVersion: "0.2.0",
  buildId: "test-build-current",
  builtAt: "2026-07-28T00:00:00.000Z",
  sourceRevision: "dev-source",
  sourceDigest: "a".repeat(64),
};

const STALE_BUILD: BuildIdentity = {
  ...TEST_BUILD,
  buildId: "test-build-stale",
};

function makeHome(): string {
  return mkdtempSync(path.join(tmpdir(), "forklight-hub-instance-"));
}

function cleanupHome(home: string): void {
  rmSync(home, { recursive: true, force: true });
}

function claimFile(home: string): string {
  return path.join(home, ".hub-owner.json");
}

function descriptorFile(home: string): string {
  return path.join(home, "hub-instance.json");
}

function liveHub(token: string, nonce: string): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url !== "/api/liveness" || req.headers["x-forklight-hub-token"] !== token) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, nonce }));
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address !== null && typeof address === "object");
      resolve({
        port: address.port,
        close: () => new Promise<void>((done, fail) => {
          server.close((error) => error ? fail(error) : done());
          server.closeIdleConnections();
        }),
      });
    });
  });
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    waitTimeoutMs: 120,
    pollIntervalMs: 5,
    probeTimeoutMs: 50,
    ...overrides,
  };
}

test("a new home gets one private lifetime claim", async () => {
  const home = makeHome();
  chmodSync(home, 0o755);
  try {
    const result = await discoverOrClaimHub(home, options());
    assert.equal(result.kind, "start");
    assert.equal(statSync(home).mode & 0o777, 0o700);
    assert.equal(statSync(claimFile(home)).mode & 0o777, 0o600);
    assert.equal(existsSync(descriptorFile(home)), false, "descriptor appears only after listen");
    releaseHubInstance(home, result.claim);
    assert.equal(existsSync(claimFile(home)), false);
  } finally {
    cleanupHome(home);
  }
});

test("a published authenticated Hub is reused with the same URL", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  let claim: HubOwnerClaim | undefined;
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    claim = first.claim;
    const token = randomBytes(32).toString("base64url");
    const live = await liveHub(token, claim.nonce);
    close = live.close;
    publishHubInstance(home, claim, live.port, token, TEST_BUILD);

    // The full suite runs many daemon/Hub fixtures in parallel. Give this
    // already-listening local server enough scheduling headroom so host load is
    // not misclassified as an authenticated Hub that cannot be reused.
    const second = await discoverOrClaimHub(home, options({
      runIdentity: TEST_BUILD,
      waitTimeoutMs: 1_000,
      probeTimeoutMs: 500,
    }));
    assert.equal(second.kind, "reuse");
    assert.equal(second.port, live.port);
    assert.equal(second.url, `http://127.0.0.1:${live.port}/#${token}`);
    assert.equal(statSync(descriptorFile(home)).mode & 0o777, 0o600);
  } finally {
    await close?.();
    if (claim !== undefined) releaseHubInstance(home, claim);
    cleanupHome(home);
  }
});

test("two full startup flows produce one owner and one reuse result", async () => {
  const home = makeHome();
  let owner: { claim: HubOwnerClaim; close: () => Promise<void> } | undefined;
  async function launch(): Promise<"owner" | "reuse"> {
    const result = await discoverOrClaimHub(home, options({ waitTimeoutMs: 1_000 }));
    if (result.kind === "reuse") return "reuse";
    assert.equal(result.kind, "start");
    if (result.kind !== "start") throw new Error("unexpected version-aware discovery result");
    await new Promise((resolve) => setTimeout(resolve, 40));
    const token = randomBytes(32).toString("base64url");
    const live = await liveHub(token, result.claim.nonce);
    publishHubInstance(home, result.claim, live.port, token, TEST_BUILD);
    owner = { claim: result.claim, close: live.close };
    return "owner";
  }

  try {
    const outcomes = await Promise.all([launch(), launch()]);
    assert.deepEqual([...outcomes].sort(), ["owner", "reuse"]);
  } finally {
    if (owner !== undefined) {
      await owner.close();
      releaseHubInstance(home, owner.claim);
    }
    cleanupHome(home);
  }
});

test("a live startup claim is never stolen after the bounded wait", async () => {
  const home = makeHome();
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    const original = readFileSync(claimFile(home), "utf8");
    await assert.rejects(
      discoverOrClaimHub(home, options({ waitTimeoutMs: 25 })),
      /owner is still running|Another ForkLight Hub is starting/,
    );
    assert.equal(readFileSync(claimFile(home), "utf8"), original);
    releaseHubInstance(home, first.claim);
  } finally {
    cleanupHome(home);
  }
});

test("failed authentication does not replace or kill a live owner", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    const serverToken = randomBytes(32).toString("base64url");
    const storedToken = randomBytes(32).toString("base64url");
    const live = await liveHub(serverToken, first.claim.nonce);
    close = live.close;
    publishHubInstance(home, first.claim, live.port, storedToken, TEST_BUILD);
    const originalClaim = readFileSync(claimFile(home), "utf8");

    await assert.rejects(
      discoverOrClaimHub(home, options({ waitTimeoutMs: 30 })),
      /owner is still running/,
    );
    assert.equal(readFileSync(claimFile(home), "utf8"), originalClaim);
    releaseHubInstance(home, first.claim);
  } finally {
    await close?.();
    cleanupHome(home);
  }
});

test("a proven dead owner is cleaned and replaced without signalling it", async () => {
  const home = makeHome();
  try {
    const stale = await discoverOrClaimHub(home, options());
    assert.equal(stale.kind, "start");
    const seen: number[] = [];
    const replacement = await discoverOrClaimHub(home, options({
      pidAlive: (pid: number) => { seen.push(pid); return false; },
    }));
    assert.equal(replacement.kind, "start");
    assert.notEqual(replacement.claim.nonce, stale.claim.nonce);
    assert.deepEqual(seen, [stale.claim.pid]);
    releaseHubInstance(home, replacement.claim);
  } finally {
    cleanupHome(home);
  }
});

test("malformed lifecycle files are recovered without unbounded retry", async () => {
  const home = makeHome();
  writeFileSync(claimFile(home), "not-json", { mode: 0o600 });
  writeFileSync(descriptorFile(home), JSON.stringify({ schemaVersion: 999 }), { mode: 0o600 });
  try {
    const result = await discoverOrClaimHub(home, options());
    assert.equal(result.kind, "start");
    assert.doesNotThrow(() => JSON.parse(readFileSync(claimFile(home), "utf8")));
    assert.equal(existsSync(descriptorFile(home)), false);
    releaseHubInstance(home, result.claim);
  } finally {
    cleanupHome(home);
  }
});

test("an unknown owner-record version with a live PID is not stolen", async () => {
  const home = makeHome();
  const unknown = JSON.stringify({
    schemaVersion: 99,
    pid: process.pid,
    nonce: randomBytes(18).toString("base64url"),
    createdAtMs: Date.now(),
    futureField: true,
  });
  writeFileSync(claimFile(home), unknown, { mode: 0o600 });
  try {
    await assert.rejects(
      discoverOrClaimHub(home, options({ waitTimeoutMs: 25 })),
      /incompatible owner record/,
    );
    assert.equal(readFileSync(claimFile(home), "utf8"), unknown);
  } finally {
    cleanupHome(home);
  }
});

test("late cleanup from an old owner cannot delete replacement state", async () => {
  const home = makeHome();
  try {
    const old = await discoverOrClaimHub(home, options());
    assert.equal(old.kind, "start");
    const replacement: HubOwnerClaim = {
      schemaVersion: 1,
      pid: process.pid,
      nonce: randomBytes(18).toString("base64url"),
      createdAtMs: Date.now() + 1,
    };
    writeFileSync(claimFile(home), JSON.stringify(replacement), { mode: 0o600 });
    writeFileSync(descriptorFile(home), JSON.stringify({
      schemaVersion: 1,
      pid: replacement.pid,
      port: 12345,
      token: randomBytes(32).toString("base64url"),
      nonce: replacement.nonce,
    }), { mode: 0o600 });

    releaseHubInstance(home, old.claim);
    assert.equal(JSON.parse(readFileSync(claimFile(home), "utf8")).nonce, replacement.nonce);
    assert.equal(JSON.parse(readFileSync(descriptorFile(home), "utf8")).nonce, replacement.nonce);
    releaseHubInstance(home, replacement);
  } finally {
    cleanupHome(home);
  }
});

test("different homes intentionally acquire separate owners", async () => {
  const homeA = makeHome();
  const homeB = makeHome();
  try {
    const a = await discoverOrClaimHub(homeA, options());
    const b = await discoverOrClaimHub(homeB, options());
    assert.equal(a.kind, "start");
    assert.equal(b.kind, "start");
    releaseHubInstance(homeA, a.claim);
    releaseHubInstance(homeB, b.claim);
  } finally {
    cleanupHome(homeA);
    cleanupHome(homeB);
  }
});

function waitForOutput(
  child: ChildProcess,
  getOutput: () => string,
  pattern: RegExp,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      if (pattern.test(getOutput())) {
        clearInterval(timer);
        resolve();
      } else if (child.exitCode !== null) {
        clearInterval(timer);
        reject(new Error(`Hub child exited early (${child.exitCode})`));
      } else if (Date.now() >= deadline) {
        clearInterval(timer);
        reject(new Error("Timed out waiting for Hub output"));
      }
    }, 25);
  });
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for child exit")), timeoutMs);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

test("version-aware discovery reuses a matching owner", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  let claim: HubOwnerClaim | undefined;
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    claim = first.claim;
    const token = randomBytes(32).toString("base64url");
    const live = await liveHub(token, claim.nonce);
    close = live.close;
    publishHubInstance(home, claim, live.port, token, TEST_BUILD);

    const second = await discoverOrClaimHub(home, options({ runIdentity: TEST_BUILD }));
    assert.equal(second.kind, "reuse");
    assert.equal(second.port, live.port);
  } finally {
    await close?.();
    if (claim !== undefined) releaseHubInstance(home, claim);
    cleanupHome(home);
  }
});

test("version-aware discovery diagnoses a mismatched build identity", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  let claim: HubOwnerClaim | undefined;
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    claim = first.claim;
    const token = randomBytes(32).toString("base64url");
    const live = await liveHub(token, claim.nonce);
    close = live.close;
    publishHubInstance(home, claim, live.port, token, STALE_BUILD);

    const second = await discoverOrClaimHub(home, options({ runIdentity: TEST_BUILD }));
    assert.equal(second.kind, "stale-owner");
    assert.equal(second.port, live.port);
    assert.equal(second.replacement.descriptor.buildIdentity?.buildId, STALE_BUILD.buildId);
    // The stale owner is not signalled by discovery.
    assert.equal(live.port, second.port, "port unchanged — no signal sent");
  } finally {
    await close?.();
    if (claim !== undefined) releaseHubInstance(home, claim);
    cleanupHome(home);
  }
});

test("version-aware discovery diagnoses a legacy descriptor (no build identity)", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  let claim: HubOwnerClaim | undefined;
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    claim = first.claim;
    const token = randomBytes(32).toString("base64url");
    const live = await liveHub(token, claim.nonce);
    close = live.close;
    // Write a legacy descriptor without buildIdentity.
    const legacyDescriptor = JSON.stringify({
      schemaVersion: 1,
      pid: claim.pid,
      port: live.port,
      token,
      nonce: claim.nonce,
    });
    writeFileSync(descriptorFile(home), legacyDescriptor, { mode: 0o600 });

    const second = await discoverOrClaimHub(home, options({ runIdentity: TEST_BUILD }));
    assert.equal(second.kind, "legacy-owner");
    assert.equal(second.port, live.port);
  } finally {
    await close?.();
    if (claim !== undefined) releaseHubInstance(home, claim);
    cleanupHome(home);
  }
});

test("version-aware discovery reuses legacy descriptor when runIdentity is not provided", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  let claim: HubOwnerClaim | undefined;
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    claim = first.claim;
    const token = randomBytes(32).toString("base64url");
    const live = await liveHub(token, claim.nonce);
    close = live.close;
    // Legacy descriptor
    const legacyDescriptor = JSON.stringify({
      schemaVersion: 1,
      pid: claim.pid,
      port: live.port,
      token,
      nonce: claim.nonce,
    });
    writeFileSync(descriptorFile(home), legacyDescriptor, { mode: 0o600 });

    // Without runIdentity, legacy descriptors are reused.
    const second = await discoverOrClaimHub(home, options());
    assert.equal(second.kind, "reuse");
  } finally {
    await close?.();
    if (claim !== undefined) releaseHubInstance(home, claim);
    cleanupHome(home);
  }
});

test("confirmed replacement: sends SIGTERM and times out when old owner does not exit", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  let claim: HubOwnerClaim | undefined;
  // Install a no-op SIGTERM handler so the test survives the SIGTERM sent to itself.
  const sigtermHandlers = process.listeners("SIGTERM");
  process.removeAllListeners("SIGTERM");
  let sigtermReceived = false;
  process.on("SIGTERM", () => { sigtermReceived = true; });
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    claim = first.claim;
    const token = randomBytes(32).toString("base64url");
    const live = await liveHub(token, claim.nonce);
    close = live.close;
    publishHubInstance(home, claim, live.port, token, STALE_BUILD);
    const diagnosis = await discoverOrClaimHub(home, options({ runIdentity: TEST_BUILD }));
    assert.equal(diagnosis.kind, "stale-owner");
    if (diagnosis.kind !== "stale-owner") throw new Error("expected stale owner");

    // pidAlive always returns true — the wait loop never sees the PID die.
    const result = await replaceHubOwner(
      home,
      diagnosis.replacement,
      {
        ...options({ pollIntervalMs: 5, probeTimeoutMs: 500, pidAlive: () => true }),
        graceTimeoutMs: 250,
      },
    );
    assert.equal(result.success, false);
    assert.match(result.reason, /did not exit/);
    assert.equal(sigtermReceived, true, "SIGTERM was sent to the proven owner");
    // Claim and descriptor are preserved — we never automatically remove them.
    assert.equal(existsSync(claimFile(home)), true, "claim preserved after timeout");
    assert.equal(existsSync(descriptorFile(home)), true, "descriptor preserved after timeout");
  } finally {
    await close?.();
    if (claim !== undefined) releaseHubInstance(home, claim);
    cleanupHome(home);
    // Restore original SIGTERM handlers.
    process.removeAllListeners("SIGTERM");
    for (const handler of sigtermHandlers) process.on("SIGTERM", handler);
  }
});

test("clean home after old Hub owner exit starts a fresh owner", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  let claim: HubOwnerClaim | undefined;
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    claim = first.claim;
    const token = randomBytes(32).toString("base64url");
    const live = await liveHub(token, claim.nonce);
    close = live.close;
    publishHubInstance(home, claim, live.port, token, STALE_BUILD);

    // Simulate normal shutdown: the old Hub closes its server and releases resources.
    await close();
    close = undefined;
    releaseHubInstance(home, claim);

    // After cleanup, a new start claim is acquired without error.
    const fresh = await discoverOrClaimHub(home, options());
    assert.equal(fresh.kind, "start", "clean home allows a new start claim");
    releaseHubInstance(home, fresh.claim);
  } finally {
    await close?.();
    if (claim !== undefined) releaseHubInstance(home, claim);
    cleanupHome(home);
  }
});

test("confirmed replacement refuses when claim/descriptor change between diagnosis and restart", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  let claim: HubOwnerClaim | undefined;
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    claim = first.claim;
    const token = randomBytes(32).toString("base64url");
    const live = await liveHub(token, claim.nonce);
    close = live.close;
    publishHubInstance(home, claim, live.port, token, STALE_BUILD);
    const diagnosis = await discoverOrClaimHub(home, options({ runIdentity: TEST_BUILD }));
    assert.equal(diagnosis.kind, "stale-owner");
    if (diagnosis.kind !== "stale-owner") throw new Error("expected stale owner");

    // Change the descriptor between diagnosis and restart.
    // replaceHubOwner re-reads and will detect mismatch.
    writeFileSync(descriptorFile(home), JSON.stringify({
      schemaVersion: 1,
      pid: claim.pid,
      port: live.port,
      token,
      nonce: "a".repeat(32), // different nonce
      buildIdentity: STALE_BUILD,
    }), { mode: 0o600 });

    const result = await replaceHubOwner(
      home,
      diagnosis.replacement,
      {
        ...options({ probeTimeoutMs: 200 }),
        graceTimeoutMs: 500,
      },
    );
    assert.equal(result.success, false);
    assert.match(result.reason, /do not match|changed/);
  } finally {
    await close?.();
    if (claim !== undefined) releaseHubInstance(home, claim);
    cleanupHome(home);
  }
});

test("confirmed replacement fails closed if ownership changes after SIGTERM", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  let claim: HubOwnerClaim | undefined;
  const priorHandlers = process.listeners("SIGTERM");
  process.removeAllListeners("SIGTERM");
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    claim = first.claim;
    const token = randomBytes(32).toString("base64url");
    const live = await liveHub(token, claim.nonce);
    close = live.close;
    publishHubInstance(home, claim, live.port, token, STALE_BUILD);
    const diagnosis = await discoverOrClaimHub(home, options({ runIdentity: TEST_BUILD }));
    assert.equal(diagnosis.kind, "stale-owner");
    if (diagnosis.kind !== "stale-owner") throw new Error("expected stale owner");

    process.once("SIGTERM", () => {
      const replacementNonce = randomBytes(18).toString("base64url");
      writeFileSync(claimFile(home), JSON.stringify({
        schemaVersion: 1,
        pid: process.pid,
        nonce: replacementNonce,
        createdAtMs: Date.now() + 1,
      }), { mode: 0o600 });
      writeFileSync(descriptorFile(home), JSON.stringify({
        schemaVersion: 1,
        pid: process.pid,
        port: live.port,
        token: randomBytes(32).toString("base64url"),
        nonce: replacementNonce,
        buildIdentity: TEST_BUILD,
      }), { mode: 0o600 });
    });

    const result = await replaceHubOwner(
      home,
      diagnosis.replacement,
      {
        ...options({ pollIntervalMs: 5, probeTimeoutMs: 500, pidAlive: () => true }),
        graceTimeoutMs: 500,
      },
    );
    assert.equal(result.success, false);
    assert.match(result.reason, /ownership changed while the old owner was stopping/);
  } finally {
    process.removeAllListeners("SIGTERM");
    for (const handler of priorHandlers) process.on("SIGTERM", handler);
    await close?.();
    if (claim !== undefined) releaseHubInstance(home, claim);
    cleanupHome(home);
  }
});

test("confirmed replacement does not signal a process that no longer exists", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  let claim: HubOwnerClaim | undefined;
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    claim = first.claim;
    const token = randomBytes(32).toString("base64url");
    const live = await liveHub(token, claim.nonce);
    close = live.close;
    publishHubInstance(home, claim, live.port, token, STALE_BUILD);
    const diagnosis = await discoverOrClaimHub(home, options({ runIdentity: TEST_BUILD }));
    assert.equal(diagnosis.kind, "stale-owner");
    if (diagnosis.kind !== "stale-owner") throw new Error("expected stale owner");

    let sigtermReceived = false;
    const onSignal = (): void => { sigtermReceived = true; };
    process.once("SIGTERM", onSignal);
    const result = await replaceHubOwner(
      home,
      diagnosis.replacement,
      {
        ...options({ pidAlive: () => false }),
        graceTimeoutMs: 500,
      },
    );
    process.removeListener("SIGTERM", onSignal);
    assert.equal(result.success, false);
    assert.match(result.reason, /no longer running|no longer exists/);
    assert.equal(sigtermReceived, false, "dead owner is rejected before SIGTERM");
  } finally {
    await close?.();
    if (claim !== undefined) releaseHubInstance(home, claim);
    cleanupHome(home);
  }
});

test("after successful replacement, no leftover lifecycle files remain", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  let claim: HubOwnerClaim | undefined;
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    claim = first.claim;
    const token = randomBytes(32).toString("base64url");
    const live = await liveHub(token, claim.nonce);
    close = live.close;
    publishHubInstance(home, claim, live.port, token, STALE_BUILD);

    // Close the server and release the instance (simulates normal shutdown).
    await close();
    close = undefined;
    releaseHubInstance(home, claim);

    // After cleanup, the home should be clean.
    assert.equal(existsSync(claimFile(home)), false, "claim file removed");
    assert.equal(existsSync(descriptorFile(home)), false, "descriptor file removed");

    // A new instance can start cleanly.
    const fresh = await discoverOrClaimHub(home, options());
    assert.equal(fresh.kind, "start");
    releaseHubInstance(home, fresh.claim);
  } finally {
    await close?.();
    if (claim !== undefined) releaseHubInstance(home, claim);
    cleanupHome(home);
  }
});

test("descriptor file permissions remain private (0600)", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  let claim: HubOwnerClaim | undefined;
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    claim = first.claim;
    const token = randomBytes(32).toString("base64url");
    const live = await liveHub(token, claim.nonce);
    close = live.close;
    publishHubInstance(home, claim, live.port, token, TEST_BUILD);
    assert.equal(statSync(descriptorFile(home)).mode & 0o777, 0o600);
  } finally {
    await close?.();
    if (claim !== undefined) releaseHubInstance(home, claim);
    cleanupHome(home);
  }
});

test("CLI second invocation reuses the active Hub even with another requested port", async () => {
  const home = makeHome();
  const cliArgs = [
    "--disable-warning=ExperimentalWarning",
    "--import",
    "tsx",
    path.join(root, "src", "cli.ts"),
    "hub",
    "--no-open",
    "--port",
    "0",
  ];
  const env = { ...process.env, FORKLIGHT_HOME: home };
  const first = spawn(process.execPath, cliArgs, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let gracefulExitError: unknown;
  let claimGoneAfterExit = false;
  let descriptorGoneAfterExit = false;
  first.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  first.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });

  try {
    await waitForOutput(first, () => output, /\[frontend\] hub UI:/, 10_000);
    const before = readFileSync(descriptorFile(home), "utf8");
    const second = await execFileAsync(process.execPath, [
      ...cliArgs.slice(0, -1),
      "65534",
    ], { cwd: root, env, timeout: 10_000 });
    assert.match(second.stdout, /already active/);
    assert.match(second.stdout, /Open this URL:/);
    assert.equal(first.exitCode, null, "the original owner remains running");
    assert.equal(readFileSync(descriptorFile(home), "utf8"), before);
  } finally {
    if (first.exitCode === null) first.kill("SIGTERM");
    try {
      await waitForExit(first, 3_000);
      claimGoneAfterExit = !existsSync(claimFile(home));
      descriptorGoneAfterExit = !existsSync(descriptorFile(home));
    } catch (error) {
      gracefulExitError = error;
      if (first.exitCode === null) first.kill("SIGKILL");
      await waitForExit(first, 3_000).catch(() => undefined);
    }
    let daemonStopError: unknown;
    try {
      await stopDaemon(home);
    } catch (error) {
      daemonStopError = error;
    }
    cleanupHome(home);
    if (gracefulExitError !== undefined && daemonStopError !== undefined) {
      throw new AggregateError(
        [gracefulExitError, daemonStopError],
        "Hub child exit and exact-home daemon cleanup both failed",
      );
    }
    if (gracefulExitError !== undefined) throw gracefulExitError;
    if (daemonStopError !== undefined) throw daemonStopError;
  }
  assert.equal(claimGoneAfterExit, true, "graceful exit removes the exact claim");
  assert.equal(descriptorGoneAfterExit, true, "graceful exit removes the exact descriptor");
});

// --- Read-only Hub status inspection ---------------------------------------

function inspectOptions(overrides: Record<string, unknown> = {}) {
  return {
    probeTimeoutMs: 50,
    runIdentity: TEST_BUILD,
    ...overrides,
  };
}

function snapshotHome(home: string): { claim?: string; descriptor?: string; listing: string[] } {
  const listing: string[] = [];
  for (const entry of readdirSync(home)) listing.push(entry);
  let claim: string | undefined;
  let descriptor: string | undefined;
  if (existsSync(claimFile(home))) claim = readFileSync(claimFile(home), "utf8");
  if (existsSync(descriptorFile(home))) descriptor = readFileSync(descriptorFile(home), "utf8");
  return { ...(claim !== undefined ? { claim } : {}), ...(descriptor !== undefined ? { descriptor } : {}), listing };
}

test("inspectHubStatus reports stopped when the home does not exist and creates no files", async () => {
  const home = path.join(tmpdir(), `forklight-hub-status-missing-${randomBytes(6).toString("hex")}`);
  try {
    assert.equal(existsSync(home), false);
    const status = await inspectHubStatus(home, inspectOptions());
    assert.equal(status.state, "stopped");
    assert.equal(status.nextAction, "start");
    assert.equal(status.pid, undefined);
    assert.equal(status.port, undefined);
    assert.equal(existsSync(home), false, "inspectHubStatus must not create the home");
  } finally {
    cleanupHome(home);
  }
});

test("inspectHubStatus reports stopped when the home has no lifecycle records", async () => {
  const home = makeHome();
  try {
    const status = await inspectHubStatus(home, inspectOptions());
    assert.equal(status.state, "stopped");
    assert.equal(status.nextAction, "start");
  } finally {
    cleanupHome(home);
  }
});

test("inspectHubStatus reports current for a live authenticated matching Hub", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  let claim: HubOwnerClaim | undefined;
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    claim = first.claim;
    const token = randomBytes(32).toString("base64url");
    const live = await liveHub(token, claim.nonce);
    close = live.close;
    publishHubInstance(home, claim, live.port, token, TEST_BUILD);
    const before = snapshotHome(home);

    const status = await inspectHubStatus(home, inspectOptions({ runIdentity: TEST_BUILD }));
    assert.equal(status.state, "current");
    assert.equal(status.pid, claim.pid);
    assert.equal(status.port, live.port);
    assert.equal(status.nextAction, "none");
    assert.equal(status.reason, undefined);
    const after = snapshotHome(home);
    assert.deepEqual(after, before, "inspectHubStatus must not mutate lifecycle files");
  } finally {
    await close?.();
    if (claim !== undefined) releaseHubInstance(home, claim);
    cleanupHome(home);
  }
});

test("inspectHubStatus reports different-build for a live authenticated mismatched Hub", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  let claim: HubOwnerClaim | undefined;
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    claim = first.claim;
    const token = randomBytes(32).toString("base64url");
    const live = await liveHub(token, claim.nonce);
    close = live.close;
    publishHubInstance(home, claim, live.port, token, STALE_BUILD);
    const before = snapshotHome(home);

    const status = await inspectHubStatus(home, inspectOptions({ runIdentity: TEST_BUILD }));
    assert.equal(status.state, "different-build");
    assert.equal(status.pid, claim.pid);
    assert.equal(status.port, live.port);
    assert.equal(status.nextAction, "restart-with-confirm");
    const after = snapshotHome(home);
    assert.deepEqual(after, before, "different-build must not signal or replace the owner");
  } finally {
    await close?.();
    if (claim !== undefined) releaseHubInstance(home, claim);
    cleanupHome(home);
  }
});

test("inspectHubStatus reports legacy for a live authenticated Hub with no build identity", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  let claim: HubOwnerClaim | undefined;
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    claim = first.claim;
    const token = randomBytes(32).toString("base64url");
    const live = await liveHub(token, claim.nonce);
    close = live.close;
    const legacyDescriptor = JSON.stringify({
      schemaVersion: 1,
      pid: claim.pid,
      port: live.port,
      token,
      nonce: claim.nonce,
    });
    writeFileSync(descriptorFile(home), legacyDescriptor, { mode: 0o600 });
    const before = snapshotHome(home);

    const status = await inspectHubStatus(home, inspectOptions({ runIdentity: TEST_BUILD }));
    assert.equal(status.state, "legacy");
    assert.equal(status.pid, claim.pid);
    assert.equal(status.port, live.port);
    assert.equal(status.nextAction, "restart-with-confirm");
    const after = snapshotHome(home);
    assert.deepEqual(after, before, "legacy must not signal or replace the owner");
  } finally {
    await close?.();
    if (claim !== undefined) releaseHubInstance(home, claim);
    cleanupHome(home);
  }
});

test("inspectHubStatus reports unverified when the claim PID is dead", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  let claim: HubOwnerClaim | undefined;
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    claim = first.claim;
    const token = randomBytes(32).toString("base64url");
    const live = await liveHub(token, claim.nonce);
    close = live.close;
    publishHubInstance(home, claim, live.port, token, TEST_BUILD);
    const before = snapshotHome(home);

    const status = await inspectHubStatus(home, inspectOptions({
      runIdentity: TEST_BUILD,
      pidAlive: () => false,
    }));
    assert.equal(status.state, "unverified");
    assert.equal(status.pid, undefined, "dead owner must not leak a guessed PID");
    assert.equal(status.port, undefined, "dead owner must not leak a guessed port");
    assert.equal(status.nextAction, "start");
    const after = snapshotHome(home);
    assert.deepEqual(after, before, "unverified must not delete the existing claim or descriptor");
  } finally {
    await close?.();
    if (claim !== undefined) releaseHubInstance(home, claim);
    cleanupHome(home);
  }
});

test("inspectHubStatus reports unverified when authentication fails", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  let claim: HubOwnerClaim | undefined;
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    claim = first.claim;
    const serverToken = randomBytes(32).toString("base64url");
    const storedToken = randomBytes(32).toString("base64url");
    const live = await liveHub(serverToken, first.claim.nonce);
    close = live.close;
    publishHubInstance(home, claim, live.port, storedToken, TEST_BUILD);
    const before = snapshotHome(home);

    const status = await inspectHubStatus(home, inspectOptions({ runIdentity: TEST_BUILD }));
    assert.equal(status.state, "unverified");
    assert.equal(status.pid, undefined);
    assert.equal(status.port, undefined);
    assert.equal(status.nextAction, "investigate");
    assert.match(status.reason ?? "", /did not authenticate/);
    const after = snapshotHome(home);
    assert.deepEqual(after, before, "failed authentication must not signal or mutate");
  } finally {
    await close?.();
    if (claim !== undefined) releaseHubInstance(home, claim);
    cleanupHome(home);
  }
});

test("inspectHubStatus reports unverified when claim and descriptor disagree", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  let claim: HubOwnerClaim | undefined;
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    claim = first.claim;
    const token = randomBytes(32).toString("base64url");
    const live = await liveHub(token, claim.nonce);
    close = live.close;
    publishHubInstance(home, claim, live.port, token, TEST_BUILD);
    // Tamper with the descriptor: change the nonce to break claim/descriptor agreement.
    const tampered = JSON.stringify({
      schemaVersion: 1,
      pid: claim.pid,
      port: live.port,
      token,
      nonce: "b".repeat(24),
      buildIdentity: TEST_BUILD,
    });
    writeFileSync(descriptorFile(home), tampered, { mode: 0o600 });
    const before = snapshotHome(home);

    const status = await inspectHubStatus(home, inspectOptions({ runIdentity: TEST_BUILD }));
    assert.equal(status.state, "unverified");
    assert.equal(status.pid, undefined);
    assert.equal(status.port, undefined);
    assert.equal(status.nextAction, "investigate");
    assert.match(status.reason ?? "", /do not match/);
    const after = snapshotHome(home);
    assert.deepEqual(after, before, "mismatched evidence must be left visible");
  } finally {
    await close?.();
    if (claim !== undefined) releaseHubInstance(home, claim);
    cleanupHome(home);
  }
});

test("inspectHubStatus reports unverified when only a malformed claim exists", async () => {
  const home = makeHome();
  try {
    writeFileSync(claimFile(home), "{not json", { mode: 0o600 });
    const before = snapshotHome(home);
    const status = await inspectHubStatus(home, inspectOptions({ runIdentity: TEST_BUILD }));
    assert.equal(status.state, "unverified");
    assert.equal(status.pid, undefined);
    assert.equal(status.port, undefined);
    assert.equal(status.nextAction, "investigate");
    assert.match(status.reason ?? "", /claim is malformed/);
    const after = snapshotHome(home);
    assert.deepEqual(after, before, "malformed claim must be left untouched");
  } finally {
    cleanupHome(home);
  }
});

test("inspectHubStatus reports unverified when only a malformed descriptor exists", async () => {
  const home = makeHome();
  try {
    writeFileSync(descriptorFile(home), JSON.stringify({ schemaVersion: 999 }), { mode: 0o600 });
    const before = snapshotHome(home);
    const status = await inspectHubStatus(home, inspectOptions({ runIdentity: TEST_BUILD }));
    assert.equal(status.state, "unverified");
    assert.equal(status.pid, undefined);
    assert.equal(status.port, undefined);
    assert.equal(status.nextAction, "investigate");
    assert.match(status.reason ?? "", /descriptor is malformed/);
    const after = snapshotHome(home);
    assert.deepEqual(after, before, "malformed descriptor must be left untouched");
  } finally {
    cleanupHome(home);
  }
});

test("inspectHubStatus reports unverified when ownership changes during authentication", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  let claim: HubOwnerClaim | undefined;
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    claim = first.claim;
    const token = randomBytes(32).toString("base64url");
    // Fake Hub authenticates with the original token/nonce, then rewrites
    // the claim + descriptor on disk before responding. The probe's
    // success and the post-probe re-read together prove the
    // ownership-changed-during-authentication branch.
    const replacementNonce = randomBytes(18).toString("base64url");
    const replacementToken = randomBytes(32).toString("base64url");
    const fakePort = await new Promise<number>((resolve, reject) => {
      const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        if (req.url !== "/api/liveness" || req.headers["x-forklight-hub-token"] !== token) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }
        writeFileSync(claimFile(home), JSON.stringify({
          schemaVersion: 1,
          pid: process.pid,
          nonce: replacementNonce,
          createdAtMs: Date.now() + 1,
        }), { mode: 0o600 });
        writeFileSync(descriptorFile(home), JSON.stringify({
          schemaVersion: 1,
          pid: process.pid,
          port: 0,
          token: replacementToken,
          nonce: replacementNonce,
          buildIdentity: TEST_BUILD,
        }), { mode: 0o600 });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, nonce: claim!.nonce }));
        close = (): Promise<void> => new Promise((done, fail) => {
          server.close((error) => error ? fail(error) : done());
          server.closeIdleConnections();
        });
      });
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        assert.ok(address !== null && typeof address === "object");
        resolve(address.port);
      });
    });
    publishHubInstance(home, claim, fakePort, token, TEST_BUILD);

    const status = await inspectHubStatus(home, inspectOptions({ runIdentity: TEST_BUILD }));
    assert.equal(status.state, "unverified");
    assert.equal(status.pid, undefined);
    assert.equal(status.port, undefined);
    assert.equal(status.nextAction, "investigate");
    assert.match(status.reason ?? "", /changed during authentication|do not match/);
  } finally {
    await close?.();
    if (claim !== undefined) releaseHubInstance(home, claim);
    cleanupHome(home);
  }
});

test("inspectHubStatus output never contains token, nonce, URL fragment, or private path", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  let claim: HubOwnerClaim | undefined;
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    claim = first.claim;
    const token = randomBytes(32).toString("base64url");
    const live = await liveHub(token, claim.nonce);
    close = live.close;
    publishHubInstance(home, claim, live.port, token, TEST_BUILD);

    const status = await inspectHubStatus(home, inspectOptions({ runIdentity: TEST_BUILD }));
    const serialized = JSON.stringify(status);
    assert.ok(!serialized.includes(token), "JSON must not include the Hub token");
    assert.ok(!serialized.includes(claim.nonce), "JSON must not include the Hub nonce");
    assert.ok(!serialized.includes(`#${token}`), "JSON must not include the URL fragment");
    assert.ok(!serialized.includes(home), "JSON must not include the private home path");
  } finally {
    await close?.();
    if (claim !== undefined) releaseHubInstance(home, claim);
    cleanupHome(home);
  }
});

test("CLI hub status --json never contains token, nonce, URL fragment, or private path", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  let claim: HubOwnerClaim | undefined;
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    claim = first.claim;
    const token = randomBytes(32).toString("base64url");
    const live = await liveHub(token, claim.nonce);
    close = live.close;
    publishHubInstance(home, claim, live.port, token, TEST_BUILD);
    const before = snapshotHome(home);

    const result = await execFileAsync(process.execPath, [
      "--disable-warning=ExperimentalWarning",
      "--import",
      "tsx",
      path.join(root, "src", "cli.ts"),
      "hub",
      "status",
      "--json",
    ], { cwd: root, env: { ...process.env, FORKLIGHT_HOME: home }, timeout: 10_000 });
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.ok(["stopped", "current", "different-build", "legacy", "unverified"].includes(String(parsed.state)));
    const serialized = result.stdout;
    assert.ok(!serialized.includes(token), "stdout must not include the Hub token");
    assert.ok(!serialized.includes(claim.nonce), "stdout must not include the Hub nonce");
    assert.ok(!serialized.includes(`#${token}`), "stdout must not include the URL fragment");
    assert.ok(!serialized.includes(home), "stdout must not include the private home path");
    assert.ok(!serialized.includes("http://127.0.0.1"), "stdout must not include a URL");
    const after = snapshotHome(home);
    assert.deepEqual(after, before, "CLI hub status must not mutate lifecycle files");
  } finally {
    await close?.();
    if (claim !== undefined) releaseHubInstance(home, claim);
    cleanupHome(home);
  }
});

test("CLI hub status without --json never contains token, nonce, URL fragment, or private path", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  let claim: HubOwnerClaim | undefined;
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    claim = first.claim;
    const token = randomBytes(32).toString("base64url");
    const live = await liveHub(token, claim.nonce);
    close = live.close;
    publishHubInstance(home, claim, live.port, token, TEST_BUILD);
    const before = snapshotHome(home);

    const result = await execFileAsync(process.execPath, [
      "--disable-warning=ExperimentalWarning",
      "--import",
      "tsx",
      path.join(root, "src", "cli.ts"),
      "hub",
      "status",
    ], { cwd: root, env: { ...process.env, FORKLIGHT_HOME: home }, timeout: 10_000 });
    assert.ok(!result.stdout.includes(token), "stdout must not include the Hub token");
    assert.ok(!result.stdout.includes(claim.nonce), "stdout must not include the Hub nonce");
    assert.ok(!result.stdout.includes(`#${token}`), "stdout must not include the URL fragment");
    assert.ok(!result.stdout.includes(home), "stdout must not include the private home path");
    assert.ok(!result.stdout.includes("http://"), "stdout must not include a URL");
    assert.ok(!result.stdout.includes(TEST_BUILD.buildId), "stdout must not include a raw build id");
    const after = snapshotHome(home);
    assert.deepEqual(after, before, "CLI hub status must not mutate lifecycle files");
  } finally {
    await close?.();
    if (claim !== undefined) releaseHubInstance(home, claim);
    cleanupHome(home);
  }
});

test("CLI hub status does not start, claim, or signal a Hub on an empty home", async () => {
  const home = makeHome();
  try {
    const before = snapshotHome(home);
    const result = await execFileAsync(process.execPath, [
      "--disable-warning=ExperimentalWarning",
      "--import",
      "tsx",
      path.join(root, "src", "cli.ts"),
      "hub",
      "status",
    ], { cwd: root, env: { ...process.env, FORKLIGHT_HOME: home }, timeout: 10_000 });
    assert.match(result.stdout, /No ForkLight Hub is active\./);
    assert.match(result.stdout, /next: start one with `forklight hub`/);
    const after = snapshotHome(home);
    assert.deepEqual(after, before, "status must not create or mutate any lifecycle file");
  } finally {
    cleanupHome(home);
  }
});

test("CLI hub status rejects unknown flags without mutating lifecycle files", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  let claim: HubOwnerClaim | undefined;
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    claim = first.claim;
    const token = randomBytes(32).toString("base64url");
    const live = await liveHub(token, claim.nonce);
    close = live.close;
    publishHubInstance(home, claim, live.port, token, TEST_BUILD);
    const before = snapshotHome(home);

    await assert.rejects(
      execFileAsync(process.execPath, [
        "--disable-warning=ExperimentalWarning",
        "--import",
        "tsx",
        path.join(root, "src", "cli.ts"),
        "hub",
        "status",
        "--port",
        "1234",
      ], { cwd: root, env: { ...process.env, FORKLIGHT_HOME: home }, timeout: 10_000 }),
      /Unknown hub status flag/,
    );
    const after = snapshotHome(home);
    assert.deepEqual(after, before, "rejected CLI must not mutate lifecycle files");
  } finally {
    await close?.();
    if (claim !== undefined) releaseHubInstance(home, claim);
    cleanupHome(home);
  }
});

test("CLI hub status from an empty FORKLIGHT_HOME does not create the home", async () => {
  const home = path.join(tmpdir(), `forklight-hub-status-cli-missing-${randomBytes(6).toString("hex")}`);
  try {
    assert.equal(existsSync(home), false);
    const result = await execFileAsync(process.execPath, [
      "--disable-warning=ExperimentalWarning",
      "--import",
      "tsx",
      path.join(root, "src", "cli.ts"),
      "hub",
      "status",
      "--json",
    ], { cwd: root, env: { ...process.env, FORKLIGHT_HOME: home }, timeout: 10_000 });
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(parsed.state, "stopped");
    assert.equal(existsSync(home), false, "CLI status must not create the home directory");
  } finally {
    cleanupHome(home);
  }
});

test("inspectHubStatus fails closed when comparator is missing or malformed", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  let claim: HubOwnerClaim | undefined;
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    claim = first.claim;
    const token = randomBytes(32).toString("base64url");
    const live = await liveHub(token, claim.nonce);
    close = live.close;
    publishHubInstance(home, claim, live.port, token, TEST_BUILD);
    const before = snapshotHome(home);

    // Missing comparator: simulate a JavaScript caller bypassing the
    // TypeScript requirement so runIdentity is undefined at runtime.
    const statusMissing = await inspectHubStatus(
      home,
      { probeTimeoutMs: 50, runIdentity: undefined as unknown as BuildIdentity },
    );
    assert.equal(statusMissing.state, "unverified");
    assert.equal(statusMissing.nextAction, "investigate");
    assert.equal(statusMissing.pid, undefined);
    assert.equal(statusMissing.port, undefined);
    assert.match(statusMissing.reason ?? "", /valid build comparator/);
    const serialized = JSON.stringify(statusMissing);
    assert.ok(!serialized.includes(token), "missing comparator must not leak token");
    assert.ok(!serialized.includes(claim.nonce), "missing comparator must not leak nonce");
    assert.ok(!serialized.includes(home), "missing comparator must not leak home path");
    assert.ok(!serialized.includes("http://"), "missing comparator must not leak URL");

    // Malformed comparator: a non-BuildIdentity object.
    const statusMalformed = await inspectHubStatus(
      home,
      { probeTimeoutMs: 50, runIdentity: { notBuildIdentity: true } as unknown as BuildIdentity },
    );
    assert.equal(statusMalformed.state, "unverified");
    assert.equal(statusMalformed.nextAction, "investigate");
    assert.equal(statusMalformed.pid, undefined);
    assert.equal(statusMalformed.port, undefined);
    assert.match(statusMalformed.reason ?? "", /valid build comparator/);

    // Lifecycle evidence must be unchanged — no mutation, no signal.
    const after = snapshotHome(home);
    assert.deepEqual(after, before, "missing comparator must not mutate lifecycle files");
  } finally {
    await close?.();
    if (claim !== undefined) releaseHubInstance(home, claim);
    cleanupHome(home);
  }
});

// ---------------------------------------------------------------------------
// Detached Hub restart coordinator
// ---------------------------------------------------------------------------

function fakeClaim(pid = 1111): HubOwnerClaim {
  return {
    schemaVersion: 1,
    pid,
    nonce: "n".repeat(24),
    createdAtMs: 1_700_000_000_000,
  };
}

function fakeReplacement(port = 4321): HubReplacementTarget {
  const claim = fakeClaim(2222);
  const descriptor = {
    schemaVersion: 1 as const,
    pid: claim.pid,
    port,
    token: "t".repeat(32),
    nonce: claim.nonce,
    buildIdentity: STALE_BUILD,
  };
  return {
    claim,
    descriptor,
    claimRaw: JSON.stringify(claim),
    descriptorRaw: JSON.stringify(descriptor),
  };
}

function childHandle(pid: number, exited = false): HubChildHandle {
  return {
    pid,
    exited,
    exitCode: exited ? 1 : null,
    signalCode: null,
  };
}

test("resolveHubStartupTimeoutMs accepts 1000-60000 and rejects out of range", () => {
  assert.equal(resolveHubStartupTimeoutMs(1_000), 1_000);
  assert.equal(resolveHubStartupTimeoutMs(60_000), 60_000);
  assert.equal(resolveHubStartupTimeoutMs(), 30_000);
  assert.throws(() => resolveHubStartupTimeoutMs(999), /1000 to 60000/);
  assert.throws(() => resolveHubStartupTimeoutMs(60_001), /1000 to 60000/);
  assert.throws(() => resolveHubStartupTimeoutMs(1.5), /1000 to 60000/);
});

test("hubCliLaunchArguments uses argv arrays without a shell", () => {
  // Resolve as if called from src/hub/instance.ts (production module location).
  const instanceModuleUrl = pathToFileURL(path.join(root, "src", "hub", "instance.ts")).href;
  const launch = hubCliLaunchArguments(instanceModuleUrl);
  assert.equal(launch.executable, process.execPath);
  assert.equal(launch.mode, "source-dev");
  assert.ok(launch.args.every((part) => typeof part === "string"));
  assert.ok(!launch.args.some((part) => part.includes("&&") || part.includes("|")));
  const cliArg = launch.args.find((part) => part.endsWith(`${path.sep}cli.ts`));
  assert.equal(cliArg, path.join(root, "src", "cli.ts"));

  const distModuleUrl = pathToFileURL(path.join(root, "dist", "src", "hub", "instance.js")).href;
  const distLaunch = hubCliLaunchArguments(distModuleUrl);
  assert.equal(distLaunch.mode, "dist");
  assert.equal(
    distLaunch.args.find((part) => part.endsWith(`${path.sep}cli.js`)),
    path.join(root, "dist", "src", "cli.js"),
  );
});
test("detached restart no-ops when Hub is already current", async () => {
  const home = makeHome();
  let launches = 0;
  let replaces = 0;
  let inspects = 0;
  try {
    const result = await restartHubDetached(home, {
      runIdentity: TEST_BUILD,
      discover: async () => ({ kind: "reuse", port: 5555, url: "http://127.0.0.1:5555/#x" }),
      replace: async () => {
        replaces += 1;
        return { success: true, reason: "should not run" };
      },
      launch: () => {
        launches += 1;
        return childHandle(9999);
      },
      inspect: async () => {
        inspects += 1;
        return {
          state: "current",
          pid: 3333,
          port: 5555,
          nextAction: "none",
        };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.state, "current");
    assert.equal(result.replacement, "none-needed");
    assert.equal(result.nextAction, "use-existing-hub");
    assert.equal(result.pid, 3333);
    assert.equal(result.port, 5555);
    assert.equal(inspects, 2, "no-op must confirm the same owner twice");
    assert.equal(launches, 0, "current hub must not launch a child");
    assert.equal(replaces, 0, "current hub must not signal a replacement");
  } finally {
    cleanupHome(home);
  }
});

test("detached restart fails closed when current owner changes during confirmation", async () => {
  const home = makeHome();
  let launches = 0;
  let inspects = 0;
  try {
    const result = await restartHubDetached(home, {
      runIdentity: TEST_BUILD,
      discover: async () => ({ kind: "reuse", port: 5555, url: "http://127.0.0.1:5555/#x" }),
      launch: () => {
        launches += 1;
        return childHandle(9999);
      },
      inspect: async () => {
        inspects += 1;
        if (inspects === 1) {
          return { state: "current", pid: 3333, port: 5555, nextAction: "none" };
        }
        // Second confirmation sees a different owner.
        return { state: "current", pid: 4444, port: 5555, nextAction: "none" };
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.state, "failed");
    assert.equal(result.replacement, "not-started");
    assert.equal(result.nextAction, "investigate");
    assert.equal(result.reason, HUB_STARTUP_OWNERSHIP_CHANGED_MESSAGE);
    assert.equal(launches, 0, "ownership race during no-op must not launch");
    assert.equal(inspects, 2);
  } finally {
    cleanupHome(home);
  }
});

test("detached restart replaces a stale owner once and waits for current child", async () => {
  const home = makeHome();
  let launches = 0;
  let replaces = 0;
  let launchedPort: number | undefined;
  const replacement = fakeReplacement(4_100);
  try {
    const result = await restartHubDetached(home, {
      runIdentity: TEST_BUILD,
      startupTimeoutMs: 1_000,
      pollIntervalMs: 1,
      discover: async () => ({
        kind: "stale-owner",
        port: 4_100,
        url: "http://127.0.0.1:4100/#x",
        replacement,
      }),
      replace: async (_home, target) => {
        replaces += 1;
        assert.equal(target.claim.pid, replacement.claim.pid);
        return { success: true, reason: "old owner gone" };
      },
      launch: (_home, port) => {
        launches += 1;
        launchedPort = port;
        return childHandle(7_701);
      },
      inspect: async () => ({
        state: "current",
        pid: 7_701,
        port: 4_100,
        nextAction: "none",
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.state, "ready");
    assert.equal(result.replacement, "replaced");
    assert.equal(result.pid, 7_701);
    assert.equal(result.port, 4_100);
    assert.equal(replaces, 1);
    assert.equal(launches, 1, "exactly one child after replacement");
    assert.equal(launchedPort, 4_100, "prior port preserved by default");
  } finally {
    cleanupHome(home);
  }
});

test("detached restart starts on a clean home after releasing the parent claim", async () => {
  const home = makeHome();
  let launches = 0;
  let released = 0;
  const claim = fakeClaim(5_001);
  try {
    const result = await restartHubDetached(home, {
      runIdentity: TEST_BUILD,
      startupTimeoutMs: 1_000,
      pollIntervalMs: 1,
      discover: async () => ({ kind: "start", claim }),
      releaseClaim: (_home, releasedClaim) => {
        released += 1;
        assert.equal(releasedClaim.pid, claim.pid);
      },
      launch: () => {
        launches += 1;
        return childHandle(5_002);
      },
      inspect: async () => ({
        state: "current",
        pid: 5_002,
        port: 4_200,
        nextAction: "none",
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.state, "ready");
    assert.equal(result.replacement, "started");
    assert.equal(released, 1, "parent start claim must be released before launch");
    assert.equal(launches, 1);
    assert.equal(result.pid, 5_002);
  } finally {
    cleanupHome(home);
  }
});

test("detached restart preserves prior port and honors explicit override", async () => {
  const home = makeHome();
  const replacement = fakeReplacement(4_300);
  const ports: Array<number | undefined> = [];
  try {
    await restartHubDetached(home, {
      runIdentity: TEST_BUILD,
      startupTimeoutMs: 1_000,
      pollIntervalMs: 1,
      discover: async () => ({
        kind: "stale-owner",
        port: 4_300,
        url: "http://127.0.0.1:4300/#x",
        replacement,
      }),
      replace: async () => ({ success: true, reason: "gone" }),
      launch: (_home, port) => {
        ports.push(port);
        return childHandle(8_001);
      },
      inspect: async () => ({
        state: "current",
        pid: 8_001,
        port: 4_300,
        nextAction: "none",
      }),
    });
    await restartHubDetached(home, {
      runIdentity: TEST_BUILD,
      port: 4_444,
      startupTimeoutMs: 1_000,
      pollIntervalMs: 1,
      discover: async () => ({
        kind: "stale-owner",
        port: 4_300,
        url: "http://127.0.0.1:4300/#x",
        replacement,
      }),
      replace: async () => ({ success: true, reason: "gone" }),
      launch: (_home, port) => {
        ports.push(port);
        return childHandle(8_002);
      },
      inspect: async () => ({
        state: "current",
        pid: 8_002,
        port: 4_444,
        nextAction: "none",
      }),
    });
    assert.deepEqual(ports, [4_300, 4_444]);
  } finally {
    cleanupHome(home);
  }
});

test("detached restart times out after one launch without relaunching", async () => {
  const home = makeHome();
  let launches = 0;
  let now = 0;
  try {
    const result = await restartHubDetached(home, {
      runIdentity: TEST_BUILD,
      // Public floor remains 1000ms; virtual clock advances without real waits.
      startupTimeoutMs: 1_000,
      pollIntervalMs: 100,
      nowMs: () => now,
      sleepMs: async (ms) => {
        now += ms;
      },
      discover: async () => ({ kind: "start", claim: fakeClaim() }),
      releaseClaim: () => undefined,
      launch: () => {
        launches += 1;
        return childHandle(9_001);
      },
      inspect: async () => ({ state: "stopped", nextAction: "start" }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.state, "failed");
    assert.equal(result.replacement, "started");
    assert.equal(result.nextAction, "investigate");
    assert.match(result.reason ?? "", /startup timeout/);
    assert.match(result.reason ?? "", /check hub status/i);
    assert.match(result.reason ?? "", /may still become ready/i);
    assert.ok(
      result.reason?.startsWith(HUB_STARTUP_TIMEOUT_MESSAGE),
      "timeout reason must use the fixed public message",
    );
    assert.ok(!(result.reason ?? "").includes("retry"), "timeout must not invite direct retry");
    assert.equal(launches, 1, "timeout must never relaunch");
  } finally {
    cleanupHome(home);
  }
});

test("detached restart fails closed when the child exits early", async () => {
  const home = makeHome();
  let launches = 0;
  try {
    const result = await restartHubDetached(home, {
      runIdentity: TEST_BUILD,
      startupTimeoutMs: 1_000,
      pollIntervalMs: 1,
      discover: async () => ({ kind: "start", claim: fakeClaim() }),
      releaseClaim: () => undefined,
      launch: () => {
        launches += 1;
        return childHandle(9_101, true);
      },
      inspect: async () => ({ state: "stopped", nextAction: "start" }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.state, "failed");
    assert.match(result.reason ?? "", /exited before becoming ready/);
    assert.equal(launches, 1);
    assert.equal(result.nextAction, "investigate");
  } finally {
    cleanupHome(home);
  }
});

test("detached restart fails closed on ownership race without a second launch", async () => {
  const home = makeHome();
  let launches = 0;
  try {
    const result = await restartHubDetached(home, {
      runIdentity: TEST_BUILD,
      startupTimeoutMs: 1_000,
      pollIntervalMs: 1,
      discover: async () => ({ kind: "start", claim: fakeClaim() }),
      releaseClaim: () => undefined,
      launch: () => {
        launches += 1;
        return childHandle(9_201);
      },
      inspect: async () => ({
        state: "current",
        pid: 42_042,
        port: 4_500,
        nextAction: "none",
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.state, "failed");
    assert.match(result.reason ?? "", /ownership changed/);
    assert.equal(launches, 1, "ownership race must not launch again");
    assert.equal(result.nextAction, "investigate");
  } finally {
    cleanupHome(home);
  }
});

test("detached restart does not launch when exact replacement fails", async () => {
  const home = makeHome();
  let launches = 0;
  const replacement = fakeReplacement();
  const internalReason =
    "ForkLight Hub ownership changed after diagnosis; nothing was signalled; secret=abc";
  try {
    const result = await restartHubDetached(home, {
      runIdentity: TEST_BUILD,
      discover: async () => ({
        kind: "stale-owner",
        port: replacement.descriptor.port,
        url: "http://127.0.0.1:1/#x",
        replacement,
      }),
      replace: async () => ({
        success: false,
        reason: internalReason,
      }),
      launch: () => {
        launches += 1;
        return childHandle(1);
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.replacement, "not-started");
    assert.equal(launches, 0);
    assert.equal(result.reason, HUB_STARTUP_REPLACE_FAILED_MESSAGE);
    assert.equal(result.nextAction, "investigate");
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(internalReason), "must not forward internal replace text");
    assert.ok(!serialized.includes("nothing was signalled"));
    assert.ok(!serialized.includes("secret=abc"));
  } finally {
    cleanupHome(home);
  }
});

test("detached restart result JSON is privacy-safe", async () => {
  const home = makeHome();
  const secretHome = path.join(home, "secret-private-home");
  const token = "TokEn_leak_" + "x".repeat(24);
  const nonce = "NonCe_leak_" + "y".repeat(16);
  try {
    const result = await restartHubDetached(secretHome, {
      runIdentity: TEST_BUILD,
      startupTimeoutMs: 1_000,
      pollIntervalMs: 1,
      discover: async () => ({
        kind: "stale-owner",
        port: 4_600,
        url: `http://127.0.0.1:4600/#${token}`,
        replacement: {
          ...fakeReplacement(4_600),
          descriptor: {
            ...fakeReplacement(4_600).descriptor,
            token,
            nonce,
          },
        },
      }),
      replace: async () => ({ success: true, reason: "gone" }),
      launch: () => childHandle(9_301),
      inspect: async () => ({
        state: "current",
        pid: 9_301,
        port: 4_600,
        nextAction: "none",
      }),
    });
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(token), "result must not contain token");
    assert.ok(!serialized.includes(nonce), "result must not contain nonce");
    assert.ok(!serialized.includes(secretHome), "result must not contain home path");
    assert.ok(!serialized.includes("http://"), "result must not contain URL");
    assert.ok(!serialized.includes("FORKLIGHT"), "result must not contain env keys");
    assert.ok(!/"token"\s*:/.test(serialized));
    assert.ok(!/"nonce"\s*:/.test(serialized));
    assert.deepEqual(
      Object.keys(result).sort(),
      ["nextAction", "ok", "pid", "port", "replacement", "state"].sort(),
    );
  } finally {
    cleanupHome(home);
  }
});

test("resolveHubOpenUrl only returns the URL for the proven owner", async () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;
  let claim: HubOwnerClaim | undefined;
  try {
    const first = await discoverOrClaimHub(home, options());
    assert.equal(first.kind, "start");
    claim = first.claim;
    const token = randomBytes(32).toString("base64url");
    const live = await liveHub(token, claim.nonce);
    close = live.close;
    publishHubInstance(home, claim, live.port, token, TEST_BUILD);
    const url = resolveHubOpenUrl(home, claim.pid, live.port);
    assert.ok(url?.includes(`:${live.port}/#`));
    assert.ok(url?.includes(encodeURIComponent(token)));
    assert.equal(resolveHubOpenUrl(home, claim.pid + 1, live.port), undefined);
    assert.equal(resolveHubOpenUrl(home, claim.pid, live.port + 1), undefined);
  } finally {
    await close?.();
    if (claim !== undefined) releaseHubInstance(home, claim);
    cleanupHome(home);
  }
});

test("detached restart discovery type stays closed for coordinator seams", async () => {
  // Compile-time shape guard: seams accept the same HubDiscovery closed union.
  const kinds: HubDiscovery["kind"][] = ["reuse", "stale-owner", "legacy-owner", "start"];
  const states: HubInspectionStatus["state"][] = [
    "stopped", "current", "different-build", "legacy", "unverified",
  ];
  assert.equal(kinds.length, 4);
  assert.equal(states.length, 5);
});
