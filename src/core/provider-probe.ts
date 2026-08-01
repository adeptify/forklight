import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { localAccountName } from "./config.js";
import type { ProbeEvidence, ProbeFailureCategory } from "./types.js";
import type { ProviderHealthStatus, ProviderStatus } from "./types.js";
import type { StateStore } from "../state/store.js";
import type { SettingsService, ProbeSettings } from "./settings.js";
import {
  hasLocalCodexSignIn,
  hasLocalGrokSignIn,
  providerNames,
  resolveProvider,
  providerEnvironment,
  type ProviderName,
  type ResolvedProviderConfig,
} from "./providers.js";

// --- Injectable contracts ---

export interface ProbePolicy {
  readonly probeTimeoutMs: number;
  readonly maxBudgetUsd: number;
  readonly cacheLifetimeMs: number;
  readonly maxProbeConcurrency: number;
}

export type ProbeRunner = (
  config: ResolvedProviderConfig,
  apiKey: string,
  policy: ProbePolicy,
) => Promise<{ ok: boolean; category?: ProbeFailureCategory; summary?: string; latencyMs: number }>;

export type ExecFn = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; timeout: number; cwd: string },
) => Promise<{ stdout: string; stderr: string }>;

export function providerProbeBatchFailed(result: Record<string, unknown>): boolean {
  return Object.values(result).some((value) => {
    if (typeof value !== "object" || value === null) return true;
    const outcome = value as Record<string, unknown>;
    return outcome.error !== undefined || outcome.status !== "verified";
  });
}

export type KeychainChecker = (keychainService: string) => boolean;

export type Clock = () => number;

export type KeychainReader = (keychainService: string) => string;

// --- Real implementations ---

function probePolicyFromSettings(settings: ProbeSettings): ProbePolicy {
  return Object.freeze({
    probeTimeoutMs: settings.probeTimeoutMs,
    maxBudgetUsd: settings.maxBudgetUsd,
    cacheLifetimeMs: settings.cacheLifetimeMs,
    maxProbeConcurrency: settings.maxProbeConcurrency,
  });
}

function categorizeFailure(stderr: string, spawnError?: string): ProbeFailureCategory {
  const combined = `${stderr} ${spawnError ?? ""}`.toLowerCase();
  if (
    /\b401\b/.test(combined) ||
    combined.includes("unauthorized") ||
    combined.includes("unauthenticated") ||
    combined.includes("authentication_failed") ||
    combined.includes("failed to authenticate") ||
    (combined.includes("api key") && combined.includes("invalid"))
  ) {
    return "authentication";
  }
  if (/\b403\b/.test(combined) || combined.includes("forbidden")) {
    return "authentication";
  }
  if (
    combined.includes("timed out") ||
    combined.includes("timeout")
  ) {
    return "timeout";
  }
  if (
    combined.includes("enotfound") ||
    combined.includes("econnrefused") ||
    combined.includes("econnreset") ||
    combined.includes("econnaborted") ||
    combined.includes("dns")
  ) {
    return "connectivity";
  }
  return "unknown";
}

function safeSummary(value: string, apiKey: string): string {
  const compact = value.replaceAll(apiKey, "[REDACTED]")
    .replace(/(?:bearer\s+|api[_ -]?key[=: ]+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, 240) : "Claude probe failed without diagnostic output";
}

export function createClaudeProbeRunner(exec: ExecFn): ProbeRunner {
  return async (config, apiKey, policy) => {
    const configDir = await mkdtemp(path.join(tmpdir(), "forklight-probe-"));
    const env = providerEnvironment(config, apiKey, process.env);
    env.CLAUDE_CONFIG_DIR = configDir;
    const args = [
      "--print",
      "Say OK.",
      "--verbose",
      "--output-format",
      "stream-json",
      "--model",
      config.model,
      "--max-budget-usd",
      String(policy.maxBudgetUsd),
      "--permission-mode",
      "dontAsk",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--tools",
      "",
    ];

    const start = Date.now();
    try {
      const { stdout, stderr } = await exec("claude", args, {
        env,
        timeout: policy.probeTimeoutMs,
        cwd: configDir,
      });
      const latencyMs = Date.now() - start;

      for (const line of stdout.split("\n")) {
        if (!line) continue;
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          if (event.type === "result") {
            if (event.is_error === true) {
              const raw = typeof event.result === "string"
                ? event.result
                : JSON.stringify(event.result ?? event);
              return {
                ok: false,
                category: categorizeFailure(raw),
                summary: safeSummary(raw, apiKey),
                latencyMs,
              };
            }
            return { ok: true, latencyMs };
          }
        } catch {
          // Skip unparseable lines
        }
      }
      return {
        ok: false,
        category: categorizeFailure(`${stderr}\n${stdout}`),
        summary: safeSummary(`${stderr}\n${stdout}`, apiKey),
        latencyMs,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const processError = err as Error & {
        code?: string;
        killed?: boolean;
        signal?: NodeJS.Signals;
        stdout?: string | Buffer;
        stderr?: string | Buffer;
      };
      if (processError.code === "ETIMEDOUT" || processError.killed || processError.signal === "SIGTERM") {
        return { ok: false, category: "timeout", summary: "Claude probe timed out", latencyMs };
      }
      const stderrMsg = processError.stderr === undefined
        ? (err instanceof Error ? err.message : "")
        : String(processError.stderr);
      const stdoutMsg = processError.stdout === undefined ? "" : String(processError.stdout);
      return {
        ok: false,
        category: categorizeFailure(`${stderrMsg}\n${stdoutMsg}`, processError.message),
        summary: safeSummary(`${stderrMsg}\n${stdoutMsg}\n${processError.message ?? ""}`, apiKey),
        latencyMs,
      };
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  };
}

export function realExecFile(): ExecFn {
  return (command, args, options) => new Promise((resolve, reject) => {
    execFile(command, [...args], {
      env: options.env,
      timeout: options.timeout,
      cwd: options.cwd,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        Object.assign(error, { stdout, stderr });
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export function realKeychainChecker(): KeychainChecker {
  return (keychainService: string): boolean => {
    try {
      execFileSync(
        "security",
        ["find-generic-password", "-a", localAccountName(), "-s", keychainService],
        { stdio: "ignore" },
      );
      return true;
    } catch {
      return false;
    }
  };
}

export function realKeychainReader(keychainService: string): string {
  const value = execFileSync(
    "security",
    ["find-generic-password", "-a", localAccountName(), "-s", keychainService, "-w"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  if (!value) throw new Error("Keychain returned an empty value");
  return value;
}

export function realClock(): number {
  return Date.now();
}

function endpointOrigin(endpoint: string): string {
  return new URL(endpoint).origin;
}

/** Classify persisted connection evidence without probing a Provider.
 * ProviderProbeService and read-only CLI/Hub projections must share this
 * decision so cache expiry and identity drift cannot acquire two meanings. */
export function deriveProviderHealthStatus(
  authenticationReady: boolean,
  evidence: ProbeEvidence | null,
  currentModel: string,
  currentEndpointOrigin: string,
  cacheLifetimeMs: number,
  now: number,
): ProviderHealthStatus {
  if (!authenticationReady || evidence === null) return "unverified";
  if (evidence.model !== currentModel || evidence.endpointOrigin !== currentEndpointOrigin) {
    return "unverified";
  }
  if (evidence.status === "unverified") return "unverified";
  if (evidence.status === "failed") return "failed";
  const ageMs = now - new Date(evidence.timestamp).getTime();
  return ageMs > cacheLifetimeMs ? "stale" : "verified";
}

/** Normalize a derived Provider health status for providers that offer
 *  non-Keychain authentication.  An old explicit-probe failure is not a
 *  real connectivity failure when local sign-in provides a viable launch
 *  path.  Both ProviderProbeService and CLI health projections must share
 *  this function so the decision has exactly one meaning. */
export function normalizeProbeStatusWithLocalSignIn(
  derivedStatus: ProviderHealthStatus,
  evidence: Pick<ProbeEvidence, "source"> | undefined,
  localSignInReady: boolean,
): ProviderHealthStatus {
  if (
    derivedStatus === "failed"
    && evidence?.source !== "worker-run"
    && localSignInReady
  ) {
    return "unverified";
  }
  return derivedStatus;
}

// --- Core service ---

export class ProviderProbeService {
  constructor(
    private readonly store: StateStore,
    private readonly settings: SettingsService,
    private readonly runProbe: ProbeRunner,
    private readonly keychainExists: KeychainChecker,
    private readonly readKeychain: KeychainReader,
    private readonly now: Clock,
    private readonly grokSignInReady: () => boolean = hasLocalGrokSignIn,
    private readonly codexSignInReady: () => boolean = hasLocalCodexSignIn,
  ) {}

  /** Return a frozen snapshot of the probe policy from current settings. */
  probePolicy(): ProbePolicy {
    return probePolicyFromSettings(this.settings.get().probe);
  }

  /** Execute a probe for one provider and persist safe evidence. */
  async probeProvider(name: ProviderName): Promise<ProbeEvidence> {
    const defaults = this.settings.get().providerDefaults[name];
    const config = resolveProvider(name, {}, defaults);

    // Runtime-owned local sign-in providers are never sent through the
    // Claude/Anthropic probe. Real Worker evidence remains authoritative.
    if (name === "xai" || name === "openai") {
      const keyOk = name === "openai" ? false : this.keychainExists(config.keychainService);
      const localSignInReady = name === "xai"
        ? this.grokSignInReady()
        : this.codexSignInReady();

      // ForkLight does not perform a real Grok network request in this probe.
      // Either supported authentication path therefore proves launchability,
      // not remote connectivity. Preserve matching real Worker evidence;
      // otherwise return an ephemeral unverified result without overwriting it.
      if (keyOk || localSignInReady) {
        const existing = this.store.getProbeEvidence(name);
        const currentOrigin = endpointOrigin(config.endpoint);
        if (
          existing?.source === "worker-run"
          && existing.model === config.model
          && existing.endpointOrigin === currentOrigin
        ) {
          return existing;
        }
        return {
          provider: name,
          model: config.model,
          endpointOrigin: currentOrigin,
          status: "unverified",
          latencyMs: 0,
          timestamp: new Date(this.now()).toISOString(),
          source: "explicit-probe",
        };
      }

      // Neither Keychain nor local sign-in: persist authentication failure.
      const evidence: ProbeEvidence = {
        provider: name,
        model: config.model,
        endpointOrigin: endpointOrigin(config.endpoint),
        status: "failed",
        latencyMs: 0,
        timestamp: new Date(this.now()).toISOString(),
        failureCategory: "authentication",
        failureSummary: name === "xai"
          ? "xAI authentication missing (used with runtime grok-build)"
          : "Codex local sign-in missing (used with runtime codex-cli)",
        source: "explicit-probe",
      };
      this.store.saveProbeEvidence(evidence);
      return evidence;
    }

    const policy = this.probePolicy();
    const apiKey = this.readKeychain(config.keychainService);

    const outcome = await this.runProbe(config, apiKey, policy);

    const evidence: ProbeEvidence = {
      provider: name,
      model: config.model,
      endpointOrigin: endpointOrigin(config.endpoint),
      status: outcome.ok ? "verified" : "failed",
      latencyMs: outcome.latencyMs,
      timestamp: new Date(this.now()).toISOString(),
      source: "explicit-probe",
      ...(outcome.category === undefined ? {} : { failureCategory: outcome.category }),
      ...(outcome.summary === undefined ? {} : { failureSummary: outcome.summary }),
    };

    this.store.saveProbeEvidence(evidence);
    return evidence;
  }

  /** Compute the current health status for one provider. */
  getProviderStatus(name: ProviderName): ProviderStatus {
    const defaults = this.settings.get().providerDefaults[name];
    const config = resolveProvider(name, {}, defaults);
    const keychainOk = name === "openai" ? false : this.keychainExists(config.keychainService);
    const evidence = this.store.getProbeEvidence(name);

    // Authentication readiness: Keychain, or for runtime-owned providers the supported
    // local-sign-in path.  Both are launch readiness, not remote verification.
    const localSignInReady = (name === "xai" && this.grokSignInReady())
      || (name === "openai" && this.codexSignInReady());
    const authReady = keychainOk || localSignInReady;

    const policy = this.probePolicy();
    const derivedStatus = deriveProviderHealthStatus(
      authReady,
      evidence ?? null,
      config.model,
      endpointOrigin(config.endpoint),
      policy.cacheLifetimeMs,
      this.now(),
    );

    // Shared normalization: an old explicit-probe failure for xAI is not a
    // real connectivity failure when local sign-in provides a viable path.
    const status = name === "xai" || name === "openai"
      ? normalizeProbeStatusWithLocalSignIn(derivedStatus, evidence, localSignInReady)
      : derivedStatus;

    return {
      provider: name,
      model: config.model,
      keychainExists: keychainOk,
      status,
      ...(evidence === undefined ? {} : { evidence }),
    };
  }

  /** Compute the current health status for every configured provider. */
  getAllProviderStatuses(): Record<ProviderName, ProviderStatus> {
    const result = {} as Record<ProviderName, ProviderStatus>;
    for (const name of providerNames()) {
      result[name] = this.getProviderStatus(name);
    }
    return result;
  }

}
