/**
 * Durable terminal failure classification (FL-D15/D16 + M2 contract-infeasible).
 * Prefer the normalizer-written payload.failureCategory over free-text parsing.
 *
 * Real runs often record two worker.failed rows: first the Claude normalizer
 * event (with failureCategory), then a bare runner summary event without
 * payload. Always scan newest-first for a classified payload so the bare
 * double-write cannot erase auth/budget classification.
 *
 * Contract-infeasible is also durable on verification.completed when independent
 * acceptance proves the Task Contract itself cannot be satisfied. Same-policy
 * Worker retry and adaptation must stop; Main revises the contract boundary.
 */

export type WorkerFailureCategory =
  | "authentication"
  | "budget"
  | "runtime"
  | "contract-infeasible";

const CATEGORIES = new Set<WorkerFailureCategory>([
  "authentication",
  "budget",
  "runtime",
  "contract-infeasible",
]);

function isWorkerFailureCategory(value: unknown): value is WorkerFailureCategory {
  return typeof value === "string" && CATEGORIES.has(value as WorkerFailureCategory);
}

function categoryFromPayload(payload: unknown): WorkerFailureCategory | undefined {
  if (payload === null || typeof payload !== "object") return undefined;
  const category = (payload as { failureCategory?: unknown }).failureCategory;
  return isWorkerFailureCategory(category) ? category : undefined;
}

/**
 * Read failureCategory from worker.failed and verification.completed events,
 * newest sequence first.
 * Returns the newest classified category even when a later bare worker.failed
 * (no payload) exists — matching runner.ts after claude normalizer events.
 * verification.completed may carry contract-infeasible without a worker.failed.
 */
export function failureCategoryFromEvents(
  events: readonly { type: string; sequence?: number; payload?: unknown }[],
): WorkerFailureCategory | undefined {
  const classified = events
    .filter(
      (event) =>
        event.type === "worker.failed" || event.type === "verification.completed",
    )
    .slice()
    .sort((left, right) => (right.sequence ?? 0) - (left.sequence ?? 0));
  for (const event of classified) {
    const category = categoryFromPayload(event.payload);
    if (category !== undefined) return category;
  }
  return undefined;
}

/**
 * Project failureCategory for status surfaces (CLI list/status, listTaskSurfaces,
 * Decision View / MCP status). Only failed|interrupted tasks expose a category;
 * historical worker.failed rows on succeeded/running/queued must not leak.
 */
export function failureCategoryForTask(
  status: string,
  events: readonly { type: string; sequence?: number; payload?: unknown }[],
): WorkerFailureCategory | undefined {
  if (status !== "failed" && status !== "interrupted") return undefined;
  return failureCategoryFromEvents(events);
}
