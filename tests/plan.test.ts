import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadWorkPlan } from "../src/core/plan.js";

const v3TaskFile = path.resolve("fixtures/v3-domain-neutral-task.yaml");

const taskFile = path.resolve("examples/deepseek-checkout.yaml");

test("validates task dependencies and produces parallel execution waves", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-plan-"));
  const planFile = path.join(root, "plan.json");
  await writeFile(
    planFile,
    JSON.stringify({
      version: 1,
      name: "Example product stage",
      objective: "Deliver two independently reviewable work items in dependency order.",
      items: [
        { id: "foundation", task: taskFile, dependsOn: [] },
        { id: "console", task: taskFile, dependsOn: ["foundation"] },
        { id: "statistics", task: taskFile, dependsOn: ["foundation"] },
      ],
    }),
  );
  const report = await loadWorkPlan(planFile);
  assert.equal(report.passed, true);
  assert.deepEqual(report.plan.waves, [["foundation"], ["console", "statistics"]]);
});

test("rejects a cyclic work plan", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-plan-"));
  const planFile = path.join(root, "plan.json");
  await writeFile(
    planFile,
    JSON.stringify({
      version: 1,
      name: "Cyclic plan",
      objective: "Prove the decomposition gate rejects dependency cycles.",
      items: [
        { id: "first", task: taskFile, dependsOn: ["second"] },
        { id: "second", task: taskFile, dependsOn: ["first"] },
      ],
    }),
  );
  const report = await loadWorkPlan(planFile);
  assert.equal(report.passed, false);
  assert.match(report.issues.join("\n"), /cycle/);
});

test("loads a version-3 Task item and retains its exact background", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-plan-v3-"));
  const planFile = path.join(root, "plan.json");
  await writeFile(
    planFile,
    JSON.stringify({
      version: 1,
      name: "Version-3 plan",
      objective: "Prove a context-rich version-3 Task loads as a Plan item.",
      items: [
        { id: "foundation", task: v3TaskFile, dependsOn: [] },
        { id: "console", task: v3TaskFile, dependsOn: ["foundation"] },
      ],
    }),
  );
  const report = await loadWorkPlan(planFile);
  assert.equal(report.passed, true);
  const foundation = report.plan.items.find((item) => item.id === "foundation")!;
  assert.equal(foundation.task.version, 3);
  if (foundation.task.version === 3) {
    assert.equal(
      foundation.task.contract.background.purpose,
      "Exercise context-rich version-3 Task contracts inside hierarchy work.",
    );
    assert.deepEqual(foundation.task.contract.background.priorDecisions, [
      "Plan and Goal items must support version 3.",
      "Preserve version 2 behavior exactly and keep rejecting version 1 in structured Plans.",
    ]);
  } else {
    assert.fail("expected a version-3 Task item");
  }
});

test("rejects a legacy version-1 item with a truthful unsupported-contract error", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-plan-v1-"));
  const project = path.join(root, "project");
  await mkdir(project, { recursive: true });
  const taskFile = path.join(root, "legacy-v1.json");
  await writeFile(
    taskFile,
    JSON.stringify({
      version: 1,
      name: "Legacy v1 task",
      project: "./project",
      goal: "Legacy v1 goal",
      constraints: [],
      provider: {
        name: "deepseek",
        model: "deepseek-v4-flash",
        keychainService: "forklight.plan-v1.test",
      },
      runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: null },
      workspace: { exclude: [] },
      worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
      acceptance: { commands: ["true"] },
    }),
  );
  const planFile = path.join(root, "plan.json");
  await writeFile(
    planFile,
    JSON.stringify({
      version: 1,
      name: "Legacy v1 plan",
      objective: "Prove version-1 items stay rejected in structured Plans.",
      items: [
        { id: "first", task: taskFile, dependsOn: [] },
        { id: "second", task: taskFile, dependsOn: ["first"] },
      ],
    }),
  );
  const report = await loadWorkPlan(planFile);
  assert.equal(report.passed, false);
  assert.match(report.issues.join("\n"), /unsupported legacy contract version 1/);
  assert.equal(report.plan.items.length, 0, "version-1 items must not enter the Plan");
});
