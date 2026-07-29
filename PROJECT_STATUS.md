# ForkLight Project Status

Last updated: 2026-07-29

## Product boundary

ForkLight is the local execution, safety, and observability layer for bounded
external coding Workers. A **Main** agent (Codex, Claude Code, Grok Build,
OpenCode, or a human on CLI) remains accountable for intent, Task Contract
quality, independent review, user authorization, and the decision to integrate.

A Worker never receives arbitrary Shell, web, original-project write, Git
commit, or push authority.

**Control UI:** `forklight hub` is the only browser control center (configure +
operate). Standalone Console and Setup UIs were removed.

**Reading rule:** the current milestone, roadmap, and `Next engineering`
sections are the authoritative present-tense plan. Later chronological dogfood
sections preserve what was true at that point in time; an older entry saying a
gate was still open is historical evidence, not the current milestone state.

## Current milestone: M1 — daily personal execution assistant

ForkLight is now an **engineering Alpha** rather than a concept prototype. The
core `one Main → bounded Workers → independent verification → Main review →
safe Integration` loop is real and has been dogfooded with DeepSeek Pro,
MiniMax-M3, Volcengine GLM and Grok 4.5. M1 continues with the clean-user
journey and representative M1.4 Tasks. The automatic M0 upgrade chain remains
proved. After every self-build, a long-lived Main must still re-check its MCP
identity before mutation; the matched CLI remains the safe fallback while a
client reload is pending.

**Latest runtime truth (2026-07-29):** the current source, built CLI, formal
Daemon PID `37797`, and Hub PID `39681` use build
`b7561b77575b9fe23050639170df7e842b6fd4275413a981b9336c983cb1d08e`.
The Hub is `current` on the sole listener `127.0.0.1:62302`; the Daemon has no
active or queued Task, defaults to `grok-build`, and inherited the names
`HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` without exposing their values. This
closes the measured TUI/Daemon environment mismatch for the current process.
It does not promise that a future restart will inherit the same environment;
future connectivity failures must be classified and explained rather than
blindly retried.

**Historical reload truth (2026-07-29):** the final clean-run pack rebuilt ForkLight
to `7426d0f154901f14b61cc7073afe853040734b561161cdf617b0bdc086b6c684`.
The built CLI, formal Daemon PID `48999`, and Hub PID `49395` on port `64920`
use that build and have no active or queued Task. This loaded Main task's MCP
still reports the pre-pack build
`da669a7baf2f02d8ec8de392b0b747247f96a762805d1ecb157bf159aa13c143`
and correctly reports `build-mismatch`. All Relay R8 validation, submission,
review, correction, and Integration mutations therefore used the matched CLI;
the stale MCP was used only for read-only health/eligibility. A Codex App-level
reload or restart is required before the next MCP mutation. This is an active
operational M0 guard, not a fabricated Task failure; no old MCP was killed in
turn and no commit or push was performed.

**M0 reload closure (2026-07-29):** restarting the Codex App created fresh MCP
connections. A read-only MCP health call, the built CLI, and the formal Daemon
now all report build
`da669a7baf2f02d8ec8de392b0b747247f96a762805d1ecb157bf159aa13c143`
and source digest
`4020d27f518e64de75e7c0f202d65be6baca97bcceb969c1746ad83138d1503a`;
identity is `matched`, Daemon PID `4851` is the only formal Daemon, and it has
no active or queued Task. The App restart removed the old Hub owner. Main then
started one current Hub, PID `56042`, on the sole listener
`127.0.0.1:51543`; the old `56069` listener is gone.

The final ownership audit also found three Grok-owned MCP children that
predated the current build. Main terminated only exact PIDs `5795`, `6562`, and
`25826`, preserving Grok Main PID `23702`; Grok immediately recreated fresh MCP
children `56325`, `56326`, and `56331`. Codex's MCP children were all created
after the App restart. Multiple MCP processes are valid when multiple Main
tasks are loaded, including two loaded tasks with the same filesystem cwd. The
single-instance rule is therefore **one MCP connection per loaded Main task**,
not one MCP per workspace directory; the global singleton rules remain one
formal Daemon and one Hub owner/listener. The earlier failed in-turn SIGTERM
experiment remains useful evidence that an App/config reload is required, but
the operational gate is now closed. No commit or push has been performed.

**M0 residual (honest, 2026-07-28):** activation handoff, PID/endpoint
ownership, one-use authorization, Unix-socket drain/replacement, and one-Hub-
per-home ownership/reuse are covered by shipped unit, daemon, and real CLI
fixtures (`tests/activation.test.ts`, `tests/daemon.test.ts`,
`tests/build-identity.test.ts`, `tests/hub-instance.test.ts`). The product gate
of **three consecutive live self-activation upgrades is complete (3/3)**:
Tasks `8b3528b5-f9f1-495d-abb5-687f43be66d5`,
`6ff650f4-6123-4643-aa4a-82f15e63389c`, and
`da3747c8-ee83-430e-882d-d9509fa9b9eb` each passed source apply, independent
verification, artifact build, detached daemon activation, exact old-PID exit,
and new-build identity checks through the real `forklight-self-upgrade`
Delivery Profile. After the first M1.1 delivery, the current CLI and formal
Daemon match build
`8a148033c9f45b35c40d86ae5ec7f4864b5d972359df089a14586c461209c895`
and source digest
`108f44c65fe574aff1582803166dfd2a93056d9da64ea114a2e6a548f1faee05`;
Hub PID `24314` is `current` on the single `127.0.0.1:56962` listener, and no
Task is active or queued.

The last live audit also found 20 source-dev test Daemons left by replacement
and Hub CLI fixtures. Main proved every one used an isolated temporary
home/socket, terminated only those exact PIDs, then used ForkLight Task
`c9bb5cc9-c4ac-41ec-b0b9-0077e78e5505` to close both ownership gaps. Main
rejected the first machine-green placement, retained the candidate, made two
bounded repairs, and recorded remediation check
`9e3b07c3-99fc-4cf8-84c7-69e5aab11061` with 4/4 commands passed. Focused
52/52, full 1,443/1,443, strict TypeScript, diff hygiene, and repeated external
process audits now leave zero source-dev test Daemons.

**Historical M0 exit proof:** a fresh collaboration Agent loaded MCP build
`f8155ae0ecd58ecae014da7f61c5509caf7387c94ac22f2528366937b670821a`
instead of inheriting this long-running task's old `2bcd...` MCP. Its MCP,
CLI, and Daemon build identities and source digests matched exactly; Hub
remained `current` at PID `76185` on port `56962`, with no active or queued
Task. This proved that specific fresh Main session bound to the then-current MCP
without another rebuild or retry. The 2026-07-29 long-session mismatch above
shows that fresh-start binding and post-upgrade reload are separate requirements;
the App-restart proof above now closes the latter. No commit or push has been
performed.

**M1.1 complete (2026-07-28):** Task
`692d386d-064d-4870-b242-a5783697256e` closed the list/detail truth gap so the
prominent Task headline follows the Main/delivery decision instead of falling
back to machine success. Task `5b139291-7e80-49e2-9312-d76e4c4f4b74` then
attempted the retained-Candidate explanation. Main recorded `revise`, launched
no second Worker, retained the useful presentation structure, replaced its
duplicated digest implementation with the canonical CandidateRevision
authority, made the copy conditional on Main handling, and replaced a false
generic source assertion with semantic privacy tests. Focused verification is
**126/126**, full verification is **1,451/1,451**, strict TypeScript, Hub
JavaScript syntax, build, and diff hygiene pass. Remediation check
`8e7a7303-a8ae-4223-9919-1f78c23a3aa1` passed the original **5/5** commands and
records `verified-repaired-delivered` while preserving the original failed
Worker Attempt. The final comprehension audit used real Hub Tasks for accepted,
Main-revise, and Main-repaired delivery states, plus deterministic journey
fixtures for verification failure, Provider/authentication failure, active
execution, and legacy evidence. It found one remaining contradiction: a machine-
green Task with a Main `revise` decision still showed the Worker's files as
"accepted as the final result" and used generic success copy. The UI now makes
Main revise/reject override machine success, never labels those files as finally
accepted, and gives one concrete next action in both languages. Focused Hub tests
pass **99/99**, the full repository passes **1,452/1,452**, strict TypeScript,
Hub JavaScript syntax, production build, and diff hygiene pass. CLI and Daemon
match build `df297e93bb337febf5a59953e41185f46ccbb0c7bfe884185713a84616c5dd67`;
Daemon PID `63458` has no active or queued Task, and Hub PID `63820` is `current`
on the single `127.0.0.1:56962` listener. **M1.1 is complete; M1.2 is active.**

**M1.2 readiness slice delivered (2026-07-28):** DeepSeek Task
`2d0222c8-5d13-4b2c-a8a8-d750b736ac19` stalled after a partial Provider stream
and was stopped by the configured 30-minute no-progress watchdog. Main did not
retry it or start a second Worker. The useful authentication/readiness design
was retained, then Main completed one canonical resolver covering API key or
local Grok sign-in, saved model, runtime doctor, Provider/runtime pairing, and
optional connection evidence. Hub now explains each saved Worker in plain
language and filters impossible model/runtime combinations before save.

Focused readiness/Hub verification passes **148/148**, the full repository
passes **1,462/1,462**, and strict TypeScript, Hub JavaScript syntax, production
build, and diff hygiene pass. Remediation check
`69ff5b2b-b560-4a9e-9118-698805d40e40` reran the original contract **5/5** and
records `verified-repaired-delivered` while preserving the failed Worker Task.
Real English and Chinese Hub checks show DeepSeek, Volcengine GLM, MiniMax, and
Grok as locally launchable; Grok uses its existing local sign-in and is no
longer mislabeled as missing an API key. Selecting Grok Build limits the model
picker to the xAI model. CLI and Daemon now match build
`37253b46188f76d4096d12d3e7cb7b804edaa0e3c3117be16008b94496e15f2f`;
Daemon PID `84788` has no active or queued Task, and Hub PID `88178` is
`current` on the single `127.0.0.1:58786` listener. M1.2 remains active until
the remaining smaller DeepSeek smoke proof passes.

**M1.2 Grok path delivered with bounded Main repair (2026-07-28):** Task
`45fa7412-c099-4b14-87cc-4f97b8f30f04` used the saved
`local-grok-builder` Profile and one xAI `grok-4.5` Attempt through Grok Build.
It produced a complete read-only `validate_file` daemon path plus shared CLI
preview. Focused **137/137** and full **1,475/1,475** passed, but the machine
Task failed strict TypeScript on one test helper and `git diff --check` on one
trailing blank line. Main did not rerun Grok: it retained the candidate, fixed
those two mechanical issues, required absolute paths at the daemon boundary,
and made the parsed Task plus preview digest come from the same single file
read. Remediation check `8747b759-fcd6-4a68-958f-423a4fd55be7` passed the
original **5/5** commands.

Real CLI and daemon calls now agree on the saved Worker Profile, label,
Provider, model, runtime, effort, unlimited budget, one base Attempt, zero
extra Attempts, zero adaptation rounds, and the same content-free preview
revision. Preview creates no Task and returns no endpoint, credential reference,
absolute path, prompt, acceptance command, or Provider response. This counts as
one real Grok path delivered with Main repair, not as machine-success. Grok
terminal usage is unavailable and is not displayed as zero.

**M1.2 GLM Hub binding delivered with retained Candidate and bounded Main repair
(2026-07-28):** Task `f42c5b2e-4458-4d89-b4ca-5a66b6669dea` used the saved
`volcengine-glm52-1m` Profile and one `glm-5.2[1M]` Attempt through Claude
Code. It added a canonical admission preparation shared by preview and bound
submission, a Hub read-only preview route, and a two-step Board flow. Focused
tests and full **1,491/1,491** passed in the Worker workspace; strict TypeScript
failed only because one test helper kept an unused parameter. The original
Task and Attempt remain failed.

Main did not rerun GLM or start another Worker. It retained the candidate and
fixed four bounded gaps: malformed non-string preview evidence can no longer
fall back to unbound submission at the daemon transport; an old preview response
cannot reappear after the user edits the path or starts a newer preview; the
Submit button remains disabled after success/rejection clears the preview; and
the beginner copy now says “Task brief check / 任务说明检查” and explains whether
Main can safely apply the result. Focused **228/228**, full **1,491/1,491**,
strict TypeScript, Hub JavaScript syntax, production build, and diff hygiene
pass. Remediation check for the original contract passed **5/5**.

The real current Hub preview resolves the exact GLM Profile, model, runtime,
unlimited budget, one base Attempt, zero extra Attempts, zero adaptation,
quality pass, and Integration feasibility without creating a Task (Task count
remained 20 before/after). Real English and Chinese browser interaction now
confirms the same facts: Submit starts disabled, preview makes it available,
editing the path immediately clears the bound preview and disables Submit
again, and neither language starts a Task or spends model Tokens during
preview.

That browser pass exposed a separate live-process problem rather than hiding it:
one detached Hub process received `uv_os_get_passwd ENOENT` from
`os.userInfo()`, so Overview falsely described the Task service and saved API
keys as unavailable. Main added one bounded local-account resolver shared by
setup, Provider readiness, Provider probing, and Task Keychain reads. It accepts
only a safe local account name and falls back through `USER`, `LOGNAME`, and
`id -un`; no credential or private path enters the UI. The post-fix repository
passes **1,492/1,492**, strict TypeScript, Hub JavaScript syntax, production
build, and diff hygiene. A real restart reports DeepSeek, MiniMax, Volcengine,
and local Grok authentication ready.

The Attempt used **26,404,895 gross Worker Tokens** (25,944,128 cache-read),
runtime estimate **USD 17.878539**, and 54 receipts give a low-confidence Main
exchange envelope of **191,039–1,187,491 Tokens**. Official per-request price
is unavailable for the subscription plan, and no exact-pair direct-Main
baseline exists, so no Main Token saving is claimed. CLI and Daemon now match
build `55006043d66b7dfb4b3cf62de32841629c4b054e7df6e8c0ca70c3bd33516cb3`
and source digest
`4732062afdf3ac9c06b7dfea48713a9d49b4aa21d46b91013683b253c57b50d0`;
Daemon PID `63567` has no active or queued Task, and Hub PID `64421` is
`current` on the single `127.0.0.1:51475` listener.

**M1.2 launch-auth contradiction discovered (2026-07-28):** the first new
MiniMax smoke Task `7b8c6d1b-d396-4ec5-b62d-fefc05c954c0` passed the saved
Worker/readiness preview and completed workspace preparation, but failed before
turn 1 because the Daemon could locate yet could not read
`forklight.minimax.api-key`. It has no Worker usage or Candidate. Main did not
retry it. A bounded root-fix contract then used local Grok Task
`811863fb-7633-4516-a3c4-f283af67e24f`; that Task also produced no Candidate or
usage because the previously working Grok local sign-in had expired before its
first model response. Main stopped there instead of rotating through GLM and
DeepSeek with the same unproven authentication state.

A non-secret local check confirms DeepSeek, MiniMax, and Volcengine Keychain
items are currently unreadable even though daemon health still calls them
ready. This disproves the current `ready = Keychain item exists` assumption and
reopens the M1.2 readiness claim: launch readiness must prove the exact local
auth path is readable, without materializing the secret, and Task execution
must stop before workspace/Attempt creation when it is not. The frozen repair
contract is `examples/dogfood/provider-credential-preflight-grok.yaml`; no
external Worker is currently authenticated to implement it. A small local
recovery helper, `scripts/setup-provider-key.sh`, writes only macOS Keychain and
immediately verifies discarded-output readability. After local re-authorization,
the same bounded contract should run once through MiniMax, followed by the
Doctor truth task through DeepSeek. M1.2 remains active; no authentication
failure is treated as model-quality evidence.

**M1.2 launch-auth root fix delivered by Main (2026-07-28):** because every
external Worker path was blocked before its first model response, Main did not
repeat the same failing launch. Provider readiness now executes the exact
Keychain `-w` read used at Worker launch while discarding stdout/stderr, and an
exact Task preflight uses the Task's frozen service/account plus the supported
Grok local-sign-in fallback. A rejection becomes a durable authentication
failure before workspace preparation, Attempt creation, Worker launch,
Provider request, or Worker Token usage. Its safe event explicitly records
`workerInvoked=false`, `workspacePrepared=false`, and `attemptCreated=false`;
statistics treat it as non-model evidence and Task Detail labels it “Worker
could not start / Worker 未能启动” rather than blaming the model.

Focused Provider/Daemon/Task-surface tests pass **148/148** and the complete
repository passes **1,495/1,495**; strict TypeScript, production build, Hub
JavaScript syntax, and diff hygiene pass. The live CLI and Daemon now match
build `b8e563db9c6f26ea4a853bbd11077734767afa0d4a867b74ece3094e92cb4e12`
and source digest
`e8992122781b41de3412f2561e5281c8b5b35866c8e733260f97831ffee24e45`.
Daemon PID `55645` has no active or queued Task; Hub PID `57028` is `current`
on the single `127.0.0.1:62816` listener. Runtime health at that point truthfully
marked DeepSeek, MiniMax, and Volcengine local authentication unavailable
instead of ready. Grok still had a readable local-sign-in file, which is a
supported launch path but not proof that the remote session is still accepted.

**M1.2 MiniMax path delivered after credential recovery (2026-07-28):** the
newer Task `1c710ce9-04f5-4d7a-aadb-f8f82e229fff` proves the launch-auth repair
and local credential path now work end to end. It used the saved
`minimax-m3-cn` Profile, MiniMax-M3, Claude Code high, unlimited budget, one
base Attempt, zero extra Attempts, and zero adaptation. The Worker ran 177
turns and produced a three-file / 623-line Candidate. Focused **21/21** and full
**1,508/1,508** passed in its workspace; strict TypeScript failed only because
one test imported `WorkerProfilesSettings` from the module that consumes rather
than exports it.

Main did not retry MiniMax. It retained the Candidate, corrected that type-only
import, and replaced the Candidate's copied Provider-evidence expiry logic with
one pure classifier shared by ProviderProbeService and CLI health. Main focused
Provider/readiness verification passes **37/37**, the current full repository
passes **1,511/1,511**, strict TypeScript and diff hygiene pass, and remediation
check `2bcf5b28-ffb4-44ae-a3be-33fae2053726` passed the original **4/4**
commands while preserving the original failed Task.

The real built `forklight health` now lists every saved Worker in saved order
and states whether it can launch, why, and the next action. Current evidence
shows DeepSeek, Volcengine GLM, MiniMax, and Grok locally launchable; stale or
missing connection evidence remains explicit and is not promoted to verified.
The MiniMax Attempt used **19,140,708 gross Worker Tokens** (18,931,200
cache-read), with matched top-level and per-model counts. Runtime estimate is
**USD 11.63624**; the official MiniMax evidence is only a bounded
**CNY 8.7448473–17.4896946** estimate, not a bill. The receipt-aware Main
exchange envelope is **281,191–1,698,782 Tokens**. No exact-pair direct-Main
baseline exists, so no Main Token saving is claimed.

CLI and Daemon now match build
`7efb333bb9b5b54663df6034b77c4fcfc63358b1fad82d9cf7e4372b4ee09ae1`
and source digest
`233c8921912ab8cbdeb4ba06e9526be4a7b265865f86a7ea1ac4fabcd334aff1`;
Daemon PID `60112` has no active or queued Task, and Hub PID `61108` is
`current` on the single `127.0.0.1:61538` listener. M1.2 now remains open only
for the smaller DeepSeek proof.

**M1.2 DeepSeek path and guided first Task delivered (2026-07-28):** the Hub
guided sample implementation passed focused **113/113**, full **1,520/1,520**,
strict TypeScript, Hub JavaScript syntax, production build, and diff hygiene.
The built Hub prepared a private packaged checkout sample with opaque browser
identity, selected saved Worker `default`, and canonical bound admission
preview. The preview resolved exactly to DeepSeek `deepseek-v4-pro[1M]`, Claude
Code high, unlimited budget, one base Attempt, zero extra Attempts, zero
adaptation, Quality 100/100, and an integratable ordinary Task. Preparing the
sample created no Task or model usage.

After explicit submit, Task `bfe223ac-feb2-422e-8f5b-418eef919308` used one
DeepSeek Attempt and no competition, retry, correction, or adaptation. It ran
6 turns in about 31 seconds, changed only `checkout.py` (1 file / 5 changed
lines), and independently passed all four packaged Python tests. Main reviewed
the exact Candidate, independently reran the tests, recorded `accept`, and used
the ordinary Integration path. Source apply and source verification passed;
the accepted patch now exists only in the disposable sample project, while
artifact build and runtime activation were correctly not applicable.

The Attempt used **26,292 gross Worker Tokens** (7,119 input, 2,533 output,
16,640 cache-read); top-level and per-model totals match. DeepSeek official
PAYG evidence estimates **USD 0.005360795** and runtime telemetry estimates
**USD 0.10724**; neither is presented as a bill. Three receipts give a
low-confidence Main exchange envelope of **6,631–39,922 Tokens**. No exact-pair
direct-Main baseline exists, so no Main Token saving is claimed.

The real bilingual Task Detail audit then found one presentation contradiction:
source-only delivery had passed source apply and source verification while
runtime activation was correctly `not-applicable`, but the prominent result
still implied the change was active. Decision View now has a distinct
`delivered` stage. Chinese shows “已交付；这个任务不需要运行时生效步骤,”
while English shows “Delivered; this task did not require runtime activation.”
The runtime-activated path remains a separate stronger fact.

Focused delivery/Hub verification passes **126/126**. Real Chinese and English
DOM checks confirm the headline, explanation, and no-action next step.

The subsequent release-package smoke found a clean-user blocker that repository
tests had not exercised: `dist/build-identity.json` was generated and required
by both installed entrypoints, but the npm package allowlist shipped only
`dist/src/`. A real tarball install reproduced CLI startup failure before any
configuration. The package now includes the exact generated identity, and the
manifest test freezes that requirement. A second real tarball install proves
the identity file is present, the installed identity matches the source package
byte-for-byte, both CLI/MCP entrypoints are executable, and the installed CLI
loads successfully.

Full verification now passes **1,542/1,542**, and strict TypeScript, Hub
JavaScript syntax, production build, package smoke, and diff hygiene pass.

The final package build and runtime switch now match build
`3aa4ab800f5dabbd28ec2b7a08a77b0679a99f3ee628b67285420c401608d483`
and source digest
`5d8fcaf120116c145cfe77f578bd2372a57d1dc247eb1eb0b75e5321bebe67de`;
Daemon PID `9154` has no active or queued Task, and Hub PID `9341` is
`current` on the single `127.0.0.1:58037` listener. Same-day fresh Daemon
launches produced different readability for the same historical DeepSeek,
MiniMax, and Volcengine Keychain items: one launch restored all three, while
the final explicit restart truthfully reports all three unavailable. This does
not support a permanent model or Provider conclusion; it proves historical-key
readability is launch-context dependent and therefore not restart-stable.
Future writes use credential-free argv, an explicit `/usr/bin/security` ACL,
and the same safe `USER`/`LOGNAME`/`id -un` account priority as the runtime.
The existing three keys need one explicit re-entry followed by another restart
to prove persistence. No paid probe, Worker Attempt, or model-quality judgment
was created from this result. **M1.2 model-path evidence remains complete; M1.3
is active.**

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

- **Succeeded + Main-revise no-Worker remediation (2026-07-28):** a machine-
  successful Task may now verify a Main repair without rerunning a Worker, but
  only when the latest typed Main review is `revise` and is bound to both the
  current Attempt and the latest independent verification event. Missing,
  malformed, accept/reject, superseded, stale-verification, stale-Attempt, or
  mismatched event-envelope evidence rejects before commands or durable
  remediation mutation. The original Task, Attempt, review, Candidate Revision,
  patch digest, and Integration authority remain unchanged; a passing check only
  records the existing `verified-repaired-delivered` disposition. Historical
  Task `fbd403bd-fb4d-49b9-9a66-bb968a0be374` exercised this path with 4/4
  acceptance commands and no second Worker.
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
- **Worker Quality Hub editor (2026-07-28):** each Worker can now override the
  quality mode and individual outcome/context/module/scenario/risk/acceptance,
  focus-path, file-scope, and line-scope expectations from the same shared
  resolver used at Task creation. Maximums have explicit inherit, unlimited,
  and limited states; minimums preserve explicit zero; every field can return
  to global inheritance. The preview explains effective values and provenance
  before save, while Safety, execution ceilings, and Integration stay separate.
- **Version-aware Hub ownership (2026-07-28):** a Hub descriptor now freezes the
  running build identity. A matching owner is reused; a legacy or different
  build requires an explicit confirmed replacement. Replacement rechecks the
  exact claim, descriptor, PID, authenticated owner, listener, and lifecycle
  records immediately before signaling and while waiting. Ownership changes
  fail closed, automatic SIGKILL is forbidden, and concurrent graceful-stop
  callers share the same completion promise.
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

The requirement-level gate is now recorded in
`docs/m1-daily-assistant-acceptance.md`. The current Hub can complete the
configuration steps and now exposes a guided **Run your first real Task** card.
It copies only the packaged checkout fixture, consumes the selected saved
Worker and effective policy, performs canonical preview plus one-time bound
submit, and then hands off to ordinary Task Detail, Main Review, and explicit
Integration. The current-machine DeepSeek journey completed successfully, but
the clean-user outcome remains open. A valid exit run must use a new macOS
account, VM, or Mac; changing only `FORKLIGHT_HOME` would inherit Keychain and
Main-client state and is not clean evidence.

The implemented product path is specified by
`examples/dogfood/hub-guided-first-task-deepseek.yaml`. It defines an opaque,
owner-only packaged sample; a generated ordinary Task bound only to the user's
saved Worker Profile; canonical preview and one-time bound submit; then normal
Task Detail, Main Review, and explicit Integration. It forbids hard-coded
Provider/model/runtime/execution policy, automatic retry/review/integration,
raw local paths, and sample-only execution truth. The current-machine journey
has now proved that implementation with one real DeepSeek Task. The remaining
gate is clean-environment timing, configuration, Main reconnection, and recovery
evidence rather than another implementation retry.

## Next engineering

1. **M1.2 real Worker readiness and selection — complete:** the canonical per-Worker
   readiness result and pre-save Provider/runtime filtering are now delivered.
   CLI validation and Hub submission now use the actual saved Worker Profiles;
   Hub shows the final effective Worker/policy before submit and binds the
   confirmation to that exact file/settings revision. Grok and GLM paths,
   including the real English/Chinese preview interaction, are delivered with
   bounded Main repair. The saved MiniMax path is also delivered with one
   retained Candidate and bounded Main repair. The final smaller DeepSeek proof
   completed through the guided checkout journey with one machine-successful
   Attempt, Main accept, and safe Integration.
   The failed DeepSeek readiness Task is retained as a runtime-stall sample, not
   retried. Each proof gets one Attempt and no competition or automatic retry;
   fix configuration failures before spending model Tokens.
2. **M1.3 guided daily use — active:** Worker Advanced settings, per-Worker Quality
   editing/provenance, immutable Task snapshots, and the Delivery Profile Hub
   editor and guided first Task are shipped. A controlled Daemon restart now
   proves that the existing DeepSeek, MiniMax, and Volcengine Keychain items
   remain launchable without re-entry or a Provider request. The read-only
   ten-Task candidate inventory is recorded in
   `docs/m1-real-task-portfolio.md`, including current source-overlap risk,
   user-facing outcomes, module boundaries, acceptance commands, and bounded
   execution policy. A same-day source-drift recheck has now stopped unsafe
   execution of that historical inventory: the saved Dia path no longer exists;
   Adeptify A1's original core checks already pass while its remaining UI/
   projection chain overlaps active work; NovelRPGPlay N3 is already implemented
   end to end in the current baseline; and the remaining candidates overlap
   ongoing Session, File Tool, production, review, personal-action, or connection
   work. No Worker was launched and no Token was spent merely to increase the
   task count. M1.4 now needs a user-prioritized fresh outcome or an updated Dia
   path before the next real-project submission. The operator procedure and
   evidence worksheet are recorded
   in `docs/m1-clean-user-runbook.md`; the current Mac has only the existing
   development user. The latest world-readable clean-run bundle is frozen under
   `/Users/Shared/ForkLight-Clean-Run.TrcwKU`: external `bundle-evidence.json`
   binds tarball SHA-256
   `cb0359ef30e3e088c2cbc339e60a8e1912f3a901e34ef372da56671ef9652d98`,
   package build `7426d0f154901f14b61cc7073afe853040734b561161cdf617b0bdc086b6c684`,
   full prepack **1,587/1,587**, isolated install, CLI/MCP load, exact installed
   identity comparison, and sensitive-filename scan. The old `cDgmCh` bundle and
   one intermediate package are explicitly marked superseded. The bundle was not activated in
   the existing development user. An independent macOS user, VM, or Mac still
   needs to be authorized and used. Finish that approximately 15-minute clean-machine
   journey, including a fresh Main connection and restart/recovery checkpoint,
   then align and execute the representative Tasks without manual database or
   internal configuration edits. Relay has now supplied an additional M1.4
   pilot Task for execution-detail readability. It proved real Worker
   delegation, retained-Candidate correction, Main review, and browser
   comprehension, but it does **not** yet count as a clean ForkLight
   Integration: the Task remained machine-failed because repository-wide
   acceptance was blocked by unrelated concurrent work, so Main applied only
   the reviewed three-file source patch. The pilot is evidence for improving
   partial reuse and baseline-aware acceptance, not a manufactured success.
   Relay 的第二条实践已经把默认 Worker Profile 继承和真实验收门接通：DeepSeek Task
   `84c2474c-5b46-4bf7-9f00-55964e4052ec` 机器验收通过，Integration 完成，Main 的两处
   定点合同修正后目标测试 64/64、lint、diff hygiene 和真实 UI dry-run 通过。它暴露的
   “成功 Candidate 无法承接 Main revise”已经由 ForkLight Task
   `908c5cd9-dfbd-42b0-8849-035addbcdb8b` 关闭：成功任务现在只有在最新 Main revise 精确绑定
   当前 Attempt/机器验收、Candidate 仍匹配、没有竞争或 Integration 历史且
   `maxMainCorrections` 仍有额度时，才能复用同一 Task/workspace/session 做一次结构化纠正。
   `maxExtraAttempts=0` 不再阻断这条路径；纠正后仍需新的机器验收、Main 接受和独立 Integration，
   不会自动循环。最终 1,561/1,561 全量测试、构建、四阶段 Integration/activation 和
   CLI/Daemon identity 均通过。下一步按 Relay 后续业务样本验证这条能力，不继续为同一状态机
   制造参数重试。
   Relay R5 已用 Volcengine `glm-5.2[1M]` 验证另一条真实 UI 链路：保持 Doctor API 不变，
   通过纯 presentation mapper 让设置页先回答“Relay 核心、ForkLight 执行、工作区安全能否使用”，
   再给一个恢复动作，机器原始数据默认折叠。两次同 Candidate Attempt 均通过原 4 条机器验收；
   Main 因候选仍有两个空 `memory` 文件和一处初学者原始错误文案保持 `revise`，没有自动
   Integration，只写回四个产品文件并记录 4/4 remediation verification。最终 8/8 行为测试、
   目标 lint、diff hygiene 和桌面/390px 浏览器验收通过；全局 TypeScript 只剩既有可选 `pg`
   基线问题。该样本证明“Worker 产出 → 一次受限纠正 → Main 定点交付 → 用户理解验收”的链路，
   但不替代 Adeptify、Dia、NovelRPGPlay 十任务和 clean-user journey 的 M1.4 退出条件。
   Relay R6 又补充了一个安全/可靠性样本：不存在、非目录、真实路径越过 allowlist 的 workspace
   现在会在 Assignment/Worker 启动前拒绝；有效的 symlink allowlist root 则按两侧真实路径正确
   授权。Routing 因精确任务类零样本机械建议竞争，Main 基于两文件和确定性验收覆盖为 DeepSeek
   单 Worker。一次基础 Attempt 和一次同 Candidate correction 后，24/24 新行为、17/17 既有 Alpha
   主链、目标 lint、导入和 diff hygiene 通过，ForkLight Integration
   `658a6e77-3dc5-45f3-be3b-bbafb2cd934e` 完成。两轮只有 645,799 gross Worker Tokens，说明缩小
   入口、固定验收并保留 Candidate 比增加 Token 上限或默认竞争更有效。当时源码 CLI 与 Daemon
   identity matched，但长 Codex 会话内的 MCP 仍是旧 build；该轮所有 mutation 均走匹配 CLI。
   本文件顶部记录的 App 重启证明现已恢复 matched MCP 并关闭 M0 reload gate，Relay M1.4 可以继续。
   Relay R7 已完成 Activity 可读性实践：MiniMax-M3 Task
   `a274b50c-cf0b-4838-bd0d-c98369c04008` 把原始 `event.kind` / `job.status` 改为白话分类、
   五种真实执行状态、空状态和可点击的事项入口。第一次 Attempt 机器验收通过，Main 因
   `未知 Runtime`、内部术语、重复上下文和失败提示没有入口而要求一次同 Candidate correction；
   第二次 Attempt 的产品改动可保留，但新增页面合同测试把普通路径误当 URL，机器验收保持 failed。
   Main 只修一行测试，随后无 Worker reverify 3/3 通过，新增 Worker Tokens / 模型费用均为 0；Relay
   原工作树再次通过聚焦 25/25、全量 176/176 和 diff hygiene。remediation check
   `653da815-03b0-4a2c-89fd-cf05e3179ebf` 记录为 `verified-repaired-delivered`，两个原 Attempt
   事实均保留。该样本同时暴露一个 ForkLight 缺口：reverify 能证明 Main 修复后的 Candidate，
   但不会捕获新的 CandidateRevision，导致 fresh Main accept 与 automatic Integration 因 revision
   mismatch 安全拒绝。该 revision handoff 已由 ForkLight R8 关闭：零 Worker reverify 现在会为
   当前 Diff 和当前 verification sequence 捕获新 CandidateRevision，fresh Main accept 与自动
   Integration 已在真实 self-upgrade 中通过，不再需要 Main 长期手工复制已验证补丁。
   本轮又关闭了 Grok readiness 的旧误判：本地登录只说明“可启动”，只有真实
   `worker.completed` 才说明“已连通”。Task
   `cf54d876-eabf-4f3f-aa7f-cfb3718eb792` 用一次只读 Grok 4.5 Attempt 完成验证后，保存的
   `local-grok-builder` 从 `connection-unverified` 变为 `ready`；再次显式检查 xAI 也保留
   `worker-run` 证据，不会退回旧的 Keychain 失败。复杂 coding Task 中 Grok 的无工具思考循环仍
   保留为 routing 负样本，不能用这次 smoke success 推导复杂实现能力。本次 smoke 发现的
   `run` / `submit` Worker Profile 解析差异也已由 Task
   `4be4bee7-ef54-4314-a50f-75c835d36e6d` 关闭：`run` 与 `validate-plan` 现在复用同一个完整
   settings-to-policy mapper；新 build 中直接 `forklight run` 同一 Grok 文件已真实成功，不再报告
   `Unknown worker profile`。
   ForkLight 自身的 Grok 连通性解释又完成一轮真实 dogfood：Task
   `00b0cd43-eeba-40d1-9d6e-c5b5e6c73c1b` 使用一个 Grok 4.5 Attempt 产出 14-file
   Candidate。Task 的机器状态保持 failed，因为 Main 在不可变验收合同中误写了仓库不存在的
   `npm run typecheck`；Main 没有重跑 Worker，而是保留 Candidate、补上终态事件脱敏，并把未来
   合同改为真实的 `npm run build`。聚焦 171/171、最终全量 1,595/1,595、build、Hub JavaScript
   syntax 和 diff hygiene 均通过。今后明确的 Grok 网络连通失败会作为 Provider/运行环境证据，
   不计入模型质量；Task Detail 用白话解释 TUI 与后台 Daemon 可能继承不同网络环境，并只给安全
   恢复动作。原始代理值、凭据和 endpoint 细节不会进入公开 Task 表面。
   Keep using shared resolvers so the form,
   preview, saved policy, and Task admission cannot drift into separate meanings.
3. **Contract feasibility:** shipped as a durable failure category
   `contract-infeasible` with a pure classifier (`assessContractInfeasibility`),
   verification.completed payload stamping, same-policy extra-attempt rejection,
   adaptation gate stop reason, and Hub next-action `revise-contract`. Reason
   codes are privacy-safe (`undeclared-dependency`, `contradictory-acceptance`,
   `scope-boundary-conflict`) and are not inferred from free-text command output.
   Next: collect production examples where Main declares codes during review,
   and optionally help Task authors preview contradictory acceptance before submit.
4. **Hub Board density and long-run progress:** Board cards now surface
   backend `progress.activity` as plain-language badges: updating, quiet, and
   (presentation-only) stalled after five minutes of silence, without inventing
   a new machine status or changing kanban lanes. A presentation-only name/
   stage filter is shipped so dense boards can be narrowed without mutating
   Tasks. Still open: archive/history and lineage grouping; distinguish
   Provider request in-flight from process-alive stream activity.
5. **Selective model routing:** the privacy-safe advisory core, settings,
   CLI/MCP path, Hub policy/evidence view, failure classification, correction
   churn, official-cost comparability, uncertainty gate, and configurable
   strict/flexible missing-evidence policy are shipped. The optional
   zero-default budget-reliability preference now uses per-Attempt evidence,
   requires the same actually-enforced USD/Token limits, preserves correction
   budget overrides, and never treats uncapped success as proof. Next use competition
   only for uncertainty, critical work, new task classes, or explicit requests.
   Do not make routing mutating until Main can inspect and override every
   recommendation. Relay dogfood then exposed a prompt-policy mismatch: every
   Worker saw “Hard change budget” even when its frozen policy was warn. GLM
   Task `c989e9a7-4a52-48e1-bf4e-9d186b37dac5` delivered a two-file fix in one
   Attempt; focused 86/86, full 1,542/1,542, strict TypeScript, Integration
   source apply/verification, and the final CLI/Daemon identity all pass. Hard
   and legacy-hard retain the stop rule; warn, score, and off now state their
   real non-blocking meaning without inviting scope expansion. Main explicitly
   overrode a no-evidence competition suggestion because this was a small,
   deterministic Task. That saved three unnecessary candidates, but the chosen
   GLM Attempt still used 27 turns and 1,010,445 gross Worker Tokens. Treat this
   as accepted quality evidence and negative efficiency evidence: before the
   next small Task, tighten context/read guidance or choose Main-direct work
   rather than using success alone to justify delegation.
   A 2026-07-29 read-only evidence audit now makes the M3 limit concrete:
   229 stored Tasks include 114 without `taskClass`; the remaining 115 are
   fragmented across 88 exact classes, 71 of which have only one sample. Only
   four classes have at least three Tasks and two models, and none can satisfy
   the current five-relevant-samples-per-candidate gate. Passing all four saved
   Workers to a new class therefore produces a competition suggestion because
   evidence is absent, not because multiple implementations are valuable.
   Until a new schema is aligned, Main must shortlist one Worker for ordinary
   deterministic work and at most two for explicit criticality, multiple
   plausible high-risk solutions, a genuinely new task family, or a user
   request. Keep machine-first success, final accepted delivery, and Main-
   repaired delivery separate: DeepSeek 1M, MiniMax M3, GLM 5.2 and Grok 4.5
   currently account for 36 accepted deliveries that required Main repair.
   The proposed next product slice is a configurable stable task family plus an
   explicit competition-trigger reason; missing evidence alone should mean
   “unknown”, not silently authorize extra spend. Full evidence and caveats are
   recorded in `docs/model-selection-evidence-audit-2026-07-29.md`.
   A no-code implementation blueprint is now recorded in
   `docs/model-selection-strategy-v1.md`. It keeps exact `taskClass` for audit
   and Direct Codex calibration, adds an explicit stable family only for
   broader routing evidence, separates “evidence is unknown” from “competition
   is worth its extra spend”, and freezes Main's shortlist/selection reason for
   Hub explanation. A source-level call-chain audit found that current routing
   identifies candidates only by provider/model, while Competition clones the
   parent runtime/Profile and changes only provider/model. That is insufficient
   for truthful Worker selection or mixed-runtime candidates. The blueprint now
   freezes provider/model/runtime/effort identity, requires each Competition
   candidate to resolve its own Worker Profile, and separates machine comparison
   from Main's final accept/revise/reject/retained-partial decision. Implementation
   is split into two sequential, non-competitive Tasks: DeepSeek 1M for routing
   evidence and selection snapshots, then Volcengine GLM 5.2 1M for mixed-runtime
   Competition and result judgment after the first Task is integrated. Each has
   at most one same-Candidate correction. No schema, API, setting, Worker, or
   runtime has been changed before user alignment.
   A companion Hub acceptance matrix is now recorded in
   `docs/model-selection-ux-acceptance-v1.md`. Read-only evidence proves that a
   zero-sample four-candidate query currently returns `shouldRunCompetition=true`,
   historical Competition records do not retain a reason or each candidate's
   runtime/Profile identity, and machine recommendations are not bound to a Main
   final decision. The matrix defines one shared explanation order across Models,
   Competition Detail and Task Detail, including explicit unknown/no-competition,
   machine-result-waiting-for-Main, revision, rejection and retained-partial
   states. It is a data/copy acceptance contract, not visual proof: the live Hub
   session was unauthenticated, so authenticated browser QA remains mandatory
   after implementation. Runtime behavior remains unchanged pending user alignment.
   Two executable but unsubmitted sequential Contracts are now frozen at
   `examples/dogfood/m3-routing-decision-evidence-deepseek.yaml` and
   `examples/dogfood/m3-competition-main-decision-glm.yaml`. Current ForkLight
   validation resolves the first to DeepSeek `deepseek-v4-pro[1M]` and the
   second to Volcengine `glm-5.2[1M]`; both have unlimited per-Task budget, one
   base Attempt, zero automatic extra Attempts/adaptation, at most one explicit
   Main correction, and 100-point admitted contract quality. The GLM Contract
   cannot start until the DeepSeek Candidate is accepted, integrated, built,
   activated, and identity-checked. Validation created no Task and launched no
   Worker. Submission still waits for the one product-principle confirmation.
6. **M4 exact-pair evidence audit (2026-07-29):** two version-1 profile
   calibrations are already published, each from one accepted sample with low
   confidence. They truthfully prove lower Main exchange for those two exact
   cases, but the task classes and Codex profiles differ, so they cannot be
   merged into a general ForkLight saving rate. The current reports show
   86.13%–97.73% and 82.49%–97.13% saved **Main** Tokens respectively; neither
   percentage is a total-system Token or cost claim. The first legacy pair has
   independent verification and an applied patch but lacks modern Main Review
   and complete Candidate lineage; the second includes a failed first check,
   one same-Candidate correction, independent verification, and semantic Main
   acceptance, but has not been integrated. Publication confidence is currently
   Main-declared rather than inferred from sample count. The minimal next
   portfolio is one real accepted pair each for small fix, standard feature,
   and refactor, all from frozen same-condition baselines; no competition and
   at most one fully counted same-Candidate correction. Add samples only when
   the first result changes a decision or needs variance checking, and require
   explicit user approval before every intentionally duplicated pair. Full
   evidence, current values, caveats, and proposed configurable confidence
   thresholds are recorded in `docs/main-token-value-evidence-plan.md`.
7. **Provider-native exact cost coverage:** Worker `pricingRoute` and a truthful
   aggregate-tier range are shipped. Next capture Provider/runtime-supported
   per-request usage rows so multi-tier Attempts can become exact; until then
   Insights must keep the range supplementary and retain
   `per-request-usage-required` in the exact-unavailable count.
9. **Build identity and runtime activation truth — M0 complete:** Delivery
   settings, Task snapshots, Preflight, Task Detail, and Overview distinguish
   source update, source verification, artifact build, and runtime activation.
   Three consecutive detached live handoffs and a fresh-Main identity check are
   proved. Keep these invariants in every release candidate; next decide the
   license/public-package policy and make stale Main reconnection easier without
   weakening the exact build check.
10. **Execution-truth cleanup:** generated-output classification before
    Patch/Integration size gates is shipped for declared workspace exclusions;
    raw and generated audit evidence is retained while the Integration payload
    stays source-only. Preflight now shows the immutable four-stage delivery
    plan and uses the real affected-file list. It now also stores and renders
    every affected path's effective category and provenance in order, explains
    that this is the current Task policy rather than proof about the file, and
    offers two advisory recovery choices when a default-business classification
    contributes to a size rejection. It never reclassifies paths, changes
    limits, mutates the Task, or retries automatically. Next translate the
    existing raw patch-applicability diagnostic into a beginner-readable cause,
    action and collapsed bounded technical detail; help Task authors preview
    missing exclusions before Worker launch; distinguish
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
    Attempt 1; cleanup errors fail closed without false Worker attribution. Hub
    startup now keeps one private lifetime owner claim per `FORKLIGHT_HOME`,
    authenticates the stored loopback instance before reuse, never steals a live
    owner after a timeout, and removes ownership only when the exact owner exits.
    A second CLI invocation reuses the existing URL even when another `--port`
    is requested; different homes remain isolated. Detached-daemon lifecycle
    tests now register exact test-owned PIDs before readiness and use bounded,
    idempotent teardown that proves process/socket exit and refuses untracked
    owners. Next explain descriptor/token recovery in Hub copy and extend the
    fixture to any future test that starts a detached service.
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

## Latest dogfood — 2026-07-28 single active Hub and authenticated reuse

ForkLight Task `e00b738c-c949-45ef-8702-36fb28ec42da` used one DeepSeek
`deepseek-v4-pro[1M]` Attempt with Claude Code high, no per-Task Token cap, and
all retry/adaptation paths frozen to zero. Model competition was deliberately
skipped: historical evidence favored DeepSeek for this bounded Hub-lifecycle
task, while competition would have paid several Workers to answer the same
question. The Attempt used **3,268,717 gross Worker Tokens** (125,492 input,
30,777 output, 3,112,448 cache read) and reported a **USD 2.953109 runtime
estimate**. It produced 6 files / 975 changed lines.

Independent verification passed 1,387/1,389 tests plus strict TypeScript, Hub
JavaScript syntax, source compatibility, and `git diff --check`. The two failures
were useful: one test waited on a loser before the winner had published, exposing
that the proposed five-second startup lock could be stolen; another assumed a
fixed PID was dead. Main recorded `revise`, kept the reusable architecture, and
did not launch another Worker. The final implementation holds a private,
identity-checked ownership claim for the Hub lifetime, performs authenticated
loopback reuse, fails closed for a live incompatible owner, publishes descriptors
atomically, bounds validation/probe input, and prevents an old owner from deleting
a replacement owner's files. Deterministic concurrency tests and a real
child-process CLI reuse test replace the incorrect premises.

The complete current-source verification, production build, strict TypeScript,
Hub JavaScript syntax, and `git diff --check` pass. ForkLight remediation check
`5cf9ac36-06e1-492f-8415-d324d5399665` ran all **5/5** original acceptance
commands and recorded `verified-repaired-delivered`; the machine Task remains
`failed`, preserving the Worker result instead of rewriting history.

Live activation was then checked manually. Daemon/client build identity is
matched at
`d0b5f4edac90fe0e00fc56a199b4c6e4536795a5f84a816877dbf765105cde43`.
The Hub owns `127.0.0.1:56962`; a second invocation requesting port `53542`
authenticated and reused 56962, created no 53542 listener, and left one Hub
owner. The ForkLight home is mode 700 and both private ownership files are mode
600. Authenticated liveness returned 200 with the exact owner nonce. This was a
Main-remediated delivery followed by a manual runtime restart, not automatic
Integration activation, so the M0 live-exit count honestly remains **0/3**. No
commit or push has been performed.

## Latest dogfood — 2026-07-28 detached test-daemon cleanup

ForkLight Task `54e54c6e-a3a9-4718-9e26-36e0fa6b534a` used one Volcengine
`glm-5.2[1M]` Attempt with Claude Code high, no per-Task Token cap, and every
retry/correction/reverification/adaptation allowance frozen to zero. The new
task class had no comparable routing samples; Main deliberately chose one GLM
run instead of paying for a three-model competition.

The Attempt ran 46 turns and used **3,749,928 gross Worker Tokens** (165,200
input, 100,760 output, 3,483,968 cache read). Top-level and per-model counters
matched exactly. The runtime estimate was **USD 5.086984**; the configured
Volcengine route is a subscription plan with no per-request price, so ForkLight
does not present that estimate as an official bill. There is no exact paired
direct-Main baseline, therefore direct Main Token savings remains unavailable;
the low-confidence arithmetic boundary range is not called savings.

GLM delivered a useful 4-file / 486-line test fixture and migrated all selected
detached starts. Independent verification passed 1,380/1,383 tests, but three
call sites passed a scalar PID to an iterable-only helper; strict TypeScript
reported the same three errors. Main recorded `revise`, did not invoke another
Worker, retained the exact-home/exact-PID ownership design, changed the helper
to accept one or many PIDs, and fixed another review-only gap: cleanup is now
marked complete only after every owned check succeeds, so a thrown leak check
cannot make a later `finally` skip cleanup.

Focused lifecycle verification passes **122/122**. The full suite passes
**1,383/1,383**, together with strict TypeScript, production build, Hub
JavaScript syntax, and `git diff --check`. Remediation check
`7e1a8bd5-1e0e-4fe9-aca1-5e164e2c5fae` passed the original **4/4** commands and
recorded `verified-repaired-delivered`; the Worker Task remains `failed`. Test
completion left no temporary detached daemon; only the production daemon
remained. The current daemon is PID `21176`, with matched client/daemon build id
`e138a43deae2a9fd689c480cdb8e555b49add6f8c5cea18f428a654efff73dcf`.
Because Main repaired the candidate and switched the runtime manually, this is
not automatic Integration activation and M0 remains **0/3**. No commit or push
has been performed.

## Latest dogfood — 2026-07-28 Hub recovery explanation and adjudication gap

ForkLight Task `fbd403bd-fb4d-49b9-9a66-bb968a0be374` deliberately reduced the
scope to README and operations copy so the next real delivery could exercise
the automatic Integration/activation path. One DeepSeek
`deepseek-v4-pro[1M]` Attempt ran 21 turns, changed 2 files / 87 lines, and
passed all four machine commands, including 11/11 focused Hub lifecycle tests,
the full **1,383/1,383** suite, strict TypeScript, and `git diff --check`.

The Attempt used **446,023 gross Worker Tokens** (31,608 input, 13,647 output,
400,768 cache read); top-level and per-model counters matched. The runtime
estimate was **USD 0.699599** and the DeepSeek PAYG estimate was
**USD 0.027075154**, not a Provider bill. No exact paired direct-Main baseline
exists, so direct savings remains unavailable.

Main did not accept the candidate despite machine success. It called the Hub
access token “one-time”, although the token remains valid for the Hub owner's
lifetime, and one sentence implied the Hub manages the daemon instead of being
an independent control surface. Main recorded `revise`, started no second
Worker, retained the recovery journey, and corrected only those factual/boundary
gaps. The current source again passes the focused 11/11 lifecycle tests, the
full 1,383/1,383 suite, strict TypeScript, and `git diff --check`.

This exposed a result-adjudication gap: `remediate verify` accepts only a machine
`failed` or `interrupted` Task. A machine-succeeded candidate that Main correctly
marks `revise` cannot receive a no-Worker `verified-repaired-delivered`
disposition, even when Main fixes and independently verifies the source. The
original candidate also cannot be safely accepted because Main acceptance binds
its reviewed patch digest. Therefore this delivery was not sent through automatic
Integration/activation and M0 remains **0/3**. The daemon stays on PID `21176`
with matched build id
`e138a43deae2a9fd689c480cdb8e555b49add6f8c5cea18f428a654efff73dcf`.
Next close this specific adjudication path without weakening patch-digest binding
or letting a successful Task silently mutate after review.

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

## Latest dogfood — 2026-07-28 Worker Quality Hub configuration

ForkLight Task `fc507e1a-4332-456c-82d6-d91a708b94df` used one DeepSeek
`deepseek-v4-pro[1M]` Attempt with no competition, correction, retry, adaptation,
or per-Task cap. Main intentionally avoided a three-model competition because
this new task class had no comparable evidence and multiplying the run would not
improve the product boundary enough to justify the Token cost.

The Worker produced the shared-resolver bridge, editor, effective preview,
localization, and focused tests in 90 turns. Its candidate was largely reusable,
but Main recorded `revise`: blank maximum fields merged back to the old Worker
override instead of representing either global inheritance or explicit unlimited,
the mode could not return to global inheritance, and one static test searched for
an HTML id attribute even though the application sets the DOM id in JavaScript.
Main started no second Worker. It retained the implementation, added explicit
inherit/unlimited/limited maximum states, made blank minimums mean inherit while
preserving explicit zero, changed edit/save to submit the full visible draft so
old overrides can be removed, and rewrote the copy around user outcomes rather
than raw policy terms.

Focused Quality/Hub verification passes **127/127** and the full suite passes
**1,402/1,402**, together with strict TypeScript, production build, Hub JavaScript
syntax, and `git diff --check`. Remediation check
`f54b5b11-f14c-44c1-a12a-8d3e1296b99f` passed the original **5/5** commands and
recorded `verified-repaired-delivered`; the machine Task remains `failed`.

The Attempt used **10,697,062 gross Worker Tokens** (147,256 input, 34,222
output, 10,515,584 cache read), with matching top-level and per-model counters.
The runtime estimate was **USD 6.849622** and the DeepSeek PAYG estimate was
**USD 0.131948492**, neither of which is a Provider bill. There is no exact-pair
direct-Main baseline, so direct Token savings remains unavailable; the displayed
boundary range is only an isolation estimate, not a claim that Main would have
spent the same Tokens.

The production daemon is PID `52511`; client and daemon match build id
`930e60f612cf818d4d41968c9b4a49916dd6631ff679fb879f6836a8ba0d83db` and source
digest `573c6484b0ffbf325d96ff653810d03feec549301ed9f201cd952a3b9c55f5ba`.
This was a Main repair plus manual runtime handoff, not automatic Integration
activation, so the M0 live-exit count remains **0/3**. No commit or push has been
performed.

Real-browser QA first exposed that the long-lived Hub owner was still serving an
older API process while static assets already reflected the rebuilt UI. The new
form therefore rendered correctly, but its Quality preview response omitted the
new rows and silently showed the empty state. Main stopped only the descriptor-
owned PID and restarted one Hub owner on `127.0.0.1:56962`. After that handoff,
Chinese and English both explain that these are Task-authoring expectations, not
Worker output limits; unlimited resolves from Worker, explicit zero remains a
Worker override, clearing it restores the global value, and the browser reports
no warnings or errors. No Worker setting was saved during QA.

The same handoff exposed a separate lifecycle gap: SIGTERM released the exact
listener and owner files, but the old Hub process did not exit within seven
seconds and required an exact-PID SIGKILL after ownership had already been
released. This is now the next bounded M0 candidate, not an expansion of the
completed Quality delivery: Hub replacement needs build identity, a bounded
graceful stop, and proof that the old PID is gone before a new owner is called
active.

## Latest dogfood — 2026-07-28 version-aware Hub owner handoff

ForkLight Task `b14dca06-a543-4329-b6df-8dca459bc57c` used one DeepSeek
`deepseek-v4-pro[1M]` Attempt with no competition, retry, correction,
adaptation, or per-Task cap. The Worker candidate was reusable, but its focused
suite passed **57/58**, the full suite passed **1,411/1,412**, and strict
TypeScript found three errors. Main recorded `revise` instead of starting
another Worker.

Main kept the candidate and repaired both the false test setup and the safety
boundary. The final flow freezes the exact claim and descriptor bytes, proves
the authenticated owner again immediately before SIGTERM, fails closed if a
replacement appears while waiting, and calls the handoff complete only when the
old PID, listener, claim, and descriptor are all gone. It never escalates to an
automatic SIGKILL. Concurrent Hub shutdown paths now await one shared stop
promise, so a signal handler cannot return before the server has actually
closed.

Focused Hub ownership verification passes **59/59**, the full suite passes
**1,413/1,413**, strict TypeScript and Hub JavaScript checks pass, and
`git diff --check` is clean. Remediation check
`5198196f-e602-4ac4-9114-5fd25da2b13c` passed the original **5/5** commands and
recorded `verified-repaired-delivered`; the machine Task remains `failed`.

The Attempt used **4,099,628 gross Worker Tokens** (117,497 input, 41,651
output, 3,940,480 cache read). The runtime estimate was **USD 3.599000** and the
DeepSeek PAYG estimate was **USD 0.101631805**, neither of which is a Provider
bill. The receipt-derived Main exchange envelope is **144,284–879,326 Tokens**;
without an exact-pair direct-Main baseline, the arithmetic boundary range is not
reported as saved Main Tokens.

Main then performed a real version A→B handoff on `127.0.0.1:56962`. The normal
start recognized the live A owner as a different build and did not signal it.
The explicit confirmed restart proved the exact A owner, waited for PID `16845`
to exit, and started B as PID `17258` on the same port with exactly one listener
and the B descriptor. The daemon was manually refreshed to PID `17712` and the
client, daemon, and Hub artifacts matched build B at verification time. This
was a Main remediation plus manual Hub/daemon handoff, not an accepted Worker
patch applied through automatic Integration activation, so M0 truthfully
remains **0/3**. No commit or push has been performed.

## Latest dogfood — 2026-07-28 first successful automatic self-upgrade

ForkLight Task `8b3528b5-f9f1-495d-abb5-687f43be66d5` added the public
`forklight daemon restart` command by routing it to the existing shared,
fully-awaited restart helper. One DeepSeek `deepseek-v4-pro[1M]` Attempt ran for
27 turns with no competition, retry, correction, adaptation, time cap, Token
cap, or monetary cap. The Candidate changed two files / 197 lines: five product
lines in `src/cli.ts` and isolated real-process lifecycle tests.

Independent verification passed focused **118/118**, full **1,418/1,418**,
strict TypeScript, and `git diff --check`. Main reviewed the exact Candidate
Revision and accepted it without repair. Integration operation
`df91aaeb-d138-460c-9d7c-32af3d621b79` then passed all four required stages:
source apply, source verification, artifact build, and runtime activation.
The old daemon PID `17712` exited; the automatically activated daemon is PID
`39407`, has no active or queued Task, and reports build id
`eb249f02f7018440b38094caecb54b83c72360e40da10885811175273db4b9fe` with
source digest `0b4d3011172a79fbd6f4d7a9f520682576c792e55bdc9afed7c05c770ef18166`.

The stale Hub owner was then diagnosed without being signalled and explicitly
replaced through the shipped version-aware Hub handoff. Old Hub PID `17258`
exited naturally; PID `40369` now owns the same `127.0.0.1:56962` listener and
its private descriptor reports the same new build as the daemon. This manual Hub
refresh is ancillary evidence; the M0 count comes only from the successful
automatic Integration daemon activation.

The Attempt used **1,367,541 gross Worker Tokens** (86,146 input, 11,251
output, 1,270,144 cache read). Runtime estimate was **USD 1.347077** and the
DeepSeek PAYG estimate was **USD 0.051866152**, neither of which is a Provider
bill. The measured Main exchange envelope was **157,974–971,114 Tokens**. There
is no exact-pair direct-Main baseline, so the arithmetic boundary range is not
presented as saved Main Tokens. This is the first consecutive automatic M0
self-upgrade, so the gate advances from **0/3 to 1/3**. No commit or push has
been performed.

## Latest dogfood — 2026-07-28 MiniMax read-only Hub status review

ForkLight Task `14ed39d0-2cc0-4644-b199-737532cd29a6` used one MiniMax
`MiniMax-M3` Attempt with no competition, retry, correction, or adaptation. The
Worker produced a substantial, mostly reusable read-only Hub status Candidate:
four files / 765 lines, focused **45/45**, full **1,435/1,435**, strict
TypeScript, Hub JavaScript syntax, and `git diff --check` all passed.

Main nevertheless recorded `revise`. The public CLI always supplied the current
build identity, but the exported inspection function made that identity optional
and classified any proven versioned owner as `current` when the comparator was
omitted. That type boundary permits a future internal caller to state a false
version result even though today's CLI path is correct. Main did not start a
second Worker and did not accept or integrate the Candidate; M0 therefore stays
**1/3**.

The Attempt took 75 turns and used **6,770,903 gross Worker Tokens** (144,833
input, 47,908 output, 6,578,162 cache read). Runtime estimate was **USD
5.210946**. A MiniMax official per-request cost was unavailable because the
required billing rows were not present; no zero cost was invented. The Main
exchange envelope was **26,261–160,651 Tokens**. There is no exact-pair
direct-Main baseline, so the boundary arithmetic is not called saved Main
Tokens. The long read/thinking path and Main semantic miss remain model-routing
evidence. No commit or push has been performed.

## Latest dogfood — 2026-07-28 retained Candidate to automatic M0 2/3

Main retained the complete machine-verified Candidate from MiniMax Task
`14ed39d0-2cc0-4644-b199-737532cd29a6` rather than rerunning its 6.77M-Token
implementation. The only rejected fact boundary was extracted into DeepSeek
Task `6ff650f4-6123-4643-aa4a-82f15e63389c`: require a valid invoking build
identity before read-only Hub status can say `current`, make every next action
total, and fail closed for unsafe runtime callers.

The DeepSeek Attempt ran 21 turns and changed three files / 99 lines. Focused
status verification passed **46/46**, full verification passed **1,436/1,436**,
strict TypeScript, Hub JavaScript syntax, and `git diff --check` all passed.
Main accepted the exact Candidate Revision without repair. Integration operation
`55ccac9a-ab49-4308-bdf8-df575dfe60bc` passed source apply, all five source
verification commands, artifact build, and runtime activation.

The old daemon PID `39407` exited and the automatically activated daemon is PID
`52232`, running build id
`a655daf034eccd7ec5659f8d4b5f30af59672b5fc68e830462c0dd5279b8fee5` with
source digest `756df610253e814e936ce50e07d5b229f8349d0c6049eefb729134d8905febcf`.
Real CLI QA used the newly built `hub status` against the still-old Hub and got
only `different-build`, proven PID/port, and `restart-with-confirm`; it exposed
no token, nonce, URL, path, or raw build id. The explicit Hub handoff then let
old PID `40369` exit naturally and started PID `53147` on the same port. The
final read-only status is `current`, and daemon/Hub descriptors match the new
build with one listener and no active or queued Task.

The gap Attempt used **1,038,932 gross Worker Tokens** (69,138 input, 16,706
output, 953,088 cache read). Runtime estimate was **USD 1.239884** and the
DeepSeek PAYG estimate was **USD 0.048064194**, neither a Provider bill. The
Main exchange envelope was **152,555–937,782 Tokens**; no exact-pair direct-Main
baseline exists, so the arithmetic boundary is not called saved Main Tokens.
Because this was the second consecutive accepted automatic activation, M0
advances from **1/3 to 2/3**. No commit or push has been performed.

## Latest dogfood — 2026-07-29 Relay Daily Brief product slice

Main deliberately moved beyond another ForkLight-internal repair and used the
orchestrator on Relay's first read-only Daily Brief slice. MiniMax `MiniMax-M3`
implemented a deterministic Item / Assignment / Job mapper and Today-page
presentation. Main used exactly one retained-Candidate correction to close
three fact-boundary gaps, then stopped; no third Worker, retry loop,
adaptation, competition, or automatic Integration was authorized.

The Task remains machine-failed because Main froze an acceptance command that
hits Relay's pre-existing ESLint 10.8 / Next React plugin incompatibility even
on untouched source. Main did not relabel that as success. The reviewed target
files were applied manually, followed by bounded copy and responsive fixes.
Final evidence is focused **12/12**, ESLint 9 compatibility lint, diff hygiene,
and real desktop plus 390px browser QA. Global TypeScript remains blocked only
by the concurrent Team/Postgres optional `pg` dependency baseline.

The two Attempts used **8,014,119 gross Worker Tokens** (149,732 input, 63,313
output, 7,801,074 cache read) across 103 turns. The Main exchange envelope is
**144,638–875,918 Tokens**. No exact-pair direct-Main baseline exists, so this
is not presented as saved Main Tokens. This sample adds evidence that MiniMax
can converge on a bounded product slice, but its repeated-read path is too
expensive for a four-file deterministic UI task unless the task contract gives
more precise symbol and test entry points. No commit or push has been performed.

## Latest dogfood — 2026-07-29 R8 closes the reverify-to-Integration evidence chain

Relay R7 exposed a ForkLight correctness gap rather than a Relay product bug:
after Main repaired a retained Candidate, the zero-Worker `reverify` path could
append a passing verification but did not capture a new immutable
CandidateRevision for the repaired Diff. Fresh Main accept therefore rejected
safely and automatic Integration could not proceed.

Main used ForkLight itself to close the loop. Two exploratory DeepSeek Tasks
(`ac43b931-840a-49fb-938b-d551935f07b2` and
`1bf84201-e657-4c4c-9c80-43dd3c6dba26`) remained failed and were not integrated:
their independent tests first revealed that digest-only Main Review could reuse
an older same-byte revision, then exposed two test-fixture errors. Main kept
those failures truthful instead of relabeling Worker completion as success.

Final Task `2820723c-dbf6-4382-8459-511d0339dd62` froze
`baseMaxAttempts=1`, `maxExtraAttempts=0`, `maxMainCorrections=1`, and
`maxAdaptationRounds=0`. Attempt 1 failed with one real fixture error and one
invalid event spelling. Main recorded `revise`, authorized the single structured
Candidate correction with two explicit remaining gaps, and did not open another
Task or automatic retry. Attempt 2 then passed focused **135/135**, full
**1,565/1,565**, strict TypeScript, and `git diff --check`.

The accepted five-file Candidate now guarantees:

- candidate reverify appends canonical verification evidence, captures the
  exact current Diff for that verification sequence, and only then reports Task
  success;
- capture failure leaves the Task failed, preserves the retained Attempt,
  records content-free evidence, and performs no Worker/model retry;
- Main Review accept resolves CandidateRevision by exact current Attempt plus
  exact latest verification sequence before checking the current Diff digest;
- an older same-digest revision cannot substitute for missing new evidence;
  true legacy Tasks with no revision history retain the previous compatibility
  path.

Main accepted CandidateRevision
`99a8f260-4e77-465d-a3f5-b84c82ca2cf4`. Integration operation
`fa79ade9-50c8-40c3-8f5c-c05d7e0d5661` passed source apply, all four source
verification commands, artifact build, and runtime activation. Built CLI and
Daemon now match build
`5ed667126017b9e124fa2d42d2b6e7c209657dac4f8ceb14934e23e341cdce4d`
with source digest
`d7951afadd450270bf1d78243a03d8498a028738dfb3f13249d91af852d6b3ff`.
The old Hub exited cleanly; current Hub PID is `81114` on port `53005` with one
listener and status `current`.

Across the three bounded Tasks and the final correction, observed usage was
**10,661,297 gross Worker Tokens** (275,477 input, 116,380 output, 10,269,440
cache read). Claude Code runtime estimates total approximately **USD 9.421605**;
DeepSeek PAYG estimates total approximately **USD 0.258309815** and are not
Provider bills. No exact-pair direct-Codex baseline exists, so this is measured
Worker volume, not a saved-Main-Token claim. The current loaded Codex MCP remains
the pre-upgrade process and needs a real Codex App/plugin reload before its
identity can match the new build; matched CLI remains the safe control surface
until then. No commit or push has been performed.

## Latest dogfood — 2026-07-29 Grok connection truth and bounded fallback

手动 Grok TUI 可用而 ForkLight 超时的直接原因是运行环境不同：旧 Daemon 没有继承
`HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY`，其 Grok 子进程无法连接模型代理；鉴权文件副本的
大小与 SHA-256 一致，不是鉴权复制损坏。Main 在无活跃任务后从正确环境重启 Daemon，并用小型
Grok Task `6e07c4ab-1c57-4973-85fe-ceb70b0d0840` 证明真实路径可用。

这也暴露了第二个独立问题：Hub 仍把旧的“缺 xAI Keychain”记录当成连接失败，尽管 Grok 使用的是
可读本地登录。Main 先把修复任务交给 Grok 4.5（Task
`f297f232-05d8-47a1-85ed-d49fe760ddf6`），但它在复杂多模块任务中反复输出思考、没有执行任何
工具或产生工作区修改。Main 在一次 Attempt 内有界终止，没有自动重试、adaptation 或竞争，也
没有把进程启动误写成模型成功。

随后同一任务合同由 DeepSeek `deepseek-v4-pro[1M]` 执行（Task
`fee9d2c6-3c7e-4eb2-8af4-b268173aee6d`）。Attempt 1 产出可复用的七文件 Candidate；Main 只授权
一次结构化 correction，关闭“本地登录被当成远端验证”“未要求同 Attempt 的标准完成事件”“重复
判断逻辑”和 TypeScript 边界。Attempt 2 仍遗漏一个联合类型值，Main 不再启动 Worker，只在保留
Candidate 中完成定点修复并运行一次零 Worker reverify。该复验明确记录
`workerInvoked=false`、新增 Worker Tokens **0**、新增模型费用 **0**，聚焦 **77/77**、Daemon
**121/121**、全量 **1,585/1,585**、strict TypeScript、build 与 diff hygiene 全部通过。

Main 接受 CandidateRevision `419fca8d-d765-46f6-8e34-9374f2553a8e`。Integration operation
`9a98f399-38a0-4f3d-83f8-533839677801` 的 source apply、六条 source verify、artifact build、
runtime activation 四阶段全部 passed。新 CLI / Daemon build 为
`c90af447821493c71e246f8903cdb1c2fb319dec67c649a0ca35dc1548adcb35`；新 Daemon PID `3126`
仍继承三项代理变量名，Hub 已切换到新 build。

最终只读 Grok Task `cf54d876-eabf-4f3f-aa7f-cfb3718eb792` 在一个 Attempt 内约 24 秒完成，产生
同 Attempt 的 `worker.completed`、通过独立验收、Candidate 为空补丁并由 Main 接受。Grok Worker
现在为 `ready / ready / none`；显式 xAI probe 返回相同的 `worker-run` verified 证据，没有覆盖
它。DeepSeek 两次 Attempt 共 **7,657,029 gross Worker Tokens**（123,243 input、48,474 output、
7,485,312 cache read）。Main exchange 仅为低置信区间 **537,821–3,284,726 Tokens**；缺少
exact-pair direct-Codex baseline，所以仍不声称节约 Main Token。Grok CLI 未提供完整 Token usage，
因此两个 Grok Task 的 Worker Token 量保持 unavailable，不编造为 0。没有 commit 或 push。

该段当时记录的入口一致性缺口现已关闭。最终证据见下一条 dogfood：同一 smoke 文件已经通过新
build 的直接 `forklight run` 路径完成，不再依赖 `submit` 绕行。

## Latest dogfood — 2026-07-29 direct run and submit share saved Worker truth

真实 Grok smoke 暴露 `forklight validate` 和 Daemon `submit` 能识别保存的
`local-grok-builder`，但直接 `forklight run` 报 `Unknown worker profile`。根因不是 Provider、
网络或鉴权：`run` 手工构造的 TaskPolicy 遗漏 `workerProfiles` 与 `modelCatalog`；
`validate-plan` 还保留同样的潜在遗漏。现有 `taskPolicyFromSettings` 已是完整统一边界。

路由器因 `cli-entrypoint-parity` 零样本建议 competition。Main 基于两文件、确定性验收和已有
DeepSeek 后端证据覆盖为单 Worker，避免生成两份相同实现。DeepSeek Task
`4be4bee7-ef54-4314-a50f-75c835d36e6d` 用一个 69-turn Attempt 正确把两条 CLI 入口切到统一 mapper，
但它的测试合同缺第二场景而先被质量门拒绝，测试又依赖当前机器 Grok 登录，存在意外访问 Provider
的风险。Main 没有启动 correction Worker：保留生产改动，把测试改为隔离 `FORKLIGHT_HOME`、空
PATH 和未鉴权自定义 Qwen Worker，验证 exact Worker/provider/model/runtime 已落库、Attempt 数为
0，并额外覆盖 `validate-plan`。零 Worker reverify 记录新增 Worker Tokens / 模型费用均为 **0**；
聚焦 **9/9**、全量 **1,587/1,587**、strict TypeScript、build、diff hygiene 全部通过。

Main 接受 CandidateRevision `c7d8525a-b8ab-4b7a-9361-5cbc0c9f3875`。Integration operation
`ab55bd60-b8c0-411d-ae3e-9051cac09c06` 的 source apply、五条 source verify、artifact build、
runtime activation 四阶段全部 passed。当前 CLI / Daemon build 为
`45c15a076faeaca810cae8a145b5f0dac5d5bf0ce0838ecd16cdf47f67656595`，source digest 为
`3f569c895c290d93e4428e9bed2ce2042c9951343dc257930dc12f2a907ef5da`。Hub PID `7835` 在
`127.0.0.1:57006` 为 `current`，Daemon PID `4358` 无 active/queued Task。

新 build 随后直接执行 `forklight run examples/dogfood/grok-readonly-live-smoke.yaml`。Task
`58626b45-9544-4b52-baf4-cf8e2c018b29` 在约 11 秒内用保存的 Grok 4.5 Worker 完成，独立验收通过、
零文件变化并由 Main 接受，证明最初失败的直接入口已经恢复。DeepSeek Attempt 使用
**4,104,671 gross Worker Tokens**（74,861 input、24,434 output、4,005,376 cache read）；官方
PAYG 估算 **USD 0.068341603**，runtime estimate **USD 2.987843**。Main exchange 为低置信区间
**411,213–2,506,154 Tokens**；没有 exact-pair direct-Codex baseline，因此不声称节约 Main Token。
这个两文件修复的 69 turns / 4.1M gross 仍是负效率样本：下一次同等级确定性入口修复应优先 Main
直做，或把测试夹具入口写得更具体，而不是因为最终成功就继续委派。Grok runtime usage 仍不可得，
不把未知写成 0。没有 commit 或 push。

## Latest dogfood — 2026-07-29 refreshed clean-run artifact without self-referential SHA

M1.3 审计首先判定旧 `/Users/Shared/ForkLight-Clean-Run.cDgmCh` 已过期：它的 build 早于当前
`run` / `submit` 和 Grok readiness 修复，runbook 又明确禁止混用旧包。Main 没有启动 Worker，
而是直接执行真实 `npm pack`、独立 prefix 安装、tarball/安装后身份对照、CLI/MCP 入口加载和敏感
文件名扫描。

第一次新包预检完整通过，但也暴露文档结构问题：会被打进 tarball 的 runbook 和 acceptance 文档
硬编码“当前 tarball SHA”，更新 SHA 后重新打包会再次改变 SHA。Main 把构建权威值移到 tarball
外部同目录的 `bundle-evidence.json`；包内文档只规定校验协议，不再自引用具体 artifact。

按新协议做最终冻结时，第一次 prepack 在全量 **1,587** 项中出现 1 个 Hub fixture 失败。失败测试
使用独立临时 home，不会接触正式 Hub；它把已监听本地测试服务的 HTTP probe 限为 50ms，并行全套
测试时把调度延迟误判成 Hub control page 未就绪。Main 没有整套碰运气重跑，只把这一条成功场景的
测试等待放宽到 500ms probe / 1,000ms wait，不改产品默认。定点测试连续 **5/5** 通过后，只执行
一次最终完整 pack，prepack **1,587/1,587** 通过。

最终目录 `/Users/Shared/ForkLight-Clean-Run.TrcwKU` 为 world-readable，包含 tarball、外部
`bundle-evidence.json`、包内权威 `build-identity.json` 副本和无具体 SHA 的 runbook。Tarball SHA-256
为 `cb0359ef30e3e088c2cbc339e60a8e1912f3a901e34ef372da56671ef9652d98`；build id 为
`7426d0f154901f14b61cc7073afe853040734b561161cdf617b0bdc086b6c684`，source digest 为
`3f569c895c290d93e4428e9bed2ce2042c9951343dc257930dc12f2a907ef5da`。独立安装加入 95 个包；
安装后 identity 与 tarball 逐字一致，CLI 和 MCP entry 均正常退出，敏感文件名扫描无命中。

Main 还用安装后的二进制和隔离 `FORKLIGHT_HOME` 启动了一套临时 Hub/Daemon：Hub 被判定为
`current`，Daemon build 与 tarball 完全一致且没有 Task。随后两者均通过正常停止流程退出，PID
和监听端口消失；全过程没有读取或写入正式 ForkLight 数据。这补上了“安装包不仅能加载入口，也能
拉起完整本地栈”的证据，但仍不是陌生用户首次使用证明。

两次 pack 都会重新生成 build identity。每次之后 Main 都只在无 active/queued Task 时受控重启
Daemon 和 Hub，没有把 package build 留成运行态 mismatch。整个流程没有 Provider 请求、Worker、
Attempt、competition、retry 或模型 Token。它证明最新安装输入已准备好，但仍不能代替新 macOS
用户、VM 或新 Mac 的 Keychain、Main 安装、理解问答和 15–30 分钟计时；M1.3 保持 active。
没有 commit 或 push。

## Latest dogfood — 2026-07-29 Main can correct its own acceptance without rerunning Grok

ForkLight 现在支持一种此前缺失的收口：当 Worker 已完成工作、但 Main 写进 Task Contract 的某条
验收命令本身有误时，Main 可以只替换那条确切失败的命令，在当前源码上重新核验，不启动新的
Worker、Attempt、retry 或 adaptation。原 Task 与原检查失败仍保留，新的交付记录会明确标注
`amended-acceptance`，不会把 Main 的错误归因给模型。

实现由真实 Grok Task `de405e61-296b-458a-849d-be157d71d3fe` 完成。Grok 4.5 先后使用同一
Candidate 的两个有界 Attempt：31 turns 的基础实现和 18 turns 的一次结构化 correction；runtime
estimate 合计约 **USD 2.3043892**。Grok runtime 未提供完整 usage，因此 Worker Token 与官方费用
保持 unavailable，不写成 0。候选构建生成了 `dist`，使机器 Diff 达到 53 files / 3,377 lines，
自动 Integration 按安全边界拒绝。Main 没有放宽门槛，而是只选择 17 个源码/测试文件，排除生成物，
再补两个确定性边界：命令选择必须在整套验收中唯一，保存的 amendment 数量必须与实际执行结果完全
对应。

功能 Task 的当前源码复核为 4/4，并记录 `verified-repaired-delivered`。随后 Main 用旧 Task
`00b0cd43-eeba-40d1-9d6e-c5b5e6c73c1b` 做反向 dogfood：它的 Grok Attempt 实际 exit 0，失败来自
Main 写入不存在的 `npm run typecheck`。新链路只把这一个失败槽替换为真实 build 检查，5/5 通过；
原 Task 仍为 failed、Attempt 仍只有一个、新增 Worker 为 0。Hub 现在把这段过程显示为“Worker 已完成
执行；Main 修正了自己的验收定义；没有重跑 Worker”，同时保留原机器验证失败可见。

这轮还修正了通用 Hub 文案：`verified-repaired-delivered` 不再一律写成“Worker 执行失败”。机器检查
先通过再被 Main 定点补正、Main 修正自己的验收、以及普通保留候选修复，分别使用不同白话说明。
浏览器已在真实旧 Task 上确认看板和 Task Detail 的输入、执行、原检查、Main 修正与最终结果互不覆盖。

当前 full check **1,612/1,612** 通过；最终 UI 定点回归 **71/71**、TypeScript build、Hub JavaScript
syntax 和 diff hygiene 通过。CLI / Daemon build 均为
`2a1af014d710de1418e69e6c07dfe6fdafd2e7d8a9779280aa5df6f2c67b9175`，Daemon PID `52335`，
Hub PID `52169`、port `57778`、status `current`，无 active/queued Task。

关于最初的 Grok 超时，旧日志能证明当时是模型设置请求的 transport timeout / connection refused，
不是模型输出超时；当前 Daemon 与手动 TUI 的代理变量名和取值摘要一致，且新 ForkLight→Grok Task 已
成功。旧 Daemon 已退出，无法再独立重放其历史环境，因此不再把“旧 Daemon 一定缺代理变量”写成可
复现事实。TUI 常驻使用完整 `~/.grok` 状态，而 ForkLight 每个 Task 使用隔离 `GROK_HOME` 并冷启动，
这仍解释了为什么二者在瞬时网络/代理故障下表现可能不同。没有 exact-pair direct-Codex baseline，
本轮不声称节约 Main Token。没有 commit 或 push。
