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

### Classify every new non-demo Task

For ordinary new Tasks (not throwaway demos), supply both on `forklight_validate` / `forklight_submit`:

- **`taskClass`**: exact, stable identifier for this Task type (audit + routing evidence). Never invent history for old Tasks.
- **`taskFamily`**: one stable family id for cross-project evidence. Explicit Main choice only.
  - **Reuse** an existing stable family when behavior, module boundaries, inputs/outputs, and acceptance intent genuinely match that family.
  - **Do not** invent a new family for lexical similarity alone (shared words in names/prompts without matching contract shape).
  - **Do not** create unnecessary new families when a matching stable family already exists.
  - **Do not** backfill or rewrite family on stored history. Omit only when a legacy client path cannot supply classification.

### Select a Worker and record the decision

1. Call read-only `forklight_worker_catalog` before choosing, unless the user has already fixed one exact Worker and no selection judgment remains. Read each saved identity and optional `assignmentGuidance`.
2. Treat `assignmentGuidance` as the user's advice to **Main** about task fit. Consider it together with the Task, explicit user preferences, capability, risk and current readiness. It does not force an unavailable Worker or override Main's judgment.
3. Never copy, quote or paraphrase `assignmentGuidance` into the Task Contract, `context`, `executionSteps`, Worker prompt or correction message. The selected Worker never receives it as execution input.
4. Shortlist only **genuinely considered ready** Worker Profiles. Do not list every configured model.
5. When **at least two** Workers are plausible, you may call read-only `forklight_model_routing` with the exact `taskClass`, candidates, and optional `taskFamily`. Skip routing when only one Worker is honestly under consideration.
6. Choose one Worker (`workerProfileId` and/or `provider` / `model` / `runtime` / `effort`). Honor standing user Provider preferences when they apply.
7. On validate/submit, include an explicit **`routingDecision`** snapshot:
   - `shortlist`: frozen identities actually considered
   - `selectedWorker`: must match the resolved Task Worker identity
   - `selectedBecause`: bounded `code` + plain-language `note`
   - `competition.intent` / `triggers`: explicit Main decision
   - `evidenceSnapshot`:
     - Put **measured** sample counts only from a read-only `forklight_model_routing` result you actually used.
     - When routing was **skipped** or counts are **unavailable**, set `scope: none`, use an **empty** count map (`exactSampleCounts: {}`), and state in `selectedBecause.note` that counts are unavailable — **never** write zero as a stand-in for unqueried evidence.
     - A routing-reported zero is a real measurement; an empty map means not measured.

Never auto-generate a routing decision from `workerProfileId` alone. Never fabricate sample counts or past outcomes.

### Competition is never automatic

- Default `competition.intent` to **`none`** when evidence is unknown or unqueried, routing measured zero relevant samples, or only one Worker is selected.
- Use `consider` or `required` only with real triggers: `critical`, `multiple-plausible-solutions`, `new-family`, or `user-requested`.
- Uncertainty alone does **not** authorize multi-Worker spend. Do not launch extra Workers just to populate statistics.
- Competition remains a separate explicit path (`forklight_compete_submit`) with bounded candidates.

## Run and supervise

1. `forklight_health` before first submission.
2. `forklight_validate` the contract (including classification + routingDecision for new non-demo Tasks).
3. `forklight_submit` and **record the taskId**.
4. Prefer `forklight_wait`; use `forklight_status` only at milestones.
5. When terminal, `forklight_inspect` (summary) for diff, verifier, attempts, budget.
6. `forklight_main_review` for accept/revise/reject (does not integrate).
7. Integrate only with authorization (see below).

Use `forklight_list` to recover taskIds after a new Main session.

## Worker selection

- Prefer a named **workerProfileId** from ForkLight settings (Hub → Worker profiles) when the user or task policy names one.
- Or set `runtime` / `provider` / `model` explicitly on submit.
- Default profile often uses `claude-code` + a cheap model; `grok-build` requires `provider: xai`.
- Do not assume Main product equals Worker runtime.
- Keep `selectedWorker` in `routingDecision` identical to the Worker that will actually run.

## Review and Integration

- Main review is mandatory accountability: accept / revise / reject from evidence, never from Worker claims alone.
- **Integration**: honor a standing user instruction that authorizes Integration for this session or project when one exists. If no standing authorization exists, require explicit user approval before `forklight_integration_apply`.
- **Commit and push** remain separately prohibited without explicit user approval — standing Integration authority never implies git publish rights.
- Never use ForkLight to commit or push.

## Acceptance standard

Confirm behavior, acceptance commands, scoped secret-free diff, and plain incomplete work. Final accountability remains with Main + user — never with the Worker claim alone.
