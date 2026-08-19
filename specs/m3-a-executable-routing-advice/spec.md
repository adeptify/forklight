# M3-A Work Item — Executable routing advice

## User result

For one exact task class and an optional stable task family, Main receives one read-only answer that
either recommends a currently usable Worker Profile with its complete Runtime/model/effort/execution
identity and confidence, or explicitly says `cannot-determine`. Historical quality and current
launch readiness remain separate facts: a historical winner that cannot launch is never presented
as an executable recommendation.

## Background and current evidence

ForkLight already derives exact-class and task-family evidence from terminal ordinary Tasks, uses
Main failure attribution to keep non-model failures out of model-quality penalties, and returns an
evidence-scoped routing advisory through Daemon, CLI and MCP. Existing focused tests pass 443/443.

The current Store has 313 eligible terminal Tasks, 277 task classes and 49 explicit task families,
but only two durable multi-Worker decisions recorded comparable family evidence. Read-only live
queries over natural history demonstrate the intended fail-closed behavior:

- `forklight-storage-lifecycle` recommends the current `default` DeepSeek Pro Profile at family
  scope with confidence `0.909090...`;
- `worker-runtime` and `hub-product-comprehension` both have multiple candidates and sufficient
  samples, but the score gap is too small, so they return `knowledge: unknown`;
- an unseen family returns scope `none`, excludes both candidates for insufficient evidence and
  does not advise Competition when Main intent is `none`.

The direct M3 gap is at the end of the call chain. `RoutingRecommendation` omits Runtime, effort,
resolved execution mode and current readiness even though Profile resolution and Worker readiness
already know those facts. As a result Main cannot tell from one response whether the historical
choice is currently launchable or which execution strategy would actually run.

## `depends_on`

- M2 is graduated and the activated client/Daemon build identities match.
- Existing exact failure attribution, routing statistics, Profile resolution, execution-mode
  resolution and Worker-readiness semantics remain authoritative inputs.
- This Work Item does not depend on M3-B manual-override persistence or M3-C policy learning.
- It may share an implementation wave only with the exact M3-C Competition execution-truth slice,
  whose writable paths are disjoint. Main integrates the Candidates serially.

## Inputs

- exact `taskClass`, optional explicit `taskFamily`;
- either 2–10 saved Worker Profile ids or legacy explicit candidate identities;
- current routing policy and exact/family historical evidence;
- current saved Profile, Runtime capability and Provider/readiness truth;
- explicit Competition intent and triggers already accepted by the routing advisory.

## Outputs

- one canonical read-only advisory shared by CLI, MCP and Daemon;
- a stable top-level result code distinguishing at least `recommended`, `cannot-determine`, and
  `historical-best-not-launchable`;
- when evidence recommends a Profile, its provider, model, Runtime, effort, Worker Profile id and
  label, current resolved execution mode, readiness state, `canLaunch`, next action and confidence;
- per-candidate historical evidence and current readiness remain visible as separate fields;
- legacy explicit candidates that cannot be resolved to a saved Profile never receive invented
  execution mode or readiness;
- no Task, Competition, Review Graph, probe or Store mutation.

## Allowed paths and ownership

One Grok 4.6 Xhigh native Goal Writer owns only:

- `src/core/model-routing.ts`
- `src/daemon/coordinator.ts`
- `src/cli.ts`
- `src/cli/routing-output.ts`
- `src/mcp/server.ts`
- `tests/model-routing.test.ts`
- `tests/daemon-cli.test.ts`
- `tests/mcp.test.ts`

Main alone updates this Spec and Goal SSOT/evidence. M3-C's first-wave Writer owns only
`src/core/competition.ts` and `tests/competition.test.ts`; the two path sets have zero intersection.

## Required behavior and call chain

1. `StatisticsService` derives exact evidence, with complete-set task-family fallback only when
   exact evidence is insufficient. Existing failure-attribution semantics remain unchanged.
2. Profile-bound candidates resolve their immutable provider/model/Runtime/effort identity and
   current execution mode through existing Profile and Runtime capability rules.
3. The existing model-routing scorer evaluates historical evidence without readiness rewriting
   scores or silently substituting a lower-ranked candidate.
4. Coordinator attaches the current bounded Worker-readiness projection to Profile-bound rows.
5. The canonical response distinguishes historical recommendation from executable recommendation:
   a non-launchable historical winner is reported, but Main is told it cannot currently execute.
6. CLI human output and MCP structured output use the same response. `unknown` is rendered as
   `cannot determine` with stable reasons, not as a tie or implicit preference.
7. Competition advice remains exceptional and requires Main's existing explicit intent; sparse or
   close evidence alone never starts or advises Competition under intent `none`.

## Acceptance

1. A Profile-backed recommendation carries provider/model/Runtime/effort/Profile plus resolved
   execution mode, readiness, `canLaunch`, confidence, evidence scope and next action.
2. Historical score and current readiness are independent: readiness cannot alter evidence scores,
   and an unavailable winner is not silently replaced.
3. Insufficient samples, only one comparable identity, no active factors and insufficient score
   gap all return the stable `cannot-determine` result with bounded machine-readable reasons.
4. Current natural Store queries for the three representative families preserve their observed
   recommendation/unknown results without creating or rerunning Tasks.
5. Legacy candidate input remains backward compatible and never fabricates Profile, execution or
   readiness facts.
6. CLI help documents Profile/family/Competition options already accepted by the parser; CLI JSON,
   human output, MCP and Daemon agree on the canonical result.
7. Response remains privacy-safe: no endpoints, credentials, absolute paths, prompts, raw notes or
   Provider diagnostics.
8. ForkLight independent verification passes, two independent read-only Judges inspect evidence
   truth and compatibility, and Main integrates only the exact accepted Revision.

## Verification commands

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/model-routing.test.ts tests/worker-readiness.test.ts tests/daemon-cli.test.ts tests/mcp.test.ts
git diff --check
```

After activation, Main repeats only the four read-only routing queries recorded above. No synthetic
Task, Competition or Provider run is permitted to improve the result. `npm run check` is reserved
for the high-risk M3 Integration checkpoint or Milestone boundary.

## Forbidden and non-goals

- No Task admission schema, `RoutingDecisionSnapshot`, manual override, Competition candidate,
  Review Graph, Judge gate, Store, Provider Runtime, Integration or storage-lifecycle change.
- No Hub/UI path before M5.
- No global model ranking, automatic Worker switch, automatic Competition, probe, retry, fallback,
  benchmark Task, manufactured rerun or inferred task family.
- No confidence inflation, synthetic zero for missing evidence, hidden readiness substitution,
  checksum, content hash, lock, lease, handshake, migration or multi-user/distributed mechanism.
- Stop if truthful output requires changing admission or durable decision semantics; that belongs
  to M3-B. Stop after two purposeful rounds repeat the same failure or add no material evidence.

## Handoff and workspace disposition

The Worker hands off the exact response contract, changed paths, focused verification, four live
read-only outputs and any bounded compatibility risk. ForkLight independently verifies one exact
Candidate Revision. Two Judges review historical/readiness separation and public-surface stability;
Main makes the final decision and integrates serially. Protect the implementation and Judge
Workspaces until Integration, activation and live queries are durable; terminal reclamation then
follows the accepted M2 lifecycle rather than manual deletion.

## Completion evidence — 2026-08-16

- ForkLight Task `293724e0-5873-4bb1-9eef-3d685cf56bcf`, Session
  `3696733d-e512-4322-8c35-fd6b22bc11dd`, delivered exact Revision
  `c1538142-703e-4994-9869-745cde9739da` with digest
  `75ad2645ef41a22ac31364a477915d8ad80be1d72de18d8dd4a726f63dc75525` across the eight allowed
  paths and 982 changed lines.
- C1 activation interrupted the first Attempt during active work. ForkLight resumed the same
  Task, Session and Workspace through system-restart continuation; the second Attempt completed.
  This was not a replacement, model switch or Main correction.
- Independent verification passed the three accepted commands with unrelated source drift only.
  Review Graph `877dfabf-c95a-498d-b67e-21637c781377` ended with two usable `accept` opinions.
  One DeepSeek opinion needed the authorized one-shot same-Judge schema-only result repair; the
  Candidate was not rerun and no Judge identity was changed or added.
- Main inspected the exact diff and accepted the Revision. Integration operation
  `f249f15d-44ce-41ee-8fae-84220cdc95f1` passed source apply, three source verifications, artifact
  build and Runtime activation. The source `npm run check` then passed 2,984/2,984 tests and the
  idle Daemon was restarted to the exact client build.
- Activated read-only queries preserve natural history: `forklight-storage-lifecycle` recommends
  DeepSeek Pro with confidence `0.909090...` and complete launchable single-run identity;
  `worker-runtime` and `hub-product-comprehension` return `cannot-determine` with
  `score-gap-too-small`; an unseen family returns `cannot-determine` with
  `insufficient-relevant-samples`. All four retain Competition intent `none` and start no work.

Acceptance 1–8 pass. Three non-blocking observations are recorded once under Goal Later rather
than widening this Work Item: an internal call without a readiness map can omit a reason, future
asynchronous adapter doctors would need explicit handling, and the generated reviewer packet used
generic 1-file/1-line guidance despite this Task's accepted 8-file/1,200-line warning budget.
