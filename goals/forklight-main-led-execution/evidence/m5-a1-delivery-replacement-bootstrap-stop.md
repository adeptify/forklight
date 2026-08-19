# M5-A1 delivery replacement bootstrap stop

Date: 2026-08-18 (Asia/Shanghai)

## Outcome

Delivery replacement Task `fbecf3af-9d43-434f-b8fe-422462daacbe` stopped before Grok received
the native Goal. ForkLight prepared the isolated Workspace, then macOS rejected the Task wrapper
with `Permission denied`. The Attempt exited `71` with zero model turns, no Token evidence, no
Candidate, no independent verification and no Judge assignment.

## Exact cause

The new Task-local wrapper
`goals/forklight-main-led-execution/execution/m5-wave-1/m5-a1-accepted-candidate-bootstrap.mjs`
has mode `0644`; ForkLight launches the configured Runtime executable directly and therefore needs
the executable bit. The prior working wrapper has mode `0755`. The new wrapper content, policy
test, exact 16-path seed and source apply check all passed before submission, but the preflight did
not test filesystem execute permission.

The Task Workspace has no accepted-Candidate marker, proving the wrapper never started and the seed
was not applied. Source product paths were not changed by this Task.

## Reusable result

The complete accepted Candidate remains Revision
`56181554-d009-436b-96a9-1208ea236e87`, digest
`dd4f30324cb460ff4d82657008e23ac2bfbf00c3ee7a6247438ff8fd93ca7299`, in protected Task
`088d5506-0b79-4de9-bd6d-e230b115b245`. Its build, 121 focused tests, diff validation, Main
accept and one usable Codex Judge accept remain valid. The original Integration blocker is still
only the missing second usable Judge opinion.

## Boundary and decision

The accepted replacement froze one Attempt and no retry, correction, repair, fallback or automatic
further replacement. Main therefore does not chmod and resubmit automatically.

The smallest continuation is one explicit wrapper-mode-only replacement: set only the new wrapper's
executable bit to `0755`, add a focused preflight assertion that the configured executable is
actually executable, reuse the same exact Candidate patch and unchanged A1 acceptance, then run one
fresh Grok 4.6 Xhigh native Goal and exactly two new Judges. No product content change is needed.

Continuing requires 一骏 to revoke the no-further-replacement boundary for exactly that
wrapper-mode-only Task. The alternative is to leave M5-A1 stopped; Integration cannot safely bypass
the declared two-Judge gate. No commit, push, reset, reclaim or Hub UI work occurred.

## Decision received

一骏 explicitly said to continue. Main treats this as revocation for exactly one final
wrapper-mode-only replacement. The wrapper is now `0755`; its focused policy test asserts execute
permission. Operational contract:
`execution/m5-wave-1/05-m5-a1-final-wrapper-mode-delivery.yaml`. All other stop boundaries remain.
