import type { StateStore } from "../state/store.js";
import { cloneDefaults } from "./settings.js";
import { isTerminalTaskStatus } from "./task-progress.js";
import {
  buildCandidateGapContract,
  computeGapContractDigest,
  hasExactCompetitionMainRevise,
  isLatestMainReviewRevise,
  resolveLatestRevision,
  latestVerificationSequence,
} from "./candidate-revision.js";
import {
  blocksSamePolicyRetry,
  samePolicyRetryBlockedMessage,
} from "./contract-infeasible.js";
import { failureCategoryForTask } from "./worker-failure.js";
import type {
  AttemptAuthorization,
  AttemptExecutionOptions,
  AttemptRecord,
  CandidateGapContract,
  TaskRecord,
} from "./types.js";

const REASON_MAX_LENGTH = 1000;

/** Authorization kind discriminator for grant events.
 *  Legacy events without a kind field remain valid generic-extra grants. */
type AuthorizationKind = "extra" | "correction" | "restart-recovery";

interface ValidatedGrant {
  targetOrdinal: number;
  maxBudgetUsd: number | null;
  reason: string;
  feedback?: string;
  priorAttemptId?: string;
  candidateRevisionId?: string;
  gapContractDigest?: string;
  gapContract?: CandidateGapContract;
  handoffId?: string;
  eventSequence: number;
  kind: AuthorizationKind;
}

function normalizePersistedGapContract(value: unknown): CandidateGapContract {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("authorization history is corrupt: malformed structured correction grant");
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort();
  if (
    keys.length !== 4
    || keys[0] !== "candidateRevisionId"
    || keys[1] !== "remainingGaps"
    || keys[2] !== "reusablePaths"
    || keys[3] !== "schemaVersion"
    || input.schemaVersion !== 1
    || typeof input.candidateRevisionId !== "string"
  ) {
    throw new Error("authorization history is corrupt: malformed structured correction grant");
  }
  try {
    return buildCandidateGapContract(
      input.candidateRevisionId,
      input.reusablePaths,
      input.remainingGaps,
      Array.isArray(input.reusablePaths) ? input.reusablePaths as string[] : [],
    );
  } catch {
    throw new Error("authorization history is corrupt: malformed structured correction grant");
  }
}

function eligibleStatus(task: TaskRecord): boolean {
  return isTerminalTaskStatus(task.status);
}

function expectedBudgetMode(budget: number | null): string {
  return budget === null ? "uncapped-for-authorized-attempt" : "capped-for-authorized-attempt";
}

function resolveKind(payload: Record<string, unknown>): AuthorizationKind {
  if (payload.kind === "correction") return "correction";
  if (payload.kind === "restart-recovery") return "restart-recovery";
  // Legacy events without a kind field, or explicit "extra", are generic extra.
  if (payload.kind === undefined || payload.kind === "extra") return "extra";
  throw new Error("authorization history is corrupt: unknown grant kind");
}

/** Validate grant events and derive consumed / pending state by kind.
 *  Throws on corrupt evidence. Ordinals remain globally sequential across kinds. */
function resolveGrantState(
  events: readonly { type: string; payload?: unknown; sequence: number }[],
  attemptOrdinals: Set<number>,
  configuredMaxAttempts: number,
): {
  extraConsumed: number;
  correctionConsumed: number;
  restartRecoveryConsumed: number;
  pendingGrant: ValidatedGrant | null;
} {
  const grants: ValidatedGrant[] = [];
  const seenOrdinals = new Set<number>();
  for (const event of events) {
    if (event.type !== "attempt.authorization.granted") continue;
    if (event.payload === null || typeof event.payload !== "object") {
      throw new Error("authorization history is corrupt: malformed grant event payload");
    }
    const p = event.payload as Record<string, unknown>;
    const kind = resolveKind(p);
    if (
      p.additionalAttempts !== 1
      || typeof p.targetOrdinal !== "number"
      || !Number.isInteger(p.targetOrdinal)
      || p.targetOrdinal <= 0
      || (p.maxBudgetUsd !== null && (typeof p.maxBudgetUsd !== "number" || !Number.isFinite(p.maxBudgetUsd) || p.maxBudgetUsd <= 0))
      || typeof p.reason !== "string"
      || p.reason !== p.reason.trim()
      || p.reason.length === 0
      || p.reason.length > REASON_MAX_LENGTH
      || typeof p.budgetMode !== "string"
      || p.budgetMode !== expectedBudgetMode(p.maxBudgetUsd as number | null)
    ) {
      throw new Error("authorization history is corrupt: malformed grant event payload");
    }
    if (kind === "extra" && p.targetOrdinal <= configuredMaxAttempts) {
      throw new Error("authorization history is corrupt: extra grant does not exceed base attempts");
    }
    if (
      kind === "correction"
      && (
        p.reason !== "main-correction"
        || typeof p.feedback !== "string"
        || p.feedback !== p.feedback.trim()
        || p.feedback.length === 0
        || p.feedback.length > REASON_MAX_LENGTH
        || typeof p.priorAttemptId !== "string"
        || p.priorAttemptId.length === 0
      )
    ) {
      throw new Error("authorization history is corrupt: malformed correction grant payload");
    }
    if (
      kind === "restart-recovery"
      && (
        p.reason !== "handoff-daemon-restart"
        || typeof p.priorAttemptId !== "string"
        || p.priorAttemptId.length === 0
        || typeof p.handoffId !== "string"
        || p.handoffId.length === 0
        || p.handoffId.length > 100
      )
    ) {
      throw new Error("authorization history is corrupt: malformed restart recovery grant");
    }
    if (!p.reason.trim()) {
      throw new Error("authorization history is corrupt: malformed grant event payload");
    }
    let gapContract: CandidateGapContract | undefined;
    if (kind === "correction") {
      const hasStructuredEvidence = p.candidateRevisionId !== undefined
        || p.gapContractDigest !== undefined
        || p.gapContract !== undefined;
      if (hasStructuredEvidence) {
        if (
          typeof p.candidateRevisionId !== "string"
          || p.candidateRevisionId.length === 0
          || typeof p.gapContractDigest !== "string"
          || !/^[a-f0-9]{64}$/.test(p.gapContractDigest)
          || p.gapContract === undefined
        ) {
          throw new Error("authorization history is corrupt: malformed structured correction grant");
        }
        gapContract = normalizePersistedGapContract(p.gapContract);
        if (
          gapContract.schemaVersion !== 1
          || gapContract.candidateRevisionId !== p.candidateRevisionId
          || computeGapContractDigest(gapContract) !== p.gapContractDigest
        ) {
          throw new Error("authorization history is corrupt: structured correction digest mismatch");
        }
      }
    }
    if (seenOrdinals.has(p.targetOrdinal)) {
      throw new Error("authorization history is corrupt: duplicate grant target ordinal");
    }
    seenOrdinals.add(p.targetOrdinal);
    grants.push({
      targetOrdinal: p.targetOrdinal,
      maxBudgetUsd: p.maxBudgetUsd as number | null,
      reason: p.reason,
      ...(kind === "correction" ? {
        feedback: p.feedback as string,
        priorAttemptId: p.priorAttemptId as string,
        ...(gapContract === undefined ? {} : {
          candidateRevisionId: p.candidateRevisionId as string,
          gapContractDigest: p.gapContractDigest as string,
          gapContract,
        }),
      } : {}),
      ...(kind === "restart-recovery" ? {
        priorAttemptId: p.priorAttemptId as string,
        handoffId: p.handoffId as string,
      } : {}),
      eventSequence: event.sequence,
      kind,
    });
  }

  const grantsByOrdinal = new Map<number, ValidatedGrant>();
  for (const g of grants) grantsByOrdinal.set(g.targetOrdinal, g);

  const extraAttemptOrdinals = [...attemptOrdinals]
    .filter((o) => o > configuredMaxAttempts)
    .sort((a, b) => a - b);

  // Every extra attempt must have a matching grant
  for (const ordinal of extraAttemptOrdinals) {
    if (!grantsByOrdinal.has(ordinal)) {
      throw new Error("authorization history is corrupt: extra attempt without matching grant");
    }
  }

  // Ordinals must be globally sequential (no gaps)
  for (let i = 0; i < extraAttemptOrdinals.length; i += 1) {
    if (extraAttemptOrdinals[i] !== configuredMaxAttempts + 1 + i) {
      throw new Error("authorization history is corrupt: non-sequential extra attempts");
    }
  }

  const extraConsumed = grants.filter(
    (g) => g.kind === "extra" && attemptOrdinals.has(g.targetOrdinal),
  ).length;
  const correctionConsumed = grants.filter(
    (g) => g.kind === "correction" && attemptOrdinals.has(g.targetOrdinal),
  ).length;
  const restartRecoveryConsumed = grants.filter(
    (g) => g.kind === "restart-recovery" && attemptOrdinals.has(g.targetOrdinal),
  ).length;

  const pending = grants.filter((g) => !attemptOrdinals.has(g.targetOrdinal));

  if (pending.length > 1) {
    throw new Error(
      "authorization history is corrupt: multiple pending extra attempt grants",
    );
  }
  const lastAttemptOrdinal = attemptOrdinals.size === 0 ? 0 : Math.max(...attemptOrdinals);
  if (pending.length === 1 && pending[0]!.targetOrdinal !== lastAttemptOrdinal + 1) {
    throw new Error("authorization history is corrupt: pending grant ordinal gap");
  }

  return {
    extraConsumed,
    correctionConsumed,
    restartRecoveryConsumed,
    pendingGrant: pending[0] ?? null,
  };
}

/** Return execution options for a pending extra-attempt grant, or null if none exists. */
export function resolvePendingGrantExecutionOptions(
  store: StateStore,
  taskId: string,
  configuredMaxAttempts: number,
  maxExtraAttempts: number,
): AttemptExecutionOptions | null {
  void maxExtraAttempts;
  const events = store.listEvents(taskId);
  const attemptOrdinals = new Set(store.listAttempts(taskId).map((a) => a.ordinal));
  const { pendingGrant } = resolveGrantState(events, attemptOrdinals, configuredMaxAttempts);
  if (
    !pendingGrant
    || (pendingGrant.kind !== "extra" && pendingGrant.kind !== "restart-recovery")
  ) return null;
  return {
    maximumOrdinal: pendingGrant.targetOrdinal,
    maxBudgetUsdOverride: pendingGrant.maxBudgetUsd,
    authorizationEventSequence: pendingGrant.eventSequence,
  };
}

/**
 * Authorize at most one system recovery Attempt for a handoff successor that
 * was interrupted before independent verification. This is continuity after
 * Daemon loss, not a model-quality retry and not part of maxExtraAttempts.
 */
export function authorizeHandoffRestartRecovery(
  store: StateStore,
  taskId: string,
  handoffId: string,
  configuredMaxAttempts: number,
): AttemptExecutionOptions | null {
  const task = store.getTask(taskId);
  if (task.status !== "interrupted" && task.status !== "failed") return null;
  const attempts = store.listAttempts(taskId);
  if (attempts.length === 0) return null;
  const latest = attempts.reduce((left, right) => (
    right.ordinal > left.ordinal ? right : left
  ));
  if (latest.status !== "interrupted") return null;

  const events = store.listEvents(taskId);
  if (events.some((event) => (
    event.attemptId === latest.id
    && (event.type === "verification.completed" || event.type === "candidate.revision.captured")
  ))) return null;

  const attemptOrdinals = new Set(attempts.map((attempt) => attempt.ordinal));
  const { pendingGrant, restartRecoveryConsumed } = resolveGrantState(
    events,
    attemptOrdinals,
    configuredMaxAttempts,
  );
  if (pendingGrant !== null) {
    if (
      pendingGrant.kind === "restart-recovery"
      && pendingGrant.handoffId === handoffId
      && pendingGrant.priorAttemptId === latest.id
    ) {
      return {
        maximumOrdinal: pendingGrant.targetOrdinal,
        maxBudgetUsdOverride: pendingGrant.maxBudgetUsd,
        authorizationEventSequence: pendingGrant.eventSequence,
      };
    }
    return null;
  }
  if (restartRecoveryConsumed >= 1) return null;

  const targetOrdinal = latest.ordinal + 1;
  const budget = task.spec.runtime.maxBudgetUsd;
  const event = store.addEvent(
    taskId,
    latest.id,
    "attempt.authorization.granted",
    `One handoff restart recovery authorized for ordinal ${targetOrdinal}`,
    {
      kind: "restart-recovery",
      additionalAttempts: 1,
      targetOrdinal,
      maxBudgetUsd: budget,
      budgetMode: budget === null
        ? "uncapped-for-authorized-attempt"
        : "capped-for-authorized-attempt",
      reason: "handoff-daemon-restart",
      priorAttemptId: latest.id,
      handoffId,
    },
  );
  return {
    maximumOrdinal: targetOrdinal,
    maxBudgetUsdOverride: budget,
    authorizationEventSequence: event.sequence,
  };
}

/** Reconstruct one pending Main correction, including the exact bounded feedback. */
export interface PendingMainCorrection {
  executionOptions: AttemptExecutionOptions;
  feedback: string;
  priorAttemptId: string;
  candidateRevisionId?: string;
  gapContractDigest?: string;
  gapContract?: CandidateGapContract;
}

export function resolvePendingCorrectionGrant(
  store: StateStore,
  taskId: string,
  configuredMaxAttempts: number,
): PendingMainCorrection | null {
  const events = store.listEvents(taskId);
  const attemptOrdinals = new Set(store.listAttempts(taskId).map((a) => a.ordinal));
  const { pendingGrant } = resolveGrantState(events, attemptOrdinals, configuredMaxAttempts);
  if (!pendingGrant || pendingGrant.kind !== "correction") return null;
  return {
    executionOptions: {
      maximumOrdinal: pendingGrant.targetOrdinal,
      maxBudgetUsdOverride: pendingGrant.maxBudgetUsd,
      authorizationEventSequence: pendingGrant.eventSequence,
    },
    feedback: pendingGrant.feedback!,
    priorAttemptId: pendingGrant.priorAttemptId!,
    ...(pendingGrant.candidateRevisionId === undefined
      ? {}
      : { candidateRevisionId: pendingGrant.candidateRevisionId }),
    ...(pendingGrant.gapContractDigest === undefined
      ? {}
      : { gapContractDigest: pendingGrant.gapContractDigest }),
    ...(pendingGrant.gapContract === undefined
      ? {}
      : { gapContract: pendingGrant.gapContract }),
  };
}

export function authorizeExtraAttempt(
  store: StateStore,
  taskId: string,
  authorization: AttemptAuthorization,
  configuredMaxAttempts: number,
  maximumBudgetUsd = cloneDefaults().execution.maximumBudgetUsd,
  maxExtraAttempts = 1,
): AttemptExecutionOptions {
  // Validate authorization input
  if (authorization.additionalAttempts !== 1) {
    throw new Error("attempt authorization additionalAttempts must equal 1");
  }
  if (authorization.confirm !== true) {
    throw new Error("attempt authorization requires confirm: true");
  }
  const reason = authorization.reason.trim();
  if (reason.length < 1 || reason.length > REASON_MAX_LENGTH) {
    throw new Error(`attempt authorization reason must be 1-${REASON_MAX_LENGTH} characters`);
  }
  const budget = authorization.maxBudgetUsd;
  if (budget !== null && (!Number.isFinite(budget) || budget <= 0)) {
    throw new Error("attempt authorization maxBudgetUsd must be null or a finite positive number");
  }
  if (budget !== null && budget > maximumBudgetUsd) {
    throw new Error(
      `attempt authorization maxBudgetUsd must not exceed execution.maximumBudgetUsd (${maximumBudgetUsd})`,
    );
  }

  // Check task eligibility
  const task = store.getTask(taskId);
  if (!eligibleStatus(task)) {
    throw new Error(`Task ${taskId} cannot authorize an extra attempt from status ${task.status}`);
  }

  // Contract-infeasible terminals forbid same-policy extra Attempts. Main must
  // revise the Task Contract boundary before any further Worker work.
  {
    const category = failureCategoryForTask(task.status, store.listEvents(taskId));
    if (blocksSamePolicyRetry(category)) {
      throw new Error(samePolicyRetryBlockedMessage(category));
    }
  }

  // Resolve durable grant history
  const attempts = store.listAttempts(taskId);
  const events = store.listEvents(taskId);
  const attemptOrdinals = new Set(attempts.map((a) => a.ordinal));
  const { extraConsumed, pendingGrant } = resolveGrantState(
    events, attemptOrdinals, configuredMaxAttempts,
  );

  // Pending grant: recover idempotently or reject conflict
  if (pendingGrant) {
    if (pendingGrant.kind !== "extra") {
      throw new Error(
        `pending grant for ordinal ${pendingGrant.targetOrdinal} is a correction, not an extra attempt`,
      );
    }
    if (pendingGrant.maxBudgetUsd !== budget || pendingGrant.reason !== reason) {
      throw new Error(
        `pending extra attempt grant for ordinal ${pendingGrant.targetOrdinal} conflicts with requested authorization`,
      );
    }
    return {
      maximumOrdinal: pendingGrant.targetOrdinal,
      maxBudgetUsdOverride: pendingGrant.maxBudgetUsd,
      authorizationEventSequence: pendingGrant.eventSequence,
    };
  }

  // No pending grant — issue a new one if within policy
  if (maxExtraAttempts === 0) {
    throw new Error("execution.maxExtraAttempts is zero; extra attempts are disabled");
  }
  if (extraConsumed >= maxExtraAttempts) {
    throw new Error(`maximum extra attempt grants (${maxExtraAttempts}) already used`);
  }

  const baseAttempts = attempts.filter((a) => a.ordinal <= configuredMaxAttempts);
  if (baseAttempts.length < configuredMaxAttempts || baseAttempts.some((a) => a.status === "running")) {
    throw new Error(
      `Task ${taskId} must have at least ${configuredMaxAttempts} terminal base attempts before extra authorization`,
    );
  }
  // Every earlier extra ordinal must also be terminal
  const extraAttempts = attempts.filter((a) => a.ordinal > configuredMaxAttempts);
  if (extraAttempts.some((a) => a.status === "running")) {
    throw new Error(
      `Task ${taskId} has a non-terminal extra attempt; all earlier extra ordinals must finish before granting the next`,
    );
  }

  // Issue new grant — globally sequential ordinal
  const nextOrdinal = Math.max(...attemptOrdinals) + 1;
  const event = store.addEvent(
    taskId,
    task.currentAttemptId,
    "attempt.authorization.granted",
    `One extra Attempt authorized for ordinal ${nextOrdinal}`,
    {
      kind: "extra",
      additionalAttempts: 1,
      targetOrdinal: nextOrdinal,
      maxBudgetUsd: budget,
      budgetMode: budget === null ? "uncapped-for-authorized-attempt" : "capped-for-authorized-attempt",
      reason,
    },
  );
  return {
    maximumOrdinal: nextOrdinal,
    maxBudgetUsdOverride: budget,
    authorizationEventSequence: event.sequence,
  };
}

/** MainCorrectionAuthorization mirrors AttemptAuthorization but is explicitly
 *  for a bounded Main correction (same-candidate reuse). */
export interface MainCorrectionAuthorization {
  /** Bounded non-empty canonical feedback (trimmed). */
  feedback: string;
  /** Per-Attempt runtime budget; null = uncapped. */
  maxBudgetUsd: number | null;
  /** Explicit confirmation. */
  confirm: true;
  /** Candidate revision id this correction is bound to. */
  candidateRevisionId?: string;
  /** Validated canonical Gap Contract. Omitted only for legacy unstructured correction. */
  gapContract?: CandidateGapContract;
}

/** Authorize one Main-authorized bounded candidate correction for a failed
 *  or interrupted Task. Independent from maxExtraAttempts — limited only by
 *  the Task's frozen maxMainCorrections. */
export function authorizeMainCorrection(
  store: StateStore,
  taskId: string,
  authorization: MainCorrectionAuthorization,
  configuredMaxAttempts: number,
  maxMainCorrections: number,
  maximumBudgetUsd = cloneDefaults().execution.maximumBudgetUsd,
): AttemptExecutionOptions {
  // Validate authorization input
  if (authorization.confirm !== true) {
    throw new Error("correction authorization requires confirm: true");
  }
  const feedback = authorization.feedback.trim();
  if (feedback.length < 1 || feedback.length > REASON_MAX_LENGTH) {
    throw new Error(
      `correction authorization feedback must be 1-${REASON_MAX_LENGTH} characters`,
    );
  }
  const budget = authorization.maxBudgetUsd;
  if (budget !== null && (!Number.isFinite(budget) || budget <= 0)) {
    throw new Error("correction authorization maxBudgetUsd must be null or a finite positive number");
  }
  if (budget !== null && budget > maximumBudgetUsd) {
    throw new Error(
      `correction authorization maxBudgetUsd must not exceed execution.maximumBudgetUsd (${maximumBudgetUsd})`,
    );
  }
  const structuredDigest = authorization.gapContract === undefined
    ? undefined
    : computeGapContractDigest(authorization.gapContract);

  // Check task eligibility
  const task = store.getTask(taskId);
  if (task.status !== "failed" && task.status !== "interrupted") {
    // Succeeded tasks are eligible only when the latest Main Review is a typed
    // revise bound to the latest attempt and verification. Uses the same
    // canonical binding helpers as resolveCorrectionEligibility.
    if (task.status !== "succeeded") {
      throw new Error(
        `Task ${taskId} cannot authorize a correction from status ${task.status}`,
      );
    }
    const events = store.listEvents(taskId);
    const attempts = store.listAttempts(taskId);
    const latestAttempt = attempts.reduce<AttemptRecord | undefined>(
      (latest, a) => latest === undefined || a.ordinal > latest.ordinal ? a : latest,
      undefined,
    );
    if (
      latestAttempt === undefined
      || !isLatestMainReviewRevise(events, latestAttempt.id, latestVerificationSequence(events))
    ) {
      throw new Error(
        "correction rejected: Task succeeded but Main has not recorded a valid revise decision bound to the latest Attempt",
      );
    }
  }

  // Competition Candidates use the same bounded correction authority, but
  // only after an exact Competition-level Main revise. No machine result or
  // Task-level review alone can cross this boundary.
  const competitionId = store.getCompetitionByCandidateTaskId(taskId);
  if (competitionId !== undefined) {
    const competitionEvents = store.listEvents(taskId);
    const competitionAttempts = store.listAttempts(taskId);
    const latestAttempt = competitionAttempts.reduce<AttemptRecord | undefined>(
      (latest, candidate) => latest === undefined || candidate.ordinal > latest.ordinal
        ? candidate
        : latest,
      undefined,
    );
    const latestRevision = resolveLatestRevision(competitionEvents);
    if (
      latestAttempt === undefined
      || latestRevision === undefined
      || !hasExactCompetitionMainRevise(
        store,
        taskId,
        latestAttempt.id,
        latestVerificationSequence(competitionEvents),
        latestRevision,
      )
    ) {
      throw new Error(
        "correction rejected: Competition Main must revise this exact Candidate Revision first",
      );
    }
  }

  // Resolve durable grant history
  const attempts = store.listAttempts(taskId);
  const events = store.listEvents(taskId);
  const attemptOrdinals = new Set(attempts.map((a) => a.ordinal));
  const { correctionConsumed, pendingGrant } = resolveGrantState(
    events, attemptOrdinals, configuredMaxAttempts,
  );

  // Pending grant: recover idempotently or reject conflict
  if (pendingGrant) {
    if (pendingGrant.kind !== "correction") {
      throw new Error(
        `pending grant for ordinal ${pendingGrant.targetOrdinal} is an extra grant, not a correction`,
      );
    }
    // Idempotent recovery: only allow identical revision, contract digest, feedback and budget
    const payloadMatch =
      pendingGrant.maxBudgetUsd === budget
      && pendingGrant.feedback === feedback
      && pendingGrant.candidateRevisionId === authorization.gapContract?.candidateRevisionId
      && pendingGrant.gapContractDigest === structuredDigest;
    if (!payloadMatch) {
      throw new Error(
        `pending correction grant for ordinal ${pendingGrant.targetOrdinal} conflicts with requested authorization`,
      );
    }
    return {
      maximumOrdinal: pendingGrant.targetOrdinal,
      maxBudgetUsdOverride: pendingGrant.maxBudgetUsd,
      authorizationEventSequence: pendingGrant.eventSequence,
    };
  }

  // No pending grant — issue a new one if within cap
  if (maxMainCorrections === 0) {
    throw new Error("maxMainCorrections is zero; Main corrections are disabled");
  }
  if (correctionConsumed >= maxMainCorrections) {
    throw new Error(`maximum Main correction grants (${maxMainCorrections}) already used`);
  }

  if (attempts.length === 0) {
    throw new Error(`Task ${taskId} has no candidate Attempt to correct`);
  }
  if (attempts.some((a) => a.status === "running")) {
    throw new Error(
      `Task ${taskId} has a running Attempt; it must finish before correction authorization`,
    );
  }

  // Issue new grant — globally sequential ordinal
  const nextOrdinal = Math.max(...attemptOrdinals) + 1;

  // Determine prior attempt identity for lineage
  const priorAttempt = attempts.length > 0
    ? attempts.reduce((latest, a) => a.ordinal > latest.ordinal ? a : latest)
    : undefined;

  const event = store.addEvent(
    taskId,
    task.currentAttemptId,
    "attempt.authorization.granted",
    `One Main correction authorized for ordinal ${nextOrdinal}`,
    {
      kind: "correction",
      additionalAttempts: 1,
      targetOrdinal: nextOrdinal,
      maxBudgetUsd: budget,
      budgetMode: budget === null ? "uncapped-for-authorized-attempt" : "capped-for-authorized-attempt",
      reason: "main-correction",
      feedback,
      priorAttemptId: priorAttempt!.id,
      ...(authorization.gapContract === undefined
        ? {}
        : {
          candidateRevisionId: authorization.gapContract.candidateRevisionId,
          gapContractDigest: structuredDigest,
          gapContract: authorization.gapContract,
        }),
    },
  );
  return {
    maximumOrdinal: nextOrdinal,
    maxBudgetUsdOverride: budget,
    authorizationEventSequence: event.sequence,
  };
}
