# M2 Coding journey — source-only Integration restart recovery

## User result

If the local ForkLight daemon restarts after a reviewed source-only Candidate has been applied and
that `source-applied` stage is durable, ForkLight can safely continue the same Integration operation
through isolated source verification to one terminal result. The operator re-queries the original
`operationId`; ForkLight neither applies the patch twice nor asks Main to reconstruct state by hand.

## Background and current evidence

`DaemonCoordinator.recoverIntegrationOperations()` currently reconstructs operation identity from
`integration.operation.started`, then records `outcome-unknown` whenever no final result exists.
`applyIntegration()` has already made the prior receipt one-use before source mutation and records
stage evidence after a successful patch, but no path can resume from that evidence. The public
operations guide explicitly calls post-process-crash stage recovery unimplemented.

The smallest complete slice is source-only delivery: a passed durable `source-applied` stage, no
stored result, and no declared build, activation, or activation-check command. This closes a common
safe path without pretending that a crash during a side-effecting build or activation is replayable.

## `depends_on`

- M2-A/B/C are integrated and graduated.
- `specs/m2-delivery-journeys/spec.md` is accepted.
- No other product writer runs concurrently. Main integrates this Candidate before the non-Coding
  journey starts.

## Inputs and outputs

Inputs:

- canonical Task, consumed Integration receipt, original `operationId`, durable stage events,
  Candidate Workspace/Diff, deterministic backup directory, current source, and Integration
  settings;
- one daemon startup/recovery call.

Outputs:

- the original operation becomes `running` while a single bounded recovery owns it, then stores
  exactly one ordinary `applied`, `rolled-back`, or `retained-failure` result;
- existing `integration status`, `wait`, and history expose the same operation and stage evidence;
- unsafe or unsupported states remain `outcome-unknown` with fixed bounded recovery evidence and no
  source mutation.

## Design and concrete safety boundary

Recovery is eligible only when all of these are true:

1. `integration.operation.started` is readable and has no stored result.
2. Exactly one durable `source-applied: passed` evidence item exists for the operation; no failed,
   unknown, duplicate-conflicting, or later stage makes the history ambiguous.
3. The canonical Task declares no build, activation, or activation-check command.
4. Every component of each affected Candidate, live-source, and backup path is proven to stay under
   its owned root without a symlink ancestor; the final node is exactly a regular file or exact
   `ENOENT`. Every affected live source path then matches the reviewed Candidate's intended final
   bytes (or intended absence), and the deterministic backup set matches the receipt's pre-apply
   evidence. Unreadable, directory, symlink, and other I/O states refuse recovery.

The final-byte and backup checks exist only to prevent continuing the wrong Candidate, wrong source
base, or corrupted rollback material. Reuse existing digest primitives; do not add manifests,
checksums as a coordination protocol, schema versions, locks, leases, or handshakes.

When eligible, continue after the already-durable apply stage: run the Task's acceptance commands in
the existing isolated verification copy, recheck live affected paths before deciding success, mark
artifact/runtime stages `not-applicable`, and persist one terminal result on the original operation.
On verification failure, preserve the existing auto-rollback policy using the proven backup. On an
unsupported or unprovable state, record one recovery diagnosis and leave the operation
`outcome-unknown`; never consume another receipt, replay `git apply`, fabricate a result, or start a
new operation.

## Allowed and forbidden paths

Allowed writable paths:

- `src/core/integration.ts`
- `src/core/integration-operation.ts`
- `src/daemon/coordinator.ts`
- `src/core/types.ts` only if a minimal public recovery projection is required
- `tests/integration.test.ts`
- `tests/integration-operation.test.ts`
- `tests/daemon.test.ts`

Forbidden:

- Store schema/migration, CLI/MCP command shape, Task/Goal/Review/Storage policy, Runtime/Provider,
  Hub/UI, docs, unrelated refactor, or another product repository;
- automatic continuation for operations with build or activation work;
- patch replay, a replacement operation/receipt, broad source rollback without proven backup,
  manual source editing, commit, push, or credential access;
- multi-user/distributed coordination, lock, lease, general checksum/content hash, or version
  handshake.

## Call chain

1. Daemon startup calls the existing coordinator recovery path.
2. Recovery reconstructs durable Integration contexts and classifies the exact incomplete operation.
3. One eligible source-only operation is registered in `activeIntegrations` before background work
   starts, preventing a second in-process owner.
4. Recovery proves Candidate-final source and pre-apply backup truth, then continues isolated
   verification without replaying apply.
5. Existing stage/result persistence completes the original operation. Status/wait/history and Goal
   reconciliation consume that same truth.

## Scenarios and acceptance

- A daemon reconstruction with a durable passed `source-applied`, exact Candidate-final source,
  valid backup, and no build/activation commands resumes once and stores one successful result with
  the original IDs.
- A restart during recovered verification does not apply the patch again; later reconstruction is
  either safely eligible again or remains outcome-unknown without a second terminal row.
- Candidate-final mismatch, missing/corrupt/unreadable backup, symlink at the final node or any path
  ancestor, conflicting or receipt-mismatched stage evidence, unconsumed receipt, or declared
  build/activation refuses continuation without modifying source.
- A verification failure follows existing safe rollback/retained-failure semantics only when the
  backup is proven.
- Already terminal operations, still-running in-memory operations, disconnected observers, and the
  activation handoff path retain current behavior.
- Recovery events and public operation views are bounded and do not expose absolute paths, Diff,
  command output, source bytes, backup location, or digests.
- No Store schema or new user command is added. Legacy operation history remains readable.

## Verification commands

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/integration.test.ts tests/integration-operation.test.ts tests/daemon.test.ts
git diff --check
```

The independent verifier keeps the local 30-minute per-command safety breaker. The Work Item has no
absolute wall-clock, Token, or no-progress deadline.

## Interruption proof, review, handoff, and workspace disposition

- Worker owns research, implementation, self-check, and evidence-based correction inside its
  isolated Workspace.
- After the Task has a useful scoped edit or a materially narrower failing test, Main performs one
  confirmed daemon restart. ForkLight must continue the same Task/Session lineage under durable
  `system-daemon-restart` authority. Main does not recreate or reroute it.
- ForkLight independently runs all approved commands. Two different-view read-only Judges inspect
  wrong-Candidate/source protection, exactly-once behavior, rollback, compatibility, and privacy.
  Main makes the final decision and uses safe Integration.
- Handoff includes this spec, original Task/Session/Attempt lineage, Candidate revision, scoped diff,
  verification, Judge outputs, and exact remaining gaps. It includes no private source bytes or raw
  home content.
- Protect Workspace, backup, Candidate, and reviews while active or unresolved. After accepted
  Integration and integrated-source audits, use storage preview/reclaim for ordinary regenerable
  space and retain durable evidence.

Stop if a complete slice requires replaying build/activation, a Store migration, a new operation
protocol, a second Integration owner, or paths outside this contract. Two purposeful rounds with
the same failure or no material evidence return a decision packet.
