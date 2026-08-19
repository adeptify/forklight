# M3-C Work Item — Execution-strategy and exceptional-policy learning

## User result

ForkLight can use naturally accumulated task-family history to distinguish execution strategies
such as `single-run`, `persistent-session` and `native-goal`, while keeping Competition and Judge
depth explicit Main policies. It explains what the history supports and says `cannot-determine`
when modes or policies lack comparable evidence; it never manufactures work or automatically
escalates review.

## Background and current evidence

ForkLight already freezes an execution mode on every new Task, records natural Competition history,
supports explicit `requiredJudges`, aggregates read-only Judge opinions without voting, and records
exact failure attribution. Model-routing statistics, however, group full Worker identity only by
provider/model/Runtime/effort, so different execution modes are merged. Competition candidate
creation also replaces provider/model/Runtime/effort but can retain the source Task's old execution
preference/mode, creating a concrete false-history risk before any strategy learning is added.

Competition is already exceptional: routing uncertainty alone cannot start it, intent `none` never
advises it, and Main owns the final choice. Judge depth is also explicit and frozen. This Work Item
preserves those policies while adding read-only historical explanation; it does not turn natural
history into automatic Competition or Judge selection.

## `depends_on`

- M2 Runtime execution truth, Review Graph, Competition, exact failure attribution and Main
  decision chain are graduated.
- The first child slice, Competition execution truth, depends only on existing Runtime capability
  and Profile execution preference and may run in Wave 1 beside M3-A because paths are disjoint.
- Mode-aware strategy/policy advice depends on that child slice plus integrated M3-A and M3-B
  public decision contracts; it runs serially afterward.

## Inputs

- terminal ordinary Task history with explicit taskClass/taskFamily, frozen Worker identity,
  execution mode, verification, Main delivery and failure attribution;
- naturally occurring Competition records, evaluations and Main decisions for the requested family;
- explicit Task review requirement and naturally occurring Review Graph outcomes;
- the caller's shortlisted saved Worker Profile ids and explicit Competition intent/triggers.

## Outputs

- Competition candidates freeze their own execution preference and resolved mode before launch;
- mode-aware task-family evidence keeps different execution modes separate;
- one read-only strategy/policy projection integrated with the canonical routing advice or exposed
  through one equally bounded canonical Daemon/CLI/MCP query;
- execution recommendation only when comparable evidence supports it; otherwise
  `cannot-determine` with stable reasons;
- Competition and Judge history summarized as explanation of Main's explicit policy, never as an
  automatic mutation or global ranking.

## Work slices and ownership

### Slice C1 — Competition execution truth

Accepted child Spec:
`specs/m3-c-strategy-policy-learning/work-items/competition-execution-truth/spec.md`.

Only `src/core/competition.ts` and `tests/competition.test.ts` are writable. It may run in Wave 1
beside M3-A; the exact writable path intersection is empty. Main integrates serially.

### Slice C2 — Mode-aware strategy and policy advice

Runs only after C1, M3-A and M3-B are integrated. One Writer owns:

- `src/core/statistics.ts`
- `src/core/model-routing.ts` or one focused new `src/core/strategy-advice.ts`
- `src/core/profile-routing.ts` only if required by the frozen M3-A contract
- `src/core/types.ts` only for the already-accepted backward-compatible decision projection
- `src/daemon/coordinator.ts`
- `src/daemon/server.ts`
- `src/daemon/protocol.ts`
- `src/cli.ts`
- `src/cli/routing-output.ts` if the existing routing surface is extended
- `src/mcp/server.ts`
- focused tests in `tests/statistics.test.ts`, `tests/model-routing.test.ts`,
  `tests/competition.test.ts`, `tests/review-graph.test.ts`, `tests/daemon.test.ts`,
  `tests/daemon-cli.test.ts` and `tests/mcp.test.ts`, plus one focused new strategy test if useful.

No Hub/UI path is allowed. Main is the only SSOT writer and integrates every Candidate serially.

## Required behavior and call chain

1. Competition admission resolves each Profile's execution preference against that candidate's
   Runtime capability and fails all-or-nothing before any Candidate persists if a forced mode is
   unsupported.
2. Statistics group comparable history by provider/model/Runtime/effort/execution mode. Legacy
   Tasks without frozen mode remain explicitly legacy/unknown and are not guessed into a mode.
3. Non-model failures remain excluded from model/mode quality; ambiguous attribution remains
   visible and never becomes a synthetic loss.
4. Exact task-class evidence wins; explicit task-family fallback is complete-set only. Fewer than
   two comparable strategies, insufficient samples or insufficient gap returns `cannot-determine`.
5. Competition history is evaluated only when Main supplied `consider` or `required` plus valid
   triggers. Intent `none` remains not advised regardless of uncertainty or historical counts.
6. Judge projection reports the explicit required depth, usable/unusable outcomes and distinct
   underlying Worker execution identities for selected Judge Profiles. Different Profile ids with
   the same underlying identity do not masquerade as two historical perspectives.
7. Judge evidence never votes, changes Integration gates, picks/replaces a Judge, adds a third
   Judge or infers a requirement when Main omitted one.
8. Main-direct history may be displayed separately but never compared as a Worker win/loss sample.
9. Queries are read-only and privacy-safe; no task, Competition, Review Graph or Store mutation.

## Acceptance

1. Mixed-Runtime Competition candidates freeze their own provider/model/Runtime/effort,
   execution preference and resolved execution mode; source mode cannot leak.
2. Unsupported forced execution mode rejects the whole Competition before any Task, event,
   Workspace, snapshot or Provider launch.
3. Same Worker identity with different execution modes produces separate evidence rows; legacy
   missing-mode history is explicit and never inferred.
4. Strategy recommendation is family/candidate scoped and carries confidence; absent comparable
   mode history says `cannot-determine` without manufactured reruns.
5. Competition stays exceptional and Main-authored. Historical tie/disqualification/decision facts
   are explanation only and never trigger work.
6. Judge policy shows declared depth and underlying identity diversity, preserves no-vote/Main
   authority, and returns `cannot-determine` when history or requirement is absent.
7. Three representative natural task families have reviewable final projections covering at least
   one supported recommendation and honest cannot-determine cases. No Hub family work is executed;
   historical Hub-labeled records may be read as evidence only.
8. ForkLight independent verification passes. Two different-view Judges review Competition truth,
   failure isolation, policy non-automation and compatibility; Main serially integrates exact
   accepted Revisions.

## Verification commands

For C1, use the child Spec. For C2:

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/statistics.test.ts tests/model-routing.test.ts tests/competition.test.ts tests/review-graph.test.ts tests/main-failure-attribution.test.ts tests/daemon.test.ts tests/daemon-cli.test.ts tests/mcp.test.ts
git diff --check
```

At M3 boundary run `npm run check`, activate the matched Daemon, and produce the three real
family projections plus one no-evidence projection. No synthetic Provider Task is allowed.

## Forbidden and non-goals

- No automatic Competition, Judge assignment/replacement, third Judge, majority vote, retry,
  correction, adaptation, fallback, Worker switch or Integration.
- No global model/runtime leaderboard, synthetic benchmark, manufactured rerun or task-family
  inference.
- No change to Review Graph integration authority or Main's explicit review requirement.
- No Hub/UI, Provider credentials, Runtime Goal implementation, storage lifecycle or M4 Token/value
  claims.
- No checksum, content hash, lock, lease, version handshake, migration, multi-user/distributed or
  cross-node coordination.
- Stop if a strategy needs new execution data rather than natural history, if two rounds repeat the
  same failure, or if policy advice requires changing Main authority.

## Handoff and workspace disposition

Each Worker hands off exact paths, evidence grouping, public response, focused tests and remaining
evidence limits. ForkLight verifies every exact Candidate. Two Judges bind to each meaningful
Revision; Main resolves disagreement and integrates serially. Protect Workspaces through durable
Integration/activation/family evidence, then use the accepted storage lifecycle. M3 evidence is
written only under the current Goal directory.

