/**
 * Worker-owned validation-repair policy and durable round lineage.
 *
 * This module deliberately does not know how a Worker is launched.  It
 * consumes typed Worker/verification/Candidate evidence, returns one stable
 * decision, and records a separate authorization -> start -> terminal chain.
 * Main correction, generic extra Attempts, reverification, and Integration
 * authority never participate in this state machine.
 */

import { createHash, randomUUID } from "node:crypto";
import type { StateStore } from "../state/store.js";
import { maxWorkerValidationRepairsFromSnapshot } from "./advanced-policy.js";
import {
  formatVerificationDiagnostics,
  sanitizeFailedVerificationDiagnostics,
} from "./verification-diagnostic.js";
import type {
  AttemptRecord,
  CandidateRevision,
  EventRecord,
  FrozenWorkerIdentity,
  TaskRecord,
  VerificationCommandResult,
  VerificationResult,
} from "./types.js";
import type { WorkerCapabilityMatrix } from "../workers/types.js";

const MAX_FEEDBACK_LENGTH = 20_000;
const CAPABILITY_SUPPORT = new Set(["supported", "partial", "unsupported"]);
const REPAIR_TERMINAL_OUTCOMES = new Set(["passed", "failed", "stopped"]);
const REPAIR_STOP_REASONS = new Set<WorkerValidationRepairStopReason>([
  "eligible",
  "allowance-disabled",
  "allowance-exhausted",
  "round-in-progress",
  "conflicting-history",
  "worker-did-not-return-normally",
  "non-behavior-failure",
  "contract-infeasible",
  "verification-infrastructure",
  "candidate-missing",
  "candidate-not-bound",
  "source-failed",
  "policy-failed",
  "no-changed-evidence",
  "runtime-not-resumable",
  "repeated-evidence",
  "verification-passed",
]);

export type WorkerValidationRepairStopReason =
  | "eligible"
  | "allowance-disabled"
  | "allowance-exhausted"
  | "round-in-progress"
  | "conflicting-history"
  | "worker-did-not-return-normally"
  | "non-behavior-failure"
  | "contract-infeasible"
  | "verification-infrastructure"
  | "candidate-missing"
  | "candidate-not-bound"
  | "source-failed"
  | "policy-failed"
  | "no-changed-evidence"
  | "runtime-not-resumable"
  | "repeated-evidence"
  | "verification-passed";

export type WorkerValidationRepairTerminalOutcome = "passed" | "failed" | "stopped";

export interface WorkerValidationRepairHistoryEntry {
  schemaVersion: 1;
  taskId: string;
  round: number;
  authorizationEventSequence: number;
  attemptId: string;
  targetAttemptOrdinal: number;
  priorAttemptId: string;
  verificationEventSequence: number;
  candidateRevisionId: string;
  evidenceFingerprint: string;
  workerIdentity: FrozenWorkerIdentity;
  feedback: string;
  state: "authorized" | "started" | "terminal";
  terminalOutcome?: WorkerValidationRepairTerminalOutcome;
  terminalReason?: WorkerValidationRepairStopReason;
}

export interface WorkerValidationRepairDecisionInput {
  task: TaskRecord;
  attempt: AttemptRecord;
  /** Status returned by the Runtime, before independent verification. */
  workerStatus: "succeeded" | "failed" | "interrupted";
  verification?: VerificationResult;
  candidateRevision?: CandidateRevision;
  /** Exact event sequence of the verification bound to candidateRevision. */
  verificationEventSequence?: number;
  /** Durable Runtime failure class, if one was recorded. */
  workerFailureCategory?: string;
  /** Runtime capability evidence. Missing capability evidence is fail-closed. */
  runtimeCapabilities?: Pick<WorkerCapabilityMatrix, "sessionResume" | "nativeGoal">
    | { sessionResume: "supported" | "partial" | "unsupported"; nativeGoal: "supported" | "partial" | "unsupported" };
  /** Existing authorized/started/terminal rounds for this Task. */
  repairHistory?: readonly WorkerValidationRepairHistoryEntry[];
  /** Alias accepted by pure callers that already call this a history. */
  history?: readonly WorkerValidationRepairHistoryEntry[];
  /** Frozen allowance. When omitted, it is read from the immutable Task policy. */
  allowance?: number;
}

export interface WorkerValidationRepairDecision {
  eligible: boolean;
  reason: WorkerValidationRepairStopReason;
  round: number;
  allowance: number;
  consumedRounds: number;
  remainingAllowance: number;
  /** Typed evidence identity this decision evaluated. */
  taskId: string;
  attemptId: string;
  candidateRevisionId?: string;
  verificationEventSequence?: number;
  evidenceFingerprint?: string;
  failureClass?: "behavior" | "infrastructure" | "policy" | "source" | "contract" | "capture";
  nextAction: string;
}

export interface WorkerValidationRepairAuthorization {
  schemaVersion: 1;
  taskId: string;
  round: number;
  authorizationEventSequence: number;
  attemptId: string;
  targetAttemptOrdinal: number;
  priorAttemptId: string;
  verificationEventSequence: number;
  candidateRevisionId: string;
  evidenceFingerprint: string;
  workerIdentity: FrozenWorkerIdentity;
  feedback: string;
}

export interface WorkerValidationRepairExecution {
  authorization: WorkerValidationRepairAuthorization;
  started: boolean;
}

export interface WorkerValidationRepairTerminalInput {
  authorization: WorkerValidationRepairAuthorization;
  attemptId: string;
  outcome: WorkerValidationRepairTerminalOutcome;
  reason?: WorkerValidationRepairStopReason;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isCapabilitySupport(value: unknown): value is "supported" | "partial" | "unsupported" {
  return typeof value === "string" && CAPABILITY_SUPPORT.has(value);
}

function isVerificationCommand(value: unknown): value is VerificationCommandResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const command = value as Partial<VerificationCommandResult>;
  return isNonEmptyString(command.command)
    && Number.isSafeInteger(command.exitCode)
    && typeof command.stdout === "string"
    && typeof command.stderr === "string"
    && typeof command.durationMs === "number"
    && Number.isFinite(command.durationMs)
    && command.durationMs >= 0
    && typeof command.timedOut === "boolean";
}

/** Runtime validation for persisted verification evidence at the repair gate. */
export function isWorkerValidationRepairVerification(
  value: unknown,
): value is VerificationResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const verification = value as Partial<VerificationResult>;
  if (
    typeof verification.passed !== "boolean"
    || typeof verification.behaviorPassed !== "boolean"
    || typeof verification.policyPassed !== "boolean"
    || typeof verification.sourceCompatible !== "boolean"
    || !Array.isArray(verification.commands)
    || !verification.commands.every(isVerificationCommand)
    || !isNonEmptyString(verification.diffPath)
    || typeof verification.sourceUnchanged !== "boolean"
  ) return false;
  // The verifier's three booleans are an immutable typed contract. Any
  // contradictory persisted shape is infrastructure/capture evidence, never
  // an invitation to infer a behavior failure from raw output.
  if (
    verification.passed
    !== (verification.behaviorPassed && verification.policyPassed && verification.sourceCompatible)
  ) return false;
  return verification.failureCategory === undefined
    || verification.failureCategory === "contract-infeasible";
}

function workerIdentity(task: TaskRecord): FrozenWorkerIdentity {
  return {
    provider: task.spec.provider.name,
    model: task.spec.provider.model,
    runtime: task.spec.runtime.name,
    effort: task.spec.runtime.effort,
    ...(task.spec.workerProfileId === undefined
      ? {}
      : { workerProfileId: task.spec.workerProfileId }),
  };
}

function identityEqual(left: FrozenWorkerIdentity, right: FrozenWorkerIdentity): boolean {
  return left.provider === right.provider
    && left.model === right.model
    && left.runtime === right.runtime
    && left.effort === right.effort
    && left.workerProfileId === right.workerProfileId;
}

function candidateShapeValid(candidate: CandidateRevision): boolean {
  return isNonEmptyString(candidate.id)
    && isNonEmptyString(candidate.taskId)
    && isNonEmptyString(candidate.attemptId)
    && Number.isSafeInteger(candidate.attemptOrdinal)
    && candidate.attemptOrdinal > 0
    && Number.isSafeInteger(candidate.verificationEventSequence)
    && candidate.verificationEventSequence > 0
    && isDigest(candidate.patchDigest)
    && Array.isArray(candidate.affectedPaths)
    && candidate.affectedPaths.every(isNonEmptyString)
    && Number.isSafeInteger(candidate.filesChanged)
    && candidate.filesChanged >= 0
    && Number.isSafeInteger(candidate.changedLines)
    && candidate.changedLines >= 0
    && candidate.verificationPassed === false;
}

function canonicalCommand(command: VerificationCommandResult): Record<string, unknown> {
  return {
    command: command.command,
    exitCode: command.exitCode,
    timedOut: command.timedOut,
    stdout: command.stdout,
    stderr: command.stderr,
  };
}

/** Stable private fingerprint of typed verification/Candidate evidence. */
export function workerValidationEvidenceFingerprint(input: {
  taskId: string;
  attemptId: string;
  verificationEventSequence: number;
  verification: VerificationResult;
  candidateRevision: CandidateRevision;
}): string {
  const canonical = {
    behaviorPassed: input.verification.behaviorPassed,
    policyPassed: input.verification.policyPassed,
    sourceCompatible: input.verification.sourceCompatible,
    commands: input.verification.commands.map(canonicalCommand),
    patchDigest: input.candidateRevision.patchDigest,
    affectedPaths: [...input.candidateRevision.affectedPaths].sort(),
    filesChanged: input.candidateRevision.filesChanged,
    changedLines: input.candidateRevision.changedLines,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function historyEntries(input: WorkerValidationRepairDecisionInput): readonly WorkerValidationRepairHistoryEntry[] {
  return input.repairHistory ?? input.history ?? [];
}

function historyEntryShapeValid(entry: WorkerValidationRepairHistoryEntry): boolean {
  const identity = entry.workerIdentity;
  if (
    entry.schemaVersion !== 1
    || !isPositiveSafeInteger(entry.round)
    || !isPositiveSafeInteger(entry.authorizationEventSequence)
    || !isNonEmptyString(entry.taskId)
    || !isNonEmptyString(entry.attemptId)
    || !isPositiveSafeInteger(entry.targetAttemptOrdinal)
    || !isNonEmptyString(entry.priorAttemptId)
    || !isPositiveSafeInteger(entry.verificationEventSequence)
    || !isNonEmptyString(entry.candidateRevisionId)
    || !isDigest(entry.evidenceFingerprint)
    || typeof entry.feedback !== "string"
    || entry.feedback.length > MAX_FEEDBACK_LENGTH
    || identity === null
    || typeof identity !== "object"
    || !isNonEmptyString(identity.provider)
    || !isNonEmptyString(identity.model)
    || !isNonEmptyString(identity.runtime)
    || !isNonEmptyString(identity.effort)
    || (identity.workerProfileId !== undefined && !isNonEmptyString(identity.workerProfileId))
    || (entry.state !== "authorized" && entry.state !== "started" && entry.state !== "terminal")
  ) return false;
  if (entry.state === "terminal") {
    return entry.terminalOutcome !== undefined
      && REPAIR_TERMINAL_OUTCOMES.has(entry.terminalOutcome)
      && (entry.terminalReason === undefined || REPAIR_STOP_REASONS.has(entry.terminalReason));
  }
  return entry.terminalOutcome === undefined && entry.terminalReason === undefined;
}

function historyShapeValid(history: readonly WorkerValidationRepairHistoryEntry[]): boolean {
  const rounds = [...new Set(history.map((entry) => entry.round))].sort((a, b) => a - b);
  return rounds.length === history.length
    && rounds.every((round, index) => round === index + 1)
    && new Set(history.map((entry) => entry.authorizationEventSequence)).size === history.length
    && history.every(historyEntryShapeValid);
}

/** A repair decision may only consume the immutable Task acceptance suite.
 *  The verifier normally produces this exact list; rechecking it here keeps
 *  direct/coordinator callers from turning arbitrary typed command evidence
 *  into repair authority. */
function verificationCommandsMatchTask(
  task: TaskRecord,
  verification: VerificationResult,
): boolean {
  const expected = task.spec.acceptance.commands;
  return verification.commands.length === expected.length
    && verification.commands.every((command, index) => command.command === expected[index]);
}

function resumable(
  task: TaskRecord,
  capabilities: WorkerValidationRepairDecisionInput["runtimeCapabilities"],
): boolean {
  if (capabilities === undefined) return false;
  if (!isCapabilitySupport(capabilities.sessionResume) || !isCapabilitySupport(capabilities.nativeGoal)) {
    return false;
  }
  if (capabilities.sessionResume !== "unsupported") return true;
  return task.spec.executionMode === "native-goal" && capabilities.nativeGoal !== "unsupported";
}

function decision(
  input: WorkerValidationRepairDecisionInput,
  reason: WorkerValidationRepairStopReason,
  round: number,
  allowance: number,
  consumedRounds: number,
  remainingAllowance: number,
  extra: Partial<WorkerValidationRepairDecision> = {},
): WorkerValidationRepairDecision {
  // Keep the helper's source evidence explicit even though the public
  // projection currently contains only the bounded decision fields.
  void input;
  const eligible = reason === "eligible";
  return {
    eligible,
    reason,
    round,
    allowance,
    consumedRounds,
    remainingAllowance,
    taskId: input.task.id,
    attemptId: input.attempt.id,
    ...(input.candidateRevision === undefined
      ? {}
      : { candidateRevisionId: input.candidateRevision.id }),
    ...(input.verificationEventSequence === undefined
      ? {}
      : { verificationEventSequence: input.verificationEventSequence }),
    nextAction: eligible
      ? "Authorize one same-Worker validation-repair round, then independently rerun the full original acceptance suite."
      : reason === "verification-passed"
        ? "Return the verified Candidate to Main review; do not auto-accept or integrate."
        : "Stop automatic Worker repair and return this bounded evidence to Main with the recorded reason.",
    ...extra,
  };
}

/**
 * Positive-allowlist decision for automatic Worker repair. Every rejection is
 * based on typed evidence; no raw stderr/result-text parsing is performed.
 */
export function decideWorkerValidationRepair(
  input: WorkerValidationRepairDecisionInput,
): WorkerValidationRepairDecision {
  const history = historyEntries(input);
  const allowance = input.allowance ?? maxWorkerValidationRepairsFromSnapshot(input.task.effectivePolicy);
  const consumedRounds = new Set(history.map((entry) => entry.round)).size;
  const remainingAllowance = Math.max(0, allowance - consumedRounds);
  const round = consumedRounds + 1;

  if (!Number.isSafeInteger(allowance) || allowance < 0) {
    return decision(input, "conflicting-history", round, 0, consumedRounds, 0);
  }
  if (!historyShapeValid(history)) {
    return decision(input, "conflicting-history", round, allowance, consumedRounds, remainingAllowance);
  }
  if (history.some((entry) => entry.taskId !== input.task.id || !identityEqual(entry.workerIdentity, workerIdentity(input.task)))) {
    return decision(input, "conflicting-history", round, allowance, consumedRounds, remainingAllowance);
  }
  const pending = history.find((entry) => entry.state !== "terminal");
  if (pending !== undefined) {
    return decision(input, "round-in-progress", pending.round, allowance, consumedRounds, remainingAllowance);
  }
  if (allowance === 0) {
    return decision(input, "allowance-disabled", round, allowance, consumedRounds, 0);
  }
  if (remainingAllowance === 0) {
    return decision(input, "allowance-exhausted", round, allowance, consumedRounds, 0);
  }
  if (input.workerStatus !== "succeeded") {
    return decision(input, "worker-did-not-return-normally", round, allowance, consumedRounds, remainingAllowance, {
      failureClass: "infrastructure",
    });
  }
  if (input.workerFailureCategory !== undefined) {
    if (input.workerFailureCategory === "contract-infeasible") {
      return decision(input, "contract-infeasible", round, allowance, consumedRounds, remainingAllowance, {
        failureClass: "contract",
      });
    }
    return decision(input, "non-behavior-failure", round, allowance, consumedRounds, remainingAllowance, {
      failureClass: "infrastructure",
    });
  }
  const verification = input.verification;
  if (verification === undefined) {
    return decision(input, "verification-infrastructure", round, allowance, consumedRounds, remainingAllowance, {
      failureClass: "infrastructure",
    });
  }
  if (!isWorkerValidationRepairVerification(verification)) {
    return decision(input, "verification-infrastructure", round, allowance, consumedRounds, remainingAllowance, {
      failureClass: "infrastructure",
    });
  }
  if (verification.failureCategory === "contract-infeasible") {
    return decision(input, "contract-infeasible", round, allowance, consumedRounds, remainingAllowance, {
      failureClass: "contract",
    });
  }
  if (!verificationCommandsMatchTask(input.task, verification)) {
    return decision(input, "verification-infrastructure", round, allowance, consumedRounds, remainingAllowance, {
      failureClass: "infrastructure",
    });
  }
  if (verification.passed) {
    return decision(input, "verification-passed", round, allowance, consumedRounds, remainingAllowance);
  }
  if (verification.commands.some((command) => command.timedOut)) {
    return decision(input, "non-behavior-failure", round, allowance, consumedRounds, remainingAllowance, {
      failureClass: "infrastructure",
    });
  }
  if (!verification.policyPassed) {
    return decision(input, "policy-failed", round, allowance, consumedRounds, remainingAllowance, {
      failureClass: "policy",
    });
  }
  if (!verification.sourceCompatible) {
    return decision(input, "source-failed", round, allowance, consumedRounds, remainingAllowance, {
      failureClass: "source",
    });
  }
  const candidate = input.candidateRevision;
  if (candidate === undefined) {
    return decision(input, "candidate-missing", round, allowance, consumedRounds, remainingAllowance, {
      failureClass: "capture",
    });
  }
  if (
    !candidateShapeValid(candidate)
    || candidate.taskId !== input.task.id
    || candidate.attemptId !== input.attempt.id
    || candidate.attemptOrdinal !== input.attempt.ordinal
    || input.verificationEventSequence === undefined
    || !isPositiveSafeInteger(input.verificationEventSequence)
    || candidate.verificationEventSequence !== input.verificationEventSequence
  ) {
    return decision(input, "candidate-not-bound", round, allowance, consumedRounds, remainingAllowance, {
      failureClass: "capture",
    });
  }
  if (candidate.filesChanged <= 0 && candidate.changedLines <= 0 && candidate.affectedPaths.length === 0) {
    return decision(input, "no-changed-evidence", round, allowance, consumedRounds, remainingAllowance, {
      failureClass: "capture",
    });
  }
  if (!resumable(input.task, input.runtimeCapabilities)) {
    return decision(input, "runtime-not-resumable", round, allowance, consumedRounds, remainingAllowance, {
      failureClass: "infrastructure",
    });
  }
  const fingerprint = workerValidationEvidenceFingerprint({
    taskId: input.task.id,
    attemptId: input.attempt.id,
    verificationEventSequence: input.verificationEventSequence,
    verification,
    candidateRevision: candidate,
  });
  if (history.some((entry) => entry.round < round && entry.evidenceFingerprint === fingerprint)) {
    return decision(input, "repeated-evidence", round, allowance, consumedRounds, remainingAllowance, {
      evidenceFingerprint: fingerprint,
      failureClass: "behavior",
    });
  }
  return decision(input, "eligible", round, allowance, consumedRounds, remainingAllowance, {
    evidenceFingerprint: fingerprint,
    failureClass: "behavior",
  });
}

function parseHistoryEntry(event: EventRecord): WorkerValidationRepairHistoryEntry | undefined {
  if (
    event.type !== "worker.validation-repair.authorized"
    && event.type !== "worker.validation-repair.started"
    && event.type !== "worker.validation-repair.completed"
  ) return undefined;
  if (event.payload === null || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    throw new Error("worker validation-repair history is corrupt");
  }
  const p = event.payload as Record<string, unknown>;
  // The authorization event itself is the sequence authority. Its payload is
  // written atomically before the database assigns that sequence, so legacy
  // and freshly written authorization payloads may omit the duplicated field.
  const authorizationEventSequence = event.type === "worker.validation-repair.authorized"
    && p.authorizationEventSequence === undefined
    ? event.sequence
    : p.authorizationEventSequence;
  const identity = p.workerIdentity;
  if (
    p.kind !== "worker-validation-repair"
    || p.schemaVersion !== 1
    || typeof p.taskId !== "string"
    || !isPositiveSafeInteger(p.round)
    || !isPositiveSafeInteger(authorizationEventSequence)
    || typeof p.attemptId !== "string"
    || !isPositiveSafeInteger(p.targetAttemptOrdinal)
    || typeof p.priorAttemptId !== "string"
    || !isPositiveSafeInteger(p.verificationEventSequence)
    || typeof p.candidateRevisionId !== "string"
    || !isDigest(p.evidenceFingerprint)
    || identity === null
    || typeof identity !== "object"
    || Array.isArray(identity)
    || typeof (identity as Record<string, unknown>).provider !== "string"
    || typeof (identity as Record<string, unknown>).model !== "string"
    || typeof (identity as Record<string, unknown>).runtime !== "string"
    || typeof (identity as Record<string, unknown>).effort !== "string"
    || (Object.prototype.hasOwnProperty.call(identity, "workerProfileId")
      && typeof (identity as Record<string, unknown>).workerProfileId !== "string")
    || typeof p.feedback !== "string"
    || p.feedback.length > MAX_FEEDBACK_LENGTH
  ) {
    throw new Error("worker validation-repair history is corrupt");
  }
  const expectedEventAttemptId = event.type === "worker.validation-repair.authorized"
    ? p.priorAttemptId
    : p.attemptId;
  if (event.attemptId !== expectedEventAttemptId) {
    throw new Error("worker validation-repair history is corrupt");
  }
  if (
    event.type === "worker.validation-repair.authorized"
    && p.authorizationEventSequence !== undefined
    && p.authorizationEventSequence !== event.sequence
  ) {
    throw new Error("worker validation-repair history is corrupt");
  }
  const worker = identity as Record<string, unknown>;
  const base: WorkerValidationRepairHistoryEntry = {
    schemaVersion: 1,
    taskId: p.taskId,
    round: p.round,
    authorizationEventSequence,
    attemptId: p.attemptId,
    targetAttemptOrdinal: p.targetAttemptOrdinal,
    priorAttemptId: p.priorAttemptId,
    verificationEventSequence: p.verificationEventSequence,
    candidateRevisionId: p.candidateRevisionId,
    evidenceFingerprint: p.evidenceFingerprint,
    workerIdentity: {
      provider: worker.provider as string,
      model: worker.model as string,
      runtime: worker.runtime as string,
      effort: worker.effort as string,
      ...(typeof worker.workerProfileId === "string" ? { workerProfileId: worker.workerProfileId } : {}),
    },
    feedback: typeof p.feedback === "string" ? p.feedback : "",
    state: event.type === "worker.validation-repair.authorized"
      ? "authorized"
      : event.type === "worker.validation-repair.started" ? "started" : "terminal",
  };
  if (base.state === "terminal") {
    if (
      (p.outcome !== "passed" && p.outcome !== "failed" && p.outcome !== "stopped")
      || (p.reason !== undefined
        && (typeof p.reason !== "string" || !REPAIR_STOP_REASONS.has(p.reason as WorkerValidationRepairStopReason)))
    ) throw new Error("worker validation-repair history is corrupt");
    base.terminalOutcome = p.outcome as WorkerValidationRepairTerminalOutcome;
    if (typeof p.reason === "string") base.terminalReason = p.reason as WorkerValidationRepairStopReason;
  } else if (p.outcome !== undefined || p.reason !== undefined) {
    throw new Error("worker validation-repair history is corrupt");
  }
  return base;
}

function repairEntryIdentityEqual(
  left: WorkerValidationRepairHistoryEntry,
  right: WorkerValidationRepairHistoryEntry,
): boolean {
  return left.taskId === right.taskId
    && left.round === right.round
    && left.authorizationEventSequence === right.authorizationEventSequence
    && left.attemptId === right.attemptId
    && left.targetAttemptOrdinal === right.targetAttemptOrdinal
    && left.priorAttemptId === right.priorAttemptId
    && left.verificationEventSequence === right.verificationEventSequence
    && left.candidateRevisionId === right.candidateRevisionId
    && left.evidenceFingerprint === right.evidenceFingerprint
    && left.feedback === right.feedback
    && identityEqual(left.workerIdentity, right.workerIdentity);
}

function authorizationMatchesEntry(
  authorization: WorkerValidationRepairAuthorization,
  entry: WorkerValidationRepairHistoryEntry,
): boolean {
  return authorization.schemaVersion === entry.schemaVersion
    && authorization.taskId === entry.taskId
    && authorization.round === entry.round
    && authorization.authorizationEventSequence === entry.authorizationEventSequence
    && authorization.attemptId === entry.attemptId
    && authorization.targetAttemptOrdinal === entry.targetAttemptOrdinal
    && authorization.priorAttemptId === entry.priorAttemptId
    && authorization.verificationEventSequence === entry.verificationEventSequence
    && authorization.candidateRevisionId === entry.candidateRevisionId
    && authorization.evidenceFingerprint === entry.evidenceFingerprint
    && authorization.feedback === entry.feedback
    && identityEqual(authorization.workerIdentity, entry.workerIdentity);
}

/** Parse and validate one ordered, immutable repair lineage from Task events. */
export function resolveWorkerValidationRepairHistory(
  events: readonly EventRecord[],
): WorkerValidationRepairHistoryEntry[] {
  const byRound = new Map<number, WorkerValidationRepairHistoryEntry>();
  const counts = new Map<number, { authorized: number; started: number; terminal: number }>();
  const authorizationSequences = new Map<number, number>();
  let previousRepairEventSequence = 0;
  for (const event of events) {
    const parsed = parseHistoryEntry(event);
    if (parsed === undefined) continue;
    if (!isPositiveSafeInteger(event.sequence) || event.sequence <= previousRepairEventSequence) {
      throw new Error("worker validation-repair history is out of order");
    }
    previousRepairEventSequence = event.sequence;
    const count = counts.get(parsed.round) ?? { authorized: 0, started: 0, terminal: 0 };
    const phase = event.type === "worker.validation-repair.authorized"
      ? "authorized"
      : event.type === "worker.validation-repair.started" ? "started" : "terminal";
    if (phase === "authorized") {
      if (count.authorized !== 0) throw new Error("worker validation-repair history has duplicate authorization");
      count.authorized += 1;
      authorizationSequences.set(parsed.round, parsed.authorizationEventSequence);
    } else {
      if (count.authorized !== 1 || authorizationSequences.get(parsed.round) !== parsed.authorizationEventSequence) {
        throw new Error("worker validation-repair history has an orphaned round event");
      }
      if (phase === "started") {
        if (count.started !== 0 || count.terminal !== 0) {
          throw new Error("worker validation-repair history has duplicate or late start");
        }
        count.started += 1;
      } else {
        if (count.started !== 1 || count.terminal !== 0) {
          throw new Error("worker validation-repair history has duplicate or premature terminal");
        }
        count.terminal += 1;
      }
    }
    counts.set(parsed.round, count);
    const previous = byRound.get(parsed.round);
    if (previous === undefined) {
      byRound.set(parsed.round, parsed);
      continue;
    }
    if (
      !repairEntryIdentityEqual(previous, parsed)
    ) throw new Error("worker validation-repair history has conflicting round identity");
    if (parsed.state === "terminal") byRound.set(parsed.round, parsed);
    else if (parsed.state === "started") byRound.set(parsed.round, parsed);
  }
  for (const count of counts.values()) {
    if (count.authorized !== 1 || count.started > 1 || count.terminal > 1) {
      throw new Error("worker validation-repair history has an incomplete round lineage");
    }
  }
  return [...byRound.values()].sort((a, b) => a.round - b.round);
}

function authorizationPayload(
  authorization: Omit<WorkerValidationRepairAuthorization, "authorizationEventSequence">,
): Record<string, unknown> {
  return {
    ...authorization,
    kind: "worker-validation-repair",
  };
}

/** Atomically durable authorization boundary; idempotent for the same round. */
export function authorizeWorkerValidationRepair(
  store: StateStore,
  task: TaskRecord,
  input: {
    decision: WorkerValidationRepairDecision;
    priorAttemptId: string;
    verificationEventSequence: number;
    candidateRevisionId: string;
    feedback: string;
  },
): WorkerValidationRepairAuthorization {
  if (!input.decision.eligible || input.decision.evidenceFingerprint === undefined) {
    throw new Error("worker validation-repair authorization requires an eligible decision");
  }
  if (
    input.decision.taskId !== task.id
    || input.decision.attemptId !== input.priorAttemptId
    || input.decision.candidateRevisionId !== input.candidateRevisionId
    || input.decision.verificationEventSequence !== input.verificationEventSequence
  ) {
    throw new Error("worker validation-repair authorization is not bound to the decided evidence");
  }
  const evidenceFingerprint = input.decision.evidenceFingerprint;
  const expectedIdentity = workerIdentity(task);
  const feedback = input.feedback.trim().slice(0, MAX_FEEDBACK_LENGTH);
  return store.atomic(() => {
    // Re-read inside the write transaction. Two daemon instances recovering
    // the same terminal evidence must converge on one durable authorization,
    // one Attempt identity, and one target ordinal rather than racing from
    // the same pre-transaction snapshot.
    const history = resolveWorkerValidationRepairHistory(store.listEvents(task.id));
    const existing = history.find((entry) => entry.round === input.decision.round);
    if (existing !== undefined) {
      if (
        existing.state === "terminal"
        || existing.feedback !== feedback
        || existing.evidenceFingerprint !== evidenceFingerprint
        || existing.priorAttemptId !== input.priorAttemptId
        || existing.verificationEventSequence !== input.verificationEventSequence
        || existing.candidateRevisionId !== input.candidateRevisionId
        || !identityEqual(existing.workerIdentity, expectedIdentity)
      ) throw new Error("worker validation-repair authorization conflicts with the existing round");
      return {
        schemaVersion: 1,
        taskId: existing.taskId,
        round: existing.round,
        authorizationEventSequence: existing.authorizationEventSequence,
        attemptId: existing.attemptId,
        targetAttemptOrdinal: existing.targetAttemptOrdinal,
        priorAttemptId: existing.priorAttemptId,
        verificationEventSequence: existing.verificationEventSequence,
        candidateRevisionId: existing.candidateRevisionId,
        evidenceFingerprint: existing.evidenceFingerprint,
        workerIdentity: existing.workerIdentity,
        feedback: existing.feedback,
      };
    }
    if (input.decision.round !== history.length + 1 || history.some((entry) => entry.state !== "terminal")) {
      throw new Error("worker validation-repair authorization conflicts with the existing history");
    }
    const authorizationWithoutSequence: Omit<WorkerValidationRepairAuthorization, "authorizationEventSequence"> = {
      schemaVersion: 1,
      taskId: task.id,
      round: input.decision.round,
      attemptId: randomUUID(),
      targetAttemptOrdinal: store.nextAttemptOrdinal(task.id),
      priorAttemptId: input.priorAttemptId,
      verificationEventSequence: input.verificationEventSequence,
      candidateRevisionId: input.candidateRevisionId,
      evidenceFingerprint,
      workerIdentity: expectedIdentity,
      feedback,
    };
    const event = store.addEvent(
      task.id,
      input.priorAttemptId,
      "worker.validation-repair.authorized",
      `Worker validation-repair round ${input.decision.round} authorized`,
      authorizationPayload(authorizationWithoutSequence),
    );
    return { ...authorizationWithoutSequence, authorizationEventSequence: event.sequence };
  });
}

/** Return the one pending round, if any. Conflicting history fails closed. */
export function resolvePendingWorkerValidationRepair(
  store: StateStore,
  taskId: string,
): WorkerValidationRepairExecution | null {
  const history = resolveWorkerValidationRepairHistory(store.listEvents(taskId));
  const pending = history.find((entry) => entry.state !== "terminal");
  if (pending === undefined) return null;
  return {
    authorization: {
      schemaVersion: 1,
      taskId: pending.taskId,
      round: pending.round,
      authorizationEventSequence: pending.authorizationEventSequence,
      attemptId: pending.attemptId,
      targetAttemptOrdinal: pending.targetAttemptOrdinal,
      priorAttemptId: pending.priorAttemptId,
      verificationEventSequence: pending.verificationEventSequence,
      candidateRevisionId: pending.candidateRevisionId,
      evidenceFingerprint: pending.evidenceFingerprint,
      workerIdentity: pending.workerIdentity,
      feedback: pending.feedback,
    },
    started: pending.state === "started",
  };
}

/** Persist one start marker; duplicate recovery returns the existing marker. */
export function recordWorkerValidationRepairStarted(
  store: StateStore,
  authorization: WorkerValidationRepairAuthorization,
): void {
  store.atomic(() => {
    // Re-read under the lock so concurrent recovery callers cannot both append
    // a start marker after observing the same authorized state.
    const existing = resolveWorkerValidationRepairHistory(store.listEvents(authorization.taskId))
      .find((entry) => entry.round === authorization.round);
    if (existing?.state === "terminal") {
      throw new Error("worker validation-repair round is already terminal");
    }
    if (existing === undefined || !authorizationMatchesEntry(authorization, existing)) {
      throw new Error("worker validation-repair start has no matching authorization");
    }
    if (existing.state === "started") return;
    store.addEvent(
      authorization.taskId,
      authorization.attemptId,
      "worker.validation-repair.started",
      `Worker validation-repair round ${authorization.round} started`,
      {
        ...authorization,
        kind: "worker-validation-repair",
      },
    );
  });
}

/** Persist exactly one terminal marker for a repair round. */
export function recordWorkerValidationRepairCompleted(
  store: StateStore,
  input: WorkerValidationRepairTerminalInput,
): void {
  if (
    !isNonEmptyString(input.attemptId)
    || !REPAIR_TERMINAL_OUTCOMES.has(input.outcome)
    || (input.reason !== undefined && !REPAIR_STOP_REASONS.has(input.reason))
    || input.attemptId !== input.authorization.attemptId
  ) {
    throw new Error("worker validation-repair terminal lineage is invalid");
  }
  store.atomic(() => {
    // Terminal idempotency must be checked inside the same transaction as the
    // append; restart and normal completion can otherwise race to close a
    // started round twice.
    const history = resolveWorkerValidationRepairHistory(store.listEvents(input.authorization.taskId));
    const existing = history.find((entry) => entry.round === input.authorization.round);
    if (existing?.state === "terminal") {
      if (
        authorizationMatchesEntry(input.authorization, existing)
        && existing.terminalOutcome === input.outcome
        && existing.terminalReason === input.reason
      ) return;
      throw new Error("worker validation-repair terminal lineage conflicts with the existing round");
    }
    if (existing === undefined || !authorizationMatchesEntry(input.authorization, existing)) {
      throw new Error("worker validation-repair completion has no matching authorization");
    }
    store.addEvent(
      input.authorization.taskId,
      input.attemptId,
      "worker.validation-repair.completed",
      `Worker validation-repair round ${input.authorization.round} ${input.outcome}`,
      {
        ...input.authorization,
        kind: "worker-validation-repair",
        outcome: input.outcome,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      },
    );
  });
}

/** Record one content-free automatic-repair refusal for an Attempt. This is
 * not a repair round and therefore never creates authorization/start lineage. */
export function recordWorkerValidationRepairSkipped(
  store: StateStore,
  taskId: string,
  attemptId: string | undefined,
  reason: WorkerValidationRepairStopReason,
): void {
  const duplicate = store.listEvents(taskId).some((event) => {
    if (event.type !== "worker.validation-repair.skipped") return false;
    if (event.attemptId !== attemptId) return false;
    if (event.payload === null || typeof event.payload !== "object") return false;
    return (event.payload as { reason?: unknown }).reason === reason;
  });
  if (duplicate) return;
  store.addEvent(
    taskId,
    attemptId,
    "worker.validation-repair.skipped",
    "Automatic Worker validation-repair skipped",
    { reason, nextAction: "Main receives the bounded evidence and decides the next authority-bearing action." },
  );
}

/** Build bounded feedback from independent verification without guessing from
 * raw output. The full typed command evidence remains private to the Worker
 * session and is never used as an authorization signal. Only a canonical
 * sanitized diagnostic excerpt from failing verification reaches the Worker,
 * so finite repair acts on useful file/line/error evidence rather than guessing
 * one error per round. */
export function workerValidationRepairFeedback(
  verification: VerificationResult,
  round: number,
  workspaceRoot?: string,
): string {
  const diagnostics = sanitizeFailedVerificationDiagnostics(
    verification,
    workspaceRoot === undefined ? {} : { workspaceRoot },
  );
  const diagnosticText = formatVerificationDiagnostics(diagnostics);
  const failedText = diagnostics.length === 0
    ? "The typed failing-command set is unavailable; stop if the cause is not clear."
    : `Failed verification diagnostics:\n${diagnosticText}`;
  return [
    `Independent verification found a behavior failure. This is validation-repair round ${round}.`,
    "Repair the implementation in the existing Task workspace and same Worker session.",
    "After the final edit, self-check every original acceptance command in its original order.",
    failedText,
    "ForkLight will independently rerun the complete unchanged acceptance suite before Main review.",
  ].join("\n").slice(0, MAX_FEEDBACK_LENGTH);
}

// Explicit aliases make the pure contract discoverable to coordinator and
// focused tests without creating a second implementation or authority path.
export const evaluateWorkerValidationRepair = decideWorkerValidationRepair;
export const workerValidationRepairDecision = decideWorkerValidationRepair;
export const recordWorkerValidationRepairAuthorization = authorizeWorkerValidationRepair;
