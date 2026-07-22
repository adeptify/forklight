# ForkLight development guidance

- ForkLight is the execution and observability layer. The primary Codex agent owns intent, decomposition, routing, review, and user approvals.
- A Worker may edit only its isolated workspace. Never let a Worker commit or push.
- Keep provider credentials in the operating-system keychain and inject them only into the Worker child process.
- Preserve raw runtime events for audit, but expose normalized progress events to users and callers.
- New execution backends must implement the same task, event, attempt, and result contracts.
- Run `npm run check` before reporting implementation work complete.
