# M3-C1 Work Item — Competition candidate execution truth

## User result

Every Worker Profile entering a Competition runs with its own frozen execution preference and
resolved execution mode. A candidate can no longer inherit the source Task's old mode, so future
task-family strategy history is trustworthy.

## Background and problem evidence

`cloneSpecFromIdentity()` currently replaces the source Task's provider, model, Runtime, effort and
Profile identity for each Competition candidate. It does not replace `executionPreference` or
`executionMode`. Existing mixed-Runtime coverage asserts candidate provider/Runtime identity but
does not assert execution truth. A source native-Goal Task cloned to a Runtime or Profile with a
different preference can therefore persist a stale mode and later pollute M3 strategy evidence.

The repository already has authoritative `resolveExecutionMode`, Runtime capability metadata and
Worker Profile execution preference. This slice reuses them. It adds no new setting or strategy.

## `depends_on`

- Existing Profile candidate admission and all-or-nothing Competition readiness.
- Existing Runtime capability and execution-mode resolution.
- No dependency on M3-A or M3-B; exact paths are orthogonal to M3-A Wave-1 paths.

## Inputs and outputs

Inputs:

- canonical source Task Spec;
- each admitted saved Worker Profile's frozen identity and execution preference;
- candidate Runtime capability.

Outputs:

- each candidate Task freezes its Profile's preference and resolved mode;
- `auto` resolves independently for each Runtime;
- a forced unsupported mode rejects admission before any Competition/Candidate durable mutation;
- legacy explicit provider/model Competition behavior remains unchanged.

## Allowed paths

One Grok 4.6 Xhigh native Goal Writer owns exactly:

- `src/core/competition.ts`
- `tests/competition.test.ts`

No other product, test, documentation, Spec or Goal path is writable. Main updates SSOT and
integrates. This set has zero intersection with M3-A's accepted Wave-1 paths.

## Acceptance

1. A mixed-Runtime Competition test asserts provider, model, Runtime, effort, Profile,
   `executionPreference` and resolved `executionMode` for every candidate.
2. `auto` uses the candidate Runtime's capability rather than the source Task's frozen mode.
3. An explicit Profile preference wins over the source Task preference.
4. A forced unsupported candidate mode fails all-or-nothing before any Task, event, Competition,
   snapshot, Workspace or Provider launch.
5. Existing network, billing, advanced-policy, source snapshot, ranking and Main-decision behavior
   is unchanged.
6. ForkLight independently passes the accepted commands; two read-only Judges inspect execution
   truth and admission atomicity; Main integrates only the exact accepted Revision.

## Verification commands

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/competition.test.ts
git diff --check
```

## Forbidden and stop rules

- No edit outside the two allowed paths.
- No routing score, recommendation, Task schema, Review Graph, Judge policy, Daemon/CLI/MCP/Hub,
  Provider Runtime or Store change.
- No fallback, retry, correction, Competition launch against the real project, benchmark, lock,
  hash, lease, handshake or distributed mechanism.
- Stop if the fix cannot reuse existing execution-mode resolution, if it requires public schema or
  Store migration, or after two purposeful rounds repeat the same failure.

## Handoff and workspace disposition

The Worker reports the old stale-mode path, exact resolution call, atomic failure boundary and
focused test results. ForkLight verifies one exact Candidate. Two Judges review source-mode leakage
and pre-mutation failure behavior; Main serially reviews/integrates. Protect Workspaces until the
accepted Revision, Judge evidence, Integration and activation are durable, then follow normal
terminal reclamation.

## Completion evidence — 2026-08-16

ForkLight Task `4112a313-566b-4d24-988f-e1bfb2c57735` used one Grok 4.6 Xhigh native Goal Attempt
and delivered exact two-path Revision `e2cf75bd-ad83-4721-bf8f-4b4a4cebb793`, digest
`f6365dd501356f5bf01d5603bd9f20f8cf556e3cb46f8beb18ec261109d0e166`, with 176 changed lines.
Independent build, focused Competition tests and diff validation passed. Two different-view Judges
returned usable `accept`; Main accepted only that Revision. Integration
`eac989dd-5a91-4862-8fe3-bc9f0cd4b483` passed source apply, verification, build and activation.

The delivered path resolves each Profile candidate's own execution preference against that
candidate Runtime before persistence. Mixed Runtime `auto`, explicit preference and unsupported
forced-mode all-or-nothing admission tests pass, with zero durable rows or directories on the
rejected path. Acceptance 1–6 pass; no Competition was launched against the real project.
