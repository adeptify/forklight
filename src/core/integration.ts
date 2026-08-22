import { randomUUID } from "node:crypto";
import { sha256 } from "./digest.js";
import { cp, lstat, mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { IntegrationSettings } from "./settings.js";
import type { StateStore } from "../state/store.js";
import type {
  DeliveryPlanView,
  IntegrationApplicabilityIssue,
  IntegrationPathEvidenceEntry,
  IntegrationReceiptRecord,
  IntegrationRecoveryGuidance,
  IntegrationResultRecord,
  IntegrationStageEvidence,
  PathCategory,
  PathProvenance,
  ActivationHandoff,
  TaskRecord,
  VerificationCommandResult,
} from "./types.js";
import { buildDeliveryPlanView } from "./delivery-profiles.js";
import { runCaptured } from "./process.js";
import { verifierProcessEnvironment } from "../workspace/verifier-git.js";
import { createPathPolicy, PATH_CATEGORIES, PATH_PROVENANCES } from "../workspace/path-policy.js";
import { latestMainReview } from "./main-review.js";
import { copyForVerification } from "./integration-verification-copy.js";
import {
  isReviewerTask,
  REVIEWER_TASK_NOT_INTEGRATABLE,
  reviewGraphIntegrationReasons,
} from "./review-graph.js";

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

/** Validate stored path-classification evidence against the authoritative
 *  affectedFiles list. Returns undefined when the evidence is absent (legacy
 *  receipt or no affected path) or consistent; otherwise returns a fixed,
 *  privacy-safe message so apply fails closed without echoing paths, Diff
 *  content, or diagnostics. The evidence is never recomputed here - apply
 *  consumes the exact stored list rather than silently deriving a different one.
 */
function validatePathEvidence(
  evidence: unknown,
  affectedFiles: string[],
): string | undefined {
  if (evidence === undefined) return undefined; // legacy receipt or no affected path
  if (!Array.isArray(evidence)) {
    return "Integration path evidence is malformed";
  }
  if (evidence.length !== affectedFiles.length) {
    return "Integration path evidence cardinality mismatch";
  }
  for (let i = 0; i < evidence.length; i += 1) {
    const entry = evidence[i];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return "Integration path evidence entry is malformed";
    }
    const record = entry as Record<string, unknown>;
    const keys = Object.keys(record);
    if (
      keys.length !== 3
      || typeof record.path !== "string"
      || typeof record.category !== "string"
      || typeof record.provenance !== "string"
    ) {
      return "Integration path evidence entry has unexpected shape";
    }
    if (record.path !== affectedFiles[i]) {
      return "Integration path evidence path mismatch";
    }
    if (!PATH_CATEGORIES.has(record.category as PathCategory)) {
      return "Integration path evidence category is malformed";
    }
    if (!PATH_PROVENANCES.has(record.provenance as PathProvenance)) {
      return "Integration path evidence provenance is malformed";
    }
  }
  return undefined;
}

function buildReceipt(
  taskId: string,
  diff: string,
  affectedFiles: string[],
  sourceEvidence: Record<string, string>,
  reasons: string[],
  ttlMs: number,
  deliveryPlan?: DeliveryPlanView,
  pathEvidence?: IntegrationPathEvidenceEntry[],
  recoveryGuidance?: IntegrationRecoveryGuidance,
  applicabilityIssue?: IntegrationApplicabilityIssue,
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
    ...(deliveryPlan === undefined ? {} : { deliveryPlan }),
    ...(pathEvidence === undefined ? {} : { pathEvidence }),
    ...(recoveryGuidance === undefined ? {} : { recoveryGuidance }),
    ...(applicabilityIssue === undefined ? {} : { applicabilityIssue }),
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

  // Compute immutable delivery plan from the Task snapshot (before any I/O).
  const deliveryPlan = buildDeliveryPlanView(
    task.spec.delivery,
    task.spec.deliveryResolution,
  );

  // Reviewer Tasks are permanently non-integratable evidence, not product code.
  if (isReviewerTask(store, taskId)) {
    reasons.push(REVIEWER_TASK_NOT_INTEGRATABLE);
    const receipt = buildReceipt(
      task.id, "", [], {}, reasons, settings.reviewReceiptTtlMs, deliveryPlan,
    );
    store.saveIntegrationReceipt(receipt);
    storePreflightEvent(store, task.id, receipt);
    return stripConsumed(receipt);
  }

  // Explicit pending/running judge review, or terminal review without a fresher
  // Main decision, blocks Candidate Integration. Judge disposition never decides.
  for (const reason of reviewGraphIntegrationReasons(store, taskId)) {
    reasons.push(reason);
  }

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
    reasons.push("Main agent review acceptance is required");
  }

  // When the Main accept is bound to a CandidateRevision digest, verify the
  // live Diff bytes match before creating a passing receipt. A changed patch
  // after Main accept is rejected even before the existing dry-run and source
  // checks.
  if (review?.decision === "accept" && review.acceptedPatchDigest !== undefined) {
    let currentDiff: string;
    try {
      currentDiff = await readFile(task.paths.diff, "utf8");
    } catch {
      reasons.push("Diff file is missing or unreadable");
    }
    if (reasons.length === 0) {
      const currentDigest = sha256(currentDiff!);
      if (currentDigest !== review.acceptedPatchDigest) {
        reasons.push(
          "Accepted candidate revision patch digest does not match the current diff; " +
          "the patch has changed since Main acceptance",
        );
      }
    }
  }

  // Competition candidate delivery gate: a Competition candidate becomes
  // integrable only after a Competition-level Main accept of the exact
  // Candidate Revision. Task-level Main accept or machine ranking alone cannot
  // pass preflight for a Competition candidate. The Competition decision must
  // match the candidate Task, Attempt, verification sequence, revision id, and
  // patch digest exactly (so a stale decision cannot authorize a newer patch).
  const competitionId = store.getCompetitionByCandidateTaskId(taskId);
  if (competitionId !== undefined) {
    const competitionDecision = store.getCompetition(competitionId).mainDecision;
    const candidate = store
      .getCompetitionCandidates(competitionId)
      .find((c) => c.taskId === taskId);
    const exactCompetitionAccept =
      competitionDecision !== undefined
      && competitionDecision.decision === "accept"
      && competitionDecision.taskId === taskId
      && candidate !== undefined
      && competitionDecision.candidateId === candidate.id
      && review !== undefined
      && competitionDecision.attemptId === review.attemptId
      && competitionDecision.verificationEventSequence === review.verificationEventSequence
      && competitionDecision.candidateRevisionId === review.candidateRevisionId
      && competitionDecision.acceptedPatchDigest === review.acceptedPatchDigest;
    if (!exactCompetitionAccept) {
      reasons.push(
        "Competition Main accept of this exact Candidate Revision is required before Integration",
      );
    }
  }

  // 2. Read diff
  let diff: string;
  try {
    diff = await readFile(task.paths.diff, "utf8");
  } catch {
    reasons.push("Diff file is missing or unreadable");
    const receipt = buildReceipt(
      task.id, "", [], {}, reasons, settings.reviewReceiptTtlMs, deliveryPlan,
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

  // Build ordered one-to-one path-classification evidence for the exact
  // affected Integration paths. The immutable Task PathPolicy explains each
  // validated relative path without recomputing or mutating the decision; the
  // evidence never carries absolute paths, Diff content, commands, credentials,
  // or diagnostics. affectedFiles stays authoritative - evidence is one-to-one
  // and in the same order, so it cannot silently derive a different list.
  const pathPolicy = createPathPolicy(task.spec);
  const pathEvidence: IntegrationPathEvidenceEntry[] | undefined =
    affectedFiles.length === 0
      ? undefined
      : affectedFiles.map((file) => ({ path: file, ...pathPolicy.explain(file) }));

  // 6. Real dry-run applicability check
  let applicabilityIssue: IntegrationApplicabilityIssue | undefined;
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
      // Record one closed privacy-safe issue naming only the known failure
      // stage. The raw git diagnostic stays in rejectionReasons for audit; the
      // issue itself carries no parsed conflict, path, command, diff, or log,
      // and never guesses the underlying git conflict.
      applicabilityIssue = { code: "patch-not-applicable" };
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

  // Advisory recovery guidance: emitted only when a reviewed-patch file or
  // line limit rejected Preflight (typed local conditions, never parsed from
  // the human rejection strings) AND at least one affected path is default
  // business under the current Task policy. The guidance is advisory only - it
  // never alters rejectionReasons, the immutable Task, PathPolicy, Candidate,
  // or retry state, and it never tells Main to raise limits blindly.
  let recoveryGuidance: IntegrationRecoveryGuidance | undefined;
  const sizeGateTriggered =
    metrics.filesChanged > settings.reviewedPatchMaxFiles
    || metrics.changedLines > settings.reviewedPatchMaxLines;
  if (sizeGateTriggered && pathEvidence !== undefined) {
    const defaultBusinessPathCount = pathEvidence.filter(
      (entry) => entry.provenance === "default-business",
    ).length;
    if (defaultBusinessPathCount > 0) {
      recoveryGuidance = {
        code: "review-generated-or-exclusion-policy-vs-source-scope",
        defaultBusinessPathCount,
        filesChanged: metrics.filesChanged,
        changedLines: metrics.changedLines,
        reviewedPatchMaxFiles: settings.reviewedPatchMaxFiles,
        reviewedPatchMaxLines: settings.reviewedPatchMaxLines,
      };
    }
  }

  const receipt = buildReceipt(
    task.id, diff, affectedFiles, sourceEvidence, reasons,
    settings.reviewReceiptTtlMs, deliveryPlan, pathEvidence, recoveryGuidance,
    applicabilityIssue,
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
  // The durable summary must never carry raw git stdout/stderr. For the
  // patch-not-applicable case it is a fixed closed marker; raw rejection
  // reasons remain only in the payload/receipt for audit. Hub localizes the
  // marker via the payload applicabilityIssue, not this summary string.
  const passed = receipt.rejectionReasons.length === 0;
  const summary = passed
    ? "Integration preflight passed"
    : receipt.applicabilityIssue !== undefined
      ? "Integration preflight rejected: patch-not-applicable"
      : `Integration preflight rejected: ${receipt.rejectionReasons.join("; ")}`;
  store.addEvent(
    taskId,
    undefined,
    "integration.preflight.completed",
    summary,
    {
      receiptId: receipt.id,
      passed,
      rejectionReasons: receipt.rejectionReasons,
      affectedFiles: receipt.affectedFiles,
      ...(receipt.deliveryPlan === undefined ? {} : { deliveryPlan: receipt.deliveryPlan }),
      ...(receipt.pathEvidence === undefined ? {} : { pathEvidence: receipt.pathEvidence }),
      ...(receipt.recoveryGuidance === undefined ? {} : { recoveryGuidance: receipt.recoveryGuidance }),
      ...(receipt.applicabilityIssue === undefined ? {} : { applicabilityIssue: receipt.applicabilityIssue }),
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
  // Validate the stored path-classification evidence against the authoritative
  // affectedFiles. Legacy receipts (evidence absent) remain readable; a new
  // receipt with duplicate, reordered, missing, absolute, malformed, or
  // mismatched evidence fails closed before any source mutation, without
  // echoing paths, Diff content, or diagnostics.
  const evidenceError = validatePathEvidence(receipt.pathEvidence, receipt.affectedFiles);
  if (evidenceError) {
    return persistRejection(store, operationId, receiptId, task.id, evidenceError);
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

  // 9. Copy patched source to an isolated temp container (project cwd + any
  // declared sibling package mirrors) and verify there. Any infrastructure
  // failure is a verification failure, not an uncaught state that can leave
  // the source mutated without durable evidence. Always delete the full
  // owned cleanup root so sibling mirrors are never leaked beside /tmp.
  let verifyEnv: Awaited<ReturnType<typeof copyForVerification>> | undefined;
  const verificationCommands: VerificationCommandResult[] = [];
  let verificationPassed = true;
  let verificationError: string | undefined;

  try {
    verifyEnv = await copyForVerification(
      task.sourcePath,
      task.spec.workspace.exclude,
    );
    const { env: verificationEnvironment, shellGitPrefix } = await verifierProcessEnvironment(
      task,
      verifyEnv.projectCwd,
    );
    for (const command of task.spec.acceptance.commands) {
      const result = await runCaptured(
        "/bin/zsh",
        ["-lc", shellGitPrefix + command],
        {
          cwd: verifyEnv.projectCwd,
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
    if (verifyEnv !== undefined) {
      await rm(verifyEnv.cleanupRoot, { recursive: true, force: true });
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

// --- Source-only recovery continuation ---

/** Fixed, privacy-safe refusal codes for source-only Integration recovery.
 *  Each is a closed marker that never carries paths, digests, diff content,
 *  command text, or diagnostics. */
export const SOURCE_ONLY_RECOVERY_REFUSALS = {
  resultAlreadyExists: "result-already-exists",
  receiptMissing: "receipt-missing",
  receiptTaskMismatch: "receipt-task-mismatch",
  receiptRejected: "receipt-rejected",
  receiptNotConsumed: "receipt-not-consumed",
  sourceAppliedNotProven: "source-applied-not-proven",
  stageHistoryAmbiguous: "stage-history-ambiguous",
  deliveryDeclaresBuildOrActivation: "delivery-declares-build-or-activation",
  affectedFilesEmpty: "affected-files-empty",
  sourceEvidenceIncomplete: "source-evidence-incomplete",
  unsafePath: "unsafe-path",
  candidateFinalMismatch: "candidate-final-source-mismatch",
  backupMismatch: "backup-mismatch",
  unreadableProofPath: "unreadable-proof-path",
  executionFailed: "recovery-execution-failed",
} as const;

export type SourceOnlyRecoveryRefusalReason =
  (typeof SOURCE_ONLY_RECOVERY_REFUSALS)[keyof typeof SOURCE_ONLY_RECOVERY_REFUSALS];

type SourceOnlyRecoveryEligibility =
  | {
      eligible: true;
      task: TaskRecord;
      receipt: IntegrationReceiptRecord;
      stages: IntegrationStageEvidence[];
    }
  | { eligible: false; reason: SourceOnlyRecoveryRefusalReason };

type SourceOnlyRecoveryOutcome =
  | IntegrationResult
  | { status: "outcome-unknown"; reason: SourceOnlyRecoveryRefusalReason };

/** True exactly for one clean durable `source-applied: passed` evidence item. */
function isSourceAppliedPassed(value: unknown): value is IntegrationStageEvidence {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<IntegrationStageEvidence>;
  return candidate.stage === "source-applied" && candidate.status === "passed";
}

/** One durable stage event keyed by operation identity plus its receipt binding. */
interface DurableStageEvent {
  receiptId: unknown;
  evidence: unknown;
}

/** Collect every durable stage event for one operation. Malformed, missing, or
 *  receipt-mismatched entries are kept so an unprovable history fails closed
 *  instead of being silently rewritten into a clean single-stage history. */
function stageEventsForOperation(
  store: StateStore,
  taskId: string,
  operationId: string,
): DurableStageEvent[] {
  const events: DurableStageEvent[] = [];
  for (const event of store.listEvents(taskId)) {
    if (event.type !== "integration.stage.completed") continue;
    if (event.payload === null || typeof event.payload !== "object") continue;
    const payload = event.payload as {
      operationId?: unknown;
      receiptId?: unknown;
      evidence?: unknown;
    };
    if (payload.operationId !== operationId) continue;
    events.push({ receiptId: payload.receiptId, evidence: payload.evidence });
  }
  return events;
}

/**
 * Classify one incomplete Integration operation for safe source-only recovery
 * using durable evidence only (no live file reads). Eligible exactly when the
 * original receipt is consumed without rejection, the canonical Task declares
 * no build or activation work, the durable stage history is exactly one passed
 * `source-applied` item, and the receipt's affected set and pre-apply evidence
 * are complete. Never mutates the Store or source.
 */
export function classifySourceOnlyRecovery(
  store: StateStore,
  taskId: string,
  receiptId: string,
  operationId: string,
): SourceOnlyRecoveryEligibility {
  if (store.getIntegrationResult(operationId) !== undefined) {
    return { eligible: false, reason: SOURCE_ONLY_RECOVERY_REFUSALS.resultAlreadyExists };
  }
  const task = store.getTask(taskId);
  const stored = store.getIntegrationReceipt(receiptId);
  if (stored === undefined) {
    return { eligible: false, reason: SOURCE_ONLY_RECOVERY_REFUSALS.receiptMissing };
  }
  if (stored.taskId !== task.id) {
    return { eligible: false, reason: SOURCE_ONLY_RECOVERY_REFUSALS.receiptTaskMismatch };
  }
  if (stored.rejectionReasons.length > 0) {
    return { eligible: false, reason: SOURCE_ONLY_RECOVERY_REFUSALS.receiptRejected };
  }
  if (!stored.consumed) {
    return { eligible: false, reason: SOURCE_ONLY_RECOVERY_REFUSALS.receiptNotConsumed };
  }
  if (
    (task.spec.delivery?.buildCommands.length ?? 0) > 0
    || (task.spec.delivery?.activationCommands.length ?? 0) > 0
    || (task.spec.delivery?.activationCheckCommands.length ?? 0) > 0
  ) {
    return {
      eligible: false,
      reason: SOURCE_ONLY_RECOVERY_REFUSALS.deliveryDeclaresBuildOrActivation,
    };
  }

  const stageEvents = stageEventsForOperation(store, taskId, operationId);
  if (stageEvents.length === 0) {
    return { eligible: false, reason: SOURCE_ONLY_RECOVERY_REFUSALS.sourceAppliedNotProven };
  }
  const onlyStageEvent = stageEvents[0]!;
  const onlyStageEvidence = onlyStageEvent.evidence;
  if (
    stageEvents.length !== 1
    || onlyStageEvent.receiptId !== receiptId
    || !isSourceAppliedPassed(onlyStageEvidence)
  ) {
    return { eligible: false, reason: SOURCE_ONLY_RECOVERY_REFUSALS.stageHistoryAmbiguous };
  }
  const stages: IntegrationStageEvidence[] = [onlyStageEvidence];
  if (stored.affectedFiles.length === 0) {
    return { eligible: false, reason: SOURCE_ONLY_RECOVERY_REFUSALS.affectedFilesEmpty };
  }
  for (const file of stored.affectedFiles) {
    if (detectUnsafePath(file) !== undefined) {
      return { eligible: false, reason: SOURCE_ONLY_RECOVERY_REFUSALS.unsafePath };
    }
    if (typeof stored.sourceEvidence[file] !== "string") {
      return { eligible: false, reason: SOURCE_ONLY_RECOVERY_REFUSALS.sourceEvidenceIncomplete };
    }
  }

  return { eligible: true, task, receipt: stored, stages };
}

type FileProof =
  | { kind: "digest"; value: string }
  | { kind: "absent" }
  | { kind: "refusal" };

/** Walk every relative path component from a canonical root with lstat and
 *  prove the final node is an exact regular-file digest, an exact `absent`
 *  (ENOENT), or an unprovable refusal. A symlink in ANY component - including
 *  an ancestor directory under the Candidate workspace, live source, or backup
 *  root - can redirect digest proof and later rollback outside the owned path
 *  while appearing as a regular final file, so each component is inspected with
 *  lstat and refused before any digest or rollback authority. Only ENOENT (on
 *  the final node or an ancestor whose absence implies the final node is also
 *  absent) means absent; a symlink, non-directory ancestor, directory or
 *  non-file final node, unreadable component, or root escape refuses so no I/O
 *  failure or redirection can be mistaken for absence or content. */
async function proveOwnedFile(root: string, file: string): Promise<FileProof> {
  // Root-escape defence: detectUnsafePath rejects absolute, backslash, null,
  // empty, and ".."/"." traversal. The caller also checks this for a precise
  // unsafePath reason; this guard keeps proveOwnedFile fail-closed on its own.
  if (detectUnsafePath(file) !== undefined) {
    return { kind: "refusal" };
  }
  const parts = file.split("/");
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]!);
    try {
      const stats = await lstat(current);
      // A symlink in any component - ancestor or final - can redirect proof and
      // rollback outside the owned root. lstat does not follow a final-node
      // symlink, but it DOES follow parent-component symlinks, so an ancestor
      // symlink would otherwise make a redirected outside file appear as a
      // regular file. Refuse on any symlink component.
      if (stats.isSymbolicLink()) {
        return { kind: "refusal" };
      }
      if (index < parts.length - 1) {
        // An ancestor that is not a directory cannot contain the final node.
        if (!stats.isDirectory()) {
          return { kind: "refusal" };
        }
      } else if (!stats.isFile()) {
        // The final node must be a regular file; a directory or other node refuses.
        return { kind: "refusal" };
      }
    } catch (error) {
      // Only ENOENT means absent: the final node, or an ancestor whose absence
      // implies the final node is also absent. Any other I/O error refuses
      // without guessing, so an unreadable component is never mistaken for
      // absence or content.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { kind: "absent" };
      }
      return { kind: "refusal" };
    }
  }
  try {
    return { kind: "digest", value: await fileDigest(current) };
  } catch {
    return { kind: "refusal" };
  }
}

type SourceOnlyProof =
  | { kind: "refusal"; reason: SourceOnlyRecoveryRefusalReason }
  | { kind: "proven"; postApplyDigests: Record<string, string>; backups: BackupRecord[] };

/** Prove that the live affected source matches the reviewed Candidate final
 *  bytes (or intended absence) and that the deterministic backup matches the
 *  receipt's pre-apply evidence. Any mismatch refuses without mutation. */
async function proveCandidateFinalAndBackup(
  task: TaskRecord,
  receipt: IntegrationReceiptRecord,
): Promise<SourceOnlyProof> {
  const postApplyDigests: Record<string, string> = {};
  const backups: BackupRecord[] = [];
  const bkpDir = backupDirPath(task.paths.root, receipt.id);

  for (const file of receipt.affectedFiles) {
    if (detectUnsafePath(file) !== undefined) {
      return { kind: "refusal", reason: SOURCE_ONLY_RECOVERY_REFUSALS.unsafePath };
    }
    const preApply = receipt.sourceEvidence[file]!;
    const candidateProof = await proveOwnedFile(task.paths.workspace, file);
    if (candidateProof.kind === "refusal") {
      return { kind: "refusal", reason: SOURCE_ONLY_RECOVERY_REFUSALS.unreadableProofPath };
    }
    const liveProof = await proveOwnedFile(task.sourcePath, file);
    if (liveProof.kind === "refusal") {
      return { kind: "refusal", reason: SOURCE_ONLY_RECOVERY_REFUSALS.unreadableProofPath };
    }
    const candidateDigest = candidateProof.kind === "digest" ? candidateProof.value : "absent";
    const liveDigest = liveProof.kind === "digest" ? liveProof.value : "absent";

    if (candidateDigest !== liveDigest) {
      return { kind: "refusal", reason: SOURCE_ONLY_RECOVERY_REFUSALS.candidateFinalMismatch };
    }

    if (preApply === "absent") {
      backups.push({ file, existed: false, backupPath: "", digest: "" });
    } else {
      const backupProof = await proveOwnedFile(bkpDir, file);
      if (backupProof.kind === "refusal") {
        return { kind: "refusal", reason: SOURCE_ONLY_RECOVERY_REFUSALS.unreadableProofPath };
      }
      const backupDigest = backupProof.kind === "digest" ? backupProof.value : "absent";
      if (backupDigest !== preApply) {
        return { kind: "refusal", reason: SOURCE_ONLY_RECOVERY_REFUSALS.backupMismatch };
      }
      backups.push({ file, existed: true, backupPath: path.join(bkpDir, file), digest: preApply });
    }
    postApplyDigests[file] = liveDigest;
  }

  return { kind: "proven", postApplyDigests, backups };
}

/** Run isolated acceptance on the already-applied source and persist exactly
 *  one ordinary terminal result. Mirrors applyIntegration's source-only tail
 *  (verification, concurrent-change detection, rollback/retained policy) so a
 *  recovered result is indistinguishable from an ordinary one. */
async function verifyAndFinalizeSourceOnly(
  store: StateStore,
  task: TaskRecord,
  receipt: IntegrationReceiptRecord,
  operationId: string,
  settings: IntegrationSettings,
  stages: IntegrationStageEvidence[],
  postApplyDigests: Record<string, string>,
  backups: BackupRecord[],
): Promise<IntegrationResult> {
  const receiptId = receipt.id;
  let verifyEnv: Awaited<ReturnType<typeof copyForVerification>> | undefined;
  const verificationCommands: VerificationCommandResult[] = [];
  let verificationPassed = true;
  let verificationError: string | undefined;

  try {
    verifyEnv = await copyForVerification(task.sourcePath, task.spec.workspace.exclude);
    const { env: verificationEnvironment, shellGitPrefix } = await verifierProcessEnvironment(
      task,
      verifyEnv.projectCwd,
    );
    for (const command of task.spec.acceptance.commands) {
      const result = await runCaptured(
        "/bin/zsh",
        ["-lc", shellGitPrefix + command],
        {
          cwd: verifyEnv.projectCwd,
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
    if (verifyEnv !== undefined) {
      await rm(verifyEnv.cleanupRoot, { recursive: true, force: true });
    }
  }

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
      receiptId, task.id, "retained-failure", backupDirPath(task.paths.root, receiptId),
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
    recordStage(
      store, task.id, operationId, receiptId, stages,
      { stage: "artifact-built", status: "not-applicable" },
    );
    recordStage(
      store, task.id, operationId, receiptId, stages,
      { stage: "runtime-activated", status: "not-applicable" },
    );
    const record = buildResultRecord(
      operationId,
      receiptId, task.id, "applied", backupDirPath(task.paths.root, receiptId),
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
        ? `${failureReason}; rollback incomplete: ${rollbackFailures.join(", ")}`
        : `${failureReason}; patch rolled back`;
    const status: IntegrationStatus = rollbackFailures.length > 0
      ? "retained-failure"
      : "rolled-back";
    const record = buildResultRecord(
      operationId,
      receiptId, task.id, status, backupDirPath(task.paths.root, receiptId),
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

  const record = buildResultRecord(
    operationId,
    receiptId, task.id, "retained-failure", backupDirPath(task.paths.root, receiptId),
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

/**
 * Continue one source-only Integration operation after its durable
 * `source-applied: passed` stage. Proves the live affected source equals the
 * reviewed Candidate final bytes and that the deterministic backup matches the
 * receipt pre-apply evidence, then runs the Task's acceptance commands in the
 * existing isolated verification copy and persists exactly one ordinary
 * terminal result. Never replays `git apply`, never consumes a second receipt,
 * and never touches build/activation work.
 */
export async function continueSourceOnlyIntegration(
  store: StateStore,
  taskId: string,
  receiptId: string,
  operationId: string,
  settings: IntegrationSettings,
): Promise<SourceOnlyRecoveryOutcome> {
  const eligibility = classifySourceOnlyRecovery(store, taskId, receiptId, operationId);
  if (!eligibility.eligible) {
    return { status: "outcome-unknown", reason: eligibility.reason };
  }
  const { task, receipt, stages } = eligibility;

  const proof = await proveCandidateFinalAndBackup(task, receipt);
  if (proof.kind === "refusal") {
    return { status: "outcome-unknown", reason: proof.reason };
  }

  return verifyAndFinalizeSourceOnly(
    store,
    task,
    receipt,
    operationId,
    settings,
    stages,
    proof.postApplyDigests,
    proof.backups,
  );
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
