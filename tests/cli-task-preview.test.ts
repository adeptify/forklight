import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  buildTaskAdmissionPreview,
  formatTaskAdmissionPreviewHuman,
  taskPolicyFromSettings,
} from "../src/core/task-preview.js";
import { cloneDefaults, SettingsService } from "../src/core/settings.js";
import { upsertModelConfig } from "../src/core/model-catalog.js";
import { upsertWorkerProfile } from "../src/core/worker-profiles.js";
import { loadTaskSpec } from "../src/core/task.js";
import { StateStore } from "../src/state/store.js";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

function unavailableAuthCliSettings() {
  const base = cloneDefaults();
  const catalog = upsertModelConfig(base.modelCatalog, {
    id: "cli-qwen-no-auth",
    label: "CLI Qwen no-auth fixture",
    provider: "qwen",
    model: "qwen3.7-plus",
    endpoint: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
  });
  const profiles = upsertWorkerProfile(base.workerProfiles, {
    id: "custom-qwen-worker",
    label: "Custom Qwen Worker",
    runtime: "claude-code",
    modelConfigId: "cli-qwen-no-auth",
    effort: "medium",
    maxBudgetUsd: null,
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

test("forklight run resolves saved custom Worker Profile past parsing to authentication preflight", async () => {
  const settings = unavailableAuthCliSettings();
  const home = await mkdtemp(path.join(tmpdir(), "forklight-run-profile-"));
  const taskDir = await mkdtemp(path.join(tmpdir(), "forklight-run-task-"));
  try {
    // Persist settings with the custom Worker Profile to the isolated home so
    // the CLI subprocess reads the saved profile.
    const store = new StateStore(home);
    try {
      const svc = new SettingsService(store);
      svc.update({
        workerProfiles: settings.workerProfiles,
        modelCatalog: settings.modelCatalog,
      });
    } finally {
      store.close();
    }

    // Task file with workerProfileId referencing the custom saved profile.
    const taskFile = path.join(taskDir, "task.yaml");
    await mkdir(path.join(taskDir, "project"));
    await writeFile(
      taskFile,
      `version: 2
name: Run Profile Parity
project: ./project
workerProfileId: custom-qwen-worker
worker:
  focusPaths: [src]
contract:
  outcome: Resolve saved profile
  context: [settings]
  inScope: [parse]
  outOfScope: [submit]
  executionSteps: [parse]
  deliverables: [parse]
  modules:
    - name: cli
      responsibility: resolve profile
      consumes: [settings]
      produces: [identity]
      boundaries: [no auth]
  callChain: [cli, parse]
  scenarios:
    - name: custom
      given: saved profile
      when: run
      then: resolve profile past parsing to auth preflight
    - name: no auth
      given: credential command is unavailable in the isolated child process
      when: launch preflight checks the selected provider
      then: stop before workspace preparation and Worker execution
  risks: [profile drift]
  changeBudget:
    maxFiles: 1
    maxDiffLines: 10
acceptance:
  criteria: [agree]
  commands:
    - "true"
`,
    );

    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        "--disable-warning=ExperimentalWarning",
        "--import", "tsx",
        path.join(projectRoot, "src", "cli.ts"),
        "run", taskFile,
      ],
      {
        // The child uses an empty PATH, so the macOS `security` command and
        // Worker executable cannot be discovered. The absolute Node executable
        // still starts the CLI, and authentication preflight must stop before
        // either workspace preparation or Provider execution.
        env: { ...process.env, FORKLIGHT_HOME: home, PATH: path.join(home, "empty-bin") },
        timeout: 15_000,
        cwd: projectRoot,
      },
    ).catch((error: unknown) => {
      const execError = error as { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: execError.stdout ?? "",
        stderr: execError.stderr ?? "",
        code: execError.code ?? 1,
      };
    });

    const combined = stdout + stderr;
    // Must resolve the saved custom Worker Profile — never report unknown.
    assert.doesNotMatch(
      combined,
      /Unknown worker profile/,
      "forklight run must resolve the saved custom Worker Profile without rejecting it as unknown",
    );
    // Must print a taskId, proving the profile was resolved and task registered.
    assert.match(
      combined,
      /taskId:/,
      "forklight run must register the Task with the exact resolved Worker identity",
    );
    // Must fail at the selected Provider's authentication preflight, never at Provider execution.
    assert.match(
      combined,
      /authentication is not readable/,
      "forklight run must stop at authentication preflight before workspace/Worker execution",
    );

    const auditStore = new StateStore(home);
    try {
      const tasks = auditStore.listTasks();
      assert.equal(tasks.length, 1);
      const task = tasks[0];
      assert.ok(task);
      assert.equal(task.status, "failed");
      assert.equal(task.spec.workerProfileId, "custom-qwen-worker");
      assert.equal(task.spec.provider.name, "qwen");
      assert.equal(task.spec.provider.model, "qwen3.7-plus");
      assert.equal(task.spec.runtime.name, "claude-code");
      assert.equal(auditStore.listAttempts(task.id).length, 0, "preflight must not create an Attempt");
    } finally {
      auditStore.close();
    }

    const planFile = path.join(taskDir, "plan.json");
    await writeFile(planFile, JSON.stringify({
      version: 1,
      name: "Saved Worker parity plan",
      objective: "Validate one Task with the same saved custom Worker Profile.",
      items: [
        { id: "custom-worker-a", task: taskFile, dependsOn: [] },
        { id: "custom-worker-b", task: taskFile, dependsOn: [] },
      ],
    }));
    const planResult = await execFileAsync(
      process.execPath,
      [
        "--disable-warning=ExperimentalWarning",
        "--import", "tsx",
        path.join(projectRoot, "src", "cli.ts"),
        "validate-plan", planFile,
      ],
      {
        env: { ...process.env, FORKLIGHT_HOME: home, PATH: path.join(home, "empty-bin") },
        timeout: 15_000,
        cwd: projectRoot,
      },
    );
    assert.match(planResult.stdout, /Work Plan: PASS/);
    assert.doesNotMatch(planResult.stdout + planResult.stderr, /Unknown worker profile/);
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
    await rm(taskDir, { recursive: true, force: true }).catch(() => undefined);
  }
});
