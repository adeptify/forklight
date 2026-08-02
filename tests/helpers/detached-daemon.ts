// Test-only fixture for detached ForkLight daemons started via
// `startDaemonProcess`. Each fixture owns exactly one mkdtemp-created home
// and the set of PIDs its own starts returned. Teardown is bounded,
// idempotent, and proves both process and socket exit before removing only
// that fixture's home. It never scans by process name, never signals an
// untracked PID, and never touches the user's real ForkLight home.
//
// Authority boundary: a PID is signalled only when it was returned by this
// fixture's own `start()` call (or `restart()`, which starts through the
// same path). An endpoint owner that health reports but this fixture did
// not start is never sent shutdown or a signal; the conflict is reported.

import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { daemonSocketPath } from "../../src/core/config.js";
import { sleepMs as sleep } from "../../src/core/time.js";
import {
  daemonObserverRequest,
  daemonRequest,
  startDaemonProcess,
  stopDaemon,
} from "../../src/daemon/client.js";
import type { IntegrationOperationView } from "../../src/core/types.js";

const SIGNAL_EXIT_DEADLINE_MS = 5_000;
const SOCKET_PROBE_TIMEOUT_MS = 200;
const READY_POLL_INTERVAL_MS = 50;
const READY_POLL_ATTEMPTS = 100;

/** Bounded per-wait window used by `observeUntilTerminal`. Short enough that a
 *  non-terminal operation is observed again quickly; long enough that a single
 *  wait rarely adds noise. Diagnostic timing is never a correctness gate. */
export const OBSERVER_WAIT_TIMEOUT_MS = 200;
/** Final escape bound for a whole observation. This is only a safety net that
 *  prevents the suite hanging when an operation never becomes terminal; it is
 *  NOT a "must be fast enough" threshold. Correctness is proven by the durable
 *  terminal result and exact-home side effects, never by elapsed time. */
export const OBSERVER_TERMINAL_ESCAPE_MS = 120_000;

export interface DetachedDaemonCleanupResult {
  homeRemoved: boolean;
  /** Tracked PIDs that were still live and received a direct signal. */
  stoppedPids: number[];
  /** Endpoint owner PID when it was not one this fixture tracked. */
  untrackedOwnerPid: number | undefined;
  /** Human-readable conflict reason, if cleanup could not fully own the endpoint. */
  ownershipConflict: string | undefined;
}

/** True when `pid` identifies a live process. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** Resolve once every PID in `pids` has exited, or `deadlineMs` elapses.
 *  Returns the PIDs still alive at the deadline. */
export async function waitForPidExit(
  pids: number | Iterable<number>,
  deadlineMs = SIGNAL_EXIT_DEADLINE_MS,
): Promise<number[]> {
  const remaining = new Set<number>(typeof pids === "number" ? [pids] : pids);
  const deadline = Date.now() + deadlineMs;
  while (remaining.size > 0 && Date.now() < deadline) {
    for (const pid of remaining) {
      if (!processAlive(pid)) remaining.delete(pid);
    }
    if (remaining.size === 0) break;
    await sleep(READY_POLL_INTERVAL_MS);
  }
  return [...remaining].sort((a, b) => a - b);
}

/** Connect to the exact home socket; resolve true if a daemon answers. */
export function probeSocketAlive(home: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(daemonSocketPath(home));
    socket.setTimeout(SOCKET_PROBE_TIMEOUT_MS);
    let settled = false;
    const done = (alive: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(alive);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
  });
}

/** Poll the exact home endpoint until the daemon reports ready. Does not
 *  start a daemon, so pair it with a start that already happened - this
 *  keeps the only spawned PID the one the caller tracked. */
export async function waitForDaemonReady(
  home: string,
  attempts = READY_POLL_ATTEMPTS,
): Promise<Record<string, unknown>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await daemonRequest<Record<string, unknown>>("health", {}, home);
    } catch (error) {
      lastError = error;
    }
    await sleep(READY_POLL_INTERVAL_MS);
  }
  throw new Error(
    `ForkLight detached daemon did not become ready: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function endpointUnreachable(error: unknown): boolean {
  return /ECONNREFUSED|ENOENT/i.test(errorMessage(error));
}

function isTrackedPid(pid: unknown, tracked: Set<number>): boolean {
  return typeof pid === "number"
    && Number.isSafeInteger(pid)
    && pid > 0
    && tracked.has(pid);
}

function validOwnerPid(pid: unknown): number | undefined {
  return typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

export class DetachedDaemonFixture {
  readonly home: string;
  private readonly trackedPids: Set<number> = new Set();
  private cleaned = false;
  private lastResult: DetachedDaemonCleanupResult | undefined;

  private constructor(home: string) {
    this.home = home;
  }

  /** Create a fixture that owns one isolated temporary home. */
  static async create(
    homePrefix = "forklight-detached-daemon-",
  ): Promise<DetachedDaemonFixture> {
    const home = await mkdtemp(path.join(tmpdir(), homePrefix));
    return new DetachedDaemonFixture(home);
  }

  /** Every PID this fixture has registered, in ascending order. */
  get tracked(): readonly number[] {
    return [...this.trackedPids].sort((a, b) => a - b);
  }

  /** Start a detached daemon and register its exact PID synchronously,
   *  before any readiness wait. Returns the registered PID. */
  start(): number {
    const pid = startDaemonProcess(this.home);
    this.trackedPids.add(pid);
    return pid;
  }

  /** Start a detached daemon, register its PID, then await readiness without
   *  spawning a second daemon. Returns the daemon's health response. */
  async ensureReady(): Promise<Record<string, unknown>> {
    this.start();
    return waitForDaemonReady(this.home);
  }

  /** Stop the current daemon through the production graceful restart stop,
   *  then start a tracked replacement and await readiness. Mirrors
   *  `restartDaemon` (intent=restart) while keeping the replacement PID under
   *  this fixture's authority. */
  async restart(): Promise<Record<string, unknown>> {
    await stopDaemon(this.home, { intent: "restart" });
    this.start();
    return waitForDaemonReady(this.home);
  }

  /** Adopt a replacement PID returned by a production operation on this
   *  fixture's exclusive home. The exact endpoint must report the same PID
   *  before it becomes part of this fixture's cleanup authority. */
  async adoptReplacement(pid: number): Promise<void> {
    if (this.trackedPids.has(pid)) return;
    if (this.cleaned) {
      throw new Error(
        `Cannot adopt replacement PID ${pid}: fixture is already cleaned (home ${this.home})`,
      );
    }
    const health = await waitForDaemonReady(this.home);
    const healthPid = validOwnerPid(health.pid);
    if (healthPid === pid) {
      this.trackedPids.add(pid);
      return;
    }
    throw new Error(
      `Replacement PID ${pid} does not match endpoint owner ${healthPid ?? "unknown"} at ${this.home}`,
    );
  }

  /** Bounded, idempotent teardown. Sends an ordinary endpoint shutdown only
   *  when health identifies a tracked PID, signals only still-live tracked
   *  PIDs, waits for verified exit, proves the exact socket is gone, and
   *  removes only this fixture's home. Refuses to touch an untracked owner. */
  async cleanup(): Promise<DetachedDaemonCleanupResult> {
    if (this.cleaned) {
      return this.lastResult
        ?? {
          homeRemoved: false,
          stoppedPids: [],
          untrackedOwnerPid: undefined,
          ownershipConflict: undefined,
        };
    }
    const result: DetachedDaemonCleanupResult = {
      homeRemoved: false,
      stoppedPids: [],
      untrackedOwnerPid: undefined,
      ownershipConflict: undefined,
    };
    this.lastResult = result;

    // 1. Determine endpoint ownership via the exact home's health.
    let endpointReachable = false;
    let ownerPid: number | undefined;
    try {
      const health = await daemonRequest<Record<string, unknown>>("health", {}, this.home);
      endpointReachable = true;
      ownerPid = validOwnerPid(health.pid);
    } catch (error) {
      if (!endpointUnreachable(error)) {
        result.ownershipConflict = `health probe failed: ${errorMessage(error)}`;
      }
    }

    // 2. Ordinary shutdown ONLY when the endpoint reports a tracked PID.
    if (endpointReachable) {
      if (isTrackedPid(ownerPid, this.trackedPids)) {
        try {
          await daemonRequest("shutdown", {}, this.home);
        } catch (error) {
          if (!endpointUnreachable(error)) {
            result.ownershipConflict ??= `shutdown request failed: ${errorMessage(error)}`;
          }
        }
      } else {
        result.untrackedOwnerPid = ownerPid;
        result.ownershipConflict = ownerPid === undefined
          ? "endpoint reachable but reported no PID; refusing shutdown"
          : `endpoint owned by untracked PID ${ownerPid}; refusing shutdown and signal`;
      }
    }

    // 3. Signal only still-live tracked PIDs (never an untracked owner).
    const signalTargets = [...this.trackedPids]
      .sort((a, b) => a - b)
      .filter((pid) => pid !== result.untrackedOwnerPid && processAlive(pid));
    for (const pid of signalTargets) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Exited between the liveness check and the signal.
      }
      result.stoppedPids.push(pid);
    }

    // 4. Wait for every tracked PID to exit within a bounded deadline.
    const stillAlive = await waitForPidExit(this.trackedPids, SIGNAL_EXIT_DEADLINE_MS);
    const firstAlive = stillAlive[0];
    if (firstAlive !== undefined) {
      throw new Error(
        `ForkLight detached daemon cleanup leak: tracked PID ${firstAlive} (home ${this.home}) did not exit within ${SIGNAL_EXIT_DEADLINE_MS}ms`,
      );
    }

    // 5. Verify the exact endpoint is gone, unless an untracked owner is
    //    still holding it (an expected, reported conflict - not a leak).
    if (result.untrackedOwnerPid === undefined) {
      if (await probeSocketAlive(this.home)) {
        throw new Error(
          `ForkLight detached daemon cleanup leak: endpoint ${daemonSocketPath(this.home)} still reachable after stopping tracked PIDs ${JSON.stringify(this.tracked)}`,
        );
      }
      // 6. Remove only this fixture's home.
      try {
        await rm(this.home, { recursive: true, force: true });
      } catch (error) {
        throw new Error(
          `ForkLight detached daemon cleanup leak: could not remove home ${this.home}: ${errorMessage(error)}`,
        );
      }
      result.homeRemoved = true;
    }

    // Mark success only after every owned cleanup step has completed. If a
    // leak check throws, a surrounding finally block must still be able to
    // retry cleanup instead of receiving a false cached success.
    this.cleaned = true;
    return result;
  }
}

// --- Integration operation observer ----------------------------------------

/** Outcome of observing one durable Integration operation to its terminal
 *  state. `waitCount` and `elapsedMs` are diagnostic only; they never decide
 *  correctness. */
export interface TerminalObservation {
  readonly view: IntegrationOperationView;
  readonly waitCount: number;
  /** Diagnostic only — never a correctness gate. */
  readonly elapsedMs: number;
}

/** Follow ONE durable Integration operation through repeated read-only waits
 *  until it reaches `completed` or `failed`.
 *
 *  The loop talks only through `daemonObserverRequest` (never `ensureDaemon` /
 *  `startDaemonProcess` / `restartDaemon`), keeps the same `operationId`, and
 *  never starts, resumes, or replaces any runner or Daemon. `escapeDeadlineMs`
 *  is a finite final exit bound so the suite cannot hang when an operation
 *  never becomes terminal; it is not a speed assertion. */
export async function observeUntilTerminal(options: {
  home: string;
  operationId: string;
  waitTimeoutMs?: number;
  escapeDeadlineMs?: number;
}): Promise<TerminalObservation> {
  const waitTimeoutMs = options.waitTimeoutMs ?? OBSERVER_WAIT_TIMEOUT_MS;
  const escapeDeadlineMs = options.escapeDeadlineMs ?? OBSERVER_TERMINAL_ESCAPE_MS;
  const startedAt = Date.now();
  const deadline = startedAt + escapeDeadlineMs;
  let waitCount = 0;
  let lastStatus = "outcome-unknown";
  while (Date.now() < deadline) {
    const view = await daemonObserverRequest<IntegrationOperationView>(
      "integration_wait",
      { operationId: options.operationId, timeoutMs: waitTimeoutMs },
      options.home,
    );
    waitCount += 1;
    if (view.status === "completed" || view.status === "failed") {
      return { view, waitCount, elapsedMs: Date.now() - startedAt };
    }
    lastStatus = view.status;
  }
  throw new Error(
    `Integration operation ${options.operationId} did not reach a terminal state within ${escapeDeadlineMs}ms (last status: ${lastStatus})`,
  );
}
