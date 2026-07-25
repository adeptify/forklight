import type {
  EventRecord,
  RemediationPacket,
  VerificationCommandResult,
  VerificationResult,
} from "./types.js";
import { latestMainReview } from "./main-review.js";

const STDOUT_LIMIT = 12_000;
const STDERR_LIMIT = 6_000;

function tail(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(-limit);
}

function isVerificationCommandResult(value: unknown): value is VerificationCommandResult {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<VerificationCommandResult>;
  return typeof candidate.command === "string"
    && typeof candidate.exitCode === "number"
    && typeof candidate.stdout === "string"
    && typeof candidate.stderr === "string"
    && typeof candidate.durationMs === "number"
    && typeof candidate.timedOut === "boolean";
}

function isVerificationResult(value: unknown): value is VerificationResult {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<VerificationResult>;
  return typeof candidate.passed === "boolean"
    && typeof candidate.behaviorPassed === "boolean"
    && typeof candidate.policyPassed === "boolean"
    && typeof candidate.sourceCompatible === "boolean"
    && Array.isArray(candidate.commands)
    && candidate.commands.every(isVerificationCommandResult)
    && typeof candidate.diffPath === "string"
    && typeof candidate.sourceUnchanged === "boolean";
}

function changeBudgetFinding(verification: VerificationResult): string | undefined {
  const budget = verification.changeBudget;
  if (budget === undefined || budget.effect === undefined || budget.effect === "satisfied"
    || budget.effect === "ignored") {
    return undefined;
  }
  return `Change budget ${budget.effect}: ${budget.filesChanged}/${budget.maxFiles} files, `
    + `${budget.changedLines}/${budget.maxDiffLines} changed lines`;
}

export function buildRemediationPacket(
  events: readonly EventRecord[],
): RemediationPacket | undefined {
  const event = events
    .filter((candidate) => candidate.type === "verification.completed")
    .reduce<EventRecord | undefined>(
      (latest, candidate) => latest === undefined || candidate.sequence > latest.sequence
        ? candidate
        : latest,
      undefined,
    );
  if (event === undefined || !isVerificationResult(event.payload)) return undefined;

  const verification = event.payload;
  const passedChecks = verification.commands
    .filter((command) => command.exitCode === 0 && !command.timedOut)
    .map((command) => `Command passed: ${command.command}`);
  if (verification.behaviorPassed) passedChecks.push("All acceptance commands passed");
  if (verification.policyPassed) passedChecks.push("Policy checks passed");
  if (verification.sourceCompatible) passedChecks.push("Affected source paths are compatible");

  const policyFindings: string[] = [];
  const budgetFinding = changeBudgetFinding(verification);
  if (budgetFinding !== undefined) policyFindings.push(budgetFinding);
  const completionPolicy = verification.completionPolicy;
  if (
    completionPolicy !== undefined
    && completionPolicy.check !== "satisfied"
    && completionPolicy.check !== "ignored"
    && completionPolicy.check !== "not-applicable"
  ) {
    policyFindings.push(`Completion policy ${completionPolicy.check}: ${completionPolicy.message}`);
  }
  if (!verification.policyPassed && policyFindings.length === 0) {
    policyFindings.push("Policy verification failed without a structured finding");
  }

  const review = latestMainReview(events);
  return {
    verificationEventSequence: event.sequence,
    passedChecks,
    failedCommands: verification.commands.filter(
      (command) => command.exitCode !== 0 || command.timedOut,
    ),
    policyFindings,
    sourceConflicts: verification.sourceCompatibility?.conflictingPaths ?? [],
    ...(review === undefined ? {} : {
      mainReview: { decision: review.decision, reason: review.reason },
    }),
  };
}

export function formatRemediationPacket(packet: RemediationPacket): string {
  const sections = [
    `Independent verification remediation (event #${packet.verificationEventSequence})`,
  ];

  if (packet.failedCommands.length > 0) {
    const failures = packet.failedCommands.map((command) => {
      const details = [
        `Command: ${command.command}`,
        `Exit code: ${command.exitCode}${command.timedOut ? " (timed out)" : ""}`,
        command.stdout ? `stdout:\n${tail(command.stdout, STDOUT_LIMIT)}` : "",
        command.stderr ? `stderr:\n${tail(command.stderr, STDERR_LIMIT)}` : "",
      ].filter(Boolean);
      return details.join("\n");
    });
    sections.push(`Failed commands:\n${failures.join("\n\n")}`);
  }
  if (packet.policyFindings.length > 0) {
    sections.push(`Policy findings:\n${packet.policyFindings.map((finding) => `- ${finding}`).join("\n")}`);
  }
  if (packet.sourceConflicts.length > 0) {
    sections.push(
      `Source conflicts:\n${packet.sourceConflicts.map((conflict) => `- ${conflict}`).join("\n")}`,
    );
  }
  if (packet.passedChecks.length > 0) {
    sections.push(`Checks already passed:\n${packet.passedChecks.map((check) => `- ${check}`).join("\n")}`);
  }
  if (packet.mainReview !== undefined) {
    sections.push(
      `Main agent review: ${packet.mainReview.decision}\nReason: ${packet.mainReview.reason}`,
    );
  }

  return sections.join("\n\n");
}
