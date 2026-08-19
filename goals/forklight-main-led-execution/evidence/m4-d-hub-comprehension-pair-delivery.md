# M4-D3 historical Hub comprehension pair delivery

Date: 2026-08-18 (Asia/Shanghai)

## Delivered evidence

The final M4-D calibration ran exactly once. Direct and delegated `gpt-5.6-sol / xhigh` Main used
the same source, task text, input, relative output and validator. Their artifacts are byte-identical
and the delegated exact bytes are retained at `evidence/m4-calibration/hub-product-comprehension.json`.
It contains six future-M5 requirements from accepted historical Hub-labelled contracts, preserves
the historical `cannot-determine / score-gap-too-small` result and explicitly records no Hub
mutation or M5 implementation.

## No-Hub-mutation proof

Preflight found a pre-existing unrelated Hub owner at PID 52551, port 62182, state
`different-build`. Direct completion, delegated Integration completion and final Main observation
all report the same PID, port and state. Neither measured Main, Grok Worker, Judge nor Integration
started, stopped, restarted, replaced, opened or modified Hub/UI. No Hub product path was in either
Candidate.

## Direct Main

- Run `codex-run:01a010c9-4275-7212-ad59-5bcfc307d0e0`.
- Sample `mus-0786eabc-37bf-4bf2-9f1c-96f1044a0e13`: 16,883 uncached input, 100,096 cache read,
  2,223 output, 0 cache creation, 119,202 gross Tokens.
- Reference `dv-m4d-hub-comprehension-01a010c9`; the shared validator and diff check passed with
  exactly one output path and no ForkLight/Hub action.

## Delegated quality chain

- Measured Main run `codex-run:01a010ca-8085-7fe0-a93c-13a7cd3cc668` experienced one transparent
  OpenAI stream reconnect inside the same turn; it did not recreate or replay ForkLight work.
- ForkLight Task `db2caa85-e8e7-4fcd-aaf8-6dc84ca4660b`, Attempt
  `e503bd9c-7a4f-48e5-bedc-b5d296bf4af9`, fresh Grok 4.6 Xhigh native Goal
  `156e3c3e-9f7e-40fc-b088-bd68bdf56681` (`complete / Idle / achieved`, one Worker round).
- Revision `bacb156c-38d1-430c-a70e-bb191309ff55`, digest
  `a6d7c68412715005ed5ce70f87f60c65b3270b39da068f441dccfffecb7122fc`, exactly one path and
  49 changed lines. Independent verification `1311` passed both commands.
- Review Graph `22fb17ee-f6b1-41d5-93d5-61d15ba72a84` returned two usable accepts from Codex Luna
  Max and DeepSeek Pro. Main accepted the exact Revision.
- Receipt `a46faed4-424c-456a-a834-3088d1f0fb71` had no rejection. Integration
  `e4208850-e99b-4467-b673-82a3c35a8ab6` passed apply and both source-verification commands;
  build/activation were correctly not applicable.
- No repair, correction, reverify, handoff, extra Attempt, replacement, fallback, Competition or
  third Judge occurred.

## Pair and value truth

Assessment `mpa-5bda4279-7e59-4676-a01e-08f889f7363d` accepts the same-scope,
same-acceptance and non-lower-quality gates for comparison
`cmp-m4d-hub-product-comprehension-20260818`.

Delegated sample `mus-55ae7497-bde1-4572-8e0a-2ff11bb36af0` records 90,551 uncached input,
2,027,008 cache read, 11,317 output, 0 cache creation and 2,128,876 gross Tokens. Signed
direct-minus-delegated change is `-2,009,674`, canonical percentage is
`-1685.9398332242747%`, and `saving.status` is `higher`. The family report is therefore
`cannot-determine / not-strictly-positive` with one accepted pair and zero proven-lower pairs.

Worker official Token usage is incomplete; runtime estimate is complete at USD 0.10320224;
official cost is unavailable as `usage:usage-missing`; Attempt elapsed is 431,976 ms; all
repair/correction/handoff counts are zero. No work was created by the report.

## Disposition

Task storage is `reclaimable / integration-delivered`: 19,522,736 regenerable bytes, 746,397
durable bytes, zero unknown bytes/processes and integrity `ok/0`. No reclaim ran.

M4-D3 is complete and will not be replayed. Its valid pair does not satisfy lower-Main-Token.
Together with D1 incomplete review evidence and D2 valid-negative evidence, M4 fails its exit and
must stop before M5 for Main/user contract decision.
