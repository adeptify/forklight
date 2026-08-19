# M2-A Work Item — Grok native Goal read-only plan persistence

## User result

A read-only Grok 4.6 Xhigh native `/goal` Task can persist its required Task-local plan and finish
normal planning/classification, while every product Workspace path remains explicitly non-writable.
Editable native Goals keep their current edit capability. Persistent-session and other non-native
Grok execution keep their existing tool policy.

## Background and current evidence

The delivered foreground-budget fix removed Grok CLI's false 600-second Planner cancellation. The
new activated-source audit Task `f20334a0-b8bd-4886-977b-62fa3553e501` then exposed the next exact
boundary: its Planner completed after 505,496 ms and 73 tool calls, but
`grokNativeAllowTools(false)` did not register `search_replace/write`. The complete plan survived in
durable subagent output, yet the native Goal could not create its required Task-local
`grok-home/.../goal/plan-*.md`; it remained `user_paused/Executing` with `plan_file: null`, zero
classifier runs, no Candidate and no independent verification.

This is already feasibility-proven rather than speculative. Operational policy test
`foreground-plan-bootstrap.test.mjs` passes, and historical read-only Task
`6fbf8e70-a48a-4e7b-8cb8-3dc07e836085` produced a 7,281-byte Task-local plan, one achieved
classifier and a completed native Goal while exact Workspace `Write/Edit` plus Bash denials were
active. The missing product behavior is therefore the same narrow adapter distinction.

一骏 explicitly authorized this as a single Work Item with one Attempt, no repair, correction,
retry, adaptation or replacement, Grok 4.6 Xhigh, independent acceptance, two Judges, Main serial
Integration and one new live audit. This file is its only accepted specification.

## `depends_on`

- Integrated native Goal/current-model-only behavior and delivered foreground-budget Revision
  `c0fb927a-65b0-4d84-8534-a04adc3f29e8` with matched client/Daemon identity.
- Immutable failed audit evidence from Task `f20334a0-b8bd-4886-977b-62fa3553e501`.
- Passing operational feasibility proof and completed historical native Goal
  `e1941538-caf8-4c0b-bdf1-5c5241bf3476`.
- No concurrent product writer. The new live audit depends on successful verification, two usable
  Judge opinions, Main accept, safe Integration, full check, activation and matched health.

## Inputs

- `grokNativeAllowTools` and `buildGrokCliArgs` in `src/workers/grok.ts`.
- `grokNativeDenyArgs`, which already protects Task-local credentials, configuration, Goal state,
  MCP and Bash.
- Existing native editable/read-only and persistent-session argv tests in
  `tests/worker-runtime.test.ts`.
- The Task Workspace path already supplied to the adapter; no new schema or Store field is needed.

## Outputs

- Every native Goal registers `search_replace` and `write` so its Planner can persist Task-local
  plan artifacts.
- A native Goal with `allowEdits:false` additionally receives exact
  `--deny Write(<workspace>/**)` and `--deny Edit(<workspace>/**)` argv pairs.
- A native Goal with `allowEdits:true` receives no Workspace-wide Write/Edit denial.
- Existing credential/config/state/MCP/Bash denials stay intact.
- Persistent-session/non-native read-only execution still omits plan mutators and retains its
  existing whole-`GROK_HOME` denial.
- Focused deterministic tests and one post-activation zero-diff live audit prove both local policy
  behavior and the real native Goal lifecycle.

## Accepted design and call chain

1. `grokNativeAllowTools` always returns the existing native registrations plus
   `search_replace/write`; `allowEdits` no longer removes these two Task-local plan dependencies.
2. Pass `allowEdits` into native deny construction. Only the false branch prepends exact Workspace
   `Write/Edit(<workspace>/**)` deny pairs.
3. Keep the current Task-local credential, agent id, configuration, native state, MCP and Bash
   denials unchanged. Do not deny all of `GROK_HOME`, because that would again block plan
   persistence.
4. Do not remove `Agent`, `run_terminal_cmd`, `get_task_output`, `kill_task` or `wait_tasks`; their
   registration is outside this failure and Bash remains denied.
5. Preserve `grokAllowTools(false)` and the non-native deny branch exactly, so
   persistent-session/read-only behavior does not widen.
6. Add focused argv/tool tests for native read-only, native editable and non-native read-only
   branches. Tests must assert exact deny pairs, not only substring presence.
7. ForkLight independently runs the approved commands. Two independent read-only Judges inspect
   the exact Revision. Main alone accepts and applies through safe Integration.
8. After activation, Main submits one new read-only storage audit. Success requires a persisted
   Task-local plan, classifier verdict `achieved`, native Goal `complete`, zero source diff and all
   acceptance commands passing.

## Allowed product paths

- `src/workers/grok.ts`
- `tests/worker-runtime.test.ts`

Main may separately update only this accepted Spec, the existing Goal SSOT and its operational
Task/evidence files. The Worker must not edit those files.

## Forbidden paths and non-goals

- Any other `src/**`, `tests/**`, public docs, schema/settings, Store, protocol, Integration,
  storage-lifecycle or Hub/UI path.
- Resuming, correcting, retrying, relabeling or replacing either failed audit Task.
- A second implementation Attempt, validation repair, Main correction/reverification, adaptation,
  replacement, model switch, fallback or third Judge.
- Removing native background-control registrations or enabling Bash.
- Public permission settings, a new sandbox/ACL layer, checksums, hashes, locks, leases, version
  handshakes or duplicate consistency validation.
- Commit, push, reset, real reclaim or historical cleanup.

## Acceptance

1. `grokNativeAllowTools(false)` and `grokNativeAllowTools(true)` both contain the existing native
   registrations plus `search_replace` and `write` exactly once.
2. Native read-only argv contains exact Workspace Write and Edit deny pairs, keeps Task-local
   plan paths writable, and preserves every existing credential/config/state/MCP/Bash denial.
3. Native editable argv contains the plan mutators and does not contain Workspace-wide Write/Edit
   denials.
4. Persistent-session/non-native read-only argv still omits `search_replace/write` and retains the
   existing whole-`GROK_HOME` Write/Edit denial.
5. Candidate changes only the two allowed paths and ForkLight independently passes every command.
6. Exactly two independent usable Judge opinions cover the exact Revision; Main records a fresh
   accept, normal preflight has no rejection, safe Integration and activation pass, and
   `npm run check` passes.
7. The new read-only live audit reaches durable native Goal `complete + achieved`, has a non-empty
   Task-local plan file, independently passes build, focused storage tests and diff check, and
   produces no Candidate change.

## Verification commands

```bash
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/worker-runtime.test.ts
git diff --check
```

After Integration Main also runs `npm run check`, restarts the Daemon from the activated build and
checks matched client/Daemon identity before the live audit.

## Handoff

The Worker returns the exact two-path diff, command results and a concise explanation of why native
plan mutators do not grant Workspace edits under the new read-only deny pairs. It reports whether
all pre-existing native controls and non-native behavior remained unchanged. ForkLight records the
Candidate and independent verification; Judges receive only this Spec, exact scoped Candidate and
verification evidence. Main checks actual argv construction, exact deny pairs, test meaning,
source-base provenance and all gates before serial Integration.

## Workspace disposition and stop rule

Protect the implementation Workspace through verification, two-Judge review, Main decision and
Integration. Protect the live-audit Workspace until its terminal truth and handoff are durable. Do
not reclaim either Workspace in this Work Item. There is exactly one implementation Attempt and no
repair, correction, reverify, adaptation, retry or replacement. Any implementation failure,
required path expansion, self-compensating patch, unusable required Judge set, Integration failure
or live-audit failure stops the Work Item with a decision packet; Main does not widen the boundary
automatically.

## Terminal outcome

The single implementation Attempt stopped during native Goal classification because Grok OAuth
refresh returned `invalid_grant` and every classifier call then received 401. Goal
`8a8dbe45-8cb9-4c60-a11f-6b84bbb4517a` is durably `infra_paused/Executing`; its 5,986-byte
Task-local plan and one Worker round are reusable, but classifier verdict is `not_achieved` and
verify rounds are zero. ForkLight captured no Candidate Revision and ran no independent acceptance.

The protected Workspace contains only the intended two-path source-base-relative patch (143 changed
lines), but it remains unverified. Zero validation repair/correction/retry/replacement was consumed
beyond the one base Attempt; Judges, Integration and the new live audit were not started. The Work
Item therefore stops under its frozen rule. See
`goals/forklight-main-led-execution/evidence/m2-grok-native-goal-read-only-plan-persistence-decision-packet.md`.

### Authentication recovery authorization

一骏 re-authenticated Grok and explicitly authorized one same-Task resume reusing the existing
Session, plan and two-path Workspace, with no repair, correction, replacement or further resume.
A direct read-only Grok 4.6 Xhigh smoke returned `AUTH_OK`, so Provider authentication is restored.

ForkLight cannot represent the authorized extra Attempt on this immutable Task: its frozen
`maxExtraAttempts` is 0, and read-only adaptation preview for `{ "maxExtraAttempts": 1 }` stopped
because the root `maxAdaptationRounds` is also 0. No grant, Attempt or Task transition occurred.
Changing the existing YAML cannot change the stored Task snapshot, and Main will not mutate Store
records or bypass ForkLight admission. The Work Item therefore remains stopped until a new decision
authorizes a representable recovery boundary.

### Authorized protected-partial recovery

一骏 explicitly authorized one new recovery Task that adopts the protected exact two-file output
from Task `d3c41fff-7bad-4af9-99fd-6e1c95657b9c`. It uses Grok 4.6 Xhigh native Goal, one Attempt,
zero repair/correction/reverify/adaptation/retry/replacement, independent acceptance, two Judges,
Main serial Integration and the already accepted new live audit; failure stops.

Main captured the old baseline-to-Workspace delta as operational input
`retained-candidate.diff`. It contains only the two allowed product paths. Focused verifier
`retained-candidate.test.mjs` proves the patch forward-applies to current source before admission
and reverse-applies to the protected old Workspace; recovery acceptance runs the reverse check
again on the new Candidate. These are the minimum checks for the concrete wrong-source-base or
wrong-Candidate failure, not a general checksum/version protocol. The recovery Task must adopt the
retained hunks exactly and may not re-research or redesign them.

### Protected-partial recovery outcome

Recovery Task `89829dc6-be26-44ea-8517-ba901e0f1be3` satisfied the amended terminal boundary.
Its one Grok 4.6 Xhigh native Goal Attempt reached `complete + achieved` with a 5,358-byte
Task-local plan. ForkLight independently passed build, 137 focused runtime tests, the exact
retained-Candidate reverse check and diff validation. Revision
`f934cc84-36bf-40f6-93e4-a7c849d6901c` has full digest
`56a6a4aef264a530b7c5d8e1193ca4c458c04f1841d485b6beb52319247e83fe`, changes only the two
allowed paths and received two usable independent `accept` opinions.

Main accepted the exact Revision; normal preflight, safe Integration
`18f71ac9-10e7-4e04-9225-22c12b3368d5`, activation and `npm run check` 2,971/2,971 passed. The
new live audit Task `b3b78cfc-d3e8-4335-9707-a872b6d9561b` then proved activated read-only truth:
native Goal `e9bf72b0-957e-4efc-841e-7278768f6c5a` is `complete + achieved`, its Task-local plan
is 5,124 bytes, all three independent commands passed, and Candidate diff is empty. No repair,
correction, retry, replacement, commit, push or reclaim occurred.
