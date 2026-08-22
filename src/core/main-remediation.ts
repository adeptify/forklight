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
  RemediationAcceptanceAmendment,
  RemediationAcceptanceBasis,
  RemediationAmendmentEvidence,
  RemediationAmendmentReasonCode,
  RemediationCheckRecord,
  RemediationDisposition,
  TaskRecord,
  VerificationCommandResult,
  VerificationResult,
} from "./types.js";

// --- Constants ---

export const REMEDIATION_REASON_MAX_LENGTH = 1000;
export const REMEDIATION_COMMAND_MAX_LENGTH = 4000;
export const REMEDIATION_MAX_REPLACEMENTS = 50;
export const REMEDIATION_AMENDMENT_REASON_CODE: RemediationAmendmentReasonCode =
  "contradictory-acceptance";

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

function isVerificationResult(payload: unknown): payload is VerificationResult {
  return payload !== null
    && typeof payload === "object"
    && Array.isArray((payload as VerificationResult).commands);
}

function commandFailed(command: VerificationCommandResult): boolean {
  return command.exitCode !== 0 || command.timedOut === true;
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

/**
 * Amendments always require the latest Main review to be revise and bound to
 * the current Attempt plus the exact verification event. Rejects before any
 * source copy, Shell run, or durable check is started.
 */
function amendmentBindingError(
  store: StateStore,
  task: TaskRecord,
  amendment: RemediationAcceptanceAmendment,
): string | undefined {
  const events = store.listEvents(task.id);
  const verificationEvent = latestEvent(events, "verification.completed");
  if (verificationEvent === undefined) {
    return "acceptance amendment requires independent verification evidence";
  }
  if (
    !Number.isSafeInteger(amendment.verificationEventSequence)
    || amendment.verificationEventSequence < 1
  ) {
    return "acceptance amendment verificationEventSequence must be a positive integer";
  }
  if (amendment.verificationEventSequence !== verificationEvent.sequence) {
    return "acceptance amendment references a stale verification event";
  }

  const reviewEvent = latestEvent(events, "main-review.completed");
  const review = latestMainReview(events);
  if (
    reviewEvent === undefined
    || review === undefined
    || !Number.isSafeInteger(review.verificationEventSequence)
    || review.verificationEventSequence < 1
  ) {
    return "acceptance amendment requires a valid Main revise review";
  }
  if (review.decision !== "revise") {
    return "acceptance amendment requires a Main revise decision";
  }
  if (
    task.currentAttemptId === undefined
    || review.attemptId !== task.currentAttemptId
    || reviewEvent.attemptId !== task.currentAttemptId
  ) {
    return "acceptance amendment review does not belong to the current Attempt";
  }
  if (verificationEvent.attemptId !== task.currentAttemptId) {
    return "acceptance amendment verification does not belong to the current Attempt";
  }
  if (review.verificationEventSequence !== verificationEvent.sequence) {
    return "acceptance amendment review references a stale verification event";
  }
  return undefined;
}

export interface ValidatedAcceptanceAmendment {
  verificationEventSequence: number;
  reasonCode: RemediationAmendmentReasonCode;
  replacements: Array<{ originalCommand: string; replacementCommand: string }>;
  amendedCommands: string[];
  amendedCommandCount: number;
}

function isNonEmptyCommandText(value: string): boolean {
  return value.trim().length >= 1
    && value.length <= REMEDIATION_COMMAND_MAX_LENGTH;
}

/**
 * Parse optional Main acceptance amendment from CLI/daemon/MCP structured input.
 * Rejects free-text shapes and unknown fields with fixed privacy-safe errors
 * (never echoes attacker-controlled field names or command text). Enforces
 * trimmed non-empty commands and the 4000-character bound before mutation.
 */
export function parseRemediationAmendmentInput(
  value: unknown,
): RemediationAcceptanceAmendment | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("amendment must be a non-null object");
  }
  const input = value as Record<string, unknown>;
  const allowed = new Set(["verificationEventSequence", "reasonCode", "replacements"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    // Fixed message: never interpolate unknown field names.
    throw new Error("amendment contains unknown fields");
  }
  if (
    !Number.isSafeInteger(input.verificationEventSequence)
    || (input.verificationEventSequence as number) < 1
  ) {
    throw new Error("amendment.verificationEventSequence must be a positive integer");
  }
  if (input.reasonCode !== REMEDIATION_AMENDMENT_REASON_CODE) {
    throw new Error("amendment.reasonCode must be contradictory-acceptance");
  }
  if (!Array.isArray(input.replacements) || input.replacements.length < 1) {
    throw new Error("amendment.replacements must be a non-empty array");
  }
  if (input.replacements.length > REMEDIATION_MAX_REPLACEMENTS) {
    throw new Error(
      `amendment.replacements allows at most ${REMEDIATION_MAX_REPLACEMENTS} entries`,
    );
  }
  const replacements: Array<{ originalCommand: string; replacementCommand: string }> = [];
  for (const entry of input.replacements) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("amendment replacements must be structured command pairs");
    }
    const pair = entry as Record<string, unknown>;
    const pairAllowed = new Set(["originalCommand", "replacementCommand"]);
    if (Object.keys(pair).some((key) => !pairAllowed.has(key))) {
      // Fixed message: never interpolate unknown field names.
      throw new Error("amendment replacement contains unknown fields");
    }
    if (typeof pair.originalCommand !== "string" || !isNonEmptyCommandText(pair.originalCommand)) {
      throw new Error(
        `amendment.originalCommand must be 1-${REMEDIATION_COMMAND_MAX_LENGTH} non-whitespace characters`,
      );
    }
    if (
      typeof pair.replacementCommand !== "string"
      || !isNonEmptyCommandText(pair.replacementCommand)
    ) {
      throw new Error(
        `amendment.replacementCommand must be 1-${REMEDIATION_COMMAND_MAX_LENGTH} non-whitespace characters`,
      );
    }
    if (pair.originalCommand === pair.replacementCommand) {
      throw new Error("amendment.replacementCommand must differ from originalCommand");
    }
    replacements.push({
      originalCommand: pair.originalCommand,
      replacementCommand: pair.replacementCommand,
    });
  }
  return {
    verificationEventSequence: input.verificationEventSequence as number,
    reasonCode: REMEDIATION_AMENDMENT_REASON_CODE,
    replacements,
  };
}

/**
 * Validate a Main acceptance amendment against the latest verification event.
 * Returns a derived amended suite that preserves every originally passing
 * command byte-for-byte and in order. Each originalCommand must match exactly
 * one failed verification slot. Rejects before execution on any invariant
 * violation. Error messages never echo command text, paths, or reason text.
 */
export function validateAcceptanceAmendment(
  store: StateStore,
  task: TaskRecord,
  amendment: RemediationAcceptanceAmendment,
): ValidatedAcceptanceAmendment {
  const bindingError = amendmentBindingError(store, task, amendment);
  if (bindingError !== undefined) {
    throw new Error(bindingError);
  }

  if (amendment.reasonCode !== REMEDIATION_AMENDMENT_REASON_CODE) {
    throw new Error(
      `acceptance amendment reasonCode must be ${REMEDIATION_AMENDMENT_REASON_CODE}`,
    );
  }

  if (!Array.isArray(amendment.replacements) || amendment.replacements.length < 1) {
    throw new Error("acceptance amendment requires at least one command replacement");
  }
  if (amendment.replacements.length > REMEDIATION_MAX_REPLACEMENTS) {
    throw new Error(
      `acceptance amendment allows at most ${REMEDIATION_MAX_REPLACEMENTS} replacements`,
    );
  }

  const events = store.listEvents(task.id);
  const verificationEvent = latestEvent(events, "verification.completed");
  if (verificationEvent === undefined || !isVerificationResult(verificationEvent.payload)) {
    throw new Error("acceptance amendment requires independent verification evidence");
  }
  const originalCommands = verificationEvent.payload.commands;
  if (originalCommands.length < 1) {
    throw new Error("acceptance amendment requires verification commands");
  }

  const seenOriginals = new Set<string>();
  // Map failed-slot index → replacement command (exact one-to-one slots).
  const slotReplacements = new Map<number, string>();
  const normalizedReplacements: Array<{
    originalCommand: string;
    replacementCommand: string;
  }> = [];

  for (const entry of amendment.replacements) {
    if (
      entry === null
      || typeof entry !== "object"
      || typeof entry.originalCommand !== "string"
      || typeof entry.replacementCommand !== "string"
    ) {
      throw new Error("acceptance amendment replacements must be structured command pairs");
    }
    const originalCommand = entry.originalCommand;
    const replacementCommand = entry.replacementCommand;
    if (!isNonEmptyCommandText(originalCommand)) {
      throw new Error(
        `acceptance amendment originalCommand must be 1-${REMEDIATION_COMMAND_MAX_LENGTH} non-whitespace characters`,
      );
    }
    if (!isNonEmptyCommandText(replacementCommand)) {
      throw new Error(
        `acceptance amendment replacementCommand must be 1-${REMEDIATION_COMMAND_MAX_LENGTH} non-whitespace characters`,
      );
    }
    if (originalCommand === replacementCommand) {
      throw new Error(
        "acceptance amendment replacementCommand must differ from originalCommand",
      );
    }
    if (seenOriginals.has(originalCommand)) {
      throw new Error("acceptance amendment originalCommand must appear only once");
    }
    seenOriginals.add(originalCommand);

    // Exact-slot binding: command text is the only selector exposed to Main,
    // so it must identify exactly one verification slot in the whole suite.
    // A mixed pass/fail duplicate is still ambiguous and must fail closed.
    const matchingSlotIndexes: number[] = [];
    for (let index = 0; index < originalCommands.length; index += 1) {
      const command = originalCommands[index]!;
      if (command.command !== originalCommand) continue;
      matchingSlotIndexes.push(index);
    }
    if (matchingSlotIndexes.length === 0) {
      throw new Error(
        "acceptance amendment originalCommand must exactly match a failed verification command",
      );
    }
    if (matchingSlotIndexes.length !== 1) {
      throw new Error(
        "acceptance amendment originalCommand must match exactly one failed verification slot",
      );
    }
    const slotIndex = matchingSlotIndexes[0]!;
    if (!commandFailed(originalCommands[slotIndex]!)) {
      throw new Error("acceptance amendment cannot replace a passing command");
    }
    slotReplacements.set(slotIndex, replacementCommand);
    normalizedReplacements.push({ originalCommand, replacementCommand });
  }

  // Derive the amended suite in place: only the bound failed slots may change;
  // every originally passing command remains byte-for-byte identical and ordered.
  const amendedCommands = originalCommands.map((command, index) => {
    const replacement = slotReplacements.get(index);
    if (replacement !== undefined) return replacement;
    return command.command;
  });

  // Invariant: every originally passing command remains byte-for-byte identical.
  for (let index = 0; index < originalCommands.length; index += 1) {
    const original = originalCommands[index]!;
    if (!commandFailed(original) && amendedCommands[index] !== original.command) {
      throw new Error("acceptance amendment must preserve every passing command exactly");
    }
  }

  return {
    verificationEventSequence: verificationEvent.sequence,
    reasonCode: REMEDIATION_AMENDMENT_REASON_CODE,
    replacements: normalizedReplacements,
    amendedCommands,
    amendedCommandCount: normalizedReplacements.length,
  };
}

function hasPassingDisposition(store: StateStore, taskId: string): boolean {
  return store.getRemediationDisposition(taskId) !== undefined;
}

const activeVerifications = new Set<string>();

// --- Core operation ---

interface RemediationVerifyInput {
  taskId: string;
  reason: string;
  confirm: true;
  /** Optional Main acceptance amendment. Absent = original acceptance suite. */
  amendment?: RemediationAcceptanceAmendment;
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

/** Compact public disposition fields only — never command text or private reason. */
function compactRemediationDisposition(
  disposition: RemediationDisposition,
): RemediationDisposition {
  const acceptanceBasis: RemediationAcceptanceBasis =
    disposition.acceptanceBasis === "amended-acceptance"
      ? "amended-acceptance"
      : "original-acceptance";
  if (acceptanceBasis === "amended-acceptance") {
    return {
      status: "verified-repaired-delivered",
      checkId: disposition.checkId,
      createdAt: disposition.createdAt,
      acceptanceBasis: "amended-acceptance",
      amendedCommandCount: disposition.amendedCommandCount ?? 0,
      reasonCode: disposition.reasonCode ?? REMEDIATION_AMENDMENT_REASON_CODE,
    };
  }
  // Legacy and original-acceptance: keep status/checkId/createdAt; optional basis.
  return {
    status: "verified-repaired-delivered",
    checkId: disposition.checkId,
    createdAt: disposition.createdAt,
    ...(disposition.acceptanceBasis === undefined
      ? {}
      : { acceptanceBasis: "original-acceptance" }),
  };
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
    ...(result.disposition === undefined
      ? {}
      : { disposition: compactRemediationDisposition(result.disposition) }),
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

  // 4. Validate optional acceptance amendment before any mutation.
  let validatedAmendment: ValidatedAcceptanceAmendment | undefined;
  if (input.amendment !== undefined) {
    validatedAmendment = validateAcceptanceAmendment(store, task, input.amendment);
  }

  // 5. Duplicate pass: reject before executing commands
  if (hasPassingDisposition(store, input.taskId)) {
    throw new Error("Task already has a passing remediation disposition");
  }
  if (activeVerifications.has(input.taskId)) {
    throw new Error("Task already has a remediation verification in progress");
  }
  activeVerifications.add(input.taskId);

  // 6. Copy current source into an isolated verification container (project
  // cwd + any declared sibling package mirrors). Always delete the full
  // owned cleanup root so sibling mirrors are never leaked beside /tmp.
  let verifyEnv: Awaited<ReturnType<typeof copyForVerification>> | undefined;
  const commands: VerificationCommandResult[] = [];
  let verificationPassed = true;
  const suite =
    validatedAmendment === undefined
      ? task.spec.acceptance.commands
      : validatedAmendment.amendedCommands;

  try {
    // Persist check-started event after the single-flight guard is held.
    store.addEvent(
      input.taskId,
      undefined,
      "remediation.check.started",
      "Main remediation verification started",
      {
        reasonLength: reason.length,
        ...(validatedAmendment === undefined
          ? { acceptanceBasis: "original-acceptance" as const }
          : {
              acceptanceBasis: "amended-acceptance" as const,
              amendedCommandCount: validatedAmendment.amendedCommandCount,
              reasonCode: validatedAmendment.reasonCode,
              verificationEventSequence: validatedAmendment.verificationEventSequence,
            }),
      },
    );
    verifyEnv = await copyForVerification(
      task.sourcePath,
      task.spec.workspace.exclude,
    );
    const { env: verificationEnvironment, shellGitPrefix } =
      await verifierProcessEnvironment(task, verifyEnv.projectCwd);

    // 7. Run every suite command against the isolated current-source copy
    for (const command of suite) {
      const response = await runCaptured(
        "/bin/zsh",
        ["-lc", shellGitPrefix + command],
        {
          cwd: verifyEnv.projectCwd,
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

      if (response.exitCode !== 0 || response.timedOut) verificationPassed = false;
    }
  } finally {
    // 8. Always clean up the full owned isolation container
    if (verifyEnv !== undefined) {
      await rm(verifyEnv.cleanupRoot, { recursive: true, force: true });
    }
    activeVerifications.delete(input.taskId);
  }

  // 9. Build and persist the check record (private amendment evidence when present)
  const checkStatus = verificationPassed ? "passed" : "failed";
  const amendmentEvidence: RemediationAmendmentEvidence | undefined =
    validatedAmendment === undefined
      ? undefined
      : {
          verificationEventSequence: validatedAmendment.verificationEventSequence,
          reasonCode: validatedAmendment.reasonCode,
          replacements: validatedAmendment.replacements,
          amendedCommands: validatedAmendment.amendedCommands,
        };
  const checkRecord: RemediationCheckRecord = {
    id: randomUUID(),
    taskId: input.taskId,
    status: checkStatus,
    reason,
    commands,
    ...(amendmentEvidence === undefined ? {} : { amendment: amendmentEvidence }),
    createdAt: timestamp(),
  };

  // 10. Derive final disposition only from a passing check
  let disposition: RemediationDisposition | undefined;
  if (checkStatus === "passed") {
    disposition = validatedAmendment === undefined
      ? {
          status: "verified-repaired-delivered",
          checkId: checkRecord.id,
          createdAt: checkRecord.createdAt,
          acceptanceBasis: "original-acceptance",
        }
      : {
          status: "verified-repaired-delivered",
          checkId: checkRecord.id,
          createdAt: checkRecord.createdAt,
          acceptanceBasis: "amended-acceptance",
          amendedCommandCount: validatedAmendment.amendedCommandCount,
          reasonCode: validatedAmendment.reasonCode,
        };
  }
  store.saveRemediationOutcome(checkRecord, disposition);

  // 11. Persist check-completed event (privacy-safe: no stdout/stderr/reason/commands)
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
      ...(validatedAmendment === undefined
        ? { acceptanceBasis: "original-acceptance" as const }
        : {
            acceptanceBasis: "amended-acceptance" as const,
            amendedCommandCount: validatedAmendment.amendedCommandCount,
            reasonCode: validatedAmendment.reasonCode,
          }),
    },
  );

  return { check: checkRecord, ...(disposition === undefined ? {} : { disposition }) };
}
