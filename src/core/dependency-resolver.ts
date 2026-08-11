import type { StateStore } from "../state/store.js";
import { resolveLatestRevision } from "./candidate-revision.js";
import {
  hasQualifyingAmendedAcceptanceRemediation,
  hasQualifyingOriginalAcceptanceRemediation,
  hasSuccessfulExactIntegration,
} from "./goal.js";
import type { CandidateRevision, TaskStatus } from "./types.js";

export type DependencyDecision =
  | { kind: "ready" }
  | { kind: "waiting"; waitingOn: string[] }
  | { kind: "blocked"; failedBy: string[]; waitingOn: string[] };

/**
 * True when a CandidateRevision carries material source changes that require
 * Main review and Integration before downstream coding work can safely consume
 * the result. Empty/zero-diff revisions are verification outcomes, not delivery.
 */
export function isMaterialCandidateRevision(
  revision: CandidateRevision | undefined,
): boolean {
  if (revision === undefined) return false;
  return revision.filesChanged > 0 && revision.affectedPaths.length > 0;
}

/**
 * Core-owned prerequisite completion fact for independent Plans.
 *
 * Evidence rules (no task names, class strings, UI state, or user flags):
 * - Non-succeeded machine status is never complete (failed dominance stays with
 *   resolveReadiness).
 * - Succeeded with no material current Candidate (legacy, read-only, zero-diff)
 *   is complete at machine success.
 * - Succeeded with a material current Candidate remains incomplete until the
 *   exact current Candidate has current Main accept and successful final
 *   delivery (exact Integration applied, or qualifying Main remediation).
 *
 * Goal milestone gates remain a separate authoritative override and must not
 * call this helper in place of evaluateMilestoneGate.
 */
export function isPrerequisiteResultComplete(
  store: StateStore,
  taskId: string | undefined,
  status: TaskStatus | undefined,
): boolean {
  if (status !== "succeeded") return false;
  if (taskId === undefined) return false;
  try {
    const latest = resolveLatestRevision(store.listEvents(taskId));
    if (!isMaterialCandidateRevision(latest)) {
      return true;
    }
    // Material Candidate: reviewed delivery or qualifying remediation only.
    if (hasSuccessfulExactIntegration(store, taskId)) return true;
    if (hasQualifyingOriginalAcceptanceRemediation(store, taskId)) return true;
    if (hasQualifyingAmendedAcceptanceRemediation(store, taskId)) return true;
    return false;
  } catch {
    // Corrupt or unreadable evidence must never unlock a dependent.
    return false;
  }
}

/**
 * Resolve one item without reading or mutating daemon state. Failed prerequisites
 * dominate; interrupted prerequisites remain waiting because they can be resumed.
 *
 * When `gateSatisfaction` is provided (Goal-supervised Plans only), a machine-
 * successful dependency still blocks until its configured milestone gate is
 * satisfied. A satisfied Goal gate is authoritative even when the machine Task
 * remains failed (for example original-acceptance Main remediation). Omit the
 * map for non-Goal Plans so Goal behavior stays byte-compatible.
 *
 * When `prerequisiteCompletion` is provided (independent Plans), a machine-
 * successful dependency still blocks while the shared completion fact is false
 * (material Candidate awaiting Main accept + final delivery). Legacy and
 * zero-diff prerequisites report true at machine success. Goal-supervised
 * Plans omit this map and keep gateSatisfaction authoritative.
 */
export function resolveReadiness(
  itemId: string,
  dependencyIds: readonly string[],
  prerequisiteStates: ReadonlyMap<string, TaskStatus | undefined>,
  gateSatisfaction?: ReadonlyMap<string, boolean>,
  prerequisiteCompletion?: ReadonlyMap<string, boolean>,
): DependencyDecision {
  void itemId;
  const failedBy: string[] = [];
  const waitingOn: string[] = [];
  let allSucceeded = true;

  for (const dependencyId of dependencyIds) {
    // Goal gate authority wins when present and satisfied.
    if (gateSatisfaction !== undefined && gateSatisfaction.get(dependencyId) === true) {
      continue;
    }
    const status = prerequisiteStates.get(dependencyId);
    if (status === "failed") {
      failedBy.push(dependencyId);
      allSucceeded = false;
    } else if (status !== "succeeded") {
      waitingOn.push(dependencyId);
      allSucceeded = false;
    } else if (gateSatisfaction !== undefined) {
      // Machine success alone is not enough when a Goal gate is still open.
      waitingOn.push(dependencyId);
      allSucceeded = false;
    } else if (
      prerequisiteCompletion !== undefined
      && prerequisiteCompletion.get(dependencyId) === false
    ) {
      // Independent Plan: material Candidate still needs reviewed delivery.
      waitingOn.push(dependencyId);
      allSucceeded = false;
    }
  }

  if (failedBy.length > 0) return { kind: "blocked", failedBy, waitingOn };
  if (allSucceeded) return { kind: "ready" };
  return { kind: "waiting", waitingOn };
}
