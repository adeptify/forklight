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
forklight stats                    # query per-provider/model outcomes
```

The Hub control center provides the browser UI (configure + operate):

```bash
forklight hub                      # starts daemon + Hub on 127.0.0.1
```

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

Before finishing, the Worker must invoke its own checkpoint tool to run the
acceptance commands declared in the Task Contract. The checkpoint only accepts
deterministic command identifiers (`acceptance-1`, `acceptance-2`, …
`acceptance-N`) mapped one-to-one from the contract; no arbitrary Shell access
is available. Results are marked **non-authoritative** and stored as a
`checkpoint.completed` event.

A checkpoint that runs every approved command with exit code 0 is required
before the Task can report success. However, the checkpoint does **not**
authorize Integration — ForkLight still reruns every acceptance command
independently and stores the official verification result. The checkpoint is a
Worker feedback loop that surfaces early pass/fail evidence, not a substitute
for ForkLight's independent verification gate or Main agent review.

### 4. Multi-model competition

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

### 5. Work plans

Submit a plan that coordinates multiple interdependent tasks:

```bash
forklight submit-plan my-plan.json
forklight inspect-plan <plan-id>
forklight board                    # overview of all active plans
```

The graph scheduler queues tasks whose prerequisites have all succeeded.
Blocked or waiting tasks report their dependency state.

### 6. Review and integrate

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

Tasks without a delivery specification record build and activation as
`not-applicable`. ForkLight never creates a Git commit or pushes a branch.

### 7. Provider management

Check cached provider verification state (read-only, no cost):

```bash
forklight providers status
forklight providers status deepseek
```

Run an explicit live probe (**mutating, billable** — each probe sends a
request to the provider):

```bash
forklight providers probe            # probe all configured providers
forklight providers probe qwen        # probe one
```

### 8. Settings

```bash
forklight settings get
forklight settings set execution.maxConcurrency 4
forklight settings apply my-settings.yaml
forklight settings reset               # restore built-in defaults
```

Settings are validated atomically. Unknown fields, credential-like field
names, and out-of-range values are rejected before persistence. See
[configuration.md](configuration.md) for every configurable field.

### 9. Health check

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
| Integration preflight | `forklight integration preflight` | **No** |
| Integration status/wait/history | `forklight integration status` | **No** |
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

## Quick verification (offline smoke)

The smoke test exercises the local control path without contacting any
provider, mutating source, integrating, committing, or pushing:

```bash
npm run smoke
```

It creates an isolated temporary home, starts the daemon, reads and writes
settings, reads cached provider evidence without probing, and performs safe
shutdown (Hub UI is covered by hub-* tests separately).
