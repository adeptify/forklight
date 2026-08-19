# M2-C correction-cap decision packet

Recorded: 2026-08-14 (Asia/Shanghai)

## Stop truth

Operational Goal `execution/m2-c/goal.json` is `waiting` with reason code `correction-cap`.
Its implementation gate is not satisfied, no Integration was attempted, and all three downstream
read-only audits remain waiting. ForkLight rejected another correction with:

```text
Goal correction cap reached (1). Main must decide; no replacement work starts.
```

This is the accepted stop path. Main did not bypass the frozen Goal policy, start a second-hop
handoff, edit the source directly, or widen M2-C into locks, hashes, distributed coordination,
backup cleanup, Hub, or unknown/durable deletion.

## Completed and reusable output

- Original Grok 4.6 Xhigh Task: `850b2e03-cc8f-436d-8424-96ea9c48a388`, honestly
  `persistent-session`, no duration/Token/no-progress hard ceiling.
- Durable one-hop handoff: `a138e9be-dec4-4229-a4e2-2a9268b24408` reused all 17 accepted paths and
  created successor `67f255f9-2729-401d-b9c8-2864fca9f189` under `local-grok-builder`.
- Current exact Candidate Revision: `99435c50-1815-414b-9430-df6eef1b619b`, digest prefix
  `237cbfe2403f`, 17 files / 3,332 changed lines.
- ForkLight independent verification passed `npm run build`, 346 focused tests, and
  `git diff --check`. Automated tests used temporary ForkLight Homes only.
- The Candidate already implements the canonical audit/preview/reclaim/retain surface, protection
  and delivery eligibility, pre-delete target/process checks, partial-result truth, Store
  `quick_check`/foreign-key evidence, terminal reviewer reclamation, active Integration Task-id
  protection, and read-only CLI/MCP audit/preview.
- Review Graph `5b0f7506-bdb0-4fef-a954-3ecd228567af` is complete for the exact Candidate. Its two
  usable independent opinions disagree (`accept` x1, `reject` x1); Main confirmed the rejection's
  concrete findings below and recorded `revise`.

## Remaining accepted gaps

The accepted spec now freezes five exact gaps, all inside the original M2-C boundary:

1. All-eligible preview must keep the fresh audit's protected/unknown entries visible while naming
   deletion targets only for reclaimable Tasks; unknown must win the one next action.
2. `workerPid` ownership must be a Task-id set. A duplicated PID is ambiguous, protects every
   implicated Task, and is never signalled.
3. A symlinked physical `runs` or `runs/<taskId>` root must be refused; a configured Home symlink
   alias remains supported only when its physical runs/Task directories are ordinary and contained.
4. Explicit retain must run the same `quick_check`/foreign-key preflight before its Store write and
   write nothing when integrity is bad.
5. Successful retain output must report retained byte breakdown and the prior terminal eligibility
   reason while persisting no raw user note.

## Attempts and evidence

- Original implementation used one Worker Attempt plus one validation-repair Attempt.
- Main returned the first Judge-confirmed safety gaps through the original Task's single correction.
  That Candidate closed the material deletion/process/read-only gaps but verification exposed two
  narrow failures. A supported one-hop handoff reused all 17 paths; the successor fixed both and
  independently passed 346/346 focused tests.
- Two fresh Judges then inspected the exact successor Candidate. One accepted; one found the five
  concrete gaps above. Main verified them against code and updated the accepted spec before trying
  correction.
- The Goal-level correction allowance was already consumed, so ForkLight refused any additional
  correction before a new Attempt or source mutation. This is not a timeout: duration, Token and
  no-progress ceilings remained disabled.

## Workspace disposition

Protect both Task roots, current Candidate Revision, Review Graphs, verification, logs and handoff.
They contain reusable partial output and current decision evidence. Do not reclaim either Workspace,
do not integrate the current Candidate, and do not start the registered post-Integration audits.

## Decision required

Recommended: 一骏 explicitly authorizes one new narrow M2-C implementation Work Item that adopts the
17 reusable paths from Revision `99435c50-1815-414b-9430-df6eef1b619b`, fixes only the five frozen
gaps, keeps `requiredJudges: 2`, uses no duration/Token/no-progress hard ceiling, and retains the same
verification and no-Hub/no-backup/no-unknown-deletion boundary. This is new authority because the
accepted operational Goal has reached its correction cap and the existing handoff is one-hop.

Alternative: stop M2-C and retain the current partial Candidate without Integration. M2 and all
dependent milestones then remain ungraduated.

## Resolution

一骏 explicitly authorized the recommended narrow recovery on 2026-08-14. Main accepted
`specs/m2-c-task-storage-lifecycle/work-items/correction-cap-recovery/spec.md` and the operational
lineage `execution/m2-c-recovery/goal.json`. The old Goal and evidence remain frozen. Recovery uses
the exact Revision patch as digest-bound, read-only Task input in a clean current-source Workspace,
then fixes only the five gaps; it does not authorize a second-hop handoff, Store rewrite, manual
product-source patch, rejected Candidate Integration, backup/unknown deletion, or Hub work.
