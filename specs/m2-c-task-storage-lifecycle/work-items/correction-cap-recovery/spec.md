# M2-C recovery — adopt the verified 17-path Candidate and close five gaps

## User result

The already verified M2-C storage-lifecycle implementation is preserved, the five confirmed
safety/output gaps are closed in one complete Candidate, and Main can review and integrate that
exact combined Candidate without a second-hop handoff, source-tree patching, or Store rewrite.

## Background and authority

The parent accepted specification is `specs/m2-c-task-storage-lifecycle/spec.md`. Operational Goal
`execution/m2-c/goal.json` stopped at its immutable correction cap after a one-hop successor.
Successor Revision `99435c50-1815-414b-9430-df6eef1b619b` has patch digest
`237cbfe2403fc43519e1b467d542c74b5a02525ebe5dda98b592e89abb0c3b0f`, changes 17 accepted paths,
and passed build, 346 focused tests, and `git diff --check`. Two fresh Judges disagreed and Main
confirmed exactly five remaining gaps. 一骏 explicitly authorized this new narrow Work Item on
2026-08-14.

ForkLight has no supported second-hop handoff. The recovery therefore uses the same materialization
mechanism as the delivered handoff path: copy the exact private Revision patch into the Task input,
verify its digest, prove `git apply -p2 --check` against a clean current-source Workspace, then let
the Worker apply it inside that isolated Workspace. The final Candidate is still one ordinary
source-relative ForkLight Candidate containing all 17 paths plus the five fixes. This digest check
exists only to prevent adopting the wrong Candidate/base; it is not a general checksum protocol.

## `depends_on`

- M2-A and M2-B are graduated and integrated.
- Original M2-C Task `850b2e03-cc8f-436d-8424-96ea9c48a388`, handoff
  `a138e9be-dec4-4229-a4e2-2a9268b24408`, successor
  `67f255f9-2729-401d-b9c8-2864fca9f189`, Revision `99435c50-...`, verification, Review Graph,
  Main revise, and stop packet remain durable and protected.
- Current source must still pass `git apply -p2 --check` for the exact seed patch before Task
  submission. Product-path drift stops this Work Item; it is never patched around.

## Inputs

- Parent M2-C spec and `evidence/m2-c-stop-decision-packet.md`.
- Exact read-only seed at
  `goals/forklight-main-led-execution/execution/m2-c-recovery/99435c50-1815-414b-9430-df6eef1b619b.patch`.
- Frozen seed Revision id, full digest, 17 affected paths, and the five gaps below.
- Current source project after M2-A/M2-B Integration; unrelated dirty changes remain preserved.

## Frozen gaps

1. All-eligible preview keeps the fresh audit's protected and unknown entries visible, emits
   deletion targets only for reclaimable Tasks, and lets unknown win the single next action.
2. Stored `workerPid` ownership is a Task-id set. A duplicate PID is ambiguous, protects every
   implicated Task, and is never signalled.
3. A symlinked physical `runs` or `runs/<taskId>` root is refused; only the configured Home alias
   may be a symlink when its physical runs and Task directories are ordinary and contained.
4. Explicit retain runs `quick_check` and foreign-key preflight before any Store write and writes
   nothing when integrity is bad. The durable event reuses that preflight result instead of running
   a duplicate check before the same write; one post-write result remains for the returned view.
5. Successful retain reports retained-byte breakdown and the prior terminal eligibility reason,
   while its durable event remains bounded and stores no raw user note.

## Outputs

- One exact combined Candidate relative to current source, with all 17 adopted paths and only
  changes needed for the frozen five gaps beyond the seed.
- Focused regressions proving each gap and the full parent M2-C acceptance suite passing.
- Worker self-check, ForkLight independent verification, two independent Judge opinions, and a
  Main decision bound to the exact Candidate Revision.
- After Main accept only: ForkLight safe Integration and the three existing serial read-only
  post-Integration audits.

## Writable paths

The Worker may edit only these 17 already adopted paths:

- `docs/operations.md`
- `src/cli.ts`
- `src/cli/exchange-receipts.ts`
- `src/core/config.ts`
- `src/core/storage-lifecycle.ts`
- `src/core/types.ts`
- `src/daemon/coordinator.ts`
- `src/daemon/protocol.ts`
- `src/daemon/server.ts`
- `src/mcp/exchange-receipts.ts`
- `src/mcp/server.ts`
- `src/state/store.ts`
- `tests/daemon-cli.test.ts`
- `tests/daemon.test.ts`
- `tests/mcp.test.ts`
- `tests/storage-lifecycle.test.ts`
- `tests/store.test.ts`

The five gaps are tightly coupled in the shared lifecycle authority, Store mutation path, public
projection, and shared focused tests. Their writable paths overlap, so this Work Item has one
Writer and no implementation parallelism. Main performs Integration serially.

## Forbidden paths and non-goals

- The seed patch is read-only input and must not be edited or included as a changed Candidate path.
- No `src/hub/**`, backup deletion, Store row deletion, unknown/durable deletion, Worker/runtime
  semantics, Provider/routing, Review Graph policy, handoff admission, Competition, economics,
  commit, push, remote, credential, or real-home mutation.
- No locks, leases, hashes beyond the one exact seed identity check, manifests, version handshake,
  multi-user/distributed coordination, second lifecycle authority, or duplicate integrity proof.
- Do not redesign or rebuild already verified M2-C behavior. Inspect it only where needed to fix
  the five gaps and to understand failing tests.

## Acceptance

- Seed bytes match the frozen full digest and apply cleanly to the Task's clean current-source
  baseline with `git apply -p2`.
- Each frozen gap has a focused behavioral regression, and the implementation satisfies the
  corresponding parent-spec scenario without weakening existing protection.
- Retain performs exactly one blocking preflight for the mutation, reuses it in the durable event,
  and performs no duplicate pre-write consistency check.
- The full parent M2-C focused suite passes; automated mutations use temporary Homes only.
- Final Candidate contains exactly the accepted 17 product/test/doc paths, no generated `dist/**`,
  seed artifact, Hub, backup, or unrelated change.
- Candidate remains source-compatible and Main can obtain a feasible ForkLight Integration
  preflight after exact two-Judge review and Main accept.

## Verification commands

```text
test "$(shasum -a 256 goals/forklight-main-led-execution/execution/m2-c-recovery/99435c50-1815-414b-9430-df6eef1b619b.patch | awk '{print $1}')" = "237cbfe2403fc43519e1b467d542c74b5a02525ebe5dda98b592e89abb0c3b0f"
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/storage-lifecycle.test.ts tests/store.test.ts tests/daemon.test.ts tests/daemon-cli.test.ts tests/mcp.test.ts
git diff --check
```

The local verifier retains the existing 30-minute per-command safety breaker. The Work Item has no
absolute duration, Token, or no-progress deadline.

## Review, handoff, and stop

- Worker performs research, import, implementation, self-check, and evidence-based correction in
  its persistent Grok Session. ForkLight independently runs every approved command.
- Judge one focuses on preview visibility, protection precedence, duplicate PID behavior, and
  physical path containment. Judge two focuses on retain integrity/write ordering, byte/reason
  truth, CLI/MCP privacy/parity, and absence of unnecessary coordination mechanisms.
- Main inspects seed provenance, full diff, focused tests, both opinions, compatibility, and exact
  source base. Judges do not edit or authorize Integration.
- One same-Task correction is available only for new evidence inside these five gaps. Stop with a
  decision packet if two purposeful rounds repeat the same failure, patches compensate for prior
  patches, source drift invalidates the seed, or the boundary must expand.

## Workspace disposition

- Protect the original and successor M2-C Workspaces, the new recovery Workspace, seed copy,
  Candidate Revisions, verification, reviews, logs, and stop evidence through Main decision and
  Integration.
- Once the recovery Task Workspace has durably captured and digest-verified the seed, Main removes
  the temporary source-tree seed copy with `apply_patch`; the Task-owned copy and original Store
  artifact remain durable for recovery.
- After accepted Integration and post-Integration audits, exercise ordinary lifecycle reclaim only
  through the new product preview/confirm path. Historical backup cleanup remains separately
  authorized and out of scope.
