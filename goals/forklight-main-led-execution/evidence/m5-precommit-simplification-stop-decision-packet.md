# M5 pre-commit simplification — full-suite timing stop

Date: 2026-08-20 (Asia/Shanghai)

## Completed output

- Accepted Work Item: `specs/m5-product-graduation/work-items/precommit-code-simplification/spec.md`.
- ForkLight Task `ed7d44c1-7201-4fc8-a457-87c8fe52e8d4` used Grok 4.6 Xhigh native Goal in one
  isolated Workspace.
- Initial Candidate was Main-revised because it added a larger cross-layer projection abstraction
  and missed three demonstrated redundancies.
- The one authorized correction produced exact Revision
  `f427a0f2-ee74-421e-97ae-09bba47cd267`, digest
  `9cf89e3c153f7a723ff5a435821773dd1855284c0a91b3156a604ae33a3890fc`.
- Final Candidate changes only `src/hub/public/app.js`, `src/hub/public/app.css`, and
  `tests/hub-ui-assets.test.ts`.
- It removes the duplicate Delivery editor open flag, unused Delivery error state, repeated Worker
  selection/save/editor-clear branches, one dead CSS override, one unreachable mobile Back branch,
  and two unproduced Goal-file selector families. Main-only Worker guidance behavior is unchanged.
- ForkLight verification passed build, 127/127 focused cross-layer tests, 357/357 focused Hub tests,
  JavaScript syntax and diff integrity.
- Review Graph `ae7e23bc-5623-45ef-b537-d5e80f704ad7` returned one usable Codex Luna Max `accept`;
  Main then accepted the exact Revision.
- Safe Integration operation `514fecd0-5593-4305-b971-7426fe786723` completed source apply, five
  source-verification commands, build and daemon activation.

## Remaining gap

The required final `npm run check` is not green. It completed 3,181 tests with 3,180 passing and one
failure outside the Work Item paths:

```text
tests/checkpoint-operation.test.ts
checkpoint operation protocol completes end-to-end through bounded daemon waits
start exchange should be short, took 1306ms
expected: < 1000ms
```

A focused second attempt of only that test failed the same assertion at 1,693ms. No current Work
Item production or test path touches checkpoint operation, daemon request timing or this test.

## Attempted remedies and stop reason

1. Ran the full suite once after accepted Integration: stable single failure at 1,306ms.
2. Read the exact test boundary and confirmed no scoped diff. Reran the exact test alone: same
   failure at 1,693ms.

Two purposeful attempts repeated the same failure without new narrowing. Repeating the test,
loosening the threshold, or changing checkpoint/daemon behavior would either be a no-evidence loop
or cross the accepted Spec boundary. The pre-commit Work Item therefore stops before commit/push.

## Reusable paths and workspace disposition

- The accepted three-path source result is already integrated in the shared working tree.
- The ForkLight Task Workspace and Candidate evidence remain protected until final disposition.
- No commit, push, reset or checkpoint-path source change occurred.
- A later investigation must preserve this three-path result and must not replay the Worker,
  correction, Judge or Integration chain.

## Decision required

Recommended: authorize one independent, bounded `checkpoint-operation` timing investigation with
the failing test and daemon/checkpoint call chain as its only scope. It must first identify whether
the 1-second assertion measures a product requirement or a machine-load-sensitive test contract,
then apply the smallest complete fix and rerun `npm run check` before commit/push.

Alternative: explicitly accept committing and pushing with a known, twice-reproduced full-suite
failure. This weakens the current Work Item acceptance and is not Main's recommendation.
