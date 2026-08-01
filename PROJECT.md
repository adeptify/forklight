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
8. **Current development routing.** DeepSeek v4 Flash/Pro, Grok 4.5, GLM 5.2,
   and Codex may be used according to the task. MiniMax remains supported by the
   product but is not used for current ForkLight development. Codex/Main owns
   visual and interaction judgment; a Worker receives an explicit UI contract.
9. **Codex is also a first-class Worker target.** ForkLight will add a
   `codex-cli` Worker Runtime alongside `claude-code` and `grok-build`. A saved
   Worker selects an explicit Codex model and a model-supported reasoning
   effort; both are frozen into the Task identity and remain distinct from the
   Main session's model and effort. Runtime support must preserve the same
   isolation, finite execution, independent verification, and Main authority as
   every other Worker.
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

## Milestone roadmap

| Milestone | User capability | Current status | Exit gap |
| --- | --- | --- | --- |
| **M0 — trustworthy self-upgrade** | ForkLight can safely deliver and activate its own changes without lying about partial success. | **Open: 1/3 consecutive proofs** | Two more user-value Integrations must complete apply -> source verification -> build -> activation -> identity check, with one Daemon and one current Hub. |
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
- Daemon: healthy after the FL-002 rebuild/restart.
- Hub: **not currently running**; `hub status` reports the recorded owner is
  gone and the safe next action is `forklight hub`.
- M0: `achieved=1`, `remaining=2`, `breakCategory=rolled-back`.
- M3 coverage: `342 terminal / 228 class / 110 family / 57 complete`, across
  186 task classes and 28 families. Decision readiness is `14 single / 0 fair
  comparable / 43 unknown multi / 0 unusable`.
- M4 direct-Main paired evidence: 2 low-confidence samples across 2 classes and
  2 Profiles; not enough for a general savings claim.
- Repository verification after FL-002: build plus **2,285/2,285**
  tests passed; `git diff --check` passed; package dry-run includes `PROJECT.md`.
- The long-term Codex Goal is active with the exact `Long-term Goal` objective.
  FL-001 and FL-002 are complete. FL-002 used a recorded `workers-unavailable`
  Main-direct recovery only after both selected Worker paths ended before a
  Candidate; the recovery was independently checked and the Daemon restarted.
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
   lacked `node`/`npm`. The rollback is why the honest M0 streak is 1/3.

### Accepted capability: Codex as a Worker Runtime

This is an implementation requirement, not a claim that support already exists.

- **Configuration input:** one saved Worker Profile selects
  `runtime=codex-cli`, an explicit Codex model, and one effort supported by that
  model. Hub discovers valid combinations from the local Codex catalog instead
  of maintaining a guessed global effort list. Unsupported combinations fail
  before Task creation; there is no silent fallback.
- **Execution input:** ForkLight passes the bounded Task Contract to a fresh,
  non-interactive `codex exec --json` session in the isolated Worker workspace.
  Main's conversation, model, effort, and mutable user configuration do not
  leak into the Worker identity.
- **Execution output:** a Codex Runtime adapter normalizes JSONL progress,
  terminal result, session identity, usage, interruption, and failure into the
  same ForkLight Attempt/Event/Candidate contracts used by other Runtimes.
  Missing usage or cost remains unavailable rather than inferred.
- **Isolation boundary:** Codex receives only the Task workspace and the minimum
  authentication/runtime material proven necessary. User plugins, MCP servers,
  hooks, web access, nested agents, and broader filesystem access are disabled
  unless a focused safety spike proves an equivalent bounded policy. In
  particular, `ultra` effort is not enabled while its automatic delegation
  behavior cannot be accounted for by ForkLight concurrency and evidence.
- **Control boundary:** ForkLight owns duration/no-progress termination,
  Profile/global concurrency, verification, Candidate capture, and recovery.
  Codex never writes the original project, reviews itself as Main, integrates,
  commits, or pushes.
- **Continuation:** Runtime session resume is allowed only when bound to the
  same Task/Attempt lineage and exact isolated workspace. It is not a hidden
  retry or a way around correction limits.
- **Acceptance:** CLI, MCP, Hub, Settings, doctor/readiness, routing identity,
  Task Detail, restart recovery, usage evidence, and bilingual explanations all
  agree. At least two saved Codex Worker Profiles with different valid
  model/effort combinations must reach real responses and preserve the exact
  requested identities.

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
| FL-004 | Main + selected Worker | **Priority: next implementation** | Add `codex-cli` as a first-class Worker Runtime with saved Profile-level model and effort selection. First ship the minimum complete path: discover a valid local model/effort pair, save it, launch one isolated non-interactive Worker, normalize progress/result/usage, independently verify it, and expose understandable readiness and Task Detail. Then add restart/resume hardening and a second real model/effort Profile. | Codex Runtime passes the accepted-capability contract above; two real model/effort Profiles preserve exact identity; post-activation identity and single-process checks pass. Useful Candidate Integrations count honestly toward the two remaining M0 proofs. |
| FL-003 | Main | Pending the first Codex Runtime path | Resolve the retained Profile-slot slice using the new attribution truth, review the actual local diff, and choose one honest delivery path. | Source and machine evidence agree; no unrelated timing failure is called model failure; no duplicate Worker run; accepted work is either safely integrated or explicitly left undelivered. |

### Next

| ID | Milestone | Action | Exit evidence |
| --- | --- | --- | --- |
| FL-101 | M3 | Accumulate natural same-scope evidence and form the first fair comparable cohort; improve recommendations only where the cohort supports it. | At least one comparable exact-class or family cohort; plain-language recommendation and override path verified. |
| FL-102 | M1 | Run the clean-user protocol on a new macOS account, disposable VM, or new Mac with an unfamiliar user. | Complete worksheet, timing, interventions, comprehension, reviewed delivery, and restart evidence. |
| FL-103 | M3/UX | Continue Hub information architecture cleanup around Now/History, Task input/output, failure cause, retained work, and next action. | Real bilingual browser audit at desktop and narrow width; user story is clear before technical evidence is expanded. |

### Later

| ID | Milestone | Action | Exit evidence |
| --- | --- | --- | --- |
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
| M0 is 1/3 | `forklight upgrade status --required 3`; rollback `c2cf0838-d0b0-4e7b-a6e4-c6a7cf313723`; qualifying Integration `01e1c560-ebe9-40a5-9afe-2ac0036f230f` |
| M1 Worker paths and first delivery work locally | Task `bfe223ac-feb2-422e-8f5b-418eef919308`; `docs/m1-daily-assistant-acceptance.md` |
| M1 real-project portfolio is 13/10 | `docs/m1-real-task-portfolio.md` |
| M1 clean-user gate remains open | `docs/m1-clean-user-runbook.md` |
| M2 durable Goals | Relay history Goal `examples/dogfood/relay-gmail-history-goal.json` 5/5; four-Task restart Goal 4/4 |
| M2 cross-Worker handoff | `decbae4e-4ac8-48c3-a5d2-78801662ccb4` -> `dd837113-bb99-4557-b5ae-c08fc9881549`; restart path `0d829248-7cbc-4f10-83d8-afb3531b31f2` -> `9c69323e-af1c-43de-afb5-59129904dadf` |
| Profile slot release | Task `e6294b47-b652-4538-ae37-a3bef793f2ff`; `docs/m3-profile-worker-slot-release-contract.md` |
| Failure-attribution first attempt is Runtime failure | Task `8a542f9e-6867-4f30-8cdc-09d88418a155`; Attempt `54f64a40-c9a9-402a-9f1a-4e039503868d`; `docs/m3-main-failure-attribution-contract.md` |
| Failure-attribution replacement is also pre-Candidate Runtime failure | Task `9f6f882d-9d2e-4355-8152-0ba8fcbfad5d`; Attempt `7d7c9857-c645-4996-a104-3cae8295da13`; empty Diff; `/tmp/claude-501` EPERM under canonical `/private/tmp` sandbox allowlist |
| Exact failure attribution is operational | Main-direct record `31e274af-a8fd-4e9a-831c-cafed965413c`; Task `e6294b47-b652-4538-ae37-a3bef793f2ff` events `1389` and `1390`; identical replay of event `1390` returned `existing=true`; Task remains failed; full suite 2,285/2,285 |
| Codex Worker Runtime is feasible but not implemented | Local `codex-cli 0.146.0`; `codex exec` exposes non-interactive JSONL, model selection, and resume; per-run config supports `model_reasoning_effort`; bundled catalog reports model-specific effort sets |
| M3 coverage | `routing_evidence_coverage` from the build-matched Daemon: 342/228/110/57 and 0 comparable |
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
