import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildCreatedOutcomeIntake,
  buildOutcomeIntakeConfirmationPreview,
  buildOutcomeIntakeConfirmationReceipt,
  buildProposedOutcomeIntake,
  contractsInvolvedForShape,
  createOutcomeIntakeRecord,
  normalizeOutcomeIntakeConfirm,
  normalizeOutcomeIntakeCreate,
  normalizeOutcomeIntakePropose,
  projectOutcomeIntake,
} from "../src/core/outcome-intake.js";
import type { OutcomeIntakeArtifactLoad } from "../src/core/outcome-intake.js";
import { SettingsService } from "../src/core/settings.js";
import { StateStore } from "../src/state/store.js";
import { DaemonCoordinator } from "../src/daemon/coordinator.js";
import { ForkLightDaemon } from "../src/daemon/server.js";
import { daemonRequest } from "../src/daemon/client.js";
import { requiresMatchingBuildIdentity } from "../src/daemon/protocol.js";

// --- Fixtures ---

async function writeTaskContract(
  root: string,
  name = "Bounded outcome task",
  projectDir = "project",
  fileName = "task.json",
): Promise<string> {
  const project = path.join(root, projectDir);
  await mkdir(project, { recursive: true });
  const taskFile = path.join(root, fileName);
  await writeFile(
    taskFile,
    JSON.stringify(
      {
        version: 2,
        name,
        project: `./${projectDir}`,
        contract: {
          outcome: "Produce one bounded, independently verifiable result for this intake",
          context: ["Existing behavior is known and documented"],
          inScope: ["Make the smallest coherent change that satisfies the outcome"],
          outOfScope: ["Do not touch unrelated areas or external systems"],
          executionSteps: [
            "Inspect the relevant code paths",
            "Apply the smallest coherent change",
            "Run the acceptance command",
          ],
          deliverables: ["Updated behavior with the acceptance command passing"],
          modules: [
            {
              name: "bounded result",
              responsibility: "Produce the one bounded result while preserving existing behavior",
              consumes: ["declared inputs"],
              produces: ["a validated result"],
              boundaries: ["no undeclared mutation"],
            },
          ],
          callChain: [
            "The caller provides declared inputs",
            "The Worker produces the validated result",
            "The acceptance command verifies the result",
          ],
          scenarios: [
            {
              name: "nominal",
              given: "declared inputs are valid",
              when: "the task runs",
              then: "the result is produced and verified",
            },
            {
              name: "boundary",
              given: "an edge input is supplied",
              when: "the task runs",
              then: "behavior stays bounded and safe",
            },
          ],
          risks: ["Behavior drift from an over-broad change"],
          changeBudget: { maxFiles: 4, maxDiffLines: 200 },
        },
        provider: {
          name: "deepseek",
          model: "deepseek-v4-flash",
          keychainService: "forklight.outcome-intake.test",
        },
        runtime: { name: "claude-code", executable: "claude", effort: "low", maxBudgetUsd: null },
        worker: { allowEdits: true, allowedCommands: [], focusPaths: ["src"] },
        acceptance: { criteria: ["The outcome is satisfied"], commands: ["true"] },
      },
      null,
      2,
    ),
  );
  return taskFile;
}

async function writePlanContract(
  root: string,
  taskFiles: string[],
  name = "plan",
): Promise<string> {
  const planFile = path.join(root, `${name}.json`);
  const items = taskFiles.map((taskFile, index) => ({
    id: `item-${index + 1}`,
    task: `./${path.basename(taskFile)}`,
    dependsOn: index === 0 ? [] : [`item-${index}`],
  }));
  await writeFile(
    planFile,
    JSON.stringify(
      { version: 1, name, objective: "Coordinate multiple independently reviewable steps", items },
      null,
      2,
    ),
  );
  return planFile;
}

async function writeGoalContract(
  root: string,
  planFileName: string,
  name = "goal",
): Promise<string> {
  const goalFile = path.join(root, `${name}.json`);
  const planText = await readFile(path.join(root, planFileName), "utf8");
  const plan = JSON.parse(planText) as { items: Array<{ id: string }> };
  const milestones = plan.items.map((item) => ({ itemId: item.id, gate: "machine" }));
  await writeFile(
    goalFile,
    JSON.stringify(
      {
        version: 1,
        name,
        objective: "Supervise a durable multi-step outcome through independent milestones",
        planFile: `./${planFileName}`,
        policy: {
          maxDurationMs: null,
          noProgressTimeoutMs: null,
          maxCorrectionRounds: 1,
          maxReviewRounds: 1,
          maxNoNewEvidenceCycles: 3,
        },
        milestones,
      },
      null,
      2,
    ),
  );
  return goalFile;
}

function taskArtifactLoad(): OutcomeIntakeArtifactLoad {
  return {
    facts: {
      shape: "task",
      displayName: "Bounded outcome task",
      objective: "Produce one bounded, independently verifiable result",
      taskCount: 1,
    },
    artifactDigest: "a".repeat(64),
  };
}

// --- Protocol classification ---

test("outcome intake protocol methods are bounded reads and explicit mutations", () => {
  assert.equal(requiresMatchingBuildIdentity("outcome_intake_create"), true);
  assert.equal(requiresMatchingBuildIdentity("outcome_intake_propose"), true);
  assert.equal(requiresMatchingBuildIdentity("outcome_intake_confirm"), true);
  assert.equal(requiresMatchingBuildIdentity("outcome_intake_list"), false);
  assert.equal(requiresMatchingBuildIdentity("outcome_intake_get"), false);
});

// --- Core normalization and projection ---

test("outcome intake create normalizes bounded fields and rejects unknown or unsafe input", () => {
  const input = normalizeOutcomeIntakeCreate({
    outcome: "  Ship a bounded fix  ",
    requestedShape: "plan",
    project: "checkout",
    context: "Existing behavior",
  });
  assert.equal(input.outcome, "Ship a bounded fix");
  assert.equal(input.requestedShape, "plan");
  assert.equal(input.project, "checkout");
  assert.equal(input.context, "Existing behavior");

  assert.throws(
    () => normalizeOutcomeIntakeCreate({ outcome: "x", secret: "s3cret-value" }),
    (error) => {
      const message = String(error);
      return /unknown fields/.test(message)
        && !message.includes("s3cret-value")
        && !message.includes("secret");
    },
  );
  assert.throws(
    () => normalizeOutcomeIntakeCreate({ outcome: "ok".repeat(2001) }),
    /1 to 2000 characters/,
  );
  assert.throws(
    () => normalizeOutcomeIntakeCreate({ outcome: "ok", requestedShape: "epic" }),
    /auto, task, plan, or goal/,
  );
  // Ordinary multiline outcome/context text is accepted: newline, carriage
  // return, and tab are safe whitespace within the existing trim/length bounds.
  const multiline = normalizeOutcomeIntakeCreate({
    outcome: "Produce a bounded result.\r\nSecond paragraph.\tIndented note.",
  });
  assert.match(multiline.outcome, /\n/);
  assert.match(multiline.outcome, /\r/);
  assert.match(multiline.outcome, /\t/);
  // NUL, DEL, and other unsafe controls remain rejected. They are constructed
  // at runtime so the source stays readable and no invisible byte is embedded.
  const NUL = String.fromCharCode(0);
  const DEL = String.fromCharCode(0x7f);
  const SOH = String.fromCharCode(0x01);
  assert.throws(
    () => normalizeOutcomeIntakeCreate({ outcome: `bad${NUL}control` }),
    /control characters/,
  );
  assert.throws(
    () => normalizeOutcomeIntakeCreate({ outcome: `bad${DEL}control` }),
    /control characters/,
  );
  assert.throws(
    () => normalizeOutcomeIntakeCreate({ outcome: `bad${SOH}control` }),
    /control characters/,
  );
  assert.throws(
    () => normalizeOutcomeIntakeCreate(null),
    /non-null object/,
  );
});

test("multiline context text is accepted while unsafe controls stay rejected", () => {
  const multilineContext = normalizeOutcomeIntakeCreate({
    outcome: "A bounded outcome",
    context: "Existing behavior is documented.\nLine two with a\t tab.",
  });
  assert.ok(multilineContext.context?.includes("\n"));
  assert.ok(multilineContext.context?.includes("\t"));
  assert.throws(
    () => normalizeOutcomeIntakeCreate({
      outcome: "x",
      context: `unsafe${String.fromCharCode(0)}control`,
    }),
    /control characters/,
  );
});

test("outcome intake confirm normalizes only intakeId, expectedRevision, and literal confirm: true", () => {
  const input = normalizeOutcomeIntakeConfirm({
    intakeId: "intake-confirm-1",
    expectedRevision: 2,
    confirm: true,
  });
  assert.equal(input.intakeId, "intake-confirm-1");
  assert.equal(input.expectedRevision, 2);
  assert.equal(input.confirm, true);

  assert.throws(
    () => normalizeOutcomeIntakeConfirm({
      intakeId: "intake-confirm-1",
      expectedRevision: 2,
      confirm: true,
      secret: "s3cret-value",
    }),
    (error) => {
      const message = String(error);
      return /unknown fields/.test(message)
        && !message.includes("s3cret-value")
        && !message.includes("secret");
    },
  );
  assert.throws(
    () => normalizeOutcomeIntakeConfirm({
      intakeId: "intake-confirm-1",
      expectedRevision: 2,
      confirm: false,
    }),
    (error) => {
      const message = String(error);
      return /confirm: true/.test(message) && !message.includes("intake-confirm-1");
    },
  );
  assert.throws(
    () => normalizeOutcomeIntakeConfirm({
      intakeId: "intake-confirm-1",
      expectedRevision: 2,
    }),
    /confirm: true/,
  );
  assert.throws(
    () => normalizeOutcomeIntakeConfirm({
      intakeId: "intake-confirm-1",
      expectedRevision: 0,
      confirm: true,
    }),
    /positive integer/,
  );
  assert.throws(
    () => normalizeOutcomeIntakeConfirm({ intakeId: "x", expectedRevision: 1, confirm: true, extra: 1 }),
    /unknown fields/,
  );
  assert.throws(
    () => normalizeOutcomeIntakeConfirm(null),
    /non-null object/,
  );
});

test("outcome intake proposal normalizes bounds and requires an absolute artifact path", () => {
  const input = normalizeOutcomeIntakePropose({
    intakeId: "intake-1",
    expectedRevision: 2,
    shape: "goal",
    reason: "Durable supervision fits",
    artifactPath: "/tmp/goal.json",
  });
  assert.equal(input.shape, "goal");
  assert.equal(input.expectedRevision, 2);

  assert.throws(
    () => normalizeOutcomeIntakePropose({
      intakeId: "intake-1",
      expectedRevision: 2,
      shape: "goal",
      reason: "x",
      artifactPath: "relative/goal.json",
    }),
    /absolute/,
  );
  assert.throws(
    () => normalizeOutcomeIntakePropose({
      intakeId: "intake-1",
      expectedRevision: 0,
      shape: "goal",
      reason: "x",
      artifactPath: "/tmp/goal.json",
    }),
    /positive integer/,
  );
  assert.throws(
    () => normalizeOutcomeIntakePropose({
      intakeId: "intake-1",
      expectedRevision: 1,
      shape: "competition",
      reason: "x",
      artifactPath: "/tmp/goal.json",
    }),
    /task, plan, or goal/,
  );
  assert.throws(
    () => normalizeOutcomeIntakePropose({
      intakeId: "intake-1",
      expectedRevision: 1,
      shape: "task",
      reason: "x",
      artifactPath: "/tmp/goal.json",
      extra: "rejected",
    }),
    (error) => {
      const message = String(error);
      return /unknown fields/.test(message) && !message.includes("rejected");
    },
  );
});

test("create record builds an immutable pending intake at revision 1", () => {
  const record = createOutcomeIntakeRecord(
    normalizeOutcomeIntakeCreate({ outcome: "Record a durable outcome", requestedShape: "auto" }),
    "intake-immutable-1",
    "2026-08-03T00:00:00.000Z",
  );
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.id, "intake-immutable-1");
  assert.equal(record.status, "pending");
  assert.equal(record.revision, 1);
  assert.equal(record.requestedShape, "auto");
  assert.equal(record.createdAt, "2026-08-03T00:00:00.000Z");
  assert.equal(record.updatedAt, "2026-08-03T00:00:00.000Z");
  assert.equal(record.proposal, undefined);

  const view = projectOutcomeIntake(record);
  assert.equal(view.status, "pending");
  assert.equal(view.revision, 1);
  assert.equal(view.proposal, undefined);
});

test("confirmation preview states nothing was created and preserves both shapes", () => {
  const record = createOutcomeIntakeRecord(
    normalizeOutcomeIntakeCreate({ outcome: "A multi-step outcome", requestedShape: "task" }),
    "intake-preview-1",
    "2026-08-03T00:00:00.000Z",
  );
  const proposed = buildProposedOutcomeIntake(
    record,
    normalizeOutcomeIntakePropose({
      intakeId: "intake-preview-1",
      expectedRevision: 1,
      shape: "plan",
      reason: "The outcome requires multiple independently reviewable steps",
      artifactPath: "/tmp/plan.json",
    }),
    {
      facts: {
        shape: "plan",
        displayName: "Two-wave plan",
        objective: "Coordinate the steps",
        taskCount: 3,
        dependencyWaves: [["item-1"], ["item-2", "item-3"]],
      },
      artifactDigest: "b".repeat(64),
    },
    "2026-08-03T00:00:01.000Z",
  );
  const preview = buildOutcomeIntakeConfirmationPreview(proposed);
  assert.equal(preview.intakeRevision, 2);
  assert.equal(preview.requestedShape, "task");
  assert.equal(preview.selectedShape, "plan");
  assert.equal(preview.reason, "The outcome requires multiple independently reviewable steps");
  assert.equal(preview.displayName, "Two-wave plan");
  assert.equal(preview.taskCount, 3);
  assert.deepEqual(preview.dependencyWaves, [["item-1"], ["item-2", "item-3"]]);
  assert.deepEqual(preview.contractsInvolved, contractsInvolvedForShape("plan"));
  assert.equal(preview.confirmationHappened, false);
  assert.equal(preview.workCreated, 0);
  assert.match(preview.note, /nothing has been created/);

  const view = projectOutcomeIntake(proposed);
  assert.equal(view.status, "proposed");
  assert.equal(view.revision, 2);
  assert.equal(view.proposal?.artifactDigestPrefix, "b".repeat(16));
  assert.equal(view.proposal?.taskCount, 3);
  assert.ok(!JSON.stringify(view).includes("/tmp/plan.json"),
    "artifact path must never be projected");
});

test("outcome intake projections never echo the absolute artifact path", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-privacy-"));
  const store = new StateStore(home);
  const coordinator = new DaemonCoordinator(store, new SettingsService(store), 0);
  try {
    const taskFile = await writeTaskContract(home);
    const intake = coordinator.createOutcomeIntake({
      outcome: "Privacy-safe projection",
      requestedShape: "auto",
    });
    const proposed = await coordinator.proposeOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 1,
      shape: "task",
      reason: "One bounded Task fits",
      artifactPath: taskFile,
    });
    const serialized = JSON.stringify(proposed.intake);
    assert.ok(!serialized.includes(taskFile), "public view must not contain the artifact path");
    assert.ok(!serialized.includes("artifactPath"), "public view must not name the private field");
    assert.equal(proposed.intake.proposal?.artifactDigestPrefix.length, 16);
    assert.equal(proposed.intake.proposal?.artifactKind, "task-contract");
    assert.equal(proposed.preview.taskCount, 1);
  } finally {
    await coordinator.shutdown();
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

// --- Store persistence and optimistic revision safety ---

test("outcome intakes survive StateStore restart in pending and proposed state", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-restart-"));
  const first = new StateStore(home);
  const pending = createOutcomeIntakeRecord(
    normalizeOutcomeIntakeCreate({ outcome: "Survive restart pending" }),
    "intake-restart-pending",
    "2026-08-03T00:00:00.000Z",
  );
  const proposed = buildProposedOutcomeIntake(
    createOutcomeIntakeRecord(
      normalizeOutcomeIntakeCreate({ outcome: "Survive restart proposed" }),
      "intake-restart-proposed",
      "2026-08-03T00:00:00.000Z",
    ),
    normalizeOutcomeIntakePropose({
      intakeId: "intake-restart-proposed",
      expectedRevision: 1,
      shape: "task",
      reason: "One bounded Task fits",
      artifactPath: "/tmp/task.json",
    }),
    taskArtifactLoad(),
    "2026-08-03T00:00:01.000Z",
  );
  first.createOutcomeIntake(pending);
  first.createOutcomeIntake(proposed);
  first.close();

  const second = new StateStore(home);
  try {
    const pendingRead = second.getOutcomeIntake("intake-restart-pending");
    assert.equal(pendingRead.status, "pending");
    assert.equal(pendingRead.revision, 1);
    assert.equal(pendingRead.outcome, "Survive restart pending");
    const proposedRead = second.getOutcomeIntake("intake-restart-proposed");
    assert.equal(proposedRead.status, "proposed");
    assert.equal(proposedRead.revision, 2);
    assert.equal(proposedRead.proposal?.shape, "task");
    assert.equal(second.listOutcomeIntakes().length, 2);
    assert.equal(second.listOutcomeIntakes(["proposed"]).length, 1);
  } finally {
    second.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("StateStore rejects a stale outcome intake replacement and keeps the prior record", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "forklight-outcome-stale-"));
  const store = new StateStore(dir);
  try {
    const record = createOutcomeIntakeRecord(
      normalizeOutcomeIntakeCreate({ outcome: "Stale guard" }),
      "intake-stale-1",
      "2026-08-03T00:00:00.000Z",
    );
    store.createOutcomeIntake(record);
    const proposed = buildProposedOutcomeIntake(
      record,
      normalizeOutcomeIntakePropose({
        intakeId: "intake-stale-1",
        expectedRevision: 1,
        shape: "task",
        reason: "First proposal",
        artifactPath: "/tmp/task.json",
      }),
      taskArtifactLoad(),
      "2026-08-03T00:00:01.000Z",
    );
    store.updateOutcomeIntake(proposed);
    assert.throws(() => store.updateOutcomeIntake(proposed), /out of date/);
    const read = store.getOutcomeIntake("intake-stale-1");
    assert.equal(read.revision, 2);
    assert.equal(read.proposal?.shape, "task");
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

// --- Coordinator lifecycle ---

test("coordinator creates a pending intake and proposes one Task with zero work side effects", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-coord-"));
  const store = new StateStore(home);
  const coordinator = new DaemonCoordinator(store, new SettingsService(store), 0);
  try {
    const taskFile = await writeTaskContract(home);
    const intake = coordinator.createOutcomeIntake({
      outcome: "Deliver a bounded one-off result",
      requestedShape: "auto",
    });
    assert.equal(intake.status, "pending");
    assert.equal(intake.revision, 1);
    assert.equal(intake.requestedShape, "auto");

    const proposed = await coordinator.proposeOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 1,
      shape: "task",
      reason: "One Task is sufficient for this bounded result",
      artifactPath: taskFile,
    });
    assert.equal(proposed.intake.status, "proposed");
    assert.equal(proposed.intake.revision, 2);
    assert.equal(proposed.preview.selectedShape, "task");
    assert.equal(proposed.preview.taskCount, 1);
    assert.equal(proposed.preview.confirmationHappened, false);
    assert.equal(proposed.preview.workCreated, 0);
    assert.deepEqual(proposed.preview.contractsInvolved, ["task-contract-v2"]);

    // Zero Task/Plan/Goal/Attempt/Worker/Provider side effects.
    assert.equal(store.listTasks().length, 0);
    assert.equal(store.listPlans().length, 0);
    assert.equal(store.listGoals().length, 0);
    assert.equal(store.listOutcomeIntakes().length, 1);
    assert.equal(coordinator.listOutcomeIntakes("proposed").length, 1);
    assert.equal(coordinator.listOutcomeIntakes("pending").length, 0);

    // Stale revision fails closed and keeps the current proposal.
    await assert.rejects(
      () => coordinator.proposeOutcomeIntake({
        intakeId: intake.id,
        expectedRevision: 1,
        shape: "task",
        reason: "stale attempt",
        artifactPath: taskFile,
      }),
      /out of date/,
    );
    const unchanged = store.getOutcomeIntake(intake.id);
    assert.equal(unchanged.revision, 2);
    assert.equal(unchanged.proposal?.reason, "One Task is sufficient for this bounded result");

    assert.throws(
      () => coordinator.listOutcomeIntakes("running"),
      /pending, proposed, or created/,
    );
  } finally {
    await coordinator.shutdown();
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("coordinator rejects a shape/artifact mismatch without corrupting the intake", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-mismatch-"));
  const store = new StateStore(home);
  const coordinator = new DaemonCoordinator(store, new SettingsService(store), 0);
  try {
    const taskFile = await writeTaskContract(home);
    const intake = coordinator.createOutcomeIntake({ outcome: "Mismatch guard" });
    await assert.rejects(
      () => coordinator.proposeOutcomeIntake({
        intakeId: intake.id,
        expectedRevision: 1,
        shape: "plan",
        reason: "wrong shape",
        artifactPath: taskFile,
      }),
      /plan/,
    );
    const stored = store.getOutcomeIntake(intake.id);
    assert.equal(stored.status, "pending");
    assert.equal(stored.revision, 1);
    assert.equal(stored.proposal, undefined);
  } finally {
    await coordinator.shutdown();
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("replacement is explicit and finite: a plan proposal replaces the Task proposal", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-replace-"));
  const store = new StateStore(home);
  const coordinator = new DaemonCoordinator(store, new SettingsService(store), 0);
  try {
    const taskFile = await writeTaskContract(home);
    const planFile = await writePlanContract(home, [taskFile, taskFile, taskFile], "plan-replace");
    const intake = coordinator.createOutcomeIntake({
      outcome: "A durable multi-step outcome",
      requestedShape: "auto",
    });
    const first = await coordinator.proposeOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 1,
      shape: "task",
      reason: "A Task fits now",
      artifactPath: taskFile,
    });
    assert.equal(first.intake.revision, 2);
    assert.equal(first.preview.taskCount, 1);

    const second = await coordinator.proposeOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 2,
      shape: "plan",
      reason: "The outcome needs multiple steps",
      artifactPath: planFile,
    });
    assert.equal(second.intake.revision, 3);
    assert.equal(second.preview.selectedShape, "plan");
    assert.equal(second.preview.taskCount, 3);
    assert.deepEqual(second.preview.dependencyWaves, [["item-1"], ["item-2"], ["item-3"]]);
    assert.equal(second.preview.requestedShape, "auto");

    const stored = store.getOutcomeIntake(intake.id);
    assert.equal(stored.revision, 3);
    assert.equal(stored.proposal?.shape, "plan");
    assert.equal(stored.proposal?.taskCount, 3);
    assert.equal(store.listTasks().length, 0);
    assert.equal(store.listPlans().length, 0);
    assert.equal(store.listGoals().length, 0);
  } finally {
    await coordinator.shutdown();
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("requested preference and Main-selected shape stay distinct", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-pref-"));
  const store = new StateStore(home);
  const coordinator = new DaemonCoordinator(store, new SettingsService(store), 0);
  try {
    const taskFile = await writeTaskContract(home);
    const planFile = await writePlanContract(home, [taskFile, taskFile], "pref-plan");
    const intake = coordinator.createOutcomeIntake({
      outcome: "A result that needs independent review",
      requestedShape: "task",
    });
    const proposed = await coordinator.proposeOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 1,
      shape: "plan",
      reason: "Multiple independently reviewable steps are required",
      artifactPath: planFile,
    });
    assert.equal(proposed.preview.requestedShape, "task");
    assert.equal(proposed.preview.selectedShape, "plan");
    assert.equal(proposed.preview.taskCount, 2);
    const stored = store.getOutcomeIntake(intake.id);
    assert.equal(stored.requestedShape, "task");
    assert.equal(stored.proposal?.shape, "plan");
  } finally {
    await coordinator.shutdown();
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("goal proposal validates through the existing Goal loader and previews bounded work", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-goal-"));
  const store = new StateStore(home);
  const coordinator = new DaemonCoordinator(store, new SettingsService(store), 0);
  try {
    const taskFile = await writeTaskContract(home, "Goal step task", "goal-project", "goal-task.json");
    await writePlanContract(home, [taskFile, taskFile, taskFile, taskFile], "goal-plan");
    const goalFile = await writeGoalContract(home, "goal-plan.json", "goal");
    const intake = coordinator.createOutcomeIntake({
      outcome: "Supervise a four-step outcome through durable milestones",
      requestedShape: "goal",
    });
    const proposed = await coordinator.proposeOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 1,
      shape: "goal",
      reason: "This outcome needs durable supervision over independent milestones",
      artifactPath: goalFile,
    });
    assert.equal(proposed.preview.selectedShape, "goal");
    assert.equal(proposed.preview.taskCount, 4);
    assert.deepEqual(proposed.preview.dependencyWaves, [["item-1"], ["item-2"], ["item-3"], ["item-4"]]);
    assert.deepEqual(proposed.preview.contractsInvolved, [
      "goal-v1",
      "work-plan-v1",
      "task-contract-v2",
    ]);
    assert.equal(proposed.preview.confirmationHappened, false);
    assert.equal(proposed.preview.workCreated, 0);
    assert.equal(store.listTasks().length, 0);
    assert.equal(store.listPlans().length, 0);
    assert.equal(store.listGoals().length, 0);
  } finally {
    await coordinator.shutdown();
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("editing a referenced Task changes the Plan proposal artifact digest", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-graph-digest-"));
  const store = new StateStore(home);
  const coordinator = new DaemonCoordinator(store, new SettingsService(store), 0);
  try {
    const taskFile = await writeTaskContract(home);
    const planFile = await writePlanContract(home, [taskFile, taskFile, taskFile], "digest-plan");
    const intake = coordinator.createOutcomeIntake({ outcome: "A multi-step outcome" });
    const first = await coordinator.proposeOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 1,
      shape: "plan",
      reason: "Multiple steps are required",
      artifactPath: planFile,
    });
    const digestBefore = store.getOutcomeIntake(intake.id).proposal?.artifactDigest;
    assert.ok(digestBefore, "plan proposal must persist an artifact graph digest");

    // Rewrite the referenced Task contract (same file name, changed content).
    await writeTaskContract(home, "Revised bounded outcome task", "project", "task.json");

    const second = await coordinator.proposeOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 2,
      shape: "plan",
      reason: "Multiple steps are required",
      artifactPath: planFile,
    });
    const digestAfter = store.getOutcomeIntake(intake.id).proposal?.artifactDigest;
    assert.ok(digestAfter);
    assert.notEqual(digestAfter, digestBefore, "editing a referenced Task must change the digest");
    // Plan-level validated facts are unchanged; only the bound graph identity moved.
    assert.equal(second.preview.displayName, first.preview.displayName);
    assert.equal(second.preview.objective, first.preview.objective);
    assert.equal(second.preview.taskCount, 3);
    assert.equal(store.listTasks().length, 0);
  } finally {
    await coordinator.shutdown();
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("editing the referenced Plan changes the Goal proposal artifact digest", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-goal-graph-digest-"));
  const store = new StateStore(home);
  const coordinator = new DaemonCoordinator(store, new SettingsService(store), 0);
  try {
    await writeTaskContract(home, "Goal step task", "goal-project", "goal-task.json");
    const planPath = path.join(home, "goal-plan.json");
    const planItems = [
      { id: "item-1", task: "./goal-task.json", dependsOn: [] },
      { id: "item-2", task: "./goal-task.json", dependsOn: ["item-1"] },
      { id: "item-3", task: "./goal-task.json", dependsOn: ["item-2"] },
      { id: "item-4", task: "./goal-task.json", dependsOn: ["item-3"] },
    ];
    await writeFile(planPath, JSON.stringify({
      version: 1,
      name: "goal-plan",
      objective: "Coordinate multiple independently reviewable steps",
      items: planItems,
    }, null, 2));
    const goalFile = await writeGoalContract(home, "goal-plan.json", "goal");

    const intake = coordinator.createOutcomeIntake({
      outcome: "A supervised multi-step outcome",
      requestedShape: "goal",
    });
    await coordinator.proposeOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 1,
      shape: "goal",
      reason: "Durable supervision is required",
      artifactPath: goalFile,
    });
    const digestBefore = store.getOutcomeIntake(intake.id).proposal?.artifactDigest;
    assert.ok(digestBefore, "goal proposal must persist an artifact graph digest");

    // Rewrite the referenced Plan file (changed objective, same items/milestones).
    await writeFile(planPath, JSON.stringify({
      version: 1,
      name: "goal-plan",
      objective: "Coordinate multiple independently reviewable steps after revision",
      items: planItems,
    }, null, 2));

    const second = await coordinator.proposeOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 2,
      shape: "goal",
      reason: "Durable supervision is required",
      artifactPath: goalFile,
    });
    const digestAfter = store.getOutcomeIntake(intake.id).proposal?.artifactDigest;
    assert.ok(digestAfter);
    assert.notEqual(digestAfter, digestBefore, "editing the referenced Plan must change the digest");
    assert.equal(second.preview.selectedShape, "goal");
    assert.equal(second.preview.taskCount, 4);
    assert.equal(store.listTasks().length, 0);
  } finally {
    await coordinator.shutdown();
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("outcome intake list applies a validated default and maximum limit", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-limit-"));
  const store = new StateStore(home);
  const coordinator = new DaemonCoordinator(store, new SettingsService(store), 0);
  try {
    for (let index = 1; index <= 3; index += 1) {
      coordinator.createOutcomeIntake({ outcome: `Bounded outcome ${index}` });
    }
    assert.equal(store.listOutcomeIntakes().length, 3);
    assert.equal(store.listOutcomeIntakes(undefined, 2).length, 2);
    assert.equal(store.listOutcomeIntakes(undefined, 1000).length, 3, "store clamps to the max");
    assert.equal(coordinator.listOutcomeIntakes(undefined, 2).length, 2);
    assert.throws(() => coordinator.listOutcomeIntakes(undefined, 0), /limit must be/);
    assert.throws(() => coordinator.listOutcomeIntakes(undefined, 101), /limit must be/);
    assert.throws(() => coordinator.listOutcomeIntakes(undefined, 1.5), /limit must be/);
    assert.throws(() => coordinator.listOutcomeIntakes(undefined, "20"), /limit must be/);
  } finally {
    await coordinator.shutdown();
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

// --- Daemon socket surface and restart ---

test("daemon outcome intake create/propose/list/get survive a daemon restart", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-daemon-"));
  const taskFile = await writeTaskContract(home);
  const first = new ForkLightDaemon(home, 1);
  await first.start();
  let intakeId = "";
  try {
    const created = await daemonRequest<Record<string, unknown>>(
      "outcome_intake_create",
      { outcome: "Ship one bounded checkout fix", requestedShape: "auto" },
      home,
    );
    intakeId = String(created.id);
    assert.equal(created.status, "pending");
    assert.equal(created.revision, 1);
    assert.equal(created.requestedShape, "auto");

    const proposed = await daemonRequest<Record<string, unknown>>(
      "outcome_intake_propose",
      {
        intakeId,
        expectedRevision: 1,
        shape: "task",
        reason: "One bounded fix suffices",
        artifactPath: taskFile,
      },
      home,
    );
    const preview = proposed.preview as Record<string, unknown>;
    assert.equal(preview.selectedShape, "task");
    assert.equal(preview.taskCount, 1);
    assert.equal(preview.confirmationHappened, false);
    assert.equal(preview.workCreated, 0);

    const readBack = await daemonRequest<Record<string, unknown>>(
      "outcome_intake_get",
      { intakeId },
      home,
    );
    assert.equal(readBack.status, "proposed");
    assert.equal(readBack.revision, 2);
    assert.equal((readBack.proposal as Record<string, unknown>).shape, "task");

    const list = await daemonRequest<Record<string, unknown>[]>(
      "outcome_intake_list",
      { status: "proposed" },
      home,
    );
    assert.equal(list.length, 1);
    assert.equal(list[0]?.id, intakeId);

    // No Task records were created through the daemon surface.
    const tasks = await daemonRequest<unknown[]>("list", {}, home);
    assert.deepEqual(tasks, []);
  } finally {
    await first.close();
  }

  const second = new ForkLightDaemon(home, 1);
  await second.start();
  try {
    const readBack = await daemonRequest<Record<string, unknown>>(
      "outcome_intake_get",
      { intakeId },
      home,
    );
    assert.equal(readBack.status, "proposed");
    assert.equal(readBack.revision, 2);
    const proposal = readBack.proposal as Record<string, unknown>;
    assert.equal(proposal.shape, "task");
    assert.equal(proposal.taskCount, 1);
    const tasks = await daemonRequest<unknown[]>("list", {}, home);
    assert.deepEqual(tasks, []);
  } finally {
    await second.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("daemon outcome intake list bounds the requested limit", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-daemon-limit-"));
  const daemon = new ForkLightDaemon(home, 1);
  await daemon.start();
  try {
    for (let index = 1; index <= 3; index += 1) {
      await daemonRequest<Record<string, unknown>>(
        "outcome_intake_create",
        { outcome: `Bounded daemon outcome ${index}` },
        home,
      );
    }
    const limited = await daemonRequest<Record<string, unknown>[]>(
      "outcome_intake_list",
      { limit: 2 },
      home,
    );
    assert.equal(limited.length, 2);
    await assert.rejects(
      () => daemonRequest<Record<string, unknown>[]>(
        "outcome_intake_list",
        { limit: 0 },
        home,
      ),
      /limit must be/,
    );
    await assert.rejects(
      () => daemonRequest<Record<string, unknown>[]>(
        "outcome_intake_list",
        { limit: "10" },
        home,
      ),
      /limit must be/,
    );
  } finally {
    await daemon.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("daemon rejects malformed outcome intake input without echoing content", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-reject-"));
  const daemon = new ForkLightDaemon(home, 1);
  await daemon.start();
  try {
    await assert.rejects(
      () => daemonRequest<Record<string, unknown>>(
        "outcome_intake_create",
        { outcome: "x", injectedSecret: "s3cret-value" },
        home,
      ),
      (error) => {
        const message = String(error);
        return /unknown fields/.test(message)
          && !message.includes("s3cret-value")
          && !message.includes("injectedSecret");
      },
    );
    await assert.rejects(
      () => daemonRequest<Record<string, unknown>>(
        "outcome_intake_create",
        { outcome: "x".repeat(2001) },
        home,
      ),
      /1 to 2000 characters/,
    );
    // Missing intakes fail closed with a fixed message that never echoes the id.
    await assert.rejects(
      () => daemonRequest<Record<string, unknown>>(
        "outcome_intake_get",
        { intakeId: "attacker-controlled-intake-id" },
        home,
      ),
      (error) => {
        const message = String(error);
        return /unknown outcome intake/i.test(message)
          && !message.includes("attacker-controlled-intake-id");
      },
    );
  } finally {
    await daemon.close();
    await rm(home, { recursive: true, force: true });
  }
});

// --- Confirmation authority (FL-109D3) ---

test("confirming one Task exactly once creates one Task/event and returns the same receipt on retry", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-confirm-task-"));
  const store = new StateStore(home);
  const coordinator = new DaemonCoordinator(store, new SettingsService(store), 0);
  try {
    const taskFile = await writeTaskContract(home, "Confirm task", "confirm-project", "confirm-task.json");
    const intake = coordinator.createOutcomeIntake({ outcome: "One bounded confirmed outcome" });
    await coordinator.proposeOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 1,
      shape: "task",
      reason: "One Task fits this bounded outcome",
      artifactPath: taskFile,
    });

    const first = await coordinator.confirmOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 2,
      confirm: true,
    });
    assert.equal(first.intake.status, "created");
    // The created record revision advances by exactly one from the proposal
    // revision; idempotent retries bind to the receipt's proposalRevision.
    assert.equal(first.intake.revision, 3);
    assert.equal(first.receipt.proposalRevision, 2);
    assert.equal(first.receipt.shape, "task");
    assert.equal(first.receipt.taskIds.length, 1);
    assert.equal(first.receipt.planId, undefined);
    assert.equal(first.receipt.goalId, undefined);

    const taskId = first.receipt.taskIds[0]!;
    assert.equal(store.listTasks().length, 1);
    assert.equal(store.listEvents(taskId).length, 1);
    assert.equal(store.listEvents(taskId)[0]!.type, "task.created");
    assert.equal(store.listPlans().length, 0);
    assert.equal(store.listGoals().length, 0);

    // Retry with the same proposal revision returns the stored receipt exactly.
    const retry = await coordinator.confirmOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 2,
      confirm: true,
    });
    assert.equal(retry.receipt.receiptId, first.receipt.receiptId);
    assert.deepEqual(retry.receipt.taskIds, first.receipt.taskIds);
    assert.equal(store.listTasks().length, 1, "retry must not create a second Task");
    assert.equal(store.listEvents(taskId).length, 1, "retry must not create a second event");

    // Stale revision fails closed and leaves everything unchanged.
    await assert.rejects(
      () => coordinator.confirmOutcomeIntake({ intakeId: intake.id, expectedRevision: 1, confirm: true }),
      /out of date/,
    );
    // The created record revision (3) is NOT a valid confirmation revision:
    // idempotency is bound to the receipt's proposalRevision (2).
    await assert.rejects(
      () => coordinator.confirmOutcomeIntake({ intakeId: intake.id, expectedRevision: 3, confirm: true }),
      /out of date/,
    );
    assert.equal(store.listTasks().length, 1);
    assert.equal(store.getOutcomeIntake(intake.id).status, "created");

    // Stale-proposal-versus-created race: a proposal attempt using the old
    // proposal revision cannot overwrite created truth.
    await assert.rejects(
      () => coordinator.proposeOutcomeIntake({
        intakeId: intake.id,
        expectedRevision: 2,
        shape: "task",
        reason: "stale overwrite attempt",
        artifactPath: taskFile,
      }),
      /cannot be re-proposed/,
    );
    assert.equal(store.getOutcomeIntake(intake.id).status, "created");
    assert.equal(store.getOutcomeIntake(intake.id).confirmation?.receiptId, first.receipt.receiptId);
  } finally {
    await coordinator.shutdown();
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("confirming a Plan commits the existing Plan graph atomically with a linked receipt", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-confirm-plan-"));
  const store = new StateStore(home);
  const coordinator = new DaemonCoordinator(store, new SettingsService(store), 0);
  try {
    const taskFile = await writeTaskContract(home, "Plan step task", "plan-project", "plan-step-task.json");
    const planFile = await writePlanContract(home, [taskFile, taskFile, taskFile], "confirm-plan");
    const intake = coordinator.createOutcomeIntake({ outcome: "A coordinated multi-step outcome" });
    await coordinator.proposeOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 1,
      shape: "plan",
      reason: "Multiple independently reviewable steps are required",
      artifactPath: planFile,
    });

    const confirmed = await coordinator.confirmOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 2,
      confirm: true,
    });
    assert.equal(confirmed.receipt.shape, "plan");
    assert.equal(confirmed.receipt.taskIds.length, 3);
    assert.ok(confirmed.receipt.planId);
    assert.equal(confirmed.receipt.goalId, undefined);

    assert.equal(store.listTasks().length, 3);
    assert.equal(store.listPlans().length, 1);
    assert.equal(store.listGoals().length, 0);
    const plan = store.getPlan(confirmed.receipt.planId!);
    assert.equal(plan.objective, "Coordinate multiple independently reviewable steps");
    assert.equal(store.getPlanItems(confirmed.receipt.planId!).length, 3);
    assert.equal(store.getDependencies(confirmed.receipt.planId!).length, 2);
    for (const taskId of confirmed.receipt.taskIds) {
      const createdEvents = store.listEvents(taskId).filter((event) => event.type === "task.created");
      assert.equal(createdEvents.length, 1, `task ${taskId} must have exactly one task.created event`);
    }

    const retry = await coordinator.confirmOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 2,
      confirm: true,
    });
    assert.equal(retry.receipt.receiptId, confirmed.receipt.receiptId);
    assert.equal(store.listTasks().length, 3, "retry must not create more Tasks");
    assert.equal(store.listPlans().length, 1);
  } finally {
    await coordinator.shutdown();
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("confirming a Goal commits Plan, dependencies, Goal, and milestones atomically", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-confirm-goal-"));
  const store = new StateStore(home);
  const coordinator = new DaemonCoordinator(store, new SettingsService(store), 0);
  try {
    const taskFile = await writeTaskContract(home, "Goal step task", "goal-project", "goal-confirm-task.json");
    await writePlanContract(home, [taskFile, taskFile, taskFile, taskFile], "goal-confirm-plan");
    const goalFile = await writeGoalContract(home, "goal-confirm-plan.json", "goal-confirm");
    const intake = coordinator.createOutcomeIntake({ outcome: "A supervised multi-step outcome" });
    await coordinator.proposeOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 1,
      shape: "goal",
      reason: "Durable supervision is required",
      artifactPath: goalFile,
    });

    const confirmed = await coordinator.confirmOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 2,
      confirm: true,
    });
    assert.equal(confirmed.receipt.shape, "goal");
    assert.equal(confirmed.receipt.taskIds.length, 4);
    assert.ok(confirmed.receipt.planId);
    assert.ok(confirmed.receipt.goalId);

    assert.equal(store.listTasks().length, 4);
    assert.equal(store.listPlans().length, 1);
    assert.equal(store.listGoals().length, 1);
    const goal = store.getGoal(confirmed.receipt.goalId!);
    assert.equal(goal.status, "running");
    assert.equal(store.getGoalMilestones(confirmed.receipt.goalId!).length, 4);
    for (const taskId of confirmed.receipt.taskIds) {
      const createdEvents = store.listEvents(taskId).filter((event) => event.type === "task.created");
      assert.equal(createdEvents.length, 1, `task ${taskId} must have exactly one task.created event`);
    }

    const retry = await coordinator.confirmOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 2,
      confirm: true,
    });
    assert.equal(retry.receipt.receiptId, confirmed.receipt.receiptId);
    assert.equal(store.listTasks().length, 4);
    assert.equal(store.listGoals().length, 1);
  } finally {
    await coordinator.shutdown();
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("confirmation fails closed when the root artifact changed after proposal", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-confirm-root-change-"));
  const store = new StateStore(home);
  const coordinator = new DaemonCoordinator(store, new SettingsService(store), 0);
  try {
    const taskFile = await writeTaskContract(home, "Original task", "project", "root-task.json");
    const intake = coordinator.createOutcomeIntake({ outcome: "A root-verified outcome" });
    await coordinator.proposeOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 1,
      shape: "task",
      reason: "One Task fits",
      artifactPath: taskFile,
    });

    // Change the root artifact after proposal.
    await writeTaskContract(home, "Changed task", "project", "root-task.json");

    await assert.rejects(
      () => coordinator.confirmOutcomeIntake({ intakeId: intake.id, expectedRevision: 2, confirm: true }),
      /artifact graph changed/,
    );
    const stored = store.getOutcomeIntake(intake.id);
    assert.equal(stored.status, "proposed");
    assert.equal(stored.revision, 2);
    assert.equal(stored.confirmation, undefined);
    assert.equal(store.listTasks().length, 0);
    assert.equal(store.listPlans().length, 0);
    assert.equal(store.listGoals().length, 0);
  } finally {
    await coordinator.shutdown();
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("confirmation fails closed when a referenced Task contract changed after proposal", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-confirm-ref-change-"));
  const store = new StateStore(home);
  const coordinator = new DaemonCoordinator(store, new SettingsService(store), 0);
  try {
    const taskFile = await writeTaskContract(home, "Referenced task", "ref-project", "ref-task.json");
    const planFile = await writePlanContract(home, [taskFile, taskFile], "ref-plan");
    const intake = coordinator.createOutcomeIntake({ outcome: "A referenced-verified outcome" });
    await coordinator.proposeOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 1,
      shape: "plan",
      reason: "Two steps are required",
      artifactPath: planFile,
    });

    // Change one referenced Task contract.
    await writeTaskContract(home, "Referenced task changed", "ref-project", "ref-task.json");

    await assert.rejects(
      () => coordinator.confirmOutcomeIntake({ intakeId: intake.id, expectedRevision: 2, confirm: true }),
      /artifact graph changed/,
    );
    assert.equal(store.listTasks().length, 0);
    assert.equal(store.listPlans().length, 0);
    const stored = store.getOutcomeIntake(intake.id);
    assert.equal(stored.status, "proposed");
    assert.equal(stored.confirmation, undefined);
  } finally {
    await coordinator.shutdown();
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("confirmation rejects pending, stale, and non-true confirm inputs without mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-confirm-reject-"));
  const store = new StateStore(home);
  const coordinator = new DaemonCoordinator(store, new SettingsService(store), 0);
  try {
    const taskFile = await writeTaskContract(home);
    const pending = coordinator.createOutcomeIntake({ outcome: "Still pending" });
    await assert.rejects(
      () => coordinator.confirmOutcomeIntake({ intakeId: pending.id, expectedRevision: 1, confirm: true }),
      /no Main proposal/,
    );
    assert.equal(store.listTasks().length, 0);

    const intake = coordinator.createOutcomeIntake({ outcome: "Confirm guard" });
    await coordinator.proposeOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 1,
      shape: "task",
      reason: "One Task fits",
      artifactPath: taskFile,
    });
    await assert.rejects(
      () => coordinator.confirmOutcomeIntake({ intakeId: intake.id, expectedRevision: 1, confirm: true }),
      /out of date/,
    );
    await assert.rejects(
      () => coordinator.confirmOutcomeIntake({ intakeId: intake.id, expectedRevision: 2, confirm: false }),
      /confirm: true/,
    );
    await assert.rejects(
      () => coordinator.confirmOutcomeIntake({ intakeId: intake.id, expectedRevision: 2 }),
      /confirm: true/,
    );
    await assert.rejects(
      () => coordinator.confirmOutcomeIntake({ intakeId: intake.id, expectedRevision: 2, confirm: true, extra: 1 }),
      /unknown fields/,
    );
    assert.equal(store.listTasks().length, 0);
    assert.equal(store.getOutcomeIntake(intake.id).status, "proposed");
    assert.equal(store.getOutcomeIntake(intake.id).confirmation, undefined);
  } finally {
    await coordinator.shutdown();
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("a concurrent confirmation for the same intake is rejected and the winner's receipt is returned on retry", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-confirm-race-"));
  const store = new StateStore(home);
  const coordinator = new DaemonCoordinator(store, new SettingsService(store), 0);
  try {
    const taskFile = await writeTaskContract(home);
    const intake = coordinator.createOutcomeIntake({ outcome: "A raced outcome" });
    await coordinator.proposeOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 1,
      shape: "task",
      reason: "One Task fits",
      artifactPath: taskFile,
    });

    // Simulate a second caller overlapping the first confirmation.
    const inFlight = (coordinator as unknown as { outcomeIntakeConfirmInFlight: Set<string> })
      .outcomeIntakeConfirmInFlight;
    inFlight.add(intake.id);
    await assert.rejects(
      () => coordinator.confirmOutcomeIntake({ intakeId: intake.id, expectedRevision: 2, confirm: true }),
      /already in progress/,
    );
    inFlight.delete(intake.id);

    // The winning confirmation commits once; the retry receives the same receipt.
    const first = await coordinator.confirmOutcomeIntake({ intakeId: intake.id, expectedRevision: 2, confirm: true });
    const retry = await coordinator.confirmOutcomeIntake({ intakeId: intake.id, expectedRevision: 2, confirm: true });
    assert.equal(retry.receipt.receiptId, first.receipt.receiptId);
    assert.equal(store.listTasks().length, 1);
    assert.equal(store.listEvents(first.receipt.taskIds[0]!).length, 1);
  } finally {
    await coordinator.shutdown();
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("a failing confirmation transaction rolls back every work row and intake change", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-confirm-rollback-"));
  const store = new StateStore(home);
  const coordinator = new DaemonCoordinator(store, new SettingsService(store), 0);
  try {
    const taskFile = await writeTaskContract(home, "Rollback step task", "rb-project", "rb-task.json");
    const planFile = await writePlanContract(home, [taskFile, taskFile], "rollback-plan");
    const intake = coordinator.createOutcomeIntake({ outcome: "An atomic rollback outcome" });
    await coordinator.proposeOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 1,
      shape: "plan",
      reason: "Two steps are required",
      artifactPath: planFile,
    });

    // Pre-insert a colliding Plan row so the confirmation's plan INSERT fails
    // after its staged Tasks and events are already inside the transaction.
    const absolutePlanPath = path.resolve(planFile);
    const now = new Date().toISOString();
    const db = (store as unknown as { db: import("node:sqlite").DatabaseSync }).db;
    db.prepare(
      `INSERT INTO plans (id, name, objective, plan_file, created_at, updated_at, record_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      absolutePlanPath,
      "collision",
      "collision",
      absolutePlanPath,
      now,
      now,
      JSON.stringify({
        id: absolutePlanPath,
        name: "collision",
        objective: "collision",
        planFile: absolutePlanPath,
        createdAt: now,
        updatedAt: now,
      }),
    );

    await assert.rejects(
      () => coordinator.confirmOutcomeIntake({ intakeId: intake.id, expectedRevision: 2, confirm: true }),
      /UNIQUE constraint failed|constraint/i,
    );

    // The transaction rolled back: no Tasks, no events, no Plan graph, and the
    // intake stays proposed at revision 2 with no confirmation receipt.
    assert.equal(store.listTasks().length, 0);
    assert.equal(store.listPlans().length, 1, "only the injected collision Plan row remains");
    assert.equal(store.getPlanItems(absolutePlanPath).length, 0);
    const stored = store.getOutcomeIntake(intake.id);
    assert.equal(stored.status, "proposed");
    assert.equal(stored.revision, 2);
    assert.equal(stored.confirmation, undefined);

    // The proposal is safely retryable once the collision is removed.
    db.prepare("DELETE FROM plans WHERE id = ?").run(absolutePlanPath);
    const confirmed = await coordinator.confirmOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 2,
      confirm: true,
    });
    assert.equal(confirmed.receipt.shape, "plan");
    assert.equal(store.listTasks().length, 2);
  } finally {
    await coordinator.shutdown();
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("store rejects malformed confirmation graphs before any mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-confirm-invariant-"));
  const store = new StateStore(home);
  try {
    const proposed = buildProposedOutcomeIntake(
      createOutcomeIntakeRecord(
        normalizeOutcomeIntakeCreate({ outcome: "Invariant guard" }),
        "intake-invariant",
        "2026-08-03T00:00:00.000Z",
      ),
      normalizeOutcomeIntakePropose({
        intakeId: "intake-invariant",
        expectedRevision: 1,
        shape: "task",
        reason: "One Task fits",
        artifactPath: "/tmp/task.json",
      }),
      taskArtifactLoad(),
      "2026-08-03T00:00:01.000Z",
    );
    store.createOutcomeIntake(proposed);

    // Wrong created record revision fails before any insert.
    const goodReceipt = buildOutcomeIntakeConfirmationReceipt({
      intakeId: "intake-invariant",
      proposalRevision: 2,
      artifactDigest: "a".repeat(64),
      shape: "task",
      taskIds: ["task-invariant-1"],
      confirmedAt: "2026-08-03T00:00:02.000Z",
    });
    const brokenRevision = { ...buildCreatedOutcomeIntake(proposed, goodReceipt, "2026-08-03T00:00:02.000Z"), revision: 99 };
    assert.throws(
      () => store.createOutcomeIntakeConfirmation({
        intakeId: "intake-invariant",
        expectedRevision: 2,
        updatedIntake: brokenRevision,
        registrations: [],
      }),
      /revision mismatch/,
    );

    // Receipt task ids that do not match the staged work graph fail too.
    const mismatchedReceipt = buildOutcomeIntakeConfirmationReceipt({
      intakeId: "intake-invariant",
      proposalRevision: 2,
      artifactDigest: "a".repeat(64),
      shape: "task",
      taskIds: ["task-not-staged"],
      confirmedAt: "2026-08-03T00:00:02.000Z",
    });
    const mismatchedCreated = buildCreatedOutcomeIntake(proposed, mismatchedReceipt, "2026-08-03T00:00:02.000Z");
    assert.throws(
      () => store.createOutcomeIntakeConfirmation({
        intakeId: "intake-invariant",
        expectedRevision: 2,
        updatedIntake: mismatchedCreated,
        registrations: [],
      }),
      /staged work graph/,
    );

    // Zero mutation on every rejected confirmation graph.
    assert.equal(store.listTasks().length, 0);
    assert.equal(store.listPlans().length, 0);
    assert.equal(store.listGoals().length, 0);
    assert.equal(store.getOutcomeIntake("intake-invariant").status, "proposed");
    assert.equal(store.getOutcomeIntake("intake-invariant").confirmation, undefined);
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("store rejects any proposal replacement over a created intake", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-confirm-created-lock-"));
  const store = new StateStore(home);
  try {
    const proposed = buildProposedOutcomeIntake(
      createOutcomeIntakeRecord(
        normalizeOutcomeIntakeCreate({ outcome: "Created lock guard" }),
        "intake-created-lock",
        "2026-08-03T00:00:00.000Z",
      ),
      normalizeOutcomeIntakePropose({
        intakeId: "intake-created-lock",
        expectedRevision: 1,
        shape: "task",
        reason: "One Task fits",
        artifactPath: "/tmp/task.json",
      }),
      taskArtifactLoad(),
      "2026-08-03T00:00:01.000Z",
    );
    const receipt = buildOutcomeIntakeConfirmationReceipt({
      intakeId: "intake-created-lock",
      proposalRevision: 2,
      artifactDigest: "a".repeat(64),
      shape: "task",
      taskIds: ["task-created-lock"],
      confirmedAt: "2026-08-03T00:00:02.000Z",
    });
    const created = buildCreatedOutcomeIntake(proposed, receipt, "2026-08-03T00:00:02.000Z");
    store.createOutcomeIntake(created);

    // A stale proposal built from the created record would try revision 4 over
    // stored revision 3; the created-row guard rejects it before any write.
    const staleProposal = buildProposedOutcomeIntake(
      created,
      normalizeOutcomeIntakePropose({
        intakeId: "intake-created-lock",
        expectedRevision: 3,
        shape: "task",
        reason: "stale overwrite",
        artifactPath: "/tmp/task.json",
      }),
      taskArtifactLoad(),
      "2026-08-03T00:00:03.000Z",
    );
    assert.throws(
      () => store.updateOutcomeIntake(staleProposal),
      /out of date/,
    );
    const read = store.getOutcomeIntake("intake-created-lock");
    assert.equal(read.status, "created");
    assert.equal(read.revision, 3);
    assert.equal(read.confirmation?.receiptId, receipt.receiptId);
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("created intake projection is privacy-safe and exposes only bounded receipt facts", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-confirm-privacy-"));
  const store = new StateStore(home);
  const coordinator = new DaemonCoordinator(store, new SettingsService(store), 0);
  try {
    const taskFile = await writeTaskContract(home, "Privacy task", "privacy-project", "privacy-task.json");
    const intake = coordinator.createOutcomeIntake({ outcome: "Privacy-safe created outcome" });
    await coordinator.proposeOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 1,
      shape: "task",
      reason: "One Task fits",
      artifactPath: taskFile,
    });
    const confirmed = await coordinator.confirmOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 2,
      confirm: true,
    });

    const serialized = JSON.stringify(confirmed);
    assert.ok(!serialized.includes(taskFile), "must not expose the artifact path");
    assert.ok(!serialized.includes("artifactPath"), "must not name the private field");
    assert.ok(!serialized.includes('artifactDigest"'), "must not expose the full digest field");
    assert.ok(!serialized.includes(store.databasePath), "must not expose the database path");
    assert.equal(confirmed.receipt.artifactDigestPrefix.length, 16);

    const readBack = coordinator.outcomeIntake(intake.id);
    assert.equal(readBack.status, "created");
    assert.equal(readBack.revision, 3);
    assert.equal(readBack.confirmation?.proposalRevision, 2);
    assert.equal(readBack.confirmation?.receiptId, confirmed.receipt.receiptId);
    assert.deepEqual(readBack.confirmation?.taskIds, confirmed.receipt.taskIds);
    assert.ok(!JSON.stringify(readBack).includes(taskFile));
    assert.ok(!JSON.stringify(readBack).includes("artifactPath"));
  } finally {
    await coordinator.shutdown();
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("created outcome intakes list under the created status filter and cannot be re-proposed", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-confirm-list-"));
  const store = new StateStore(home);
  const coordinator = new DaemonCoordinator(store, new SettingsService(store), 0);
  try {
    const taskFile = await writeTaskContract(home);
    const intake = coordinator.createOutcomeIntake({ outcome: "A listed created outcome" });
    await coordinator.proposeOutcomeIntake({
      intakeId: intake.id,
      expectedRevision: 1,
      shape: "task",
      reason: "One Task fits",
      artifactPath: taskFile,
    });
    await coordinator.confirmOutcomeIntake({ intakeId: intake.id, expectedRevision: 2, confirm: true });

    const created = coordinator.listOutcomeIntakes("created");
    assert.equal(created.length, 1);
    assert.equal(created[0]?.id, intake.id);
    assert.equal(created[0]?.confirmation?.shape, "task");
    assert.throws(() => coordinator.listOutcomeIntakes("running"), /pending, proposed, or created/);

    await assert.rejects(
      () => coordinator.proposeOutcomeIntake({
        intakeId: intake.id,
        expectedRevision: 2,
        shape: "task",
        reason: "again",
        artifactPath: taskFile,
      }),
      /cannot be re-proposed/,
    );
    assert.equal(store.listTasks().length, 1, "re-propose rejection must not create work");
  } finally {
    await coordinator.shutdown();
    store.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("created intakes with their durable receipt survive a StateStore restart", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-confirm-restart-"));
  const receipt = buildOutcomeIntakeConfirmationReceipt({
    intakeId: "intake-created-restart",
    proposalRevision: 2,
    artifactDigest: "c".repeat(64),
    shape: "task",
    taskIds: ["task-created-1"],
    confirmedAt: "2026-08-03T00:00:02.000Z",
  });
  const proposed = buildProposedOutcomeIntake(
    createOutcomeIntakeRecord(
      normalizeOutcomeIntakeCreate({ outcome: "Survive restart created" }),
      "intake-created-restart",
      "2026-08-03T00:00:00.000Z",
    ),
    normalizeOutcomeIntakePropose({
      intakeId: "intake-created-restart",
      expectedRevision: 1,
      shape: "task",
      reason: "One Task fits",
      artifactPath: "/tmp/task.json",
    }),
    taskArtifactLoad(),
    "2026-08-03T00:00:01.000Z",
  );
  const created = buildCreatedOutcomeIntake(proposed, receipt, "2026-08-03T00:00:02.000Z");

  const first = new StateStore(home);
  first.createOutcomeIntake(created);
  first.close();

  const second = new StateStore(home);
  try {
    const read = second.getOutcomeIntake("intake-created-restart");
    assert.equal(read.status, "created");
    assert.equal(read.revision, 3, "created record revision advances one past the proposal");
    assert.equal(read.confirmation?.receiptId, receipt.receiptId);
    assert.equal(read.confirmation?.proposalRevision, 2);
    assert.deepEqual(read.confirmation?.taskIds, ["task-created-1"]);
    assert.equal(second.listOutcomeIntakes(["created"]).length, 1);
  } finally {
    second.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("daemon confirms an outcome intake and creates exactly one Task through the socket", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "forklight-outcome-daemon-confirm-"));
  const taskFile = await writeTaskContract(home, "Daemon confirm task", "project", "daemon-confirm-task.json");
  const daemon = new ForkLightDaemon(home, 0);
  await daemon.start();
  try {
    const created = await daemonRequest<Record<string, unknown>>(
      "outcome_intake_create",
      { outcome: "Socket-confirmed outcome" },
      home,
    );
    const intakeId = String(created.id);
    await daemonRequest<Record<string, unknown>>(
      "outcome_intake_propose",
      { intakeId, expectedRevision: 1, shape: "task", reason: "One Task fits", artifactPath: taskFile },
      home,
    );
    const confirmed = await daemonRequest<Record<string, unknown>>(
      "outcome_intake_confirm",
      { intakeId, expectedRevision: 2, confirm: true },
      home,
    );
    const receipt = confirmed.receipt as Record<string, unknown>;
    assert.equal(receipt.shape, "task");
    assert.equal((receipt.taskIds as unknown[]).length, 1);

    const readBack = await daemonRequest<Record<string, unknown>>("outcome_intake_get", { intakeId }, home);
    assert.equal(readBack.status, "created");
    assert.equal(readBack.revision, 3);
    assert.equal((readBack.confirmation as Record<string, unknown>).proposalRevision, 2);
    assert.equal((readBack.confirmation as Record<string, unknown>).receiptId, receipt.receiptId);

    const tasks = await daemonRequest<unknown[]>("list", {}, home);
    assert.equal(tasks.length, 1);

    // Retry over the socket returns the same receipt and no duplicate work.
    const retry = await daemonRequest<Record<string, unknown>>(
      "outcome_intake_confirm",
      { intakeId, expectedRevision: 2, confirm: true },
      home,
    );
    assert.equal((retry.receipt as Record<string, unknown>).receiptId, receipt.receiptId);
    const tasksAfterRetry = await daemonRequest<unknown[]>("list", {}, home);
    assert.equal(tasksAfterRetry.length, 1);
  } finally {
    await daemon.close();
    await rm(home, { recursive: true, force: true });
  }
});
