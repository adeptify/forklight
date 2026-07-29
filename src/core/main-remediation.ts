import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import type { StateStore } from "../state/store.js";
import { copyForVerification } from "./integration-verification-copy.js";
import { latestMainReview } from "./main-review.js";
import { runCaptured } from "./process.js";
import { isoTimestamp as timestamp } from "./time.js";
import { verifierProcessEnvironment } from "../workspace/verifier-git.js";
import type {
  EventRecord,
  RemediationCheckRecord,
  RemediationDisposition,
  TaskRecord,
  VerificationCommandResult,
} from "./types.js";

// --- Constants ---

export const REMEDIATION_REASON_MAX_LENGTH = 1000;

// --- Validation ---

function latestEvent(
  events: readonly EventRecord[],
  type: EventRecord["type"],
): EventRecord | undefined {
  return events
    .filter((event) => event.type === type)
    .reduce<EventRecord | undefined>(
      (latest, event) => latest === undefined || event.sequence > latest.sequence
        ? event
        : latest,
      undefined,
    );
}

/**
 * Failed/interrupted Tasks keep their historical remediation path. A machine-
 * successful Task is eligible only when the latest typed Main review says
 * `revise` for the current Attempt and the latest independent verification.
 * Every rejection is decided before commands or durable remediation records.
 */
function remediationEligibilityError(
  store: StateStore,
  task: TaskRecord,
): string | undefined {
  if (task.status === "failed" || task.status === "interrupted") return undefined;
  if (task.status !== "succeeded") {
    return "remediation verification requires failed or interrupted Task";
  }

  const events = store.listEvents(task.id);
  const verificationEvent = latestEvent(events, "verification.completed");
  if (verificationEvent === undefined) {
    return "remediation verification for succeeded Tasks requires independent verification evidence";
  }

  const reviewEvent = latestEvent(events, "main-review.completed");
  const review = latestMainReview(events);
  if (
    reviewEvent === undefined
    || review === undefined
    || !Number.isSafeInteger(review.verificationEventSequence)
    || review.verificationEventSequence < 1
  ) {
    return "remediation verification for succeeded Tasks requires a valid Main review";
  }
  if (review.decision !== "revise") {
    return "remediation verification for succeeded Tasks requires a Main revise decision";
  }
  if (
    task.currentAttemptId === undefined
    || review.attemptId !== task.currentAttemptId
    || reviewEvent.attemptId !== task.currentAttemptId
  ) {
    return "remediation verification review does not belong to the current Attempt";
  }
  if (verificationEvent.attemptId !== task.currentAttemptId) {
    return "remediation verification evidence does not belong to the current Attempt";
  }
  if (review.verificationEventSequence !== verificationEvent.sequence) {
    return "remediation verification review references a stale verification event";
  }
  return undefined;
}

function hasPassingDisposition(store: StateStore, taskId: string): boolean {
  return store.getRemediationDisposition(taskId) !== undefined;
}

const activeVerifications = new Set<string>();

// --- Core operation ---

export interface RemediationVerifyInput {
  taskId: string;
  reason: string;
  confirm: true;
}

export interface RemediationVerifyResult {
  check: RemediationCheckRecord;
  disposition?: RemediationDisposition;
}

export interface RemediationVerifyView {
  check: {
    id: string;
    status: RemediationCheckRecord["status"];
    commandCount: number;
    passedCommandCount: number;
    createdAt: string;
  };
  disposition?: RemediationDisposition;
  taskStatus: TaskRecord["status"];
}

/** Public control-surface projection. Private reason, commands and outputs stay in Store. */
export function projectRemediationVerifyResult(
  result: RemediationVerifyResult,
  taskStatus: TaskRecord["status"],
): RemediationVerifyView {
  return {
    check: {
      id: result.check.id,
      status: result.check.status,
      commandCount: result.check.commands.length,
      passedCommandCount: result.check.commands.filter(
        (command) => command.exitCode === 0 && !command.timedOut,
      ).length,
      createdAt: result.check.createdAt,
    },
    ...(result.disposition === undefined ? {} : { disposition: result.disposition }),
    taskStatus,
  };
}

export async function verifyMainRemediation(
  store: StateStore,
  input: RemediationVerifyInput,
  verificationTimeoutMs: number,
): Promise<RemediationVerifyResult> {
  // 1. Confirm gate
  if (input.confirm !== true) {
    throw new Error("main remediation verification requires confirm: true");
  }

  // 2. Validate reason
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > REMEDIATION_REASON_MAX_LENGTH) {
    throw new Error(
      `remediation reason must be 1-${REMEDIATION_REASON_MAX_LENGTH} characters`,
    );
  }

  // 3. Load and validate Task
  const task = store.getTask(input.taskId);
  const eligibilityError = remediationEligibilityError(store, task);
  if (eligibilityError !== undefined) {
    throw new Error(eligibilityError);
  }

  // 4. Duplicate pass: reject before executing commands
  if (hasPassingDisposition(store, input.taskId)) {
    throw new Error("Task already has a passing remediation disposition");
  }
  if (activeVerifications.has(input.taskId)) {
    throw new Error("Task already has a remediation verification in progress");
  }
  activeVerifications.add(input.taskId);

  // 6. Copy current source to isolated verification directory
  let verifyDir: string | undefined;
  const commands: VerificationCommandResult[] = [];
  let verificationPassed = true;

  try {
    // 5. Persist check-started event after the single-flight guard is held.
    store.addEvent(
      input.taskId,
      undefined,
      "remediation.check.started",
      "Main remediation verification started",
      { reasonLength: reason.length },
    );
    verifyDir = await copyForVerification(
      task.sourcePath,
      task.spec.workspace.exclude,
    );
    const { env: verificationEnvironment, shellGitPrefix } =
      await verifierProcessEnvironment(task, verifyDir);

    // 7. Run every stored acceptance command
    for (const command of task.spec.acceptance.commands) {
      const response = await runCaptured(
        "/bin/zsh",
        ["-lc", shellGitPrefix + command],
        {
          cwd: verifyDir,
          env: verificationEnvironment,
          timeoutMs: verificationTimeoutMs,
        },
      );
      const cmdResult: VerificationCommandResult = {
        command,
        exitCode: response.exitCode,
        stdout: response.stdout,
        stderr: response.stderr,
        durationMs: response.durationMs,
        timedOut: response.timedOut,
      };
      commands.push(cmdResult);

      if (response.exitCode !== 0) verificationPassed = false;
    }
  } finally {
    // 8. Always clean up the isolated directory
    if (verifyDir !== undefined) {
      await rm(verifyDir, { recursive: true, force: true });
    }
    activeVerifications.delete(input.taskId);
  }

  // 9. Build and persist the check record
  const checkStatus = verificationPassed ? "passed" : "failed";
  const checkRecord: RemediationCheckRecord = {
    id: randomUUID(),
    taskId: input.taskId,
    status: checkStatus,
    reason,
    commands,
    createdAt: timestamp(),
  };

  // 10. Derive final disposition only from a passing check
  let disposition: RemediationDisposition | undefined;
  if (checkStatus === "passed") {
    disposition = {
      status: "verified-repaired-delivered",
      checkId: checkRecord.id,
      createdAt: checkRecord.createdAt,
    };
  }
  store.saveRemediationOutcome(checkRecord, disposition);

  // 11. Persist check-completed event (privacy-safe: no stdout/stderr/reason)
  const passedCommandCount = checkRecord.commands.filter(
    (command) => command.exitCode === 0 && !command.timedOut,
  ).length;
  store.addEvent(
    input.taskId,
    undefined,
    "remediation.check.completed",
    `Main remediation verification ${checkStatus}: ${passedCommandCount}/${checkRecord.commands.length} commands passed`,
    {
      checkId: checkRecord.id,
      status: checkStatus,
      commandCount: checkRecord.commands.length,
      passedCommandCount,
      disposition: disposition?.status ?? null,
    },
  );

  return { check: checkRecord, ...(disposition === undefined ? {} : { disposition }) };
}
