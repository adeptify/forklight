/**
 * Contract-infeasible classification (M2 long-running loop).
 *
 * When independent acceptance proves the Task Contract itself is contradictory
 * or incomplete under the current boundary, ForkLight must stop same-policy
 * Worker retry / adaptation and return control to Main to revise the contract.
 *
 * This module is pure: no I/O, no Provider calls, no Task mutation.
 * Privacy: reason codes only — no paths, prompts, diffs, or raw command text.
 */

/** Stable privacy-safe reason codes for a contract-infeasible terminal. */
export type ContractInfeasibleReason =
  | "undeclared-dependency"
  | "contradictory-acceptance"
  | "scope-boundary-conflict";

/** Codes Main, verification, or fixtures may supply without free-text parsing. */
export const CONTRACT_INFEASIBLE_REASON_CODES = [
  "contract-infeasible",
  "undeclared-dependency",
  "contradictory-acceptance",
  "scope-boundary-conflict",
] as const;

interface ContractInfeasibilityAssessment {
  /** True when the current contract cannot be satisfied under the same boundary. */
  infeasible: boolean;
  reason?: ContractInfeasibleReason;
  /** Present only when infeasible — use as durable failureCategory. */
  failureCategory?: "contract-infeasible";
  /** Privacy-safe human summary for events and Hub. */
  summary: string;
}

const CODE_SET = new Set<string>(CONTRACT_INFEASIBLE_REASON_CODES);

function mapCode(code: string): ContractInfeasibleReason {
  if (code === "undeclared-dependency") return "undeclared-dependency";
  if (code === "scope-boundary-conflict") return "scope-boundary-conflict";
  // contract-infeasible and contradictory-acceptance both map to acceptance contradiction.
  return "contradictory-acceptance";
}

/**
 * Classify whether independent acceptance / Main evidence proves the Task
 * Contract is infeasible under the current boundary.
 *
 * Rules:
 * - A passed verification is never contract-infeasible.
 * - Only explicit privacy-safe reason codes trigger infeasibility (no free-text
 *   guessing from command output or Worker claims).
 * - When infeasible, same-policy retry and policy adaptation must stop; Main
 *   must revise the contract boundary.
 */
export function assessContractInfeasibility(input: {
  verificationPassed: boolean;
  /** Privacy-safe reason codes only. Unknown codes are ignored. */
  reasonCodes?: readonly string[];
}): ContractInfeasibilityAssessment {
  if (input.verificationPassed) {
    return {
      infeasible: false,
      summary: "Independent verification passed; contract remains feasible.",
    };
  }
  const matched = (input.reasonCodes ?? []).filter((code) => CODE_SET.has(code));
  if (matched.length === 0) {
    return {
      infeasible: false,
      summary: "No contract-infeasible evidence codes were supplied.",
    };
  }
  const reason = mapCode(matched[0]!);
  return {
    infeasible: true,
    reason,
    failureCategory: "contract-infeasible",
    summary:
      "Task Contract cannot be satisfied under the current boundary. "
      + "Do not retry with the same effective policy. Main must revise scope, "
      + "dependencies, or acceptance before another Attempt.",
  };
}

/** True when a classified failure category forbids same-policy Worker retry. */
export function blocksSamePolicyRetry(
  failureCategory: string | undefined,
): boolean {
  return failureCategory === "contract-infeasible";
}

/** Privacy-safe rejection message for extra-attempt / adaptation callers. */
export function samePolicyRetryBlockedMessage(
  failureCategory: string | undefined,
): string {
  if (failureCategory !== "contract-infeasible") {
    return "same-policy retry is allowed for this failure category";
  }
  return (
    "Task is contract-infeasible under the current boundary. "
    + "Same-policy retry and adaptation are blocked. "
    + "Main must revise the Task Contract (scope, dependencies, or acceptance)."
  );
}
