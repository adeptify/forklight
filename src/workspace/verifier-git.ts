import { mkdir } from "node:fs/promises";
import type { TaskPaths, TaskRecord } from "../core/types.js";
import { verifierGitPaths } from "../core/config.js";
import { runCaptured } from "../core/process.js";

interface VerifierGitEnvironment {
  gitDir: string;
  indexFile: string;
  env: NodeJS.ProcessEnv;
}

async function runGit(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const result = await runCaptured("git", args, { cwd, env });
  if (result.exitCode !== 0) {
    throw new Error(
      `Unable to prepare verifier Git (${args[0] ?? "command"}): `
      + `${result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`}`,
    );
  }
  return result.stdout.trim();
}

async function prepareVerifierGitEnvironment(
  paths: TaskPaths,
  workTree: string,
): Promise<VerifierGitEnvironment> {
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

  return {
    gitDir,
    indexFile,
    env: {
      ...process.env,
      GIT_DIR: gitDir,
      GIT_WORK_TREE: workTree,
      GIT_INDEX_FILE: indexFile,
    },
  };
}

export async function verifierProcessEnvironment(
  task: TaskRecord,
  workTree = task.paths.workspace,
): Promise<NodeJS.ProcessEnv> {
  return (await prepareVerifierGitEnvironment(task.paths, workTree)).env;
}
