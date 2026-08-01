# M3 Snapshot-Exclude Diff Bounding Contract

## Outcome

ForkLight never feeds directories that the Task explicitly excludes from its
snapshot into `git diff --no-index`. Large verifier outputs such as nested Rust
`target`, JavaScript `node_modules`, build caches, and `dist` trees therefore
cannot turn a small Candidate into gigabytes of temporary patch data or hold
the shared Daemon queue during Task finalization.

This contract comes from the real Nexus Task
`f375d98d-3b1e-4a2a-99aa-d9f03d7f2a21`: verification created roughly 2.9 GiB
under a nested excluded `target` directory, then the current raw diff path wrote
hundreds of megabytes into both raw and generated patch artifacts before
classification could discard them from Integration.

## Product meaning

`workspace.exclude` is a pre-comparison boundary, not merely a label applied
after a full diff. Content under an excluded path has no trusted baseline and
is never eligible for Candidate Integration. ForkLight may report a bounded
fact that excluded verifier output existed, but it must not retain or stream
the full content as patch evidence.

This deliberately changes the older behavior that retained complete raw and
generated patches for snapshot-excluded trees. The useful truth is “verification
created output under these excluded roots,” not a multi-gigabyte binary patch.
Included paths classified by `workspace.generatedPaths` remain outside this
slice and keep their existing generated-evidence behavior.

## Modules and behavior

### 1. Excluded-root discovery and temporary isolation

Consumes the baseline/workspace roots and the exact named-segment set from
`PathPolicy.snapshotExcludes`. Produces a stable list of excluded roots found at
any depth.

Before diffing, each discovered root is atomically moved to a private stash
under the Task root. Discovery must not follow symlinks, must stop descending
once a parent is excluded, and must never move the baseline/workspace root.

Boundary: only exact configured path segments are eligible. Similar names such
as `targeted` do not match `target`. The stash path is owned by the Task and
never enters Candidate evidence.

### 2. Business/generated patch stream

Consumes baseline and workspace after excluded roots have been stashed. Produces
the existing raw, generated, and Integration patch artifacts for the remaining
included paths.

Boundary: the normal path classifier, generatedPaths handling, internal-path
filter, patch parsing, changed-line accounting, and Integration rules remain
unchanged. The Git process never sees snapshot-excluded roots.

### 3. Restoration and failure safety

Consumes the stash records and restores every excluded root to its exact
baseline/workspace location in `finally`, whether diffing succeeds, fails, or
is rejected. Existing contents at the restoration target are fail-closed; no
source project path is touched.

Boundary: no Daemon restart, Task interruption, source deletion, artifact
cleanup policy, credential access, or external project mutation.

## Call chain

1. Verification finishes and may leave generated outputs in the isolated
   workspace.
2. Patch generation discovers exact snapshot-excluded roots recursively.
3. ForkLight atomically stashes those roots outside both comparison trees.
4. `git diff --no-index` streams only included content into bounded Candidate
   artifacts.
5. ForkLight restores every excluded root in `finally` for retained-workspace
   inspection and possible same-Candidate correction.
6. Candidate classification and Main review continue with no excluded-output
   patch payload.

## Required scenarios

1. **Nested Rust target**: a multi-level `apps/shell/src-tauri/target` tree under
   a Task excluding `target` is absent from raw/generated/Integration patches,
   remains present after patch generation, and finalization completes without
   reading its file bodies.
2. **Multiple excluded roots**: top-level and nested `node_modules`, `dist`, and
   `target` roots are all stashed/restored deterministically.
3. **Exact-segment rule**: `targeted/file.ts` remains included when only
   `target` is excluded.
4. **Existing generatedPaths**: an included path matching a generated glob is
   still classified into generated evidence and excluded from Integration.
5. **Diff failure**: if patch parsing or Git fails, all stashed directories are
   restored and partial patch artifacts do not authorize Integration.
6. **Symlink safety**: discovery never traverses a symlink and never moves a
   path outside the owned Task roots.

## Risks and controls

- Moving a parent and child twice can corrupt restoration; stop recursion at
  the first excluded ancestor and keep deterministic parent-safe ordering.
- A broad substring match can hide business files; reuse the existing exact
  named-segment semantics.
- Large stashes must be atomic renames on the same filesystem; keep them under
  the Task root and do not copy file contents.
- Process failure between move and restore can leave a retained workspace
  incomplete; use deterministic stash names plus startup/reverify recovery or
  a focused fail-closed recovery test if current lifecycle supports it.
- Removing full excluded-output patches changes audit semantics; document and
  test the new bounded meaning rather than silently claiming full evidence.

## Independent acceptance

- A fixture with a nested excluded directory containing a large sparse/binary
  sentinel proves the raw and generated patch artifacts stay small and contain
  no sentinel bytes.
- The excluded directory and its bytes are restored unchanged after success
  and an injected failure.
- Existing patch classification and Integration tests pass after updating the
  old expectation that excluded `dist` content is retained in full.
- Full `npm test`, `npm run build`, and `git diff --check` pass.

## Shared runtime gate

The Candidate may be reviewed while other projects are idle or queued, but
ForkLight self-Integration and activation must wait until the one shared Daemon
has no active or queued external Tasks. Never start a second Daemon.
