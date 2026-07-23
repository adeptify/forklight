import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { buildTaskRecord } from "../src/core/runner.js";
import { parseTaskSpec } from "../src/core/task.js";
import { captureDirectCodexSample, listDirectCodexInbox, recordDirectCodexReview, previewDirectCodexPublication, registerDirectCodexCalibrationPublication } from "../src/core/direct-codex-workflow-service.js";
import { normalizeDirectCodexSampleReview } from "../src/core/direct-codex-review.js";
import { StateStore } from "../src/state/store.js";

const TS = "2026-07-23T12:00:00.000Z";
const CL = "cl"; const PR = "pr"; // default pair used by most tests
const ET = "edit-task"; const PA = "profileA"; // alternate pair

function ev(uOverrides?: Record<string, unknown>): Record<string, unknown> {
  const usage: Record<string, unknown> = { input_tokens: 4000, cached_input_tokens: 1000, cache_write_input_tokens: 0, output_tokens: 500, reasoning_output_tokens: 100 };
  if (uOverrides) Object.assign(usage, uOverrides);
  return { type: "turn.completed", usage };
}

function sm(overrides?: Record<string, unknown>): Record<string, unknown> {
  const base: Record<string, unknown> = {
    sampleId: "smp-001", forklightTaskId: "task-main",
    exactTaskClass: overrides?.exactTaskClass ?? CL,
    directCodexProfileId: overrides?.directCodexProfileId ?? PR,
    directRunRef: overrides?.directRunRef ?? "codex-run:run",
    pairingRef: overrides?.pairingRef ?? "pair:pair",
    capturedAt: overrides?.capturedAt ?? TS,
  };
  if (overrides) Object.assign(base, overrides);
  return base;
}

function seedTask(store: StateStore, id: string, tc = CL, pid = PR): void {
  const home = (store as any).databasePath.replace(/\/forklight\.sqlite$/, "");
  const spec = parseTaskSpec({ version: 1, name: id, project: "/tmp/src", goal: "T",
    taskClass: tc, directCodexProfileId: pid, acceptance: { commands: ["true"] } }, "/tmp");
  store.createTask(buildTaskRecord({ spec, taskFile: `/tmp/${id}.yaml`, home, id,
    sessionId: `s-${id}`, createdAt: TS }));
}

function frozen(v: unknown, p = "root"): void {
  if (v === null || typeof v !== "object") return;
  assert.ok(Object.isFrozen(v), `Expected ${p} frozen`);
  if (Array.isArray(v)) { v.forEach((e, i) => frozen(e, `${p}[${i}]`)); }
  else { for (const k of Object.keys(v as Record<string, unknown>)) frozen((v as Record<string, unknown>)[k], `${p}.${k}`); }
}


// ---- Capture -----------------------------------------------------------

test("capture persists canonical count-only sample after exact Task identity validation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-wf-"));
  const store = new StateStore(home);
  seedTask(store, "task-main", ET, PA);
  const s = captureDirectCodexSample(store, ev(), sm({ exactTaskClass: ET, directCodexProfileId: PA }));
  assert.equal(s.sampleId, "smp-001");
  assert.equal(s.exactTaskClass, ET);
  assert.equal(s.directCodexProfileId, PA);
  assert.equal(s.inputTokens, 3000);
  assert.equal(s.outputTokens, 500);
  frozen(s);
  assert.deepEqual(store.getDirectCodexPairedSample("smp-001"), s);
  store.close();
});

test("capture rejects duplicate identity, maps UNIQUE to fixed error, allows new sampleId", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-wf-"));
  const store = new StateStore(home);
  seedTask(store, "t1"); seedTask(store, "t2");
  captureDirectCodexSample(store, ev(), sm({ forklightTaskId: "t1", directRunRef: "codex-run:r1", pairingRef: "pair:p1" }));
  // Duplicate sampleId → fixed error, never UNIQUE text
  assert.throws(() => captureDirectCodexSample(store, ev(),
    sm({ forklightTaskId: "t2", directRunRef: "codex-run:r1", pairingRef: "pair:p1" })),
    { name: "TypeError", message: "Duplicate sample identity rejected" });
  // New sampleId succeeds
  captureDirectCodexSample(store, ev(), sm({ sampleId: "smp-002", forklightTaskId: "t2",
    directRunRef: "codex-run:r2", pairingRef: "pair:p2" }));
  store.close();
});

test("capture rejects taskClass/profile identity mismatch with known Task", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-wf-"));
  const store = new StateStore(home);
  seedTask(store, "t1", "other-cl", "other-pr");
  assert.throws(
    () => captureDirectCodexSample(store, ev(), sm({ exactTaskClass: CL, directCodexProfileId: PR, forklightTaskId: "t1", directRunRef: "codex-run:r1", pairingRef: "pair:p1" })),
    /Sample taskClass does not match declared Task identity/);
  assert.throws(() => store.getDirectCodexPairedSample("smp-001"), /Unknown/);
  store.close();
});

test("capture rejects malformed usage/metadata without echoing", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-wf-"));
  const store = new StateStore(home);
  seedTask(store, "t1");
  const secret = "cap-leak-999";
  for (const fn of [
    () => captureDirectCodexSample(store, null, sm({ forklightTaskId: "t1", directRunRef: "codex-run:r1", pairingRef: "pair:p1" })),
    () => captureDirectCodexSample(store, ev(), null),
    () => captureDirectCodexSample(store, ev({ input_tokens: -1 }), sm({ forklightTaskId: "t1", directRunRef: "codex-run:r1", pairingRef: "pair:p1" })),
    () => captureDirectCodexSample(store, ev(), { ...sm({ forklightTaskId: "t1", directRunRef: "codex-run:r1", pairingRef: "pair:p1" }), prompt: secret }),
  ]) {
    try { fn(); assert.fail("Expected"); }
    catch (e: any) { assert.ok(e instanceof TypeError); assert.ok(!e.message.includes(secret)); }
  }
  store.close();
});


// ---- Inbox -------------------------------------------------------------

test("inbox returns deterministic pending items, distinguishes accepted/rejected/pending, and freezes", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-wf-"));
  const store = new StateStore(home);
  seedTask(store, "t1"); seedTask(store, "t2"); seedTask(store, "t3");

  // Deterministic order by capturedAt then sampleId
  captureDirectCodexSample(store, ev(), sm({ sampleId: "b", forklightTaskId: "t1", capturedAt: "2026-07-23T12:00:02.000Z",
    directRunRef: "codex-run:b", pairingRef: "pair:b" }));
  captureDirectCodexSample(store, ev(), sm({ sampleId: "a", forklightTaskId: "t2", capturedAt: "2026-07-23T12:00:01.000Z",
    directRunRef: "codex-run:a", pairingRef: "pair:a" }));

  let items = listDirectCodexInbox(store, CL, PR);
  assert.equal(items.length, 2);
  assert.equal(items[0]!.sample.sampleId, "a");
  assert.equal(items[0]!.reviewState, "pending");
  assert.equal(items[1]!.sample.sampleId, "b");
  assert.equal(items[1]!.reviewState, "pending");
  assert.ok(Object.isFrozen(items), "inbox array must be frozen");
  for (const it of items) { frozen(it); assert.equal(it.review, undefined); }

  // Mixed states test: add third sample + reviews
  captureDirectCodexSample(store, ev(), sm({ sampleId: "c", forklightTaskId: "t3", capturedAt: "2026-07-23T12:00:03.000Z",
    directRunRef: "codex-run:c", pairingRef: "pair:c" }));
  store.saveDirectCodexSampleReview(normalizeDirectCodexSampleReview(
    { sampleId: "a", decision: "accepted", reviewer: "main-codex", reviewedAt: TS, schemaVersion: 1 }));
  store.saveDirectCodexSampleReview(normalizeDirectCodexSampleReview(
    { sampleId: "b", decision: "rejected", rejectionReason: "incomplete-evidence", reviewer: "main-codex", reviewedAt: TS, schemaVersion: 1 }));

  items = listDirectCodexInbox(store, CL, PR);
  assert.equal(items.length, 3);
  const byId = new Map(items.map(it => [it.sample.sampleId, it]));
  assert.equal(byId.get("a")!.reviewState, "accepted");
  assert.equal(byId.get("b")!.reviewState, "rejected");
  assert.equal(byId.get("b")!.review!.rejectionReason, "incomplete-evidence");
  assert.equal(byId.get("c")!.reviewState, "pending");
  for (const it of items) { frozen(it); }

  // Empty inbox for unknown pair
  assert.deepEqual(listDirectCodexInbox(store, "no-cl", "noPr"), []);
  store.close();
});

test("inbox fails closed on corrupt evidence (review and sample rows)", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-wf-"));
  const store = new StateStore(home);
  seedTask(store, "t1");
  captureDirectCodexSample(store, ev(), sm({ sampleId: "x", forklightTaskId: "t1",
    directRunRef: "codex-run:x", pairingRef: "pair:x" }));
  store.close();

  // Corrupt review row
  const raw = new DatabaseSync(path.join(home, "forklight.sqlite"));
  raw.prepare("INSERT INTO direct_codex_review_decisions (sample_id, decision, rejection_reason, reviewer, reviewed_at, record_json) VALUES (?,?,?,?,?,?)")
    .run("x", "accepted", null, "main-codex", TS, "{bad[[[");
  raw.close();
  try { listDirectCodexInbox(new StateStore(home), CL, PR); assert.fail("Expected"); }
  catch (e: any) { assert.equal(e.message, "Corrupt review-decision record in state database"); }

  // Corrupt sample row
  const home2 = await mkdtemp(path.join(tmpdir(), "fl-wf-"));
  const store2 = new StateStore(home2);
  seedTask(store2, "t1");
  captureDirectCodexSample(store2, ev(), sm({ sampleId: "ok", forklightTaskId: "t1",
    directRunRef: "codex-run:ok", pairingRef: "pair:ok" }));
  store2.close();
  const raw2 = new DatabaseSync(path.join(home2, "forklight.sqlite"));
  const secret = "cor-leak-xyz";
  raw2.prepare("UPDATE direct_codex_paired_samples SET record_json = ? WHERE sample_id = ?")
    .run(`{"secret":"${secret}"}[[[`, "ok");
  raw2.close();
  try { listDirectCodexInbox(new StateStore(home2), CL, PR); assert.fail("Expected"); }
  catch (e: any) {
    assert.ok(!e.message.includes(secret));
    assert.equal(e.message, "Corrupt paired-sample record in state database");
  }
});


// ---- Review ------------------------------------------------------------

test("review: accepted/rejected with confirm, immutable guard, unknown sample, and descriptor safety", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-wf-"));
  const store = new StateStore(home);
  seedTask(store, "t1");
  captureDirectCodexSample(store, ev(), sm({ sampleId: "s", forklightTaskId: "t1",
    directRunRef: "codex-run:s", pairingRef: "pair:s" }));

  // Accepted with confirm
  const ra = recordDirectCodexReview(store,
    { confirm: true, sampleId: "s", decision: "accepted", reviewer: "main-codex", reviewedAt: TS, schemaVersion: 1 });
  assert.equal(ra.decision, "accepted"); assert.equal("rejectionReason" in ra, false); frozen(ra);

  // Inbox reflects accepted
  assert.equal(listDirectCodexInbox(store, CL, PR)[0]!.reviewState, "accepted");

  // Duplicate → immutable guard
  assert.throws(() => recordDirectCodexReview(store,
    { confirm: true, sampleId: "s", decision: "rejected", rejectionReason: "incomplete-evidence", reviewer: "main-codex", reviewedAt: TS, schemaVersion: 1 }),
    { name: "Error", message: "Review already exists for this sample" });

  // Missing confirm rejected
  assert.throws(() => recordDirectCodexReview(store,
    { sampleId: "s", decision: "accepted", reviewer: "main-codex", reviewedAt: TS, schemaVersion: 1 }),
    { name: "TypeError", message: "Review requires explicit confirm true" });

  // False confirm rejected
  assert.throws(() => recordDirectCodexReview(store,
    { confirm: false, sampleId: "s", decision: "accepted", reviewer: "main-codex", reviewedAt: TS, schemaVersion: 1 }),
    { name: "TypeError", message: "Review requires explicit confirm true" });

  // Getter confirm never invoked
  let called = false;
  const getterObj: any = { sampleId: "s", decision: "accepted", reviewer: "main-codex", reviewedAt: TS, schemaVersion: 1 };
  Object.defineProperty(getterObj, "confirm", { get() { called = true; return true; }, enumerable: true, configurable: true });
  assert.throws(() => recordDirectCodexReview(store, getterObj),
    { name: "TypeError", message: "Review requires explicit confirm true" });
  assert.equal(called, false);

  // Non-enumerable confirm rejected (descriptor enumerable !== true)
  const nonEnumObj: any = { sampleId: "s", decision: "accepted", reviewer: "main-codex", reviewedAt: TS, schemaVersion: 1 };
  Object.defineProperty(nonEnumObj, "confirm", { value: true, enumerable: false, writable: true, configurable: true });
  assert.throws(() => recordDirectCodexReview(store, nonEnumObj),
    { name: "TypeError", message: "Review requires explicit confirm true" });

  // Unknown sample rejected
  assert.throws(() => recordDirectCodexReview(store,
    { confirm: true, sampleId: "no-such", decision: "accepted", reviewer: "main-codex", reviewedAt: TS, schemaVersion: 1 }),
    /Unknown paired sample/);

  // Bad sampleId format rejected early
  assert.throws(() => recordDirectCodexReview(store,
    { confirm: true, sampleId: "-bad", decision: "accepted", reviewer: "main-codex", reviewedAt: TS, schemaVersion: 1 }),
    { name: "TypeError", message: "Invalid direct-Codex sample review" });

  // Non-object params rejected
  for (const bad of [null, [], "str", 42, true])
    assert.throws(() => recordDirectCodexReview(store, bad), TypeError);

  store.close();
});

test("rejected review with fresh sample", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-wf-"));
  const store = new StateStore(home);
  seedTask(store, "t1");
  captureDirectCodexSample(store, ev(), sm({ sampleId: "r", forklightTaskId: "t1",
    directRunRef: "codex-run:r", pairingRef: "pair:r" }));
  const rr = recordDirectCodexReview(store,
    { confirm: true, sampleId: "r", decision: "rejected", rejectionReason: "insufficient-quality", reviewer: "main-codex", reviewedAt: TS, schemaVersion: 1 });
  assert.equal(rr.decision, "rejected"); assert.equal(rr.rejectionReason, "insufficient-quality"); frozen(rr);
  store.close();
});

test("review: extra key in params rejected via descriptor validation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-wf-"));
  const store = new StateStore(home);
  seedTask(store, "t1");
  captureDirectCodexSample(store, ev(), sm({ sampleId: "e", forklightTaskId: "t1",
    directRunRef: "codex-run:e", pairingRef: "pair:e" }));
  // Extra key `text` not in allowed set
  assert.throws(() => recordDirectCodexReview(store,
    { confirm: true, sampleId: "e", decision: "accepted", reviewer: "main-codex", reviewedAt: TS, schemaVersion: 1, text: "leaked" }),
    { name: "TypeError", message: "Invalid direct-Codex sample review" });
  store.close();
});


// ---- Publication preview & registration --------------------------------

test("publication: accepted-only drives version 1, no-new-evidence blocks re-registration, missing confirm rejected", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-wf-"));
  const store = new StateStore(home);
  seedTask(store, "ta"); seedTask(store, "tb"); seedTask(store, "tc");
  captureDirectCodexSample(store, ev(), sm({ sampleId: "a1", forklightTaskId: "ta", directRunRef: "codex-run:a1", pairingRef: "pair:a1" }));
  captureDirectCodexSample(store, ev(), sm({ sampleId: "b1", forklightTaskId: "tb", directRunRef: "codex-run:b1", pairingRef: "pair:b1" }));
  captureDirectCodexSample(store, ev(), sm({ sampleId: "c1", forklightTaskId: "tc", directRunRef: "codex-run:c1", pairingRef: "pair:c1" }));

  recordDirectCodexReview(store, { confirm: true, sampleId: "a1", decision: "accepted", reviewer: "main-codex", reviewedAt: TS, schemaVersion: 1 });
  recordDirectCodexReview(store, { confirm: true, sampleId: "b1", decision: "rejected", rejectionReason: "incomplete-evidence", reviewer: "main-codex", reviewedAt: TS, schemaVersion: 1 });

  // Preview: counts distinct, only accepted enters provenance
  const p = previewDirectCodexPublication(store, { taskClass: CL, directCodexProfileId: PR });
  assert.equal(p.acceptedCount, 1); assert.equal(p.rejectedCount, 1); assert.equal(p.pendingCount, 1);
  assert.deepEqual(p.acceptedSampleIds, ["a1"]); assert.equal(p.readiness, "ready"); assert.equal(p.nextVersion, 1);

  // Register version 1
  const r = registerDirectCodexCalibrationPublication(store,
    { method: "paired-sample-v1", confidence: "low", createdAt: TS, taskClass: CL, directCodexProfileId: PR, confirm: true });
  assert.equal(r.summary.version, 1); assert.deepEqual(r.summary.acceptedSampleIds, ["a1"]); frozen(r); frozen(r.summary);

  // No-new-evidence
  const p2 = previewDirectCodexPublication(store, { taskClass: CL, directCodexProfileId: PR });
  assert.equal(p2.readiness, "no-new-evidence");
  assert.throws(() => registerDirectCodexCalibrationPublication(store,
    { method: "v1", confidence: "low", createdAt: TS, taskClass: CL, directCodexProfileId: PR, confirm: true }), /not ready/);

  // Missing confirm
  assert.throws(() => registerDirectCodexCalibrationPublication(store,
    { method: "v1", confidence: "low", createdAt: TS, taskClass: CL, directCodexProfileId: PR }),
    { name: "TypeError", message: "Registration requires explicit confirm true" });

  // Non-object registration params
  for (const bad of [null, [], "str", 42, true])
    assert.throws(() => registerDirectCodexCalibrationPublication(store, bad), TypeError);
  store.close();
});


// ---- Privacy & exact-pair isolation -------------------------------------

test("workflow and daemon errors never echo payload content", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-wf-"));
  const store = new StateStore(home);
  seedTask(store, "t1");
  const secret = "wf-priv-ABC";
  for (const fn of [
    () => captureDirectCodexSample(store, null, sm({ forklightTaskId: "t1", directRunRef: "codex-run:r1", pairingRef: "pair:p1" })),
    () => captureDirectCodexSample(store, ev(), null),
    () => captureDirectCodexSample(store, ev(), sm({ exactTaskClass: secret, forklightTaskId: "t1", directRunRef: "codex-run:r1", pairingRef: "pair:p1" })),
    () => recordDirectCodexReview(store, { sampleId: "x", decision: "accepted", reviewer: "main-codex", reviewedAt: TS, schemaVersion: 1 }),
    () => previewDirectCodexPublication(store, { taskClass: "", directCodexProfileId: PR }),
    () => registerDirectCodexCalibrationPublication(store, { method: "v1", confidence: "low", createdAt: TS, taskClass: CL, directCodexProfileId: PR }),
  ]) {
    try { fn(); assert.fail("Expected"); }
    catch (e: any) { assert.ok(!e.message.includes(secret), `leaked: ${e.message}`); }
  }
  store.close();
});

test("exact-pair isolation: inbox separates samples by taskClass × profileId", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-wf-"));
  const store = new StateStore(home);
  seedTask(store, "t1", "clA", "prX");
  seedTask(store, "t2", "clA", "prY");
  seedTask(store, "t3", "clB", "prX");
  captureDirectCodexSample(store, ev(), sm({ sampleId: "s1", forklightTaskId: "t1", exactTaskClass: "clA", directCodexProfileId: "prX", directRunRef: "codex-run:s1", pairingRef: "pair:s1" }));
  captureDirectCodexSample(store, ev(), sm({ sampleId: "s2", forklightTaskId: "t2", exactTaskClass: "clA", directCodexProfileId: "prY", directRunRef: "codex-run:s2", pairingRef: "pair:s2" }));
  captureDirectCodexSample(store, ev(), sm({ sampleId: "s3", forklightTaskId: "t3", exactTaskClass: "clB", directCodexProfileId: "prX", directRunRef: "codex-run:s3", pairingRef: "pair:s3" }));
  assert.equal(listDirectCodexInbox(store, "clA", "prX").length, 1);
  assert.equal(listDirectCodexInbox(store, "clA", "prY").length, 1);
  assert.equal(listDirectCodexInbox(store, "clB", "prX").length, 1);
  assert.equal(listDirectCodexInbox(store, "clA", "prZ").length, 0);
  store.close();
});
