/**
 * Canonical Task storage lifecycle.
 *
 * Store remains the durable authority. Filesystem and process facts are
 * observations. Eligibility is evaluated here once and reused by daemon,
 * CLI, and MCP. Audit and preview never mutate. Confirmed reclaim
 * re-evaluates current truth and removes only known regenerable targets
 * under one canonical Task root.
 */
import { execFileSync } from "node:child_process";
import {
  lstatSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import type { StateStore } from "../state/store.js";
import { resolveHandoffViewForTask } from "./candidate-handoff.js";
import { resolveLatestRevision } from "./candidate-revision.js";
import {
  DURABLE_EVIDENCE_ENTRY_NAMES,
  KNOWN_REGENERABLE_ENTRY_NAMES,
  taskRunRoot,
} from "./config.js";
import { buildMainDecisionPacketForTask } from "./main-decision-packet.js";
import {
  isReviewerTask,
  readReviewGraphView,
} from "./review-graph.js";
import { latestTaskResolutionState } from "./task-resolution.js";
import { isoTimestamp } from "./time.js";
import type {
  CandidateHandoffView,
  EventRecord,
  MainDecisionPacket,
  StorageAuditView,
  StorageDurableCategory,
  StorageKnownRegenerableCategory,
  StorageLifecycleClassification,
  StorageLifecycleEntry,
  StorageLifecycleNextAction,
  StorageLifecycleReason,
  StoragePreviewView,
  StorageProcessObservation,
  StorageProcessResult,
  StorageReclaimTaskResult,
  StorageReclaimView,
  StorageRetainView,
  StorageTargetObservation,
  StoreIntegrityCheck,
  TaskRecord,
} from "./types.js";

const KNOWN_REGENERABLE_NAME_SET = new Set<string>(KNOWN_REGENERABLE_ENTRY_NAMES);
const DURABLE_NAME_SET = new Set<string>(DURABLE_EVIDENCE_ENTRY_NAMES);

const REGENERABLE_CATEGORY_BY_NAME: Record<string, StorageKnownRegenerableCategory> = {
  workspace: "workspace",
  baseline: "baseline",
  "claude-config": "claude-config",
  "grok-home": "grok-home",
  "codex-home": "codex-home",
  "codex-tmp": "codex-tmp",
  "verifier-git": "verifier-git",
  "verifier-git.index": "verifier-git-index",
};

const DURABLE_CATEGORY_BY_NAME: Record<string, StorageDurableCategory> = {
  logs: "logs",
  "result.diff": "result-diff",
  "workspace.raw.patch": "raw-patch",
  "workspace.generated.patch": "generated-patch",
  revisions: "revisions",
  reviews: "reviews",
  handoff: "handoff",
  "source-manifest.json": "source-manifest",
  integration: "integration",
};

const ACTIVE_TASK_STATUSES = new Set([
  "queued",
  "waiting",
  "blocked",
  "preparing",
  "running",
  "verifying",
]);

const PROCESS_STOP_WAIT_MS = 2000;
const PROCESS_STOP_POLL_MS = 50;

export interface ObservedProcess {
  pid: number;
  command: string;
  cwd?: string;
}

export interface StorageLifecycleIo {
  listRunRootNames(home: string): string[];
  listTopLevelNames(absDir: string): string[];
  observeBytes(absPath: string): number;
  entryKind(absPath: string): "missing" | "symlink" | "directory" | "file" | "other";
  removeContainedTarget(absPath: string): void;
  listProcesses(): ObservedProcess[];
  processExists(pid: number): boolean;
  signalProcess(pid: number, signal: "SIGTERM" | "SIGKILL"): void;
  now(): string;
}

export interface StorageLifecycleOptions {
  io?: StorageLifecycleIo;
  extraActiveTaskIds?: readonly string[];
  processStopWaitMs?: number;
  /** Test hook: override the Store integrity preflight. Production omits this. */
  integrityPreflight?: () => StoreIntegrityCheck;
}

export function storeIntegrityBlocksMutation(check: StoreIntegrityCheck): boolean {
  return check.quickCheck !== "ok" || check.foreignKeyViolationCount !== 0;
}

function readIntegrity(store: StateStore, options: StorageLifecycleOptions): StoreIntegrityCheck {
  return options.integrityPreflight?.() ?? store.checkStoreIntegrity();
}

function isPathInside(candidate: string, root: string): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  return resolvedCandidate === resolvedRoot
    || resolvedCandidate.startsWith(resolvedRoot + path.sep);
}

function existingRealpath(absPath: string): string | undefined {
  try {
    return realpathSync(absPath);
  } catch {
    return undefined;
  }
}

function assertBoundedHome(home: string): string {
  const resolved = path.resolve(home);
  if (resolved === path.parse(resolved).root) {
    throw new Error("storage lifecycle refused: home must not be the filesystem root");
  }
  return resolved;
}

function physicalHomePath(home: string): string {
  return existingRealpath(home) ?? path.resolve(home);
}

/** Refuse a symlink used as `<home>/runs`. A Home alias itself may still be a symlink. */
function physicalRunsRootUnsafe(home: string, io: StorageLifecycleIo): boolean {
  const runs = path.join(home, "runs");
  const kind = io.entryKind(runs);
  if (kind === "missing") return false;
  if (kind !== "directory") return true;
  const realRuns = existingRealpath(runs);
  return realRuns === undefined || !isPathInside(realRuns, physicalHomePath(home));
}

/** Refuse a symlink used as `<home>/runs/<taskId>` or a root that escapes physical Home. */
function physicalTaskRootUnsafe(home: string, taskId: string, io: StorageLifecycleIo): boolean {
  const root = taskRunRoot(home, taskId);
  const kind = io.entryKind(root);
  if (kind === "missing") return false;
  if (kind !== "directory") return true;
  const realRoot = existingRealpath(root);
  if (realRoot === undefined || !isPathInside(realRoot, physicalHomePath(home))) return true;
  const realRuns = existingRealpath(path.join(home, "runs"));
  return realRuns !== undefined && !isPathInside(realRoot, realRuns);
}

function observeBytesSync(absPath: string): number {
  let stats;
  try {
    stats = lstatSync(absPath);
  } catch {
    return 0;
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) return stats.size;
  let total = stats.size;
  let names: string[];
  try {
    names = readdirSync(absPath);
  } catch {
    return total;
  }
  for (const name of names) {
    total += observeBytesSync(path.join(absPath, name));
  }
  return total;
}

function parsePsRows(output: string): ObservedProcess[] {
  const observed: ObservedProcess[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const match = /^(\d+)\s+(.*)$/.exec(trimmed);
    if (match === null) continue;
    const pid = Number(match[1]);
    if (!Number.isSafeInteger(pid) || pid <= 0) continue;
    observed.push({ pid, command: match[2] ?? "" });
  }
  return observed;
}

function cwdByPid(): Map<number, string> {
  try {
    const output = execFileSync("lsof", ["-nP", "-a", "-d", "cwd", "-Fn"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const map = new Map<number, string>();
    let pid = 0;
    for (const line of output.split("\n")) {
      if (line.startsWith("p")) {
        const value = Number(line.slice(1));
        pid = Number.isSafeInteger(value) && value > 0 ? value : 0;
      } else if (line.startsWith("n") && pid > 0) {
        map.set(pid, line.slice(1));
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

export function createDefaultStorageLifecycleIo(): StorageLifecycleIo {
  return {
    listRunRootNames(home) {
      const runs = path.join(home, "runs");
      try {
        return readdirSync(runs);
      } catch {
        return [];
      }
    },
    listTopLevelNames(absDir) {
      try {
        return readdirSync(absDir);
      } catch {
        return [];
      }
    },
    observeBytes: observeBytesSync,
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
    removeContainedTarget(absPath) {
      rmSync(absPath, { recursive: true, force: false });
    },
    listProcesses() {
      try {
        const output = execFileSync("ps", ["-ax", "-o", "pid=,command="], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        const rows = parsePsRows(output);
        const cwds = cwdByPid();
        return rows.map((row) => {
          const cwd = cwds.get(row.pid);
          return cwd === undefined ? row : { ...row, cwd };
        });
      } catch {
        return [];
      }
    },
    processExists(pid) {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },
    signalProcess(pid, signal) {
      process.kill(pid, signal);
    },
    now: isoTimestamp,
  };
}

/**
 * Extract every Task id that appears under the canonical runs root in a
 * command line or cwd. A process may reference multiple Task roots; callers
 * must protect every implicated Store Task and surface ambiguity.
 */
function taskIdsFromRunsPath(home: string, value: string): string[] {
  const runsRoot = path.join(home, "runs") + path.sep;
  const ids: string[] = [];
  let searchFrom = 0;
  while (searchFrom < value.length) {
    const index = value.indexOf(runsRoot, searchFrom);
    if (index < 0) break;
    const rest = value.slice(index + runsRoot.length);
    const name = rest.split(/[/ "']/, 1)[0];
    if (name !== undefined && name.length > 0) ids.push(name);
    // Advance past this runs-root match so later occurrences are still found.
    searchFrom = index + runsRoot.length;
  }
  return ids;
}

function nextActionForClassification(
  classification: StorageLifecycleClassification,
): StorageLifecycleNextAction {
  if (classification === "protected") return "protect-and-wait";
  if (classification === "reclaimable") return "confirm-reclaim";
  if (classification === "unknown-orphan") return "inspect-unknown-orphan";
  if (classification === "reclaimed") return "already-reclaimed";
  return "none";
}

function summaryNextAction(entries: readonly StorageLifecycleEntry[]): StorageLifecycleNextAction {
  if (entries.some((entry) => entry.classification === "unknown-orphan")) {
    return "inspect-unknown-orphan";
  }
  if (entries.some((entry) => entry.classification === "reclaimable")) {
    return "preview-eligible";
  }
  if (entries.some((entry) => entry.classification === "protected")) {
    return "protect-and-wait";
  }
  return "none";
}

function latestDispositionOutcome(
  events: readonly EventRecord[],
): "reclaimed" | "retained" | undefined {
  const latest = [...events]
    .filter((event) => event.type === "storage.disposition.recorded")
    .sort((left, right) => right.sequence - left.sequence)[0];
  if (latest === undefined || latest.payload === null || typeof latest.payload !== "object") {
    return undefined;
  }
  const outcome = (latest.payload as { outcome?: unknown }).outcome;
  return outcome === "reclaimed" || outcome === "retained" ? outcome : undefined;
}

function hasOpenVerification(events: readonly EventRecord[]): boolean {
  let open = false;
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (event.type === "verification.started") open = true;
    if (event.type === "verification.completed") open = false;
  }
  return open;
}

function revisionArtifactPresent(task: TaskRecord, revisionId: string, io: StorageLifecycleIo): boolean {
  const artifact = path.join(task.paths.root, "revisions", `${revisionId}.patch`);
  return io.entryKind(artifact) === "file";
}

function successorWorkspaceMaterialized(task: TaskRecord, io: StorageLifecycleIo): boolean {
  return io.entryKind(task.paths.workspace) === "directory";
}

function observeRootEntries(
  root: string,
  io: StorageLifecycleIo,
): {
  knownTargets: StorageTargetObservation[];
  preservedEntries: StorageTargetObservation[];
  bytes: StorageLifecycleEntry["bytes"];
} {
  const knownTargets: StorageTargetObservation[] = [];
  const preservedEntries: StorageTargetObservation[] = [];
  const bytes = { total: 0, regenerable: 0, durable: 0, unknown: 0 };
  for (const name of io.listTopLevelNames(root)) {
    const absPath = path.join(root, name);
    const size = io.observeBytes(absPath);
    bytes.total += size;
    const regenerable = REGENERABLE_CATEGORY_BY_NAME[name];
    if (regenerable !== undefined) {
      knownTargets.push({
        category: regenerable,
        name,
        bytes: size,
        kind: "known-regenerable",
      });
      bytes.regenerable += size;
      continue;
    }
    const durable = DURABLE_CATEGORY_BY_NAME[name];
    if (durable !== undefined) {
      preservedEntries.push({
        category: durable,
        name,
        bytes: size,
        kind: "durable",
      });
      bytes.durable += size;
      continue;
    }
    preservedEntries.push({
      category: "unknown",
      name,
      bytes: size,
      kind: "unknown",
    });
    bytes.unknown += size;
  }
  return { knownTargets, preservedEntries, bytes };
}

interface TaskClassificationInput {
  store: StateStore;
  home: string;
  task: TaskRecord;
  extraActiveTaskIds: ReadonlySet<string>;
  ambiguousTaskIds: ReadonlySet<string>;
  io: StorageLifecycleIo;
}

function regenerableTargetsGone(root: string, io: StorageLifecycleIo): boolean {
  return !KNOWN_REGENERABLE_ENTRY_NAMES.some(
    (name) => io.entryKind(path.join(root, name)) !== "missing",
  );
}

function classifyReviewerTask(input: {
  store: StateStore;
  task: TaskRecord;
  events: readonly EventRecord[];
  canonicalRoot: string;
  io: StorageLifecycleIo;
}): { classification: StorageLifecycleClassification; reason: StorageLifecycleReason } {
  const assignment = input.store.getReviewAssignmentByReviewerTaskId(input.task.id);
  if (assignment === undefined) {
    return { classification: "protected", reason: "ambiguous-mapping" };
  }
  const graph = input.store.getReviewGraph(assignment.graphId);
  if (graph.status === "pending" || graph.status === "running") {
    return { classification: "protected", reason: "operation-active" };
  }
  const disposition = latestDispositionOutcome(input.events);
  if (disposition === "retained") {
    return { classification: "retained", reason: "explicit-retain" };
  }
  const terminalTask = input.task.status === "succeeded"
    || input.task.status === "failed"
    || input.task.status === "interrupted";
  const graphTerminal = graph.status === "completed" || graph.status === "failed";
  if (terminalTask && graphTerminal) {
    if (regenerableTargetsGone(input.canonicalRoot, input.io)) {
      return { classification: "reclaimed", reason: "known-regenerable-removed" };
    }
    return { classification: "reclaimable", reason: "reviewer-graph-terminal" };
  }
  if (input.task.status === "interrupted") {
    return { classification: "protected", reason: "task-resumable" };
  }
  return { classification: "protected", reason: "unresolved-terminal" };
}

function classifyKnownTask(input: TaskClassificationInput): {
  classification: StorageLifecycleClassification;
  reason: StorageLifecycleReason;
} {
  const { store, home, task, extraActiveTaskIds, ambiguousTaskIds, io } = input;
  const canonicalRoot = taskRunRoot(home, task.id);
  if (path.resolve(task.paths.root) !== path.resolve(canonicalRoot)) {
    return { classification: "protected", reason: "ambiguous-mapping" };
  }
  if (physicalRunsRootUnsafe(home, io) || physicalTaskRootUnsafe(home, task.id, io)) {
    return { classification: "protected", reason: "ambiguous-mapping" };
  }
  if (ambiguousTaskIds.has(task.id)) {
    return { classification: "protected", reason: "ambiguous-mapping" };
  }

  if (extraActiveTaskIds.has(task.id) || ACTIVE_TASK_STATUSES.has(task.status)) {
    return { classification: "protected", reason: "task-active" };
  }

  const events = store.listEvents(task.id);
  const attempts = store.listAttempts(task.id);
  const packet: MainDecisionPacket = buildMainDecisionPacketForTask(store, task.id);
  const handoff: CandidateHandoffView | undefined = resolveHandoffViewForTask(store, task.id);
  const resolution = latestTaskResolutionState(events);
  const remediation = store.getRemediationDisposition(task.id);
  const latestRevision = resolveLatestRevision(events);
  const reviewer = isReviewerTask(store, task.id);
  const reviewGraph = reviewer
    ? undefined
    : readReviewGraphView(store, task.id);

  if (attempts.some((attempt) => attempt.status === "running")) {
    return { classification: "protected", reason: "operation-active" };
  }
  if (packet.validationRepair?.inProgress === true) {
    return { classification: "protected", reason: "operation-active" };
  }
  if (hasOpenVerification(events)) {
    return { classification: "protected", reason: "operation-active" };
  }
  if (reviewGraph?.status === "pending" || reviewGraph?.status === "running") {
    return { classification: "protected", reason: "operation-active" };
  }
  if (handoff?.status === "authorized" || handoff?.status === "preparing") {
    return { classification: "protected", reason: "operation-active" };
  }
  if (packet.integration?.status === "running") {
    return { classification: "protected", reason: "operation-active" };
  }
  if (packet.integration?.status === "outcome-unknown") {
    return { classification: "protected", reason: "operation-outcome-unknown" };
  }

  if (reviewer) {
    return classifyReviewerTask({ store, task, events, canonicalRoot, io });
  }

  const alreadyDelivered = packet.workspaceDisposition === "delivered"
    || packet.integration?.resultStatus === "applied"
    || store.getRemediationDisposition(task.id)?.status === "verified-repaired-delivered";

  // A later valid Main resolution outranks only these stale Candidate wait
  // packets. Active, mapping, and operation guards above still win, and
  // reclaim still requires the existing resolvedReady proof below.
  const suppressStaleCandidateWaits = resolution.status === "resolved";

  if (
    !alreadyDelivered
    && !suppressStaleCandidateWaits
    && (
      packet.review.blocksIntegration
      || packet.review.status === "missing"
      || packet.review.status === "undersized"
      || packet.review.status === "pending"
      || packet.review.status === "stale"
      || packet.review.status === "stale-main-accept"
    )
  ) {
    return { classification: "protected", reason: "awaiting-required-review" };
  }
  if (
    !alreadyDelivered
    && !suppressStaleCandidateWaits
    && (
      packet.workspaceDisposition === "protect-review"
      || packet.nextActionCode === "await-required-review"
      || packet.nextActionCode === "wait-for-judges"
    )
  ) {
    return { classification: "protected", reason: "awaiting-required-review" };
  }
  if (
    !alreadyDelivered
    && !suppressStaleCandidateWaits
    && (
      packet.nextActionCode === "record-main-review"
      || packet.nextActionCode === "record-fresh-main-review"
      || packet.workspaceDisposition === "protect-candidate"
    )
  ) {
    return { classification: "protected", reason: "awaiting-main-decision" };
  }
  if (
    !alreadyDelivered
    && !suppressStaleCandidateWaits
    && (
      packet.nextActionCode === "ready-for-integration"
      || packet.nextActionCode === "wait-for-integration"
    )
  ) {
    return { classification: "protected", reason: "awaiting-integration" };
  }

  if (task.status === "interrupted" && resolution.status !== "resolved") {
    return { classification: "protected", reason: "task-resumable" };
  }

  const sourceHandoff = handoff !== undefined && handoff.isSuccessor !== true
    ? handoff
    : undefined;
  const hasReusablePartial = latestRevision !== undefined
    || (sourceHandoff !== undefined && sourceHandoff.reusablePathCount > 0)
    || packet.workspaceDisposition === "protect-reusable-partial";
  let successorMaterialized = false;
  if (sourceHandoff?.status === "prepared") {
    try {
      const successor = store.getTask(sourceHandoff.successorTaskId);
      successorMaterialized = successorWorkspaceMaterialized(successor, io);
    } catch {
      successorMaterialized = false;
    }
  }
  const handoffReady = sourceHandoff?.status === "prepared"
    && sourceHandoff.reusablePathCount > 0
    && successorMaterialized;
  if (
    !alreadyDelivered
    && hasReusablePartial
    && !handoffReady
    && resolution.status !== "resolved"
  ) {
    return {
      classification: "protected",
      reason: sourceHandoff !== undefined && sourceHandoff.status !== "prepared"
        ? "handoff-unprepared"
        : "unresolved-partial",
    };
  }

  const disposition = latestDispositionOutcome(events);
  if (disposition === "retained") {
    return { classification: "retained", reason: "explicit-retain" };
  }

  const delivered = packet.workspaceDisposition === "delivered"
    || packet.integration?.resultStatus === "applied";
  const remediationDelivered = remediation?.status === "verified-repaired-delivered";
  const resolvedReady = resolution.status === "resolved"
    && (task.status === "failed" || task.status === "interrupted" || task.status === "succeeded")
    && (latestRevision === undefined || revisionArtifactPresent(task, latestRevision.id, io));

  let reclaimReason: StorageLifecycleReason | undefined;
  if (delivered) reclaimReason = "integration-delivered";
  else if (remediationDelivered) reclaimReason = "remediation-verified-repaired-delivered";
  else if (handoffReady) reclaimReason = "handoff-successor-materialized";
  else if (resolvedReady) reclaimReason = "main-resolved-terminal";

  if (reclaimReason !== undefined) {
    if (regenerableTargetsGone(canonicalRoot, io)) {
      return { classification: "reclaimed", reason: "known-regenerable-removed" };
    }
    return { classification: "reclaimable", reason: reclaimReason };
  }

  if (task.status === "succeeded" || task.status === "failed" || task.status === "interrupted") {
    return { classification: "protected", reason: "unresolved-terminal" };
  }
  return { classification: "protected", reason: "task-active" };
}

/** Stored workerPid ownership is a Task-id set, never last-row-wins. */
function storedWorkerPidOwners(tasks: readonly TaskRecord[]): {
  pidToTaskIds: Map<number, readonly string[]>;
  ambiguousTaskIds: Set<string>;
} {
  const pidToTaskIds = new Map<number, string[]>();
  for (const task of tasks) {
    if (task.workerPid === undefined) continue;
    const owners = pidToTaskIds.get(task.workerPid) ?? [];
    owners.push(task.id);
    pidToTaskIds.set(task.workerPid, owners);
  }
  const ambiguousTaskIds = new Set<string>();
  for (const owners of pidToTaskIds.values()) {
    if (owners.length < 2) continue;
    for (const taskId of owners) ambiguousTaskIds.add(taskId);
  }
  return { pidToTaskIds, ambiguousTaskIds };
}

function mapProcesses(
  home: string,
  tasks: readonly TaskRecord[],
  io: StorageLifecycleIo,
): {
  byTaskId: Map<string, StorageProcessObservation[]>;
  unknown: Array<{ observation: StorageProcessObservation; rootName?: string }>;
  ambiguousTaskIds: Set<string>;
} {
  const byTaskId = new Map<string, StorageProcessObservation[]>();
  const unknown: Array<{ observation: StorageProcessObservation; rootName?: string }> = [];
  const stored = storedWorkerPidOwners(tasks);
  const ambiguousTaskIds = new Set(stored.ambiguousTaskIds);
  const taskIds = new Set(tasks.map((task) => task.id));

  for (const observed of io.listProcesses()) {
    if (observed.pid === process.pid || observed.pid === process.ppid) continue;
    // Scan every runs/<task> occurrence in command and cwd; do not stop at the first.
    const commandTaskIds = taskIdsFromRunsPath(home, observed.command);
    const cwdTaskIds = observed.cwd === undefined ? [] : taskIdsFromRunsPath(home, observed.cwd);
    const workerTaskIds = [...(stored.pidToTaskIds.get(observed.pid) ?? [])];
    const candidates = [
      ...commandTaskIds,
      ...cwdTaskIds,
      ...workerTaskIds,
    ].filter((value) => value.length > 0);
    const unique = [...new Set(candidates)];
    if (unique.length === 0) continue;
    const match: StorageProcessObservation["match"] = workerTaskIds.some((taskId) => unique.includes(taskId))
      ? "worker-pid"
      : commandTaskIds.some((taskId) => unique.includes(taskId))
        ? "command"
        : "cwd";
    if (unique.length > 1) {
      const observation: StorageProcessObservation = {
        pid: observed.pid,
        ownership: "ambiguous",
        match,
        implicatedTaskIds: unique,
      };
      unknown.push({ observation });
      for (const taskId of unique) {
        if (!taskIds.has(taskId)) continue;
        ambiguousTaskIds.add(taskId);
        const list = byTaskId.get(taskId) ?? [];
        list.push(observation);
        byTaskId.set(taskId, list);
      }
      continue;
    }
    const taskId = unique[0]!;
    if (!taskIds.has(taskId)) {
      unknown.push({
        observation: {
          pid: observed.pid,
          ownership: "unknown-orphan",
          taskId,
          match,
        },
        rootName: taskId,
      });
      continue;
    }
    const list = byTaskId.get(taskId) ?? [];
    list.push({ pid: observed.pid, ownership: "task", taskId, match });
    byTaskId.set(taskId, list);
  }
  return { byTaskId, unknown, ambiguousTaskIds };
}

function buildTaskEntry(
  input: TaskClassificationInput,
  processes: StorageProcessObservation[],
): StorageLifecycleEntry {
  const classified = classifyKnownTask(input);
  const root = taskRunRoot(input.home, input.task.id);
  const observed = observeRootEntries(root, input.io);
  return {
    classification: classified.classification,
    reason: classified.reason,
    nextAction: nextActionForClassification(classified.classification),
    taskId: input.task.id,
    rootName: input.task.id,
    bytes: observed.bytes,
    knownTargets: observed.knownTargets,
    preservedEntries: observed.preservedEntries,
    processes,
  };
}

function unknownRootEntry(
  rootName: string,
  home: string,
  io: StorageLifecycleIo,
  processes: StorageProcessObservation[],
  reason: StorageLifecycleReason,
): StorageLifecycleEntry {
  const observed = observeRootEntries(path.join(home, "runs", rootName), io);
  return {
    classification: "unknown-orphan",
    reason,
    nextAction: "inspect-unknown-orphan",
    rootName,
    bytes: observed.bytes,
    knownTargets: [],
    preservedEntries: observed.preservedEntries.concat(observed.knownTargets.map((target) => ({
      ...target,
      kind: "unknown" as const,
      category: "unknown" as const,
    }))),
    processes,
  };
}

export function auditStorage(
  store: StateStore,
  home: string,
  options: StorageLifecycleOptions = {},
): StorageAuditView {
  const resolvedHome = assertBoundedHome(home);
  const io = options.io ?? createDefaultStorageLifecycleIo();
  const extraActiveTaskIds = new Set(options.extraActiveTaskIds ?? []);
  const tasks = store.listTasks();
  const processMap = mapProcesses(resolvedHome, tasks, io);
  const entries: StorageLifecycleEntry[] = [];
  const seenRoots = new Set<string>();

  for (const task of tasks) {
    seenRoots.add(task.id);
    entries.push(buildTaskEntry(
      {
        store,
        home: resolvedHome,
        task,
        extraActiveTaskIds,
        ambiguousTaskIds: processMap.ambiguousTaskIds,
        io,
      },
      processMap.byTaskId.get(task.id) ?? [],
    ));
  }

  for (const rootName of io.listRunRootNames(resolvedHome)) {
    if (seenRoots.has(rootName)) continue;
    const unknownProcesses = processMap.unknown
      .filter((item) => item.rootName === rootName)
      .map((item) => item.observation);
    entries.push(unknownRootEntry(rootName, resolvedHome, io, unknownProcesses, "unmapped-root"));
    seenRoots.add(rootName);
  }

  for (const item of processMap.unknown) {
    if (item.rootName !== undefined && seenRoots.has(item.rootName)) continue;
    entries.push({
      classification: "unknown-orphan",
      reason: "unmapped-process",
      nextAction: "inspect-unknown-orphan",
      ...(item.observation.taskId === undefined ? {} : { taskId: item.observation.taskId }),
      ...(item.rootName === undefined ? {} : { rootName: item.rootName }),
      bytes: { total: 0, regenerable: 0, durable: 0, unknown: 0 },
      knownTargets: [],
      preservedEntries: [],
      processes: [item.observation],
    });
  }

  const totals = {
    protectedBytes: 0,
    reclaimableBytes: 0,
    reclaimedBytes: 0,
    retainedBytes: 0,
    unknownOrphanBytes: 0,
    entryCount: entries.length,
    unknownOrphanCount: 0,
    reclaimableCount: 0,
  };
  for (const entry of entries) {
    if (entry.classification === "protected") totals.protectedBytes += entry.bytes.total;
    if (entry.classification === "reclaimable") {
      totals.reclaimableBytes += entry.bytes.regenerable;
      totals.reclaimableCount += 1;
    }
    if (entry.classification === "reclaimed") totals.reclaimedBytes += entry.bytes.durable;
    if (entry.classification === "retained") totals.retainedBytes += entry.bytes.total;
    if (entry.classification === "unknown-orphan") {
      totals.unknownOrphanBytes += entry.bytes.total;
      totals.unknownOrphanCount += 1;
    }
  }

  return {
    kind: "storage-audit",
    entries,
    totals,
    integrity: store.checkStoreIntegrity(),
    nextAction: summaryNextAction(entries),
  };
}

export function previewStorage(
  store: StateStore,
  home: string,
  request: { taskId?: string } = {},
  options: StorageLifecycleOptions = {},
): StoragePreviewView {
  const audit = auditStorage(store, home, options);
  const scope: StoragePreviewView["scope"] = request.taskId === undefined ? "all-eligible" : "task";
  let entries: StorageLifecycleEntry[];
  if (request.taskId !== undefined) {
    const match = audit.entries.find((entry) => entry.taskId === request.taskId || entry.rootName === request.taskId);
    if (match === undefined) {
      throw new Error(`Unknown ForkLight task: ${request.taskId}`);
    }
    entries = [match];
  } else {
    // Keep the fresh audit's protected and unknown entries visible.
    // Deletion targets below remain reclaimable-only.
    entries = audit.entries;
  }
  const targets = entries.flatMap((entry) =>
    entry.classification === "reclaimable" ? entry.knownTargets : [],
  );
  const preservedEntries = entries.flatMap((entry) => entry.preservedEntries);
  const processes = entries.flatMap((entry) => entry.processes);
  const estimatedBytes = targets.reduce((sum, target) => sum + target.bytes, 0);
  const nextAction = entries.some((entry) => entry.classification === "unknown-orphan")
    ? "inspect-unknown-orphan"
    : entries.some((entry) => entry.classification === "reclaimable")
      ? "confirm-reclaim"
      : entries.some((entry) => entry.classification === "protected")
        ? "protect-and-wait"
        : entries.some((entry) => entry.classification === "reclaimed")
          ? "already-reclaimed"
          : "none";
  return {
    kind: "storage-preview",
    scope,
    entries,
    targets,
    preservedEntries,
    processes,
    estimatedBytes,
    integrity: audit.integrity,
    nextAction,
  };
}

function sleepSync(ms: number): void {
  if (ms <= 0) return;
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}

function waitForExit(io: StorageLifecycleIo, pid: number, waitMs: number): boolean {
  const deadline = Date.now() + Math.max(0, waitMs);
  while (Date.now() <= deadline) {
    if (!io.processExists(pid)) return true;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    sleepSync(Math.min(PROCESS_STOP_POLL_MS, remaining));
  }
  return !io.processExists(pid);
}

function stopEligibleProcesses(
  processes: readonly StorageProcessObservation[],
  io: StorageLifecycleIo,
  waitMs: number,
): StorageProcessResult[] {
  const results: StorageProcessResult[] = [];
  for (const observed of processes) {
    if (observed.ownership !== "task" || observed.pid === process.pid || observed.pid === process.ppid) {
      results.push({ pid: observed.pid, outcome: "refused", signals: [] });
      continue;
    }
    if (!io.processExists(observed.pid)) {
      results.push({ pid: observed.pid, outcome: "already-exited", signals: [] });
      continue;
    }
    const signals: Array<"SIGTERM" | "SIGKILL"> = [];
    try {
      io.signalProcess(observed.pid, "SIGTERM");
      signals.push("SIGTERM");
    } catch {
      results.push({
        pid: observed.pid,
        outcome: io.processExists(observed.pid) ? "refused" : "already-exited",
        signals,
      });
      continue;
    }
    if (waitForExit(io, observed.pid, waitMs)) {
      results.push({ pid: observed.pid, outcome: "stopped", signals });
      continue;
    }
    try {
      io.signalProcess(observed.pid, "SIGKILL");
      signals.push("SIGKILL");
    } catch {
      results.push({
        pid: observed.pid,
        outcome: io.processExists(observed.pid) ? "refused" : "escalated",
        signals,
      });
      continue;
    }
    results.push({
      pid: observed.pid,
      outcome: io.processExists(observed.pid) ? "refused" : "escalated",
      signals,
    });
  }
  return results;
}

function refuseReclaim(
  entry: StorageLifecycleEntry,
): StorageReclaimTaskResult {
  return {
    taskId: entry.taskId ?? entry.rootName ?? "unknown",
    applied: false,
    reason: entry.reason,
    classification: entry.classification,
    targets: [],
    removedBytes: 0,
    retainedDurableCategories: entry.preservedEntries
      .filter((item) => item.kind === "durable")
      .map((item) => item.category as StorageDurableCategory),
    processes: entry.processes.map((observed) => ({
      pid: observed.pid,
      outcome: "refused",
      signals: [],
    })),
    dispositionRecorded: false,
  };
}

function containedRegenerableTarget(
  home: string,
  taskId: string,
  name: string,
  io: StorageLifecycleIo,
): { absPath: string; category: StorageKnownRegenerableCategory } | { refuse: true } {
  const category = REGENERABLE_CATEGORY_BY_NAME[name];
  if (category === undefined || !KNOWN_REGENERABLE_NAME_SET.has(name) || DURABLE_NAME_SET.has(name)) {
    return { refuse: true };
  }
  const root = path.resolve(taskRunRoot(home, taskId));
  const absPath = path.resolve(root, name);
  if (path.dirname(absPath) !== root || path.basename(absPath) !== name) {
    return { refuse: true };
  }
  if (!isPathInside(absPath, root) || absPath === root) {
    return { refuse: true };
  }
  const kind = io.entryKind(absPath);
  if (kind === "missing") return { absPath, category };
  if (kind === "symlink" || kind === "other") return { refuse: true };
  const realTarget = existingRealpath(absPath);
  const realRoot = existingRealpath(root);
  // Compare real paths on both sides. macOS TMPDIR often lives under /var,
  // which is a symlink to /private/var; comparing a real target against the
  // unresolved root would false-refuse every ordinary Task directory.
  if (realTarget === undefined || realRoot === undefined || !isPathInside(realTarget, realRoot)) {
    return { refuse: true };
  }
  return { absPath, category };
}

function durableCategoriesFrom(entry: StorageLifecycleEntry): StorageDurableCategory[] {
  return [...new Set(
    entry.preservedEntries
      .filter((item) => item.kind === "durable")
      .map((item) => item.category as StorageDurableCategory),
  )];
}

function recordDisposition(
  store: StateStore,
  taskId: string,
  io: StorageLifecycleIo,
  payload: {
    outcome: "reclaimed" | "partial";
    reason: StorageLifecycleReason;
    targets: StorageReclaimTaskResult["targets"];
    removedBytes: number;
    retainedDurableCategories: StorageDurableCategory[];
    processes: StorageProcessResult[];
  },
): void {
  store.addEvent(
    taskId,
    undefined,
    "storage.disposition.recorded",
    payload.outcome === "reclaimed"
      ? "Storage disposition reclaimed"
      : "Storage disposition partial",
    {
      kind: "storage-disposition",
      outcome: payload.outcome,
      reason: payload.reason,
      removedCategories: payload.targets
        .filter((target) => target.outcome === "removed")
        .map((target) => target.category),
      removedCount: payload.targets.filter((target) => target.outcome === "removed").length,
      removedBytes: payload.removedBytes,
      retainedDurableCategories: payload.retainedDurableCategories,
      processResult: {
        stopped: payload.processes.filter((item) => item.outcome === "stopped" || item.outcome === "escalated").length,
        refused: payload.processes.filter((item) => item.outcome === "refused").length,
        escalated: payload.processes.filter((item) => item.outcome === "escalated").length,
      },
      integrity: store.checkStoreIntegrity(),
      recordedAt: io.now(),
    },
  );
}

function applyReclaimToTask(
  store: StateStore,
  home: string,
  entry: StorageLifecycleEntry,
  io: StorageLifecycleIo,
  waitMs: number,
): StorageReclaimTaskResult {
  if (entry.taskId === undefined || entry.classification !== "reclaimable") {
    return refuseReclaim(entry);
  }
  const retainedDurableCategories = durableCategoriesFrom(entry);
  const planned: Array<{
    name: string;
    category: StorageKnownRegenerableCategory;
    absPath: string;
    missing: boolean;
  }> = [];
  for (const target of entry.knownTargets) {
    const category = target.category as StorageKnownRegenerableCategory;
    const contained = containedRegenerableTarget(home, entry.taskId, target.name, io);
    if ("refuse" in contained) {
      const existing = io.entryKind(path.join(taskRunRoot(home, entry.taskId), target.name));
      if (existing !== "missing") {
        return {
          taskId: entry.taskId,
          applied: false,
          reason: entry.reason,
          classification: "reclaimable",
          targets: entry.knownTargets.map((item) => ({
            name: item.name,
            category: item.category as StorageKnownRegenerableCategory,
            outcome: "refused",
            bytes: 0,
          })),
          removedBytes: 0,
          retainedDurableCategories,
          processes: entry.processes.map((observed) => ({
            pid: observed.pid,
            outcome: "refused",
            signals: [],
          })),
          dispositionRecorded: false,
        };
      }
      continue;
    }
    planned.push({
      name: target.name,
      category,
      absPath: contained.absPath,
      missing: io.entryKind(contained.absPath) === "missing",
    });
  }

  const processResults = stopEligibleProcesses(
    entry.processes.filter((observed) => observed.ownership === "task"),
    io,
    waitMs,
  );
  const ownedStillLive = entry.processes.some(
    (observed) => observed.ownership === "task" && io.processExists(observed.pid),
  );
  if (ownedStillLive || processResults.some((item) => item.outcome === "refused")) {
    return {
      taskId: entry.taskId,
      applied: false,
      reason: entry.reason,
      classification: "reclaimable",
      targets: [],
      removedBytes: 0,
      retainedDurableCategories,
      processes: processResults,
      dispositionRecorded: false,
    };
  }

  const targets: StorageReclaimTaskResult["targets"] = [];
  let removedBytes = 0;
  let failedMidDelete = false;
  for (const item of planned) {
    if (failedMidDelete) {
      targets.push({
        name: item.name,
        category: item.category,
        outcome: item.missing ? "missing" : "refused",
        bytes: 0,
      });
      continue;
    }
    if (item.missing || io.entryKind(item.absPath) === "missing") {
      targets.push({
        name: item.name,
        category: item.category,
        outcome: "missing",
        bytes: 0,
      });
      continue;
    }
    const bytes = io.observeBytes(item.absPath);
    try {
      io.removeContainedTarget(item.absPath);
    } catch {
      failedMidDelete = true;
      targets.push({
        name: item.name,
        category: item.category,
        outcome: "refused",
        bytes: 0,
      });
      continue;
    }
    if (io.entryKind(item.absPath) !== "missing") {
      failedMidDelete = true;
      targets.push({
        name: item.name,
        category: item.category,
        outcome: "refused",
        bytes: 0,
      });
      continue;
    }
    targets.push({
      name: item.name,
      category: item.category,
      outcome: "removed",
      bytes,
    });
    removedBytes += bytes;
  }

  const stillPresent = !regenerableTargetsGone(taskRunRoot(home, entry.taskId), io);
  if (stillPresent) {
    const removedAny = targets.some((target) => target.outcome === "removed");
    if (removedAny) {
      recordDisposition(store, entry.taskId, io, {
        outcome: "partial",
        reason: entry.reason,
        targets,
        removedBytes,
        retainedDurableCategories,
        processes: processResults,
      });
    }
    return {
      taskId: entry.taskId,
      applied: false,
      reason: entry.reason,
      classification: "reclaimable",
      targets,
      removedBytes,
      retainedDurableCategories,
      processes: processResults,
      dispositionRecorded: removedAny,
    };
  }

  const changed = targets.some((target) => target.outcome === "removed")
    || processResults.some((item) => item.outcome === "stopped" || item.outcome === "escalated");
  if (changed) {
    recordDisposition(store, entry.taskId, io, {
      outcome: "reclaimed",
      reason: entry.reason,
      targets,
      removedBytes,
      retainedDurableCategories,
      processes: processResults,
    });
  }
  return {
    taskId: entry.taskId,
    applied: changed || !stillPresent,
    reason: entry.reason,
    classification: "reclaimed",
    targets,
    removedBytes,
    retainedDurableCategories,
    processes: processResults,
    dispositionRecorded: changed,
  };
}

export function reclaimStorage(
  store: StateStore,
  home: string,
  request: { taskId?: string; allEligible?: boolean; confirm: true },
  options: StorageLifecycleOptions = {},
): StorageReclaimView {
  if (request.confirm !== true) {
    throw new Error("storage reclaim requires explicit confirm: true");
  }
  if ((request.taskId === undefined) === (request.allEligible !== true)) {
    throw new Error("storage reclaim requires exactly one of taskId or allEligible");
  }
  const resolvedHome = assertBoundedHome(home);
  const io = options.io ?? createDefaultStorageLifecycleIo();
  const current = auditStorage(store, resolvedHome, options);
  const selected = request.taskId !== undefined
    ? current.entries.filter((entry) => entry.taskId === request.taskId || entry.rootName === request.taskId)
    : current.entries.filter((entry) => entry.classification === "reclaimable");
  if (request.taskId !== undefined && selected.length === 0) {
    throw new Error(`Unknown ForkLight task: ${request.taskId}`);
  }
  const preflightIntegrity = readIntegrity(store, options);
  if (storeIntegrityBlocksMutation(preflightIntegrity)) {
    const after = auditStorage(store, resolvedHome, options);
    return {
      kind: "storage-reclaim",
      scope: request.taskId === undefined ? "all-eligible" : "task",
      results: selected.map((entry) => ({
        ...refuseReclaim(entry),
        reason: "store-integrity-failed",
      })),
      integrity: preflightIntegrity,
      nextAction: after.nextAction,
    };
  }
  const results = selected.map((entry) => {
    if (entry.classification !== "reclaimable") return refuseReclaim(entry);
    return applyReclaimToTask(
      store,
      resolvedHome,
      entry,
      io,
      options.processStopWaitMs ?? PROCESS_STOP_WAIT_MS,
    );
  });
  const after = auditStorage(store, resolvedHome, options);
  return {
    kind: "storage-reclaim",
    scope: request.taskId === undefined ? "all-eligible" : "task",
    results,
    integrity: after.integrity,
    nextAction: after.nextAction,
  };
}

export function retainStorage(
  store: StateStore,
  home: string,
  request: { taskId: string; reason: string; confirm: true },
  options: StorageLifecycleOptions = {},
): StorageRetainView {
  if (request.confirm !== true) {
    throw new Error("storage retain requires explicit confirm: true");
  }
  const note = request.reason.trim();
  if (note.length < 1 || note.length > 1000) {
    throw new Error("storage retain reason must be 1-1000 characters");
  }
  const resolvedHome = assertBoundedHome(home);
  const io = options.io ?? createDefaultStorageLifecycleIo();
  const current = auditStorage(store, resolvedHome, options);
  const entry = current.entries.find((item) => item.taskId === request.taskId || item.rootName === request.taskId);
  if (entry === undefined) throw new Error(`Unknown ForkLight task: ${request.taskId}`);
  if (entry.classification === "retained") {
    return {
      kind: "storage-retain",
      taskId: request.taskId,
      applied: false,
      reason: "explicit-retain",
      classification: "retained",
      integrity: store.checkStoreIntegrity(),
      nextAction: "none",
      bytes: entry.bytes,
      priorReason: entry.reason,
    };
  }
  if (entry.classification !== "reclaimable" || entry.taskId === undefined) {
    return {
      kind: "storage-retain",
      taskId: request.taskId,
      applied: false,
      reason: entry.reason,
      classification: entry.classification,
      integrity: store.checkStoreIntegrity(),
      nextAction: nextActionForClassification(entry.classification),
      bytes: entry.bytes,
      priorReason: entry.reason,
    };
  }
  const preflightIntegrity = readIntegrity(store, options);
  if (storeIntegrityBlocksMutation(preflightIntegrity)) {
    return {
      kind: "storage-retain",
      taskId: request.taskId,
      applied: false,
      reason: "store-integrity-failed",
      classification: entry.classification,
      integrity: preflightIntegrity,
      nextAction: nextActionForClassification(entry.classification),
      bytes: entry.bytes,
      priorReason: entry.reason,
    };
  }
  const priorReason = entry.reason;
  store.addEvent(
    entry.taskId,
    undefined,
    "storage.disposition.recorded",
    "Storage disposition retained",
    {
      kind: "storage-disposition",
      outcome: "retained",
      reason: "explicit-retain",
      priorReason,
      removedCategories: [],
      removedCount: 0,
      removedBytes: 0,
      retainedDurableCategories: entry.preservedEntries
        .filter((item) => item.kind === "durable")
        .map((item) => item.category),
      processResult: { stopped: 0, refused: 0, escalated: 0 },
      integrity: preflightIntegrity,
      recordedAt: io.now(),
      noteLength: note.length,
    },
  );
  return {
    kind: "storage-retain",
    taskId: entry.taskId,
    applied: true,
    reason: "explicit-retain",
    classification: "retained",
    integrity: store.checkStoreIntegrity(),
    nextAction: "none",
    bytes: entry.bytes,
    priorReason,
  };
}

function formatIntegrity(integrity: StoreIntegrityCheck): string {
  return `integrity: ${integrity.quickCheck} (foreignKeyViolations=${integrity.foreignKeyViolationCount})`;
}

function formatEntryLines(entry: StorageLifecycleEntry): string[] {
  const id = entry.taskId ?? entry.rootName ?? "unknown";
  const lines = [
    `task ${id}`,
    `  classification: ${entry.classification}`,
    `  reason: ${entry.reason}`,
    `  regenerableBytes: ${entry.bytes.regenerable}`,
    `  durableBytes: ${entry.bytes.durable}`,
    `  unknownBytes: ${entry.bytes.unknown}`,
    `  nextAction: ${entry.nextAction}`,
  ];
  if (entry.knownTargets.length > 0) {
    lines.push(
      `  targets: ${entry.knownTargets.map((target) => `${target.name} (${target.bytes})`).join(", ")}`,
    );
  }
  if (entry.preservedEntries.length > 0) {
    lines.push(
      `  preserved: ${entry.preservedEntries.map((item) => item.name).join(", ")}`,
    );
  }
  if (entry.processes.length > 0) {
    lines.push(`  processes: ${entry.processes.map((item) => item.pid).join(", ")}`);
  }
  return lines;
}

export function formatStorageLifecycleHuman(
  view: StorageAuditView | StoragePreviewView | StorageReclaimView | StorageRetainView,
): string {
  if (view.kind === "storage-audit") {
    const lines = [
      "storage: audit",
      `entries: ${view.totals.entryCount}`,
      `protected: ${view.entries.filter((entry) => entry.classification === "protected").length} (${view.totals.protectedBytes} bytes)`,
      `reclaimable: ${view.totals.reclaimableCount} (${view.totals.reclaimableBytes} bytes)`,
      `reclaimed: ${view.entries.filter((entry) => entry.classification === "reclaimed").length}`,
      `retained: ${view.entries.filter((entry) => entry.classification === "retained").length}`,
      `unknown-orphan: ${view.totals.unknownOrphanCount}`,
      `nextAction: ${view.nextAction}`,
      formatIntegrity(view.integrity),
    ];
    for (const entry of view.entries) lines.push(...formatEntryLines(entry));
    return `${lines.join("\n")}\n`;
  }
  if (view.kind === "storage-preview") {
    const lines = [
      "storage: preview",
      `scope: ${view.scope}`,
      `estimatedBytes: ${view.estimatedBytes}`,
      `nextAction: ${view.nextAction}`,
      formatIntegrity(view.integrity),
    ];
    if (view.targets.length > 0) {
      lines.push(
        `targets: ${view.targets.map((target) => `${target.name} (${target.bytes})`).join(", ")}`,
      );
    }
    if (view.preservedEntries.length > 0) {
      lines.push(`preserved: ${view.preservedEntries.map((item) => item.name).join(", ")}`);
    }
    for (const entry of view.entries) lines.push(...formatEntryLines(entry));
    return `${lines.join("\n")}\n`;
  }
  if (view.kind === "storage-reclaim") {
    const removedBytes = view.results.reduce((sum, result) => sum + result.removedBytes, 0);
    const applied = view.results.filter((result) => result.applied).length;
    const refused = view.results.filter((result) => !result.applied).length;
    const lines = [
      "storage: reclaim",
      `scope: ${view.scope}`,
      `applied: ${applied}`,
      `refused: ${refused}`,
      `removedBytes: ${removedBytes}`,
      `nextAction: ${view.nextAction}`,
      formatIntegrity(view.integrity),
    ];
    for (const result of view.results) {
      lines.push(`task ${result.taskId}`);
      lines.push(`  applied: ${result.applied}`);
      lines.push(`  classification: ${result.classification}`);
      lines.push(`  reason: ${result.reason}`);
      lines.push(`  removedBytes: ${result.removedBytes}`);
      if (result.targets.length > 0) {
        lines.push(
          `  targets: ${result.targets.map((target) => `${target.name}:${target.outcome}`).join(", ")}`,
        );
      }
      if (result.retainedDurableCategories.length > 0) {
        lines.push(`  retained: ${result.retainedDurableCategories.join(", ")}`);
      }
    }
    return `${lines.join("\n")}\n`;
  }
  return [
    "storage: retain",
    `taskId: ${view.taskId}`,
    `applied: ${view.applied}`,
    `classification: ${view.classification}`,
    `reason: ${view.reason}`,
    `priorReason: ${view.priorReason}`,
    `regenerableBytes: ${view.bytes.regenerable}`,
    `durableBytes: ${view.bytes.durable}`,
    `unknownBytes: ${view.bytes.unknown}`,
    `nextAction: ${view.nextAction}`,
    formatIntegrity(view.integrity),
    "",
  ].join("\n");
}

export function storageHomeFromStore(store: StateStore): string {
  return path.dirname(store.databasePath);
}
