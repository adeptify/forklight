import { execFile, execFileSync } from "node:child_process";
import { userInfo } from "node:os";
import type { ProbeEvidence, ProbeFailureCategory } from "./types.js";
import type { ProviderHealthStatus, ProviderStatus } from "./types.js";
import type { StateStore } from "../state/store.js";
import type { SettingsService, ProbeSettings } from "./settings.js";
import {
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
) => Promise<{ ok: boolean; category?: ProbeFailureCategory; latencyMs: number }>;

export type ExecFn = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

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

export function createClaudeProbeRunner(exec: ExecFn): ProbeRunner {
  return async (config, apiKey, policy) => {
    const env = providerEnvironment(config, apiKey, process.env);
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
      });
      const latencyMs = Date.now() - start;

      for (const line of stdout.split("\n")) {
        if (!line) continue;
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          if (event.type === "result") {
            if (event.is_error === true) {
              return {
                ok: false,
                category: categorizeFailure(JSON.stringify(event)),
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
        return { ok: false, category: "timeout", latencyMs };
      }
      const stderrMsg = processError.stderr === undefined
        ? (err instanceof Error ? err.message : "")
        : String(processError.stderr);
      const stdoutMsg = processError.stdout === undefined ? "" : String(processError.stdout);
      return {
        ok: false,
        category: categorizeFailure(`${stderrMsg}\n${stdoutMsg}`, processError.message),
        latencyMs,
      };
    }
  };
}

export function realExecFile(): ExecFn {
  return (command, args, options) => new Promise((resolve, reject) => {
    execFile(command, [...args], {
      env: options.env,
      timeout: options.timeout,
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
        ["find-generic-password", "-a", userInfo().username, "-s", keychainService],
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
    ["find-generic-password", "-a", userInfo().username, "-s", keychainService, "-w"],
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

// --- Core service ---

export class ProviderProbeService {
  constructor(
    private readonly store: StateStore,
    private readonly settings: SettingsService,
    private readonly runProbe: ProbeRunner,
    private readonly keychainExists: KeychainChecker,
    private readonly readKeychain: KeychainReader,
    private readonly now: Clock,
  ) {}

  /** Return a frozen snapshot of the probe policy from current settings. */
  probePolicy(): ProbePolicy {
    return probePolicyFromSettings(this.settings.get().probe);
  }

  /** Execute a probe for one provider and persist safe evidence. */
  async probeProvider(name: ProviderName): Promise<ProbeEvidence> {
    const policy = this.probePolicy();
    const defaults = this.settings.get().providerDefaults[name];
    const config = resolveProvider(name, {}, defaults);
    const apiKey = this.readKeychain(config.keychainService);

    const outcome = await this.runProbe(config, apiKey, policy);

    const evidence: ProbeEvidence = {
      provider: name,
      model: config.model,
      endpointOrigin: endpointOrigin(config.endpoint),
      status: outcome.ok ? "verified" : "failed",
      latencyMs: outcome.latencyMs,
      timestamp: new Date(this.now()).toISOString(),
      ...(outcome.category === undefined ? {} : { failureCategory: outcome.category }),
    };

    this.store.saveProbeEvidence(evidence);
    return evidence;
  }

  /** Compute the current health status for one provider. */
  getProviderStatus(name: ProviderName): ProviderStatus {
    const defaults = this.settings.get().providerDefaults[name];
    const config = resolveProvider(name, {}, defaults);
    const keychainOk = this.keychainExists(config.keychainService);
    const evidence = this.store.getProbeEvidence(name);

    const status = this.deriveHealth(
      keychainOk,
      evidence ?? null,
      config.model,
      endpointOrigin(config.endpoint),
    );

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

  private deriveHealth(
    keychainOk: boolean,
    evidence: ProbeEvidence | null,
    currentModel: string,
    currentEndpointOrigin: string,
  ): ProviderHealthStatus {
    if (!keychainOk) return "unverified";
    if (!evidence) return "unverified";

    if (evidence.model !== currentModel || evidence.endpointOrigin !== currentEndpointOrigin) {
      return "unverified";
    }
    if (evidence.status === "failed") return "failed";

    const policy = this.probePolicy();
    const ageMs = this.now() - new Date(evidence.timestamp).getTime();
    if (ageMs > policy.cacheLifetimeMs) return "stale";

    return "verified";
  }
}
