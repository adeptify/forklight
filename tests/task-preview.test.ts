import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildTaskAdmissionPreview,
  computePreviewRevisionDigest,
  formatTaskAdmissionPreviewHuman,
  prepareTaskAdmission,
  projectSafeTaskAdmissionPreview,
  taskPolicyFromSettings,
} from "../src/core/task-preview.js";
import { cloneDefaults, SettingsService } from "../src/core/settings.js";
import { upsertModelConfig } from "../src/core/model-catalog.js";
import { upsertWorkerProfile } from "../src/core/worker-profiles.js";
import { StateStore } from "../src/state/store.js";

const SECRET_ENDPOINT = "https://secret-endpoint.example.invalid/v1";
const SECRET_KEYCHAIN = "forklight.secret.preview-keychain";
const SECRET_PROMPT = "NEVER_LEAK_THIS_PROMPT_TEXT_XYZ";

function minimalContractYaml(overrides: {
  name?: string;
  workerProfileId?: string;
  project?: string;
  acceptanceCommand?: string;
  extraProvider?: string;
}): string {
  const name = overrides.name ?? "Preview Contract";
  const project = overrides.project ?? "./project";
  const profileLine = overrides.workerProfileId === undefined
    ? ""
    : `workerProfileId: ${overrides.workerProfileId}\n`;
  const providerBlock = overrides.extraProvider === undefined
    ? ""
    : `provider:
  endpoint: ${SECRET_ENDPOINT}
  keychainService: ${SECRET_KEYCHAIN}
`;
  const command = overrides.acceptanceCommand ?? "true";
  return `version: 2
name: ${name}
project: ${project}
${profileLine}${providerBlock}worker:
  focusPaths: [src]
contract:
  outcome: A reasonable outcome description for preview
  context: [current behavior]
  inScope: [preview module]
  outOfScope: [credentials]
  executionSteps: [inspect, edit]
  deliverables: [preview result]
  modules:
    - name: preview
      responsibility: long enough responsibility text
      consumes: [input]
      produces: [output]
      boundaries: [no network]
  callChain: [start, finish]
  scenarios:
    - name: happy
      given: ok
      when: run
      then: pass
    - name: edge
      given: bad
      when: run
      then: error
  risks: [scope creep]
  changeBudget:
    maxFiles: 4
    maxDiffLines: 80
acceptance:
  criteria: [works]
  commands:
    - "${command}"
# ${SECRET_PROMPT}
`;
}

async function writePreviewFixture(options: {
  workerProfileId?: string;
  name?: string;
  acceptanceCommand?: string;
  extraProvider?: boolean;
}): Promise<{ root: string; taskFile: string; project: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-preview-"));
  const project = path.join(root, "project");
  await mkdir(project);
  const taskFile = path.join(root, "task.yaml");
  await writeFile(
    taskFile,
    minimalContractYaml({
      ...(options.name === undefined ? {} : { name: options.name }),
      ...(options.workerProfileId === undefined
        ? {}
        : { workerProfileId: options.workerProfileId }),
      ...(options.acceptanceCommand === undefined
        ? {}
        : { acceptanceCommand: options.acceptanceCommand }),
      ...(options.extraProvider ? { extraProvider: "yes" } : {}),
    }),
  );
  return { root, taskFile, project };
}

function settingsWithGrokBuilder() {
  const base = cloneDefaults();
  const catalog = upsertModelConfig(base.modelCatalog, {
    id: "xai-grok-builder",
    label: "xAI Grok Builder",
    provider: "xai",
    model: "grok-4.5",
    endpoint: SECRET_ENDPOINT,
  });
  const profiles = upsertWorkerProfile(base.workerProfiles, {
    id: "local-grok-builder",
    label: "Local Grok Builder",
    runtime: "grok-build",
    modelConfigId: "xai-grok-builder",
    effort: "high",
    maxBudgetUsd: 1.5,
    advancedPolicy: {
      baseMaxAttempts: 5,
      maxExtraAttempts: 2,
      maxConcurrency: 1,
      noProgressTimeoutMs: 900_000,
      completionMode: "warn",
      changeBudgetMode: "warn",
    },
  }, catalog);
  return {
    ...base,
    modelCatalog: catalog,
    workerProfiles: profiles,
    providerDefaults: {
      ...base.providerDefaults,
      xai: {
        ...base.providerDefaults.xai,
        defaultKeychainService: SECRET_KEYCHAIN,
        defaultEndpoint: SECRET_ENDPOINT,
      },
    },
  };
}

test("taskPolicyFromSettings includes workerProfiles and modelCatalog", () => {
  const settings = settingsWithGrokBuilder();
  const policy = taskPolicyFromSettings(settings);
  assert.equal(policy.workerProfiles, settings.workerProfiles);
  assert.equal(policy.modelCatalog, settings.modelCatalog);
  assert.ok(policy.workerProfiles?.profiles.some((p) => p.id === "local-grok-builder"));
});

test("custom Grok Profile resolves exactly with policy provenance", async () => {
  const { taskFile } = await writePreviewFixture({
    workerProfileId: "local-grok-builder",
    name: "Grok Preview",
  });
  const settings = settingsWithGrokBuilder();
  const preview = await buildTaskAdmissionPreview(taskFile, settings);

  assert.equal(preview.taskName, "Grok Preview");
  assert.equal(preview.workerProfileId, "local-grok-builder");
  assert.equal(preview.workerProfileLabel, "Local Grok Builder");
  assert.equal(preview.provider, "xai");
  assert.equal(preview.model, "grok-4.5");
  assert.equal(preview.runtime, "grok-build");
  assert.equal(preview.effort, "high");
  assert.equal(preview.budget.maxBudgetUsd, 1.5);
  assert.equal(preview.budget.unlimited, false);
  assert.equal(preview.effectivePolicy.profileId, "local-grok-builder");
  assert.equal(preview.effectivePolicy.values.baseMaxAttempts, 5);
  assert.equal(preview.effectivePolicy.provenance.baseMaxAttempts, "worker");
  assert.equal(preview.effectivePolicy.values.noProgressTimeoutMs, 900_000);
  assert.equal(preview.effectivePolicy.provenance.noProgressTimeoutMs, "worker");
  assert.equal(preview.effectivePolicy.values.completionMode, "warn");
  assert.equal(preview.effectivePolicy.provenance.completionMode, "worker");
  assert.equal(preview.quality.passed, true);
  assert.ok(preview.quality.score >= 0);
  assert.equal(typeof preview.previewRevisionDigest, "string");
  assert.match(preview.previewRevisionDigest, /^[a-f0-9]{64}$/);
  assert.equal(preview.integration.applicable, true);
});

test("missing named Profile fails closed without fallback", async () => {
  const { taskFile } = await writePreviewFixture({
    workerProfileId: "does-not-exist",
  });
  const settings = settingsWithGrokBuilder();
  await assert.rejects(
    () => buildTaskAdmissionPreview(taskFile, settings),
    /Unknown worker profile: does-not-exist/,
  );
});

test("safe preview excludes endpoint, keychain, paths, commands, and prompt text", async () => {
  const { taskFile, project } = await writePreviewFixture({
    workerProfileId: "local-grok-builder",
    acceptanceCommand: "npm test -- --grep secret",
    extraProvider: true,
  });
  const settings = settingsWithGrokBuilder();
  const preview = await buildTaskAdmissionPreview(taskFile, settings);
  const serialized = JSON.stringify(preview);

  assert.doesNotMatch(serialized, new RegExp(SECRET_ENDPOINT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(serialized, new RegExp(SECRET_KEYCHAIN));
  assert.doesNotMatch(serialized, /keychain/i);
  assert.doesNotMatch(serialized, /endpoint/i);
  assert.doesNotMatch(serialized, new RegExp(SECRET_PROMPT));
  assert.doesNotMatch(serialized, /npm test/);
  assert.doesNotMatch(serialized, new RegExp(project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(serialized, new RegExp(taskFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal("taskFile" in preview, false);
  assert.equal("project" in preview, false);
  assert.equal("provider" in preview && typeof preview.provider === "string", true);
  // provider is the name string only — no nested endpoint/keychain object
  assert.equal(typeof preview.provider, "string");
  assert.equal(preview.provider, "xai");
});

test("settings changes affect later preview only; digest binds effective admission settings", async () => {
  const { taskFile } = await writePreviewFixture({
    workerProfileId: "local-grok-builder",
  });
  const firstSettings = settingsWithGrokBuilder();
  const first = await buildTaskAdmissionPreview(taskFile, firstSettings);
  assert.equal(first.model, "grok-4.5");
  assert.equal(first.budget.maxBudgetUsd, 1.5);

  const catalog = upsertModelConfig(firstSettings.modelCatalog, {
    id: "xai-grok-builder",
    label: "xAI Grok Builder v2",
    provider: "xai",
    model: "grok-4.20",
    endpoint: SECRET_ENDPOINT,
  });
  const profiles = upsertWorkerProfile(firstSettings.workerProfiles, {
    id: "local-grok-builder",
    label: "Local Grok Builder Revised",
    runtime: "grok-build",
    modelConfigId: "xai-grok-builder",
    effort: "xhigh",
    maxBudgetUsd: 2.25,
    advancedPolicy: {
      baseMaxAttempts: 9,
      maxExtraAttempts: 0,
      maxConcurrency: 1,
    },
  }, catalog);
  const secondSettings = {
    ...firstSettings,
    modelCatalog: catalog,
    workerProfiles: profiles,
  };
  const second = await buildTaskAdmissionPreview(taskFile, secondSettings);
  assert.equal(second.model, "grok-4.20");
  assert.equal(second.effort, "xhigh");
  assert.equal(second.budget.maxBudgetUsd, 2.25);
  assert.equal(second.workerProfileLabel, "Local Grok Builder Revised");
  assert.equal(second.effectivePolicy.values.baseMaxAttempts, 9);
  assert.equal(second.effectivePolicy.provenance.baseMaxAttempts, "worker");
  // Same file bytes but the effective selection/policy changed with settings,
  // so the bound preview revision must change and never silently reuse the old
  // confirmation for the new effective admission.
  assert.notEqual(second.previewRevisionDigest, first.previewRevisionDigest);
  // Same file + same settings are stable: the digest is deterministic.
  const firstAgain = await buildTaskAdmissionPreview(taskFile, firstSettings);
  assert.equal(firstAgain.previewRevisionDigest, first.previewRevisionDigest);
});

test("preview revision digest changes for relevant Task-file byte changes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-preview-drift-"));
  const project = path.join(root, "project");
  await mkdir(project);
  const taskFile = path.join(root, "task.yaml");
  await writeFile(taskFile, minimalContractYaml({ workerProfileId: "local-grok-builder" }));
  const settings = settingsWithGrokBuilder();
  const first = await buildTaskAdmissionPreview(taskFile, settings);
  // Appending a YAML comment changes file bytes without changing the parsed
  // spec, so the effective admission is identical except for the file digest.
  await writeFile(
    taskFile,
    `${minimalContractYaml({ workerProfileId: "local-grok-builder" })}\n# drift comment\n`,
  );
  const second = await buildTaskAdmissionPreview(taskFile, settings);
  assert.notEqual(second.previewRevisionDigest, first.previewRevisionDigest);
  assert.equal(second.model, first.model);
  assert.equal(second.budget.maxBudgetUsd, first.budget.maxBudgetUsd);
});

test("preview revision digest contains no recoverable Task text, path, command, or secret", async () => {
  const { taskFile } = await writePreviewFixture({
    workerProfileId: "local-grok-builder",
    acceptanceCommand: "npm test -- --grep secret",
    extraProvider: true,
  });
  const settings = settingsWithGrokBuilder();
  const prepared = await prepareTaskAdmission(taskFile, settings);
  const digest = prepared.previewRevisionDigest;
  assert.match(digest, /^[a-f0-9]{64}$/);
  // The digest is a hex hash and never carries the secret material.
  assert.doesNotMatch(digest, new RegExp(SECRET_ENDPOINT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(digest, new RegExp(SECRET_KEYCHAIN));
  assert.doesNotMatch(digest, /npm test/);
  // Recompute from the same prepared admission is deterministic and identical
  // to what a bound submit_file recomputes from one prepared admission.
  const recomputed = computePreviewRevisionDigest({
    taskFileDigest: prepared.taskFileDigest,
    spec: prepared.spec,
    effective: prepared.effectivePolicy,
    qualityReport: prepared.qualityReport,
    integration: prepared.integration,
  });
  assert.equal(recomputed, digest);
  // The safe projection and the prepared admission share one parse/resolve.
  assert.equal(
    projectSafeTaskAdmissionPreview(prepared).previewRevisionDigest,
    digest,
  );
});

test("prepareTaskAdmission shares one file read and one policy resolution with the safe preview", async () => {
  const { taskFile } = await writePreviewFixture({
    workerProfileId: "local-grok-builder",
  });
  const settings = settingsWithGrokBuilder();
  const prepared = await prepareTaskAdmission(taskFile, settings);
  const projected = projectSafeTaskAdmissionPreview(prepared);
  const built = await buildTaskAdmissionPreview(taskFile, settings);
  assert.deepEqual(projected, built);
  assert.equal(prepared.profileId, "local-grok-builder");
  assert.equal(prepared.spec.provider.name, "xai");
  assert.equal(prepared.effectivePolicy.profileId, "local-grok-builder");
});

test("preview creates no Task rows or workspace artifacts", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-preview-home-"));
  const store = new StateStore(home);
  const settingsService = new SettingsService(store);
  const withGrok = settingsWithGrokBuilder();
  settingsService.update({
    modelCatalog: withGrok.modelCatalog,
    workerProfiles: withGrok.workerProfiles,
  });
  const { taskFile, root } = await writePreviewFixture({
    workerProfileId: "local-grok-builder",
  });
  try {
    const beforeTasks = store.listTasks().length;
    const preview = await buildTaskAdmissionPreview(taskFile, settingsService.get());
    assert.equal(preview.workerProfileId, "local-grok-builder");
    assert.equal(store.listTasks().length, beforeTasks);
    assert.deepEqual(store.listTasks(), []);
    // No workspace dir created under the fixture project.
    const projectEntries = await readdir(path.join(root, "project"));
    assert.deepEqual(projectEntries, []);
    const afterSettings = settingsService.get();
    assert.equal(
      afterSettings.workerProfiles.profiles.find((p) => p.id === "local-grok-builder")?.label,
      "Local Grok Builder",
    );
  } finally {
    store.close();
  }
});

test("human format includes selection and quality without secrets", async () => {
  const { taskFile } = await writePreviewFixture({
    workerProfileId: "local-grok-builder",
  });
  const preview = await buildTaskAdmissionPreview(taskFile, settingsWithGrokBuilder());
  const human = formatTaskAdmissionPreviewHuman(preview);
  assert.match(human, /Worker Profile: local-grok-builder \(Local Grok Builder\)/);
  assert.match(human, /Provider: xai/);
  assert.match(human, /Model: grok-4\.5/);
  assert.match(human, /Runtime: grok-build/);
  assert.match(human, /Budget: \$1\.5/);
  assert.match(human, /baseMaxAttempts=5 \(worker\)/);
  assert.match(human, /Task Contract: PASS/);
  assert.match(human, /preview only/);
  assert.doesNotMatch(human, new RegExp(SECRET_ENDPOINT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(human, new RegExp(SECRET_KEYCHAIN));
});
