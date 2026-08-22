/**
 * Preview-bound safe taskClass reuse.
 *
 * One canonical draft-only mutation for the Hub: validate that an explicit
 * same-family classChoice from the current admission preview is still valid
 * against the exact current file bytes and effective settings, construct a
 * new document that differs semantically only at root taskClass, fully
 * validate that document, and atomically replace the draft while preserving
 * permission bits and YAML comments / JSON format. Returns a fresh safe
 * admission preview generated from the exact written content.
 *
 * This is NOT automatic classification. ForkLight never infers semantic
 * equivalence, never preselects a choice, never writes on preview, and never
 * opens a generic file editor. Only an explicit confirm:true with an exact
 * current classChoice proceeds, and the write is limited to the single root
 * taskClass key of an unsubmitted Task Contract. No Task, Attempt, Worker,
 * Provider request, Competition, settings, history, or lifecycle record is
 * created. Stale, forged, repeated, concurrent and unsafe-path requests fail
 * closed before any destructive write.
 *
 * File safety: every read of the target uses O_NOFOLLOW so a symlink or a
 * path swapped to a symlink fails closed. The final step before rename
 * re-opens the path with O_NOFOLLOW and re-checks the captured file identity
 * (dev/ino) and the exact bytes, so a concurrent path swap can never be
 * overwritten. The canonical fresh preview is produced from the validated
 * temporary replacement BEFORE the atomic rename, so no error after commit can
 * report failure while leaving the draft changed.
 */

import { constants } from "node:fs";
import { randomBytes } from "node:crypto";
import { sha256 } from "./digest.js";
import { chmod, open, rename, unlink, writeFile, type FileHandle } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { computeClassificationAdvice } from "./classification-advice.js";
import type { ForkLightSettings } from "./settings.js";
import {
  buildTaskAdmissionPreview,
  prepareTaskAdmission,
  type SafeTaskAdmissionPreview,
} from "./task-preview.js";
import type { TaskRecord } from "./types.js";

/** Bounded stale-preview reason shared by the daemon and Hub. The Hub maps it
 *  to a "preview again" instruction without echoing any other daemon text. */
export const CLASS_REUSE_STALE_REASON =
  "Task preview is out of date; preview again before applying.";

interface ReuseTaskClassInput {
  /** Absolute path to an unsubmitted Task Contract file. */
  taskFileInput: string;
  /** Exact previewRevisionDigest the caller confirmed. */
  expectedPreviewRevisionDigest: string;
  /** Exact current same-family classChoice name (1-80 characters). */
  taskClass: string;
  /** Immutable current settings snapshot. */
  settings: ForkLightSettings;
  /** Read-only terminal ordinary Task history for classification advice. */
  tasks: readonly TaskRecord[];
  /** Test seam: invoked after the temporary replacement is fully validated and
   *  immediately before the final O_NOFOLLOW identity/digest recheck. Lets an
   *  adversarial test swap the target path to prove the operation fails closed
   *  before any mutation. Production callers never supply it. */
  beforeFinalIdentityCheck?: () => Promise<void>;
}

interface ReuseTaskClassResult {
  /** Fresh canonical admission preview for the exact written content. */
  preview: SafeTaskAdmissionPreview;
}

function isJsonFile(taskFile: string): boolean {
  // Must mirror loadTaskSpec's exact extension check so the same file is
  // always parsed the same way.
  return taskFile.endsWith(".json");
}

/** One no-follow open of the Task Contract: raw bytes, identity (dev/ino) and
 *  permission bits. A symlink, directory, or path swapped to either fails
 *  closed before any read or write. */
interface OpenedTaskFile {
  text: string;
  dev: number;
  ino: number;
  mode: number;
}

async function openTaskFileNoFollow(target: string): Promise<OpenedTaskFile> {
  let handle: FileHandle;
  try {
    handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new Error(
        "reuse_task_class target must be a regular file, not a symlink or directory",
      );
    }
    throw error;
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw new Error(
        "reuse_task_class target must be a regular file, not a symlink or directory",
      );
    }
    const text = await handle.readFile({ encoding: "utf8" });
    return { text, dev: stats.dev, ino: stats.ino, mode: stats.mode & 0o777 };
  } finally {
    await handle.close();
  }
}

/** Fail closed unless the exact same regular file still occupies the path with
 *  the exact same bytes. O_NOFOLLOW rejects a swapped-in symlink; the captured
 *  identity comparison rejects a swapped-in regular file. */
async function assertSameFileIdentity(
  target: string,
  expected: OpenedTaskFile,
  expectedDigest: string,
): Promise<void> {
  const current = await openTaskFileNoFollow(target);
  if (current.dev !== expected.dev || current.ino !== expected.ino) {
    throw new Error(CLASS_REUSE_STALE_REASON);
  }
  if (sha256(current.text) !== expectedDigest) {
    throw new Error(CLASS_REUSE_STALE_REASON);
  }
}

/**
 * Build a new document text that changes only the root taskClass key of the
 * Task Contract (the document root is the Task object itself). YAML uses a
 * document-preserving parser so comments and formatting survive; JSON is
 * re-serialized as JSON so the contract stays JSON.
 */
function applyClassToDocument(rawText: string, format: "json" | "yaml", taskClass: string): string {
  if (format === "json") {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    parsed.taskClass = taskClass;
    return `${JSON.stringify(parsed, null, 2)}\n`;
  }
  const doc = YAML.parseDocument(rawText);
  if (doc.errors.length > 0) {
    throw new Error("Task contract YAML could not be parsed");
  }
  doc.setIn(["taskClass"], taskClass);
  return doc.toString();
}

/** Recursive deep equality over plain JSON-ish values (object key order
 *  independent). Used only to prove the raw document is semantically
 *  unchanged apart from root taskClass. */
function deepEqualStable(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right) return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return left.every((value, index) => deepEqualStable(value, right[index]));
  }
  if (
    left !== null && right !== null
    && typeof left === "object" && typeof right === "object"
  ) {
    const l = left as Record<string, unknown>;
    const r = right as Record<string, unknown>;
    const lKeys = Object.keys(l).sort();
    const rKeys = Object.keys(r).sort();
    if (lKeys.length !== rKeys.length) return false;
    for (let i = 0; i < lKeys.length; i += 1) {
      if (lKeys[i] !== rKeys[i]) return false;
      if (!deepEqualStable(l[lKeys[i]!]!, r[rKeys[i]!]!)) return false;
    }
    return true;
  }
  return false;
}

/** Shallow copy of the Task Contract document root with the root `taskClass`
 *  key removed so the old and new raw documents can be compared without it.
 *  Nested `taskClass` keys (inside contract/modules) are deliberately
 *  preserved: only the root field may change. */
function withoutRootTaskClass(task: unknown): unknown {
  if (task === null || typeof task !== "object" || Array.isArray(task)) return task;
  const record = task as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (key === "taskClass") continue;
    copy[key] = record[key];
  }
  return copy;
}

/** Prove the constructed document differs semantically only at root
 *  taskClass. Any other parsed field difference rejects before any write. */
function assertSingleFieldChange(
  oldText: string,
  newText: string,
  format: "json" | "yaml",
  taskClass: string,
): void {
  const oldParsed = format === "json" ? JSON.parse(oldText) : YAML.parse(oldText);
  const newParsed = format === "json" ? JSON.parse(newText) : YAML.parse(newText);
  if (
    newParsed === null || typeof newParsed !== "object" || Array.isArray(newParsed)
    || oldParsed === null || typeof oldParsed !== "object" || Array.isArray(oldParsed)
  ) {
    throw new Error("Task contract root must be an object");
  }
  const oldRoot = oldParsed as Record<string, unknown>;
  const newRoot = newParsed as Record<string, unknown>;
  if (newRoot.taskClass !== taskClass) {
    throw new Error("reuse_task_class could not change the root taskClass");
  }
  if (!deepEqualStable(withoutRootTaskClass(oldRoot), withoutRootTaskClass(newRoot))) {
    throw new Error("reuse_task_class would change more than the root taskClass");
  }
}

/**
 * Canonical preview-bound draft classification mutation. Validates every
 * authority condition against the current file bytes and settings snapshot
 * (never trusts caller-displayed state), constructs and fully validates a
 * document that differs only at root taskClass, produces the canonical fresh
 * preview from the validated replacement, and then atomically replaces the
 * draft preserving permission bits. On any rejection the real file is left
 * byte-identical and temporary artifacts are cleaned.
 */
export async function applyReusedTaskClass(input: ReuseTaskClassInput): Promise<ReuseTaskClassResult> {
  const { expectedPreviewRevisionDigest, settings, tasks } = input;
  const taskFileInput = input.taskFileInput.trim();
  const taskClass = typeof input.taskClass === "string" ? input.taskClass.trim() : "";
  if (taskClass.length === 0 || taskClass.length > 80) {
    throw new Error("reuse_task_class requires a taskClass of 1 to 80 characters");
  }
  if (!path.isAbsolute(taskFileInput)) {
    throw new Error("reuse_task_class requires an absolute Task Contract file path");
  }

  // One no-follow read captures bytes, identity, and permission bits.
  const first = await openTaskFileNoFollow(taskFileInput);
  const format = isJsonFile(taskFileInput) ? "json" : "yaml";
  const prepared = await prepareTaskAdmission(taskFileInput, settings);

  // The prepared admission must come from exactly the bytes we read; the
  // caller-confirmed preview digest must match the canonical digest.
  if (prepared.taskFileDigest !== sha256(first.text)) {
    throw new Error(CLASS_REUSE_STALE_REASON);
  }
  if (prepared.previewRevisionDigest !== expectedPreviewRevisionDigest) {
    throw new Error(CLASS_REUSE_STALE_REASON);
  }

  // Canonical classification advice over current terminal ordinary history.
  // Every authority condition is recomputed here; nothing is trusted from the
  // caller's displayed state.
  const advice = computeClassificationAdvice(
    prepared.spec.taskClass,
    prepared.spec.taskFamily,
    tasks,
  );
  if (advice.taskFamily.state !== "existing") {
    throw new Error("reuse_task_class requires an established taskFamily");
  }
  if (advice.taskClass.state !== "missing" && advice.taskClass.state !== "new") {
    throw new Error("reuse_task_class requires a missing or new current taskClass");
  }
  if (!advice.classChoices.some((choice) => choice.taskClass === taskClass)) {
    throw new Error("reuse_task_class requires an exact current classChoice");
  }

  // Construct a document that differs only at root taskClass and prove it.
  const newText = applyClassToDocument(first.text, format, taskClass);
  assertSingleFieldChange(first.text, newText, format, taskClass);

  // Atomic replace in the same directory, preserving permission bits. The
  // replacement is fully validated AND the canonical fresh preview is produced
  // from it BEFORE the rename, so an error after commit can never report
  // failure while leaving the draft changed.
  const temp = path.join(
    path.dirname(taskFileInput),
    `.${path.basename(taskFileInput)}.forklight-reuse-${randomBytes(8).toString("hex")}.${format}`,
  );
  let committed = false;
  try {
    await writeFile(temp, newText, { flag: "wx", mode: 0o600 });
    await chmod(temp, first.mode);
    // Full admission over the prospective replacement (parse + quality +
    // integration + effective policy). Confirms the new class was applied.
    const tempPrepared = await prepareTaskAdmission(temp, settings);
    if (tempPrepared.spec.taskClass !== taskClass) {
      throw new Error("reuse_task_class produced an unexpected document");
    }
    // The canonical fresh preview for the exact written content, produced
    // from the validated replacement before any mutation.
    const preview = await buildTaskAdmissionPreview(temp, settings, tasks);

    if (input.beforeFinalIdentityCheck !== undefined) {
      await input.beforeFinalIdentityCheck();
    }

    // Re-check identity + bytes with O_NOFOLLOW immediately before the atomic
    // replace so a concurrent editor or a swapped path/symlink can never be
    // overwritten by a stale write.
    await assertSameFileIdentity(taskFileInput, first, prepared.taskFileDigest);

    await rename(temp, taskFileInput);
    committed = true;
    return { preview };
  } finally {
    if (!committed) {
      try { await unlink(temp); } catch { /* already gone or never created */ }
    }
  }
}
