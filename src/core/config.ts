import { homedir, userInfo } from "node:os";
import path from "node:path";
import type { TaskPaths, TaskSpec } from "./types.js";

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
  return spec.provider.keychainAccount ?? userInfo().username;
}
