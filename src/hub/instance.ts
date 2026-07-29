/**
 * Single-owner lifecycle for the local ForkLight Hub.
 *
 * The ownership claim stays present for the Hub's whole lifetime. A contender
 * may reuse a descriptor only when the claim owner is alive and the loopback
 * server proves the stored token + nonce. It never signals the recorded PID.
 */

import { randomBytes } from "node:crypto";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { get } from "node:http";
import { createConnection } from "node:net";
import path from "node:path";
import { compareBuildIdentity, isBuildIdentity, type BuildIdentity } from "../core/build-identity.js";

const SCHEMA_VERSION = 1;
const DESCRIPTOR_FILE = "hub-instance.json";
const CLAIM_FILE = ".hub-owner.json";
const LOOPBACK = "127.0.0.1";
const DEFAULT_WAIT_MS = 5_000;
const DEFAULT_POLL_MS = 100;
const DEFAULT_PROBE_MS = 1_000;
const MAX_PROBE_BYTES = 4_096;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;

export interface HubOwnerClaim {
  readonly schemaVersion: 1;
  readonly pid: number;
  readonly nonce: string;
  readonly createdAtMs: number;
}

export interface HubInstanceDescriptor {
  readonly schemaVersion: 1;
  readonly pid: number;
  readonly port: number;
  readonly token: string;
  readonly nonce: string;
  readonly buildIdentity?: BuildIdentity;
}

/** Opaque in-process authority frozen by a proven stale/legacy discovery. */
export interface HubReplacementTarget {
  readonly claim: HubOwnerClaim;
  readonly descriptor: HubInstanceDescriptor;
  readonly claimRaw: string;
  readonly descriptorRaw: string;
}

export type HubDiscovery =
  | { readonly kind: "reuse"; readonly url: string; readonly port: number }
  | { readonly kind: "stale-owner"; readonly url: string; readonly port: number; readonly replacement: HubReplacementTarget }
  | { readonly kind: "legacy-owner"; readonly url: string; readonly port: number; readonly replacement: HubReplacementTarget }
  | { readonly kind: "start"; readonly claim: HubOwnerClaim };

export interface HubDiscoveryOptions {
  readonly waitTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly probeTimeoutMs?: number;
  /** Deterministic test seam. Production always uses signal 0. */
  readonly pidAlive?: (pid: number) => boolean;
  /** The invoking CLI's built artifact identity. When provided, a live Hub
   *  is only reused when the descriptor's build identity matches exactly;
   *  mismatched and legacy descriptors return a diagnosis instead. */
  readonly runIdentity?: BuildIdentity;
}

interface FileRecord<T> {
  exists: boolean;
  raw?: string;
  value?: T;
}

function descriptorPath(home: string): string {
  return path.join(home, DESCRIPTOR_FILE);
}

function claimPath(home: string): string {
  return path.join(home, CLAIM_FILE);
}

const DESCRIPTOR_KEYS_LEGACY: readonly string[] = ["schemaVersion", "pid", "port", "token", "nonce"];
const DESCRIPTOR_KEYS_VERSIONED: readonly string[] = [...DESCRIPTOR_KEYS_LEGACY, "buildIdentity"];

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseClaim(raw: string): HubOwnerClaim | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return undefined; }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const value = parsed as Record<string, unknown>;
  if (!exactKeys(value, ["schemaVersion", "pid", "nonce", "createdAtMs"])) return undefined;
  if (value.schemaVersion !== SCHEMA_VERSION || !positiveInteger(value.pid)) return undefined;
  if (typeof value.nonce !== "string" || !NONCE_RE.test(value.nonce)) return undefined;
  if (!positiveInteger(value.createdAtMs)) return undefined;
  return {
    schemaVersion: SCHEMA_VERSION,
    pid: value.pid,
    nonce: value.nonce,
    createdAtMs: value.createdAtMs,
  };
}

function looseClaimPid(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const pid = (parsed as Record<string, unknown>).pid;
    return positiveInteger(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

function parseDescriptor(raw: string): HubInstanceDescriptor | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return undefined; }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const value = parsed as Record<string, unknown>;
  const keys = Object.keys(value);
  const isLegacy = keys.length === DESCRIPTOR_KEYS_LEGACY.length
    && keys.every((key) => DESCRIPTOR_KEYS_LEGACY.includes(key));
  const isVersioned = keys.length === DESCRIPTOR_KEYS_VERSIONED.length
    && keys.every((key) => DESCRIPTOR_KEYS_VERSIONED.includes(key));
  if (!isLegacy && !isVersioned) return undefined;
  if (value.schemaVersion !== SCHEMA_VERSION || !positiveInteger(value.pid)) return undefined;
  if (!positiveInteger(value.port) || value.port > 65_535) return undefined;
  if (typeof value.token !== "string" || !TOKEN_RE.test(value.token)) return undefined;
  if (typeof value.nonce !== "string" || !NONCE_RE.test(value.nonce)) return undefined;
  // Treat a legacy descriptor as a valid descriptor with unknown build identity.
  if (isLegacy) {
    return {
      schemaVersion: SCHEMA_VERSION,
      pid: value.pid,
      port: value.port,
      token: value.token,
      nonce: value.nonce,
    };
  }
  // Versioned descriptor: validate the build identity or reject.
  const rawBuildIdentity = value.buildIdentity;
  if (rawBuildIdentity !== undefined && rawBuildIdentity !== null) {
    if (!isBuildIdentity(rawBuildIdentity)) return undefined;
    return {
      schemaVersion: SCHEMA_VERSION,
      pid: value.pid,
      port: value.port,
      token: value.token,
      nonce: value.nonce,
      buildIdentity: rawBuildIdentity,
    };
  }
  // Versioned key set without a valid build identity is malformed.
  return undefined;
}

function readRecord<T>(file: string, parse: (raw: string) => T | undefined): FileRecord<T> {
  try {
    const raw = readFileSync(file, "utf8");
    const value = parse(raw);
    return value === undefined ? { exists: true, raw } : { exists: true, raw, value };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false };
    throw error;
  }
}

function removeIfUnchanged(file: string, expectedRaw: string | undefined): void {
  if (expectedRaw === undefined) return;
  try {
    if (readFileSync(file, "utf8") !== expectedRaw) return;
    unlinkSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function ensurePrivateHome(home: string): void {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  // ForkLight state contains private local execution evidence. Existing homes
  // are normalized too; mkdir's mode does not change an existing directory.
  chmodSync(home, 0o700);
}

function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hubUrl(port: number, token: string): string {
  return `http://${LOOPBACK}:${port}/#${encodeURIComponent(token)}`;
}

function claimMatchesDescriptor(claim: HubOwnerClaim, descriptor: HubInstanceDescriptor): boolean {
  return claim.pid === descriptor.pid && claim.nonce === descriptor.nonce;
}

function sameClaim(left: HubOwnerClaim, right: HubOwnerClaim): boolean {
  return left.pid === right.pid && left.nonce === right.nonce
    && left.createdAtMs === right.createdAtMs;
}

function freezeReplacementTarget(
  claimRecord: FileRecord<HubOwnerClaim>,
  descriptorRecord: FileRecord<HubInstanceDescriptor>,
): HubReplacementTarget {
  if (
    claimRecord.value === undefined
    || descriptorRecord.value === undefined
    || claimRecord.raw === undefined
    || descriptorRecord.raw === undefined
  ) {
    throw new Error("ForkLight Hub replacement authority could not be frozen");
  }
  return {
    claim: claimRecord.value,
    descriptor: descriptorRecord.value,
    claimRaw: claimRecord.raw,
    descriptorRaw: descriptorRecord.raw,
  };
}

function atomicPrivateWrite(file: string, payload: string): void {
  const tmp = `${file}.tmp.${process.pid}.${randomBytes(6).toString("hex")}`;
  writeFileSync(tmp, payload, { flag: "wx", mode: 0o600 });
  try {
    renameSync(tmp, file);
  } catch (error) {
    try { unlinkSync(tmp); } catch { /* best effort */ }
    throw error;
  }
}

function tryAcquireClaim(home: string): HubOwnerClaim | undefined {
  const claim: HubOwnerClaim = {
    schemaVersion: SCHEMA_VERSION,
    pid: process.pid,
    nonce: randomBytes(18).toString("base64url"),
    createdAtMs: Date.now(),
  };
  const lock = claimPath(home);
  const tmp = `${lock}.tmp.${process.pid}.${claim.nonce}`;
  writeFileSync(tmp, JSON.stringify(claim), { flag: "wx", mode: 0o600 });
  try {
    // link(2) is the exclusive publication: it never replaces a live claim.
    linkSync(tmp, lock);
    return claim;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return undefined;
  } finally {
    try { unlinkSync(tmp); } catch { /* best effort */ }
  }
}

function probeLiveHub(
  descriptor: HubInstanceDescriptor,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = get(
      `http://${LOOPBACK}:${descriptor.port}/api/liveness`,
      { headers: { "x-forklight-hub-token": descriptor.token } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          finish(false);
          return;
        }
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
          if (Buffer.byteLength(body) > MAX_PROBE_BYTES) {
            res.destroy();
            finish(false);
          }
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(body) as Record<string, unknown>;
            finish(parsed.ok === true && parsed.nonce === descriptor.nonce);
          } catch {
            finish(false);
          }
        });
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      finish(false);
    });
    req.on("error", () => finish(false));
  });
}

/**
 * Return a proven live Hub or a lifetime ownership claim for a new one.
 * A live-but-unproven owner is never stolen; the caller gets an actionable
 * error after the bounded wait instead of a duplicate Hub.
 *
 * When `options.runIdentity` is provided, a proven live Hub is only reused
 * when its descriptor carries the same exact build identity. Mismatched and
 * legacy (no identity) descriptors return a diagnosis instead so the caller
 * can decide whether to restart.
 */
export async function discoverOrClaimHub(
  home: string,
  options: HubDiscoveryOptions = {},
): Promise<HubDiscovery> {
  ensurePrivateHome(home);
  const waitMs = options.waitTimeoutMs ?? DEFAULT_WAIT_MS;
  const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  const probeMs = options.probeTimeoutMs ?? DEFAULT_PROBE_MS;
  const pidAlive = options.pidAlive ?? defaultPidAlive;
  const runIdentity = options.runIdentity;
  const deadline = Date.now() + Math.max(0, waitMs);

  while (true) {
    const claimRecord = readRecord(claimPath(home), parseClaim);
    const descriptorRecord = readRecord(descriptorPath(home), parseDescriptor);

    if (claimRecord.value !== undefined) {
      const claim = claimRecord.value;
      if (!pidAlive(claim.pid)) {
        if (descriptorRecord.exists) {
          removeIfUnchanged(descriptorPath(home), descriptorRecord.raw);
        }
        removeIfUnchanged(claimPath(home), claimRecord.raw);
        continue;
      }

      const descriptor = descriptorRecord.value;
      if (
        descriptor !== undefined
        && claimMatchesDescriptor(claim, descriptor)
        && await probeLiveHub(descriptor, probeMs)
      ) {
        const url = hubUrl(descriptor.port, descriptor.token);
        // Version-aware identity comparison.
        if (runIdentity !== undefined) {
          if (descriptor.buildIdentity === undefined) {
            return {
              kind: "legacy-owner",
              url,
              port: descriptor.port,
              replacement: freezeReplacementTarget(claimRecord, descriptorRecord),
            };
          }
          const comparison = compareBuildIdentity(runIdentity, descriptor.buildIdentity);
          if (comparison.sameBuild) {
            return { kind: "reuse", port: descriptor.port, url };
          }
          return {
            kind: "stale-owner",
            url,
            port: descriptor.port,
            replacement: freezeReplacementTarget(claimRecord, descriptorRecord),
          };
        }
        // No runIdentity — always reuse (backward compatibility path).
        return { kind: "reuse", port: descriptor.port, url };
      }

      if (Date.now() >= deadline) {
        throw new Error(
          "A ForkLight Hub owner is still running, but its authenticated control page is not ready. "
          + "Wait a moment or stop that Hub before starting another one.",
        );
      }
      await sleep(Math.max(1, pollMs));
      continue;
    }

    if (claimRecord.exists) {
      // Claims are published atomically. If an unknown/newer record still
      // names a live process, fail closed rather than letting an older CLI
      // steal it. Bytes without a live owner are stale and can be replaced.
      const loosePid = looseClaimPid(claimRecord.raw);
      if (loosePid !== undefined && pidAlive(loosePid)) {
        if (Date.now() >= deadline) {
          throw new Error(
            "A ForkLight Hub owner is still running with an incompatible owner record. "
            + "Upgrade this CLI or stop that Hub before starting another one.",
          );
        }
        await sleep(Math.max(1, pollMs));
        continue;
      }
      removeIfUnchanged(claimPath(home), claimRecord.raw);
      continue;
    }

    // A descriptor without its lifetime claim cannot authorize reuse.
    if (descriptorRecord.exists) {
      removeIfUnchanged(descriptorPath(home), descriptorRecord.raw);
    }

    const claim = tryAcquireClaim(home);
    if (claim !== undefined) return { kind: "start", claim };

    if (Date.now() >= deadline) {
      throw new Error("Another ForkLight Hub is starting. Try again in a moment.");
    }
    await sleep(Math.max(1, pollMs));
  }
}

/** Publish only while the caller still owns the exact lifetime claim. */
export function publishHubInstance(
  home: string,
  claim: HubOwnerClaim,
  port: number,
  token: string,
  buildIdentity: BuildIdentity,
): HubInstanceDescriptor {
  const current = readRecord(claimPath(home), parseClaim).value;
  if (current === undefined || !sameClaim(current, claim)) {
    throw new Error("ForkLight Hub ownership changed before publication");
  }
  const descriptor: HubInstanceDescriptor = {
    schemaVersion: SCHEMA_VERSION,
    pid: claim.pid,
    port,
    token,
    nonce: claim.nonce,
    buildIdentity,
  };
  // Validate before writing so public callers cannot persist malformed state.
  if (parseDescriptor(JSON.stringify(descriptor)) === undefined) {
    throw new Error("Invalid ForkLight Hub descriptor");
  }
  atomicPrivateWrite(descriptorPath(home), JSON.stringify(descriptor));
  return descriptor;
}

export interface ReplaceHubResult {
  readonly success: boolean;
  readonly reason: string;
}

/** Bounded, token-free result of a read-only Hub inspection. */
export type HubInspectionState =
  | "stopped"
  | "current"
  | "different-build"
  | "legacy"
  | "unverified";

/** Bounded, single next-action suggestion derived from the safe state. */
export type HubInspectionNextAction =
  | "none"
  | "start"
  | "restart-with-confirm"
  | "investigate";

/** Token-free status surface. The type is incapable of carrying the URL,
 *  fragment token, nonce, raw record bytes, or any private path. */
export interface HubInspectionStatus {
  readonly state: HubInspectionState;
  /** PID is only populated when the same exact lifetime claim and descriptor
   *  were both readable, claim-PID alive, and the loopback probe succeeded. */
  readonly pid?: number;
  /** Port is only populated under the same combined proof as the PID. */
  readonly port?: number;
  /** Short bounded reason for `unverified` (no private material). */
  readonly reason?: string;
  /** Every status carries exactly one explicit next action. */
  readonly nextAction: HubInspectionNextAction;
}

export interface HubInspectionOptions {
  readonly probeTimeoutMs?: number;
  /** Deterministic test seam. Production always uses signal 0. */
  readonly pidAlive?: (pid: number) => boolean;
  /** The invoking CLI's built artifact identity. The proven owner
   *  build is always compared with the supplied identity to distinguish
   *  `current` from `different-build`. */
  readonly runIdentity: BuildIdentity;
}

/** Read-only Hub status. The function may read private lifecycle
 *  records, check PID liveness, and perform the existing bounded
 *  authenticated loopback probe. It must never create the home,
 *  acquire a claim, publish/remove/rename/rewrite a lifecycle file,
 *  signal a PID, start/stop/restart a process, open a browser,
 *  rotate a token, or call the daemon. */
export async function inspectHubStatus(
  home: string,
  options: HubInspectionOptions,
): Promise<HubInspectionStatus> {
  const probeMs = options.probeTimeoutMs ?? DEFAULT_PROBE_MS;
  const pidAlive = options.pidAlive ?? defaultPidAlive;
  const runIdentity = options.runIdentity;

  // Fail closed: a valid comparator is mandatory before reading lifecycle records.
  if (!isBuildIdentity(runIdentity)) {
    return {
      state: "unverified",
      reason: "a valid build comparator is required to determine Hub identity",
      nextAction: "investigate",
    };
  }

  const claimRecord = readRecord(claimPath(home), parseClaim);
  const descriptorRecord = readRecord(descriptorPath(home), parseDescriptor);

  if (!claimRecord.exists && !descriptorRecord.exists) {
    return { state: "stopped", nextAction: "start" };
  }

  if (claimRecord.value === undefined && descriptorRecord.value === undefined) {
    const claimState = claimRecord.exists ? "malformed" : "missing";
    const descriptorState = descriptorRecord.exists ? "malformed" : "missing";
    return {
      state: "unverified",
      reason: `Hub lifetime claim is ${claimState} and Hub descriptor is ${descriptorState}`,
      nextAction: "investigate",
    };
  }
  if (claimRecord.value === undefined) {
    return {
      state: "unverified",
      reason: claimRecord.exists
        ? "Hub lifetime claim is malformed"
        : "Hub lifetime claim is missing",
      nextAction: "investigate",
    };
  }
  if (descriptorRecord.value === undefined) {
    return {
      state: "unverified",
      reason: descriptorRecord.exists
        ? "Hub descriptor is malformed"
        : "Hub descriptor is missing",
      nextAction: "investigate",
    };
  }

  const claim = claimRecord.value;
  const descriptor = descriptorRecord.value;

  if (!claimMatchesDescriptor(claim, descriptor)) {
    return {
      state: "unverified",
      reason: "Hub claim and descriptor do not match",
      nextAction: "investigate",
    };
  }

  if (!pidAlive(claim.pid)) {
    return {
      state: "unverified",
      reason: "the recorded Hub owner is not running",
      nextAction: "start",
    };
  }

  if (!await probeLiveHub(descriptor, probeMs)) {
    return {
      state: "unverified",
      reason: "the recorded Hub owner did not authenticate",
      nextAction: "investigate",
    };
  }

  // Re-read after the probe to ensure the proof is still authoritative.
  const claimAfter = readRecord(claimPath(home), parseClaim);
  const descriptorAfter = readRecord(descriptorPath(home), parseDescriptor);
  if (
    claimAfter.raw !== claimRecord.raw
    || descriptorAfter.raw !== descriptorRecord.raw
    || claimAfter.value === undefined
    || descriptorAfter.value === undefined
    || !sameClaim(claimAfter.value, claim)
    || !claimMatchesDescriptor(claimAfter.value, descriptorAfter.value)
    || !pidAlive(claim.pid)
  ) {
    return {
      state: "unverified",
      reason: "Hub ownership changed during authentication",
      nextAction: "investigate",
    };
  }

  // All evidence proven consistent. Now classify the proven owner build.
  if (descriptor.buildIdentity === undefined) {
    return {
      state: "legacy",
      pid: descriptor.pid,
      port: descriptor.port,
      nextAction: "restart-with-confirm",
    };
  }
  const comparison = compareBuildIdentity(runIdentity, descriptor.buildIdentity);
  if (comparison.sameBuild) {
    return {
      state: "current",
      pid: descriptor.pid,
      port: descriptor.port,
      nextAction: "none",
    };
  }
  return {
    state: "different-build",
    pid: descriptor.pid,
    port: descriptor.port,
    nextAction: "restart-with-confirm",
  };
}

/** Check whether a loopback TCP port is free (no listener). */
function isPortFree(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ host: LOOPBACK, port });
    sock.setTimeout(timeoutMs);
    sock.on("connect", () => {
      sock.destroy();
      resolve(false);
    });
    sock.on("error", () => resolve(true));
    sock.on("timeout", () => {
      sock.destroy();
      resolve(false);
    });
  });
}

/**
 * Replace a proven Hub owner with a new one after explicit confirmation.
 *
 * Re-reads the exact private descriptor and claim from disk, verifies both
 * through the authenticated liveness probe, sends graceful termination only
 * to the proven PID, and waits within a bounded interval for the old PID,
 * listener, descriptor, and claim to all disappear. It never sends SIGKILL
 * automatically.
 *
 * The caller must call `discoverOrClaimHub` again after a successful
 * replacement to acquire a new lifetime claim.
 */
export async function replaceHubOwner(
  home: string,
  target: HubReplacementTarget,
  options: HubDiscoveryOptions & { graceTimeoutMs: number },
): Promise<ReplaceHubResult> {
  const probeMs = options.probeTimeoutMs ?? DEFAULT_PROBE_MS;
  const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  const pidAlive = options.pidAlive ?? defaultPidAlive;
  const graceMs = options.graceTimeoutMs;

  // 1. Re-read the exact private descriptor and claim frozen by discovery.
  const claimRecord = readRecord(claimPath(home), parseClaim);
  const descriptorRecord = readRecord(descriptorPath(home), parseDescriptor);

  if (
    claimRecord.raw !== target.claimRaw
    || descriptorRecord.raw !== target.descriptorRaw
    || claimRecord.value === undefined
    || descriptorRecord.value === undefined
  ) {
    return {
      success: false,
      reason: "ForkLight Hub ownership changed after diagnosis; nothing was signalled",
    };
  }

  const claim = claimRecord.value;
  const descriptor = descriptorRecord.value;

  // 2. Verify claim matches descriptor.
  if (!claimMatchesDescriptor(claim, descriptor)) {
    return {
      success: false,
      reason: "ForkLight Hub owner and descriptor do not match — ownership may have changed since diagnosis",
    };
  }

  // 3. Verify the PID is still alive.
  if (!pidAlive(claim.pid)) {
    return { success: false, reason: "The ForkLight Hub owner process is no longer running" };
  }

  // 4. Authenticate via loopback liveness with the stored token + nonce.
  if (!await probeLiveHub(descriptor, probeMs)) {
    return {
      success: false,
      reason: "Could not authenticate the ForkLight Hub owner — the server identity may have changed since diagnosis",
    };
  }

  // 5. Close the authentication-to-signal window: the exact bytes and PID must
  // still be the authority that discovery froze.
  const claimBeforeSignal = readRecord(claimPath(home), parseClaim);
  const descriptorBeforeSignal = readRecord(descriptorPath(home), parseDescriptor);
  if (
    claimBeforeSignal.raw !== target.claimRaw
    || descriptorBeforeSignal.raw !== target.descriptorRaw
    || claimBeforeSignal.value === undefined
    || descriptorBeforeSignal.value === undefined
    || !sameClaim(claimBeforeSignal.value, target.claim)
    || !claimMatchesDescriptor(claimBeforeSignal.value, descriptorBeforeSignal.value)
    || !pidAlive(target.claim.pid)
  ) {
    return {
      success: false,
      reason: "ForkLight Hub ownership changed during authentication; nothing was signalled",
    };
  }

  // 6. Send graceful termination only to the proven PID.
  try {
    process.kill(target.claim.pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return { success: false, reason: "The ForkLight Hub owner process no longer exists (SIGTERM ESRCH)" };
    }
    throw error;
  }

  // 7. Wait within the bounded grace interval for all four conditions.
  const deadline = Date.now() + graceMs;

  while (Date.now() < deadline) {
    const pidGone = !pidAlive(target.claim.pid);
    const portFree = await isPortFree(target.descriptor.port, 200);
    const currentClaim = readRecord(claimPath(home), parseClaim);
    const currentDescriptor = readRecord(descriptorPath(home), parseDescriptor);
    if (
      (currentClaim.exists && currentClaim.raw !== target.claimRaw)
      || (currentDescriptor.exists && currentDescriptor.raw !== target.descriptorRaw)
    ) {
      return {
        success: false,
        reason: "ForkLight Hub ownership changed while the old owner was stopping; no replacement was started",
      };
    }
    const claimGone = !currentClaim.exists;
    const descriptorGone = !currentDescriptor.exists;

    if (pidGone && portFree && claimGone && descriptorGone) {
      return { success: true, reason: "Old ForkLight Hub owner terminated and released its resources" };
    }

    if (Date.now() + pollMs < deadline) {
      await sleep(Math.max(1, pollMs));
    } else {
      break;
    }
  }

  // 8. Deadline reached — report remaining evidence without SIGKILL.
  const remaining: string[] = [];
  if (pidAlive(target.claim.pid)) remaining.push("PID is still running");
  try { readFileSync(claimPath(home), "utf8"); remaining.push("claim file"); } catch { /* gone */ }
  try { readFileSync(descriptorPath(home), "utf8"); remaining.push("descriptor file"); } catch { /* gone */ }
  if (!await isPortFree(target.descriptor.port, 200)) remaining.push("port listener");

  return {
    success: false,
    reason: `Old ForkLight Hub owner did not exit within ${graceMs}ms: ${remaining.length > 0 ? remaining.join(", ") + " remain" : "unknown evidence"}`,
  };
}

/** Remove only this exact owner's descriptor and lifetime claim. */
export function releaseHubInstance(home: string, claim: HubOwnerClaim): void {
  const descriptor = readRecord(descriptorPath(home), parseDescriptor);
  if (
    descriptor.value !== undefined
    && descriptor.value.pid === claim.pid
    && descriptor.value.nonce === claim.nonce
  ) {
    removeIfUnchanged(descriptorPath(home), descriptor.raw);
  }
  const currentClaim = readRecord(claimPath(home), parseClaim);
  if (currentClaim.value !== undefined && sameClaim(currentClaim.value, claim)) {
    removeIfUnchanged(claimPath(home), currentClaim.raw);
  }
}
