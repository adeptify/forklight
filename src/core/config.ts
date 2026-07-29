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

export function taskPaths(home: string, taskId: string): TaskPaths {
  const root = path.join(home, "runs", taskId);
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

export function daemonSocketPath(home = forklightHome()): string {
  return path.join(home, "forklight.sock");
}

export function daemonLogPath(home = forklightHome()): string {
  return path.join(home, "daemon.log");
}

export function keychainAccount(spec: TaskSpec): string {
  return spec.provider.keychainAccount ?? localAccountName();
}
