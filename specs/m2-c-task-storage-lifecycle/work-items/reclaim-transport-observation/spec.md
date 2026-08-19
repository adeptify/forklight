# M2-C reclaim transport observation window

## User result

An explicitly confirmed real-home `forklight storage reclaim --all-eligible` can finish a normal
local terminal-space batch and return its result to CLI or MCP even when the batch takes longer
than the generic 15-second daemon request window. A client observation ending still never cancels,
replays, or changes the durable reclaim operation.

## Background and evidence

The accepted parent is `specs/m2-c-task-storage-lifecycle/spec.md`. Its storage implementation,
legacy-handoff compatibility Candidate, safe Integrations, independent audits, and full 2,922-test
source check all passed. Main then previewed and explicitly confirmed the real eligible set.

The daemon completed all 248 selected Task dispositions between
`2026-08-14T09:31:38.935Z` and `2026-08-14T09:32:10.738Z`: 363 known regenerable targets and
1,079,179,854 bytes were removed; no process was stopped or refused; every recorded integrity
result was `quickCheck: ok` with zero foreign-key violations. The invoking CLI nevertheless
returned first with:

```text
ForkLight error: ForkLight daemon request timed out: storage_reclaim
```

Focused source inspection proves `daemonRequestTimeoutMs` gives `storage_reclaim` the generic
15-second window, while other operations that legitimately execute long approved work use a long
transport observation window. The reclaim remained durable and was not cancelled, so this is a
result-observation gap, not a deletion/integrity failure.

## `depends_on`

- M2-C lifecycle and authentic legacy-handoff read compatibility are integrated.
- The real authorized reclaim is durably complete and post-reclaim audit has no reclaimable or
  unknown-orphan entry.
- No other product writer runs concurrently. This Work Item is serial because it changes the
  shared daemon-client timeout authority used by CLI and MCP.

## Inputs and outputs

- Input: daemon method plus bounded request parameters at `daemonRequestTimeoutMs`.
- Output: `storage_reclaim` receives a transport window that does not expire before normal local
  batch completion; ordinary short methods retain the existing generic bound.
- The operation remains synchronous and durable. Do not add retry, replay, cancellation, a second
  operation record, polling state, lock, lease, checksum, or request-version protocol.

## Scope and design boundary

Allowed writable paths:

- `src/daemon/client.ts`
- `tests/daemon.test.ts`
- `tests/daemon-cli.test.ts` only if an existing CLI transport contract needs focused coverage
- `tests/mcp.test.ts` only if an existing MCP transport contract needs focused coverage

Forbidden:

- storage eligibility, deletion, disposition, Store schema, daemon server/coordinator, CLI/MCP
  command shape, Hub, Worker policy, Provider/runtime, Integration, or unrelated refactor
- an elapsed-time deadline for the reclaim operation itself
- automatic retry/replay after timeout, cancellation on disconnect, or fabricated success
- multi-user/distributed coordination, locks, leases, hashes, handshakes, schema negotiation,
  commit, push, credentials, or real-home mutation by Worker/tests

The smallest expected product change is to classify `storage_reclaim` with the existing long
mutation transport behavior in the one shared timeout resolver. A fixed transport observation
window is not evidence that reclaim succeeded or failed; the daemon result and durable
dispositions remain authoritative.

## Call chain

1. CLI or MCP confirms one Task or `allEligible` reclaim.
2. `daemonRequest` performs the existing exact-build handshake.
3. `daemonRequestTimeoutMs` supplies a transport observation window long enough for the daemon's
   synchronous reclaim response instead of the generic 15 seconds.
4. The daemon re-evaluates current Store truth, applies only eligible known targets, records each
   result, runs integrity, and replies once.
5. The client renders that exact response. A real transport failure remains a failure and never
   causes a replay.

## Scenarios and acceptance

- `storage_reclaim` without an override receives the established long mutation observation
  window plus response slack; it no longer inherits 15 seconds.
- A valid explicit request timeout, if supported through the shared resolver, receives the same
  response slack and cannot reduce below the existing safe minimum.
- `health`, audit/preview and other ordinary short methods keep their current timeout behavior.
- Existing long `remediation_verify`, `candidate_reverify`, Integration wait and checkpoint wait
  behavior does not regress.
- The fix is shared by CLI and MCP through `daemonRequest`; no duplicated transport-specific
  branch is added.
- Client disconnect/observation expiry still does not cancel or replay a daemon dispatch.
- Focused tests use no real ForkLight Home and do not wait 15 seconds in wall time.

## Verification commands

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/daemon.test.ts tests/daemon-cli.test.ts tests/mcp.test.ts
git diff --check
```

The independent verifier retains the 30-minute per-command safety breaker. The Work Item has no
absolute duration, Token or no-progress deadline.

## Review, handoff and workspace disposition

- The implementation Worker owns research, the smallest patch, self-check and exact handoff.
- ForkLight independently runs all approved commands.
- Because this transport guards a destructive durable operation, two independent read-only Judges
  inspect non-replay semantics and CLI/MCP timeout parity. Main makes the final decision and uses
  safe Integration only.
- Handoff includes this spec, scoped diff, verification and the measured 32-second real batch; it
  includes no raw real-home content.
- Protect Workspace/Candidate/reviews through Integration. After activation, one read-only audit
  verifies the integrated timeout mapping. Do not create synthetic reclaimable data merely to
  rerun the destructive journey.

Stop if the fix requires storage-state redesign, asynchronous operation infrastructure, replay,
Store migration, or scope outside the allowed paths. Two purposeful rounds with the same failure
or no new evidence return a decision packet.

## Completion evidence

- Implementation Task: `2586676a-e679-47f8-875d-3e1de9276426`, honest DeepSeek Pro
  `single-run` because Grok authentication was unavailable.
- Candidate: `6d28c588-3fa8-4610-a20e-be8df0497d1d`, digest
  `754aa1c278c820671d2357d1228a99fdb4c646cf7bc6826dcb488847ad70f1e9`; 2 files, 40 lines.
- ForkLight verification: build, 266 focused tests and diff check passed; source-compatible.
- Review Graph `26d2ed03-6b74-4afa-bbc5-6404e2f84885`: Codex Luna Max and MiniMax M3 both
  proposed accept; Main independently accepted the exact Revision.
- Integration `ca098a68-2f5f-44b7-93a7-a4fe14846816` applied, verified, built and activated.
- Operational Goal completed 4/4; final source check passed 2,924/2,924 tests.
- A post-fix real CLI reclaim ran beyond the former 15-second window and returned 3/3 applied,
  17 targets, 153,970,084 bytes, zero process actions and integrity `ok/0` without replay.

Accepted behavior and scope are complete. Workspace disposition followed the product lifecycle:
the integrated implementation and two terminal Judge Workspaces were reclaimed only after exact
preview; durable evidence remains. Read-only audit Tasks remain protected by current Store truth.
