# M3-B verification-stop decision packet

Date: 2026-08-16 (Asia/Shanghai)

## What is complete and reusable

- Task `f5481469-2d82-4223-972d-2f250470e15f`; Session
  `ad6f786c-83da-4be4-b245-ad4e90bdbb0d`; Grok 4.6 Xhigh native Goal.
- Final Candidate Revision `23b7f864-6f6f-44ac-9726-6b0c83bbfe50`; digest
  `7fb1fdcf9f156964ac4444c1611e91c77c6b958538eaf34088b9c8780bf30a3a`; 11 paths; 1,711 changed
  lines; source-compatible with only two unrelated Goal-SSOT paths changed by Main.
- The Candidate extends the existing `RoutingDecisionSnapshot` with optional frozen advisory and
  Main relationship, preserves legacy decisions, rejects contradictory shapes, projects bounded
  facts through preview/CLI/Daemon/MCP, and hides Main note, settings digest and raw sample keys.
- Main's two confirmed product gaps are closed in the final bytes: recommendation/selection binds
  exact optional Worker Profile identity even when executable identities match, and frozen
  `resolvedExecutionMode` must equal the Task's admitted mode.
- `npm run build` passes. `git diff --check` passes. The focused suite passes 465/466.

Reusable paths:

```text
src/core/routing-explanation.ts
src/core/task-preview.ts
src/core/task.ts
src/core/types.ts
src/mcp/server.ts
tests/daemon-cli.test.ts
tests/daemon.test.ts
tests/mcp.test.ts
tests/routing-explanation.test.ts
tests/task-preview.test.ts
tests/task.test.ts
```

The private immutable patch is retained at the Candidate revision artifact inside the protected
Task root. It has not been applied to source.

## Exact remaining gap

Only `tests/mcp.test.ts` remains. In the new `modeMismatch` request, the nested routing fixture has
`taskFamily: main-orchestration-metadata`, but the top-level MCP Task input omits that same family.
The existing family-coherence guard correctly rejects first. The test then expects the later
execution-mode error and fails. Align the top-level family with the nested fixture, then rerun the
unchanged accepted commands. No production schema or behavior change is currently indicated.

## Attempts and review truth

1. Base Attempt `a37e9e78-9a8f-4b3e-a9ca-c888ebc08c73` delivered 11 paths. Independent tests passed,
   but build found a TypeScript inference error in a new MCP fixture.
2. The Task's sole automatic validation repair, Attempt
   `27429e3b-38fb-4d5d-a2a2-0e32631f04ad`, fixed that fixture and independently passed all commands.
   Review Graph `c16041be-4ea8-41e6-8c12-d581dd7b8922` had one usable Codex accept and one
   schema-invalid DeepSeek result. Main inspected the diff, found two stronger blockers, and
   recorded exact-Revision `revise` instead of accepting or repairing the soon-stale Judge result.
3. Main correction Attempt `894ac248-e934-4952-8b42-6f52d0d6efd8` reused all 11 paths and closed
   both blockers. Its independent verification captured the final Candidate but failed the single
   deterministic MCP fixture described above.

The Task now has zero validation repairs, zero Main corrections and zero adaptation rounds
remaining. The old Review Graph is stale for the final Revision. No current-Revision Judge, Main
accept, preflight or Integration exists.

## Remedies deliberately not taken

- no unchanged `reverify`, because the deterministic fixture would fail again;
- no Main edit inside the protected Worker Workspace;
- no acceptance amendment or excluded test;
- no stale Judge-result repair or replacement Judge;
- no Candidate Integration, source patch, model switch, M3-C2 start, Hub/UI, commit or push.

## Workspace disposition

Protect the full Task Workspace, Runtime Home, final Candidate artifact and stale review evidence.
Nothing is reclaimable until Main either delivers or explicitly abandons the reusable Candidate.

## Recovery submission preflight (not authorized or submitted)

Main completed only read-only checks after the stop. The protected Revision artifact still hashes
to `7fb1fdcf9f156964ac4444c1611e91c77c6b958538eaf34088b9c8780bf30a3a`, exposes exactly the 11
reusable paths listed above, and passes a forward `git apply -p2 --check` against the current source
with global and system Git configuration isolated. This is the existing Candidate provenance and
wrong-source-base safety check, not a new coordination or content-addressing system.

The current build-matched Daemon is healthy; `grok-4-6-xhigh` remains launchable as Grok 4.6 Xhigh
and resolves to `native-goal`. The prior M2 exact-Candidate bootstrap provides a proven local
pattern: verify the frozen artifact and source base inside the isolated Workspace before launching
the real Grok CLI native Goal. A recovery would reuse that minimal pattern, allow only
`tests/mcp.test.ts` to differ from the frozen 11-path Candidate, and retain the original M3-B
acceptance commands and fresh review chain. No wrapper, seed copy, Task YAML, submission or Store
mutation has been created because 一骏 has not yet authorized this new Task.

## Decision required from 一骏

Recommended: authorize one new, single-purpose exact-Candidate recovery Task. It may materialize the
immutable 11-path Candidate into a fresh isolated Workspace, allow Grok 4.6 Xhigh native Goal to
edit only `tests/mcp.test.ts` for the one family-fixture alignment, and run the original acceptance
commands. Freeze one Attempt, no validation repair, correction, reverify, adaptation, fallback or
replacement. If it passes, require two fresh different-view Judges on the new exact Revision,
fresh Main review and normal serial safe Integration. Any failure stops M3-B again.

Alternative: stop M3-B and retain the protected Candidate without Integration. M3-C2 and the M3
exit remain blocked.

## Decision — 2026-08-17

一骏 explicitly authorized the recommended single-purpose recovery. Main may now create and submit
exactly the Task described above. The failed Task and its evidence remain immutable; authorization
does not permit another Attempt, correction, replacement or acceptance change if the recovery
fails.

The operational preflight passed and recovery Task `aa524fdd-1558-4d92-8d5a-ae49f738c9b4`
(Session `88a6557a-ee6d-40fc-887c-4abe1fb5dd19`) is now queued on Grok 4.6 Xhigh native Goal. The
Workspace seed matches the protected digest and exact path set, forward-applies to current source,
and the validated Task freezes one Attempt with every repair/retry/replacement route at zero.

## Delivery — 2026-08-17

The authorized recovery completed in its sole Attempt. Final Revision
`72fe6e93-764c-4872-9a49-e5d825fbc775`, digest
`41243125a7c78b49524d90db9cdb8c4bdfe421d749dd73f566c6ec136e8fc5b9`, passed all independent
commands and 466/466 focused tests. Ten retained paths compare byte-for-byte with the protected old
Workspace; the eleventh differs only by the authorized `taskFamily` fixture line. Two fresh
different-view Judges returned usable accepts, Main accepted, and Integration
`8b45d56a-7b7a-4ff6-9e5e-3223bac0fa87` passed all four stages. The source full check passes
3,008/3,008 and activated client/Daemon identity is matched. M3-B is delivered and M3-C2 may start.
