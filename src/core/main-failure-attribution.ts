import { resolveRevisionForAttempt } from "./candidate-revision.js";
import type { AttemptRecord, EventRecord, TaskRecord } from "./types.js";
import type { StateStore } from "../state/store.js";

export const FAILURE_ATTRIBUTION_EVENT = "main.failure-attribution.recorded" as const;
export const FAILURE_ATTRIBUTION_CONFLICT =
  "Failure attribution conflict: this verification already has an immutable attribution";

export type FailureAttributionCause =
  | "candidate"
  | "verification-infrastructure"
  | "acceptance-contract"
  | "insufficient-evidence";

export type FailureAttributionImpact = "model-quality" | "non-model" | "ambiguous";

export interface MainFailureAttribution {
  version: 1;
  taskId: string;
  attemptId: string;
  verificationEventSequence: number;
  cause: FailureAttributionCause;
  impact: FailureAttributionImpact;
  note: string;
  candidateRevisionId?: string;
  candidatePatchDigest?: string;
  recordedAt: string;
  eventSequence: number;
}

export interface RecordMainFailureAttributionInput {
  attemptId: string;
  verificationEventSequence: number;
  cause: FailureAttributionCause;
  note: string;
  candidateRevisionId?: string;
  candidatePatchDigest?: string;
  confirm: true;
}

export interface MainFailureAttributionReceipt {
  version: 1;
  taskId: string;
  attemptId: string;
  verificationEventSequence: number;
  cause: FailureAttributionCause;
  impact: FailureAttributionImpact;
  noteLength: number;
  hasCandidateRevision: boolean;
  eventSequence: number;
  recordedAt: string;
  existing: boolean;
}

export interface MainFailureAttributionProjection {
  machineOutcome: "failed" | "not-failed";
  abilityAssessment: "counts" | "excluded" | "uncertain";
  eligible: boolean;
  reason: "ready" | "already-recorded" | "task-not-failed" | "no-failed-verification" | "invalid-history";
  attribution?: {
    cause: FailureAttributionCause;
    impact: FailureAttributionImpact;
    note: string;
    recordedAt: string;
  };
  binding?: {
    attemptId: string;
    verificationEventSequence: number;
    candidateRevisionId?: string;
    candidatePatchDigest?: string;
  };
}

const CAUSE_TO_IMPACT: Readonly<Record<FailureAttributionCause, FailureAttributionImpact>> = {
  candidate: "model-quality",
  "verification-infrastructure": "non-model",
  "acceptance-contract": "non-model",
  "insufficient-evidence": "ambiguous",
};

export function isFailureAttributionCause(value: unknown): value is FailureAttributionCause {
  return value === "candidate"
    || value === "verification-infrastructure"
    || value === "acceptance-contract"
    || value === "insufficient-evidence";
}

export function failureAttributionImpact(
  cause: FailureAttributionCause,
): FailureAttributionImpact {
  return CAUSE_TO_IMPACT[cause];
}

function canonicalNote(value: unknown): string {
  if (typeof value !== "string") throw new Error("failure attribution note must be a string");
  const note = value.trim();
  if (note.length < 1 || note.length > 500) {
    throw new Error("failure attribution note must be 1-500 characters");
  }
  if (/[\u0000-\u001f\u007f]/u.test(note)) {
    throw new Error("failure attribution note must not contain control characters");
  }
  return note;
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function failedVerification(
  events: readonly EventRecord[],
  attemptId: string,
  sequence: number,
): EventRecord | undefined {
  const event = events.find((candidate) => candidate.sequence === sequence);
  if (
    event === undefined
    || event.type !== "verification.completed"
    || event.attemptId !== attemptId
    || event.payload === null
    || typeof event.payload !== "object"
    || Array.isArray(event.payload)
  ) return undefined;
  const payload = event.payload as Record<string, unknown>;
  return payload.passed === false && Array.isArray(payload.commands) ? event : undefined;
}

function rawKeyMatches(
  event: EventRecord,
  attemptId: string,
  verificationEventSequence: number,
): boolean {
  if (event.type !== FAILURE_ATTRIBUTION_EVENT) return false;
  if (event.payload === null || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    return false;
  }
  const payload = event.payload as Record<string, unknown>;
  return event.attemptId === attemptId
    && payload.attemptId === attemptId
    && payload.verificationEventSequence === verificationEventSequence;
}

function parseEvent(
  events: readonly EventRecord[],
  event: EventRecord,
  attemptId: string,
  verificationEventSequence: number,
): MainFailureAttribution | undefined {
  if (!rawKeyMatches(event, attemptId, verificationEventSequence)) return undefined;
  if (failedVerification(events, attemptId, verificationEventSequence) === undefined) return undefined;
  if (event.payload === null || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    return undefined;
  }
  const payload = event.payload as Record<string, unknown>;
  if (
    payload.version !== 1
    || !isFailureAttributionCause(payload.cause)
    || payload.impact !== failureAttributionImpact(payload.cause)
    || typeof payload.note !== "string"
  ) return undefined;
  let note: string;
  try {
    note = canonicalNote(payload.note);
  } catch {
    return undefined;
  }
  if (note !== payload.note) return undefined;

  const revision = resolveRevisionForAttempt(events, attemptId, verificationEventSequence);
  const hasRevisionId = Object.prototype.hasOwnProperty.call(payload, "candidateRevisionId");
  const hasDigest = Object.prototype.hasOwnProperty.call(payload, "candidatePatchDigest");
  if (hasRevisionId !== hasDigest) return undefined;
  if (revision === undefined) {
    if (hasRevisionId || hasDigest) return undefined;
  } else if (
    payload.candidateRevisionId !== revision.id
    || payload.candidatePatchDigest !== revision.patchDigest
  ) return undefined;

  return {
    version: 1,
    taskId: event.taskId,
    attemptId,
    verificationEventSequence,
    cause: payload.cause,
    impact: failureAttributionImpact(payload.cause),
    note,
    ...(revision === undefined ? {} : {
      candidateRevisionId: revision.id,
      candidatePatchDigest: revision.patchDigest,
    }),
    recordedAt: event.timestamp,
    eventSequence: event.sequence,
  };
}

/** Resolve one unique, fully bound attribution. Malformed or duplicate history fails closed. */
export function resolveMainFailureAttribution(
  events: readonly EventRecord[],
  attemptId: string,
  verificationEventSequence: number,
): MainFailureAttribution | undefined {
  const raw = events.filter((event) => rawKeyMatches(event, attemptId, verificationEventSequence));
  if (raw.length !== 1) return undefined;
  return parseEvent(events, raw[0]!, attemptId, verificationEventSequence);
}

function canonicalEquals(
  existing: MainFailureAttribution,
  input: {
    cause: FailureAttributionCause;
    note: string;
    candidateRevisionId?: string;
    candidatePatchDigest?: string;
  },
): boolean {
  return existing.cause === input.cause
    && existing.note === input.note
    && existing.candidateRevisionId === input.candidateRevisionId
    && existing.candidatePatchDigest === input.candidatePatchDigest;
}

function receipt(
  attribution: MainFailureAttribution,
  existing: boolean,
): MainFailureAttributionReceipt {
  return {
    version: 1,
    taskId: attribution.taskId,
    attemptId: attribution.attemptId,
    verificationEventSequence: attribution.verificationEventSequence,
    cause: attribution.cause,
    impact: attribution.impact,
    noteLength: attribution.note.length,
    hasCandidateRevision: attribution.candidateRevisionId !== undefined,
    eventSequence: attribution.eventSequence,
    recordedAt: attribution.recordedAt,
    existing,
  };
}

export function recordMainFailureAttribution(
  store: StateStore,
  taskId: string,
  input: RecordMainFailureAttributionInput,
): MainFailureAttributionReceipt {
  if (input.confirm !== true) throw new Error("failure attribution requires confirm: true");
  if (!isFailureAttributionCause(input.cause)) throw new Error("invalid failure attribution cause");
  if (!Number.isSafeInteger(input.verificationEventSequence) || input.verificationEventSequence < 1) {
    throw new Error("verificationEventSequence must be a positive integer");
  }
  const note = canonicalNote(input.note);
  const hasRevisionId = input.candidateRevisionId !== undefined;
  const hasDigest = input.candidatePatchDigest !== undefined;
  if (hasRevisionId !== hasDigest) {
    throw new Error("candidateRevisionId and candidatePatchDigest must be provided together");
  }
  if (hasRevisionId && (typeof input.candidateRevisionId !== "string" || input.candidateRevisionId.length === 0)) {
    throw new Error("candidateRevisionId must be a non-empty string");
  }
  if (hasDigest && !isDigest(input.candidatePatchDigest)) {
    throw new Error("candidatePatchDigest must be a lowercase SHA-256 digest");
  }

  return store.atomic(() => {
    const task = store.getTask(taskId);
    if (task.status !== "failed") throw new Error("failure attribution requires a failed Task");
    const attempt = store.getAttempt(input.attemptId);
    if (attempt.taskId !== taskId) throw new Error("Attempt does not belong to this Task");
    const events = store.listEvents(taskId);
    if (failedVerification(events, attempt.id, input.verificationEventSequence) === undefined) {
      throw new Error("verificationEventSequence must identify this Attempt's failed verification");
    }
    const revision = resolveRevisionForAttempt(events, attempt.id, input.verificationEventSequence);
    if (revision === undefined) {
      if (hasRevisionId || hasDigest) {
        throw new Error("this verification has no Candidate Revision binding");
      }
    } else if (
      input.candidateRevisionId !== revision.id
      || input.candidatePatchDigest !== revision.patchDigest
    ) {
      throw new Error("Candidate Revision binding does not match this verification");
    }

    const raw = events.filter((event) => rawKeyMatches(
      event, attempt.id, input.verificationEventSequence,
    ));
    if (raw.length > 0) {
      const existing = resolveMainFailureAttribution(
        events, attempt.id, input.verificationEventSequence,
      );
      if (existing !== undefined && canonicalEquals(existing, {
        cause: input.cause,
        note,
        ...(revision === undefined ? {} : {
          candidateRevisionId: revision.id,
          candidatePatchDigest: revision.patchDigest,
        }),
      })) return receipt(existing, true);
      throw new Error(FAILURE_ATTRIBUTION_CONFLICT);
    }

    const event = store.addEvent(
      taskId,
      attempt.id,
      FAILURE_ATTRIBUTION_EVENT,
      "Main recorded responsibility for one failed verification",
      {
        version: 1,
        attemptId: attempt.id,
        verificationEventSequence: input.verificationEventSequence,
        cause: input.cause,
        impact: failureAttributionImpact(input.cause),
        note,
        ...(revision === undefined ? {} : {
          candidateRevisionId: revision.id,
          candidatePatchDigest: revision.patchDigest,
        }),
      },
    );
    const attribution = resolveMainFailureAttribution(
      [...events, event], attempt.id, input.verificationEventSequence,
    );
    if (attribution === undefined) throw new Error("stored failure attribution failed validation");
    return receipt(attribution, false);
  });
}

function assessment(impact: FailureAttributionImpact | undefined): "counts" | "excluded" | "uncertain" {
  if (impact === "model-quality") return "counts";
  if (impact === "non-model") return "excluded";
  return "uncertain";
}

/** Trusted local Task Detail projection. Binding fields are authority inputs, never primary UI copy. */
export function projectMainFailureAttribution(
  task: TaskRecord,
  attempts: readonly AttemptRecord[],
  events: readonly EventRecord[],
): MainFailureAttributionProjection {
  if (task.status !== "failed") {
    return { machineOutcome: "not-failed", abilityAssessment: "uncertain", eligible: false, reason: "task-not-failed" };
  }
  const latest = [...events]
    .filter((event) => event.type === "verification.completed")
    .sort((left, right) => right.sequence - left.sequence)[0];
  if (
    latest === undefined
    || latest.attemptId === undefined
    || failedVerification(events, latest.attemptId, latest.sequence) === undefined
  ) {
    return { machineOutcome: "failed", abilityAssessment: "uncertain", eligible: false, reason: "no-failed-verification" };
  }
  if (!attempts.some((attempt) => attempt.id === latest.attemptId && attempt.taskId === task.id)) {
    return { machineOutcome: "failed", abilityAssessment: "uncertain", eligible: false, reason: "invalid-history" };
  }
  const revision = resolveRevisionForAttempt(events, latest.attemptId, latest.sequence);
  const binding = {
    attemptId: latest.attemptId,
    verificationEventSequence: latest.sequence,
    ...(revision === undefined ? {} : {
      candidateRevisionId: revision.id,
      candidatePatchDigest: revision.patchDigest,
    }),
  };
  const attribution = resolveMainFailureAttribution(events, latest.attemptId, latest.sequence);
  if (attribution === undefined) {
    const raw = events.filter((event) => rawKeyMatches(event, latest.attemptId!, latest.sequence));
    if (raw.length > 0) {
      return { machineOutcome: "failed", abilityAssessment: "uncertain", eligible: false, reason: "invalid-history" };
    }
    return {
      machineOutcome: "failed",
      abilityAssessment: "uncertain",
      eligible: true,
      reason: "ready",
      binding,
    };
  }
  return {
    machineOutcome: "failed",
    abilityAssessment: assessment(attribution.impact),
    eligible: false,
    reason: "already-recorded",
    attribution: {
      cause: attribution.cause,
      impact: attribution.impact,
      note: attribution.note,
      recordedAt: attribution.recordedAt,
    },
    binding,
  };
}
