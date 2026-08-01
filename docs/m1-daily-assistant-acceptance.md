# M1 daily-assistant acceptance

> Supporting acceptance evidence, not current project status. The authoritative
> Goal, milestone state, and action items live in [`PROJECT.md`](../PROJECT.md).

Last updated: 2026-07-28

This is the product gate for moving ForkLight from an engineering Alpha to a
tool that one person can use every day. It is evidence-oriented: a feature or
unit test is not enough unless the complete user journey is proven.

## What M1 gives the user

A user can open one Hub, configure a real Worker, connect one Main, run and
understand a first Task, and later ask the Main to complete real project work.
They do not need to edit ForkLight state, client JSON, or a Task YAML file for
the guided first run.

M1 closes only after all three gates pass:

1. **M1.2 — real Worker paths (complete):** DeepSeek, MiniMax, Volcengine GLM,
   and Grok each reached a real model response through an explicitly selected
   saved Worker.
2. **M1.3 — clean-environment journey:** a new local user reaches the reviewed
   first Task in about 15 minutes without internal ForkLight knowledge.
3. **M1.4 — daily project evidence (portfolio complete):** at least ten
   representative, non-demo outcomes across the user's currently active projects
   reach truthful final delivery without manual database or internal
   configuration edits. Relay and Elsewhere currently prove **13/10**; this does
   not replace the separate clean-environment gate.

## Current clean-environment evidence

| Journey step | Current evidence | Disposition |
| --- | --- | --- |
| Install package and open one Hub | `npm run bundle:clean -- --output <new-dir>` produces a frozen external `bundle-evidence.json` naming the exact tarball and SHA, with full prepack, isolated-prefix install, CLI/MCP load, exact installed build-identity match, isolated Hub/daemon lifecycle, sensitive-filename scan, and honest clean-user limitations | Repeatable package verification is checked in; new-user timing and Hub journey remain |
| Detect prerequisites | SetupService and Hub status tests | Implemented |
| Save a Provider key | Hub Keychain route, rollback tests, exact discarded-output launch read, content-free argv, future-readable Keychain ACL, and a controlled Daemon restart reading all three existing items | Current-machine persistence verified; clean-user entry and prompt comprehension remain |
| Create a saved Worker and preview effective policy | Hub form, canonical Worker Profile, readiness and admission preview tests | Implemented |
| Install ForkLight into a Main | Main installer, backup and status tests | Implemented; clean-user Main restart still needs journey evidence |
| Run a first Task without knowing YAML | Hub prepares an opaque packaged checkout sample, previews the selected Worker, and bound-submits once | Implemented and proved on the current machine; clean-user timing remains |
| Understand the first Task | Guided sample hands off to ordinary Task Detail; journey fixtures and real bilingual checks remain authoritative | Implemented; clean-user comprehension observation remains |
| Main review and safe Integration | Task `bfe223ac-feb2-422e-8f5b-418eef919308` passed independent checks, Main accept, source apply, and source re-verification | Current-machine path proved; clean-user journey remains |

The product path now covers the complete first-Task outcome on the current
machine. It still cannot be called a clean out-of-box proof until the protocol
below is completed by a new macOS user, disposable VM, or new Mac.

The first 2026-07-28 runtime handoff reported the three historical DeepSeek,
MiniMax, and Volcengine Keychain items as unreadable even though a content-free
shell check could read the same account/service identities. A controlled
restart then replaced Daemon PID `9154` with PID `22542`; the new Daemon marked
all three exact API-key paths launchable while CLI, Daemon, and Hub kept the
same build identity. No credential was re-entered and no Provider request was
made. This proves current-machine restart persistence and shows that the
earlier result was stale Daemon readiness, not missing Keychain data. It does
not replace clean-user key-entry, permission-prompt, or comprehension evidence.

A real bilingual Hub read during the first unavailable state confirmed that the
UI truthfully said **Cannot start / 无法开始**, explained missing local
authentication, and gave one next action instead of inventing readiness. That is
historical presentation evidence, not the current credential state. After the
controlled restart, build-matched Daemon health marks the exact DeepSeek,
MiniMax, Volcengine, and Grok Worker paths launchable while keeping remote
connection evidence stale or unverified. No setting, Probe, Task, or Provider
request was created during either audit.

The current-machine browser audit also proves that source-only delivery is not
presented as runtime activation. A Task whose source apply and source
verification passed while runtime activation is not applicable is shown as
**Delivered / 已交付**, with a direct explanation that no runtime activation
step was required. Only explicit `runtime-activated: passed` evidence can use
the stronger activated state.

## Guided first Task (implemented; clean-run pending)

Hub now exposes one explicit **Run your first real Task** action after Model,
Worker, Main, and task-service readiness are true.

The sample path must:

- use a packaged, deterministic sample project and Task Contract;
- resolve the user's selected saved Worker instead of hard-coding DeepSeek,
  a model id, budget, duration, file count, or retry policy;
- show the same effective Worker/policy preview and require explicit Task-start
  confirmation;
- create one ordinary Task through the canonical daemon submission path;
- never copy a Provider key, endpoint, Main prompt, or private user path into
  the sample project, Task presentation, or logs;
- let the user watch execution, open Task Detail, see input/process/output,
  understand a failure, record Main review, and safely apply the accepted patch
  to the disposable sample project;
- support retry only through the ordinary explicit bounded policies; the
  onboarding UI must not add its own retry loop;
- leave a recoverable sample directory and offer a separate explicit cleanup
  action rather than deleting user evidence automatically.

`fixtures/checkout` is the deterministic behavior fixture and is explicitly
included beside `examples/` in the package manifest. The Hub-generated Task,
not `examples/deepseek-checkout.yaml`, is the guided path: it records only the
selected saved Worker and lets canonical resolution snapshot the effective
model, runtime, limits, and provenance.

## Clean-run protocol

The operator-facing procedure and evidence worksheet are recorded in
[`m1-clean-user-runbook.md`](./m1-clean-user-runbook.md). It does not create a
macOS account, expose credentials, or add a second onboarding path; it exercises
the shipped Hub journey and records where a new user actually needs help.

The exit run must use a new macOS user, disposable VM, or genuinely new Mac.
Changing only `FORKLIGHT_HOME` is insufficient because Keychain services and
Main-client configuration live outside that directory and can make an
apparently clean run inherit prior authentication.

Record these checkpoints from one uninterrupted user journey:

| Checkpoint | Required evidence |
| --- | --- |
| Start | No ForkLight state, no ForkLight Main integration, and no matching Provider Keychain item |
| Package usable | Installed version/build identity and elapsed time |
| Hub open | One authenticated loopback Hub owner and one task service, with no duplicate listener |
| Authentication usable | Saved Worker preflight proves the exact auth path is readable; Provider connectivity remains a separate fact |
| Worker selected | Saved profile, model, runtime, effort, effective policy and provenance match preview |
| Main connected | One chosen Main reports the current ForkLight MCP build in a newly opened session |
| Sample submitted | User starts it from Hub without authoring or editing YAML/JSON |
| Task understood | User can state what Main asked, what Worker did, current/final result, failure or verification reason, retained output, and next action |
| Reviewed delivery | Independent acceptance passes, Main decision is recorded, and accepted sample patch is safely integrated |
| Recovery | Closing/reopening Hub or restarting the Main does not lose Task continuity |
| Finish | Elapsed time and every manual intervention are recorded; no hidden database/config edits occurred |

Target timing remains:

- Hub + usable Worker + current Main connection: about **15 minutes**.
- First independently verified sample Task: about **30 minutes**, including
  Provider/model setup time.

Timing is evidence, not a hard execution cutoff. Quality and truthful recovery
remain more important than forcing a slow first run to fail at minute 15.

## M1.4 real-task portfolio

The authoritative inventory and per-result evidence are recorded in
[`m1-real-task-portfolio.md`](./m1-real-task-portfolio.md). The latest user
direction replaces the historical fixed Adeptify/Dia/NovelRPGPlay split: natural
real work may come from Relay, Elsewhere, Collision, Museum, Adeptify, or Dia;
NovelRPGPlay is not mandatory.

The strict result count is now **13/10**:

- Relay Gmail production readiness: **4** delivered outcomes;
- Relay Gmail durable incremental sync: **5** delivered outcomes;
- Elsewhere experience redesign M0–M1: **4** delivered outcomes.

One Goal milestone counts once only when it produces a distinct user result and
its delivery gate is satisfied. Attempts, corrections, handoffs, reviews, and
reverifications do not create extra portfolio entries. Eleven results have an
exact accepted-Candidate Integration. Two retain failed machine Task records but
have explicit Goal delivery evidence after Main repair: one against the original
acceptance contract and one against formally amended acceptance. They are counted
as delivered results, not mislabeled as successful Worker Tasks.

The portfolio spans interaction/UI, domain behavior, provider integration,
transactional recovery, restart durability, failure preservation, onboarding,
and documentation. Every result retains its original machine truth, Main
decision, delivery basis, and next action. No additional Worker Task should be
started merely to increase this count.

M1 as a whole remains open because M1.3 still needs one independent new macOS
user, disposable VM, or genuinely new Mac to complete the install → configure →
first Task → understand → review → integrate → restart journey. A repeat on the
development account or another synthetic bundle is not that proof.
