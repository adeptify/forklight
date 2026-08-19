# M2-A Work Item — Grok native Goal foreground Planner budget

## User result

Long-running Grok CLI native `/goal` planning may continue while it is making effective progress.
ForkLight must not let Grok's 10-minute foreground-child default cancel that planning and falsely
turn an otherwise healthy local development Task into `user_paused`. ForkLight remains the owner
of configurable Task duration and no-progress policy; the Runtime-specific value is only a distant
process safety breaker.

## Background and current evidence

The first wrapper-free activated-source audit used integrated Profile `grok-4-6-xhigh` and resolved
truthfully to `native-goal`. ForkLight Task `385e9c92-e3bb-4eb9-8008-e5ae255f1b31`, Session
`0e01f126-7880-4414-bbb2-9636cd44f0fa`, Attempt
`41d554a5-6358-4f2c-bbb2-ccd28e870299` had `maxDurationMs`, Token ceiling and no-progress timeout all
unset. The Planner made 124 read calls and continued producing useful evidence, but Grok CLI 1.0.4
canceled its foreground subagent at exactly 600,000 ms. The durable native Goal
`215e6043-365b-4ac9-885c-946f608f63e5` stopped `user_paused/Executing` with pause message
`Planning failed; resume with /goal to retry.`, zero classifier runs and no verified Candidate.

The Task log contains both `foreground subagent exceeded await budget; auto-backgrounding (child
keeps running)` with `budget_ms=600000` and the fail-closed planner error `goal role subagent
exceeded foreground wait budget cancelled=true`. Local Grok CLI binary strings expose the official
environment variable `GROK_FOREGROUND_BLOCK_BUDGET_MS`; launching Grok 1.0.4 with
`GROK_FOREGROUND_BLOCK_BUDGET_MS=86400000` is accepted. This is a concrete external Runtime cap,
not a ForkLight observation timeout and not evidence that the Goal stopped making progress.

一骏 explicitly asked to remove overly tight development timeouts. This Work Item is the unique
accepted specification for the focused product fix; the failed audit remains immutable and is not
resumed, retried or relabeled.

## `depends_on`

- Integrated Grok native Goal execution truth, current-model-only binding and matched
  client/Daemon build identity.
- The exact failed Task/Session/Attempt/native-Goal evidence above and the local Grok CLI 1.0.4
  environment-variable discovery.
- No active implementation Writer. The later storage audit remains serial and does not run until
  this Candidate is independently verified, reviewed, accepted, integrated and activated.

## Inputs

- `buildGrokWorkerEnv` in `src/workers/grok.ts`, which constructs every Grok child environment.
- Existing native-goal versus persistent-session environment assertions in
  `tests/worker-runtime.test.ts`.
- The fixed local-development safety value `86,400,000` milliseconds (24 hours).

## Outputs

- Native-goal child environments always set `GROK_FOREGROUND_BLOCK_BUDGET_MS=86400000`, overriding
  a missing, smaller or larger inherited value so Task behavior is reproducible.
- Non-native Grok child environments remove that variable rather than inheriting accidental
  operator state.
- Focused tests prove both branches and preserve existing Goal/current-model environment truth.
- After safe Integration and activation, one new zero-diff Grok 4.6 Xhigh native `/goal` audit
  proves the external 600-second cancellation no longer stops the accepted storage audit.

## Accepted design and call chain

1. Export one named string constant for the native Goal foreground budget and use it only inside
   `buildGrokWorkerEnv`.
2. When `nativeGoal` is true, freeze the constant alongside `GROK_GOAL`, `GROK_WORKFLOWS` and
   `GROK_GOAL_USE_CURRENT_MODEL_ONLY`.
3. Otherwise delete `GROK_FOREGROUND_BLOCK_BUDGET_MS` from the copied child environment.
4. Add focused tests that seed a conflicting parent value, prove native override and non-native
   deletion, and restore the parent environment in `finally`.
5. Do not add a public setting, Task schema field, new watchdog, timer, retry or distributed
   coordination mechanism. Existing ForkLight `maxDurationMs` and `noProgressTimeoutMs` remain the
   configurable Task controls.
6. ForkLight independently runs the accepted commands. Two independent read-only Judges inspect
   the exact Revision because this changes core Runtime execution. Main alone decides and uses
   safe preflight/apply Integration.
7. After activation, Main submits one new audit Task with the existing storage audit acceptance.
   Success requires native Goal plan/classifier plus `complete + achieved`, zero diff and all
   independent commands passing. A repeated foreground-budget failure stops this Work Item with a
   decision packet; it does not trigger another retry, model switch or scope expansion.

## Allowed product paths

- `src/workers/grok.ts`
- `tests/worker-runtime.test.ts`

Main may separately update only the existing Goal SSOT, this accepted Spec and its operational
Task contract/evidence. Main does not edit product code.

## Forbidden paths and non-goals

- Any other `src/**`, `tests/**`, public docs, settings/schema, Store, protocol, Integration,
  storage-lifecycle or Hub/UI path.
- Resuming or replacing failed audit Task `385e9c92-e3bb-4eb9-8008-e5ae255f1b31`.
- Changing Grok model/effort, native Goal terminal semantics, Task Attempt counts, Judge policy or
  storage disposition.
- Adding checksum, lock, lease, version handshake, background coordinator or another timeout.
- Commit, push, reset, real reclaim or historical cleanup.

## Acceptance

1. Native Goal child environment freezes exactly `86400000` even when the parent has a conflicting
   value.
2. Persistent-session/non-native child environment contains no
   `GROK_FOREGROUND_BLOCK_BUDGET_MS`, including when the parent has one.
3. Existing Goal, workflow, current-model-only, Provider secret and network-policy behavior remains
   passing.
4. Candidate changes only the two allowed paths and passes ForkLight independent verification.
5. Two independent usable Judge opinions cover the exact Revision; Main records a fresh decision,
   normal preflight has no rejection, safe Integration and activation pass, and `npm run check`
   passes.
6. A new activated-source audit reaches durable native Goal `complete + achieved`, independently
   passes build, focused storage tests and diff check, and produces no Candidate change.

## Verification commands

```bash
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/worker-runtime.test.ts
git diff --check
```

After Integration Main also runs `npm run check`, restarts the Daemon from the activated build and
verifies client/Daemon identity before the live audit.

## Handoff

Worker returns the exact two-path diff, explains why 24 hours is a Runtime process safety breaker
rather than a Task deadline, and reports command results. It must not inspect broad repository
history or modify SSOT. ForkLight records Candidate/verification truth; Judges receive only this
Spec, exact scoped Candidate and verification evidence. Main checks the actual diff, environment
branches, test meaning, source-base provenance and all gates before serial Integration.

## Workspace disposition and stop rule

Protect the implementation Workspace through verification, two-Judge review, Main decision and
Integration. Do not reclaim it as part of this Work Item. The audit Workspace is likewise protected
until its terminal result and handoff are durable. Stop after two purposeful rounds repeat the same
failure, after one Main correction fails, if the two-path boundary must expand, or if the patch
starts compensating for itself. No automatic replacement, model switch or additional Judge follows.

## Terminal outcome

The two-path product Candidate delivered through all normal gates, but acceptance item 6 did not
graduate. Post-fix audit Task `f20334a0-b8bd-4886-977b-62fa3553e501` proved the old 600-second
foreground cancellation did not recur, then exposed a different product boundary: native Goal's
read-only tool projection omits `search_replace/write`, so its one-shot Planner cannot persist the
required task-local plan artifact. The Planner completed after 505,496 ms and returned a complete
plan in its durable subagent output, but native Goal has `plan_file: null`, zero classifier runs and
`user_paused/Executing`. The Task made no source change and ran no independent verification.

This expands beyond the accepted environment-only paths and therefore triggers the stop rule. The
failed audit is not resumed or replaced; a separate Main decision is required before any read-only
native Goal tool-policy Work Item.
