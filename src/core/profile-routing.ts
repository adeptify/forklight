/**
 * Daemon-owned Profile routing resolver.
 *
 * Resolves saved Worker Profile ids into frozen, privacy-safe Worker identities
 * from one authoritative Settings snapshot. It is the single trusted resolver:
 * CLI, MCP, and Hub only pass ids and display the daemon's result. No Provider
 * probe, endpoint output, credential access, Settings mutation, or execution.
 *
 * Profile identity (workerProfileId / workerLabel) is preserved on every
 * candidate. The statistics identity key remains provider + model + runtime +
 * effort, so two Profiles that resolve to the same executable identity stay
 * visible as two distinct user choices.
 */

import {
  assertProviderRuntimePair,
  type RuntimeName,
} from "./runtime-names.js";
import type { EffortLevel, ProviderDefaultsSettings } from "./settings.js";
import type { ModelCatalogSettings } from "./model-catalog.js";
import {
  getWorkerProfile,
  isWorkerProfileId,
  materializeWorkerModel,
  type WorkerProfilesSettings,
} from "./worker-profiles.js";

export const PROFILE_ROUTING_MIN = 2;
export const PROFILE_ROUTING_MAX = 10;

/** One frozen, privacy-safe routing candidate resolved from a saved Profile.
 *  Never contains endpoint, Keychain service, credentials, or budgets. */
export interface ProfileRoutingCandidate {
  workerProfileId: string;
  workerLabel: string;
  provider: string;
  model: string;
  runtime: RuntimeName;
  effort: EffortLevel;
}

export interface ProfileRoutingSettings {
  workerProfiles: WorkerProfilesSettings;
  /** Optional for legacy Profiles that carry provider+model directly. */
  modelCatalog?: ModelCatalogSettings;
  providerDefaults: ProviderDefaultsSettings;
  /** Effort fallback when a Profile does not pin one (same rule as task resolution). */
  defaultEffort: EffortLevel;
}

/** Strict transport+semantic validation of the Profile list. Rejects unknown,
 *  duplicate, malformed, or out-of-range ids before any evidence read. */
function validateWorkerProfileIdList(
  workerProfileIds: unknown,
  label = "workerProfileIds",
): string[] {
  if (!Array.isArray(workerProfileIds)) {
    throw new Error(`${label} must be an array`);
  }
  if (
    workerProfileIds.length < PROFILE_ROUTING_MIN
    || workerProfileIds.length > PROFILE_ROUTING_MAX
  ) {
    throw new Error(
      `${label} must contain ${PROFILE_ROUTING_MIN} to ${PROFILE_ROUTING_MAX} entries`,
    );
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < workerProfileIds.length; index += 1) {
    const raw = workerProfileIds[index];
    if (typeof raw !== "string" || raw.trim().length === 0) {
      throw new Error(`${label}[${index}] must be a non-empty string`);
    }
    const id = raw.trim();
    if (!isWorkerProfileId(id)) {
      throw new Error(`${label}[${index}] is not a valid worker profile id`);
    }
    if (seen.has(id)) {
      throw new Error(`${label} must not contain duplicate profile ids`);
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** Resolve saved Profile ids into frozen safe Worker identities. Read-only:
 *  never probes, never writes Settings, never returns endpoint/credential
 *  fields. Two Profiles sharing provider/model (or a full executable identity)
 *  always produce two distinct candidates. */
export function resolveProfileRoutingCandidates(
  workerProfileIds: unknown,
  settings: ProfileRoutingSettings,
): ProfileRoutingCandidate[] {
  const ids = validateWorkerProfileIdList(workerProfileIds);
  // Each candidate is frozen so later scoring/sorting can never mutate the
  // resolved Worker identity. The array itself stays a plain mutable container
  // for the routing surface; the objects are the frozen unit.
  return ids.map((id) => Object.freeze({
    workerProfileId: id,
    workerLabel: getWorkerProfile(settings.workerProfiles, id).label,
    ...resolveProfileIdentity(id, settings),
  }) satisfies ProfileRoutingCandidate);
}

/** Resolve one Profile's safe executable identity. Never returns endpoint or
 *  credential fields. */
function resolveProfileIdentity(
  id: string,
  settings: ProfileRoutingSettings,
): Pick<ProfileRoutingCandidate, "provider" | "model" | "runtime" | "effort"> {
  const profile = getWorkerProfile(settings.workerProfiles, id);
  const materialized = materializeWorkerModel(
    profile,
    settings.modelCatalog,
    settings.providerDefaults,
  );
  assertProviderRuntimePair(materialized.provider, profile.runtime);
  return {
    provider: materialized.provider,
    model: materialized.model,
    runtime: profile.runtime,
    effort: profile.effort ?? settings.defaultEffort,
  };
}
