# M4-D2 Work Item — worker-runtime paired calibration

## User result

Produce one bounded JSON lineage proving what actually happened in the accepted M3-C2 Grok native
Goal delivery, without calling either failed predecessor a resume, then form one same-scope
direct/delegated Main Token pair for `worker-runtime`.

## Background and current evidence

The accepted delivery is Task `68f16585-1fec-447c-8799-4867a4731b0f`, Session
`a218f235-4a26-4514-affe-45953cd75b22`, Attempt
`6e4afaf2-e140-4c80-b48d-1c7e4c92a2c2` and fresh native Goal
`847f8b7c-afdd-42ed-be1a-5fdb893614f1`. Goal state is `complete / Idle`, classifier `achieved`,
with one Worker round. ForkLight verification event `3023` passed, Review Graph
`8a2ebcf3-675c-496e-8f4a-44c918a9c5fe` has two usable accepts, Main review event `3030` accepted
Revision `5d3ee57c-be94-48ee-bdc2-458dcadc302c`, and Integration
`a0d07d2d-2261-4036-ba65-da124663567c` completed at event `3040`.

The original Task `bbec21f9-ae21-4bfd-9cc4-9476aea3f73a` used a different native Goal and failed
after a Provider connectivity/authentication error. Recovery Task
`588fc40f-afad-448e-8306-e05859166842` failed before native Goal state existed. Neither is the
accepted Goal's resumed identity.

## `depends_on`

- M4-D1 has a durable direct/delegated usage pair, assessment and family report or a terminal
  decision packet.
- The M3-C2 Task, Goal-state, verification, review and Integration evidence above remains readable.
- No other M4-D pair is active. M4-D3 remains blocked until this pair has a durable assessment.

## Inputs and outputs

- Input: `goals/forklight-main-led-execution/execution/m4-calibration/inputs/worker-runtime.json`.
- Shared validator: `goals/forklight-main-led-execution/execution/m4-calibration/validate-artifact.mjs`.
- Output: `goals/forklight-main-led-execution/evidence/m4-calibration/worker-runtime.json`.
- Pair truth: one delegated Task/comparison identity, two count-only Main samples, one M4-B
  assessment and one canonical report.

## Execution contract

Use the same serial direct/delegated method, Main profile
`codex-main-gpt-5.6-sol-xhigh-v1`, Grok 4.6 Xhigh native Goal, two different-view Judges and safe
comparison-project Integration defined by M4-D1. Both sides receive the same evidence, task text,
relative output path and validator. Direct Main analyzes the lineage itself; delegated Main
supervises one ForkLight Worker and does not produce the artifact on the Worker's behalf.

One bounded validation repair or Main correction may close one concrete accepted gap. There is no
extra Attempt, replay, replacement, fallback, model switch, Competition or third Judge. A negative
pair result is recorded once rather than rerun.

## Allowed and forbidden paths

- Writers may touch only their isolated `worker-runtime.json`.
- Main may update only the M4 calibration execution directory, this family evidence JSON and
  existing Goal SSOT after acceptance.
- No product source/tests, historical Task/Goal state, Hub/UI, credentials, Git remotes, commits,
  pushes or resets may change.

## Acceptance and verification

- The artifact reports the exact accepted Runtime/provider/model/effort, Task, Session, Attempt,
  Goal id, terminal Goal state/classifier, verification, two-Judge graph, Main accept, Revision and
  Integration ids.
- It explicitly labels both predecessors as separate failed Tasks and `resumed: false`; the failed
  bootstrap is not assigned a native Goal id.
- It reports no new Runtime action and contains no private absolute paths, prompt/response text or
  credentials.
- Direct validation and delegated independent validation pass the same command; dual Judge, Main
  accept and safe Integration truth are current.
- Both complete terminal usage events bind to the same delegated Task/comparison identity, and Main
  records exactly one explicit assessment.

Commands:

```text
node validate-artifact.mjs calibration-input.json goals/forklight-main-led-execution/evidence/m4-calibration/worker-runtime.json
git diff --check
forklight main-token status --task-id <task> --comparison-id <comparison> --json
forklight main-token pair-report --task-id <task> --comparison-id <comparison> --json
```

## Handoff and workspace disposition

Handoff includes both measured Main runs, the delegated quality chain, exact artifact and pair
assessment. Preserve comparison roots and Task Workspace through durable report generation; later
preview/reclaim may remove only regenerable terminal space. Historical M3-C2 Tasks retain their
existing independent storage dispositions and are never reclaimed by this calibration.

## Execution outcome — valid pair, delegated Main higher

The one comparison produced byte-identical direct/delegated artifacts and exact Revision
`2a742c97-abff-4319-9292-475764378fbf`. Independent verification, two usable different-view
accepts, Main accept and Integration `aae1189c-dd73-4c2a-bc3b-c76e42def29c` passed. M4-B
assessment `mpa-417947aa-42ff-4e7d-8619-dec5aa14f0b5` accepted the equivalence/quality gates.

Direct Main used 152,271 gross Tokens; delegated Main used 2,401,089. The valid pair therefore
reports `saving.status: higher` and the family remains `cannot-determine / not-strictly-positive`.
No rerun is allowed. Full evidence is
`goals/forklight-main-led-execution/evidence/m4-d-worker-runtime-pair-delivery.md`.
