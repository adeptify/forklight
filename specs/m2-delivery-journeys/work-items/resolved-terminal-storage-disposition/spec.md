# M2 resolved terminal Task — storage disposition precedence

## User result

When Main explicitly resolves a terminal Task, ForkLight can reclaim only its regenerable
Workspace data after durable Candidate evidence is safe, even if an older decision packet still
describes review, Main-decision, or Integration work that is no longer required. Active or unsafe
work remains protected.

## Background and current evidence

The M2 product fix and exact non-Coding Candidate recovery both completed verification, review,
Main Integration, activation, and three serial zero-change audits. Main accepted and then explicitly
resolved all six audit Tasks as handled by their integrated parent delivery:

- `f5d1142a-6eca-4d4c-8c43-801d0b284056`
- `ed0f3982-1c23-408a-a82f-4bc7ee9c43a5`
- `03090843-548b-4aec-8271-f5307344b17a`
- `710135bc-3af5-41da-bc8e-8365c4580f3d`
- `83ac853d-28bc-401c-a234-aed2f34a494e`
- `827ab13b-40ff-469d-be02-2e0c3e3b9e9b`

The real storage audit still classifies them as `protected/awaiting-main-decision` and retains
exactly 685,377,515 regenerable bytes. Focused tracing shows `classifyKnownTask` reads the latest
`task.resolution.completed` event, but older packet checks for missing/stale review,
`protect-candidate`, `ready-for-integration`, and similar next actions return before the existing
`resolvedReady` branch. The current regression covers only a failed terminal Task without an
authentic succeeded Candidate/Main-decision packet, so it does not prove this path.

This is a concrete M2-C terminal-lifecycle blocker. It is not a reason for a second disposition
state machine, Store migration, duplicated validation, or distributed coordination.

## `depends_on`

- `execution/m2-handoff-execution-truth/goal.json` completed 4/4; its Candidate was verified,
  accepted by two Judges, safely integrated, activated, and audited.
- `execution/m2-noncoding-candidate-recovery/goal.json` completed 4/4; its exact documentation
  Candidate was verified, accepted by one Judge, safely integrated, activated, and audited.
- The source boundary check passed 2,940/2,940 tests; Store quick-check is `ok`, foreign-key
  violations are zero, unknown-orphan count/bytes are zero, and process count is zero.
- Five already eligible implementation/Judge Tasks were reclaimed through the product path,
  removing 350,389,871 regenerable bytes while retaining 4,574,077 durable bytes.
- This supplement runs strictly serially. No product Writer, audit Writer, Integration, or reclaim
  operation may overlap it.

## Inputs and outputs

Inputs:

- the current `classifyKnownTask` precedence and existing `latestTaskResolutionState`/
  `resolvedReady` contract;
- an authentic succeeded, independently verified zero-change Candidate shape with durable
  Revision, Main accept/protect-candidate/ready-for-integration packet truth, and a later valid
  `task.resolution.completed` event;
- the six exact protected Task ids and their read-only storage audit evidence.

Outputs:

- the smallest classifier precedence correction in the existing storage lifecycle;
- focused regression evidence for a resolved succeeded Candidate and for active/safety guards;
- independent verification, two usable different-view Judge opinions, Main decision, and safe
  serial Integration;
- three zero-change activated-source audits, followed by an exact preview/reclaim of only the six
  named Tasks and a final integrity/orphan/process audit.

## Writable paths and orthogonality

The implementation Worker may edit only:

- `src/core/storage-lifecycle.ts`
- `tests/storage-lifecycle.test.ts`

These paths form one tightly coupled product/test slice. They are not orthogonal to each other, so
one Grok 4.6 Xhigh `persistent-session` Writer owns both. The three audit Tasks are read-only and
run serially after activated Integration. Main alone updates shared SSOT/evidence and performs
Integration and real-home reclamation.

## Required behavior

- Existing active and safety guards retain precedence: active Task/Attempt, validation repair,
  open verification, running review, authorized/preparing handoff, running Integration,
  unknown Integration outcome, reviewer-graph activity, unsafe physical roots, and ambiguous
  mappings remain protected.
- After those guards, a valid latest terminal Main resolution suppresses only stale review,
  Main-decision, and Integration packet wait states. It does not rewrite the packet or historical
  event truth.
- Reclaim eligibility still requires terminal Task status and a durable latest Revision artifact
  when a Revision exists. Missing evidence remains protected.
- Unresolved succeeded Tasks with the same Candidate/packet shape remain protected by their
  existing reason.
- Reclaim still removes only known regenerable targets and preserves durable Revision, diff, logs,
  events, routing, and Main-decision evidence.

## Forbidden paths and non-goals

- No CLI/MCP/daemon protocol/schema, Store, task-resolution event, decision-packet, review,
  Integration, Runtime/Profile, documentation, Goal parser, Hub/UI, or unrelated test change.
- No new lifecycle classification, duplicate resolution field, second state machine, cleanup
  queue, automatic resolution, implicit Main decision, Store rewrite, migration, retry, or
  historical relabel.
- No checksum/content hash, manifest, lock, lease, version handshake, repeated consistency check,
  multi-user, distributed, or cross-node coordination.
- No broad historical cleanup. Reclamation after activation is limited to the six exact Task ids
  above and uses current Store truth plus Main's already durable resolution events.
- No commit, push, remote, credential, or Provider-authentication change.

## Acceptance and review

- A focused test constructs an authentic terminal succeeded Candidate with passed independent
  verification, durable empty Revision artifact, Main accept/protect-candidate or ready-for-
  integration truth, then records `task.resolution.completed`; audit changes from protected to
  `reclaimable/main-resolved-terminal`, and confirmed reclaim preserves the Revision artifact.
- The same shape without terminal resolution stays protected.
- At least one focused assertion proves a terminal resolution does not outrank an active/safety
  guard, including an open/running operation or missing required Revision artifact.
- Existing delivered, handoff-ready, reviewer, ambiguous-process/root, retain, preview, reclaim,
  integrity, and public daemon/CLI/MCP storage behavior remains passing.
- Candidate changes only the two allowed paths. ForkLight independently passes all commands.
  Exactly two independent read-only Judges inspect classifier precedence/safety and public
  lifecycle compatibility. Main inspects the actual diff and provenance before safe Integration.
- Any need to change event/schema/public surfaces, any active/unsafe Task becoming eligible, any
  missing durable artifact being deleted, or two purposeful rounds without new evidence stops the
  Work Item without widening it.

## Verification commands

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/storage-lifecycle.test.ts tests/daemon.test.ts tests/daemon-cli.test.ts tests/mcp.test.ts
git diff --check
```

The local verifier keeps the existing 30-minute per-command safety breaker. Development has no
absolute duration, Token, or no-progress ceiling. Time is never treated as completion or failure
evidence.

## Handoff and workspace disposition

Worker handoff names the exact precedence change, preserved safety guards, tests, Candidate
Revision, verifier result, and any remaining risk. Judge handoffs bind to the exact Revision and
do not edit. Main records its decision, safe Integration operation, activation identity, full
boundary check, three audit Tasks, and exact real-home preview/reclaim outcome.

Protect implementation/Judge/audit Workspaces until their Candidate or zero-change evidence and
Main dispositions are durable. After activated audits, Main previews and reclaims only the six
named already-resolved Tasks; no glob or all-eligible destructive request is used. Retain minimal
durable evidence and reclaim their known regenerable targets. A stopped or ambiguous Task remains
protected. Final evidence reports bytes, targets, integrity, unknown-orphan entries, and processes.
