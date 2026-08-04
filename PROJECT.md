# ForkLight Project

Last reconciled: 2026-08-04 (Asia/Shanghai)

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
14. **One work hierarchy, not three competing object lists.** The primary work
   surface is one status-column Kanban whose hierarchy is `Goal -> Plan ->
   Task`. Columns describe execution state; swimlanes describe ownership and
   decomposition. Goal, Plan, and Task may keep deep links, but they do not
   remain three peer dashboards. A drag gesture may request only a real,
   authorized transition; it never rewrites machine status or bypasses a
   dependency, Main review, verification, or Integration gate.

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
  2026-08-04. They are a checkpoint, not a promise that process IDs stay fixed.
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
- Latest accepted full-suite evidence is **2637/2637** after FL-108D2 safe
  Integration and activation. CLI/Daemon build and source identity matched at
  the authenticated health check. Exact hashes and process IDs remain
  machine-owned and should be read live.
- FL-111D1 is integrated. Grok Task
  `170851d8-171f-445f-af18-ea06fb84de29` passed five checks at accepted
  revision `9857b5de-ed33-401e-a200-14b53ebe2cff`, digest
  `1e846861817a854f62713592f91f63c6269e038fd0e87355f958b8bb3c53e11e`;
  one Grok judge recommended accept. Integration
  `61df6b11-29db-44da-943b-4888d146b3e3` passed all four stages. Its first
  Integration attempt rolled back on one unrelated detached-Daemon handoff
  test fluctuation; the exact test passed alone before the single bounded retry.
- Future Codex account-quota failures now remain one budget-class reason with
  wait-or-switch guidance. Codex Luna Max is still account-quota blocked, so
  it is not retried and is not counted as model-quality evidence. No Provider
  usage, cost or direct-Main Token-savings claim was invented.
- FL-108D2 is integrated and live-audited. Successful and failed Task Detail
  stories now use one visible number per step, neutral attempt/file counts and
  truthful failed-check labels without changing lifecycle evidence.
- Completed-slice IDs, revisions, digests, Integrations and historical failure
  truth live once in `Current delivery slices` below and in ForkLight Store;
  this checkpoint does not duplicate their chronological narratives.
- The long-term Codex Goal remains active with the exact `Long-term Goal`
  objective. Current execution must continue from `Now` and automatically
  start the next selected action after each stable checkpoint.
- Repository worktree is intentionally dirty with active ForkLight source,
  tests, contracts, examples, and this documentation consolidation. Preserve
  unrelated work; no commit or push has been authorized.

## Unified hierarchical workbench contract (FL-109)

### User outcome and data relationship

- A user sees one board with seven columns: **Not started, Ready, Running,
  Waiting for verification, Waiting for your decision, Completed, and
  Stopped/failed**. A column is a Task execution state, never an object type.
- A Goal is a cross-column swimlane containing its Plan; it leads with the
  plain-language outcome, what was completed, current blocker, next action,
  and any decision needed. Percentage is supporting evidence, not the story.
- A Plan is the Goal's child swimlane. Today the durable model is one Goal to
  one Plan, one Plan to many Tasks, and a Task to at most one Plan item. The UI
  read model uses `plans[]` so a future storage migration can support multiple
  Plans without replacing the interaction model.
- A Plan without a Goal is shown under **Independent plans**, preserving its
  Plan -> Task hierarchy. A Task without a Plan is shown under the single
  **One-off tasks** swimlane; no blank Goal or Plan placeholders are invented.
- `plan_dependencies` remains authoritative. An unsatisfied dependency keeps a
  Task in Not started; a queued Task enters Ready only when every dependency is
  satisfied. Reverse edges explain what finishing the Task will unlock.
- Goal milestone gates remain authoritative for Goal progress and Main
  decisions. Plan and Goal summaries are derived from Task, dependency,
  verification, Main-review, delivery, and stop evidence rather than copied
  percentages.

### Module boundaries

| Module | Consumes | Produces | Boundary |
| --- | --- | --- | --- |
| Core hierarchical board projection | Store Tasks, Plan items/dependencies, Goals/milestones, delivery and board placement | One privacy-safe `WorkHierarchyView` with swimlanes, seven columns, breadcrumbs, blockers, completed facts and next actions | Read-only; does not infer a delivery or mutate lifecycle state |
| Transition policy | Task/Goal state plus existing resume, review, Integration, stop and dependency authority | Allowed drop targets, action meaning, confirmation text and rejection reason | A drop invokes an existing authorized command; it never sets status directly |
| Daemon + Hub bridge | Canonical Core projection and bounded filters | One versioned endpoint shared by Hub/CLI/MCP consumers | No client-side joining of contradictory Goal, Plan and Task truth |
| Hierarchical Kanban renderer | WorkHierarchyView, project/status/Worker filters, collapse state | Goal and Plan swimlanes with Task cards in status columns | Filtering preserves ancestor lanes and never flattens matches |
| Task detail drawer | Exact Task hierarchy plus existing journey projection | `Goal > Plan > Task` breadcrumb; input, process, output, failure, verification and next action | Technical IDs, Tokens and raw logs stay in progressive disclosure |
| Outcome intake | User outcome and optional `auto/task/plan/goal` preference | A Main-authored preview choosing one-off Task, Plan or durable Goal, then existing confirmed creation operations | Hub does not replace Main with a heuristic and does not create work before confirmation |

### Interaction acceptance

1. All seven columns render in a stable order; Task cards alone occupy columns.
2. Goal and Plan lanes expand/collapse, retain state across refresh, and remain
   keyboard operable. A Goal summary says what finished, where work is blocked,
   and what happens next even when its percentage is unchanged.
3. Dependency fixtures prove an unready Task cannot appear in Ready, and each
   blocked card names the prerequisite and the work it will unlock.
4. Project, status, and Worker filters retain the complete matching
   Goal -> Plan -> Task path. Empty ancestors are hidden; matches never become
   a flat list.
5. Standalone Tasks appear only in One-off tasks. Independent Plans never gain
   a fake Goal.
6. Clicking a Task opens the right drawer with its breadcrumb and the ordered
   story: ask, work, output, failure/cause, verification, delivery and next.
7. Dragging exposes only legal target columns, works by keyboard as well as
   pointer, explains invalid drops, and requires the same confirmation and
   authority as the underlying operation.
8. The default surface uses plain English and Chinese. IDs, event codes,
   Tokens, raw logs and scoring math are closed by default but remain available.
9. Desktop and narrow-width browser fixtures preserve column scanning,
   hierarchy, focus, drawer access and horizontal-scroll containment.

### Implementation order

1. **FL-109A — canonical read model.** Freeze the seven-column mapping,
   hierarchy projection, derived Goal/Plan story, standalone classification,
   dependency invariants, filter semantics and fixtures in Core; expose one
   versioned Daemon/Hub read endpoint.
2. **FL-109B — read-only unified workbench.** Replace the peer default views
   with the hierarchical board, collapse state, preserved filters and Task
   drawer breadcrumb. Keep old routes only as temporary deep-link redirects.
3. **FL-109C — truthful action layer.** Add the transition policy and
   pointer/keyboard drag requests for transitions already supported by durable
   ForkLight commands; invalid drops remain explanatory no-ops.
4. **FL-109D — outcome-first creation.** Add one outcome composer, Main shape
   proposal and confirmation preview; retain advanced manual shape selection.
5. **FL-109E — migration exit.** Complete bilingual desktop/mobile audits,
   remove obsolete peer-list navigation, verify restart/history/filter
   continuity, and make the hierarchical workbench the only default work view.

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
| FL-107B | Every Task derived from a selected Worker now keeps that Worker's exact network route; legacy inherit clears stale source routing, and public evidence still exposes only the mode. | DeepSeek Task `609e5f2c-a692-4746-8061-8fcb0984b16c`; Candidate `5cbfdd16-d2b1-420c-81bd-3c5f60f5e332`, digest `02cf145a00de5afd7fd85b22df9aaefc79d766c0ab0b302317c07ca40c2a76a5`; Integration `ab4959c8-2071-4572-9cfe-20a42ada7979`; zero-proxy Grok Review Graph `ee4a5d3c-e084-4311-ae12-d8686156d5d6`; full suite **2467/2467**. |
| FL-108A | Worker cards now lead with one plain-language connection conclusion and an actual next action; execution limits and technical evidence remain progressively available. | DeepSeek Task `0d8996ed-7fd4-422a-8a89-b99142730e8f`; Candidate `80a8bdf4-d022-4aff-9a23-f2c79340baac`; Integration `5b30015a-2fdc-444f-a34e-105f8926e8bf`; Grok ACCEPT `bcad11fd-3b7d-4bbf-8fea-5b5fa58824a8`; bilingual browser and full-suite pass. |
| FL-108B | Work now leads with outcome intake, compact help, filters and the live hierarchy. Active Goals lead; terminal Goals stay reachable in one lazy counted disclosure; neutral lane narration hides empty blockers and redundant completed actions without changing Core truth. | Grok Task `450a99ab-89de-4acc-8398-6b74b8e6fdd2`; corrected revision `188964ab-cfc2-47fc-980e-00e976c6dfb9`, digest `3fbdc510f25fd16716b497484f770b55cc09326e90d7adfd1d79c6dcea57a34f`; Integration `c11ed502-34cd-4f0e-9b7b-cefccf95246f`; four stages passed; matched activation; authenticated desktop browser audit; **2615/2615**. |
| FL-108C1 | Work cards and Goal/Plan/one-off summaries now carry one closed Core-owned narrative meaning plus bounded params. Hub localizes that meaning instead of parsing or displaying Core-authored English; unknown future meanings fail closed while legacy strings remain compatibility evidence. | Codex Luna Max quota Task `3e490326-8049-4df2-aed5-cc1af8ce846a`; Grok Task `eb81711b-9dd3-4fe1-9db2-565ab8f414a7`; corrected revision `ebf31371-edae-4a07-8bda-986b33714688`, digest `d8fe57216b2a962712ee27eac7236cb521fde91c54f51c39e0bf777be27b1923`; Integration `4314975a-6dd0-4a66-a4f5-83e8d78cbb27`; four stages passed; matched activation and authenticated bilingual browser audit; **2618/2618**. |
| FL-108C2 | The default Work story now says what completed, stopped, is waiting, was checked, needs a decision or was safely applied in plain English and Chinese. Distinct lifecycle causes remain intact, shared stopped/waiting actions stay neutral, and generic templates cannot expose raw gate values. | Failed Grok history `c30badf2-0c6d-460f-9710-97c6dbf8d42e`; DeepSeek Flash Task `6b776433-6144-41fb-9ecd-07ef4ee04dd2`; accepted revision `f2c04cfa-6718-4b3c-9394-8751dc715835`, digest `ebbef640d5f91a029bbe5b7eee8994ac7f0b6f408377e1e91029ebd09dd058e6`; Integration `5222e2df-d735-4f9a-ac9d-418fee59f5db`; matched activation and authenticated browser audit; **2619/2619**. |
| FL-108D1 | Task Detail now opens with one four-step Main request -> execution -> independent checks -> final delivery/next-action story. Raw Worker prose and paths are progressive evidence; Checks shows total or failed/total instead of a false zero. | Grok Task `06b1a367-3621-44bc-96d7-dd696ba27051`; revision `c2732343-a4d8-4ea3-833e-fcbff5dc9825`, digest `961662fe02947996c3f3523c8525dda76a74e19b70719e8c8590e9e044c8e2fa`; Grok ACCEPT judge plus unusable quota-blocked Codex judge; Integration `ad77503a-0fbf-4146-8c8d-b872cf9cd02f`; matched activation and authenticated success/failure/progressive-evidence audit; **2626/2626**. |
| FL-108D2 | Task Detail tells the same four-step story without duplicate step numbers or green wording on failed work. Failed checks keep their real check name, and attempt/file counts remain neutral evidence. | Grok Task `78a8b5a7-dad8-4e35-acfd-c5f2a26849c2`; accepted revision `f1bd08e9-a4c8-4bee-929a-7ddd0fdec720`, digest `26e7591c5edd917e28d0bb5f6565cd8bcb12d14605090d2ef41ca54d553b8c7a`; Integration `da45f365-605a-4d02-9088-07800133434e`; four stages, matched activation, authenticated success/failure browser audit; **2637/2637**. |
| FL-111D1 | A real Codex account-quota rejection now stays one truthful budget failure when Codex emits matching `error` and `turn.failed` records. Different terminal evidence still fails closed; Hub tells the user to wait or switch Worker instead of implying Worker settings refill an account. | Grok Task `170851d8-171f-445f-af18-ea06fb84de29`; accepted revision `9857b5de-ed33-401e-a200-14b53ebe2cff`, digest `1e846861817a854f62713592f91f63c6269e038fd0e87355f958b8bb3c53e11e`; Grok ACCEPT judge; one rolled-back infrastructure fluctuation followed by successful Integration `61df6b11-29db-44da-943b-4888d146b3e3`; matched activation; **2633/2633**. |
| FL-109A | Core now provides the single versioned Goal -> Plan -> Task hierarchy that the unified workbench can render without rebuilding lifecycle truth in JavaScript. | Grok Task `feb5fd84-8163-403e-8cf8-51000f547722`; accepted revision `905a8088-0af8-492e-acca-2d66f5191874`, digest `06fd44659c73a58425ff04b3cfb18f3620b6a9d545d0750e1aab601969ae0531`; DeepSeek Review Graph `1ece2e75-b6bb-4435-93ff-ee342ec60638`; Integration `d4a41c40-3962-41a6-aac4-10063575a251`; **2479/2479**. |
| FL-109B | Hub now has one read-only hierarchical Work view: seven execution columns inside expandable Goal and Plan lanes, one-off Tasks, retained hierarchy under filters, and an explanatory Task drawer. Historical internal workspaces are summarized instead of flooding the Project selector. | DeepSeek Tasks `5f89af15-a396-4320-a8cb-d19a0d75d442` and `9fe4dd9a-1da3-4057-b0f8-67e752b04eb6`; Grok correction `541fc790-791a-479e-a3b5-cb9b36f1e2bd`; Integrations `3675679e-bc18-47b7-85c9-4a00004520f1`, `72b73769-619a-423e-8e9e-3f3e1ac7c74d`, and `9a4f47cb-b125-4988-bc6b-98d1219a60fe`; bilingual 1280px/390px browser audit; **2499/2499**. |
| FL-109C1 | Every hierarchy Task card now carries one Core-owned policy for all seven destinations: exact durable operation, fixed Main intent, required input/confirmation, ordered Integration path, automatic-only movement, or a fail-closed no-op explanation. | DeepSeek Flash Task `83941207-e92e-4f18-abd6-9c2e67a5e05c`; corrected revision `88fa16de-7d78-4fd3-8e9d-474c9e750d0e`, digest `1b539262c016d022609952ff0ea7d4b00fdf2c6cbcbd176beef8d1e58ed624b8`; zero-Worker reverify 5/5; Grok ACCEPT graph `46e09ab5-aee5-4bad-887d-667a7d7dc79d`; Integration `d7df0343-feb4-42c4-a415-aea0424bcd2b`; **2515/2515**. |
| FL-109C2A | Every policy-bearing Task card now exposes the same seven-destination Move/Act chooser for pointer, keyboard and touch users. Actionable choices open Task Actions with exact intent and requirements; invalid or automatic choices explain themselves; no browser-side status mutation or optimistic card move exists. | DeepSeek Flash Task `6d508081-235b-453a-a071-11cd025b980b`; corrected revision `e42f6f52-a1bb-40a9-94e6-191c46da0e64`, digest `4b8dcf03c5059d5c9ae22c6ef70658c1c8e7571174ea2a7645b10a88d4515239`; Integration `b07d1246-1321-47f8-a9e5-9da502dcad3d`; bilingual live Hub audit covered all-no-op delivered and actionable Main-review cards; responsive suite passed; **2524/2524**. |
| FL-109C2B | A chosen board destination now leads to the one existing durable Task control, preserves fixed Main intent and required input, keeps Integration preflight/apply as two explicit steps, and refreshes the canonical Task plus hierarchy only after success. Failed requests retain the guided context and never move a card or retry themselves. | DeepSeek Flash Task `87b5ae6c-52e9-4afa-bb9b-275046f64400`; corrected revision `c99aac1f-939d-4687-a3df-e06eeb3a2b93`, digest `0f8d7404bd73396195c65f269a8633574785ed71acbde913ad99b474479d68ac`; Integration `320a0489-30ee-4405-99ff-b9b4d5e22146`; bilingual live Hub audit covered fixed Accept, Integration guidance and resolve-without-default behavior; **2535/2535**. |
| FL-109D1 | A user's desired result can now survive restart as a pending intake without creating work. Any connected Main can explicitly propose Task, Plan or Goal through MCP, backed by the existing validators and a full referenced-artifact digest; the returned confirmation preview remains unexecuted, revision-safe, privacy-safe and bounded. | DeepSeek Flash Task `8497404c-a73e-4df8-b4ef-88a0b555a391`; corrected and zero-Worker-reverified revision `08414092-e515-463f-8599-6c4f5ffb48cd`, digest `3f7ccac0aa01c1b32beaaec5bf92b741dddce607b8cd931fe152370705ab2033`; reverification 4/4 with zero Worker Tokens/model cost; Integration `836b3481-cb9a-43c5-9fce-8391dc008066`; **2555/2555**. |
| FL-109D2 | Work now starts with one calm outcome composer. A recorded intake explicitly says that nothing started, offers only an id-based handoff to Main, and later renders Main's canonical Task/Plan/Goal proposal as a bilingual unconfirmed preview without browser-side classification or work creation. | DeepSeek Flash Task `b863f4cc-97e0-471a-93ea-662a20d7590d`; corrected revision `7b40f633-8ff5-42f8-b5c6-398312c8171b`, digest `50ade22f24aa30bfae94f66ce4dcdd449eb63095bcbfb2f03516d19dfaaef50d`; Integration `bfd06931-f9d2-4649-9cbe-516665c72840`; all source/apply/build/activation stages passed; **full suite passed**. |
| FL-109D3A | A connected Main can explicitly confirm the current proposal once. ForkLight revalidates the complete artifact graph, creates the existing Task/Plan/Goal graph and linked receipt in one transaction, queues only committed Tasks, and returns the same receipt on retry. Created truth advances revision so a stale proposal cannot overwrite it; multiline outcome/context input is accepted safely. | DeepSeek Flash Task `9e34c321-c99f-4eec-a594-f7a2023b61e4`; corrected revision `4afaa218-298f-4f0a-87b2-0b676e3da78c`, digest `294e919055a0b3bbcebe83f8a668efec0167f1ab172ac64f79c6af9e516f123d`; Integration `ff3bf884-526f-4eea-8563-2065bb48d2ba`; all four stages passed; focused, build, full suite and diff checks passed. |
| FL-109D3B | A user can explicitly confirm Main's proposed Task/Plan/Goal from Hub, see canonical created truth and the next action, and then follow the actual work on the existing hierarchy board. The request is single-flight and closed; uncertain failures preserve the proposal and avoid false claims; success never inserts optimistic cards. | DeepSeek Flash Task `f24bd375-57fb-4924-986c-a194c57d3a80`; revision `5df31754-2247-439e-b186-6c65cbcf367d`, digest `216ddd55e61759eb86cfc93b65fcf0d45bd2bf2082110c41007ac6256418bb28`; Integration `a0cf0a0b-658b-4774-b67d-3e22c0f00043`; all four stages passed; focused, build, full suite and diff checks passed. |
| FL-109D4A | The complete shipped Task-shaped outcome path now has one isolated real-stack proof: pending intake creates no work, Main proposes, the user confirms once, canonical One-off work appears, identical confirmation replays without duplication, and receipt/hierarchy truth survives a full temporary restart with zero Provider execution. | DeepSeek Flash Task `d75ebff7-2ab1-4a16-b6a2-e105387f6bb1`; corrected revision `b9fdd925-3b29-4d58-bf07-25aa590e5997`, digest `c8c0c55d04efa0b1cae94e9651d8231a66f50ee92a34befaf0a23a21cd511c38`; Integration `e569f44b-e2b2-4f4d-8c74-d466e9ac4767`; four stages passed; **2591/2591**. |
| FL-109E1 | Hub now opens on Work as the sole default work surface. The primary navigation has one Work entry, old Overview/board/tasks/plans/goals selections converge on Work, and advanced submission plus contextual Task/Plan/Goal details remain reachable. | Grok Task `2f347134-8f85-474b-9e4d-4826537a3b2a`; corrected revision `8ecf7447-065c-4a0f-ac74-0a8636176539`, digest `f926aa1b526b0b252d5976ba5fc23ea614de2e1fd1863a6a40a4f7885ee92136`; Integration `d732da73-2e6c-44de-8214-b698ad135641` truthfully retained source after the self-restart acknowledgement failed; current CLI/Daemon identity then matched and Main remediation check `0691f877-ce0c-4a49-b3f1-3472d651659c` passed 4/4; static UI detector returned no findings; **2592/2592**. |
| FL-111A | Codex single-run and native Goal prompts now match the real Codex command-tool surface: product work is allowed only through read-only/workspace-write inside the isolated Task boundary, command network is explicitly off, global `/tmp` is excluded, task-private temp remains available, and approval/add-dir/full-access/web/apps/MCP/nested-agent expansion stays denied. Claude and Grok keep their no-unrestricted-shell default. | Grok Task `f9347dbc-74a7-49a3-9b88-b6d99b025eac`; corrected revision `3c311f6c-e541-4a4a-978d-c2bc507b51e1`, digest `a93a6f3498c571834ca3a574f5e258c2f308d89ebcc8ebef020a41875c76ad88`; unusable DeepSeek judge schema violation retained without retry; Integration `5510b6ff-8ec6-4641-9d2d-d74de1d41902` passed all four stages; **2597/2597**. Real Luna Max single-run Task `4a754967-22e6-4a7f-a4b5-de1ad0556851` then produced an exact one-file/one-line Candidate and passed independent checks. Its complete Worker volume was 77,517 Tokens; direct-Main baseline is missing, so no savings claim is made. |
| FL-111B | Real Codex Luna Max single-run and native Goal both make an exact isolated edit. Native Goal now projects command/file/diff work into bounded privacy-safe progress, drops raw message deltas before race buffers, treats status/usage/plan/unknown traffic as bounded liveness, and lets only concrete work or terminal evidence refresh the active watchdog. | Native Goal Task `e8185716-3b8e-4cbc-b84a-36099f189aec`; Grok Task `0116290b-db10-4ddf-a0e1-aed1fe92b477`; corrected revision `cfa220bc-d9e6-43f0-8a65-33a408e9964f`, digest `4df40ef5ebe430cb53dcf9da4f6269195928dc5bd0f3726dc78d76bca00b7505`; Codex Luna Max Judge `e29ce442-787d-48f7-afec-d423849a60df` ACCEPT; Integration `7fc35d05-df39-4199-8abf-2252273f1aa0` passed all four stages; **2603/2603**. Native Goal Worker volume was 116,977 Tokens and Judge volume was 538,468 Tokens; both lack an exact direct-Main baseline, so no savings claim is made. |
| FL-111C | ForkLight can finish a self-upgrade handoff without asking the old Daemon to acknowledge its own death: restart authority is validated first, the replacement inherits no consumed handoff context, one active Task resumes through one linked recovery Attempt, and exact identity becomes current. | Grok Tasks `a3c10fa2-0e35-49aa-809a-a50b8bb36242` and `60548e87-7c62-4cca-9077-81531768fc20`; retained working revision `28c911d4-9b50-4344-bc2a-8b4ac34c94e0`, digest `3cd9de1fe7d7693fc394ffd94bc5be98b2e1b3e8ec57ad59376d3ecfa43de9ef`; finite Main test repair; Main-remediation check `dff3e9d9-c889-4632-a0ed-20c7ea157fd4` passed 4/4; focused **56/56**, full suite **2608/2608**, matched activation identity. Worker failure history is preserved; no successful Integration is invented. Codex Luna Max Task `8db71792-850c-4df5-84a9-b10125569583` was quota-blocked before implementation and is not model-quality evidence. |
| FL-109E2 | A Goal milestone completed under its configured machine, Main-accept or Integration gate now appears complete in that Goal's Plan lane without hiding the underlying Task status, decision or repair facts. Effective handoff successors still fail closed; independent Plans and one-offs are unchanged. | DeepSeek Flash Task `bb7e9840-e332-47f5-9a75-021ef2b8aa10`; corrected revision `50365417-86ca-42e9-8277-8b4196469edb`, digest `c231677ade9abab5221ac5b15010a9f3f6bbae71bbd7408a0ec86083be6a7172`; Grok Review Graph `7a7610d5-faf1-4315-9b78-8cc558f92d01`; Main-remediation check `2297f43d-8144-401c-99d8-6f99efc2f0a6`; real Goal and Plan both 4/4; **2610/2610**. No Integration is invented. |

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

Every action must close a named milestone gap. `Now` is intentionally short.
Each iteration plan ends with the already-selected next Task and automatically
starts it after the current checkpoint; pause only for a real user decision,
new authority, or a safety/coordination boundary.

### Now

| ID | Owner | State | Action | Done when |
| --- | --- | --- | --- | --- |
| FL-110 | Grok 4.5 + Main | Waiting for user auth (`c2c5c237-50d2-4b0b-895c-a109a89c402e`) | The 14-file Candidate is retained. Its first verification found one forbidden punctuation mark and one unused test binding; the single correction then stopped before model work because the operator Grok OAuth expired and its refresh token was rejected. Re-authenticate Grok once, then resume the bounded correction without relabelling it as model failure. | Focused/full verification passes on the retained implementation, Main accepts and safely integrates it, then automatically starts the live dogfood proof. |

### Next

| ID | Milestone | Action | Exit evidence |
| --- | --- | --- | --- |
| FL-101 | M3 | Accumulate natural same-scope evidence and form the first fair comparable cohort; improve recommendations only where the cohort supports it. The 2026-08-04 routing check for `self-upgrade-activation-handoff-continuity` returned 0 comparable candidates across Grok, DeepSeek Flash and Codex Luna, so no replay was authorized. | At least one comparable exact-class or family cohort; plain-language recommendation and override path verified. |
| FL-102 | M1 | Run the clean-user protocol on a new macOS account, disposable VM, or new Mac with an unfamiliar user. | Complete worksheet, timing, interventions, comprehension, reviewed delivery, and restart evidence. |
| FL-110P | M2/M3 | Dogfood ordinary-Task handoff on a controlled ForkLight-only Candidate, with Grok as source or implementer and DeepSeek Flash as the distinct successor while Codex quota remains unavailable. | Exact source revision and approved reusable paths create one successor; replay creates none; successor reruns full acceptance; source stays unchanged and no obsolete patch is integrated. |

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
| FL-108A Worker-card story is integrated and independently accepted | Candidate `80a8bdf4-d022-4aff-9a23-f2c79340baac`, digest `d1e255f481e5d4d7d05982685e674be6bc3a585d4c3254dd22d80623d6d2b9e0`; Integration `5b30015a-2fdc-444f-a34e-105f8926e8bf`; Grok read-only ACCEPT `bcad11fd-3b7d-4bbf-8fea-5b5fa58824a8`; Review Graph failure `bb160cd6-6de2-4b72-ad14-a7134531ca84` retained as FL-107B infrastructure evidence |
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
   Git and Store preserve history. Keep the next selected Task as the final plan
   step and start it automatically after the checkpoint unless a user decision,
   authority expansion, or safety/coordination boundary requires a pause.
6. A Worker or automated process may propose an update, but Main verifies the
   source facts and owns the edit to this file.
7. If this file grows beyond roughly 500 lines, compress it. Do not solve
   ambiguity by creating another status, roadmap, dogfood, or progress file.
