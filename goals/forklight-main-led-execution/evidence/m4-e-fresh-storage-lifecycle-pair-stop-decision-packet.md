# M4-E fresh storage-lifecycle pair — stop decision packet

Date: 2026-08-18 (Asia/Shanghai)

## Result

The fresh storage-lifecycle pair is complete, valid and equal quality, but ForkLight used more Main
Token. With the same `codex-main-gpt-5.6-sol-xhigh-v1` profile and byte-identical bounded source,
task, output and acceptance, direct Main used 154,171 gross Tokens and delegated Main used 553,038.
The canonical signed change is -398,867 Tokens (-258.71726848758846%); saving status is `higher`.

This is not an execution failure and is not eligible for a favorable rerun. The accepted Work Item
states that a valid non-positive result stops M4 calibration, keeps Hub dependency-held and leaves
M5 closed.

## Completed output and same-source proof

- Accepted Work Item:
  `specs/m4-e-main-efficient-delivery/work-items/fresh-storage-lifecycle-pair/spec.md`.
- New Task class `m4-fresh-checkpoint-storage-lifecycle`, comparison
  `cmp-m4e-storage-lifecycle-checkpoint-20260818` and output
  `evidence/m4-calibration/forklight-storage-lifecycle-checkpoint.json`; no old M4-D sample,
  assessment or artifact is reused.
- Direct/delegated roots began with byte-identical input, validator and empty output. Both completed
  artifacts have SHA-256 `f2fb64fcf104b162bd9cb2ea5418bb29713ce00fc1922841ff8f22981dfbb9db`;
  the retained source artifact matches those bytes and passes the same validator.
- The decision protects only rejected reusable Task `2d774265-344f-43ea-8f69-79e2624765d3`, marks
  only integration-delivered Tasks `3e2740eb-4c4e-4a55-9a80-86c51c35a5b5` and
  `da6a7615-2b2a-483b-bb1c-3b8a1269e65b` reclaimable, preserves exact byte/process/integrity facts
  and records `reclaimExecuted: false`. No storage deletion or Store mutation occurred.

## Direct Main

- Run `codex-run:01a011b5-2d21-77e1-8529-50314a7b5b93` used `gpt-5.6-sol / xhigh` once.
- Sample `mus-afaed9b7-f6da-4648-8e6d-66326c5775e1` records 19,908 uncached input, 131,584 cache
  read, 2,679 output and zero cache creation: 154,171 gross Tokens.
- Direct reference `dv-m4e-storage-lifecycle-checkpoint-01a011b5`; the validator and diff check
  passed, with exactly one 65-line output.

## Delegated Main and checkpoint-only proof

- Run `codex-run:01a011b6-a653-72e0-ba00-d508b259476a` used the same model/effort once. Sample
  `mus-841c93a5-a9fe-450a-9e70-09f60518e923` records 75,221 uncached input, 473,344 cache read,
  4,473 output and zero cache creation: 553,038 gross Tokens.
- Before the terminal event, Store records exactly two attributed CLI operations, in order:
  `forklight_delivery_prepare` and `forklight_delivery_decide`, both completed. Later inspect and
  Integration-history receipts are Root Main's post-terminal audit. No granular fallback,
  checkpoint re-entry, Task recreation, correction, reverify or replacement occurred.

## ForkLight quality chain

- Task `4709c1b1-e093-4465-bbb0-bbad221b34b7`, Session
  `ef6ae6b0-022b-4c4a-b8ce-820b36fd82ca`, Attempt
  `c71e303f-9131-4a33-9bc5-df7a5a38167a`.
- Grok 4.6 Xhigh native Goal `cfa402ae-a7b4-4f1b-ad60-98bab25d10e8` completed
  `complete / Idle / achieved` in one Worker round.
- Verification `1401` passed the closed validator and diff check. Revision
  `e01f7757-63af-40d7-ac44-bfcac582ea8b`, digest
  `ef10eeb507f74f87a96a55e3f341d0b48cbf4196b8b88cc1516d5bd1f29c065c`, changes exactly one path
  and 65 lines.
- Review Graph `83e7fe54-f2f9-444d-a069-27c107d2ad16` has two usable accepts from Codex Luna Max
  and DeepSeek Pro. Main independently cross-checked the bounded input, inspected the exact diff
  and accepted the Revision.
- Fresh receipt `e4754273-0538-4a37-a724-13f72426977c` had no rejection. Integration
  `faa5f1f6-b651-4c6b-9e98-f8863ac77122` passed source apply and source verification; build and
  activation were correctly not applicable in the isolated evidence project.
- The one Attempt took 1,195,553 ms. Runtime estimate is USD 0.10825362. Canonical Worker usage is
  honestly incomplete and official cost unavailable (`usage-missing`); neither is folded into Main
  Token. There was no repair, correction, reverify, handoff, Competition or third Judge.

## Assessment, remaining gap and disposition

Assessment `mpa-c5b26b85-6853-4882-998b-12db3b04b9a8` accepts same scope, same acceptance and
delegated quality not lower. The pair report is `accepted / higher`; the scoped family value report
is `cannot-determine / not-strictly-positive` and created no work.

Reusable outputs are the retained artifact, both count-only samples, the assessment, Task quality
chain and the positive worker-runtime evidence. The remaining M4 gap is product-level: storage and
Hub families do not both have fresh proven-lower evidence. No attempted remedy is appropriate
because the result is valid and the accepted contract forbids replay or advancing Hub after a
non-positive pair.

Preserve the two comparison roots and Task Workspace until this packet, canonical report and M4
boundary checks are durable. Normal storage preview may later reclaim only regenerable terminal
space; no cleanup is part of this stop. Main's required decision is whether to change M4's product
strategy/exit contract in a future authorized Work Item or leave the Goal paused at this evidence.
M5 cannot start under the current contract.

## M4 boundary verification

`npm run check` passes build plus 3,084/3,084 tests. After the build, the Daemon was restarted and
client/Daemon identity is matched at build
`931e36fc6612e5ea446ab1f47230e3ac31a42025799c744e88c6101f3a569b54` with unchanged source
digest `79c7aa0c9fe3cbc7985e158a3d4fee451e747fd90cb8fce509945abb363589c3`.
The live five-comparison, three-family value report is byte-identical to
`evidence/main-token-pairs.json`: worker-runtime is `proven-lower`; storage and Hub remain
`cannot-determine`. `git diff --check` passes. No Hub/UI process or code was started.
