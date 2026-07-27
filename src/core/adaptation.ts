/**
 * Bounded policy adaptation transition chain (pure core).
 *
 * A bounded, evidence-backed successor-creation service for terminal Tasks.
 * One parent -> at most one successor. The next round is bounded by the root
 * snapshot's maxAdaptationRounds (settings drift cannot expand it).
 *
 * This module is pure: no I/O, no Provider calls, no Task mutation, and no
 * execution/retry loop. Finite in-memory lineage traversal is used only to
 * prove the root and round bound. It returns a stable preview / stopped
 * decision consumed by both the daemon preview and apply operations.
 *
 * Boundaries:
 *   - No model calls. No retry loops. No automatic multiplier or tuning.
 *   - No authority changes. Only flexible advanced-policy fields are accepted.
 *   - maxAdaptationRounds itself is never patchable.
 */

import { validateAdvancedPolicyPatch } from "./advanced-policy.js";
import type {
  AdaptationPreview,
  AdaptationPreviewField,
  AdaptationReasonCategory,
  AdvancedPolicyFields,
  EffectivePolicySnapshot,
  EnforcementCapability,
  EnforcementPhase,
  PolicyMode,
  ProvenanceSource,
} from "./types.js";

const ADAPTATION_FIELDS = [
  "maxDurationMs",
  "observedTokenCeiling",
  "noProgressTimeoutMs",
  "workerStopGraceMs",
  "fileLimit",
  "fileLimitMode",
  "changedLineLimit",
  "changedLineLimitMode",
  "baseMaxAttempts",
  "maxExtraAttempts",
  "maxConcurrency",
  "completionMode",
  "changeBudgetMode",
] as const satisfies ReadonlyArray<keyof AdvancedPolicyFields>;

/** Advanced-policy fields that adaptation may change.
 *  Excludes maxAdaptationRounds (forbidden). */
export type AdaptationPatchField = (typeof ADAPTATION_FIELDS)[number];

const ADAPTATION_FIELD_SET: ReadonlySet<string> = new Set<string>(ADAPTATION_FIELDS);

const TERMINAL_TASK_STATUSES = new Set<TaskStatusKind>([
  "succeeded", "failed", "interrupted",
]);

type TaskStatusKind =
  | "queued" | "waiting" | "blocked" | "preparing"
  | "running" | "verifying" | "succeeded" | "failed" | "interrupted";

/** Minimal projection of a stored TaskRecord required by the gate.
 *  Keeps this module independent of the heavy TaskRecord shape. */
export interface AdaptationParentProjection {
  id: string;
  status: TaskStatusKind;
  /** Effective policy snapshot captured at Task creation. */
  effectivePolicy: EffectivePolicySnapshot | undefined;
  /**
   * Latest terminal failure class when known. When contract-infeasible,
   * adaptation must stop so Main revises the contract instead of same-policy
   * parameter retuning.
   */
  failureCategory?: string;
}

/** Minimal projection of an existing lineage edge.
 *  Only fields needed by the gate are exposed. */
export interface AdaptationLineageEdgeProjection {
  rootTaskId: string;
  parentTaskId: string;
  childTaskId: string;
  round: number;
}

/** Input to the gate. The gate is pure and has no I/O. */
export interface AdaptationGateInput {
  parent: AdaptationParentProjection;
  /** Effective policy of the immutable adaptive root. The cap
   *  (maxAdaptationRounds) read here is the authoritative bound; later
   *  settings drift cannot expand it. When `parent` IS the root, callers
   *  pass the same snapshot twice. */
  rootEffectivePolicy: EffectivePolicySnapshot;
  /** Lineage edges already persisted for this root, used to compute next
   *  round and to detect duplicate successors. */
  existingLineage: readonly AdaptationLineageEdgeProjection[];
  /** Proposed patch of flexible advanced-policy fields only.
   *  Source-of-truth is the caller; the gate validates but never persists. */
  rawPatch: unknown;
}

/** Compute the eligible-or-stopped decision for an adaptation transition. */
export type AdaptationGateDecision =
  | { kind: "stopped"; preview: AdaptationPreview }
  | { kind: "eligible"; context: AdaptationEligibleContext; preview: AdaptationPreview };

export interface AdaptationEligibleContext {
  parent: AdaptationParentProjection;
  rootSnapshot: EffectivePolicySnapshot;
  patch: Partial<AdvancedPolicyFields>;
  parentRound: number;
  nextRound: number;
}

/** Resolve the adaptive root for a Task id by walking lineage edges upward.
 *  Returns undefined if a cycle is detected. The resolved root is the
 *  unique lineage ancestor; without lineage edges, the Task itself is the
 *  root. */
export function resolveAdaptiveRoot(
  taskId: string,
  existingLineage: readonly AdaptationLineageEdgeProjection[],
): { rootTaskId: string } | undefined {
  const childToParent = new Map<string, string>();
  for (const edge of existingLineage) childToParent.set(edge.childTaskId, edge.parentTaskId);
  let cursor: string | undefined = taskId;
  const seen = new Set<string>();
  while (cursor !== undefined) {
    if (seen.has(cursor)) return undefined;
    seen.add(cursor);
    const up = childToParent.get(cursor);
    if (up === undefined) return { rootTaskId: cursor };
    cursor = up;
  }
  return { rootTaskId: taskId };
}

/** Determine the depth (round number) of a Task within an existing lineage.
 *  Without any lineage edges the Task is round 0 (root). Walks the inverse
 *  child->parent map upward counting hops. */
export function lineageRoundOf(
  targetId: string,
  existingLineage: readonly AdaptationLineageEdgeProjection[],
): number {
  const childToParent = new Map<string, string>();
  for (const edge of existingLineage) childToParent.set(edge.childTaskId, edge.parentTaskId);
  if (!childToParent.has(targetId)) return 0;
  let cursor: string | undefined = targetId;
  let depth = 0;
  const seen = new Set<string>();
  while (cursor !== undefined) {
    if (seen.has(cursor)) return depth;
    seen.add(cursor);
    const up = childToParent.get(cursor);
    if (up === undefined) return depth;
    cursor = up;
    depth += 1;
  }
  return depth;
}

function enforcementPhaseFor(
  field: keyof AdvancedPolicyFields,
  capability: EnforcementCapability,
): EnforcementPhase {
  switch (field) {
    case "maxDurationMs": return capability.durationEnforcement;
    case "observedTokenCeiling": return capability.tokenEnforcement;
    case "noProgressTimeoutMs":
      return capability.progressWatchdog === "live" ? "preemptive" : "terminal";
    default: return "preemptive";
  }
}

function summarize(reason: AdaptationReasonCategory): string {
  switch (reason) {
    case "adaptation-disabled":
      return "Adaptation disabled: root maxAdaptationRounds is zero.";
    case "round-limit-reached":
      return "Adaptation stopped: next round exceeds the immutable root cap.";
    case "parent-not-found":
      return "Adaptation stopped: parent Task not found.";
    case "parent-not-terminal":
      return "Adaptation stopped: parent Task is not in a terminal state.";
    case "missing-effective-policy":
      return "Adaptation stopped: parent Task lacks an immutable effective policy snapshot.";
    case "successor-already-created":
      return "Adaptation stopped: parent already has one successor in the lineage.";
    case "no-effective-change":
      return "Adaptation stopped: the proposed patch does not change the effective policy.";
    case "forbidden-field":
      return "Adaptation stopped: patch contains a forbidden field (maxAdaptationRounds or other authority-bearing field).";
    case "invalid-patch":
      return "Adaptation stopped: patch failed schema validation.";
    case "contract-infeasible":
      return "Adaptation stopped: Task Contract is infeasible under the current boundary. Main must revise scope, dependencies, or acceptance.";
    case "eligible":
      // summarize is only called for stopped previews; an explicit return
      // here keeps TypeScript's exhaustiveness check happy.
      return "Adaptation eligible.";
  }
}

function stoppedPreview(
  parent: AdaptationParentProjection,
  reason: AdaptationReasonCategory,
  rootTaskId: string,
  rootSnapshot: EffectivePolicySnapshot | undefined,
): AdaptationPreview {
  return {
    status: "stopped",
    rootTaskId,
    parentTaskId: parent.id,
    nextRound: 0,
    maxAdaptationRounds: rootSnapshot?.values.maxAdaptationRounds ?? 0,
    profileId: rootSnapshot?.profileId ?? "",
    reason,
    stoppedReason: reason,
    fields: [],
    summary: summarize(reason),
  };
}

/** Validate and normalize a proposed patch against the allowed adaptation fields.
 *  Returns the normalized patch (with only allowed fields), or a reason. */
function validateAdaptationPatch(
  rawPatch: unknown,
): { patch: Partial<AdvancedPolicyFields> } | { reason: "forbidden-field" | "invalid-patch" } {
  if (rawPatch === undefined) return { patch: {} };
  if (rawPatch === null || typeof rawPatch !== "object" || Array.isArray(rawPatch)) {
    return { reason: "invalid-patch" };
  }
  for (const key of Object.keys(rawPatch as Record<string, unknown>)) {
    if (!ADAPTATION_FIELD_SET.has(key)) return { reason: "forbidden-field" };
  }
  try {
    const validated = validateAdvancedPolicyPatch(rawPatch, "adaptationPatch");
    return { patch: validated };
  } catch {
    return { reason: "invalid-patch" };
  }
}

/** Pure gate that decides whether exactly one bounded policy transition
 *  is allowed. Returns a stable stopped reason on rejection, or an eligible
 *  preview with per-field before/after rows for the proposed patch.
 *
 *  NEVER mutates state. NEVER calls a model. NEVER loops. The root's
 *  effective policy IS the source of authority — settings drift cannot
 *  expand the round cap because the cap is read from a frozen snapshot. */
export function evaluateAdaptationGate(input: AdaptationGateInput): AdaptationGateDecision {
  const { parent, rootEffectivePolicy, existingLineage, rawPatch } = input;

  if (parent.effectivePolicy === undefined) {
    return {
      kind: "stopped",
      preview: stoppedPreview(parent, "missing-effective-policy", "", undefined),
    };
  }
  if (!TERMINAL_TASK_STATUSES.has(parent.status)) {
    return {
      kind: "stopped",
      preview: stoppedPreview(parent, "parent-not-terminal", parent.id, parent.effectivePolicy),
    };
  }

  // Same-policy parameter adaptation cannot fix a contradictory contract.
  if (parent.failureCategory === "contract-infeasible") {
    return {
      kind: "stopped",
      preview: stoppedPreview(parent, "contract-infeasible", parent.id, parent.effectivePolicy),
    };
  }

  const resolvedRoot = resolveAdaptiveRoot(parent.id, existingLineage);
  if (resolvedRoot === undefined) {
    return { kind: "stopped", preview: stoppedPreview(parent, "parent-not-found", "", undefined) };
  }

  const rootSnapshot = rootEffectivePolicy;
  const rootCap = rootSnapshot.values.maxAdaptationRounds;

  const validated = validateAdaptationPatch(rawPatch);
  if ("reason" in validated) {
    return {
      kind: "stopped",
      preview: stoppedPreview(parent, validated.reason, resolvedRoot.rootTaskId, rootSnapshot),
    };
  }

  // adaptation-disabled MUST fire before idempotency / round-limit so a
  // cap=0 root never returns a more specific stopped reason.
  if (rootCap === 0) {
    return {
      kind: "stopped",
      preview: stoppedPreview(parent, "adaptation-disabled", resolvedRoot.rootTaskId, rootSnapshot),
    };
  }

  const parentRound = lineageRoundOf(parent.id, existingLineage);
  const nextRound = parentRound + 1;

  // Idempotency: a parent with a persisted edge is specifically a duplicate
  // apply, even when the cap would also block. Surface the more specific
  // stopped reason.
  for (const edge of existingLineage) {
    if (edge.parentTaskId === parent.id) {
      return {
        kind: "stopped",
        preview: stoppedPreview(parent, "successor-already-created", resolvedRoot.rootTaskId, rootSnapshot),
      };
    }
  }

  if (nextRound > rootCap) {
    return {
      kind: "stopped",
      preview: stoppedPreview(parent, "round-limit-reached", resolvedRoot.rootTaskId, rootSnapshot),
    };
  }

  const fields = buildPreviewFields(parent.effectivePolicy, validated.patch);
  if (!fields.some((field) => field.changed)) {
    return {
      kind: "stopped",
      preview: stoppedPreview(
        parent,
        "no-effective-change",
        resolvedRoot.rootTaskId,
        rootSnapshot,
      ),
    };
  }
  const summary = buildEligibleSummary(parent.id, nextRound, rootCap, fields);
  const preview: AdaptationPreview = {
    status: "eligible",
    rootTaskId: resolvedRoot.rootTaskId,
    parentTaskId: parent.id,
    nextRound,
    maxAdaptationRounds: rootCap,
    profileId: rootSnapshot.profileId,
    reason: "eligible",
    fields,
    summary,
  };

  return {
    kind: "eligible",
    context: {
      parent,
      rootSnapshot,
      patch: validated.patch,
      parentRound,
      nextRound,
    },
    preview,
  };
}

function buildPreviewFields(
  snapshot: EffectivePolicySnapshot,
  patch: Partial<AdvancedPolicyFields>,
): AdaptationPreviewField[] {
  const fields: AdaptationPreviewField[] = [];
  for (const field of ADAPTATION_FIELDS) {
    const before = snapshot.values[field];
    const after = patch[field] === undefined ? before : patch[field]!;
    fields.push({
      field,
      before: before as number | PolicyMode | null,
      after: after as number | PolicyMode | null,
      changed: !sameValue(before, after),
      source: snapshot.provenance[field],
      enforcementPhase: enforcementPhaseFor(field, snapshot.enforcementCapability),
    });
  }
  return fields;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null && b === undefined) return true;
  if (a === undefined && b === null) return true;
  return false;
}

function buildEligibleSummary(
  parentId: string,
  nextRound: number,
  rootCap: number,
  fields: readonly AdaptationPreviewField[],
): string {
  const changed = fields.filter((field) => field.changed).length;
  return [
    `Adaptation eligible: round ${nextRound}/${rootCap}`,
    `from parent ${parentId}`,
    `with ${changed} patched field${changed === 1 ? "" : "s"}.`,
  ].join(" ");
}

/** Derive the child's immutable effective policy from the parent's snapshot
 *  and the validated patch. The root cap and provenance are preserved;
 *  patch fields switch their provenance to "task".
 *
 *  Must NOT read live settings — settings drift must not alter a
 *  descendant's effective values once the root snapshot exists. */
export function deriveChildEffectivePolicy(
  parentSnapshot: EffectivePolicySnapshot,
  patch: Partial<AdvancedPolicyFields>,
): EffectivePolicySnapshot {
  const values: Record<string, unknown> = { ...parentSnapshot.values };
  const provenance: Record<string, ProvenanceSource> = { ...parentSnapshot.provenance };
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (field === "maxAdaptationRounds") continue; // defense in depth
    values[field] = value;
    provenance[field] = "task";
  }
  // Defensive: cap carries through from the root snapshot regardless of any
  // patch attempt to re-define it.
  values.maxAdaptationRounds = parentSnapshot.values.maxAdaptationRounds;
  provenance.maxAdaptationRounds = parentSnapshot.provenance.maxAdaptationRounds;

  return {
    profileId: parentSnapshot.profileId,
    values: values as unknown as AdvancedPolicyFields,
    provenance: provenance as Record<keyof AdvancedPolicyFields, ProvenanceSource>,
    enforcementCapability: parentSnapshot.enforcementCapability,
  };
}
