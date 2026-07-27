/**
 * ForkLight Hub — loopback control plane (configure + operate).
 *
 * Boundaries:
 *   - HubServer: HTTP UI + setup APIs (models, workers, main install, keys)
 *   - Daemon (via ensureDaemon / daemonRequest): task board, submit, health
 *   - main-install: Main-client plugin / MCP / skill channels only
 *   - settings-api: Hub-safe view/patch of settings (no secrets in JSON)
 *
 * `forklight hub` starts both daemon (backend) and this server (frontend).
 * Unlike first-run setup, Hub does not auto-shutdown after configuration.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { SettingsService } from "../core/settings.js";
import type { SetupService } from "../setup/service.js";
import type { SetupKeychainStore } from "../setup/types.js";
import type { DaemonMethod } from "../daemon/protocol.js";
import { providerDefinition, isProviderName } from "../core/providers.js";
import { listWorkerAdapters } from "../workers/registry.js";
import { MIME, SECURITY_HEADERS, safeJson } from "../server-http.js";
import {
  buildHubSettingsPatch,
  viewHubSettings,
  viewModelRoutingSettings,
  type HubSettingsPatch,
} from "./settings-api.js";
import {
  installMainComponent,
  listMainSurfaceStatus,
  uninstallMainComponent,
  type MainClientId,
  type MainInstallComponent,
} from "./main-install.js";
import {
  currentBuildIdentity,
  isBuildIdentity,
  projectVersionJourney,
  type BuildIdentity,
  type VersionJourney,
} from "../core/build-identity.js";
import { inspectSourceTree } from "../core/source-digest.js";
import {
  executionPatchFromProfile,
  getWorkerProfile,
  removeWorkerProfile,
  setDefaultWorkerProfile,
  upsertWorkerProfile,
  validateWorkerProfile,
  workerIdsUsingModel,
} from "../core/worker-profiles.js";
import {
  removeModelConfig,
  upsertModelConfig,
  validateModelConfig,
} from "../core/model-catalog.js";
import {
  defaultAdvancedPolicyFields,
  enforcementCapabilityForRuntime,
  previewEffectivePolicy,
  validateAdvancedPolicyPatch,
} from "../core/advanced-policy.js";
import type { AdvancedPolicyFields } from "../core/types.js";
import { isRuntimeName } from "../core/runtime-names.js";
import { buildDeliveryPlanView } from "../core/delivery-profiles.js";
import { parseAffectedPathsFromWorkspaceDiff } from "../workspace/patch.js";
import { normalizeCodexTerminalUsage } from "../core/codex-terminal-usage.js";
import { grossDirectCodexTokens } from "../core/direct-codex-calibration.js";
import { isoTimestamp } from "../core/time.js";

const LOOPBACK = "127.0.0.1";
const MAX_BODY_BYTES = 20_480;
const TOKEN_HEADER = "x-forklight-hub-token";
// Longer than the default two-second Hub refresh interval, so one open tab
// does not repeat every runtime subprocess check on every refresh.
const DEFAULT_HUB_EVIDENCE_TTL_MS = 15_000;
const ADAPTATION_PROPOSED_REASONS = new Set([
  "duration-budget",
  "size-policy",
  "attempt-budget",
  "completion-policy",
  "concurrency-cap",
  "no-progress-timeout",
  "other-flexible-policy",
]);
const DIRECT_CODEX_REVIEW_DECISIONS = new Set(["accepted", "rejected"]);
const DIRECT_CODEX_REJECTION_REASONS = new Set([
  "not-equivalent-task",
  "insufficient-quality",
  "incomplete-evidence",
  "duplicate-evidence",
]);
const DIRECT_CODEX_CAPTURE_KEYS = new Set(["runRef", "usage"]);
const DIRECT_CODEX_ACCEPT_REVIEW_KEYS = new Set(["sampleId", "decision", "confirm"]);
const DIRECT_CODEX_REJECT_REVIEW_KEYS = new Set([
  "sampleId",
  "decision",
  "rejectionReason",
  "confirm",
]);
const DIRECT_CODEX_PUBLISH_KEYS = new Set(["confirm"]);

/**
 * Evidence classes the Hub is allowed to memoise briefly. Each class is
 * identified by a stable key so concurrent callers share one in-flight
 * inspection while a valid snapshot exists.
 *
 * "setupStatus"  — full /api/status payload (settings, prereqs, providers,
 *                   runtime doctors, Main surface status, daemon health).
 * "daemonHealth" — the cheap daemon health snapshot reused by /api/daemon GET.
 * "opsHealth"    - the expensive daemon operations-health read (claude
 *                   --version, provider readiness, runtime doctors) reused by
 *                   /api/ops/health. Normal Hub refresh polls this every ~2 s
 *                   per tab; coalescing keeps several open tabs from rerunning
 *                   the daemon health evidence on every refresh.
 */
export type HubEvidenceKind = "setupStatus" | "daemonHealth" | "opsHealth";

export interface HubEvidenceEntry<T> {
  value: T;
  /** Cache clock value when the inspection completed. */
  checkedAtMs: number;
  /** ISO-8601 string of the same instant (safe to expose to the Hub UI). */
  checkedAt: string;
}

export interface HubEvidenceCacheOptions {
  ttlMs?: number;
  now?: () => number;
}

/**
 * Bounded in-memory TTL cache for expensive Hub evidence.
 *
 * - One entry per evidence class, never persisted.
 * - Concurrent misses for the same class coalesce into a single underlying
 *   compute() call (the in-flight Promise is shared).
 * - A failed compute() leaves no entry behind; the next caller retries.
 * - Explicit `invalidate()` clears a class; mutations must call it on success
 *   paths only so a failed mutation cannot invent fresh evidence.
 */
export class HubEvidenceCache {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly entries = new Map<HubEvidenceKind, HubEvidenceEntry<unknown>>();
  private readonly generations = new Map<HubEvidenceKind, number>();
  private readonly inFlight = new Map<HubEvidenceKind, {
    generation: number;
    promise: Promise<HubEvidenceEntry<unknown>>;
  }>();

  constructor(options: HubEvidenceCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_HUB_EVIDENCE_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  getTtlMs(): number {
    return this.ttlMs;
  }

  /** Returns the cached entry when fresh, or undefined when stale / absent. */
  peek(kind: HubEvidenceKind): HubEvidenceEntry<unknown> | undefined {
    const entry = this.entries.get(kind);
    if (entry === undefined) return undefined;
    if (this.now() - entry.checkedAtMs >= this.ttlMs) return undefined;
    return entry;
  }

  /**
   * Return the cached entry, or run `compute()` exactly once across all
   * concurrent callers for this evidence class. The returned promise resolves
   * with both the stored value and a bounded freshness envelope.
   */
  async getOrCompute<T>(
    kind: HubEvidenceKind,
    compute: () => Promise<T>,
  ): Promise<HubEvidenceEntry<T>> {
    const fresh = this.peek(kind);
    if (fresh !== undefined) return fresh as HubEvidenceEntry<T>;

    const generation = this.generations.get(kind) ?? 0;
    const existing = this.inFlight.get(kind);
    if (existing !== undefined && existing.generation === generation) {
      return existing.promise as Promise<HubEvidenceEntry<T>>;
    }

    const promise = (async (): Promise<HubEvidenceEntry<T>> => {
      try {
        const value = await compute();
        const ms = this.now();
        const entry: HubEvidenceEntry<T> = {
          value,
          checkedAtMs: ms,
          checkedAt: new Date(ms).toISOString(),
        };
        // A successful mutation may invalidate this evidence while the slow
        // inspection is still running. Never let that older result repopulate
        // the cache after invalidation.
        if ((this.generations.get(kind) ?? 0) === generation) {
          this.entries.set(kind, entry as HubEvidenceEntry<unknown>);
        }
        return entry;
      } finally {
        const active = this.inFlight.get(kind);
        if (active?.generation === generation) this.inFlight.delete(kind);
      }
    })();
    this.inFlight.set(kind, {
      generation,
      promise: promise as Promise<HubEvidenceEntry<unknown>>,
    });
    return promise;
  }

  /** Clear one evidence class so the next read re-runs its inspection. */
  invalidate(kind: HubEvidenceKind): void {
    this.entries.delete(kind);
    this.generations.set(kind, (this.generations.get(kind) ?? 0) + 1);
  }

  /** Clear every cached evidence class (used when a mutation touches many). */
  invalidateAll(): void {
    this.invalidate("setupStatus");
    this.invalidate("daemonHealth");
    this.invalidate("opsHealth");
  }
}

export type DaemonProbeResult = {
  running: boolean;
  health?: Record<string, unknown>;
  error?: string;
};

export type DaemonStopResult = {
  stopped: boolean;
  result?: Record<string, unknown>;
  message: string;
};

export interface HubServerDeps {
  settings: SettingsService;
  setup: SetupService;
  keychain: SetupKeychainStore;
  staticRoot: string;
  /** macOS Keychain account (username). Required so keys write to the same account as setup/doctor. */
  account: () => string;
  port?: number;
  packageRoot?: string;
  ensureDaemon?: () => Promise<Record<string, unknown>>;
  /** Probe without starting (Hub control surface). */
  probeDaemon?: () => Promise<DaemonProbeResult>;
  stopDaemon?: () => Promise<DaemonStopResult>;
  restartDaemon?: () => Promise<Record<string, unknown>>;
  /** Optional daemon RPC for board/tasks (same path Console uses). */
  daemonRequest?: <T = unknown>(
    method: DaemonMethod,
    params?: Record<string, unknown>,
  ) => Promise<T>;
  /**
   * Optional cache for expensive setup/status and daemon-health evidence.
   * Defaults to a single shared cache with a 1.5 s monotonic TTL. Tests can
   * inject one with a custom clock to assert lifetime and coalescing.
   */
  cache?: HubEvidenceCache;
}

/**
 * Safe Task journey projection: expose collaboration facts in evidence order
 * without leaking raw prompts, diffs, logs, credentials, or unbounded text.
 */
export interface SafeTaskJourney {
  assignment: AssignmentSection;
  workerExecution: WorkerExecutionSection;
  independentVerification: VerificationSection;
  finalDelivery: FinalDeliverySection;
  cause: CauseSection;
  nextAction: NextActionSection;
  candidateReuse?: CandidateReuseSection;
  candidateReverification?: CandidateReverificationSection;
}

interface CandidateReverificationSection {
  /** Latest reverification outcome. */
  status: "passed" | "failed";
  /** Retained Attempt id (its original status is preserved). */
  attemptId: string;
  /** Retained Attempt status (unchanged by reverification). */
  attemptStatus: string;
  /** Sequence of the canonical verification.completed event this produced. */
  verificationEventSequence: number;
  allowance: {
    max: number;
    consumed: number;
    remaining: number;
    source: string;
  };
  /** Exact zero-Worker facts. Worker invoked = false, incremental Tokens = 0. */
  workerInvoked: false;
  incrementalWorkerTokens: 0;
  incrementalModelRuntimeCostUsd: 0;
  commandCount: number;
  passedCommandCount: number;
  commandDurationMs: number;
  wallDurationMs: number;
  /** Local verification time is not zero. */
  localVerificationTimeNotZero: true;
  /** Main orchestration exchange is not zero. */
  mainExchangeNotZero: true;
  /** No full-restart saving is claimed without a paired baseline. */
  noFullRestartSavingsClaim: true;
}

interface CandidateReuseSection {
  feedback: string;
  targetAttemptOrdinal: number;
  priorAttemptOrdinal?: number;
  status: "pending" | "running" | "succeeded" | "failed" | "interrupted";
  totalAllowance: number;
  remainingAllowance: number;
  grossTokens?: number;
  runtimeEstimateUsd?: number;
}

interface AssignmentSection {
  contractVersion: 1 | 2;
  /** Exact Main-authored user explanation. It is absent on legacy Tasks and
   * Tasks whose contract did not supply one. */
  presentation?: {
    summary: string;
    language: string;
  };
  /** v2: outcome; v1: goal. */
  outcome?: string;
  /** v2: inScope[0..6] */ inScope?: string[];
  /** v2: outOfScope[0..6] */ outOfScope?: string[];
  /** v2: executionSteps[0..8] */ executionSteps?: string[];
  /** v2: deliverables[0..6] */ deliverables?: string[];
  /** v2: worker.focusPaths[0..10]; v1: absent. */
  focusPaths?: string[];
  /** v2: acceptance.criteria[0..8]; v1: absent. */
  acceptanceCriteria?: string[];
  /** acceptance.commands[0..8] */ acceptanceCommands?: string[];
  /** v1: constraints[0..6]; v2: absent. */
  constraints?: string[];
  /** v1: goal (same as outcome for v1); v2: absent. */
  goal?: string;
}

interface WorkerExecutionSection {
  provider: string;
  model: string;
  runtime: string;
  /** Bounded Attempt summaries (max 5, latest first). */
  attempts: Array<{
    ordinal: number;
    status: string;
    startedAt?: string;
    finishedAt?: string;
    exitCode?: number;
    turns?: number;
    costUsd?: number;
  }>;
  /** Latest Worker completion claim, explicitly labelled as unverified. */
  workerClaim?: {
    label: "unverified-claim";
    /** Bounded preview text (max 360 chars). */
    text: string;
  };
  /** Changed relative file paths (max 40), from verification source compatibility. */
  changedFilePaths: string[];
}

interface VerificationSection {
  /** false when verification has not yet run. */
  available: boolean;
  /** Named checks with pass/fail/exit evidence, max 12. */
  checks: Array<{
    label: string;
    passed: boolean;
    exitCode?: number;
  }>;
  /** Locale-neutral conclusion code; the browser owns readable copy. */
  conclusion: "not-run" | "passed" | "failed";
  failedCount: number;
  totalCount: number;
}

interface FinalDeliverySection {
  /** Main review disposition when recorded. */
  mainReview?: {
    decision: string;
    reason: string;
  };
  /** Verified-repaired-delivered evidence when present (compact shape only). */
  remediationDisposition?: {
    status: string;
  };
  /** Integration operation state when available. */
  integration?: {
    status: string;
    applied: boolean;
  };
}

interface CauseSection {
  /** Machine state (succeeded / queued / active / failed / interrupted) as plain label. */
  what: string;
  /** Evidence-backed reason, never duplicates the what sentence. */
  why: string;
  /** Failure category in non-technical terms when applicable. */
  failureCategory?: string;
}

interface NextActionSection {
  /** Bounded 1-sentence guidance for the user. */
  label: string;
}

/**
 * Build a bounded, privacy-safe journey projection from the raw task and
 * decision records. No raw prompt, diff, log, credential, or unbounded text
 * is ever exposed. Every array is capped to a reasonable length.
 */
export function buildSafeTaskJourney(
  rawTask: Record<string, unknown>,
  rawDecision: unknown,
  rawInspect: unknown = {},
): SafeTaskJourney {
  const spec = (rawTask.spec ?? {}) as Record<string, unknown>;
  const contractVer = typeof spec.version === "number" ? spec.version : 1;
  const isV2 = contractVer === 2;
  const contract = (isV2 ? spec.contract : undefined) as Record<string, unknown> | undefined;
  const worker = (spec.worker ?? {}) as Record<string, unknown>;
  const acceptance = (spec.acceptance ?? {}) as Record<string, unknown>;

  // --- Assignment ---
  const rawPresentation = isV2 && contract?.presentation !== null
    && typeof contract?.presentation === "object"
    && !Array.isArray(contract.presentation)
    ? contract.presentation as Record<string, unknown>
    : undefined;
  const presentation = rawPresentation !== undefined
    && typeof rawPresentation.summary === "string"
    && typeof rawPresentation.language === "string"
    ? {
        summary: truncate(rawPresentation.summary, 300),
        language: truncate(rawPresentation.language, 35),
      }
    : undefined;
  const outcome = isV2
    ? typeof contract?.outcome === "string" ? truncate(contract.outcome, 600) : undefined
    : typeof (spec as Record<string, unknown>).goal === "string"
      ? truncate((spec as Record<string, unknown>).goal as string, 600) : undefined;
  const goal = isV2 ? undefined
    : typeof (spec as Record<string, unknown>).goal === "string"
      ? truncate((spec as Record<string, unknown>).goal as string, 600) : undefined;
  const inScope = isV2 && Array.isArray(contract?.inScope)
    ? contract.inScope.slice(0, 6).map((s: unknown) => truncate(String(s ?? ""), 200)) : undefined;
  const outOfScope = isV2 && Array.isArray(contract?.outOfScope)
    ? contract.outOfScope.slice(0, 6).map((s: unknown) => truncate(String(s ?? ""), 200)) : undefined;
  const executionSteps = isV2 && Array.isArray(contract?.executionSteps)
    ? contract.executionSteps.slice(0, 8).map((s: unknown) => truncate(String(s ?? ""), 200)) : undefined;
  const deliverables = isV2 && Array.isArray(contract?.deliverables)
    ? contract.deliverables.slice(0, 6).map((s: unknown) => truncate(String(s ?? ""), 200)) : undefined;
  const focusPaths = isV2
    ? (Array.isArray(worker.focusPaths) ? worker.focusPaths.slice(0, 10).map((p: unknown) => truncate(String(p ?? ""), 300)) : undefined)
    : undefined;
  const acceptanceCriteria = isV2 && Array.isArray(acceptance.criteria)
    ? (acceptance.criteria as unknown[]).slice(0, 8).map((s: unknown) => truncate(String(s ?? ""), 200)) : undefined;
  const acceptanceCommands = Array.isArray(acceptance.commands)
    ? (acceptance.commands as unknown[]).slice(0, 8).map((s: unknown) => safeCommandLabel(String(s ?? ""))) : undefined;
  const constraints = !isV2 && Array.isArray((spec as Record<string, unknown>).constraints)
    ? ((spec as Record<string, unknown>).constraints as unknown[]).slice(0, 6).map((s: unknown) => truncate(String(s ?? ""), 200)) : undefined;

  const assignment: AssignmentSection = {
    contractVersion: contractVer as 1 | 2,
    ...(presentation === undefined ? {} : { presentation }),
    ...(outcome === undefined ? {} : { outcome }),
    ...(inScope === undefined ? {} : { inScope }),
    ...(outOfScope === undefined ? {} : { outOfScope }),
    ...(executionSteps === undefined ? {} : { executionSteps }),
    ...(deliverables === undefined ? {} : { deliverables }),
    ...(focusPaths === undefined ? {} : { focusPaths }),
    ...(acceptanceCriteria === undefined ? {} : { acceptanceCriteria }),
    ...(acceptanceCommands === undefined ? {} : { acceptanceCommands }),
    ...(constraints === undefined ? {} : { constraints }),
    ...(goal === undefined ? {} : { goal }),
  };

  // --- Worker Execution ---
  const d = (rawDecision ?? {}) as Record<string, unknown>;
  const claim = d.workerClaim as Record<string, unknown> | undefined;
  const workerClaim = claim?.label === "unverified-claim" && typeof claim.text === "string"
    ? { label: "unverified-claim" as const, text: readablePreview(claim.text, 1200) }
    : undefined;

  const inspect = (rawInspect ?? {}) as Record<string, unknown>;
  const inspectAttempts = Array.isArray(inspect.attempts)
    ? inspect.attempts as Array<Record<string, unknown>>
    : [];

  // Prefer the actual isolated-workspace diff. Fall back to verification
  // source-compatibility evidence for older daemon payloads.
  const verification = d.verification as Record<string, unknown> | undefined;
  const sourceCompat = verification?.sourceCompatibility as Record<string, unknown> | undefined;
  const affectedPaths: unknown[] = Array.isArray(sourceCompat?.affectedPaths)
    ? sourceCompat.affectedPaths as unknown[] : [];
  const diff = typeof inspect.diff === "string" ? inspect.diff : "";
  const diffPaths = diff.length > 0 ? parseAffectedPathsFromWorkspaceDiff(diff) : [];
  const changedFilePaths = (diffPaths.length > 0 ? diffPaths : affectedPaths.map(String))
    .filter(safeRelativePath)
    .slice(0, 40);

  const attempts = buildBoundedAttempts(inspectAttempts);

  // Latest explicit Main correction: this is the bounded Main -> Worker input
  // and its factual incremental outcome. It never estimates a hypothetical
  // from-scratch retry or claims unmeasured savings.
  const inspectEvents = Array.isArray(inspect.events)
    ? inspect.events as Array<Record<string, unknown>>
    : [];
  const correctionGrants = inspectEvents.filter((event) => {
    if (event.type !== "attempt.authorization.granted") return false;
    const payload = event.payload;
    return payload !== null && typeof payload === "object"
      && (payload as Record<string, unknown>).kind === "correction";
  });
  const latestCorrection = correctionGrants.at(-1);
  let candidateReuse: CandidateReuseSection | undefined;
  if (latestCorrection !== undefined) {
    const payload = latestCorrection.payload as Record<string, unknown>;
    const targetOrdinal = typeof payload.targetOrdinal === "number" ? payload.targetOrdinal : 0;
    const targetAttempt = inspectAttempts.find((attempt) => attempt.ordinal === targetOrdinal);
    const priorAttempt = typeof payload.priorAttemptId === "string"
      ? inspectAttempts.find((attempt) => attempt.id === payload.priorAttemptId)
      : undefined;
    const policy = (rawTask.effectivePolicy ?? {}) as Record<string, unknown>;
    const values = (policy.values ?? {}) as Record<string, unknown>;
    const totalAllowance = typeof values.maxMainCorrections === "number"
      ? values.maxMainCorrections
      : 1;
    const usage = targetAttempt?.usage as Record<string, unknown> | undefined;
    const grossTokens = usage === undefined
      ? undefined
      : ["inputTokens", "outputTokens", "cacheReadInputTokens", "cacheCreationInputTokens"]
          .map((field) => typeof usage[field] === "number" ? usage[field] as number : 0)
          .reduce((sum, value) => sum + value, 0);
    const rawStatus = typeof targetAttempt?.status === "string" ? targetAttempt.status : "pending";
    const status: CandidateReuseSection["status"] =
      rawStatus === "running" || rawStatus === "succeeded" || rawStatus === "failed"
        || rawStatus === "interrupted"
        ? rawStatus
        : "pending";
    candidateReuse = {
      feedback: truncate(String(payload.feedback ?? ""), 1000),
      targetAttemptOrdinal: targetOrdinal,
      ...(typeof priorAttempt?.ordinal === "number" ? { priorAttemptOrdinal: priorAttempt.ordinal } : {}),
      status,
      totalAllowance,
      remainingAllowance: Math.max(0, totalAllowance - correctionGrants.length),
      ...(grossTokens === undefined ? {} : { grossTokens }),
      ...(typeof targetAttempt?.runtimeCostEstimateUsd === "number"
        ? { runtimeEstimateUsd: targetAttempt.runtimeCostEstimateUsd }
        : {}),
    };
  }

  const workerExecution: WorkerExecutionSection = {
    provider: truncate(String((spec.provider as Record<string, unknown>)?.name ?? ""), 40),
    model: truncate(String((spec.provider as Record<string, unknown>)?.model ?? ""), 80),
    runtime: truncate(String((spec.runtime as Record<string, unknown>)?.name ?? ""), 40),
    attempts,
    ...(workerClaim === undefined ? {} : { workerClaim }),
    changedFilePaths,
  };

  // Latest candidate reverification (verification-only, no Worker). Projected
  // from durable events - never recomputes eligibility or echoes private
  // reason/command output. The original Attempt is preserved (never rewritten),
  // so this section is intentionally separate from candidateReuse.
  const reverificationEvents = inspectEvents.filter((event) =>
    event.type === "candidate.reverification.completed",
  );
  const latestReverification = reverificationEvents.at(-1);
  let candidateReverification: CandidateReverificationSection | undefined;
  if (latestReverification !== undefined) {
    const rv = (latestReverification.payload ?? {}) as Record<string, unknown>;
    const allowance = (rv.allowance ?? {}) as Record<string, unknown>;
    const nonnegativeInteger = (value: unknown): value is number =>
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    const status = rv.status === "passed" || rv.status === "failed" ? rv.status : undefined;
    const attemptId = typeof rv.attemptId === "string" && rv.attemptId.length > 0
      ? rv.attemptId
      : undefined;
    const attemptStatus = rv.attemptStatus === "succeeded" || rv.attemptStatus === "failed"
      ? rv.attemptStatus
      : undefined;
    const verificationEventSequence = nonnegativeInteger(rv.verificationEventSequence)
      && rv.verificationEventSequence > 0 ? rv.verificationEventSequence : undefined;
    const allowanceMax = nonnegativeInteger(allowance.max) ? allowance.max : undefined;
    const allowanceConsumed = nonnegativeInteger(allowance.consumed) ? allowance.consumed : undefined;
    const allowanceRemaining = nonnegativeInteger(allowance.remaining) ? allowance.remaining : undefined;
    const allowanceSource = allowance.source === "task" || allowance.source === "worker" || allowance.source === "global"
      ? allowance.source
      : undefined;
    const validAllowance = allowanceMax !== undefined
      && allowanceConsumed !== undefined
      && allowanceRemaining !== undefined
      && allowanceConsumed <= allowanceMax
      && allowanceRemaining === Math.max(0, allowanceMax - allowanceConsumed)
      && allowanceSource !== undefined;
    const commandCount = nonnegativeInteger(rv.commandCount) ? rv.commandCount : undefined;
    const passedCommandCount = nonnegativeInteger(rv.passedCommandCount) ? rv.passedCommandCount : undefined;
    const commandDurationMs = nonnegativeInteger(rv.commandDurationMs) ? rv.commandDurationMs : undefined;
    const wallDurationMs = nonnegativeInteger(rv.wallDurationMs) ? rv.wallDurationMs : undefined;
    const validCounts = commandCount !== undefined
      && passedCommandCount !== undefined
      && passedCommandCount <= commandCount
      && commandDurationMs !== undefined
      && wallDurationMs !== undefined;
    const validExactFacts = rv.workerInvoked === false
      && rv.incrementalWorkerTokens === 0
      && rv.incrementalModelRuntimeCostUsd === 0
      && rv.requiresFreshMainAccept === true;
    if (
      status !== undefined && attemptId !== undefined && attemptStatus !== undefined
      && verificationEventSequence !== undefined
      && validAllowance && validCounts && validExactFacts
    ) {
      candidateReverification = {
        status,
        attemptId,
        attemptStatus,
        verificationEventSequence,
        allowance: {
          max: allowanceMax,
          consumed: allowanceConsumed,
          remaining: allowanceRemaining,
          source: allowanceSource,
        },
        workerInvoked: false,
        incrementalWorkerTokens: 0,
        incrementalModelRuntimeCostUsd: 0,
        commandCount,
        passedCommandCount,
        commandDurationMs,
        wallDurationMs,
        localVerificationTimeNotZero: true,
        mainExchangeNotZero: true,
        noFullRestartSavingsClaim: true,
      };
    }
  }

  // --- Independent Verification ---
  const verifAvail = verification !== undefined;
  const verifPassed = typeof verification?.passed === "boolean" ? verification.passed : false;
  const verifChecks: VerificationSection["checks"] = [];
  if (verifAvail) {
    // Build named checks from verification commands (max 12).
    const cmds: unknown[] = Array.isArray(verification?.commands) ? verification.commands as unknown[] : [];
    cmds.slice(0, 12).forEach((c) => {
      const cmd = c as Record<string, unknown>;
      const label = typeof cmd.command === "string" ? safeCommandLabel(cmd.command) : "check";
      const exitCode = typeof cmd.exitCode === "number" ? cmd.exitCode : undefined;
      verifChecks.push({
        label: label || "check",
        passed: cmd.exitCode === 0,
        ...(exitCode === undefined ? {} : { exitCode }),
      });
    });
    // Add behavior/policy/source checks if no commands exist.
    if (verifChecks.length === 0) {
      if (typeof verification?.behaviorPassed === "boolean") {
        verifChecks.push({ label: "behavior", passed: verification.behaviorPassed as boolean });
      }
      if (typeof verification?.policyPassed === "boolean") {
        verifChecks.push({ label: "policy", passed: verification.policyPassed as boolean });
      }
      if (typeof verification?.sourceCompatible === "boolean") {
        verifChecks.push({ label: "source-compatible", passed: verification.sourceCompatible as boolean });
      }
    }
  }

  const failedCount = verifChecks.filter((c) => !c.passed).length;
  const conclusion: VerificationSection["conclusion"] = !verifAvail
    ? "not-run"
    : verifPassed ? "passed" : "failed";

  const independentVerification: VerificationSection = {
    available: verifAvail,
    checks: verifChecks,
    conclusion,
    failedCount,
    totalCount: verifChecks.length,
  };

  // --- Final Delivery ---
  const review = d.mainReview as Record<string, unknown> | undefined;
  const mainReview = review?.decision !== undefined
    ? {
        decision: truncate(String(review.decision), 20),
        reason: truncate(String(review.reason ?? ""), 400),
      }
    : undefined;

  const disp = d.remediationDisposition as Record<string, unknown> | undefined;
  const remediationDisposition = disp?.status === "verified-repaired-delivered"
    ? { status: "verified-repaired-delivered" as const }
    : undefined;

  const integ = d.integration as Record<string, unknown> | undefined;
  const integration = integ !== undefined
    ? {
        status: truncate(String(integ.status ?? "unknown"), 30),
        applied: integ.status === "completed",
      }
    : undefined;

  const finalDelivery: FinalDeliverySection = {
    ...(mainReview === undefined ? {} : { mainReview }),
    ...(remediationDisposition === undefined ? {} : { remediationDisposition }),
    ...(integration === undefined ? {} : { integration }),
  };

  // --- Cause (what happened + why, always separate) ---
  const taskStatus = String(rawTask.status ?? "unknown");
  const failureCategory = typeof d.failureCategory === "string" ? d.failureCategory : undefined;
  const { what, why, category } = resolveCause(taskStatus, failureCategory, verifAvail, verifPassed);

  const cause: CauseSection = {
    what,
    why,
    ...(category === undefined ? {} : { failureCategory: category }),
  };

  // --- Next Action ---
  const nextLabel = resolveNextAction(
    taskStatus,
    failureCategory,
    verifAvail,
    verifPassed,
    mainReview,
    remediationDisposition,
    integration,
  );

  const nextAction: NextActionSection = {
    label: nextLabel,
  };

  return {
    assignment,
    workerExecution,
    independentVerification,
    finalDelivery,
    cause,
    nextAction,
    ...(candidateReuse === undefined ? {} : { candidateReuse }),
    ...(candidateReverification === undefined ? {} : { candidateReverification }),
  };
}

export interface SafeCalibrationIdentity {
  taskClass: string;
  directCodexProfileId: string;
}

export interface SafeCalibrationSample {
  sampleId: string;
  capturedAt: string;
  grossTokens: number;
  reviewState: "pending" | "accepted" | "rejected";
}

export interface SafeCalibrationPublicationPreview {
  ready: boolean;
  reason: "ready" | "no-accepted-samples" | "no-new-evidence" | "unsafe-version";
  pendingCount: number;
  acceptedCount: number;
  rejectedCount: number;
  nextVersion: number | null;
  acceptedSampleIds: string[];
}

export type SafeCalibrationState =
  | { state: "identity-missing" }
  | {
      state: "ready";
      identity: SafeCalibrationIdentity;
      samples: SafeCalibrationSample[];
      publicationPreview: SafeCalibrationPublicationPreview;
    };

function exactOwnKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}

function calibrationIdentity(task: Record<string, unknown>): SafeCalibrationIdentity | undefined {
  const spec = task.spec;
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) return undefined;
  const record = spec as Record<string, unknown>;
  if (typeof record.taskClass !== "string" || record.taskClass.length === 0) return undefined;
  if (typeof record.directCodexProfileId !== "string" || record.directCodexProfileId.length === 0) {
    return undefined;
  }
  return {
    taskClass: record.taskClass,
    directCodexProfileId: record.directCodexProfileId,
  };
}

function safeCalibrationState(
  identity: SafeCalibrationIdentity,
  inbox: unknown,
  preview: unknown,
): SafeCalibrationState {
  if (!Array.isArray(inbox) || preview === null || typeof preview !== "object" || Array.isArray(preview)) {
    throw new Error("Invalid calibration evidence from daemon");
  }

  const samples: SafeCalibrationSample[] = inbox.slice(0, 50).map((unknownItem) => {
    if (unknownItem === null || typeof unknownItem !== "object" || Array.isArray(unknownItem)) {
      throw new Error("Invalid calibration evidence from daemon");
    }
    const item = unknownItem as Record<string, unknown>;
    const sample = item.sample;
    if (sample === null || typeof sample !== "object" || Array.isArray(sample)) {
      throw new Error("Invalid calibration evidence from daemon");
    }
    const sampleRecord = sample as Record<string, unknown>;
    if (typeof sampleRecord.sampleId !== "string" || typeof sampleRecord.capturedAt !== "string") {
      throw new Error("Invalid calibration evidence from daemon");
    }
    if (item.reviewState !== "pending" && item.reviewState !== "accepted" && item.reviewState !== "rejected") {
      throw new Error("Invalid calibration evidence from daemon");
    }
    return {
      sampleId: sampleRecord.sampleId,
      capturedAt: sampleRecord.capturedAt,
      grossTokens: grossDirectCodexTokens(sampleRecord),
      reviewState: item.reviewState,
    };
  });

  const publication = preview as Record<string, unknown>;
  const readiness = publication.readiness;
  if (
    readiness !== "ready"
    && readiness !== "no-accepted-samples"
    && readiness !== "no-new-evidence"
    && readiness !== "unsafe-version"
  ) {
    throw new Error("Invalid calibration evidence from daemon");
  }
  const count = (key: "pendingCount" | "acceptedCount" | "rejectedCount"): number => {
    const value = publication[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      throw new Error("Invalid calibration evidence from daemon");
    }
    return value;
  };
  const nextVersion = publication.nextVersion;
  if (nextVersion !== null
    && (typeof nextVersion !== "number" || !Number.isSafeInteger(nextVersion) || nextVersion < 1)) {
    throw new Error("Invalid calibration evidence from daemon");
  }
  if (!Array.isArray(publication.acceptedSampleIds)
    || publication.acceptedSampleIds.some((sampleId) => typeof sampleId !== "string")) {
    throw new Error("Invalid calibration evidence from daemon");
  }

  return {
    state: "ready",
    identity,
    samples,
    publicationPreview: {
      ready: readiness === "ready",
      reason: readiness,
      pendingCount: count("pendingCount"),
      acceptedCount: count("acceptedCount"),
      rejectedCount: count("rejectedCount"),
      nextVersion,
      acceptedSampleIds: publication.acceptedSampleIds.slice(0, 50) as string[],
    },
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

function readablePreview(value: string, max: number): string {
  const normalized = value
    .replace(/\0/g, "")
    .replace(/([\-=*_#])\1{15,}/g, "$1$1$1...")
    .trim();
  return truncate(normalized, max);
}

function safeCommandLabel(command: string): string {
  const redacted = command
    .replace(
      /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)=(?:"[^"]*"|'[^']*'|\S+)/gi,
      "$1=[redacted]",
    )
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|(?:secret|token|password|api[_-]?key)[_:=\-]?[A-Za-z0-9_-]{4,})\b/gi, "[redacted]")
    .replace(/(^|[\s/])\.env(?:\.[A-Za-z0-9_-]+)?\b/g, "$1[hidden-config]");
  return readablePreview(redacted, 220);
}

function safeRelativePath(value: string): boolean {
  if (value.length === 0 || path.isAbsolute(value)) return false;
  const normalized = value.replace(/\\/g, "/");
  return !normalized.split("/").includes("..");
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" ? record[key] as string : undefined;
}

function buildBoundedAttempts(
  records: Array<Record<string, unknown>>,
): WorkerExecutionSection["attempts"] {
  return records
    .slice(-5)
    .reverse()
    .map((attempt) => {
      const startedAt = optionalString(attempt, "startedAt");
      const finishedAt = optionalString(attempt, "finishedAt");
      return {
        ordinal: Number.isSafeInteger(attempt.ordinal) ? attempt.ordinal as number : 0,
        status: truncate(String(attempt.status ?? "unknown"), 24),
        ...(startedAt === undefined ? {} : { startedAt }),
        ...(finishedAt === undefined ? {} : { finishedAt }),
        ...(Number.isSafeInteger(attempt.exitCode) ? { exitCode: attempt.exitCode as number } : {}),
        ...(Number.isSafeInteger(attempt.turns) ? { turns: attempt.turns as number } : {}),
        ...(typeof attempt.costUsd === "number" && Number.isFinite(attempt.costUsd)
          ? { costUsd: attempt.costUsd } : {}),
      };
    });
}

function resolveCause(
  status: string,
  failureCategory: string | undefined,
  verifAvail: boolean,
  verifPassed: boolean,
): { what: string; why: string; category?: string } {
  if (status === "succeeded") {
    return {
      what: "succeeded",
      why: "independent verification passed and the delivery is ready for review",
    };
  }
  if (status === "running" || status === "preparing" || status === "verifying" || status === "active") {
    return {
      what: "running",
      why: "the Worker is still executing the assignment",
    };
  }
  if (status === "queued" || status === "pending" || status === "waiting") {
    return {
      what: "queued",
      why: "waiting for a Worker slot or prerequisite to become available",
    };
  }
  // Failed / interrupted
  if (failureCategory === "authentication") {
    return {
      what: "failed",
      why: "the Provider rejected the API credentials — the Worker could not start useful model work",
      category: "authentication",
    };
  }
  if (failureCategory === "budget") {
    return {
      what: "failed",
      why: "the runtime exceeded its Token or budget cap before completing",
      category: "budget",
    };
  }
  if (failureCategory === "runtime") {
    return {
      what: "failed",
      why: "the coding runtime crashed or exited with an error",
      category: "runtime",
    };
  }
  if (failureCategory === "contract-infeasible") {
    return {
      what: "failed",
      why: "the Task Contract cannot be satisfied under the current boundary; Main must revise scope, dependencies, or acceptance before another attempt",
      category: "contract-infeasible",
    };
  }
  if (verifAvail && !verifPassed) {
    return {
      what: "failed",
      why: "independent verification found the delivered result did not pass acceptance checks",
      category: "verification",
    };
  }
  return {
    what: "failed",
    why: "the cause could not be classified from available evidence",
    category: "unknown",
  };
}

function resolveNextAction(
  status: string,
  failureCategory: string | undefined,
  verifAvail: boolean,
  verifPassed: boolean,
  mainReview: { decision: string } | undefined,
  remediationDisposition: { status: "verified-repaired-delivered" } | undefined,
  integration: { applied: boolean } | undefined,
): string {
  if (remediationDisposition?.status === "verified-repaired-delivered") return "done";
  if (integration?.applied) return "done";
  if (mainReview?.decision === "accept") return "ready-to-integrate";
  if (mainReview?.decision === "revise") return "revise";
  if (mainReview?.decision === "reject") return "stopped";
  if (status === "succeeded" || (verifAvail && verifPassed)) return "review";
  if (status === "running" || status === "preparing" || status === "verifying" || status === "active") return "wait";
  if (status === "queued" || status === "pending" || status === "waiting") return "wait";
  if (failureCategory === "authentication") return "credentials";
  if (failureCategory === "budget") return "budget";
  if (failureCategory === "runtime") return "runtime";
  // Contract-infeasible: return control to Main to revise the contract, not retry.
  if (failureCategory === "contract-infeasible") return "revise-contract";
  return "investigate";
}

export class HubServer {
  private server: ReturnType<typeof createServer> | undefined;
  private actualPort = 0;
  private readonly token: string;
  private readonly cache: HubEvidenceCache;

  constructor(private readonly deps: HubServerDeps) {
    this.token = randomBytes(32).toString("base64url");
    this.cache = deps.cache ?? new HubEvidenceCache();
  }

  /** Test seam: the Hub's bounded evidence cache. */
  getCache(): HubEvidenceCache {
    return this.cache;
  }

  getToken(): string {
    return this.token;
  }

  getPort(): number {
    return this.actualPort;
  }

  isRunning(): boolean {
    return this.server !== undefined;
  }

  async start(): Promise<number> {
    if (this.server) return this.actualPort;
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        void this.handle(req, res);
      });
      this.server.once("error", reject);
      this.server.listen(this.deps.port ?? 0, LOOPBACK, () => {
        const addr = this.server!.address();
        this.actualPort = typeof addr === "object" && addr !== null ? addr.port : 0;
        resolve(this.actualPort);
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    this.actualPort = 0;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeIdleConnections();
    });
  }

  private authenticate(req: IncomingMessage): boolean {
    const header = req.headers[TOKEN_HEADER];
    if (typeof header !== "string") return false;
    if (header.length !== this.token.length) return false;
    return timingSafeEqual(Buffer.from(header), Buffer.from(this.token));
  }

  private sendJson(
    req: IncomingMessage,
    res: ServerResponse,
    status: number,
    body: unknown,
  ): void {
    const payload = safeJson(body);
    res.writeHead(status, {
      ...SECURITY_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(payload),
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(payload);
  }

  private readBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
      let size = 0;
      const chunks: Buffer[] = [];
      let tooLarge = false;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          tooLarge = true;
          chunks.length = 0;
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (tooLarge) {
          resolve(null);
          return;
        }
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            resolve(null);
            return;
          }
          resolve(parsed as Record<string, unknown>);
        } catch {
          resolve(null);
        }
      });
      req.on("error", () => resolve(null));
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = req.url ?? "/";
    if (/\.\./.test(raw) || raw.includes("\0")) {
      this.sendJson(req, res, 400, { error: "Invalid path" });
      return;
    }
    const route = (() => {
      try {
        return new URL(raw, `http://${LOOPBACK}`).pathname;
      } catch {
        return raw.split("?")[0] ?? "/";
      }
    })();

    if (route.startsWith("/api/")) {
      if (!this.authenticate(req)) {
        this.sendJson(req, res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        await this.handleApi(req, res, route);
      } catch (error) {
        this.sendJson(req, res, 500, {
          error: error instanceof Error ? error.message : "Internal error",
        });
      }
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      this.sendJson(req, res, 405, { error: "Method not allowed" });
      return;
    }
    await this.serveStatic(req, res, route);
  }

  private async handleApi(
    req: IncomingMessage,
    res: ServerResponse,
    route: string,
  ): Promise<void> {
    if (route === "/api/status" && (req.method === "GET" || req.method === "HEAD")) {
      // Expensive evidence (which/--version subprocesses, Main MCP file reads,
      // daemon probe) — share one inspection across concurrent Hub tabs.
      const entry = await this.cache.getOrCompute("setupStatus", async () => {
        const settings = this.deps.settings.get();
        const prereqs = this.deps.setup.inspectPrerequisites();
        const providers = this.deps.setup.describeProviders();
        const runtimes: Record<string, unknown> = {};
        for (const adapter of listWorkerAdapters()) {
          const doctor = adapter.doctor();
          if (doctor instanceof Promise) continue;
          runtimes[adapter.name] = {
            ok: doctor.ok,
            displayName: adapter.displayName,
            issues: doctor.issues,
            capabilities: doctor.capabilities,
          };
        }
        // Probe only — do not auto-start here so Hub stop control stays sticky.
        const daemon = await this.probeDaemonStatus();
        const mains = await listMainSurfaceStatus(
          undefined,
          this.deps.packageRoot,
        );
        const versionJourney = this.buildVersionJourney(daemon);
        return {
          settings: viewHubSettings(settings),
          modelCatalog: settings.modelCatalog,
          workerProfiles: settings.workerProfiles,
          modelRouting: viewModelRoutingSettings(settings),
          prerequisites: prereqs,
          providers,
          runtimes,
          mains,
          daemon,
          versionJourney,
        };
      });
      this.sendJson(req, res, 200, {
        ...entry.value,
        checkedAt: entry.checkedAt,
      });
      return;
    }

    // Daemon lifecycle control: start | stop | restart | status
    if (route === "/api/daemon" && (req.method === "GET" || req.method === "HEAD")) {
      const entry = await this.cache.getOrCompute(
        "daemonHealth",
        () => this.probeDaemonStatus(),
      );
      this.sendJson(req, res, 200, {
        ...entry.value,
        checkedAt: entry.checkedAt,
      });
      return;
    }
    if (route === "/api/daemon" && req.method === "POST") {
      const body = await this.readBody(req);
      if (!body) {
        this.sendJson(req, res, 400, { error: "Invalid body" });
        return;
      }
      const action = typeof body.action === "string" ? body.action : "";
      try {
        if (action === "status") {
          // User-requested status refresh must bypass any cached evidence.
          this.cache.invalidateAll();
          const entry = await this.cache.getOrCompute(
            "daemonHealth",
            () => this.probeDaemonStatus(),
          );
          this.sendJson(req, res, 200, {
            ...entry.value,
            checkedAt: entry.checkedAt,
          });
          return;
        }
        if (action === "start") {
          if (!this.deps.ensureDaemon) {
            this.sendJson(req, res, 503, { error: "Daemon start not available in this Hub" });
            return;
          }
          const health = await this.deps.ensureDaemon();
          // Successful lifecycle mutation — every cached snapshot (setup,
          // daemon probe, operations health) reflects the new daemon state on
          // the next read.
          this.cache.invalidateAll();
          this.sendJson(req, res, 200, {
            ok: true,
            action: "start",
            running: true,
            health,
            message: "Daemon started (or already running)",
          });
          return;
        }
        if (action === "stop") {
          if (!this.deps.stopDaemon) {
            this.sendJson(req, res, 503, { error: "Daemon stop not available in this Hub" });
            return;
          }
          const result = await this.deps.stopDaemon();
          this.cache.invalidateAll();
          this.sendJson(req, res, 200, {
            ok: true,
            action: "stop",
            running: false,
            ...result,
          });
          return;
        }
        if (action === "restart") {
          if (this.deps.restartDaemon) {
            const health = await this.deps.restartDaemon();
            this.cache.invalidateAll();
            this.sendJson(req, res, 200, {
              ok: true,
              action: "restart",
              running: true,
              health,
              message: "Daemon restarted",
            });
            return;
          }
          // Fallback: stop then ensure
          if (this.deps.stopDaemon && this.deps.ensureDaemon) {
            await this.deps.stopDaemon();
            const health = await this.deps.ensureDaemon();
            this.cache.invalidateAll();
            this.sendJson(req, res, 200, {
              ok: true,
              action: "restart",
              running: true,
              health,
              message: "Daemon restarted",
            });
            return;
          }
          this.sendJson(req, res, 503, { error: "Daemon restart not available in this Hub" });
          return;
        }
        this.sendJson(req, res, 422, {
          error: "action must be status|start|stop|restart",
        });
      } catch (error) {
        this.sendJson(req, res, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (route === "/api/settings" && req.method === "POST") {
      const body = await this.readBody(req);
      if (!body) {
        this.sendJson(req, res, 400, { error: "Invalid body" });
        return;
      }
      try {
        const patch = buildHubSettingsPatch(
          this.deps.settings.get(),
          body as HubSettingsPatch,
        );
        const updated = this.deps.settings.update(patch);
        // Settings change invalidates the cached setup snapshot so the next
        // /api/status reflects the new default provider/runtime/budget.
        this.cache.invalidate("setupStatus");
        this.cache.invalidate("opsHealth");
        this.sendJson(req, res, 200, { ok: true, settings: viewHubSettings(updated) });
      } catch (error) {
        this.sendJson(req, res, 422, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (route === "/api/provider-key" && req.method === "POST") {
      const body = await this.readBody(req);
      if (!body) {
        this.sendJson(req, res, 400, { error: "Invalid body" });
        return;
      }
      const provider = typeof body.provider === "string" ? body.provider : "";
      const apiKey = typeof body.apiKey === "string" ? body.apiKey : "";
      if (!isProviderName(provider)) {
        this.sendJson(req, res, 422, { error: "Unsupported provider" });
        return;
      }
      if (apiKey.length < 8 || apiKey.length > 4096 || /[\0\r\n]/.test(apiKey)) {
        this.sendJson(req, res, 422, { error: "Invalid API key" });
        return;
      }
      const settings = this.deps.settings.get();
      const definition = providerDefinition(provider, settings.providerDefaults);
      const account = this.deps.account();
      this.deps.keychain.write(definition.defaultKeychainService, account, apiKey);
      // Keychain change affects describeProviders() — invalidate setup snapshot.
      this.cache.invalidate("setupStatus");
      this.cache.invalidate("opsHealth");
      this.sendJson(req, res, 200, {
        ok: true,
        provider,
        keychainService: definition.defaultKeychainService,
        configured: true,
      });
      return;
    }

    if (route === "/api/mains/install" && req.method === "POST") {
      const body = await this.readBody(req);
      if (!body || typeof body.client !== "string") {
        this.sendJson(req, res, 400, { error: "client is required" });
        return;
      }
      const client = body.client as MainClientId;
      if (client !== "codex" && client !== "claude-code" && client !== "grok-build") {
        this.sendJson(req, res, 422, { error: "Unsupported client" });
        return;
      }
      // component: plugin | mcp | skill | all (default all)
      // Legacy: mcpOnly=true → mcp only
      let component: MainInstallComponent = "all";
      if (body.mcpOnly === true) component = "mcp";
      else if (typeof body.component === "string") {
        if (body.component !== "plugin" && body.component !== "mcp"
          && body.component !== "skill" && body.component !== "all") {
          this.sendJson(req, res, 422, { error: "component must be plugin|mcp|skill|all" });
          return;
        }
        component = body.component;
      }
      const result = await installMainComponent(client, component, {
        ...(this.deps.packageRoot === undefined
          ? {}
          : { packageRoot: this.deps.packageRoot }),
      });
      const ok = "ok" in result ? result.ok : true;
      // Only invalidate when install actually succeeded; a failed install must
      // not invent a fresh "installed" snapshot.
      if (ok) {
        this.cache.invalidate("setupStatus");
        this.cache.invalidate("opsHealth");
      }
      this.sendJson(req, res, ok ? 200 : 422, result);
      return;
    }

    if (route === "/api/mains/uninstall" && req.method === "POST") {
      const body = await this.readBody(req);
      if (!body || typeof body.client !== "string") {
        this.sendJson(req, res, 400, { error: "client is required" });
        return;
      }
      const client = body.client as MainClientId;
      if (client !== "codex" && client !== "claude-code" && client !== "grok-build") {
        this.sendJson(req, res, 422, { error: "Unsupported client" });
        return;
      }
      let component: MainInstallComponent = "all";
      if (body.mcpOnly === true) component = "mcp";
      else if (typeof body.component === "string") {
        if (body.component !== "plugin" && body.component !== "mcp"
          && body.component !== "skill" && body.component !== "all") {
          this.sendJson(req, res, 422, { error: "component must be plugin|mcp|skill|all" });
          return;
        }
        component = body.component;
      }
      const result = await uninstallMainComponent(client, component);
      const ok = "ok" in result ? result.ok : true;
      if (ok) {
        this.cache.invalidate("setupStatus");
        this.cache.invalidate("opsHealth");
      }
      this.sendJson(req, res, ok ? 200 : 422, result);
      return;
    }

    if (route === "/api/model-catalog" && (req.method === "GET" || req.method === "HEAD")) {
      const settings = this.deps.settings.get();
      this.sendJson(req, res, 200, { ok: true, modelCatalog: settings.modelCatalog });
      return;
    }

    if (route === "/api/model-catalog" && req.method === "POST") {
      const body = await this.readBody(req);
      if (!body) {
        this.sendJson(req, res, 400, { error: "Invalid body" });
        return;
      }
      try {
        const action = typeof body.action === "string" ? body.action : "upsert";
        const currentSettings = this.deps.settings.get();
        let next = currentSettings.modelCatalog;
        if (action === "upsert") {
          const config = validateModelConfig(body.model ?? body);
          next = upsertModelConfig(currentSettings.modelCatalog, config);
        } else if (action === "remove") {
          if (typeof body.id !== "string") throw new Error("id is required");
          const refs = workerIdsUsingModel(currentSettings.workerProfiles, body.id);
          next = removeModelConfig(currentSettings.modelCatalog, body.id, refs);
        } else {
          throw new Error("action must be upsert|remove");
        }
        const updated = this.deps.settings.update({ modelCatalog: next });
        this.cache.invalidate("setupStatus");
        this.cache.invalidate("opsHealth");
        this.sendJson(req, res, 200, {
          ok: true,
          modelCatalog: updated.modelCatalog,
          settings: viewHubSettings(updated),
        });
      } catch (error) {
        this.sendJson(req, res, 422, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (route === "/api/worker-profiles" && (req.method === "GET" || req.method === "HEAD")) {
      const settings = this.deps.settings.get();
      this.sendJson(req, res, 200, {
        ok: true,
        workerProfiles: settings.workerProfiles,
        modelCatalog: settings.modelCatalog,
      });
      return;
    }

    if (route === "/api/worker-profiles" && req.method === "POST") {
      const body = await this.readBody(req);
      if (!body) {
        this.sendJson(req, res, 400, { error: "Invalid body" });
        return;
      }
      try {
        const action = typeof body.action === "string" ? body.action : "upsert";
        const currentSettings = this.deps.settings.get();
        const catalog = currentSettings.modelCatalog;
        const current = currentSettings.workerProfiles;
        let next = current;
        let extraPatch: Record<string, unknown> = {};
        if (action === "upsert") {
          const profile = validateWorkerProfile(body.profile ?? body, "workerProfile", catalog);
          next = upsertWorkerProfile(current, profile, catalog);
        } else if (action === "remove") {
          if (typeof body.id !== "string") throw new Error("id is required");
          next = removeWorkerProfile(current, body.id, catalog);
        } else if (action === "setDefault") {
          if (typeof body.id !== "string") throw new Error("id is required");
          next = setDefaultWorkerProfile(current, body.id);
          const selected = getWorkerProfile(next, body.id);
          const mirror = executionPatchFromProfile(
            selected,
            catalog,
            currentSettings.providerDefaults,
          );
          extraPatch = {
            execution: { ...mirror.execution },
            providerDefaults: mirror.providerDefaults,
          };
        } else {
          throw new Error("action must be upsert|remove|setDefault");
        }
        const updated = this.deps.settings.update({
          workerProfiles: next,
          ...extraPatch,
        });
        this.cache.invalidate("setupStatus");
        this.cache.invalidate("opsHealth");
        this.sendJson(req, res, 200, {
          ok: true,
          workerProfiles: updated.workerProfiles,
          modelCatalog: updated.modelCatalog,
          settings: viewHubSettings(updated),
        });
      } catch (error) {
        this.sendJson(req, res, 422, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (route === "/api/worker-advanced-preview" && req.method === "POST") {
      const body = await this.readBody(req);
      if (!body) {
        this.sendJson(req, res, 400, { error: "Invalid body" });
        return;
      }
      try {
        const runtime = typeof body.runtime === "string" ? body.runtime : "";
        if (!isRuntimeName(runtime)) {
          this.sendJson(req, res, 422, { error: "Unsupported runtime" });
          return;
        }
        let existingPolicy: Partial<AdvancedPolicyFields> = {};
        if (body.existingAdvancedPolicy !== undefined) {
          existingPolicy = validateAdvancedPolicyPatch(
            body.existingAdvancedPolicy,
            "existingAdvancedPolicy",
          );
        }
        let draftPolicy: Partial<AdvancedPolicyFields> = {};
        if (body.draftAdvancedPolicy !== undefined) {
          draftPolicy = validateAdvancedPolicyPatch(
            body.draftAdvancedPolicy,
            "draftAdvancedPolicy",
          );
        }
        const merged: Partial<AdvancedPolicyFields> = {};
        for (const key of Object.keys(existingPolicy)) {
          (merged as Record<string, unknown>)[key] = (existingPolicy as Record<string, unknown>)[key];
        }
        for (const key of Object.keys(draftPolicy)) {
          (merged as Record<string, unknown>)[key] = (draftPolicy as Record<string, unknown>)[key];
        }
        const currentSettings = this.deps.settings.get();
        const globalDefaults = defaultAdvancedPolicyFields();
        globalDefaults.noProgressTimeoutMs = currentSettings.execution.noProgressTimeoutMs;
        globalDefaults.workerStopGraceMs = currentSettings.execution.workerStopGraceMs;
        globalDefaults.baseMaxAttempts = currentSettings.execution.maxAttempts;
        globalDefaults.maxExtraAttempts = currentSettings.execution.maxExtraAttempts;
        globalDefaults.maxConcurrency = currentSettings.execution.maxConcurrency;
        globalDefaults.completionMode = currentSettings.completionPolicy.noChangeMode;
        globalDefaults.changeBudgetMode = currentSettings.completionPolicy.changeBudgetMode;
        const capability = enforcementCapabilityForRuntime(runtime);
        const preview = previewEffectivePolicy(
          Object.keys(merged).length > 0 ? merged : undefined,
          undefined,
          globalDefaults,
          "draft-worker",
          capability,
        );
        this.sendJson(req, res, 200, { ok: true, preview });
      } catch (error) {
        this.sendJson(req, res, 422, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    // --- Read-only model-routing advisory bridge ---
    // Must be dispatched before the generic /api/ops/ catch-all so it is not
    // miscategorised as a mutation.
    if (route === "/api/ops/model-routing" && req.method === "POST") {
      const body = await this.readBody(req);
      if (!body) {
        this.sendJson(req, res, 400, { error: "Invalid body" });
        return;
      }
      const taskClass = typeof body.taskClass === "string" && body.taskClass.trim()
        ? body.taskClass.trim()
        : null;
      if (!taskClass || taskClass.length > 200) {
        this.sendJson(req, res, 422, { error: "taskClass must contain 1 to 200 characters" });
        return;
      }
      const candidates: Array<{ provider: string; model: string }> = [];
      try {
        if (!Array.isArray(body.candidates)) {
          this.sendJson(req, res, 422, { error: "candidates must be an array" });
          return;
        }
        if (body.candidates.length < 2 || body.candidates.length > 10) {
          this.sendJson(req, res, 422, { error: "candidates must contain 2 to 10 entries" });
          return;
        }
        const seen = new Set<string>();
        for (let i = 0; i < body.candidates.length; i++) {
          const c = body.candidates[i];
          if (c === null || typeof c !== "object" || Array.isArray(c)) {
            this.sendJson(req, res, 422, { error: `candidates[${i}] must be an object with provider and model` });
            return;
          }
          const provider = typeof c.provider === "string" && c.provider.trim()
            ? c.provider.trim() : null;
          const model = typeof c.model === "string" && c.model.trim()
            ? c.model.trim() : null;
          if (!provider || provider.length > 100) {
            this.sendJson(req, res, 422, { error: `candidates[${i}].provider must contain 1 to 100 characters` });
            return;
          }
          if (!model || model.length > 200) {
            this.sendJson(req, res, 422, { error: `candidates[${i}].model must contain 1 to 200 characters` });
            return;
          }
          const dedupKey = `${provider}\0${model}`;
          if (seen.has(dedupKey)) {
            this.sendJson(req, res, 422, { error: `Duplicate candidate at index ${i}: ${provider} / ${model}` });
            return;
          }
          seen.add(dedupKey);
          candidates.push({ provider, model });
        }
      } catch (error) {
        this.sendJson(req, res, 422, {
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      try {
        // Bridge is strictly read-only — calls daemon model_routing only.
        const advisory = await this.daemonCall<Record<string, unknown>>("model_routing", {
          taskClass,
          candidates,
        });
        this.sendJson(req, res, 200, { ok: true, advisory });
      } catch (error) {
        this.sendJson(req, res, 503, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    // --- Ops surface (read + supervise mutations) ---
    if (route.startsWith("/api/ops/")) {
      const opsRoute = route.slice("/api/ops".length);
      if (req.method === "GET" || req.method === "HEAD") {
        await this.handleOps(req, res, opsRoute);
        return;
      }
      if (req.method === "POST") {
        await this.handleOpsMutation(req, res, opsRoute);
        return;
      }
      this.sendJson(req, res, 405, { error: "Method not allowed" });
      return;
    }

    // Back-compat aliases used by early Hub UI
    if (route === "/api/tasks" && (req.method === "GET" || req.method === "HEAD")) {
      await this.handleOps(req, res, "/tasks");
      return;
    }

    this.sendJson(req, res, 404, { error: "Not found" });
  }

  private async probeDaemonStatus(): Promise<Record<string, unknown>> {
    if (this.deps.probeDaemon) {
      try {
        const probe = await this.deps.probeDaemon();
        if (probe.running && probe.health) {
          return {
            running: true,
            ok: probe.health.ok !== false,
            ...probe.health,
          };
        }
        return {
          running: false,
          ok: false,
          error: probe.error ?? "Daemon is not running",
        };
      } catch (error) {
        return {
          running: false,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    // Legacy: only ensureDaemon available — report via ensure without inventing probe.
    if (this.deps.ensureDaemon) {
      try {
        const health = await this.deps.ensureDaemon();
        return { running: true, ok: health.ok !== false, ...health };
      } catch (error) {
        return {
          running: false,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return { running: false, ok: false, error: "Daemon bridge unavailable" };
  }

  /** Read-only three-layer version truth for the Hub's primary status view. */
  private buildVersionJourney(daemonStatus: Record<string, unknown>): VersionJourney {
    let source: { digest: string; latestModifiedAt: string } | undefined;
    if (this.deps.packageRoot !== undefined) {
      try {
        const inspected = inspectSourceTree(this.deps.packageRoot);
        source = {
          digest: inspected.digest,
          latestModifiedAt: inspected.latestModifiedAt,
        };
      } catch {
        source = undefined;
      }
    }

    let artifact: BuildIdentity | undefined;
    try {
      artifact = currentBuildIdentity();
    } catch {
      artifact = undefined;
    }

    const rawDaemonIdentity = daemonStatus.buildIdentity;
    const daemonIdentity = isBuildIdentity(rawDaemonIdentity)
      ? rawDaemonIdentity
      : undefined;
    return projectVersionJourney(source, artifact, {
      running: daemonStatus.running === true,
      ...(daemonIdentity === undefined ? {} : { buildIdentity: daemonIdentity }),
    });
  }

  /**
   * Call daemon without auto-start. Hub Stop must stay sticky: UI poll paths
   * (/api/ops/health|board|tasks) must not revive the daemon. Explicit start
   * is only via POST /api/daemon { action: start|restart }.
   */
  private async daemonCall<T>(
    method: DaemonMethod,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    if (!this.deps.daemonRequest) {
      throw new Error("Daemon bridge unavailable - start with forklight hub so the daemon can attach");
    }
    return this.deps.daemonRequest<T>(method, params);
  }

  /** Console-compatible read APIs under /api/ops/* */
  private async handleOps(
    req: IncomingMessage,
    res: ServerResponse,
    opsRoute: string,
  ): Promise<void> {
    try {
      if (opsRoute === "/health") {
        // Normal Hub refresh polls this every ~2 s per tab. The daemon health
        // read reruns synchronous runtime + environment evidence (claude
        // --version, provider readiness, runtime doctors); coalesce it across
        // tabs for a short, visible lifetime so several open tabs cannot
        // repeatedly block workspace preparation or Worker event processing.
        // Task/Board/Plan/Competition/statistics/settings/economics reads stay
        // uncached and current - only this operations-health snapshot is shared.
        const entry = await this.cache.getOrCompute(
          "opsHealth",
          () => this.daemonCall<Record<string, unknown>>("health"),
        );
        this.sendJson(req, res, 200, {
          ...entry.value,
          checkedAt: entry.checkedAt,
        });
        return;
      }
      if (opsRoute === "/settings") {
        const settings = await this.daemonCall<Record<string, unknown>>("settings_get");
        this.sendJson(req, res, 200, settings);
        return;
      }
      if (opsRoute === "/board" || opsRoute === "/plans") {
        const boards = await this.daemonCall<unknown[]>("plan_board_overview", { limit: 50 });
        this.sendJson(req, res, 200, Array.isArray(boards) ? boards : []);
        return;
      }
      if (opsRoute === "/tasks") {
        const surfaces = await this.daemonCall<Array<Record<string, unknown>>>("list_summaries", {
          limit: 50,
        });
        const tasks = (Array.isArray(surfaces) ? surfaces : []).map((t) => {
          // Compact final-delivery disposition (status, checkId, createdAt only).
          // Never expose reason, command text/output, prompt, or diff payloads here.
          const disposition = t.remediationDisposition;
          let remediationDisposition:
            | { status: string; checkId: string; createdAt: string }
            | undefined;
          if (
            disposition !== null
            && typeof disposition === "object"
            && (disposition as { status?: unknown }).status === "verified-repaired-delivered"
            && typeof (disposition as { checkId?: unknown }).checkId === "string"
            && typeof (disposition as { createdAt?: unknown }).createdAt === "string"
          ) {
            const d = disposition as { status: string; checkId: string; createdAt: string };
            remediationDisposition = {
              status: d.status,
              checkId: d.checkId,
              createdAt: d.createdAt,
            };
          }
          return {
            id: t.taskId ?? t.id,
            name: t.name,
            status: t.status,
            provider: t.provider,
            model: t.model,
            runtime: t.runtime,
            createdAt: t.createdAt,
            startedAt: t.startedAt,
            finishedAt: t.finishedAt,
            error: t.error,
            progress: t.progress,
            ...(typeof t.decisionStage === "string" ? { decisionStage: t.decisionStage } : {}),
            ...(t.failureCategory === undefined ? {} : { failureCategory: t.failureCategory }),
            ...(remediationDisposition === undefined ? {} : { remediationDisposition }),
          };
        });
        this.sendJson(req, res, 200, tasks);
        return;
      }
      if (opsRoute === "/competitions") {
        const list = await this.daemonCall<unknown[]>("competition_list", {});
        this.sendJson(req, res, 200, Array.isArray(list) ? list.slice(0, 50) : []);
        return;
      }
      if (opsRoute === "/stats") {
        const stats = await this.daemonCall<unknown[]>("statistics", {});
        this.sendJson(req, res, 200, Array.isArray(stats) ? stats.slice(0, 50) : []);
        return;
      }
      if (opsRoute === "/economics-summary") {
        // Read-only bridge to daemon economics_summary. Never mutates, never
        // calls a Provider, never recomputes arithmetic. Returning the
        // detached summary as-is keeps Hub Ops factually identical to the
        // canonical daemon evidence.
        const summary = await this.daemonCall<Record<string, unknown>>(
          "economics_summary",
          {},
        );
        this.sendJson(req, res, 200, summary);
        return;
      }

      const boardPlan = opsRoute.match(/^\/(?:board|plans)\/(.+)$/);
      if (boardPlan) {
        const planId = decodeURIComponent(boardPlan[1]!);
        const board = await this.daemonCall<unknown>("plan_board", { planId });
        this.sendJson(req, res, 200, board);
        return;
      }

      const calibration = opsRoute.match(/^\/tasks\/([^/]+)\/calibration$/);
      if (calibration) {
        const taskId = decodeURIComponent(calibration[1]!);
        const task = await this.daemonCall<Record<string, unknown>>("status", { taskId });
        const identity = calibrationIdentity(task);
        if (identity === undefined) {
          this.sendJson(req, res, 200, { state: "identity-missing" });
          return;
        }
        const inbox = await this.daemonCall<unknown>("direct_codex_inbox", {
          taskClass: identity.taskClass,
          directCodexProfileId: identity.directCodexProfileId,
        });
        const preview = await this.daemonCall<unknown>("direct_codex_publication_preview", {
          taskClass: identity.taskClass,
          directCodexProfileId: identity.directCodexProfileId,
        });
        this.sendJson(req, res, 200, safeCalibrationState(identity, inbox, preview));
        return;
      }

      const td = opsRoute.match(/^\/tasks\/(.+)$/);
      if (td) {
        const taskId = decodeURIComponent(td[1]!);
        const task = await this.daemonCall<Record<string, unknown>>("status", { taskId });
        const decision = await this.daemonCall<unknown>("task_decision", { taskId });
        const economics = await this.daemonCall<unknown>("task_economics", { taskId });
        // Canonical eligibility from the core (never duplicated in the Hub).
        // Read-only: safe to query even for Tasks where the operation does not apply.
        let candidateReverificationEligibility: unknown = undefined;
        let correctionEligibility: unknown = undefined;
        try {
          candidateReverificationEligibility = await this.daemonCall<unknown>(
            "candidate_reverify_eligibility",
            { taskId },
          );
        } catch {
          // Eligibility is best-effort for the Task Detail three-way choice;
          // a daemon error must not prevent the Task detail from rendering.
        }
        try {
          correctionEligibility = await this.daemonCall<unknown>(
            "correction_eligibility",
            { taskId },
          );
        } catch {
          // Eligibility is best-effort; a daemon error must not prevent rendering.
        }
        const inspect = await this.daemonCall<{
          events?: Array<{ timestamp: string; type: string; summary: string; payload?: unknown }>;
          attempts?: Array<Record<string, unknown>>;
          diff?: string;
          mainReview?: Record<string, unknown>;
        }>("inspect", { taskId });
        const events = Array.isArray(inspect.events) ? inspect.events : [];
        const timeline = events.slice(-80).map((ev) => ({
          timestamp: ev.timestamp,
          type: ev.type,
          summary: ev.summary,
        }));
        const spec = task.spec as {
          provider?: { name?: string; model?: string };
          runtime?: { name?: string };
          delivery?: { buildCommands?: unknown[]; activationCommands?: unknown[]; activationCheckCommands?: unknown[] };
          deliveryResolution?: { source?: string; profileId?: string };
        } | undefined;
        const paths = task.paths as { source?: string } | undefined;
        // effectivePolicy is the immutable per-Task snapshot used by the
        // bounded adaptation panel. It is content-free policy numbers and
        // provenance only - safe to expose to the Hub UI.
        const effectivePolicy = (task as { effectivePolicy?: unknown }).effectivePolicy;
        const journey = buildSafeTaskJourney(task, decision, inspect);

        // Delivery plan from the immutable Task snapshot — no settings read or command text.
        const deliveryPlan = buildDeliveryPlanView(
          spec?.delivery as { buildCommands: string[]; activationCommands: string[]; activationCheckCommands: string[] } | undefined,
          spec?.deliveryResolution as { source: "inline" } | { source: "explicit" | "project" | "default"; profileId: string } | undefined,
        );

        this.sendJson(req, res, 200, {
          id: task.id,
          name: task.name,
          status: task.status,
          provider: spec?.provider?.name ?? "",
          model: spec?.provider?.model ?? "",
          runtime: spec?.runtime?.name ?? "",
          source: (task as { sourcePath?: string }).sourcePath ?? paths?.source ?? "",
          sessionId: task.sessionId,
          createdAt: task.createdAt,
          startedAt: task.startedAt,
          finishedAt: task.finishedAt,
          error: task.error,
          decision,
          progress: (decision as { progress?: unknown }).progress,
          journey,
          timeline,
          economics,
          deliveryPlan,
          ...(effectivePolicy === undefined ? {} : { effectivePolicy }),
          ...(candidateReverificationEligibility === undefined
            ? {}
            : { candidateReverificationEligibility }),
          ...(correctionEligibility === undefined
            ? {}
            : { correctionEligibility }),
        });
        return;
      }

      const cd = opsRoute.match(/^\/competitions\/(.+)$/);
      if (cd) {
        const competitionId = decodeURIComponent(cd[1]!);
        const status = await this.daemonCall<unknown>("competition_status", { competitionId });
        this.sendJson(req, res, 200, status);
        return;
      }

      const ih = opsRoute.match(/^\/integration\/(.+)\/history$/);
      if (ih) {
        const taskId = decodeURIComponent(ih[1]!);
        const history = await this.daemonCall<{
          receipts?: unknown[];
          results?: unknown[];
        }>("integration_history", { taskId });
        this.sendJson(req, res, 200, {
          receipts: Array.isArray(history.receipts) ? history.receipts.slice(-80) : [],
          results: Array.isArray(history.results) ? history.results.slice(-80) : [],
        });
        return;
      }

      if (opsRoute === "/providers" || opsRoute === "/providers/status") {
        const bodyProvider = undefined;
        const result = await this.daemonCall<Record<string, unknown>>("provider_status", {
          ...(bodyProvider === undefined ? {} : { provider: bodyProvider }),
        });
        this.sendJson(req, res, 200, result);
        return;
      }

      this.sendJson(req, res, 404, { error: "Not found" });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const notFound = /Unknown (?:ForkLight|competition|task)/i.test(msg);
      this.sendJson(req, res, notFound ? 404 : 503, { error: msg });
    }
  }

  /**
   * Mutating operate actions (task supervise, integration, provider probe, competition compare).
   * Fail-closed: apply / main_review / provider_probe require explicit confirm: true.
   */
  private async handleOpsMutation(
    req: IncomingMessage,
    res: ServerResponse,
    opsRoute: string,
  ): Promise<void> {
    const body = (await this.readBody(req)) ?? {};
    try {
      // POST /api/ops/tasks/:id/resume
      const resume = opsRoute.match(/^\/tasks\/([^/]+)\/resume$/);
      if (resume) {
        const taskId = decodeURIComponent(resume[1]!);
        const feedback = typeof body.feedback === "string" ? body.feedback.trim() : undefined;
        const params: Record<string, unknown> = { taskId };
        if (feedback) params.feedback = feedback;
        if (body.authorization && typeof body.authorization === "object" && !Array.isArray(body.authorization)) {
          params.authorization = body.authorization;
        }
        const result = await this.daemonCall<unknown>("resume", params);
        this.sendJson(req, res, 200, { ok: true, action: "resume", taskId, result });
        return;
      }

      // POST /api/ops/tasks/:id/revise
      const revise = opsRoute.match(/^\/tasks\/([^/]+)\/revise$/);
      if (revise) {
        const taskId = decodeURIComponent(revise[1]!);
        if (typeof body.feedback !== "string" || !body.feedback.trim()) {
          this.sendJson(req, res, 422, { error: "feedback is required for revise" });
          return;
        }
        const params: Record<string, unknown> = {
          taskId,
          feedback: body.feedback.trim(),
        };
        if (body.authorization && typeof body.authorization === "object" && !Array.isArray(body.authorization)) {
          params.authorization = body.authorization;
        }
        const result = await this.daemonCall<unknown>("revise", params);
        this.sendJson(req, res, 200, { ok: true, action: "revise", taskId, result });
        return;
      }

      // POST /api/ops/tasks/:id/correct  { feedback, maxBudgetUsd?, confirm: true }
      const correctRoute = opsRoute.match(/^\/tasks\/([^/]+)\/correct$/);
      if (correctRoute) {
        const taskId = decodeURIComponent(correctRoute[1]!);
        if (body.confirm !== true) {
          this.sendJson(req, res, 422, { error: "correction requires confirm: true" });
          return;
        }
        const feedback = typeof body.feedback === "string" ? body.feedback.trim() : "";
        if (!feedback || feedback.length > 1000) {
          this.sendJson(req, res, 422, { error: "correction feedback is required (max 1000 chars)" });
          return;
        }
        const params: Record<string, unknown> = { taskId, feedback, confirm: true };
        if (body.maxBudgetUsd !== undefined) {
          if (body.maxBudgetUsd === null) {
            params.maxBudgetUsd = null;
          } else {
            const budget = Number(body.maxBudgetUsd);
            if (!Number.isFinite(budget) || budget <= 0) {
              this.sendJson(req, res, 422, { error: "maxBudgetUsd must be null or a positive number" });
              return;
            }
            params.maxBudgetUsd = budget;
          }
        }
        // Structured gap contract fields (optional for legacy Tasks, all required together for revisions)
        if (typeof body.candidateRevisionId === "string") {
          params.candidateRevisionId = body.candidateRevisionId;
        }
        if (Array.isArray(body.reusablePaths)) {
          params.reusablePaths = body.reusablePaths;
        }
        if (Array.isArray(body.remainingGaps)) {
          params.remainingGaps = body.remainingGaps;
        }
        const result = await this.daemonCall<unknown>("correct", params);
        this.sendJson(req, res, 200, { ok: true, action: "correct", taskId, result });
        return;
      }

      // POST /api/ops/tasks/:id/reverify  { reason, confirm: true }
      // Verification-only rerun of a failed candidate's original acceptance
      // suite. Never launches a Worker or creates an Attempt. The daemon
      // enforces eligibility, the frozen allowance, and crash-safe status.
      const reverifyRoute = opsRoute.match(/^\/tasks\/([^/]+)\/reverify$/);
      if (reverifyRoute) {
        const taskId = decodeURIComponent(reverifyRoute[1]!);
        if (body.confirm !== true) {
          this.sendJson(req, res, 422, { error: "candidate_reverify requires confirm: true" });
          return;
        }
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";
        if (!reason || reason.length > 1000) {
          this.sendJson(req, res, 422, { error: "reason is required (max 1000 chars)" });
          return;
        }
        const result = await this.daemonCall<unknown>("candidate_reverify", {
          taskId,
          reason,
          confirm: true,
        });
        this.sendJson(req, res, 200, { ok: true, action: "candidate_reverify", taskId, result });
        return;
      }

      // POST /api/ops/tasks/:id/main-review  { decision, reason, confirm: true }
      const mainReview = opsRoute.match(/^\/tasks\/([^/]+)\/main-review$/);
      if (mainReview) {
        const taskId = decodeURIComponent(mainReview[1]!);
        if (body.confirm !== true) {
          this.sendJson(req, res, 422, { error: "main_review requires confirm: true" });
          return;
        }
        const decision = typeof body.decision === "string" ? body.decision : "";
        if (decision !== "accept" && decision !== "revise" && decision !== "reject") {
          this.sendJson(req, res, 422, { error: "decision must be accept, revise, or reject" });
          return;
        }
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";
        if (!reason || reason.length > 1000) {
          this.sendJson(req, res, 422, { error: "reason is required (max 1000 chars)" });
          return;
        }
        const result = await this.daemonCall<unknown>("main_review", {
          taskId,
          decision,
          reason,
          confirm: true,
        });
        this.sendJson(req, res, 200, { ok: true, action: "main_review", taskId, result });
        return;
      }

      // POST /api/ops/tasks/:id/adaptation/preview  { patch?, reason? }
      // Read-only bridge to adaptation_preview. Never mutates the Task,
      // never loops, and never infers a patch. Object-only patch validation
      // and bounded reason validation run before the daemon call.
      const adaptationPreview = opsRoute.match(/^\/tasks\/([^/]+)\/adaptation\/preview$/);
      if (adaptationPreview) {
        const taskId = decodeURIComponent(adaptationPreview[1]!);
        const params: Record<string, unknown> = { taskId };
        if (body.patch === null || typeof body.patch !== "object" || Array.isArray(body.patch)) {
          this.sendJson(req, res, 422, { error: "adaptation patch must be an object" });
          return;
        }
        params.patch = body.patch;
        if (typeof body.reason !== "string" || !ADAPTATION_PROPOSED_REASONS.has(body.reason)) {
          this.sendJson(req, res, 422, { error: "adaptation reason must be a bounded reason category" });
          return;
        }
        params.reason = body.reason;
        const result = await this.daemonCall<unknown>("adaptation_preview", params);
        this.sendJson(req, res, 200, { ok: true, action: "adaptation_preview", taskId, preview: result });
        return;
      }

      // POST /api/ops/tasks/:id/adaptation/apply  { patch?, reason?, confirm: true }
      // Confirmed bridge to adaptation_apply. Requires literal confirm:true
      // and never auto-applies from a preview. Object-only patch validation
      // and bounded reason validation run before the daemon call.
      const adaptationApply = opsRoute.match(/^\/tasks\/([^/]+)\/adaptation\/apply$/);
      if (adaptationApply) {
        const taskId = decodeURIComponent(adaptationApply[1]!);
        if (body.confirm !== true) {
          this.sendJson(req, res, 422, { error: "adaptation_apply requires confirm: true" });
          return;
        }
        const params: Record<string, unknown> = { taskId, confirm: true };
        if (body.patch === null || typeof body.patch !== "object" || Array.isArray(body.patch)) {
          this.sendJson(req, res, 422, { error: "adaptation patch must be an object" });
          return;
        }
        params.patch = body.patch;
        if (typeof body.reason !== "string" || !ADAPTATION_PROPOSED_REASONS.has(body.reason)) {
          this.sendJson(req, res, 422, { error: "adaptation reason must be a bounded reason category" });
          return;
        }
        params.reason = body.reason;
        const result = await this.daemonCall<Record<string, unknown>>("adaptation_apply", params);
        const childTaskId = typeof result.childTaskId === "string" ? result.childTaskId : undefined;
        const preview = (result as { preview?: unknown }).preview;
        this.sendJson(req, res, 200, {
          ok: true,
          action: "adaptation_apply",
          taskId,
          status: result.status,
          ...(childTaskId === undefined ? {} : { childTaskId }),
          ...(preview === undefined ? {} : { preview }),
        });
        return;
      }

      // POST /api/ops/tasks/:id/integration/preflight
      const preflight = opsRoute.match(/^\/tasks\/([^/]+)\/integration\/preflight$/);
      if (preflight) {
        const taskId = decodeURIComponent(preflight[1]!);
        const result = await this.daemonCall<unknown>("integration_preflight", { taskId });
        this.sendJson(req, res, 200, { ok: true, action: "integration_preflight", taskId, result });
        return;
      }

      // POST /api/ops/tasks/:id/integration/apply  { receiptId, confirm: true }
      const apply = opsRoute.match(/^\/tasks\/([^/]+)\/integration\/apply$/);
      if (apply) {
        const taskId = decodeURIComponent(apply[1]!);
        if (body.confirm !== true) {
          this.sendJson(req, res, 422, { error: "integration_apply requires confirm: true" });
          return;
        }
        const receiptId = typeof body.receiptId === "string" ? body.receiptId.trim() : "";
        if (!receiptId) {
          this.sendJson(req, res, 422, { error: "receiptId is required" });
          return;
        }
        const result = await this.daemonCall<unknown>("integration_apply", {
          taskId,
          receiptId,
          confirm: true,
        });
        this.sendJson(req, res, 200, { ok: true, action: "integration_apply", taskId, result });
        return;
      }

      const calibrationCapture = opsRoute.match(/^\/tasks\/([^/]+)\/calibration\/capture$/);
      if (calibrationCapture) {
        const taskId = decodeURIComponent(calibrationCapture[1]!);
        if (!exactOwnKeys(body, DIRECT_CODEX_CAPTURE_KEYS)) {
          this.sendJson(req, res, 422, { error: "Capture needs only a run reference and five Token counts" });
          return;
        }
        const runRef = typeof body.runRef === "string" ? body.runRef : "";
        if (!/^codex-run:[A-Za-z0-9._-]{1,128}$/.test(runRef)) {
          this.sendJson(req, res, 422, { error: "Invalid direct-run reference" });
          return;
        }
        try {
          normalizeCodexTerminalUsage(body.usage);
        } catch {
          this.sendJson(req, res, 422, { error: "The five Token counts are incomplete or inconsistent" });
          return;
        }
        const sample = await this.daemonCall<Record<string, unknown>>(
          "direct_codex_guided_capture",
          { forklightTaskId: taskId, codexRunRef: runRef, usage: body.usage },
        );
        this.sendJson(req, res, 200, {
          ok: true,
          action: "direct_codex_guided_capture",
          taskId,
          sampleId: typeof sample.sampleId === "string" ? sample.sampleId : undefined,
        });
        return;
      }

      const calibrationReview = opsRoute.match(/^\/tasks\/([^/]+)\/calibration\/review$/);
      if (calibrationReview) {
        const taskId = decodeURIComponent(calibrationReview[1]!);
        const decision = typeof body.decision === "string" && DIRECT_CODEX_REVIEW_DECISIONS.has(body.decision)
          ? body.decision as "accepted" | "rejected"
          : undefined;
        if (decision === undefined) {
          this.sendJson(req, res, 422, { error: "Choose whether this direct run is equivalent or should be rejected" });
          return;
        }
        const allowed = decision === "accepted"
          ? DIRECT_CODEX_ACCEPT_REVIEW_KEYS
          : DIRECT_CODEX_REJECT_REVIEW_KEYS;
        if (!exactOwnKeys(body, allowed) || body.confirm !== true) {
          this.sendJson(req, res, 422, { error: "Review needs an explicit confirmation" });
          return;
        }
        const sampleId = typeof body.sampleId === "string" ? body.sampleId : "";
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(sampleId)) {
          this.sendJson(req, res, 422, { error: "Invalid calibration sample" });
          return;
        }
        let rejectionReason: string | undefined;
        if (decision === "rejected") {
          rejectionReason = typeof body.rejectionReason === "string"
            && DIRECT_CODEX_REJECTION_REASONS.has(body.rejectionReason)
            ? body.rejectionReason
            : undefined;
          if (rejectionReason === undefined) {
            this.sendJson(req, res, 422, { error: "Choose why this run is not usable" });
            return;
          }
        }

        const task = await this.daemonCall<Record<string, unknown>>("status", { taskId });
        const identity = calibrationIdentity(task);
        if (identity === undefined) {
          this.sendJson(req, res, 422, { error: "This Task has no comparison identity" });
          return;
        }
        const inbox = await this.daemonCall<unknown[]>("direct_codex_inbox", {
          taskClass: identity.taskClass,
          directCodexProfileId: identity.directCodexProfileId,
        });
        const belongsToTaskIdentity = Array.isArray(inbox) && inbox.some((item) => {
          if (item === null || typeof item !== "object" || Array.isArray(item)) return false;
          const sample = (item as Record<string, unknown>).sample;
          return sample !== null && typeof sample === "object" && !Array.isArray(sample)
            && (sample as Record<string, unknown>).sampleId === sampleId;
        });
        if (!belongsToTaskIdentity) {
          this.sendJson(req, res, 422, { error: "This sample does not belong to the Task comparison" });
          return;
        }

        const result = await this.daemonCall<unknown>("direct_codex_review", {
          sampleId,
          decision,
          ...(rejectionReason === undefined ? {} : { rejectionReason }),
          reviewer: "main-codex",
          reviewedAt: isoTimestamp(),
          schemaVersion: 1,
          confirm: true,
        });
        this.sendJson(req, res, 200, {
          ok: true,
          action: "direct_codex_review",
          taskId,
          result,
        });
        return;
      }

      const calibrationPublish = opsRoute.match(/^\/tasks\/([^/]+)\/calibration\/publish$/);
      if (calibrationPublish) {
        const taskId = decodeURIComponent(calibrationPublish[1]!);
        if (!exactOwnKeys(body, DIRECT_CODEX_PUBLISH_KEYS) || body.confirm !== true) {
          this.sendJson(req, res, 422, { error: "Publishing comparison evidence needs explicit confirmation" });
          return;
        }
        const task = await this.daemonCall<Record<string, unknown>>("status", { taskId });
        const identity = calibrationIdentity(task);
        if (identity === undefined) {
          this.sendJson(req, res, 422, { error: "This Task has no comparison identity" });
          return;
        }
        const result = await this.daemonCall<{
          summary?: {
            acceptedSampleCount?: number;
            acceptedSampleIds?: unknown[];
            version?: number;
          };
        }>("direct_codex_publication_register", {
          method: "hub-guided-exact-pair",
          confidence: "low",
          createdAt: isoTimestamp(),
          taskClass: identity.taskClass,
          directCodexProfileId: identity.directCodexProfileId,
          confirm: true,
        });
        const summary = result.summary;
        this.sendJson(req, res, 200, {
          ok: true,
          action: "direct_codex_publication_register",
          taskId,
          version: summary?.version,
          acceptedSampleCount: summary?.acceptedSampleCount,
          acceptedSampleIds: Array.isArray(summary?.acceptedSampleIds)
            ? summary.acceptedSampleIds.filter((id): id is string => typeof id === "string").slice(0, 50)
            : [],
        });
        return;
      }

      // POST /api/ops/providers/probe  { provider?, confirm: true }
      if (opsRoute === "/providers/probe") {
        if (body.confirm !== true) {
          this.sendJson(req, res, 422, {
            error: "provider_probe requires confirm: true (billable request)",
          });
          return;
        }
        const provider = typeof body.provider === "string" && body.provider.trim()
          ? body.provider.trim()
          : undefined;
        const result = await this.daemonCall<Record<string, unknown>>("provider_probe", {
          ...(provider === undefined ? {} : { provider }),
        });
        this.sendJson(req, res, 200, {
          ok: true,
          action: "provider_probe",
          result,
          message: "Provider probe completed (billable request may have been charged)",
        });
        return;
      }

      // POST /api/ops/providers/status  optional provider filter
      if (opsRoute === "/providers/status") {
        const provider = typeof body.provider === "string" && body.provider.trim()
          ? body.provider.trim()
          : undefined;
        const result = await this.daemonCall<Record<string, unknown>>("provider_status", {
          ...(provider === undefined ? {} : { provider }),
        });
        this.sendJson(req, res, 200, { ok: true, action: "provider_status", result });
        return;
      }

      // POST /api/ops/competitions/:id/compare  { rankingWeights? }
      const compare = opsRoute.match(/^\/competitions\/([^/]+)\/compare$/);
      if (compare) {
        const competitionId = decodeURIComponent(compare[1]!);
        const params: Record<string, unknown> = { competitionId };
        if (body.rankingWeights && typeof body.rankingWeights === "object" && !Array.isArray(body.rankingWeights)) {
          params.rankingWeights = body.rankingWeights;
        }
        const result = await this.daemonCall<unknown>("competition_compare", params);
        this.sendJson(req, res, 200, { ok: true, action: "competition_compare", competitionId, result });
        return;
      }

      // POST /api/ops/tasks/submit  { filePath, confirm: true }
      if (opsRoute === "/tasks/submit") {
        if (body.confirm !== true) {
          this.sendJson(req, res, 422, { error: "Task submission requires confirm: true" });
          return;
        }
        const filePath = typeof body.filePath === "string" ? body.filePath.trim() : "";
        if (!filePath || filePath.length > 8192 || !path.isAbsolute(filePath)) {
          this.sendJson(req, res, 422, { error: "An absolute task contract file path is required" });
          return;
        }
        try {
          const task = await this.daemonCall<{ id: string; name: string; status: string }>(
            "submit_file",
            { taskFile: filePath },
          );
          this.sendJson(req, res, 200, {
            ok: true,
            action: "submit_file",
            taskId: task.id,
            task: { id: task.id, name: task.name, status: task.status },
          });
        } catch (_daemonError) {
          this.sendJson(req, res, 422, { error: "Task contract submission rejected by daemon" });
        }
        return;
      }

      this.sendJson(req, res, 404, { error: "Not found" });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const notFound = /Unknown (?:ForkLight|competition|task)/i.test(msg);
      const clientErr = /requires|must be|invalid|missing|confirm/i.test(msg);
      this.sendJson(req, res, notFound ? 404 : clientErr ? 422 : 503, { error: msg });
    }
  }

  private async serveStatic(
    req: IncomingMessage,
    res: ServerResponse,
    route: string,
  ): Promise<void> {
    let rel = route === "/" ? "/index.html" : route;
    if (rel.includes("..")) {
      this.sendJson(req, res, 400, { error: "Invalid path" });
      return;
    }
    const filePath = path.join(this.deps.staticRoot, rel);
    if (!filePath.startsWith(this.deps.staticRoot)) {
      this.sendJson(req, res, 400, { error: "Invalid path" });
      return;
    }
    try {
      const st = await stat(filePath);
      if (!st.isFile()) {
        this.sendJson(req, res, 404, { error: "Not found" });
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Content-Length": st.size,
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      createReadStream(filePath).pipe(res);
    } catch {
      this.sendJson(req, res, 404, { error: "Not found" });
    }
  }
}
