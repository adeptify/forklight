/**
 * Focused public surface for one-shot same-Judge schema-only summary repair
 * eligibility. Implementation lives with Review Graph authority so parse,
 * admission, and reconcile share one module boundary.
 */
export {
  evaluateReviewResultRepairEligibility,
  findingsEqual,
  inspectReviewResultForCredentialLabelRepair,
  inspectReviewResultForSummaryRepair,
  reconcileReviewResultRepair,
  repairReviewResult,
  sameOpinionExceptSummary,
  type RepairReviewResultInput,
  type RepairReviewResultResult,
  type ReviewResultRepairEligibility,
  type ReviewResultRepairIneligibilityCode,
  type ReviewResultRepairKind,
} from "./review-graph.js";
