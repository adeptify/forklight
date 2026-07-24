import type {
  TaskRecord,
  VerificationCommandResult,
  VerificationResult,
  CompletionPolicyCheck,
  PolicyMode,
} from "./types.js";
import type { StateStore } from "../state/store.js";
import { runCaptured } from "./process.js";
import { assessSourceCompatibility } from "../workspace/copy.js";
import { createPathPolicy } from "../workspace/path-policy.js";
import { writeWorkspacePatchReport } from "../workspace/patch.js";
import { verifierProcessEnvironment } from "../workspace/verifier-git.js";

function resolveNoChangeMode(spec: TaskRecord["spec"]): PolicyMode {
  return spec.completionPolicy?.noChangeMode ?? "hard";
}

function resolveChangeBudgetMode(spec: TaskRecord["spec"]): PolicyMode {
  return spec.completionPolicy?.changeBudgetMode ?? "hard";
}

function modeEffect(
  mode: PolicyMode,
  violated: boolean,
): "satisfied" | "hard-fail" | "warning" | "score-evidence" | "ignored" {
  if (!violated) return "satisfied";
  switch (mode) {
    case "hard":
      return "hard-fail";
    case "warn":
      return "warning";
    case "score":
      return "score-evidence";
    case "off":
      return "ignored";
  }
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
  const verifierEnvironment = await verifierProcessEnvironment(task);
  for (const command of task.spec.acceptance.commands) {
    const result = await runCaptured("/bin/zsh", ["-lc", command], {
      cwd: task.paths.workspace,
      env: verifierEnvironment,
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
  }

  const patches = await writeWorkspacePatchReport(task.paths, createPathPolicy(task.spec));
  const diffMeasure = {
    filesChanged: patches.business.filesChanged,
    changedLines: patches.business.changedLines,
  };
  const sourceAssessment = await assessSourceCompatibility(
    task.spec,
    task.paths,
    patches.integration.affectedPaths,
  );

  const changeBudgetMode = resolveChangeBudgetMode(task.spec);
  let changeBudget: VerificationResult["changeBudget"];
  if (task.spec.version === 2) {
    const withinBudget =
      diffMeasure.filesChanged <= task.spec.contract.changeBudget.maxFiles
      && diffMeasure.changedLines <= task.spec.contract.changeBudget.maxDiffLines;
    changeBudget = {
      ...diffMeasure,
      ...task.spec.contract.changeBudget,
      withinBudget,
      mode: changeBudgetMode,
      effect: modeEffect(changeBudgetMode, !withinBudget),
    };
  }

  const completionPolicyCheck = evaluateCompletionPolicy(task.spec, diffMeasure);

  const behaviorPassed = commands.length === task.spec.acceptance.commands.length
    && commands.every((command) => command.exitCode === 0);
  // Policy hard-fails only for hard-mode change-budget overruns and hard no-change policy.
  const policyPassed = (changeBudget?.effect !== "hard-fail")
    && completionPolicyCheck.check !== "hard-fail";
  const sourceCompatible = sourceAssessment.compatible;
  const passed = behaviorPassed && policyPassed && sourceCompatible;

  const verification: VerificationResult = {
    passed,
    behaviorPassed,
    policyPassed,
    sourceCompatible,
    commands,
    diffPath: task.paths.diff,
    patches,
    sourceUnchanged: sourceAssessment.globalUnchanged,
    sourceCompatibility: {
      compatible: sourceAssessment.compatible,
      affectedPaths: sourceAssessment.affectedPaths,
      conflictingPaths: sourceAssessment.conflictingPaths,
      unrelatedDriftPaths: sourceAssessment.unrelatedDriftPaths,
    },
    ...(changeBudget === undefined ? {} : { changeBudget }),
    completionPolicy: completionPolicyCheck,
  };

  let summary: string;
  if (passed) {
    if (changeBudget?.effect === "warning") {
      summary = "Independent verification passed (change budget warning)";
    } else if (changeBudget?.effect === "score-evidence") {
      summary = "Independent verification passed (change budget score evidence)";
    } else if (sourceAssessment.unrelatedDriftPaths.length > 0) {
      summary = "Independent verification passed (unrelated source drift recorded)";
    } else {
      summary = "Independent verification passed";
    }
  } else if (!behaviorPassed) {
    summary = "Independent verification failed: acceptance commands";
  } else if (!policyPassed) {
    summary = completionPolicyCheck.check === "hard-fail"
      ? "Independent verification failed: completion policy"
      : "Independent verification failed: change budget";
  } else if (!sourceCompatible) {
    summary = "Independent verification failed: affected source paths changed";
  } else {
    summary = "Independent verification failed";
  }

  store.addEvent(task.id, attemptId, "verification.completed", summary, verification);
  return verification;
}
