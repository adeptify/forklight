import type { StateStore } from "../state/store.js";
import type {
  IntegrationOperationView,
  IntegrationStageEvidence,
} from "./types.js";

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
      ? "completed"
      : timedOut || !active
        ? "outcome-unknown"
        : "running",
    stages,
    ...(result === undefined ? {} : { result }),
  };
}
