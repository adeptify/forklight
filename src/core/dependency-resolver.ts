import type { TaskStatus } from "./types.js";

export type DependencyDecision =
  | { kind: "ready" }
  | { kind: "waiting"; waitingOn: string[] }
  | { kind: "blocked"; failedBy: string[]; waitingOn: string[] };

/**
 * Resolve one item without reading or mutating daemon state. Failed prerequisites
 * dominate; interrupted prerequisites remain waiting because they can be resumed.
 */
export function resolveReadiness(
  itemId: string,
  dependencyIds: readonly string[],
  prerequisiteStates: ReadonlyMap<string, TaskStatus | undefined>,
): DependencyDecision {
  void itemId;
  const failedBy: string[] = [];
  const waitingOn: string[] = [];
  let allSucceeded = true;

  for (const dependencyId of dependencyIds) {
    const status = prerequisiteStates.get(dependencyId);
    if (status === "failed") {
      failedBy.push(dependencyId);
      allSucceeded = false;
    } else if (status !== "succeeded") {
      waitingOn.push(dependencyId);
      allSucceeded = false;
    }
  }

  if (failedBy.length > 0) return { kind: "blocked", failedBy, waitingOn };
  if (allSucceeded) return { kind: "ready" };
  return { kind: "waiting", waitingOn };
}
