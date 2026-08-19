# M5-A1Q fresh-recovery Main-review stop

Date: 2026-08-18 (Asia/Shanghai)

## Verified Candidate

Authorized Task `96d11188-a4c2-4901-9caa-7300487ed125`, Session
`7440e381-059b-4a00-a5f0-ee8d81c9fb9c`, Attempt
`007570ee-3f03-408f-bbe4-cef3da986e1f` completed one Grok 4.6 Xhigh native Goal from current
source. It used no correction, validation repair, retry, adaptation or fallback.

ForkLight captured Revision `d911b924-3c78-4ca1-bb28-7b2c58c04b15`, full digest
`3bdb6e6188f8bff913c853365d57ded7fe3d335cbdc8fb742a2e8baedfb3b2df`, changing exactly:

- `src/core/review-graph.ts`
- `src/core/review-result-repair.ts`
- `tests/review-graph.test.ts`

Build, all 411 accepted focused tests and diff validation passed independently at verification
sequence `2988`. Source compatibility passed and no handoff/evidence/documentation path entered the
Candidate.

## Main rejection

Main rejects the exact Revision before creating Judges. The accepted Spec requires a repaired
opinion to change `summary` while keeping schemaVersion, Revision, disposition and findings equal.
The Candidate's `sameOpinionExceptSummary` intentionally ignores summary, and reconcile marks the
repair succeeded whenever that helper passes. There is no additional equality check proving
`repaired.summary !== original.summary`.

Therefore a same-Judge repair that returns the exact original summary is incorrectly counted as a
successful usable opinion. Existing tests cover disposition, finding and Revision drift but do not
cover unchanged summary. This is an authority-bearing acceptance defect, not a non-blocking edge.

Main recorded durable `reject` against Revision `d911b924-3c78-4ca1-bb28-7b2c58c04b15` and digest
`3bdb6e6188f8bff913c853365d57ded7fe3d335cbdc8fb742a2e8baedfb3b2df`.

## What did not happen

- No implementation Review Graph or Judge Task was created.
- No Main accept, Integration preflight/apply, activation or full-suite boundary check ran.
- The live MiniMax assignment and A1 Candidate were not repaired, rerun or changed.
- No source Integration, Hub UI, A2/A3, commit, push, reset or reclaim occurred.

## Reusable result and decision boundary

The verified three-path Candidate remains protected and reusable. The remaining product gap is
one reconcile guard plus a focused unchanged-summary regression in the same two writable
implementation/test paths; no schema, public operation, Store or policy change is needed.

The authorized fresh recovery explicitly froze zero correction and no further replacement, so Main
does not patch, reverify, add Judges or create another Task automatically. If 一骏 explicitly
supersedes that boundary, the minimum continuation is one exact-Candidate recovery that changes
only the reconcile guard and focused regression, independently reruns the unchanged commands, then
uses two different-view Judges and Main serial Integration. Failure stops again and the protected
Revision remains evidence.
