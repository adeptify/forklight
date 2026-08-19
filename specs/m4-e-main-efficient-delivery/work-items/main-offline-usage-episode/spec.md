# M4-E continuation Work Item — Main-offline delivery usage episode

## User result

Let Main end a model session while a long ForkLight Task or its Judges continue, resume only at a
meaningful delivery checkpoint, and still capture every resumed Main session in one auditable Main
Token role total. Long Worker duration must no longer force repeated unchanged model polling, and
no earlier Main work may be omitted to make a pair look favorable.

This preserves the current M4 exit requirement. It does not relabel or replay the valid negative
storage pair and does not authorize Hub/M5.

## Background and current evidence

The fresh storage pair passed equal scope, acceptance, quality, two Judges and Integration, but
delegated Main used 553,038 versus 154,171 direct gross Tokens. Read-only terminal and receipt audit
shows the two checkpoint responses were only 7,871 and 5,108 bytes, nearly identical to the prior
positive pair. The storage Main instead stayed alive across a 1,195,553-ms Task:

- five pre-prepare discovery turns accumulated 140,436 gross Tokens;
- six no-new-evidence wait wake-ups accumulated 238,842 gross Tokens;
- total Main model turns were 15, versus 7 in the positive delegated pair.

Exact evidence is
`goals/forklight-main-led-execution/evidence/m4-e-storage-main-token-amplification-audit.md`.

ForkLight already treats prepare/decide timeouts as observation-only and exact re-entry as durable.
The missing product truth is a canonical multi-session Main usage episode. Current
`main-token capture` permits one terminal event and StateStore permits one sample per
comparison/role, so honestly separated dispatch/review/decision sessions cannot be summed.

## `depends_on`

- M4-A through M4-E are activated; the fresh worker-runtime pair is positive.
- The fresh storage pair is accepted negative and immutable.
- The amplification audit above proves a concrete duration-to-model-wake coupling.
- Current build plus 3,084/3,084 tests pass and client/Daemon identity is matched.
- Grok 4.6 Xhigh is launchable as native Goal. No other product Writer or calibration is active.

## Inputs

- Existing strict terminal adapter in `src/core/codex-terminal-usage.ts`.
- Existing role sample/capture/status truth in `src/core/main-token-usage.ts`.
- Existing one-row-per-role `main_usage_samples` storage and Main pair/value report consumers.
- Existing observation-only `delivery prepare` timeout/re-entry behavior and compact checkpoints.
- Existing CLI, Daemon and MCP public-surface patterns.

## Outputs and production behavior

1. Add a `main-token capture-episode` operation to Core, Daemon, CLI and MCP. It accepts
   Task/comparison/role identity, one episode run reference, and a bounded ordered array of segments.
   Every segment contains one distinct `codex-run:*` reference and one exact five-counter
   `turn.completed` event.
2. Normalize each segment through the existing strict adapter. Persist one role sample whose four
   disjoint counters and gross total are the safe sum of all segments. Reasoning remains an output
   subset and cache reads/creation remain disjoint; nothing is double-counted.
3. The durable sample retains a bounded count-only segment list: ordinal, run reference, uncached
   input, output, cache-read input, cache-creation input and gross. No prompt, response, log, path,
   model transcript or raw terminal event is stored.
4. Existing single-run `main-token capture` and every schema-version-1 sample remain readable and
   unchanged. Pair assessment/report and value report consume the episode's aggregate fields through
   the same current quality gates and arithmetic.
5. Status, CLI JSON/human output and MCP expose segment count and count-only segment evidence for an
   episode without inventing savings. Unsupported/malformed/duplicate-within-episode segment refs,
   unsafe sums, mixed identity or content-bearing input fail closed before persistence.
6. Document the Main-offline delivery pattern: use a bounded prepare observation to dispatch; end
   the Main session on timeout; let the non-model host observe durable Task events; re-enter prepare
   only after Candidate or Judge progress; decide only after exact ready evidence. Every model
   segment is then captured in the episode. Observation timeout never cancels work.

The implementation may choose schema version 2 for episode samples while keeping a normalized
shared sample union. It must not create a second usage table or a parallel delivery state machine.

## Call chain

1. Main segment A invokes existing `delivery prepare` with a bounded observation and stops after
   dispatch/timeout; the Task continues in ForkLight.
2. A non-model host waits on durable Task/Review events. No model polling is required.
3. Main segment B/C re-enters the exact Task only when new evidence exists, inspects the compact
   Candidate/Judges and records the exact decision/Integration.
4. Main supplies all terminal segments once to `capture-episode`.
5. Core validates each terminal event, sums disjoint counters and persists one role sample.
6. Existing M4-B assessment and report compare that complete delegated episode with the direct
   role sample; no quality inference or delivery mutation occurs in capture/report.

## Allowed paths

The Worker may modify only:

- `src/core/main-token-usage.ts`
- `src/core/main-token-pair.ts` only if required for the normalized sample union
- `src/state/store.ts`
- `src/daemon/coordinator.ts`
- `src/daemon/protocol.ts`
- `src/daemon/server.ts`
- `src/cli.ts`
- `src/mcp/server.ts`
- `tests/main-token-usage.test.ts`
- `tests/main-token-pair.test.ts`
- `tests/main-token-value-report.test.ts`
- `tests/daemon.test.ts`
- `tests/daemon-cli.test.ts`
- `tests/mcp.test.ts`
- `docs/main-led-delivery.md`
- `docs/operations.md`

Main alone updates this Spec and Goal SSOT/evidence.

## Forbidden paths and non-goals

- No product Hub/UI, routing/model choice, Worker Runtime, Provider credentials, Task storage
  deletion, old samples/assessments, Goal state or calibration artifact mutation.
- No automatic Main accept/reject, automatic Judge choice, background retry, replacement pair,
  Competition, third Judge or lower quality gate.
- No new usage table, delivery operation/entity, lock, lease, checksum/content-addressed manifest,
  version handshake or distributed coordination.
- No absolute Worker duration/Token ceiling. No observation timeout may fail/cancel the Task.
- No commit, push, reset, remote or credential handling.

## Acceptance

1. A two-or-more-segment episode with exact terminal events persists one aggregate role sample;
   segment disjoint totals sum exactly to parent totals and survive Store reopen.
2. Every segment reference and count-only component is visible in status/CLI/MCP; no raw content or
   terminal body is stored. Inputs and returned objects are detached/deeply frozen where current
   contracts require.
3. Duplicate segment refs within one episode, malformed terminal shape, unsafe arithmetic, unknown
   keys/content fields, invalid identity and duplicate comparison/role persist nothing and return
   stable non-echoing errors.
4. Existing single-run capture, legacy Store rows, current pair assessment/report, current value
   report and all five existing M4 comparisons remain byte/behavior compatible.
5. CLI, Daemon and MCP use one Core implementation and agree on the episode sample/status schema.
6. Documentation explains staged Main-offline delivery and explicitly counts every resumed Main
   segment. It does not present a short observation as a Worker deadline or saving proof.
7. A focused test proves delivery timeout/re-entry remains observation-only and can cross
   dispatch, Candidate/review and decision checkpoints without Task recreation.
8. No Hub/UI or unrelated path changes; `git diff --check` passes.

## Verification commands

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx \
  tests/main-token-usage.test.ts \
  tests/main-token-pair.test.ts \
  tests/main-token-value-report.test.ts \
  tests/main-delivery.test.ts \
  tests/daemon.test.ts \
  tests/daemon-cli.test.ts \
  tests/mcp.test.ts
git diff --check
```

ForkLight acceptance commands keep the local 30-minute per-command breaker. The Worker has no
absolute duration or Token ceiling.

## Execution policy, handoff and workspace disposition

- One serial Grok 4.6 Xhigh native Goal Writer. The Core/Store/Daemon/CLI/MCP paths overlap and do
  not admit a second Writer.
- ForkLight independently runs the commands above. Token accounting and durable schema are
  high-risk, so two different-view Judges review the same exact Revision; Main decides and uses one
  safe serial Integration.
- One evidence-producing Worker validation repair or one same-Worker Main correction may close a
  concrete accepted gap. Repeated failure, compensating patches, need for a new table/entity or
  Spec expansion stops with a decision packet; no model switch, third Judge or replacement Task.
- Handoff names schema compatibility, segment validation/summing, public surfaces, changed paths,
  verification counts and remaining risks. Protect the full Workspace through review/Integration;
  after durable delivery, normal storage preview may reclaim only regenerable terminal space.

## Post-activation proof boundary

Activation authorizes exactly one new non-replay storage subject using staged Main-offline delivery
and complete episode capture on both sides. The old negative pair stays visible. A valid positive
new pair admits Hub; non-positive/incomplete evidence stops again. Saving is not an acceptance
criterion for this implementation Task itself.
