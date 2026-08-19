# M2-A supplement — Grok CLI native Goal truth

## User result

Main can assign a meaningful Task to Grok CLI 4.6 Xhigh using Grok's own `/goal` mode. ForkLight
reports success only when Grok's durable Goal state says `complete` and the native independent
verification says `achieved`; ordinary assistant text or a zero process exit cannot impersonate
completion. A paused or interrupted Goal resumes the same Grok Session and Goal identity, while an
authorized correction after native completion creates a traceable successor Goal in the same Task
and Workspace.

## Background and current evidence

ForkLight currently launches Grok with `grok -p <worker prompt>`, freezes
`auto -> persistent-session`, and explicitly reports `nativeGoal: unsupported`. This is truthful for
the integrated adapter but no longer the desired terminal capability.

The installed stable Grok CLI is 1.0.3 and matches the official 1.0.3 source. Its headless prompt
path enters the same slash-command resolver as the TUI. The official native Goal state contains a
separate `goal_id`, objective, active/paused/blocked/budget/complete status, phase, cumulative usage,
rounds, persisted history, classifier verdict, and evidence-details path. `/goal resume` restores
that state from the Session directory.

Main ran a real isolated read-only smoke with `GROK_GOAL=1`, `GROK_WORKFLOWS=1`, model `grok-4.6`
and effort `xhigh`:

- `/goal status` returned the native no-Goal result without a model call.
- Goal `f88df868-008a-43ae-a4ec-1dd5881d1f44` first paused despite model prose claiming completion;
  the durable reason was a failed planner dependency, so prose was correctly not accepted.
- The same Session and Goal resumed after each narrower policy correction. The final durable state
  is `complete`, `classifier_runs_attempted: 1`, `last_classifier_verdict: achieved`, with an
  independent details file containing three non-refuting skeptic reports.
- Source and isolated README SHA-256 values remain equal. The final headless usage was 470,355
  total tokens and USD 0.5794094, so native Goal is reserved for meaningful work and its cost stays
  transparent; this Work Item adds no default Goal token ceiling.

Compact evidence is in
`goals/forklight-main-led-execution/evidence/m2-grok-native-goal-preflight.md`.

## `depends_on`

- Graduated M2-A persistent-session support remains the compatibility fallback and provides the
  Task-local Grok Home, OAuth seed, sandbox, same-Session resume, event normalization and usage.
- Grok CLI 1.0.3 native `/goal` create/status/resume/durable-state behavior is proved by the current
  official source plus the real smoke above.
- The resolved-terminal storage Candidate remains frozen at its review cap. Its only writable
  product paths are `src/core/storage-lifecycle.ts` and `tests/storage-lifecycle.test.ts`, so it is
  path-orthogonal to this implementation. Main nevertheless integrates Candidates serially.
- This supplement must integrate and pass its live Task before the exact storage review-cap
  recovery starts. The recovery will be the first meaningful normal Task to require Grok native
  Goal rather than a bootstrap wrapper.

## Inputs and outputs

Inputs:

- frozen Task execution preference, Runtime/model/effort, Task Session id, Worker prompt and any
  typed correction/validation-repair intent;
- Task-local Grok Home and Workspace paths;
- Grok's durable `<session>/goal/state.json` plus the native classifier-details artifact;
- existing ForkLight independent acceptance, Candidate, review and Integration chain.

Outputs:

- Grok `nativeGoal: supported` capability and new-Task `auto -> native-goal` truth;
- first launch as `/goal <full Worker objective>` and ordinary restart continuation as
  `/goal resume` on the same Session/Goal;
- a small validated native-state reader and privacy-safe durable observation events;
- fail-closed terminal mapping: only native `complete + achieved + readable owned details` may
  proceed to ForkLight verification;
- a traceable successor native Goal for an explicitly authorized correction after completion;
- focused tests, user-facing runtime documentation and one real post-Integration ForkLight Task.

No new Store entity, Goal table, lock, lease, checksum, content hash or coordination protocol is
needed. Current Task events and the Runtime-owned durable Goal file are the two existing truths at
their respective boundaries.

## Writable paths and orthogonality

The sole implementation Writer may edit only:

- `src/workers/grok.ts`
- `src/workers/grok-goal.ts` (new, if separation keeps parsing/terminal truth small)
- `src/core/execution-mode.ts`
- `src/core/settings.ts` only if the existing Grok 4.6 Xhigh Profile needs a truthful text/default
  adjustment; its identity/model/effort must not change
- `tests/worker-runtime.test.ts`
- `tests/task.test.ts`
- `tests/worker-profiles.test.ts`
- `tests/worker-readiness.test.ts`
- `tests/cli-health.test.ts`
- `tests/task-preview.test.ts`
- `tests/competition.test.ts`
- `tests/goal.test.ts`
- `docs/configuration.md`
- `docs/main-clients/grok-build.md`
- `docs/main-led-delivery.md`

The Worker must not edit shared Goal SSOT/spec files; Main owns them serially. No Hub/UI path is
allowed. One Writer owns the coupled product/test/docs slice. Two later Judges are read-only.

The initial Writer is a bootstrap exception because the integrated adapter still rejects
`native-goal`. Main will submit it through ForkLight's isolated Workspace using a reviewed,
non-product executable wrapper that changes only the Grok process invocation to native `/goal` and
preserves the Task's recorded integrated mode as `persistent-session`. Main will separately inspect
the Runtime-owned native Goal state before accepting any Candidate. The wrapper is not integrated,
not documented as product capability and cannot satisfy this Work Item's live graduation gate.

## Required behavior

### Admission and launch

- `nativeGoalSupportForRuntime("grok-build")` becomes true only with the production adapter path in
  this Candidate. New `auto` Grok Tasks freeze `native-goal`; forced native Goal validates; forced
  `persistent-session` remains available as an explicit compatibility choice.
- First native launch uses the existing Task Session id and sends a prompt beginning with exactly
  `/goal ` followed by the complete Worker contract. It sets `GROK_GOAL=1`, keeps background
  workflows enabled, selects the frozen model/effort, and does not add a Goal Token budget unless
  an accepted future Task contract explicitly names one.
- The shell tool may remain registered because Grok's planner requires that capability to build,
  but actual shell execution stays denied. Native Goal plan/state/scratch writes in the isolated
  Runtime Home are allowed; Workspace writes follow `worker.allowEdits`. Provider auth, agent id,
  configuration and native `state.json` remain model-write-denied.
- MCP, web search, nested unrestricted runtime escape, source-project writes, commit and push stay
  forbidden. The production sandbox still owns filesystem/process isolation.

### Durable Goal truth

- Locate the state only under this Task's task-local Grok Home, exact Workspace Session namespace
  and Task Session id. Reject missing, ambiguous, malformed, unknown-status or wrong-shaped state.
- Validate only the fields needed to prevent a concrete false completion or unreadable schema:
  non-empty Goal id/objective, known status/phase, finite non-negative counters, and terminal
  classifier evidence. Do not introduce a checksum, manifest, version handshake or duplicate Store
  copy of the full Goal state.
- Emit privacy-safe observations when native status changes and at terminal. Payload may contain
  Goal id, status, phase, rounds, classifier verdict and usage counters; it must not contain prompts,
  result bodies, local auth paths, secrets or raw classifier prose.
- CLI terminal text and exit code remain Worker claims. A successful ForkLight Worker result
  requires native status `complete`, at least one classifier attempt, verdict `achieved`, and a
  readable details artifact owned by this Task's Runtime Home. ForkLight then still runs its own
  approved acceptance commands.
- Paused, blocked, budget-limited, active-at-exit, missing-state and incomplete-verification Goals
  return a bounded failure/decision reason and never start ForkLight acceptance as if complete.

### Resume and correction

- Ordinary daemon/process continuation reads the existing state, sends `/goal resume`, uses the
  same Task Session and requires the same Goal id after resume.
- Typed Main correction or Worker validation-repair after native completion sends a new
  `/goal <correction objective>` in the same Session and Workspace, captures the prior terminal
  Goal id before launch, and requires a distinct successor Goal id afterward. Record only the
  predecessor/successor ids and reason class in durable events.
- A correction reuses accepted files; it does not recreate the Task, reset the Workspace, clear
  history, silently fall back to persistent-session, or overwrite prior ForkLight evidence.

## Forbidden paths and non-goals

- No `src/hub/**`, Store/daemon protocol/schema migration, Review Graph policy, Judge admission,
  Candidate handoff, Integration, storage lifecycle, routing, economics, provider credential,
  remote, commit or push change.
- No custom replacement Goal engine, copied Grok Goal database, ACP reimplementation, TUI driver,
  lock, lease, hash manifest, version negotiation, distributed recovery or multi-user consistency.
- No attempt to make every trivial query use native Goal. The user preference is “as much as
  possible” for real tasks; the measured token/cost overhead remains visible.
- Do not weaken ForkLight independent verification because Grok already ran native skeptics, and do
  not count Grok's internal skeptics as ForkLight's required external Judges.
- Do not relabel historical persistent-session Tasks. Their frozen execution truth remains intact.

## Acceptance

- New Grok 4.6 Xhigh `auto` Tasks freeze and project `native-goal`; explicit
  `persistent-session` and legacy omitted Task records retain their documented compatibility.
- Focused argv/env tests prove first `/goal <objective>`, `/goal resume`, same Session, exact
  model/effort, enabled native Goal/workflows, no implicit Goal Token ceiling, registered-but-denied
  shell, allowed Runtime-Home Goal artifacts and protected auth/config/state paths.
- State parser tests cover complete/achieved, each paused family, blocked, budget-limited, active,
  unknown status, missing/malformed fields, missing/escaping details path and ambiguous state roots.
- An exit-0 fake claiming completion with no valid state fails before independent acceptance.
- Complete-without-achieved and achieved-without-readable owned details both fail. Exact
  complete/achieved/owned-details succeeds and reaches ForkLight independent verification.
- Restart continuation proves the same Session and Goal id. An authorized post-completion
  correction proves a distinct successor Goal id in the same Task/Workspace. An untyped ordinary
  resume cannot cross a completed Goal boundary.
- Health, preview, inspect/status and start/resume events agree on `native-goal`; no surface calls
  the bootstrap Task native product support.
- Candidate changes only allowed paths, passes ForkLight verification, two independent different-
  view Judges and Main diff/provenance review before safe serial Integration.
- Post-Integration, a real ForkLight Grok 4.6 Xhigh Task has no bootstrap wrapper, records a durable
  native Goal id/status/achieved evidence, passes ForkLight acceptance, and proves same-Task resume
  if it pauses or is intentionally interrupted after useful progress.

Any false success, credential/config/state model-write access, missing stable resume identity,
unreadable state schema, need for a forbidden path, or two purposeful rounds with no new evidence
stops this Work Item without widening it.

## Verification commands

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/worker-runtime.test.ts tests/task.test.ts tests/worker-profiles.test.ts tests/worker-readiness.test.ts tests/cli-health.test.ts tests/task-preview.test.ts tests/competition.test.ts tests/goal.test.ts
git diff --check
```

The local verifier keeps the existing 30-minute per-command safety breaker. Development and Grok
native Goal execution have no absolute wall-clock, Token or no-progress ceiling. Main observation
timeouts never cancel or relabel a still-running Goal.

## Review, handoff and workspace disposition

This is core Runtime/recovery/security truth, so exactly two independent read-only Judges inspect
the exact Candidate after ForkLight verification: one focuses Goal identity/state/terminal and
resume/correction semantics; the other focuses sandbox/tool policy, legacy compatibility and public
truth. Main resolves disagreement and alone authorizes Integration.

Worker handoff names the bootstrap native Goal Session/id/final status, Candidate Revision, changed
paths, commands, independent verification and any gap. The final product live smoke names its own
ForkLight Task/Attempt, native Goal id, state transitions, classifier verdict, usage/cost, Candidate
and disposition. Raw prompts/classifier logs stay private.

Protect the bootstrap Task Workspace/Grok Home, Candidate, verification and Judge Workspaces until
safe Integration and the product live smoke are durable. Then ordinary terminal lifecycle may
reclaim regenerable Workspace, baseline, Runtime Home, caches and native scratch while retaining
the minimal ForkLight events, Candidate/Integration evidence and compact native Goal proof. A
paused, ambiguous, reusable-partial or review-blocked Task remains protected.

## Final authorized current-model-only recovery — 2026-08-15

一骏 explicitly authorizes one final ForkLight Task to reuse exact Candidate Revision
`00d99db6-429f-4786-b982-740f19581b31` (digest
`e12f45e8d2b9daceebc1b5d53929a455e7ae0965110853b3e677960a0fd42f62`) and close only the
remaining Main-review gap. This section is part of the existing unique Work Item Spec; no second
product roadmap or duplicate specification is created.

### Result, dependencies, inputs and outputs

The user result remains the native `/goal` result above, with one additional identity invariant:
every native planner/strategist/skeptic role uses the Task's frozen Grok 4.6 model. The recovery
depends on the exact 14-path Candidate, verification sequence 6511, two usable Judge accepts and
Main's fresh exact `revise`. The retained patch and current source must pass digest and forward-apply
preflight before submission.

Input is the exact retained Candidate plus one bounded gap: production native environment omits
`GROK_GOAL_USE_CURRENT_MODEL_ONLY=1`. Output is a fresh Candidate containing all 14 retained paths
where only `src/workers/grok.ts` and `tests/worker-runtime.test.ts` differ from the retained bytes.
Native mode sets the flag; explicit `persistent-session` removes it even when inherited from the
ambient process. All original launch/resume/successor/state/sandbox/public-truth behavior remains
unchanged.

### Allowed paths, execution and stopping

The ForkLight focus set is the exact 14 retained Candidate paths because the seed is part of the
fresh Candidate diff. Grok may newly edit only `src/workers/grok.ts` and
`tests/worker-runtime.test.ts`; the other 12 paths are imported reusable output and must stay
byte-identical. Goal SSOT, operational wrapper/seed, storage paths, Review Graph, Hub/UI and every
other product path are forbidden to the Worker.

The operational bootstrap verifies the retained patch digest, applies it only to a compatible
isolated Workspace (or recognizes the exact already-applied seed for same-Attempt recovery), then
runs a real Grok CLI 4.6 Xhigh current-model-only native `/goal`. Product truth remains honestly
`persistent-session` until safe Integration and the no-wrapper live proof.

The Task has one base Attempt and zero extra Attempt, validation repair, Main correction,
reverification, adaptation, handoff, reroute, model switch or replacement. Any bootstrap, native
Goal, independent verification, path-delta, Judge or Integration failure ends this recovery and
returns a decision packet. Elapsed time and Token are not completion conditions.

### Acceptance, review, handoff and disposition

ForkLight runs the seed/bootstrap policy check, a reverse check proving the 12 non-delta retained
paths, the original build and eight-file suite, and diff check. Main separately compares all 14
final Workspace files with the retained Candidate and accepts only the two named delta paths.

Exactly two fresh independent read-only Judges inspect the fresh Revision: identity/env/legacy
compatibility from one view and native Goal/recovery/security from the other. No third or
replacement Judge is allowed. Main alone records the final decision and uses ForkLight safe serial
Integration, activation and a no-wrapper product live Task. Until all gates pass, source Task,
recovery Task, Candidates, native Goal state and Judge Workspaces stay protected. No commit, push or
destructive reclaim is authorized.

## Authorized Git-isolated wrapper-only replacement — 2026-08-16

一骏 explicitly revokes only the prior recovery Task's `no-replacement` terminal boundary and
authorizes one new replacement Task. The failed Task, Attempt and wrapper remain immutable. The new
operational wrapper differs only in the environment of its internal `git apply` subprocess:
`GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_SYSTEM=/dev/null`.

This boundary is already proven read-only in the exact failed Workspace under an equivalent macOS
sandbox: without those variables Git exits 128 while trying to read the user's `.gitconfig`; with
only those variables the exact Candidate check exits 0. The proof applies no patch and changes no
product state. All 14 retained Candidate paths, two allowed product delta paths, Grok 4.6 Xhigh
identity, native `/goal` bootstrap, original verification, exactly two Judges, Main safe serial
Integration and no-wrapper live proof remain unchanged.

The replacement again has one base Attempt and zero extra Attempt, validation repair, Main
correction, reverification, adaptation, handoff, reroute, model switch or further replacement. Any
failure is terminal. No commit, push, storage reclaim, Hub/UI or M3 is authorized.
