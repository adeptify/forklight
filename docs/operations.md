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
    └─ Console ◄────────── ConsoleServer             ├─ Verifier
       (read-only HTTP)   (loopback 127.0.0.1)       │  runs acceptance
                                                      │  commands
                                                      │
                                                      ├─ Competition
                                                      │  multi-model scoring
                                                      │
                                                      ├─ Integration
                                                      │  preflight → apply
                                                      │  (mutates source)
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

The read-only console provides a browser UI:

```bash
forklight console start            # starts loopback HTTP server
forklight console status
forklight console stop
```

The console serves: plan boards, task statuses, provider verification state,
competition results, and statistics. All endpoints are read-only; no mutation
is possible through the UI.

### 3. Inspect results

```bash
forklight inspect <task-id>        # shows attempts, events, diff
```

The Worker produces a diff against the original baseline. ForkLight
independently runs the acceptance commands declared in the contract
and stores the verification result.

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

**To apply** — this mutates the source project:

```bash
forklight integration apply <task-id> --receipt <receipt-id> --confirm
```

The `--confirm` flag is required. The apply step re-verifies every receipt
claim (digests, affected files, patch) before accepting the receipt, backs up
affected files, applies the patch, copies the patched source to an isolated
directory, runs acceptance commands there, and either keeps the applied patch
or rolls it back based on `autoRollback` (default: roll back on verification
failure). ForkLight never creates a Git commit or pushes a branch.

```bash
forklight integration history <task-id>
```

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
readiness, cached provider verification state, and active/queued task counts.

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
| Console | `forklight console start` | **No** |
| Integration preflight | `forklight integration preflight` | **No** |
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
Orphaned worker processes are stopped before recovery begins. The daemon
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
settings, exercises the console lifecycle and read-only endpoints, reads
cached provider evidence without probing, and performs safe shutdown.
