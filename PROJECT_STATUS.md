# ForkLight Project Status and Roadmap

Last updated: 2026-07-22

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
| Worker concurrency | 2 | Simultaneous active Workers |
| No-progress timeout | 30 minutes | Watchdog for missing effective progress |
| Default task budget | USD 0.50 | Used when a task omits its own budget |
| Maximum task budget | USD 20 | Hard configurable ceiling for one task |

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

### Distribution and release

- Validate a truly separate Mac installation.
- Establish GitHub Release and version-upgrade flow.
- Add plugin update and new-Codex-task guidance.
- Define settings and state migrations between versions.
- Choose a license before representing ForkLight as open source.
- Add a redacted diagnostic bundle that cannot include credentials or private
  project content.

## Proposed milestones

1. Control Center information architecture and visual direction.
2. Task profiles and policy classification.
3. Safe settings API plus complete configuration UI.
4. Reliability fixes and accurate failure classification.
5. Task-detail, competition, and safe-integration UI.
6. Cross-machine release candidate and first GitHub Release.

## Decisions still required

- Default numbers for Small fix, Standard feature, and Large refactor.
- Which quality gates may become warnings for small tasks.
- Whether task profiles can be selected automatically by Codex and overridden
  by the user.
- ForkLight brand direction and first localization priority.
- Public license and release channel.

## Immediate next action

Align the Control Center information architecture, task profile behavior, and
task-versus-integration limit relationship. Do not start implementation until
Yijun explicitly approves development.
