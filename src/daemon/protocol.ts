export type DaemonMethod =
  | "health"
  | "validate_file"
  | "submit_file"
  | "reuse_task_class"
  | "submit"
  | "status"
  | "inspect"
  | "task_decision"
  | "checkpoint_run"
  | "resume"
  | "main_review"
  | "main_failure_attribution"
  | "main_failure_attribution_projection"
  | "revise"
  | "list"
  | "list_summaries"
  | "list_history_page"
  | "plan_submit_file"
  | "plan_board"
  | "plan_board_overview"
  | "statistics"
  | "settings_get"
  | "settings_update"
  | "settings_apply_file"
  | "settings_reset"
  | "integration_preflight"
  | "integration_apply"
  | "integration_status"
  | "integration_wait"
  | "integration_activation_complete"
  | "integration_history"
  | "competition_submit_file"
  | "competition_submit"
  | "competition_status"
  | "competition_compare"
  | "competition_list"
  | "competition_main_decision"
  | "competition_retained_partial"
  | "competition_handoff"
  | "provider_status"
  | "provider_probe"
  | "task_economics"
  | "economics_summary"
  | "routing_evidence_coverage"
  | "direct_codex_capture"
  | "direct_codex_guided_capture"
  | "direct_codex_inbox"
  | "direct_codex_review"
  | "direct_codex_publication_preview"
  | "direct_codex_publication_register"
  | "adaptation_preview"
  | "adaptation_apply"
  | "activation_handoff_shutdown"
  | "remediation_verify"
  | "candidate_reverify"
  | "candidate_reverify_eligibility"
  | "correction_eligibility"
  | "correct"
  | "review_graph_create"
  | "review_graph_status"
  | "goal_submit_file"
  | "goal_status"
  | "goal_list"
  | "goal_advance"
  | "goal_stop"
  | "goal_task_handoff"
  | "model_routing"
  | "task_resolve"
  | "task_reopen"
  | "main_direct_start"
  | "main_direct_complete"
  | "main_direct_status"
  | "main_direct_list"
  | "main_direct_aggregate"
  | "main_direct_recent"
  | "self_upgrade_evidence"
  | "task_plan_context"
  | "work_hierarchy"
  | "outcome_intake_create"
  | "outcome_intake_list"
  | "outcome_intake_get"
  | "outcome_intake_propose"
  | "outcome_intake_confirm"
  | "shutdown";

export interface DaemonRequest {
  id: string;
  method: DaemonMethod;
  params?: Record<string, unknown>;
  clientIdentity: BuildIdentity;
}

export interface DaemonResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  serverIdentity: BuildIdentity;
  warning?: string;
}

const READ_ONLY_METHODS = new Set<DaemonMethod>([
  "health",
  "validate_file",
  "status",
  "inspect",
  "task_decision",
  "list",
  "list_summaries",
  "list_history_page",
  "plan_board",
  "plan_board_overview",
  "statistics",
  "settings_get",
  "integration_status",
  "integration_wait",
  "integration_history",
  "competition_status",
  "competition_compare",
  "competition_list",
  "provider_status",
  "task_economics",
  "direct_codex_inbox",
  "direct_codex_publication_preview",
  "adaptation_preview",
  "candidate_reverify_eligibility",
  "correction_eligibility",
  "review_graph_status",
  "goal_status",
  "goal_list",
  "economics_summary",
  "routing_evidence_coverage",
  "model_routing",
  "main_failure_attribution_projection",
  "main_direct_status",
  "main_direct_list",
  "main_direct_aggregate",
  "main_direct_recent",
  "self_upgrade_evidence",
  "task_plan_context",
  "work_hierarchy",
  "outcome_intake_list",
  "outcome_intake_get",
]);

function isMutatingDaemonMethod(method: DaemonMethod): boolean {
  return !READ_ONLY_METHODS.has(method);
}

export function requiresMatchingBuildIdentity(method: DaemonMethod): boolean {
  return isMutatingDaemonMethod(method) && method !== "shutdown" && method !== "activation_handoff_shutdown";
}

/** Closed lifecycle intent for graceful Daemon shutdown.
 *  Omitted or legacy clients default to ordinary stop (no auto-resume). */
export type DaemonShutdownIntent = "stop" | "restart";

/** Parse shutdown intent. Unknown values fail closed; omit/null means stop. */
export function parseDaemonShutdownIntent(value: unknown): DaemonShutdownIntent {
  if (value === undefined || value === null) return "stop";
  if (value === "stop" || value === "restart") return value;
  throw new Error("shutdown intent must be stop or restart");
}

import type { BuildIdentity } from "../core/build-identity.js";
