# ForkLight Configuration Guide

ForkLight settings are versioned, validated, and persisted as a single document.
Every setting has a built-in default; overrides are merged onto those defaults
and validated atomically before persistence.

## Configurable policy sections

### contractQuality

Governs task-contract validation. ForkLight rejects a task whose contract fails
these thresholds before workspace preparation begins.

| Field | Default | Description |
| --- | --- | --- |
| `maxFiles` | 12 | Maximum files a task may create or edit |
| `maxDiffLines` | 1200 | Maximum diff lines a task may produce |
| `maxFocusPaths` | 8 | Maximum focus-paths a task may declare |
| `minScenarios` | 2 | Minimum scenario contracts required |
| `minCallChainSteps` | 2 | Minimum call-chain steps required |
| `minOutcomeCharacters` | 12 | Minimum outcome-description length |
| `minModuleResponsibilityCharacters` | 8 | Minimum module responsibility length |

### execution

Governs Worker runtime behavior and cost ceilings.

| Field | Default | Description |
| --- | --- | --- |
| `maxConcurrency` | 2 | Maximum Workers the daemon runs simultaneously |
| `noProgressTimeoutMs` | 1,800,000 | Watchdog timeout when no effective implementation progress is seen |
| `defaultEffort` | `high` | Default Worker effort level (`low`, `medium`, `high`, `xhigh`, `max`) |
| `defaultProvider` | `deepseek` | Default provider when a task omits one |
| `defaultRuntime` | `claude-code` | Default **Worker** runtime (`claude-code`, `grok-build`). Independent of which Main client (Claude Code / Grok / OpenCode / Codex) is connected. Must pair with provider (`grok-build` requires `xai`). |
| `defaultMaxBudgetUsd` | 0.50 | Per-task spend limit when the task omits one |
| `maximumBudgetUsd` | 20 | Hard cap — no single-task budget may exceed this value |
| `maxAttempts` | 3 | Maximum attempts per task before the daemon refuses resume |
| `workerStopGraceMs` | 10,000 | Grace period for SIGINT before SIGKILL |

### Worker Advanced policy

Each Worker Profile can carry an `advancedPolicy`. A Task may override these
fields; ForkLight freezes the resolved values when the Task is created. Hub
shows the effective value and whether it came from the Task, Worker, or global
default.

| Field | Development default | Meaning |
| --- | --- | --- |
| `maxDurationMs` | `null` | Maximum Worker wall time; `null` is unlimited |
| `observedTokenCeiling` | `null` | Post-observed Token ceiling; `null` is unlimited |
| `noProgressTimeoutMs` | 1,800,000 | Watchdog threshold; `null` disables it |
| `workerStopGraceMs` | 10,000 | Graceful stop window |
| `fileLimit` / `fileLimitMode` | `null` / `warn` | File-count evidence and enforcement mode |
| `changedLineLimit` / `changedLineLimitMode` | `null` / `warn` | Changed-line evidence and enforcement mode |
| `baseMaxAttempts` | 3 | Ordinary Attempts admitted by the frozen Task policy |
| `maxExtraAttempts` | 1 | Explicit extra Attempts; separate from Main recovery paths |
| `maxMainCorrections` | 1 | Main-authorized same-candidate Worker repairs; 0 disables |
| `maxMainReverifications` | 1 | Main-authorized full check reruns with no Worker or new Attempt; 0 disables |
| `maxConcurrency` | 2 | Per-profile scheduling cap, intersected with the global cap |
| `completionMode` | `hard` | Editable no-change completion policy |
| `changeBudgetMode` | `hard` | Contract change-budget enforcement policy |
| `maxAdaptationRounds` | 0 | Bounded successor-policy rounds; 0 disables |

The two Main recovery caps and `maxAdaptationRounds` are authority/loop caps.
They may be configured before Task creation, but Task adaptation cannot enlarge
them after execution begins. Reverify-only records local command duration and
Main exchange separately; its zero Worker Tokens must not be presented as a
measured full-restart saving without an equivalent paired baseline.

### modelRouting

Governs the evidence-aware model-routing advisory. This is a read-only advisor — it never
launches work, switches Workers, disables models, or mutates settings.

| Field | Default | Description |
| --- | --- | --- |
| `minRelevantSamples` | 5 | Minimum relevant historical samples before a recommendation is produced |
| `uncertaintyThreshold` | 0.15 | Score-gap ratio below which two top candidates are considered too close to call |
| `competitionOnUncertainty` | true | When true, insufficient evidence or close scores suggest a bounded competition |
| `missingEvidenceMode` | `flexible` | `strict` blocks a recommendation when any enabled factor lacks comparable evidence; `flexible` omits that factor, explains the gap, and may use the remaining evidence |
| `weights.acceptedDelivery` | 1 | Weight for accepted delivery rate (machine success + Main-remediated) |
| `weights.verifiedBehavior` | 1 | Weight for independently verified behavior rate |
| `weights.modelQualityFailure` | 0.5 | Weight applied as a penalty for model-quality failure rate |
| `weights.correctionChurn` | 0.2 | Weight applied to explicit Main-requested revisions and Main-repaired deliveries |
| `weights.officialCost` | 0 | Weight for official-cost efficiency (only scores when all candidates have same-currency exact quotes) |
| `weights.duration` | 0 | Weight for execution speed (disabled by default; requires explicit enablement) |
| `weights.budgetReliability` | 0 | Optional soft preference for reaching a reviewable result before an enforced USD or Token limit stops the Attempt |

Non-model failures (credentials, provider errors, policy limits, workspace issues,
interruptions) are counted separately and never inflate sample sufficiency or
penalize a model. A policy-only failure whose independent behavior checks passed
may still contribute that positive behavior evidence.

Official-cost comparison requires every relevant Attempt for every candidate to have
an exact Provider-native quote in one shared native currency. Runtime telemetry,
legacy costUsd, subscription plans, ranges,
and currency conversion are never substituted. When evidence or currency is not
comparable, the cost factor is marked unavailable with a stable reason.

Budget reliability is disabled by default. When enabled, it is deliberately
narrower than success rate: it asks whether an Attempt reached a reviewable
result before an enforced runtime USD budget or observed Token ceiling stopped
it. ForkLight reads the runtime budget frozen on each Attempt, so a correction
with a different authorized budget cannot hide an earlier exhausted Attempt.

Only Attempts under one identical, actually enforced budget envelope are
compared. An uncapped success is not proof that a model can finish under a
specific limit. A configured USD value is also excluded when that Runtime has
no frozen evidence that it supports the budget flag. Different envelopes are
never averaged or converted. Missing evidence follows `missingEvidenceMode`.
The factor never disables a model, changes Task success, starts a retry or
Competition, raises a budget, or overrides Main.

### competition

Governs multi-model competition creation and scoring.

| Field | Default | Description |
| --- | --- | --- |
| `minCandidates` | 2 | Minimum candidates per competition |
| `maxCandidates` | 4 | Maximum candidates per competition |
| `tieThreshold` | 1e-9 | Score difference below which two candidates are considered tied |
| `rankingWeights.verification` | 1 | Weight for independent acceptance (must be positive) |
| `rankingWeights.diffFocus` | 0.3 | Weight for focused, minimal diffs |
| `rankingWeights.retries` | 0.2 | Weight for first-attempt success |
| `rankingWeights.cost` | 0 | Weight for spend efficiency (disabled by default) |
| `rankingWeights.duration` | 0 | Weight for speed (disabled by default) |

### integration

Governs the safety review and apply of a task's diff back to its source project.

| Field | Default | Description |
| --- | --- | --- |
| `reviewedPatchMaxFiles` | 5 | Maximum affected files allowed in a reviewed patch |
| `reviewedPatchMaxLines` | 400 | Maximum changed lines allowed in a reviewed patch |
| `verificationTimeoutMs` | 300,000 | Timeout per acceptance command during integration verification |
| `reviewReceiptTtlMs` | 900,000 | Receipt validity window after preflight |
| `backupRetentionCount` | 5 | Number of prior integration backup directories retained |
| `autoRollback` | true | Automatically roll back the patch when post-apply verification fails |

### console

UI list/poll limits used by Hub (historical section name; not a separate product).

| Field | Default | Description |
| --- | --- | --- |
| `loopbackPort` | 0 | Reserved; Hub binds its own loopback port |
| `refreshIntervalMs` | 1000 | Hub polling interval |
| `boardListLimit` | 50 | Maximum plan boards returned by list endpoints (≤ 100) |
| `taskListLimit` | 20 | Maximum tasks returned by list endpoints (≤ 100) |
| `eventListLimit` | 50 | Maximum events per task timeline (≤ 100) |

### providerDefaults

Per-provider default model, endpoint, Keychain service, and timeout.

| Field per provider | Description |
| --- | --- |
| `defaultModel` | Model name used when a task omits one |
| `defaultEndpoint` | Claude Code Anthropic-compatible endpoint URL |
| `defaultKeychainService` | macOS Keychain service name for the API key |
| `defaultHaikuModel` | Optional Haiku-class model override |
| `requestTimeoutMs` | Per-request timeout |

Built-in provider defaults:

| Provider | Model | Endpoint |
| --- | --- | --- |
| deepseek | `deepseek-v4-flash` | `https://api.deepseek.com/anthropic` |
| qwen | `qwen3.7-plus` | `https://dashscope.aliyuncs.com/apps/anthropic` |
| minimax | `MiniMax-M3` | `https://api.minimax.io/anthropic` |
| glm | `glm-5.2` | Alibaba endpoint (shared with qwen) |
| volcengine | `glm-5.2[1M]` | `https://ark.cn-beijing.volces.com/api/coding` |

The built-in `volcengine-glm52-1m` Worker uses Claude Code and the Keychain
service `forklight.volcengine.api-key`. Its model id is preserved exactly,
including `[1M]`. Coding Plan is represented as a subscription route: Worker
tokens remain measurable, but ForkLight reports per-request cost as unavailable
instead of inventing a zero-dollar or PAYG quote.

### probe

Governs explicit provider connectivity checks.

| Field | Default | Description |
| --- | --- | --- |
| `probeTimeoutMs` | 30,000 | Probe request timeout |
| `maxBudgetUsd` | 0.05 | Maximum probe cost (≤ 1 USD) |
| `cacheLifetimeMs` | 300,000 | Probe evidence cache lifetime |
| `maxProbeConcurrency` | 2 | Maximum simultaneous probes (≤ 8) |

## Precedence rules

1. **Built-in defaults** form the base.
2. **Persisted overrides** (set via `settings set`, `settings apply`, or MCP
   `forklight_settings_update`) merge on top of defaults. Unknown or
   credential-like fields are rejected atomically.
3. **Task-level overrides** (provider, model, endpoint, effort, maxBudgetUsd
   in the Task Contract) take precedence for that single task and do NOT
   persist to the settings document.

Settings changes do NOT retroactively affect tasks that were already created.

## Creation-time snapshot boundary

- **Task creation**: The current contract thresholds validate the task, and
  omitted provider, model, effort, and budget values are resolved into the
  stored task record. Those stored fields do not change later.
- **Attempt start**: Live scheduling limits are read when the daemon pumps its
  queue. The current execution and provider defaults are then snapshotted for
  that attempt; later changes affect a later attempt, not one already running.
- **Competition creation**: The effective `rankingWeights` are captured into
  the competition's immutable `rankingPolicy` at creation time. Stored
  evaluations always use this creation-time policy. The `forklight_competition_compare`
  tool can accept ephemeral ranking-weight overrides for what-if scoring, but
  those overrides never persist.
- **Integration receipts**: The preflight receipt captures source evidence
  (file digests) at review time. The apply step re-verifies every digest and
  the patch before mutating source.

## Workspace exclusion and Integration eligibility

A Task Contract declares two distinct workspace fields that look similar but
carry different product meanings. ForkLight keeps them on one shared
named-segment rule so that content deliberately hidden from the safe Worker
snapshot can never become delivery merely because an acceptance build
recreated it.

- **`workspace.exclude`** names path segments (for example `dist`,
  `node_modules`, `.git`, `coverage`) that are omitted from the isolated
  baseline and Worker snapshot at preparation time. Because excluded content
  has no trustworthy baseline, it is never eligible for automatic source
  Integration, even when a verifier-side build recreates it inside the Worker
  workspace after the edit. Each entry must therefore be one directory or file
  name, not a path or glob. Use `target`, not `src-tauri/target` or
  `**/target/**`; Task validation rejects unsupported spellings before it scans
  the project or starts a Worker.
- **`workspace.generatedPaths`** lists glob patterns (for example `dist/**`)
  for content that *is* included in the snapshot but whose changes are
  generated noise. Such changes are retained as generated evidence and kept
  out of the reviewed Integration patch, but the path remains part of the
  compared tree.

The two share one normalized named-segment matcher: a relative path is
excluded when any of its segments equals a configured `exclude` name, so a
nested path such as `pkg/coverage/report.json` follows the same meaning as
`coverage/report.json`. Patch classification reuses that exact rule, so a
recreated `dist` tree appears in **raw** and **generated** audit evidence
but is absent from **business** metrics and from the reviewed
`integration.patch`.

This is a product invariant, not a `dist`-specific workaround:

- **Raw evidence** (`workspace.raw.patch`) retains every changed file,
  including recreated excluded output, so the audit trail stays complete and
  non-destructive.
- **Generated evidence** (`workspace.generated.patch`) retains excluded and
  generated-paths output separately, with its own file and line counts.
- **Integration evidence** (`<task>/workspace.diff`) contains only eligible
  business source changes. Integration preflight measures, reviews, and
  applies only this patch, so recreated excluded output cannot inflate the
  reviewed file or line counts.

An included source path is never discarded merely because its name contains
`generated` (for example `src/generated/client.ts`): classification uses
segment equality against configured excludes plus explicit `generatedPaths`
patterns, never a directory-name heuristic. ForkLight internal paths
(`.forklight/**`) remain internal regardless of exclusion. Raising
Integration size limits is never a remedy for a recreated excluded tree -
if excluded output reaches Integration, that is a classification bug to
fix at the policy boundary, not a limit to widen.

## Non-configurable safety invariants

These are fixed by the implementation and cannot be changed through settings:

- **Loopback binding**: Hub always binds `127.0.0.1`. External network access is impossible.
- **Auth + confirm gates**: Hub requires a session token; billable or irreversible
  actions need an explicit confirm in the UI.
- **Keychain redaction**: Hub settings views never emit fields matching `keychain`.
  Credential values are never exposed to the browser.
- **Credential-field rejection**: Settings patches containing any field name
  matching `/api[_-]?key|secret|token|password|credential|auth[_-]?token/i`
  are rejected atomically.
- **Source-path isolation**: Integration operations accept only the canonical
  stored `sourcePath` from the task record. Callers cannot substitute a path.
- **Confirmation gate**: `integration apply` and `forklight_integration_apply`
  require an explicit `--confirm` flag or `confirm: true` parameter.
- **Receipt lifecycle**: A receipt expires after `reviewReceiptTtlMs`, is
  consumed atomically on first apply, and cannot be reused.
- **Worker sandbox**: Worker processes cannot access the user's home directory
  outside the task workspace. Shell and web-tool capabilities are disabled.
- **Isolation**: Workers edit only their isolated workspace copy. Integration
  apply is the sole path that mutates the source project, and it requires a
  passing preflight receipt plus explicit confirmation.
- **Recovery**: Interrupted tasks are detected on daemon restart and queued
  for recovery. Orphaned worker processes are stopped.

Start from [the safe example settings](../examples/settings.safe.yaml) and
apply only the sections you intentionally want to override.
