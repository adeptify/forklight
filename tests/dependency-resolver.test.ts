import assert from "node:assert/strict";
import test from "node:test";
import {
  isMaterialCandidateRevision,
  resolveReadiness,
  type DependencyDecision,
} from "../src/core/dependency-resolver.js";
import type { CandidateRevision, TaskStatus } from "../src/core/types.js";

interface ReadinessCase {
  name: string;
  dependencies: string[];
  states: Array<[string, TaskStatus | undefined]>;
  expected: DependencyDecision;
}

const cases: ReadinessCase[] = [
  {
    name: "an item without dependencies is ready",
    dependencies: [],
    states: [],
    expected: { kind: "ready" },
  },
  {
    name: "all succeeded dependencies are ready",
    dependencies: ["a", "b"],
    states: [["a", "succeeded"], ["b", "succeeded"]],
    expected: { kind: "ready" },
  },
  {
    name: "non-terminal and missing dependencies remain waiting",
    dependencies: ["queued", "interrupted", "missing"],
    states: [["queued", "queued"], ["interrupted", "interrupted"]],
    expected: { kind: "waiting", waitingOn: ["queued", "interrupted", "missing"] },
  },
  {
    name: "failed dependencies dominate but waiting evidence remains visible",
    dependencies: ["failed-a", "running", "failed-b", "done"],
    states: [
      ["failed-a", "failed"],
      ["running", "running"],
      ["failed-b", "failed"],
      ["done", "succeeded"],
    ],
    expected: {
      kind: "blocked",
      failedBy: ["failed-a", "failed-b"],
      waitingOn: ["running"],
    },
  },
];

for (const example of cases) {
  test(example.name, () => {
    assert.deepEqual(
      resolveReadiness("item", example.dependencies, new Map(example.states)),
      example.expected,
    );
  });
}

test("every TaskStatus follows one deterministic branch", () => {
  const statuses: Array<TaskStatus | undefined> = [
    undefined,
    "queued",
    "preparing",
    "running",
    "verifying",
    "succeeded",
    "failed",
    "interrupted",
  ];
  for (const status of statuses) {
    const decision = resolveReadiness("item", ["dependency"], new Map([["dependency", status]]));
    if (status === "succeeded") assert.deepEqual(decision, { kind: "ready" });
    else if (status === "failed") {
      assert.deepEqual(decision, { kind: "blocked", failedBy: ["dependency"], waitingOn: [] });
    } else assert.deepEqual(decision, { kind: "waiting", waitingOn: ["dependency"] });
  }
});

test("the resolver neither mutates inputs nor depends on the correlation item ID", () => {
  const dependencies = ["dependency"];
  const states = new Map<string, TaskStatus | undefined>([["dependency", "succeeded"]]);
  assert.deepEqual(resolveReadiness("first", dependencies, states), { kind: "ready" });
  assert.deepEqual(resolveReadiness("second", dependencies, states), { kind: "ready" });
  assert.deepEqual(dependencies, ["dependency"]);
  assert.equal(states.get("dependency"), "succeeded");
});

test("material Candidate completion map holds independent-Plan dependents until delivery", () => {
  const states = new Map<string, TaskStatus | undefined>([["upstream", "succeeded"]]);
  assert.deepEqual(
    resolveReadiness(
      "consumer",
      ["upstream"],
      states,
      undefined,
      new Map([["upstream", false]]),
    ),
    { kind: "waiting", waitingOn: ["upstream"] },
  );
  assert.deepEqual(
    resolveReadiness(
      "consumer",
      ["upstream"],
      states,
      undefined,
      new Map([["upstream", true]]),
    ),
    { kind: "ready" },
  );
  // Goal gate authority still dominates when provided.
  assert.deepEqual(
    resolveReadiness(
      "consumer",
      ["upstream"],
      new Map([["upstream", "failed"]]),
      new Map([["upstream", true]]),
      new Map([["upstream", false]]),
    ),
    { kind: "ready" },
  );
});

test("isMaterialCandidateRevision distinguishes delivery-pending work from verification-only", () => {
  const base: CandidateRevision = {
    id: "rev-1",
    taskId: "task-1",
    attemptId: "attempt-1",
    attemptOrdinal: 1,
    verificationEventSequence: 1,
    patchDigest: "a".repeat(64),
    affectedPaths: ["src/a.ts"],
    filesChanged: 1,
    changedLines: 3,
    verificationPassed: true,
    createdAt: "2026-08-09T00:00:00.000Z",
  };
  assert.equal(isMaterialCandidateRevision(undefined), false);
  assert.equal(isMaterialCandidateRevision(base), true);
  assert.equal(isMaterialCandidateRevision({ ...base, filesChanged: 0 }), false);
  assert.equal(isMaterialCandidateRevision({ ...base, affectedPaths: [] }), false);
});
