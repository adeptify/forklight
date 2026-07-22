import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AttemptRecord,
  EventRecord,
  EventType,
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
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
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
    `);
  }

  close(): void {
    this.db.close();
  }

  createTask(record: TaskRecord): void {
    this.db
      .prepare("INSERT INTO tasks (id, status, updated_at, record_json) VALUES (?, ?, ?, ?)")
      .run(record.id, record.status, record.updatedAt, JSON.stringify(record));
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

  addEvent(
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
}
