/**
 * Shared parse guards used by Task Contract and Work Plan loaders.
 * Keeps label-prefixed errors identical across producers.
 */

export function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function requireNonEmptyString(
  value: unknown,
  label: string,
  fallback?: string,
): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export function requireStringArray(
  value: unknown,
  label: string,
  fallback: string[] = [],
): string[] {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  return value.map((item) => (item as string).trim());
}
