import type { TaskRecord, VerificationCommandResult, VerificationResult } from "./types.js";
import type { StateStore } from "../state/store.js";
import { runCaptured } from "./process.js";
import { sourceIsUnchanged, writeWorkspaceDiff } from "../workspace/copy.js";

function measureDiff(diff: string): { filesChanged: number; changedLines: number } {
  const lines = diff.split("\n");
  return {
    filesChanged: lines.filter((line) => line.startsWith("diff --git ")).length,
    changedLines: lines.filter(
      (line) =>
        (line.startsWith("+") && !line.startsWith("+++")) ||
        (line.startsWith("-") && !line.startsWith("---")),
    ).length,
  };
}

export async function verifyTask(
  store: StateStore,
  task: TaskRecord,
  attemptId: string,
): Promise<VerificationResult> {
  store.setTaskStatus(task.id, "verifying");
  store.addEvent(task.id, attemptId, "verification.started", "Independent verification started");

  const commands: VerificationCommandResult[] = [];
  for (const command of task.spec.acceptance.commands) {
    const result = await runCaptured("/bin/zsh", ["-lc", command], {
      cwd: task.paths.workspace,
      env: process.env,
    });
    const commandResult: VerificationCommandResult = {
      command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
    };
    commands.push(commandResult);
    store.addEvent(
      task.id,
      attemptId,
      "verification.command.completed",
      `${command} ${result.exitCode === 0 ? "passed" : `failed with exit ${result.exitCode}`}`,
      commandResult,
    );
    if (result.exitCode !== 0) break;
  }

  const diff = await writeWorkspaceDiff(task.paths, task.spec.workspace.exclude);
  const sourceUnchanged = await sourceIsUnchanged(task.spec, task.paths);
  const changeBudget = task.spec.version === 2
    ? {
        ...measureDiff(diff),
        ...task.spec.contract.changeBudget,
        withinBudget: false,
      }
    : undefined;
  if (changeBudget) {
    changeBudget.withinBudget =
      changeBudget.filesChanged <= changeBudget.maxFiles &&
      changeBudget.changedLines <= changeBudget.maxDiffLines;
  }
  const passed = commands.length === task.spec.acceptance.commands.length
    && commands.every((command) => command.exitCode === 0)
    && sourceUnchanged
    && (changeBudget?.withinBudget ?? true);
  const verification: VerificationResult = {
    passed,
    commands,
    diffPath: task.paths.diff,
    sourceUnchanged,
    ...(changeBudget === undefined ? {} : { changeBudget }),
  };
  store.addEvent(
    task.id,
    attemptId,
    "verification.completed",
    passed ? "Independent verification passed" : "Independent verification failed",
    verification,
  );
  return verification;
}
