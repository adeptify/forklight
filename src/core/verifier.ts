import type {
  TaskRecord,
  VerificationCommandResult,
  VerificationResult,
  CompletionPolicyCheck,
  PolicyLimitEvidence,
  PolicyMode,
} from "./types.js";
import type { StateStore } from "../state/store.js";
import { runCaptured } from "./process.js";
import { assessSourceCompatibility } from "../workspace/copy.js";
import { createPathPolicy } from "../workspace/path-policy.js";
import { writeWorkspacePatchReport } from "../workspace/patch.js";
import { verifierProcessEnvironment } from "../workspace/verifier-git.js";
import {
  ensureWorkspaceDependencyMirrors,
  RUNTIME_DEPENDENCY_DIRECTORIES,
} from "../workspace/dependency-materializer.js";
import {
  sizePolicyFromSnapshot,
} from "./advanced-policy.js";
import { assessContractInfeasibility } from "./contract-infeasible.js";

/** Collect privacy-safe contract-infeasible reason codes from durable events.
 *  Codes may be declared by Main before verification (or fixtures). Free-text
 *  command output is never parsed. */
function contractInfeasibilityCodesFromEvents(
  store: StateStore,
  taskId: string,
): string[] {
  const codes: string[] = [];
  for (const event of store.listEvents(taskId)) {
    const payload = event.payload;
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      continue;
    }
    const record = payload as {
      contractInfeasibilityCodes?: unknown;
      failureCategory?: unknown;
    };
    if (Array.isArray(record.contractInfeasibilityCodes)) {
      for (const code of record.contractInfeasibilityCodes) {
        if (typeof code === "string" && code.trim().length > 0) {
          codes.push(code.trim());
        }
      }
    }
    if (record.failureCategory === "contract-infeasible") {
      codes.push("contract-infeasible");
    }
  }
  return codes;
}

function resolveNoChangeMode(task: TaskRecord): PolicyMode {
  if (task.effectivePolicy !== undefined) {
    return task.effectivePolicy.values.completionMode;
  }
  return task.spec.completionPolicy?.noChangeMode ?? "hard";
}

function resolveChangeBudgetMode(task: TaskRecord): PolicyMode {
  if (task.effectivePolicy !== undefined) {
    return task.effectivePolicy.values.changeBudgetMode;
  }
  return task.spec.completionPolicy?.changeBudgetMode ?? "hard";
}

/** Evaluate whether file/line limits from the effective policy snapshot are violated. */
function evaluateSizePolicy(
  task: TaskRecord,
  diff: { filesChanged: number; changedLines: number },
): { fileLimitEvidence: PolicyLimitEvidence | null; lineLimitEvidence: PolicyLimitEvidence | null } {
  const size = sizePolicyFromSnapshot(task.effectivePolicy);
  const results: { fileLimitEvidence: PolicyLimitEvidence | null; lineLimitEvidence: PolicyLimitEvidence | null } = {
    fileLimitEvidence: null,
    lineLimitEvidence: null,
  };

  if (size.fileLimit !== null && diff.filesChanged > size.fileLimit) {
    results.fileLimitEvidence = {
      category: "file-limit",
      enforcementPhase: "post-observation",
      configured: size.fileLimit,
      observed: diff.filesChanged,
      effect: size.fileLimitMode === "off" ? "ignored"
        : size.fileLimitMode === "warn" ? "warning"
        : size.fileLimitMode === "score" ? "score-evidence"
        : "hard-fail",
      detail: `Business patch files (${diff.filesChanged}) exceeded file limit (${size.fileLimit}); mode: ${size.fileLimitMode}`,
    };
  }

  if (size.changedLineLimit !== null && diff.changedLines > size.changedLineLimit) {
    results.lineLimitEvidence = {
      category: "changed-line-limit",
      enforcementPhase: "post-observation",
      configured: size.changedLineLimit,
      observed: diff.changedLines,
      effect: size.changedLineLimitMode === "off" ? "ignored"
        : size.changedLineLimitMode === "warn" ? "warning"
        : size.changedLineLimitMode === "score" ? "score-evidence"
        : "hard-fail",
      detail: `Business patch lines (${diff.changedLines}) exceeded changed-line limit (${size.changedLineLimit}); mode: ${size.changedLineLimitMode}`,
    };
  }

  return results;
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
  task: TaskRecord,
  diff: { filesChanged: number; changedLines: number },
): CompletionPolicyCheck {
  const noChangeMode = resolveNoChangeMode(task);

  if (!task.spec.worker.allowEdits) {
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

  const { verification, summary } = await executeVerificationPass(store, task, attemptId);

  store.addEvent(task.id, attemptId, "verification.completed", summary, verification);
  return verification;
}

/**
 * Run the reusable verification pass: every acceptance command in the retained
 * workspace, plus business/generated/integration patch recompute, source
 * compatibility, completion policy, and size-policy evaluation.
 *
 * Emits per-command `verification.command.completed` and `policy.size.exceeded`
 * events bound to the supplied attemptId, but NEVER sets Task status and NEVER
 * emits `verification.started` or `verification.completed` - the caller owns
 * the status-management boundary and the canonical completion evidence. This
 * lets the candidate-reverification core rerun the exact same acceptance suite
 * without putting the Task into a crash-recoverable "verifying" state.
 *
 * `timeoutMs` is optional; omitting it preserves the historical unbounded
 * behavior used by the normal Worker verification path.
 */
export async function executeVerificationPass(
  store: StateStore,
  task: TaskRecord,
  attemptId: string,
  timeoutMs?: number,
): Promise<{ verification: VerificationResult; summary: string }> {
  // Old retained Candidates may still carry the historical external
  // node_modules symlink. Upgrade every verification entry point here so
  // ordinary correction/resume and no-Worker reverification share the same
  // command-ready isolation boundary. Also materialize root-manifest declared
  // relative file:/link: package roots into the Task isolation container.
  // Newly prepared local mirrors are a no-op.
  const excluded = new Set(task.spec.workspace.exclude);
  const dependencyNames = RUNTIME_DEPENDENCY_DIRECTORIES.filter((name) =>
    excluded.has(name),
  );
  await ensureWorkspaceDependencyMirrors(
    task.spec.project,
    task.paths.workspace,
    dependencyNames,
    task.paths.root,
  );

  const commands: VerificationCommandResult[] = [];
  const { env: verifierEnvironment, shellGitPrefix } = await verifierProcessEnvironment(task);
  for (const command of task.spec.acceptance.commands) {
    const result = await runCaptured("/bin/zsh", ["-lc", shellGitPrefix + command], {
      cwd: task.paths.workspace,
      env: verifierEnvironment,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
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

  const changeBudgetMode = resolveChangeBudgetMode(task);
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

  // Evaluate advanced-policy size limits from snapshot
  const sizeLimits = evaluateSizePolicy(task, diffMeasure);
  if (sizeLimits.fileLimitEvidence !== null) {
    store.addEvent(
      task.id, attemptId, "policy.size.exceeded",
      sizeLimits.fileLimitEvidence.detail,
      sizeLimits.fileLimitEvidence,
    );
  }
  if (sizeLimits.lineLimitEvidence !== null) {
    store.addEvent(
      task.id, attemptId, "policy.size.exceeded",
      sizeLimits.lineLimitEvidence.detail,
      sizeLimits.lineLimitEvidence,
    );
  }

  const completionPolicyCheck = evaluateCompletionPolicy(task, diffMeasure);

  const behaviorPassed = commands.length === task.spec.acceptance.commands.length
    && commands.every((command) => command.exitCode === 0);
  // Policy hard-fails only for hard-mode change-budget overruns and hard no-change policy.
  const policyPassed = (changeBudget?.effect !== "hard-fail")
    && completionPolicyCheck.check !== "hard-fail"
    && sizeLimits.fileLimitEvidence?.effect !== "hard-fail"
    && sizeLimits.lineLimitEvidence?.effect !== "hard-fail";
  const sourceCompatible = sourceAssessment.compatible;
  const passed = behaviorPassed && policyPassed && sourceCompatible;

  let verification: VerificationResult = {
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
    if (completionPolicyCheck.check === "hard-fail") {
      summary = "Independent verification failed: completion policy";
    } else if (
      sizeLimits.fileLimitEvidence?.effect === "hard-fail"
      || sizeLimits.lineLimitEvidence?.effect === "hard-fail"
    ) {
      summary = "Independent verification failed: Worker size policy";
    } else {
      summary = "Independent verification failed: change budget";
    }
  } else if (!sourceCompatible) {
    summary = "Independent verification failed: affected source paths changed";
  } else {
    summary = "Independent verification failed";
  }

  // When independent acceptance (or Main-declared codes) proves the contract
  // boundary is unsatisfiable, stamp failureCategory so same-policy retry stops.
  const assessment = assessContractInfeasibility({
    verificationPassed: passed,
    reasonCodes: contractInfeasibilityCodesFromEvents(store, task.id),
  });
  if (assessment.infeasible && assessment.failureCategory !== undefined) {
    verification = {
      ...verification,
      failureCategory: assessment.failureCategory,
      contractInfeasibility: {
        reason: assessment.reason ?? "contradictory-acceptance",
        summary: assessment.summary,
      },
    };
    summary = assessment.summary;
  }

  return { verification, summary };
}
