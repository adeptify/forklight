import type {
  RoutingAdvisoryResponse,
  RoutingCannotDetermineReason,
  RoutingOverallResult,
} from "../core/model-routing.js";
import type {
  CompetitionPolicyExplanation,
  ExecutionStrategyAdvice,
  JudgePolicyExplanation,
  MainDirectHistorySection,
  StrategyCannotDetermineReason,
  StrategyPolicyProjection,
} from "../core/strategy-advice.js";

function candidateLabel(candidate: RoutingAdvisoryResponse["candidates"][number]): string {
  return candidate.workerLabel
    ? `${candidate.workerLabel} (${candidate.provider}/${candidate.model})`
    : `${candidate.provider}/${candidate.model}`;
}

function overallResultLabel(result: RoutingOverallResult): string {
  switch (result) {
    case "recommended":
      return "recommended";
    case "historical-best-not-launchable":
      return "historical best not launchable";
    case "cannot-determine":
      return "cannot determine";
  }
}

function cannotDetermineReasonLabel(reason: RoutingCannotDetermineReason): string {
  switch (reason) {
    case "insufficient-relevant-samples":
      return "not enough comparable Tasks";
    case "single-comparable-identity":
      return "only one comparable Worker identity";
    case "no-active-factors":
      return "no active comparison factors";
    case "score-gap-too-small":
      return "top scores are too close";
    case "positive-factor-unavailable":
      return "required evidence is not comparable";
    case "profile-identity-unavailable":
      return "no single saved Worker Profile to execute";
  }
}

function strategyReasonLabel(reason: StrategyCannotDetermineReason): string {
  switch (reason) {
    case "insufficient-relevant-samples":
      return "not enough comparable Tasks";
    case "single-comparable-strategy":
      return "only one comparable execution strategy";
    case "incomplete-family-coverage":
      return "family coverage is incomplete";
    case "score-gap-too-small":
      return "strategy scores are too close";
    case "no-active-factors":
      return "no active comparison factors";
    case "positive-factor-unavailable":
      return "required evidence is not comparable";
  }
}

function formatStrategySection(strategy: ExecutionStrategyAdvice): string[] {
  const lines: string[] = [];
  if (strategy.determination === "recommendation" && strategy.recommendation) {
    const rec = strategy.recommendation;
    lines.push(
      `Execution strategy: ${rec.executionMode} for ${rec.provider}/${rec.model} (${rec.runtime}, ${rec.effort}); explanation only — nothing starts automatically.`,
    );
  } else {
    const why = strategy.reasons.length > 0
      ? ` (${strategy.reasons.map(strategyReasonLabel).join("; ")})`
      : "";
    lines.push(`Execution strategy: cannot determine${why}. Nothing starts automatically.`);
  }
  if (strategy.rows.length > 0) {
    for (const row of strategy.rows) {
      lines.push(
        `  Strategy ${row.provider}/${row.model} ${row.runtime}/${row.effort} ${row.executionMode}: samples=${row.relevantSampleCount} accepted=${row.acceptedDeliveryCount} ${row.compared ? "[compared]" : "[not compared]"}`,
      );
    }
  }
  return lines;
}

function formatCompetitionPolicySection(policy: CompetitionPolicyExplanation): string[] {
  if (policy.determination === "not-advised") {
    return [
      "Competition policy: not advised (Main intent is none). History does not start a Competition.",
    ];
  }
  if (policy.determination === "cannot-determine") {
    return [
      `Competition policy: cannot determine (${policy.reasons.join(", ")}). Explanation only; nothing starts automatically.`,
    ];
  }
  return [
    `Competition policy: historical explanation only (${policy.matchingCompetitionCount} matching). Main still decides; nothing starts automatically.`,
  ];
}

function formatJudgePolicySection(policy: JudgePolicyExplanation): string[] {
  const declared = policy.declaredRequiredJudges.present
    ? `declared requiredJudges=${policy.declaredRequiredJudges.depths.join(",")}`
    : "declared requiredJudges absent";
  if (policy.determination === "cannot-determine") {
    return [
      `Judge policy: cannot determine (${policy.reasons.join(", ")}); ${declared}. No vote and no inferred requirement.`,
    ];
  }
  return [
    `Judge policy: historical explanation only; ${declared}; usable=${policy.usableOutcomeCount} unusable=${policy.unusableOutcomeCount} distinct identities=${policy.distinctUnderlyingIdentityCount}. No vote.`,
  ];
}

function formatMainDirectSection(section: MainDirectHistorySection): string[] {
  if (!section.present) {
    return ["Main-direct history: none in this scope (never compared as Worker evidence)."];
  }
  return [
    `Main-direct history: ${section.recordCount} record(s) in this scope (not compared as Worker evidence).`,
  ];
}

function appendStrategyPolicy(lines: string[], projection: StrategyPolicyProjection | undefined): void {
  if (projection === undefined) return;
  lines.push(...formatStrategySection(projection.strategy));
  lines.push(...formatCompetitionPolicySection(projection.competitionPolicy));
  lines.push(...formatJudgePolicySection(projection.judgePolicy));
  lines.push(...formatMainDirectSection(projection.mainDirectHistory));
}

function appendExecutionLines(
  lines: string[],
  subject: {
    runtime?: string;
    effort?: string;
    executionPreference?: string;
    resolvedExecutionMode?: string;
    readinessState?: string;
    readinessReason?: string;
    canLaunch?: boolean;
    nextAction?: string;
  },
): void {
  if (subject.runtime !== undefined || subject.effort !== undefined) {
    lines.push(
      `  Runtime: ${subject.runtime ?? "n/a"} | effort: ${subject.effort ?? "n/a"}`,
    );
  }
  if (subject.resolvedExecutionMode !== undefined) {
    const preference = subject.executionPreference ?? subject.resolvedExecutionMode;
    lines.push(`  Execution: ${preference} -> ${subject.resolvedExecutionMode}`);
  }
  if (subject.readinessState !== undefined || subject.canLaunch !== undefined) {
    const launch = subject.canLaunch === undefined ? "n/a" : String(subject.canLaunch);
    const reason = subject.readinessReason === undefined ? "" : ` (${subject.readinessReason})`;
    lines.push(`  Readiness: ${subject.readinessState ?? "n/a"} [canLaunch=${launch}]${reason}`);
  }
  if (subject.nextAction !== undefined) {
    lines.push(`  Next action: ${subject.nextAction}`);
  }
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
    `Overall result: ${overallResultLabel(advisory.overallResult)}`,
    `Competition suggested: ${advisory.shouldRunCompetition ? "yes" : "no"}`,
  ];
  if (advisory.overallResult === "cannot-determine" && advisory.cannotDetermineReasons.length > 0) {
    lines.push(
      `Cannot determine because: ${advisory.cannotDetermineReasons.map(cannotDetermineReasonLabel).join("; ")}`,
    );
  }

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
    const heading = advisory.overallResult === "historical-best-not-launchable"
      ? "Historical recommendation"
      : "Recommendation";
    lines.push(
      `${heading}: ${label} (evidence separation ${Math.round(recommendation.confidence * 100)}%; covers ${coverage})`,
      `  Why: ${recommendation.reasoning}`,
    );
    if (recommendation.workerProfileId) {
      lines.push(`  Worker Profile: ${recommendation.workerProfileId}`);
    }
    appendExecutionLines(lines, recommendation);
    if (advisory.overallResult === "historical-best-not-launchable") {
      lines.push("  No substitute Worker was selected.");
    }
  } else {
    lines.push(
      advisory.overallResult === "cannot-determine"
        ? "Recommendation: cannot determine. ForkLight does not have enough comparable evidence to choose reliably."
        : "Recommendation: none yet. ForkLight does not have enough comparable evidence to choose reliably.",
    );
  }

  for (const candidate of advisory.candidates) {
    const compared = candidate.cohortParticipation === "compared";
    lines.push(
      `${candidateLabel(candidate)}: score=${candidate.totalScore} ${compared ? "[compared]" : "[not compared yet: insufficient evidence]"}`,
    );
    if (candidate.workerProfileId) lines.push(`  Worker Profile: ${candidate.workerProfileId}`);
    appendExecutionLines(lines, candidate);
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

  appendStrategyPolicy(lines, advisory.strategyPolicy);

  return `${lines.join("\n")}\n`;
}
