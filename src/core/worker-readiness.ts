/**
 * Canonical, privacy-safe readiness for saved Worker Profiles.
 *
 * This is a read-only synthesis layer. It never probes a Provider, starts a
 * Worker, mutates settings, or exposes credentials, paths, commands, or raw
 * diagnostics.
 */

import type { ModelCatalogSettings } from "./model-catalog.js";
import type { ProviderName, ProviderReadiness } from "./providers.js";
import { assertProviderRuntimePair, type RuntimeName } from "./runtime-names.js";
import type { ProviderDefaultsSettings } from "./settings.js";
import type { ProviderHealthStatus } from "./types.js";
import {
  materializeWorkerModel,
  type WorkerProfile,
  type WorkerProfilesSettings,
} from "./worker-profiles.js";

export type WorkerReadinessState =
  | "ready"
  | "launchable"
  | "needs-attention"
  | "blocked";

export type WorkerReadinessReason =
  | "ready"
  | "connection-unverified"
  | "connection-stale"
  | "connection-failed"
  | "authentication-missing"
  | "runtime-unavailable"
  | "pairing-invalid"
  | "model-invalid";

export type WorkerReadinessNextAction =
  | "none"
  | "run-smoke-check"
  | "check-provider"
  | "configure-authentication"
  | "fix-runtime"
  | "change-pairing"
  | "choose-model";

export interface WorkerReadinessChecks {
  model: "ready" | "invalid";
  pairing: "allowed" | "invalid" | "unknown";
  authentication: ProviderReadiness["authMode"] | "unknown";
  runtime: "ready" | "unavailable" | "unknown";
  connection: ProviderHealthStatus;
}

export interface WorkerReadinessResult {
  workerId: string;
  workerLabel: string;
  state: WorkerReadinessState;
  canLaunch: boolean;
  reason: WorkerReadinessReason;
  nextAction: WorkerReadinessNextAction;
  runtime: RuntimeName;
  provider?: ProviderName;
  model?: string;
  checks: WorkerReadinessChecks;
}

export interface RuntimeReadinessEvidence {
  ok: boolean;
}

export interface ProviderVerificationEvidence {
  status?: ProviderHealthStatus;
}

export interface WorkerReadinessInput {
  workerProfiles: WorkerProfilesSettings;
  modelCatalog?: ModelCatalogSettings;
  providerDefaults: ProviderDefaultsSettings;
  providers: Record<ProviderName, ProviderReadiness>;
  runtimes: Partial<Record<RuntimeName, RuntimeReadinessEvidence>>;
  providerVerification?: Partial<Record<ProviderName, ProviderVerificationEvidence>>;
}

function checks(
  patch: Partial<WorkerReadinessChecks> = {},
): WorkerReadinessChecks {
  return {
    model: "invalid",
    pairing: "unknown",
    authentication: "unknown",
    runtime: "unknown",
    connection: "unverified",
    ...patch,
  };
}

function blocked(
  profile: WorkerProfile,
  reason: Extract<WorkerReadinessReason,
    "authentication-missing" | "runtime-unavailable" | "pairing-invalid" | "model-invalid">,
  nextAction: Extract<WorkerReadinessNextAction,
    "configure-authentication" | "fix-runtime" | "change-pairing" | "choose-model">,
  componentChecks: WorkerReadinessChecks,
  provider?: ProviderName,
  model?: string,
): WorkerReadinessResult {
  return {
    workerId: profile.id,
    workerLabel: profile.label,
    state: "blocked",
    canLaunch: false,
    reason,
    nextAction,
    runtime: profile.runtime,
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    checks: componentChecks,
  };
}

function resolveOne(
  profile: WorkerProfile,
  input: WorkerReadinessInput,
): WorkerReadinessResult {
  let provider: ProviderName;
  let model: string;
  try {
    const materialized = materializeWorkerModel(
      profile,
      input.modelCatalog,
      input.providerDefaults,
    );
    provider = materialized.provider;
    model = materialized.model;
  } catch {
    return blocked(
      profile,
      "model-invalid",
      "choose-model",
      checks(),
    );
  }

  try {
    assertProviderRuntimePair(provider, profile.runtime);
  } catch {
    return blocked(
      profile,
      "pairing-invalid",
      "change-pairing",
      checks({ model: "ready", pairing: "invalid" }),
      provider,
      model,
    );
  }

  const auth = input.providers[provider];
  if (auth === undefined || !auth.ready) {
    return blocked(
      profile,
      "authentication-missing",
      "configure-authentication",
      checks({
        model: "ready",
        pairing: "allowed",
        authentication: auth?.authMode ?? "none",
      }),
      provider,
      model,
    );
  }

  const runtime = input.runtimes[profile.runtime];
  if (runtime === undefined || !runtime.ok) {
    return blocked(
      profile,
      "runtime-unavailable",
      "fix-runtime",
      checks({
        model: "ready",
        pairing: "allowed",
        authentication: auth.authMode,
        runtime: "unavailable",
      }),
      provider,
      model,
    );
  }

  const connection = input.providerVerification?.[provider]?.status ?? "unverified";
  const componentChecks = checks({
    model: "ready",
    pairing: "allowed",
    authentication: auth.authMode,
    runtime: "ready",
    connection,
  });
  if (connection === "verified") {
    return {
      workerId: profile.id,
      workerLabel: profile.label,
      state: "ready",
      canLaunch: true,
      reason: "ready",
      nextAction: "none",
      runtime: profile.runtime,
      provider,
      model,
      checks: componentChecks,
    };
  }
  if (connection === "failed") {
    return {
      workerId: profile.id,
      workerLabel: profile.label,
      state: "needs-attention",
      canLaunch: true,
      reason: "connection-failed",
      nextAction: "check-provider",
      runtime: profile.runtime,
      provider,
      model,
      checks: componentChecks,
    };
  }
  return {
    workerId: profile.id,
    workerLabel: profile.label,
    state: "launchable",
    canLaunch: true,
    reason: connection === "stale" ? "connection-stale" : "connection-unverified",
    nextAction: "run-smoke-check",
    runtime: profile.runtime,
    provider,
    model,
    checks: componentChecks,
  };
}

/** Resolve every configured Worker in saved order. Returned objects are fresh
 *  safe projections and never retain caller-owned references. */
export function resolveWorkerReadiness(
  input: WorkerReadinessInput,
): WorkerReadinessResult[] {
  return input.workerProfiles.profiles.map((profile) => resolveOne(profile, input));
}
