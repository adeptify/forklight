// MCP-specific surface extractor over the transport-neutral exchange
// capture wrapper.  Validated tool arguments and the final MCP
// content/structuredContent surfaces — or the original thrown error's
// deterministic name+message representation on failure — are serialised
// only long enough to count UTF-8 bytes and ASCII/non-ASCII code points,
// then discarded; no substring, hash, or original value leaves this
// module.  Capture is best-effort: successful results are returned
// unchanged, failures rethrow the exact original error, persistence
// failures emit only the fixed non-sensitive stderr warning, and
// unattributable receipts are skipped rather than invented.

import {
  withExchangeReceipt,
  type CaptureSuccessSurfaces,
  type TaskIdSource,
} from "../core/exchange-capture.js";

export type TaskScopedMcpOperation =
  | "forklight_submit" | "forklight_status" | "forklight_wait" | "forklight_inspect" | "forklight_resume"
  | "forklight_integration_preflight" | "forklight_integration_apply"
  | "forklight_integration_status" | "forklight_integration_wait"
  | "forklight_integration_history" | "forklight_main_review"
  | "forklight_direct_codex_capture";

export type { TaskIdSource };

export interface WithMcpExchangeReceiptParams<T> {
  readonly operation: TaskScopedMcpOperation;
  readonly home: string;
  readonly args: unknown;
  readonly taskId: TaskIdSource;
  readonly invoke: () => Promise<T>;
}

/** Extract MCP content and structuredContent surfaces from an unknown
 *  tool result.  Each surface is JSON-serialised exactly once by the
 *  caller-supplied renderer; raw values do not survive this call. */
function extractMcpSurfaces(result: unknown): CaptureSuccessSurfaces {
  if (result === null || typeof result !== "object") return {};
  const record = result as Record<string, unknown>;
  const out: { primary?: string; secondary?: string } = {};
  if (Array.isArray(record.content)) out.primary = stringifySurface(record.content);
  if (record.structuredContent !== undefined) out.secondary = stringifySurface(record.structuredContent);
  return out;
}

function stringifySurface(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined) throw new TypeError("MCP response surface is not serializable");
  return text;
}

/** Deterministic transient representation of a thrown MCP error.
 *  The original error object is never persisted and is rethrown
 *  unchanged by the wrapper. */
function renderMcpErrorSurface(error: unknown): string {
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  return JSON.stringify({ name, message });
}

/** Run an MCP handler under the exchange-receipt adapter.
 *
 *  Success: returns the exact original tool result.  When a Task id can
 *  be resolved, a redacted success receipt with both MCP content and
 *  structuredContent measurements (may-overlap) is persisted.
 *
 *  Failure: rethrows the exact original error object.  When a Task id
 *  was resolvable before the throw, a redacted error receipt carrying
 *  requestArguments and a responseContent measurement (count-only
 *  evidence from the error's deterministic name+message representation)
 *  is best-effort persisted.  Unattributable submit failures store no
 *  receipt.
 */
export async function withMcpExchangeReceipt<T>(
  params: WithMcpExchangeReceiptParams<T>,
): Promise<T> {
  const result = await withExchangeReceipt({
    transport: "mcp",
    operation: params.operation,
    home: params.home,
    args: params.args,
    taskId: params.taskId,
    invoke: params.invoke,
    renderSuccess: extractMcpSurfaces,
    renderError: renderMcpErrorSurface,
  });
  return result as T;
}
