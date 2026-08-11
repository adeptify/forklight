# ForkLight Operations Guide

## What ForkLight does

ForkLight is a local-first execution and observability layer that delegates
bounded coding tasks to isolated Workers backed by external models
(DeepSeek, Qwen, MiniMax, or GLM). The primary Codex agent retains
responsibility for intent, decomposition, routing, review, and user approvals.

## Module architecture

```
Codex Agent (intent, review, approval)
    │
    ├─ MCP Server ──────► Daemon (socket) ──────► Coordinator
    │  (stdin/stdout)    (Unix domain socket)     (queue, scheduler)
    │                                                │
    ├─ CLI ──────────────► Daemon (socket)           ├─ Runner
    │  (subprocess)                                  │  prepares workspace,
    │                                                │  spawns Worker
    │                                                │
    └─ Hub UI  ◄────────── HubServer                 ├─ Verifier
       (read-only HTTP)   (loopback 127.0.0.1)       │  runs acceptance
                                                      │  commands
                                                      │
                                                      ├─ Competition
                                                      │  multi-model scoring
                                                      │
                                                      ├─ Checkpoint
                                                      │  approved commands only
                                                      │
                                                      ├─ Integration
                                                      │  preflight → async apply
                                                      │  verify → build → activate
                                                      ├─ Main remediation
                                                      │  verify repaired source
                                                      │  without rewriting failure
                                                      ├─ Candidate recovery
                                                      │  reverify only / bounded repair
                                                      │  / explicit restart
                                                      │
                                                      ├─ Board
                                                      │  plan visualization
                                                      │
                                                      └─ Statistics
                                                         failure/success analysis
```

## Workflow

### 1. Submit a task

A task is defined in a YAML/JSON Task Contract or submitted inline via MCP:

```bash
forklight submit examples/deepseek-checkout.yaml
# or via MCP: forklight_submit
```

The daemon queues the task, prepares an isolated workspace from the source
project, and spawns a Claude Code Worker with the selected model.

**Provider cost**: Submitting a task that reaches execution incurs provider
API charges. The `maxBudgetUsd` field in the task controls the per-attempt
spend ceiling.

### 2. Monitor progress

```bash
forklight status <task-id>
forklight list
forklight stats                    # query per-provider/model aggregates (human)
forklight stats --json             # compact JSON (no per-Task failure rows)
forklight stats --json --deep-audit  # full local failure evidence (requires --json)
# --deep-audit without --json is rejected before any daemon statistics fetch
```

The Hub control center provides the browser UI (configure + operate):

```bash
forklight hub                      # starts daemon + Hub on 127.0.0.1
```

#### Hub lifecycle

**First start.** The daemon starts if it is not already running, the Hub listener
binds to a loopback port, and—unless `--no-open` is used—the browser opens a local
URL carrying a private access token in its fragment. That token remains valid
for this Hub owner's lifetime. A private lifetime claim is written at startup;
an authenticated descriptor is published once the listener is ready. The Hub
runs until the owning process receives SIGINT or SIGTERM; a clean exit removes
both records.

**Repeated command (another terminal).** A second `forklight hub` reads the
existing claim, confirms the recorded owner PID is alive, probes the Hub server
to prove it owns the stored token and nonce, compares the recorded build
identity with the current CLI's build identity, and reuses the authenticated URL
only when they match exactly. The command prints the existing address and exits.
The original Hub owner is unaffected; closing the second terminal stops nothing.

**Stale version diagnosis (build identity mismatch).** When the recorded Hub
descriptor carries a different build identity than the invoking CLI, ForkLight
diagnoses the mismatch instead of reusing the old Hub. It prints an explanation
and the exact confirmed restart command. The old Hub remains running — no signal
is sent automatically. This prevents a newly rebuilt static UI from being served
by a long-lived Hub whose API shape is stale.

**Legacy descriptor (version unknown).** If the descriptor was published by an
older ForkLight version without a build identity, the CLI treats the owner as
live-but-version-unknown and prints the same confirmed restart action rather
than assuming it matches.

**Confirmed restart.** Run `forklight hub restart --confirm` to replace a stale
or legacy Hub owner. ForkLight repeats the complete ownership and authentication
proof against the exact descriptor and claim on disk immediately before
signalling. If ownership, PID, token, or nonce changed since the diagnosis, the
restart fails closed without signalling or deleting either process. Only after
the old PID, listener, descriptor, and claim are all confirmed gone does a
replacement start. ForkLight never sends SIGKILL automatically — a timed-out
owner is reported with the remaining evidence and the operator must investigate.

**Read-only status.** Run `forklight hub status` (or `forklight hub status --json`)
to ask whether a Hub is active without starting, claiming, replacing, signalling,
or mutating anything. Status reads the existing claim and descriptor, checks the
recorded PID is alive, and performs the same bounded authenticated loopback proof
as reuse. It returns one of five bounded states: `stopped` (no records), `current`
(loopback proven, exact same build as this CLI), `different-build` (loopback
proven, descriptor carries a different build), `legacy` (loopback proven, the
descriptor has no build identity at all), or `unverified` (records are missing,
malformed, inconsistent, dead, or failed authentication). Proven `pid` and `port`
are only included when the full ownership and loopback proof succeeded; the
output never contains the URL, fragment token, nonce, private home path, or
raw record bytes. JSON output uses the same safe projection.

**Restart timeout recovery.** When the old Hub owner does not exit within the
grace period (7 s), ForkLight prints the remaining evidence (PID, listener,
claim file, descriptor file) and exits without starting a replacement. Do not
delete files or kill processes manually until you have read the reported
evidence. Investigate the old Hub owner terminal, wait, and run the restart
command again when the old owner has released its resources.

**Original owner exits or crashes.** When the recorded PID no longer belongs to
a running owner, the next `forklight hub` removes the old claim and descriptor
and acquires a fresh owner. The operator never needs to delete files or look up
process IDs. If the PID has already been reused by a live process, ForkLight
uses the safe-refusal path below instead of assuming it is stale.

**Live owner cannot be authenticated (safe refusal).** If the claim PID is alive
but the liveness probe fails—the server stopped without cleanup, the token
mismatched, or an unrelated process reused the PID—ForkLight polls for a bounded
period, then exits with an error. It never signals, kills, or replaces a live
process it cannot authenticate. Stop the original Hub only when you know which
terminal owns it; never guess a process ID.

**Intentional restart.** Stop the original Hub with Ctrl+C in its terminal, then
run `forklight hub`. The clean exit removes the claim, so the new invocation
starts immediately without manual cleanup.

**Hub UI stopped while daemon continues.** Ctrl+C stops the Hub owner. The daemon
runs independently and continues serving CLI commands, scheduling tasks, and
managing Workers. Rerun `forklight hub` to reconnect the UI. Stop the daemon
separately with `forklight daemon stop`.

**Separate `FORKLIGHT_HOME`.** Each home is an intentionally isolated local
environment with its own daemon state, settings, task history, and Hub claim. A
different home has its own active Hub and never interferes with another home's.

#### Default recovery action

For any unknown Hub state, run `forklight hub`. The command handles stale
records, proves live identity, diagnoses version mismatches, and refuses only
when a live but unauthenticated owner exists. Do **not** manually delete files
from `FORKLIGHT_HOME`, scan for processes with system utilities, or reuse a port
you assume to be free. The URL printed by `forklight hub` carries a private
local access token in the fragment; never copy the full URL into logs, tickets,
or shared messages.

> **Operator note (low-level diagnostics).** The lifetime claim and authenticated
> descriptor are stored as `FORKLIGHT_HOME/.hub-owner.json` and
> `FORKLIGHT_HOME/hub-instance.json`, both with owner-only permissions. The claim
> is published atomically to prevent races. A corrupted or unknown-version file
> with a live PID is never replaced; one without a live PID is treated as stale
> and replaced automatically.

Hub serves: model/worker configuration, Main install (Plugin/MCP/Skill),
daemon lifecycle, plan boards, task statuses, provider verification, competition
results, statistics, and task decision views. Supervise mutations (resume,
revise, main review, integration apply, provider probe) require explicit confirm
where billable or irreversible.

### 3. Inspect results

```bash
forklight inspect <task-id>        # shows attempts, events, diff
```

The Worker produces a diff against the original baseline.

#### Checkpoint (Worker self-check)

When the runtime supports it, the Worker should invoke its checkpoint tool to
run the acceptance commands declared in the Task Contract. The checkpoint only
accepts deterministic command identifiers (`acceptance-1` … `acceptance-N`);
no arbitrary Shell access is available. Results are marked **non-authoritative**
and stored as a `checkpoint.completed` event.

**Independent verification is authoritative** for terminal `succeeded` /
`failed`. A missing or failed Worker checkpoint does **not** false-fail a task
when independent verification passed (audit: `checkpoint.skipped`). The
checkpoint does **not** authorize Integration — ForkLight still reruns every
acceptance command independently. Checkpoint is an early Worker feedback loop,
not a substitute for independent verification or Main review.

### 3a. Automatic validation repair (same-Worker, finite)

A Worker completion is **not** Task success. The ordinary verified-delivery
path is: implementation → Worker self-check → ForkLight independent
verification → (when eligible) a finite number of same-Worker repair rounds →
Main semantic/boundary review.

When independent verification finds an ordinary behavior failure and the
effective `maxWorkerValidationRepairs` allowance is greater than zero, ForkLight
authorizes one same-Worker repair round in the existing Task workspace and
session. After the Worker repairs, ForkLight independently reruns the **complete
unchanged** original acceptance suite. The allowance is finite:

- The global default is **1** for new Tasks (`execution.maxWorkerValidationRepairs`).
- Every Worker can inherit that default or override it in its Advanced settings
  (`advancedPolicy.maxWorkerValidationRepairs`). The Task freezes the effective
  value at creation; later settings changes do not affect existing Tasks.
- **0 disables** automatic repair: after a failed build or test, Main decides
  the next step and nothing is retried automatically.
- The value is an **allowance**, never an endless loop: when the allowance is
  used up, the Task stops and Main decides.

Failures that cannot be fixed by retrying the Worker — credentials, provider,
network, timeout, source, policy, verifier-infrastructure, or capture problems —
never consume a repair round. ForkLight records a durable skip with the reason
and a clear next action, and Task Detail explains the practical cause instead
of presenting it as an ordinary code problem.

### 4. Record a repaired delivery without rewriting Worker history

If a Worker Task remains `failed` or `interrupted` but Main has repaired the
current source after reviewing its patch, Main can explicitly verify that
repaired source against the Task's original stored acceptance commands:

```bash
forklight remediate verify <task-id> \
  --reason "bounded audit reason" --confirm
```

ForkLight copies the current source into an isolated verification workspace,
runs every stored acceptance command, and records the check and disposition in
one atomic operation. A passing check adds the separate disposition
`verified-repaired-delivered`; the original Task status, Attempts, verification
events, failure category, and machine-success statistics remain unchanged.

The bounded reason, commands, and command output are private audit evidence.
CLI, MCP, daemon, Hub, and statistics expose only check ids, counts, timestamps,
the delivery disposition, and the unchanged machine status. This operation does
not mutate source and cannot be used for a succeeded Task or repeated after an
existing passing disposition.

### 4a. Reuse a failed candidate at the cheapest valid layer

A failed Task does not automatically mean its candidate is worthless. Main
chooses one of three explicit paths after inspecting the independent evidence:

1. **Reverify only:** the retained Diff is already usable and only behavior
   acceptance failed while policy and source checks passed. Run:

   ```bash
   forklight reverify <task-id> \
     --reason "why the retained candidate is worth one check-only pass" \
     --confirm
   ```

   ForkLight reruns every original acceptance command in the same retained
   workspace. It launches no Worker, creates no Attempt, and adds exactly zero
   Worker Tokens and zero Provider/runtime model cost. Local command time and
   the Main exchange are still non-zero. The original Attempt record and status
   stay unchanged. A passing Task still needs a fresh Main accept before
   Integration.
2. **Correct with a Worker:** most of the candidate is useful but code must
   change. Run `forklight correct` with bounded feedback and explicit confirm.
   The same Task, workspace, session, and Diff are retained; only the correction
   Attempt adds Worker Tokens and cost.
3. **Start a new Task:** use this only when the candidate is not reusable, the
   Task Contract changed, or the execution context is no longer trustworthy.

`maxMainReverifications` and `maxMainCorrections` are separate frozen Worker
Advanced settings. Both default to one and accept zero to disable their path.
Neither operation starts automatically, consumes ordinary retry allowance, or
loops. Reverify-only also rejects competition candidates, policy/source
failures, empty business Diffs, running Attempts, and exhausted allowance.

### 4b. Resolve handled attention without inventing success

When a failed/interrupted Task — or a succeeded Task with no delivered outcome
and no running Attempt — no longer needs operational attention because the
real-world problem was fixed or the work was superseded, Main can close it as
resolved attention:

```bash
forklight resolve <task-id> \
  --reason superseded \
  --evidence <evidence-task-id> \
  --note "successor covered the remaining work" \
  --confirm
```

`--reason` is required and must be one of `environment-recovered`,
`superseded`, `handled-elsewhere`, or `no-longer-needed`. `--evidence` is
optional: it links an **existing** successor or evidence Task id for audit
trail only. Linking evidence does **not** change machine status, delivery
truth, review truth, or model statistics, and it does **not** turn the Task
into delivered. The Task keeps its machine status (failed, interrupted, or
succeeded) and moves to History with reason `attention-resolved`; every review,
routing, Candidate, Token, cost, and delivery fact stays readable. Reopen with
`forklight reopen <task-id> --confirm` returns the unchanged Task to its
evidence-derived Now placement. Delivered, activated, and verified-repaired
Tasks are never eligible. Unknown or ambiguous resolve/reopen flags fail before
Daemon contact.

### 5. Multi-model competition

Submit one task with multiple candidate models. Each candidate runs in an
isolated workspace cloned from a single canonical snapshot:

```bash
forklight compete examples/deepseek-checkout.yaml \
  --candidates '[{"providerName":"deepseek","modelName":"deepseek-v4-flash"},{"providerName":"qwen","modelName":"qwen3.7-plus"}]'

forklight competition status <competition-id>
forklight competition compare <competition-id>
forklight competition list
```

**Provider cost**: Every candidate incurs its own provider charges.

Ranking weights are captured at competition creation time. Use
`competition compare --weights` for ephemeral what-if scoring without
changing the stored evaluation.

### 6. Work plans

Submit a plan that coordinates multiple interdependent tasks:

```bash
forklight submit-plan my-plan.json
forklight inspect-plan <plan-id>
forklight board                    # overview of all active plans
```

The graph scheduler queues tasks whose prerequisites have all succeeded.
Blocked or waiting tasks report their dependency state.

### 7. Review and integrate

Before applying a Worker's diff to the source project, run a safety review:

```bash
forklight integration preflight <task-id>
```

This dry-run step validates: patch format, affected file limits, source
fingerprint match against the task baseline, and clean applicability.
It persists an audit receipt but **never mutates source**.

Preflight also requires a Main agent `accept` decision bound to the latest
passing independent verification.

**To apply** — this starts an asynchronous source mutation:

```bash
forklight integration apply <task-id> --receipt <receipt-id> --confirm
```

The command returns an `operationId` immediately. Query or wait for that exact
operation:

```bash
forklight integration status <operation-id>
forklight integration wait <operation-id> --timeout-ms 60000
forklight integration history <task-id>
```

**Observation only.** `integration status`, `wait`, and `history` never start,
restart, or replace a daemon. They talk only to an already-running daemon. If
the daemon is temporarily unavailable (for example during an activation handoff
socket gap) or has been stopped, these commands fail fast with guidance to
retry the same observation later. Use `forklight daemon start` or
`forklight daemon restart` when you explicitly need a lifecycle change;
preflight and confirmed apply keep their existing startup behavior.

The `--confirm` flag is required. The operation re-verifies every receipt claim
(digests, affected files, patch), creates a backup, and records four durable
stages:

1. `source-applied`: the reviewed patch was applied to source.
2. `source-verified`: every acceptance command ran against the applied source.
3. `artifact-built`: the Task's declared build commands passed.
4. `runtime-activated`: a protected one-time handoff ran activation and health
   checks.

If source verification fails, the default `autoRollback` policy restores the
backup. If artifact build or activation fails, the source and failure evidence
are retained so the operator can inspect the exact stage. A wait timeout returns
`outcome-unknown`; it does not rewrite the operation as failed. Re-query by
`operationId`.

**Disconnected wait is safe to re-query.** If a CLI, MCP, or Hub client closes
or times out while `integration wait` is still pending, only that response is
lost. The daemon keeps running, the already-started Integration continues, and
durable state is unchanged. Reconnect and query the same `operationId` with
`forklight integration status` or another wait. This is **not** the same as a
genuinely killed daemon process after a partial stage such as `source-applied`;
resuming stages after a process crash is still a separate, unimplemented
recovery path.

Tasks without a delivery specification record build and activation as
`not-applicable`. ForkLight never creates a Git commit or pushes a branch.

### 7. Measure direct-Main Token savings

ForkLight keeps three different quantities separate:

1. **Worker volume** — all Provider-side Worker Attempts, including failed and
   correction Attempts.
2. **Main exchange estimate** — the count-only CLI/MCP boundary receipts seen
   by Main while supervising ForkLight.
3. **Direct-Main baseline** — one independently completed equivalent task from
   the exact declared `taskClass × directCodexProfileId`.

A Task Contract must declare both identity fields before it runs. Run the
equivalent direct task from the same baseline and contract, then capture only
the opaque run reference and canonical terminal counters:

```bash
forklight direct-codex capture-task \
  --task-id <forklight-task-id> \
  --run-ref codex-run:<opaque-id> \
  --usage '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":1,"reasoning_output_tokens":0}}' \
  --json
```

The daemon derives the calibration identity from the stored Task. It never
accepts duplicated identity metadata on this guided path. Unknown Tasks remain
unattributed and receipt-free. Raw prompts, responses, logs, and diffs do not
belong in the usage event and are rejected by the canonical schema.

Every captured sample is pending. Main must inspect both outcomes, independently
verify the direct implementation, and explicitly review the sample:

```bash
forklight direct-codex inbox --task-class <class> --profile-id <profile> --json
forklight direct-codex review --sample-id <sample> --decision accepted \
  --reviewer main-codex --reviewed-at <canonical-ISO> \
  --schema-version 1 --confirm --json
forklight direct-codex publication-preview \
  --task-class <class> --profile-id <profile> --json
forklight direct-codex publication-register \
  --task-class <class> --profile-id <profile> \
  --method paired-sample-v1 --confidence low \
  --created-at <canonical-ISO> --confirm --json
forklight tokens <forklight-task-id> --json
```

CLI, MCP (`forklight_direct_codex_capture_task`), and the Hub Task detail use
the same daemon method. One accepted sample is still low confidence. Baselines
never cross task classes or Main profiles, and a declared profile is not yet a
runtime capability proof; detect/declare/confirm preflight remains planned.

`directCodexSavings` is direct baseline minus Main exchange estimate. It is not
Worker token savings, Provider cost savings, or a substitute for official
pricing evidence.

### 8. Provider management

Check cached provider verification state (read-only, no cost):

```bash
forklight providers status
forklight providers status deepseek
forklight providers status volcengine
```

Run an explicit live probe (**mutating, billable** — each probe sends a
request to the provider):

```bash
forklight providers probe            # probe all configured providers
forklight providers probe qwen        # probe one
forklight providers probe volcengine  # explicit Coding Plan probe
```

For Volcengine Coding Plan, store the key without putting it in settings or
shell history:

```bash
./scripts/setup-volcengine-coding-plan-key.sh
```

Then select Worker `volcengine-glm52-1m`. It uses the exact model id
`glm-5.2[1M]` and endpoint `https://ark.cn-beijing.volces.com/api/coding`.
The probe sends one potentially billable request. Coding Plan token usage is
recorded, while exact per-request cost remains explicitly unavailable because
the route is subscription-based.

### 9. Settings

```bash
forklight settings get
forklight settings set execution.maxConcurrency 4
forklight settings apply my-settings.yaml
forklight settings reset               # restore built-in defaults
```

Settings are validated atomically. Unknown fields, credential-like field
names, and out-of-range values are rejected before persistence. See
[configuration.md](configuration.md) for every configurable field.

### 10. Health check

```bash
forklight health
```

Reports: daemon process ID, Claude Code availability, configured provider
readiness, cached provider verification state, active/queued task counts, and
the CLI/MCP and daemon build identities. `identityStatus=matched` is required
for state-changing requests. A new build may still issue `daemon stop` to
replace a stale daemon; this is the narrow recovery exception, not a general
mutation bypass.

## Actions that incur provider cost

| Action | CLI command | Cost risk |
| --- | --- | --- |
| Run a task | `forklight run` | Yes — spawns Worker immediately |
| Submit a task | `forklight submit` | Yes — when the daemon picks it up |
| Submit via MCP | `forklight_submit` | Yes — when executed |
| Resume a task | `forklight resume` | Yes — another attempt |
| Submit a competition | `forklight compete` | Yes — per candidate |
| Probe a provider | `forklight providers probe` | Yes — explicit probe request |
| Provider status | `forklight providers status` | **No** — cached, read-only |
| Settings read | `forklight settings get` | **No** |
| Settings write | `forklight settings set` | **No** |
| Hub UI | `forklight hub` | **No** for browse; supervise actions need confirm |
| Hub status (read-only) | `forklight hub status` | **No** — read-only, never claims, replaces, or signals |
| Integration preflight | `forklight integration preflight` | **No** |
| Integration status/wait/history | `forklight integration status` / `wait` / `history` | **No** — observation only; never starts a daemon |
| Health check | `forklight health` | **No** |

## Actions that mutate the source project

Only one operation writes to the source project:

```bash
forklight integration apply <task-id> --receipt <receipt-id> --confirm
```

Every other operation is read-only with respect to source files. Workers edit
only their isolated workspace copy.

## Recovery

Interrupted tasks are detected on daemon restart and queued for recovery.
Orphaned worker processes are stopped before recovery begins. Integration
stages and final results are durable Events/records, so an operator can recover
the truth by `operationId` after a CLI timeout or daemon replacement. The daemon
stores all state in SQLite at the ForkLight home directory.

Set `FORKLIGHT_HOME` to isolate state:

```bash
export FORKLIGHT_HOME=/tmp/forklight-isolated
forklight daemon start
```

On macOS the default is `~/Library/Application Support/ForkLight`.

### Daemon start readiness

`forklight daemon start` and `forklight daemon restart` use one bounded readiness
window after a single launch:

```bash
forklight daemon start
forklight daemon start --startup-timeout-ms 60000
forklight daemon restart --startup-timeout-ms 60000
```

- Default readiness deadline is **30 seconds** (`1000`–`600000` ms when set).
- If a matching daemon is already healthy, start returns immediately and does
  not spawn a second process.
- Otherwise ForkLight launches **exactly one** child, then polls only that child
  and the health endpoint until ready, the child exits, or the deadline expires.
- Slow durable recovery (for example after self-upgrade) is allowed to finish
  inside the configured window; readiness past the old fixed five-second probe
  loop is not reported as a failed start while the child is still progressing.
- Child exit and readiness timeout are distinct, privacy-safe failures. Neither
  path auto-relaunches. A timed-out child is not killed automatically.
- Integration `status` / `wait` / `history` remain observation-only and never
  enter this startup supervisor.

## Quick verification (offline smoke)

The smoke test exercises the local control path without contacting any
provider, mutating source, integrating, committing, or pushing:

```bash
npm run smoke
```

It creates an isolated temporary home, starts the daemon, reads and writes
settings, reads cached provider evidence without probing, and performs safe
shutdown (Hub UI is covered by hub-* tests separately).
