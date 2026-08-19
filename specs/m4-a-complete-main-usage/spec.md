# M4-A Work Item — Complete Main usage capture

## User result

ForkLight can record the complete Token usage of the Main that did an equivalent task directly and
the Main that planned, supervised, reviewed and decided a delegated task. Both measurements use the
same explicit Codex profile and terminal-counter method. CLI/MCP exchange size remains visible as a
separate boundary metric and is never relabeled as complete Main usage.

## Background and current evidence

The focused entry audit is
`goals/forklight-main-led-execution/evidence/m4-entry-audit.md`. Current Task Token reports already
combine Worker terminal usage and 11,590 count-only orchestration exchange receipts. Two legacy
direct-Codex publications exist, but no record distinguishes a direct-Main run from a
delegated-Main orchestration/review run. As a result the current `directCodexSavings` calculation
subtracts an exchange-byte estimate from a direct Codex total. That is honest low-confidence
boundary evidence, not the complete Main Token evidence required by M4.

`normalizeCodexTerminalUsage` already validates the canonical five-counter Codex terminal result.
This Work Item reuses it and adds only the missing role-aware durable capture path.

## `depends_on`

- M3 is graduated and the active client/Daemon build identities match.
- Existing Codex terminal usage normalization, Task `taskClass`/`taskFamily`,
  `directCodexProfileId`, StateStore and CLI/MCP receipt behavior are stable inputs.
- No M4-B pair decision or M4-C value aggregation is required to capture usage.

## Inputs

- one existing ForkLight Task id whose stored Spec has explicit `taskClass`, `taskFamily` and
  `directCodexProfileId`;
- one caller-supplied opaque `comparisonId` shared by the future direct/delegated sides;
- role `direct-main` or `delegated-main`;
- one unique opaque Codex run reference;
- one complete Codex `turn.completed` usage object accepted by the existing canonical normalizer;
- a generated sample id and canonical capture time.

## Outputs and behavior

- An immutable privacy-safe Main usage sample containing only identifiers, role, the stored Task
  class/family/Main profile identity, four disjoint Token counters, gross Token count, source
  `codex-terminal-result`, run reference, timestamp and schema version.
- `taskClass`, `taskFamily` and Main profile are derived from the stored Task. The caller cannot
  override or infer them from a model name.
- Each `comparisonId` admits at most one sample per role. Each sample id and run reference is unique.
- Duplicate or contradictory identity fails before persistence with a bounded non-echoing error.
- Read-only status returns zero, one or two captured roles and explicit readiness for pair review;
  it never creates a pair, review, Task, Competition or Worker.
- New CLI and MCP/Daemon surfaces share the same canonical service. Suggested CLI shape:
  `forklight main-token capture --task-id ... --comparison-id ... --role ... --run-ref ... --usage ... --json`
  and `forklight main-token status --task-id ... --comparison-id ... --json`.
- Existing direct-Codex calibration, Task Token report and exchange-receipt schemas remain readable
  and unchanged. They are not silently promoted to M4 samples.

## Allowed paths

One Grok 4.6 Xhigh native Goal Writer may modify only:

- `src/core/main-token-usage.ts` (new)
- `src/state/store.ts`
- `src/daemon/coordinator.ts`
- `src/daemon/protocol.ts`
- `src/daemon/server.ts`
- `src/cli.ts`
- `src/mcp/server.ts`
- `tests/main-token-usage.test.ts` (new)
- `tests/store.test.ts`
- `tests/daemon.test.ts`
- `tests/daemon-cli.test.ts`
- `tests/mcp.test.ts`

If a listed entry file needs no change it may remain untouched. Any additional path requires Main
to update this Spec before implementation continues.

## Acceptance

1. Complete direct/delegated Main samples round-trip through Store and canonical Daemon/CLI/MCP
   paths with identical count-only output.
2. Both roles reuse `normalizeCodexTerminalUsage`; cache and reasoning subsets cannot be counted
   twice, missing/incomplete/malformed usage fails closed, and no Provider value is invented.
3. Task class, family and Main profile come only from the stored Task. Missing identity rejects
   before any sample row is written.
4. One comparison cannot contain duplicate roles, sample ids or run references. A failed insert
   leaves existing truth unchanged.
5. Status is read-only and reports missing roles explicitly. Capture never computes a saving,
   judges quality or changes Task/Integration authority.
6. No raw prompt, response, source, diff, path, credential, model configuration or free-form note is
   persisted or returned.
7. Existing direct-Codex publications and legacy Tasks remain readable without migration or
   backfill.
8. ForkLight independent verification passes. Two different-view read-only Judges inspect counter
   truth, privacy, Store compatibility and non-claim behavior; Main integrates only the exact
   accepted Revision.

## Verification commands

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/main-token-usage.test.ts tests/store.test.ts tests/daemon.test.ts tests/daemon-cli.test.ts tests/mcp.test.ts
git diff --check
```

Run `npm run check` after the accepted high-risk Integration, not during ordinary progress updates.

## Forbidden and non-goals

- No saving claim, pair review, quality comparison, family aggregation or evidence calibration.
- No replacement of exchange receipts, Worker usage, direct-Codex publications or economics.
- No raw text/log capture, tokenizer, Provider call, pricing change, Hub/UI, automatic Task,
  Competition, Judge, retry, correction or Integration.
- No caller-supplied task class/family/profile override, legacy inference, checksum, content hash,
  lock, lease, version handshake, distributed or multi-user coordination.
- Stop if complete comparable counters require reading private Codex state or changing Runtime
  authentication. The caller must supply the terminal usage event explicitly.

## Handoff and workspace disposition

Worker hands off exact paths, public sample/status shapes, Store schema, focused results and any
counter-source limitation. ForkLight verifies the Candidate, two Judges inspect it independently,
and Main reviews the full diff before serial safe Integration. Protect the Workspace until
Integration and activated CLI/MCP smoke are durable; then use the accepted Task storage lifecycle
to reclaim regenerable space while retaining sample schema and delivery evidence.
