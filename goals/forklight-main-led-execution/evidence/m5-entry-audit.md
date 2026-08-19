# M5 entry audit — product graduation before Hub redesign

Date: 2026-08-18 (Asia/Shanghai)

## Outcome

M5 has one serial functional-graduation chain before the Hub redesign. The current product can
already package/install itself, diagnose health, execute/review/integrate real Tasks and recover
Task execution. It cannot yet complete first setup without the incumbent Hub, and it has no public
backup/restore of ForkLight's own durable state. The old Hub is therefore not a safe design
foundation; its APIs and read models remain reusable functional truth only.

## Preflight

- Dirty source work from M2–M4 is preserved; no reset, overwrite, commit or push occurred.
- `node dist/src/cli.js health --json` is `ok`; client and Daemon build identities match.
- Saved `grok-4-6-xhigh` resolves Grok Build, Grok 4.6, Xhigh and `native-goal`.
- A current direct read-only Grok 4.6 Xhigh smoke returned `M5_GROK_46_XHIGH_OK`. Ambient config
  warnings and the failed automatic session-title request did not affect the successful model turn.
- No existing Hub process was opened, stopped, restarted or replaced.

## Reusable truth

- `bundle:clean` already proves pack/prepack full check, sensitive-filename scan, isolated-prefix
  install, CLI/MCP load, exact build identity and owned Hub/Daemon lifecycle. Its evidence correctly
  states that this is not an unfamiliar-user journey.
- CLI/MCP cover Goal/Plan/Task, delivery prepare/decide, Judge/Main decisions, safe Integration,
  diagnostics, settings and Task-space lifecycle.
- `SetupService` already performs transactional Keychain/settings writes. The local authenticated
  Hub API already manages Provider keys, model catalog, Worker Profiles and Main installation.
- Main installers already back up changed client files. This is not a ForkLight data backup.
- `StateStore.checkStoreIntegrity()` already supplies the only general Store checks M5 needs:
  SQLite quick check and foreign-key violations.
- Product state is centered on `forklight.sqlite` plus ForkLight-owned Task/evidence directories.
  Provider credentials are in macOS Keychain; Main client configuration is outside
  `FORKLIGHT_HOME`.

## Real gaps

1. `forklight setup` is intentionally removed and points to the Hub. A clean installed user cannot
   complete Provider selection/credential entry, built-in Worker selection and Main installation
   through public CLI/API without using the old UI or editing settings.
2. Existing Integration backup and Task-space reclaim do not create/inspect/restore a backup of
   ForkLight Store, settings, Task evidence and protected Workspaces.
3. The frozen clean bundle is technical package evidence, not an installed-product real delivery
   or unfamiliar-developer observation.
4. The current Hub organizes implementation concepts and configuration first. It does not meet the
   confirmed Goal-first, continuous execution file, single Decision Center or 10-second human
   comprehension contract.

Multi-user collaboration, distributed consistency, cross-node coordination, checksums, content
hashes, locks, leases and version handshakes are explicitly not gaps.

## Accepted serial chain

| Work Item | Result | Depends on | Why not parallel |
| --- | --- | --- | --- |
| M5-A1 CLI/API setup | install-to-ready without old Hub | M2–M4 | owns CLI/setup/Hub setup API tests |
| M5-A2 backup/recovery | understandable durable local round trip | A1 | also owns CLI/Daemon/MCP/Store tests |
| M5-A3 clean-clone delivery | installed package completes real delivery and restart | A1, A2 | consumes their frozen commands and package truth |
| M5-B Hub redesign | Goal-first continuous execution file | A3 | functional truth must be frozen first |
| M5-C human acceptance | desktop/mobile and unfamiliar user exit | B | observes the integrated final product |

A1 and A2 share `src/cli.ts` plus public-surface tests and therefore cannot be parallel Writers.
A3 consumes their final command contracts. B cannot begin while setup/backup/read models may still
change. Main updates shared SSOT and integrates every Candidate serially.

## Scope controls

- No Hub UI file changes before M5-B.
- No GoalBoard write or cross-app data connection.
- No hard Work Item wall-clock, Token or no-progress deadline. The existing 30-minute
  acceptance-command safety breaker remains; the 30-minute first-use target is observation
  evidence, not a cancellation timer.
- Setup uses stdin/Keychain and never reads or records credentials as evidence.
- Backup uses only minimal manifest readability, SQLite integrity and safe local path/activation
  checks tied to concrete durable-data failures.

