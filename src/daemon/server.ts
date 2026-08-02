import { chmod, link, mkdir, readFile, stat, unlink } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { createInterface } from "node:readline";
import YAML from "yaml";
import { daemonSocketPath } from "../core/config.js";
import { parseRemediationAmendmentInput } from "../core/main-remediation.js";
import { SettingsService } from "../core/settings.js";
import {
  projectCompactProviderModelSummaries,
  type StatisticsDetail,
  type StatisticsFilter,
} from "../core/statistics.js";
import type { AttemptAuthorization, TaskStatus } from "../core/types.js";
import {
  isTaskResolutionReason,
  TASK_RESOLUTION_EVIDENCE_ID_MAX_LENGTH,
  TASK_RESOLUTION_NOTE_MAX_LENGTH,
} from "../core/task-resolution.js";
import { StateStore } from "../state/store.js";
import { DaemonCoordinator } from "./coordinator.js";
import type { TaskHistoryPageRequest } from "../core/task-history.js";
import { HISTORY_INVALID_REQUEST_REASON } from "../core/task-history.js";
import type { ProviderAuthInspector } from "../core/providers.js";
import type { DaemonRequest, DaemonResponse, DaemonShutdownIntent } from "./protocol.js";
import { parseDaemonShutdownIntent, requiresMatchingBuildIdentity } from "./protocol.js";
import {
  compareBuildIdentity,
  currentBuildIdentity,
  isBuildIdentity,
  type BuildIdentity,
} from "../core/build-identity.js";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function strictObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a non-null object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requiredBoundedString(value: unknown, label: string): string {
  const result = requiredString(value, label);
  if (result.length > 80) throw new Error(`${label} must be at most 80 characters`);
  return result;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function activationEvidence(value: unknown): import("../core/types.js").IntegrationStageEvidence {
  const input = strictObject(value, "activation evidence");
  const allowed = new Set(["stage", "status", "commands", "error"]);
  const extra = Object.keys(input).filter((key) => !allowed.has(key));
  if (extra.length > 0) {
    throw new Error(`activation evidence contains unknown fields: ${extra.join(", ")}`);
  }
  if (input.stage !== "runtime-activated") {
    throw new Error("activation evidence stage must be runtime-activated");
  }
  if (input.status !== "passed" && input.status !== "failed") {
    throw new Error("activation evidence status must be passed or failed");
  }
  if (!Array.isArray(input.commands) && input.commands !== undefined) {
    throw new Error("activation evidence commands must be an array");
  }
  const commands = (input.commands ?? []) as unknown[];
  if (commands.length > 32) throw new Error("activation evidence has too many commands");
  for (const command of commands) {
    const record = strictObject(command, "activation command evidence");
    if (
      typeof record.command !== "string"
      || record.command.length === 0
      || record.command.length > 10_000
      || !Number.isSafeInteger(record.exitCode)
      || typeof record.stdout !== "string"
      || typeof record.stderr !== "string"
      || typeof record.durationMs !== "number"
      || typeof record.timedOut !== "boolean"
    ) {
      throw new Error("activation command evidence is malformed");
    }
  }
  const error = input.error;
  if (error !== undefined && (typeof error !== "string" || error.length > 10_000)) {
    throw new Error("activation evidence error must be at most 10000 characters");
  }
  return {
    stage: "runtime-activated",
    status: input.status,
    ...(commands.length === 0
      ? {}
      : { commands: commands as import("../core/types.js").VerificationCommandResult[] }),
    ...(typeof error === "string" ? { error } : {}),
  };
}

function parseAttemptAuthorization(value: unknown): AttemptAuthorization | undefined {
  if (value === undefined) return undefined;
  const input = strictObject(value, "authorization");
  const allowed = new Set(["additionalAttempts", "maxBudgetUsd", "reason", "confirm"]);
  const extra = Object.keys(input).filter((key) => !allowed.has(key));
  if (extra.length > 0) throw new Error(`authorization contains unknown fields: ${extra.join(", ")}`);
  if (input.additionalAttempts !== 1) {
    throw new Error("authorization.additionalAttempts must equal 1");
  }
  if (input.confirm !== true) throw new Error("authorization.confirm must be true");
  const reason = requiredString(input.reason, "authorization.reason").trim();
  if (reason.length > 1000) throw new Error("authorization.reason must be at most 1000 characters");
  const maxBudgetUsd = input.maxBudgetUsd;
  if (
    maxBudgetUsd !== null
    && (typeof maxBudgetUsd !== "number" || !Number.isFinite(maxBudgetUsd) || maxBudgetUsd <= 0)
  ) {
    throw new Error("authorization.maxBudgetUsd must be null or a finite positive number");
  }
  return {
    additionalAttempts: 1,
    maxBudgetUsd,
    reason,
    confirm: true,
  };
}

/** Parse and validate Competition candidate overrides. Each candidate is either
 *  a saved Worker Profile reference (workerProfileId, new reasoned entrance) or
 *  a legacy provider/model pair. Per-candidate maxBudgetUsd is optional. */
function parseCompetitionCandidates(value: unknown): import("../core/competition.js").CandidateOverride[] {
  const arr = requireArray(value, "candidates");
  if (arr.length === 0) throw new Error("candidates must be a non-empty array");
  return arr.map((raw, i) => {
    const obj = strictObject(raw, `candidates[${i}]`);
    const allowed = new Set(["providerName", "modelName", "maxBudgetUsd", "workerProfileId"]);
    const extra = Object.keys(obj).filter((key) => !allowed.has(key));
    if (extra.length > 0) {
      throw new Error(`candidates[${i}] contains unknown fields: ${extra.join(", ")}`);
    }
    const candidate: import("../core/competition.js").CandidateOverride = {};
    if (obj.providerName !== undefined) {
      if (typeof obj.providerName !== "string" || obj.providerName.trim().length === 0) {
        throw new Error(`candidates[${i}].providerName must be a non-empty string`);
      }
      candidate.providerName = obj.providerName;
    }
    if (obj.modelName !== undefined) {
      if (typeof obj.modelName !== "string" || obj.modelName.trim().length === 0) {
        throw new Error(`candidates[${i}].modelName must be a non-empty string`);
      }
      candidate.modelName = obj.modelName;
    }
    if (obj.workerProfileId !== undefined) {
      if (typeof obj.workerProfileId !== "string" || obj.workerProfileId.trim().length === 0) {
        throw new Error(`candidates[${i}].workerProfileId must be a non-empty string`);
      }
      candidate.workerProfileId = obj.workerProfileId;
    }
    if (obj.maxBudgetUsd !== undefined) {
      if (obj.maxBudgetUsd !== null
        && (typeof obj.maxBudgetUsd !== "number" || !Number.isFinite(obj.maxBudgetUsd) || obj.maxBudgetUsd <= 0)) {
        throw new Error(`candidates[${i}].maxBudgetUsd must be null or a finite positive number`);
      }
      candidate.maxBudgetUsd = obj.maxBudgetUsd as number | null;
    }
    return candidate;
  });
}

/** Parse optional Competition admission options: a bounded Main reason and/or
 *  an explicit legacy flag. Absent options keep the legacy explicit behavior.
 *  The reason content is re-validated by CompetitionCoordinator admission. */
function parseCompetitionOptions(
  params: Record<string, unknown>,
): import("../core/competition.js").CompetitionCreateOptions {
  const options: import("../core/competition.js").CompetitionCreateOptions = {};
  if (params.reason !== undefined) {
    const r = strictObject(params.reason, "reason");
    const allowed = new Set(["intent", "triggers", "note"]);
    const extra = Object.keys(r).filter((key) => !allowed.has(key));
    if (extra.length > 0) throw new Error(`reason contains unknown fields: ${extra.join(", ")}`);
    options.reason = r as unknown as import("../core/competition.js").CompetitionReasonInput;
  }
  if (params.legacy === true) options.legacy = true;
  return options;
}

export class ForkLightDaemon {
  private readonly store: StateStore;
  private readonly settingsService: SettingsService;
  private readonly coordinator: DaemonCoordinator;
  private readonly socketPath: string;
  private server: net.Server | undefined = undefined;
  private ownedSocket: { dev: number; ino: number } | undefined = undefined;
  private readonly buildIdentity: BuildIdentity = currentBuildIdentity();
  /** Intent captured from an authenticated shutdown request; defaults to stop. */
  private shutdownIntent: DaemonShutdownIntent = "stop";

  constructor(
    home: string,
    maxConcurrency?: number,
    providerAuthInspector?: ProviderAuthInspector,
  ) {
    this.store = new StateStore(home);
    this.settingsService = new SettingsService(this.store);
    this.coordinator = new DaemonCoordinator(
      this.store,
      this.settingsService,
      maxConcurrency,
      providerAuthInspector,
    );
    this.socketPath = daemonSocketPath(home);
  }

  async start(): Promise<void> {
    await mkdir(path.dirname(this.socketPath), { recursive: true, mode: 0o700 });
    let staleSocket: { dev: number; ino: number } | undefined;
    try {
      const candidate = await stat(this.socketPath);
      if (!candidate.isSocket()) {
        throw new Error("ForkLight daemon path exists but is not a socket");
      }
      staleSocket = { dev: candidate.dev, ino: candidate.ino };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (staleSocket) {
      if (await this.probeSocketEndpoint()) {
        throw new Error("ForkLight daemon is already running on this home");
      }
      let current;
      try {
        current = await stat(this.socketPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error("ForkLight daemon socket changed after probing; refusing to unlink");
        }
        throw error;
      }
      if (current.dev !== staleSocket.dev || current.ino !== staleSocket.ino) {
        throw new Error("ForkLight daemon socket changed after probing; refusing to unlink");
      }
      await unlink(this.socketPath);
    }
    await this.coordinator.recover();
    this.server = net.createServer((socket) => {
      this.attachConnection(socket);
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.socketPath, resolve);
    });
    await chmod(this.socketPath, 0o600);
    const owned = await stat(this.socketPath);
    this.ownedSocket = { dev: owned.dev, ino: owned.ino };
  }

  /**
   * Per-connection transport boundary.
   *
   * Peer disconnect, reset, EPIPE, and writes to a destroyed stream are
   * connection-local delivery loss only. An already-started handleLine/dispatch
   * continues exactly once; transport loss never retries, cancels, or rewrites
   * operation outcomes.
   */
  private attachConnection(socket: net.Socket): void {
    let deliverable = true;
    let cleanedUp = false;
    const lines = createInterface({ input: socket, crlfDelay: Infinity });

    const markUndeliverable = (): void => {
      deliverable = false;
    };

    const cleanup = (): void => {
      if (cleanedUp) return;
      cleanedUp = true;
      deliverable = false;
      lines.close();
      if (!socket.destroyed) {
        socket.destroy();
      }
    };

    // Install socket and readline error handling before any request processing.
    // An empty socket listener alone is not enough: readline can also emit.
    socket.on("error", () => {
      markUndeliverable();
      cleanup();
    });
    lines.on("error", () => {
      markUndeliverable();
      cleanup();
    });
    socket.on("close", cleanup);

    const writeResponse = (response: DaemonResponse): void => {
      if (!deliverable || socket.destroyed || !socket.writable) return;
      try {
        socket.write(`${JSON.stringify(response)}\n`, (error) => {
          if (error) {
            markUndeliverable();
          }
        });
      } catch {
        // Synchronous write failure is still connection-local delivery loss.
        markUndeliverable();
      }
    };

    lines.on("line", (line) => {
      // Dispatch runs exactly once even if the peer disappears mid-flight.
      void this.handleLine(line).then(writeResponse);
    });
  }

  private probeSocketEndpoint(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection(this.socketPath);
      socket.setTimeout(200);
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => { socket.destroy(); resolve(false); });
      socket.once("timeout", () => { socket.destroy(); resolve(false); });
    });
  }

  async close(): Promise<void> {
    try {
      await this.coordinator.shutdown(this.shutdownIntent);
      let backupPath: string | undefined;
      if (this.server && this.ownedSocket) {
        let current: Awaited<ReturnType<typeof stat>> | undefined;
        try {
          current = await stat(this.socketPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (current && (current.dev !== this.ownedSocket.dev || current.ino !== this.ownedSocket.ino)) {
          backupPath = `${this.socketPath}.closing-${process.pid}-${Date.now()}`;
          await link(this.socketPath, backupPath);
          const preserved = await stat(backupPath);
          if (preserved.dev === this.ownedSocket.dev && preserved.ino === this.ownedSocket.ino) {
            await unlink(backupPath);
            backupPath = undefined;
          }
        }
      }
      if (this.server) {
        await new Promise<void>((resolve, reject) => {
          this.server?.close((error) => error ? reject(error) : resolve());
        });
      }
      if (backupPath) {
        try {
          await link(backupPath, this.socketPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          const [canonical, backup] = await Promise.all([stat(this.socketPath), stat(backupPath)]);
          if (canonical.dev !== backup.dev || canonical.ino !== backup.ino) {
            throw new Error(`ForkLight replacement socket preserved at ${backupPath}; canonical path is occupied`);
          }
        }
        await unlink(backupPath);
      }
    } finally {
      this.store.close();
    }
  }

  private async handleLine(line: string): Promise<DaemonResponse> {
    let request: DaemonRequest;
    try {
      request = JSON.parse(line) as DaemonRequest;
      if (!request.id || !request.method) throw new Error("Malformed daemon request");
      const comparison = isBuildIdentity(request.clientIdentity)
        ? compareBuildIdentity(request.clientIdentity, this.buildIdentity)
        : { protocolCompatible: false, sameBuild: false };
      if (request.method === "activation_handoff_shutdown") {
        if (!comparison.protocolCompatible) {
          throw new Error("ForkLight protocol mismatch; rebuild and restart before changes");
        }
      } else if (requiresMatchingBuildIdentity(request.method)) {
        if (!comparison.protocolCompatible) {
          throw new Error("ForkLight protocol mismatch; rebuild and restart before changes");
        }
        if (!comparison.sameBuild) {
          throw new Error("ForkLight build mismatch; rebuild and restart before changes");
        }
      }
      const result = await this.dispatch(request);
      const warning = comparison.protocolCompatible
        ? comparison.sameBuild
          ? undefined
          : "ForkLight client/daemon build mismatch; rebuild and restart before changes"
        : "ForkLight client/daemon protocol mismatch; rebuild and restart before changes";
      return {
        id: request.id,
        ok: true,
        result,
        serverIdentity: this.buildIdentity,
        ...(warning === undefined ? {} : { warning }),
      };
    } catch (error) {
      const fallbackId = (() => {
        try {
          return (JSON.parse(line) as { id?: string }).id ?? "unknown";
        } catch {
          return "unknown";
        }
      })();
      return {
        id: fallbackId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        serverIdentity: this.buildIdentity,
      };
    }
  }

  private async dispatch(request: DaemonRequest): Promise<unknown> {
    const params = object(request.params);
    switch (request.method) {
      case "health":
        return this.coordinator.health();
      case "validate_file":
        return this.coordinator.validateFile(requiredString(params.taskFile, "taskFile"));
      case "reuse_task_class":
        if (params.confirm !== true) {
          throw new Error("reuse_task_class requires explicit confirm: true");
        }
        return this.coordinator.reuseTaskClass({
          taskFile: requiredString(params.taskFile, "taskFile"),
          expectedPreviewRevisionDigest: requiredString(
            params.expectedPreviewRevisionDigest,
            "expectedPreviewRevisionDigest",
          ),
          taskClass: requiredString(params.taskClass, "taskClass"),
          confirm: true,
        });
      case "submit_file":
        return this.coordinator.submitFile(
          requiredString(params.taskFile, "taskFile"),
          params.expectedPreviewRevisionDigest,
        );
      case "submit":
        return this.coordinator.submit(
          params.task,
          typeof params.baseDirectory === "string" ? params.baseDirectory : process.cwd(),
        );
      case "status":
        return this.coordinator.status(requiredString(params.taskId, "taskId"));
      case "inspect":
        return this.coordinator.inspect(requiredString(params.taskId, "taskId"));
      case "task_decision":
        return this.coordinator.taskDecision(requiredString(params.taskId, "taskId"));
      case "checkpoint_run":
        return this.coordinator.checkpoint({
          taskId: requiredString(params.taskId, "taskId"),
          attemptId: requiredString(params.attemptId, "attemptId"),
          ...(params.commandIds === undefined
            ? {}
            : {
                commandIds: requireArray(params.commandIds, "commandIds").map(
                  (value, index) => requiredBoundedString(value, `commandIds[${index}]`),
                ),
              }),
        });
      case "resume":
        return this.coordinator.resume(
          requiredString(params.taskId, "taskId"),
          typeof params.feedback === "string" && params.feedback.trim() ? params.feedback.trim() : undefined,
          parseAttemptAuthorization(params.authorization),
        );
      case "main_review": {
        if (params.confirm !== true) throw new Error("main_review requires explicit confirm: true");
        const decision = requiredString(params.decision, "decision");
        if (decision !== "accept" && decision !== "revise" && decision !== "reject") {
          throw new Error("decision must be accept, revise, or reject");
        }
        const reason = requiredString(params.reason, "reason").trim();
        if (reason.length > 1000) throw new Error("reason must be at most 1000 characters");
        return this.coordinator.mainReview(
          requiredString(params.taskId, "taskId"),
          decision,
          reason,
          true,
        );
      }
      case "main_failure_attribution": {
        if (params.confirm !== true) {
          throw new Error("main_failure_attribution requires explicit confirm: true");
        }
        return this.coordinator.mainFailureAttribution(
          requiredString(params.taskId, "taskId"),
          {
            attemptId: requiredString(params.attemptId, "attemptId"),
            verificationEventSequence: Number(params.verificationEventSequence),
            cause: requiredString(params.cause, "cause") as never,
            note: requiredString(params.note, "note"),
            ...(params.candidateRevisionId === undefined
              ? {}
              : { candidateRevisionId: requiredString(params.candidateRevisionId, "candidateRevisionId") }),
            ...(params.candidatePatchDigest === undefined
              ? {}
              : { candidatePatchDigest: requiredString(params.candidatePatchDigest, "candidatePatchDigest") }),
            confirm: true,
          },
        );
      }
      case "main_failure_attribution_projection":
        return this.coordinator.mainFailureAttributionProjection(
          requiredString(params.taskId, "taskId"),
        );
      case "task_resolve": {
        if (params.confirm !== true) throw new Error("task_resolve requires explicit confirm: true");
        const reason = requiredString(params.reason, "reason");
        if (!isTaskResolutionReason(reason)) {
          throw new Error("reason must be a bounded resolution reason");
        }
        const note = (() => {
          if (params.note === undefined) return undefined;
          if (typeof params.note !== "string") throw new Error("note must be a string when provided");
          const trimmed = params.note.trim();
          if (trimmed.length > TASK_RESOLUTION_NOTE_MAX_LENGTH) {
            throw new Error(`note must be at most ${TASK_RESOLUTION_NOTE_MAX_LENGTH} characters`);
          }
          return trimmed.length > 0 ? trimmed : undefined;
        })();
        const evidenceTaskId = params.evidenceTaskId === undefined
          ? undefined
          : requiredString(params.evidenceTaskId, "evidenceTaskId").trim();
        if (
          evidenceTaskId !== undefined
          && (evidenceTaskId.length < 1
            || evidenceTaskId.length > TASK_RESOLUTION_EVIDENCE_ID_MAX_LENGTH)
        ) {
          throw new Error(
            `evidenceTaskId must be 1-${TASK_RESOLUTION_EVIDENCE_ID_MAX_LENGTH} characters`,
          );
        }
        return this.coordinator.resolveTask(
          requiredString(params.taskId, "taskId"),
          reason,
          note,
          evidenceTaskId,
          true,
        );
      }
      case "task_reopen": {
        if (params.confirm !== true) throw new Error("task_reopen requires explicit confirm: true");
        const note = (() => {
          if (params.note === undefined) return undefined;
          if (typeof params.note !== "string") throw new Error("note must be a string when provided");
          const trimmed = params.note.trim();
          if (trimmed.length > TASK_RESOLUTION_NOTE_MAX_LENGTH) {
            throw new Error(`note must be at most ${TASK_RESOLUTION_NOTE_MAX_LENGTH} characters`);
          }
          return trimmed.length > 0 ? trimmed : undefined;
        })();
        return this.coordinator.reopenTask(
          requiredString(params.taskId, "taskId"),
          note,
          true,
        );
      }
      case "revise": {
        // Non-string feedback is routed through the shared eligibility
        // boundary as an empty string so checkReviseEligibility produces
        // the same canonical "missing-feedback" reason the local path uses.
        const feedback = typeof params.feedback === "string" ? params.feedback : "";
        return this.coordinator.revise(
          requiredString(params.taskId, "taskId"),
          feedback,
          parseAttemptAuthorization(params.authorization),
        );
      }
      case "correct": {
        if (params.confirm !== true) throw new Error("correct requires explicit confirm: true");
        const correctFeedback = requiredString(params.feedback, "feedback").trim();
        if (correctFeedback.length === 0 || correctFeedback.length > 1000) {
          throw new Error("correction feedback must be 1-1000 characters");
        }
        const correctBudget = params.maxBudgetUsd === undefined || params.maxBudgetUsd === null
          ? null
          : (() => {
              const value = Number(params.maxBudgetUsd);
              if (!Number.isFinite(value) || value <= 0) {
                throw new Error("correction maxBudgetUsd must be a positive number or null");
              }
              return value;
            })();
        return this.coordinator.correct(
          requiredString(params.taskId, "taskId"),
          correctFeedback,
          correctBudget,
          true,
          params.candidateRevisionId,
          params.reusablePaths,
          params.remainingGaps,
        );
      }
      case "list": {
        const statuses = Array.isArray(params.statuses)
          ? params.statuses.filter((value): value is TaskStatus => typeof value === "string")
          : undefined;
        const limit = typeof params.limit === "number" ? params.limit : 20;
        return this.coordinator.list(statuses, limit);
      }
      case "list_summaries": {
        const statuses = Array.isArray(params.statuses)
          ? params.statuses.filter((value): value is TaskStatus => typeof value === "string")
          : undefined;
        const limit = typeof params.limit === "number" ? params.limit : 20;
        return this.coordinator.listTaskSurfaces(statuses, limit);
      }
      case "list_history_page": {
        // Read-only durable History page. The Core paginator validates the
        // bounded limit/query/cursor and fails closed with a fixed privacy-safe
        // reason for any out-of-range or contradictory value.
        const historyRequest: TaskHistoryPageRequest = {};
        if (params.limit !== undefined) {
          if (typeof params.limit !== "number") {
            // Reuse the Core's fixed privacy-safe reason so a malformed limit
            // never echoes the value, a path, or Task content.
            throw new Error(HISTORY_INVALID_REQUEST_REASON);
          }
          historyRequest.limit = params.limit;
        }
        if (params.query !== undefined) {
          if (typeof params.query !== "string") {
            throw new Error(HISTORY_INVALID_REQUEST_REASON);
          }
          historyRequest.query = params.query;
        }
        if (params.cursor !== undefined) {
          if (typeof params.cursor !== "string" || params.cursor.length === 0) {
            throw new Error(HISTORY_INVALID_REQUEST_REASON);
          }
          historyRequest.cursor = params.cursor;
        }
        return this.coordinator.listHistoryPage(historyRequest);
      }
      case "plan_submit_file":
        return this.coordinator.submitPlanFile(requiredString(params.planFile, "planFile"));
      case "plan_board":
        return this.coordinator.getPlanBoard(requiredString(params.planId, "planId"));
      case "plan_board_overview":
        return this.coordinator.listPlanBoards(
          typeof params.limit === "number" ? params.limit : undefined,
        );
      case "task_plan_context":
        return this.coordinator.getTaskPlanContext(requiredString(params.taskId, "taskId"));
      case "statistics": {
        const detailRaw = params.detail;
        let detail: StatisticsDetail = "compact";
        if (detailRaw !== undefined) {
          if (detailRaw !== "compact" && detailRaw !== "full") {
            throw new Error('statistics detail must be "compact" or "full"');
          }
          detail = detailRaw;
        }
        const filter: StatisticsFilter = {
          ...(typeof params.providerName === "string" ? { providerName: params.providerName } : {}),
          ...(typeof params.modelName === "string" ? { modelName: params.modelName } : {}),
          ...(typeof params.since === "string" ? { since: params.since } : {}),
          ...(typeof params.until === "string" ? { until: params.until } : {}),
        };
        const full = this.coordinator.statistics(filter);
        return detail === "full" ? full : projectCompactProviderModelSummaries(full);
      }
      case "settings_get":
        return this.coordinator.getSettings();
      case "settings_update":
        return this.coordinator.updateSettings(strictObject(params.patch, "settings patch"));
      case "settings_apply_file": {
        const filePath = requiredString(params.file, "file");
        const rawText = await readFile(filePath, "utf8");
        const parsed = filePath.endsWith(".json")
          ? JSON.parse(rawText)
          : YAML.parse(rawText);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Settings file must contain a YAML or JSON object");
        }
        return this.coordinator.updateSettings(parsed as Record<string, unknown>);
      }
      case "settings_reset":
        return this.coordinator.resetSettings();
      case "integration_preflight":
        return this.coordinator.integrationPreflight(requiredString(params.taskId, "taskId"));
      case "integration_apply": {
        if (params.confirm !== true) {
          throw new Error("integration_apply requires explicit confirm: true");
        }
        return this.coordinator.startIntegration(
          requiredString(params.taskId, "taskId"),
          requiredString(params.receiptId, "receiptId"),
        );
      }
      case "integration_status":
        return this.coordinator.integrationStatus(
          requiredString(params.operationId, "operationId"),
        );
      case "integration_wait":
        return this.coordinator.waitIntegration(
          requiredString(params.operationId, "operationId"),
          params.timeoutMs as number,
        );
      case "integration_activation_complete":
        return this.coordinator.completeIntegrationActivation(
          requiredString(params.operationId, "operationId"),
          requiredString(params.taskId, "taskId"),
          requiredString(params.receiptId, "receiptId"),
          activationEvidence(params.evidence),
        );
      case "integration_history":
        return this.coordinator.integrationHistory(requiredString(params.taskId, "taskId"));
      case "activation_handoff_shutdown":
        return this.coordinator.authorizeActivationHandoffShutdown(
          requiredString(params.operationId, "operationId"),
          requiredString(params.taskId, "taskId"),
          requiredString(params.receiptId, "receiptId"),
        );
      case "shutdown": {
        // Closed stop/restart intent. Omitted or legacy clients stay on stop.
        this.shutdownIntent = parseDaemonShutdownIntent(params.intent);
        setImmediate(() => process.kill(process.pid, "SIGTERM"));
        return { stopping: true, intent: this.shutdownIntent };
      }
      case "competition_submit_file":
        return this.coordinator.submitCompetitionFile(
          requiredString(params.taskFile, "taskFile"),
          parseCompetitionCandidates(params.candidates),
          parseCompetitionOptions(params),
        );
      case "competition_submit":
        return this.coordinator.submitInlineCompetition(
          params.task,
          typeof params.baseDirectory === "string" ? params.baseDirectory : process.cwd(),
          parseCompetitionCandidates(params.candidates),
          parseCompetitionOptions(params),
        );
      case "competition_status":
        return this.coordinator.competitionStatus(requiredString(params.competitionId, "competitionId"));
      case "competition_main_decision": {
        if (params.confirm !== true) {
          throw new Error("competition_main_decision requires explicit confirm: true");
        }
        const decision = requiredString(params.decision, "decision");
        if (decision !== "accept" && decision !== "revise" && decision !== "reject") {
          throw new Error("decision must be accept, revise, or reject");
        }
        const reason = requiredString(params.reason, "reason").trim();
        if (reason.length === 0 || reason.length > 1000) {
          throw new Error("reason must be 1-1000 characters");
        }
        return this.coordinator.competitionMainDecision(
          requiredString(params.competitionId, "competitionId"),
          requiredString(params.candidateId, "candidateId"),
          decision as "accept" | "revise" | "reject",
          reason,
          true,
        );
      }
      case "competition_retained_partial": {
        if (params.confirm !== true) {
          throw new Error("competition_retained_partial requires explicit confirm: true");
        }
        return this.coordinator.competitionRetainedPartial(
          requiredString(params.competitionId, "competitionId"),
          requiredString(params.candidateId, "candidateId"),
          params.reusablePaths,
          params.remainingGaps,
          true,
        );
      }
      case "competition_handoff": {
        if (params.confirm !== true) {
          throw new Error("competition_handoff requires explicit confirm: true");
        }
        return this.coordinator.competitionHandoff({
          competitionId: requiredString(params.competitionId, "competitionId"),
          candidateId: requiredString(params.candidateId, "candidateId"),
          candidateRevisionId: requiredString(params.candidateRevisionId, "candidateRevisionId"),
          destinationWorkerProfileId: requiredString(
            params.destinationWorkerProfileId,
            "destinationWorkerProfileId",
          ),
          reason: requiredString(params.reason, "reason"),
          confirm: true,
        });
      }
      case "competition_compare": {
        const override = typeof params.rankingWeights === "object" && params.rankingWeights !== null
          ? params.rankingWeights as import("../core/competition.js").RankingPolicyOverride
          : undefined;
        return this.coordinator.competitionCompare(
          requiredString(params.competitionId, "competitionId"),
          override,
        );
      }
      case "competition_list": {
        const statusParam = typeof params.status === "string" ? params.status : undefined;
        return this.coordinator.competitionList(statusParam);
      }
      case "provider_status": {
        const providerName = typeof params.provider === "string" && params.provider.trim()
          ? params.provider.trim()
          : undefined;
        return this.coordinator.providerStatus(providerName);
      }
      case "provider_probe": {
        const providerName = typeof params.provider === "string" && params.provider.trim()
          ? params.provider.trim()
          : undefined;
        return this.coordinator.providerProbe(providerName);
      }
      case "task_economics":
        return this.coordinator.taskEconomics(requiredString(params.taskId, "taskId"));
      case "economics_summary": {
        const filter: StatisticsFilter = {
          ...(typeof params.providerName === "string" ? { providerName: params.providerName } : {}),
          ...(typeof params.modelName === "string" ? { modelName: params.modelName } : {}),
          ...(typeof params.since === "string" ? { since: params.since } : {}),
          ...(typeof params.until === "string" ? { until: params.until } : {}),
        };
        return this.coordinator.economicsSummary(filter);
      }
      case "routing_evidence_coverage":
        // Read-only aggregate — no filter params, no Provider, no mutation.
        return this.coordinator.routingEvidenceCoverage();
      case "direct_codex_capture":
        return this.coordinator.directCodexCapture(params.usage, params.metadata);
      case "direct_codex_guided_capture":
        return this.coordinator.directCodexGuidedCapture(
          params.forklightTaskId,
          params.codexRunRef,
          params.usage,
        );
      case "direct_codex_inbox":
        return this.coordinator.directCodexInbox(params.taskClass, params.directCodexProfileId);
      case "direct_codex_review":
        return this.coordinator.directCodexReview(params);
      case "direct_codex_publication_preview":
        return this.coordinator.directCodexPublicationPreview(params);
      case "direct_codex_publication_register":
        return this.coordinator.directCodexPublicationRegister(params);
      case "adaptation_preview":
        return this.coordinator.adaptationPreview({
          taskId: requiredString(params.taskId, "taskId"),
          patch: params.patch,
          reason: typeof params.reason === "string" ? params.reason : undefined,
        });
      case "adaptation_apply": {
        if (params.confirm !== true) {
          throw new Error("adaptation_apply requires explicit confirm: true");
        }
        return this.coordinator.adaptationApply({
          taskId: requiredString(params.taskId, "taskId"),
          patch: params.patch,
          reason: typeof params.reason === "string" ? params.reason : undefined,
          confirm: true,
        });
      }
      case "remediation_verify": {
        if (params.confirm !== true) {
          throw new Error("remediation_verify requires explicit confirm: true");
        }
        const reason = requiredString(params.reason, "reason").trim();
        if (reason.length > 1000) throw new Error("reason must be at most 1000 characters");
        const amendment = parseRemediationAmendmentInput(params.amendment);
        return this.coordinator.remediationVerify(
          requiredString(params.taskId, "taskId"),
          reason,
          true,
          amendment,
        );
      }
      case "candidate_reverify": {
        if (params.confirm !== true) {
          throw new Error("candidate_reverify requires explicit confirm: true");
        }
        const reason = requiredString(params.reason, "reason").trim();
        if (reason.length > 1000) throw new Error("reason must be at most 1000 characters");
        return this.coordinator.reverifyCandidate(
          requiredString(params.taskId, "taskId"),
          reason,
          true,
        );
      }
      case "candidate_reverify_eligibility":
        return this.coordinator.candidateReverificationEligibility(
          requiredString(params.taskId, "taskId"),
        );
      case "correction_eligibility":
        return this.coordinator.correctionEligibility(
          requiredString(params.taskId, "taskId"),
        );
      case "review_graph_create": {
        if (params.confirm !== true) {
          throw new Error("review_graph_create requires explicit confirm: true");
        }
        const reason = requiredString(params.reason, "reason").trim();
        if (reason.length < 1 || reason.length > 1000) {
          throw new Error("reason must be 1-1000 characters");
        }
        const reviewerWorkerProfileIds = Array.isArray(params.reviewerWorkerProfileIds)
          ? params.reviewerWorkerProfileIds
          : undefined;
        const reviewerWorkerProfileId = typeof params.reviewerWorkerProfileId === "string"
          ? params.reviewerWorkerProfileId.trim()
          : undefined;
        if (
          (reviewerWorkerProfileIds === undefined || reviewerWorkerProfileIds.length === 0)
          && (reviewerWorkerProfileId === undefined || reviewerWorkerProfileId.length === 0)
        ) {
          throw new Error(
            "reviewerWorkerProfileIds (1–3) or reviewerWorkerProfileId is required",
          );
        }
        return this.coordinator.createReviewGraph({
          taskId: requiredString(params.taskId, "taskId"),
          ...(reviewerWorkerProfileIds === undefined
            ? {}
            : { reviewerWorkerProfileIds: reviewerWorkerProfileIds as string[] }),
          ...(reviewerWorkerProfileId === undefined || reviewerWorkerProfileId.length === 0
            ? {}
            : { reviewerWorkerProfileId }),
          reason,
          confirm: true,
        });
      }
      case "review_graph_status":
        return this.coordinator.reviewGraphStatus(
          requiredString(params.taskId, "taskId"),
        );
      case "goal_submit_file":
        return this.coordinator.submitGoalFile(requiredString(params.goalFile, "goalFile"));
      case "goal_status":
        return this.coordinator.goalStatus(requiredString(params.goalId, "goalId"));
      case "goal_list":
        return this.coordinator.listGoals(
          typeof params.limit === "number" ? params.limit : undefined,
        );
      case "goal_advance": {
        if (params.confirm !== true) {
          throw new Error("goal_advance requires explicit confirm: true");
        }
        return this.coordinator.advanceGoal(
          requiredString(params.goalId, "goalId"),
          true,
        );
      }
      case "goal_stop": {
        if (params.confirm !== true) {
          throw new Error("goal_stop requires explicit confirm: true");
        }
        return this.coordinator.stopGoal(
          requiredString(params.goalId, "goalId"),
          true,
        );
      }
      case "goal_task_handoff": {
        if (params.confirm !== true) {
          throw new Error("goal_task_handoff requires explicit confirm: true");
        }
        return this.coordinator.goalTaskHandoff({
          taskId: requiredString(params.taskId, "taskId"),
          candidateRevisionId: requiredString(
            params.candidateRevisionId,
            "candidateRevisionId",
          ),
          reusablePaths: params.reusablePaths,
          remainingGaps: params.remainingGaps,
          destinationWorkerProfileId: requiredString(
            params.destinationWorkerProfileId,
            "destinationWorkerProfileId",
          ),
          reason: requiredString(params.reason, "reason"),
          confirm: true,
        });
      }
      case "model_routing": {
        const taskClass = requiredBoundedString(params.taskClass, "taskClass");
        const hasCandidates = params.candidates !== undefined;
        const hasProfiles = params.workerProfileIds !== undefined;
        if (hasCandidates === hasProfiles) {
          throw new Error("model_routing requires exactly one of candidates or workerProfileIds");
        }
        let candidates: Array<{ provider: string; model: string; runtime?: string; effort?: string }> | undefined;
        let workerProfileIds: string[] | undefined;
        if (hasCandidates) {
          const rawCandidates = requireArray(params.candidates, "candidates");
          if (rawCandidates.length < 2 || rawCandidates.length > 10) {
            throw new Error("candidates must contain 2 to 10 entries");
          }
          candidates = rawCandidates.map((c, i) => {
            const obj = strictObject(c, `candidates[${i}]`);
            return {
              provider: requiredBoundedString(obj.provider, `candidates[${i}].provider`),
              model: requiredBoundedString(obj.model, `candidates[${i}].model`),
              ...(typeof obj.runtime === "string" && obj.runtime.trim().length > 0
                ? { runtime: obj.runtime.trim() } : {}),
              ...(typeof obj.effort === "string" && obj.effort.trim().length > 0
                ? { effort: obj.effort.trim() } : {}),
            };
          });
        } else {
          const rawProfiles = requireArray(params.workerProfileIds, "workerProfileIds");
          if (rawProfiles.length < 2 || rawProfiles.length > 10) {
            throw new Error("workerProfileIds must contain 2 to 10 entries");
          }
          workerProfileIds = rawProfiles.map((value, i) =>
            requiredBoundedString(value, `workerProfileIds[${i}]`));
        }
        const taskFamily = typeof params.taskFamily === "string" && params.taskFamily.trim().length > 0
          ? params.taskFamily.trim()
          : undefined;
        const competitionIntent = params.competitionIntent === "none"
          || params.competitionIntent === "consider"
          || params.competitionIntent === "required"
          ? params.competitionIntent as "none" | "consider" | "required"
          : undefined;
        const competitionTriggers = Array.isArray(params.competitionTriggers)
          ? params.competitionTriggers
              .filter((t): t is string => typeof t === "string")
              .map((t) => t.trim())
              .filter((t) => t.length > 0)
          : undefined;
        return this.coordinator.modelRouting(
          taskClass, candidates, taskFamily, competitionIntent, competitionTriggers, workerProfileIds,
        );
      }
      case "self_upgrade_evidence": {
        // Read-only consecutive self-upgrade streak. Never starts Integration,
        // never mutates state, never loads command streams.
        const required = params.required === undefined
          ? undefined
          : (() => {
              if (typeof params.required !== "number" || !Number.isSafeInteger(params.required)) {
                throw new Error("required must be an integer from 1 to 20");
              }
              if (params.required < 1 || params.required > 20) {
                throw new Error("required must be an integer from 1 to 20");
              }
              return params.required;
            })();
        return this.coordinator.selfUpgradeEvidence(required);
      }
      case "main_direct_start":
        return this.coordinator.mainDirectStart(params);
      case "main_direct_complete":
        return this.coordinator.mainDirectComplete(params);
      case "main_direct_status":
        return this.coordinator.mainDirectStatus(requiredString(params.id, "id"));
      case "main_direct_list":
        return this.coordinator.mainDirectList();
      case "main_direct_aggregate":
        return this.coordinator.mainDirectAggregate();
      case "main_direct_recent": {
        const limit = typeof params.limit === "number" && Number.isSafeInteger(params.limit)
          ? params.limit : undefined;
        return this.coordinator.mainDirectRecent(limit);
      }
      default:
        throw new Error(`Unknown daemon method: ${String(request.method)}`);
    }
  }
}
