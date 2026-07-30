import type { StateStore } from "../state/store.js";
import type {
  MainReviewDecision,
  MainReviewDecisionKind,
  VerificationResult,
} from "./types.js";
import {
  candidateRevisionMatchesCurrentDiff,
  resolveRevisionForAttempt,
  isDecision,
  latestVerificationEvent,
  latestMainReview,
} from "./candidate-revision.js";

export { latestMainReview };

export const MAIN_REVIEW_REASON_MAX_LENGTH = 1000;

function verificationPassed(payload: unknown): payload is VerificationResult {
  return payload !== null
    && typeof payload === "object"
    && (payload as { passed?: unknown }).passed === true;
}

function hasRevisionHistory(
  events: ReadonlyArray<{ type: string }>,
): boolean {
  return events.some((event) => event.type === "candidate.revision.captured");
}

/**
 * Bind modern Main decisions to the exact CandidateRevision for the current
 * Attempt + verification when revision evidence exists. Legacy Tasks without
 * revision history remain unbound.
 */
function resolveRevisionBinding(
  store: StateStore,
  taskId: string,
  decision: MainReviewDecisionKind,
  attemptId: string,
  verificationSequence: number,
): { candidateRevisionId?: string; acceptedPatchDigest?: string } {
  const task = store.getTask(taskId);
  const events = store.listEvents(taskId);
  const modernHistory = hasRevisionHistory(events);
  // Accept always attempts binding (legacy fall-through when no history).
  // Revise/reject bind only when modern revision history exists.
  if (decision !== "accept" && !modernHistory) {
    return {};
  }
  const revision = resolveRevisionForAttempt(events, attemptId, verificationSequence);
  if (
    revision !== undefined
    && revision.taskId === taskId
    && candidateRevisionMatchesCurrentDiff(task, revision)
  ) {
    return {
      candidateRevisionId: revision.id,
      acceptedPatchDigest: revision.patchDigest,
    };
  }
  if (modernHistory) {
    throw new Error(
      decision === "accept"
        ? "main review accept requires the current Diff to match the latest CandidateRevision for this Attempt"
        : "main review requires the current Diff to match the exact CandidateRevision for this Attempt and verification",
    );
  }
  // Legacy: no revision available — decision without digest binding.
  // Integration preflight will still verify the diff but cannot enforce
  // revision-digest binding for legacy tasks.
  return {};
}

export function recordMainReview(
  store: StateStore,
  taskId: string,
  input: { decision: MainReviewDecisionKind; reason: string; confirm: true },
): MainReviewDecision {
  if (input.confirm !== true) throw new Error("main review requires confirm: true");
  if (!isDecision(input.decision)) throw new Error("main review decision is invalid");
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > MAIN_REVIEW_REASON_MAX_LENGTH) {
    throw new Error(
      `main review reason must be 1-${MAIN_REVIEW_REASON_MAX_LENGTH} characters`,
    );
  }
  const task = store.getTask(taskId);
  const events = store.listEvents(taskId);
  const verification = latestVerificationEvent(events);
  if (verification === undefined || verification.attemptId === undefined) {
    throw new Error("main review requires independent verification evidence");
  }
  if (input.decision === "accept" && !verificationPassed(verification.payload)) {
    throw new Error("main review accept requires passing independent verification");
  }
  if (
    task.currentAttemptId !== undefined
    && verification.attemptId !== task.currentAttemptId
  ) {
    throw new Error("main review verification does not belong to the current Attempt");
  }
  const attempt = store.getAttempt(verification.attemptId);
  if (attempt.taskId !== taskId) {
    throw new Error("main review Attempt does not belong to Task");
  }

  const binding = resolveRevisionBinding(
    store,
    taskId,
    input.decision,
    attempt.id,
    verification.sequence,
  );

  const decision: MainReviewDecision = {
    decision: input.decision,
    reason,
    attemptId: attempt.id,
    verificationEventSequence: verification.sequence,
    ...(binding.candidateRevisionId === undefined
      ? {}
      : { candidateRevisionId: binding.candidateRevisionId }),
    ...(binding.acceptedPatchDigest === undefined
      ? {}
      : { acceptedPatchDigest: binding.acceptedPatchDigest }),
  };
  store.addEvent(
    taskId,
    attempt.id,
    "main-review.completed",
    `Main agent review: ${input.decision}`,
    decision,
  );
  return decision;
}
