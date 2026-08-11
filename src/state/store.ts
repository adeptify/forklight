import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AdaptationTransitionRecord,
  AttemptRecord,
  CandidateHandoffRecord,
  CheckpointOperationRecord,
  CompetitionCandidateRecord,
  CompetitionEvaluationRecord,
  CompetitionRecord,
  CompetitionStatus,
  DependencyRecord,
  EventRecord,
  EventType,
  GoalMilestoneRecord,
  GoalPlanAssociation,
  GoalRecord,
  IntegrationReceiptRecord,
  IntegrationResultRecord,
  MainDirectDecisionRecord,
  PlanItemRecord,
  PlanItemStatus,
  PlanRecord,
  ProbeEvidence,
  RemediationCheckRecord,
  RemediationDisposition,
  ReviewAssignmentRecord,
  ReviewGraphRecord,
  ReviewGraphStatus,
  StagedTaskRegistration,
  TaskRecord,
  TaskStatus,
} from "../core/types.js";
import { normalizeDirectCodexPairedSample, normalizeDirectCodexProfileId, normalizeDirectCodexProfilePublication, type DirectCodexPairedSample, type DirectCodexProfilePublication } from "../core/direct-codex-calibration.js";
import { normalizeDirectCodexSampleReview, type DirectCodexSampleReview } from "../core/direct-codex-review.js";
import { SELF_UPGRADE_DELIVERY_PROFILE_ID } from "../core/self-upgrade-evidence.js";
import { normalizeDirectCodexCalibrationRecord, normalizeOrchestrationExchangeReceipt, type DirectCodexCalibrationRecord, type OrchestrationExchangeReceipt } from "../core/token-efficiency.js";
import { isoTimestamp as now } from "../core/time.js";
import {
  OUTCOME_INTAKE_LIST_DEFAULT_LIMIT,
  OUTCOME_INTAKE_LIST_MAX_LIMIT,
  OUTCOME_INTAKE_NO_PROPOSAL_REASON,
  STALE_OUTCOME_INTAKE_CONFIRM_REASON,
  STALE_OUTCOME_INTAKE_REASON,
  type OutcomeIntakeRecord,
  type OutcomeIntakeStatus,
} from "../core/outcome-intake.js";

type TaskRecordPatch = Omit<Partial<TaskRecord>, "effectivePolicy" | "error" | "finishedAt" | "workerPid" | "currentAttemptId" | "startedAt"> & {
  error?: string | null;
  finishedAt?: string | null;
  workerPid?: number | null;
  currentAttemptId?: string | null;
  startedAt?: string | null;
};

function parseRecord<T>(value: unknown, label: string): T {
  if (typeof value !== "string") throw new Error(`Invalid ${label} record in state database`);
  return JSON.parse(value) as T;
}

/** Stable content-free corruption error for checkpoint operation reads. The
 *  message never contains a JSON parser snippet, operation id, or stored
 *  content so a corrupt record cannot leak private bytes. */
export const CHECKPOINT_OPERATION_CORRUPTION_ERROR =
  "Corrupt checkpoint operation record in state database";

function isCheckpointOperationRecord(value: unknown): value is CheckpointOperationRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.operationId === "string"
    && typeof record.taskId === "string"
    && typeof record.attemptId === "string"
    && Array.isArray(record.commandIds)
    && record.commandIds.every((commandId) => typeof commandId === "string")
    && typeof record.createdAt === "string"
    && typeof record.updatedAt === "string"
  );
}

/** Parse one checkpoint operation record, failing closed with a stable
 *  content-free error on malformed JSON or an invalid shape. */
function parseCheckpointOperationRecord(value: unknown): CheckpointOperationRecord {
  if (typeof value !== "string") throw new Error(CHECKPOINT_OPERATION_CORRUPTION_ERROR);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(CHECKPOINT_OPERATION_CORRUPTION_ERROR);
  }
  if (!isCheckpointOperationRecord(parsed)) {
    throw new Error(CHECKPOINT_OPERATION_CORRUPTION_ERROR);
  }
  return parsed;
}

interface CalibrationRow {
  id: string;
  task_class: string;
  version: number;
  created_at: string;
  record_json: string;
}

function parseCalibrationRow(
  row: CalibrationRow,
  expectedTaskClass?: string,
): DirectCodexCalibrationRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.record_json);
  } catch {
    throw new Error("Corrupt calibration record in state database");
  }
  const record = normalizeDirectCodexCalibrationRecord(parsed);
  const expectedId = `${record.taskClass}:v${record.version}`;
  if (
    (expectedTaskClass !== undefined && record.taskClass !== expectedTaskClass) ||
    row.id !== expectedId ||
    row.task_class !== record.taskClass ||
    row.version !== record.version ||
    row.created_at !== record.createdAt
  ) {
    throw new Error("Corrupt calibration record in state database");
  }
  return record;
}

function normalizeProfileQueryTaskClass(input: unknown): string {
  if (typeof input !== "string" || input !== input.trim()
    || input.length === 0 || input.length > 80) {
    throw new TypeError("Invalid direct-Codex profile publication query");
  }
  return input;
}

export class StateStore {
  readonly databasePath: string;
  private readonly db: DatabaseSync;

  constructor(home: string) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    this.databasePath = path.join(home, "forklight.sqlite");
    this.db = new DatabaseSync(this.databasePath);
    // Let concurrent CLI and daemon connections briefly wait for one another
    // instead of failing immediately while SQLite is opening the shared store.
    this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        status TEXT NOT NULL,
        record_json TEXT NOT NULL,
        UNIQUE(task_id, ordinal)
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        attempt_id TEXT,
        sequence INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        summary TEXT NOT NULL,
        payload_json TEXT,
        UNIQUE(task_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS idx_attempts_task ON attempts(task_id, ordinal);
      CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id, sequence);
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        objective TEXT NOT NULL,
        plan_file TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plan_items (
        id TEXT NOT NULL,
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        item_index INTEGER NOT NULL,
        task_file TEXT NOT NULL,
        record_json TEXT NOT NULL,
        PRIMARY KEY (plan_id, id),
        UNIQUE (plan_id, item_index)
      );
      CREATE TABLE IF NOT EXISTS plan_dependencies (
        plan_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        depends_on_item_id TEXT NOT NULL,
        PRIMARY KEY (plan_id, item_id, depends_on_item_id),
        FOREIGN KEY (plan_id, item_id)
          REFERENCES plan_items(plan_id, id) ON DELETE CASCADE,
        FOREIGN KEY (plan_id, depends_on_item_id)
          REFERENCES plan_items(plan_id, id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_plan_items_plan ON plan_items(plan_id, item_index);
      CREATE INDEX IF NOT EXISTS idx_plan_dependencies_item
        ON plan_dependencies(plan_id, item_id);
      CREATE INDEX IF NOT EXISTS idx_plan_dependencies_prerequisite
        ON plan_dependencies(plan_id, depends_on_item_id);
      CREATE TABLE IF NOT EXISTS competitions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS competition_candidates (
        competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        record_json TEXT NOT NULL,
        PRIMARY KEY (competition_id, id),
        UNIQUE (competition_id, task_id),
        UNIQUE (competition_id, ordinal)
      );
      CREATE TABLE IF NOT EXISTS competition_evaluations (
        id TEXT PRIMARY KEY,
        competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_competition_candidates
        ON competition_candidates(competition_id, ordinal);
      CREATE INDEX IF NOT EXISTS idx_competition_evaluations
        ON competition_evaluations(competition_id, created_at);
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        record_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS integration_receipts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        consumed INTEGER NOT NULL DEFAULT 0,
        record_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_integration_receipts_task
        ON integration_receipts(task_id, created_at);
      CREATE TABLE IF NOT EXISTS integration_results (
        id TEXT PRIMARY KEY,
        receipt_id TEXT NOT NULL REFERENCES integration_receipts(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        record_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_integration_results_task
        ON integration_results(task_id, created_at);
      CREATE TABLE IF NOT EXISTS checkpoint_operations (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        attempt_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_checkpoint_operations_task
        ON checkpoint_operations(task_id, created_at);
      CREATE TABLE IF NOT EXISTS provider_probes (
        provider TEXT PRIMARY KEY,
        record_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS orchestration_exchange_receipts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        captured_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_orchestration_exchange_receipts_task
        ON orchestration_exchange_receipts(task_id, captured_at, id);
      CREATE TABLE IF NOT EXISTS direct_codex_calibrations (
        id TEXT PRIMARY KEY,
        task_class TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        record_json TEXT NOT NULL,
        UNIQUE(task_class, version)
      );
      CREATE INDEX IF NOT EXISTS idx_direct_codex_calibrations_class
        ON direct_codex_calibrations(task_class, version);
      CREATE TABLE IF NOT EXISTS direct_codex_profile_publications (
        task_class TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        record_json TEXT NOT NULL,
        PRIMARY KEY (task_class, profile_id, version)
      );
      CREATE INDEX IF NOT EXISTS idx_direct_codex_profile_publications_pair
        ON direct_codex_profile_publications(task_class, profile_id, version DESC);
      CREATE TABLE IF NOT EXISTS direct_codex_paired_samples (
        sample_id TEXT PRIMARY KEY,
        forklight_task_id TEXT NOT NULL REFERENCES tasks(id),
        task_class TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        direct_run_ref TEXT NOT NULL UNIQUE,
        pairing_ref TEXT NOT NULL UNIQUE,
        captured_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_direct_codex_paired_samples_pair
        ON direct_codex_paired_samples(task_class, profile_id, captured_at);
      CREATE TABLE IF NOT EXISTS direct_codex_review_decisions (
        sample_id TEXT PRIMARY KEY REFERENCES direct_codex_paired_samples(sample_id),
        decision TEXT NOT NULL,
        rejection_reason TEXT,
        reviewer TEXT NOT NULL,
        reviewed_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS adaptation_lineage (
        id TEXT PRIMARY KEY,
        root_task_id TEXT NOT NULL REFERENCES tasks(id),
        parent_task_id TEXT NOT NULL REFERENCES tasks(id),
        child_task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),
        round INTEGER NOT NULL CHECK (round > 0),
        reason TEXT NOT NULL,
        proposed_reason TEXT NOT NULL,
        record_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (parent_task_id)
      );
      CREATE INDEX IF NOT EXISTS idx_adaptation_lineage_root
        ON adaptation_lineage(root_task_id, round);
      CREATE INDEX IF NOT EXISTS idx_adaptation_lineage_parent
        ON adaptation_lineage(parent_task_id);
      CREATE INDEX IF NOT EXISTS idx_adaptation_lineage_child
        ON adaptation_lineage(child_task_id);
      CREATE TABLE IF NOT EXISTS remediation_checks (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        commands_json TEXT NOT NULL,
        record_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_remediation_checks_task
        ON remediation_checks(task_id, created_at);
      CREATE TABLE IF NOT EXISTS remediation_dispositions (
        task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
        disposition_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS review_graphs (
        id TEXT PRIMARY KEY,
        candidate_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        candidate_revision_id TEXT NOT NULL,
        status TEXT NOT NULL,
        record_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (candidate_task_id, candidate_revision_id)
      );
      CREATE INDEX IF NOT EXISTS idx_review_graphs_candidate
        ON review_graphs(candidate_task_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_review_graphs_revision
        ON review_graphs(candidate_revision_id);
      CREATE INDEX IF NOT EXISTS idx_review_graphs_status
        ON review_graphs(status, updated_at);
      CREATE TABLE IF NOT EXISTS review_assignments (
        id TEXT PRIMARY KEY,
        graph_id TEXT NOT NULL REFERENCES review_graphs(id) ON DELETE CASCADE,
        candidate_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        candidate_revision_id TEXT NOT NULL,
        reviewer_task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
        reviewer_worker_profile_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL CHECK (ordinal > 0),
        status TEXT NOT NULL,
        record_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (graph_id, ordinal),
        UNIQUE (candidate_revision_id, reviewer_worker_profile_id)
      );
      CREATE INDEX IF NOT EXISTS idx_review_assignments_graph
        ON review_assignments(graph_id, ordinal);
      CREATE INDEX IF NOT EXISTS idx_review_assignments_reviewer
        ON review_assignments(reviewer_task_id);
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL UNIQUE REFERENCES plans(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status, updated_at);
      CREATE TABLE IF NOT EXISTS goal_milestones (
        goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL,
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        gate TEXT NOT NULL,
        item_index INTEGER NOT NULL,
        satisfied INTEGER NOT NULL DEFAULT 0,
        record_json TEXT NOT NULL,
        PRIMARY KEY (goal_id, plan_id, item_id),
        UNIQUE (goal_id, plan_id, item_index)
      );
      CREATE INDEX IF NOT EXISTS idx_goal_milestones_task ON goal_milestones(task_id);
      CREATE INDEX IF NOT EXISTS idx_goal_milestones_goal ON goal_milestones(goal_id, item_index);
      CREATE TABLE IF NOT EXISTS goal_plan_associations (
        goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        plan_id TEXT NOT NULL UNIQUE REFERENCES plans(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        created_at TEXT NOT NULL,
        PRIMARY KEY (goal_id, plan_id),
        UNIQUE (goal_id, ordinal)
      );
      CREATE INDEX IF NOT EXISTS idx_goal_plan_associations_goal
        ON goal_plan_associations(goal_id, ordinal);
      CREATE TABLE IF NOT EXISTS candidate_handoffs (
        id TEXT PRIMARY KEY,
        source_revision_id TEXT NOT NULL UNIQUE,
        source_task_id TEXT NOT NULL REFERENCES tasks(id),
        successor_task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),
        competition_id TEXT NOT NULL,
        status TEXT NOT NULL,
        record_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_candidate_handoffs_source
        ON candidate_handoffs(source_task_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_candidate_handoffs_competition
        ON candidate_handoffs(competition_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_candidate_handoffs_status
        ON candidate_handoffs(status, updated_at);
      CREATE TABLE IF NOT EXISTS main_direct_decisions (
        id TEXT PRIMARY KEY,
        task_class TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        closed_at TEXT,
        record_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_main_direct_decisions_closed
        ON main_direct_decisions(status, started_at DESC);
      CREATE TABLE IF NOT EXISTS outcome_intakes (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_outcome_intakes_status
        ON outcome_intakes(status, updated_at DESC);
    `);
    // Idempotent legacy primary Plan backfill: each Goal's goals.plan_id becomes
    // ordinal 0. Safe on every open; INSERT OR IGNORE never duplicates or reorders.
    this.db.exec(`
      INSERT OR IGNORE INTO goal_plan_associations (goal_id, plan_id, ordinal, created_at)
      SELECT id, plan_id, 0, created_at FROM goals
    `);
    // Plan-qualified milestone identity (FL-112E2): legacy milestone rows have
    // no plan_id and must be rebuilt once with the Goal's primary Plan.
    this.migrateGoalMilestonePlanIdentity();
  }

  /**
   * Rebuild the goal_milestones table with plan-qualified identity when it was
   * created by an older schema. Idempotent: no-op when plan_id already exists.
   * Legacy rows are backfilled to their Goal's primary Plan and the record_json
   * is rewritten with the same planId so reads and writes stay consistent.
   */
  private migrateGoalMilestonePlanIdentity(): void {
    const columns = this.db
      .prepare("PRAGMA table_info(goal_milestones)")
      .all() as unknown as Array<{ name: string }>;
    if (columns.some((column) => column.name === "plan_id")) return;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.db
        .prepare(
          `SELECT gm.goal_id AS goal_id, gm.item_id AS item_id, gm.task_id AS task_id,
                  gm.gate AS gate, gm.item_index AS item_index, gm.satisfied AS satisfied,
                  gm.record_json AS record_json, g.plan_id AS plan_id
           FROM goal_milestones gm
           JOIN goals g ON g.id = gm.goal_id`,
        )
        .all() as unknown as Array<{
        goal_id: string;
        plan_id: string;
        item_id: string;
        task_id: string | null;
        gate: string;
        item_index: number;
        satisfied: number;
        record_json: string;
      }>;
      this.db.exec("ALTER TABLE goal_milestones RENAME TO goal_milestones_legacy");
      this.db.exec(`
        CREATE TABLE goal_milestones (
          goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
          plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
          item_id TEXT NOT NULL,
          task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
          gate TEXT NOT NULL,
          item_index INTEGER NOT NULL,
          satisfied INTEGER NOT NULL DEFAULT 0,
          record_json TEXT NOT NULL,
          PRIMARY KEY (goal_id, plan_id, item_id),
          UNIQUE (goal_id, plan_id, item_index)
        );
      `);
      const insert = this.db.prepare(
        `INSERT INTO goal_milestones
          (goal_id, plan_id, item_id, task_id, gate, item_index, satisfied, record_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of rows) {
        const record = parseRecord<GoalMilestoneRecord>(row.record_json, "goal milestone");
        const normalized = { ...record, planId: row.plan_id };
        insert.run(
          row.goal_id,
          row.plan_id,
          row.item_id,
          row.task_id,
          row.gate,
          row.item_index,
          row.satisfied ? 1 : 0,
          JSON.stringify(normalized),
        );
      }
      this.db.exec("DROP TABLE goal_milestones_legacy");
      this.db.exec(
        "CREATE INDEX IF NOT EXISTS idx_goal_milestones_task ON goal_milestones(task_id)",
      );
      this.db.exec(
        "CREATE INDEX IF NOT EXISTS idx_goal_milestones_goal ON goal_milestones(goal_id, item_index)",
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  private insertTask(record: TaskRecord): void {
    this.db
      .prepare("INSERT INTO tasks (id, status, updated_at, record_json) VALUES (?, ?, ?, ?)")
      .run(record.id, record.status, record.updatedAt, JSON.stringify(record));
  }

  createTask(record: TaskRecord): void {
    this.insertTask(record);
  }

  getTask(taskId: string): TaskRecord {
    const row = this.db.prepare("SELECT record_json FROM tasks WHERE id = ?").get(taskId) as
      | { record_json: string }
      | undefined;
    if (!row) throw new Error(`Unknown ForkLight task: ${taskId}`);
    return parseRecord<TaskRecord>(row.record_json, "task");
  }

  updateTask(taskId: string, patch: TaskRecordPatch): TaskRecord {
    const current = this.getTask(taskId);
    const merged: Record<string, unknown> = { ...current, ...patch, id: current.id, updatedAt: now() };
    for (const key of ["error", "finishedAt", "workerPid", "currentAttemptId", "startedAt"] as const) {
      if (merged[key] === null) delete merged[key];
    }
    const updated = merged as unknown as TaskRecord;
    this.db
      .prepare("UPDATE tasks SET status = ?, updated_at = ?, record_json = ? WHERE id = ?")
      .run(updated.status, updated.updatedAt, JSON.stringify(updated), taskId);
    return updated;
  }

  listTasks(statuses?: TaskStatus[]): TaskRecord[] {
    const rows = statuses && statuses.length > 0
      ? this.db
          .prepare(
            `SELECT record_json FROM tasks
             WHERE status IN (${statuses.map(() => "?").join(", ")})
             ORDER BY updated_at DESC`,
          )
          .all(...statuses)
      : this.db.prepare("SELECT record_json FROM tasks ORDER BY updated_at DESC").all();
    return (rows as unknown as Array<{ record_json: string }>).map((row) =>
      parseRecord<TaskRecord>(row.record_json, "task"),
    );
  }

  setTaskStatus(taskId: string, status: TaskStatus, extra: TaskRecordPatch = {}): TaskRecord {
    return this.updateTask(taskId, { ...extra, status });
  }

  createAttempt(record: AttemptRecord): void {
    this.db
      .prepare(
        "INSERT INTO attempts (id, task_id, ordinal, status, record_json) VALUES (?, ?, ?, ?, ?)",
      )
      .run(record.id, record.taskId, record.ordinal, record.status, JSON.stringify(record));
  }

  nextAttemptOrdinal(taskId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(ordinal), 0) AS ordinal FROM attempts WHERE task_id = ?")
      .get(taskId) as { ordinal: number };
    return Number(row.ordinal) + 1;
  }

  getAttempt(attemptId: string): AttemptRecord {
    const row = this.db.prepare("SELECT record_json FROM attempts WHERE id = ?").get(attemptId) as
      | { record_json: string }
      | undefined;
    if (!row) throw new Error(`Unknown ForkLight attempt: ${attemptId}`);
    return parseRecord<AttemptRecord>(row.record_json, "attempt");
  }

  updateAttempt(attemptId: string, patch: Partial<AttemptRecord>): AttemptRecord {
    const current = this.getAttempt(attemptId);
    const updated: AttemptRecord = { ...current, ...patch, id: current.id };
    this.db
      .prepare("UPDATE attempts SET status = ?, record_json = ? WHERE id = ?")
      .run(updated.status, JSON.stringify(updated), attemptId);
    return updated;
  }

  listAttempts(taskId: string): AttemptRecord[] {
    const rows = this.db
      .prepare("SELECT record_json FROM attempts WHERE task_id = ? ORDER BY ordinal")
      .all(taskId) as unknown as Array<{ record_json: string }>;
    return rows.map((row) => parseRecord<AttemptRecord>(row.record_json, "attempt"));
  }

  private insertEvent(
    taskId: string,
    attemptId: string | undefined,
    type: EventType,
    summary: string,
    payload?: unknown,
  ): EventRecord {
    const sequenceRow = this.db
      .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM events WHERE task_id = ?")
      .get(taskId) as { sequence: number };
    const timestamp = now();
    const payloadJson = payload === undefined ? null : JSON.stringify(payload);
    const result = this.db
      .prepare(
        `INSERT INTO events
          (task_id, attempt_id, sequence, timestamp, type, summary, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(taskId, attemptId ?? null, sequenceRow.sequence, timestamp, type, summary, payloadJson);
    return {
      id: Number(result.lastInsertRowid),
      taskId,
      ...(attemptId === undefined ? {} : { attemptId }),
      sequence: sequenceRow.sequence,
      timestamp,
      type,
      summary,
      ...(payload === undefined ? {} : { payload }),
    };
  }

  addEvent(
    taskId: string,
    attemptId: string | undefined,
    type: EventType,
    summary: string,
    payload?: unknown,
  ): EventRecord {
    return this.insertEvent(taskId, attemptId, type, summary, payload);
  }

  listEvents(taskId: string): EventRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, task_id, attempt_id, sequence, timestamp, type, summary, payload_json
         FROM events WHERE task_id = ? ORDER BY sequence`,
      )
      .all(taskId) as unknown as Array<{
      id: number;
      task_id: string;
      attempt_id: string | null;
      sequence: number;
      timestamp: string;
      type: EventType;
      summary: string;
      payload_json: string | null;
    }>;
    return rows.map((row) => ({
      id: Number(row.id),
      taskId: row.task_id,
      ...(row.attempt_id === null ? {} : { attemptId: row.attempt_id }),
      sequence: Number(row.sequence),
      timestamp: row.timestamp,
      type: row.type,
      summary: row.summary,
      ...(row.payload_json === null ? {} : { payload: JSON.parse(row.payload_json) as unknown }),
    }));
  }

  /** Latest event for progress cursors. O(1) by max sequence; omits payload. */
  latestEventMeta(taskId: string): Pick<EventRecord, "sequence" | "timestamp" | "type" | "summary"> | undefined {
    const row = this.db
      .prepare(
        `SELECT sequence, timestamp, type, summary
         FROM events WHERE task_id = ? ORDER BY sequence DESC LIMIT 1`,
      )
      .get(taskId) as
      | { sequence: number; timestamp: string; type: EventType; summary: string }
      | undefined;
    if (row === undefined) return undefined;
    return {
      sequence: Number(row.sequence),
      timestamp: row.timestamp,
      type: row.type,
      summary: row.summary,
    };
  }

  /** Read the latest structured workspace-preparation stage without loading
   *  the full event payload history. Callers only request it for preparing
   *  Tasks, where the matching event is at the end of the Task timeline. */
  latestPreparationStageMeta(taskId: string): {
    stage: string;
    phase: "start" | "complete";
    elapsedMs: number;
    countKind?: "files" | "dependencies";
    count?: number;
  } | undefined {
    const row = this.db
      .prepare(
        `SELECT payload_json FROM events
         WHERE task_id = ? AND type = 'workspace.preparation.stage'
         ORDER BY sequence DESC LIMIT 1`,
      )
      .get(taskId) as { payload_json: string | null } | undefined;
    if (row === undefined || row.payload_json === null) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payload_json);
    } catch {
      return undefined;
    }
    if (parsed === null || typeof parsed !== "object") return undefined;
    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.stage !== "string"
      || (candidate.phase !== "start" && candidate.phase !== "complete")
      || typeof candidate.elapsedMs !== "number"
      || !Number.isFinite(candidate.elapsedMs)
    ) {
      return undefined;
    }
    return {
      stage: candidate.stage,
      phase: candidate.phase,
      elapsedMs: candidate.elapsedMs,
      ...(candidate.countKind === "files" || candidate.countKind === "dependencies"
        ? { countKind: candidate.countKind }
        : {}),
      ...(typeof candidate.count === "number" && Number.isFinite(candidate.count)
        ? { count: candidate.count }
        : {}),
    };
  }

  private validatePlanGraph(
    plan: PlanRecord,
    items: PlanItemRecord[],
    dependencies: DependencyRecord[],
  ): void {
    if (items.length === 0) throw new Error("A plan graph must contain at least one item");
    if (items.some((item) => item.planId !== plan.id)) {
      throw new Error(`Every plan item must belong to plan ${plan.id}`);
    }
    const itemIds = new Set(items.map((item) => item.id));
    if (itemIds.size !== items.length) throw new Error("Plan item IDs must be unique");
    for (const dependency of dependencies) {
      if (dependency.planId !== plan.id) {
        throw new Error(`Every dependency must belong to plan ${plan.id}`);
      }
      if (!itemIds.has(dependency.itemId) || !itemIds.has(dependency.dependsOnItemId)) {
        throw new Error("Every dependency endpoint must reference an item in the same plan");
      }
    }
  }

  private insertPlanGraph(
    plan: PlanRecord,
    items: PlanItemRecord[],
    dependencies: DependencyRecord[],
  ): void {
    this.db
      .prepare(
        "INSERT INTO plans (id, name, objective, plan_file, created_at, updated_at, record_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        plan.id,
        plan.name,
        plan.objective,
        plan.planFile,
        plan.createdAt,
        plan.updatedAt,
        JSON.stringify(plan),
      );
    const insertItem = this.db.prepare(
      "INSERT INTO plan_items (id, plan_id, task_id, item_index, task_file, record_json) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const item of items) {
      insertItem.run(
        item.id,
        item.planId,
        item.taskId ?? null,
        item.itemIndex,
        item.taskFile,
        JSON.stringify(item),
      );
    }
    const insertDependency = this.db.prepare(
      "INSERT INTO plan_dependencies (plan_id, item_id, depends_on_item_id) VALUES (?, ?, ?)",
    );
    for (const dependency of dependencies) {
      insertDependency.run(dependency.planId, dependency.itemId, dependency.dependsOnItemId);
    }
  }

  atomic<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private transact(action: () => void): void {
    this.atomic(action);
  }

  createPlanGraph(
    plan: PlanRecord,
    items: PlanItemRecord[],
    dependencies: DependencyRecord[],
  ): void {
    this.validatePlanGraph(plan, items, dependencies);
    this.transact(() => this.insertPlanGraph(plan, items, dependencies));
  }

  /** Shared validation for every staged Task/Plan registration graph. Reused by
   *  ordinary Plan submission and by confirmed outcome-intake creation so both
   *  paths enforce the exact same one-unique-task-per-item contract. */
  private validatePlanExecution(
    registrations: StagedTaskRegistration[],
    plan: PlanRecord,
    items: PlanItemRecord[],
    dependencies: DependencyRecord[],
  ): void {
    this.validatePlanGraph(plan, items, dependencies);
    const taskIds = new Set(registrations.map(({ task }) => task.id));
    const itemTaskIds = items.map((item) => item.taskId);
    if (
      taskIds.size !== registrations.length ||
      itemTaskIds.length !== registrations.length ||
      itemTaskIds.some((taskId) => taskId === undefined || !taskIds.has(taskId))
    ) {
      throw new Error("Plan execution requires one unique staged task for every plan item");
    }
  }

  /** Shared validation for a staged Goal registration graph. */
  private validateGoalExecution(
    registrations: StagedTaskRegistration[],
    plan: PlanRecord,
    items: PlanItemRecord[],
    dependencies: DependencyRecord[],
    goal: GoalRecord,
    milestones: GoalMilestoneRecord[],
  ): void {
    this.validatePlanExecution(registrations, plan, items, dependencies);
    if (goal.planId !== plan.id) {
      throw new Error("Goal planId must match the registered plan");
    }
    if (milestones.length !== items.length) {
      throw new Error("Goal must declare one milestone for every plan item");
    }
    for (const milestone of milestones) {
      if (milestone.goalId !== goal.id) {
        throw new Error(`Every milestone must belong to goal ${goal.id}`);
      }
      if (!items.some((item) => item.id === milestone.itemId && item.taskId === milestone.taskId)) {
        throw new Error(`Milestone ${milestone.itemId} must link the registered plan Task`);
      }
    }
  }

  /** Shared insert body for a staged Task/Plan graph. */
  private insertPlanExecution(
    registrations: StagedTaskRegistration[],
    plan: PlanRecord,
    items: PlanItemRecord[],
    dependencies: DependencyRecord[],
  ): void {
    for (const { task, creationEvent } of registrations) {
      this.insertTask(task);
      this.insertEvent(
        task.id,
        undefined,
        "task.created",
        creationEvent.summary,
        creationEvent.payload,
      );
    }
    this.insertPlanGraph(plan, items, dependencies);
  }

  /** Shared insert body for a staged Goal graph. */
  private insertPlanExecutionWithGoal(
    registrations: StagedTaskRegistration[],
    plan: PlanRecord,
    items: PlanItemRecord[],
    dependencies: DependencyRecord[],
    goal: GoalRecord,
    milestones: GoalMilestoneRecord[],
  ): void {
    this.insertPlanExecution(registrations, plan, items, dependencies);
    this.insertGoal(goal, milestones);
  }

  createPlanExecution(
    registrations: StagedTaskRegistration[],
    plan: PlanRecord,
    items: PlanItemRecord[],
    dependencies: DependencyRecord[],
  ): void {
    this.validatePlanExecution(registrations, plan, items, dependencies);
    this.transact(() => this.insertPlanExecution(registrations, plan, items, dependencies));
  }

  /**
   * Atomically register Plan Tasks, dependencies, Goal, and milestones before
   * any in-memory queue action. Validation must already be complete.
   */
  createPlanExecutionWithGoal(
    registrations: StagedTaskRegistration[],
    plan: PlanRecord,
    items: PlanItemRecord[],
    dependencies: DependencyRecord[],
    goal: GoalRecord,
    milestones: GoalMilestoneRecord[],
  ): void {
    this.validateGoalExecution(registrations, plan, items, dependencies, goal, milestones);
    this.transact(() =>
      this.insertPlanExecutionWithGoal(registrations, plan, items, dependencies, goal, milestones),
    );
  }

  /** Shared validation for an ordered multi-Plan Goal graph. Every phase Plan
   *  must be independently valid and own one unique staged Task per item;
   *  associations are ordinals 0..n-1; milestones are plan-qualified. */
  private validateGoalPhasesExecution(params: {
    registrationsByPlan: StagedTaskRegistration[][];
    plans: PlanRecord[];
    itemsByPlan: PlanItemRecord[][];
    dependenciesByPlan: DependencyRecord[][];
    goal: GoalRecord;
    associations: GoalPlanAssociation[];
    milestones: GoalMilestoneRecord[];
  }): void {
    const { plans, registrationsByPlan, itemsByPlan, dependenciesByPlan } = params;
    if (plans.length < 2) {
      throw new Error("A Goal must declare at least two ordered phase Plans");
    }
    if (
      plans.length !== registrationsByPlan.length
      || plans.length !== itemsByPlan.length
      || plans.length !== dependenciesByPlan.length
    ) {
      throw new Error("Goal phase registration counts must match");
    }
    const planIds = new Set<string>();
    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index]!;
      if (planIds.has(plan.id)) throw new Error("Goal phase Plans must be unique");
      planIds.add(plan.id);
      this.validatePlanExecution(
        registrationsByPlan[index]!,
        plan,
        itemsByPlan[index]!,
        dependenciesByPlan[index]!,
      );
    }
    if (params.goal.planId !== plans[0]!.id) {
      throw new Error("Goal planId must match the first phase Plan");
    }
    if (params.associations.length !== plans.length) {
      throw new Error("Goal must declare one association per phase Plan");
    }
    for (let index = 0; index < plans.length; index += 1) {
      const association = params.associations[index]!;
      if (
        association.goalId !== params.goal.id
        || association.planId !== plans[index]!.id
        || association.ordinal !== index
      ) {
        throw new Error("Goal associations must be ordered by phase Plan");
      }
    }
    const planIndex = new Map(plans.map((plan, index) => [plan.id, index]));
    for (const milestone of params.milestones) {
      if (milestone.goalId !== params.goal.id) {
        throw new Error(`Every milestone must belong to goal ${params.goal.id}`);
      }
      if (milestone.planId === undefined) {
        throw new Error("Every Goal milestone must carry a plan identity");
      }
      const index = planIndex.get(milestone.planId);
      if (index === undefined) {
        throw new Error(
          `Milestone ${milestone.itemId} references unknown plan ${milestone.planId}`,
        );
      }
      const items = params.itemsByPlan[index]!;
      if (!items.some((item) => item.id === milestone.itemId && item.taskId === milestone.taskId)) {
        throw new Error(`Milestone ${milestone.itemId} must link the registered plan Task`);
      }
    }
    // Exact one-to-one milestone coverage per Plan item: every item must have
    // exactly one plan-qualified milestone linked to its registered Task.
    // Missing, duplicate, extra, or mismatched rows fail before any mutation.
    for (let index = 0; index < plans.length; index += 1) {
      const planId = plans[index]!.id;
      const items = params.itemsByPlan[index]!;
      const countByItem = new Map<string, number>();
      for (const milestone of params.milestones) {
        if ((milestone.planId ?? params.goal.planId) !== planId) continue;
        countByItem.set(milestone.itemId, (countByItem.get(milestone.itemId) ?? 0) + 1);
      }
      for (const item of items) {
        const count = countByItem.get(item.id) ?? 0;
        if (count === 0) {
          throw new Error(`Plan item ${item.id} is missing a goal milestone gate`);
        }
        if (count > 1) {
          throw new Error(`Plan item ${item.id} has duplicate goal milestone gates`);
        }
      }
    }
  }

  /** Shared insert body for an ordered multi-Plan Goal graph. */
  private insertGoalPhasesExecution(params: {
    registrationsByPlan: StagedTaskRegistration[][];
    plans: PlanRecord[];
    itemsByPlan: PlanItemRecord[][];
    dependenciesByPlan: DependencyRecord[][];
    goal: GoalRecord;
    associations: GoalPlanAssociation[];
    milestones: GoalMilestoneRecord[];
  }): void {
    for (let index = 0; index < params.plans.length; index += 1) {
      this.insertPlanExecution(
        params.registrationsByPlan[index]!,
        params.plans[index]!,
        params.itemsByPlan[index]!,
        params.dependenciesByPlan[index]!,
      );
    }
    this.insertGoalRecords(params.goal, params.associations, params.milestones);
  }

  /**
   * Atomically register every ordered phase Plan graph (Tasks, dependencies,
   * items), the ordered Goal-Plan associations, the Goal record, and every
   * plan-qualified milestone as one unit before any in-memory queue action.
   * A relational or validation failure in any later phase leaves zero new
   * Task, Plan, association, Goal, milestone, or event rows.
   */
  createGoalPhasesExecution(params: {
    registrationsByPlan: StagedTaskRegistration[][];
    plans: PlanRecord[];
    itemsByPlan: PlanItemRecord[][];
    dependenciesByPlan: DependencyRecord[][];
    goal: GoalRecord;
    associations: GoalPlanAssociation[];
    milestones: GoalMilestoneRecord[];
  }): void {
    this.validateGoalPhasesExecution(params);
    this.transact(() => this.insertGoalPhasesExecution(params));
  }

  /**
   * Atomically confirm one explicit Main outcome intake: commit the complete
   * existing Task/Plan/Goal registration graph AND advance the intake to the
   * terminal created state with one durable receipt as a single SQLite unit.
   * The current intake row is re-read inside the transaction; a stale or
   * non-proposed intake fails closed with the fixed privacy-safe reasons and no
   * Task/event/Plan/dependency/Goal/milestone row is written. This is the
   * exactly-once authority — every insert and the intake update commit or none
   * do, so a retry can never create a second graph.
   */
  createOutcomeIntakeConfirmation(params: {
    intakeId: string;
    expectedRevision: number;
    updatedIntake: OutcomeIntakeRecord;
    registrations: StagedTaskRegistration[];
    plan?: PlanRecord;
    items?: PlanItemRecord[];
    dependencies?: DependencyRecord[];
    goal?: GoalRecord;
    milestones?: GoalMilestoneRecord[];
    /** Ordered multi-Plan Goal graph for v2 confirmations. */
    goalPhases?: {
      registrationsByPlan: StagedTaskRegistration[][];
      plans: PlanRecord[];
      itemsByPlan: PlanItemRecord[][];
      dependenciesByPlan: DependencyRecord[][];
      associations: GoalPlanAssociation[];
    };
  }): void {
    this.transact(() => {
      const row = this.db
        .prepare("SELECT status, revision FROM outcome_intakes WHERE id = ?")
        .get(params.intakeId) as { status: OutcomeIntakeStatus; revision: number } | undefined;
      if (!row) throw new Error("Unknown outcome intake");
      if (row.revision !== params.expectedRevision) {
        throw new Error(STALE_OUTCOME_INTAKE_CONFIRM_REASON);
      }
      if (row.status !== "proposed") {
        throw new Error(OUTCOME_INTAKE_NO_PROPOSAL_REASON);
      }
      // Internal confirmation-graph invariants fail closed BEFORE any insert:
      // the updated intake identity/status/revision/receipt and the staged
      // Task/Plan/Goal ids must match the confirmed proposal exactly.
      if (params.updatedIntake.id !== params.intakeId) {
        throw new Error("Confirmation intake identity mismatch");
      }
      if (params.updatedIntake.status !== "created") {
        throw new Error("Confirmation intake must be terminal created");
      }
      if (params.updatedIntake.revision !== params.expectedRevision + 1) {
        throw new Error("Confirmation intake revision mismatch");
      }
      const receipt = params.updatedIntake.confirmation;
      if (
        receipt === undefined
        || receipt.intakeId !== params.intakeId
        || receipt.proposalRevision !== params.expectedRevision
      ) {
        throw new Error("Confirmation receipt does not match the intake revision");
      }
      const stagedTaskIds = params.registrations.map(({ task }) => task.id);
      if (
        receipt.taskIds.length !== stagedTaskIds.length
        || receipt.taskIds.some((taskId, index) => taskId !== stagedTaskIds[index])
      ) {
        throw new Error("Confirmation receipt does not match the staged work graph");
      }
      // Multi-phase Goals insert registrationsByPlan, not the flat registrations
      // array. Bind receipt-facing and insertion-facing Task order exactly so a
      // length, order, duplicate, or identity mismatch fails before mutation.
      if (params.goalPhases !== undefined) {
        const phaseTaskIds = params.goalPhases.registrationsByPlan
          .flat()
          .map(({ task }) => task.id);
        if (
          stagedTaskIds.length !== phaseTaskIds.length
          || stagedTaskIds.some((taskId, index) => taskId !== phaseTaskIds[index])
        ) {
          throw new Error(
            "Confirmation staged work graph does not match the ordered phase registrations",
          );
        }
      }
      if (params.plan === undefined) {
        if (receipt.planId !== undefined) {
          throw new Error("Confirmation receipt plan does not match the staged plan");
        }
      } else if (receipt.planId !== params.plan.id) {
        throw new Error("Confirmation receipt plan does not match the staged plan");
      }
      if (params.goal === undefined) {
        if (receipt.goalId !== undefined) {
          throw new Error("Confirmation receipt goal does not match the staged goal");
        }
      } else if (receipt.goalId !== params.goal.id) {
        throw new Error("Confirmation receipt goal does not match the staged goal");
      }
      if (params.goal !== undefined) {
        if (params.goalPhases !== undefined) {
          if (params.milestones === undefined) {
            throw new Error("Goal confirmation requires plan-qualified milestones");
          }
          this.validateGoalPhasesExecution({
            registrationsByPlan: params.goalPhases.registrationsByPlan,
            plans: params.goalPhases.plans,
            itemsByPlan: params.goalPhases.itemsByPlan,
            dependenciesByPlan: params.goalPhases.dependenciesByPlan,
            goal: params.goal,
            associations: params.goalPhases.associations,
            milestones: params.milestones,
          });
          this.insertGoalPhasesExecution({
            registrationsByPlan: params.goalPhases.registrationsByPlan,
            plans: params.goalPhases.plans,
            itemsByPlan: params.goalPhases.itemsByPlan,
            dependenciesByPlan: params.goalPhases.dependenciesByPlan,
            goal: params.goal,
            associations: params.goalPhases.associations,
            milestones: params.milestones,
          });
        } else {
          if (
            params.plan === undefined
            || params.items === undefined
            || params.dependencies === undefined
            || params.milestones === undefined
          ) {
            throw new Error("Goal confirmation requires a complete plan graph");
          }
          this.validateGoalExecution(
            params.registrations,
            params.plan,
            params.items,
            params.dependencies,
            params.goal,
            params.milestones,
          );
          this.insertPlanExecutionWithGoal(
            params.registrations,
            params.plan,
            params.items,
            params.dependencies,
            params.goal,
            params.milestones,
          );
        }
      } else if (params.plan !== undefined) {
        if (params.items === undefined || params.dependencies === undefined) {
          throw new Error("Plan confirmation requires a complete item graph");
        }
        this.validatePlanExecution(params.registrations, params.plan, params.items, params.dependencies);
        this.insertPlanExecution(params.registrations, params.plan, params.items, params.dependencies);
      } else {
        if (params.registrations.length !== 1) {
          throw new Error("Task confirmation requires exactly one staged task");
        }
        const { task, creationEvent } = params.registrations[0]!;
        this.insertTask(task);
        this.insertEvent(
          task.id,
          undefined,
          "task.created",
          creationEvent.summary,
          creationEvent.payload,
        );
      }
      const result = this.db
        .prepare(
          `UPDATE outcome_intakes
           SET status = ?, revision = ?, updated_at = ?, record_json = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(
          params.updatedIntake.status,
          params.updatedIntake.revision,
          params.updatedIntake.updatedAt,
          JSON.stringify(params.updatedIntake),
          params.intakeId,
          params.expectedRevision,
        );
      if (result.changes !== 1) {
        throw new Error(STALE_OUTCOME_INTAKE_CONFIRM_REASON);
      }
    });
  }

  /** Insert one Goal with its ordered associations and plan-qualified
   *  milestones as one unit. Legacy single-Plan creation uses ordinal zero. */
  private insertGoalRecords(
    goal: GoalRecord,
    associations: GoalPlanAssociation[],
    milestones: GoalMilestoneRecord[],
  ): void {
    this.db
      .prepare(
        "INSERT INTO goals (id, plan_id, status, created_at, updated_at, record_json) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        goal.id,
        goal.planId,
        goal.status,
        goal.createdAt,
        goal.updatedAt,
        JSON.stringify(goal),
      );
    const insertAssociation = this.db.prepare(
      `INSERT INTO goal_plan_associations (goal_id, plan_id, ordinal, created_at)
       VALUES (?, ?, ?, ?)`,
    );
    for (const association of associations) {
      insertAssociation.run(
        association.goalId,
        association.planId,
        association.ordinal,
        association.createdAt,
      );
    }
    const insertMilestone = this.db.prepare(
      `INSERT INTO goal_milestones
        (goal_id, plan_id, item_id, task_id, gate, item_index, satisfied, record_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const milestone of milestones) {
      const normalized = { ...milestone, planId: milestone.planId ?? goal.planId };
      insertMilestone.run(
        normalized.goalId,
        normalized.planId,
        normalized.itemId,
        normalized.taskId ?? null,
        normalized.gate,
        normalized.itemIndex,
        normalized.satisfied ? 1 : 0,
        JSON.stringify(normalized),
      );
    }
  }

  private insertGoal(goal: GoalRecord, milestones: GoalMilestoneRecord[]): void {
    const association: GoalPlanAssociation = {
      goalId: goal.id,
      planId: goal.planId,
      ordinal: 0,
      createdAt: goal.createdAt,
    };
    this.insertGoalRecords(goal, [association], milestones);
  }

  saveGoal(goal: GoalRecord, milestones?: readonly GoalMilestoneRecord[]): void {
    this.transact(() => {
      this.db
        .prepare(
          "UPDATE goals SET plan_id = ?, status = ?, updated_at = ?, record_json = ? WHERE id = ?",
        )
        .run(goal.planId, goal.status, goal.updatedAt, JSON.stringify(goal), goal.id);
      if (milestones !== undefined) {
        const update = this.db.prepare(
          `UPDATE goal_milestones
           SET task_id = ?, gate = ?, item_index = ?, satisfied = ?, record_json = ?
           WHERE goal_id = ? AND plan_id = ? AND item_id = ?`,
        );
        for (const milestone of milestones) {
          const normalized = { ...milestone, planId: milestone.planId ?? goal.planId };
          update.run(
            normalized.taskId ?? null,
            normalized.gate,
            normalized.itemIndex,
            normalized.satisfied ? 1 : 0,
            JSON.stringify(normalized),
            normalized.goalId,
            normalized.planId,
            normalized.itemId,
          );
        }
      }
    });
  }

  getGoal(goalId: string): GoalRecord {
    const row = this.db.prepare("SELECT record_json FROM goals WHERE id = ?").get(goalId) as
      | { record_json: string }
      | undefined;
    if (!row) throw new Error(`Unknown ForkLight goal: ${goalId}`);
    return parseRecord<GoalRecord>(row.record_json, "goal");
  }

  listGoals(limit = 50): GoalRecord[] {
    const bounded = Math.max(1, Math.min(limit, 100));
    const rows = this.db
      .prepare("SELECT record_json FROM goals ORDER BY updated_at DESC LIMIT ?")
      .all(bounded) as unknown as Array<{ record_json: string }>;
    return rows.map((row) => parseRecord<GoalRecord>(row.record_json, "goal"));
  }

  getGoalByPlanId(planId: string): GoalRecord | undefined {
    // Ownership truth is the durable association relation (primary and later Plans).
    const row = this.db
      .prepare(
        `SELECT g.record_json AS record_json
         FROM goal_plan_associations gpa
         JOIN goals g ON g.id = gpa.goal_id
         WHERE gpa.plan_id = ?
         LIMIT 1`,
      )
      .get(planId) as { record_json: string } | undefined;
    return row ? parseRecord<GoalRecord>(row.record_json, "goal") : undefined;
  }

  getGoalByTaskId(taskId: string): GoalRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT g.record_json AS record_json
         FROM goal_milestones gm
         JOIN goals g ON g.id = gm.goal_id
         WHERE gm.task_id = ?
         LIMIT 1`,
      )
      .get(taskId) as { record_json: string } | undefined;
    if (row) return parseRecord<GoalRecord>(row.record_json, "goal");

    // Direct Goal-Task handoff successor: resolve via source milestone Task.
    const asSuccessor = this.getCandidateHandoffBySuccessorTaskId(taskId);
    if (
      asSuccessor !== undefined
      && asSuccessor.origin.kind === "goal-task"
    ) {
      try {
        return this.getGoal(asSuccessor.origin.goalId);
      } catch {
        return undefined;
      }
    }

    // Later associated Plans have no primary milestones yet; resolve via Plan ownership.
    const planItem = this.getPlanItemByTaskId(taskId);
    if (planItem !== undefined) {
      return this.getGoalByPlanId(planItem.planId);
    }
    return undefined;
  }

  /**
   * Ordered durable Plan membership for one Goal. Fail-closed on unknown Goal.
   * Does not claim later Plans are active or milestone-supervised.
   */
  listGoalPlanAssociations(goalId: string): GoalPlanAssociation[] {
    this.getGoal(goalId);
    const rows = this.db
      .prepare(
        `SELECT goal_id, plan_id, ordinal, created_at
         FROM goal_plan_associations
         WHERE goal_id = ?
         ORDER BY ordinal ASC`,
      )
      .all(goalId) as unknown as Array<{
      goal_id: string;
      plan_id: string;
      ordinal: number;
      created_at: string;
    }>;
    return rows.map((row) => ({
      goalId: row.goal_id,
      planId: row.plan_id,
      ordinal: row.ordinal,
      createdAt: row.created_at,
    }));
  }

  /**
   * Append one already-persisted independent Plan as the next ordered member.
   * Fail-closed: Goal/Plan must exist; Plan must not already have a Goal owner;
   * ordinal is assigned as max+1 (or 0 when empty). Does not create Tasks,
   * admit queue work, or mutate milestones.
   */
  attachPlanToGoal(goalId: string, planId: string): GoalPlanAssociation {
    return this.atomic(() => {
      this.getGoal(goalId);
      this.getPlan(planId);

      const owned = this.db
        .prepare(
          "SELECT goal_id AS goal_id FROM goal_plan_associations WHERE plan_id = ?",
        )
        .get(planId) as { goal_id: string } | undefined;
      if (owned !== undefined) {
        throw new Error(
          owned.goal_id === goalId
            ? `Plan ${planId} is already associated with goal ${goalId}`
            : `Plan ${planId} is already owned by goal ${owned.goal_id}`,
        );
      }

      const maxRow = this.db
        .prepare(
          "SELECT MAX(ordinal) AS max_ord FROM goal_plan_associations WHERE goal_id = ?",
        )
        .get(goalId) as { max_ord: number | null } | undefined;
      const nextOrdinal =
        maxRow?.max_ord === null || maxRow?.max_ord === undefined
          ? 0
          : maxRow.max_ord + 1;
      if (!Number.isSafeInteger(nextOrdinal) || nextOrdinal < 0) {
        throw new Error(`Invalid next ordinal for goal ${goalId}`);
      }

      const createdAt = now();
      try {
        this.db
          .prepare(
            `INSERT INTO goal_plan_associations (goal_id, plan_id, ordinal, created_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(goalId, planId, nextOrdinal, createdAt);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/UNIQUE constraint failed/i.test(message)) {
          throw new Error(
            `Goal ${goalId} already has a Plan at ordinal ${nextOrdinal} or Plan ${planId} is already associated`,
          );
        }
        throw error;
      }

      return {
        goalId,
        planId,
        ordinal: nextOrdinal,
        createdAt,
      };
    });
  }

  getGoalMilestones(goalId: string): GoalMilestoneRecord[] {
    const rows = this.db
      .prepare(
        `SELECT gm.record_json AS record_json, gm.plan_id AS plan_id
         FROM goal_milestones gm
         LEFT JOIN goal_plan_associations gpa
           ON gpa.goal_id = gm.goal_id AND gpa.plan_id = gm.plan_id
         WHERE gm.goal_id = ?
         ORDER BY gpa.ordinal ASC, gm.item_index ASC`,
      )
      .all(goalId) as unknown as Array<{ record_json: string; plan_id: string }>;
    return rows.map((row) => {
      const record = parseRecord<GoalMilestoneRecord>(row.record_json, "goal milestone");
      if (record.planId === undefined) return { ...record, planId: row.plan_id };
      return record;
    });
  }

  getGoalMilestone(
    goalId: string,
    itemId: string,
    planId?: string,
  ): GoalMilestoneRecord | undefined {
    const row = planId === undefined
      ? (this.db
          .prepare(
            "SELECT record_json FROM goal_milestones WHERE goal_id = ? AND item_id = ?",
          )
          .get(goalId, itemId) as { record_json: string } | undefined)
      : (this.db
          .prepare(
            "SELECT record_json FROM goal_milestones WHERE goal_id = ? AND plan_id = ? AND item_id = ?",
          )
          .get(goalId, planId, itemId) as { record_json: string } | undefined);
    return row
      ? parseRecord<GoalMilestoneRecord>(row.record_json, "goal milestone")
      : undefined;
  }

  getPlan(planId: string): PlanRecord {
    const row = this.db.prepare("SELECT record_json FROM plans WHERE id = ?").get(planId) as
      | { record_json: string }
      | undefined;
    if (!row) throw new Error(`Unknown ForkLight plan: ${planId}`);
    return parseRecord<PlanRecord>(row.record_json, "plan");
  }

  listPlans(): PlanRecord[] {
    const rows = this.db.prepare("SELECT record_json FROM plans ORDER BY created_at DESC").all();
    return (rows as unknown as Array<{ record_json: string }>).map((row) =>
      parseRecord<PlanRecord>(row.record_json, "plan"),
    );
  }

  getPlanItems(planId: string): PlanItemRecord[] {
    const rows = this.db
      .prepare("SELECT record_json FROM plan_items WHERE plan_id = ? ORDER BY item_index")
      .all(planId) as unknown as Array<{ record_json: string }>;
    return rows.map((row) => parseRecord<PlanItemRecord>(row.record_json, "plan item"));
  }

  getDependencies(planId: string): DependencyRecord[] {
    const rows = this.db
      .prepare(
        "SELECT plan_id, item_id, depends_on_item_id FROM plan_dependencies WHERE plan_id = ? ORDER BY item_id, depends_on_item_id",
      )
      .all(planId) as unknown as Array<{
      plan_id: string;
      item_id: string;
      depends_on_item_id: string;
    }>;
    return rows.map((row) => ({
      planId: row.plan_id,
      itemId: row.item_id,
      dependsOnItemId: row.depends_on_item_id,
    }));
  }

  getDirectDependencies(planId: string, itemId: string): string[] {
    const rows = this.db
      .prepare(
        "SELECT depends_on_item_id FROM plan_dependencies WHERE plan_id = ? AND item_id = ? ORDER BY depends_on_item_id",
      )
      .all(planId, itemId) as unknown as Array<{ depends_on_item_id: string }>;
    return rows.map((row) => row.depends_on_item_id);
  }

  getDirectDependents(planId: string, itemId: string): string[] {
    const rows = this.db
      .prepare(
        "SELECT item_id FROM plan_dependencies WHERE plan_id = ? AND depends_on_item_id = ? ORDER BY item_id",
      )
      .all(planId, itemId) as unknown as Array<{ item_id: string }>;
    return rows.map((row) => row.item_id);
  }

  getPlanItemStatuses(planId: string): PlanItemStatus[] {
    const rows = this.db
      .prepare(
        `SELECT pi.id AS item_id, pi.task_id, t.status AS task_status
         FROM plan_items pi
         LEFT JOIN tasks t ON t.id = pi.task_id
         WHERE pi.plan_id = ?
         ORDER BY pi.item_index`,
      )
      .all(planId) as unknown as Array<{
      item_id: string;
      task_id: string | null;
      task_status: TaskStatus | null;
    }>;
    return rows.map((row) => ({
      itemId: row.item_id,
      ...(row.task_id === null ? {} : { taskId: row.task_id }),
      ...(row.task_status === null ? {} : { taskStatus: row.task_status }),
    }));
  }

  getPlanItemByTaskId(taskId: string): { planId: string; itemId: string } | undefined {
    const row = this.db
      .prepare("SELECT plan_id, id FROM plan_items WHERE task_id = ?")
      .get(taskId) as { plan_id: string; id: string } | undefined;
    return row ? { planId: row.plan_id, itemId: row.id } : undefined;
  }

  createCompetition(
    competition: CompetitionRecord,
    candidates: CompetitionCandidateRecord[],
  ): void {
    if (candidates.length < 2) throw new Error("A competition requires at least two candidates");
    if (candidates.some((candidate) => candidate.competitionId !== competition.id)) {
      throw new Error(`Every candidate must belong to competition ${competition.id}`);
    }
    this.transact(() => {
      this.db
        .prepare(
          "INSERT INTO competitions (id, status, created_at, updated_at, record_json) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          competition.id,
          competition.status,
          competition.createdAt,
          competition.updatedAt,
          JSON.stringify(competition),
        );
      const insert = this.db.prepare(
        "INSERT INTO competition_candidates (competition_id, id, task_id, ordinal, record_json) VALUES (?, ?, ?, ?, ?)",
      );
      for (const candidate of candidates) {
        insert.run(
          candidate.competitionId,
          candidate.id,
          candidate.taskId,
          candidate.ordinal,
          JSON.stringify(candidate),
        );
      }
    });
  }

  createCompetitionExecution(
    registrations: StagedTaskRegistration[],
    competition: CompetitionRecord,
    candidates: CompetitionCandidateRecord[],
  ): void {
    if (candidates.length < 2) throw new Error("A competition requires at least two candidates");
    if (candidates.some((candidate) => candidate.competitionId !== competition.id)) {
      throw new Error(`Every candidate must belong to competition ${competition.id}`);
    }
    const taskIds = new Set(registrations.map(({ task }) => task.id));
    if (
      taskIds.size !== registrations.length
      || candidates.length !== registrations.length
      || candidates.some((candidate) => !taskIds.has(candidate.taskId))
    ) {
      throw new Error("Competition execution requires one unique staged task for every candidate");
    }
    this.transact(() => {
      for (const { task, creationEvent, extraEvents } of registrations) {
        this.insertTask(task);
        this.insertEvent(
          task.id,
          undefined,
          "task.created",
          creationEvent.summary,
          creationEvent.payload,
        );
        if (extraEvents) {
          for (const event of extraEvents) {
            this.insertEvent(task.id, undefined, event.type, event.summary, event.payload);
          }
        }
      }
      this.db
        .prepare(
          "INSERT INTO competitions (id, status, created_at, updated_at, record_json) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          competition.id,
          competition.status,
          competition.createdAt,
          competition.updatedAt,
          JSON.stringify(competition),
        );
      const insert = this.db.prepare(
        "INSERT INTO competition_candidates (competition_id, id, task_id, ordinal, record_json) VALUES (?, ?, ?, ?, ?)",
      );
      for (const candidate of candidates) {
        insert.run(
          candidate.competitionId,
          candidate.id,
          candidate.taskId,
          candidate.ordinal,
          JSON.stringify(candidate),
        );
      }
    });
  }

  getCompetition(competitionId: string): CompetitionRecord {
    const row = this.db.prepare("SELECT record_json FROM competitions WHERE id = ?").get(
      competitionId,
    ) as { record_json: string } | undefined;
    if (!row) throw new Error(`Unknown competition: ${competitionId}`);
    return parseRecord<CompetitionRecord>(row.record_json, "competition");
  }

  listCompetitions(status?: CompetitionStatus): CompetitionRecord[] {
    const rows = status === undefined
      ? this.db.prepare("SELECT record_json FROM competitions ORDER BY created_at DESC").all()
      : this.db
          .prepare("SELECT record_json FROM competitions WHERE status = ? ORDER BY created_at DESC")
          .all(status);
    return (rows as unknown as Array<{ record_json: string }>).map((row) =>
      parseRecord<CompetitionRecord>(row.record_json, "competition"),
    );
  }

  getCompetitionCandidates(competitionId: string): CompetitionCandidateRecord[] {
    const rows = this.db
      .prepare(
        "SELECT record_json FROM competition_candidates WHERE competition_id = ? ORDER BY ordinal",
      )
      .all(competitionId) as unknown as Array<{ record_json: string }>;
    return rows.map((row) =>
      parseRecord<CompetitionCandidateRecord>(row.record_json, "competition candidate"),
    );
  }

  saveCompetitionEvaluation(
    evaluation: CompetitionEvaluationRecord,
  ): CompetitionRecord {
    let updated!: CompetitionRecord;
    this.transact(() => {
      const current = this.getCompetition(evaluation.competitionId);
      updated = {
        ...current,
        status: "completed",
        updatedAt: now(),
        finishedAt: evaluation.createdAt,
        latestEvaluationId: evaluation.id,
      };
      this.db
        .prepare(
          "INSERT INTO competition_evaluations (id, competition_id, created_at, record_json) VALUES (?, ?, ?, ?)",
        )
        .run(
          evaluation.id,
          evaluation.competitionId,
          evaluation.createdAt,
          JSON.stringify(evaluation),
        );
      this.db
        .prepare("UPDATE competitions SET status = ?, updated_at = ?, record_json = ? WHERE id = ?")
        .run(updated.status, updated.updatedAt, JSON.stringify(updated), updated.id);
    });
    return updated;
  }

  getCompetitionByCandidateTaskId(taskId: string): string | undefined {
    const row = this.db
      .prepare("SELECT competition_id FROM competition_candidates WHERE task_id = ?")
      .get(taskId) as { competition_id: string } | undefined;
    return row?.competition_id;
  }

  updateCompetition(
    competitionId: string,
    patch: {
      status?: CompetitionStatus;
      finishedAt?: string;
      latestEvaluationId?: string;
      error?: string | null;
      mainDecision?: import("../core/types.js").CompetitionMainDecision;
      retainedPartial?: import("../core/types.js").CompetitionRetainedPartial[];
    },
  ): CompetitionRecord {
    let updated!: CompetitionRecord;
    this.transact(() => {
      const current = this.getCompetition(competitionId);
      updated = {
        ...current,
        ...(patch.status === undefined ? {} : { status: patch.status }),
        updatedAt: now(),
        ...(patch.finishedAt === undefined ? {} : { finishedAt: patch.finishedAt }),
        ...(patch.latestEvaluationId === undefined ? {} : { latestEvaluationId: patch.latestEvaluationId }),
        ...(patch.mainDecision === undefined ? {} : { mainDecision: patch.mainDecision }),
        ...(patch.retainedPartial === undefined ? {} : { retainedPartial: patch.retainedPartial }),
      };
      if ("error" in patch) {
        if (patch.error === null) {
          const { error: _, ...withoutError } = updated;
          updated = withoutError;
        } else if (patch.error !== undefined) {
          updated = { ...updated, error: patch.error };
        }
      }
      this.db
        .prepare("UPDATE competitions SET status = ?, updated_at = ?, record_json = ? WHERE id = ?")
        .run(updated.status, updated.updatedAt, JSON.stringify(updated), competitionId);
    });
    return updated;
  }

  listCompetitionEvaluations(competitionId: string): CompetitionEvaluationRecord[] {
    const rows = this.db
      .prepare(
        "SELECT record_json FROM competition_evaluations WHERE competition_id = ? ORDER BY created_at, id",
      )
      .all(competitionId) as unknown as Array<{ record_json: string }>;
    return rows.map((row) =>
      parseRecord<CompetitionEvaluationRecord>(row.record_json, "competition evaluation"),
    );
  }

  saveSettings(settings: Record<string, unknown>): void {
    const json = JSON.stringify(settings);
    this.transact(() => {
      this.db
        .prepare("INSERT OR REPLACE INTO settings (id, record_json, updated_at) VALUES (1, ?, ?)")
        .run(json, now());
    });
  }

  getSettings(): Record<string, unknown> | undefined {
    const row = this.db.prepare("SELECT record_json FROM settings WHERE id = 1").get() as
      | { record_json: string }
      | undefined;
    return row ? JSON.parse(row.record_json) as Record<string, unknown> : undefined;
  }

  resetSettings(): void {
    this.db.prepare("DELETE FROM settings WHERE id = 1").run();
  }

  saveProbeEvidence(evidence: ProbeEvidence): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO provider_probes (provider, record_json, updated_at) VALUES (?, ?, ?)",
      )
      .run(evidence.provider, JSON.stringify(evidence), now());
  }

  getProbeEvidence(provider: string): ProbeEvidence | undefined {
    const row = this.db
      .prepare("SELECT record_json FROM provider_probes WHERE provider = ?")
      .get(provider) as { record_json: string } | undefined;
    if (!row) return undefined;
    return parseRecord<ProbeEvidence>(row.record_json, "probe evidence");
  }

  saveIntegrationReceipt(receipt: IntegrationReceiptRecord): void {
    this.db
      .prepare(
        `INSERT INTO integration_receipts (id, task_id, consumed, record_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        receipt.id,
        receipt.taskId,
        receipt.consumed ? 1 : 0,
        JSON.stringify(receipt),
        receipt.createdAt,
      );
  }

  getIntegrationReceipt(
    receiptId: string,
  ): (IntegrationReceiptRecord & { consumed: boolean }) | undefined {
    const row = this.db
      .prepare(
        "SELECT consumed, record_json FROM integration_receipts WHERE id = ?",
      )
      .get(receiptId) as
      | { consumed: number; record_json: string }
      | undefined;
    if (!row) return undefined;
    const record = parseRecord<IntegrationReceiptRecord>(
      row.record_json,
      "integration receipt",
    );
    return { ...record, consumed: row.consumed === 1 };
  }

  consumeIntegrationReceipt(receiptId: string): IntegrationReceiptRecord {
    let receipt: IntegrationReceiptRecord;
    this.transact(() => {
      const row = this.db
        .prepare("SELECT consumed, record_json FROM integration_receipts WHERE id = ?")
        .get(receiptId) as
        | { consumed: number; record_json: string }
        | undefined;
      if (!row) throw new Error(`Unknown integration receipt: ${receiptId}`);
      if (row.consumed !== 0) {
        throw new Error(`Receipt already consumed: ${receiptId}`);
      }
      receipt = parseRecord<IntegrationReceiptRecord>(
        row.record_json,
        "integration receipt",
      );
      this.db
        .prepare("UPDATE integration_receipts SET consumed = 1 WHERE id = ?")
        .run(receiptId);
    });
    return receipt!;
  }

  saveIntegrationResult(result: IntegrationResultRecord): void {
    this.db
      .prepare(
        `INSERT INTO integration_results (id, receipt_id, task_id, status, record_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        result.id,
        result.receiptId,
        result.taskId,
        result.status,
        JSON.stringify(result),
        result.createdAt,
      );
  }

  getIntegrationResult(resultId: string): IntegrationResultRecord | undefined {
    const row = this.db
      .prepare("SELECT record_json FROM integration_results WHERE id = ?")
      .get(resultId) as { record_json: string } | undefined;
    return row === undefined
      ? undefined
      : parseRecord<IntegrationResultRecord>(row.record_json, "integration result");
  }

  listIntegrationResults(taskId: string): IntegrationResultRecord[] {
    const rows = this.db
      .prepare(
        "SELECT record_json FROM integration_results WHERE task_id = ? ORDER BY created_at DESC",
      )
      .all(taskId) as unknown as Array<{ record_json: string }>;
    return rows.map((row) =>
      parseRecord<IntegrationResultRecord>(row.record_json, "integration result"),
    );
  }

  /** Insert or replace the durable checkpoint operation identity record. */
  saveCheckpointOperation(record: CheckpointOperationRecord): void {
    if (!isCheckpointOperationRecord(record)) {
      throw new Error(CHECKPOINT_OPERATION_CORRUPTION_ERROR);
    }
    this.db
      .prepare(
        `INSERT INTO checkpoint_operations (id, task_id, attempt_id, record_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           task_id = excluded.task_id,
           attempt_id = excluded.attempt_id,
           record_json = excluded.record_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        record.operationId,
        record.taskId,
        record.attemptId,
        JSON.stringify(record),
        record.createdAt,
        record.updatedAt,
      );
  }

  getCheckpointOperation(operationId: string): CheckpointOperationRecord | undefined {
    const row = this.db
      .prepare("SELECT record_json FROM checkpoint_operations WHERE id = ?")
      .get(operationId) as { record_json: string } | undefined;
    return row === undefined
      ? undefined
      : parseCheckpointOperationRecord(row.record_json);
  }

  /**
   * Bounded newest-first window of durable Integration results across all Tasks.
   * Deterministic order: created_at DESC, id DESC. Read-only.
   */
  listRecentIntegrationResults(limit: number): IntegrationResultRecord[] {
    const safeLimit = Number.isSafeInteger(limit) && limit > 0
      ? Math.min(limit, 100)
      : 40;
    const rows = this.db
      .prepare(
        `SELECT record_json FROM integration_results
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(safeLimit) as unknown as Array<{ record_json: string }>;
    return rows.map((row) =>
      parseRecord<IntegrationResultRecord>(row.record_json, "integration result"),
    );
  }

  /**
   * Bounded newest-first Integration results whose durable receipt explicitly
   * names the fixed forklight-self-upgrade delivery profile. Scope is applied
   * before LIMIT so ordinary project Integrations cannot hide valid history.
   * Missing, legacy, malformed, lookalike, or foreign delivery identity is
   * ignored (not counted, not a break). Deterministic: created_at DESC, id DESC.
   * Read-only; never rewrites results or inspects command text / paths.
   */
  listRecentSelfUpgradeIntegrationResults(limit: number): IntegrationResultRecord[] {
    const safeLimit = Number.isSafeInteger(limit) && limit > 0
      ? Math.min(limit, 100)
      : 40;
    const rows = this.db
      .prepare(
        `SELECT r.record_json AS record_json
         FROM integration_results r
         INNER JOIN integration_receipts ir ON ir.id = r.receipt_id
         WHERE json_extract(ir.record_json, '$.deliveryPlan.profileId') = ?
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT ?`,
      )
      .all(SELF_UPGRADE_DELIVERY_PROFILE_ID, safeLimit) as unknown as Array<{
        record_json: string;
      }>;
    return rows.map((row) =>
      parseRecord<IntegrationResultRecord>(row.record_json, "integration result"),
    );
  }

  saveExchangeReceipt(input: unknown): void {
    const receipt = normalizeOrchestrationExchangeReceipt(input);
    this.db
      .prepare(
        `INSERT INTO orchestration_exchange_receipts (id, task_id, captured_at, record_json)
         VALUES (?, ?, ?, ?)`,
      )
      .run(receipt.id, receipt.taskId, receipt.capturedAt, JSON.stringify(receipt));
  }

  listExchangeReceipts(taskId: string): OrchestrationExchangeReceipt[] {
    const rows = this.db
      .prepare(
        `SELECT id, task_id, captured_at, record_json
         FROM orchestration_exchange_receipts
         WHERE task_id = ? ORDER BY captured_at, id`,
      )
      .all(taskId) as unknown as Array<{
      id: string; task_id: string; captured_at: string; record_json: string;
    }>;
    return rows.map((row) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.record_json);
      } catch {
        throw new Error("Corrupt receipt record in state database");
      }
      const receipt = normalizeOrchestrationExchangeReceipt(parsed);
      // Verify task attribution against requested task first
      if (receipt.taskId !== taskId) {
        throw new Error("Receipt task mismatch in state database");
      }
      // Cross-check stored columns against the normalized canonical receipt
      if (receipt.id !== row.id || receipt.taskId !== row.task_id || receipt.capturedAt !== row.captured_at) {
        throw new Error("Corrupt receipt record in state database");
      }
      return receipt;
    });
  }

  saveDirectCodexCalibration(input: unknown): void {
    const record = normalizeDirectCodexCalibrationRecord(input);
    const id = `${record.taskClass}:v${record.version}`;
    this.db
      .prepare(
        `INSERT INTO direct_codex_calibrations (id, task_class, version, created_at, record_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, record.taskClass, record.version, record.createdAt, JSON.stringify(record));
  }

  listDirectCodexCalibrations(taskClass?: string): DirectCodexCalibrationRecord[] {
    const rows = taskClass === undefined
      ? (this.db
          .prepare(
            `SELECT id, task_class, version, created_at, record_json FROM direct_codex_calibrations
             ORDER BY task_class, version`,
          )
          .all() as unknown as CalibrationRow[])
      : (this.db
          .prepare(
            `SELECT id, task_class, version, created_at, record_json FROM direct_codex_calibrations
             WHERE task_class = ? ORDER BY version`,
          )
          .all(taskClass) as unknown as CalibrationRow[]);
    return rows.map((row) => parseCalibrationRow(row, taskClass));
  }

  latestDirectCodexCalibration(taskClass: string): DirectCodexCalibrationRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, task_class, version, created_at, record_json FROM direct_codex_calibrations
         WHERE task_class = ? ORDER BY version DESC LIMIT 1`,
      )
      .get(taskClass) as CalibrationRow | undefined;
    if (!row) return undefined;
    return parseCalibrationRow(row, taskClass);
  }

  // --- Direct-Codex profile publication registry ---

  private static parseProfilePublicationRow(
    row: { task_class: string; profile_id: string; version: number; created_at: string; record_json: string },
    expectedTaskClass: string,
    expectedProfileId: string,
  ): DirectCodexProfilePublication {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.record_json);
    } catch {
      throw new Error("Corrupt profile publication record in state database");
    }
    const publication = normalizeDirectCodexProfilePublication(parsed);
    // Cross-check identity columns against canonical normalized JSON
    if (
      publication.directCodexProfileId !== expectedProfileId ||
      publication.calibration.taskClass !== expectedTaskClass ||
      row.task_class !== publication.calibration.taskClass ||
      row.profile_id !== publication.directCodexProfileId ||
      row.version !== publication.calibration.version ||
      row.created_at !== publication.calibration.createdAt
    ) {
      throw new Error("Corrupt profile publication record in state database");
    }
    return publication;
  }

  saveDirectCodexProfilePublication(input: unknown): void {
    const publication = normalizeDirectCodexProfilePublication(input);
    this.db
      .prepare(
        `INSERT INTO direct_codex_profile_publications (task_class, profile_id, version, created_at, record_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        publication.calibration.taskClass,
        publication.directCodexProfileId,
        publication.calibration.version,
        publication.calibration.createdAt,
        JSON.stringify(publication),
      );
  }

  listDirectCodexProfilePublications(
    taskClass: string,
    profileId: string,
  ): DirectCodexProfilePublication[] {
    const exactTaskClass = normalizeProfileQueryTaskClass(taskClass);
    const exactProfileId = normalizeDirectCodexProfileId(profileId);
    const rows = this.db
      .prepare(
        `SELECT task_class, profile_id, version, created_at, record_json
         FROM direct_codex_profile_publications
         WHERE task_class = ? AND profile_id = ?
         ORDER BY version`,
      )
      .all(exactTaskClass, exactProfileId) as unknown as Array<{
        task_class: string; profile_id: string; version: number; created_at: string; record_json: string;
      }>;
    return rows.map((row) =>
      StateStore.parseProfilePublicationRow(row, exactTaskClass, exactProfileId),
    );
  }

  latestDirectCodexProfilePublication(
    taskClass: string,
    profileId: string,
  ): DirectCodexProfilePublication | undefined {
    const exactTaskClass = normalizeProfileQueryTaskClass(taskClass);
    const exactProfileId = normalizeDirectCodexProfileId(profileId);
    const row = this.db
      .prepare(
        `SELECT task_class, profile_id, version, created_at, record_json
         FROM direct_codex_profile_publications
         WHERE task_class = ? AND profile_id = ?
         ORDER BY version DESC LIMIT 1`,
      )
      .get(exactTaskClass, exactProfileId) as {
        task_class: string; profile_id: string; version: number; created_at: string; record_json: string;
      } | undefined;
    if (!row) return undefined;
    return StateStore.parseProfilePublicationRow(row, exactTaskClass, exactProfileId);
  }

  // --- Direct-Codex paired-sample evidence registry ---

  private static parsePairedSampleRow(
    row: { sample_id: string; forklight_task_id: string; task_class: string; profile_id: string;
      direct_run_ref: string; pairing_ref: string; captured_at: string; record_json: string },
    expectedTaskClass: string,
    expectedProfileId: string,
  ): DirectCodexPairedSample {
    let parsed: unknown;
    try { parsed = JSON.parse(row.record_json); }
    catch { throw new Error("Corrupt paired-sample record in state database"); }
    let sample: DirectCodexPairedSample;
    try { sample = normalizeDirectCodexPairedSample(parsed); }
    catch { throw new Error("Corrupt paired-sample record in state database"); }
    if (
      sample.sampleId !== row.sample_id ||
      sample.forklightTaskId !== row.forklight_task_id ||
      sample.exactTaskClass !== row.task_class ||
      sample.directCodexProfileId !== row.profile_id ||
      sample.directRunRef !== row.direct_run_ref ||
      sample.pairingRef !== row.pairing_ref ||
      sample.capturedAt !== row.captured_at ||
      sample.exactTaskClass !== expectedTaskClass ||
      sample.directCodexProfileId !== expectedProfileId
    ) {
      throw new Error("Corrupt paired-sample record in state database");
    }
    return sample;
  }

  private static parseReviewRow(
    row: { sample_id: string; decision: string; rejection_reason: string | null;
      reviewer: string; reviewed_at: string; record_json: string },
  ): DirectCodexSampleReview {
    let parsed: unknown;
    try { parsed = JSON.parse(row.record_json); }
    catch { throw new Error("Corrupt review-decision record in state database"); }
    let review: DirectCodexSampleReview;
    try { review = normalizeDirectCodexSampleReview(parsed); }
    catch { throw new Error("Corrupt review-decision record in state database"); }
    if (
      review.sampleId !== row.sample_id ||
      review.decision !== row.decision ||
      (review.rejectionReason ?? null) !== row.rejection_reason ||
      review.reviewer !== row.reviewer ||
      review.reviewedAt !== row.reviewed_at
    ) {
      throw new Error("Corrupt review-decision record in state database");
    }
    return review;
  }

  private verifySampleTaskIdentity(sample: DirectCodexPairedSample): void {
    let task: TaskRecord;
    try { task = this.getTask(sample.forklightTaskId); }
    catch { throw new Error("Corrupt paired-sample record in state database"); }
    if (!task.spec.taskClass || task.spec.taskClass !== sample.exactTaskClass ||
        !task.spec.directCodexProfileId || task.spec.directCodexProfileId !== sample.directCodexProfileId) {
      throw new Error("Corrupt paired-sample record in state database");
    }
  }

  private static validateSampleId(id: unknown): string {
    if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) {
      throw new TypeError("Invalid sampleId");
    }
    return id;
  }

  saveDirectCodexPairedSample(input: unknown): void {
    const sample = normalizeDirectCodexPairedSample(input);
    let task: TaskRecord;
    try { task = this.getTask(sample.forklightTaskId); }
    catch { throw new Error("Sample references unknown Task"); }
    if (!task.spec.taskClass || task.spec.taskClass !== sample.exactTaskClass) {
      throw new Error("Sample taskClass does not match declared Task identity");
    }
    if (!task.spec.directCodexProfileId || task.spec.directCodexProfileId !== sample.directCodexProfileId) {
      throw new Error("Sample directCodexProfileId does not match declared Task identity");
    }
    this.db
      .prepare(
        `INSERT INTO direct_codex_paired_samples (sample_id, forklight_task_id, task_class, profile_id, direct_run_ref, pairing_ref, captured_at, record_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(sample.sampleId, sample.forklightTaskId, sample.exactTaskClass,
        sample.directCodexProfileId, sample.directRunRef, sample.pairingRef,
        sample.capturedAt, JSON.stringify(sample));
  }

  getDirectCodexPairedSample(sampleId: string): DirectCodexPairedSample {
    StateStore.validateSampleId(sampleId);
    const row = this.db
      .prepare(
        `SELECT sample_id, forklight_task_id, task_class, profile_id, direct_run_ref, pairing_ref, captured_at, record_json
         FROM direct_codex_paired_samples WHERE sample_id = ?`,
      )
      .get(sampleId) as {
        sample_id: string; forklight_task_id: string; task_class: string; profile_id: string;
        direct_run_ref: string; pairing_ref: string; captured_at: string; record_json: string;
      } | undefined;
    if (!row) throw new Error("Unknown paired sample");
    const sample = StateStore.parsePairedSampleRow(row, row.task_class, row.profile_id);
    this.verifySampleTaskIdentity(sample);
    return sample;
  }

  listDirectCodexPairedSamples(taskClass: unknown, profileId: unknown): DirectCodexPairedSample[] {
    const exactTaskClass = normalizeProfileQueryTaskClass(taskClass);
    const exactProfileId = normalizeDirectCodexProfileId(profileId);
    const rows = this.db
      .prepare(
        `SELECT sample_id, forklight_task_id, task_class, profile_id, direct_run_ref, pairing_ref, captured_at, record_json
         FROM direct_codex_paired_samples
         WHERE task_class = ? AND profile_id = ?
         ORDER BY captured_at, sample_id`,
      )
      .all(exactTaskClass, exactProfileId) as unknown as Array<{
        sample_id: string; forklight_task_id: string; task_class: string; profile_id: string;
        direct_run_ref: string; pairing_ref: string; captured_at: string; record_json: string;
      }>;
    return rows.map((row) => {
      const s = StateStore.parsePairedSampleRow(row, exactTaskClass, exactProfileId);
      this.verifySampleTaskIdentity(s);
      return s;
    });
  }

  // --- Direct-Codex review-decision registry ---

  saveDirectCodexSampleReview(input: unknown): void {
    const review = normalizeDirectCodexSampleReview(input);
    // Validate sample through full read path — corrupt/identity-ineligible propagate
    try { this.getDirectCodexPairedSample(review.sampleId); }
    catch (e) {
      if (e instanceof Error && e.message === "Unknown paired sample") {
        throw new Error("Unknown paired sample for review");
      }
      throw e;
    }
    this.db
      .prepare(
        `INSERT INTO direct_codex_review_decisions (sample_id, decision, rejection_reason, reviewer, reviewed_at, record_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(review.sampleId, review.decision, review.rejectionReason ?? null,
        review.reviewer, review.reviewedAt, JSON.stringify(review));
  }

  /** Throwing review getter — delegates to the optional getter for its
   *  one canonical SQL, parse, and identity-validation path, and throws
   *  when no review row exists.  Corruption and identity mismatch fail
   *  closed identically to the optional path. */
  getDirectCodexSampleReview(sampleId: string): DirectCodexSampleReview {
    const review = this.getDirectCodexSampleReviewOptional(sampleId);
    if (review === undefined) {
      throw new Error("No review decision for sample");
    }
    return review;
  }

  /** Optional bounded review lookup: returns `undefined` only when no
   *  decision row exists.  When a row is present the review is re-normalized
   *  and the referenced sample/Task identity chain is revalidated — corrupt
   *  or identity-ineligible evidence fails closed with a non-echoing error
   *  just like {@link getDirectCodexSampleReview}. */
  getDirectCodexSampleReviewOptional(sampleId: string): DirectCodexSampleReview | undefined {
    StateStore.validateSampleId(sampleId);
    const row = this.db
      .prepare(
        `SELECT sample_id, decision, rejection_reason, reviewer, reviewed_at, record_json
         FROM direct_codex_review_decisions WHERE sample_id = ?`,
      )
      .get(sampleId) as {
        sample_id: string; decision: string; rejection_reason: string | null;
        reviewer: string; reviewed_at: string; record_json: string;
      } | undefined;
    if (!row) return undefined;
    const review = StateStore.parseReviewRow(row);
    // Revalidate the referenced sample/Task identity chain
    this.getDirectCodexPairedSample(review.sampleId);
    return review;
  }

  listPendingDirectCodexPairedSamples(
    taskClass: string, profileId: string,
  ): DirectCodexPairedSample[] {
    const exactTaskClass = normalizeProfileQueryTaskClass(taskClass);
    const exactProfileId = normalizeDirectCodexProfileId(profileId);
    // Validate all reviews for this pair fail-closed before excluding
    const reviewRows = this.db
      .prepare(
        `SELECT r.sample_id, r.decision, r.rejection_reason, r.reviewer, r.reviewed_at, r.record_json
         FROM direct_codex_review_decisions r
         JOIN direct_codex_paired_samples s ON s.sample_id = r.sample_id
         WHERE s.task_class = ? AND s.profile_id = ?`,
      )
      .all(exactTaskClass, exactProfileId) as unknown as Array<{
        sample_id: string; decision: string; rejection_reason: string | null;
        reviewer: string; reviewed_at: string; record_json: string;
      }>;
    const reviewedIds = new Set<string>();
    for (const rr of reviewRows) {
      StateStore.parseReviewRow(rr);
      reviewedIds.add(rr.sample_id);
    }
    const rows = this.db
      .prepare(
        `SELECT sample_id, forklight_task_id, task_class, profile_id, direct_run_ref, pairing_ref, captured_at, record_json
         FROM direct_codex_paired_samples
         WHERE task_class = ? AND profile_id = ?
         ORDER BY captured_at, sample_id`,
      )
      .all(exactTaskClass, exactProfileId) as unknown as Array<{
        sample_id: string; forklight_task_id: string; task_class: string; profile_id: string;
        direct_run_ref: string; pairing_ref: string; captured_at: string; record_json: string;
      }>;
    return rows
      .map((row) => {
        const s = StateStore.parsePairedSampleRow(row, exactTaskClass, exactProfileId);
        this.verifySampleTaskIdentity(s);
        return s;
      })
      .filter((s) => !reviewedIds.has(s.sampleId));
  }

  // --- Bounded policy adaptation lineage ---

  private insertAdaptationLineage(record: AdaptationTransitionRecord): void {
    this.db
      .prepare(
        `INSERT INTO adaptation_lineage
         (id, root_task_id, parent_task_id, child_task_id, round, reason, proposed_reason, record_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.rootTaskId,
        record.parentTaskId,
        record.childTaskId,
        record.round,
        record.reason,
        record.proposedReason,
        JSON.stringify(record),
        record.createdAt,
      );
  }

  /** Atomically persist a bounded adaptation transition edge plus the
   *  successor TaskRecord and supporting events. Either every row commits
   *  or none do — UNIQUE(parent_task_id) and UNIQUE(child_task_id) reject
   *  duplicate apply requests so recovery never produces a second successor. */
  createAdaptationTransition(params: {
    record: AdaptationTransitionRecord;
    task: TaskRecord;
    creationEvent?: { summary: string; payload?: Record<string, unknown> };
    transitionEvent: { summary: string; payload?: Record<string, unknown> };
  }): void {
    this.transact(() => {
      this.insertTask(params.task);
      if (params.creationEvent !== undefined) {
        this.insertEvent(
          params.task.id,
          undefined,
          "task.created",
          params.creationEvent.summary,
          params.creationEvent.payload,
        );
      }
      this.insertAdaptationLineage(params.record);
      this.insertEvent(
        params.task.id,
        undefined,
        "task.adaptation.transitioned",
        params.transitionEvent.summary,
        {
          ...(params.transitionEvent.payload ?? {}),
          lineageId: params.record.id,
        },
      );
    });
  }

  /** Append-only adaptation rejection event (no lineage row, no Task). */
  recordAdaptationRejection(taskId: string, summary: string, payload: unknown): EventRecord {
    return this.insertEvent(taskId, undefined, "task.adaptation.rejected", summary, payload);
  }

  getAdaptationLineageEdgeForParent(parentTaskId: string): AdaptationTransitionRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT record_json FROM adaptation_lineage WHERE parent_task_id = ?`,
      )
      .get(parentTaskId) as { record_json: string } | undefined;
    if (row === undefined) return undefined;
    return parseRecord<AdaptationTransitionRecord>(row.record_json, "adaptation lineage edge");
  }

  getAdaptationLineageEdgeForChild(childTaskId: string): AdaptationTransitionRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT record_json FROM adaptation_lineage WHERE child_task_id = ?`,
      )
      .get(childTaskId) as { record_json: string } | undefined;
    if (row === undefined) return undefined;
    return parseRecord<AdaptationTransitionRecord>(row.record_json, "adaptation lineage edge");
  }

  listAdaptationLineageForRoot(rootTaskId: string): AdaptationTransitionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT record_json FROM adaptation_lineage
         WHERE root_task_id = ?
         ORDER BY round, created_at, id`,
      )
      .all(rootTaskId) as unknown as Array<{ record_json: string }>;
    return rows.map((row) =>
      parseRecord<AdaptationTransitionRecord>(row.record_json, "adaptation lineage edge"),
    );
  }

  // --- Cross-Worker Candidate handoff lineage ---

  private insertCandidateHandoff(record: CandidateHandoffRecord): void {
    // competition_id indexes Competition origin only; Goal-Task stores empty
    // so we never fabricate a Competition id.
    const competitionKey =
      record.origin.kind === "competition" ? record.origin.competitionId : "";
    this.db
      .prepare(
        `INSERT INTO candidate_handoffs
         (id, source_revision_id, source_task_id, successor_task_id, competition_id,
          status, record_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.sourceCandidateRevisionId,
        record.sourceTaskId,
        record.successorTaskId,
        competitionKey,
        record.status,
        JSON.stringify(record),
        record.createdAt,
        record.updatedAt,
      );
  }

  /** Atomically persist one handoff authorization + successor Task.
   *  UNIQUE(source_revision_id) and UNIQUE(successor_task_id) reject duplicates. */
  createCandidateHandoff(params: {
    record: CandidateHandoffRecord;
    task: TaskRecord;
    creationEvent?: { summary: string; payload?: Record<string, unknown> };
    authorizationEvent: { summary: string; payload?: Record<string, unknown> };
  }): void {
    this.transact(() => {
      this.insertTask(params.task);
      if (params.creationEvent !== undefined) {
        this.insertEvent(
          params.task.id,
          undefined,
          "task.created",
          params.creationEvent.summary,
          params.creationEvent.payload,
        );
      }
      this.insertCandidateHandoff(params.record);
      // Authorization evidence on the source Task (source status stays immutable).
      this.insertEvent(
        params.record.sourceTaskId,
        undefined,
        "candidate.handoff.authorized",
        params.authorizationEvent.summary,
        {
          ...(params.authorizationEvent.payload ?? {}),
          handoffId: params.record.id,
          successorTaskId: params.record.successorTaskId,
        },
      );
      // Mirror on the successor for Task Detail journey projection.
      this.insertEvent(
        params.task.id,
        undefined,
        "candidate.handoff.authorized",
        params.authorizationEvent.summary,
        {
          ...(params.authorizationEvent.payload ?? {}),
          handoffId: params.record.id,
          successorTaskId: params.record.successorTaskId,
          isSuccessor: true,
        },
      );
    });
  }

  updateCandidateHandoff(record: CandidateHandoffRecord): CandidateHandoffRecord {
    const result = this.db
      .prepare(
        `UPDATE candidate_handoffs
         SET status = ?, record_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(record.status, JSON.stringify(record), record.updatedAt, record.id);
    if (result.changes !== 1) {
      throw new Error(`Candidate handoff ${record.id} was not found`);
    }
    return record;
  }

  getCandidateHandoff(id: string): CandidateHandoffRecord {
    const row = this.db
      .prepare(`SELECT record_json FROM candidate_handoffs WHERE id = ?`)
      .get(id) as { record_json: string } | undefined;
    if (row === undefined) throw new Error(`Candidate handoff ${id} was not found`);
    return parseRecord<CandidateHandoffRecord>(row.record_json, "candidate handoff");
  }

  getCandidateHandoffBySourceRevisionId(
    sourceRevisionId: string,
  ): CandidateHandoffRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT record_json FROM candidate_handoffs WHERE source_revision_id = ?`,
      )
      .get(sourceRevisionId) as { record_json: string } | undefined;
    if (row === undefined) return undefined;
    return parseRecord<CandidateHandoffRecord>(row.record_json, "candidate handoff");
  }

  getCandidateHandoffBySuccessorTaskId(
    successorTaskId: string,
  ): CandidateHandoffRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT record_json FROM candidate_handoffs WHERE successor_task_id = ?`,
      )
      .get(successorTaskId) as { record_json: string } | undefined;
    if (row === undefined) return undefined;
    return parseRecord<CandidateHandoffRecord>(row.record_json, "candidate handoff");
  }

  listCandidateHandoffsBySourceTaskId(sourceTaskId: string): CandidateHandoffRecord[] {
    const rows = this.db
      .prepare(
        `SELECT record_json FROM candidate_handoffs
         WHERE source_task_id = ?
         ORDER BY created_at, id`,
      )
      .all(sourceTaskId) as unknown as Array<{ record_json: string }>;
    return rows.map((row) =>
      parseRecord<CandidateHandoffRecord>(row.record_json, "candidate handoff"),
    );
  }

  listCandidateHandoffsByCompetitionId(competitionId: string): CandidateHandoffRecord[] {
    const rows = this.db
      .prepare(
        `SELECT record_json FROM candidate_handoffs
         WHERE competition_id = ?
         ORDER BY created_at, id`,
      )
      .all(competitionId) as unknown as Array<{ record_json: string }>;
    return rows.map((row) =>
      parseRecord<CandidateHandoffRecord>(row.record_json, "candidate handoff"),
    );
  }

  listCandidateHandoffs(): CandidateHandoffRecord[] {
    const rows = this.db
      .prepare(
        `SELECT record_json FROM candidate_handoffs
         ORDER BY created_at, id`,
      )
      .all() as unknown as Array<{ record_json: string }>;
    return rows.map((row) =>
      parseRecord<CandidateHandoffRecord>(row.record_json, "candidate handoff"),
    );
  }

  // --- Main remediation checks ---

  saveRemediationCheck(record: RemediationCheckRecord): void {
    const commandsJson = JSON.stringify(record.commands);
    const recordJson = JSON.stringify(record);
    this.db
      .prepare(
        `INSERT INTO remediation_checks (id, task_id, status, commands_json, record_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.taskId,
        record.status,
        commandsJson,
        recordJson,
        record.createdAt,
      );
  }

  /** Persist a completed check and its optional passing disposition atomically. */
  saveRemediationOutcome(
    record: RemediationCheckRecord,
    disposition?: RemediationDisposition,
  ): void {
    if (disposition !== undefined) {
      if (
        record.status !== "passed"
        || disposition.status !== "verified-repaired-delivered"
        || disposition.checkId !== record.id
        || disposition.createdAt !== record.createdAt
      ) {
        throw new Error("Invalid remediation outcome");
      }
      if (disposition.acceptanceBasis === "amended-acceptance") {
        if (
          record.amendment === undefined
          || typeof disposition.amendedCommandCount !== "number"
          || !Number.isSafeInteger(disposition.amendedCommandCount)
          || disposition.amendedCommandCount < 1
          || disposition.reasonCode !== "contradictory-acceptance"
          || disposition.amendedCommandCount !== record.amendment.replacements.length
          || record.amendment.amendedCommands.length !== record.commands.length
        ) {
          throw new Error("Invalid amended-acceptance remediation outcome");
        }
      }
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.saveRemediationCheck(record);
      if (disposition !== undefined) {
        this.saveRemediationDisposition(record.taskId, disposition);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getRemediationChecks(taskId: string): RemediationCheckRecord[] {
    const rows = this.db
      .prepare(
        `SELECT record_json FROM remediation_checks
         WHERE task_id = ? ORDER BY created_at, id`,
      )
      .all(taskId) as unknown as Array<{ record_json: string }>;
    return rows.map((row) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.record_json);
      } catch {
        throw new Error("Corrupt remediation check record in state database");
      }
      const record = parsed as Partial<RemediationCheckRecord>;
      if (
        typeof record.id !== "string"
        || record.id.length === 0
        || record.taskId !== taskId
        || (record.status !== "failed" && record.status !== "passed")
        || typeof record.createdAt !== "string"
        || (record.reason !== undefined
          && (typeof record.reason !== "string" || record.reason.length === 0))
        || !Array.isArray(record.commands)
      ) {
        throw new Error("Corrupt remediation check record in state database");
      }
      // Optional private amendment evidence: deep-validate shape when present.
      if (record.amendment !== undefined) {
        const amendment = record.amendment as Partial<
          NonNullable<RemediationCheckRecord["amendment"]>
        >;
        if (
          amendment === null
          || typeof amendment !== "object"
          || !Number.isSafeInteger(amendment.verificationEventSequence)
          || (amendment.verificationEventSequence as number) < 1
          || amendment.reasonCode !== "contradictory-acceptance"
          || !Array.isArray(amendment.replacements)
          || amendment.replacements.length < 1
          || !Array.isArray(amendment.amendedCommands)
          || amendment.amendedCommands.length < 1
          || amendment.amendedCommands.length !== record.commands.length
          || amendment.replacements.length > amendment.amendedCommands.length
        ) {
          throw new Error("Corrupt remediation check record in state database");
        }
        for (const entry of amendment.replacements) {
          if (
            entry === null
            || typeof entry !== "object"
            || typeof (entry as { originalCommand?: unknown }).originalCommand !== "string"
            || typeof (entry as { replacementCommand?: unknown }).replacementCommand !== "string"
            || ((entry as { originalCommand: string }).originalCommand.trim().length < 1)
            || ((entry as { replacementCommand: string }).replacementCommand.trim().length < 1)
            || (entry as { originalCommand: string }).originalCommand.length > 4000
            || (entry as { replacementCommand: string }).replacementCommand.length > 4000
            || (entry as { originalCommand: string }).originalCommand
              === (entry as { replacementCommand: string }).replacementCommand
          ) {
            throw new Error("Corrupt remediation check record in state database");
          }
        }
        for (const command of amendment.amendedCommands) {
          if (
            typeof command !== "string"
            || command.trim().length < 1
            || command.length > 4000
          ) {
            throw new Error("Corrupt remediation check record in state database");
          }
        }
      }
      return record as RemediationCheckRecord;
    });
  }

  saveRemediationDisposition(taskId: string, disposition: RemediationDisposition): void {
    const json = JSON.stringify(disposition);
    this.db
      .prepare(
        `INSERT INTO remediation_dispositions (task_id, disposition_json, created_at)
         VALUES (?, ?, ?)`,
      )
      .run(taskId, json, disposition.createdAt);
  }

  getRemediationDisposition(taskId: string): RemediationDisposition | undefined {
    const row = this.db
      .prepare(
        `SELECT disposition_json FROM remediation_dispositions WHERE task_id = ?`,
      )
      .get(taskId) as { disposition_json: string } | undefined;
    if (row === undefined) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.disposition_json);
    } catch {
      throw new Error("Corrupt remediation disposition record in state database");
    }
    const disposition = parsed as Partial<RemediationDisposition>;
    if (
      disposition.status !== "verified-repaired-delivered"
      || typeof disposition.checkId !== "string"
      || typeof disposition.createdAt !== "string"
    ) {
      throw new Error("Corrupt remediation disposition record in state database");
    }
    // Optional fields for amended-acceptance; legacy records omit them.
    if (disposition.acceptanceBasis !== undefined) {
      if (
        disposition.acceptanceBasis !== "original-acceptance"
        && disposition.acceptanceBasis !== "amended-acceptance"
      ) {
        throw new Error("Corrupt remediation disposition record in state database");
      }
    }
    if (disposition.acceptanceBasis === "amended-acceptance") {
      if (
        typeof disposition.amendedCommandCount !== "number"
        || !Number.isSafeInteger(disposition.amendedCommandCount)
        || disposition.amendedCommandCount < 1
        || disposition.reasonCode !== "contradictory-acceptance"
      ) {
        throw new Error("Corrupt remediation disposition record in state database");
      }
    }
    return disposition as RemediationDisposition;
  }

  // --- Exact-revision Review Graph ---

  /** Atomically persist a Review Graph, all assignments, linked read-only
   *  reviewer Tasks, and candidate/reviewer audit events before any queueing. */
  createReviewGraphExecution(params: {
    graph: ReviewGraphRecord;
    assignments: ReviewAssignmentRecord[];
    reviewerTasks: TaskRecord[];
    assignmentEvents: Array<{ summary: string; payload?: Record<string, unknown> }>;
    reviewerCreationEvents: Array<{ summary: string; payload?: Record<string, unknown> }>;
  }): void {
    if (params.assignments.length < 1 || params.assignments.length > 3) {
      throw new Error("Review graph must register 1–3 assignments");
    }
    if (
      params.assignments.length !== params.reviewerTasks.length
      || params.assignments.length !== params.assignmentEvents.length
      || params.assignments.length !== params.reviewerCreationEvents.length
    ) {
      throw new Error("Review graph assignment/task/event counts must match");
    }
    if (params.graph.assignmentIds.length !== params.assignments.length) {
      throw new Error("Review graph assignmentIds must match assignments");
    }
    for (let index = 0; index < params.assignments.length; index += 1) {
      const assignment = params.assignments[index]!;
      const reviewerTask = params.reviewerTasks[index]!;
      if (assignment.graphId !== params.graph.id) {
        throw new Error("Review assignment must belong to the graph");
      }
      if (assignment.reviewerTaskId !== reviewerTask.id) {
        throw new Error("Review assignment must reference the reviewer Task");
      }
      if (assignment.candidateTaskId !== params.graph.candidateTaskId) {
        throw new Error("Review assignment candidate must match the graph");
      }
      if (params.graph.assignmentIds[index] !== assignment.id) {
        throw new Error("Review graph assignmentIds order must match assignments");
      }
    }
    this.transact(() => {
      this.db
        .prepare(
          `INSERT INTO review_graphs
           (id, candidate_task_id, candidate_revision_id, status, record_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          params.graph.id,
          params.graph.candidateTaskId,
          params.graph.candidateRevisionId,
          params.graph.status,
          JSON.stringify(params.graph),
          params.graph.createdAt,
          params.graph.updatedAt,
        );
      for (let index = 0; index < params.assignments.length; index += 1) {
        const assignment = params.assignments[index]!;
        const reviewerTask = params.reviewerTasks[index]!;
        const reviewerCreationEvent = params.reviewerCreationEvents[index]!;
        const assignmentEvent = params.assignmentEvents[index]!;
        this.insertTask(reviewerTask);
        this.insertEvent(
          reviewerTask.id,
          undefined,
          "task.created",
          reviewerCreationEvent.summary,
          reviewerCreationEvent.payload,
        );
        this.db
          .prepare(
            `INSERT INTO review_assignments
             (id, graph_id, candidate_task_id, candidate_revision_id, reviewer_task_id,
              reviewer_worker_profile_id, ordinal, status, record_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            assignment.id,
            assignment.graphId,
            assignment.candidateTaskId,
            assignment.candidateRevisionId,
            assignment.reviewerTaskId,
            assignment.reviewerWorkerProfileId,
            assignment.ordinal,
            assignment.status,
            JSON.stringify(assignment),
            assignment.createdAt,
            assignment.updatedAt,
          );
        this.insertEvent(
          params.graph.candidateTaskId,
          undefined,
          "review.assignment.created",
          assignmentEvent.summary,
          assignmentEvent.payload,
        );
      }
    });
  }

  getReviewGraph(graphId: string): ReviewGraphRecord {
    const row = this.db
      .prepare("SELECT record_json FROM review_graphs WHERE id = ?")
      .get(graphId) as { record_json: string } | undefined;
    if (!row) throw new Error(`Unknown review graph: ${graphId}`);
    return parseRecord<ReviewGraphRecord>(row.record_json, "review graph");
  }

  getReviewGraphByCandidateTaskId(candidateTaskId: string): ReviewGraphRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT record_json FROM review_graphs
         WHERE candidate_task_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
      )
      .get(candidateTaskId) as { record_json: string } | undefined;
    if (row === undefined) return undefined;
    return parseRecord<ReviewGraphRecord>(row.record_json, "review graph");
  }

  getReviewGraphByCandidateRevisionId(candidateRevisionId: string): ReviewGraphRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT record_json FROM review_graphs
         WHERE candidate_revision_id = ?
         LIMIT 1`,
      )
      .get(candidateRevisionId) as { record_json: string } | undefined;
    if (row === undefined) return undefined;
    return parseRecord<ReviewGraphRecord>(row.record_json, "review graph");
  }

  listReviewGraphs(statuses?: ReviewGraphStatus[]): ReviewGraphRecord[] {
    if (statuses === undefined || statuses.length === 0) {
      const rows = this.db
        .prepare("SELECT record_json FROM review_graphs ORDER BY created_at DESC")
        .all() as unknown as Array<{ record_json: string }>;
      return rows.map((row) => parseRecord<ReviewGraphRecord>(row.record_json, "review graph"));
    }
    const placeholders = statuses.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT record_json FROM review_graphs
         WHERE status IN (${placeholders})
         ORDER BY created_at DESC`,
      )
      .all(...statuses) as unknown as Array<{ record_json: string }>;
    return rows.map((row) => parseRecord<ReviewGraphRecord>(row.record_json, "review graph"));
  }

  getReviewAssignment(assignmentId: string): ReviewAssignmentRecord {
    const row = this.db
      .prepare("SELECT record_json FROM review_assignments WHERE id = ?")
      .get(assignmentId) as { record_json: string } | undefined;
    if (!row) throw new Error(`Unknown review assignment: ${assignmentId}`);
    return parseRecord<ReviewAssignmentRecord>(row.record_json, "review assignment");
  }

  getReviewAssignmentByReviewerTaskId(reviewerTaskId: string): ReviewAssignmentRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT record_json FROM review_assignments WHERE reviewer_task_id = ?`,
      )
      .get(reviewerTaskId) as { record_json: string } | undefined;
    if (row === undefined) return undefined;
    return parseRecord<ReviewAssignmentRecord>(row.record_json, "review assignment");
  }

  listReviewAssignments(graphId: string): ReviewAssignmentRecord[] {
    const rows = this.db
      .prepare(
        `SELECT record_json FROM review_assignments
         WHERE graph_id = ?
         ORDER BY ordinal, created_at, id`,
      )
      .all(graphId) as unknown as Array<{ record_json: string }>;
    return rows.map((row) =>
      parseRecord<ReviewAssignmentRecord>(row.record_json, "review assignment"),
    );
  }

  /** Atomically update assignment + graph records after reconcile. */
  updateReviewAssignmentAndGraph(
    assignment: ReviewAssignmentRecord,
    graph: ReviewGraphRecord,
  ): void {
    if (assignment.graphId !== graph.id) {
      throw new Error("Review assignment must belong to the graph");
    }
    this.transact(() => {
      this.db
        .prepare(
          `UPDATE review_assignments
           SET status = ?, record_json = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(assignment.status, JSON.stringify(assignment), assignment.updatedAt, assignment.id);
      this.db
        .prepare(
          `UPDATE review_graphs
           SET status = ?, record_json = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(graph.status, JSON.stringify(graph), graph.updatedAt, graph.id);
    });
  }

  // --- Main-direct execution decisions ---

  saveMainDirectDecision(record: MainDirectDecisionRecord): void {
    this.db
      .prepare(
        `INSERT INTO main_direct_decisions (id, task_class, reason, status, started_at, closed_at, record_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.taskClass,
        record.reason,
        record.status,
        record.startedAt,
        record.closedState?.closedAt ?? null,
        JSON.stringify(record),
      );
  }

  getMainDirectDecision(id: string): MainDirectDecisionRecord {
    const row = this.db
      .prepare("SELECT record_json FROM main_direct_decisions WHERE id = ?")
      .get(id) as { record_json: string } | undefined;
    if (!row) throw new Error(`Unknown main-direct decision: ${id}`);
    return parseRecord<MainDirectDecisionRecord>(row.record_json, "main-direct decision");
  }

  /** Atomically close an open Main-direct decision. A false result means
   * another caller closed it first; the returned record is the durable winner. */
  closeMainDirectDecision(record: MainDirectDecisionRecord): {
    applied: boolean;
    record: MainDirectDecisionRecord;
  } {
    if (record.status === "open" || record.closedState === undefined) {
      throw new Error("A Main-direct close requires a terminal record and closedState");
    }
    const updated = this.db
      .prepare(
        `UPDATE main_direct_decisions
         SET status = ?, closed_at = ?, record_json = ?
         WHERE id = ? AND status = 'open'`,
      )
      .run(record.status, record.closedState?.closedAt ?? null, JSON.stringify(record), record.id);
    if (updated.changes === 1) return { applied: true, record };
    return { applied: false, record: this.getMainDirectDecision(record.id) };
  }

  listMainDirectDecisions(): MainDirectDecisionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT record_json FROM main_direct_decisions
         ORDER BY started_at DESC, id DESC`,
      )
      .all() as unknown as Array<{ record_json: string }>;
    return rows.map((row) =>
      parseRecord<MainDirectDecisionRecord>(row.record_json, "main-direct decision"),
    );
  }

  listRecentMainDirectDecisions(limit: number): MainDirectDecisionRecord[] {
    const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20;
    const rows = this.db
      .prepare(
        `SELECT record_json FROM main_direct_decisions
         ORDER BY started_at DESC, id DESC
         LIMIT ?`,
      )
      .all(safeLimit) as unknown as Array<{ record_json: string }>;
    return rows.map((row) =>
      parseRecord<MainDirectDecisionRecord>(row.record_json, "main-direct decision"),
    );
  }

  // --- Outcome intake (FL-109D1) ---

  /** Persist one pending/proposed outcome intake. Does not touch Task, Plan,
   *  Goal, Attempt, Worker, or Provider lifecycle tables. */
  createOutcomeIntake(record: OutcomeIntakeRecord): void {
    this.db
      .prepare(
        "INSERT INTO outcome_intakes (id, status, revision, updated_at, record_json) VALUES (?, ?, ?, ?, ?)",
      )
      .run(record.id, record.status, record.revision, record.updatedAt, JSON.stringify(record));
  }

  getOutcomeIntake(intakeId: string): OutcomeIntakeRecord {
    const row = this.db.prepare("SELECT record_json FROM outcome_intakes WHERE id = ?").get(intakeId) as
      | { record_json: string }
      | undefined;
    if (!row) throw new Error("Unknown outcome intake");
    return parseRecord<OutcomeIntakeRecord>(row.record_json, "outcome intake");
  }

  /** Read-only bounded list. The limit is defensively clamped to the validated
   *  [1, 100] range so every caller returns at most the requested amount. */
  listOutcomeIntakes(statuses?: OutcomeIntakeStatus[], limit?: number): OutcomeIntakeRecord[] {
    const safeLimit = Math.max(
      1,
      Math.min(
        typeof limit === "number" && Number.isSafeInteger(limit)
          ? limit
          : OUTCOME_INTAKE_LIST_DEFAULT_LIMIT,
        OUTCOME_INTAKE_LIST_MAX_LIMIT,
      ),
    );
    const rows = statuses !== undefined && statuses.length > 0
      ? this.db
          .prepare(
            `SELECT record_json FROM outcome_intakes
             WHERE status IN (${statuses.map(() => "?").join(", ")})
             ORDER BY updated_at DESC, id DESC
             LIMIT ?`,
          )
          .all(...statuses, safeLimit)
      : this.db
          .prepare(
            `SELECT record_json FROM outcome_intakes
             ORDER BY updated_at DESC, id DESC
             LIMIT ?`,
          )
          .all(safeLimit);
    return (rows as unknown as Array<{ record_json: string }>).map((row) =>
      parseRecord<OutcomeIntakeRecord>(row.record_json, "outcome intake"),
    );
  }

  /** Optimistic revision-safe replacement. `record.revision` must equal the
   *  stored revision plus one, otherwise the write fails closed with the fixed
   *  stale-revision reason and the prior record stays unchanged. A created
   *  intake is terminal in this slice and can never be replaced by a proposal:
   *  the WHERE guard rejects any write over a created row so stale proposals
   *  cannot overwrite created truth even if a caller bypasses the coordinator. */
  updateOutcomeIntake(record: OutcomeIntakeRecord): OutcomeIntakeRecord {
    const expected = record.revision - 1;
    const result = this.db
      .prepare(
        `UPDATE outcome_intakes
         SET status = ?, revision = ?, updated_at = ?, record_json = ?
         WHERE id = ? AND revision = ? AND status <> 'created'`,
      )
      .run(record.status, record.revision, record.updatedAt, JSON.stringify(record), record.id, expected);
    if (result.changes !== 1) {
      throw new Error(STALE_OUTCOME_INTAKE_REASON);
    }
    return record;
  }
}
