import { mkdir, realpath } from "node:fs/promises";
import type { TaskPaths, TaskRecord } from "../core/types.js";
import { verifierGitPaths } from "../core/config.js";
import { runCaptured } from "../core/process.js";

async function runGit(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  // When using the default process.env, strip inherited GIT_* variables
  // so Git preparation commands (init, etc.) are not corrupted by a parent
  // ForkLight process that has GIT_WORK_TREE set without GIT_DIR.
  let effectiveEnv = env;
  if (env === process.env) {
    effectiveEnv = { ...process.env };
    delete effectiveEnv.GIT_DIR;
    delete effectiveEnv.GIT_WORK_TREE;
    delete effectiveEnv.GIT_INDEX_FILE;
  }
  const result = await runCaptured("git", args, { cwd, env: effectiveEnv });
  if (result.exitCode !== 0) {
    throw new Error(
      `Unable to prepare verifier Git (${args[0] ?? "command"}): `
      + `${result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`}`,
    );
  }
  return result.stdout.trim();
}

/**
 * Escape a value for safe single-quoted embedding in a POSIX shell string.
 */
function shellQuote(s: string): string {
  return s.replace(/'/g, "'\\''");
}

/**
 * Build a zsh shell function that overrides `git` for the current session.
 * When `$PWD` is inside `workTree`, the function sets verifier Git context;
 * otherwise it delegates to the real `git` cleanly.
 *
 * Using a shell function (rather than PATH or environment variables) survives
 * login-shell PATH reordering by zsh -lc, which would bypass a PATH-based wrapper.
 */
function buildShellGitFunction(
  workTree: string,
  gitDir: string,
  indexFile: string,
): string {
  const sq = shellQuote;
  return (
    `git() { `
    + `unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE; `
    + `case "$PWD" in '${sq(workTree)}'|'${sq(workTree)}'/*) `
    + `GIT_DIR='${sq(gitDir)}' GIT_WORK_TREE='${sq(workTree)}' `
    + `GIT_INDEX_FILE='${sq(indexFile)}' command git "$@";; `
    + `*) command git "$@";; esac; };`
  );
}

async function prepareVerifierGitEnvironment(
  paths: TaskPaths,
  workTree: string,
): Promise<{ env: NodeJS.ProcessEnv; shellGitPrefix: string }> {
  const { gitDir, indexFile } = verifierGitPaths(paths);
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  await runGit(["init", "--bare", "--quiet", gitDir], paths.root);

  const preparationEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_DIR: gitDir,
    GIT_WORK_TREE: paths.baseline,
    GIT_INDEX_FILE: indexFile,
    GIT_AUTHOR_NAME: "ForkLight Verifier",
    GIT_AUTHOR_EMAIL: "verifier@forklight.local",
    GIT_COMMITTER_NAME: "ForkLight Verifier",
    GIT_COMMITTER_EMAIL: "verifier@forklight.local",
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  };
  await runGit(["read-tree", "--empty"], paths.root, preparationEnvironment);
  await runGit(["add", "-A"], paths.baseline, preparationEnvironment);
  const tree = await runGit(["write-tree"], paths.root, preparationEnvironment);
  const commit = await runGit(
    ["commit-tree", tree, "-m", "ForkLight baseline"],
    paths.root,
    preparationEnvironment,
  );
  await runGit(["update-ref", "refs/heads/main", commit], paths.root, preparationEnvironment);
  await runGit(["symbolic-ref", "HEAD", "refs/heads/main"], paths.root, preparationEnvironment);
  await runGit(["read-tree", "HEAD"], paths.root, preparationEnvironment);

  // Build sanitized acceptance environment: strip any inherited GIT_*
  // variables so nested repositories in subprocesses stay independent.
  const sanitizedEnv: NodeJS.ProcessEnv = { ...process.env };
  delete sanitizedEnv.GIT_DIR;
  delete sanitizedEnv.GIT_WORK_TREE;
  delete sanitizedEnv.GIT_INDEX_FILE;

  // Canonicalize the workTree so macOS /var → /private/var symlinks don't
  // cause mismatches with zsh $PWD (which resolves to /private/var/…).
  let canonicalWorkTree = workTree;
  try {
    canonicalWorkTree = await realpath(workTree);
  } catch {
    // workTree may not exist yet; fall back to the unresolved path.
  }

  const shellGitPrefix = buildShellGitFunction(canonicalWorkTree, gitDir, indexFile);

  return { env: sanitizedEnv, shellGitPrefix };
}

/**
 * Prepare the verifier Git environment and a shell function prefix that
 * scopes Git commands to the workspace without native variable leakage.
 *
 * The shell function survives zsh -lc login-shell PATH reordering and
 * delegates to the real git for subprocesses outside the workspace.
 */
export async function verifierProcessEnvironment(
  task: TaskRecord,
  workTree = task.paths.workspace,
): Promise<{ env: NodeJS.ProcessEnv; shellGitPrefix: string }> {
  return prepareVerifierGitEnvironment(task.paths, workTree);
}
