# M2-A — Grok 4.6 Xhigh persistent-session truth

## User result

Main can select a saved Grok 4.6 Xhigh Worker Profile and see ForkLight report the execution as
`persistent-session`. An interrupted Task resumes the same Grok session and Task lineage. No CLI,
API, health, preview, event, or inspection surface calls this a native Goal.

## Background and current evidence

- `forklight health --json` is healthy and build-matched, but `local-grok-builder` currently
  resolves to `grok-4.5`, effort `high`, preference/mode `single-run`, with stale connection
  evidence.
- `src/workers/grok.ts` already launches a new Task with `--session-id <task.sessionId>` and a
  resume with `--resume <task.sessionId>`. It emits `worker.started` or `worker.resumed` and keeps a
  Task-local `grok-home`.
- `src/workers/grok.ts` and daemon health truthfully report `nativeGoal: unsupported`; this remains
  correct.
- `src/core/execution-mode.ts` and `src/core/types.ts` currently have only `single-run` and
  `native-goal`, so the existing resumable Grok behavior cannot be named truthfully.
- `grok --help` on this host exposes model selection, `--effort`, `--session-id`, `--resume`, and
  headless streaming output. A real ForkLight Worker launch still must prove that `grok-4.6` with
  `xhigh` is accepted by the installed CLI and signed-in Provider.

## `depends_on`

- None. This is the first M2 implementation Work Item.
- It must be integrated before M2-B because both may touch Task execution truth and shared public
  types. It must be integrated before M2-C because the lifecycle projection consumes the frozen
  execution mode and Runtime-home ownership established here.

## Scope

1. Add `persistent-session` as a closed, truthful requested/effective execution mode.
2. Resolve execution by proven Runtime capability: native Goal first, then persistent session,
   then single run. A forced unsupported mode fails closed. A legacy Task/Profile with no
   preference remains `single-run`.
3. Mark only a Runtime with a proven stable session identity and resume path as supporting
   `persistent-session`; do not infer it from prose or Provider name.
4. Make the Grok adapter and durable events expose that one Task uses one resumable persistent
   Session. Preserve `nativeGoal: unsupported`.
5. Add a saved/default-capable `grok-4.6` model entry and Grok 4.6 Xhigh Worker Profile without
   erasing or silently rewriting legacy persisted Profiles.
6. Project the requested/effective mode consistently through Task parsing, validation, preview,
   readiness, health/status/inspection, CLI, and MCP data already responsible for execution truth.
7. Prove a real Grok 4.6 Xhigh launch through ForkLight. If the Provider rejects the model or
   effort, stop with that exact evidence; do not silently fall back to 4.5, another effort, another
   Provider, or `native-goal`.

## Non-goals

- Do not implement or claim Grok native Goal identity, Goal states, native terminal conditions, or
  cumulative native-Goal usage.
- Do not redesign general routing, Competition, Review Graph, storage cleanup, Hub, or settings UI.
- Do not remove compatibility for existing `single-run`, `auto`, or Codex `native-goal` Tasks.
- Do not add locks, leases, checksums, content addressing, cross-node handshakes, or repeated
  consistency checks. This is one local developer and Main integrates serially.
- Do not read or modify Provider credentials, commit, push, or alter remotes.

## Inputs, outputs, and dependencies

- Inputs: Task/Profile execution preference, selected Runtime/model/effort, immutable Task
  `sessionId`, adapter capability facts, resume intent, current local settings.
- Outputs: frozen requested/effective execution mode, Grok launch arguments, durable start/resume
  mode evidence, health/preview/status projections, a saved Grok 4.6 Xhigh Profile.
- External dependency: the installed signed-in Grok CLI. Its live acceptance is evidence, not a
  value inferred from source code.
- The source project remains unchanged until Main accepts and uses ForkLight Integration.

## Module and file boundaries

Allowed product paths:

- `src/core/types.ts`
- `src/core/execution-mode.ts`
- `src/core/model-catalog.ts`
- `src/core/settings.ts`
- `src/core/worker-profiles.ts`
- `src/core/task.ts`
- `src/core/task-preview.ts`
- `src/core/worker-readiness.ts`
- `src/workers/types.ts`
- `src/workers/grok.ts`
- existing CLI/MCP execution-truth projection files only when required by the shared type
- focused tests for the paths above
- narrowly relevant configuration/operations documentation if behavior would otherwise be
  undiscoverable

Forbidden paths:

- `src/hub/**`
- review, correction, handoff, Integration authority, storage lifecycle, routing, economics, and
  unrelated provider adapters
- current Goal SSOT and other Work Item specs (Main owns them)
- files outside `/Users/yijunwang/code/forklight`

The Worker must stop and return a decision packet if the required implementation needs a forbidden
path or a second semantic source of execution truth.

## Call chain

1. Main selects the Grok 4.6 Xhigh Profile or supplies the equivalent explicit selection.
2. Task admission validates the requested mode against Runtime capability and freezes the effective
   mode.
3. The Grok adapter launches with `--session-id` for the first Attempt.
4. Interruption/recovery reuses the same Task, Workspace, Runtime Home, and session id with
   `--resume`.
5. Durable events and read surfaces report `persistent-session`; native Goal remains unsupported.
6. ForkLight independently runs the unchanged acceptance commands.

## Scenarios

### New Grok persistent Task

Given a valid Grok 4.6 Xhigh Profile, when Main submits a Task, then the frozen mode and every
public execution projection say `persistent-session`, the launch uses one Task session id, and no
surface says native Goal.

### Resume after interruption

Given a Grok Task with a prior interrupted Attempt, when Main resumes it without changing the
contract, then the adapter uses `--resume` with the original Task session id, records
`worker.resumed`, preserves the Workspace, and does not create a replacement Task.

### Unsupported forced mode

Given a Runtime without the requested execution capability, when Task/Profile validation runs,
then it fails before Worker launch with a bounded explanation and never falls back silently.

### Legacy compatibility

Given a stored Task or Profile with no execution preference, when it is read or resumed, then it
retains historical `single-run` semantics rather than being reinterpreted by new defaults.

### Live model rejection

Given this host cannot launch `grok-4.6` at `xhigh`, when the real Worker smoke runs, then the Work
Item stops with Provider/Runtime evidence and no automatic model, effort, or Runtime switch.

## Acceptance criteria

- A Grok 4.6 Xhigh Profile validates and materializes exactly that Runtime/model/effort.
- `persistent-session` is accepted only where supported and is frozen into new Task records.
- Grok `auto` resolves to `persistent-session`; forced `native-goal` remains rejected.
- First launch and resume arguments use the same Task session id with `--session-id` then
  `--resume`.
- Health, preview, status/inspection and durable Worker start/resume evidence agree on the mode.
- Legacy omitted preferences still resolve to `single-run`; Codex native Goal behavior is unchanged.
- A real ForkLight Grok 4.6 Xhigh Task either reaches independent verification or yields one exact
  launch blocker without fallback.
- No Hub change, credential access, commit, push, or unrelated refactor appears in the Candidate.

## Verification commands

Worker/ForkLight acceptance:

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/task.test.ts tests/task-preview.test.ts tests/worker-profiles.test.ts tests/worker-readiness.test.ts tests/worker-runtime.test.ts tests/cli-health.test.ts
git diff --check
```

Each acceptance command may run for up to 30 minutes in the local development settings. The
Worker itself has no absolute wall-clock or Token completion limit; Main wait/transport expiry
ends only that observation call and must not change or recreate the Task.

Main post-Integration live evidence:

```text
node dist/src/cli.js health --json
node dist/src/cli.js doctor --json
```

Main then submits one real bounded Grok 4.6 Xhigh Task and, if an interruption occurs, resumes that
same Task. The live Provider run is not replaced by a synthetic unit test.

## Review and handoff

- This changes Runtime/recovery truth, so use two independent read-only Judges after ForkLight
  verification, preferably with different Runtime/model viewpoints.
- Judges inspect this spec, the exact Candidate Revision, verification evidence, legacy behavior,
  and the absence of native-Goal overclaiming. They do not edit or authorize Integration.
- If a verified gap remains, return only that gap to the same Grok Session while the spec remains
  valid. After two purposeful rounds with the same failure/no new evidence, stop.
- Final handoff contains: Task/Attempt ids, mode/model/effort, Candidate Revision, affected paths,
  verification results, Judge results, remaining risk, and workspace disposition.

## Workspace disposition

- Protect the full isolated Workspace, baseline, Grok Home, logs, Candidate Revision, and diff
  while running, interrupted, verifying, under Judge review, or awaiting Main decision.
- After accepted Integration and durable Task/Judge/Integration evidence, M2-C may reclaim the
  regenerable Workspace, baseline, Grok Home, verifier state, and cache. Until M2-C exists, retain
  them.
- On a reusable partial result, retain the full Workspace until selected paths/gaps are durably
  handed off. Never delete the only Candidate copy.

## Assumptions, risks, and stop conditions

- Assumption: the installed Grok CLI's `--session-id`/`--resume` behavior is stable enough to prove
  persistent-session, but not native Goal.
- Risk: changing `auto` could reinterpret legacy records. Mitigation: only new Tasks freeze new
  resolution; missing persisted preference keeps `single-run`.
- Risk: default code changes do not replace a user's persisted Profile array. Main applies one
  explicit settings update after Integration if the current local Store still lacks the Profile.
- Stop on Provider model rejection, repeated resume failure without new evidence, source drift,
  forbidden-path need, or any design that requires calling persistent Session a native Goal.
