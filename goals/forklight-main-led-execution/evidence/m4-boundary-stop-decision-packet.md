# M4 boundary stop decision packet

Date: 2026-08-18 (Asia/Shanghai)

## Outcome

M4-A, M4-B and M4-C are graduated, and all three authorized M4-D calibration units have reached
their terminal disposition. ForkLight now truthfully captures complete Main usage, admits only
same-scope/same-acceptance/non-lower-quality pairs, and reports Main Token beside Worker cost and
delivery evidence. The M4 product path works, but the milestone exit is not met: no representative
family proves lower delegated Main Token.

Main therefore stops at the M4 boundary. It does not replay calibration, add or replace Judges,
switch models, weaken quality, enter M5, or claim saving.

## Canonical comparison truth

| Family | Direct Main gross Tokens | Delegated Main gross Tokens | Pair truth |
| --- | ---: | ---: | --- |
| `forklight-storage-lifecycle` | 103,834 | 1,575,847 | `cannot-determine / incomplete-evidence`; one of two Judge results was schema-invalid, so Main rejected before Integration |
| `worker-runtime` | 152,271 | 2,401,089 | accepted same-scope/same-acceptance/non-lower-quality pair; delegated Main is 2,248,818 higher |
| `hub-product-comprehension` | 119,202 | 2,128,876 | accepted same-scope/same-acceptance/non-lower-quality pair; delegated Main is 2,009,674 higher |

The exact canonical report is `evidence/main-token-pairs.json`. Its overall result is
`cannot-determine` with reasons `incomplete-evidence` and `not-strictly-positive`; zero pair
contributes proven-lower Main Token and the report creates no work.

## What the evidence means

The two valid pairs prove that delegated quality was not lower and that the delivery chain reached
safe Integration. They also prove that, for these bounded tasks, the measured Codex Main consumed
substantially more gross Token through ForkLight than by doing the work directly.

The terminal counters show where the measured difference accumulated: delegated cache-read Token
was 2,305,024 for worker-runtime and 2,027,008 for Hub comprehension, versus 132,352 and 100,096 on
their direct sides. Together with the long Worker → verification → dual-Judge → Main decision →
Integration supervision chain, this supports a focused diagnosis: current Main observation and
resume turns repeatedly reload too much context. This is an inference from count-only terminal and
orchestration evidence; private Codex history was not read, so the packet does not claim a more
specific unproven internal cause.

The D1 review-schema failure is separate. Its Candidate and independent verification passed, but
the existing summary-only Judge repair cannot rewrite an unsupported finding severity. Under the
accepted one-run stop rule, that incomplete pair remains visible and is not repaired or hidden.

## Boundary verification

- `npm run check`: build passed; 3,061/3,061 tests passed.
- Daemon restart succeeded; `forklight health --json` reports `identityStatus: matched`, build
  `c454d89405f059a2fd680b2cc5a10bb94c5c419fa4dbc72847e5ada643bdffa1` and source digest
  `00c675fefa1e6132acd63cf71cb2805cacdb8844acb4bcf5e57e925b133479a5` on both client and Daemon.
- Fresh canonical `value-report` output is byte-identical to `evidence/main-token-pairs.json`.
- `git diff --check` passed.
- The pre-existing Hub remains PID 52551, port 62182, state `different-build`; M4 did not start,
  stop, restart, open or modify Hub/UI.

## Reusable output and storage disposition

- D1 Task `ae76df01-44f7-4477-8c31-6e0c4f11d138` remains
  `protected / awaiting-required-review`, with 19,559,159 regenerable bytes, zero unknown bytes,
  no process and Store integrity `ok/0`.
- D2 Task `e4218692-0cac-409b-a998-378374b3553c` is
  `reclaimable / integration-delivered`, with 19,621,869 regenerable bytes and 771,703 durable
  bytes; zero unknown bytes, no process and integrity `ok/0`.
- D3 Task `db2caa85-e8e7-4fcd-aaf8-6dc84ca4660b` is
  `reclaimable / integration-delivered`, with 19,522,736 regenerable bytes and 746,397 durable
  bytes; zero unknown bytes, no process and integrity `ok/0`.
- No reclaim ran. Direct comparison copies and ForkLight Workspaces stay available until 一骏
  decides the M4 disposition.
- Integrated compact artifacts remain at `evidence/m4-calibration/worker-runtime.json` and
  `evidence/m4-calibration/hub-product-comprehension.json`; D1's decision packet preserves its
  reusable exact Candidate lineage.

## Decision required from 一骏

Recommended: keep M5 closed and explicitly authorize a new focused M4 recovery Work Item whose
user result is lower-overhead Main observation/resume. It should reduce repeated context loading
across durable ForkLight state transitions, preserve the existing quality chain, and define fresh
non-replay evidence before implementation. This requires revising the accepted M4 plan/spec first;
it is not silently inferred from the current calibration authority.

The alternative is to keep the current M4 exit unchanged and stop the Goal here. Graduating M4 by
relabeling these negative measurements as saving, or entering M5 while the exit is unmet, is not an
allowed disposition.
