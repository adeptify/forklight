import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { buildTaskRecord } from "../src/core/runner.js";
import { parseTaskSpec } from "../src/core/task.js";
import { buildDirectCodexPublicationPreview, registerDirectCodexPublication } from "../src/core/direct-codex-publication-service.js";
import { normalizeDirectCodexPairedSample, publishDirectCodexCalibration } from "../src/core/direct-codex-calibration.js";
import { normalizeDirectCodexSampleReview } from "../src/core/direct-codex-review.js";
import { StateStore } from "../src/state/store.js";

const TS = "2026-07-23T12:00:00.000Z";

function attrs(o?: Record<string, unknown>): Record<string, unknown> {
  const b: Record<string, unknown> = { sampleId: "smp-001", forklightTaskId: "task-ev",
    exactTaskClass: "edit-task", directCodexProfileId: "profA",
    inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 200, cacheCreationInputTokens: 50,
    source: "codex-terminal-result", complete: true,
    directRunRef: "codex-run:a1b2c3", pairingRef: "pair:xyz-001",
    capturedAt: TS, schemaVersion: 1 };
  if (o) for (const [k, v] of Object.entries(o)) { if (v === undefined) delete b[k]; else b[k] = v; }
  return b;
}

function createTaskWithProfile(store: StateStore, id: string, taskClass: string, profileId: string, ts: string): void {
  const home = (store as any).databasePath.replace(/\/forklight\.sqlite$/, "");
  const spec = parseTaskSpec({ version: 1, name: id, project: "/tmp/source", goal: "T",
    taskClass, directCodexProfileId: profileId, acceptance: { commands: ["true"] } }, "/tmp");
  store.createTask(buildTaskRecord({ spec, taskFile: `/tmp/${id}.yaml`, home, id,
    sessionId: `session-${id}`, createdAt: ts }));
}

function saveSample(store: StateStore, overrides: Record<string, unknown>): void {
  store.saveDirectCodexPairedSample(normalizeDirectCodexPairedSample(attrs(overrides)));
}

function saveReview(store: StateStore, sampleId: string, decision: "accepted" | "rejected", reason?: string): void {
  store.saveDirectCodexSampleReview(normalizeDirectCodexSampleReview(
    decision === "accepted"
      ? { sampleId, decision, reviewer: "main-codex", reviewedAt: TS, schemaVersion: 1 }
      : { sampleId, decision, rejectionReason: reason ?? "insufficient-quality", reviewer: "main-codex", reviewedAt: TS, schemaVersion: 1 }));
}

function assertFrozen(v: unknown, path = "root"): void {
  if (v === null || typeof v !== "object") return;
  assert.ok(Object.isFrozen(v), `Expected ${path} frozen`);
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) assertFrozen(v[i], `${path}[${i}]`); }
  else { for (const k of Object.keys(v as Record<string, unknown>)) assertFrozen((v as Record<string, unknown>)[k], `${path}.${k}`); }
}

function assertNoRaw(obj: Record<string, unknown>): void {
  for (const f of ["text","content","prompt","body","payload","raw","secret","credential","log","response","diff","hash","modelConfig","notes","reason","detail","evidence","source","promptText","forklightTaskId","directRunRef","pairingRef"])
    assert.equal(f in obj, false, `Unexpected: ${f}`);
}

const POLICY = { method: "paired-sample-v1", confidence: "low" as const, createdAt: TS };


test("preview classifies pending, rejected, accepted; no implicit approval", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-pub-"));
  const store = new StateStore(home);
  createTaskWithProfile(store, "t1", "cl", "pr", TS);
  createTaskWithProfile(store, "t2", "cl", "pr", TS);
  createTaskWithProfile(store, "t3", "cl", "pr", TS);
  createTaskWithProfile(store, "t4", "cl", "pr", TS);
  saveSample(store, { sampleId: "a", forklightTaskId: "t1", exactTaskClass: "cl", directCodexProfileId: "pr",
    directRunRef: "codex-run:a1", pairingRef: "pair:a1" });
  saveSample(store, { sampleId: "b", forklightTaskId: "t2", exactTaskClass: "cl", directCodexProfileId: "pr",
    directRunRef: "codex-run:b2", pairingRef: "pair:b2" });
  saveSample(store, { sampleId: "c", forklightTaskId: "t3", exactTaskClass: "cl", directCodexProfileId: "pr",
    directRunRef: "codex-run:c3", pairingRef: "pair:c3" });
  saveSample(store, { sampleId: "d", forklightTaskId: "t4", exactTaskClass: "cl", directCodexProfileId: "pr",
    directRunRef: "codex-run:d4", pairingRef: "pair:d4" });
  saveReview(store, "a", "accepted");
  saveReview(store, "b", "rejected", "incomplete-evidence");

  const p = buildDirectCodexPublicationPreview(store, { taskClass: "cl", directCodexProfileId: "pr" });
  assert.equal(p.acceptedCount, 1); assert.equal(p.rejectedCount, 1); assert.equal(p.pendingCount, 2);
  assert.deepEqual(p.acceptedSampleIds, ["a"]);
  assert.equal(p.hasNewAcceptedEvidence, true); assert.equal(p.readiness, "ready");
  assert.equal(p.nextVersion, 1);
  assertFrozen(p); assertNoRaw(p as unknown as Record<string, unknown>);
  store.close();
});

test("preview: pending-only and rejected-only → not ready", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-pub-"));
  const store = new StateStore(home);
  createTaskWithProfile(store, "t1", "cl", "pr", TS);
  createTaskWithProfile(store, "t2", "cl", "pr", TS);
  saveSample(store, { sampleId: "p", forklightTaskId: "t1", exactTaskClass: "cl", directCodexProfileId: "pr",
    directRunRef: "codex-run:p1", pairingRef: "pair:p1" });
  saveSample(store, { sampleId: "r", forklightTaskId: "t2", exactTaskClass: "cl", directCodexProfileId: "pr",
    directRunRef: "codex-run:r2", pairingRef: "pair:r2" });
  saveReview(store, "r", "rejected");

  const p = buildDirectCodexPublicationPreview(store, { taskClass: "cl", directCodexProfileId: "pr" });
  assert.equal(p.acceptedCount, 0); assert.equal(p.pendingCount, 1); assert.equal(p.rejectedCount, 1);
  assert.equal(p.readiness, "no-accepted-samples");
  assert.throws(() => registerDirectCodexPublication(store, { ...POLICY, taskClass: "cl", directCodexProfileId: "pr", confirm: true as const }), /not ready/);
  store.close();
});


test("first registration → version 1; newly accepted sample advances to version 2", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-pub-"));
  const store = new StateStore(home);
  createTaskWithProfile(store, "ta", "cl", "pr", TS);
  createTaskWithProfile(store, "tb", "cl", "pr", TS);
  saveSample(store, { sampleId: "aa", forklightTaskId: "ta", exactTaskClass: "cl", directCodexProfileId: "pr",
    directRunRef: "codex-run:a1", pairingRef: "pair:a1" });
  saveSample(store, { sampleId: "bb", forklightTaskId: "tb", exactTaskClass: "cl", directCodexProfileId: "pr",
    directRunRef: "codex-run:b2", pairingRef: "pair:b2" });
  saveReview(store, "aa", "accepted");

  const r1 = registerDirectCodexPublication(store, { ...POLICY, taskClass: "cl", directCodexProfileId: "pr", confirm: true as const });
  assert.equal(r1.summary.version, 1); assert.deepEqual(r1.summary.acceptedSampleIds, ["aa"]);
  assertFrozen(r1); assertFrozen(r1.summary); assertNoRaw(r1.summary as unknown as Record<string, unknown>);

  saveReview(store, "bb", "accepted");
  const r2 = registerDirectCodexPublication(store, { ...POLICY, taskClass: "cl", directCodexProfileId: "pr", confirm: true as const });
  assert.equal(r2.summary.version, 2); assert.equal(r2.summary.acceptedSampleCount, 2);
  assert.deepEqual(r2.summary.acceptedSampleIds, ["aa", "bb"]);

  const pubs = store.listDirectCodexProfilePublications("cl", "pr");
  assert.equal(pubs.length, 2); assert.equal(pubs[0]!.calibration.version, 1); assert.equal(pubs[1]!.calibration.version, 2);
  store.close();
});

test("duplicate confirmation → no-new-evidence, no new version persisted", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-pub-"));
  const store = new StateStore(home);
  createTaskWithProfile(store, "t", "cl", "pr", TS);
  saveSample(store, { sampleId: "x", forklightTaskId: "t", exactTaskClass: "cl", directCodexProfileId: "pr",
    directRunRef: "codex-run:x1", pairingRef: "pair:x1" });
  saveReview(store, "x", "accepted");

  registerDirectCodexPublication(store, { ...POLICY, taskClass: "cl", directCodexProfileId: "pr", confirm: true as const });
  const p = buildDirectCodexPublicationPreview(store, { taskClass: "cl", directCodexProfileId: "pr" });
  assert.equal(p.nextVersion, 2); assert.equal(p.hasNewAcceptedEvidence, false);
  assert.equal(p.readiness, "no-new-evidence");
  assert.throws(() => registerDirectCodexPublication(store, { ...POLICY, taskClass: "cl", directCodexProfileId: "pr", confirm: true as const }), /not ready/);
  assert.equal(store.listDirectCodexProfilePublications("cl", "pr").length, 1);
  store.close();
});


test("exact-pair isolation: cross-profile and cross-class samples excluded", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-pub-"));
  const store = new StateStore(home);
  createTaskWithProfile(store, "t1", "clA", "prX", TS);
  createTaskWithProfile(store, "t2", "clA", "prY", TS);
  createTaskWithProfile(store, "t3", "clB", "prX", TS);
  saveSample(store, { sampleId: "s1", forklightTaskId: "t1", exactTaskClass: "clA", directCodexProfileId: "prX", directRunRef: "codex-run:s1", pairingRef: "pair:s1" });
  saveSample(store, { sampleId: "s2", forklightTaskId: "t2", exactTaskClass: "clA", directCodexProfileId: "prY", directRunRef: "codex-run:s2", pairingRef: "pair:s2" });
  saveSample(store, { sampleId: "s3", forklightTaskId: "t3", exactTaskClass: "clB", directCodexProfileId: "prX", directRunRef: "codex-run:s3", pairingRef: "pair:s3" });
  saveReview(store, "s1", "accepted"); saveReview(store, "s2", "accepted"); saveReview(store, "s3", "accepted");

  const p1 = buildDirectCodexPublicationPreview(store, { taskClass: "clA", directCodexProfileId: "prX" });
  assert.equal(p1.acceptedCount, 1); assert.deepEqual(p1.acceptedSampleIds, ["s1"]);

  registerDirectCodexPublication(store, { ...POLICY, taskClass: "clA", directCodexProfileId: "prX", confirm: true as const });
  registerDirectCodexPublication(store, { ...POLICY, taskClass: "clA", directCodexProfileId: "prY", confirm: true as const });
  assert.equal(store.latestDirectCodexProfilePublication("clA", "prX")!.calibration.version, 1);
  assert.equal(store.latestDirectCodexProfilePublication("clA", "prY")!.calibration.version, 1);
  assert.equal(store.latestDirectCodexProfilePublication("clA", "prZ"), undefined);
  store.close();
});


test("no confirm → rejected; invalid params rejected without echoing", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-pub-"));
  const store = new StateStore(home);
  createTaskWithProfile(store, "t", "cl", "pr", TS);
  saveSample(store, { sampleId: "x", forklightTaskId: "t", exactTaskClass: "cl", directCodexProfileId: "pr",
    directRunRef: "codex-run:x1", pairingRef: "pair:x1" });
  saveReview(store, "x", "accepted");

  assert.throws(() => registerDirectCodexPublication(store, { ...POLICY, taskClass: "cl", directCodexProfileId: "pr" }),
    { name: "TypeError", message: "Registration requires explicit confirm true" });
  assert.throws(() => buildDirectCodexPublicationPreview(store, { taskClass: "", directCodexProfileId: "pr" }), { name: "TypeError" });
  assert.throws(() => buildDirectCodexPublicationPreview(store, { taskClass: "cl", directCodexProfileId: "-bad" }), { name: "TypeError" });
  assert.throws(() => registerDirectCodexPublication(store, { ...POLICY, method: "", taskClass: "cl", directCodexProfileId: "pr", confirm: true }), { name: "TypeError" });
  assert.throws(() => registerDirectCodexPublication(store, { ...POLICY, confidence: "extreme", taskClass: "cl", directCodexProfileId: "pr", confirm: true }), { name: "TypeError" });
  assert.throws(() => registerDirectCodexPublication(store, { ...POLICY, createdAt: "bad", taskClass: "cl", directCodexProfileId: "pr", confirm: true }), { name: "TypeError" });
  store.close();
});


test("preview and result are detached deeply frozen; no raw fields", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-pub-"));
  const store = new StateStore(home);
  createTaskWithProfile(store, "t", "cl", "pr", TS);
  saveSample(store, { sampleId: "x", forklightTaskId: "t", exactTaskClass: "cl", directCodexProfileId: "pr",
    directRunRef: "codex-run:x1", pairingRef: "pair:x1" });
  saveReview(store, "x", "accepted");

  const p = buildDirectCodexPublicationPreview(store, { taskClass: "cl", directCodexProfileId: "pr" });
  assertFrozen(p); assert.throws(() => { (p as any).nextVersion = 99; }, TypeError);
  const p2 = buildDirectCodexPublicationPreview(store, { taskClass: "cl", directCodexProfileId: "pr" });
  assert.deepEqual(p, p2); assert.notEqual(p, p2); assert.notEqual(p.acceptedSampleIds, p2.acceptedSampleIds);
  assertNoRaw(p as unknown as Record<string, unknown>);

  const r = registerDirectCodexPublication(store, { ...POLICY, taskClass: "cl", directCodexProfileId: "pr", confirm: true });
  assertFrozen(r); assertFrozen(r.summary); assert.throws(() => { (r.summary as any).version = 99; }, TypeError);
  assert.deepEqual(Object.keys(r).sort(), ["publication", "summary"]);
  store.close();
});


test("concurrent same-version → UNIQUE constraint rejects second", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-pub-"));
  const store = new StateStore(home);
  createTaskWithProfile(store, "t", "cl", "pr", TS);
  saveSample(store, { sampleId: "x", forklightTaskId: "t", exactTaskClass: "cl", directCodexProfileId: "pr",
    directRunRef: "codex-run:x1", pairingRef: "pair:x1" });
  saveReview(store, "x", "accepted");

  registerDirectCodexPublication(store, { ...POLICY, taskClass: "cl", directCodexProfileId: "pr", confirm: true });
  const dup = publishDirectCodexCalibration(
    [normalizeDirectCodexPairedSample(attrs({ sampleId: "x", forklightTaskId: "t", exactTaskClass: "cl", directCodexProfileId: "pr" }))],
    { method: "paired-sample-v1", confidence: "low", version: 1, taskClass: "cl", directCodexProfileId: "pr", createdAt: TS });
  assert.throws(() => store.saveDirectCodexProfilePublication(dup), /UNIQUE/);
  assert.equal(store.listDirectCodexProfilePublications("cl", "pr").length, 1);
  store.close();
});


test("corrupt review or publication → fails closed without echoing", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-pub-"));
  const ts = new Date().toISOString();
  const store = new StateStore(home);
  createTaskWithProfile(store, "t", "cl", "pr", ts);
  saveSample(store, { sampleId: "x", forklightTaskId: "t", exactTaskClass: "cl", directCodexProfileId: "pr",
    directRunRef: "codex-run:x1", pairingRef: "pair:x1" });
  store.close();

  const secret = "sk-leak-999";
  const raw = new DatabaseSync(path.join(home, "forklight.sqlite"));
  raw.prepare(`INSERT INTO direct_codex_review_decisions (sample_id, decision, rejection_reason, reviewer, reviewed_at, record_json) VALUES (?,?,?,?,?,?)`)
    .run("x", "accepted", null, "main-codex", TS, `{"secret":"${secret}"}[[[BROKEN`);
  raw.close();
  try { buildDirectCodexPublicationPreview(new StateStore(home), { taskClass: "cl", directCodexProfileId: "pr" }); assert.fail("Expected"); }
  catch (e: any) { assert.ok(!e.message.includes(secret)); assert.equal(e.message, "Corrupt review-decision record in state database"); }

  const home2 = await mkdtemp(path.join(tmpdir(), "fl-pub-"));
  const store2 = new StateStore(home2);
  createTaskWithProfile(store2, "t2", "cl2", "pr2", TS);
  saveSample(store2, { sampleId: "y", forklightTaskId: "t2", exactTaskClass: "cl2", directCodexProfileId: "pr2",
    directRunRef: "codex-run:y2", pairingRef: "pair:y2" });
  saveReview(store2, "y", "accepted");
  registerDirectCodexPublication(store2, { ...POLICY, taskClass: "cl2", directCodexProfileId: "pr2", confirm: true });
  store2.close();
  const raw2 = new DatabaseSync(path.join(home2, "forklight.sqlite"));
  raw2.prepare("UPDATE direct_codex_profile_publications SET record_json = ? WHERE task_class = ? AND profile_id = ?")
    .run("{broken[[[", "cl2", "pr2");
  raw2.close();
  assert.throws(() => buildDirectCodexPublicationPreview(new StateStore(home2), { taskClass: "cl2", directCodexProfileId: "pr2" }),
    { name: "Error", message: "Corrupt profile publication record in state database" });
});


test("unsafe version overflow → readiness unsafe-version, nextVersion null, registration blocked", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-pub-"));
  const store = new StateStore(home);
  createTaskWithProfile(store, "t", "cl", "pr", TS);
  saveSample(store, { sampleId: "x", forklightTaskId: "t", exactTaskClass: "cl", directCodexProfileId: "pr",
    directRunRef: "codex-run:x1", pairingRef: "pair:x1" });
  saveReview(store, "x", "accepted");

  const overflow = publishDirectCodexCalibration(
    [normalizeDirectCodexPairedSample(attrs({ sampleId: "x", forklightTaskId: "t", exactTaskClass: "cl", directCodexProfileId: "pr" }))],
    { method: "x", confidence: "low", version: Number.MAX_SAFE_INTEGER, taskClass: "cl", directCodexProfileId: "pr", createdAt: TS });
  store.saveDirectCodexProfilePublication(overflow);

  const p = buildDirectCodexPublicationPreview(store, { taskClass: "cl", directCodexProfileId: "pr" });
  assert.equal(p.readiness, "unsafe-version");
  assert.strictEqual(p.nextVersion, null);
  assert.throws(() => registerDirectCodexPublication(store, { ...POLICY, taskClass: "cl", directCodexProfileId: "pr", confirm: true }), /unsafe-version/);
  store.close();
});


test("registration summary sorts acceptedSampleIds canonically", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fl-pub-"));
  const store = new StateStore(home);
  createTaskWithProfile(store, "t1", "cl", "pr", TS);
  createTaskWithProfile(store, "t2", "cl", "pr", TS);
  createTaskWithProfile(store, "t3", "cl", "pr", TS);
  saveSample(store, { sampleId: "z-s", forklightTaskId: "t1", exactTaskClass: "cl", directCodexProfileId: "pr", capturedAt: "2026-01-03T00:00:00.000Z", directRunRef: "codex-run:z1", pairingRef: "pair:z1" });
  saveSample(store, { sampleId: "a-s", forklightTaskId: "t2", exactTaskClass: "cl", directCodexProfileId: "pr", capturedAt: "2026-01-01T00:00:00.000Z", directRunRef: "codex-run:a2", pairingRef: "pair:a2" });
  saveSample(store, { sampleId: "m-s", forklightTaskId: "t3", exactTaskClass: "cl", directCodexProfileId: "pr", capturedAt: "2026-01-02T00:00:00.000Z", directRunRef: "codex-run:m3", pairingRef: "pair:m3" });
  saveReview(store, "z-s", "accepted"); saveReview(store, "a-s", "accepted"); saveReview(store, "m-s", "accepted");

  const p = buildDirectCodexPublicationPreview(store, { taskClass: "cl", directCodexProfileId: "pr" });
  assert.deepEqual(p.acceptedSampleIds, ["a-s", "m-s", "z-s"]);
  const r = registerDirectCodexPublication(store, { ...POLICY, taskClass: "cl", directCodexProfileId: "pr", confirm: true });
  assert.deepEqual(r.summary.acceptedSampleIds, ["a-s", "m-s", "z-s"]);
  store.close();
});

const stubStore = {} as StateStore;

test("preview and registration reject bad param shapes with fixed non-echoing errors", () => {
  const PREV = "Invalid publication preview parameters";
  const REG = "Invalid registration parameters";
  const CONFIRM = "Registration requires explicit confirm true";
  const cases: [string, () => void, string][] = [
    ["preview null", () => buildDirectCodexPublicationPreview(stubStore, null), PREV],
    ["preview array", () => buildDirectCodexPublicationPreview(stubStore, []), PREV],
    ["preview primitive", () => buildDirectCodexPublicationPreview(stubStore, "str"), PREV],
    ["preview number", () => buildDirectCodexPublicationPreview(stubStore, 42), PREV],
    ["preview boolean", () => buildDirectCodexPublicationPreview(stubStore, true), PREV],
    ["preview undefined", () => buildDirectCodexPublicationPreview(stubStore, undefined), PREV],
    ["preview extra key", () => buildDirectCodexPublicationPreview(stubStore, { taskClass: "cl", directCodexProfileId: "pr", extra: 1 }), PREV],
    ["preview missing key", () => buildDirectCodexPublicationPreview(stubStore, { taskClass: "cl" }), PREV],
    ["preview non-string", () => buildDirectCodexPublicationPreview(stubStore, { taskClass: 42, directCodexProfileId: "pr" }), PREV],
    ["reg null", () => registerDirectCodexPublication(stubStore, null), REG],
    ["reg array", () => registerDirectCodexPublication(stubStore, []), REG],
    ["reg primitive", () => registerDirectCodexPublication(stubStore, "str"), REG],
    ["reg extra key", () => registerDirectCodexPublication(stubStore, { ...POLICY, taskClass: "cl", directCodexProfileId: "pr", confirm: true, extra: 1 }), REG],
    ["reg missing key", () => registerDirectCodexPublication(stubStore, { ...POLICY, directCodexProfileId: "pr", confirm: true }), REG],
    ["reg non-string", () => registerDirectCodexPublication(stubStore, { ...POLICY, method: 123, taskClass: "cl", directCodexProfileId: "pr", confirm: true }), "Invalid calibration method"],
    ["reg missing confirm", () => registerDirectCodexPublication(stubStore, { ...POLICY, taskClass: "cl", directCodexProfileId: "pr" }), CONFIRM],
    ["reg false confirm", () => registerDirectCodexPublication(stubStore, { ...POLICY, taskClass: "cl", directCodexProfileId: "pr", confirm: false }), CONFIRM],
    ["reg null confirm", () => registerDirectCodexPublication(stubStore, { ...POLICY, taskClass: "cl", directCodexProfileId: "pr", confirm: null }), CONFIRM],
  ];
  for (const [, call, msg] of cases) {
    assert.throws(call, { name: "TypeError", message: msg });
  }
});

test("getter on required field is never invoked; Proxy trap text is never echoed", () => {
  const PREV = "Invalid publication preview parameters";
  const REG = "Invalid registration parameters";
  const CONFIRM = "Registration requires explicit confirm true";

  let called = false;
  const acc1: any = { directCodexProfileId: "pr" };
  Object.defineProperty(acc1, "taskClass", { get() { called = true; return "cl"; }, enumerable: true, configurable: true });
  assert.throws(() => buildDirectCodexPublicationPreview(stubStore, acc1), { name: "TypeError", message: PREV });
  assert.equal(called, false);

  called = false;
  const acc2: any = { confidence: "low", createdAt: TS, taskClass: "cl", directCodexProfileId: "pr", confirm: true };
  Object.defineProperty(acc2, "method", { get() { called = true; return "v1"; }, enumerable: true, configurable: true });
  assert.throws(() => registerDirectCodexPublication(stubStore, acc2), { name: "TypeError", message: REG });
  assert.equal(called, false);

  called = false;
  const acc3: any = { method: "v1", confidence: "low", createdAt: TS, taskClass: "cl", directCodexProfileId: "pr" };
  Object.defineProperty(acc3, "confirm", { get() { called = true; return true; }, enumerable: true, configurable: true });
  assert.throws(() => registerDirectCodexPublication(stubStore, acc3), { name: "TypeError", message: CONFIRM });
  assert.equal(called, false);

  const marker = "SECRET-MARKER-abc123";
  const prox = new Proxy({ confirm: true }, {
    getPrototypeOf() { throw new Error(marker); },
  });
  try { buildDirectCodexPublicationPreview(stubStore, prox); assert.fail("Expected"); }
  catch (e: any) {
    assert.ok(!e.message.includes(marker), `Proxy marker leaked: ${e.message}`);
    assert.equal(e.message, PREV);
  }
  try { registerDirectCodexPublication(stubStore, prox); assert.fail("Expected"); }
  catch (e: any) {
    assert.ok(!e.message.includes(marker), `Proxy marker leaked: ${e.message}`);
    assert.equal(e.message, "Invalid registration parameters");
  }
});

test("corrupt prior provenance fails closed; valid suffixes accepted", async () => {
  const PROV_MSG = "Corrupt prior publication provenance in state database";

  async function corruptAndTest(fn: (pub: any) => void): Promise<void> {
    const home = await mkdtemp(path.join(tmpdir(), "fl-pub-prov-"));
    const store = new StateStore(home);
    createTaskWithProfile(store, "t1", "cl", "pr", TS);
    createTaskWithProfile(store, "t2", "cl", "pr", TS);
    saveSample(store, { sampleId: "s1", forklightTaskId: "t1", exactTaskClass: "cl", directCodexProfileId: "pr",
      directRunRef: "codex-run:s1", pairingRef: "pair:s1" });
    saveSample(store, { sampleId: "s2", forklightTaskId: "t2", exactTaskClass: "cl", directCodexProfileId: "pr",
      directRunRef: "codex-run:s2", pairingRef: "pair:s2" });
    saveReview(store, "s1", "accepted");
    saveReview(store, "s2", "accepted");
    registerDirectCodexPublication(store, { ...POLICY, taskClass: "cl", directCodexProfileId: "pr", confirm: true });
    const pub = store.latestDirectCodexProfilePublication("cl", "pr")!;
    store.close();

    const mutable = { ...pub, calibration: { ...pub.calibration, evidenceReferences: [...pub.calibration.evidenceReferences] } };
    fn(mutable);

    const raw = new DatabaseSync(path.join(home, "forklight.sqlite"));
    raw.prepare("UPDATE direct_codex_profile_publications SET record_json = ? WHERE task_class = ? AND profile_id = ? AND version = 1")
      .run(JSON.stringify(mutable), "cl", "pr");
    raw.close();

    const reopened = new StateStore(home);
    assert.throws(
      () => buildDirectCodexPublicationPreview(reopened, { taskClass: "cl", directCodexProfileId: "pr" }),
      { name: "Error", message: PROV_MSG },
    );
    reopened.close();
  }

  const badRefs: [(pub: any) => void][] = [
    [(pub) => { pub.calibration.evidenceReferences = ["experiment:bad"]; pub.calibration.sampleSize = 1; }],
    [(pub) => { pub.calibration.evidenceReferences = ["other:s1"]; pub.calibration.sampleSize = 1; }],
    [(pub) => { pub.calibration.evidenceReferences = ["sample:s1"]; pub.calibration.sampleSize = 2; }],
    [(pub) => { pub.calibration.evidenceReferences = ["sample:s1", "sample:s2"]; pub.calibration.sampleSize = 1; }],
    [(pub) => { pub.calibration.evidenceReferences = ["sample:-bad"]; pub.calibration.sampleSize = 1; }],
    [(pub) => { pub.calibration.evidenceReferences = ["sample:.hidden"]; pub.calibration.sampleSize = 1; }],
    [(pub) => { pub.calibration.evidenceReferences = ["sample:a.b"]; pub.calibration.sampleSize = 1; }],
    [(pub) => { pub.calibration.evidenceReferences = [`sample:A${"a".repeat(64)}`]; pub.calibration.sampleSize = 1; }],
  ];
  for (const [fn] of badRefs) await corruptAndTest(fn);

  const validSuffixes = ["a_b", "A" + "a".repeat(63)];
  for (const [index, suffix] of validSuffixes.entries()) {
    const home = await mkdtemp(path.join(tmpdir(), "fl-pub-prov+"));
    const store = new StateStore(home);
    createTaskWithProfile(store, "t", "cl", "pr", TS);
    saveSample(store, { sampleId: suffix, forklightTaskId: "t", exactTaskClass: "cl", directCodexProfileId: "pr",
      directRunRef: `codex-run:v${index}`, pairingRef: `pair:v${index}` });
    saveReview(store, suffix, "accepted");
    registerDirectCodexPublication(store, { ...POLICY, taskClass: "cl", directCodexProfileId: "pr", confirm: true });

    const p = buildDirectCodexPublicationPreview(store, { taskClass: "cl", directCodexProfileId: "pr" });
    assert.equal(p.readiness, "no-new-evidence");
    store.close();
  }
});
