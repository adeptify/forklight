# M4-E Main-offline usage episode — activated delivery

Date: 2026-08-18 (Asia/Shanghai)

## Result

ForkLight can now record a Main job that spans multiple resumed Codex sessions as one auditable,
count-only role sample. Main may end after dispatch, stay offline while Worker and Judges run,
return only when durable evidence changes, and submit every terminal segment once through
`main-token capture-episode`. Parent counters are safe sums of the disjoint segment counters;
status exposes only segment run references and counts and never computes a saving.

Existing single-run samples remain schema version 1. Episode samples use schema version 2 in the
same `main_usage_samples` row shape; no second usage table, delivery entity, lock, lease, checksum,
version handshake or distributed coordination mechanism was added. Pair assessment and value
report continue to consume only the aggregate role counters.

## ForkLight delivery chain

- Accepted Work Item:
  `specs/m4-e-main-efficient-delivery/work-items/main-offline-usage-episode/spec.md`.
- Task `6676be3a-24b4-4bbc-a8c0-7f2a3079e848`, Session
  `bf05caf1-e293-4a71-9fd5-d95f866a188b`, Attempt
  `9b242708-7f08-4f75-9725-fe82a3651232` used Grok 4.6 Xhigh with resolved execution mode
  `native-goal`. One Attempt completed; no validation repair, correction, retry, replacement,
  Competition or third Judge ran.
- Revision `f7c5f5ec-2dce-418e-af21-66c1d8da8587`, digest
  `105d2cd53219ad3c35d37070e570085a324c5bf47ff360c165c022a05845c77e`, changes 14 accepted
  paths and 1,569 lines.
- ForkLight independent verification passed build, 351 focused Core/Store/CLI/Daemon/MCP/
  delivery/pair/value tests and `git diff --check`.
- Review Graph `878ff74e-5642-4078-94bd-4d187cb94c3d` returned two usable `accept` opinions from
  Codex Luna Max Task `c8e8a381-f081-4de1-982e-53ed17b9d73d` and DeepSeek Pro Task
  `9dfdcca6-58ff-4296-9fb9-5f6d68947310`.
- Main inspected the exact diff, legacy normalization, unsafe/duplicate/content-bearing failure
  paths and staged timeout re-entry test, then accepted the exact Revision. Preflight receipt
  `6c6b8ace-7ec8-465c-ac5d-b1b6604d9a54` had no rejection. Integration
  `376f0980-97c4-446f-abd5-0d886ac033e1` passed source apply, source verification, build and
  activation.

## Accepted behavior and safety evidence

- Two to sixteen distinct terminal segments normalize through the existing strict
  `turn.completed` adapter and persist one aggregate role sample. Store reopen preserves the exact
  count-only parent and segment fields.
- Unknown/content-bearing keys, malformed terminal events, duplicate within-episode run refs,
  parent/segment ref collision, unsafe sums, Task identity mismatch and duplicate comparison role
  fail before partial persistence with non-echoing errors.
- Existing schema-version-1 samples remain byte/behavior compatible. Mixed legacy/episode pairs
  preserve the existing M4 quality gates, signed arithmetic and value-report behavior.
- CLI, Daemon and MCP call one Core implementation. The documented `delivery prepare` timeout is
  observation-only; exact re-entry reuses the same Task and Review Graph and never turns a Main
  observation window into a Worker deadline.
- No Hub/UI, routing, Runtime policy, storage deletion, old comparison mutation, credential,
  commit, push or reset change was made.

## Boundary verification and next proof

Post-Integration `npm run check` passed build plus 3,094/3,094 tests. The Daemon was restarted and
matches the client at build
`6a4a99404299e06fc832f010a188cd37d5270d80e68636d1e220dd35f25ec605`, source digest
`adfc0de05eb3a4bc6ee745bbe61489e838c5501f383db13a76cc6f10479e7048`;
`git diff --check` passes.

Grok terminal usage for this implementation Attempt is unavailable, so ForkLight makes no Worker
Token, cost or saving claim from it. This delivery also does not change the earlier valid negative
storage pair. It admits one new, current storage-lifecycle subject that must use staged Main-offline
delivery and episode capture with the same `gpt-5.6-sol / xhigh` profile, equal scope, equal
acceptance and non-lower quality. Hub remains dependency-held until that new result is valid and
strictly positive.
