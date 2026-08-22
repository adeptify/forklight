/**
 * Strict Delivery Profiles domain — reusable build/activation bundles and
 * deterministic profile selection with explicit-project-default precedence.
 * Pure code; no I/O, environment, credentials, command execution, or inference.
 */

import type { DeliveryPlanView, DeliveryResolution, DeliverySpec } from "./types.js";

const ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const PROFILE_KEYS = new Set(["id","label","buildCommands","activationCommands","activationCheckCommands"]);
const SETTINGS_KEYS = new Set(["defaultProfileId","profiles","projectBindings"]);
const MAX_CMDS = 16;

export interface DeliveryProfile {
  readonly id: string;
  readonly label: string;
  readonly buildCommands: readonly string[];
  readonly activationCommands: readonly string[];
  readonly activationCheckCommands: readonly string[];
}

export interface DeliveryProfilesSettings {
  readonly defaultProfileId: string | null;
  readonly profiles: readonly DeliveryProfile[];
  readonly projectBindings: Readonly<Record<string, string>>;
}

interface DeliverySelection {
  readonly profile: DeliveryProfile;
  readonly provenance: "explicit" | "project" | "default";
}

/** Purely lexical check — no filesystem access. */
export function isCanonicalAbsolutePath(v: string): boolean {
  if (v !== v.trim()) return false;
  if (v === "" || v[0] !== "/") return false;
  if (v !== "/") {
    if (v.endsWith("/")) return false;
    if (v.includes("//")) return false;
    if (/(?:^|\/)\.\.?(?:\/|$)/.test(v)) return false;
  }
  return true;
}

export function isDeliveryProfileId(v: string): boolean { return ID_RE.test(v); }

function requireCmds(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  if (value.length > MAX_CMDS) throw new Error(`${label} must have at most ${MAX_CMDS} entries`);
  const out: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (typeof item !== "string" || item.trim() === "")
      throw new Error(`${label}[${i}] must be a non-empty string`);
    out.push(item.trim());
  }
  return out;
}

function detach(p: DeliveryProfile): DeliveryProfile {
  return {
    id: p.id, label: p.label,
    buildCommands: [...p.buildCommands],
    activationCommands: [...p.activationCommands],
    activationCheckCommands: [...p.activationCheckCommands],
  };
}

export function validateDeliveryProfile(raw: unknown, label = "deliveryProfile"): DeliveryProfile {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw new Error(`${label} must be an object`);
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o))
    if (!PROFILE_KEYS.has(k)) throw new Error(`${label}: unsupported field "${k}"`);
  if (typeof o.id !== "string" || !ID_RE.test(o.id))
    throw new Error(`${label}.id must match ${ID_RE}`);
  if (typeof o.label !== "string" || o.label.trim().length < 1 || o.label.length > 80)
    throw new Error(`${label}.label must be a non-empty string ≤ 80 chars`);
  return {
    id: o.id, label: o.label.trim(),
    buildCommands: requireCmds(o.buildCommands, `${label}.buildCommands`),
    activationCommands: requireCmds(o.activationCommands, `${label}.activationCommands`),
    activationCheckCommands: requireCmds(o.activationCheckCommands, `${label}.activationCheckCommands`),
  };
}

function validateProjectBindings(
  raw: unknown, ids: Set<string>, label: string,
): Record<string, string> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw new Error(`${label}.projectBindings must be an object`);
  const o = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of Object.keys(o)) {
    if (!isCanonicalAbsolutePath(k))
      throw new Error(`${label}.projectBindings key must be an absolute canonical path`);
    if (typeof o[k] !== "string" || !ids.has(o[k] as string))
      throw new Error(`${label}.projectBindings value must reference an existing profile id`);
    out[k] = o[k] as string;
  }
  return out;
}

export function validateDeliveryProfilesSettings(
  raw: unknown, label = "deliveryProfiles",
): DeliveryProfilesSettings {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw new Error(`${label} must be an object`);
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o))
    if (!SETTINGS_KEYS.has(k)) throw new Error(`${label}: unsupported field "${k}"`);

  // defaultProfileId: string | null
  let defaultProfileId: string | null = null;
  if (o.defaultProfileId !== null && o.defaultProfileId !== undefined) {
    if (typeof o.defaultProfileId !== "string" || !ID_RE.test(o.defaultProfileId))
      throw new Error(`${label}.defaultProfileId is invalid`);
    defaultProfileId = o.defaultProfileId;
  }

  // profiles: may be empty
  if (!Array.isArray(o.profiles))
    throw new Error(`${label}.profiles must be an array`);
  if (o.profiles.length > 32)
    throw new Error(`${label}.profiles supports at most 32 entries`);
  const profiles = o.profiles.map((p, i) =>
    validateDeliveryProfile(p, `${label}.profiles[${i}]`));

  const ids = new Set<string>();
  for (const p of profiles) {
    if (ids.has(p.id)) throw new Error(`${label}: duplicate profile id ${p.id}`);
    ids.add(p.id);
  }

  // projectBindings
  const projectBindings = validateProjectBindings(o.projectBindings, ids, label);

  // default reference check
  if (defaultProfileId !== null && !ids.has(defaultProfileId))
    throw new Error(`${label}.defaultProfileId must reference an existing profile`);

  return { defaultProfileId, profiles, projectBindings };
}

export function getDeliveryProfile(s: DeliveryProfilesSettings, id: string): DeliveryProfile {
  const f = s.profiles.find((p) => p.id === id);
  if (!f) throw new Error(`Unknown delivery profile: ${id}`);
  return detach(f);
}

export function listDeliveryProfiles(s: DeliveryProfilesSettings): DeliveryProfile[] {
  return s.profiles.map((p) => detach(p));
}

/** Precedence: explicit id (fail-closed) → project binding → non-null default → null. */
export function selectDeliveryProfile(
  s: DeliveryProfilesSettings, projectPath: string, explicitId?: string,
): DeliverySelection | null {
  if (typeof projectPath !== "string" || !isCanonicalAbsolutePath(projectPath))
    throw new Error("projectPath must be an absolute canonical path");
  if (explicitId !== undefined) {
    if (typeof explicitId !== "string" || !ID_RE.test(explicitId))
      throw new Error("explicitDeliveryProfileId is malformed");
    const m = s.profiles.find((p) => p.id === explicitId);
    if (!m) throw new Error("explicitDeliveryProfileId not found in delivery profiles");
    return { profile: detach(m), provenance: "explicit" };
  }
  const boundId = s.projectBindings[projectPath];
  if (boundId !== undefined) {
    const b = s.profiles.find((p) => p.id === boundId);
    if (b) return { profile: detach(b), provenance: "project" };
  }
  if (s.defaultProfileId !== null) {
    const d = s.profiles.find((p) => p.id === s.defaultProfileId);
    if (d) return { profile: detach(d), provenance: "default" };
  }
  return null;
}

/** Project one immutable Task delivery snapshot into a safe bounded plan for Main and UI.
 *  Reads only the Task's DeliverySpec and DeliveryResolution fields.
 *  Never accesses settings, filesystem, or executes commands.
 *  A legacy task with no resolution tracking but inline delivery is described as inline. */
export function buildDeliveryPlanView(
  delivery: DeliverySpec | undefined,
  resolution: DeliveryResolution | undefined,
): DeliveryPlanView {
  const buildCount = delivery?.buildCommands.length ?? 0;
  const activationCount = delivery?.activationCommands.length ?? 0;
  const checkCount = delivery?.activationCheckCommands.length ?? 0;

  let resolutionSource: DeliveryPlanView["resolutionSource"];
  let profileId: string | undefined;

  if (resolution === undefined) {
    // Legacy: tracking field absent → best-effort from DeliverySpec presence.
    resolutionSource = delivery !== undefined ? "inline" : "none";
  } else if (resolution.source === "inline") {
    resolutionSource = "inline";
  } else {
    resolutionSource = resolution.source;
    profileId = resolution.profileId;
  }

  let outcome: DeliveryPlanView["outcome"];
  if (delivery === undefined) {
    outcome = "none";
  } else if (activationCount > 0 || checkCount > 0) {
    outcome = "activation";
  } else if (buildCount > 0) {
    outcome = "build";
  } else {
    outcome = "source-only";
  }

  return {
    resolutionSource,
    ...(profileId === undefined ? {} : { profileId }),
    buildCommandCount: buildCount,
    activationCommandCount: activationCount,
    activationCheckCommandCount: checkCount,
    outcome,
    stages: {
      sourceApply: "required",
      sourceVerify: "required",
      artifactBuild: buildCount > 0 ? "required" : "not-configured",
      runtimeActivation: activationCount > 0 || checkCount > 0 ? "required" : "not-configured",
    },
  };
}
