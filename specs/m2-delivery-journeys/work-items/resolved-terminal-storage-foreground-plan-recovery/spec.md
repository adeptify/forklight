# M2 Work Item — Foreground Planner exact storage Candidate recovery

## User result

The already verified resolved-terminal storage Candidate is adopted through one real Grok CLI 4.6
Xhigh native `/goal`. Grok's synchronous foreground Planner can create its Task-local plan, while
the Worker still cannot run terminal/background controls or edit the Candidate Workspace. The exact
Candidate then receives ForkLight verification, two independent Judges and serial Main Integration.

## Background and current evidence

The predecessor Task `53c01375-25f7-432d-98cf-635f097a25d8` permanently consumed its one base
Attempt. Its Main-owned materializer produced exact Revision
`1d00fc0e-6ab6-4234-98ba-7341c1f688c3` from the frozen two-path seed, full digest
`48a73c6b6db1071fd62f2dfffa3799df81805cdc1e6d4a46cb163bb9ebdafcda`, and ForkLight independently
passed the policy, reverse-apply, build, 321 focused tests and diff validation. Main rejected it
before Judges because native Goal `ec54061a-82ee-436a-a543-27bbb660ce3c` had no plan, zero
classifier runs and no durable `complete + achieved`.

The Planner child failed at session initialization with zero turns and zero tool calls. The wrapper
exposed `get_task_output`, `kill_task` and `wait_tasks`; Grok CLI 1.0.4 requires a background-capable
Bash or Task tool for those controls, while the accepted safety boundary intentionally exposes
neither. Grok's bundled 1.0.4 semantics show its native Planner is a synchronous foreground
subagent. Therefore those three background controls are unnecessary and are the exact failure.

一骏 explicitly authorized this new self-contained M2 Work Item on 2026-08-15. It is not a retry,
resume, correction or replacement of the predecessor Task. It removes only that three-tool group,
keeps foreground `Agent` plus Task-local `search_replace/write`, preserves every safety and
Candidate boundary, and permits one base Attempt with no fallback.

## `depends_on`

- The predecessor decision packet at
  `goals/forklight-main-led-execution/evidence/m2-resolved-terminal-storage-native-plan-recovery-decision-packet.md`.
- Frozen seed
  `goals/forklight-main-led-execution/execution/m2-resolved-terminal-storage-recovery/172d6a80-bdd7-487a-9e97-b938a67f10c5.patch`
  with the full digest above.
- Current source is clean-applicable or exactly reverse-applicable for the seed.
- ForkLight build/Daemon/MCP identity matches, Grok/xAI is launchable, and no other Writer is active.

## Inputs

- The frozen seed, digest, exact two allowed paths and prior independent verification.
- Current source snapshot and both accepted resolved-terminal storage parent specs.
- Current Grok CLI identity, native `/goal` state, current-model-only switch and bundled foreground
  subagent semantics.
- The accepted operational permission boundary: Task-local plan mutators and foreground Agent are
  present; terminal/background tools, Bash and Candidate Workspace writes are absent or denied.

## Outputs

- One exact Candidate changing only `src/core/storage-lifecycle.ts` and
  `tests/storage-lifecycle.test.ts`, 181 changed lines and the frozen full digest.
- Durable native Goal truth with a non-empty plan, at least one classifier run, `complete` status
  and `achieved` details under Grok 4.6 current-model-only.
- ForkLight independent verification, two usable independent Judge opinions bound to the same
  Revision, Main decision and safe Integration if every prior gate passes.
- On failure, one decision packet and a protected Workspace; no automatic retry or fallback.

## Execution design and call chain

1. Main's materializer validates the seed digest and path headers, applies it once in the isolated
   Workspace or proves it is already exact, then proves reverse-apply.
2. The Workspace-local child converts ForkLight's prompt into `/goal <objective>` or `/goal resume`
   and freezes `GROK_GOAL_USE_CURRENT_MODEL_ONLY=1`.
3. It removes `get_task_output`, `kill_task` and `wait_tasks` from the projected tool list as one
   dependency group. It retains foreground `Agent` plus `search_replace/write` for Task-local Goal
   planning; `run_terminal_cmd` remains disallowed and Bash remains denied.
4. Explicit `Write(<Workspace>/**)` and `Edit(<Workspace>/**)` denials keep the Candidate read-only
   to Grok model tools. Provider credentials, Grok configuration and native Goal state remain
   protected. Only the pre-Grok materializer may create the exact Candidate.
5. Grok plans, reads and self-checks. Main accepts Worker success only from durable native Goal
   truth, never from prose or exit code.
6. ForkLight independently verifies the Candidate. Only after native Goal truth passes do two
   independent Judges inspect that exact Revision; Main reviews and integrates serially.

## Allowed modification paths

Candidate paths:

- `src/core/storage-lifecycle.ts`
- `tests/storage-lifecycle.test.ts`

Main-owned planning and operational paths:

- `specs/m2-delivery-journeys/work-items/resolved-terminal-storage-foreground-plan-recovery/spec.md`
- `goals/forklight-main-led-execution/execution/m2-resolved-terminal-storage-foreground-plan-recovery/**`
- the existing Goal SSOT and compact evidence index/decision packet.

Task-local Goal artifacts may be written only under that Task's `GROK_HOME`. The frozen seed is an
input and must not be edited.

## Forbidden paths and non-goals

- Any third Candidate path, Candidate rewrite, new lifecycle behavior or extra product test.
- Direct source-checkout edits by the Worker, terminal/background controls, Bash, web, MCP,
  Worker-side Integration, commits, pushes, PRs or Git remote changes.
- Provider credential, Grok config or native Goal state edits by model tools.
- Store/schema/protocol changes, execution-mode relabeling, native-goal product graduation,
  historical Task mutation or manual historical cleanup.
- Extra Attempt, validation repair, correction, reverification, adaptation, handoff, reroute,
  model switch, Competition or another replacement if this Work Item fails.
- Checksums beyond the already accepted exact seed identity, locks, leases, version handshakes,
  duplicate consistency, multi-user/distributed behavior, Hub/UI or M3 work.

## Acceptance

1. The wrapper policy test proves foreground `Agent`, `search_replace/write` and read tools are
   present; `get_task_output`, `kill_task`, `wait_tasks` and `run_terminal_cmd` are absent;
   terminal/Bash and Workspace `Write/Edit` remain denied; protected Runtime files remain denied.
2. Seed sha256 equals the frozen digest, exact path headers match, and reverse-apply succeeds in
   the Candidate Workspace.
3. Candidate path set, changed-line count and full digest exactly match the frozen Revision.
4. Native Goal durable truth has a non-empty plan, at least one classifier run, status `complete`
   and `achieved` details under current-model-only. Prose and exit code are insufficient.
5. ForkLight independently passes build, the original storage/daemon/CLI/MCP suite and diff check.
6. Two fresh usable exact-Revision Judge opinions satisfy the immutable review gate; Main checks
   diff, error paths, native Goal truth, verification and provenance before accepting.
7. Safe Integration, activation and `npm run check` run only after all prior gates. Existing
   downstream audits may then run; destructive six-Task reclaim still needs a fresh preview and
   一骏's separate explicit confirmation.

## Verification commands

```bash
node goals/forklight-main-led-execution/execution/m2-resolved-terminal-storage-foreground-plan-recovery/foreground-plan-bootstrap.test.mjs
node --check goals/forklight-main-led-execution/execution/m2-resolved-terminal-storage-foreground-plan-recovery/foreground-plan-bootstrap.mjs
node --check goals/forklight-main-led-execution/execution/m2-resolved-terminal-storage-foreground-plan-recovery/exact-candidate-foreground-plan-bootstrap.mjs
test "$(shasum -a 256 goals/forklight-main-led-execution/execution/m2-resolved-terminal-storage-recovery/172d6a80-bdd7-487a-9e97-b938a67f10c5.patch | awk '{print $1}')" = "48a73c6b6db1071fd62f2dfffa3799df81805cdc1e6d4a46cb163bb9ebdafcda"
git apply -p2 --reverse --check goals/forklight-main-led-execution/execution/m2-resolved-terminal-storage-recovery/172d6a80-bdd7-487a-9e97-b938a67f10c5.patch
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/storage-lifecycle.test.ts tests/daemon.test.ts tests/daemon-cli.test.ts tests/cli-supervision.test.ts tests/mcp.test.ts
git diff --check
```

## Parallelism and Integration

This Work Item is the only Writer. Its two Candidate paths do not overlap the stopped native-goal
product Candidate, but both affect M2 truth and Main Integration is serial. No parallel Writer is
allowed. The predecessor Task and all earlier Workspaces remain immutable evidence.

## Handoff

Handoff contains this Spec; new Task, Attempt, Session and native Goal ids; exact seed and Candidate
Revision/digest/paths; wrapper policy result; native plan/classifier/terminal evidence; ForkLight
verification; two Judge opinions; Main decision; Integration/audit outcomes; workspace preview;
and economics. It excludes credentials, raw prompt bodies and raw Runtime Home contents.

## Workspace disposition and stop

Protect all prior and new Workspaces until Candidate, native Goal state, verification and handoff
evidence are durable. One base Attempt is the full execution authority. Any failure ends this Work
Item without correction, extra Attempt, fallback or successor. Accepted Integration may make
ordinary terminal-workspace reclamation eligible, but the exact six historical Tasks require a
fresh auditable preview and separate destructive confirmation before reclaim.

## Execution result — stopped at immutable review gate

Task `6fbf8e70-a48a-4e7b-8cb8-3dc07e836085` consumed its one base Attempt and produced exact
Candidate Revision `d6c85d59-10dc-4325-a0fc-e627b62130c2` at the frozen full digest, two paths and
181 lines. Native Goal `e1941538-caf8-4c0b-bdf1-5c5241bf3476` has a 7,281-byte plan, one
classifier run, durable `complete` status and `achieved` verdict. ForkLight independently passed
all six commands, including build and 321 focused tests.

Review Graph `c9721c94-9740-4ff2-9502-b26ce8a75a9c` returned one usable Codex Luna Max `accept`
and one unusable DeepSeek schema-violation. The required two-usable-Judge gate therefore failed.
This Spec authorizes no replacement Judge, review fallback, correction or successor, so Main bound
the exact Attempt, verification sequence 1899, Revision and digest to `reject`. No Integration,
audit or reclaim ran. The Workspace remains protected; the durable handoff is
`goals/forklight-main-led-execution/evidence/m2-resolved-terminal-storage-foreground-plan-recovery-decision-packet.md`.

## 2026-08-16 authorized repair and delivery continuation

一骏 later authorized one exact 1-Judge delivery exception for the separate Judge-result-repair
product Candidate. Main applied only that frozen Revision after normal ForkLight preflight proved
review depth was its sole rejection and every path, source-base, digest, apply and verification
guard passed independently. This was recorded honestly as a manual exception, not as a ForkLight
Integration result.

The activated product then ran exactly one same-Judge schema-only repair on assignment
`16123390-e749-466b-a53c-2035913defa8`. Repair Task
`bbf11b7f-e3bf-4e88-828c-06845a6027de` reused the frozen DeepSeek Flash identity and original
private packet, returned a schema-valid `accept`, and made Review Graph
`c9721c94-9740-4ff2-9502-b26ce8a75a9c` two-usable-opinion `agreement`. No Candidate, assignment or
Judge was rerun, replaced or added.

Main re-inspected exact Revision `d6c85d59-10dc-4325-a0fc-e627b62130c2`, recorded a fresh accept,
and used the normal ForkLight preflight/apply path. Integration operation
`c68d7eab-f24c-46df-af82-7a0f10a82854` passed source apply, all six independent verification
commands, build, activation and activation checks. The post-Integration full check passed
2,966/2,966 tests and client/Daemon build identity is matched.

The three existing activated-source audits are now the ready strict-serial wave. The first uses the
integrated `grok-4-6-xhigh` Profile in truthful wrapper-free `native-goal` mode because it is a real
accepted lifecycle audit, not a ceremonial self-proof Task. Destructive reclaim of the six exact
historical Tasks remains blocked until all three audits pass, a fresh exact preview succeeds and
一骏 separately confirms it.
