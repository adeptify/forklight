import type {
  AttemptRecord,
  DeliveryLineage,
  EventRecord,
  ExecutionPreference,
  IntegrationResultRecord,
  LiveStageProjection,
  MainDecisionPacket,
  ResolvedExecutionMode,
  TaskDecisionView,
  TaskRecord,
  TaskStatus,
} from "../core/types.js";
import {
  buildMainDecisionPacket,
  formatMainDecisionPacketHuman,
} from "../core/main-decision-packet.js";
import {
  executionModeFromTaskSpec,
  executionPreferenceFromTaskSpec,
} from "../core/execution-mode.js";
import { buildDeliveryLineage } from "../core/delivery-lineage.js";
import { buildTaskDecisionView } from "../core/task-decision-view.js";
import {
  classifyActivity,
  DEFAULT_QUIET_AFTER_MS,
  isOpenFollowUpStage,
  isTerminalTaskStatus,
  type LatestEventMeta,
  type ProgressActivity,
} from "../core/task-progress.js";

// Re-export progress primitives so wait/status tests can import one module;
// implementations live only in core/task-progress.ts.
export {
  buildStatusProgress,
  classifyActivity,
  DEFAULT_QUIET_AFTER_MS,
  isOpenFollowUpStage,
  isTerminalTaskStatus,
  projectLiveStage,
  toLatestEventMeta,
  toLiveStageEvents,
  type LatestEventMeta,
  type LiveStageEventEvidence,
  type ProgressActivity,
} from "../core/task-progress.js";

export type WaitUntil = "change" | "terminal";
export type WaitOutcome = "changed" | "terminal" | "timeout";

export interface WaitPolicy {
  timeoutMs: number;
  pollMs: number;
  until: WaitUntil;
  /** When last event is older than this many ms, activity becomes quiet. Default 30s. */
  quietAfterMs?: number;
}

/** Progress cursor used by wait --until change (FL-D97 / FL-D111). */
export interface ProgressCursor {
  status: TaskStatus;
  latestEventSequence: number;
  currentAttemptId: string | null;
  updatedAt: string;
}

export interface TaskProgressSnapshot {
  task: TaskRecord;
  cursor: ProgressCursor;
  latestEvent?: LatestEventMeta;
  /** Canonical live-stage projection when the caller supplies ordered events.
   *  Absent when the caller has no event history; wait will then fall back to
   *  raw Task status for the terminal check (conservative — never invents an
   *  open follow-up from a single latest-event cursor). */
  liveStage?: LiveStageProjection;
}

export interface WaitDependencies {
  readProgress: () => TaskProgressSnapshot | Promise<TaskProgressSnapshot>;
  sleep: (milliseconds: number) => void | Promise<void>;
  now: () => number;
}

export interface CompactTaskSummary {
  id: string;
  name: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  executionPreference: ExecutionPreference;
  executionMode: ResolvedExecutionMode;
}

export interface WaitProgressSummary {
  latestEventSequence: number;
  lastEventAt: string | null;
  lastEventType: string | null;
  lastEventSummary: string | null;
  activity: ProgressActivity;
  currentAttemptId: string | null;
  /** Canonical live stage when the caller supplied ordered events. */
  liveStage?: LiveStageProjection;
}

export interface WaitResult {
  outcome: WaitOutcome;
  elapsedMs: number;
  pollCount: number;
  task: CompactTaskSummary;
  progress: WaitProgressSummary;
}

export interface ParsedWaitOptions extends WaitPolicy {
  json: boolean;
}

export interface ParsedInspectSummaryOptions {
  summary: true;
  eventLimit: number;
  json: boolean;
}

export interface CompactAttemptEvidence {
  ordinal: number;
  status: AttemptRecord["status"];
  exitCode: number | null;
  turns: number | null;
  usage: { present: boolean; complete: boolean };
  runtimeEstimate: { present: boolean; valueUsd: number | null };
  officialCost:
    | { present: false }
    | { present: true; stage: string; quoted: true; total: number; currency: string }
    | { present: true; stage: string; quoted: false; reason: string };
}

export interface CompactEventEvidence {
  sequence: number;
  timestamp: string;
  type: EventRecord["type"];
  summary: string;
}

export interface CompactVerificationHint {
  present: boolean;
  passed: boolean | null;
  summary: string | null;
  behaviorHint: string | null;
  policyHint: string | null;
  sourceHint: string | null;
}

export interface CompactInspection {
  task: CompactTaskSummary;
  progress: WaitProgressSummary;
  attempts: CompactAttemptEvidence[];
  events: CompactEventEvidence[];
  verification: CompactVerificationHint;
  lineage: DeliveryLineage;
  decision: TaskDecisionView;
  decisionPacket: MainDecisionPacket;
  diff: { generated: boolean; utf8Bytes: number; lineCount: number };
}

function assertInteger(value: number, label: string, allowZero: boolean): void {
  if (!Number.isSafeInteger(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(`${label} must be a ${allowZero ? "nonnegative" : "positive"} integer`);
  }
}

function parseInteger(raw: string, label: string, allowZero: boolean): number {
  if (!(allowZero ? /^(?:0|[1-9]\d*)$/ : /^[1-9]\d*$/).test(raw)) {
    throw new Error(`${label} must be a ${allowZero ? "nonnegative" : "positive"} integer`);
  }
  const value = Number(raw);
  assertInteger(value, label, allowZero);
  return value;
}

function takeValue(arguments_: string[], index: number, flag: string): string {
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
  return value;
}

export interface ParsedDeliveryPrepareOptions {
  taskFile?: string;
  taskId?: string;
  reviewerProfileIds: string[];
  reason: string;
  timeoutMs: number;
  confirm: true;
  includeDiffMaxBytes?: number;
  json: boolean;
}

export interface ParsedDeliveryDecideOptions {
  taskId: string;
  decision: "accept" | "revise" | "reject";
  revisionId: string;
  digest: string;
  reason: string;
  timeoutMs: number;
  confirm: true;
  json: boolean;
}

function parseDeliveryInteger(raw: string, label: string, allowZero: boolean): number {
  if (!(allowZero ? /^(?:0|[1-9]\d*)$/ : /^[1-9]\d*$/).test(raw)) {
    throw new Error(`${label} must be a ${allowZero ? "nonnegative" : "positive"} integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(`${label} must be a ${allowZero ? "nonnegative" : "positive"} integer`);
  }
  return value;
}

function takeDeliveryValue(arguments_: string[], index: number, flag: string): string {
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
  return value;
}

function parseReviewerProfileList(raw: string): string[] {
  return raw.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
}

export function parseDeliveryPrepareOptions(arguments_: string[]): ParsedDeliveryPrepareOptions {
  let taskFile: string | undefined;
  let taskId: string | undefined;
  const reviewerProfileIds: string[] = [];
  let reason: string | undefined;
  let timeoutMs: number | undefined;
  let includeDiffMaxBytes: number | undefined;
  let confirm = false;
  let json = false;
  const seen = new Set<string>();

  for (let index = 0; index < arguments_.length; index += 1) {
    const flag = arguments_[index]!;
    if (flag === "--json") {
      if (seen.has(flag)) throw new Error("Duplicate delivery prepare option: --json");
      seen.add(flag);
      json = true;
      continue;
    }
    if (flag === "--confirm") {
      if (seen.has(flag)) throw new Error("Duplicate delivery prepare option: --confirm");
      seen.add(flag);
      confirm = true;
      continue;
    }
    if (flag === "--reviewer-profile") {
      const value = takeDeliveryValue(arguments_, index, flag);
      index += 1;
      reviewerProfileIds.push(value.trim());
      continue;
    }
    if (![
      "--task-file", "--task", "--reviewer-profiles", "--reason",
      "--timeout-ms", "--include-diff-max-bytes",
    ].includes(flag)) {
      throw new Error(`Unknown delivery prepare option: ${flag}`);
    }
    if (flag !== "--reviewer-profiles" && seen.has(flag)) {
      throw new Error(`Duplicate delivery prepare option: ${flag}`);
    }
    seen.add(flag);
    const value = takeDeliveryValue(arguments_, index, flag);
    index += 1;
    if (flag === "--task-file") taskFile = value;
    else if (flag === "--task") taskId = value;
    else if (flag === "--reviewer-profiles") {
      reviewerProfileIds.push(...parseReviewerProfileList(value));
    } else if (flag === "--reason") reason = value;
    else if (flag === "--timeout-ms") timeoutMs = parseDeliveryInteger(value, "--timeout-ms", false);
    else includeDiffMaxBytes = parseDeliveryInteger(value, "--include-diff-max-bytes", true);
  }
  if (!confirm) throw new Error("delivery prepare requires --confirm");
  if ((taskFile === undefined) === (taskId === undefined)) {
    throw new Error("delivery prepare requires exactly one of --task-file or --task");
  }
  if (reason === undefined) throw new Error("delivery prepare requires --reason");
  if (timeoutMs === undefined) throw new Error("delivery prepare requires --timeout-ms");
  return {
    ...(taskFile === undefined ? { taskId: taskId! } : { taskFile }),
    reviewerProfileIds,
    reason,
    timeoutMs,
    confirm: true,
    ...(includeDiffMaxBytes === undefined ? {} : { includeDiffMaxBytes }),
    json,
  };
}

export function parseDeliveryDecideOptions(
  arguments_: string[],
  taskId: string,
): ParsedDeliveryDecideOptions {
  let decision: "accept" | "revise" | "reject" | undefined;
  let revisionId: string | undefined;
  let digest: string | undefined;
  let reason: string | undefined;
  let timeoutMs: number | undefined;
  let confirm = false;
  let json = false;
  const seen = new Set<string>();

  for (let index = 0; index < arguments_.length; index += 1) {
    const flag = arguments_[index]!;
    if (flag === "--json") {
      if (seen.has(flag)) throw new Error("Duplicate delivery decide option: --json");
      seen.add(flag);
      json = true;
      continue;
    }
    if (flag === "--confirm") {
      if (seen.has(flag)) throw new Error("Duplicate delivery decide option: --confirm");
      seen.add(flag);
      confirm = true;
      continue;
    }
    if (![
      "--decision", "--revision", "--digest", "--reason", "--timeout-ms",
    ].includes(flag)) {
      throw new Error(`Unknown delivery decide option: ${flag}`);
    }
    if (seen.has(flag)) throw new Error(`Duplicate delivery decide option: ${flag}`);
    seen.add(flag);
    const value = takeDeliveryValue(arguments_, index, flag);
    index += 1;
    if (flag === "--decision") {
      if (value !== "accept" && value !== "revise" && value !== "reject") {
        throw new Error("delivery decide --decision must be accept, revise, or reject");
      }
      decision = value;
    } else if (flag === "--revision") revisionId = value;
    else if (flag === "--digest") digest = value;
    else if (flag === "--reason") reason = value;
    else timeoutMs = parseDeliveryInteger(value, "--timeout-ms", false);
  }
  if (!confirm) throw new Error("delivery decide requires --confirm");
  if (taskId.trim().length === 0) throw new Error("delivery decide requires a task id");
  if (decision === undefined) throw new Error("delivery decide requires --decision");
  if (revisionId === undefined) throw new Error("delivery decide requires --revision");
  if (digest === undefined) throw new Error("delivery decide requires --digest");
  if (reason === undefined) throw new Error("delivery decide requires --reason");
  if (timeoutMs === undefined) throw new Error("delivery decide requires --timeout-ms");
  return {
    taskId,
    decision,
    revisionId,
    digest,
    reason,
    timeoutMs,
    confirm: true,
    json,
  };
}

export function parseWaitOptions(arguments_: string[], defaultPollMs: number): ParsedWaitOptions {
  assertInteger(defaultPollMs, "effective console.refreshIntervalMs", false);
  let timeoutMs: number | undefined;
  let pollMs: number | undefined;
  let until: WaitUntil = "change";
  let json = false;
  const seen = new Set<string>();

  for (let index = 0; index < arguments_.length; index += 1) {
    const flag = arguments_[index]!;
    if (!["--timeout-ms", "--poll-ms", "--until", "--json"].includes(flag)) {
      throw new Error(`Unknown wait option: ${flag}`);
    }
    if (seen.has(flag)) throw new Error(`Duplicate wait option: ${flag}`);
    seen.add(flag);
    if (flag === "--json") {
      json = true;
      continue;
    }
    const value = takeValue(arguments_, index, flag);
    index += 1;
    if (flag === "--timeout-ms") timeoutMs = parseInteger(value, "--timeout-ms", false);
    else if (flag === "--poll-ms") pollMs = parseInteger(value, "--poll-ms", false);
    else {
      if (value !== "change" && value !== "terminal") {
        throw new Error("--until must be change or terminal");
      }
      until = value;
    }
  }
  if (timeoutMs === undefined) throw new Error("Missing required --timeout-ms");
  return { timeoutMs, pollMs: pollMs ?? defaultPollMs, until, json };
}

export function parseInspectSummaryOptions(
  arguments_: string[], defaultEventLimit: number,
): ParsedInspectSummaryOptions {
  assertInteger(defaultEventLimit, "effective console.eventListLimit", true);
  let summary = false;
  let eventLimit: number | undefined;
  let json = false;
  const seen = new Set<string>();

  for (let index = 0; index < arguments_.length; index += 1) {
    const flag = arguments_[index]!;
    if (!["--summary", "--events", "--json"].includes(flag)) {
      throw new Error(`Unknown inspect summary option: ${flag}`);
    }
    if (seen.has(flag)) throw new Error(`Duplicate inspect summary option: ${flag}`);
    seen.add(flag);
    if (flag === "--summary") summary = true;
    else if (flag === "--json") json = true;
    else {
      const value = takeValue(arguments_, index, flag);
      index += 1;
      eventLimit = parseInteger(value, "--events", true);
    }
  }
  if (!summary) throw new Error("--events requires --summary");
  return { summary: true, eventLimit: eventLimit ?? defaultEventLimit, json };
}

function compactTaskSummary(task: TaskRecord): CompactTaskSummary {
  return {
    id: task.id,
    name: task.name,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.startedAt === undefined ? {} : { startedAt: task.startedAt }),
    ...(task.finishedAt === undefined ? {} : { finishedAt: task.finishedAt }),
    executionPreference: executionPreferenceFromTaskSpec(task.spec),
    executionMode: executionModeFromTaskSpec(task.spec),
  };
}

export function buildProgressCursor(
  task: TaskRecord,
  latestEvent?: LatestEventMeta,
): ProgressCursor {
  return {
    status: task.status,
    latestEventSequence: latestEvent?.sequence ?? 0,
    currentAttemptId: task.currentAttemptId ?? null,
    updatedAt: task.updatedAt,
  };
}

export function progressCursorKey(cursor: ProgressCursor): string {
  return [
    cursor.status,
    String(cursor.latestEventSequence),
    cursor.currentAttemptId ?? "",
    cursor.updatedAt,
  ].join("\u0001");
}

function buildWaitProgressSummary(
  snapshot: TaskProgressSnapshot,
  nowMs: number,
  quietAfterMs: number,
): WaitProgressSummary {
  const rawActivity = classifyActivity(
    snapshot.task, snapshot.latestEvent, nowMs, quietAfterMs,
  );
  // When follow-up work is open on a terminal Task, activity follows the
  // canonical live-stage observation, not the raw terminal status.
  const activity = snapshot.liveStage !== undefined
    && isOpenFollowUpStage(snapshot.liveStage.stage)
    ? snapshot.liveStage.observation
    : rawActivity;
  return {
    latestEventSequence: snapshot.cursor.latestEventSequence,
    lastEventAt: snapshot.latestEvent?.timestamp ?? null,
    lastEventType: snapshot.latestEvent?.type ?? null,
    lastEventSummary: snapshot.latestEvent?.summary ?? null,
    activity,
    currentAttemptId: snapshot.cursor.currentAttemptId,
    ...(snapshot.liveStage === undefined ? {} : { liveStage: snapshot.liveStage }),
  };
}

function waitResult(
  outcome: WaitOutcome,
  startedAt: number,
  pollCount: number,
  snapshot: TaskProgressSnapshot,
  now: () => number,
  quietAfterMs: number,
): WaitResult {
  const nowMs = now();
  return {
    outcome,
    elapsedMs: Math.max(0, nowMs - startedAt),
    pollCount,
    task: compactTaskSummary(snapshot.task),
    progress: buildWaitProgressSummary(snapshot, nowMs, quietAfterMs),
  };
}

/** True when the Task is unambiguously terminal: raw status is terminal AND no
 *  open post-terminal follow-up operation is projected from ordered events.
 *  When ordered events are unavailable (no liveStage), fall back to raw status
 *  so latest-only callers remain conservative and never invent an open operation. */
function isEffectivelyTerminal(snapshot: TaskProgressSnapshot): boolean {
  if (!isTerminalTaskStatus(snapshot.task.status)) return false;
  // When the caller supplies a canonical live-stage projection with ordered
  // events, respect open follow-up operations.
  if (snapshot.liveStage !== undefined) {
    return !isOpenFollowUpStage(snapshot.liveStage.stage);
  }
  // No ordered events: fall back to raw status. The caller is latest-only and
  // cannot prove an open follow-up from a single event.
  return true;
}

export async function waitForTask(
  policy: WaitPolicy, dependencies: WaitDependencies,
): Promise<WaitResult> {
  assertInteger(policy.timeoutMs, "timeoutMs", false);
  assertInteger(policy.pollMs, "pollMs", false);
  const quietAfterMs = policy.quietAfterMs ?? DEFAULT_QUIET_AFTER_MS;
  assertInteger(quietAfterMs, "quietAfterMs", false);
  const startedAt = dependencies.now();
  const initial = await dependencies.readProgress();
  let latest = initial;
  let pollCount = 0;
  const initialKey = progressCursorKey(initial.cursor);

  // Terminal only when the Task is done AND every follow-up is closed.
  if (isEffectivelyTerminal(initial)) {
    return waitResult("terminal", startedAt, pollCount, initial, dependencies.now, quietAfterMs);
  }

  while (true) {
    const elapsedMs = Math.max(0, dependencies.now() - startedAt);
    if (elapsedMs >= policy.timeoutMs) {
      return waitResult("timeout", startedAt, pollCount, latest, dependencies.now, quietAfterMs);
    }
    await dependencies.sleep(Math.min(policy.pollMs, policy.timeoutMs - elapsedMs));
    latest = await dependencies.readProgress();
    pollCount += 1;
    if (isEffectivelyTerminal(latest)) {
      return waitResult("terminal", startedAt, pollCount, latest, dependencies.now, quietAfterMs);
    }
    if (policy.until === "change" && progressCursorKey(latest.cursor) !== initialKey) {
      return waitResult("changed", startedAt, pollCount, latest, dependencies.now, quietAfterMs);
    }
    if (dependencies.now() - startedAt >= policy.timeoutMs) {
      return waitResult("timeout", startedAt, pollCount, latest, dependencies.now, quietAfterMs);
    }
  }
}

function compactOfficialCost(attempt: AttemptRecord): CompactAttemptEvidence["officialCost"] {
  const cost = attempt.officialCost;
  if (cost === undefined) return { present: false };
  if (cost.quoted) {
    return {
      present: true, stage: cost.stage, quoted: true,
      total: cost.result.total, currency: cost.result.currency,
    };
  }
  return {
    present: true,
    stage: cost.stage,
    quoted: false,
    reason: cost.stage === "calculation" ? cost.result.reason : cost.reason,
  };
}

function extractVerificationHint(events: EventRecord[]): CompactVerificationHint {
  const completed = [...events]
    .filter((event) => event.type === "verification.completed")
    .sort((left, right) => left.sequence - right.sequence)
    .at(-1);
  if (completed === undefined) {
    return {
      present: false, passed: null, summary: null,
      behaviorHint: null, policyHint: null, sourceHint: null,
    };
  }
  const payload = completed.payload;
  if (payload === null || typeof payload !== "object") {
    return {
      present: true,
      passed: null,
      summary: completed.summary,
      behaviorHint: null,
      policyHint: null,
      sourceHint: null,
    };
  }
  const body = payload as {
    passed?: unknown;
    behaviorPassed?: unknown;
    policyPassed?: unknown;
    sourceCompatible?: unknown;
    sourceUnchanged?: unknown;
    sourceCompatibility?: {
      conflictingPaths?: unknown;
      unrelatedDriftPaths?: unknown;
    };
    commands?: Array<{ command?: unknown; exitCode?: unknown }>;
    changeBudget?: { withinBudget?: unknown; filesChanged?: unknown; changedLines?: unknown;
      maxFiles?: unknown; maxDiffLines?: unknown };
  };
  const passed = typeof body.passed === "boolean" ? body.passed : null;
  const cmdFail = Array.isArray(body.commands)
    ? body.commands.find((command) => command.exitCode !== 0 && command.exitCode !== undefined)
    : undefined;
  let behaviorHint: string | null = null;
  if (typeof body.behaviorPassed === "boolean") {
    behaviorHint = body.behaviorPassed ? "behavior_passed" : "behavior_failed";
  }
  if (cmdFail) {
    behaviorHint = `command_failed exit=${String(cmdFail.exitCode)} cmd=${String(cmdFail.command ?? "")}`;
  } else if (behaviorHint === null && Array.isArray(body.commands) && body.commands.length > 0) {
    behaviorHint = "commands_passed";
  }
  const budget = body.changeBudget;
  let policyHint: string | null = null;
  if (typeof body.policyPassed === "boolean") {
    policyHint = body.policyPassed ? "policy_passed" : "policy_failed";
  }
  if (budget && budget.withinBudget === false) {
    policyHint = `change_budget_exceeded files=${String(budget.filesChanged)}/${String(budget.maxFiles)} lines=${String(budget.changedLines)}/${String(budget.maxDiffLines)}`;
  } else if (budget && budget.withinBudget === true && policyHint === null) {
    policyHint = "change_budget_ok";
  }
  let sourceHint: string | null = null;
  if (typeof body.sourceCompatible === "boolean") {
    if (body.sourceCompatible) {
      const drift = Array.isArray(body.sourceCompatibility?.unrelatedDriftPaths)
        ? body.sourceCompatibility.unrelatedDriftPaths.length
        : 0;
      sourceHint = drift > 0 ? `source_compatible unrelated_drift=${drift}` : "source_compatible";
    } else {
      const n = Array.isArray(body.sourceCompatibility?.conflictingPaths)
        ? body.sourceCompatibility.conflictingPaths.length
        : 0;
      sourceHint = `source_conflict affected=${n}`;
    }
  } else if (body.sourceUnchanged === false) {
    sourceHint = "source_changed";
  } else if (body.sourceUnchanged === true) {
    sourceHint = "source_unchanged";
  }
  return {
    present: true,
    passed,
    summary: completed.summary,
    behaviorHint,
    policyHint,
    sourceHint,
  };
}

export function buildCompactInspection(input: {
  task: TaskRecord;
  attempts: AttemptRecord[];
  events: EventRecord[];
  diff: string | undefined;
  eventLimit: number;
  integrationResults?: IntegrationResultRecord[];
  decision?: TaskDecisionView;
  decisionPacket?: MainDecisionPacket;
  nowMs?: number;
  quietAfterMs?: number;
}): CompactInspection {
  assertInteger(input.eventLimit, "eventLimit", true);
  const latestEvents = input.eventLimit === 0
    ? []
    : [...input.events].sort((left, right) => left.sequence - right.sequence).slice(-input.eventLimit);
  const diff = input.diff;
  const lastEvent = [...input.events].sort((a, b) => a.sequence - b.sequence).at(-1);
  const latestMeta: LatestEventMeta | undefined = lastEvent === undefined
    ? undefined
    : {
      sequence: lastEvent.sequence,
      timestamp: lastEvent.timestamp,
      type: lastEvent.type,
      summary: lastEvent.summary,
    };
  const snapshot: TaskProgressSnapshot = {
    task: input.task,
    cursor: buildProgressCursor(input.task, latestMeta),
    ...(latestMeta === undefined ? {} : { latestEvent: latestMeta }),
  };
  const nowMs = input.nowMs ?? Date.now();
  const quietAfterMs = input.quietAfterMs ?? DEFAULT_QUIET_AFTER_MS;
  const decision = input.decision ?? buildTaskDecisionView({
    task: input.task,
    attempts: input.attempts,
    events: input.events,
    integrationResults: input.integrationResults ?? [],
  });
  return {
    task: compactTaskSummary(input.task),
    progress: buildWaitProgressSummary(snapshot, nowMs, quietAfterMs),
    attempts: input.attempts.map((attempt) => ({
      ordinal: attempt.ordinal,
      status: attempt.status,
      exitCode: attempt.exitCode ?? null,
      turns: attempt.turns ?? null,
      usage: { present: attempt.usage !== undefined, complete: attempt.usage?.complete === true },
      runtimeEstimate: {
        present: attempt.runtimeCostEstimateUsd !== undefined,
        valueUsd: attempt.runtimeCostEstimateUsd ?? null,
      },
      officialCost: compactOfficialCost(attempt),
    })),
    events: latestEvents.map((event) => ({
      sequence: event.sequence,
      timestamp: event.timestamp,
      type: event.type,
      summary: event.summary,
    })),
    verification: extractVerificationHint(input.events),
    lineage: buildDeliveryLineage(input.attempts, input.events),
    decision,
    decisionPacket: input.decisionPacket ?? buildMainDecisionPacket({
      task: input.task,
      decision,
      events: input.events,
    }),
    diff: {
      generated: diff !== undefined,
      utf8Bytes: diff === undefined ? 0 : new TextEncoder().encode(diff).byteLength,
      lineCount: diff === undefined || diff.length === 0
        ? 0
        : diff.split("\n").length - (diff.endsWith("\n") ? 1 : 0),
    },
  };
}

export function humanWaitLines(result: WaitResult): string {
  const lines = [
    `outcome: ${result.outcome}`,
    `elapsedMs: ${result.elapsedMs}`,
    `pollCount: ${result.pollCount}`,
    `id: ${result.task.id}`,
    `name: ${result.task.name}`,
    `status: ${result.task.status}`,
    `updatedAt: ${result.task.updatedAt}`,
    `activity: ${result.progress.activity}`,
    `latestEventSequence: ${result.progress.latestEventSequence}`,
  ];
  if (result.progress.lastEventAt) lines.push(`lastEventAt: ${result.progress.lastEventAt}`);
  if (result.progress.lastEventType) {
    lines.push(`lastEvent: ${result.progress.lastEventType} — ${result.progress.lastEventSummary ?? ""}`);
  }
  if (result.task.finishedAt !== undefined) lines.push(`finishedAt: ${result.task.finishedAt}`);
  if (result.progress.liveStage !== undefined) {
    lines.push(`liveStage: ${result.progress.liveStage.stage}`);
    lines.push(`liveStageObservation: ${result.progress.liveStage.observation}`);
    lines.push(`liveStageMeaning: ${result.progress.liveStage.meaning}`);
    lines.push(`liveStageNext: ${result.progress.liveStage.next}`);
    lines.push(`liveStageEvidence: ${result.progress.liveStage.evidence}`);
  }
  return `${lines.join("\n")}\n`;
}

function officialCostLine(cost: CompactAttemptEvidence["officialCost"]): string {
  if (!cost.present) return "not-recorded";
  if (cost.quoted) return `${cost.stage}/quoted ${cost.total} ${cost.currency}`;
  return `${cost.stage}/unavailable ${cost.reason}`;
}

export function humanCompactInspectionLines(inspection: CompactInspection): string {
  const lines = [
    `id: ${inspection.task.id}`,
    `name: ${inspection.task.name}`,
    `status: ${inspection.task.status}`,
    `updatedAt: ${inspection.task.updatedAt}`,
    `execution: requested=${inspection.task.executionPreference} resolved=${inspection.task.executionMode}`,
    `activity: ${inspection.progress.activity}`,
    `latestEventSequence: ${inspection.progress.latestEventSequence}`,
    `decision: ${inspection.decision.stage}`,
    `nextAction: ${inspection.decision.nextAction}`,
    `attempts: ${inspection.attempts.length}`,
  ];
  lines.push(formatMainDecisionPacketHuman(inspection.decisionPacket));
  for (const attempt of inspection.attempts) {
    lines.push(
      `  #${attempt.ordinal} ${attempt.status} exit=${attempt.exitCode ?? "-"} turns=${attempt.turns ?? "-"}`
      + ` usage=${attempt.usage.present ? (attempt.usage.complete ? "complete" : "incomplete") : "absent"}`
      + ` runtimeEstimateUsd=${attempt.runtimeEstimate.valueUsd ?? "-"}`
      + ` officialCost=${officialCostLine(attempt.officialCost)}`,
    );
  }
  if (inspection.verification.present) {
    lines.push(
      `verification: passed=${inspection.verification.passed ?? "unknown"}`
      + ` behavior=${inspection.verification.behaviorHint ?? "-"}`
      + ` policy=${inspection.verification.policyHint ?? "-"}`
      + ` source=${inspection.verification.sourceHint ?? "-"}`,
    );
  } else {
    lines.push("verification: not-recorded");
  }
  lines.push(
    `lineage: complete=${inspection.lineage.complete}`
    + ` attempts=${inspection.lineage.attemptCount}`
    + ` verified=${inspection.lineage.verifiedAttemptCount}`
    + ` corrections=${inspection.lineage.correctionAttemptIds.length}`,
    `  hopChurn: files=${inspection.lineage.hopChurn.filesChanged}`
    + ` lines=${inspection.lineage.hopChurn.changedLines}`,
    `  combinedDeliveryDiff: files=${inspection.lineage.combinedDeliveryDiff.filesChanged}`
    + ` lines=${inspection.lineage.combinedDeliveryDiff.changedLines}`,
  );
  if (inspection.lineage.missingAttemptIds.length > 0) {
    lines.push(`  missingPatchEvidence: ${inspection.lineage.missingAttemptIds.length}`);
  }
  lines.push(`events: ${inspection.events.length}`);
  for (const event of inspection.events) {
    lines.push(`  ${event.sequence}. ${event.timestamp} ${event.type} — ${event.summary}`);
  }
  lines.push(
    `diff: generated=${inspection.diff.generated} utf8Bytes=${inspection.diff.utf8Bytes} lineCount=${inspection.diff.lineCount}`,
  );
  return `${lines.join("\n")}\n`;
}
