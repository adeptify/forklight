# Main Client: Grok Build

Use Grok Build as the **Main** agent (orchestration). Workers are separate.

## Install MCP

1. Ensure `forklight` / `forklight-mcp` is on `PATH` (`npm link` or global install from this repo).
2. Configure Grok MCP (see Grok user guide `07-mcp-servers.md`) with a server that runs:

```bash
forklight-mcp
```

3. Set `FORKLIGHT_HOME` if you need a non-default state directory.
4. First call: `forklight_health` (or CLI `forklight doctor`).

## Tool order

1. `forklight_validate` — contract quality + budget / integration feasibility  
2. `forklight_submit` — record returned **taskId**  
3. `forklight_wait` — prefer over tight status loops  
4. `forklight_status` / `forklight_list` — milestones only  
5. `forklight_inspect` (summary) when terminal  
6. `forklight_main_review` — Main judgment (not Integration)  
7. Integration only after explicit user authorization  

## taskId continuity

- Always save `taskId` from submit.  
- After a new Grok session, use `forklight_list` or the saved UUID — do **not** rely on chat history alone.  
- Same `FORKLIGHT_HOME` as the daemon that owns the tasks.

## Choosing Worker runtime

- Default Worker is often `claude-code` (settings `defaultRuntime`).  
- For a Grok **Worker** (not Main), select the saved `grok-4-6-xhigh` Profile or set Task `runtime.name: grok-build`, `provider.name: xai`, model `grok-4.6`, and effort `xhigh`.
- New `auto` Grok Tasks resolve to `native-goal`: first launch sends `/goal <Worker contract>` with `--session-id`, ordinary continuation sends `/goal resume` on the same Session/Goal, and an authorized correction after native completion starts a successor `/goal` in the same Session. Explicit `persistent-session` still uses `--session-id` / `--resume` without claiming native Goal. Omitted historical Grok records stay `single-run`.
- Being Main=Grok does **not** auto-switch Worker to grok-build.

## Grok as Worker (OAuth)

ForkLight seeds task-local `GROK_HOME` from operator `~/.grok/auth.json` (+ `agent_id`) when Keychain `forklight.xai.api-key` is absent.  
Sessions/writes stay under the task directory; the outer sandbox still allows **read** of operator `~/.grok` for CLI bundled assets.  
Headless tool runs use `--always-approve` (not interactive TUI).

## Limits

- Main Grok session is not the Worker sandbox.  
- Do not commit/push via ForkLight.  
- Worker claims are non-authoritative; independent verify always runs.  
- Checkpoint MCP is unsupported on Grok → `checkpoint.skipped`; independent acceptance still runs.
- Grok `nativeGoal` is supported for `grok-build`. Success still requires native `complete` plus `achieved` plus Task-owned classifier details; process exit and assistant prose are not enough. Do not relabel historical `persistent-session` Tasks.
