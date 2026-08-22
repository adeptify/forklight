/**
 * Main-direct execution decision — durable, privacy-safe, independent from Task/Worker lifecycle.
 *
 * When Main decides a piece of work is too small, urgent, clear, or otherwise not
 * worth launching a ForkLight Worker, this module records the decision with immutable
 * start facts and exactly one explicit close result. It never creates a Task,
 * launches a Worker, probes a Provider, or claims zero Main Token/cost.
 */

import { randomUUID } from "node:crypto";
import { isoTimestamp } from "./time.js";
import { listWorkerProfiles } from "./worker-profiles.js";
import { resolveWorkerReadiness } from "./worker-readiness.js";
import { isProviderName, type ProviderName, type ProviderReadiness } from "./providers.js";
import { type RuntimeName } from "./runtime-names.js";
import type {
  MainDirectClosedState,
  MainDirectConsideredWorkerSnapshot,
  MainDirectDecisionAggregate,
  MainDirectDecisionProjection,
  MainDirectDecisionReason,
  MainDirectDecisionRecentEntry,
  MainDirectDecisionRecord,
  MainDirectEvidenceSnapshotEntry,
  MainDirectVerification,
} from "./types.js";
import type { ModelCatalogSettings } from "./model-catalog.js";
import type { ProviderDefaultsSettings } from "./settings.js";
import type { WorkerProfilesSettings } from "./worker-profiles.js";

// --- Constants ---

export const VALID_REASONS: ReadonlySet<MainDirectDecisionReason> = new Set([
  "small-clear-change",
  "urgent-fix",
  "workers-unavailable",
  "user-requested",
  "main-judgment",
]);

const VALID_VERIFICATIONS: ReadonlySet<MainDirectVerification> = new Set([
  "passed",
  "failed",
  "unavailable",
]);

const MAX_CONSIDERED_PROFILES = 4;
const MAX_NOTE_LENGTH = 300;
const TASK_CLASS_MAX = 80;
const TASK_FAMILY_MAX = 80;
export const MAIN_DIRECT_RECENT_LIMIT = 20;

// --- Validators ---

function requireNonEmptyTrimmed(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`${label} must be 1-${maxLength} characters`);
  }
  return value.trim();
}

function optionalTrimmed(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  return requireNonEmptyTrimmed(value, label, maxLength);
}

// --- Start validation ---

export interface MainDirectStartInput {
  taskClass: string;
  taskFamily?: string;
  reason: MainDirectDecisionReason;
  note: string;
  consideredWorkerProfileIds: string[];
  confirm: true;
}

export interface MainDirectStartContext {
  workerProfiles: WorkerProfilesSettings;
  modelCatalog?: ModelCatalogSettings;
  providerDefaults: ProviderDefaultsSettings;
  providers: Record<ProviderName, ProviderReadiness>;
  runtimes: Partial<Record<RuntimeName, { ok: boolean }>>;
  /** Existing, read-only full-Worker routing evidence. Supplying this never
   * probes a Provider or mutates routing state. */
  routingEvidence?: {
    exact: ReadonlyMap<string, { relevantSampleCount: number }>;
    family?: ReadonlyMap<string, { relevantSampleCount: number }>;
    minRelevantSamples: number;
    familyMinRelevantSamples: number;
  };
}

function resolveConsideredWorkerSnapshot(
  profileId: string,
  context: MainDirectStartContext,
): MainDirectConsideredWorkerSnapshot {
  const profiles = listWorkerProfiles(context.workerProfiles);
  const profile = profiles.find((p) => p.id === profileId);
  // Caller guarantees profile exists (rejected in validateMainDirectStart)
  if (!profile) {
    throw new Error(`Unknown consideredWorkerProfileId: ${profileId}`);
  }
  let readiness: MainDirectConsideredWorkerSnapshot["readiness"] = "unknown";
  try {
    const results = resolveWorkerReadiness({
      workerProfiles: {
        defaultProfileId: context.workerProfiles.defaultProfileId,
        profiles: [profile],
      },
      ...(context.modelCatalog === undefined ? {} : { modelCatalog: context.modelCatalog }),
      providerDefaults: context.providerDefaults,
      providers: context.providers,
      runtimes: context.runtimes,
      providerVerification: {},
    });
    const r = results[0];
    if (r) readiness = r.state;
  } catch {
    readiness = "unknown";
  }

  const provider = (profile.provider !== undefined && isProviderName(profile.provider))
    ? profile.provider : "";
  const model = profile.model ?? "";
  const runtime: RuntimeName = profile.runtime;
  const effort = profile.effort ?? "medium";
  return {
    workerProfileId: profile.id,
    label: profile.label,
    provider,
    model,
    runtime,
    effort,
    readiness,
    available: true,
  };
}

function workerIdentityKey(worker: MainDirectConsideredWorkerSnapshot): string {
  return [worker.provider, worker.model, worker.runtime, worker.effort].join("\0");
}

function resolveEvidenceSnapshot(
  workers: readonly MainDirectConsideredWorkerSnapshot[],
  evidence: MainDirectStartContext["routingEvidence"],
): MainDirectEvidenceSnapshotEntry[] {
  if (workers.length === 0) return [];

  const counts = workers.map((worker) => {
    const key = workerIdentityKey(worker);
    return {
      workerProfileId: worker.workerProfileId,
      exactClassSampleCount: evidence?.exact.get(key)?.relevantSampleCount ?? 0,
      familySampleCount: evidence?.family?.get(key)?.relevantSampleCount ?? 0,
    };
  });
  const exactReady = evidence !== undefined && counts.every(
    (entry) => entry.exactClassSampleCount >= evidence.minRelevantSamples,
  );
  const familyReady = evidence?.family !== undefined && counts.every(
    (entry) => entry.familySampleCount >= evidence.familyMinRelevantSamples,
  );
  const scope: MainDirectEvidenceSnapshotEntry["scope"] = exactReady
    ? "exact-class"
    : familyReady ? "task-family" : "none";
  return counts.map((entry) => ({ ...entry, scope }));
}

export function validateMainDirectStart(
  input: MainDirectStartInput,
  context: MainDirectStartContext,
  _legacyTasks: readonly unknown[] = [],
): {
  consideredWorkers: MainDirectConsideredWorkerSnapshot[];
  evidenceSnapshot: MainDirectEvidenceSnapshotEntry[];
} {
  const taskClass = requireNonEmptyTrimmed(input.taskClass, "taskClass", TASK_CLASS_MAX);
  const taskFamily = optionalTrimmed(input.taskFamily, "taskFamily", TASK_FAMILY_MAX);

  if (!VALID_REASONS.has(input.reason)) {
    throw new Error(`reason must be one of: ${[...VALID_REASONS].join(", ")}`);
  }
  requireNonEmptyTrimmed(input.note, "note", MAX_NOTE_LENGTH);
  if (input.confirm !== true) throw new Error("main_direct_start requires explicit confirm: true");

  // Validate considered profile ids
  const ids = input.consideredWorkerProfileIds;
  if (!Array.isArray(ids)) throw new Error("consideredWorkerProfileIds must be an array");
  if (ids.length > MAX_CONSIDERED_PROFILES) {
    throw new Error(`consideredWorkerProfileIds must have at most ${MAX_CONSIDERED_PROFILES} entries`);
  }
  const seen = new Set<string>();
  const normalizedIds: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new Error("Each consideredWorkerProfileId must be a non-empty string");
    }
    const normalized = id.trim();
    if (seen.has(normalized)) throw new Error("Duplicate consideredWorkerProfileId");
    seen.add(normalized);
    normalizedIds.push(normalized);
  }
  const knownProfileIds = new Set(listWorkerProfiles(context.workerProfiles).map((profile) => profile.id));
  for (const id of normalizedIds) {
    if (!knownProfileIds.has(id)) throw new Error(`Unknown consideredWorkerProfileId: ${id}`);
  }

  const consideredWorkers = normalizedIds.map((id) =>
    resolveConsideredWorkerSnapshot(id, context),
  );
  void taskClass;
  void taskFamily;
  void _legacyTasks;
  const evidenceSnapshot = resolveEvidenceSnapshot(consideredWorkers, context.routingEvidence);

  return { consideredWorkers, evidenceSnapshot };
}

export function createMainDirectDecision(
  input: MainDirectStartInput,
  consideredWorkers: MainDirectConsideredWorkerSnapshot[],
  evidenceSnapshot: MainDirectEvidenceSnapshotEntry[],
): MainDirectDecisionRecord {
  const id = randomUUID();
  const taskClass = (input.taskClass as string).trim();
  const taskFamily = input.taskFamily !== undefined ? input.taskFamily.trim() : undefined;
  return {
    id,
    taskClass,
    ...(taskFamily === undefined ? {} : { taskFamily }),
    reason: input.reason,
    note: input.note.trim(),
    consideredWorkerProfileIds: input.consideredWorkerProfileIds.map((s) => s.trim()),
    consideredWorkers,
    evidenceSnapshot,
    status: "open",
    startedAt: isoTimestamp(),
  };
}

// --- Close validation ---

export interface MainDirectCompleteInput {
  id: string;
  outcome: "completed" | "abandoned";
  verification?: MainDirectVerification;
  note: string;
  confirm: true;
}

export function validateMainDirectClose(
  input: MainDirectCompleteInput,
  existing: MainDirectDecisionRecord,
): MainDirectClosedState {
  if (existing.status !== "open") {
    throw new Error(`Decision ${existing.id} is already ${existing.status}`);
  }
  if (input.confirm !== true) throw new Error("main_direct_complete requires explicit confirm: true");
  if (input.outcome !== "completed" && input.outcome !== "abandoned") {
    throw new Error("outcome must be completed or abandoned");
  }
  if (input.outcome === "completed") {
    if (input.verification === undefined || !VALID_VERIFICATIONS.has(input.verification)) {
      throw new Error("verification must be passed, failed, or unavailable when outcome is completed");
    }
  } else {
    if (input.verification !== undefined) {
      throw new Error("verification must be absent when outcome is abandoned");
    }
  }
  const note = requireNonEmptyTrimmed(input.note, "note", MAX_NOTE_LENGTH);
  return {
    outcome: input.outcome,
    ...(input.verification === undefined ? {} : { verification: input.verification }),
    note,
    closedAt: isoTimestamp(),
  };
}

/** Idempotent close check. Returns true when the close would be identical. */
export function isIdenticalClose(
  existing: MainDirectClosedState,
  proposed: MainDirectClosedState,
): boolean {
  return existing.outcome === proposed.outcome
    && existing.verification === proposed.verification
    && existing.note === proposed.note;
}

// --- Privacy-safe projection ---

export function projectMainDirectDecision(
  record: MainDirectDecisionRecord,
): MainDirectDecisionProjection {
  const scope = record.consideredWorkerProfileIds.length === 0
    ? "none"
    : record.evidenceSnapshot.length > 0
      ? record.evidenceSnapshot[0]!.scope
      : "none";
  return {
    id: record.id,
    taskClass: record.taskClass,
    ...(record.taskFamily === undefined ? {} : { taskFamily: record.taskFamily }),
    reason: record.reason,
    note: record.note,
    status: record.status,
    consideredWorkerCount: record.consideredWorkerProfileIds.length,
    consideredWorkerIds: [...record.consideredWorkerProfileIds],
    consideredWorkerLabels: record.consideredWorkers.map((w) => ({
      workerProfileId: w.workerProfileId,
      label: w.label,
    })),
    evidenceScope: scope,
    startedAt: record.startedAt,
    ...(record.closedState === undefined ? {} : {
      outcome: record.closedState.outcome,
      ...(record.closedState.verification === undefined
        ? {}
        : { verification: record.closedState.verification }),
      closedAt: record.closedState.closedAt,
    }),
  };
}

export function projectMainDirectDecisionList(
  records: readonly MainDirectDecisionRecord[],
): MainDirectDecisionProjection[] {
  return records.map(projectMainDirectDecision);
}

// --- Aggregate ---

export function computeMainDirectAggregate(
  records: readonly MainDirectDecisionRecord[],
): MainDirectDecisionAggregate {
  let openCount = 0;
  let completedCount = 0;
  let abandonedCount = 0;
  let completedPassedCount = 0;
  let completedFailedCount = 0;
  let completedUnavailableCount = 0;
  const reasonDistribution: Partial<Record<MainDirectDecisionReason, number>> = {};

  for (const r of records) {
    reasonDistribution[r.reason] = (reasonDistribution[r.reason] ?? 0) + 1;
    if (r.status === "open") {
      openCount += 1;
    } else if (r.status === "completed") {
      completedCount += 1;
      if (r.closedState?.verification === "passed") completedPassedCount += 1;
      else if (r.closedState?.verification === "failed") completedFailedCount += 1;
      else completedUnavailableCount += 1;
    } else if (r.status === "abandoned") {
      abandonedCount += 1;
    }
  }

  return {
    openCount,
    completedCount,
    abandonedCount,
    completedPassedCount,
    completedFailedCount,
    completedUnavailableCount,
    totalCount: records.length,
    reasonDistribution,
  };
}

// --- Recent entries for Hub ---

export function selectMainDirectRecentEntries(
  records: readonly MainDirectDecisionRecord[],
  limit: number = MAIN_DIRECT_RECENT_LIMIT,
): MainDirectDecisionRecentEntry[] {
  return records
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      taskClass: r.taskClass,
      reason: r.reason,
      status: r.status,
      ...(r.closedState === undefined ? {} : { outcome: r.closedState.outcome }),
      ...(r.closedState?.verification === undefined
        ? {}
        : { verification: r.closedState.verification }),
      startedAt: r.startedAt,
      ...(r.closedState === undefined ? {} : { closedAt: r.closedState.closedAt }),
      consideredWorkerCount: r.consideredWorkerProfileIds.length,
    }));
}
