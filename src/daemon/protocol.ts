export type DaemonMethod =
  | "health"
  | "submit_file"
  | "submit"
  | "status"
  | "inspect"
  | "resume"
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
  | "shutdown";

export interface DaemonRequest {
  id: string;
  method: DaemonMethod;
  params?: Record<string, unknown>;
}

export interface DaemonResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}
