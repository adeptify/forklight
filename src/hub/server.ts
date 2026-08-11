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
import { homedir } from "node:os";
import path from "node:path";
import type { SettingsService } from "../core/settings.js";
import type { SetupService } from "../setup/service.js";
import type { SetupKeychainStore } from "../setup/types.js";
import {
  projectExecutionProviderReadiness,
  projectExecutionRuntimeDisplay,
  resolveExecutionProviderFacts,
  resolveExecutionRuntimeFacts,
  type DaemonHealthEvidence,
  type RuntimeDisplayMetadata,
} from "../setup/doctor.js";
import type { DaemonMethod } from "../daemon/protocol.js";
import { WORK_HIERARCHY_INVALID_FILTER_REASON } from "../core/work-hierarchy.js";
import {
  contractsInvolvedForShape,
  normalizeOutcomeIntakeCreate,
  OUTCOME_INTAKE_CONFIRM_IN_PROGRESS_REASON,
  OUTCOME_INTAKE_NO_PROPOSAL_REASON,
  OUTCOME_INTAKE_STALE_ARTIFACT_REASON,
  STALE_OUTCOME_INTAKE_CONFIRM_REASON,
  type OutcomeIntakeCreateInput,
} from "../core/outcome-intake.js";
import {
  providerDefinition,
  providerLabel,
  providerNames,
  isProviderName,
  providerReadiness,
  type ProviderName,
  type ProviderReadiness,
} from "../core/providers.js";
import { listWorkerAdapters } from "../workers/registry.js";
import {
  resolveWorkerReadiness,
  type ProviderVerificationEvidence,
} from "../core/worker-readiness.js";
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
  codexModelConfigFromEntry,
  loadLocalCodexModelCatalog,
  type CodexModelCatalogEntry,
} from "../core/codex-model-catalog.js";
import {
  defaultAdvancedPolicyFields,
  enforcementCapabilityForRuntime,
  previewEffectivePolicy,
  validateAdvancedPolicyPatch,
} from "../core/advanced-policy.js";
import type {
  AdvancedPolicyFields,
  ContractQualityOverrides,
  EventRecord,
  TaskRecord,
} from "../core/types.js";
import {
  isRuntimeName,
  SUPPORTED_RUNTIME_NAMES,
  type RuntimeName,
} from "../core/runtime-names.js";
import { validateContractQualityOverride } from "../core/worker-profiles.js";
import { previewQualityPolicy } from "../core/contract-quality.js";
import { buildDeliveryPlanView } from "../core/delivery-profiles.js";
import { isLegalBoardPlacement } from "../core/task-summary.js";
import {
  TASK_RESOLUTION_EVIDENCE_ID_MAX_LENGTH,
  TASK_RESOLUTION_NOTE_MAX_LENGTH,
  TASK_RESOLUTION_REASONS,
} from "../core/task-resolution.js";
import { HISTORY_INVALID_REQUEST_REASON } from "../core/task-history.js";
import {
  candidateRevisionMatchesCurrentDiff,
  resolveLatestRevision,
} from "../core/candidate-revision.js";
import { parseAffectedPathsFromWorkspaceDiff } from "../workspace/patch.js";
import { normalizeCodexTerminalUsage } from "../core/codex-terminal-usage.js";
import { grossDirectCodexTokens } from "../core/direct-codex-calibration.js";
import { isoTimestamp } from "../core/time.js";
import {
  OnboardingSampleService,
  type PreparedOnboardingSample,
} from "../onboarding/sample-task.js";

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
const FAILURE_ATTRIBUTION_CAUSES = new Set([
  "candidate",
  "verification-infrastructure",
  "acceptance-contract",
  "insufficient-evidence",
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
const ONBOARDING_SAMPLE_PREPARE_KEYS = new Set(["workerProfileId", "confirm"]);
const ONBOARDING_SAMPLE_SUBMIT_KEYS = new Set(["sampleId", "previewRevisionDigest", "confirm"]);

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
  /** Private owner nonce used only by the authenticated Hub liveness probe. */
  nonce?: string;
  packageRoot?: string;
  /** Owner-only root for disposable guided samples. Required with packageRoot
   *  to enable the first-Task experience; never returned to the browser. */
  sampleRoot?: string;
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
  /** Optional deterministic seam for local Provider authentication evidence.
   *  Production falls back to Keychain + local Grok sign-in inspection. */
  inspectProviderReadiness?: () => {
    anyReady: boolean;
    providers: Record<ProviderName, ProviderReadiness>;
  };
  /** Deterministic, privacy-safe local Codex catalog seam. */
  loadCodexModels?: () => Promise<CodexModelCatalogEntry[]>;
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
  retainedCandidate: RetainedCandidateSection;
  /** Content-free finite same-Worker validation-repair allowance and rounds. */
  validationRepair?: ValidationRepairSection;
  /** Plain-language current verified-delivery stage and next actor. The
   *  browser translates these closed codes only; it never recomputes repair
   *  eligibility or marks work successful. */
  deliveryJourney: DeliveryJourneySection;
  /** Privacy-safe cross-Worker handoff story when this Task is source or successor. */
  candidateHandoff?: CandidateHandoffSection;
  /**
   * Explicit Main attention resolution when the failed/interrupted Task was
   * handled. The machine status, original failure evidence, and delivery truth
   * stay unchanged; this only explains the closed attention and names the one
   * next action (Reopen).
   */
  resolution?: AttentionResolutionSection;
}

/** Privacy-safe closed resolution story for a handled failure. */
export interface AttentionResolutionSection {
  status: "resolved" | "reopened";
  /** Closed reason code Main chose; the browser owns readable copy. */
  reason?: string;
  /** Optional bounded Main-authored explanation of how it was handled. */
  note?: string;
  /** Optional successor/evidence Task id (never a retry). */
  evidenceTaskId?: string;
  resolvedAt?: string;
  reopenedAt?: string;
}

/** Content-free finite validation-repair allowance and round lineage. */
export interface ValidationRepairSection {
  enabled: boolean;
  allowance: {
    max: number;
    consumed: number;
    remaining: number;
    source: "task" | "worker" | "global";
  };
  /** True while a round is authorized but not terminal. */
  inProgress: boolean;
  /** Bounded round facts for progressive technical disclosure. */
  rounds: Array<{
    round: number;
    state: "authorized" | "started" | "terminal";
    terminalOutcome?: "passed" | "failed" | "stopped";
    terminalReason?: string;
    targetAttemptOrdinal?: number;
    authorizationEventSequence?: number;
  }>;
  /** Durable refusals that never consumed a round. */
  skipped: Array<{ reason: string; nextAction?: string }>;
  /** Latest terminal round's stop reason when present. */
  stopReason?: string;
}

/** Plain-language current verified-delivery stage and next actor. */
export interface DeliveryJourneySection {
  stage:
    | "implementing"
    | "worker-finished"
    | "verifying"
    | "repairing"
    | "awaiting-main-review"
    | "main-accepted"
    | "stopped"
    | "queued"
    | "unknown";
  nextActor: "worker" | "verifier" | "main" | "user" | "none";
  /** Present only for the repairing stage. */
  repair?: { round: number; total: number; remaining: number; source: "task" | "worker" | "global" };
  /** Closed stop reason (failure category or repair stop reason) when known. */
  stopReason?: string;
}

interface CandidateHandoffSection {
  role: "source" | "successor";
  status: string;
  originKind?: string;
  competitionId?: string;
  sourceCandidateId?: string;
  goalId?: string;
  itemId?: string;
  sourceTaskId?: string;
  successorTaskId?: string;
  destinationWorkerProfileId?: string;
  destinationProvider?: string;
  destinationModel?: string;
  reusablePathCount: number;
  remainingGapCount: number;
  reusablePaths: string[];
  remainingGaps: Array<{ description: string; acceptanceExpectation: string }>;
  sourceDigestPrefix?: string;
  failureCode?: string;
  nextAction: string;
  /** Explicit: this is not a retry of the source Task. */
  notARetry: true;
}

interface CandidateReverificationSection {
  /** Latest reverification outcome. */
  status: "passed" | "failed" | "no-candidate";
  /** Exact path that produced the outcome. Runtime-workspace means the Worker
   *  ended unexpectedly and its retained files were independently checked. */
  path: "behavior-failure" | "succeeded-repair" | "runtime-workspace";
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
  /** Truthful handoff: false only for the no-candidate outcome (nothing to
   *  accept); true for every non-empty retained Candidate. */
  requiresFreshMainAccept: boolean;
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

type RetainedCandidateSection =
  | { status: "evidence-unavailable" }
  | {
      status: "available";
      /** Exact CandidateRevision id for confirmation-gated handoff/correct. */
      revisionId: string;
      attemptOrdinal: number;
      verificationPassed: boolean;
      filesChanged: number;
      changedLines: number;
      affectedPathCount: number;
      /** Validated relative paths from the canonical revision, capped for UI. */
      affectedPaths: string[];
    };

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

/**
 * Closed presentation state for an Attempt whose raw status is still
 * non-terminal while durable same-Attempt events prove it already ended.
 * Never overwrites the recorded status; display-only evidence.
 */
type AttemptPresentationState =
  | "ended-after-worker-completion"
  | "ended-unsuccessfully";

interface WorkerExecutionSection {
  provider: string;
  model: string;
  runtime: string;
  /** Frozen requested execution preference. Absent on legacy Tasks (single-run). */
  executionPreference?: string;
  /** Frozen resolved execution mode (auto already resolved). */
  executionMode?: string;
  /** Bounded Attempt summaries (max 5, latest first). */
  attempts: Array<{
    ordinal: number;
    status: string;
    /**
     * Optional closed presentation when the parent Task is terminal and
     * ordered same-Attempt events prove this Attempt ended. Raw `status`
     * remains the forensic recorded value.
     */
    presentationState?: AttemptPresentationState;
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
    /** Safe, redacted diagnostic from the first useful stderr/stdout line.
     *  Present only when the check failed and a safe line survived redaction. */
    failureSummary?: string;
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
    /** Optional; absent means original-acceptance (legacy). */
    acceptanceBasis?: "original-acceptance" | "amended-acceptance";
    amendedCommandCount?: number;
    reasonCode?: "contradictory-acceptance";
    checkId?: string;
    createdAt?: string;
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

/** Maximum visible characters in a safe failure summary. */
const FAILURE_SUMMARY_MAX = 240;

/** Home directory path used for absolute-path redaction. */
const HOME_DIR = homedir();

/**
 * Build a bounded, privacy-safe failure summary from one failed verification
 * command. Searches meaningful stderr lines first, then meaningful stdout lines.
 * Strips secrets, ANSI codes, absolute home paths, URL credentials/query secrets,
 * prompt/system/user text, stack traces, and unbounded noise.
 * Returns undefined when no safe line remains after redaction.
 */
export function buildSafeFailureSummary(
  command: Record<string, unknown>,
): string | undefined {
  const rawStderr = typeof command.stderr === "string" ? command.stderr : "";
  const rawStdout = typeof command.stdout === "string" ? command.stdout : "";

  // Search stderr first, then stdout, for the first useful line.
  for (const source of [rawStderr, rawStdout]) {
    if (source.length === 0) continue;
    const lines = source.split(/\r?\n/);
    for (const line of lines) {
      let cleaned = line.trim();
      if (cleaned.length === 0) continue;

      // Strip ANSI escape / control sequences.
      cleaned = cleaned
        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
        .trim();
      if (cleaned.length === 0) continue;

      // A verifier workspace path is useful only from the changed project
      // file onward. Drop the private run root while keeping file + line.
      cleaned = cleaned.replace(
        /^.*\/ForkLight\/runs\/[^/]+\/workspace\//,
        "",
      );

      // Redact absolute home paths.
      cleaned = cleaned.replaceAll(HOME_DIR, "[home]");

      // Redact secret-like values: API keys, tokens, credentials.
      cleaned = cleaned
        .replace(
          /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|API[_-]?KEY)[A-Z0-9_]*)=(?:"[^"]*"|'[^']*'|\S+)/gi,
          "$1=[redacted]",
        )
        .replace(
          /\b(?:sk-[A-Za-z0-9_-]{8,}|(?:secret|token|password|api[_-]?key)[_:=\-]?[A-Za-z0-9_-]{4,})\b/gi,
          "[redacted]",
        );

      // Redact URLs with userinfo credentials or secret query parameters.
      cleaned = cleaned.replace(
        /\bhttps?:\/\/[^:@/\s]+:[^@/\s]+@/gi,
        "https://[redacted]@",
      );
      cleaned = cleaned.replace(
        /\b(https?:\/\/[^\s]*[?&](?:token|key|secret|password|auth|api[_-]?key|access_token|refresh_token|client_secret|private_key)=[^&\s]+)/gi,
        "[redacted-url]",
      );

      // Skip noise: stack traces, log prefixes, prompt/system/user content.
      const noisePrefixes = [
        "at ", "    at ", "Traceback", "  File ",
        "node:", "npm ERR!", "WARN ", "INFO ", "DEBUG ",
        "TRACE ", "FATAL ",
      ];
      if (noisePrefixes.some((prefix) => cleaned.startsWith(prefix))) continue;

      // Skip command/test harness wrappers so the first visible sentence is
      // the concrete failing file, assertion, or parser diagnostic.
      if (/^[\^~|`'"-]+$/.test(cleaned)) continue;
      if (/^>\s+\S+@\S+\s+\S+\s*$/.test(cleaned)) continue;
      if (/^>\s+(?:npm|node|npx|pnpm|yarn|tsx|tsc|eslint|vitest|jest)\b/i.test(cleaned)) continue;
      if (/^(?:triggerUncaughtException|processTicksAndRejections)\s*\(?$/i.test(cleaned)) continue;
      if (/^Error:\s*(?:Transform|Build|Command|Process|Tests?) failed\b/i.test(cleaned)) continue;

      // Skip prompt-like content: system prompt, user instruction, assistant prefill.
      if (/^(?:System|User|Assistant|Human|AI|Bot)\s*:/i.test(cleaned)) continue;
      // Skip log-level prefixed noise that evades the prefix check.
      if (/^\[(?:WARN|INFO|DEBUG|TRACE|ERROR)\]/i.test(cleaned)) continue;

      // Truncate to maximum length.
      if (cleaned.length > FAILURE_SUMMARY_MAX) {
        cleaned = cleaned.slice(0, FAILURE_SUMMARY_MAX - 3) + "...";
      }

      return cleaned.length > 0 ? cleaned : undefined;
    }
  }

  return undefined;
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

  // Durable events bind presentation evidence to exact Attempt ids. Summary
  // and payload text are never read for this projection.
  const inspectEvents = Array.isArray(inspect.events)
    ? inspect.events as Array<Record<string, unknown>>
    : [];
  const parentTaskStatus = String(rawTask.status ?? "unknown");
  const attempts = buildBoundedAttempts(inspectAttempts, inspectEvents, parentTaskStatus);

  // Latest explicit Main correction: this is the bounded Main -> Worker input
  // and its factual incremental outcome. It never estimates a hypothetical
  // from-scratch retry or claims unmeasured savings.
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
    ...(typeof spec.executionPreference === "string"
      ? { executionPreference: spec.executionPreference }
      : {}),
    ...(typeof spec.executionMode === "string"
      ? { executionMode: spec.executionMode }
      : {}),
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
    const status = rv.status === "passed" || rv.status === "failed" || rv.status === "no-candidate"
      ? rv.status
      : undefined;
    const path = rv.path === "behavior-failure" || rv.path === "succeeded-repair"
      || rv.path === "runtime-workspace"
      ? rv.path
      : undefined;
    const attemptId = typeof rv.attemptId === "string" && rv.attemptId.length > 0
      ? rv.attemptId
      : undefined;
    const attemptStatus = rv.attemptStatus === "succeeded" || rv.attemptStatus === "failed"
      || rv.attemptStatus === "interrupted"
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
    // No-candidate outcomes truthfully report that no fresh Main acceptance is
    // possible; every non-empty retained Candidate still requires one.
    const validExactFacts = rv.workerInvoked === false
      && rv.incrementalWorkerTokens === 0
      && rv.incrementalModelRuntimeCostUsd === 0
      && (status === "no-candidate"
        ? rv.requiresFreshMainAccept === false
        : rv.requiresFreshMainAccept === true);
    if (
      status !== undefined && path !== undefined
      && attemptId !== undefined && attemptStatus !== undefined
      && verificationEventSequence !== undefined
      && validAllowance && validCounts && validExactFacts
    ) {
      candidateReverification = {
        status,
        path,
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
        requiresFreshMainAccept: rv.requiresFreshMainAccept === true,
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
      const passed = cmd.exitCode === 0;
      const entry: VerificationSection["checks"][number] = {
        label: label || "check",
        passed,
        ...(exitCode === undefined ? {} : { exitCode }),
      };
      // Build a safe failure summary only for failed commands that have
      // redactable stderr/stdout evidence.
      if (!passed) {
        const summary = buildSafeFailureSummary(cmd);
        if (summary !== undefined) entry.failureSummary = summary;
      }
      verifChecks.push(entry);
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
    ? {
        status: "verified-repaired-delivered" as const,
        ...(disp.acceptanceBasis === "amended-acceptance"
          || disp.acceptanceBasis === "original-acceptance"
          ? { acceptanceBasis: disp.acceptanceBasis as "original-acceptance" | "amended-acceptance" }
          : {}),
        ...(typeof disp.amendedCommandCount === "number"
          && Number.isSafeInteger(disp.amendedCommandCount)
          && disp.amendedCommandCount >= 1
          ? { amendedCommandCount: disp.amendedCommandCount }
          : {}),
        ...(disp.reasonCode === "contradictory-acceptance"
          ? { reasonCode: "contradictory-acceptance" as const }
          : {}),
        ...(typeof disp.checkId === "string" ? { checkId: disp.checkId } : {}),
        ...(typeof disp.createdAt === "string" ? { createdAt: disp.createdAt } : {}),
      }
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
  const taskStatus = parentTaskStatus;
  const failureCategory = typeof d.failureCategory === "string" ? d.failureCategory : undefined;
  const { what, why, category } = resolveCause(taskStatus, failureCategory, verifAvail, verifPassed);

  const cause: CauseSection = {
    what,
    why,
    ...(category === undefined ? {} : { failureCategory: category }),
  };

  // --- Explicit Main attention resolution (how the failure was handled) ---
  // The daemon Core owns the validated projection; the Hub only re-shapes the
  // closed codes into a readable story. Never recomputes lifecycle semantics.
  // Only failed/interrupted Tasks can carry a resolution story; forged evidence
  // on other statuses fails open to no resolution.
  const rawResolution = (taskStatus === "failed" || taskStatus === "interrupted")
    ? inspect.attentionResolution
    : undefined;
  let resolution: AttentionResolutionSection | undefined;
  if (
    rawResolution !== null
    && typeof rawResolution === "object"
    && !Array.isArray(rawResolution)
  ) {
    const r = rawResolution as Record<string, unknown>;
    const resolutionStatus = r.status === "resolved" || r.status === "reopened"
      ? r.status
      : undefined;
    const resolutionNote = typeof r.note === "string" && r.note.length > 0
      ? truncate(r.note, 500)
      : undefined;
    if (resolutionStatus !== undefined) {
      resolution = {
        status: resolutionStatus,
        ...(resolutionNote === undefined ? {} : { note: resolutionNote }),
        ...(typeof r.reason === "string"
          && (TASK_RESOLUTION_REASONS as readonly string[]).includes(r.reason)
          ? { reason: r.reason }
          : {}),
        ...(typeof r.evidenceTaskId === "string" && r.evidenceTaskId.length > 0
          ? { evidenceTaskId: truncate(r.evidenceTaskId, 100) }
          : {}),
        ...(typeof r.resolvedAt === "string" && r.resolvedAt.length > 0
          ? { resolvedAt: r.resolvedAt }
          : {}),
        ...(typeof r.reopenedAt === "string" && r.reopenedAt.length > 0
          ? { reopenedAt: r.reopenedAt }
          : {}),
      };
    }
  }

  // --- Next Action ---
  const nextLabel = resolveNextAction(
    taskStatus,
    failureCategory,
    verifAvail,
    verifPassed,
    mainReview,
    remediationDisposition,
    integration,
    resolution,
  );

  const nextAction: NextActionSection = {
    label: nextLabel,
  };

  const retainedCandidate = buildRetainedCandidateSection(rawTask, inspectEvents);

  // Finite same-Worker validation-repair projection from the daemon's canonical
  // decision view. The browser translates closed codes; it never recomputes
  // eligibility, allowance, or round counts.
  const validationRepair = buildSafeValidationRepairSection(d.validationRepair);
  const liveStageRaw = (d.progress as Record<string, unknown> | undefined)?.liveStage;
  const liveStageStage = liveStageRaw !== null && typeof liveStageRaw === "object"
    ? (liveStageRaw as { stage?: unknown }).stage
    : undefined;
  const deliveryJourney = buildDeliveryJourneySection({
    taskStatus,
    ...(mainReview === undefined ? {} : { mainReview }),
    ...(validationRepair === undefined ? {} : { validationRepair }),
    ...(failureCategory === undefined ? {} : { failureCategory }),
    ...(typeof liveStageStage === "string" ? { liveStageStage } : {}),
  });

  // Cross-Worker handoff projection from durable events only (no private paths).
  let candidateHandoff: CandidateHandoffSection | undefined;
  const handoffAuthorized = inspectEvents
    .filter((event) => event.type === "candidate.handoff.authorized")
    .at(-1);
  const handoffPrepared = inspectEvents
    .filter((event) => event.type === "candidate.handoff.prepared")
    .at(-1);
  const handoffFailed = inspectEvents
    .filter((event) => event.type === "candidate.handoff.failed")
    .at(-1);
  const handoffEvent = handoffFailed ?? handoffPrepared ?? handoffAuthorized;
  if (handoffEvent !== undefined) {
    const payload = (handoffEvent.payload ?? {}) as Record<string, unknown>;
    const identity = (payload.destinationIdentity ?? {}) as Record<string, unknown>;
    const isSuccessor = payload.isSuccessor === true;
    const status = handoffFailed !== undefined
      ? "failed"
      : handoffPrepared !== undefined
        ? "prepared"
        : "authorized";
    const reusablePaths = Array.isArray(payload.reusablePaths)
      ? (payload.reusablePaths as unknown[])
          .filter((p): p is string => typeof p === "string")
          .slice(0, 20)
      : [];
    const remainingGaps = Array.isArray(payload.remainingGaps)
      ? (payload.remainingGaps as unknown[])
          .filter((g): g is Record<string, unknown> => g !== null && typeof g === "object")
          .slice(0, 8)
          .map((g) => ({
            description: truncate(String(g.description ?? ""), 500),
            acceptanceExpectation: truncate(String(g.acceptanceExpectation ?? ""), 500),
          }))
      : [];
    candidateHandoff = {
      role: isSuccessor ? "successor" : "source",
      status,
      ...(typeof payload.originKind === "string" ? { originKind: payload.originKind } : {}),
      ...(typeof payload.competitionId === "string"
        ? { competitionId: payload.competitionId }
        : {}),
      ...(typeof payload.sourceCandidateId === "string"
        ? { sourceCandidateId: payload.sourceCandidateId }
        : {}),
      ...(typeof payload.goalId === "string" ? { goalId: payload.goalId } : {}),
      ...(typeof payload.itemId === "string" ? { itemId: payload.itemId } : {}),
      ...(typeof payload.sourceTaskId === "string" ? { sourceTaskId: payload.sourceTaskId } : {}),
      ...(typeof payload.successorTaskId === "string"
        ? { successorTaskId: payload.successorTaskId }
        : {}),
      ...(typeof payload.destinationWorkerProfileId === "string"
        ? { destinationWorkerProfileId: payload.destinationWorkerProfileId }
        : {}),
      ...(typeof identity.provider === "string" ? { destinationProvider: identity.provider } : {}),
      ...(typeof identity.model === "string" ? { destinationModel: identity.model } : {}),
      reusablePathCount: typeof payload.reusablePathCount === "number"
        ? payload.reusablePathCount
        : reusablePaths.length,
      remainingGapCount: typeof payload.remainingGapCount === "number"
        ? payload.remainingGapCount
        : remainingGaps.length,
      reusablePaths,
      remainingGaps,
      ...(typeof payload.sourceDigestPrefix === "string"
        ? { sourceDigestPrefix: payload.sourceDigestPrefix }
        : {}),
      ...(typeof payload.failureCode === "string" ? { failureCode: payload.failureCode } : {}),
      nextAction: typeof payload.nextAction === "string"
        ? payload.nextAction
        : status === "failed"
          ? "inspect-failure"
          : "wait-for-successor",
      notARetry: true,
    };
  }

  return {
    assignment,
    workerExecution,
    independentVerification,
    finalDelivery,
    cause,
    nextAction,
    retainedCandidate,
    ...(validationRepair === undefined ? {} : { validationRepair }),
    deliveryJourney,
    ...(candidateReuse === undefined ? {} : { candidateReuse }),
    ...(candidateReverification === undefined ? {} : { candidateReverification }),
    ...(candidateHandoff === undefined ? {} : { candidateHandoff }),
    ...(resolution === undefined ? {} : { resolution }),
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

/** Transport bound for ordinary Task Detail activity rows. */
export const TASK_ACTIVITY_TRANSPORT_BOUND = 80;

/**
 * One privacy-safe activity row for ordinary Hub Task Detail consumption.
 * Payload is never included; raw inspect remains the authoritative event path.
 */
export interface SafeActivityEvent {
  timestamp: string;
  type: string;
  summary: string;
  /** Closed presentation hint derived from a safe event payload. The raw
   *  payload is never transported to ordinary Task Detail. */
  presentationCode?: "integration-patch-not-applicable";
}

/**
 * Project bounded lifecycle milestones for ordinary Task Detail activity.
 *
 * Filters Worker narrative/thinking text fragments (`worker.message`) before
 * applying the last-N transport bound so token-sized stream deltas cannot
 * crowd out verification, failure, resume, Candidate capture, or remediation
 * landmarks. Deterministic and read-only: does not mutate the source array,
 * does not concatenate text deltas, and does not parse free-form summaries.
 */
export function projectTaskActivityTimeline(
  events: ReadonlyArray<{
    timestamp?: unknown;
    type?: unknown;
    summary?: unknown;
    payload?: unknown;
  }>,
  bound: number = TASK_ACTIVITY_TRANSPORT_BOUND,
): SafeActivityEvent[] {
  if (!Array.isArray(events)) return [];
  const limit = Number.isFinite(bound) ? Math.min(Math.max(0, Math.floor(bound)), TASK_ACTIVITY_TRANSPORT_BOUND) : 0;
  if (limit === 0) return [];

  // Narrow exclusion: only streaming narrative fragments. Future lifecycle
  // types stay visible (possibly as "Other activity") rather than hidden by a
  // broad allowlist.
  const milestones: SafeActivityEvent[] = [];
  for (const event of events) {
    const type = typeof event?.type === "string" ? event.type : "";
    if (!type || type === "worker.message") continue;
    const payload = event.payload !== null
      && typeof event.payload === "object"
      && !Array.isArray(event.payload)
      ? event.payload as Record<string, unknown>
      : undefined;
    const issue = payload?.applicabilityIssue !== null
      && typeof payload?.applicabilityIssue === "object"
      && !Array.isArray(payload.applicabilityIssue)
      ? payload.applicabilityIssue as Record<string, unknown>
      : undefined;
    const presentationCode = type === "integration.preflight.completed"
      && issue?.code === "patch-not-applicable"
      ? "integration-patch-not-applicable" as const
      : undefined;
    // Fail closed for non-string timestamp/summary: never String() or
    // toString coercion that could execute hostile object methods.
    milestones.push({
      timestamp: typeof event.timestamp === "string" ? event.timestamp : "",
      type,
      summary: typeof event.summary === "string" ? event.summary : "",
      ...(presentationCode === undefined ? {} : { presentationCode }),
    });
  }
  return milestones.slice(-limit);
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

/**
 * Project only evidence that the canonical CandidateRevision still matches the
 * Task's exact retained Diff. Task status, changed-file observations, Main
 * review, and Worker claims are deliberately not treated as proof.
 */
function buildRetainedCandidateSection(
  rawTask: Record<string, unknown>,
  inspectEvents: Array<Record<string, unknown>>,
): RetainedCandidateSection {
  const revision = resolveLatestRevision(inspectEvents as unknown as EventRecord[]);
  if (
    revision === undefined
    || typeof rawTask.id !== "string"
    || revision.taskId !== rawTask.id
    || !candidateRevisionMatchesCurrentDiff(rawTask as unknown as TaskRecord, revision)
  ) {
    return { status: "evidence-unavailable" };
  }
  return {
    status: "available",
    revisionId: revision.id,
    attemptOrdinal: revision.attemptOrdinal,
    verificationPassed: revision.verificationPassed,
    filesChanged: revision.filesChanged,
    changedLines: revision.changedLines,
    affectedPathCount: revision.affectedPaths.length,
    affectedPaths: revision.affectedPaths.slice(0, 40),
  };
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" ? record[key] as string : undefined;
}

function isTerminalTaskStatus(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "interrupted";
}

function isTerminalAttemptStatus(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "interrupted";
}

/**
 * Derive a closed display-only presentation for an Attempt whose raw status is
 * still non-terminal. Requires a terminal parent Task and ordered same-Attempt
 * durable event types. Summary/payload text is never inspected.
 */
function deriveAttemptPresentationState(
  attemptId: unknown,
  rawStatus: string,
  parentStatus: string,
  events: Array<Record<string, unknown>>,
): AttemptPresentationState | undefined {
  if (!isTerminalTaskStatus(parentStatus)) return undefined;
  if (isTerminalAttemptStatus(rawStatus)) return undefined;
  if (typeof attemptId !== "string" || attemptId.length === 0) return undefined;

  const ordered = events
    .filter((event) => {
      if (event.attemptId !== attemptId) return false;
      if (event.type !== "worker.completed" && event.type !== "worker.failed") return false;
      return typeof event.sequence === "number" && Number.isSafeInteger(event.sequence);
    })
    .map((event) => ({
      type: event.type as "worker.completed" | "worker.failed",
      sequence: event.sequence as number,
    }))
    .sort((a, b) => a.sequence - b.sequence);

  let sawCompleted = false;
  let sawFailed = false;
  let failedAfterCompleted = false;
  for (const event of ordered) {
    if (event.type === "worker.completed") sawCompleted = true;
    if (event.type === "worker.failed") {
      sawFailed = true;
      if (sawCompleted) failedAfterCompleted = true;
    }
  }
  if (!sawFailed) return undefined;
  return failedAfterCompleted
    ? "ended-after-worker-completion"
    : "ended-unsuccessfully";
}

function buildBoundedAttempts(
  records: Array<Record<string, unknown>>,
  events: Array<Record<string, unknown>>,
  parentStatus: string,
): WorkerExecutionSection["attempts"] {
  return records
    .slice(-5)
    .reverse()
    .map((attempt) => {
      const startedAt = optionalString(attempt, "startedAt");
      const finishedAt = optionalString(attempt, "finishedAt");
      const status = truncate(String(attempt.status ?? "unknown"), 24);
      const presentationState = deriveAttemptPresentationState(
        attempt.id,
        status,
        parentStatus,
        events,
      );
      return {
        ordinal: Number.isSafeInteger(attempt.ordinal) ? attempt.ordinal as number : 0,
        status,
        ...(presentationState === undefined ? {} : { presentationState }),
        ...(startedAt === undefined ? {} : { startedAt }),
        ...(finishedAt === undefined ? {} : { finishedAt }),
        ...(Number.isSafeInteger(attempt.exitCode) ? { exitCode: attempt.exitCode as number } : {}),
        ...(Number.isSafeInteger(attempt.turns) ? { turns: attempt.turns as number } : {}),
        ...(typeof attempt.costUsd === "number" && Number.isFinite(attempt.costUsd)
          ? { costUsd: attempt.costUsd } : {}),
      };
    });
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Project the content-free validation-repair section from the daemon's
 *  canonical TaskDecisionView.validationRepair. The browser owns readable
 *  copy; this layer only bounds and forwards the closed codes. */
function buildSafeValidationRepairSection(
  rawValidationRepair: unknown,
): ValidationRepairSection | undefined {
  if (
    rawValidationRepair === null || typeof rawValidationRepair !== "object"
    || Array.isArray(rawValidationRepair)
  ) {
    return undefined;
  }
  const v = rawValidationRepair as Record<string, unknown>;
  const rawAllowance = v.allowance;
  if (rawAllowance === null || typeof rawAllowance !== "object" || Array.isArray(rawAllowance)) {
    return undefined;
  }
  const allowance = rawAllowance as Record<string, unknown>;
  const max = isNonNegativeInteger(allowance.max) ? allowance.max : undefined;
  const consumed = isNonNegativeInteger(allowance.consumed) ? allowance.consumed : undefined;
  const remaining = isNonNegativeInteger(allowance.remaining) ? allowance.remaining : undefined;
  const source = allowance.source === "task" || allowance.source === "worker"
    || allowance.source === "global"
    ? allowance.source as "task" | "worker" | "global"
    : undefined;
  // Malformed allowance evidence fails closed: never invent a zero value, a
  // recomputed remaining count, or a provenance that was not recorded.
  if (
    max === undefined || consumed === undefined || remaining === undefined
    || source === undefined
    || consumed > max
    || remaining !== Math.max(0, max - consumed)
  ) {
    return undefined;
  }
  const rounds: ValidationRepairSection["rounds"] = [];
  if (Array.isArray(v.rounds)) {
    for (const entry of v.rounds) {
      if (entry === null || typeof entry !== "object") continue;
      const r = entry as Record<string, unknown>;
      if (!isNonNegativeInteger(r.round) || r.round < 1) continue;
      if (r.state !== "authorized" && r.state !== "started" && r.state !== "terminal") continue;
      rounds.push({
        round: r.round,
        state: r.state as "authorized" | "started" | "terminal",
        ...(r.terminalOutcome === "passed" || r.terminalOutcome === "failed"
          || r.terminalOutcome === "stopped"
          ? { terminalOutcome: r.terminalOutcome as "passed" | "failed" | "stopped" }
          : {}),
        ...(typeof r.terminalReason === "string" && r.terminalReason.length > 0
          ? { terminalReason: r.terminalReason }
          : {}),
        ...(isNonNegativeInteger(r.targetAttemptOrdinal) && r.targetAttemptOrdinal > 0
          ? { targetAttemptOrdinal: r.targetAttemptOrdinal }
          : {}),
        ...(isNonNegativeInteger(r.authorizationEventSequence) && r.authorizationEventSequence > 0
          ? { authorizationEventSequence: r.authorizationEventSequence }
          : {}),
      });
    }
  }
  const skipped: ValidationRepairSection["skipped"] = [];
  if (Array.isArray(v.skipped)) {
    for (const entry of v.skipped) {
      if (entry === null || typeof entry !== "object") continue;
      const reason = (entry as Record<string, unknown>).reason;
      if (typeof reason !== "string" || reason.length === 0) continue;
      const nextAction = (entry as Record<string, unknown>).nextAction;
      skipped.push({
        reason,
        ...(typeof nextAction === "string" && nextAction.length > 0 ? { nextAction } : {}),
      });
    }
  }
  return {
    enabled: max > 0,
    allowance: { max, consumed, remaining, source },
    inProgress: v.inProgress === true,
    rounds,
    skipped,
    ...(typeof v.stopReason === "string" && v.stopReason.length > 0
      ? { stopReason: v.stopReason }
      : {}),
  };
}

/** Plain-language current verified-delivery stage and next actor from canonical
 *  server facts. Never invents a stage: every branch is backed by durable Task
 *  status, verification, review, or repair evidence. */
function buildDeliveryJourneySection(input: {
  taskStatus: string;
  mainReview?: { decision: string; reason: string };
  validationRepair?: ValidationRepairSection;
  failureCategory?: string;
  liveStageStage?: string;
}): DeliveryJourneySection {
  const repair = input.validationRepair;
  if (repair?.inProgress) {
    const activeRound = repair.rounds.find((round) => round.state !== "terminal");
    return {
      stage: "repairing",
      nextActor: "worker",
      repair: {
        round: activeRound?.round ?? repair.allowance.consumed + 1,
        total: repair.allowance.max,
        remaining: repair.allowance.remaining,
        source: repair.allowance.source,
      },
    };
  }
  const status = input.taskStatus;
  if (status === "queued" || status === "waiting" || status === "blocked" || status === "pending") {
    return { stage: "queued", nextActor: "none" };
  }
  if (status === "preparing" || status === "running" || status === "active") {
    // The evidence-backed live stage disambiguates independent verification /
    // a finished Worker even when the Task status lags the durable sequence.
    if (input.liveStageStage === "verifying") {
      return { stage: "verifying", nextActor: "verifier" };
    }
    if (input.liveStageStage === "worker-finished") {
      // Worker completion is unverified evidence: it proves the Worker
      // reported done, not that any self-check passed. Closed truth below.
      return { stage: "worker-finished", nextActor: "verifier" };
    }
    return { stage: "implementing", nextActor: "worker" };
  }
  if (status === "verifying") {
    return { stage: "verifying", nextActor: "verifier" };
  }
  if (status === "succeeded") {
    const decision = input.mainReview?.decision;
    if (decision === "accept") return { stage: "main-accepted", nextActor: "user" };
    if (decision === "reject") return { stage: "stopped", nextActor: "main" };
    if (decision === "revise") return { stage: "awaiting-main-review", nextActor: "main" };
    return { stage: "awaiting-main-review", nextActor: "main" };
  }
  if (status === "failed" || status === "interrupted") {
    const stopReason = repair?.stopReason ?? input.failureCategory;
    return {
      stage: "stopped",
      nextActor: "main",
      ...(stopReason === undefined ? {} : { stopReason }),
    };
  }
  return { stage: "unknown", nextActor: "none" };
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
  if (failureCategory === "connectivity") {
    return {
      what: "failed",
      why: "the Worker could not reach the Provider service over the network; a working interactive TUI can still coexist with a failing Daemon Worker because their network environments may differ — this is infrastructure connectivity, not model quality",
      category: "connectivity",
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
  resolution?: AttentionResolutionSection,
): string {
  // Delivered outcomes win over an attention resolution: a Task that reached
  // verified delivery is done, never "reopen". A plain handled failure has
  // the one next action Reopen; the machine status stays failed/interrupted
  // and is never called success.
  if (remediationDisposition?.status === "verified-repaired-delivered") return "done";
  if (integration?.applied) return "done";
  if (resolution?.status === "resolved") return "reopen";
  if (mainReview?.decision === "accept") return "ready-to-integrate";
  if (mainReview?.decision === "revise") return "revise";
  if (mainReview?.decision === "reject") return "stopped";
  if (status === "succeeded" || (verifAvail && verifPassed)) return "review";
  if (status === "running" || status === "preparing" || status === "verifying" || status === "active") return "wait";
  if (status === "queued" || status === "pending" || status === "waiting") return "wait";
  if (failureCategory === "authentication") return "credentials";
  if (failureCategory === "budget") return "budget";
  if (failureCategory === "runtime") return "runtime";
  // Connectivity: check Daemon network environment; do not blame model quality.
  if (failureCategory === "connectivity") return "connectivity";
  // Contract-infeasible: return control to Main to revise the contract, not retry.
  if (failureCategory === "contract-infeasible") return "revise-contract";
  return "investigate";
}

export class HubServer {
  private server: ReturnType<typeof createServer> | undefined;
  private actualPort = 0;
  private stopPromise: Promise<void> | undefined;
  private readonly token: string;
  private readonly nonce: string;
  private readonly cache: HubEvidenceCache;
  private readonly onboardingSamples: OnboardingSampleService | undefined;

  constructor(private readonly deps: HubServerDeps) {
    this.token = randomBytes(32).toString("base64url");
    this.nonce = deps.nonce ?? randomBytes(18).toString("base64url");
    this.cache = deps.cache ?? new HubEvidenceCache();
    this.onboardingSamples = deps.packageRoot === undefined || deps.sampleRoot === undefined
      ? undefined
      : new OnboardingSampleService(deps.packageRoot, deps.sampleRoot);
  }

  private async resolveCurrentWorkerReadiness(): Promise<ReturnType<typeof resolveWorkerReadiness>> {
    const settings = this.deps.settings.get();
    const localProviders = this.deps.inspectProviderReadiness?.()
      ?? providerReadiness(settings.providerDefaults);
    const daemon = await this.probeDaemonStatus();
    const daemonEvidence: DaemonHealthEvidence = {
      ok: daemon.running === true && daemon.ok !== false,
      serverIdentity: daemon.buildIdentity,
      result: daemon,
    };
    const executionFacts = resolveExecutionProviderFacts({
      clientBuildIdentity: currentBuildIdentity(),
      daemonEvidence,
      localProviders: providerNames().map((name) => {
        const provider = localProviders.providers[name];
        return {
          name,
          label: providerLabel(name),
          configured: provider.ready,
          ready: provider.ready,
          authMode: provider.authMode,
          defaultModel: provider.defaultModel,
        };
      }),
    });
    const providers = projectExecutionProviderReadiness(
      executionFacts.providers,
      localProviders.providers,
    );
    const localRuntimeDoctors: Partial<Record<RuntimeName, { ok: boolean }>> = {};
    for (const adapter of listWorkerAdapters()) {
      const doctor = adapter.doctor();
      if (doctor instanceof Promise) continue;
      localRuntimeDoctors[adapter.name] = { ok: doctor.ok };
    }
    const runtimeFacts = resolveExecutionRuntimeFacts({
      clientBuildIdentity: currentBuildIdentity(),
      daemonEvidence,
      localRuntimes: SUPPORTED_RUNTIME_NAMES.map((name) => ({
        name,
        ok: localRuntimeDoctors[name]?.ok ?? false,
      })),
    });
    return resolveWorkerReadiness({
      workerProfiles: settings.workerProfiles,
      modelCatalog: settings.modelCatalog,
      providerDefaults: settings.providerDefaults,
      providers: providers.providers,
      runtimes: runtimeFacts.runtimes,
    });
  }

  private safeSampleProjection(
    sample: PreparedOnboardingSample,
    preview?: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      available: true,
      state: sample.state,
      sampleId: sample.sampleId,
      workerProfileId: sample.workerProfileId,
      ...(sample.taskId === undefined ? {} : { taskId: sample.taskId }),
      ...(preview === undefined ? {} : { preview }),
    };
  }

  /** Test seam: the Hub's bounded evidence cache. */
  getCache(): HubEvidenceCache {
    return this.cache;
  }

  getToken(): string {
    return this.token;
  }

  getNonce(): string {
    return this.nonce;
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
    if (this.stopPromise !== undefined) return this.stopPromise;
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    this.actualPort = 0;
    this.stopPromise = new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      // Call these after close() begins so no new connection can race the
      // cleanup. A concurrent stop awaits this same promise.
      server.closeIdleConnections();
      server.closeAllConnections();
    }).finally(() => { this.stopPromise = undefined; });
    return this.stopPromise;
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

    // A second local CLI invocation uses this authenticated, bounded response
    // to prove that the descriptor names the exact active ForkLight Hub.
    if (route === "/api/liveness" && (req.method === "GET" || req.method === "HEAD")) {
      if (!this.authenticate(req)) {
        this.sendJson(req, res, 401, { error: "Unauthorized" });
        return;
      }
      this.sendJson(req, res, 200, { ok: true, nonce: this.nonce });
      return;
    }

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
        const localProviderReadiness = this.deps.inspectProviderReadiness?.()
          ?? providerReadiness(settings.providerDefaults);
        const localRuntimeDoctors: Partial<Record<RuntimeName, { ok: boolean }>> = {};
        const localRuntimeDisplay: Partial<Record<RuntimeName, RuntimeDisplayMetadata>> = {};
        for (const adapter of listWorkerAdapters()) {
          const doctor = adapter.doctor();
          if (doctor instanceof Promise) continue;
          localRuntimeDoctors[adapter.name] = { ok: doctor.ok };
          localRuntimeDisplay[adapter.name] = {
            displayName: adapter.displayName,
            executable: adapter.defaultExecutable,
            ...(doctor.version === undefined ? {} : { version: doctor.version }),
            issues: doctor.issues,
            capabilities: adapter.capabilities(),
          };
        }
        // Probe only — do not auto-start here so Hub stop control stays sticky.
        const daemon = await this.probeDaemonStatus();
        const daemonEvidence: DaemonHealthEvidence = {
          ok: daemon.running === true && daemon.ok !== false,
          serverIdentity: daemon.buildIdentity,
          result: daemon,
        };
        const executionFacts = resolveExecutionProviderFacts({
          clientBuildIdentity: currentBuildIdentity(),
          daemonEvidence,
          localProviders: providerNames().map((name) => ({
            name,
            label: providerLabel(name),
            configured: localProviderReadiness.providers[name].ready,
            ready: localProviderReadiness.providers[name].ready,
            authMode: localProviderReadiness.providers[name].authMode,
            defaultModel: localProviderReadiness.providers[name].defaultModel,
          })),
        });
        const runtimeFacts = resolveExecutionRuntimeFacts({
          clientBuildIdentity: currentBuildIdentity(),
          daemonEvidence,
          localRuntimes: SUPPORTED_RUNTIME_NAMES.map((name) => ({
            name,
            ok: localRuntimeDoctors[name]?.ok ?? false,
          })),
        });
        const runtimes = projectExecutionRuntimeDisplay(runtimeFacts, localRuntimeDisplay);
        const effectiveProviderReadiness = projectExecutionProviderReadiness(
          executionFacts.providers,
          localProviderReadiness.providers,
        );
        const providers = this.deps.setup.describeProviders().map((provider) => ({
          ...provider,
          configured: effectiveProviderReadiness.providers[provider.name].ready,
          authMode: effectiveProviderReadiness.providers[provider.name].authMode,
        }));
        const verification = (
          daemon.providerVerification !== null
          && typeof daemon.providerVerification === "object"
          && !Array.isArray(daemon.providerVerification)
        )
          ? daemon.providerVerification as Partial<Record<ProviderName, ProviderVerificationEvidence>>
          : undefined;
        const workerReadiness = resolveWorkerReadiness({
          workerProfiles: settings.workerProfiles,
          modelCatalog: settings.modelCatalog,
          providerDefaults: settings.providerDefaults,
          providers: effectiveProviderReadiness.providers,
          runtimes: runtimeFacts.runtimes,
          ...(verification === undefined ? {} : { providerVerification: verification }),
        });
        const mains = await listMainSurfaceStatus(
          undefined,
          this.deps.packageRoot,
        );
        const versionJourney = this.buildVersionJourney(daemon);
        return {
          settings: viewHubSettings(settings),
          modelCatalog: settings.modelCatalog,
          workerProfiles: settings.workerProfiles,
          workerReadiness,
          modelRouting: viewModelRoutingSettings(settings),
          prerequisites: prereqs,
          providers,
          providerReadinessSource: executionFacts.source,
          providerReadinessSourceDetail: executionFacts.sourceDetail,
          runtimeReadinessSource: runtimeFacts.source,
          runtimeReadinessSourceDetail: runtimeFacts.sourceDetail,
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
      if (provider === "openai") {
        this.sendJson(req, res, 422, {
          error: "Codex Workers use the local Codex sign-in; do not store an OpenAI API key here",
        });
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

    if (route === "/api/codex-model-catalog" && req.method === "POST") {
      const body = await this.readBody(req);
      if (!body || body.action !== "import") {
        this.sendJson(req, res, 422, { error: "action must be import" });
        return;
      }
      try {
        const entries = await (this.deps.loadCodexModels ?? loadLocalCodexModelCatalog)();
        let next = this.deps.settings.get().modelCatalog;
        for (const entry of entries) {
          next = upsertModelConfig(next, codexModelConfigFromEntry(entry));
        }
        const updated = this.deps.settings.update({ modelCatalog: next });
        this.cache.invalidate("setupStatus");
        this.cache.invalidate("opsHealth");
        this.sendJson(req, res, 200, {
          ok: true,
          imported: entries.length,
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
          const rawProfile = (body.profile ?? body) as Record<string, unknown>;
          // The Hub defaults newly created Workers to `auto` execution so a
          // non-expert never learns protocol vocabulary to choose. Editing an
          // existing legacy profile (no field) preserves its single-run
          // behavior — the field is only added for genuinely new Workers.
          const isNew = typeof rawProfile.id === "string"
            && !current.profiles.some((profile) => profile.id === rawProfile.id);
          const profile = validateWorkerProfile(
            {
              ...rawProfile,
              ...(isNew && rawProfile.executionPreference === undefined
                ? { executionPreference: "auto" }
                : {}),
            },
            "workerProfile",
            catalog,
          );
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
        globalDefaults.maxWorkerValidationRepairs = currentSettings.execution.maxWorkerValidationRepairs;
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

        // --- Contract Quality preview ---
        let existingQuality: ContractQualityOverrides | undefined;
        if (body.existingContractQuality !== undefined) {
          existingQuality = validateContractQualityOverride(
            body.existingContractQuality,
            "existingContractQuality",
          );
        }
        let draftQuality: ContractQualityOverrides | undefined;
        if (body.draftContractQuality !== undefined) {
          draftQuality = validateContractQualityOverride(
            body.draftContractQuality,
            "draftContractQuality",
          );
        }
        // Merge: draft overrides win over existing
        const mergedQuality: ContractQualityOverrides = {};
        if (existingQuality !== undefined) {
          for (const key of Object.keys(existingQuality)) {
            (mergedQuality as Record<string, unknown>)[key] = (existingQuality as Record<string, unknown>)[key];
          }
        }
        if (draftQuality !== undefined) {
          for (const key of Object.keys(draftQuality)) {
            (mergedQuality as Record<string, unknown>)[key] = (draftQuality as Record<string, unknown>)[key];
          }
        }
        const qualityPreview = previewQualityPolicy(
          Object.keys(mergedQuality).length > 0 ? mergedQuality : undefined,
          currentSettings.contractQuality,
          "draft-worker",
        );
        this.sendJson(req, res, 200, { ok: true, preview, previewQualityPolicy: qualityPreview });
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
      const hasCandidates = body.candidates !== undefined;
      const hasProfiles = body.workerProfileIds !== undefined;
      if (hasCandidates === hasProfiles) {
        this.sendJson(req, res, 422, {
          error: "Provide exactly one of candidates or workerProfileIds",
        });
        return;
      }
      const candidates: Array<{ provider: string; model: string; runtime?: string; effort?: string }> = [];
      let workerProfileIds: string[] | undefined;
      try {
        if (hasCandidates) {
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
            const runtime = typeof c.runtime === "string" && c.runtime.trim()
              ? c.runtime.trim() : undefined;
            const effort = typeof c.effort === "string" && c.effort.trim()
              ? c.effort.trim() : undefined;
            if ((runtime === undefined) !== (effort === undefined)) {
              this.sendJson(req, res, 422, { error: `candidates[${i}] must include both runtime and effort, or neither` });
              return;
            }
            const dedupKey = `${provider}\0${model}`
              + (runtime !== undefined ? `\0${runtime}\0${effort}` : "");
            if (seen.has(dedupKey)) {
              this.sendJson(req, res, 422, { error: `Duplicate candidate at index ${i}: ${provider} / ${model}` });
              return;
            }
            seen.add(dedupKey);
            candidates.push({ provider, model, ...(runtime === undefined ? {} : { runtime, effort }) });
          }
        } else {
          if (!Array.isArray(body.workerProfileIds)) {
            this.sendJson(req, res, 422, { error: "workerProfileIds must be an array" });
            return;
          }
          if (body.workerProfileIds.length < 2 || body.workerProfileIds.length > 10) {
            this.sendJson(req, res, 422, { error: "workerProfileIds must contain 2 to 10 entries" });
            return;
          }
          const seen = new Set<string>();
          workerProfileIds = [];
          for (let i = 0; i < body.workerProfileIds.length; i++) {
            const value = body.workerProfileIds[i];
            if (typeof value !== "string" || !value.trim() || value.trim().length > 64) {
              this.sendJson(req, res, 422, { error: `workerProfileIds[${i}] must be a non-empty string` });
              return;
            }
            const id = value.trim();
            if (seen.has(id)) {
              this.sendJson(req, res, 422, { error: `Duplicate workerProfileId at index ${i}: ${id}` });
              return;
            }
            seen.add(id);
            workerProfileIds.push(id);
          }
        }
      } catch (error) {
        this.sendJson(req, res, 422, {
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      try {
        // Bridge is strictly read-only — calls daemon model_routing only.
        const daemonParams: Record<string, unknown> = { taskClass };
        if (workerProfileIds !== undefined) daemonParams.workerProfileIds = workerProfileIds;
        else daemonParams.candidates = candidates;
        const taskFamily = typeof body.taskFamily === "string" && body.taskFamily.trim()
          ? body.taskFamily.trim() : undefined;
        if (taskFamily) daemonParams.taskFamily = taskFamily;
        const competitionIntent = body.competitionIntent === "none"
          || body.competitionIntent === "consider"
          || body.competitionIntent === "required"
          ? body.competitionIntent : undefined;
        if (competitionIntent) daemonParams.competitionIntent = competitionIntent;
        const validTriggers = new Set(["critical", "multiple-plausible-solutions", "new-family", "user-requested"]);
        const competitionTriggers = Array.isArray(body.competitionTriggers)
          ? body.competitionTriggers.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter((t) => t.length > 0)
          : undefined;
        if (competitionTriggers?.some((trigger) => !validTriggers.has(trigger))) {
          this.sendJson(req, res, 422, { error: "competitionTriggers contains an unsupported Main reason" });
          return;
        }
        if (competitionTriggers && competitionTriggers.length > 0) {
          daemonParams.competitionTriggers = competitionTriggers;
        }
        const advisory = await this.daemonCall<Record<string, unknown>>("model_routing", daemonParams);
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

  /**
   * Enrich one canonical outcome-intake view with the same fixed contract
   * vocabulary D1 derives for the selected shape. The browser never re-derives
   * projection facts; an unknown or absent proposal passes through unchanged.
   * No lifecycle state is invented and no private field is exposed.
   */
  private projectIntakeView(intake: Record<string, unknown>): Record<string, unknown> {
    const proposal = intake.proposal;
    if (proposal === null || typeof proposal !== "object" || Array.isArray(proposal)) {
      return intake;
    }
    const shape = (proposal as { shape?: unknown }).shape;
    if (shape !== "task" && shape !== "plan" && shape !== "goal") return intake;
    // Goal proposals keep their file version so the contract story stays
    // truthful (v1 stays legacy; v2 also names the multi-phase family).
    const goalVersion = (proposal as { goalVersion?: 1 | 2 }).goalVersion;
    return {
      ...intake,
      proposal: {
        ...(proposal as Record<string, unknown>),
        contractsInvolved: contractsInvolvedForShape(shape, goalVersion),
      },
    };
  }

  /**
   * Compact privacy-safe Task allowlist shared by the recent Tasks route and
   * the durable History route so a new field cannot silently appear in only
   * one of them. Forwards the canonical Core board placement only when
   * boardScope and boardReason form a legal pair; absent or contradictory
   * codes are dropped so the UI fails open to Now. Never exposes reason text,
   * command text/output, prompts, paths, sessions, credentials, diffs, or
   * free-text review reasons.
   */
  private projectCompactTaskSummary(t: Record<string, unknown>): Record<string, unknown> {
    // Compact final-delivery disposition only.
    const disposition = t.remediationDisposition;
    let remediationDisposition:
      | {
          status: string;
          checkId: string;
          createdAt: string;
          acceptanceBasis?: "original-acceptance" | "amended-acceptance";
          amendedCommandCount?: number;
          reasonCode?: "contradictory-acceptance";
        }
      | undefined;
    if (
      disposition !== null
      && typeof disposition === "object"
      && (disposition as { status?: unknown }).status === "verified-repaired-delivered"
      && typeof (disposition as { checkId?: unknown }).checkId === "string"
      && typeof (disposition as { createdAt?: unknown }).createdAt === "string"
    ) {
      const d = disposition as {
        status: string;
        checkId: string;
        createdAt: string;
        acceptanceBasis?: unknown;
        amendedCommandCount?: unknown;
        reasonCode?: unknown;
      };
      remediationDisposition = {
        status: d.status,
        checkId: d.checkId,
        createdAt: d.createdAt,
        ...(d.acceptanceBasis === "amended-acceptance"
          || d.acceptanceBasis === "original-acceptance"
          ? { acceptanceBasis: d.acceptanceBasis }
          : {}),
        ...(typeof d.amendedCommandCount === "number"
          && Number.isSafeInteger(d.amendedCommandCount)
          && d.amendedCommandCount >= 1
          ? { amendedCommandCount: d.amendedCommandCount }
          : {}),
        ...(d.reasonCode === "contradictory-acceptance"
          ? { reasonCode: "contradictory-acceptance" as const }
          : {}),
      };
    }
    // Canonical Core board placement: forward only when boardScope and
    // boardReason form a legal pair (not two independent vocabulary
    // memberships). Contradictory but individually valid tokens, unknown
    // types, or private/injected strings are dropped so the UI fails open
    // to Now. The Hub never recomputes lifecycle semantics.
    const boardCodes = isLegalBoardPlacement(t.boardScope, t.boardReason)
      ? { boardScope: t.boardScope as string, boardReason: t.boardReason as string }
      : null;
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
      // Forward the latest explicit Main attention resolution only when it is
      // a valid resolved/reopened state; malformed evidence fails open to Now.
      ...(() => {
        const resolution = t.attentionResolution;
        if (
          resolution !== null
          && typeof resolution === "object"
          && !Array.isArray(resolution)
          && (resolution as { status?: unknown }).status !== "none"
        ) {
          return { attentionResolution: resolution };
        }
        return {};
      })(),
      // Forward the canonical Core board placement only when the codes
      // form a legal pair; absent or contradictory codes fail open to Now.
      ...(boardCodes === null ? {} : boardCodes),
    };
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
      if (opsRoute === "/work-hierarchy") {
        // Read-only bridge to daemon work_hierarchy. Forwards bounded filters
        // only — no Hub-side lifecycle joins, no mutation, no auto-start change.
        const url = new URL(req.url ?? "/", `http://${LOOPBACK}`);
        const daemonParams: Record<string, unknown> = {};
        const projectParam = url.searchParams.get("project");
        if (projectParam !== null) daemonParams.project = projectParam;
        const workerParam = url.searchParams.get("workerProfileId");
        if (workerParam !== null) daemonParams.workerProfileId = workerParam;
        // Support repeated ?column= and single comma-separated ?column=.
        const columnParams = url.searchParams.getAll("column");
        if (columnParams.length > 0) {
          daemonParams.column = columnParams.length === 1
            ? columnParams[0]
            : columnParams;
        }
        try {
          const hierarchy = await this.daemonCall<Record<string, unknown>>(
            "work_hierarchy",
            daemonParams,
          );
          this.sendJson(req, res, 200, hierarchy);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          // Core's fixed invalid-filter reason is privacy-safe; surface it.
          // Any other daemon failure uses a bounded message.
          this.sendJson(req, res, msg === WORK_HIERARCHY_INVALID_FILTER_REASON ? 400 : 503, {
            error: msg === WORK_HIERARCHY_INVALID_FILTER_REASON
              ? msg
              : "Work hierarchy is unavailable right now; try again.",
          });
        }
        return;
      }
      if (opsRoute === "/intakes") {
        // Read-only bounded outcome-intake list. Forwards only the optional
        // closed status and limit filters; never exposes a proposal mutation,
        // never starts a Worker, and never invents lifecycle state. Each
        // canonical view is enriched with the same contract vocabulary D1 uses
        // so the browser never re-derives projection facts.
        const url = new URL(req.url ?? "/", `http://${LOOPBACK}`);
        const daemonParams: Record<string, unknown> = {};
        const statusParam = url.searchParams.get("status");
        if (statusParam !== null) {
          if (statusParam !== "pending" && statusParam !== "proposed" && statusParam !== "created") {
            this.sendJson(req, res, 422, { error: "status must be pending, proposed, or created" });
            return;
          }
          daemonParams.status = statusParam;
        }
        const limitParam = url.searchParams.get("limit");
        if (limitParam !== null) {
          const parsed = Number(limitParam);
          if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
            this.sendJson(req, res, 422, { error: "limit must be an integer from 1 to 100" });
            return;
          }
          daemonParams.limit = parsed;
        }
        try {
          const intakes = await this.daemonCall<Array<Record<string, unknown>>>(
            "outcome_intake_list",
            daemonParams,
          );
          const views = (Array.isArray(intakes) ? intakes : [])
            .filter((item): item is Record<string, unknown> =>
              item !== null && typeof item === "object" && !Array.isArray(item),
            )
            .map((item) => this.projectIntakeView(item));
          this.sendJson(req, res, 200, views);
        } catch (error) {
          this.sendJson(req, res, 503, {
            error: "Outcome intakes are unavailable right now; try again.",
          });
        }
        return;
      }

      const intakeDetail = opsRoute.match(/^\/intakes\/([^/]+)$/);
      if (intakeDetail) {
        const intakeId = decodeURIComponent(intakeDetail[1]!);
        if (intakeId.length === 0 || intakeId.length > 128) {
          this.sendJson(req, res, 422, { error: "intakeId is invalid" });
          return;
        }
        try {
          const intake = await this.daemonCall<Record<string, unknown>>(
            "outcome_intake_get",
            { intakeId },
          );
          this.sendJson(req, res, 200, this.projectIntakeView(intake));
        } catch (error) {
          this.sendJson(req, res, 503, {
            error: "Outcome intake is unavailable right now; try again.",
          });
        }
        return;
      }

      if (opsRoute === "/goals") {
        const goals = await this.daemonCall<unknown[]>("goal_list", { limit: 50 });
        // Privacy-safe Goal projections from the daemon; never re-enrich with private content.
        this.sendJson(req, res, 200, Array.isArray(goals) ? goals : []);
        return;
      }
      if (opsRoute === "/tasks") {
        const surfaces = await this.daemonCall<Array<Record<string, unknown>>>("list_summaries", {
          limit: 50,
        });
        const tasks = (Array.isArray(surfaces) ? surfaces : [])
          .filter((t): t is Record<string, unknown> => t !== null && typeof t === "object" && !Array.isArray(t))
          .map((t) => this.projectCompactTaskSummary(t));
        this.sendJson(req, res, 200, tasks);
        return;
      }
      if (opsRoute === "/tasks/history") {
        // Explicit, read-only, never polled History page. Reuses the same
        // compact Task allowlist as /api/ops/tasks so recent and History
        // responses share one privacy boundary. Not in PAGE_DEPS or any
        // automatic refresh path; the browser calls this only on explicit
        // search, Refresh, or Load more.
        const url = new URL(req.url ?? "/", `http://${LOOPBACK}`);
        const daemonParams: Record<string, unknown> = {};
        const limitParam = url.searchParams.get("limit");
        if (limitParam !== null) {
          const n = Number(limitParam);
          daemonParams.limit = n;
        }
        const queryParam = url.searchParams.get("query");
        if (queryParam !== null) daemonParams.query = queryParam;
        const cursorParam = url.searchParams.get("cursor");
        if (cursorParam !== null && cursorParam.length > 0) {
          daemonParams.cursor = cursorParam;
        }
        try {
          const page = await this.daemonCall<{
            items?: unknown;
            totalCount?: unknown;
            hasMore?: unknown;
            nextCursor?: unknown;
          }>("list_history_page", daemonParams);
          const items = (Array.isArray(page.items) ? page.items : [])
            .filter((item): item is Record<string, unknown> =>
              item !== null && typeof item === "object" && !Array.isArray(item),
            )
            .map((item) => this.projectCompactTaskSummary(item));
          this.sendJson(req, res, 200, {
            items,
            totalCount: typeof page.totalCount === "number" ? page.totalCount : items.length,
            hasMore: page.hasMore === true,
            ...(typeof page.nextCursor === "string" && page.nextCursor.length > 0
              ? { nextCursor: page.nextCursor }
              : {}),
          });
        } catch (error) {
          // The daemon's fixed invalid-request reason is privacy-safe and
          // tells the user to start a new search; surface it verbatim. Any
          // other daemon failure uses a bounded privacy-safe message so raw
          // daemon text, paths, or Task content is never echoed.
          const msg = error instanceof Error ? error.message : String(error);
          this.sendJson(req, res, 503, {
            error: msg === HISTORY_INVALID_REQUEST_REASON
              ? msg
              : "History is unavailable right now; try again.",
          });
        }
        return;
      }
      if (opsRoute === "/competitions") {
        const list = await this.daemonCall<unknown[]>("competition_list", {});
        this.sendJson(req, res, 200, Array.isArray(list) ? list.slice(0, 50) : []);
        return;
      }
      if (opsRoute === "/stats") {
        // Insights cards use aggregate counts only; never poll per-Task failure rows.
        const stats = await this.daemonCall<unknown[]>("statistics", { detail: "compact" });
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
      if (opsRoute === "/routing-evidence-coverage") {
        // Read-only bridge to daemon routing_evidence_coverage. Forwards the
        // canonical aggregate only — never recomputes counts, never calls a
        // Provider, never exposes Task content, paths, prompts, or reasons.
        const coverage = await this.daemonCall<Record<string, unknown>>(
          "routing_evidence_coverage",
          {},
        );
        this.sendJson(req, res, 200, coverage);
        return;
      }
      if (opsRoute === "/self-upgrade-evidence") {
        // Read-only bridge to daemon self_upgrade_evidence. Hub always uses
        // the default milestone (required=3). Never recomputes streak
        // semantics, never starts Integration, never exposes command streams.
        const evidence = await this.daemonCall<Record<string, unknown>>(
          "self_upgrade_evidence",
          { required: 3 },
        );
        this.sendJson(req, res, 200, evidence);
        return;
      }
      if (opsRoute === "/main-direct-aggregate") {
        // Read-only aggregate counts. Never exposes per-decision content,
        // paths, or private notes.
        const aggregate = await this.daemonCall<Record<string, unknown>>(
          "main_direct_aggregate",
          {},
        );
        this.sendJson(req, res, 200, aggregate);
        return;
      }
      if (opsRoute === "/main-direct-recent") {
        // Read-only privacy-safe recent entries. Never exposes per-decision
        // full notes or considered Worker details.
        const entries = await this.daemonCall<readonly Record<string, unknown>[]>(
          "main_direct_recent",
          {},
        );
        this.sendJson(req, res, 200, entries);
        return;
      }

      if (opsRoute === "/sample-task") {
        if (this.onboardingSamples === undefined) {
          this.sendJson(req, res, 200, { available: false, state: "unavailable" });
          return;
        }
        const latest = await this.onboardingSamples.latest();
        if (latest === undefined) {
          this.sendJson(req, res, 200, { available: true, state: "empty" });
          return;
        }
        if (latest.state !== "prepared") {
          this.sendJson(req, res, 200, this.safeSampleProjection(latest));
          return;
        }
        try {
          const preview = await this.daemonCall<Record<string, unknown>>("validate_file", {
            taskFile: latest.taskFile,
          });
          this.sendJson(req, res, 200, this.safeSampleProjection(latest, preview));
        } catch {
          this.sendJson(req, res, 200, {
            ...this.safeSampleProjection(latest),
            state: "needs-attention",
          });
        }
        return;
      }

      const boardPlan = opsRoute.match(/^\/(?:board|plans)\/(.+)$/);
      if (boardPlan) {
        const planId = decodeURIComponent(boardPlan[1]!);
        const board = await this.daemonCall<unknown>("plan_board", { planId });
        this.sendJson(req, res, 200, board);
        return;
      }

      const goalDetail = opsRoute.match(/^\/goals\/(.+)$/);
      if (goalDetail) {
        const goalId = decodeURIComponent(goalDetail[1]!);
        const goal = await this.daemonCall<unknown>("goal_status", { goalId });
        this.sendJson(req, res, 200, goal);
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
        let reviewGraph: unknown = undefined;
        let failureAttribution: unknown = undefined;
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
        try {
          reviewGraph = await this.daemonCall<unknown>("review_graph_status", { taskId });
        } catch {
          // Review Graph is best-effort; absence must not break Task Detail.
        }
        try {
          failureAttribution = await this.daemonCall<unknown>(
            "main_failure_attribution_projection",
            { taskId },
          );
        } catch {
          // Best-effort local explanation; Task Detail still renders if an
          // older daemon does not yet support this projection.
        }
        const inspect = await this.daemonCall<{
          events?: Array<{ timestamp: string; type: string; summary: string; payload?: unknown }>;
          attempts?: Array<Record<string, unknown>>;
          diff?: string;
          mainReview?: Record<string, unknown>;
          competitionContext?: Record<string, unknown>;
          reviewGraph?: Record<string, unknown>;
          attentionResolution?: { status: string; reason?: string; note?: string; evidenceTaskId?: string; resolvedAt?: string; reopenedAt?: string; eventSequence?: number };
        }>("inspect", { taskId });
        const events = Array.isArray(inspect.events) ? inspect.events : [];
        // Filter narrative fragments before the transport bound so stream
        // deltas cannot evict lifecycle milestones from ordinary Hub activity.
        // Store/inspect raw events are unchanged; this is a read-only projection.
        const timeline = projectTaskActivityTimeline(events);
        const spec = task.spec as {
          provider?: { name?: string; model?: string };
          runtime?: { name?: string };
          routingDecision?: unknown;
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

        // Bounded Plan context for Task Detail lineage section.
        // One durable daemon query backed by Store truth; no N-plus-one scan.
        let planContext: Record<string, unknown> | undefined;
        let taskLineage: Record<string, unknown> | undefined;
        try {
          const ctx = await this.daemonCall<Record<string, unknown> | undefined>(
            "task_plan_context",
            { taskId: task.id },
          );
          if (ctx !== undefined && typeof ctx === "object") {
            planContext = {
              planId: ctx.planId,
              planName: typeof ctx.planName === "string" ? ctx.planName.slice(0, 200) : undefined,
              itemId: ctx.itemId,
              itemIndex: ctx.itemIndex,
              namedDependencies: (Array.isArray(ctx.namedDependencies) ? ctx.namedDependencies : []).slice(0, 20),
              namedRequiredBy: (Array.isArray(ctx.namedRequiredBy) ? ctx.namedRequiredBy : []).slice(0, 20),
            };
          }
        } catch {
          planContext = undefined;
        }

        // Task lineage from existing durable handoff evidence (no new inference).
        if (journey.candidateHandoff) {
          const h = journey.candidateHandoff;
          const isSource = h.role === "source";
          taskLineage = {
            kind: "handoff",
            role: h.role,
            ...(isSource
              ? { successorTaskId: h.successorTaskId }
              : { sourceTaskId: h.sourceTaskId }),
            destinationProvider: h.destinationProvider,
            destinationModel: h.destinationModel,
            notARetry: true,
          };
        } else if (planContext) {
          taskLineage = { kind: "plan", planId: planContext.planId };
        } else {
          taskLineage = { kind: "standalone" };
        }

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
          ...(typeof (decision as Record<string, unknown>).stage === "string"
            ? { decisionStage: (decision as Record<string, unknown>).stage } : {}),
          progress: (decision as { progress?: unknown }).progress,
          journey,
          ...(spec?.routingDecision === undefined ? {} : { routingDecision: spec.routingDecision }),
          ...(inspect.competitionContext === undefined
            ? {}
            : { competitionContext: inspect.competitionContext }),
          // Latest explicit Main attention resolution. The daemon Core owns the
          // validated projection; the Hub only translates the closed codes.
          ...(inspect.attentionResolution === undefined
            || (inspect.attentionResolution.status !== "resolved"
              && inspect.attentionResolution.status !== "reopened")
            ? {}
            : { attentionResolution: inspect.attentionResolution }),
          timeline,
          economics,
          deliveryPlan,
          planContext,
          taskLineage,
          ...(effectivePolicy === undefined ? {} : { effectivePolicy }),
          ...(candidateReverificationEligibility === undefined
            ? {}
            : { candidateReverificationEligibility }),
          ...(correctionEligibility === undefined
            ? {}
            : { correctionEligibility }),
          ...(failureAttribution === undefined ? {} : { failureAttribution }),
          ...((reviewGraph ?? inspect.reviewGraph) === undefined
            || (reviewGraph ?? inspect.reviewGraph) === null
            ? {}
            : { reviewGraph: reviewGraph ?? inspect.reviewGraph }),
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
      // POST /api/ops/intakes — record one pending outcome intake.
      // Validates strictly through the canonical D1 create normalizer (single
      // source of truth), then forwards the closed field set to the daemon.
      // Never proposes, confirms, or creates Task/Plan/Goal work: the browser
      // has no proposal mutation and no confirmation endpoint.
      if (opsRoute === "/intakes") {
        let normalized: OutcomeIntakeCreateInput;
        try {
          normalized = normalizeOutcomeIntakeCreate(body);
        } catch (error) {
          this.sendJson(req, res, 422, {
            error: error instanceof Error ? error.message : "Invalid outcome intake",
          });
          return;
        }
        try {
          // Forward only the closed normalized create fields. Building the
          // params object explicitly keeps the Record boundary type-safe
          // without an assertion and without weakening the validation above.
          const params: Record<string, unknown> = {
            outcome: normalized.outcome,
            requestedShape: normalized.requestedShape,
            ...(normalized.project === undefined ? {} : { project: normalized.project }),
            ...(normalized.context === undefined ? {} : { context: normalized.context }),
          };
          const intake = await this.daemonCall<Record<string, unknown>>(
            "outcome_intake_create",
            params,
          );
          this.sendJson(req, res, 200, {
            ok: true,
            action: "outcome_intake_create",
            intake,
          });
        } catch (error) {
          this.sendJson(req, res, 503, {
            error: "Outcome intake could not be recorded; nothing was created.",
          });
        }
        return;
      }

      // POST /api/ops/intakes/:id/confirm
      // One closed explicit confirmation bridge to the canonical D3A
      // outcome_intake_confirm authority. The path supplies a bounded intake
      // id; the body contains only expectedRevision and the literal
      // confirm:true. The Hub never sees the private artifact path, never
      // chooses a shape, never creates work locally, never inserts an
      // optimistic card, and never retries automatically.
      const intakeConfirm = opsRoute.match(/^\/intakes\/([^/]+)\/confirm$/);
      if (intakeConfirm) {
        const intakeId = decodeURIComponent(intakeConfirm[1]!);
        if (intakeId.length === 0 || intakeId.length > 128) {
          this.sendJson(req, res, 422, { error: "intakeId is invalid" });
          return;
        }
        if (!exactOwnKeys(body, new Set(["expectedRevision", "confirm"])) || body.confirm !== true) {
          this.sendJson(req, res, 422, {
            error: "outcome intake confirmation requires confirm: true and expectedRevision only",
          });
          return;
        }
        const expectedRevision = body.expectedRevision;
        if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision)
          || expectedRevision < 1) {
          this.sendJson(req, res, 422, { error: "expectedRevision must be a positive integer" });
          return;
        }
        try {
          const result = await this.daemonCall<{
            intake?: Record<string, unknown> | null;
            receipt?: Record<string, unknown> | null;
          }>("outcome_intake_confirm", { intakeId, expectedRevision, confirm: true });
          const intake = result && result.intake;
          const receipt = result && result.receipt;
          if (!intake || !receipt) {
            this.sendJson(req, res, 503, {
              error: "Outcome intake confirmation returned no receipt; re-read the intake.",
            });
            return;
          }
          this.sendJson(req, res, 200, {
            ok: true,
            action: "outcome_intake_confirm",
            intake: this.projectIntakeView(intake),
            receipt,
          });
        } catch (error) {
          // The daemon's fixed privacy-safe reasons become bounded codes the
          // browser owns as plain-language copy. Any other failure is the
          // uncertain-network story: never claim nothing happened.
          const msg = error instanceof Error ? error.message : String(error);
          let code: string;
          if (msg === STALE_OUTCOME_INTAKE_CONFIRM_REASON) code = "stale-revision";
          else if (msg === OUTCOME_INTAKE_STALE_ARTIFACT_REASON) code = "stale-artifact";
          else if (msg === OUTCOME_INTAKE_CONFIRM_IN_PROGRESS_REASON) code = "in-progress";
          else if (msg === OUTCOME_INTAKE_NO_PROPOSAL_REASON) code = "no-proposal";
          else code = "network";
          this.sendJson(req, res, code === "network" ? 503 : 422, { error: code });
        }
        return;
      }

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
      const failureAttribution = opsRoute.match(/^\/tasks\/([^/]+)\/failure-attribution$/);
      if (failureAttribution) {
        const taskId = decodeURIComponent(failureAttribution[1]!);
        if (body.confirm !== true) {
          this.sendJson(req, res, 422, { error: "failure attribution requires confirm: true" });
          return;
        }
        if (typeof body.attemptId !== "string" || body.attemptId.trim().length === 0) {
          this.sendJson(req, res, 422, { error: "attemptId is required" });
          return;
        }
        const sequence = Number(body.verificationEventSequence);
        if (!Number.isSafeInteger(sequence) || sequence < 1) {
          this.sendJson(req, res, 422, { error: "verificationEventSequence must be a positive integer" });
          return;
        }
        if (typeof body.cause !== "string" || !FAILURE_ATTRIBUTION_CAUSES.has(body.cause)) {
          this.sendJson(req, res, 422, { error: "Choose one supported responsibility reason" });
          return;
        }
        const note = typeof body.note === "string" ? body.note.trim() : "";
        if (!note || note.length > 500 || /[\u0000-\u001f\u007f]/u.test(note)) {
          this.sendJson(req, res, 422, { error: "note must be 1-500 characters without control characters" });
          return;
        }
        const hasRevisionId = body.candidateRevisionId !== undefined;
        const hasDigest = body.candidatePatchDigest !== undefined;
        if (hasRevisionId !== hasDigest) {
          this.sendJson(req, res, 422, { error: "Candidate binding is incomplete" });
          return;
        }
        const result = await this.daemonCall<unknown>("main_failure_attribution", {
          taskId,
          attemptId: body.attemptId.trim(),
          verificationEventSequence: sequence,
          cause: body.cause,
          note,
          ...(hasRevisionId ? {
            candidateRevisionId: body.candidateRevisionId,
            candidatePatchDigest: body.candidatePatchDigest,
          } : {}),
          confirm: true,
        });
        this.sendJson(req, res, 200, {
          ok: true,
          action: "main_failure_attribution",
          taskId,
          result,
        });
        return;
      }

      // POST /api/ops/tasks/:id/resolve  { reason, note, evidenceTaskId?, confirm: true }
      // Explicit Main closure of a handled failure. The daemon Core validates
      // eligibility, idempotency, and conflict semantics; the Hub only
      // enforces the bounded inputs before forwarding.
      const resolveRoute = opsRoute.match(/^\/tasks\/([^/]+)\/resolve$/);
      if (resolveRoute) {
        const taskId = decodeURIComponent(resolveRoute[1]!);
        if (body.confirm !== true) {
          this.sendJson(req, res, 422, { error: "resolve requires confirm: true" });
          return;
        }
        const reason = typeof body.reason === "string" ? body.reason : "";
        if (!(TASK_RESOLUTION_REASONS as readonly string[]).includes(reason)) {
          this.sendJson(req, res, 422, { error: "Choose one supported handled reason" });
          return;
        }
        let note: string | undefined;
        if (body.note !== undefined) {
          if (typeof body.note !== "string") {
            this.sendJson(req, res, 422, { error: "note must be a string when provided" });
            return;
          }
          note = body.note.trim();
          if (note.length > TASK_RESOLUTION_NOTE_MAX_LENGTH) {
            this.sendJson(req, res, 422, {
              error: `note must be at most ${TASK_RESOLUTION_NOTE_MAX_LENGTH} characters`,
            });
            return;
          }
          if (note.length === 0) note = undefined;
        }
        const evidenceTaskId = body.evidenceTaskId === undefined
          ? undefined
          : typeof body.evidenceTaskId === "string"
            ? body.evidenceTaskId.trim()
            : "";
        if (
          evidenceTaskId !== undefined
          && (!evidenceTaskId
            || evidenceTaskId.length > TASK_RESOLUTION_EVIDENCE_ID_MAX_LENGTH)
        ) {
          this.sendJson(req, res, 422, {
            error: `evidenceTaskId must be 1-${TASK_RESOLUTION_EVIDENCE_ID_MAX_LENGTH} characters`,
          });
          return;
        }
        const result = await this.daemonCall<unknown>("task_resolve", {
          taskId,
          reason,
          ...(note === undefined || note.length === 0 ? {} : { note }),
          ...(evidenceTaskId === undefined ? {} : { evidenceTaskId }),
          confirm: true,
        });
        this.sendJson(req, res, 200, { ok: true, action: "resolve", taskId, result });
        return;
      }

      // POST /api/ops/tasks/:id/reopen  { note, confirm: true }
      const reopenRoute = opsRoute.match(/^\/tasks\/([^/]+)\/reopen$/);
      if (reopenRoute) {
        const taskId = decodeURIComponent(reopenRoute[1]!);
        if (body.confirm !== true) {
          this.sendJson(req, res, 422, { error: "reopen requires confirm: true" });
          return;
        }
        let note: string | undefined;
        if (body.note !== undefined) {
          if (typeof body.note !== "string") {
            this.sendJson(req, res, 422, { error: "note must be a string when provided" });
            return;
          }
          note = body.note.trim();
          if (note.length > TASK_RESOLUTION_NOTE_MAX_LENGTH) {
            this.sendJson(req, res, 422, {
              error: `note must be at most ${TASK_RESOLUTION_NOTE_MAX_LENGTH} characters`,
            });
            return;
          }
          if (note.length === 0) note = undefined;
        }
        const result = await this.daemonCall<unknown>("task_reopen", {
          taskId,
          ...(note === undefined ? {} : { note }),
          confirm: true,
        });
        this.sendJson(req, res, 200, { ok: true, action: "reopen", taskId, result });
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

      // POST /api/ops/tasks/:id/review-graph
      // { reviewerWorkerProfileIds?: string[], reviewerWorkerProfileId?: string, reason, confirm: true }
      // Explicit 1–3 independent read-only judges for the current exact Candidate Revision.
      const reviewGraphCreate = opsRoute.match(/^\/tasks\/([^/]+)\/review-graph$/);
      if (reviewGraphCreate) {
        const taskId = decodeURIComponent(reviewGraphCreate[1]!);
        if (body.confirm !== true) {
          this.sendJson(req, res, 422, { error: "review_graph_create requires confirm: true" });
          return;
        }
        let reviewerWorkerProfileIds: string[] | undefined;
        if (Array.isArray(body.reviewerWorkerProfileIds)) {
          reviewerWorkerProfileIds = [];
          for (const entry of body.reviewerWorkerProfileIds) {
            if (typeof entry !== "string" || entry.trim().length === 0 || entry.trim().length > 64) {
              this.sendJson(req, res, 422, {
                error: "each reviewerWorkerProfileId must be 1–64 characters",
              });
              return;
            }
            reviewerWorkerProfileIds.push(entry.trim());
          }
          if (reviewerWorkerProfileIds.length < 1 || reviewerWorkerProfileIds.length > 3) {
            this.sendJson(req, res, 422, {
              error: "reviewerWorkerProfileIds must contain 1–3 unique profile ids",
            });
            return;
          }
        }
        const reviewerWorkerProfileId = typeof body.reviewerWorkerProfileId === "string"
          ? body.reviewerWorkerProfileId.trim()
          : "";
        if (
          (reviewerWorkerProfileIds === undefined || reviewerWorkerProfileIds.length === 0)
          && (!reviewerWorkerProfileId || reviewerWorkerProfileId.length > 64)
        ) {
          this.sendJson(req, res, 422, {
            error: "reviewerWorkerProfileIds (1–3) or reviewerWorkerProfileId is required",
          });
          return;
        }
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";
        if (!reason || reason.length > 1000) {
          this.sendJson(req, res, 422, { error: "reason is required (max 1000 chars)" });
          return;
        }
        const result = await this.daemonCall<unknown>("review_graph_create", {
          taskId,
          ...(reviewerWorkerProfileIds === undefined
            ? {}
            : { reviewerWorkerProfileIds }),
          ...(reviewerWorkerProfileId
            ? { reviewerWorkerProfileId }
            : {}),
          reason,
          confirm: true,
        });
        this.sendJson(req, res, 200, {
          ok: true,
          action: "review_graph_create",
          taskId,
          result,
        });
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

      // POST /api/ops/goals/:id/advance  { confirm: true }
      const goalAdvance = opsRoute.match(/^\/goals\/([^/]+)\/advance$/);
      if (goalAdvance) {
        const goalId = decodeURIComponent(goalAdvance[1]!);
        if (body.confirm !== true) {
          this.sendJson(req, res, 422, { error: "goal advance requires confirm: true" });
          return;
        }
        const result = await this.daemonCall<unknown>("goal_advance", { goalId, confirm: true });
        this.sendJson(req, res, 200, { ok: true, action: "goal_advance", goalId, result });
        return;
      }

      // POST /api/ops/goals/:id/stop  { confirm: true }
      const goalStop = opsRoute.match(/^\/goals\/([^/]+)\/stop$/);
      if (goalStop) {
        const goalId = decodeURIComponent(goalStop[1]!);
        if (body.confirm !== true) {
          this.sendJson(req, res, 422, { error: "goal stop requires confirm: true" });
          return;
        }
        const result = await this.daemonCall<unknown>("goal_stop", { goalId, confirm: true });
        this.sendJson(req, res, 200, { ok: true, action: "goal_stop", goalId, result });
        return;
      }

      // POST /api/ops/tasks/:id/goal-handoff
      // { candidateRevisionId, reusablePaths, remainingGaps, destinationWorkerProfileId, reason, confirm: true }
      const goalHandoff = opsRoute.match(/^\/tasks\/([^/]+)\/goal-handoff$/);
      if (goalHandoff) {
        const taskId = decodeURIComponent(goalHandoff[1]!);
        if (body.confirm !== true) {
          this.sendJson(req, res, 422, { error: "Goal Task handoff requires explicit confirm: true" });
          return;
        }
        if (typeof body.candidateRevisionId !== "string" || body.candidateRevisionId.length === 0) {
          this.sendJson(req, res, 422, { error: "candidateRevisionId is required" });
          return;
        }
        if (
          typeof body.destinationWorkerProfileId !== "string"
          || body.destinationWorkerProfileId.length === 0
        ) {
          this.sendJson(req, res, 422, { error: "destinationWorkerProfileId is required" });
          return;
        }
        if (typeof body.reason !== "string" || body.reason.trim().length === 0) {
          this.sendJson(req, res, 422, { error: "reason is required" });
          return;
        }
        if (!Array.isArray(body.reusablePaths) || body.reusablePaths.length === 0) {
          this.sendJson(req, res, 422, { error: "reusablePaths must be a non-empty array" });
          return;
        }
        if (!Array.isArray(body.remainingGaps) || body.remainingGaps.length === 0) {
          this.sendJson(req, res, 422, { error: "remainingGaps must be a non-empty array" });
          return;
        }
        const result = await this.daemonCall<unknown>("goal_task_handoff", {
          taskId,
          candidateRevisionId: body.candidateRevisionId,
          reusablePaths: body.reusablePaths,
          remainingGaps: body.remainingGaps,
          destinationWorkerProfileId: body.destinationWorkerProfileId,
          reason: body.reason.trim(),
          confirm: true,
        });
        this.sendJson(req, res, 200, { ok: true, action: "goal_task_handoff", taskId, result });
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

      // POST /api/ops/competitions/:id/main-decision  { candidateId, decision, reason, confirm }
      const mainDecision = opsRoute.match(/^\/competitions\/([^/]+)\/main-decision$/);
      if (mainDecision) {
        const competitionId = decodeURIComponent(mainDecision[1]!);
        if (body.confirm !== true) {
          this.sendJson(req, res, 422, { error: "Competition Main decision requires explicit confirm: true" });
          return;
        }
        const decision = typeof body.decision === "string" ? body.decision : "";
        if (decision !== "accept" && decision !== "revise" && decision !== "reject") {
          this.sendJson(req, res, 422, { error: "decision must be accept, revise, or reject" });
          return;
        }
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";
        if (reason.length === 0 || reason.length > 1000) {
          this.sendJson(req, res, 422, { error: "reason must be 1-1000 characters" });
          return;
        }
        if (typeof body.candidateId !== "string" || body.candidateId.length === 0) {
          this.sendJson(req, res, 422, { error: "candidateId is required" });
          return;
        }
        const result = await this.daemonCall<unknown>("competition_main_decision", {
          competitionId,
          candidateId: body.candidateId,
          decision,
          reason,
          confirm: true,
        });
        this.sendJson(req, res, 200, { ok: true, action: "competition_main_decision", competitionId, result });
        return;
      }

      // POST /api/ops/competitions/:id/retained-partial  { candidateId, reusablePaths, remainingGaps, confirm }
      const retained = opsRoute.match(/^\/competitions\/([^/]+)\/retained-partial$/);
      if (retained) {
        const competitionId = decodeURIComponent(retained[1]!);
        if (body.confirm !== true) {
          this.sendJson(req, res, 422, { error: "Retained-partial requires explicit confirm: true" });
          return;
        }
        if (typeof body.candidateId !== "string" || body.candidateId.length === 0) {
          this.sendJson(req, res, 422, { error: "candidateId is required" });
          return;
        }
        const result = await this.daemonCall<unknown>("competition_retained_partial", {
          competitionId,
          candidateId: body.candidateId,
          reusablePaths: body.reusablePaths,
          remainingGaps: body.remainingGaps,
          confirm: true,
        });
        this.sendJson(req, res, 200, { ok: true, action: "competition_retained_partial", competitionId, result });
        return;
      }

      // POST /api/ops/competitions/:id/handoff
      // { candidateId, candidateRevisionId, destinationWorkerProfileId, reason, confirm: true }
      const handoff = opsRoute.match(/^\/competitions\/([^/]+)\/handoff$/);
      if (handoff) {
        const competitionId = decodeURIComponent(handoff[1]!);
        if (body.confirm !== true) {
          this.sendJson(req, res, 422, { error: "Handoff requires explicit confirm: true" });
          return;
        }
        if (typeof body.candidateId !== "string" || body.candidateId.length === 0) {
          this.sendJson(req, res, 422, { error: "candidateId is required" });
          return;
        }
        if (typeof body.candidateRevisionId !== "string" || body.candidateRevisionId.length === 0) {
          this.sendJson(req, res, 422, { error: "candidateRevisionId is required" });
          return;
        }
        if (
          typeof body.destinationWorkerProfileId !== "string"
          || body.destinationWorkerProfileId.length === 0
        ) {
          this.sendJson(req, res, 422, { error: "destinationWorkerProfileId is required" });
          return;
        }
        if (typeof body.reason !== "string" || body.reason.trim().length === 0) {
          this.sendJson(req, res, 422, { error: "reason is required" });
          return;
        }
        const result = await this.daemonCall<unknown>("competition_handoff", {
          competitionId,
          candidateId: body.candidateId,
          candidateRevisionId: body.candidateRevisionId,
          destinationWorkerProfileId: body.destinationWorkerProfileId,
          reason: body.reason.trim(),
          confirm: true,
        });
        this.sendJson(req, res, 200, { ok: true, action: "competition_handoff", competitionId, result });
        return;
      }

      // POST /api/ops/sample-task/prepare { workerProfileId, confirm: true }
      // Creates only a private disposable project + ordinary Task file, then
      // asks the canonical daemon admission path for a safe preview. No Task,
      // Attempt, Worker, Provider request, review, or Integration is started.
      if (opsRoute === "/sample-task/prepare") {
        if (!exactOwnKeys(body, ONBOARDING_SAMPLE_PREPARE_KEYS) || body.confirm !== true) {
          this.sendJson(req, res, 422, { error: "Preparing the sample requires an explicit confirmation" });
          return;
        }
        if (this.onboardingSamples === undefined) {
          this.sendJson(req, res, 503, { error: "The packaged sample is unavailable; reinstall or update ForkLight" });
          return;
        }
        const workerProfileId = typeof body.workerProfileId === "string" ? body.workerProfileId : "";
        let worker;
        try {
          worker = getWorkerProfile(this.deps.settings.get().workerProfiles, workerProfileId);
        } catch {
          this.sendJson(req, res, 422, { error: "Choose an available saved Worker" });
          return;
        }
        const readiness = (await this.resolveCurrentWorkerReadiness())
          .find((item) => item.workerId === worker.id);
        if (readiness?.canLaunch !== true) {
          this.sendJson(req, res, 422, { error: "This Worker needs attention before it can start a Task" });
          return;
        }
        try {
          const sample = await this.onboardingSamples.prepare(worker.id);
          const preview = await this.daemonCall<Record<string, unknown>>("validate_file", {
            taskFile: sample.taskFile,
          });
          if (preview.workerProfileId !== worker.id) {
            this.sendJson(req, res, 422, { error: "The prepared sample no longer matches the selected Worker" });
            return;
          }
          this.sendJson(req, res, 200, this.safeSampleProjection(sample, preview));
        } catch {
          this.sendJson(req, res, 422, {
            error: "The sample could not be prepared safely; reinstall or update ForkLight, then try again",
          });
        }
        return;
      }

      // POST /api/ops/sample-task/submit
      // Browser supplies no path. The service resolves the opaque sample,
      // freezes it as submitting before the daemon call, and records the one
      // ordinary Task id. A crash leaves outcome-unknown evidence and never
      // silently submits a duplicate.
      if (opsRoute === "/sample-task/submit") {
        if (!exactOwnKeys(body, ONBOARDING_SAMPLE_SUBMIT_KEYS) || body.confirm !== true) {
          this.sendJson(req, res, 422, { error: "Starting the sample requires an explicit confirmation" });
          return;
        }
        if (this.onboardingSamples === undefined) {
          this.sendJson(req, res, 503, { error: "The packaged sample is unavailable; reinstall or update ForkLight" });
          return;
        }
        const sampleId = typeof body.sampleId === "string" ? body.sampleId : "";
        const previewRevisionDigest = typeof body.previewRevisionDigest === "string"
          && /^[a-f0-9]{64}$/.test(body.previewRevisionDigest)
          ? body.previewRevisionDigest
          : "";
        if (!previewRevisionDigest) {
          this.sendJson(req, res, 422, { error: "Preview the sample again before starting" });
          return;
        }
        let lease;
        try {
          lease = await this.onboardingSamples.acquireSubmission(sampleId);
        } catch {
          this.sendJson(req, res, 422, { error: "This sample cannot be started again; inspect the Board for its outcome" });
          return;
        }
        if (lease.alreadySubmitted) {
          this.sendJson(req, res, 200, {
            ...this.safeSampleProjection(lease.sample),
            alreadySubmitted: true,
          });
          return;
        }
        try {
          const task = await this.daemonCall<{ id: string; name: string; status: string }>(
            "submit_file",
            {
              taskFile: lease.sample.taskFile,
              expectedPreviewRevisionDigest: previewRevisionDigest,
            },
          );
          const committed = await lease.commit(task.id);
          this.sendJson(req, res, 200, {
            available: true,
            state: committed.state,
            sampleId: committed.sampleId,
            workerProfileId: committed.workerProfileId,
            taskId: committed.taskId,
            alreadySubmitted: false,
            task: { id: task.id, name: task.name, status: task.status },
          });
        } catch (error) {
          await lease.abort();
          const message = error instanceof Error ? error.message : "";
          this.sendJson(req, res, 422, {
            error: message.includes("out of date")
              ? "The sample preview is out of date; prepare it again before starting"
              : "The sample Task was not started; prepare it again or inspect Worker readiness",
          });
        }
        return;
      }

      // POST /api/ops/tasks/preview  { filePath }
      // Read-only bridge to daemon validate_file. Never calls submit_file and
      // never asks for confirm. Returns only the safe admission preview plus the
      // preview revision digest the bound submit route must echo back.
      if (opsRoute === "/tasks/preview") {
        const filePath = typeof body.filePath === "string" ? body.filePath.trim() : "";
        if (!filePath || filePath.length > 8192 || !path.isAbsolute(filePath)) {
          this.sendJson(req, res, 422, { error: "An absolute task contract file path is required" });
          return;
        }
        try {
          const preview = await this.daemonCall<Record<string, unknown>>("validate_file", {
            taskFile: filePath,
          });
          this.sendJson(req, res, 200, { ok: true, preview });
        } catch (_daemonError) {
          this.sendJson(req, res, 422, { error: "Task contract preview rejected by daemon" });
        }
        return;
      }

      // POST /api/ops/tasks/submit  { filePath, previewRevisionDigest, confirm: true }
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
        const previewRevisionDigest = typeof body.previewRevisionDigest === "string"
          ? body.previewRevisionDigest
          : "";
        if (!previewRevisionDigest) {
          this.sendJson(req, res, 422, {
            error: "Task submission requires a fresh preview; preview again before submitting",
          });
          return;
        }
        try {
          const task = await this.daemonCall<{ id: string; name: string; status: string }>(
            "submit_file",
            { taskFile: filePath, expectedPreviewRevisionDigest: previewRevisionDigest },
          );
          this.sendJson(req, res, 200, {
            ok: true,
            action: "submit_file",
            taskId: task.id,
            task: { id: task.id, name: task.name, status: task.status },
          });
        } catch (_daemonError) {
          const msg = _daemonError instanceof Error ? _daemonError.message : String(_daemonError);
          // The daemon's bounded stale-preview reason becomes a "preview again"
          // instruction; any other rejection stays behind the fixed bounded
          // message so raw daemon text, file content, path, or command is never
          // echoed.
          if (msg.includes("out of date")) {
            this.sendJson(req, res, 422, {
              error: "Task preview is out of date; preview again before submitting",
            });
          } else {
            this.sendJson(req, res, 422, { error: "Task contract submission rejected by daemon" });
          }
        }
        return;
      }

      // POST /api/ops/tasks/reuse-class
      // { filePath, previewRevisionDigest, taskClass, confirm: true }
      // Preview-bound draft-only classification reuse. The daemon rechecks
      // every authority condition; the Hub never recomputes eligibility,
      // counts, digest, or file success. On success the browser replaces the
      // old preview with the returned fresh preview; on failure the browser
      // invalidates submission and asks the user to preview again. This route
      // never creates a Task or starts a Worker.
      if (opsRoute === "/tasks/reuse-class") {
        if (body.confirm !== true) {
          this.sendJson(req, res, 422, { error: "Applying a class requires confirm: true" });
          return;
        }
        const filePath = typeof body.filePath === "string" ? body.filePath.trim() : "";
        if (!filePath || filePath.length > 8192 || !path.isAbsolute(filePath)) {
          this.sendJson(req, res, 422, { error: "An absolute task contract file path is required" });
          return;
        }
        const previewRevisionDigest = typeof body.previewRevisionDigest === "string"
          ? body.previewRevisionDigest
          : "";
        if (!previewRevisionDigest) {
          this.sendJson(req, res, 422, {
            error: "Preview the task contract again before applying a class",
          });
          return;
        }
        const taskClass = typeof body.taskClass === "string" ? body.taskClass.trim() : "";
        if (!taskClass || taskClass.length > 80) {
          this.sendJson(req, res, 422, {
            error: "Choose one displayed existing class to apply",
          });
          return;
        }
        try {
          const preview = await this.daemonCall<Record<string, unknown>>(
            "reuse_task_class",
            {
              taskFile: filePath,
              expectedPreviewRevisionDigest: previewRevisionDigest,
              taskClass,
              confirm: true,
            },
          );
          this.sendJson(req, res, 200, {
            ok: true,
            action: "reuse_task_class",
            preview,
          });
        } catch (_daemonError) {
          const msg = _daemonError instanceof Error ? _daemonError.message : String(_daemonError);
          // Stale preview and forged/repeated candidates all become a
          // "preview again and choose a listed class" instruction. Any other
          // rejection stays behind the fixed bounded message so raw daemon
          // text, file content, path, or command is never echoed.
          if (msg.includes("out of date") || msg.includes("preview again")) {
            this.sendJson(req, res, 422, {
              error: "The task preview is out of date; preview again before applying",
            });
          } else {
            this.sendJson(req, res, 422, {
              error: "The class could not be applied; preview again and choose a listed class",
            });
          }
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
