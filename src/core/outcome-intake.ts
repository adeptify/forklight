/**
 * Outcome intake: durable record of what a user wants to achieve without
 * creating any work. A pending intake carries the user's desired result plus
 * an optional shape preference (auto/task/plan/goal). Main later attaches one
 * explicit Task, Work Plan, or Goal proposal backed by the existing contract
 * loaders and quality gates. Nothing in this module runs a Worker, calls a
 * Provider, or creates a Task/Plan/Goal record.
 *
 * Boundaries:
 *   - No runtime call, shape heuristic, contract generation, or work creation.
 *   - Reuses the existing loaders; stores validated facts and artifact identity
 *     (digest), never raw contract content.
 *   - Privacy-safe projections only: the absolute artifact path is never
 *     echoed outside the stored record.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isoTimestamp as timestamp } from "./time.js";

export const OUTCOME_INTAKE_SCHEMA_VERSION = 1 as const;

/** Bounded lengths for every user/Main-authored string. */
export const OUTCOME_INTAKE_OUTCOME_MAX = 2000;
export const OUTCOME_INTAKE_CONTEXT_MAX = 2000;
export const OUTCOME_INTAKE_PROJECT_MAX = 500;
export const OUTCOME_INTAKE_REASON_MAX = 1000;
export const OUTCOME_INTAKE_ARTIFACT_PATH_MAX = 4096;
export const OUTCOME_INTAKE_ID_MAX = 128;

/** Validated default and hard maximum for every outcome-intake list surface. */
export const OUTCOME_INTAKE_LIST_DEFAULT_LIMIT = 20;
export const OUTCOME_INTAKE_LIST_MAX_LIMIT = 100;

/** Bound a list limit. Undefined/null resolve to the safe default; any other
 *  non-integer or out-of-range value fails closed with a fixed message that
 *  never echoes the supplied value. */
export function normalizeOutcomeIntakeListLimit(value: unknown): number {
  if (value === undefined || value === null) return OUTCOME_INTAKE_LIST_DEFAULT_LIMIT;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error("limit must be an integer from 1 to 100");
  }
  if (value < 1 || value > OUTCOME_INTAKE_LIST_MAX_LIMIT) {
    throw new Error("limit must be an integer from 1 to 100");
  }
  return value;
}

/** Fixed privacy-safe stale-revision reason shared by daemon, MCP, and Hub.
 *  It never echoes the intake id, revision, or any content. */
export const STALE_OUTCOME_INTAKE_REASON =
  "Outcome intake revision is out of date; re-read the intake before proposing.";

/** Fixed privacy-safe stale-revision reason for the confirmation authority. It
 *  never echoes the intake id, revision, or any content. */
export const STALE_OUTCOME_INTAKE_CONFIRM_REASON =
  "Outcome intake revision is out of date; re-read the intake before confirming.";

/** Fixed privacy-safe reason when an intake has no Main proposal to confirm. */
export const OUTCOME_INTAKE_NO_PROPOSAL_REASON =
  "Outcome intake has no Main proposal to confirm.";

/** Fixed privacy-safe reason when a bound artifact graph changed after proposal.
 *  It never echoes the artifact path, content, or digest. */
export const OUTCOME_INTAKE_STALE_ARTIFACT_REASON =
  "Outcome intake artifact graph changed after proposal; re-read the intake before confirming.";

/** Fixed privacy-safe reason when another confirmation for the same intake is
 *  already running. The caller retries after the first confirmation commits. */
export const OUTCOME_INTAKE_CONFIRM_IN_PROGRESS_REASON =
  "Outcome intake confirmation is already in progress; re-read the intake before confirming.";

export type OutcomeIntakeStatus = "pending" | "proposed" | "created";

/** The user's requested shape. `auto` means the user has not decided. */
export type ShapePreference = "auto" | "task" | "plan" | "goal";

/** The explicit shape Main selects in one proposal. */
export type ProposedShape = "task" | "plan" | "goal";

export type OutcomeIntakeArtifactKind = "task-contract" | "work-plan" | "goal";

/** Validated facts extracted from the bound artifact. Never raw contract text. */
export interface OutcomeIntakeArtifactFacts {
  shape: ProposedShape;
  displayName: string;
  objective: string;
  taskCount: number;
  /** Goal file version (1 or 2). Present only for Goal proposals so the
   *  confirmation story can name the exact contract family. */
  goalVersion?: 1 | 2;
  /** Dependency waves when the artifact is a Plan or Goal-backed Plan. */
  dependencyWaves?: string[][];
  /** Distinct structured Task contract versions (2 or 3) bound by the loaded
   *  artifact. Absent only on legacy facts loads; the version-2 confirmation
   *  story is preserved for them. */
  taskContractVersions?: Array<2 | 3>;
}

/** One explicit Main proposal bound to a validated artifact. */
export interface OutcomeIntakeProposal {
  shape: ProposedShape;
  /** Short plain-language Main reason (1–1000 chars). */
  reason: string;
  /** Absolute artifact file path — stored privately, never projected. */
  artifactPath: string;
  /** SHA-256 hex digest of the exact artifact bytes at proposal time. */
  artifactDigest: string;
  artifactKind: OutcomeIntakeArtifactKind;
  displayName: string;
  objective: string;
  taskCount: number;
  /** Goal file version when the proposal is a Goal artifact. */
  goalVersion?: 1 | 2;
  dependencyWaves?: string[][];
  /** Distinct structured Task contract versions (2 or 3) bound by the
   *  artifact. Absent only on legacy stored proposals; the version-2 story is
   *  preserved for them. */
  taskContractVersions?: Array<2 | 3>;
  proposedAt: string;
}

/** Closed versioned outcome-intake record. Immutable id; revision guards every
 *  replacement. `proposal` is present only after an explicit Main proposal. */
export interface OutcomeIntakeRecord {
  schemaVersion: 1;
  id: string;
  outcome: string;
  project?: string;
  context?: string;
  requestedShape: ShapePreference;
  status: OutcomeIntakeStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  proposal?: OutcomeIntakeProposal;
  confirmation?: OutcomeIntakeConfirmationReceipt;
}

/** Normalized create input after bounded validation. */
export interface OutcomeIntakeCreateInput {
  outcome: string;
  project?: string;
  context?: string;
  requestedShape: ShapePreference;
}

/** Normalized proposal input after bounded validation. */
export interface OutcomeIntakeProposeInput {
  intakeId: string;
  expectedRevision: number;
  shape: ProposedShape;
  reason: string;
  artifactPath: string;
}

/** Normalized confirmation input after bounded validation. The only accepted
 *  fields are intakeId, expectedRevision, and the literal confirm:true. */
export interface OutcomeIntakeConfirmInput {
  intakeId: string;
  expectedRevision: number;
  confirm: true;
}

/** Durable privacy-safe confirmation receipt linked to a created intake. It
 *  records the proposal revision identity, a bounded digest prefix, the created
 *  shape, and canonical created ids — never the artifact path or raw contracts. */
export interface OutcomeIntakeConfirmationReceipt {
  receiptId: string;
  intakeId: string;
  /** The intake proposal revision that was confirmed. */
  proposalRevision: number;
  /** Bounded digest identity; the full artifact graph digest is never exposed. */
  artifactDigestPrefix: string;
  shape: ProposedShape;
  taskIds: string[];
  planId?: string;
  goalId?: string;
  confirmedAt: string;
}

/** Privacy-safe public confirmation projection. Identical shape to the receipt
 *  because every stored receipt field is already privacy-safe. */
export type OutcomeIntakeConfirmationView = OutcomeIntakeConfirmationReceipt;

/** A loaded artifact plus its digest identity. */
export interface OutcomeIntakeArtifactLoad {
  facts: OutcomeIntakeArtifactFacts;
  artifactDigest: string;
}

/** Unsafe ASCII control characters are rejected in every user/Main-authored
 *  string. Ordinary multiline text (paragraphs, line breaks, and tabs) is safe:
 *  tab (0x09), newline (0x0a), and carriage-return (0x0d) are accepted as
 *  whitespace. NUL (0x00), DEL (0x7f), and every other control in 0x01–0x1f
 *  remain rejected. Implemented with char codes so no control byte can be
 *  embedded in this source file. */
function containsUnsafeControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x7f || (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d)) {
      return true;
    }
  }
  return false;
}

function boundedTrimmedString(
  value: unknown,
  label: string,
  min: number,
  max: number,
): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new Error(`${label} must be ${min} to ${max} characters`);
  }
  if (containsUnsafeControlCharacters(trimmed)) {
    throw new Error(`${label} must not contain control characters`);
  }
  return trimmed;
}

function optionalBoundedTrimmedString(
  value: unknown,
  label: string,
  min: number,
  max: number,
): string | undefined {
  if (value === undefined) return undefined;
  return boundedTrimmedString(value, label, min, max);
}

function normalizeShapePreference(value: unknown): ShapePreference {
  if (value === undefined) return "auto";
  if (value !== "auto" && value !== "task" && value !== "plan" && value !== "goal") {
    throw new Error("requestedShape must be auto, task, plan, or goal");
  }
  return value as ShapePreference;
}

/** Validate and bound a create request. Rejects unknown fields and unsafe
 *  values with fixed messages that never echo the rejected content. */
export function normalizeOutcomeIntakeCreate(input: unknown): OutcomeIntakeCreateInput {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("outcome intake create requires a non-null object");
  }
  const record = input as Record<string, unknown>;
  const allowed = new Set(["outcome", "project", "context", "requestedShape"]);
  const extra = Object.keys(record).filter((key) => !allowed.has(key));
  if (extra.length > 0) {
    throw new Error("outcome intake contains unknown fields");
  }
  const outcome = boundedTrimmedString(record.outcome, "outcome", 1, OUTCOME_INTAKE_OUTCOME_MAX);
  const requestedShape = normalizeShapePreference(record.requestedShape);
  const project = optionalBoundedTrimmedString(record.project, "project", 1, OUTCOME_INTAKE_PROJECT_MAX);
  const context = optionalBoundedTrimmedString(record.context, "context", 1, OUTCOME_INTAKE_CONTEXT_MAX);
  return {
    outcome,
    requestedShape,
    ...(project === undefined ? {} : { project }),
    ...(context === undefined ? {} : { context }),
  };
}

/** Validate and bound a proposal request. The artifact path must be absolute. */
export function normalizeOutcomeIntakePropose(input: unknown): OutcomeIntakeProposeInput {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("outcome intake proposal requires a non-null object");
  }
  const record = input as Record<string, unknown>;
  const allowed = new Set(["intakeId", "expectedRevision", "shape", "reason", "artifactPath"]);
  const extra = Object.keys(record).filter((key) => !allowed.has(key));
  if (extra.length > 0) {
    throw new Error("outcome intake proposal contains unknown fields");
  }
  const intakeId = boundedTrimmedString(record.intakeId, "intakeId", 1, OUTCOME_INTAKE_ID_MAX);
  if (typeof record.expectedRevision !== "number" || !Number.isSafeInteger(record.expectedRevision)
    || record.expectedRevision < 1) {
    throw new Error("expectedRevision must be a positive integer");
  }
  if (record.shape !== "task" && record.shape !== "plan" && record.shape !== "goal") {
    throw new Error("shape must be task, plan, or goal");
  }
  const reason = boundedTrimmedString(record.reason, "reason", 1, OUTCOME_INTAKE_REASON_MAX);
  const artifactPath = boundedTrimmedString(
    record.artifactPath,
    "artifactPath",
    1,
    OUTCOME_INTAKE_ARTIFACT_PATH_MAX,
  );
  if (!path.isAbsolute(artifactPath)) {
    throw new Error("artifactPath must be an absolute file path");
  }
  return {
    intakeId,
    expectedRevision: record.expectedRevision,
    shape: record.shape as ProposedShape,
    reason,
    artifactPath,
  };
}

/** Validate and bound a confirmation request. Only intakeId, expectedRevision,
 *  and the literal confirm:true are accepted; unknown fields and any other
 *  confirm value fail closed with fixed privacy-safe messages that never echo
 *  the rejected content. */
export function normalizeOutcomeIntakeConfirm(input: unknown): OutcomeIntakeConfirmInput {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("outcome intake confirmation requires a non-null object");
  }
  const record = input as Record<string, unknown>;
  const allowed = new Set(["intakeId", "expectedRevision", "confirm"]);
  const extra = Object.keys(record).filter((key) => !allowed.has(key));
  if (extra.length > 0) {
    throw new Error("outcome intake confirmation contains unknown fields");
  }
  const intakeId = boundedTrimmedString(record.intakeId, "intakeId", 1, OUTCOME_INTAKE_ID_MAX);
  if (typeof record.expectedRevision !== "number" || !Number.isSafeInteger(record.expectedRevision)
    || record.expectedRevision < 1) {
    throw new Error("expectedRevision must be a positive integer");
  }
  if (record.confirm !== true) {
    throw new Error("outcome intake confirmation requires confirm: true");
  }
  return {
    intakeId,
    expectedRevision: record.expectedRevision,
    confirm: true,
  };
}

/** Build the immutable pending intake record (revision 1). */
export function createOutcomeIntakeRecord(
  input: OutcomeIntakeCreateInput,
  id: string,
  now: string = timestamp(),
): OutcomeIntakeRecord {
  return {
    schemaVersion: 1,
    id,
    outcome: input.outcome,
    ...(input.project === undefined ? {} : { project: input.project }),
    ...(input.context === undefined ? {} : { context: input.context }),
    requestedShape: input.requestedShape,
    status: "pending",
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function artifactKindForShape(shape: ProposedShape): OutcomeIntakeArtifactKind {
  if (shape === "task") return "task-contract";
  if (shape === "plan") return "work-plan";
  return "goal";
}

/** Distinct structured Task contract versions in ascending deterministic
 *  order. A Plan or Goal binding both versions reports each exactly once. */
export function distinctTaskContractVersions(
  versions: readonly (2 | 3)[],
): Array<2 | 3> {
  return [...new Set(versions)].sort((a, b) => a - b);
}

function taskContractVersionLabels(versions: readonly (2 | 3)[]): string[] {
  return distinctTaskContractVersions(versions).map(
    (version) => `task-contract-v${version}`,
  );
}

/** Contracts involved in confirming this shape, for the confirmation story.
 *  Goal proposals cover both file versions because a confirmed Goal may be
 *  v1 (one Plan) or v2 (two or more ordered Plans). `taskContractVersions`
 *  names the actual structured Task contract versions bound by the loaded
 *  artifact; when absent the legacy version-2 story is preserved so existing
 *  v2 records stay byte-compatible. */
export function contractsInvolvedForShape(
  shape: ProposedShape,
  goalVersion?: 1 | 2,
  taskContractVersions?: readonly (2 | 3)[],
): string[] {
  const versions = taskContractVersions !== undefined && taskContractVersions.length > 0
    ? taskContractVersions
    : ([2] as const);
  if (shape === "task") return taskContractVersionLabels(versions);
  if (shape === "plan") {
    return ["work-plan-v1", ...taskContractVersionLabels(versions)];
  }
  // Goal v1 stays the legacy family; v2 additionally identifies the multi-phase
  // contract family so the confirmation story stays truthful per file version.
  return [
    "goal-v1",
    ...(goalVersion === 2 ? ["goal-v2"] : []),
    "work-plan-v1",
    ...taskContractVersionLabels(versions),
  ];
}

/** Attach or replace the current Main proposal. Revision advances by exactly
 *  one; the caller must already have matched the expected revision atomically. */
export function buildProposedOutcomeIntake(
  current: OutcomeIntakeRecord,
  input: OutcomeIntakeProposeInput,
  artifact: OutcomeIntakeArtifactLoad,
  now: string = timestamp(),
): OutcomeIntakeRecord {
  const proposal: OutcomeIntakeProposal = {
    shape: artifact.facts.shape,
    reason: input.reason,
    artifactPath: input.artifactPath,
    artifactDigest: artifact.artifactDigest,
    artifactKind: artifactKindForShape(artifact.facts.shape),
    displayName: artifact.facts.displayName,
    objective: artifact.facts.objective,
    taskCount: artifact.facts.taskCount,
    ...(artifact.facts.goalVersion === undefined
      ? {}
      : { goalVersion: artifact.facts.goalVersion }),
    ...(artifact.facts.dependencyWaves === undefined
      ? {}
      : { dependencyWaves: artifact.facts.dependencyWaves }),
    ...(artifact.facts.taskContractVersions === undefined
      ? {}
      : { taskContractVersions: artifact.facts.taskContractVersions }),
    proposedAt: now,
  };
  return {
    ...current,
    status: "proposed",
    revision: current.revision + 1,
    updatedAt: now,
    proposal,
  };
}

/** Build the durable confirmation receipt for a created intake. The receipt is
 *  privacy-safe by construction: it records the proposal revision, a bounded
 *  digest prefix, the created shape, and canonical created ids only — never the
 *  artifact path or raw contract content. */
export function buildOutcomeIntakeConfirmationReceipt(input: {
  intakeId: string;
  proposalRevision: number;
  artifactDigest: string;
  shape: ProposedShape;
  taskIds: string[];
  planId?: string;
  goalId?: string;
  confirmedAt: string;
}): OutcomeIntakeConfirmationReceipt {
  return {
    receiptId: randomUUID(),
    intakeId: input.intakeId,
    proposalRevision: input.proposalRevision,
    artifactDigestPrefix: input.artifactDigest.slice(0, 16),
    shape: input.shape,
    taskIds: [...input.taskIds],
    ...(input.planId === undefined ? {} : { planId: input.planId }),
    ...(input.goalId === undefined ? {} : { goalId: input.goalId }),
    confirmedAt: input.confirmedAt,
  };
}

/** Move a proposed intake to the terminal created state with its durable
 *  receipt. The record revision advances by exactly one (proposal revision + 1)
 *  like every other state transition, so a stale proposal can never collide
 *  with created truth. Exactly-once idempotency is bound to the receipt's
 *  proposalRevision, not the created record revision. */
export function buildCreatedOutcomeIntake(
  current: OutcomeIntakeRecord,
  receipt: OutcomeIntakeConfirmationReceipt,
  now: string = timestamp(),
): OutcomeIntakeRecord {
  return {
    ...current,
    status: "created",
    revision: current.revision + 1,
    updatedAt: now,
    confirmation: receipt,
  };
}

export function projectOutcomeIntakeConfirmation(
  receipt: OutcomeIntakeConfirmationReceipt,
): OutcomeIntakeConfirmationView {
  return {
    ...receipt,
    taskIds: [...receipt.taskIds],
  };
}

export interface OutcomeIntakeProposalView {
  shape: ProposedShape;
  reason: string;
  artifactKind: OutcomeIntakeArtifactKind;
  artifactDigestPrefix: string;
  displayName: string;
  objective: string;
  taskCount: number;
  /** Goal file version when the proposal is a Goal artifact. */
  goalVersion?: 1 | 2;
  dependencyWaves?: string[][];
  /** Distinct structured Task contract versions bound by the artifact. */
  taskContractVersions?: Array<2 | 3>;
  proposedAt: string;
}

/** Privacy-safe public intake view. The absolute artifact path is never
 *  exposed; only the bounded artifact kind and a digest prefix are. */
export interface OutcomeIntakeView {
  schemaVersion: 1;
  id: string;
  status: OutcomeIntakeStatus;
  outcome: string;
  project?: string;
  context?: string;
  requestedShape: ShapePreference;
  revision: number;
  createdAt: string;
  updatedAt: string;
  proposal?: OutcomeIntakeProposalView;
  confirmation?: OutcomeIntakeConfirmationView;
}

function projectOutcomeIntakeProposal(proposal: OutcomeIntakeProposal): OutcomeIntakeProposalView {
  return {
    shape: proposal.shape,
    reason: proposal.reason,
    artifactKind: proposal.artifactKind,
    artifactDigestPrefix: proposal.artifactDigest.slice(0, 16),
    displayName: proposal.displayName,
    objective: proposal.objective,
    taskCount: proposal.taskCount,
    ...(proposal.goalVersion === undefined ? {} : { goalVersion: proposal.goalVersion }),
    ...(proposal.dependencyWaves === undefined
      ? {}
      : { dependencyWaves: proposal.dependencyWaves }),
    ...(proposal.taskContractVersions === undefined
      ? {}
      : { taskContractVersions: proposal.taskContractVersions }),
    proposedAt: proposal.proposedAt,
  };
}

export function projectOutcomeIntake(record: OutcomeIntakeRecord): OutcomeIntakeView {
  return {
    schemaVersion: 1,
    id: record.id,
    status: record.status,
    outcome: record.outcome,
    ...(record.project === undefined ? {} : { project: record.project }),
    ...(record.context === undefined ? {} : { context: record.context }),
    requestedShape: record.requestedShape,
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.proposal === undefined
      ? {}
      : { proposal: projectOutcomeIntakeProposal(record.proposal) }),
    ...(record.confirmation === undefined
      ? {}
      : { confirmation: projectOutcomeIntakeConfirmation(record.confirmation) }),
  };
}

/** Privacy-safe confirmation preview built from validated facts only. It
 *  explicitly states that confirmation has not happened and nothing was
 *  created. */
export interface OutcomeIntakeConfirmationPreview {
  intakeId: string;
  intakeRevision: number;
  status: "proposed";
  outcome: string;
  requestedShape: ShapePreference;
  selectedShape: ProposedShape;
  reason: string;
  displayName: string;
  objective: string;
  taskCount: number;
  dependencyWaves?: string[][];
  artifactKind: OutcomeIntakeArtifactKind;
  artifactDigestPrefix: string;
  contractsInvolved: string[];
  confirmationHappened: false;
  workCreated: 0;
  note: string;
}

export function buildOutcomeIntakeConfirmationPreview(
  record: OutcomeIntakeRecord,
): OutcomeIntakeConfirmationPreview {
  if (record.status !== "proposed" || record.proposal === undefined) {
    throw new Error("outcome intake has no Main proposal to preview");
  }
  const proposal = record.proposal;
  return {
    intakeId: record.id,
    intakeRevision: record.revision,
    status: "proposed",
    outcome: record.outcome,
    requestedShape: record.requestedShape,
    selectedShape: proposal.shape,
    reason: proposal.reason,
    displayName: proposal.displayName,
    objective: proposal.objective,
    taskCount: proposal.taskCount,
    ...(proposal.dependencyWaves === undefined
      ? {}
      : { dependencyWaves: proposal.dependencyWaves }),
    artifactKind: proposal.artifactKind,
    artifactDigestPrefix: proposal.artifactDigest.slice(0, 16),
    contractsInvolved: contractsInvolvedForShape(
      proposal.shape,
      proposal.goalVersion,
      proposal.taskContractVersions,
    ),
    confirmationHappened: false,
    workCreated: 0,
    note: "Not confirmed; nothing has been created.",
  };
}

/** SHA-256 hex digest of the exact artifact file bytes. Used as the artifact
 *  identity so FL-109D3 can require revalidation before any creation. */
export async function outcomeIntakeArtifactFileDigest(filePath: string): Promise<string> {
  const raw = await readFile(filePath);
  return createHash("sha256").update(raw).digest("hex");
}

/** Deterministic digest over a validated artifact graph: the root artifact
 *  plus every referenced contract file (e.g. a Work Plan or Goal plus each
 *  Task Contract it binds). Editing any validated root or referenced file
 *  changes the digest, so FL-109D3 can require revalidation of the complete
 *  graph before creation. The digest is content-derived only — paths and
 *  content are never part of the digest output. */
export async function outcomeIntakeArtifactGraphDigest(
  rootFile: string,
  referencedFiles: readonly string[],
): Promise<string> {
  const unique = [...new Set([rootFile, ...referencedFiles])];
  const digests = await Promise.all(
    unique.map(async (file) => {
      const bytes = await readFile(file);
      return createHash("sha256").update(bytes).digest();
    }),
  );
  digests.sort((left, right) => left.compare(right));
  const finalHash = createHash("sha256");
  for (const digest of digests) finalHash.update(digest);
  return finalHash.digest("hex");
}
