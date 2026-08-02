# ForkLight Project

Last reconciled: 2026-08-02 (Asia/Shanghai)

## Authority

This is ForkLight's **only project-management source of truth**. It owns the
product goal, milestone status, current work, decisions, action items, and the
small set of evidence needed to audit those claims.

It does not replace machine evidence. When a runtime fact conflicts with this
file, ForkLight Store, Git, the built artifact, and authenticated Daemon/Hub
state win; reconcile this file immediately instead of appending a competing
story elsewhere. Historical execution detail belongs in ForkLight Store and
Git history, not in a second Markdown log.

The other documents have narrower jobs:

- `README.md`, `docs/operations.md`, and `docs/configuration.md` explain how to
  install, operate, and configure the product.
- `docs/m1-clean-user-runbook.md` is an executable acceptance procedure.
- `docs/main-clients/` explains Main-client setup.
- Milestone acceptance records and implementation contracts are supporting
  evidence. They must not declare the current milestone or next action.

## Long-term Goal

Build ForkLight into a local-first, runtime- and model-independent execution
hub where one capable **Main** understands the user's outcome, decomposes and
assigns bounded work, supervises persistent Workers, reviews and corrects their
results, and safely integrates accepted changes. A user should be able to see
what was asked, what happened, what was produced, why something failed, what
was retained, what it cost, and what happens next without learning ForkLight's
internal vocabulary.

The Goal is complete only when every M0-M5 exit below has current evidence.
Passing the active milestone alone does not complete the Goal.

## Product boundary

### Main owns

- intent, concept and solution alignment;
- decomposition, Task Contract, inputs, outputs, boundaries, dependencies, and
  acceptance;
- Worker selection and whether Competition is worth its cost;
- independent review, bounded correction, and the final delivery decision;
- authorization to integrate, commit, or push.

### ForkLight owns

- durable Task, Attempt, Candidate, Goal, review, and Integration records;
- isolated Worker workspaces and enforceable tool permissions;
- configurable scheduling, budgets, limits, finite recovery, and handoff;
- independent verification and fail-closed source Integration;
- one human-readable Hub plus CLI/MCP interfaces over the same truth;
- evidence that separates model quality, infrastructure, contract, cost, and
  Main decisions.

### Worker owns

- only the bounded implementation assigned in its isolated workspace;
- no arbitrary shell or web authority, no write access to the original project,
  and no Git commit, push, or Integration authority.

## Durable operating decisions

1. **Quality before arbitrary size limits.** Token, duration, file, line,
   Attempt, correction, adaptation, and concurrency settings are configurable
   per Worker and visible in Hub. Development defaults stay permissive. Safety
   invariants such as isolation, explicit mutation authorization, and
   independent verification are not configurable away.
2. **Finite self-improvement.** Unlimited wall time may be configured, but
   retry, correction, review, no-progress, and no-new-evidence authority remain
   bounded. Hitting the bound returns the decision to Main; it never creates an
   endless repair loop.
3. **Reuse before rerun.** Retain useful Candidate paths and hand off only the
   remaining gaps when evidence permits. Do not restart an entire Task merely
   because one part failed.
4. **Competition is exceptional.** Use it for important multi-solution work,
   high uncertainty, genuinely new task types, or explicit user requests. It is
   not a default retry mechanism and never becomes a vote that overrides Main.
5. **Routing remains advice until evidence is fair.** Missing history does not
   exclude a Worker, and one failure never permanently blacklists a model.
6. **Failures are attributed before models are judged.** Runtime, Provider,
   workspace, verification infrastructure, source drift, and acceptance-contract
   failures must not be counted as model-quality failures.
7. **Hub tells a story, not a telemetry dump.** Default presentation is plain
   language and progressive disclosure: outcome -> current state -> input and
   output -> process -> reason -> retained work -> next action. Technical IDs
   and raw evidence stay available underneath.
8. **Current development routing.** Today and tomorrow, prefer Grok 4.5 and
   DeepSeek v4 Flash 1M for ForkLight implementation and independent review.
   Preserve the saved Codex quota except minimal runtime validation of the Codex
   Worker. GLM 5.2 remains available; MiniMax remains supported by the product
   but is not used for current ForkLight development. Codex/Main owns visual and
   interaction judgment; a Worker receives an explicit UI contract.
9. **Codex is also a first-class Worker target.** ForkLight ships a `codex-cli`
   Worker Runtime alongside `claude-code` and `grok-build`. A saved Worker
   selects an explicit Codex model and a model-supported reasoning effort; both
   are frozen into the Task identity and remain distinct from the Main session's
   model and effort. Single-run and native-Goal execution are implemented and
   real-smoked; restart/resume continuity and a second real Profile remain
   graduation work.
   Runtime support preserves the same isolation, finite execution, independent
   verification, and Main authority as every other Worker.
10. **ForkLight evolves through real self-dogfooding.** Every meaningful
   ForkLight feature, bug fix, refactor, or product-quality change uses
   ForkLight itself for at least one useful bounded implementation or
   independent-review slice. Main still owns the contract, judgment,
   correction, and Integration. Tiny/documentation-only changes and minimum
   recovery or bootstrap work are explicit exceptions; the next eligible slice
   must exercise the restored or newly added capability. Dogfood is evidence,
   not a reason to create ceremonial Tasks, infinite retries, fake M0 streaks,
   or manufactured model comparisons.
11. **No repository publication by default.** Integration into a source tree is
   a separate reviewed action. Commit and push require 一骏's explicit approval.
12. **Prefer Runtime-native Goal execution when it is real.** A saved Worker may
   choose `auto`, `single-run`, or `native-goal` execution. `auto` prefers a
   Runtime's genuine, machine-observable Goal mode when the adapter can bind its
   durable Goal/session identity, progress, completion, blocked state, and
   interruption to one ForkLight Task lineage; otherwise it uses one normal
   run. `native-goal` fails readiness when that proof is unavailable instead of
   pretending a long prompt is a Goal. Runtime-native Goal mode should own the
   bounded end-to-end implementation, while ForkLight still owns the Task
   Contract, workspace boundary, independent acceptance, no-progress stop,
   finite correction/retry authority, and return to Main.

## Milestone roadmap

| Milestone | User capability | Current status | Exit gap |
| --- | --- | --- | --- |
| **M0 — trustworthy self-upgrade** | ForkLight can safely deliver and activate its own changes without lying about partial success. | **Complete: 3/3 consecutive proofs** | No remaining product exit. Three consecutive user-value Integrations each completed apply -> source verification -> build -> activation -> identity check. |
| **M1 — daily personal execution assistant** | A user can configure a real Worker and Main, understand a Task, review it, and integrate useful work as a normal daily flow. | **Open: 2/3 gates** | M1.2 real Worker paths and M1.4 real-project portfolio 13/10 are complete. M1.3 still needs one genuinely clean macOS user/VM/Mac journey. |
| **M2 — long-running work and Worker handoff** | A multi-Task Goal survives interruption, reuses partial work, hands a bounded remainder to another Worker, and returns decisions to Main. | **Complete** | No remaining product exit. Keep regression coverage; do not manufacture disagreement evidence. |
| **M3 — evidence-based Worker routing** | Main receives an understandable, overridable recommendation about who should do a Task and whether comparison is worthwhile. | **Active; foundation built** | The sample floor is passed, but there are zero fair comparable cohorts. Finish exact failure attribution, then learn from natural same-scope multi-Worker evidence rather than replaying work for statistics. |
| **M4 — trustworthy cost and Main-load value** | ForkLight can show when delegation actually reduced Main work and at what quality, time, correction, and money cost. | **Open; measurement foundation only** | Collect reviewed exact-pair baselines for small fix, standard feature, and refactor. Never label Worker-minus-exchange estimates as measured Main Token savings. |
| **M5 — usable by other people** | A new user can independently install, configure, operate, understand, recover, upgrade, and remove ForkLight. | **Open; 0/3-5 external users** | External journeys, security review, license, repository/release policy, migration/recovery evidence, diagnostics, and internal-term removal remain. |

## Milestone exit definitions

### M0 — trustworthy self-upgrade

- Source, build artifact, CLI, Daemon, and Hub identities agree.
- Three consecutive real, useful ForkLight changes pass Integration's four
  stages: source apply, source verification, artifact build, runtime activation.
- Each activation leaves one intended Daemon, at most one owned Hub, and no
  stale version presented as current.
- Any failed stage stops, rolls back when required, preserves evidence, and is
  never shown as success.

### M1 — daily personal execution assistant

- A clean user can reach Hub + usable Worker + current Main in about 15 minutes,
  and one independently verified first Task in about 30 minutes. Timing is
  evidence, not a correctness cutoff.
- The journey covers install -> Keychain -> saved Worker -> Main -> first Task
  -> understanding -> Main review -> safe Integration -> restart continuity.
- At least ten distinct real outcomes are delivered across currently active
  projects without manual Store/database repair. Current evidence is 13/10.
- DeepSeek, MiniMax, Volcengine GLM, and Grok have each produced a real response
  through an explicitly selected saved Worker. Product support is distinct from
  the current development-model preference above.

### M2 — long-running work and Worker handoff

- A Goal advances through 4-8 dependent Tasks and survives Main/Daemon restart.
- Main can retain exact reusable paths, hand only remaining gaps to another
  Worker, and avoid a whole-task rerun.
- Correction, review, no-progress, and no-new-evidence policies remain finite
  even when duration is unlimited.
- Review Graph produces evidence only; Main remains the final decision maker.

### M3 — evidence-based Worker routing

- Real terminal Tasks carry task class/family, selected Worker identity,
  including runtime/model/effort, routing decision, result, correction,
  delivery, cost, and attributed failure.
- Recommendation explains the evidence scope and why it is sufficient or
  insufficient; it remains overridable.
- At least one naturally occurring, same-scope cohort compares two distinct
  executable Worker identities fairly. Raw Task quantity alone is insufficient.
- Competition is explicit and bounded; lack of evidence does not trigger it.

### M4 — trustworthy cost and Main-load value

- Worker Tokens, Main/Worker exchange, official Provider cost, runtime estimate,
  and real bill are separate facts.
- Small fix, standard feature, and refactor each have a reviewed exact-pair
  Worker-vs-direct-Main sample under comparable acceptance conditions.
- Quality, correction count, delivery result, time, and cost accompany any
  Token comparison.
- Users can tune quality/time/cost preference weights without rewriting history.

### M5 — usable by other people

- Three to five external users independently complete the end-to-end journey.
- Install, upgrade, migration, restart recovery, uninstall, and diagnosis are
  repeatable and preserve or remove local state exactly as documented.
- API keys, project source, Worker permissions, logs, and local network surfaces
  pass an explicit security review.
- License, repository metadata, versioning, packaging, release, and support
  policy are decided and shipped.
- Default UI and documentation avoid Daemon/MCP/CandidateRevision vocabulary
  unless the user opens technical evidence.

## Current checkpoint

### Machine truth

- Source of the following facts: authenticated local CLI/Daemon/Store reads on
  2026-08-02. They are a checkpoint, not a promise that process IDs stay fixed.
- CLI and Daemon identity: **matched**.
- Build and source identity: **matched** at the last authenticated health check;
  exact hashes remain machine-owned because editing this file changes the
  source digest.
- Daemon: post-activation Grok path is healthy after restart. Fresh smoke
  `5e618a72-15b9-416f-86bf-a2cfc2fee046` succeeded (~12s, zero diff); a later
  Grok judge also succeeded; Daemon xAI evidence is verified. Earlier proxy
  smokes `98e3fbe1-a2c5-4008-968e-8078c3c278b2` (~10s, zero diff) and
  `045c2499-42f0-4f9e-9310-68029ecf9e61` also succeeded after proxy-enabled
  restarts with Daemon inheriting `HTTP_PROXY`/`HTTPS_PROXY` at
  `http://127.0.0.1:7890`. Transient Hub/PID state is read live from the CLI
  and is not asserted here.
- M0: `required=3`, `achieved=3`, `remaining=0`, `state=ready`. Streak
  membership and the Store's current qualifying operation are transient;
  read them live with `forklight upgrade status --required 3` rather than
  freezing an Integration ID here.
- M3 coverage: `342 terminal / 228 class / 110 family / 57 complete`, across
  186 task classes and 28 families. Decision readiness is `14 single / 0 fair
  comparable / 43 unknown multi / 0 unusable`. M3 is **not** complete: still
  zero fair comparable cohorts.
- M4 direct-Main paired evidence: 2 low-confidence samples across 2 classes and
  2 Profiles; not enough for a general savings claim.
- Latest accepted full-suite evidence: build plus **2400/2400** tests and
  `git diff --check` passed after FL-106 dual-clock delivery. The first full
  run also exposed a pre-existing slow-start test cleanup leak; Main made the
  fixture release and join its fake Runtime on every exit, then the complete
  suite passed without a stranded process.
  Prior accepted checkpoints were 2359/2359 for handled-failure delivery and
  2339/2339 after FL-104 Integration. The earlier 23-file FL-104 scope exceeded
  the old 20-file Integration limit; Main raised the configurable development
  limit to 50 rather than rewriting a coherent delivery solely for file gates.
- FL-104 is **implemented and integrated**, not pending implementation.
  Candidate Task `7ba94774-0289-482a-a23a-8224d1e97fa9` was freshly reverified
  after protocol repairs, Main-accepted, and integrated by operation
  `11b0fa7f-de4c-4c3f-974e-f9705f43f71f` (source verification, build,
  activation, and activation checks all passed). The real model-backed
  native-Goal smoke now passes; only real daemon restart/resume continuity
  remains open.
- The long-term Codex Goal is active with the exact `Long-term Goal` objective.
  FL-001 and FL-002 are complete; FL-002 used a recorded `workers-unavailable`
  Main-direct recovery only after both selected Worker paths ended before a
  Candidate, and the recovery was independently checked. The Codex Worker
  Runtime foundation then integrated as `f097ca23-0e34-4bc4-8970-cb78f8d6c3b9`
  (DeepSeek Task `5cef4acd-13e4-4c95-92a8-a40affcfcb4f`) and
  `892bad32-16a9-423e-ab9d-972773f37729` (Grok-reviewed follow-up
  `ee55a008-22e9-4556-8e9e-d0ee764567b5`), completing M0 at 3/3.
- Repository worktree is intentionally dirty with active ForkLight source,
  tests, contracts, examples, and this documentation consolidation. Preserve
  unrelated work; no commit or push has been authorized.

### Current delivery slices

1. **Profile Worker slot release.** Task
   `e6294b47-b652-4538-ae37-a3bef793f2ff` implemented the intended distinction:
   a Profile's model-execution slot is released when its Worker returns, while
   the full Task remains active through verification and global concurrency
   remains bounded. Focused behavior passed 183/183; the full suite's sole
   failure came from an unrelated process-start timing window. Main has now
   recorded the first failed verification as Candidate/model-quality and the
   later failed verification as verification-infrastructure/non-model. The
   exact source patch is present locally, but the machine Task remains failed
   and there is no fabricated Main acceptance or Integration.
2. **Exact Main failure attribution.** The capability is complete across Core,
   CLI, Daemon, MCP, statistics/routing, and bilingual Hub Task Detail. It binds
   one immutable Main judgment to one failed verification and exact Candidate
   Revision, keeps machine and final-delivery truth unchanged, makes identical
   replay idempotent, and rejects conflicting or malformed history. Grok
   Task `8a542f9e-6867-4f30-8cdc-09d88418a155`, Attempt
   `54f64a40-c9a9-402a-9f1a-4e039503868d`, failed before a Candidate because the
   Grok proxy request stream could not send. Diff is empty, usage and
   verification are absent, and the failure is Runtime/transport evidence—not
   model-quality evidence. The single replacement Task
   `9f6f882d-9d2e-4355-8152-0ba8fcbfad5d` also failed before a Candidate because
   Claude Code tried to create `/tmp/claude-501` while the macOS sandbox had
   canonicalized its writable temp root to `/private/tmp`. The replacement has
   an empty Diff and no usage or verification. The canonical temp bootstrap and
   FL-002 implementation therefore completed under Main-direct record
   `31e274af-a8fd-4e9a-831c-cafed965413c`; no third implementation Task,
   reverify, correction, reusable Worker output, or M0 Integration is claimed.
3. **Declared local dependency materialization.** Accepted revision
   `75c99cb4-cae1-4572-959d-22ad6ee03cdf` was activated by Integration
   `01e1c560-ebe9-40a5-9afe-2ac0036f230f`. An earlier operation
   `c2cf0838-d0b0-4e7b-a6e4-c6a7cf313723` rolled back because its Daemon PATH
   lacked `node`/`npm`. That rollback is why earlier evidence showed the honest
   M0 streak at 1/3 before the two Codex Runtime Integrations below landed.
4. **Codex Worker Runtime foundation.** DeepSeek Flash Task
   `5cef4acd-13e4-4c95-92a8-a40affcfcb4f` implemented the minimum complete
   `codex-cli` single-run path: it retained its first Candidate, corrected its
   own initial independent-verification gaps, passed focused and full
   verification, and integrated as `f097ca23-0e34-4bc4-8970-cb78f8d6c3b9`. Grok
   Review Graph `4e9ea38d-294b-400f-8819-ad21760d530d` then proposed accept
   with two informational findings; follow-up Task
   `ee55a008-22e9-4556-8e9e-d0ee764567b5` closed those two findings and
   integrated as `892bad32-16a9-423e-ab9d-972773f37729`. Together with the
   qualifying Integration `01e1c560-ebe9-40a5-9afe-2ac0036f230f`, M0 is
   complete at 3/3. Current streak membership remains machine-owned via
   `forklight upgrade status --required 3`.
5. **FL-104 — executionPreference + Codex native Goal path.** Integrated by
   `11b0fa7f-de4c-4c3f-974e-f9705f43f71f` from Candidate Task
   `7ba94774-0289-482a-a23a-8224d1e97fa9` (suite then **2339/2339**; superseded
   as latest full-suite by the 2359 evidence below). Per-Worker
   `executionPreference` is `auto` / `single-run` / `native-goal`; `auto`
   resolves Codex to native-goal and unsupported Runtimes to single-run; forced
   unsupported native-goal fails closed. The Codex native Goal app-server path
   performs initialize/initialized, binds exact Thread and Goal identity,
   resumes that binding, handles canonical goal/turn/token notifications, and
   repeats frozen cwd/model/effort/approval/sandbox policy at every relevant
   wire boundary. An earlier real no-model Codex app-server probe exposed an
   ignored workspace field; Grok's first read-only judge incorrectly proposed
   accept, so judge votes remain advisory and Main evidence review remains
   authoritative—track review quality by task family. Real Task
   `c53c97e4-22ad-44da-9787-d3af55297581` then proved the installed Codex
   app-server can return `FORKLIGHT_CODEX_GOAL_OK` with exact Thread, late
   correlated Turn, Goal completion, canonical final output, observed usage,
   zero source changes, and independent verification. The smoke exposed and
   closed both real orderings: `turn/started` may arrive before or after the
   `turn/start` response and may use a different id. **Remaining live gap:**
   daemon restart/resume on the same durable lineage. Saved `codex-luna-max`
   remains `executionPreference=auto` (resolves native-goal).
6. **Explicit handled-failure resolve/reopen truth.** Candidate Task
   `67d507f6-6a1c-4b23-9be5-2b07caae146f` (with tiny Grok proof Task
   `591d588a-64be-4d32-a7c8-05ed16859747` as operation
   `713c3613-ba84-4f2d-8ac8-389357fa7b78`) passed build, focused surfaces,
   **2359/2359**, and `git diff --check` after one retained correction and one
   Main reverification. Review Graph `65739c97-19f3-496a-9acb-1afd23d738ec`
   (reviewer Task `3aca83f1-5942-4136-b341-bf295b8800f6`) proposed accept; Main
   accepted exact revision `3ae90a0b-2e6f-42ad-b218-bac2017c5716` (digest
   `323f72bc9b9c1af289c43937300308b3dac03e7b7eb2f22ae4435924a0da4f38`).
   Integration `676bc933-b0b9-4554-a85b-a746acfdb3ee` passed source apply,
   4-command source verification, build, Daemon activation, and activation
   checks. Real old Grok connectivity Task
   `1b23dca5-6c2b-4fb6-87db-1a1de12dd419` stayed machine **failed**, was
   explicitly attention-resolved as environment-recovered, reopened once,
   resolved again with evidence Task `5e618a72-15b9-416f-86bf-a2cfc2fee046`, and
   exact resolve replay returned `existing=true`. Hub browser audit: absent
   from Now, present in History under a distinct Handled group, still labelled
   failed/network-connectivity; Task Detail says environment recovered—not
   delivered or succeeded—with related Task and Reopen. English and Chinese
   checked at desktop width; Chinese Task Detail at 390×844 had no horizontal
   overflow and no browser console errors. **Truth invariant:** a handled
   failure remains a machine failure and is never model-quality, Token savings,
   or delivery success evidence. FL-103 exit evidence is met.
7. **FL-106 — Runtime signal versus effective progress.** Grok Task
   `f5f0fd47-59cc-41ad-a6e3-d02a78227faa` retained Candidate revision
   `9aaf6e49-3a61-4933-a106-f5f1129c5462` after one bounded correction. The
   adapters now label Runtime liveness separately from substantive response,
   tool, file, Goal-status, and usage progress; each new Attempt resets its own
   progress baseline. The existing configurable `noProgressTimeoutMs` is the
   no-effective-progress stop, while `maxDurationMs` remains the separate total
   wall-time limit. Hub board, Task Detail, and Worker advanced settings explain
   both clocks in plain English and Chinese without claiming that Runtime
   speech proves network health or failure. Grok's correction reached
   2399/2400; the sole red test was an acceptance fixture that expired before
   its fake app-server received setup. Main retained the production Candidate,
   corrected that fixture under Main-direct record
   `c17676e3-1fe6-4dda-b2ff-7efc497abcd0`, fixed one older slow-start cleanup
   leak exposed by full-suite load, and passed build, focused checks,
   **2400/2400**, JavaScript syntax checks, and `git diff --check`. No second
   correction loop, full-task rerun, commit, or push was used.

### Accepted capability: Codex as a Worker Runtime

Single-run and native-Goal execution are real-smoked. Restart/resume continuity
and a second real model/effort Profile remain open.

- **Configuration input:** implemented. One saved Worker Profile (`codex-luna-max`)
  selects `runtime=codex-cli`, an explicit Codex model, one effort supported by
  that model, and `executionPreference=auto` (resolves to native-goal). Hub
  discovers valid combinations from the local Codex catalog instead of
  maintaining a guessed global effort list. Unsupported combinations fail
  before Task creation; there is no silent fallback.
- **Execution input:** implemented for both modes. Single-run passes the bounded
  Task Contract to a fresh non-interactive `codex exec --json` session.
  Native-goal uses the Codex app-server Goal path with exact Thread/Goal
  binding and frozen policy at wire boundaries. Main's conversation, model,
  effort, and mutable user configuration do not leak into the Worker identity.
- **Execution output:** implemented. A Codex Runtime adapter normalizes JSONL
  progress, terminal result, session identity, usage, interruption, and failure
  into the same ForkLight Attempt/Event/Candidate contracts used by other
  Runtimes. Missing usage or cost remains unavailable rather than inferred.
- **Isolation boundary:** implemented as designed. Codex receives only the Task
  workspace and the minimum authentication/runtime material proven necessary.
  User plugins, MCP servers, hooks, web access, nested agents, and broader
  filesystem access stay disabled unless a focused safety spike proves an
  equivalent bounded policy; `ultra` effort stays disabled while its automatic
  delegation behavior cannot be accounted for by ForkLight concurrency and
  evidence.
- **Control boundary:** implemented. ForkLight owns duration/no-progress
  termination, Profile/global concurrency, verification, Candidate capture, and
  recovery. Codex never writes the original project, reviews itself as Main,
  integrates, commits, or pushes.
- **Continuation:** **remaining gap.** Runtime session resume bound to the same
  Task/Attempt lineage and exact isolated workspace is implemented in the
  adapter but not yet proven on a real resumed daemon session. It is not a
  hidden retry or a way around correction limits.
- **Acceptance:** **native-Goal live gate met; graduation still partial.** Single-run real smoke
  `c06a8524-7c5f-4220-9459-e283146483a4` returned `FORKLIGHT_CODEX_WORKER_OK`
  with 34,451 input, 1,475 output, and 19,968 cache-read Tokens and zero changed
  files. FL-104 Integration was 2339/2339; current protocol-hardening acceptance
  is **2388/2388**. Native-Goal smoke
  `c53c97e4-22ad-44da-9787-d3af55297581` returned exact marker
  `FORKLIGHT_CODEX_GOAL_OK` with zero changed files. A real restart/resume proof
  and a second real model/effort Profile remain open (FL-004).

### External coordination boundary

The last received Client-Core SDK coordination message still requires a
source-stability freeze. Until that thread explicitly releases it, do not write,
commit, or push `client-core`, `client-app-adeptify`, `client-core/.release`,
Elsewhere, SDK release directories, or related consumer/Nexus documents.
ForkLight-only work that does not touch those paths may continue.

## Action items

Every action must close a named milestone gap. `Now` is intentionally short;
finishing a Task does not automatically add another Task.

### Now

| ID | Owner | State | Action | Done when |
| --- | --- | --- | --- | --- |
| FL-104 | Main | **Implemented; real native-Goal smoke complete** | Implementation, Integration, protocol hardening, and the minimal real-model smoke are complete. Preserve Task `c53c97e4-22ad-44da-9787-d3af55297581` as the live proof; do not spend more Codex quota repeating it. Remaining continuity work moves to FL-004. | Exit met: exact Thread/Goal binding, both real Turn-start orderings, canonical final marker, observed usage, zero source changes, 2388/2388 tests, and Main acceptance. |
| FL-004 | Main + selected Worker | **In progress: both execution modes smoked** | Graduate `codex-cli` by proving real daemon restart/resume continuity and adding a second saved Profile with a different valid model/effort combination, preserving exact identities and isolation/control boundaries. | Two real Codex model/effort Profiles preserve exact identity; post-activation identity and single-process checks pass; a real restart/continuation proof exists. |
| FL-003 | Main | Actionable now that the Codex Runtime single-run path exists | Resolve the retained Profile-slot slice using the new attribution truth, review the actual local diff, and choose one honest delivery path. | Source and machine evidence agree; no unrelated timing failure is called model failure; no duplicate Worker run; accepted work is either safely integrated or explicitly left undelivered. |

### Next

| ID | Milestone | Action | Exit evidence |
| --- | --- | --- | --- |
| FL-101 | M3 | Accumulate natural same-scope evidence and form the first fair comparable cohort; improve recommendations only where the cohort supports it. | At least one comparable exact-class or family cohort; plain-language recommendation and override path verified. |
| FL-102 | M1 | Run the clean-user protocol on a new macOS account, disposable VM, or new Mac with an unfamiliar user. | Complete worksheet, timing, interventions, comprehension, reviewed delivery, and restart evidence. |
| FL-103 | M3/UX | **Completed.** Hub Now/History handled-failure story, Task Detail environment-recovered copy, bilingual desktop and 390×844 Chinese audit, and resolve/reopen dogfood are recorded under Current delivery slice 6 and the evidence registry. | Exit met: real bilingual browser audit at desktop and narrow width; failed Tasks stay failed while attention can be closed or reopened with evidence. |

### Later

| ID | Milestone | Action | Exit evidence |
| --- | --- | --- | --- |
| FL-105 | M3/UX | Bounded hardening debts found during handled-failure delivery (do not displace FL-104 live proofs): require the internal delivered-truth parameter at the type boundary; reject/describe unknown resolve CLI flags and document `--evidence`; raise mobile task-detail controls toward 44px targets; replace repeated side-accent borders in one later UI hardening batch. | Type-level delivered-truth required; unknown resolve flags rejected/described with `--evidence` documented; mobile controls approach 44px; side-accent borders deduplicated without regressing handled-failure truth. |
| FL-106 | M2/M3 | **Completed.** Runtime liveness and effective progress now use separate event evidence, Attempt-scoped clocks, watchdog behavior, and plain-language Hub presentation; the DeepSeek ten-minute processing-only incident is now represented truthfully. | Exit met: liveness cannot indefinitely defeat the configurable no-effective-progress stop; Hub shows both clocks without treating Runtime speech as proof of network health or failure; build and 2400/2400 tests passed. |
| FL-201 | M4 | Capture reviewed exact-pair direct-Main baselines for small fix, standard feature, and refactor. | Three task shapes with comparable acceptance plus quality/time/correction/cost evidence. |
| FL-202 | M4 | Turn paired evidence into cautious value reporting and user-tunable preferences. | Only supported comparisons say “saved”; low-confidence and missing baselines remain explicit. |
| FL-301 | M5 | Prepare a private external-user pilot and security/release checklist. | 3-5 independent end-to-end users, explicit security findings, stable lifecycle docs. |
| FL-302 | M5 | Decide public identity and distribution policy. | License, repository metadata, versioning, release/update channel, support and diagnostics are complete. |

## Evidence registry

Only compact anchors live here. Detailed events, outputs, diffs, and timings stay
in ForkLight Store or Git history.

| Claim | Evidence |
| --- | --- |
| Project management and Codex Goal are consolidated | `PROJECT.md` is the only project-management source; `README.md` and `AGENTS.md` point here; active Codex Goal matches `Long-term Goal` |
| M0 is complete 3/3 | Durable conclusion: required=3, achieved=3, remaining=0, state=ready. Historical qualifying Integrations `01e1c560-ebe9-40a5-9afe-2ac0036f230f`, `f097ca23-0e34-4bc4-8970-cb78f8d6c3b9`, `892bad32-16a9-423e-ab9d-972773f37729`; rollback `c2cf0838-d0b0-4e7b-a6e4-c6a7cf313723` is the earlier failure record. Current streak membership is read live via `forklight upgrade status --required 3` |
| M1 Worker paths and first delivery work locally | Task `bfe223ac-feb2-422e-8f5b-418eef919308`; `docs/m1-daily-assistant-acceptance.md` |
| M1 real-project portfolio is 13/10 | `docs/m1-real-task-portfolio.md` |
| M1 clean-user gate remains open | `docs/m1-clean-user-runbook.md` |
| M2 durable Goals | Relay history Goal `examples/dogfood/relay-gmail-history-goal.json` 5/5; four-Task restart Goal 4/4 |
| M2 cross-Worker handoff | `decbae4e-4ac8-48c3-a5d2-78801662ccb4` -> `dd837113-bb99-4557-b5ae-c08fc9881549`; restart path `0d829248-7cbc-4f10-83d8-afb3531b31f2` -> `9c69323e-af1c-43de-afb5-59129904dadf` |
| Profile slot release | Task `e6294b47-b652-4538-ae37-a3bef793f2ff`; `docs/m3-profile-worker-slot-release-contract.md` |
| Failure-attribution first attempt is Runtime failure | Task `8a542f9e-6867-4f30-8cdc-09d88418a155`; Attempt `54f64a40-c9a9-402a-9f1a-4e039503868d`; `docs/m3-main-failure-attribution-contract.md` |
| Failure-attribution replacement is also pre-Candidate Runtime failure | Task `9f6f882d-9d2e-4355-8152-0ba8fcbfad5d`; Attempt `7d7c9857-c645-4996-a104-3cae8295da13`; empty Diff; `/tmp/claude-501` EPERM under canonical `/private/tmp` sandbox allowlist |
| Exact failure attribution is operational | Main-direct record `31e274af-a8fd-4e9a-831c-cafed965413c`; Task `e6294b47-b652-4538-ae37-a3bef793f2ff` events `1389` and `1390`; identical replay of event `1390` returned `existing=true`; Task remains failed; prior full suite 2,302/2,302 (superseded by later 2339 then **2359** evidence below) |
| Codex Worker Runtime foundation is implemented and real-smoked | Real smoke `c06a8524-7c5f-4220-9459-e283146483a4` returned `FORKLIGHT_CODEX_WORKER_OK` (34,451 input / 1,475 output / 19,968 cache-read Tokens, zero changed files) on saved Profile `codex-luna-max`; local `codex-cli`; per-run `model_reasoning_effort`; catalog reports model-specific effort sets |
| DeepSeek implemented the Codex Runtime foundation | Task `5cef4acd-13e4-4c95-92a8-a40affcfcb4f` (DeepSeek Flash) retained its first Candidate, corrected its own initial independent-verification gaps, passed focused/full verification, integrated as `f097ca23-0e34-4bc4-8970-cb78f8d6c3b9` |
| Grok review proposed accept with two informational findings; follow-up closed them | Review Graph `4e9ea38d-294b-400f-8819-ad21760d530d`; follow-up Task `ee55a008-22e9-4556-8e9e-d0ee764567b5` closed both findings, integrated as `892bad32-16a9-423e-ab9d-972773f37729` |
| FL-104 native Goal is implemented and real-smoked | Original Candidate `7ba94774-0289-482a-a23a-8224d1e97fa9`; Integration `11b0fa7f-de4c-4c3f-974e-f9705f43f71f`; protocol Candidate `776de7a9-a9ed-4a23-b2ec-959fb9af38d4`; DeepSeek review `2c4726b4-898b-41da-8941-b58f0b6aa04e`; Main-direct `809d03de-405a-468d-ac0c-644b902138ac`; live Task `c53c97e4-22ad-44da-9787-d3af55297581`; exact marker `FORKLIGHT_CODEX_GOAL_OK`; zero diff; current suite **2388/2388**; restart/resume remains FL-004 |
| Handled-failure resolve/reopen is integrated | Candidate `67d507f6-6a1c-4b23-9be5-2b07caae146f`; revision `3ae90a0b-2e6f-42ad-b218-bac2017c5716`; Integration `676bc933-b0b9-4554-a85b-a746acfdb3ee`; full suite **2359/2359** |
| Real Grok connectivity failure stayed failed and was attention-resolved | Task `1b23dca5-6c2b-4fb6-87db-1a1de12dd419` machine failed/network-connectivity; attention-resolved environment-recovered; reopened once; resolved again with evidence Task `5e618a72-15b9-416f-86bf-a2cfc2fee046`; exact resolve replay `existing=true`; never delivered/succeeded |
| Fresh Grok recovery smoke and FL-103 browser exit | Smoke `5e618a72-15b9-416f-86bf-a2cfc2fee046` (~12s, zero diff); later Grok judge succeeded; Hub History Handled group + Task Detail environment recovered; EN/ZH desktop and ZH 390×844 no overflow/console errors; FL-103 **completed** |
| Post-activation Grok proxy path is healthy | Fresh smoke `5e618a72-15b9-416f-86bf-a2cfc2fee046`; earlier `98e3fbe1-a2c5-4008-968e-8078c3c278b2` (~10s, zero diff) and `045c2499-42f0-4f9e-9310-68029ecf9e61`; Daemon HTTP(S)_PROXY `http://127.0.0.1:7890` after proxy-enabled restart |
| Grok proxy recovery is infrastructure, not model quality | Preceding Grok pre-Candidate failures were connectivity/transport; repaired path and attention-resolved historical failure are not model-quality, Token savings, or delivery-success evidence |
| FL-106 dual-clock delivery is verified | Grok Task `f5f0fd47-59cc-41ad-a6e3-d02a78227faa`; retained revision `9aaf6e49-3a61-4933-a106-f5f1129c5462`, digest `dded4b57b794fe02cc45e29bd21a9f960e5ec65a8a05d3b695dfe5c6caa30d08`; Main-direct `c17676e3-1fe6-4dda-b2ff-7efc497abcd0`; fresh Grok runtime smoke `fd1679cb-79c1-4253-a77f-ee24acb2f66b`; build + focused checks + **2400/2400** + JavaScript syntax + `git diff --check` |
| M3 coverage | `routing_evidence_coverage` from the build-matched Daemon: 342/228/110/57 and 0 comparable; M3 not complete |
| M4 paired evidence is insufficient | `dc-cli-20260723-001` for Task `fe894ff7...`; `smp-27cf...` for Task `8de01a79...`; both sample-size one |

## Update protocol

1. At the start of a meaningful iteration, read this file, then perform a
   read-only preflight of Git, Store, current build identity, Daemon, Hub, and
   any relevant external freeze. Do not trust a process ID or counter copied
   from an earlier session.
2. Select work only from `Now`, or add a new action that explicitly closes a
   milestone exit. Align its user outcome, inputs, outputs, boundaries,
   dependencies, and acceptance before implementation. For meaningful
   ForkLight code work, run ForkLight health and route at least one useful
   bounded implementation or review slice through ForkLight itself; record any
   recovery/bootstrap exception instead of hiding it.
3. While work runs, machine events stay in ForkLight Store. Do not append a
   parallel Markdown diary.
4. At a stable checkpoint, update only:
   - milestone status if an exit changed;
   - the current checkpoint facts that materially changed;
   - action state and next action;
   - one compact evidence anchor for a claim that needs auditability.
5. Move completed actions out of `Now`; do not retain chronological prose.
   Git and Store preserve history.
6. A Worker or automated process may propose an update, but Main verifies the
   source facts and owns the edit to this file.
7. If this file grows beyond roughly 500 lines, compress it. Do not solve
   ambiguity by creating another status, roadmap, dogfood, or progress file.
