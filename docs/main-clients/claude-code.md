# Main Client: Claude Code

## Install MCP

Add ForkLight as an MCP server in Claude Code config (stdio → `forklight-mcp`). Ensure Node ≥ 24 and macOS.

## Tool order

`forklight_health` → `forklight_validate` → `forklight_submit` → `forklight_wait` → inspect → `forklight_main_review` → user-authorized integration.

## taskId continuity

Persist **taskId** outside the chat. Recover with `forklight_list` after a new conversation.

## Choosing Worker runtime

Task YAML / MCP `runtime` field, or `execution.defaultRuntime`. Independent of Claude Code being Main.

## Limits

ForkLight Workers edit isolated workspaces only. Final accountability stays with the Main agent and user.
