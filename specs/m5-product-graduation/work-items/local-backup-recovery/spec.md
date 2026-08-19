# M5-A2 — Understandable local backup and recovery

## User result

A local developer can preview, create, inspect and restore a ForkLight backup without database
knowledge. The product explains what is included, what is not included, why a restore is safe or
refused and the next action.

## Background and evidence

ForkLight currently protects Integration backups and exposes Task-space audit/reclaim. It does not
offer a public backup of ForkLight's own Store, settings, Task evidence and protected Workspaces.
Provider credentials live in macOS Keychain and Main client files live outside `FORKLIGHT_HOME`.
The active Store is `forklight.sqlite` in WAL mode and already exposes SQLite `quick_check` plus
foreign-key checks.

The 2026-08-19 focused audit confirms the current Home also contains durable `runs`, `competitions`,
`review-projects` and `samples` roots, plus one legacy/unknown top-level database that must not be
silently discarded. Known transient top-level entries are the Daemon socket/log, Hub claim and
descriptor, and SQLite WAL/SHM sidecars. Node's existing SQLite `backup` API can produce the
consistent Store copy without stopping a live Daemon or inventing a lock.

The same read-only audit counted 484 links under the current Home: 480 resolve within the Home and
four resolve outside it. Backup creation must never follow an outside link into local Runtime auth
or project data. A self-created backup may preserve only links whose resolved targets stay inside
the staged backup, and must explicitly report skipped external references; inspect/restore rejects
any link or path that could escape the backup/staging root. This is a concrete local path-safety
check, not distributed integrity machinery.

## `depends_on`

- M5-A1 accepted and integrated, because both Work Items own public CLI/setup wording and tests.
- Existing StateStore integrity and Hub/Daemon ownership checks.

## Inputs and outputs

Inputs are the current local ForkLight home, an explicit new backup directory or existing backup
directory, live Daemon/Hub state and an explicit confirmation for mutation.

Outputs are:

- read-only preview and inspect results;
- one self-contained local backup directory with a small readable manifest and a consistent Store;
- one restore result that either completes atomically enough for a single local user or leaves the
  previous home usable;
- CLI and agent/API surfaces sharing the same projection where the lifecycle permits it.

## Backup contract

- Backup preserves the Store and all non-transient ForkLight-owned state needed to retain history,
  Candidate/review/Integration evidence and protected resumable/partial Workspaces.
- It excludes live sockets, owner descriptors, WAL/SHM sidecars and regenerable process logs. The
  manifest states that Keychain credentials and external Main client configuration are not backed
  up and must be reconnected separately.
- The destination must not already exist and must be outside the active ForkLight home.
- The backup may contain private project code, diffs and logs; human output says to keep it private.
- The manifest has only the minimum schema marker, creation facts, included/excluded names and
  Store integrity result needed to read it. Do not add per-file hashes, content addressing, locks,
  leases or cross-machine version negotiation.
- The copy is self-contained: it never follows an external symlink. External link entries are
  excluded with a bounded count/reason; internal links are retained only when their recreated
  target remains inside the backup. Unknown ordinary files/directories are included rather than
  classified by an expanding allow-list.

## Restore contract

- Inspect is always read-only. Restore requires exact preview plus explicit confirmation.
- Restore refuses while a live Daemon or Hub owns the current home and explains how to stop it. It
  never kills a running Task to fit an orchestration timeout.
- Restore observes Daemon/Hub again immediately before moving the current Home. A late owner that
  appears during staging refuses the switch and leaves Home untouched; this is the minimum check
  that prevents a live writer from being moved with the Store.
- Before replacing anything, validate the manifest, reject links/path escape, open the staged Store
  and require `quick_check=ok` with zero foreign-key violations.
- Preserve the current home as a named pre-restore recovery copy before switching. If staging or
  activation fails, the prior home remains or is put back; a failed restore never leaves a partly
  replaced home presented as success.
- Unknown top-level user data is preserved rather than silently discarded. Transient ownership
  files are regenerated after normal startup.
- Preview, inspect and owner observation never start a Daemon or Hub. Restore is a direct local CLI
  lifecycle: API/MCP may share preview/create/inspect projections, but no API path pretends it can
  replace the Home while its own live owner still holds it.

## Allowed paths

- new backup/recovery modules under `src/core/**` or `src/state/**`
- `src/cli.ts`, `src/cli/**`
- only the needed `src/daemon/{protocol,coordinator,server}.ts` and `src/mcp/server.ts` surfaces
- `tests/local-backup-recovery.test.ts`
- focused cases in `tests/store.test.ts`, `tests/daemon.test.ts`, `tests/daemon-cli.test.ts` and
  `tests/mcp.test.ts`
- `docs/operations.md`, `docs/configuration.md`, `docs/m1-clean-user-runbook.md`, `README.md`

## Forbidden paths and non-goals

- Hub UI, GoalBoard, Keychain contents, external Main client files, cloud/scheduled backup,
  encryption/key management, remote sync, multi-user coordination or historical manual cleanup.
- Restore of a live running Task, automatic Daemon/Hub termination, general archive utility,
  checksums/content hashes, locks, leases or version handshakes.
- Commit, push, reset or touching the real current home in automated tests.

## Acceptance

- Preview/create/inspect/restore have concise human and JSON results with included, excluded,
  integrity, impact and next-action facts.
- A temp-home round trip restores settings, Store records, durable Task evidence and a protected
  partial Workspace byte-for-byte where relevant.
- Keychain and Main config are explicitly absent; no secret is read or printed.
- Existing destination, destination-inside-home, live owner, malformed manifest, unreadable Store,
  foreign-key violation, link/path escape and interrupted activation all fail without corrupting
  the prior home.
- Backup creation does not follow external links; the public result says how many were excluded and
  why. A malicious or modified backup containing an escaping link is refused before Home mutation.
- Inspect does not delete or rewrite any backup entry, including unexpected WAL/SHM sidecars. A
  focused test compares their bytes before and after inspect.
- Focused restore tests cover both a late owner appearing after staging and the rare case where
  activation plus automatic rollback rename both fail; the latter must keep recovery/staging paths
  and report `investigate` without claiming an active partial Home.
- No integrity mechanism exists beyond the concrete readable-manifest, SQLite integrity and safe
  path/activation checks above.

## Verification commands

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/local-backup-recovery.test.ts tests/store.test.ts tests/daemon.test.ts tests/daemon-cli.test.ts tests/mcp.test.ts
git diff --check
```

## Handoff and workspace disposition

Handoff includes the command/API contract, include/exclude policy, actual integrity cases, focused
results and one temp-home round-trip. Two different-view read-only Judges review this high-risk
durable-data path. Main integrates serially. Preserve the full Candidate until post-Integration
round-trip verification; then retain review/Integration evidence and reclaim only regenerable Task
space.
