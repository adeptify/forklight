# M4-D1 Work Item — storage-lifecycle paired calibration

## User result

Produce one audited JSON decision that tells the local developer which of the three M3-C2
Workspaces must remain protected and which terminal Workspace is regenerable, then form one
same-scope direct/delegated Main Token pair for `forklight-storage-lifecycle`.

## Background and current evidence

Current `forklight storage preview --task` truth says the original M3-C2 Task
`bbec21f9-ae21-4bfd-9cc4-9476aea3f73a` and failed recovery
`588fc40f-afad-448e-8306-e05859166842` are `protected / awaiting-required-review`; the delivered
replacement `68f16585-1fec-447c-8799-4867a4731b0f` is
`reclaimable / integration-delivered`. All three previews report Store integrity `ok/0`, zero
unknown bytes and zero owned processes. This calibration classifies only; it never reclaims.

## `depends_on`

- M4-A through M4-C are integrated and activated.
- `specs/m4-d-representative-main-token-pairs/spec.md` is the accepted parent contract.
- The current storage previews above and `gpt-5.6-sol / xhigh` terminal-usage smoke are complete.
- No other M4-D pair is active. M4-D2 remains blocked until this pair has a durable assessment.

## Inputs and outputs

- Input: `goals/forklight-main-led-execution/execution/m4-calibration/inputs/forklight-storage-lifecycle.json`.
- Shared validator: `goals/forklight-main-led-execution/execution/m4-calibration/validate-artifact.mjs`.
- Output: `goals/forklight-main-led-execution/evidence/m4-calibration/forklight-storage-lifecycle.json`.
- Pair truth: one delegated ForkLight Task id, one comparison id, two complete count-only Codex
  terminal samples, one explicit M4-B assessment and one canonical pair/value report.

The direct and delegated comparison projects are prepared together from the same input and
validator. The direct Codex Main writes only its isolated copy. Grok writes only the delegated
copy, which is independently verified, dual-Judged, Main-accepted and safely integrated there.
Main copies the exact integrated artifact into the Goal evidence path only after the assessment.

## Execution contract

1. Run one isolated direct Codex Main with profile `codex-main-gpt-5.6-sol-xhigh-v1`. It reads the
   supplied evidence, writes the bounded decision and runs the shared validator.
2. Run a separate Codex Main with the same model, effort and terminal-counter method. It admits one
   Grok 4.6 Xhigh native Goal Task through ForkLight, observes durable Task events, creates exactly
   two different-view Judge assignments, records the Main decision and applies exactly one safe
   Integration into the delegated comparison project.
3. Bind both terminal events to that Task and one comparison id. Main checks identical scope,
   acceptance and non-lower delegated quality before recording the M4-B assessment.
4. Stop after the first valid assessment or decision packet. At most one evidence-producing
   validation repair or Main correction is available; there is no extra Attempt, replacement,
   fallback, model switch, Competition or third Judge.

## Allowed and forbidden paths

- Direct writer: only its isolated copy of the family output.
- Delegated Worker: only its isolated copy of the same family output.
- Main operational files: only `goals/forklight-main-led-execution/execution/m4-calibration/`.
- Main durable output after acceptance: only the family evidence JSON plus existing M4 SSOT files.
- Forbidden: product source, tests, Hub/UI, other family artifacts, Provider credentials, Git
  history/remotes, commits, pushes and resets.

## Acceptance and verification

- Both comparison roots start byte-identical for their contract, input and validator, and use the
  same relative output path and command.
- The JSON classifies exactly two protected Tasks and one reclaimable delivered Task, retains the
  current reason/next-action truth, reports zero unknown bytes/processes and makes no reclaim claim.
- Direct validation passes. Delegated ForkLight verification passes the same command, exactly two
  usable different-view Judges review the same Revision, Main accepts that Revision, and safe
  Integration reaches `applied` in the delegated comparison project.
- Both terminal usage events contain all five native Codex counters and no content fields.
- `forklight main-token assess` is called once with the real direct verification reference and
  current delegated Integration operation. A negative saving remains valid evidence and is not
  rerun.

Commands:

```text
node validate-artifact.mjs calibration-input.json goals/forklight-main-led-execution/evidence/m4-calibration/forklight-storage-lifecycle.json
git diff --check
forklight main-token status --task-id <task> --comparison-id <comparison> --json
forklight main-token pair-report --task-id <task> --comparison-id <comparison> --json
```

## Handoff and workspace disposition

Handoff records the two Codex run refs and usage events, direct validator reference, delegated
Task/Attempt/native-Goal/Revision/verification/Review-Graph/Integration ids, pair assessment and
artifact bytes. Preserve both isolated roots and the Task Workspace until those records and the
canonical report are durable. Then the direct roots are temporary regenerable space and the
terminal ForkLight Task follows normal audited storage preview/reclaim; no cleanup is part of this
Work Item.

## Execution outcome — stopped at required review depth

The one authorized comparison completed both Main terminal samples and produced verified one-path
Revision `40f528d5-6799-4e40-b4e7-e8155ffa0426`. Review Graph
`a07feb04-1ca4-4ea5-96c5-f73b4ba52322` returned one usable accept and one schema-invalid opinion,
so Main rejected the exact Revision and created no Integration. The same-Judge repair cannot alter
the unsupported finding severity, and the Work Item forbids replacement/third Judge/replay.
Canonical pair truth is `cannot-determine / incomplete-evidence`; full handoff is
`goals/forklight-main-led-execution/evidence/m4-d-storage-lifecycle-pair-decision-packet.md`.
