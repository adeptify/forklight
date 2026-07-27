# ForkLight

ForkLight is a local-first execution and observability layer for bounded coding
Workers. A **Main** agent (Codex, Claude Code, Grok Build, OpenCode, or a human
using CLI) stays accountable for intent, Task Contracts, review, and integration
approval. Workers never get arbitrary shell, web, or source-tree write authority.

The only browser control center is **`forklight hub`**.

## Execution flow

1. Main decides whether a bounded task should be delegated.
2. The ForkLight MCP server or CLI accepts the task and immediately returns a task ID.
3. A local daemon records the task in SQLite, prepares an isolated baseline
   and workspace, and schedules it with a configurable concurrency limit.
4. A Worker runtime (default `claude-code`, optional `grok-build` with xAI)
   implements the change under a hard tool policy.
5. ForkLight independently runs the declared acceptance commands, fingerprints
   the source project, and stores progress, events, verification, and the diff.
   **Independent verification is authoritative** for terminal success; Worker
   checkpoint MCP is a non-authoritative self-check and does not false-fail a
   green independent verify.
6. Main polls status, inspects the result, records main review, and only then
   may authorize integration into the original project.

Interrupted tasks are recovered when the daemon restarts. The original project
is never edited by the Worker.

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

### 1. Install

```bash
# from this repo
npm install
npm run build
npm link          # puts forklight + forklight-mcp on PATH
```

Or: `npm install -g github:adeptify/forklight`

Prereqs: macOS, Node.js 24+, Claude Code CLI (for the default Worker), and a
provider key you will store via Hub (DeepSeek/etc. in Keychain).

### 2. Open Hub (daemon + UI)

```bash
forklight hub
```

One command starts the **backend daemon** and the **Hub UI** on `127.0.0.1`.
Ctrl+C stops Hub UI only; stop the daemon with `forklight daemon stop`.

In the browser (no hand-editing of Main configs for the guided path):

1. **Models** - provider, model id, optional endpoint; paste API key (Keychain only)
2. **Workers** - runtime (`claude-code` / `grok-build`) + model + per-worker budget/effort;
   Advanced also controls duration, Token/file/line guidance, Attempt/adaptation
   bounds, enforcement modes, concurrency, and the optional official pricing route
3. **Main** - install **Plugin** (Codex only), **MCP**, and/or **Skill** for each client
4. Overview **Services** - confirm the task service is up (Start if needed)

Overview shows a readiness checklist (Models → Workers → Main channel → task service).
Board cards show whether a running task is updating, quiet, or has been quiet for several minutes.

### 3. Main session (Grok / Codex / Claude Code)

1. Open a **new** Main session after MCP install (old sessions do not reload MCP).
2. Call tools in order: `forklight_health` → `forklight_validate` → `forklight_submit`
   → `forklight_wait` → `forklight_inspect` / `forklight_main_review`.
3. Or use CLI: `forklight submit path/to/task.yaml` then `forklight wait <task-id> --until terminal`.

Keys never leave Keychain. Main configs only receive the `forklight-mcp` command path.

### Operate from Hub (same daemon as CLI)

| Area | Hub actions |
|------|-------------|
| Daemon | Start, stop, restart, live health (pid, queue, identity) |
| Tasks | Submit an already-authored absolute Task Contract (confirm), resume, revise, main review, preview/apply one bounded policy adaptation, guided direct-Codex capture, integration preflight / apply, history |
| Providers | Status + **explicit** billable probe (confirm required) |
| Compete | Status detail + compare/evaluate |
| Board / Plans / Insights | Live operate views (read + supervise) |

Hub submit deliberately accepts only an already-authored absolute YAML/JSON
Task Contract path with explicit billable confirmation. Contract authoring and
decomposition remain Main responsibilities; Hub does not invent a second plan.

For a new structured Task, Main can also provide the short explanation that the
Hub should show first:

```yaml
contract:
  outcome: The precise technical result the Worker must produce.
  presentation:
    summary: "用一句话告诉用户，这次任务要解决什么、完成后会得到什么。"
    language: zh-CN
```

`presentation` is optional so older Tasks remain valid. ForkLight displays the
summary exactly as Main wrote it; it does not guess, rewrite, or translate it.
The technical outcome, scope, checks, and evidence remain available underneath
and continue to control execution and acceptance.

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
forklight correct <task-id> --feedback <text> \
  [--max-budget-usd <number|none>] --confirm              # reuse candidate with one Worker correction ★
forklight reverify <task-id> \
  --reason <bounded-reason> --confirm [--json]             # rerun checks only; no Worker or new Attempt
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

forklight main-review <task-id> \
  --decision <accept|revise|reject> --reason <text> --confirm

forklight remediate verify <task-id> \
  --reason <bounded-reason> --confirm [--json]             # verifies repaired source; preserves machine failure

forklight adapt preview <task-id> \
  --patch <json> --reason <bounded-reason> [--json]        # read-only
forklight adapt apply <task-id> \
  --patch <json> --reason <bounded-reason> --confirm [--json] # creates at most one successor

forklight tokens <task-id> [--json]                       # Worker/exchange/savings evidence
forklight direct-codex capture-task \
  --task-id <id> --run-ref <codex-run:id> \
  --usage <turn.completed-json> [--json]                  # pending count-only sample
forklight direct-codex inbox \
  --task-class <class> --profile-id <id> [--json]
forklight direct-codex review --sample-id <id> \
  --decision <accepted|rejected> --reviewer <name> \
  --reviewed-at <canonical-ISO> --schema-version 1 --confirm [--json]
forklight direct-codex publication-preview \
  --task-class <class> --profile-id <id> [--json]
forklight direct-codex publication-register \
  --task-class <class> --profile-id <id> --method <method> \
  --confidence <level> --created-at <canonical-ISO> --confirm [--json]

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
| `forklight_main_review` | no | Record an explicit Main accept/revise/reject decision |
| `forklight_correct` | no | Explicitly reuse a failed candidate for one bounded Worker correction ★ |
| `forklight_candidate_reverify` | no | Rerun all original checks on an eligible retained candidate without a Worker or new Attempt |
| `forklight_remediation_verify` | no | Verify repaired current source and record a separate delivery disposition |
| `forklight_adaptation_preview` | yes | Preview one bounded successor policy change |
| `forklight_adaptation_apply` | no | Explicitly create at most one bounded successor ★ |
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
| `forklight_direct_codex_capture_task` | no | Capture a pending count-only direct-Main sample using stored Task identity |
| `forklight_direct_codex_capture` | no | Advanced explicit-metadata capture adapter |
| `forklight_direct_codex_inbox` | yes | List exact-pair samples and review state |
| `forklight_direct_codex_review` | no | Record immutable explicit Main sample review |
| `forklight_direct_codex_publication_preview` | yes | Preview exact-pair publication readiness |
| `forklight_direct_codex_publication_register` | no | Register a versioned reviewed baseline with explicit confirm |
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

- DeepSeek, Qwen, MiniMax, GLM, and Volcengine Coding Plan share one provider contract. Each task can
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
| Volcengine Coding Plan | `glm-5.2[1M]` | `https://ark.cn-beijing.volces.com/api/coding` | `forklight.volcengine.api-key` |
| GLM | `glm-5.2` | `https://dashscope.aliyuncs.com/apps/anthropic` | `forklight.qwen.api-key` |

Qwen and GLM share the Alibaba Keychain service because the current Alibaba
account exposes both model families. Override the service and endpoint
per-task when using a separate GLM account.
