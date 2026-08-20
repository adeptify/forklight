# M2 Coding and non-Coding delivery graduation

Date reconciled: 2026-08-19 (Asia/Shanghai)

## Result

M2's two required long-running delivery journeys are graduated. Coding and non-Coding were planned
as separate Work Items but executed serially because the non-Coding runbook had to describe the
activated Coding recovery boundary. Both journeys preserve their original stops and partial output;
neither was restarted wholesale to manufacture a clean history.

Current durable Goal reads confirm all three final delivery Goals are `completed` at 4/4:

- `execution/m2-coding-final-audits/goal.json`
- `execution/m2-handoff-execution-truth/goal.json`
- `execution/m2-noncoding-candidate-recovery/goal.json`

The separate terminal-space result is in `m2-storage-lifecycle.md` and
`m2-storage-read-transport-and-final-reclaim.md`; this file closes only the contract's required
Coding/non-Coding delivery evidence artifact.

## Coding journey

The original Coding Goal proved interruption and continuation before reaching its frozen review
cap. A useful four-path Candidate survived the same-Task continuation, one evidence-based
correction and one bounded cross-Worker handoff. Main preserved that lineage and admitted only an
exact-Candidate review recovery.

- Accepted exact Revision: `57b295fc-3c08-4445-a8a5-d615dc6431bd`
- Full Candidate digest prefix: `a862bfe4...054f651`
- Independent acceptance: build, 276 focused tests and diff validation passed
- Review: Codex Luna Max and DeepSeek Flash returned usable exact-Revision accepts
- Main decision: accepted after inspecting the actual four-path diff and rollback/error boundaries
- Safe Integration: `15bd69bc-d5cf-4668-a75a-ab0aa74f2057` passed apply, verification, build,
  activation and matched health

The first post-Integration audit exposed a read-only Runtime admission mismatch rather than a
product regression. Its replacement then stopped at a second environment-contract mismatch. Main
kept both failures immutable, did not replay the Candidate or Integration, and used the explicitly
authorized environment-correct zero-change audit Goal. Its four Tasks
`213ba48f-8286-4146-b899-ad2b4627e7d4`,
`12b90678-ff0a-46d7-b694-c8cb1b8c56d8`,
`aa86c052-1be9-48a9-af6e-39a979a6041c`, and
`88ad747a-fdfb-44e0-826f-95614b610b68` each produced the exact empty Candidate and passed
ForkLight independent verification. The Goal is durably `completed`, 4/4.

## Non-Coding journey

Original Task `fd41a1dc-ca0e-4918-8002-f9932908c35d` was the first meaningful authenticated
`grok-build/xai/grok-4.6/xhigh` documentation delivery in this wave. It honestly used
`persistent-session` at that product stage, with Session
`b1d682d1-f296-4b66-89fe-60081fc45207`. Main restarted the Daemon only after the Worker had a
useful draft. ForkLight then resumed the same Task and Session, independently verified the result,
and used one correction to reduce the runbook from 265 to 132 lines. A MiniMax Judge accepted the
concise Revision.

Main found one real remaining storage-class wording gap and reused all three accepted paths through
the one permitted handoff. The successor fixed that gap but exposed contradictory immutable
destination Runtime truth. Main rejected Integration, preserved both Workspaces and returned only
the shared handoff-admission defect as a new bounded product Work Item.

The destination-truth recovery then completed normally:

- Product Task: `67c403a7-1afb-4758-a0f1-16a58765cc0b`
- Grok 4.6 Xhigh Revision: `e6b017c1-3f24-470c-819d-ae8dab1e588b`
- Full digest: `b279bfcc1e2432421987c9b0e8008eb43d9ff81dd8bbae1b39dc1120e42cbb50`
- Review: Codex Luna Max and DeepSeek Pro accepted from different Runtime views
- Safe Integration: `419aa653-0c57-43a8-9516-a35365c1a9ba`
- Activated check: 2,940/2,940 full tests plus three zero-change audits

Only after those gates passed did the exact documentation recovery materialize the already accepted
three-path bytes:

- Recovery Task: `c25ee8a6-8453-4d33-af4d-e429eb515c36`
- Revision: `dbd23068-0b90-4b19-8eed-624d6d160b23`
- Frozen full digest: `65deb60f3f4c6f5fe3730076e07a29cca52a0fb76019c18daf6a7d817554373a`
- Scope: three documentation paths, 148 changed lines
- Review: one fresh Codex Luna Max exact-Revision accept
- Safe Integration: `05825fa8-3c0b-4865-b6c2-2260717f1b7f` passed all stages
- Audits: Tasks `710135bc-3af5-41da-bc8e-8365c4580f3d`,
  `83ac853d-28bc-401c-a234-aed2f34a494e`, and
  `827ab13b-40ff-469d-be02-2e0c3e3b9e9b` passed with exact empty Candidates

The non-Coding Goal is durably `completed`, 4/4. The original writing, restart and correction work
was not replayed.

## Contract checks

- Coding and non-Coding both include real Worker execution, ForkLight-independent acceptance,
  Judge evidence where the delivery was meaningful, Main review and safe Integration.
- Interruption/recovery truth remains linked to the same original Task lineage; later Goals repair
  only proven review, Runtime-admission or environment-contract gaps.
- Reusable Candidate paths were preserved across stops. No local manual Integration, Store rewrite,
  historical relabel or favorable whole-Task rerun was used.
- Coding/non-Coding ordering reflects their real semantic dependency; no false parallelism or new
  Work Item product entity was introduced.
- Historical failed Attempts and decision packets remain readable. Terminal Workspace disposition,
  reclaim, orphan/process audit and Store integrity are proven separately by the M2 storage evidence.
- No commit, push or reset occurred as part of these journeys.

## Handoff

This evidence, together with `m2-storage-lifecycle.md`, closes M2's delivery and storage graduation
requirements. M3 was entered only after both were complete and 一骏 confirmed the Milestone boundary.
