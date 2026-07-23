import type { StateStore } from "../state/store.js";
import type {
  EventRecord,
  MainReviewDecision,
  MainReviewDecisionKind,
  VerificationResult,
} from "./types.js";

export const MAIN_REVIEW_REASON_MAX_LENGTH = 1000;

function latestVerification(events: readonly EventRecord[]): EventRecord | undefined {
  return events
    .filter((event) => event.type === "verification.completed")
    .reduce<EventRecord | undefined>(
      (latest, event) => latest === undefined || event.sequence > latest.sequence ? event : latest,
      undefined,
    );
}

function verificationPassed(payload: unknown): payload is VerificationResult {
  return payload !== null
    && typeof payload === "object"
    && (payload as { passed?: unknown }).passed === true;
}

function isDecision(value: unknown): value is MainReviewDecisionKind {
  return value === "accept" || value === "revise" || value === "reject";
}

export function latestMainReview(
  events: readonly EventRecord[],
): MainReviewDecision | undefined {
  const event = events
    .filter((candidate) => candidate.type === "main-review.completed")
    .reduce<EventRecord | undefined>(
      (latest, candidate) => latest === undefined || candidate.sequence > latest.sequence
        ? candidate
        : latest,
      undefined,
    );
  if (event?.payload === null || typeof event?.payload !== "object") return undefined;
  const payload = event.payload as Partial<MainReviewDecision>;
  if (
    !isDecision(payload.decision)
    || typeof payload.reason !== "string"
    || typeof payload.attemptId !== "string"
    || typeof payload.verificationEventSequence !== "number"
  ) {
    return undefined;
  }
  return {
    decision: payload.decision,
    reason: payload.reason,
    attemptId: payload.attemptId,
    verificationEventSequence: payload.verificationEventSequence,
  };
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
  const verification = latestVerification(events);
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
  const decision: MainReviewDecision = {
    decision: input.decision,
    reason,
    attemptId: attempt.id,
    verificationEventSequence: verification.sequence,
  };
  store.addEvent(
    taskId,
    attempt.id,
    "main-review.completed",
    `Main Codex review: ${input.decision}`,
    decision,
  );
  return decision;
}
