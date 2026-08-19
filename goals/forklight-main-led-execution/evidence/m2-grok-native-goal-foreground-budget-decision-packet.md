# M2 Grok native Goal foreground budget decision packet

## What is durable and reusable

- Storage Revision `d6c85d59-10dc-4325-a0fc-e627b62130c2` remains normally integrated; its full
  check, matched Daemon and exact read-only reclaim preview remain valid.
- The failed audit made no source change and produced no Candidate. Its Task, Session, Attempt,
  native Goal state and raw logs are retained unchanged.
- Integrated Profile `grok-4-6-xhigh` truthfully resolved the audit to wrapper-free `native-goal`.

## Exact failure

- Task: `385e9c92-e3bb-4eb9-8008-e5ae255f1b31`
- Session: `0e01f126-7880-4414-bbb2-9636cd44f0fa`
- Attempt: `41d554a5-6358-4f2c-bbb2-ccd28e870299`
- Native Goal: `215e6043-365b-4ac9-885c-946f608f63e5`
- Terminal Goal truth: `user_paused/Executing`, `classifier_runs_attempted: 0`,
  `total_worker_rounds: 0`, `total_verify_rounds: 0`, pause message
  `Planning failed; resume with /goal to retry.`
- ForkLight Task policy: `maxDurationMs: null`, `observedTokenCeiling: null`,
  `noProgressTimeoutMs: null`, one base Attempt and no retry.
- Grok end usage: input 128,731; cache read 1,057,408; output 12,914; reasoning 9,457;
  total 1,199,053; 13 turns; Runtime estimate USD 0.1468205. No delivery cost or Main-Token saving
  claim is made because the Goal did not complete.

The raw Attempt log records 124 Planner read calls and continuing useful evidence before Grok CLI
1.0.4 emitted `foreground subagent exceeded await budget; auto-backgrounding (child keeps
running)` with `budget_ms=600000`, followed by `goal role subagent exceeded foreground wait budget
cancelled=true`. ForkLight's observation waits timed out twice without canceling or changing the
Task; the terminal failure came from the Runtime's internal Planner budget.

## Focused remedy and boundary

Local binary inspection exposes official environment variable
`GROK_FOREGROUND_BLOCK_BUDGET_MS`; the installed Grok 1.0.4 accepts value `86400000`. The accepted
Work Item freezes that value only for native Goal children and deletes inherited values for
non-native children. It changes only `src/workers/grok.ts` and `tests/worker-runtime.test.ts`, adds
no public setting or new timer, and leaves ForkLight Task policy authoritative.

The implementation may use one base Attempt, at most one validation repair and one Main correction,
then requires two usable Judges and normal safe Integration. After activation Main creates one new
audit Task; it does not resume, retry, relabel or replace the failed Task. If the same external cap
or another scope-expanding failure recurs, automatic work stops and the Workspace stays protected.

## Delivered fix

- Implementation Task `460ee0af-8709-416a-9e38-0859aec77bb0`, Session
  `c516066c-a481-4ae1-a7c6-468c283f62b5`, Attempt
  `eb50fd41-9c04-411a-bf74-a51519d2fc3b` used Grok 4.6 Xhigh `native-goal`.
- Native Goal `7813fd8f-2700-4dc4-87ea-68ad096deb9` is `complete/Idle`, ran one Worker round and
  one classifier, and its last classifier verdict is `achieved`.
- Revision `c0fb927a-65b0-4d84-8534-a04adc3f29e8`, patch digest
  `f5577b0224a8dfd618bd055f7229b6946a6682e2fe861d62d74c8f548abf12f5`, changes exactly the two
  approved paths and 46 lines. No validation repair or Main correction was consumed.
- ForkLight independently passed build, 134 runtime tests and diff check.
- Review Graph `e8bdc35b-db27-4840-9696-5ec844993db4` has two usable `accept` opinions from Codex
  Luna Max and DeepSeek Flash. Main checked the two non-blocking count notes against the accepted
  budget and exact `git apply --numstat`, then accepted the exact Revision.
- Preflight receipt `7fb72a96-03e0-4c76-9cd8-b0f0fa0f12d7` had no rejection. Integration
  `ba60264f-d1c3-48d9-aa7d-b2bf253a1d27` passed source apply, verification, build, activation and
  activation check. `npm run check` passed 2,968/2,968 and restarted client/Daemon identity matches.
- Grok terminal usage was absent; ForkLight reports Runtime estimate USD 0.31896658 only. Official
  cost, Worker Token and Main-Token saving remain unavailable rather than inferred.

The next proof is one new activated-source audit under the integrated child environment. The old
failed audit and its one Attempt stay immutable.

## Post-fix audit stop

- Audit Task `f20334a0-b8bd-4886-977b-62fa3553e501`, Session
  `08c5d7f5-b3e1-4724-a962-a1885180896f`, Attempt
  `174e03b9-c750-4221-a58c-4a94f459c6de` used the activated Grok 4.6 Xhigh native path.
- Planner subagent `01a0068c-990b-7ff0-9940-84fbfcd76a86` completed after 505,496 ms and 73 tool
  calls. No `budget_ms=600000`, foreground-wait cancellation or cap error exists.
- Its durable `output.json` contains the complete audit plan and explicitly says file tools were not
  available. Current `grokNativeAllowTools(false)` omits `search_replace/write`, although the native
  Plan Writer contract requires its only write to Task-local `grok-home/.../goal/plan-*.md`.
- Native Goal `13a67662-170b-40dc-a758-ad79487f1528` is
  `user_paused/Executing`, `plan_file: null`, classifier/Worker/verification rounds all zero. The
  later parent prose cannot satisfy `complete + achieved`.
- Task outcome is failed with no verification or Candidate. Validation repair, correction and
  retry were all zero. Runtime estimate is USD 0.14667396; official Token/cost evidence is missing.
- Storage preview is `protected/unresolved-terminal`: 117,490,429 total bytes, 113,801,581
  regenerable, 3,688,848 durable, 0 unknown, no process, integrity `ok/0`. No reclaim occurred.

The cap fix remains safely integrated, but the Work Item's live audit acceptance is unmet. The
read-only tool-policy change is a new scope boundary. Main recommends a separate M2-A Work Item:
always register native Goal plan mutators; for `allowEdits:false`, add exact Workspace
`Write/Edit(<workspace>/**)` denials so only Task-local Goal plan persistence remains possible;
preserve editable native behavior and existing credential/config/state/Bash denials. No new Task,
resume, replacement, model switch or fallback is authorized by this packet.

## Read-only feasibility proof

The recommendation is not theoretical. Existing operational policy test
`foreground-plan-bootstrap.test.mjs` still passes and proves the combination of Task-local
`search_replace/write`, exact Workspace `Write/Edit` denials, credential/config/state denials and
Bash denial. Historical Task `6fbf8e70-a48a-4e7b-8cb8-3dc07e836085` used that read-only policy in a
real Grok 4.6 Xhigh native Goal: Goal `e1941538-caf8-4c0b-bdf1-5c5241bf3476` remains durably
`complete/Idle`, its Task-local plan is 7,281 bytes, classifier ran once with `achieved`, and the
Worker ran once while its Candidate Workspace stayed read-only.

Therefore the missing product boundary is already demonstrated in one real case. The next Work
Item need not invent a permission model: it only promotes the minimal read-only distinction into
the normal adapter and adds focused editable/read-only/persistent-session tests. Removing current
background-control registrations is not required to fix this failure and remains out of scope.
