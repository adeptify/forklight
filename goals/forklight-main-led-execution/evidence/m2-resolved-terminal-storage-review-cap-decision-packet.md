# M2 resolved-terminal storage disposition — review-cap decision packet

Recorded: 2026-08-15 Asia/Shanghai

## Stop result

The bounded classifier Candidate is complete and independently verified, but it cannot be
integrated. Two allowed Review Graph rounds each produced only one usable Judge opinion; the other
independent Judge failed the required structured output schema. ForkLight now durably reports the
operational Goal as `waiting/review-cap` with one correction and two review rounds consumed.

No Main accept, Integration, activated-source audit, real-home preview, or reclaim occurred.

## Reusable completed output

- Implementation Task: `71850bde-917a-426c-b92a-164790b1abbd`
- Runtime truth: `grok-build/xai/grok-4.6/xhigh`, `auto -> persistent-session`
- Session: `a901c093-a301-4e6f-8304-fa331cc5dc3d`
- Current exact Revision: `172d6a80-bdd7-487a-9e97-b938a67f10c5`
- Full patch digest: `48a73c6b6db1071fd62f2dfffa3799df81805cdc1e6d4a46cb163bb9ebdafcda`
- Candidate scope: two files, 181 changed lines:
  - `src/core/storage-lifecycle.ts`
  - `tests/storage-lifecycle.test.ts`
- Behavior: a valid terminal Main resolution suppresses only stale Candidate review/Main/
  Integration wait packets after existing mapping, Task, Attempt, verification, review, handoff,
  Integration, and outcome-unknown safety guards. The existing terminal-status and durable latest-
  Revision-artifact proof still gates `main-resolved-terminal` reclaim eligibility.
- Regression evidence: resolved succeeded zero-change Candidate becomes reclaimable; unresolved
  equivalent stays protected; running Attempt and missing Revision artifact remain protected;
  confirmed temporary reclaim removes only known regenerable targets and retains Revision, logs,
  and unknown content.
- Independent verification passed twice on the exact same digest:
  - `npm run build`
  - focused storage/daemon/CLI/MCP suite: 295/295
  - `git diff --check`
- Source remained unchanged and current-source compatibility passed.

The second Attempt was an evidence-only reuse of the same complete Candidate after the first
Judge schema failure. It used the same Task, Session, Workspace, paths and digest; it did not add a
behavior change or widen the contract.

## Review evidence and exact remaining gap

Round 1, Graph `3fdffa7d-bb1f-4c8d-85b1-a57fc20845d2`, Revision
`17d71b8c-1c26-4e1a-bf1d-a0227ecd51e6`:

- Codex Luna Max Task `77afe388-32bd-4db5-8d6c-9ca701977e7c`: usable `accept`, no findings.
- DeepSeek Pro Task `d86017b3-1b47-4a2f-ade3-d4c5d47fe92a`: unusable
  `schema-violation`.

Round 2, Graph `7c6a032e-9cc5-4d75-adb9-f77d9293a366`, current Revision
`172d6a80-bdd7-487a-9e97-b938a67f10c5`:

- Codex Luna Max Task `a52fe3e3-ea8a-4e65-951d-e90da96508a2`: usable `accept`; one
  non-blocking advisory budget warning, while the Candidate remains within its accepted 2-file /
  220-line Work Item budget.
- MiniMax M3 Task `431719d5-5f77-4647-9ec7-232455e3ac16`: unusable
  `schema-violation`.

Exact remaining gap: the immutable `requiredJudges: 2` Integration gate needs two usable
independent opinions bound to one exact current Revision. Current graph has only one. Main cannot
reinterpret malformed output, combine opinions across Revision ids, lower the requirement, or
bypass Integration preflight.

The repeated failure is review-output admission, not Candidate behavior, verification,
source compatibility, Provider authentication, or Integration.

## Attempts and stop rule

Completed purposeful rounds:

1. Initial Grok implementation and independent verification, then Codex + DeepSeek review.
2. Same-Task/same-Session exact Candidate evidence refresh and independent verification, then
   Codex + MiniMax review.

Both rounds produced the same material blocker: one usable accept plus one Judge schema violation.
The Goal has consumed its frozen `maxCorrectionRounds: 1` and `maxReviewRounds: 2`. A third review
request was refused before any assignment with:

```text
Goal review cap reached (2). Main must decide; no replacement review starts.
```

Continuing automatically would violate the accepted stop rule and the project rule against adding
Judges, recreating Tasks, switching models, or widening scope after repeated no-new-evidence
failure.

## Workspace disposition

- Protect the complete implementation Workspace, both Revision artifacts, both Review Graphs,
  Judge Tasks, verifier output, diff and logs as `protect-review` evidence.
- The three downstream audit Tasks remain waiting and have not run.
- The six original resolved audit Tasks remain protected; no reclaim was attempted.
- Store quick-check/orphan/process evidence from preflight remains valid, but final M2 storage and
  boundary evidence is not complete.

## Decision required from Main / 一骏

Recommended bounded recovery, requiring explicit authorization:

- create one new exact-Candidate review-cap recovery Work Item;
- materialize the frozen full-digest two-path patch unchanged into a correctly admitted Task on
  current source, independently reverify it, and open one fresh two-Judge graph using two current
  different-view healthy Profiles;
- freeze zero corrections and one review round; any unusable or blocking opinion stops without
  replacement, extra Judge, automatic model switch, or Integration;
- only after two usable opinions and Main accept, use safe Integration, run the existing three
  audits, then preview/reclaim only the six exact original Tasks.

Rejected alternatives:

- lower `requiredJudges` to one or count a malformed result;
- combine the two Codex opinions across different Revision ids;
- integrate the Candidate manually or bypass ForkLight preflight;
- add an automatic Judge retry/replacement system inside this Work Item;
- modify Store history, reopen M3/Hub, or broaden storage behavior.
