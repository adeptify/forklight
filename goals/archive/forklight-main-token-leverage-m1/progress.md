# ForkLight Main Token Leverage — Progress

Last reconciled: 2026-08-14 (Asia/Shanghai)

## Goal state

- Status: active
- Current phase: M1 milestone boundary — graduated and waiting for 一骏 before M2
- Product milestones complete: 1/5
- Blocked: no
- Main Token saving claim: not available yet; valid paired evidence is an M4 exit requirement

## User-visible result

Main can now use CLI/API to turn an outcome plus relevant background into Task, Plan or Goal work,
validate it before submission, inspect and continue it, and read Goal → Plan → Task hierarchy. The
same context-first contract works for Coding and non-Coding work. Hub is not required and was not
used as an M1 acceptance surface.

## Current machine truth

- Branch: `main`.
- Worktree: heavily modified with pre-existing and current ForkLight work; do not reset, overwrite,
  commit or push without separate approval.
- Live Store: 293 Tasks, 431 Attempts, 213,300 Events, 0 Goals, 0 Plans, 0 outcome intakes,
  41 review graphs, 1 Competition, 2 paired samples and 160 Integration results.
- Store integrity: SQLite `quick_check` is `ok`; foreign-key violations: 0.
- Current attention: `waiting-user-decision` is empty. The 89 retained historical succeeded Tasks
  were moved to History without changing their machine status or deleting evidence.
- Daemon: running with the same build identity as CLI; `doctor` reports ready to execute.
- Boundary verification: `npm install` passed; `npm run check` passed 2,847/2,847 tests; CLI
  `doctor`, `health`, `goal list`, `board` and `stats` all exited successfully.
- Dependency note: install reported 3 audit findings (1 moderate, 2 high). No automatic dependency
  rewrite was attempted; dependency/security hardening remains an M5 product-graduation item.

## M1 completed

- Version-3 context-first Task contracts expose business/user background, parent work, prior
  decisions, inputs, output use, authority, boundaries, quality and acceptance without dumping the
  whole conversation.
- The same v3 Task can be used standalone or inside Plan, Goal and outcome-intake flows.
- CLI/API covers create, preview, validate, submit, inspect and continue for the M1 workflow,
  including `validate-goal`, `outcome`, `work-hierarchy` and `task-plan-context` surfaces.
- One real Coding and one real non-Coding delegation completed through ForkLight and passed review.
- Historical Store cleanup was backed up, applied and integrity-checked. Evidence needed for
  routing or future Main-Token comparison remains live. After separate approval on 2026-08-14,
  the redundant baseline snapshot and old Worker workspaces were removed; one verified 421 MB
  pre-cleanup SQLite database remains for historical audit. Available disk space increased by
  about 88.8 GiB; deleted workspace files are not recoverable from ForkLight backups.
- A final Worker exit audit found no M1 blocker, and Main completed the full boundary suite and CLI
  checks.

## Now

Stop at the M1 boundary. Do not start Hub work and do not open M2 automatically.

## Next

After 一骏 confirms the boundary result, start M2 — persistent high-quality Worker delivery. The
first M2 slice should audit the existing Runtime Goal/continuation, validation repair, judge,
partial-reuse and safe Integration chain, then implement only the smallest real missing closure.

## Evidence

- [M1 exit audit](./evidence/m1-cli-api-gap-audit.md)
- [Coding delegation run](./evidence/coding-delegation-run.md)
- [Non-Coding delegation run](./evidence/noncoding-delegation-run.md)
- [Applied historical data cleanup](./evidence/data-retention-report.json)
- [Start-up baseline](./evidence/startup-baseline.md)

Raw execution events remain in ForkLight Store.
