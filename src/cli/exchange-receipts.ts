// CLI-specific surface extractor over the transport-neutral exchange
// capture wrapper.  The real parsed command arguments are accepted
// transiently, the known or post-success Task id is supplied by the
// caller, and the exact rendered stdout string (already produced once
// by the caller) is measured then persisted as a single responseContent
// surface — no responseStructured surface exists for CLI exchanges.
//
// Failure path measures the exact user-visible `ForkLight error:
// <message>\n` stderr representation that the existing top-level
// handler will print, persists the receipt best-effort, then rethrows
// the identical original error.  An unattributable failure (no Task id
// resolvable — typical for `submit` errors before the daemon returns
// a Task record) stores nothing and emits no warning.

import {
  withExchangeReceipt,
  type CaptureSuccessSurfaces,
  type TaskIdSource,
} from "../core/exchange-capture.js";
import type { TaskTokenReport } from "../core/token-report.js";

export type TaskScopedCliOperation =
  | "forklight_submit" | "forklight_status" | "forklight_wait"
  | "forklight_inspect" | "forklight_resume"
  | "forklight_integration_preflight" | "forklight_integration_apply"
  | "forklight_integration_status" | "forklight_integration_wait"
  | "forklight_integration_history" | "forklight_revise"
  | "forklight_main_review" | "forklight_main_failure_attribution" | "forklight_correct"
  | "forklight_correction_eligibility"
  | "forklight_adaptation_preview" | "forklight_adaptation_apply"
  | "forklight_remediation_verify"
  | "forklight_candidate_reverify"
  | "forklight_direct_codex_capture"
  | "forklight_resolve"
  | "forklight_reopen"
  | "forklight_storage_reclaim"
  | "forklight_storage_retain"
  | "forklight_delivery_prepare"
  | "forklight_delivery_decide";

export type { TaskIdSource };

export interface WithCliExchangeReceiptParams<T> {
  readonly operation: TaskScopedCliOperation;
  readonly home: string;
  readonly args: unknown;
  readonly taskId: TaskIdSource;
  readonly invoke: () => Promise<T>;
  /** Render the exact final stdout string the caller intends to write.
   *  The wrapper measures this same string and returns it unchanged. */
  readonly renderOutput: (result: T) => string;
}

/** Exact user-visible CLI error line that the existing top-level
 *  handler prints: `ForkLight error: <message>\n`.  The original error
 *  object is never persisted and is rethrown unchanged by the wrapper. */
function renderCliErrorSurface(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `ForkLight error: ${message}\n`;
}

/** CLI success surfaces always carry exactly one responseContent
 *  measurement (the rendered stdout).  This adapter wraps the core
 *  wrapper and supplies the pre-rendered stdout via the closure below. */
function buildCliSuccessRenderer(output: string): () => CaptureSuccessSurfaces {
  return () => ({ primary: output });
}

/** Render-once capture helper for CLI commands.
 *
 *  The caller supplies the operation's `invoke` (which may throw) and a
 *  `renderOutput` that turns the resolved result into the exact final
 *  stdout string the caller intends to write.  This helper:
 *    1. Runs `invoke`.  On success it then calls `renderOutput` once.
 *    2. Persists a redacted count-only CLI receipt carrying that exact
 *       rendered string as the single responseContent measurement
 *       (no responseStructured).
 *    3. Returns `{ result, output }` so the caller writes `output` to
 *       stdout unchanged.
 *    4. On invoke failure, persists an error receipt whose
 *       responseContent is the exact `ForkLight error: <message>\n`
 *       line the top-level handler will print, then rethrows the
 *       identical original error.
 *    5. Unattributable failures (no Task id resolvable) persist
 *       nothing and emit no warning.
 *
 *  Capture persistence or serialization failures emit only the fixed
 *  `[forklight-cli] exchange receipt capture failed` stderr warning
 *  and never change the caller's result, thrown error, stdout, or
 *  exit code. */
export async function withCliExchangeReceipt<T>(
  params: WithCliExchangeReceiptParams<T>,
): Promise<{ result: T; output: string }> {
  try {
    const result = await params.invoke();
    const output = params.renderOutput(result);
    const captured = await withExchangeReceipt({
      transport: "cli",
      operation: params.operation,
      home: params.home,
      args: params.args,
      taskId: params.taskId,
      invoke: async () => result,
      renderSuccess: buildCliSuccessRenderer(output),
      renderError: renderCliErrorSurface,
    });
    return { result: captured as T, output };
  } catch (error) {
    // Best-effort capture of the error representation.  The wrapper
    // rethrows the original error on success; on capture failure it
    // returns undefined, which we discard so the same error propagates.
    await withExchangeReceipt({
      transport: "cli",
      operation: params.operation,
      home: params.home,
      args: params.args,
      taskId: params.taskId,
      invoke: async () => { throw error; },
      renderSuccess: () => ({}),
      renderError: renderCliErrorSurface,
    }).catch(() => {/* wrapper rethrew the same error — ignore */});
    throw error;
  }
}

/** Render the Task Token-efficiency report as a truthful human block.
 *  Gross Worker volume is reported exactly when complete, with all
 *  four components and sample counts; exchange load and boundary
 *  reduction label themselves with the exact wording of the canonical
 *  estimate kind; direct-Codex savings is never substituted with
 *  Worker volume or boundary reduction, and its typed unavailable
 *  reason is preserved verbatim.  Pure — never inspects the store,
 *  never invents unavailable reasons, never collapses typed-unavailable
 *  into a misleading exact claim. */
export function humanTokenReportLines(report: TaskTokenReport): string {
  const wv = report.report.workerVolume;
  const ee = report.report.exchangeEstimate;
  const br = report.report.boundaryReduction;
  const dcs = report.report.directCodexSavings;

  const lines: string[] = [];
  lines.push(`Token report for ${report.taskId}`);
  lines.push(`Attempts: ${report.attemptCount}`);
  lines.push(`Receipts: ${report.receiptCount}`);
  lines.push("");

  lines.push(`Worker volume (${wv.kind}):`);
  lines.push(`  input: ${wv.inputTokens}`);
  lines.push(`  output: ${wv.outputTokens}`);
  lines.push(`  cacheRead: ${wv.cacheReadInputTokens}`);
  lines.push(`  cacheCreation: ${wv.cacheCreationInputTokens}`);
  lines.push(`  gross: ${wv.grossWorkerTokens} tokens across ${wv.sampleCount} samples`);
  if (wv.kind === "incomplete") {
    lines.push(`  complete samples: ${wv.completeSampleCount}`);
    lines.push(`  missing samples: ${wv.missingSampleCount}`);
  }
  lines.push("");

  lines.push(`Exchange estimate (${ee.kind}):`);
  if (ee.kind === "exact") {
    lines.push(`  exact: ${ee.tokens} tokens (source: ${ee.source})`);
  } else if (ee.kind === "range") {
    lines.push(`  range: ${ee.range.min}-${ee.range.max} tokens (method: ${ee.range.method}, confidence: ${ee.range.confidence})`);
  } else {
    lines.push(`  unavailable: ${ee.reason}`);
  }
  lines.push("");

  lines.push(`Boundary reduction (${br.available ? "available" : "unavailable"}):`);
  if (br.available) {
    lines.push(`  range: ${br.tokens.min}-${br.tokens.max} tokens (method: ${br.tokens.method}, confidence: ${br.tokens.confidence})`);
  } else {
    lines.push(`  unavailable: ${br.reason}`);
  }
  lines.push("");

  lines.push(`Direct Codex savings (${dcs.available ? "available" : "unavailable"}):`);
  if (dcs.available) {
    lines.push(`  range: ${dcs.absoluteSavings.min}-${dcs.absoluteSavings.max} tokens (method: ${dcs.absoluteSavings.method}, confidence: ${dcs.absoluteSavings.confidence})`);
    if (dcs.percentageSavings.available) {
      const ps = dcs.percentageSavings.range;
      lines.push(`  percentage: ${ps.min.toFixed(1)}-${ps.max.toFixed(1)}% (method: ${ps.method}, confidence: ${ps.confidence})`);
    } else {
      lines.push(`  percentage: unavailable (${dcs.percentageSavings.reason})`);
    }
    const bl = dcs.baseline;
    lines.push(`  baseline: ${bl.minTokens}-${bl.maxTokens} tokens (method: ${bl.method}, taskClass: ${bl.taskClass}, confidence: ${bl.confidence})`);
  } else {
    lines.push(`  unavailable: ${dcs.reason}`);
  }
  lines.push("");

  // --- Token usage reconciliation (diagnostic; never changes Worker volume) ---
  const rec = report.usageReconciliation;
  lines.push(`Token usage reconciliation (${rec.state}):`);
  lines.push(`  Compared: ${rec.comparedAttemptCount} attempt(s)`);
  lines.push(`  Matched: ${rec.matchedAttemptCount} | Mismatched: ${rec.mismatchedAttemptCount}`);
  lines.push(`  Missing breakdown: ${rec.missingBreakdownCount} | Missing usage: ${rec.missingUsageCount}`);
  lines.push(`  Invalid counter evidence: ${rec.invalidCounterEvidenceCount}`);
  lines.push(`  Worker volume source: terminal top-level (${wv.grossWorkerTokens} tokens)`);
  if (rec.grossDeltas.available) {
    const gd = rec.grossDeltas;
    lines.push(`  Compared attempts top-level gross: ${gd.topLevelGross}`);
    lines.push(`  Compared attempts per-model gross: ${gd.perModelGross}`);
    lines.push(`  Compared attempts delta (perModel - top-level): ${gd.delta >= 0 ? "+" : ""}${gd.delta}`);
  } else {
    lines.push(`  Compared attempts aggregate: unavailable (${rec.grossDeltas.reason})`);
  }
  if (rec.state === "matched") {
    lines.push("  [diagnostic] All compared attempts have identical top-level and");
    lines.push("  per-model counters.");
  } else if (rec.state === "mismatch") {
    lines.push("  [diagnostic] Top-level and per-model counters differ. The per-model");
    lines.push("  breakdown is diagnostic only — ForkLight does not add it to the");
    lines.push("  canonical Worker volume, does not treat it as a bill, and does not");
    lines.push("  claim the difference as savings or waste.");
  } else if (rec.state === "partial") {
    lines.push("  [diagnostic] Some attempts have per-model breakdowns and they match");
    lines.push("  their top-level counters. Other attempts are missing the breakdown.");
  } else if (rec.state === "unavailable") {
    lines.push("  [diagnostic] No usable top-level/per-model comparison is available.");
    lines.push("  Worker volume still uses terminal top-level usage when present.");
  }

  return `${lines.join("\n")}\n`;
}
