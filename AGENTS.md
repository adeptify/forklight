# ForkLight development guidance

- Read `goals/forklight-main-token-leverage/contract.md`, `plan.md`,
  `progress.md`, and `decisions.md` before meaningful ForkLight work. That
  Goal directory is the only project-management entry point. Reconcile it
  against Git, Store, build, Daemon, CLI/API and Hub truth at stable
  checkpoints; never create a second status, roadmap, progress, or dogfood log.
  `PROJECT.md` is a temporary legacy snapshot to be compressed during
  start-up consolidation.
- **ForkLight must dogfood ForkLight for its own meaningful iteration.** For
  every non-trivial ForkLight feature, bug fix, refactor, or product-quality
  change, the Main must first run `forklight health`, define a bounded Task
  Contract with independent acceptance, and use ForkLight for at least one
  useful implementation or independent-review slice. Prefer delegating the
  implementation itself; do not submit a ceremonial documentation Task merely
  to satisfy this rule. The Main still owns design alignment, Candidate review,
  bounded correction, source verification, and safe Integration.
- Direct Main editing is allowed only for a tiny tightly-coupled change, a
  documentation-only update, or the minimum recovery/bootstrap work needed
  when ForkLight cannot safely run the requested slice. Record that reason in
  `PROJECT.md`. After recovery or bootstrap, the next eligible slice must go
  through ForkLight so the restored or new capability is exercised for real.
- Preserve dogfood truth: never invent a successful Task, Candidate, review, or
  Integration; never rerun solely to manufacture M0 streaks, model samples, or
  favorable statistics. Feed the useful failure, cost, and usability evidence
  back into the relevant `PROJECT.md` action and ForkLight's product behavior.
- ForkLight is the execution and observability layer. The primary Codex agent owns intent, decomposition, routing, review, and user approvals.
- A Worker may edit only its isolated workspace. Never let a Worker commit or push.
- Keep provider credentials in the operating-system keychain and inject them only into the Worker child process.
- Preserve raw runtime events for audit, but expose normalized progress events to users and callers.
- New execution backends must implement the same task, event, attempt, and result contracts.
- Run `npm run check` before reporting implementation work complete.
