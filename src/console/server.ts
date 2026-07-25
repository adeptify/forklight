import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { DaemonCoordinator } from "../daemon/coordinator.js";
import type { ConsoleSettings } from "../core/settings.js";
import { MIME, SECURITY_HEADERS, safeJson } from "../server-http.js";

const LOOPBACK = "127.0.0.1";
const TOKEN_BYTES = 32;
const TOKEN_HEADER = "x-forklight-console-token";

function redactKeychain(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redactKeychain);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const stripped: Record<string, unknown> = {};
    for (const [key, fieldValue] of Object.entries(obj)) {
      if (/keychain/i.test(key)) continue;
      stripped[key] = redactKeychain(fieldValue);
    }
    return stripped;
  }
  return value;
}

export class ConsoleServer {
  private server: ReturnType<typeof createServer> | undefined = undefined;
  private actualPort = 0;
  private readonly token: string;

  constructor(
    private readonly coordinator: DaemonCoordinator,
    private readonly settings: ConsoleSettings,
    private readonly staticRoot: string,
  ) {
    this.token = randomBytes(TOKEN_BYTES).toString("base64url");
  }

  getToken(): string {
    return this.token;
  }

  async start(): Promise<number> {
    if (this.server) return this.actualPort;
    return new Promise<number>((resolve, reject) => {
      this.server = createServer((req, res) => {
        void this.handle(req, res);
      });
      this.server.once("error", reject);
      this.server.listen(this.settings.loopbackPort || 0, LOOPBACK, () => {
        const addr = this.server!.address();
        this.actualPort = typeof addr === "object" && addr !== null ? addr.port : 0;
        resolve(this.actualPort);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => {
      this.server!.close((error) => (error ? reject(error) : resolve()));
    });
    this.server = undefined;
    this.actualPort = 0;
  }

  getPort(): number {
    return this.actualPort;
  }

  isRunning(): boolean {
    return this.server !== undefined;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const isHead = req.method === "HEAD";
    if (req.method !== "GET" && !isHead) {
      this.sendJson(req, res, 405, { error: "Method not allowed - console is read-only" });
      return;
    }

    // Reject raw path segments before URL canonicalisation strips them
    const raw = req.url ?? "/";
    if (/\.\./.test(raw) || raw.includes("\0")) {
      this.sendJson(req, res, 400, { error: "Invalid path" });
      return;
    }

    try {
      const route = new URL(raw, `http://${LOOPBACK}:${this.actualPort}`).pathname;
      const match = this.matchRoute(route);
      if (match) {
        if (!this.authenticate(req)) { this.sendJson(req, res, 401, { error: "Unauthorized" }); return; }
        const body = await match.handler(match.params);
        this.sendOk(req, res, body);
        return;
      }
      await this.serveStatic(req, res, route);
    } catch (error) {
      const status = error instanceof Error && /Unknown (?:ForkLight|competition)/i.test(error.message)
        ? 404
        : 500;
      const msg = status === 500 ? "Internal server error" : (error as Error).message;
      this.sendJson(req, res, status, { error: msg });
    }
  }

  private authenticate(req: IncomingMessage): boolean {
    const header = req.headers[TOKEN_HEADER];
    if (typeof header !== "string") return false;
    if (header.length > 256) return false;
    if (header.length !== this.token.length) return false;
    return timingSafeEqual(Buffer.from(header), Buffer.from(this.token));
  }

  private matchRoute(
    route: string,
  ): { params: Record<string, string>; handler: (params: Record<string, string>) => unknown } | undefined {
    switch (route) {
      case "/health":
        return { params: {}, handler: () => redactKeychain(this.coordinator.health()) };
      case "/settings":
        return { params: {}, handler: () => redactKeychain(this.coordinator.getSettings()) };
      case "/board":
      case "/plans":
        return {
          params: {},
          handler: () => this.coordinator.listPlanBoards(this.settings.boardListLimit),
        };
      case "/tasks":
        return {
          params: {},
          // Board/Kanban uses the same progress surface as CLI/MCP list (FL-D83).
          handler: () =>
            this.coordinator.listTaskSurfaces(undefined, this.settings.taskListLimit).map((t) => ({
              id: t.taskId,
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
            })),
        };
      case "/competitions":
        return {
          params: {},
          handler: () => this.coordinator.competitionList().slice(0, this.settings.boardListLimit),
        };
      case "/stats":
        return {
          params: {},
          handler: () => this.coordinator.statistics({}).slice(0, this.settings.boardListLimit),
        };
    }

    const boardPlan = route.match(/^\/(?:board|plans)\/(.+)$/);
    if (boardPlan) {
      const planId = decodeURIComponent(boardPlan[1]!);
      return { params: { planId }, handler: (p) => this.coordinator.getPlanBoard(p.planId!) };
    }

    const td = route.match(/^\/tasks\/(.+)$/);
    if (td) {
      const taskId = decodeURIComponent(td[1]!);
      return {
        params: { taskId },
        handler: (p) => {
          const task = this.coordinator.status(p.taskId!);
          const timeline = this.coordinator.taskTimeline(p.taskId!, this.settings.eventListLimit);
          // Embed the canonical Task economics report unchanged - the
          // coordinator is the single source of truth; the server does no
          // recomputation, currency conversion, or relabelling here.
          const economics = this.coordinator.taskEconomics(p.taskId!);
          const decision = this.coordinator.taskDecision(p.taskId!);
          return {
            id: task.id,
            name: task.name,
            status: task.status,
            provider: task.spec.provider.name,
            model: task.spec.provider.model,
            runtime: task.spec.runtime.name,
            source: task.sourcePath,
            sessionId: task.sessionId,
            createdAt: task.createdAt,
            startedAt: task.startedAt,
            finishedAt: task.finishedAt,
            error: task.error,
            decision,
            timeline,
            economics,
          };
        },
      };
    }

    const cd = route.match(/^\/competitions\/(.+)$/);
    if (cd) {
      const cid = decodeURIComponent(cd[1]!);
      return { params: { competitionId: cid }, handler: (p) => this.coordinator.competitionStatus(p.competitionId!) };
    }

    const ih = route.match(/^\/integration\/(.+)\/history$/);
    if (ih) {
      const tid = decodeURIComponent(ih[1]!);
      return {
        params: { taskId: tid },
        handler: (p) => {
          const h = this.coordinator.integrationHistory(p.taskId!);
          return {
            receipts: (h.receipts as unknown[]).slice(-this.settings.eventListLimit),
            results: (h.results as unknown[]).slice(-this.settings.eventListLimit),
          };
        },
      };
    }

    return undefined;
  }

  private async serveStatic(
    req: IncomingMessage,
    res: ServerResponse,
    route: string,
  ): Promise<void> {
    const filePath = path.join(this.staticRoot, route === "/" ? "index.html" : `.${route}`);
    const normalized = path.resolve(filePath);
    const root = path.resolve(this.staticRoot);
    if (!normalized.startsWith(root + path.sep) && normalized !== root) {
      this.sendJson(req, res, 403, { error: "Path traversal rejected" });
      return;
    }
    try {
      const fileStat = await stat(normalized);
      if (!fileStat.isFile()) {
        this.sendJson(req, res, 404, { error: "Not found" });
        return;
      }
      const ext = path.extname(normalized).toLowerCase();
      const headers: Record<string, string | number> = {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Content-Length": fileStat.size,
        ...SECURITY_HEADERS,
      };
      res.writeHead(200, headers);
      if (req.method === "HEAD") { res.end(); return; }
      const stream = createReadStream(normalized);
      stream.pipe(res);
      stream.on("error", () => {
        if (!res.headersSent) this.sendJson(req, res, 500, { error: "Internal server error" });
        else res.destroy();
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        this.sendJson(req, res, 404, { error: "Not found" });
        return;
      }
      this.sendJson(req, res, 500, { error: "Internal server error" });
    }
  }

  private sendOk(req: IncomingMessage, res: ServerResponse, body: unknown): void {
    const payload = safeJson(body);
    const headers: Record<string, string | number> = {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(payload),
      ...SECURITY_HEADERS,
    };
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? "" : payload);
  }

  private sendJson(
    req: IncomingMessage,
    res: ServerResponse,
    status: number,
    body: unknown,
  ): void {
    const payload = safeJson(body);
    const headers: Record<string, string | number> = {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(payload),
      ...SECURITY_HEADERS,
    };
    res.writeHead(status, headers);
    res.end(req.method === "HEAD" ? "" : payload);
  }
}
