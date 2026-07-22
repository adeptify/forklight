export type DaemonMethod =
  | "health"
  | "submit_file"
  | "submit"
  | "status"
  | "inspect"
  | "resume"
  | "list"
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
