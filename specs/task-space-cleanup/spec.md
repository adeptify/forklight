# ForkLight task space cleanup

## Background and goal

ForkLight currently reports no active or queued Tasks, but five orphan test Daemons were found.
Four Daemons and their Claude Worker loops from failed Task
`a3c10fa2-0e35-49aa-809a-a50b8bb36242` remained alive for more than nine days. A fifth Daemon,
process group `5262`, remained alive for more than five days from a run directory that had already
been removed and no longer has a Store Task. Live run directories use about 73 GB and two verified
historical backups use about 177 GB. The immediate goal is to stop proven orphan processes and
produce an auditable deletion preview before reclaiming any stored Task data.

## Current evidence

- Main Daemon PID: `74110`; active Tasks: 0; queued Tasks: 0.
- Orphan test Daemon process groups: `22380`, `47256`, `48243`, `82191`, `5262`.
- The first four execute `runs/a3c10fa2-0e35-49aa-809a-a50b8bb36242/workspace/src/daemon/main.ts`.
- The owning Task is terminal with status `failed`, last updated 2026-08-03.
- Process group `5262` executes from deleted run path
  `runs/1c9b0258-6188-4143-bc7d-5c20e429c526`; the path and Store Task are both absent.
- Live ForkLight home: about 73 GB; backups: about 177 GB; filesystem free: about 107 GiB.

## Scope

- Gracefully terminate the five exact orphan process groups, escalating only if they do not exit.
- Verify the Main Daemon and database remain healthy.
- Classify run-directory content into durable evidence and regenerable workspace/cache content.
- Produce exact target paths, byte counts, retention reasons and estimated reclaimed space.

## Non-goals

- Do not delete run directories during the preview phase.
- Do not delete or rewrite SQLite records, Candidate evidence, reviews, patches or integration data.
- Do not delete either verified backup without separate explicit approval from 一骏.
- Do not implement automatic cleanup or start M2 feature development in this operation.

## Inputs, outputs and boundaries

- Inputs: current Git tree, Daemon status, SQLite Store, process table, run and backup directories.
- Outputs: stopped orphan processes and a deletion preview shown to 一骏.
- Allowed process mutation: the five exact orphan process groups only.
- Allowed filesystem mutation before approval: this spec only; all cleanup targets remain read-only.

## Acceptance

- The five orphan process groups and descendants no longer exist.
- Main Daemon remains healthy with no active or queued Tasks.
- SQLite `quick_check` remains `ok` and foreign-key violations remain zero.
- Preview separates durable evidence from regenerable data and gives exact reclaim estimates.
- No run directory or backup is deleted before the corresponding approval.

## Validation

- `ps` confirms the five exact process groups are absent.
- `forklight daemon status` confirms the Main Daemon is healthy and idle.
- SQLite `PRAGMA quick_check` and `PRAGMA foreign_key_check` pass.
- Size inventory is computed from the current filesystem without following external symlinks.

## Assumptions and open decisions

- The terminal Task record plus command paths prove these are orphan test processes, not live work.
- Physical run-data deletion waits for preview approval.
- Backup deletion remains a separate decision even after run-data cleanup is approved.

## Dry-run result

Five orphan process groups were terminated with `SIGTERM`. Main Daemon PID `74110` remained
healthy and idle; SQLite `quick_check` remained `ok` with zero foreign-key violations. No process
now has a command path or current working directory under ForkLight `runs/`.

Proposed deletion contains 1,336 top-level per-run directories using 71,807,636 KiB
(68.48 GiB):

- 292 `workspace` directories: 40.21 GiB.
- 292 `baseline` directories: 14.26 GiB.
- 13 `codex-tmp` directories: 9.57 GiB.
- 145 `grok-home` directories: 2.73 GiB.
- 13 `codex-home` directories: 0.55 GiB.
- 292 `claude-config` directories: 0.22 GiB.
- 289 `verifier-git` directories: 0.93 GiB.

The proposal preserves the SQLite Store, 292 logs directories, 288 revision directories,
source manifests, raw/generated patches, result diffs, reviews, Integration receipts and
workspaces, handoff evidence and both verified backups. Three runs lack standard raw/generated
patch files: two are failed/interrupted read-only reviews with no Candidate; the third is a
succeeded direct-Codex calibration with its result diff preserved. None requires its workspace as
the sole recorded delivery.

一骏 confirmed deletion. The exact sorted target-path manifest had SHA-256
`2b84abb52deca2a9741d7b2ddd24118936ff22a4d2fb61bcb98d07a7b612694a`.

All 1,336 approved directories were deleted. Remaining matching target count is zero. Live `runs/`
fell from about 73 GB to 4,391,060 KiB (about 4.19 GiB). The preserved evidence counts remained:
292 logs, 288 revision directories, 41 reviews, 158 Integration directories, 292 source manifests,
289 raw patches, 289 generated patches and 290 result diffs. All 292 remaining run roots still map
to Store Tasks.

Post-cleanup validation passed: Main Daemon remains healthy and idle, no process references
`runs/`, Store counts remain 293 Tasks / 431 Attempts / 213,300 Events / 160 Integrations,
SQLite `quick_check` is `ok`, foreign-key violations are zero and `git diff --check` passes.

Filesystem available blocks increased by only 235,232 KiB (about 230 MiB), despite removing
68.48 GiB of logical run-directory content. The two retained backups still use about 157.21 GiB
logically and likely retain shared APFS clone blocks; this is an inference from the filesystem
measurements, not a claim that backup deletion is authorized. Both backups remain untouched and
out of scope.
