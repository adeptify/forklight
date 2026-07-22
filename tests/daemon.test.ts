import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { TaskRecord } from "../src/core/types.js";
import { daemonRequest } from "../src/daemon/client.js";
import { ForkLightDaemon } from "../src/daemon/server.js";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("daemon serves health and task-list requests over its local socket", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-daemon-"));
  const daemon = new ForkLightDaemon(home, 1);
  await daemon.start();
  try {
    const health = await daemonRequest<Record<string, unknown>>("health", {}, home);
    assert.equal(health.ok, true);
    assert.equal(health.maxConcurrency, 1);
    const tasks = await daemonRequest<unknown[]>("list", {}, home);
    assert.deepEqual(tasks, []);
  } finally {
    await daemon.close();
  }
});

test("daemon submission returns a task before workspace preparation finishes", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-daemon-submit-"));
  const daemon = new ForkLightDaemon(home, 1);
  await daemon.start();
  try {
    const task = await daemonRequest<TaskRecord>(
      "submit",
      {
        baseDirectory: home,
        task: {
          version: 1,
          name: "asynchronous preparation",
          project: path.join(home, "missing-project"),
          goal: "prove submission does not wait for project copying",
          provider: { name: "deepseek", model: "deepseek-v4-flash" },
          runtime: { name: "claude-code" },
          worker: { allowedCommands: [] },
          acceptance: { commands: ["true"] },
        },
      },
      home,
    );
    assert.match(task.id, /^[0-9a-f-]{36}$/);

    let current = task;
    for (let attempt = 0; attempt < 50 && current.status !== "failed"; attempt += 1) {
      await sleep(10);
      current = await daemonRequest<TaskRecord>("status", { taskId: task.id }, home);
    }
    assert.equal(current.status, "failed");
    assert.match(current.error ?? "", /Workspace preparation failed/);
  } finally {
    await daemon.close();
  }
});
