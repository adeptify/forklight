# ForkLight Project Status

Last updated: 2026-07-28

## Product boundary

ForkLight is the local execution, safety, and observability layer for bounded
external coding Workers. A **Main** agent (Codex, Claude Code, Grok Build,
OpenCode, or a human on CLI) remains accountable for intent, Task Contract
quality, independent review, user authorization, and the decision to integrate.

A Worker never receives arbitrary Shell, web, original-project write, Git
commit, or push authority.

**Control UI:** `forklight hub` is the only browser control center (configure +
operate). Standalone Console and Setup UIs were removed.

## Current milestone: M0 — trustworthy self-upgrade

ForkLight is now an **engineering Alpha** rather than a concept prototype. The
core `one Main → bounded Workers → independent verification → Main review →
safe Integration` loop is real and has been dogfooded with DeepSeek Pro and
MiniMax-M3. The immediate priority is to make that loop reliably upgrade
ForkLight itself before widening the feature surface.

**M0 residual (honest, 2026-07-27):** activation handoff, PID/endpoint
ownership, one-use authorization, and Unix-socket drain/replacement are covered
by shipped unit and daemon fixtures (`tests/activation.test.ts`,
`tests/daemon.test.ts`, `tests/build-identity.test.ts`). The product exit gate
of **three consecutive live self-activation upgrades** remains **0/3** until
three accepted deliveries exercise the full detached activation path on the
real `forklight-self-upgrade` Delivery Profile. Manual rebuild/restart is useful
runtime evidence and is **not** counted toward that gate.

### Quality-first policy (2026-07-26)

- Task completion and demonstrated behavior take precedence over mechanical
  file/line limits. `changeBudgetMode=warn` is the current operating default;
  file and line counts are review/risk evidence, not an automatic reason to
  discard a correct result.
- Hard gates remain hard for secrets, authorization, source-write isolation,
  explicit confirmation, independent test failures, affected-source
  compatibility, and commit/push authority.
- Time, cost, Token volume, patch size, and retry count are configurable
  preferences or supervision thresholds. When acceptance proves that the
  original scope is contradictory, classify it as contract-infeasible and ask
  Main to revise the boundary instead of retrying forever under the same terms.
- A model's failed Attempts remain evidence for that Task class; they do not
  permanently ban the model. Routing decisions must use longitudinal results,
  failure category, correction cost, and accepted-delivery rate.
- A failed Attempt does not make its candidate workspace worthless. Main should
  choose the cheapest valid recovery layer: reverify the retained candidate
  without a Worker when only behavior acceptance was transient; use one bounded
  same-candidate Worker correction when code must change; start a new Task only
  when the candidate or contract cannot be reused. Authority and allowance must
  be explicit, history stays immutable, the full original acceptance suite
  still reruns, and none of these paths may become an automatic retry loop.

### Milestone roadmap

| Milestone | Product outcome | Exit evidence |
| --- | --- | --- |
| **M0 Trustworthy self-upgrade** | Old and new daemons hand off without false Integration failure, PID/socket theft, or orphan processes | Three consecutive real self-upgrades pass source apply, verification, build, activation, identity, and leak checks |
| **M1 Out-of-box local use** | A new user configures Provider, model, Worker, and Main through one guided Hub flow and completes a sample Task | Clean Mac reaches reviewed Integration in about 15 minutes without internal ForkLight knowledge |
| **M2 Long-running execution loop** | Plans with dependencies survive interruption/restart, expose real progress/stall states, and return infeasible contracts to Main | One 4–8 Task feature runs to reviewed milestones without duplicate mutation or continuous babysitting |
| **M3 Evidence-based multi-model routing** | Competition is selective; routing learns by Task class instead of treating one failure as a permanent model verdict | 30–50 real Tasks provide explainable success, correction, failure-category, cost, and delivery evidence |
| **M4 Truthful observability and economics** | Hub reports Worker volume, Main boundary load, official cost, and calibrated Main-Token savings without mixing evidence types | Savings appear only for versioned exact-pair baselines; unavailable evidence stays explicitly unavailable |
| **M5 External productization** | Installation, upgrades, migrations, recovery, license, docs, and security are ready for limited external use | 3–5 external users independently install, run, review, integrate, and report actionable feedback |

M0–M5 are ordered product gates, not rigid calendar deadlines. Time remains a
recorded signal unless the user explicitly enables it as a selection weight.

### M1 requirement: per-Worker advanced policy and bounded adaptation

Every configurable execution/quality preference must be expressible in one
Worker Profile and editable in Hub Advanced settings. The initial inventory
includes model/runtime/effort, Token and monetary budget, maximum duration,
no-progress timeout, file and changed-line guidance, base and explicitly
authorized extra Attempts, concurrency, completion/no-change policy, and
time/cost preferences. The UI must show provenance and an **effective policy
preview** before a Task is submitted.

Resolution is `explicit Task override > Worker Profile > global default` for
flexible policy. The resolved values are snapshotted into the Task so a later UI
edit cannot silently change running work. Security/authority invariants are not
profile overrides: secret handling, source-write isolation, Main Review,
Integration confirmation, and commit/push authority remain hard.

Self-adaptation is a bounded state machine, not an unlimited retry loop:

1. classify one concrete failure or risk signal;
2. propose and record one policy delta with before/after values and reason;
3. apply it only to the next authorized Attempt or replacement Task;
4. never rerun an identical effective policy after the same failure category;
5. stop after a configurable adaptation-round limit and return control to Main.

Independent acceptance remains the success authority. Changing a parameter is
never counted as progress or success by itself.

### Shipped

- **Contract-infeasible terminal stop (2026-07-27):** when independent acceptance
  (or Main-declared privacy-safe reason codes) proves the Task Contract cannot
  be satisfied under the current boundary, verification stamps
  `failureCategory: contract-infeasible`. Same-policy extra Attempts and
  policy adaptation are blocked; Hub next action is `revise-contract` so Main
  revises scope, dependencies, or acceptance instead of silent retry. Codes are
  never parsed from free-text command output. This is distinct from integration
  preflight feasibility (maxFiles/maxDiffLines integratability).
- **Main-authored user explanation and fixture-driven Task journeys
  (2026-07-27):** new structured Tasks may carry one optional, bounded
  `presentation.summary` plus its source language. Main writes this sentence for
  the user; ForkLight preserves it exactly and never guesses, rewrites, or
  translates it. Task Detail shows it before the technical outcome, then keeps
  the complete Main input, Worker process/output, independent checks, final
  handling, cause, next action, and raw evidence in their truthful layers. Older
  Tasks keep an explicit technical-outcome/legacy fallback. Backend and UI now
  share one canonical safe-response fixture, with executable journeys for
  success, verification failure, authentication failure, active execution, and
  legacy data in both locales.
- **Three-layer version truth and ordered Hub narrative (2026-07-27):** the
  Overview now answers “is the running product using my latest change?” by
  comparing three distinct facts: current source, the product artifact built
  from source, and the running daemon. It explains what changed and the exact
  safe next action before exposing digests, build ids, protocol details, or
  diagnostics. Every top-level page uses the same leading purpose plus ordered
  `input → ForkLight process → output → next action` story. Task Detail follows
  the real journey from Main input through Worker process/output, independent
  checks, final handling, cause, and next action. A Worker completion report is
  explicitly described as a report rather than proof; terminal Task truth wins
  over a stale Attempt state; and a Main-repaired delivery does not reuse a
  rejected Worker's file list as its final output when that repaired file list
  was not separately recorded.
- **Excluded-output delivery truth and refresh-safe Hub forms (2026-07-27):**
  workspace exclusions now share one path-segment rule with Patch
  classification, so acceptance-generated `dist/**` remains available in raw
  and generated audit evidence but is omitted from the source Integration
  payload and its file/line Quality checks. Hub authentication now survives a
  normal refresh in the same browser tab through validated, tab-scoped session
  storage; the fragment is removed from the visible URL and all unauthorized
  paths clear the stored value. Model-routing “unsaved” state is now a semantic
  comparison with the saved policy, including normalized numeric inputs, so
  changing `flexible → strict → flexible` returns to clean without autosaving.
- **Explanation-first Hub and guided direct-Main comparison (2026-07-27):**
  every top-level page now begins with five concrete answers: what the page is
  for, what goes in, what ForkLight does, what comes out, and what the user does
  next. Worker and Main cards describe behavior and readiness before internal
  identifiers. Task Detail exposes Main input, actual Worker, Attempts, changed
  files, failed checks, accepted output, cause, and a concrete next action in
  evidence order; failed checks are visible by default while exact commands,
  paths, ids, and pricing identities stay in technical disclosures. A Task with
  calibration identity can now capture one exact count-only direct Codex run,
  review it, and publish a low-confidence versioned baseline from the same Task
  detail. No automatic direct run, approval, publication, retry, or Provider call
  is introduced.
- **Atomic Competition identity and configurable missing-evidence routing
  (2026-07-27):** Competition now rebuilds Provider, model, endpoint, Keychain
  service, pricing route, and Keychain account as one identity instead of
  carrying a source Task's pricing metadata into another candidate. Model
  advice now offers two explicit policies when one enabled preference cannot be
  compared fairly: development-default flexible mode keeps using the remaining
  comparable evidence and names the gap, while strict mode waits. Neither mode
  converts missing evidence to zero, mixes currencies, bypasses minimum samples,
  or overrides Main. The Hub exposes the same choice in plain Chinese and
  English inside Advanced settings.
- **Per-Worker advanced execution policy (2026-07-26):** every Worker Profile
  can now own and preview 14 execution fields: maximum duration, observed Token
  ceiling, no-progress timeout, stop grace, file/changed-line limits and modes,
  base/extra Attempts, concurrency, completion/change-budget modes, and maximum
  adaptation rounds. Resolution is `Task > Worker > global`, including explicit
  `null = unlimited`, and the immutable result/provenance is snapshotted into
  each Task. Runtime enforcement now consumes that snapshot instead of rereading
  mutable settings.
- **Per-Worker official pricing identity (2026-07-26):** a Worker can now own an
  optional `pricingRoute`, editable from Hub Advanced settings. Explicit Task or
  MCP input wins; otherwise the Worker value is copied into the immutable Task
  Provider snapshot. Provider/endpoint overrides cannot inherit a stale route,
  the route never enters the Worker environment, and Hub preserves an existing
  backend-configured route even when it is newer than the current UI option list.
- **Truthful multi-tier range evidence (2026-07-26):** when MiniMax has an exact
  route and complete terminal aggregate usage but the runtime cannot provide
  truthful per-request tier rows, exact cost remains
  `calculation:per-request-usage-required`. ForkLight may additionally expose a
  conservative official native-currency lower/upper bound using only possible
  published tiers. Exact totals, ranges, unavailable counts, and currencies stay
  separate; unpublished positive components fail closed and no range is called a
  Provider bill.
- **Loose but bounded development preset (2026-07-26):** the live default Worker
  is explicitly uncapped for money, wall duration, observed Tokens, files, and
  changed lines; size/change budgets are warnings. No-progress remains finite at
  30 minutes, stop grace is 10 seconds, concurrency is 4, base Attempts are 1,
  extra Attempts are 0, and automatic adaptation rounds are 0. `completionMode`
  remains hard because an editable Task still has to deliver a change; this is a
  delivery invariant, not a patch-size gate.
- **Bounded adaptation transition core (2026-07-26):** confirmed adaptation can
  create at most one durable successor for one terminal parent, with a root-owned
  immutable round cap, no-op/forbidden-field rejection, transactional lineage,
  restart recovery, and normal scheduler admission. It is deliberately a pure
  one-step transition, not an internal detect/tune/retry loop.
- **Bounded adaptation control surfaces (2026-07-26):** CLI, MCP, and Hub now
  expose read-only preview followed by explicit confirmed apply. Hub derives its
  13 editable successor fields from the same Worker Advanced inventory, while
  the root-owned `maxAdaptationRounds` remains immutable. A form edit invalidates
  an earlier preview; stopped decisions never enable apply; no control surface
  calls a model, changes parameters automatically, or starts a retry loop.
- **Dual machine/final delivery disposition (2026-07-26):** a failed or
  interrupted Worker Task keeps its original machine status forever. After Main
  repairs the current source, one explicitly confirmed remediation command can
  rerun the Task's stored acceptance commands in an isolated verification copy
  and atomically record `verified-repaired-delivered`. Private command output
  and the bounded Main reason remain in the audit store; CLI, MCP, daemon, Board,
  Task detail, and statistics expose only the compact disposition evidence.
  Provider/model statistics now show machine success and accepted-delivery rates
  side by side, including Main-repaired and remediation-check counts.
- **Per-Worker Contract Quality policy (2026-07-27):** contract authoring
  thresholds now resolve as `Worker > global`, preserve explicit `null`
  maximums and zero minimums, and freeze into every new Task. `hard`, `warn`,
  `score`, and `off` change admission effect without falsifying check results.
  Schema, credentials, source isolation, command authority, acceptance,
  Main Review, Integration, commit, and push remain hard outside Quality.
- **Volcengine Coding Plan Worker (2026-07-27):** `volcengine` is distinct from
  Alibaba `glm`. The built-in non-default `volcengine-glm52-1m` Claude Code
  Worker preserves exact model `glm-5.2[1M]`, the ARK Coding endpoint, and the
  dedicated Keychain service. Hub/MCP/status/probe support it. Worker Tokens
  remain measurable; subscription cost is explicitly unavailable per request,
  never fabricated as zero or PAYG.
- **Hub** (`forklight hub`): one command starts daemon + loopback UI.
  - Configure: Models catalog → Workers (per-worker limits) → Main Plugin/MCP/Skill
  - Operate: Overview readiness, Board, Plans, Compete, Insights
  - Daemon lifecycle (start/stop/restart sticky; ops poll does not auto-start)
  - Task supervise: resume / revise / main_review / integration preflight+apply
  - Task adaptation: opt in to concrete policy fields → preview before/after →
    explicitly confirm one successor, subject to the immutable root round cap
  - Board task entry: submit one already-authored absolute YAML/JSON Task
    Contract through the existing daemon path, with an explicit billable-run
    confirmation. Hub remains a transport/control surface, not a second Main.
  - Provider probe with explicit billable confirm
- **Main neutrality:** MCP/CLI work for Codex, Claude Code, Grok Build, etc.
- **Checkpoint policy (2026-07-26):** Independent acceptance verification is
  **authoritative** for terminal `succeeded` / `failed`. Worker bounded
  checkpoint is a **non-authoritative** self-check. Missing or failed checkpoint
  no longer forces `failed` when independent verification passed (audit event
  `checkpoint.skipped` with reason `missing-or-failed-non-authoritative` or
  `runtime-unsupported`).
- **Verifier Git isolation (2026-07-26):** direct acceptance Git commands see
  the synthetic Task baseline/workspace, while ordinary subprocesses and nested
  temporary repositories do not inherit `GIT_DIR`, `GIT_WORK_TREE`, or
  `GIT_INDEX_FILE`. The Worker still receives no source `.git` directory.
- **Delivery Profiles (2026-07-26):** build, runtime activation, and activation
  checks are explicit reusable settings rather than path guesses. A Task
  snapshots one resolved profile at creation with `inline > explicit Task id >
  project binding > default > none` precedence. An invalid explicit id or an
  inline/profile conflict fails closed. CLI, daemon, MCP, and competition entry
  points all consume the same resolution boundary.
- **Delivery plan and Hub configuration truth (2026-07-27):** the Hub can edit
  the complete Delivery Profile registry without running any command. Task
  Detail and Integration Preflight now show the immutable four-stage plan
  (`source applied → source verified → artifact built → runtime activated`)
  separately from actual stage evidence. Missing configuration is never shown
  as passed; legacy Tasks without a saved plan show all four stages as unknown.
  Exact commands, paths, receipt ids, and raw Main review notes remain in
  secondary disclosures instead of the primary narrative.
- **Race-safe daemon lifecycle (2026-07-26):** start rejects a listening endpoint
  and only removes the same stale Unix-socket inode it probed; close preserves a
  replacement endpoint before Node removes the old path. Stop and restart wait
  for the exact old PID and endpoint to disappear, never convert request timeout
  or uncertain PID liveness into success, and no longer swallow failed restarts.
- **Truthful Main-token calibration (2026-07-26):** a stored Task can carry an
  exact `taskClass × directCodexProfileId`; Main may capture one canonical,
  count-only `turn.completed` event through CLI, MCP, or the Hub task detail.
  Identity is derived from the stored Task, unknown Tasks remain unattributed,
  and every sample stays pending until explicit Main review. A versioned
  publication is required before `forklight tokens` can report direct-Codex
  savings. Raw prompts, responses, diffs, and JSONL are not stored.
- **First guided-capture paired baseline (2026-07-26):** the same clean
  five-file client task was completed by ForkLight/DeepSeek Pro and directly by
  `codex-cli 0.145 + gpt-5.6-sol + xhigh`. The accepted direct run measured
  **3,807,830 tokens**. ForkLight measured **18,623–113,745** Main-exchange
  tokens and now truthfully reports **3,694,085–3,789,207 saved Main tokens
  (97.01%–99.51%)**. This is version 1 with sample size 1, therefore confidence
  remains explicitly **low**. This complements the earlier FL-D101 exact-pair
  sample on a different task class/profile; it does not replace or merge that
  historical evidence.

### Validation

```bash
npm run check
npx tsc -p tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters
git diff --check
```

Latest complete run (2026-07-27): **1209/1209 tests passed**, plus strict
TypeScript, production build, `app.js` syntax, and `git diff --check`. The focused Task
contract/MCP/Hub projection suite passed **144/144** and the focused Hub asset
suite passed **49/49**. The live latest-build Hub was exercised in a real
browser on Overview, Board, and Task Detail in both languages. It explains
source → built product → running daemon, then Main input → Worker
process/output → independent checks → final handling → cause → next action.
At 720 px and 390 px the document has no horizontal overflow. The served bundle
and daemon identify the same latest source build; technical ids and raw evidence
stay closed by default.

Dogfood (2026-07-26): fixture `examples/deepseek-checkout.yaml` against
`fixtures/checkout` reached **`succeeded`** after the checkpoint fix when
acceptance tests passed (MCP tools/list + health as Grok Main would call;
submit/wait via CLI on the same daemon).

Latest self-dogfood (2026-07-26): DeepSeek `deepseek-v4-pro[1M]` implemented the
Main remediation core, durable storage, daemon, CLI, and MCP path; MiniMax-M3
implemented the dependent Hub dual-outcome and statistics surfaces. Each Task
was frozen at **1 base / 0 extra / 0 adaptation**, with money, time, Token, file,
and line ceilings uncapped and size gates in warning mode. Both machine
verifications failed once. Main did not retry, tune parameters, or rewrite their
failure evidence: it reviewed each isolated patch, corrected only proven type,
atomicity, privacy, transport, i18n, DOM rendering, and test-quality gaps, then
ran the original DeepSeek Task's three stored acceptance commands against the
repaired source. All three passed and produced a separate
`verified-repaired-delivered` disposition while the Task remained `failed`.

Latest provider/Quality dogfood (2026-07-27): DeepSeek
`deepseek-v4-pro[1M]` implemented the Quality core in one Attempt. Worker
verification exposed four TypeScript defects, so Main corrected the semantics,
unified the assessment path, and recorded a separate 3/3
`verified-repaired-delivered` disposition without rewriting the machine result.
MiniMax-M3 then implemented the first Volcengine surface in one corrected-region
Attempt. It returned a terminal result before runtime cleanup marked it
interrupted; verification exposed two incorrect test assumptions, one type
error, and whitespace. Main reworked the patch instead of retrying, then ran its
three stored acceptance commands; all three passed under remediation check
`fb0ee388-3511-4425-b26b-0ddc9bed2c51` and produced a separate
`verified-repaired-delivered` disposition while the Task stayed `failed`. One
explicit live probe then verified `volcengine / glm-5.2[1M]` against the exact
endpoint; the local persisted Model/Worker arrays were upserted without changing
the default Worker.

Current local Worker roster (2026-07-27) also includes `minimax-m3-cn`
(`claude-code` + China-region `MiniMax-M3`) and `local-grok-builder`
(`grok-build` + `grok-4.5`). Both use the permissive development profile: no
task budget, duration, Token, file, or line ceiling; Quality and completion
admission warn; one base Attempt with no automatic retry/adaptation. The Grok
Worker may seed the existing signed-in `~/.grok/auth.json` into its isolated
runtime home, so its local readiness does not depend on an xAI Keychain entry.
The existing `default` Worker remains unchanged.

Latest explanation-first/directed-savings dogfood (2026-07-27): ForkLight ran
one DeepSeek backend Task, one MiniMax/Volcengine competition, and one local Grok
top-level UI Task. All four machine Tasks remained failed for their real stored
acceptance results; Main did not add Attempts or tune limits to chase green.
DeepSeek's API/fixture assumptions were corrected in the final source, the
MiniMax candidate was rejected, the materially better GLM candidate was repaired
and integrated, and Grok's page-story candidate was retained after correcting
its own brittle assertion. The original GLM and Grok acceptance commands then
passed 4/4 and were recorded as separate `verified-repaired-delivered`
dispositions without changing either Task's machine status. The final source
adds the exact guided capture/review/
publish boundary, five-slot stories for all eight top-level pages, readable
Worker/Main cards, and visible failed-check summaries with concrete next steps.
This round did not create a new equivalent direct Codex baseline, so it makes no
new savings claim for these Tasks.

Latest Hub comprehension dogfood (2026-07-27): the visible UI now treats every
page as an explanation, not an internal-data inventory. Page guides tell the
user what the page is for and what to look at. Task cards translate machine
states into plain language, while Task Detail presents the collaboration in one
chronological path: **Main input → Worker execution → independent verification
→ final delivery → cause → next action**. Assignment goal, scope, boundaries,
steps, deliverables, focus files, acceptance criteria and safe command labels are
visible; actual Attempts, Worker claim, changed files and check results are kept
distinct so an unverified Worker claim cannot look like a completed delivery.
Internal ids, runtime/provider metadata, raw errors, decision evidence and cost
formula details remain available inside a closed technical disclosure.

Latest routing and explanation pass (2026-07-27): the read-only model-routing
advisory now uses task-class evidence instead of lifetime failure rate. It
separates model-quality failures from credentials, Provider region/endpoint,
runtime, interruption, policy-only, and missing-progress failures; Main-repaired
accepted delivery contributes correction churn without rewriting the original
machine result. Missing positive-weight evidence now follows a configurable
policy: `flexible` (development default) omits that factor, names the evidence
gap, and may still recommend from the remaining comparable factors; `strict`
withholds the recommendation. Both modes still withhold when samples are sparse,
no factor remains active, or the score gap is below the uncertainty threshold.
Missing official costs and cross-currency costs never become zero or get mixed.
Cost and duration remain opt-in preferences with default weight zero. Candidate
bounds, sample threshold, uncertainty threshold, missing-evidence policy, and
factor weights are validated settings exposed through CLI/MCP and Hub. The Hub
presents work type and candidates first, recommendation or honest
no-recommendation second, omitted evidence and next action third, and scoring
details inside a closed technical disclosure.

The same pass completed the remaining explanation-first Hub paths. Plans,
Competitions, Task decisions, Integration history, flexible Quality modes, and
Task economics now present purpose, current state, evidence, final output, and
next action before IDs, codes, diagnostics, or formulas. Diagnostics are capped
and closed by default. Task Detail explicitly separates Main input, the Worker's
unverified claim and changed files, independent verification, and the accepted
or rejected final output. A 15-second shared Hub evidence cache now covers both
setup inspection and the normal `/api/ops/health` refresh, preventing each tab
from repeatedly running runtime doctor subprocesses; Task, Board, Plan,
Competition, statistics, settings, economics, and Task Detail reads remain
uncached and current. That checkpoint passed **1132/1132 tests**, strict
TypeScript, production build, syntax checks, and
`git diff --check`; no commit or push has been performed.

Latest live-process and preparation checkpoint (2026-07-27): workspace setup
now emits durable stages for project scan, safety snapshot, Worker copy,
dependency connection, and task-context writing, each with elapsed time and an
explicit file/dependency count when known. Task cards and Task Detail translate
the current stage into bilingual plain language; they do not invent a percent
complete or ETA. Dogfood found three old Hub server processes polling the same
Daemon. Once all three were paused, a preparing GLM Task entered Worker execution
within two seconds. `/api/ops/health` now has its own 15-second, concurrent-safe
snapshot with visible `checkedAt` and mutation invalidation. The combined
checkout passes **1158/1158 tests**, strict TypeScript, production build,
`app.js` syntax checks, and `git diff --check`. No commit or push has been
performed.

Task Detail now applies the same explanation-first rule to density, not only
section order. The current user-facing state distinguishes a failed Worker run
from a Main-repaired, independently verified final delivery. The goal remains
visible, while the full contract, original Worker report, changed-file list,
and verification commands are available in closed disclosures. A remediated
delivery no longer tells the user to retry or inspect technical details; its
next action is explicitly complete. The project-wide UI acceptance rule is now:
every primary surface should explain what is happening, the relevant input,
the process and status, the output, why the state occurred, and the next action;
internal names, IDs, commands, formulas, and raw evidence remain secondary.

This pass used all four requested Workers through ForkLight: Volcengine
`glm-5.2[1M]` completed the bilingual wording pass; MiniMax-M3 contributed the
first readable Insights hierarchy; DeepSeek `deepseek-v4-pro[1M]` built the
safe Task journey projection; Grok `grok-4.5` supplied the responsive visual
hierarchy. MiniMax, DeepSeek and Grok retain machine `failed` results because of
their frozen verification snapshots or incorrect test contracts, not because
the Providers were unreachable. Main reviewed their isolated diffs, rejected
fabricated or duplicated claims, integrated only evidence-backed parts and
corrected the current source without automatic retries. That four-Worker
checkpoint passed **1079/1079 tests**, strict TypeScript, production build and
`git diff --check`; no commit or push has been performed.

Dogfood also exposed two next observability items. Workspace preparation stages
are now visible, but clean performance profiling should be repeated after old
Hub processes are removed; Grok emitted **982 token-fragment events for 11
turns**, so streaming fragments still need coalescing before they reach the
default timeline. Per-Task examples now use `maxConcurrency: 4`,
but Task snapshots remain immutable, so already-created Tasks correctly retain
their original concurrency policy.

That earlier checkpoint passed **1158/1158 tests**, strict TypeScript,
production build, `app.js` syntax checks, and `git diff --check`. Real browser
QA on the final served bundle confirms Chinese and English both render the same
Task story: a failed Worker run remains visible, Main's repaired and verified
delivery is separately named, the next action is “none,” dense assignment and
evidence are closed by default, and manual operations are available only on
demand. The browser emitted no error or warning logs. At that checkpoint, the
daemon and served bundle used build id
`b0f01b0be700d75958adcf6e393cca4c070c4aa9ddbd0c3e48191fca8b56690c`;
exactly one Hub was listening at `127.0.0.1:53542` and exactly one production
Daemon was active. Older duplicate Hub listeners were terminated by exact PID;
Task data was not removed. No commit or push has been performed.

The new read-only `economics_summary` path and Insights view keep five evidence
families separate: configured runtime caps, Claude runtime-cost telemetry,
Provider PAYG estimates by native currency, Worker execution Token volume, and
calibrated direct-Codex savings. Missing evidence stays unavailable rather than
zero; currencies are never combined; Worker Token reduction is not relabelled
as direct-Codex savings. Filters cover provider, model, and terminal time range.

The M0 activation-handoff implementation is now integrated: an activation stop
requires a protocol-compatible, operation-bound, durable one-use authorization
from the old daemon; its acknowledgement identifies the exact target PID. The
handoff waits while that same PID still owns the endpoint, accepts endpoint
relinquishment while the old PID drains `integration_wait`, and rejects a
different replacement PID. Ordinary stop/restart still waits for exact PID
death. Focused lifecycle coverage is **79/79** and includes a real Unix-socket
drain/replacement fixture. The final M0 exit gate remains **0/3 consecutive live
self-activation upgrades** until the next three accepted deliveries exercise
the full detached activation path. Nine previously leaked, path-verified
`forklight-source-daemon-*` test processes were terminated; the process table
now shows only the production dist daemon for this project.

The first recovery-hardening dogfood pass is complete. DeepSeek
`deepseek-v4-pro[1M]` Task `cff0f51d-12a0-411a-b76e-e2ee6b1ec9cf`
delivered a machine-successful candidate (4 files / 447 lines, 129/129 focused
tests), but Main recorded `revise` because it accepted non-directory snapshot
paths and swallowed unexpected cleanup errors. MiniMax-M3 Task
`79a1a3c1-0158-4965-9539-177bcc7fd8fa` then produced a stricter candidate (5
files / 663 lines), but independent verification correctly failed on one broken
fixture and five TypeScript errors. Main did not launch a third implementation
Attempt: it reused the sound design and code boundaries, removed false
`worker.failed` attribution and non-executing tests, and recorded remediation
check `b46291a5-5e30-497d-ba05-5e6a9482a16a` as
`verified-repaired-delivered` while preserving MiniMax's machine failure.

The accepted source now requires real baseline/workspace directories and a
validated final manifest before Attempt 1, clears only Task-owned preparation
artifacts, propagates unexpected filesystem failures, and recovers a stale
`preparing` Task without creating an Attempt or pretending a Worker was
interrupted. Focused recovery/runtime coverage is **138/138** (119 recovery +
19 runtime); the complete suite is **1215/1215**, strict TypeScript,
production build, and `git diff --check` all pass. A real manual build/restart
moved the daemon from PID `17190` to `84686`; client and daemon now match build
id `a2fe3cb6e7046ee674db5f962243554868549e81395b62b24b3573edf45c96f0`.
This manual Main-remediation handoff is useful runtime evidence but is **not**
counted as one of the three automatic Integration handoffs, so the M0 exit gate
truthfully remains **0/3**.

The post-build process audit also found 30 old, path-verified test daemons owned
by `/var/folders/.../forklight-source-daemon-*` sockets and ForkLight run
workspaces. They were terminated by exact PID after verifying their command
lines; the production daemon and Task data were preserved. The final process
table contains no such test socket listener. No commit or push has been
performed.

The candidate-reuse checkpoint is now implemented and live-verified. Failed or
interrupted Tasks can receive one explicit Main correction that reuses the same
Task, workspace, session and retained Diff. It is a separate authorization from
ordinary continuation: `baseMaxAttempts`, `maxExtraAttempts` and the new
`maxMainCorrections` cannot consume one another. `maxMainCorrections` defaults
to 1, may be configured per Worker in Advanced settings or overridden and
frozen per Task, and 0 disables the path. A correction stores bounded Main
feedback and the prior/target Attempt identity, reruns the complete original
acceptance suite, survives a daemon restart, rejects conflicting replay, and
never starts automatically or loops. The operation is available through CLI,
MCP, daemon and Hub Task Detail; the UI explains the retained candidate,
correction input, allowance and incremental cost without calling it a full
restart saving.

DeepSeek `deepseek-v4-pro[1M]` Task
`85f620af-d055-4275-b860-a8fb14d67497` supplied the initial end-to-end
candidate. Main rejected it as delivered after independent checks found eight
behavior/type failures, recorded `revise`, then selectively reused and repaired
the sound skeleton instead of integrating the failed patch. The final source
passes the 310-test core/daemon correction batch, the 138-test Hub/MCP/settings
batch, the complete test suite, strict TypeScript, production build and
`git diff --check`. A manual build/restart moved the production daemon to PID
`54182`; client and daemon match build id
`a98f014256965d5c6b70b85debe467fde1dd1aa986b76db475c9f393f21f140d`
and source digest
`89a2e72f4b97e2c22726ef221699944f6d6296dfdf701b0b02676c8363c6bc31`.
This manual source handoff is not an automatic Integration activation, so the
M0 live exit gate remains truthfully **0/3**.

MiniMax-M3 live Task `199a3913-6b9f-4dee-9d49-80dd02455e6b` then proved the
runtime path. Attempt 1 produced the correct one-file candidate but independent
acceptance failed once and the Task stopped: `baseMaxAttempts=1`,
`maxExtraAttempts=0`, no hidden retry. Main authorized one correction; Attempt
2 reused session `fb5b59b7-f699-417d-bd4f-b5eb378dc472` and the same workspace,
made no replacement candidate, and the unchanged acceptance command passed.
Attempt 1 used 29,275 gross Worker Tokens with a USD 0.075244 runtime estimate;
the correction added 37,711 gross Worker Tokens with a USD 0.083897 runtime
estimate. The two-Attempt total is 66,986 Tokens and USD 0.159141 runtime
estimate. MiniMax official exact request cost is unavailable for this route,
and no equivalent direct-restart baseline exists, so neither the runtime
estimate nor Worker-boundary reduction is presented as an official bill or a
measured Main Token saving. No commit or push has been performed.

Candidate reverify-only is now implemented and live-verified as the cheaper
first recovery layer. It is eligible only for a failed non-competition Task
whose latest completed Attempt retains a non-empty business Diff and whose
latest verification failed behavior while policy and source compatibility
passed. Main must provide a bounded reason and explicit confirmation. ForkLight
reruns every original acceptance command in the retained workspace, creates no
Worker or Attempt, never rewrites the original Attempt, and consumes a separate
frozen `maxMainReverifications` allowance. Zero disables the path; the default
is one. A failed reverify consumes that authorization and stops. A pass moves
only the Task to succeeded, immediately wakes plan dependents, and still
requires a fresh Main accept bound to the new verification before Integration.

Volcengine `glm-5.2[1M]` Task
`54e2dc29-b603-4e92-b657-66ebda5d8917` implemented the initial end-to-end
candidate. Its machine result remained failed: 335/338 focused tests passed,
strict TypeScript passed, and three defects remained. Main recorded `revise`,
reused the candidate, repaired the competition fixture and UI invariant,
corrected the Attempt wording, and added immediate plan dependency
reconciliation. The original acceptance contract then passed 3/3 and produced
`verified-repaired-delivered` check
`b50a4540-ea2f-4c53-aa80-5bd410d13564`; the Worker Task remains failed. The
complete source passes **1274/1274 tests**, strict TypeScript, production build,
Hub JavaScript syntax, and `git diff --check`.

MiniMax-M3 live Task `c34d98f5-fa7b-4821-8cfb-1ffc321b957d` proved the new
control flow with `baseMaxAttempts=1`, no extra Attempts, no corrections, no
adaptation, and one reverify allowance. Attempt 1 created the correct one-file,
one-line candidate and stopped after the controlled first acceptance failure.
It used **30,239 gross Worker Tokens** and a **USD 0.111575 runtime estimate**.
Main then authorized reverify-only: the original command passed in **80 ms**
(149 ms wall time), Task status became succeeded, Attempt count stayed one,
the original Attempt status stayed failed, and incremental Worker Tokens and
model/runtime cost were exactly zero. Preflight correctly rejected before a
fresh Main accept and passed after the accept. The fixture was not integrated.

The Worker Advanced Hub editor now exposes `maxMainReverifications` with
bilingual copy and effective-policy provenance. It is excluded from Task-time
adaptation so a running lineage cannot expand its own authority. Hub also
fails closed on malformed reverification events instead of fabricating
zero-Token or zero-cost evidence. Compact Task surfaces now also carry the
canonical end-to-end decision stage: after the live MiniMax Task received its
fresh Main accept, both Board and Task Detail say that it is waiting for user
authorization to integrate instead of incorrectly saying that Main review is
still pending. No commit or push has been performed, and
this manual source handoff is not an automatic Integration activation; M0
remains **0/3**.

The final manual build/restart moved the production daemon to PID `57557`.
Client and daemon match build id
`3f416dde500d518f414922b8cebf532f80170e86248b0512e467e629f641295b`
and source digest
`94b4313749ad7cdc6b65442a7c826524ee9bf48fa579b213ffe81de7edcd533a`;
no Worker is active or queued.

Token-counter reconciliation is now shipped across Task reports, CLI receipts,
Task Detail, portfolio economics, and Insights. The canonical arithmetic source
remains each terminal Attempt's top-level usage; `perModel` is diagnostic-only.
Missing, invalid, partial, matched, and mismatched evidence are distinct, all
counters must be safe integers, unavailable Tasks are never counted as zero,
and a mismatch cannot trigger a retry, block Integration, change a model score,
create a bill, or be presented as savings. Real GLM Task
`54e2dc29-b603-4e92-b657-66ebda5d8917` now visibly reports top-level gross
**41,261,873**, per-model gross **43,144,768**, and delta **+1,882,895** while
keeping **41,261,873** as the Task's Worker volume.

DeepSeek Task `b5a35d03-3d26-436c-962f-bb02826a29ab` dogfooded the same truth
path. Its candidate failed independent acceptance (112/114 focused checks and
one strict TypeScript error); Main found invalid fabricated model-component
fixtures, retained the useful implementation, repaired the evidence and edge
cases without launching another Worker Attempt, and verified the original
contract through remediation check
`4092d4b9-4a27-4ee8-9070-bdaa6c36b2a3`. The machine Task remains failed while
the final disposition is `verified-repaired-delivered`. The one Worker Attempt
used **9,330,055 gross Tokens**, runtime estimate **USD 6.199103**, and official
DeepSeek PAYG estimate **USD 0.128191078**. It has no exact-pair direct-Main
baseline, so ForkLight still makes no Token-savings claim for this Task.

After the reconciliation and candidate-reuse review, the complete repository
passes **1300/1300 tests**, strict TypeScript, production build, Hub JavaScript
syntax, and `git diff --check`. Real-browser QA passed for both the Insights
portfolio card and the historical GLM Task Detail, with no browser-console
errors. The rebuilt daemon is running as PID `90090`; client and daemon match
build id
`280c047bb4d57de91741d43da4138edb8b6170a3d2b25086578d747b65320dfd`
and source digest
`87451683cff9ade42d865dd29e63a5fcf292affcdfe6f5225db58669a1d8efcb`.
Hub remains available locally on port `53542`. No commit or push has been
performed.

### External limits (never claimed fixed)

- Not published to npm as a public package; license still unlicensed until
  the owner chooses SPDX.
- Interactive Grok Build TUI chat cannot always be driven headlessly; MCP stdio
- Live provider probes cost money; never auto-run on page load.

## Out-of-box playbook (15 minutes)

See **README.md → Quick start**. Summary:

1. Install (global from GitHub or local `npm link`)
2. `forklight hub` → Models → Workers → Main install → task service up
3. New Main session (Grok/Codex/Claude) with forklight MCP
4. `forklight_validate` / `forklight_submit` / `forklight_wait` (or CLI equivalents)

## Next engineering

1. **M0 live exit evidence:** the handoff implementation and deterministic
   tests are complete. Use the next three accepted ForkLight deliveries with a
   real build → handoff stop → replacement start → identity check profile;
   require three consecutive passes and zero new test-owned daemon/socket leaks.
2. **Main runtime profile preflight:** calibration identity is explicit and
   immutable, but there is no preflight that proves the declared profile matches
   the runtime actually launched. The first live attempt rejected the stale
   `gpt-5.6` label; the local supported model was `gpt-5.6-sol`. Add a safe
   detect/declare/confirm flow without assuming every Main is Codex.
3. **M1 guided configuration:** Worker Advanced settings and truthful effective
   preview, the per-Worker Quality resolver/snapshot, and the Delivery Profile
   Hub editor are shipped. Next expose Quality fields and provenance in the
   Worker Hub editor, then competition weights and remaining project/global
   presets as explicit Safety / Quality / Preference layers. UI controls must
   consume the shared resolver instead of duplicating policy semantics.
4. **Contract feasibility:** shipped as a durable failure category
   `contract-infeasible` with a pure classifier (`assessContractInfeasibility`),
   verification.completed payload stamping, same-policy extra-attempt rejection,
   adaptation gate stop reason, and Hub next-action `revise-contract`. Reason
   codes are privacy-safe (`undeclared-dependency`, `contradictory-acceptance`,
   `scope-boundary-conflict`) and are not inferred from free-text command output.
   Next: collect production examples where Main declares codes during review,
   and optionally help Task authors preview contradictory acceptance before submit.
5. **Hub Board density and long-run progress:** Board cards now surface
   backend `progress.activity` as plain-language badges: updating, quiet, and
   (presentation-only) stalled after five minutes of silence, without inventing
   a new machine status or changing kanban lanes. A presentation-only name/
   stage filter is shipped so dense boards can be narrowed without mutating
   Tasks. Still open: archive/history and lineage grouping; distinguish
   Provider request in-flight from process-alive stream activity.
6. **Selective model routing:** the privacy-safe advisory core, settings,
   CLI/MCP path, Hub policy/evidence view, failure classification, correction
   churn, official-cost comparability, uncertainty gate, and configurable
   strict/flexible missing-evidence policy are shipped. The optional
   zero-default budget-reliability preference now uses per-Attempt evidence,
   requires the same actually-enforced USD/Token limits, preserves correction
   budget overrides, and never treats uncapped success as proof. Next use competition
   only for uncertainty, critical work, new task classes, or explicit requests.
   Do not make routing mutating until Main can inspect and override every
   recommendation.
7. Collect more accepted exact-pair samples across task classes and Main
   profiles before raising calibration confidence; keep timing separate from
   quality unless the user enables a time preference.
8. **Provider-native exact cost coverage:** Worker `pricingRoute` and a truthful
   aggregate-tier range are shipped. Next capture Provider/runtime-supported
   per-request usage rows so multi-tier Attempts can become exact; until then
   Insights must keep the range supplementary and retain
   `per-request-usage-required` in the exact-unavailable count.
9. **Build identity and runtime activation truth:** soften stale MCP reconnect
   after a rebuild and decide license/public package policy. Delivery settings,
   Task snapshots, Preflight, and Task Detail now distinguish source update,
   source verification, artifact build, and runtime activation. Overview now
   diagnoses which of current source, built assets, or the running daemon is
   stale and gives the exact safe next action. Next configure ForkLight's own
   real build/activation/check profile and prove three consecutive detached
   live handoffs; explanation is shipped, automatic activation evidence is not.
10. **Execution-truth cleanup:** generated-output classification before
    Patch/Integration size gates is shipped for declared workspace exclusions;
    raw and generated audit evidence is retained while the Integration payload
    stays source-only. Preflight now shows the immutable four-stage delivery
    plan and uses the real affected-file list. Next show each affected path's
    effective category and provenance, help Task authors preview missing
    exclusions, distinguish
    `terminal result received`, Worker process cleanup failure, independent
    delivery verification, artifact build, and runtime activation, and continue
    requiring real browser/DOM QA for material Hub changes.
11. **Explainable Hub completion:** the plain-language hierarchy now covers the
    top-level pages, Task input/process/output/check/result/cause/next journey,
    flexible policy modes, Task economics, Delivery settings, and
    historical-plan uncertainty; raw fields and Main review notes are secondary
    evidence. Canonical executable journey tests now cover success, verification
    failure, authentication failure, active execution, legacy fallback, and both
    locales. Next audit remaining secondary drawers and forms, keeping raw
    protocol fields behind evidence disclosures.
12. **Long-running progress observability:** bounded preparation/copying stages
    are shipped. Next coalesce high-frequency stream fragments and distinguish
    quiet reasoning from a stalled process without fake heartbeats or retries.
13. **Single active Hub + recovery correctness:** same-tab authentication across
    a normal page refresh and crash-safe `preparing` workspace recovery are
    shipped. A partial or malformed snapshot is now cleared and rebuilt before
    Attempt 1; cleanup errors fail closed without false Worker attribution.
    Next discover or reuse an existing local Hub instead of accumulating ports,
    explain server/token restart recovery, and make every daemon lifecycle test
    prove its temporary process/socket cleanup so old test daemons cannot leak.
14. **Narrative contract and full copy audit:** the optional bounded Main-authored
    summary and source language are shipped end to end across YAML/MCP parsing,
    immutable Task storage, Worker context, safe Hub projection, and Task
    Detail. Next make Task-authoring entry points help Main write this sentence
    consistently, and continue auditing historical technical fallbacks without
    inventing translations.
15. **UI truthfulness after edits:** semantic draft comparison is shipped for
    model routing, including normalized numeric values and dirty invalid/empty
    inputs. Apply the same rule across Worker, adaptation, and calibration
    forms. Every top-level Hub page now uses an input → process → output → next
    structure, and Task Detail adds status → reason → next action without
    replacing original evidence. Continue the same audit for dialogs, forms,
    empty states, and historical records instead of treating field presence as
    user comprehension.
16. **Shared Main→Worker data contracts:** the Task-presentation path now has a
    canonical safe-response fixture consumed by executable backend and UI tests,
    closing this drift risk for that journey. Extend the same fixture/generated
    type discipline to Delivery Plan, Preflight, and future dependent Task
    contracts so Main catches semantic drift before Integration.
17. **Candidate reuse evidence and comparison:** the three explicit paths are
    shipped: no-Worker reverify-only, same-candidate Worker correction, and a
    new Task for non-reusable work/contracts. Immutable per-Attempt Candidate
    Revisions and structured Gap Contracts are now also shipped: every verified
    Attempt freezes the exact Diff digest and a private patch artifact; Main can
    explicitly mark known-good relative files, describe only the remaining gaps
    and their checks, and authorize one bounded correction. Daemon, CLI, MCP and
    Hub share one read-only preflight eligibility result. Authorization and
    execution both reject a stale Diff, correction grants survive restart with
    their exact contract digest, Main acceptance binds the reviewed patch digest,
    and Integration rejects a changed patch. Empty candidates, exhausted/zero
    allowances and a latest Attempt without matching evidence stop before a
    Worker is launched; there is no automatic repair loop. Legacy records remain
    readable and their existing low-level correction path remains compatible.
    Next add per-Attempt Worker identity and an explicitly authorized cross-Worker
    handoff that consumes the same Candidate Revision without mutating the frozen
    Task provider/runtime. Then collect normal production examples by failure
    category and add an optional paired full-restart experiment for the same
    contract/model/profile. Until that pair exists, show exact correction deltas
    only; do not claim counterfactual restart savings or let routing choose a
    mutating path without Main confirmation.
18. **Token-counter provenance:** terminal top-level usage is the canonical
    Worker-volume source and per-model totals are diagnostic evidence. Next add
    provider/runtime-native receipt identifiers where available and collect
    real mismatch categories over time. Never repair a disagreement by inventing
    component rows, summing unavailable Tasks as zero, or treating a telemetry
    mismatch as execution failure, extra spend, savings, or a Provider bill.

## Latest dogfood — 2026-07-27 budget reliability and partial-candidate reuse

MiniMax-M3 Task `2c76bec3-ecdb-4441-989d-87812bd320df` produced a substantial
candidate (12 files / 783 changed lines) but failed independent verification:
205/208 checks passed, Hub JavaScript syntax and source compatibility passed,
while one malformed statistics fixture, one strict/flexible expectation and one
Chinese-copy assertion failed. The one Attempt used **26,912,964 gross Worker
Tokens** (229,396 input, 59,312 output, 26,624,256 cache read) and reported a
**USD 15.941908 runtime estimate**. MiniMax official exact request cost remains
unavailable for this route (`per-request-usage-required`). Boundary reduction is
only a low-confidence **26,446,791–26,835,811 Token** range and is not a direct
Main Token saving; there is no paired direct-Main baseline.

Main recorded `revise`, retained the candidate patch and corrected only the
gaps instead of launching a complete retry. Settings/API/UI work was reused.
The core evidence calculation was changed from final Task outcome to immutable
Attempt evidence so an earlier budget exhaustion cannot disappear behind a
later correction success. Each correction budget override stays separate;
`policy.token.exceeded` and durable Worker budget categories count as exhaustion;
file/line change-budget checks do not. A configured USD cap counts only when the
Attempt freezes proof that its runtime supports the budget flag, so Grok's
unsupported USD flag cannot become false evidence. Missing evidence exposes
`null`, never a synthetic zero.

Hub now explains the factor as “reached review before hitting the limit”, shows
the comparable run count, rate, actual USD/Token envelope and excluded samples,
and states that the factor is soft: it never disables a model or starts a retry.
Real-browser QA also found and fixed a status contradiction: a machine-failed
candidate with Main `revise` no longer says “independent checks passed”; it now
shows both facts and points to reusable work plus the frozen correction allowance.

That run exposed the previous reuse boundary: `correct` and `reverify` could use
the live workspace, but the Task froze both allowances at zero, so Main had to
absorb `result.diff` manually. The following dogfood slice closes the immutable
Candidate Revision, structured gap and review-to-Integration digest portions.
Cross-Worker takeover remains next and must stay explicitly authorized and
bounded rather than forming an automatic repair loop.

## Latest dogfood — 2026-07-27 immutable candidate revision and gap contract

DeepSeek Task `ded44c43-3b62-4a01-bd89-82d3aa583f39` implemented the first
Candidate Revision / Gap Contract slice with `deepseek-v4-pro[1M]`, Claude Code
high and no per-Task Token cap. Its single Attempt stopped after 75 turns with a
16-file / 1,809-line candidate and failed independent verification. Main did not
launch a second Worker or restart the Task. It recorded `revise`, verified that
all pre-existing candidate files still matched their Task baseline, retained the
useful patch, and corrected only the failed compatibility, stale-evidence,
authorization and UI gaps.

The Task used **11,746,769 gross Worker Tokens** (199,456 input, 46,001 output,
11,501,312 cache read). The Claude runtime estimate was **USD 7.897961** and the
DeepSeek official PAYG estimate was **USD 0.168476486**; the latter remains an
estimate, not a Provider bill. The receipt-aware Main exchange envelope is
**18,077–109,109 Tokens** and the arithmetic boundary reduction is
**11,637,660–11,728,692 Tokens**. There is no exact-pair direct-Main or full
restart baseline, so direct savings remains `direct-baseline-missing`; neither
the retained candidate size nor the boundary range is called “saved Tokens”.

Main's finished implementation freezes every verified Attempt's exact Diff and
private artifact, exposes only safe relative file names for optional known-good
marking, persists the exact remaining-gap contract and its digest, and checks the
same revision before authorization, Worker execution, Main accept and
Integration. Candidate capture failure now makes the Attempt fail instead of
silently losing evidence. An empty Diff is recorded but cannot start a Worker
correction. The Hub tells the user that all candidate files stay in the
workspace, unchecked files are not deleted, and selected files only mean “known
good; avoid disturbing”. Every correction still adds cost and receives at most
one explicit authorization; no failure starts another loop automatically.

Full `npm run check` passes **1,354/1,354 tests**, including strict TypeScript and
the production build. Hub JavaScript syntax and `git diff --check` also pass.
Cross-Worker takeover is deliberately not faked in this slice: it needs immutable
per-Attempt Worker identity plus a handoff contract before a different runtime or
Provider can consume the revision safely. No commit or push has been performed.

The final local runtime is live with daemon PID `80330`; client and daemon share
build id `f80521c034f75d006c796a4f42c25b8610acd513a9c37ed469dc9376fcbbe62a`
and source digest
`bb7321bf57de5bca15d6f5c1d667df6c9c3c7965d017821d302fdc6b7b52d6fd`.
Hub remains on `127.0.0.1:53542`. Real-browser QA confirmed the revised Overview
and historical Task explanation, disabled unsafe correction, exact next action,
and zero browser console warnings/errors. This manual restart is not an automatic
Integration handoff and does not advance M0's 0/3 live-exit count.
