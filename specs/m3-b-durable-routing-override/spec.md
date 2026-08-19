# M3-B Work Item — Durable routing choice and manual override

## User result

Before a Worker starts, Main can freeze whether it followed ForkLight's routing recommendation,
manually selected another shortlisted Worker, or chose without sufficient evidence. Task preview,
CLI and MCP later explain that decision from the durable Task record, including the advisory
outcome and confidence, without re-running history or exposing Main's private note.

## Background and current evidence

`RoutingDecisionSnapshot` already freezes the shortlist, selected Worker, a bounded reason,
Competition intent and evidence sample counts. Task admission proves the selected identity belongs
to the shortlist and matches the Worker that will run. The safe routing explanation is shared by
Task preview and validation surfaces.

The missing fact is the relationship to the routing advisory. Today a `user-specified` or
`main-judgment` reason proves only why Main selected the final Worker; it does not say whether a
recommendation existed, who was recommended, whether Main overrode it, or what confidence was
shown. A later reader therefore cannot distinguish “followed recommendation”, “manual override”
and “no evidence, Main chose”. This Work Item extends the existing Task decision snapshot; it does
not create a second routing record or state system.

## `depends_on`

- M3-A canonical executable routing advice is integrated and activated.
- Existing Task classification, Worker identity, execution-mode and routing-explanation contracts
  remain backward compatible.
- M3-C strategy/policy learning consumes the frozen result only after this schema is integrated.
- This Work Item is serial because it owns shared Task/preview/CLI/MCP surfaces.

## Inputs

- the exact M3-A advisory reviewed by Main before submission;
- Main's final selected shortlisted Worker;
- one closed selection mode: followed recommendation, manual override, or Main selection after
  `cannot-determine`;
- a bounded closed reason code and optional private Main note;
- existing explicit Competition intent/triggers and evidence scope/sample counts.

## Outputs

- a backward-compatible extension inside `RoutingDecisionSnapshot`, not a parallel entity;
- frozen advisory outcome, recommended Worker when one existed, confidence when applicable,
  selected execution mode/readiness state and explicit selection mode;
- coherent Task admission validation and safe preview/validation explanation;
- CLI/MCP Task input schemas that can carry the same decision unchanged;
- legacy Tasks remain readable and project their current explanation without invented advice.

## Allowed paths and serial ownership

One Grok 4.6 Xhigh native Goal Writer owns only:

- `src/core/types.ts`
- `src/core/task.ts`
- `src/core/routing-explanation.ts`
- `src/core/task-preview.ts`
- `src/daemon/coordinator.ts` only for existing validation/preview projection
- `src/daemon/server.ts` only for existing validation/submit plumbing
- `src/cli.ts` only for validate/preview rendering if required
- `src/mcp/server.ts`
- `tests/task.test.ts`
- `tests/routing-explanation.test.ts` if a focused existing/new test file is clearer
- `tests/task-preview.test.ts`
- `tests/daemon.test.ts`
- `tests/daemon-cli.test.ts`
- `tests/mcp.test.ts`

Main alone updates this Spec and Goal SSOT/evidence. No concurrent M3 writer may touch these paths.

## Required behavior and call chain

1. Main calls the read-only M3-A advisory and decides which shortlisted Profile will run.
2. Main writes one routing decision into the Task Contract before submit. The decision records the
   advisory outcome, optional recommended identity/confidence, final selection and selection mode.
3. Admission validates structural coherence only: recommended and selected identities must belong
   to the frozen shortlist; recommendation-required fields must be present together; an override
   must select a different identity; `cannot-determine` cannot claim a recommended Worker.
4. Existing selected-Worker-to-Task identity checks remain authoritative, including resolved
   Runtime, effort and Worker Profile binding.
5. Safe explanation renders only closed outcome/basis/mode/confidence/readiness facts and aggregate
   evidence counts. It never exposes free-form notes, settings digest or raw candidate keys.
6. History is never rescored during preview or display. The frozen Task decision is durable truth.

## Acceptance

1. Following an M3-A recommendation stores and displays `followed-recommendation`, the same
   recommended/selected Worker and the frozen confidence.
2. Selecting another shortlisted Worker stores and displays `manual-override`, preserves the
   original recommended Worker and confidence, and requires a bounded Main reason.
3. An advisory with `cannot-determine` stores and displays Main selection without inventing a
   recommendation or confidence.
4. Contradictory shapes fail before Task persistence: recommended Worker outside shortlist,
   override that selects the recommendation, confidence without recommendation, or mismatched
   final Task identity.
5. Legacy Task files and existing stored Tasks remain readable; no migration, rewrite or backfill
   occurs.
6. CLI validate/preview, Daemon and MCP return the same privacy-safe explanation. Main private note,
   settings digest and raw evidence keys do not appear.
7. The schema adds no checksum, advisory hash, lock or external verification handshake. Main is the
   only local author and Task-file truth is sufficient.
8. ForkLight independent verification and two independent read-only Judges pass; Main integrates
   only the exact accepted Revision.

## Verification commands

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/task.test.ts tests/task-preview.test.ts tests/daemon.test.ts tests/daemon-cli.test.ts tests/mcp.test.ts
git diff --check
```

Run `npm run check` after high-risk Integration or at the M3 boundary, not to create activity.

## Forbidden and non-goals

- No new durable routing entity, Store table, advisory checksum/content hash, version handshake,
  lock, lease, migration, backfill or cross-node consistency mechanism.
- No automatic submission, Worker switch, recommendation enforcement, Competition/Judge creation,
  retry, correction or Integration.
- No revalidation of historical sample maps against mutable current Store; the snapshot is a
  Main-authored decision record, not distributed consensus.
- No execution-strategy scoring, Competition/Judge history analysis, Provider Runtime or Hub/UI.
- Stop if backward compatibility requires rewriting old Tasks or the scope expands into M3-C.

## Handoff and workspace disposition

The Worker hands off the exact schema delta, legacy compatibility cases, coherent/invalid examples,
privacy-safe projections and focused verification. ForkLight verifies the exact Candidate; two
Judges independently inspect schema compatibility and decision truth/privacy. Main reviews the
actual diff and integrates serially. Protect all Workspaces until Integration and activation are
durable, then use the normal terminal lifecycle policy.

## Current stop evidence — 2026-08-16

ForkLight Task `f5481469-2d82-4223-972d-2f250470e15f`, Session
`ad6f786c-83da-4be4-b245-ad4e90bdbb0d`, produced a reusable 11-path Candidate through Grok 4.6
Xhigh native Goal. Its base Attempt had one TypeScript fixture error; the frozen one-round
validation repair fixed that error and exact Revision `4c36ce15-8267-46af-b8ad-722005f04b4e`
passed all accepted commands. One Codex Judge returned usable accept and the DeepSeek Judge result
was schema-invalid. Main then found two real durable-truth gaps not caught by that graph: Profile
identity was conflated when two Profiles shared one executable identity, and selected execution
mode was not bound to the Task's admitted mode. Main recorded `revise` and returned only those two
gaps to the same Worker while reusing all 11 paths.

The bounded correction closes both product gaps and adds focused Core/Daemon coverage. Final
Revision `23b7f864-6f6f-44ac-9726-6b0c83bbfe50`, digest
`7fb1fdcf9f156964ac4444c1611e91c77c6b958538eaf34088b9c8780bf30a3a`, passes build and diff
validation; 465/466 focused tests pass. The sole failure is in the new MCP mode-mismatch test: its
top-level `taskFamily` is omitted while the nested fixture records `main-orchestration-metadata`, so
the existing family-coherence guard correctly rejects first and the assertion never reaches the
new mode guard. Product behavior is present; the test fixture needs one exact alignment.

Both the Worker validation-repair and Main correction allowances are exhausted. The old Review
Graph is stale for the final Revision; there are no current Judges, Main accept or Integration.
The full final Candidate and Workspace remain protected. The exact decision boundary is
`goals/forklight-main-led-execution/evidence/m3-b-verification-stop-decision-packet.md`.

## Authorized exact-Candidate recovery — 2026-08-17

一骏 explicitly authorizes one new single-purpose recovery Task. It is not a resume, retry,
correction, reverify or mutation of failed Task `f5481469-2d82-4223-972d-2f250470e15f`; that Task,
its Workspace, Runtime Home, Candidate and stale Review Graph remain immutable and protected.

The recovery materializes exact Revision `23b7f864-6f6f-44ac-9726-6b0c83bbfe50`, digest
`7fb1fdcf9f156964ac4444c1611e91c77c6b958538eaf34088b9c8780bf30a3a`, into one fresh isolated
Workspace before Grok starts. The digest and forward-apply check prevent the concrete failures of
using the wrong Candidate or source base; they do not introduce a general checksum, manifest,
lock, lease or coordination system. The retained Candidate has exactly the 11 paths already listed
in the stop packet.

Grok CLI 4.6 Xhigh runs one real native `/goal`. Relative to the frozen Candidate it may edit only
`tests/mcp.test.ts`, solely to give the `modeMismatch` MCP request the same top-level
`taskFamily: main-orchestration-metadata` already present in its nested routing fixture. It must not
change production behavior, rewrite retained hunks, add a test, weaken an assertion or enter M3-C.
The original three verification commands and all original M3-B acceptance criteria remain
unchanged.

This Task has one base Attempt and zero extra Attempt, validation repair, Main correction, Main
reverification, adaptation, fallback, reroute, model switch or replacement. Any Worker, native
Goal, materialization, path, verification or schema failure stops and protects the new Workspace.
On success, exactly two fresh different-view read-only Judges inspect the new exact Revision; Main
then reviews the full 11-path Candidate and may use only normal ForkLight safe Integration. M3-C2
remains dependency-held until Integration, activation and the high-risk source check pass.

## Recovery completion — 2026-08-17

Recovery Task `aa524fdd-1558-4d92-8d5a-ae49f738c9b4`, Session
`88a6557a-ee6d-40fc-887c-4abe1fb5dd19`, used its one Grok 4.6 Xhigh native Goal Attempt and no
fallback. Exact Revision `72fe6e93-764c-4872-9a49-e5d825fbc775`, digest
`41243125a7c78b49524d90db9cdb8c4bdfe421d749dd73f566c6ec136e8fc5b9`, contains the retained 11
paths and 1,712 changed lines. Main compared both Workspaces: ten retained paths are byte-identical,
and `tests/mcp.test.ts` differs by exactly the authorized matching `taskFamily` line.

ForkLight independent verification passed the operational policy/seed check, retained reverse
check, build, all 466 focused tests and diff validation. Review Graph
`bb2b12f9-dec4-43fb-b0d6-dc864f7e2172` returned two usable fresh accepts from Codex Luna Max and
DeepSeek Pro. Main accepted the exact Revision; Integration
`8b45d56a-7b7a-4ff6-9e5e-3223bac0fa87` passed source apply, source verification, artifact build and
runtime activation. The high-risk source `npm run check` passes 3,008/3,008, and the restarted idle
Daemon matches the client build. M3-B is complete; M3-C2 is dependency-ready.
