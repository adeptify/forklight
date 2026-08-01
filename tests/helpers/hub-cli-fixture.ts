// Test-only lifecycle owner shared by the two real detached Hub CLI tests and
// the deterministic seam regressions. Binds one exclusive temporary home to the
// exact Hub child PID returned by the CLI result and the endpoint-proven daemon
// PID that child created, then proves the Hub, daemon, socket, and home are all
// gone. It never scans by process name and never signals a PID that was not
// returned by the CLI or proven through the home's own endpoint.
//
// Ordering is intentional: the Hub child is stopped and proven exited first so
// a live Hub cannot launch or restart a daemon while cleanup is deciding daemon
// ownership. Only then is the daemon owner adopted from the exact home endpoint
// and stopped. The home is removed only after both PIDs and the socket are
// proven gone.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { daemonRequest } from "../../src/daemon/client.js";
import {
  probeSocketAlive,
  processAlive,
  waitForPidExit,
} from "./detached-daemon.js";

const SIGNAL_EXIT_DEADLINE_MS = 5_000;

export interface HubCliCleanupResult {
  /** True only when the fixture home was removed after ownership proof. */
  homeRemoved: boolean;
  /** Exact Hub child PID from the CLI result, stopped and proven exited. */
  hubPid: number | undefined;
  /** Endpoint-proven daemon PID, stopped and proven exited. */
  daemonPid: number | undefined;
  /** Tracked PIDs that received a direct signal during cleanup. */
  stoppedPids: number[];
  /** Endpoint owner PID refused because it did not match the adopted daemon. */
  untrackedOwnerPid: number | undefined;
  /** Reason when cleanup could not fully own the home. */
  ownershipConflict: string | undefined;
}

/** Deterministic test seams. Defaults use the real production endpoints. */
export interface HubCliLifecycleSeams {
  pidAlive?: (pid: number) => boolean;
  signal?: (pid: number, signal: NodeJS.Signals) => void;
  probeHealth?: (home: string) => Promise<Record<string, unknown>>;
  shutdown?: (home: string) => Promise<void>;
  probeSocket?: (home: string) => Promise<boolean>;
  waitForExit?: (pids: Iterable<number>, deadlineMs?: number) => Promise<number[]>;
  removeHome?: (home: string) => Promise<void>;
}

function validOwnerPid(pid: unknown): number | undefined {
  return typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function endpointUnreachable(error: unknown): boolean {
  return /ECONNREFUSED|ENOENT|ECONNRESET|EPIPE|ENOTCONN/i.test(errorMessage(error));
}

export class HubCliLifecycleFixture {
  readonly home: string;
  private hubPid: number | undefined;
  private daemonPid: number | undefined;
  private cleaned = false;
  private lastCleanupResult: HubCliCleanupResult | undefined;

  private readonly pidAlive: (pid: number) => boolean;
  private readonly signalPid: (pid: number, signal: NodeJS.Signals) => void;
  private readonly probeHealth: (home: string) => Promise<Record<string, unknown>>;
  private readonly requestShutdown: (home: string) => Promise<void>;
  private readonly probeSocket: (home: string) => Promise<boolean>;
  private readonly waitForExit: (
    pids: Iterable<number>,
    deadlineMs?: number,
  ) => Promise<number[]>;
  private readonly removeHome: (home: string) => Promise<void>;

  private constructor(home: string, seams: HubCliLifecycleSeams) {
    this.home = home;
    this.pidAlive = seams.pidAlive ?? processAlive;
    this.signalPid = seams.signal ?? ((pid, signal) => { process.kill(pid, signal); });
    this.probeHealth = seams.probeHealth
      ?? ((target) => daemonRequest<Record<string, unknown>>("health", {}, target));
    this.requestShutdown = seams.shutdown
      ?? (async (target) => { await daemonRequest("shutdown", {}, target); });
    this.probeSocket = seams.probeSocket ?? probeSocketAlive;
    this.waitForExit = seams.waitForExit ?? waitForPidExit;
    this.removeHome = seams.removeHome
      ?? (async (target) => { await rm(target, { recursive: true, force: true }); });
  }

  /** Create a real fixture that owns one isolated temporary home. */
  static async create(
    homePrefix = "forklight-hub-cli-",
  ): Promise<HubCliLifecycleFixture> {
    const home = await mkdtemp(path.join(tmpdir(), homePrefix));
    return new HubCliLifecycleFixture(home, {});
  }

  /** Create a fixture whose lifecycle probes are deterministic seams. */
  static async createWithSeams(
    seams: HubCliLifecycleSeams,
    homePrefix = "forklight-hub-cli-seam-",
  ): Promise<HubCliLifecycleFixture> {
    const home = await mkdtemp(path.join(tmpdir(), homePrefix));
    return new HubCliLifecycleFixture(home, seams);
  }

  get cleanedAlready(): boolean {
    return this.cleaned;
  }

  /** The endpoint-proven daemon PID, available after adoption or cleanup. */
  get daemonOwner(): number | undefined {
    return this.daemonPid;
  }

  /** The last cleanup result, observable even when the test body throws. */
  get lastCleanup(): HubCliCleanupResult | undefined {
    return this.lastCleanupResult;
  }

  private get trackedPids(): number[] {
    const pids = new Set<number>();
    if (this.hubPid !== undefined) pids.add(this.hubPid);
    if (this.daemonPid !== undefined) pids.add(this.daemonPid);
    return [...pids].sort((a, b) => a - b);
  }

  /** Bind the exact Hub child PID reported by the CLI result. */
  registerHubPid(pid: number | undefined): void {
    if (pid === undefined) return;
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      throw new Error(`Cannot register invalid Hub PID ${pid}`);
    }
    if (this.cleaned) {
      throw new Error(
        `Cannot register Hub PID ${pid}: fixture is already cleaned (home ${this.home})`,
      );
    }
    this.hubPid = pid;
  }

  /** Bind the daemon PID reported by the exact home endpoint. */
  async adoptDaemonOwner(): Promise<number> {
    if (this.cleaned) {
      throw new Error(`Cannot adopt a daemon owner after cleanup (home ${this.home})`);
    }
    const health = await this.probeHealth(this.home);
    const pid = validOwnerPid(health.pid);
    if (pid === undefined) {
      throw new Error(`Daemon health at ${this.home} did not report a valid PID`);
    }
    if (this.daemonPid !== undefined && this.daemonPid !== pid) {
      throw new Error(`Daemon owner at ${this.home} changed from ${this.daemonPid} to ${pid}`);
    }
    this.daemonPid = pid;
    return pid;
  }

  /** Bounded, idempotent teardown. Stops/proves the Hub child first, adopts
   *  the exact home endpoint daemon owner, stops it, proves the socket is
   *  gone, and removes only the fixture home. Never signals an untracked
   *  owner and never removes the home before daemon ownership proof. */
  async cleanup(): Promise<HubCliCleanupResult> {
    if (this.cleaned) {
      return this.lastCleanupResult ?? {
        homeRemoved: false,
        hubPid: this.hubPid,
        daemonPid: this.daemonPid,
        stoppedPids: [],
        untrackedOwnerPid: undefined,
        ownershipConflict: undefined,
      };
    }
    const result: HubCliCleanupResult = {
      homeRemoved: false,
      hubPid: this.hubPid,
      daemonPid: undefined,
      stoppedPids: [],
      untrackedOwnerPid: undefined,
      ownershipConflict: undefined,
    };
    this.lastCleanupResult = result;

    // 1. Stop/prove the exact Hub child before touching the daemon, so a live
    //    Hub cannot launch or restart a daemon while cleanup decides ownership.
    if (this.hubPid !== undefined && this.pidAlive(this.hubPid)) {
      try {
        this.signalPid(this.hubPid, "SIGTERM");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
      result.stoppedPids.push(this.hubPid);
    }
    const hubStillAlive = (await this.waitForExit(
      this.hubPid === undefined ? [] : [this.hubPid],
      SIGNAL_EXIT_DEADLINE_MS,
    ))[0];
    if (hubStillAlive !== undefined) {
      throw new Error(
        `Hub CLI cleanup leak: Hub PID ${hubStillAlive} (home ${this.home}) did not exit within ${SIGNAL_EXIT_DEADLINE_MS}ms`,
      );
    }

    // 2. Resolve daemon endpoint ownership from the exact home.
    let endpointReachable = false;
    let ownerPid: number | undefined;
    try {
      const health = await this.probeHealth(this.home);
      endpointReachable = true;
      ownerPid = validOwnerPid(health.pid);
    } catch (error) {
      if (!endpointUnreachable(error)) {
        result.ownershipConflict = `health probe failed: ${errorMessage(error)}`;
      }
    }

    // 3. Bind the endpoint owner as the daemon PID when none is adopted yet.
    //    The stopped Hub child was the only process that could have started a
    //    daemon on this exclusive home. A conflicting owner is reported and
    //    never signalled.
    if (endpointReachable && ownerPid !== undefined) {
      if (this.daemonPid === undefined) {
        this.daemonPid = ownerPid;
      } else if (this.daemonPid !== ownerPid) {
        result.untrackedOwnerPid = ownerPid;
        result.ownershipConflict ??= (
          `endpoint owned by untracked PID ${ownerPid}; fixture adopted ${this.daemonPid}; refusing shutdown and signal`
        );
      }
    }

    // 4. Ordinary shutdown only when the endpoint reports the adopted daemon.
    if (endpointReachable && this.daemonPid !== undefined && ownerPid === this.daemonPid) {
      try {
        await this.requestShutdown(this.home);
      } catch (error) {
        if (!endpointUnreachable(error)) {
          result.ownershipConflict ??= `shutdown request failed: ${errorMessage(error)}`;
        }
      }
    }

    // 5. Signal only a still-live adopted daemon (never an untracked owner).
    if (
      this.daemonPid !== undefined
      && this.daemonPid !== result.untrackedOwnerPid
      && this.pidAlive(this.daemonPid)
    ) {
      try {
        this.signalPid(this.daemonPid, "SIGTERM");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
      result.stoppedPids.push(this.daemonPid);
    }

    // 6. Prove every tracked PID exited within the bounded deadline.
    const stillAlive = await this.waitForExit(this.trackedPids, SIGNAL_EXIT_DEADLINE_MS);
    const firstAlive = stillAlive[0];
    if (firstAlive !== undefined) {
      throw new Error(
        `Hub CLI cleanup leak: tracked PID ${firstAlive} (home ${this.home}) did not exit within ${SIGNAL_EXIT_DEADLINE_MS}ms`,
      );
    }

    // 7. Only with a resolved daemon owner and no untracked conflict may the
    //    socket be proven gone and the fixture home removed.
    result.daemonPid = this.daemonPid;
    if (this.daemonPid !== undefined && result.untrackedOwnerPid === undefined) {
      if (await this.probeSocket(this.home)) {
        throw new Error(`Hub CLI cleanup leak: daemon socket still reachable at ${this.home}`);
      }
      await this.removeHome(this.home);
      result.homeRemoved = true;
    } else if (result.untrackedOwnerPid === undefined) {
      result.ownershipConflict ??= (
        "daemon endpoint never reported an owner; refusing to remove the home before ownership proof"
      );
    }

    this.cleaned = true;
    return result;
  }
}
