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

  // When accepting, bind to the CandidateRevision that matches this verification.
  // The integration preflight will reject if the live Diff digest does not match.
  let candidateRevisionId: string | undefined;
  let acceptedPatchDigest: string | undefined;
  if (input.decision === "accept") {
    const revision = resolveRevisionForAttempt(events, attempt.id, verification.sequence);
    if (
      revision !== undefined
      && revision.taskId === taskId
      && candidateRevisionMatchesCurrentDiff(task, revision)
    ) {
      candidateRevisionId = revision.id;
      acceptedPatchDigest = revision.patchDigest;
    } else if (events.some((event) => event.type === "candidate.revision.captured")) {
      throw new Error(
        "main review accept requires the current Diff to match the latest CandidateRevision for this Attempt",
      );
    }
    // Legacy: no revision available — accept without digest binding.
    // Integration preflight will still verify the diff but cannot enforce
    // revision-digest binding for legacy tasks.
  }

  const decision: MainReviewDecision = {
    decision: input.decision,
    reason,
    attemptId: attempt.id,
    verificationEventSequence: verification.sequence,
    ...(candidateRevisionId === undefined ? {} : { candidateRevisionId }),
    ...(acceptedPatchDigest === undefined ? {} : { acceptedPatchDigest }),
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
