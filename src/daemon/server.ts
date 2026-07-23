import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, unlink } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { ConsoleServer } from "../console/server.js";
import { daemonSocketPath } from "../core/config.js";
import { SettingsService } from "../core/settings.js";
import type { StatisticsFilter } from "../core/statistics.js";
import type { TaskStatus } from "../core/types.js";
import { StateStore } from "../state/store.js";
import { DaemonCoordinator } from "./coordinator.js";
import type { DaemonRequest, DaemonResponse } from "./protocol.js";

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

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

export class ForkLightDaemon {
  private readonly store: StateStore;
  private readonly settingsService: SettingsService;
  private readonly coordinator: DaemonCoordinator;
  private readonly socketPath: string;
  private server: net.Server | undefined = undefined;
  private consoleServer: ConsoleServer | undefined = undefined;

  constructor(
    private readonly home: string,
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
    await this.stopConsole();
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

  private async startConsole(): Promise<Record<string, unknown>> {
    const settings = this.settingsService.get();
    if (this.consoleServer?.isRunning()) {
      const launchUrl = `http://127.0.0.1:${this.consoleServer.getPort()}#${this.consoleServer.getToken()}`;
      return { running: true, port: this.consoleServer.getPort(), loopback: "127.0.0.1", launchUrl };
    }
    const distConsole = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "console", "public");
    const staticRoot = existsSync(path.join(distConsole, "index.html")) ? distConsole : path.join(this.home, "console");
    this.consoleServer = new ConsoleServer(this.coordinator, settings.console, staticRoot);
    const port = await this.consoleServer.start();
    const launchUrl = `http://127.0.0.1:${port}#${this.consoleServer.getToken()}`;
    return { running: true, port, loopback: "127.0.0.1", launchUrl };
  }

  private async stopConsole(): Promise<Record<string, unknown>> {
    if (this.consoleServer) {
      await this.consoleServer.stop();
      this.consoleServer = undefined;
    }
    return { running: false };
  }

  private consoleStatus(): Record<string, unknown> {
    if (this.consoleServer?.isRunning()) {
      return { running: true, port: this.consoleServer.getPort(), loopback: "127.0.0.1", authentication: "required" };
    }
    return { running: false };
  }

  private async handleLine(line: string): Promise<DaemonResponse> {
    let request: DaemonRequest;
    try {
      request = JSON.parse(line) as DaemonRequest;
      if (!request.id || !request.method) throw new Error("Malformed daemon request");
      const result = await this.dispatch(request);
      return { id: request.id, ok: true, result };
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
      case "resume":
        return this.coordinator.resume(
          requiredString(params.taskId, "taskId"),
          typeof params.feedback === "string" && params.feedback.trim() ? params.feedback.trim() : undefined,
        );
      case "revise": {
        // Non-string feedback is routed through the shared eligibility
        // boundary as an empty string so checkReviseEligibility produces
        // the same canonical "missing-feedback" reason the local path uses.
        const feedback = typeof params.feedback === "string" ? params.feedback : "";
        return this.coordinator.revise(
          requiredString(params.taskId, "taskId"),
          feedback,
        );
      }
      case "list": {
        const statuses = Array.isArray(params.statuses)
          ? params.statuses.filter((value): value is TaskStatus => typeof value === "string")
          : undefined;
        const limit = typeof params.limit === "number" ? params.limit : 20;
        return this.coordinator.list(statuses, limit);
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
        return this.coordinator.integrationApply(
          requiredString(params.taskId, "taskId"),
          requiredString(params.receiptId, "receiptId"),
        );
      }
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
      case "console_start":
        return this.startConsole();
      case "console_status":
        return this.consoleStatus();
      case "console_stop":
        return this.stopConsole();
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
        return this.coordinator.directCodexReview(request.params ?? {});
      case "direct_codex_publication_preview":
        return this.coordinator.directCodexPublicationPreview(request.params ?? {});
      case "direct_codex_publication_register":
        return this.coordinator.directCodexPublicationRegister(request.params ?? {});
      default:
        throw new Error(`Unknown daemon method: ${String(request.method)}`);
    }
  }
}
