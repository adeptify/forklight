# ForkLight Main Token Leverage — Plan

This file is the executable roadmap for the confirmed Goal in [contract.md](./contract.md).
It records only the current plan. Machine events remain in ForkLight Store; historical detail
belongs in Git or [evidence/](./evidence/), not in a parallel diary.

## Completion rule

ForkLight is complete only when M1–M5 are all verified. Existing capabilities are reused and
tested; they are not rebuilt merely to earn a milestone label.

## Start-up consolidation — completed (not a product milestone)

Purpose: establish a safe, truthful starting point before product work.

- Decide whether the current FL-116B Candidate is useful under the new Goal; accept or discard it once.
- Capture Git, Store, build, Daemon and CLI/API truth without changing source.
- Create and verify one complete Store/runs backup.
- Produce and review a dry-run classification of historical Tasks, then apply the approved cleanup:
  - retain fair routing evidence, valid Main-Token paired evidence and referential closure;
  - create two verified backups before deletion; after separate approval, compact them to one
    verified pre-cleanup database-only audit artifact instead of retaining old Worker workspaces;
  - close retained but actionless historical attention without changing evidence-bearing status.
- Mark the new Goal directory as the only project-management entry point.
- Map old project documents to keep, merge or remove; do not build an archive system.

Exit: passed. Exact baseline, the verified backup/compaction history, applied retention report,
Candidate decision and selected M1 work are recorded in [progress.md](./progress.md) and
[evidence/](./evidence/).

## M1 — Context-rich work contracts and complete CLI/API — graduated

User result: Main can turn an outcome plus relevant background into executable Goal → Plan →
Task work for Coding and non-Coding Workers.

Required capabilities:

- Context first: why, user/audience, current situation, parent Goal/Plan, prior decisions,
  inputs, output use, authority, boundaries, quality bar and acceptance.
- Domain-neutral core with optional Coding-specific fields.
- CLI/API create, preview, validate, submit, inspect and continue Goal/Plan/Task.
- Relevant-context selection rather than full-conversation dumping.
- One real Coding and one real non-Coding contract flow.

Exit: both flows work without Hub or database edits, contract tests pass, and Worker-visible
context matches what Main approved.

Result: passed on 2026-08-09. One Coding and one non-Coding ForkLight journey passed, the final
exit audit found no blocker, `npm run check` passed 2,847/2,847 tests, CLI/API boundary checks
passed, and CLI/Daemon build identities match. See [progress.md](./progress.md).

## M2 — Persistent high-quality Worker delivery

User result: a Worker owns research, implementation, validation and bounded correction until
it delivers or reaches a real decision boundary.

Required capabilities:

- Truthful Runtime strategy selection: native Goal when real; otherwise persistent session,
  continuation, phased Tasks or another explicit strategy.
- Dependencies, restart recovery, checkpoints and retained partial output.
- Worker self-check, independent verification, optional judge Workers, one finite repair,
  exact handoff and safe Integration.
- Main receives a decision packet rather than raw execution noise.

Exit: representative long-running Coding and non-Coding work survives interruption and reaches
reviewed delivery without Main taking over ordinary execution.

## M3 — Evidence-driven intelligent delegation

User result: Main receives an understandable recommendation for Worker, model, effort and
execution strategy.

Required capabilities:

- Fair task-family evidence and exact failure attribution.
- Routing advice with confidence and manual override.
- Competition and judge Workers only when uncertainty or value justifies the cost.
- Model capability history learns from real delivery, not manufactured reruns.

Exit: at least three representative task families have reviewable routing evidence; missing
evidence remains “cannot determine”.

## M4 — Proven Main Token leverage

User result: ForkLight shows whether delegation saved Main Token without hiding quality,
Worker Token, money or time.

Required capabilities:

- Capture Main orchestration/review usage and comparable direct-Main usage.
- Pair only same-scope, same-acceptance work.
- Quality is a hard gate; invalid pairs never produce a saving claim.
- Report absolute and percentage Main Token change plus Worker Token, cost, time, corrections
  and confidence.
- Natural evidence or explicitly approved calibration only; never replay work just for stats.

Exit: every graduated representative task family has a valid pair, delegated Main Token is
lower without worse quality, and all claims trace to evidence.

## M5 — Product graduation and final Hub

User result: another developer can clone ForkLight and complete real delegated work.

Order:

1. CLI/API clean-clone graduation, setup, diagnostics, backup/recovery and documentation.
2. Only then use Impeccable in Operate mode to design the complete Hub once.
3. The Hub exposes every graduated capability in plain language without changing API truth.
4. Run desktop/mobile bounded visual review and a clean-user journey.

Exit: an unfamiliar developer clones the repository and completes configuration, a real Task,
Main review and safe Integration within 30 minutes without database inspection or manual
configuration-file edits.

## Iteration rules

- Choose the smallest end-to-end slice that closes the current milestone gap.
- Reuse current capabilities. Do not prebuild abstractions for hypothetical future domains.
- Main may plan and decompose deeply; Workers own ordinary execution.
- One automatic Worker repair and one Main correction are the default ceiling.
- Focused checks run inside a Task. The full suite runs once at Candidate Integration or a
  milestone boundary unless source changes invalidate that evidence.
- Non-blocking findings go to the current milestone backlog; they do not expand the active Task.
- Stop as soon as acceptance passes.
- Work may continue automatically inside an approved milestone. Crossing a milestone waits
  for 一骏 to review the user-visible result.
