import type { ChildProcess } from "node:child_process";
import type { RuntimeName } from "../core/runtime-names.js";
import type {
  AttemptRecord,
  AttemptTokenUsage,
  NormalizedWorkerEvent,
  TaskRecord,
} from "../core/types.js";
import type { StateStore } from "../state/store.js";
import type { ExecutionSettings, ProviderDefaultSettings } from "../core/settings.js";

export type CapabilitySupport = "supported" | "partial" | "unsupported";

export interface WorkerCapabilityMatrix {
  budgetFlag: CapabilitySupport;
  checkpoint: CapabilitySupport;
  isolation: CapabilitySupport;
  toolsPolicy: CapabilitySupport;
  effortMapping: CapabilitySupport;
  costUsageFidelity: CapabilitySupport;
  sessionResume: CapabilitySupport;
  /**
   * True native Goal execution: the Runtime exposes a machine-observable,
   * durable Goal with progress, completion/blocked state, cumulative usage, and
   * interruption all bound to one Task lineage. Distinct from sessionResume —
   * resuming a chat session is not a Goal contract.
   */
  nativeGoal: CapabilitySupport;
  streamingEvents: CapabilitySupport;
  /**
   * What resets the no-effective-progress watchdog.
   * All supported Runtimes use closed effective-progress evidence only;
   * liveness-only heartbeats never reset the timer.
   */
  progressHeartbeat: "effective-progress";
}

export interface WorkerDoctorResult {
  runtime: RuntimeName;
  ok: boolean;
  executable: string;
  version?: string;
  issues: string[];
  capabilities: WorkerCapabilityMatrix;
}

export interface WorkerExecutionResult {
  status: "succeeded" | "failed" | "interrupted";
  exitCode: number;
  resultText?: string;
  costUsd?: number;
  turns?: number;
  error?: string;
  usage?: AttemptTokenUsage;
  runtimeCostEstimateUsd?: number;
  /** Content-free evidence for a limit enforced inside the Worker adapter. */
  policyLimit?: import("../core/types.js").PolicyLimitEvidence;
  /**
   * Durable terminal failure class written by the adapter (e.g. connectivity).
   * Runner persists this on the terminal worker.failed payload; public surfaces
   * must never reconstruct it from raw stderr.
   */
  failureCategory?: import("../core/worker-failure.js").WorkerFailureCategory;
}

export interface WorkerRunHooks {
  /** Every adapter that spawns a child must call this immediately after spawn. */
  onSpawn?: (child: ChildProcess) => void;
  onEvent?: (event: NormalizedWorkerEvent) => void;
  wasInterrupted?: () => boolean;
  feedback?: string;
}

export interface WorkerRunContext {
  store: StateStore;
  task: TaskRecord;
  attempt: AttemptRecord;
  resuming: boolean;
  hooks?: WorkerRunHooks;
  execution?: ExecutionSettings;
  providerDefaults?: ProviderDefaultSettings;
}

export interface RuntimeSpecView {
  name: RuntimeName;
  executable: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxBudgetUsd: number | null;
}

export interface WorkerAdapter {
  readonly name: RuntimeName;
  readonly displayName: string;
  readonly defaultExecutable: string;
  capabilities(): WorkerCapabilityMatrix;
  doctor(): Promise<WorkerDoctorResult> | WorkerDoctorResult;
  validateSpec(runtime: RuntimeSpecView): void;
  effortArgs(effort: RuntimeSpecView["effort"]): string[];
  toolProtocolAppendix(task: TaskRecord): string[];
  checkpointProtocolAppendix(task: TaskRecord): string[];
  run(ctx: WorkerRunContext): Promise<WorkerExecutionResult>;
}
