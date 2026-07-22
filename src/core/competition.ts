import { randomUUID } from "node:crypto";
import { cp, mkdir, rm } from "node:fs/promises";
import { lstatSync } from "node:fs";
import path from "node:path";
import type { StateStore } from "../state/store.js";
import type { CompetitionSettings, ForkLightSettings, SettingsService } from "./settings.js";
import { verificationFrom, type TaskEvidence } from "./statistics.js";
import { buildManifest, prepareWorkspace } from "../workspace/copy.js";
import { buildTaskRecord } from "./runner.js";
import { taskPaths } from "./config.js";
import { isProviderName, providerNames } from "./providers.js";
import type {
  CompetitionCandidateRecord,
  CompetitionCandidateScore,
  CompetitionEvaluationRecord,
  CompetitionFactorScore,
  CompetitionRecord,
  RankingFactor,
  RankingPolicy,
  StagedTaskRegistration,
  TaskRecord,
  TaskSpec,
  TaskStatus,
  VerificationResult,
} from "./types.js";

export const DEFAULT_RANKING_POLICY: RankingPolicy = {
  weights: {
    verification: 1,
    diffFocus: 0.3,
    retries: 0.2,
    cost: 0,
    duration: 0,
  },
  tieThreshold: 1e-9,
};

export type RankingPolicyOverride = Partial<Record<RankingFactor, number>>;

export interface CandidateOverride {
  providerName: string;
  modelName: string;
  maxBudgetUsd?: number;
}

export interface CompetitionCandidateInput {
  candidateId: string;
  taskId: string;
  providerName: string;
  modelName: string;
  evidence: TaskEvidence;
}

interface CandidateMetrics {
  candidate: CompetitionCandidateInput;
  eligible: boolean;
  reason?: string;
  diffFocus?: number;
  retries: number;
  cost?: number;
  duration?: number;
}

const TERMINAL = new Set<TaskStatus>(["succeeded", "failed", "interrupted"]);

export function rankingPolicy(
  override: RankingPolicyOverride = {},
  settings?: CompetitionSettings,
): RankingPolicy {
  const defaultWeights = settings?.rankingWeights ?? DEFAULT_RANKING_POLICY.weights;
  const weights = { ...defaultWeights, ...override };
  for (const [factor, weight] of Object.entries(weights)) {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new Error(`Ranking weight ${factor} must be a finite non-negative number`);
    }
  }
  if (weights.verification <= 0) {
    throw new Error("Verification must retain a positive ranking weight");
  }
  return {
    weights,
    tieThreshold: settings?.tieThreshold ?? DEFAULT_RANKING_POLICY.tieThreshold,
  };
}

function verificationFailure(verification: VerificationResult): string {
  const budget = verification.changeBudget;
  if (budget && !budget.withinBudget) {
    return `Change budget exceeded: ${budget.filesChanged}/${budget.maxFiles} files, ${budget.changedLines}/${budget.maxDiffLines} lines`;
  }
  const command = verification.commands.find((candidate) => candidate.exitCode !== 0);
  if (command) return `Verification failed: ${command.command} (exit ${command.exitCode})`;
  if (!verification.sourceUnchanged) return "Verification failed: source changed outside isolation";
  return "Independent verification failed";
}

function completeTotal(
  evidence: TaskEvidence,
  metric: "costUsd" | "turns",
): number | undefined {
  if (
    evidence.attempts.length === 0
    || evidence.attempts.some((attempt) => attempt[metric] === undefined)
  ) {
    return undefined;
  }
  return evidence.attempts.reduce((total, attempt) => total + (attempt[metric] ?? 0), 0);
}

function metrics(input: CompetitionCandidateInput): CandidateMetrics {
  const { task, verification } = input.evidence;
  let reason: string | undefined;
  if (!TERMINAL.has(task.status)) reason = `Candidate task is still ${task.status}`;
  else if (!verification) reason = "Independent verification evidence is missing";
  else if (!verification.passed) reason = verificationFailure(verification);
  else if (task.status !== "succeeded") reason = `Candidate task ended as ${task.status}`;

  const budget = verification?.changeBudget;
  const diffFocus = budget && budget.maxFiles > 0 && budget.maxDiffLines > 0
    ? Math.max(
        budget.filesChanged / budget.maxFiles,
        budget.changedLines / budget.maxDiffLines,
      )
    : undefined;
  const duration = task.startedAt && task.finishedAt
    ? Date.parse(task.finishedAt) - Date.parse(task.startedAt)
    : undefined;
  const validDuration = duration !== undefined && Number.isFinite(duration) && duration >= 0
    ? duration
    : undefined;
  const cost = completeTotal(input.evidence, "costUsd");

  return {
    candidate: input,
    eligible: reason === undefined,
    ...(reason === undefined ? {} : { reason }),
    ...(diffFocus === undefined ? {} : { diffFocus }),
    retries: Math.max(0, input.evidence.attempts.length - 1),
    ...(cost === undefined ? {} : { cost }),
    ...(validDuration === undefined ? {} : { duration: validDuration }),
  };
}

function inverse(value: number | undefined, values: number[]): number {
  if (value === undefined || values.length === 0) return 0;
  const low = Math.min(...values);
  const high = Math.max(...values);
  return high === low ? 1 : (high - value) / (high - low);
}

function factor(
  factorName: RankingFactor,
  weight: number,
  rawValue: number | undefined,
  normalizedValue: number,
  evidence: string,
): CompetitionFactorScore {
  return {
    factor: factorName,
    weight,
    available: rawValue !== undefined,
    ...(rawValue === undefined ? {} : { rawValue }),
    normalizedValue,
    weightedScore: normalizedValue * weight,
    evidence,
  };
}

function candidateScore(
  item: CandidateMetrics,
  policy: RankingPolicy,
  eligible: CandidateMetrics[],
): CompetitionCandidateScore {
  const base = {
    candidateId: item.candidate.candidateId,
    taskId: item.candidate.taskId,
    providerName: item.candidate.providerName,
    modelName: item.candidate.modelName,
  };
  if (!item.eligible) {
    return {
      ...base,
      eligible: false,
      disqualificationReason: item.reason ?? "Candidate is not eligible",
      factors: [
        factor("verification", policy.weights.verification, 0, 0, item.reason ?? "not eligible"),
      ],
      totalScore: 0,
    };
  }

  const focusScore = item.diffFocus === undefined ? 0 : Math.max(0, 1 - item.diffFocus);
  const factors = [
    factor("verification", policy.weights.verification, 1, 1, "independent verification passed"),
    factor(
      "diffFocus",
      policy.weights.diffFocus,
      item.diffFocus,
      focusScore,
      item.diffFocus === undefined ? "change-budget evidence unavailable" : `largest budget usage ${(item.diffFocus * 100).toFixed(1)}%`,
    ),
    factor(
      "retries",
      policy.weights.retries,
      item.retries,
      inverse(item.retries, eligible.map((candidate) => candidate.retries)),
      `${item.retries} retries`,
    ),
    factor(
      "cost",
      policy.weights.cost,
      item.cost,
      inverse(item.cost, eligible.flatMap((candidate) => candidate.cost ?? [])),
      item.cost === undefined ? "complete cost evidence unavailable" : `$${item.cost.toFixed(4)}`,
    ),
    factor(
      "duration",
      policy.weights.duration,
      item.duration,
      inverse(item.duration, eligible.flatMap((candidate) => candidate.duration ?? [])),
      item.duration === undefined ? "duration evidence unavailable" : `${(item.duration / 1000).toFixed(1)}s`,
    ),
  ];
  return {
    ...base,
    eligible: true,
    factors,
    totalScore: factors.reduce((total, current) => total + current.weightedScore, 0),
  };
}

export function scoreCandidates(
  competitionId: string,
  candidates: CompetitionCandidateInput[],
  policy: RankingPolicy,
  metadata: { evaluationId: string; createdAt: string },
): CompetitionEvaluationRecord {
  const measured = candidates.map(metrics);
  const eligible = measured.filter((candidate) => candidate.eligible);
  const scores = measured
    .map((candidate) => candidateScore(candidate, policy, eligible))
    .sort((a, b) =>
      Number(b.eligible) - Number(a.eligible)
      || b.totalScore - a.totalScore
      || a.candidateId.localeCompare(b.candidateId));
  const ranked = scores.filter((candidate) => candidate.eligible);
  const complete = measured.every((candidate) => TERMINAL.has(candidate.candidate.evidence.task.status));
  const tied = ranked.length > 1
    && Math.abs(ranked[0]!.totalScore - ranked[1]!.totalScore) < policy.tieThreshold;
  const winner = complete && !tied ? ranked[0] : undefined;
  const positiveWeight = Object.values(policy.weights).reduce((total, weight) => total + weight, 0);
  const gap = winner && ranked[1] ? winner.totalScore - ranked[1].totalScore : undefined;
  const confidence = gap === undefined
    ? 0.5
    : Math.max(0, Math.min(1, gap / positiveWeight));

  return {
    id: metadata.evaluationId,
    competitionId,
    policy,
    candidates: scores,
    ...(winner === undefined
      ? {}
      : {
          recommendation: {
            candidateId: winner.candidateId,
            confidence: Math.round(confidence * 100) / 100,
            reasoning: ranked.length === 1
              ? `${winner.providerName}/${winner.modelName} is the only verified candidate`
              : `${winner.providerName}/${winner.modelName} leads the next verified candidate by ${gap?.toFixed(3)}`,
          },
        }),
    createdAt: metadata.createdAt,
  };
}

export class CompetitionService {
  constructor(private readonly store: StateStore) {}

  score(
    competitionId: string,
    override: RankingPolicyOverride = {},
    settings?: CompetitionSettings,
  ): CompetitionEvaluationRecord {
    const competition = this.store.getCompetition(competitionId);
    const policy = rankingPolicy(
      { ...competition.rankingPolicy.weights, ...override },
      settings,
    );
    return this.scoreWithPolicy(competitionId, policy);
  }

  scoreWithPolicy(
    competitionId: string,
    policy: RankingPolicy,
  ): CompetitionEvaluationRecord {
    const candidates = this.readCandidates(competitionId);
    if (candidates.some(({ evidence }) => !TERMINAL.has(evidence.task.status))) {
      throw new Error("Competition cannot be scored until every candidate is terminal");
    }
    const createdAt = new Date().toISOString();
    const evaluation = scoreCandidates(competitionId, candidates, policy, {
      evaluationId: randomUUID(),
      createdAt,
    });
    this.store.saveCompetitionEvaluation(evaluation);
    return evaluation;
  }

  /** Pure preview — scores terminal evidence without persisting to store. */
  previewScore(
    competitionId: string,
    policy: RankingPolicy,
  ): CompetitionEvaluationRecord {
    const candidates = this.readCandidates(competitionId);
    if (candidates.some(({ evidence }) => !TERMINAL.has(evidence.task.status))) {
      throw new Error("Competition cannot be scored until every candidate is terminal");
    }
    const createdAt = new Date().toISOString();
    return scoreCandidates(competitionId, candidates, policy, {
      evaluationId: randomUUID(),
      createdAt,
    });
  }

  private readCandidates(competitionId: string): CompetitionCandidateInput[] {
    return this.store.getCompetitionCandidates(competitionId).map(
      (record): CompetitionCandidateInput => {
        const task = this.store.getTask(record.taskId);
        const events = this.store.listEvents(record.taskId);
        const verification = verificationFrom(events);
        return {
          candidateId: record.id,
          taskId: record.taskId,
          providerName: record.providerName,
          modelName: record.modelName,
          evidence: {
            task,
            attempts: this.store.listAttempts(record.taskId),
            events,
            ...(verification === undefined ? {} : { verification }),
          },
        };
      },
    );
  }
}

export interface CompetitionScorer {
  scoreWithPolicy(
    competitionId: string,
    policy: RankingPolicy,
  ): CompetitionEvaluationRecord;
}

// --- Competition coordinator ---

function timestamp(): string {
  return new Date().toISOString();
}

function cloneSpec(
  original: TaskSpec,
  override: CandidateOverride,
  providerDefaults: import("./settings.js").ProviderDefaultsSettings,
): TaskSpec {
  const cloned = structuredClone(original);
  const name = override.providerName as TaskSpec["provider"]["name"];
  const providerDef = providerDefaults[name];
  cloned.provider.name = name;
  cloned.provider.model = override.modelName;
  cloned.provider.endpoint = providerDef.defaultEndpoint;
  cloned.provider.keychainService = providerDef.defaultKeychainService;
  if (override.maxBudgetUsd !== undefined) {
    cloned.runtime.maxBudgetUsd = override.maxBudgetUsd;
  }
  return cloned;
}

function validateCandidates(
  candidates: CandidateOverride[],
  settings: ForkLightSettings,
): void {
  const comp = settings.competition;
  if (candidates.length < comp.minCandidates) {
    throw new Error(
      `Competition requires at least ${comp.minCandidates} candidates, got ${candidates.length}`,
    );
  }
  if (candidates.length > comp.maxCandidates) {
    throw new Error(
      `Competition allows at most ${comp.maxCandidates} candidates, got ${candidates.length}`,
    );
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    const providerName = typeof candidate.providerName === "string"
      ? candidate.providerName.trim()
      : "";
    const modelName = typeof candidate.modelName === "string"
      ? candidate.modelName.trim()
      : "";
    if (!providerName || !modelName) {
      throw new Error("Every candidate must specify a nonempty providerName and modelName");
    }
    if (!isProviderName(providerName)) {
      throw new Error(
        `Unsupported provider: ${providerName}. Supported: ${providerNames().join(", ")}`,
      );
    }
    const key = `${providerName}:${modelName}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate candidate: ${providerName}/${modelName}`);
    }
    seen.add(key);

    if (candidate.maxBudgetUsd !== undefined) {
      if (!Number.isFinite(candidate.maxBudgetUsd) || candidate.maxBudgetUsd <= 0) {
        throw new Error(`Candidate maxBudgetUsd must be positive, got ${candidate.maxBudgetUsd}`);
      }
      if (candidate.maxBudgetUsd > settings.execution.maximumBudgetUsd) {
        throw new Error(
          `Candidate maxBudgetUsd $${candidate.maxBudgetUsd} exceeds configured maximum $${settings.execution.maximumBudgetUsd}`,
        );
      }
    }
  }
}

export class CompetitionCoordinator {
  constructor(
    private readonly store: StateStore,
    private readonly settings: SettingsService,
    private readonly scorer: CompetitionScorer = new CompetitionService(store),
  ) {}

  async create(
    contractSpec: TaskSpec,
    contractTaskFile: string,
    candidates: CandidateOverride[],
  ): Promise<{ competition: CompetitionRecord; taskIds: string[] }> {
    const effectiveSettings = this.settings.get();
    validateCandidates(candidates, effectiveSettings);

    const competitionId = randomUUID();
    const createdAt = timestamp();
    const home = path.dirname(this.store.databasePath);
    const excludes = new Set(contractSpec.workspace.exclude);
    const createdTaskRoots: string[] = [];
    const competitionRoot = path.join(home, "competitions", competitionId);
    const snapshotDir = path.join(competitionRoot, "snapshot");
    const registrations: StagedTaskRegistration[] = [];
    const candidateRecords: CompetitionCandidateRecord[] = [];

    let persisted = false;
    try {
      // 1. Build a canonical snapshot from the live source exactly once.
      await mkdir(snapshotDir, { recursive: true, mode: 0o700 });
      const canonicalManifest = await buildManifest(contractSpec.project, excludes);
      const snapshotFilter = (source: string): boolean => {
        const relative = path.relative(contractSpec.project, source);
        for (const part of relative.split(path.sep)) {
          if (excludes.has(part)) return false;
        }
        try {
          return !lstatSync(source).isSymbolicLink();
        } catch {
          return false;
        }
      };
      await cp(contractSpec.project, snapshotDir, {
        recursive: true,
        preserveTimestamps: true,
        filter: snapshotFilter,
      });

      // 2. Create candidate tasks and clone every workspace from that snapshot.
      for (let ordinal = 0; ordinal < candidates.length; ordinal++) {
        const override = candidates[ordinal]!;
        const providerName = override.providerName.trim();
        const modelName = override.modelName.trim();
        const taskId = randomUUID();
        const sessionId = randomUUID();

        const candidateSpec = cloneSpec(
          contractSpec,
          {
            providerName,
            modelName,
            ...(override.maxBudgetUsd === undefined
              ? {}
              : { maxBudgetUsd: override.maxBudgetUsd }),
          },
          effectiveSettings.providerDefaults,
        );
        const taskRecord = buildTaskRecord({
          spec: candidateSpec,
          taskFile: contractTaskFile,
          home,
          id: taskId,
          sessionId,
          createdAt,
        });

        const paths = taskPaths(home, taskId);
        createdTaskRoots.push(paths.root);
        const manifest = await prepareWorkspace(candidateSpec, paths, snapshotDir);

        // Symlinks are deliberately omitted from the canonical copy. The
        // byte-bearing file manifest must still match exactly.
        if (JSON.stringify(manifest.files) !== JSON.stringify(canonicalManifest.files)) {
          throw new Error(
            `Candidate ${providerName}/${modelName} manifest does not match the canonical snapshot`,
          );
        }

        registrations.push({
          task: taskRecord,
          creationEvent: {
            summary: `Competition candidate created: ${providerName}/${modelName}`,
            payload: {
              provider: providerName,
              model: modelName,
              competitionId,
              ordinal,
            },
          },
          extraEvents: [
            {
              type: "workspace.prepared",
              summary: "Isolated workspace prepared from canonical competition snapshot",
              payload: {
                workspace: paths.workspace,
                baseline: paths.baseline,
                copiedFiles: manifest.files.length,
                skippedSymlinks: manifest.skippedSymlinks,
                linkedDependencies: manifest.linkedDependencies,
              },
            },
          ],
        });

        candidateRecords.push({
          id: randomUUID(),
          competitionId,
          taskId,
          ordinal,
          providerName,
          modelName,
        });
      }

      // 3. Persist everything atomically (snapshot the policy at creation time)
      const creationPolicy = rankingPolicy({}, effectiveSettings.competition);
      const competition: CompetitionRecord = {
        id: competitionId,
        name: `Competition: ${contractSpec.name}`,
        contractTaskId: registrations[0]!.task.id,
        status: "running",
        rankingPolicy: creationPolicy,
        createdAt,
        updatedAt: createdAt,
      };

      this.store.createCompetitionExecution(registrations, competition, candidateRecords);
      persisted = true;

      // Remove the temporary canonical snapshot after persistence.
      await rm(competitionRoot, { recursive: true, force: true }).catch(() => {});

      return {
        competition: this.store.getCompetition(competitionId),
        taskIds: registrations.map((r) => r.task.id),
      };
    } catch (error) {
      await rm(competitionRoot, { recursive: true, force: true }).catch(() => {});
      // Clean up any created task root directories (not yet persisted)
      if (!persisted) {
        for (const root of createdTaskRoots) {
          await rm(root, { recursive: true, force: true }).catch(() => {});
        }
      }
      throw error;
    }
  }

  reconcile(competitionId: string): CompetitionEvaluationRecord | undefined {
    const competition = this.store.getCompetition(competitionId);
    if (competition.status !== "running") return undefined;

    const candidateRecords = this.store.getCompetitionCandidates(competitionId);
    const terminal = candidateRecords.every((candidate) => {
      const task = this.store.getTask(candidate.taskId);
      return TERMINAL.has(task.status);
    });
    if (!terminal) return undefined;

    try {
      // Use the immutable creation-time rankingPolicy, not current effective settings
      const evaluation = this.scorer.scoreWithPolicy(
        competitionId,
        competition.rankingPolicy,
      );
      return evaluation;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Persist the error visibly on the competition record
      this.store.updateCompetition(competitionId, {
        status: "completed",
        finishedAt: timestamp(),
        error: message,
      });
      return undefined;
    }
  }
}
