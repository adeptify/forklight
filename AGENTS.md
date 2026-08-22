# ForkLight project instructions

## Authority and current goal

- Read `goals/forklight-main-led-execution/contract.md`, `plan.md`, `progress.md`, and
  `decisions.md` before meaningful work. This directory is the only current project-management
  source. The archived M1 Goal is historical evidence, not a second roadmap.
- Reconcile written progress with Git, Store, build, Daemon and CLI/API truth at stable
  checkpoints. Update the existing SSOT; do not create parallel status logs or roadmaps.
- The project is complete only when M2–M5 graduate. Existing code is reusable foundation, not
  proof that a capability has graduated.

## Select work that moves the milestone

- Work only on a current Milestone gap, its exit evidence, or a blocker to either. A useful change
  must alter user-visible capability, close an acceptance gap, or produce required graduation
  evidence.
- Do not create work merely to increase test counts, generate dogfood, improve model statistics,
  prove ForkLight can use ForkLight, polish a non-blocking edge, or perfect an internal abstraction.
- Record a non-blocking finding once in `progress.md` under Later. Do not create a Task for it
  unless Main explicitly promotes it or it becomes a Milestone blocker.
- Reuse existing behavior and evidence. Do not rebuild or repeatedly re-prove a graduated slice.

## Optimize for one local developer

- ForkLight currently serves one local developer. Do not design for teams, organizations,
  distributed coordination, simultaneous human editors, cloud synchronization or cross-node
  consensus unless 一骏 explicitly changes the product scope.
- Do not add checksums, content-addressed manifests, locks, leases, version handshakes or duplicate
  validation merely to coordinate Agents in one local checkout. Simple path ownership, current
  Store state and serial Main Integration are the default.
- Keep only the smallest check that prevents a concrete failure: corrupted durable data, an
  unreadable protocol/schema, a Candidate built from the wrong source base, or an unsafe
  Integration. Every new integrity/version check must name that failure and have a focused test;
  otherwise omit it.

## Plan orthogonal Work Items

- `Work Item` is a planning term mapped onto existing Plan/Task records; do not add a parallel
  product entity without a new confirmed requirement.
- At the start of a Milestone, Main defines Work Items with: user result, background, `depends_on`,
  inputs, outputs, allowed paths, forbidden paths, acceptance, verification, handoff, and workspace
  disposition.
- Work Items may run in the same wave only when their interfaces are stable, their writable paths
  do not overlap, and each has an independent validation surface. Shared files or hidden ordering
  make them serial.
- Run at most three orthogonal implementation Writers in parallel. Use an additional slot only for
  a read-only Reviewer/Judge. Main reviews and integrates Candidates serially.
- After a Candidate is integrated and checked, Main may automatically start the next ready wave
  inside the same Milestone. Crossing a Milestone waits for 一骏's confirmation.

## Dogfood ForkLight and prefer Grok

### Current user override (2026-08-22)

- 一骏 explicitly requires subsequent ForkLight repository implementation and review to be done
  directly by Main. Do not launch ForkLight Workers, Judges, Competitions, correction Tasks or
  ForkLight Integration for repository work unless 一骏 explicitly reverses this instruction.
- ForkLight remains the product under test. Main may build it, run its CLI, start/restart the local
  Daemon or Hub and inspect durable product truth for direct verification. This override changes
  the development orchestration method, not the product's runtime behavior or safety boundaries.
- The override supersedes the Worker/Judge/dogfood requirements below wherever they prescribe how
  repository implementation is executed. Their product design and historical evidence remain
  valid.

- Meaningful ForkLight implementation or review must use ForkLight for a real bounded slice.
  Run `forklight health --json` first; a ceremonial documentation Task does not satisfy dogfood.
- Prefer the `grok-build` profile using `grok-4.6` and `xhigh` after a current smoke proves it
  launchable. Use another healthy Runtime when Grok is unavailable or evidence shows a better fit;
  do not repeatedly probe a known unavailable Provider.
- Grok currently runs as a persistent resumable Session under a ForkLight Goal contract. Record
  `persistent-session` honestly. Use `native-goal` only after ForkLight can prove the Runtime's
  Goal identity, state transitions, terminal condition and resume behavior.
- A Worker edits only its isolated Workspace. It never writes the source project directly and
  never commits, pushes, opens a PR, changes remotes or handles Provider credentials.

## Quality chain and Worker review

- The execution Worker owns research, implementation, self-check and evidence-based correction.
  ForkLight independently runs the approved acceptance commands; Worker claims are not sufficient.
- Small mechanical work with complete deterministic checks may skip a Judge with a recorded
  reason. Meaningful ordinary delivery defaults to one independent read-only Judge. Core runtime,
  recovery, concurrency, security, Integration and Token-accounting work defaults to two. Use at
  most three only for a real unresolved disagreement.
- Judges inspect the approved contract, scoped Candidate and verification evidence. They do not
  edit, converse with each other, vote away a contract, or authorize Integration. Main resolves
  disagreements and owns the final decision.
- Prefer returning verified gaps to the same Worker while reusing accepted paths. Handoff to a new
  Worker only when the remaining boundary is explicit. Never restart the whole Task because one
  part failed when durable partial output is usable.

## Continue by evidence, stop before loops

- Repair counts, Attempts, duration, Token, file count and changed lines are configurable safety
  controls, not one project-wide completion rule. Development file/line limits should warn unless
  a Work Item states a real hard boundary.
- Development Work Items default to no absolute wall-clock deadline and no Token ceiling. Add one
  only for a named cost, Provider, or runaway-process failure with a focused verification case;
  never use elapsed time as evidence that a Goal is complete or failed.
- A Main wait, poll, transport, or console timeout ends only that observation request. It must not
  cancel, fail, recreate, reroute, or widen a still-running Task. Resume observation from durable
  Task/Attempt events instead of tightening Worker limits to fit an orchestration call window.
- Acceptance-command timeouts must fit the approved command's real worst case. ForkLight's local
  development setting is 30 minutes per command; a timeout remains a command safety breaker, not
  a Milestone deadline.
- Continue while each round produces effective progress and stays inside the accepted Spec.
  Effective progress means a completed acceptance item, usable artifact, narrower failure,
  newly passing behavior, or a proven external blocker—not more logs, tests or rewriting alone.
- Stop automatic iteration when acceptance passes; when two purposeful rounds repeat the same
  failure or add no material evidence; when patches compensate for prior patches; when the Spec
  boundary must expand; or when source drift invalidates the Candidate.
- At a stop, return a decision packet: completed output, reusable paths, remaining gaps, exact
  evidence, attempted remedies, workspace disposition and the decision Main must make. Do not
  automatically switch models, recreate the Task, add Judges, start Competition or widen scope.

## Decide what belongs in ForkLight

- Add behavior to the product when it is cross-project, understandable to a user, has explicit
  inputs/outputs and durable truth, is configurable where scenarios differ, and is required by the
  current Milestone or has appeared in at least two real cases.
- Product capabilities include truthful Runtime strategy and continuation, dependency waves,
  independent review policy, decision packets, partial-result reuse and handoff, safe Integration,
  Task workspace lifecycle, evidence-driven routing, and transparent value reporting.
- Project-only choices belong elsewhere: Grok-first preference in Worker Profiles; development
  workflow in this file; one-off cleanup or recovery in Evidence; current sequencing in `plan.md`.
- Do not productize ceremonial self-proof, parallel status systems, unrestricted Worker dialogue,
  automatic Competition/retry loops, general distributed coordination, multi-user consistency,
  checksum/version handshakes without a concrete integrity risk, or a new Work Item model.

## Storage lifecycle

- Protect the full Workspace for running, verifying, under-review, unresolved or reusable-partial
  Tasks. Never delete an artifact before Candidate and handoff evidence are durable.
- After terminal disposition, retain the minimal durable record needed for audit, routing and
  Main-Token evidence; reclaim regenerable Workspace, baseline, Runtime Home, caches and orphan
  processes according to the accepted retention policy.
- Destructive historical cleanup requires an exact preview, integrity check and explicit approval.
  Ordinary terminal-workspace reclamation must be an auditable product path, not manual archaeology.

## Verification, integration and publication

- Every Work Item has one accepted Spec or Work Order; do not create a duplicate specification.
  Update it before continuing if evidence changes the boundary or acceptance.
- Run focused static/build checks and affected tests during a Work Item. Run `npm run check` for a
  high-risk Integration and at every Milestone boundary; do not rerun the full suite only to report
  activity.
- Main inspects the actual diff, error paths, compatibility, test meaning and Candidate provenance
  before Integration. Integrate only through ForkLight's safe preflight/apply path when available.
- Preserve unrelated worktree changes. Never reset or overwrite them. Commit and push require
  一骏's separate explicit approval.

## Reporting

- Report only at: preflight/blocker, first verifiable slice, ready for Main review, and final
  handoff or Milestone boundary. Do not interrupt for unchanged status.
- Lead with what is now true, then evidence, remaining risk and next ready Work Item. Use plain
  language; raw IDs, logs and Token details are supporting evidence, not the story.
