import type { StateStore } from "../state/store.js";
import type {
  IntegrationOperationView,
  IntegrationResultRecord,
  IntegrationStageEvidence,
} from "./types.js";

interface CompactIntegrationStage {
  stage: string;
  status: string;
  commandCount: number;
  failedCount: number;
  timedOutCount: number;
  totalDurationMs: number;
  error?: string;
}

interface CompactIntegrationResultSnapshot {
  status: string;
  error?: string;
  appliedAt?: string;
  createdAt: string;
}

export interface CompactIntegrationOperationView {
  operationId: string;
  taskId: string;
  receiptId: string;
  status: string;
  stages: CompactIntegrationStage[];
  result?: CompactIntegrationResultSnapshot;
}

export interface IntegrationOperationContext {
  operationId: string;
  taskId: string;
  receiptId: string;
}

function isStageEvidence(value: unknown): value is IntegrationStageEvidence {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<IntegrationStageEvidence>;
  return (
    (
      candidate.stage === "source-applied"
      || candidate.stage === "source-verified"
      || candidate.stage === "artifact-built"
      || candidate.stage === "runtime-activated"
    )
    && (
      candidate.status === "pending"
      || candidate.status === "passed"
      || candidate.status === "failed"
      || candidate.status === "not-applicable"
      || candidate.status === "outcome-unknown"
    )
  );
}

function terminalStatus(
  status: IntegrationResultRecord["status"],
): "completed" | "failed" {
  switch (status) {
    case "applied":
      return "completed";
    case "rejected":
    case "retained-failure":
    case "rolled-back":
      return "failed";
    default: {
      const exhaustiveStatus: never = status;
      throw new Error(`Unsupported Integration result status: ${exhaustiveStatus}`);
    }
  }
}

const ERROR_BOUND = 500;

function truncateError(value: string): string {
  return value.length <= ERROR_BOUND ? value : `${value.slice(0, ERROR_BOUND)}…`;
}

export function buildCompactIntegrationOperationView(
  view: IntegrationOperationView,
): CompactIntegrationOperationView {
  const stages = view.stages.map((stage) => {
    const commands = stage.commands ?? [];
    const stageCompact: CompactIntegrationOperationView["stages"][number] = {
      stage: stage.stage,
      status: stage.status,
      commandCount: commands.length,
      failedCount: commands.filter((c) => c.exitCode !== 0).length,
      timedOutCount: commands.filter((c) => c.timedOut).length,
      totalDurationMs: commands.reduce((sum, c) => sum + c.durationMs, 0),
    };
    if (stage.error !== undefined) stageCompact.error = truncateError(stage.error);
    return stageCompact;
  });
  const compact: CompactIntegrationOperationView = {
    operationId: view.operationId,
    taskId: view.taskId,
    receiptId: view.receiptId,
    status: view.status,
    stages,
  };
  if (view.result !== undefined) {
    compact.result = {
      status: view.result.status,
      createdAt: view.result.createdAt,
    };
    if (view.result.error !== undefined) compact.result.error = truncateError(view.result.error);
    if (view.result.appliedAt !== undefined) compact.result.appliedAt = view.result.appliedAt;
  }
  return compact;
}

export function buildIntegrationOperationView(
  store: StateStore,
  context: IntegrationOperationContext,
  active: boolean,
  timedOut = false,
): IntegrationOperationView {
  const result = store.getIntegrationResult(context.operationId);
  const stagesByName = new Map<string, IntegrationStageEvidence>();
  for (const event of store.listEvents(context.taskId)) {
    if (event.type !== "integration.stage.completed") continue;
    if (event.payload === null || typeof event.payload !== "object") continue;
    const payload = event.payload as {
      operationId?: unknown;
      evidence?: unknown;
    };
    if (payload.operationId !== context.operationId || !isStageEvidence(payload.evidence)) continue;
    stagesByName.set(payload.evidence.stage, payload.evidence);
  }
  const stages = result?.stages ?? [...stagesByName.values()];
  return {
    operationId: context.operationId,
    taskId: context.taskId,
    receiptId: context.receiptId,
    status: result !== undefined
      ? terminalStatus(result.status)
      : timedOut || !active
        ? "outcome-unknown"
        : "running",
    stages,
    ...(result === undefined ? {} : { result }),
  };
}
