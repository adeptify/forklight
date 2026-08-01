import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  DEFAULT_HUB_STARTUP_TIMEOUT_MS,
  MAX_HUB_STARTUP_TIMEOUT_MS,
  MIN_HUB_STARTUP_TIMEOUT_MS,
  resolveHubStartupTimeoutMs,
  restartHubDetached,
  type DetachedHubRestartResult,
} from "../src/hub/instance.js";
import {
  HubCliLifecycleFixture,
  type HubCliCleanupResult,
} from "./helpers/hub-cli-fixture.js";
import { probeSocketAlive } from "./helpers/detached-daemon.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function cliArgs(...args: string[]): string[] {
  return [
    "--disable-warning=ExperimentalWarning",
    "--import",
    "tsx",
    path.join(root, "src", "cli.ts"),
    ...args,
  ];
}

async function runCli(
  home: string,
  args: string[],
  timeoutMs = 20_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      cliArgs(...args),
      {
        cwd: root,
        env: { ...process.env, FORKLIGHT_HOME: home },
        timeout: timeoutMs,
      },
    );
    return { code: 0, stdout: stdout.toString(), stderr: stderr.toString() };
  } catch (error: unknown) {
    const execError = error as {
      code?: number | string;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      killed?: boolean;
    };
    const code = typeof execError.code === "number" ? execError.code : 1;
    return {
      code,
      stdout: String(execError.stdout ?? ""),
      stderr: String(execError.stderr ?? ""),
    };
  }
}

function assertPrivacySafeJson(text: string, home: string): void {
  assert.ok(!/"token"\s*:/.test(text), "JSON must not contain token key");
  assert.ok(!/"nonce"\s*:/.test(text), "JSON must not contain nonce key");
  assert.ok(!text.includes("FORKLIGHT_HOME"), "JSON must not contain env");
  assert.ok(!text.includes(home), "JSON must not contain home path");
  assert.ok(!text.includes(root), "JSON must not contain workspace path");
  assert.ok(!text.includes("http://"), "JSON must not contain URL");
  assert.ok(!text.includes("#"), "JSON must not contain URL fragment");
}

async function assertLifecycleResidueGone(
  fixture: HubCliLifecycleFixture,
  cleanup: HubCliCleanupResult,
): Promise<void> {
  const hubPid = cleanup.hubPid;
  if (hubPid !== undefined) {
    assert.throws(() => process.kill(hubPid, 0), /ESRCH/, "Hub PID must be gone");
  }
  const daemonPid = cleanup.daemonPid;
  if (daemonPid !== undefined) {
    assert.throws(() => process.kill(daemonPid, 0), /ESRCH/, "daemon PID must be gone");
  }
  assert.equal(await probeSocketAlive(fixture.home), false, "daemon socket must be gone");
  await assert.rejects(stat(fixture.home), /ENOENT/, "fixture home must be removed");
}

test("hub restart without --confirm is rejected before lifecycle work", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-hub-cli-confirm-"));
  try {
    const result = await runCli(home, ["hub", "restart"]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /requires explicit --confirm/);
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("hub restart --json without --detach is rejected", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-hub-cli-json-nodetach-"));
  try {
    const result = await runCli(home, ["hub", "restart", "--confirm", "--json"]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /--json requires --detach/);
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("hub restart --startup-timeout-ms without --detach is rejected", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-hub-cli-timeout-nodetach-"));
  try {
    const result = await runCli(home, [
      "hub", "restart", "--confirm", "--startup-timeout-ms", "5000",
    ]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /--startup-timeout-ms requires --detach/);
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("hub restart --detach rejects invalid startup timeout before launch", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-hub-cli-bad-timeout-"));
  try {
    for (const value of ["0", "999", String(MAX_HUB_STARTUP_TIMEOUT_MS + 1)]) {
      const result = await runCli(home, [
        "hub", "restart", "--confirm", "--detach", "--startup-timeout-ms", value,
      ]);
      assert.notEqual(result.code, 0, `timeout ${value} must be rejected`);
      assert.match(
        result.stderr,
        /Hub startup timeout must be an integer from 1000 to 60000/,
      );
    }
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("hub restart rejects unknown flags", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-hub-cli-unknown-"));
  try {
    const result = await runCli(home, [
      "hub", "restart", "--confirm", "--detach", "--force-kill",
    ]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Unknown hub restart flag: --force-kill/);
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("detached restart CLI returns finite privacy-safe JSON and honors --no-open", async () => {
  const fixture = await HubCliLifecycleFixture.create("forklight-hub-cli-json-privacy-");
  let parsed: (DetachedHubRestartResult & { browserOpened?: boolean }) | undefined;
  let cleanup: HubCliCleanupResult | undefined;
  try {
    // This real-process scenario waits for normal readiness so both lifecycle
    // owners are observable. The pre-readiness timeout edge is seam-tested.
    const result = await runCli(fixture.home, [
      "hub",
      "restart",
      "--confirm",
      "--detach",
      "--no-open",
      "--json",
      "--startup-timeout-ms",
      String(DEFAULT_HUB_STARTUP_TIMEOUT_MS),
    ], DEFAULT_HUB_STARTUP_TIMEOUT_MS + 20_000);
    assert.ok(result.stdout.trim().length > 0, "must print one JSON document");
    const rawPidMatch = /"pid"\s*:\s*(\d+)/.exec(result.stdout);
    if (rawPidMatch) fixture.registerHubPid(Number(rawPidMatch[1]));
    parsed = JSON.parse(result.stdout) as DetachedHubRestartResult & {
      browserOpened?: boolean;
    };
    fixture.registerHubPid(parsed.pid);
    assert.equal(result.code, 0);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.state, "ready");
    assert.ok(Number.isSafeInteger(parsed.pid) && (parsed.pid ?? 0) > 0);
    assert.equal(typeof parsed.ok, "boolean");
    assert.ok(["current", "ready", "failed"].includes(parsed.state));
    assert.ok(
      ["none-needed", "replaced", "started", "not-started"].includes(parsed.replacement),
    );
    assert.equal(parsed.browserOpened, false, "--no-open must never open a browser");
    assertPrivacySafeJson(result.stdout, fixture.home);
  } finally {
    cleanup = await fixture.cleanup();
  }
  assert.ok(cleanup);
  assert.equal(cleanup.homeRemoved, true);
  assert.equal(cleanup.ownershipConflict, undefined);
  assert.equal(cleanup.hubPid, parsed?.pid);
  assert.ok(Number.isSafeInteger(cleanup.daemonPid) && (cleanup.daemonPid ?? 0) > 0);
  await assertLifecycleResidueGone(fixture, cleanup);
});

test("detached restart human mode reports browser not opened with --no-open", async () => {
  const fixture = await HubCliLifecycleFixture.create("forklight-hub-cli-human-noopen-");
  let pid: number | undefined;
  let cleanup: HubCliCleanupResult | undefined;
  try {
    const result = await runCli(fixture.home, [
      "hub",
      "restart",
      "--confirm",
      "--detach",
      "--no-open",
      "--startup-timeout-ms",
      String(DEFAULT_HUB_STARTUP_TIMEOUT_MS),
    ], DEFAULT_HUB_STARTUP_TIMEOUT_MS + 20_000);
    const pidMatch = /pid=(\d+)/.exec(result.stdout);
    if (pidMatch) pid = Number(pidMatch[1]);
    fixture.registerHubPid(pid);
    assert.equal(result.code, 0);
    assert.ok(Number.isSafeInteger(pid) && (pid ?? 0) > 0);
    assert.match(result.stdout, /browser: not opened/);
    assert.ok(!result.stdout.includes("http://"), "human output must not print the token URL");
    assert.ok(!result.stdout.includes(fixture.home), "human output must not print the home path");
  } finally {
    cleanup = await fixture.cleanup();
  }
  assert.ok(cleanup);
  assert.equal(cleanup.homeRemoved, true);
  assert.equal(cleanup.ownershipConflict, undefined);
  assert.equal(cleanup.hubPid, pid);
  assert.ok(Number.isSafeInteger(cleanup.daemonPid) && (cleanup.daemonPid ?? 0) > 0);
  await assertLifecycleResidueGone(fixture, cleanup);
});

test("foreground hub restart remains available and still requires confirm", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-hub-cli-foreground-"));
  try {
    const missingConfirm = await runCli(home, ["hub", "restart", "--no-open"]);
    assert.notEqual(missingConfirm.code, 0);
    assert.match(missingConfirm.stderr, /requires explicit --confirm/);

    // Foreground compatibility: usage still documents the non-detach path and
    // detach remains opt-in rather than the default.
    const help = await runCli(home, ["help"]);
    assert.match(help.stdout, /hub restart --confirm/);
    assert.match(help.stdout, /--detach/);
    assert.ok(
      !help.stdout.includes("hub restart --confirm --detach")
        || help.stdout.includes("[--detach]"),
      "detach must be explicit/optional in usage",
    );
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("hub status remains read-only and privacy-safe", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-hub-cli-status-"));
  try {
    const result = await runCli(home, ["hub", "status", "--json"]);
    assert.equal(result.code, 0);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(parsed.state, "stopped");
    assert.equal(parsed.nextAction, "start");
    assert.ok(!JSON.stringify(parsed).includes(home));
    assert.ok(!/"token"\s*:/.test(result.stdout));
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("coordinator default timeout bounds match the CLI contract", () => {
  assert.equal(MIN_HUB_STARTUP_TIMEOUT_MS, 1_000);
  assert.equal(MAX_HUB_STARTUP_TIMEOUT_MS, 60_000);
  assert.equal(DEFAULT_HUB_STARTUP_TIMEOUT_MS, 30_000);
  assert.equal(resolveHubStartupTimeoutMs(DEFAULT_HUB_STARTUP_TIMEOUT_MS), 30_000);
});

test("detached restart coordinator is importable for CLI wiring", async () => {
  let launches = 0;
  const result = await restartHubDetached(path.join(tmpdir(), "unused-home"), {
    runIdentity: {
      protocolVersion: 2,
      packageVersion: "0.2.0",
      buildId: "cli-wiring",
      builtAt: "2026-07-30T00:00:00.000Z",
      sourceRevision: "dev",
      sourceDigest: "b".repeat(64),
    },
    discover: async () => ({
      kind: "reuse",
      port: 1,
      url: "http://127.0.0.1:1/#x",
    }),
    launch: () => {
      launches += 1;
      return { pid: 1, exited: false, exitCode: null, signalCode: null };
    },
    inspect: async () => ({
      state: "current",
      pid: 2,
      port: 1,
      nextAction: "none",
    }),
  });
  assert.equal(result.replacement, "none-needed");
  assert.equal(launches, 0);
});
