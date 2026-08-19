# M2 non-Coding stop decision packet — cross-Runtime handoff execution truth

Date: 2026-08-14 (Asia/Shanghai)

## Decision required

The accepted non-Coding Work Item cannot graduate or integrate its documentation Candidate because
the one-hop successor Task has contradictory immutable Runtime truth. Main recommends authorizing
two serial narrow recovery Work Items:

1. fix direct Goal/Competition handoff admission so the destination Worker Profile and Runtime own
   the successor's frozen execution preference/mode, with focused cross-Runtime tests and normal
   high-risk ForkLight verification, Judges, Main review, safe Integration, and zero-change audit;
2. materialize the exact verified three-path documentation Candidate in one correctly admitted
   successor/recovery Task, obtain one usable independent Judge, then Main-integrate it and run the
   existing three read-only audits.

The alternative is to stop M2 and retain the current source/successor evidence. Rewriting Store
truth, accepting the mislabeled Task, manually applying the docs, starting a second-hop handoff, or
weakening the Judge/Integration gate is rejected.

## Completed and reusable output

- Coding's final environment-correct audit Goal completed 4/4; every Task passed independent
  verification with an exact empty Candidate and real source/Daemon build identity remained
  matched. Coding is graduated.
- The non-Coding Goal is
  `execution/m2-noncoding-journey/goal.json`; its original implementation Task is
  `fd41a1dc-ca0e-4918-8002-f9932908c35d`.
- Grok launched meaningfully as `grok-build/xai/grok-4.6/xhigh`, honestly froze
  `auto -> persistent-session`, and used Session `b1d682d1-f296-4b66-89fe-60081fc45207`.
- Main restarted the daemon only after `docs/main-led-delivery.md` contained a useful 265-line draft.
  Attempt 1 is durably `interrupted/130`; ForkLight granted one `system-daemon-restart`
  continuation and resumed the same Task/Session in Attempt 2.
- Attempt 2 and ForkLight independent verification passed all four accepted commands. Main then
  found the in-contract concision gap and used the Task's only correction. Attempt 3 reused the same
  Task/Session and produced concise Revision `8e6ba44c-3278-4319-9c73-719d97500ca8`, digest prefix
  `22e9bc690b49`, with three paths and 148 changed lines; independent verification passed.
- The first MiniMax Judge output was unusable (`schema-violation`). Main's attempt to switch the
  frozen Reviewer set was rejected before creating a Task. After the real concision correction, a
  fresh exact-Revision MiniMax Judge returned one usable `accept`; Main did not treat it as an
  automatic decision.
- Main found one exact storage wording gap: `unknown-orphan` is a separate non-reclaimable class,
  not `protected`. Because the original correction was exhausted, ForkLight created the supported
  one-hop handoff `a6dff084-8a65-4da4-806d-8dd407d57c7c`, preserving all three verified paths and
  only that gap.
- DeepSeek Flash successor `91d34265-fdca-4623-8aa1-646c90ff1e36` closed the wording gap and passed
  all four independent commands. Candidate Revision `04e736e7-b595-44a4-96b1-b82d2dd6cb5b`, digest
  prefix `65deb60f3f4c`, remains exactly three paths and 148 changed lines. No product source or test
  path changed.

Reusable paths:

- `README.md`
- `docs/main-led-delivery.md`
- `docs/operations.md`

## Exact blocking evidence

The successor Task's stored identity is:

- `workerProfileId: deepseek-flash-1m`
- `provider/model: deepseek/deepseek-v4-flash[1M]`
- `runtime: claude-code`
- `executionPreference: auto`
- `executionMode: persistent-session`

ForkLight's canonical capability truth in `src/core/execution-mode.ts` says only `grok-build`
supports `persistent-session`; `claude-code` and `codex-cli` do not. `auto` on Claude Code therefore
must resolve to `single-run`.

The focused source trace explains the mismatch:

1. `src/core/candidate-handoff.ts:329` clones the already frozen source Task spec.
2. `src/core/candidate-handoff.ts:330-348` replaces Provider, Runtime and Worker Profile but leaves
   the cloned `executionPreference` and `executionMode` untouched.
3. Normal admission resolves mode from the selected Runtime in `src/core/task.ts:816-837`.
4. Handoff builds the successor directly and `src/core/runner.ts:211-225` stores the supplied spec
   without running normal Task parsing again.

This is a real cross-Runtime handoff admission failure, not a model claim or theoretical
multi-user concern. It makes public Task/decision evidence say a Claude Code Worker used a Grok-only
persistent Session strategy. The successor did execute and verify its documentation, but that does
not authorize Main to relabel immutable Task truth or integrate a journey whose acceptance requires
truthful Runtime mode.

The successor also retains the source `qualityPolicy.profileId: grok-4-6-xhigh` while its effective
advanced policy correctly comes from DeepSeek Flash. This is recorded as adjacent evidence for the
narrow admission audit; it is not used to widen the blocking fix unless the accepted Work Item
proves it is the same destination-truth defect.

## Attempts and stop rule

- No doc Integration was attempted.
- Main used the one allowed same-Task correction and the one allowed handoff. A second-hop handoff
  is forbidden.
- The successor Candidate itself passes; another Worker edit cannot repair its immutable stored
  execution mode.
- Fixing handoff admission requires product source/tests outside the accepted docs-only paths.
  Continuing would therefore cross the Work Item Spec boundary and create a compensating patch.

Automatic execution stops here. No Task is retried, rerouted, amended, integrated, recreated, or
sent to Competition.

## Workspace disposition

- Original Grok Task preview: `reclaimable/handoff-successor-materialized`, 131,154,020
  regenerable bytes, 2,483,410 durable bytes, zero unknown bytes and zero processes. Main does not
  reclaim it without new destructive authorization.
- Successor preview: `protected/awaiting-required-review`, 111,033,055 regenerable bytes,
  4,388,402 durable bytes, zero unknown bytes and zero processes. It must remain protected.
- Both previews report Store integrity `quickCheck: ok` and zero foreign-key violations.

Commit, push, Store rewrite, manual source patching, Hub/UI work, credentials, locks, leases,
checksums, version handshakes, and distributed coordination remain unauthorized.
