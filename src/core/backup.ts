/**
 * Local ForkLight Home backup and restore.
 *
 * Classification (include/exclude, containment, integrity, owner observation)
 * stays separate from copy/rename I/O so tests can inject only the final
 * activation and rollback renames. No per-file hash, lock, lease, or version handshake.
 */
import { randomBytes } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { currentBuildIdentity } from "./build-identity.js";
import {
  BACKUP_MANIFEST_NAME,
  daemonSocketPath,
  HOME_TRANSIENT_ENTRY_NAMES,
  STORE_DATABASE_NAME,
} from "./config.js";
import { storeIntegrityBlocksMutation } from "./storage-lifecycle.js";
import { isoTimestamp } from "./time.js";
import {
  BACKUP_SCHEMA,
  type BackupCredentialAbsence,
  type BackupExclusion,
  type BackupManifest,
  type BackupNextAction,
  type BackupOwnerObservation,
  type BackupResult,
  type StoreIntegrityCheck,
} from "./types.js";
import {
  isDaemonTransportUnavailable,
  probeDaemon,
} from "../daemon/client.js";
import { inspectHubStatus } from "../hub/instance.js";
import {
  backupStoreDatabase,
  checkDatabaseFileIntegrity,
  STORE_UNREADABLE_ERROR,
} from "../state/store.js";

const TRANSIENT_NAME_SET = new Set<string>(HOME_TRANSIENT_ENTRY_NAMES);

const CREDENTIALS: BackupCredentialAbsence = {
  keychain: "not-included",
  localRuntimeSignIn: "not-included",
  externalMainAuth: "not-included",
};

const MISSING_INTEGRITY: StoreIntegrityCheck = {
  quickCheck: "unreadable",
  foreignKeyViolationCount: 0,
};

const PRIVACY_LINE =
  "Keep this backup private; it may contain project code, diffs and logs.";
const CREDENTIAL_LINE =
  "Keychain credentials, local Grok/Codex sign-in, and external Main client files are not included.";

export const BACKUP_PATH_SAFETY_REASON = "escaping-path";

export interface BackupFileIo {
  exists(absPath: string): boolean;
  entryKind(absPath: string): "missing" | "symlink" | "directory" | "file" | "other";
  listNames(absDir: string): string[];
  readLink(absPath: string): string;
  realpath(absPath: string): string | undefined;
  readText(absPath: string): string;
  writeText(absPath: string, contents: string): void;
  copyFile(from: string, to: string): void;
  mkdir(absPath: string): void;
  symlink(target: string, dest: string): void;
  rename(from: string, to: string): void;
  remove(absPath: string): void;
  now(): string;
}

export interface BackupOwnerIo {
  observeDaemon(home: string): Promise<BackupOwnerObservation>;
  observeHub(home: string): Promise<BackupOwnerObservation>;
}

export interface BackupServiceOptions {
  io?: BackupFileIo;
  owners?: BackupOwnerIo;
  /** Test hook: replace only the final Home activation rename. */
  activateHome?: (stagePath: string, homePath: string) => void;
  /** Test hook: replace only putting the prior Home back after activation failure. */
  rollbackHome?: (recoveryPath: string, homePath: string) => void;
}

interface ClassifiedHome {
  included: string[];
  excluded: string[];
  excludedReasons: BackupExclusion[];
  externalLinkExclusionCount: number;
  storePresent: boolean;
}

function pathSafetyError(): Error {
  return Object.assign(new Error("Backup path is not contained"), {
    code: "escaping-path" as const,
  });
}

function isPathSafetyError(error: unknown): boolean {
  return error instanceof Error
    && (error as { code?: unknown }).code === "escaping-path";
}

/**
 * Resolve a path for containment: realpath the longest existing prefix, then
 * join the missing tail. Compares /var and /private/var as the same place.
 * Does not follow a missing or dangling final name — only existing prefixes.
 */
function physicalPath(absPath: string, io: BackupFileIo): string {
  const resolved = path.resolve(absPath);
  const missing: string[] = [];
  let cursor = resolved;
  while (true) {
    const real = io.realpath(cursor);
    if (real !== undefined) {
      return missing.length === 0 ? real : path.join(real, ...missing);
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      return missing.length === 0 ? resolved : path.join(resolved, ...missing);
    }
    missing.unshift(path.basename(cursor));
    cursor = parent;
  }
}

function isContained(candidate: string, root: string, io: BackupFileIo): boolean {
  const physicalCandidate = physicalPath(candidate, io);
  const physicalRoot = physicalPath(root, io);
  return physicalCandidate === physicalRoot
    || physicalCandidate.startsWith(physicalRoot + path.sep);
}

function assertSafeEntryName(name: string): void {
  if (
    name.length === 0
    || name === "."
    || name === ".."
    || name.includes("/")
    || name.includes("\\")
    || name.includes("\0")
  ) {
    throw pathSafetyError();
  }
}

function resolvedRoot(absPath: string, io: BackupFileIo): string {
  return io.realpath(absPath) ?? path.resolve(absPath);
}

function lexicalTarget(linkPath: string, linkText: string): string {
  return path.resolve(path.dirname(linkPath), linkText);
}

function linkStaysInside(linkPath: string, root: string, io: BackupFileIo): boolean {
  const text = io.readLink(linkPath);
  const lexical = lexicalTarget(linkPath, text);
  if (isContained(lexical, root, io)) {
    const real = io.realpath(linkPath);
    return real === undefined || isContained(real, root, io);
  }
  const real = io.realpath(linkPath);
  return real !== undefined && isContained(real, root, io);
}

function createDefaultBackupFileIo(): BackupFileIo {
  return {
    exists(absPath) {
      return existsSync(absPath);
    },
    entryKind(absPath) {
      try {
        const stats = lstatSync(absPath);
        if (stats.isSymbolicLink()) return "symlink";
        if (stats.isDirectory()) return "directory";
        if (stats.isFile()) return "file";
        return "other";
      } catch {
        return "missing";
      }
    },
    listNames(absDir) {
      try {
        return readdirSync(absDir);
      } catch {
        return [];
      }
    },
    readLink(absPath) {
      return readlinkSync(absPath);
    },
    realpath(absPath) {
      try {
        return realpathSync(absPath);
      } catch {
        return undefined;
      }
    },
    readText(absPath) {
      return readFileSync(absPath, "utf8");
    },
    writeText(absPath, contents) {
      writeFileSync(absPath, contents, { mode: 0o600 });
    },
    copyFile(from, to) {
      copyFileSync(from, to);
    },
    mkdir(absPath) {
      mkdirSync(absPath, { recursive: true, mode: 0o700 });
    },
    symlink(target, dest) {
      symlinkSync(target, dest);
    },
    rename(from, to) {
      renameSync(from, to);
    },
    remove(absPath) {
      rmSync(absPath, { recursive: true, force: true });
    },
    now: isoTimestamp,
  };
}

function transportLooksUnavailable(message: string): boolean {
  return isDaemonTransportUnavailable(new Error(message));
}

function createDefaultBackupOwnerIo(): BackupOwnerIo {
  return {
    async observeDaemon(home) {
      let socketIsLiveCandidate = false;
      try {
        socketIsLiveCandidate = lstatSync(daemonSocketPath(home)).isSocket();
      } catch {
        socketIsLiveCandidate = false;
      }
      const probe = await probeDaemon(home);
      if (probe.running) {
        return {
          owner: "daemon",
          state: "live",
          nextAction: "stop-daemon",
          reason: "A live Daemon owns this Home. Stop it with `forklight daemon stop`. Restore never stops it.",
        };
      }
      const error = probe.error ?? "";
      const identityOwned = /identity|mismatch|protocol|handshake/i.test(error);
      if (identityOwned) {
        return {
          owner: "daemon",
          state: "live",
          nextAction: "stop-daemon",
          reason: "A reachable Daemon owns this Home. Stop it with `forklight daemon stop`. Restore never stops it.",
        };
      }
      if (socketIsLiveCandidate && !transportLooksUnavailable(error)) {
        return {
          owner: "daemon",
          state: "unverified",
          nextAction: "investigate",
          reason: "Daemon ownership could not be verified. Investigate the Daemon, then retry. Restore never signals it.",
        };
      }
      return {
        owner: "daemon",
        state: "stopped",
        nextAction: "none",
        reason: "Daemon is not running.",
      };
    },
    async observeHub(home) {
      const status = await inspectHubStatus(home, {
        runIdentity: currentBuildIdentity(),
      });
      if (status.state === "stopped") {
        return {
          owner: "hub",
          state: "stopped",
          nextAction: "none",
          reason: "Hub is not running.",
        };
      }
      if (status.state === "unverified") {
        return {
          owner: "hub",
          state: "unverified",
          nextAction: "investigate",
          reason: "Hub ownership could not be verified. Investigate the Hub, then retry. Restore never signals it.",
        };
      }
      return {
        owner: "hub",
        state: "live",
        nextAction: "stop-hub",
        reason: "A live Hub owns this Home. Quit the ForkLight Hub process, then retry. Restore never stops it.",
      };
    },
  };
}

function classifyTopLevelEntry(
  home: string,
  name: string,
  io: BackupFileIo,
): { include: boolean; reason?: BackupExclusion["reason"] } {
  assertSafeEntryName(name);
  if (TRANSIENT_NAME_SET.has(name)) {
    return { include: false, reason: "transient" };
  }
  const abs = path.join(home, name);
  const kind = io.entryKind(abs);
  if (kind === "missing") return { include: false };
  if (kind === "other") return { include: false, reason: "transient" };
  if (kind === "symlink") {
    if (!linkStaysInside(abs, resolvedRoot(home, io), io)) {
      return { include: false, reason: "external-link" };
    }
    return { include: true };
  }
  return { include: true };
}

function countExternalLinks(root: string, relativeDir: string, io: BackupFileIo): number {
  const absDir = relativeDir.length === 0 ? root : path.join(root, relativeDir);
  let count = 0;
  for (const name of io.listNames(absDir)) {
    assertSafeEntryName(name);
    const absPath = path.join(absDir, name);
    const kind = io.entryKind(absPath);
    if (kind === "symlink") {
      if (!linkStaysInside(absPath, root, io)) count += 1;
      continue;
    }
    if (kind === "directory") {
      count += countExternalLinks(
        root,
        relativeDir.length === 0 ? name : path.join(relativeDir, name),
        io,
      );
    }
  }
  return count;
}

function classifyHome(home: string, io: BackupFileIo): ClassifiedHome {
  const included: string[] = [];
  const excludedReasons: BackupExclusion[] = [];
  const seenExcluded = new Set<string>();
  let externalLinkExclusionCount = 0;
  const names = io.exists(home) ? [...io.listNames(home)].sort() : [];
  for (const name of names) {
    const classified = classifyTopLevelEntry(home, name, io);
    if (classified.include) {
      included.push(name);
      continue;
    }
    if (classified.reason === undefined) continue;
    if (!seenExcluded.has(name)) {
      excludedReasons.push({ name, reason: classified.reason });
      seenExcluded.add(name);
    }
    if (classified.reason === "external-link") externalLinkExclusionCount += 1;
  }
  const homeRoot = io.exists(home) ? resolvedRoot(home, io) : path.resolve(home);
  for (const name of included) {
    if (io.entryKind(path.join(home, name)) !== "directory") continue;
    externalLinkExclusionCount += countExternalLinks(homeRoot, name, io);
  }
  for (const name of HOME_TRANSIENT_ENTRY_NAMES) {
    if (seenExcluded.has(name)) continue;
    excludedReasons.push({ name, reason: "transient" });
    seenExcluded.add(name);
  }
  excludedReasons.sort((left, right) => left.name.localeCompare(right.name));
  return {
    included,
    excluded: excludedReasons.map((item) => item.name),
    excludedReasons,
    externalLinkExclusionCount,
    storePresent: included.includes(STORE_DATABASE_NAME),
  };
}

function readHomeIntegrity(home: string, io: BackupFileIo): StoreIntegrityCheck {
  const databasePath = path.join(home, STORE_DATABASE_NAME);
  if (!io.exists(databasePath) || io.entryKind(databasePath) !== "file") {
    return MISSING_INTEGRITY;
  }
  try {
    return checkDatabaseFileIntegrity(databasePath);
  } catch {
    return MISSING_INTEGRITY;
  }
}

function baseResult(input: {
  kind: BackupResult["kind"];
  action: BackupResult["action"];
  status: BackupResult["status"];
  classified: ClassifiedHome;
  integrity: StoreIntegrityCheck;
  impact: string;
  nextAction: BackupNextAction;
  reason: string;
}): BackupResult {
  return {
    kind: input.kind,
    action: input.action,
    status: input.status,
    included: input.classified.included,
    excluded: input.classified.excluded,
    excludedReasons: input.classified.excludedReasons,
    externalLinkExclusionCount: input.classified.externalLinkExclusionCount,
    integrity: input.integrity,
    impact: input.impact,
    nextAction: input.nextAction,
    reason: input.reason,
    privacy: "keep-private",
    credentials: CREDENTIALS,
  };
}

function withLocation(
  result: BackupResult,
  extra: {
    destination?: string | undefined;
    backupPath?: string | undefined;
    recoveryCopy?: string | undefined;
    stagingPath?: string | undefined;
    owners?: BackupOwnerObservation[] | undefined;
  },
): BackupResult {
  return {
    ...result,
    ...(extra.destination === undefined ? {} : { destination: extra.destination }),
    ...(extra.backupPath === undefined ? {} : { backupPath: extra.backupPath }),
    ...(extra.recoveryCopy === undefined ? {} : { recoveryCopy: extra.recoveryCopy }),
    ...(extra.stagingPath === undefined ? {} : { stagingPath: extra.stagingPath }),
    ...(extra.owners === undefined ? {} : { owners: extra.owners }),
  };
}

function resolveExistingHome(home: string, io: BackupFileIo): string | undefined {
  const resolved = path.resolve(home);
  if (!io.exists(resolved) || io.entryKind(resolved) !== "directory") return undefined;
  if (resolved === path.parse(resolved).root) return undefined;
  return resolved;
}

function destinationConflict(
  home: string,
  destination: string,
  io: BackupFileIo,
): "existing-destination" | "destination-inside-home" | undefined {
  const dest = path.resolve(destination);
  if (isContained(dest, home, io)) return "destination-inside-home";
  if (io.exists(dest)) return "existing-destination";
  return undefined;
}

function siblingStage(targetPath: string, kind: "backup" | "restore"): string {
  const parent = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const id = randomBytes(6).toString("hex");
  return path.join(parent, `.${base}.forklight-${kind}-stage-${id}`);
}

function recoveryCopyPath(home: string, now: string): string {
  const parent = path.dirname(home);
  const base = path.basename(home);
  const stamp = now.replace(/[:.]/g, "-");
  return path.join(parent, `${base}.pre-restore-${stamp}`);
}

function relativeLinkText(destLink: string, destTarget: string): string {
  const relative = path.relative(path.dirname(destLink), destTarget);
  return relative.length === 0 ? "." : relative;
}

function assertContainedPath(absPath: string, root: string, io: BackupFileIo): void {
  if (!isContained(absPath, root, io)) throw pathSafetyError();
}

function mappedDestPath(
  sourceAbs: string,
  sourceRoot: string,
  destRoot: string,
  io: BackupFileIo,
): string {
  const relative = path.relative(physicalPath(sourceRoot, io), physicalPath(sourceAbs, io));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw pathSafetyError();
  }
  return relative.length === 0 ? destRoot : path.join(destRoot, relative);
}

function copyTreeContained(
  sourceRoot: string,
  destRoot: string,
  relativeDir: string,
  io: BackupFileIo,
  options: { skipNames?: ReadonlySet<string> },
): number {
  let externalLinks = 0;
  const sourceDir = relativeDir.length === 0 ? sourceRoot : path.join(sourceRoot, relativeDir);
  const destDir = relativeDir.length === 0 ? destRoot : path.join(destRoot, relativeDir);
  assertContainedPath(sourceDir, sourceRoot, io);
  assertContainedPath(destDir, destRoot, io);
  const names = [...io.listNames(sourceDir)].sort();
  const pendingLinks: string[] = [];
  for (const name of names) {
    assertSafeEntryName(name);
    if (relativeDir.length === 0 && options.skipNames?.has(name)) continue;
    const sourcePath = path.join(sourceDir, name);
    const destPath = path.join(destDir, name);
    const kind = io.entryKind(sourcePath);
    if (kind === "symlink") {
      if (!linkStaysInside(sourcePath, sourceRoot, io)) {
        externalLinks += 1;
        continue;
      }
      pendingLinks.push(name);
      continue;
    }
    if (kind === "directory") {
      io.mkdir(destPath);
      externalLinks += copyTreeContained(
        sourceRoot,
        destRoot,
        relativeDir.length === 0 ? name : path.join(relativeDir, name),
        io,
        options,
      );
      continue;
    }
    if (kind === "file") {
      io.copyFile(sourcePath, destPath);
      continue;
    }
    if (kind === "other") continue;
  }
  for (const name of pendingLinks) {
    const sourcePath = path.join(sourceDir, name);
    const destPath = path.join(destDir, name);
    const text = io.readLink(sourcePath);
    const sourceTarget = lexicalTarget(sourcePath, text);
    if (!isContained(sourceTarget, sourceRoot, io)) {
      externalLinks += 1;
      continue;
    }
    let destTarget: string;
    try {
      destTarget = mappedDestPath(sourceTarget, sourceRoot, destRoot, io);
    } catch {
      externalLinks += 1;
      continue;
    }
    if (!isContained(destTarget, destRoot, io)) {
      externalLinks += 1;
      continue;
    }
    io.symlink(relativeLinkText(destPath, destTarget), destPath);
  }
  return externalLinks;
}

function assertTreeContained(root: string, relativeDir: string, io: BackupFileIo): void {
  const absDir = relativeDir.length === 0 ? root : path.join(root, relativeDir);
  assertContainedPath(absDir, root, io);
  for (const name of io.listNames(absDir)) {
    assertSafeEntryName(name);
    const absPath = path.join(absDir, name);
    const kind = io.entryKind(absPath);
    if (kind === "other") throw pathSafetyError();
    if (kind === "symlink") {
      if (!linkStaysInside(absPath, root, io)) throw pathSafetyError();
      continue;
    }
    if (kind === "directory") {
      assertTreeContained(
        root,
        relativeDir.length === 0 ? name : path.join(relativeDir, name),
        io,
      );
    }
  }
}

async function copyIncludedEntries(
  sourceRoot: string,
  destRoot: string,
  included: readonly string[],
  io: BackupFileIo,
  options: { onlineBackupStore: boolean },
): Promise<void> {
  io.mkdir(destRoot);
  for (const name of included) {
    assertSafeEntryName(name);
    const sourcePath = path.join(sourceRoot, name);
    const destPath = path.join(destRoot, name);
    const kind = io.entryKind(sourcePath);
    if (kind === "missing") throw pathSafetyError();
    if (name === STORE_DATABASE_NAME && options.onlineBackupStore && kind === "file") {
      await backupStoreDatabase(sourcePath, destPath);
      continue;
    }
    if (kind === "directory") {
      io.mkdir(destPath);
      copyTreeContained(sourceRoot, destRoot, name, io, {});
      continue;
    }
    if (kind === "file") {
      io.copyFile(sourcePath, destPath);
      continue;
    }
    if (kind === "symlink") {
      if (!linkStaysInside(sourcePath, sourceRoot, io)) throw pathSafetyError();
      const text = io.readLink(sourcePath);
      const sourceTarget = lexicalTarget(sourcePath, text);
      if (!isContained(sourceTarget, sourceRoot, io)) throw pathSafetyError();
      const destTarget = mappedDestPath(sourceTarget, sourceRoot, destRoot, io);
      if (!isContained(destTarget, destRoot, io)) throw pathSafetyError();
      io.symlink(relativeLinkText(destPath, destTarget), destPath);
      continue;
    }
    throw pathSafetyError();
  }
  assertTreeContained(destRoot, "", io);
}

function writeManifest(destRoot: string, manifest: BackupManifest, io: BackupFileIo): void {
  io.writeText(
    path.join(destRoot, BACKUP_MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function parseManifest(raw: string): BackupManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("malformed-manifest");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("malformed-manifest");
  }
  const value = parsed as Record<string, unknown>;
  if (value.schema !== BACKUP_SCHEMA) throw new Error("malformed-manifest");
  if (typeof value.createdAt !== "string" || value.createdAt.length === 0) {
    throw new Error("malformed-manifest");
  }
  if (!Array.isArray(value.included) || !value.included.every((item) => typeof item === "string")) {
    throw new Error("malformed-manifest");
  }
  if (!Array.isArray(value.excluded) || !value.excluded.every((item) => typeof item === "string")) {
    throw new Error("malformed-manifest");
  }
  if (
    typeof value.externalLinkExclusionCount !== "number"
    || !Number.isSafeInteger(value.externalLinkExclusionCount)
    || value.externalLinkExclusionCount < 0
  ) {
    throw new Error("malformed-manifest");
  }
  const integrity = value.integrity;
  if (integrity === null || typeof integrity !== "object" || Array.isArray(integrity)) {
    throw new Error("malformed-manifest");
  }
  const integrityRecord = integrity as Record<string, unknown>;
  if (typeof integrityRecord.quickCheck !== "string") throw new Error("malformed-manifest");
  if (
    typeof integrityRecord.foreignKeyViolationCount !== "number"
    || !Number.isSafeInteger(integrityRecord.foreignKeyViolationCount)
    || integrityRecord.foreignKeyViolationCount < 0
  ) {
    throw new Error("malformed-manifest");
  }
  for (const name of value.included) assertSafeEntryName(name);
  for (const name of value.excluded) assertSafeEntryName(name);
  return {
    schema: BACKUP_SCHEMA,
    createdAt: value.createdAt,
    included: value.included,
    excluded: value.excluded,
    externalLinkExclusionCount: value.externalLinkExclusionCount,
    integrity: {
      quickCheck: integrityRecord.quickCheck,
      foreignKeyViolationCount: integrityRecord.foreignKeyViolationCount,
    },
  };
}

function readManifest(backupPath: string, io: BackupFileIo): BackupManifest {
  const manifestPath = path.join(backupPath, BACKUP_MANIFEST_NAME);
  if (io.entryKind(manifestPath) !== "file") throw new Error("malformed-manifest");
  return parseManifest(io.readText(manifestPath));
}

function inspectBackupTree(backupPath: string, manifest: BackupManifest, io: BackupFileIo): ClassifiedHome {
  assertTreeContained(backupPath, "", io);
  const classified = classifyHome(backupPath, io);
  classified.included = classified.included.filter((name) => name !== BACKUP_MANIFEST_NAME);
  for (const name of manifest.included) {
    if (io.entryKind(path.join(backupPath, name)) === "missing") {
      throw new Error("malformed-manifest");
    }
  }
  return classified;
}

function scrubTransientSidecars(root: string, io: BackupFileIo): void {
  for (const name of HOME_TRANSIENT_ENTRY_NAMES) {
    const sidecar = path.join(root, name);
    if (io.exists(sidecar)) io.remove(sidecar);
  }
}

function inspectStoreOrThrow(backupPath: string, io: BackupFileIo): StoreIntegrityCheck {
  const databasePath = path.join(backupPath, STORE_DATABASE_NAME);
  if (io.entryKind(databasePath) !== "file") throw new Error("store-unreadable");
  try {
    return checkDatabaseFileIntegrity(databasePath);
  } catch {
    throw new Error("store-unreadable");
  }
}

function fileIo(options: BackupServiceOptions): BackupFileIo {
  return options.io ?? createDefaultBackupFileIo();
}

function ownerIo(options: BackupServiceOptions): BackupOwnerIo {
  return options.owners ?? createDefaultBackupOwnerIo();
}

export async function previewBackup(
  home: string,
  destination: string,
  options: BackupServiceOptions = {},
): Promise<BackupResult> {
  const io = fileIo(options);
  const resolvedHome = resolveExistingHome(home, io);
  if (resolvedHome === undefined) {
    return baseResult({
      kind: "backup-preview",
      action: "preview",
      status: "refused",
      classified: classifyHome(path.resolve(home), io),
      integrity: MISSING_INTEGRITY,
      impact: "No backup will be created. The current Home is unchanged.",
      nextAction: "none",
      reason: "home-missing",
    });
  }
  const dest = path.resolve(destination);
  const classified = classifyHome(resolvedHome, io);
  const integrity = readHomeIntegrity(resolvedHome, io);
  const conflict = destinationConflict(resolvedHome, dest, io);
  if (conflict !== undefined) {
    return withLocation(baseResult({
      kind: "backup-preview",
      action: "preview",
      status: "refused",
      classified,
      integrity,
      impact: "No backup will be created. The current Home is unchanged.",
      nextAction: "none",
      reason: conflict,
    }), { destination: dest });
  }
  if (!classified.storePresent || storeIntegrityBlocksMutation(integrity)) {
    return withLocation(baseResult({
      kind: "backup-preview",
      action: "preview",
      status: "refused",
      classified,
      integrity,
      impact: "No backup will be created. The current Home is unchanged.",
      nextAction: "none",
      reason: classified.storePresent ? "store-integrity" : "store-unreadable",
    }), { destination: dest });
  }
  return withLocation(baseResult({
    kind: "backup-preview",
    action: "preview",
    status: "ready",
    classified,
    integrity,
    impact: "A new backup directory will be created. The current Home is not changed.",
    nextAction: "create-with-confirm",
    reason: "ready",
  }), { destination: dest });
}

export async function createBackup(
  home: string,
  destination: string,
  options: BackupServiceOptions = {},
): Promise<BackupResult> {
  const io = fileIo(options);
  const preview = await previewBackup(home, destination, options);
  if (preview.status !== "ready") {
    return { ...preview, kind: "backup-create", action: "create" };
  }
  const resolvedHome = path.resolve(home);
  const dest = path.resolve(destination);
  const stage = siblingStage(dest, "backup");
  try {
    io.mkdir(path.dirname(dest));
    io.mkdir(stage);
    await copyIncludedEntries(resolvedHome, stage, preview.included, io, {
      onlineBackupStore: true,
    });
    const stagedIntegrity = inspectStoreOrThrow(stage, io);
    if (storeIntegrityBlocksMutation(stagedIntegrity)) {
      io.remove(stage);
      return withLocation(baseResult({
        kind: "backup-create",
        action: "create",
        status: "refused",
        classified: {
          included: preview.included,
          excluded: preview.excluded,
          excludedReasons: preview.excludedReasons,
          externalLinkExclusionCount: preview.externalLinkExclusionCount,
          storePresent: true,
        },
        integrity: stagedIntegrity,
        impact: "No backup was published. The current Home is unchanged.",
        nextAction: "none",
        reason: "store-integrity",
      }), { destination: dest });
    }
    scrubTransientSidecars(stage, io);
    const manifest: BackupManifest = {
      schema: BACKUP_SCHEMA,
      createdAt: io.now(),
      included: preview.included,
      excluded: preview.excluded,
      externalLinkExclusionCount: preview.externalLinkExclusionCount,
      integrity: stagedIntegrity,
    };
    writeManifest(stage, manifest, io);
    if (io.exists(dest)) {
      io.remove(stage);
      return withLocation(baseResult({
        kind: "backup-create",
        action: "create",
        status: "refused",
        classified: {
          included: preview.included,
          excluded: preview.excluded,
          excludedReasons: preview.excludedReasons,
          externalLinkExclusionCount: preview.externalLinkExclusionCount,
          storePresent: true,
        },
        integrity: stagedIntegrity,
        impact: "No backup was published. The current Home is unchanged.",
        nextAction: "none",
        reason: "existing-destination",
      }), { destination: dest });
    }
    io.rename(stage, dest);
    return withLocation(baseResult({
      kind: "backup-create",
      action: "create",
      status: "completed",
      classified: {
        included: preview.included,
        excluded: preview.excluded,
        excludedReasons: preview.excludedReasons,
        externalLinkExclusionCount: preview.externalLinkExclusionCount,
        storePresent: true,
      },
      integrity: stagedIntegrity,
      impact: "Backup created. The current Home is unchanged.",
      nextAction: "inspect",
      reason: "completed",
    }), { destination: dest, backupPath: dest });
  } catch (error) {
    if (io.exists(stage)) io.remove(stage);
    if (isPathSafetyError(error)) {
      return withLocation(baseResult({
        kind: "backup-create",
        action: "create",
        status: "refused",
        classified: {
          included: preview.included,
          excluded: preview.excluded,
          excludedReasons: preview.excludedReasons,
          externalLinkExclusionCount: preview.externalLinkExclusionCount,
          storePresent: preview.included.includes(STORE_DATABASE_NAME),
        },
        integrity: preview.integrity,
        impact: "No backup was published. The current Home is unchanged.",
        nextAction: "none",
        reason: BACKUP_PATH_SAFETY_REASON,
      }), { destination: dest });
    }
    throw error;
  }
}

export async function inspectBackup(
  backupPath: string,
  options: BackupServiceOptions = {},
): Promise<BackupResult> {
  const io = fileIo(options);
  const resolved = path.resolve(backupPath);
  try {
    if (io.entryKind(resolved) !== "directory") {
      throw new Error("malformed-manifest");
    }
    const manifest = readManifest(resolved, io);
    const classified = inspectBackupTree(resolved, manifest, io);
    const integrity = inspectStoreOrThrow(resolved, io);
    if (storeIntegrityBlocksMutation(integrity)) {
      return withLocation(baseResult({
        kind: "backup-inspect",
        action: "inspect",
        status: "refused",
        classified,
        integrity,
        impact: "This backup is not safe to restore. The current Home is unchanged.",
        nextAction: "none",
        reason: "store-integrity",
      }), { backupPath: resolved });
    }
    return withLocation(baseResult({
      kind: "backup-inspect",
      action: "inspect",
      status: "ready",
      classified,
      integrity,
      impact: "Backup is readable and self-contained. Restore requires a stopped Daemon and Hub.",
      nextAction: "restore-with-confirm",
      reason: "ready",
    }), { backupPath: resolved });
  } catch (error) {
    const reason = error instanceof Error && (
      error.message === "malformed-manifest"
      || error.message === "store-unreadable"
      || error.message === STORE_UNREADABLE_ERROR
    )
      ? (error.message === STORE_UNREADABLE_ERROR ? "store-unreadable" : error.message)
      : isPathSafetyError(error)
        ? BACKUP_PATH_SAFETY_REASON
        : "malformed-manifest";
    return withLocation(baseResult({
      kind: "backup-inspect",
      action: "inspect",
      status: "refused",
      classified: {
        included: [],
        excluded: [...HOME_TRANSIENT_ENTRY_NAMES],
        excludedReasons: HOME_TRANSIENT_ENTRY_NAMES.map((name) => ({
          name,
          reason: "transient" as const,
        })),
        externalLinkExclusionCount: 0,
        storePresent: false,
      },
      integrity: MISSING_INTEGRITY,
      impact: "This backup was rejected before any Home change.",
      nextAction: "none",
      reason,
    }), { backupPath: resolved });
  }
}

async function observeOwners(
  home: string,
  options: BackupServiceOptions,
): Promise<BackupOwnerObservation[]> {
  const owners = ownerIo(options);
  return [await owners.observeDaemon(home), await owners.observeHub(home)];
}

function ownerRefusal(owners: readonly BackupOwnerObservation[]): BackupOwnerObservation | undefined {
  return owners.find((item) => item.state === "live")
    ?? owners.find((item) => item.state === "unverified");
}

export async function previewRestore(
  home: string,
  backupPath: string,
  options: BackupServiceOptions = {},
): Promise<BackupResult> {
  const io = fileIo(options);
  const resolvedHome = resolveExistingHome(home, io);
  const inspected = await inspectBackup(backupPath, options);
  const owners = resolvedHome === undefined ? [] : await observeOwners(resolvedHome, options);
  if (inspected.status !== "ready") {
    return withLocation({
      ...inspected,
      kind: "backup-restore",
      action: "restore",
      impact: "Restore did not run. The current Home is unchanged.",
    }, { owners, backupPath: path.resolve(backupPath) });
  }
  if (resolvedHome === undefined) {
    return withLocation({
      ...inspected,
      kind: "backup-restore",
      action: "restore",
      status: "refused",
      reason: "home-missing",
      nextAction: "none",
      impact: "Restore did not run. The current Home is missing.",
    }, { owners, backupPath: inspected.backupPath });
  }
  const blocking = ownerRefusal(owners);
  if (blocking !== undefined) {
    return withLocation({
      ...inspected,
      kind: "backup-restore",
      action: "restore",
      status: "refused",
      reason: blocking.state === "live" ? "live-owner" : "unverified-owner",
      nextAction: blocking.nextAction === "none" ? "investigate" : blocking.nextAction,
      impact: "Nothing was moved. The current Home is unchanged.",
    }, { owners, backupPath: inspected.backupPath });
  }
  return withLocation({
    ...inspected,
    kind: "backup-restore",
    action: "restore",
    status: "ready",
    reason: "ready",
    nextAction: "restore-with-confirm",
    impact: "Restore will replace the current Home after keeping it as a named recovery copy.",
  }, { owners, backupPath: inspected.backupPath });
}

export async function restoreBackup(
  home: string,
  backupPath: string,
  options: BackupServiceOptions = {},
): Promise<BackupResult> {
  const io = fileIo(options);
  const preview = await previewRestore(home, backupPath, options);
  if (preview.status !== "ready") return preview;
  const resolvedHome = path.resolve(home);
  const resolvedBackup = path.resolve(backupPath);
  const stage = siblingStage(resolvedHome, "restore");
  let recovery: string | undefined;
  const activate = options.activateHome ?? ((from, to) => io.rename(from, to));
  const rollback = options.rollbackHome ?? ((from, to) => io.rename(from, to));
  try {
    io.mkdir(stage);
    await copyIncludedEntries(resolvedBackup, stage, preview.included, io, {
      onlineBackupStore: false,
    });
    const stagedIntegrity = inspectStoreOrThrow(stage, io);
    if (storeIntegrityBlocksMutation(stagedIntegrity)) {
      io.remove(stage);
      return withLocation({
        ...preview,
        status: "refused",
        reason: "store-integrity",
        nextAction: "none",
        integrity: stagedIntegrity,
        impact: "Restore did not replace the Home. The current Home is unchanged.",
      }, { backupPath: resolvedBackup, owners: preview.owners });
    }
    scrubTransientSidecars(stage, io);
    assertTreeContained(stage, "", io);
    const lateOwners = await observeOwners(resolvedHome, options);
    const lateBlock = ownerRefusal(lateOwners);
    if (lateBlock !== undefined) {
      io.remove(stage);
      return withLocation({
        ...preview,
        status: "refused",
        reason: lateBlock.state === "live" ? "live-owner" : "unverified-owner",
        nextAction: lateBlock.nextAction === "none" ? "investigate" : lateBlock.nextAction,
        impact: "Nothing was moved. The current Home is unchanged.",
      }, { backupPath: resolvedBackup, owners: lateOwners });
    }
    recovery = recoveryCopyPath(resolvedHome, io.now());
    if (io.exists(recovery)) {
      recovery = `${recovery}-${randomBytes(4).toString("hex")}`;
    }
    io.rename(resolvedHome, recovery);
    try {
      activate(stage, resolvedHome);
    } catch {
      try {
        rollback(recovery, resolvedHome);
        return withLocation({
          ...preview,
          status: "failed",
          reason: "activation-failed",
          nextAction: "none",
          impact: "Activation failed. The previous Home was put back. No partial Home is active.",
        }, {
          backupPath: resolvedBackup,
          recoveryCopy: recovery,
          stagingPath: io.exists(stage) ? stage : undefined,
          owners: preview.owners,
        });
      } catch {
        return withLocation({
          ...preview,
          status: "failed",
          reason: "activation-failed",
          nextAction: "investigate",
          impact: "Activation failed. The previous Home was not put back; recovery and staging paths remain.",
        }, {
          backupPath: resolvedBackup,
          recoveryCopy: recovery,
          stagingPath: io.exists(stage) ? stage : undefined,
          owners: preview.owners,
        });
      }
    }
    return withLocation({
      ...preview,
      status: "completed",
      reason: "completed",
      nextAction: "none",
      integrity: stagedIntegrity,
      impact: "Home replaced. The previous Home remains as a named recovery copy. Start ForkLight normally to regenerate transient owner files.",
    }, {
      backupPath: resolvedBackup,
      recoveryCopy: recovery,
      owners: preview.owners,
    });
  } catch (error) {
    if (io.exists(stage) && !io.exists(resolvedHome)) {
      // Home was moved; do not delete the only remaining copy.
    } else if (io.exists(stage)) {
      io.remove(stage);
    }
    if (isPathSafetyError(error)) {
      return withLocation({
        ...preview,
        status: "refused",
        reason: BACKUP_PATH_SAFETY_REASON,
        nextAction: "none",
        impact: "Restore was rejected before Home mutation.",
      }, { backupPath: resolvedBackup, owners: preview.owners });
    }
    throw error;
  }
}

export function formatBackupHuman(result: BackupResult): string {
  const lines = [
    `backup: ${result.action}`,
    `status: ${result.status}`,
    `included: ${result.included.length === 0 ? "(none)" : result.included.join(", ")}`,
    `excluded: ${result.excluded.length === 0 ? "(none)" : result.excluded.join(", ")}`,
    `externalLinkExclusionCount: ${result.externalLinkExclusionCount}`,
    `integrity: ${result.integrity.quickCheck} (foreignKeyViolations=${result.integrity.foreignKeyViolationCount})`,
    `credentials: ${CREDENTIAL_LINE}`,
    `privacy: ${PRIVACY_LINE}`,
    `impact: ${result.impact}`,
    `nextAction: ${result.nextAction}`,
    `reason: ${result.reason}`,
  ];
  if (result.destination !== undefined) lines.push(`destination: ${result.destination}`);
  if (result.backupPath !== undefined) lines.push(`backupPath: ${result.backupPath}`);
  if (result.recoveryCopy !== undefined) lines.push(`recoveryCopy: ${result.recoveryCopy}`);
  if (result.stagingPath !== undefined) lines.push(`stagingPath: ${result.stagingPath}`);
  if (result.owners !== undefined) {
    for (const owner of result.owners) {
      lines.push(`owner ${owner.owner}: ${owner.state}`);
      if (owner.reason.length > 0) lines.push(`  ${owner.reason}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
