import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultAdvancedPolicyFields,
  defaultEnforcementCapability,
  maxWorkerValidationRepairsFromSnapshot,
  previewEffectivePolicy,
  resolveEffectivePolicy,
  validateAdvancedPolicyPatch,
} from "../src/core/advanced-policy.js";
import { cloneDefaults } from "../src/core/settings.js";

test("Worker validation-repair policy defaults to one and accepts finite overrides", () => {
  assert.equal(cloneDefaults().execution.maxWorkerValidationRepairs, 1);
  assert.equal(defaultAdvancedPolicyFields().maxWorkerValidationRepairs, 1);
  assert.equal(validateAdvancedPolicyPatch({ maxWorkerValidationRepairs: 0 }).maxWorkerValidationRepairs, 0);
  assert.equal(validateAdvancedPolicyPatch({ maxWorkerValidationRepairs: 2 }).maxWorkerValidationRepairs, 2);
  assert.throws(
    () => validateAdvancedPolicyPatch({ maxWorkerValidationRepairs: -1 }),
    /non-negative integer/,
  );
});

test("Task override wins over Worker Profile and global validation-repair allowance", () => {
  const global = defaultAdvancedPolicyFields();
  const worker = resolveEffectivePolicy(
    { maxWorkerValidationRepairs: 2 },
    undefined,
    global,
    "profile-a",
    defaultEnforcementCapability(),
  );
  assert.equal(worker.values.maxWorkerValidationRepairs, 2);
  assert.equal(worker.provenance.maxWorkerValidationRepairs, "worker");

  const task = resolveEffectivePolicy(
    { maxWorkerValidationRepairs: 2 },
    { maxWorkerValidationRepairs: 0 },
    global,
    "profile-a",
    defaultEnforcementCapability(),
  );
  assert.equal(task.values.maxWorkerValidationRepairs, 0);
  assert.equal(task.provenance.maxWorkerValidationRepairs, "task");
});

test("legacy immutable snapshots keep zero automatic validation repairs", () => {
  assert.equal(maxWorkerValidationRepairsFromSnapshot(undefined), 0);
  const legacy = {
    values: {} as never,
  } as never;
  assert.equal(maxWorkerValidationRepairsFromSnapshot(legacy), 0);
});

test("preview shows inherited default, zero, and custom finite repair allowances with provenance", () => {
  const global = defaultAdvancedPolicyFields();
  const capability = defaultEnforcementCapability();

  // No Worker override: inherits the global default of one, source = global.
  const inherited = previewEffectivePolicy(
    undefined,
    undefined,
    global,
    "profile-a",
    capability,
  );
  const inheritedRow = inherited.find((row) => row.field === "maxWorkerValidationRepairs");
  assert.equal(inheritedRow?.value, 1);
  assert.equal(inheritedRow?.source, "global");

  // Worker override to zero: effective value 0, source = worker.
  const disabled = previewEffectivePolicy(
    { maxWorkerValidationRepairs: 0 },
    undefined,
    global,
    "profile-a",
    capability,
  );
  const disabledRow = disabled.find((row) => row.field === "maxWorkerValidationRepairs");
  assert.equal(disabledRow?.value, 0);
  assert.equal(disabledRow?.source, "worker");

  // Custom finite value three round-trips through the validator and preview.
  assert.equal(validateAdvancedPolicyPatch({ maxWorkerValidationRepairs: 3 }).maxWorkerValidationRepairs, 3);
  const custom = previewEffectivePolicy(
    { maxWorkerValidationRepairs: 3 },
    undefined,
    global,
    "profile-a",
    capability,
  );
  const customRow = custom.find((row) => row.field === "maxWorkerValidationRepairs");
  assert.equal(customRow?.value, 3);
  assert.equal(customRow?.source, "worker");

  // A Task-level override wins and reports task provenance.
  const taskOverride = previewEffectivePolicy(
    { maxWorkerValidationRepairs: 3 },
    { maxWorkerValidationRepairs: 0 },
    global,
    "profile-a",
    capability,
  );
  const taskRow = taskOverride.find((row) => row.field === "maxWorkerValidationRepairs");
  assert.equal(taskRow?.value, 0);
  assert.equal(taskRow?.source, "task");
});
