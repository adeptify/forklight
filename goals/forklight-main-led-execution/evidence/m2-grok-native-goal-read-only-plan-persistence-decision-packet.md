# M2 Grok native Goal read-only plan-persistence decision packet

## Terminal result

The authorized one-shot implementation stopped on an external Grok authentication failure before
ForkLight could capture or verify a Candidate. No repair, correction, reverify, retry, replacement,
Judge, Integration or live audit was started.

- Task: `d3c41fff-7bad-4af9-99fd-6e1c95657b9c`
- Session: `24335d0e-675a-4948-b361-353cbae9f351`
- Attempt: `a7c280c0-d768-4077-8c8f-74248377c2d2` (the only Attempt)
- Native Goal: `8a8dbe45-8cb9-4c60-a11f-6b84bbb4517a`
- Runtime: Grok CLI 1.0.4, `grok-4.6`, Xhigh, truthful `native-goal`

The native Goal persisted a 5,986-byte Task-local `plan.md`, completed one Worker round and began
one classifier run. During that classifier, OAuth refresh returned `invalid_grant`; the Runtime
then returned 401 `Invalid or expired credentials ... no auth context` to all three classifier
skeptics and the parent turn. Durable Goal truth is `infra_paused/Executing`, classifier verdict
`not_achieved`, zero verify rounds and the exact 401 pause message. This is an infrastructure
pause, not evidence that the implementation contract passed or failed behaviorally.

ForkLight correctly skipped automatic validation repair because its allowance was zero. There is
no `result.diff`, Candidate Revision, independent verification or Worker completion claim. The
current generic storage/decision projection says `awaiting-required-review`, but no exact verified
Revision exists for Judges to inspect; Main therefore does not create a Review Graph. This is the
already-recorded non-blocking failed-no-Candidate projection issue, not authority to weaken the
two-Judge gate.

## Reusable partial output

The protected Workspace contains a source-base-relative two-path patch:

- `src/workers/grok.ts`: 17 additions, 8 deletions.
- `tests/worker-runtime.test.ts`: 117 additions, 1 deletion.
- Total: 2 paths, 143 changed lines. This is three lines above the 140-line warning guidance, not a
  hard failure.

Read-only baseline comparison found no other business-path difference. The patch always registers
native plan mutators, threads `allowEdits` into native deny construction, conditionally adds exact
Workspace Write/Edit deny pairs, and adds native read-only/editable plus persistent-session tests.
It remains unverified and unaccepted; Main has not copied it to source or inferred a Candidate
Revision from it.

## Cost and durable storage truth

The raw Grok terminal payload reports 17 turns, 1,238,234 total tokens including cache and a USD
0.18687828 Runtime estimate. ForkLight's official usage reconciliation remains incomplete, so no
official Worker-Token, cost or Main-Token-saving claim is made.

Fresh storage preview reports 115,066,505 total bytes: 112,959,374 regenerable, 2,107,131 durable,
0 unknown, no remaining process, SQLite quick check `ok` and zero foreign-key violations. The
Workspace remains protected; no reclaim or cleanup occurred.

## Frozen stop and decision required

The accepted Spec gives this Work Item one Attempt and no repair, correction, reverify, adaptation,
retry, fallback or replacement. That allowance is exhausted. The new live audit remains
unsubmitted, the other two storage audits remain closed, and reclaim/M3 remain closed.

A future continuation requires new explicit authority after Grok authentication is restored. The
decision must name whether to reuse this exact protected two-path output through a same-Task resume
or a separately bounded recovery; Main will not choose or execute either under the current
contract.

## Authentication restored, but same-Task admission remains impossible

一骏 later re-authenticated Grok and explicitly authorized exactly one same-Task resume with the
existing Session, plan and two-path Workspace. A direct read-only Grok 4.6 Xhigh smoke completed
with `AUTH_OK` (11,429 total tokens, USD 0.00390762), proving the external authentication blocker is
gone.

The authorization cannot be admitted by the stored Task contract. Task truth freezes
`maxExtraAttempts: 0` and `maxAdaptationRounds: 0`. ForkLight's read-only adaptation preview for
`{ "maxExtraAttempts": 1 }` returned `stopped/adaptation-disabled` with summary
`Adaptation disabled: root maxAdaptationRounds is zero.` The explicit extra-attempt command is also
defined to reject when the effective `maxExtraAttempts` is zero. Main did not issue a knowingly
rejected mutation, edit Store records, change global settings, stop the Daemon, or exploit the
direct/Daemon path difference.

No authorization grant, second Attempt, Task transition or Workspace change occurred. The exact
partial output remains protected. A representable continuation now requires a new explicit
decision, normally a separately bounded recovery Task; that would revise the user's current
no-replacement boundary and is not inferred from the same-Task authorization.

Fresh source-base comparison then proved both current product paths byte-match the failed Task's
baseline. Baseline-to-Workspace comparison still names exactly those two paths and no other
business file. The protected partial can therefore be adopted exactly without re-research or
source-drift reconciliation if a recovery Task is authorized.

## Protected-partial recovery authorized

一骏 explicitly authorized one new recovery Task to adopt the exact two-path protected partial,
with Grok 4.6 Xhigh native Goal, one Attempt, zero fallback, independent acceptance, two Judges,
Main serial Integration and the existing new live audit. Main materialized the baseline-to-
Workspace delta as `retained-candidate.diff`; it names only the two allowed product paths.

The focused verifier passed forward application against current source and reverse application
against the old protected Workspace. This proves source-base compatibility and exact recoverability
without a hash, lock or general version mechanism. Operational contract
`03-protected-partial-recovery.yaml` is the only new Task admission; the failed Task remains
immutable and protected.
