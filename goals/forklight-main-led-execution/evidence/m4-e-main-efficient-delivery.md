# M4-E Main-efficient delivery — activated evidence

Date: 2026-08-18 (Asia/Shanghai)

## Result

M4-E is delivered and activated. ForkLight now exposes two resumable Main decision-boundary calls:
`delivery prepare` runs or observes the Task and exact Review Graph up to the Main decision, while
`delivery decide` records one exact Main decision and, only for accept, binds one fresh post-review
preflight to one safe Integration. Observation timeouts do not cancel or fail the underlying Task.

This delivery does not graduate M4 and does not claim Main Token saving. The next and only ready
gate is one fresh, meaningful, non-replay `worker-runtime` pair using these checkpoints.

## Exact implementation chain

- Work Item: `specs/m4-e-main-efficient-delivery/work-items/fresh-preflight-binding/spec.md`.
- ForkLight Task `3e2740eb-4c4e-4a55-9a80-86c51c35a5b5`, Session
  `04ef556b-465e-43f7-8dd5-44171857fda4`, one Grok 4.6 Xhigh native Goal Attempt
  `4d93ffd7-2078-4b5f-a3cf-dfebdd690eed`; no repair, correction, reverify, retry, fallback or
  replacement was used.
- Candidate Revision `fe127fd9-d4c3-42c2-826e-21eea52af2f4`, digest
  `42a6a2b51220d33a96bea8d279a6f6e068d89c595a8ab61b17f06b1d7998a371`, retained the exact
  19-path delivery Candidate. The Worker changed only `src/core/main-delivery.ts` and
  `tests/main-delivery.test.ts` on top of the retained seed; the operational gate individually
  proved the other 17 paths unchanged.
- ForkLight verification sequence `2646` passed the retained-path policy, build, 461/461 focused
  tests and `git diff --check`.
- Review Graph `013c2594-c9cf-4f3c-ab15-e30a1239b5bf` completed with two usable independent accept
  proposals: Codex Luna Max Task `53579dd0-bed7-4819-a355-19cb7fa46bbc` and DeepSeek Pro Task
  `7b7531ac-311e-4c59-82c6-3bc556c50ac8`. Main then inspected the actual two-path delta and accepted
  the exact Revision/digest.
- Fresh receipt `2b0075f8-b7fa-4dd0-b6e4-1b9de1e9b844` had no rejection reason and was bound to
  Integration result `c3879c21-0b57-4b64-be68-3dd666942181`. Source apply, source verification,
  artifact build and runtime activation all passed; Task disposition is `delivered`.

## Contract proof

The first accept ignores all pre-review receipts and creates a fresh post-review preflight. Exact
re-entry selects the first receipt after the matching Main review and accepts only an operation or
result carrying that same receipt id. An older rejected or unconsumed receipt cannot poison the
first call; a later unrelated receipt cannot replace the binding; a bound rejection remains a
blocker and does not trigger retry. Focused regressions cover these cases and the existing
observation-timeout re-entry path.

The implementation uses only ordered Task events, receipt ids and Integration receipt identity.
It adds no Store/receipt schema, EventType, delivery entity, checksum/content hash, lock, lease,
version handshake, distributed coordination, automatic retry or Hub/UI work.

## Activated verification

- ForkLight independent acceptance: 461/461 focused tests passed.
- Post-Integration `npm run check`: build plus 3,084/3,084 tests passed, zero failures.
- Post-build `git diff --check`: passed.
- Root CLI help exposes both `delivery prepare` and `delivery decide` with the accepted resumable
  boundary and timeout semantics.
- Daemon restarted only after the full check regenerated build identity. Client and Daemon now
  match build `e8e5e35e5d9a71ad11e148602147cf69b8f352f4846d028967214ca5597bd33f` and source digest
  `79c7aa0c9fe3cbc7985e158a3d4fee451e747fd90cb8fce509945abb363589c3`; health is `ok`.

No commit, push, reset, storage reclaim, Provider credential change or Hub/UI mutation occurred.
The delivery Workspace may follow normal terminal storage preview later; this Work Item reclaimed
nothing.
