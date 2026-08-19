# M2 resolved-terminal storage disposition — exact Candidate review-cap recovery

## User result

The already implemented two-path storage Candidate is materialized byte-for-byte on current source,
independently reverified, reviewed once by two fresh different-view Judges, and—only after Main
accepts the exact Revision—integrated through ForkLight's safe path. The three original activated-
source audits then run serially before Main previews and reclaims only the six authorized Tasks.

## Background and authority

The accepted behavior remains
`specs/m2-delivery-journeys/work-items/resolved-terminal-storage-disposition/spec.md`. Original Task
`71850bde-917a-426c-b92a-164790b1abbd` produced final Revision
`172d6a80-bdd7-487a-9e97-b938a67f10c5`, full digest
`48a73c6b6db1071fd62f2dfffa3799df81805cdc1e6d4a46cb163bb9ebdafcda`, two paths and 181 changed
lines. It passed the original build, 295 focused tests and diff validation twice. It stopped only
because two allowed Review Graphs each admitted one usable Codex accept and one schema-invalid
different-view opinion. The Candidate behavior did not fail.

一骏 explicitly authorized this packet's exact-Candidate recovery. The single seed digest and
reverse-apply check prevent only the concrete wrong-Candidate or source-base Integration failure;
they are not a general hash, manifest, lock, lease, version handshake or consistency protocol.

## `depends_on`

- The original storage Candidate, Workspace, Revisions, verification and Review Graphs remain
  immutable protected evidence.
- The read-only seed at
  `goals/forklight-main-led-execution/execution/m2-resolved-terminal-storage-recovery/172d6a80-bdd7-487a-9e97-b938a67f10c5.patch`
  must equal the frozen full digest and pass `git apply -p2 --check` on current source.
- The stopped native `/goal` Candidate is not integrated and shares no writable path. This recovery
  may run independently, but Main still integrates one Candidate at a time.
- M3 remains closed until all M2 graduation evidence is complete and 一骏 confirms the boundary.

## Inputs and outputs

Inputs:

- the parent storage-disposition spec and review-cap decision packet;
- the exact two-path seed, Revision id, full digest and current source;
- the original verification commands, two-Judge requirement and three activated-source audits;
- the six exact resolved audit Task ids already named by the parent Work Item.

Outputs:

- one ForkLight Candidate with the same two paths and full patch digest as Revision `172d6a80...`;
- one correctly admitted Task that honestly records integrated ForkLight execution as
  `persistent-session` while its operational bootstrap invokes Grok CLI 4.6 Xhigh native `/goal`;
- independent verification and exactly two usable fresh opinions bound to one current Revision;
- after Main accept only: safe Integration, activation, three serial zero-change audits, exact
  six-Task preview/reclaim, Store integrity, orphan, process and boundary evidence.

## Allowed paths and orthogonality

The recovery materializer may change only:

- `src/core/storage-lifecycle.ts`
- `tests/storage-lifecycle.test.ts`

The seed, this Spec and execution files are read-only baseline inputs and must not appear in the
Candidate. Native `/goal` product paths, Hub, Store schema, protocol, daemon, CLI and MCP are
forbidden. One Writer owns this exact materialization; Judges and audits are read-only. Main
performs serial Integration.

## Execution design

1. A Main-authored operational materializer verifies the exact seed digest, applies it once with
   `git apply -p2` inside the isolated Workspace, proves reverse-apply, and refuses partial or
   source-incompatible state. Its Git subprocesses explicitly ignore the unavailable user-level
   Git config inside the Worker sandbox; this only prevents the observed startup failure reading
   `/Users/yijunwang/.gitconfig` and does not alter Candidate or source-base checks.
2. The same executable delegates the bounded self-check to Grok CLI 4.6 Xhigh native `/goal`, with
   current-model-only enabled by the existing audited bootstrap. Grok cannot edit the Workspace;
   it inspects the already materialized exact Candidate.
3. ForkLight independently runs the original acceptance. Main checks Candidate paths, line count,
   full digest and source compatibility.
4. One fresh Review Graph uses exactly two current different-view healthy Profiles. Either unusable
   or blocking opinion stops; no replacement, correction, extra Judge, model switch or Competition.
5. Main accepts only the exact verified Revision, then uses ForkLight preflight/apply, activation,
   the existing three serial audits and exact authorized reclaim sequence.

## Acceptance

- Seed sha256 equals `48a73c...dafcda` and applies exactly once to the clean current baseline.
- `git apply -p2 --reverse --check` proves the Workspace contains the exact seed, not a rewrite.
- Candidate changes exactly the two allowed paths, 181 changed lines, and its full ForkLight digest
  equals the frozen digest. No operational, seed, Spec, Goal, evidence, generated or unrelated path
  appears.
- ForkLight independently passes build, the original focused storage/daemon/CLI/MCP suite and diff
  validation.
- Two fresh usable Judges inspect one exact current Revision. Main independently reviews diff,
  safety precedence, provenance and verification before Integration.
- After Integration, all three existing read-only audit Tasks pass with empty Candidates.
- Exact real-home preview names only the six authorized Tasks; reclaim removes only their known
  regenerable roots after exact preview and retains durable Revision/log evidence. Final audit has
  integrity `ok`, zero foreign-key violations, zero unknown orphans and zero orphan processes.

Any seed/digest/source/path mismatch, changed behavior, failed verification, unusable/blocking
Judge, Integration preflight failure, audit failure, preview-set mismatch or integrity problem stops
without compensation, replacement review, new Task, broadened cleanup or M3 work.

## Verification commands

```text
test "$(shasum -a 256 goals/forklight-main-led-execution/execution/m2-resolved-terminal-storage-recovery/172d6a80-bdd7-487a-9e97-b938a67f10c5.patch | awk '{print $1}')" = "48a73c6b6db1071fd62f2dfffa3799df81805cdc1e6d4a46cb163bb9ebdafcda"
git apply -p2 --reverse --check goals/forklight-main-led-execution/execution/m2-resolved-terminal-storage-recovery/172d6a80-bdd7-487a-9e97-b938a67f10c5.patch
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/storage-lifecycle.test.ts tests/daemon.test.ts tests/daemon-cli.test.ts tests/cli-supervision.test.ts tests/mcp.test.ts
git diff --check
```

The recovery has no absolute duration, Token or no-progress deadline, zero correction rounds and
one Review Graph round. Task `4ad6f4d6...` stopped before Candidate materialization because the
Worker sandbox could not read the user Git config. Its immutable policy disabled both extra
Attempts and adaptation, so it cannot legally resume. Exactly one replacement Task may reuse the
same model, seed, materializer, paths and acceptance after the bootstrap-only repair; it retains
one extra-Attempt capacity that Main must explicitly authorize and never runs automatically. This
does not authorize Candidate correction, a second replacement, model switch or another review
round. Command timeouts retain ForkLight's 30-minute local safety breaker.

一骏 explicitly authorized that single extra Attempt on 2026-08-15 after read-only proof showed the
replacement Workspace already contains the exact seed. The wrapper-only correction derives the
allowed path set from the digest-bound `a/baseline/...` and `b/workspace/...` patch headers instead
of repository-form `git diff`; digest, apply, reverse-apply, Worker edit denial and ForkLight's
independent Candidate collection remain unchanged.

That extra Attempt passed those materializer checks but stopped before Grok because the wrapper's
child native-bootstrap path still named the source checkout, which the Worker sandbox cannot read.
The identical Workspace-local child is executable, syntax-valid and sha256-identical. The current
Task has exhausted its base and extra Attempt with zero correction/adaptation authority. This Spec
does not authorize another Task; a final replacement requires a new explicit Main decision and
must use the Workspace-local child path with no further fallback.

一骏 explicitly authorized that final replacement on 2026-08-15. Main reproduced the actual Grok
sandbox profile: it loads the Workspace-local child successfully and rejects the old source-tree
path with `EPERM`. The final Task freezes one base Attempt and zero extra Attempts, validation
repairs, corrections, reverifications and adaptations. Any failure is terminal and does not
authorize another replacement.

The final Task created the exact Candidate and passed ForkLight independent verification, but its
real task-local Grok Goal ended `user_paused` with zero classifier runs and no `complete + achieved`
truth. Main recorded `reject` before Judge assignment. Under the authorized no-fallback boundary,
the Work Item is terminal and its full Workspace remains protected.

The terminal root cause is now proven read-only: Grok's Planner required a native plan file, while
this final Task's read-only toolset supplied no file-write tool and the bootstrap denied Bash. Five
terminal-command attempts to create the exact plan file were denied, after which Grok 1.0.3 emitted
`goal_planner_fail_closed: missing_plan_file` and persisted its generic planner-failure
`user_paused` state. The later ordinary-turn success text is not Goal completion. Adding a write
path, removing the Bash deny, resuming or replacing the Task would change this accepted final
boundary and remains unauthorized.

## Handoff and workspace disposition

Handoff records the original and recovery Task/Session, seed Revision/digest, Grok native Goal id
and terminal truth, new Candidate Revision/digest/paths, verifier, both Judges, Main decision,
Integration operation, three audits, exact preview/reclaim result and final integrity/orphan/process
facts. It excludes credentials, raw Home data, prompt bodies and private logs.

Protect original and recovery Workspaces and every Candidate/review artifact until terminal Main
disposition. After successful Integration, audits and reclaim, ordinary product lifecycle may
reclaim eligible regenerable roots while retaining durable evidence. Any stop keeps the recovery
Workspace protected.
