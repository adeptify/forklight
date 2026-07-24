export type DaemonMethod =
  | "health"
  | "submit_file"
  | "submit"
  | "status"
  | "inspect"
  | "task_decision"
  | "checkpoint_run"
  | "resume"
  | "main_review"
  | "revise"
  | "list"
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
  | "console_start"
  | "console_status"
  | "console_stop"
  | "provider_status"
  | "provider_probe"
  | "task_economics"
  | "direct_codex_capture"
  | "direct_codex_inbox"
  | "direct_codex_review"
  | "direct_codex_publication_preview"
  | "direct_codex_publication_register"
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
  "status",
  "inspect",
  "task_decision",
  "list",
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
  "console_status",
  "provider_status",
  "task_economics",
  "direct_codex_inbox",
  "direct_codex_publication_preview",
]);

export function isMutatingDaemonMethod(method: DaemonMethod): boolean {
  return !READ_ONLY_METHODS.has(method);
}

export function requiresMatchingBuildIdentity(method: DaemonMethod): boolean {
  return isMutatingDaemonMethod(method) && method !== "shutdown";
}
import type { BuildIdentity } from "../core/build-identity.js";
