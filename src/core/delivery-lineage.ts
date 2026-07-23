import type {
  AttemptRecord,
  DeliveryLineage,
  EventRecord,
  PatchEvidence,
  WorkspacePatchReport,
} from "./types.js";

interface DiffMeasure {
  filesChanged: number;
  changedLines: number;
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPatchEvidence(value: unknown): value is PatchEvidence {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<PatchEvidence>;
  return isNonnegativeInteger(candidate.filesChanged)
    && isNonnegativeInteger(candidate.changedLines);
}

function patchReport(event: EventRecord | undefined): WorkspacePatchReport | undefined {
  if (event?.payload === null || typeof event?.payload !== "object") return undefined;
  const patches = (event.payload as { patches?: unknown }).patches;
  if (patches === null || typeof patches !== "object") return undefined;
  const candidate = patches as Partial<WorkspacePatchReport>;
  if (
    !isPatchEvidence(candidate.business)
    || !isPatchEvidence(candidate.generated)
    || !isPatchEvidence(candidate.integration)
  ) {
    return undefined;
  }
  return {
    business: candidate.business,
    generated: candidate.generated,
    integration: candidate.integration,
  };
}

function measure(evidence: PatchEvidence): DiffMeasure {
  return {
    filesChanged: evidence.filesChanged,
    changedLines: evidence.changedLines,
  };
}

export function buildDeliveryLineage(
  attempts: readonly AttemptRecord[],
  events: readonly EventRecord[],
): DeliveryLineage {
  const orderedAttempts = [...attempts].sort(
    (left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id),
  );
  const attemptIds = new Set(orderedAttempts.map((attempt) => attempt.id));
  const latestVerificationByAttempt = new Map<string, EventRecord>();
  for (const event of events) {
    if (
      event.type !== "verification.completed"
      || event.attemptId === undefined
      || !attemptIds.has(event.attemptId)
    ) {
      continue;
    }
    const previous = latestVerificationByAttempt.get(event.attemptId);
    if (previous === undefined || event.sequence > previous.sequence) {
      latestVerificationByAttempt.set(event.attemptId, event);
    }
  }

  const missingAttemptIds: string[] = [];
  const hopChurn: DiffMeasure = { filesChanged: 0, changedLines: 0 };
  for (const attempt of orderedAttempts) {
    const patches = patchReport(latestVerificationByAttempt.get(attempt.id));
    if (patches === undefined) {
      missingAttemptIds.push(attempt.id);
      continue;
    }
    hopChurn.filesChanged += patches.business.filesChanged;
    hopChurn.changedLines += patches.business.changedLines;
  }

  const finalAttempt = orderedAttempts.at(-1);
  const finalPatches = finalAttempt === undefined
    ? undefined
    : patchReport(latestVerificationByAttempt.get(finalAttempt.id));
  const firstOrdinal = orderedAttempts[0]?.ordinal;

  return {
    complete: missingAttemptIds.length === 0,
    missingAttemptIds,
    attemptCount: orderedAttempts.length,
    verifiedAttemptCount: latestVerificationByAttempt.size,
    hopChurn,
    combinedDeliveryDiff: finalPatches === undefined
      ? { filesChanged: 0, changedLines: 0 }
      : measure(finalPatches.integration),
    correctionAttemptIds: firstOrdinal === undefined
      ? []
      : orderedAttempts
          .filter((attempt) => attempt.ordinal > firstOrdinal)
          .map((attempt) => attempt.id),
  };
}
