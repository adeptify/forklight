/**
 * Runtime budget resolution for Task submit/validate surfaces (CLI YAML + MCP).
 * `null` means unlimited (no Claude `--max-budget-usd` flag). Omitted fields inherit
 * the effective execution default without collapsing null via `??`.
 * See FL-D92: MCP must accept explicit null unlimited budget.
 */

type MaxBudgetSource =
  | "explicit-null"
  | "explicit-finite"
  | "inherited-null"
  | "inherited-finite";

export interface MaxBudgetResolution {
  maxBudgetUsd: number | null;
  source: MaxBudgetSource;
  /** True when Claude runtime receives `--max-budget-usd`. False for unlimited null. */
  generatesRuntimeFlag: boolean;
}

/**
 * Resolve an optional MCP/CLI budget field against the effective default.
 * Uses `=== undefined` (not `??`) so explicit `null` is never replaced by the default.
 */
export function resolveMaxBudgetUsd(
  explicit: number | null | undefined,
  inheritedDefault: number | null,
): MaxBudgetResolution {
  if (explicit === null) {
    return { maxBudgetUsd: null, source: "explicit-null", generatesRuntimeFlag: false };
  }
  if (typeof explicit === "number") {
    return {
      maxBudgetUsd: explicit,
      source: "explicit-finite",
      generatesRuntimeFlag: true,
    };
  }
  if (inheritedDefault === null) {
    return { maxBudgetUsd: null, source: "inherited-null", generatesRuntimeFlag: false };
  }
  return {
    maxBudgetUsd: inheritedDefault,
    source: "inherited-finite",
    generatesRuntimeFlag: true,
  };
}
