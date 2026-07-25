import type { StateStore } from "../state/store.js";
import { cloneDefaults } from "./settings.js";
import { isTerminalTaskStatus } from "./task-progress.js";
import type {
  AttemptAuthorization,
  AttemptExecutionOptions,
  TaskRecord,
} from "./types.js";

const REASON_MAX_LENGTH = 1000;

function eligibleStatus(task: TaskRecord): boolean {
  return isTerminalTaskStatus(task.status);
}

export function authorizeExtraAttempt(
  store: StateStore,
  taskId: string,
  authorization: AttemptAuthorization,
  configuredMaxAttempts: number,
  maximumBudgetUsd = cloneDefaults().execution.maximumBudgetUsd,
): AttemptExecutionOptions {
  if (authorization.additionalAttempts !== 1) {
    throw new Error("attempt authorization additionalAttempts must equal 1");
  }
  if (authorization.confirm !== true) {
    throw new Error("attempt authorization requires confirm: true");
  }
  const reason = authorization.reason.trim();
  if (reason.length < 1 || reason.length > REASON_MAX_LENGTH) {
    throw new Error(`attempt authorization reason must be 1-${REASON_MAX_LENGTH} characters`);
  }
  const budget = authorization.maxBudgetUsd;
  if (budget !== null && (!Number.isFinite(budget) || budget <= 0)) {
    throw new Error("attempt authorization maxBudgetUsd must be null or a finite positive number");
  }
  if (budget !== null && budget > maximumBudgetUsd) {
    throw new Error(
      `attempt authorization maxBudgetUsd must not exceed execution.maximumBudgetUsd (${maximumBudgetUsd})`,
    );
  }

  const task = store.getTask(taskId);
  if (!eligibleStatus(task)) {
    throw new Error(`Task ${taskId} cannot authorize an extra attempt from status ${task.status}`);
  }
  const attempts = store.listAttempts(taskId);
  if (attempts.length !== configuredMaxAttempts) {
    throw new Error(
      `Task ${taskId} must have exactly ${configuredMaxAttempts} attempts before extra authorization`,
    );
  }
  if (store.listEvents(taskId).some((event) => event.type === "attempt.authorization.granted")) {
    throw new Error(`Task ${taskId} already received its one extra attempt authorization`);
  }

  const targetOrdinal = configuredMaxAttempts + 1;
  const event = store.addEvent(
    taskId,
    task.currentAttemptId,
    "attempt.authorization.granted",
    `One extra Attempt authorized for ordinal ${targetOrdinal}`,
    {
      additionalAttempts: 1,
      targetOrdinal,
      maxBudgetUsd: budget,
      budgetMode: budget === null ? "uncapped-for-authorized-attempt" : "capped-for-authorized-attempt",
      reason,
    },
  );
  return {
    maximumOrdinal: targetOrdinal,
    maxBudgetUsdOverride: budget,
    authorizationEventSequence: event.sequence,
  };
}
