// Task-derived guided Codex baseline capture — resolves calibration
// identity from a stored ForkLight Task and composes safe generated
// metadata with a canonical count-only Codex usage event.
// No raw run log, prompt, response, model inference, review decision,
// or publication authority.
// All count, identity, duplicate, and pending-review rules are delegated
// to the existing canonical capture path.

import { randomUUID } from "node:crypto";
import { StateStore } from "../state/store.js";
import { captureDirectCodexSample } from "./direct-codex-workflow-service.js";
import { isoTimestamp } from "./time.js";
import type { DirectCodexPairedSample } from "./direct-codex-calibration.js";

const NOT_CALIBRATION_READY =
  "Task is not calibration-ready: taskClass and directCodexProfileId are required";
const TASK_NOT_FOUND = "ForkLight Task not found for guided capture";

export type SampleIdFactory = () => string;
export type TimestampFactory = () => string;

const defaultSampleId: SampleIdFactory = () => `smp-${randomUUID()}`;

const defaultPairingRef = (): string => `pair:${randomUUID()}`;

const defaultTimestamp: TimestampFactory = () => isoTimestamp();

/** Derive calibration identity from a stored ForkLight Task and compose
 *  safe generated metadata with a canonical count-only Codex usage event.
 *
 *  Reads taskClass and directCodexProfileId only from the stored Task;
 *  rejects tasks missing either identity with a fixed actionable error.
 *  Generates sampleId, pairingRef, and capturedAt internally using
 *  content-free opaque values (default: crypto-random + current ISO
 *  timestamp).  All count, identity, and duplicate rules are delegated
 *  to the existing canonical capture path so Token arithmetic, pricing,
 *  savings formulas, Worker selection, and pending-review workflow are
 *  reused unchanged.
 *
 *  @param generateSampleId  Optional deterministic factory for tests.
 *  @param generateTimestamp Optional deterministic clock for tests. */
export function guidedDirectCodexCapture(
  store: StateStore,
  forklightTaskId: unknown,
  codexRunRef: unknown,
  usage: unknown,
  generateSampleId?: SampleIdFactory,
  generateTimestamp?: TimestampFactory,
): DirectCodexPairedSample {
  // Validate input types before any Store access.
  if (typeof forklightTaskId !== "string" || forklightTaskId.length === 0) {
    throw new TypeError("Invalid forklightTaskId");
  }
  if (typeof codexRunRef !== "string" || codexRunRef.length === 0) {
    throw new TypeError("Invalid codexRunRef");
  }

  // Load the stored Task.  Only the known unknown-Task error category is
  // translated to a fixed content-free message; all other faults (corruption,
  // DB errors, etc.) rethrow unchanged so they remain visible.
  let task: ReturnType<typeof store.getTask>;
  try {
    task = store.getTask(forklightTaskId);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Unknown ForkLight task:")) {
      throw new TypeError(TASK_NOT_FOUND);
    }
    throw e;
  }

  // Derive calibration identity from the authoritative stored Task;
  // reject tasks missing either identity with a fixed actionable error.
  if (!task.spec.taskClass || !task.spec.directCodexProfileId) {
    throw new TypeError(NOT_CALIBRATION_READY);
  }

  // Generate opaque content-free metadata.
  const sampleId = (generateSampleId ?? defaultSampleId)();
  const pairingRef = defaultPairingRef();
  const capturedAt = (generateTimestamp ?? defaultTimestamp)();

  // Compose exactly the 7 metadata fields required by
  // buildDirectCodexPairedSample — no content, no inference, no defaults.
  const metadata = {
    sampleId,
    forklightTaskId,
    exactTaskClass: task.spec.taskClass,
    directCodexProfileId: task.spec.directCodexProfileId,
    directRunRef: codexRunRef,
    pairingRef,
    capturedAt,
  };

  // Delegate all count arithmetic, identity validation, duplicate
  // protection, and pending-review persistence to the existing canonical
  // capture — nothing is reimplemented.
  return captureDirectCodexSample(store, usage, metadata);
}
