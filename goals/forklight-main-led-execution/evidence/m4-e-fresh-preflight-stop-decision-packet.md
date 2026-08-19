# M4-E fresh-preflight stop decision packet

Date: 2026-08-18 (Asia/Shanghai)

## What completed

Final acceptance-contract recovery Task `2d774265-344f-43ea-8f69-79e2624765d3`, Session
`b3adc009-fd2f-44cb-ab7a-3bc9727cef94`, Attempt
`1afd4e0a-e4c3-481c-9bd1-71c184ba081c` completed one Grok 4.6 Xhigh native Goal without a
subagent. ForkLight independently passed Candidate-phase wrapper policy, build, all 456 focused
tests, exact retained-Candidate reverse applicability and `git diff --check` at verification
sequence `2986`.

Revision `1910682c-398d-471a-8abd-02f297a5b500`, full digest
`14091d2f34503f81bda4641a87569236027804d08591fe8746a3a0956564b0fd`, contains exactly the
19 accepted paths and 3,392 changed lines. Review Graph
`34d87eee-410c-477c-ac60-44d7fd21f2bb` returned two usable independent `accept` proposals from
Codex Luna Max and DeepSeek Pro. Their agreement is evidence only.

## Main finding

Main's actual-diff review found one untested contract gap in `decideMainDelivery`:

1. The function records the exact Main accept.
2. It then calls `findLatestReceipt` and treats any latest historic preflight receipt as belonging
   to this decide flow.
3. A rejected granular preflight created before Main accept therefore blocks the first valid decide
   call permanently, rather than allowing the contract-required fresh post-accept preflight.
4. Conversely, an unrelated unconsumed receipt can be reused without proving it was created for the
   bound decide call. Exact re-entry should reuse a receipt created after the matching bound Main
   decision, not every latest Task receipt.

The current 456 tests cover a preflight created by the decide call and exact re-entry after that
call. They do not cover an older receipt from the preserved granular workflow. The gap matters
because M4-E explicitly promises one fresh preflight on the first accept, exact durable reuse after
transport loss and backward compatibility with granular commands.

Main therefore recorded an exact `reject` on Revision
`1910682c-398d-471a-8abd-02f297a5b500`. No preflight receipt, Integration operation, source apply,
commit, push or reset exists for this Task. M5 remains closed.

## Reusable output and disposition

- All 19 Candidate paths are reusable; only `src/core/main-delivery.ts` and
  `tests/main-delivery.test.ts` need a focused correction on top of the retained patch.
- The two failed predecessor Workspaces and this verified/rejected Workspace remain protected.
- Product build, schema, prepare behavior, public Daemon/CLI/MCP surfaces, timeout observation,
  privacy bounds and existing focused tests are reusable and must not be rebuilt.
- Both Judge outputs remain truthful evidence for the reviewed Revision, but a corrected Revision
  requires a fresh Review Graph and fresh Main decision.

## Attempted remedies

- Original Task: reusable implementation, but native Goal state became unknown after a Grok
  subagent was auto-backgrounded.
- Same-Task Main correction: failed immediately because that unknown Goal Session was not resumable.
- Exact protected-partial recovery: completed Goal and exact Candidate; one Main-owned acceptance
  script used source mode in Candidate phase.
- Acceptance-contract-only recovery: fixed that script phase and passed the full independent chain;
  Main then found the fresh-preflight product gap during actual-diff review.

These rounds produced materially new evidence rather than repeating one failure, but the accepted
final recovery explicitly allows no further replacement. Main stops here instead of silently
revoking that boundary.

## Decision required

To continue M4-E, 一骏 must explicitly revoke the final recovery's `no further replacement`
boundary and authorize one focused product-correction Task. The recommended boundary is:

- seed the exact retained 19-path Candidate;
- allow product edits only to `src/core/main-delivery.ts` and `tests/main-delivery.test.ts`;
- identify preflight receipts using existing event order/current Store state, with no new entity,
  checksum, lock, lease or version protocol;
- first exact accept always creates a fresh post-accept preflight; exact re-entry reuses only that
  bound receipt/operation; an older granular rejection cannot poison the flow;
- add focused tests for older rejected/unconsumed receipts and unchanged exact re-entry;
- one Grok 4.6 Xhigh native Goal Attempt, ForkLight independent verification, two fresh different-
  view Judges and Main serial safe Integration; failure returns a new stop packet, not another
  automatic replacement.

Without that explicit revocation, M4-E and the Goal remain active but stopped inside M4; M5 cannot
start.
