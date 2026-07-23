// Task Token-efficiency report — Store-backed read-only lookup.  Captures
// the canonical Task once, resolves calibration selection with
// independent explicit precedence, reads Attempts/receipts once, and
// returns a detached deeply-frozen report.  No inference of task class,
// direct-Codex profile, model, effort, context policy, or publication
// identity.

import type { AttemptTokenUsage, TaskRecord } from "./types.js";
import {
  buildTokenEfficiencyReport,
  type ConfidenceLevel,
  type TokenEfficiencyReport,
} from "./token-efficiency.js";
import {
  normalizeDirectCodexProfilePublication,
  type DirectCodexProfilePublication,
} from "./direct-codex-calibration.js";
import { type StateStore } from "../state/store.js";

function freezeDeep(v: unknown): void {
  if (v !== null && typeof v === "object" && !Object.isFrozen(v)) {
    if (Array.isArray(v)) { for (const e of v) freezeDeep(e); }
    else { for (const e of Object.values(v)) freezeDeep(e); }
    Object.freeze(v);
  }
}

// Minimal nested aggregate record shape projected into Token arithmetic.
// Profile identity is verified upstream — arithmetic never sees raw
// publication envelopes, evidence references, or model configuration.
export interface NestedAggregateCalibration {
  readonly minTokens: number;
  readonly maxTokens: number;
  readonly method: string;
  readonly taskClass: string;
  readonly confidence: ConfidenceLevel;
}

function publicationToNested(
  publication: DirectCodexProfilePublication,
): NestedAggregateCalibration {
  return {
    minTokens: publication.calibration.minTokens,
    maxTokens: publication.calibration.maxTokens,
    method: publication.calibration.method,
    taskClass: publication.calibration.taskClass,
    confidence: publication.calibration.confidence,
  };
}

// Privacy-safe provenance for the chosen calibration.  Successful
// branches (exact-registry-hit, explicit-override) and exact-pair-missing
// expose only bounded non-content profile identity plus version and
// sample size; identity-missing, invalid, and mismatch branches expose
// only the typed kind so supplied values are never echoed.
export type CalibrationSelection =
  | { readonly kind: "exact-registry-hit"; readonly profileId: string;
      readonly version: number; readonly sampleSize: number; }
  | { readonly kind: "explicit-override"; readonly profileId: string;
      readonly version: number; readonly sampleSize: number; }
  | { readonly kind: "exact-pair-missing"; readonly profileId: string; }
  | { readonly kind: "task-class-missing" }
  | { readonly kind: "direct-codex-profile-missing" }
  | { readonly kind: "explicit-publication-invalid" }
  | { readonly kind: "task-class-mismatch" }
  | { readonly kind: "direct-codex-profile-mismatch" };

interface CalibrationPublicationLookup {
  latestDirectCodexProfilePublication(
    taskClass: string,
    profileId: string,
  ): DirectCodexProfilePublication | undefined;
}

// Caller-visible options for report services.  Both identities and the
// optional publication envelope are resolved independently; explicit
// overrides win independently over the values declared on TaskSpec.
export interface ReportCalibrationOptions {
  /** A re-normalized `DirectCodexProfilePublication` envelope that must
   *  exactly match the resolved task class and direct-Codex profile
   *  before the nested aggregate record is projected into arithmetic. */
  readonly calibrationPublication?: unknown;
  readonly currentTaskClass?: string;
  readonly currentDirectCodexProfileId?: string;
}

export interface CalibrationSelectionResult {
  readonly resolvedCurrentTaskClass: string | undefined;
  readonly resolvedCurrentDirectCodexProfileId: string | undefined;
  readonly resolvedCalibration: NestedAggregateCalibration | undefined;
  readonly selection: CalibrationSelection;
}

// Resolve class and profile independently with explicit-overrides-stored
// precedence.  Either identity is never inferred from a baseline
// publication, provider, model, prompt, or name.  The Store is only
// consulted when both current identities are present; legacy
// class-only calibration data is never reached.
export function selectCalibration(
  task: TaskRecord,
  options: ReportCalibrationOptions | undefined,
  lookup: CalibrationPublicationLookup,
): CalibrationSelectionResult {
  const resolvedCurrentTaskClass: string | undefined =
    options?.currentTaskClass !== undefined
      ? options.currentTaskClass
      : task.spec.taskClass;
  const resolvedCurrentDirectCodexProfileId: string | undefined =
    options?.currentDirectCodexProfileId !== undefined
      ? options.currentDirectCodexProfileId
      : task.spec.directCodexProfileId;

  // Resolve the current identity before inspecting an optional baseline.
  // A publication never fills in missing Task identity and missing states
  // remain distinct from mismatches.
  if (resolvedCurrentTaskClass === undefined) {
    return {
      resolvedCurrentTaskClass,
      resolvedCurrentDirectCodexProfileId,
      resolvedCalibration: undefined,
      selection: { kind: "task-class-missing" },
    };
  }
  if (resolvedCurrentDirectCodexProfileId === undefined) {
    return {
      resolvedCurrentTaskClass,
      resolvedCurrentDirectCodexProfileId,
      resolvedCalibration: undefined,
      selection: { kind: "direct-codex-profile-missing" },
    };
  }

  // Branch A — explicit publication envelope.  Re-normalize before any
  // comparison so untrusted input cannot smuggle extra fields or echo
  // back through arithmetic.
  if (options?.calibrationPublication !== undefined) {
    let publication: DirectCodexProfilePublication;
    try {
      publication = normalizeDirectCodexProfilePublication(
        options.calibrationPublication,
      );
    } catch {
      // Malformed is not the same as an identity mismatch. Refuse to pass
      // anything to arithmetic and never echo supplied content.
      return {
        resolvedCurrentTaskClass,
        resolvedCurrentDirectCodexProfileId,
        resolvedCalibration: undefined,
        selection: { kind: "explicit-publication-invalid" },
      };
    }
    if (publication.calibration.taskClass !== resolvedCurrentTaskClass) {
      return {
        resolvedCurrentTaskClass,
        resolvedCurrentDirectCodexProfileId,
        resolvedCalibration: undefined,
        selection: { kind: "task-class-mismatch" },
      };
    }
    if (publication.directCodexProfileId !== resolvedCurrentDirectCodexProfileId) {
      return {
        resolvedCurrentTaskClass,
        resolvedCurrentDirectCodexProfileId,
        resolvedCalibration: undefined,
        selection: { kind: "direct-codex-profile-mismatch" },
      };
    }
    return {
      resolvedCurrentTaskClass,
      resolvedCurrentDirectCodexProfileId,
      resolvedCalibration: publicationToNested(publication),
      selection: {
        kind: "explicit-override",
        profileId: publication.directCodexProfileId,
        version: publication.calibration.version,
        sampleSize: publication.calibration.sampleSize,
      },
    };
  }

  // Branch B — implicit exact-pair lookup. Missing branches already
  // short-circuited, so this cannot fall back to legacy class-only data.
  const publication = lookup.latestDirectCodexProfilePublication(
    resolvedCurrentTaskClass,
    resolvedCurrentDirectCodexProfileId,
  );
  if (publication === undefined) {
    return {
      resolvedCurrentTaskClass,
      resolvedCurrentDirectCodexProfileId,
      resolvedCalibration: undefined,
      selection: {
        kind: "exact-pair-missing",
        profileId: resolvedCurrentDirectCodexProfileId,
      },
    };
  }
  return {
    resolvedCurrentTaskClass,
    resolvedCurrentDirectCodexProfileId,
    resolvedCalibration: publicationToNested(publication),
    selection: {
      kind: "exact-registry-hit",
      profileId: publication.directCodexProfileId,
      version: publication.calibration.version,
      sampleSize: publication.calibration.sampleSize,
    },
  };
}

export interface TaskTokenReport {
  readonly taskId: string;
  readonly attemptCount: number;
  readonly receiptCount: number;
  readonly report: TokenEfficiencyReport;
  readonly calibrationSelection: CalibrationSelection;
}

export function getTaskTokenReport(
  store: StateStore,
  taskId: string,
  options?: ReportCalibrationOptions,
): TaskTokenReport {
  const task = store.getTask(taskId);
  const sel = selectCalibration(task, options, store);

  const attempts = store.listAttempts(taskId);
  const receipts = store.listExchangeReceipts(taskId);
  const usages: (AttemptTokenUsage | null | undefined)[] = attempts.map((a) => a.usage);

  const report = buildTokenEfficiencyReport({
    usages,
    exchangeReceipts: receipts,
    ...(sel.resolvedCalibration !== undefined ? { calibration: sel.resolvedCalibration } : {}),
    ...(sel.resolvedCurrentTaskClass !== undefined ? { currentTaskClass: sel.resolvedCurrentTaskClass } : {}),
  });

  const result: TaskTokenReport = {
    taskId, attemptCount: attempts.length, receiptCount: receipts.length, report,
    calibrationSelection: sel.selection,
  };
  freezeDeep(result);
  return result;
}
