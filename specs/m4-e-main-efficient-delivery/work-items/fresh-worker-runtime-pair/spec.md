# M4-E post-activation Work Item — fresh worker-runtime checkpoint pair

## User result

Produce exactly one fresh, meaningful, non-replay `worker-runtime` Main Token pair using the
activated `delivery prepare` and `delivery decide` checkpoints. The pair answers one question:
does the checkpoint path let the same `gpt-5.6-sol / xhigh` Main complete an equal-quality
worker-runtime delivery with strictly fewer gross Main Tokens than doing the same bounded work
directly?

If the answer is not strictly positive, M4 stops with the durable result. No second family,
replacement comparison or favorable rerun is admitted.

## Background and current evidence

M4-D's valid worker-runtime pair projected the older M3-C2 delivery and measured delegated Main
2,401,089 versus direct Main 152,271 gross Tokens. It is immutable negative evidence and will not be
replayed. M4-E has since activated two resumable decision-boundary calls specifically to remove the
repeated Main observation/context chain that dominated that run.

The fresh subject is the newly delivered M4-E Task
`3e2740eb-4c4e-4a55-9a80-86c51c35a5b5`, not M3-C2. Both sides project its exact current durable
Runtime, native Goal, verification, dual review, Main decision, fresh receipt and Integration truth
into a new bounded artifact. This closes required M4 graduation evidence; it is not ceremonial
dogfood, test-count work or a model ranking.

## `depends_on`

- M4-E delivery is activated and evidenced in
  `goals/forklight-main-led-execution/evidence/m4-e-main-efficient-delivery.md`.
- `npm run check` passes 3,084/3,084 and client/Daemon identity is matched.
- Grok 4.6 Xhigh is launchable as native Goal; the same explicit Main profile
  `codex-main-gpt-5.6-sol-xhigh-v1` is available to both comparison sides.
- No other M4 calibration or Writer is active. M5 remains closed.

## Inputs

- Accepted bounded input:
  `goals/forklight-main-led-execution/execution/m4-calibration/inputs/worker-runtime-checkpoint.json`.
- Existing closed validator:
  `goals/forklight-main-led-execution/execution/m4-calibration/validate-artifact.mjs`.
- The accepted M4-D same-source/same-profile/terminal-counter measurement method.
- Current ForkLight Task/Review/Integration evidence named in the bounded input; Workers receive no
  Store, source-project, private-history or credential access.

## Outputs

- Direct and delegated isolated roots with byte-identical input, validator and empty output base.
- One direct Main terminal usage event and one delegated Main terminal usage event, both bound to
  the new delegated Task and one new comparison id.
- One independently verified, dual-Judged, Main-decided and safely integrated delegated artifact:
  `goals/forklight-main-led-execution/evidence/m4-calibration/worker-runtime-checkpoint.json`.
- One explicit M4-B pair assessment and canonical read-only pair/value report.
- One compact delivery or stop packet. A non-positive valid pair is a completed result, not a
  reason to rerun.

## Execution and exact checkpoint use

### Direct side

One isolated Codex CLI Main using `gpt-5.6-sol / xhigh` reads the bounded input, writes the exact
single artifact, runs the shared validator and `git diff --check`, and stops. It never calls
ForkLight or changes the real project.

### Delegated side

A separate isolated Codex CLI Main with the same model, effort and terminal-counter method does not
write the artifact. It makes only these two public authority-bearing calls:

1. one `delivery prepare --task-file ...` with the exact two reviewer Profiles, a one-hour
   observation window and a bounded included Diff; the call may submit/observe the one Task and
   exact Review Graph but cannot decide;
2. after inspecting the returned Candidate/Diff and current two-Judge evidence, one exact
   `delivery decide ... --decision accept` with the returned Revision/digest and a one-hour
   observation window.

An observation timeout permits exact re-entry of the same checkpoint only; it never cancels,
recreates or widens the Task. The delegated Main may not fall back to granular submit/wait/inspect,
Review Graph, main-review, preflight or apply calls. A real blocker stops the unit.

## Allowed paths

- Direct and delegated Writers: only their isolated
  `goals/forklight-main-led-execution/evidence/m4-calibration/worker-runtime-checkpoint.json`.
- Main operational files: this accepted Spec and
  `goals/forklight-main-led-execution/execution/m4-calibration/` input/preparation files.
- After acceptance, Main may copy the exact delegated artifact into the same existing Goal evidence
  directory and update only the existing Goal SSOT/evidence index.

## Forbidden paths and non-goals

- No product source/tests, M4-E implementation, historical Store truth, old comparison artifact,
  Hub/UI, routing, Worker Profile, Provider credential, Git remote, commit, push or reset change.
- No second output, model switch, Competition, third Judge, whole-pair replay, automatic
  replacement or additional family calibration.
- No checksum/content-addressed manifest, lock, lease, version handshake, caller token or
  distributed coordination. Byte equality of the two prepared roots exists only to prevent the
  concrete wrong-source comparison failure.
- No saving claim from exchange receipts, missing counters, lower quality or an incomplete pair.

## Acceptance

1. The comparison is new: new Task class, new comparison id, new M4-E subject facts and new output
   path; no old M4-D Task/sample/assessment is reused as the pair.
2. Direct/delegated roots have byte-identical input, validator and empty output base. Both receive
   the same task text, output path and acceptance commands.
3. Both Main sides use `gpt-5.6-sol / xhigh` and provide complete native Codex terminal counters.
4. Direct validation passes. Delegated Candidate changes exactly one path, passes ForkLight's same
   validator and diff check, receives two usable different-view Judge results, exact Main decision
   and safe Integration in the comparison project.
5. The delegated Main evidence shows `delivery prepare` and `delivery decide` as the only ForkLight
   delivery-boundary calls it used; no granular fallback or Task recreation occurred.
6. The integrated artifact exactly matches the bounded input, contains no private path/prompt/
   credential, and states that the projection itself made no Runtime mutation.
7. Main records one explicit M4-B assessment only after direct validation and delegated delivery
   are current. The canonical report keeps Worker Token/cost/time separate from Main Token.
8. Strictly positive means direct gross Main Tokens minus delegated gross Main Tokens is greater
   than zero at same scope, same acceptance and delegated quality not lower. Zero, higher,
   incomplete or invalid stops further calibration and leaves M5 closed.

## Verification commands

In each isolated root:

```text
node validate-artifact.mjs calibration-input.json goals/forklight-main-led-execution/evidence/m4-calibration/worker-runtime-checkpoint.json
git diff --check
```

For the delegated Task and pair:

```text
forklight main-token status --task-id <task> --comparison-id <comparison> --json
forklight main-token pair-report --task-id <task> --comparison-id <comparison> --json
forklight value-report --families '["worker-runtime"]' --comparisons '["<comparison>"]' --json
```

The Worker has no absolute duration or Token ceiling. ForkLight acceptance commands retain the
local 30-minute per-command safety breaker. Main checkpoint observation windows are one hour and
remain observation-only.

## Handoff and workspace disposition

Handoff names both Codex run refs and terminal counters, direct validator evidence, delegated
Task/Attempt/native Goal/Revision/verification/Review Graph/receipt/Integration, exact artifact
bytes, assessment and pair result. Preserve both comparison roots and the ForkLight Workspace until
the assessment and compact evidence are durable. Then normal storage preview may reclaim only
regenerable terminal space; this Work Item performs no historical or manual reclaim.

One purposeful validation repair or same-Worker Main correction may be used only for a concrete
accepted artifact gap. Repeated failure, missing terminal counters, quality/scope drift, granular
fallback need or non-positive valid result stops the Work Item; there is no replacement pair.

## Pre-admission delegated sandbox smoke

The first delegated Codex invocation ended before ForkLight admission because its default
workspace sandbox could not access ForkLight's local Daemon/Store path. It produced one terminal
counter event but no Task, Candidate, Review Graph, sample or comparison identity; it is retained as
transparent harness-smoke cost and is not relabeled as a valid delegated sample.

Before the one measured delegated run, Main corrects only the harness boundary: keep
`workspace-write`, add the exact local ForkLight Home as the one additional writable root and allow
the sandboxed shell's local control-plane connection. Do not add the source project as writable and
do not use full-access/bypass mode. The prompt and two-checkpoint restriction are unchanged. This is
pre-admission correction, not a Task/pair replay. If that one measured run cannot admit the Task or
returns another sandbox blocker, stop the Work Item; do not widen permissions or start another run.

## Outcome

Delivered on 2026-08-18. The measured delegated run used only `forklight_delivery_prepare` and
`forklight_delivery_decide`; its one Grok native Goal Candidate passed independent validation, two
usable Judges, exact Main accept and safe isolated Integration. The direct and delegated artifacts
are byte-identical.

ForkLight assessment `mpa-ae1799a1-7958-4c99-8549-3a8f131a0da7` accepts equal scope, equal
acceptance and delegated quality not lower. Direct Main used 171,984 gross Tokens; delegated Main
used 155,804. Canonical saving is 16,180 Tokens / 9.407851893199368%. The disclosed failed
pre-admission sandbox smoke is not a sample. Exact evidence:
`goals/forklight-main-led-execution/evidence/m4-e-fresh-worker-runtime-pair-delivery.md`.
