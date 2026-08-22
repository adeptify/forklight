import { execFileSync } from "node:child_process";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import type { TaskPaths, TaskSpec } from "./types.js";

const LOCAL_ACCOUNT_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export function selectLocalAccountName(
  candidates: readonly unknown[],
): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const value = candidate.trim();
    if (LOCAL_ACCOUNT_PATTERN.test(value)) return value;
  }
  return undefined;
}

/**
 * Resolve the local macOS Keychain account without making os.userInfo() a
 * single point of failure. Some detached Hub processes can receive
 * uv_os_get_passwd ENOENT even though USER/LOGNAME and `id -un` remain valid.
 */
export function localAccountName(): string {
  let osUsername: string | undefined;
  try {
    osUsername = userInfo().username;
  } catch {
    osUsername = undefined;
  }

  let idUsername: string | undefined;
  try {
    idUsername = execFileSync("id", ["-un"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    idUsername = undefined;
  }

  const account = selectLocalAccountName([
    osUsername,
    process.env.USER,
    process.env.LOGNAME,
    idUsername,
  ]);
  if (account === undefined) {
    throw new Error("Unable to resolve the local Keychain account");
  }
  return account;
}

export function forklightHome(): string {
  const override = process.env.FORKLIGHT_HOME?.trim();
  if (override) return path.resolve(override);
  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", "ForkLight");
  }
  return path.join(homedir(), ".local", "share", "forklight");
}

/** Canonical per-Task run directory: `<home>/runs/<taskId>`. */
export function taskRunRoot(home: string, taskId: string): string {
  return path.join(home, "runs", taskId);
}

export function taskPaths(home: string, taskId: string): TaskPaths {
  const root = taskRunRoot(home, taskId);
  return {
    root,
    baseline: path.join(root, "baseline"),
    workspace: path.join(root, "workspace"),
    logs: path.join(root, "logs"),
    claudeConfig: path.join(root, "claude-config"),
    diff: path.join(root, "result.diff"),
  };
}

export function verifierGitPaths(paths: TaskPaths): {
  gitDir: string;
  indexFile: string;
} {
  return {
    gitDir: path.join(paths.root, "verifier-git"),
    indexFile: path.join(paths.root, "verifier-git.index"),
  };
}

/** Top-level names ordinary reclaim may remove. Unknown names are never implied. */
export const KNOWN_REGENERABLE_ENTRY_NAMES = [
  "workspace",
  "baseline",
  "claude-config",
  "grok-home",
  "codex-home",
  "codex-tmp",
  "verifier-git",
  "verifier-git.index",
] as const;

/** Top-level durable evidence names ordinary reclaim must keep. */
export const DURABLE_EVIDENCE_ENTRY_NAMES = [
  "logs",
  "result.diff",
  "workspace.raw.patch",
  "workspace.generated.patch",
  "revisions",
  "reviews",
  "handoff",
  "source-manifest.json",
  "integration",
] as const;

export const STORE_DATABASE_NAME = "forklight.sqlite";
export const STORE_WAL_NAME = "forklight.sqlite-wal";
export const STORE_SHM_NAME = "forklight.sqlite-shm";
export const DAEMON_SOCKET_NAME = "forklight.sock";
export const DAEMON_LOG_NAME = "daemon.log";
const HUB_INSTANCE_NAME = "hub-instance.json";
const HUB_OWNER_CLAIM_NAME = ".hub-owner.json";
export const BACKUP_MANIFEST_NAME = "forklight.backup.json";

/** Known top-level names that a Home backup must not copy. */
export const HOME_TRANSIENT_ENTRY_NAMES = [
  DAEMON_SOCKET_NAME,
  DAEMON_LOG_NAME,
  HUB_INSTANCE_NAME,
  HUB_OWNER_CLAIM_NAME,
  STORE_WAL_NAME,
  STORE_SHM_NAME,
] as const;

export function daemonSocketPath(home = forklightHome()): string {
  return path.join(home, DAEMON_SOCKET_NAME);
}

export function daemonLogPath(home = forklightHome()): string {
  return path.join(home, DAEMON_LOG_NAME);
}

export function keychainAccount(spec: TaskSpec): string {
  return spec.provider.keychainAccount ?? localAccountName();
}
