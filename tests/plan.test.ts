import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadWorkPlan } from "../src/core/plan.js";

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
