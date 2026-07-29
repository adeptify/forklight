import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";
import { OnboardingSampleService } from "../src/onboarding/sample-task.js";
import { StateStore } from "../src/state/store.js";
import { SettingsService } from "../src/core/settings.js";
import { loadTaskSpec } from "../src/core/task.js";
import { taskPolicyFromSettings } from "../src/core/task-preview.js";

const SAMPLE_ID = "sample_0123456789abcdef0123456789abcdef";

async function packageFixture(root: string): Promise<void> {
  const fixture = path.join(root, "fixtures", "checkout");
  await mkdir(path.join(fixture, "tests"), { recursive: true });
  await writeFile(path.join(fixture, "checkout.py"), "def calculate_total():\n    return 1\n");
  await writeFile(path.join(fixture, "README.md"), "# sample\n");
  await writeFile(path.join(fixture, "tests", "test_checkout.py"), "import unittest\n");
}

test("prepares one owner-only packaged sample and a Worker-profile-only ordinary Task", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-sample-package-"));
  const samples = path.join(root, "private-samples");
  await packageFixture(root);
  const service = new OnboardingSampleService(root, samples, () => SAMPLE_ID, () => new Date("2026-07-28T00:00:00.000Z"));
  const prepared = await service.prepare("deepseek-worker");

  assert.equal(prepared.sampleId, SAMPLE_ID);
  assert.equal(prepared.workerProfileId, "deepseek-worker");
  assert.equal(prepared.state, "prepared");
  assert.equal((await lstat(samples)).mode & 0o777, 0o700);
  assert.equal((await lstat(path.join(samples, SAMPLE_ID))).mode & 0o777, 0o700);
  assert.equal((await lstat(prepared.taskFile)).mode & 0o777, 0o600);

  const task = YAML.parse(await readFile(prepared.taskFile, "utf8")) as Record<string, unknown>;
  assert.equal(task.workerProfileId, "deepseek-worker");
  assert.equal(task.project, "./project");
  for (const forbidden of [
    "provider", "model", "runtime", "endpoint", "pricingRoute", "deliveryProfileId",
    "advancedPolicy", "maxBudgetUsd", "maxDurationMs", "maxAttempts",
  ]) {
    assert.equal(Object.hasOwn(task, forbidden), false, forbidden);
  }
  const project = path.join(samples, SAMPLE_ID, "project");
  assert.deepEqual((await readdir(project)).sort(), ["README.md", "checkout.py", "tests"]);
  assert.deepEqual(await readdir(path.join(project, "tests")), ["test_checkout.py"]);
});

test("submission state survives service restart and duplicate start returns the original Task", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-sample-restart-"));
  const samples = path.join(root, "samples");
  await packageFixture(root);
  const first = new OnboardingSampleService(root, samples, () => SAMPLE_ID, () => new Date("2026-07-28T00:00:00.000Z"));
  await first.prepare("minimax-worker");

  const restarted = new OnboardingSampleService(root, samples, undefined, () => new Date("2026-07-28T00:01:00.000Z"));
  assert.equal((await restarted.latest())?.state, "prepared");
  const lease = await restarted.acquireSubmission(SAMPLE_ID);
  assert.equal(lease.alreadySubmitted, false);
  assert.equal(lease.sample.state, "submitting");
  const submitted = await lease.commit("task-guided-1");
  assert.equal(submitted.state, "submitted");
  assert.equal(submitted.taskId, "task-guided-1");

  const afterRestart = new OnboardingSampleService(root, samples);
  const latest = await afterRestart.latest();
  assert.equal(latest?.state, "submitted");
  assert.equal(latest?.taskId, "task-guided-1");
  const duplicate = await afterRestart.acquireSubmission(SAMPLE_ID);
  assert.equal(duplicate.alreadySubmitted, true);
  assert.equal(duplicate.sample.taskId, "task-guided-1");
});

test("generated sample passes canonical admission using the selected saved Worker", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-sample-admission-"));
  await packageFixture(root);
  const service = new OnboardingSampleService(root, path.join(root, "samples"), () => SAMPLE_ID);
  const prepared = await service.prepare("default");
  const store = new StateStore(path.join(root, "state"));
  try {
    const settings = new SettingsService(store).get();
    const loaded = await loadTaskSpec(prepared.taskFile, taskPolicyFromSettings(settings));
    assert.equal(loaded.spec.workerProfileId, "default");
    assert.equal(loaded.spec.provider.name, "deepseek");
    assert.equal(loaded.spec.runtime.name, "claude-code");
    assert.equal(loaded.spec.version, 2);
    if (loaded.spec.version !== 2) assert.fail("guided sample must use a v2 Task Contract");
    assert.equal(loaded.spec.contract.scenarios.length, 2);
    assert.equal(loaded.spec.acceptance.commands.length, 1);
  } finally {
    store.close();
  }
});

test("a rejected daemon submission returns the sample to prepared without creating another sample", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-sample-abort-"));
  const samples = path.join(root, "samples");
  await packageFixture(root);
  const service = new OnboardingSampleService(root, samples, () => SAMPLE_ID);
  await service.prepare("worker-a");
  const lease = await service.acquireSubmission(SAMPLE_ID);
  await lease.abort();
  assert.equal((await service.get(SAMPLE_ID)).state, "prepared");
  assert.deepEqual((await readdir(samples)).filter((name) => name.startsWith("sample_")), [SAMPLE_ID]);
});

test("unsafe packaged evidence fails closed without a reported or partial sample", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forklight-sample-unsafe-"));
  const samples = path.join(root, "samples");
  await packageFixture(root);
  const outside = path.join(root, "outside.py");
  await writeFile(outside, "unsafe\n");
  const checkout = path.join(root, "fixtures", "checkout", "checkout.py");
  await unlink(checkout);
  await symlink(outside, checkout);
  const service = new OnboardingSampleService(root, samples, () => SAMPLE_ID);
  await assert.rejects(
    service.prepare("worker-a"),
    /Packaged sample is unavailable or unsafe/,
  );
  assert.deepEqual((await readdir(samples)).filter((name) => !name.startsWith(".creating-")), []);
  assert.equal(await service.latest(), undefined);
});
