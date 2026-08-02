/**
 * Durable one-hop cross-Worker Candidate handoff.
 *
 * Two Main-confirmed origins share successor materialization:
 *   - Competition: exact retained-partial Candidate evidence.
 *   - Goal-Task: exact normal Goal milestone Candidate with retained paths
 *     and remaining gaps supplied in the same confirmed request.
 *
 * ForkLight creates exactly one successor Task from a clean current-project
 * baseline, imports only Main-approved whole reusable paths from the exact
 * Candidate revision with byte proof, freezes destination identity and a
 * privacy-safe handoff record, then runs the successor through the ordinary
 * Task lifecycle.
 *
 * Boundaries:
 *   - No automatic Worker selection, multi-hop, fan-out, or retry semantics.
 *   - Source Task, CandidateRevision, origin evidence, and Attempts are
 *     immutable. Successor costs and identity are recorded separately.
 *   - No raw patch, prompts, logs, credentials, endpoints, or private artifact
 *     paths in public projections.
 *   - Preparation is restart-safe and idempotent; failure launches no Worker.
 *   - Goal-Task origin never fabricates Competition ids.
 */
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { StateStore } from "../state/store.js";
import { prepareWorkspace } from "../workspace/copy.js";
import { parseAffectedPathsFromWorkspaceDiff } from "../workspace/patch.js";
import {
  buildCandidateGapContract,
  candidateRevisionMatchesCurrentDiff,
  computeGapContractDigest,
  latestMainReview,
  resolveLatestRevision,
} from "./candidate-revision.js";
import {
  enforcementCapabilityForRuntime,
  resolveTaskEffectivePolicy,
} from "./advanced-policy.js";
import { buildTaskRecord } from "./runner.js";
import { authorizeHandoffRestartRecovery } from "./attempt-authorization.js";
import {
  applyResolvedNetworkPolicy,
  resolveWorkerSelection,
} from "./worker-profiles.js";
import { defaultExecutableForRuntime } from "./runtime-names.js";
import type { ForkLightSettings } from "./settings.js";
import { isoTimestamp as timestamp } from "./time.js";
import type {
  CandidateGapContract,
  CandidateHandoffFailureCode,
  CandidateHandoffNextAction,
  CandidateHandoffOrigin,
  CandidateHandoffRecord,
  CandidateHandoffView,
  CandidateRevision,
  CompetitionCandidateRecord,
  CompetitionRecord,
  CompetitionRetainedPartial,
  FrozenWorkerIdentity,
  GapEntry,
  GoalMilestoneRecord,
  GoalRecord,
  TaskRecord,
  TaskSpec,
} from "./types.js";

const HANDOFF_REASON_MIN = 1;
const HANDOFF_REASON_MAX = 1000;

export class CandidateHandoffError extends Error {
  readonly code: CandidateHandoffFailureCode;
  readonly nextAction: CandidateHandoffNextAction;

  constructor(
    code: CandidateHandoffFailureCode,
    message: string,
    nextAction: CandidateHandoffNextAction = "inspect-failure",
  ) {
    super(message);
    this.name = "CandidateHandoffError";
    this.code = code;
    this.nextAction = nextAction;
  }
}

export interface CandidateHandoffRequest {
  competitionId: string;
  candidateId: string;
  candidateRevisionId: string;
  destinationWorkerProfileId: string;
  reason: string;
  confirm: true;
}

/** Direct Goal milestone Task handoff: retain + hand off in one confirmed request. */
export interface GoalTaskHandoffRequest {
  taskId: string;
  candidateRevisionId: string;
  reusablePaths: unknown;
  remainingGaps: unknown;
  destinationWorkerProfileId: string;
  reason: string;
  confirm: true;
}

/** Shared destination + gap-contract context used by both origin kinds. */
export interface SharedHandoffDeliveryContext {
  origin: CandidateHandoffOrigin;
  sourceTask: TaskRecord;
  revision: CandidateRevision;
  gapContract: CandidateGapContract;
  gapContractDigest: string;
  destinationIdentity: FrozenWorkerIdentity;
  destinationSelection: ReturnType<typeof resolveWorkerSelection>;
  reason: string;
}

export interface CandidateHandoffAuthorizationContext extends SharedHandoffDeliveryContext {
  origin: {
    kind: "competition";
    competitionId: string;
    sourceCandidateId: string;
  };
  competition: CompetitionRecord;
  candidate: CompetitionCandidateRecord;
  retained: CompetitionRetainedPartial;
}

export interface GoalTaskHandoffAuthorizationContext extends SharedHandoffDeliveryContext {
  origin: {
    kind: "goal-task";
    goalId: string;
    itemId: string;
  };
  goal: GoalRecord;
  milestone: GoalMilestoneRecord;
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function normalizeReason(reason: unknown): string {
  if (typeof reason !== "string") {
    throw new CandidateHandoffError(
      "reason-invalid",
      "handoff reason must be a string",
      "inspect-failure",
    );
  }
  const trimmed = reason.trim();
  if (trimmed.length < HANDOFF_REASON_MIN || trimmed.length > HANDOFF_REASON_MAX) {
    throw new CandidateHandoffError(
      "reason-invalid",
      `handoff reason must be ${HANDOFF_REASON_MIN}-${HANDOFF_REASON_MAX} characters`,
      "inspect-failure",
    );
  }
  if (/[\r\n]/.test(trimmed)) {
    throw new CandidateHandoffError(
      "reason-invalid",
      "handoff reason must not contain newlines",
      "inspect-failure",
    );
  }
  if (
    /\b(sk-[A-Za-z0-9_-]{8,}|API[_-]?KEY|Bearer\s+[A-Za-z0-9_\-.]{8,}|password\s*[:=])/i
      .test(trimmed)
  ) {
    throw new CandidateHandoffError(
      "reason-invalid",
      "handoff reason must not contain credentials",
      "inspect-failure",
    );
  }
  return trimmed;
}

/** Privacy-safe projection of a durable handoff record. */
export function projectCandidateHandoff(
  record: CandidateHandoffRecord,
  successorTaskStatus?: TaskRecord["status"],
): CandidateHandoffView {
  const nextAction: CandidateHandoffNextAction = record.status === "failed"
    ? record.nextAction
    : successorTaskStatus === "succeeded"
      ? "review-successor"
      : successorTaskStatus === "failed" || successorTaskStatus === "interrupted"
        ? "inspect-failure"
        : record.nextAction;
  const originFields = record.origin.kind === "competition"
    ? {
        competitionId: record.origin.competitionId,
        sourceCandidateId: record.origin.sourceCandidateId,
      }
    : {
        goalId: record.origin.goalId,
        itemId: record.origin.itemId,
      };
  return {
    id: record.id,
    status: record.status,
    originKind: record.origin.kind,
    ...originFields,
    sourceTaskId: record.sourceTaskId,
    sourceCandidateRevisionId: record.sourceCandidateRevisionId,
    sourceDigestPrefix: record.sourcePatchDigest.slice(0, 12),
    gapContractDigestPrefix: record.gapContractDigest.slice(0, 12),
    reusablePathCount: record.reusablePathCount,
    remainingGapCount: record.remainingGapCount,
    reusablePaths: [...record.reusablePaths],
    remainingGaps: record.remainingGaps.map((gap) => ({
      description: gap.description,
      acceptanceExpectation: gap.acceptanceExpectation,
    })),
    destinationWorkerProfileId: record.destinationWorkerProfileId,
    destinationIdentity: { ...record.destinationIdentity },
    successorTaskId: record.successorTaskId,
    reason: record.reason,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.preparedAt === undefined ? {} : { preparedAt: record.preparedAt }),
    ...(record.failedAt === undefined ? {} : { failedAt: record.failedAt }),
    ...(record.failureCode === undefined ? {} : { failureCode: record.failureCode }),
    nextAction,
    ...(successorTaskStatus === undefined ? {} : { successorTaskStatus }),
  };
}

/** SQL index key for competition_id column; empty for Goal-Task origin. */
export function handoffCompetitionIndexKey(record: CandidateHandoffRecord): string {
  return record.origin.kind === "competition" ? record.origin.competitionId : "";
}

/** Build the destination Worker instruction from retained paths and gaps. */
export function buildHandoffInstruction(
  reusablePaths: readonly string[],
  remainingGaps: readonly GapEntry[],
  digestPrefix: string,
): string {
  const lines: string[] = [
    "## Cross-Worker Candidate Handoff Instruction",
    "",
    "This is a one-pass successor Task for a different saved Worker Profile.",
    "It is not a retry, correction, or adaptation of the source Task.",
    `Source Candidate digest prefix: ${digestPrefix}`,
    "",
    "### Reusable paths already imported into this workspace",
  ];
  if (reusablePaths.length === 0) {
    lines.push("No reusable paths were imported. Complete every remaining gap from the original contract.");
  } else {
    lines.push(
      "The following relative paths already contain Main-approved reusable work. Keep them and build on them:",
    );
    for (const filePath of reusablePaths) {
      lines.push(`- ${filePath}`);
    }
  }
  lines.push("", "### Remaining gaps");
  for (let index = 0; index < remainingGaps.length; index += 1) {
    const gap = remainingGaps[index]!;
    lines.push(`**Gap ${index + 1}:** ${gap.description}`);
    lines.push(`- Acceptance: ${gap.acceptanceExpectation}`);
  }
  lines.push(
    "",
    "### One-pass stop rule",
    "Complete the remaining gaps in a single ordinary Attempt, then stop.",
    "Do not invent extra retries, handoffs, Integration, commit, or push.",
    "Independent verification and a fresh Main Review are required before Integration.",
  );
  return lines.join("\n");
}

/**
 * Clone the source TaskSpec while replacing only Worker/Profile/Provider/runtime
 * and freezing advanced policy from the destination Profile (never source-Task
 * advancedPolicyOverride). Deliver every reusable path and every bounded gap
 * into the Worker-facing contract without a shared truncation window.
 */
export function buildHandoffSuccessorSpec(
  sourceSpec: TaskSpec,
  selection: ReturnType<typeof resolveWorkerSelection>,
  input: {
    reusablePaths: readonly string[];
    remainingGaps: readonly GapEntry[];
    digestPrefix: string;
  },
): TaskSpec {
  const cloned = structuredClone(sourceSpec);
  cloned.provider = {
    name: selection.provider as TaskSpec["provider"]["name"],
    model: selection.model,
    endpoint: selection.endpoint,
    keychainService: selection.keychainService,
    ...(selection.pricingRoute === undefined ? {} : { pricingRoute: selection.pricingRoute }),
  };
  cloned.runtime = {
    ...cloned.runtime,
    name: selection.runtime,
    executable: defaultExecutableForRuntime(selection.runtime),
    effort: selection.effort,
    maxBudgetUsd: selection.maxBudgetUsd,
  };
  if (selection.profileId !== undefined) {
    cloned.workerProfileId = selection.profileId;
  } else {
    delete cloned.workerProfileId;
  }
  // Destination Profile owns advanced policy. Source-Task Worker overrides must
  // not rewrite the successor's frozen limits or identity.
  delete cloned.advancedPolicyOverride;
  // Drop source routing snapshot so control surfaces do not project a false
  // "selected Worker" identity for the successor.
  delete cloned.routingDecision;

  // Preserve technical contract / acceptance / workspace / delivery; append
  // every path and every gap as its own bounded line (no whole-instruction
  // 1000-char truncation that could drop later gaps).
  if (cloned.version === 2) {
    const pathLines = input.reusablePaths.length === 0
      ? ["No reusable paths were imported; complete every remaining gap from the original contract."]
      : input.reusablePaths.map(
          (filePath) => `Reusable path already imported into this workspace: ${filePath}`,
        );
    const gapLines = input.remainingGaps.flatMap((gap, index) => [
      `Remaining gap ${index + 1}: ${gap.description}`,
      `Gap ${index + 1} acceptance expectation: ${gap.acceptanceExpectation}`,
    ]);
    cloned.contract = {
      ...cloned.contract,
      context: [
        ...cloned.contract.context,
        "Cross-Worker handoff successor: reusable paths are already imported; complete only the remaining gaps.",
        "This is not a retry, correction, or adaptation of the source Task.",
        `Source Candidate digest prefix: ${input.digestPrefix}`,
        ...pathLines,
        ...gapLines,
        "One-pass stop rule: complete remaining gaps in one ordinary Attempt, then stop. No retry, multi-hop handoff, Integration, commit, or push.",
      ],
      inScope: [
        ...cloned.contract.inScope,
        "Complete every remaining handoff gap against the original acceptance commands",
        ...input.remainingGaps.map(
          (gap, index) => `Close gap ${index + 1}: ${gap.description}`,
        ),
      ],
      outOfScope: [
        ...cloned.contract.outOfScope,
        "Rewriting retained reusable paths without cause",
        "Automatic Integration, commit, push, or multi-hop handoff",
        "Reading private revision artifact paths or source Worker transcripts",
      ],
      executionSteps: [
        "Inspect every preloaded reusable path in the workspace",
        ...input.remainingGaps.map(
          (gap, index) => `Complete gap ${index + 1} to satisfy: ${gap.acceptanceExpectation}`,
        ),
        "Stop after one pass and return the ordinary summary",
        ...cloned.contract.executionSteps,
      ],
    };
  }
  // Freeze the destination Profile's network policy. Legacy destination omission
  // deletes the source Task's frozen policy so the successor inherits the Daemon
  // environment instead of routing through the source Worker's route.
  return applyResolvedNetworkPolicy(selection, cloned);
}

/** True when the Competition request is an exact replay of an authorized handoff. */
export function isExactHandoffReplay(
  existing: CandidateHandoffRecord,
  request: CandidateHandoffRequest,
  canonicalReason: string,
): boolean {
  return existing.origin.kind === "competition"
    && existing.origin.competitionId === request.competitionId
    && existing.origin.sourceCandidateId === request.candidateId
    && existing.sourceCandidateRevisionId === request.candidateRevisionId
    && existing.destinationWorkerProfileId === request.destinationWorkerProfileId.trim()
    && existing.reason === canonicalReason;
}

/** True when the Goal-Task request is an exact replay of an authorized handoff. */
export function isExactGoalTaskHandoffReplay(
  existing: CandidateHandoffRecord,
  request: GoalTaskHandoffRequest,
  canonicalReason: string,
  gapContractDigest: string,
): boolean {
  return existing.origin.kind === "goal-task"
    && existing.sourceTaskId === request.taskId.trim()
    && existing.sourceCandidateRevisionId === request.candidateRevisionId
    && existing.gapContractDigest === gapContractDigest
    && existing.destinationWorkerProfileId === request.destinationWorkerProfileId.trim()
    && existing.reason === canonicalReason;
}

/**
 * Split a workspace no-index Diff into per-path sections and keep only the
 * Main-approved reusable paths. Rejects when a selected path is absent from
 * the exact Diff or when headers are ambiguous.
 */
export function filterPatchToSelectedPaths(
  patchText: string,
  selectedPaths: readonly string[],
): string {
  const selected = new Set(selectedPaths);
  if (selected.size === 0) {
    throw new CandidateHandoffError(
      "materialization-failed",
      "handoff requires at least one reusable path to import",
      "retain-fresh-candidate",
    );
  }
  const lines = patchText.split("\n");
  const sections: string[][] = [];
  let current: string[] | undefined;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (current !== undefined) sections.push(current);
      current = [line];
    } else if (current !== undefined) {
      current.push(line);
    } else if (line.trim().length > 0) {
      throw new CandidateHandoffError(
        "materialization-failed",
        "Candidate Diff contains unsupported content before the first file section",
        "inspect-failure",
      );
    }
  }
  if (current !== undefined) sections.push(current);

  const kept: string[] = [];
  const found = new Set<string>();
  for (const section of sections) {
    const header = section[0] ?? "";
    const paths = parseAffectedPathsFromWorkspaceDiff(`${header}\n`);
    if (paths.length !== 1) {
      throw new CandidateHandoffError(
        "materialization-failed",
        "Candidate Diff section must identify exactly one safe relative path",
        "inspect-failure",
      );
    }
    const filePath = paths[0]!;
    if (!selected.has(filePath)) continue;
    found.add(filePath);
    kept.push(section.join("\n"));
  }
  for (const filePath of selected) {
    if (!found.has(filePath)) {
      throw new CandidateHandoffError(
        "materialization-failed",
        `selected reusable path "${filePath}" is missing from the exact Candidate Diff`,
        "retain-fresh-candidate",
      );
    }
  }
  if (kept.length === 0) {
    throw new CandidateHandoffError(
      "materialization-failed",
      "filtered Candidate Diff is empty",
      "retain-fresh-candidate",
    );
  }
  // Preserve trailing newline so git apply accepts the filtered patch.
  return `${kept.join("\n").replace(/\n+$/, "")}\n`;
}

async function runGitApply(
  cwd: string,
  patchPath: string,
  checkOnly: boolean,
): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const args = ["apply", "-p2", "--whitespace=nowarn"];
    if (checkOnly) args.push("--check");
    args.push(patchPath);
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length >= 8_000) return;
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({ exitCode: code ?? 1, stderr: stderr.trim() });
    });
  });
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Import only approved whole-file paths from the exact Candidate Diff into a
 * clean current-project successor workspace. Proves each selected path matches
 * the Candidate workspace bytes (or mutual absence for deletions).
 */
export async function materializeSelectedCandidatePaths(input: {
  successor: TaskRecord;
  sourceTask: TaskRecord;
  revision: CandidateRevision;
  reusablePaths: readonly string[];
  privateArtifactPath: string;
}): Promise<{ importedPaths: string[] }> {
  const { successor, sourceTask, revision, reusablePaths, privateArtifactPath } = input;
  let patchBytes: Buffer;
  try {
    patchBytes = await readFile(privateArtifactPath);
  } catch {
    throw new CandidateHandoffError(
      "materialization-failed",
      "private Candidate Revision artifact is missing",
      "retain-fresh-candidate",
    );
  }
  if (sha256(patchBytes) !== revision.patchDigest) {
    throw new CandidateHandoffError(
      "stale-revision",
      "private Candidate Revision artifact digest mismatch",
      "retain-fresh-candidate",
    );
  }

  // Clean current-project baseline + workspace (never use the Candidate workspace as baseline).
  // Clear any partial preparation so restart recovery is idempotent.
  await rm(successor.paths.baseline, { recursive: true, force: true }).catch(() => {});
  await rm(successor.paths.workspace, { recursive: true, force: true }).catch(() => {});
  await rm(path.join(successor.paths.root, "source-manifest.json"), { force: true }).catch(() => {});
  await prepareWorkspace(successor.spec, successor.paths);

  const filtered = filterPatchToSelectedPaths(patchBytes.toString("utf8"), reusablePaths);
  const patchDir = path.join(successor.paths.root, "handoff");
  await mkdir(patchDir, { recursive: true, mode: 0o700 });
  await chmod(patchDir, 0o700);
  const filteredPatchPath = path.join(patchDir, "selected.patch");
  await writeFile(filteredPatchPath, filtered, { mode: 0o600 });
  await chmod(filteredPatchPath, 0o600);

  const check = await runGitApply(successor.paths.workspace, filteredPatchPath, true);
  if (check.exitCode !== 0) {
    throw new CandidateHandoffError(
      "materialization-failed",
      `selected path patch cannot apply cleanly to the current project baseline${
        check.stderr ? `: ${check.stderr.slice(0, 300)}` : ""
      }`,
      "inspect-failure",
    );
  }
  const applied = await runGitApply(successor.paths.workspace, filteredPatchPath, false);
  if (applied.exitCode !== 0) {
    throw new CandidateHandoffError(
      "materialization-failed",
      `selected path patch apply failed${
        applied.stderr ? `: ${applied.stderr.slice(0, 300)}` : ""
      }`,
      "inspect-failure",
    );
  }

  // Byte-level proof against the exact Candidate workspace for every selected path.
  for (const relative of reusablePaths) {
    const candidatePath = path.join(sourceTask.paths.workspace, relative);
    const successorPath = path.join(successor.paths.workspace, relative);
    const candidateExists = await pathExists(candidatePath);
    const successorExists = await pathExists(successorPath);
    if (candidateExists !== successorExists) {
      throw new CandidateHandoffError(
        "apply-mismatch",
        `selected path "${relative}" presence does not match the exact Candidate workspace`,
        "inspect-failure",
      );
    }
    if (!candidateExists) continue;
    const [candidateBytes, successorBytes] = await Promise.all([
      readFile(candidatePath),
      readFile(successorPath),
    ]);
    if (!candidateBytes.equals(successorBytes)) {
      throw new CandidateHandoffError(
        "apply-mismatch",
        `selected path "${relative}" bytes do not match the exact Candidate workspace`,
        "inspect-failure",
      );
    }
  }

  // Non-reusable Candidate paths must remain absent as Candidate changes.
  const allAffected = new Set(revision.affectedPaths);
  const selected = new Set(reusablePaths);
  for (const relative of allAffected) {
    if (selected.has(relative)) continue;
    const successorPath = path.join(successor.paths.workspace, relative);
    const baselinePath = path.join(successor.paths.baseline, relative);
    const successorExists = await pathExists(successorPath);
    const baselineExists = await pathExists(baselinePath);
    if (successorExists !== baselineExists) {
      throw new CandidateHandoffError(
        "apply-mismatch",
        `non-reusable Candidate path "${relative}" was incorrectly imported`,
        "inspect-failure",
      );
    }
    if (!successorExists) continue;
    const [baseBytes, workBytes] = await Promise.all([
      readFile(baselinePath),
      readFile(successorPath),
    ]);
    if (!baseBytes.equals(workBytes)) {
      throw new CandidateHandoffError(
        "apply-mismatch",
        `non-reusable Candidate path "${relative}" was incorrectly imported`,
        "inspect-failure",
      );
    }
  }

  return { importedPaths: [...reusablePaths] };
}

function sourceProfileId(
  task: TaskRecord,
  candidate?: CompetitionCandidateRecord,
): string | undefined {
  return candidate?.identity?.workerProfileId
    ?? task.spec.workerProfileId;
}

type HandoffReadiness = {
  canLaunch: (profileId: string) => { ok: boolean; reason?: string };
};

/** Shared destination Profile validation for both origin kinds. */
function resolveDestinationSelection(
  settings: ForkLightSettings,
  destinationProfileIdRaw: string,
  sourceProfile: string | undefined,
  readiness: HandoffReadiness,
): {
  destinationSelection: ReturnType<typeof resolveWorkerSelection>;
  destinationIdentity: FrozenWorkerIdentity;
} {
  const destinationProfileId = destinationProfileIdRaw.trim();
  if (destinationProfileId.length === 0) {
    throw new CandidateHandoffError(
      "profile-unknown",
      "destination Worker Profile id is required",
      "choose-different-profile",
    );
  }
  if (sourceProfile !== undefined && sourceProfile === destinationProfileId) {
    throw new CandidateHandoffError(
      "same-profile",
      "destination Worker Profile must differ from the source Profile",
      "choose-different-profile",
    );
  }

  let destinationSelection: ReturnType<typeof resolveWorkerSelection>;
  try {
    destinationSelection = resolveWorkerSelection(
      { workerProfileId: destinationProfileId },
      {
        execution: settings.execution,
        providerDefaults: settings.providerDefaults,
        workerProfiles: settings.workerProfiles,
        ...(settings.modelCatalog === undefined ? {} : { modelCatalog: settings.modelCatalog }),
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CandidateHandoffError(
      "profile-unknown",
      message,
      "choose-different-profile",
    );
  }
  if (destinationSelection.profileId === undefined) {
    throw new CandidateHandoffError(
      "profile-unknown",
      "destination Worker Profile could not be resolved",
      "choose-different-profile",
    );
  }

  const launch = readiness.canLaunch(destinationSelection.profileId);
  if (!launch.ok) {
    throw new CandidateHandoffError(
      "profile-not-launchable",
      `destination Worker Profile is not launchable: ${destinationSelection.profileId}${
        launch.reason ? ` (${launch.reason})` : ""
      }`,
      "choose-different-profile",
    );
  }

  return {
    destinationSelection,
    destinationIdentity: {
      provider: destinationSelection.provider,
      model: destinationSelection.model,
      runtime: destinationSelection.runtime,
      effort: destinationSelection.effort,
      workerProfileId: destinationSelection.profileId,
    },
  };
}

function requireGapContract(
  revision: CandidateRevision,
  reusablePaths: unknown,
  remainingGaps: unknown,
): { gapContract: CandidateGapContract; gapContractDigest: string } {
  let gapContract: CandidateGapContract;
  try {
    gapContract = buildCandidateGapContract(
      revision.id,
      reusablePaths,
      remainingGaps,
      revision.affectedPaths,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CandidateHandoffError(
      message.includes("unsafe") || message.includes("Absolute") || message.includes("Traversal")
        ? "unsafe-path"
        : "missing-retained",
      message,
      "retain-fresh-candidate",
    );
  }
  if (gapContract.reusablePaths.length === 0) {
    throw new CandidateHandoffError(
      "missing-retained",
      "handoff requires at least one retained reusable path",
      "retain-fresh-candidate",
    );
  }
  return {
    gapContract,
    gapContractDigest: computeGapContractDigest(gapContract),
  };
}

function rejectIfSourceIsSuccessor(store: StateStore, sourceTaskId: string): void {
  if (store.getCandidateHandoffBySuccessorTaskId(sourceTaskId) !== undefined) {
    throw new CandidateHandoffError(
      "source-is-successor",
      "handoff is limited to one hop; the source Task is already a handoff successor",
      "none",
    );
  }
}

function rejectIfDuplicateRevision(
  store: StateStore,
  revisionId: string,
  allowExisting?: CandidateHandoffRecord,
): void {
  const existing = store.getCandidateHandoffBySourceRevisionId(revisionId);
  if (existing !== undefined && existing.id !== allowExisting?.id) {
    throw new CandidateHandoffError(
      "duplicate-handoff",
      "a handoff already exists for this exact retained CandidateRevision",
      "wait-for-successor",
    );
  }
}

/**
 * Validate one explicit Competition handoff request before any durable mutation.
 * Fail closed on stale/missing evidence, same Profile, non-launchable
 * destination, final choice, duplicate, or multi-hop.
 */
export function validateCandidateHandoffRequest(
  store: StateStore,
  settings: ForkLightSettings,
  request: CandidateHandoffRequest,
  readiness: HandoffReadiness,
): CandidateHandoffAuthorizationContext {
  if (request.confirm !== true) {
    throw new CandidateHandoffError(
      "confirm-required",
      "candidate handoff requires explicit confirm: true",
      "inspect-failure",
    );
  }
  const reason = normalizeReason(request.reason);

  let competition: CompetitionRecord;
  try {
    competition = store.getCompetition(request.competitionId);
  } catch {
    throw new CandidateHandoffError(
      "missing-retained",
      `Competition ${request.competitionId} was not found`,
      "retain-fresh-candidate",
    );
  }

  const candidates = store.getCompetitionCandidates(request.competitionId);
  const candidate = candidates.find((entry) => entry.id === request.candidateId);
  if (candidate === undefined) {
    throw new CandidateHandoffError(
      "missing-retained",
      `Candidate ${request.candidateId} does not belong to competition ${request.competitionId}`,
      "retain-fresh-candidate",
    );
  }

  // Final accepted choice cannot be handed off.
  if (
    competition.mainDecision?.decision === "accept"
    && competition.mainDecision.candidateId === candidate.id
  ) {
    throw new CandidateHandoffError(
      "final-choice",
      "handoff cannot target the final accepted Competition Candidate",
      "none",
    );
  }

  const retained = (competition.retainedPartial ?? []).find(
    (entry) => entry.candidateId === candidate.id,
  );
  if (retained === undefined) {
    throw new CandidateHandoffError(
      "missing-retained",
      "handoff requires persisted retained-partial evidence for this Candidate",
      "retain-fresh-candidate",
    );
  }
  if (retained.taskId !== candidate.taskId) {
    throw new CandidateHandoffError(
      "missing-retained",
      "retained-partial Task identity does not match the Candidate",
      "retain-fresh-candidate",
    );
  }

  const sourceTask = store.getTask(candidate.taskId);
  rejectIfSourceIsSuccessor(store, sourceTask.id);

  const events = store.listEvents(sourceTask.id);
  const revision = resolveLatestRevision(events);
  if (revision === undefined || revision.taskId !== sourceTask.id) {
    throw new CandidateHandoffError(
      "missing-revision",
      "handoff requires the Candidate's latest CandidateRevision evidence",
      "retain-fresh-candidate",
    );
  }
  if (revision.id !== request.candidateRevisionId) {
    throw new CandidateHandoffError(
      "stale-revision",
      "handoff candidateRevisionId does not match the latest CandidateRevision",
      "retain-fresh-candidate",
    );
  }
  if (
    retained.candidateRevisionId !== undefined
    && retained.candidateRevisionId !== revision.id
  ) {
    throw new CandidateHandoffError(
      "stale-revision",
      "retained-partial is bound to a different CandidateRevision",
      "retain-fresh-candidate",
    );
  }
  if (!candidateRevisionMatchesCurrentDiff(sourceTask, revision)) {
    throw new CandidateHandoffError(
      "stale-revision",
      "Candidate Diff no longer matches the exact CandidateRevision",
      "retain-fresh-candidate",
    );
  }

  const { gapContract, gapContractDigest } = requireGapContract(
    revision,
    retained.reusablePaths,
    retained.remainingGaps,
  );
  rejectIfDuplicateRevision(store, revision.id);

  const { destinationSelection, destinationIdentity } = resolveDestinationSelection(
    settings,
    request.destinationWorkerProfileId,
    sourceProfileId(sourceTask, candidate),
    readiness,
  );

  return {
    origin: {
      kind: "competition",
      competitionId: competition.id,
      sourceCandidateId: candidate.id,
    },
    competition,
    candidate,
    sourceTask,
    revision,
    retained,
    gapContract,
    gapContractDigest,
    destinationIdentity,
    destinationSelection,
    reason,
  };
}

/**
 * True when Integration left the Candidate patch in source. Only applied and
 * retained-failure block handoff; rejected or rolled-back history alone does not.
 */
export function hasSourceBlockingIntegration(
  store: StateStore,
  taskId: string,
): boolean {
  return store.listIntegrationResults(taskId).some(
    (result) => result.status === "applied" || result.status === "retained-failure",
  );
}

/**
 * True when the source Goal Task is in a reviewable terminal state that may
 * authorize direct handoff: failed-with-revision, or succeeded with a fresh
 * exact Main revise on the current Attempt/verification/revision.
 * Interrupted sources are rejected (resume through Task authority first).
 */
export function isGoalTaskHandoffSourceEligible(
  store: StateStore,
  sourceTask: TaskRecord,
  revision: CandidateRevision,
): { ok: true } | { ok: false; code: CandidateHandoffFailureCode; message: string } {
  if (
    sourceTask.status === "queued"
    || sourceTask.status === "preparing"
    || sourceTask.status === "running"
    || sourceTask.status === "verifying"
    || sourceTask.status === "waiting"
    || sourceTask.status === "blocked"
  ) {
    return {
      ok: false,
      code: "source-not-eligible",
      message: `Goal Task handoff rejects active source status ${sourceTask.status}`,
    };
  }
  if (sourceTask.status === "interrupted") {
    return {
      ok: false,
      code: "source-not-eligible",
      message: "Goal Task handoff rejects an interrupted source; resume or fail the Task first",
    };
  }
  if (hasSourceBlockingIntegration(store, sourceTask.id)) {
    return {
      ok: false,
      code: "source-not-eligible",
      message: "Goal Task handoff rejects a source Candidate already left in project source (applied or retained-failure)",
    };
  }
  const events = store.listEvents(sourceTask.id);
  const review = latestMainReview(events);
  if (review?.decision === "accept") {
    return {
      ok: false,
      code: "source-not-eligible",
      message: "Goal Task handoff rejects a Main-accepted source Candidate",
    };
  }
  if (review?.decision === "reject") {
    return {
      ok: false,
      code: "source-not-eligible",
      message: "Goal Task handoff rejects a Main-rejected source Candidate",
    };
  }

  if (sourceTask.status === "failed") {
    if (revision.taskId !== sourceTask.id) {
      return {
        ok: false,
        code: "missing-revision",
        message: "failed Goal Task handoff requires a CandidateRevision on the source Task",
      };
    }
    return { ok: true };
  }

  if (sourceTask.status === "succeeded") {
    // Fresh exact Main revise on the current verification + revision.
    if (review === undefined || review.decision !== "revise") {
      return {
        ok: false,
        code: "source-not-eligible",
        message: "succeeded Goal Task handoff requires a fresh exact Main revise",
      };
    }
    const verification = events
      .filter((event) => event.type === "verification.completed")
      .reduce<(typeof events)[number] | undefined>(
        (latest, event) =>
          latest === undefined || event.sequence > latest.sequence ? event : latest,
        undefined,
      );
    if (
      verification === undefined
      || verification.attemptId === undefined
      || review.attemptId !== verification.attemptId
      || review.verificationEventSequence !== verification.sequence
    ) {
      return {
        ok: false,
        code: "source-not-eligible",
        message: "Main revise is not bound to the latest verification evidence",
      };
    }
    if (
      sourceTask.currentAttemptId !== undefined
      && review.attemptId !== sourceTask.currentAttemptId
    ) {
      return {
        ok: false,
        code: "source-not-eligible",
        message: "Main revise is not bound to the current Attempt",
      };
    }
    if (
      review.candidateRevisionId !== revision.id
      || (
        review.acceptedPatchDigest !== undefined
        && review.acceptedPatchDigest !== revision.patchDigest
      )
    ) {
      return {
        ok: false,
        code: "stale-revision",
        message: "Main revise is not bound to the exact current CandidateRevision",
      };
    }
    return { ok: true };
  }

  return {
    ok: false,
    code: "source-not-eligible",
    message: `Goal Task handoff rejects source status ${sourceTask.status}`,
  };
}

/**
 * Validate one explicit direct Goal-Task handoff before any durable mutation.
 * Retention paths/gaps and destination Profile are confirmed together.
 */
export function validateGoalTaskHandoffRequest(
  store: StateStore,
  settings: ForkLightSettings,
  request: GoalTaskHandoffRequest,
  readiness: HandoffReadiness,
): GoalTaskHandoffAuthorizationContext {
  if (request.confirm !== true) {
    throw new CandidateHandoffError(
      "confirm-required",
      "goal task handoff requires explicit confirm: true",
      "inspect-failure",
    );
  }
  const reason = normalizeReason(request.reason);
  const taskId = request.taskId.trim();
  if (taskId.length === 0) {
    throw new CandidateHandoffError(
      "not-goal-task",
      "goal task handoff requires a non-empty source Task id",
      "inspect-failure",
    );
  }

  let sourceTask: TaskRecord;
  try {
    sourceTask = store.getTask(taskId);
  } catch {
    throw new CandidateHandoffError(
      "not-goal-task",
      `Task ${taskId} was not found`,
      "inspect-failure",
    );
  }

  rejectIfSourceIsSuccessor(store, sourceTask.id);

  // Source of an existing handoff cannot hand off again (one hop / one successor).
  if (store.listCandidateHandoffsBySourceTaskId(sourceTask.id).length > 0) {
    throw new CandidateHandoffError(
      "duplicate-handoff",
      "a handoff already exists for this Goal Task source",
      "wait-for-successor",
    );
  }

  const goal = store.getGoalByTaskId(sourceTask.id);
  if (goal === undefined) {
    throw new CandidateHandoffError(
      "not-goal-task",
      "direct Goal handoff requires a durable Goal milestone Task",
      "inspect-failure",
    );
  }
  if (
    goal.status === "stopped"
    || goal.status === "completed"
    || goal.status === "failed"
  ) {
    throw new CandidateHandoffError(
      "goal-terminal",
      `Goal is ${goal.status}; direct handoff is not admitted`,
      "none",
    );
  }

  const milestones = store.getGoalMilestones(goal.id);
  const milestone = milestones.find((entry) => entry.taskId === sourceTask.id);
  if (milestone === undefined) {
    throw new CandidateHandoffError(
      "not-goal-task",
      "source Task is not linked as a Goal milestone Plan Task",
      "inspect-failure",
    );
  }

  // Competition Candidates use the Competition handoff path, not direct Goal handoff.
  if (store.getCompetitionByCandidateTaskId(sourceTask.id) !== undefined) {
    throw new CandidateHandoffError(
      "not-goal-task",
      "Competition Candidate Tasks must use competition handoff, not direct Goal handoff",
      "inspect-failure",
    );
  }

  const events = store.listEvents(sourceTask.id);
  const revision = resolveLatestRevision(events);
  if (revision === undefined || revision.taskId !== sourceTask.id) {
    throw new CandidateHandoffError(
      "missing-revision",
      "goal task handoff requires the latest CandidateRevision evidence",
      "retain-fresh-candidate",
    );
  }
  if (revision.id !== request.candidateRevisionId) {
    throw new CandidateHandoffError(
      "stale-revision",
      "goal task handoff candidateRevisionId does not match the latest CandidateRevision",
      "retain-fresh-candidate",
    );
  }
  if (!candidateRevisionMatchesCurrentDiff(sourceTask, revision)) {
    throw new CandidateHandoffError(
      "stale-revision",
      "Candidate Diff no longer matches the exact CandidateRevision",
      "retain-fresh-candidate",
    );
  }

  const eligibility = isGoalTaskHandoffSourceEligible(store, sourceTask, revision);
  if (!eligibility.ok) {
    throw new CandidateHandoffError(
      eligibility.code,
      eligibility.message,
      eligibility.code === "stale-revision" || eligibility.code === "missing-revision"
        ? "retain-fresh-candidate"
        : "inspect-failure",
    );
  }

  const { gapContract, gapContractDigest } = requireGapContract(
    revision,
    request.reusablePaths,
    request.remainingGaps,
  );
  rejectIfDuplicateRevision(store, revision.id);

  const { destinationSelection, destinationIdentity } = resolveDestinationSelection(
    settings,
    request.destinationWorkerProfileId,
    sourceProfileId(sourceTask),
    readiness,
  );

  return {
    origin: {
      kind: "goal-task",
      goalId: goal.id,
      itemId: milestone.itemId,
    },
    goal,
    milestone,
    sourceTask,
    revision,
    gapContract,
    gapContractDigest,
    destinationIdentity,
    destinationSelection,
    reason,
  };
}

function privateRevisionArtifactPath(task: TaskRecord, revisionId: string): string {
  return path.join(task.paths.root, "revisions", `${revisionId}.patch`);
}

function buildSuccessorTask(
  store: StateStore,
  settings: ForkLightSettings,
  context: SharedHandoffDeliveryContext,
  successorId: string,
  now: string,
): TaskRecord {
  const successorSpec = buildHandoffSuccessorSpec(
    context.sourceTask.spec,
    context.destinationSelection,
    {
      reusablePaths: context.gapContract.reusablePaths,
      remainingGaps: context.gapContract.remainingGaps,
      digestPrefix: context.revision.patchDigest.slice(0, 12),
    },
  );
  // Effective policy freezes destination Profile advanced policy (source-Task
  // advancedPolicyOverride was stripped in buildHandoffSuccessorSpec).
  const effectivePolicy = resolveTaskEffectivePolicy(
    successorSpec,
    settings,
    enforcementCapabilityForRuntime(successorSpec.runtime.name),
  );
  const home = path.dirname(store.databasePath);
  return buildTaskRecord({
    spec: successorSpec,
    taskFile: context.sourceTask.taskFile,
    home,
    id: successorId,
    sessionId: randomUUID(),
    createdAt: now,
    effectivePolicy,
  });
}

function buildAuthorizedHandoffRecord(
  context: SharedHandoffDeliveryContext,
  handoffId: string,
  successorId: string,
  now: string,
): CandidateHandoffRecord {
  return {
    schemaVersion: 1,
    id: handoffId,
    status: "authorized",
    origin: context.origin,
    sourceTaskId: context.sourceTask.id,
    sourceCandidateRevisionId: context.revision.id,
    sourcePatchDigest: context.revision.patchDigest,
    gapContractDigest: context.gapContractDigest,
    reusablePathCount: context.gapContract.reusablePaths.length,
    remainingGapCount: context.gapContract.remainingGaps.length,
    reusablePaths: [...context.gapContract.reusablePaths],
    remainingGaps: context.gapContract.remainingGaps.map((gap) => ({
      description: gap.description,
      acceptanceExpectation: gap.acceptanceExpectation,
    })),
    destinationWorkerProfileId: context.destinationIdentity.workerProfileId!,
    destinationIdentity: context.destinationIdentity,
    successorTaskId: successorId,
    reason: context.reason,
    createdAt: now,
    updatedAt: now,
    nextAction: "wait-for-successor",
  };
}

function originAuthorizationPayload(
  record: CandidateHandoffRecord,
  revision: CandidateRevision,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    handoffId: record.id,
    originKind: record.origin.kind,
    sourceTaskId: record.sourceTaskId,
    sourceCandidateRevisionId: record.sourceCandidateRevisionId,
    sourceDigestPrefix: revision.patchDigest.slice(0, 12),
    gapContractDigestPrefix: record.gapContractDigest.slice(0, 12),
    reusablePathCount: record.reusablePathCount,
    remainingGapCount: record.remainingGapCount,
    // Main-approved relative paths and bounded gap text only — never patch bytes.
    reusablePaths: record.reusablePaths,
    remainingGaps: record.remainingGaps,
    destinationWorkerProfileId: record.destinationWorkerProfileId,
    destinationIdentity: record.destinationIdentity,
    successorTaskId: record.successorTaskId,
    nextAction: record.nextAction,
    // Source Task event only — successor is not a retry.
    kind: "cross-worker-handoff",
  };
  if (record.origin.kind === "competition") {
    base.competitionId = record.origin.competitionId;
    base.sourceCandidateId = record.origin.sourceCandidateId;
  } else {
    base.goalId = record.origin.goalId;
    base.itemId = record.origin.itemId;
  }
  return base;
}

/** Atomically authorize one handoff: durable record + successor Task (queued, unprepared). */
export function authorizeCandidateHandoff(
  store: StateStore,
  settings: ForkLightSettings,
  context: CandidateHandoffAuthorizationContext,
): CandidateHandoffRecord {
  const now = timestamp();
  const handoffId = randomUUID();
  const successorId = randomUUID();
  const successor = buildSuccessorTask(store, settings, context, successorId, now);
  const record = buildAuthorizedHandoffRecord(context, handoffId, successorId, now);

  store.createCandidateHandoff({
    record,
    task: successor,
    creationEvent: {
      summary: `Handoff successor Task created for destination ${record.destinationWorkerProfileId}`,
      payload: {
        handoffId,
        originKind: "competition",
        sourceTaskId: context.sourceTask.id,
        sourceCandidateId: context.candidate.id,
        competitionId: context.competition.id,
        destinationWorkerProfileId: record.destinationWorkerProfileId,
        kind: "cross-worker-handoff",
      },
    },
    authorizationEvent: {
      summary: "Main authorized one cross-Worker Candidate handoff",
      payload: originAuthorizationPayload(record, context.revision),
    },
  });

  return store.getCandidateHandoff(handoffId);
}

/**
 * Atomically authorize one direct Goal-Task handoff: retained path/gap evidence,
 * typed handoff origin, frozen destination, and exactly one successor Task.
 */
export function authorizeGoalTaskHandoff(
  store: StateStore,
  settings: ForkLightSettings,
  context: GoalTaskHandoffAuthorizationContext,
): CandidateHandoffRecord {
  const now = timestamp();
  const handoffId = randomUUID();
  const successorId = randomUUID();
  const successor = buildSuccessorTask(store, settings, context, successorId, now);
  const record = buildAuthorizedHandoffRecord(context, handoffId, successorId, now);

  store.createCandidateHandoff({
    record,
    task: successor,
    creationEvent: {
      summary: `Goal handoff successor Task created for destination ${record.destinationWorkerProfileId}`,
      payload: {
        handoffId,
        originKind: "goal-task",
        goalId: context.goal.id,
        itemId: context.milestone.itemId,
        sourceTaskId: context.sourceTask.id,
        destinationWorkerProfileId: record.destinationWorkerProfileId,
        kind: "cross-worker-handoff",
      },
    },
    authorizationEvent: {
      summary: "Main authorized one direct Goal-Task Candidate handoff",
      payload: originAuthorizationPayload(record, context.revision),
    },
  });

  return store.getCandidateHandoff(handoffId);
}

/** Prepare an authorized handoff: materialize selected paths, then mark prepared. */
export async function prepareCandidateHandoff(
  store: StateStore,
  handoffId: string,
): Promise<CandidateHandoffRecord> {
  const record = store.getCandidateHandoff(handoffId);
  if (record.status === "prepared") {
    return record;
  }
  if (record.status === "failed") {
    return record;
  }

  const successor = store.getTask(record.successorTaskId);
  const sourceTask = store.getTask(record.sourceTaskId);
  const events = store.listEvents(sourceTask.id);
  const revision = resolveLatestRevision(events);
  if (
    revision === undefined
    || revision.id !== record.sourceCandidateRevisionId
    || revision.patchDigest !== record.sourcePatchDigest
  ) {
    return failHandoffPreparation(
      store,
      record,
      "stale-revision",
      "source CandidateRevision is missing or no longer matches the authorized handoff",
    );
  }

  const now = timestamp();
  // Omit optional timestamp/failure fields so exactOptionalPropertyTypes never
  // sees an explicit `undefined` on preparedAt/failedAt/failureCode.
  const {
    preparedAt: _dropPreparedAt,
    failedAt: _dropFailedAt,
    failureCode: _dropFailureCode,
    ...preparingBase
  } = record;
  void _dropPreparedAt;
  void _dropFailedAt;
  void _dropFailureCode;
  store.updateCandidateHandoff({
    ...preparingBase,
    status: "preparing",
    updatedAt: now,
    nextAction: "wait-for-successor",
  });
  store.setTaskStatus(successor.id, "preparing", { finishedAt: null, error: null });

  try {
    const artifact = privateRevisionArtifactPath(sourceTask, revision.id);
    // Ensure private artifact path matches the immutable capture convention.
    const expected = artifact;
    await materializeSelectedCandidatePaths({
      successor: store.getTask(successor.id),
      sourceTask,
      revision,
      reusablePaths: record.reusablePaths,
      privateArtifactPath: expected,
    });
    const preparedAt = timestamp();
    const current = store.getCandidateHandoff(handoffId);
    const {
      failedAt: _dropFailedAt2,
      failureCode: _dropFailureCode2,
      ...preparedBase
    } = current;
    void _dropFailedAt2;
    void _dropFailureCode2;
    const prepared: CandidateHandoffRecord = {
      ...preparedBase,
      status: "prepared",
      updatedAt: preparedAt,
      preparedAt,
      nextAction: "wait-for-successor",
    };
    store.updateCandidateHandoff(prepared);
    store.setTaskStatus(successor.id, "queued", { finishedAt: null, error: null });
    store.addEvent(
      successor.id,
      undefined,
      "workspace.prepared",
      "Handoff successor workspace prepared from current project with selected Candidate paths",
      {
        handoffId,
        importedPathCount: record.reusablePathCount,
        baseline: successor.paths.baseline,
        workspace: successor.paths.workspace,
      },
    );
    store.addEvent(
      successor.id,
      undefined,
      "candidate.handoff.prepared",
      "Cross-Worker handoff preparation completed",
      {
        handoffId,
        importedPathCount: record.reusablePathCount,
        sourceDigestPrefix: record.sourcePatchDigest.slice(0, 12),
      },
    );
    return store.getCandidateHandoff(handoffId);
  } catch (error) {
    const code = error instanceof CandidateHandoffError
      ? error.code
      : "materialization-failed";
    const message = error instanceof Error ? error.message : String(error);
    // Wipe partial preparation so recovery does not launch on a bad workspace.
    await rm(successor.paths.baseline, { recursive: true, force: true }).catch(() => {});
    await rm(successor.paths.workspace, { recursive: true, force: true }).catch(() => {});
    await rm(path.join(successor.paths.root, "source-manifest.json"), { force: true }).catch(() => {});
    return failHandoffPreparation(store, store.getCandidateHandoff(handoffId), code, message);
  }
}

function failHandoffPreparation(
  store: StateStore,
  record: CandidateHandoffRecord,
  code: CandidateHandoffFailureCode,
  message: string,
): CandidateHandoffRecord {
  const failedAt = timestamp();
  const nextAction: CandidateHandoffNextAction =
    code === "profile-not-launchable" || code === "same-profile" || code === "profile-unknown"
      ? "choose-different-profile"
      : code === "stale-revision" || code === "missing-retained" || code === "missing-revision"
        ? "retain-fresh-candidate"
        : code === "goal-terminal" || code === "source-is-successor" || code === "final-choice"
          ? "none"
          : "inspect-failure";
  const {
    preparedAt: _dropPreparedOnFail,
    ...failedBase
  } = record;
  void _dropPreparedOnFail;
  const failed: CandidateHandoffRecord = {
    ...failedBase,
    status: "failed",
    updatedAt: failedAt,
    failedAt,
    failureCode: code,
    nextAction,
  };
  store.updateCandidateHandoff(failed);
  store.setTaskStatus(record.successorTaskId, "failed", {
    finishedAt: failedAt,
    error: `Handoff preparation failed: ${message}`.slice(0, 1000),
  });
  store.addEvent(
    record.successorTaskId,
    undefined,
    "candidate.handoff.failed",
    "Cross-Worker handoff preparation failed; no Worker launched",
    {
      handoffId: record.id,
      failureCode: code,
      // Bounded message only — never raw patch or private paths.
      message: message.slice(0, 300),
    },
  );
  // Also record on the source for audit without mutating source status.
  store.addEvent(
    record.sourceTaskId,
    undefined,
    "candidate.handoff.failed",
    "Cross-Worker handoff preparation failed; source Task unchanged",
    {
      handoffId: record.id,
      successorTaskId: record.successorTaskId,
      failureCode: code,
      message: message.slice(0, 300),
    },
  );
  return store.getCandidateHandoff(record.id);
}

/**
 * Return an existing handoff only for an exact replay of competition, candidate,
 * revision, destination Profile, and canonical reason. Any other request for the
 * same revision rejects before mutation so one successor is preserved.
 */
function resolveExistingHandoffOrReject(
  existing: CandidateHandoffRecord,
  request: CandidateHandoffRequest,
  canonicalReason: string,
): CandidateHandoffRecord {
  if (isExactHandoffReplay(existing, request, canonicalReason)) {
    return existing;
  }
  throw new CandidateHandoffError(
    "duplicate-handoff",
    "a handoff already exists for this exact retained CandidateRevision; only an exact replay of competition, candidate, revision, destination Profile, and reason is idempotent",
    "wait-for-successor",
  );
}

/**
 * Full confirmed Competition handoff: validate → authorize → prepare → return projection.
 * On preparation failure the durable record remains for inspection and no
 * Worker is launched. Idempotent recovery re-enters via recoverCandidateHandoffs.
 * An existing handoff is returned only for an exact authorization replay.
 */
export async function executeCandidateHandoff(
  store: StateStore,
  settings: ForkLightSettings,
  request: CandidateHandoffRequest,
  readiness: HandoffReadiness,
): Promise<CandidateHandoffView> {
  // Canonical reason is required for exact-replay comparison even when a prior
  // record exists, so a changed reason cannot silently reuse another handoff.
  const canonicalReason = normalizeReason(request.reason);

  const existing = store.getCandidateHandoffBySourceRevisionId(request.candidateRevisionId);
  if (existing !== undefined) {
    const matched = resolveExistingHandoffOrReject(existing, request, canonicalReason);
    if (matched.status === "authorized" || matched.status === "preparing") {
      const prepared = await prepareCandidateHandoff(store, matched.id);
      const successor = store.getTask(prepared.successorTaskId);
      return projectCandidateHandoff(prepared, successor.status);
    }
    const successor = store.getTask(matched.successorTaskId);
    return projectCandidateHandoff(matched, successor.status);
  }

  const context = validateCandidateHandoffRequest(store, settings, request, readiness);
  // validate already normalizes reason; keep the same canonical string for the record.
  if (context.reason !== canonicalReason) {
    // Defense in depth: authorize must store the same reason used for replay checks.
    throw new CandidateHandoffError(
      "reason-invalid",
      "handoff reason normalization mismatch",
      "inspect-failure",
    );
  }
  let authorized: CandidateHandoffRecord;
  try {
    authorized = authorizeCandidateHandoff(store, settings, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed/i.test(message)) {
      const raced = store.getCandidateHandoffBySourceRevisionId(request.candidateRevisionId);
      if (raced !== undefined) {
        const matched = resolveExistingHandoffOrReject(raced, request, canonicalReason);
        if (matched.status === "authorized" || matched.status === "preparing") {
          const preparedRace = await prepareCandidateHandoff(store, matched.id);
          return projectCandidateHandoff(
            preparedRace,
            store.getTask(preparedRace.successorTaskId).status,
          );
        }
        return projectCandidateHandoff(
          matched,
          store.getTask(matched.successorTaskId).status,
        );
      }
      throw new CandidateHandoffError(
        "duplicate-handoff",
        "a handoff already exists for this exact retained CandidateRevision",
        "wait-for-successor",
      );
    }
    throw error;
  }
  const prepared = await prepareCandidateHandoff(store, authorized.id);
  const successor = store.getTask(prepared.successorTaskId);
  return projectCandidateHandoff(prepared, successor.status);
}

function resolveExistingGoalHandoffOrReject(
  existing: CandidateHandoffRecord,
  request: GoalTaskHandoffRequest,
  canonicalReason: string,
  gapContractDigest: string,
): CandidateHandoffRecord {
  if (isExactGoalTaskHandoffReplay(existing, request, canonicalReason, gapContractDigest)) {
    return existing;
  }
  throw new CandidateHandoffError(
    "duplicate-handoff",
    "a handoff already exists for this exact Goal Task CandidateRevision; only an exact replay of task, revision, retained paths/gaps, destination Profile, and reason is idempotent",
    "wait-for-successor",
  );
}

/**
 * Full confirmed direct Goal-Task handoff: validate retained paths/gaps +
 * destination → authorize atomically → prepare → return projection.
 * Never creates a Competition. Source Task identity and Goal milestone linkage
 * stay immutable; Goal supervision follows the successor via lineage.
 */
export async function executeGoalTaskHandoff(
  store: StateStore,
  settings: ForkLightSettings,
  request: GoalTaskHandoffRequest,
  readiness: HandoffReadiness,
): Promise<CandidateHandoffView> {
  if (request.confirm !== true) {
    throw new CandidateHandoffError(
      "confirm-required",
      "goal task handoff requires explicit confirm: true",
      "inspect-failure",
    );
  }
  const canonicalReason = normalizeReason(request.reason);
  const requestTaskId = request.taskId.trim();
  if (requestTaskId.length === 0) {
    throw new CandidateHandoffError(
      "not-goal-task",
      "goal task handoff requires a non-empty source Task id",
      "inspect-failure",
    );
  }

  // One-hop authority is checked before replay lookup so a successor cannot
  // masquerade as the source by presenting its parent's revision id.
  rejectIfSourceIsSuccessor(store, requestTaskId);

  const existing = store.getCandidateHandoffBySourceRevisionId(request.candidateRevisionId);
  if (existing !== undefined) {
    // Mismatched taskId + existing revision is never an exact replay: reject
    // before any digest rebuild against the wrong Task workspace.
    if (existing.sourceTaskId !== requestTaskId) {
      throw new CandidateHandoffError(
        "duplicate-handoff",
        "a handoff already exists for this CandidateRevision on a different source Task; exact replay requires the same taskId",
        "wait-for-successor",
      );
    }
    // Exact replay requires request paths/gaps to rebuild the same digest.
    let requestDigest = "";
    try {
      const sourceTask = store.getTask(existing.sourceTaskId);
      const revision = resolveLatestRevision(store.listEvents(sourceTask.id));
      if (revision === undefined) {
        throw new CandidateHandoffError(
          "duplicate-handoff",
          "a handoff already exists for this CandidateRevision",
          "wait-for-successor",
        );
      }
      const contract = buildCandidateGapContract(
        revision.id,
        request.reusablePaths,
        request.remainingGaps,
        revision.affectedPaths,
      );
      requestDigest = computeGapContractDigest(contract);
    } catch (error) {
      if (error instanceof CandidateHandoffError) throw error;
      throw new CandidateHandoffError(
        "duplicate-handoff",
        "a handoff already exists for this CandidateRevision; retained paths/gaps must match exactly for replay",
        "wait-for-successor",
      );
    }
    const matched = resolveExistingGoalHandoffOrReject(
      existing,
      request,
      canonicalReason,
      requestDigest,
    );
    if (matched.status === "authorized" || matched.status === "preparing") {
      const prepared = await prepareCandidateHandoff(store, matched.id);
      return projectCandidateHandoff(
        prepared,
        store.getTask(prepared.successorTaskId).status,
      );
    }
    return projectCandidateHandoff(
      matched,
      store.getTask(matched.successorTaskId).status,
    );
  }

  const context = validateGoalTaskHandoffRequest(store, settings, request, readiness);
  if (context.reason !== canonicalReason) {
    throw new CandidateHandoffError(
      "reason-invalid",
      "handoff reason normalization mismatch",
      "inspect-failure",
    );
  }

  let authorized: CandidateHandoffRecord;
  try {
    authorized = authorizeGoalTaskHandoff(store, settings, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed/i.test(message)) {
      const raced = store.getCandidateHandoffBySourceRevisionId(request.candidateRevisionId);
      if (raced !== undefined) {
        const matched = resolveExistingGoalHandoffOrReject(
          raced,
          request,
          canonicalReason,
          raced.gapContractDigest,
        );
        if (matched.status === "authorized" || matched.status === "preparing") {
          const preparedRace = await prepareCandidateHandoff(store, matched.id);
          return projectCandidateHandoff(
            preparedRace,
            store.getTask(preparedRace.successorTaskId).status,
          );
        }
        return projectCandidateHandoff(
          matched,
          store.getTask(matched.successorTaskId).status,
        );
      }
      throw new CandidateHandoffError(
        "duplicate-handoff",
        "a handoff already exists for this exact Goal Task CandidateRevision",
        "wait-for-successor",
      );
    }
    throw error;
  }
  const prepared = await prepareCandidateHandoff(store, authorized.id);
  return projectCandidateHandoff(
    prepared,
    store.getTask(prepared.successorTaskId).status,
  );
}

/**
 * Restart recovery: finish authorized/preparing handoffs; re-queue prepared
 * successors once. A successor interrupted before verification receives at
 * most one durable restart-continuation grant, independent from quality retry
 * and Main-correction budgets.
 */
export async function recoverCandidateHandoffs(
  store: StateStore,
): Promise<{ recoveredHandoffIds: string[]; queueTaskIds: string[] }> {
  const recoveredHandoffIds: string[] = [];
  const queueTaskIds: string[] = [];
  for (const record of store.listCandidateHandoffs()) {
    if (record.status === "authorized" || record.status === "preparing") {
      const prepared = await prepareCandidateHandoff(store, record.id);
      recoveredHandoffIds.push(prepared.id);
      if (prepared.status === "prepared") {
        queueTaskIds.push(prepared.successorTaskId);
      }
      continue;
    }
    if (record.status === "prepared") {
      let task = store.getTask(record.successorTaskId);
      if (task.status === "interrupted" || task.status === "failed") {
        const baseMaxAttempts = task.effectivePolicy?.values.baseMaxAttempts ?? 1;
        const recovery = authorizeHandoffRestartRecovery(
          store,
          task.id,
          record.id,
          baseMaxAttempts,
        );
        if (recovery !== null) {
          queueTaskIds.push(task.id);
          recoveredHandoffIds.push(record.id);
          continue;
        }
      }
      if (task.status === "queued") {
        queueTaskIds.push(task.id);
        recoveredHandoffIds.push(record.id);
      }
    }
  }
  return { recoveredHandoffIds, queueTaskIds };
}

/** Resolve handoff view for a Task (source or successor). */
export function resolveHandoffViewForTask(
  store: StateStore,
  taskId: string,
): CandidateHandoffView | undefined {
  const asSuccessor = store.getCandidateHandoffBySuccessorTaskId(taskId);
  if (asSuccessor !== undefined) {
    const successor = store.getTask(asSuccessor.successorTaskId);
    return {
      ...projectCandidateHandoff(asSuccessor, successor.status),
      isSuccessor: true,
    };
  }
  const asSource = store.listCandidateHandoffsBySourceTaskId(taskId);
  if (asSource.length === 0) return undefined;
  // One hop: at most one durable handoff per source revision; surface the latest.
  const latest = asSource.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));
  const successor = store.getTask(latest.successorTaskId);
  return {
    ...projectCandidateHandoff(latest, successor.status),
    isSuccessor: false,
  };
}

/** Copy a private revision artifact for tests/helpers when only event payload is available. */
export async function ensurePrivateRevisionArtifact(
  task: TaskRecord,
  revisionId: string,
  patchBytes: Buffer | string,
): Promise<string> {
  const revisionsDir = path.join(task.paths.root, "revisions");
  await mkdir(revisionsDir, { recursive: true, mode: 0o700 });
  const artifactPath = path.join(revisionsDir, `${revisionId}.patch`);
  try {
    await stat(artifactPath);
  } catch {
    await writeFile(artifactPath, patchBytes, { mode: 0o600 });
    await chmod(artifactPath, 0o600);
  }
  return artifactPath;
}
