# Main Client: OpenCode

## Install MCP

Configure OpenCode MCP to launch `forklight-mcp` (or call CLI `forklight` from the agent shell if MCP is unavailable).

## Tool order

validate → submit → wait → status/list sparingly → inspect → main_review → user-authorized integration.

## taskId continuity

Store **taskId** from submit. List tasks if the OpenCode session is reset.

## Choosing Worker runtime

Explicit Task `runtime` / `defaultRuntime`. Main=OpenCode does not auto-select an OpenCode Worker (Worker adapters for OpenCode are future work).

## Limits

Keep Main context separate from Worker sandbox. Independent verification remains authoritative.
