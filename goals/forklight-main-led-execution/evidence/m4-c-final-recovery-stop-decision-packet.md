# M4-C final recovery stop decision packet

Date: 2026-08-17 (Asia/Shanghai)

## Result now true

The exact-Candidate recovery did not graduate M4-C. ForkLight Task
`812df915-788c-463c-8ee0-208d71ff9d58` is terminal `failed`; no Review Graph, Main accept or
Integration exists. M4-D remains dependency-held.

This is not evidence of a Grok or Candidate defect. The recovery produced Revision
`debbf06b-a10f-4206-8382-60c1ea450ed4`, digest
`d7327f8c6a0ccd5232b950af4a2ed59143f2c0ef81c846d5287c6305352d92ab`, across the exact ten
authorized paths. Comparing its patch with the retained seed shows only the authorized
`tests/main-token-value-report.test.ts` delta: the brittle source-text scan became a real
Daemon/CLI JSON behavior test. The other nine product/test paths remain seed-equivalent.

## Verification evidence

Attempt `bee38410-b0e7-4aa3-a150-c575dc1d54c8` used fresh Grok 4.6 Xhigh native Goal
`e0b80cbe-018a-45dc-9b5e-fe377a69f176`. Independent verification recorded:

- `npm run build`: passed.
- the complete approved focused suite: 343/343 passed, including the new real CLI flag/remainder
  behavior.
- `git diff --check`: passed.
- bootstrap policy command: failed before the other commands because it tried to apply the
  retained seed a second time after the wrapper had already applied that seed and Grok had made
  the one authorized test delta.

The bootstrap command was valid as a pre-submission clean-source proof and passed there. It is
contradictory as a post-Candidate command: its forward-apply assertion can only pass before the
seed exists. ForkLight records exact failure attribution event `3165` as
`acceptance-contract / non-model`, bound to verification event `3162` and the exact Revision.

## Paths considered and rejected

- The unchanged no-Worker reverify was not consumed because it would deterministically rerun the
  same forward-apply assertion in the same already-seeded Workspace.
- Main acceptance amendment was audited but not used. ForkLight's current amendment remediation
  verifies an isolated copy of current source, not this unintegrated Candidate. Manually applying
  the Candidate to source first would bypass safe Integration and is forbidden.
- No Worker repair, Main correction, adaptation, fallback, model switch or replacement was
  started. No Hub/UI, commit, push or reset occurred.

## Reusable output and Workspace disposition

Both the initial M4-C Candidate and the exact-Candidate recovery remain protected. Reusable output
is the full ten-path Revision above, its passing build/343-test/diff evidence and the exact
test-only delta. Current storage preview classifies the recovery `protected / awaiting-required-review`,
with no unknown bytes, no processes and Store integrity `ok/0`. Nothing is reclaimed while the
M4-C decision remains unresolved.

## Remaining gap and required decision

The only remaining gap is orchestration acceptance: the Task contract used a pre-application
bootstrap check in a post-application verification phase. Product behavior is not integrated and
therefore cannot satisfy M4-C or open M4-D.

The accepted recovery spec explicitly says failure is final and forbids another replacement.
Continuing now requires an explicit scope decision that supersedes that no-replacement boundary;
standing execution authority alone does not silently weaken it. Until then, stop M4-C and preserve
the reusable Candidate.

## Subsequent explicit decision

Later on 2026-08-17, 一骏 explicitly revoked this exact no-replacement boundary and authorized one
acceptance-contract-only replacement. The preserved Candidate and this failure attribution remain
immutable inputs; the new accepted boundary is
`specs/m4-c-family-value-report/work-items/acceptance-contract-only-replacement/spec.md`.
