# M2 resolved-terminal storage recovery — bootstrap stop decision packet

## Current truth

The authorized exact-Candidate recovery stopped before Grok CLI native `/goal`, independent
verification, Candidate Revision creation, Judge review, Main decision, Integration, downstream
audits or reclaim. The frozen product Candidate remains unchanged and protected:

- original Task `71850bde-917a-426c-b92a-164790b1abbd`;
- Revision `172d6a80-bdd7-487a-9e97-b938a67f10c5`;
- full digest `48a73c6b6db1071fd62f2dfffa3799df81805cdc1e6d4a46cb163bb9ebdafcda`;
- exactly `src/core/storage-lifecycle.ts` and `tests/storage-lifecycle.test.ts`, 181 changed lines;
- prior build, 295 focused tests and diff validation passed twice.

No storage behavior failed in the recovery. Both failures were in the Main-authored exact-Candidate
materializer before the Grok process launched.

## Attempt evidence

The first strict-serial operational Goal used implementation Task
`4ad6f4d6-7196-494d-9b94-6db118c7cbf5`, Attempt
`c2e73126-0249-421f-a0b9-6c0b29a5028b` and Session
`15b0ab51-f54a-4b76-84ba-385b6d22d819`. It stopped before applying the seed because the sandboxed
Git subprocess tried to read `/Users/yijunwang/.gitconfig` and received `Operation not permitted`.
Its frozen `baseMaxAttempts: 1`, `maxExtraAttempts: 0` and `maxAdaptationRounds: 0` correctly
prevented mutation or retry. Main stopped the operational Goal and retained the Task.

The bootstrap-only repair set `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_SYSTEM=/dev/null` for
materializer and child processes. The one allowed replacement Task
`0ee15d39-3f4a-418e-b5dc-6026033e6de6`, Attempt
`d2ef0b53-8de4-436e-a8fc-98747f7690fd` and Session
`dd1214cf-8e61-4f52-83dc-f04a165e06e8` then:

- read the seed at the exact expected digest;
- applied it successfully inside the isolated Workspace;
- passed the exact reverse-apply proof from that Workspace;
- changed only the two expected files relative to its ForkLight baseline, with numstat `9/0` and
  `171/1` (181 lines total).

It then failed its pre-Grok path inspection because the wrapper called repository-form
`git diff --name-only` in ForkLight's intentionally `.git`-free Workspace. No Grok native Goal id
exists and ForkLight created no Candidate Revision or verification record. This is the second
purposeful bootstrap round, so Main did not use the replacement Task's unused explicit-extra-Attempt
capacity.

## Reusable output and disposition

- The original exact Candidate, all verification and Review Graph evidence remain reusable.
- The replacement Workspace contains the exact seed materialization and is usable partial output;
  it is not delivery evidence and must not be integrated manually.
- Storage preview classifies the original Task and both recovery Tasks as `protected`, with no
  observed process. Nothing was reclaimed.
- The six authorized resolved Tasks remain untouched:
  `f5d1142a-6eca-4d4c-8c43-801d0b284056`,
  `ed0f3982-1c23-408a-a82f-4bc7ee9c43a5`,
  `03090843-548b-4aec-8271-f5307344b17a`,
  `710135bc-3af5-41da-bc8e-8365c4580f3d`,
  `83ac853d-28bc-401c-a234-aed2f34a494e`, and
  `827ab13b-40ff-469d-be02-2e0c3e3b9e9b`.

## Remaining gap and decision

The smallest continuation would change only the operational path proof so it does not require a
Git repository—for example, derive the two paths from the already digest-bound patch headers and
leave final Workspace path/digest proof to ForkLight's independent Candidate collector. Main could
then explicitly authorize the unused extra Attempt on Task `0ee15d39...`, reuse its same Workspace
and Session, and continue to Grok CLI 4.6 Xhigh native `/goal` without a new Task or Candidate
rewrite.

Post-stop read-only proof confirms that this correction is sufficient and bounded: the exact seed
contains precisely two `diff --git a/baseline/... b/workspace/...` headers, each baseline/workspace
path pair is identical, the set equals the two allowed paths, and the patch has no rename, copy,
binary or Git-binary metadata. Its sha256 remains the frozen digest, reverse-apply still passes in
the protected Workspace, and a baseline/Workspace comparison excluding declared runtime/generated
paths reports only those two files. This proof did not edit the wrapper or Task and did not consume
the extra Attempt.

That continuation was outside the accepted two-round automatic recovery boundary. 一骏 explicitly
authorized the wrapper-only correction and one same-Task extra Attempt on 2026-08-15. Main resumed
Task `0ee15d39...` without a replacement Task while retaining all three Workspaces and forbidding
review, Integration, audit or reclaim until Grok native Goal truth and ForkLight verification.

## Authorized extra Attempt result

ForkLight granted event 18 and resumed the same Task/Session in Attempt
`68faaf51-3ed7-4adb-9400-a442a87c61c5`. The wrapper passed the corrected digest-bound header proof,
recognized the seed as already applied and passed reverse-apply. It then failed before spawning
Grok because `NATIVE_BOOTSTRAP` pointed to
`/Users/yijunwang/code/forklight/goals/forklight-main-led-execution/execution/m2-grok-native-goal/grok-native-goal-bootstrap.mjs`.
The Worker sandbox returned `EPERM` when Node tried to read that source-tree child script.

No Grok native Goal id, Candidate Revision, independent verification, Judge, Main decision,
Integration, audit or reclaim was created. ForkLight Token projection records two missing usage
samples, zero observed gross Worker tokens and no comparable usage; it must not be presented as a
measured zero-cost Grok run. Storage preview keeps Task `0ee15d39...` `protected`, preserves
89,744,921 regenerable bytes and 133,644 durable bytes, reports zero unknown bytes and no process.

The Workspace already contains the exact child bootstrap at the same relative path. It is readable,
executable, passes `node --check`, and matches the source copy sha256
`34cd013af4ddf3e124e1dc2fd6f517eeb312375d70cf170ba50e4f251f6dbfef`. Therefore a `path.join(cwd,
relativePath)` replacement is the complete remaining wrapper correction.

The authorized extra Attempt is consumed, while the Task freezes `baseMaxAttempts: 1`,
`maxExtraAttempts: 1`, `maxMainCorrections: 0` and `maxAdaptationRounds: 0`. Main cannot continue
that Task honestly. The new decision is whether to authorize one final replacement Task after the
workspace-local child path is preflighted. It must reuse the same exact seed and acceptance, use
Grok CLI 4.6 Xhigh native `/goal` with current-model-only, allow no edits, require two fresh Judges,
and have no extra Attempt or replacement fallback. Without that authority, retain every Workspace,
perform no Integration or reclaim, keep M2 open and keep M3 closed.

一骏 granted that exact authority on 2026-08-15. Main reproduced `buildGrokSandboxProfile` with the
failed Task's Workspace, Grok Home, logs, Runtime directory, user Home and temp root. Under that
profile, `node --check` on the Workspace-local child returned 0 while the source-tree child returned
`EPERM`. The wrapper now uses `path.join(process.cwd(), relativeChildPath)`. The final Task contract
freezes one base Attempt and zero extra Attempt, validation repair, correction, reverification and
adaptation; another failure ends this recovery permanently.

## Final no-fallback Task result

Final Task `65876057-5f0c-4676-a5dc-4a80e5425cb0`, Session
`c5d662e4-c5cd-401c-8753-2f91893a11e2`, Attempt
`2b7bb8da-14e2-4eed-b359-9e61f1c4fd6f` crossed all bootstrap checks and created native Goal
`a71f91df-ec00-499e-b852-144f4f8d4bc9`. ForkLight captured exact Candidate Revision
`70daf39b-5acd-42ac-a20f-667d083e3aeb`: digest `48a73c6b6db1071fd62f2dfffa3799df81805cdc1e6d4a46cb163bb9ebdafcda`,
two allowed paths, 181 changed lines and compatible source. Seed identity, reverse-apply, build, 321
focused tests and `git diff --check` all passed independently.

Native Goal state is nevertheless `user_paused`, phase `Executing`, after 508,287 ms. It records
99,777 token high-water, zero classifier runs, zero Worker rounds and zero verifier rounds, and no
`complete` or `achieved` truth. Main bound a `reject` to the exact Attempt, verification sequence
1826, Revision and digest. No Review Graph was created.

ForkLight reports 10 Runtime turns and estimated USD 0.10822778, but official usage is missing.
The Task economics surface therefore correctly reports incomplete Worker volume and a low-
confidence exchange envelope; zero observed gross Worker tokens must not be called measured usage.
Storage preview classifies the final Task `protected/awaiting-required-review`, preserving
132,124,452 regenerable bytes and 2,487,065 durable bytes, with zero unknown bytes and no process.

Per the explicitly authorized final contract, no extra Attempt, validation repair, correction,
reverification, adaptation, replacement, Judge, Integration, audit or reclaim may follow. The exact
Candidate remains reusable evidence but is not delivery. M2 remains open and M3 remains closed.

## Focused native pause root cause

This was not a late process cancel or a misleading `user_paused` guess. Task-local events record:

- `2026-08-15T11:11:00.406Z`: `goal_planner_fired`, attempt 1, model `grok-4.6`;
- the `goal plan writer` subagent ran 508,298 ms, completed one turn and made 56 tool calls;
- its effective tools produced reads, grep and listing, but no file-write call. It attempted five
  `run_terminal_command` invocations to create the exact native plan file; every result was
  `Denied by permission policy: deny rule on bash`;
- `2026-08-15T11:19:28.715Z`: `goal_planner_fail_closed` with `missing_plan_file`, immediately
  followed by `goal_auto_paused` reason `user`;
- durable state has `plan_file: null`, pause message
  `Planning failed; resume with /goal to retry.`, zero classifier/Worker/verifier rounds, and only
  `goal_created` then `goal_paused` history.

Official Grok CLI 1.0.3 source at commit `eb267feff131` confirms the behavior. `run_goal_planner`
fails closed when the required plan file is absent. `maybe_run_goal_planner` maps planner failure to
`GoalPauseReason::User` plus the canonical planning-failed message; the label therefore does not
prove a human interrupt. `setup_goal` still returns a `Start now` reminder after that pause, which
explains why an ordinary turn later inspected the Candidate and emitted success prose while the
native state remained paused.

The concrete incompatibility is the final Task contract: `allowEdits: false`/read-only execution
left the planner without a write tool, while the bootstrap additionally appended `--deny Bash`.
Native Goal planning nevertheless requires one task-local plan artifact. Authentication, elapsed
time, Workspace-local child loading, seed materialization, Candidate tests and current-model-only
identity all succeeded or are independently excluded as this pause cause.

Allowing the planner a write path could address the mechanism, but doing so would modify the frozen
no-Bash/read-only execution boundary. Under the explicit no-fallback decision it is not a correction
available to this recovery. No resume or new Task was launched after this audit.

## New M2 authority after the terminal recovery

一骏 subsequently authorized a new Work Item rather than changing this packet's terminal Task.
The accepted boundary is documented at
`specs/m2-delivery-journeys/work-items/resolved-terminal-storage-native-plan-recovery/spec.md`.
It exposes Grok's native `search_replace/write` only so the Planner can create its Task-local plan,
adds explicit Candidate Workspace `Write/Edit` denials, and keeps terminal/Bash denied. It reuses
the same exact seed but creates new Task truth; no event, Attempt, decision or Workspace of
`65876057-5f0c-4676-a5dc-4a80e5425cb0` is reopened or rewritten.
