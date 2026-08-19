# M4-E acceptance-contract recovery decision

Date: 2026-08-18 (Asia/Shanghai)

Recovery Task `7894fcfc-f0d3-4493-b065-28cef14f281a`, Session
`a7a865f7-1e02-4273-a775-b5c9e31a82f5`, Attempt
`338268fc-4a97-431e-b809-d27902e13067` completed native Goal
`f57ff860-d1d3-4f93-8f77-2b6266718a39` as `complete/Idle` with classifier `achieved`. It used no
subagent and captured exact 19-path Revision `bec48c2e-084c-4a0b-be79-5be9729b49dc`, digest
`14091d2f34503f81bda4641a87569236027804d08591fe8746a3a0956564b0fd`.

Independent verification sequence `3510` passed build, all 456 focused tests, exact reverse
applicability of `retained-candidate.diff` and `git diff --check`. One Main-owned operational
command failed: `m4-e-workspace-local-seed-bootstrap.test.mjs` always attempted a forward apply,
although ForkLight correctly ran it after the wrapper had already materialized the Candidate. Its
error says the new files already exist and every changed hunk no longer forward-applies. That is
the expected signature of testing source mode in Candidate phase, not a product defect.

Main recorded exact failure attribution `acceptance-contract / non-model` at event `3513`, bound
to the Attempt, verification sequence, Revision and full digest. The Task has zero reverification
allowance, so ForkLight cannot repair the command in place. No Judge, Main accept or Integration
started. The Candidate Workspace remains protected and reusable.

一骏's standing authorization to continue subsequent Tasks permits one acceptance-contract-only
recovery. The operational test now requires an explicit phase: `--source` checks forward
applicability before admission, and `--candidate` checks reverse applicability after materialization.
The product patch, 19-path set, Grok 4.6 Xhigh native Goal, original build/tests/reverse/diff commands,
two-Judge requirement and Main serial Integration stay unchanged. A fresh Task materializes the same
retained patch; Grok only inspects and terminates without subagents. It has one Attempt and zero
repair, correction, reverify, adaptation, retry, fallback or further replacement. Any failure stops.
