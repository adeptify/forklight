/** Human-readable Integration Preflight output.
 *
 *  Pure formatter only: it consumes the canonical receipt (including the
 *  closed `applicabilityIssue` and legacy `rejectionReasons`) and produces
 *  stable human-readable lines. It never recomputes evidence or executes an
 *  action. JSON output is the canonical receipt shape and is produced by the
 *  caller via `JSON.stringify`, not here. */

/** Deterministic maximum length for each rendered technical rejection reason
 *  in the patch-not-applicable case. Raw git diagnostics can be long; bounding
 *  each reason keeps the human output readable while preserving the raw bytes
 *  in the JSON receipt for audit. Legacy receipts (without the issue) are
 *  never truncated, preserving their exact byte shape. */
export const APPLICABILITY_REASON_MAX = 200;

function boundApplicabilityReason(reason: string, max: number): string {
  if (reason.length <= max) return reason;
  return `${reason.slice(0, max - 3)}...`;
}

/** Render the human integration preflight block as a single exact string.
 *
 *  When the canonical `patch-not-applicable` issue is present, the plain
 *  explanation (what happened, what it may mean, next action) leads the body
 *  so a human sees the cautious summary before the raw rejection evidence,
 *  and each raw rejection reason is bounded to `APPLICABILITY_REASON_MAX`.
 *  Legacy receipts without the issue render exactly as before (no truncation),
 *  so their byte shape is preserved. Field order, indentation, and
 *  `"(none)"` fallbacks match the legacy output byte-for-byte for receipts
 *  without the issue. */
export function humanIntegrationPreflightLines(receipt: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(`receiptId: ${receipt.id}`);
  lines.push(`taskId: ${receipt.taskId}`);
  const reasons = receipt.rejectionReasons as string[];
  lines.push(`passed: ${reasons.length === 0}`);
  const issue = receipt.applicabilityIssue as { code?: string } | undefined;
  const hasApplicabilityIssue = issue?.code === "patch-not-applicable";
  if (hasApplicabilityIssue) {
    lines.push("patchNotApplicable:");
    lines.push(
      "  what happened: The reviewed Candidate patch no longer applies cleanly to the current source. No source was changed.",
    );
    lines.push(
      "  what it may mean: The source may have changed since the Candidate was produced, or the patch may conflict. ForkLight did not determine the exact cause.",
    );
    lines.push(
      "  next action: Compare the current source with the Candidate, decide which changes to keep, then run Preflight again. The exact conflict was not determined.",
    );
  }
  if (reasons.length > 0) {
    lines.push("rejectionReasons:");
    for (const reason of reasons) {
      const rendered = hasApplicabilityIssue
        ? boundApplicabilityReason(reason, APPLICABILITY_REASON_MAX)
        : reason;
      lines.push(`  - ${rendered}`);
    }
  }
  const files = receipt.affectedFiles as string[];
  lines.push(`affectedFiles: ${files.join(", ") || "(none)"}`);
  lines.push(`patchDigest: ${receipt.patchDigest || "(none)"}`);
  return `${lines.join("\n")}\n`;
}
