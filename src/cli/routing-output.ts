import type { RoutingAdvisoryResponse } from "../core/model-routing.js";

function candidateLabel(candidate: RoutingAdvisoryResponse["candidates"][number]): string {
  return candidate.workerLabel
    ? `${candidate.workerLabel} (${candidate.provider}/${candidate.model})`
    : `${candidate.provider}/${candidate.model}`;
}

/** Human-readable routing advice for operators. JSON remains the canonical
 * machine surface; this view explains what was and was not compared without
 * turning missing history into a negative quality judgment. */
export function formatRoutingAdviceHuman(advisory: RoutingAdvisoryResponse): string {
  const lines: string[] = [
    `Work type: ${advisory.taskClass}`,
    ...(advisory.taskFamily ? [`Related work family: ${advisory.taskFamily}`] : []),
    `Evidence used: ${advisory.evidenceScope}`,
    `What ForkLight knows: ${advisory.knowledge}`,
    `Competition suggested: ${advisory.shouldRunCompetition ? "yes" : "no"}`,
  ];

  if (advisory.competition.matchingTriggers.length > 0) {
    lines.push(`Competition reasons: ${advisory.competition.matchingTriggers.join(", ")}`);
  }

  if (advisory.evidenceScope !== "none" && advisory.totalCandidateCount > 0) {
    if (advisory.allCandidatesCompared) {
      lines.push(
        `Comparison: all ${advisory.totalCandidateCount} candidate(s) had enough comparable history.`,
      );
    } else {
      lines.push(
        `Comparison: ${advisory.cohortCandidateCount} of ${advisory.totalCandidateCount} candidate(s) had enough comparable history; ${advisory.excludedCandidateCount} not included yet.`,
      );
    }
  }

  if (advisory.recommendation) {
    const recommendation = advisory.recommendation;
    const label = recommendation.workerLabel
      ? `${recommendation.workerLabel} (${recommendation.provider}/${recommendation.model})`
      : `${recommendation.provider}/${recommendation.model}`;
    const coverage = recommendation.coverage === "all-candidates"
      ? "all requested candidates"
      : "only the candidates with enough comparable history";
    lines.push(
      `Recommendation: ${label} (evidence separation ${Math.round(recommendation.confidence * 100)}%; covers ${coverage})`,
      `  Why: ${recommendation.reasoning}`,
    );
    if (recommendation.workerProfileId) {
      lines.push(`  Worker Profile: ${recommendation.workerProfileId}`);
    }
  } else {
    lines.push("Recommendation: none yet. ForkLight does not have enough comparable evidence to choose reliably.");
  }

  for (const candidate of advisory.candidates) {
    const compared = candidate.cohortParticipation === "compared";
    lines.push(
      `${candidateLabel(candidate)}: score=${candidate.totalScore} ${compared ? "[compared]" : "[not compared yet: insufficient evidence]"}`,
    );
    if (candidate.workerProfileId) lines.push(`  Worker Profile: ${candidate.workerProfileId}`);
    const evidence = candidate.comparisonEvidence;
    lines.push(
      `  Comparable Tasks: ${evidence.relevantSampleCount} | quality-related failures: ${evidence.modelQualityFailureCount} | accepted deliveries: ${(evidence.acceptedDeliveryRate * 100).toFixed(1)}%`,
    );
    const nonModel = Object.entries(evidence.ignoredNonModelFailures);
    if (nonModel.length > 0) {
      lines.push(`  Failures not attributed to this Worker: ${nonModel.map(([key, value]) => `${key}=${value}`).join(", ")}`);
    }
    const uncertainty: string[] = [];
    if (candidate.uncertainty.insufficientSamples) uncertainty.push("not enough comparable Tasks");
    if (candidate.uncertainty.insufficientGap) uncertainty.push("top scores are too close");
    if (candidate.uncertainty.incompatibleCost) uncertainty.push("cost records cannot be compared");
    if (uncertainty.length > 0) lines.push(`  Uncertainty: ${uncertainty.join(", ")}`);
    for (const factor of candidate.factors) {
      lines.push(
        `  ${factor.available ? "yes" : "no"} ${factor.factor}: raw=${factor.rawValue ?? "n/a"} normalized=${factor.normalizedScore.toFixed(3)} weighted=${factor.weightedScore.toFixed(3)} weight=${factor.weight}${!factor.available && factor.unavailableReason ? ` (${factor.unavailableReason})` : ""}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}
