import assert from "node:assert/strict";
import test from "node:test";
import { resolveMaxBudgetUsd } from "../src/core/budget.js";
import { budgetArguments } from "../src/workers/claude.js";

test("explicit null is unlimited and is never replaced by a finite default (FL-D92)", () => {
  const resolved = resolveMaxBudgetUsd(null, 0.5);
  assert.equal(resolved.maxBudgetUsd, null);
  assert.equal(resolved.source, "explicit-null");
  assert.equal(resolved.generatesRuntimeFlag, false);
  assert.deepEqual(budgetArguments(resolved.maxBudgetUsd), []);
});

test("omitted budget inherits null default without inventing a positive cap (FL-D92)", () => {
  const resolved = resolveMaxBudgetUsd(undefined, null);
  assert.equal(resolved.maxBudgetUsd, null);
  assert.equal(resolved.source, "inherited-null");
  assert.equal(resolved.generatesRuntimeFlag, false);
});

test("omitted budget inherits finite default", () => {
  const resolved = resolveMaxBudgetUsd(undefined, 1.25);
  assert.equal(resolved.maxBudgetUsd, 1.25);
  assert.equal(resolved.source, "inherited-finite");
  assert.equal(resolved.generatesRuntimeFlag, true);
  assert.deepEqual(budgetArguments(resolved.maxBudgetUsd), ["--max-budget-usd", "1.25"]);
});

test("explicit finite budget wins over null default", () => {
  const resolved = resolveMaxBudgetUsd(2, null);
  assert.equal(resolved.maxBudgetUsd, 2);
  assert.equal(resolved.source, "explicit-finite");
  assert.equal(resolved.generatesRuntimeFlag, true);
});

test("nullish coalescing would wrongly replace explicit null — resolveMaxBudgetUsd does not", () => {
  // Documents the pre-fix bug: `null ?? 0.5` becomes 0.5 (null is nullish).
  const explicitNull: number | null = null;
  assert.equal(explicitNull ?? 0.5, 0.5);
  assert.equal(resolveMaxBudgetUsd(null, 0.5).maxBudgetUsd, null);
});
