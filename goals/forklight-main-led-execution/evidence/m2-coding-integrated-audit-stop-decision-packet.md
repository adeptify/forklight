# M2 Coding integrated audit — second admission-stop decision packet

Date: 2026-08-14 (Asia/Shanghai)

## Current truth

The exact Coding Candidate is already delivered. Revision
`57b295fc-3c08-4445-a8a5-d615dc6431bd` matches the frozen full digest
`a862bfe4abcec99ae32e364ae7df12eb85a30e15d3d65bce67965cbfe054f651`, passed
ForkLight verification and two usable independent Judges, received Main accept, and was applied by
safe Integration operation `15bd69bc-d5cf-4668-a75a-ab0aa74f2057`. Source apply/verify, artifact
build, Runtime activation, activation check, and current real-source health all passed. Current
client and Daemon build identity is matched at build
`31f1c19e27315e161c45231632d4042d12be0a5c3e85ef651b1835f98b1a1351`.

Coding remains ungraduated only because the post-Integration audit evidence is incomplete. The
accepted supplement stopped at its second concrete Runtime/admission mismatch. 一骏 then authorized
one acceptance-contract-only resolution; that resolution also stopped before any new Goal/Task was
admitted because its single amended remediation check passed 3/4 commands. Main has not reopened
implementation, weakened a product gate, re-integrated, or started another automatic recovery.

## Completed and reusable evidence

- The original Codex audit Task `15458a3c-54f2-4e16-9b3e-ac925a6abf67` produced zero diff but could
  not create build/tsx artifacts in its read-only sandbox, had no Git metadata, and lacked ForkLight
  checkpoint MCP. It failed before independent verification; no product command failed.
- The authorized replacement Goal is
  `execution/m2-coding-integrated-audits/goal.json`. It preserves the integrated Candidate and has
  no Writer, correction, Judge, Token, duration, or no-progress loop.
- Replacement Task `8e368413-8871-494f-bd81-d6689ee63dc1` passed its bounded read-only verdict,
  independent build, all 276 focused tests, and diff validation with an empty Candidate.
- Replacement Task `f17333fc-8ec8-45a1-b082-082b92ba7d0d` used ForkLight checkpoint successfully.
  Worker checkpoint and independent verification both passed build, 250 focused tests, and
  `git diff --check`; the Candidate is empty and source compatibility passed.
- The only failed command in that Task was the Workspace-local
  `node dist/src/cli.js health --json` identity assertion. `health` probes an already-running Daemon
  and does not start one. The isolated Task Home had no reachable Daemon, so it truthfully returned
  `identityStatus: daemon-unavailable`. The same command against the activated real source returns
  `identityStatus: matched`, and the Integration operation already has a durable passed
  `runtime-activated` and activation-check result.
- Downstream zero-change Tasks `fe4affc9-e108-45fe-b5d0-f158f17724e5` and
  `26513cd6-2275-4e9c-8d3c-4cecebef6ac5` have not run. Their evidence is not being claimed.
- 一骏's authorized resolution produced Main revise event 111, exactly bound to Attempt
  `e5977c17-ee10-4672-95b6-f23fe5dae412`, verification event 108, empty Candidate Revision
  `d8306bf2-d702-45f2-8438-25bfed668574`, and digest `e3b0c442...b855`.
- Failure attribution event 114 durably classifies the original verification as
  `acceptance-contract/non-model`; the first attribution call was rejected before mutation because
  Main had not supplied the required empty-Candidate Revision binding.
- Amended remediation check `eb46f89b-03a7-446e-be4f-90d87f922f8d` preserved all three passing
  command slots and reran four commands against an isolated current-source copy. It passed 3/4 and
  created no delivery disposition. The remediation verifier intentionally sanitizes only Git
  variables and otherwise inherits Main's process environment, so it reached the real matched
  Daemon. The replacement command incorrectly required `daemon-unavailable`; current health proves
  `identityStatus: matched`, which explains the sole amended-check failure.
- Draft Goal `execution/m2-coding-final-audits/goal.json` and its four serial zero-change Tasks pass
  read-only validation, but ForkLight Store contains no Goal or Task from that draft. It is reusable
  planning output, not delivery evidence.

## Exact stop

The accepted supplement states that any failed independent command or second Runtime/admission
failure stops the supplement with a decision packet. The Goal is therefore durably
`waiting/milestone-failed` at 1/4, the failed Task remains protected as `unresolved-partial`, and
downstream work stays blocked. Its storage preview reports zero deletion targets, zero unknown
bytes, zero process, Store integrity `ok/0`, and `protect-and-wait`.

This failure does not show that activated source identity is wrong. It shows that one acceptance
command requires real-home Daemon context while the rest of the audit intentionally runs in an
isolated Task Home. Repeating the same command in another isolated Workspace would add no evidence.

The authorized remediation added a narrower execution-context fact: Main remediation copies source
but intentionally inherits Main's ForkLight Home, unlike the failed Worker Task. Expecting
`daemon-unavailable` there was itself contradictory. The check remained failed, the old machine
gate remained closed, and the accepted “another failed command stops” rule prevented submission of
the already validated final audit Goal.

## Grok authentication truth

After 一骏 completed Grok authentication, current ForkLight health reports xAI `ready: true` through
`local-sign-in`, and Profile `grok-4-6-xhigh` is launchable as
`grok-build/xai/grok-4.6/xhigh` with resolved mode `persistent-session`. Its reason remains
`connection-unverified` and next action is `run-smoke-check`; current Provider status/probe truth is
not a successful Grok 4.6 launch. Main therefore does not yet call the Profile `ready` and will not
label it `native-goal`.

Authentication recovery does not erase the audit stop or authorize automatic Task recreation. A
later meaningful Task may be the one real Grok launch smoke; ForkLight must retain its actual
result, and a launch failure must not trigger automatic rerouting.

## Attempts and remedies

1. Exact Candidate recovery, independent verification, two Judges, Main accept, and safe
   Integration — passed.
2. Original Codex zero-change audit — stopped on the read-only/checkpoint admission mismatch with
   zero diff.
3. Accepted four-Task audit supplement — first gate passed fully.
4. Second supplement gate — behavior review, build, focused tests, and diff passed; only the
   Workspace-local Daemon health assertion failed identically under Worker checkpoint and ForkLight
   verification.
5. Main independently checked real-source health — client and Daemon identity matched.
6. 一骏 authorized one acceptance-contract-only resolution. Exact Main revise and non-model failure
   attribution were recorded without changing Task/Attempt status.
7. One amended remediation ran with no Worker, Candidate or Integration. Build, focused tests and
   diff passed; the new health replacement failed because remediation inherited the reachable real
   Home and therefore returned the already-proven matched identity.
8. The required four-milestone final Goal draft passed read-only validation but was not submitted
   after the remediation failure triggered the accepted stop.

No product patch, manual Candidate filtering, second amendment, new Task, model switch, extra Judge,
Integration, Store rewrite, cleanup, lock, lease, checksum protocol, version handshake, commit, or
push followed the new stop.

## Workspace disposition

Protect the original and replacement audit Workspaces until Main receives a terminal decision. The
failed replacement Task currently preserves 3,172,528 durable bytes and 110,906,185 regenerable
bytes, with no unknown bytes or live process. Reclaim is not authorized while its evidence remains
an unresolved partial result.

## Decision required from 一骏

Recommended: authorize submission of the four-milestone final audit Goal without a second
amendment. Its first zero-change Task already audits the actual failed-remediation truth: the failed
amended check has no delivery authority, the original Task and machine gate remain failed, and fresh
environment-correct Tasks are required. Then run the corrected activation,
wrong-Candidate/rollback and operation-surface gates serially. A single failure stops; no further
Goal, amendment, retry or reroute follows.

Immediately before submission, run one current Provider smoke for DeepSeek, Volcengine and MiniMax;
the retained Profiles are launchable but their connection evidence is now stale. Any smoke failure
stops admission without model substitution or repeated probing.

This path reuses all passing evidence and avoids a redundant remediation retry. It does not alter
product code, rerun Coding implementation, weaken source-only recovery safety, add a Judge,
re-Integrate, or claim the failed remediation passed.

After Coding graduates, use the not-yet-started non-Coding journey as the first meaningful Grok 4.6
Xhigh launch smoke. Record the actual mode as `persistent-session`; if launch fails, stop with that
evidence rather than recreating or silently rerouting the Task.

Alternative: keep both stopped audit Goals, the failed remediation and all Workspaces protected at
the present stop. M2 delivery and the dependent non-Coding journey remain ungraduated.
