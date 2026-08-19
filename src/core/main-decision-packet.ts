/**
 * Canonical privacy-safe Main decision packet.
 *
 * Composes closed outputs from existing resolvers. Never mutates, never
 * authorizes, never launches work, and never reimplements eligibility.
 */
import type { StateStore } from "../state/store.js";
import { resolveHandoffViewForTask } from "./candidate-handoff.js";
import {
  resolveCorrectionEligibility,
  resolveLatestRevision,
  summarizeRevision,
} from "./candidate-revision.js";
import {
  executionModeFromTaskSpec,
  executionPreferenceFromTaskSpec,
} from "./execution-mode.js";
import {
  evaluateReviewRequirementForTask,
  PENDING_REVIEW_BLOCKS_INTEGRATION,
  readReviewGraphView,
  REQUIRED_REVIEW_GRAPH_MISSING,
  STALE_MAIN_ACCEPT_AFTER_REVIEW,
} from "./review-graph.js";
import { buildTaskDecisionView } from "./task-decision-view.js";
import type {
  CandidateHandoffView,
  CandidateRevisionSummary,
  CorrectionEligibility,
  EventRecord,
  MainDecisionNextActionCode,
  MainDecisionPacket,
  MainDecisionStopCode,
  MainDecisionWorkspaceDisposition,
  ReviewGraphView,
  ReviewRequirementGate,
  TaskDecisionView,
  TaskRecord,
} from "./types.js";

export const MAIN_DECISION_PACKET_KIND = "main-decision-packet" as const;

export interface MainDecisionPacketInput {
  task: TaskRecord;
  decision: TaskDecisionView;
  events?: readonly EventRecord[];
  reviewGate?: ReviewRequirementGate;
  reviewGraph?: ReviewGraphView;
  correction?: CorrectionEligibility;
  handoff?: CandidateHandoffView;
  candidateRevision?: CandidateRevisionSummary;
}

function compactGate(gate: ReviewRequirementGate): ReviewRequirementGate {
  return {
    declared: gate.declared,
    status: gate.status,
    assigned: gate.assigned,
    terminal: gate.terminal,
    usableTerminal: gate.usableTerminal,
    missingOpinions: gate.missingOpinions,
    blocksIntegration: gate.blocksIntegration,
    rejectionReasons: [...gate.rejectionReasons],
    ...(gate.requiredJudges === undefined ? {} : { requiredJudges: gate.requiredJudges }),
    ...(gate.reason === undefined ? {} : { reason: gate.reason }),
    ...(gate.currentRevisionId === undefined ? {} : { currentRevisionId: gate.currentRevisionId }),
    ...(gate.graphRevisionId === undefined ? {} : { graphRevisionId: gate.graphRevisionId }),
  };
}

function undeclaredGate(): ReviewRequirementGate {
  return {
    declared: false,
    status: "not-declared",
    assigned: 0,
    terminal: 0,
    usableTerminal: 0,
    missingOpinions: 0,
    blocksIntegration: false,
    rejectionReasons: [],
  };
}

/** When callers omit a store-backed gate, project only the frozen Task field.
 *  Nonzero requirements fail closed to missing rather than inventing a graph. */
function gateFromTask(
  task: TaskRecord,
  provided?: ReviewRequirementGate,
): ReviewRequirementGate {
  if (provided !== undefined) return provided;
  const requirement = task.spec.reviewRequirement;
  if (requirement === undefined) return undeclaredGate();
  if (requirement.requiredJudges === 0) {
    return {
      ...undeclaredGate(),
      declared: true,
      status: "explicit-skip",
      requiredJudges: 0,
      reason: requirement.reason,
    };
  }
  return {
    ...undeclaredGate(),
    declared: true,
    status: "missing",
    requiredJudges: requirement.requiredJudges,
    reason: requirement.reason,
    missingOpinions: requirement.requiredJudges,
    blocksIntegration: true,
    rejectionReasons: [REQUIRED_REVIEW_GRAPH_MISSING],
  };
}

function noProgressStop(events: readonly EventRecord[] | undefined): boolean {
  if (events === undefined) return false;
  return events.filter((event) => event.type === "policy.noprogress.exceeded").length >= 2;
}

function stopFromFacts(input: {
  decision: TaskDecisionView;
  events?: readonly EventRecord[];
}): { code: MainDecisionStopCode; detail?: string } {
  const repair = input.decision.validationRepair;
  if (repair?.stopReason === "repeated-evidence") {
    return { code: "repeated-evidence", detail: repair.stopReason };
  }
  if (repair?.stopReason === "allowance-exhausted" || repair?.stopReason === "allowance-disabled") {
    return { code: "repair-exhausted", detail: repair.stopReason };
  }
  if (repair?.stopReason === "contract-infeasible") {
    return { code: "boundary", detail: repair.stopReason };
  }
  if (noProgressStop(input.events)) {
    return { code: "no-progress", detail: "policy.noprogress.exceeded" };
  }
  if (input.decision.stage === "main-rejected") {
    return { code: "main-rejected" };
  }
  if (input.decision.stage === "machine-failed") {
    return { code: "verification-failed" };
  }
  return { code: "none" };
}

function workspaceDisposition(
  decision: TaskDecisionView,
  gate: ReviewRequirementGate,
  hasReusablePartial: boolean,
): MainDecisionWorkspaceDisposition {
  if (decision.stage === "delivered" || decision.stage === "activated") return "delivered";
  if (
    decision.stage === "queued"
    || decision.stage === "worker-running"
    || decision.stage === "integrating"
  ) {
    return "protect-running";
  }
  if (
    gate.blocksIntegration
    || gate.status === "missing"
    || gate.status === "undersized"
    || gate.status === "pending"
    || gate.status === "stale"
    || gate.status === "stale-main-accept"
    || decision.stage === "awaiting-main-review"
    || decision.stage === "ready-for-integration"
    || decision.stage === "applied-not-activated"
  ) {
    return gate.status === "missing" || gate.status === "undersized" || gate.status === "pending"
      || gate.status === "stale" || gate.status === "stale-main-accept"
      ? "protect-review"
      : "protect-candidate";
  }
  if (decision.stage === "machine-failed" || decision.stage === "revision-requested") {
    return hasReusablePartial ? "protect-reusable-partial" : "unspecified";
  }
  if (decision.stage === "integration-failed" || decision.stage === "main-rejected") {
    return hasReusablePartial ? "protect-reusable-partial" : "protect-candidate";
  }
  return "unspecified";
}

function nextActionFromFacts(input: {
  decision: TaskDecisionView;
  gate: ReviewRequirementGate;
  correction?: CorrectionEligibility;
  hasReusablePartial: boolean;
  stop: { code: MainDecisionStopCode };
}): { nextActionCode: MainDecisionNextActionCode; nextAction: string } {
  const { decision, gate } = input;
  if (decision.stage === "integrating") {
    return {
      nextActionCode: "wait-for-integration",
      nextAction: decision.nextAction,
    };
  }
  if (decision.stage === "integration-failed") {
    return {
      nextActionCode: "inspect-integration-failure",
      nextAction: decision.nextAction,
    };
  }
  if (decision.stage === "delivered" || decision.stage === "activated") {
    return { nextActionCode: "none", nextAction: decision.nextAction };
  }
  if (decision.stage === "queued") {
    return { nextActionCode: "wait-for-worker", nextAction: decision.nextAction };
  }
  if (decision.stage === "worker-running") {
    return { nextActionCode: "wait-for-verification", nextAction: decision.nextAction };
  }

  if (decision.stage === "machine-failed") {
    const repair = decision.validationRepair;
    if (repair?.inProgress === true) {
      return {
        nextActionCode: "wait-for-verification",
        nextAction: "Wait for the in-progress same-Worker validation repair to finish",
      };
    }
    const hardStop = input.stop.code === "no-progress"
      || input.stop.code === "repair-exhausted"
      || input.stop.code === "repeated-evidence"
      || input.stop.code === "boundary"
      || input.stop.code === "main-rejected";
    if (repair?.enabled === true && repair.allowance.remaining > 0 && !hardStop) {
      return {
        nextActionCode: "continue-same-worker",
        nextAction: "Same-Worker validation repair remains available; Main may continue that Session",
      };
    }
    if (input.correction?.eligible === true) {
      return {
        nextActionCode: "continue-same-worker",
        nextAction: "Structured correction is eligible; Main may reuse retained Candidate paths",
      };
    }
    if (input.hasReusablePartial) {
      return {
        nextActionCode: "handoff-or-stop",
        nextAction:
          "Reusable Candidate paths remain. Main must choose an explicit handoff or stop; nothing starts automatically",
      };
    }
    if (input.stop.code !== "none") {
      return {
        nextActionCode: "stop-or-decide",
        nextAction:
          "Automatic repair stopped. Main must decide from the preserved output, gaps, and stop reason",
      };
    }
    return {
      nextActionCode: "inspect-verification-failure",
      nextAction: decision.nextAction,
    };
  }

  if (decision.stage === "revision-requested") {
    return {
      nextActionCode: "continue-same-worker",
      nextAction: decision.nextAction,
    };
  }
  if (decision.stage === "main-rejected") {
    return {
      nextActionCode: "stop-or-decide",
      nextAction: decision.nextAction,
    };
  }

  // Honor every canonical Review Graph blocker, including a graph that exists
  // on a legacy or explicit-skip Task. Never recommend Integration while the
  // same reasons would reject Integration preflight.
  const reasons = gate.rejectionReasons;
  const pendingBlocks = gate.status === "pending"
    || reasons.includes(PENDING_REVIEW_BLOCKS_INTEGRATION);
  if (pendingBlocks) {
    const missing = gate.missingOpinions;
    return {
      nextActionCode: "wait-for-judges",
      nextAction: missing > 0
        ? `Waiting for ${missing} required independent Judge(s) to finish. Integration stays blocked`
        : "Waiting for the required Review Graph to become terminal. Integration stays blocked",
    };
  }
  if (
    gate.status === "missing"
    || gate.status === "undersized"
    || gate.status === "stale"
  ) {
    const needed = gate.requiredJudges ?? 0;
    const missing = gate.missingOpinions;
    const staleNote = gate.status === "stale"
      ? " The existing Review Graph is not bound to the current exact Candidate Revision."
      : "";
    return {
      nextActionCode: "await-required-review",
      nextAction: missing > 0
        ? `Candidate awaits ${missing} missing independent opinion(s) of ${needed} required. Integration stays blocked.${staleNote}`
        : `Declared review evidence is not usable on the current exact Candidate Revision. Integration stays blocked.${staleNote}`,
    };
  }
  const needsFreshMain = gate.status === "stale-main-accept"
    || reasons.includes(STALE_MAIN_ACCEPT_AFTER_REVIEW);
  if (needsFreshMain) {
    return {
      nextActionCode: "record-fresh-main-review",
      nextAction:
        "Required Review Graph is terminal. Record a fresh Main accept after that review before Integration",
    };
  }
  if (gate.blocksIntegration && reasons.length > 0) {
    return {
      nextActionCode: "await-required-review",
      nextAction:
        "Canonical Review Graph evidence still blocks Integration. Resolve the listed blockers before proceeding",
    };
  }
  if (decision.stage === "awaiting-main-review") {
    if (gate.status === "explicit-skip" || gate.requiredJudges === 0) {
      return {
        nextActionCode: "record-main-review",
        nextAction:
          "Independent verification passed with an explicit Judge skip. Main Review is still required; no Judge was assigned",
      };
    }
    return {
      nextActionCode: "record-main-review",
      nextAction: decision.nextAction,
    };
  }
  if (decision.stage === "ready-for-integration" || decision.stage === "applied-not-activated") {
    return {
      nextActionCode: "ready-for-integration",
      nextAction: decision.nextAction,
    };
  }
  return {
    nextActionCode: "stop-or-decide",
    nextAction: decision.nextAction,
  };
}

/** Compose one bounded packet from already-resolved canonical facts. */
export function buildMainDecisionPacket(input: MainDecisionPacketInput): MainDecisionPacket {
  const gate = compactGate(gateFromTask(input.task, input.reviewGate));
  const decision = input.decision;
  const verification = decision.verification;
  const candidate = input.candidateRevision;
  const handoff = input.handoff;
  const hasReusablePartial = (handoff !== undefined && handoff.reusablePathCount > 0)
    || (candidate !== undefined && candidate.filesChanged > 0);
  const stop = stopFromFacts({ decision, ...(input.events === undefined ? {} : { events: input.events }) });
  const next = nextActionFromFacts({
    decision,
    gate,
    ...(input.correction === undefined ? {} : { correction: input.correction }),
    hasReusablePartial,
    stop,
  });
  return {
    schemaVersion: 1,
    kind: MAIN_DECISION_PACKET_KIND,
    taskId: input.task.id,
    execution: {
      preference: executionPreferenceFromTaskSpec(input.task.spec),
      mode: executionModeFromTaskSpec(input.task.spec),
    },
    workerClaim: decision.workerClaim === undefined
      ? { present: false }
      : { present: true, label: "unverified-claim" },
    verification: verification === undefined
      ? { present: false }
      : {
        present: true,
        passed: verification.passed,
        behaviorPassed: verification.behaviorPassed,
        policyPassed: verification.policyPassed,
        sourceCompatible: verification.sourceCompatible,
        commandCount: verification.commands.length,
        failedCommandCount: verification.commands.filter(
          (command) => command.exitCode !== 0 || command.timedOut,
        ).length,
      },
    ...(decision.validationRepair === undefined
      ? {}
      : {
        validationRepair: {
          enabled: decision.validationRepair.enabled,
          remaining: decision.validationRepair.allowance.remaining,
          consumed: decision.validationRepair.allowance.consumed,
          inProgress: decision.validationRepair.inProgress,
          ...(decision.validationRepair.stopReason === undefined
            ? {}
            : { stopReason: decision.validationRepair.stopReason }),
        },
      }),
    ...(input.correction === undefined
      ? {}
      : {
        correction: {
          eligible: input.correction.eligible,
          category: input.correction.category,
          remaining: input.correction.allowance.remaining,
        },
      }),
    review: {
      ...gate,
      ...(input.reviewGraph === undefined
        ? {}
        : {
          aggregationState: input.reviewGraph.aggregation.state,
          dispositionCounts: { ...input.reviewGraph.aggregation.dispositionCounts },
        }),
    },
    ...(candidate === undefined
      ? {}
      : {
        candidate: {
          revisionId: candidate.id,
          digestPrefix: candidate.digestPrefix,
          filesChanged: candidate.filesChanged,
          changedLines: candidate.changedLines,
          affectedPathCount: candidate.affectedPathCount,
          verificationPassed: candidate.verificationPassed,
        },
      }),
    ...(handoff === undefined
      ? {}
      : {
        reuse: {
          reusablePathCount: handoff.reusablePathCount,
          remainingGapCount: handoff.remainingGapCount,
          reusablePaths: [...handoff.reusablePaths],
          remainingGaps: handoff.remainingGaps.map((gap) => ({
            description: gap.description,
            acceptanceExpectation: gap.acceptanceExpectation,
          })),
          handoffStatus: handoff.status,
          handoffNextAction: handoff.nextAction,
        },
      }),
    ...(decision.mainReview === undefined
      ? {}
      : {
        mainReview: {
          decision: decision.mainReview.decision,
          boundToCurrentVerification: true,
        },
      }),
    ...(decision.integration === undefined
      ? {}
      : {
        integration: {
          present: true,
          status: decision.integration.status,
          ...(decision.integration.result === undefined
            ? {}
            : { resultStatus: decision.integration.result.status }),
        },
      }),
    blockers: [...gate.rejectionReasons],
    stop,
    workspaceDisposition: workspaceDisposition(decision, gate, hasReusablePartial),
    nextAction: next.nextAction,
    nextActionCode: next.nextActionCode,
    attempts: {
      count: decision.lineage.attemptCount,
      correctionCount: decision.lineage.correctionAttemptIds.length,
    },
  };
}

/** Store-backed packet. Read-only: never reconciles, never mutates. */
export function buildMainDecisionPacketForTask(
  store: StateStore,
  taskId: string,
  decision?: TaskDecisionView,
): MainDecisionPacket {
  const task = store.getTask(taskId);
  const attempts = store.listAttempts(taskId);
  const events = store.listEvents(taskId);
  const integrationResults = store.listIntegrationResults(taskId);
  const view = decision ?? buildTaskDecisionView({
    task,
    attempts,
    events,
    integrationResults,
  });
  const latestRevision = resolveLatestRevision(events);
  return buildMainDecisionPacket({
    task,
    decision: view,
    events,
    reviewGate: evaluateReviewRequirementForTask(store, taskId),
    ...((): { reviewGraph?: ReviewGraphView } => {
      const graph = readReviewGraphView(store, taskId);
      return graph === undefined ? {} : { reviewGraph: graph };
    })(),
    correction: resolveCorrectionEligibility(store, taskId),
    ...((): { handoff?: CandidateHandoffView } => {
      const handoff = resolveHandoffViewForTask(store, taskId);
      return handoff === undefined ? {} : { handoff };
    })(),
    ...(latestRevision === undefined ? {} : { candidateRevision: summarizeRevision(latestRevision) }),
  });
}

/** Concise human rendering. Closed codes and counts only. */
export function formatMainDecisionPacketHuman(packet: MainDecisionPacket): string {
  const lines: string[] = [];
  lines.push(`decisionPacket: ${packet.nextActionCode}`);
  lines.push(`packetNextAction: ${packet.nextAction}`);
  if (packet.review.declared && packet.review.requiredJudges !== undefined) {
    if (packet.review.requiredJudges === 0) {
      lines.push(`reviewRequirement: explicit skip (0) — ${packet.review.reason ?? ""}`.trimEnd());
    } else {
      lines.push(
        `reviewRequirement: ${packet.review.requiredJudges} judge(s) status=${packet.review.status}`
        + ` usable=${packet.review.usableTerminal} missing=${packet.review.missingOpinions}`,
      );
    }
  } else {
    lines.push("reviewRequirement: legacy (none declared)");
  }
  if (packet.review.aggregationState !== undefined) {
    lines.push(`reviewGraph: ${packet.review.aggregationState}`);
  }
  if (packet.blockers.length > 0) {
    lines.push(`packetBlockers: ${packet.blockers.length}`);
    for (const blocker of packet.blockers) {
      lines.push(`  - ${blocker}`);
    }
  }
  if (packet.stop.code !== "none") {
    lines.push(
      packet.stop.detail === undefined
        ? `stop: ${packet.stop.code}`
        : `stop: ${packet.stop.code} (${packet.stop.detail})`,
    );
  }
  lines.push(`workspaceDisposition: ${packet.workspaceDisposition}`);
  if (packet.candidate !== undefined) {
    lines.push(
      `candidate: revision=${packet.candidate.digestPrefix}`
      + ` files=${packet.candidate.filesChanged} lines=${packet.candidate.changedLines}`,
    );
  }
  if (packet.reuse !== undefined) {
    lines.push(
      `reuse: paths=${packet.reuse.reusablePathCount} gaps=${packet.reuse.remainingGapCount}`,
    );
  }
  return lines.join("\n");
}
