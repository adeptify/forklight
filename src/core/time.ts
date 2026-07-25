/** Shared clock helpers — one implementation for core + daemon. */

export function isoTimestamp(): string {
  return new Date().toISOString();
}

export function sleepMs(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
