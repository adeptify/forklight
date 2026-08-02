/**
 * CLI health adapter for the canonical saved-Worker readiness resolver.
 *
 * Thin read-only bridge between the inputs already gathered by
 * `forklight health` and `resolveWorkerReadiness()` in
 * `src/core/worker-readiness.ts`.  Does not invent a second readiness
 * policy, mutate any state, or leak credentials, endpoints, paths,
 * raw diagnostics, or commands.
 */

import {
  resolveWorkerReadiness,
  type ProviderVerificationEvidence,
  type RuntimeReadinessEvidence,
  type WorkerReadinessInput,
  type WorkerReadinessResult,
} from "../core/worker-readiness.js";
import { deriveProviderHealthStatus, normalizeProbeStatusWithLocalSignIn } from "../core/provider-probe.js";
import type { ForkLightSettings } from "../core/settings.js";
import { providerNames, resolveProvider, type ProviderName, type ProviderReadiness } from "../core/providers.js";
import type { RuntimeName } from "../core/runtime-names.js";
import type { ProviderHealthStatus } from "../core/types.js";
import type { StateStore } from "../state/store.js";

export interface RuntimeDoctorSnapshot {
  /** Built-in adapter name (e.g. "claude-code", "grok-build"). */
  ok: boolean;
}

/**
 * Derive `ProviderHealthStatus` from persisted `ProbeEvidence` only, through
 * the same pure classifier used by ProviderProbeService. Missing evidence is
 * omitted so the resolver falls back to its bounded `unverified` default; no
 * fabricated identity or success is invented.
 */
export function safeProviderVerificationSnapshot(
  store: StateStore,
  settings: ForkLightSettings,
  providers: Record<ProviderName, ProviderReadiness>,
  now: number,
): Partial<Record<ProviderName, ProviderVerificationEvidence>> {
  const result: Partial<Record<ProviderName, ProviderVerificationEvidence>> = {};
  const cacheLifetimeMs = settings.probe.cacheLifetimeMs;
  for (const name of providerNames()) {
    const evidence = store.getProbeEvidence(name);
    if (evidence === undefined) continue;
    const config = resolveProvider(name, {}, settings.providerDefaults[name]);
    const currentEndpointOrigin = new URL(config.endpoint).origin;
    let status: ProviderHealthStatus = deriveProviderHealthStatus(
      providers[name].ready,
      evidence,
      config.model,
      currentEndpointOrigin,
      cacheLifetimeMs,
      now,
    );
    // Shared normalization: an old explicit-probe failure is not a real
    // connectivity failure when local sign-in provides a viable launch path.
    if (name === "xai" || name === "openai") {
      status = normalizeProbeStatusWithLocalSignIn(
        status,
        evidence,
        providers[name].authMode === "local-sign-in",
      );
    }
    result[name] = { status };
  }
  return result;
}

export interface BuildHealthWorkerReadinessInput {
  settings: ForkLightSettings;
  providers: Record<ProviderName, ProviderReadiness>;
  /** Adapter-name → ok flag.  Built-ins are synchronous; async adapters
   *  are excluded upstream. */
  runtimeDoctors: Partial<Record<RuntimeName, RuntimeDoctorSnapshot>>;
  /** Persisted probe evidence snapshot, already privacy-sanitized. */
  providerVerification: Partial<Record<ProviderName, ProviderVerificationEvidence>>;
}

/** Assemble the canonical `WorkerReadinessInput` for the resolver and
 *  return its ordered, privacy-safe projection.  Pure: does not call
 *  any adapter, the daemon, or a Provider. */
export function buildHealthWorkerReadiness(
  input: BuildHealthWorkerReadinessInput,
): WorkerReadinessResult[] {
  const runtimes: Partial<Record<RuntimeName, RuntimeReadinessEvidence>> = {};
  for (const [name, snapshot] of Object.entries(input.runtimeDoctors)) {
    if (snapshot === undefined) continue;
    runtimes[name as RuntimeName] = { ok: snapshot.ok };
  }
  const resolverInput: WorkerReadinessInput = {
    workerProfiles: input.settings.workerProfiles,
    modelCatalog: input.settings.modelCatalog,
    providerDefaults: input.settings.providerDefaults,
    providers: input.providers,
    runtimes,
    ...(input.providerVerification === undefined
      ? {}
      : { providerVerification: input.providerVerification }),
  };
  return resolveWorkerReadiness(resolverInput);
}

/** JSON projection: only the allowlisted safe fields per Worker.
 *  Excludes credentials, endpoints, paths, raw diagnostics, commands,
 *  and any internal `checks` object so the projection never grows
 *  beyond the resolver's bounded contract. */
export interface WorkerReadinessJsonEntry {
  workerId: string;
  workerLabel: string;
  state: WorkerReadinessResult["state"];
  canLaunch: boolean;
  reason: WorkerReadinessResult["reason"];
  nextAction: WorkerReadinessResult["nextAction"];
  runtime: RuntimeName;
  provider?: ProviderName;
  model?: string;
  /** Requested execution preference (single-run for legacy). */
  executionPreference: WorkerReadinessResult["executionPreference"];
  /** Resolved execution mode (auto already resolved). */
  resolvedExecutionMode: WorkerReadinessResult["resolvedExecutionMode"];
}

export function projectWorkerReadinessJson(
  results: readonly WorkerReadinessResult[],
): WorkerReadinessJsonEntry[] {
  return results.map((result) => ({
    workerId: result.workerId,
    workerLabel: result.workerLabel,
    state: result.state,
    canLaunch: result.canLaunch,
    reason: result.reason,
    nextAction: result.nextAction,
    runtime: result.runtime,
    ...(result.provider === undefined ? {} : { provider: result.provider }),
    ...(result.model === undefined ? {} : { model: result.model }),
    executionPreference: result.executionPreference,
    resolvedExecutionMode: result.resolvedExecutionMode,
  }));
}

/** Human projection: a short `workers:` section listing each saved
 *  Worker in canonical order.  Renders identity, state, reason, and
 *  the one next action the user should take.  Never includes endpoints,
 *  Keychain service names, paths, raw diagnostics, or commands. */
export function humanWorkerReadinessLines(
  results: readonly WorkerReadinessResult[],
): string {
  if (results.length === 0) return "workers: (none)\n";
  const lines: string[] = ["workers:"];
  for (const result of results) {
    const identity = `${result.workerId} (${result.workerLabel})`;
    lines.push(`  - ${identity}: ${result.state} [canLaunch=${result.canLaunch}]`);
    const binding = describeEffectiveBinding(result);
    if (binding !== undefined) lines.push(`    binding: ${binding}`);
    lines.push(`    execution: ${result.executionPreference} -> ${result.resolvedExecutionMode}`);
    lines.push(`    reason: ${describeReason(result.reason)}`);
    lines.push(`    next: ${describeNextAction(result.nextAction)}`);
  }
  return `${lines.join("\n")}\n`;
}

function describeEffectiveBinding(result: WorkerReadinessResult): string | undefined {
  if (result.provider === undefined && result.model === undefined) {
    return `${result.runtime}`;
  }
  if (result.provider !== undefined && result.model !== undefined) {
    return `${result.runtime} / ${result.provider} / ${result.model}`;
  }
  return result.provider !== undefined
    ? `${result.runtime} / ${result.provider}`
    : `${result.runtime} / ${result.model}`;
}

export function describeReason(reason: WorkerReadinessResult["reason"]): string {
  switch (reason) {
    case "ready":
      return "ready";
    case "connection-unverified":
      return "connection has never been verified";
    case "connection-stale":
      return "connection evidence is stale";
    case "connection-failed":
      return "last connection attempt failed";
    case "authentication-missing":
      return "local Provider authentication is not configured";
    case "runtime-unavailable":
      return "runtime is not installed or not ready";
    case "pairing-invalid":
      return "Provider is not compatible with the runtime";
    case "model-invalid":
      return "saved model is missing or invalid";
    case "native-goal-unsupported":
      return "the Runtime cannot prove a native Goal for the forced mode";
  }
}

export function describeNextAction(action: WorkerReadinessResult["nextAction"]): string {
  switch (action) {
    case "none":
      return "no action needed";
    case "run-smoke-check":
      return "run a smoke check to verify the connection";
    case "check-provider":
      return "check the Provider status and retry";
    case "configure-authentication":
      return "configure local Provider authentication";
    case "fix-runtime":
      return "install or repair the runtime";
    case "change-pairing":
      return "change the Worker to a compatible Provider/runtime pair";
    case "choose-model":
      return "choose a valid model for this Worker";
    case "choose-execution-mode":
      return "choose auto, one normal run, or a Runtime-native Goal";
  }
}
