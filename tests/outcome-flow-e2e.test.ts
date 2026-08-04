/**
 * FL-109D4A: outcome-to-board conformance across the shipped real module
 * boundaries.
 *
 * One deterministic test proves the complete shipped outcome path through a
 * real in-process Daemon (Unix-socket boundary) and a real authenticated Hub
 * (HTTP boundary) over one isolated temporary StateStore:
 *
 *   Hub create (pending, zero work) -> external Main propose (canonical daemon
 *   authority) -> Hub proposed preview -> Hub explicit confirm (exactly one
 *   Task/receipt/event) -> canonical work_hierarchy One-off lane -> identical
 *   replay -> full stack restart -> same receipt and hierarchy.
 *
 * The created Task is never executed: the daemon is booted with maxConcurrency
 * 0 so the scheduler cannot admit a Worker, and a zero-credential
 * ProviderAuthInspector keeps every health snapshot away from the production
 * Keychain and any Provider credential. No production database, Keychain,
 * external repository, or network Provider call is touched.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { get, request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { daemonRequest } from "../src/daemon/client.js";
import type { DaemonMethod } from "../src/daemon/protocol.js";
import { ForkLightDaemon } from "../src/daemon/server.js";
import type { ProviderAuthInspector } from "../src/core/providers.js";
import { SettingsService } from "../src/core/settings.js";
import { HubServer } from "../src/hub/server.js";
import { SetupService } from "../src/setup/service.js";
import type { SetupKeychainStore, SetupSystemInspector } from "../src/setup/types.js";
import { StateStore } from "../src/state/store.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

class MemoryKeychain implements SetupKeychainStore {
  readonly values = new Map<string, string>();
  private id(s: string, a: string): string { return `${a}:${s}`; }
  has(s: string, a: string): boolean { return this.values.has(this.id(s, a)); }
  read(s: string, a: string): string | undefined { return this.values.get(this.id(s, a)); }
  write(s: string, a: string, v: string): void { this.values.set(this.id(s, a), v); }
  delete(s: string, a: string): void { this.values.delete(this.id(s, a)); }
}

function inspector(): SetupSystemInspector {
  return {
    platform: () => "darwin",
    nodeVersion: () => "v24.5.0",
    account: () => "hub-ops-user",
    commandExists: () => true,
  };
}

/** Zero-credential inspector: every health snapshot and launch preflight sees
 *  no Keychain value, no Grok sign-in, and no Codex sign-in, so the isolated
 *  stack can never reach the production Keychain or Provider credentials. */
function noAuthInspector(): ProviderAuthInspector {
  return {
    hasReadableKeychainValue: () => false,
    hasLocalGrokSignIn: () => false,
    hasLocalCodexSignIn: () => false,
  };
}

function doHttp(
  u: string,
  method: "GET" | "POST",
  token?: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers["x-forklight-hub-token"] = token;
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(payload));
    }
    function onRes(res: import("node:http").IncomingMessage): void {
      let d = "";
      res.on("data", (c: Buffer) => { d += c.toString(); });
      res.on("end", () => {
        let parsed: unknown = d;
        try { if (d) parsed = JSON.parse(d); } catch { /* raw */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    }
    if (method === "GET") {
      get(u, { headers }, onRes).on("error", reject);
    } else {
      const req = request(u, { method: "POST", headers }, onRes);
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    }
  });
}

/** A valid temporary version-2 Task Contract on the isolated home. The project
 *  dir stays inside the home; no production source worktree is referenced. */
async function writeTaskContract(root: string): Promise<string> {
  const project = path.join(root, "e2e-project");
  await mkdir(project, { recursive: true });
  const taskFile = path.join(root, "e2e-task.json");
  await writeFile(
    taskFile,
    JSON.stringify(
      {
        version: 2,
        name: "E2E bounded outcome task",
        project: "./e2e-project",
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
          keychainService: "forklight.e2e.outcome.test",
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

// ---------------------------------------------------------------------------
// One reusable isolated real-stack harness
// ---------------------------------------------------------------------------

interface RealStack {
  home: string;
  daemon: ForkLightDaemon;
  hub: HubServer;
  base: string;
  token: string;
  /** Assertion-only StateStore over the same isolated database. */
  store: StateStore;
}

async function bootRealStack(home: string): Promise<RealStack> {
  // maxConcurrency 0 keeps the shipped scheduler inert: no Worker admission,
  // no attempt, no Provider launch. A zero-credential inspector guarantees the
  // health snapshot never reads production Keychain/credentials.
  const daemon = new ForkLightDaemon(home, 0, noAuthInspector());
  await daemon.start();

  const store = new StateStore(home);
  const settings = new SettingsService(store);
  const keychain = new MemoryKeychain();
  const setup = new SetupService(settings, keychain, inspector());
  const staticDir = path.join(home, "static");
  await mkdir(staticDir, { recursive: true });
  await writeFile(path.join(staticDir, "index.html"), "<!DOCTYPE html><title>Hub</title>\n", "utf8");

  const hub = new HubServer({
    settings,
    setup,
    keychain,
    staticRoot: staticDir,
    account: () => "hub-ops-user",
    port: 0,
    ensureDaemon: async () => ({ ok: true, pid: 99999 }),
    probeDaemon: async () => ({ running: true, health: { ok: true, pid: 99999 } }),
    // The Hub talks to the real daemon over the shipped Unix-socket boundary.
    daemonRequest: async <T>(method: DaemonMethod, params: Record<string, unknown> = {}) =>
      daemonRequest<T>(method, params, home),
  });
  const port = await hub.start();
  return { home, daemon, hub, base: `http://127.0.0.1:${port}`, token: hub.getToken(), store };
}

async function teardownStack(stack: RealStack | undefined): Promise<void> {
  if (!stack) return;
  // Stop the Hub first so it cannot reconnect while the daemon closes.
  await stack.hub.stop();
  await stack.daemon.close();
  stack.store.close();
}

/** Flat list of the One-off lane cards in the canonical hierarchy. */
function oneOffCards(view: Record<string, unknown>): Array<Record<string, unknown>> {
  const lane = view.oneOffTasks as { columns?: Record<string, unknown[]> } | undefined;
  if (lane?.columns === undefined) return [];
  return Object.values(lane.columns).flat().filter(
    (card): card is Record<string, unknown> =>
      card !== null && typeof card === "object" && !Array.isArray(card),
  );
}

// ---------------------------------------------------------------------------
// Conformance test
// ---------------------------------------------------------------------------

test(
  "FL-109D4A: outcome -> Main propose -> Hub confirm -> One-off hierarchy -> replay -> restart",
  async () => {
    const home = await mkdtemp(path.join(tmpdir(), "fl-e2e-outcome-board-"));
    const taskFile = await writeTaskContract(home);
    let first: RealStack | undefined;
    let second: RealStack | undefined;
    try {
      // ---- Boot 1: isolated real Daemon + authenticated Hub ----------------
      first = await bootRealStack(home);

      // 1. Authenticated Hub create records one pending intake with zero work.
      const created = await doHttp(
        `${first.base}/api/ops/intakes`,
        "POST",
        first.token,
        {
          outcome: "Recalculate checkout totals correctly",
          requestedShape: "auto",
          project: "/tmp/e2e-checkout",
          context: "Existing behavior is documented",
        },
      );
      assert.equal(created.status, 200);
      const createdBody = created.body as { ok: boolean; action: string; intake: Record<string, unknown> };
      assert.equal(createdBody.ok, true);
      assert.equal(createdBody.action, "outcome_intake_create");
      const intakeId = String(createdBody.intake.id);
      assert.ok(intakeId.length > 0);
      assert.equal(createdBody.intake.status, "pending");
      assert.equal(createdBody.intake.revision, 1);
      assert.equal(createdBody.intake.requestedShape, "auto");

      // Pending truth: the store still has zero Task/Plan/Goal records.
      assert.equal(first.store.listTasks().length, 0, "no Task before confirmation");
      assert.equal(first.store.listPlans().length, 0, "no Plan before confirmation");
      assert.equal(first.store.listGoals().length, 0, "no Goal before confirmation");
      assert.equal(first.store.listOutcomeIntakes().length, 1);

      // 2. External Main proposes a validated Task Contract through the
      //    canonical coordinator/daemon proposal operation.
      const proposed = await daemonRequest<{
        intake: Record<string, unknown>;
        preview: Record<string, unknown>;
      }>(
        "outcome_intake_propose",
        {
          intakeId,
          expectedRevision: 1,
          shape: "task",
          reason: "One bounded Task fits this outcome",
          artifactPath: taskFile,
        },
        home,
      );
      assert.equal(proposed.intake.status, "proposed");
      assert.equal(proposed.intake.revision, 2);
      assert.equal(proposed.preview.selectedShape, "task");
      assert.equal(proposed.preview.taskCount, 1);
      assert.equal(proposed.preview.confirmationHappened, false);
      assert.equal(proposed.preview.workCreated, 0);
      assert.deepEqual(proposed.preview.contractsInvolved, ["task-contract-v2"]);
      const proposedJson = JSON.stringify(proposed);
      assert.ok(!proposedJson.includes(taskFile), "propose must not echo the artifact path");
      assert.ok(!proposedJson.includes("artifactPath"), "propose must not name the private field");
      assert.ok(!proposedJson.includes('"artifactDigest"'), "propose must not expose the full digest");

      // 3. Hub reads the proposed preview through the shipped intake route.
      const preview = await doHttp(
        `${first.base}/api/ops/intakes/${intakeId}`,
        "GET",
        first.token,
      );
      assert.equal(preview.status, 200);
      const previewBody = preview.body as Record<string, unknown>;
      assert.equal(previewBody.status, "proposed");
      assert.equal(previewBody.revision, 2);
      const proposal = previewBody.proposal as Record<string, unknown>;
      assert.equal(proposal.shape, "task");
      assert.equal(proposal.reason, "One bounded Task fits this outcome");
      assert.deepEqual(proposal.contractsInvolved, ["task-contract-v2"]);
      assert.equal((proposal.artifactDigestPrefix as string).length, 16);

      // 4. Hub explicit confirmation returns canonical created truth.
      const confirmed = await doHttp(
        `${first.base}/api/ops/intakes/${intakeId}/confirm`,
        "POST",
        first.token,
        { expectedRevision: 2, confirm: true },
      );
      assert.equal(confirmed.status, 200);
      const confirmedBody = confirmed.body as {
        ok: boolean;
        action: string;
        intake: Record<string, unknown>;
        receipt: Record<string, unknown>;
      };
      assert.equal(confirmedBody.ok, true);
      assert.equal(confirmedBody.action, "outcome_intake_confirm");
      assert.equal(confirmedBody.intake.status, "created");
      assert.equal(confirmedBody.intake.revision, 3);
      const receipt = confirmedBody.receipt;
      const receiptId = String(receipt.receiptId);
      const taskIds = receipt.taskIds as string[];
      assert.equal(taskIds.length, 1);
      const taskId = taskIds[0]!;
      assert.equal(receipt.shape, "task");
      assert.equal(receipt.intakeId, intakeId);
      assert.equal(receipt.proposalRevision, 2);
      assert.equal((confirmedBody.intake.confirmation as Record<string, unknown>).receiptId, receiptId);

      // D3A atomically created exactly one Task plus receipt, and D3B returns
      // one durable created intake with exactly one task.created event.
      assert.equal(first.store.listOutcomeIntakes().length, 1);
      assert.equal(first.store.getOutcomeIntake(intakeId).status, "created");
      assert.equal(first.store.listTasks().length, 1, "exactly one created Task");
      const task = first.store.getTask(taskId);
      assert.equal(task.name, "E2E bounded outcome task");
      assert.equal(first.store.listEvents(taskId).length, 1, "exactly one Task event");
      assert.equal(first.store.listEvents(taskId)[0]!.type, "task.created");
      assert.equal(first.store.listPlans().length, 0);
      assert.equal(first.store.listGoals().length, 0);
      assert.equal(first.store.listAttempts(taskId).length, 0, "no execution attempt");

      // 5. The canonical work_hierarchy shows that exact Task in the One-off
      //    lane under the correct execution column (queued -> ready).
      const hierarchy = await doHttp(`${first.base}/api/ops/work-hierarchy`, "GET", first.token);
      assert.equal(hierarchy.status, 200);
      const view = hierarchy.body as Record<string, unknown>;
      const cards = oneOffCards(view);
      const card = cards.find((c) => c.taskId === taskId);
      assert.ok(card, "created Task must appear in the One-off tasks lane");
      assert.equal(card!.column, "ready", "a queued one-off Task sits in Ready");
      assert.equal(card!.placementReason, "queued-ready");
      assert.equal(card!.name, "E2E bounded outcome task");
      const breadcrumb = card!.breadcrumb as Record<string, unknown>;
      assert.equal(breadcrumb.taskId, taskId);
      assert.equal(breadcrumb.planId, undefined, "no invented Plan parent");
      assert.equal(breadcrumb.goalId, undefined, "no invented Goal parent");

      // 6. Identical confirmation replay returns the same receipt/Task id with
      //    no second Task, event, or queue admission.
      const retry = await doHttp(
        `${first.base}/api/ops/intakes/${intakeId}/confirm`,
        "POST",
        first.token,
        { expectedRevision: 2, confirm: true },
      );
      assert.equal(retry.status, 200);
      const retryBody = retry.body as {
        intake: Record<string, unknown>;
        receipt: Record<string, unknown>;
      };
      assert.equal(retryBody.receipt.receiptId, receiptId, "same receipt on replay");
      assert.deepEqual(retryBody.receipt.taskIds, [taskId], "same Task id on replay");
      assert.equal(retryBody.intake.status, "created");
      assert.equal(first.store.listTasks().length, 1, "replay must not create a second Task");
      assert.equal(first.store.listEvents(taskId).length, 1, "replay must not create a second event");
      assert.equal(first.store.listAttempts(taskId).length, 0);
      assert.equal(first.store.getTask(taskId).status, "queued", "execution stayed inert");

      // Privacy: Hub responses expose no artifact path, raw contract, full
      // digest, or credential material.
      const hubBodies = [
        createdBody.intake,
        previewBody,
        confirmedBody,
        confirmedBody.intake,
        confirmedBody.receipt,
        view,
        retryBody,
        retryBody.intake,
        retryBody.receipt,
      ];
      for (const body of hubBodies) {
        const serialized = JSON.stringify(body);
        assert.ok(!serialized.includes(taskFile), "artifact path must never be projected");
        assert.ok(!serialized.includes("artifactPath"), "private field name must not leak");
        assert.ok(!serialized.includes('"artifactDigest"'), "full digest field must not leak");
        assert.doesNotMatch(serialized, /[a-f0-9]{64}/, "no full 64-char digest value");
        assert.ok(!serialized.includes("keychainService"), "no Keychain service name");
        assert.ok(!serialized.includes('"commands"'), "no raw acceptance command text");
      }

      // ---- Restart: stop and recreate the temporary Daemon + Hub over the
      //      same temporary database. ----------------------------------------
      const stoppedFirst = first;
      first = undefined;
      await teardownStack(stoppedFirst);

      second = await bootRealStack(home);

      // 7. The created intake receipt survives restart.
      const reread = await doHttp(
        `${second.base}/api/ops/intakes/${intakeId}`,
        "GET",
        second.token,
      );
      assert.equal(reread.status, 200);
      const rereadBody = reread.body as Record<string, unknown>;
      assert.equal(rereadBody.status, "created");
      assert.equal(rereadBody.revision, 3);
      const confirmation = rereadBody.confirmation as Record<string, unknown>;
      assert.equal(confirmation.receiptId, receiptId, "receipt survives restart");
      assert.deepEqual(confirmation.taskIds, [taskId], "Task id survives restart");
      assert.equal(confirmation.proposalRevision, 2);

      // 8. The hierarchical Task projection survives restart in the same lane
      //    and column, with zero Provider request (still queued, no attempt).
      const hierarchy2 = await doHttp(
        `${second.base}/api/ops/work-hierarchy`,
        "GET",
        second.token,
      );
      assert.equal(hierarchy2.status, 200);
      const view2 = hierarchy2.body as Record<string, unknown>;
      const card2 = oneOffCards(view2).find((c) => c.taskId === taskId);
      assert.ok(card2, "Task must still appear in One-off tasks after restart");
      assert.equal(card2!.column, "ready");
      assert.equal((card2!.breadcrumb as Record<string, unknown>).taskId, taskId);

      assert.equal(second.store.listTasks().length, 1);
      assert.equal(second.store.getTask(taskId).status, "queued");
      assert.equal(second.store.listAttempts(taskId).length, 0, "no Provider execution after restart");
      assert.equal(second.store.listEvents(taskId).length, 1);
      const rereadJson = JSON.stringify(rereadBody);
      assert.ok(!rereadJson.includes(taskFile), "post-restart intake stays privacy-safe");
      assert.ok(!rereadJson.includes("artifactPath"));
    } finally {
      await teardownStack(first);
      await teardownStack(second);
      await rm(home, { recursive: true, force: true });
    }
  },
);
