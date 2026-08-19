import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  createBackup,
  inspectBackup,
  previewBackup,
  previewRestore,
  restoreBackup,
} from "../src/core/backup.js";
import {
  BACKUP_MANIFEST_NAME,
  HOME_TRANSIENT_ENTRY_NAMES,
  STORE_DATABASE_NAME,
  STORE_SHM_NAME,
  STORE_WAL_NAME,
  taskPaths,
} from "../src/core/config.js";
import { SettingsService } from "../src/core/settings.js";
import type { BackupOwnerObservation, BackupResult, TaskRecord } from "../src/core/types.js";
import { ForkLightDaemon } from "../src/daemon/server.js";
import { daemonRequest } from "../src/daemon/client.js";
import { StateStore } from "../src/state/store.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECRET = "SECRET_AUTH_BYTES_NEVER_COPY";
const PARTIAL = "PROTECTED_PARTIAL_WORKSPACE";
const UNKNOWN = "UNKNOWN_TOP_LEVEL_BYTES";
const LOGS = "DURABLE_TASK_LOG";

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
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const result = await execFileAsync(process.execPath, cliArgs(...args), {
      cwd: root,
      env: { ...process.env, FORKLIGHT_HOME: home },
      timeout: 30_000,
    });
    return { stdout: result.stdout, stderr: result.stderr, code: 0 };
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      code: typeof execError.code === "number" ? execError.code : 1,
    };
  }
}

async function makeFixture(prefix: string): Promise<{
  root: string;
  home: string;
  outside: string;
  taskId: string;
}> {
  const rootDir = await mkdtemp(path.join(tmpdir(), prefix));
  const home = path.join(rootDir, "home");
  const outside = path.join(rootDir, "outside");
  await mkdir(home, { recursive: true });
  await mkdir(outside, { recursive: true });
  const store = new StateStore(home);
  new SettingsService(store).update({ execution: { maxConcurrency: 7 } });
  const taskId = "task-partial";
  const paths = taskPaths(home, taskId);
  const timestamp = "2026-08-19T00:00:00.000Z";
  store.createTask({
    id: taskId,
    name: taskId,
    status: "interrupted",
    sourcePath: "/source",
    taskFile: "/task.yaml",
    spec: {
      provider: { name: "deepseek", model: "deepseek-v4-pro[1M]" },
      runtime: { name: "claude-code" },
    } as TaskRecord["spec"],
    paths,
    sessionId: "session-partial",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  store.close();

  await mkdir(path.join(home, "runs", taskId, "workspace"), { recursive: true });
  await writeFile(path.join(home, "runs", taskId, "workspace", "partial.txt"), PARTIAL);
  await mkdir(path.join(home, "runs", taskId, "logs"), { recursive: true });
  await writeFile(path.join(home, "runs", taskId, "logs", "worker.log"), LOGS);
  await writeFile(path.join(home, "unknown-top.txt"), UNKNOWN);
  await mkdir(path.join(home, "competitions", "c1"), { recursive: true });
  await writeFile(path.join(home, "competitions", "c1", "note.txt"), "COMP");
  await mkdir(path.join(home, "review-projects", "g1"), { recursive: true });
  await writeFile(path.join(home, "review-projects", "g1", "keep.txt"), "REVIEW");
  await mkdir(path.join(home, "samples", "s1"), { recursive: true });
  await writeFile(path.join(home, "samples", "s1", "sample.txt"), "SAMPLE");
  await writeFile(path.join(outside, "secret-auth.txt"), SECRET);
  await symlink(path.join(outside, "secret-auth.txt"), path.join(home, "outside-auth"));
  await symlink(path.join("runs", taskId, "workspace"), path.join(home, "ws-link"));
  await symlink(path.join(home, "runs", taskId, "logs"), path.join(home, "logs-abs-link"));
  await writeFile(path.join(home, "forklight.sock"), "socket-bytes");
  await writeFile(path.join(home, "daemon.log"), "daemon-log");
  return { root: rootDir, home, outside, taskId };
}

function assertSharedFacts(result: BackupResult): void {
  assert.ok(result.included.includes(STORE_DATABASE_NAME));
  assert.ok(result.included.includes("runs"));
  assert.ok(result.excluded.includes("forklight.sock"));
  assert.ok(result.excluded.includes("daemon.log"));
  assert.equal(result.credentials.keychain, "not-included");
  assert.equal(result.credentials.localRuntimeSignIn, "not-included");
  assert.equal(result.credentials.externalMainAuth, "not-included");
  assert.equal(result.privacy, "keep-private");
  assert.ok(result.impact.length > 0);
  assert.ok(result.nextAction.length > 0);
}

function assertNoSecret(text: string): void {
  assert.equal(text.includes(SECRET), false);
}

function snapshotTree(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const rel = path.relative(root, abs);
      const stats = lstatSync(abs);
      if (stats.isDirectory()) {
        snapshot[`${rel}/`] = "dir";
        walk(abs);
        continue;
      }
      if (stats.isSymbolicLink()) {
        snapshot[rel] = `link:${readlinkSync(abs)}`;
        continue;
      }
      snapshot[rel] = readFileSync(abs).toString("hex");
    }
  };
  walk(root);
  return snapshot;
}

async function fileContains(absPath: string, needle: string): Promise<boolean> {
  const kind = lstatSync(absPath);
  if (kind.isSymbolicLink() || kind.isDirectory()) return false;
  const bytes = await readFile(absPath);
  return bytes.includes(Buffer.from(needle));
}

async function treeContainsSecret(absDir: string): Promise<boolean> {
  const { readdirSync } = await import("node:fs");
  for (const name of readdirSync(absDir)) {
    const abs = path.join(absDir, name);
    const stats = lstatSync(abs);
    if (stats.isDirectory()) {
      if (await treeContainsSecret(abs)) return true;
      continue;
    }
    if (stats.isSymbolicLink()) continue;
    if (await fileContains(abs, SECRET)) return true;
  }
  return false;
}

test("temp-home round trip restores durable bytes and keeps a recovery copy", async () => {
  const fixture = await makeFixture("forklight-backup-roundtrip-");
  try {
    const destination = path.join(fixture.root, "backup");
    const preview = await previewBackup(fixture.home, destination);
    assert.equal(preview.status, "ready");
    assertSharedFacts(preview);
    assert.ok(preview.included.includes("unknown-top.txt"));
    assert.ok(preview.included.includes("ws-link"));
    assert.ok(preview.included.includes("logs-abs-link"));
    assert.ok(preview.externalLinkExclusionCount >= 1);
    assert.equal(preview.integrity.quickCheck, "ok");
    assert.equal(preview.integrity.foreignKeyViolationCount, 0);

    const created = await createBackup(fixture.home, destination);
    assert.equal(created.status, "completed");
    assertSharedFacts(created);
    assert.equal(await treeContainsSecret(destination), false);
    assert.equal(existsSync(path.join(destination, "outside-auth")), false);
    for (const name of HOME_TRANSIENT_ENTRY_NAMES) {
      assert.equal(existsSync(path.join(destination, name)), false, name);
    }
    const manifest = JSON.parse(
      await readFile(path.join(destination, BACKUP_MANIFEST_NAME), "utf8"),
    ) as { schema: string; externalLinkExclusionCount: number };
    assert.equal(manifest.schema, "forklight.backup.v1");
    assert.ok(manifest.externalLinkExclusionCount >= 1);

    const inspected = await inspectBackup(destination);
    assert.equal(inspected.status, "ready");
    assertSharedFacts(inspected);

    const restored = await restoreBackup(fixture.home, destination);
    assert.equal(restored.status, "completed");
    assert.ok(restored.recoveryCopy);
    assert.equal(existsSync(restored.recoveryCopy!), true);
    assert.equal(await readFile(path.join(fixture.home, "unknown-top.txt"), "utf8"), UNKNOWN);
    assert.equal(
      await readFile(path.join(fixture.home, "runs", fixture.taskId, "workspace", "partial.txt"), "utf8"),
      PARTIAL,
    );
    assert.equal(
      await readFile(path.join(fixture.home, "runs", fixture.taskId, "logs", "worker.log"), "utf8"),
      LOGS,
    );
    assert.equal(lstatSync(path.join(fixture.home, "ws-link")).isSymbolicLink(), true);
    assert.equal(
      await readFile(path.join(fixture.home, "ws-link", "partial.txt"), "utf8"),
      PARTIAL,
    );
    assert.equal(lstatSync(path.join(fixture.home, "logs-abs-link")).isSymbolicLink(), true);
    assert.equal(
      await readFile(path.join(fixture.home, "logs-abs-link", "worker.log"), "utf8"),
      LOGS,
    );
    for (const name of HOME_TRANSIENT_ENTRY_NAMES) {
      assert.equal(existsSync(path.join(fixture.home, name)), false, name);
    }
    assert.equal(existsSync(path.join(fixture.home, "outside-auth")), false);
    const after = new StateStore(fixture.home);
    try {
      const integrity = after.checkStoreIntegrity();
      assert.equal(integrity.quickCheck, "ok");
      assert.equal(integrity.foreignKeyViolationCount, 0);
      assert.equal(after.getTask(fixture.taskId).id, fixture.taskId);
      assert.equal(new SettingsService(after).get().execution.maxConcurrency, 7);
    } finally {
      after.close();
    }
    assert.equal(
      await readFile(path.join(restored.recoveryCopy!, "unknown-top.txt"), "utf8"),
      UNKNOWN,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("tmpdir dest-inside-home is refused and internal links stay self-contained", async () => {
  const fixture = await makeFixture("forklight-backup-physical-");
  try {
    assert.ok(
      path.resolve(fixture.home).startsWith(path.resolve(tmpdir()) + path.sep),
      "fixture home must sit under tmpdir so /var and /private/var differ lexically",
    );
    const inside = path.join(fixture.home, "inside-dest");
    const refused = await previewBackup(fixture.home, inside);
    assert.equal(refused.status, "refused");
    assert.equal(refused.reason, "destination-inside-home");
    assert.equal(existsSync(inside), false);
    const createdInside = await createBackup(fixture.home, inside);
    assert.equal(createdInside.status, "refused");
    assert.equal(createdInside.reason, "destination-inside-home");
    assert.equal(existsSync(inside), false);

    const destination = path.join(fixture.root, "backup");
    const created = await createBackup(fixture.home, destination);
    assert.equal(created.status, "completed", created.reason);
    assert.ok(created.included.includes("ws-link"));
    assert.ok(created.included.includes("logs-abs-link"));
    assert.equal(lstatSync(path.join(destination, "ws-link")).isSymbolicLink(), true);
    assert.equal(lstatSync(path.join(destination, "logs-abs-link")).isSymbolicLink(), true);
    assert.equal(
      await readFile(path.join(destination, "ws-link", "partial.txt"), "utf8"),
      PARTIAL,
    );
    const inspected = await inspectBackup(destination);
    assert.equal(inspected.status, "ready", inspected.reason);
    assert.ok(inspected.included.includes("ws-link"));
    assert.ok(inspected.included.includes("logs-abs-link"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("backup creation does not follow an external symlink", async () => {
  const fixture = await makeFixture("forklight-backup-extlink-");
  try {
    const destination = path.join(fixture.root, "backup");
    const created = await createBackup(fixture.home, destination);
    assert.equal(created.status, "completed");
    assert.ok(created.externalLinkExclusionCount >= 1);
    assert.ok(created.excludedReasons.some((item) => item.reason === "external-link"));
    assert.equal(await treeContainsSecret(destination), false);
    assert.equal(existsSync(path.join(destination, "outside-auth")), false);
    assert.equal(await readFile(path.join(fixture.outside, "secret-auth.txt"), "utf8"), SECRET);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("escaping backup input fails inspect and restore before Home mutation", async () => {
  const fixture = await makeFixture("forklight-backup-escape-");
  try {
    const destination = path.join(fixture.root, "backup");
    const created = await createBackup(fixture.home, destination);
    assert.equal(created.status, "completed");
    await symlink(path.join(fixture.outside, "secret-auth.txt"), path.join(destination, "escape"));
    const before = await readFile(path.join(fixture.home, "unknown-top.txt"), "utf8");
    const inspected = await inspectBackup(destination);
    assert.equal(inspected.status, "refused");
    assert.equal(inspected.reason, "escaping-path");
    assertNoSecret(JSON.stringify(inspected));
    assertNoSecret(inspected.impact);
    const restored = await restoreBackup(fixture.home, destination);
    assert.equal(restored.status, "refused");
    assert.equal(restored.reason, "escaping-path");
    assert.equal(await readFile(path.join(fixture.home, "unknown-top.txt"), "utf8"), before);
    assert.equal(existsSync(path.join(path.dirname(fixture.home), `${path.basename(fixture.home)}.pre-restore-`)), false);

    const evil = path.join(fixture.root, "evil-manifest");
    await mkdir(evil);
    await writeFile(path.join(evil, BACKUP_MANIFEST_NAME), `${JSON.stringify({
      schema: "forklight.backup.v1",
      createdAt: "2026-08-19T00:00:00.000Z",
      included: ["../outside"],
      excluded: [],
      externalLinkExclusionCount: 0,
      integrity: { quickCheck: "ok", foreignKeyViolationCount: 0 },
    })}\n`);
    const manifestEscape = await inspectBackup(evil);
    assert.equal(manifestEscape.status, "refused");
    assert.ok(manifestEscape.reason === "escaping-path" || manifestEscape.reason === "malformed-manifest");
    assertNoSecret(JSON.stringify(manifestEscape));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("live Daemon owner refuses restore without signalling or moving Home", async () => {
  const fixture = await makeFixture("forklight-backup-live-daemon-");
  const daemon = new ForkLightDaemon(fixture.home, 0);
  try {
    const destination = path.join(fixture.root, "backup");
    const created = await createBackup(fixture.home, destination);
    assert.equal(created.status, "completed");
    await rm(path.join(fixture.home, "forklight.sock"), { force: true });
    await daemon.start();
    const health = await daemonRequest<{ pid?: number }>("health", {}, fixture.home);
    const pid = health.pid;
    assert.ok(typeof pid === "number" && pid > 0);
    const preview = await previewRestore(fixture.home, destination);
    assert.equal(preview.status, "refused");
    assert.equal(preview.reason, "live-owner");
    assert.equal(preview.nextAction, "stop-daemon");
    assert.match(preview.owners?.find((item) => item.owner === "daemon")?.reason ?? "", /forklight daemon stop/i);
    const confirmed = await restoreBackup(fixture.home, destination);
    assert.equal(confirmed.status, "refused");
    assert.equal(confirmed.reason, "live-owner");
    process.kill(pid, 0);
    assert.equal(existsSync(fixture.home), true);
    assert.equal(existsSync(path.join(fixture.home, STORE_DATABASE_NAME)), true);
    const still = await daemonRequest<{ pid?: number }>("health", {}, fixture.home);
    assert.equal(still.pid, pid);
  } finally {
    await daemon.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("unverified Hub owner refuses restore and injected live Hub never signals", async () => {
  const fixture = await makeFixture("forklight-backup-hub-owner-");
  try {
    const destination = path.join(fixture.root, "backup");
    assert.equal((await createBackup(fixture.home, destination)).status, "completed");
    await writeFile(path.join(fixture.home, ".hub-owner.json"), "{not-json");
    const preview = await previewRestore(fixture.home, destination);
    assert.equal(preview.status, "refused");
    assert.ok(preview.reason === "unverified-owner" || preview.reason === "live-owner");
    assert.ok(preview.nextAction === "investigate" || preview.nextAction === "stop-hub");

    const liveHub: BackupOwnerObservation = {
      owner: "hub",
      state: "live",
      nextAction: "stop-hub",
      reason: "A live Hub owns this Home. Quit the ForkLight Hub process, then retry. Restore never stops it.",
    };
    const stoppedDaemon: BackupOwnerObservation = {
      owner: "daemon",
      state: "stopped",
      nextAction: "none",
      reason: "Daemon is not running.",
    };
    let signaled = false;
    const refused = await restoreBackup(fixture.home, destination, {
      owners: {
        observeDaemon: async () => stoppedDaemon,
        observeHub: async () => liveHub,
      },
      activateHome: () => {
        signaled = true;
        throw new Error("must not activate");
      },
    });
    assert.equal(refused.status, "refused");
    assert.equal(refused.reason, "live-owner");
    assert.equal(refused.nextAction, "stop-hub");
    assert.equal(signaled, false);
    assert.equal(existsSync(path.join(fixture.home, STORE_DATABASE_NAME)), true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("integrity and destination refusals do not mutate Home", async () => {
  const fixture = await makeFixture("forklight-backup-refusals-");
  try {
    const existing = path.join(fixture.root, "exists");
    await mkdir(existing);
    const existingPreview = await previewBackup(fixture.home, existing);
    assert.equal(existingPreview.status, "refused");
    assert.equal(existingPreview.reason, "existing-destination");

    const inside = path.join(fixture.home, "nested-backup");
    assert.ok(
      path.resolve(fixture.home).startsWith(path.resolve(tmpdir()) + path.sep),
      "dest-inside-home fixture must use tmpdir so macOS /var→/private/var is compared physically",
    );
    const insidePreview = await previewBackup(fixture.home, inside);
    assert.equal(insidePreview.status, "refused");
    assert.equal(insidePreview.reason, "destination-inside-home");
    assert.equal(existsSync(inside), false);

    const badDir = path.join(fixture.root, "bad-store");
    await mkdir(badDir);
    await writeFile(path.join(badDir, BACKUP_MANIFEST_NAME), `${JSON.stringify({
      schema: "forklight.backup.v1",
      createdAt: "2026-08-19T00:00:00.000Z",
      included: [STORE_DATABASE_NAME],
      excluded: [],
      externalLinkExclusionCount: 0,
      integrity: { quickCheck: "ok", foreignKeyViolationCount: 0 },
    })}\n`);
    await mkdir(path.join(badDir, STORE_DATABASE_NAME));
    const unreadable = await inspectBackup(badDir);
    assert.equal(unreadable.status, "refused");
    assert.equal(unreadable.reason, "store-unreadable");

    const malformed = await inspectBackup(path.join(fixture.root, "missing-backup"));
    assert.equal(malformed.status, "refused");
    assert.equal(malformed.reason, "malformed-manifest");

    const fkHome = path.join(fixture.root, "fk-home");
    await mkdir(fkHome);
    const fkStore = new StateStore(fkHome);
    fkStore.close();
    const raw = new DatabaseSync(path.join(fkHome, STORE_DATABASE_NAME));
    raw.exec("PRAGMA foreign_keys = OFF");
    raw.exec(
      "INSERT INTO attempts (id, task_id, ordinal, status, record_json) VALUES ('a','missing',1,'running','{}')",
    );
    raw.close();
    const fkBackup = path.join(fixture.root, "fk-backup");
    await mkdir(fkBackup);
    const { copyFile } = await import("node:fs/promises");
    await copyFile(path.join(fkHome, STORE_DATABASE_NAME), path.join(fkBackup, STORE_DATABASE_NAME));
    await writeFile(path.join(fkBackup, BACKUP_MANIFEST_NAME), `${JSON.stringify({
      schema: "forklight.backup.v1",
      createdAt: "2026-08-19T00:00:00.000Z",
      included: [STORE_DATABASE_NAME],
      excluded: [],
      externalLinkExclusionCount: 0,
      integrity: { quickCheck: "ok", foreignKeyViolationCount: 0 },
    })}\n`);
    const fkInspect = await inspectBackup(fkBackup);
    assert.equal(fkInspect.status, "refused");
    assert.equal(fkInspect.reason, "store-integrity");
    assert.ok(fkInspect.integrity.foreignKeyViolationCount > 0);
    assert.equal(existsSync(path.join(fixture.home, STORE_DATABASE_NAME)), true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("injected activation rename failure puts the prior Home back", async () => {
  const fixture = await makeFixture("forklight-backup-activation-");
  try {
    const destination = path.join(fixture.root, "backup");
    assert.equal((await createBackup(fixture.home, destination)).status, "completed");
    const before = await readFile(path.join(fixture.home, "unknown-top.txt"), "utf8");
    const result = await restoreBackup(fixture.home, destination, {
      activateHome: () => {
        throw new Error("injected activation failure");
      },
    });
    assert.equal(result.status, "failed");
    assert.equal(result.reason, "activation-failed");
    assert.match(result.impact, /put back|previous Home/i);
    assert.equal(await readFile(path.join(fixture.home, "unknown-top.txt"), "utf8"), before);
    assert.equal(existsSync(path.join(fixture.home, STORE_DATABASE_NAME)), true);
    assert.ok(result.recoveryCopy !== undefined || result.stagingPath !== undefined);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("inspect is byte-read-only and leaves WAL/SHM sidecars unchanged", async () => {
  const fixture = await makeFixture("forklight-backup-inspect-ro-");
  try {
    const destination = path.join(fixture.root, "backup");
    assert.equal((await createBackup(fixture.home, destination)).status, "completed");
    const walBytes = Buffer.from("WAL_SIDECAR_BYTES_MUST_STAY");
    const shmBytes = Buffer.from("SHM_SIDECAR_BYTES_MUST_STAY");
    await writeFile(path.join(destination, STORE_WAL_NAME), walBytes);
    await writeFile(path.join(destination, STORE_SHM_NAME), shmBytes);
    const before = snapshotTree(destination);
    const homeBefore = snapshotTree(fixture.home);
    const inspected = await inspectBackup(destination);
    assert.equal(inspected.status, "ready");
    assert.deepEqual(snapshotTree(destination), before);
    assert.deepEqual(
      await readFile(path.join(destination, STORE_WAL_NAME)),
      walBytes,
    );
    assert.deepEqual(
      await readFile(path.join(destination, STORE_SHM_NAME)),
      shmBytes,
    );
    assert.deepEqual(snapshotTree(fixture.home), homeBefore);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("late live owner after staging refuses restore before Home rename", async () => {
  const fixture = await makeFixture("forklight-backup-late-owner-");
  try {
    const destination = path.join(fixture.root, "backup");
    assert.equal((await createBackup(fixture.home, destination)).status, "completed");
    const stopped: BackupOwnerObservation = {
      owner: "daemon",
      state: "stopped",
      nextAction: "none",
      reason: "Daemon is not running.",
    };
    const stoppedHub: BackupOwnerObservation = {
      owner: "hub",
      state: "stopped",
      nextAction: "none",
      reason: "Hub is not running.",
    };
    const liveDaemon: BackupOwnerObservation = {
      owner: "daemon",
      state: "live",
      nextAction: "stop-daemon",
      reason: "A live Daemon owns this Home. Stop it with `forklight daemon stop`. Restore never stops it.",
    };
    let daemonObservations = 0;
    const before = await readFile(path.join(fixture.home, "unknown-top.txt"), "utf8");
    const result = await restoreBackup(fixture.home, destination, {
      owners: {
        async observeDaemon() {
          daemonObservations += 1;
          return daemonObservations === 1 ? stopped : liveDaemon;
        },
        async observeHub() {
          return stoppedHub;
        },
      },
      activateHome: () => {
        throw new Error("must not activate after late owner");
      },
    });
    assert.equal(daemonObservations, 2);
    assert.equal(result.status, "refused");
    assert.equal(result.reason, "live-owner");
    assert.equal(result.nextAction, "stop-daemon");
    assert.equal(await readFile(path.join(fixture.home, "unknown-top.txt"), "utf8"), before);
    assert.equal(existsSync(path.join(fixture.home, STORE_DATABASE_NAME)), true);
    assert.equal(result.recoveryCopy, undefined);
    const parent = path.dirname(fixture.home);
    const homeName = path.basename(fixture.home);
    const leftovers = readdirSync(parent).filter((name) =>
      name.startsWith(`.${homeName}.forklight-restore-stage-`)
      || name.startsWith(`${homeName}.pre-restore-`),
    );
    assert.deepEqual(leftovers, []);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("activation and rollback rename failures keep recovery and staging paths", async () => {
  const fixture = await makeFixture("forklight-backup-double-rename-");
  try {
    const destination = path.join(fixture.root, "backup");
    assert.equal((await createBackup(fixture.home, destination)).status, "completed");
    const result = await restoreBackup(fixture.home, destination, {
      activateHome: () => {
        throw new Error("injected activation failure");
      },
      rollbackHome: () => {
        throw new Error("injected rollback failure");
      },
    });
    assert.equal(result.status, "failed");
    assert.equal(result.reason, "activation-failed");
    assert.equal(result.nextAction, "investigate");
    assert.notEqual(result.status, "completed");
    assert.match(result.impact, /not put back|remain/i);
    assert.ok(result.recoveryCopy);
    assert.ok(result.stagingPath);
    assert.equal(existsSync(result.recoveryCopy!), true);
    assert.equal(existsSync(result.stagingPath!), true);
    assert.equal(existsSync(fixture.home), false);
    assert.equal(
      await readFile(path.join(result.recoveryCopy!, "unknown-top.txt"), "utf8"),
      UNKNOWN,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("human and JSON output name credentials absence and stay off Keychain", async () => {
  const fixture = await makeFixture("forklight-backup-privacy-");
  try {
    const destination = path.join(fixture.root, "backup");
    const preview = await previewBackup(fixture.home, destination);
    const { formatBackupHuman } = await import("../src/core/backup.js");
    const human = formatBackupHuman(preview);
    const json = JSON.stringify(preview);
    for (const text of [human, json]) {
      assert.match(text, /included/i);
      assert.match(text, /excluded/i);
      assert.match(text, /integrity/i);
      assert.match(text, /impact/i);
      assert.match(text, /nextAction/i);
      assertNoSecret(text);
    }
    assert.match(human, /Keychain/);
    assert.match(human, /not included/i);
    assert.match(human, /Keep this backup private/);
    assert.match(json, /"keychain"\s*:\s*"not-included"/);
    assert.match(json, /"externalMainAuth"\s*:\s*"not-included"/);
    assert.match(json, /"privacy"\s*:\s*"keep-private"/);
    const source = await readFile(new URL("../src/core/backup.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /createKeychainStore|from "\.\/secrets\.js"|from "\.\.\/core\/secrets\.js"/);
    assert.doesNotMatch(source, /ensureDaemon|stopDaemon|replaceHubOwner|signalProcess/);
    const created = await createBackup(fixture.home, destination);
    assert.equal(created.status, "completed");
    assert.equal(await treeContainsSecret(destination), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("public CLI preview create inspect restore print shared facts twice", async () => {
  for (const suffix of ["cli-1-", "cli-2-"] as const) {
    const fixture = await makeFixture(`forklight-backup-${suffix}`);
    try {
      const destination = path.join(fixture.root, "backup");
      const preview = await runCli(fixture.home, [
        "backup", "preview", "--destination", destination, "--json",
      ]);
      assert.equal(preview.code, 0, preview.stderr);
      const previewJson = JSON.parse(preview.stdout) as BackupResult;
      assertSharedFacts(previewJson);
      assert.match(preview.stdout, /forklight\.sqlite/);
      assert.match(preview.stdout, /runs/);
      assert.match(preview.stdout, /not-included/);

      const created = await runCli(fixture.home, [
        "backup", "create", "--destination", destination, "--confirm", "--json",
      ]);
      assert.equal(created.code, 0, created.stderr);
      assert.equal((JSON.parse(created.stdout) as BackupResult).status, "completed");

      const inspected = await runCli(fixture.home, ["backup", "inspect", destination, "--json"]);
      assert.equal(inspected.code, 0, inspected.stderr);
      assert.equal((JSON.parse(inspected.stdout) as BackupResult).status, "ready");

      const restorePreview = await runCli(fixture.home, ["backup", "restore", destination, "--json"]);
      assert.equal(restorePreview.code, 0, restorePreview.stderr);
      assert.equal((JSON.parse(restorePreview.stdout) as BackupResult).status, "ready");

      const restored = await runCli(fixture.home, [
        "backup", "restore", destination, "--confirm", "--json",
      ]);
      assert.equal(restored.code, 0, restored.stderr);
      const restoredJson = JSON.parse(restored.stdout) as BackupResult;
      assert.equal(restoredJson.status, "completed");
      assert.ok(restoredJson.recoveryCopy);
      assert.equal(await readFile(path.join(fixture.home, "unknown-top.txt"), "utf8"), UNKNOWN);
      assert.equal(existsSync(path.join(fixture.home, "forklight.sock")), false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
});

test("backup module does not start owners and published backup has no escaping link", async () => {
  const fixture = await makeFixture("forklight-backup-self-contained-");
  try {
    const destination = path.join(fixture.root, "backup");
    const created = await createBackup(fixture.home, destination);
    assert.equal(created.status, "completed");
    const { readdirSync } = await import("node:fs");
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const abs = path.join(dir, name);
        const stats = lstatSync(abs);
        if (stats.isSymbolicLink()) {
          const text = readlinkSync(abs);
          const target = path.resolve(path.dirname(abs), text);
          assert.ok(
            target === destination || target.startsWith(destination + path.sep),
            "published backup must not contain an escaping link",
          );
        } else if (stats.isDirectory()) {
          walk(abs);
        }
      }
    };
    walk(destination);
    assert.equal(existsSync(path.join(fixture.home, "forklight.sock")), true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
