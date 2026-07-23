import assert from "node:assert/strict";
import test from "node:test";
import { assessIntegrationFeasibility } from "../src/core/integration-feasibility.js";
import { cloneDefaults } from "../src/core/settings.js";
import type { TaskSpec } from "../src/core/types.js";

function contractSpec(maxFiles: number, maxDiffLines: number): TaskSpec {
  return {
    version: 2,
    name: "feasibility",
    project: "/tmp/project",
    provider: {
      name: "deepseek",
      model: "deepseek-v4-pro",
      keychainService: "forklight.deepseek.api-key",
    },
    runtime: {
      name: "claude-code",
      executable: "claude",
      effort: "high",
      maxBudgetUsd: 1,
    },
    workspace: { exclude: [] },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
    contract: {
      outcome: "A reasonable outcome description",
      context: ["c"],
      inScope: ["i"],
      outOfScope: ["o"],
      executionSteps: ["s"],
      deliverables: ["d"],
      modules: [{
        name: "m",
        responsibility: "long enough",
        consumes: ["c"],
        produces: ["p"],
        boundaries: ["b"],
      }],
      callChain: ["a", "b"],
      scenarios: [
        { name: "n", given: "g", when: "w", then: "t" },
        { name: "e", given: "g", when: "w", then: "t" },
      ],
      risks: ["r"],
      changeBudget: { maxFiles, maxDiffLines },
    },
    acceptance: { criteria: ["c"], commands: ["true"] },
  };
}

test("task within integration limits is integratable", () => {
  const integration = cloneDefaults().integration;
  const result = assessIntegrationFeasibility(contractSpec(3, 200), integration);
  assert.equal(result.applicable, true);
  assert.equal(result.integratable, true);
  assert.deepEqual(result.issues, []);
});

test("task exceeding integration limits reports executable-but-not-integratable issues", () => {
  const integration = cloneDefaults().integration; // 5 files / 400 lines
  const result = assessIntegrationFeasibility(contractSpec(12, 900), integration);
  assert.equal(result.applicable, true);
  assert.equal(result.integratable, false);
  assert.equal(result.issues.length, 2);
  assert.match(result.issues[0]!, /maxFiles/);
  assert.match(result.issues[1]!, /maxDiffLines/);
});
