# M5-A1Q final exact-Candidate Judge stop decision packet

Date: 2026-08-18 (Asia/Shanghai)

## Result now true

The final authorized implementation Task succeeded and produced the complete accepted three-path
quality-chain Candidate. Main's scoped diff review found no remaining Candidate defect. ForkLight
independently passed build, 412 focused tests and diff validation.

Delivery nevertheless stops before Integration. The frozen two-Judge graph retained one usable
`accept`; the second terminal Judge result was rejected as `unsafe-content`. The hard requirement
is therefore one usable opinion short. Main recorded `reject` because Judges cannot be replaced or
outvoted under this Task's final contract.

## Completed and reusable output

- Task: `87397909-9163-4a74-b0f5-f0b12b667854`
- Grok native Goal Session: `e3be21f2-99a8-4821-bd7a-5adb4563aeab`
- Attempt: `05ba6a3c-366a-4c41-8462-a5e138998fdb`
- Candidate Revision: `364f98ae-741b-452e-b5d1-5bc8100c69d1`
- Candidate digest:
  `99cc6bb9d1c5c952494440e068109b61b5c5495c9565103488588af8e58d1a84`
- Exact paths:
  - `src/core/review-graph.ts`
  - `src/core/review-result-repair.ts`
  - `tests/review-graph.test.ts`

Relative to the previously verified seed, the final Candidate adds only:

1. a direct equality guard that makes an unchanged repaired summary fail as `semantic-drift`; and
2. one focused regression proving the no-op result remains unusable and consumes the one-shot.

`src/core/review-result-repair.ts` is byte-unchanged from the verified seed. The complete Candidate
preserves the label-versus-value parser, narrow historical eligibility, frozen Judge identity,
original evidence, opinion-field equality, restart behavior and fresh-Main Integration gate.

## Verification evidence

- `npm run build` — passed.
- `node --disable-warning=ExperimentalWarning --test --import tsx tests/review-graph.test.ts tests/daemon.test.ts tests/daemon-cli.test.ts tests/mcp.test.ts tests/integration.test.ts`
  — 412 passed, 0 failed.
- `git diff --check` — passed.
- ForkLight quality — 100 before admission.
- Workspace boundary — `clear`.
- Task execution — one Grok 4.6 Xhigh `native-goal` Attempt, no correction, validation repair,
  reverify, adaptation, retry or fallback.
- Source project — unchanged; no preflight, apply, activation, commit, push or reset ran.

## Review evidence

- Review Graph: `0a0e55b5-58cb-4186-ac53-dc85ed1e17b7`
- Codex Judge assignment `09763961-5898-4136-9f89-8fa72326392f` — usable `accept`, no findings.
- Volcengine Judge assignment `fb5c4ffe-4dfc-48cf-87d8-e669ed3e5ea0` — terminal
  `unsafe-content`, unusable.
- Aggregation — `single-opinion`, usable 1/2, Integration blocked.
- Main decision event sequence `2269` — `reject`, bound to Revision `364f98ae...`.

This is insufficient independent evidence, not a newly identified Candidate behavior defect.

## Attempts and stop boundary

The Work Item already reused the verified prior Candidate and fixed the one known Main-review gap.
It then used exactly the two authorized different-view Judges. No third Judge, Judge replacement,
same-Judge repair, Candidate rerun, correction, reverify, fallback or Integration was attempted.

The accepted final contract gives zero further replacement or recovery authority. Continuing would
therefore exceed the Spec even though the Candidate remains reusable.

## Workspace disposition

Protect the full Task Workspace and exact Revision. Candidate, verification and Judge evidence are
durable. Do not reclaim or manually apply its files.

## Decision required from 一骏

M5-A1Q, M5-A1/A2/A3 and Hub remain stopped. Any continuation requires a new explicit decision that
supersedes this final no-replacement boundary and states which evidence path is allowed. Main must
not infer permission from the standing authorization for ordinary later Tasks.

## Read-only private-result clarification

The follow-up read-only audit proves the unusable Volcengine result is not another bare-label false
positive. Its structured opinion proposed `accept` with four informational findings and no requested
Candidate change, but one finding copied two value-shaped test examples. Both the current parser and
the accepted Candidate correctly return `unsafe-content`; the Candidate's summary-only repair is
ineligible because the unsafe shapes are in a finding.

Therefore activation would not repair this assignment. A bootstrap exception, if explicitly
chosen, must be recorded honestly as a one-Judge delivery exception for the exact Candidate; it
cannot claim that the missing second opinion will become usable later. Exact audit:
`m5-a1q-final-judge-private-safety-audit.md`.
