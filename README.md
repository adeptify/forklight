# ForkLight

ForkLight is a local-first execution and observability layer for persistent coding Workers. The primary Codex agent remains responsible for understanding intent, aligning the solution, assigning work, reviewing results, correcting failures, and requesting approval for commits or pushes.

## P2 execution flow

1. Codex uses the ForkLight Skill to decide whether a bounded task should be delegated.
2. The ForkLight MCP server accepts the task and immediately returns a task ID.
3. A local daemon records the task in SQLite, prepares an isolated baseline and workspace, and schedules it with a configurable concurrency limit.
4. Claude Code supplies the ReAct runtime while the selected DeepSeek model performs the implementation. The Worker receives file read/edit tools but no shell or web tools.
5. ForkLight independently runs the declared acceptance commands, fingerprints the source project, and stores normalized progress, raw runtime events, attempts, verification output, and the final diff.
6. Codex polls status, inspects the result, and decides whether to accept, correct, resume, or replace the attempt.

Interrupted tasks are detected when the daemon restarts and are queued for recovery. The original project is never edited by the Worker; accepted changes still require a deliberate integration step by the primary agent.

## CLI

Build and install the local command:

```bash
npm install
npm run check
npm link
```

Run foreground or persistent tasks:

```bash
forklight run examples/deepseek-checkout.yaml
forklight submit examples/deepseek-checkout.yaml
forklight status <task-id>
forklight inspect <task-id>
forklight resume <task-id>
forklight list
forklight daemon status
forklight health
```

`run` stays attached to one attempt. `submit` queues the task in the daemon and returns without waiting for workspace copying or Worker execution.

Set `FORKLIGHT_HOME` to isolate development state. On macOS the default is `~/Library/Application Support/ForkLight`.

## Codex integration

The personal Codex plugin lives at `~/plugins/forklight`. Its MCP server exposes:

- `forklight_health`
- `forklight_submit`
- `forklight_status`
- `forklight_inspect`
- `forklight_resume`
- `forklight_list`

The plugin Skill routes persistent or external-model coding work through ForkLight while keeping small direct edits and lightweight native-agent exploration in Codex. A new Codex task is required after installing or updating the plugin.

## Boundaries

- P2 supports DeepSeek models through Claude Code. Additional providers and runtimes must implement the same task, attempt, event, and result contracts.
- Provider credentials stay in the macOS Keychain and are injected only into the Worker child process.
- The macOS Worker sandbox denies reads from the user's home directory except the isolated task workspace, task-owned Claude configuration, and runtime files. Writes are limited to the task workspace, task-owned configuration, and system temporary storage.
- Workers cannot run shell commands, browse the web, commit, push, create pull requests, or modify Git remotes.
- ForkLight does not yet include the visual console or automatic patch integration.
