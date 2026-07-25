/**
 * Durable Worker terminal failure classification (FL-D15/D16).
 * Prefer the normalizer-written payload.failureCategory over free-text parsing.
 *
 * Real runs often record two worker.failed rows: first the Claude normalizer
 * event (with failureCategory), then a bare runner summary event without
 * payload. Always scan newest-first for a classified payload so the bare
 * double-write cannot erase auth/budget classification.
 */

export type WorkerFailureCategory = "authentication" | "budget" | "runtime";

const CATEGORIES = new Set<WorkerFailureCategory>([
  "authentication",
  "budget",
  "runtime",
]);

export function isWorkerFailureCategory(value: unknown): value is WorkerFailureCategory {
  return typeof value === "string" && CATEGORIES.has(value as WorkerFailureCategory);
}

function categoryFromPayload(payload: unknown): WorkerFailureCategory | undefined {
  if (payload === null || typeof payload !== "object") return undefined;
  const category = (payload as { failureCategory?: unknown }).failureCategory;
  return isWorkerFailureCategory(category) ? category : undefined;
}

/**
 * Read failureCategory from worker.failed events, newest sequence first.
 * Returns the newest classified category even when a later bare worker.failed
 * (no payload) exists — matching runner.ts after claude normalizer events.
 */
export function failureCategoryFromEvents(
  events: readonly { type: string; sequence?: number; payload?: unknown }[],
): WorkerFailureCategory | undefined {
  const failed = events
    .filter((event) => event.type === "worker.failed")
    .slice()
    .sort((left, right) => (right.sequence ?? 0) - (left.sequence ?? 0));
  for (const event of failed) {
    const category = categoryFromPayload(event.payload);
    if (category !== undefined) return category;
  }
  return undefined;
}
