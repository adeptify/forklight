import type { TaskRecord, VerificationCommandResult, VerificationResult, CompletionPolicyCheck, PolicyMode } from "./types.js";
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

function resolveNoChangeMode(spec: TaskRecord["spec"]): PolicyMode {
  return spec.completionPolicy?.noChangeMode ?? "hard";
}

function evaluateCompletionPolicy(
  spec: TaskRecord["spec"],
  diff: { filesChanged: number; changedLines: number },
): CompletionPolicyCheck {
  const noChangeMode = resolveNoChangeMode(spec);

  if (!spec.worker.allowEdits) {
    return {
      check: "not-applicable",
      noChangeMode,
      message: "Read-only Task; no-change delivery policy does not apply",
    };
  }

  const hasChanges = diff.filesChanged > 0 || diff.changedLines > 0;

  if (hasChanges) {
    return {
      check: "satisfied",
      noChangeMode,
      message: `Worker delivered changes: ${diff.filesChanged} file(s), ${diff.changedLines} line(s)`,
    };
  }

  // No changes detected in an editable Task
  switch (noChangeMode) {
    case "hard":
      return {
        check: "hard-fail",
        noChangeMode,
        message: "No workspace changes detected after editable Worker completed",
      };
    case "warn":
      return {
        check: "warning",
        noChangeMode,
        message: "Warning: No workspace changes detected after editable Worker completed",
      };
    case "score":
      return {
        check: "score-evidence",
        noChangeMode,
        message: "No workspace changes detected; recorded as scoring penalty evidence",
      };
    case "off":
      return {
        check: "ignored",
        noChangeMode,
        message: "No workspace changes detected; no-change policy is off",
      };
  }
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
  const diffMeasure = measureDiff(diff);
  const changeBudget = task.spec.version === 2
    ? {
        ...diffMeasure,
        ...task.spec.contract.changeBudget,
        withinBudget: false,
      }
    : undefined;
  if (changeBudget) {
    changeBudget.withinBudget =
      changeBudget.filesChanged <= changeBudget.maxFiles &&
      changeBudget.changedLines <= changeBudget.maxDiffLines;
  }

  // Evaluate the snapped completion policy against the measured diff.
  const completionPolicyCheck = evaluateCompletionPolicy(task.spec, diffMeasure);

  const passed = commands.length === task.spec.acceptance.commands.length
    && commands.every((command) => command.exitCode === 0)
    && sourceUnchanged
    && (changeBudget?.withinBudget ?? true)
    && completionPolicyCheck.check !== "hard-fail";
  const verification: VerificationResult = {
    passed,
    commands,
    diffPath: task.paths.diff,
    sourceUnchanged,
    ...(changeBudget === undefined ? {} : { changeBudget }),
    completionPolicy: completionPolicyCheck,
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
