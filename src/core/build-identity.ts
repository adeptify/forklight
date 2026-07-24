import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROTOCOL_VERSION = 2;

export interface BuildIdentity {
  protocolVersion: number;
  packageVersion: string;
  buildId: string;
  builtAt: string;
  sourceRevision: string;
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

function sourceFiles(root: string): string[] {
  const files: string[] = [path.join(root, "package.json")];
  const visit = (directory: string, extension: string): void => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute, extension);
      else if (entry.isFile() && entry.name.endsWith(extension)) files.push(absolute);
    }
  };
  visit(path.join(root, "src"), ".ts");
  visit(path.join(root, "scripts"), ".mjs");
  return files.sort();
}

function sourceIdentity(root: string): BuildIdentity {
  const hash = createHash("sha256");
  let latestMtimeMs = 0;
  for (const file of sourceFiles(root)) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    const bytes = readFileSync(file);
    hash.update(relative);
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
    latestMtimeMs = Math.max(latestMtimeMs, statSync(file).mtimeMs);
  }
  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    packageVersion: packageVersion(root),
    buildId: `dev-${hash.digest("hex").slice(0, 32)}`,
    builtAt: new Date(latestMtimeMs).toISOString(),
    sourceRevision: "dev-source",
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
    && typeof candidate.sourceRevision === "string";
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
