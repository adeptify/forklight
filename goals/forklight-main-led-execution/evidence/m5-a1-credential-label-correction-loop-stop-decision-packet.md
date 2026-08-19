# M5-A1Q correction-loop stop decision packet

Date: 2026-08-18 (Asia/Shanghai)

## Result now true

ForkLight Task `4f045547-f262-46b6-820f-ea95d19e507a` completed its first Grok 4.6 Xhigh
native-Goal Attempt and captured Revision `78023cfc-9bfa-408d-846a-70784143a390`, digest
`34e4514ef5e27b53ad0d29a28c5eb6b84c89f2b7dbfab075c66d4579eb3d632c`. ForkLight independently
passed build, 413 focused tests and diff validation. The Candidate changed four paths and 1,032
lines.

Main did not accept that Candidate. It contained one Goal evidence handoff file outside the
Worker's allowed product/test paths, and its actual-value detector rejected colon/equal assignment
forms but missed the common CLI form where an option is followed by whitespace and an
eight-or-more-character value.

Main recorded one exact `revise` decision and used the Task's only correction allowance. The
correction retained these three paths:

- `src/core/review-graph.ts`
- `src/core/review-result-repair.ts`
- `tests/review-graph.test.ts`

## Correction evidence

Correction Attempt `ab2ac46b-a7b8-4b18-a56c-6b18b0b05ab3` added the missing whitespace-value
detector and focused negative tests in the protected Workspace. A Main read-only diagnostic after
the stop passed `npm run build` and all 44 `tests/review-graph.test.ts` tests. This is reusable
partial evidence only; ForkLight did not independently verify the correction and captured no new
Candidate Revision.

The Attempt could not remove
`goals/forklight-main-led-execution/evidence/m5-a1-credential-label-judge-repair-handoff.md`.
The Grok Worker toolset exposed read/search/edit/write tools but no file-delete operation, while
Shell/Bash was intentionally denied. The durable log shows the model repeatedly trying the same
unavailable delete and shell paths more than ten times. After two observation rounds produced no
new material evidence, Main applied the accepted no-loop stop rule and terminated only the exact
managed Worker child. The Attempt ended with exit `130`; the Task is terminal `failed`.

## What did not happen

- No correction verification, Candidate Revision or Review Graph was created.
- No implementation Judge ran.
- No Main accept, preflight, Integration, activation or live MiniMax repair ran.
- No source product path, A1 Candidate, Store schema, Hub UI, commit, push or reset changed.
- The original failed assignment and both A1 Candidate Workspaces remain immutable.

## Reusable work and remaining gap

The protected Workspace contains the full three-path product/test partial, including the missing
whitespace-value regression, plus the still-present out-of-scope handoff file. The first verified
Revision remains durable but is not acceptable because it lacks that regression and includes the
handoff path.

The minimum continuation, if explicitly admitted, is one fresh bounded recovery Task whose
accepted contract says the handoff is returned in the Worker response rather than written as a
file. It starts from current source, changes only the same three allowed product/test paths,
implements the already-proven whitespace-value case, and runs the unchanged independent commands,
two different-view Judges and Main serial Integration. It must not reuse the failed Attempt as a
verified Candidate, add a delete capability to the product, rerun A1, change the live MiniMax
assignment or weaken the two-opinion gate.

Until that boundary is explicitly accepted, protect this Workspace and stop M5-A1Q. A2, A3 and
Hub UI remain dependency-held.
