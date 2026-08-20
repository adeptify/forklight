# Checkpoint start identity handshake

## Background and goal

The accepted pre-commit simplification is publication-ready except for one full-suite gate:
`checkpoint operation protocol completes end-to-end through bounded daemon waits` requires the
`checkpoint_start` request to return in under 1,000 ms. The same unchanged test failed twice at
1,306 ms and 1,693 ms. 一骏 has authorized one narrow investigation and repair before commit/push.

The goal is to keep the existing fail-closed client/Daemon build-identity protection for mutating
requests while removing the full Runtime/Provider health scan from the mutation preflight. A cold
`checkpoint_start` must remain an actually short exchange and must not wait for its acceptance
command or for unrelated environment discovery.

## Current behavior and evidence

- `daemonRequest()` treats `checkpoint_start` as mutating and first calls
  `daemonExchange("health", ...)` before the actual request.
- `health` constructs the complete environment snapshot, including Runtime and Provider readiness.
  A fresh diagnostic fixture measured this preflight at about 562 ms on 2026-08-20.
- The same fixture measured the actual `checkpoint_start` exchange at about 1.7 ms; its `sleep 1`
  acceptance command remained in the background.
- The Daemon independently compares `request.clientIdentity` with its own identity before
  dispatching every mutating method. The existing client preflight still matters because it must
  refuse an old or incompatible Daemon before sending the mutation; it must not simply be deleted.
- No pre-commit simplification path changed checkpoint, Daemon client or protocol code.

## User and call scenarios

1. A current client sends a mutating request to a current Daemon: a lightweight identity-only
   preflight succeeds, then the mutation runs once.
2. The Daemon build or protocol is stale: the client rejects before the mutating request is sent.
3. A read-only request: behavior remains one ordinary exchange and mismatch remains advisory where
   currently allowed.
4. A cold `checkpoint_start`: the response reports `running` in under 1,000 ms while the approved
   command continues in the background and later produces the same durable report.
5. Full `health`: still returns complete Runtime, Provider and operational truth; it is not weakened
   or repurposed as an identity-only projection.

## Scope and non-goals

In scope:

- Add the smallest explicit, read-only identity preflight protocol path or equivalent clear
  single-responsibility mechanism.
- Make mutating `daemonRequest()` use that lightweight preflight before sending the real mutation.
- Preserve the Daemon's own build/protocol enforcement on the actual mutating request.
- Add focused regression coverage for cold checkpoint timing and fail-closed identity mismatch.

Out of scope:

- Loosening the 1,000 ms assertion, warming health in the test, caching away required live health
  truth, changing checkpoint execution semantics, or changing acceptance-command duration.
- Provider/Runtime discovery redesign, Daemon scheduling, Store/schema changes, Hub changes,
  dependency changes, protocol version migration, or unrelated client refactoring.
- Commit or push from the Worker.

## Design and key decisions

- Identity compatibility and environment health are different responsibilities. Mutation safety
  consumes only the response-envelope build identity; user health continues to consume the full
  coordinator health projection.
- The client must complete identity comparison before the actual mutating exchange. Relying only on
  the current server's post-receipt enforcement is insufficient protection against an older Daemon.
- The new preflight must be read-only, side-effect free, bounded, and must not call the coordinator
  health path or inspect credentials/providers.
- The actual mutation still carries `clientIdentity`, so current Daemons retain defense in depth.

## Inputs, outputs, dependencies, and call chain

- Input: `DaemonMethod`, request params, client build identity and Daemon response identity.
- Output: either a verified compatible identity followed by exactly one mutation request, or a
  pre-mutation build/protocol error.
- Dependency: existing `BuildIdentity`, `compareBuildIdentity`, response envelope and
  `requiresMatchingBuildIdentity()` policy.
- Call chain: `daemonRequest(mutating)` → lightweight identity preflight → compare identities →
  one actual `daemonExchange(mutating)` → server identity enforcement → dispatch.
- Full health chain remains: explicit `health` request → coordinator health → cached complete
  Runtime/Provider environment plus fresh operational facts.

## File and module boundary

Allowed production paths:

- `src/daemon/protocol.ts`
- `src/daemon/client.ts`
- `src/daemon/server.ts`

Allowed focused test paths:

- `tests/daemon.test.ts`
- `tests/checkpoint-operation.test.ts`

Forbidden: every other production/test/document path, generated `dist`, Store data, credentials,
real Provider/Task mutation, commit and push.

## Acceptance criteria

- Cold `checkpoint_start` returns `running` under the unchanged 1,000 ms assertion and completes
  the command exactly once through the existing bounded wait/report lifecycle.
- Mutating client requests compare build/protocol identity before the actual mutation is sent.
- Stale build and protocol mismatch remain fail-closed with stable human-readable errors.
- The actual Daemon mutation guard remains present; read-only mismatch and shutdown semantics do
  not regress.
- Full health retains its complete current output and no identity preflight opens Provider or
  credential inspection.
- Only allowed paths change; no generated/debug/unrelated output is included.
- ForkLight independent verification, two independent read-only Judges and Main review accept the
  exact Candidate before safe Integration.
- After Integration, `npm run check` passes completely before commit and push.

## Verification

- `npm run build`
- `node --disable-warning=ExperimentalWarning --test --import tsx tests/checkpoint-operation.test.ts`
- `node --disable-warning=ExperimentalWarning --test --import tsx --test-name-pattern='identity matching protects state changes|daemon exposes identity' tests/daemon.test.ts`
- `git diff --check`
- Main after Integration: `npm run check`

## depends_on and parallel conditions

- `depends_on`: accepted Revision `f427a0f2...` and the recorded two-run timing failure.
- This is the only product-code writer. It is not parallel with another Daemon/protocol/client
  change because those interfaces are shared.

## Handoff and workspace disposition

Handoff must name the exact surviving mutation-safety chain, timing evidence, changed paths,
verification results and any compatibility risk. The Candidate Workspace remains protected through
Main review, two Judges and Integration. After terminal accepted Integration, normal auditable
workspace reclamation may proceed; unresolved or reusable partial work remains protected.

## Assumptions and open questions

- Assumption: the full health scan is the only material cold-start delay; the focused Candidate
  must prove this through the unchanged timing test.
- No open product choice remains. If compatibility requires a protocol migration or a path outside
  the allowed files, stop and return a decision packet instead of expanding scope.

## Execution result — 2026-08-21

- Passed: Grok 4.6 Xhigh native-Goal Task `3971252c...` produced exact four-path Revision
  `045796d9...` with no retry or correction.
- Passed: independent verification ran all four accepted commands; checkpoint operation tests are
  13/13 and focused identity tests are 2/2.
- Passed: two independent Judges returned usable `accept` with no Blocker/P1; Main accepted the
  exact digest `75defc38f686...`.
- Passed: safe Integration `632c0b08...` completed source apply/verify, artifact build, Daemon
  activation and matched identity.
- Passed: post-Integration `npm run check` is 3,181/3,181, including the unchanged cold checkpoint
  timing gate under full-suite load.
- Not run: none of the Spec-required checks.
- Remaining risk: the public `identity` method must stay envelope-only; focused tests fail if it
  starts loading full health. The deferred unfamiliar-human M5-C evidence is unrelated and remains
  missing.
