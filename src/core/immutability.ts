/**
 * Canonical deep-freeze used across core projections: freezes every reachable
 * object/array in place and returns the input value for chaining.
 * Already-frozen values are skipped entirely (matching the per-module copies
 * this consolidates), so partially-frozen inputs keep their frozen shape.
 */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
