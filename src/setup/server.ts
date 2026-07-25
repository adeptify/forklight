import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { ProbePolicy, ProbeRunner } from "../core/provider-probe.js";
import type { ProbeEvidence } from "../core/types.js";
import type { DaemonMethod } from "../daemon/protocol.js";
import type { SetupService } from "./service.js";
import type { SetupProviderSelection } from "./types.js";
import { MIME, SECURITY_HEADERS, safeJson } from "../server-http.js";

const LOOPBACK = "127.0.0.1";
const MAX_BODY_BYTES = 10_240; // 10 KB limit
const TOKEN_BYTES = 32;
const TOKEN_HEADER = "x-forklight-setup-token";

export interface SetupServerDeps {
  service: SetupService;
  staticRoot: string;
  port?: number;
  runProbe: ProbeRunner;
  probePolicy(): ProbePolicy;
  installPlugin(): Promise<void> | void;
  ensureDaemon(): Promise<Record<string, unknown>>;
  daemonRequest<T = unknown>(
    method: DaemonMethod,
    params?: Record<string, unknown>,
  ): Promise<T>;
  saveProbeEvidence(evidence: ProbeEvidence): void;
}

export class SetupServer {
  private server: ReturnType<typeof createServer> | undefined = undefined;
  private actualPort = 0;
  private readonly token: string;
  private draftSelection: SetupProviderSelection | null = null;
  private providerVerified = false;
  private pluginInstalled = false;
  private shutdownScheduled = false;

  constructor(private readonly deps: SetupServerDeps) {
    this.token = randomBytes(TOKEN_BYTES).toString("base64url");
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
    return new Promise<number>((resolve, reject) => {
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

  // --- Request handling ---

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const isHead = req.method === "HEAD";
    const raw = req.url ?? "/";

    if (/\.\./.test(raw) || raw.includes("\0")) {
      this.sendJson(req, res, 400, { error: "Invalid path" });
      return;
    }

    const route = (() => {
      try {
        return new URL(raw, `http://${LOOPBACK}:${this.actualPort}`).pathname;
      } catch {
        return raw;
      }
    })();

    // API routes — all require authentication; static assets remain public
    if (route === "/api/bootstrap" && (req.method === "GET" || isHead)) {
      if (!this.authenticate(req)) { this.sendJson(req, res, 401, { error: "Unauthorized" }); return; }
      return this.handleBootstrap(req, res);
    }
    if (route === "/api/provider" && req.method === "POST") {
      return this.handleProvider(req, res);
    }
    if (route === "/api/probe" && req.method === "POST") {
      return this.handleProbe(req, res);
    }
    if (route === "/api/plugin" && req.method === "POST") {
      return this.handlePlugin(req, res);
    }
    if (route === "/api/finish" && req.method === "POST") {
      return this.handleFinish(req, res);
    }

    // Reject non-GET/HEAD for unknown routes
    if (req.method !== "GET" && !isHead) {
      if (!this.authenticate(req)) {
        this.sendJson(req, res, 401, { error: "Unauthorized" });
        return;
      }
      this.sendJson(req, res, 405, { error: "Method not allowed" });
      return;
    }

    // Static serving
    try {
      await this.serveStatic(req, res, route);
    } catch {
      this.sendJson(req, res, 500, { error: "Internal server error" });
    }
  }

  private authenticate(req: IncomingMessage): boolean {
    if (this.shutdownScheduled) return false;
    const header = req.headers[TOKEN_HEADER];
    if (typeof header !== "string") return false;
    if (header.length > 256) return false;
    if (header.length !== this.token.length) return false;
    return timingSafeEqual(Buffer.from(header), Buffer.from(this.token));
  }

  private readBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
      let size = 0;
      let tooLarge = false;
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          tooLarge = true;
          chunks.length = 0;
          return;
        }
        if (!tooLarge) chunks.push(chunk);
      });
      req.on("end", () => {
        if (tooLarge) { resolve(null); return; }
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          const parsed = JSON.parse(raw);
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

  // --- API handlers ---

  private async handleBootstrap(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const bootstrap = this.deps.service.bootstrap();
      const policy = this.deps.probePolicy();
      this.sendOk(_req, res, {
        ...bootstrap,
        probe: { maxBudgetUsd: policy.maxBudgetUsd, timeoutMs: policy.probeTimeoutMs },
      });
    } catch (error) {
      this.sendJson(_req, res, 500, { error: "Bootstrap failed" });
    }
  }

  private async handleProvider(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.authenticate(req)) { this.sendJson(req, res, 401, { error: "Unauthorized" }); return; }
    const body = await this.readBody(req);
    if (!body) { this.sendJson(req, res, 400, { error: "Invalid request body" }); return; }

    const provider = typeof body.provider === "string" && body.provider.trim() ? body.provider.trim() : "";
    const variant = typeof body.variant === "string" && body.variant.trim() ? body.variant.trim() : "";
    const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;
    const endpoint = typeof body.endpoint === "string" && body.endpoint.trim() ? body.endpoint.trim() : undefined;

    if (!provider || !variant) {
      this.sendJson(req, res, 400, { error: "provider and variant are required" });
      return;
    }

    try {
      const resolved = this.deps.service.resolveProvider({
        provider: provider as SetupProviderSelection["provider"],
        variant,
        ...(model === undefined ? {} : { model }),
        ...(endpoint === undefined ? {} : { endpoint }),
      });
      // Store draft in-memory only — no persistence
      this.draftSelection = { provider: resolved.provider, variant: resolved.variant };
      if (resolved.model) this.draftSelection.model = resolved.model;
      if (resolved.endpoint) this.draftSelection.endpoint = resolved.endpoint;
      this.providerVerified = false;

      this.sendOk(req, res, {
        provider: resolved.provider,
        variant: resolved.variant,
        variantLabel: resolved.variantLabel,
        model: resolved.model,
        endpoint: resolved.endpoint,
        drafted: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider validation failed";
      this.sendJson(req, res, 422, { error: message });
    }
  }

  private async handleProbe(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.authenticate(req)) { this.sendJson(req, res, 401, { error: "Unauthorized" }); return; }
    const body = await this.readBody(req);
    if (!body) { this.sendJson(req, res, 400, { error: "Invalid request body" }); return; }

    // Require explicit cost confirmation
    if (body.confirmCost !== true) {
      this.sendJson(req, res, 400, { error: "Explicit confirmCost: true is required before probing" });
      return;
    }

    const provider = typeof body.provider === "string" && body.provider.trim() ? body.provider.trim() : "";
    const variant = typeof body.variant === "string" && body.variant.trim() ? body.variant.trim() : "";
    const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;
    const endpoint = typeof body.endpoint === "string" && body.endpoint.trim() ? body.endpoint.trim() : undefined;
    const apiKey = typeof body.apiKey === "string" ? body.apiKey : "";

    if (!provider || !variant) {
      this.sendJson(req, res, 400, { error: "provider and variant are required" });
      return;
    }
    if (!apiKey || apiKey.length < 8 || apiKey.length > 4096 || /[\0\r\n]/.test(apiKey)) {
      this.sendJson(req, res, 400, { error: "A valid API key is required" });
      return;
    }

    // Validate selection first
    let resolved;
    try {
      resolved = this.deps.service.resolveProvider({
        provider: provider as SetupProviderSelection["provider"],
        variant,
        ...(model === undefined ? {} : { model }),
        ...(endpoint === undefined ? {} : { endpoint }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider validation failed";
      this.sendJson(req, res, 422, { error: message });
      return;
    }

    // Run probe with transient key — no persistence before success
    const config = this.deps.service.resolveRuntimeProvider({
      provider: resolved.provider,
      variant: resolved.variant,
      model: resolved.model,
      endpoint: resolved.endpoint,
    });

    let outcome;
    try {
      outcome = await this.deps.runProbe(config, apiKey, this.deps.probePolicy());
    } catch {
      this.sendJson(req, res, 502, { error: "Probe could not be completed" });
      return;
    }

    if (!outcome.ok) {
      // Probe failed — do not persist anything
      this.sendJson(req, res, 422, {
        error: "Provider verification failed",
        ok: false,
        status: "failed",
        failureCategory: outcome.category ?? "unknown",
        latencyMs: outcome.latencyMs,
        persisted: false,
      });
      return;
    }

    // Probe succeeded — commit Keychain and settings
    try {
      const committed = this.deps.service.commitProvider(
        { provider: resolved.provider, variant: resolved.variant, model: resolved.model, endpoint: resolved.endpoint },
        apiKey,
      );

      // Persist safe probe evidence
      const endpointOrigin = new URL(resolved.endpoint).origin;
      this.deps.saveProbeEvidence({
        provider: resolved.provider,
        model: resolved.model,
        endpointOrigin,
        status: "verified",
        latencyMs: outcome.latencyMs,
        timestamp: new Date().toISOString(),
      });

      this.draftSelection = null;
      this.providerVerified = true;
      this.sendOk(req, res, {
        ok: true,
        status: "verified",
        provider: committed.provider,
        model: committed.model,
        endpoint: committed.endpoint,
        latencyMs: outcome.latencyMs,
        persisted: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save provider";
      this.sendJson(req, res, 500, { error: message });
    }
  }

  private async handlePlugin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.authenticate(req)) { this.sendJson(req, res, 401, { error: "Unauthorized" }); return; }
    const body = await this.readBody(req);
    if (!body) { this.sendJson(req, res, 400, { error: "Invalid request body" }); return; }

    if (body.plugin !== "codex") {
      this.sendJson(req, res, 400, { error: "Only the codex plugin is supported" });
      return;
    }
    if (body.confirm !== true) {
      this.sendJson(req, res, 400, { error: "Explicit confirm: true is required before installing" });
      return;
    }
    if (!this.providerVerified) {
      this.sendJson(req, res, 409, { error: "Verify a provider before installing the Codex plugin" });
      return;
    }

    try {
      await this.deps.installPlugin();
      this.pluginInstalled = true;
      this.sendOk(req, res, { ok: true, plugin: "codex", installed: true });
    } catch {
      this.sendJson(req, res, 500, { error: "Codex plugin installation failed" });
    }
  }

  private async handleFinish(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.authenticate(req)) { this.sendJson(req, res, 401, { error: "Unauthorized" }); return; }
    if (!this.providerVerified || !this.pluginInstalled) {
      this.sendJson(req, res, 409, { error: "Provider verification and Codex plugin installation are required" });
      return;
    }

    try {
      // Ensure the daemon is running
      await this.deps.ensureDaemon();

      // Start the read-only console
      const consoleResult = await this.deps.daemonRequest<{
        port: number;
        loopback: string;
        running: boolean;
      }>("console_start");

      const consoleUrl = `http://127.0.0.1:${consoleResult.port}`;

      // Close the setup server after the response is flushed
      res.once("finish", () => {
        this.stop().catch(() => {});
      });
      this.shutdownScheduled = true;
      this.sendOk(req, res, { consoleUrl, complete: true });
    } catch {
      this.sendJson(req, res, 500, { error: "ForkLight could not start the local console" });
    }
  }

  // --- Static serving ---

  private async serveStatic(
    req: IncomingMessage,
    res: ServerResponse,
    route: string,
  ): Promise<void> {
    const filePath = path.join(
      this.deps.staticRoot,
      route === "/" ? "index.html" : `.${route}`,
    );
    const normalized = path.resolve(filePath);
    const root = path.resolve(this.deps.staticRoot);
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
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const stream = createReadStream(normalized);
      stream.pipe(res);
      stream.on("error", () => {
        if (!res.headersSent) {
          this.sendJson(req, res, 500, { error: "Internal server error" });
        } else {
          res.destroy();
        }
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
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(payload),
      ...SECURITY_HEADERS,
    });
    res.end(req.method === "HEAD" ? "" : payload);
  }

  private sendJson(
    req: IncomingMessage,
    res: ServerResponse,
    status: number,
    body: unknown,
  ): void {
    const payload = safeJson(body);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(payload),
      ...SECURITY_HEADERS,
    });
    res.end(req.method === "HEAD" ? "" : payload);
  }
}
