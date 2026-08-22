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

interface CheckpointLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

type CheckpointGapReason =
  | "runtime-unsupported"
  | "mcp-unavailable"
  | "missing-or-failed-non-authoritative";

/**
 * Bounded checkpoint MCP readiness projected from Claude init events.
 * `failed` means Claude explicitly reported the configured checkpoint server
 * failed — the Worker never received the tool and must not be blamed for
 * omitting it. `unknown` means no usable readiness evidence was reported.
 */
export type CheckpointMcpReadiness = "ready" | "failed" | "unknown";

/**
 * Read the last reported readiness of the `forklight_checkpoint` MCP server
 * from durable Claude init events for one Attempt. Only bounded codes are
 * stored; raw server diagnostics never leave the normalizer.
 */
export function checkpointMcpReadinessFromEvents(
  events: readonly EventRecord[],
  attemptId: string,
): CheckpointMcpReadiness {
  for (const event of [...events].reverse()) {
    if (event.attemptId !== attemptId || event.type !== "worker.message") continue;
    if (event.payload === null || typeof event.payload !== "object" || Array.isArray(event.payload)) {
      continue;
    }
    const servers = (event.payload as { mcpServers?: unknown }).mcpServers;
    if (!Array.isArray(servers)) continue;
    for (const server of servers) {
      if (server === null || typeof server !== "object" || Array.isArray(server)) continue;
      const entry = server as { name?: unknown; status?: unknown };
      if (entry.name !== "forklight_checkpoint") continue;
      if (entry.status === "ready") return "ready";
      if (entry.status === "failed") return "failed";
    }
  }
  return "unknown";
}

interface TerminalAfterVerification {
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
  const expected = Array.from({ length: commandCount }, (_, index) => `acceptance-${index + 1}`);
  if (report.commands.length !== expected.length) return false;
  for (const [index, command] of report.commands.entries()) {
    if (command === null || typeof command !== "object") return false;
    const candidate = command as { commandId?: unknown; exitCode?: unknown; timedOut?: unknown };
    if (
      typeof candidate.commandId !== "string"
      || candidate.commandId !== expected[index]
      || candidate.exitCode !== 0
      || candidate.timedOut !== false
    ) {
      return false;
    }
  }
  return true;
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
  /** Evidence from Claude init events; unknown when not reported. */
  mcpReadiness?: CheckpointMcpReadiness;
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
    // Claude explicitly reported the configured checkpoint MCP server failed:
    // the Worker never received the tool, so this is supported-but-unavailable,
    // not Worker omission.
    if (input.mcpReadiness === "failed") {
      return {
        status: "succeeded",
        recordCheckpointGap: true,
        gapReason: "mcp-unavailable",
      };
    }
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

interface CheckpointSelection {
  /** canonical `acceptance-N` → raw command text for the Task Contract. */
  catalog: Map<string, string>;
  /** Command ids in request order (defaults to the full catalog order). */
  selected: string[];
  /** Deterministic Task Contract catalog-order selection used for operation
   *  identity and execution. Numeric order (`acceptance-1` … `acceptance-11`)
   *  keeps full suites satisfying checkpointSatisfied and lets reordered
   *  equivalent selections reuse one operation. */
  canonicalIds: string[];
}

/** Resolve and validate the approved checkpoint command selection for one
 *  Task. Unknown and duplicate ids fail closed; the default selection is the
 *  full catalog. */
export function resolveCheckpointSelection(
  task: TaskRecord,
  request: CheckpointRequest,
): CheckpointSelection {
  const catalog = new Map<string, string>(
    task.spec.acceptance.commands.map(
      (command, index) => [`acceptance-${index + 1}`, command],
    ),
  );
  const selected = request.commandIds ?? [...catalog.keys()];
  const seen = new Set<string>();
  for (const commandId of selected) {
    if (!catalog.has(commandId)) {
      throw new Error(`unknown checkpoint command id: ${commandId}`);
    }
    if (seen.has(commandId)) {
      throw new Error(`duplicate checkpoint command id: ${commandId}`);
    }
    seen.add(commandId);
  }
  const order = new Map<string, number>();
  for (const [index, commandId] of [...catalog.keys()].entries()) {
    order.set(commandId, index);
  }
  return {
    catalog,
    selected,
    canonicalIds: [...selected].sort((a, b) => order.get(a)! - order.get(b)!),
  };
}

/** Execute the selected approved checkpoint commands and build the existing
 *  private CheckpointReport shape. Never records events; callers own the
 *  lifecycle events so both the synchronous and operation paths stay
 *  single-authority. The optional operationId is embedded in the report so the
 *  terminal event can be matched back to its operation. */
export async function executeCheckpointCommands(
  task: TaskRecord,
  selected: readonly string[],
  attemptId: string,
  operationId?: string,
): Promise<CheckpointReport> {
  const { catalog } = resolveCheckpointSelection(task, { taskId: task.id, attemptId, commandIds: [...selected] });

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

  return {
    authority: "non-authoritative-checkpoint",
    attemptId,
    commands,
    patches,
    ...(operationId === undefined ? {} : { operationId }),
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

  const { selected } = resolveCheckpointSelection(task, request);

  store.addEvent(
    task.id,
    request.attemptId,
    "checkpoint.started",
    `Worker requested ${selected.length} approved checkpoint command(s)`,
    { commandIds: selected },
  );

  const report = await executeCheckpointCommands(task, selected, request.attemptId);
  store.addEvent(
    task.id,
    request.attemptId,
    "checkpoint.completed",
    `Non-authoritative checkpoint completed: ${report.commands.length} command(s)`,
    report,
  );
  return report;
}
