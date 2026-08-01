/**
 * Privacy-safe classification reuse advice.
 *
 * One pure projection over terminal ordinary Task records. It answers the only
 * questions ForkLight is allowed to answer before a Task is submitted:
 *
 *   - Does this exact taskClass already appear in finished ordinary history?
 *   - Does this exact taskFamily already appear in finished ordinary history?
 *   - Which established families exist, with truthful counts, as a bounded
 *     candidate list Main may reuse?
 *   - Which exact taskClass names already exist inside the explicitly selected
 *     family, with truthful counts, as a bounded candidate list Main may reuse
 *     instead of inventing a one-off class?
 *
 * It never infers semantic equivalence, never reads model scores, never reads
 * private routing reasons, never mutates history, and never executes anything.
 * Counts are explicit label presence only — the same "complete selection
 * record" definition used by routing-evidence coverage: one terminal ordinary
 * Task that simultaneously stores taskClass, taskFamily, and routingDecision.
 *
 * History is read-only evidence for Main; it never enters the admission
 * preview revision digest.
 */

import { isTerminalTaskStatus } from "./task-progress.js";
import { isReviewGraphReviewerTaskFile } from "./task.js";
import type { TaskRecord } from "./types.js";

/** Closed state of one parsed classification label against eligible history. */
export type ClassificationLabelState = "missing" | "new" | "existing";

/**
 * One closed next-action code. No other codes exist; Hub and CLI map each to a
 * fixed explanation. The action is always a Main decision — ForkLight never
 * writes, renames, or merges a classification by itself.
 */
export type ClassificationNextAction =
  | "reuse-classification"
  | "extend-family"
  | "add-class"
  | "add-family"
  | "confirm-new-family"
  | "fill-classification";

/** Counts for one parsed label (taskClass or taskFamily). */
export interface ClassificationLabelEvidence {
  state: ClassificationLabelState;
  /** Terminal ordinary Tasks carrying the exact label. */
  terminalCount: number;
  /** Of those, how many also store the sibling label and a routingDecision. */
  completeSelectionCount: number;
}

/** One bounded established-family candidate. No Task identity or private content. */
export interface EstablishedFamilyChoice {
  family: string;
  terminalCount: number;
  completeSelectionCount: number;
  distinctClassCount: number;
}

/**
 * One bounded class candidate scoped to the explicitly selected existing family.
 * Only the class name and transparent counts — never a score, a ranking, or any
 * Task identity. The complete selection record is the same traceability
 * definition used everywhere else: one terminal ordinary Task that stores
 * taskClass, taskFamily, and a routingDecision together.
 */
export interface EstablishedClassChoice {
  taskClass: string;
  terminalCount: number;
  completeSelectionCount: number;
}

/** Bounded classification reuse advice attached to a safe admission preview. */
export interface ClassificationAdvice {
  taskClass: ClassificationLabelEvidence;
  taskFamily: ClassificationLabelEvidence;
  /** At most FAMILY_CHOICES_MAX established families, deterministically ordered. */
  familyChoices: EstablishedFamilyChoice[];
  /**
   * At most CLASS_CHOICES_MAX exact taskClass names from the explicitly
   * selected existing family, deterministically ordered. Empty when the family
   * is missing or new — ForkLight never guesses across families. These are
   * existing names to consider, never a semantic recommendation.
   */
  classChoices: EstablishedClassChoice[];
  nextAction: ClassificationNextAction;
}

/** Hard bound on how many established families are ever returned. */
export const FAMILY_CHOICES_MAX = 8;

/** Hard bound on how many within-family class choices are ever returned. */
export const CLASS_CHOICES_MAX = 8;

function hasExplicitLabel(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasStoredRoutingDecision(raw: unknown): boolean {
  return raw !== null && raw !== undefined && typeof raw === "object" && !Array.isArray(raw);
}

function normalized(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** The eligible cohort: terminal ordinary Tasks only. Review Graph reviewer
 *  Tasks and active Tasks never contribute counts or family choices. */
function eligibleTasks(tasks: readonly TaskRecord[]): TaskRecord[] {
  return tasks.filter(
    (task) => isTerminalTaskStatus(task.status) && !isReviewGraphReviewerTaskFile(task.taskFile),
  );
}

function deriveNextAction(
  classState: ClassificationLabelState,
  familyState: ClassificationLabelState,
): ClassificationNextAction {
  if (classState === "missing" && familyState === "missing") return "fill-classification";
  if (familyState === "missing") return "add-family";
  if (familyState === "new") return "confirm-new-family";
  // The family is established: missing input and deliberate new evidence need
  // different user actions so the UI never calls an absent class "new".
  if (classState === "missing") return "add-class";
  if (classState === "new") return "extend-family";
  return "reuse-classification";
}

/** Environment-independent stable string order (UTF-16 code units). Never uses
 *  locale-sensitive collation, which could vary across machines/ICU builds. */
function compareStableNames(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Freeze every object and array in the result graph so no caller can mutate a
 *  shared detached projection. The input history is never mutated. */
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
 * Canonical pure projection. Read-only and side-effect free: fresh detached,
 * deeply frozen objects on every call, deterministic ordering, and no reference
 * back to any Task record. Never reads events, attempts, scores, or private
 * reasons.
 */
export function computeClassificationAdvice(
  taskClassInput: string | undefined,
  taskFamilyInput: string | undefined,
  tasks: readonly TaskRecord[],
): ClassificationAdvice {
  const taskClass = normalized(taskClassInput);
  const taskFamily = normalized(taskFamilyInput);

  let classTerminalCount = 0;
  let classCompleteCount = 0;
  let familyTerminalCount = 0;
  let familyCompleteCount = 0;
  const familyCounts = new Map<
    string,
    { terminal: number; complete: number; classes: Set<string> }
  >();
  // Exact class names inside the explicitly selected family only. The same
  // eligible terminal ordinary cohort drives these counts, so a class choice
  // can never include a running Task or a Review Graph reviewer.
  const classCounts = new Map<string, { terminal: number; complete: number }>();

  for (const task of eligibleTasks(tasks)) {
    const rawClass = task.spec?.taskClass;
    const rawFamily = task.spec?.taskFamily;
    const tClass = hasExplicitLabel(rawClass) ? rawClass.trim() : undefined;
    const tFamily = hasExplicitLabel(rawFamily) ? rawFamily.trim() : undefined;
    const hasDecision = hasStoredRoutingDecision(task.spec?.routingDecision);

    if (taskClass !== undefined && tClass === taskClass) {
      classTerminalCount += 1;
      if (tFamily !== undefined && hasDecision) classCompleteCount += 1;
    }
    if (taskFamily !== undefined && tFamily === taskFamily) {
      familyTerminalCount += 1;
      if (tClass !== undefined && hasDecision) familyCompleteCount += 1;
      if (tClass !== undefined) {
        const entry = classCounts.get(tClass) ?? { terminal: 0, complete: 0 };
        entry.terminal += 1;
        if (hasDecision) entry.complete += 1;
        classCounts.set(tClass, entry);
      }
    }
    if (tFamily !== undefined) {
      const entry = familyCounts.get(tFamily) ?? { terminal: 0, complete: 0, classes: new Set<string>() };
      entry.terminal += 1;
      if (tClass !== undefined && hasDecision) entry.complete += 1;
      if (tClass !== undefined) entry.classes.add(tClass);
      familyCounts.set(tFamily, entry);
    }
  }

  const familyChoices: EstablishedFamilyChoice[] = [...familyCounts.entries()]
    .map(([family, counts]) => ({
      family,
      terminalCount: counts.terminal,
      completeSelectionCount: counts.complete,
      distinctClassCount: counts.classes.size,
    }))
    // Transparent coverage counts only — never a score or semantic ranking.
    .sort(
      (a, b) =>
        b.completeSelectionCount - a.completeSelectionCount
        || b.terminalCount - a.terminalCount
        || compareStableNames(a.family, b.family),
    )
    .slice(0, FAMILY_CHOICES_MAX);

  // Within-family class choices exist only when the selected family is already
  // established; a missing or new family leaves the array empty because there
  // is no explicit scope and ForkLight never guesses across families. Ordering
  // is transparency first (complete records, then terminals) and stable name
  // last — never a semantic ranking.
  const classChoices: EstablishedClassChoice[] = taskFamily !== undefined
    && familyTerminalCount > 0
    ? [...classCounts.entries()]
        .map(([taskClass, counts]) => ({
          taskClass,
          terminalCount: counts.terminal,
          completeSelectionCount: counts.complete,
        }))
        .sort(
          (a, b) =>
            b.completeSelectionCount - a.completeSelectionCount
            || b.terminalCount - a.terminalCount
            || compareStableNames(a.taskClass, b.taskClass),
        )
        .slice(0, CLASS_CHOICES_MAX)
    : [];

  const classState: ClassificationLabelState = taskClass === undefined
    ? "missing"
    : classTerminalCount > 0
      ? "existing"
      : "new";
  const familyState: ClassificationLabelState = taskFamily === undefined
    ? "missing"
    : familyTerminalCount > 0
      ? "existing"
      : "new";

  return deepFreeze({
    taskClass: {
      state: classState,
      terminalCount: classTerminalCount,
      completeSelectionCount: classCompleteCount,
    },
    taskFamily: {
      state: familyState,
      terminalCount: familyTerminalCount,
      completeSelectionCount: familyCompleteCount,
    },
    familyChoices,
    classChoices,
    nextAction: deriveNextAction(classState, familyState),
  });
}
