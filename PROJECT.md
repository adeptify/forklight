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
   model and effort. Single-run, native-Goal execution, graceful Daemon
   restart/resume continuity, and two saved effort Profiles are now
   real-smoked. One intentional restart continued the exact prior Thread in the
   same Task/workspace/session rather than creating a replacement Task or
   consuming a quality retry.
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
13. **Classify generated output in every build-producing Task.** Task contracts
   declare paths such as `dist/**` in `workspace.generatedPaths`; generated
   artifacts remain reviewable evidence but do not consume product file/line
   limits or obscure the actual delivery boundary.

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
- Daemon: Grok no longer depends on terminal or Daemon proxy inheritance. Saved
  Profile `local-grok-builder` freezes `custom-proxy`; zero-Diff Task
  `0be3aa84-14b5-41bf-82ea-8df74034f296` returned the exact marker after the
  Daemon was intentionally restarted with zero HTTP(S)/ALL/NO proxy variables.
  Its public Worker event recorded only `networkPolicyMode=custom-proxy`.
  Transient Hub/PID state is read live from the CLI and is not asserted here.
- M0: `required=3`, `achieved=3`, `remaining=0`, `state=ready`. Streak
  membership and the Store's current qualifying operation are transient;
  read them live with `forklight upgrade status --required 3` rather than
  freezing an Integration ID here.
- M3 coverage: `394 terminal / 280 class / 159 family / 82 complete`, across
  220 task classes and 33 families. Frozen decision readiness is `22 single / 2
  task-family-scoped multi / 58 unknown multi / 0 unusable`. The scoped
  multi-Worker decisions are not yet reviewed same-work comparison cohorts;
  M3 remains **not complete** until natural same-scope outcomes support a fair
  recommendation.
- M4 direct-Main paired evidence: 2 low-confidence samples across 2 classes and
  2 Profiles; not enough for a general savings claim.
- Latest accepted full-suite evidence: build plus **2459/2459** tests,
  JavaScript UI checks, the bounded Impeccable detector, browser interaction
  checks, and `git diff --check` passed after FL-107 Integration.
  The first full
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
  native-Goal smoke passes. FL-004 has now closed the real Daemon
  restart/resume and second-Profile graduation gaps.
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

Completed slices stay compact here; exact events, outputs, Diffs, and timings remain
in ForkLight Store and the evidence registry.

| Slice | Delivered outcome | Primary evidence |
| --- | --- | --- |
| FL-003 | A Worker releases its Profile slot when model execution ends, while global in-flight limits still cover verification. The original failed Task remains failed; production behavior was not applied twice. | Failed Task `e6294b47-b652-4538-ae37-a3bef793f2ff`; audits `3693528a-4adb-46f9-a21c-e5ded3087d7d` and `3ae3a5dd-57b9-40e6-98dc-ca2555c4b541`; Candidate `cc955b59-b2bb-4a6d-acce-b3984ab386dd`; Integration `8623fc4d-aa12-4137-bedf-580a5ad20499`. |
| Main failure attribution | Main can bind one immutable judgment to the exact failed verification and Candidate without relabelling delivery truth. | Main-direct `31e274af-a8fd-4e9a-831c-cafed965413c`; the two pre-Candidate Grok/Claude failures retain empty Diffs and Runtime/infrastructure attribution. |
| Local dependencies | Declared sibling packages are materialized inside the isolated workspace and verified without exposing the source tree. | Candidate `75c99cb4-cae1-4572-959d-22ad6ee03cdf`; Integration `01e1c560-ebe9-40a5-9afe-2ac0036f230f`. |
| Codex Worker foundation | `codex-cli` is a first-class single-run Worker with frozen model/effort, isolated auth and exact usage evidence. | DeepSeek Task `5cef4acd-13e4-4c95-92a8-a40affcfcb4f`; Integrations `f097ca23-0e34-4bc4-8970-cb78f8d6c3b9` and `892bad32-16a9-423e-ab9d-972773f37729`. |
| FL-104 | Per-Worker `auto` / `single-run` / `native-goal` execution and the real Codex native Goal path are integrated. | Candidate Task `7ba94774-0289-482a-a23a-8224d1e97fa9`; Integration `11b0fa7f-de4c-4c3f-974e-f9705f43f71f`; live Goal `c53c97e4-22ad-44da-9787-d3af55297581`. |
| FL-103 | A handled failure stays failed but can leave Now, enter a distinct History group, explain recovery, and be reopened. | Candidate `3ae90a0b-2e6f-42ad-b218-bac2017c5716`; Integration `676bc933-b0b9-4554-a85b-a746acfdb3ee`; bilingual desktop and 390×844 browser audit. |
| FL-106 | Runtime liveness and effective progress use separate clocks; one cannot indefinitely defeat the configurable no-progress stop. | Grok Task `f5f0fd47-59cc-41ad-a6e3-d02a78227faa`; Candidate `9aaf6e49-3a61-4933-a106-f5f1129c5462`; Main-direct `c17676e3-1fe6-4dda-b2ff-7efc497abcd0`. |
| FL-004 | Codex native Goal survives an intentional Daemon restart using the exact prior Task, workspace, session and Thread; a second effort Profile also passed. | Main-direct `aa89bfcc-7334-43bf-9147-a87330e19740`; restart Task `28e167d7-164c-4df4-aaea-75e774054448`; low-effort Task `78096848-c881-41bc-9f25-acebbf181f30`. |
| FL-107 | Each Worker can freeze `inherit`, `direct`, or credential-free `custom-proxy` routing. Claude, Grok and both Codex paths apply it; events expose only the mode; Hub advanced settings load and switch it bilingually. | DeepSeek Task `b064f658-88fb-4dbb-9ad8-7e5046260da3`; Candidate `28f133fd-72cf-4c91-9bf7-026df9608577`; Grok judge `8e231382-71a0-4643-a0c3-cf3cd88ef204`; Integration `cc146c23-81e9-4286-84c7-c5e458bc8d27`; zero-Diff Grok smoke `0be3aa84-14b5-41bf-82ea-8df74034f296`. |

FL-107 also exposed one contract-authoring lesson: its first Task omitted
`workspace.generatedPaths: ["dist/**"]`, so verifier build output inflated the
reviewed patch from 16 product/test paths to 52 total paths. Main temporarily
raised the configurable Integration review limit from 50 to 60, integrated the
verified Candidate, and restored it to 50. Future build-producing Task
contracts must classify generated output rather than treating it as product work.
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

No implementation slice is in flight. Main selects the next item with 一骏
before dispatch; completing FL-107 does not silently start another feature.

### Next

| ID | Milestone | Action | Exit evidence |
| --- | --- | --- | --- |
| FL-101 | M3 | Accumulate natural same-scope evidence and form the first fair comparable cohort; improve recommendations only where the cohort supports it. | At least one comparable exact-class or family cohort; plain-language recommendation and override path verified. |
| FL-102 | M1 | Run the clean-user protocol on a new macOS account, disposable VM, or new Mac with an unfamiliar user. | Complete worksheet, timing, interventions, comprehension, reviewed delivery, and restart evidence. |
| FL-108 | M3/UX | Recompose Hub information around “发生了什么、结果是什么、下一步做什么” without deleting evidence. Start by combining configured connection routing and latest real connection evidence into one human sentence instead of repeating a technical caveat on every Worker card. | Main-approved information architecture; bilingual browser audit; default cards are calmer while Task inputs, outputs, process, failure, retained work, cost and technical evidence remain progressively available. |

### Later

| ID | Milestone | Action | Exit evidence |
| --- | --- | --- | --- |
| FL-105 | M3/UX | Bounded hardening debts found during handled-failure delivery (do not displace FL-104 live proofs): require the internal delivered-truth parameter at the type boundary; reject/describe unknown resolve CLI flags and document `--evidence`; raise mobile task-detail controls toward 44px targets; replace repeated side-accent borders in one later UI hardening batch. | Type-level delivered-truth required; unknown resolve flags rejected/described with `--evidence` documented; mobile controls approach 44px; side-accent borders deduplicated without regressing handled-failure truth. |
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
| Profile slot release is delivered without rewriting failed history | Original failed Task `e6294b47-b652-4538-ae37-a3bef793f2ff`; production commit `e6a6cc0`; DeepSeek audit `3693528a-4adb-46f9-a21c-e5ded3087d7d`; Grok follow-up `3ae3a5dd-57b9-40e6-98dc-ca2555c4b541`; accepted revision `cc955b59-b2bb-4a6d-acce-b3984ab386dd`; Integration `8623fc4d-aa12-4137-bedf-580a5ad20499`; **2431/2431** |
| Failure-attribution first attempt is Runtime failure | Task `8a542f9e-6867-4f30-8cdc-09d88418a155`; Attempt `54f64a40-c9a9-402a-9f1a-4e039503868d`; `docs/m3-main-failure-attribution-contract.md` |
| Failure-attribution replacement is also pre-Candidate Runtime failure | Task `9f6f882d-9d2e-4355-8152-0ba8fcbfad5d`; Attempt `7d7c9857-c645-4996-a104-3cae8295da13`; empty Diff; `/tmp/claude-501` EPERM under canonical `/private/tmp` sandbox allowlist |
| Exact failure attribution is operational | Main-direct record `31e274af-a8fd-4e9a-831c-cafed965413c`; Task `e6294b47-b652-4538-ae37-a3bef793f2ff` events `1389` and `1390`; identical replay of event `1390` returned `existing=true`; Task remains failed; prior full suite 2,302/2,302 (superseded by later 2339 then **2359** evidence below) |
| Codex Worker Runtime foundation is implemented and real-smoked | Real smoke `c06a8524-7c5f-4220-9459-e283146483a4` returned `FORKLIGHT_CODEX_WORKER_OK` (34,451 input / 1,475 output / 19,968 cache-read Tokens, zero changed files) on saved Profile `codex-luna-max`; local `codex-cli`; per-run `model_reasoning_effort`; catalog reports model-specific effort sets |
| DeepSeek implemented the Codex Runtime foundation | Task `5cef4acd-13e4-4c95-92a8-a40affcfcb4f` (DeepSeek Flash) retained its first Candidate, corrected its own initial independent-verification gaps, passed focused/full verification, integrated as `f097ca23-0e34-4bc4-8970-cb78f8d6c3b9` |
| Grok review proposed accept with two informational findings; follow-up closed them | Review Graph `4e9ea38d-294b-400f-8819-ad21760d530d`; follow-up Task `ee55a008-22e9-4556-8e9e-d0ee764567b5` closed both findings, integrated as `892bad32-16a9-423e-ab9d-972773f37729` |
| Codex native Goal and FL-004 graduation are complete | FL-104 Candidate `7ba94774-0289-482a-a23a-8224d1e97fa9`; Integration `11b0fa7f-de4c-4c3f-974e-f9705f43f71f`; first live Goal `c53c97e4-22ad-44da-9787-d3af55297581`; FL-004 Grok revision `438e0a03-65f5-4449-b2b1-c2d1620b2752`; DeepSeek follow-up revision `979ae24f-5b0c-4833-914e-d0d869c62d62`; Main-direct `aa89bfcc-7334-43bf-9147-a87330e19740`; restart Task `28e167d7-164c-4df4-aaea-75e774054448`; low-effort Profile Task `78096848-c881-41bc-9f25-acebbf181f30`; exact markers; zero Diff; current suite **2428/2428** |
| Handled-failure resolve/reopen is integrated | Candidate `67d507f6-6a1c-4b23-9be5-2b07caae146f`; revision `3ae90a0b-2e6f-42ad-b218-bac2017c5716`; Integration `676bc933-b0b9-4554-a85b-a746acfdb3ee`; full suite **2359/2359** |
| Real Grok connectivity failure stayed failed and was attention-resolved | Task `1b23dca5-6c2b-4fb6-87db-1a1de12dd419` machine failed/network-connectivity; attention-resolved environment-recovered; reopened once; resolved again with evidence Task `5e618a72-15b9-416f-86bf-a2cfc2fee046`; exact resolve replay `existing=true`; never delivered/succeeded |
| Fresh Grok recovery smoke and FL-103 browser exit | Smoke `5e618a72-15b9-416f-86bf-a2cfc2fee046` (~12s, zero diff); later Grok judge succeeded; Hub History Handled group + Task Detail environment recovered; EN/ZH desktop and ZH 390×844 no overflow/console errors; FL-103 **completed** |
| FL-107 durable Worker networking is integrated | DeepSeek Task `b064f658-88fb-4dbb-9ad8-7e5046260da3`; Candidate `28f133fd-72cf-4c91-9bf7-026df9608577`, digest `89f91ab1c99a556c549441a5c26298f56af7ef552404862e2f2043c4e2ffe689`; Grok Review Graph `192f6c77-34fb-4473-b587-3e33e98c6e9a`; Integration `cc146c23-81e9-4286-84c7-c5e458bc8d27`; full suite **2459/2459** |
| Grok succeeds without Daemon proxy inheritance | Daemon proxy environment count `0`; saved Profile `local-grok-builder` uses `custom-proxy`; Task `0be3aa84-14b5-41bf-82ea-8df74034f296` returned `FORKLIGHT_GROK_SAVED_PROXY_OK`, zero Diff, 2/2 verification; public event exposed only the mode |
| Grok proxy failures are infrastructure, not model quality | Preceding Grok pre-Candidate failures were connectivity/transport; repaired path and attention-resolved historical failure are not model-quality, Token savings, or delivery-success evidence |
| FL-106 dual-clock delivery is verified | Grok Task `f5f0fd47-59cc-41ad-a6e3-d02a78227faa`; retained revision `9aaf6e49-3a61-4933-a106-f5f1129c5462`, digest `dded4b57b794fe02cc45e29bd21a9f960e5ec65a8a05d3b695dfe5c6caa30d08`; Main-direct `c17676e3-1fe6-4dda-b2ff-7efc497abcd0`; fresh Grok runtime smoke `fd1679cb-79c1-4253-a77f-ee24acb2f66b`; build + focused checks + **2400/2400** + JavaScript syntax + `git diff --check` |
| M3 coverage | `routing_evidence_coverage` from the build-matched Daemon: 394/280/159/82; two task-family-scoped multi decisions are not yet reviewed fair outcome cohorts; M3 not complete |
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
