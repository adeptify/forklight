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

const LOOPBACK = "127.0.0.1";
const MAX_BODY_BYTES = 20_480;
const TOKEN_HEADER = "x-forklight-hub-token";

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
}

export class HubServer {
  private server: ReturnType<typeof createServer> | undefined;
  private actualPort = 0;
  private readonly token: string;

  constructor(private readonly deps: HubServerDeps) {
    this.token = randomBytes(32).toString("base64url");
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
      this.sendJson(req, res, 200, {
        settings: viewHubSettings(settings),
        modelCatalog: settings.modelCatalog,
        workerProfiles: settings.workerProfiles,
        prerequisites: prereqs,
        providers,
        runtimes,
        mains,
        daemon,
      });
      return;
    }

    // Daemon lifecycle control: start | stop | restart | status
    if (route === "/api/daemon" && (req.method === "GET" || req.method === "HEAD")) {
      const daemon = await this.probeDaemonStatus();
      this.sendJson(req, res, 200, daemon);
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
          this.sendJson(req, res, 200, await this.probeDaemonStatus());
          return;
        }
        if (action === "start") {
          if (!this.deps.ensureDaemon) {
            this.sendJson(req, res, 503, { error: "Daemon start not available in this Hub" });
            return;
          }
          const health = await this.deps.ensureDaemon();
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
        const health = await this.daemonCall<Record<string, unknown>>("health");
        this.sendJson(req, res, 200, health);
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
        const tasks = (Array.isArray(surfaces) ? surfaces : []).map((t) => ({
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
          ...(t.failureCategory === undefined ? {} : { failureCategory: t.failureCategory }),
        }));
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

      const boardPlan = opsRoute.match(/^\/(?:board|plans)\/(.+)$/);
      if (boardPlan) {
        const planId = decodeURIComponent(boardPlan[1]!);
        const board = await this.daemonCall<unknown>("plan_board", { planId });
        this.sendJson(req, res, 200, board);
        return;
      }

      const td = opsRoute.match(/^\/tasks\/(.+)$/);
      if (td) {
        const taskId = decodeURIComponent(td[1]!);
        const task = await this.daemonCall<Record<string, unknown>>("status", { taskId });
        const decision = await this.daemonCall<unknown>("task_decision", { taskId });
        const economics = await this.daemonCall<unknown>("task_economics", { taskId });
        const inspect = await this.daemonCall<{
          events?: Array<{ timestamp: string; type: string; summary: string }>;
        }>("inspect", { taskId });
        const events = Array.isArray(inspect.events) ? inspect.events : [];
        const timeline = events.slice(-80).map((ev) => ({
          timestamp: ev.timestamp,
          type: ev.type,
          summary: ev.summary,
        }));
        const spec = task.spec as { provider?: { name?: string; model?: string }; runtime?: { name?: string } } | undefined;
        const paths = task.paths as { source?: string } | undefined;
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
          timeline,
          economics,
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
