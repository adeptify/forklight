import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { TaskRecord } from "../src/core/types.js";
import { StateStore } from "../src/state/store.js";

test("a resumed task clears stale terminal fields when it starts and succeeds", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-store-"));
  const store = new StateStore(home);
  const now = new Date().toISOString();
  const record = {
    id: "task-1",
    name: "State transition",
    status: "interrupted",
    sourcePath: "/tmp/source",
    taskFile: "/tmp/task.yaml",
    spec: {},
    paths: {},
    sessionId: "session-1",
    workerPid: 123,
    createdAt: now,
    updatedAt: now,
    finishedAt: now,
    error: "interrupted",
  } as unknown as TaskRecord;
  store.createTask(record);
  const running = store.setTaskStatus(record.id, "running", {
    error: null,
    finishedAt: null,
    workerPid: null,
  });
  assert.equal(running.error, undefined);
  assert.equal(running.finishedAt, undefined);
  assert.equal(running.workerPid, undefined);

  const succeeded = store.setTaskStatus(record.id, "succeeded", {
    finishedAt: now,
    error: null,
  });
  assert.equal(succeeded.status, "succeeded");
  assert.equal(succeeded.error, undefined);
  store.close();
});
