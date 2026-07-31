# ForkLight Project Status

Last updated: 2026-07-31

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

## Current milestone: M3 — evidence-based model routing

ForkLight is now an **engineering Alpha** rather than a concept prototype. The
core `one Main → bounded Workers → independent verification → Main review →
safe Integration` loop is real and has been dogfooded with DeepSeek Pro,
MiniMax-M3, Volcengine GLM and Grok 4.5. **M2 is complete as a user capability.**
Its delivered chain includes an exact-revision,
one-to-three-judge Review Graph and a durable four-Task Goal run across daemon
restart. A real Grok + MiniMax graph proved partial-evidence retention and a
fresh Main decision without retry; live disagreement and bounded
no-progress/no-new-evidence stop proofs are now implemented and dogfooded.
One bounded two-judge live sample then produced two usable `accept` opinions;
Main still independently reviewed and accepted the exact Candidate, proving
that agreement does not become an automatic decision. ForkLight will not rerun
the same sample merely to manufacture disagreement. Durable cross-Worker
handoff is now implemented and dogfooded: Main retained one exact MiniMax file,
handed one remaining gap to Grok, recovered the same successor once after a
Daemon restart, then recorded a fresh Main accept and eligible Integration
preflight. A separate real Relay Gmail production Goal completed 4/4 integration
milestones with Grok-only implementation, two bounded same-Candidate
corrections, Main review, and source verification. A further Relay Gmail
history Goal (`examples/dogfood/relay-gmail-history-goal.json`) then completed
**5/5 at 2026-07-30T02:28:04.812Z** with evidence digest prefix `1ef72ccbdde7`.
That run composed five dependent Tasks, real daemon-restart persistence during
UI verification, MiniMax→Volcengine GLM cross-Worker handoff on the adapter,
bounded corrections (ended 3 of 3), review rounds (ended 2 of 2), zero
no-new-evidence cycles, Main repair against original acceptance, Review Graph
evidence surfaces, partial reuse, Main browser audit, and safe Integration.
This closes the M2 product chain: multi-Task durable Goal,
restart, handoff, bounded correction, Main review/repair, and reviewed
Integration without whole-task reruns or manual database/workspace edits for
progress. A natural live judge disagreement remains useful non-gating evidence and
will not be manufactured by rerunning the same sample. No path may vote,
retry indefinitely, or integrate without a fresh Main decision.
The M1 clean-user/external-user exit evidence remains open in parallel. The
representative real-project portfolio is now **13/10 satisfied** across Relay
and Elsewhere, using the user's current active-project rule; NovelRPGPlay is not
mandatory. M1 stays open only because an independent new macOS user, disposable
VM, or genuinely new Mac has not yet completed the install → configure → first
Task → understand → review → integrate → restart journey.
M3 is now the active product stage. It currently has **33 strict new-format
selection records, beyond the first 30-sample floor**. The portfolio now says
what those records can actually support: 13 are single-Worker decisions, 20
considered multiple Workers without comparable same-scope evidence, and 0 are
yet fair comparable cohorts. M3 therefore still needs natural, classified
samples plus comparable candidate cohorts rather than retroactive guesses.
Until then, routing remains explainable advice: Main can override it, missing
evidence does not trigger Competition, and no model is permanently excluded
after one failure. M4 exact-pair evidence and M5 external users remain open.
The automatic M0 upgrade mechanism remains proved. Its current
consecutive proof streak is **3/3 ready** after the latest complete self-upgrade;
the earlier source-verification rollback remains in immutable history and is not
rewritten away.
After every self-build, a long-lived Main must still re-check its MCP identity
before mutation; the matched CLI remains the safe fallback while a client
reload is pending.

**Latest M3 Main-direct decision slice (2026-07-31):** DeepSeek Task
`8825e122-038c-4843-a50a-06e94d1adb54` implemented
`docs/m3-main-direct-execution-decision-contract.md`. ForkLight can now record,
before work starts, why Main deliberately chose not to launch a Worker. The
durable record freezes the task type/family, one closed reason, a bounded note,
zero to four actually considered Worker Profiles, their local readiness, and
the relevant exact/family evidence available at that moment. It is a separate
two-stage lifecycle: explicit start, then one atomic completed/abandoned close.
It does not create a Task, Attempt, Workspace, Provider probe, Competition, or
model outcome, and it never turns zero ForkLight Worker Attempts into a claim
of zero Main Token, time, cost, or proven savings.

The first DeepSeek Attempt used 153 turns and delivered the main shape but
failed TypeScript, fixtures, UI wording, and several semantic boundaries. Main
kept the Candidate and authorized the single configured same-Candidate
correction. The second 86-turn Attempt reduced the machine failure to one test
and three TypeScript errors, but Main review still found raw terminal counts,
missing family evidence, non-canonical auth readiness, and a mutable close.
Main repaired those bounded gaps in the isolated Candidate and used the one
authorized zero-Worker reverification. All six original acceptance commands
passed; the complete repository, production build, both Hub syntax checks and
diff hygiene were green. Main accepted revision
`ae498015-c175-47b7-8e7f-bdb515a665cb`, digest
`f23ea0d2a6e43e47d0b4034cbcc49039cb3ea08531c4e3364ceefd4e951bb5e4`.

Integration `20d00974-6991-4356-8b00-378acaa528ad` passed source apply,
six-command source verification, artifact build and runtime activation in
17ms / 119,301ms / 4,573ms / 4,443ms. CLI and Daemon now match build
`d0104d9a7a0679d97d444a7479de53eb8583044406eeeafa432fdffde4437451`;
Hub PID `61260` is current on port `58675`; M0 remains **3/3 ready**. The first
honest production use was opened before this status-file update as decision
`4050d182-a692-49c9-9cf6-3611088d58a8`, with DeepSeek and Volcengine GLM
recorded as considered and evidence scope `none`. No historical prose was
backfilled.

The two Worker Attempts used **42,171,072 gross Tokens** and reconciled exactly.
DeepSeek's official quote totals **USD 0.31024171**; runtime estimates total
USD 24.05908. The low-confidence 35,667,465–41,105,685 Token boundary range is
Worker-side volume minus orchestration exchange, not measured Main Token
savings. Exact-pair Direct Codex evidence is still missing. The current routing
coverage is `317 terminal / 203 class / 85 family / 33 complete`, split into
`13 single / 0 comparable / 20 unknown multi / 0 unusable`. No commit or push.

**Latest M3 Worker activity truth slice (2026-07-31):** DeepSeek Task
`ef79d43e-29cd-45f6-a3e7-94fa4b3c9454` implemented
`docs/m3-worker-model-processing-observability-contract.md`. ForkLight now
distinguishes four user-meaningful facts instead of collapsing them into
“running”: the Worker process has started, the model runtime is still actively
processing, a visible model response has arrived, and a tool is executing.
Runtime processing markers are coalesced to at most one durable event every 15
seconds. Their public summary is fixed, carries no raw reasoning prose, and
cannot override an open tool, verification, or terminal outcome. Hub explains
the new state in plain English and Chinese without claiming that useful output
already exists or that a Provider network request is definitely in flight.

The single 88-turn Worker Attempt produced a useful 11-file base Candidate but
failed one precedence assertion. Main retained it and found four additional
semantic edges: late processing could overwrite verification, a legacy Grok
test still used the old state, Grok thought summaries could retain raw prose,
and Grok processing was not throttled. Main repaired the same isolated
Candidate, added the dedicated Hub meaning, and used zero-Worker reverification
instead of starting another Attempt. All six original acceptance commands
passed; the focused review set passed **215/215** and the complete repository
passed **2,001/2,001**. Main accepted revision
`cfd061c5-2530-4cec-9dd3-9b52d9bc0ec1`, digest
`aeebca40f690538ed8db025d9f84d6147c7c61e323505e90fac3c8a7b3f063c0`.
Integration `d8edb852-859a-4800-a6a8-d0104bdd1c1a` passed source apply,
six-command source verification, artifact build, and runtime activation.

The Attempt used **6,820,551 gross Worker Tokens**, including **6,692,096
cache-read input Tokens**. DeepSeek reported an official quoted cost of
**USD 0.093336413**; the runtime estimate was USD 4.595203. Usage reconciliation
matched exactly. The 5,346,980–6,579,719 Token boundary range means those Tokens
stayed on the Worker side of the orchestration boundary; it is low-confidence
and is **not** a measured direct-Codex saving because the exact-pair baseline is
missing. The authoritative projection is now `314 terminal / 200 class / 82
family / 30 complete`, so the first M3 sample floor is reached by a natural
product Task. M3 remains active for sample diversity and comparable cohorts.
Real Hub dogfood shows the Task as the first item in 25/126 loaded History with
verified delivery and runtime activation. Its Chinese and English Task Detail
both lead with Main input, Worker claim, independent checks, and final delivery;
the browser console is clean. Because the Task was already terminal after the
new build activated, this pass did not manufacture a second billable Task just
to stage the live processing badge; deterministic event/Hub tests cover that
transition until the next natural active Task. No commit or push.

**Latest M3 comparison-readiness slice (2026-07-31):** DeepSeek Task
`2d95e5ed-1f93-4daf-90ec-87a8f5faca3c` implemented
`docs/m3-routing-decision-readiness-contract.md`. The existing count of complete
Worker-selection records is no longer presented as proof that ForkLight knows
which model is best. Core now classifies each immutable decision-time record
into exactly one of four buckets: one Worker, comparable multiple Workers,
multiple Workers without comparable evidence, or unreadable history. A fair
comparison requires at least two distinct frozen Worker identities and an
exact-task or task-family evidence scope; malformed, partial, duplicate, or
missing-scope records fail closed instead of being narrowed or guessed.

The one 75-turn Worker Attempt produced a useful base Candidate but failed the
UI source-style boundary. Main retained its six files, repaired the fail-closed
classifier and bilingual copy, and did not launch a correction Worker. The one
authorized zero-Worker Candidate reverify caught a remaining wording assertion
and consumed its bounded allowance; Main fixed that final sentence, verified
the exact Candidate at **2,018/2,018**, then safely applied the six files only
after each source file exactly matched its Task baseline. A ForkLight Main
remediation check reran all six original commands and passed 6/6, recording
`verified-repaired-delivered` while preserving the original machine-failed
Worker result. This is intentional evidence separation, not a rewritten green
Attempt. Final delivery is 6 files / 704 changed lines, with no correction,
retry, adaptation, Competition, commit, or push.

Real portfolio projection is now `315 terminal / 201 class / 83 family / 31
complete`; readiness is `13 single / 0 comparable / 18 unknown multi / 0
unusable`. Real Hub browser QA passed in English and Chinese, shows the same
numbers and limitations, and has no console errors. The Attempt used
**5,622,247 gross Worker Tokens** and DeepSeek quoted **USD 0.095490127**; usage
reconciliation matched. The low-confidence 4,016,547–5,359,978 Token boundary
range only measures Worker-side workload separated from orchestration exchange.
Direct-Codex savings remain unavailable because the exact-pair baseline is
missing. M3 remains active: the next evidence goal is to accumulate natural
same-scope cohorts, not to manufacture comparisons or rerun this Task.

**Latest M3 durable Task History slice (2026-07-31):** Volcengine GLM Task
`e739f892-2311-4733-b792-ca0b068dd090` implemented
`docs/m3-hub-durable-history-pagination-contract.md`. The existing recent Task
feed stays bounded to 50 and keeps its page-scoped polling behavior. A separate,
explicit History read model now searches all canonical delivered/stopped Tasks,
loads 25 at a time, and is never automatically polled. Search covers only safe
summary facts (name, status, Provider, model, runtime); cursor paging is
deterministic, query-bound, and rejects a missing or stale anchor rather than
silently restarting the result set.

GLM used one 145-turn base Attempt plus one 22-turn same-Candidate correction.
Main then found three semantic edges that the machine suite had not exposed:
retry after a failed new search could reuse the prior query's cursor, malformed
optional daemon fields were treated as absent, and a structurally valid forged
cursor did not prove its exact issuing anchor. Main repaired those bounded edges
in the retained Candidate and used zero-Worker reverification; all six original
acceptance commands passed. Main accepted revision
`dc5884d3-e9be-4011-bf14-b748a4116a85`, digest
`48ab74a3efa1a547d5acad63f8c37f94779ed9366a8efceb4c22d4e9c3c66f81`.
Integration `90addb30-8873-4359-a7a5-56c06fb3a3d7` passed source apply,
source verification, artifact build, and runtime activation.

Real Hub dogfood found **125** canonical History records: first load 25/125,
Load more 50/125, and an exact Task-name search 1/1. Desktop and 390px layouts
are readable with no horizontal overflow. The first browser pass also exposed
one presentation mismatch: before History loaded, its scope chip showed the
number of closed Tasks inside the recent 50 as though that were the archive
total. Main fixed the chip to omit the badge until History loads, then show the
authoritative total. Focused Hub coverage is 116/116; the complete repository
check is **1,992/1,992**, with build, JavaScript syntax, and diff hygiene green.

The two Worker Attempts used **41,784,497 gross Worker Tokens** (41,098,688
cache-read input) and runtime estimates totaling **USD 28.639989**. The
subscription plan exposes no per-request official price. Usage reconciliation
is 2/2 with zero delta. The low-confidence 36,744,776–40,956,357 Token boundary
range is not a direct-Codex counterfactual; Main Token savings remain
unavailable. The authoritative Hub projection now reports `313 terminal / 199
class / 81 family / 29 complete`, so M3 reaches **29/30** through a natural
product Task rather than a manufactured sample. No commit or push.

**Latest M0 runtime truth (2026-07-31 07:25 CST):** the canonical read-only
`forklight upgrade status --required 3 --json` reports **3/3 ready**. Latest
qualifying operation `d8edb852-859a-4800-a6a8-d0104bdd1c1a` completed source
apply, fresh 6/6 verification, artifact build, and runtime activation at
`2026-07-30T23:25:33.216Z`. The earlier failed exact-profile operation remains
the historical break; later complete qualifying upgrades rebuilt the streak
rather than rewriting it.

CLI and Daemon now match build
`68e9971f05e00fc538d1dcb4364cf4556135db81a394c3d0f8005ee18efe7c82`, source
digest `5eebced0292dca9f7b9413154b6d6590734e91b4a95704e924cd52828ae0349c`.
Daemon PID is `77255`; the detached Hub restart reused port `58675` with PID
`93421`, and Hub status is `current`. Only an Integration receipt carrying the exact durable
`forklight-self-upgrade` Delivery Profile identity can add to or break this
streak. Ordinary App integrations remain neutral. Physical-process kill
recovery from an intermediate Integration stage remains a separate resilience
capability. Each long-lived Main must still use its own MCP health identity or
the matched CLI until its host reloads.

**Latest M3 Hub execution-efficiency slice (2026-07-31):** DeepSeek Task
`ae26a404-f038-4483-af72-a7a6e971d3ec` replaced the one-size-fits-all Hub poll
with a visible-page request plan. A hidden browser tab now starts zero polls;
settings-oriented pages read only shared status and health (2 requests per
cycle), Tasks / Plans / Goals / Competitions use 3, Insights uses 5, and the
evidence-rich Overview uses 8. The previous loop issued the same 12 requests
on every page. Tab changes and visibility return refresh immediately, while
overlapping triggers collapse to one in-flight batch plus at most one pending
follow-up. A 401 stops the loop, and one failed page endpoint retains prior
evidence with an explicit stale state instead of clearing it or claiming live.

DeepSeek used one base Attempt plus one authorized same-Candidate correction;
Main then fixed one deterministic test parser and the remaining stale-status
truth gap without another Worker. Zero-Worker Candidate reverification passed
5/5, including the complete **1,975/1,975** test suite, build, Hub JavaScript
syntax, and diff hygiene. Main accepted revision
`3248fc9b-7bb5-42ba-b37c-05238a3ee908`, digest prefix `17e1c07a`.
Integration `2ff96e97-202f-4ef3-932a-53285630b34c` passed all four stages and
activated the runtime above. The Task adds the 28th strict routing record.
Its two Attempts used **11,997,348 gross Worker Tokens**, including
**11,807,616 cache-read input Tokens**. Official quoted DeepSeek cost totals
**USD 0.155575053**; runtime estimates total **USD 8.242768**. Usage
reconciliation is 2/2 with zero delta. The reported 10,150,931–11,695,775
Token boundary range is low-confidence workload separation, not proof of Main
Token savings; the exact direct-Codex baseline is still missing. No commit or
push.

**Latest M3 Main-direct efficiency decision (2026-07-31):** the Hub polling
dogfood exposed a deterministic Task-admission waste: `workspace.exclude`
matches one directory/file name per path segment, but a path-shaped value such
as `src-tauri/target` was silently accepted and therefore failed to exclude a
2.4GB build tree. Main deliberately did not delegate this small, fully
specified parser fix. Task admission now rejects paths, backslash paths, globs,
`.` and `..` before workspace scanning or Worker launch, and explains to use
`target` instead. Valid names remain deduplicated and unchanged. Configuration
documentation records the same rule. Focused Task parsing is **100/100** and
the complete repository check is **1,976/1,976** with build and diff hygiene
green. Daemon and Hub were rebuilt and restarted on the current identity above.
This consumed zero Worker/model Tokens, creates no synthetic 29th M3 routing
record, and does not alter the 3/3 Integration-backed self-upgrade streak.

**Latest M3 Hub information-architecture slice (2026-07-31):** DeepSeek Task
`4afdcd84-1068-4f0a-87ec-6252a0386d4c` implemented the first operations-first
Hub slice under `docs/m3-hub-human-information-architecture-contract.md`. Main
retained the Candidate, issued one bounded correction, repaired one over-broad
diagnostic filter, and used zero-Worker reverification. Final accepted revision
`4d9de8e4-d4f4-4202-8701-4ea0286f3607`, digest prefix `370200f`, passed all six
acceptance commands and was delivered by the successful self-upgrade above.

Overview now leads with live state, attention, and active work; configuration,
version, Goals, Plans, and system status are compact secondary sections. Task
Detail leads with four questions: what Main asked, what Worker returned, what
independent checks found, and what was finally delivered or should happen next.
Failure summaries remove harness noise and private run-workspace prefixes while
preserving the first concrete project diagnostic. Browser dogfood on a real
failed Gmail Task now shows
`src/adapters/connectors/gmail.ts:96:21: ERROR: Expected ">" but found ";"`
instead of `^`, npm script headers, or an internal workspace path.

Focused Hub tests are **195/195**. The final full run built successfully and
passed **1,942/1,944**; its only two failures were elapsed-time assertions in
`tests/daemon-cli.test.ts` under the heavily loaded full suite. That unchanged
file passed **14/14** alone, including the relevant case in 934ms. Main did not
loop full-suite retries to manufacture a green number. Hub and Daemon are
running the final build above. No commit or push.

**Latest M3 Hub Now/History slice (2026-07-31):** Volcengine GLM Task
`fbee9c6c-3d1c-4d08-9126-55ef20a88ea9` implemented
`docs/m3-hub-now-history-information-architecture-contract.md`. Board placement
comes from canonical Core evidence instead of guessing from UI status text.
`Now` contains work still needing action, Main review, correction, Integration,
or failure resolution; `History` contains only durable delivered or stopped
outcomes and explicitly describes itself as recent loaded history, not a
complete archive. Default scope is Now, with Now / History / All available in
both Chinese and English.

Attempt 1 passed every check except one trailing blank line. Main removed only
that line and used zero-Worker reverification, then found two semantic gaps:
verified repaired delivery did not outrank an older Main rejection, and Hub
validated placement tokens without validating their legal pair. One authorized
same-Candidate correction fixed both and added regression tests. Main accepted
revision `0a8c8ceb-391f-4aa4-bab8-f48a56c29261`, digest prefix `18831cd`.
Integration `72e66729-fbc6-4ff8-8192-fc994c946bfb` passed all four stages and
activated the current build above. Final focused plus full checks passed
**1,961/1,961**, with build, Hub JavaScript syntax, and diff hygiene also green.

Real browser dogfood confirmed `Now 10 / History 40 / All 50`: machine-passed
Tasks still awaiting Main or Integration remain in Now; the new Task and
verified repaired deliveries appear under Delivered in History. Chinese,
English, desktop, and 390px layouts are readable, and the Hub console has no App
errors. The Task used 2 Attempts and **35,627,650 gross Worker Tokens**, of which
**35,097,344 were cache-read input**. Runtime estimates total **USD 23.547822**;
the Provider did not quote official per-request cost. Usage reconciliation is
2/2 with zero delta. Direct-Codex savings remain unavailable because no exact
counterfactual baseline exists; the low-confidence boundary-reduction range is
not presented as Main Token savings. No commit or push.

**Latest M3 real-product dogfood (Elsewhere M2 UI, 2026-07-31):** DeepSeek Task
`c3b636f3-3ada-478a-8b8d-f2fad6916ce6` implemented the missing reviewed
world-to-direction experience in an isolated Candidate while Main retained product, visual, and Integration authority. Two bounded Attempts
produced the reusable implementation; Main corrected only the remaining deterministic tests, persistence-truth and reopen/call-timing gaps,
trace mapping, plain-language copy, and one finish-review contrast blocker. A zero-Worker reverification then passed all four original commands.

Main accepted revision `0b1eaf57-b2c1-480c-9c2c-33a7f8a98646`, digest prefix
`4f8b5cef0968`. Integration `aa8e53f6-f8df-422a-9598-a39e102b2989` safely
stacked 11 UI/test/design files over 15 existing Elsewhere backend/test/status changes and passed source apply plus 4/4 source verification.
The source tree then passed Core boundary, strict TypeScript, full **196/196**, production build, diff hygiene, and Rust **5/5**. Final product
review covered English/Chinese, truthful persisted-save feedback, zero-call reopen, explicit first-call timing, personal/source separation, and
1440×900 plus 860×640 layouts. No commit or push.

The two Attempts used **22,908,894 gross Worker Tokens**, of which **22,640,256** were cache-read input; official quoted Provider cost totals
**USD 0.246182073**, while runtime estimates total **USD 14.835898**. The retained-Candidate reverification invoked no Worker and added zero
Worker Tokens/model-runtime cost. ForkLight can report only a low-confidence Main/Worker boundary estimate here; without an exact direct-Codex
counterfactual it still cannot claim how many Main Tokens were saved.

**Latest M1 real-task portfolio truth (2026-07-30):** three completed durable
Goals provide **13 distinct delivered user outcomes**: Relay Gmail production
readiness **4/4**, Relay Gmail incremental history **5/5**, and Elsewhere
experience redesign **4/4**. The count is by delivered Goal milestone, not by
Attempt: corrections, handoffs, judge runs, and reverifications do not create
extra samples. Eleven outcomes have exact accepted-Candidate Integrations. Two
retain their failed machine Task truth but have explicit Main-repaired delivery
evidence: one against the original acceptance contract and one against formally
amended acceptance. The portfolio spans domain behavior, UI/interaction,
Provider integration, transactional recovery, restart durability, failure
preservation, onboarding, and documentation. No manual database or internal
configuration edit was used to advance these Goals, and no more Worker Tasks
should be launched merely to increase the M1 count. The authoritative evidence
table is `docs/m1-real-task-portfolio.md`.

**Latest M1 Task Detail evidence:** Grok Task
`c0c352a1-198c-4469-9bf7-c69183c845be` first closed a real presentation
contradiction: a terminal Task can retain a raw Attempt row recorded as `running`,
but Task Detail now derives its primary wording only from terminal Task and ordered
Worker events. The follow-up Grok Task `05b5cfe2-e2c8-4477-b131-73dd740441d0`
then closed FL-D256 without deleting raw audit evidence: the real Relay record still
contains **1,546** `worker.message` transport events, while the Hub Process view
projects **38** readable milestones, with zero token-fragment rows under
`其他活动`. Focused tests are **131/131**, full tests **1,864/1,864**, build and
syntax checks pass, and desktop plus 390×844 browser audits have no page overflow
or console warning/error. FL-D256 is now closed. These changes improve M1
explainability but do not replace the clean new-user journey. The same live audit exposed a separate activity-log
token-fragmentation issue, recorded as FL-D256 rather than expanding this delivery
or starting an automatic retry loop.

**Latest M1 real-project delivery evidence (Elsewhere, 2026-07-30):** the
approved experience-redesign Goal is now **4/4 delivered**; three milestones use
exact Candidate Integration and the final milestone uses verified Main-repaired
amended-acceptance delivery. Progressive-intake
Task `40854bb0-6f21-4e73-88bb-ff842e1b7c19` retained the useful Grok 4.5
Candidate after its original machine failure instead of rerunning the whole
Task. Main performed one bounded repair pass in the isolated workspace, reviewed
the complete 10-file diff and the rendered 1280×720 flow, then used zero-Worker
Candidate reverification. All original acceptance commands passed: typecheck,
**122/122 tests**, core-boundary lint, production build, and diff hygiene.
Revision `1c0e0070-259c-43a4-a804-89fff767c65e`, digest
`afd36c20723c6d34d7df20cb2f804f45c6e02b3f54e2f5be644a1215b14c5d87`,
was accepted and Integration `11717644-20ac-48c2-aedb-04e7adfe5af5`
completed source apply plus a fresh 5/5 source verification.

The delivered flow now preserves a stable Journey identity across retries,
reuses completed fact-review work when only draft cleanup fails, recovers a
completed draft, isolates late results after Pause, prevents silent draft
replacement, locks language during an active Journey, handles IME Enter, and
uses readable bilingual sentence completion. The Worker Attempt remains
honestly recorded as one 27-turn Grok run with runtime estimate USD 1.3400232;
usage is missing, so official Worker Token/cost and exact-pair Main savings are
unavailable. The Main repair and reverification added zero Worker Tokens and
zero model-runtime cost. The final `fact-mirror-finish` Task
`ed7cb0c3-74fb-4b98-bb68-d3381b0eb7d6` has now also been delivered to Elsewhere
source. Its single Grok 4.5 Attempt ran 36 turns (runtime estimate USD 1.5739636,
terminal usage missing) and produced a 21-file / 1,683-line reviewed Candidate.
Main kept the useful implementation, made one bounded repair pass, and did not
start a correction Worker. Browser review found and fixed two real usability
defects: the active fact-mirror layer was accidentally rendered at 28% opacity,
and the 1280×720 layout crowded the footer and actions. Focused tests are
**55/55**, full tests **142/142**, and typecheck, core-boundary lint, production
build, and diff hygiene pass.

The original acceptance was **5/6** only because the Impeccable detector emitted
192 advisory-only findings while exiting 2, contradicting its documented
advisory behavior. Main recorded a typed `revise`, bound it to the exact Attempt
and verification event 1951, then used a formal contradictory-acceptance
amendment that fails on malformed output or any non-advisory finding. Remediation
check `086d46e3-7fa6-4c0a-a4c4-eb3407d7b639` passed **6/6** with disposition
`verified-repaired-delivered` and `acceptanceBasis=amended-acceptance`. The exact
patch passed a read-only hunk check and was applied to Elsewhere source; there was
no commit or push.

**FL-D257 is closed (2026-07-30):** Grok 4.5 Task
`113ce5fd-80ea-4f59-9a61-eb955c257543` delivered a read-only Goal resolver that
accepts amended remediation only after re-proving the current Task/Attempt,
latest failed verification, latest bound Main `revise`, canonical failed-slot
replacement, byte-identical executed suite, matching passing private check and
compact disposition, exact completion event, and absence of later stale evidence.
Compact rows, missing/corrupt checks, mismatched commands, later verification or
review, and changed Attempt all remain fail-closed. Goal projection distinguishes
exact Candidate Integration, original-acceptance Main repair, and amended-
acceptance Main repair; Hub explains the three in plain English/Chinese and does
not show the raw `amended-acceptance` token as visible beginner copy.

The Worker used 1 Attempt / 26 turns with runtime estimate USD 0.9932396 and
missing terminal usage. Main retained the 5-file Candidate, added canonical
command-by-command proof, removed the visible raw basis token, and used one
zero-Worker reverification. Final revision
`4d6b8e5e-f906-45d1-8ab1-de0eaac2aae8`, digest
`89d6be571939a9a6a70b117fb236620b45d81d5cdca8bf669d4a05da3f5051e0`,
passed **115 focused tests**, full **1,879/1,879**, build, syntax, and diff
hygiene. Self-upgrade Integration `9a0cc4f0-7f60-4e23-8da7-424bd3992565`
passed source apply, fresh 5/5 source verification, artifact build, and runtime
activation. CLI/Daemon now match build
`969a09c15e73afc843382230f08e6a408c17720110ff20433064a62f5b17ef0e`;
Hub was replaced on the same port 58675 and is `current` with one listener.
The original Elsewhere Goal now truthfully reports **4/4 completed** while the
final machine Task remains `failed` and visibly uses Main-repaired amended-
acceptance delivery rather than invented Integration. M1's representative
project portfolio is now 13/10 satisfied; external clean-user evidence remains open. The Main reverification
added zero Worker Tokens/model-runtime cost; missing Worker usage and a missing
direct baseline still prohibit a Main Token-savings claim. The 40 recorded
orchestration receipts support only a low-confidence Main-exchange range of
551,191–3,354,933 Tokens; that is exchange volume, not saved Tokens. No commit
or push.

**Latest M3 evidence truth (2026-07-30):** the canonical read-only projection now
finds **304** terminal ordinary Tasks after excluding Review Graph reviewers:
190 carry an exact task type, 72 a stable task family, and only 20 carry type +
family + Main's stored Worker-selection decision together. Those records are
fragmented across 154 exact types and 19 families. The current strict count is
therefore **20/30 minimum**, not 304/30: old Tasks without the
three explicit facts are not backfilled by guessing.

The twentieth record is natural Elsewhere product work rather than evidence
manufactured for routing. Story-direction Task
`a44b22f3-9df7-4948-9107-ce88b9fc526f` selected only Grok 4.5 for one bounded
`product-ai-contract-workflow` Task and did not run Competition, automatic retry,
adaptation, or a second Provider. Its single 28-turn Attempt produced a reusable
13-file Candidate: the focused suite passed 53/53, while three TypeScript errors
prevented the complete check and build. Main retained that Candidate, corrected
the atmosphere-only review boundary, kept StoryDirective out of the unchanged
closing-letter input, fixed the compile edges, and added regression coverage in
the isolated workspace. One zero-Worker reverification then passed 4/4 original
commands, including focused 53/53, full 183/183, build, and diff hygiene. Main
accepted exact revision `c4daf5a5-bab7-4218-8a42-82472a8027d1`, digest
`3dc9ae7106d5def184158447b47aebd2f3f04264013ae2d4ab02f525cec0215e`.
The Candidate was later integrated to Elsewhere by operation
`c09f453a-dc00-4ee0-b101-2f84013139a4` and passed focused 53/53, full 183/183,
Rust 5/5, typecheck, build, and diff hygiene. The Client-Core SDK source-stability
RC released the Elsewhere freeze at 2026-07-31 02:20 CST. A fresh preflight then
correctly rejected duplicate application because the exact 14-file Candidate was
already present; Main did not write it twice. Post-release verification again
passed focused 53/53, full 183/183, Rust 5/5, typecheck, build, and diff hygiene.
The delivered work is preserved at a stable next-snapshot checkpoint. No commit
or push occurred.

Two real Grok self-upgrade Tasks closed a quality/efficiency gap without
Competition or whole-task retry. Task `305f3f3b-d2d7-4179-984e-2213ed88f370`
added separately configurable first-Attempt verified-success evidence, keeps
external/missing evidence unavailable, and preserves real provider/model names
for zero-history full Worker identities. Its 25-turn Candidate initially missed
one test-harness helper; Main retained the 12-file implementation, made one
bounded Candidate repair, and passed the original 5/5 suite through zero-Worker
reverification. Live routing then exposed a deeper same-Attempt edge: the later
Main reverification was incorrectly being read as the Worker's first pass.

Task `4a5e7421-83e9-41d2-8a16-c3e508a6e2fe` fixed that exact edge in one
5-turn Grok Attempt. First-pass evidence now reads the earliest valid independent
verification on Attempt one by durable sequence; final delivery still reads the
latest verification and stays fail-closed if that latest record is malformed.
Main rejected one out-of-scope fallback change, repaired the same 2-file
Candidate, and reverified it with zero Worker Tokens. Live production evidence
for the first Task now correctly reports first-pass **0/1** while its final
delivery remains accepted. This is the intended separation, not a model penalty
or a reason to start Competition.

Two further Grok-only self-upgrade Tasks closed the corresponding final-delivery
truth gap. Task `009f4dbf-8ad4-488d-b0b8-44007f462a8c` replaced the old
`machine succeeded = accepted` shortcut with one shared three-state resolver:
accepted, not accepted, or unavailable. Accepted delivery now requires a current
exact Main accept, verified Main remediation, or durable applied Integration;
current reject/revise is negative evidence, while machine success awaiting Main
stays unavailable rather than becoming a synthetic success or failure. Provider
statistics and routing use the same task-unique counts, and the accepted-delivery
factor participates only when every candidate has enough comparable outcomes.
Hub explains accepted-of-comparable and still-unknown counts in English and
Chinese without exposing event internals.

The first Candidate had one punctuation-only machine failure. Main also tightened
modern accept to require the exact current patch digest, retained the same
Candidate, and ran one zero-Worker reverification: all five original commands
passed, including full **1,908/1,908**. Revision
`d2465096-66d7-4540-967a-c6dba69516ce`, digest
`0284b2e945dd8d9973904fe4d960b075a00f7ba28cf4c9b7eadfedb09cdb13aa`,
was accepted and Integration `f34fd1bb-2784-44dc-97e5-d562504bb0d3`
completed all four stages.

Production verification then found one historical compatibility edge rather
than declaring success from synthetic tests: Task
`5e5ad6a1-0cfb-4e64-814b-cd3e9faa8ff4` has a current Attempt/verification-bound
Main reject created before revision id/digest fields existed. It was no longer
falsely accepted, but initially appeared unavailable. Narrow follow-up Task
`823bd71b-238e-4549-81d4-8ae8e69d056a` used one 8-turn Grok Attempt and changed
only statistics plus tests. Legacy reject/revise with both revision fields absent
can now provide non-acceptance evidence only; accept still requires exact id and
digest, and partial, mismatched, or stale negative bindings stay unavailable.
Focused **55/55**, full **1,911/1,911**, and diff hygiene passed. Main accepted
revision `51c2cfe5-8233-4c9b-8f27-b79c1d35da69`, digest
`c4b102506426dbaf07e7a9790dddb0387947b6da5b7cda3ced9c85bcb12cb556`;
Integration `cd562157-5a99-43d7-9131-b58916c493ce` completed all four stages.
The live rejected Task now reads machine success **1**, accepted **0/1**,
not-accepted **1**, unavailable **0** in both provider statistics and routing.

No exact type or stable family can yet compare a useful candidate pair at the
configured minimum of five relevant samples per candidate. The strongest live
family example, `bounded-javascript-change`, currently contains MiniMax **2**
relevant records and Grok **12**; a fresh exact type therefore remains
`knowledge=unknown`, `evidenceScope=none`, with no recommendation and no
Competition when Main intent is none. ForkLight now shows the real **2/5** and
**12/5** coverage instead of collapsing both candidates to zero. Sample quantity
is not model quality and does not authorize Competition.

This explainability fix was dogfooded through Grok Task
`c9d8a2bc-ee01-44b5-8f64-d0b473a9078f` in one 11-turn Attempt. Main retained the
5-file Candidate, rejected one resolved-scope wording regression, repaired the
retained Candidate, and used zero-Worker reverification rather than another
Attempt. The final exact revision
`61aa023b-12ce-473b-b548-df18e6299812`, digest
`b7e61d09775fa9893efe0cf0b1892429671d3e104f755977729a891038e8c2a4`,
passed 135 focused tests, full **1,886/1,886**, syntax, build, and diff hygiene.
Integration `4e4f031e-0767-42ba-ab73-b0cd106f2567` passed all four self-upgrade
stages. The Main repair added zero Worker Tokens and zero model-runtime cost.
The Grok Attempt lacks terminal usage, so Worker Tokens and official cost are
unavailable; its runtime estimate is USD 0.4714884. Seven receipts support only
a low-confidence Main-exchange range of 31,280–191,956 Tokens. No exact-pair
baseline exists, so no Main Token saving is claimed.

The historical Competition audit reinforces the selective rule: 7 completed
Competitions launched 14 candidate Tasks; 5 succeeded and 9 failed, across 15
Attempts and 728 turns, with runtime estimates totaling about USD 49.3877. Five
legacy Competitions did not store an explicit intent/reason, so these figures are
diagnostic history, not a future price or model verdict. Missing evidence stays
unknown. Competition remains reserved for an explicit Main reason such as
critical work, multiple plausible high-risk solutions, a genuinely new family,
or a user request. M3 stays open and will accumulate only natural real Tasks;
ForkLight will not launch Workers merely to make the counter increase.

**M1 external-environment inventory (2026-07-30):** this Mac currently exposes
only the development account `yijunwang` (UID 501). No Tart, Lima, Parallels,
VMware, VirtualBox, UTM CLI, or Multipass runtime is installed or discoverable.
The verified frozen bundle remains available under `/Users/Shared`, but there is
no independent local macOS identity in which to execute the first-Keychain,
first-Main-install, comprehension, and timing journey. This is missing external
evidence, not a product failure and not permission to treat an empty `HOME` as a
new user. The next clean-user run therefore requires either another Mac/VM or
explicit authorization to create a temporary local macOS account.

**Earlier 2026-07-30 runtime truth:** because every self-build receives a new
build id, `forklight health` and `forklight hub status` are the authority for
the live identity rather than a hard-coded id in this source document. The M3
statistics code-fix activation immediately before its evidence-document build
matched build
`cf2079b8bf6baa4d98c8c9734ace498ef2935e44a6fddb3d8e75dfbf81fbfd26`
and source digest
`d2b7ead96ff44416f4cdd720bd3beb0498cc6d65b439d380fb426cff3f0fe8d9`;
Hub PID `87204` was then `current` on `127.0.0.1:61182`. The delivered source includes the
one-to-three-judge Review Graph, durable Goal supervision, exact milestone
gates, explicit interrupted-Task recovery guidance, usable partial-opinion
retention, terminal idle/no-new-evidence stop boundaries, localized Goal stop
causes, plain-language judge failure explanations, exact-revision
cross-Worker handoff with one bounded restart continuation, and the Task-unique
accepted-delivery statistics correction (a live Volcengine cohort now reports
17 accepted deliveries of 18 Tasks rather than an additive overcount of 19).
Two real four-item Goal runs proved that `maxDurationMs:null` remains unlimited
while finite idle and explicit no-new-evidence caps stop future Task admission
across Daemon restart; both launched exactly one read-only Grok Worker and left
three dependents waiting. Local Grok 4.5 and MiniMax M3 both
have recent successful Worker-run connection evidence, now aged to `stale`
only by the readiness freshness window; DeepSeek Pro 1M and Volcengine GLM 5.2
1M remain locally launchable. MiniMax was used once as an explicit independent
judge and once as the source Worker in the cross-Provider handoff proof. For 2026-07-30 and 2026-07-31,
ordinary implementation, review, and dogfood work defaults to Grok 4.5 to
preserve the owner's other Provider Tokens; another Provider is used only for
Provider-specific work, an explicitly independent judge, or a demonstrated
Grok capability/connectivity failure, with the reason recorded first.

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
| **M2 Long-running execution loop — complete** | Plans with dependencies survive interruption/restart, expose real progress/stall states, and return infeasible contracts to Main | Four-Task restart Goal, five-Task Relay Goal, bounded stops, partial handoff, Main review and safe delivery are proved; see `docs/m2-long-running-acceptance.md` |
| **M3 Evidence-based multi-model routing — active** | Competition is selective; routing learns by Task class instead of treating one failure as a permanent model verdict | 30–50 real Tasks provide explainable success, correction, failure-category, cost, and delivery evidence |
| **M4 Truthful observability and economics** | Hub reports Worker volume, Main boundary load, official cost, and calibrated Main-Token savings without mixing evidence types | Savings appear only for versioned exact-pair baselines; unavailable evidence stays explicitly unavailable |
| **M5 External productization** | Installation, upgrades, migrations, recovery, license, docs, and security are ready for limited external use | 3–5 external users independently install, run, review, integrate, and report actionable feedback |

M0–M5 are ordered product gates, not rigid calendar deadlines. Time remains a
recorded signal unless the user explicitly enables it as a selection weight.

### M2 delivered capability: Review Graph and durable Goal execution

M2 combines two related but separate capabilities. They improve delivery
quality without turning review into an unlimited model loop. The authoritative
requirement-by-requirement exit audit is
[`docs/m2-long-running-acceptance.md`](./docs/m2-long-running-acceptance.md).

**Prerequisite delivered (2026-07-30):** a machine-successful Candidate may now
enter one zero-Worker reverification only after Main records an exact `revise`
for its current Attempt, latest machine verification, and reviewed immutable
revision. Main can repair the retained workspace, rerun the original acceptance
suite without a Worker or new Attempt, capture a fresh revision, and then record
a fresh exact accept before Integration. Reject remains a stop decision;
Competition, prior Integration, stale evidence, empty Candidates, active work,
and exhausted allowance fail closed. A failed repair preserves the original
machine-success Task/Attempt status while leaving the result visibly unaccepted.
This prerequisite now feeds the delivered exact-revision reviewer path instead
of relying on a manually copied or ambiguously repaired Candidate.

**Single-judge Review Graph delivered (2026-07-30):** Main can explicitly bind
one saved Worker Profile to the current immutable Candidate Revision. ForkLight
creates one durable read-only reviewer Task with an isolated private packet,
freezes its actual Provider/model/runtime/policy identity, permits one Attempt
and no retry/correction/adaptation, strictly validates the terminal structured
result, and reconciles completion after normal execution or restart. Reviewer
Tasks are never integratable. Starting a review blocks Candidate Integration;
terminal review evidence invalidates any older Main acceptance until Main
records a fresh accept/revise/reject. The judge only provides evidence and
cannot edit, decide, launch more work, integrate, commit, or push.

**Multi-judge Review Graph v1 delivered (2026-07-30):** Main may now select an
ordered set of one to three unique saved Worker Profiles for the same immutable
Candidate Revision. ForkLight atomically persists the graph, isolated reviewer
Tasks, and assignments before queueing any judge. It waits until every judge is
terminal, retains each usable opinion, labels agreement, disagreement,
single-opinion, or insufficient evidence, and never converts the aggregate into
an automatic vote, retry, correction, Main decision, or Integration. The same
ordered set is idempotent; a changed or reordered set is rejected for that
exact revision.

The first real two-judge graph `adb2e3cf-8d7a-4d79-83a7-46f71397b027`
truthfully failed because Grok's valid streamed JSON was replaced by a terminal
`EndTurn` token and MiniMax wrapped one valid object in prose. Task
`f7cef2c5-e5b7-490d-95aa-a63b5b9c6f41` then fixed reviewer-only terminal
instructions, bounded Grok text assembly, and safe extraction of one unique
JSON object. A fresh graph `23c5bee0-13a4-4fe8-99e5-44c2996c38ac` proved the
fix: the Grok opinion was retained as usable `accept`; MiniMax's otherwise
valid result exceeded the advertised summary limit by nine characters and was
strictly rejected. The graph finished as `single-opinion`, did not rerun either
judge, and required Main to inspect the exact revision and record a fresh
decision. Task `cd6d78e2-9b1b-4646-85a2-cf5eb4d4e7a5` now exposes the exact
existing field limits in both reviewer prompt and immutable packet without
relaxing, truncating, or coercing parser input. This closes transport and vague-
contract waste; it does not fabricate a live two-usable-judge agreement.

The live proof used Grok Candidate Task
`4fb73ce0-f2ee-44f7-a4e6-d11ce8752e53` and explicit MiniMax judge Task
`4ead4652-cbaf-41e3-a8c5-d579bfea69c6`. MiniMax completed read-only with zero
changed files, but wrapped the required JSON in additional explanation, so the
graph correctly recorded `malformed-json`, preserved the Candidate, and did not
retry. Main then reviewed the exact two-file/17-line Candidate, recorded a
fresh accept after the terminal judge evidence, and Integration operation
`8d4e28ed-c237-458e-ad7c-fd97fd908b13` passed source apply and both independent
commands. Hub translates every judge failure code into a plain-language cause,
consequence, and next action; the technical code is secondary.

**Durable Goal v1 delivered (2026-07-30):** Goal is a persistent supervision
layer over the existing Plan scheduler, not a second scheduler. One Goal
atomically registers one four-to-eight Task Plan and freezes per-item
`machine`, `main-accept`, or `integration` gates plus duration, no-progress,
correction, review, and no-new-evidence limits. Existing non-Goal Plans retain
their original machine-only behavior. Goal status projects the actual Task,
Candidate, Review Graph, Main decision, Integration result, Worker identity,
and one plain next action without exposing raw private evidence. Explicit stop
prevents queued or future Goal work from starting but does not kill an already
active Worker.

The real Goal `/private/tmp/forklight-goal-live.m4ZT8R/goal-v2.json` registered
exactly four Grok Tasks. Main restarted the daemon during the foundation Task;
the Task became durably `interrupted`, Goal correctly requested an explicit
resume, and Main resumed the same Task within its frozen two-base-Attempt
allowance. The foundation machine gate then released two branches. Task
`116924fb-67c7-4d49-8f7e-0ab35c978002` passed only after a fresh exact Main
accept. Task `ef9e2e73-461f-41df-a638-dcc393f2a481` passed only after Main
accept and Integration operation `47ffd4f1-e514-499e-9735-625f5307badf`.
Final Task `aa19a59b-935c-42f5-aab5-838394b133ed` then imported the integrated
source module and returned 43. The Goal completed 4/4 with zero correction,
review, or no-new-evidence cycles and no duplicate Plan Task.

1. **Review Graph — one to three judges delivered:** a completed Worker Candidate remains immutable. One or more
   separately assigned reviewer Workers consume the exact Candidate Revision,
   the original Contract, and independent verification evidence, then produce
   structured findings with severity, evidence, affected behavior, and a
   proposed disposition. Reviewer Workers are read-only: they cannot edit the
   Candidate, launch another Worker, accept work, integrate, commit, or push.
   Main remains the final judge and may disagree with either the implementer or
   reviewers.
2. **Configurable judge policy — explicit selection delivered; automatic policy remains:** one reviewer is the normal cost-conscious
   default. Two or three independent reviewers may be selected for critical,
   unfamiliar, or high-uncertainty work. Aggregation is evidence-based, not a
   blind majority vote. A repeated judgment round requires either a new
   Candidate Revision or named new evidence; no-new-evidence repetition stops.
   Reviewer count, eligible Worker Profiles, independence rules, maximum review
   rounds, disagreement handling, and stop conditions belong in Worker/Goal
   Advanced settings and are frozen into the run.
3. **Durable Goal run — v1 delivered:** `maxDurationMs: null` may remove the total wall-clock
   deadline. The Goal persists objective, milestones, dependency state,
   checkpoints, current Candidate/Review binding, and explicit stop reason so a
   Worker can continue across daemon or Main interruption. Unlimited duration
   does not mean unlimited self-repair: no-progress detection, evidence required
   per cycle, maximum correction/review rounds, contract-infeasible return to
   Main, cancellation, and Main stop authority remain available and visible.
4. **Acceptance:** the 4-Task restart + mixed-gate Goal proof, partial-evidence
   graph, two-usable-reviewer agreement sample, retained partial Candidate,
   cross-Worker handoff, bounded stop proofs, Relay 4-Task production Goal, and
   the Relay Gmail history **5/5** Goal
   (`examples/dogfood/relay-gmail-history-goal.json`, completed
   2026-07-30T02:28:04.812Z, evidence digest prefix `1ef72ccbdde7`) are
   complete. That 5-Task product Goal strongly satisfies the M2 chain by
   combining dependent milestones, restart persistence, cross-Worker handoff,
   Review Graph evidence, bounded corrections, partial reuse, Main
   review/repair, and safe Integration without manual database/workspace
   progress edits. A natural live disagreement remains useful but will not be
   manufactured by rerunning the same sample. Residual M2 polish may still
   collect a natural disagreement sample; it is not a blocker for treating the
   long-running product chain as proven. Parallel open exits remain M1
   clean-user evidence (the project portfolio is now 13/10), M3 30–50 classified samples,
   M4 exact-pair baselines, and M5 external users.

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

**Latest M3 Main-direct routing correction (2026-07-31):** live dogfood found
that local CLI `status` and `list` omitted the Main Review, remediation, and
Integration evidence already used by Daemon/MCP/Hub. The omission made every
recent terminal Task fail open to `Now / needs-review`, including activated
ForkLight Tasks and a failed Worker Task whose retained Candidate Main had
already repaired and delivered. That false queue could cause a reconnecting
Main to repeat review, remediation, or Worker work.

This was a small, bounded caller-wiring defect with an already-canonical
Daemon implementation, so Main deliberately did **not** spend another external
Worker Attempt. One shared CLI projection now consumes the same ordered events,
Attempts, Integration results, remediation disposition, and Decision Stage for
both commands. A functional CLI regression proves three distinct outcomes:
activated/delivered work enters History, verified repaired delivery enters
History while preserving the original machine failure, and genuine
awaiting-Main work remains in Now. The focused regression, strict TypeScript,
complete repository test suite, production build, and diff hygiene all passed.

Live history now reports Task `67d1e9f5-7a67-4942-a3a9-546d94d6391d` as
`activated / history`, Task `2d95e5ed-1f93-4daf-90ec-87a8f5faca3c` as
`machine-failed / repaired-delivered / history`, and a real pending review as
`awaiting-main-review / now`. Daemon and CLI match build
`5df9e52240f1996dad5ad646cc0092588f5d09c4208dbdbc12e8c2bf7e1f704b`,
source digest
`1b440cfd38b94463024500ee470912bb7babd7c1197bab51fce37b1d7960dfe4`;
Daemon PID is `35887`, detached Hub PID is `41633` on port `58675`, and the Hub
HTTP surface is live. This repair used **zero Worker/model Tokens**. It is also
a concrete M3 evidence gap: ForkLight can explain why it selected a Worker, but
does not yet persist a first-class “Main handled this directly” routing record.
No commit or push.

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
   remain launchable without re-entry or a Provider request. The authoritative
   portfolio in `docs/m1-real-task-portfolio.md` now proves **13/10** distinct
   delivered user outcomes across Relay and Elsewhere. Historical Adeptify,
   Dia, and NovelRPGPlay candidates remain as source-drift records, not a fixed
   project quota. No Worker was launched merely to improve the number: the
   count comes from three already-completed durable Goals, counts each delivered
   milestone once, and does not duplicate corrections, handoffs, reviews, or
   reverifications. Continue natural project work for user value and M3 evidence,
   not to reopen M1.4. The operator procedure and
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
   journey, including a fresh Main connection, comprehension check, reviewed
   sample Integration, and restart/recovery checkpoint. Relay has supplied an additional M1.4
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
   但不单独关闭 clean-user journey。
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
   Tasks. The next information-architecture slice is also shipped: the Board
   defaults to canonical `Now`, separates recent durable `History`, keeps
   awaiting-Main and awaiting-Integration work visible, and groups historical
   outcomes into Delivered / Stopped without pretending to be a complete
   archive. Durable archive pagination/search is shipped. Runtime processing,
   visible model response, tool execution, verification, and terminal outcome
   are now separate bounded states with plain bilingual explanations. Still
   open: lineage grouping and, where a runtime exposes trustworthy evidence,
   a separate Provider request/retry state; process activity alone must never
   be relabeled as network in-flight.
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
   Before execution, two sequential Contracts were frozen at
   `examples/dogfood/m3-routing-decision-evidence-deepseek.yaml` and
   `examples/dogfood/m3-competition-main-decision-glm.yaml`. Current ForkLight
   validation resolves the first to DeepSeek `deepseek-v4-pro[1M]` and the
   second to Volcengine `glm-5.2[1M]`; both have unlimited per-Task budget, one
   base Attempt, zero automatic extra Attempts/adaptation, at most one explicit
   Main correction, and 100-point admitted contract quality. The GLM Contract
   cannot start until the DeepSeek Candidate is accepted, integrated, built,
   activated, and identity-checked. Their preflight validation created no Task
   and launched no Worker.
   The two sequential M3 Contracts have now been executed. Routing evidence is
   integrated and keeps missing evidence as unknown. The mixed-runtime
   Competition path now resolves real Profile-only candidates without injecting
   empty provider/model fields, binds every accept/revise/reject decision to the
   exact current Candidate Revision, permits only an exact Main-revise bounded
   correction, and projects the actual Competition reason, Worker identities,
   machine result, Main decision, retained work, and next action into Task Detail.
   Hub now exposes an explicit decision control that first requires the matching
   Task-level Main Review; machine comparison cannot retry, accept, or integrate.
   Full verification is **1,673/1,673** and the current Daemon/Hub build is live.
   The subsequent Grok dogfood Task
   `42dfe823-9348-4217-945a-55c8eff45926` closed the remaining zero-Worker gap:
   a machine-successful Candidate now requires an exact Main `revise`, may be
   repaired in place, receives a fresh verification and immutable revision, and
   still requires a fresh exact Main accept before Integration. Reject does not
   revive work, and failed repairs preserve the original machine-success fact.
   The one-to-three read-only reviewer/judge graph, bounded no-progress/
   no-new-evidence stops, durable four-Task Goal, two-usable-judge agreement,
   and cross-Worker handoff are now delivered and live-dogfooded. Relay then
   completed a separate 4-Task production Goal and, on 2026-07-30, the five-
   milestone history Goal `examples/dogfood/relay-gmail-history-goal.json`
   at **5/5** (evidence digest prefix `1ef72ccbdde7`), composing restart
   persistence, MiniMax→GLM handoff, bounded corrections, Main repair for
   original acceptance, and reviewed Integrations. That product Goal strongly
   satisfies the M2 long-running chain. A 2026-07-30 live M3 follow-up then
   found 296 eligible terminal ordinary Tasks but only 12 complete new-format
   selection records before that dogfood Task; after the latest first-pass and
   reviewed-delivery dogfood, plus two natural Elsewhere M2 product Tasks,
   the strict count is now **20/30 minimum** across 304 terminal ordinary Tasks.
   No candidate pair reaches five relevant samples each in
   one exact class or stable family. Task
   `c9d8a2bc-ee01-44b5-8f64-d0b473a9078f` now exposes compact exact/family
   coverage, so a real asymmetric query shows MiniMax 2/5 and Grok 12/5 while
   remaining unknown, unrecommended, and non-competitive. Main repaired one
   resolved-scope wording regression with zero Worker execution. Do not backfill
   legacy selection reasons or launch work to increase the count. Next evidence targets are therefore
   parallel open exits: M1 clean new-Mac journey (the real-project portfolio is
   already 13/10); M3 30–50 real classified samples (28 strict records today);
   M4 exact-pair Direct Codex baselines; and M5 external users. A natural live
   judge disagreement remains useful open evidence and must not be manufactured.
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

## Latest dogfood — 2026-07-29 M3 routing evidence landed; Competition candidate rejected after semantic review

M3 第一段已经落地：Task `b3fa6489-70a7-43fd-9574-5e04117275c8` 让 DeepSeek
`deepseek-v4-pro[1M]` 实现“没有证据就保持 unknown，只有 Main 明确意图和合法 trigger 才建议
Competition”。两次 Worker Attempt 都未自行收口；Main 没有启动第三轮模型，而是在 retained
Candidate 上做确定性修复并用一次零 Worker reverify 收口。最终 19 files / 1,873 changed lines，
5/5 独立验收通过，revision `06827c9c-fea2-43ec-8092-19110cd8d689` 被 Main 接受；Integration
operation `8f4a0c3b-2cf3-45c3-9c4f-6d7af8078e27` 的 source apply、source verify、artifact build 和
runtime activation 四阶段均完成。当前生效逻辑把 exact/family evidence 绑定到完整 Worker identity，
保存的 Task routing snapshot 绑定 resolved Worker/Profile；legacy provider/model 模式仍明确标为兼容入口。

第二段 Task `5e5ad6a1-0cfb-4e64-814b-cd3e9faa8ff4` 使用 Volcengine
`glm-5.2[1M]` 实现 reasoned mixed-runtime Competition。Attempt 1 为 133 turns，聚焦与全量行为测试
通过但 build 因重复 import 失败；Main 只授权一次结构化 correction。Attempt 2 为 66 turns，最终
14 files / 1,814 changed lines，聚焦测试、全量 **1,663/1,663**、TypeScript build、Hub JavaScript
syntax 和 diff hygiene 全部通过，revision 为 `6476ba08-a04a-43f7-9b88-759c55997832`。

Main 语义审查仍拒绝该 revision，未执行 Integration。原因不是行数或机械门槛，而是三条真实调用链
尚未闭环：Daemon 的 Candidate parser 会给 Profile-based Candidate 同时补空 provider/model，导致
CLI/MCP 新入口被后续“不可混用两种入口”规则拒绝；Competition `revise` 虽在文案中承诺一次同
Candidate correction，但现有 correction authority 仍明确拒绝所有 Competition Candidate；Hub 只
新增展示与后端 route，没有可执行的 accept/revise/reject 交互，Task Detail 也未投影完整 Competition
原因、机器比较、Main 决定、保留内容与下一步。测试通过因此只能证明已覆盖的内部函数正确，不能证明
用户链路可用。

这轮 GLM 两个 Attempt 合计 **51,357,273 gross Worker Tokens**（396,744 input、177,937 output、
50,782,592 cache read），runtime estimate 合计约 **USD 31.823441**；Provider official cost 仍为
`pricing-identity: route-required`，不是 0。缺少 exact-pair Direct Codex baseline，不声称节约 Main
Token。Main 已记录 reject，并明确禁止第三轮 Worker、自动 retry、Integration、commit 或 push。

下一步不再扩写 Competition 功能，而是用一个新的窄合同按真实用户调用链关闭上述三项，并补 daemon
protocol、CLI/MCP、Hub 操作和 Task Detail 的端到端测试；只有这些测试与 Main 语义审查同时通过，
才重新生成可合入 Candidate。

## 2026-07-30 M2 前置闭环：成功 Candidate 可由 Main 修好后零 Worker 复验

按 7 月 30–31 日默认 Grok 的临时成本策略，Task
`42dfe823-9348-4217-945a-55c8eff45926` 使用保存的 `local-grok-builder`、xAI
`grok-4.5` / `grok-build`，没有 Competition、普通 retry、adaptation 或其他 Provider。合同只关闭
一个状态链：机器验收通过并生成 Revision A → Main 精确 `revise` A → Main 修复保留工作区 →
不调用 Worker 的复验生成 Revision B → Main 精确接受 B → 既有安全 Integration。

首次 Attempt 27 turns，交付 9 files / 1,271 changed lines；build、Hub JavaScript syntax 和 diff
hygiene 通过，但全量 1,685 项有 3 个测试夹具失败。Main 没有重做任务：保留六个生产路径，只授权
一次结构化 correction，明确两个复验额度断言应显示 `allowance-exhausted`，以及 Integration 边界夹具
必须先写合法 receipt 再写 result。第二 Attempt 5 turns，只改这三处测试证据；最终 Candidate 为
9 files / 1,286 changed lines，聚焦测试、全量 **1,685/1,685**、build、Hub syntax 和 diff hygiene
全部通过。Main 接受 Revision `4d28b92b-fd4f-4a2c-8ade-e0d0c54ee85a`，绑定 digest
`1a513299b2f2dea99ee05e7fdfc9730f33897547d34e4b7895969d97ae8e3c85`。

Integration operation `82f0be36-239e-4282-b6d5-96d03bff7612` 的 source apply、五条 source
verification、artifact build 和 runtime activation 四阶段全部 passed。现在只有最新且精确绑定当前
Attempt、机器验证和 CandidateRevision 的 Main `revise` 能开启成功 Candidate 复验；Main `reject`
仍然停止，Competition、已有 Integration、运行中 Attempt、缺失/空 Candidate、过期 revision 和额度
不足都在执行命令前拒绝。复验失败时 Task/Attempt 的机器成功事实不被改写，但旧 Main revise 保持
未接受且 Integration 继续阻断；复验通过后仍必须对新 revision 重新 Main accept。

两个 Grok Attempt 的 runtime estimate 合计约 **USD 1.2090632**。Grok 未返回完整 usage，Worker
Tokens 与官方费用保持 unavailable；32 条 receipt 只能给出 Main exchange 的低置信区间
**655,928–3,983,182 Tokens**。缺少完整 Worker usage 和 exact-pair Direct Codex baseline，因此不
声称节约 Main Token。当前 build/daemon/Hub 身份见文件顶部；没有 commit 或 push。下一步进入
Review Graph 的最小纵向切片：一个只读 judge 消费精确 revision、合同和验证证据，输出结构化 findings，
Main 保持最终裁决；重复审查必须有新 revision 或新证据。

## 2026-07-30 M2：多裁判聚合与真实结果传输闭环

多裁判实现 Task `40ba6060-b921-48d2-badc-a6a3fed1a33e` 使用 Grok 4.5。基础 Attempt
29 turns，Main 语义审查发现中文 Hub 仍直接显示英文聚合说明且缺事务回滚证明；唯一一次结构化
correction 8 turns 补齐本地化和第二裁判注册冲突回滚测试。两个 Attempt runtime estimate 合计约
**USD 1.6768656**，Grok usage 缺失。Main 只修正一个 TypeScript 可选字段夹具，正式源码聚焦
229/229、全量 1,722/1,722、build、Hub syntax 和 diff hygiene 通过，并用 remediation check
`7fd82a13-a2d5-48c4-8dc5-a1fb384ff446` 重跑原合同 5/5。

v1 现在接受一至三个有序、唯一的 Worker Profile；graph、所有 reviewer Task 和 assignment 在任何
任务排队前原子落库；每个裁判拥有隔离只读目录；只有全部终态后才生成 `agreement`、
`disagreement`、`single-opinion` 或 `insufficient-evidence`。至少一个意见可用就保留证据，全部不可用
才失败。聚合不投票、不自动选赢家、不重试、不纠正、不合入，并让旧 Main 决定失效，要求 Main 在完整
证据之后重新判断。

第一次真实图 `adb2e3cf-8d7a-4d79-83a7-46f71397b027` 的 Grok 与 MiniMax reviewer Task 都机器
成功，但 graph 为 `insufficient-evidence`：Grok raw stream 已形成 555 字符有效 JSON，适配器却把
最终 `EndTurn` 当正文；MiniMax 返回 fenced JSON、解释和通用交付摘要，严格 parser 因包裹文本拒绝。
ForkLight 没有改写旧图、重试裁判或丢弃 Candidate。

Grok Task `f7cef2c5-e5b7-490d-95aa-a63b5b9c6f41` 用 23 turns 修复结果传输：Reviewer 由耐久
`taskFile` 命名空间识别，普通 Worker 提示不变；Grok 有界、按序累积 text delta，明确 terminal result
优先，普通 `EndTurn` 无正文时才使用完整累积，溢出、错误、中断、watchdog 仍 fail closed；parser 在
扫描整个原文的大小和凭据后，只接受唯一一个完整 JSON object，多个或不明确对象继续拒绝。runtime
estimate 约 **USD 0.7815024**，usage 缺失。Main 全量验证通过后应用补丁并记录精确 accept。

新 Candidate Task `19a5f96b-9283-4cf3-9a10-61865352efe6` 由 Grok 4 turns 完成；fresh graph
`23c5bee0-13a4-4fe8-99e5-44c2996c38ac` 同时启动 Grok Task
`e12ad7d0-3793-403c-bde0-465fbb6ca699` 与 MiniMax Task
`b15dda1a-f06d-4305-a52c-cf595d7daa83`。Grok 的结构化 `accept` 成为可用证据，证明
`EndTurn` 传输已关闭。MiniMax 也返回唯一、字段正确的 JSON，但 summary 为 509 字符，超过既有
500 字符上限九个字符，因此严格记录 `schema-violation`。它使用 5,803 input、1,959 output、
4,215 cache-read，即 **11,977 gross Worker Tokens**；runtime estimate **USD 0.0800975**，当前
公开价格证据只支持 CNY **0.0304122** 的 aggregate-tier bounded estimate，不冒充精确 Provider bill。

Graph 最终为 `single-opinion`，保留 Grok 意见、不自动找替补。Main 独立检查 exact revision 和机器
验收后 fresh accept；Integration preflight 无拒绝项，但临时 dogfood 项目没有实际 apply。随后 Grok
Task `cd6d78e2-9b1b-4646-85a2-cf5eb4d4e7a5` 用 22 turns、runtime estimate 约
**USD 0.7878252**，把 summary、finding text、evidencePath 和 findings count 的原有数字限制写入
reviewer-only prompt 与 immutable packet；parser 仍不截断、不修补、不放宽。正式源码全量
**1,729/1,729**、focused、build 和 diff hygiene 均通过。没有 exact-pair Direct Codex baseline，
所以不声明节约 Main Token；Grok usage 缺失也不记为 0。没有 commit 或 push。

## 2026-07-30 M2：MiniMax 部分成果交给 Grok，跨重启接力闭环

实现 Task `17de9c6a-2bff-4999-84da-c0f091e19c88` 使用 Grok 4.5。Attempt 1 为 51 turns，Main
发现一个测试夹具错误和三条语义缺口：非精确重复请求会误复用旧交接、长 Gap 指令可能被 1,000 字符
截断、源 Task 的高级策略可能覆盖接手 Worker。唯一一次结构化 correction 为 16 turns，行为测试
412/412、全量 1,743/1,743 均通过，只剩一处测试 Buffer 类型导致 build 失败。Main 没有继续调用
Worker，只修正该类型写法；原 Task 保持 machine-failed。两个 Grok Attempt 的 runtime estimate 合计
约 **USD 4.6207804**，usage 缺失。

最终能力以“一个新 Task”实现交接，不改写旧 Task：Main 选择精确 CandidateRevision、完整文件级可复用
路径、剩余 Gap 和不同的保存 Worker；ForkLight 从当前项目建立干净 baseline，只导入批准的文件并做
字节比对。新 Worker 收到原合同、全部 Gap 和验收边界；其最终 Diff 相对原项目是完整补丁。重复请求
只有 competition、candidate、revision、目标 Profile 和原因全部一致时才幂等；不同请求在创建第二个
Task 前拒绝。接手 Worker 的 Provider、模型、runtime 与高级策略来自目标 Profile，不继承源 Worker
覆盖值。CLI、MCP、Hub 与 Task Detail 共用同一条确认和白话状态链。

真实样本位于 `/tmp/forklight-handoff-live`，Task 合同为
`examples/dogfood/m2-cross-worker-handoff-live.yaml`。第一次不可变 Competition
`4c299093-8fa1-4138-b616-41a85f06cdc4` 正确失败：Main 写的 YAML 验收命令含 `#`，被 YAML 注释截断；
两个 Worker 的 `npm test` 实际都通过。系统没有把合同错误写成成功，也没有重跑原 Task。修正合同后的
新 Competition `42f2b847-a8b3-4942-abdd-5d5a04bc5507` 中，MiniMax Candidate
`fe349be5-c5bb-4ea7-b9b1-92b37c68c744` 和 Grok Candidate 都通过。Main 只保留 MiniMax revision
`eec8bbce-47b4-4f0a-8884-4e3e7b08eab2` 的 `lib/parser.js`，把 `lib/formatter.js` Gap 交给 Grok。

Handoff `94d0343b-af0e-4680-b5e7-ff2259af6f41` 只创建 successor Task
`9c69323e-af1c-43de-afb5-59129904dadf`。真实 Daemon restart 发生时 Worker 已从 queued 进入 running，
第一次证明暴露“记录不丢但运行中 successor 不自动续上”。Main 因此增加系统级一次性 restart
continuation：只适用于 handoff successor 在独立验收前被中断；它与质量 retry/Main correction 分开，
最多一次，第二次中断停止。第一次修复又暴露 queued/interrupted 状态入口不一致，系统在启动 Worker
前失败、没有新增模型费用；同一个 durable recovery grant 经第二次修正后成功续跑。Grok Attempt 2
5 turns、`npm test` 通过，最终 2 files / 20 changed lines。保留的 parser 与 MiniMax Candidate
字节完全一致，Grok 只完成 formatter，完整 Diff 同时包含两文件。

Main 对 successor revision `b0966cb3-0416-4fba-aaba-2bfe1a44412a` / digest
`d7c2418420ec5387f0891e32fa3d50ffa849250bab9b098e8ffca593bb5542f2` 记录 fresh accept；Integration
preflight `8d1a2059-75df-465b-9c86-d85fcf480fc0` 无 rejection，确认两文件可安全合入，但未实际修改临时
项目。最终全量 **1,744/1,744**、build、Hub syntax 和 diff hygiene 通过；没有 commit 或 push。

两次 live Competition 与 successor 的可见 runtime estimate 合计约 **USD 0.269179**。两个 MiniMax
Attempt 合计 **62,945 gross Worker Tokens**（失败合同样本 24,591；成功 source 样本 38,354），
top-level 与 per-model 均 matched；Grok usage 仍 unavailable。没有同条件 Direct Codex 对照，故不
声称节约 Main Token，也不把 boundary reduction 当成反事实节省。

| ID | 发现 | 处置 |
| --- | --- | --- |
| FL-D242 | retained-partial 只能保存文件与 Gap，不能创建不同 Worker 的可验收 successor | **closed 2026-07-30**：显式确认、精确 revision、完整新 Diff、普通独立验收与 fresh Main Review |
| FL-D243 | 同 revision 已有 handoff 时，非精确重复请求可能静默拿到旧 successor | **closed 2026-07-30**：只允许五项身份完全一致的幂等 replay；其他请求 mutation 前拒绝 |
| FL-D244 | 所有 Gap 共用 1,000 字符窗口会丢失后部 Gap | **closed 2026-07-30**：每条 bounded Gap 与 acceptance 独立进入 Worker-facing contract，8 条上限夹具覆盖 |
| FL-D245 | 克隆 source Task 的高级策略会覆盖 destination Worker Profile | **closed 2026-07-30**：移除 source Worker override，由 destination Profile 冻结 effective policy |
| FL-D246 | prepared successor 已开始运行时重启 Daemon，只保留 interrupted 状态，不继续交付 | **closed 2026-07-30**：独立验收前仅一次 durable restart continuation；第二次中断不循环，真实 Grok successor 成功 |
| FL-D247 | restart continuation 先转 queued，但 resume 入口只接受 interrupted/failed | **closed 2026-07-30**：保留可续跑终态直到执行器消费授权；同一真实 grant 成功恢复 |
| FL-D248 | restart continuation 被 Delivery Lineage 误标为 Main correction，handoff succeeded 后仍显示 wait | **closed 2026-07-30**：恢复 Attempt 单独分类；成功 successor 的 handoff next action 为 fresh Main review |

## 2026-07-30 Relay Gmail：四 Task 产品 Goal 完整闭环

ForkLight 在真实项目 `/Users/yijunwang/code/relay` 完成 Goal
`examples/dogfood/relay-gmail-production-final-goal.json` 的 **4/4、100%**。四个里程碑全部使用
`local-grok-builder` / Grok 4.5，没有调用 DeepSeek、MiniMax、GLM 或其他 Provider：

1. `27e6fff0-8cd9-4dec-b6b3-01f5e180e821` 让有凭证的 Gmail 同步不再退回演示成功；Integration
   `e03f251e-57d3-4823-a671-9ad43388b3f7` 完成。
2. `67cf8789-2a2c-47de-bbed-0ff5bd8f9acb` 证明同步失败会保留旧邮件、游标、数量、上次成功时间和账号提示；
   Integration `89043e3a-e0a6-478a-bf1d-850c290fb4ec` 完成。
3. `faf8c167-0cba-4df2-a5e1-a03122be1b68` 把 Gmail 设置改成编号引导，手工 token/callback 收进高级区，
   callback 只向同源原窗口发送成功/失败状态；Integration
   `8d22c7fe-657f-41bb-b3a2-fdb89537ed5a` 完成。
4. `27d1d32f-3506-4df6-a81a-feaffd601837` 让 README、环境变量、UI 和源码常量保持一致，明确只手动同步、
   默认只建草稿、授权失败恢复和凭证边界；Integration
   `cb3583bb-a11d-4a20-8529-60c951ff6fdf` 完成，原项目三条 source verification 全部通过。

第三、四项第一次机器验收各暴露两个和一个明确缺口。Main 没有整单重跑，也没有放松冻结策略：每项只
授权一次结构化 same-Candidate correction，分别保留 6 个和 5 个已有路径，只修失败消息/React lint，
以及错误的凭证运输测试与 Desktop OAuth 文案。第四项还由 Main 对照 Google 官方 Desktop OAuth 说明，
纠正了“必须在控制台手工登记 Authorized redirect URI”的误导；产品现在让用户核对 Relay 显示的本机
loopback 回调。

Main 对 onboarding Candidate 做了真实桌面与 390×844 移动视口体验：无横向溢出，Advanced 折叠可用，
控制台无 error/warning；Impeccable detector 返回空列表。六个 Grok Attempt 的 runtime estimate 合计
约 **USD 2.4520268**。Grok 没有返回完整 usage，Worker Token 与官方费用保持 unavailable；没有同条件
Direct Codex exact-pair baseline，因此不声明节约了多少 Main Token。

这条证据加强 M1.4 的真实产品实践和 M2 的 durable Goal / bounded correction / Main review / safe
Integration 链路，但不能代替 M1 的新用户安装与多项目十 Task 出口，也没有在同一个 Goal 内证明
Review Graph 或 cross-Worker handoff。前两版 Goal 因冻结纠正额度和错误的通用 mock 断言分别在 50%
和 0% 如实停止，历史没有被改写；最终 continuation 通过新合同闭环。没有 commit 或 push。

## 2026-07-30 Relay Gmail history：五里程碑 Goal 5/5 闭环

Goal `examples/dogfood/relay-gmail-history-goal.json` 于 **2026-07-30T02:28:04.812Z** 完成
**5/5、100%**，evidence digest 前缀 `1ef72ccbdde7`。终态 correction rounds **3 of 3**、review
rounds **2 of 2**、no-new-evidence cycles **0**。本条只记录已证明事实；Grok usage 不完整，runtime
estimate 不是 Provider 账单；没有 exact-pair Direct Codex baseline，因此不声明 Main Token 节约，也
不编造精确 Worker Token。

### 五个里程碑 Task

| 里程碑 | Task id | 处置要点 |
| --- | --- | --- |
| cursor | `13badf99-b28d-4670-a49f-4cd76ae2ddcf` | Goal 已记录 cursor Integration |
| live adapter | 原 `decbae4e-4ac8-48c3-a5d2-78801662ccb4`；handoff successor `dd837113-bb99-4557-b5ae-c08fc9881549` | MiniMax 起步，Goal handoff 到 Volcengine GLM；Main 修复重复 `historyTypes` 查询编码后按**原验收合同**验证通过，未整单重跑 |
| recovery | `c3101828-d38b-4903-b580-28b6deac6074` | Integration `d7f6035a-9ed9-4c50-890e-1c2215097c28` |
| recovery UI | `f46aa672-0046-4a8d-8567-0a90adfdc111` | Integration `782e9d3e-9869-4ed2-8462-18991abc8a49`；UI 验证中真实 daemon restart 后从耐久状态继续 |
| restart proof / docs | `c8c85e73-bcca-4935-b83e-d0828879bb3e` | Integration `79293bb1-377d-47d9-87f0-9f566ebee5b5` |

### 已证明

- 五依赖 Task 的 durable Goal 监督、里程碑 Integration gate、有界 correction 与 review 计数。
- 跨 Provider handoff（MiniMax → Volcengine GLM）用于验证 handoff 能力；日常实现仍默认 Grok-first。
- Integration gate 自升级：仅对**原验收合同**接受 verified Main-repaired delivery，不接受被改写的验收；该自升级完成 source apply、verification、build、daemon activation 与 identity proof，Goal 从 20% 推进到 40% 且无数据库/工作区手工改进度。
- UI 里程碑期间真实 daemon restart 后从 durable state 续跑。
- Main 在真实浏览器桌面与 390×844 审计 UI：无横向溢出、一页 Gmail 卡片结果、手工同步显示两条新 Item 与 preservation 文案、浏览器 console 无 warning/error。
- 最终 Relay 源码验证 **308/308** tests 与 production build 通过。无 commit 或 push。

### Main 干预与证据边界

Adapter gate 由 verified Main-repaired source 对照原 acceptance 满足，不是整 Task 重跑；cursor
Integration 已由 Goal 记录。本条不声称精确 Worker Token、官方账单或 Main-Token 节约。

### 里程碑出口

- **M2：** 本 Goal 强满足产品长程链（五依赖 Task、restart、handoff、Review Graph 证据、有界
  correction、部分复用、Main review/repair、safe Integration）。自然 live judge disagreement 仍可
  作为补充证据，但不得为好看而重跑制造。
- **M1：** 真实项目组合已达 13/10；仍需 clean new-Mac / VM 外部用户旅程。
- **M3：** 仍需 30–50 条真实分类样本。
- **M4 / M5：** exact-pair 证据与外部用户仍 open。

## 2026-07-30 M3：已接受交付统计改为 Task-unique 并纠正 18→19 虚高

Task `decc6048-42e4-48f2-ad24-142d4a49a91c` 用 Grok 4.5 在 **1 个 Attempt / 4 turns** 内修
正 Provider/model 交付统计：同一终态 Task 最多计一次已接受交付。缺陷根因是旧 `summaryFor`
把 `successCount` 与 `mainRepairedCount` **相加**；当两个 Task 同时落在机器成功与 Main 修复
集合中时，18 个 Task 的 Volcengine 队列会显示 **19** 次已接受交付。修复后采用 Task-unique
并集语义：机器成功 **或** 通过 Main remediation 的 Task 各计一次，同时保留独立的
`mainRepairedDeliveryCount` 与失败分布。

Main 接受 Candidate Revision `5cd3be4f-96af-40b0-8027-a52733873e5a`（patch digest
`351e3dc08edbc6156443467c055bedc1d1e73ca4f81979fd3f80be585fdce5bc`）。Worker 侧通过 build、
**67** 项聚焦测试、全量测试与 diff hygiene。Integration
`c99a9e33-10ee-4b89-8cc5-69e68e235538` 通过 source apply、四条 source-verification、artifact
build 与 runtime activation。代码修复 Integration 完成时 CLI / Daemon 匹配 build
`cf2079b8bf6baa4d98c8c9734ace498ef2935e44a6fddb3d8e75dfbf81fbfd26`、source digest
`d2b7ead96ff44416f4cdd720bd3beb0498cc6d65b439d380fb426cff3f0fe8d9`；随后 Hub PID `87204`
在端口 `61182` 为 `current`。后续文档自构建会生成新的 build id，实时身份始终以 health/status 为准。

激活后同一 Volcengine 队列的真实统计为：`sampleSize` **18**、`successCount` **11**、
`acceptedDeliveryCount` **17**、`acceptedDeliveryRate` **0.9444444444444444**（约 **94.4%**，
即 **17/18**）、`mainRepairedDeliveryCount` **8**。11 与 8 的交叠为 2 个 Task，故 unique 并集
是 17 而不是 19。历史 Task 记录、失败证据与 Main-repaired 路径均保留，未改写、未删除。

Grok runtime estimate 约 **USD 0.144428**；usage missing，故 officialCost unavailable，Worker
Tokens 不可用。这不是 Provider 账单；没有 exact-pair Direct Codex baseline，因此不声明节约
Main Token。本条只纠正已记录队列的统计正确性，**不是**对该模型的全面裁决，也**不**提供 M3
仍缺的 30–50 条代表性分类样本。

### 里程碑出口（仍 open）

- **M1：** 真实项目组合已达 13/10；仍需 clean new-Mac / VM 外部用户旅程。
- **M3：** 证据正确性已改善；仍需 30–50 条真实分类样本。
- **M4：** exact-pair Direct Codex 基线与可发表 Main-Token 证据。
- **M5：** 外部用户独立安装与反馈。

2026-07-30 与 2026-07-31 仍保持 Grok-first；无 commit 或 push。

## 2026-07-30 M3：Main 的 Worker 选择理由进入 MCP Task 真相源

只读数据库审计发现，300 个历史 Task 中有 125 个没有 `taskClass`、242 个没有
`taskFamily`，并且 **300 个都没有 `routingDecision`**。路由的 exact → family → unknown
能力已经存在，真正断点是 MCP `validate/submit` 没有暴露这些输入；Main 实际做了选择，Task、Hub
和长期统计却没有保存“考虑了谁、为什么选、为什么不竞争”。

Grok Task `c340116f-827b-4ff5-952a-50fd3319f5c9` 关闭该入口缺口。该 Task 自己先成为第一条真实
选择快照：`taskClass=m3-mcp-routing-decision-admission`、`taskFamily=main-orchestration-metadata`，
Grok 与 DeepSeek 是实际 shortlist；只读路由对两者均返回 `knowledge=unknown`、`evidenceScope=none`
和 0 条实测样本，Competition intent 为 `none`。Main 按一骏 7 月 30–31 日 Grok-first 的明确偏好
只选择 `local-grok-builder`，没有启动 DeepSeek 或 Competition。

第一版机器验收通过，但 Main 发现 Skill 会让 Main 避开既有 family、并可能把未查询证据写成 0。
系统保留同一 Candidate，只用一次 4-turn 结构化纠正：现在要求按行为、模块边界、输入输出和验收意图
复用已有稳定 family；不能按词面相似乱归类，也不能无谓新建 family。只有只读路由真正返回的数字
可以记录为样本数；未查询或不可用时必须使用 `scope:none + exactSampleCounts:{}`，不能用 0 冒充。

最终为 4 files / 384 changed lines；基础 Attempt 15 turns，纠正 Attempt 4 turns。原合同 build、
MCP/Task/Skill 聚焦测试、全量测试和 diff hygiene 两轮均通过。Main 接受 Candidate Revision
`3c6dea75-3f95-4a37-9e1c-04631f28ed59`；Integration
`2e4b4dfa-c739-4625-bf94-eb7c9be5d0a4` 的 source apply、4 条 source verification、artifact build
与 runtime activation 全部通过。当前 CLI / Daemon 匹配 build
`052afda7412fa3df541b5f346bdb9a0a5b312b37341fddeebbcc3ee37d8f92f3`；Hub PID `25298` 在端口
`51561` 为 `current`。全局安装包内的 Skill 与 MCP 构建已包含新字段；长驻 Main 会话仍需重新加载
才能看到新的 MCP tool schema。

两次 Grok runtime estimate 合计约 **USD 0.5842384**；usage missing，故 Worker Token 与 official
cost unavailable，不写成 0，也不声明 Main Token 节约。这个改动让未来样本可学习，但不回填旧历史，
也不替代 M3 仍需的 30–50 条真实分类样本。机械证据更新由 Main 直接完成，没有再启动文档 Worker；
无 commit 或 push。

## 2026-07-30 M3 / Hub：目标卡片用当前语言解释终态

Main 在运行中的中文 Hub 直接看到两个可复现问题：停止的 Goal 显示为“状态未知”，并且总览优先展示
存储的英文 `nextAction`，导致已完成卡片出现 `Every milestone gate is satisfied.`、已停止卡片出现
`Main stopped this Goal...`。详情页已经有结构化 reason/action code 的本地化能力，缺口只在高频卡片
没有复用，另有通用状态映射遗漏 `stopped`。

Task `27e041e6-4ab1-4f75-8d1a-83619cbde4ac` 复用 family `bounded-javascript-change`，保存了第二条完整
`routingDecision`。Grok 与 DeepSeek 都是实际 shortlist；exact 路由为 `knowledge=unknown`、
`evidenceScope=none`，没有可比样本，Main 按一骏 7 月 30–31 日 Grok-first 偏好只启动 Grok，未竞争。

第一轮 9 turns、3 files / 179 lines，机器验收全绿；Main 没有接受把所有终态缩成“当前无需 Main 动作”
的窄实现。系统保留 Candidate Revision `84778358-c2b4-49ea-addb-2927a4c82a62`，只做一次 4-turn
structured correction：停止/完成卡片展示本地化终态原因，活动卡片展示本地化下一动作，未知旧 code
仍保留有界存储文本。第二轮聚焦 80/80、语法、build、diff hygiene 通过；全量 1,767/1,768 唯一失败
来自未改动的 `hub-instance` 时序测试，期望 `legacy` 却瞬时得到 `unverified`，同一聚焦文件随后在
权威源码 40/40 通过。

Task 冻结的 `maxMainReverifications=0` 正确拒绝了零 Worker reverify；Main 没有改冻结策略、没有启动
第三次模型调用，也没有修改验收合同。Main 将审查后的三文件 Candidate **逐字一致**应用到源码，再按
原始六条命令执行 remediation verification；check `7c2e798d-dbad-41c8-8682-44a4c8a9744b` 为 **6/6**，
disposition 为 `verified-repaired-delivered`、`acceptanceBasis=original-acceptance`。Task 的第二 Attempt
machine-failed 历史仍保留，标准 Integration preflight 也如实拒绝 failed + no fresh accept；没有伪装成
普通 Integration 成功。

源码重新构建并切换 Daemon/Hub 后，CLI 与 Daemon 匹配 build
`6096d8e05b3f54d4569454749dcd1a1d3566f55c7656b0f70d0bc4916f01e699`、source digest
`9d25400b79dd8c56adb6cd88fe437dcd8f715f487c69cbd3c4beaf30225dca17`；Hub PID `19303`、port `65175`
为 `current`。真实中文浏览器重新检查：完成卡显示“所有里程碑闸门均已满足”，停止卡显示“已停止”及
中文停止原因，无 console warning/error。

两次 Grok runtime estimate 合计约 **USD 0.4240116**；usage missing，故 Worker Token 与 official
cost unavailable。没有 exact-pair Direct Codex baseline，不声明 Main Token 节约。当前 302 个 Task 中
有 2 个保存完整 routing decision；M3 的 30–50 条代表性样本仍 open。后续合同若包含大型全量套件，
不应无理由把可配置的 `maxMainReverifications` 硬覆盖为 0；优先继承 Profile 或保留一次零 Worker 复验，
但仍不得自动循环。无 commit 或 push。

## 2026-07-30 M3：Hub 直接说明 Worker 选择证据是否够用

历史里已经开始保存 Main 的 Worker 选择决定，但 Hub 之前看不到整体覆盖：用户无法判断当前建议到底有多少
真实记录支撑，也容易把“没有记录”误读成“模型表现差”。本轮新增一个只读、解释优先的洞察面板，不改路由、
Competition 或任何 Task 历史。

- **路由与费用偏好：** Task `1f0888d5-2c65-44ea-a90e-aecff8f3d2ab` 只使用 Grok 4.5；按一骏
  2026-07-30 与 2026-07-31 的临时偏好，ForkLight 保持 `xai + grok-build` 为默认 Worker。只有
  Provider 专项或真实跨模型验证才使用其他 Provider。
- **定义：** 统计终态普通 Task，排除 Review Graph 裁判 Task；“完整选择证据”只在同一个 Task 同时存在
  明确类型、稳定分类和已存储的 Worker 选择决定时计数。旧记录不推断、不补零，也不读取选择理由或任务内容。
- **有边界纠正：** 第一版 30 turns 已形成可复用 Candidate，但独立验收发现 3 个机械失败，Main 又指出完整
  证据被高估。系统保留同一 Candidate，只授权一次结构化 correction；第二次 7 turns 修正语义、测试与双语
  文案，没有新 Task、普通 retry、adaptation 或第二 Provider。
- **验收：** 聚焦测试、JavaScript syntax、`npm run check`（1,778/1,778）和 `git diff --check` 全部通过；
  Impeccable 检查无命中。最终 Candidate Revision `1a808b37-5ee9-40aa-9a09-c20af219449e`，patch digest
  `d20b977827b651825c5efcbdde665b2e91ea0dd41461ca934632029e29916789`，12 files / 872 lines。文件数
  10 是 warn-only，未以形式限制否定已通过的质量结果。
- **安全合入：** Integration `f6aa7ac4-7817-4dc9-99c9-b48b378d0810` 四阶段通过；CLI/Daemon build
  `94559414f2b7b25186a690f60475cc2a4d085c9c5d156ba4b8aff929b4704410`、source digest
  `670d5c6714a34bab12716766db2bdf5fa2b5bcb24f0b4400fb185126742df804`。Hub PID `49225`、端口
  `58263` 为 `current`。
- **真实浏览器：** 中文与英文解释均可读；390px 无横向溢出，console 无 warning/error。当前面板显示
  279 个终态普通 Task、165 个有明确类型、48 个有稳定分类、3 个有完整选择记录；另有 129 种类型、
  14 个稳定分类。这些数只表示证据覆盖，不评价模型，也不授权自动路由或 Competition。
- **经济边界：** 两次 Grok runtime estimate 合计约 **USD 1.6750096**；两个 Attempt 的 usage 都 missing，
  因此 Worker Token 与 official cost unavailable。Main 侧 40 条交换 receipt 只能给出低置信字节包络，不能当作
  Token 节约；没有 exact-pair Direct Codex baseline，故不声明 Main Token savings。

M3 仍 open：完整选择记录现为 3 条，距离 30–50 条真实、分类良好的代表样本仍有明显差距。本轮只让差距
变得可见和可解释，不用自动重试去追数字。无 commit 或 push。

| ID | 发现 | 处置 |
| --- | --- | --- |
| FL-D251 | Hub 无法说明 Worker 选择证据的整体覆盖，用户会把缺记录误解为模型结论 | **closed 2026-07-30**：只读聚合、同 Task 三字段交集、排除裁判、双语解释与真实浏览器实证 |

## 2026-07-30 M3：日常统计缩小 91.25%，完整失败证据改为按需读取

真实 `forklight stats --json` 在旧行为下返回 **70,659 bytes**：6 组 Provider/model 汇总之外，
还携带 148 条逐 Task 失败记录，最长 diagnostic 为 2,000 字符。Hub 轮询和 Main 日常监督只消费
汇总数，这些明细既不帮助当下判断，又反复扩大主线程交换边界。

Task `3e32c9c0-997e-43ef-92ef-9f3e6ec077ed` 只使用 Grok 4.5；按 2026-07-30 至 07-31 的
Grok-first 临时偏好，没有启动其他 Provider 或 Competition。第一 Attempt 19 turns、11 files / 413
lines，机器验收通过，但 Main 发现 `--deep-audit` 在非 JSON 人类输出下仍会取回完整明细却不展示。
系统保留同一 Candidate，只授权一次 7-turn structured correction：非 JSON deep audit 现在会在连接
daemon 前拒绝，并加入真实 CLI 进程测试。最终 Candidate Revision
`b6c95eb1-67ef-41a6-80fd-b388bd486cba`，digest
`abd017930ef9b35f990ad49497782e5b2faa0b7fbbee1925200bc2b0268ab3e4`，12 files / 599 lines。

激活后真实测量：默认 compact JSON **6,180 bytes**，显式 full deep audit **70,659 bytes**，减少
**64,479 bytes / 91.25%**；6 组 aggregate 逐值一致，compact 不含 failure rows，
`forklight stats --json --deep-audit` 仍返回完整 148 条本地证据。`forklight stats --deep-audit`
以 exit 1 和明确提示在 daemon 请求前停止。CLI、MCP 与 Hub 均显式使用 compact 默认。

候选与最终源码全量 **1,783/1,783** tests、build、diff hygiene 通过。Integration operation
`e6ff5926-7369-4baa-b9b4-29f625ea9a2c` 已完成 `source-applied`，但旧 daemon 在自升级期间因断开的
等待管道触发 EPIPE，耐久状态保留为 `outcome-unknown`，没有伪造后续阶段回执。Main 随后按原合同
在权威源码完成 `npm run check`，重建并安全重启 daemon 与 Hub；当前 build
`3b74df847131f367e8f93753ab43bad4dc26270fb602206d147556defe5a9f24`、source digest
`4cb4af42066ec361b5f289ac163497a5112fe957fb658a3a8ff25206673923cf`，Hub `55116@54505` 为
`current`。这次 EPIPE 恢复缺口保留为后续缺陷，不改写 Integration 历史。

两次 Grok runtime estimate 合计约 **USD 0.8928864**；usage missing，Worker Token 与 official
cost unavailable。91.25% 是实测响应字节缩减，不是 Token 节约；没有 exact-pair Direct Codex
baseline，仍不声明 Main Token savings。路由覆盖现为
`280 total / 166 class / 49 family / 4 complete`；M3 的 30–50 条代表性样本仍 open。无 commit/push。

| ID | 发现 | 处置 |
| --- | --- | --- |
| FL-D252 | 日常统计与 Hub polling 携带 148 条逐 Task 失败证据，70,659-byte 响应被反复搬运 | **closed 2026-07-30**：compact 默认、full deep audit 显式开启、真实 CLI/MCP/Hub/daemon 测试与 91.25% 实测 |
| FL-D253 | self-upgrade 等待客户端断开后 daemon 写响应触发 EPIPE，源码已应用但 Integration 只留下 `outcome-unknown` | **open**：需让断开的客户端不能击穿 daemon，并为 source-applied 后的剩余阶段提供可审计恢复；本轮只做人工原合同验证与安全激活，不伪造四阶段完成 |

## 2026-07-30 M0 回归修复：断开的等待客户端不再击穿 Daemon

Task `f2dff9cd-d1f8-4767-b69c-d21a76859f7c` 只使用 Grok 4.5，在 **1 Attempt / 14 turns**
内完成 3 files / 182 changed lines；没有 correction、retry、adaptation、Competition 或第二 Provider。
Main 接受 Candidate Revision `aa578c59-2122-4c8a-a570-ffab0ac81ed4`，patch digest
`fb1d9765ca56668984f4cd776abd77752e5271e099a92b4d3d57b932afdccc35`。聚焦 daemon / Integration
operation **133/133**、全量 **1,784/1,784**、build 与 diff hygiene 全部通过。

实现把 socket/readline 生命周期收口在 daemon transport：请求一旦开始只 dispatch 一次；peer reset、
EPIPE、destroyed stream 或无法回包只把该连接标记为不可投递，不取消、不重试、不改写后台操作结果。
保持连接时，普通成功和应用层拒绝仍返回原协议响应。真实 Unix socket 测试会在异步
`integration_wait` 未完成时主动销毁客户端，并证明同一 daemon PID 前后都可 health、operation 仍可查询、
close 不挂起。

自动 Integration `65252e11-90e3-49f4-a70a-756704eb3986` 在旧 daemon 上再次于
`source-applied` 后触发同类 EPIPE，因此历史如实保留为 `outcome-unknown`，不计作四阶段成功。Main 在
已经应用的权威源码上重新执行原合同 `npm run check`（1,784/1,784），生成包含修复的新构建并安全切换。
当前 daemon PID `85536`，build `3835ea1f669a5bc3b61bdd865f783bd9f19cb0683305abd5832814c06c3dea91`，
source digest `8e8a4e9e38dd1d8266a116ec4912cbd3e2c5a4c5d52b420a4cc05b79e02ec27c`；Hub
`85748@50516` 为 `current`。

生产 socket 实证：对旧 outcome-unknown operation 发起 1.2 秒 wait，40ms 后主动销毁客户端；等待服务端
结算后 PID 仍为 `85536`、health 正常、operation 可查询，daemon log 保持 **12,624 → 12,624 bytes**，
没有新增 EPIPE。Grok runtime estimate 约 **USD 0.5023152**；usage missing，official cost 与 Worker
Token unavailable，也没有 exact-pair Main Token savings。

M0 暂不因人工恢复直接重封：还需让**包含本修复的新 daemon**自动完成一次四阶段 self-upgrade，证明
修复后的真实链路。路由覆盖现为 `281 total / 167 class / 50 family / 5 complete`。无 commit/push。

| ID | 发现 | 处置 |
| --- | --- | --- |
| FL-D253 | 客户端断线导致旧 daemon EPIPE 并中断后台 Integration；物理进程崩溃后也没有阶段续跑 | **direct cause closed / recovery open 2026-07-30**：连接断开已真实生产验证不会再击穿 daemon；真正 killed-process 的 source-applied 阶段恢复仍未实现，不能把本次人工恢复记作自动 Integration |
| FL-D254 | `forklight integration status/wait/history` 在 socket 切换窗口会隐式 ensure/start，可能与 activation runner 争抢并拉起旧构建 | **closed 2026-07-30**：三条观察命令只连接已有 daemon；隔离 home 实证不创建 socket/log，真实 handoff 中也未抢占启动权 |
| FL-D255 | daemon 已启动但 durable recovery 超过固定 5 秒时，CLI 先报失败，稍后进程又实际健康，导致 runtime activation 假失败 | **closed 2026-07-30**：单次启动 + 可配置有界 readiness；区分 child-exit/timeout；真实 self-upgrade 四阶段通过 |

## 2026-07-30 M0 受控交接子链路关闭：原始连续出口为 1/3

FL-D254 Task `ff786c10-d31b-4335-8346-d68234e674dc` 只使用 Grok 4.5。第一 Attempt 的生产实现可用，
但测试夹具先写 Integration result、后写它引用的 receipt，正确触发 SQLite foreign key；Main 没有放松约束，
只授权一次同 Candidate、5-turn 结构化纠正来先持久化 canonical receipt。最终 2 Attempts、4 files / 372
changed lines；Candidate Revision `f329ac7f-31ae-43d9-addd-6abb7f0d8788`，digest
`3762a49ea220346582ea58051f9a1cfae5a902854a399f01a6b0ba95373d04ed`；focused **43/43**、full
**1,789/1,789**、build、source compatibility 与 diff hygiene 全绿。

实现后 `integration status`、`wait`、`history` 只观察已存在 daemon，socket 暂时消失时给出有界的稍后重查提示，
不会 ensure/start；preflight/apply 保持原生命周期。隔离 `FORKLIGHT_HOME` 依次调用三条命令后没有 socket 或
daemon log。Integration `66ba9a77-f518-4a37-836f-043e2b70c316` 的 source-applied、source-verified、
artifact-built 均通过，新 daemon 也实际成为 healthy，但旧 5 秒 startup probe 先返回 ENOENT，历史如实保留为
`retained-failure`，不把真实启动改写成 stage success。该任务 Grok estimates 合计约 **USD 0.5868184**；
usage missing，official cost / Worker Token / exact-pair Main savings unavailable。

由此新增 FL-D255。Main 先把已配置化的 self-upgrade activation 收口为“只启动一次，最多只读等待 30 秒”，
随后 Task `4337b194-117e-463a-b216-78c689159e7e` 仍只使用 Grok 4.5，在 **1 Attempt / 14 turns**
内完成 6 files / 390 changed lines，无 retry、correction、adaptation、Competition 或其他 Provider。实现提供
默认 30 秒、可由 `daemon start/restart --startup-timeout-ms` 配置为 1–600 秒的 readiness 窗口；同一次调用
只 launch 一个 child，并分别报告 child 提前退出与 deadline timeout，不自动重启、不无限等待、不暴露 socket/path。
checked-in self-upgrade Profile 使用 60 秒上限。focused **154/154**、full **1,795/1,795**、build 与 diff
hygiene 全绿；Main 接受 revision `2a1a49b6-ab28-48f2-be58-1dae8bf52668`，digest
`76abb89c82f5c3f2432f037bd62e53725675ec6c5c1260de060ca4e10f9cff7c`。

最终自动 Integration `efa7d9ae-61c9-421a-a1b5-d427d9353a81` 已完成四阶段：source-applied 7ms、
source-verified 159,664ms、artifact-built 5,566ms、runtime-activated 4,797ms，result=`applied`。
新 daemon PID `4447`，build `d5bc42ca3262f4ddf8996d0789529b36578ff1f1e6c2efce126855ce00524e25`，
source digest `d2bba57e0c54b72447eebabf0743600cbcc7b8d84b64719a86d49b0fba36fd30`；Hub
`8459@61089` 为 `current`。FL-D253 的连接断开保护、FL-D254 的无副作用观察、FL-D255 的慢启动确认至此在
同一真实 self-upgrade 链路闭环，证明受控 handoff 子链路恢复；但按“从最新结果向后、遇到首次失败即停止”
的原始 M0 出口规则，`efa7...` 前一条仍是 `66ba...` retained-failure，因此当时真实连续计数是 **1/3**，
不能称为整个 M0 已重新封闭。真正物理 kill 后从中间阶段续跑仍是独立 recovery 能力缺口。

FL-D255 Grok estimate 约 **USD 0.3963564**；usage missing，official cost 与 Worker Token unavailable；
无 exact-pair Direct Codex baseline，不声明 Main Token 节约。路由覆盖更新为
`283 total / 169 class / 52 family / 7 complete`（133 种 class、14 种 family）。无 commit / push。

## 2026-07-30 M0 连续自升级证据产品化：真实进度达到 2/3

Task `44f2f5c4-bf1e-451c-828c-9ff3195430bb` 只使用 Grok 4.5，实现唯一权威的“连续自升级证据”：
Store 按 `created_at DESC, id DESC` 读取有界 Integration 历史，Core 只接受四个封闭阶段各出现一次且全部
passed；未知、额外、重复、缺失或旧格式证据均 fail closed，并在首个失败处停止，绝不跳过失败寻找更旧成功。
CLI 新增只读 `forklight upgrade status [--required 1-20]`，Hub Overview 使用同一个 daemon 投影，以中英文
白话解释当前进度、中断原因和下一步；坏数据只显示“暂不可用”，不会伪造 `0/3`。

第一 Attempt 完成主链路但因新增文案使用项目禁止的 em dash 导致两条 UI 规范测试失败。Main 同时发现异常阶段、
公开字段和可读性缺口，只授权一次同 Candidate 结构化纠正，复用全部有效文件；第二 Attempt 将实质问题修复后，
focused **287/287** 通过，但两处专门模拟未知阶段的测试强转写法未通过 TypeScript build。Main 只修正这两个
compile-only cast，未启动 Worker 或新 Attempt，随后 Candidate reverification 的 **4/4** 原验收命令全部通过：
full **1,812/1,812**、build 与 diff hygiene 全绿。15 files / 1,755 lines 超过 12/1,100 的 `warn` 提示，
不作为 hard gate，也没有触发参数自调或循环重试。Main 接受 revision
`343a1666-0bc3-461c-bf82-13dda3fe3743`，digest
`9cb3b91d1e147811604e49d5123bafbdc0a4b891a2231d31340877283aac5120`。

自动 Integration `ae49145f-544b-437c-a6c2-ac45cc97ba52` 四阶段全部通过：source-applied 20ms、
source-verified 202,539ms、artifact-built 4,695ms、runtime-activated 2,497ms。新 daemon 与 CLI 使用同一
build `e8f46a1f0f8ca3fc9a37b74066abc014121bd54d9ae735f36d567b5793f2c94d`，source digest
`5a6fe5835bfab2a30b4bd6b2e8597e73ace138a2be36a0da34c964acbdf93a63`；Hub 已安全替换为
`82617@58675` current。新权威查询返回 **2/3**，break 为 `66ba9a77-f518-4a37-836f-043e2b70c316`
retained-failure，还需 1 次真实连续四阶段升级才能关闭原始 M0 gate。

两次 Grok runtime estimates 合计约 **USD 2.4369112**；usage missing，因此 official cost、Worker Token
和 exact-pair Main Token savings 仍 unavailable，不将估算边界宣传为节约。无 commit / push。

## 2026-07-30 M0 核心出口完成：后台 Hub 换代与第三次连续自升级

Task `cccf0978-1209-4adb-afdf-264be189cc93` 只使用 Grok 4.5，解决上一轮真实操作暴露的问题：原来的
`forklight hub restart --confirm --json` 会正确替换旧 Hub，但调用它的 CLI 随即成为长期 Hub owner，既不返回
有限 JSON，也会占住调用终端。新命令
`forklight hub restart --confirm --detach [--no-open] [--port] [--startup-timeout-ms] [--json]`
保留原前台模式，同时提供显式后台路径：先认证旧 owner、等待其释放，再只启动一个当前 CLI child；默认保留旧端口，
通过认证状态证明新 build 已 ready 后才返回。current no-op、early exit、timeout 和 ownership race 都 fail closed；
超时只要求先查 `hub status`，不会在原 child 仍可能启动时诱导直接重试。JSON 不含 token、nonce、路径、环境或 child 输出。

第一 Attempt 架构和 build 通过，但两个虚拟时钟测试错误使用低于公开最小值的 5ms timeout，focused/full 各失败
2 条。Main 没有降低产品下限，而是把机器原因与 current 二次确认、timeout 重试风险、replacement 内部原因泄漏
合并为一次结构化 correction。第二 Attempt 复用原 4 文件、7 turns 后通过 focused **120/120**、full
**1,837/1,837**、build、source compatibility 与 diff hygiene。最终 4 files / 1,456 lines 超过 1,000 的
`warn` 提示，新增量主要是 owner 竞态与真实 detached CLI 清理测试；没有为压行数删除质量证据。Main 接受 revision
`2d53482b-1a74-44f9-a3b0-793c37e5344b`，digest
`c7f6f93d05b83dee74b8d7d219eb9e8eb11f37c78684b1f91eca71c6ee9e4ce3`。

自动 Integration `17f77b1b-1098-4b36-930d-f030eb2cb40c` 四阶段全部通过：source-applied 10ms、
source-verified 83,865ms、artifact-built 4,027ms、runtime-activated 2,955ms。权威 streak 随即返回
**3/3 ready**。随后生产 dogfood 调用新 detached restart，0.6 秒内返回 `ok=true/state=ready`，旧 Hub
`82617` 退出，新 Hub `31252` 在原端口 `58675` 成为唯一 listener，`hub status=current`，且 `--no-open`
如实返回 `browserOpened=false`。Daemon PID `28814`、CLI 与 Hub 均运行 build
`3403d90d38743589ac088ad5d9dcb71546062bb1ebd5955441584a98b6808d11`。

两次 Grok estimates 为 USD 0.7549164 + 0.3597172 = **USD 1.1146336**；usage missing，official cost、
Worker Token 与 exact-pair Main Token savings unavailable。进程审计发现 14 个 MCP 均有存活父进程：9 个属于
Codex App、5 个属于 Grok TUI，不具备“孤儿”证据，因此未终止；它们早于当前 build，宿主刷新前继续用 MCP 自身
identity guard 或 matched CLI。物理 kill 后中间阶段续跑仍是独立 resilience backlog，不改写本次 3/3。
无 commit / push。

## 2026-07-31 M3：Plan 依赖与 Task 来路已改成人话，并完成真实自升级

Task `10bc361c-b199-4ab5-a070-dc92341e413d` 使用 `deepseek-v4-pro[1M]`，落实
`docs/m3-hub-readable-dependency-lineage-contract.md`。Plan 里的每个步骤现在直接说明为什么可开始、在等谁、
被什么阻塞，以及完成后会解锁什么；Task Detail 只在存在真实 Plan / handoff 证据时显示“此任务所处的位置”，
并把跨 Worker handoff 解释为承接已有成果，不写成重试。Task 到 Plan 的关系由一个 Store-backed Daemon 查询
直接获取，不再扫描前十个 Plan 猜测，也没有改变调度、重试或 Integration 语义。

Grok 预备 Task `393016c3-f852-4724-8420-7bdceeacd9c1` 在模型调用前因 ForkLight 无法读取 xAI 本地认证而失败，
没有 Candidate 和模型成本；Main 保留这条失败证据，未重试，随后按可用性切到 DeepSeek。DeepSeek 第一 Attempt
产出主体，但 focused 失败 4 条且 TypeScript build 不通过；Main 同时发现 N+1 Plan 扫描、内部 ID 进入主文案、
名字边界和空心 source-presence 测试，只授权一次同 Candidate 结构化 correction。第二 Attempt 修复语义后仅剩
一个测试中的 unused binding；Main 删除这一行，并用零 Worker Token 的 Candidate reverification 跑原六条命令。

最终 focused **161/161**、full **1,952/1,952**、build、两个 Hub 脚本 syntax 与 diff hygiene 全绿。Main
接受 revision `9f0ce168-3662-4e68-9dcc-b8e9953740e4`，digest
`2c2d4fb5bdb67b5bec25a8731ff9202760b72f5d186bd70a489057c83ebb5b7b`。自动 Integration
`8ea5b4e2-93cd-403f-b119-9da9bc525563` 四阶段全部 passed：19ms / 236,925ms / 30,386ms /
10,507ms。Main 随后移除“名字缺失时拿内部 item / plan ID 当备用名”的最后边角，补行为断言后 focused
**161/161** 与 build 再次通过；没有启动第三次 Worker 循环。

真实 Hub dogfood 已验证：Plan 卡片显示“就绪 / 等待中 / 完成后解锁”的中文原因，Task Detail 显示所属 Plan、
第几步和下一项；独立检查、Main 决策和交付仍保持原有层级。当前 daemon PID `34190`、Hub
`36599@58675`，source、artifact、daemon 三层身份一致，build
`ed6039b92c280740780e8e49da3f80fe66cbd4adfcd3ab546a843720fedd8d34`。权威自升级连续证据为 **2/3**。

两次 DeepSeek Attempt 的 official cost 合计 **USD 0.169844561**，runtime estimate 合计约
**USD 9.390771**；Worker gross Token **14,434,503**，89 条 orchestration receipts 给出的边界缩减区间为
**7,063,818–13,220,607 Tokens（低置信度）**。这只说明 Worker 计算留在支线、没有全部进入 Main 交换边界；
缺少同任务 direct Codex 基线，因此 **不能**宣称节约了多少 Main Token。无 commit / push。

## 2026-07-30 M1：一条命令生成可复核 clean-user bundle

Task `aabdc502-6660-45b7-b13d-542c0123fc04` 按 Grok-first 只使用 Grok 4.5，把原先人工复制的
clean-run 材料收口为 `npm run bundle:clean -- --output <new-directory>`。命令在目标旁的私有 staging
完成真实 `npm pack`、权威 prepack 全量测试、tar SHA 与条目扫描、私有 npm prefix 安装、安装后 CLI、
真实 MCP stdio handshake、Hub/daemon 身份核对和 exact PID 清理；只有全部通过后才一次 rename 发布
tarball、build identity、runbook 与外部 evidence 四个文件。已存在目标、失败 staging 和非本 run 进程
均 fail closed，不自动重试。

第一 Attempt 形成可复用主链路，但 focused 69/70 且 TypeScript build 失败。Main 发现旧 evidence
schema 不兼容、MCP 仅语法检查、pack 可能污染源码、daemon 只看 stop 返回值等语义缺口，只授权一次同
Candidate 结构化纠正。第二 Attempt 的原验收四条命令通过；Main 对照旧 bundle 后仍拒绝“近似兼容”，
把 `schemaVersion 1` 修到旧版精确的 status、tarball 与扁平 verification 字段，并保护项目中本来存在的
同名 tarball。无 Worker 的 Candidate reverification 随后 **4/4** 通过，Main 接受 revision
`7cc68cf1-a511-4fc5-9626-ef38dae83745`，digest
`4f231ffcd276b790123ed174bdb160502562c351f6ec887bba56d1585e742dd4`。8 files / 2,636 lines 超过
1,500-line warn，但未牺牲真实协议与清理测试。Integration
`ae9178c9-5979-4d60-88c3-4165ab7d0828` 四阶段 9ms / 67,607ms / 3,350ms / 2,496ms 全部 passed。

Integration 后真实 dogfood 又暴露三处只有完整链路才会出现的问题：完全替换 `HOME` 会让依赖 macOS
Keychain readiness 的权威测试失败；混合输出解析器会误取 prepack 中更早的 JSON；局部 npm install 与后续
隔离 global-prefix 路径不一致。Main 没有启动新 Worker 或循环调参，分别改为“pack 保留 OS home、但隔离
npm 状态并移除 Provider/API env；安装后验证仍用空 home”、选择结束位置最靠后的最外层 JSON、以及私有
`--global --prefix` 安装。每个失败都在最终 rename 前清掉 staging，没有半成品或遗留进程。

最终生产命令成功生成
`/Users/Shared/ForkLight-Clean-Run.E395854A-7973-4393-9247-BE59A177505E`，恰好 4 个文件；
prepack **1,857/1,857**，SHA-256
`2831ef6b34acda6b44e784492ae553d03e491c4c1d498878f2bd43635b227462`，build
`5a6fe6c12f74fdf8453eeef08302997c73247c1c626adb0e034dc6199be366bb`。独立复算 SHA、source/final
identity cmp、evidence privacy、无 staging、无 UUID 相关进程均通过。开发 daemon PID `28398` 与 Hub
`28592@58675` 已切到同一 build，health matched、Hub current；历史 M0 streak 仍为 3/3 ready。

M1 只完成“可重复生成并验证安装包”。真正新 macOS 用户 / VM / 新 Mac 的首次 Keychain、Main 安装、
理解成本和 15/30 分钟体验仍未执行，不能写成开箱验收完成。两次 Grok Attempt 都缺失 terminal usage，
Worker Token 不可用；无 exact-pair Direct Codex baseline，不声明 Main Token 节约。无 commit / push。

## 2026-07-30 M1：Grok 在 Relay 真实看板完成一次“保留成果、有限纠正、Main 修复交付”

Task `5a34afb4-21f7-4b6d-92d6-99de36ec81b7` 按当日 Grok-first 约定只使用 Grok 4.5。合同把范围冻结为
Relay 的三个看板文件：一个纯展示模块消费现有 Item 状态、优先级和可选 Runtime 名称，产出白话中文阶段、
解释和下一步；Board 页面只消费这些展示值，打开事项与移动阶段仍走原有调用链，不改变 Domain、Store、API、
状态机或持久化。时间、Token、文件和行数没有 hard gate；同时把基础 Attempt、额外 Attempt 和自适应分别限制为
`1 / 0 / 0`，只允许 Main 对同一个 Candidate 做一次结构化 correction，避免无限重试。

第一 Attempt 用 9 turns 产出 3 files / 736 changed lines，原始五条验收全部通过。Main 在 1440px 与
390px 实际页面审查中发现每张卡常驻三个低对比度移动按钮，窄且容易误点，因此没有直接接受；唯一一次 correction
复用原 Candidate，把移动操作收进默认折叠的“移动阶段”，展开后每个目标为 32px 高、可聚焦的整行按钮。
纠正后 focused、目标 ESLint、完整 **327/327**、production build 和 diff hygiene 再次全绿；Impeccable
detector 为 `[]`，桌面与 390px 均无页面级横向 overflow，浏览器 console 为空。

最终 ForkLight Task 仍如实保留为 `failed`：Main 在 Candidate 工作区启动预览后，又让 `npm run build`
清理 `.next`，恰好与 daemon 捕获 patch 的文件扫描重叠，导致 `.next/dev/lock` 消失。这是 Main 的预览/验收
隔离错误，不是 Grok 产物失败。冻结策略不允许第三次 Attempt，因此没有放宽参数或循环重跑。Main 停止预览，
将审过的三个最终文件写入 Relay 原项目，再用原五条 acceptance 做 remediation，结果 **5/5 passed**，处置为
`verified-repaired-delivered`；没有伪造 Candidate accept、自动 Integration 或 Task success。

Token 方面，两次 Attempt 都 usage missing，Worker Token 与 official cost 不可用；仅第一次 runtime estimate
约 **USD 0.2373016**，第二次因 patch-capture 失败没有完整终态估算。41 条 receipt 给出的 Main exchange
低置信度范围为 **52,754–324,322 Tokens**。无完整 Worker 用量、也无 exact-pair Direct Codex baseline，
因此 boundary reduction 与 Main Token savings 都 unavailable，不声明节约。该样本补充 M1 的真实 UI 任务证据，
它不单独关闭真实新用户安装体验。无 commit / push。

## 2026-07-30 M1：ForkLight 已支持 manifest 声明的相邻本地包，并解除 Elsewhere Goal 阻塞

ForkLight 现在会把根 `package.json` 明确声明的相对 `file:` / `link:` 包根复制到单次隔离容器中的等价
相对位置。普通 Task、保留 Candidate 复验、Main remediation 与 Integration 使用同一 materializer；临时验收
显式区分 command cwd 和完整 cleanup root。绝对路径、目标逃逸、缺失/非包目录、manifest 错误和目标冲突均在
命令前 fail closed；不安装依赖、不改 package/lockfile、不递归扩张，也不把本地包写进 baseline 或 Candidate。

Grok Task `ef5d9f00-5d2d-4cec-ac89-97d97d2a7436` 一次 Attempt 交付 8 files / 1,036 lines，focused
150/150、full **1,869/1,869**、build 与 diff hygiene 全绿。Main 用真实 Elsewhere + Adeptify SDK 追加验证
`pnpm typecheck` 和完整容器清理后接受；自动 self-upgrade
`9264d118-ecbd-458b-9d2d-f982b18dfe07` 四阶段全部 passed。CLI/daemon build 为
`c80dca895185adaea3efc2ff32257aea5b541af9e67b2fc6cd9db6f8bddd1d81`，Hub 已在原端口 `58675`
替换为 current build。

原 Elsewhere Candidate `e2726546-07de-4e78-9ff0-8dcaf8bcd25a` 没有重跑 Worker。相同 accepted digest
`17821b0fc2ce` 经新版本 Integration `7fdbec6b-d122-4bb4-b4b4-b9263146fd65` 完成 source apply 与 5/5
source verification，Goal 进入 1/4，下一项 `shell-drawer` 已自动运行。这证明 M1 的真实项目链路能保留已确认
成果，只修执行环境后继续，而不是整单重做。随后权威 `upgrade status` 暴露 FL-D256：它把这次普通 Elsewhere
Integration 也纳入“ForkLight 自升级”序列，因为普通 App 没有 artifact build/runtime activation，当前错误返回
0/3。历史三次自升级事实没有消失，但产品投影不再可信；必须只统计明确的 `forklight-self-upgrade` 交付身份。
整体阶段仍为 M1，M0 的 3/3 展示暂时重新打开，不能写成保持完成。

本次 Grok runtime estimate 约 USD 0.79965，usage/official Worker Token 不可用；复用原 Candidate 没有新增
Worker/model Token，但因无 exact-pair Direct Codex baseline，仍不声明 Main Token 节约。无 commit / push。

## 2026-07-31 M3：terminal Task 的后续复验现在可见，不再诱发重复执行

Task `67d1e9f5-7a67-4942-a3a9-546d94d6391d` 使用 `deepseek-v4-pro[1M]`，按
`docs/m3-post-terminal-operation-observability-contract.md` 补上真实 dogfood 暴露的监督缺口：一个 Task 的
机器结果已经是 `failed` 或 `succeeded` 时，Candidate reverification 和 Main repair verification 仍可能在本地
执行。现在 Core 从已有 start/completion durable events 重建唯一打开的后续检查；Task status、finishedAt、失败分类、
Main 决策、Board lane 和主结果 badge 全部保持原样，只让 `liveStage` 与 `activity` 说明当前本地检查。安静只表示
暂时没有新的完成记录，不会被升级为失败、恢复、重试或新的 Worker。

CLI 本地 wait 读取完整事件并消费同一投影；MCP wait 复用 Decision View 的投影。`--until terminal` 只有在原 Task
已经 terminal 且后续检查也闭合时才返回，打开检查崩溃而没有 completion 时只会等待到调用者给定 timeout。
latest-only 调用者没有完整历史时继续保守采用原 terminal 结果，不从一条 start 猜测进程仍活着。Hub Board 保留原列
和 badge，Task summary 与 Task Detail 用独立中英文说明“正在本地复验保留的 Candidate / 验证 Main 修复，不会再次
调用 Worker”，并明确原任务结果没有改变。

Worker 1 Attempt / 80 turns，主体实现可用；第一次 focused 验收因两个新 wait 测试的模拟时钟没有随 `sleep` 推进而
无限空转。Main 识别出隔离测试进程 CPU 满载后，只终止两次必然重复卡住的验收命令，保留 Candidate 和机器失败证据，
没有放宽时长、Token 或重试参数，也没有启动第二个 Worker。Main 修复模拟时钟、TypeScript exact optional 写法、
Candidate 中间验收事件的活动时间，以及 Hub 对旧 decision wording 的显示优先级。零 Worker Token 的 Candidate
reverification 随后 6/6 通过：focused **199/199**、full **2,039/2,039**、build、两份 Hub syntax 与 diff hygiene
全部绿色。Main 接受 revision `115516c2-c25d-461e-b957-5f7a8946507d`，digest
`5f5b7b7436020a8db92601d112a516f46004d0f167f4e3040190a5fecaf1196c`。

自动 Integration `bcd1b382-18f7-439b-aed5-3115d1d7cb34` 四阶段全部通过：source-applied 13ms、
source-verified 79,826ms、artifact-built 4,991ms、runtime-activated 4,706ms。CLI / daemon build
`42a8643b8f031b31c430098221ff714ef2b5acdfcf5d38f37d636d06c9808bb4`、source digest
`4cd9f05896d336346f365fed5b7fa5df87ddaa5084d1153dc820d3a2b6036602`，identity matched；旧 Hub 被安全替换为
`3602@58675`，`hub status=current`，线上静态资源包含新的中英文阶段文案，浏览器页面 console 无 warning/error。
权威自升级 streak 为 **3/3 ready**。

Worker gross Token **10,363,825**，其中 cache read **10,154,240**；usage reconciliation matched。
DeepSeek official cost **USD 0.146995055**，runtime estimate USD 6.999365。29 条 receipts 给出的边界缩减范围为
9,107,605–10,158,283 Tokens（低置信度），但 exact-pair Direct Codex baseline 仍缺失，不能称为实际 Main Token
节约。Candidate reverify 明确新增 Worker/model Token 为 0，但仍有本地验收时间和 Main exchange。无 commit / push。
