import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AttemptRecord,
  CompetitionCandidateRecord,
  CompetitionEvaluationRecord,
  CompetitionRecord,
  CompetitionStatus,
  DependencyRecord,
  EventRecord,
  EventType,
  IntegrationReceiptRecord,
  IntegrationResultRecord,
  PlanItemRecord,
  PlanItemStatus,
  PlanRecord,
  ProbeEvidence,
  StagedTaskRegistration,
  TaskRecord,
  TaskStatus,
} from "../core/types.js";

type TaskRecordPatch = Omit<Partial<TaskRecord>, "error" | "finishedAt" | "workerPid"> & {
  error?: string | null;
  finishedAt?: string | null;
  workerPid?: number | null;
};

function now(): string {
  return new Date().toISOString();
}

function parseRecord<T>(value: unknown, label: string): T {
  if (typeof value !== "string") throw new Error(`Invalid ${label} record in state database`);
  return JSON.parse(value) as T;
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
      CREATE TABLE IF NOT EXISTS provider_probes (
        provider TEXT PRIMARY KEY,
        record_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
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
    for (const key of ["error", "finishedAt", "workerPid"] as const) {
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

  private transact(action: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      action();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  createPlanGraph(
    plan: PlanRecord,
    items: PlanItemRecord[],
    dependencies: DependencyRecord[],
  ): void {
    this.validatePlanGraph(plan, items, dependencies);
    this.transact(() => this.insertPlanGraph(plan, items, dependencies));
  }

  createPlanExecution(
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
    this.transact(() => {
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
    });
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
    patch: { status?: CompetitionStatus; finishedAt?: string; latestEvaluationId?: string; error?: string | null },
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
}
