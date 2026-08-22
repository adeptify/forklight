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

For the staged Main-led local path — health, Goal submission, same-Task
restart continuation, verification, Judge review, correction or one-hop
handoff, exact-Candidate Integration, and terminal storage — follow
[main-led-delivery.md](main-led-delivery.md). This page remains the command
reference.

### 0. First setup

A new install can become ready without opening the Hub or editing a settings
file. Start with the read-only summary:

```bash
forklight setup status
forklight setup status --json
```

Then take the printed next command. Typical first-use sequence:

```bash
# Already signed in to Grok or Codex — no API key is requested
forklight setup provider select --provider xai

# Or store one API-key Provider from stdin after confirmation
printf '%s' "$KEY" | forklight setup provider select --provider deepseek --variant default --confirm

forklight setup worker list
forklight setup worker select --profile grok-4-6-xhigh
forklight setup main install --client grok-build --component mcp --confirm
forklight doctor
```

API keys are never accepted as command-line flags. Main install/uninstall
require `--confirm`, back up the existing client file, and tell you whether a
new Main session is needed.

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
binds to a loopback port, and—unless `--no-open` is used—the browser opens the
bare loopback address `http://127.0.0.1:<port>/`. A private per-process control
token stays in the Hub descriptor for CLI liveness proof and is injected
invisibly into the in-memory index HTML; it is not part of the URL. A private
lifetime claim is written at startup; an authenticated descriptor is published
once the listener is ready. The Hub runs until the owning process receives
SIGINT or SIGTERM; a clean exit removes both records.

**Repeated command (another terminal).** A second `forklight hub` reads the
existing claim, confirms the recorded owner PID is alive, probes the Hub server
to prove it owns the stored token and nonce, compares the recorded build
identity with the current CLI's build identity, and reuses the owner only when
they match exactly. The command prints the existing bare loopback address and
exits. The original Hub owner is unaffected; closing the second terminal stops
nothing.

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
output never contains the URL, control token, nonce, private home path, or
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
you assume to be free. The address printed by `forklight hub` is the bare
loopback URL. Refresh, bookmark, and extra tabs of that address reach Work
without a fragment or login step. The local control token is never printed;
do not copy Hub descriptor files into logs, tickets, or shared messages.

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
forklight inspect <task-id> --summary   # compact inspect plus the Main decision packet
```

### 3b. Two-call reviewed delivery

Ordinary reviewed delivery no longer requires Main to poll `wait`, create the
Review Graph, and drive Integration as separate model turns. Two resumable
commands compose the existing durable records and stop at the next genuine
Main decision:

```bash
forklight delivery prepare (--task-file <path>|--task <id>) \
  [--reviewer-profiles <id1,id2>] --reason <text> --timeout-ms <ms> --confirm \
  [--include-diff-max-bytes <n>] [--json]

forklight delivery decide <task-id> --decision <accept|revise|reject> \
  --revision <id> --digest <sha256> --reason <text> --timeout-ms <ms> --confirm [--json]
```

`delivery prepare` submits at most one new Task (or observes an existing id
without resuming the Worker), waits for independent verification, creates or
reuses the exact confirmed Review Graph, waits for every required Judge, and
returns one compact `main-delivery-checkpoint`. It never records a Main
decision and never starts Integration.

`delivery decide` binds Main's explicit `accept` / `revise` / `reject` to the
exact Candidate Revision id and full digest from that checkpoint. `revise` and
`reject` persist only that decision. `accept` runs one fresh preflight and one
Integration, then observes that operation to terminal. Judge agreement is never
acceptance.

`--timeout-ms` ends only the caller's wait. The Worker, Review Graph, and
Integration keep running. Re-enter the same command with the same Task id,
Reviewer order, reason, and (for decide) exact identity. A changed identity,
Reviewer order, decision, or reason fails closed and does not create a second
graph, review, receipt, or operation. A short observation is not a Worker
deadline and is not Task failure.

Staged Main-offline delivery uses that observation-only timeout so Main can
end the model session after dispatch and resume only when durable Candidate
or Judge evidence exists:

1. `delivery prepare` with a bounded `--timeout-ms`, then stop the Main session.
2. Observe durable Task / Review events with non-model `status` / `wait`.
3. Re-enter the same `delivery prepare` only after new Candidate or Judge
   evidence, using the same Task id, Reviewer order, and reason.
4. `delivery decide` only after the compact checkpoint is ready; bind the
   exact Revision id and digest.
5. Submit every resumed Codex terminal segment once:

```bash
forklight main-token capture-episode --task-id <task-id> --comparison-id <id> \
  --role <direct-main|delegated-main> --run-ref <episode-ref> \
  --segments '<json-array>' [--json]
```

Each segment is `{ "runRef": "codex-run:...", "usage": { "type": "turn.completed", "usage": { five counters } } }`.
Core normalizes every event through the existing strict adapter and persists
one role sample whose parent totals are the safe sums of the disjoint segment
counters. Status, CLI, and MCP show the segment count and count-only fields.
They never compute savings. Do not omit an earlier Main session to improve a
pair. Single-run `main-token capture` is unchanged.

MCP exposes `forklight_main_token_capture_episode` with the same schema.

MCP exposes the same schema as `forklight_delivery_prepare` and
`forklight_delivery_decide`. Existing `wait`, `review-graph`, `main-review`,
and `integration` commands remain available.

The Worker produces a diff against the original baseline.

New Tasks may freeze an explicit `reviewRequirement` (`requiredJudges` 0, 1, or
2 plus a bounded Main reason). `0` is an explicit skip, not a claim that review
was unnecessary. Legacy Tasks without the field stay readable and do not gain
an invented review policy. Integration preflight enforces a declared nonzero
requirement against the current exact Candidate Revision, the Review Graph
terminal assignment count, and a fresh following Main accept. When a legacy or
explicit-skip Task already has a Review Graph, that graph keeps its authority:
pending review or a terminal graph without a fresh following Main accept still
blocks Integration and makes the decision packet wait or ask for a fresh Main
decision. Compact CLI and MCP inspect, plus daemon inspect, expose one
privacy-safe Main decision packet that names the missing evidence and exactly
one next Main action without starting it.

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
genuinely killed daemon process. After a durable `source-applied: passed`
stage, a **source-only** operation (no declared build, activation, or
activation-check commands) may continue on the same `operationId` when the
daemon restarts; it does not apply the patch again. Build and activation crash
recovery remain unsupported. The operator path and that exact boundary are in
[main-led-delivery.md](main-led-delivery.md).

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
| Delivery prepare | `forklight delivery prepare` | Yes — may submit one Task and start required Judges |
| Delivery decide | `forklight delivery decide` | Accept integrates; revise/reject do not |
| Main usage capture / episode / status | `forklight main-token capture` / `capture-episode` / `status` | **No** — count-only; never starts work or claims savings |
| Health check | `forklight health` | **No** |
| Setup status | `forklight setup status` | **No** — read-only; no Hub, Task, Worker, or probe |
| Setup provider/worker/main | `forklight setup provider select` / `worker select` / `main install` | **No** — local settings/Keychain/Main config only |

## Actions that mutate the source project

Only Integration apply writes to the source project. That includes the
granular command and `forklight delivery decide --decision accept`, which runs
the same preflight/apply path after an explicit exact accept:

```bash
forklight integration apply <task-id> --receipt <receipt-id> --confirm
forklight delivery decide <task-id> --decision accept --revision <id> --digest <sha256> --reason <text> --timeout-ms <ms> --confirm
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

### Task storage lifecycle

One local developer can audit, preview, and explicitly reclaim ordinary Task
space without deleting unresolved work, unknown content, or durable evidence:

```bash
forklight storage audit
forklight storage preview [--task <id>]
forklight storage reclaim --task <id> --confirm
forklight storage reclaim --all-eligible --confirm
forklight storage retain --task <id> --reason "keep workspace for audit" --confirm
```

`audit` and `preview` are read-only. They classify every visible Task root as
`protected`, `reclaimable`, `reclaimed`, `retained`, or `unknown-orphan` with a
closed reason, byte counts, known regenerable targets, preserved durable or
unknown entries, live-process facts, Store `quick_check`, and exactly one next
action. All-eligible preview keeps that same audit's protected and unknown
entries visible, names deletion targets only for reclaimable Tasks, and lets
an unknown orphan win the one next action.

`reclaim` re-evaluates current Store truth immediately before any deletion. It
refuses when Store `quick_check` is not `ok` or foreign-key violations are
nonzero, when a proven Task process cannot be stopped, or when any existing
known target fails containment preflight. It stops only processes proven to
belong to one eligible Task and removes only canonical regenerable categories:
`workspace`, `baseline`, `claude-config`, `grok-home`, `codex-home`,
`codex-tmp`, `verifier-git`, and `verifier-git.index`. A Task is `reclaimed`
only after every known regenerable target is gone; an unavoidable mid-delete
failure is recorded as a bounded partial result and the Task stays
`reclaimable`. Logs, Candidate revisions, reviews, handoff evidence,
Integration receipts/backups, diffs, Store rows, and unknown top-level names
stay. Ambiguous or unmapped processes stay visible, protect every implicated
Task, and keep `nextAction` from claiming all-clear. Stored `workerPid`
ownership is a Task-id set: a duplicated PID protects every implicated Task
and is never signalled. A symlink used as `runs` or `runs/<taskId>` is
refused; a configured Home alias remains supported when its physical `runs`
and Task directories are ordinary and contained.

`retain` checks Store integrity before any write. A successful result reports
the retained byte breakdown and the prior terminal eligibility reason. The
durable event stays bounded and stores no raw user note.

`--json` is supported on every storage command. Human output includes bytes,
reason, and one next action. MCP tools `forklight_storage_audit`,
`forklight_storage_preview`, `forklight_storage_reclaim`, and
`forklight_storage_retain` expose the same semantics. Historical backup
deletion remains a separate approved operation.

### Local Home backup and restore

One local developer can preview, create, inspect, and restore a self-contained
backup of the ForkLight Home without opening the database or copying
credentials:

```bash
forklight backup preview --destination /safe/outside/forklight-backup
forklight backup create --destination /safe/outside/forklight-backup --confirm
forklight backup inspect /safe/outside/forklight-backup
forklight backup restore /safe/outside/forklight-backup
forklight backup restore /safe/outside/forklight-backup --confirm
```

`preview` and `inspect` are read-only. `create` and `restore` require
`--confirm`. None of the four actions start or signal Daemon or Hub.

A backup includes `forklight.sqlite` (via SQLite online backup), owned durable
roots such as `runs`, `competitions`, `review-projects`, and `samples`, plus
unknown ordinary top-level files. It excludes the Daemon socket/log, Hub
claim/descriptor, and SQLite WAL/SHM sidecars. External symlinks are not
followed; the result reports how many were skipped. Keychain credentials,
local Grok/Codex sign-in, and external Main client files are outside Home and
are never read or copied. Keep the backup directory private: it may contain
project code, diffs, and logs.

The destination must be a new directory outside the active Home. Restore
refuses while a live or unverified Daemon or Hub owns the Home and prints the
stop or investigate action (`forklight daemon stop`, or quit the Hub). It
never kills either owner. A successful restore keeps the previous Home as a
named `.pre-restore-` recovery copy. If the final switch fails, that previous
Home is put back.

`--json` prints the same included, excluded, integrity, impact, and next-action
facts. MCP tools `forklight_backup_preview`, `forklight_backup_create`, and
`forklight_backup_inspect` share those read/create projections. Home-replacing
restore stays on the CLI so a live MCP owner cannot pretend to replace its own
Home.

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
