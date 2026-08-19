# M4-E Work Item — Main-efficient reviewed delivery checkpoints

## User result

For an ordinary bounded ForkLight delivery, Main can hand off execution and review in one public
call, receive one compact decision-ready packet, then make and safely deliver its exact decision in
one second public call. Waiting and deterministic plumbing no longer require repeated model turns,
while Main remains the only authority for correction, acceptance and Integration.

## Background and evidence

M4-A through M4-C are graduated. M4-D truthfully produced one incomplete pair and two valid pairs
whose delegated Main Token is substantially higher. The focused audit at
`goals/forklight-main-led-execution/evidence/m4-e-main-observation-audit.md` shows 26 and 15
attributed exchanges on the two accepted deliveries, plus separate Review Graph calls. Terminal
counters show repeated cache-read/context dominates the Main gap.

ForkLight already has every durable record and safety gate needed for delivery. The missing product
behavior is a public, resumable operation that composes deterministic state transitions until the
next genuine Main decision instead of waking Main between them.

## `depends_on`

- M4-A, M4-B and M4-C are activated; M4-D canonical negative/incomplete evidence is durable.
- Current Task, independent verification, Review Graph, Main review and safe Integration behavior
  remains authoritative and is reused rather than reimplemented.
- Current Grok 4.6 Xhigh Profile resolves to native Goal and may be launched after health succeeds.

## Inputs

### Prepare checkpoint

- exactly one new Task file or one existing Task id;
- an ordered set of zero to three explicit Reviewer Profile ids matching the Task's frozen
  `requiredJudges` count;
- one bounded review reason and explicit confirmation;
- one observation timeout, which controls only the caller's wait;
- optional bounded Candidate diff inclusion for Main review.

### Decision checkpoint

- Task id, exact Candidate Revision id and full digest from the prepare checkpoint;
- `accept`, `revise` or `reject`, a bounded reason and explicit confirmation;
- one observation timeout for an accepted Integration.

## Outputs

- One canonical privacy-safe `MainDeliveryCheckpoint` shared by Daemon, CLI and MCP.
- Prepare output includes Task/stage, exact Candidate identity, bounded diff evidence when requested,
  verification result, every required Judge's usable disposition/summary/findings, blockers, stop
  reason, workspace disposition and one next action.
- Decision output includes the bound Main decision and, only for accept, the one preflight receipt,
  durable Integration operation/stage result and final disposition.
- A timed-out observation includes the durable Task/operation identity and resume action; it never
  reports the underlying work as timed out or failed.

The checkpoint excludes raw prompts/responses, Worker logs, private histories, credentials,
successful command stdout, full event streams, duplicate TaskDecision/Integration objects and
unneeded absolute Runtime paths.

## Product behavior

### `delivery prepare`

1. Validate all arguments before mutation. Exactly one of Task file or existing Task id is allowed.
2. For a new file, submit exactly one Task and expose its id durably. For an existing id, resume
   observation only; do not resume or recreate Worker execution.
3. Observe the Task until an actionable terminal Candidate or a real failure/stop appears. Existing
   Worker validation-repair policy may operate normally; this command grants no additional repair.
4. Only after current independent verification passes and an exact Candidate exists, create the
   explicitly supplied Review Graph. The count must exactly match `requiredJudges`; zero-review
   Tasks must not receive Judges. Reuse the existing same-revision/same-ordered-set graph on resume.
5. Observe all required Judges to terminal, then return one checkpoint. Never convert agreement
   into Main acceptance and never repair, replace or add a Judge automatically.

### `delivery decide`

1. Fail before mutation if Task, Revision or full digest does not match the current verified and
   fully reviewed Candidate.
2. Record Main's explicit decision once using existing authority. `revise` and `reject` return the
   new checkpoint without Integration or automatic correction.
3. For `accept`, run current safe Integration preflight and apply exactly one receipt, then observe
   the durable Integration operation to terminal. Existing source compatibility, review, rollback,
   build and activation gates remain unchanged.
4. An exact repeat after transport loss or observation timeout resumes the existing durable graph,
   Main decision or Integration operation; it must not create duplicates. A different decision,
   identity, Judge set or reason fails closed.

## CLI and API

Expose the same service through:

```text
forklight delivery prepare (--task-file <path>|--task <id>) \
  --reviewer-profiles <id1,id2> --reason <text> --timeout-ms <ms> --confirm \
  [--include-diff-max-bytes <n>] [--json]

forklight delivery decide <task-id> --decision <accept|revise|reject> \
  --revision <id> --digest <sha256> --reason <text> --timeout-ms <ms> --confirm [--json]
```

MCP exposes equivalent prepare/decide tools over the same canonical resolver and schema. Public
surface names may follow existing naming conventions, but CLI, Daemon and MCP must not duplicate
eligibility or state-transition logic.

## Allowed paths

The implementation Worker may modify only:

- `src/core/main-delivery.ts` (new if useful)
- `src/core/main-decision-packet.ts`
- `src/core/types.ts`
- `src/daemon/coordinator.ts`
- `src/daemon/protocol.ts`
- `src/daemon/server.ts`
- `src/daemon/client.ts`
- `src/cli.ts`
- `src/cli/supervision.ts`
- `src/cli/exchange-receipts.ts`
- `src/mcp/server.ts`
- `src/mcp/exchange-receipts.ts`
- `tests/main-delivery.test.ts` (new if useful)
- `tests/cli-supervision.test.ts`
- `tests/cli-exchange-receipts.test.ts`
- `tests/daemon.test.ts`
- `tests/daemon-cli.test.ts`
- `tests/mcp.test.ts`
- `README.md`
- `docs/operations.md`

Main alone updates this Spec and the Goal SSOT/evidence. No Worker writes Goal files.

## Forbidden paths and non-goals

- No Hub/UI assets, storage deletion, routing/model changes, pricing, calibration artifact or
  `main-token-pairs.json` change.
- No new Goal/Plan/Task/Work Item or delivery persistence entity. Compose existing durable truth.
- No automatic Main decision, automatic correction/handoff, Judge replacement, third Judge,
  Competition, fallback, retry or Integration without explicit confirmed accept.
- No weakening of independent verification, review requirement, Candidate/source binding,
  rollback or activation checks.
- No lock, lease, checksum/content-addressing system, version handshake or distributed protocol.
- No commit, push, reset, remote or credential handling.

## Acceptance

1. One prepare call can submit a valid Task, observe its Worker and independent verification,
   create exactly the confirmed required Judge set, wait to terminal review and return one compact
   checkpoint without a Main decision.
2. One decide/accept call exact-binds Main review, runs one fresh preflight and one Integration,
   waits to terminal and returns a compact final checkpoint. Revise/reject never integrate.
3. Observation timeout or client disconnect never cancels, fails, resumes, retries or recreates
   underlying work. Exact re-entry reuses the one Task, Review Graph, Main review, receipt and
   Integration operation.
4. Invalid/stale Candidate identity, wrong/reordered Reviewer set, review/schema blocker, source
   drift or failed Integration stays visible and fails closed with no compensating patch or loop.
5. JSON/human CLI and MCP share one canonical result. Large event/log/command-success payloads do
   not enlarge the checkpoint; optional diff inclusion obeys the caller's explicit byte bound.
6. Each top-level prepare/decide request records one redacted Main exchange boundary; internal
   deterministic steps do not masquerade as separate Main interactions.
7. Existing granular commands and durable records remain backward compatible.
8. No Hub/UI or unrelated path changes; `git diff --check` passes.

## Verification commands

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx \
  tests/main-delivery.test.ts \
  tests/cli-supervision.test.ts \
  tests/cli-exchange-receipts.test.ts \
  tests/review-graph.test.ts \
  tests/integration.test.ts \
  tests/daemon.test.ts \
  tests/daemon-cli.test.ts \
  tests/mcp.test.ts
git diff --check
```

The final accepted command may omit `tests/main-delivery.test.ts` only if the implementation adds
the same focused coverage to existing files and documents that mapping in handoff.

## Handoff and workspace disposition

Handoff must name the canonical checkpoint schema, exact public commands/tools, Task/graph/
Integration reuse behavior, timeout semantics, changed paths, focused test counts and any remaining
gap. ForkLight protects the implementation Workspace through verification, dual Judge review and
Main Integration. After activated delivery and durable evidence, normal storage preview may mark
regenerable space reclaimable; this Work Item performs no reclaim.

## Execution policy

- One serial Grok 4.6 Xhigh native Goal Writer; no parallel writer because public Core/Daemon/CLI/MCP
  paths are shared.
- No absolute Worker duration or Token ceiling. Acceptance commands use the local 30-minute command
  safety breaker; an observation timeout never becomes a Task deadline.
- One existing Worker validation repair and one evidence-based Main correction may be used only for
  a concrete accepted gap. Two purposeful repeated failures or a required Spec expansion stops the
  Work Item with reusable output and a decision packet.
- ForkLight independently verifies; two different-view Judges review; Main alone decides and uses
  safe serial Integration.

## Post-activation proof

M4-E delivery does not itself graduate M4. After activation, Main defines fresh, non-replay pair
Work Items that use the two checkpoint calls. The first must be a meaningful `worker-runtime` slice
and prove an actual Main reduction before further family calibration is admitted. If it is not
strictly positive at equal scope/acceptance/non-lower quality, stop instead of generating more
calibration. Existing M4-D samples remain immutable contrary evidence.

## Protected-partial recovery after native Goal termination failure

Task `6928dd28-bf5a-413c-9545-59ce96648b99` produced a reusable accepted-path Workspace but no
Candidate because the first native Goal ended with an auto-backgrounded subagent and unknown Goal
state. The reserved same-Task Main correction then failed immediately with the same unknown state,
zero model turns and no new output. This satisfies the two-purposeful-failure stop: the Task is
immutable and protected, and no further Attempt or correction is allowed.

一骏's standing authorization to continue later Tasks and prefer Grok applies to one exact
protected-partial recovery. Main packages the baseline-to-Workspace delta after removing only the
two proven README trailing spaces as
`goals/forklight-main-led-execution/execution/m4-e/retained-candidate.diff`. A focused source-base
check proves it forward-applies to the current source before admission. A Workspace-local
operational wrapper verifies the exact 19-path set and applies the patch only inside the fresh Task
Workspace before Grok starts; post-Candidate acceptance requires the exact reverse check. These are
the minimum checks for the concrete wrong-source-base or wrong-Candidate failure, not a general
checksum, version or coordination system.

Recovery Task `02-protected-partial-recovery.yaml` uses one fresh Grok 4.6 Xhigh native Goal and
must not claim continuity with the failed Goal. It may only inspect and hand off the already
materialized result, may not spawn a subagent, and has one Attempt with zero validation repair,
Main correction/reverify, adaptation, retry, fallback or further replacement. ForkLight still runs
the wrapper policy check, build, all original focused tests, exact Candidate reverse check and diff
validation, followed by the same two-Judge and Main serial Integration gates. Failure stops M4-E
with both Workspaces protected.

That Task completed its fresh native Goal and captured the exact retained 19-path Candidate. Build,
456 focused tests, exact reverse applicability and diff validation passed. Only the Main-owned
bootstrap policy test failed because it always checked forward source applicability even though
ForkLight ran it after Candidate materialization. Main recorded exact `acceptance-contract /
non-model` attribution; product code is not implicated and the Task has no reverification allowance.

Applying 一骏's standing later-Task authorization, `03-acceptance-contract-recovery.yaml` is the
only further recovery. It changes no product patch or quality gate. The operational policy test now
requires `--source` before admission and `--candidate` during independent acceptance. The fresh
Task materializes the same retained patch, uses one Grok 4.6 Xhigh native Goal without subagents and
retains the same build, 456-test, exact reverse, diff, two-Judge and Main Integration gates. It has
one Attempt and zero repair/correction/reverify/adaptation/retry/fallback/further replacement; any
failure stops M4-E.

## Authorized fresh-preflight binding correction

The final acceptance recovery subsequently passed ForkLight verification and two usable Judges,
but Main rejected it before Integration after finding that `delivery decide` reused any latest
Task preflight receipt. 一骏 explicitly revoked that final `no-further-replacement` boundary on
2026-08-18 and authorized exactly the focused correction in
`work-items/fresh-preflight-binding/spec.md`.

The retained 19-path Candidate remains the base. Worker product edits are limited to
`src/core/main-delivery.ts` and `tests/main-delivery.test.ts`; independent operational acceptance
proves the other 17 paths remain exact. The correction uses existing Task event order, receipt ids
and operation receipt ids only. It adds no schema/entity, lock/hash/lease/version mechanism,
automatic retry, Hub/UI or calibration work. One Grok 4.6 Xhigh native Goal Attempt, zero fallback,
fresh dual Judge review and Main serial safe Integration remain mandatory.

## Delivered outcome

Task `3e2740eb-4c4e-4a55-9a80-86c51c35a5b5` satisfied the focused correction and the parent
delivery contract. ForkLight verification passed 461 focused tests, two independent Judges returned
usable accepts, Main accepted the exact Revision/digest, and fresh receipt
`2b0075f8-b7fa-4dd0-b6e4-1b9de1e9b844` bound the successful four-stage Integration. The activated
source passes `npm run check` with 3,084/3,084 tests and a matched Daemon. Delivery evidence is
`goals/forklight-main-led-execution/evidence/m4-e-main-efficient-delivery.md`.

This outcome activates but does not itself graduate M4. The first fresh non-replay
`worker-runtime` pair remains the next gate; M5 remains closed.
