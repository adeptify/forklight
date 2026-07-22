export type TaskStatus =
  | "queued"
  | "preparing"
  | "running"
  | "verifying"
  | "succeeded"
  | "failed"
  | "interrupted";

export type AttemptStatus = "running" | "succeeded" | "failed" | "interrupted";

export type EventType =
  | "task.created"
  | "workspace.prepared"
  | "worker.started"
  | "worker.resumed"
  | "worker.tool.started"
  | "worker.tool.completed"
  | "worker.message"
  | "worker.completed"
  | "worker.failed"
  | "worker.interrupted"
  | "verification.started"
  | "verification.command.completed"
  | "verification.completed";

export interface TaskSpec {
  version: 1;
  name: string;
  project: string;
  goal: string;
  constraints: string[];
  provider: {
    name: "deepseek";
    model: string;
    keychainService: string;
    keychainAccount?: string;
  };
  runtime: {
    name: "claude-code";
    executable: string;
    effort: "low" | "medium" | "high" | "xhigh" | "max";
    maxBudgetUsd: number;
  };
  workspace: {
    exclude: string[];
  };
  worker: {
    allowEdits: boolean;
    allowedCommands: string[];
  };
  acceptance: {
    commands: string[];
  };
}

export interface TaskPaths {
  root: string;
  baseline: string;
  workspace: string;
  logs: string;
  claudeConfig: string;
  diff: string;
}

export interface TaskRecord {
  id: string;
  name: string;
  status: TaskStatus;
  sourcePath: string;
  taskFile: string;
  spec: TaskSpec;
  paths: TaskPaths;
  sessionId: string;
  currentAttemptId?: string;
  workerPid?: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

export interface AttemptRecord {
  id: string;
  taskId: string;
  ordinal: number;
  status: AttemptStatus;
  sessionId: string;
  pid?: number;
  rawLogPath: string;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  costUsd?: number;
  turns?: number;
  resultText?: string;
  error?: string;
}

export interface EventRecord {
  id: number;
  taskId: string;
  attemptId?: string;
  sequence: number;
  timestamp: string;
  type: EventType;
  summary: string;
  payload?: unknown;
}

export interface VerificationCommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface VerificationResult {
  passed: boolean;
  commands: VerificationCommandResult[];
  diffPath: string;
  sourceUnchanged: boolean;
}

export interface NormalizedWorkerEvent {
  type: EventType;
  summary: string;
  payload?: unknown;
  sessionId?: string;
  terminal?: {
    isError: boolean;
    resultText?: string;
    costUsd?: number;
    turns?: number;
  };
}
