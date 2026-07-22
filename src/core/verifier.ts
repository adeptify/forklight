import type { TaskRecord, VerificationCommandResult, VerificationResult } from "./types.js";
import type { StateStore } from "../state/store.js";
import { runCaptured } from "./process.js";
import { sourceIsUnchanged, writeWorkspaceDiff } from "../workspace/copy.js";

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

  await writeWorkspaceDiff(task.paths);
  const sourceUnchanged = await sourceIsUnchanged(task.spec, task.paths);
  const passed = commands.length === task.spec.acceptance.commands.length
    && commands.every((command) => command.exitCode === 0)
    && sourceUnchanged;
  const verification: VerificationResult = {
    passed,
    commands,
    diffPath: task.paths.diff,
    sourceUnchanged,
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
