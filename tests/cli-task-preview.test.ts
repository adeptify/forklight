import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildTaskAdmissionPreview,
  formatTaskAdmissionPreviewHuman,
  taskPolicyFromSettings,
} from "../src/core/task-preview.js";
import { cloneDefaults } from "../src/core/settings.js";
import { upsertModelConfig } from "../src/core/model-catalog.js";
import { upsertWorkerProfile } from "../src/core/worker-profiles.js";
import { loadTaskSpec } from "../src/core/task.js";

/**
 * CLI validate uses the same shared preview builder and complete taskPolicy.
 * These tests prove CLI-facing presentation agrees with submission resolution
 * without spawning a process (shell is unavailable in the Worker runtime).
 */

function grokSettings() {
  const base = cloneDefaults();
  const catalog = upsertModelConfig(base.modelCatalog, {
    id: "xai-grok",
    label: "xAI Grok",
    provider: "xai",
    model: "grok-4.5",
    endpoint: "https://api.x.ai/v1",
  });
  // Replace default catalog entry is fine; ensure custom profile exists.
  const profiles = upsertWorkerProfile(base.workerProfiles, {
    id: "local-grok-builder",
    label: "Local Grok Builder",
    runtime: "grok-build",
    modelConfigId: "xai-grok",
    effort: "medium",
    maxBudgetUsd: 0.75,
    advancedPolicy: {
      baseMaxAttempts: 4,
      maxExtraAttempts: 1,
      maxConcurrency: 1,
      fileLimitMode: "warn",
      changedLineLimitMode: "score",
    },
  }, catalog);
  return { ...base, modelCatalog: catalog, workerProfiles: profiles };
}

async function writeTask(workerProfileId: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-cli-preview-"));
  await mkdir(path.join(root, "project"));
  const taskFile = path.join(root, "task.yaml");
  await writeFile(
    taskFile,
    `version: 2
name: CLI Preview Task
project: ./project
workerProfileId: ${workerProfileId}
worker:
  focusPaths: [src]
contract:
  outcome: CLI and daemon must resolve the same saved Worker
  context: [settings snapshot]
  inScope: [preview]
  outOfScope: [submit]
  executionSteps: [validate]
  deliverables: [preview]
  modules:
    - name: cli
      responsibility: present the canonical preview to the user
      consumes: [file]
      produces: [lines]
      boundaries: [no daemon submit]
  callChain: [cli, preview, exit]
  scenarios:
    - name: custom
      given: saved profile
      when: validate
      then: exact selection
    - name: missing
      given: absent profile
      when: validate
      then: reject
  risks: [policy drift]
  changeBudget:
    maxFiles: 6
    maxDiffLines: 200
acceptance:
  criteria: [agree]
  commands:
    - "true"
`,
  );
  return taskFile;
}

test("CLI validate path uses complete taskPolicy so custom Profile loads like submit", async () => {
  const settings = grokSettings();
  const incomplete = {
    contractQuality: settings.contractQuality,
    execution: settings.execution,
    providerDefaults: settings.providerDefaults,
    completionPolicy: settings.completionPolicy,
    deliveryProfiles: settings.deliveryProfiles,
  };
  const complete = taskPolicyFromSettings(settings);
  const taskFile = await writeTask("local-grok-builder");

  // Legacy incomplete policy falls back to built-in defaults and rejects custom ids.
  await assert.rejects(
    () => loadTaskSpec(taskFile, incomplete),
    /Unknown worker profile: local-grok-builder/,
  );

  const loaded = await loadTaskSpec(taskFile, complete);
  assert.equal(loaded.spec.workerProfileId, "local-grok-builder");
  assert.equal(loaded.spec.provider.name, "xai");
  assert.equal(loaded.spec.provider.model, "grok-4.5");
  assert.equal(loaded.spec.runtime.name, "grok-build");
  assert.equal(loaded.spec.runtime.effort, "medium");
  assert.equal(loaded.spec.runtime.maxBudgetUsd, 0.75);

  const preview = await buildTaskAdmissionPreview(taskFile, settings);
  assert.equal(preview.workerProfileId, loaded.spec.workerProfileId);
  assert.equal(preview.provider, loaded.spec.provider.name);
  assert.equal(preview.model, loaded.spec.provider.model);
  assert.equal(preview.runtime, loaded.spec.runtime.name);
  assert.equal(preview.effort, loaded.spec.runtime.effort);
  assert.equal(preview.budget.maxBudgetUsd, loaded.spec.runtime.maxBudgetUsd);
  assert.equal(preview.effectivePolicy.provenance.baseMaxAttempts, "worker");
  assert.equal(preview.effectivePolicy.values.baseMaxAttempts, 4);
  assert.equal(preview.effectivePolicy.provenance.changedLineLimitMode, "worker");
});

test("CLI human and JSON presentation share the same safe preview facts", async () => {
  const settings = grokSettings();
  const taskFile = await writeTask("local-grok-builder");
  const preview = await buildTaskAdmissionPreview(taskFile, settings);
  const human = formatTaskAdmissionPreviewHuman(preview);
  const json = JSON.stringify(preview, null, 2);

  assert.match(human, /Worker Profile: local-grok-builder \(Local Grok Builder\)/);
  assert.match(human, /Provider: xai/);
  assert.match(human, /Model: grok-4\.5/);
  assert.match(human, /Runtime: grok-build/);
  assert.match(human, /Effort: medium/);
  assert.match(human, /Budget: \$0\.75/);
  assert.match(human, /baseMaxAttempts=4 \(worker\)/);
  assert.match(human, /Task Contract: PASS/);
  assert.match(human, /Integration feasibility:/);

  assert.match(json, /"workerProfileId": "local-grok-builder"/);
  assert.match(json, /"provider": "xai"/);
  assert.match(json, /"model": "grok-4\.5"/);
  assert.match(json, /"runtime": "grok-build"/);
  assert.doesNotMatch(json, /"taskFile"/);
  assert.doesNotMatch(json, /keychain/i);
  assert.doesNotMatch(json, /endpoint/i);
  assert.doesNotMatch(human, /keychain/i);
  assert.doesNotMatch(human, /https:\/\//);
});

test("CLI validate rejects missing Profile the same way submission would", async () => {
  const settings = grokSettings();
  const taskFile = await writeTask("absent-profile");
  await assert.rejects(
    () => buildTaskAdmissionPreview(taskFile, settings),
    /Unknown worker profile: absent-profile/,
  );
  await assert.rejects(
    () => loadTaskSpec(taskFile, taskPolicyFromSettings(settings)),
    /Unknown worker profile: absent-profile/,
  );
});

