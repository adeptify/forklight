// Direct-Codex paired-sample calibration acceptance tests.
import assert from "node:assert/strict";
import test from "node:test";
import { grossDirectCodexTokens, normalizeDirectCodexPairedSample, normalizeDirectCodexProfileId, normalizeDirectCodexProfilePublication, publishDirectCodexCalibration } from "../src/core/direct-codex-calibration.js";

const TS = "2026-07-23T12:00:00.000Z";
function attrs(o?: Record<string, unknown>): Record<string, unknown> {
  const b: Record<string, unknown> = {
    sampleId: "s1", forklightTaskId: "task-a1b", exactTaskClass: "edit-task",
    directCodexProfileId: "profileA",
    inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 200, cacheCreationInputTokens: 50,
    source: "codex-terminal-result", complete: true,
    directRunRef: "codex-run:a1b2c3d4", pairingRef: "pair:xyz-789",
    capturedAt: TS, schemaVersion: 1,
  };
  if (o) for (const [k, v] of Object.entries(o)) { if (v === undefined) delete b[k]; else b[k] = v; }
  return b;
}


test("valid sample normalizes to detached deeply-frozen canonical; no raw fields", () => {
  const s = normalizeDirectCodexPairedSample(attrs());
  assert.equal(s.sampleId, "s1"); assert.equal(s.forklightTaskId, "task-a1b");
  assert.equal(s.exactTaskClass, "edit-task");
  assert.equal(s.directCodexProfileId, "profileA");
  assert.equal(s.inputTokens, 1000); assert.equal(s.outputTokens, 500);
  assert.equal(s.cacheReadInputTokens, 200); assert.equal(s.cacheCreationInputTokens, 50);
  assert.equal(s.source, "codex-terminal-result"); assert.equal(s.complete, true);
  assert.equal(s.directRunRef, "codex-run:a1b2c3d4"); assert.equal(s.pairingRef, "pair:xyz-789");
  assert.equal(s.capturedAt, TS); assert.equal(s.schemaVersion, 1);
  assert.ok(Object.isFrozen(s));
  for (const f of ["text", "content", "prompt", "raw", "secret"]) assert.equal(f in s, false);
});

test("rejects missing/extra/raw keys, null, non-ISO timestamps, bad source/completeness/schema", () => {
  const b = attrs();
  for (const k of Object.keys(b)) {
    const { [k]: _, ...p } = b;
    assert.throws(() => normalizeDirectCodexPairedSample(p), TypeError, `missing: ${k}`);
  }
  assert.throws(() => normalizeDirectCodexPairedSample({ ...b, extra: 1 }), TypeError);
  for (const f of ["text", "content", "prompt", "raw", "secret", "credential", "log"])
    assert.throws(() => normalizeDirectCodexPairedSample({ ...b, [f]: "leak" }), TypeError);
  assert.throws(() => normalizeDirectCodexPairedSample(null), TypeError);
  assert.throws(() => normalizeDirectCodexPairedSample(attrs({ capturedAt: "bad" })), TypeError);
  assert.throws(() => normalizeDirectCodexPairedSample(attrs({ capturedAt: "2026-07-23T12:00:00Z" })), TypeError);
  assert.throws(() => normalizeDirectCodexPairedSample(attrs({ source: "terminal-result" })), TypeError);
  assert.throws(() => normalizeDirectCodexPairedSample(attrs({ complete: false })), TypeError);
  assert.throws(() => normalizeDirectCodexPairedSample(attrs({ schemaVersion: 2 })), TypeError);
});

test("rejects invalid Token components, missing component, gross overflow", () => {
  for (const [f, v] of [["inputTokens", -1], ["outputTokens", 1.5], ["cacheReadInputTokens", Number.MAX_SAFE_INTEGER + 1]] as [string, unknown][])
    assert.throws(() => normalizeDirectCodexPairedSample(attrs({ [f]: v })), TypeError);
  const missing = { ...attrs() }; delete (missing as any).inputTokens;
  assert.throws(() => normalizeDirectCodexPairedSample(missing), TypeError);
  assert.throws(() => normalizeDirectCodexPairedSample(attrs({
    inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
  })), TypeError);
});

test("rejects non-strict tokens and non-opaque refs; whitespace not trimmed", () => {
  for (const s of ["", "-bad", "has space", "a:b"]) {
    assert.throws(() => normalizeDirectCodexPairedSample(attrs({ sampleId: s })), TypeError);
    assert.throws(() => normalizeDirectCodexPairedSample(attrs({ forklightTaskId: s })), TypeError);
  }
  for (const r of ["", "not-a-ref", ":missing", "Bad:val", "run:has space"])
    assert.throws(() => normalizeDirectCodexPairedSample(attrs({ directRunRef: r, pairingRef: r })), TypeError);
  assert.throws(() => normalizeDirectCodexPairedSample(attrs({ sampleId: " s1 " })), TypeError);
  assert.throws(() => normalizeDirectCodexPairedSample(attrs({ directRunRef: " run:x " })), TypeError);
});

test("error messages never echo untrusted values; caller input unfrozen", () => {
  const secret = "leaked-secret-abc123";
  for (const fn of [
    () => normalizeDirectCodexPairedSample(attrs({ sampleId: secret })),
    () => normalizeDirectCodexPairedSample({ ...attrs(), extraKey: secret }),
    () => normalizeDirectCodexPairedSample({ ...attrs(), prompt: secret }),
  ]) { try { fn(); assert.fail("Expected"); } catch (e: any) { assert.ok(!e.message.includes(secret)); } }
  const input = attrs();
  assert.equal(Object.isFrozen(input), false);
  normalizeDirectCodexPairedSample(input);
  assert.equal(Object.isFrozen(input), false);
});


test("grossDirectCodexTokens validates unknown input; rejects bad values", () => {
  assert.equal(grossDirectCodexTokens(attrs()), 1750);
  assert.equal(grossDirectCodexTokens(attrs({ inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 })), 0);
  assert.throws(() => grossDirectCodexTokens(null), TypeError);
  assert.throws(() => grossDirectCodexTokens({ ...attrs(), inputTokens: -1 }), TypeError);
});


const PP = { method: "paired-sample-v1", confidence: "low" as const, version: 1, taskClass: "edit-task", directCodexProfileId: "profileA", createdAt: TS };

test("single sample → min==max, sampleSize 1, explicit policy preserved", () => {
  const r = publishDirectCodexCalibration([normalizeDirectCodexPairedSample(attrs())], PP);
  assert.equal(r.calibration.minTokens, 1750); assert.equal(r.calibration.maxTokens, 1750);
  assert.equal(r.calibration.sampleSize, 1); assert.equal(r.calibration.taskClass, "edit-task");
  assert.equal(r.calibration.method, "paired-sample-v1"); assert.equal(r.calibration.confidence, "low");
  assert.equal(r.calibration.version, 1); assert.equal(r.calibration.evidenceReferences[0], "sample:s1");
});

test("multiple samples → observed min/max, one opaque ref per sample", () => {
  const r = publishDirectCodexCalibration([
    normalizeDirectCodexPairedSample(attrs()),
    normalizeDirectCodexPairedSample(attrs({ sampleId: "s2", forklightTaskId: "task-c3d", directRunRef: "codex-run:e5f6", pairingRef: "pair:abc-111", inputTokens: 500, outputTokens: 250, cacheReadInputTokens: 100, cacheCreationInputTokens: 25 })),
    normalizeDirectCodexPairedSample(attrs({ sampleId: "s3", forklightTaskId: "task-e7f", directRunRef: "codex-run:g8h9", pairingRef: "pair:def-222", inputTokens: 2000, outputTokens: 1000, cacheReadInputTokens: 400, cacheCreationInputTokens: 100 })),
  ], PP);
  assert.equal(r.calibration.sampleSize, 3);
  assert.equal(r.calibration.minTokens, 875); assert.equal(r.calibration.maxTokens, 3500);
  assert.deepEqual(r.calibration.evidenceReferences, ["sample:s1", "sample:s2", "sample:s3"]);
});

test("publisher requires explicit taskClass; rejects sample class mismatch", () => {
  const s = normalizeDirectCodexPairedSample(attrs());
  assert.throws(() => publishDirectCodexCalibration([s], { ...PP, taskClass: "   " }), /taskClass/);
  assert.throws(() => publishDirectCodexCalibration([s], { ...PP, taskClass: "other-class" }), /taskClass/);
});

test("publisher rejects duplicate sampleId, forklightTaskId, directRunRef, pairingRef", () => {
  const s = normalizeDirectCodexPairedSample(attrs());
  const sFid = normalizeDirectCodexPairedSample(attrs({ sampleId: "s-dup-fid", directRunRef: "codex-run:dup-fid-a1", pairingRef: "pair:dup-fid-b1" }));
  assert.throws(() => publishDirectCodexCalibration([s, sFid], PP), /Duplicate forklightTaskId/);
  const sId = normalizeDirectCodexPairedSample(attrs({ forklightTaskId: "task-dup-id", directRunRef: "codex-run:dup-id-a2", pairingRef: "pair:dup-id-b2" }));
  assert.throws(() => publishDirectCodexCalibration([s, sId], PP), /Duplicate sampleId/);
  const sRun = normalizeDirectCodexPairedSample(attrs({ sampleId: "s-dup-run", forklightTaskId: "task-dup-run", pairingRef: "pair:dup-run-b3" }));
  assert.throws(() => publishDirectCodexCalibration([s, sRun], PP), /Duplicate directRunRef/);
  const sPair = normalizeDirectCodexPairedSample(attrs({ sampleId: "s-dup-pair", forklightTaskId: "task-dup-pair", directRunRef: "codex-run:dup-pair-a4" }));
  assert.throws(() => publishDirectCodexCalibration([s, sPair], PP), /Duplicate pairingRef/);
});

test("publisher rejects invalid policy params; validates 1–50 samples", () => {
  const s = normalizeDirectCodexPairedSample(attrs());
  assert.throws(() => publishDirectCodexCalibration([], PP), /1–50/);
  assert.throws(() => publishDirectCodexCalibration([s], { ...PP, method: "" }), /method/);
  assert.throws(() => publishDirectCodexCalibration([s], { ...PP, confidence: "extreme" as any }), /confidence/);
  assert.throws(() => publishDirectCodexCalibration([s], { ...PP, version: 0 }), /version/);
  assert.throws(() => publishDirectCodexCalibration([s], { ...PP, createdAt: "bad" }), /createdAt/);
  for (const directCodexProfileId of ["", " ", "-bad", undefined]) {
    assert.throws(() => publishDirectCodexCalibration([s], { ...PP, directCodexProfileId: directCodexProfileId as any }), /directCodexProfileId/);
  }
});

test("published envelope deterministic and deeply frozen; caller inputs unfrozen", () => {
  const input = attrs();
  const s = normalizeDirectCodexPairedSample(input);
  const r1 = publishDirectCodexCalibration([s], PP);
  const r2 = publishDirectCodexCalibration([s], PP);
  assert.deepEqual(r1, r2); assert.notEqual(r1, r2);
  assert.deepEqual(Object.keys(r1).sort(), ["calibration", "directCodexProfileId", "envelopeSchemaVersion"]);
  assert.ok(Object.isFrozen(r1)); assert.ok(Object.isFrozen(r1.calibration));
  assert.throws(() => { (r1.calibration as any).minTokens = 999; }, TypeError);
  assert.equal(Object.isFrozen(input), false);
});

test("publisher re-normalizes every sample; forged typed inputs rejected", () => {
  const good = normalizeDirectCodexPairedSample(attrs());
  assert.throws(() => publishDirectCodexCalibration([{ ...good, source: "terminal-result" } as any], PP), TypeError);
  const noComplete = { ...good }; delete (noComplete as any).complete;
  assert.throws(() => publishDirectCodexCalibration([noComplete as any], PP), TypeError);
  assert.throws(() => publishDirectCodexCalibration([{ fake: true } as any], PP), TypeError);
});

test("evidence references use sample:<sampleId>; match calibration ref pattern", () => {
  const s = normalizeDirectCodexPairedSample(attrs({ sampleId: "mySample1" }));
  const r = publishDirectCodexCalibration([s], PP);
  assert.equal(r.calibration.evidenceReferences[0], "sample:mySample1");
  assert.match(r.calibration.evidenceReferences[0]!, /^[a-z][a-z0-9-]{1,31}:[A-Za-z0-9._-]{1,128}$/);
});

test("rejects swapped semantic ref prefixes and generic prefixes", () => {
  assert.throws(() => normalizeDirectCodexPairedSample(attrs({ directRunRef: "pair:swapped" })), TypeError);
  assert.throws(() => normalizeDirectCodexPairedSample(attrs({ pairingRef: "codex-run:swapped", directRunRef: "codex-run:x" })), TypeError);
  assert.throws(() => normalizeDirectCodexPairedSample(attrs({ directRunRef: "run:generic" })), TypeError);
  assert.throws(() => normalizeDirectCodexPairedSample(attrs({ pairingRef: "run:generic" })), TypeError);
});

test("exactTaskClass rejects leading/trailing whitespace; never trims", () => {
  for (const tc of [" edit-task", "edit-task ", " edit-task "]) {
    assert.throws(() => normalizeDirectCodexPairedSample(attrs({ exactTaskClass: tc })), TypeError);
  }
  assert.throws(() => publishDirectCodexCalibration(
    [normalizeDirectCodexPairedSample(attrs())], { ...PP, taskClass: " edit-task" }), /taskClass/);
});

test("publisher deterministic for same sample set in different input order", () => {
  const s1 = attrs({ sampleId: "a" });
  const s2 = attrs({ sampleId: "b", forklightTaskId: "task-bbb", directRunRef: "codex-run:bb", pairingRef: "pair:bb", inputTokens: 200, outputTokens: 100, cacheReadInputTokens: 50, cacheCreationInputTokens: 25 });
  const rForward = publishDirectCodexCalibration([s1, s2], PP);
  const rReverse = publishDirectCodexCalibration([s2, s1], PP);
  assert.deepEqual(rForward, rReverse);
  assert.deepEqual(rForward.calibration.evidenceReferences, ["sample:a", "sample:b"]);
  for (const s of [s1, s2]) assert.equal(Object.isFrozen(s), false);
});

test("profile ids are explicit, canonical, and cannot be mixed or inferred", () => {
  for (const id of ["a", "codex-default-v1", "gpt_4o.high.v2"]) {
    const s = normalizeDirectCodexPairedSample(attrs({ directCodexProfileId: id }));
    assert.equal(publishDirectCodexCalibration([s], { ...PP, directCodexProfileId: id }).directCodexProfileId, id);
  }
  for (const id of ["", " x", "x ", "-x", "x/y", "x:y", "é", "a".repeat(65)]) {
    assert.throws(() => normalizeDirectCodexPairedSample(attrs({ directCodexProfileId: id })), TypeError);
  }
  const a = normalizeDirectCodexPairedSample(attrs({ directCodexProfileId: "profileA" }));
  const b = normalizeDirectCodexPairedSample(attrs({ sampleId: "s2", forklightTaskId: "task-b", directRunRef: "codex-run:b", pairingRef: "pair:b", directCodexProfileId: "profileB" }));
  assert.throws(() => publishDirectCodexCalibration([a], { ...PP, directCodexProfileId: "profileB" }), /profile/);
  assert.throws(() => publishDirectCodexCalibration([a, b], PP), /profile/);
});

// --- canonical directCodexProfileId normalizer ---

test("normalizeDirectCodexProfileId accepts valid ids, returns identical string", () => {
  for (const id of ["a", "profileA", "codex-default-v1", "gpt_4o.high.v2", "a".repeat(64)]) {
    assert.equal(normalizeDirectCodexProfileId(id), id);
  }
});

test("normalizeDirectCodexProfileId rejects null, non-string, padded, malformed, oversized, non-ASCII", () => {
  for (const v of [null, undefined, 123, true, [], {}]) {
    assert.throws(() => normalizeDirectCodexProfileId(v), TypeError);
  }
  for (const id of ["", " x", "x ", " x ", "-bad", "x/y", "x:y", "é", "a".repeat(65)]) {
    assert.throws(() => normalizeDirectCodexProfileId(id), TypeError);
  }
});

test("normalizeDirectCodexProfileId error never echoes the invalid value", () => {
  const secret = "secret-leaked-profile-id-123";
  assert.throws(
    () => normalizeDirectCodexProfileId(secret + ":"),
    (e: any) => e instanceof TypeError && !e.message.includes(secret) && e.message.includes("directCodexProfileId"),
  );
  assert.throws(
    () => normalizeDirectCodexProfileId(` ${secret}`),
    (e: any) => e instanceof TypeError && !e.message.includes(secret) && e.message.includes("directCodexProfileId"),
  );
});

test("sample, envelope, and publisher all delegate to canonical profile-id normalizer", () => {
  // All three reject the same invalid profile id consistently
  const badProfile = " has-space ";
  assert.throws(() => normalizeDirectCodexPairedSample(attrs({ directCodexProfileId: badProfile })), /directCodexProfileId/);
  const good = normalizeDirectCodexPairedSample(attrs());
  assert.throws(() => publishDirectCodexCalibration([good], { ...PP, directCodexProfileId: badProfile }), /directCodexProfileId/);
  const env = mutableEnvelopeFP();
  env.directCodexProfileId = badProfile;
  assert.throws(() => normalizeDirectCodexProfilePublication(env), /directCodexProfileId/);
});

function mutableEnvelopeFP(): Record<string, any> {
  const built = publishDirectCodexCalibration([attrs()], PP);
  return { ...built, calibration: { ...built.calibration, evidenceReferences: [...built.calibration.evidenceReferences] } };
}

function mutableEnvelope(): Record<string, any> {
  const built = publishDirectCodexCalibration([attrs()], PP);
  return { ...built, calibration: { ...built.calibration, evidenceReferences: [...built.calibration.evidenceReferences] } };
}

test("publication normalizer validates exact shape, detaches, and does not echo invalid values", () => {
  const input = mutableEnvelope();
  const a = normalizeDirectCodexProfilePublication(input);
  const b = normalizeDirectCodexProfilePublication(input);
  assert.deepEqual(a, b); assert.notEqual(a, b); assert.notEqual(a.calibration, b.calibration);
  assert.ok(Object.isFrozen(a)); assert.ok(Object.isFrozen(a.calibration.evidenceReferences));
  assert.equal(Object.isFrozen(input), false); assert.equal(Object.isFrozen(input.calibration), false);
  const drop = (key: string) => { const { [key]: _, ...rest } = input; return rest; };
  const invalid: unknown[] = [null, [], drop("directCodexProfileId"), drop("calibration"),
    drop("envelopeSchemaVersion"), { ...input, extra: true },
    { ...input, directCodexProfileId: " bad" }, { ...input, envelopeSchemaVersion: 2 },
    { ...input, calibration: { ...input.calibration, minTokens: -1 } }];
  for (const value of invalid) assert.throws(() => normalizeDirectCodexProfilePublication(value), TypeError);
  const secret = "leaked-secret-abc-xyz";
  for (const value of [{ ...input, [secret]: true }, { ...input, directCodexProfileId: `${secret}:` },
    { ...input, calibration: { ...input.calibration, createdAt: secret } }]) {
    try { normalizeDirectCodexProfilePublication(value); assert.fail("Expected"); }
    catch (error: any) { assert.ok(error instanceof TypeError); assert.ok(!error.message.includes(secret)); }
  }
});
