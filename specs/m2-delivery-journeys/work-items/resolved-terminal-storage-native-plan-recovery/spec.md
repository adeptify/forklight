# M2 Work Item — Native-plan-only exact storage Candidate adoption

## User result

The already verified resolved-terminal storage Candidate is adopted through a real Grok CLI 4.6
Xhigh native `/goal` whose Planner can write its Task-local plan artifact, while the Grok Worker
still cannot edit the Candidate Workspace or run Bash. The frozen Candidate then receives
ForkLight independent verification, two fresh exact-Revision Judges and serial Main Integration.

## Background and evidence

Final Task `65876057-5f0c-4676-a5dc-4a80e5425cb0` permanently ended under its no-fallback
contract. It materialized exact Revision `70daf39b-5acd-42ac-a20f-667d083e3aeb`, full digest
`48a73c6b6db1071fd62f2dfffa3799df81805cdc1e6d4a46cb163bb9ebdafcda`, two paths and 181 lines;
ForkLight independently passed seed identity, reverse apply, build, 321 focused tests and diff
validation. Main rejected it before Judges because native Goal
`a71f91df-ec00-499e-b852-144f4f8d4bc9` durably ended `user_paused` with no plan file, no
classifier run and no `complete + achieved`.

The focused audit proved the exact cause. Grok 1.0.3 Planner made five terminal-command attempts
to create its required Task-local plan file. The final Task exposed no file mutator and explicitly
denied Bash, so every attempt was rejected and Grok emitted
`goal_planner_fail_closed: missing_plan_file`. The later ordinary-turn success prose was not native
Goal completion. Authentication, model identity, Workspace-local child loading, Candidate bytes,
source compatibility and product behavior all passed or are independently excluded.

一骏 authorized a new M2 Work Item on 2026-08-15. This is not a retry, resume, correction or
replacement of the terminal Task. It creates a new accepted boundary that allows only the native
Planner's Task-local runtime artifact write while retaining the exact Candidate and acceptance.

## `depends_on`

- Completed root-cause evidence in
  `goals/forklight-main-led-execution/evidence/m2-resolved-terminal-storage-recovery-bootstrap-stop-decision-packet.md`.
- Frozen seed
  `goals/forklight-main-led-execution/execution/m2-resolved-terminal-storage-recovery/172d6a80-bdd7-487a-9e97-b938a67f10c5.patch`
  with the exact full digest above.
- Current source remains clean-applicable or exactly reverse-applicable for that seed.
- ForkLight health is matched; Grok/xAI is currently launchable; no active Writer exists.

## Inputs

- The frozen two-path seed and its digest-bound patch headers.
- Current source snapshot and the two accepted resolved-terminal storage specs.
- Grok CLI 1.0.3 native Goal semantics and current-model-only environment switch.
- The focused permission audit: `search_replace/write` are the native file mutators; CLI
  `Write/Edit(<Workspace>/**)` denials apply even under always-approve; Bash remains denied.

## Outputs

- One exact Candidate changing only `src/core/storage-lifecycle.ts` and
  `tests/storage-lifecycle.test.ts`, 181 changed lines and the frozen full digest.
- Task-local native Goal evidence with one stable Goal id, a non-empty plan file, at least one
  classifier run, durable `complete` and `achieved` details under Grok 4.6 current-model-only.
- ForkLight independent verification, two fresh usable Judge opinions on the same Revision, Main
  decision, safe Integration and the existing downstream audits/reclaim only if all prior gates pass.
- On any failure, one decision packet and protected Workspace; no automatic fallback.

## Execution design and call chain

1. Main's operational materializer verifies the seed digest and exact two-path headers, applies it
   once in the isolated Workspace or proves it is already exact, and proves reverse-apply.
2. The Workspace-local child bootstrap converts the ordinary ForkLight prompt into real Grok
   `/goal <objective>` and freezes `GROK_GOAL_USE_CURRENT_MODEL_ONLY=1`.
3. The child adds only `search_replace` and `write` for native Planner artifact creation, removes
   those names from Grok's tool disallow list, and keeps `run_terminal_cmd` disallowed plus Bash
   denied.
4. The child adds explicit `Write(<Workspace>/**)` and `Edit(<Workspace>/**)` denials. Therefore
   model tools cannot change product files; only the pre-Grok materializer creates the frozen
   Candidate. Existing credential/config/native-state denials remain.
5. Grok plans, reads and self-checks the already materialized Candidate. Main accepts Worker
   success only from durable native Goal terminal truth, never from prose or exit code.
6. ForkLight independently runs the original commands, captures the exact Revision and, only
   after Main confirms native Goal truth, assigns two independent Judges. Main reviews and
   integrates serially.

## Allowed paths

Candidate paths:

- `src/core/storage-lifecycle.ts`
- `tests/storage-lifecycle.test.ts`

Main-owned planning/operational paths:

- `specs/m2-delivery-journeys/work-items/resolved-terminal-storage-native-plan-recovery/spec.md`
- `goals/forklight-main-led-execution/execution/m2-resolved-terminal-storage-native-plan-recovery/**`
- the existing Goal SSOT and compact evidence index/decision packet.

Task-local runtime artifacts may be written only under that Task's `GROK_HOME`; the model-facing
Candidate Workspace stays read-only. The frozen seed is an input, never an output.

## Forbidden paths and non-goals

- Any third Candidate path, Candidate rewrite, new lifecycle behavior or additional product test.
- Editing the source checkout directly, modifying Provider credentials, native `state.json`,
  Grok config, Git remotes, commits, pushes or PRs.
- Bash, web, MCP, Worker-side Integration, manual source patching, historical Task mutation,
  Store/schema/protocol changes, public execution-mode relabeling or native-goal product graduation.
- Extra Attempt, validation repair, correction, reverification, adaptation, handoff, reroute,
  model switch, Competition or another replacement if this Work Item fails.
- General checksum/content-addressing, locks, leases, version handshakes, duplicate consistency,
  multi-user/distributed behavior, Hub/UI or M3 work.

## Acceptance

1. Operational bootstrap unit check proves Planner mutators are exposed, terminal/Bash stay
   denied, Workspace `Write/Edit` are denied, current-model-only is set, and protected runtime
   files remain denied.
2. Seed sha256 equals the frozen digest and reverse-apply succeeds in the Candidate Workspace.
3. Candidate path set, changed-line count and full digest exactly match the frozen Revision.
4. Native Goal durable truth has a non-empty plan file, at least one classifier run, status
   `complete`, and `achieved` details; ordinary prose or exit 0 is insufficient.
5. ForkLight independently passes build, the original storage/daemon/CLI/MCP suite and diff check.
6. Two fresh usable exact-Revision Judge opinions satisfy the immutable gate; Main independently
   checks the actual diff, native Goal truth, verification and provenance before accept.
7. Safe Integration, activation, `npm run check`, three existing zero-change audits, exact
   six-Task preview/reclaim and final integrity/orphan/process audit run only after the prior gates.

## Verification commands

```bash
node goals/forklight-main-led-execution/execution/m2-resolved-terminal-storage-native-plan-recovery/native-plan-bootstrap.test.mjs
node --check goals/forklight-main-led-execution/execution/m2-resolved-terminal-storage-native-plan-recovery/native-plan-only-bootstrap.mjs
node --check goals/forklight-main-led-execution/execution/m2-resolved-terminal-storage-native-plan-recovery/exact-candidate-native-plan-bootstrap.mjs
test "$(shasum -a 256 goals/forklight-main-led-execution/execution/m2-resolved-terminal-storage-recovery/172d6a80-bdd7-487a-9e97-b938a67f10c5.patch | awk '{print $1}')" = "48a73c6b6db1071fd62f2dfffa3799df81805cdc1e6d4a46cb163bb9ebdafcda"
git apply -p2 --reverse --check goals/forklight-main-led-execution/execution/m2-resolved-terminal-storage-recovery/172d6a80-bdd7-487a-9e97-b938a67f10c5.patch
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/storage-lifecycle.test.ts tests/daemon.test.ts tests/daemon-cli.test.ts tests/cli-supervision.test.ts tests/mcp.test.ts
git diff --check
```

## Parallelism and Integration

This Work Item is the sole Writer. Its Candidate paths are disjoint from the stopped native-goal
product Candidate, but both affect M2 execution truth and Main Integration remains serial. No
parallel Writer starts. The stopped final Task and all earlier Workspaces remain immutable evidence.

## Handoff

Handoff contains this Spec, new Task/Attempt/Session/native Goal ids, exact seed and Candidate
Revision/digest/paths, operational bootstrap test result, native plan/terminal evidence, ForkLight
verification, both Judge opinions, Main decision, Integration operation, audits, exact reclaim and
economics. It excludes prompt bodies, credentials and raw Runtime Home data.

## Workspace disposition and stop

Protect every prior and new Workspace until Candidate, native Goal state, verification and handoff
evidence are durable. A failure stops this Work Item immediately with no extra execution authority.
Only after accepted Integration and downstream audits may ordinary product lifecycle reclaim
eligible regenerable roots. Exact six-Task historical reclaim still requires a fresh preview and
一骏's destructive confirmation if it becomes eligible.

## Execution result — stopped

Task `53c01375-25f7-432d-98cf-635f097a25d8` consumed the one base Attempt and produced the exact
two-path Candidate Revision `1d00fc0e-6ab6-4234-98ba-7341c1f688c3` at the frozen digest. ForkLight
independent acceptance passed, including build and 321 focused tests. Acceptance item 4 failed:
native Goal `ec54061a-82ee-436a-a543-27bbb660ce3c` has no plan, zero classifier runs and no
`complete + achieved`.

The planner child failed during session initialization because `kill_task`, `get_task_output` and
`wait_tasks` were exposed without their required background-capable Bash or `task` dependency.
The accepted boundary intentionally forbids those execution capabilities. Main rejected the exact
Revision before Judges; no Integration or reclaim ran. This Spec authorizes no correction or
successor. The durable handoff is
`goals/forklight-main-led-execution/evidence/m2-resolved-terminal-storage-native-plan-recovery-decision-packet.md`.
