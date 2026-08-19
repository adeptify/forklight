# M5-A3D — Clean-bundle bounded failure diagnosis

## User result

When clean-bundle verification and owned-process cleanup both fail, the single public failure line
states which bounded verification category came first and whether Hub and Daemon cleanup completed.
Main can then fix the real A3 blocker instead of guessing or replaying the same bundle.

## Background

Two pre-fix clean bundles and the sole post-fix bundle all stopped with the same public
`cleanup-failed` line and published nothing. The delivered stale-Daemon-PID guard passed its full
quality chain and 3,143/3,143 tests but did not unblock the real run. The current catch path replaces
the earlier `BundleBuilderError.category` and collapses `hubGone` plus `daemonGone` into one generic
message. No durable evidence can now identify the failed verification step or owned process.

This is a diagnostic-only amendment to the accepted M5-A3 Work Item. It does not change cleanup,
verification, publication, timeout, retry or process ownership behavior.

## `depends_on`

- M5-A1 and M5-A2 graduated.
- M5-A3 cleanup Integration `0cfebb72-16b7-4c8e-912d-c45b544fa8fa` applied.
- Post-Integration `npm run check` passed 3,143/3,143.
- The sole post-fix destination repeated `cleanup-failed` and published no bundle.

## Inputs and outputs

Inputs: the caught verification error, the returned owned-cleanup booleans, and whether cleanup
returned or threw.

Output: one bounded `cleanup-failed` CLI line containing only closed diagnostic fields:

- `prior`: an existing `BundleFailureCategory`, or `unexpected` for an untyped error;
- `cleanup`: `returned` or `threw`;
- `hubGone`: `true`, `false` or `unknown`;
- `daemonGone`: `true`, `false` or `unknown`.

No raw exception message, stdout/stderr, command, path, Home, PID, identity, credential or process
name may enter the diagnostic line. Successful cleanup still rethrows the original error unchanged.

## Scope and implementation boundary

Allowed writable paths:

- `src/clean-run/build-clean-run-bundle.ts`
- `tests/clean-run-bundle.test.ts`

Forbidden paths and behaviors:

- Core evidence schema, Store, CLI parser, Daemon/Hub lifecycle, public timeouts, signal order,
  process scans, retries, publication, setup/backup, fixtures, docs, Hub UI and Goal SSOT.
- Echoing or sanitizing arbitrary error text into the diagnostic. Use only closed values assembled
  by the clean-bundle catch path.
- Running a real bundle, changing the source project outside the isolated Workspace, commit, push,
  reset, credential access or cleanup of historical processes.

The two writable paths overlap completely with the prior A3 recovery, so this Work Item is serial.
No other Writer may run in the same wave. Main alone updates shared SSOT and Integration state.

## Required behavior

1. Derive `prior` from `BundleBuilderError.category`; use the literal `unexpected` otherwise.
2. If `stopOwnedProcesses()` returns and relevant ownership remains, throw `cleanup-failed` with
   `cleanup=returned` and the exact returned booleans.
3. If cleanup itself throws, throw `cleanup-failed` with `cleanup=threw` and both results `unknown`.
4. If cleanup succeeds, preserve the original failure object/category/message exactly.
5. Keep staging removal and cleanup-failure precedence unchanged.

## Acceptance

- A deterministic verification failure plus returned cleanup failure exposes its original closed
  category and exact Hub/Daemon booleans.
- A cleanup exception exposes `cleanup=threw` and `unknown` booleans without its raw message.
- Successful cleanup still returns the original verification error unchanged.
- Existing successful bundle behavior and stale-PID safety tests remain passing.
- The Candidate touches exactly the two allowed paths and changes no behavior beyond the bounded
  failure projection.
- ForkLight uses Grok 4.6 Xhigh native Goal, independently runs acceptance, two different-view
  read-only Judges inspect privacy and semantic truth, and Main alone decides serial Integration.

## Verification

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/clean-run-bundle.test.ts
git diff --check
```

After safe Integration and matched Daemon activation, Main may run exactly one new external
diagnostic bundle destination. That run collects classification only: success would be valid A3
bundle evidence, while failure must be recorded without automatic behavior correction or replay.

## Handoff and workspace disposition

Handoff names the exact closed output shape, focused tests, Revision/digest, Judge results and any
remaining uncertainty. It contains no separate file or raw error payload. Protect the Workspace
through review and Integration. After terminal disposition, retain the minimal Candidate and Task
record; ordinary auditable reclamation may remove regenerable Workspace data later. The external
diagnostic destination and any unpublished result remain A3 evidence until M5 exits.
