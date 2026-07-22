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
| `defaultEffort` | `high` | Default Claude Code effort level (`low`, `medium`, `high`, `xhigh`, `max`) |
| `defaultProvider` | `deepseek` | Default provider when a task omits one |
| `defaultMaxBudgetUsd` | 0.50 | Per-task spend limit when the task omits one |
| `maximumBudgetUsd` | 20 | Hard cap — no single-task budget may exceed this value |
| `maxAttempts` | 3 | Maximum attempts per task before the daemon refuses resume |
| `workerStopGraceMs` | 10,000 | Grace period for SIGINT before SIGKILL |

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

Governs the read-only loopback UI.

| Field | Default | Description |
| --- | --- | --- |
| `loopbackPort` | 0 | Port for the console HTTP server (0 = OS-assigned) |
| `refreshIntervalMs` | 1000 | UI polling interval |
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

## Non-configurable safety invariants

These are fixed by the implementation and cannot be changed through settings:

- **Loopback binding**: The console HTTP server always binds `127.0.0.1`.
  External network access to the console is impossible.
- **Read-only console**: The console server accepts only `GET` and `HEAD`
  requests. No mutation is possible through the UI.
- **Keychain redaction**: The console's `/settings` endpoint recursively
  strips every key whose name matches `keychain` before serialization.
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
