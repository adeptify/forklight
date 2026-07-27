import {
  existsSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectSourceTree } from "./source-digest.js";

export const PROTOCOL_VERSION = 2;

export interface BuildIdentity {
  protocolVersion: number;
  packageVersion: string;
  buildId: string;
  builtAt: string;
  sourceRevision: string;
  /** Digest of the exact source inputs used to produce this build. */
  sourceDigest?: string;
}

export type VersionJourneyState =
  | "ready"
  | "source-needs-build"
  | "artifact-needs-restart"
  | "protocol-mismatch"
  | "unavailable";

export type VersionJourneyNextAction =
  | "none"
  | "build"
  | "restart"
  | "rebuild-and-restart"
  | "inspect";

export interface VersionJourney {
  state: VersionJourneyState;
  nextAction: VersionJourneyNextAction;
  layers: {
    source: { available: boolean; digest?: string; latestModifiedAt?: string };
    artifact: { available: boolean; buildIdentity?: BuildIdentity };
    daemon: { available: boolean; running: boolean; buildIdentity?: BuildIdentity };
  };
}

function repositoryRoot(modulePath: string): string {
  let current = path.dirname(modulePath);
  while (true) {
    if (existsSync(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new Error("ForkLight package root not found");
    current = parent;
  }
}

function packageVersion(root: string): string {
  const parsed = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    version?: unknown;
  };
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error("ForkLight package version is unavailable");
  }
  return parsed.version;
}

function sourceIdentity(root: string): BuildIdentity {
  const source = inspectSourceTree(root);
  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    packageVersion: packageVersion(root),
    buildId: `dev-${source.digest.slice(0, 32)}`,
    builtAt: source.latestModifiedAt,
    sourceRevision: "dev-source",
    sourceDigest: source.digest,
  });
}

export function isBuildIdentity(value: unknown): value is BuildIdentity {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<BuildIdentity>;
  return Number.isSafeInteger(candidate.protocolVersion)
    && typeof candidate.packageVersion === "string"
    && typeof candidate.buildId === "string"
    && typeof candidate.builtAt === "string"
    && Number.isFinite(Date.parse(candidate.builtAt))
    && typeof candidate.sourceRevision === "string"
    && (candidate.sourceDigest === undefined
      || (typeof candidate.sourceDigest === "string"
        && /^[a-f0-9]{64}$/.test(candidate.sourceDigest)));
}

function distIdentity(modulePath: string): BuildIdentity {
  const identityPath = path.resolve(path.dirname(modulePath), "..", "..", "build-identity.json");
  const parsed: unknown = JSON.parse(readFileSync(identityPath, "utf8"));
  if (!isBuildIdentity(parsed)) throw new Error("ForkLight build identity is malformed");
  return Object.freeze({ ...parsed });
}

const MODULE_PATH = fileURLToPath(import.meta.url);
const CURRENT_IDENTITY = MODULE_PATH.endsWith(".ts")
  ? sourceIdentity(repositoryRoot(MODULE_PATH))
  : distIdentity(MODULE_PATH);

export function currentBuildIdentity(): BuildIdentity {
  return CURRENT_IDENTITY;
}

export function compareBuildIdentity(
  client: BuildIdentity,
  server: BuildIdentity,
): { protocolCompatible: boolean; sameBuild: boolean } {
  const protocolCompatible = client.protocolVersion === server.protocolVersion;
  return {
    protocolCompatible,
    sameBuild: protocolCompatible && client.buildId === server.buildId,
  };
}

/** Pure three-layer truth: current source, Hub artifact, and running daemon. */
export function projectVersionJourney(
  source: { digest: string; latestModifiedAt: string } | undefined,
  artifact: BuildIdentity | undefined,
  daemon: { running: boolean; buildIdentity?: BuildIdentity },
): VersionJourney {
  const layers: VersionJourney["layers"] = {
    source: source === undefined
      ? { available: false }
      : { available: true, digest: source.digest, latestModifiedAt: source.latestModifiedAt },
    artifact: artifact === undefined
      ? { available: false }
      : { available: true, buildIdentity: artifact },
    daemon: daemon.buildIdentity === undefined
      ? { available: false, running: daemon.running }
      : { available: true, running: daemon.running, buildIdentity: daemon.buildIdentity },
  };

  if (source === undefined || artifact === undefined) {
    return { state: "unavailable", nextAction: "inspect", layers };
  }
  if (artifact.sourceDigest === undefined) {
    return { state: "unavailable", nextAction: "rebuild-and-restart", layers };
  }
  if (source.digest !== artifact.sourceDigest) {
    return { state: "source-needs-build", nextAction: "build", layers };
  }
  if (!daemon.running || daemon.buildIdentity === undefined) {
    return {
      state: daemon.running ? "unavailable" : "artifact-needs-restart",
      nextAction: daemon.running ? "inspect" : "restart",
      layers,
    };
  }
  if (artifact.protocolVersion !== daemon.buildIdentity.protocolVersion) {
    return { state: "protocol-mismatch", nextAction: "rebuild-and-restart", layers };
  }
  if (artifact.buildId !== daemon.buildIdentity.buildId) {
    return { state: "artifact-needs-restart", nextAction: "restart", layers };
  }
  return { state: "ready", nextAction: "none", layers };
}
