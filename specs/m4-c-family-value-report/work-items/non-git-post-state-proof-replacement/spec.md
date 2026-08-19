# M4-C Work Item — Final non-Git post-state-proof replacement

## User result

Deliver the already verified M4-C family value report by reproducing its exact ten-path Candidate
one final time, while proving the applied state inside ForkLight's real plain Workspace without
requiring an ordinary Git repository.

## Background and evidence

The first acceptance replacement, Task `4a967967-ac35-48e0-b89a-fd1e7c636e5d`, reproduced exact
Revision `5dd98f60-f6a1-42c7-86fa-a75c3ef2c7cf`, digest
`d7327f8c6a0ccd5232b950af4a2ed59143f2c0ef81c846d5287c6305352d92ab`, across the authorized ten
paths. Build, all 343 focused tests and `git diff --check` passed. Its read-only Grok Goal did not
change the Candidate.

The Task failed only because the Main-owned post-state script invoked ordinary
`git diff --name-only` inside ForkLight's plain Candidate Workspace. The Candidate Revision already
records the exact affected-path set, and `git apply --reverse --check` can validate file state
without a repository. Event `2318` attributes the failure to `acceptance-contract / non-model`.

On 2026-08-18 一骏 explicitly revoked the previous acceptance replacement's one-shot boundary and
authorized this final non-Git post-state-proof replacement: one Attempt and zero retry, reverify,
correction, fallback or further replacement.

## `depends_on`

- M4-A and M4-B remain integrated and activated.
- The parent `specs/m4-c-family-value-report/spec.md` remains authoritative for product behavior.
- Tasks `89e60adc-d9ca-4560-9940-b423698c51f0`, `812df915-788c-463c-8ee0-208d71ff9d58` and
  `4a967967-ac35-48e0-b89a-fd1e7c636e5d`, including their Goals, Attempts, Revisions and
  Workspaces, remain immutable and protected.
- `goals/forklight-main-led-execution/evidence/m4-c-acceptance-contract-replacement-stop-decision-packet.md`
  is the accepted immediate failure evidence.

## Inputs and outputs

Inputs:

- Workspace-local retained product seed
  `goals/forklight-main-led-execution/execution/m4-wave-1/m4-c-retained-candidate.patch`, packaged
  digest `92c1e363639903d243cc3a1939d50d69ee2f7198e50b0d741286a07c6d836312`;
- Workspace-local final test delta
  `goals/forklight-main-led-execution/execution/m4-wave-1/m4-c-final-test-delta.patch`, digest
  `1c997a355684d4b17b96d9753abe72ceca9b15080434889097e24c60f724d6e8`;
- the current activated M4-B source base and exact ten-path contract.

Outputs:

- one fresh Candidate byte-equivalent to digest
  `d7327f8c6a0ccd5232b950af4a2ed59143f2c0ef81c846d5287c6305352d92ab` on the exact ten paths;
- a post-state proof that runs successfully in a plain non-Git Workspace;
- passing build, 343-test suite and diff validation;
- two fresh different-view Judge results and Main serial safe Integration evidence.

## Allowed and forbidden paths

The Main-owned wrapper may materialize exactly these ten Candidate paths:

- `src/cli.ts`
- `src/core/main-token-value-report.ts`
- `src/daemon/coordinator.ts`
- `src/daemon/protocol.ts`
- `src/daemon/server.ts`
- `src/mcp/server.ts`
- `tests/daemon-cli.test.ts`
- `tests/daemon.test.ts`
- `tests/main-token-value-report.test.ts`
- `tests/mcp.test.ts`

The Grok Worker is read-only and may edit no path or execute a terminal command. Native Goal-local
plan mutations remain allowed, but Workspace Write/Edit remains denied. Goal/Spec/evidence, seed,
wrapper, acceptance scripts and source-project files are Main-owned and forbidden to the Worker.

## Implementation and call chain

1. ForkLight snapshots both accepted Workspace-local patches and the new wrapper into a clean Task
   Workspace.
2. The wrapper validates the two exact seed digests and exact ten-path set, applies the retained
   seed and one-file test delta, writes a Task-local marker and launches current-model-only Grok
   4.6 Xhigh native `/goal`.
3. Grok reads the contract and Candidate, makes zero Workspace edits, and completes with an honest
   evidence-based handoff.
4. ForkLight independently runs a non-Git post-state proof. It reads the exact marker, reverse-
   checks the one-file final delta with `git apply -p1 --reverse --check`, and reverse-checks the
   other nine base paths with `git apply -p2 --reverse --check --exclude=...`.
5. ForkLight itself records the Candidate Revision and exact affected paths, then runs build, all
   343 focused tests and diff validation. Two fresh Judges inspect that exact Revision; Main alone
   may accept and integrate it.

## Acceptance

1. Clean-source policy preflight proves the base seed matches current source, the retained
   Workspace matches the base seed, and both prior final Workspaces match the test delta plus the
   other nine base paths.
2. Runtime bootstrap uses only Task-Workspace-local patches, exact seed/path checks, isolated Git
   config and current-model-only native Goal.
3. A realistic temporary plain directory with no `.git` accepts both patches and passes the exact
   post-state script.
4. Post-state acceptance uses only the Task-local marker and the two reverse `git apply --check`
   operations. It does not invoke `git diff`, `git status`, `git ls-files`, `git rev-parse`, or
   otherwise assume repository metadata.
5. ForkLight's fresh Candidate Revision has exactly ten paths and digest
   `d7327f8c6a0ccd5232b950af4a2ed59143f2c0ef81c846d5287c6305352d92ab`; Grok changes no byte.
6. Build, 343/343 focused tests and `git diff --check` pass. Parent M4-C claim gating, missing
   evidence, economics separation, privacy, Daemon/CLI/MCP agreement and read-only behavior remain
   unchanged.
7. One fresh Grok 4.6 Xhigh native Goal, ForkLight independent verification, two fresh different-
   view Judges, Main exact-Revision decision and serial safe Integration complete the quality
   chain.

The two seed digests are the existing minimal guard against wrong Candidate/source-base reuse;
this Work Item adds no checksum system, lock, lease, version handshake or duplicate consistency
layer.

## Verification commands

Pre-submission Main proofs only:

```text
node goals/forklight-main-led-execution/execution/m4-wave-1/m4-c-non-git-replacement-policy.test.mjs
node goals/forklight-main-led-execution/execution/m4-wave-1/m4-c-non-git-replacement-postapply.test.mjs
```

The second command must be run from a materialized temporary plain directory without `.git`.

ForkLight independent post-Candidate acceptance:

```text
node goals/forklight-main-led-execution/execution/m4-wave-1/m4-c-non-git-replacement-postapply.test.mjs
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/main-token-usage.test.ts tests/main-token-pair.test.ts tests/main-token-value-report.test.ts tests/task-economics-report.test.ts tests/daemon.test.ts tests/daemon-cli.test.ts tests/mcp.test.ts
git diff --check
```

## Stop rule

- Exactly one base Attempt. Zero extra Attempt, automatic retry, Worker validation repair, Main
  correction, no-Worker reverify, adaptation, model switch, fallback or further replacement.
- Any bootstrap, native Goal, independent acceptance, Judge or Integration failure stops this Work
  Item. Preserve the Workspace and return a final decision packet; do not create another Task.
- Stop if Candidate/source identity differs or the accepted boundary must widen.
- No Hub/UI, calibration, ranking, Competition, commit, push or reset.

## Handoff and Workspace disposition

Worker hands off the exact materialized Candidate and explicitly reports zero Workspace edits.
ForkLight preserves all four M4-C Workspaces through dual review and activated Integration. Main
integrates only the exact independently verified Revision. On any failure, preserve this final
Workspace and durable evidence with no retry path. After successful terminal resolution, reclaim
only regenerable Task space through ForkLight's audited storage lifecycle while retaining
Revision, verification, Judge, Main and Integration evidence.

## Authorized Integration-contract-only recovery

The final Task satisfied every Candidate gate, received two usable Judge accepts and Main accept,
but its first safe Integration rolled back because the fresh source-verification project did not
contain the Task-local marker. Build, 343 focused tests and diff validation passed in that same
Integration phase. The exact Candidate and its accepted Revision remain unchanged.

On 2026-08-18 一骏 explicitly revoked this Work Item's no-retry/no-further-replacement stop only for
one Integration-contract-only recovery. This is not a new Worker Task, Candidate, verification,
Judge graph or Main review. Main may amend only the existing post-state proof and SSOT so that:

- ForkLight's accepted Revision, full patch digest and exact affected-path set remain the durable
  Candidate identity;
- the proof validates both Workspace-local patch digests and derives the exact ten paths directly
  from the retained patch;
- the final delta and other nine base paths still pass reverse `git apply --check`;
- no Task-local marker, `.git` metadata or sibling Workspace is required during Integration.

Before mutation, Main must run the amended proof in both the protected Candidate Workspace and a
fresh Integration-like plain project with the exact Candidate applied and no `.git` or `.forklight`.
Then ForkLight may create one fresh preflight receipt and run exactly one new safe Integration for
Revision `12499c76-33bc-4578-9e9b-1878a81ba4b4`, digest
`d7327f8c6a0ccd5232b950af4a2ed59143f2c0ef81c846d5287c6305352d92ab`. No Grok rerun, new
Candidate, reverify, correction, Judge, Main re-review, manual source apply, fallback or subsequent
Integration is authorized. Success proceeds to full `npm run check` and activation evidence;
failure preserves the Workspace and stops M4-C permanently under this boundary.

The one authorized recovery passed preflight and all four Integration stages. The full check
passes 3,061/3,061 and activated client/Daemon identity is matched. M4-C is graduated; see
`goals/forklight-main-led-execution/evidence/m4-c-family-value-report-delivery.md`.
