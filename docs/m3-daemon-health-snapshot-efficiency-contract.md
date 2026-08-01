# M3 Contract — Daemon health environment snapshot efficiency

## User outcome

Immediately after a successful Daemon start or restart, several CLI and Hub
health readers can ask the same question without serially repeating expensive
Keychain and Runtime inspection until one caller times out and falsely reports
that every Worker is blocked.

## Evidence that motivates this slice

- A real `forklight health` briefly fell back to local Runtime facts immediately
  after a successful restart, while the same Daemon PID remained alive and a
  following `daemon status` returned healthy.
- One Daemon health request synchronously checks all configured Provider
  authentication paths, Claude Code, and Grok Build.
- Three sequential real `daemon status` reads measured roughly 1.6–8.6 seconds;
  overlapping reads share one event loop and can approach the fixed 15-second
  request boundary.
- Historical `EPIPE` log entries predate the current disconnect guard and are
  not evidence for this incident.

## Required behavior

### Environment snapshot

The Daemon may retain one bounded, in-memory snapshot of expensive local
execution-environment facts:

- Provider readiness derived from readable Keychain/local-sign-in evidence.
- Claude Code and Grok Build doctor results and bounded presentation metadata.
- The compatibility `claudeCode` header derived from the same Runtime snapshot.

The snapshot must contain no credential value, raw subprocess output beyond the
already exposed bounded version/issue fields, filesystem path, or Provider
network result. It is process-local and is never persisted.

### Fresh facts

Every health response must still read these facts fresh:

- PID and build identity.
- active and queued Task IDs.
- current Settings values such as default Runtime and max concurrency.
- cached Provider verification evidence already stored by the existing probe
  service.

Changing or resetting Settings must make any Provider-default-dependent
environment snapshot unusable immediately. A bounded TTL must also refresh the
snapshot so installing or repairing a local Runtime is eventually observed
without restarting forever.

### Concurrency and failure semantics

- The first request after startup may perform the real inspection once.
- Immediate subsequent requests reuse the same complete snapshot rather than
  mixing fresh and cached booleans.
- Expiry or relevant Settings change causes exactly one later refresh on the
  existing synchronous call chain; it does not launch background work.
- Do not add blind client retries, increase the generic 15-second request
  timeout, auto-start another Daemon, probe a Provider network endpoint, or
  convert an inspection failure into success.

## Module behavior

### Health environment cache

- **Consumes:** current Provider defaults, clock, and one loader that performs
  existing Provider/Runtime inspection.
- **Produces:** one immutable complete environment snapshot for a bounded TTL.
- **Boundary:** memory-only, privacy-safe, deterministic with an injected clock
  and loader in tests; no Task, Settings, lifecycle, or Provider mutation.

### Daemon health projection

- **Consumes:** the reusable environment snapshot plus current Settings,
  Provider verification, queue state, PID, and build identity.
- **Produces:** the existing compatible health payload.
- **Boundary:** dynamic fields remain fresh; no response field is removed or
  renamed; no credential or internal cache metadata is exposed.

## Scenarios

1. **Immediate readers after restart** — the readiness health call populates the
   snapshot; following CLI/Hub readers reuse it and see the same Runtime truth.
2. **Live queue change** — a Task becomes queued or active during the TTL;
   health reflects it even though environment inspection is reused.
3. **Settings change** — Provider defaults are updated or reset; the next health
   cannot reuse readiness derived from the old defaults.
4. **TTL expiry** — the fake clock crosses the bound; one new inspection occurs
   and its complete result replaces the old snapshot.
5. **Unavailable Runtime** — a cached negative doctor result remains negative;
   caching never invents availability.

## Out of scope

- CLI/Hub redesign, new UI settings, Worker routing weights, Provider probes,
  Task retries, Integration, activation, daemon request timeout changes, or
  background refresh.
- Elsewhere, Client-Core, Adeptify Shell, SDK/release directories, and all
  SDK/consumer/Nexus documentation.
- Commit or push.

## Acceptance

- Deterministic tests prove one inspection across immediate health reads,
  refresh after TTL, invalidation after Settings mutation/reset, fresh dynamic
  fields, complete-snapshot semantics, and privacy.
- Existing Daemon, CLI runtime-authority, setup-doctor, and Hub status tests pass.
- Full test suite, build, Hub syntax checks, and diff hygiene pass once.

