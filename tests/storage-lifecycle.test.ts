import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { taskPaths } from "../src/core/config.js";
import { buildMainDecisionPacketForTask } from "../src/core/main-decision-packet.js";
import {
  auditStorage,
  createDefaultStorageLifecycleIo,
  formatStorageLifecycleHuman,
  previewStorage,
  reclaimStorage,
  retainStorage,
  storeIntegrityBlocksMutation,
  type ObservedProcess,
  type StorageLifecycleIo,
} from "../src/core/storage-lifecycle.js";
import type {
  AttemptRecord,
  CandidateHandoffRecord,
  EventRecord,
  IntegrationReceiptRecord,
  IntegrationResultRecord,
  ReviewAssignmentRecord,
  ReviewGraphRecord,
  TaskRecord,
  TaskStatus,
} from "../src/core/types.js";
import { CANDIDATE_HANDOFF_CORRUPTION_ERROR, StateStore } from "../src/state/store.js";

const STAMP = "2026-08-14T00:00:00.000Z";

function makeTask(home: string, id: string, status: TaskStatus): TaskRecord {
  return {
    id,
    name: id,
    status,
    sourcePath: "/tmp/source",
    taskFile: `/tmp/${id}.yaml`,
    spec: {
      provider: { name: "deepseek", model: "deepseek-v4-pro[1M]" },
      runtime: { name: "claude-code" },
    } as TaskRecord["spec"],
    paths: taskPaths(home, id),
    sessionId: `session-${id}`,
    createdAt: STAMP,
    updatedAt: STAMP,
    startedAt: STAMP,
    ...(status === "running" || status === "queued" || status === "preparing"
      ? {}
      : { finishedAt: STAMP }),
  };
}

function writeTree(root: string, files: Record<string, string>): void {
  for (const [relative, contents] of Object.entries(files)) {
    const abs = path.join(root, relative);
    mkdirSync(path.dirname(abs), { recursive: true, mode: 0o700 });
    writeFileSync(abs, contents, { mode: 0o600 });
  }
}

function seedRegenerableAndDurable(task: TaskRecord): void {
  writeTree(task.paths.root, {
    "workspace/src/app.ts": "SECRET-WORKSPACE",
    "baseline/src/app.ts": "SECRET-BASELINE",
    "claude-config/settings.json": "{}",
    "grok-home/session.json": "{}",
    "codex-home/config.toml": "",
    "codex-tmp/cache": "tmp",
    "verifier-git/HEAD": "ref",
    "verifier-git.index": "idx",
    "logs/worker.log": "SECRET-LOG",
    "result.diff": "SECRET-DIFF",
    "workspace.raw.patch": "SECRET-RAW",
    "workspace.generated.patch": "SECRET-GEN",
    "revisions/rev-1.patch": "SECRET-REV",
    "reviews/graph/packet.json": "{}",
    "handoff/note.json": "{}",
    "source-manifest.json": "{}",
    "integration/receipt/backup/file": "SECRET-BACKUP",
    "mystery-cache/extra": "SECRET-UNKNOWN",
  });
}

function seedDelivered(store: StateStore, task: TaskRecord): void {
  store.createTask(task);
  store.addEvent(task.id, undefined, "integration.operation.started", "integration started", {
    operationId: `${task.id}-op`,
    taskId: task.id,
    receiptId: `${task.id}-receipt`,
  });
  const receipt: IntegrationReceiptRecord = {
    id: `${task.id}-receipt`,
    taskId: task.id,
    patchDigest: "d".repeat(64),
    affectedFiles: ["src/app.ts"],
    rejectionReasons: [],
    sourceEvidence: {},
    createdAt: STAMP,
    expiresAt: "2099-01-01T00:00:00.000Z",
    consumed: true,
  };
  store.saveIntegrationReceipt(receipt);
  const result: IntegrationResultRecord = {
    id: `${task.id}-op`,
    receiptId: receipt.id,
    taskId: task.id,
    status: "applied",
    appliedAt: STAMP,
    createdAt: STAMP,
    stages: [
      { stage: "source-applied", status: "passed" },
      { stage: "source-verified", status: "passed" },
      { stage: "artifact-built", status: "not-applicable" },
      { stage: "runtime-activated", status: "not-applicable" },
    ],
  };
  store.saveIntegrationResult(result);
}

function seedVerification(store: StateStore, taskId: string, passed = true): void {
  store.addEvent(taskId, undefined, "verification.completed", "verification completed", {
    passed,
    behaviorPassed: passed,
    policyPassed: true,
    sourceCompatible: true,
    commands: [],
    diffPath: "result.diff",
    sourceUnchanged: false,
  });
}

function seedRevision(store: StateStore, task: TaskRecord): void {
  store.addEvent(task.id, "attempt-1", "candidate.revision.captured", "revision captured", {
    id: "rev-1",
    taskId: task.id,
    attemptId: "attempt-1",
    attemptOrdinal: 1,
    verificationEventSequence: 1,
    patchDigest: "a".repeat(64),
    affectedPaths: ["src/app.ts"],
    filesChanged: 1,
    changedLines: 2,
    verificationPassed: false,
    createdAt: STAMP,
  });
}

function makeZeroChangeAuditTask(home: string, id: string): TaskRecord {
  const task = makeTask(home, id, "succeeded");
  return {
    ...task,
    spec: {
      ...task.spec,
      reviewRequirement: {
        requiredJudges: 0,
        reason: "zero-change audit",
      },
    },
  };
}

/** Authentic succeeded zero-change Candidate: passed verification, empty
 *  Revision, Main accept, and the protect-candidate / ready-for-integration
 *  packet those facts still project. */
function seedSucceededZeroChangeCandidate(
  store: StateStore,
  task: TaskRecord,
  options: { resolve?: boolean; writeRevisionArtifact?: boolean } = {},
): void {
  store.createTask(task);
  store.addEvent(task.id, "attempt-1", "verification.completed", "verification completed", {
    passed: true,
    behaviorPassed: true,
    policyPassed: true,
    sourceCompatible: true,
    commands: [],
    diffPath: "result.diff",
    sourceUnchanged: true,
  });
  store.addEvent(task.id, "attempt-1", "candidate.revision.captured", "revision captured", {
    id: "rev-1",
    taskId: task.id,
    attemptId: "attempt-1",
    attemptOrdinal: 1,
    verificationEventSequence: 1,
    patchDigest: "a".repeat(64),
    affectedPaths: [],
    filesChanged: 0,
    changedLines: 0,
    verificationPassed: true,
    createdAt: STAMP,
  });
  store.addEvent(task.id, "attempt-1", "main-review.completed", "Main agent review: accept", {
    decision: "accept",
    reason: "zero-change audit accepted",
    attemptId: "attempt-1",
    verificationEventSequence: 1,
    candidateRevisionId: "rev-1",
    acceptedPatchDigest: "a".repeat(64),
  });
  if (options.resolve === true) {
    store.addEvent(task.id, undefined, "task.resolution.completed", "attention resolved", {
      kind: "resolve",
      reason: "handled-elsewhere",
      resolvedAt: STAMP,
    });
  }
  seedRegenerableAndDurable(task);
  if (options.writeRevisionArtifact === false) {
    unlinkSync(path.join(task.paths.root, "revisions", "rev-1.patch"));
  }
}

function assertStaleSucceededCandidatePacket(store: StateStore, taskId: string): void {
  const packet = buildMainDecisionPacketForTask(store, taskId);
  assert.equal(packet.workspaceDisposition, "protect-candidate");
  assert.ok(
    packet.nextActionCode === "ready-for-integration"
    || packet.nextActionCode === "record-main-review"
    || packet.nextActionCode === "record-fresh-main-review",
  );
}

function ioWithProcesses(processes: ObservedProcess[]): StorageLifecycleIo {
  const base = createDefaultStorageLifecycleIo();
  const alive = new Set(processes.map((item) => item.pid));
  return {
    ...base,
    listProcesses: () => processes,
    processExists: (pid) => alive.has(pid),
    signalProcess(pid, signal) {
      if (signal === "SIGTERM" || signal === "SIGKILL") alive.delete(pid);
    },
  };
}

test("active and review-open Tasks stay protected and audit never mutates", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-active-"));
  const store = new StateStore(home);
  try {
    const running = makeTask(home, "task-running", "running");
    store.createTask(running);
    seedRegenerableAndDurable(running);

    const awaiting = makeTask(home, "task-awaiting", "succeeded");
    store.createTask(awaiting);
    seedVerification(store, awaiting.id, true);
    seedRegenerableAndDurable(awaiting);

    const beforeEvents = store.listEvents(running.id).length;
    const audit = auditStorage(store, home);
    const preview = previewStorage(store, home, { taskId: running.id });
    assert.equal(store.listEvents(running.id).length, beforeEvents);
    assert.equal(await readFile(path.join(running.paths.workspace, "src/app.ts"), "utf8"), "SECRET-WORKSPACE");

    const runningEntry = audit.entries.find((entry) => entry.taskId === running.id);
    const awaitingEntry = audit.entries.find((entry) => entry.taskId === awaiting.id);
    assert.equal(runningEntry?.classification, "protected");
    assert.equal(runningEntry?.reason, "task-active");
    assert.equal(awaitingEntry?.classification, "protected");
    assert.ok(
      awaitingEntry?.reason === "awaiting-main-decision"
      || awaitingEntry?.reason === "awaiting-required-review"
      || awaitingEntry?.reason === "awaiting-integration",
    );
    assert.equal(preview.entries[0]?.classification, "protected");
    const reclaim = reclaimStorage(store, home, { taskId: running.id, confirm: true });
    assert.equal(reclaim.results[0]?.applied, false);
    assert.equal(reclaim.results[0]?.classification, "protected");
    assert.equal(await readFile(path.join(running.paths.workspace, "src/app.ts"), "utf8"), "SECRET-WORKSPACE");
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("delivered Task reclaims known regeneration only and keeps durable evidence", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-delivered-"));
  const store = new StateStore(home);
  try {
    const task = makeTask(home, "task-delivered", "succeeded");
    seedDelivered(store, task);
    seedRegenerableAndDurable(task);

    const preview = previewStorage(store, home, { taskId: task.id });
    assert.equal(preview.entries[0]?.classification, "reclaimable");
    assert.equal(preview.entries[0]?.reason, "integration-delivered");
    assert.ok(preview.targets.some((target) => target.name === "workspace"));
    assert.ok(preview.preservedEntries.some((item) => item.name === "logs"));
    assert.ok(preview.preservedEntries.some((item) => item.name === "mystery-cache"));
    assert.equal(preview.nextAction, "confirm-reclaim");

    const result = reclaimStorage(store, home, { taskId: task.id, confirm: true });
    assert.equal(result.results[0]?.applied, true);
    assert.equal(result.integrity.quickCheck, "ok");
    assert.equal(result.integrity.foreignKeyViolationCount, 0);
    assert.ok(result.results[0]?.dispositionRecorded);

    assert.equal(createDefaultStorageLifecycleIo().entryKind(task.paths.workspace), "missing");
    assert.equal(createDefaultStorageLifecycleIo().entryKind(task.paths.baseline), "missing");
    assert.equal(createDefaultStorageLifecycleIo().entryKind(path.join(task.paths.root, "grok-home")), "missing");
    assert.equal(await readFile(path.join(task.paths.logs, "worker.log"), "utf8"), "SECRET-LOG");
    assert.equal(await readFile(task.paths.diff, "utf8"), "SECRET-DIFF");
    assert.equal(await readFile(path.join(task.paths.root, "revisions/rev-1.patch"), "utf8"), "SECRET-REV");
    assert.equal(await readFile(path.join(task.paths.root, "integration/receipt/backup/file"), "utf8"), "SECRET-BACKUP");
    assert.equal(await readFile(path.join(task.paths.root, "mystery-cache/extra"), "utf8"), "SECRET-UNKNOWN");

    const after = auditStorage(store, home);
    assert.equal(after.entries.find((entry) => entry.taskId === task.id)?.classification, "reclaimed");
    const events = store.listEvents(task.id);
    assert.ok(events.some((event: EventRecord) => event.type === "storage.disposition.recorded"));
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("reusable partial handoff stays protected until the successor workspace is materialized", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-handoff-"));
  const store = new StateStore(home);
  try {
    const source = makeTask(home, "task-source", "failed");
    store.createTask(source);
    seedRevision(store, source);
    seedRegenerableAndDurable(source);
    const protectedAudit = auditStorage(store, home);
    assert.equal(protectedAudit.entries.find((entry) => entry.taskId === source.id)?.classification, "protected");
    assert.ok(
      ["unresolved-partial", "handoff-unprepared"].includes(
        protectedAudit.entries.find((entry) => entry.taskId === source.id)?.reason ?? "",
      ),
    );

    const successor = makeTask(home, "task-successor", "queued");
    const handoff: CandidateHandoffRecord = {
      schemaVersion: 1,
      id: "handoff-1",
      status: "prepared",
      origin: { kind: "goal-task", goalId: "goal-1", itemId: "item-1" },
      sourceTaskId: source.id,
      sourceCandidateRevisionId: "rev-1",
      sourcePatchDigest: "a".repeat(64),
      gapContractDigest: "b".repeat(64),
      reusablePathCount: 1,
      remainingGapCount: 1,
      reusablePaths: ["src/app.ts"],
      remainingGaps: [{
        description: "finish the remaining gap work",
        acceptanceExpectation: "remaining tests must pass now",
      }],
      destinationWorkerProfileId: "grok-4-6-xhigh",
      destinationIdentity: {
        provider: "xai",
        model: "grok-4.6",
        runtime: "grok-build",
        effort: "xhigh",
      },
      successorTaskId: successor.id,
      reason: "continue remaining gaps on another Worker",
      createdAt: STAMP,
      updatedAt: STAMP,
      preparedAt: STAMP,
      nextAction: "wait-for-successor",
    };
    store.createCandidateHandoff({
      record: handoff,
      task: successor,
      authorizationEvent: { summary: "handoff authorized" },
    });
    mkdirSync(successor.paths.workspace, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(successor.paths.workspace, "src-imported.ts"), "imported");

    const ready = auditStorage(store, home);
    assert.equal(ready.entries.find((entry) => entry.taskId === source.id)?.classification, "reclaimable");
    assert.equal(
      ready.entries.find((entry) => entry.taskId === source.id)?.reason,
      "handoff-successor-materialized",
    );

    reclaimStorage(store, home, { taskId: source.id, confirm: true });
    assert.equal(createDefaultStorageLifecycleIo().entryKind(source.paths.workspace), "missing");
    assert.equal(await readFile(path.join(source.paths.root, "revisions/rev-1.patch"), "utf8"), "SECRET-REV");
    assert.equal(await readFile(path.join(successor.paths.workspace, "src-imported.ts"), "utf8"), "imported");
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("unknown roots and processes are preserved and block an all-clear next action", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-unknown-"));
  const store = new StateStore(home);
  try {
    mkdirSync(path.join(home, "runs", "orphan-root", "workspace"), { recursive: true, mode: 0o700 });
    writeFileSync(path.join(home, "runs", "orphan-root", "workspace", "file.txt"), "keep");
    const io = ioWithProcesses([
      {
        pid: 4242,
        command: "node worker.js",
        cwd: path.join(home, "runs", "ghost-task", "workspace"),
      },
    ]);
    const audit = auditStorage(store, home, { io });
    assert.equal(audit.nextAction, "inspect-unknown-orphan");
    assert.ok(audit.entries.some((entry) => entry.rootName === "orphan-root" && entry.classification === "unknown-orphan"));
    assert.ok(audit.entries.some((entry) =>
      entry.classification === "unknown-orphan"
      && entry.processes.some((item) => item.pid === 4242),
    ));
    const reclaim = reclaimStorage(store, home, { allEligible: true, confirm: true }, { io, processStopWaitMs: 0 });
    assert.equal(reclaim.results.length, 0);
    assert.equal(await readFile(path.join(home, "runs", "orphan-root", "workspace", "file.txt"), "utf8"), "keep");
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("reclaim re-evaluates current truth and refuses a Task that became active", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-changed-"));
  const store = new StateStore(home);
  try {
    const task = makeTask(home, "task-changed", "succeeded");
    seedDelivered(store, task);
    seedRegenerableAndDurable(task);
    const preview = previewStorage(store, home, { taskId: task.id });
    assert.equal(preview.entries[0]?.classification, "reclaimable");
    store.setTaskStatus(task.id, "running", { finishedAt: null });
    const reclaim = reclaimStorage(store, home, { taskId: task.id, confirm: true });
    assert.equal(reclaim.results[0]?.applied, false);
    assert.equal(reclaim.results[0]?.classification, "protected");
    assert.equal(await readFile(path.join(task.paths.workspace, "src/app.ts"), "utf8"), "SECRET-WORKSPACE");
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("reclaim stays inside a Task root when the home path itself is a symlink", async () => {
  const realHome = await mkdtemp(path.join(tmpdir(), "forklight-sl-realhome-"));
  const aliasDir = await mkdtemp(path.join(tmpdir(), "forklight-sl-aliasdir-"));
  const aliasHome = path.join(aliasDir, "home-link");
  symlinkSync(realHome, aliasHome);
  const store = new StateStore(aliasHome);
  try {
    const task = makeTask(aliasHome, "task-alias-home", "succeeded");
    seedDelivered(store, task);
    seedRegenerableAndDurable(task);
    const result = reclaimStorage(store, aliasHome, { taskId: task.id, confirm: true });
    assert.equal(result.results[0]?.applied, true);
    assert.equal(createDefaultStorageLifecycleIo().entryKind(task.paths.workspace), "missing");
    assert.equal(await readFile(path.join(task.paths.logs, "worker.log"), "utf8"), "SECRET-LOG");
  } finally {
    store.close();
    await rm(aliasDir, { recursive: true, force: true });
    await rm(realHome, { recursive: true, force: true });
  }
});

test("path containment refuses symlink targets and never deletes outside the Task root", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-contain-"));
  const outside = await mkdtemp(path.join(tmpdir(), "forklight-sl-outside-"));
  const store = new StateStore(home);
  try {
    const task = makeTask(home, "task-symlink", "succeeded");
    seedDelivered(store, task);
    seedRegenerableAndDurable(task);
    await rm(task.paths.workspace, { recursive: true, force: true });
    const outsideFile = path.join(outside, "do-not-delete.txt");
    await writeFile(outsideFile, "outside-secret");
    symlinkSync(outside, task.paths.workspace);
    const reclaim = reclaimStorage(store, home, { taskId: task.id, confirm: true });
    const workspaceResult = reclaim.results[0]?.targets.find((target) => target.name === "workspace");
    assert.equal(workspaceResult?.outcome, "refused");
    assert.equal(await readFile(outsideFile, "utf8"), "outside-secret");
    assert.equal(await readFile(path.join(task.paths.logs, "worker.log"), "utf8"), "SECRET-LOG");
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("human output includes bytes, reason, and one next action without private content", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-privacy-"));
  const store = new StateStore(home);
  try {
    const task = makeTask(home, "task-privacy", "succeeded");
    seedDelivered(store, task);
    seedRegenerableAndDurable(task);
    const audit = auditStorage(store, home);
    const json = JSON.stringify(audit);
    const human = formatStorageLifecycleHuman(audit);
    assert.match(human, /nextAction:/);
    assert.match(human, /regenerableBytes:/);
    assert.match(human, /reason:/);
    assert.doesNotMatch(json, /SECRET-WORKSPACE|SECRET-LOG|SECRET-DIFF/);
    assert.doesNotMatch(human, /SECRET-WORKSPACE|SECRET-LOG|SECRET-DIFF/);
    assert.doesNotMatch(json, new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal((human.match(/^nextAction:/m) ?? []).length, 1);
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("explicit retain keeps full space and later reclaim refuses", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-retain-"));
  const store = new StateStore(home);
  try {
    const task = makeTask(home, "task-retain", "succeeded");
    seedDelivered(store, task);
    seedRegenerableAndDurable(task);
    const retained = retainStorage(store, home, {
      taskId: task.id,
      reason: "keep workspace for a later audit",
      confirm: true,
    });
    assert.equal(retained.applied, true);
    assert.equal(retained.classification, "retained");
    const audit = auditStorage(store, home);
    assert.equal(audit.entries.find((entry) => entry.taskId === task.id)?.classification, "retained");
    const reclaim = reclaimStorage(store, home, { taskId: task.id, confirm: true });
    assert.equal(reclaim.results[0]?.applied, false);
    assert.equal(reclaim.results[0]?.classification, "retained");
    assert.equal(await readFile(path.join(task.paths.workspace, "src/app.ts"), "utf8"), "SECRET-WORKSPACE");
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("eligible-task processes are stopped only on confirmed reclaim", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-proc-"));
  const store = new StateStore(home);
  try {
    const task = makeTask(home, "task-proc", "succeeded");
    seedDelivered(store, task);
    seedRegenerableAndDurable(task);
    const io = ioWithProcesses([
      {
        pid: 7777,
        command: `node ${path.join(task.paths.workspace, "src/daemon/main.ts")}`,
      },
    ]);
    const preview = previewStorage(store, home, { taskId: task.id }, { io });
    assert.equal(preview.processes[0]?.pid, 7777);
    const reclaim = reclaimStorage(
      store,
      home,
      { taskId: task.id, confirm: true },
      { io, processStopWaitMs: 0 },
    );
    assert.equal(reclaim.results[0]?.processes[0]?.outcome, "stopped");
    assert.deepEqual(reclaim.results[0]?.processes[0]?.signals, ["SIGTERM"]);
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("main resolution makes a terminal failed Task reclaimable while keeping revisions", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-resolved-"));
  const store = new StateStore(home);
  try {
    const task = makeTask(home, "task-resolved", "failed");
    store.createTask(task);
    seedRevision(store, task);
    seedRegenerableAndDurable(task);
    store.addEvent(task.id, undefined, "task.resolution.completed", "attention resolved", {
      kind: "resolve",
      reason: "no-longer-needed",
      resolvedAt: STAMP,
    });
    const audit = auditStorage(store, home);
    assert.equal(audit.entries.find((entry) => entry.taskId === task.id)?.classification, "reclaimable");
    reclaimStorage(store, home, { taskId: task.id, confirm: true });
    assert.equal(createDefaultStorageLifecycleIo().entryKind(task.paths.workspace), "missing");
    assert.equal(await readFile(path.join(task.paths.root, "revisions/rev-1.patch"), "utf8"), "SECRET-REV");
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("resolved succeeded Candidate becomes reclaimable while the unresolved equivalent stays protected", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-resolved-succeeded-"));
  const store = new StateStore(home);
  try {
    const unresolved = makeZeroChangeAuditTask(home, "task-unresolved-zero");
    const resolved = makeZeroChangeAuditTask(home, "task-resolved-zero");
    seedSucceededZeroChangeCandidate(store, unresolved);
    seedSucceededZeroChangeCandidate(store, resolved, { resolve: true });
    assertStaleSucceededCandidatePacket(store, unresolved.id);
    assertStaleSucceededCandidatePacket(store, resolved.id);

    const audit = auditStorage(store, home);
    const unresolvedEntry = audit.entries.find((entry) => entry.taskId === unresolved.id);
    const resolvedEntry = audit.entries.find((entry) => entry.taskId === resolved.id);
    assert.equal(unresolvedEntry?.classification, "protected");
    assert.ok(
      unresolvedEntry?.reason === "awaiting-main-decision"
      || unresolvedEntry?.reason === "awaiting-required-review"
      || unresolvedEntry?.reason === "awaiting-integration",
    );
    assert.equal(resolvedEntry?.classification, "reclaimable");
    assert.equal(resolvedEntry?.reason, "main-resolved-terminal");

    const blocked = reclaimStorage(store, home, { taskId: unresolved.id, confirm: true });
    assert.equal(blocked.results[0]?.applied, false);
    assert.equal(blocked.results[0]?.classification, "protected");
    assert.equal(await readFile(path.join(unresolved.paths.workspace, "src/app.ts"), "utf8"), "SECRET-WORKSPACE");

    const preview = previewStorage(store, home, { taskId: resolved.id });
    assert.ok(preview.targets.some((target) => target.name === "workspace"));
    assert.ok(preview.preservedEntries.some((item) => item.name === "revisions"));
    assert.ok(preview.preservedEntries.some((item) => item.name === "logs"));
    assert.ok(preview.preservedEntries.some((item) => item.name === "mystery-cache"));

    const result = reclaimStorage(store, home, { taskId: resolved.id, confirm: true });
    assert.equal(result.results[0]?.applied, true);
    assert.equal(result.results[0]?.reason, "main-resolved-terminal");
    assert.equal(createDefaultStorageLifecycleIo().entryKind(resolved.paths.workspace), "missing");
    assert.equal(createDefaultStorageLifecycleIo().entryKind(resolved.paths.baseline), "missing");
    assert.equal(await readFile(path.join(resolved.paths.root, "revisions/rev-1.patch"), "utf8"), "SECRET-REV");
    assert.equal(await readFile(path.join(resolved.paths.logs, "worker.log"), "utf8"), "SECRET-LOG");
    assert.equal(await readFile(path.join(resolved.paths.root, "mystery-cache/extra"), "utf8"), "SECRET-UNKNOWN");
    const after = auditStorage(store, home);
    assert.equal(after.entries.find((entry) => entry.taskId === resolved.id)?.classification, "reclaimed");
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("terminal resolution does not outrank an active operation or missing Revision artifact", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-resolved-safety-"));
  const store = new StateStore(home);
  try {
    const active = makeZeroChangeAuditTask(home, "task-resolved-active");
    const missing = makeZeroChangeAuditTask(home, "task-resolved-missing-rev");
    seedSucceededZeroChangeCandidate(store, active, { resolve: true });
    seedSucceededZeroChangeCandidate(store, missing, { resolve: true, writeRevisionArtifact: false });
    const attempt: AttemptRecord = {
      id: "attempt-1",
      taskId: active.id,
      ordinal: 1,
      status: "running",
      sessionId: active.sessionId,
      rawLogPath: path.join(active.paths.logs, "attempt-1.log"),
      startedAt: STAMP,
    };
    store.createAttempt(attempt);
    assertStaleSucceededCandidatePacket(store, active.id);
    assertStaleSucceededCandidatePacket(store, missing.id);

    const audit = auditStorage(store, home);
    const activeEntry = audit.entries.find((entry) => entry.taskId === active.id);
    const missingEntry = audit.entries.find((entry) => entry.taskId === missing.id);
    assert.equal(activeEntry?.classification, "protected");
    assert.equal(activeEntry?.reason, "operation-active");
    assert.equal(missingEntry?.classification, "protected");
    assert.notEqual(missingEntry?.reason, "main-resolved-terminal");

    const activeReclaim = reclaimStorage(store, home, { taskId: active.id, confirm: true });
    assert.equal(activeReclaim.results[0]?.applied, false);
    assert.equal(await readFile(path.join(active.paths.workspace, "src/app.ts"), "utf8"), "SECRET-WORKSPACE");
    const missingReclaim = reclaimStorage(store, home, { taskId: missing.id, confirm: true });
    assert.equal(missingReclaim.results[0]?.applied, false);
    assert.equal(await readFile(path.join(missing.paths.workspace, "src/app.ts"), "utf8"), "SECRET-WORKSPACE");
    assert.equal(createDefaultStorageLifecycleIo().entryKind(path.join(missing.paths.root, "revisions", "rev-1.patch")), "missing");
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("ambiguous process stays visible and protects every implicated Task", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-ambiguous-"));
  const store = new StateStore(home);
  try {
    const first = makeTask(home, "task-one", "succeeded");
    const second = makeTask(home, "task-two", "succeeded");
    seedDelivered(store, first);
    seedDelivered(store, second);
    seedRegenerableAndDurable(first);
    seedRegenerableAndDurable(second);
    const io = ioWithProcesses([
      {
        pid: 9090,
        command: `node ${first.paths.workspace}/worker.js ${second.paths.workspace}/also.js`,
      },
    ]);
    const audit = auditStorage(store, home, { io });
    const firstEntry = audit.entries.find((entry) => entry.taskId === first.id);
    const secondEntry = audit.entries.find((entry) => entry.taskId === second.id);
    assert.equal(firstEntry?.classification, "protected");
    assert.equal(secondEntry?.classification, "protected");
    assert.equal(firstEntry?.reason, "ambiguous-mapping");
    assert.equal(secondEntry?.reason, "ambiguous-mapping");
    assert.ok(audit.entries.some((entry) =>
      entry.classification === "unknown-orphan"
      && entry.processes.some((item) => item.pid === 9090 && item.ownership === "ambiguous"),
    ));
    assert.equal(audit.nextAction, "inspect-unknown-orphan");
    const reclaim = reclaimStorage(store, home, { taskId: first.id, confirm: true }, { io, processStopWaitMs: 0 });
    assert.equal(reclaim.results[0]?.applied, false);
    assert.equal(await readFile(path.join(first.paths.workspace, "src/app.ts"), "utf8"), "SECRET-WORKSPACE");
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("reclaim refuses before deletion when a Task process cannot stop", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-sticky-"));
  const store = new StateStore(home);
  try {
    const task = makeTask(home, "task-sticky", "succeeded");
    seedDelivered(store, task);
    seedRegenerableAndDurable(task);
    const base = createDefaultStorageLifecycleIo();
    const io: StorageLifecycleIo = {
      ...base,
      listProcesses: () => [{
        pid: 6161,
        command: `node ${path.join(task.paths.workspace, "src/daemon/main.ts")}`,
      }],
      processExists: (pid) => pid === 6161,
      signalProcess() { /* stay alive */ },
    };
    const reclaim = reclaimStorage(
      store,
      home,
      { taskId: task.id, confirm: true },
      { io, processStopWaitMs: 0 },
    );
    assert.equal(reclaim.results[0]?.applied, false);
    assert.equal(reclaim.results[0]?.classification, "reclaimable");
    assert.equal(reclaim.results[0]?.dispositionRecorded, false);
    assert.equal(await readFile(path.join(task.paths.workspace, "src/app.ts"), "utf8"), "SECRET-WORKSPACE");
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("mid-delete failure records partial and stays reclaimable", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-partial-"));
  const store = new StateStore(home);
  try {
    const task = makeTask(home, "task-partial", "succeeded");
    seedDelivered(store, task);
    seedRegenerableAndDurable(task);
    const base = createDefaultStorageLifecycleIo();
    let removes = 0;
    const io: StorageLifecycleIo = {
      ...base,
      removeContainedTarget(absPath) {
        removes += 1;
        if (removes >= 2) throw new Error("injected mid-delete failure");
        base.removeContainedTarget(absPath);
      },
    };
    const reclaim = reclaimStorage(store, home, { taskId: task.id, confirm: true }, { io });
    assert.equal(reclaim.results[0]?.applied, false);
    assert.equal(reclaim.results[0]?.classification, "reclaimable");
    assert.equal(reclaim.results[0]?.dispositionRecorded, true);
    const after = auditStorage(store, home, { io });
    assert.equal(after.entries.find((entry) => entry.taskId === task.id)?.classification, "reclaimable");
    const events = store.listEvents(task.id);
    const disposition = events.filter((event) => event.type === "storage.disposition.recorded").at(-1);
    assert.equal((disposition?.payload as { outcome?: string } | undefined)?.outcome, "partial");
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("all-eligible reclaim keeps inspect-unknown-orphan when an orphan remains", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-all-eligible-"));
  const store = new StateStore(home);
  try {
    const task = makeTask(home, "task-eligible", "succeeded");
    seedDelivered(store, task);
    seedRegenerableAndDurable(task);
    mkdirSync(path.join(home, "runs", "orphan-root", "workspace"), { recursive: true, mode: 0o700 });
    writeFileSync(path.join(home, "runs", "orphan-root", "workspace", "file.txt"), "keep");
    const reclaim = reclaimStorage(store, home, { allEligible: true, confirm: true });
    assert.equal(reclaim.results[0]?.applied, true);
    assert.equal(reclaim.nextAction, "inspect-unknown-orphan");
    assert.equal(await readFile(path.join(home, "runs", "orphan-root", "workspace", "file.txt"), "utf8"), "keep");
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("integrity preflight refuses before any deletion", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-integrity-"));
  const store = new StateStore(home);
  try {
    const task = makeTask(home, "task-integrity", "succeeded");
    seedDelivered(store, task);
    seedRegenerableAndDurable(task);
    assert.equal(storeIntegrityBlocksMutation({ quickCheck: "ok", foreignKeyViolationCount: 0 }), false);
    assert.equal(storeIntegrityBlocksMutation({ quickCheck: "fail", foreignKeyViolationCount: 0 }), true);
    assert.equal(storeIntegrityBlocksMutation({ quickCheck: "ok", foreignKeyViolationCount: 1 }), true);
    const reclaim = reclaimStorage(store, home, { taskId: task.id, confirm: true }, {
      integrityPreflight: () => ({ quickCheck: "fail", foreignKeyViolationCount: 2 }),
    });
    assert.equal(reclaim.results[0]?.applied, false);
    assert.equal(reclaim.results[0]?.reason, "store-integrity-failed");
    assert.equal(reclaim.results[0]?.dispositionRecorded, false);
    assert.equal(await readFile(path.join(task.paths.workspace, "src/app.ts"), "utf8"), "SECRET-WORKSPACE");
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("terminal reviewer Task is reclaimable from Review Graph evidence without Main review", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-reviewer-"));
  const store = new StateStore(home);
  try {
    const candidate = makeTask(home, "task-candidate", "succeeded");
    store.createTask(candidate);
    const reviewer = makeTask(home, "task-reviewer", "succeeded");
    seedRegenerableAndDurable(reviewer);
    const graph: ReviewGraphRecord = {
      schemaVersion: 1,
      id: "graph-reviewer",
      candidateTaskId: candidate.id,
      candidateRevisionId: "rev-1",
      attemptId: "attempt-1",
      attemptOrdinal: 1,
      verificationEventSequence: 1,
      patchDigest: "a".repeat(64),
      status: "completed",
      round: 1,
      maxAssignments: 1,
      assignmentIds: ["assign-reviewer"],
      createdAt: STAMP,
      updatedAt: STAMP,
      terminalEvidenceSequence: 1,
    };
    const assignment: ReviewAssignmentRecord = {
      id: "assign-reviewer",
      graphId: graph.id,
      ordinal: 1,
      candidateTaskId: candidate.id,
      candidateRevisionId: "rev-1",
      reviewerWorkerProfileId: "judge",
      reviewerTaskId: reviewer.id,
      status: "completed",
      reason: "review the candidate",
      frozenIdentity: {
        provider: "xai",
        model: "grok-4.6",
        runtime: "grok-build",
        effort: "xhigh",
      },
      createdAt: STAMP,
      updatedAt: STAMP,
      completedAt: STAMP,
    };
    store.createReviewGraphExecution({
      graph,
      assignments: [assignment],
      reviewerTasks: [reviewer],
      assignmentEvents: [{ summary: "assigned" }],
      reviewerCreationEvents: [{ summary: "reviewer created" }],
    });
    const audit = auditStorage(store, home);
    const entry = audit.entries.find((item) => item.taskId === reviewer.id);
    assert.equal(entry?.classification, "reclaimable");
    assert.equal(entry?.reason, "reviewer-graph-terminal");
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("active Integration observation protects by Task id not operation id", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-integration-id-"));
  const store = new StateStore(home);
  try {
    const task = makeTask(home, "task-integrating", "succeeded");
    seedDelivered(store, task);
    seedRegenerableAndDurable(task);
    const operationId = `${task.id}-op`;
    const byOperation = auditStorage(store, home, { extraActiveTaskIds: [operationId] });
    assert.equal(
      byOperation.entries.find((entry) => entry.taskId === task.id)?.classification,
      "reclaimable",
    );
    const byTask = auditStorage(store, home, { extraActiveTaskIds: [task.id] });
    assert.equal(
      byTask.entries.find((entry) => entry.taskId === task.id)?.classification,
      "protected",
    );
    assert.equal(
      byTask.entries.find((entry) => entry.taskId === task.id)?.reason,
      "task-active",
    );
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("all-eligible preview keeps protected and unknown entries and lets unknown win next action", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-preview-visible-"));
  const store = new StateStore(home);
  try {
    const running = makeTask(home, "task-preview-running", "running");
    store.createTask(running);
    seedRegenerableAndDurable(running);
    const delivered = makeTask(home, "task-preview-delivered", "succeeded");
    seedDelivered(store, delivered);
    seedRegenerableAndDurable(delivered);
    mkdirSync(path.join(home, "runs", "orphan-preview", "workspace"), { recursive: true, mode: 0o700 });
    writeFileSync(path.join(home, "runs", "orphan-preview", "workspace", "file.txt"), "keep");

    const preview = previewStorage(store, home);
    assert.equal(preview.scope, "all-eligible");
    assert.ok(preview.entries.some((entry) => entry.taskId === running.id && entry.classification === "protected"));
    assert.ok(preview.entries.some((entry) => entry.taskId === delivered.id && entry.classification === "reclaimable"));
    assert.ok(preview.entries.some((entry) =>
      entry.rootName === "orphan-preview" && entry.classification === "unknown-orphan",
    ));
    assert.ok(preview.targets.every((target) =>
      preview.entries
        .filter((entry) => entry.classification === "reclaimable")
        .some((entry) => entry.knownTargets.includes(target)),
    ));
    assert.ok(preview.targets.some((target) => target.name === "workspace"));
    assert.ok(!preview.targets.some((target) => target.name === "orphan-preview"));
    assert.equal(preview.nextAction, "inspect-unknown-orphan");
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("duplicate stored workerPid protects every implicated Task and is never signalled", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-dup-pid-"));
  const store = new StateStore(home);
  try {
    const first = { ...makeTask(home, "task-pid-a", "succeeded"), workerPid: 424242 };
    const second = { ...makeTask(home, "task-pid-b", "succeeded"), workerPid: 424242 };
    seedDelivered(store, first);
    seedDelivered(store, second);
    seedRegenerableAndDurable(first);
    seedRegenerableAndDurable(second);

    const audit = auditStorage(store, home);
    const firstEntry = audit.entries.find((entry) => entry.taskId === first.id);
    const secondEntry = audit.entries.find((entry) => entry.taskId === second.id);
    assert.equal(firstEntry?.classification, "protected");
    assert.equal(secondEntry?.classification, "protected");
    assert.equal(firstEntry?.reason, "ambiguous-mapping");
    assert.equal(secondEntry?.reason, "ambiguous-mapping");

    const io = ioWithProcesses([{ pid: 424242, command: "node leftover-worker" }]);
    const reclaimFirst = reclaimStorage(
      store,
      home,
      { taskId: first.id, confirm: true },
      { io, processStopWaitMs: 0 },
    );
    const reclaimSecond = reclaimStorage(
      store,
      home,
      { taskId: second.id, confirm: true },
      { io, processStopWaitMs: 0 },
    );
    assert.equal(reclaimFirst.results[0]?.applied, false);
    assert.equal(reclaimSecond.results[0]?.applied, false);
    assert.ok((reclaimFirst.results[0]?.processes ?? []).every((item) => item.outcome === "refused"));
    assert.ok((reclaimSecond.results[0]?.processes ?? []).every((item) => item.outcome === "refused"));
    assert.ok((reclaimFirst.results[0]?.processes ?? []).every((item) => item.signals.length === 0));
    assert.equal(await readFile(path.join(first.paths.workspace, "src/app.ts"), "utf8"), "SECRET-WORKSPACE");
    assert.equal(await readFile(path.join(second.paths.workspace, "src/app.ts"), "utf8"), "SECRET-WORKSPACE");
    assert.equal(io.processExists(424242), true);
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("symlinked physical runs and Task roots are refused while a Home alias stays supported", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-runs-link-"));
  const redirectedRuns = await mkdtemp(path.join(tmpdir(), "forklight-sl-runs-target-"));
  const store = new StateStore(home);
  try {
    symlinkSync(redirectedRuns, path.join(home, "runs"));
    const task = makeTask(home, "task-runs-link", "succeeded");
    seedDelivered(store, task);
    seedRegenerableAndDurable(task);
    const audit = auditStorage(store, home);
    const entry = audit.entries.find((item) => item.taskId === task.id);
    assert.equal(entry?.classification, "protected");
    assert.equal(entry?.reason, "ambiguous-mapping");
    const reclaim = reclaimStorage(store, home, { taskId: task.id, confirm: true });
    assert.equal(reclaim.results[0]?.applied, false);
    assert.equal(await readFile(path.join(task.paths.workspace, "src/app.ts"), "utf8"), "SECRET-WORKSPACE");
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
    await rm(redirectedRuns, { recursive: true, force: true });
  }
});

test("symlinked physical Task root is refused and nothing is deleted", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-task-link-"));
  const outside = await mkdtemp(path.join(tmpdir(), "forklight-sl-task-link-outside-"));
  const store = new StateStore(home);
  try {
    const task = makeTask(home, "task-root-link", "succeeded");
    seedDelivered(store, task);
    mkdirSync(path.join(home, "runs"), { recursive: true, mode: 0o700 });
    symlinkSync(outside, task.paths.root);
    seedRegenerableAndDurable(task);
    const audit = auditStorage(store, home);
    const entry = audit.entries.find((item) => item.taskId === task.id);
    assert.equal(entry?.classification, "protected");
    assert.equal(entry?.reason, "ambiguous-mapping");
    const reclaim = reclaimStorage(store, home, { taskId: task.id, confirm: true });
    assert.equal(reclaim.results[0]?.applied, false);
    assert.equal(await readFile(path.join(outside, "workspace", "src", "app.ts"), "utf8"), "SECRET-WORKSPACE");
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("retain integrity preflight writes nothing when Store check fails", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-retain-integrity-"));
  const store = new StateStore(home);
  try {
    const task = makeTask(home, "task-retain-integrity", "succeeded");
    seedDelivered(store, task);
    seedRegenerableAndDurable(task);
    const beforeEvents = store.listEvents(task.id).length;
    const retained = retainStorage(store, home, {
      taskId: task.id,
      reason: "keep workspace for a later audit",
      confirm: true,
    }, {
      integrityPreflight: () => ({ quickCheck: "fail", foreignKeyViolationCount: 1 }),
    });
    assert.equal(retained.applied, false);
    assert.equal(retained.reason, "store-integrity-failed");
    assert.equal(retained.classification, "reclaimable");
    assert.equal(retained.priorReason, "integration-delivered");
    assert.equal(store.listEvents(task.id).length, beforeEvents);
    assert.equal(auditStorage(store, home).entries.find((entry) => entry.taskId === task.id)?.classification, "reclaimable");
    assert.equal(await readFile(path.join(task.paths.workspace, "src/app.ts"), "utf8"), "SECRET-WORKSPACE");
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("successful retain reports bytes and prior reason without persisting the raw note", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-retain-bytes-"));
  const store = new StateStore(home);
  try {
    const task = makeTask(home, "task-retain-bytes", "succeeded");
    seedDelivered(store, task);
    seedRegenerableAndDurable(task);
    const note = "keep workspace for a later audit";
    const retained = retainStorage(store, home, {
      taskId: task.id,
      reason: note,
      confirm: true,
    });
    assert.equal(retained.applied, true);
    assert.equal(retained.reason, "explicit-retain");
    assert.equal(retained.priorReason, "integration-delivered");
    assert.ok(retained.bytes.total > 0);
    assert.ok(retained.bytes.regenerable > 0);
    assert.ok(retained.bytes.durable > 0);
    const human = formatStorageLifecycleHuman(retained);
    assert.match(human, /priorReason: integration-delivered/);
    assert.match(human, /regenerableBytes:/);
    assert.doesNotMatch(human, /keep workspace for a later audit/);
    const events = store.listEvents(task.id);
    const disposition = events.filter((event) => event.type === "storage.disposition.recorded").at(-1);
    const payload = disposition?.payload as Record<string, unknown> | undefined;
    assert.equal(payload?.outcome, "retained");
    assert.equal(payload?.reason, "explicit-retain");
    assert.equal(payload?.priorReason, "integration-delivered");
    assert.equal(payload?.note, undefined);
    assert.equal(payload?.noteLength, note.length);
    assert.doesNotMatch(JSON.stringify(payload), /keep workspace for a later audit/);
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("retain event reuses preflight integrity and keeps one post-write check", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-retain-preflight-reuse-"));
  const store = new StateStore(home);
  try {
    const task = makeTask(home, "task-retain-preflight-reuse", "succeeded");
    seedDelivered(store, task);
    seedRegenerableAndDurable(task);
    const preflight = {
      quickCheck: "ok",
      foreignKeyViolationCount: 0,
      evidence: "injected-retain-preflight",
    };
    let preflightReads = 0;
    const storeChecks: Array<{ quickCheck: string; foreignKeyViolationCount: number }> = [];
    const originalCheck = store.checkStoreIntegrity.bind(store);
    store.checkStoreIntegrity = () => {
      const result = originalCheck();
      storeChecks.push(result);
      return result;
    };
    const retained = retainStorage(store, home, {
      taskId: task.id,
      reason: "keep workspace for a later audit",
      confirm: true,
    }, {
      integrityPreflight: () => {
        preflightReads += 1;
        return preflight;
      },
    });
    assert.equal(retained.applied, true);
    assert.equal(preflightReads, 1);
    assert.equal(storeChecks.length, 2);
    assert.equal(retained.integrity, storeChecks[1]);
    assert.equal(retained.integrity.quickCheck, "ok");
    assert.equal(retained.integrity.foreignKeyViolationCount, 0);
    assert.equal(
      (retained.integrity as { evidence?: string }).evidence,
      undefined,
    );
    const events = store.listEvents(task.id);
    const disposition = events.filter((event) => event.type === "storage.disposition.recorded").at(-1);
    const recorded = (disposition?.payload as { integrity?: Record<string, unknown> } | undefined)?.integrity;
    assert.deepEqual(recorded, preflight);
    const src = await readFile(new URL("../src/core/storage-lifecycle.ts", import.meta.url), "utf8");
    const retainStart = src.indexOf("export function retainStorage(");
    const retainEnd = src.indexOf("function formatIntegrity(", retainStart);
    assert.ok(retainStart > 0 && retainEnd > retainStart);
    const retainFn = src.slice(retainStart, retainEnd);
    const addEventStart = retainFn.indexOf("store.addEvent(");
    const viewStart = retainFn.indexOf("return {", addEventStart);
    assert.ok(addEventStart > 0 && viewStart > addEventStart);
    const eventWrite = retainFn.slice(addEventStart, viewStart);
    assert.match(eventWrite, /integrity: preflightIntegrity/);
    assert.doesNotMatch(eventWrite, /checkStoreIntegrity/);
    assert.match(retainFn.slice(viewStart), /integrity: store\.checkStoreIntegrity\(\)/);
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

function insertRawHandoff(
  store: StateStore,
  record: CandidateHandoffRecord,
  recordJson: string,
  competitionId: string,
): void {
  const raw = new DatabaseSync(store.databasePath);
  try {
    raw.prepare(
      `INSERT INTO candidate_handoffs
       (id, source_revision_id, source_task_id, successor_task_id, competition_id,
        status, record_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.id,
      record.sourceCandidateRevisionId,
      record.sourceTaskId,
      record.successorTaskId,
      competitionId,
      record.status,
      recordJson,
      record.createdAt,
      record.updatedAt,
    );
  } finally {
    raw.close();
  }
}

test("storage audit and preview read authentic pre-origin Competition handoff without mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-legacy-handoff-"));
  const store = new StateStore(home);
  try {
    const source = makeTask(home, "task-legacy-source", "failed");
    const successor = makeTask(home, "task-legacy-successor", "queued");
    const currentSource = makeTask(home, "task-current-source", "failed");
    const currentSuccessor = makeTask(home, "task-current-successor", "queued");
    store.createTask(source);
    store.createTask(successor);
    store.createTask(currentSource);
    seedRegenerableAndDurable(source);
    seedRegenerableAndDurable(successor);

    const current: CandidateHandoffRecord = {
      schemaVersion: 1,
      id: "current-goal-handoff",
      status: "prepared",
      origin: { kind: "goal-task", goalId: "goal-1", itemId: "item-1" },
      sourceTaskId: currentSource.id,
      sourceCandidateRevisionId: "rev-current",
      sourcePatchDigest: "a".repeat(64),
      gapContractDigest: "b".repeat(64),
      reusablePathCount: 1,
      remainingGapCount: 1,
      reusablePaths: ["src/app.ts"],
      remainingGaps: [{
        description: "finish the remaining gap work",
        acceptanceExpectation: "remaining tests must pass now",
      }],
      destinationWorkerProfileId: "grok-4-6-xhigh",
      destinationIdentity: {
        provider: "xai",
        model: "grok-4.6",
        runtime: "grok-build",
        effort: "xhigh",
      },
      successorTaskId: currentSuccessor.id,
      reason: "continue remaining gaps on another Worker",
      createdAt: STAMP,
      updatedAt: STAMP,
      preparedAt: STAMP,
      nextAction: "wait-for-successor",
    };
    store.createCandidateHandoff({
      record: current,
      task: currentSuccessor,
      authorizationEvent: { summary: "current goal-task handoff" },
    });

    const legacyJson = JSON.stringify({
      schemaVersion: 1,
      id: "legacy-comp-handoff",
      status: "prepared",
      competitionId: "comp-legacy",
      sourceCandidateId: "cand-legacy",
      sourceTaskId: source.id,
      sourceCandidateRevisionId: "rev-legacy",
      sourcePatchDigest: "c".repeat(64),
      gapContractDigest: "d".repeat(64),
      reusablePathCount: 1,
      remainingGapCount: 1,
      reusablePaths: ["src/app.ts"],
      remainingGaps: [{
        description: "finish the remaining gap work",
        acceptanceExpectation: "remaining tests must pass now",
      }],
      destinationWorkerProfileId: "grok-4-6-xhigh",
      destinationIdentity: current.destinationIdentity,
      successorTaskId: successor.id,
      reason: "authentic pre-origin Competition handoff",
      createdAt: STAMP,
      updatedAt: STAMP,
      preparedAt: STAMP,
      nextAction: "wait-for-successor",
    });
    insertRawHandoff(store, {
      ...current,
      id: "legacy-comp-handoff",
      origin: { kind: "competition", competitionId: "comp-legacy", sourceCandidateId: "cand-legacy" },
      sourceTaskId: source.id,
      sourceCandidateRevisionId: "rev-legacy",
      successorTaskId: successor.id,
    }, legacyJson, "comp-legacy");

    const eventsBefore = [
      source.id,
      successor.id,
      currentSource.id,
      currentSuccessor.id,
    ].reduce((sum, id) => sum + store.listEvents(id).length, 0);

    const audit = auditStorage(store, home);
    const preview = previewStorage(store, home);
    assert.equal(preview.scope, "all-eligible");
    assert.ok(audit.entries.some((entry) => entry.taskId === source.id));
    assert.ok(audit.entries.some((entry) => entry.taskId === successor.id));
    assert.ok(preview.entries.some((entry) => entry.taskId === source.id));
    assert.ok(preview.entries.some((entry) => entry.taskId === currentSource.id));
    assert.equal(store.getCandidateHandoff("legacy-comp-handoff").origin.kind, "competition");
    assert.equal(store.getCandidateHandoff(current.id).origin.kind, "goal-task");

    const after = new DatabaseSync(store.databasePath);
    try {
      const row = after.prepare(
        `SELECT record_json FROM candidate_handoffs WHERE id = ?`,
      ).get("legacy-comp-handoff") as { record_json: string };
      assert.equal(row.record_json, legacyJson);
      assert.equal("origin" in JSON.parse(row.record_json), false);
    } finally {
      after.close();
    }
    assert.equal(
      [
        source.id,
        successor.id,
        currentSource.id,
        currentSuccessor.id,
      ].reduce((sum, id) => sum + store.listEvents(id).length, 0),
      eventsBefore,
    );
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("unreconstructable handoff stops storage classification without Store mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-sl-handoff-corrupt-"));
  const store = new StateStore(home);
  try {
    const source = makeTask(home, "task-broken-source", "failed");
    const successor = makeTask(home, "task-broken-successor", "queued");
    store.createTask(source);
    store.createTask(successor);
    seedRegenerableAndDurable(source);
    const secret = "SECRET-STORAGE-HANDOFF";
    const shaped: CandidateHandoffRecord = {
      schemaVersion: 1,
      id: "broken-handoff",
      status: "prepared",
      origin: { kind: "goal-task", goalId: "must-not-guess", itemId: "must-not-guess" },
      sourceTaskId: source.id,
      sourceCandidateRevisionId: "rev-broken",
      sourcePatchDigest: "a".repeat(64),
      gapContractDigest: "b".repeat(64),
      reusablePathCount: 1,
      remainingGapCount: 1,
      reusablePaths: ["src/app.ts"],
      remainingGaps: [{
        description: "finish the remaining gap work",
        acceptanceExpectation: "remaining tests must pass now",
      }],
      destinationWorkerProfileId: "grok-4-6-xhigh",
      destinationIdentity: {
        provider: "xai",
        model: "grok-4.6",
        runtime: "grok-build",
        effort: "xhigh",
      },
      successorTaskId: successor.id,
      reason: secret,
      createdAt: STAMP,
      updatedAt: STAMP,
      preparedAt: STAMP,
      nextAction: "wait-for-successor",
    };
    const corruptJson = JSON.stringify(shaped, (key, value) =>
      key === "origin" ? undefined : value,
    );
    insertRawHandoff(store, shaped, corruptJson, "");
    const eventsBefore = store.listEvents(source.id).length + store.listEvents(successor.id).length;
    const collected = store.listCandidateHandoffs();
    assert.equal(collected.length, 1);
    assert.equal(collected[0]?.origin, undefined);

    assert.throws(
      () => auditStorage(store, home),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, CANDIDATE_HANDOFF_CORRUPTION_ERROR);
        assert.ok(!error.message.includes(secret));
        return true;
      },
    );
    assert.throws(
      () => previewStorage(store, home),
      { name: "Error", message: CANDIDATE_HANDOFF_CORRUPTION_ERROR },
    );
    const after = new DatabaseSync(store.databasePath);
    try {
      const row = after.prepare(
        `SELECT record_json FROM candidate_handoffs WHERE id = ?`,
      ).get(shaped.id) as { record_json: string };
      assert.equal(row.record_json, corruptJson);
    } finally {
      after.close();
    }
    assert.equal(
      store.listEvents(source.id).length + store.listEvents(successor.id).length,
      eventsBefore,
    );
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});
