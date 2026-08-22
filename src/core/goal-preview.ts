/**
 * Safe read-only Goal validation preview.
 *
 * One canonical projection shared by CLI `validate-goal`, daemon/API
 * `goal_validate`, and MCP `forklight_goal_validate`. Loads a Goal through
 * the existing authoritative Goal loader/validator and reduces the already
 * validated Plan and Task facts to bounded hierarchy facts only.
 *
 * Read-only by construction: validation creates no Goal, Plan, Task, event,
 * or workspace, and never touches the Store. The preview never contains raw
 * Task contracts, Provider settings, commands, credentials, or private
 * absolute paths.
 */

import {
  formatGoalDurationMs,
  loadGoal,
  type LoadedGoal,
} from "./goal.js";
import type { TaskPolicy } from "./settings.js";
import type { GoalMilestoneGate } from "./types.js";

/** One bounded milestone fact inside a validated Goal phase. */
export interface GoalValidationMilestone {
  itemId: string;
  gate: GoalMilestoneGate;
  taskName: string;
}

/** One validated Goal phase: a Plan plus its milestone gates. */
export interface GoalValidationPhase {
  planName: string;
  planObjective: string;
  taskCount: number;
  milestoneCount: number;
  milestones: GoalValidationMilestone[];
  /** Dependency waves as item-id groups, mirroring Plan waves. */
  dependencyWaves: string[][];
}

interface GoalValidationPolicy {
  maxDurationMs: number | null;
  noProgressTimeoutMs: number | null;
  maxCorrectionRounds: number;
  maxReviewRounds: number;
  maxNoNewEvidenceCycles: number;
}

/**
 * Bounded safe Goal validation result shared by CLI, daemon, and MCP.
 * Semantic fields are absent when validation failed so callers never guess
 * at a version/name the validator rejected.
 */
export interface SafeGoalValidationPreview {
  passed: boolean;
  issues: string[];
  note: string;
  version?: 1 | 2;
  name?: string;
  objective?: string;
  phaseCount?: number;
  taskCount?: number;
  policy?: GoalValidationPolicy;
  phases?: GoalValidationPhase[];
}

export const GOAL_VALIDATION_NOTE =
  "Read-only validation. Nothing was created: no Goal, Plan, Task, event or workspace.";

function projectLoadedGoal(loaded: LoadedGoal): SafeGoalValidationPreview {
  const phases: GoalValidationPhase[] = loaded.phases.map((phase) => {
    const indexById = new Map(
      phase.plan.items.map((item, index) => [item.id, index]),
    );
    const milestones: GoalValidationMilestone[] = phase.milestones.map(
      (milestone) => {
        const itemIndex = indexById.get(milestone.itemId);
        return {
          itemId: milestone.itemId,
          gate: milestone.gate,
          taskName:
            itemIndex === undefined
              ? ""
              : phase.plan.items[itemIndex]!.task.name,
        };
      },
    );
    return {
      planName: phase.plan.name,
      planObjective: phase.plan.objective,
      taskCount: phase.plan.items.length,
      milestoneCount: phase.milestones.length,
      milestones,
      dependencyWaves: phase.plan.waves.map((wave) => [...wave]),
    };
  });
  return {
    passed: true,
    issues: [],
    note: GOAL_VALIDATION_NOTE,
    version: loaded.version,
    name: loaded.name,
    objective: loaded.objective,
    phaseCount: phases.length,
    taskCount: phases.reduce((sum, phase) => sum + phase.taskCount, 0),
    policy: {
      maxDurationMs: loaded.policy.maxDurationMs,
      noProgressTimeoutMs: loaded.policy.noProgressTimeoutMs,
      maxCorrectionRounds: loaded.policy.maxCorrectionRounds,
      maxReviewRounds: loaded.policy.maxReviewRounds,
      maxNoNewEvidenceCycles: loaded.policy.maxNoNewEvidenceCycles,
    },
    phases,
  };
}

/**
 * Load a Goal through the existing authoritative Goal validator and return
 * one bounded read-only hierarchy preview. Never persists or submits
 * anything; invalid Goal/Plan/dependency/Task contracts surface the
 * validator's own issues with `passed: false`.
 */
export async function buildGoalValidationPreview(
  goalFileInput: string,
  policy?: TaskPolicy,
): Promise<SafeGoalValidationPreview> {
  const report = await loadGoal(goalFileInput, policy);
  if (!report.passed || report.goal === undefined) {
    return {
      passed: false,
      issues: [...report.issues],
      note: GOAL_VALIDATION_NOTE,
    };
  }
  return projectLoadedGoal(report.goal);
}

/** Human-readable validate-goal lines. Never prints paths, secrets, or raw contracts. */
export function formatGoalValidationPreviewHuman(
  preview: SafeGoalValidationPreview,
): string {
  const lines: string[] = [];
  if (
    preview.passed
    && preview.version !== undefined
    && preview.phases !== undefined
  ) {
    lines.push(`Goal: ${preview.name} (version ${preview.version})`);
    lines.push(`Objective: ${preview.objective}`);
    lines.push(`Validation: PASS`);
    lines.push(`Phases: ${preview.phaseCount} Plan(s), ${preview.taskCount} Task(s)`);
    if (preview.policy !== undefined) {
      lines.push(
        `Policy: total duration ${formatGoalDurationMs(preview.policy.maxDurationMs)}; `
        + `no-progress stop after ${formatGoalDurationMs(preview.policy.noProgressTimeoutMs)}; `
        + `max corrections ${String(preview.policy.maxCorrectionRounds)}; `
        + `max reviews ${String(preview.policy.maxReviewRounds)}; `
        + `max no-new-evidence ${String(preview.policy.maxNoNewEvidenceCycles)}`,
      );
    }
    preview.phases.forEach((phase, index) => {
      lines.push(`Phase ${index + 1}: ${phase.planName}`);
      lines.push(`  Objective: ${phase.planObjective}`);
      lines.push(`  Tasks: ${phase.taskCount} (${phase.milestoneCount} milestone(s))`);
      lines.push(
        `  Milestones: ${phase.milestones
          .map(
            (milestone) =>
              `${milestone.itemId}`
              + `${milestone.taskName ? ` (${milestone.taskName})` : ""}`
              + ` [${milestone.gate}]`,
          )
          .join(", ")}`,
      );
      phase.dependencyWaves.forEach((wave, waveIndex) => {
        lines.push(`  Wave ${waveIndex + 1}: ${wave.join(", ")}`);
      });
    });
  } else {
    lines.push("Goal validation: FAIL");
    for (const issue of preview.issues) lines.push(`✗ ${issue}`);
  }
  lines.push(`Note: ${preview.note}`);
  return `${lines.join("\n")}\n`;
}
