# M4-C Work Item — Family Main Token value report

## User result

For an explicit set of representative task families, ForkLight presents each valid direct/delegated
Main pair and answers whether delegated Main Token was lower without hiding Worker Token, money,
time, correction effort, evidence gaps or quality gates.

## Background and current evidence

M4-A captures complete same-method Main usage; M4-B admits only explicit same-scope,
same-acceptance, quality-not-lower pairs. Existing Task economics already keeps Worker usage,
runtime estimates, official native-currency quotes/ranges, budgets and unavailable evidence
separate. Statistics already derives correction and remediation facts from durable events.

There is no canonical family/value projection. Portfolio `directCodexSavings` currently aggregates
legacy exchange-range arithmetic and must remain distinguishable from the new exact valid-pair
result.

## `depends_on`

- M4-A and M4-B are integrated and activated.
- At least one pair assessment may exist; an empty Store or uncovered family must remain a valid
  read-only `cannot-determine` result.
- Canonical Task economics, current delivery and event records are authoritative inputs.

## Inputs

- one to ten explicit task-family names, with deterministic order and no inferred family;
- optional exact comparison-id filter for reproducible Goal evidence;
- current Main usage samples and pair assessments;
- the paired delegated Tasks' canonical economics, Attempts, events, verification, Main review and
  Integration records.

## Outputs and behavior

- One immutable read-only value report with:
  - requested family coverage and overall `proven` / `cannot-determine` result;
  - every accepted or rejected comparison in scope, never a hidden selected winner;
  - direct Main Token, delegated Main Token, signed absolute/percentage change, same measurement
    profile/method and pair quality evidence;
  - Worker gross Token with complete/incomplete counts;
  - Runtime cost estimate completeness;
  - official cost per native currency plus ranges/unavailable reasons, never FX conversion;
  - elapsed Attempt time and Main/direct episode elapsed time when evidence exists;
  - Worker validation-repair, Main correction, Main reverification and handoff counts;
  - typed missing-data reasons and confidence.
- A family is `proven-lower` only when it has at least one accepted valid pair whose delegated Main
  Token is strictly lower. Equal, higher, rejected, incomplete or absent evidence remains visible.
- Overall result is `proven` only when every requested family is `proven-lower`; the report does not
  mark a project Milestone or create calibration work.
- Suggested CLI/API shape:
  `forklight value-report --families <json-array> [--comparisons <json-array>] --json` and MCP
  `main_token_value_report`. Daemon, CLI and MCP return the same canonical object.
- The Goal's `main-token-pairs.json` is produced by redirecting/reviewing this canonical JSON after
  M4-D evidence exists. Product code never writes into a project Goal directory.

## Allowed paths

One Grok 4.6 Xhigh native Goal Writer may modify only:

- `src/core/main-token-value-report.ts` (new)
- `src/daemon/coordinator.ts`
- `src/daemon/protocol.ts`
- `src/daemon/server.ts`
- `src/cli.ts`
- `src/mcp/server.ts`
- `tests/main-token-value-report.test.ts` (new)
- `tests/daemon.test.ts`
- `tests/daemon-cli.test.ts`
- `tests/mcp.test.ts`

The Writer may import canonical Task economics/statistics helpers but may not change their files
without a prior Spec update.

## Acceptance

1. Empty, uncovered, invalid and legacy-only families return deterministic `cannot-determine` with
   typed reasons; no zeros are treated as samples.
2. Only M4-B accepted current pairs contribute a Main Token result. Rejected, stale or incomplete
   pairs remain listed but cannot graduate a family.
3. Every comparison exposes direct and delegated Main exact totals, signed change and quality gate.
   Strictly positive `direct - delegated` is required for `proven-lower`.
4. Worker Token, cost, time and correction/handoff evidence are separate fields with explicit
   denominators/unavailable reasons. Worker Token is never added to or subtracted from Main Token.
5. Native currencies remain separate; runtime estimates and Provider quotes remain distinct; no
   Provider bill claim or FX conversion is invented.
6. Multiple valid pairs are all visible. The report does not average percentages, rank models,
   hide negative pairs or automatically choose a better-looking comparison.
7. CLI JSON, human output, MCP and Daemon agree; the response is privacy-safe and read-only.
8. ForkLight independent verification passes. Two different-view Judges inspect claim gating,
   aggregation, missing evidence, economics separation and compatibility; Main integrates only the
   exact accepted Revision.

## Verification commands

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/main-token-usage.test.ts tests/main-token-pair.test.ts tests/main-token-value-report.test.ts tests/task-economics-report.test.ts tests/daemon.test.ts tests/daemon-cli.test.ts tests/mcp.test.ts
git diff --check
```

Run `npm run check` after the accepted high-risk Integration and again at the M4 boundary.

## Forbidden and non-goals

- No Hub/UI before M5, report file auto-write, background polling or automatic calibration.
- No global model leaderboard, model/Runtime switch, Competition, benchmark rerun, retry,
  correction, Judge assignment or Integration authority.
- No averaging percentages, converting currencies, treating caps as spend, treating unavailable as
  zero, or relabeling exchange/boundary reduction as complete Main Token.
- No checksum, content-addressed pair, lock, lease, version handshake or multi-user/distributed
  coordination.
- Stop if a value claim requires weakening M4-B validity or inventing missing Worker/cost/time
  evidence.

## Handoff and workspace disposition

Worker hands off exact response schema, claim rules, event counters, privacy limits and focused test
results. ForkLight independently verifies, two Judges review, and Main inspects the exact diff before
serial safe Integration. Protect the Workspace through activated CLI/MCP empty/invalid/valid smoke;
then reclaim regenerable content while retaining the accepted Candidate and verification chain.

## Authorized exact-Candidate test-only recovery

The first implementation Task `89e60adc-d9ca-4560-9940-b423698c51f0` stopped after its only
validation repair, runtime-workspace reverification and Main correction authority were consumed.
Its latest reusable Revision `61dc45c0-e4b2-49c3-95db-f54a3a4d7861` passes build and diff
validation; 342/343 focused tests pass. The sole remaining failure is a source-text regex in
`tests/main-token-value-report.test.ts` whose extracted substring ends before the real JSON-switch
check. The real empty/seeded CLI JSON and human behavior test passes.

一骏's standing explicit authority to continue subsequent Goal tasks admits the self-contained
recovery at `work-items/exact-candidate-test-only-recovery/spec.md`. It materializes that exact
ten-path Candidate from a Workspace-local seed into one fresh Grok 4.6 Xhigh native Goal, changes
only the named brittle test, runs the unchanged acceptance suite, then returns to the original
dual-Judge and Main serial Integration chain. It is not a retry or continuation of the paused Goal.

## Authorized acceptance-contract-only replacement

The exact-Candidate recovery produced final Revision `debbf06b-a10f-4206-8382-60c1ea450ed4` and
passed build, all 343 focused tests and diff validation. It stopped only because its acceptance
suite reran the clean-source bootstrap after the seed was already applied; ForkLight attributes
that failure to `acceptance-contract / non-model`.

On 2026-08-17 一骏 explicitly revoked that recovery's no-replacement boundary and authorized one
acceptance-contract-only replacement. The self-contained accepted Work Item is
`work-items/acceptance-contract-only-replacement/spec.md`. It materializes the exact final
Candidate, gives Grok a read-only native Goal, uses post-application proof instead of a second
forward apply, and preserves the original dual-Judge and Main serial Integration requirements.

## Authorized final non-Git post-state-proof replacement

The acceptance-contract-only replacement reproduced the byte-identical ten-path Candidate and
again passed build, all 343 focused tests and diff validation. It stopped only because its
Main-owned post-state script invoked ordinary `git diff` inside ForkLight's plain Candidate
Workspace. Event `2318` attributes this to `acceptance-contract / non-model`; the product Candidate
remains valid and protected.

On 2026-08-18 一骏 explicitly revoked that replacement's one-shot boundary and authorized one final
non-Git post-state-proof replacement. The self-contained accepted Work Item is
`work-items/non-git-post-state-proof-replacement/spec.md`. It reuses the exact two Workspace-local
patches, gives Grok a read-only native Goal, and proves applied state only through the exact marker
and two reverse `git apply --check` operations. It has one Attempt and zero retry, reverify,
correction, fallback or further replacement. The original dual-Judge and Main serial Integration
requirements remain unchanged.

## Authorized Integration-contract-only recovery

The final replacement produced the exact accepted Candidate, passed ForkLight verification, two
fresh Judges and Main accept, then rolled back safely because Integration's fresh verification
project did not contain the Task-local marker consumed by the post-state script. The product diff,
build and all 343 focused tests remained valid.

On 2026-08-18 一骏 explicitly authorized one Integration-only recovery. Main reuses the same
accepted Revision and changes no product/test Candidate path. The Main-owned post-state proof now
derives seed digests and the exact ten-path set directly from the two accepted patches while
ForkLight preflight binds the accepted Revision/digest/affected paths. After realistic proof in a
plain Integration-like project, ForkLight may run one fresh preflight and one safe Integration.
No Grok, new Candidate, reverify, correction, Judge, Main re-review, fallback or later Integration
is authorized.

## Delivery outcome

The sole Integration-contract recovery passed all four safe Integration stages. The full check
passes 3,061/3,061, activated client/Daemon identity is matched, and live CLI smoke returns an
honest read-only uncovered-family result. Exact evidence is
`goals/forklight-main-led-execution/evidence/m4-c-family-value-report-delivery.md`. M4-C is
graduated; M4-D is dependency-ready.
