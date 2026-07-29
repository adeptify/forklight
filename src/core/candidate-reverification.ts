/**
 * Candidate reverification core: one bounded Main-authorized verification-only
 * pass against a failed Task's retained candidate, WITHOUT launching a Worker
 * or creating/rewriting an Attempt.
 *
 * Boundaries (product contract):
 *   - Never invoke a Worker, create an Attempt, rewrite the prior Attempt, or
 *     auto-run after a restart.
 *   - Reject policy/source failures, missing/empty candidate Diff, active
 *     execution, and competition candidates before running any command.
 *   - On pass: move only the Task status to "succeeded"; preserve the failed
 *     Attempt; a fresh Main Review accept bound to the new verification event
 *     is still required before Integration.
 *   - On failure or crash: leave the Task failed with the original candidate
 *     and failure history intact; nothing retries automatically.
 *
 * Crash-safety: the Task status is NEVER set to "verifying". The authorization
 * and start events are persisted before command execution, and the canonical
 * `verification.completed` event is persisted after. A daemon crash between
 * start and completion leaves the Task failed (status unchanged) and the
 * incomplete authorization evidence durable and inspectable. `recover()` only
 * recovers preparing/running/verifying Tasks, so this operation is invisible
 * to Worker-execution recovery.
 */
import type { StateStore } from "../state/store.js";
import type {
  AttemptRecord,
  EventRecord,
  ProvenanceSource,
  TaskRecord,
  VerificationResult,
} from "./types.js";
import { captureCandidateRevision } from "./candidate-revision.js";
import { executeVerificationPass } from "./verifier.js";
import { isoTimestamp as timestamp } from "./time.js";

// --- Constants ---

export const REVERIFICATION_REASON_MAX_LENGTH = 1000;

/**
 * Stable, privacy-safe eligibility categories. The operation throws with the
 * matching message; control surfaces never echo private candidate content or
 * command output. `eligible` is the only non-rejection category.
 */
export type CandidateReverificationEligibilityCategory =
  | "eligible"
  | "task-not-failed"
  | "competition-candidate"
  | "running-attempt"
  | "no-completed-attempt"
  | "no-failed-verification"
  | "wrong-failure-category"
  | "missing-candidate-diff"
  | "allowance-zero"
  | "allowance-exhausted";

const REJECTION_MESSAGES: Record<Exclude<CandidateReverificationEligibilityCategory, "eligible">, string> = {
  "task-not-failed": "candidate reverification requires a failed Task",
  "competition-candidate": "candidate reverification rejected: competition candidates cannot be reverified; use competition reevaluation or a new Task",
  "running-attempt": "candidate reverification rejected: Task has a running Attempt",
  "no-completed-attempt": "candidate reverification rejected: no completed Worker Attempt to reverify",
  "no-failed-verification": "candidate reverification rejected: no latest independent verification evidence for the latest Attempt",
  "wrong-failure-category": "candidate reverification rejected: latest verification failed policy or source compatibility (not behavior only); use Main correction, contract/policy revision, or a new Task",
  "missing-candidate-diff": "candidate reverification rejected: retained business candidate Diff is missing or empty; use Main correction or a new Task",
  "allowance-zero": "candidate reverification rejected: maxMainReverifications is zero; the operation is disabled",
  "allowance-exhausted": "candidate reverification rejected: maxMainReverifications allowance is exhausted",
};

/** Stable privacy-safe message for an eligibility category. Never echoes
 *  private candidate content or command output. */
function rejectionMessage(category: CandidateReverificationEligibilityCategory): string {
  if (category === "eligible") return "candidate reverification is eligible";
  return REJECTION_MESSAGES[category];
}

// --- In-process single-flight guard (mirrors main-remediation) ---

const activeReverifications = new Set<string>();

// --- Inputs and results ---

export interface CandidateReverificationAuthorization {
  taskId: string;
  /** Bounded non-empty Main reason (trimmed). */
  reason: string;
  /** Explicit confirmation. */
  confirm: true;
}

export interface CandidateReverificationAllowanceView {
  max: number;
  consumed: number;
  remaining: number;
  source: ProvenanceSource;
}

export interface CandidateReverificationEligibility {
  eligible: boolean;
  category: CandidateReverificationEligibilityCategory;
  /** The retained Attempt that would be reverified, when one exists. */
  attemptId?: string;
  /** The latest verification event sequence, when one exists for the latest Attempt. */
  verificationEventSequence?: number;
  allowance: CandidateReverificationAllowanceView;
}

export interface CandidateReverificationCostFacts {
  /** Worker invoked = no. Always false. */
  workerInvoked: false;
  /** Incremental Worker Tokens = 0. Always 0. */
  incrementalWorkerTokens: 0;
  /** Incremental model/provider runtime cost = 0. Always 0. */
  incrementalModelRuntimeCostUsd: 0;
  /** Number of original acceptance commands rerun. */
  commandCount: number;
  /** Commands that exited 0. */
  passedCommandCount: number;
  /** Sum of per-command durations (ms). */
  commandDurationMs: number;
  /** Wall time of the local verification pass (ms). Local verification time is NOT zero. */
  wallDurationMs: number;
  /** Explicit caveat: local command execution has wall time even though Worker/model cost is zero. */
  localVerificationTimeNotZero: true;
  /** Explicit caveat: the Main orchestration exchange carrying this result is not zero. */
  mainExchangeNotZero: true;
  /** Explicit caveat: no full-restart saving is claimed without a paired baseline. */
  noFullRestartSavingsClaim: true;
}

export interface CandidateReverificationResult {
  status: "passed" | "failed";
  taskId: string;
  /** The retained Attempt id (its original status is preserved, never rewritten). */
  attemptId: string;
  /** The retained Attempt status (unchanged by reverification). */
  attemptStatus: AttemptRecord["status"];
  /** Sequence of the new canonical verification.completed event. */
  verificationEventSequence: number;
  verification: VerificationResult;
  allowance: CandidateReverificationAllowanceView;
  costFacts: CandidateReverificationCostFacts;
  /** Whether a fresh Main Review accept is required before Integration. Always true. */
  requiresFreshMainAccept: true;
}

export interface CandidateReverificationView {
  status: "passed" | "failed";
  taskId: string;
  taskStatus: TaskRecord["status"];
  attemptId: string;
  attemptStatus: AttemptRecord["status"];
  verificationEventSequence: number;
  allowance: CandidateReverificationAllowanceView;
  costFacts: CandidateReverificationCostFacts;
  requiresFreshMainAccept: true;
}

// --- Helpers ---

function latestAttempt(attempts: readonly AttemptRecord[]): AttemptRecord | undefined {
  if (attempts.length === 0) return undefined;
  return attempts.reduce((latest, attempt) =>
    attempt.ordinal > latest.ordinal ? attempt : latest,
  );
}

function latestVerificationEvent(events: readonly EventRecord[]): EventRecord | undefined {
  return events
    .filter((event) => event.type === "verification.completed")
    .reduce<EventRecord | undefined>(
      (latest, event) => latest === undefined || event.sequence > latest.sequence ? event : latest,
      undefined,
    );
}

function isVerificationResult(value: unknown): value is VerificationResult {
  return value !== null
    && typeof value === "object"
    && typeof (value as { passed?: unknown }).passed === "boolean"
    && typeof (value as { behaviorPassed?: unknown }).behaviorPassed === "boolean"
    && typeof (value as { policyPassed?: unknown }).policyPassed === "boolean"
    && typeof (value as { sourceCompatible?: unknown }).sourceCompatible === "boolean";
}

function businessPatchNonEmpty(verification: VerificationResult): boolean {
  const business = verification.patches?.business;
  if (business === undefined) return false;
  return business.filesChanged > 0 || business.changedLines > 0;
}

function countAuthorizedReverifications(events: readonly EventRecord[]): number {
  return events.filter((event) => event.type === "candidate.reverification.authorized").length;
}

function resolveAllowance(
  task: TaskRecord,
  events: readonly EventRecord[],
  maxMainReverifications: number,
): CandidateReverificationAllowanceView {
  const consumed = countAuthorizedReverifications(events);
  const source: ProvenanceSource =
    task.effectivePolicy?.provenance.maxMainReverifications ?? "global";
  return {
    max: maxMainReverifications,
    consumed,
    remaining: Math.max(0, maxMainReverifications - consumed),
    source,
  };
}

// --- Eligibility (pure read; shared by UI projection and the operation) ---

/**
 * Resolve candidate-reverification eligibility for a Task without running any
 * command. Returns the stable category and the frozen allowance view. Never
 * echoes private candidate content or command output.
 */
export function resolveCandidateReverificationEligibility(
  store: StateStore,
  taskId: string,
  maxMainReverifications: number,
): CandidateReverificationEligibility {
  const task = store.getTask(taskId);
  const events = store.listEvents(taskId);
  const allowance = resolveAllowance(task, events, maxMainReverifications);

  if (task.status !== "failed") {
    return { eligible: false, category: "task-not-failed", allowance };
  }
  if (store.getCompetitionByCandidateTaskId(taskId) !== undefined) {
    return { eligible: false, category: "competition-candidate", allowance };
  }
  const attempts = store.listAttempts(taskId);
  if (attempts.some((attempt) => attempt.status === "running")) {
    return { eligible: false, category: "running-attempt", allowance };
  }
  const latest = latestAttempt(attempts);
  if (latest === undefined || (latest.status !== "succeeded" && latest.status !== "failed")) {
    return { eligible: false, category: "no-completed-attempt", allowance };
  }
  const verificationEvent = latestVerificationEvent(events);
  if (
    verificationEvent === undefined
    || verificationEvent.attemptId !== latest.id
    || !isVerificationResult(verificationEvent.payload)
  ) {
    return {
      eligible: false,
      category: "no-failed-verification",
      attemptId: latest.id,
      allowance,
    };
  }
  const verification = verificationEvent.payload as VerificationResult;
  if (
    verification.passed
    || !verification.policyPassed
    || !verification.sourceCompatible
    || verification.behaviorPassed
  ) {
    return {
      eligible: false,
      category: "wrong-failure-category",
      attemptId: latest.id,
      verificationEventSequence: verificationEvent.sequence,
      allowance,
    };
  }
  if (!businessPatchNonEmpty(verification)) {
    return {
      eligible: false,
      category: "missing-candidate-diff",
      attemptId: latest.id,
      verificationEventSequence: verificationEvent.sequence,
      allowance,
    };
  }
  if (maxMainReverifications === 0) {
    return {
      eligible: false,
      category: "allowance-zero",
      attemptId: latest.id,
      verificationEventSequence: verificationEvent.sequence,
      allowance,
    };
  }
  if (allowance.consumed >= maxMainReverifications) {
    return {
      eligible: false,
      category: "allowance-exhausted",
      attemptId: latest.id,
      verificationEventSequence: verificationEvent.sequence,
      allowance,
    };
  }
  return {
    eligible: true,
    category: "eligible",
    attemptId: latest.id,
    verificationEventSequence: verificationEvent.sequence,
    allowance,
  };
}

// --- Core operation ---

/**
 * Authorize and execute one bounded verification-only pass against the retained
 * candidate without Worker execution or Attempt mutation.
 *
 * Throws on invalid input (confirm/reason) or eligibility rejection. The
 * thrown eligibility message is the stable privacy-safe category message.
 */
export async function reverifyCandidate(
  store: StateStore,
  input: CandidateReverificationAuthorization,
  maxMainReverifications: number,
  verificationTimeoutMs: number,
): Promise<CandidateReverificationResult> {
  // 1. Confirm gate
  if (input.confirm !== true) {
    throw new Error("candidate reverification requires confirm: true");
  }

  // 2. Validate reason
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > REVERIFICATION_REASON_MAX_LENGTH) {
    throw new Error(
      `candidate reverification reason must be 1-${REVERIFICATION_REASON_MAX_LENGTH} characters`,
    );
  }

  // 3. Load Task and resolve eligibility (throws nothing here; category checked)
  const task = store.getTask(input.taskId);

  // Reuse the single-flight guard BEFORE recording any durable authorization.
  if (activeReverifications.has(input.taskId)) {
    throw new Error("Task already has a candidate reverification in progress");
  }

  const eventsBefore = store.listEvents(input.taskId);
  const allowanceBefore = resolveAllowance(task, eventsBefore, maxMainReverifications);

  const eligibility = resolveCandidateReverificationEligibility(
    store,
    input.taskId,
    maxMainReverifications,
  );
  if (!eligibility.eligible) {
    throw new Error(rejectionMessage(eligibility.category));
  }
  const attemptId = eligibility.attemptId!;
  const priorVerificationSequence = eligibility.verificationEventSequence!;

  activeReverifications.add(input.taskId);

  try {
    // 4. Persist durable authorization BEFORE running commands. Does not
    //    change Task status. A crash after this point leaves the Task failed
    //    and the authorization durable/inspectable; the allowance is consumed.
    store.addEvent(
      input.taskId,
      attemptId,
      "candidate.reverification.authorized",
      "Candidate reverification authorized",
      {
        attemptId,
        reasonLength: reason.length,
        priorVerificationSequence,
        allowanceBefore,
      },
    );

    // 5. Persist start evidence.
    const acceptanceCommandCount = task.spec.acceptance.commands.length;
    store.addEvent(
      input.taskId,
      attemptId,
      "candidate.reverification.started",
      "Candidate reverification started",
      {
        attemptId,
        acceptanceCommandCount,
        workerInvoked: false,
      },
    );

    // 6. Rerun every original acceptance command in the retained workspace and
    //    recompute patch + source evidence WITHOUT invoking a Worker. The Task
    //    status stays "failed" throughout (never set to "verifying").
    const reloaded = store.getTask(input.taskId);
    const wallStart = Date.now();
    const pass = await executeVerificationPass(
      store,
      reloaded,
      attemptId,
      verificationTimeoutMs,
    );
    const wallDurationMs = Date.now() - wallStart;
    const verification = pass.verification;

    // 7. Record the canonical verification.completed event bound to the
    //    retained (failed) Attempt. This is the authoritative evidence Main
    //    Review and Integration preflight bind to.
    const completedEvent = store.addEvent(
      input.taskId,
      attemptId,
      "verification.completed",
      pass.summary,
      verification,
    );
    const verificationEventSequence = completedEvent.sequence;

    // 7a. Capture exact Candidate Revision bound to this verification event
    // before the Task can become successful. On capture failure, keep the Task
    // failed, preserve Attempt/history, record a stable content-free failure
    // event, return failed zero-Worker facts, and never retry.
    const attempt = store.getAttempt(attemptId);
    let revisionCaptureFailed = false;
    try {
      const businessPatch = verification.patches?.business;
      await captureCandidateRevision(
        store,
        reloaded,
        attempt,
        verificationEventSequence,
        verification.passed,
        businessPatch?.affectedPaths ?? [],
        businessPatch?.filesChanged ?? 0,
        businessPatch?.changedLines ?? 0,
      );
    } catch (_captureError) {
      revisionCaptureFailed = true;
      // Record a stable content-free failure event — never expose raw paths or exceptions.
      store.addEvent(
        input.taskId,
        attemptId,
        "candidate.revision.capture.failed",
        "Candidate revision capture failed during reverification",
        {
          attemptId,
          verificationEventSequence,
          verificationPassed: verification.passed,
          workerInvoked: false,
          incrementalWorkerTokens: 0,
          incrementalModelRuntimeCostUsd: 0,
        },
      );
    }

    const commandCount = verification.commands.length;
    const passedCommandCount = verification.commands.filter(
      (command) => command.exitCode === 0 && !command.timedOut,
    ).length;
    const commandDurationMs = verification.commands.reduce(
      (sum, command) => sum + command.durationMs,
      0,
    );

    // 8. On pass AND successful revision capture: move Task to "succeeded".
    //    Preserve the retained Attempt (never rewrite it). currentAttemptId
    //    already points at the retained Attempt, so Main Review accept will
    //    bind correctly.
    //    On verification failure or capture failure: leave the Task failed.
    if (verification.passed && !revisionCaptureFailed) {
      store.setTaskStatus(input.taskId, "succeeded", {
        error: null,
        finishedAt: timestamp(),
      });
    }

    // 9. Refresh allowance (the authorization we recorded counts as consumed).
    const eventsAfter = store.listEvents(input.taskId);
    const allowanceAfter = resolveAllowance(task, eventsAfter, maxMainReverifications);

    const costFacts: CandidateReverificationCostFacts = {
      workerInvoked: false,
      incrementalWorkerTokens: 0,
      incrementalModelRuntimeCostUsd: 0,
      commandCount,
      passedCommandCount,
      commandDurationMs,
      wallDurationMs,
      localVerificationTimeNotZero: true,
      mainExchangeNotZero: true,
      noFullRestartSavingsClaim: true,
    };

    // 10. Persist completion evidence (privacy-safe: no command output/reason).
    const status: "passed" | "failed" = (verification.passed && !revisionCaptureFailed) ? "passed" : "failed";
    store.addEvent(
      input.taskId,
      attemptId,
      "candidate.reverification.completed",
      `Candidate reverification ${status}: ${passedCommandCount}/${commandCount} commands passed`,
      {
        status,
        attemptId,
        attemptStatus: attempt.status,
        verificationEventSequence,
        workerInvoked: false,
        incrementalWorkerTokens: 0,
        incrementalModelRuntimeCostUsd: 0,
        commandCount,
        passedCommandCount,
        commandDurationMs,
        wallDurationMs,
        allowance: allowanceAfter,
        requiresFreshMainAccept: true,
      },
    );

    return {
      status,
      taskId: input.taskId,
      attemptId,
      attemptStatus: attempt.status,
      verificationEventSequence,
      verification,
      allowance: allowanceAfter,
      costFacts,
      requiresFreshMainAccept: true,
    };
  } finally {
    activeReverifications.delete(input.taskId);
  }
}

/** Privacy-safe control-surface projection. Never echoes reason or command output. */
export function projectCandidateReverificationResult(
  result: CandidateReverificationResult,
  taskStatus: TaskRecord["status"],
): CandidateReverificationView {
  return {
    status: result.status,
    taskId: result.taskId,
    taskStatus,
    attemptId: result.attemptId,
    attemptStatus: result.attemptStatus,
    verificationEventSequence: result.verificationEventSequence,
    allowance: result.allowance,
    costFacts: result.costFacts,
    requiresFreshMainAccept: true,
  };
}
