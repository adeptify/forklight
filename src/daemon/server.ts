import { chmod, mkdir, readFile, unlink } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { createInterface } from "node:readline";
import YAML from "yaml";
import { daemonSocketPath } from "../core/config.js";
import { SettingsService } from "../core/settings.js";
import type { StatisticsFilter } from "../core/statistics.js";
import type { AttemptAuthorization, TaskStatus } from "../core/types.js";
import { StateStore } from "../state/store.js";
import { DaemonCoordinator } from "./coordinator.js";
import type { DaemonRequest, DaemonResponse } from "./protocol.js";
import { requiresMatchingBuildIdentity } from "./protocol.js";
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

export class ForkLightDaemon {
  private readonly store: StateStore;
  private readonly settingsService: SettingsService;
  private readonly coordinator: DaemonCoordinator;
  private readonly socketPath: string;
  private server: net.Server | undefined = undefined;
  private readonly buildIdentity: BuildIdentity = currentBuildIdentity();

  constructor(
    home: string,
    maxConcurrency?: number,
  ) {
    this.store = new StateStore(home);
    this.settingsService = new SettingsService(this.store);
    this.coordinator = new DaemonCoordinator(this.store, this.settingsService, maxConcurrency);
    this.socketPath = daemonSocketPath(home);
  }

  async start(): Promise<void> {
    await mkdir(path.dirname(this.socketPath), { recursive: true, mode: 0o700 });
    try {
      await unlink(this.socketPath);
    } catch {
      // No stale socket.
    }
    await this.coordinator.recover();
    this.server = net.createServer((socket) => {
      const lines = createInterface({ input: socket, crlfDelay: Infinity });
      lines.on("line", (line) => {
        void this.handleLine(line).then((response) => {
          socket.write(`${JSON.stringify(response)}\n`);
        });
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.socketPath, resolve);
    });
    await chmod(this.socketPath, 0o600);
  }

  async close(): Promise<void> {
    await this.coordinator.shutdown();
    if (this.server) {
      await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    }
    try {
      await unlink(this.socketPath);
    } catch {
      // Socket may already be gone.
    }
    this.store.close();
  }

  private async handleLine(line: string): Promise<DaemonResponse> {
    let request: DaemonRequest;
    try {
      request = JSON.parse(line) as DaemonRequest;
      if (!request.id || !request.method) throw new Error("Malformed daemon request");
      const comparison = isBuildIdentity(request.clientIdentity)
        ? compareBuildIdentity(request.clientIdentity, this.buildIdentity)
        : { protocolCompatible: false, sameBuild: false };
      if (requiresMatchingBuildIdentity(request.method)) {
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
      case "submit_file":
        return this.coordinator.submitFile(requiredString(params.taskFile, "taskFile"));
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
      case "plan_submit_file":
        return this.coordinator.submitPlanFile(requiredString(params.planFile, "planFile"));
      case "plan_board":
        return this.coordinator.getPlanBoard(requiredString(params.planId, "planId"));
      case "plan_board_overview":
        return this.coordinator.listPlanBoards(
          typeof params.limit === "number" ? params.limit : undefined,
        );
      case "statistics": {
        const filter: StatisticsFilter = {
          ...(typeof params.providerName === "string" ? { providerName: params.providerName } : {}),
          ...(typeof params.modelName === "string" ? { modelName: params.modelName } : {}),
          ...(typeof params.since === "string" ? { since: params.since } : {}),
          ...(typeof params.until === "string" ? { until: params.until } : {}),
        };
        return this.coordinator.statistics(filter);
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
      case "shutdown":
        setImmediate(() => process.kill(process.pid, "SIGTERM"));
        return { stopping: true };
      case "competition_submit_file":
        return this.coordinator.submitCompetitionFile(
          requiredString(params.taskFile, "taskFile"),
          requireArray(params.candidates, "candidates") as import("../core/competition.js").CandidateOverride[],
        );
      case "competition_submit":
        return this.coordinator.submitInlineCompetition(
          params.task,
          typeof params.baseDirectory === "string" ? params.baseDirectory : process.cwd(),
          requireArray(params.candidates, "candidates") as import("../core/competition.js").CandidateOverride[],
        );
      case "competition_status":
        return this.coordinator.competitionStatus(requiredString(params.competitionId, "competitionId"));
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
      case "direct_codex_capture":
        return this.coordinator.directCodexCapture(params.usage, params.metadata);
      case "direct_codex_inbox":
        return this.coordinator.directCodexInbox(params.taskClass, params.directCodexProfileId);
      case "direct_codex_review":
        return this.coordinator.directCodexReview(params);
      case "direct_codex_publication_preview":
        return this.coordinator.directCodexPublicationPreview(params);
      case "direct_codex_publication_register":
        return this.coordinator.directCodexPublicationRegister(params);
      default:
        throw new Error(`Unknown daemon method: ${String(request.method)}`);
    }
  }
}
