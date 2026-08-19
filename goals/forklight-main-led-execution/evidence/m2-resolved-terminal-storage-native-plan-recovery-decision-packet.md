# M2 Native-plan-only Storage Recovery — Decision Packet

Date: 2026-08-15 (Asia/Shanghai)

## Outcome

The exact storage Candidate remains reusable, but this Work Item is rejected and stopped. Product
verification passed; Grok native Goal truth did not. No Judge, Integration or reclaim was started.

## Frozen authority and identities

- Task: `53c01375-25f7-432d-98cf-635f097a25d8`
- Session: `db2043ca-73e0-4b52-ab72-4160c2162e1e`
- Attempt: `1590529e-567a-4669-91c8-b7afe04e6ad3`
- Candidate Revision: `1d00fc0e-6ab6-4234-98ba-7341c1f688c3`
- Candidate digest: `48a73c6b6db1071fd62f2dfffa3799df81805cdc1e6d4a46cb163bb9ebdafcda`
- Native Goal: `ec54061a-82ee-436a-a543-27bbb660ce3c`
- Planner child: `01a00541-20f1-78e3-838d-6e27562ad5f5`
- Main Review binding: verification event sequence `1180`, decision `reject`

The Task had one base Attempt and zero extra Attempt, validation repair, Main correction,
reverification, adaptation, handoff, reroute, model switch or replacement authority.

## Reusable completed output

- Candidate changes exactly `src/core/storage-lifecycle.ts` and
  `tests/storage-lifecycle.test.ts`, 181 changed lines, at the frozen full digest.
- Operational bootstrap policy test passed.
- Seed digest and reverse-apply proof passed.
- `npm run build` passed.
- The accepted storage/daemon/CLI/MCP command passed all 321 tests.
- `git diff --check` passed.
- ForkLight recorded source compatibility and policy acceptance as passed.

These facts prove the Candidate, not native Goal completion.

## Exact stop evidence

Native Goal state is `user_paused`, phase `Executing`, with `plan_file: null`, zero classifier
runs, zero Worker rounds, zero verifier rounds and no durable `complete` or `achieved` state.

The planner child was created under `grok-4.6/xhigh/current-model-only`, then failed session
initialization in four milliseconds with zero turns and zero tool calls. Its durable error names
three unsatisfied tool requirements:

- `kill_task` requires a supported background task capability;
- `get_task_output` requires background-capable `run_terminal_cmd`, OpenCode Bash, or `task`;
- `wait_tasks` requires the same task capability family.

The operational bootstrap exposed those controls while the accepted safety boundary deliberately
kept terminal/Bash and `task` unavailable. The Planner therefore failed before it could use the
otherwise valid Task-local `search_replace/write` plan path. This is distinct from the prior
`missing_plan_file` failure.

The exact Attempt ran Grok CLI `1.0.4` at commit `d846eb93d94d`; the currently installed CLI still
reports that same identity. Its durable parent `available_commands` projected `spawn_subagent`,
Task-local `write/search_replace`, and the mapped get/kill background controls, but no terminal
tool. The Runtime's bundled 1.0.4 documentation states that subagents default to blocking
foreground execution (`background: false`), while output retrieval, multi-task waiting and kill
exist for background commands or background subagents. The native Goal Planner itself was spawned
synchronously before the ordinary parent turn.

This closes the design inference: the three background controls are not needed for the synchronous
Planner and must be removed as one dependency group. `Agent` plus `search_replace/write` remain;
`run_terminal_cmd`, Bash and Candidate Workspace writes remain denied. Re-enabling shell would be
a wider and unnecessary safety change. Only a future live `/goal` can provide final runtime proof
that the reduced toolset initializes, so this read-only evidence is a precise next boundary, not a
success claim.

## Main decision and non-actions

Main rejected the exact Revision because native Goal acceptance requires a non-empty plan, at
least one classifier run and durable `complete + achieved`. Worker prose, exit 0 and successful
product tests cannot replace that truth. Judges were not assigned and Integration was not
authorized. No retry, resume, correction, reverification, adaptation, handoff, reroute, model
switch, replacement, manual patch, audit or reclaim occurred.

## Workspace and economics

Storage preview classifies the Task as protected. It contains 132,745,766 bytes total,
130,959,896 regenerable bytes, 1,785,870 durable bytes and zero unknown bytes; no process is
attached. Store quick check is `ok` with zero foreign-key violations.

Worker Token evidence is incomplete: one sample is missing, so zero observed tokens is not claimed
as measured zero. ForkLight reports only a low-confidence Main-exchange estimate of 7,355–83,482
tokens; no Main Token reduction or direct-Codex saving is available.

## Decision required

Current authorization is exhausted. M2 remains open and M3 remains closed. A future continuation
requires a new Milestone-level decision. The smallest evidenced technical option would be a new
self-contained Work Item that removes only the three unused, dependency-unsatisfied Task-control
tools while retaining Task-local plan mutators, Workspace `Write/Edit` denials, Bash denial, the
exact seed, one Attempt and every downstream quality gate. Its preflight must bind the current
Grok CLI identity, and its one real `/goal` is the only allowed proof of Planner initialization;
there is no separate ceremonial smoke or fallback Task. This packet does not authorize it.

## Subsequent authorization

一骏 subsequently authorized exactly the smallest evidenced continuation: one new self-contained
M2 Work Item that removes `get_task_output`, `kill_task` and `wait_tasks` as one unused background
control group while preserving foreground `Agent`, Task-local `search_replace/write`, Workspace
`Write/Edit` denial, Bash denial, the exact seed, one base Attempt and every downstream quality
gate. The accepted successor Spec is
`specs/m2-delivery-journeys/work-items/resolved-terminal-storage-foreground-plan-recovery/spec.md`.
This does not reopen or mutate the Task, Attempt, reject or Workspace recorded in this packet.
