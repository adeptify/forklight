import type { TaskStatus } from "./types.js";

export type DependencyDecision =
  | { kind: "ready" }
  | { kind: "waiting"; waitingOn: string[] }
  | { kind: "blocked"; failedBy: string[]; waitingOn: string[] };

/**
 * Resolve one item without reading or mutating daemon state. Failed prerequisites
 * dominate; interrupted prerequisites remain waiting because they can be resumed.
 *
 * When `gateSatisfaction` is provided (Goal-supervised Plans only), a machine-
 * successful dependency still blocks until its configured milestone gate is
 * satisfied. A satisfied Goal gate is authoritative even when the machine Task
 * remains failed (for example original-acceptance Main remediation). Omit the
 * map for non-Goal Plans so behavior stays byte-compatible.
 */
export function resolveReadiness(
  itemId: string,
  dependencyIds: readonly string[],
  prerequisiteStates: ReadonlyMap<string, TaskStatus | undefined>,
  gateSatisfaction?: ReadonlyMap<string, boolean>,
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
    }
  }

  if (failedBy.length > 0) return { kind: "blocked", failedBy, waitingOn };
  if (allSucceeded) return { kind: "ready" };
  return { kind: "waiting", waitingOn };
}
