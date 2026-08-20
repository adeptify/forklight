# M5 pre-commit code review and simplification

## Background and goal

The current M5 working tree contains the accepted Hub refinements and the new Main-only Worker
assignment guidance, but it has not yet been committed. Before publication, 一骏 requires one
bounded review and simplification pass so the changed behavior has one understandable production
call chain, avoids duplicate projections and transient state, and contains no redundant code.

The goal is release hardening of the current uncommitted product result. It is not a new feature or
a repository-wide refactor.

## Current behavior and evidence

- Worker Profiles persist optional `assignmentGuidance`; Hub and setup surfaces can edit/read it.
- Main reads saved Worker identity and guidance through `forklight_worker_catalog`, then freezes its
  actual choice in the existing `routingDecision`.
- `ResolvedWorkerSelection`, Task contracts, Worker Runtime arguments and generated Worker prompts
  deliberately exclude guidance.
- The current implementation repeats parts of Worker identity projection in setup and MCP paths;
  the review must decide whether one shared projection removes that duplication without coupling
  setup-only readiness behavior to Main routing.
- The accepted Hub changes add branch disclosure, route-start continuity, Delivery editor state and
  Worker draft retention. The changed code must be checked for duplicate state owners, redundant
  rendering branches and helpers that no longer have a unique responsibility.
- At preflight, `git diff --check` passes. The last accepted evidence reports build, 202/202 focused
  cross-layer tests and 436/436 accepted Hub tests passing, but the current daemon build does not
  yet match the source working tree.

## Scope

### In scope

- Review every currently changed production path for Worker assignment guidance and the accepted
  Hub refinements.
- Consolidate genuinely duplicated pure projections or state transitions when one owner can serve
  all current consumers without changing public output.
- Remove unused helpers, unreachable branches, duplicate normalization and obsolete copy/style
  only when current tests and direct call-chain evidence prove they are redundant.
- Keep tests focused on behavior and privacy boundaries; simplify duplicated fixtures/assertions
  when doing so keeps failure meaning clear.
- Update the existing M5 SSOT and evidence only after the final source result is known.

### Out of scope

- New routing behavior, automatic ranking, Competition, new Worker prompt input or Provider calls.
- Backend/Store schema changes, migrations, locks, checksums, version handshakes or new state models.
- A new Hub information architecture, visual redesign, broad copy rewrite or unrelated cleanup.
- Reformatting untouched files, dependency upgrades, generated output, commit or push by a Worker.

## User and call scenarios

1. A user saves “when Main should choose this Worker” on a Worker Profile. The value is trimmed,
   bounded and stored once; blank removes it.
2. Main reads the saved Worker catalog before selection, considers the guidance with task fit,
   preference and readiness, and records the exact final reason.
3. A Task resolves and launches its Worker without guidance appearing in resolved execution input,
   Task context, Worker prompt, correction or historical Candidate data.
4. A user moves between Work, Decision Center and System routes, edits Delivery/Worker drafts and
   uses narrow layouts without duplicate state owners, lost drafts, stale task detail or overflow.

## Design and key decisions

- `WorkerProfile` validation remains the only normalization/persistence boundary for guidance.
- A shared pure catalog projection is preferred only if both setup and MCP genuinely consume the
  same identity contract. Surface-specific formatting remains at the CLI/Hub edge.
- Main-only guidance terminates at the catalog/selection boundary. Do not add defensive deletion in
  multiple downstream layers when the field is absent from the resolved selection type and input.
- Hub state has one owner per concern. A simplification is accepted only when it removes another
  owner/branch/helper and preserves route refresh, draft restoration, focus and responsive behavior.
- Code clarity is measured by fewer competing paths and explicit module responsibility, not raw
  line-count reduction.

## Inputs, outputs and dependencies

- Inputs: the current uncommitted M5 source diff, accepted Worker-guidance Spec, accepted Hub Spec,
  current tests and the live ForkLight Worker catalog.
- Output: one reviewed Candidate containing only behavior-preserving simplifications and matching
  tests, or an evidence-backed no-change conclusion for an already minimal path.
- Depends on graduated M5-A1/A2/A3/B behavior and the accepted Main-only Worker guidance result.

## File and module boundaries

Production paths allowed for the Worker Candidate:

- `src/core/worker-profiles.ts`
- `src/setup/types.ts`
- `src/setup/service.ts`
- `src/cli/setup.ts`
- `src/mcp/server.ts`
- `src/hub/public/app.js`
- `src/hub/public/app.css`
- `src/hub/public/i18n.js`
- `plugins/forklight/skills/forklight-orchestrator/SKILL.md`

Focused tests allowed:

- `tests/worker-profiles.test.ts`
- `tests/setup-service.test.ts`
- `tests/cli-setup.test.ts`
- `tests/mcp.test.ts`
- `tests/main-install-skill.test.ts`
- `tests/hub-responsive-layout.test.ts`
- `tests/hub-settings.test.ts`
- `tests/hub-ui-assets.test.ts`

The Worker must not edit SSOT, evidence, other Specs, generated files or images. Main owns those.

## Acceptance criteria

- The Worker guidance chain has one documented normalization owner and one Main catalog projection;
  setup/CLI/Hub formatting does not become a second routing authority.
- Guidance remains optional, trimmed and limited to 1,200 characters; existing profiles remain
  compatible and blank input removes the field.
- `forklight_worker_catalog` remains read-only, returns safe saved Worker identity plus guidance,
  makes no Provider call and mutates no settings.
- Guidance is absent from resolved Worker selection, Task contract/runtime input and Worker prompt.
- Every retained Hub helper/state field has one distinct responsibility in the changed flows; any
  proven duplicate or unreachable changed path is removed.
- Work hierarchy, Decision Center disclosure, route reading start, Model/Limit presentation,
  Delivery editor lifecycle, Worker draft restoration and task-detail stale-response protection keep
  their accepted behavior.
- No public API, Store schema, Runtime selection behavior, saved profile value or live Task is
  changed during review.
- Main inspects the exact Candidate diff, runs focused verification and the full suite, and records
  the final simplification evidence before commit.

## Verification

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/worker-profiles.test.ts tests/setup-service.test.ts tests/cli-setup.test.ts tests/mcp.test.ts tests/main-install-skill.test.ts
node --disable-warning=ExperimentalWarning --test --import tsx tests/hub-responsive-layout.test.ts tests/hub-settings.test.ts tests/hub-ui-assets.test.ts
node --check src/hub/public/app.js
git diff --check
npm run check
```

Main also performs a final call-chain inspection and confirms that no debug output, generated noise,
secret, unrelated change or Worker-authored commit is present.

## Assumptions and open questions

- The review covers the current dirty M5 result only. Historical implementation outside the diff is
  inspected only when required to prove a consumer or boundary.
- If a proposed consolidation would introduce a new cross-layer abstraction or change output shape,
  keep the clearer existing code and record why; do not optimize for theoretical deduplication.
- Commit and push are explicitly authorized by 一骏 after the accepted final verification.

## Execution stop — 2026-08-20

The three-path simplification passed its Worker, two independent verification rounds, one Judge,
fresh Main accept and safe Integration. Final `npm run check` then passed 3,180/3,181 and failed only
the out-of-scope checkpoint start-exchange timing assertion at 1,306ms; the exact focused test failed
again at 1,693ms against its `< 1,000ms` requirement. Per the repeated-blocker and Spec-boundary
rules, commit/push is paused. Exact evidence and the required decision are in
`goals/forklight-main-led-execution/evidence/m5-precommit-simplification-stop-decision-packet.md`.
