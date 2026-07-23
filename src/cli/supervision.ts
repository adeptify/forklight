import type {
  AttemptRecord, EventRecord, TaskRecord, TaskStatus,
} from "../core/types.js";

const TERMINAL_STATUSES = new Set<TaskStatus>(["succeeded", "failed", "interrupted"]);

export type WaitUntil = "change" | "terminal";
export type WaitOutcome = "changed" | "terminal" | "timeout";

export interface WaitPolicy {
  timeoutMs: number;
  pollMs: number;
  until: WaitUntil;
}

export interface WaitDependencies {
  readTask: () => TaskRecord | Promise<TaskRecord>;
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
}

export interface WaitResult {
  outcome: WaitOutcome;
  elapsedMs: number;
  pollCount: number;
  task: CompactTaskSummary;
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

export interface CompactInspection {
  task: CompactTaskSummary;
  attempts: CompactAttemptEvidence[];
  events: CompactEventEvidence[];
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

export function compactTaskSummary(task: TaskRecord): CompactTaskSummary {
  return {
    id: task.id,
    name: task.name,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.startedAt === undefined ? {} : { startedAt: task.startedAt }),
    ...(task.finishedAt === undefined ? {} : { finishedAt: task.finishedAt }),
  };
}

function waitResult(
  outcome: WaitOutcome, startedAt: number, pollCount: number, task: TaskRecord, now: () => number,
): WaitResult {
  return {
    outcome,
    elapsedMs: Math.max(0, now() - startedAt),
    pollCount,
    task: compactTaskSummary(task),
  };
}

export async function waitForTask(
  policy: WaitPolicy, dependencies: WaitDependencies,
): Promise<WaitResult> {
  assertInteger(policy.timeoutMs, "timeoutMs", false);
  assertInteger(policy.pollMs, "pollMs", false);
  const startedAt = dependencies.now();
  const initial = await dependencies.readTask();
  let latest = initial;
  let pollCount = 0;

  if (TERMINAL_STATUSES.has(initial.status)) {
    return waitResult("terminal", startedAt, pollCount, initial, dependencies.now);
  }

  while (true) {
    const elapsedMs = Math.max(0, dependencies.now() - startedAt);
    if (elapsedMs >= policy.timeoutMs) {
      return waitResult("timeout", startedAt, pollCount, latest, dependencies.now);
    }
    await dependencies.sleep(Math.min(policy.pollMs, policy.timeoutMs - elapsedMs));
    latest = await dependencies.readTask();
    pollCount += 1;
    if (TERMINAL_STATUSES.has(latest.status)) {
      return waitResult("terminal", startedAt, pollCount, latest, dependencies.now);
    }
    if (policy.until === "change" && latest.status !== initial.status) {
      return waitResult("changed", startedAt, pollCount, latest, dependencies.now);
    }
    if (dependencies.now() - startedAt >= policy.timeoutMs) {
      return waitResult("timeout", startedAt, pollCount, latest, dependencies.now);
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

export function buildCompactInspection(input: {
  task: TaskRecord;
  attempts: AttemptRecord[];
  events: EventRecord[];
  diff: string | undefined;
  eventLimit: number;
}): CompactInspection {
  assertInteger(input.eventLimit, "eventLimit", true);
  const latestEvents = input.eventLimit === 0
    ? []
    : [...input.events].sort((left, right) => left.sequence - right.sequence).slice(-input.eventLimit);
  const diff = input.diff;
  return {
    task: compactTaskSummary(input.task),
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
  ];
  if (result.task.finishedAt !== undefined) lines.push(`finishedAt: ${result.task.finishedAt}`);
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
    `attempts: ${inspection.attempts.length}`,
  ];
  for (const attempt of inspection.attempts) {
    lines.push(
      `  #${attempt.ordinal} ${attempt.status} exit=${attempt.exitCode ?? "-"} turns=${attempt.turns ?? "-"}`
      + ` usage=${attempt.usage.present ? (attempt.usage.complete ? "complete" : "incomplete") : "absent"}`
      + ` runtimeEstimateUsd=${attempt.runtimeEstimate.valueUsd ?? "-"}`
      + ` officialCost=${officialCostLine(attempt.officialCost)}`,
    );
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
