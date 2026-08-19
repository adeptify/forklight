# M2 non-Coding recovery — handoff destination execution truth

## User result

A direct Goal or Competition Candidate handoff creates a successor whose immutable execution
preference and mode describe the selected destination Worker Profile and Runtime. A Grok source
can hand off to Claude Code without the successor falsely claiming Grok-only persistent Session
execution, and every public Task/decision surface remains truthful before review or Integration.

## Background and evidence

The non-Coding Goal stopped before successor review or documentation Integration. Source Grok Task
`fd41a1dc-ca0e-4918-8002-f9932908c35d` truthfully froze `auto -> persistent-session`. Its supported
one-hop DeepSeek Flash successor `91d34265-fdca-4623-8aa1-646c90ff1e36` instead stores:

- `workerProfileId: deepseek-flash-1m`;
- `provider/runtime: deepseek/claude-code`;
- `executionPreference: auto`;
- `executionMode: persistent-session`.

Canonical capability truth in `src/core/execution-mode.ts` resolves Claude Code `auto` to
`single-run`. Focused tracing found that `buildHandoffSuccessorSpec` clones the already-frozen
source Task, replaces destination Provider/Runtime/Profile, and retains the source execution
fields. `buildSuccessorTask` then stores that spec directly rather than running normal Task parsing.

This is a concrete cross-Runtime handoff admission defect, not a multi-user or distributed
coordination concern. 一骏 explicitly authorized this narrow product fix on 2026-08-14. Exact stop
evidence remains in
`goals/forklight-main-led-execution/evidence/m2-noncoding-handoff-execution-mode-stop-decision-packet.md`.

## `depends_on`

- M2-A, M2-B, M2-C and the Coding delivery journey are graduated and remain unchanged.
- The stopped non-Coding Goal, original Task, one-hop handoff, successor Task, Candidate, verifier,
  and Main revise event remain immutable durable evidence.
- Current source and build-matched Daemon identity must be `matched`; `forklight health --json`
  must show Grok 4.6 Xhigh launchable, and its prior real non-Coding Task is the current launch proof.
- The exact documentation Candidate recovery is blocked until this Work Item is accepted by two
  Judges, Main-integrated through ForkLight, activated, and passes every serial zero-change audit.

## Inputs and outputs

Inputs:

- the stopped successor identity and exact Main revise evidence;
- `src/core/candidate-handoff.ts`, normal admission in `src/core/task.ts`, canonical helpers in
  `src/core/execution-mode.ts`, and direct store behavior in `src/core/runner.ts`;
- existing direct Goal and Competition handoff tests plus normal execution-mode/runtime tests.

Outputs:

- one bounded product Candidate that freezes successor execution truth from the destination
  selection and Runtime capabilities;
- focused direct Goal and Competition regression evidence, including the authentic Grok-to-Claude
  mismatch and legacy destination behavior;
- independent verification, exactly two usable read-only Judge opinions, Main's exact-Revision
  decision, safe Integration, activation, and three serial zero-change audits.

## Required behavior and decisions

- `buildHandoffSuccessorSpec` must treat the resolved destination selection as the sole authority
  for successor execution preference. A destination Profile omission resolves and explicitly
  freezes `single-run` on the new successor; field absence remains reserved for genuinely old
  stored Tasks. An explicit destination preference is preserved.
- The successor mode must be resolved through the existing canonical Runtime capability helper:
  destination `auto` resolves Claude Code to `single-run`, Grok Build to `persistent-session`, and
  Codex CLI to `native-goal` only under its already-proven contract.
- Forced unsupported modes continue to fail closed during destination selection before durable
  handoff mutation. No silent fallback is added.
- Source Task execution fields, Candidate, Attempts, handoff origin, reusable paths, review
  requirement, network policy behavior, effective advanced policy, and one-hop/replay semantics
  remain unchanged.
- Do not reparse or rewrite historical Tasks. No Store migration or backfill is needed: the fix
  applies to newly authorized successor Tasks only.

The adjacent stopped Task also exposes a source-bound `qualityPolicy.profileId`. This Work Item
does not change Quality policy because the accepted blocker and user result are execution truth;
the finding remains Later unless Main separately proves it blocks a Milestone result.

## Writable paths and orthogonality

The implementation Worker may change only:

- `src/core/candidate-handoff.ts`
- `tests/competition.test.ts`
- `tests/goal.test.ts`

`src/core/task.ts`, `src/core/execution-mode.ts`, `src/core/worker-profiles.ts`,
`src/core/runner.ts`, `tests/task.test.ts`, and `tests/worker-runtime.test.ts` are read-only inputs
and verification surfaces. No other product Writer runs concurrently. Main reviews and integrates
serially.

The later exact documentation recovery is physically disjoint, but it depends on this activated
admission truth and its audits. The two Work Items are therefore not orthogonal and must run in
strict order rather than parallel.

## Forbidden paths and non-goals

- No documentation Candidate, Store data, Task record, Revision artifact, Goal history, quality
  policy, review policy, routing snapshot, delivery policy, Runtime adapter, Profile setting,
  daemon protocol, CLI/MCP command, storage lifecycle, Hub/UI, or other repository change.
- No second-hop handoff, retry, replay, historical relabeling, manual source patch, generated
  output, commit, push, remote, or Provider credential handling.
- No lock, lease, checksum, content-addressed manifest, version handshake, migration, duplicate
  validator, multi-user consistency, distributed coordination, or general handoff redesign.

## Acceptance and review

- A focused regression reproduces the stopped lineage shape: source `grok-build` with
  `auto -> persistent-session`, destination DeepSeek/Claude Code with `auto`, and a newly stored
  successor with `auto -> single-run` while the source remains unchanged.
- The shared builder also proves destination capability projection for Grok and Codex `auto`, and
  destination Profile omission explicitly freezes both preference and mode as `single-run`.
- Both direct Goal and Competition handoff entry paths retain their existing one-hop, idempotency,
  selected-path materialization, policy, and lineage behavior.
- ForkLight independently passes build, the accepted focused tests, and diff validation. Candidate
  paths are exactly within the three-path writable boundary and `dist/**` stays generated-only.
- One fresh Review Graph uses two different-view read-only Judges. Both opinions must be usable and
  bound to the exact current Revision. Main independently inspects the full diff, canonical
  capability use, compatibility, test meaning, and scope before accepting.
- A failed command, non-usable or blocking Judge opinion, source drift, historical mutation,
  product-boundary expansion, or second purposeful no-evidence round stops this Work Item without
  another Task, extra Judge, model switch, Competition, or compensating patch.

## Verification commands

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/competition.test.ts tests/goal.test.ts tests/task.test.ts tests/worker-runtime.test.ts
git diff --check
```

ForkLight's local verifier keeps the 30-minute per-command safety breaker. The Work Item has no
absolute wall-clock deadline, Token ceiling, no-progress timeout, hard file limit, or hard changed-
line limit. Main runs `npm run check` after accepted high-risk Integration, not as activity proof.

## Handoff and workspace disposition

Handoff must name the operational Goal and Task, exact Worker Profile/Runtime/model/effort,
truthful execution mode, Attempts, Candidate Revision/digest/paths, verification, two Judge
opinions, Main decision, Integration operation, activation identity, audits, and any exact stop
reason. It must not expose credentials, private Home data, raw logs, or source bytes.

Protect the Workspace, Candidate, verifier and reviews while running, under review, unresolved, or
reusable-partial. After accepted Integration and audits, use ForkLight storage audit/preview for
ordinary eligible regenerable space while retaining durable evidence. Do not reclaim the original
non-Coding or current stopped successor Workspaces under this Work Item.
