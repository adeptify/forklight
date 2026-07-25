# Main Client Packs

ForkLight has two planes:

| Plane | Who | How |
| --- | --- | --- |
| **Main** | Claude Code, Grok Build, OpenCode, Codex, or a human | Calls MCP / CLI / Hub |
| **Worker** | `claude-code`, `grok-build`, … | Spawned by ForkLight per Task |

**Main session ≠ Worker sandbox session.** Continuity across Main chats is **`taskId`** plus the same `FORKLIGHT_HOME`.

Worker runtime is **not** auto-selected from the Main product. Set `runtime` on the Task (or `execution.defaultRuntime` in settings).

## Packs

| Client | Doc |
| --- | --- |
| Grok Build | [grok-build.md](./grok-build.md) |
| Claude Code | [claude-code.md](./claude-code.md) |
| Codex | [codex.md](./codex.md) |
| OpenCode | [opencode.md](./opencode.md) |

Each pack documents: **Install MCP** · **Tool order** · **taskId continuity** · **Choosing Worker runtime** · **Limits**.
