# M4-E Work Item — Main-offline storage-lifecycle checkpoint pair

## User result

Produce exactly one new, meaningful `forklight-storage-lifecycle` Main Token pair that exercises
the activated Main-offline delivery strategy. The bounded artifact tells the local developer which
current M4-E Task must remain protected and which two fully delivered Tasks contain regenerable
Workspace state eligible for a separately confirmed later reclaim. This Work Item deletes nothing.

The old accepted 154,171-direct / 553,038-delegated pair remains immutable negative evidence. This
new subject asks whether ending Main sessions during Worker/Judge execution and summing every
resumed terminal segment can deliver equal quality with strictly fewer Main Tokens.

## Background and current evidence

Fresh serial read-only previews against matched build `6a4a9940...` report:

- rejected reusable Task `2d774265-344f-43ea-8f69-79e2624765d3` remains
  `protected / unresolved-partial / protect-and-wait`, with 142,781,211 regenerable bytes,
  5,515,895 durable bytes, zero unknown bytes and zero owned processes;
- the previous accepted storage comparison Task `4709c1b1-e093-4465-bbb0-bbad221b34b7` is
  `reclaimable / integration-delivered / confirm-reclaim`, with 19,819,291 regenerable bytes,
  924,880 durable bytes, zero unknown bytes and zero owned processes;
- the activated Main-offline episode Task `6676be3a-24b4-4bbc-a8c0-7f2a3079e848` is
  `reclaimable / integration-delivered / confirm-reclaim`, with 159,988,810 regenerable bytes,
  13,865,918 durable bytes, zero unknown bytes and zero owned processes.

Every preview reports SQLite `quickCheck: ok` and zero foreign-key violations. No preview or this
pair performs reclaim.

## `depends_on`

- Main-offline episode delivery is activated by Task `6676be3a...`; 3,094/3,094 tests pass and
  client/Daemon identity is matched.
- `main-token capture-episode` is live through Core, Store, CLI, Daemon and MCP while legacy
  single-run capture and pair/value behavior remain compatible.
- The old valid storage negative stays in the canonical report and is not reused as a sample.
- Grok 4.6 Xhigh is launchable as native Goal; direct and delegated Main use the same
  `codex-main-gpt-5.6-sol-xhigh-v1` identity.
- No other product Writer or M4 comparison is active. Hub/UI and M5 remain dependency-held.

## Inputs

- Bounded accepted input:
  `goals/forklight-main-led-execution/execution/m4-calibration/inputs/forklight-storage-lifecycle-main-offline-checkpoint.json`.
- Existing closed validator:
  `goals/forklight-main-led-execution/execution/m4-calibration/validate-artifact.mjs`.
- Existing generic delegated Task renderer:
  `goals/forklight-main-led-execution/execution/m4-calibration/render-task.mjs`.
- Fresh exact storage previews and accepted Main disposition named in the bounded input.
- Exact terminal `turn.completed` events from every measured Codex Main session.

## Outputs

- Byte-identical direct and delegated isolated roots containing only the input, validator and an
  empty output base.
- One direct Main terminal sample and one delegated Main episode sample bound to new Task class
  `m4-main-offline-storage-lifecycle-checkpoint` and comparison
  `cmp-m4e-storage-main-offline-checkpoint-20260818`.
- One byte-identical artifact per side at
  `goals/forklight-main-led-execution/evidence/m4-calibration/forklight-storage-lifecycle-main-offline-checkpoint.json`.
- A delegated ForkLight chain with one Grok 4.6 Xhigh native Goal, independent acceptance, two
  different-view Judges, exact Main decision and safe isolated Integration.
- One M4-B assessment, scoped pair/value report, canonical report update and delivery/stop packet.

## Execution and Main-offline boundary

### Direct Main

One isolated Codex CLI session using `gpt-5.6-sol / xhigh` reads the bounded input, writes exactly
the artifact, runs the accepted validator and `git diff --check`, inspects its one-path diff and
stops. It never calls ForkLight or accesses the source project.

### Delegated Main

Separate isolated Codex CLI sessions use the same model and effort. They never write the artifact.
Together they may call only the two public delivery checkpoints:

1. **Dispatch segment:** call `delivery prepare --task-file` once with a 30-second observation,
   then stop the model session whether ready or timed out.
2. **Non-model wait:** a host process observes the durable Task until Worker/verification reaches
   terminal truth. It does not wake Codex and does not mutate the Task.
3. **Review segment:** re-enter `delivery prepare` for the exact Task, same Reviewer order and
   reason with a 30-second observation, then stop. This may create the one Review Graph.
4. **Non-model wait:** observe the exact Judge Tasks/Graph to terminal truth without a model.
5. **Decision segment:** exact `delivery prepare` re-entry returns the Candidate and Judge evidence;
   if and only if the closed contract is satisfied, call `delivery decide accept` bound to the
   exact Revision/digest and stop.

If durable evidence makes a later segment unnecessary, omit it; never create a ceremonial segment.
Every Codex session that actually runs is captured exactly once in one delegated episode. Main
observation timeouts are not Worker deadlines and cannot cancel, recreate, retry, reroute or widen
the Task.

### Accepted pre-admission infrastructure continuation

The first measured dispatch session, `codex-run:01a01238-68b1-7313-8e88-cedd9d0687f7`, called the
exact accepted `delivery prepare --task-file` command once but reached no admission boundary:
ForkLight reported `daemon process exited before becoming ready`, created no Task/Attempt/sample,
and changed neither comparison root. Its complete terminal event is retained as delegated episode
segment zero: 46,071 input, 33,280 cache read, 295 output and zero cache creation, or 46,366 gross
under the canonical disjoint normalization.

Read-only host evidence names the cause: the existing Daemon socket was absent, while the isolated
Codex sandbox could write the ForkLight Home but could not create its listener (`listen EPERM`).
Main may therefore restore the already-required matched Daemon once outside any measured model
session, then run exactly one continuation dispatch segment with the same task file, Reviewers,
reason and 30-second observation. Segment zero remains counted; this is the same frozen pair, not a
replacement or favorable replay. If the continuation cannot create the one Task, stop the Work
Item. No further pre-admission continuation is allowed.

The one continuation also failed before Task creation with the same bounded Daemon-start error.
Its run `codex-run:01a0123b-211a-70e0-a743-e947e6985dec` contributes 46,312 input plus 484 output,
or 46,796 gross. Together the two retained delegated segments total 93,162 gross. The Work Item is
therefore stopped under this clause with no Task, Attempt, sample, comparison or Hub admission.
The later Daemon socket-safety product fix does not reopen or replace this pair.

## Allowed paths

- Direct and delegated Writers: only their isolated
  `goals/forklight-main-led-execution/evidence/m4-calibration/forklight-storage-lifecycle-main-offline-checkpoint.json`.
- Main operational paths: this accepted Spec and the existing
  `goals/forklight-main-led-execution/execution/m4-calibration/` input/preparation files.
- After acceptance, Main may copy the exact delegated artifact to the existing Goal evidence path
  and update only the current Goal SSOT/evidence index and canonical `main-token-pairs.json`.

## Forbidden paths and non-goals

- No product source/test, old comparison artifact/sample/assessment, Store implementation, actual
  reclaim, Hub/UI, routing, Runtime, Worker Profile, credential, Git history/remote, commit, push or
  reset change.
- No granular submit/wait/inspect/review/main-review/preflight/apply fallback inside measured Codex
  Main sessions. Non-model read-only waiting is allowed only between them.
- No Task recreation, whole-pair replay, model switch, Competition, third Judge, automatic
  replacement, automatic Main decision or later-family work before this result.
- No lock, lease, checksum/content-addressing, version handshake or distributed coordination.
- No saving claim from receipts, missing terminal counters, omitted resumed sessions or reduced
  acceptance.

## Acceptance

1. New input, Task class, output, delegated Task, comparison, samples and assessment are distinct
   from M4-D and the accepted negative M4-E pair.
2. Direct/delegated roots start byte-identical and use the same task, output and commands.
3. Every measured Main segment is `gpt-5.6-sol / xhigh` with one complete exact terminal event;
   the delegated role persists one schema-v2 episode whose parent equals all segment sums,
   including the retained pre-admission infrastructure segment.
4. The artifact protects only `2d774...`; marks only `4709...` and `6676...` reclaimable; preserves
   exact classification, reason, next action, byte/process/integrity truth; and records
   `reclaimExecuted: false`.
5. Direct validation passes. Delegated Candidate changes exactly one path, passes the same
   validator/diff check, receives two usable different-view Judge opinions, exact Main accept and
   safe isolated Integration.
6. Store/receipts prove measured delegated Codex sessions use only exact delivery prepare/decide
   calls. Model-active unchanged polling, granular fallback, Task recreation and source-project
   access are absent.
7. Main assesses once only after byte equality, same scope/acceptance and non-lower delegated
   quality. Worker Token/cost/time stay separate from Main Token.
8. Only direct gross minus delegated gross greater than zero admits Hub. Valid non-positive,
   invalid, incomplete or repeated-failure evidence stops M4 with no favorable rerun.

## Verification commands

In each isolated root:

```text
node validate-artifact.mjs calibration-input.json goals/forklight-main-led-execution/evidence/m4-calibration/forklight-storage-lifecycle-main-offline-checkpoint.json
git diff --check
```

For the delegated Task and pair:

```text
forklight main-token status --task-id <task> --comparison-id <comparison> --json
forklight main-token pair-report --task-id <task> --comparison-id <comparison> --json
forklight value-report --families '["forklight-storage-lifecycle"]' --comparisons '["<comparison>"]' --json
```

The Worker has no absolute duration or Token ceiling. ForkLight acceptance commands keep the local
30-minute command breaker. Thirty-second Main calls are observation windows only.

## Handoff and workspace disposition

Handoff names every Codex run ref/counter, direct validator, delegated
Task/Attempt/native-Goal/Revision/verification/Review Graph/receipt/Integration, exact artifact,
assessment and canonical result. Preserve both comparison roots and Task Workspace until the
packet and canonical report are durable. This Work Item performs no storage reclaim.

One purposeful validation repair or same-Worker correction may close one concrete artifact gap.
Stop on repeated failure, missing/ambiguous terminal evidence, omitted Main segment, quality/scope
drift, granular fallback need, source drift, or any request to widen the accepted boundary. There
is no replacement pair.
