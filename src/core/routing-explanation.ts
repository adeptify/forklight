/**
 * Privacy-safe pre-submit routing explanation.
 *
 * One pure projection that converts the immutable Task-file `routingDecision`
 * into a bounded, closed, serializable explanation of why the selected Worker
 * was chosen, how many candidates Main compared, what historical evidence
 * exists in aggregate, whether a Competition is recorded as planned, and the
 * frozen advisory/Main relationship when Main recorded one.
 *
 * Shared by CLI validate, daemon/MCP validate_file, and the Hub submit preview
 * so no surface ever re-derives the decision or duplicates Core inference.
 *
 * The projection never exposes selectedBecause.note, arbitrary custom reason
 * codes, raw candidate identity keys, settingsDigest, Task content, paths,
 * commands, logs, endpoints, credentials, or Provider responses. It is
 * detached from mutable Task data: the returned graph is a fresh, deeply
 * frozen copy that cannot pollute the TaskSpec or any other consumer.
 */

import type {
  CompetitionTrigger,
  FrozenRoutingAdvisorySnapshot,
  FrozenWorkerIdentity,
  RoutingDecisionSnapshot,
} from "./types.js";

/** Closed selection-basis category — the only reason vocabulary users see. */
export type RoutingSelectionBasis =
  | "user-specified"
  | "only-available"
  | "historical-evidence"
  | "runtime-capability"
  | "main-judgment"
  | "other";

/** Closed next-action code derived from the recorded Competition intent. */
export type RoutingExplanationNextAction =
  | "submit-directly"
  | "consider-competition"
  | "run-competition"
  | "not-recorded";

/** Aggregate evidence coverage — counts only, never raw candidate identity keys. */
export interface SafeRoutingEvidence {
  scope: "exact-class" | "task-family" | "none";
  /** Number of shortlisted Workers that had at least one recorded sample. */
  candidateCount: number;
  /** Total recorded samples across all shortlisted candidates. */
  totalSamples: number;
}

/** Closed Competition record — intent and bounded trigger codes only. */
export interface SafeRoutingCompetition {
  intent: "none" | "consider" | "required";
  triggers: CompetitionTrigger[];
}

/** Safe pre-submit routing explanation shared by CLI, daemon, MCP and Hub. */
export interface SafeRoutingExplanation {
  /** True when a frozen routingDecision exists before submission. */
  present: boolean;
  /** Resolved selected Worker identity that will run, with public label. */
  selectedWorker: {
    provider: string;
    model: string;
    runtime: string;
    effort: string;
    workerProfileId?: string;
    workerProfileLabel?: string;
  };
  /** Number of Workers Main actually considered. null when not recorded. */
  shortlistSize: number | null;
  /** Closed selection-basis category. null when not recorded. */
  basis: RoutingSelectionBasis | null;
  /** Aggregate evidence coverage. null when not recorded. */
  evidence: SafeRoutingEvidence | null;
  /** Competition intent and bounded triggers. null when not recorded. */
  competition: SafeRoutingCompetition | null;
  /** Closed next-action code. */
  nextAction: RoutingExplanationNextAction;
  /** Frozen advisory/Main relationship. null when the Task did not record one. */
  advisory: FrozenRoutingAdvisorySnapshot | null;
}

/** Bounded known reason-code map to the closed basis vocabulary. Custom codes
 *  collapse to "other" and never surface verbatim. */
const KNOWN_SELECTION_BASIS: Readonly<Record<string, RoutingSelectionBasis>> = {
  "user-specified": "user-specified",
  "only-available": "only-available",
  "relevant-delivery": "historical-evidence",
  "runtime-capability": "runtime-capability",
  "main-judgment": "main-judgment",
};

function nextActionForCompetition(
  intent: "none" | "consider" | "required",
): RoutingExplanationNextAction {
  switch (intent) {
    case "required":
      return "run-competition";
    case "consider":
      return "consider-competition";
    default:
      return "submit-directly";
  }
}

/** Aggregate evidence counts from the frozen sample map without reading keys.
 *  Corrupt or non-finite values are treated as zero so the projection never
 *  invents or leaks evidence. */
function aggregateSampleCounts(
  sampleMap: Record<string, number>,
): { candidateCount: number; totalSamples: number } {
  let candidateCount = 0;
  let totalSamples = 0;
  for (const raw of Object.values(sampleMap)) {
    const count = Number.isFinite(raw) && raw > 0 ? raw : 0;
    if (count > 0) candidateCount += 1;
    totalSamples += count;
  }
  return { candidateCount, totalSamples };
}

/** Freeze every object and array in the result graph so no caller can mutate a
 *  shared detached projection. The input routing decision is never mutated. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/**
 * Project the immutable routing decision into bounded user-facing facts.
 * Consumes the parsed routingDecision (optional), the resolved Worker identity
 * that will actually run, and an optional public Worker Profile label. Never
 * scans history, never reads mutable Task state, never mutates anything, and
 * never exposes private route fields.
 */
export function projectSafeRoutingExplanation(input: {
  routingDecision?: RoutingDecisionSnapshot;
  selectedWorker: { provider: string; model: string; runtime: string; effort: string };
  workerProfileId?: string;
  workerProfileLabel?: string;
}): SafeRoutingExplanation {
  const selectedWorker: SafeRoutingExplanation["selectedWorker"] = {
    provider: input.selectedWorker.provider,
    model: input.selectedWorker.model,
    runtime: input.selectedWorker.runtime,
    effort: input.selectedWorker.effort,
    ...(input.workerProfileId === undefined ? {} : { workerProfileId: input.workerProfileId }),
    ...(input.workerProfileLabel === undefined ? {} : { workerProfileLabel: input.workerProfileLabel }),
  };

  const decision = input.routingDecision;
  if (decision === undefined) {
    return deepFreeze({
      present: false,
      selectedWorker,
      shortlistSize: null,
      basis: null,
      evidence: null,
      competition: null,
      nextAction: "not-recorded",
      advisory: null,
    } satisfies SafeRoutingExplanation);
  }

  const scope = decision.evidenceSnapshot.scope;
  const sampleMap = scope === "task-family"
    ? (decision.evidenceSnapshot.familySampleCounts ?? decision.evidenceSnapshot.exactSampleCounts)
    : decision.evidenceSnapshot.exactSampleCounts;
  const { candidateCount, totalSamples } = aggregateSampleCounts(sampleMap);

  // A claim of historical support is only truthful when a comparable scope
  // actually carried positive samples. `relevant-delivery` with scope none or
  // zero samples degrades to Main judgment rather than inventing evidence.
  const comparableEvidence = scope !== "none" && totalSamples > 0;
  const basis: RoutingSelectionBasis =
    decision.selectedBecause.code === "relevant-delivery" && !comparableEvidence
      ? "main-judgment"
      : (KNOWN_SELECTION_BASIS[decision.selectedBecause.code] ?? "other");

  return deepFreeze({
    present: true,
    selectedWorker,
    shortlistSize: decision.shortlist.length,
    basis,
    evidence: { scope, candidateCount, totalSamples },
    competition: {
      intent: decision.competition.intent,
      triggers: [...decision.competition.triggers],
    },
    nextAction: nextActionForCompetition(decision.competition.intent),
    advisory: projectSafeAdvisory(decision.advisory),
  } satisfies SafeRoutingExplanation);
}

function copyFrozenIdentity(identity: FrozenWorkerIdentity): FrozenWorkerIdentity {
  return {
    provider: identity.provider,
    model: identity.model,
    runtime: identity.runtime,
    effort: identity.effort,
    ...(identity.workerProfileId === undefined
      ? {}
      : { workerProfileId: identity.workerProfileId }),
  };
}

/** Copy only the closed public advisory facts. Never invent a relationship. */
function projectSafeAdvisory(
  advisory: FrozenRoutingAdvisorySnapshot | undefined,
): FrozenRoutingAdvisorySnapshot | null {
  if (advisory === undefined) return null;
  return {
    overallResult: advisory.overallResult,
    selection: advisory.selection,
    ...(advisory.recommendedWorker === undefined
      ? {}
      : { recommendedWorker: copyFrozenIdentity(advisory.recommendedWorker) }),
    ...(advisory.confidence === undefined ? {} : { confidence: advisory.confidence }),
    ...(advisory.cannotDetermineReasons === undefined
      ? {}
      : { cannotDetermineReasons: [...advisory.cannotDetermineReasons] }),
    selectedExecution: { ...advisory.selectedExecution },
  };
}

/** Concise CLI lines for the safe routing explanation. Closed codes only. */
export function formatRoutingExplanationHuman(
  explanation: SafeRoutingExplanation,
): string {
  const lines: string[] = [];
  const selected = explanation.selectedWorker;
  const workerParts = [
    `${selected.provider}/${selected.model}`,
    `${selected.runtime}, ${selected.effort}`,
  ];
  const label = selected.workerProfileLabel ?? selected.workerProfileId;
  if (label !== undefined) workerParts.push(label);
  lines.push("Routing explanation:");
  lines.push(`  Selected: ${workerParts.join(" — ")}`);
  if (!explanation.present) {
    lines.push("  Selection reasoning was not recorded for this Task.");
    lines.push(
      "  The resolved Worker above still reflects the current Task and Settings.",
    );
    lines.push(`  Next action: ${explanation.nextAction}`);
    return lines.join("\n");
  }
  lines.push(`  Shortlist: ${explanation.shortlistSize} candidate(s) compared`);
  lines.push(`  Selection basis: ${explanation.basis ?? "not-recorded"}`);
  if (explanation.advisory != null) {
    const advisory = explanation.advisory;
    lines.push(`  Advisory result: ${advisory.overallResult}`);
    lines.push(`  Selection: ${advisory.selection}`);
    if (advisory.recommendedWorker !== undefined) {
      const recommended = advisory.recommendedWorker;
      lines.push(
        `  Recommended: ${recommended.provider}/${recommended.model} — ${recommended.runtime}, ${recommended.effort}`,
      );
    }
    if (advisory.confidence !== undefined) {
      lines.push(`  Confidence: ${advisory.confidence}`);
    }
    if (advisory.cannotDetermineReasons !== undefined) {
      lines.push(
        `  Cannot determine because: ${advisory.cannotDetermineReasons.join(", ")}`,
      );
    }
    const execution = advisory.selectedExecution;
    lines.push(`  Selected execution mode: ${execution.resolvedExecutionMode}`);
    lines.push(`  Selected readiness: ${execution.readinessState}`);
    lines.push(`  Can launch: ${execution.canLaunch ? "yes" : "no"}`);
    lines.push(`  Selected next action: ${execution.nextAction}`);
  }
  if (explanation.evidence !== null) {
    lines.push(`  Evidence scope: ${explanation.evidence.scope}`);
    lines.push(
      `  Evidence: ${explanation.evidence.candidateCount} candidate(s) with samples,`
      + ` ${explanation.evidence.totalSamples} total sample(s)`,
    );
  }
  if (explanation.competition !== null) {
    const triggers = explanation.competition.triggers.length > 0
      ? ` (${explanation.competition.triggers.join(", ")})`
      : "";
    lines.push(`  Competition intent: ${explanation.competition.intent}${triggers}`);
  }
  lines.push(`  Next action: ${explanation.nextAction}`);
  return lines.join("\n");
}
