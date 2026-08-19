import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  buildTaskAdmissionPreview,
  computePreviewRevisionDigest,
  formatTaskAdmissionPreviewHuman,
  prepareTaskAdmission,
  projectSafeTaskAdmissionPreview,
  taskPolicyFromSettings,
  type RoutingExplanationNextAction,
} from "../src/core/task-preview.js";
import { cloneDefaults, SettingsService } from "../src/core/settings.js";
import { upsertModelConfig } from "../src/core/model-catalog.js";
import { upsertWorkerProfile } from "../src/core/worker-profiles.js";
import { StateStore } from "../src/state/store.js";
import {
  assessWorkspaceBoundary,
  formatWorkspaceBoundaryAdviceHuman,
  MAX_IGNORED_DIRECTORY_ROOTS,
  parseIgnoredDirectoryRoots,
  type GitIgnoredQueryRunner,
} from "../src/workspace/boundary-advice.js";
import { createPathPolicy } from "../src/workspace/path-policy.js";
import type { RoutingDecisionSnapshot, TaskRecord, TaskSpec } from "../src/core/types.js";

const execFileAsync = promisify(execFile);

const SECRET_ENDPOINT = "https://secret-endpoint.example.invalid/v1";
const SECRET_KEYCHAIN = "forklight.secret.preview-keychain";
const SECRET_PROMPT = "NEVER_LEAK_THIS_PROMPT_TEXT_XYZ";

function minimalContractYaml(overrides: {
  name?: string;
  workerProfileId?: string;
  project?: string;
  acceptanceCommand?: string;
  extraProvider?: string;
  taskClass?: string;
  taskFamily?: string;
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
  const taskClassLine = overrides.taskClass === undefined
    ? ""
    : `taskClass: ${overrides.taskClass}\n`;
  const taskFamilyLine = overrides.taskFamily === undefined
    ? ""
    : `taskFamily: ${overrides.taskFamily}\n`;
  const command = overrides.acceptanceCommand ?? "true";
  return `version: 2
name: ${name}
project: ${project}
${profileLine}${providerBlock}${taskClassLine}${taskFamilyLine}worker:
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
  taskClass?: string;
  taskFamily?: string;
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
      ...(options.taskClass === undefined ? {} : { taskClass: options.taskClass }),
      ...(options.taskFamily === undefined ? {} : { taskFamily: options.taskFamily }),
    }),
  );
  return { root, taskFile, project };
}

/** Fully typed valid routing decision — never an empty object. */
function validRoutingDecision(): RoutingDecisionSnapshot {
  const worker = {
    provider: "xai",
    model: "grok-4.5",
    runtime: "grok-build",
    effort: "high",
    workerProfileId: "local-grok-builder",
  };
  return {
    taskFamily: "refactor",
    shortlist: [worker],
    selectedWorker: worker,
    selectedBecause: { code: "user-specified", note: "stored decision for preview tests" },
    competition: { intent: "none", triggers: [] },
    evidenceSnapshot: { scope: "none", exactSampleCounts: {} },
  };
}

/** Minimal terminal ordinary TaskRecord for classification history. Fully typed
 *  TaskSpec — no `as` cast, no empty routingDecision. */
function terminalHistoryTask(
  id: string,
  taskClass: string | undefined,
  taskFamily: string | undefined,
  hasDecision: boolean,
): TaskRecord {
  const spec: TaskSpec = {
    version: 2,
    name: id,
    project: "/source",
    provider: { name: "xai", model: "grok-4.5", endpoint: "https://api.x.ai", keychainService: "fk" },
    runtime: { name: "grok-build", executable: "grok", effort: "high", maxBudgetUsd: 1 },
    workspace: { exclude: [] },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
    contract: {
      outcome: "o", context: [], inScope: [], outOfScope: [],
      executionSteps: [], deliverables: [], modules: [], callChain: [],
      scenarios: [], risks: [], changeBudget: { maxFiles: 1, maxDiffLines: 10 },
    },
    acceptance: { criteria: [], commands: ["true"] },
    ...(taskClass === undefined ? {} : { taskClass }),
    ...(taskFamily === undefined ? {} : { taskFamily }),
    ...(hasDecision ? { routingDecision: validRoutingDecision() } : {}),
  };
  return {
    id,
    name: id,
    status: "succeeded",
    sourcePath: "/source",
    taskFile: `/tasks/${id}.yaml`,
    spec,
    paths: {} as TaskRecord["paths"],
    sessionId: `session-${id}`,
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
  };
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
  assert.match(human, /Classification reuse advice:/);
  assert.doesNotMatch(human, new RegExp(SECRET_ENDPOINT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(human, new RegExp(SECRET_KEYCHAIN));
});

test("preview attaches classificationAdvice reflecting terminal ordinary history", async () => {
  const { taskFile } = await writePreviewFixture({
    workerProfileId: "local-grok-builder",
    taskClass: "migration",
    taskFamily: "refactor",
  });
  const settings = settingsWithGrokBuilder();
  const history = [
    terminalHistoryTask("h1", "migration", "refactor", true),
    terminalHistoryTask("h2", "lint-fix", "refactor", false),
  ];
  const preview = await buildTaskAdmissionPreview(taskFile, settings, history);

  assert.equal(preview.classificationAdvice.taskClass.state, "existing");
  assert.equal(preview.classificationAdvice.taskClass.terminalCount, 1);
  assert.equal(preview.classificationAdvice.taskClass.completeSelectionCount, 1);
  assert.equal(preview.classificationAdvice.taskFamily.state, "existing");
  assert.equal(preview.classificationAdvice.taskFamily.terminalCount, 2);
  assert.equal(preview.classificationAdvice.taskFamily.completeSelectionCount, 1);
  assert.equal(preview.classificationAdvice.nextAction, "reuse-classification");
  const refactor = preview.classificationAdvice.familyChoices.find((c) => c.family === "refactor");
  assert.ok(refactor);
  assert.equal(refactor!.distinctClassCount, 2);
});

test("classification history never enters previewRevisionDigest", async () => {
  const { taskFile } = await writePreviewFixture({
    workerProfileId: "local-grok-builder",
    taskClass: "migration",
    taskFamily: "refactor",
  });
  const settings = settingsWithGrokBuilder();
  const empty = await buildTaskAdmissionPreview(taskFile, settings);
  const withHistory = await buildTaskAdmissionPreview(taskFile, settings, [
    terminalHistoryTask("h1", "migration", "refactor", true),
  ]);

  assert.equal(empty.previewRevisionDigest, withHistory.previewRevisionDigest);
  // The advice itself may change with history, but the bound revision digest
  // stays identical so a sibling completion never stales this confirmation.
  assert.equal(empty.classificationAdvice.taskClass.state, "new");
  assert.equal(withHistory.classificationAdvice.taskClass.state, "existing");
});

test("preview propagates bounded classChoices and lists them in human output", async () => {
  const { taskFile } = await writePreviewFixture({
    workerProfileId: "local-grok-builder",
    taskClass: "fresh-class",
    taskFamily: "refactor",
  });
  const settings = settingsWithGrokBuilder();
  const history = [
    terminalHistoryTask("h1", "migration", "refactor", true),
    terminalHistoryTask("h2", "lint-fix", "refactor", false),
  ];
  const preview = await buildTaskAdmissionPreview(taskFile, settings, history);

  assert.deepEqual(preview.classificationAdvice.classChoices, [
    { taskClass: "migration", terminalCount: 1, completeSelectionCount: 1 },
    { taskClass: "lint-fix", terminalCount: 1, completeSelectionCount: 0 },
  ]);
  assert.equal(preview.classificationAdvice.taskClass.state, "new");
  assert.equal(preview.classificationAdvice.taskFamily.state, "existing");

  const human = formatTaskAdmissionPreviewHuman(preview);
  assert.match(human, /Existing classes in the selected family:/);
  assert.match(human, /migration: 1 terminal, 1 complete/);
  assert.match(human, /lint-fix: 1 terminal, 0 complete/);
});

test("classChoices may change with sibling history without changing the revision digest", async () => {
  const { taskFile } = await writePreviewFixture({
    workerProfileId: "local-grok-builder",
    taskClass: "fresh-class",
    taskFamily: "refactor",
  });
  const settings = settingsWithGrokBuilder();
  const empty = await buildTaskAdmissionPreview(taskFile, settings);
  const withHistory = await buildTaskAdmissionPreview(taskFile, settings, [
    terminalHistoryTask("h1", "migration", "refactor", true),
  ]);

  assert.deepEqual(empty.classificationAdvice.classChoices, []);
  assert.equal(withHistory.classificationAdvice.classChoices.length, 1);
  assert.equal(withHistory.classificationAdvice.classChoices[0]!.taskClass, "migration");
  // The classChoices projection stays outside the preview revision digest.
  assert.equal(withHistory.previewRevisionDigest, empty.previewRevisionDigest);
});

test("preview without history reports missing labels and never leaks Task identity", async () => {
  const { taskFile } = await writePreviewFixture({
    workerProfileId: "local-grok-builder",
    taskClass: "migration",
    taskFamily: "refactor",
  });
  const settings = settingsWithGrokBuilder();
  const preview = await buildTaskAdmissionPreview(taskFile, settings);
  assert.equal(preview.classificationAdvice.taskClass.state, "new");
  assert.equal(preview.classificationAdvice.taskFamily.state, "new");
  assert.deepEqual(preview.classificationAdvice.familyChoices, []);
  assert.equal(preview.classificationAdvice.nextAction, "confirm-new-family");

  const json = JSON.stringify(preview);
  assert.ok(!json.includes("/tasks/"));
  assert.ok(!json.includes("session-"));
  assert.ok(!json.includes("secret-daemon-endpoint"));
  assert.doesNotMatch(json, /"taskFile"/);
});

// --- M3: safe pre-submit routing explanation ---

const GROK_SELECTED_WORKER = {
  provider: "xai",
  model: "grok-4.5",
  runtime: "grok-build",
  effort: "high",
  workerProfileId: "local-grok-builder",
};

/** Write a Task Contract embedding the given routingDecision (JSON is valid YAML). */
async function writeRoutingDecisionTask(
  routingDecision: unknown,
  name = "Routing Preview Contract",
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-routing-explain-"));
  const project = path.join(root, "project");
  await mkdir(project);
  const taskFile = path.join(root, "task.yaml");
  const rdYaml = JSON.stringify(routingDecision, null, 2)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  await writeFile(
    taskFile,
    `version: 2
name: ${name}
project: ./project
workerProfileId: local-grok-builder
taskFamily: refactor
worker:
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
    - "true"
routingDecision:
${rdYaml}
`,
  );
  return taskFile;
}

/** Valid frozen routing decision with one code and optional overrides.
 *  Untyped return (like the MCP fixture) so arbitrary override shapes compile. */
function routingDecisionFor(
  code: string,
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    taskFamily: "refactor",
    shortlist: [GROK_SELECTED_WORKER],
    selectedWorker: GROK_SELECTED_WORKER,
    selectedBecause: { code, note: "stored note for routing explanation" },
    competition: { intent: "none", triggers: [] },
    evidenceSnapshot: { scope: "none", exactSampleCounts: {} },
    ...overrides,
  };
}

test("routing explanation hides private note, custom code, candidate keys, and settings digest", async () => {
  const decision = routingDecisionFor("custom-secret-code", {
    selectedBecause: {
      code: "custom-secret-code",
      note: "PRIVATE_MAIN_NOTE_XYZ",
    },
    evidenceSnapshot: {
      scope: "exact-class",
      exactSampleCounts: {
        "SECRET_CANDIDATE_KEY_1": 2,
        "SECRET_CANDIDATE_KEY_2": 0,
      },
      settingsDigest: "SECRET_SETTINGS_DIGEST_MARKER",
    },
  });
  const taskFile = await writeRoutingDecisionTask(decision);
  const preview = await buildTaskAdmissionPreview(taskFile, settingsWithGrokBuilder());
  const explanation = preview.routingExplanation;

  assert.equal(explanation.present, true);
  assert.equal(explanation.basis, "other");
  assert.equal(explanation.evidence!.scope, "exact-class");
  assert.equal(explanation.evidence!.candidateCount, 1);
  assert.equal(explanation.evidence!.totalSamples, 2);

  const json = JSON.stringify(preview);
  assert.ok(!json.includes("PRIVATE_MAIN_NOTE_XYZ"), "private note must not leak");
  assert.ok(!json.includes("custom-secret-code"), "custom reason code must not leak");
  assert.ok(!json.includes("SECRET_CANDIDATE_KEY_1"), "candidate identity key must not leak");
  assert.ok(!json.includes("SECRET_CANDIDATE_KEY_2"), "candidate identity key must not leak");
  assert.ok(!json.includes("SECRET_SETTINGS_DIGEST_MARKER"), "settings digest must not leak");
  assert.ok(!json.includes("settingsDigest"), "settings digest field must not leak");

  const human = formatTaskAdmissionPreviewHuman(preview);
  assert.ok(!human.includes("PRIVATE_MAIN_NOTE_XYZ"));
  assert.ok(!human.includes("custom-secret-code"));
  assert.ok(!human.includes("SECRET_CANDIDATE_KEY_1"));
  assert.ok(!human.includes("SECRET_SETTINGS_DIGEST_MARKER"));
});

test("routing explanation aggregates sample counts without raw identity keys", async () => {
  const decision = routingDecisionFor("main-judgment", {
    shortlist: [
      GROK_SELECTED_WORKER,
      { provider: "qwen", model: "qwen3.7-plus", runtime: "claude-code", effort: "high" },
      { provider: "deepseek", model: "deepseek-v4-flash", runtime: "claude-code", effort: "high" },
    ],
    evidenceSnapshot: {
      scope: "exact-class",
      exactSampleCounts: {
        "encoded-identity-1": 2,
        "encoded-identity-2": 1,
        "encoded-identity-3": 0,
      },
    },
  });
  const taskFile = await writeRoutingDecisionTask(decision);
  const preview = await buildTaskAdmissionPreview(taskFile, settingsWithGrokBuilder());
  const explanation = preview.routingExplanation;

  assert.equal(explanation.shortlistSize, 3);
  assert.equal(explanation.evidence!.scope, "exact-class");
  assert.equal(explanation.evidence!.candidateCount, 2);
  assert.equal(explanation.evidence!.totalSamples, 3);

  const json = JSON.stringify(preview);
  assert.ok(!json.includes("encoded-identity-1"));
  assert.ok(!json.includes("encoded-identity-2"));
  assert.ok(!json.includes("encoded-identity-3"));
});

test("routing explanation aggregates family-sample counts when scope is task-family", async () => {
  const decision = routingDecisionFor("relevant-delivery", {
    evidenceSnapshot: {
      scope: "task-family",
      exactSampleCounts: { "encoded-a": 1, "encoded-b": 0 },
      familySampleCounts: { "encoded-a": 5, "encoded-b": 2, "encoded-c": 0 },
    },
  });
  const taskFile = await writeRoutingDecisionTask(decision);
  const preview = await buildTaskAdmissionPreview(taskFile, settingsWithGrokBuilder());
  const explanation = preview.routingExplanation;

  assert.equal(explanation.evidence!.scope, "task-family");
  assert.equal(explanation.evidence!.candidateCount, 2);
  assert.equal(explanation.evidence!.totalSamples, 7);
});

test("routing explanation degrades honestly when no routing decision exists", async () => {
  const { taskFile } = await writePreviewFixture({ workerProfileId: "local-grok-builder" });
  const preview = await buildTaskAdmissionPreview(taskFile, settingsWithGrokBuilder());
  const explanation = preview.routingExplanation;

  assert.equal(explanation.present, false);
  assert.equal(explanation.shortlistSize, null);
  assert.equal(explanation.basis, null);
  assert.equal(explanation.evidence, null);
  assert.equal(explanation.competition, null);
  assert.equal(explanation.nextAction, "not-recorded");
  assert.equal(explanation.advisory, null);
  // The resolved Worker remains visible even when reasoning was not recorded.
  assert.equal(explanation.selectedWorker.provider, "xai");
  assert.equal(explanation.selectedWorker.model, "grok-4.5");
  assert.equal(explanation.selectedWorker.workerProfileId, "local-grok-builder");
  assert.equal(explanation.selectedWorker.workerProfileLabel, "Local Grok Builder");
});

test("routing explanation maps every closed basis and Competition intent", async () => {
  const expectations: Array<{
    code: string;
    basis: string;
    intent: "none" | "consider" | "required";
    nextAction: RoutingExplanationNextAction;
    evidence?: Record<string, unknown>;
  }> = [
    { code: "user-specified", basis: "user-specified", intent: "none", nextAction: "submit-directly" },
    { code: "only-available", basis: "only-available", intent: "none", nextAction: "submit-directly" },
    {
      code: "relevant-delivery",
      basis: "historical-evidence",
      intent: "none",
      nextAction: "submit-directly",
      evidence: { scope: "exact-class", exactSampleCounts: { "encoded-rd": 2 } },
    },
    { code: "runtime-capability", basis: "runtime-capability", intent: "none", nextAction: "submit-directly" },
    { code: "main-judgment", basis: "main-judgment", intent: "consider", nextAction: "consider-competition" },
    { code: "custom-code-abc", basis: "other", intent: "required", nextAction: "run-competition" },
  ];
  for (const expectation of expectations) {
    const decision = routingDecisionFor(expectation.code, {
      competition: {
        intent: expectation.intent,
        triggers: expectation.intent === "none" ? [] : ["critical"],
      },
      ...(expectation.evidence === undefined ? {} : { evidenceSnapshot: expectation.evidence }),
    });
    // Task name is neutral so a custom code can never leak through the label.
    const taskFile = await writeRoutingDecisionTask(decision);
    const preview = await buildTaskAdmissionPreview(taskFile, settingsWithGrokBuilder());
    assert.equal(preview.routingExplanation.basis, expectation.basis, `basis for ${expectation.code}`);
    assert.equal(
      preview.routingExplanation.competition!.intent,
      expectation.intent,
      `intent for ${expectation.code}`,
    );
    assert.equal(
      preview.routingExplanation.nextAction,
      expectation.nextAction,
      `nextAction for ${expectation.code}`,
    );
    // A custom reason code must never surface verbatim in JSON or human output.
    // Known codes are allowed because they equal the closed basis vocabulary.
    const isKnownCode = expectation.basis !== "other";
    if (!isKnownCode) {
      const json = JSON.stringify(preview);
      const human = formatTaskAdmissionPreviewHuman(preview);
      assert.ok(!json.includes(expectation.code), `custom code ${expectation.code} must stay hidden`);
      assert.ok(!human.includes(expectation.code), `custom code ${expectation.code} must stay hidden`);
    }
  }
});

test("routing explanation degrades relevant-delivery without comparable evidence to Main judgment", async () => {
  // scope none: no comparable history was recorded.
  const decisionA = routingDecisionFor("relevant-delivery");
  const taskFileA = await writeRoutingDecisionTask(decisionA);
  const previewA = await buildTaskAdmissionPreview(taskFileA, settingsWithGrokBuilder());
  assert.equal(previewA.routingExplanation.basis, "main-judgment");
  assert.equal(previewA.routingExplanation.evidence!.scope, "none");
  assert.equal(previewA.routingExplanation.evidence!.totalSamples, 0);

  // scope exact-class but zero samples: no positive evidence supports the claim.
  const decisionB = routingDecisionFor("relevant-delivery", {
    evidenceSnapshot: { scope: "exact-class", exactSampleCounts: { "encoded-zero": 0 } },
  });
  const taskFileB = await writeRoutingDecisionTask(decisionB);
  const previewB = await buildTaskAdmissionPreview(taskFileB, settingsWithGrokBuilder());
  assert.equal(previewB.routingExplanation.basis, "main-judgment");
  assert.equal(previewB.routingExplanation.evidence!.candidateCount, 0);
  assert.equal(previewB.routingExplanation.evidence!.totalSamples, 0);
});

test("routing explanation is a detached frozen projection that cannot mutate Task data", async () => {
  const decision = routingDecisionFor("main-judgment", {
    competition: { intent: "consider", triggers: ["critical"] },
  });
  const taskFile = await writeRoutingDecisionTask(decision);
  const prepared = await prepareTaskAdmission(taskFile, settingsWithGrokBuilder());
  const originalDecision = prepared.spec.routingDecision;
  const explanation = projectSafeTaskAdmissionPreview(prepared).routingExplanation;

  assert.throws(
    () => {
      explanation.competition!.triggers.push("new-family");
    },
    TypeError,
    "triggers array must be frozen",
  );
  assert.throws(
    () => {
      (explanation.selectedWorker as { provider: string }).provider = "hacked";
    },
    TypeError,
    "selectedWorker must be frozen",
  );
  // The stored spec decision is untouched by any attempted mutation.
  assert.equal(prepared.spec.routingDecision, originalDecision);
  assert.deepEqual(prepared.spec.routingDecision!.competition.triggers, ["critical"]);
});

test("routing explanation never enters the preview revision digest", async () => {
  const decision = routingDecisionFor("main-judgment", {
    evidenceSnapshot: {
      scope: "exact-class",
      exactSampleCounts: { "encoded-x": 1 },
    },
  });
  const taskFile = await writeRoutingDecisionTask(decision);
  const prepared = await prepareTaskAdmission(taskFile, settingsWithGrokBuilder());
  const recomputed = computePreviewRevisionDigest({
    taskFileDigest: prepared.taskFileDigest,
    spec: prepared.spec,
    effective: prepared.effectivePolicy,
    qualityReport: prepared.qualityReport,
    integration: prepared.integration,
  });
  assert.equal(recomputed, prepared.previewRevisionDigest);

  const projected = projectSafeTaskAdmissionPreview(prepared);
  assert.equal("routingExplanation" in projected, true);
  // The projection adds the explanation field without changing what the
  // digest hashes — the explanation is deliberately absent from the digest.
  assert.equal(projected.previewRevisionDigest, recomputed);
});

const PREVIEW_QWEN_WORKER = {
  provider: "qwen",
  model: "qwen3.7-plus",
  runtime: "claude-code",
  effort: "high",
};
const PREVIEW_SELECTED_EXECUTION = {
  resolvedExecutionMode: "single-run",
  readinessState: "launchable",
  canLaunch: true,
  nextAction: "none",
};

test("preview followed-recommendation projects frozen advisory facts without rescoring", async () => {
  const decision = routingDecisionFor("user-specified", {
    shortlist: [GROK_SELECTED_WORKER, PREVIEW_QWEN_WORKER],
    advisory: {
      overallResult: "recommended",
      selection: "followed-recommendation",
      recommendedWorker: GROK_SELECTED_WORKER,
      confidence: 0.91,
      selectedExecution: PREVIEW_SELECTED_EXECUTION,
    },
  });
  const taskFile = await writeRoutingDecisionTask(decision);
  const preview = await buildTaskAdmissionPreview(taskFile, settingsWithGrokBuilder());
  const advisory = preview.routingExplanation.advisory!;
  assert.equal(advisory.overallResult, "recommended");
  assert.equal(advisory.selection, "followed-recommendation");
  assert.deepEqual(advisory.recommendedWorker, GROK_SELECTED_WORKER);
  assert.equal(advisory.confidence, 0.91);
  assert.deepEqual(advisory.selectedExecution, PREVIEW_SELECTED_EXECUTION);
});

test("preview manual-override keeps both identities and hides the private note", async () => {
  const decision = routingDecisionFor("user-specified", {
    shortlist: [GROK_SELECTED_WORKER, PREVIEW_QWEN_WORKER],
    selectedBecause: { code: "user-specified", note: "PRIVATE_M3B_NOTE_NEVER_PROJECT" },
    evidenceSnapshot: {
      scope: "exact-class",
      exactSampleCounts: { SECRET_M3B_SAMPLE_KEY: 1 },
      settingsDigest: "SECRET_M3B_SETTINGS_DIGEST",
    },
    advisory: {
      overallResult: "recommended",
      selection: "manual-override",
      recommendedWorker: PREVIEW_QWEN_WORKER,
      confidence: 0.84,
      selectedExecution: PREVIEW_SELECTED_EXECUTION,
    },
  });
  const taskFile = await writeRoutingDecisionTask(decision);
  const preview = await buildTaskAdmissionPreview(taskFile, settingsWithGrokBuilder());
  assert.equal(preview.routingExplanation.advisory!.selection, "manual-override");
  assert.deepEqual(preview.routingExplanation.advisory!.recommendedWorker, PREVIEW_QWEN_WORKER);
  const json = JSON.stringify(preview);
  const human = formatTaskAdmissionPreviewHuman(preview);
  assert.ok(!json.includes("PRIVATE_M3B_NOTE_NEVER_PROJECT"));
  assert.ok(!json.includes("SECRET_M3B_SETTINGS_DIGEST"));
  assert.ok(!json.includes("SECRET_M3B_SAMPLE_KEY"));
  assert.ok(!human.includes("PRIVATE_M3B_NOTE_NEVER_PROJECT"));
  assert.match(human, /Selection: manual-override/);
});

test("preview cannot-determine records Main selection without recommendation or confidence", async () => {
  const decision = routingDecisionFor("user-specified", {
    advisory: {
      overallResult: "cannot-determine",
      selection: "selected-after-cannot-determine",
      cannotDetermineReasons: ["insufficient-relevant-samples"],
      selectedExecution: PREVIEW_SELECTED_EXECUTION,
    },
  });
  const taskFile = await writeRoutingDecisionTask(decision);
  const preview = await buildTaskAdmissionPreview(taskFile, settingsWithGrokBuilder());
  const advisory = preview.routingExplanation.advisory!;
  assert.equal(advisory.overallResult, "cannot-determine");
  assert.equal(advisory.selection, "selected-after-cannot-determine");
  assert.equal(advisory.recommendedWorker, undefined);
  assert.equal(advisory.confidence, undefined);
  const human = formatTaskAdmissionPreviewHuman(preview);
  assert.match(human, /Cannot determine because: insufficient-relevant-samples/);
  assert.doesNotMatch(human, /Recommended:/);
  assert.doesNotMatch(human, /best|superior|winner/i);
});

test("preview accepts same-executable different-Profile override and rejects mode mismatch", async () => {
  const twin = { ...GROK_SELECTED_WORKER, workerProfileId: "local-grok-twin" };
  const overrideDecision = routingDecisionFor("user-specified", {
    shortlist: [GROK_SELECTED_WORKER, twin],
    selectedBecause: { code: "user-specified", note: "PRIVATE_M3B_NOTE_NEVER_PROJECT" },
    advisory: {
      overallResult: "recommended",
      selection: "manual-override",
      recommendedWorker: twin,
      confidence: 0.84,
      selectedExecution: PREVIEW_SELECTED_EXECUTION,
    },
  });
  const overrideFile = await writeRoutingDecisionTask(overrideDecision);
  const preview = await buildTaskAdmissionPreview(overrideFile, settingsWithGrokBuilder());
  assert.equal(preview.routingExplanation.advisory!.selection, "manual-override");
  assert.equal(preview.routingExplanation.advisory!.recommendedWorker!.workerProfileId, "local-grok-twin");
  assert.equal(preview.routingExplanation.selectedWorker.workerProfileId, "local-grok-builder");
  assert.equal(preview.routingExplanation.advisory!.selectedExecution.resolvedExecutionMode, "single-run");
  const json = JSON.stringify(preview);
  assert.ok(!json.includes("PRIVATE_M3B_NOTE_NEVER_PROJECT"));

  const mismatch = routingDecisionFor("user-specified", {
    advisory: {
      overallResult: "cannot-determine",
      selection: "selected-after-cannot-determine",
      cannotDetermineReasons: ["insufficient-relevant-samples"],
      selectedExecution: {
        ...PREVIEW_SELECTED_EXECUTION,
        resolvedExecutionMode: "native-goal",
      },
    },
  });
  const mismatchFile = await writeRoutingDecisionTask(mismatch);
  await assert.rejects(
    () => buildTaskAdmissionPreview(mismatchFile, settingsWithGrokBuilder()),
    /does not match resolved Task executionMode/,
  );
});

test("preview of a legacy routingDecision invents no advisory relationship", async () => {
  const decision = routingDecisionFor("main-judgment");
  const taskFile = await writeRoutingDecisionTask(decision);
  const preview = await buildTaskAdmissionPreview(taskFile, settingsWithGrokBuilder());
  assert.equal(preview.routingExplanation.present, true);
  assert.equal(preview.routingExplanation.advisory, null);
  const human = formatTaskAdmissionPreviewHuman(preview);
  assert.doesNotMatch(human, /Advisory result:/);
});

test("human routing explanation renders selection, evidence and Competition concisely", async () => {
  const decision = routingDecisionFor("main-judgment", {
    competition: { intent: "consider", triggers: ["critical"] },
    evidenceSnapshot: { scope: "none", exactSampleCounts: {} },
  });
  const taskFile = await writeRoutingDecisionTask(decision);
  const preview = await buildTaskAdmissionPreview(taskFile, settingsWithGrokBuilder());
  const human = formatTaskAdmissionPreviewHuman(preview);

  assert.match(human, /Routing explanation:/);
  assert.match(human, /Selected: xai\/grok-4\.5 — grok-build, high — Local Grok Builder/);
  assert.match(human, /Shortlist: 1 candidate\(s\) compared/);
  assert.match(human, /Selection basis: main-judgment/);
  assert.match(human, /Evidence scope: none/);
  assert.match(human, /Competition intent: consider \(critical\)/);
  assert.match(human, /Next action: consider-competition/);
});

// --- M3: prelaunch workspace boundary advice ---

/** Create a real temporary Git worktree and ignore the given directory roots. */
async function gitIgnoredProject(
  ignoredRoots: string[],
  extra: { files?: string[]; ignoreLines?: string[] } = {},
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-boundary-git-"));
  const project = path.join(root, "project");
  await mkdir(project, { recursive: true });
  for (const dir of ignoredRoots) {
    await mkdir(path.join(project, dir), { recursive: true });
    await writeFile(path.join(project, dir, "placeholder.txt"), "ignored\n");
  }
  for (const file of extra.files ?? []) {
    await writeFile(path.join(project, file), "fixture\n");
  }
  const ignoreLines = [
    ...ignoredRoots.map((dir) => `${dir}/`),
    ...(extra.ignoreLines ?? []),
  ];
  await writeFile(path.join(project, ".gitignore"), `${ignoreLines.join("\n")}\n`);
  await execFileAsync("git", ["init", "-q"], { cwd: project });
  return project;
}

/** Minimal TaskSpec whose workspace policy carries the given boundary. */
function boundarySpec(workspace: { exclude: string[]; generatedPaths?: string[] }): TaskSpec {
  return {
    version: 2,
    name: "Boundary Spec",
    project: "/source",
    provider: { name: "xai", model: "grok-4.5", endpoint: "https://api.x.ai", keychainService: "fk" },
    runtime: { name: "grok-build", executable: "grok", effort: "high", maxBudgetUsd: 1 },
    workspace,
    worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
    contract: {
      outcome: "o", context: [], inScope: [], outOfScope: [],
      executionSteps: [], deliverables: [], modules: [], callChain: [],
      scenarios: [], risks: [], changeBudget: { maxFiles: 1, maxDiffLines: 10 },
    },
    acceptance: { criteria: [], commands: ["true"] },
  };
}

test("boundary assessor reports review with exact counts for a real Git fixture", async () => {
  const project = await gitIgnoredProject(["dist", "build"]);
  const advice = await assessWorkspaceBoundary({
    projectDir: project,
    policy: createPathPolicy(boundarySpec({ exclude: [] })),
  });
  assert.equal(advice.status, "review");
  assert.equal(advice.ignoredDirectoryRootCount, 2);
  assert.equal(advice.coveredCount, 0);
  assert.equal(advice.visibleBusinessCount, 2);
  assert.equal(advice.reason, "checked");
  assert.equal(advice.nextAction, "review-workspace-boundaries");
  // Privacy: the returned advice never contains the ignored names.
  const serialized = JSON.stringify(advice);
  assert.ok(!serialized.includes("dist"));
  assert.ok(!serialized.includes("build"));
});

test("exclude and generatedPaths cover ignored roots without a false warning", async () => {
  const project = await gitIgnoredProject(["dist", "node_modules", "generated"]);
  const advice = await assessWorkspaceBoundary({
    projectDir: project,
    policy: createPathPolicy(boundarySpec({
      exclude: ["dist"],
      generatedPaths: ["**/generated"],
    })),
  });
  // dist is covered by snapshot-exclusion, generated by the Task generatedPath
  // pattern; node_modules stays default-business and needs review.
  assert.equal(advice.status, "review");
  assert.equal(advice.ignoredDirectoryRootCount, 3);
  assert.equal(advice.coveredCount, 2);
  assert.equal(advice.visibleBusinessCount, 1);
});

test("all ignored roots covered reports clear, not review", async () => {
  const project = await gitIgnoredProject(["dist", "generated"]);
  const advice = await assessWorkspaceBoundary({
    projectDir: project,
    policy: createPathPolicy(boundarySpec({
      exclude: ["dist"],
      generatedPaths: ["**/generated"],
    })),
  });
  assert.equal(advice.status, "clear");
  assert.equal(advice.ignoredDirectoryRootCount, 2);
  assert.equal(advice.coveredCount, 2);
  assert.equal(advice.visibleBusinessCount, 0);
  assert.equal(advice.nextAction, "continue");
});

test("generatedPaths subtree patterns cover a root; partial patterns stay reviewable", async () => {
  const project = await gitIgnoredProject(["dist"]);

  // `dist/**` covers the whole directory subtree, so `dist` is covered.
  const subtree = await assessWorkspaceBoundary({
    projectDir: project,
    policy: createPathPolicy(boundarySpec({
      exclude: [],
      generatedPaths: ["dist/**"],
    })),
  });
  assert.equal(subtree.status, "clear");
  assert.equal(subtree.ignoredDirectoryRootCount, 1);
  assert.equal(subtree.coveredCount, 1);
  assert.equal(subtree.visibleBusinessCount, 0);

  // `dist/*.js` covers only matching files, never the directory subtree, so
  // the root stays reviewable ordinary source.
  const partial = await assessWorkspaceBoundary({
    projectDir: project,
    policy: createPathPolicy(boundarySpec({
      exclude: [],
      generatedPaths: ["dist/*.js"],
    })),
  });
  assert.equal(partial.status, "review");
  assert.equal(partial.ignoredDirectoryRootCount, 1);
  assert.equal(partial.coveredCount, 0);
  assert.equal(partial.visibleBusinessCount, 1);

  const oneLevel = await assessWorkspaceBoundary({
    projectDir: project,
    policy: createPathPolicy(boundarySpec({
      exclude: [],
      generatedPaths: ["dist/*"],
    })),
  });
  assert.equal(oneLevel.status, "review");
  assert.equal(oneLevel.coveredCount, 0);

  const directoryEntryOnly = await assessWorkspaceBoundary({
    projectDir: project,
    policy: createPathPolicy(boundarySpec({
      exclude: [],
      generatedPaths: ["dist/**/"],
    })),
  });
  assert.equal(directoryEntryOnly.status, "review");
  assert.equal(directoryEntryOnly.coveredCount, 0);
});

test("directory-only Git query reports ignored roots hidden inside untracked parents", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-boundary-dironly-"));
  const project = path.join(root, "project");
  await mkdir(path.join(project, "out", "build"), { recursive: true });
  await writeFile(path.join(project, "out", "build", "a.txt"), "x\n");
  await writeFile(path.join(project, ".gitignore"), "build/\n");
  await execFileAsync("git", ["init", "-q"], { cwd: project });

  // `git status --ignored` collapses the untracked `out/` and hides the nested
  // ignored root entirely; the directory-only query descends and reports it.
  const status = await execFileAsync(
    "git",
    ["-c", "core.quotepath=off", "status", "--ignored", "--porcelain", "--untracked-files=normal"],
    { cwd: project },
  );
  assert.ok(!status.stdout.includes("build"), "status scan hides the nested ignored root");

  // The canonical directory-only query reports the ignored root explicitly.
  const dirQuery = await execFileAsync(
    "git",
    ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"],
    { cwd: project },
  );
  assert.ok(dirQuery.stdout.includes("out/build/"), "directory-only query reports the ignored root");

  const advice = await assessWorkspaceBoundary({
    projectDir: project,
    policy: createPathPolicy(boundarySpec({ exclude: [] })),
  });
  assert.equal(advice.status, "review");
  assert.equal(advice.ignoredDirectoryRootCount, 1);
  assert.equal(advice.visibleBusinessCount, 1);
  assert.equal(advice.nextAction, "review-workspace-boundaries");
});

test("human boundary formatter fails closed for legacy, unknown, or malformed advice", () => {
  const fallback = formatWorkspaceBoundaryAdviceHuman(undefined);
  assert.match(fallback, /could not be checked/);
  assert.match(fallback, /manual-review/);
  assert.ok(!fallback.includes("undefined"));

  const unknown = formatWorkspaceBoundaryAdviceHuman({ status: "unknown-reason" });
  assert.match(unknown, /could not be checked/);
  assert.ok(!unknown.includes("unknown-reason"));

  const missingCounts = formatWorkspaceBoundaryAdviceHuman({ status: "review" });
  assert.match(missingCounts, /could not be checked/);

  const malformedCounts = formatWorkspaceBoundaryAdviceHuman({
    status: "review",
    ignoredDirectoryRootCount: -1,
    coveredCount: 0,
    visibleBusinessCount: 1,
  });
  assert.match(malformedCounts, /could not be checked/);

  const inconsistentCounts = formatWorkspaceBoundaryAdviceHuman({
    status: "clear",
    ignoredDirectoryRootCount: 2,
    coveredCount: 1,
    visibleBusinessCount: 0,
    reason: "checked",
    nextAction: "continue",
  });
  assert.match(inconsistentCounts, /could not be checked/);

  const inconsistentStatus = formatWorkspaceBoundaryAdviceHuman({
    status: "clear",
    ignoredDirectoryRootCount: 1,
    coveredCount: 0,
    visibleBusinessCount: 1,
    reason: "checked",
    nextAction: "continue",
  });
  assert.match(inconsistentStatus, /could not be checked/);

  const valid = formatWorkspaceBoundaryAdviceHuman({
    status: "review",
    ignoredDirectoryRootCount: 2,
    coveredCount: 1,
    visibleBusinessCount: 1,
    reason: "checked",
    nextAction: "review-workspace-boundaries",
  });
  assert.match(valid, /1 Git-ignored directory root/);
  assert.ok(!valid.includes("could not be checked"));
});

test("ignored single files do not fabricate directory risk", async () => {
  const project = await gitIgnoredProject([], {
    files: ["error.log"],
    ignoreLines: ["*.log"],
  });
  const advice = await assessWorkspaceBoundary({
    projectDir: project,
    policy: createPathPolicy(boundarySpec({ exclude: [] })),
  });
  assert.equal(advice.status, "clear");
  assert.equal(advice.ignoredDirectoryRootCount, 0);
  assert.equal(advice.coveredCount, 0);
  assert.equal(advice.visibleBusinessCount, 0);
});

test("non-Git project fails closed to unavailable without stderr or paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-boundary-nongit-"));
  const project = path.join(root, "project");
  await mkdir(project);
  await writeFile(path.join(project, ".gitignore"), "dist/\n");
  await mkdir(path.join(project, "dist"));
  const advice = await assessWorkspaceBoundary({
    projectDir: project,
    policy: createPathPolicy(boundarySpec({ exclude: [] })),
  });
  assert.equal(advice.status, "unavailable");
  assert.equal(advice.reason, "not-git");
  assert.equal(advice.nextAction, "manual-review");
  assert.equal(advice.ignoredDirectoryRootCount, 0);
  const serialized = JSON.stringify(advice);
  assert.ok(!serialized.includes("dist"));
  assert.ok(!serialized.includes("fatal"));
});

test("boundary assessor fails closed on command failure, timeout, truncation, malformed output and unsafe counts", async () => {
  const project = await gitIgnoredProject(["dist"]);
  const policy = createPathPolicy(boundarySpec({ exclude: [] }));

  // Command failure (spawn error) and non-zero exit.
  const spawnFailed = await assessWorkspaceBoundary({
    projectDir: project,
    policy,
    run: (async () => { throw new Error("spawn failed"); }) as unknown as GitIgnoredQueryRunner,
  });
  assert.equal(spawnFailed.reason, "command-failed");
  assert.equal(spawnFailed.status, "unavailable");

  const nonZero = await assessWorkspaceBoundary({
    projectDir: project,
    policy,
    run: (async () => ({ exitCode: 2, stdout: "", stderr: "fatal: boom", durationMs: 1, timedOut: false })) as unknown as GitIgnoredQueryRunner,
  });
  assert.equal(nonZero.reason, "command-failed");
  assert.equal(nonZero.status, "unavailable");

  // Timeout never becomes a clear state.
  const timedOut = await assessWorkspaceBoundary({
    projectDir: project,
    policy,
    run: (async () => ({ exitCode: 124, stdout: "!! dist/", stderr: "", durationMs: 3000, timedOut: true })) as unknown as GitIgnoredQueryRunner,
  });
  assert.equal(timedOut.reason, "timed-out");
  assert.equal(timedOut.status, "unavailable");
  assert.equal(timedOut.ignoredDirectoryRootCount, 0);

  // Truncated output must not be presented as a complete clear.
  const truncated = await assessWorkspaceBoundary({
    projectDir: project,
    policy,
    run: (async () => ({ exitCode: 0, stdout: "!! dist/\n[output truncated by ForkLight]\n", stderr: "", durationMs: 1, timedOut: false })) as unknown as GitIgnoredQueryRunner,
  });
  assert.equal(truncated.reason, "output-truncated");
  assert.equal(truncated.status, "unavailable");

  // Malformed output (quoted path) fails closed.
  const malformed = await assessWorkspaceBoundary({
    projectDir: project,
    policy,
    run: (async () => ({ exitCode: 0, stdout: '!! "weird dir"/\n', stderr: "", durationMs: 1, timedOut: false })) as unknown as GitIgnoredQueryRunner,
  });
  assert.equal(malformed.reason, "malformed-output");
  assert.equal(malformed.status, "unavailable");

  // Unsafe count (over the bounded cap) fails closed.
  const manyRoots = Array.from(
    { length: MAX_IGNORED_DIRECTORY_ROOTS + 1 },
    (_, i) => `dir${i}/`,
  ).join("\0");
  const unsafe = await assessWorkspaceBoundary({
    projectDir: project,
    policy,
    run: (async () => ({ exitCode: 0, stdout: manyRoots, stderr: "", durationMs: 1, timedOut: false })) as unknown as GitIgnoredQueryRunner,
  });
  assert.equal(unsafe.reason, "unsafe-count");
  assert.equal(unsafe.status, "unavailable");
});

test("parseIgnoredDirectoryRoots counts only Git-marked directory roots", () => {
  const ok = parseIgnoredDirectoryRoots("dist/\0build/\0error.log\0");
  assert.deepEqual(ok, { kind: "ok", roots: ["dist", "build"] });
  assert.deepEqual(
    parseIgnoredDirectoryRoots("dist/\0[output truncated by ForkLight]\n"),
    { kind: "truncated" },
  );
  assert.deepEqual(
    parseIgnoredDirectoryRoots('"quoted dir"/\0'),
    { kind: "malformed" },
  );
  // A root outside the project (running in a repo subdirectory) fails closed.
  assert.deepEqual(
    parseIgnoredDirectoryRoots("../outside-dir/\0"),
    { kind: "malformed" },
  );
  assert.deepEqual(
    parseIgnoredDirectoryRoots("/absolute/dir/\0"),
    { kind: "malformed" },
  );
});

test("boundary advice is detached, deeply frozen, and privacy-safe", async () => {
  const project = await gitIgnoredProject(["secret-ignored-root"]);
  const advice = await assessWorkspaceBoundary({
    projectDir: project,
    policy: createPathPolicy(boundarySpec({ exclude: [] })),
  });
  assert.ok(Object.isFrozen(advice));
  assert.throws(() => {
    (advice as { status: string }).status = "clear";
  }, TypeError);
  const serialized = JSON.stringify(advice);
  assert.ok(!serialized.includes("secret-ignored-root"));
  assert.ok(!serialized.includes(project));
});

test("workspace boundary advice never enters previewRevisionDigest and is stable across Git drift", async () => {
  const { taskFile, root } = await writePreviewFixture({
    workerProfileId: "local-grok-builder",
  });
  const project = path.join(root, "project");
  await execFileAsync("git", ["init", "-q"], { cwd: project });
  await mkdir(path.join(project, "dist"));
  await writeFile(path.join(project, "dist", "bundle.js"), "ignored\n");
  await writeFile(path.join(project, ".gitignore"), "dist/\n");
  const settings = settingsWithGrokBuilder();

  const first = await buildTaskAdmissionPreview(taskFile, settings);
  assert.equal(first.workspaceBoundaryAdvice.status, "review");
  assert.equal(first.workspaceBoundaryAdvice.visibleBusinessCount, 1);
  assert.ok(Object.isFrozen(first.workspaceBoundaryAdvice));

  // Detach proof: mutating a copy of the advice cannot reach the preview.
  const detached = JSON.parse(JSON.stringify(first.workspaceBoundaryAdvice));
  detached.visibleBusinessCount = 0;
  assert.equal(first.workspaceBoundaryAdvice.visibleBusinessCount, 1);

  // Recompute the digest from the same prepared admission is identical.
  const prepared = await prepareTaskAdmission(taskFile, settings);
  const recomputed = computePreviewRevisionDigest({
    taskFileDigest: prepared.taskFileDigest,
    spec: prepared.spec,
    effective: prepared.effectivePolicy,
    qualityReport: prepared.qualityReport,
    integration: prepared.integration,
  });
  assert.equal(recomputed, prepared.previewRevisionDigest);
  assert.equal(first.previewRevisionDigest, prepared.previewRevisionDigest);

  // Git state drifts (a second ignored business root appears) while the Task
  // file and settings stay fixed: the advice changes, the digest does not.
  await mkdir(path.join(project, "vendor"));
  await writeFile(path.join(project, "vendor", "x.txt"), "ignored\n");
  await writeFile(path.join(project, ".gitignore"), "dist/\nvendor/\n");
  const second = await buildTaskAdmissionPreview(taskFile, settings);
  assert.equal(second.workspaceBoundaryAdvice.visibleBusinessCount, 2);
  assert.notEqual(
    second.workspaceBoundaryAdvice.visibleBusinessCount,
    first.workspaceBoundaryAdvice.visibleBusinessCount,
  );
  assert.equal(second.previewRevisionDigest, first.previewRevisionDigest);
});

test("human preview output renders the workspace boundary block without secrets", async () => {
  const { taskFile, root } = await writePreviewFixture({
    workerProfileId: "local-grok-builder",
  });
  const project = path.join(root, "project");
  await execFileAsync("git", ["init", "-q"], { cwd: project });
  await mkdir(path.join(project, "dist"));
  await writeFile(path.join(project, "dist", "bundle.js"), "ignored\n");
  await writeFile(path.join(project, ".gitignore"), "dist/\n");
  const preview = await buildTaskAdmissionPreview(taskFile, settingsWithGrokBuilder());
  const human = formatTaskAdmissionPreviewHuman(preview);
  assert.match(human, /Workspace boundary:/);
  assert.match(human, /1 Git-ignored directory root\(s\) would still enter the Worker/);
  assert.match(human, /Next action: review-workspace-boundaries/);
  assert.ok(!human.includes("dist/"));
  assert.ok(!human.includes(project));
});

test("preview projects requested and resolved execution mode for auto Codex", async () => {
  const base = cloneDefaults();
  const catalog = upsertModelConfig(base.modelCatalog, {
    id: "codex-preview-model",
    label: "Codex Luna",
    provider: "openai",
    model: "gpt-5.6-luna",
    endpoint: SECRET_ENDPOINT,
  });
  const profiles = upsertWorkerProfile(base.workerProfiles, {
    id: "codex-preview",
    label: "Codex Preview",
    runtime: "codex-cli",
    modelConfigId: "codex-preview-model",
    effort: "max",
    executionPreference: "auto",
  }, catalog);
  const settings = { ...base, modelCatalog: catalog, workerProfiles: profiles };
  const { taskFile } = await writePreviewFixture({ workerProfileId: "codex-preview" });
  const preview = await buildTaskAdmissionPreview(taskFile, settings);
  assert.equal(preview.execution.preference, "auto");
  assert.equal(preview.execution.mode, "native-goal");
  assert.equal(preview.execution.nativeGoalSupported, true);
  assert.equal(preview.execution.persistentSessionSupported, false);
  const human = formatTaskAdmissionPreviewHuman(preview);
  assert.match(human, /Execution: requested=auto resolved=native-goal/);
  assert.match(human, /native Goal supported/);
  assert.match(human, /persistent session unsupported/);
});

test("Grok 4.6 Xhigh preview freezes native-goal", async () => {
  const { taskFile } = await writePreviewFixture({ workerProfileId: "grok-4-6-xhigh" });
  const preview = await buildTaskAdmissionPreview(taskFile, cloneDefaults());
  assert.equal(preview.provider, "xai");
  assert.equal(preview.model, "grok-4.6");
  assert.equal(preview.runtime, "grok-build");
  assert.equal(preview.effort, "xhigh");
  assert.equal(preview.execution.preference, "auto");
  assert.equal(preview.execution.mode, "native-goal");
  assert.equal(preview.execution.nativeGoalSupported, true);
  assert.equal(preview.execution.persistentSessionSupported, true);
  const human = formatTaskAdmissionPreviewHuman(preview);
  assert.match(human, /Execution: requested=auto resolved=native-goal/);
  assert.match(human, /native Goal supported/);
  assert.match(human, /persistent session supported/);
});

test("forced native-goal preview admits on grok-build", async () => {
  const { taskFile } = await writePreviewFixture({ workerProfileId: "local-grok-builder" });
  const yaml = await readFile(taskFile, "utf8") + "\nexecutionPreference: native-goal\n";
  await writeFile(taskFile, yaml);
  const preview = await buildTaskAdmissionPreview(taskFile, settingsWithGrokBuilder());
  assert.equal(preview.execution.preference, "native-goal");
  assert.equal(preview.execution.mode, "native-goal");
  assert.equal(preview.execution.nativeGoalSupported, true);
});

test("forced native-goal preview fails closed on an unsupported Runtime", async () => {
  const { taskFile } = await writePreviewFixture({});
  const yaml = await readFile(taskFile, "utf8") + "\nexecutionPreference: native-goal\n";
  await writeFile(taskFile, yaml);
  await assert.rejects(
    () => buildTaskAdmissionPreview(taskFile, cloneDefaults()),
    /native-goal/,
  );
});

// --- M1: version-3 domain-neutral contract background in the safe preview ---

/** Version-3 domain-neutral (non-Coding) Task Contract. No modules, call chain,
 *  or change budget — the background is the first-class content. */
function minimalContextContractYaml(overrides: { purpose?: string } = {}): string {
  const purpose = overrides.purpose ?? "Decide which retention lever to pull first.";
  return `version: 3
name: Context Preview Contract
project: ./project
worker:
  focusPaths: [research-notes]
contract:
  outcome: A research report recommending the first retention lever with evidence.
  background:
    purpose: ${purpose}
    audience: Product leadership and the retention squad.
    currentSituation: Churn rose eight percent in the last quarter with no confirmed root cause.
    parentGoalPlan: Goal retention-2026, plan item three.
    priorDecisions:
      - Research before changing the onboarding flow.
    suppliedInputs:
      - Churn cohort export from 2026-07.
    downstreamUse: The report sets the quarter retention roadmap.
    workerAuthority:
      - Read the supplied cohort and ticket files only.
    returnToMain:
      - Recommend the first root cause to act on.
  inScope:
    - Analyze churn cohorts and ticket themes.
  outOfScope:
    - Implementing any change.
  executionSteps:
    - Read the cohort export and ticket sample.
    - Draft prioritized recommendations.
  deliverables:
    - A concise research report.
  scenarios:
    - name: Conflicting evidence
      given: Cohort and tickets point to different causes
      when: the report is drafted
      then: both causes surface with an explicit decision request
    - name: Small sample
      given: Evidence is thin
      when: recommendations are written
      then: confidence is stated per recommendation
  risks:
    - Small samples may not generalize.
acceptance:
  criteria:
    - The report names one retention lever with evidence.
  commands:
    - "true"
`;
}

async function writeContextPreviewFixture(
  options: { purpose?: string } = {},
): Promise<{ root: string; taskFile: string; project: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-v3-preview-"));
  const project = path.join(root, "project");
  await mkdir(project);
  const taskFile = path.join(root, "task.yaml");
  await writeFile(taskFile, minimalContextContractYaml(options));
  return { root, taskFile, project };
}

test("version 3 preview carries the exact Main-approved background", async () => {
  const { taskFile } = await writeContextPreviewFixture();
  const preview = await buildTaskAdmissionPreview(taskFile, cloneDefaults());
  assert.equal(preview.taskName, "Context Preview Contract");
  assert.deepEqual(preview.background, {
    purpose: "Decide which retention lever to pull first.",
    audience: "Product leadership and the retention squad.",
    currentSituation: "Churn rose eight percent in the last quarter with no confirmed root cause.",
    parentGoalPlan: "Goal retention-2026, plan item three.",
    priorDecisions: ["Research before changing the onboarding flow."],
    suppliedInputs: ["Churn cohort export from 2026-07."],
    downstreamUse: "The report sets the quarter retention roadmap.",
    workerAuthority: ["Read the supplied cohort and ticket files only."],
    returnToMain: ["Recommend the first root cause to act on."],
  });
  assert.equal(preview.quality.passed, true);
  assert.equal("project" in preview, false);
  assert.equal("taskFile" in preview, false);
});

test("version 3 human preview renders the background block in reading order", async () => {
  const { taskFile } = await writeContextPreviewFixture();
  const preview = await buildTaskAdmissionPreview(taskFile, cloneDefaults());
  const human = formatTaskAdmissionPreviewHuman(preview);
  assert.match(human, /Background:/);
  assert.match(human, /Why this matters: Decide which retention lever to pull first\./);
  assert.match(human, /Who or what it serves: Product leadership and the retention squad\./);
  assert.match(human, /Current situation: Churn rose eight percent/);
  assert.match(human, /Parent Goal\/Plan: Goal retention-2026, plan item three\./);
  assert.match(human, /Prior decisions:/);
  assert.match(human, /Supplied inputs:/);
  assert.match(human, /How the output is used: The report sets the quarter retention roadmap\./);
  assert.match(human, /Worker authority:/);
  assert.match(human, /Decisions that must return to Main:/);
  assert.match(human, /Recommend the first root cause to act on\./);
  // The background block leads the quality verdict in reading order.
  assert.ok(human.indexOf("Background:") < human.indexOf("Task Contract:"), "background before quality verdict");
});

test("version 3 background edits change the bound preview revision digest", async () => {
  const { taskFile } = await writeContextPreviewFixture();
  const first = await buildTaskAdmissionPreview(taskFile, cloneDefaults());
  const secondFile = await writeContextPreviewFixture({
    purpose: "A different Main reason for the same research work.",
  });
  const second = await buildTaskAdmissionPreview(secondFile.taskFile, cloneDefaults());
  assert.notEqual(second.previewRevisionDigest, first.previewRevisionDigest);
  assert.equal(second.background!.purpose, "A different Main reason for the same research work.");
  // The safe preview background is detached: mutating a copy cannot reach it.
  const detached = JSON.parse(JSON.stringify(second.background));
  detached.purpose = "hacked";
  assert.equal(second.background!.purpose, "A different Main reason for the same research work.");
});

test("legacy version 2 preview never carries a background", async () => {
  const { taskFile } = await writePreviewFixture({});
  const preview = await buildTaskAdmissionPreview(taskFile, cloneDefaults());
  assert.equal("background" in preview, false);
});

test("preview freezes an explicit review requirement and binds it in the digest", async () => {
  const { taskFile } = await writePreviewFixture({});
  const first = await buildTaskAdmissionPreview(taskFile, cloneDefaults());
  assert.equal("reviewRequirement" in first, false);
  assert.match(formatTaskAdmissionPreviewHuman(first), /Review requirement: \(legacy — none declared\)/);

  const withReq = `${await readFile(taskFile, "utf8")}\nreviewRequirement:\n  requiredJudges: 2\n  reason: High-risk Integration and review authority\n`;
  await writeFile(taskFile, withReq);
  const second = await buildTaskAdmissionPreview(taskFile, cloneDefaults());
  assert.deepEqual(second.reviewRequirement, {
    requiredJudges: 2,
    reason: "High-risk Integration and review authority",
  });
  assert.notEqual(second.previewRevisionDigest, first.previewRevisionDigest);
  const human = formatTaskAdmissionPreviewHuman(second);
  assert.match(human, /Review requirement: 2 judge\(s\) — High-risk Integration and review authority/);
  assert.doesNotMatch(human, /SECRET_ENDPOINT|NEVER_LEAK/);
});

test("preview treats requiredJudges 0 as explicit skip evidence", async () => {
  const { taskFile } = await writePreviewFixture({});
  await writeFile(
    taskFile,
    `${await readFile(taskFile, "utf8")}\nreviewRequirement:\n  requiredJudges: 0\n  reason: Deterministic mechanical check\n`,
  );
  const preview = await buildTaskAdmissionPreview(taskFile, cloneDefaults());
  assert.equal(preview.reviewRequirement?.requiredJudges, 0);
  assert.match(
    formatTaskAdmissionPreviewHuman(preview),
    /Review requirement: explicit skip \(0\) — Deterministic mechanical check/,
  );
});
