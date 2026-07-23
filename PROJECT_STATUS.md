# ForkLight Project Status and Roadmap

Last updated: 2026-07-23

This file is the working product and engineering snapshot for ForkLight. It is
expected to evolve as product decisions, provider capabilities, and team
priorities change.

## Product boundary

ForkLight is the local execution, safety, and observability layer for external
coding Workers. Codex remains the primary entry point and accountable
orchestrator: it aligns intent, defines bounded tasks, reviews evidence,
corrects failures, and decides what may be integrated.

The web product is not intended to replace Codex as a second orchestration
brain. Its role is to make configuration, progress, evidence, failures,
competition results, and integration decisions visible and understandable.

## Current milestone

The 0.2 implementation is complete on `main` at baseline commit `d9a0184`.

Delivered capabilities:

- Persistent external-model Workers through Claude Code.
- DeepSeek, Qwen, MiniMax, and GLM provider support.
- Structured Task Contracts with independent acceptance commands.
- Isolated Worker workspaces and source fingerprints.
- Daemon scheduling, recovery, retries, and configurable concurrency.
- Multi-task plans, dependency scheduling, and a project board read model.
- Multi-model competition with configurable scoring and long-term statistics.
- Safe patch preflight, backups, confirmation, verification, and rollback.
- Read-only loopback console for tasks, plans, statistics, and evidence.
- Visual first-run setup, Provider verification, Keychain storage, and Codex
  plugin installation.
- Portable package, Codex plugin, `doctor`, install/update/remove guidance, and
  clean-install verification.
- 260 automated tests passing at the end of this milestone.

### Current working-tree strengthening

The next round is now in active development with explicit approval from Yijun.
ForkLight is being used to modify itself through MiniMax and DeepSeek Workers,
while main Codex remains responsible for acceptance and integration.

The first strengthening wave is present in the working tree and not yet
committed or pushed:

- Provider probes run with an isolated Claude configuration and working
  directory, and persist bounded redacted failure evidence.
- Probe CLI exits non-zero when any requested probe fails.
- CLI submit paths are resolved before crossing the daemon boundary.
- CLI health reads the same effective Provider settings as submit/status.
- `deepseek-v4-pro[1M]` completed a real implementation and correction cycle.
- 268 automated tests pass after main-Codex review and integration.

The second wave now delivers a real unlimited-task-budget state instead of
using a large numeric value as a substitute. The current persisted default is
`null` (unlimited), so new tasks omit Claude Code's `--max-budget-usd`
argument; finite task budgets remain validated. Concurrency is currently set
to 4, inside the selected 3-5 operating range. The first Token telemetry slice
now persists complete terminal input, output, cache-read, and cache-creation
usage on successful and failed Attempts. The verified working tree passes 280
automated tests. Later waves add official-price recomputation, main-context
exchange telemetry, policy profiles, task/integration limit linkage, and the
editable Control Center.

The official-price catalog and exact route resolver are now present in the
working tree. A MiniMax control attempt showed that shrinking scope alone does
not fix a guessed Diff hard gate: its draft reached 781 lines against a
340-line contract and was stopped before compression damaged the design. A
DeepSeek Pro control run then used a wider 900-line review ceiling, completed
2 files / 704 lines, and passed 292 tests. Main-Codex review still found a
missing Provider identity that the Worker tests and independent verifier did
not cover; Codex corrected the resolver and added cross-Provider isolation
coverage, after which the source working tree passed 292/292 tests again.

The successful DeepSeek Attempt also proves the terminal usage path in a live
post-integration run: 51,105 input, 51,728 output, 715,008 cache-read, and zero
cache-creation tokens were persisted. At the checked DeepSeek Pro PAYG rates,
that usage quotes to USD 0.069825939. Claude Code reported USD 1.906229 for the
same Attempt, about 27.30 times higher, so that field remains a runtime estimate
and must not be displayed or ranked as Provider official cost.

The official native-currency calculator and Attempt persistence slice are now
also present in the working tree. It resolves only an exact Provider, billing
route, model, service tier, and context tier; preserves the official source and
component rates; never performs hidden FX conversion; and returns a typed
unavailable reason rather than zero when evidence is missing. A MiniMax-M3
implementation required three verifier-guided Attempts and finished with
320/320 tests. A DeepSeek Pro follow-up persisted the complete immutable quote
or precise unavailable evidence on every terminal Attempt and finished with
344/344 tests.

An end-to-end read-only DeepSeek Pro dogfood task then persisted 42,746 input,
5,373 output, 151,552 cache-read, and zero cache-creation tokens. ForkLight
stored an official direct-PAYG quote of USD 0.023818396 with source, checked
date, route, tier, and components, while Claude Code reported a runtime estimate
of USD 0.423831 for the same Attempt (about 17.79 times higher). This proves the
data path after an explicit source build and daemon restart. It also exposed a
self-hosting activation gap: safe integration verified isolated source but did
not rebuild the original project's `dist`, so a restarted daemon initially
loaded stale code. Build/source/runtime identity must become visible and
actionable instead of relying on manual recovery.

The main-thread Token-efficiency core, privacy-preserving receipt store, and
the first live MCP boundary capture are now integrated and pass 400/400 tests.
The calculation core preserves exact gross Worker components,
uses only redacted UTF-8/character measurements for orchestration exchange,
returns a deliberately broad low-confidence range when no authoritative main
tokenizer exists, and keeps direct-Codex savings unavailable until an explicit
task-class-matched calibration is supplied. Missing or malformed exchange
evidence, incomplete Attempt usage, task-class mismatch, zero-baseline
percentage, and negative savings all remain explicit. The receipt boundary now
normalizes count-only request/response evidence, preserves the explicit
`may-overlap` relationship, and persists insert-only task-attributed records
that are revalidated on read. The MCP adapter now captures count-only request,
content, structured, and error evidence for submit, status, inspect, resume,
integration preflight, integration apply, and integration history. It returns
the exact original result or error and fails open if observability storage is
unavailable. CLI capture, task-level receipt aggregation, a read-only Token
command, a Task economics report, a daemon read path, and the first Console
consumer are now delivered. The versioned exact task-class calibration registry
and automatic report selection are also delivered. A privacy-safe paired
direct-Codex sample and publication core is now present; representative real
samples, capture/persistence workflow, statistics consumption, and post-pipe
CLI measurement still remain before the product can show a defensible
saved-Token number.

The MCP slice dogfooded the full correction path with MiniMax-M3. Attempt 1
failed one fixture after 397/398 tests; Attempt 2 passed 400/400 behavior tests
but was policy-rejected at 834/750 changed lines; Attempt 3 preserved the same
coverage at 733 lines and succeeded. Main Codex then found one untested boundary
caused by line-pressure compression, moved daemon startup inside the known-task
receipt wrapper, restored readable handler structure, and reran the full suite
through safe Integration. This is positive correction evidence for MiniMax, not
two undifferentiated model failures. It also strengthens the requirement that
behavior, policy, and main-review outcomes remain separate.

Receipt-aware task aggregation was integrated at 432/432 tests; the current
expanded suite passes 506/506 tests.
The pure core treats exact exchange evidence as highest precedence; otherwise
it aggregates each canonical receipt independently, adds the request, uses
`max` for overlapping response lower bounds and `sum` for response upper
bounds, then adds distinct exchanges. An explicitly empty receipt source does
not silently fall back to legacy flat measurements. A read-only Store service
now returns Task attribution, Attempt/receipt counts, Worker volume, exchange
range, boundary reduction, and typed direct-Codex availability without pricing
or raw content.

The first real report against DeepSeek task
`9de401d7-26ba-44f8-8168-c8332a1be559` observed two complete Attempts with
79,076 input, 44,237 output, 3,152,640 cache-read, and zero cache-creation
Tokens, for 3,275,953 gross Worker Tokens. It correctly reported zero receipts
and kept exchange, boundary reduction, and direct-Codex savings unavailable.

The Task economics report now composes the runtime-cap snapshot, runtime cost
estimate completeness, official native-currency totals and sources, typed
unavailable reasons, and the canonical Token report without re-reading Attempt
history or exposing raw task content. The first real DeepSeek Pro report shows
USD 1.239445 of incomplete runtime estimates versus USD 0.0341649 of incomplete
official-source quotes, with one main-review-interrupted Attempt left explicitly
unavailable rather than counted as zero.
This is expected because that dogfood path used the still-uncaptured CLI and
the current Codex task's long-lived MCP process predates MCP receipt capture.
The next transport/consumer slice is therefore required for the first live
saved-Token interval.

The daemon and Console economics consumer slice is now active in the real
runtime. DeepSeek Pro task `f3ea0317-f0af-473c-a6c2-3ccb1eb2aa4d` completed in
one Attempt and exposes an uncapped runtime-budget snapshot, USD `1.184994`
Claude-side runtime estimate, USD `0.041033579` official-source quote, Worker
volume, orchestration exchange evidence, and the explicit
`direct-baseline-missing` reason. MiniMax task
`64824be1-650c-423c-823e-88bad5f3562a` succeeded after two verifier-guided
corrections and exposes `21,526,290` gross Worker Tokens; all three official
cost samples remain `per-request-usage-required` because terminal aggregate
usage cannot truthfully resolve the 512K per-request pricing tier.

Main-Codex browser review found presentation failures that source tests had
missed: non-zero sub-cent costs rounded to false zero, unvalidated source-link
schemes, DOM range elements coerced to `[object HTMLSpanElement]`, and task
details rendered below a long table outside the viewport. The Console now uses
adaptive non-zero amount precision, allows only HTTP(S) evidence links, appends
range nodes without coercion, and opens an accessible fixed detail drawer with
Escape/focus handling and a single-column narrow-screen layout. Existing
statistics now label `avgCostUsd` as a Claude-side runtime estimate instead of
Provider cost; official native-currency statistics remain a separate pending
consumer.

The first versioned task-class calibration path is now integrated. TaskSpec can
store an explicit class, the Store keeps insert-only calibration versions with
exact case-sensitive lookup, and normal Task Token/economics reports select the
latest exact-class version unless an explicit caller override wins. Selection
provenance exposes only its kind plus registry version/sample size; evidence
references and raw content never enter the report. Missing class, missing
calibration, missing exchange evidence, mismatch, zero baselines, and negative
savings remain distinct rather than becoming zero. The MiniMax correction task
`109561d2-da37-414e-a215-777e0c611fb6` finished at 5 files / 342 changed lines,
41/41 focused tests, and 489/489 full tests. This is infrastructure for a
defensible estimate, not a claim that saved Tokens are already available: no
representative paired direct-Codex calibration sample has been registered yet.
After Integration, the original project's `dist` again remained stale until an
explicit source `npm run build`; the rebuilt daemon and Console were then
restarted and a real HTTP Task response confirmed
`calibrationSelection.kind = task-class-missing`. Runtime activation is now
verified for this working tree, but the activation gap itself remains a product
reliability milestone.

The paired direct-Codex calibration core is now integrated in the working tree.
It accepts only complete four-component terminal usage, exact canonical task
classes, semantic `codex-run:` and `pair:` identities, unique Task/run/pair
evidence, explicit publication policy, and canonical timestamps. Publication
sorts the sample set deterministically and delegates the final record to the
existing calibration normalizer; it does not infer confidence or claim saved
Tokens. DeepSeek task `43e34f6b-04bb-4199-b657-05550a9ff9b4` exhausted three
Attempts: the first was stopped by main review, the second reached 13/14 focused
tests, and the third reached 16/17 but was also 411/400 changed lines. The final
failure was a test asserting that already-normalized frozen samples should be
unfrozen, not a failed deterministic-publication behavior. Main Codex corrected
the caller-input fixture, retained the semantic coverage, reduced the two new
files to 389 lines, and verified 17/17 focused plus 506/506 full tests. The Task
history remains failed; behavior evidence, policy evidence, Worker claim, and
main-review acceptance are not collapsed into one success/failure label.

The paired core is now also bound to an explicit, versioned
`directCodexProfileId`. Every sample and publication must use the exact same
bounded identity; mixed profiles, implicit inference, malformed transport
envelopes, and extra content-bearing fields fail closed. Publication returns a
three-field envelope around the unchanged aggregate calibration record, and an
exported normalizer revalidates that envelope for the future Store boundary.
MiniMax task `bf2a4810-c9d3-49d6-a1cf-061347c0f289` exhausted three Attempts:
the first reached 20/22 tests, the second was stopped by main review and has no
terminal usage, and the third reached 22/24 but misclassified two frozen test
fixtures and counted net additions instead of the verifier's additions plus
deletions (`278/260`). Main Codex retained the failed Task history, corrected
the fixtures and compressed repetition without removing behavior, then
verified 19/19 focused and 508/508 full tests at 2 files / 140 changed lines.
The profile-bound producer and Store persistence foundation are delivered;
capture/review UI and real paired samples still remain.

Profile identity now uses one exported exact normalizer across paired samples,
publications, and optional TaskSpec declaration. The Store has a separate
additive insert-only profile-publication table keyed by the composite
taskClass/profile/version identity; legacy class-only rows remain readable but
cannot silently become profile evidence. Reads re-normalize canonical JSON and
cross-check task class, profile, version, and time against independent columns.
DeepSeek task `03d30e6b-5d8e-4bd6-8a8a-57388493f573` failed its first Attempt
on one compile-time narrowing error, then passed 67/67 focused and 525/525 full
tests at 6 files / 527 changed lines after exact verifier feedback. Main review
found one untested boundary—padded taskClass Store queries returned no match
instead of failing explicitly—and added canonical query validation plus focused
coverage. The real working tree now passes 68/68 focused and 526/526 full tests.

Token and economics reports now select a direct-Codex baseline only by the
exact resolved `taskClass + directCodexProfileId` pair. An explicit publication
must match both independently resolved identities; missing class, missing
profile, malformed publication, class mismatch, profile mismatch, and exact
pair absence remain separate privacy-safe states. Legacy class-only rows are
never used as profiled evidence, negative savings remain visible, and the
economics facade preserves its one-snapshot Attempt read. MiniMax task
`7755deda-7bae-4111-b07d-834d198f92ee` produced the correct core direction but
failed independent verification: a sixth compile-time report fixture was not
in the five-file contract and the machine counted 703 changed lines against a
650-line hard limit. Main review also corrected missing-identity precedence,
gave malformed explicit publications their own truthful state, and fixed an
explicit-envelope sample-size assertion. The Task remains failed; the reviewed
six-file source now passes 62/62 focused and 526/526 full tests.

The durable paired-sample review inbox is now integrated. Samples are accepted
only for an existing Task whose declared task class and direct-Codex profile
match exactly; reads revalidate canonical JSON, independent columns, and the
current Task identity. Direct-run and pairing identities are globally unique,
review decisions are immutable and restricted to one accepted or typed-rejected
record, corrupt review rows cannot silently hide pending evidence, and evidence
foreign keys are restrictive rather than cascading. DeepSeek task
`7e60b684-62fe-4fbc-8c25-be231c7a2057` used three Attempts. The first ended in
a Provider/runtime stream stall after leaving recoverable edits; the second
reached 62/63 focused tests; the third passed 63/63 focused and the full suite.
The Task nevertheless remains policy-failed because the machine measured 887
changed lines against the 850 hard limit. Across the three Attempts ForkLight
observed 6,845,385 gross Worker Tokens and a low-confidence boundary reduction
of 6,787,672–6,835,750 Tokens. This is not yet direct-Codex savings. DeepSeek
official-source cost totals USD 0.157219179, while Claude runtime estimates
total USD 5.997638; the two measures remain separate.

The pure Codex terminal-usage adapter is also integrated. It accepts the real
nested `turn.completed.usage` shape, validates complete input, cached-input,
cache-write-input, output, and reasoning-output counters, then converts total
input into mutually exclusive uncached/cache-read/cache-create components.
Reasoning remains a validated subset of output and is never added twice. The
real format probe therefore maps 31,647 input plus 113 output to a gross 31,760
Tokens, not 51,728. MiniMax task
`7d6d99ab-99fc-4cd7-9edc-45dd89ca83ca` passed 46/46 focused and its full suite
at 2 files / 505 changed lines, but remained failed solely because unrelated
DeepSeek files were integrated into the source project while both tasks ran;
the verifier reported `sourceUnchanged=false` despite no overlap in affected
paths. Main review added combined safe-integer overflow coverage. The real
working tree now passes 47/47 adapter-focused and 568/568 full tests. Across
two MiniMax Attempts ForkLight observed 1,801,853 gross Worker Tokens and a
low-confidence boundary reduction of 1,769,650–1,796,477 Tokens. Official
MiniMax cost stays typed unavailable because the historical Task omitted its
required pricing route; no runtime estimate is substituted.

After both tasks finished, the source was rebuilt and the daemon and Console
were restarted with no active work. This activated the latest TaskSpec profile,
review-store, and terminal-usage code for future submissions. Historical Tasks
that were parsed by the older daemon remain without a profile identity rather
than being silently backfilled. Representative paired samples must therefore
come from fresh, explicitly profiled Tasks.

A MiniMax receipt candidate reached 382/382 tests but remained policy-rejected
at 721/700 lines. The DeepSeek Pro fallback reached 391/391 tests at exactly
4 files / 850 lines. ForkLight nevertheless marked that Task failed because
`PROJECT_STATUS.md` and the dogfood log changed while it ran, even though all
four affected source/test files were byte-identical to the Task baseline. Main
Codex verified the affected-file identity, reviewed the patch, applied only the
four declared files, and reran 391/391 tests in the real source tree. The Task
history remains failed rather than being falsified. These are separate
behavior-pass/policy-fail samples and do not permanently exclude either model.

The Console now has an authenticated read-only session boundary. DeepSeek Pro
task `98d3df44-4dff-4da6-b78d-d21561aad4c2` delivered the foundation in one
Attempt; main review corrected fragment-removal and first-401 behavior before
safe integration. The token is accepted only from the URL fragment, removed
before data access, never persisted by the page, and invalidated on the first
unauthorized response. Static assets remain reachable without credentials,
while every data route and HEAD request requires the exact session token. The
task observed 5,846,342 gross Worker Tokens, an official DeepSeek quote of USD
0.097694968, and a separate Claude runtime estimate of USD 4.413958. Direct
main-thread savings remains unavailable because this exact class/profile has no
paired direct-Codex baseline.

The latest dogfood slice fixes two false-success paths without creating a model
ban. A terminal `stop_reason: error` or error subtype now overrides
`is_error: false` and process exit zero, preserves Token/cost evidence, and
produces a stable content-free diagnostic even when `result` is empty. For
editable tasks, zero delivery is now an explicit policy with `hard`, `warn`,
`score`, and `off` modes. The global default is `hard`; each new Task snapshots
the effective setting and may explicitly override it. Only `score` mode changes
competition rank, while hard failure remains disqualifying and warn/off remain
non-scoring. Legacy editable zero-diff evidence falls back to hard rather than
winning through the old diff-focus reward.

DeepSeek Pro task `854530d6-a67e-46a7-8052-4a5f5d458b41` exhausted three
Attempts and truthfully remains `failed`: the final Worker result compiled but
seven verifier failures came from six missing fixture directories and one test
that assigned Task-finalization ownership to the verifier. Main Codex corrected
those fixtures, closed the task-level override and legacy-policy boundaries,
reviewed the production call chain, and integrated the accepted result without
rewriting Task history. The real source now builds, passes 123/123 focused and
666/666 full tests, and the daemon and authenticated Console have been rebuilt
and restarted with no active work.

Across those three Attempts ForkLight observed 21,693,369 gross Worker Tokens.
The official DeepSeek quotes total USD 0.204601264; the separate Claude runtime
estimates total USD 13.402729. At the post-review browser checkpoint,
receipt-aware orchestration exchange is 246,216–1,480,119 Tokens, producing a
low-confidence boundary reduction of 20,213,250–21,447,153 Tokens. This is
observed offloading minus a broad exchange
estimate, not direct saved Tokens. Direct savings remains
`direct-baseline-missing` until an accepted exact-pair main-Codex sample exists.

## Current task constraints

ForkLight currently uses a strict Task Contract. Some limits are configurable,
while some structural and safety requirements are fixed.

### Configurable task and integration limits

| Policy | Default | Meaning |
| --- | ---: | --- |
| Task maximum files | 12 | Global ceiling for one Worker task |
| Task maximum changed lines | 1200 | Global diff ceiling for one Worker task |
| Task focus paths | 8 | Maximum initial files or directories named for inspection |
| Minimum scenarios | 2 | Minimum normal/boundary scenarios in a Task Contract |
| Minimum call-chain steps | 2 | Minimum producer-to-consumer steps |
| Integration maximum files | 5 | Maximum files accepted by safe patch integration |
| Integration maximum changed lines | 400 | Maximum lines accepted by safe patch integration |
| Maximum attempts | 3 | Resume limit for one task |
| Worker concurrency | 2 built-in; 4 current override | Simultaneous active Workers |
| No-progress timeout | 30 minutes | Watchdog for missing effective progress |
| Editable zero-change policy | `hard` | Global default; each Task may snapshot/override `hard`, `warn`, `score`, or `off` |
| Competition delivery weight | 0.3 | Applied only when the Task's no-change policy is `score` |
| Default task budget | Unlimited (`null`) | Used when a task omits its own budget; omits Claude Code's budget flag |
| Maximum finite task budget | USD 20 | Ceiling only when a task explicitly selects a numeric runtime budget |

Each Task Contract also declares its own `maxFiles` and `maxDiffLines`. A task
may choose a smaller budget, but it cannot exceed the current global Task
Contract ceiling. The effective policy is captured when the task is created;
later settings changes affect only future tasks.

The integration limits are a separate policy. The current defaults allow a
task to change up to 12 files and 1200 lines, but safe integration accepts only
5 files and 400 lines. This mismatch can produce a task that succeeds but
cannot be integrated automatically. The next configuration UI must surface
and prevent this conflict.

### Configurable quality thresholds

- Maximum files, changed lines, and focus paths.
- Minimum scenarios and call-chain steps.
- Minimum outcome and module-responsibility description lengths.
- Concurrency, attempts, progress timeout, effort, and budgets.
- Competition candidates, tie policy, and scoring weights.
- Integration size, verification timeout, receipt lifetime, backup retention,
  and automatic rollback.
- Provider model, endpoint, Keychain service, and request timeout.
- Provider probe cost, timeout, cache lifetime, and concurrency.
- Console port, refresh frequency, and list limits.
- Editable zero-change handling and its competition delivery weight.

These settings can currently be changed through CLI, YAML, or ForkLight MCP.
They are not yet exposed as a complete visual configuration experience.

### Structural quality gates that are currently fixed

- Version 2 structured Task Contract.
- Concrete outcome and relevant context.
- Explicit in-scope and out-of-scope boundaries.
- Execution steps and concrete deliverables.
- At least one module with responsibility, inputs, outputs, and boundaries.
- Call chain and uniquely named scenarios.
- At least one known risk.
- Human-readable acceptance criteria and at least one executable acceptance
  command.
- No unresolved `TODO`, `TBD`, `FIXME`, `unknown`, or equivalent placeholders.
- At least one focused inspection path.

These gates currently apply equally to a tiny fix and a multi-module feature.
That protects quality, but it is too rigid for some small tasks and increases
Task Contract and Worker context token usage.

### Non-configurable safety invariants

- Workers cannot receive shell or web tools.
- Workers edit only isolated workspaces, never the original project.
- Credentials remain in macOS Keychain and never enter settings or the UI.
- Console and setup services bind only to loopback.
- Source integration requires a reviewed receipt and explicit confirmation.
- Source fingerprints are checked again immediately before integration.

These are safety boundaries, not product preferences, and should remain fixed.

### Hard, soft, and scoring conditions

ForkLight must stop treating every condition as the same kind of rule. The
Control Center and Task Contract should expose the enforcement semantics next
to the configured value.

- **Hard invariant:** cannot be disabled because it protects credentials,
  source isolation, user authorization, or patch integrity.
- **Hard policy:** fails or pauses the current stage. It may be configurable
  only where relaxing it cannot cross a safety invariant. Examples include an
  explicit finite runtime cap, independent acceptance, and affected-file
  conflict.
- **Warning policy:** records a visible violation and allows the stage to
  continue. Examples include approaching a Diff forecast or historical Token
  range.
- **Scoring signal:** changes recommendation or model ranking but never decides
  success alone. Cost, duration, retry count, and model-history evidence belong
  here.
- **Unavailable evidence:** is never coerced to zero or pass. Unknown official
  price, missing Token usage, incomparable currency, and an uncalibrated direct
  Codex baseline must remain explicitly unavailable.

Quality gates, change budgets, stage limits, and model selection need an
explicit configurable enforcement mode (`hard`, `warn`, `score`, or `off`)
where safe. Independent verification can remain a hard default while the UI
separates Worker claims from evidence. A model's previous failures are a soft,
recency-weighted selection signal with sample size and failure category; they
must not become a permanent ban.

Editable zero-change handling is the first delivered example of this model.
Its enforcement mode is configurable globally or per Task and is frozen at
Task creation. Runtime terminal errors, source isolation, independent command
evidence, and integration authorization remain separate hard conditions and
cannot be relaxed by setting the delivery policy to `warn`, `score`, or `off`.

## Next milestone: Control Center

The next product milestone should move ForkLight from "many configurable
capabilities" to "a user can understand and safely control the whole system."

Development should begin only after the information architecture and policy
profiles are aligned with Yijun.

### 1. Unified configuration center

Expose all supported settings in six understandable groups:

1. Providers: Provider, plan/region, model, endpoint, Key status, verification,
   rotation, and removal.
2. Execution: concurrency, attempts, effort, task budget, maximum budget,
   progress timeout, and Worker stop behavior.
3. Task quality: task profile, file/line budgets, focus paths, scenarios,
   call-chain depth, and contract strictness.
4. Competition: candidate count, tie policy, verification, focus, retries,
   cost, and duration weights.
5. Safe integration: patch limits, verification timeout, receipt lifetime,
   backups, and rollback.
6. Console: port, refresh frequency, visible list limits, and later display
   preferences.

The UI should use progressive disclosure:

- Recommended settings for daily use.
- Advanced settings for deliberate tuning.
- Raw effective configuration for diagnosis, not primary editing.

### 2. Safe configuration call chain

Every settings change should follow one consistent path:

1. UI edits an in-memory draft.
2. ForkLight validates the entire draft atomically.
3. UI shows exactly what changed.
4. UI explains whether it applies immediately, to new tasks, to a later
   attempt, or after a daemon restart.
5. Cost, credential, integration, and destructive changes require explicit
   confirmation.
6. Settings are persisted only after validation succeeds.
7. UI shows the result, audit evidence, and a reset or rollback path.

The current read-only console boundary should remain intact. Mutating settings
should use a separate authenticated local control boundary rather than making
all console routes writable.

### 3. Task policy profiles

Replace one rigid contract profile with a small number of understandable
profiles:

- Small fix: short contract, small diff, minimal scenarios.
- Standard feature: complete module, call-chain, scenario, and acceptance
  contract.
- Large refactor: larger change surface with staged work, dependencies, and
  stronger acceptance.
- Custom: direct control of every supported threshold.

Classify every rule as one of:

- Safety invariant: cannot be disabled.
- Quality gate: strictness depends on the selected task profile.
- Strategy preference: fully configurable by the user.

The UI must compare the task change budget and safe-integration budget before
execution. It should warn or block when a task can succeed but cannot be
integrated under the active policy.

### 4. UI and interaction quality

- Establish ForkLight visual identity and improve hierarchy, spacing, and
  density.
- Reuse one component system across first-run setup and daily configuration.
- Make Provider, plan, region, and model relationships immediately clear.
- Never reveal a Key; show only configuration state, last verification, and
  failure category.
- Provide complete loading, validation, failure, retry, save, and rollback
  states.
- Support desktop and mobile layouts, keyboard navigation, reduced motion,
  and Chinese/English localization.
- Link context-sensitive Provider guidance to official documentation.

## Work after the configuration center

### Reliability

- Resolve Claude Code `Edit`/`Write` denial under external Provider runtimes.
- Add a verifier watchdog that terminates abandoned child processes at the
  configured deadline.
- Distinguish model failure, Provider/API failure, ForkLight infrastructure
  failure, acceptance failure, and contract failure in the console and
  statistics.
- Continue eliminating false failures such as URL-encoded spaces in isolated
  workspace paths.
- Run real, explicitly approved connectivity and bounded implementation checks
  for every supported Provider.

### Task operations UI

- Project and plan board.
- Task dependency and execution stage.
- Bounded timeline and effective Worker actions.
- Acceptance commands, results, and diff.
- Resume, corrected re-dispatch, and competition status.
- Safe integration preview, confirmation, verification, and rollback result.

Codex remains the primary authority for task creation, correction, review, and
integration decisions even when the web UI exposes operational actions.

### Token efficiency accounting

ForkLight should make its effect on the main Codex context measurable instead
of only reporting external-model cost.

- Persist exact external Worker input, output, cache-read, and cache-write
  tokens when the Provider/runtime exposes them.
- Measure the Task Contract, status summaries, diff, and verification evidence
  returned to the main orchestrator.
- Report `offloaded token volume` as an observed value.
- Report `main-context tokens avoided` conservatively as detailed Worker
  context that was not returned to the main thread.
- Treat `tokens saved versus direct Codex execution` as a counterfactual
  estimate, with methodology, range, and confidence rather than false
  precision.
- Build a small calibration set of representative small fixes, standard
  features, and refactors so the estimate can improve from real paired samples.

The console should show both absolute tokens and a percentage, separated into
observed and estimated values. Cost savings and Token savings are different
metrics and must not be conflated.

### Distribution and release

- Validate a truly separate Mac installation.
- Establish GitHub Release and version-upgrade flow.
- Add plugin update and new-Codex-task guidance.
- Define settings and state migrations between versions.
- Choose a license before representing ForkLight as open source.
- Add a redacted diagnostic bundle that cannot include credentials or private
  project content.

## Latest dogfood wave: reviewed publication and main-review revision

Reviewed-sample publication registration is now integrated in the real source.
The service previews pending, rejected, and accepted samples for one exact
`taskClass + directCodexProfileId` pair, requires explicit confirmation,
publishes only immutable accepted evidence, advances versions only for new
accepted sample ids, validates prior provenance, rejects unsafe version
overflow, and never exposes raw content. The combined Store and service slice
passes 106/106 focused tests and the final working tree passes 600/600 tests.

A first narrow main-review correction lifecycle is also active. `forklight
revise <task-id> --feedback <text>` applies only to standalone succeeded Tasks
with remaining Attempts, no plan/competition membership, and no Integration
result. It returns the canonical queued record, clears stale terminal/live
fields, preserves history/session/workspace, records a content-free event,
reuses the full verification pipeline, and leaves ordinary resume strict.
CLI receipt typing, persisted-settings fallback parity, shared feedback
validation, and non-mutating queue-admission rejection are covered. A future
global awaiting-main-review/accept/revise model is still required for plans and
competitions.

The MiniMax implementation used three Attempts. The second passed every
behavior test but was policy-rejected at 727/700 changed lines; the third
preserved coverage at 600 lines and succeeded. Across the three Attempts,
ForkLight observed 32,433,152 gross Worker Tokens and a low-confidence boundary
reduction of 32,378,884-32,424,090 Tokens, while direct-Codex savings remains
`direct-baseline-missing`. MiniMax official cost remains
`per-request-usage-required` even with the correct China direct-PAYG route,
because terminal aggregate usage cannot resolve its per-request 512K tiers.
The DeepSeek main-review correction succeeded in one Attempt at 6 files / 194
lines; its official-source quote is USD 0.061267981 and its runtime estimate is
kept separate at USD 1.459786.

This wave also confirms four product gaps now tracked in the dogfood log:
machine success needs an explicit main-review phase; main feedback needs source
authority and can itself be wrong; MCP cannot currently express inherited
`null` unlimited budget even though YAML can; and development-mode daemon
restart plus parent/correction lineage integration need first-class support.
None of these infrastructure, fixture, policy, or main-review outcomes should
be collapsed into a permanent model ban.

The next daemon slice is now integrated. Main Codex can call one canonical
count-only workflow for direct-Codex sample capture, exact class/profile review
inbox, explicit immutable review, publication preview, and confirmed
registration. It composes the existing terminal adapter, Store, review
normalizer, and publication service instead of duplicating Token arithmetic or
publication rules. The final real working tree passes 107/107 focused tests
and 617/617 full tests at 7 files / 784 changed lines.

This dogfood task used three DeepSeek Pro Attempts. Attempt 1 mixed test-fixture
identity errors with a hard line-budget failure; Attempt 2 passed both behavior
suites; Attempt 3 was a main-review correction that reached 106/107 and failed
only because it guessed Node SQLite's UNIQUE error metadata incorrectly. Main
Codex corrected that one boundary and reran the original acceptance in the
isolated workspace and real source. The three official-source quotes total USD
0.14952255; the separate Claude runtime estimates total USD 5.968565. The Task
history remains failed because Attempts were exhausted, which is truthful but
also exposes the need for a separate main-correction acceptance receipt.

Across the three Attempts ForkLight observed 7,375,261 gross Worker Tokens,
an orchestration-exchange range of 276,716-1,675,641, and a low-confidence
boundary reduction of 5,699,620-7,098,545. These are not direct saved Tokens.
Supervision also remains incomplete: `wait --until change` currently ignores
new Worker events when Task `updatedAt` is unchanged.

The Direct Codex CLI adapter and the first real calibration loop are now
delivered in the working tree. MiniMax-M3 task
`fe894ff7-b86c-4b1b-a945-7058b4de1684` completed in one Attempt at 4 files /
668 diff lines; independent verification passed both focused and full suites,
and safe Integration produced a final real-source result of 621/621 tests.
The CLI exposes count-only capture, exact-pair inbox, explicit immutable
review, publication preview, and confirmed registration. Only successful
capture receives a Task-attributed exchange receipt; pair-level actions do not
invent attribution.

For a controlled exact-pair baseline, direct `gpt-5.6-sol` at `xhigh` executed
the same contract from the same pre-change snapshot in an isolated directory.
Its native `turn.completed` event reported 4,153,290 input Tokens, including
3,951,104 cached input, plus 30,636 output Tokens. The main verifier reran the
result outside the restricted Codex sandbox and passed 66/66 focused and
619/619 full tests at 4 files / 655 changed lines. Sample
`dc-cli-20260723-001` was therefore explicitly accepted and registered as
low-confidence exact-pair publication version 1 with a 4,183,926-Token direct
baseline.

The live ForkLight report now selects that exact profile publication and
reports direct main-thread savings of 4,058,787-4,163,315 Tokens, or
97.01%-99.51%, with low confidence. This is direct baseline minus measured
orchestration exchange, not Worker Token savings and not a cost claim. The
same MiniMax Attempt used 1,268,566 gross Worker Tokens; its official cost
remains `calculation:per-request-usage-required`, while the separate Claude
runtime estimate is USD 1.67173. One sample is proof that the accounting loop
works, not a universal model-performance conclusion.

This integration also reproduced two activation defects. The foreground CLI
timed out after ten seconds while the daemon continued and durably completed a
successful Integration, so timeout was not equivalent to failure. The isolated
verification build did not refresh the live source tree's ignored `dist`
artifacts; an explicit source `npm run build` was required before the new CLI
commands existed. Integration therefore still needs an asynchronous operation
receipt and a separate configurable activation stage with artifact/runtime
identity evidence.

The equivalent Direct Codex MCP adapter is now integrated and built. It
exposes five bounded tools for count-only capture, exact-pair inbox, explicit
immutable review, publication preview, and confirmed registration. The MCP
layer validates transport shape only and delegates identity, arithmetic,
review, versioning, and persistence to the canonical daemon. Only a successful
capture writes one exchange receipt under the Task id returned by the daemon;
the other four operations never invent Task attribution. Main review also made
all five tools explicitly non-destructive/closed-world and strengthened the
privacy tests so private-marker non-echo assertions exercise the failing input.
The real source passes 89/89 focused tests and 631/631 full tests, has been
rebuilt, and the daemon plus Console were restarted from the new artifacts.
Fresh MCP client processes can load the five new tools; an already-running
Codex MCP process still requires its own session refresh and is not silently
treated as upgraded.

This MCP delivery used a three-Attempt parent implementation and a two-Attempt
lineage correction. Both ForkLight Task records remain truthfully `failed`:
the parent mixed fixture/semantics defects with a repeated 993/850 policy
overrun, while the correction reached 631/631 behavior verification but was
rejected as 827/450 per-hop churn. Relative to the authoritative original
baseline, the accepted combined delivery is only 5 files / 602 changed lines
and fits the parent 5/850 contract. The chain observed 6,512,830 gross Worker
Tokens; direct-Codex savings is still unavailable for this exact task class and
profile because no paired baseline exists. Official DeepSeek quotes total USD
0.168205829, while the separate Claude runtime estimates total USD 6.017514.
This is evidence for lineage-aware policy and failure classification, not a
permanent negative conclusion about DeepSeek.

## Proposed milestones

1. Exact Worker usage telemetry with message-level de-duplication and thinking-token handling. Delivered at Attempt storage and task-detail UI; statistics consumption remains.
2. Official-source price catalog, billing-route matching, native-currency calculation, truthful Attempt evidence, and Store-backed daemon/Console Task economics are delivered. Budget forecast/spend policy plus statistics and dedicated CLI consumers remain.
3. Conservative main-context-token savings with observed exchange burden, offloaded volume, counterfactual range, and confidence separated. Pure calculation, unavailable semantics, strict redacted receipts, durable receipt persistence, seven task-scoped MCP boundary captures, CLI task-boundary captures, receipt-aware aggregation, read-only Task Token/economics reports, `forklight tokens`, the Console task-detail consumer, versioned exact-class calibration selection, the privacy-safe profile-bound paired-sample publication core, explicit TaskSpec profile identity, exact-pair Store persistence, immutable sample review inbox, truthful nested Codex terminal-usage adaptation, profile-aware report selection, reviewed-sample publication registration, the canonical Daemon capture/review/preview/register workflow, equivalent CLI and MCP adapters, and one real reviewed exact-pair calibration are delivered. The authenticated Console adapter, representative samples across additional task classes, CLI pre-pipe measurement limits, and statistics consumers remain.
4. Reliability fixes, stage controls, accurate failure classification, and evidence-based model selection. Terminal error-envelope truth and configurable zero-delivery enforcement are delivered; richer failure taxonomy and historical-evaluation freshness remain.
5. Task profiles and policy classification, re-split into independently verifiable migrations and parser gates.
6. Safe settings API plus complete configuration UI.
7. Task-detail, competition, and safe-integration UI.
8. Cross-machine release candidate and first GitHub Release.

## Decisions still required

- Default numbers for Small fix, Standard feature, and Large refactor.
- Which quality gates may become warnings for small tasks.
- Whether task profiles can be selected automatically by Codex and overridden
  by the user.
- ForkLight brand direction and first localization priority.
- Public license and release channel.

## Immediate next action

Expose the delivered Daemon workflow and the full settings surface through the
authenticated Console interface, using the delivered CLI and MCP adapters as
the reference behavior. The read boundary is authenticated; mutating settings,
review, publication, and integration actions still need explicit confirmation,
atomic validation, applicability timing, and rollback UX.
Then run fresh explicitly profiled tasks and register
representative versioned samples for explicit small-fix, standard-feature, and
refactor task classes so the first low-confidence CLI calibration becomes a
defensible multi-sample range. Keep the delivered
selector explicit and exact, never infer a class or execution profile from a
task name, and preserve negative savings. Then consume
native-currency official cost, runtime-estimate completeness, Worker volume,
orchestration exchange, boundary reduction, and calibrated savings in the
statistics API without cross-currency totals. Improve compact supervision so
`wait --until change` observes effective stage/action progress rather than only
Task status timestamps. MiniMax context-tier pricing must stay unavailable or
become an explicit range until request-level usage reconciles exactly with
terminal totals. Failure categories, cost, Token efficiency, and time remain
configurable scoring evidence with sample sizes; verification and safety gates
remain separately classified hard conditions, and no aggregate failure count
may permanently ban a model. Add asynchronous Integration status plus an
explicit activation contract before treating `applied` as runtime-ready. Make
change-budget policy lineage-aware: final delivery size against the
authoritative base may remain hard, while correction-hop churn is configurable
as `warn | score | off` unless it violates a separate safety boundary.
Make historical competition decisions visibly immutable but offer a labeled
current-policy preview; an old stored recommendation must not be presented as
if it had been recalculated under newer eligibility logic. Replace the global
source fingerprint with affected-path compatibility evidence for safe parallel
dogfooding, and add a main-correction acceptance receipt so exhausted Worker
history can remain failed while the reviewed delivery is still auditable.
