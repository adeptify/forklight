# M2-C real Store compatibility — legacy Competition handoff

## User result

`forklight storage audit` and `forklight storage preview` can read the developer's existing
ForkLight Store, including a durable Competition handoff written before the typed `origin` field
was introduced. Current records keep their existing semantics, malformed legacy records fail
closed with a bounded corruption error, and no Store row is rewritten merely to make the read
succeed.

## Background and current evidence

The accepted parent is `specs/m2-c-task-storage-lifecycle/spec.md`. Recovery Goal
`goals/forklight-main-led-execution/execution/m2-c-recovery/goal.json` completed all four gates:
the corrected Candidate was independently verified, accepted by two fresh Judges, safely
integrated and activated, and three serial zero-diff audits passed. Main then ran the required
real-home read-only commands. Both failed before returning a lifecycle view:

```text
ForkLight error: Cannot read properties of undefined (reading 'kind')
```

A focused direct invocation produced this exact call chain:

```text
projectCandidateHandoff -> resolveHandoffViewForTask ->
buildMainDecisionPacketForTask -> classifyKnownTask -> auditStorage
```

The real Store has one authentic legacy Competition handoff whose JSON has the old top-level
`competitionId` and `sourceCandidateId` fields and no `origin`; three newer handoffs already have
typed `goal-task` origins. The existing Work Hierarchy deliberately acknowledges origin-less
legacy rows, but the shared handoff projection unconditionally dereferences `record.origin.kind`.
This is a durable-schema readability blocker inside M2-C, not a new product direction.

## `depends_on`

- M2-A and M2-B are graduated.
- M2-C recovery Goal is 4/4 complete and Integration operation
  `5febafdd-88ee-44d0-86ab-de5b9dbff75f` is applied.
- The source full check passed build plus 2,916 tests after that Integration.
- No other product writer may run concurrently. This Work Item is serial because it reads and may
  modify the same Store/handoff authority used by storage lifecycle.

## Inputs

- Current-format `CandidateHandoffRecord` with typed `origin`.
- Authentic legacy Competition handoff JSON with valid top-level `competitionId` and
  `sourceCandidateId`, but no `origin`.
- Malformed origin-less handoff JSON without enough legacy identity to reconstruct the origin.
- Existing StateStore candidate-handoff readers and storage audit/preview call chain.

## Outputs and design

1. Use one compatibility normalization at the durable candidate-handoff read boundary so every
   StateStore handoff reader sees the same in-memory truth.
2. Return a current typed `competition` origin for the authentic old shape using only its existing
   top-level ids. Do not persist, migrate or rewrite the row during a read.
3. Return current-format records unchanged.
4. Preserve the established unknown-legacy collection behavior: an origin-less row without the
   authentic Competition fields remains visible to legacy-tolerant collection views, and Work
   Hierarchy claims no Goal ownership for it. A consumer that requires concrete handoff semantics
   must fail closed with one stable content-free corruption error instead of a JavaScript
   `TypeError`; Goal lineage likewise ignores it rather than guessing ownership.
5. Keep writes current-format only. Do not add a new schema version, version handshake, checksum,
   lock, lease or duplicate cross-row consistency protocol.

This minimal normalization is retained because it directly prevents an existing durable protocol
record from making the Store unreadable. The focused regressions below are its required proof.

## Scope and scenarios

### Authentic legacy row remains readable

Given an old Competition handoff with top-level Competition identity and no `origin`, every
candidate-handoff Store reader returns a current in-memory Competition origin; handoff projection,
Main decision composition, storage audit and all-eligible preview complete without mutating Store.

### Current rows do not drift

Given current Competition and Goal-Task handoffs, read projections retain the exact origin kind and
origin-specific ids, with no fabricated Competition identity for Goal Tasks.

### Unknown legacy shape fails closed

Given an origin-less record lacking the authentic old Competition identity, read fails with a
bounded corruption error when concrete handoff semantics are required. Generic collection and
Work Hierarchy reads remain usable, keep both Tasks visible as one-off, and claim no Goal
ownership. No path may hide the Task, mutate the row or continue into unsafe lifecycle
classification.

## Allowed writable paths

- `src/state/store.ts`
- `src/core/candidate-handoff.ts` only if a bounded projection guard remains necessary after the
  shared read normalization
- `src/core/goal.ts` only to ignore an unproven origin in Goal lineage instead of dereferencing it
- `src/core/types.ts` only for an explicit internal legacy-read shape; the public current record
  and view must not be weakened unnecessarily
- `tests/store.test.ts`
- `tests/competition.test.ts`
- `tests/task-decision-view.test.ts`
- `tests/storage-lifecycle.test.ts`
- `tests/work-hierarchy.test.ts`
- `tests/goal.test.ts`

Generated `dist/**` remains verification output, never Candidate business content.

## Forbidden paths and non-goals

- No CLI, daemon, MCP or Hub redesign; those surfaces already share the correct storage call.
- No Store write migration, raw SQL rewrite of the real home, deletion, reclaim, retention change,
  historical backup work or real-home mutation by Worker/tests.
- No change to handoff admission, one-hop policy, Review Graph, Goal scheduling, Integration,
  Worker Runtime, routing, economics, Token accounting or unrelated durable records.
- No lock, lease, checksum, content hash, manifest, schema negotiation, cross-node/multi-user
  coordination, duplicated validation or broad legacy abstraction.
- No commit, push, remote change, credentials or paths outside the isolated Task Workspace.

## Acceptance

- The authentic legacy Competition shape is normalized once at the shared Store read boundary and
  is readable through direct lookup, source/successor lookup and list paths.
- `projectCandidateHandoff`, `buildMainDecisionPacketForTask`, `auditStorage` and `previewStorage`
  complete for temporary Stores containing that shape.
- Current Competition and Goal-Task records preserve exact origin semantics.
- An unreconstructable origin-less row remains visible to legacy-tolerant collection/Work
  Hierarchy reads without claimed Goal ownership; projection, Main decision and storage semantics
  fail closed with a stable non-echoing corruption error, and Goal lineage ignores it.
- Read compatibility writes no Task/event/handoff row and does not change the durable JSON.
- Focused tests use temporary Homes only; the real ForkLight Home is read only by Main after safe
  Integration.
- Final Candidate stays inside the allowed paths, excludes `dist/**`, and remains source-compatible.

## Verification commands

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/store.test.ts tests/competition.test.ts tests/task-decision-view.test.ts tests/storage-lifecycle.test.ts tests/work-hierarchy.test.ts tests/goal.test.ts
git diff --check
```

The local verifier keeps the 30-minute per-command safety breaker. The Work Item has no absolute
duration, Token or no-progress deadline.

## Review, handoff and stop

- One Grok 4.6 Xhigh `persistent-session` Worker owns implementation and self-check. ForkLight runs
  the approved commands independently.
- Because this touches durable-schema compatibility and destructive-lifecycle eligibility, use two
  independent read-only Judges: one for legacy/current semantic truth and one for Store/privacy/
  lifecycle fail-closed behavior. Judges do not edit or authorize Integration.
- Main reviews the exact diff and Candidate provenance, records the final decision, then uses only
  ForkLight safe preflight/apply.
- One same-Task correction may fix a verified in-scope gap. Stop with a decision packet if two
  purposeful rounds repeat the failure, patches compensate for prior patches, the real shape
  cannot be represented without a Store rewrite, or scope must cross the allowed paths.

## Handoff and workspace disposition

- Handoff contains this spec, current source snapshot, the bounded legacy shape (field names only),
  exact allowed paths, commands and acceptance. It never contains raw private record content.
- Protect the Worker Workspace, Candidate, verification and Judge evidence through Integration.
- After Integration, Main reruns real `storage audit` and `storage preview`. Only then may ordinary
  reclaim proceed from the exact preview; unknown/durable/history content remains preserved.
