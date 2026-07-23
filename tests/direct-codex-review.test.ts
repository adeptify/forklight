import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDirectCodexSampleReview,
} from "../src/core/direct-codex-review.js";

const TS = "2026-07-23T12:00:00.000Z";

function validAccepted(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    sampleId: "smp-test", decision: "accepted", reviewer: "main-codex",
    reviewedAt: TS, schemaVersion: 1, ...overrides,
  };
}

function validRejected(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    sampleId: "smp-rej", decision: "rejected",
    rejectionReason: "insufficient-quality", reviewer: "main-codex",
    reviewedAt: TS, schemaVersion: 1, ...overrides,
  };
}

function assertFrozen(v: unknown, path = "root"): void {
  if (v === null || typeof v !== "object") return;
  assert.ok(Object.isFrozen(v), `Expected ${path} frozen`);
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) assertFrozen(v[i], `${path}[${i}]`); }
  else { for (const k of Object.keys(v as Record<string, unknown>))
    assertFrozen((v as Record<string, unknown>)[k], `${path}.${k}`); }
}

// --- Normalizer validation ---

test("null/non-object input → TypeError", () => {
  for (const v of [null, undefined, "string", 123, true, []]) {
    assert.throws(() => normalizeDirectCodexSampleReview(v), {
      name: "TypeError", message: "Invalid direct-Codex sample review",
    });
  }
});

test("extra keys → rejected without echoing", () => {
  assert.throws(
    () => normalizeDirectCodexSampleReview({ ...validAccepted(), apiKey: "sk-secret" }),
    { name: "TypeError", message: "Invalid direct-Codex sample review" },
  );
  assert.throws(
    () => normalizeDirectCodexSampleReview({ ...validAccepted(), notes: "free text" }),
    { name: "TypeError", message: "Invalid direct-Codex sample review" },
  );
});

test("content-bearing fields → rejected (privacy)", () => {
  const rawFields = ["text", "content", "prompt", "body", "payload", "raw",
    "secret", "credential", "log", "response", "diff", "hash", "modelConfig", "notes", "reason", "detail", "evidence", "source"];
  for (const f of rawFields) {
    assert.throws(
      () => normalizeDirectCodexSampleReview({ ...validAccepted(), [f]: "leaked" }),
      { name: "TypeError", message: "Invalid direct-Codex sample review" },
      `Should reject field: ${f}`,
    );
  }
});

test("missing required keys → rejected", () => {
  for (const key of ["sampleId", "decision", "reviewer", "reviewedAt", "schemaVersion"]) {
    const { [key]: _, ...partial } = validAccepted();
    assert.throws(() => normalizeDirectCodexSampleReview(partial), {
      name: "TypeError", message: "Invalid direct-Codex sample review",
    });
  }
});

test("invalid decision value → rejected", () => {
  assert.throws(() => normalizeDirectCodexSampleReview(validAccepted({ decision: "pending" })), TypeError);
  assert.throws(() => normalizeDirectCodexSampleReview(validAccepted({ decision: "APPROVED" })), TypeError);
  assert.throws(() => normalizeDirectCodexSampleReview(validAccepted({ decision: "" })), TypeError);
  assert.throws(() => normalizeDirectCodexSampleReview(validAccepted({ decision: 1 })), TypeError);
  assert.throws(() => normalizeDirectCodexSampleReview(validAccepted({ decision: null })), TypeError);
});

test("invalid sampleId → rejected", () => {
  for (const bad of ["", " ", "-bad", "bad!", "x".repeat(65), 123, true, null]) {
    assert.throws(() => normalizeDirectCodexSampleReview(validAccepted({ sampleId: bad })), TypeError);
  }
});

test("invalid reviewer → rejected", () => {
  assert.throws(() => normalizeDirectCodexSampleReview(validAccepted({ reviewer: "human" })), TypeError);
  assert.throws(() => normalizeDirectCodexSampleReview(validAccepted({ reviewer: "mcp" })), TypeError);
  assert.throws(() => normalizeDirectCodexSampleReview(validAccepted({ reviewer: "" })), TypeError);
});

test("invalid reviewedAt → rejected", () => {
  for (const bad of ["bad-date", "2026-07-23", "2026-07-23T12:00:00", "", " ", 123]) {
    assert.throws(() => normalizeDirectCodexSampleReview(validAccepted({ reviewedAt: bad })), TypeError);
  }
});

test("invalid schemaVersion → rejected", () => {
  assert.throws(() => normalizeDirectCodexSampleReview(validAccepted({ schemaVersion: 2 })), TypeError);
  assert.throws(() => normalizeDirectCodexSampleReview(validAccepted({ schemaVersion: 0 })), TypeError);
  assert.throws(() => normalizeDirectCodexSampleReview(validAccepted({ schemaVersion: "1" })), TypeError);
});

test("accepted must not carry rejectionReason", () => {
  assert.throws(
    () => normalizeDirectCodexSampleReview({ ...validAccepted(), rejectionReason: "duplicate-evidence" }),
    { name: "TypeError", message: "Invalid direct-Codex sample review" },
  );
});

test("rejected missing rejectionReason → rejected", () => {
  const { rejectionReason: _, ...without } = validRejected();
  assert.throws(() => normalizeDirectCodexSampleReview(without), {
    name: "TypeError", message: "Invalid direct-Codex sample review",
  });
});

test("invalid rejectionReason → rejected", () => {
  for (const bad of ["", "bad-reason", "accepted", "insufficient-quality ", " free-text ", "x", 123, null]) {
    assert.throws(() => normalizeDirectCodexSampleReview(validRejected({ rejectionReason: bad })), TypeError);
  }
});

test("valid accepted/rejected → detached deeply-frozen canonical", () => {
  const ra = normalizeDirectCodexSampleReview(validAccepted());
  assert.equal(ra.sampleId, "smp-test"); assert.equal(ra.decision, "accepted");
  assert.equal(ra.reviewer, "main-codex"); assert.equal("rejectionReason" in ra, false);
  assertFrozen(ra);
  const rr = normalizeDirectCodexSampleReview(validRejected());
  assert.equal(rr.decision, "rejected"); assert.equal(rr.rejectionReason, "insufficient-quality");
  assertFrozen(rr);
  // All enum reasons accepted
  for (const reason of ["not-equivalent-task", "insufficient-quality", "incomplete-evidence", "duplicate-evidence"] as const) {
    const r = normalizeDirectCodexSampleReview(validRejected({ rejectionReason: reason }));
    assert.equal(r.rejectionReason, reason);
  }
  // Detached copy
  const r2 = normalizeDirectCodexSampleReview(ra);
  assert.deepEqual(r2, ra); assert.notEqual(r2, ra);
  // Frozen → mutations rejected
  assert.throws(() => { (ra as any).sampleId = "hacked"; }, TypeError);
  assert.throws(() => { (ra as any).extra = "injected"; }, TypeError);
});

test("error messages never echo untrusted values", () => {
  const secret = "sk-leaked-key-999";
  // Bad sampleId (null — always invalid) → error must not echo
  try {
    normalizeDirectCodexSampleReview(validAccepted({ sampleId: null }));
    assert.fail("Expected error");
  } catch (e: any) {
    assert.ok(!e.message.includes("null"));
    assert.equal(e.message, "Invalid direct-Codex sample review");
  }
  // Content field value → error must not echo it
  try {
    normalizeDirectCodexSampleReview({ ...validAccepted(), raw: secret });
    assert.fail("Expected error");
  } catch (e: any) {
    assert.ok(!e.message.includes(secret), `Error echoed secret: ${e.message}`);
    assert.equal(e.message, "Invalid direct-Codex sample review");
  }
  // Free-form rejection reason → error must not echo it
  try {
    normalizeDirectCodexSampleReview(validRejected({ rejectionReason: secret }));
    assert.fail("Expected error");
  } catch (e: any) {
    assert.ok(!e.message.includes(secret), `Error echoed secret: ${e.message}`);
    assert.equal(e.message, "Invalid direct-Codex sample review");
  }
});
