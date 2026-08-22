/**
 * Bounded in-memory cache for expensive Daemon execution-environment facts.
 *
 * Reused by immediate CLI/Hub health readers so Keychain and Runtime inspection
 * runs once per TTL rather than once per overlapping status poll. Dynamic
 * operational fields (queue, PID, verification, live Settings) stay outside
 * this module and are always read fresh by the health projection.
 *
 * Privacy: the snapshot holds only the bounded fields already exposed on the
 * public health response — never credentials, raw subprocess dumps, filesystem
 * paths, cache metadata, or Provider network results.
 */
import {
  providerReadiness,
  realProviderAuthInspector,
  type ProviderAuthInspector,
  type ProviderName,
  type ProviderReadiness,
} from "../core/providers.js";
import type { ProviderDefaultsSettings } from "../core/settings.js";
import { listWorkerAdapters } from "../workers/registry.js";

/** Default bound: long enough for post-restart CLI+Hub readers, short enough to
 *  observe a repaired local Runtime without forever-stale availability. */
export const DEFAULT_HEALTH_ENVIRONMENT_TTL_MS = 15_000;

/** Privacy-safe Runtime doctor projection already present on health responses. */
export interface HealthRuntimeDoctorFact {
  ok: boolean;
  displayName: string;
  executable: string;
  version?: string;
  issues: readonly string[];
  capabilities: unknown;
}

/**
 * One complete, immutable environment inspection result.
 * All expensive fields in a single health response must come from the same
 * snapshot so concurrent readers never mix generations.
 */
export interface HealthEnvironmentSnapshot {
  readonly claudeCode: string;
  readonly anyReady: boolean;
  readonly providers: Readonly<Record<ProviderName, ProviderReadiness>>;
  readonly runtimes: Readonly<Record<string, HealthRuntimeDoctorFact>>;
}

export type HealthEnvironmentLoader = (
  providerDefaults: ProviderDefaultsSettings,
) => HealthEnvironmentSnapshot;

export type HealthEnvironmentClock = () => number;

interface HealthEnvironmentCacheOptions {
  ttlMs?: number;
  now?: HealthEnvironmentClock;
  load?: HealthEnvironmentLoader;
}

interface CacheEntry {
  readonly defaultsIdentity: string;
  readonly loadedAtMs: number;
  readonly snapshot: HealthEnvironmentSnapshot;
}

/** Stable identity of Provider defaults that affect readiness presentation. */
export function providerDefaultsIdentity(defaults: ProviderDefaultsSettings): string {
  const names = Object.keys(defaults).sort() as (keyof ProviderDefaultsSettings)[];
  return names.map((name) => {
    const d = defaults[name];
    return [
      name,
      d.defaultModel,
      d.defaultEndpoint,
      d.defaultKeychainService,
      d.defaultHaikuModel ?? "",
      String(d.requestTimeoutMs),
    ].join("\u0001");
  }).join("\u0002");
}

/** Compatibility header from the same Claude doctor result that fills runtimes. */
export function claudeCodeFromRuntimeDoctor(
  runtimes: Readonly<Record<string, HealthRuntimeDoctorFact>>,
): string {
  const claude = runtimes["claude-code"];
  if (claude !== undefined && typeof claude.version === "string" && claude.version.length > 0) {
    return claude.version;
  }
  return "unavailable";
}

/** Detach and recursively freeze the small JSON-like Runtime capability map. */
function sealRuntimeCapabilities(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => sealRuntimeCapabilities(entry)));
  }
  if (value !== null && typeof value === "object") {
    const detached: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      detached[key] = sealRuntimeCapabilities(entry);
    }
    return Object.freeze(detached);
  }
  return value;
}

/**
 * Deep-freeze a complete snapshot so nested objects returned through health
 * cannot poison later responses via shared mutable references.
 */
export function sealHealthEnvironmentSnapshot(
  snapshot: HealthEnvironmentSnapshot,
): HealthEnvironmentSnapshot {
  const providers = {} as Record<ProviderName, ProviderReadiness>;
  for (const [name, readiness] of Object.entries(snapshot.providers) as Array<
    [ProviderName, ProviderReadiness]
  >) {
    providers[name] = Object.freeze({ ...readiness });
  }
  const runtimes: Record<string, HealthRuntimeDoctorFact> = {};
  for (const [name, fact] of Object.entries(snapshot.runtimes)) {
    runtimes[name] = Object.freeze({
      ...fact,
      issues: Object.freeze([...fact.issues]),
      capabilities: sealRuntimeCapabilities(fact.capabilities),
    });
  }
  return Object.freeze({
    claudeCode: snapshot.claudeCode,
    anyReady: snapshot.anyReady,
    providers: Object.freeze(providers),
    runtimes: Object.freeze(runtimes),
  });
}

function projectRuntimeDoctorFact(
  adapter: {
    name: string;
    displayName: string;
    defaultExecutable: string;
    capabilities: () => unknown;
  },
  doctorResult: {
    ok: boolean;
    executable: string;
    version?: string;
    issues: string[];
    capabilities: unknown;
  },
): HealthRuntimeDoctorFact {
  return {
    ok: doctorResult.ok,
    displayName: adapter.displayName,
    executable: doctorResult.executable,
    issues: doctorResult.issues,
    capabilities: doctorResult.capabilities,
    ...(doctorResult.version === undefined ? {} : { version: doctorResult.version }),
  };
}

/**
 * Perform the existing synchronous Keychain + Runtime inspection once.
 * Returns only the bounded fields already projected onto the health payload.
 * Claude compatibility header and claude-code runtime metadata share one doctor.
 */
export function loadHealthEnvironmentSnapshot(
  providerDefaults: ProviderDefaultsSettings,
  inspector: ProviderAuthInspector = realProviderAuthInspector(),
): HealthEnvironmentSnapshot {
  const readiness = providerReadiness(providerDefaults, inspector);
  const runtimes: Record<string, HealthRuntimeDoctorFact> = {};
  for (const adapter of listWorkerAdapters()) {
    const doctorResult = adapter.doctor();
    // Built-ins are sync; Promise would be a custom adapter contract change.
    if (doctorResult instanceof Promise) {
      runtimes[adapter.name] = {
        ok: false,
        displayName: adapter.displayName,
        executable: adapter.defaultExecutable,
        issues: ["async doctor not supported in health snapshot"],
        capabilities: adapter.capabilities(),
      };
      continue;
    }
    runtimes[adapter.name] = projectRuntimeDoctorFact(adapter, doctorResult);
  }
  return sealHealthEnvironmentSnapshot({
    claudeCode: claudeCodeFromRuntimeDoctor(runtimes),
    anyReady: readiness.anyReady,
    providers: readiness.providers,
    runtimes,
  });
}

function assertValidTtlMs(ttlMs: number): number {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error("Health environment TTL must be a positive finite number of milliseconds");
  }
  return ttlMs;
}

/**
 * Memory-only complete-snapshot cache with deterministic clock/loader seams.
 *
 * - One entry at a time; never persisted; no background refresh.
 * - Reuse requires matching Provider-default identity and a live TTL.
 * - Expiry or invalidate() forces the next get() to load one complete replacement.
 * - loadedAtMs is recorded after load completion so slow inspection does not
 *   steal TTL budget from the usable snapshot window.
 * - Cache metadata never leaves this module.
 */
export class HealthEnvironmentCache {
  private readonly ttlMs: number;
  private readonly now: HealthEnvironmentClock;
  private readonly load: HealthEnvironmentLoader;
  private entry: CacheEntry | undefined;

  constructor(options: HealthEnvironmentCacheOptions = {}) {
    this.ttlMs = assertValidTtlMs(options.ttlMs ?? DEFAULT_HEALTH_ENVIRONMENT_TTL_MS);
    this.now = options.now ?? (() => Date.now());
    this.load = options.load ?? ((defaults) => loadHealthEnvironmentSnapshot(defaults));
  }

  getTtlMs(): number {
    return this.ttlMs;
  }

  /**
   * Return the cached complete snapshot when still valid for these defaults,
   * otherwise load one full replacement and store it.
   */
  get(providerDefaults: ProviderDefaultsSettings): HealthEnvironmentSnapshot {
    const identity = providerDefaultsIdentity(providerDefaults);
    const nowMs = this.now();
    if (
      this.entry !== undefined
      && this.entry.defaultsIdentity === identity
      && nowMs - this.entry.loadedAtMs < this.ttlMs
    ) {
      return this.entry.snapshot;
    }
    // Load first; only then stamp the entry so TTL starts after inspection finishes.
    const snapshot = sealHealthEnvironmentSnapshot(this.load(providerDefaults));
    const loadedAtMs = this.now();
    this.entry = {
      defaultsIdentity: identity,
      loadedAtMs,
      snapshot,
    };
    return snapshot;
  }

  /** Drop the retained snapshot so the next get() performs a fresh inspection. */
  invalidate(): void {
    this.entry = undefined;
  }
}
