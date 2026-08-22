import {
  classifyRuntimeActivity,
  isEffectiveProgressEvent,
  isRuntimeSignalEvent,
  isWorkerStartBaseline,
  RUNTIME_ACTIVITY_EFFECTIVE,
} from "./runtime-activity.js";
import type {
  DualClockProjection,
  EventType,
  LiveStageEvidence,
  LiveStageMeaning,
  LiveStageNext,
  LiveStageProjection,
  LiveStageCode,
  TaskDecisionView,
  TaskRecord,
  TaskStatus,
} from "./types.js";

/** Open follow-up operation kind derived from unmatched durable start events. */
type PostTerminalFollowUp = "candidate-reverifying" | "remediation-checking";

/** Default quiet window for last-event activity (30s). Shared by CLI status/wait and Decision View. */
export const DEFAULT_QUIET_AFTER_MS = 30_000;

const TERMINAL_STATUSES = new Set<TaskStatus>(["succeeded", "failed", "interrupted"]);

export type ProgressActivity = "active" | "quiet" | "terminal";

/** True when Task status will never receive further Worker progress. */
export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** O(1) latest-event cursor fields used by status/wait without loading full payloads. */
export interface LatestEventMeta {
  sequence: number;
  timestamp: string;
  type: EventType | string;
  summary: string;
}

/** Privacy-safe structured snapshot of the current workspace-preparation
 *  stage. It carries no paths, file names, credentials, commands, prompts,
 *  raw errors, invented percentages, or ETA. */
export interface PreparationStageCursor {
  stage: string;
  phase: "start" | "complete";
  elapsedMs: number;
  countKind?: "files" | "dependencies";
  count?: number;
}

/**
 * Minimal ordered event evidence for live-stage replay. Payload is optional and
 * only inspected for closed activityKind / toolUseId fields — never for prose.
 */
export interface LiveStageEventEvidence {
  sequence: number;
  timestamp: string;
  type: EventType | string;
  payload?: unknown;
}

/** Structured model-activity marker written by runtime normalizers. */
const MODEL_ACTIVITY_KIND = "model-response" as const;

/** Closed model-processing marker: the runtime reports active reasoning without
 *  visible output. Distinct from observable model response. */
const MODEL_PROCESSING_KIND = "model-processing" as const;

function payloadObject(payload: unknown): Record<string, unknown> | undefined {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  return payload as Record<string, unknown>;
}

function hasModelActivity(payload: unknown): boolean {
  return payloadObject(payload)?.activityKind === MODEL_ACTIVITY_KIND;
}

function hasModelProcessing(payload: unknown): boolean {
  return payloadObject(payload)?.activityKind === MODEL_PROCESSING_KIND;
}

function toolUseId(payload: unknown): string | undefined {
  const id = payloadObject(payload)?.toolUseId;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

/**
 * Detect an open post-terminal follow-up operation from ordered durable events.
 * An open Candidate reverification exists when the latest
 * candidate.reverification.started has a higher sequence than the latest
 * candidate.reverification.completed. An open remediation check follows the
 * same rule with remediation.check.started / remediation.check.completed.
 *
 * Intermediate verification command, verification completion, and revision-
 * capture events that follow the start do not close the operation — only
 * the matching completion event does.
 *
 * When both are anomalously open, only the one with the newer start sequence
 * is reported; the other is never guessed closed.
 *
 * Returns undefined when every start has a matching completion or no follow-up
 * events exist at all. Never parses summary text, exposes payloads, or infers
 * process liveness.
 */
export function detectOpenFollowUp(
  events: readonly LiveStageEventEvidence[],
): PostTerminalFollowUp | undefined {
  let lastReverificationStarted = -1;
  let lastReverificationCompleted = -1;
  let lastRemediationStarted = -1;
  let lastRemediationCompleted = -1;

  for (const event of events) {
    const type = String(event.type);
    if (type === "candidate.reverification.started") {
      lastReverificationStarted = event.sequence;
    } else if (type === "candidate.reverification.completed") {
      lastReverificationCompleted = event.sequence;
    } else if (type === "remediation.check.started") {
      lastRemediationStarted = event.sequence;
    } else if (type === "remediation.check.completed") {
      lastRemediationCompleted = event.sequence;
    }
  }

  const reverificationOpen = lastReverificationStarted > lastReverificationCompleted;
  const remediationOpen = lastRemediationStarted > lastRemediationCompleted;

  if (reverificationOpen && remediationOpen) {
    // Both open: report the newer start; do not guess the other closed.
    return lastReverificationStarted > lastRemediationStarted
      ? "candidate-reverifying"
      : "remediation-checking";
  }

  if (reverificationOpen) return "candidate-reverifying";
  if (remediationOpen) return "remediation-checking";
  return undefined;
}

/** True when a live-stage code represents an open post-terminal follow-up. */
export function isOpenFollowUpStage(stage: LiveStageCode | undefined): boolean {
  return stage === "candidate-reverifying" || stage === "remediation-checking";
}

function nextForStage(stage: LiveStageCode, observation: ProgressActivity): LiveStageNext {
  // Follow-up stages: next action describes waiting for the local check result.
  if (stage === "candidate-reverifying") return "wait-for-reverification-result";
  if (stage === "remediation-checking") return "wait-for-remediation-result";
  if (
    observation === "quiet"
    && stage !== "failed"
    && stage !== "interrupted"
    && stage !== "completed"
    && stage !== "worker-finished"
  ) {
    return "wait-for-new-evidence";
  }
  switch (stage) {
    case "preparing-workspace":
      return "wait-for-preparation";
    case "waiting-for-model":
      return "wait-for-model";
    case "model-processing":
    case "model-responding":
      return "wait-for-next-model-step";
    case "using-tool":
      return "wait-for-tool-result";
    case "worker-finished":
      // Worker is done; independent checks are the deterministic next step,
      // so the quiet window does not downgrade this to generic new evidence.
      return "wait-for-verification-start";
    case "verifying":
      return "wait-for-verification-result";
    case "failed":
    case "interrupted":
      return "inspect-failure";
    case "legacy-running":
    case "queued":
      return "wait-for-new-evidence";
    case "completed":
    case "unknown":
    default:
      return "none";
  }
}

function meaningForStage(stage: LiveStageCode): LiveStageMeaning {
  if (stage === "failed" || stage === "interrupted") return "attention";
  // Follow-up on a terminal Task is a normal local check — never an alarm.
  return "normal";
}

function baseProjection(
  stage: LiveStageCode,
  observation: ProgressActivity,
  evidence: LiveStageEvidence,
  cursor?: { timestamp?: string; sequence?: number },
): LiveStageProjection {
  return {
    stage,
    observation,
    evidence,
    meaning: meaningForStage(stage),
    next: nextForStage(stage, observation),
    ...(cursor?.timestamp === undefined ? {} : { observedAt: cursor.timestamp }),
    ...(cursor?.sequence === undefined ? {} : { evidenceSequence: cursor.sequence }),
  };
}

/**
 * Classify Worker activity from Task status + latest event age (FL-D83).
 * `tasks.updatedAt` is frozen between spawn and terminal, so callers must not
 * treat updatedAt as a liveness signal.
 */
export function classifyActivity(
  task: TaskRecord,
  latestEvent: LatestEventMeta | undefined,
  nowMs: number,
  quietAfterMs: number,
): ProgressActivity {
  if (isTerminalTaskStatus(task.status)) return "terminal";
  if (latestEvent === undefined) return "quiet";
  const eventMs = Date.parse(latestEvent.timestamp);
  if (!Number.isFinite(eventMs)) return "quiet";
  return nowMs - eventMs <= quietAfterMs ? "active" : "quiet";
}

/**
 * Rebuild the canonical privacy-safe live stage from Task status and ordered
 * durable event evidence. Pure: no mutation, retry, Provider call, ETA, or
 * free-text inference. Quiet is only an observation about event age.
 */
export function projectLiveStage(
  task: TaskRecord,
  events: readonly LiveStageEventEvidence[],
  nowMs: number,
  quietAfterMs: number = DEFAULT_QUIET_AFTER_MS,
  preparationStage?: PreparationStageCursor,
): LiveStageProjection {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  const latest = ordered.at(-1);
  const observation = classifyActivity(
    task,
    latest === undefined
      ? undefined
      : {
          sequence: latest.sequence,
          timestamp: latest.timestamp,
          type: latest.type,
          summary: "",
        },
    nowMs,
    quietAfterMs,
  );

  if (isTerminalTaskStatus(task.status)) {
    // Check for open post-terminal follow-up operations before defaulting to
    // the terminal stage. The raw Task status stays unchanged; only the
    // canonical live-stage projection shows the open follow-up.
    const followUp = detectOpenFollowUp(ordered);
    if (followUp !== undefined) {
      const evidence: LiveStageEvidence = followUp === "candidate-reverifying"
        ? "candidate-reverification"
        : "remediation-check";
      // Candidate reverification has existing command / verification / revision
      // evidence between its start and completion. Use the newest relevant row
      // so a recent command completion is visible activity. Main remediation
      // currently emits only start + completion, so its start remains the cursor.
      const relevantCandidateEvidence = new Set([
        "candidate.reverification.started",
        "verification.started",
        "verification.command.completed",
        "verification.completed",
        "candidate.revision.captured",
        "candidate.revision.capture.failed",
      ]);
      let cursorEvent: LiveStageEventEvidence | undefined;
      for (const event of ordered) {
        const type = String(event.type);
        const relevant = followUp === "candidate-reverifying"
          ? relevantCandidateEvidence.has(type)
          : type === "remediation.check.started";
        if (relevant) cursorEvent = event;
      }
      // detectOpenFollowUp proves a matching start exists. Keep this guard
      // fail-closed for malformed input rather than inventing activity.
      if (cursorEvent !== undefined) {
        const eventMs = Date.parse(cursorEvent.timestamp);
        const followUpObs: ProgressActivity = Number.isFinite(eventMs)
          && nowMs - eventMs <= quietAfterMs
          ? "active"
          : "quiet";
        return baseProjection(followUp, followUpObs, evidence, {
          timestamp: cursorEvent.timestamp,
          sequence: cursorEvent.sequence,
        });
      }
    }

    const stage: LiveStageCode = task.status === "succeeded"
      ? "completed"
      : task.status === "interrupted"
        ? "interrupted"
        : "failed";
    let evidence: LiveStageEvidence = "status";
    let cursor: { timestamp?: string; sequence?: number } | undefined;
    for (let i = ordered.length - 1; i >= 0; i -= 1) {
      const event = ordered[i]!;
      if (
        event.type === "worker.failed"
        || event.type === "worker.completed"
        || event.type === "worker.interrupted"
        || event.type === "policy.noprogress.exceeded"
        || event.type === "policy.duration.exceeded"
        || event.type === "policy.token.exceeded"
        || event.type === "policy.size.exceeded"
        || event.type === "task.launch-preflight.failed"
        || event.type === "verification.completed"
      ) {
        evidence = event.type.startsWith("policy.")
          ? "policy"
          : event.type === "verification.completed"
            ? "verification"
            : "terminal";
        cursor = { timestamp: event.timestamp, sequence: event.sequence };
        break;
      }
    }
    if (cursor === undefined && latest !== undefined) {
      cursor = { timestamp: latest.timestamp, sequence: latest.sequence };
    }
    return baseProjection(stage, "terminal", evidence, cursor);
  }

  if (task.status === "queued" || task.status === "waiting" || task.status === "blocked") {
    return baseProjection(
      "queued",
      observation,
      "status",
      latest === undefined ? undefined : { timestamp: latest.timestamp, sequence: latest.sequence },
    );
  }

  if (task.status === "preparing") {
    return baseProjection(
      "preparing-workspace",
      observation,
      preparationStage === undefined ? "status" : "preparation",
      latest === undefined ? undefined : { timestamp: latest.timestamp, sequence: latest.sequence },
    );
  }

  if (task.status === "verifying") {
    let cursor: { timestamp?: string; sequence?: number } | undefined;
    for (let i = ordered.length - 1; i >= 0; i -= 1) {
      const event = ordered[i]!;
      if (
        event.type === "verification.started"
        || event.type === "verification.command.completed"
        || event.type === "verification.completed"
      ) {
        cursor = { timestamp: event.timestamp, sequence: event.sequence };
        break;
      }
    }
    if (cursor === undefined && latest !== undefined) {
      cursor = { timestamp: latest.timestamp, sequence: latest.sequence };
    }
    return baseProjection("verifying", observation, "verification", cursor);
  }

  // Replay Worker lifecycle for running (and any other non-terminal) status.
  const openTools = new Set<string>();
  let anonymousOpenTools = 0;
  let stage: LiveStageCode = "unknown";
  let evidence: LiveStageEvidence = "none";
  let cursor: { timestamp?: string; sequence?: number } | undefined;
  let sawStructuredWorkerEvidence = false;
  let verificationStarted = false;

  const setStage = (
    nextStage: LiveStageCode,
    nextEvidence: LiveStageEvidence,
    event: LiveStageEventEvidence,
  ): void => {
    stage = nextStage;
    evidence = nextEvidence;
    cursor = { timestamp: event.timestamp, sequence: event.sequence };
  };

  for (const event of ordered) {
    const type = String(event.type);

    if (type === "workspace.preparation.stage" || type === "workspace.prepared") {
      setStage("preparing-workspace", "preparation", event);
      continue;
    }

    if (type === "worker.started" || type === "worker.resumed") {
      openTools.clear();
      anonymousOpenTools = 0;
      // A later authorized Attempt starts a new Worker lifecycle after an
      // earlier verification. Its own evidence may advance normally.
      verificationStarted = false;
      sawStructuredWorkerEvidence = true;
      setStage("waiting-for-model", "worker-start", event);
      continue;
    }

    if (type === "worker.tool.started") {
      if (verificationStarted) continue;
      const id = toolUseId(event.payload);
      if (id !== undefined) openTools.add(id);
      else anonymousOpenTools += 1;
      sawStructuredWorkerEvidence = true;
      setStage("using-tool", "tool-lifecycle", event);
      continue;
    }

    if (type === "worker.tool.completed") {
      if (verificationStarted) continue;
      const id = toolUseId(event.payload);
      if (id !== undefined && openTools.has(id)) {
        openTools.delete(id);
      } else if (anonymousOpenTools > 0) {
        anonymousOpenTools -= 1;
      } else if (openTools.size > 0) {
        // Completion without id: close one unmatched open tool conservatively.
        const first = openTools.values().next().value as string | undefined;
        if (first !== undefined) openTools.delete(first);
      }
      sawStructuredWorkerEvidence = true;
      if (openTools.size > 0 || anonymousOpenTools > 0) {
        setStage("using-tool", "tool-lifecycle", event);
      } else {
        // Tool finished; Worker is waiting for the next model step.
        setStage("waiting-for-model", "tool-lifecycle", event);
      }
      continue;
    }

    if (type === "worker.message") {
      // Verification is a stronger, later phase. Delayed runtime telemetry or
      // narration cannot move a replayed Task back into a Worker stage.
      if (verificationStarted) continue;
      if (hasModelProcessing(event.payload)) {
        sawStructuredWorkerEvidence = true;
        if (openTools.size > 0 || anonymousOpenTools > 0) {
          // Open tool remains the strongest Worker stage.
          setStage("using-tool", "tool-lifecycle", event);
        } else {
          setStage("model-processing", "model-activity", event);
        }
      } else if (hasModelActivity(event.payload)) {
        sawStructuredWorkerEvidence = true;
        if (openTools.size > 0 || anonymousOpenTools > 0) {
          // Open tool remains the strongest Worker stage.
          setStage("using-tool", "tool-lifecycle", event);
        } else {
          setStage("model-responding", "model-activity", event);
        }
      } else if (!sawStructuredWorkerEvidence) {
        // Legacy message without activityKind: generic running, never invent a precise stage.
        setStage("legacy-running", "legacy", event);
      } else if (openTools.size === 0 && anonymousOpenTools === 0) {
        // Unrelated narration must not close an open tool (already guarded) and
        // must not invent model-responding without structured activityKind.
        if (stage === "unknown") {
          setStage("legacy-running", "legacy", event);
        }
      }
      continue;
    }

    if (type === "verification.started" || type === "verification.command.completed") {
      openTools.clear();
      anonymousOpenTools = 0;
      verificationStarted = true;
      setStage("verifying", "verification", event);
      continue;
    }

    if (type === "worker.completed") {
      if (verificationStarted) continue;
      openTools.clear();
      anonymousOpenTools = 0;
      // Worker finished; independent checks are the next expected step. Later
      // verification evidence or a terminal Task status still takes precedence
      // over this transition, so this never claims another model response.
      setStage("worker-finished", "terminal", event);
      continue;
    }

    if (
      type === "worker.failed"
      || type === "worker.interrupted"
      || type === "policy.noprogress.exceeded"
      || type === "policy.duration.exceeded"
      || type === "policy.token.exceeded"
      || type === "policy.size.exceeded"
      || type === "task.launch-preflight.failed"
    ) {
      openTools.clear();
      anonymousOpenTools = 0;
      const failedStage: LiveStageCode = type === "worker.interrupted" ? "interrupted" : "failed";
      setStage(
        failedStage,
        type.startsWith("policy.") ? "policy" : "terminal",
        event,
      );
    }
  }

  // Open tools win over later non-tool narration already handled in the loop.
  // Verification evidence clears open tools before setting stage, so any
  // remaining open tools here always mean using-tool in this non-terminal branch.
  if (openTools.size > 0 || anonymousOpenTools > 0) {
    stage = "using-tool";
    evidence = "tool-lifecycle";
  }

  if (stage === "unknown") {
    // No usable lifecycle evidence: honest generic running fallback.
    if (task.status === "running") {
      stage = "legacy-running";
      evidence = latest === undefined ? "status" : "legacy";
      cursor = latest === undefined
        ? undefined
        : { timestamp: latest.timestamp, sequence: latest.sequence };
    } else {
      return baseProjection(
        "unknown",
        observation,
        "none",
        latest === undefined ? undefined : { timestamp: latest.timestamp, sequence: latest.sequence },
      );
    }
  }

  return baseProjection(stage, observation, evidence, cursor);
}

/**
 * Coarse live-stage projection when only the latest-event cursor is available
 * (no ordered history). Prefer projectLiveStage with full events when possible.
 * Tool start/complete types are self-describing from the type alone; bare
 * worker.message without payload stays legacy-running (never invents model stage).
 */
function projectLiveStageFromLatest(
  task: TaskRecord,
  latestEvent: LatestEventMeta | undefined,
  nowMs: number,
  quietAfterMs: number = DEFAULT_QUIET_AFTER_MS,
  preparationStage?: PreparationStageCursor,
): LiveStageProjection {
  if (latestEvent === undefined) {
    return projectLiveStage(task, [], nowMs, quietAfterMs, preparationStage);
  }
  const type = String(latestEvent.type);
  const synthetic: LiveStageEventEvidence = {
    sequence: latestEvent.sequence,
    timestamp: latestEvent.timestamp,
    type: latestEvent.type,
  };
  // Bare worker.message without payload cannot prove model-activity.
  if (type === "worker.message") {
    if (isTerminalTaskStatus(task.status)) {
      return projectLiveStage(task, [synthetic], nowMs, quietAfterMs, preparationStage);
    }
    if (task.status === "preparing") {
      return baseProjection(
        "preparing-workspace",
        classifyActivity(task, latestEvent, nowMs, quietAfterMs),
        preparationStage === undefined ? "status" : "preparation",
        { timestamp: latestEvent.timestamp, sequence: latestEvent.sequence },
      );
    }
    if (task.status === "verifying") {
      return baseProjection(
        "verifying",
        classifyActivity(task, latestEvent, nowMs, quietAfterMs),
        "verification",
        { timestamp: latestEvent.timestamp, sequence: latestEvent.sequence },
      );
    }
    return baseProjection(
      "legacy-running",
      classifyActivity(task, latestEvent, nowMs, quietAfterMs),
      "legacy",
      { timestamp: latestEvent.timestamp, sequence: latestEvent.sequence },
    );
  }
  // tool.started / tool.completed / worker.started and other typed events are
  // self-describing enough for a single-event synthetic replay.
  // BUT: a single follow-up event (candidate.reverification.started etc.) on
  // a terminal Task cannot prove an open operation because the latest-only caller
  // lacks the ordered history to distinguish matched from unmatched starts.
  // Strip follow-up events so the detection stays conservative.
  if (
    isTerminalTaskStatus(task.status)
    && (
      type === "candidate.reverification.started"
      || type === "candidate.reverification.completed"
      || type === "remediation.check.started"
      || type === "remediation.check.completed"
    )
  ) {
    return projectLiveStage(task, [], nowMs, quietAfterMs, preparationStage);
  }
  return projectLiveStage(task, [synthetic], nowMs, quietAfterMs, preparationStage);
}

/**
 * Replay ordered durable events into the latest Runtime-signal and
 * effective-progress clocks. Each worker.started / worker.resumed opens a new
 * Attempt-scoped baseline and clears prior effective-progress evidence so an
 * earlier Attempt cannot look like current progress. Pure: no Provider call,
 * mutable timer, or summary-prose inference. Legacy messages without
 * activityEvidence advance only the Runtime clock.
 */
export function projectDualClocks(
  task: TaskRecord,
  events: readonly LiveStageEventEvidence[],
  nowMs: number,
  quietAfterMs: number = DEFAULT_QUIET_AFTER_MS,
): DualClockProjection {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  let latestRuntimeSignalAt: string | undefined;
  let latestEffectiveProgressAt: string | undefined;
  let sawWorkerStart = false;
  let sawExplicitEffective = false;

  for (const event of ordered) {
    const type = String(event.type);
    const classif = classifyRuntimeActivity(type, event.payload);
    if (classif === undefined) continue;

    // Every structured Runtime record refreshes the liveness clock.
    if (isRuntimeSignalEvent(type) || isWorkerStartBaseline(type)) {
      latestRuntimeSignalAt = event.timestamp;
    }

    if (isWorkerStartBaseline(type)) {
      // New Attempt: reset the effective-progress clock to this start baseline.
      // Prior Attempt progress must not survive into the new attempt scope.
      sawWorkerStart = true;
      sawExplicitEffective = false;
      latestEffectiveProgressAt = event.timestamp;
      continue;
    }

    if (classif === RUNTIME_ACTIVITY_EFFECTIVE || isEffectiveProgressEvent(type, event.payload)) {
      sawExplicitEffective = true;
      latestEffectiveProgressAt = event.timestamp;
      continue;
    }
    // Liveness-only (including legacy worker.message without classification)
    // already refreshed the Runtime-signal clock above.
  }

  if (isTerminalTaskStatus(task.status)) {
    const terminalNext: DualClockProjection["next"] =
      task.status === "failed" || task.status === "interrupted"
        ? "inspect-failure"
        : "none";
    return {
      ...(latestRuntimeSignalAt === undefined ? {} : { latestRuntimeSignalAt }),
      ...(latestEffectiveProgressAt === undefined ? {} : { latestEffectiveProgressAt }),
      runtimeSignalObservation: "terminal",
      effectiveProgressObservation: "terminal",
      effectiveProgressKnown: sawExplicitEffective,
      next: terminalNext,
    };
  }

  const observe = (at: string | undefined): "active" | "quiet" | "unknown" => {
    if (at === undefined) return "unknown";
    const ms = Date.parse(at);
    if (!Number.isFinite(ms)) return "unknown";
    return nowMs - ms <= quietAfterMs ? "active" : "quiet";
  };

  const runtimeSignalObservation = observe(latestRuntimeSignalAt);
  let effectiveProgressObservation: DualClockProjection["effectiveProgressObservation"];
  if (sawExplicitEffective) {
    effectiveProgressObservation = observe(latestEffectiveProgressAt);
  } else if (sawWorkerStart) {
    // Truthful baseline: start time is known, but launch alone is never a
    // substantive step. Keep the closed "baseline" label so UI does not claim
    // progress at Worker start.
    effectiveProgressObservation = "baseline";
  } else {
    // Legacy history without Worker start or closed effective classification.
    effectiveProgressObservation = "unknown";
  }

  // Progress is "stalled relative to Runtime" when Runtime is still speaking
  // but the progress clock is only a baseline/unknown or has gone quiet.
  const progressBehindRuntime =
    runtimeSignalObservation === "active"
    && (
      effectiveProgressObservation === "quiet"
      || effectiveProgressObservation === "baseline"
      || effectiveProgressObservation === "unknown"
    );

  let next: DualClockProjection["next"] = "none";
  if (runtimeSignalObservation === "unknown" && effectiveProgressObservation === "unknown") {
    next = "wait-for-runtime";
  } else if (progressBehindRuntime) {
    next = "wait-for-effective-progress";
  } else {
    next = "wait-for-new-evidence";
  }

  return {
    ...(latestRuntimeSignalAt === undefined ? {} : { latestRuntimeSignalAt }),
    ...(latestEffectiveProgressAt === undefined ? {} : { latestEffectiveProgressAt }),
    runtimeSignalObservation,
    effectiveProgressObservation,
    effectiveProgressKnown: sawExplicitEffective,
    next,
  };
}

/**
 * Coarse dual-clock projection when only the latest-event cursor is available.
 * Conservative: never invents effective progress from a bare message type.
 */
function projectDualClocksFromLatest(
  task: TaskRecord,
  latestEvent: LatestEventMeta | undefined,
  nowMs: number,
  quietAfterMs: number = DEFAULT_QUIET_AFTER_MS,
): DualClockProjection {
  if (latestEvent === undefined) {
    return projectDualClocks(task, [], nowMs, quietAfterMs);
  }
  const synthetic: LiveStageEventEvidence = {
    sequence: latestEvent.sequence,
    timestamp: latestEvent.timestamp,
    type: latestEvent.type,
  };
  // Bare latest cursor has no payload classification: Runtime signal only.
  return projectDualClocks(task, [synthetic], nowMs, quietAfterMs);
}

/**
 * Canonical TaskDecisionView.progress for status surfaces (CLI status, MCP
 * status via Decision View, list JSON). Driven by latest-event metadata rather
 * than frozen tasks.updatedAt. When the caller supplies a structured
 * preparationStage, list/status consumers can explain the current operation.
 * When ordered events are supplied, progress.liveStage is the replayable
 * canonical Worker explanation shared by every consumer. Dual clocks are
 * always present so board and Task Detail can separate Runtime liveness from
 * effective progress without recomputing from prose.
 */
export function buildStatusProgress(
  task: TaskRecord,
  latestEvent: LatestEventMeta | undefined,
  nowMs: number,
  quietAfterMs: number = DEFAULT_QUIET_AFTER_MS,
  preparationStage?: PreparationStageCursor,
  events?: readonly LiveStageEventEvidence[],
): TaskDecisionView["progress"] {
  const rawActivity = classifyActivity(task, latestEvent, nowMs, quietAfterMs);
  const liveStage = events !== undefined
    ? projectLiveStage(task, events, nowMs, quietAfterMs, preparationStage)
    : projectLiveStageFromLatest(task, latestEvent, nowMs, quietAfterMs, preparationStage);
  const dualClock = events !== undefined
    ? projectDualClocks(task, events, nowMs, quietAfterMs)
    : projectDualClocksFromLatest(task, latestEvent, nowMs, quietAfterMs);
  // When follow-up work is open on a terminal Task, activity follows the
  // canonical live-stage observation, not the raw terminal status.
  // Prefer Runtime-signal freshness for the coarse activity field so a
  // liveness heartbeat never looks like a dead connection.
  let activity = isOpenFollowUpStage(liveStage.stage) ? liveStage.observation : rawActivity;
  if (
    !isTerminalTaskStatus(task.status)
    && !isOpenFollowUpStage(liveStage.stage)
    && dualClock.runtimeSignalObservation === "active"
  ) {
    activity = "active";
  } else if (
    !isTerminalTaskStatus(task.status)
    && !isOpenFollowUpStage(liveStage.stage)
    && dualClock.runtimeSignalObservation === "quiet"
    && activity === "active"
  ) {
    // Keep quiet when the Runtime clock is stale even if lastEventAt is newer
    // for a non-Runtime event type.
    activity = "quiet";
  }
  return {
    activity,
    latestEventSequence: latestEvent?.sequence ?? 0,
    ...(latestEvent === undefined ? {} : { lastEventAt: latestEvent.timestamp }),
    ...(latestEvent === undefined ? {} : { latestAction: latestEvent.summary }),
    ...(latestEvent === undefined ? {} : { lastEventType: String(latestEvent.type) }),
    ...(preparationStage === undefined ? {} : { preparationStage }),
    liveStage,
    ...(dualClock.latestRuntimeSignalAt === undefined
      ? {}
      : { latestRuntimeSignalAt: dualClock.latestRuntimeSignalAt }),
    ...(dualClock.latestEffectiveProgressAt === undefined
      ? {}
      : { latestEffectiveProgressAt: dualClock.latestEffectiveProgressAt }),
    dualClock,
  };
}

/** Map store.latestEventMeta rows into the progress cursor shape. */
export function toLatestEventMeta(
  meta: Pick<LatestEventMeta, "sequence" | "timestamp" | "type" | "summary"> | undefined,
): LatestEventMeta | undefined {
  if (meta === undefined) return undefined;
  return {
    sequence: meta.sequence,
    timestamp: meta.timestamp,
    type: meta.type,
    summary: meta.summary,
  };
}

/** Map EventRecord-like rows into live-stage evidence without copying summaries. */
export function toLiveStageEvents(
  events: readonly { sequence: number; timestamp: string; type: EventType | string; payload?: unknown }[],
): LiveStageEventEvidence[] {
  return events.map((event) => ({
    sequence: event.sequence,
    timestamp: event.timestamp,
    type: event.type,
    ...(event.payload === undefined ? {} : { payload: event.payload }),
  }));
}
