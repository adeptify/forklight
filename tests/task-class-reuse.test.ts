/**
 * Core preview-bound taskClass reuse: file safety, single-field semantics,
 * format preservation, and no-side-effect behavior. The daemon owns the
 * same-path serialization gate; this file proves the Core operation itself is
 * fail-closed against stale, forged, repeated and unsafe-path requests.
 */
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { cloneDefaults } from "../src/core/settings.js";
import { applyReusedTaskClass } from "../src/core/task-class-reuse.js";
import { buildTaskAdmissionPreview } from "../src/core/task-preview.js";
import type { RoutingDecisionSnapshot, TaskRecord, TaskSpec } from "../src/core/types.js";
import YAML from "yaml";

function validRoutingDecision(taskFamily = "refactor"): RoutingDecisionSnapshot {
  const worker = {
    provider: "deepseek",
    model: "deepseek-v4-flash",
    runtime: "claude-code",
    effort: "medium",
  };
  return {
    taskFamily,
    shortlist: [worker],
    selectedWorker: worker,
    selectedBecause: { code: "user-specified", note: "stored decision for classification advice" },
    competition: { intent: "none", triggers: [] },
    evidenceSnapshot: { scope: "none", exactSampleCounts: {} },
  };
}

/** Minimal stored TaskRecord for terminal ordinary classification history. */
function storedTask(
  id: string,
  status: "succeeded" | "failed",
  taskClass: string,
  taskFamily: string,
  hasDecision = true,
): TaskRecord {
  const spec: TaskSpec = {
    version: 2,
    name: id,
    project: "/source",
    provider: { name: "deepseek", model: "deepseek-v4-flash", endpoint: "https://api.deepseek.com", keychainService: "fk" },
    runtime: { name: "claude-code", executable: "claude", effort: "medium", maxBudgetUsd: 1 },
    workspace: { exclude: [] },
    worker: { allowEdits: true, allowedCommands: [], focusPaths: [] },
    contract: {
      outcome: "o", context: [], inScope: [], outOfScope: [],
      executionSteps: [], deliverables: [], modules: [], callChain: [],
      scenarios: [], risks: [], changeBudget: { maxFiles: 1, maxDiffLines: 10 },
    },
    acceptance: { criteria: [], commands: ["true"] },
    ...(hasDecision ? { routingDecision: validRoutingDecision(taskFamily) } : {}),
    taskClass,
    taskFamily,
  };
  return {
    id,
    name: id,
    status,
    sourcePath: "/source",
    taskFile: `/tasks/${id}.yaml`,
    spec,
    paths: { root: "/x", baseline: "/x", workspace: "/x", logs: "/x", claudeConfig: "/x", diff: "/x" },
    sessionId: `session-${id}`,
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
  };
}

const REFACTOR_HISTORY: TaskRecord[] = [
  storedTask("hist-1", "succeeded", "migration", "refactor", true),
  storedTask("hist-2", "succeeded", "lint-fix", "refactor", false),
];

const YAML_DRAFT = `version: 2
name: Core Reuse Preview
project: ./project
# this comment must survive the draft-only class reuse
taskFamily: refactor
worker:
  focusPaths: [src]
contract:
  outcome: Reuse a same-family class through the draft-only operation
  context: [history]
  inScope: [class]
  outOfScope: [submit]
  executionSteps: [apply]
  deliverables: [preview]
  modules:
    - name: core
      responsibility: apply one exact class to the draft
      consumes: [path, digest, class]
      produces: [fresh preview]
      boundaries: [no Task]
  callChain: [hub, daemon, core]
  scenarios:
    - name: reuse
      given: missing class
      when: confirmed
      then: class changes
    - name: stale
      given: stale preview digest
      when: confirmed
      then: reject before write
  risks: [stale]
  changeBudget:
    maxFiles: 4
    maxDiffLines: 100
acceptance:
  criteria: [safe]
  commands:
    - "true"
`;

async function makeDraft(): Promise<{ root: string; taskFile: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "fl-class-reuse-"));
  await mkdir(path.join(root, "project"), { recursive: true });
  const taskFile = path.join(root, "task.yaml");
  await writeFile(taskFile, YAML_DRAFT, "utf8");
  return { root, taskFile };
}

async function previewDigestFor(taskFile: string): Promise<string> {
  // The daemon/Hub use prepareTaskAdmission; here the Core operation's own
  // success digest is derived from the same canonical preview builder.
  const preview = await buildTaskAdmissionPreview(taskFile, cloneDefaults(), REFACTOR_HISTORY);
  return preview.previewRevisionDigest;
}

function assertNoTempFiles(dir: string): void {
  const entries = readdirSync(dir);
  assert.ok(
    !entries.some((entry) => entry.includes(".forklight-reuse-")),
    `no temporary class-reuse artifacts left in ${dir}: ${entries.join(", ")}`,
  );
}

test("safe successful reuse changes only root taskClass and preserves comments", async () => {
  const { root, taskFile } = await makeDraft();
  try {
    const digest = await previewDigestFor(taskFile);
    const result = await applyReusedTaskClass({
      taskFileInput: taskFile,
      expectedPreviewRevisionDigest: digest,
      taskClass: "migration",
      settings: cloneDefaults(),
      tasks: REFACTOR_HISTORY,
    });
    const written = await readFile(taskFile, "utf8");
    assert.ok(written.includes("# this comment must survive"), "YAML comment preserved");
    assert.ok(written.includes("taskClass: migration"), "class line written");
    const parsed = YAML.parse(written) as { taskClass: string; taskFamily: string };
    assert.equal(parsed.taskClass, "migration");
    assert.equal(parsed.taskFamily, "refactor");
    // Fresh preview is canonical and says the class is now existing.
    assert.equal(result.preview.taskName, "Core Reuse Preview");
    assert.equal(result.preview.classificationAdvice.taskClass.state, "existing");
    assert.equal(result.preview.previewRevisionDigest.length, 64);
    assert.notEqual(result.preview.previewRevisionDigest, digest);
    assertNoTempFiles(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("safe successful reuse of a missing class adds only the root taskClass", async () => {
  const { root, taskFile } = await makeDraft();
  try {
    const digest = await previewDigestFor(taskFile);
    const before = YAML.parse(await readFile(taskFile, "utf8")) as Record<string, unknown>;
    delete before.taskClass;
    const result = await applyReusedTaskClass({
      taskFileInput: taskFile,
      expectedPreviewRevisionDigest: digest,
      taskClass: "lint-fix",
      settings: cloneDefaults(),
      tasks: REFACTOR_HISTORY,
    });
    const after = YAML.parse(await readFile(taskFile, "utf8")) as Record<string, unknown>;
    assert.equal(after.taskClass, "lint-fix");
    assert.deepEqual(
      JSON.parse(JSON.stringify(after, (key, value) => key === "taskClass" ? undefined : value)),
      JSON.parse(JSON.stringify(before)),
    );
    assert.equal(result.preview.classificationAdvice.taskClass.state, "existing");
    assertNoTempFiles(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("JSON contract stays JSON with every non-taskClass parsed field unchanged", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-class-reuse-json-"));
  await mkdir(path.join(root, "project"), { recursive: true });
  const taskFile = path.join(root, "task.json");
  const jsonContract = YAML.parse(YAML_DRAFT) as Record<string, unknown>;
  jsonContract.name = "Json Reuse Preview";
  await writeFile(taskFile, JSON.stringify(jsonContract, null, 2), "utf8");
  try {
    const digest = await previewDigestFor(taskFile);
    const result = await applyReusedTaskClass({
      taskFileInput: taskFile,
      expectedPreviewRevisionDigest: digest,
      taskClass: "migration",
      settings: cloneDefaults(),
      tasks: REFACTOR_HISTORY,
    });
    const raw = await readFile(taskFile, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(parsed.version, 2);
    assert.equal(parsed.name, "Json Reuse Preview");
    assert.equal(parsed.taskClass, "migration");
    assert.equal(parsed.taskFamily, "refactor");
    assert.equal(result.preview.classificationAdvice.taskClass.state, "existing");
    assertNoTempFiles(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stale digest rejects before write and leaves the file byte-identical", async () => {
  const { root, taskFile } = await makeDraft();
  try {
    const digest = await previewDigestFor(taskFile);
    // Change file bytes (a comment) after the preview so the old digest is stale.
    const original = await readFile(taskFile, "utf8");
    await writeFile(taskFile, `${original}\n# changed after preview\n`, "utf8");
    const beforeBytes = await readFile(taskFile, "utf8");
    await assert.rejects(
      () => applyReusedTaskClass({
        taskFileInput: taskFile,
        expectedPreviewRevisionDigest: digest,
        taskClass: "migration",
        settings: cloneDefaults(),
        tasks: REFACTOR_HISTORY,
      }),
      /out of date/,
    );
    assert.equal(await readFile(taskFile, "utf8"), beforeBytes, "real file untouched");
    assertNoTempFiles(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("forged class absent from current classChoices rejects before write", async () => {
  const { root, taskFile } = await makeDraft();
  try {
    const digest = await previewDigestFor(taskFile);
    const beforeBytes = await readFile(taskFile, "utf8");
    await assert.rejects(
      () => applyReusedTaskClass({
        taskFileInput: taskFile,
        expectedPreviewRevisionDigest: digest,
        taskClass: "not-a-choice",
        settings: cloneDefaults(),
        tasks: REFACTOR_HISTORY,
      }),
      /exact current classChoice/,
    );
    assert.equal(await readFile(taskFile, "utf8"), beforeBytes, "real file untouched");
    assertNoTempFiles(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("already-existing current class and missing/new family reject before write", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fl-class-reuse-existing-"));
  await mkdir(path.join(root, "project"), { recursive: true });
  try {
    // Current class already exists in history.
    const existing = path.join(root, "existing.yaml");
    await writeFile(existing, YAML_DRAFT.replace("taskFamily: refactor", "taskClass: migration\ntaskFamily: refactor"), "utf8");
    const existingDigest = await previewDigestFor(existing);
    await assert.rejects(
      () => applyReusedTaskClass({
        taskFileInput: existing,
        expectedPreviewRevisionDigest: existingDigest,
        taskClass: "migration",
        settings: cloneDefaults(),
        tasks: REFACTOR_HISTORY,
      }),
      /missing or new current taskClass/,
    );

    // New family (no history) leaves classChoices empty.
    const newFamily = path.join(root, "new-family.yaml");
    await writeFile(newFamily, YAML_DRAFT.replace("taskFamily: refactor", "taskFamily: brand-new-family"), "utf8");
    const newFamilyDigest = await previewDigestFor(newFamily);
    await assert.rejects(
      () => applyReusedTaskClass({
        taskFileInput: newFamily,
        expectedPreviewRevisionDigest: newFamilyDigest,
        taskClass: "migration",
        settings: cloneDefaults(),
        tasks: REFACTOR_HISTORY,
      }),
      /established taskFamily/,
    );

    // Missing family.
    const missingFamily = path.join(root, "missing-family.yaml");
    await writeFile(missingFamily, YAML_DRAFT.replace("taskFamily: refactor\n", ""), "utf8");
    const missingFamilyDigest = await previewDigestFor(missingFamily);
    await assert.rejects(
      () => applyReusedTaskClass({
        taskFileInput: missingFamily,
        expectedPreviewRevisionDigest: missingFamilyDigest,
        taskClass: "migration",
        settings: cloneDefaults(),
        tasks: REFACTOR_HISTORY,
      }),
      /established taskFamily/,
    );
    assertNoTempFiles(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsafe targets fail closed without target corruption", async () => {
  const { root, taskFile } = await makeDraft();
  try {
    const digest = await previewDigestFor(taskFile);

    // Relative path.
    await assert.rejects(
      () => applyReusedTaskClass({
        taskFileInput: "relative/task.yaml",
        expectedPreviewRevisionDigest: digest,
        taskClass: "migration",
        settings: cloneDefaults(),
        tasks: REFACTOR_HISTORY,
      }),
      /absolute/,
    );

    // Directory target.
    const dirPath = path.join(root, "project");
    await assert.rejects(
      () => applyReusedTaskClass({
        taskFileInput: dirPath,
        expectedPreviewRevisionDigest: digest,
        taskClass: "migration",
        settings: cloneDefaults(),
        tasks: REFACTOR_HISTORY,
      }),
      /regular file/,
    );

    // Symlink target.
    const linkPath = path.join(root, "task-link.yaml");
    await symlink(taskFile, linkPath);
    await assert.rejects(
      () => applyReusedTaskClass({
        taskFileInput: linkPath,
        expectedPreviewRevisionDigest: digest,
        taskClass: "migration",
        settings: cloneDefaults(),
        tasks: REFACTOR_HISTORY,
      }),
      /symlink or directory/,
    );

    // Malformed YAML.
    const bad = path.join(root, "bad.yaml");
    await writeFile(bad, "version: 2\n  bad-indent: [\n", "utf8");
    const badBytes = await readFile(bad, "utf8");
    await assert.rejects(
      () => applyReusedTaskClass({
        taskFileInput: bad,
        expectedPreviewRevisionDigest: digest,
        taskClass: "migration",
        settings: cloneDefaults(),
        tasks: REFACTOR_HISTORY,
      }),
    );
    assert.equal(await readFile(bad, "utf8"), badBytes, "malformed file untouched");
    assertNoTempFiles(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("successful reuse preserves the original file permissions", async () => {
  const { root, taskFile } = await makeDraft();
  try {
    await chmod(taskFile, 0o640);
    const before = (await lstat(taskFile)).mode & 0o777;
    const digest = await previewDigestFor(taskFile);
    await applyReusedTaskClass({
      taskFileInput: taskFile,
      expectedPreviewRevisionDigest: digest,
      taskClass: "migration",
      settings: cloneDefaults(),
      tasks: REFACTOR_HISTORY,
    });
    const after = (await lstat(taskFile)).mode & 0o777;
    assert.equal(after, before, "file mode preserved");
    assertNoTempFiles(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repeated reuse of the exact same class is rejected once the class is existing", async () => {
  const { root, taskFile } = await makeDraft();
  try {
    const digest = await previewDigestFor(taskFile);
    await applyReusedTaskClass({
      taskFileInput: taskFile,
      expectedPreviewRevisionDigest: digest,
      taskClass: "migration",
      settings: cloneDefaults(),
      tasks: REFACTOR_HISTORY,
    });
    const freshDigest = await previewDigestFor(taskFile);
    // The class is now existing, so a second reuse cannot proceed.
    await assert.rejects(
      () => applyReusedTaskClass({
        taskFileInput: taskFile,
        expectedPreviewRevisionDigest: freshDigest,
        taskClass: "migration",
        settings: cloneDefaults(),
        tasks: REFACTOR_HISTORY,
      }),
      /missing or new current taskClass/,
    );
    const final = YAML.parse(await readFile(taskFile, "utf8")) as { taskClass: string };
    assert.equal(final.taskClass, "migration", "first write preserved");
    assertNoTempFiles(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a path swapped to a symlink between read and rename fails closed without replacing it", async () => {
  const { root, taskFile } = await makeDraft();
  try {
    const digest = await previewDigestFor(taskFile);
    const decoy = path.join(root, "decoy.yaml");
    await writeFile(
      decoy,
      YAML_DRAFT.replace("name: Core Reuse Preview", "name: Decoy Preview"),
      "utf8",
    );
    await assert.rejects(
      () => applyReusedTaskClass({
        taskFileInput: taskFile,
        expectedPreviewRevisionDigest: digest,
        taskClass: "migration",
        settings: cloneDefaults(),
        tasks: REFACTOR_HISTORY,
        beforeFinalIdentityCheck: async () => {
          // Swap the target path to a symlink right after the replacement was
          // validated and the fresh preview produced, immediately before the
          // final no-follow recheck.
          await rm(taskFile);
          await symlink(decoy, taskFile);
        },
      }),
      /symlink or directory|out of date/,
    );
    // The swapped symlink was NOT replaced by the rename and its target is
    // byte-identical.
    const linkInfo = await lstat(taskFile);
    assert.ok(linkInfo.isSymbolicLink(), "swapped symlink is not replaced");
    assert.ok(
      (await readFile(decoy, "utf8")).includes("name: Decoy Preview"),
      "symlink target untouched",
    );
    assertNoTempFiles(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a path swapped to a different regular file fails the identity recheck before write", async () => {
  const { root, taskFile } = await makeDraft();
  try {
    const digest = await previewDigestFor(taskFile);
    const swapped = YAML_DRAFT.replace("name: Core Reuse Preview", "name: Swapped Preview");
    await assert.rejects(
      () => applyReusedTaskClass({
        taskFileInput: taskFile,
        expectedPreviewRevisionDigest: digest,
        taskClass: "migration",
        settings: cloneDefaults(),
        tasks: REFACTOR_HISTORY,
        beforeFinalIdentityCheck: async () => {
          // Replace the target with a different regular file (different inode).
          await rm(taskFile);
          await writeFile(taskFile, swapped, "utf8");
        },
      }),
      /out of date/,
    );
    // The swapped regular file is preserved byte-identical (never overwritten).
    const raw = await readFile(taskFile, "utf8");
    assert.ok(raw.includes("name: Swapped Preview"), "swapped file not overwritten");
    assert.ok(!raw.includes("taskClass: migration"), "no class was written");
    assertNoTempFiles(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
