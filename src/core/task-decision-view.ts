import { buildDeliveryLineage } from "./delivery-lineage.js";
import { latestMainReview } from "./main-review.js";
import { latestTaskResolutionState } from "./task-resolution.js";
import {
  buildStatusProgress,
  DEFAULT_QUIET_AFTER_MS,
  toLiveStageEvents,
  type LatestEventMeta,
  type PreparationStageCursor,
} from "./task-progress.js";
import type {
  AttemptRecord,
  CheckpointReport,
  EventRecord,
  IntegrationOperationView,
  IntegrationResultRecord,
  RemediationDisposition,
  TaskDecisionView,
  TaskRecord,
  VerificationResult,
  WorkerClaim,
} from "./types.js";
import { failureCategoryForTask } from "./worker-failure.js";

const WORKER_CLAIM_PREVIEW_MAX_CHARS = 360;
const WORKER_CLAIM_TRUNCATION_MARKER =
  "\n\n[Truncated; use deep inspect for the full Worker output.]";

function workerClaimPreview(text: string): string {
  const normalized = text.trim();
  if (normalized.length <= WORKER_CLAIM_PREVIEW_MAX_CHARS) return normalized;
  return normalized.slice(
    0,
    WORKER_CLAIM_PREVIEW_MAX_CHARS - WORKER_CLAIM_TRUNCATION_MARKER.length,
  ) + WORKER_CLAIM_TRUNCATION_MARKER;
}

function latestEvent(
  events: readonly EventRecord[],
  type: EventRecord["type"],
): EventRecord | undefined {
  return events
    .filter((event) => event.type === type)
    .reduce<EventRecord | undefined>(
      (latest, event) =>
        latest === undefined || event.sequence > latest.sequence ? event : latest,
      undefined,
    );
}

function objectPayload(event: EventRecord | undefined): Record<string, unknown> | undefined {
  return event?.payload !== null && typeof event?.payload === "object"
    ? event.payload as Record<string, unknown>
    : undefined;
}

function preparationStage(
  task: TaskRecord,
  events: readonly EventRecord[],
): PreparationStageCursor | undefined {
  if (task.status !== "preparing") return undefined;
  const payload = objectPayload(latestEvent(events, "workspace.preparation.stage"));
  if (
    typeof payload?.stage !== "string"
    || (payload.phase !== "start" && payload.phase !== "complete")
    || typeof payload.elapsedMs !== "number"
    || !Number.isFinite(payload.elapsedMs)
  ) {
    return undefined;
  }
  return {
    stage: payload.stage,
    phase: payload.phase,
    elapsedMs: payload.elapsedMs,
    ...(payload.countKind === "files" || payload.countKind === "dependencies"
      ? { countKind: payload.countKind }
      : {}),
    ...(typeof payload.count === "number" && Number.isFinite(payload.count)
      ? { count: payload.count }
      : {}),
  };
}

function workerClaim(
  task: TaskRecord,
  events: readonly EventRecord[],
): TaskDecisionView["workerClaim"] {
  const payload = objectPayload(latestEvent(events, "worker.completed"));
  const structured = payload?.claim;
  let claim: WorkerClaim | undefined;
  if (
    structured !== null
    && typeof structured === "object"
    && (structured as { label?: unknown }).label === "unverified-claim"
    && typeof (structured as { text?: unknown }).text === "string"
  ) {
    claim = structured as WorkerClaim;
  } else if (typeof payload?.result === "string") {
    claim = { label: "unverified-claim", text: payload.result };
  }
  return claim === undefined
    ? undefined
    : {
        ...claim,
        text: workerClaimPreview(claim.text),
        provider: task.spec.provider.name,
        model: task.spec.provider.model,
      };
}

function checkpoint(events: readonly EventRecord[]): CheckpointReport | undefined {
  const payload = objectPayload(latestEvent(events, "checkpoint.completed"));
  return payload?.authority === "non-authoritative-checkpoint"
    && typeof payload.attemptId === "string"
    && Array.isArray(payload.commands)
    && payload.patches !== null
    && typeof payload.patches === "object"
    ? payload as unknown as CheckpointReport
    : undefined;
}

function verification(events: readonly EventRecord[]): VerificationResult | undefined {
  const payload = objectPayload(latestEvent(events, "verification.completed"));
  if (
    typeof payload?.passed === "boolean"
    && typeof payload.behaviorPassed === "boolean"
    && typeof payload.policyPassed === "boolean"
    && typeof payload.sourceCompatible === "boolean"
    && Array.isArray(payload.commands)
    && typeof payload.diffPath === "string"
    && typeof payload.sourceUnchanged === "boolean"
  ) {
    const commands = payload.commands.flatMap((value) => {
      if (value === null || typeof value !== "object") return [];
      const command = value as Record<string, unknown>;
      if (
        typeof command.command !== "string"
        || !Number.isSafeInteger(command.exitCode)
        || typeof command.stdout !== "string"
        || typeof command.stderr !== "string"
        || typeof command.durationMs !== "number"
        || typeof command.timedOut !== "boolean"
      ) {
        return [];
      }
      return [{
        command: command.command,
        exitCode: command.exitCode as number,
        stdout: command.stdout,
        stderr: command.stderr,
        durationMs: command.durationMs,
        timedOut: command.timedOut,
      }];
    });
    if (commands.length !== payload.commands.length) return undefined;
    return {
      passed: payload.passed,
      behaviorPassed: payload.behaviorPassed,
      policyPassed: payload.policyPassed,
      sourceCompatible: payload.sourceCompatible,
      commands,
      diffPath: payload.diffPath,
      sourceUnchanged: payload.sourceUnchanged,
    };
  }
  return undefined;
}

function integrationView(
  taskId: string,
  events: readonly EventRecord[],
  results: readonly IntegrationResultRecord[],
): IntegrationOperationView | undefined {
  const started = latestEvent(events, "integration.operation.started");
  const startPayload = objectPayload(started);
  const latestResult = [...results]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .at(-1);
  const operationId =
    typeof startPayload?.operationId === "string"
      ? startPayload.operationId
      : latestResult?.id;
  const receiptId =
    typeof startPayload?.receiptId === "string"
      ? startPayload.receiptId
      : results.find((candidate) => candidate.id === operationId)?.receiptId;
  if (operationId === undefined || receiptId === undefined) return undefined;
  const result = results.find((candidate) => candidate.id === operationId);
  const stages = result?.stages ?? events
    .filter((event) => event.type === "integration.stage.completed")
    .flatMap((event) => {
      const payload = objectPayload(event);
      if (payload?.operationId !== operationId) return [];
      const evidence = payload.evidence;
      return evidence !== null && typeof evidence === "object"
        ? [evidence as IntegrationOperationView["stages"][number]]
        : [];
    });
  const recovered = events.some((event) => {
    const payload = objectPayload(event);
    return event.type === "integration.operation.recovered"
      && payload?.operationId === operationId;
  });
  return {
    operationId,
    taskId,
    receiptId,
    status: result !== undefined ? "completed" : recovered ? "outcome-unknown" : "running",
    stages,
    ...(result === undefined ? {} : { result }),
  };
}

function stageAndAction(input: {
  task: TaskRecord;
  verification?: VerificationResult;
  review?: ReturnType<typeof latestMainReview>;
  integration?: IntegrationOperationView;
}): Pick<TaskDecisionView, "stage" | "nextAction"> {
  const integration = input.integration;
  if (integration !== undefined) {
    if (integration.result === undefined) {
      return {
        stage: "integrating",
        nextAction: integration.status === "outcome-unknown"
          ? "Query this Integration operation again; its outcome is not yet known"
          : "Wait for Integration stages to complete",
      };
    }
    if (integration.result.status !== "applied") {
      return {
        stage: "integration-failed",
        nextAction: "Review Integration evidence and choose recovery or correction",
      };
    }
    const runtime = integration.stages.find(
      (stage) => stage.stage === "runtime-activated",
    );
    if (runtime?.status === "passed") {
      return { stage: "activated", nextAction: "Delivery is active" };
    }
    if (runtime?.status === "not-applicable") {
      return {
        stage: "delivered",
        nextAction: "Delivery is complete; runtime activation was not required",
      };
    }
    return {
      stage: "applied-not-activated",
      nextAction: "Run or verify activation",
    };
  }

  if (input.review?.decision === "revise") {
    return {
      stage: "revision-requested",
      nextAction: "Resume with the Main agent review reason",
    };
  }
  if (input.review?.decision === "reject") {
    return {
      stage: "main-rejected",
      nextAction: "Stop or revise only with a new explicit decision",
    };
  }
  if (input.review?.decision === "accept") {
    return {
      stage: "ready-for-integration",
      nextAction: "User may authorize Integration",
    };
  }
  if (input.verification !== undefined) {
    if (!input.verification.passed) {
      return {
        stage: "machine-failed",
        nextAction: "Review remediation and decide whether to resume",
      };
    }
    return {
      stage: "awaiting-main-review",
      nextAction: "Main agent must review",
    };
  }
  if (
    input.task.status === "preparing"
    || input.task.status === "running"
    || input.task.status === "verifying"
  ) {
    return {
      stage: "worker-running",
      nextAction: "Wait for independent verification",
    };
  }
  if (
    input.task.status === "queued"
    || input.task.status === "waiting"
    || input.task.status === "blocked"
  ) {
    return {
      stage: "queued",
      nextAction: input.task.status === "blocked"
        ? "Resolve the blocking prerequisite"
        : "Wait for execution to start",
    };
  }
  return {
    stage: "unknown",
    nextAction: "Inspect the audit timeline for missing evidence",
  };
}

export function buildTaskDecisionView(input: {
  task: TaskRecord;
  attempts: readonly AttemptRecord[];
  events: readonly EventRecord[];
  integrationResults: readonly IntegrationResultRecord[];
  remediationDisposition?: RemediationDisposition;
  /** Injected clock for activity classification; defaults to Date.now(). */
  nowMs?: number;
  quietAfterMs?: number;
}): TaskDecisionView {
  const orderedEvents = [...input.events].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const latest = orderedEvents.at(-1);
  const latestVerification = verification(orderedEvents);
  const review = latestMainReview(orderedEvents);
  const latestVerificationEvent = latestEvent(orderedEvents, "verification.completed");
  const currentReview =
    review !== undefined
    && latestVerificationEvent !== undefined
    && review.verificationEventSequence === latestVerificationEvent.sequence
      ? review
      : undefined;
  const integration = integrationView(
    input.task.id,
    orderedEvents,
    input.integrationResults,
  );
  const decision = stageAndAction({
    task: input.task,
    ...(latestVerification === undefined ? {} : { verification: latestVerification }),
    ...(currentReview === undefined ? {} : { review: currentReview }),
    ...(integration === undefined ? {} : { integration }),
  });
  const claim = workerClaim(input.task, orderedEvents);
  const checkpointReport = checkpoint(orderedEvents);
  const latestMeta: LatestEventMeta | undefined = latest === undefined
    ? undefined
    : {
      sequence: latest.sequence,
      timestamp: latest.timestamp,
      type: latest.type,
      summary: latest.summary,
    };
  const latestPreparationStage = preparationStage(input.task, orderedEvents);
  // FL-D83: activity is last-event age, not frozen tasks.updatedAt. MCP status
  // and Console Decision View share this progress model with CLI status.
  // liveStage is rebuilt from ordered durable events so daemon restart preserves
  // open tool / model / verification truth without Provider calls or mutation.
  const progress = buildStatusProgress(
    input.task,
    latestMeta,
    input.nowMs ?? Date.now(),
    input.quietAfterMs ?? DEFAULT_QUIET_AFTER_MS,
    latestPreparationStage,
    toLiveStageEvents(orderedEvents),
  );
  // Same gate as CLI list / listTaskSurfaces: do not leak historical categories
  // onto succeeded, running, or queued tasks after revise/resume.
  const failureCategory = failureCategoryForTask(input.task.status, orderedEvents);
  // Latest explicit Main attention resolution from durable events. The Core
  // owns this state; detailed surfaces only translate it.
  const attentionResolution = latestTaskResolutionState(orderedEvents);
  return {
    taskId: input.task.id,
    ...decision,
    ...(claim === undefined ? {} : { workerClaim: claim }),
    ...(checkpointReport === undefined ? {} : { checkpoint: checkpointReport }),
    ...(latestVerification === undefined ? {} : { verification: latestVerification }),
    ...(currentReview === undefined ? {} : { mainReview: currentReview }),
    lineage: buildDeliveryLineage(input.attempts, orderedEvents),
    ...(integration === undefined ? {} : { integration }),
    progress,
    ...(failureCategory === undefined ? {} : { failureCategory }),
    ...(input.remediationDisposition === undefined
      ? {}
      : { remediationDisposition: input.remediationDisposition }),
    // Only failed/interrupted Tasks project attention resolution; forged
    // resolution evidence on other statuses fails open to Now.
    ...(attentionResolution.status === "none"
      || (input.task.status !== "failed" && input.task.status !== "interrupted")
      ? {}
      : { attentionResolution }),
  };
}
