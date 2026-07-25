# Main Client: Codex

Codex is **one** supported Main client, not the only one.

## Install MCP

Use the bundled plugin under `plugins/forklight` or configure MCP to run `forklight-mcp`.

## Tool order

Same as other Mains: validate → submit → wait → inspect → main_review → authorized integration.

## taskId continuity

Record **taskId**; use `forklight_list` after a new Codex task/session.

## Choosing Worker runtime

Not tied to Codex. Set Task `runtime` / settings `defaultRuntime`.

## Limits

Do not treat ForkLight as a native Codex subagent. Never commit/push without separate user approval.
