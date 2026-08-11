import type { IntegrationSettings } from "./settings.js";
import type { TaskSpec } from "./types.js";

/**
 * Compare a Task Contract changeBudget against Integration hard limits.
 * Does not block validation by itself — callers surface warnings so operators
 * see "executable but not integratable" before paying for a Worker run.
 */
export interface IntegrationFeasibility {
  applicable: boolean;
  integratable: boolean;
  taskMaxFiles: number | null;
  taskMaxLines: number | null;
  integrationMaxFiles: number;
  integrationMaxLines: number;
  issues: string[];
}

export function assessIntegrationFeasibility(
  spec: TaskSpec,
  integration: IntegrationSettings,
): IntegrationFeasibility {
  const integrationMaxFiles = integration.reviewedPatchMaxFiles;
  const integrationMaxLines = integration.reviewedPatchMaxLines;

  // Change budget is Coding-only for version-3 Tasks (optional extension);
  // v2 always carries it. Domain-neutral Tasks have no change budget.
  const budget = spec.version === 2
    ? spec.contract.changeBudget
    : spec.version === 3 && spec.contract.coding !== undefined
      ? spec.contract.coding.changeBudget
      : undefined;

  if (budget === undefined) {
    return {
      applicable: false,
      integratable: true,
      taskMaxFiles: null,
      taskMaxLines: null,
      integrationMaxFiles,
      integrationMaxLines,
      issues: [],
    };
  }

  const taskMaxFiles = budget.maxFiles;
  const taskMaxLines = budget.maxDiffLines;
  const issues: string[] = [];
  if (taskMaxFiles > integrationMaxFiles) {
    issues.push(
      `Task changeBudget.maxFiles (${taskMaxFiles}) exceeds integration.reviewedPatchMaxFiles (${integrationMaxFiles})`,
    );
  }
  if (taskMaxLines > integrationMaxLines) {
    issues.push(
      `Task changeBudget.maxDiffLines (${taskMaxLines}) exceeds integration.reviewedPatchMaxLines (${integrationMaxLines})`,
    );
  }

  return {
    applicable: true,
    integratable: issues.length === 0,
    taskMaxFiles,
    taskMaxLines,
    integrationMaxFiles,
    integrationMaxLines,
    issues,
  };
}
