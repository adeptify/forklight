# ForkLight Project Status

Last updated: 2026-07-24

## Product boundary

ForkLight is the local execution, safety, and observability layer for bounded
external coding Workers. Main Codex remains accountable for intent, Task
Contract quality, independent review, user authorization, and the decision to
integrate. A Worker never receives arbitrary Shell, web, original-project
write, Git commit, or push authority.

The Console is a read-only decision surface, not a second orchestration brain.

## Current milestone: lean core complete in the working branch

The five-wave lean-core refactor is implemented in
`codex/lean-core-refactor`. It keeps the existing persistence model and adds no
new database table.

Delivered:

- Verification separates behavior, policy, source compatibility, and global
  source drift. Unrelated drift is audit evidence; affected-path conflict is a
  hard failure.
- Workspace patch evidence has distinct business, generated, and integration
  views. Integration applies only the reviewed integration patch.
- Change-budget policy supports `hard`, `warn`, `score`, and `off`; Task and
  Integration limit conflicts are visible at validation time.
- One explicit extra Attempt can be authorized without changing global Task
  settings. Main Codex review is durable and bound to the exact verification it
  reviewed.
- Workers must run a bounded checkpoint by deterministic `acceptance-N`
  command IDs. It has no arbitrary Shell and remains non-authoritative;
  ForkLight independently reruns every command. Missing or failed checkpoint
  evidence prevents a Task from reporting success.
- Integration is asynchronous and recoverable by operation ID. Its durable
  stages are `source-applied`, `source-verified`, `artifact-built`, and
  `runtime-activated`; a wait timeout means outcome unknown, never failure.
- Build and protocol identity are exposed by health checks and daemon
  handshakes. Stale builds cannot mutate state; shutdown remains available so a
  new build can replace an old daemon.
- Activation uses a protected, one-time handoff and records build and runtime
  command evidence.
- CLI, MCP, and Console consume one canonical `TaskDecisionView`. Worker claims
  are explicitly unverified and bounded in the default view; full evidence
  remains available through deep inspect.
- Delivery lineage distinguishes cumulative correction churn from the final
  combined delivery diff.

## Real self-hosting evidence

The final DeepSeek Pro Task
`cce02568-5653-4123-9d8d-e246cfdb28d0` exercised the whole lifecycle:

1. Attempt 1 could not start the checkpoint MCP and was truthfully failed even
   though independent commands passed.
2. The sandbox dependency and daemon-socket boundary was repaired.
3. Attempt 2 connected the checkpoint MCP and passed all three approved
   commands.
4. Main Codex found contradictory optional wording and requested a revision.
5. Attempt 3 corrected it, reran the checkpoint, and passed independent
   verification.
6. Main Codex accepted the exact latest verification.
7. Integration operation `03c8226b-b8b4-43c8-8712-3fde8147db3d` passed all
   four stages and activated the rebuilt daemon.

The Console was then inspected in the in-app browser. It displayed the current
stage and next action, Worker identity and unverified claim, independent
verification, Main Codex decision and reason, explicit Integration
authorization, all four delivery stages, and correction lineage without
opening raw Event JSON. Browser console errors: none.

## Validation

Final acceptance requires all of the following to remain green:

```bash
npm run check
npx tsc -p tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters
git diff --check
```

The exact final test count and requirement map are recorded in
`docs/superpowers/reports/2026-07-23-forklight-lean-core-refactor-verification.md`.

## Honest external limits

- DeepSeek `deepseek-v4-pro[1m]` has no exact supported official-price identity
  in the current catalog. Its Claude-side runtime estimate is not a Provider
  bill.
- MiniMax aggregate terminal usage cannot resolve request-level pricing tiers;
  official cost remains `per-request-usage-required`.
- Provider readiness and cached live-probe evidence are separate. A configured
  credential does not make an old failed probe become verified.
- ForkLight still does not commit or push on behalf of a Worker.
