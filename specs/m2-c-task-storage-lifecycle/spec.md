# M2-C — Auditable Task storage lifecycle

## User result

One local developer can ask ForkLight what Task space is protected, what is reclaimable, why, how
many bytes and which known regenerable paths would be removed; then explicitly reclaim eligible
space and receive a durable result plus Store/process integrity evidence. Active, reviewable, or
reusable partial output is never deleted, and unknown orphans are reported instead of guessed away.

## Background and current evidence

- Historical approved cleanup stopped five proven orphan process groups and removed 1,336 known
  regenerable directories while preserving Store, logs, Candidate revisions, diffs, reviews,
  Integration evidence, and backups. The one-off record is
  `specs/task-space-cleanup/spec.md`; it is evidence, not a product lifecycle.
- Current `runs/` contains 292 log roots, 288 revision roots, 158 Integration roots, 41 review
  roots, and no standard workspace/baseline/Runtime-home roots from that historical cleanup.
- `src/core/config.ts` owns canonical Task roots. Known regenerable content includes `workspace`,
  `baseline`, `claude-config`, `grok-home`, `codex-home`, `codex-tmp`, `verifier-git`, and its
  transient index. Durable content includes Store rows/events, logs, `result.diff`, raw/generated
  patches, Candidate `revisions`, reviews, handoff evidence, source manifests, and Integration
  receipts/results/backups needed for audit/recovery.
- ForkLight currently has no storage lifecycle CLI/API, no canonical reclaim eligibility
  projection, no durable terminal disposition event, and no Store integrity method exposing SQLite
  `quick_check` plus foreign-key results.

After the original operational Goal reached its correction cap, 一骏 authorized the bounded
recovery Work Item at
[`work-items/correction-cap-recovery/spec.md`](work-items/correction-cap-recovery/spec.md). It is the
only accepted execution supplement: it adopts exact verified Revision `99435c50-...` into a clean
current-source Workspace and closes only the five scenarios already frozen below. It does not
change this parent scope or create a second product roadmap.

That recovery later completed Integration and all three audits, but the required real-home preview
exposed one authentic legacy Competition handoff that predates typed `origin` and currently makes
audit/preview unreadable. The accepted narrow compatibility supplement is
[`work-items/real-store-legacy-handoff-compat/spec.md`](work-items/real-store-legacy-handoff-compat/spec.md).
It changes only the durable read boundary and focused regressions; it does not expand storage
lifecycle behavior or authorize Store migration.

The compatibility supplement was then integrated and the real audit/preview/reclaim completed
safely. That real reclaim exposed one final delivery-surface gap: all 248 durable dispositions
completed, but the CLI's generic 15-second daemon response window expired before the roughly
32-second batch returned. The accepted narrow transport supplement is
[`work-items/reclaim-transport-observation/spec.md`](work-items/reclaim-transport-observation/spec.md).
It changes only shared result observation and does not alter, retry, cancel, or replay storage work.

## `depends_on`

- M2-A integrated so Runtime Homes and execution modes have final ownership names.
- M2-B integrated so review requirement, Review Graph, partial reuse/handoff, Main decision, and
  Integration blockers have one canonical read path.
- It runs after M2-B because both touch shared Task types, daemon protocol/coordinator, CLI/MCP, and
  Integration/review truth. Main Integration is serial.

## Scope

1. Add a canonical read-only storage audit that joins current Store Task truth with direct
   filesystem/process observations and classifies each Task root as `protected`, `reclaimable`,
   `reclaimed`, `retained`, or `unknown-orphan`, with a closed reason and byte counts.
2. Add exact dry-run preview for one Task or all currently eligible Tasks. Preview lists only known
   regenerable targets and estimated bytes; unknown files/directories are preserved and reported.
3. Add explicit confirmed reclaim for one Task or the current eligible set. Apply re-evaluates the
   current Store state immediately before deletion and refuses anything that became protected. It
   needs no checksum, lease, lock, or version handshake in this single-user local product.
4. Persist one bounded durable disposition/result event per reclaimed or explicitly retained Task:
   eligibility reason, removed path categories/count/bytes, retained durable categories, process
   result, timestamp, and integrity result. Do not store raw private contents.
5. Expose the same semantics through CLI and MCP/API. Proposed CLI shape:
   `forklight storage audit`, `forklight storage preview [--task <id>]`, and
   `forklight storage reclaim (--task <id>|--all-eligible) --confirm`, all with JSON support.
6. Detect live Worker/daemon-like processes whose command or current working directory belongs to
   a Task run root. A process owned by protected Store state blocks reclaim. A proven process under
   an eligible terminal Task may be stopped only by the explicit confirmed reclaim path with
   bounded TERM/escalation evidence. An unowned process/root is `unknown-orphan` and is not killed
   or deleted automatically.
7. Expose SQLite `quick_check` and foreign-key violation count after mutations. This check is
   retained because it directly detects durable-data corruption/schema unreadability; do not add
   duplicate general consistency checks.

## Canonical protection and eligibility rules

Protect full Task space when any of these is true:

- Task is queued, preparing, running, verifying, waiting, blocked, or interrupted/resumable.
- A Worker/verification/validation-repair/correction/Review Graph/handoff/Integration operation is
  active or outcome-unknown.
- A succeeded Candidate awaits required review, fresh Main decision, or Integration.
- A failed/rejected/revise Candidate has reusable partial output without durable selected
  paths/gaps and prepared handoff, or without an explicit Main attention resolution.
- The root or process cannot be mapped unambiguously to current Store truth.

Reclaim known regenerable paths only when one of these durable terminal dispositions is true and
no active condition above exists:

- exact Candidate Integration applied/activated or otherwise durably delivered;
- audited Main remediation is `verified-repaired-delivered`;
- a terminal Task was explicitly resolved by Main and any Candidate Revision needed for audit is
  durably retained;
- a source partial Candidate has a durably prepared one-hop handoff whose selected paths/gaps and
  successor Workspace are materialized;
- a reviewer Task is terminal and its Review Graph result/aggregation is durably stored.

`retained` is an explicit reason to keep full space after terminal state; it is not inferred from
age. Backups and destructive historical cleanup remain outside ordinary Task reclaim.

## Non-goals

- No historical backup deletion, Store row deletion/compaction, Candidate/Review/Integration
  evidence deletion, log retention redesign, scheduled janitor, disk quota daemon, cloud cleanup,
  or Hub UI.
- No automatic reclaim merely because a Task status is terminal or old.
- No deletion of unknown top-level content, unmapped roots, unresolved partial output, or any path
  outside canonical ForkLight Task roots.
- No locks, leases, content hashes, manifests, distributed transactions, multi-user coordination,
  or repeated consistency checks.
- No commit, push, remote mutation, credential access, or deletion of current historical backups.

## Inputs, outputs, and dependencies

- Inputs: canonical ForkLight home/run roots; Task/Attempt/events; current decision packet;
  Candidate Revision; Review Graph; handoff; Main resolution; remediation; Integration; process
  table; filesystem metadata.
- Preview output: classification, reason, exact canonical targets, categories, estimated bytes,
  preserved unknown/durable entries, live-process facts, and integrity precheck.
- Reclaim output: re-evaluated eligibility, removed/refused targets, actual bytes if measurable,
  stopped/refused processes, durable disposition event, and integrity postcheck.
- `StateStore` remains the durable authority. Filesystem/process facts are observations, not a
  second lifecycle state machine.

## Module and file boundaries

Allowed product paths:

- a new focused `src/core/storage-lifecycle.ts` (or equivalently named single authority)
- `src/core/types.ts`, `src/core/config.ts`
- smallest read-only reuse of existing task decision/review/handoff/remediation/Integration
  resolvers; do not alter their authority semantics
- `src/state/store.ts` only for bounded event/integrity access required by this feature
- `src/daemon/protocol.ts`, `src/daemon/coordinator.ts`, `src/daemon/server.ts`
- `src/cli.ts`, `src/mcp/server.ts`
- focused new storage lifecycle tests plus daemon/CLI/MCP tests
- `docs/operations.md` and command help

Forbidden paths:

- `src/hub/**`
- Worker execution semantics, Provider/model routing, Review Graph policy, Candidate handoff
  admission, economics, Competition, unrelated Goal/Plan scheduling
- current Goal SSOT and other Work Item specs (Main owns them)
- any path outside `/Users/yijunwang/code/forklight` in the Candidate

Worker tests use temporary ForkLight homes only and must never delete the real
`/Users/yijunwang/Library/Application Support/ForkLight` content. Main performs real preview and
approved ordinary reclaim only after reviewing the Candidate.

## Call chain

1. Main calls storage audit or preview.
2. Core loads Store truth, composes current review/delivery/handoff state, observes canonical run
   paths/processes, and returns a non-mutating classification.
3. Main explicitly calls reclaim for one Task or current eligible set with `confirm`.
4. Core re-evaluates eligibility, stops only proven eligible-task processes if required, removes
   only known regenerable targets, and preserves unknown/durable content.
5. Core records the bounded disposition/result event and runs Store integrity checks.
6. CLI/API returns what changed, what remained, any refusal, and the next action.

## Scenarios

### Active Task is protected

Given a queued/running/verifying Task or active Judge/Integration, when preview or confirmed reclaim
runs, then no Task path or process is removed and the output names the active protection reason.

### Succeeded but not delivered Candidate is protected

Given verification passed but required review/Main accept/Integration is missing, when storage is
audited, then the full Workspace remains protected even though machine status is succeeded.

### Delivered Task is reclaimed

Given exact Integration is applied and all follow-up operations are terminal, when Main confirms
reclaim, then only known regenerable paths disappear, durable evidence remains readable, a result
event is stored, and integrity checks pass.

### Reusable partial handoff

Given a failed/revise Candidate has selected reusable paths and named gaps, when handoff is not yet
prepared, then source space is protected. After the one-hop successor is durably prepared and bytes
are materialized there, source regenerable space can become reclaimable while Candidate revision
and handoff evidence remain.

### Unknown root or process

Given a run root or process cannot be mapped to a Store Task, when audit/reclaim runs, then it is
reported as `unknown-orphan`, is never killed/deleted automatically, and prevents an all-clear exit
claim until Main resolves it.

### State changes after preview

Given a Task was reclaimable at preview but is reopened or becomes active before apply, when apply
re-evaluates Store truth, then reclaim is refused without relying on a lock, lease, hash, or version
receipt.

### Refusal and partial mutation stay truthful

Given Store integrity is not `ok`, a Task-owned process cannot be stopped, or any named target is
unsafe before deletion starts, confirmed reclaim refuses that Task without stopping other processes
or removing paths. If an operating-system failure occurs only after at least one target was removed,
ForkLight records a bounded partial-result event, leaves the Task `reclaimable`, and never reports the
Task as fully `reclaimed` while a known regenerable target remains.

### Ambiguous process ownership protects every implicated Task

Given a process command, cwd, and stored Worker PID identify different run roots, audit preserves the
ambiguous observation, protects every implicated Store Task, and surfaces any unmapped root. A failed
TERM/escalation never permits path deletion for that Task.

The same rule applies when current Store rows unexpectedly map one PID to more than one Task: the PID
is not guessed to belong to the last row, every implicated Task is protected, and the process is not
signalled.

### Canonical root cannot be redirected

Given `<home>/runs` or `<home>/runs/<taskId>` is itself a symlink or otherwise resolves outside the
physical ForkLight Home, audit classifies the Task mapping as ambiguous and reclaim removes nothing.
A symlink used only as the configured Home alias remains supported when its physical `runs` and Task
directories are ordinary contained directories.

### Terminal reviewer Task follows its Review Graph

Given a reviewer Task is terminal and its assigned Review Graph result is durably terminal, the
reviewer Workspace becomes reclaimable without requiring a second Main review or Integration of the
reviewer's zero-diff Candidate. A running or unresolved Review Graph remains protected.

### Read-only transport surfaces remain read-only

Given CLI or MCP audit/preview runs against an already available daemon, it does not append an
exchange receipt or any other Store record. Reclaim and explicit retain remain auditable mutations.

### Explicit retain is integrity-gated and measurable

Given an otherwise reclaimable Task, explicit retain checks Store integrity before appending its
disposition. A bad `quick_check` or foreign-key result refuses the write. A successful result reports
the retained byte breakdown and durably records both the prior eligibility reason and the bounded
explicit-retain disposition without storing the user's raw note.

## Acceptance criteria

- Read-only audit/preview never mutates Store, filesystem, Task state, or processes.
- Classification protects every active/review/open-Integration/unresolved-partial path and exposes
  a closed reason.
- Confirmed reclaim rechecks current truth and deletes only the named known regenerable categories
  under canonical Task roots.
- A bad Store integrity precheck, ambiguous process ownership, failed process stop, or unsafe target
  refuses that Task before path deletion; an unavoidable mid-delete partial result is durable and is
  never projected as fully reclaimed.
- Unknown content, roots, and processes are preserved and surfaced.
- All-eligible preview keeps the same audit's protected and unknown entries visible while naming
  deletion targets only for reclaimable Tasks; an unknown orphan wins the one next action.
- `--all-eligible` reclaim never returns an all-clear next action while the same fresh audit contains
  an unknown orphan.
- Durable Candidate, verification, Judge, handoff, Main decision, Integration, Token/routing
  evidence, logs, and Store rows remain readable after reclaim.
- Every terminal Task is visibly protected/retained/reclaimable/reclaimed with a reason; no unknown
  orphan is hidden.
- A terminal reviewer Task becomes reclaimable from its terminal Review Graph evidence without a
  redundant Main-review/Integration lifecycle of its own.
- Duplicate PID ownership and symlinked `runs`/Task roots are ambiguous mappings that protect every
  implicated Task; a configured Home alias alone remains supported.
- `quick_check` returns `ok` and foreign-key violations are zero after mutation in focused tests and
  real M2 graduation evidence.
- CLI and MCP/API JSON agree; human output includes reclaimed/protected bytes and one next action.
- Explicit retain performs the same integrity precheck before its Store write and reports retained
  bytes plus the prior terminal eligibility reason.
- Task-scoped CLI/MCP audit and preview do not write exchange receipts or other lifecycle state.
- No real ForkLight home is mutated by automated tests.

## Verification commands

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/storage-lifecycle.test.ts tests/store.test.ts tests/daemon.test.ts tests/daemon-cli.test.ts tests/mcp.test.ts
git diff --check
```

Main post-Integration runs the product preview against the real local home, reviews the exact
eligible/protected/unknown set, performs only ordinary confirmed Task reclamation, then records
`m2-storage-lifecycle.md` with Store and process integrity evidence. Historical backup deletion
still requires separate approval.

## Review and handoff

- This is destructive lifecycle and durable-data-adjacent work, so use two independent read-only
  Judges after ForkLight verification.
- Judge one focuses on protection/eligibility and partial-result preservation. Judge two focuses on
  path/process safety, Store integrity, CLI/API truth, and absence of multi-user overengineering.
- No Judge edits, deletes, or authorizes Integration. Main reviews the exact Candidate and runs
  ForkLight safe Integration serially.
- Verified gaps return to the same Worker while the spec remains valid. Two repeated no-evidence
  failures, compensating deletion checks, or a need to delete durable/unknown content stops the
  Work Item.

## Workspace disposition

- The M2-C development Task Workspace is itself protected through verification, Judges, Main
  decision, and Integration.
- After Integration and durable evidence, exercise M2-C on its own Task only after the new product
  preview classifies it eligible.
- Failed or partial M2-C Candidates remain fully retained until correction/handoff or explicit Main
  resolution. Tests clean only their exact temporary homes.

## Assumptions, risks, and stop conditions

- Assumption: one local Main serializes Integration and storage mutations; current Store state plus
  path ownership is enough coordination.
- Risk: terminal status alone is insufficient. Mitigation: eligibility consumes review, handoff,
  resolution, remediation, and Integration truth.
- Risk: a new Runtime may create an unknown cache directory. Mitigation: unknown entries are
  retained until explicitly classified in a future scoped change.
- Stop if implementation requires backup deletion, Store record deletion, unknown-path deletion,
  broad process killing, a second lifecycle database, distributed coordination, or Hub work.

## Graduation

M2-C graduated on 2026-08-14. Compact evidence is
`goals/forklight-main-led-execution/evidence/m2-storage-lifecycle.md`. The final real audit has zero
reclaimable and zero unknown-orphan entries, zero observed processes, Store integrity `ok/0`, and
only protected or already reclaimed Tasks with explicit reasons. Historical backups, Store rows,
durable evidence, unknown content and Hub/UI were not deleted or redesigned.
