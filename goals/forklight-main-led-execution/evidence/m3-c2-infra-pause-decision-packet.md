# M3-C2 infra-pause decision packet

Date: 2026-08-17 (Asia/Shanghai)

## Current truth

- ForkLight Task: `bbec21f9-ae21-4bfd-9cc4-9476aea3f73a`
- Session: `2c79cd11-60aa-489f-8678-50b3102b3210`
- Attempt: `b5adbe28-964d-4e7b-b487-969617c3f178`
- Grok native Goal: `9b022da8-45a9-46de-be6a-c104272fcf94`
- Runtime result: `infra_paused / Executing`, classifier `not_achieved`
- Task result: failed as `connectivity`; no Worker completion claim, Candidate Revision,
  ForkLight verification, Review Graph, Main decision or Integration exists.

The Task was not canceled by a Main observation or wall-clock limit. Grok 4.6 Xhigh produced
effective activity for 75 turns over about 43 minutes, then the CLI proxy returned HTTP 401
`Invalid or expired credentials`. ForkLight preserved the Workspace and correctly skipped its
automatic validation repair because the Worker did not return normally.

## Reusable output

The protected Workspace contains 14 accepted C2 paths and no path outside the accepted writer
surface. Relative to its Task baseline it has 1,904 added and 11 deleted lines, inside the accepted
15-file/2,400-line warning budget:

- `src/core/statistics.ts`
- `src/core/model-routing.ts`
- `src/core/strategy-advice.ts`
- `src/daemon/coordinator.ts`
- `src/cli/routing-output.ts`
- `src/mcp/server.ts`
- `tests/statistics.test.ts`
- `tests/model-routing.test.ts`
- `tests/competition.test.ts`
- `tests/review-graph.test.ts`
- `tests/main-failure-attribution.test.ts`
- `tests/daemon.test.ts`
- `tests/daemon-cli.test.ts`
- `tests/mcp.test.ts`

The implementation already keeps existing Worker ranking mode-free while adding parallel
provider/model/Runtime/effort/execution-mode evidence, explicit `legacy-unknown`, an additive
strategy/policy projection, Main-direct separation, underlying Judge identity diversity and
Daemon/CLI/MCP output. Focused whitespace inspection is clean.

## Diagnostic verification

Main ran the accepted build and focused tests only inside the protected Task Workspace; this is
diagnosis, not ForkLight independent acceptance.

- `npm run build`: failed on two new `tests/daemon.test.ts` fixture typing errors. One helper passes
  a broad `TaskStatus` where `AttemptStatus` is required; one `CompetitionMainDecision` fixture
  omits its required `reason` and `createdAt`.
- The original eight-file focused test command runs 557 tests: 556 pass and one new legacy CLI
  assertion fails. Its `doesNotMatch` pattern matches the desired negative explanations
  “History does not start a Competition” and “no inferred requirement”; the implementation output
  is not demonstrating automation.
- `git diff --check` equivalent whitespace inspection across the 14 baseline/Workspace paths is
  clean.

These are three narrow test defects. The suite has not yet reached a passing independent build,
and later verification may still expose another real failure.

## Main scoped-diff findings

The partial product behavior also has accepted-contract gaps that must be corrected before a
Candidate is reviewable:

1. With Competition intent `none`, the JSON currently still summarizes scoped historical
   Competition counts and outcomes. M3-C requires history not to be evaluated until Main supplied
   `consider` or `required` with valid triggers; intent `none` must return not-advised without
   historical evaluation.
2. For `consider`/`required`, current history matching filters only task scope and does not require
   a compatible valid trigger. Irrelevant historical Competition reasons can therefore appear as
   matching evidence.
3. `legacy-unknown` rows are visible as required but can currently enter the recommendation
   cohort. An unknown historical mode is not an executable strategy and must remain display-only,
   never be recommended or guessed into a real mode.
4. The strategy scorer should preserve the accepted routing policy's strict missing-evidence gate;
   unavailable positive factors must not yield a strict-mode recommendation.

All four gaps stay inside the existing C2 modules and require focused regression cases. No new
endpoint, entity, migration, automatic work or coordination mechanism is needed.

## Stop and decision

The accepted Task froze one base Attempt and no generic extra Attempt. That Attempt is consumed;
the remaining validation-repair and Main-correction allowances cannot start because no normal
Worker return or Candidate Revision exists. Main will not edit the Workspace, fabricate a
Revision, switch Runtime/model, create Judges or submit a replacement Task automatically.

Read-only recovery feasibility disproves the initial same-Task proposal. This Task freezes
`maxExtraAttempts: 0`, and `authorizeExtraAttempt` fails closed when that value is zero. Its
`maxAdaptationRounds: 0` also makes the read-only attempt-budget adaptation preview return
`adaptation-disabled`. Main correction is independent of the extra-Attempt budget, but it requires
a Candidate Revision; none exists because the Worker never returned normally. Therefore no
existing ForkLight mutation can resume this failed Task or its paused Goal without violating the
frozen contract.

Recommended recovery after Grok CLI authentication is restored: explicitly authorize one new
one-shot protected-partial recovery Task. A Main-owned bootstrap may materialize exactly these 14
Workspace paths onto the current source after the smallest wrong-source/path-set check. Grok 4.6
Xhigh then starts a fresh honest native Goal, corrects only the three diagnostic test defects and
four scoped contract gaps above, and runs the unchanged quality chain. The recovery should allow
one base Attempt, at most one validation repair and one Main correction, no generic extra Attempt,
adaptation, fallback or further replacement, the same 14 writable paths, two different-view
Judges and Main serial Integration. It preserves the partial bytes but cannot truthfully claim to
resume the old Task/Session/Goal.

Workspace disposition: protect as the exact seed source until this decision is made.

## Authorized recovery outcome

一骏 later reported Grok re-login and explicitly authorized the recommended one-shot recovery.
Preflight established:

- `forklight health --json` was healthy with matched Daemon/client identity;
- a direct Grok 4.6 Xhigh request returned `M3_C2_RECOVERY_AUTH_OK`;
- the old baseline-to-Workspace product/test delta still named exactly the 14 accepted paths;
- current product/test source still matched the old Task baseline;
- operational bootstrap policy test, whitespace check and Task validation passed; the Task
  resolved a fresh `native-goal`, one base Attempt, no extra Attempt/adaptation/fallback/replacement,
  at most one validation repair and one Main correction/reverification, and two Judges.

ForkLight admitted recovery Task `588fc40f-afad-448e-8306-e05859166842`, Session
`39f770e6-58d0-4b81-8cd8-b96dfbab869a`, Attempt
`1861dff6-316b-410f-b386-b8876f5230e0`. It stopped before Grok created native Goal state. Exact
Task-local stderr is:

```text
Error: EPERM: operation not permitted, scandir
'/Users/yijunwang/Library/Application Support/ForkLight/runs/
bbec21f9-ae21-4bfd-9cc4-9476aea3f73a/baseline/src'
```

The wrapper process is already inside Grok's Workspace sandbox. Its source-base/path-set logic was
valid when run by Main, but the Runtime process cannot read a sibling protected Task path. The
direct authentication smoke therefore remains valid; it was not evidence for cross-Workspace
filesystem permission.

No seed byte was copied. The failed recovery Workspace has no materialization marker, no
product/test delta relative to the old baseline, and no Grok session or Goal state beyond copied
authentication files. There is no Worker claim, Candidate Revision, verification, Review Graph,
Main decision or Integration. No related process remains. The original 14-path partial is
unchanged and protected.

This one-shot recovery consumed its only base Attempt. Automatic validation repair was skipped
because the Worker did not return normally; Main correction remains ineligible without a Candidate;
extra Attempt and adaptation are frozen at zero. Main does not edit the failed Workspace, force a
resume or infer another replacement. The smallest next representable option is one newly
authorized Task with the exact partial packaged as a Workspace-local patch before Grok launches.
That changes only operational seed location; the same seven gaps, 14 writable paths, original
acceptance, two Judges and serial Integration remain the product boundary.

Workspace disposition: protect the original partial and this failed Workspace pending that
decision.

## Workspace-local seed feasibility

Main then completed one read-only feasibility check without creating an artifact or Task. A
combined binary patch stream generated from the protected baseline/Workspace for the exact 14
paths:

- forward-applies with `git apply -p2 --check` to current source;
- reverse-applies with `git apply -p2 --reverse --check` to the protected partial Workspace;
- reports exactly 14 files, 1,904 insertions and 11 deletions.

This proves the same bytes can be packaged under the accepted execution directory and copied into
a future Task Workspace by normal snapshot preparation. A wrapper can then read
`<current Workspace>/goals/.../m3-c2-protected-partial.patch`, which is inside Grok's sandbox, and
apply it before the native Goal starts. The already delivered M3-B recovery used that exact
Workspace-local pattern successfully. No external Task path, broader filesystem permission,
checksum, lock, lease or product change is needed.

No patch file, replacement contract, Store record or Workspace mutation was created by this
check. Submission remains gated on new explicit replacement authority.

## Continuing authority and Workspace-local replacement

一骏 later granted full authority for subsequent Goal tasks and requested continuous progress.
Main persisted the exact verified stream as
`execution/m3-wave-3/m3-c2-protected-partial.patch`, added the focused Workspace-local bootstrap
and test, and admitted operational contract
`execution/m3-wave-3/03-m3-c2-workspace-local-seed-replacement.yaml`.

Preflight passes exact path parsing, current-source forward apply, old-partial reverse apply,
wrapper policy, whitespace, Task quality 100, clear Workspace boundary, fresh `native-goal`
resolution and build-matched health. ForkLight Task
`68f16585-1fec-447c-8799-4867a4731b0f`, Session
`a218f235-4a26-4514-affe-45953cd75b22`, is now the only M3-C2 Writer. Its source snapshot carries
the seed before Grok's sandbox starts; neither Runtime nor wrapper reads a sibling Task path. The
two failed Tasks remain immutable and protected.

Live evidence confirms the Workspace marker contains exactly the authorized 14 paths and native
Goal `847f8b7c-afdd-42ed-be1a-5fdb893614f1` is durably `active / Executing`. Effective Grok model
events continued past five minutes. This closes the operational seed/bootstrap gap; product
acceptance remains pending the normal Worker return and independent verifier.
