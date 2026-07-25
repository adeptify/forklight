# ForkLight

ForkLight is a local-first execution and observability layer for persistent
coding Workers. The primary Codex agent remains responsible for understanding
intent, aligning the solution, assigning work, reviewing results, correcting
failures, and requesting approval for commits or pushes.

## Execution flow

1. Codex decides whether a bounded task should be delegated.
2. The ForkLight MCP server or CLI accepts the task and immediately returns a task ID.
3. A local daemon records the task in SQLite, prepares an isolated baseline
   and workspace, and schedules it with a configurable concurrency limit.
4. Claude Code supplies the ReAct runtime while the selected DeepSeek, Qwen,
   MiniMax, or GLM model performs the implementation. The Worker receives
   file read/edit tools but no shell or web tools.
5. ForkLight independently runs the declared acceptance commands, fingerprints
   the source project, and stores normalized progress, raw runtime events,
   attempts, verification output, and the final diff.
6. Codex polls status, inspects the result, and decides whether to accept,
   correct, resume, or replace the attempt.

Interrupted tasks are detected when the daemon restarts and are queued for
recovery. The original project is never edited by the Worker; accepted changes
still require a deliberate integration step by the primary agent.

## Install

ForkLight currently supports macOS and requires Node.js 24 or newer, Claude
Code, and the Codex CLI. It is not published to npm yet and remains explicitly
unlicensed until the owner chooses a public license.

Install the current Adeptify repository globally:

```bash
npm install -g github:adeptify/forklight
```

Or install a downloaded release tarball:

```bash
npm install -g ./forklight-0.2.0.tgz
```

## Quick start (out of the box)

One command starts the **backend daemon** and the **Hub control UI**:

```bash
forklight hub
```

Hub stays open until you press Ctrl+C (stops Hub UI; daemon keeps running until
`forklight daemon stop`). Configure in the browser — no hand-editing of Main
client configs or settings JSON for the happy path:

1. **Models** - Provider, model id, optional endpoint; API key stored in Keychain only
2. **Workers** - pick a model + runtime (`claude-code` / `grok-build`) and per-worker limits
3. **Main** - install **Plugin** (Codex), **MCP**, and/or **Skill** per client (independent)
4. Confirm **Daemon** is up on Overview (Start / Stop / Restart from the Stack card)

Overview shows a readiness checklist (Models → Workers → Main channel → Daemon).
When green, open a new Main session and submit work via MCP or CLI
(`forklight submit` / plan tools). Keys never leave Keychain.

### Operate from Hub (same daemon as CLI)

| Area | Hub actions |
|------|-------------|
| Daemon | Start, stop, restart, live health (pid, queue, identity) |
| Tasks | Resume, revise, main review (confirm), integration preflight / apply (confirm), history |
| Providers | Status + **explicit** billable probe (confirm required) |
| Compete | Status detail + compare/evaluate |
| Board / Plans / Insights | Live operate views (read + supervise) |

Task **submit** stays CLI/MCP-first; Hub is configure + supervise + observability.

Hub binds only to `127.0.0.1`. The token is carried in the URL fragment and
removed from the visible URL after the page loads. Provider keys are never written
into Main client config files — only forklight MCP command paths are.

Standalone `forklight console` and `forklight setup` UIs were removed; use
`forklight hub` only.

For a terminal-only prerequisite report that does not call a Provider or change
settings:

```bash
forklight doctor
forklight doctor --json
```

## Update and remove

Update from the repository with the same global install command:

```bash
npm install -g github:adeptify/forklight
forklight hub
```

To remove the executable, first stop local processes and then uninstall it:

```bash
forklight daemon stop
npm uninstall -g forklight
```

Uninstalling the package deliberately does not delete task history or Provider
credentials. Local ForkLight state is under
`~/Library/Application Support/ForkLight`. Provider credentials are macOS
Keychain items named `forklight.<provider>.api-key`; remove them in Keychain
Access only if you also want to revoke the local configuration.

## Development quick start

```bash
npm install
npm run check      # build + test
npm run smoke      # offline verification (no provider calls)
```

## CLI

Build and install the local command:

```bash
npm install
npm run build
npm link
```

Commands:

```bash
forklight help                                            # show usage
forklight health [--json]                                 # readiness check

forklight run <task.yaml>                                 # foreground execution ★
forklight submit <task.yaml>                              # queue via daemon ★
forklight validate <task.yaml> [--json]                   # dry-run contract check
forklight status <task-id> [--json]                       # task status
forklight inspect <task-id> [--json]                      # attempts, events, diff
forklight resume <task-id> [--feedback ...]               # retry interrupted ★
forklight list [--json]                                   # recent tasks

forklight submit-plan <plan.yaml>                         # multi-task plan ★
forklight inspect-plan <plan-id> [--json]                 # plan board
forklight board [--json]                                  # all plan summaries

forklight compete <task.yaml> --candidates <json>         # multi-model ★
forklight competition status <id> [--json]                # progress + evaluation
forklight competition compare <id> [--weights <json>]     # per-factor scoring
forklight competition list [--json]

forklight integration preflight <task-id> [--json]        # safety review
forklight integration apply <task-id> \
  --receipt <id> --confirm [--json]                         # MUTATES source ★★
forklight integration history <task-id> [--json]

forklight stats [--provider <n>] [--model <n>] [--json]   # outcomes + failures

forklight settings get                                    # read effective settings
forklight settings set <path> <value>                     # partial update
forklight settings apply <file.yaml>                      # bulk update
forklight settings reset                                  # restore defaults

forklight daemon start | status | stop                    # daemon lifecycle
forklight providers status [<name>] [--json]              # cached, no cost
forklight providers probe [<name>] [--json]               # explicit probe ★
forklight hub [--no-open] [--port <port>]                 # only control-center UI (configure + operate)
forklight doctor [--json]                                 # read-only prerequisites
```

★ May incur provider API charges.
★★ Mutates the source project; requires `--confirm` and a passing preflight receipt.

Set `FORKLIGHT_HOME` to isolate development state. On macOS the default is
`~/Library/Application Support/ForkLight`.

## Codex integration (MCP)

The MCP server (`src/mcp/server.ts`) exposes these tools over stdio:

| Tool | Read-only | Description |
| --- | --- | --- |
| `forklight_health` | yes | Check daemon, Claude Code, and provider readiness |
| `forklight_validate` | yes | Validate a Task Contract without submitting |
| `forklight_submit` | no | Queue a task for execution ★ |
| `forklight_status` | yes | Read one task's current state |
| `forklight_inspect` | yes | Inspect attempts, events, and diff |
| `forklight_resume` | no | Retry an interrupted or failed task ★ |
| `forklight_list` | yes | List recent tasks |
| `forklight_plan_submit` | no | Submit a multi-task Work Plan ★ |
| `forklight_plan_inspect` | yes | Read one plan's board and task states |
| `forklight_plan_board` | yes | List all plan summaries |
| `forklight_statistics` | yes | Query per-provider/model outcomes |
| `forklight_settings_get` | yes | Read effective settings |
| `forklight_settings_update` | no | Apply partial settings patch |
| `forklight_settings_reset` | no | Restore built-in defaults |
| `forklight_integration_preflight` | no | Safety review (never mutates source) |
| `forklight_integration_apply` | no | Apply reviewed patch ★★ |
| `forklight_integration_history` | yes | Read integration receipts and results |
| `forklight_compete_submit` | no | Start multi-model competition ★ |
| `forklight_competition_status` | yes | Read competition progress and evaluation |
| `forklight_competition_compare` | yes | Per-factor scoring with optional what-if weights |
| `forklight_competition_list` | yes | List all competitions |
| `forklight_provider_status` | yes | Read cached provider verification (no cost) |
| `forklight_provider_probe` | no | Explicit live probe ★ |

## Documentation

- [Project Status and Roadmap](PROJECT_STATUS.md) — current capabilities,
  constraints, decisions, and next milestones.
- [Operations Guide](docs/operations.md) — complete workflow, module
  architecture, cost and mutation warnings, recovery.
- [Configuration Guide](docs/configuration.md) — every configurable policy
  section, precedence rules, creation-time snapshot boundaries, and
  non-configurable safety invariants.

## Boundaries

- DeepSeek, Qwen, MiniMax, and GLM share one provider contract. Each task can
  override `provider.model`, `provider.endpoint`, `provider.keychainService`,
  and `provider.keychainAccount` without changing global settings.
- Provider credentials stay in the macOS Keychain and are injected only into
  the Worker child process.
- The macOS Worker sandbox denies reads from the user's home directory except
  the isolated task workspace, task-owned Claude configuration, and runtime
  files. Writes are limited to the task workspace, task-owned configuration,
  and system temporary storage.
- Workers cannot run shell commands, browse the web, commit, push, create pull
  requests, or modify Git remotes.
- Hub binds to loopback only and never exposes credential values.
- Integration apply is the sole path that mutates source. It requires a
  passing preflight receipt, explicit confirmation, and verifies every
  fingerprint before proceeding.

## Default provider configuration

| Provider | Default model | Claude Code endpoint | Keychain service |
| --- | --- | --- | --- |
| DeepSeek | `deepseek-v4-flash` | `https://api.deepseek.com/anthropic` | `forklight.deepseek.api-key` |
| Qwen | `qwen3.7-plus` | `https://dashscope.aliyuncs.com/apps/anthropic` | `forklight.qwen.api-key` |
| MiniMax | `MiniMax-M3` | `https://api.minimax.io/anthropic` | `forklight.minimax.api-key` |
| GLM | `glm-5.2` | `https://dashscope.aliyuncs.com/apps/anthropic` | `forklight.qwen.api-key` |

Qwen and GLM share the Alibaba Keychain service because the current Alibaba
account exposes both model families. Override the service and endpoint
per-task when using a separate GLM account.
