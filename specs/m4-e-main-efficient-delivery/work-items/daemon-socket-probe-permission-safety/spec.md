# M4-E Work Item — Daemon socket probe permission safety

## User result

A failed local ForkLight Daemon startup must never remove the socket of a healthy Daemon merely
because the new process is not permitted to connect to that socket. The CLI should keep the
healthy endpoint intact, fail with a truthful permission/indeterminate error, and continue to
recover a genuinely stale Unix socket after an explicit connection refusal.

## Background and problem evidence

The stopped Main-offline storage comparison ran two measured Codex `workspace-write` dispatch
segments. In both, `delivery prepare` could not connect to the operator Daemon and attempted local
bootstrap. The second process logged `listen EPERM` and returned `daemon process exited before
becoming ready`; no Task was created.

After each attempt the canonical socket path disappeared while the original Daemon process stayed
alive. Focused source audit shows the exact cause: `probeSocketEndpoint()` maps every connection
error and timeout to `false`; `start()` interprets `false` as a stale socket, rechecks only inode
identity, unlinks it, and then calls `listen()`. Thus `EPERM`, `EACCES`, timeout and a real
`ECONNREFUSED` are incorrectly treated as the same state.

This is a one-machine lifecycle bug, not a need for a lock, lease, checksum or distributed
coordination scheme.

## `depends_on`

- M4-E Main-offline usage episode delivery is activated and its full suite passed.
- The stopped comparison and its two failed Main terminal segments remain immutable evidence; this
  Work Item does not authorize another comparison dispatch.
- Main terminated exactly the two orphan Daemon PIDs and restored one matched Daemon with no active
  or queued Task.
- Grok 4.6 Xhigh is launchable as native Goal after a current `AUTH_OK` smoke.

## Inputs and outputs

Inputs:

- `src/daemon/server.ts` socket discovery, probe, unlink, listen and close lifecycle.
- Existing focused Daemon tests around active endpoint rejection, real stale-socket recovery and
  socket replacement during probe.
- Real error evidence: `EPERM` must not be interpreted as stale; a genuine refused endpoint must
  remain recoverable.

Outputs:

- One minimal socket-probe result that distinguishes connected, explicitly refused/stale, and
  indeterminate/permission-denied outcomes.
- Focused regressions proving the destructive unlink is allowed only for the explicit stale case
  and still guarded by the existing same-inode recheck.
- One verified Candidate, two independent Judge opinions and Main serial Integration.

## Production behavior and decisions

1. A successful connection means another Daemon is active; `start()` keeps the socket and returns
   the existing `already running` failure.
2. Only the concrete local stale-endpoint condition used by the supported Unix platform may enter
   the existing inode recheck and unlink path. `ECONNREFUSED` is the expected named condition.
3. `EPERM`, `EACCES`, timeout and unknown connection errors are indeterminate. `start()` must fail
   closed with a non-secret diagnostic and leave the socket byte-for-byte/inode intact.
4. A socket replaced after the probe remains protected by the current inode check.
5. Normal start, active-Daemon rejection, real stale-socket recovery and `close()` ownership
   behavior remain compatible.

Do not add process registries, PID files, locks, leases, retries, hashes, version handshakes or a
second coordination mechanism. The smallest error-aware probe is the accepted design boundary.

## Allowed and forbidden paths

Allowed:

- `src/daemon/server.ts`
- `tests/daemon.test.ts`

Forbidden:

- Daemon client/protocol/coordinator, Store/schema, CLI/MCP, Worker Runtime/Profile, Main Token
  accounting, comparison roots/evidence, Hub/UI, credentials, Git history/remotes and every other
  path.
- No real operator-Home mutation in Worker tests. Use temporary homes and controlled probe seams.
- No Task retry/replacement, model switch, third Judge, commit, push or reset.

## Acceptance

1. Active endpoint behavior still rejects the second Daemon without changing the live socket.
2. Real stale Unix socket behavior still recovers and becomes a healthy endpoint.
3. A focused controlled `EPERM` probe makes `start()` reject, preserves the exact pre-existing
   socket inode/path and never reaches unlink/listen.
4. `EACCES`, timeout or unknown failures are handled by the same fail-closed branch without a broad
   platform abstraction; tests cover every production branch the patch introduces.
5. The existing replaced-after-probe protection and close ownership tests still pass.
6. Candidate changes exactly the two allowed paths, contains no unrelated refactor and introduces
   no new dependency or coordination state.

## Verification commands

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/daemon.test.ts
git diff --check
```

ForkLight acceptance commands retain the local 30-minute command breaker. Worker duration, Token
and no-progress limits are unset.

## Handoff and workspace disposition

Handoff names the Task/Attempt/native Goal, exact Revision/digest, changed paths, probe outcome
shape, focused tests, independent verification, two Judge results, Main decision and Integration.
The Task Workspace stays protected through final decision and activation. This Work Item does not
resume, replace or replay the stopped Main Token pair; a later change to that explicit stop
boundary requires a separate Main decision.

One purposeful validation repair or same-Worker Main correction may close one concrete gap. Stop
on repeated failure, source drift, a need for another writable path or any design that requires
coordination machinery.
