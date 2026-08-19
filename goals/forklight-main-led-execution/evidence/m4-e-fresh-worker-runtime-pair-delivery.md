# M4-E fresh worker-runtime checkpoint pair delivery

Date: 2026-08-18 (Asia/Shanghai)

## Result

The first post-M4-E non-replay pair is valid and strictly positive. With the same
`codex-main-gpt-5.6-sol-xhigh-v1` profile, identical bounded source/task/output/acceptance and
delegated quality not lower, direct Main used 171,984 gross Tokens and delegated Main used 155,804.
ForkLight's canonical pair report records a saving of 16,180 Tokens, or 9.407851893199368%.

This proves the two checkpoint path can reduce Main Token for the fresh `worker-runtime` slice. It
does not yet graduate M4: storage-lifecycle and Hub comprehension still require fresh valid lower
pairs, and their earlier incomplete/negative evidence remains immutable.

## Same-source task

- Work Item:
  `specs/m4-e-main-efficient-delivery/work-items/fresh-worker-runtime-pair/spec.md`.
- New subject: the activated M4-E Task, not the old M3-C2 lineage.
- New Task class `m4-fresh-checkpoint-worker-runtime`, comparison
  `cmp-m4e-worker-runtime-checkpoint-20260818` and output
  `evidence/m4-calibration/worker-runtime-checkpoint.json`.
- Direct/delegated roots began with byte-identical `calibration-input.json`, closed validator and
  empty output. Their completed artifacts are byte-identical; the source evidence file matches the
  delegated integrated bytes and passes the same validator plus `git diff --check`.

## Direct Main

- Run `codex-run:01a0119b-01f5-7261-a84f-1826339aa966` used `gpt-5.6-sol / xhigh` once.
- Sample `mus-b066cb86-d25e-489d-8e66-10115b8fed37` records 52,731 uncached input, 114,432 cache
  read, 4,821 output and zero cache creation: 171,984 gross Tokens.
- Direct reference `dv-m4e-worker-runtime-checkpoint-01a0119b`; the shared validator and diff check
  passed. Only the one 69-line output changed.

## Delegated Main and checkpoint-only proof

One pre-admission sandbox smoke, run `01a0119d-05be-7132-811b-b82f0676c697`, ended before any
ForkLight Task existed because Codex could not access the local control-plane path. Its one native
terminal event is 38,215 gross Tokens and remains disclosed harness cost; it is not a pair sample
and was not combined with another event. The measured run kept `workspace-write`, added only
ForkLight Home plus local control-plane access, and did not make the source project writable.

- Measured run `codex-run:01a011a0-834c-73b1-9abe-0dd34d262ad2` used the same model/effort and one
  complete terminal event.
- Sample `mus-8d5a0754-0457-4d7e-a15c-1e64d24c63f1` records 30,850 uncached input, 122,368 cache
  read, 2,586 output and zero cache creation: 155,804 gross Tokens.
- During the measured run, Store records exactly two attributed CLI boundaries, in order:
  `forklight_delivery_prepare` and `forklight_delivery_decide`, both successful. Four later
  inspect/history receipts were Root Main's post-terminal acceptance audit, not measured Main work.
  No granular fallback, Task recreation, correction or checkpoint re-entry occurred.

## Delegated quality chain

- ForkLight Task `da6a7615-2b2a-483b-bb1c-3b8a1269e65b`, Session
  `54be6252-bbaa-487b-b008-18916390f7a4`, Attempt
  `ea1904da-f623-4894-b8d8-79a12b17998b`.
- Grok 4.6 Xhigh native Goal `349ffe27-8d60-43b5-87fa-45da968189a5` completed
  `complete / Idle / achieved` in one Worker round.
- Verification `1804` passed the closed validator and diff check. Revision
  `1619bc53-a9dd-40c2-87fb-2a623036b713`, digest
  `ebfb4cc7cdc8724681291727f002d2983244601a963a86385b091b88f14a0a5e`, changes exactly one path
  and 69 lines.
- Review Graph `c0ca7bde-39ba-48a2-b9bf-1a0edcf7f8fe` has two usable accepts from Codex Luna Max
  and DeepSeek Pro. Main inspected the exact artifact/diff and accepted the Revision.
- Fresh receipt `df5826bb-8bd8-4c00-bad9-223502a6ecc0` had no rejection. Integration
  `09167633-ff29-4117-80a5-5f4372886760` passed source apply and source verification; artifact build
  and runtime activation were correctly not applicable in the isolated evidence project.
- No Worker validation repair, Main correction/reverification, extra Attempt, handoff, fallback,
  Competition, third Judge or replacement Task occurred. Runtime estimate is USD 0.11442632;
  official usage/cost remains honestly unavailable because Worker terminal usage is missing.

## Pair assessment and next edge

Assessment `mpa-ae1799a1-7958-4c99-8549-3a8f131a0da7` explicitly accepts same scope, same
acceptance and delegated quality not lower. The canonical pair is `accepted / saving`; the scoped
family value report is `proven / proven-lower` and creates no work.

The positive first gate admits the next serial family, fresh `forklight-storage-lifecycle`, through
the same two checkpoint boundary. It does not authorize replay of this pair, Hub/UI work, model
switching or parallel calibration. Comparison roots and ForkLight Workspace remain preserved until
M4 boundary evidence is durable; no reclaim ran.
