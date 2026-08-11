# Start-up baseline — 2026-08-09

## Source

- Branch: `main`
- Worktree: 58 changed/untracked paths in the current aggregate diff.
- Aggregate source diff: 21,533 insertions and 4,055 deletions.
- Rule: do not reset, overwrite, commit or push during consolidation.
- Source `git diff --check`: passed at baseline capture.

## Built runtime

- Package: `forklight@0.2.0`
- Build ID: `68ae165df52d4678401b93845e4088b2f8a07bf62db72c791f7b043b25284018`
- Build source digest: `ca39e5f715f6081e3a6296e2be31e24bd8d96bf01b0e33d39a70e061c30d8b21`
- Daemon PID at capture: `13307`
- Hub PID/port at capture: `52551 / 62182`
- No active or queued ForkLight Tasks at capture.

## Worker readiness

- Launchable: DeepSeek Pro, DeepSeek Flash, Volcengine GLM 5.2, MiniMax M3,
  Codex Luna Max and Codex Luna Low.
- Blocked: local Grok Builder, because authentication is missing in ForkLight's
  runtime environment.
- Readiness is a snapshot, not a permanent model-quality conclusion.

## Store

- Tasks: 553
- Attempts: 815
- Events: 288,784
- Goals: 10
- Plans: 13
- Integrations: 192
- SQLite bytes before backup: 439,070,720
- Run directories: 534

## FL-116B

Task `bedf96eb-c725-4535-a1cf-193b7fff0943` passed Worker self-check and
independent verification after one correction. Main rejected Candidate
`18a95294-f530-4769-baeb-72dfe10e1867`: the 14-file, ~700-line
checkpoint-finality implementation is disproportionate because independent
verification is already authoritative. No patch was integrated and no further
repair will be started.

