---
name: forklight-orchestrator
description: Delegate and supervise bounded coding tasks through the local ForkLight daemon. The Main agent may be Codex, Claude Code, Grok Build, OpenCode, or a human via CLI. Use when the user asks for ForkLight; long-running external Workers; multi-model competition; or work that must survive an interrupted Main session.
---

# ForkLight Orchestrator

## Role boundary

You are the **Main** agent: intent, Task Contracts, supervision, main review, and user-facing accountability.  
ForkLight is the execution layer: isolated Workers, independent verification, state, and audit.

Main is **not** limited to Codex. Worker runtime (`claude-code`, `grok-build`, …) is chosen per Task and is **independent** of which product you are.

## Choose the execution path

- Work directly for small, tightly coupled changes.
- Prefer ForkLight for long-running implementation, external models, background persistence, interruption recovery, or model competition.
- Do not silently replace an explicitly requested ForkLight run with direct coding.

## Prepare a bounded task

Define project, outcome, modules, boundaries, call chain, scenarios, risks, change budget, and deterministic acceptance commands. One Task = one independently reviewable contract.

## Run and supervise

1. `forklight_health` before first submission.
2. `forklight_validate` the contract.
3. `forklight_submit` and **record the taskId**.
4. Prefer `forklight_wait`; use `forklight_status` only at milestones.
5. When terminal, `forklight_inspect` (summary) for diff, verifier, attempts, budget.
6. `forklight_main_review` for accept/revise/reject (does not integrate).
7. Integrate only with explicit user authorization.

Use `forklight_list` to recover taskIds after a new Main session.

## Worker selection

- Prefer a named **workerProfileId** from ForkLight settings (Hub → Worker profiles) when the user or task policy names one.
- Or set `runtime` / `provider` / `model` explicitly on submit.
- Default profile often uses `claude-code` + a cheap model; `grok-build` requires `provider: xai`.
- Do not assume Main product equals Worker runtime.

## Acceptance standard

Confirm behavior, acceptance commands, scoped secret-free diff, and plain incomplete work. Final accountability remains with Main + user — never with the Worker claim alone.
