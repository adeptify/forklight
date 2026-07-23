// Transport-neutral exchange-receipt capture wrapper.
//
// Turns transient transport-specific representations into canonical
// count-only receipts and persists them best-effort to the supplied
// StateStore, while preserving the wrapped operation's identity and
// behaviour.  The MCP adapter, the CLI adapter, and any future
// transport share this single fail-open implementation; only the
// transport name, success-surface extractor, error-surface renderer,
// and task-id source differ between callers.
//
// Hard guarantees:
//   - The wrapped operation sees no input mutation, no stdout change,
//     no stderr change, and no thrown-error identity change.
//   - The raw request, feedback, output, or error text is never
//     persisted; only redacted count-only measurements survive.
//   - Capture is best-effort: any capture-time failure emits a single
//     fixed non-sensitive stderr warning and the wrapped operation
//     continues unchanged.  Unattributable invocations (no Task id)
//     store nothing and emit no warning.

import { randomUUID } from "node:crypto";
import {
  createRedactedExchangeMeasurement,
  type RedactedExchangeMeasurement,
} from "./token-efficiency.js";
import { StateStore } from "../state/store.js";

// --- Public types ----------------------------------------------------------

export type CaptureTransport = "mcp" | "cli";

export type TaskIdSource = string | (() => string | undefined);

/** Transient representation of a transport's success surface(s).
 *  `primary` becomes the canonical `responseContent` measurement;
 *  `secondary` becomes `responseStructured` and is only populated for
 *  transports that expose two independent may-overlap surfaces. */
export interface CaptureSuccessSurfaces {
  readonly primary?: string;
  readonly secondary?: string;
}

export interface ExchangeCaptureParams {
  readonly transport: CaptureTransport;
  readonly operation: string;
  readonly home: string;
  readonly taskId: TaskIdSource;
  readonly args: unknown;
  readonly invoke: () => Promise<unknown>;
  /** Render the transient success surfaces from the unwrapped result.
   *  Called only when invoke resolves.  Each returned string is
   *  consumed by a single measurement then discarded. */
  readonly renderSuccess: (result: unknown) => CaptureSuccessSurfaces;
  /** Render the transient error surface from a thrown error.
   *  Called only when invoke rejects.  Returned string is consumed
   *  by a single measurement then discarded. */
  readonly renderError: (error: unknown) => string;
}

// --- Internal sentinel ----------------------------------------------------

/** Internal marker — never observed by callers; the wrapper converts
 *  every capture-time failure into the fixed warning and silently
 *  returns / rethrows. */
class CaptureUnavailable extends Error {}

// --- Serialization helpers -------------------------------------------------

function trySerialize(value: unknown): string {
  let text: string | undefined;
  try { text = JSON.stringify(value); } catch { throw new CaptureUnavailable("serialization threw"); }
  if (text === undefined) throw new CaptureUnavailable("serialization returned undefined");
  return text;
}

function resolveTaskId(source: TaskIdSource): string | undefined {
  if (typeof source === "string") return source;
  try {
    const value = source();
    return typeof value === "string" && value.length > 0 ? value : undefined;
  } catch { return undefined; }
}

// --- Measurement builders --------------------------------------------------

function buildRequestMeasurement(
  args: unknown, operation: string, taskId: string, capturedAt: string,
): RedactedExchangeMeasurement {
  return createRedactedExchangeMeasurement(
    trySerialize(args), "request", operation, taskId, capturedAt,
  );
}

function buildResponseMeasurement(
  surface: string | undefined, operation: string, taskId: string, capturedAt: string,
): RedactedExchangeMeasurement | undefined {
  if (surface === undefined) return undefined;
  return createRedactedExchangeMeasurement(
    surface, "response", operation, taskId, capturedAt,
  );
}

// --- Persistence -----------------------------------------------------------

interface PersistShape {
  readonly id: string;
  readonly taskId: string;
  readonly operation: string;
  readonly transport: CaptureTransport;
  readonly capturedAt: string;
  readonly outcome: "success" | "error";
  readonly requestArguments: RedactedExchangeMeasurement;
  readonly responseRelationship: "may-overlap";
  readonly responseContent?: RedactedExchangeMeasurement;
  readonly responseStructured?: RedactedExchangeMeasurement;
}

function persistReceipt(
  home: string, taskId: string, operation: string, transport: CaptureTransport,
  capturedAt: string, outcome: "success" | "error",
  request: RedactedExchangeMeasurement,
  responseContent: RedactedExchangeMeasurement | undefined,
  responseStructured: RedactedExchangeMeasurement | undefined,
): void {
  const shape: PersistShape = {
    id: randomUUID(), taskId, operation, transport,
    capturedAt, outcome, requestArguments: request,
    responseRelationship: "may-overlap",
    ...(responseContent !== undefined ? { responseContent } : {}),
    ...(responseStructured !== undefined ? { responseStructured } : {}),
  };
  const store = new StateStore(home);
  try { store.saveExchangeReceipt(shape); } finally { store.close(); }
}

// --- Fail-open warning -----------------------------------------------------

function emitCaptureWarning(transport: CaptureTransport): void {
  const label = `[forklight-${transport}] exchange receipt capture failed`;
  try { process.stderr.write(`${label}\n`); } catch { /* silent */ }
}

// --- Capture branches ------------------------------------------------------

function captureSuccess(
  result: unknown, params: ExchangeCaptureParams, taskId: string,
): void {
  const capturedAt = new Date().toISOString();
  try {
    const surfaces = params.renderSuccess(result);
    const request = buildRequestMeasurement(
      params.args, params.operation, taskId, capturedAt);
    const responseContent = buildResponseMeasurement(
      surfaces.primary, params.operation, taskId, capturedAt);
    const responseStructured = buildResponseMeasurement(
      surfaces.secondary, params.operation, taskId, capturedAt);
    persistReceipt(
      params.home, taskId, params.operation, params.transport,
      capturedAt, "success", request, responseContent, responseStructured);
  } catch { emitCaptureWarning(params.transport); }
}

function captureError(
  params: ExchangeCaptureParams, taskId: string, error: unknown,
): void {
  const capturedAt = new Date().toISOString();
  try {
    const request = buildRequestMeasurement(
      params.args, params.operation, taskId, capturedAt);
    const responseContent = buildResponseMeasurement(
      params.renderError(error), params.operation, taskId, capturedAt);
    persistReceipt(
      params.home, taskId, params.operation, params.transport,
      capturedAt, "error", request, responseContent, undefined);
  } catch { emitCaptureWarning(params.transport); }
}

// --- Public wrapper --------------------------------------------------------

/** Run an operation under the transport-neutral exchange-receipt
 *  adapter.
 *
 *  Success: returns the exact original result unchanged.  When a Task
 *  id can be resolved (post-success for `submit`-style flows, pre-known
 *  for read-style flows), a redacted count-only receipt with at most
 *  two response surfaces is persisted.
 *
 *  Failure: rethrows the exact original error object.  When a Task id
 *  was resolvable before the throw, a redacted error receipt carrying
 *  the request measurement and one responseContent measurement derived
 *  from the caller-supplied error-surface renderer is best-effort
 *  persisted.  Unattributable failures store nothing and emit no warning.
 */
export async function withExchangeReceipt(
  params: ExchangeCaptureParams,
): Promise<unknown> {
  try {
    const result = await params.invoke();
    const taskId = resolveTaskId(params.taskId);
    if (taskId !== undefined) captureSuccess(result, params, taskId);
    return result;
  } catch (error) {
    const taskId = resolveTaskId(params.taskId);
    if (taskId !== undefined) captureError(params, taskId, error);
    throw error;
  }
}
