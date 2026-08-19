# M4-E Attempt 1 recovery decision

Date: 2026-08-18 (Asia/Shanghai)

Task `6928dd28-bf5a-413c-9545-59ce96648b99`, Session
`65b1032c-2436-4f1f-87b6-f66874279149`, Attempt
`aa3fb89c-ceed-42a3-b614-42eee0749a16` ran Grok 4.6 Xhigh through the native Goal adapter.
The process exited `0` after 92 turns, but ForkLight recorded `Grok native Goal status is unknown`.
The terminal transcript shows that Grok left a foreground subagent running until the runtime's
internal await budget auto-backgrounded it; the parent turn then ended without a native Goal
terminal state. ForkLight correctly captured no Candidate Revision and ran no verification.

The protected Workspace contains useful bounded output. A baseline-to-Workspace comparison has
exactly 19 changed files, all inside the accepted 20-path set, with 3,389 additions and 5 deletions.
There is no Hub/UI or outside-path change. Main's diagnostic checks in the protected Workspace
passed `npm run build` and the accepted focused suite at 456/456. Per-path diff checking found only
two trailing-space lines in `README.md`; these diagnostic checks are not ForkLight acceptance and
do not turn the failed Attempt into a Candidate.

The Task's accepted policy already reserves one Main correction independently of its zero extra
Attempt budget. Main authorizes that correction to reuse the same Task, Session, Workspace and
implementation. Its exact remaining boundary is: do not spawn a subagent or recreate the work;
remove the two README trailing spaces; inspect the existing result; explicitly bring the native
Goal to a terminal success. The Worker need not bypass its command policy: after Candidate capture,
ForkLight must still run every original acceptance command independently. No model switch,
replacement Task, added path, retry loop, Judge or Integration is authorized by this decision.

If the correction again fails to yield a Candidate or introduces a new product gap, M4-E stops
with the Workspace protected and returns to Main decision. If it yields a Candidate, the unchanged
two-Judge and serial Main Integration gates apply.

## Correction outcome and Main decision

The correction received its ordinal-2 authorization but failed immediately with exit `1`, zero
model turns and the same `Grok native Goal status is unknown`. It changed no file and produced no
Candidate. The same-Task recovery boundary is exhausted.

一骏 previously granted standing authorization to continue subsequent Tasks and prefers Grok CLI
4.6 Xhigh native Goal. Main applies that authority to one new exact protected-partial recovery,
rather than another same-Task Attempt or reimplementation. The source still byte-matches the failed
Task baseline across all 19 retained paths. Main generated a Task-local retained patch, removing
only the two already-proven README trailing spaces; its focused source-base check passes. A
Workspace-local wrapper applies that patch before a fresh Grok Goal starts. The recovery has one
Attempt, zero repair/correction/reverify/adaptation/retry/fallback/further replacement and the
unchanged independent verification, two-Judge and serial Integration gates. Any failure stops.
