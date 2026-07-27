import { fileURLToPath } from "node:url";
import path from "node:path";
import type { StateStore } from "../state/store.js";
import type { CapabilitySupport } from "../workers/types.js";
import { runCaptured } from "./process.js";
import type {
  AttemptRecord,
  CheckpointReport,
  CheckpointRequest,
  EventRecord,
  TaskRecord,
  VerificationCommandResult,
} from "./types.js";
import { createPathPolicy } from "../workspace/path-policy.js";
import { writeWorkspacePatchReport } from "../workspace/patch.js";
import { verifierProcessEnvironment } from "../workspace/verifier-git.js";

export interface CheckpointLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export type CheckpointGapReason =
  | "runtime-unsupported"
  | "missing-or-failed-non-authoritative";

export interface TerminalAfterVerification {
  status: "succeeded" | "failed";
  /** Present only when status is failed. */
  failureReason?: string;
  /**
   * Record a non-blocking `checkpoint.skipped` audit event
   * (unsupported runtime, or supported/partial without a valid checkpoint).
   */
  recordCheckpointGap: boolean;
  gapReason?: CheckpointGapReason;
}

/**
 * Whether the given attempt has a complete, well-formed non-authoritative
 * checkpoint for every acceptance command id (`acceptance-1` … `acceptance-N`).
 *
 * Only events with matching `attemptId` count (multi-attempt isolation).
 * Wrong authority, partial command sets, non-zero exit, or timedOut reject.
 */
export function checkpointSatisfied(
  events: readonly EventRecord[],
  attemptId: string,
  commandCount: number,
): boolean {
  if (!Number.isSafeInteger(commandCount) || commandCount < 0) return false;
  if (commandCount === 0) {
    // No acceptance commands → no checkpoint payload required.
    return true;
  }
  const completed = [...events].reverse().find(
    (event) => event.attemptId === attemptId && event.type === "checkpoint.completed",
  );
  const payload = completed?.payload;
  if (
    payload === null
    || typeof payload !== "object"
    || Array.isArray(payload)
  ) {
    return false;
  }
  const report = payload as { authority?: unknown; commands?: unknown };
  if (
    report.authority !== "non-authoritative-checkpoint"
    || !Array.isArray(report.commands)
  ) return false;
  const expected = new Set(
    Array.from({ length: commandCount }, (_, index) => `acceptance-${index + 1}`),
  );
  for (const command of report.commands) {
    if (command === null || typeof command !== "object") return false;
    const candidate = command as { commandId?: unknown; exitCode?: unknown; timedOut?: unknown };
    if (
      typeof candidate.commandId !== "string"
      || !expected.delete(candidate.commandId)
      || candidate.exitCode !== 0
      || candidate.timedOut !== false
    ) {
      return false;
    }
  }
  return expected.size === 0;
}

/**
 * Terminal status after Worker finish + independent verification.
 *
 * Independent verification is authoritative for `succeeded` / `failed`.
 * Worker bounded checkpoint is a non-authoritative self-check: missing or
 * failed checkpoint must not force `failed` when verification passed.
 *
 * `unsupported` → always treat as skipped (gap audit).
 * `supported` / `partial` → gap audit only when checkpoint not satisfied.
 */
export function resolveTerminalAfterVerification(input: {
  verificationPassed: boolean;
  checkpointCapability: CapabilitySupport;
  checkpointSatisfied: boolean;
}): TerminalAfterVerification {
  if (!input.verificationPassed) {
    return {
      status: "failed",
      failureReason: "Independent verification failed",
      recordCheckpointGap: false,
    };
  }
  if (input.checkpointCapability === "unsupported") {
    return {
      status: "succeeded",
      recordCheckpointGap: true,
      gapReason: "runtime-unsupported",
    };
  }
  // supported | partial: checkpoint optional for terminal success
  if (!input.checkpointSatisfied) {
    return {
      status: "succeeded",
      recordCheckpointGap: true,
      gapReason: "missing-or-failed-non-authoritative",
    };
  }
  return {
    status: "succeeded",
    recordCheckpointGap: false,
  };
}

export function checkpointLaunch(
  task: TaskRecord,
  attempt: AttemptRecord,
): CheckpointLaunch {
  if (attempt.taskId !== task.id) {
    throw new Error("Checkpoint launch requires an Attempt owned by the Task");
  }
  const currentFile = fileURLToPath(import.meta.url);
  const sourceMode = currentFile.endsWith(".ts");
  const entry = path.join(path.dirname(currentFile), "..", "checkpoint", `main.${sourceMode ? "ts" : "js"}`);
  return {
    command: process.execPath,
    args: [
      "--disable-warning=ExperimentalWarning",
      ...(sourceMode ? ["--import", "tsx"] : []),
      entry,
    ],
    env: {
      FORKLIGHT_HOME: path.dirname(path.dirname(task.paths.root)),
      FORKLIGHT_CHECKPOINT_TASK_ID: task.id,
      FORKLIGHT_CHECKPOINT_ATTEMPT_ID: attempt.id,
    },
  };
}

export async function runCheckpoint(
  store: StateStore,
  request: CheckpointRequest,
): Promise<CheckpointReport> {
  const task = store.getTask(request.taskId);
  if (task.status !== "running" || task.currentAttemptId !== request.attemptId) {
    throw new Error("Checkpoint requires the Task current running attempt");
  }

  const catalog = new Map<string, string>(
    task.spec.acceptance.commands.map(
      (command, index) => [`acceptance-${index + 1}`, command],
    ),
  );
  const selected = request.commandIds ?? [...catalog.keys()];
  for (const commandId of selected) {
    if (!catalog.has(commandId)) {
      throw new Error(`unknown checkpoint command id: ${commandId}`);
    }
  }

  store.addEvent(
    task.id,
    request.attemptId,
    "checkpoint.started",
    `Worker requested ${selected.length} approved checkpoint command(s)`,
    { commandIds: selected },
  );

  const commands: CheckpointReport["commands"] = [];
  const { env: verifierEnvironment, shellGitPrefix } = await verifierProcessEnvironment(task);
  for (const commandId of selected) {
    const command = catalog.get(commandId)!;
    const captured = await runCaptured("/bin/zsh", ["-lc", shellGitPrefix + command], {
      cwd: task.paths.workspace,
      env: verifierEnvironment,
    });
    const result: VerificationCommandResult & { commandId: string } = {
      commandId,
      command,
      exitCode: captured.exitCode,
      stdout: captured.stdout,
      stderr: captured.stderr,
      durationMs: captured.durationMs,
      timedOut: captured.timedOut,
    };
    commands.push(result);
  }

  const patches = await writeWorkspacePatchReport(task.paths, createPathPolicy(task.spec));

  const report: CheckpointReport = {
    authority: "non-authoritative-checkpoint",
    attemptId: request.attemptId,
    commands,
    patches,
  };
  store.addEvent(
    task.id,
    request.attemptId,
    "checkpoint.completed",
    `Non-authoritative checkpoint completed: ${commands.length} command(s)`,
    report,
  );
  return report;
}
