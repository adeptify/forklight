# M5-A3R — Socket-safe clean-bundle runtime Home

## User result

`bundle:clean` can verify its installed Hub and Daemon even when the requested output directory has
a long path. Its ephemeral ForkLight runtime Home always produces a macOS-readable Unix socket path,
and that exact temporary root is removed after success or failure.

## Background and root-cause evidence

The accepted diagnostic Candidate and one external run established:

`prior=daemon-identity-mismatch cleanup=returned hubGone=true daemonGone=false`

The bundle's current staging-derived socket path is 113 UTF-8 bytes for the accepted external
parent:

`.../.forklight-clean-run-staging.<suffix>/work/home/forklight.sock`

The local macOS SDK declares `sockaddr_un.sun_path[104]`; the path plus terminating null therefore
must fit within 104 bytes. Hub deliberately still starts when its internal `ensureDaemon()` fails,
so Hub readiness can be true while the overlong Daemon socket never binds. The immediate installed
`daemon status` then fails and cleanup cannot reach that endpoint.

The same freshly packed and installed build was run from an external 93-byte socket path. Both a
normal sequence and an immediate `hub restart → hub status → daemon status → health` sequence
reported matching client/Daemon identity, and public `daemon stop` returned exact authoritative
success. This rules out Provider readiness, a general startup delay and the public stop timeout for
this reproduction.

## `depends_on`

- M5-A1 and M5-A2 graduated.
- Stale-PID cleanup Integration `0cfebb72-16b7-4c8e-912d-c45b544fa8fa` applied.
- Diagnostic Task `91321ce5-c8ae-4154-8da3-a58d87eb5750`, Revision
  `e5466ab0-d7e2-4d93-83c0-77fcc28cabe0` and Integration
  `e282a286-e92b-4483-ad48-3121ceaa3a22` applied.
- Post-diagnostic full check passed 3,147/3,147 and the single diagnostic bundle produced the exact
  closed result above without publishing.

## Inputs and outputs

Inputs: one long requested output path, the existing private staging/work root, the OS temporary
directory, and the existing installed Hub/Daemon lifecycle.

Outputs:

- unchanged atomic bundle artifacts under the requested output on success;
- one private, unpredictable, owner-only ephemeral runtime root outside the long staging path;
- an isolated `FORKLIGHT_HOME` below that root whose `forklight.sock` path fits the Darwin
  `sun_path[104]` boundary;
- exact cleanup of that runtime root after owned process cleanup on success or failure.

The npm prefix, npm Home/cache, tarball, staging and publication remain under the existing private
staging tree. Only the ephemeral ForkLight Home moves.

## Scope and path ownership

Allowed writable paths:

- `src/clean-run/build-clean-run-bundle.ts`
- `tests/clean-run-bundle.test.ts`

Forbidden paths and behaviors:

- Core socket/config schema, global Daemon/Hub behavior, public setup/backup, Store schema, retries,
  timeout increases, process scans, locks, leases, checksums, UI, docs, fixtures or Goal SSOT.
- A fixed shared temp directory, predictable cross-run reuse, symlink ownership workaround, output
  path shortening, real Home, credential copying, manual database edits, commit, push or reset.
- Deleting the runtime root before owned Hub/Daemon cleanup has completed.

These paths overlap prior A3 work, so this is the only Writer and runs serially. Main alone updates
SSOT, reviews the actual Candidate and performs Integration.

## Required behavior

1. Create one unique private temporary root using the OS temp facility and derive the isolated
   ForkLight Home below it. Do not derive it from the requested output or staging path.
2. Before launching installed Hub/Daemon on Darwin, prove the UTF-8 byte length of
   `<isolatedHome>/forklight.sock` plus its terminator fits `sun_path[104]`. A violation fails before
   process launch with a bounded category and no path text.
3. Keep npm prefix/Home/cache, package scan, identity comparison and atomic publication unchanged.
4. Use the short Home for installed CLI/MCP/Hub/Daemon calls that currently consume isolated Home.
5. Stop owned processes first, then remove only the exact generated runtime root. Remove it on both
   successful publication preparation and every failure path; never scan or reclaim unrelated temp
   entries.
6. Preserve the diagnostic failure projection and stale-PID authority/fallback behavior.

## Acceptance

- A deliberately long output/staging path no longer becomes the Daemon socket parent; captured
  lifecycle commands use a distinct short `FORKLIGHT_HOME` whose Darwin socket path fits 104 bytes
  including the null terminator.
- The unique runtime root is mode-private and absent after both a successful bundle and an injected
  verification/cleanup-safe failure.
- A too-long injected OS temp result fails before Hub/Daemon launch without printing the path.
- Existing atomic publication, failed-publication cleanup, authoritative-stop, fallback and closed
  diagnostic tests remain passing.
- Exactly the two allowed files change; no retry, timeout, process ownership or public schema change
  is introduced.
- Grok 4.6 Xhigh uses native Goal, ForkLight independently runs acceptance, two different-view
  Judges inspect lifecycle ownership and privacy, and Main alone decides serial Integration.

## Verification

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/clean-run-bundle.test.ts
git diff --check
```

After safe Integration, a 3,151-or-newer full check and matched source Daemon, Main may run exactly
one new external clean bundle destination. Failure stops this recovery; success advances A3 into the
already accepted installed-package real Task journey without another bundle replay.

## Handoff and workspace disposition

Handoff records the temporary-root ownership rule, socket byte proof, exact cleanup ordering,
focused/full verification, Revision/digest, Judges and any remaining risk. No separate handoff file
is created. Protect the Worker Workspace through review and Integration. Retain the external root-
cause diagnostic and the next bundle until M5 exits; later ordinary storage reclamation may remove
only regenerable Task Workspace data after terminal disposition.
