# M2 Coding journey — review-cap decision packet

Date: 2026-08-14 (Asia/Shanghai)

## Current truth

The Coding implementation is complete and independently machine-verified, including the intentional
daemon restart journey, one same-Session correction, and one bounded cross-Worker handoff. It is not
accepted or integrated because the operational Goal exhausted its two review rounds without two
usable Judge results on the exact final Candidate. The Goal is durably `waiting` with
`reasonCode: review-cap`; Main has not bypassed the frozen two-Judge gate.

## Completed and reusable output

- Accepted Work Item:
  `specs/m2-delivery-journeys/work-items/coding-source-only-integration-recovery/spec.md`.
- Original implementation Task: `7a23b886-8101-432b-bf2c-68441428e46e`, honest DeepSeek Pro
  `single-run`, Session `4f61dc3b-3848-4383-bc0f-e24f267867f0`.
- Attempt 1 produced a useful source recovery slice, then the confirmed daemon restart interrupted
  it. ForkLight recorded one `system-daemon-restart` authorization and continued Attempt 2 on the
  same Task, Session, Workspace, and source snapshot.
- Attempt 2 produced Revision `a7309534-d7f7-434d-9346-e16c821e7f5a`. ForkLight verification passed
  build, the three approved focused test files, and diff validation.
- Main found broad-I/O-as-absence and missing stage-to-receipt binding gaps. One same-Session
  structured correction reused accepted coordinator/daemon paths and produced Revision
  `93afe5ae-4850-4b47-9a9d-904b7197570b`.
- Main then found one remaining concrete wrong-Integration risk: final-node `lstat` followed a
  symlink ancestor. The correction allowance was exhausted, so ForkLight performed one supported
  Goal-Task handoff `f38fa07e-6d41-41df-84d6-ebd9ad7741c0` rather than rebuilding the Task.
- Successor Task `b5c29d35-e69e-47a0-b2c6-00acd92b8cdb` used the different
  Volcengine/GLM 5.2 Worker, materialized all four verified paths, and changed only the exact
  ancestor-proof seam plus focused tests.
- Final reusable Revision: `ebd14c70-400f-4f99-aab6-adc938e54938`; patch digest
  `a862bfe4abcec99ae32e364ae7df12eb85a30e15d3d65bce67965cbfe054f651`.
- Final paths:
  - `src/core/integration.ts`
  - `src/daemon/coordinator.ts`
  - `tests/integration-operation.test.ts`
  - `tests/integration.test.ts`
- ForkLight independent verification passed:
  - `npm run build`
  - `node --disable-warning=ExperimentalWarning --test --import tsx tests/integration.test.ts tests/integration-operation.test.ts tests/daemon.test.ts` — 276/276
  - `git diff --check`
- The final Candidate proves each relative path component under Candidate, live source, and backup
  roots with `lstat`; only exact `ENOENT` means absent. It refuses symlink ancestors, unreadable or
  non-file paths, wrong Candidate bytes, invalid backup, receipt-mismatched/ambiguous stage history,
  unconsumed receipts, and any build/activation delivery. Tests prove no outside mutation through a
  live-source or backup ancestor symlink.

## Review evidence and exact stop

Review round 1 on Revision `a7309534`:

- MiniMax M3 returned one usable `accept` opinion.
- Codex Luna Max finished but its structured result violated the Judge schema and is unusable.

Main did not accept the one-opinion result; it recorded `revise` for the two proof gaps above.

Review round 2 on corrected Revision `93afe5ae`:

- MiniMax M3 finished with `schema-violation`.
- Volcengine GLM 5.2 finished with `schema-violation`.

After the one-hop successor closed the last code gap, ForkLight refused a fresh Review Graph with:

```text
Goal review cap reached (2). Main must decide; no replacement review starts.
```

This is the accepted Goal safety stop, not a Candidate or Provider execution failure. The exact final
Candidate has zero usable Judge results attached and freezes `requiredJudges: 2`, so Main cannot
truthfully accept or start Integration. The three downstream integrated-source audits remain
`waiting`; the dependent non-Coding journey has not started.

## Attempts and remedies

1. Original Worker self-check plus ForkLight verifier — passed.
2. First two-Judge Review Graph — one usable opinion, one schema failure; Main found real gaps.
3. Same-Session bounded correction — passed independent verification and closed both frozen gaps.
4. Second two-Judge Review Graph — both schema failures; no opinion was counted.
5. One-hop different-Worker handoff — reused all four paths, closed the exact ancestor-symlink gap,
   and passed independent verification.
6. Fresh final-Candidate Review Graph request — refused by the durable two-round Goal cap before any
   new Judge was created.

No source patch, manual Candidate filtering, extra Judge, Integration, commit, push, Store rewrite,
lock, lease, checksum protocol, or expanded build/activation recovery was performed.

## Workspace disposition

The final successor is `protected` for `awaiting-required-review`; product preview reports
`protect-and-wait`, zero deletion targets, zero process, 120,807,930 total bytes, 110,808,380
regenerable bytes, 9,999,550 durable bytes, zero unknown bytes, and Store integrity `ok/0`.
Original/correction/reviewer evidence also remains durable. Nothing is reclaimed while the reviewed
delivery is unresolved.

## Decision required from 一骏

Recommended: explicitly authorize one narrow recovery Work Item that materializes the exact final
Revision/digest into a clean current-source Workspace without changing behavior, independently
re-verifies the three approved commands, freezes `requiredJudges: 2`, and opens one fresh Review
Graph on that exact Candidate. If both Judges are usable, Main may decide and use safe Integration;
if either is unusable or finds a blocker, the recovery stops without another automatic Task.

Alternative: reject the Coding Work Item and later reclaim its regenerable Workspaces while keeping
durable evidence. M2 would remain ungraduated and the dependent non-Coding journey would not start.

