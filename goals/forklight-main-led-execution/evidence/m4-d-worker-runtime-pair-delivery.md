# M4-D2 worker-runtime pair delivery

Date: 2026-08-18 (Asia/Shanghai)

## Delivered evidence

The worker-runtime comparison completed exactly once from byte-identical direct/delegated sources.
Both fixed `gpt-5.6-sol / xhigh` Main runs produced complete native terminal counters. Their output
artifacts are byte-identical and pass the same closed validator. The delegated artifact passed the
full ForkLight quality chain and its exact integrated bytes are now retained at
`evidence/m4-calibration/worker-runtime.json`.

## Direct Main

- Run: `codex-run:01a010b8-bfdc-7163-8d0b-32a188d1cc47`.
- Sample: `mus-4cdfafba-01da-4729-9c5e-006f271179a3`.
- Count-only usage: 16,231 uncached input, 132,352 cache read, 3,688 output, 0 cache creation;
  152,271 gross Tokens.
- Direct reference: `dv-m4d-worker-runtime-01a010b8`; the shared validator and
  `git diff --check` passed in the isolated direct root.
- One workspace-write tool initially rejected the macOS `/var` → `/private/var` alias as outside
  the project. The same Main run completed the one allowed file through an accepted workspace
  write, then passed the unchanged validation. This is not a second run or a scope change.

## Delegated quality chain

- Measured Main run: `codex-run:01a010ba-80be-7151-9ef7-7a6b435ee4b3`.
- ForkLight Task `e4218692-0cac-409b-a998-378374b3553c`, Attempt
  `d5a869b5-dedf-4580-8b81-1c9d68053741`, fresh Grok 4.6 Xhigh native Goal
  `2e15a992-2907-4238-b3f3-64bb4d46e6a8` (`complete / achieved`).
- Revision `2a742c97-abff-4319-9292-475764378fbf`, digest
  `342fd8bf421509b6d178d3540d55f7c7f3b7710e6b02d8c943952dfc03bedf65`, exactly one path and
  64 changed lines.
- Independent verification event `1780` passed the family validator and diff check.
- Review Graph `6d2b0d7b-2de8-4c95-8fe7-4f32fb0005dc` returned two usable accepts from Codex Luna
  Max and DeepSeek Pro. Main accepted the exact Revision.
- Receipt `d693296a-440d-49f4-b9bf-6d5eb6d0af4e` had no rejection. Integration
  `aae1189c-dd73-4c2a-bc3b-c76e42def29c` passed source apply and both source-verification commands;
  build/activation were correctly not applicable in the isolated evidence project.
- No validation repair, Main correction/reverification, handoff, extra Attempt, replacement,
  fallback, Competition or third Judge occurred.

## Pair and value truth

Comparison `cmp-m4d-worker-runtime-20260818` has accepted M4-B assessment
`mpa-417947aa-42ff-4e7d-8619-dec5aa14f0b5`: same scope, same acceptance and delegated quality not
lower are all explicitly true and bind to the real direct verification reference plus current
Integration.

Delegated sample `mus-2c768d0b-1133-4cb4-a015-2e499f421d58` records 84,182 uncached input,
2,305,024 cache read, 11,883 output, 0 cache creation and 2,401,089 gross Tokens. The accepted pair
therefore has signed direct-minus-delegated change `-2,248,818` and canonical percentage
`-1476.8524538487302%`; `saving.status` is `higher`. This is valid negative evidence, not a Main
Token saving.

Canonical family report is `cannot-determine / not-strictly-positive`, with one accepted pair and
zero proven-lower pairs. Worker official Token usage is incomplete, runtime estimate is complete at
USD 0.1067498, official cost is unavailable as `usage:usage-missing`, Attempt elapsed is 403,073 ms,
and all repair/correction/handoff counts are zero. The read-only report created no work.

## Disposition and next edge

Task storage is `reclaimable / integration-delivered`: 19,621,869 regenerable bytes, 771,703 durable
bytes, zero unknown bytes/processes and integrity `ok/0`. No reclaim ran; comparison roots remain
preserved until final M4 disposition.

The accepted pair closes the M4-D2 evidence slot but fails M4's lower-Main-Token exit. It will not
be rerun to improve the number. M4-D3 historical Hub comprehension is the next serial unit; M5
remains closed.
