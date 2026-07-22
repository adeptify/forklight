---
name: forklight-orchestrator
description: Delegate and supervise bounded coding tasks through the local ForkLight daemon while Codex remains responsible for planning, acceptance, correction, and final integration. Use when the user explicitly asks for ForkLight; when a coding task should run persistently in the background; when an external or non-Codex model should implement the task; when comparing multiple model implementations; or when work must survive an interrupted Codex conversation. Do not use it merely to inspect files or for a tiny change that Codex can complete and verify directly.
---

# ForkLight Orchestrator

## Role boundary

Use ForkLight as an execution layer, not as a replacement for the primary Codex agent. Codex keeps responsibility for intent, solution alignment, task boundaries, acceptance, correction, and integration.

ForkLight Workers are persistent external-model processes. They edit only an isolated workspace, have no shell or web tools, and cannot edit the original project. ForkLight independently runs the acceptance commands after a Worker finishes.

## Choose the execution path

- Work directly for small, tightly coupled changes.
- Prefer ForkLight for long-running implementation, external-model work, background persistence, interruption recovery, or model competition.
- Do not silently replace an explicitly requested ForkLight run with direct coding.

## Prepare a bounded task

Before submission, define the exact project, outcome, module inputs and outputs, boundaries, call chain, scenarios, risks, changed-file budget, and deterministic acceptance commands. Keep one task narrow enough for one Worker to understand and verify.

## Run and supervise

1. Call `forklight_health` before the first submission.
2. Validate the Task Contract with `forklight_validate`.
3. Call `forklight_submit` and record the returned task ID.
4. Poll `forklight_status` only at meaningful milestones.
5. When terminal, call `forklight_inspect` and review the diff, verifier evidence, attempt history, errors, budget, and source fingerprint.
6. Resume only when the original contract remains correct. Otherwise submit a corrected task.
7. Integrate accepted changes deliberately. Never commit or push without separate user approval.

Use `forklight_list` to recover task IDs after a new Codex task.

## Acceptance standard

Confirm that the implementation matches the agreed behavior, acceptance commands passed, the diff is scoped and secret-free, the original source stayed unchanged, and incomplete work is reported plainly. ForkLight execution never transfers final accountability away from Codex.
