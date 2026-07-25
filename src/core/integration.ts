import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { IntegrationSettings } from "./settings.js";
import type { StateStore } from "../state/store.js";
import type {
  IntegrationReceiptRecord,
  IntegrationResultRecord,
  IntegrationStageEvidence,
  ActivationHandoff,
  TaskRecord,
  VerificationCommandResult,
} from "./types.js";
import { runCaptured } from "./process.js";
import { verifierProcessEnvironment } from "../workspace/verifier-git.js";
import { latestMainReview } from "./main-review.js";

// --- Public type aliases ---

export type PreflightReceipt = Omit<IntegrationReceiptRecord, "consumed">;
type IntegrationStatus = IntegrationResultRecord["status"];
export type IntegrationResult = Omit<IntegrationResultRecord, "id" | "createdAt">;
type IntegrationExecutionResult = IntegrationResult | {
  status: "activation-pending";
  receiptId: string;
  taskId: string;
  handoff: Omit<ActivationHandoff, "home">;
};

// --- Error class ---

class IntegrationRejection extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationRejection";
  }
}

// --- Helpers ---

interface ManifestEntry {
  path: string;
  bytes: number;
  sha256: string;
}

interface SourceManifest {
  files: ManifestEntry[];
  skippedSymlinks: string[];
}

interface BackupRecord {
  file: string;
  existed: boolean;
  backupPath: string;
  digest: string;
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function recordStage(
  store: StateStore,
  taskId: string,
  operationId: string,
  receiptId: string,
  stages: IntegrationStageEvidence[],
  evidence: IntegrationStageEvidence,
): void {
  const existing = stages.findIndex((stage) => stage.stage === evidence.stage);
  if (existing >= 0) stages[existing] = evidence;
  else stages.push(evidence);
  store.addEvent(
    taskId,
    undefined,
    "integration.stage.completed",
    `${evidence.stage}: ${evidence.status}`,
    { operationId, receiptId, evidence },
  );
}

async function runCommandList(
  commands: string[],
  cwd: string,
  timeoutMs: number,
): Promise<VerificationCommandResult[]> {
  const results: VerificationCommandResult[] = [];
  for (const command of commands) {
    try {
      const result = await runCaptured(
        "/bin/zsh",
        ["-lc", command],
        { cwd, timeoutMs },
      );
      results.push({
        command,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
      });
    } catch (error) {
      results.push({
        command,
        exitCode: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        durationMs: 0,
        timedOut: false,
      });
    }
  }
  return results;
}

async function fileDigest(absPath: string): Promise<string> {
  const buf = await readFile(absPath);
  return sha256(buf);
}

// --- Strict path validation ---

function detectUnsafePath(file: string): string | undefined {
  if (path.isAbsolute(file)) return `Absolute path: "${file}"`;
  if (!file || file.includes("\\") || file.includes("\0")) {
    return `Ambiguous path: "${file}"`;
  }
  if (file.split("/").some((segment) => segment === ".." || segment === "." || !segment)) {
    return `Traversal path: "${file}"`;
  }
  return undefined;
}

async function validateSourcePath(sourcePath: string, file: string): Promise<string | undefined> {
  const unsafe = detectUnsafePath(file);
  if (unsafe) return unsafe;
  const parts = file.split("/");
  let current = sourcePath;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]!);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink()) return `Symlink path is not supported: "${file}"`;
      if (index < parts.length - 1 && !metadata.isDirectory()) {
        return `Non-directory path ancestor: "${file}"`;
      }
      if (index === parts.length - 1 && metadata.isDirectory()) {
        return `Directory patch target is not supported: "${file}"`;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function parseOneDiffHeader(line: string): { oldPath: string; newPath: string } {
  const rest = line.slice("diff --git ".length).trim();

  if (rest.includes('"')) throw new IntegrationRejection(`Quoted-ambiguous path: ${line}`);

  // Unquoted form: a/path b/path (no embedded spaces in paths)
  const m = rest.match(/^a\/(\S+)\s+b\/(\S+)$/);
  if (!m) throw new IntegrationRejection(`Malformed diff header: ${line}`);
  return { oldPath: m[1]!, newPath: m[2]! };
}

function parseAffectedFiles(diff: string): string[] {
  const files = new Set<string>();
  const sections = diff.split(/(?=^diff --git )/m).filter((section) => section.startsWith("diff --git "));
  for (const section of sections) {
    const lines = section.split("\n");
    const diffHeader = parseOneDiffHeader(lines[0]!);
    const oldHeader = lines.find((line) => line.startsWith("--- "));
    const newHeader = lines.find((line) => line.startsWith("+++ "));
    if (!oldHeader || !newHeader) {
      throw new IntegrationRejection(`Patch headers are incomplete: ${lines[0]}`);
    }
    if (oldHeader.includes('"') || newHeader.includes('"')) {
      throw new IntegrationRejection(`Quoted-ambiguous patch path: ${lines[0]}`);
    }
    const oldValue = oldHeader.slice(4).trim();
    const newValue = newHeader.slice(4).trim();
    const oldFile = oldValue.startsWith("a/baseline/")
      ? oldValue.slice("a/baseline/".length)
      : undefined;
    const newFile = newValue.startsWith("b/workspace/")
      ? newValue.slice("b/workspace/".length)
      : undefined;
    if (oldValue !== "/dev/null" && oldFile === undefined) {
      throw new IntegrationRejection(`Non-standard --- path: ${oldValue}`);
    }
    if (newValue !== "/dev/null" && newFile === undefined) {
      throw new IntegrationRejection(`Non-standard +++ path: ${newValue}`);
    }
    if (oldValue === "/dev/null" && newValue === "/dev/null") {
      throw new IntegrationRejection("Patch has no source or destination");
    }
    if (oldFile !== undefined && newFile !== undefined && oldFile !== newFile) {
      throw new IntegrationRejection(
        `Mismatched header paths (rename not supported): "${oldFile}" != "${newFile}"`,
      );
    }
    const file = oldFile ?? newFile!;
    const unsafe = detectUnsafePath(file);
    if (unsafe) throw new IntegrationRejection(unsafe);
    const expectedOld = `a/baseline/${file}`;
    const expectedNew = `b/workspace/${file}`;
    if (oldValue !== "/dev/null" && oldValue !== expectedOld) {
      throw new IntegrationRejection(`Mismatched --- path for "${file}": ${oldValue}`);
    }
    if (newValue !== "/dev/null" && newValue !== expectedNew) {
      throw new IntegrationRejection(`Mismatched +++ path for "${file}": ${newValue}`);
    }
    const expectedDiffOld = oldValue === "/dev/null"
      ? `workspace/${file}`
      : `baseline/${file}`;
    const expectedDiffNew = newValue === "/dev/null"
      ? `baseline/${file}`
      : `workspace/${file}`;
    if (diffHeader.oldPath !== expectedDiffOld || diffHeader.newPath !== expectedDiffNew) {
      throw new IntegrationRejection(
        `Diff header does not match patch paths for "${file}"`,
      );
    }
    files.add(file);
  }
  return [...files].sort();
}

// --- Unsupported patch detection ---

function detectUnsupportedPatch(diff: string): string | undefined {
  for (const line of diff.split("\n")) {
    if (line.startsWith("Binary files ")) return `Binary patch: ${line}`;
    if (line.startsWith("rename from ") || line.startsWith("rename to "))
      return `File rename: ${line}`;
    if (/\b120000\b/.test(line)) return `Symlink mode: ${line}`;
  }

  // Reject mode-only patches: sections with mode lines but no content hunks
  const sections = diff.split(/^diff --git /m).filter((s) => s.trim());
  for (const sec of sections) {
    const hasHunk = /^@@\s+-/m.test(sec);
    const hasMode = /^(?:new|old|deleted) (?:file )?mode\s+\d+/m.test(sec);
    if (hasMode && !hasHunk) return "Mode-only patch (no content hunk)";
  }

  return undefined;
}

function measurePatch(diff: string): {
  filesChanged: number;
  changedLines: number;
} {
  const lines = diff.split("\n");
  return {
    filesChanged: lines.filter((l) => l.startsWith("diff --git ")).length,
    changedLines: lines.filter(
      (l) =>
        (l.startsWith("+") && !l.startsWith("+++")) ||
        (l.startsWith("-") && !l.startsWith("---")),
    ).length,
  };
}

// --- Source manifest ---

async function readSourceManifest(task: TaskRecord): Promise<SourceManifest> {
  const raw = await readFile(
    path.join(task.paths.root, "source-manifest.json"),
    "utf8",
  );
  return JSON.parse(raw) as SourceManifest;
}

// --- Backup (fail closed) ---

function backupDirPath(taskRoot: string, receiptId: string): string {
  return path.join(taskRoot, "integration", receiptId, "backup");
}

async function backUpAffectedFiles(
  sourcePath: string,
  affectedFiles: string[],
  bkpDir: string,
): Promise<BackupRecord[]> {
  await mkdir(bkpDir, { recursive: true, mode: 0o700 });
  const records: BackupRecord[] = [];

  for (const file of affectedFiles) {
    const src = path.join(sourcePath, file);
    const dst = path.join(bkpDir, file);

    try {
      await lstat(src);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // File doesn't exist — it will be created by the patch.
        records.push({ file, existed: false, backupPath: "", digest: "" });
        continue;
      }
      throw new IntegrationRejection(
        `Cannot inspect source before backup for "${file}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // File exists — back it up; fail closed on any error
    try {
      const digest = await fileDigest(src);
      await mkdir(path.dirname(dst), { recursive: true, mode: 0o700 });
      await cp(src, dst);
      records.push({ file, existed: true, backupPath: dst, digest });
    } catch (err) {
      throw new IntegrationRejection(
        `Backup failed for "${file}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return records;
}

// --- Post-apply fingerprint ---

async function fingerprintFiles(
  sourcePath: string,
  files: string[],
): Promise<Record<string, string>> {
  const digests: Record<string, string> = {};
  for (const file of files) {
    try {
      digests[file] = await fileDigest(path.join(sourcePath, file));
    } catch {
      digests[file] = "absent";
    }
  }
  return digests;
}

// --- Concurrent-change detection ---

async function detectConcurrentChanges(
  sourcePath: string,
  postApplyDigests: Record<string, string>,
): Promise<string[]> {
  const changed: string[] = [];
  for (const [file, expected] of Object.entries(postApplyDigests)) {
    try {
      const current = await fileDigest(path.join(sourcePath, file));
      if (current !== expected) changed.push(file);
    } catch {
      if (expected !== "absent") changed.push(file);
    }
  }
  return changed;
}

// --- Receipt construction ---

function buildReceipt(
  taskId: string,
  diff: string,
  affectedFiles: string[],
  sourceEvidence: Record<string, string>,
  reasons: string[],
  ttlMs: number,
): IntegrationReceiptRecord {
  const now = new Date();
  return {
    id: randomUUID(),
    taskId,
    patchDigest: diff ? sha256(diff) : "",
    affectedFiles,
    rejectionReasons: reasons,
    sourceEvidence,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    consumed: false,
  };
}

// --- Rollback (distinguishes new vs existing files) ---

async function rollbackSource(
  sourcePath: string,
  backups: BackupRecord[],
): Promise<string[]> {
  const failures: string[] = [];
  for (const record of backups) {
    const target = path.join(sourcePath, record.file);
    try {
      if (!record.existed) {
        // File was created by the patch — just remove it
        await rm(target, { force: true });
      } else if (record.backupPath) {
        await cp(record.backupPath, target);
      } else {
        failures.push(`${record.file}: missing backup path`);
      }
    } catch (err) {
      failures.push(
        `${record.file}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return failures;
}

// --- Verification copy ---

async function copyForVerification(
  sourcePath: string,
  excludes: string[],
): Promise<string> {
  const tmpDir = path.join(
    tmpdir(),
    `fl-verify-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tmpDir, { recursive: true, mode: 0o700 });

  const excludeSet = new Set([".git", "node_modules", ...excludes]);
  const filter = (src: string): boolean => {
    const rel = path.relative(sourcePath, src);
    if (!rel || rel === ".") return true;
    return !rel.split(path.sep).some((part) => excludeSet.has(part));
  };

  await cp(sourcePath, tmpDir, { recursive: true, filter });

  const srcModules = path.join(sourcePath, "node_modules");
  try {
    const st = await lstat(srcModules);
    const dependencyPath = st.isSymbolicLink()
      ? await realpath(srcModules)
      : srcModules;
    if ((await lstat(dependencyPath)).isDirectory()) {
      await symlink(dependencyPath, path.join(tmpDir, "node_modules"), "dir");
    }
  } catch {
    // No node_modules in source — fine for simple projects
  }

  return tmpDir;
}

// --- Backup pruning ---

async function pruneBackups(
  taskRoot: string,
  retentionCount: number,
): Promise<void> {
  const integrationDir = path.join(taskRoot, "integration");
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readdir(integrationDir, { withFileTypes: true });
  } catch {
    return;
  }

  const dirsWithTime: Array<{ name: string; createdMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const entryPath = path.join(integrationDir, entry.name);
    try {
      const stats = await lstat(entryPath);
      dirsWithTime.push({ name: entry.name, createdMs: stats.birthtimeMs });
    } catch {
      // Skip entries we cannot stat
    }
  }

  dirsWithTime.sort((a, b) => a.createdMs - b.createdMs);

  const excess = dirsWithTime.slice(
    0,
    Math.max(0, dirsWithTime.length - retentionCount),
  );
  for (const d of excess) {
    await rm(path.join(integrationDir, d.name), {
      recursive: true,
      force: true,
    });
  }
}

// --- Public API ---

export async function preflightIntegration(
  store: StateStore,
  taskId: string,
  settings: IntegrationSettings,
): Promise<PreflightReceipt> {
  // Load canonical TaskRecord from store — caller cannot substitute sourcePath
  const task = store.getTask(taskId);
  const reasons: string[] = [];

  // 1. Task must be succeeded
  if (task.status !== "succeeded") {
    reasons.push(`Task status is "${task.status}", must be "succeeded"`);
  }
  const events = store.listEvents(taskId);
  const latestVerification = events
    .filter((event) => event.type === "verification.completed")
    .at(-1);
  const review = latestMainReview(events);
  if (
    review?.decision !== "accept"
    || latestVerification === undefined
    || review.verificationEventSequence !== latestVerification.sequence
  ) {
    reasons.push("Main Codex review acceptance is required");
  }

  // 2. Read diff
  let diff: string;
  try {
    diff = await readFile(task.paths.diff, "utf8");
  } catch {
    reasons.push("Diff file is missing or unreadable");
    const receipt = buildReceipt(
      task.id, "", [], {}, reasons, settings.reviewReceiptTtlMs,
    );
    store.saveIntegrationReceipt(receipt);
    storePreflightEvent(store, task.id, receipt);
    return stripConsumed(receipt);
  }

  // 3. Reject unsupported patch forms (binary, rename, symlink, mode-only)
  const unsupported = detectUnsupportedPatch(diff);
  if (unsupported) reasons.push(unsupported);

  // 4. Check configured patch limits
  const metrics = measurePatch(diff);
  if (metrics.filesChanged > settings.reviewedPatchMaxFiles) {
    reasons.push(
      `Patch changes ${metrics.filesChanged} files ` +
      `(limit: ${settings.reviewedPatchMaxFiles})`,
    );
  }
  if (metrics.changedLines > settings.reviewedPatchMaxLines) {
    reasons.push(
      `Patch changes ${metrics.changedLines} lines ` +
      `(limit: ${settings.reviewedPatchMaxLines})`,
    );
  }

  // 5. Parse and strictly validate affected file paths
  let affectedFiles: string[] = [];
  try {
    affectedFiles = parseAffectedFiles(diff);
  } catch (err) {
    reasons.push(
      err instanceof IntegrationRejection
        ? err.message
        : `Header parse error: ${String(err)}`,
    );
  }

  if (affectedFiles.length === 0 && reasons.length === 0) {
    reasons.push("Patch does not list any affected files");
  }
  for (const file of affectedFiles) {
    const pathReason = await validateSourcePath(task.sourcePath, file);
    if (pathReason) reasons.push(pathReason);
  }

  // 6. Real dry-run applicability check
  if (reasons.length === 0) {
    const checkResult = await runCaptured(
      "git",
      ["apply", "--check", "-p2", task.paths.diff],
      { cwd: task.sourcePath },
    );
    if (checkResult.exitCode !== 0) {
      reasons.push(
        `Patch does not apply cleanly: ${
          checkResult.stderr || checkResult.stdout
        }`,
      );
    }
  }

  // 7. Verify affected source files match baseline
  const sourceEvidence: Record<string, string> = {};
  if (reasons.length === 0) {
    const manifest = await readSourceManifest(task);
    const baselineByPath = new Map(
      manifest.files.map((f) => [f.path, f.sha256]),
    );

    for (const file of affectedFiles) {
      const absPath = path.join(task.sourcePath, file);
      const baselineSha = baselineByPath.get(file);

      try {
        const currentDigest = await fileDigest(absPath);
        sourceEvidence[file] = currentDigest;

        if (baselineSha !== undefined) {
          if (currentDigest !== baselineSha) {
            reasons.push(
              `Affected source file changed since baseline: ${file}`,
            );
          }
        } else {
          reasons.push(
            `File "${file}" exists in source but was not in the task baseline`,
          );
        }
      } catch {
        sourceEvidence[file] = "absent";
        if (baselineSha !== undefined) {
          reasons.push(`Affected source file is missing: ${file}`);
        }
      }
    }
  }

  const receipt = buildReceipt(
    task.id, diff, affectedFiles, sourceEvidence, reasons,
    settings.reviewReceiptTtlMs,
  );
  store.saveIntegrationReceipt(receipt);
  storePreflightEvent(store, task.id, receipt);
  return stripConsumed(receipt);
}

function stripConsumed(
  record: IntegrationReceiptRecord,
): PreflightReceipt {
  const { consumed: _, ...rest } = record;
  return rest;
}

function storePreflightEvent(
  store: StateStore,
  taskId: string,
  receipt: IntegrationReceiptRecord,
): void {
  store.addEvent(
    taskId,
    undefined,
    "integration.preflight.completed",
    receipt.rejectionReasons.length === 0
      ? "Integration preflight passed"
      : `Integration preflight rejected: ${receipt.rejectionReasons.join("; ")}`,
    {
      receiptId: receipt.id,
      passed: receipt.rejectionReasons.length === 0,
      rejectionReasons: receipt.rejectionReasons,
      affectedFiles: receipt.affectedFiles,
    },
  );
}

// --- Apply ---

export async function applyIntegration(
  store: StateStore,
  taskId: string,
  receiptId: string,
  settings: IntegrationSettings,
  operationId: string = randomUUID(),
): Promise<IntegrationExecutionResult> {
  // 1. Load canonical TaskRecord from store — caller cannot substitute sourcePath
  const task = store.getTask(taskId);
  const stages: IntegrationStageEvidence[] = [];

  // 2. Load canonical receipt from store
  const stored = store.getIntegrationReceipt(receiptId);
  if (!stored) {
    return persistRejection(
      store, operationId, receiptId, task.id, "Receipt not found in store",
    );
  }

  const { consumed, ...receipt } = stored;

  if (receipt.taskId !== task.id) {
    return persistRejection(
      store,
      operationId,
      receiptId,
      receipt.taskId,
      `Receipt belongs to task "${receipt.taskId}", not requested task "${task.id}"`,
    );
  }
  if (new Date(receipt.expiresAt) <= new Date()) {
    return persistRejection(store, operationId, receiptId, task.id, "Receipt has expired");
  }
  if (consumed) {
    return persistRejection(
      store, operationId, receiptId, task.id, "Receipt has already been consumed",
    );
  }
  if (receipt.rejectionReasons.length > 0) {
    return persistRejection(
      store, operationId, receiptId, task.id,
      `Preflight did not pass: ${receipt.rejectionReasons.join("; ")}`,
    );
  }

  // 3. Re-verify patch digest before mutation
  let diff: string;
  try {
    diff = await readFile(task.paths.diff, "utf8");
  } catch {
    return persistRejection(store, operationId, receiptId, task.id, "Diff file is missing");
  }

  if (sha256(diff) !== receipt.patchDigest) {
    return persistRejection(
      store, operationId, receiptId, task.id, "Patch digest changed since preflight",
    );
  }

  let reparsedFiles: string[];
  try {
    const unsupported = detectUnsupportedPatch(diff);
    if (unsupported) throw new IntegrationRejection(unsupported);
    reparsedFiles = parseAffectedFiles(diff);
  } catch (error) {
    return persistRejection(
      store,
      operationId,
      receiptId,
      task.id,
      error instanceof Error ? error.message : String(error),
    );
  }
  if (JSON.stringify(reparsedFiles) !== JSON.stringify(receipt.affectedFiles)) {
    return persistRejection(
      store, operationId, receiptId, task.id, "Affected file set changed since preflight",
    );
  }
  for (const file of reparsedFiles) {
    const pathReason = await validateSourcePath(task.sourcePath, file);
    if (pathReason) {
      return persistRejection(store, operationId, receiptId, task.id, pathReason);
    }
  }

  // 4. Re-verify affected source files match receipt evidence
  for (const [file, expectedDigest] of Object.entries(
    receipt.sourceEvidence,
  )) {
    const unsafe = detectUnsafePath(file);
    if (unsafe) {
      return persistRejection(store, operationId, receiptId, task.id, unsafe);
    }

    const absPath = path.join(task.sourcePath, file);
    try {
      const actual = await fileDigest(absPath);
      if (expectedDigest !== "absent" && actual !== expectedDigest) {
        return persistRejection(
          store, operationId, receiptId, task.id,
          `Source file changed since preflight: ${file}`,
        );
      }
    } catch {
      if (expectedDigest !== "absent") {
        return persistRejection(
          store, operationId, receiptId, task.id,
          `Cannot read source file for apply: ${file}`,
        );
      }
    }
  }

  const finalCheck = await runCaptured(
    "git",
    ["apply", "--check", "-p2", task.paths.diff],
    { cwd: task.sourcePath },
  );
  if (finalCheck.exitCode !== 0) {
    return persistRejection(
      store,
      operationId,
      receiptId,
      task.id,
      `Patch no longer applies cleanly: ${finalCheck.stderr || finalCheck.stdout}`,
    );
  }

  // 5. Atomically mark receipt consumed — must happen before mutation
  try {
    store.consumeIntegrationReceipt(receiptId);
  } catch (err) {
    return persistRejection(
      store, operationId, receiptId, task.id,
      err instanceof Error ? err.message : String(err),
    );
  }

  // 6. Back up affected source files (fails closed)
  const bkpDir = backupDirPath(task.paths.root, receiptId);
  let backups: BackupRecord[];
  try {
    backups = await backUpAffectedFiles(
      task.sourcePath,
      receipt.affectedFiles,
      bkpDir,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const record = buildResultRecord(
      operationId, receiptId, task.id, "rejected", bkpDir, undefined,
      `Backup failed: ${msg}`,
    );
    store.saveIntegrationResult(record);
    store.addEvent(
      task.id, undefined, "integration.apply.started",
      "Integration rejected: backup failure", record,
    );
    return stripResultMeta(record);
  }

  for (const backup of backups) {
    const expected = receipt.sourceEvidence[backup.file];
    const actual = backup.existed ? backup.digest : "absent";
    if (expected !== actual) {
      const record = buildResultRecord(
        operationId,
        receiptId,
        task.id,
        "rejected",
        bkpDir,
        undefined,
        `Affected source changed while backup was created: ${backup.file}`,
      );
      store.saveIntegrationResult(record);
      return stripResultMeta(record);
    }
  }

  // 7. Apply the patch
  store.addEvent(
    task.id, undefined, "integration.apply.started",
    "Applying reviewed patch to source",
    { receiptId, affectedFiles: receipt.affectedFiles },
  );

  let applyResult;
  try {
    applyResult = await runCaptured(
      "git",
      ["apply", "-p2", task.paths.diff],
      { cwd: task.sourcePath },
    );
  } catch (err) {
    const rollbackFailures = await rollbackSource(task.sourcePath, backups);
    const detail = `Patch application could not start: ${
      err instanceof Error ? err.message : String(err)
    }`;
    const error = rollbackFailures.length > 0
      ? `${detail}; rollback failures: ${rollbackFailures.join(", ")}`
      : detail;
    const status: IntegrationStatus = rollbackFailures.length > 0
      ? "retained-failure"
      : "rolled-back";
    const record = buildResultRecord(
      operationId, receiptId, task.id, status, bkpDir, undefined, error,
    );
    if (rollbackFailures.length > 0) record.rollbackFailures = rollbackFailures;
    store.saveIntegrationResult(record);
    store.addEvent(
      task.id, undefined, "integration.rollback.completed",
      "Integration handled after patch process failure", record,
    );
    return stripResultMeta(record);
  }

  if (applyResult.exitCode !== 0) {
    recordStage(
      store,
      task.id,
      operationId,
      receiptId,
      stages,
      {
        stage: "source-applied",
        status: "failed",
        commands: [{
          command: `git apply -p2 ${task.paths.diff}`,
          exitCode: applyResult.exitCode,
          stdout: applyResult.stdout,
          stderr: applyResult.stderr,
          durationMs: applyResult.durationMs,
          timedOut: applyResult.timedOut,
        }],
        error: applyResult.stderr || applyResult.stdout || "Patch application failed",
      },
    );
    const rollbackFailures = await rollbackSource(
      task.sourcePath,
      backups,
    );
    const errorDetail =
      `Patch application failed (exit ${applyResult.exitCode}): ${
        applyResult.stderr || applyResult.stdout
      }`;
    const fullError =
      rollbackFailures.length > 0
        ? `${errorDetail}; rollback failures: ${rollbackFailures.join(", ")}`
        : errorDetail;

    const status: IntegrationStatus = rollbackFailures.length > 0 ? "retained-failure" : "rolled-back";
    const record = buildResultRecord(
      operationId,
      receiptId,
      task.id,
      status,
      bkpDir,
      undefined,
      fullError,
      undefined,
      stages,
    );
    if (rollbackFailures.length > 0) record.rollbackFailures = rollbackFailures;
    store.saveIntegrationResult(record);
    store.addEvent(
      task.id, undefined, "integration.rollback.completed",
      "Integration rolled back after apply failure", record,
    );
    return stripResultMeta(record);
  }

  // 8. Fingerprint applied paths before verification (for concurrent-change detection)
  const postApplyDigests = await fingerprintFiles(
    task.sourcePath,
    receipt.affectedFiles,
  );
  recordStage(
    store,
    task.id,
    operationId,
    receiptId,
    stages,
    {
      stage: "source-applied",
      status: "passed",
      commands: [{
        command: `git apply -p2 ${task.paths.diff}`,
        exitCode: applyResult.exitCode,
        stdout: applyResult.stdout,
        stderr: applyResult.stderr,
        durationMs: applyResult.durationMs,
        timedOut: applyResult.timedOut,
      }],
    },
  );

  // 9. Copy patched source to isolated temp dir and verify there.  Any
  // infrastructure failure is a verification failure, not an uncaught state
  // that can leave the source mutated without durable evidence.
  let verifyDir: string | undefined;
  const verificationCommands: VerificationCommandResult[] = [];
  let verificationPassed = true;
  let verificationError: string | undefined;

  try {
    verifyDir = await copyForVerification(
      task.sourcePath,
      task.spec.workspace.exclude,
    );
    const verificationEnvironment = await verifierProcessEnvironment(task, verifyDir);
    for (const command of task.spec.acceptance.commands) {
      const result = await runCaptured(
        "/bin/zsh",
        ["-lc", command],
        {
          cwd: verifyDir,
          env: verificationEnvironment,
          timeoutMs: settings.verificationTimeoutMs,
        },
      );
      const cmdResult: VerificationCommandResult = {
        command,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
      };
      verificationCommands.push(cmdResult);

      if (result.exitCode !== 0) verificationPassed = false;
    }
  } catch (err) {
    verificationPassed = false;
    verificationError = `Verification infrastructure failed: ${
      err instanceof Error ? err.message : String(err)
    }`;
  } finally {
    if (verifyDir !== undefined) {
      await rm(verifyDir, { recursive: true, force: true });
    }
  }

  // 10. Check for concurrent source changes before accepting success or
  // attempting rollback.  Verification runs against the isolated copy, so a
  // passing command does not prove the live affected files remained unchanged.
  const concurrentChanged = await detectConcurrentChanges(
    task.sourcePath,
    postApplyDigests,
  );

  const sourceVerificationEvidence: IntegrationStageEvidence = {
    stage: "source-verified",
    status: verificationPassed && concurrentChanged.length === 0 ? "passed" : "failed",
    ...(verificationCommands.length === 0 ? {} : { commands: verificationCommands }),
    ...(verificationError === undefined && concurrentChanged.length === 0
      ? {}
      : {
          error: verificationError
            ?? `Concurrent file edits detected: ${concurrentChanged.join(", ")}`,
        }),
  };
  recordStage(
    store,
    task.id,
    operationId,
    receiptId,
    stages,
    sourceVerificationEvidence,
  );

  if (concurrentChanged.length > 0) {
    const verificationSummary = verificationPassed
      ? "Source verification passed"
      : (verificationError ?? "Source verification failed");
    const record = buildResultRecord(
      operationId,
      receiptId, task.id, "retained-failure", bkpDir,
      verificationCommands.length > 0 ? verificationCommands : undefined,
      `${verificationSummary}; concurrent file edits detected ` +
      `during verification: ${concurrentChanged.join(", ")}. ` +
      `Changes retained per safety policy.`,
      undefined,
      stages,
    );
    record.postApplyDigests = postApplyDigests;
    store.saveIntegrationResult(record);
    store.addEvent(
      task.id, undefined, "integration.apply.completed",
      "Integration applied but verification failed with concurrent edits (retained)",
      record,
    );
    return stripResultMeta(record);
  }

  if (verificationPassed) {
    const buildCommands = task.spec.delivery?.buildCommands ?? [];
    if (buildCommands.length === 0) {
      recordStage(
        store,
        task.id,
        operationId,
        receiptId,
        stages,
        { stage: "artifact-built", status: "not-applicable" },
      );
    } else {
      const buildResults = await runCommandList(
        buildCommands,
        task.sourcePath,
        settings.verificationTimeoutMs,
      );
      const buildPassed = buildResults.every((result) => result.exitCode === 0);
      recordStage(
        store,
        task.id,
        operationId,
        receiptId,
        stages,
        {
          stage: "artifact-built",
          status: buildPassed ? "passed" : "failed",
          commands: buildResults,
          ...(buildPassed ? {} : { error: "Artifact build failed; source changes retained" }),
        },
      );
      if (!buildPassed) {
        const record = buildResultRecord(
          operationId,
          receiptId,
          task.id,
          "retained-failure",
          bkpDir,
          verificationCommands.length > 0 ? verificationCommands : undefined,
          "Artifact build failed; source changes retained",
          undefined,
          stages,
        );
        record.postApplyDigests = postApplyDigests;
        store.saveIntegrationResult(record);
        store.addEvent(
          task.id,
          undefined,
          "integration.apply.completed",
          "Integration source verified but artifact build failed (retained)",
          record,
        );
        return stripResultMeta(record);
      }
    }

    const activationDeclared =
      (task.spec.delivery?.activationCommands.length ?? 0) > 0
      || (task.spec.delivery?.activationCheckCommands.length ?? 0) > 0;
    if (activationDeclared) {
      return {
        status: "activation-pending",
        receiptId,
        taskId: task.id,
        handoff: {
          version: 1,
          operationId,
          taskId: task.id,
          receiptId,
          sourcePath: task.sourcePath,
          timeoutMs: settings.verificationTimeoutMs,
          activationCommands: task.spec.delivery?.activationCommands ?? [],
          activationCheckCommands: task.spec.delivery?.activationCheckCommands ?? [],
        },
      };
    } else {
      recordStage(
        store,
        task.id,
        operationId,
        receiptId,
        stages,
        { stage: "runtime-activated", status: "not-applicable" },
      );
    }
    await pruneBackups(task.paths.root, settings.backupRetentionCount);

    const record = buildResultRecord(
      operationId,
      receiptId, task.id, "applied", bkpDir,
      verificationCommands.length > 0 ? verificationCommands : undefined,
      undefined,
      new Date().toISOString(),
      stages,
    );
    record.postApplyDigests = postApplyDigests;
    store.saveIntegrationResult(record);
    store.addEvent(
      task.id, undefined, "integration.apply.completed",
      "Integration applied successfully", record,
    );
    return stripResultMeta(record);
  }

  const failureReason = verificationError ?? "Source verification failed";

  if (settings.autoRollback) {
    const rollbackFailures = await rollbackSource(
      task.sourcePath,
      backups,
    );

    const error =
      rollbackFailures.length > 0
        ? `${failureReason}; rollback incomplete: ` +
          `${rollbackFailures.join(", ")}`
        : `${failureReason}; patch rolled back`;

    const status: IntegrationStatus = rollbackFailures.length > 0
      ? "retained-failure"
      : "rolled-back";
    if (status === "rolled-back") {
      await pruneBackups(task.paths.root, settings.backupRetentionCount);
    }

    const record = buildResultRecord(
      operationId,
      receiptId, task.id, status, bkpDir,
      verificationCommands.length > 0 ? verificationCommands : undefined,
      error,
      undefined,
      stages,
    );
    record.postApplyDigests = postApplyDigests;
    if (rollbackFailures.length > 0) record.rollbackFailures = rollbackFailures;
    store.saveIntegrationResult(record);
    store.addEvent(
      task.id, undefined, "integration.rollback.completed",
      "Integration rolled back after verification failure", record,
    );
    return stripResultMeta(record);
  }

  // autoRollback disabled — retain failed state
  const record = buildResultRecord(
    operationId,
    receiptId, task.id, "retained-failure", bkpDir,
    verificationCommands.length > 0 ? verificationCommands : undefined,
    `${failureReason}; changes retained per settings`,
    undefined,
    stages,
  );
  record.postApplyDigests = postApplyDigests;
  store.saveIntegrationResult(record);
  store.addEvent(
    task.id, undefined, "integration.apply.completed",
    "Integration applied but verification failed (retained)", record,
  );
  return stripResultMeta(record);
}

// --- Result construction ---

function persistRejection(
  store: StateStore,
  operationId: string,
  receiptId: string,
  taskId: string,
  error: string,
): IntegrationResult {
  // Persist durable rejection when a canonical stored receipt exists
  const stored = store.getIntegrationReceipt(receiptId);
  if (stored) {
    const canonicalTaskId = stored.taskId;
    const record: IntegrationResultRecord = {
      id: operationId,
      receiptId,
      taskId: canonicalTaskId,
      status: "rejected",
      error,
      createdAt: new Date().toISOString(),
    };
    store.saveIntegrationResult(record);
    store.addEvent(
      canonicalTaskId, undefined, "integration.apply.completed",
      `Integration rejected: ${error}`, record,
    );
    return stripResultMeta(record);
  }
  return { status: "rejected", receiptId, taskId, error };
}

function buildResultRecord(
  operationId: string,
  receiptId: string,
  taskId: string,
  status: IntegrationStatus,
  backupDir: string,
  verificationCommands: VerificationCommandResult[] | undefined,
  error: string | undefined,
  appliedAt?: string,
  stages?: IntegrationStageEvidence[],
): IntegrationResultRecord {
  return {
    id: operationId,
    receiptId,
    taskId,
    status,
    backupDir,
    ...(verificationCommands === undefined
      ? {}
      : { verificationCommands }),
    ...(error === undefined ? {} : { error }),
    ...(appliedAt === undefined ? {} : { appliedAt }),
    ...(stages === undefined ? {} : { stages }),
    createdAt: new Date().toISOString(),
  };
}

function stripResultMeta(
  record: IntegrationResultRecord,
): IntegrationResult {
  const { id: _, createdAt: __, ...rest } = record;
  return rest;
}
