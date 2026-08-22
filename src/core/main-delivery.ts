/**
 * Shared Main delivery prepare/decide service.
 *
 * Composes existing Task wait, Review Graph, Main review, and Integration
 * authorities, then projects one bounded checkpoint. Never invents a Main
 * decision, never integrates without explicit exact accept, and never treats
 * an observation timeout as durable Task/Judge/Integration failure.
 */
import { readFile } from "node:fs/promises";
import type { StateStore } from "../state/store.js";
import {
  latestMainReview,
  latestVerificationEvent,
  resolveLatestRevision,
  summarizeRevision,
} from "./candidate-revision.js";
import type { PreflightReceipt } from "./integration.js";
import { buildMainDecisionPacketForTask } from "./main-decision-packet.js";
import { MAIN_REVIEW_REASON_MAX_LENGTH } from "./main-review.js";
import {
  evaluateReviewRequirementForTask,
  getReviewGraphStatus,
  PENDING_REVIEW_BLOCKS_INTEGRATION,
  REQUIRED_REVIEW_GRAPH_INSUFFICIENT_USABLE,
  REQUIRED_REVIEW_GRAPH_MISSING,
  REQUIRED_REVIEW_GRAPH_STALE,
  REQUIRED_REVIEW_GRAPH_UNDERSIZED,
  STALE_MAIN_ACCEPT_AFTER_REVIEW,
} from "./review-graph.js";
import { buildTaskDecisionView } from "./task-decision-view.js";
import { isTerminalTaskStatus } from "./task-progress.js";
import type {
  IntegrationOperationView,
  IntegrationReceiptRecord,
  MainDeliveryBlocker,
  MainDeliveryBlockerCode,
  MainDeliveryCall,
  MainDeliveryCheckpoint,
  MainDeliveryJudgeView,
  MainDeliveryNextActionCode,
  MainDeliveryObservationOutcome,
  MainReviewDecision,
  MainReviewDecisionKind,
  ReviewGraphView,
  TaskRecord,
} from "./types.js";

const MAIN_DELIVERY_CHECKPOINT_KIND = "main-delivery-checkpoint" as const;
export const MAIN_DELIVERY_REASON_MAX_LENGTH = MAIN_REVIEW_REASON_MAX_LENGTH;
export const MAIN_DELIVERY_TIMEOUT_MIN_MS = 1;
export const MAIN_DELIVERY_TIMEOUT_MAX_MS = 3_600_000;
export const MAIN_DELIVERY_DIFF_MAX_BYTES = 1_000_000;

const CREDENTIAL_PATTERN =
  /\b(sk-[A-Za-z0-9_-]{8,}|API[_-]?KEY|Bearer\s+[A-Za-z0-9_\-.]{8,}|password\s*[:=])/i;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

export interface PrepareMainDeliveryInput {
  taskFile?: string;
  taskId?: string;
  reviewerProfileIds: readonly string[];
  reason: string;
  timeoutMs: number;
  confirm: true;
  includeDiffMaxBytes?: number;
}

export interface DecideMainDeliveryInput {
  taskId: string;
  decision: MainReviewDecisionKind;
  revisionId: string;
  digest: string;
  reason: string;
  timeoutMs: number;
  confirm: true;
}

export interface MainDeliveryIntegrationRef {
  operationId: string;
  receiptId: string;
}

export interface MainDeliveryHost {
  store: StateStore;
  submitFile(taskFile: string): Promise<TaskRecord>;
  inspectTaskFile?(taskFile: string): Promise<{ requiredJudges: 0 | 1 | 2 }>;
  createReviewGraph(input: {
    taskId: string;
    reviewerWorkerProfileIds: string[];
    reason: string;
    confirm: true;
  }): Promise<{ graph: ReviewGraphView; reviewerTaskIds: string[]; created: boolean }>;
  recordMainReview(
    taskId: string,
    decision: MainReviewDecisionKind,
    reason: string,
    confirm: true,
  ): MainReviewDecision;
  preflightIntegration(taskId: string): Promise<PreflightReceipt>;
  startIntegration(taskId: string, receiptId: string): IntegrationOperationView;
  waitIntegration(operationId: string, timeoutMs: number): Promise<IntegrationOperationView>;
  findIntegration(taskId: string): MainDeliveryIntegrationRef | undefined;
  findLatestReceipt(
    taskId: string,
  ): (IntegrationReceiptRecord & { consumed?: boolean }) | undefined;
  sleep(milliseconds: number): Promise<void>;
  now(): number;
  pollMs: number;
  readDiff(task: TaskRecord): Promise<string | undefined>;
}

function assertNonnegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative integer`);
  }
}

function normalizeReason(raw: unknown, label: string): string {
  if (typeof raw !== "string") throw new Error(`${label} must be a string`);
  const reason = raw.trim();
  if (reason.length < 1 || reason.length > MAIN_DELIVERY_REASON_MAX_LENGTH) {
    throw new Error(`${label} must be 1-${MAIN_DELIVERY_REASON_MAX_LENGTH} characters`);
  }
  if (CREDENTIAL_PATTERN.test(reason)) {
    throw new Error(`${label} must not contain credentials`);
  }
  return reason;
}

function normalizeTimeoutMs(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw)) {
    throw new Error("timeoutMs must be a positive integer");
  }
  if (raw < MAIN_DELIVERY_TIMEOUT_MIN_MS || raw > MAIN_DELIVERY_TIMEOUT_MAX_MS) {
    throw new Error(
      `timeoutMs must be an integer from ${MAIN_DELIVERY_TIMEOUT_MIN_MS} to ${MAIN_DELIVERY_TIMEOUT_MAX_MS}`,
    );
  }
  return raw;
}

function normalizeProfileIds(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new Error("reviewerProfileIds must be an array of profile ids");
  }
  if (raw.length > 3) {
    throw new Error("reviewerProfileIds admits at most 3 profile ids");
  }
  const ids = raw.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new Error(`reviewerProfileIds[${index}] must be a non-empty profile id`);
    }
    return entry.trim();
  });
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new Error(`reviewerProfileIds must not contain duplicate id "${id}"`);
    }
    seen.add(id);
  }
  return ids;
}

function validatePrepareInput(input: PrepareMainDeliveryInput): {
  taskFile?: string;
  taskId?: string;
  reviewerProfileIds: string[];
  reason: string;
  timeoutMs: number;
  includeDiffMaxBytes?: number;
} {
  if (input.confirm !== true) {
    throw new Error("delivery prepare requires confirm: true");
  }
  const hasFile = typeof input.taskFile === "string" && input.taskFile.trim().length > 0;
  const hasId = typeof input.taskId === "string" && input.taskId.trim().length > 0;
  if (hasFile === hasId) {
    throw new Error("delivery prepare requires exactly one of taskFile or taskId");
  }
  const includeDiffMaxBytes = input.includeDiffMaxBytes;
  if (includeDiffMaxBytes !== undefined) {
    assertNonnegativeInteger(includeDiffMaxBytes, "includeDiffMaxBytes");
    if (includeDiffMaxBytes > MAIN_DELIVERY_DIFF_MAX_BYTES) {
      throw new Error(`includeDiffMaxBytes must be at most ${MAIN_DELIVERY_DIFF_MAX_BYTES}`);
    }
  }
  return {
    ...(hasFile ? { taskFile: input.taskFile!.trim() } : { taskId: input.taskId!.trim() }),
    reviewerProfileIds: normalizeProfileIds(input.reviewerProfileIds),
    reason: normalizeReason(input.reason, "reason"),
    timeoutMs: normalizeTimeoutMs(input.timeoutMs),
    ...(includeDiffMaxBytes === undefined ? {} : { includeDiffMaxBytes }),
  };
}

function validateDecideInput(input: DecideMainDeliveryInput): {
  taskId: string;
  decision: MainReviewDecisionKind;
  revisionId: string;
  digest: string;
  reason: string;
  timeoutMs: number;
} {
  if (input.confirm !== true) {
    throw new Error("delivery decide requires confirm: true");
  }
  if (typeof input.taskId !== "string" || input.taskId.trim().length === 0) {
    throw new Error("delivery decide requires taskId");
  }
  if (input.decision !== "accept" && input.decision !== "revise" && input.decision !== "reject") {
    throw new Error("delivery decide decision must be accept, revise, or reject");
  }
  if (typeof input.revisionId !== "string" || input.revisionId.trim().length === 0) {
    throw new Error("delivery decide requires revision");
  }
  if (typeof input.digest !== "string" || !DIGEST_PATTERN.test(input.digest.trim())) {
    throw new Error("delivery decide digest must be a 64-character sha256 hex digest");
  }
  return {
    taskId: input.taskId.trim(),
    decision: input.decision,
    revisionId: input.revisionId.trim(),
    digest: input.digest.trim(),
    reason: normalizeReason(input.reason, "reason"),
    timeoutMs: normalizeTimeoutMs(input.timeoutMs),
  };
}

export function requiredJudgesFromTask(task: TaskRecord): 0 | 1 | 2 {
  const declared = task.spec.reviewRequirement?.requiredJudges;
  return declared === 1 || declared === 2 ? declared : 0;
}

export function findLatestIntegrationReceipt(
  store: StateStore,
  taskId: string,
): (IntegrationReceiptRecord & { consumed?: boolean }) | undefined {
  let latestId: string | undefined;
  for (const event of store.listEvents(taskId)) {
    if (event.type !== "integration.preflight.completed") continue;
    const receiptId = (event.payload as { receiptId?: unknown } | undefined)?.receiptId;
    if (typeof receiptId === "string") latestId = receiptId;
  }
  return latestId === undefined ? undefined : store.getIntegrationReceipt(latestId);
}

export function findLatestIntegrationOperation(
  store: StateStore,
  taskId: string,
): MainDeliveryIntegrationRef | undefined {
  const results = store.listIntegrationResults(taskId);
  const first = results[0];
  if (first !== undefined) {
    return { operationId: first.id, receiptId: first.receiptId };
  }
  let found: MainDeliveryIntegrationRef | undefined;
  for (const event of store.listEvents(taskId)) {
    if (event.type !== "integration.operation.started") continue;
    const payload = event.payload as { operationId?: unknown; receiptId?: unknown } | undefined;
    if (typeof payload?.operationId === "string" && typeof payload.receiptId === "string") {
      found = { operationId: payload.operationId, receiptId: payload.receiptId };
    }
  }
  return found;
}

export function countMainReviews(store: StateStore, taskId: string): number {
  return store.listEvents(taskId).filter((event) => event.type === "main-review.completed").length;
}

export function countIntegrationOperations(store: StateStore, taskId: string): number {
  return store.listEvents(taskId).filter((event) => event.type === "integration.operation.started").length;
}

export function countPreflightReceipts(store: StateStore, taskId: string): number {
  return store.listEvents(taskId).filter((event) => event.type === "integration.preflight.completed").length;
}

function remainingTimeoutMs(host: MainDeliveryHost, startedAt: number, timeoutMs: number): number {
  return Math.max(0, timeoutMs - Math.max(0, host.now() - startedAt));
}

async function observeUntil(
  host: MainDeliveryHost,
  startedAt: number,
  timeoutMs: number,
  done: () => boolean,
): Promise<"ready" | "timeout"> {
  if (done()) return "ready";
  while (true) {
    const remaining = remainingTimeoutMs(host, startedAt, timeoutMs);
    if (remaining <= 0) return "timeout";
    await host.sleep(Math.min(Math.max(1, host.pollMs), remaining));
    if (done()) return "ready";
    if (remainingTimeoutMs(host, startedAt, timeoutMs) <= 0) return "timeout";
  }
}

function isWorkerPrepareDone(store: StateStore, taskId: string): boolean {
  const task = store.getTask(taskId);
  const decision = buildTaskDecisionView({
    task,
    attempts: store.listAttempts(taskId),
    events: store.listEvents(taskId),
    integrationResults: store.listIntegrationResults(taskId),
  });
  if (decision.validationRepair?.inProgress === true) return false;
  return isTerminalTaskStatus(task.status);
}

function areJudgesTerminal(store: StateStore, taskId: string): boolean {
  const graph = getReviewGraphStatus(store, taskId);
  if (graph === undefined) return false;
  return graph.assignments.every(
    (assignment) => assignment.status === "completed" || assignment.status === "failed",
  );
}

function isActionableVerifiedCandidate(store: StateStore, taskId: string): boolean {
  const task = store.getTask(taskId);
  if (task.status !== "succeeded") return false;
  const events = store.listEvents(taskId);
  const verification = latestVerificationEvent(events);
  const payload = verification?.payload as { passed?: unknown } | undefined;
  if (payload?.passed !== true) return false;
  return resolveLatestRevision(events) !== undefined;
}

function blocker(code: MainDeliveryBlockerCode, detail?: string): MainDeliveryBlocker {
  return detail === undefined ? { code } : { code, detail };
}

function blockerFromReviewReason(reason: string): MainDeliveryBlocker {
  if (reason === REQUIRED_REVIEW_GRAPH_MISSING) {
    return blocker("required-review-missing", reason);
  }
  if (
    reason === REQUIRED_REVIEW_GRAPH_UNDERSIZED
    || reason === REQUIRED_REVIEW_GRAPH_INSUFFICIENT_USABLE
  ) {
    return blocker("required-review-undersized", reason);
  }
  if (reason === REQUIRED_REVIEW_GRAPH_STALE) {
    return blocker("required-review-stale", reason);
  }
  if (reason === PENDING_REVIEW_BLOCKS_INTEGRATION) {
    return blocker("required-review-pending", reason);
  }
  if (reason === STALE_MAIN_ACCEPT_AFTER_REVIEW) {
    return blocker("stale-main-accept", reason);
  }
  return blocker("review-schema", reason);
}

function blockersFromPreflightReasons(reasons: readonly string[]): MainDeliveryBlocker[] {
  return reasons.map((reason) => {
    if (/source/i.test(reason) || /baseline/i.test(reason) || /digest/i.test(reason)
      || /patch/i.test(reason) || /drift/i.test(reason)) {
      return blocker("source-incompatible", reason);
    }
    if (/review/i.test(reason) || /judge/i.test(reason)) {
      return blockerFromReviewReason(reason);
    }
    return blocker("integration-failed", reason);
  });
}

function projectJudges(graph: ReviewGraphView | undefined): MainDeliveryJudgeView[] {
  if (graph === undefined) return [];
  return [...graph.assignments]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((assignment) => {
      const result = assignment.result;
      const row: MainDeliveryJudgeView = {
        ordinal: assignment.ordinal,
        reviewerWorkerProfileId: assignment.reviewerWorkerProfileId,
        reviewerTaskId: assignment.reviewerTaskId,
        status: assignment.status,
        resultUsable: assignment.resultUsable,
      };
      if (result !== undefined) {
        row.proposedDisposition = result.proposedDisposition;
        row.summary = result.summary;
        row.findings = result.findings.map((finding) => ({ ...finding }));
      }
      if (assignment.failureCode !== undefined) row.failureCode = assignment.failureCode;
      return row;
    });
}

function unusableJudgeBlockers(judges: readonly MainDeliveryJudgeView[]): MainDeliveryBlocker[] {
  return judges
    .filter((judge) => judge.status === "completed" || judge.status === "failed")
    .filter((judge) => !judge.resultUsable)
    .map((judge) => blocker(
      "unusable-judge",
      judge.failureCode === undefined
        ? `judge ${judge.ordinal} produced unusable evidence`
        : `judge ${judge.ordinal}: ${judge.failureCode}`,
    ));
}

function boundDiff(text: string, maxBytes: number): {
  included: true;
  utf8Bytes: number;
  truncated: boolean;
  text: string;
} {
  const encoded = new TextEncoder().encode(text);
  if (encoded.byteLength <= maxBytes) {
    return {
      included: true,
      utf8Bytes: encoded.byteLength,
      truncated: false,
      text,
    };
  }
  let end = Math.min(encoded.byteLength, maxBytes);
  const sliced = encoded.slice(0, end);
  while (end > 0 && (sliced[end - 1]! & 0b1100_0000) === 0b1000_0000) end -= 1;
  if (end > 0 && sliced[end - 1]! >= 0x80) end -= 1;
  const clipped = new TextDecoder().decode(sliced.slice(0, end));
  return {
    included: true,
    utf8Bytes: new TextEncoder().encode(clipped).byteLength,
    truncated: true,
    text: clipped,
  };
}

export async function defaultReadDiff(task: TaskRecord): Promise<string | undefined> {
  try {
    return await readFile(task.paths.diff, "utf8");
  } catch {
    return undefined;
  }
}

interface ProjectOptions {
  call: MainDeliveryCall;
  timeoutMs: number;
  elapsedMs: number;
  observation: MainDeliveryObservationOutcome;
  extraBlockers?: readonly MainDeliveryBlocker[];
  nextActionOverride?: { nextAction: string; nextActionCode: MainDeliveryNextActionCode };
  includeDiffMaxBytes?: number;
  diffText?: string;
  preflight?: MainDeliveryCheckpoint["preflight"];
  integration?: MainDeliveryCheckpoint["integration"];
}

function buildMainDeliveryCheckpoint(
  store: StateStore,
  taskId: string,
  options: ProjectOptions,
): MainDeliveryCheckpoint {
  const task = store.getTask(taskId);
  const events = store.listEvents(taskId);
  const attempts = store.listAttempts(taskId);
  const integrationResults = store.listIntegrationResults(taskId);
  const decision = buildTaskDecisionView({
    task,
    attempts,
    events,
    integrationResults,
  });
  const packet = buildMainDecisionPacketForTask(store, taskId, decision);
  const revision = resolveLatestRevision(events);
  const graph = getReviewGraphStatus(store, taskId);
  const judges = projectJudges(graph);
  const requiredJudges = requiredJudgesFromTask(task);
  const reviewDecision = latestMainReview(events);
  const blockers: MainDeliveryBlocker[] = [];
  if (options.extraBlockers !== undefined) blockers.push(...options.extraBlockers);
  if (options.observation !== "timeout") {
    for (const reason of packet.blockers) {
      const mapped = blockerFromReviewReason(reason);
      if (!blockers.some((existing) => existing.code === mapped.code && existing.detail === mapped.detail)) {
        blockers.push(mapped);
      }
    }
    for (const judgeBlocker of unusableJudgeBlockers(judges)) {
      if (!blockers.some((existing) => existing.detail === judgeBlocker.detail)) {
        blockers.push(judgeBlocker);
      }
    }
  }

  let nextAction = packet.nextAction;
  let nextActionCode: MainDeliveryNextActionCode = packet.nextActionCode;
  if (options.nextActionOverride !== undefined) {
    nextAction = options.nextActionOverride.nextAction;
    nextActionCode = options.nextActionOverride.nextActionCode;
  } else if (options.observation === "timeout") {
    if (options.call === "decide") {
      nextActionCode = "resume-decide";
      nextAction = "Observation timed out. Re-enter delivery decide with the same exact identity; underlying work continues";
    } else {
      nextActionCode = "resume-prepare";
      nextAction = "Observation timed out. Re-enter delivery prepare for this Task id; underlying work continues";
    }
  } else if (options.call === "prepare" && options.observation === "ready") {
    nextActionCode = "record-main-review";
    nextAction = "Reviewed Candidate is ready. Main must call delivery decide with the exact revision and digest; ForkLight does not accept";
  }

  const checkpoint: MainDeliveryCheckpoint = {
    schemaVersion: 1,
    kind: MAIN_DELIVERY_CHECKPOINT_KIND,
    call: options.call,
    observation: {
      outcome: options.observation,
      timeoutMs: options.timeoutMs,
      elapsedMs: options.elapsedMs,
    },
    task: {
      id: task.id,
      status: task.status,
      stage: decision.stage,
    },
    verification: { ...packet.verification },
    review: {
      requiredJudges,
      judges,
      ...(graph === undefined ? {} : {
        graphId: graph.id,
        status: graph.status,
        aggregationState: graph.aggregation.state,
      }),
    },
    blockers,
    stop: { ...packet.stop },
    workspaceDisposition: packet.workspaceDisposition,
    nextAction,
    nextActionCode,
  };

  if (revision !== undefined) {
    const summary = summarizeRevision(revision);
    checkpoint.candidate = {
      revisionId: revision.id,
      digest: revision.patchDigest,
      digestPrefix: summary.digestPrefix,
      filesChanged: revision.filesChanged,
      changedLines: revision.changedLines,
      affectedPathCount: revision.affectedPaths.length,
      verificationPassed: revision.verificationPassed,
    };
  }
  if (options.includeDiffMaxBytes !== undefined && options.diffText !== undefined) {
    checkpoint.diff = boundDiff(options.diffText, options.includeDiffMaxBytes);
  }
  if (reviewDecision !== undefined) {
    checkpoint.mainDecision = {
      decision: reviewDecision.decision,
      ...(reviewDecision.candidateRevisionId === undefined
        ? {}
        : { boundRevisionId: reviewDecision.candidateRevisionId }),
      ...(reviewDecision.acceptedPatchDigest === undefined
        ? {}
        : { boundDigest: reviewDecision.acceptedPatchDigest }),
    };
  }
  if (options.preflight !== undefined) checkpoint.preflight = options.preflight;
  if (options.integration !== undefined) checkpoint.integration = options.integration;
  return checkpoint;
}

function elapsedSince(host: MainDeliveryHost, startedAt: number): number {
  return Math.max(0, host.now() - startedAt);
}

async function projectCurrent(
  host: MainDeliveryHost,
  taskId: string,
  options: Omit<ProjectOptions, "elapsedMs" | "diffText"> & { startedAt: number },
): Promise<MainDeliveryCheckpoint> {
  const task = host.store.getTask(taskId);
  const diffText = options.includeDiffMaxBytes === undefined
    ? undefined
    : await host.readDiff(task);
  return buildMainDeliveryCheckpoint(host.store, taskId, {
    call: options.call,
    timeoutMs: options.timeoutMs,
    elapsedMs: elapsedSince(host, options.startedAt),
    observation: options.observation,
    ...(options.extraBlockers === undefined ? {} : { extraBlockers: options.extraBlockers }),
    ...(options.nextActionOverride === undefined
      ? {}
      : { nextActionOverride: options.nextActionOverride }),
    ...(options.includeDiffMaxBytes === undefined
      ? {}
      : { includeDiffMaxBytes: options.includeDiffMaxBytes }),
    ...(diffText === undefined ? {} : { diffText }),
    ...(options.preflight === undefined ? {} : { preflight: options.preflight }),
    ...(options.integration === undefined ? {} : { integration: options.integration }),
  });
}

function compactIntegration(
  view: IntegrationOperationView,
): MainDeliveryCheckpoint["integration"] {
  return {
    operationId: view.operationId,
    status: view.status,
    ...(view.result === undefined ? {} : { resultStatus: view.result.status }),
  };
}

function compactPreflight(
  receipt: IntegrationReceiptRecord | PreflightReceipt,
): MainDeliveryCheckpoint["preflight"] {
  return {
    receiptId: receipt.id,
    passed: receipt.rejectionReasons.length === 0,
    rejectionCount: receipt.rejectionReasons.length,
  };
}

export async function prepareMainDelivery(
  host: MainDeliveryHost,
  rawInput: PrepareMainDeliveryInput,
): Promise<MainDeliveryCheckpoint> {
  const input = validatePrepareInput(rawInput);
  const startedAt = host.now();

  let taskId: string;
  if (input.taskFile !== undefined) {
    if (host.inspectTaskFile !== undefined) {
      const preview = await host.inspectTaskFile(input.taskFile);
      if (input.reviewerProfileIds.length !== preview.requiredJudges) {
        throw new Error(
          `delivery prepare reviewerProfileIds length ${input.reviewerProfileIds.length} `
          + `must match Task requiredJudges ${preview.requiredJudges}`,
        );
      }
    }
    const submitted = await host.submitFile(input.taskFile);
    taskId = submitted.id;
  } else {
    const existing = host.store.getTask(input.taskId!);
    taskId = existing.id;
    const required = requiredJudgesFromTask(existing);
    if (input.reviewerProfileIds.length !== required) {
      return projectCurrent(host, taskId, {
        call: "prepare",
        startedAt,
        timeoutMs: input.timeoutMs,
        observation: "blocked",
        extraBlockers: [blocker(
          "judge-count-mismatch",
          `reviewerProfileIds length ${input.reviewerProfileIds.length} does not match requiredJudges ${required}`,
        )],
        ...(input.includeDiffMaxBytes === undefined
          ? {}
          : { includeDiffMaxBytes: input.includeDiffMaxBytes }),
      });
    }
  }

  const workerWait = await observeUntil(
    host,
    startedAt,
    input.timeoutMs,
    () => isWorkerPrepareDone(host.store, taskId),
  );
  if (workerWait === "timeout") {
    return projectCurrent(host, taskId, {
      call: "prepare",
      startedAt,
      timeoutMs: input.timeoutMs,
      observation: "timeout",
      ...(input.includeDiffMaxBytes === undefined
        ? {}
        : { includeDiffMaxBytes: input.includeDiffMaxBytes }),
    });
  }

  if (!isActionableVerifiedCandidate(host.store, taskId)) {
    const task = host.store.getTask(taskId);
    const events = host.store.listEvents(taskId);
    const verification = latestVerificationEvent(events);
    const passed = (verification?.payload as { passed?: unknown } | undefined)?.passed === true;
    const extraBlockers: MainDeliveryBlocker[] = [];
    if (task.status === "failed" || task.status === "interrupted" || !passed) {
      extraBlockers.push(blocker(
        "verification-failed",
        "Task did not produce a verified Candidate",
      ));
    } else {
      extraBlockers.push(blocker("missing-candidate", "No exact Candidate Revision is available"));
    }
    return projectCurrent(host, taskId, {
      call: "prepare",
      startedAt,
      timeoutMs: input.timeoutMs,
      observation: task.status === "failed" || task.status === "interrupted" ? "failed" : "blocked",
      extraBlockers,
      ...(input.includeDiffMaxBytes === undefined
        ? {}
        : { includeDiffMaxBytes: input.includeDiffMaxBytes }),
    });
  }

  const required = requiredJudgesFromTask(host.store.getTask(taskId));
  if (input.reviewerProfileIds.length !== required) {
    return projectCurrent(host, taskId, {
      call: "prepare",
      startedAt,
      timeoutMs: input.timeoutMs,
      observation: "blocked",
      extraBlockers: [blocker(
        "judge-count-mismatch",
        `reviewerProfileIds length ${input.reviewerProfileIds.length} does not match requiredJudges ${required}`,
      )],
      ...(input.includeDiffMaxBytes === undefined
        ? {}
        : { includeDiffMaxBytes: input.includeDiffMaxBytes }),
    });
  }

  if (required > 0) {
    const existingGraph = getReviewGraphStatus(host.store, taskId);
    if (existingGraph !== undefined) {
      const existingReason = existingGraph.assignments[0]?.reason;
      const existingOrder = [...existingGraph.assignments]
        .sort((left, right) => left.ordinal - right.ordinal)
        .map((assignment) => assignment.reviewerWorkerProfileId);
      const sameOrder = existingOrder.length === input.reviewerProfileIds.length
        && existingOrder.every((id, index) => id === input.reviewerProfileIds[index]);
      if (!sameOrder) {
        return projectCurrent(host, taskId, {
          call: "prepare",
          startedAt,
          timeoutMs: input.timeoutMs,
          observation: "blocked",
          extraBlockers: [blocker(
            "reviewer-set-mismatch",
            "Reviewer Profile order does not match the frozen Review Graph",
          )],
          ...(input.includeDiffMaxBytes === undefined
            ? {}
            : { includeDiffMaxBytes: input.includeDiffMaxBytes }),
        });
      }
      if (existingReason !== undefined && existingReason !== input.reason) {
        return projectCurrent(host, taskId, {
          call: "prepare",
          startedAt,
          timeoutMs: input.timeoutMs,
          observation: "blocked",
          extraBlockers: [blocker(
            "reason-mismatch",
            "prepare reason does not match the existing Review Graph reason",
          )],
          ...(input.includeDiffMaxBytes === undefined
            ? {}
            : { includeDiffMaxBytes: input.includeDiffMaxBytes }),
        });
      }
    }
    try {
      await host.createReviewGraph({
        taskId,
        reviewerWorkerProfileIds: [...input.reviewerProfileIds],
        reason: input.reason,
        confirm: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return projectCurrent(host, taskId, {
        call: "prepare",
        startedAt,
        timeoutMs: input.timeoutMs,
        observation: "blocked",
        extraBlockers: [blocker("reviewer-set-mismatch", message)],
        ...(input.includeDiffMaxBytes === undefined
          ? {}
          : { includeDiffMaxBytes: input.includeDiffMaxBytes }),
      });
    }

    const judgeWait = await observeUntil(
      host,
      startedAt,
      input.timeoutMs,
      () => areJudgesTerminal(host.store, taskId),
    );
    if (judgeWait === "timeout") {
      return projectCurrent(host, taskId, {
        call: "prepare",
        startedAt,
        timeoutMs: input.timeoutMs,
        observation: "timeout",
        ...(input.includeDiffMaxBytes === undefined
          ? {}
          : { includeDiffMaxBytes: input.includeDiffMaxBytes }),
      });
    }
  }

  const judges = projectJudges(getReviewGraphStatus(host.store, taskId));
  const unusable = unusableJudgeBlockers(judges);
  return projectCurrent(host, taskId, {
    call: "prepare",
    startedAt,
    timeoutMs: input.timeoutMs,
    observation: unusable.length > 0 ? "blocked" : "ready",
    extraBlockers: unusable,
    ...(input.includeDiffMaxBytes === undefined
      ? {}
      : { includeDiffMaxBytes: input.includeDiffMaxBytes }),
  });
}

function sameBoundDecision(
  existing: MainReviewDecision,
  input: { decision: MainReviewDecisionKind; reason: string; revisionId: string; digest: string },
): { same: boolean; blocker?: MainDeliveryBlocker } {
  if (existing.decision !== input.decision) {
    return { same: false, blocker: blocker("decision-mismatch", "existing Main decision differs") };
  }
  if (existing.reason !== input.reason) {
    return { same: false, blocker: blocker("reason-mismatch", "existing Main decision reason differs") };
  }
  if (
    existing.candidateRevisionId !== undefined
    && existing.candidateRevisionId !== input.revisionId
  ) {
    return { same: false, blocker: blocker("stale-identity", "existing Main decision revision differs") };
  }
  if (
    existing.acceptedPatchDigest !== undefined
    && existing.acceptedPatchDigest !== input.digest
  ) {
    return { same: false, blocker: blocker("stale-identity", "existing Main decision digest differs") };
  }
  return { same: true };
}

function latestMainReviewEventSequence(
  events: ReadonlyArray<{ type: string; sequence: number }>,
): number | undefined {
  let sequence: number | undefined;
  for (const event of events) {
    if (event.type === "main-review.completed") sequence = event.sequence;
  }
  return sequence;
}

function findFirstPostReviewReceipt(
  store: StateStore,
  taskId: string,
  afterSequence: number,
): (IntegrationReceiptRecord & { consumed?: boolean }) | undefined {
  for (const event of store.listEvents(taskId)) {
    if (event.sequence <= afterSequence) continue;
    if (event.type !== "integration.preflight.completed") continue;
    const receiptId = (event.payload as { receiptId?: unknown } | undefined)?.receiptId;
    if (typeof receiptId !== "string") continue;
    return store.getIntegrationReceipt(receiptId);
  }
  return undefined;
}

function findOperationForReceipt(
  store: StateStore,
  taskId: string,
  receiptId: string,
): MainDeliveryIntegrationRef | undefined {
  for (const result of store.listIntegrationResults(taskId)) {
    if (result.receiptId === receiptId) {
      return { operationId: result.id, receiptId };
    }
  }
  for (const event of store.listEvents(taskId)) {
    if (event.type !== "integration.operation.started") continue;
    const payload = event.payload as { operationId?: unknown; receiptId?: unknown } | undefined;
    if (payload?.receiptId === receiptId && typeof payload.operationId === "string") {
      return { operationId: payload.operationId, receiptId };
    }
  }
  return undefined;
}

function matchingHostOperation(
  host: MainDeliveryHost,
  taskId: string,
  receiptId: string,
): MainDeliveryIntegrationRef | undefined {
  const found = host.findIntegration(taskId);
  if (found === undefined || found.receiptId !== receiptId) return undefined;
  return found;
}

function integrationObservation(
  view: IntegrationOperationView | undefined,
): {
  observation: MainDeliveryObservationOutcome;
  extraBlockers: MainDeliveryBlocker[];
  integration?: MainDeliveryCheckpoint["integration"];
} {
  if (view === undefined) {
    return { observation: "blocked", extraBlockers: [] };
  }
  const integration = compactIntegration(view);
  if (view.result !== undefined) {
    if (view.result.status === "applied") {
      return { observation: "ready", extraBlockers: [], integration };
    }
    return {
      observation: "failed",
      extraBlockers: [blocker(
        "integration-failed",
        view.result.error ?? view.result.status,
      )],
      integration,
    };
  }
  if (view.status === "running") {
    return { observation: "timeout", extraBlockers: [], integration };
  }
  if (view.status === "outcome-unknown") {
    return { observation: "timeout", extraBlockers: [], integration };
  }
  if (view.status === "failed") {
    return {
      observation: "failed",
      extraBlockers: [blocker("integration-failed", "Integration failed")],
      integration,
    };
  }
  return { observation: "ready", extraBlockers: [], integration };
}

async function observeBoundAccept(
  host: MainDeliveryHost,
  taskId: string,
  startedAt: number,
  timeoutMs: number,
  preflight: MainDeliveryCheckpoint["preflight"],
  operation: MainDeliveryIntegrationRef,
): Promise<MainDeliveryCheckpoint> {
  const remaining = remainingTimeoutMs(host, startedAt, timeoutMs);
  if (remaining <= 0) {
    const result = host.store.getIntegrationResult(operation.operationId);
    if (result !== undefined) {
      const observed = integrationObservation({
        operationId: operation.operationId,
        taskId: result.taskId,
        receiptId: result.receiptId,
        status: result.status === "applied" ? "completed" : "failed",
        stages: result.stages ?? [],
        result,
      });
      return projectCurrent(host, taskId, {
        call: "decide",
        startedAt,
        timeoutMs,
        observation: observed.observation,
        extraBlockers: observed.extraBlockers,
        preflight,
        ...(observed.integration === undefined ? {} : { integration: observed.integration }),
      });
    }
    return projectCurrent(host, taskId, {
      call: "decide",
      startedAt,
      timeoutMs,
      observation: "timeout",
      preflight,
      integration: {
        operationId: operation.operationId,
        status: "running",
      },
    });
  }
  const waited = await host.waitIntegration(operation.operationId, remaining);
  const observed = integrationObservation(waited);
  return projectCurrent(host, taskId, {
    call: "decide",
    startedAt,
    timeoutMs,
    observation: observed.observation,
    extraBlockers: observed.extraBlockers,
    preflight,
    ...(observed.integration === undefined ? {} : { integration: observed.integration }),
  });
}

export async function decideMainDelivery(
  host: MainDeliveryHost,
  rawInput: DecideMainDeliveryInput,
): Promise<MainDeliveryCheckpoint> {
  const input = validateDecideInput(rawInput);
  const startedAt = host.now();
  const store = host.store;
  store.getTask(input.taskId);
  const events = store.listEvents(input.taskId);
  const revision = resolveLatestRevision(events);
  const verification = latestVerificationEvent(events);
  const passed = (verification?.payload as { passed?: unknown } | undefined)?.passed === true;

  if (revision === undefined) {
    return projectCurrent(host, input.taskId, {
      call: "decide",
      startedAt,
      timeoutMs: input.timeoutMs,
      observation: "blocked",
      extraBlockers: [blocker("missing-candidate", "No exact Candidate Revision is available")],
    });
  }
  if (revision.id !== input.revisionId || revision.patchDigest !== input.digest) {
    return projectCurrent(host, input.taskId, {
      call: "decide",
      startedAt,
      timeoutMs: input.timeoutMs,
      observation: "blocked",
      extraBlockers: [blocker(
        "stale-identity",
        "Task/Revision/digest does not match the current verified Candidate",
      )],
    });
  }
  if (!passed) {
    return projectCurrent(host, input.taskId, {
      call: "decide",
      startedAt,
      timeoutMs: input.timeoutMs,
      observation: "blocked",
      extraBlockers: [blocker("verification-failed", "Current verification did not pass")],
    });
  }

  const required = requiredJudgesFromTask(store.getTask(input.taskId));
  if (required > 0) {
    const gate = evaluateReviewRequirementForTask(store, input.taskId);
    const graph = getReviewGraphStatus(store, input.taskId);
    const judges = projectJudges(graph);
    if (graph === undefined || !areJudgesTerminal(store, input.taskId)) {
      return projectCurrent(host, input.taskId, {
        call: "decide",
        startedAt,
        timeoutMs: input.timeoutMs,
        observation: "blocked",
        extraBlockers: [blocker("not-fully-reviewed", "Required judges are not terminal")],
      });
    }
    const unusable = unusableJudgeBlockers(judges);
    if (unusable.length > 0) {
      return projectCurrent(host, input.taskId, {
        call: "decide",
        startedAt,
        timeoutMs: input.timeoutMs,
        observation: "blocked",
        extraBlockers: unusable,
      });
    }
    if (
      gate.status === "missing"
      || gate.status === "undersized"
      || gate.status === "stale"
      || gate.status === "pending"
    ) {
      return projectCurrent(host, input.taskId, {
        call: "decide",
        startedAt,
        timeoutMs: input.timeoutMs,
        observation: "blocked",
        extraBlockers: gate.rejectionReasons.map(blockerFromReviewReason),
      });
    }
  }

  const existingReview = latestMainReview(events);
  const recordedThisCall = existingReview === undefined;
  if (existingReview !== undefined) {
    const comparison = sameBoundDecision(existingReview, input);
    if (!comparison.same && comparison.blocker !== undefined) {
      return projectCurrent(host, input.taskId, {
        call: "decide",
        startedAt,
        timeoutMs: input.timeoutMs,
        observation: "blocked",
        extraBlockers: [comparison.blocker],
      });
    }
  } else {
    host.recordMainReview(input.taskId, input.decision, input.reason, true);
  }

  if (input.decision !== "accept") {
    return projectCurrent(host, input.taskId, {
      call: "decide",
      startedAt,
      timeoutMs: input.timeoutMs,
      observation: "ready",
    });
  }

  const reviewSequence = recordedThisCall
    ? undefined
    : latestMainReviewEventSequence(store.listEvents(input.taskId));
  const boundReceipt = reviewSequence === undefined
    ? undefined
    : findFirstPostReviewReceipt(store, input.taskId, reviewSequence);

  if (boundReceipt !== undefined && boundReceipt.rejectionReasons.length > 0) {
    return projectCurrent(host, input.taskId, {
      call: "decide",
      startedAt,
      timeoutMs: input.timeoutMs,
      observation: "blocked",
      extraBlockers: blockersFromPreflightReasons(boundReceipt.rejectionReasons),
      preflight: compactPreflight(boundReceipt),
    });
  }

  const boundOperation = boundReceipt === undefined
    ? undefined
    : findOperationForReceipt(store, input.taskId, boundReceipt.id)
      ?? matchingHostOperation(host, input.taskId, boundReceipt.id);
  if (boundReceipt !== undefined && boundOperation !== undefined) {
    return observeBoundAccept(
      host,
      input.taskId,
      startedAt,
      input.timeoutMs,
      compactPreflight(boundReceipt),
      boundOperation,
    );
  }

  if (boundReceipt !== undefined && boundReceipt.consumed === true) {
    return projectCurrent(host, input.taskId, {
      call: "decide",
      startedAt,
      timeoutMs: input.timeoutMs,
      observation: "timeout",
      preflight: compactPreflight(boundReceipt),
    });
  }

  let receiptId: string;
  let preflightView: ReturnType<typeof compactPreflight>;
  if (boundReceipt !== undefined) {
    receiptId = boundReceipt.id;
    preflightView = compactPreflight(boundReceipt);
  } else {
    const fresh = await host.preflightIntegration(input.taskId);
    preflightView = compactPreflight(fresh);
    if (fresh.rejectionReasons.length > 0) {
      return projectCurrent(host, input.taskId, {
        call: "decide",
        startedAt,
        timeoutMs: input.timeoutMs,
        observation: "blocked",
        extraBlockers: blockersFromPreflightReasons(fresh.rejectionReasons),
        preflight: preflightView,
      });
    }
    receiptId = fresh.id;
  }

  let started: IntegrationOperationView;
  try {
    started = host.startIntegration(input.taskId, receiptId);
  } catch (error) {
    const raced = findOperationForReceipt(store, input.taskId, receiptId)
      ?? matchingHostOperation(host, input.taskId, receiptId);
    if (raced === undefined) {
      const message = error instanceof Error ? error.message : String(error);
      return projectCurrent(host, input.taskId, {
        call: "decide",
        startedAt,
        timeoutMs: input.timeoutMs,
        observation: "blocked",
        extraBlockers: [blocker("integration-failed", message)],
        preflight: preflightView,
      });
    }
    started = {
      operationId: raced.operationId,
      taskId: input.taskId,
      receiptId: raced.receiptId,
      status: "running",
      stages: [],
    };
  }

  return observeBoundAccept(
    host,
    input.taskId,
    startedAt,
    input.timeoutMs,
    preflightView,
    { operationId: started.operationId, receiptId: started.receiptId },
  );
}

export function formatMainDeliveryCheckpointHuman(checkpoint: MainDeliveryCheckpoint): string {
  const lines: string[] = [];
  lines.push(`delivery: ${checkpoint.call} ${checkpoint.observation.outcome}`);
  lines.push(`task: ${checkpoint.task.id} status=${checkpoint.task.status} stage=${checkpoint.task.stage}`);
  lines.push(
    `observation: outcome=${checkpoint.observation.outcome}`
    + ` timeoutMs=${checkpoint.observation.timeoutMs}`
    + ` elapsedMs=${checkpoint.observation.elapsedMs}`,
  );
  if (checkpoint.candidate !== undefined) {
    lines.push(
      `candidate: revision=${checkpoint.candidate.revisionId}`
      + ` digest=${checkpoint.candidate.digest}`
      + ` files=${checkpoint.candidate.filesChanged}`
      + ` lines=${checkpoint.candidate.changedLines}`,
    );
  }
  const verification = checkpoint.verification;
  if (!verification.present) {
    lines.push("verification: absent");
  } else {
    lines.push(
      `verification: passed=${String(verification.passed ?? "unknown")}`
      + ` commands=${String(verification.commandCount ?? 0)}`
      + ` failed=${String(verification.failedCommandCount ?? 0)}`,
    );
  }
  const required = checkpoint.review.requiredJudges ?? 0;
  lines.push(
    `review: required=${required}`
    + (checkpoint.review.graphId === undefined ? "" : ` graph=${checkpoint.review.graphId}`)
    + (checkpoint.review.status === undefined ? "" : ` status=${checkpoint.review.status}`)
    + ` judges=${checkpoint.review.judges.length}`,
  );
  for (const judge of checkpoint.review.judges) {
    const disposition = judge.proposedDisposition ?? (judge.resultUsable ? "usable" : "unusable");
    const summary = judge.summary === undefined ? "" : ` — ${judge.summary}`;
    const failure = judge.failureCode === undefined ? "" : ` failure=${judge.failureCode}`;
    lines.push(
      `  judge ${judge.ordinal}: profile=${judge.reviewerWorkerProfileId}`
      + ` status=${judge.status} usable=${String(judge.resultUsable)}`
      + ` disposition=${disposition}${failure}${summary}`,
    );
    if (judge.findings !== undefined) {
      lines.push(`    findings: ${judge.findings.length}`);
    }
  }
  if (checkpoint.mainDecision !== undefined) {
    lines.push(`mainDecision: ${checkpoint.mainDecision.decision}`);
  }
  if (checkpoint.preflight !== undefined) {
    lines.push(
      `preflight: receipt=${checkpoint.preflight.receiptId}`
      + ` passed=${String(checkpoint.preflight.passed)}`
      + ` rejections=${checkpoint.preflight.rejectionCount}`,
    );
  }
  if (checkpoint.integration !== undefined) {
    lines.push(
      `integration: operation=${checkpoint.integration.operationId}`
      + ` status=${checkpoint.integration.status}`
      + (checkpoint.integration.resultStatus === undefined
        ? ""
        : ` result=${checkpoint.integration.resultStatus}`),
    );
  }
  lines.push(`blockers: ${checkpoint.blockers.length}`);
  for (const item of checkpoint.blockers) {
    lines.push(
      item.detail === undefined ? `  - ${item.code}` : `  - ${item.code}: ${item.detail}`,
    );
  }
  if (checkpoint.stop.code !== "none") {
    lines.push(
      checkpoint.stop.detail === undefined
        ? `stop: ${checkpoint.stop.code}`
        : `stop: ${checkpoint.stop.code} (${checkpoint.stop.detail})`,
    );
  }
  lines.push(`workspaceDisposition: ${checkpoint.workspaceDisposition}`);
  lines.push(`next: ${checkpoint.nextActionCode}`);
  lines.push(`nextAction: ${checkpoint.nextAction}`);
  if (checkpoint.diff?.included === true) {
    lines.push(
      `diff: included utf8Bytes=${checkpoint.diff.utf8Bytes} truncated=${String(checkpoint.diff.truncated)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}
