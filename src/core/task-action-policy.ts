/**
 * FL-109C1: canonical, closed Task action policy (read-side).
 *
 * Projects one privacy-safe, deterministic action policy per Task card so the
 * Hub can tell, for every one of the seven destination columns, which existing
 * durable ForkLight operation may be requested, what exact follow-up input or
 * confirmation that operation still needs, and why every other drop target is
 * an explanatory no-op.
 *
 * Boundaries:
 *   - Read-only: never executes an operation and never edits Task state.
 *   - Names only existing durable operations; never a generic status patch.
 *   - Unknown or incomplete evidence fails closed so no destination can invent
 *     a status mutation.
 *
 * The Daemon remains the final authority for every request: this projection
 * only reports what the durable Store evidence supports.
 */
import type { StateStore } from "../state/store.js";
import { checkReviseEligibility } from "./runner.js";
import { resolveCorrectionEligibility } from "./candidate-revision.js";
import { latestMainReview } from "./main-review.js";
import type { BoardReason, BoardScope } from "./task-summary.js";
import type { TaskResolutionState } from "./task-resolution.js";
import type { DecisionStage, TaskStatus } from "./types.js";
import type { WorkHierarchyColumnCode } from "./work-hierarchy.js";

/** Versioned closed policy schema. Bump only on a breaking shape change. */
export const TASK_ACTION_POLICY_SCHEMA_VERSION = 1 as const;

/** Existing durable ForkLight operations the policy is allowed to name. */
export type TaskActionOperation =
  | "resume"
  | "correct"
  | "revise"
  | "main_review"
  | "integration_preflight"
  | "integration_apply"
  | "task_resolve"
  | "task_reopen";

/** Fixed Main-review intent encoded into a requestable operation. */
export type TaskActionIntent = "accept" | "revise" | "reject";

/** One ordered existing-operation step toward a destination column. */
export interface TaskActionPathStep {
  operation: TaskActionOperation;
  /** Exact follow-up request fields that step still needs (e.g. receiptId). */
  requires: readonly string[];
}

/** Bounded disposition for one destination column. */
export type TaskActionDisposition =
  | "requestable"
  | "needs-input"
  | "automatic-only"
  | "no-op";

/** Stable privacy-safe reason code. Never carries prompt, path, error, or log text. */
export type TaskActionReasonCode =
  | "already-there"
  | "already-delivered"
  | "delivered-backward-blocked"
  | "dependency-held"
  | "automatic-progression"
  | "no-operation"
  | "requires-reopen-first"
  | "requires-main-accept"
  | "requires-verification"
  | "requires-reason-confirm"
  | "requires-feedback"
  | "requires-preflight-then-apply"
  | "requires-receipt-confirm"
  | "resume-returns-to-ready"
  | "correct-reuses-candidate"
  | "reopen-returns-now"
  | "resolve-closes-failure"
  | "allowance-exhausted"
  | "already-past"
  | "not-eligible"
  | "unknown-evidence"
  | "goal-gate-satisfied";

/** One bounded destination-column disposition. */
export interface TaskDestinationPolicy {
  column: WorkHierarchyColumnCode;
  disposition: TaskActionDisposition;
  /** Existing durable operation name; present only for requestable/needs-input. */
  operation?: TaskActionOperation;
  /** Exact follow-up request fields the immediate operation still needs. */
  requires?: readonly string[];
  /** Fixed Main-review intent encoded into the operation (e.g. main_review accept). */
  intent?: TaskActionIntent;
  /** Ordered existing-operation path toward the destination (machine-readable). */
  path?: readonly TaskActionPathStep[];
  reason: TaskActionReasonCode;
  /** Bounded, privacy-safe human explanation (no prompts, paths, errors, logs). */
  explanation: string;
}

/** Closed action policy carried by every WorkHierarchyTaskCard. */
export interface TaskActionPolicy {
  schemaVersion: 1;
  /** Bounded single truthful next checkpoint for the whole Task. */
  nextCheckpoint: string;
  destinations: Record<WorkHierarchyColumnCode, TaskDestinationPolicy>;
}

export interface TaskActionPolicyInput {
  taskId: string;
  status: TaskStatus | undefined;
  decisionStage?: DecisionStage;
  boardScope?: BoardScope;
  boardReason?: BoardReason;
  dependenciesSatisfied: boolean;
  /** Durable delivered/activated/repaired-delivered outcome evidence. */
  delivered: boolean;
  resolutionState: TaskResolutionState;
  /** Column the card currently sits in (from the canonical hierarchy mapper). */
  currentColumn: WorkHierarchyColumnCode;
  /** True when the card is complete in its Goal lane because the configured
   *  Goal milestone gate is satisfied. Broader Task-wide review or Integration
   *  may still be open; it must never be presented as required here. */
  planGateSatisfied?: boolean;
}

// ---------------------------------------------------------------------------
// Bounded builders
// ---------------------------------------------------------------------------

interface EntryParams {
  column: WorkHierarchyColumnCode;
  disposition: TaskActionDisposition;
  reason: TaskActionReasonCode;
  explanation: string;
  operation?: TaskActionOperation;
  requires?: readonly string[];
  intent?: TaskActionIntent;
  path?: readonly TaskActionPathStep[];
}

function makeEntry(params: EntryParams): TaskDestinationPolicy {
  return {
    column: params.column,
    disposition: params.disposition,
    reason: params.reason,
    explanation: params.explanation,
    ...(params.operation === undefined ? {} : { operation: params.operation }),
    ...(params.requires === undefined ? {} : { requires: params.requires }),
    ...(params.intent === undefined ? {} : { intent: params.intent }),
    ...(params.path === undefined ? {} : { path: params.path }),
  };
}

function requestable(
  column: WorkHierarchyColumnCode,
  operation: TaskActionOperation,
  requires: readonly string[],
  reason: TaskActionReasonCode,
  explanation: string,
  intent?: TaskActionIntent,
  path?: readonly TaskActionPathStep[],
): TaskDestinationPolicy {
  return makeEntry({
    column,
    disposition: "requestable",
    operation,
    requires,
    reason,
    explanation,
    ...(intent === undefined ? {} : { intent }),
    ...(path === undefined ? {} : { path }),
  });
}

function needsInput(
  column: WorkHierarchyColumnCode,
  operation: TaskActionOperation,
  requires: readonly string[],
  reason: TaskActionReasonCode,
  explanation: string,
  intent?: TaskActionIntent,
  path?: readonly TaskActionPathStep[],
): TaskDestinationPolicy {
  return makeEntry({
    column,
    disposition: "needs-input",
    operation,
    requires,
    reason,
    explanation,
    ...(intent === undefined ? {} : { intent }),
    ...(path === undefined ? {} : { path }),
  });
}

function automatic(
  column: WorkHierarchyColumnCode,
  reason: TaskActionReasonCode,
  explanation: string,
): TaskDestinationPolicy {
  return makeEntry({ column, disposition: "automatic-only", reason, explanation });
}

function noop(
  column: WorkHierarchyColumnCode,
  reason: TaskActionReasonCode,
  explanation: string,
): TaskDestinationPolicy {
  return makeEntry({ column, disposition: "no-op", reason, explanation });
}

/** One closed no-op destination for a card complete in its Goal lane. */
function goalCompleteEntry(column: WorkHierarchyColumnCode): TaskDestinationPolicy {
  return noop(
    column,
    "goal-gate-satisfied",
    column === "completed"
      ? "This Plan item is complete because its Goal milestone gate is satisfied; broader Task review is optional and outside this Goal."
      : "A Goal-complete Plan item cannot move to another column.",
  );
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/**
 * Convert durable Task evidence into a closed per-column action policy.
 *
 * Fail-closed invariants:
 *  - A dependency-held Task can never be made Ready by a manual request.
 *  - A delivered Task can never move backward.
 *  - Unknown/contradictory evidence offers no requestable mutation.
 */
export function projectTaskActionPolicy(
  store: StateStore,
  input: TaskActionPolicyInput,
): TaskActionPolicy {
  const {
    taskId,
    status,
    decisionStage,
    dependenciesSatisfied: deps,
    delivered,
    resolutionState,
    currentColumn,
  } = input;

  // A Goal-gate satisfied card is complete in its Goal lane. Every destination
  // is a closed no-op: no required Main decision, integration, or card move may
  // be offered for a milestone the Goal already declared satisfied.
  if (input.planGateSatisfied === true) {
    return {
      schemaVersion: TASK_ACTION_POLICY_SCHEMA_VERSION,
      nextCheckpoint: "This Plan item is complete for its Goal; no Goal action is required.",
      destinations: {
        "not-started": goalCompleteEntry("not-started"),
        ready: goalCompleteEntry("ready"),
        running: goalCompleteEntry("running"),
        "waiting-verification": goalCompleteEntry("waiting-verification"),
        "waiting-user-decision": goalCompleteEntry("waiting-user-decision"),
        completed: goalCompleteEntry("completed"),
        "stopped-failed": goalCompleteEntry("stopped-failed"),
      },
    };
  }

  const resolved = resolutionState.status === "resolved";
  const events = store.listEvents(taskId);
  const latestVerification = events
    .filter((event) => event.type === "verification.completed")
    .at(-1);
  const verificationPayload = latestVerification?.payload;
  const verificationPassed = verificationPayload !== null
    && typeof verificationPayload === "object"
    && !Array.isArray(verificationPayload)
    && (verificationPayload as { passed?: unknown }).passed === true;
  const latestReview = latestMainReview(events);
  const reviewAcceptCurrent = latestReview !== undefined
    && latestReview.decision === "accept"
    && latestVerification !== undefined
    && latestReview.verificationEventSequence === latestVerification.sequence;
  // Authoritative Decision Stage signals that Main has already accepted a
  // Candidate and integration is pending even when event parsing is partial.
  const stageDeliveryPending = decisionStage === "ready-for-integration"
    || decisionStage === "integrating"
    || decisionStage === "applied-not-activated";
  const stageAwaitingMain = decisionStage === "awaiting-main-review"
    || decisionStage === "machine-verified";

  const isSucceeded = status === "succeeded";
  const isFailed = status === "failed" || status === "interrupted";

  // Frozen attempt allowance is authoritative: resume and revise are only
  // offered while the Task's immutable baseMaxAttempts leaves room and no
  // Attempt is running. A legacy Task without a frozen snapshot fails closed.
  const attempts = store.listAttempts(taskId);
  const attemptCount = attempts.length;
  const attemptsRunning = attempts.some((attempt) => attempt.status === "running");
  const baseMaxAttempts = store.getTask(taskId).effectivePolicy?.values.baseMaxAttempts;
  const allowanceDefined = baseMaxAttempts !== undefined;
  const allowanceRemains = allowanceDefined && attemptCount < (baseMaxAttempts as number);
  const resumeEligible = isFailed && !resolved && !attemptsRunning && allowanceRemains;

  // Reuse the existing revise eligibility helper with the frozen base allowance.
  // The daemon queue state stays Daemon authority. The probe feedback is never
  // forwarded.
  const reviseProvable = allowanceDefined
    && !attemptsRunning
    && (() => {
      try {
        return checkReviseEligibility(store, taskId, "x", baseMaxAttempts as number).eligible;
      } catch {
        return false;
      }
    })();

  // Retained-Candidate correction eligibility is authoritative for `correct`.
  // When provable, `correct` is preferred over resume/revise for Ready.
  const correctionEligible = (() => {
    try {
      return resolveCorrectionEligibility(store, taskId).eligible;
    } catch {
      return false;
    }
  })();

  const destinations: Record<WorkHierarchyColumnCode, TaskDestinationPolicy> = {
    "not-started": notStartedEntry(),
    ready: readyEntry(),
    running: runningEntry(),
    "waiting-verification": waitingVerificationEntry(),
    "waiting-user-decision": waitingUserDecisionEntry(),
    completed: completedEntry(),
    "stopped-failed": stoppedFailedEntry(),
  };

  return {
    schemaVersion: TASK_ACTION_POLICY_SCHEMA_VERSION,
    nextCheckpoint: nextCheckpoint(),
    destinations,
  };

  function notStartedEntry(): TaskDestinationPolicy {
    if (delivered) {
      return noop(
        "not-started",
        "delivered-backward-blocked",
        "Delivered Tasks cannot move backward to Not started.",
      );
    }
    if (currentColumn === "not-started") {
      return noop("not-started", "already-there", "This Task is already in Not started.");
    }
    return noop(
      "not-started",
      "no-operation",
      "Not started is a dependency hold state; no operation moves a Task into it.",
    );
  }

  function readyEntry(): TaskDestinationPolicy {
    if (currentColumn === "ready") {
      return noop("ready", "already-there", "This Task is already in Ready.");
    }
    if (delivered) {
      return noop(
        "ready",
        "delivered-backward-blocked",
        "Delivered Tasks cannot move backward to Ready.",
      );
    }
    if (!deps) {
      return automatic(
        "ready",
        "dependency-held",
        "This Task is held by unsatisfied prerequisites; it becomes Ready automatically when they are satisfied.",
      );
    }
    if (isFailed) {
      if (resolved) {
        return noop(
          "ready",
          "requires-reopen-first",
          "Reopen the handled Task before it can be made Ready again.",
        );
      }
      if (correctionEligible) {
        return needsInput(
          "ready",
          "correct",
          ["feedback", "confirm"],
          "correct-reuses-candidate",
          "Correction re-queues the retained Candidate toward Ready with feedback and confirmation.",
        );
      }
      if (resumeEligible) {
        return requestable(
          "ready",
          "resume",
          [],
          "resume-returns-to-ready",
          "Resume re-queues the failed Task toward Ready.",
        );
      }
      if (!allowanceDefined) {
        return noop(
          "ready",
          "not-eligible",
          "Resume eligibility cannot be proven without a frozen attempt allowance.",
        );
      }
      if (attemptsRunning) {
        return noop(
          "ready",
          "not-eligible",
          "An Attempt is currently running; resume is not available.",
        );
      }
      return noop(
        "ready",
        "allowance-exhausted",
        "The frozen attempt allowance is exhausted; resume is not available.",
      );
    }
    if (isSucceeded) {
      if (correctionEligible) {
        return needsInput(
          "ready",
          "correct",
          ["feedback", "confirm"],
          "correct-reuses-candidate",
          "Correction re-queues the retained Candidate toward Ready with feedback and confirmation.",
        );
      }
      if (reviseProvable) {
        return needsInput(
          "ready",
          "revise",
          ["feedback"],
          "requires-feedback",
          "Revise returns the Task to Ready with explicit feedback.",
          "revise",
        );
      }
      if (!allowanceDefined) {
        return noop(
          "ready",
          "not-eligible",
          "Revise eligibility cannot be proven without a frozen attempt allowance.",
        );
      }
      if (allowanceRemains) {
        return noop(
          "ready",
          "not-eligible",
          "This Task is not eligible for revision under the current durable workflow.",
        );
      }
      return noop(
        "ready",
        "allowance-exhausted",
        "The frozen attempt allowance is exhausted; revise is not available.",
      );
    }
    return noop(
      "ready",
      "already-past",
      "This Task is already at or past Ready.",
    );
  }

  function runningEntry(): TaskDestinationPolicy {
    if (currentColumn === "running") {
      return noop("running", "already-there", "This Task is already Running.");
    }
    if (delivered) {
      return noop(
        "running",
        "delivered-backward-blocked",
        "Delivered Tasks cannot move backward to Running.",
      );
    }
    return automatic(
      "running",
      "automatic-progression",
      "The scheduler starts a Task when a Worker slot is available; no manual request exists.",
    );
  }

  function waitingVerificationEntry(): TaskDestinationPolicy {
    if (currentColumn === "waiting-verification") {
      return noop(
        "waiting-verification",
        "already-there",
        "This Task is already waiting for verification.",
      );
    }
    if (delivered) {
      return noop(
        "waiting-verification",
        "delivered-backward-blocked",
        "Delivered Tasks cannot move backward to verification.",
      );
    }
    return automatic(
      "waiting-verification",
      "automatic-progression",
      "Independent verification runs automatically after the Worker completes; no manual request exists.",
    );
  }

  function waitingUserDecisionEntry(): TaskDestinationPolicy {
    if (currentColumn === "waiting-user-decision") {
      return noop(
        "waiting-user-decision",
        "already-there",
        "This Task already awaits a Main decision.",
      );
    }
    if (delivered) {
      return noop(
        "waiting-user-decision",
        "delivered-backward-blocked",
        "Delivered Tasks cannot move backward to a Main decision.",
      );
    }
    if (status === "verifying") {
      return automatic(
        "waiting-user-decision",
        "automatic-progression",
        "After verification completes, the Task automatically awaits a Main decision.",
      );
    }
    if (isSucceeded && (latestVerification !== undefined || stageAwaitingMain)) {
      return automatic(
        "waiting-user-decision",
        "automatic-progression",
        "A verified Task automatically awaits a Main decision; no manual request exists.",
      );
    }
    return noop(
      "waiting-user-decision",
      "no-operation",
      "No operation moves this Task to the Main decision column.",
    );
  }

  function completedEntry(): TaskDestinationPolicy {
    if (delivered) {
      return noop(
        "completed",
        "already-delivered",
        "This Task has a durable delivered outcome.",
      );
    }
    if (currentColumn === "completed") {
      return noop("completed", "already-there", "This Task is already Completed.");
    }
    if ((isSucceeded && reviewAcceptCurrent) || stageDeliveryPending) {
      return requestable(
        "completed",
        "integration_preflight",
        [],
        "requires-preflight-then-apply",
        "Integration is two-step: run preflight, then apply with an explicit confirmed receipt. This requests the path; it does not directly change the column.",
        undefined,
        [
          { operation: "integration_preflight", requires: [] },
          { operation: "integration_apply", requires: ["receiptId", "confirm"] },
        ],
      );
    }
    if (isSucceeded && (verificationPassed || stageAwaitingMain)) {
      return needsInput(
        "completed",
        "main_review",
        ["reason", "confirm"],
        "requires-main-accept",
        "Main acceptance is required first; completion then requires preflight and a confirmed apply. This requests the path; it does not directly change the column.",
        "accept",
      );
    }
    if (isFailed) {
      return noop(
        "completed",
        "no-operation",
        "A failed Task cannot move directly to Completed.",
      );
    }
    if (status === "verifying" || status === "running" || status === "preparing") {
      return noop(
        "completed",
        "requires-verification",
        "This Task must be verified and Main-reviewed before completion.",
      );
    }
    if (isSucceeded) {
      return noop(
        "completed",
        "unknown-evidence",
        "No verified delivery evidence is available; this Task cannot be completed.",
      );
    }
    return noop("completed", "no-operation", "No operation moves this Task to Completed.");
  }

  function stoppedFailedEntry(): TaskDestinationPolicy {
    if (delivered) {
      return noop(
        "stopped-failed",
        "delivered-backward-blocked",
        "Delivered Tasks cannot move backward to Stopped/failed.",
      );
    }
    if (currentColumn === "stopped-failed") {
      if (resolved) {
        return requestable(
          "stopped-failed",
          "task_reopen",
          ["confirm"],
          "reopen-returns-now",
          "Reopen returns the handled Task from History to Now.",
        );
      }
      if (isFailed) {
        return needsInput(
          "stopped-failed",
          "task_resolve",
          ["reason", "confirm"],
          "resolve-closes-failure",
          "Resolve closes the failed Task as handled; the column stays Stopped/failed.",
        );
      }
      return noop("stopped-failed", "already-there", "This Task is already in Stopped/failed.");
    }
    if (
      isSucceeded
      && (latestVerification !== undefined || stageAwaitingMain)
      && !reviewAcceptCurrent
      && !stageDeliveryPending
    ) {
      return needsInput(
        "stopped-failed",
        "main_review",
        ["reason", "confirm"],
        "requires-reason-confirm",
        "Main rejection moves the Task to Stopped/failed.",
        "reject",
      );
    }
    return noop(
      "stopped-failed",
      "no-operation",
      "No operation moves this Task to Stopped/failed.",
    );
  }

  function nextCheckpoint(): string {
    if (delivered) return "This Task is delivered; no further action is required.";
    if (currentColumn === "not-started" && !deps) {
      return "Wait for the Task prerequisites to be satisfied.";
    }
    if (isFailed) {
      if (resolved) {
        return "Reopen the handled Task to return it to Now, or leave it closed.";
      }
      if (correctionEligible) {
        return "Correct the retained Candidate toward Ready, or resolve it as handled.";
      }
      if (resumeEligible) {
        return "Resume the failed Task toward Ready, or resolve it as handled.";
      }
      if (attemptsRunning) {
        return "Wait for the active Attempt to finish, or review the contradictory Task evidence.";
      }
      return "No retry request is currently available; resolve the failure as handled or review its evidence.";
    }
    if (isSucceeded && (reviewAcceptCurrent || stageDeliveryPending)) {
      return "Run integration preflight, then apply with an explicit confirmed receipt.";
    }
    if (isSucceeded) return "Main must review this Task; record a decision with a reason.";
    if (status === "preparing" || status === "running") {
      return "The Worker is executing; wait for completion.";
    }
    if (status === "verifying") return "Independent verification is running.";
    if (currentColumn === "ready") return "This Task is Ready for a Worker slot.";
    return "No manual action is required right now.";
  }
}
